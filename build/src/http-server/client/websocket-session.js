// @ts-check
import { randomUUID } from "node:crypto";
import { ensureError } from "typanic";
import { ValidationError } from "../../database/record/index.js";
import Logger from "../../logger.js";
import EventEmitter from "../../utils/event-emitter.js";
import isPlainObject from "../../utils/plain-object.js";
import VelociousError from "../../velocious-error.js";
import WebsocketChannel from "../websocket-channel.js";
import { websocketEventLogStoreForConfiguration } from "../websocket-event-log-store.js";
import RequestRunner from "./request-runner.js";
import RequestTiming from "./request-timing.js";
import WebsocketRequest from "./websocket-request.js";
/**
 * Defines this typedef.
 * @typedef {{type: "subscribe", channel: string, lastEventId?: string, params?: Record<string, ReturnType<typeof JSON.parse>>} | {type: "metadata", data?: Record<string, ReturnType<typeof JSON.parse>>} | {type?: "request", body?: ReturnType<typeof JSON.parse>, headers?: Record<string, ReturnType<typeof JSON.parse>>, id?: string | number | null, method: string, path: string} | Record<string, ReturnType<typeof JSON.parse>>} WebsocketSessionMessage
 */
/**
 * @typedef {object} InboundMessageAdmission
 * @property {number} byteLength - Exact raw text payload bytes charged to this admission.
 * @property {number} generation - Accounting generation active when admitted.
 * @property {boolean} released - Whether this admission has already been released.
 */
/**
 * @typedef {object} InboundMessageWork
 * @property {InboundMessageAdmission} admission - Admission ownership.
 * @property {WebsocketSessionMessage} message - Decoded client message.
 */
const WEBSOCKET_FINAL_FRAME = 0x80;
const WEBSOCKET_OPCODE_CONTINUATION = 0x0;
const WEBSOCKET_OPCODE_TEXT = 0x1;
const WEBSOCKET_OPCODE_BINARY = 0x2;
const WEBSOCKET_OPCODE_CLOSE = 0x8;
const WEBSOCKET_OPCODE_PING = 0x9;
const WEBSOCKET_OPCODE_PONG = 0xA;
const WEBSOCKET_CLOSE_NORMAL = 1000;
const WEBSOCKET_CLOSE_POLICY_VIOLATION = 1008;
const WEBSOCKET_INBOUND_BACKLOG_CLOSE_REASON = "Inbound message backlog exceeded";
const WEBSOCKET_MAX_CLOSE_REASON_BYTES = 123;
/** Cap on the paused outbound queue; oldest frames drop on overflow. */
const WEBSOCKET_PAUSED_QUEUE_CAP = 1000;
/** Cap on total bytes buffered for a single fragmented message. */
const WEBSOCKET_MAX_FRAGMENTED_MESSAGE_BYTES = 16 * 1024 * 1024;
/** Cap on payload bytes buffered for a single final data frame. */
const WEBSOCKET_MAX_FINAL_FRAME_BYTES = WEBSOCKET_MAX_FRAGMENTED_MESSAGE_BYTES;
const WEBSOCKET_MAX_INBOUND_FRAME_BYTES_BIGINT = BigInt(WEBSOCKET_MAX_FINAL_FRAME_BYTES);
/** Cap on fragment count for a single fragmented message. */
const WEBSOCKET_MAX_FRAGMENTED_MESSAGE_FRAGMENTS = 1024;
/**
 * Runs subscribe message.
 * @param {WebsocketSessionMessage} message - Raw websocket message.
 * @returns {{type: "subscribe", channel: string, lastEventId?: string, params?: Record<string, ReturnType<typeof JSON.parse>>} | null} - Subscribe message when matched.
 */
function subscribeMessage(message) {
    return message.type === "subscribe"
        ? /** @type {{type: "subscribe", channel: string, lastEventId?: string, params?: Record<string, ReturnType<typeof JSON.parse>>}} */ (message)
        : null;
}
/**
 * Runs request message.
 * @param {WebsocketSessionMessage} message - Raw websocket message.
 * @returns {{type?: "request", body?: ReturnType<typeof JSON.parse>, headers?: Record<string, ReturnType<typeof JSON.parse>>, id?: string | number | null, method: string, path: string} | null} - Request message when matched.
 */
function requestMessage(message) {
    if (message.type && message.type !== "request")
        return null;
    return /** @type {{type?: "request", body?: ReturnType<typeof JSON.parse>, headers?: Record<string, ReturnType<typeof JSON.parse>>, id?: string | number | null, method: string, path: string}} */ (message);
}
/**
 * Compares two identity values from `getWebsocketSessionIdentityResolver`.
 * Nullish values compare equal to each other but not to a real identity.
 * Plain objects are compared via JSON round-trip so apps can return a
 * `{userId, tenantId}`-style object without building their own equality.
 * @param {ReturnType<typeof JSON.parse>} a - Paused-time identity.
 * @param {ReturnType<typeof JSON.parse>} b - Resume-time identity.
 * @returns {boolean} - True when the two identities are considered the same caller.
 */
function identitiesMatch(a, b) {
    if (a === b)
        return true;
    if (a == null || b == null)
        return false;
    if (typeof a !== "object" || typeof b !== "object")
        return false;
    try {
        return JSON.stringify(a) === JSON.stringify(b);
    }
    catch {
        return false;
    }
}
export default class VelociousHttpServerClientWebsocketSession {
    events = new EventEmitter();
    subscriptions = new Set();
    channels = new Set();
    subscriptionHandlers = new Map();
    handlerSubscriptions = new Map();
    channelTenants = new Map();
    channelReplayStates = new Map();
    /**
     * Message queue.
     * @type {InboundMessageWork[]} */
    messageQueue = [];
    /**
     * Runs constructor.
     * @param {object} args - Options object.
     * @param {import("../../configuration.js").default} args.configuration - Configuration instance.
     * @param {import("./index.js").default} args.client - Client instance.
     * @param {import("./request.js").default | import("./websocket-request.js").default} [args.upgradeRequest] - Initial websocket upgrade request.
     * @param {import("../../configuration-types.js").WebsocketMessageHandler} [args.messageHandler] - Optional raw message handler.
     * @param {Promise<import("../../configuration-types.js").WebsocketMessageHandler | void>} [args.messageHandlerPromise] - Optional raw message handler promise.
     */
    constructor({ client, configuration, upgradeRequest, messageHandler, messageHandlerPromise }) {
        /** @type {Buffer[]} */
        this._bufferChunks = [];
        this._bufferChunkIndex = 0;
        this._bufferChunkOffset = 0;
        this._bufferedBytes = 0;
        this._bufferedFrameCopyBytes = 0;
        this.client = client;
        this.configuration = configuration;
        this.upgradeRequest = upgradeRequest;
        this.messageHandler = messageHandler;
        this.messageHandlerPromise = messageHandlerPromise;
        this.pendingMessageHandler = Boolean(messageHandlerPromise);
        this.logger = new Logger(this);
        const inboundQueueLimits = this.configuration.getWebsocketInboundQueueLimits();
        this._inboundMaxPendingBytes = inboundQueueLimits.maxBytes;
        this._inboundMaxPendingMessages = inboundQueueLimits.maxMessages;
        this._inboundPendingBytes = 0;
        this._inboundPendingMessages = 0;
        this._inboundAccountingGeneration = 0;
        this._inboundClosed = false;
        this._inboundBacklogOverloaded = false;
        /**
         * Narrows the runtime value to the documented type.
         * @type {Record<string, ReturnType<typeof JSON.parse>>} */
        this._metadata = {};
        /**
         * Long-lived per-session state bag. Stable across reconnects once
         * grace-period resumption lands in Phase 2; today it just lives
         * for the duration of the underlying socket.
         * @type {Record<string, ReturnType<typeof JSON.parse>>}
         */
        this.data = {};
        /**
         * Narrows the runtime value to the documented type.
         * @type {Map<string, import("../websocket-connection.js").default>} */
        this._connections = new Map();
        /**
         * Narrows the runtime value to the documented type.
         * @type {Map<string, {channelType: string, subscription: import("../websocket-channel.js").default}>} */
        this._channelSubscriptions = new Map();
        /**
         * Unique id assigned to this session on first connect. Sent to the
         * client via `session-established`; the client echoes it back via
         * `session-resume` after a WS drop to reattach to this session
         * within the grace period.
         * @type {string}
         */
        this.sessionId = randomUUID();
        /**
         * Narrows the runtime value to the documented type.
         * @type {boolean} - true after `_handleClose` pauses instead of tearing down.
         */
        this._paused = false;
        /**
         * Narrows the runtime value to the documented type.
         * @type {Array<ReturnType<typeof JSON.parse>>} - frames produced while paused; flushed on resume.
         */
        this._outboundQueue = [];
        /**
         * Narrows the runtime value to the documented type.
         * @type {import("./index.js").default | null} */
        this.socket = null;
        /**
         * Tail of a per-session promise chain that serializes message
         * handling. Prevents races where message B reads `session.data`
         * before message A's handler finishes writing it (e.g. a
         * connection-message setting the locale vs. a subsequent request
         * whose aroundRequest wrapper reads it).
         * @type {Promise<void>}
         */
        this._messageChain = Promise.resolve();
        /**
         * Promise that resolves to the auth identity captured at pause
         * time by `getWebsocketSessionIdentityResolver`. Awaited at resume
         * time to compare against the fresh caller's identity. Undefined
         * on a live (non-paused) session.
         * @type {Promise<ReturnType<typeof JSON.parse>> | undefined}
         */
        this._resumeIdentityPromise = undefined;
        /** @type {string | null} */
        this._claimedSessionId = null;
        /**
         * Accumulates payloads for a fragmented websocket message per
         * RFC 6455. Non-null while mid-fragment; cleared when the frame
         * with FIN=1 completes and the message is dispatched.
         * @type {Buffer[] | null}
         */
        this._fragmentedPayloads = null;
        /**
         * Opcode (TEXT/BINARY) captured from the first frame of a
         * fragmented message. Continuation frames (opcode 0) inherit it
         * at reassembly time.
         * @type {number | null}
         */
        this._fragmentedOpcode = null;
        /**
         * Running byte total for `_fragmentedPayloads`. Used to enforce
         * `WEBSOCKET_MAX_FRAGMENTED_MESSAGE_BYTES` so a peer cannot
         * exhaust memory by streaming non-final fragments indefinitely.
         * @type {number}
         */
        this._fragmentedBytes = 0;
        this.configuration._websocketSessions.add(this);
        /**
         * Heartbeat liveness flag. Set true on every inbound frame
         * (including the client's auto-pong) and cleared each time a ping
         * is sent; a still-false flag at the next tick means the socket
         * has gone silent.
         * @type {boolean}
         */
        this._heartbeatAlive = true;
        /**
         * Per-session heartbeat interval handle. Started from
         * `sendSessionEstablished` once the socket is live, not at
         * construction, so directly-constructed sessions in tests don't
         * spin up a background timer.
         * @type {ReturnType<typeof setInterval> | null}
         */
        this._heartbeatTimer = null;
    }
    /**
     * Sends the client its sessionId + grace window. Called by
     * `VelociousHttpServerClient` after the WS upgrade completes.
     * @returns {void}
     */
    sendSessionEstablished() {
        this._claimOwnership();
        this.sendJson({
            type: "session-established",
            sessionId: this.sessionId,
            graceSeconds: this.configuration.getWebsocketSessionGraceSeconds?.() || 300
        });
        // The socket is live now, so begin reaping it if it goes silent.
        this._startHeartbeat();
    }
    /**
     * Removes a closed connection from the session registry. Called by
     * `VelociousWebsocketConnection.close()` after it sends the final
     * `connection-closed` frame.
     * @param {string} connectionId - Closed connection identifier to remove.
     * @returns {void}
     */
    _removeConnection(connectionId) {
        this._connections.delete(connectionId);
    }
    /**
     * Runs get metadata.
     * @returns {Record<string, ReturnType<typeof JSON.parse>>} - Client-provided metadata (defensive copy).
     */
    getMetadata() {
        return { ...this._metadata };
    }
    /**
     * Runs is paused.
     * @returns {boolean} - true while the session is in the paused/grace registry.
     */
    isPaused() {
        return this._paused;
    }
    /**
     * Runs add subscription.
     * @param {string} channel - Channel name.
     * @returns {void} - No return value.
     */
    addSubscription(channel) {
        this.subscriptions.add(channel);
    }
    destroy() {
        this._releaseOwnership();
        this._stopHeartbeat();
        this._resetFragmentBuffer();
        this._clearBufferedFrameChunks();
        this._abandonInboundMessages();
        this.configuration._websocketSessions.delete(this);
        this._paused = false;
        void this._teardownChannel();
        void this._teardownConnections("session_destroyed");
        void this._teardownChannelSubscriptions();
        this.events.removeAllListeners();
    }
    /** Claims this session id for host-side reconnect routing. */
    _claimOwnership() {
        if (this._claimedSessionId === this.sessionId)
            return;
        if (this._claimedSessionId)
            this._releaseOwnership();
        this._claimedSessionId = this.sessionId;
        this.events.emit("ownershipClaimed", { sessionId: this.sessionId });
    }
    /** Releases the currently claimed session id exactly once. */
    _releaseOwnership() {
        const sessionId = this._claimedSessionId;
        if (!sessionId)
            return;
        this._claimedSessionId = null;
        this.events.emit("ownershipReleased", { sessionId });
    }
    /**
     * Runs has subscription.
     * @param {string} channel - Channel name.
     * @returns {boolean} - Whether it has subscription.
     */
    hasSubscription(channel) {
        return this.subscriptions.has(channel);
    }
    /**
     * Runs on data.
     * @param {Buffer} data - Data payload.
     * @returns {void} - No return value.
     */
    onData(data) {
        // Any inbound bytes — a data frame, the auto-pong answering our
        // heartbeat, or a partial frame still being uploaded — prove the
        // socket is alive. Mark it here, before `_processBuffer` may return
        // early waiting for the rest of an incomplete frame.
        this._heartbeatAlive = true;
        if (this._inboundClosed || data.length === 0)
            return;
        this._bufferChunks.push(data);
        this._bufferedBytes += data.length;
        this._processBuffer();
    }
    /**
     * Runs send event.
     * @param {string} channel - Channel name.
     * @param {ReturnType<typeof JSON.parse>} payload - Payload data.
     * @param {{createdAt?: string, eventId?: string, replayed?: boolean, sequence?: number}} [options] - Event metadata.
     * @returns {Promise<void>} - Resolves when complete.
     */
    async sendEvent(channel, payload, options = {}) {
        const channelHandlers = this.subscriptionHandlers.get(channel);
        const hasChannelHandlers = Boolean(channelHandlers && channelHandlers.size > 0);
        const replayState = this.channelReplayStates.get(channel);
        if (replayState?.replaying && !options.replayed) {
            replayState.buffered = true;
            return;
        }
        if (!this.hasSubscription(channel) && !hasChannelHandlers)
            return;
        if (hasChannelHandlers) {
            await Promise.all(Array.from(channelHandlers).map(async (handler) => {
                const tenant = this.channelTenants.get(handler);
                await this.configuration.runWithTenant(tenant, async () => {
                    await this._withConnections(async () => {
                        await handler.receivedBroadcast({
                            channel,
                            createdAt: options.createdAt,
                            eventId: options.eventId,
                            payload,
                            replayed: options.replayed,
                            sequence: options.sequence
                        });
                    });
                });
            }));
            return;
        }
        this.sendJson({
            channel,
            createdAt: options.createdAt,
            eventId: options.eventId,
            payload,
            replayed: options.replayed,
            sequence: options.sequence,
            type: "event"
        });
    }
    /**
     * Runs initialize channel.
     * @returns {Promise<void>} - Resolves when complete.
     */
    async initializeChannel() {
        if (this.messageHandlerPromise) {
            await this._resolveMessageHandlerPromise();
            if (this.messageHandler)
                return;
        }
        if (this.messageHandler) {
            await this._runMessageHandlerOpen();
            return;
        }
        const resolver = this.configuration.getWebsocketChannelResolver?.();
        if (!resolver)
            return;
        try {
            const tenant = await this._resolveTenant({});
            const resolved = await this.configuration.runWithTenant(tenant, async () => {
                return await resolver({
                    client: this.client,
                    configuration: this.configuration,
                    request: this.upgradeRequest,
                    websocketSession: this
                });
            });
            if (!resolved)
                return;
            const channel = typeof resolved === "function"
                ? new resolved({ client: this.client, configuration: this.configuration, request: this.upgradeRequest, websocketSession: this })
                : resolved;
            if (channel && !(channel instanceof WebsocketChannel)) {
                throw new Error("Resolved websocket channel must extend WebsocketChannel");
            }
            await this._registerChannel(channel, tenant);
        }
        catch (caughtError) {
            const error = this._reportUnexpectedDispatchError(caughtError, {
                stage: "websocket-channel-initialize"
            });
            this.logger.error(() => ["Failed to initialize websocket channel", error]);
        }
    }
    /**
     * Runs send goodbye.
     * @param {import("./index.js").default} client - Client instance.
     * @param {{code?: number, reason?: string}} [options] - Optional close status.
     * @returns {void} - No return value.
     */
    sendGoodbye(client, { code, reason = "" } = {}) {
        let payload;
        if (code === undefined) {
            payload = Buffer.alloc(0);
        }
        else {
            const reasonBytes = Buffer.from(reason, "utf-8");
            if (reasonBytes.length > WEBSOCKET_MAX_CLOSE_REASON_BYTES) {
                throw new RangeError("WebSocket close reason must not exceed 123 UTF-8 bytes");
            }
            payload = Buffer.allocUnsafe(2 + reasonBytes.length);
            payload.writeUInt16BE(code, 0);
            reasonBytes.copy(payload, 2);
        }
        const frame = Buffer.concat([
            Buffer.from([WEBSOCKET_FINAL_FRAME | WEBSOCKET_OPCODE_CLOSE, payload.length]),
            payload
        ]);
        client.events.emit("output", frame, { websocketFrame: true });
    }
    /**
     * Whether a caught dispatch error is an expected client-flow failure.
     * @param {Error} error - Normalized dispatch error.
     * @returns {boolean} - Whether framework error reporters should ignore it.
     */
    _expectedClientError(error) {
        if (error instanceof ValidationError)
            return true;
        if (error instanceof VelociousError && error.safeToExpose)
            return true;
        const annotatedError = /** @type {Error & {errorType?: string, velocious?: Record<string, ReturnType<typeof JSON.parse>>}} */ (error);
        if (isPlainObject(annotatedError.velocious))
            return true;
        return typeof annotatedError.errorType === "string" && annotatedError.errorType.length > 0;
    }
    /**
     * Reports one unexpected WebSocket dispatch failure and returns its redacted Error diagnostic.
     * @param {ReturnType<typeof JSON.parse>} caughtError - Caught dispatch failure.
     * @param {Record<string, ReturnType<typeof JSON.parse>>} context - Structured dispatch context.
     * @returns {Error} - Redacted error for logs and framework error events.
     */
    _reportUnexpectedDispatchError(caughtError, context) {
        const error = ensureError(caughtError);
        const redactor = this.configuration.getLogRedactor();
        const requestTiming = this.configuration.getCurrentRequestTiming();
        let sensitiveValues = requestTiming ? requestTiming.getLogSensitiveValues() : new Set();
        if (this.upgradeRequest) {
            sensitiveValues = redactor.requestSensitiveValues(this.upgradeRequest, sensitiveValues);
        }
        const redactedError = redactor.redactError(error, sensitiveValues);
        const redactedContext = /** @type {Record<string, ReturnType<typeof JSON.parse>>} */ (redactor.redactStructured(context, sensitiveValues));
        if (this._expectedClientError(error))
            return redactedError;
        const errorPayload = {
            context: redactedContext,
            error: redactedError,
            request: this.upgradeRequest
        };
        const errorEvents = this.configuration.getErrorEvents();
        errorEvents.emit("framework-error", errorPayload);
        errorEvents.emit("all-error", { ...errorPayload, errorType: "framework-error" });
        return redactedError;
    }
    /**
     * Runs handle message.
     * @param {WebsocketSessionMessage} message - Message text.
     * @returns {Promise<void>} - Resolves when complete.
     */
    async _handleMessage(message) {
        const admission = this._admitInboundMessage(0);
        if (!admission)
            return;
        await this._handleMessageWork({ admission, message });
    }
    /**
     * Appends an admitted message to the per-session FIFO chain.
     * @param {InboundMessageWork} work - Admitted decoded message.
     * @returns {Promise<void>} - Resolves when complete.
     */
    async _handleMessageWork(work) {
        // Serialize per-session: chain onto `_messageChain` so messages
        // are processed one at a time. Without this, fire-and-forget
        // dispatch from `_processBuffer` lets message B read
        // `session.data` before A has finished writing it.
        const previous = this._messageChain;
        const next = previous.then(() => this._runMessageWork(work));
        this._messageChain = next.catch(() => { });
        await next;
    }
    /**
     * Dispatches or transfers one admitted message while retaining its accounting.
     * @param {InboundMessageWork} work - Admitted decoded message.
     * @returns {Promise<void>} - Resolves after dispatch or resolver-queue transfer.
     */
    async _runMessageWork(work) {
        if (this._inboundClosed) {
            this._releaseInboundAdmission(work.admission);
            return;
        }
        if (this.pendingMessageHandler) {
            this.messageQueue.push(work);
            return;
        }
        try {
            await this._dispatchMessage(work.message);
        }
        finally {
            this._releaseInboundAdmission(work.admission);
        }
    }
    /**
     * Runs dispatch message.
     * @param {WebsocketSessionMessage} message - Message text.
     * @returns {Promise<void>} - Resolves when complete.
     */
    async _dispatchMessage(message) {
        await this._runWithMessageLogContext(message, async () => {
            const wrapper = this.configuration.getWebsocketAroundRequest?.();
            if (wrapper) {
                await wrapper(this, () => this._handleMessageInner(message));
                return;
            }
            await this._handleMessageInner(message);
        });
    }
    /**
     * Runs one decoded message in its own request timing and sensitive-value context.
     * @param {WebsocketSessionMessage} message - Decoded client message.
     * @param {() => Promise<void>} callback - Message dispatch callback.
     * @returns {Promise<void>} - Resolves after the message finishes.
     */
    async _runWithMessageLogContext(message, callback) {
        const requestTiming = new RequestTiming();
        const redactor = this.configuration.getLogRedactor();
        let sensitiveValues = redactor.sensitiveValues(message);
        sensitiveValues = redactor.sensitiveValues(this.getMetadata(), sensitiveValues);
        if (this.upgradeRequest) {
            sensitiveValues = redactor.requestSensitiveValues(this.upgradeRequest, sensitiveValues);
        }
        requestTiming.registerLogSensitiveValues(sensitiveValues);
        await this.configuration.runWithRequestTiming(requestTiming, callback);
    }
    /**
     * The actual message dispatch, extracted so
     * `configuration.getWebsocketAroundRequest()` can wrap it in any
     * per-request context (AsyncLocalStorage, tracing, etc.).
     * @param {WebsocketSessionMessage} message - Decoded client frame to dispatch by message type.
     * @returns {Promise<void>}
     */
    async _handleMessageInner(message) {
        // The messageHandler short-circuits default routing only when the
        // app actually declared an `onMessage` hook. Apps that only want
        // session-lifecycle tracking (`onOpen`/`onClose`) still need the
        // built-in subscribe/connection/channel-subscribe routing below,
        // otherwise every incoming message is silently dropped.
        if (this.messageHandler && typeof this.messageHandler.onMessage === "function") {
            await this._runMessageHandlerMessage(message);
            return;
        }
        const subscribePayload = subscribeMessage(message);
        if (subscribePayload) {
            const { channel, lastEventId, params } = subscribePayload;
            if (!channel)
                throw VelociousError.safe("channel is required for subscribe");
            const resolver = this.configuration.getWebsocketChannelResolver?.();
            if (resolver) {
                await this._handleChannelSubscription({ channel, lastEventId, params });
            }
            else {
                await this.subscribeToChannel(channel, { acknowledge: true, lastEventId, params });
            }
            return;
        }
        if (message.type === "metadata") {
            const metadataPayload = /** @type {{data?: Record<string, ReturnType<typeof JSON.parse>>}} */ (message);
            this._metadata = metadataPayload.data && typeof metadataPayload.data === "object" ? { ...metadataPayload.data } : {};
            for (const { subscription } of this._channelSubscriptions.values()) {
                if (typeof subscription.onMetadataChanged === "function") {
                    await this._withConnections(async () => {
                        await subscription.onMetadataChanged(this._metadata);
                    });
                }
            }
            return;
        }
        if (message.type === "session-resume") {
            await this._handleSessionResume(message);
            return;
        }
        if (message.type === "connection-open") {
            await this._handleConnectionOpen(message);
            return;
        }
        if (message.type === "connection-message") {
            await this._handleConnectionMessage(message);
            return;
        }
        if (message.type === "connection-close") {
            await this._handleConnectionClose(message);
            return;
        }
        if (message.type === "channel-subscribe") {
            await this._handleChannelSubscribe(message);
            return;
        }
        if (message.type === "channel-unsubscribe") {
            await this._handleChannelUnsubscribe(message);
            return;
        }
        if (message.type && message.type !== "request") {
            this.sendJson({ error: `Unknown message type: ${message.type}`, type: "error" });
            return;
        }
        const requestPayload = requestMessage(message);
        if (!requestPayload) {
            this.sendJson({ error: `Unknown message type: ${message.type}`, type: "error" });
            return;
        }
        const { body, headers, id, method, path } = requestPayload;
        if (!method)
            throw VelociousError.safe("method is required");
        if (!path)
            throw VelociousError.safe("path is required");
        const request = new WebsocketRequest({
            body,
            headers,
            metadata: this.getMetadata(),
            method,
            path,
            remoteAddress: this.remoteAddress()
        });
        const requestRunner = new RequestRunner({
            configuration: this.configuration,
            request
        });
        requestRunner.events.on("done", () => {
            const response = requestRunner.response;
            const body = response.getBody();
            const headers = response.headers;
            this.sendJson({
                body,
                headers,
                id,
                statusCode: response.getStatusCode(),
                statusMessage: response.getStatusMessage(),
                type: "response"
            });
            void requestRunner.logCompletedRequest().catch((error) => {
                this.logger.warn("Failed to log completed request", error);
            });
        });
        await requestRunner.run();
    }
    /**
     * Runs process buffer.
     * @returns {void} - No return value.
     */
    _processBuffer() {
        while (this._bufferedBytes >= 2) {
            const initialHeader = this._peekBufferedBytes(2);
            const firstByte = initialHeader[0];
            const secondByte = initialHeader[1];
            const isFinal = (firstByte & WEBSOCKET_FINAL_FRAME) === WEBSOCKET_FINAL_FRAME;
            const opcode = firstByte & 0x0F;
            const isMasked = (secondByte & 0x80) === 0x80;
            let payloadLength = secondByte & 0x7F;
            let offset = 2;
            if (payloadLength === 126) {
                if (this._bufferedBytes < offset + 2)
                    return;
                payloadLength = this._peekBufferedBytes(offset + 2).readUInt16BE(offset);
                offset += 2;
            }
            else if (payloadLength === 127) {
                if (this._bufferedBytes < offset + 8)
                    return;
                const bigLength = this._peekBufferedBytes(offset + 8).readBigUInt64BE(offset);
                if (bigLength > WEBSOCKET_MAX_INBOUND_FRAME_BYTES_BIGINT) {
                    this.logger.warn(() => [
                        "Websocket frame exceeded byte cap; closing connection",
                        { frameBytes: bigLength.toString(), maxBytes: WEBSOCKET_MAX_FINAL_FRAME_BYTES }
                    ]);
                    this._closeForInboundLimit();
                    return;
                }
                payloadLength = Number(bigLength);
                offset += 8;
            }
            const maskLength = isMasked ? 4 : 0;
            const frameLength = offset + maskLength + payloadLength;
            if (this._bufferedBytes < frameLength)
                return;
            const frame = this._consumeBufferedBytes(frameLength);
            /** @type {Buffer} */
            let payload = frame.subarray(offset + maskLength, frameLength);
            if (isMasked) {
                const mask = frame.subarray(offset, offset + maskLength);
                this._unmaskPayload(payload, mask);
            }
            // Control frames (opcode >= 0x8) must not be fragmented per
            // RFC 6455 and can arrive interleaved with a fragmented data
            // message. Handle them first without touching the fragment
            // accumulator.
            if (opcode === WEBSOCKET_OPCODE_PING) {
                this._sendControlFrame(WEBSOCKET_OPCODE_PONG, payload);
                continue;
            }
            if (opcode === WEBSOCKET_OPCODE_CLOSE) {
                const allowResume = payload.length < 2 || payload.readUInt16BE(0) !== WEBSOCKET_CLOSE_NORMAL;
                this.sendGoodbye(this.client);
                this._handleClose({ allowResume });
                continue;
            }
            if (opcode === WEBSOCKET_OPCODE_PONG) {
                // Answer to a heartbeat ping; liveness is recorded in onData.
                continue;
            }
            if (opcode >= 0x8) {
                this.logger.warn(`Unsupported websocket control opcode: ${opcode}`);
                continue;
            }
            // Data frame (TEXT/BINARY/CONTINUATION). Reassemble fragments
            // before dispatching. Browsers (Chrome) legitimately fragment
            // longer client→server text frames; a prior version dropped
            // every fragmented message silently, so any payload large
            // enough to hit the browser's fragmentation threshold
            // (e.g. a channel-subscribe with an auth token) never reached
            // the handler.
            if (opcode === WEBSOCKET_OPCODE_CONTINUATION) {
                if (this._fragmentedPayloads === null) {
                    this.logger.warn("Received continuation frame with no fragmented message in progress");
                    continue;
                }
                if (!this._appendFragment(payload))
                    return;
                if (!isFinal)
                    continue;
            }
            else if (opcode === WEBSOCKET_OPCODE_TEXT || opcode === WEBSOCKET_OPCODE_BINARY) {
                if (this._fragmentedPayloads !== null) {
                    this.logger.warn("Received new data frame while a fragmented message was in progress; discarding prior fragments");
                    this._resetFragmentBuffer();
                }
                if (!isFinal) {
                    this._fragmentedPayloads = [payload];
                    this._fragmentedOpcode = opcode;
                    this._fragmentedBytes = payload.length;
                    if (!this._enforceFragmentLimits())
                        return;
                    continue;
                }
            }
            else {
                this.logger.warn(`Unsupported websocket data opcode: ${opcode}`);
                continue;
            }
            /**
             * Defines finalPayload.
             * @type {Buffer} */
            let finalPayload;
            /**
             * Defines finalOpcode.
             * @type {number} */
            let finalOpcode;
            if (this._fragmentedPayloads !== null) {
                if (opcode === WEBSOCKET_OPCODE_CONTINUATION) {
                    finalPayload = Buffer.concat(this._fragmentedPayloads);
                    finalOpcode = this._fragmentedOpcode ?? WEBSOCKET_OPCODE_TEXT;
                }
                else {
                    finalPayload = payload;
                    finalOpcode = opcode;
                }
                this._resetFragmentBuffer();
            }
            else {
                finalPayload = payload;
                finalOpcode = opcode;
            }
            if (finalOpcode !== WEBSOCKET_OPCODE_TEXT) {
                this.logger.warn(`Unsupported websocket data opcode after reassembly: ${finalOpcode}`);
                continue;
            }
            const admission = this._admitInboundMessage(finalPayload.length);
            if (!admission)
                return;
            try {
                const message = JSON.parse(finalPayload.toString("utf-8"));
                this._handleMessageWork({ admission, message }).catch((caughtError) => {
                    const clientErrorMessage = caughtError instanceof Error ? caughtError.message : String(caughtError);
                    const error = this._reportUnexpectedDispatchError(caughtError, {
                        stage: "websocket-message-dispatch"
                    });
                    this.logger.error(() => ["Websocket message handler failed", error]);
                    this.sendJson({
                        error: clientErrorMessage,
                        type: "error"
                    });
                });
            }
            catch (error) {
                this._releaseInboundAdmission(admission);
                this.logger.error(() => ["Failed to parse websocket message", error]);
                this.sendJson({ error: "Invalid websocket message", type: "error" });
            }
        }
    }
    /**
     * Copies the leading buffered bytes without consuming them. Header
     * inspection is bounded to the websocket header size.
     * @param {number} byteCount - Number of leading bytes to inspect.
     * @returns {Buffer} - Copied prefix.
     */
    _peekBufferedBytes(byteCount) {
        const prefix = Buffer.allocUnsafe(byteCount);
        let copiedBytes = 0;
        let chunkOffset = this._bufferChunkOffset;
        for (let chunkIndex = this._bufferChunkIndex; chunkIndex < this._bufferChunks.length; chunkIndex += 1) {
            const chunk = this._bufferChunks[chunkIndex];
            const bytesFromChunk = Math.min(chunk.length - chunkOffset, byteCount - copiedBytes);
            chunk.copy(prefix, copiedBytes, chunkOffset, chunkOffset + bytesFromChunk);
            copiedBytes += bytesFromChunk;
            chunkOffset = 0;
            if (copiedBytes === byteCount)
                break;
        }
        return prefix;
    }
    /**
     * Consumes a complete frame from the chunk queue with one bounded copy.
     * @param {number} byteCount - Complete frame byte count.
     * @returns {Buffer} - Contiguous frame bytes.
     */
    _consumeBufferedBytes(byteCount) {
        const result = Buffer.allocUnsafe(byteCount);
        let copiedBytes = 0;
        while (copiedBytes < byteCount) {
            const chunk = this._bufferChunks[this._bufferChunkIndex];
            const bytesFromChunk = Math.min(chunk.length - this._bufferChunkOffset, byteCount - copiedBytes);
            chunk.copy(result, copiedBytes, this._bufferChunkOffset, this._bufferChunkOffset + bytesFromChunk);
            copiedBytes += bytesFromChunk;
            this._bufferChunkOffset += bytesFromChunk;
            if (this._bufferChunkOffset === chunk.length) {
                this._bufferChunkIndex += 1;
                this._bufferChunkOffset = 0;
            }
        }
        if (this._bufferChunkIndex === this._bufferChunks.length) {
            this._bufferChunks = [];
            this._bufferChunkIndex = 0;
        }
        else if (this._bufferChunkIndex >= 64 &&
            this._bufferChunkIndex * 2 >= this._bufferChunks.length) {
            this._bufferChunks = this._bufferChunks.slice(this._bufferChunkIndex);
            this._bufferChunkIndex = 0;
        }
        this._bufferedBytes -= byteCount;
        this._bufferedFrameCopyBytes += byteCount;
        return result;
    }
    /**
     * Drops all incomplete frame chunks.
     * @returns {void}
     */
    _clearBufferedFrameChunks() {
        this._bufferChunks = [];
        this._bufferChunkIndex = 0;
        this._bufferChunkOffset = 0;
        this._bufferedBytes = 0;
    }
    /**
     * Tentatively admits one complete text message before decoding it.
     * @param {number} byteLength - Exact complete raw text payload bytes.
     * @returns {InboundMessageAdmission | null} - Admission ownership, or null after overload/close.
     */
    _admitInboundMessage(byteLength) {
        if (this._inboundClosed)
            return null;
        if (this._inboundPendingMessages + 1 > this._inboundMaxPendingMessages ||
            this._inboundPendingBytes + byteLength > this._inboundMaxPendingBytes) {
            this._closeForInboundBacklog(byteLength);
            return null;
        }
        this._inboundPendingMessages += 1;
        this._inboundPendingBytes += byteLength;
        return {
            byteLength,
            generation: this._inboundAccountingGeneration,
            released: false
        };
    }
    /**
     * Releases one admission exactly once.
     * @param {InboundMessageAdmission} admission - Admission ownership.
     * @returns {void}
     */
    _releaseInboundAdmission(admission) {
        if (admission.released)
            return;
        admission.released = true;
        if (admission.generation !== this._inboundAccountingGeneration)
            return;
        this._inboundPendingMessages -= 1;
        this._inboundPendingBytes -= admission.byteLength;
    }
    /**
     * Abandons all admitted input and invalidates late settlements.
     * @returns {void}
     */
    _abandonInboundMessages() {
        this._inboundClosed = true;
        this._inboundAccountingGeneration += 1;
        this._inboundPendingBytes = 0;
        this._inboundPendingMessages = 0;
        this.messageQueue = [];
    }
    /**
     * Permanently closes a session whose next message exceeded its backlog budget.
     * @param {number} rejectedBytes - Raw payload bytes rejected at admission.
     * @returns {void}
     */
    _closeForInboundBacklog(rejectedBytes) {
        if (this._inboundBacklogOverloaded || this._inboundClosed)
            return;
        this._inboundBacklogOverloaded = true;
        this.logger.warn(() => [
            "Inbound websocket message backlog exceeded; closing connection",
            {
                maxBytes: this._inboundMaxPendingBytes,
                maxMessages: this._inboundMaxPendingMessages,
                pendingBytes: this._inboundPendingBytes,
                pendingMessages: this._inboundPendingMessages,
                rejectedBytes
            }
        ]);
        this.sendGoodbye(this.client, {
            code: WEBSOCKET_CLOSE_POLICY_VIOLATION,
            reason: WEBSOCKET_INBOUND_BACKLOG_CLOSE_REASON
        });
        this._handleClose({ allowResume: false });
    }
    /**
     * Closes after an inbound buffering limit and releases all parser-owned input.
     * @returns {void}
     */
    _closeForInboundLimit() {
        this._resetFragmentBuffer();
        this._clearBufferedFrameChunks();
        this.sendGoodbye(this.client);
        this._handleClose();
    }
    /**
     * Appends a continuation-frame payload to the in-progress
     * fragmented message. Returns true when the fragment was accepted
     * and false when the per-message cap was hit and the socket has
     * been closed.
     * @param {Buffer} payload - Continuation-frame bytes to append.
     * @returns {boolean} - Whether the fragment was accepted.
     */
    _appendFragment(payload) {
        // Guard pushing first so `_enforceFragmentLimits` sees the final
        // state; on overflow the reset inside the enforcer drops the
        // buffered fragments.
        this._fragmentedPayloads?.push(payload);
        this._fragmentedBytes += payload.length;
        return this._enforceFragmentLimits();
    }
    /**
     * Verifies the fragmented message has not exceeded the byte or
     * fragment-count caps. On overflow, clears the buffer, sends a
     * close frame, and tears the session down. Returns true when the
     * caller can continue processing, false when the session is being
     * closed.
     * @returns {boolean} - Whether fragment processing may continue.
     */
    _enforceFragmentLimits() {
        if (this._fragmentedPayloads === null)
            return true;
        const fragmentCount = this._fragmentedPayloads.length;
        const overBytes = this._fragmentedBytes > WEBSOCKET_MAX_FRAGMENTED_MESSAGE_BYTES;
        const overFragments = fragmentCount > WEBSOCKET_MAX_FRAGMENTED_MESSAGE_FRAGMENTS;
        if (!overBytes && !overFragments)
            return true;
        this.logger.warn(() => [
            "Fragmented websocket message exceeded caps; closing connection",
            {
                fragmentBytes: this._fragmentedBytes,
                fragmentCount,
                maxBytes: WEBSOCKET_MAX_FRAGMENTED_MESSAGE_BYTES,
                maxFragments: WEBSOCKET_MAX_FRAGMENTED_MESSAGE_FRAGMENTS
            }
        ]);
        this._closeForInboundLimit();
        return false;
    }
    /**
     * Runs reset fragment buffer.
     * @returns {void} */
    _resetFragmentBuffer() {
        this._fragmentedPayloads = null;
        this._fragmentedOpcode = null;
        this._fragmentedBytes = 0;
    }
    /**
     * Starts the per-session heartbeat. Each tick pings the client and
     * reaps the session if the previous ping went unanswered, so a
     * half-open socket (client gone without a TCP FIN / close frame)
     * cannot linger forever holding channel subscriptions. Disabled when
     * the configured interval is 0.
     * @returns {void}
     */
    _startHeartbeat() {
        const intervalSeconds = this.configuration.getWebsocketSessionHeartbeatSeconds();
        if (!intervalSeconds || intervalSeconds <= 0)
            return;
        this._heartbeatTimer = setInterval(() => this._heartbeatTick(), intervalSeconds * 1000);
        // Don't let the heartbeat timer keep the process alive.
        if (typeof this._heartbeatTimer.unref === "function")
            this._heartbeatTimer.unref();
    }
    /**
     * One heartbeat cycle. Reaps the session via the normal close path
     * when the previous ping was not answered; otherwise marks it
     * pending and pings again. Browsers and React Native sockets answer
     * server pings with an automatic pong, which lands in `_processBuffer`
     * and re-marks the session alive.
     * @returns {void}
     */
    _heartbeatTick() {
        if (this._paused || !this.client?.events)
            return;
        if (!this._heartbeatAlive) {
            // No frame arrived since the last ping — the socket is dead.
            // Route through `_handleClose` so resumable state still pauses
            // for the grace window and everything else is torn down.
            this._stopHeartbeat();
            this._handleClose();
            return;
        }
        this._heartbeatAlive = false;
        this._sendControlFrame(WEBSOCKET_OPCODE_PING, Buffer.alloc(0));
    }
    /**
     * Stops the per-session heartbeat timer, if any.
     * @returns {void}
     */
    _stopHeartbeat() {
        if (this._heartbeatTimer) {
            clearInterval(this._heartbeatTimer);
            this._heartbeatTimer = null;
        }
    }
    /**
     * Runs send control frame.
     * @param {number} opcode - Opcode.
     * @param {Buffer} payload - Payload data.
     * @returns {void} - No return value.
     */
    _sendControlFrame(opcode, payload) {
        const header = Buffer.alloc(2);
        header[0] = WEBSOCKET_FINAL_FRAME | opcode;
        header[1] = payload.length;
        this.client.events.emit("output", Buffer.concat([header, payload]), { websocketFrame: true });
    }
    /**
     * Runs send json.
     * @param {object} body - Request body.
     * @returns {void} - No return value.
     */
    sendJson(body) {
        // While paused (waiting for a resume), stash frames in an
        // outbound queue and flush them in order on resume. Capped to
        // prevent runaway memory use while the client is offline.
        if (this._paused) {
            this._outboundQueue ||= [];
            if (this._outboundQueue.length >= WEBSOCKET_PAUSED_QUEUE_CAP) {
                // Drop oldest so the most recent activity wins on resume.
                this._outboundQueue.shift();
            }
            this._outboundQueue.push(body);
            return;
        }
        if (!this.client?.events)
            return;
        const json = JSON.stringify(body);
        const payload = Buffer.from(json, "utf-8");
        let header;
        if (payload.length < 126) {
            header = Buffer.alloc(2);
            header[1] = payload.length;
        }
        else if (payload.length < 65536) {
            header = Buffer.alloc(4);
            header[1] = 126;
            header.writeUInt16BE(payload.length, 2);
        }
        else {
            header = Buffer.alloc(10);
            header[1] = 127;
            header.writeBigUInt64BE(BigInt(payload.length), 2);
        }
        header[0] = WEBSOCKET_FINAL_FRAME | WEBSOCKET_OPCODE_TEXT;
        this.client.events.emit("output", Buffer.concat([header, payload]), { websocketFrame: true });
    }
    /**
     * Flushes the paused outbound queue over the current socket.
     * Called during resume after `session-resumed` has been sent on
     * the NEW session's socket (not this session's).
     * @returns {void}
     */
    _flushOutboundQueue() {
        const queue = this._outboundQueue || [];
        this._outboundQueue = [];
        for (const body of queue) {
            this.sendJson(body);
        }
    }
    /**
     * Runs subscribe to channel.
     * @param {string} channel - Channel name.
     * @param {{acknowledge?: boolean, channelHandler?: import("../websocket-channel.js").default, lastEventId?: string, params?: Record<string, ReturnType<typeof JSON.parse>>, subscriptionChannel?: string}} [options] - Subscribe options.
     * @returns {Promise<boolean>} - Whether the subscription was added.
     */
    async subscribeToChannel(channel, { acknowledge = true, channelHandler, lastEventId, params, subscriptionChannel } = {}) {
        await websocketEventLogStoreForConfiguration(this.configuration).markChannelInterested(channel);
        const replayState = await this._prepareReplayState({
            channel,
            lastEventId,
            subscriptionChannel: subscriptionChannel || channel,
            subscriptionParams: params
        });
        if (replayState === false)
            return false;
        if (replayState) {
            this.channelReplayStates.set(channel, replayState);
        }
        this.addSubscription(channel);
        if (channelHandler) {
            if (!this.subscriptionHandlers.has(channel)) {
                this.subscriptionHandlers.set(channel, new Set());
            }
            this.subscriptionHandlers.get(channel)?.add(channelHandler);
            if (!this.handlerSubscriptions.has(channelHandler)) {
                this.handlerSubscriptions.set(channelHandler, new Set());
            }
            this.handlerSubscriptions.get(channelHandler)?.add(channel);
        }
        if (replayState) {
            try {
                await this._replayChannelEvents({ channel, replayState });
            }
            finally {
                await this._finishReplayState(channel, replayState);
            }
        }
        if (acknowledge) {
            this.sendJson({ channel, type: "subscribed" });
        }
        return true;
    }
    /**
     * Handles socket closure and optionally retains resumable state.
     * @param {{allowResume?: boolean}} [options] - Closure behavior.
     * @returns {void}
     */
    _handleClose({ allowResume = true } = {}) {
        this._resetFragmentBuffer();
        this._clearBufferedFrameChunks();
        this._abandonInboundMessages();
        // If the session has resumable state (live Connection or
        // ChannelV2 subscription), move it into the paused registry
        // instead of tearing down; a new socket presenting the sessionId
        // via `session-resume` within the grace window will reattach.
        const hasResumableState = this._connections.size > 0 || this._channelSubscriptions.size > 0;
        if (allowResume && hasResumableState && !this._paused) {
            // Paused sessions have no live socket to ping; the grace timer
            // owns their eventual teardown from here.
            this._stopHeartbeat();
            this._paused = true;
            this.socket = null;
            // Kick off auth-identity capture for resume verification. Runs
            // in the background — `_handleSessionResume` awaits
            // `_resumeIdentityPromise` before comparing. Pause registration
            // is synchronous so a resume arriving immediately still finds
            // the session.
            this._resumeIdentityPromise = this._captureResumeIdentity();
            void this._fireOnDisconnect();
            this.configuration._pauseWebsocketSession(this);
            this.events.emit("close");
            return;
        }
        this._stopHeartbeat();
        this._releaseOwnership();
        this.configuration._websocketSessions.delete(this);
        void this._runMessageHandlerClose();
        void this._teardownChannel();
        void this._teardownConnections("session_destroyed");
        void this._teardownChannelSubscriptions();
        this.events.emit("close");
    }
    /**
     * Called by the grace timer when the paused period expires without
     * a resume. Tears down all live Connections + Channel subs and
     * drops the session.
     * @returns {void}
     */
    _finalizeGraceExpiry() {
        this._stopHeartbeat();
        this._releaseOwnership();
        this._resetFragmentBuffer();
        this._clearBufferedFrameChunks();
        this._abandonInboundMessages();
        this.configuration._websocketSessions.delete(this);
        void this._runMessageHandlerClose();
        void this._teardownChannel();
        void this._teardownConnections("grace_expired");
        void this._teardownChannelSubscriptions();
        this.events.emit("close");
    }
    /**
     * Runs the configured identity resolver against this session.
     * The returned promise is stored at pause time and awaited at
     * resume time so we can reject resume attempts from a different
     * authenticated caller (signed out, swapped user, expired cookie).
     * @returns {Promise<ReturnType<typeof JSON.parse>>} - Captured authenticated identity for resume validation.
     */
    async _captureResumeIdentity() {
        const resolver = this.configuration.getWebsocketSessionIdentityResolver?.();
        if (typeof resolver !== "function")
            return undefined;
        try {
            return await resolver(this);
        }
        catch (caughtError) {
            const error = this._reportUnexpectedDispatchError(caughtError, {
                stage: "websocket-session-identity-pause"
            });
            this.logger.error(() => ["Websocket session identity resolver failed at pause", error]);
            return undefined;
        }
    }
    /**
     * Fires `onDisconnect` on every live Connection and Channel sub so
     * apps can pause per-instance work while the session is paused.
     * Errors are logged, not rethrown — one broken handler must not
     * block the rest.
     * @returns {Promise<void>}
     */
    async _fireOnDisconnect() {
        await this._fireLifecycleCallback("onDisconnect");
    }
    /**
     * Fires `onResume` on every live Connection and Channel sub after
     * a successful `session-resume` handoff.
     * @returns {Promise<void>}
     */
    async _fireOnResume() {
        await this._fireLifecycleCallback("onResume");
    }
    /**
     * Runs fire lifecycle callback.
     * @param {"onDisconnect" | "onResume"} callbackName Lifecycle callback to fire.
     * @returns {Promise<void>} Resolves when every live handler has been attempted.
     */
    async _fireLifecycleCallback(callbackName) {
        for (const connection of this._connections.values()) {
            try {
                await connection[callbackName]?.();
            }
            catch (caughtError) {
                const error = this._reportUnexpectedDispatchError(caughtError, {
                    callbackName,
                    connectionId: connection.connectionId,
                    stage: "websocket-connection-lifecycle"
                });
                this.logger.error(() => [`${callbackName} failed for ${connection.connectionId}`, error]);
            }
        }
        for (const { subscription } of this._channelSubscriptions.values()) {
            try {
                await subscription[callbackName]?.();
            }
            catch (caughtError) {
                const error = this._reportUnexpectedDispatchError(caughtError, {
                    callbackName,
                    stage: "websocket-channel-lifecycle",
                    subscriptionId: subscription.subscriptionId
                });
                this.logger.error(() => [`${callbackName} failed for channel sub ${subscription.subscriptionId}`, error]);
            }
        }
    }
    /**
     * Handles `{type: "session-resume"}`. This session (the newly-
     * created one whose socket just connected) transfers state from
     * the paused session and instructs the client via
     * `session-resumed` or `session-gone`.
     * @param {Record<string, ReturnType<typeof JSON.parse>>} message - Session-resume frame containing the paused session identifier.
     * @returns {Promise<void>}
     */
    async _handleSessionResume(message) {
        const resumeSessionId = message.sessionId;
        if (typeof resumeSessionId !== "string" || !resumeSessionId) {
            this.sendJson({ type: "session-gone" });
            return;
        }
        const paused = this.configuration._findPausedWebsocketSession(resumeSessionId);
        if (!paused) {
            this.sendJson({ type: "session-gone" });
            return;
        }
        // Auth re-verify: compare the fresh caller's identity against the
        // one captured at pause. Mismatch means a different user (or a
        // signed-out session) is trying to reclaim state that isn't
        // theirs — destroy the paused session outright.
        const resolver = this.configuration.getWebsocketSessionIdentityResolver?.();
        if (typeof resolver === "function") {
            const pausedIdentity = await paused._resumeIdentityPromise;
            let freshIdentity;
            try {
                freshIdentity = await resolver(this);
            }
            catch (caughtError) {
                const error = this._reportUnexpectedDispatchError(caughtError, {
                    stage: "websocket-session-identity-resume"
                });
                this.logger.error(() => ["Websocket session identity resolver failed at resume", error]);
                freshIdentity = undefined;
            }
            if (!identitiesMatch(pausedIdentity, freshIdentity)) {
                this.configuration._clearPausedWebsocketSession(resumeSessionId);
                paused._finalizeGraceExpiry();
                this.sendJson({ type: "session-gone" });
                return;
            }
        }
        this.configuration._clearPausedWebsocketSession(resumeSessionId);
        this._releaseOwnership();
        paused._releaseOwnership();
        // Transfer resumable state onto this (live) session. The paused
        // session shell is discarded after the transfer.
        for (const [connectionId, connection] of paused._connections) {
            connection.session = this;
            this._connections.set(connectionId, connection);
        }
        for (const [subId, entry] of paused._channelSubscriptions) {
            entry.subscription.session = this;
            this._channelSubscriptions.set(subId, entry);
        }
        this._metadata = { ...paused._metadata };
        this.data = paused.data;
        this.sessionId = resumeSessionId;
        // Transfer any frames queued while the paused session had no
        // socket. They flush AFTER session-resumed so the client knows
        // which session they belong to.
        const queued = paused._outboundQueue || [];
        paused._outboundQueue = [];
        paused._connections.clear();
        paused._channelSubscriptions.clear();
        paused._paused = false;
        paused.destroy();
        this._claimOwnership();
        this.sendJson({ type: "session-resumed", sessionId: resumeSessionId });
        for (const body of queued)
            this.sendJson(body);
        await this._fireOnResume();
    }
    /**
     * Fires `onClose(reason)` on every live app-defined connection, then
     * drops them from the registry. No network frame is sent — the
     * socket is already going away.
     * @param {"session_destroyed" | "grace_expired" | "error"} reason - Permanent teardown reason passed to each connection.
     * @returns {Promise<void>}
     */
    async _teardownConnections(reason) {
        const connections = [...this._connections.values()];
        this._connections.clear();
        for (const connection of connections) {
            connection._closed = true;
            try {
                await this._withConnections(async () => {
                    await connection.onClose(reason);
                });
            }
            catch (caughtError) {
                const error = this._reportUnexpectedDispatchError(caughtError, {
                    connectionId: connection.connectionId,
                    reason,
                    stage: "websocket-connection-teardown"
                });
                this.logger.error(() => [`Failed to tear down connection ${connection.connectionId}`, error]);
            }
        }
    }
    /**
     * Handles a `{type: "connection-open"}` message — instantiates the
     * registered connection class, stores it on `_connections`, and
     * fires `onConnect()`. Sends `connection-opened` on success or
     * `connection-error` on failure.
     * @param {Record<string, ReturnType<typeof JSON.parse>>} message - Connection-open frame naming the connection type and identifier.
     * @returns {Promise<void>}
     */
    async _handleConnectionOpen(message) {
        const connectionId = message.connectionId;
        const connectionType = message.connectionType;
        const params = message.params || {};
        if (typeof connectionId !== "string" || !connectionId) {
            this.sendJson({ type: "error", error: "connection-open requires connectionId" });
            return;
        }
        if (typeof connectionType !== "string" || !connectionType) {
            this.sendJson({ type: "connection-error", connectionId, message: "connectionType is required" });
            return;
        }
        if (this._connections.has(connectionId)) {
            this.sendJson({ type: "connection-error", connectionId, message: "Connection id already in use" });
            return;
        }
        const ConnectionClass = this.configuration.getWebsocketConnectionClass?.(connectionType);
        if (!ConnectionClass) {
            this.sendJson({ type: "connection-error", connectionId, message: `Unknown connection type: ${connectionType}` });
            return;
        }
        const connection = new ConnectionClass({ connectionId, params, session: this });
        try {
            await this._withConnections(async () => {
                await connection.onConnect();
            });
            // Register only after onConnect resolves so a connection-message
            // can never be routed to a partially initialized connection.
            this._connections.set(connectionId, connection);
            this.sendJson({ type: "connection-opened", connectionId });
        }
        catch (caughtError) {
            const clientErrorMessage = caughtError instanceof Error ? caughtError.message : "";
            const error = this._reportUnexpectedDispatchError(caughtError, {
                connectionId,
                connectionType,
                stage: "websocket-connection-open"
            });
            this.logger.error(() => [`Failed to open connection ${connectionType}:${connectionId}`, error]);
            this.sendJson({ type: "connection-error", connectionId, message: clientErrorMessage || "Failed to open connection" });
        }
    }
    /**
     * Handles a `{type: "connection-message"}` from the client.
     * @param {Record<string, ReturnType<typeof JSON.parse>>} message - Connection-message frame containing the target identifier and body.
     * @returns {Promise<void>}
     */
    async _handleConnectionMessage(message) {
        const connectionId = message.connectionId;
        const connection = typeof connectionId === "string" ? this._connections.get(connectionId) : null;
        if (!connection) {
            this.sendJson({ type: "connection-error", connectionId, message: "Unknown connection id" });
            return;
        }
        try {
            await this._withConnections(async () => {
                await connection.onMessage(message.body);
            });
        }
        catch (caughtError) {
            const clientErrorMessage = caughtError instanceof Error ? caughtError.message : "";
            const error = this._reportUnexpectedDispatchError(caughtError, {
                connectionId,
                stage: "websocket-connection-message"
            });
            this.logger.error(() => [`Failed to handle connection-message for ${connectionId}`, error]);
            this.sendJson({ type: "connection-error", connectionId, message: clientErrorMessage || "Failed to handle message" });
        }
    }
    /**
     * Handles a `{type: "connection-close"}` from the client — fires
     * `onClose("client_close")` and confirms with `connection-closed`.
     * @param {Record<string, ReturnType<typeof JSON.parse>>} message - Connection-close frame containing the target identifier.
     * @returns {Promise<void>}
     */
    async _handleConnectionClose(message) {
        const connectionId = message.connectionId;
        const connection = typeof connectionId === "string" ? this._connections.get(connectionId) : null;
        if (!connection)
            return;
        this._connections.delete(connectionId);
        // Mark closed before firing onClose so app code holding the
        // handle sees `isClosed() === true` and can't re-enter sendMessage.
        connection._closed = true;
        try {
            await this._withConnections(async () => {
                await connection.onClose("client_close");
            });
        }
        catch (caughtError) {
            const error = this._reportUnexpectedDispatchError(caughtError, {
                connectionId,
                stage: "websocket-connection-close"
            });
            this.logger.error(() => [`Failed to tear down connection ${connectionId}`, error]);
        }
        this.sendJson({ type: "connection-closed", connectionId, reason: "client_close" });
    }
    /**
     * Handles `{type: "channel-subscribe"}` — runs `canSubscribe()`,
     * registers with the Configuration's global routing registry on
     * success, and sends `channel-subscribed` or `channel-error`.
     * @param {Record<string, ReturnType<typeof JSON.parse>>} message - Channel-subscribe frame describing the requested subscription.
     * @returns {Promise<void>}
     */
    async _handleChannelSubscribe(message) {
        const subscriptionId = message.subscriptionId;
        const channelType = message.channelType;
        const params = message.params || {};
        const lastEventId = message.lastEventId;
        if (typeof subscriptionId !== "string" || !subscriptionId) {
            this.sendJson({ type: "error", error: "channel-subscribe requires subscriptionId" });
            return;
        }
        if (typeof channelType !== "string" || !channelType) {
            this.sendJson({ type: "channel-error", subscriptionId, message: "channelType is required" });
            return;
        }
        if (this._channelSubscriptions.has(subscriptionId)) {
            this.sendJson({ type: "channel-error", subscriptionId, message: "Subscription id already in use" });
            return;
        }
        const ChannelClass = this.configuration.getWebsocketChannelClass?.(channelType);
        if (!ChannelClass) {
            this.sendJson({ type: "channel-error", subscriptionId, message: `Unknown channel type: ${channelType}` });
            return;
        }
        const subscription = new ChannelClass({ subscriptionId, params, session: this });
        try {
            // Resolving the tenant can run database queries (e.g. looking up the
            // record's project and the caller's access), so it must happen inside a
            // connection scope. Without this the resolver borrows a connection that
            // is checked back in before/while it queries, intermittently surfacing as
            // "Connection … doesn't exist any more" or a falsely unauthorized
            // subscription.
            let tenant;
            await this._withConnections(async () => {
                tenant = await this._resolveTenant({ channel: channelType, params });
            });
            await this.configuration.runWithTenant(tenant, async () => {
                let allowed = false;
                await this._withConnections(async () => {
                    allowed = Boolean(await subscription.canSubscribe());
                });
                if (!allowed) {
                    this.sendJson({ type: "channel-error", subscriptionId, message: "Subscription not authorized" });
                    return;
                }
                this._channelSubscriptions.set(subscriptionId, { channelType, subscription });
                this.configuration._registerWebsocketChannelSubscription(channelType, subscription);
                await this._withConnections(async () => await subscription.subscribed());
                // Replay missed events BEFORE sending channel-subscribed so
                // the client knows: everything before the confirmation is
                // replayed, everything after is live.
                if (typeof lastEventId === "string" && lastEventId.length > 0) {
                    await this._replayChannelEventsForSubscription({ channelType, lastEventId, subscription });
                }
                this.sendJson({ type: "channel-subscribed", subscriptionId });
            });
        }
        catch (caughtError) {
            const clientErrorMessage = caughtError instanceof Error ? caughtError.message : "";
            this._channelSubscriptions.delete(subscriptionId);
            this.configuration._unregisterWebsocketChannelSubscription(channelType, subscription);
            const error = this._reportUnexpectedDispatchError(caughtError, {
                channelType,
                stage: "websocket-channel-subscribe",
                subscriptionId
            });
            this.logger.error(() => [`Failed to subscribe channel ${channelType}:${subscriptionId}`, error]);
            this.sendJson({ type: "channel-error", subscriptionId, message: clientErrorMessage || "Failed to subscribe" });
        }
    }
    /**
     * Replays missed events from the persistent event-log store for a
     * channel subscription that provided `lastEventId`. Sends each
     * missed event as a `channel-message` with `replayed: true`.
     * @param {object} args - Options.
     * @param {string} args.channelType - Channel type name (event-log key).
     * @param {string} args.lastEventId - Client's last-seen event id.
     * @param {import("../websocket-channel.js").default} args.subscription - Live subscription.
     * @returns {Promise<void>}
     */
    async _replayChannelEventsForSubscription({ channelType, lastEventId, subscription }) {
        const store = websocketEventLogStoreForConfiguration(this.configuration);
        await this.configuration.awaitPendingBroadcasts();
        const checkpoint = await store.getEventById({ channel: channelType, id: lastEventId });
        if (!checkpoint) {
            this.sendJson({
                type: "channel-replay-gap",
                subscriptionId: subscription.subscriptionId,
                lastEventId
            });
            return;
        }
        const ceiling = await store.latestSequence(channelType);
        if (!ceiling || ceiling <= checkpoint.sequence)
            return;
        const events = await store.getEventsAfter({
            channel: channelType,
            sequence: checkpoint.sequence,
            upToSequence: ceiling
        });
        for (const event of events) {
            if (subscription.isClosed())
                break;
            if (await subscription._requiresReplayGap(event.payload)) {
                this.sendJson({
                    type: "channel-replay-gap",
                    subscriptionId: subscription.subscriptionId,
                    lastEventId
                });
                return;
            }
            await subscription.deliverBroadcast(
            /** @type {import("../websocket-channel.js").WebsocketJsonValue} */ (event.payload), { eventId: event.id });
        }
    }
    /**
     * Handles `{type: "channel-unsubscribe"}` from the client — calls
     * `unsubscribed()` and sends `channel-unsubscribed`.
     * @param {Record<string, ReturnType<typeof JSON.parse>>} message - Channel-unsubscribe frame containing the subscription identifier.
     * @returns {Promise<void>}
     */
    async _handleChannelUnsubscribe(message) {
        const subscriptionId = message.subscriptionId;
        if (typeof subscriptionId !== "string")
            return;
        const entry = this._channelSubscriptions.get(subscriptionId);
        if (!entry)
            return;
        this._channelSubscriptions.delete(subscriptionId);
        this.configuration._unregisterWebsocketChannelSubscription(entry.channelType, entry.subscription);
        entry.subscription._closed = true;
        try {
            await this._withConnections(async () => await entry.subscription.unsubscribed());
        }
        catch (caughtError) {
            const error = this._reportUnexpectedDispatchError(caughtError, {
                channelType: entry.channelType,
                stage: "websocket-channel-unsubscribe",
                subscriptionId
            });
            this.logger.error(() => [`Failed to unsubscribe channel ${entry.channelType}:${subscriptionId}`, error]);
        }
        this.sendJson({ type: "channel-unsubscribed", subscriptionId });
    }
    /**
     * Fires `unsubscribed()` on every live channel-v2 subscription,
     * removes them from the Configuration's global registry, and
     * drops the session's own map. No network frames — the socket
     * is already going away.
     * @returns {Promise<void>}
     */
    async _teardownChannelSubscriptions() {
        const entries = [...this._channelSubscriptions.values()];
        this._channelSubscriptions.clear();
        for (const { channelType, subscription } of entries) {
            this.configuration._unregisterWebsocketChannelSubscription(channelType, subscription);
            subscription._closed = true;
            try {
                await this._withConnections(async () => await subscription.unsubscribed());
            }
            catch (caughtError) {
                const error = this._reportUnexpectedDispatchError(caughtError, {
                    channelType,
                    stage: "websocket-channel-teardown",
                    subscriptionId: subscription.subscriptionId
                });
                this.logger.error(() => [`Failed to tear down channel-v2 ${channelType}:${subscription.subscriptionId}`, error]);
            }
        }
    }
    async _teardownChannel() {
        for (const channel of this.channels) {
            await this._teardownSingleChannel(channel);
        }
        this.channels.clear();
        this.channelReplayStates.clear();
    }
    /**
     * Runs teardown single channel.
     * @param {WebsocketChannel} channel - Channel instance.
     * @returns {Promise<void>} - Resolves when complete.
     */
    async _teardownSingleChannel(channel) {
        try {
            const tenant = this.channelTenants.get(channel);
            await this.configuration.runWithTenant(tenant, async () => {
                await this._withConnections(async () => {
                    await channel?.unsubscribed?.();
                });
            });
        }
        catch (caughtError) {
            const error = this._reportUnexpectedDispatchError(caughtError, {
                stage: "websocket-channel-teardown"
            });
            this.logger.error(() => ["Failed to teardown websocket channel", error]);
        }
        const subscriptions = this.handlerSubscriptions.get(channel);
        if (subscriptions) {
            for (const subscriptionChannel of subscriptions) {
                this.subscriptionHandlers.get(subscriptionChannel)?.delete(channel);
                if (this.subscriptionHandlers.get(subscriptionChannel)?.size === 0) {
                    this.subscriptionHandlers.delete(subscriptionChannel);
                }
            }
            this.handlerSubscriptions.delete(channel);
        }
        this.channelTenants.delete(channel);
    }
    /**
     * Runs register channel.
     * @param {WebsocketChannel | undefined} channel - Channel instance.
     * @param {string | null | undefined} tenant - Tenant key.
     * @returns {Promise<void>} - Resolves when complete.
     */
    async _registerChannel(channel, tenant) {
        if (!channel)
            return;
        this.channels.add(channel);
        this.channelTenants.set(channel, tenant);
        await this.configuration.runWithTenant(tenant, async () => {
            await this._withConnections(async () => {
                await channel?.subscribed?.();
            });
        });
    }
    /**
     * Runs with connections.
     * @param {() => Promise<void>} callback - Callback.
     * @returns {Promise<void>} - Resolves when complete.
     */
    async _withConnections(callback) {
        await this.configuration.ensureConnections({ name: "Websocket session" }, async () => {
            await callback();
        });
    }
    /**
     * Runs handle channel subscription.
     * @param {{channel: string, lastEventId?: string, params?: Record<string, ReturnType<typeof JSON.parse>>}} args - Subscription args.
     * @returns {Promise<void>} - Resolves when complete.
     */
    async _handleChannelSubscription({ channel, lastEventId, params }) {
        const resolver = this.configuration.getWebsocketChannelResolver?.();
        if (!resolver)
            return;
        try {
            // Tenant resolution can run database queries, so it must happen inside a
            // connection scope (see _handleChannelSubscribe).
            let tenant;
            await this._withConnections(async () => {
                tenant = await this._resolveTenant({ channel, params });
            });
            const resolved = await this.configuration.runWithTenant(tenant, async () => {
                return await resolver({
                    client: this.client,
                    configuration: this.configuration,
                    request: this.upgradeRequest,
                    subscription: { channel, params },
                    websocketSession: this
                });
            });
            if (!resolved) {
                this.sendJson({ channel, error: "Subscription rejected", type: "error" });
                return;
            }
            const channelInstance = typeof resolved === "function"
                ? new resolved({
                    client: this.client,
                    configuration: this.configuration,
                    lastEventId,
                    request: this.upgradeRequest,
                    subscriptionChannel: channel,
                    subscriptionParams: params,
                    websocketSession: this
                })
                : resolved;
            if (channelInstance && !(channelInstance instanceof WebsocketChannel)) {
                throw new Error("Resolved websocket channel must extend WebsocketChannel");
            }
            await this._registerChannel(channelInstance, tenant);
        }
        catch (caughtError) {
            const error = this._reportUnexpectedDispatchError(caughtError, {
                channel,
                stage: "websocket-channel-subscription"
            });
            this.logger.warn(() => ["Websocket channel subscription failed", error]);
            this.sendJson({ channel, error: "Subscription rejected", type: "error" });
        }
    }
    /**
     * Runs prepare replay state.
     * @param {object} args - Options.
     * @param {string} args.channel - Internal channel name.
     * @param {string | undefined} args.lastEventId - Last received event id.
     * @param {string} args.subscriptionChannel - Client-facing channel name.
     * @param {Record<string, ReturnType<typeof JSON.parse>> | undefined} args.subscriptionParams - Client-facing params.
     * @returns {Promise<false | {buffered: boolean, ceilingSequence: number, checkpointSequence: number, replaying: boolean} | null>} - Replay state.
     */
    async _prepareReplayState({ channel, lastEventId, subscriptionChannel, subscriptionParams }) {
        if (!lastEventId)
            return null;
        const store = websocketEventLogStoreForConfiguration(this.configuration);
        const checkpoint = await store.getEventById({ channel, id: lastEventId });
        if (!checkpoint) {
            this.sendJson({ channel: subscriptionChannel, lastEventId, params: subscriptionParams, type: "replay-gap" });
            return false;
        }
        return {
            buffered: false,
            ceilingSequence: (await store.latestSequence(channel)) || checkpoint.sequence,
            checkpointSequence: checkpoint.sequence,
            replaying: true
        };
    }
    /**
     * Runs replay channel events.
     * @param {object} args - Options.
     * @param {string} args.channel - Channel name.
     * @param {{buffered: boolean, ceilingSequence: number, checkpointSequence: number, replaying: boolean}} args.replayState - Replay state.
     * @returns {Promise<void>} - Resolves when replay completes.
     */
    async _replayChannelEvents({ channel, replayState }) {
        const store = websocketEventLogStoreForConfiguration(this.configuration);
        const events = await store.getEventsAfter({
            channel,
            sequence: replayState.checkpointSequence,
            upToSequence: replayState.ceilingSequence
        });
        for (const event of events) {
            await this.sendEvent(channel, event.payload, {
                createdAt: event.createdAt,
                eventId: event.id,
                replayed: true,
                sequence: event.sequence
            });
        }
    }
    /**
     * Runs finish replay state.
     * @param {string} channel - Channel name.
     * @param {{buffered: boolean, ceilingSequence: number, checkpointSequence: number, replaying: boolean}} replayState - Replay state.
     * @returns {Promise<void>} - Resolves when buffered events are flushed.
     */
    async _finishReplayState(channel, replayState) {
        const store = websocketEventLogStoreForConfiguration(this.configuration);
        replayState.replaying = false;
        this.channelReplayStates.delete(channel);
        if (!replayState.buffered)
            return;
        const liveEvents = await store.getEventsAfter({
            channel,
            sequence: replayState.ceilingSequence
        });
        for (const event of liveEvents) {
            await this.sendEvent(channel, event.payload, {
                createdAt: event.createdAt,
                eventId: event.id,
                sequence: event.sequence
            });
        }
    }
    /**
     * Runs resolve tenant.
     * @param {{channel?: string, params?: Record<string, ReturnType<typeof JSON.parse>>}} args - Tenant resolution args.
     * @returns {Promise<string | null | undefined>} - Resolved tenant.
     */
    async _resolveTenant({ channel, params }) {
        const requestParams = this.upgradeRequest?.params?.();
        const mergedParams = {
            ...(requestParams && typeof requestParams === "object" ? requestParams : {}),
            ...(params && typeof params === "object" ? params : {})
        };
        return /** @type {Promise<string | null | undefined>} */ (this.configuration.resolveTenant({
            params: mergedParams,
            request: this.upgradeRequest,
            response: undefined,
            subscription: channel ? { channel, params } : undefined
        }));
    }
    /**
     * Runs unmask payload.
     * @param {Buffer} payload - Payload data.
     * @param {Buffer} mask - Mask.
     * @returns {void} - No return value.
     */
    _unmaskPayload(payload, mask) {
        for (let i = 0; i < payload.length; i++) {
            payload[i] ^= mask[i % 4];
        }
    }
    async _runMessageHandlerOpen() {
        try {
            const handler = this.messageHandler;
            const onOpen = handler ? handler.onOpen : null;
            if (onOpen) {
                await onOpen({ session: this });
            }
        }
        catch (caughtError) {
            const error = this._reportUnexpectedDispatchError(caughtError, {
                stage: "websocket-message-handler-open"
            });
            this.logger.error(() => ["Websocket open handler failed", error]);
        }
    }
    /**
     * Runs run message handler message.
     * @param {WebsocketSessionMessage} message - Incoming websocket message.
     * @returns {Promise<void>} - Resolves when complete.
     */
    async _runMessageHandlerMessage(message) {
        try {
            const handler = this.messageHandler;
            const onMessage = handler ? handler.onMessage : null;
            if (onMessage) {
                await onMessage({ message, session: this });
            }
        }
        catch (caughtError) {
            const handler = this.messageHandler;
            const onError = handler ? handler.onError : null;
            const handlerError = ensureError(caughtError);
            const error = this._reportUnexpectedDispatchError(handlerError, {
                stage: "websocket-message-handler"
            });
            this.logger.error(() => ["Websocket message handler failed", error]);
            if (!onError)
                return;
            try {
                await onError({ error: handlerError, session: this });
            }
            catch (onErrorCaughtError) {
                const clientErrorMessage = onErrorCaughtError instanceof Error
                    ? onErrorCaughtError.message
                    : String(onErrorCaughtError);
                const onErrorError = this._reportUnexpectedDispatchError(onErrorCaughtError, {
                    stage: "websocket-message-handler-error"
                });
                this.logger.error(() => ["Websocket message error handler failed", onErrorError]);
                this.sendJson({
                    error: clientErrorMessage,
                    type: "error"
                });
            }
        }
    }
    async _runMessageHandlerClose() {
        try {
            const handler = this.messageHandler;
            const onClose = handler ? handler.onClose : null;
            if (onClose) {
                await onClose({ session: this });
            }
        }
        catch (caughtError) {
            const error = this._reportUnexpectedDispatchError(caughtError, {
                stage: "websocket-message-handler-close"
            });
            this.logger.error(() => ["Websocket close handler failed", error]);
        }
    }
    /**
     * Runs remote address.
     * @returns {string | undefined} - Remote address resolved from the websocket upgrade request.
     */
    remoteAddress() {
        return this.upgradeRequest?.remoteAddress() || this.client.remoteAddress;
    }
    /**
     * Runs set message handler.
     * @param {import("../../configuration-types.js").WebsocketMessageHandler} handler - Handler instance.
     * @returns {void}
     */
    setMessageHandler(handler) {
        this.messageHandler = handler;
        void this._runMessageHandlerOpen();
    }
    async _resolveMessageHandlerPromise() {
        if (!this.messageHandlerPromise)
            return;
        /** @type {import("../../configuration-types.js").WebsocketMessageHandler | void} */
        let handler;
        try {
            handler = await this.messageHandlerPromise;
        }
        catch (caughtError) {
            const error = this._reportUnexpectedDispatchError(caughtError, {
                stage: "websocket-message-handler-resolver"
            });
            this.logger.error(() => ["Websocket message handler resolver failed", error]);
            this.messageHandlerPromise = undefined;
            await this._finishMessageHandlerResolution({ useHandler: false });
            return;
        }
        this.messageHandlerPromise = undefined;
        if (!handler) {
            await this._finishMessageHandlerResolution({ useHandler: false });
            return;
        }
        if (this._inboundClosed) {
            this.pendingMessageHandler = false;
            return;
        }
        // Install handler and drain onOpen before replaying queued
        // messages. setMessageHandler() fires onOpen as fire-and-forget;
        // awaiting _runMessageHandlerOpen() directly here closes the
        // race where queued subscribe/connection-* frames would
        // dispatch while an async onOpen is still setting up session
        // state.
        this.messageHandler = handler;
        await this._runMessageHandlerOpen();
        await this._finishMessageHandlerResolution({
            useHandler: typeof handler.onMessage === "function"
        });
    }
    /**
     * Inserts resolver completion into the FIFO chain before allowing new dispatch.
     * @param {{useHandler: boolean}} args - Resolver result.
     * @returns {Promise<void>} - Resolves after queued messages drain.
     */
    async _finishMessageHandlerResolution({ useHandler }) {
        const previous = this._messageChain;
        const drain = previous.then(async () => {
            this.pendingMessageHandler = false;
            if (this._inboundClosed) {
                this.messageQueue = [];
                return;
            }
            await this._flushQueuedMessages({ useHandler });
        });
        this._messageChain = drain.catch(() => { });
        await drain;
    }
    /**
     * Runs flush queued messages.
     * @param {{useHandler: boolean}} args - Args.
     * @returns {Promise<void>} - Resolves when complete.
     */
    async _flushQueuedMessages({ useHandler }) {
        if (this.messageQueue.length === 0)
            return;
        const queued = this.messageQueue;
        this.messageQueue = [];
        for (const work of queued) {
            if (this._inboundClosed) {
                this._releaseInboundAdmission(work.admission);
                continue;
            }
            try {
                if (useHandler && this.messageHandler) {
                    await this._runWithMessageLogContext(work.message, async () => {
                        await this._runMessageHandlerMessage(work.message);
                    });
                }
                else {
                    await this._dispatchMessage(work.message);
                }
            }
            catch (caughtError) {
                const clientErrorMessage = caughtError instanceof Error ? caughtError.message : String(caughtError);
                const error = this._reportUnexpectedDispatchError(caughtError, {
                    stage: "websocket-message-dispatch"
                });
                this.logger.error(() => ["Websocket message handler failed", error]);
                this.sendJson({
                    error: clientErrorMessage,
                    type: "error"
                });
            }
            finally {
                this._releaseInboundAdmission(work.admission);
            }
        }
    }
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoid2Vic29ja2V0LXNlc3Npb24uanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi8uLi9zcmMvaHR0cC1zZXJ2ZXIvY2xpZW50L3dlYnNvY2tldC1zZXNzaW9uLmpzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiJBQUFBLFlBQVk7QUFFWixPQUFPLEVBQUUsVUFBVSxFQUFFLE1BQU0sYUFBYSxDQUFBO0FBQ3hDLE9BQU8sRUFBRSxXQUFXLEVBQUUsTUFBTSxTQUFTLENBQUE7QUFFckMsT0FBTyxFQUFFLGVBQWUsRUFBRSxNQUFNLGdDQUFnQyxDQUFBO0FBQ2hFLE9BQU8sTUFBTSxNQUFNLGlCQUFpQixDQUFBO0FBQ3BDLE9BQU8sWUFBWSxNQUFNLDhCQUE4QixDQUFBO0FBQ3ZELE9BQU8sYUFBYSxNQUFNLDZCQUE2QixDQUFBO0FBQ3ZELE9BQU8sY0FBYyxNQUFNLDBCQUEwQixDQUFBO0FBQ3JELE9BQU8sZ0JBQWdCLE1BQU0seUJBQXlCLENBQUE7QUFDdEQsT0FBTyxFQUFFLHNDQUFzQyxFQUFFLE1BQU0saUNBQWlDLENBQUE7QUFDeEYsT0FBTyxhQUFhLE1BQU0scUJBQXFCLENBQUE7QUFDL0MsT0FBTyxhQUFhLE1BQU0scUJBQXFCLENBQUE7QUFDL0MsT0FBTyxnQkFBZ0IsTUFBTSx3QkFBd0IsQ0FBQTtBQUVyRDs7O0dBR0c7QUFFSDs7Ozs7R0FLRztBQUVIOzs7O0dBSUc7QUFFSCxNQUFNLHFCQUFxQixHQUFHLElBQUksQ0FBQTtBQUNsQyxNQUFNLDZCQUE2QixHQUFHLEdBQUcsQ0FBQTtBQUN6QyxNQUFNLHFCQUFxQixHQUFHLEdBQUcsQ0FBQTtBQUNqQyxNQUFNLHVCQUF1QixHQUFHLEdBQUcsQ0FBQTtBQUNuQyxNQUFNLHNCQUFzQixHQUFHLEdBQUcsQ0FBQTtBQUNsQyxNQUFNLHFCQUFxQixHQUFHLEdBQUcsQ0FBQTtBQUNqQyxNQUFNLHFCQUFxQixHQUFHLEdBQUcsQ0FBQTtBQUVqQyxNQUFNLHNCQUFzQixHQUFHLElBQUksQ0FB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RUFBRSxDQUFDO2dCQUNyQixNQUFNLGtCQUFrQixHQUFHLFdBQVcsWUFBWSxLQUFLLENBQUMsQ0FBQyxDQUFDLFdBQVcsQ0FBQyxPQUFPLENBQUMsQ0FBQyxDQUFDLE1BQU0sQ0FBQyxXQUFXLENBQUMsQ0FBQTtnQkFDbkcsTUFBTSxLQUFLLEdBQUcsSUFBSSxDQUFDLDhCQUE4QixDQUFDLFdBQVcsRUFBRTtvQkFDN0QsS0FBSyxFQUFFLDRCQUE0QjtpQkFDcEMsQ0FBQyxDQUFBO2dCQUVGLElBQUksQ0FBQyxNQUFNLENBQUMsS0FBSyxDQUFDLEdBQUcsRUFBRSxDQUFDLENBQUMsa0NBQWtDLEVBQUUsS0FBSyxDQUFDLENBQUMsQ0FBQTtnQkFDcEUsSUFBSSxDQUFDLFFBQVEsQ0FBQztvQkFDWixLQUFLLEVBQUUsa0JBQWtCO29CQUN6QixJQUFJLEVBQUUsT0FBTztpQkFDZCxDQUFDLENBQUE7WUFDSixDQUFDO29CQUFTLENBQUM7Z0JBQ1QsSUFBSSxDQUFDLHdCQUF3QixDQUFDLElBQUksQ0FBQyxTQUFTLENBQUMsQ0FBQTtZQUMvQyxDQUFDO1FBQ0gsQ0FBQztJQUNILENBQUM7Q0FDRiIsInNvdXJjZXNDb250ZW50IjpbIi8vIEB0cy1jaGVja1xuXG5pbXBvcnQgeyByYW5kb21VVUlEIH0gZnJvbSBcIm5vZGU6Y3J5cHRvXCJcbmltcG9ydCB7IGVuc3VyZUVycm9yIH0gZnJvbSBcInR5cGFuaWNcIlxuXG5pbXBvcnQgeyBWYWxpZGF0aW9uRXJyb3IgfSBmcm9tIFwiLi4vLi4vZGF0YWJhc2UvcmVjb3JkL2luZGV4LmpzXCJcbmltcG9ydCBMb2dnZXIgZnJvbSBcIi4uLy4uL2xvZ2dlci5qc1wiXG5pbXBvcnQgRXZlbnRFbWl0dGVyIGZyb20gXCIuLi8uLi91dGlscy9ldmVudC1lbWl0dGVyLmpzXCJcbmltcG9ydCBpc1BsYWluT2JqZWN0IGZyb20gXCIuLi8uLi91dGlscy9wbGFpbi1vYmplY3QuanNcIlxuaW1wb3J0IFZlbG9jaW91c0Vycm9yIGZyb20gXCIuLi8uLi92ZWxvY2lvdXMtZXJyb3IuanNcIlxuaW1wb3J0IFdlYnNvY2tldENoYW5uZWwgZnJvbSBcIi4uL3dlYnNvY2tldC1jaGFubmVsLmpzXCJcbmltcG9ydCB7IHdlYnNvY2tldEV2ZW50TG9nU3RvcmVGb3JDb25maWd1cmF0aW9uIH0gZnJvbSBcIi4uL3dlYnNvY2tldC1ldmVudC1sb2ctc3RvcmUuanNcIlxuaW1wb3J0IFJlcXVlc3RSdW5uZXIgZnJvbSBcIi4vcmVxdWVzdC1ydW5uZXIuanNcIlxuaW1wb3J0IFJlcXVlc3RUaW1pbmcgZnJvbSBcIi4vcmVxdWVzdC10aW1pbmcuanNcIlxuaW1wb3J0IFdlYnNvY2tldFJlcXVlc3QgZnJvbSBcIi4vd2Vic29ja2V0LXJlcXVlc3QuanNcIlxuXG4vKipcbiAqIERlZmluZXMgdGhpcyB0eXBlZGVmLlxuICogQHR5cGVkZWYge3t0eXBlOiBcInN1YnNjcmliZVwiLCBjaGFubmVsOiBzdHJpbmcsIGxhc3RFdmVudElkPzogc3RyaW5nLCBwYXJhbXM/OiBSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59IHwge3R5cGU6IFwibWV0YWRhdGFcIiwgZGF0YT86IFJlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gfCB7dHlwZT86IFwicmVxdWVzdFwiLCBib2R5PzogUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4sIGhlYWRlcnM/OiBSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj4sIGlkPzogc3RyaW5nIHwgbnVtYmVyIHwgbnVsbCwgbWV0aG9kOiBzdHJpbmcsIHBhdGg6IHN0cmluZ30gfCBSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59IFdlYnNvY2tldFNlc3Npb25NZXNzYWdlXG4gKi9cblxuLyoqXG4gKiBAdHlwZWRlZiB7b2JqZWN0fSBJbmJvdW5kTWVzc2FnZUFkbWlzc2lvblxuICogQHByb3BlcnR5IHtudW1iZXJ9IGJ5dGVMZW5ndGggLSBFeGFjdCByYXcgdGV4dCBwYXlsb2FkIGJ5dGVzIGNoYXJnZWQgdG8gdGhpcyBhZG1pc3Npb24uXG4gKiBAcHJvcGVydHkge251bWJlcn0gZ2VuZXJhdGlvbiAtIEFjY291bnRpbmcgZ2VuZXJhdGlvbiBhY3RpdmUgd2hlbiBhZG1pdHRlZC5cbiAqIEBwcm9wZXJ0eSB7Ym9vbGVhbn0gcmVsZWFzZWQgLSBXaGV0aGVyIHRoaXMgYWRtaXNzaW9uIGhhcyBhbHJlYWR5IGJlZW4gcmVsZWFzZWQuXG4gKi9cblxuLyoqXG4gKiBAdHlwZWRlZiB7b2JqZWN0fSBJbmJvdW5kTWVzc2FnZVdvcmtcbiAqIEBwcm9wZXJ0eSB7SW5ib3VuZE1lc3NhZ2VBZG1pc3Npb259IGFkbWlzc2lvbiAtIEFkbWlzc2lvbiBvd25lcnNoaXAuXG4gKiBAcHJvcGVydHkge1dlYnNvY2tldFNlc3Npb25NZXNzYWdlfSBtZXNzYWdlIC0gRGVjb2RlZCBjbGllbnQgbWVzc2FnZS5cbiAqL1xuXG5jb25zdCBXRUJTT0NLRVRfRklOQUxfRlJBTUUgPSAweDgwXG5jb25zdCBXRUJTT0NLRVRfT1BDT0RFX0NPTlRJTlVBVElPTiA9IDB4MFxuY29uc3QgV0VCU09DS0VUX09QQ09ERV9URVhUID0gMHgxXG5jb25zdCBXRUJTT0NLRVRfT1BDT0RFX0JJTkFSWSA9IDB4MlxuY29uc3QgV0VCU09DS0VUX09QQ09ERV9DTE9TRSA9IDB4OFxuY29uc3QgV0VCU09DS0VUX09QQ09ERV9QSU5HID0gMHg5XG5jb25zdCBXRUJTT0NLRVRfT1BDT0RFX1BPTkcgPSAweEFcblxuY29uc3QgV0VCU09DS0VUX0NMT1NFX05PUk1BTCA9IDEwMDBcbmNvbnN0IFdFQlNPQ0tFVF9DTE9TRV9QT0xJQ1lfVklPTEFUSU9OID0gMTAwOFxuY29uc3QgV0VCU09DS0VUX0lOQk9VTkRfQkFDS0xPR19DTE9TRV9SRUFTT04gPSBcIkluYm91bmQgbWVzc2FnZSBiYWNrbG9nIGV4Y2VlZGVkXCJcbmNvbnN0IFdFQlNPQ0tFVF9NQVhfQ0xPU0VfUkVBU09OX0JZVEVTID0gMTIzXG5cbi8qKiBDYXAgb24gdGhlIHBhdXNlZCBvdXRib3VuZCBxdWV1ZTsgb2xkZXN0IGZyYW1lcyBkcm9wIG9uIG92ZXJmbG93LiAqL1xuY29uc3QgV0VCU09DS0VUX1BBVVNFRF9RVUVVRV9DQVAgPSAxMDAwXG5cbi8qKiBDYXAgb24gdG90YWwgYnl0ZXMgYnVmZmVyZWQgZm9yIGEgc2luZ2xlIGZyYWdtZW50ZWQgbWVzc2FnZS4gKi9cbmNvbnN0IFdFQlNPQ0tFVF9NQVhfRlJBR01FTlRFRF9NRVNTQUdFX0JZVEVTID0gMTYgKiAxMDI0ICogMTAyNFxuXG4vKiogQ2FwIG9uIHBheWxvYWQgYnl0ZXMgYnVmZmVyZWQgZm9yIGEgc2luZ2xlIGZpbmFsIGRhdGEgZnJhbWUuICovXG5jb25zdCBXRUJTT0NLRVRfTUFYX0ZJTkFMX0ZSQU1FX0JZVEVTID0gV0VCU09DS0VUX01BWF9GUkFHTUVOVEVEX01FU1NBR0VfQllURVNcblxuY29uc3QgV0VCU09DS0VUX01BWF9JTkJPVU5EX0ZSQU1FX0JZVEVTX0JJR0lOVCA9IEJpZ0ludChXRUJTT0NLRVRfTUFYX0ZJTkFMX0ZSQU1FX0JZVEVTKVxuXG4vKiogQ2FwIG9uIGZyYWdtZW50IGNvdW50IGZvciBhIHNpbmdsZSBmcmFnbWVudGVkIG1lc3NhZ2UuICovXG5jb25zdCBXRUJTT0NLRVRfTUFYX0ZSQUdNRU5URURfTUVTU0FHRV9GUkFHTUVOVFMgPSAxMDI0XG5cbi8qKlxuICogUnVucyBzdWJzY3JpYmUgbWVzc2FnZS5cbiAqIEBwYXJhbSB7V2Vic29ja2V0U2Vzc2lvbk1lc3NhZ2V9IG1lc3NhZ2UgLSBSYXcgd2Vic29ja2V0IG1lc3NhZ2UuXG4gKiBAcmV0dXJucyB7e3R5cGU6IFwic3Vic2NyaWJlXCIsIGNoYW5uZWw6IHN0cmluZywgbGFzdEV2ZW50SWQ/OiBzdHJpbmcsIHBhcmFtcz86IFJlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gfCBudWxsfSAtIFN1YnNjcmliZSBtZXNzYWdlIHdoZW4gbWF0Y2hlZC5cbiAqL1xuZnVuY3Rpb24gc3Vic2NyaWJlTWVzc2FnZShtZXNzYWdlKSB7XG4gIHJldHVybiBtZXNzYWdlLnR5cGUgPT09IFwic3Vic2NyaWJlXCJcbiAgICA/IC8qKiBAdHlwZSB7e3R5cGU6IFwic3Vic2NyaWJlXCIsIGNoYW5uZWw6IHN0cmluZywgbGFzdEV2ZW50SWQ/OiBzdHJpbmcsIHBhcmFtcz86IFJlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn19ICovIChtZXNzYWdlKVxuICAgIDogbnVsbFxufVxuXG4vKipcbiAqIFJ1bnMgcmVxdWVzdCBtZXNzYWdlLlxuICogQHBhcmFtIHtXZWJzb2NrZXRTZXNzaW9uTWVzc2FnZX0gbWVzc2FnZSAtIFJhdyB3ZWJzb2NrZXQgbWVzc2FnZS5cbiAqIEByZXR1cm5zIHt7dHlwZT86IFwicmVxdWVzdFwiLCBib2R5PzogUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4sIGhlYWRlcnM/OiBSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj4sIGlkPzogc3RyaW5nIHwgbnVtYmVyIHwgbnVsbCwgbWV0aG9kOiBzdHJpbmcsIHBhdGg6IHN0cmluZ30gfCBudWxsfSAtIFJlcXVlc3QgbWVzc2FnZSB3aGVuIG1hdGNoZWQuXG4gKi9cbmZ1bmN0aW9uIHJlcXVlc3RNZXNzYWdlKG1lc3NhZ2UpIHtcbiAgaWYgKG1lc3NhZ2UudHlwZSAmJiBtZXNzYWdlLnR5cGUgIT09IFwicmVxdWVzdFwiKSByZXR1cm4gbnVsbFxuXG4gIHJldHVybiAvKiogQHR5cGUge3t0eXBlPzogXCJyZXF1ZXN0XCIsIGJvZHk/OiBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPiwgaGVhZGVycz86IFJlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+PiwgaWQ/OiBzdHJpbmcgfCBudW1iZXIgfCBudWxsLCBtZXRob2Q6IHN0cmluZywgcGF0aDogc3RyaW5nfX0gKi8gKG1lc3NhZ2UpXG59XG5cbi8qKlxuICogQ29tcGFyZXMgdHdvIGlkZW50aXR5IHZhbHVlcyBmcm9tIGBnZXRXZWJzb2NrZXRTZXNzaW9uSWRlbnRpdHlSZXNvbHZlcmAuXG4gKiBOdWxsaXNoIHZhbHVlcyBjb21wYXJlIGVxdWFsIHRvIGVhY2ggb3RoZXIgYnV0IG5vdCB0byBhIHJlYWwgaWRlbnRpdHkuXG4gKiBQbGFpbiBvYmplY3RzIGFyZSBjb21wYXJlZCB2aWEgSlNPTiByb3VuZC10cmlwIHNvIGFwcHMgY2FuIHJldHVybiBhXG4gKiBge3VzZXJJZCwgdGVuYW50SWR9YC1zdHlsZSBvYmplY3Qgd2l0aG91dCBidWlsZGluZyB0aGVpciBvd24gZXF1YWxpdHkuXG4gKiBAcGFyYW0ge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSBhIC0gUGF1c2VkLXRpbWUgaWRlbnRpdHkuXG4gKiBAcGFyYW0ge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSBiIC0gUmVzdW1lLXRpbWUgaWRlbnRpdHkuXG4gKiBAcmV0dXJucyB7Ym9vbGVhbn0gLSBUcnVlIHdoZW4gdGhlIHR3byBpZGVudGl0aWVzIGFyZSBjb25zaWRlcmVkIHRoZSBzYW1lIGNhbGxlci5cbiAqL1xuZnVuY3Rpb24gaWRlbnRpdGllc01hdGNoKGEsIGIpIHtcbiAgaWYgKGEgPT09IGIpIHJldHVybiB0cnVlXG4gIGlmIChhID09IG51bGwgfHwgYiA9PSBudWxsKSByZXR1cm4gZmFsc2VcbiAgaWYgKHR5cGVvZiBhICE9PSBcIm9iamVjdFwiIHx8IHR5cGVvZiBiICE9PSBcIm9iamVjdFwiKSByZXR1cm4gZmFsc2VcblxuICB0cnkge1xuICAgIHJldHVybiBKU09OLnN0cmluZ2lmeShhKSA9PT0gSlNPTi5zdHJpbmdpZnkoYilcbiAgfSBjYXRjaCB7XG4gICAgcmV0dXJuIGZhbHNlXG4gIH1cbn1cblxuZXhwb3J0IGRlZmF1bHQgY2xhc3MgVmVsb2Npb3VzSHR0cFNlcnZlckNsaWVudFdlYnNvY2tldFNlc3Npb24ge1xuICBldmVudHMgPSBuZXcgRXZlbnRFbWl0dGVyKClcbiAgc3Vic2NyaXB0aW9ucyA9IG5ldyBTZXQoKVxuICBjaGFubmVscyA9IG5ldyBTZXQoKVxuICBzdWJzY3JpcHRpb25IYW5kbGVycyA9IG5ldyBNYXAoKVxuICBoYW5kbGVyU3Vic2NyaXB0aW9ucyA9IG5ldyBNYXAoKVxuICBjaGFubmVsVGVuYW50cyA9IG5ldyBNYXAoKVxuICBjaGFubmVsUmVwbGF5U3RhdGVzID0gbmV3IE1hcCgpXG4gIC8qKlxuICAgKiBNZXNzYWdlIHF1ZXVlLlxuICAgKiBAdHlwZSB7SW5ib3VuZE1lc3NhZ2VXb3JrW119ICovXG4gIG1lc3NhZ2VRdWV1ZSA9IFtdXG5cbiAgLyoqXG4gICAqIFJ1bnMgY29uc3RydWN0b3IuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gT3B0aW9ucyBvYmplY3QuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vLi4vY29uZmlndXJhdGlvbi5qc1wiKS5kZWZhdWx0fSBhcmdzLmNvbmZpZ3VyYXRpb24gLSBDb25maWd1cmF0aW9uIGluc3RhbmNlLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vaW5kZXguanNcIikuZGVmYXVsdH0gYXJncy5jbGllbnQgLSBDbGllbnQgaW5zdGFuY2UuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi9yZXF1ZXN0LmpzXCIpLmRlZmF1bHQgfCBpbXBvcnQoXCIuL3dlYnNvY2tldC1yZXF1ZXN0LmpzXCIpLmRlZmF1bHR9IFthcmdzLnVwZ3JhZGVSZXF1ZXN0XSAtIEluaXRpYWwgd2Vic29ja2V0IHVwZ3JhZGUgcmVxdWVzdC5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi8uLi9jb25maWd1cmF0aW9uLXR5cGVzLmpzXCIpLldlYnNvY2tldE1lc3NhZ2VIYW5kbGVyfSBbYXJncy5tZXNzYWdlSGFuZGxlcl0gLSBPcHRpb25hbCByYXcgbWVzc2FnZSBoYW5kbGVyLlxuICAgKiBAcGFyYW0ge1Byb21pc2U8aW1wb3J0KFwiLi4vLi4vY29uZmlndXJhdGlvbi10eXBlcy5qc1wiKS5XZWJzb2NrZXRNZXNzYWdlSGFuZGxlciB8IHZvaWQ+fSBbYXJncy5tZXNzYWdlSGFuZGxlclByb21pc2VdIC0gT3B0aW9uYWwgcmF3IG1lc3NhZ2UgaGFuZGxlciBwcm9taXNlLlxuICAgKi9cbiAgY29uc3RydWN0b3Ioe2NsaWVudCwgY29uZmlndXJhdGlvbiwgdXBncmFkZVJlcXVlc3QsIG1lc3NhZ2VIYW5kbGVyLCBtZXNzYWdlSGFuZGxlclByb21pc2V9KSB7XG4gICAgLyoqIEB0eXBlIHtCdWZmZXJbXX0gKi9cbiAgICB0aGlzLl9idWZmZXJDaHVua3MgPSBbXVxuICAgIHRoaXMuX2J1ZmZlckNodW5rSW5kZXggPSAwXG4gICAgdGhpcy5fYnVmZmVyQ2h1bmtPZmZzZXQgPSAwXG4gICAgdGhpcy5fYnVmZmVyZWRCeXRlcyA9IDBcbiAgICB0aGlzLl9idWZmZXJlZEZyYW1lQ29weUJ5dGVzID0gMFxuICAgIHRoaXMuY2xpZW50ID0gY2xpZW50XG4gICAgdGhpcy5jb25maWd1cmF0aW9uID0gY29uZmlndXJhdGlvblxuICAgIHRoaXMudXBncmFkZVJlcXVlc3QgPSB1cGdyYWRlUmVxdWVzdFxuICAgIHRoaXMubWVzc2FnZUhhbmRsZXIgPSBtZXNzYWdlSGFuZGxlclxuICAgIHRoaXMubWVzc2FnZUhhbmRsZXJQcm9taXNlID0gbWVzc2FnZUhhbmRsZXJQcm9taXNlXG4gICAgdGhpcy5wZW5kaW5nTWVzc2FnZUhhbmRsZXIgPSBCb29sZWFuKG1lc3NhZ2VIYW5kbGVyUHJvbWlzZSlcbiAgICB0aGlzLmxvZ2dlciA9IG5ldyBMb2dnZXIodGhpcylcbiAgICBjb25zdCBpbmJvdW5kUXVldWVMaW1pdHMgPSB0aGlzLmNvbmZpZ3VyYXRpb24uZ2V0V2Vic29ja2V0SW5ib3VuZFF1ZXVlTGltaXRzKClcblxuICAgIHRoaXMuX2luYm91bmRNYXhQZW5kaW5nQnl0ZXMgPSBpbmJvdW5kUXVldWVMaW1pdHMubWF4Qnl0ZXNcbiAgICB0aGlzLl9pbmJvdW5kTWF4UGVuZGluZ01lc3NhZ2VzID0gaW5ib3VuZFF1ZXVlTGltaXRzLm1heE1lc3NhZ2VzXG4gICAgdGhpcy5faW5ib3VuZFBlbmRpbmdCeXRlcyA9IDBcbiAgICB0aGlzLl9pbmJvdW5kUGVuZGluZ01lc3NhZ2VzID0gMFxuICAgIHRoaXMuX2luYm91bmRBY2NvdW50aW5nR2VuZXJhdGlvbiA9IDBcbiAgICB0aGlzLl9pbmJvdW5kQ2xvc2VkID0gZmFsc2VcbiAgICB0aGlzLl9pbmJvdW5kQmFja2xvZ092ZXJsb2FkZWQgPSBmYWxzZVxuXG4gICAgLyoqXG4gICAgICogTmFycm93cyB0aGUgcnVudGltZSB2YWx1ZSB0byB0aGUgZG9jdW1lbnRlZCB0eXBlLlxuICAgICAqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59ICovXG4gICAgdGhpcy5fbWV0YWRhdGEgPSB7fVxuXG4gICAgLyoqXG4gICAgICogTG9uZy1saXZlZCBwZXItc2Vzc2lvbiBzdGF0ZSBiYWcuIFN0YWJsZSBhY3Jvc3MgcmVjb25uZWN0cyBvbmNlXG4gICAgICogZ3JhY2UtcGVyaW9kIHJlc3VtcHRpb24gbGFuZHMgaW4gUGhhc2UgMjsgdG9kYXkgaXQganVzdCBsaXZlc1xuICAgICAqIGZvciB0aGUgZHVyYXRpb24gb2YgdGhlIHVuZGVybHlpbmcgc29ja2V0LlxuICAgICAqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59XG4gICAgICovXG4gICAgdGhpcy5kYXRhID0ge31cblxuICAgIC8qKlxuICAgICAqIE5hcnJvd3MgdGhlIHJ1bnRpbWUgdmFsdWUgdG8gdGhlIGRvY3VtZW50ZWQgdHlwZS5cbiAgICAgKiBAdHlwZSB7TWFwPHN0cmluZywgaW1wb3J0KFwiLi4vd2Vic29ja2V0LWNvbm5lY3Rpb24uanNcIikuZGVmYXVsdD59ICovXG4gICAgdGhpcy5fY29ubmVjdGlvbnMgPSBuZXcgTWFwKClcblxuICAgIC8qKlxuICAgICAqIE5hcnJvd3MgdGhlIHJ1bnRpbWUgdmFsdWUgdG8gdGhlIGRvY3VtZW50ZWQgdHlwZS5cbiAgICAgKiBAdHlwZSB7TWFwPHN0cmluZywge2NoYW5uZWxUeXBlOiBzdHJpbmcsIHN1YnNjcmlwdGlvbjogaW1wb3J0KFwiLi4vd2Vic29ja2V0LWNoYW5uZWwuanNcIikuZGVmYXVsdH0+fSAqL1xuICAgIHRoaXMuX2NoYW5uZWxTdWJzY3JpcHRpb25zID0gbmV3IE1hcCgpXG5cbiAgICAvKipcbiAgICAgKiBVbmlxdWUgaWQgYXNzaWduZWQgdG8gdGhpcyBzZXNzaW9uIG9uIGZpcnN0IGNvbm5lY3QuIFNlbnQgdG8gdGhlXG4gICAgICogY2xpZW50IHZpYSBgc2Vzc2lvbi1lc3RhYmxpc2hlZGA7IHRoZSBjbGllbnQgZWNob2VzIGl0IGJhY2sgdmlhXG4gICAgICogYHNlc3Npb24tcmVzdW1lYCBhZnRlciBhIFdTIGRyb3AgdG8gcmVhdHRhY2ggdG8gdGhpcyBzZXNzaW9uXG4gICAgICogd2l0aGluIHRoZSBncmFjZSBwZXJpb2QuXG4gICAgICogQHR5cGUge3N0cmluZ31cbiAgICAgKi9cbiAgICB0aGlzLnNlc3Npb25JZCA9IHJhbmRvbVVVSUQoKVxuXG4gICAgLyoqXG4gICAgICogTmFycm93cyB0aGUgcnVudGltZSB2YWx1ZSB0byB0aGUgZG9jdW1lbnRlZCB0eXBlLlxuICAgICAqIEB0eXBlIHtib29sZWFufSAtIHRydWUgYWZ0ZXIgYF9oYW5kbGVDbG9zZWAgcGF1c2VzIGluc3RlYWQgb2YgdGVhcmluZyBkb3duLlxuICAgICAqL1xuICAgIHRoaXMuX3BhdXNlZCA9IGZhbHNlXG5cbiAgICAvKipcbiAgICAgKiBOYXJyb3dzIHRoZSBydW50aW1lIHZhbHVlIHRvIHRoZSBkb2N1bWVudGVkIHR5cGUuXG4gICAgICogQHR5cGUge0FycmF5PFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gLSBmcmFtZXMgcHJvZHVjZWQgd2hpbGUgcGF1c2VkOyBmbHVzaGVkIG9uIHJlc3VtZS5cbiAgICAgKi9cbiAgICB0aGlzLl9vdXRib3VuZFF1ZXVlID0gW11cblxuICAgIC8qKlxuICAgICAqIE5hcnJvd3MgdGhlIHJ1bnRpbWUgdmFsdWUgdG8gdGhlIGRvY3VtZW50ZWQgdHlwZS5cbiAgICAgKiBAdHlwZSB7aW1wb3J0KFwiLi9pbmRleC5qc1wiKS5kZWZhdWx0IHwgbnVsbH0gKi9cbiAgICB0aGlzLnNvY2tldCA9IG51bGxcblxuICAgIC8qKlxuICAgICAqIFRhaWwgb2YgYSBwZXItc2Vzc2lvbiBwcm9taXNlIGNoYWluIHRoYXQgc2VyaWFsaXplcyBtZXNzYWdlXG4gICAgICogaGFuZGxpbmcuIFByZXZlbnRzIHJhY2VzIHdoZXJlIG1lc3NhZ2UgQiByZWFkcyBgc2Vzc2lvbi5kYXRhYFxuICAgICAqIGJlZm9yZSBtZXNzYWdlIEEncyBoYW5kbGVyIGZpbmlzaGVzIHdyaXRpbmcgaXQgKGUuZy4gYVxuICAgICAqIGNvbm5lY3Rpb24tbWVzc2FnZSBzZXR0aW5nIHRoZSBsb2NhbGUgdnMuIGEgc3Vic2VxdWVudCByZXF1ZXN0XG4gICAgICogd2hvc2UgYXJvdW5kUmVxdWVzdCB3cmFwcGVyIHJlYWRzIGl0KS5cbiAgICAgKiBAdHlwZSB7UHJvbWlzZTx2b2lkPn1cbiAgICAgKi9cbiAgICB0aGlzLl9tZXNzYWdlQ2hhaW4gPSBQcm9taXNlLnJlc29sdmUoKVxuXG4gICAgLyoqXG4gICAgICogUHJvbWlzZSB0aGF0IHJlc29sdmVzIHRvIHRoZSBhdXRoIGlkZW50aXR5IGNhcHR1cmVkIGF0IHBhdXNlXG4gICAgICogdGltZSBieSBgZ2V0V2Vic29ja2V0U2Vzc2lvbklkZW50aXR5UmVzb2x2ZXJgLiBBd2FpdGVkIGF0IHJlc3VtZVxuICAgICAqIHRpbWUgdG8gY29tcGFyZSBhZ2FpbnN0IHRoZSBmcmVzaCBjYWxsZXIncyBpZGVudGl0eS4gVW5kZWZpbmVkXG4gICAgICogb24gYSBsaXZlIChub24tcGF1c2VkKSBzZXNzaW9uLlxuICAgICAqIEB0eXBlIHtQcm9taXNlPFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+PiB8IHVuZGVmaW5lZH1cbiAgICAgKi9cbiAgICB0aGlzLl9yZXN1bWVJZGVudGl0eVByb21pc2UgPSB1bmRlZmluZWRcblxuICAgIC8qKiBAdHlwZSB7c3RyaW5nIHwgbnVsbH0gKi9cbiAgICB0aGlzLl9jbGFpbWVkU2Vzc2lvbklkID0gbnVsbFxuXG4gICAgLyoqXG4gICAgICogQWNjdW11bGF0ZXMgcGF5bG9hZHMgZm9yIGEgZnJhZ21lbnRlZCB3ZWJzb2NrZXQgbWVzc2FnZSBwZXJcbiAgICAgKiBSRkMgNjQ1NS4gTm9uLW51bGwgd2hpbGUgbWlkLWZyYWdtZW50OyBjbGVhcmVkIHdoZW4gdGhlIGZyYW1lXG4gICAgICogd2l0aCBGSU49MSBjb21wbGV0ZXMgYW5kIHRoZSBtZXNzYWdlIGlzIGRpc3BhdGNoZWQuXG4gICAgICogQHR5cGUge0J1ZmZlcltdIHwgbnVsbH1cbiAgICAgKi9cbiAgICB0aGlzLl9mcmFnbWVudGVkUGF5bG9hZHMgPSBudWxsXG5cbiAgICAvKipcbiAgICAgKiBPcGNvZGUgKFRFWFQvQklOQVJZKSBjYXB0dXJlZCBmcm9tIHRoZSBmaXJzdCBmcmFtZSBvZiBhXG4gICAgICogZnJhZ21lbnRlZCBtZXNzYWdlLiBDb250aW51YXRpb24gZnJhbWVzIChvcGNvZGUgMCkgaW5oZXJpdCBpdFxuICAgICAqIGF0IHJlYXNzZW1ibHkgdGltZS5cbiAgICAgKiBAdHlwZSB7bnVtYmVyIHwgbnVsbH1cbiAgICAgKi9cbiAgICB0aGlzLl9mcmFnbWVudGVkT3Bjb2RlID0gbnVsbFxuXG4gICAgLyoqXG4gICAgICogUnVubmluZyBieXRlIHRvdGFsIGZvciBgX2ZyYWdtZW50ZWRQYXlsb2Fkc2AuIFVzZWQgdG8gZW5mb3JjZVxuICAgICAqIGBXRUJTT0NLRVRfTUFYX0ZSQUdNRU5URURfTUVTU0FHRV9CWVRFU2Agc28gYSBwZWVyIGNhbm5vdFxuICAgICAqIGV4aGF1c3QgbWVtb3J5IGJ5IHN0cmVhbWluZyBub24tZmluYWwgZnJhZ21lbnRzIGluZGVmaW5pdGVseS5cbiAgICAgKiBAdHlwZSB7bnVtYmVyfVxuICAgICAqL1xuICAgIHRoaXMuX2ZyYWdtZW50ZWRCeXRlcyA9IDBcblxuICAgIHRoaXMuY29uZmlndXJhdGlvbi5fd2Vic29ja2V0U2Vzc2lvbnMuYWRkKHRoaXMpXG5cbiAgICAvKipcbiAgICAgKiBIZWFydGJlYXQgbGl2ZW5lc3MgZmxhZy4gU2V0IHRydWUgb24gZXZlcnkgaW5ib3VuZCBmcmFtZVxuICAgICAqIChpbmNsdWRpbmcgdGhlIGNsaWVudCdzIGF1dG8tcG9uZykgYW5kIGNsZWFyZWQgZWFjaCB0aW1lIGEgcGluZ1xuICAgICAqIGlzIHNlbnQ7IGEgc3RpbGwtZmFsc2UgZmxhZyBhdCB0aGUgbmV4dCB0aWNrIG1lYW5zIHRoZSBzb2NrZXRcbiAgICAgKiBoYXMgZ29uZSBzaWxlbnQuXG4gICAgICogQHR5cGUge2Jvb2xlYW59XG4gICAgICovXG4gICAgdGhpcy5faGVhcnRiZWF0QWxpdmUgPSB0cnVlXG5cbiAgICAvKipcbiAgICAgKiBQZXItc2Vzc2lvbiBoZWFydGJlYXQgaW50ZXJ2YWwgaGFuZGxlLiBTdGFydGVkIGZyb21cbiAgICAgKiBgc2VuZFNlc3Npb25Fc3RhYmxpc2hlZGAgb25jZSB0aGUgc29ja2V0IGlzIGxpdmUsIG5vdCBhdFxuICAgICAqIGNvbnN0cnVjdGlvbiwgc28gZGlyZWN0bHktY29uc3RydWN0ZWQgc2Vzc2lvbnMgaW4gdGVzdHMgZG9uJ3RcbiAgICAgKiBzcGluIHVwIGEgYmFja2dyb3VuZCB0aW1lci5cbiAgICAgKiBAdHlwZSB7UmV0dXJuVHlwZTx0eXBlb2Ygc2V0SW50ZXJ2YWw+IHwgbnVsbH1cbiAgICAgKi9cbiAgICB0aGlzLl9oZWFydGJlYXRUaW1lciA9IG51bGxcbiAgfVxuXG4gIC8qKlxuICAgKiBTZW5kcyB0aGUgY2xpZW50IGl0cyBzZXNzaW9uSWQgKyBncmFjZSB3aW5kb3cuIENhbGxlZCBieVxuICAgKiBgVmVsb2Npb3VzSHR0cFNlcnZlckNsaWVudGAgYWZ0ZXIgdGhlIFdTIHVwZ3JhZGUgY29tcGxldGVzLlxuICAgKiBAcmV0dXJucyB7dm9pZH1cbiAgICovXG4gIHNlbmRTZXNzaW9uRXN0YWJsaXNoZWQoKSB7XG4gICAgdGhpcy5fY2xhaW1Pd25lcnNoaXAoKVxuICAgIHRoaXMuc2VuZEpzb24oe1xuICAgICAgdHlwZTogXCJzZXNzaW9uLWVzdGFibGlzaGVkXCIsXG4gICAgICBzZXNzaW9uSWQ6IHRoaXMuc2Vzc2lvbklkLFxuICAgICAgZ3JhY2VTZWNvbmRzOiB0aGlzLmNvbmZpZ3VyYXRpb24uZ2V0V2Vic29ja2V0U2Vzc2lvbkdyYWNlU2Vjb25kcz8uKCkgfHwgMzAwXG4gICAgfSlcblxuICAgIC8vIFRoZSBzb2NrZXQgaXMgbGl2ZSBub3csIHNvIGJlZ2luIHJlYXBpbmcgaXQgaWYgaXQgZ29lcyBzaWxlbnQuXG4gICAgdGhpcy5fc3RhcnRIZWFydGJlYXQoKVxuICB9XG5cbiAgLyoqXG4gICAqIFJlbW92ZXMgYSBjbG9zZWQgY29ubmVjdGlvbiBmcm9tIHRoZSBzZXNzaW9uIHJlZ2lzdHJ5LiBDYWxsZWQgYnlcbiAgICogYFZlbG9jaW91c1dlYnNvY2tldENvbm5lY3Rpb24uY2xvc2UoKWAgYWZ0ZXIgaXQgc2VuZHMgdGhlIGZpbmFsXG4gICAqIGBjb25uZWN0aW9uLWNsb3NlZGAgZnJhbWUuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBjb25uZWN0aW9uSWQgLSBDbG9zZWQgY29ubmVjdGlvbiBpZGVudGlmaWVyIHRvIHJlbW92ZS5cbiAgICogQHJldHVybnMge3ZvaWR9XG4gICAqL1xuICBfcmVtb3ZlQ29ubmVjdGlvbihjb25uZWN0aW9uSWQpIHtcbiAgICB0aGlzLl9jb25uZWN0aW9ucy5kZWxldGUoY29ubmVjdGlvbklkKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZ2V0IG1ldGFkYXRhLlxuICAgKiBAcmV0dXJucyB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSAtIENsaWVudC1wcm92aWRlZCBtZXRhZGF0YSAoZGVmZW5zaXZlIGNvcHkpLlxuICAgKi9cbiAgZ2V0TWV0YWRhdGEoKSB7XG4gICAgcmV0dXJuIHsuLi50aGlzLl9tZXRhZGF0YX1cbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGlzIHBhdXNlZC5cbiAgICogQHJldHVybnMge2Jvb2xlYW59IC0gdHJ1ZSB3aGlsZSB0aGUgc2Vzc2lvbiBpcyBpbiB0aGUgcGF1c2VkL2dyYWNlIHJlZ2lzdHJ5LlxuICAgKi9cbiAgaXNQYXVzZWQoKSB7XG4gICAgcmV0dXJuIHRoaXMuX3BhdXNlZFxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgYWRkIHN1YnNjcmlwdGlvbi5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGNoYW5uZWwgLSBDaGFubmVsIG5hbWUuXG4gICAqIEByZXR1cm5zIHt2b2lkfSAtIE5vIHJldHVybiB2YWx1ZS5cbiAgICovXG4gIGFkZFN1YnNjcmlwdGlvbihjaGFubmVsKSB7XG4gICAgdGhpcy5zdWJzY3JpcHRpb25zLmFkZChjaGFubmVsKVxuICB9XG5cbiAgZGVzdHJveSgpIHtcbiAgICB0aGlzLl9yZWxlYXNlT3duZXJzaGlwKClcbiAgICB0aGlzLl9zdG9wSGVhcnRiZWF0KClcbiAgICB0aGlzLl9yZXNldEZyYWdtZW50QnVmZmVyKClcbiAgICB0aGlzLl9jbGVhckJ1ZmZlcmVkRnJhbWVDaHVua3MoKVxuICAgIHRoaXMuX2FiYW5kb25JbmJvdW5kTWVzc2FnZXMoKVxuICAgIHRoaXMuY29uZmlndXJhdGlvbi5fd2Vic29ja2V0U2Vzc2lvbnMuZGVsZXRlKHRoaXMpXG4gICAgdGhpcy5fcGF1c2VkID0gZmFsc2VcbiAgICB2b2lkIHRoaXMuX3RlYXJkb3duQ2hhbm5lbCgpXG4gICAgdm9pZCB0aGlzLl90ZWFyZG93bkNvbm5lY3Rpb25zKFwic2Vzc2lvbl9kZXN0cm95ZWRcIilcbiAgICB2b2lkIHRoaXMuX3RlYXJkb3duQ2hhbm5lbFN1YnNjcmlwdGlvbnMoKVxuICAgIHRoaXMuZXZlbnRzLnJlbW92ZUFsbExpc3RlbmVycygpXG4gIH1cblxuICAvKiogQ2xhaW1zIHRoaXMgc2Vzc2lvbiBpZCBmb3IgaG9zdC1zaWRlIHJlY29ubmVjdCByb3V0aW5nLiAqL1xuICBfY2xhaW1Pd25lcnNoaXAoKSB7XG4gICAgaWYgKHRoaXMuX2NsYWltZWRTZXNzaW9uSWQgPT09IHRoaXMuc2Vzc2lvbklkKSByZXR1cm5cbiAgICBpZiAodGhpcy5fY2xhaW1lZFNlc3Npb25JZCkgdGhpcy5fcmVsZWFzZU93bmVyc2hpcCgpXG5cbiAgICB0aGlzLl9jbGFpbWVkU2Vzc2lvbklkID0gdGhpcy5zZXNzaW9uSWRcbiAgICB0aGlzLmV2ZW50cy5lbWl0KFwib3duZXJzaGlwQ2xhaW1lZFwiLCB7c2Vzc2lvbklkOiB0aGlzLnNlc3Npb25JZH0pXG4gIH1cblxuICAvKiogUmVsZWFzZXMgdGhlIGN1cnJlbnRseSBjbGFpbWVkIHNlc3Npb24gaWQgZXhhY3RseSBvbmNlLiAqL1xuICBfcmVsZWFzZU93bmVyc2hpcCgpIHtcbiAgICBjb25zdCBzZXNzaW9uSWQgPSB0aGlzLl9jbGFpbWVkU2Vzc2lvbklkXG5cbiAgICBpZiAoIXNlc3Npb25JZCkgcmV0dXJuXG5cbiAgICB0aGlzLl9jbGFpbWVkU2Vzc2lvbklkID0gbnVsbFxuICAgIHRoaXMuZXZlbnRzLmVtaXQoXCJvd25lcnNoaXBSZWxlYXNlZFwiLCB7c2Vzc2lvbklkfSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGhhcyBzdWJzY3JpcHRpb24uXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBjaGFubmVsIC0gQ2hhbm5lbCBuYW1lLlxuICAgKiBAcmV0dXJucyB7Ym9vbGVhbn0gLSBXaGV0aGVyIGl0IGhhcyBzdWJzY3JpcHRpb24uXG4gICAqL1xuICBoYXNTdWJzY3JpcHRpb24oY2hhbm5lbCkge1xuICAgIHJldHVybiB0aGlzLnN1YnNjcmlwdGlvbnMuaGFzKGNoYW5uZWwpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBvbiBkYXRhLlxuICAgKiBAcGFyYW0ge0J1ZmZlcn0gZGF0YSAtIERhdGEgcGF5bG9hZC5cbiAgICogQHJldHVybnMge3ZvaWR9IC0gTm8gcmV0dXJuIHZhbHVlLlxuICAgKi9cbiAgb25EYXRhKGRhdGEpIHtcbiAgICAvLyBBbnkgaW5ib3VuZCBieXRlcyDigJQgYSBkYXRhIGZyYW1lLCB0aGUgYXV0by1wb25nIGFuc3dlcmluZyBvdXJcbiAgICAvLyBoZWFydGJlYXQsIG9yIGEgcGFydGlhbCBmcmFtZSBzdGlsbCBiZWluZyB1cGxvYWRlZCDigJQgcHJvdmUgdGhlXG4gICAgLy8gc29ja2V0IGlzIGFsaXZlLiBNYXJrIGl0IGhlcmUsIGJlZm9yZSBgX3Byb2Nlc3NCdWZmZXJgIG1heSByZXR1cm5cbiAgICAvLyBlYXJseSB3YWl0aW5nIGZvciB0aGUgcmVzdCBvZiBhbiBpbmNvbXBsZXRlIGZyYW1lLlxuICAgIHRoaXMuX2hlYXJ0YmVhdEFsaXZlID0gdHJ1ZVxuICAgIGlmICh0aGlzLl9pbmJvdW5kQ2xvc2VkIHx8IGRhdGEubGVuZ3RoID09PSAwKSByZXR1cm5cblxuICAgIHRoaXMuX2J1ZmZlckNodW5rcy5wdXNoKGRhdGEpXG4gICAgdGhpcy5fYnVmZmVyZWRCeXRlcyArPSBkYXRhLmxlbmd0aFxuICAgIHRoaXMuX3Byb2Nlc3NCdWZmZXIoKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgc2VuZCBldmVudC5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGNoYW5uZWwgLSBDaGFubmVsIG5hbWUuXG4gICAqIEBwYXJhbSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59IHBheWxvYWQgLSBQYXlsb2FkIGRhdGEuXG4gICAqIEBwYXJhbSB7e2NyZWF0ZWRBdD86IHN0cmluZywgZXZlbnRJZD86IHN0cmluZywgcmVwbGF5ZWQ/OiBib29sZWFuLCBzZXF1ZW5jZT86IG51bWJlcn19IFtvcHRpb25zXSAtIEV2ZW50IG1ldGFkYXRhLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyB3aGVuIGNvbXBsZXRlLlxuICAgKi9cbiAgYXN5bmMgc2VuZEV2ZW50KGNoYW5uZWwsIHBheWxvYWQsIG9wdGlvbnMgPSB7fSkge1xuICAgIGNvbnN0IGNoYW5uZWxIYW5kbGVycyA9IHRoaXMuc3Vic2NyaXB0aW9uSGFuZGxlcnMuZ2V0KGNoYW5uZWwpXG4gICAgY29uc3QgaGFzQ2hhbm5lbEhhbmRsZXJzID0gQm9vbGVhbihjaGFubmVsSGFuZGxlcnMgJiYgY2hhbm5lbEhhbmRsZXJzLnNpemUgPiAwKVxuICAgIGNvbnN0IHJlcGxheVN0YXRlID0gdGhpcy5jaGFubmVsUmVwbGF5U3RhdGVzLmdldChjaGFubmVsKVxuXG4gICAgaWYgKHJlcGxheVN0YXRlPy5yZXBsYXlpbmcgJiYgIW9wdGlvbnMucmVwbGF5ZWQpIHtcbiAgICAgIHJlcGxheVN0YXRlLmJ1ZmZlcmVkID0gdHJ1ZVxuICAgICAgcmV0dXJuXG4gICAgfVxuXG4gICAgaWYgKCF0aGlzLmhhc1N1YnNjcmlwdGlvbihjaGFubmVsKSAmJiAhaGFzQ2hhbm5lbEhhbmRsZXJzKSByZXR1cm5cblxuICAgIGlmIChoYXNDaGFubmVsSGFuZGxlcnMpIHtcbiAgICAgIGF3YWl0IFByb21pc2UuYWxsKEFycmF5LmZyb20oY2hhbm5lbEhhbmRsZXJzKS5tYXAoYXN5bmMgKGhhbmRsZXIpID0+IHtcbiAgICAgICAgY29uc3QgdGVuYW50ID0gdGhpcy5jaGFubmVsVGVuYW50cy5nZXQoaGFuZGxlcilcblxuICAgICAgICBhd2FpdCB0aGlzLmNvbmZpZ3VyYXRpb24ucnVuV2l0aFRlbmFudCh0ZW5hbnQsIGFzeW5jICgpID0+IHtcbiAgICAgICAgICBhd2FpdCB0aGlzLl93aXRoQ29ubmVjdGlvbnMoYXN5bmMgKCkgPT4ge1xuICAgICAgICAgICAgYXdhaXQgaGFuZGxlci5yZWNlaXZlZEJyb2FkY2FzdCh7XG4gICAgICAgICAgICAgIGNoYW5uZWwsXG4gICAgICAgICAgICAgIGNyZWF0ZWRBdDogb3B0aW9ucy5jcmVhdGVkQXQsXG4gICAgICAgICAgICAgIGV2ZW50SWQ6IG9wdGlvbnMuZXZlbnRJZCxcbiAgICAgICAgICAgICAgcGF5bG9hZCxcbiAgICAgICAgICAgICAgcmVwbGF5ZWQ6IG9wdGlvbnMucmVwbGF5ZWQsXG4gICAgICAgICAgICAgIHNlcXVlbmNlOiBvcHRpb25zLnNlcXVlbmNlXG4gICAgICAgICAgICB9KVxuICAgICAgICAgIH0pXG4gICAgICAgIH0pXG4gICAgICB9KSlcbiAgICAgIHJldHVyblxuICAgIH1cblxuICAgIHRoaXMuc2VuZEpzb24oe1xuICAgICAgY2hhbm5lbCxcbiAgICAgIGNyZWF0ZWRBdDogb3B0aW9ucy5jcmVhdGVkQXQsXG4gICAgICBldmVudElkOiBvcHRpb25zLmV2ZW50SWQsXG4gICAgICBwYXlsb2FkLFxuICAgICAgcmVwbGF5ZWQ6IG9wdGlvbnMucmVwbGF5ZWQsXG4gICAgICBzZXF1ZW5jZTogb3B0aW9ucy5zZXF1ZW5jZSxcbiAgICAgIHR5cGU6IFwiZXZlbnRcIlxuICAgIH0pXG4gIH1cblxuICAvKipcbiAgICogUnVucyBpbml0aWFsaXplIGNoYW5uZWwuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIHdoZW4gY29tcGxldGUuXG4gICAqL1xuICBhc3luYyBpbml0aWFsaXplQ2hhbm5lbCgpIHtcbiAgICBpZiAodGhpcy5tZXNzYWdlSGFuZGxlclByb21pc2UpIHtcbiAgICAgIGF3YWl0IHRoaXMuX3Jlc29sdmVNZXNzYWdlSGFuZGxlclByb21pc2UoKVxuXG4gICAgICBpZiAodGhpcy5tZXNzYWdlSGFuZGxlcikgcmV0dXJuXG4gICAgfVxuXG4gICAgaWYgKHRoaXMubWVzc2FnZUhhbmRsZXIpIHtcbiAgICAgIGF3YWl0IHRoaXMuX3J1bk1lc3NhZ2VIYW5kbGVyT3BlbigpXG4gICAgICByZXR1cm5cbiAgICB9XG5cbiAgICBjb25zdCByZXNvbHZlciA9IHRoaXMuY29uZmlndXJhdGlvbi5nZXRXZWJzb2NrZXRDaGFubmVsUmVzb2x2ZXI/LigpXG5cbiAgICBpZiAoIXJlc29sdmVyKSByZXR1cm5cblxuICAgIHRyeSB7XG4gICAgICBjb25zdCB0ZW5hbnQgPSBhd2FpdCB0aGlzLl9yZXNvbHZlVGVuYW50KHt9KVxuICAgICAgY29uc3QgcmVzb2x2ZWQgPSBhd2FpdCB0aGlzLmNvbmZpZ3VyYXRpb24ucnVuV2l0aFRlbmFudCh0ZW5hbnQsIGFzeW5jICgpID0+IHtcbiAgICAgICAgcmV0dXJuIGF3YWl0IHJlc29sdmVyKHtcbiAgICAgICAgICBjbGllbnQ6IHRoaXMuY2xpZW50LFxuICAgICAgICAgIGNvbmZpZ3VyYXRpb246IHRoaXMuY29uZmlndXJhdGlvbixcbiAgICAgICAgICByZXF1ZXN0OiB0aGlzLnVwZ3JhZGVSZXF1ZXN0LFxuICAgICAgICAgIHdlYnNvY2tldFNlc3Npb246IHRoaXNcbiAgICAgICAgfSlcbiAgICAgIH0pXG5cbiAgICAgIGlmICghcmVzb2x2ZWQpIHJldHVyblxuXG4gICAgICBjb25zdCBjaGFubmVsID0gdHlwZW9mIHJlc29sdmVkID09PSBcImZ1bmN0aW9uXCJcbiAgICAgICAgPyBuZXcgcmVzb2x2ZWQoe2NsaWVudDogdGhpcy5jbGllbnQsIGNvbmZpZ3VyYXRpb246IHRoaXMuY29uZmlndXJhdGlvbiwgcmVxdWVzdDogdGhpcy51cGdyYWRlUmVxdWVzdCwgd2Vic29ja2V0U2Vzc2lvbjogdGhpc30pXG4gICAgICAgIDogcmVzb2x2ZWRcblxuICAgICAgaWYgKGNoYW5uZWwgJiYgIShjaGFubmVsIGluc3RhbmNlb2YgV2Vic29ja2V0Q2hhbm5lbCkpIHtcbiAgICAgICAgdGhyb3cgbmV3IEVycm9yKFwiUmVzb2x2ZWQgd2Vic29ja2V0IGNoYW5uZWwgbXVzdCBleHRlbmQgV2Vic29ja2V0Q2hhbm5lbFwiKVxuICAgICAgfVxuXG4gICAgICBhd2FpdCB0aGlzLl9yZWdpc3RlckNoYW5uZWwoY2hhbm5lbCwgdGVuYW50KVxuICAgIH0gY2F0Y2ggKGNhdWdodEVycm9yKSB7XG4gICAgICBjb25zdCBlcnJvciA9IHRoaXMuX3JlcG9ydFVuZXhwZWN0ZWREaXNwYXRjaEVycm9yKGNhdWdodEVycm9yLCB7XG4gICAgICAgIHN0YWdlOiBcIndlYnNvY2tldC1jaGFubmVsLWluaXRpYWxpemVcIlxuICAgICAgfSlcblxuICAgICAgdGhpcy5sb2dnZXIuZXJyb3IoKCkgPT4gW1wiRmFpbGVkIHRvIGluaXRpYWxpemUgd2Vic29ja2V0IGNoYW5uZWxcIiwgZXJyb3JdKVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHNlbmQgZ29vZGJ5ZS5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL2luZGV4LmpzXCIpLmRlZmF1bHR9IGNsaWVudCAtIENsaWVudCBpbnN0YW5jZS5cbiAgICogQHBhcmFtIHt7Y29kZT86IG51bWJlciwgcmVhc29uPzogc3RyaW5nfX0gW29wdGlvbnNdIC0gT3B0aW9uYWwgY2xvc2Ugc3RhdHVzLlxuICAgKiBAcmV0dXJucyB7dm9pZH0gLSBObyByZXR1cm4gdmFsdWUuXG4gICAqL1xuICBzZW5kR29vZGJ5ZShjbGllbnQsIHtjb2RlLCByZWFzb24gPSBcIlwifSA9IHt9KSB7XG4gICAgbGV0IHBheWxvYWRcblxuICAgIGlmIChjb2RlID09PSB1bmRlZmluZWQpIHtcbiAgICAgIHBheWxvYWQgPSBCdWZmZXIuYWxsb2MoMClcbiAgICB9IGVsc2Uge1xuICAgICAgY29uc3QgcmVhc29uQnl0ZXMgPSBCdWZmZXIuZnJvbShyZWFzb24sIFwidXRmLThcIilcblxuICAgICAgaWYgKHJlYXNvbkJ5dGVzLmxlbmd0aCA+IFdFQlNPQ0tFVF9NQVhfQ0xPU0VfUkVBU09OX0JZVEVTKSB7XG4gICAgICAgIHRocm93IG5ldyBSYW5nZUVycm9yKFwiV2ViU29ja2V0IGNsb3NlIHJlYXNvbiBtdXN0IG5vdCBleGNlZWQgMTIzIFVURi04IGJ5dGVzXCIpXG4gICAgICB9XG5cbiAgICAgIHBheWxvYWQgPSBCdWZmZXIuYWxsb2NVbnNhZmUoMiArIHJlYXNvbkJ5dGVzLmxlbmd0aClcbiAgICAgIHBheWxvYWQud3JpdGVVSW50MTZCRShjb2RlLCAwKVxuICAgICAgcmVhc29uQnl0ZXMuY29weShwYXlsb2FkLCAyKVxuICAgIH1cblxuICAgIGNvbnN0IGZyYW1lID0gQnVmZmVyLmNvbmNhdChbXG4gICAgICBCdWZmZXIuZnJvbShbV0VCU09DS0VUX0ZJTkFMX0ZSQU1FIHwgV0VCU09DS0VUX09QQ09ERV9DTE9TRSwgcGF5bG9hZC5sZW5ndGhdKSxcbiAgICAgIHBheWxvYWRcbiAgICBdKVxuXG4gICAgY2xpZW50LmV2ZW50cy5lbWl0KFwib3V0cHV0XCIsIGZyYW1lLCB7d2Vic29ja2V0RnJhbWU6IHRydWV9KVxuICB9XG5cbiAgLyoqXG4gICAqIFdoZXRoZXIgYSBjYXVnaHQgZGlzcGF0Y2ggZXJyb3IgaXMgYW4gZXhwZWN0ZWQgY2xpZW50LWZsb3cgZmFpbHVyZS5cbiAgICogQHBhcmFtIHtFcnJvcn0gZXJyb3IgLSBOb3JtYWxpemVkIGRpc3BhdGNoIGVycm9yLlxuICAgKiBAcmV0dXJucyB7Ym9vbGVhbn0gLSBXaGV0aGVyIGZyYW1ld29yayBlcnJvciByZXBvcnRlcnMgc2hvdWxkIGlnbm9yZSBpdC5cbiAgICovXG4gIF9leHBlY3RlZENsaWVudEVycm9yKGVycm9yKSB7XG4gICAgaWYgKGVycm9yIGluc3RhbmNlb2YgVmFsaWRhdGlvbkVycm9yKSByZXR1cm4gdHJ1ZVxuICAgIGlmIChlcnJvciBpbnN0YW5jZW9mIFZlbG9jaW91c0Vycm9yICYmIGVycm9yLnNhZmVUb0V4cG9zZSkgcmV0dXJuIHRydWVcblxuICAgIGNvbnN0IGFubm90YXRlZEVycm9yID0gLyoqIEB0eXBlIHtFcnJvciAmIHtlcnJvclR5cGU/OiBzdHJpbmcsIHZlbG9jaW91cz86IFJlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn19ICovIChlcnJvcilcblxuICAgIGlmIChpc1BsYWluT2JqZWN0KGFubm90YXRlZEVycm9yLnZlbG9jaW91cykpIHJldHVybiB0cnVlXG5cbiAgICByZXR1cm4gdHlwZW9mIGFubm90YXRlZEVycm9yLmVycm9yVHlwZSA9PT0gXCJzdHJpbmdcIiAmJiBhbm5vdGF0ZWRFcnJvci5lcnJvclR5cGUubGVuZ3RoID4gMFxuICB9XG5cbiAgLyoqXG4gICAqIFJlcG9ydHMgb25lIHVuZXhwZWN0ZWQgV2ViU29ja2V0IGRpc3BhdGNoIGZhaWx1cmUgYW5kIHJldHVybnMgaXRzIHJlZGFjdGVkIEVycm9yIGRpYWdub3N0aWMuXG4gICAqIEBwYXJhbSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59IGNhdWdodEVycm9yIC0gQ2F1Z2h0IGRpc3BhdGNoIGZhaWx1cmUuXG4gICAqIEBwYXJhbSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSBjb250ZXh0IC0gU3RydWN0dXJlZCBkaXNwYXRjaCBjb250ZXh0LlxuICAgKiBAcmV0dXJucyB7RXJyb3J9IC0gUmVkYWN0ZWQgZXJyb3IgZm9yIGxvZ3MgYW5kIGZyYW1ld29yayBlcnJvciBldmVudHMuXG4gICAqL1xuICBfcmVwb3J0VW5leHBlY3RlZERpc3BhdGNoRXJyb3IoY2F1Z2h0RXJyb3IsIGNvbnRleHQpIHtcbiAgICBjb25zdCBlcnJvciA9IGVuc3VyZUVycm9yKGNhdWdodEVycm9yKVxuICAgIGNvbnN0IHJlZGFjdG9yID0gdGhpcy5jb25maWd1cmF0aW9uLmdldExvZ1JlZGFjdG9yKClcbiAgICBjb25zdCByZXF1ZXN0VGltaW5nID0gdGhpcy5jb25maWd1cmF0aW9uLmdldEN1cnJlbnRSZXF1ZXN0VGltaW5nKClcbiAgICBsZXQgc2Vuc2l0aXZlVmFsdWVzID0gcmVxdWVzdFRpbWluZyA/IHJlcXVlc3RUaW1pbmcuZ2V0TG9nU2Vuc2l0aXZlVmFsdWVzKCkgOiBuZXcgU2V0KClcblxuICAgIGlmICh0aGlzLnVwZ3JhZGVSZXF1ZXN0KSB7XG4gICAgICBzZW5zaXRpdmVWYWx1ZXMgPSByZWRhY3Rvci5yZXF1ZXN0U2Vuc2l0aXZlVmFsdWVzKHRoaXMudXBncmFkZVJlcXVlc3QsIHNlbnNpdGl2ZVZhbHVlcylcbiAgICB9XG5cbiAgICBjb25zdCByZWRhY3RlZEVycm9yID0gcmVkYWN0b3IucmVkYWN0RXJyb3IoZXJyb3IsIHNlbnNpdGl2ZVZhbHVlcylcbiAgICBjb25zdCByZWRhY3RlZENvbnRleHQgPSAvKiogQHR5cGUge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gKi8gKFxuICAgICAgcmVkYWN0b3IucmVkYWN0U3RydWN0dXJlZChjb250ZXh0LCBzZW5zaXRpdmVWYWx1ZXMpXG4gICAgKVxuXG4gICAgaWYgKHRoaXMuX2V4cGVjdGVkQ2xpZW50RXJyb3IoZXJyb3IpKSByZXR1cm4gcmVkYWN0ZWRFcnJvclxuXG4gICAgY29uc3QgZXJyb3JQYXlsb2FkID0ge1xuICAgICAgY29udGV4dDogcmVkYWN0ZWRDb250ZXh0LFxuICAgICAgZXJyb3I6IHJlZGFjdGVkRXJyb3IsXG4gICAgICByZXF1ZXN0OiB0aGlzLnVwZ3JhZGVSZXF1ZXN0XG4gICAgfVxuICAgIGNvbnN0IGVycm9yRXZlbnRzID0gdGhpcy5jb25maWd1cmF0aW9uLmdldEVycm9yRXZlbnRzKClcblxuICAgIGVycm9yRXZlbnRzLmVtaXQoXCJmcmFtZXdvcmstZXJyb3JcIiwgZXJyb3JQYXlsb2FkKVxuICAgIGVycm9yRXZlbnRzLmVtaXQoXCJhbGwtZXJyb3JcIiwgey4uLmVycm9yUGF5bG9hZCwgZXJyb3JUeXBlOiBcImZyYW1ld29yay1lcnJvclwifSlcblxuICAgIHJldHVybiByZWRhY3RlZEVycm9yXG4gIH1cblxuICAvKipcbiAgICogUnVucyBoYW5kbGUgbWVzc2FnZS5cbiAgICogQHBhcmFtIHtXZWJzb2NrZXRTZXNzaW9uTWVzc2FnZX0gbWVzc2FnZSAtIE1lc3NhZ2UgdGV4dC5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgd2hlbiBjb21wbGV0ZS5cbiAgICovXG4gIGFzeW5jIF9oYW5kbGVNZXNzYWdlKG1lc3NhZ2UpIHtcbiAgICBjb25zdCBhZG1pc3Npb24gPSB0aGlzLl9hZG1pdEluYm91bmRNZXNzYWdlKDApXG5cbiAgICBpZiAoIWFkbWlzc2lvbikgcmV0dXJuXG4gICAgYXdhaXQgdGhpcy5faGFuZGxlTWVzc2FnZVdvcmsoe2FkbWlzc2lvbiwgbWVzc2FnZX0pXG4gIH1cblxuICAvKipcbiAgICogQXBwZW5kcyBhbiBhZG1pdHRlZCBtZXNzYWdlIHRvIHRoZSBwZXItc2Vzc2lvbiBGSUZPIGNoYWluLlxuICAgKiBAcGFyYW0ge0luYm91bmRNZXNzYWdlV29ya30gd29yayAtIEFkbWl0dGVkIGRlY29kZWQgbWVzc2FnZS5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgd2hlbiBjb21wbGV0ZS5cbiAgICovXG4gIGFzeW5jIF9oYW5kbGVNZXNzYWdlV29yayh3b3JrKSB7XG4gICAgLy8gU2VyaWFsaXplIHBlci1zZXNzaW9uOiBjaGFpbiBvbnRvIGBfbWVzc2FnZUNoYWluYCBzbyBtZXNzYWdlc1xuICAgIC8vIGFyZSBwcm9jZXNzZWQgb25lIGF0IGEgdGltZS4gV2l0aG91dCB0aGlzLCBmaXJlLWFuZC1mb3JnZXRcbiAgICAvLyBkaXNwYXRjaCBmcm9tIGBfcHJvY2Vzc0J1ZmZlcmAgbGV0cyBtZXNzYWdlIEIgcmVhZFxuICAgIC8vIGBzZXNzaW9uLmRhdGFgIGJlZm9yZSBBIGhhcyBmaW5pc2hlZCB3cml0aW5nIGl0LlxuICAgIGNvbnN0IHByZXZpb3VzID0gdGhpcy5fbWVzc2FnZUNoYWluXG4gICAgY29uc3QgbmV4dCA9IHByZXZpb3VzLnRoZW4oKCkgPT4gdGhpcy5fcnVuTWVzc2FnZVdvcmsod29yaykpXG5cbiAgICB0aGlzLl9tZXNzYWdlQ2hhaW4gPSBuZXh0LmNhdGNoKCgpID0+IHt9KVxuICAgIGF3YWl0IG5leHRcbiAgfVxuXG4gIC8qKlxuICAgKiBEaXNwYXRjaGVzIG9yIHRyYW5zZmVycyBvbmUgYWRtaXR0ZWQgbWVzc2FnZSB3aGlsZSByZXRhaW5pbmcgaXRzIGFjY291bnRpbmcuXG4gICAqIEBwYXJhbSB7SW5ib3VuZE1lc3NhZ2VXb3JrfSB3b3JrIC0gQWRtaXR0ZWQgZGVjb2RlZCBtZXNzYWdlLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyBhZnRlciBkaXNwYXRjaCBvciByZXNvbHZlci1xdWV1ZSB0cmFuc2Zlci5cbiAgICovXG4gIGFzeW5jIF9ydW5NZXNzYWdlV29yayh3b3JrKSB7XG4gICAgaWYgKHRoaXMuX2luYm91bmRDbG9zZWQpIHtcbiAgICAgIHRoaXMuX3JlbGVhc2VJbmJvdW5kQWRtaXNzaW9uKHdvcmsuYWRtaXNzaW9uKVxuICAgICAgcmV0dXJuXG4gICAgfVxuXG4gICAgaWYgKHRoaXMucGVuZGluZ01lc3NhZ2VIYW5kbGVyKSB7XG4gICAgICB0aGlzLm1lc3NhZ2VRdWV1ZS5wdXNoKHdvcmspXG4gICAgICByZXR1cm5cbiAgICB9XG5cbiAgICB0cnkge1xuICAgICAgYXdhaXQgdGhpcy5fZGlzcGF0Y2hNZXNzYWdlKHdvcmsubWVzc2FnZSlcbiAgICB9IGZpbmFsbHkge1xuICAgICAgdGhpcy5fcmVsZWFzZUluYm91bmRBZG1pc3Npb24od29yay5hZG1pc3Npb24pXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZGlzcGF0Y2ggbWVzc2FnZS5cbiAgICogQHBhcmFtIHtXZWJzb2NrZXRTZXNzaW9uTWVzc2FnZX0gbWVzc2FnZSAtIE1lc3NhZ2UgdGV4dC5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgd2hlbiBjb21wbGV0ZS5cbiAgICovXG4gIGFzeW5jIF9kaXNwYXRjaE1lc3NhZ2UobWVzc2FnZSkge1xuICAgIGF3YWl0IHRoaXMuX3J1bldpdGhNZXNzYWdlTG9nQ29udGV4dChtZXNzYWdlLCBhc3luYyAoKSA9PiB7XG4gICAgICBjb25zdCB3cmFwcGVyID0gdGhpcy5jb25maWd1cmF0aW9uLmdldFdlYnNvY2tldEFyb3VuZFJlcXVlc3Q/LigpXG5cbiAgICAgIGlmICh3cmFwcGVyKSB7XG4gICAgICAgIGF3YWl0IHdyYXBwZXIodGhpcywgKCkgPT4gdGhpcy5faGFuZGxlTWVzc2FnZUlubmVyKG1lc3NhZ2UpKVxuICAgICAgICByZXR1cm5cbiAgICAgIH1cblxuICAgICAgYXdhaXQgdGhpcy5faGFuZGxlTWVzc2FnZUlubmVyKG1lc3NhZ2UpXG4gICAgfSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIG9uZSBkZWNvZGVkIG1lc3NhZ2UgaW4gaXRzIG93biByZXF1ZXN0IHRpbWluZyBhbmQgc2Vuc2l0aXZlLXZhbHVlIGNvbnRleHQuXG4gICAqIEBwYXJhbSB7V2Vic29ja2V0U2Vzc2lvbk1lc3NhZ2V9IG1lc3NhZ2UgLSBEZWNvZGVkIGNsaWVudCBtZXNzYWdlLlxuICAgKiBAcGFyYW0geygpID0+IFByb21pc2U8dm9pZD59IGNhbGxiYWNrIC0gTWVzc2FnZSBkaXNwYXRjaCBjYWxsYmFjay5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgYWZ0ZXIgdGhlIG1lc3NhZ2UgZmluaXNoZXMuXG4gICAqL1xuICBhc3luYyBfcnVuV2l0aE1lc3NhZ2VMb2dDb250ZXh0KG1lc3NhZ2UsIGNhbGxiYWNrKSB7XG4gICAgY29uc3QgcmVxdWVzdFRpbWluZyA9IG5ldyBSZXF1ZXN0VGltaW5nKClcbiAgICBjb25zdCByZWRhY3RvciA9IHRoaXMuY29uZmlndXJhdGlvbi5nZXRMb2dSZWRhY3RvcigpXG4gICAgbGV0IHNlbnNpdGl2ZVZhbHVlcyA9IHJlZGFjdG9yLnNlbnNpdGl2ZVZhbHVlcyhtZXNzYWdlKVxuXG4gICAgc2Vuc2l0aXZlVmFsdWVzID0gcmVkYWN0b3Iuc2Vuc2l0aXZlVmFsdWVzKHRoaXMuZ2V0TWV0YWRhdGEoKSwgc2Vuc2l0aXZlVmFsdWVzKVxuXG4gICAgaWYgKHRoaXMudXBncmFkZVJlcXVlc3QpIHtcbiAgICAgIHNlbnNpdGl2ZVZhbHVlcyA9IHJlZGFjdG9yLnJlcXVlc3RTZW5zaXRpdmVWYWx1ZXModGhpcy51cGdyYWRlUmVxdWVzdCwgc2Vuc2l0aXZlVmFsdWVzKVxuICAgIH1cblxuICAgIHJlcXVlc3RUaW1pbmcucmVnaXN0ZXJMb2dTZW5zaXRpdmVWYWx1ZXMoc2Vuc2l0aXZlVmFsdWVzKVxuXG4gICAgYXdhaXQgdGhpcy5jb25maWd1cmF0aW9uLnJ1bldpdGhSZXF1ZXN0VGltaW5nKHJlcXVlc3RUaW1pbmcsIGNhbGxiYWNrKVxuICB9XG5cbiAgLyoqXG4gICAqIFRoZSBhY3R1YWwgbWVzc2FnZSBkaXNwYXRjaCwgZXh0cmFjdGVkIHNvXG4gICAqIGBjb25maWd1cmF0aW9uLmdldFdlYnNvY2tldEFyb3VuZFJlcXVlc3QoKWAgY2FuIHdyYXAgaXQgaW4gYW55XG4gICAqIHBlci1yZXF1ZXN0IGNvbnRleHQgKEFzeW5jTG9jYWxTdG9yYWdlLCB0cmFjaW5nLCBldGMuKS5cbiAgICogQHBhcmFtIHtXZWJzb2NrZXRTZXNzaW9uTWVzc2FnZX0gbWVzc2FnZSAtIERlY29kZWQgY2xpZW50IGZyYW1lIHRvIGRpc3BhdGNoIGJ5IG1lc3NhZ2UgdHlwZS5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59XG4gICAqL1xuICBhc3luYyBfaGFuZGxlTWVzc2FnZUlubmVyKG1lc3NhZ2UpIHtcbiAgICAvLyBUaGUgbWVzc2FnZUhhbmRsZXIgc2hvcnQtY2lyY3VpdHMgZGVmYXVsdCByb3V0aW5nIG9ubHkgd2hlbiB0aGVcbiAgICAvLyBhcHAgYWN0dWFsbHkgZGVjbGFyZWQgYW4gYG9uTWVzc2FnZWAgaG9vay4gQXBwcyB0aGF0IG9ubHkgd2FudFxuICAgIC8vIHNlc3Npb24tbGlmZWN5Y2xlIHRyYWNraW5nIChgb25PcGVuYC9gb25DbG9zZWApIHN0aWxsIG5lZWQgdGhlXG4gICAgLy8gYnVpbHQtaW4gc3Vic2NyaWJlL2Nvbm5lY3Rpb24vY2hhbm5lbC1zdWJzY3JpYmUgcm91dGluZyBiZWxvdyxcbiAgICAvLyBvdGhlcndpc2UgZXZlcnkgaW5jb21pbmcgbWVzc2FnZSBpcyBzaWxlbnRseSBkcm9wcGVkLlxuICAgIGlmICh0aGlzLm1lc3NhZ2VIYW5kbGVyICYmIHR5cGVvZiB0aGlzLm1lc3NhZ2VIYW5kbGVyLm9uTWVzc2FnZSA9PT0gXCJmdW5jdGlvblwiKSB7XG4gICAgICBhd2FpdCB0aGlzLl9ydW5NZXNzYWdlSGFuZGxlck1lc3NhZ2UobWVzc2FnZSlcbiAgICAgIHJldHVyblxuICAgIH1cblxuICAgIGNvbnN0IHN1YnNjcmliZVBheWxvYWQgPSBzdWJzY3JpYmVNZXNzYWdlKG1lc3NhZ2UpXG5cbiAgICBpZiAoc3Vic2NyaWJlUGF5bG9hZCkge1xuICAgICAgY29uc3Qge2NoYW5uZWwsIGxhc3RFdmVudElkLCBwYXJhbXN9ID0gc3Vic2NyaWJlUGF5bG9hZFxuXG4gICAgICBpZiAoIWNoYW5uZWwpIHRocm93IFZlbG9jaW91c0Vycm9yLnNhZmUoXCJjaGFubmVsIGlzIHJlcXVpcmVkIGZvciBzdWJzY3JpYmVcIilcbiAgICAgIGNvbnN0IHJlc29sdmVyID0gdGhpcy5jb25maWd1cmF0aW9uLmdldFdlYnNvY2tldENoYW5uZWxSZXNvbHZlcj8uKClcblxuICAgICAgaWYgKHJlc29sdmVyKSB7XG4gICAgICAgIGF3YWl0IHRoaXMuX2hhbmRsZUNoYW5uZWxTdWJzY3JpcHRpb24oe2NoYW5uZWwsIGxhc3RFdmVudElkLCBwYXJhbXN9KVxuICAgICAgfSBlbHNlIHtcbiAgICAgICAgYXdhaXQgdGhpcy5zdWJzY3JpYmVUb0NoYW5uZWwoY2hhbm5lbCwge2Fja25vd2xlZGdlOiB0cnVlLCBsYXN0RXZlbnRJZCwgcGFyYW1zfSlcbiAgICAgIH1cblxuICAgICAgcmV0dXJuXG4gICAgfVxuXG4gICAgaWYgKG1lc3NhZ2UudHlwZSA9PT0gXCJtZXRhZGF0YVwiKSB7XG4gICAgICBjb25zdCBtZXRhZGF0YVBheWxvYWQgPSAvKiogQHR5cGUge3tkYXRhPzogUmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fX0gKi8gKG1lc3NhZ2UpXG5cbiAgICAgIHRoaXMuX21ldGFkYXRhID0gbWV0YWRhdGFQYXlsb2FkLmRhdGEgJiYgdHlwZW9mIG1ldGFkYXRhUGF5bG9hZC5kYXRhID09PSBcIm9iamVjdFwiID8gey4uLm1ldGFkYXRhUGF5bG9hZC5kYXRhfSA6IHt9XG5cbiAgICAgIGZvciAoY29uc3Qge3N1YnNjcmlwdGlvbn0gb2YgdGhpcy5fY2hhbm5lbFN1YnNjcmlwdGlvbnMudmFsdWVzKCkpIHtcbiAgICAgICAgaWYgKHR5cGVvZiBzdWJzY3JpcHRpb24ub25NZXRhZGF0YUNoYW5nZWQgPT09IFwiZnVuY3Rpb25cIikge1xuICAgICAgICAgIGF3YWl0IHRoaXMuX3dpdGhDb25uZWN0aW9ucyhhc3luYyAoKSA9PiB7XG4gICAgICAgICAgICBhd2FpdCBzdWJzY3JpcHRpb24ub25NZXRhZGF0YUNoYW5nZWQodGhpcy5fbWV0YWRhdGEpXG4gICAgICAgICAgfSlcbiAgICAgICAgfVxuICAgICAgfVxuXG4gICAgICByZXR1cm5cbiAgICB9XG5cbiAgICBpZiAobWVzc2FnZS50eXBlID09PSBcInNlc3Npb24tcmVzdW1lXCIpIHtcbiAgICAgIGF3YWl0IHRoaXMuX2hhbmRsZVNlc3Npb25SZXN1bWUobWVzc2FnZSlcbiAgICAgIHJldHVyblxuICAgIH1cblxuICAgIGlmIChtZXNzYWdlLnR5cGUgPT09IFwiY29ubmVjdGlvbi1vcGVuXCIpIHtcbiAgICAgIGF3YWl0IHRoaXMuX2hhbmRsZUNvbm5lY3Rpb25PcGVuKG1lc3NhZ2UpXG4gICAgICByZXR1cm5cbiAgICB9XG5cbiAgICBpZiAobWVzc2FnZS50eXBlID09PSBcImNvbm5lY3Rpb24tbWVzc2FnZVwiKSB7XG4gICAgICBhd2FpdCB0aGlzLl9oYW5kbGVDb25uZWN0aW9uTWVzc2FnZShtZXNzYWdlKVxuICAgICAgcmV0dXJuXG4gICAgfVxuXG4gICAgaWYgKG1lc3NhZ2UudHlwZSA9PT0gXCJjb25uZWN0aW9uLWNsb3NlXCIpIHtcbiAgICAgIGF3YWl0IHRoaXMuX2hhbmRsZUNvbm5lY3Rpb25DbG9zZShtZXNzYWdlKVxuICAgICAgcmV0dXJuXG4gICAgfVxuXG4gICAgaWYgKG1lc3NhZ2UudHlwZSA9PT0gXCJjaGFubmVsLXN1YnNjcmliZVwiKSB7XG4gICAgICBhd2FpdCB0aGlzLl9oYW5kbGVDaGFubmVsU3Vic2NyaWJlKG1lc3NhZ2UpXG4gICAgICByZXR1cm5cbiAgICB9XG5cbiAgICBpZiAobWVzc2FnZS50eXBlID09PSBcImNoYW5uZWwtdW5zdWJzY3JpYmVcIikge1xuICAgICAgYXdhaXQgdGhpcy5faGFuZGxlQ2hhbm5lbFVuc3Vic2NyaWJlKG1lc3NhZ2UpXG4gICAgICByZXR1cm5cbiAgICB9XG5cbiAgICBpZiAobWVzc2FnZS50eXBlICYmIG1lc3NhZ2UudHlwZSAhPT0gXCJyZXF1ZXN0XCIpIHtcbiAgICAgIHRoaXMuc2VuZEpzb24oe2Vycm9yOiBgVW5rbm93biBtZXNzYWdlIHR5cGU6ICR7bWVzc2FnZS50eXBlfWAsIHR5cGU6IFwiZXJyb3JcIn0pXG4gICAgICByZXR1cm5cbiAgICB9XG5cbiAgICBjb25zdCByZXF1ZXN0UGF5bG9hZCA9IHJlcXVlc3RNZXNzYWdlKG1lc3NhZ2UpXG5cbiAgICBpZiAoIXJlcXVlc3RQYXlsb2FkKSB7XG4gICAgICB0aGlzLnNlbmRKc29uKHtlcnJvcjogYFVua25vd24gbWVzc2FnZSB0eXBlOiAke21lc3NhZ2UudHlwZX1gLCB0eXBlOiBcImVycm9yXCJ9KVxuICAgICAgcmV0dXJuXG4gICAgfVxuXG4gICAgY29uc3Qge2JvZHksIGhlYWRlcnMsIGlkLCBtZXRob2QsIHBhdGh9ID0gcmVxdWVzdFBheWxvYWRcblxuICAgIGlmICghbWV0aG9kKSB0aHJvdyBWZWxvY2lvdXNFcnJvci5zYWZlKFwibWV0aG9kIGlzIHJlcXVpcmVkXCIpXG4gICAgaWYgKCFwYXRoKSB0aHJvdyBWZWxvY2lvdXNFcnJvci5zYWZlKFwicGF0aCBpcyByZXF1aXJlZFwiKVxuXG4gICAgY29uc3QgcmVxdWVzdCA9IG5ldyBXZWJzb2NrZXRSZXF1ZXN0KHtcbiAgICAgIGJvZHksXG4gICAgICBoZWFkZXJzLFxuICAgICAgbWV0YWRhdGE6IHRoaXMuZ2V0TWV0YWRhdGEoKSxcbiAgICAgIG1ldGhvZCxcbiAgICAgIHBhdGgsXG4gICAgICByZW1vdGVBZGRyZXNzOiB0aGlzLnJlbW90ZUFkZHJlc3MoKVxuICAgIH0pXG4gICAgY29uc3QgcmVxdWVzdFJ1bm5lciA9IG5ldyBSZXF1ZXN0UnVubmVyKHtcbiAgICAgIGNvbmZpZ3VyYXRpb246IHRoaXMuY29uZmlndXJhdGlvbixcbiAgICAgIHJlcXVlc3RcbiAgICB9KVxuXG4gICAgcmVxdWVzdFJ1bm5lci5ldmVudHMub24oXCJkb25lXCIsICgpID0+IHtcbiAgICAgIGNvbnN0IHJlc3BvbnNlID0gcmVxdWVzdFJ1bm5lci5yZXNwb25zZVxuICAgICAgY29uc3QgYm9keSA9IHJlc3BvbnNlLmdldEJvZHkoKVxuICAgICAgY29uc3QgaGVhZGVycyA9IHJlc3BvbnNlLmhlYWRlcnNcblxuICAgICAgdGhpcy5zZW5kSnNvbih7XG4gICAgICAgIGJvZHksXG4gICAgICAgIGhlYWRlcnMsXG4gICAgICAgIGlkLFxuICAgICAgICBzdGF0dXNDb2RlOiByZXNwb25zZS5nZXRTdGF0dXNDb2RlKCksXG4gICAgICAgIHN0YXR1c01lc3NhZ2U6IHJlc3BvbnNlLmdldFN0YXR1c01lc3NhZ2UoKSxcbiAgICAgICAgdHlwZTogXCJyZXNwb25zZVwiXG4gICAgICB9KVxuICAgICAgdm9pZCByZXF1ZXN0UnVubmVyLmxvZ0NvbXBsZXRlZFJlcXVlc3QoKS5jYXRjaCgoZXJyb3IpID0+IHtcbiAgICAgICAgdGhpcy5sb2dnZXIud2FybihcIkZhaWxlZCB0byBsb2cgY29tcGxldGVkIHJlcXVlc3RcIiwgZXJyb3IpXG4gICAgICB9KVxuICAgIH0pXG5cbiAgICBhd2FpdCByZXF1ZXN0UnVubmVyLnJ1bigpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBwcm9jZXNzIGJ1ZmZlci5cbiAgICogQHJldHVybnMge3ZvaWR9IC0gTm8gcmV0dXJuIHZhbHVlLlxuICAgKi9cbiAgX3Byb2Nlc3NCdWZmZXIoKSB7XG4gICAgd2hpbGUgKHRoaXMuX2J1ZmZlcmVkQnl0ZXMgPj0gMikge1xuICAgICAgY29uc3QgaW5pdGlhbEhlYWRlciA9IHRoaXMuX3BlZWtCdWZmZXJlZEJ5dGVzKDIpXG4gICAgICBjb25zdCBmaXJzdEJ5dGUgPSBpbml0aWFsSGVhZGVyWzBdXG4gICAgICBjb25zdCBzZWNvbmRCeXRlID0gaW5pdGlhbEhlYWRlclsxXVxuICAgICAgY29uc3QgaXNGaW5hbCA9IChmaXJzdEJ5dGUgJiBXRUJTT0NLRVRfRklOQUxfRlJBTUUpID09PSBXRUJTT0NLRVRfRklOQUxfRlJBTUVcbiAgICAgIGNvbnN0IG9wY29kZSA9IGZpcnN0Qnl0ZSAmIDB4MEZcbiAgICAgIGNvbnN0IGlzTWFza2VkID0gKHNlY29uZEJ5dGUgJiAweDgwKSA9PT0gMHg4MFxuICAgICAgbGV0IHBheWxvYWRMZW5ndGggPSBzZWNvbmRCeXRlICYgMHg3RlxuICAgICAgbGV0IG9mZnNldCA9IDJcblxuICAgICAgaWYgKHBheWxvYWRMZW5ndGggPT09IDEyNikge1xuICAgICAgICBpZiAodGhpcy5fYnVmZmVyZWRCeXRlcyA8IG9mZnNldCArIDIpIHJldHVyblxuICAgICAgICBwYXlsb2FkTGVuZ3RoID0gdGhpcy5fcGVla0J1ZmZlcmVkQnl0ZXMob2Zmc2V0ICsgMikucmVhZFVJbnQxNkJFKG9mZnNldClcbiAgICAgICAgb2Zmc2V0ICs9IDJcbiAgICAgIH0gZWxzZSBpZiAocGF5bG9hZExlbmd0aCA9PT0gMTI3KSB7XG4gICAgICAgIGlmICh0aGlzLl9idWZmZXJlZEJ5dGVzIDwgb2Zmc2V0ICsgOCkgcmV0dXJuXG4gICAgICAgIGNvbnN0IGJpZ0xlbmd0aCA9IHRoaXMuX3BlZWtCdWZmZXJlZEJ5dGVzKG9mZnNldCArIDgpLnJlYWRCaWdVSW50NjRCRShvZmZzZXQpXG5cbiAgICAgICAgaWYgKGJpZ0xlbmd0aCA+IFdFQlNPQ0tFVF9NQVhfSU5CT1VORF9GUkFNRV9CWVRFU19CSUdJTlQpIHtcbiAgICAgICAgICB0aGlzLmxvZ2dlci53YXJuKCgpID0+IFtcbiAgICAgICAgICAgIFwiV2Vic29ja2V0IGZyYW1lIGV4Y2VlZGVkIGJ5dGUgY2FwOyBjbG9zaW5nIGNvbm5lY3Rpb25cIixcbiAgICAgICAgICAgIHtmcmFtZUJ5dGVzOiBiaWdMZW5ndGgudG9TdHJpbmcoKSwgbWF4Qnl0ZXM6IFdFQlNPQ0tFVF9NQVhfRklOQUxfRlJBTUVfQllURVN9XG4gICAgICAgICAgXSlcbiAgICAgICAgICB0aGlzLl9jbG9zZUZvckluYm91bmRMaW1pdCgpXG4gICAgICAgICAgcmV0dXJuXG4gICAgICAgIH1cblxuICAgICAgICBwYXlsb2FkTGVuZ3RoID0gTnVtYmVyKGJpZ0xlbmd0aClcbiAgICAgICAgb2Zmc2V0ICs9IDhcbiAgICAgIH1cblxuICAgICAgY29uc3QgbWFza0xlbmd0aCA9IGlzTWFza2VkID8gNCA6IDBcblxuICAgICAgY29uc3QgZnJhbWVMZW5ndGggPSBvZmZzZXQgKyBtYXNrTGVuZ3RoICsgcGF5bG9hZExlbmd0aFxuXG4gICAgICBpZiAodGhpcy5fYnVmZmVyZWRCeXRlcyA8IGZyYW1lTGVuZ3RoKSByZXR1cm5cblxuICAgICAgY29uc3QgZnJhbWUgPSB0aGlzLl9jb25zdW1lQnVmZmVyZWRCeXRlcyhmcmFtZUxlbmd0aClcblxuICAgICAgLyoqIEB0eXBlIHtCdWZmZXJ9ICovXG4gICAgICBsZXQgcGF5bG9hZCA9IGZyYW1lLnN1YmFycmF5KG9mZnNldCArIG1hc2tMZW5ndGgsIGZyYW1lTGVuZ3RoKVxuXG4gICAgICBpZiAoaXNNYXNrZWQpIHtcbiAgICAgICAgY29uc3QgbWFzayA9IGZyYW1lLnN1YmFycmF5KG9mZnNldCwgb2Zmc2V0ICsgbWFza0xlbmd0aClcbiAgICAgICAgdGhpcy5fdW5tYXNrUGF5bG9hZChwYXlsb2FkLCBtYXNrKVxuICAgICAgfVxuXG4gICAgICAvLyBDb250cm9sIGZyYW1lcyAob3Bjb2RlID49IDB4OCkgbXVzdCBub3QgYmUgZnJhZ21lbnRlZCBwZXJcbiAgICAgIC8vIFJGQyA2NDU1IGFuZCBjYW4gYXJyaXZlIGludGVybGVhdmVkIHdpdGggYSBmcmFnbWVudGVkIGRhdGFcbiAgICAgIC8vIG1lc3NhZ2UuIEhhbmRsZSB0aGVtIGZpcnN0IHdpdGhvdXQgdG91Y2hpbmcgdGhlIGZyYWdtZW50XG4gICAgICAvLyBhY2N1bXVsYXRvci5cbiAgICAgIGlmIChvcGNvZGUgPT09IFdFQlNPQ0tFVF9PUENPREVfUElORykge1xuICAgICAgICB0aGlzLl9zZW5kQ29udHJvbEZyYW1lKFdFQlNPQ0tFVF9PUENPREVfUE9ORywgcGF5bG9hZClcbiAgICAgICAgY29udGludWVcbiAgICAgIH1cblxuICAgICAgaWYgKG9wY29kZSA9PT0gV0VCU09DS0VUX09QQ09ERV9DTE9TRSkge1xuICAgICAgICBjb25zdCBhbGxvd1Jlc3VtZSA9IHBheWxvYWQubGVuZ3RoIDwgMiB8fCBwYXlsb2FkLnJlYWRVSW50MTZCRSgwKSAhPT0gV0VCU09DS0VUX0NMT1NFX05PUk1BTFxuXG4gICAgICAgIHRoaXMuc2VuZEdvb2RieWUodGhpcy5jbGllbnQpXG4gICAgICAgIHRoaXMuX2hhbmRsZUNsb3NlKHthbGxvd1Jlc3VtZX0pXG4gICAgICAgIGNvbnRpbnVlXG4gICAgICB9XG5cbiAgICAgIGlmIChvcGNvZGUgPT09IFdFQlNPQ0tFVF9PUENPREVfUE9ORykge1xuICAgICAgICAvLyBBbnN3ZXIgdG8gYSBoZWFydGJlYXQgcGluZzsgbGl2ZW5lc3MgaXMgcmVjb3JkZWQgaW4gb25EYXRhLlxuICAgICAgICBjb250aW51ZVxuICAgICAgfVxuXG4gICAgICBpZiAob3Bjb2RlID49IDB4OCkge1xuICAgICAgICB0aGlzLmxvZ2dlci53YXJuKGBVbnN1cHBvcnRlZCB3ZWJzb2NrZXQgY29udHJvbCBvcGNvZGU6ICR7b3Bjb2RlfWApXG4gICAgICAgIGNvbnRpbnVlXG4gICAgICB9XG5cbiAgICAgIC8vIERhdGEgZnJhbWUgKFRFWFQvQklOQVJZL0NPTlRJTlVBVElPTikuIFJlYXNzZW1ibGUgZnJhZ21lbnRzXG4gICAgICAvLyBiZWZvcmUgZGlzcGF0Y2hpbmcuIEJyb3dzZXJzIChDaHJvbWUpIGxlZ2l0aW1hdGVseSBmcmFnbWVudFxuICAgICAgLy8gbG9uZ2VyIGNsaWVudOKGknNlcnZlciB0ZXh0IGZyYW1lczsgYSBwcmlvciB2ZXJzaW9uIGRyb3BwZWRcbiAgICAgIC8vIGV2ZXJ5IGZyYWdtZW50ZWQgbWVzc2FnZSBzaWxlbnRseSwgc28gYW55IHBheWxvYWQgbGFyZ2VcbiAgICAgIC8vIGVub3VnaCB0byBoaXQgdGhlIGJyb3dzZXIncyBmcmFnbWVudGF0aW9uIHRocmVzaG9sZFxuICAgICAgLy8gKGUuZy4gYSBjaGFubmVsLXN1YnNjcmliZSB3aXRoIGFuIGF1dGggdG9rZW4pIG5ldmVyIHJlYWNoZWRcbiAgICAgIC8vIHRoZSBoYW5kbGVyLlxuICAgICAgaWYgKG9wY29kZSA9PT0gV0VCU09DS0VUX09QQ09ERV9DT05USU5VQVRJT04pIHtcbiAgICAgICAgaWYgKHRoaXMuX2ZyYWdtZW50ZWRQYXlsb2FkcyA9PT0gbnVsbCkge1xuICAgICAgICAgIHRoaXMubG9nZ2VyLndhcm4oXCJSZWNlaXZlZCBjb250aW51YXRpb24gZnJhbWUgd2l0aCBubyBmcmFnbWVudGVkIG1lc3NhZ2UgaW4gcHJvZ3Jlc3NcIilcbiAgICAgICAgICBjb250aW51ZVxuICAgICAgICB9XG5cbiAgICAgICAgaWYgKCF0aGlzLl9hcHBlbmRGcmFnbWVudChwYXlsb2FkKSkgcmV0dXJuXG5cbiAgICAgICAgaWYgKCFpc0ZpbmFsKSBjb250aW51ZVxuICAgICAgfSBlbHNlIGlmIChvcGNvZGUgPT09IFdFQlNPQ0tFVF9PUENPREVfVEVYVCB8fCBvcGNvZGUgPT09IFdFQlNPQ0tFVF9PUENPREVfQklOQVJZKSB7XG4gICAgICAgIGlmICh0aGlzLl9mcmFnbWVudGVkUGF5bG9hZHMgIT09IG51bGwpIHtcbiAgICAgICAgICB0aGlzLmxvZ2dlci53YXJuKFwiUmVjZWl2ZWQgbmV3IGRhdGEgZnJhbWUgd2hpbGUgYSBmcmFnbWVudGVkIG1lc3NhZ2Ugd2FzIGluIHByb2dyZXNzOyBkaXNjYXJkaW5nIHByaW9yIGZyYWdtZW50c1wiKVxuICAgICAgICAgIHRoaXMuX3Jlc2V0RnJhZ21lbnRCdWZmZXIoKVxuICAgICAgICB9XG5cbiAgICAgICAgaWYgKCFpc0ZpbmFsKSB7XG4gICAgICAgICAgdGhpcy5fZnJhZ21lbnRlZFBheWxvYWRzID0gW3BheWxvYWRdXG4gICAgICAgICAgdGhpcy5fZnJhZ21lbnRlZE9wY29kZSA9IG9wY29kZVxuICAgICAgICAgIHRoaXMuX2ZyYWdtZW50ZWRCeXRlcyA9IHBheWxvYWQubGVuZ3RoXG5cbiAgICAgICAgICBpZiAoIXRoaXMuX2VuZm9yY2VGcmFnbWVudExpbWl0cygpKSByZXR1cm5cblxuICAgICAgICAgIGNvbnRpbnVlXG4gICAgICAgIH1cbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIHRoaXMubG9nZ2VyLndhcm4oYFVuc3VwcG9ydGVkIHdlYnNvY2tldCBkYXRhIG9wY29kZTogJHtvcGNvZGV9YClcbiAgICAgICAgY29udGludWVcbiAgICAgIH1cblxuICAgICAgLyoqXG4gICAgICAgKiBEZWZpbmVzIGZpbmFsUGF5bG9hZC5cbiAgICAgICAqIEB0eXBlIHtCdWZmZXJ9ICovXG4gICAgICBsZXQgZmluYWxQYXlsb2FkXG4gICAgICAvKipcbiAgICAgICAqIERlZmluZXMgZmluYWxPcGNvZGUuXG4gICAgICAgKiBAdHlwZSB7bnVtYmVyfSAqL1xuICAgICAgbGV0IGZpbmFsT3Bjb2RlXG5cbiAgICAgIGlmICh0aGlzLl9mcmFnbWVudGVkUGF5bG9hZHMgIT09IG51bGwpIHtcbiAgICAgICAgaWYgKG9wY29kZSA9PT0gV0VCU09DS0VUX09QQ09ERV9DT05USU5VQVRJT04pIHtcbiAgICAgICAgICBmaW5hbFBheWxvYWQgPSBCdWZmZXIuY29uY2F0KHRoaXMuX2ZyYWdtZW50ZWRQYXlsb2FkcylcbiAgICAgICAgICBmaW5hbE9wY29kZSA9IHRoaXMuX2ZyYWdtZW50ZWRPcGNvZGUgPz8gV0VCU09DS0VUX09QQ09ERV9URVhUXG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgZmluYWxQYXlsb2FkID0gcGF5bG9hZFxuICAgICAgICAgIGZpbmFsT3Bjb2RlID0gb3Bjb2RlXG4gICAgICAgIH1cbiAgICAgICAgdGhpcy5fcmVzZXRGcmFnbWVudEJ1ZmZlcigpXG4gICAgICB9IGVsc2Uge1xuICAgICAgICBmaW5hbFBheWxvYWQgPSBwYXlsb2FkXG4gICAgICAgIGZpbmFsT3Bjb2RlID0gb3Bjb2RlXG4gICAgICB9XG5cbiAgICAgIGlmIChmaW5hbE9wY29kZSAhPT0gV0VCU09DS0VUX09QQ09ERV9URVhUKSB7XG4gICAgICAgIHRoaXMubG9nZ2VyLndhcm4oYFVuc3VwcG9ydGVkIHdlYnNvY2tldCBkYXRhIG9wY29kZSBhZnRlciByZWFzc2VtYmx5OiAke2ZpbmFsT3Bjb2RlfWApXG4gICAgICAgIGNvbnRpbnVlXG4gICAgICB9XG5cbiAgICAgIGNvbnN0IGFkbWlzc2lvbiA9IHRoaXMuX2FkbWl0SW5ib3VuZE1lc3NhZ2UoZmluYWxQYXlsb2FkLmxlbmd0aClcblxuICAgICAgaWYgKCFhZG1pc3Npb24pIHJldHVyblxuXG4gICAgICB0cnkge1xuICAgICAgICBjb25zdCBtZXNzYWdlID0gSlNPTi5wYXJzZShmaW5hbFBheWxvYWQudG9TdHJpbmcoXCJ1dGYtOFwiKSlcblxuICAgICAgICB0aGlzLl9oYW5kbGVNZXNzYWdlV29yayh7YWRtaXNzaW9uLCBtZXNzYWdlfSkuY2F0Y2goKGNhdWdodEVycm9yKSA9PiB7XG4gICAgICAgICAgY29uc3QgY2xpZW50RXJyb3JNZXNzYWdlID0gY2F1Z2h0RXJyb3IgaW5zdGFuY2VvZiBFcnJvciA/IGNhdWdodEVycm9yLm1lc3NhZ2UgOiBTdHJpbmcoY2F1Z2h0RXJyb3IpXG4gICAgICAgICAgY29uc3QgZXJyb3IgPSB0aGlzLl9yZXBvcnRVbmV4cGVjdGVkRGlzcGF0Y2hFcnJvcihjYXVnaHRFcnJvciwge1xuICAgICAgICAgICAgc3RhZ2U6IFwid2Vic29ja2V0LW1lc3NhZ2UtZGlzcGF0Y2hcIlxuICAgICAgICAgIH0pXG5cbiAgICAgICAgICB0aGlzLmxvZ2dlci5lcnJvcigoKSA9PiBbXCJXZWJzb2NrZXQgbWVzc2FnZSBoYW5kbGVyIGZhaWxlZFwiLCBlcnJvcl0pXG4gICAgICAgICAgdGhpcy5zZW5kSnNvbih7XG4gICAgICAgICAgICBlcnJvcjogY2xpZW50RXJyb3JNZXNzYWdlLFxuICAgICAgICAgICAgdHlwZTogXCJlcnJvclwiXG4gICAgICAgICAgfSlcbiAgICAgICAgfSlcbiAgICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICAgIHRoaXMuX3JlbGVhc2VJbmJvdW5kQWRtaXNzaW9uKGFkbWlzc2lvbilcbiAgICAgICAgdGhpcy5sb2dnZXIuZXJyb3IoKCkgPT4gW1wiRmFpbGVkIHRvIHBhcnNlIHdlYnNvY2tldCBtZXNzYWdlXCIsIGVycm9yXSlcbiAgICAgICAgdGhpcy5zZW5kSnNvbih7ZXJyb3I6IFwiSW52YWxpZCB3ZWJzb2NrZXQgbWVzc2FnZVwiLCB0eXBlOiBcImVycm9yXCJ9KVxuICAgICAgfVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBDb3BpZXMgdGhlIGxlYWRpbmcgYnVmZmVyZWQgYnl0ZXMgd2l0aG91dCBjb25zdW1pbmcgdGhlbS4gSGVhZGVyXG4gICAqIGluc3BlY3Rpb24gaXMgYm91bmRlZCB0byB0aGUgd2Vic29ja2V0IGhlYWRlciBzaXplLlxuICAgKiBAcGFyYW0ge251bWJlcn0gYnl0ZUNvdW50IC0gTnVtYmVyIG9mIGxlYWRpbmcgYnl0ZXMgdG8gaW5zcGVjdC5cbiAgICogQHJldHVybnMge0J1ZmZlcn0gLSBDb3BpZWQgcHJlZml4LlxuICAgKi9cbiAgX3BlZWtCdWZmZXJlZEJ5dGVzKGJ5dGVDb3VudCkge1xuICAgIGNvbnN0IHByZWZpeCA9IEJ1ZmZlci5hbGxvY1Vuc2FmZShieXRlQ291bnQpXG4gICAgbGV0IGNvcGllZEJ5dGVzID0gMFxuICAgIGxldCBjaHVua09mZnNldCA9IHRoaXMuX2J1ZmZlckNodW5rT2Zmc2V0XG5cbiAgICBmb3IgKGxldCBjaHVua0luZGV4ID0gdGhpcy5fYnVmZmVyQ2h1bmtJbmRleDsgY2h1bmtJbmRleCA8IHRoaXMuX2J1ZmZlckNodW5rcy5sZW5ndGg7IGNodW5rSW5kZXggKz0gMSkge1xuICAgICAgY29uc3QgY2h1bmsgPSB0aGlzLl9idWZmZXJDaHVua3NbY2h1bmtJbmRleF1cbiAgICAgIGNvbnN0IGJ5dGVzRnJvbUNodW5rID0gTWF0aC5taW4oY2h1bmsubGVuZ3RoIC0gY2h1bmtPZmZzZXQsIGJ5dGVDb3VudCAtIGNvcGllZEJ5dGVzKVxuXG4gICAgICBjaHVuay5jb3B5KHByZWZpeCwgY29waWVkQnl0ZXMsIGNodW5rT2Zmc2V0LCBjaHVua09mZnNldCArIGJ5dGVzRnJvbUNodW5rKVxuICAgICAgY29waWVkQnl0ZXMgKz0gYnl0ZXNGcm9tQ2h1bmtcbiAgICAgIGNodW5rT2Zmc2V0ID0gMFxuICAgICAgaWYgKGNvcGllZEJ5dGVzID09PSBieXRlQ291bnQpIGJyZWFrXG4gICAgfVxuXG4gICAgcmV0dXJuIHByZWZpeFxuICB9XG5cbiAgLyoqXG4gICAqIENvbnN1bWVzIGEgY29tcGxldGUgZnJhbWUgZnJvbSB0aGUgY2h1bmsgcXVldWUgd2l0aCBvbmUgYm91bmRlZCBjb3B5LlxuICAgKiBAcGFyYW0ge251bWJlcn0gYnl0ZUNvdW50IC0gQ29tcGxldGUgZnJhbWUgYnl0ZSBjb3VudC5cbiAgICogQHJldHVybnMge0J1ZmZlcn0gLSBDb250aWd1b3VzIGZyYW1lIGJ5dGVzLlxuICAgKi9cbiAgX2NvbnN1bWVCdWZmZXJlZEJ5dGVzKGJ5dGVDb3VudCkge1xuICAgIGNvbnN0IHJlc3VsdCA9IEJ1ZmZlci5hbGxvY1Vuc2FmZShieXRlQ291bnQpXG4gICAgbGV0IGNvcGllZEJ5dGVzID0gMFxuXG4gICAgd2hpbGUgKGNvcGllZEJ5dGVzIDwgYnl0ZUNvdW50KSB7XG4gICAgICBjb25zdCBjaHVuayA9IHRoaXMuX2J1ZmZlckNodW5rc1t0aGlzLl9idWZmZXJDaHVua0luZGV4XVxuICAgICAgY29uc3QgYnl0ZXNGcm9tQ2h1bmsgPSBNYXRoLm1pbihjaHVuay5sZW5ndGggLSB0aGlzLl9idWZmZXJDaHVua09mZnNldCwgYnl0ZUNvdW50IC0gY29waWVkQnl0ZXMpXG5cbiAgICAgIGNodW5rLmNvcHkoXG4gICAgICAgIHJlc3VsdCxcbiAgICAgICAgY29waWVkQnl0ZXMsXG4gICAgICAgIHRoaXMuX2J1ZmZlckNodW5rT2Zmc2V0LFxuICAgICAgICB0aGlzLl9idWZmZXJDaHVua09mZnNldCArIGJ5dGVzRnJvbUNodW5rXG4gICAgICApXG4gICAgICBjb3BpZWRCeXRlcyArPSBieXRlc0Zyb21DaHVua1xuICAgICAgdGhpcy5fYnVmZmVyQ2h1bmtPZmZzZXQgKz0gYnl0ZXNGcm9tQ2h1bmtcblxuICAgICAgaWYgKHRoaXMuX2J1ZmZlckNodW5rT2Zmc2V0ID09PSBjaHVuay5sZW5ndGgpIHtcbiAgICAgICAgdGhpcy5fYnVmZmVyQ2h1bmtJbmRleCArPSAxXG4gICAgICAgIHRoaXMuX2J1ZmZlckNodW5rT2Zmc2V0ID0gMFxuICAgICAgfVxuICAgIH1cblxuICAgIGlmICh0aGlzLl9idWZmZXJDaHVua0luZGV4ID09PSB0aGlzLl9idWZmZXJDaHVua3MubGVuZ3RoKSB7XG4gICAgICB0aGlzLl9idWZmZXJDaHVua3MgPSBbXVxuICAgICAgdGhpcy5fYnVmZmVyQ2h1bmtJbmRleCA9IDBcbiAgICB9IGVsc2UgaWYgKFxuICAgICAgdGhpcy5fYnVmZmVyQ2h1bmtJbmRleCA+PSA2NCAmJlxuICAgICAgdGhpcy5fYnVmZmVyQ2h1bmtJbmRleCAqIDIgPj0gdGhpcy5fYnVmZmVyQ2h1bmtzLmxlbmd0aFxuICAgICkge1xuICAgICAgdGhpcy5fYnVmZmVyQ2h1bmtzID0gdGhpcy5fYnVmZmVyQ2h1bmtzLnNsaWNlKHRoaXMuX2J1ZmZlckNodW5rSW5kZXgpXG4gICAgICB0aGlzLl9idWZmZXJDaHVua0luZGV4ID0gMFxuICAgIH1cblxuICAgIHRoaXMuX2J1ZmZlcmVkQnl0ZXMgLT0gYnl0ZUNvdW50XG4gICAgdGhpcy5fYnVmZmVyZWRGcmFtZUNvcHlCeXRlcyArPSBieXRlQ291bnRcblxuICAgIHJldHVybiByZXN1bHRcbiAgfVxuXG4gIC8qKlxuICAgKiBEcm9wcyBhbGwgaW5jb21wbGV0ZSBmcmFtZSBjaHVua3MuXG4gICAqIEByZXR1cm5zIHt2b2lkfVxuICAgKi9cbiAgX2NsZWFyQnVmZmVyZWRGcmFtZUNodW5rcygpIHtcbiAgICB0aGlzLl9idWZmZXJDaHVua3MgPSBbXVxuICAgIHRoaXMuX2J1ZmZlckNodW5rSW5kZXggPSAwXG4gICAgdGhpcy5fYnVmZmVyQ2h1bmtPZmZzZXQgPSAwXG4gICAgdGhpcy5fYnVmZmVyZWRCeXRlcyA9IDBcbiAgfVxuXG4gIC8qKlxuICAgKiBUZW50YXRpdmVseSBhZG1pdHMgb25lIGNvbXBsZXRlIHRleHQgbWVzc2FnZSBiZWZvcmUgZGVjb2RpbmcgaXQuXG4gICAqIEBwYXJhbSB7bnVtYmVyfSBieXRlTGVuZ3RoIC0gRXhhY3QgY29tcGxldGUgcmF3IHRleHQgcGF5bG9hZCBieXRlcy5cbiAgICogQHJldHVybnMge0luYm91bmRNZXNzYWdlQWRtaXNzaW9uIHwgbnVsbH0gLSBBZG1pc3Npb24gb3duZXJzaGlwLCBvciBudWxsIGFmdGVyIG92ZXJsb2FkL2Nsb3NlLlxuICAgKi9cbiAgX2FkbWl0SW5ib3VuZE1lc3NhZ2UoYnl0ZUxlbmd0aCkge1xuICAgIGlmICh0aGlzLl9pbmJvdW5kQ2xvc2VkKSByZXR1cm4gbnVsbFxuXG4gICAgaWYgKFxuICAgICAgdGhpcy5faW5ib3VuZFBlbmRpbmdNZXNzYWdlcyArIDEgPiB0aGlzLl9pbmJvdW5kTWF4UGVuZGluZ01lc3NhZ2VzIHx8XG4gICAgICB0aGlzLl9pbmJvdW5kUGVuZGluZ0J5dGVzICsgYnl0ZUxlbmd0aCA+IHRoaXMuX2luYm91bmRNYXhQZW5kaW5nQnl0ZXNcbiAgICApIHtcbiAgICAgIHRoaXMuX2Nsb3NlRm9ySW5ib3VuZEJhY2tsb2coYnl0ZUxlbmd0aClcbiAgICAgIHJldHVybiBudWxsXG4gICAgfVxuXG4gICAgdGhpcy5faW5ib3VuZFBlbmRpbmdNZXNzYWdlcyArPSAxXG4gICAgdGhpcy5faW5ib3VuZFBlbmRpbmdCeXRlcyArPSBieXRlTGVuZ3RoXG5cbiAgICByZXR1cm4ge1xuICAgICAgYnl0ZUxlbmd0aCxcbiAgICAgIGdlbmVyYXRpb246IHRoaXMuX2luYm91bmRBY2NvdW50aW5nR2VuZXJhdGlvbixcbiAgICAgIHJlbGVhc2VkOiBmYWxzZVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBSZWxlYXNlcyBvbmUgYWRtaXNzaW9uIGV4YWN0bHkgb25jZS5cbiAgICogQHBhcmFtIHtJbmJvdW5kTWVzc2FnZUFkbWlzc2lvbn0gYWRtaXNzaW9uIC0gQWRtaXNzaW9uIG93bmVyc2hpcC5cbiAgICogQHJldHVybnMge3ZvaWR9XG4gICAqL1xuICBfcmVsZWFzZUluYm91bmRBZG1pc3Npb24oYWRtaXNzaW9uKSB7XG4gICAgaWYgKGFkbWlzc2lvbi5yZWxlYXNlZCkgcmV0dXJuXG5cbiAgICBhZG1pc3Npb24ucmVsZWFzZWQgPSB0cnVlXG4gICAgaWYgKGFkbWlzc2lvbi5nZW5lcmF0aW9uICE9PSB0aGlzLl9pbmJvdW5kQWNjb3VudGluZ0dlbmVyYXRpb24pIHJldHVyblxuXG4gICAgdGhpcy5faW5ib3VuZFBlbmRpbmdNZXNzYWdlcyAtPSAxXG4gICAgdGhpcy5faW5ib3VuZFBlbmRpbmdCeXRlcyAtPSBhZG1pc3Npb24uYnl0ZUxlbmd0aFxuICB9XG5cbiAgLyoqXG4gICAqIEFiYW5kb25zIGFsbCBhZG1pdHRlZCBpbnB1dCBhbmQgaW52YWxpZGF0ZXMgbGF0ZSBzZXR0bGVtZW50cy5cbiAgICogQHJldHVybnMge3ZvaWR9XG4gICAqL1xuICBfYWJhbmRvbkluYm91bmRNZXNzYWdlcygpIHtcbiAgICB0aGlzLl9pbmJvdW5kQ2xvc2VkID0gdHJ1ZVxuICAgIHRoaXMuX2luYm91bmRBY2NvdW50aW5nR2VuZXJhdGlvbiArPSAxXG4gICAgdGhpcy5faW5ib3VuZFBlbmRpbmdCeXRlcyA9IDBcbiAgICB0aGlzLl9pbmJvdW5kUGVuZGluZ01lc3NhZ2VzID0gMFxuICAgIHRoaXMubWVzc2FnZVF1ZXVlID0gW11cbiAgfVxuXG4gIC8qKlxuICAgKiBQZXJtYW5lbnRseSBjbG9zZXMgYSBzZXNzaW9uIHdob3NlIG5leHQgbWVzc2FnZSBleGNlZWRlZCBpdHMgYmFja2xvZyBidWRnZXQuXG4gICAqIEBwYXJhbSB7bnVtYmVyfSByZWplY3RlZEJ5dGVzIC0gUmF3IHBheWxvYWQgYnl0ZXMgcmVqZWN0ZWQgYXQgYWRtaXNzaW9uLlxuICAgKiBAcmV0dXJucyB7dm9pZH1cbiAgICovXG4gIF9jbG9zZUZvckluYm91bmRCYWNrbG9nKHJlamVjdGVkQnl0ZXMpIHtcbiAgICBpZiAodGhpcy5faW5ib3VuZEJhY2tsb2dPdmVybG9hZGVkIHx8IHRoaXMuX2luYm91bmRDbG9zZWQpIHJldHVyblxuXG4gICAgdGhpcy5faW5ib3VuZEJhY2tsb2dPdmVybG9hZGVkID0gdHJ1ZVxuICAgIHRoaXMubG9nZ2VyLndhcm4oKCkgPT4gW1xuICAgICAgXCJJbmJvdW5kIHdlYnNvY2tldCBtZXNzYWdlIGJhY2tsb2cgZXhjZWVkZWQ7IGNsb3NpbmcgY29ubmVjdGlvblwiLFxuICAgICAge1xuICAgICAgICBtYXhCeXRlczogdGhpcy5faW5ib3VuZE1heFBlbmRpbmdCeXRlcyxcbiAgICAgICAgbWF4TWVzc2FnZXM6IHRoaXMuX2luYm91bmRNYXhQZW5kaW5nTWVzc2FnZXMsXG4gICAgICAgIHBlbmRpbmdCeXRlczogdGhpcy5faW5ib3VuZFBlbmRpbmdCeXRlcyxcbiAgICAgICAgcGVuZGluZ01lc3NhZ2VzOiB0aGlzLl9pbmJvdW5kUGVuZGluZ01lc3NhZ2VzLFxuICAgICAgICByZWplY3RlZEJ5dGVzXG4gICAgICB9XG4gICAgXSlcbiAgICB0aGlzLnNlbmRHb29kYnllKHRoaXMuY2xpZW50LCB7XG4gICAgICBjb2RlOiBXRUJTT0NLRVRfQ0xPU0VfUE9MSUNZX1ZJT0xBVElPTixcbiAgICAgIHJlYXNvbjogV0VCU09DS0VUX0lOQk9VTkRfQkFDS0xPR19DTE9TRV9SRUFTT05cbiAgICB9KVxuICAgIHRoaXMuX2hhbmRsZUNsb3NlKHthbGxvd1Jlc3VtZTogZmFsc2V9KVxuICB9XG5cbiAgLyoqXG4gICAqIENsb3NlcyBhZnRlciBhbiBpbmJvdW5kIGJ1ZmZlcmluZyBsaW1pdCBhbmQgcmVsZWFzZXMgYWxsIHBhcnNlci1vd25lZCBpbnB1dC5cbiAgICogQHJldHVybnMge3ZvaWR9XG4gICAqL1xuICBfY2xvc2VGb3JJbmJvdW5kTGltaXQoKSB7XG4gICAgdGhpcy5fcmVzZXRGcmFnbWVudEJ1ZmZlcigpXG4gICAgdGhpcy5fY2xlYXJCdWZmZXJlZEZyYW1lQ2h1bmtzKClcbiAgICB0aGlzLnNlbmRHb29kYnllKHRoaXMuY2xpZW50KVxuICAgIHRoaXMuX2hhbmRsZUNsb3NlKClcbiAgfVxuXG4gIC8qKlxuICAgKiBBcHBlbmRzIGEgY29udGludWF0aW9uLWZyYW1lIHBheWxvYWQgdG8gdGhlIGluLXByb2dyZXNzXG4gICAqIGZyYWdtZW50ZWQgbWVzc2FnZS4gUmV0dXJucyB0cnVlIHdoZW4gdGhlIGZyYWdtZW50IHdhcyBhY2NlcHRlZFxuICAgKiBhbmQgZmFsc2Ugd2hlbiB0aGUgcGVyLW1lc3NhZ2UgY2FwIHdhcyBoaXQgYW5kIHRoZSBzb2NrZXQgaGFzXG4gICAqIGJlZW4gY2xvc2VkLlxuICAgKiBAcGFyYW0ge0J1ZmZlcn0gcGF5bG9hZCAtIENvbnRpbnVhdGlvbi1mcmFtZSBieXRlcyB0byBhcHBlbmQuXG4gICAqIEByZXR1cm5zIHtib29sZWFufSAtIFdoZXRoZXIgdGhlIGZyYWdtZW50IHdhcyBhY2NlcHRlZC5cbiAgICovXG4gIF9hcHBlbmRGcmFnbWVudChwYXlsb2FkKSB7XG4gICAgLy8gR3VhcmQgcHVzaGluZyBmaXJzdCBzbyBgX2VuZm9yY2VGcmFnbWVudExpbWl0c2Agc2VlcyB0aGUgZmluYWxcbiAgICAvLyBzdGF0ZTsgb24gb3ZlcmZsb3cgdGhlIHJlc2V0IGluc2lkZSB0aGUgZW5mb3JjZXIgZHJvcHMgdGhlXG4gICAgLy8gYnVmZmVyZWQgZnJhZ21lbnRzLlxuICAgIHRoaXMuX2ZyYWdtZW50ZWRQYXlsb2Fkcz8ucHVzaChwYXlsb2FkKVxuICAgIHRoaXMuX2ZyYWdtZW50ZWRCeXRlcyArPSBwYXlsb2FkLmxlbmd0aFxuXG4gICAgcmV0dXJuIHRoaXMuX2VuZm9yY2VGcmFnbWVudExpbWl0cygpXG4gIH1cblxuICAvKipcbiAgICogVmVyaWZpZXMgdGhlIGZyYWdtZW50ZWQgbWVzc2FnZSBoYXMgbm90IGV4Y2VlZGVkIHRoZSBieXRlIG9yXG4gICAqIGZyYWdtZW50LWNvdW50IGNhcHMuIE9uIG92ZXJmbG93LCBjbGVhcnMgdGhlIGJ1ZmZlciwgc2VuZHMgYVxuICAgKiBjbG9zZSBmcmFtZSwgYW5kIHRlYXJzIHRoZSBzZXNzaW9uIGRvd24uIFJldHVybnMgdHJ1ZSB3aGVuIHRoZVxuICAgKiBjYWxsZXIgY2FuIGNvbnRpbnVlIHByb2Nlc3NpbmcsIGZhbHNlIHdoZW4gdGhlIHNlc3Npb24gaXMgYmVpbmdcbiAgICogY2xvc2VkLlxuICAgKiBAcmV0dXJucyB7Ym9vbGVhbn0gLSBXaGV0aGVyIGZyYWdtZW50IHByb2Nlc3NpbmcgbWF5IGNvbnRpbnVlLlxuICAgKi9cbiAgX2VuZm9yY2VGcmFnbWVudExpbWl0cygpIHtcbiAgICBpZiAodGhpcy5fZnJhZ21lbnRlZFBheWxvYWRzID09PSBudWxsKSByZXR1cm4gdHJ1ZVxuXG4gICAgY29uc3QgZnJhZ21lbnRDb3VudCA9IHRoaXMuX2ZyYWdtZW50ZWRQYXlsb2Fkcy5sZW5ndGhcbiAgICBjb25zdCBvdmVyQnl0ZXMgPSB0aGlzLl9mcmFnbWVudGVkQnl0ZXMgPiBXRUJTT0NLRVRfTUFYX0ZSQUdNRU5URURfTUVTU0FHRV9CWVRFU1xuICAgIGNvbnN0IG92ZXJGcmFnbWVudHMgPSBmcmFnbWVudENvdW50ID4gV0VCU09DS0VUX01BWF9GUkFHTUVOVEVEX01FU1NBR0VfRlJBR01FTlRTXG5cbiAgICBpZiAoIW92ZXJCeXRlcyAmJiAhb3ZlckZyYWdtZW50cykgcmV0dXJuIHRydWVcblxuICAgIHRoaXMubG9nZ2VyLndhcm4oKCkgPT4gW1xuICAgICAgXCJGcmFnbWVudGVkIHdlYnNvY2tldCBtZXNzYWdlIGV4Y2VlZGVkIGNhcHM7IGNsb3NpbmcgY29ubmVjdGlvblwiLFxuICAgICAge1xuICAgICAgICBmcmFnbWVudEJ5dGVzOiB0aGlzLl9mcmFnbWVudGVkQnl0ZXMsXG4gICAgICAgIGZyYWdtZW50Q291bnQsXG4gICAgICAgIG1heEJ5dGVzOiBXRUJTT0NLRVRfTUFYX0ZSQUdNRU5URURfTUVTU0FHRV9CWVRFUyxcbiAgICAgICAgbWF4RnJhZ21lbnRzOiBXRUJTT0NLRVRfTUFYX0ZSQUdNRU5URURfTUVTU0FHRV9GUkFHTUVOVFNcbiAgICAgIH1cbiAgICBdKVxuXG4gICAgdGhpcy5fY2xvc2VGb3JJbmJvdW5kTGltaXQoKVxuXG4gICAgcmV0dXJuIGZhbHNlXG4gIH1cblxuICAvKipcbiAgICogUnVucyByZXNldCBmcmFnbWVudCBidWZmZXIuXG4gICAqIEByZXR1cm5zIHt2b2lkfSAqL1xuICBfcmVzZXRGcmFnbWVudEJ1ZmZlcigpIHtcbiAgICB0aGlzLl9mcmFnbWVudGVkUGF5bG9hZHMgPSBudWxsXG4gICAgdGhpcy5fZnJhZ21lbnRlZE9wY29kZSA9IG51bGxcbiAgICB0aGlzLl9mcmFnbWVudGVkQnl0ZXMgPSAwXG4gIH1cblxuICAvKipcbiAgICogU3RhcnRzIHRoZSBwZXItc2Vzc2lvbiBoZWFydGJlYXQuIEVhY2ggdGljayBwaW5ncyB0aGUgY2xpZW50IGFuZFxuICAgKiByZWFwcyB0aGUgc2Vzc2lvbiBpZiB0aGUgcHJldmlvdXMgcGluZyB3ZW50IHVuYW5zd2VyZWQsIHNvIGFcbiAgICogaGFsZi1vcGVuIHNvY2tldCAoY2xpZW50IGdvbmUgd2l0aG91dCBhIFRDUCBGSU4gLyBjbG9zZSBmcmFtZSlcbiAgICogY2Fubm90IGxpbmdlciBmb3JldmVyIGhvbGRpbmcgY2hhbm5lbCBzdWJzY3JpcHRpb25zLiBEaXNhYmxlZCB3aGVuXG4gICAqIHRoZSBjb25maWd1cmVkIGludGVydmFsIGlzIDAuXG4gICAqIEByZXR1cm5zIHt2b2lkfVxuICAgKi9cbiAgX3N0YXJ0SGVhcnRiZWF0KCkge1xuICAgIGNvbnN0IGludGVydmFsU2Vjb25kcyA9IHRoaXMuY29uZmlndXJhdGlvbi5nZXRXZWJzb2NrZXRTZXNzaW9uSGVhcnRiZWF0U2Vjb25kcygpXG5cbiAgICBpZiAoIWludGVydmFsU2Vjb25kcyB8fCBpbnRlcnZhbFNlY29uZHMgPD0gMCkgcmV0dXJuXG5cbiAgICB0aGlzLl9oZWFydGJlYXRUaW1lciA9IHNldEludGVydmFsKCgpID0+IHRoaXMuX2hlYXJ0YmVhdFRpY2soKSwgaW50ZXJ2YWxTZWNvbmRzICogMTAwMClcblxuICAgIC8vIERvbid0IGxldCB0aGUgaGVhcnRiZWF0IHRpbWVyIGtlZXAgdGhlIHByb2Nlc3MgYWxpdmUuXG4gICAgaWYgKHR5cGVvZiB0aGlzLl9oZWFydGJlYXRUaW1lci51bnJlZiA9PT0gXCJmdW5jdGlvblwiKSB0aGlzLl9oZWFydGJlYXRUaW1lci51bnJlZigpXG4gIH1cblxuICAvKipcbiAgICogT25lIGhlYXJ0YmVhdCBjeWNsZS4gUmVhcHMgdGhlIHNlc3Npb24gdmlhIHRoZSBub3JtYWwgY2xvc2UgcGF0aFxuICAgKiB3aGVuIHRoZSBwcmV2aW91cyBwaW5nIHdhcyBub3QgYW5zd2VyZWQ7IG90aGVyd2lzZSBtYXJrcyBpdFxuICAgKiBwZW5kaW5nIGFuZCBwaW5ncyBhZ2Fpbi4gQnJvd3NlcnMgYW5kIFJlYWN0IE5hdGl2ZSBzb2NrZXRzIGFuc3dlclxuICAgKiBzZXJ2ZXIgcGluZ3Mgd2l0aCBhbiBhdXRvbWF0aWMgcG9uZywgd2hpY2ggbGFuZHMgaW4gYF9wcm9jZXNzQnVmZmVyYFxuICAgKiBhbmQgcmUtbWFya3MgdGhlIHNlc3Npb24gYWxpdmUuXG4gICAqIEByZXR1cm5zIHt2b2lkfVxuICAgKi9cbiAgX2hlYXJ0YmVhdFRpY2soKSB7XG4gICAgaWYgKHRoaXMuX3BhdXNlZCB8fCAhdGhpcy5jbGllbnQ/LmV2ZW50cykgcmV0dXJuXG5cbiAgICBpZiAoIXRoaXMuX2hlYXJ0YmVhdEFsaXZlKSB7XG4gICAgICAvLyBObyBmcmFtZSBhcnJpdmVkIHNpbmNlIHRoZSBsYXN0IHBpbmcg4oCUIHRoZSBzb2NrZXQgaXMgZGVhZC5cbiAgICAgIC8vIFJvdXRlIHRocm91Z2ggYF9oYW5kbGVDbG9zZWAgc28gcmVzdW1hYmxlIHN0YXRlIHN0aWxsIHBhdXNlc1xuICAgICAgLy8gZm9yIHRoZSBncmFjZSB3aW5kb3cgYW5kIGV2ZXJ5dGhpbmcgZWxzZSBpcyB0b3JuIGRvd24uXG4gICAgICB0aGlzLl9zdG9wSGVhcnRiZWF0KClcbiAgICAgIHRoaXMuX2hhbmRsZUNsb3NlKClcbiAgICAgIHJldHVyblxuICAgIH1cblxuICAgIHRoaXMuX2hlYXJ0YmVhdEFsaXZlID0gZmFsc2VcbiAgICB0aGlzLl9zZW5kQ29udHJvbEZyYW1lKFdFQlNPQ0tFVF9PUENPREVfUElORywgQnVmZmVyLmFsbG9jKDApKVxuICB9XG5cbiAgLyoqXG4gICAqIFN0b3BzIHRoZSBwZXItc2Vzc2lvbiBoZWFydGJlYXQgdGltZXIsIGlmIGFueS5cbiAgICogQHJldHVybnMge3ZvaWR9XG4gICAqL1xuICBfc3RvcEhlYXJ0YmVhdCgpIHtcbiAgICBpZiAodGhpcy5faGVhcnRiZWF0VGltZXIpIHtcbiAgICAgIGNsZWFySW50ZXJ2YWwodGhpcy5faGVhcnRiZWF0VGltZXIpXG4gICAgICB0aGlzLl9oZWFydGJlYXRUaW1lciA9IG51bGxcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogUnVucyBzZW5kIGNvbnRyb2wgZnJhbWUuXG4gICAqIEBwYXJhbSB7bnVtYmVyfSBvcGNvZGUgLSBPcGNvZGUuXG4gICAqIEBwYXJhbSB7QnVmZmVyfSBwYXlsb2FkIC0gUGF5bG9hZCBkYXRhLlxuICAgKiBAcmV0dXJucyB7dm9pZH0gLSBObyByZXR1cm4gdmFsdWUuXG4gICAqL1xuICBfc2VuZENvbnRyb2xGcmFtZShvcGNvZGUsIHBheWxvYWQpIHtcbiAgICBjb25zdCBoZWFkZXIgPSBCdWZmZXIuYWxsb2MoMilcblxuICAgIGhlYWRlclswXSA9IFdFQlNPQ0tFVF9GSU5BTF9GUkFNRSB8IG9wY29kZVxuICAgIGhlYWRlclsxXSA9IHBheWxvYWQubGVuZ3RoXG5cbiAgICB0aGlzLmNsaWVudC5ldmVudHMuZW1pdChcIm91dHB1dFwiLCBCdWZmZXIuY29uY2F0KFtoZWFkZXIsIHBheWxvYWRdKSwge3dlYnNvY2tldEZyYW1lOiB0cnVlfSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHNlbmQganNvbi5cbiAgICogQHBhcmFtIHtvYmplY3R9IGJvZHkgLSBSZXF1ZXN0IGJvZHkuXG4gICAqIEByZXR1cm5zIHt2b2lkfSAtIE5vIHJldHVybiB2YWx1ZS5cbiAgICovXG4gIHNlbmRKc29uKGJvZHkpIHtcbiAgICAvLyBXaGlsZSBwYXVzZWQgKHdhaXRpbmcgZm9yIGEgcmVzdW1lKSwgc3Rhc2ggZnJhbWVzIGluIGFuXG4gICAgLy8gb3V0Ym91bmQgcXVldWUgYW5kIGZsdXNoIHRoZW0gaW4gb3JkZXIgb24gcmVzdW1lLiBDYXBwZWQgdG9cbiAgICAvLyBwcmV2ZW50IHJ1bmF3YXkgbWVtb3J5IHVzZSB3aGlsZSB0aGUgY2xpZW50IGlzIG9mZmxpbmUuXG4gICAgaWYgKHRoaXMuX3BhdXNlZCkge1xuICAgICAgdGhpcy5fb3V0Ym91bmRRdWV1ZSB8fD0gW11cblxuICAgICAgaWYgKHRoaXMuX291dGJvdW5kUXVldWUubGVuZ3RoID49IFdFQlNPQ0tFVF9QQVVTRURfUVVFVUVfQ0FQKSB7XG4gICAgICAgIC8vIERyb3Agb2xkZXN0IHNvIHRoZSBtb3N0IHJlY2VudCBhY3Rpdml0eSB3aW5zIG9uIHJlc3VtZS5cbiAgICAgICAgdGhpcy5fb3V0Ym91bmRRdWV1ZS5zaGlmdCgpXG4gICAgICB9XG5cbiAgICAgIHRoaXMuX291dGJvdW5kUXVldWUucHVzaChib2R5KVxuICAgICAgcmV0dXJuXG4gICAgfVxuXG4gICAgaWYgKCF0aGlzLmNsaWVudD8uZXZlbnRzKSByZXR1cm5cblxuICAgIGNvbnN0IGpzb24gPSBKU09OLnN0cmluZ2lmeShib2R5KVxuICAgIGNvbnN0IHBheWxvYWQgPSBCdWZmZXIuZnJvbShqc29uLCBcInV0Zi04XCIpXG4gICAgbGV0IGhlYWRlclxuXG4gICAgaWYgKHBheWxvYWQubGVuZ3RoIDwgMTI2KSB7XG4gICAgICBoZWFkZXIgPSBCdWZmZXIuYWxsb2MoMilcbiAgICAgIGhlYWRlclsxXSA9IHBheWxvYWQubGVuZ3RoXG4gICAgfSBlbHNlIGlmIChwYXlsb2FkLmxlbmd0aCA8IDY1NTM2KSB7XG4gICAgICBoZWFkZXIgPSBCdWZmZXIuYWxsb2MoNClcbiAgICAgIGhlYWRlclsxXSA9IDEyNlxuICAgICAgaGVhZGVyLndyaXRlVUludDE2QkUocGF5bG9hZC5sZW5ndGgsIDIpXG4gICAgfSBlbHNlIHtcbiAgICAgIGhlYWRlciA9IEJ1ZmZlci5hbGxvYygxMClcbiAgICAgIGhlYWRlclsxXSA9IDEyN1xuICAgICAgaGVhZGVyLndyaXRlQmlnVUludDY0QkUoQmlnSW50KHBheWxvYWQubGVuZ3RoKSwgMilcbiAgICB9XG5cbiAgICBoZWFkZXJbMF0gPSBXRUJTT0NLRVRfRklOQUxfRlJBTUUgfCBXRUJTT0NLRVRfT1BDT0RFX1RFWFRcblxuICAgIHRoaXMuY2xpZW50LmV2ZW50cy5lbWl0KFwib3V0cHV0XCIsIEJ1ZmZlci5jb25jYXQoW2hlYWRlciwgcGF5bG9hZF0pLCB7d2Vic29ja2V0RnJhbWU6IHRydWV9KVxuICB9XG5cbiAgLyoqXG4gICAqIEZsdXNoZXMgdGhlIHBhdXNlZCBvdXRib3VuZCBxdWV1ZSBvdmVyIHRoZSBjdXJyZW50IHNvY2tldC5cbiAgICogQ2FsbGVkIGR1cmluZyByZXN1bWUgYWZ0ZXIgYHNlc3Npb24tcmVzdW1lZGAgaGFzIGJlZW4gc2VudCBvblxuICAgKiB0aGUgTkVXIHNlc3Npb24ncyBzb2NrZXQgKG5vdCB0aGlzIHNlc3Npb24ncykuXG4gICAqIEByZXR1cm5zIHt2b2lkfVxuICAgKi9cbiAgX2ZsdXNoT3V0Ym91bmRRdWV1ZSgpIHtcbiAgICBjb25zdCBxdWV1ZSA9IHRoaXMuX291dGJvdW5kUXVldWUgfHwgW11cblxuICAgIHRoaXMuX291dGJvdW5kUXVldWUgPSBbXVxuXG4gICAgZm9yIChjb25zdCBib2R5IG9mIHF1ZXVlKSB7XG4gICAgICB0aGlzLnNlbmRKc29uKGJvZHkpXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgc3Vic2NyaWJlIHRvIGNoYW5uZWwuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBjaGFubmVsIC0gQ2hhbm5lbCBuYW1lLlxuICAgKiBAcGFyYW0ge3thY2tub3dsZWRnZT86IGJvb2xlYW4sIGNoYW5uZWxIYW5kbGVyPzogaW1wb3J0KFwiLi4vd2Vic29ja2V0LWNoYW5uZWwuanNcIikuZGVmYXVsdCwgbGFzdEV2ZW50SWQ/OiBzdHJpbmcsIHBhcmFtcz86IFJlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Piwgc3Vic2NyaXB0aW9uQ2hhbm5lbD86IHN0cmluZ319IFtvcHRpb25zXSAtIFN1YnNjcmliZSBvcHRpb25zLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxib29sZWFuPn0gLSBXaGV0aGVyIHRoZSBzdWJzY3JpcHRpb24gd2FzIGFkZGVkLlxuICAgKi9cbiAgYXN5bmMgc3Vic2NyaWJlVG9DaGFubmVsKGNoYW5uZWwsIHthY2tub3dsZWRnZSA9IHRydWUsIGNoYW5uZWxIYW5kbGVyLCBsYXN0RXZlbnRJZCwgcGFyYW1zLCBzdWJzY3JpcHRpb25DaGFubmVsfSA9IHt9KSB7XG4gICAgYXdhaXQgd2Vic29ja2V0RXZlbnRMb2dTdG9yZUZvckNvbmZpZ3VyYXRpb24odGhpcy5jb25maWd1cmF0aW9uKS5tYXJrQ2hhbm5lbEludGVyZXN0ZWQoY2hhbm5lbClcblxuICAgIGNvbnN0IHJlcGxheVN0YXRlID0gYXdhaXQgdGhpcy5fcHJlcGFyZVJlcGxheVN0YXRlKHtcbiAgICAgIGNoYW5uZWwsXG4gICAgICBsYXN0RXZlbnRJZCxcbiAgICAgIHN1YnNjcmlwdGlvbkNoYW5uZWw6IHN1YnNjcmlwdGlvbkNoYW5uZWwgfHwgY2hhbm5lbCxcbiAgICAgIHN1YnNjcmlwdGlvblBhcmFtczogcGFyYW1zXG4gICAgfSlcblxuICAgIGlmIChyZXBsYXlTdGF0ZSA9PT0gZmFsc2UpIHJldHVybiBmYWxzZVxuICAgIGlmIChyZXBsYXlTdGF0ZSkge1xuICAgICAgdGhpcy5jaGFubmVsUmVwbGF5U3RhdGVzLnNldChjaGFubmVsLCByZXBsYXlTdGF0ZSlcbiAgICB9XG5cbiAgICB0aGlzLmFkZFN1YnNjcmlwdGlvbihjaGFubmVsKVxuXG4gICAgaWYgKGNoYW5uZWxIYW5kbGVyKSB7XG4gICAgICBpZiAoIXRoaXMuc3Vic2NyaXB0aW9uSGFuZGxlcnMuaGFzKGNoYW5uZWwpKSB7XG4gICAgICAgIHRoaXMuc3Vic2NyaXB0aW9uSGFuZGxlcnMuc2V0KGNoYW5uZWwsIG5ldyBTZXQoKSlcbiAgICAgIH1cblxuICAgICAgdGhpcy5zdWJzY3JpcHRpb25IYW5kbGVycy5nZXQoY2hhbm5lbCk/LmFkZChjaGFubmVsSGFuZGxlcilcblxuICAgICAgaWYgKCF0aGlzLmhhbmRsZXJTdWJzY3JpcHRpb25zLmhhcyhjaGFubmVsSGFuZGxlcikpIHtcbiAgICAgICAgdGhpcy5oYW5kbGVyU3Vic2NyaXB0aW9ucy5zZXQoY2hhbm5lbEhhbmRsZXIsIG5ldyBTZXQoKSlcbiAgICAgIH1cblxuICAgICAgdGhpcy5oYW5kbGVyU3Vic2NyaXB0aW9ucy5nZXQoY2hhbm5lbEhhbmRsZXIpPy5hZGQoY2hhbm5lbClcbiAgICB9XG5cbiAgICBpZiAocmVwbGF5U3RhdGUpIHtcbiAgICAgIHRyeSB7XG4gICAgICAgIGF3YWl0IHRoaXMuX3JlcGxheUNoYW5uZWxFdmVudHMoe2NoYW5uZWwsIHJlcGxheVN0YXRlfSlcbiAgICAgIH0gZmluYWxseSB7XG4gICAgICAgIGF3YWl0IHRoaXMuX2ZpbmlzaFJlcGxheVN0YXRlKGNoYW5uZWwsIHJlcGxheVN0YXRlKVxuICAgICAgfVxuICAgIH1cblxuICAgIGlmIChhY2tub3dsZWRnZSkge1xuICAgICAgdGhpcy5zZW5kSnNvbih7Y2hhbm5lbCwgdHlwZTogXCJzdWJzY3JpYmVkXCJ9KVxuICAgIH1cbiAgICByZXR1cm4gdHJ1ZVxuICB9XG5cbiAgLyoqXG4gICAqIEhhbmRsZXMgc29ja2V0IGNsb3N1cmUgYW5kIG9wdGlvbmFsbHkgcmV0YWlucyByZXN1bWFibGUgc3RhdGUuXG4gICAqIEBwYXJhbSB7e2FsbG93UmVzdW1lPzogYm9vbGVhbn19IFtvcHRpb25zXSAtIENsb3N1cmUgYmVoYXZpb3IuXG4gICAqIEByZXR1cm5zIHt2b2lkfVxuICAgKi9cbiAgX2hhbmRsZUNsb3NlKHthbGxvd1Jlc3VtZSA9IHRydWV9ID0ge30pIHtcbiAgICB0aGlzLl9yZXNldEZyYWdtZW50QnVmZmVyKClcbiAgICB0aGlzLl9jbGVhckJ1ZmZlcmVkRnJhbWVDaHVua3MoKVxuICAgIHRoaXMuX2FiYW5kb25JbmJvdW5kTWVzc2FnZXMoKVxuXG4gICAgLy8gSWYgdGhlIHNlc3Npb24gaGFzIHJlc3VtYWJsZSBzdGF0ZSAobGl2ZSBDb25uZWN0aW9uIG9yXG4gICAgLy8gQ2hhbm5lbFYyIHN1YnNjcmlwdGlvbiksIG1vdmUgaXQgaW50byB0aGUgcGF1c2VkIHJlZ2lzdHJ5XG4gICAgLy8gaW5zdGVhZCBvZiB0ZWFyaW5nIGRvd247IGEgbmV3IHNvY2tldCBwcmVzZW50aW5nIHRoZSBzZXNzaW9uSWRcbiAgICAvLyB2aWEgYHNlc3Npb24tcmVzdW1lYCB3aXRoaW4gdGhlIGdyYWNlIHdpbmRvdyB3aWxsIHJlYXR0YWNoLlxuICAgIGNvbnN0IGhhc1Jlc3VtYWJsZVN0YXRlID0gdGhpcy5fY29ubmVjdGlvbnMuc2l6ZSA+IDAgfHwgdGhpcy5fY2hhbm5lbFN1YnNjcmlwdGlvbnMuc2l6ZSA+IDBcblxuICAgIGlmIChhbGxvd1Jlc3VtZSAmJiBoYXNSZXN1bWFibGVTdGF0ZSAmJiAhdGhpcy5fcGF1c2VkKSB7XG4gICAgICAvLyBQYXVzZWQgc2Vzc2lvbnMgaGF2ZSBubyBsaXZlIHNvY2tldCB0byBwaW5nOyB0aGUgZ3JhY2UgdGltZXJcbiAgICAgIC8vIG93bnMgdGhlaXIgZXZlbnR1YWwgdGVhcmRvd24gZnJvbSBoZXJlLlxuICAgICAgdGhpcy5fc3RvcEhlYXJ0YmVhdCgpXG4gICAgICB0aGlzLl9wYXVzZWQgPSB0cnVlXG4gICAgICB0aGlzLnNvY2tldCA9IG51bGxcbiAgICAgIC8vIEtpY2sgb2ZmIGF1dGgtaWRlbnRpdHkgY2FwdHVyZSBmb3IgcmVzdW1lIHZlcmlmaWNhdGlvbi4gUnVuc1xuICAgICAgLy8gaW4gdGhlIGJhY2tncm91bmQg4oCUIGBfaGFuZGxlU2Vzc2lvblJlc3VtZWAgYXdhaXRzXG4gICAgICAvLyBgX3Jlc3VtZUlkZW50aXR5UHJvbWlzZWAgYmVmb3JlIGNvbXBhcmluZy4gUGF1c2UgcmVnaXN0cmF0aW9uXG4gICAgICAvLyBpcyBzeW5jaHJvbm91cyBzbyBhIHJlc3VtZSBhcnJpdmluZyBpbW1lZGlhdGVseSBzdGlsbCBmaW5kc1xuICAgICAgLy8gdGhlIHNlc3Npb24uXG4gICAgICB0aGlzLl9yZXN1bWVJZGVudGl0eVByb21pc2UgPSB0aGlzLl9jYXB0dXJlUmVzdW1lSWRlbnRpdHkoKVxuICAgICAgdm9pZCB0aGlzLl9maXJlT25EaXNjb25uZWN0KClcbiAgICAgIHRoaXMuY29uZmlndXJhdGlvbi5fcGF1c2VXZWJzb2NrZXRTZXNzaW9uKHRoaXMpXG4gICAgICB0aGlzLmV2ZW50cy5lbWl0KFwiY2xvc2VcIilcbiAgICAgIHJldHVyblxuICAgIH1cblxuICAgIHRoaXMuX3N0b3BIZWFydGJlYXQoKVxuICAgIHRoaXMuX3JlbGVhc2VPd25lcnNoaXAoKVxuICAgIHRoaXMuY29uZmlndXJhdGlvbi5fd2Vic29ja2V0U2Vzc2lvbnMuZGVsZXRlKHRoaXMpXG4gICAgdm9pZCB0aGlzLl9ydW5NZXNzYWdlSGFuZGxlckNsb3NlKClcbiAgICB2b2lkIHRoaXMuX3RlYXJkb3duQ2hhbm5lbCgpXG4gICAgdm9pZCB0aGlzLl90ZWFyZG93bkNvbm5lY3Rpb25zKFwic2Vzc2lvbl9kZXN0cm95ZWRcIilcbiAgICB2b2lkIHRoaXMuX3RlYXJkb3duQ2hhbm5lbFN1YnNjcmlwdGlvbnMoKVxuICAgIHRoaXMuZXZlbnRzLmVtaXQoXCJjbG9zZVwiKVxuICB9XG5cbiAgLyoqXG4gICAqIENhbGxlZCBieSB0aGUgZ3JhY2UgdGltZXIgd2hlbiB0aGUgcGF1c2VkIHBlcmlvZCBleHBpcmVzIHdpdGhvdXRcbiAgICogYSByZXN1bWUuIFRlYXJzIGRvd24gYWxsIGxpdmUgQ29ubmVjdGlvbnMgKyBDaGFubmVsIHN1YnMgYW5kXG4gICAqIGRyb3BzIHRoZSBzZXNzaW9uLlxuICAgKiBAcmV0dXJucyB7dm9pZH1cbiAgICovXG4gIF9maW5hbGl6ZUdyYWNlRXhwaXJ5KCkge1xuICAgIHRoaXMuX3N0b3BIZWFydGJlYXQoKVxuICAgIHRoaXMuX3JlbGVhc2VPd25lcnNoaXAoKVxuICAgIHRoaXMuX3Jlc2V0RnJhZ21lbnRCdWZmZXIoKVxuICAgIHRoaXMuX2NsZWFyQnVmZmVyZWRGcmFtZUNodW5rcygpXG4gICAgdGhpcy5fYWJhbmRvbkluYm91bmRNZXNzYWdlcygpXG4gICAgdGhpcy5jb25maWd1cmF0aW9uLl93ZWJzb2NrZXRTZXNzaW9ucy5kZWxldGUodGhpcylcbiAgICB2b2lkIHRoaXMuX3J1bk1lc3NhZ2VIYW5kbGVyQ2xvc2UoKVxuICAgIHZvaWQgdGhpcy5fdGVhcmRvd25DaGFubmVsKClcbiAgICB2b2lkIHRoaXMuX3RlYXJkb3duQ29ubmVjdGlvbnMoXCJncmFjZV9leHBpcmVkXCIpXG4gICAgdm9pZCB0aGlzLl90ZWFyZG93bkNoYW5uZWxTdWJzY3JpcHRpb25zKClcbiAgICB0aGlzLmV2ZW50cy5lbWl0KFwiY2xvc2VcIilcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHRoZSBjb25maWd1cmVkIGlkZW50aXR5IHJlc29sdmVyIGFnYWluc3QgdGhpcyBzZXNzaW9uLlxuICAgKiBUaGUgcmV0dXJuZWQgcHJvbWlzZSBpcyBzdG9yZWQgYXQgcGF1c2UgdGltZSBhbmQgYXdhaXRlZCBhdFxuICAgKiByZXN1bWUgdGltZSBzbyB3ZSBjYW4gcmVqZWN0IHJlc3VtZSBhdHRlbXB0cyBmcm9tIGEgZGlmZmVyZW50XG4gICAqIGF1dGhlbnRpY2F0ZWQgY2FsbGVyIChzaWduZWQgb3V0LCBzd2FwcGVkIHVzZXIsIGV4cGlyZWQgY29va2llKS5cbiAgICogQHJldHVybnMge1Byb21pc2U8UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSAtIENhcHR1cmVkIGF1dGhlbnRpY2F0ZWQgaWRlbnRpdHkgZm9yIHJlc3VtZSB2YWxpZGF0aW9uLlxuICAgKi9cbiAgYXN5bmMgX2NhcHR1cmVSZXN1bWVJZGVudGl0eSgpIHtcbiAgICBjb25zdCByZXNvbHZlciA9IHRoaXMuY29uZmlndXJhdGlvbi5nZXRXZWJzb2NrZXRTZXNzaW9uSWRlbnRpdHlSZXNvbHZlcj8uKClcblxuICAgIGlmICh0eXBlb2YgcmVzb2x2ZXIgIT09IFwiZnVuY3Rpb25cIikgcmV0dXJuIHVuZGVmaW5lZFxuXG4gICAgdHJ5IHtcbiAgICAgIHJldHVybiBhd2FpdCByZXNvbHZlcih0aGlzKVxuICAgIH0gY2F0Y2ggKGNhdWdodEVycm9yKSB7XG4gICAgICBjb25zdCBlcnJvciA9IHRoaXMuX3JlcG9ydFVuZXhwZWN0ZWREaXNwYXRjaEVycm9yKGNhdWdodEVycm9yLCB7XG4gICAgICAgIHN0YWdlOiBcIndlYnNvY2tldC1zZXNzaW9uLWlkZW50aXR5LXBhdXNlXCJcbiAgICAgIH0pXG5cbiAgICAgIHRoaXMubG9nZ2VyLmVycm9yKCgpID0+IFtcIldlYnNvY2tldCBzZXNzaW9uIGlkZW50aXR5IHJlc29sdmVyIGZhaWxlZCBhdCBwYXVzZVwiLCBlcnJvcl0pXG4gICAgICByZXR1cm4gdW5kZWZpbmVkXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIEZpcmVzIGBvbkRpc2Nvbm5lY3RgIG9uIGV2ZXJ5IGxpdmUgQ29ubmVjdGlvbiBhbmQgQ2hhbm5lbCBzdWIgc29cbiAgICogYXBwcyBjYW4gcGF1c2UgcGVyLWluc3RhbmNlIHdvcmsgd2hpbGUgdGhlIHNlc3Npb24gaXMgcGF1c2VkLlxuICAgKiBFcnJvcnMgYXJlIGxvZ2dlZCwgbm90IHJldGhyb3duIOKAlCBvbmUgYnJva2VuIGhhbmRsZXIgbXVzdCBub3RcbiAgICogYmxvY2sgdGhlIHJlc3QuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fVxuICAgKi9cbiAgYXN5bmMgX2ZpcmVPbkRpc2Nvbm5lY3QoKSB7XG4gICAgYXdhaXQgdGhpcy5fZmlyZUxpZmVjeWNsZUNhbGxiYWNrKFwib25EaXNjb25uZWN0XCIpXG4gIH1cblxuICAvKipcbiAgICogRmlyZXMgYG9uUmVzdW1lYCBvbiBldmVyeSBsaXZlIENvbm5lY3Rpb24gYW5kIENoYW5uZWwgc3ViIGFmdGVyXG4gICAqIGEgc3VjY2Vzc2Z1bCBgc2Vzc2lvbi1yZXN1bWVgIGhhbmRvZmYuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fVxuICAgKi9cbiAgYXN5bmMgX2ZpcmVPblJlc3VtZSgpIHtcbiAgICBhd2FpdCB0aGlzLl9maXJlTGlmZWN5Y2xlQ2FsbGJhY2soXCJvblJlc3VtZVwiKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZmlyZSBsaWZlY3ljbGUgY2FsbGJhY2suXG4gICAqIEBwYXJhbSB7XCJvbkRpc2Nvbm5lY3RcIiB8IFwib25SZXN1bWVcIn0gY2FsbGJhY2tOYW1lIExpZmVjeWNsZSBjYWxsYmFjayB0byBmaXJlLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gUmVzb2x2ZXMgd2hlbiBldmVyeSBsaXZlIGhhbmRsZXIgaGFzIGJlZW4gYXR0ZW1wdGVkLlxuICAgKi9cbiAgYXN5bmMgX2ZpcmVMaWZlY3ljbGVDYWxsYmFjayhjYWxsYmFja05hbWUpIHtcbiAgICBmb3IgKGNvbnN0IGNvbm5lY3Rpb24gb2YgdGhpcy5fY29ubmVjdGlvbnMudmFsdWVzKCkpIHtcbiAgICAgIHRyeSB7XG4gICAgICAgIGF3YWl0IGNvbm5lY3Rpb25bY2FsbGJhY2tOYW1lXT8uKClcbiAgICAgIH0gY2F0Y2ggKGNhdWdodEVycm9yKSB7XG4gICAgICAgIGNvbnN0IGVycm9yID0gdGhpcy5fcmVwb3J0VW5leHBlY3RlZERpc3BhdGNoRXJyb3IoY2F1Z2h0RXJyb3IsIHtcbiAgICAgICAgICBjYWxsYmFja05hbWUsXG4gICAgICAgICAgY29ubmVjdGlvbklkOiBjb25uZWN0aW9uLmNvbm5lY3Rpb25JZCxcbiAgICAgICAgICBzdGFnZTogXCJ3ZWJzb2NrZXQtY29ubmVjdGlvbi1saWZlY3ljbGVcIlxuICAgICAgICB9KVxuXG4gICAgICAgIHRoaXMubG9nZ2VyLmVycm9yKCgpID0+IFtgJHtjYWxsYmFja05hbWV9IGZhaWxlZCBmb3IgJHtjb25uZWN0aW9uLmNvbm5lY3Rpb25JZH1gLCBlcnJvcl0pXG4gICAgICB9XG4gICAgfVxuXG4gICAgZm9yIChjb25zdCB7c3Vic2NyaXB0aW9ufSBvZiB0aGlzLl9jaGFubmVsU3Vic2NyaXB0aW9ucy52YWx1ZXMoKSkge1xuICAgICAgdHJ5IHtcbiAgICAgICAgYXdhaXQgc3Vic2NyaXB0aW9uW2NhbGxiYWNrTmFtZV0/LigpXG4gICAgICB9IGNhdGNoIChjYXVnaHRFcnJvcikge1xuICAgICAgICBjb25zdCBlcnJvciA9IHRoaXMuX3JlcG9ydFVuZXhwZWN0ZWREaXNwYXRjaEVycm9yKGNhdWdodEVycm9yLCB7XG4gICAgICAgICAgY2FsbGJhY2tOYW1lLFxuICAgICAgICAgIHN0YWdlOiBcIndlYnNvY2tldC1jaGFubmVsLWxpZmVjeWNsZVwiLFxuICAgICAgICAgIHN1YnNjcmlwdGlvbklkOiBzdWJzY3JpcHRpb24uc3Vic2NyaXB0aW9uSWRcbiAgICAgICAgfSlcblxuICAgICAgICB0aGlzLmxvZ2dlci5lcnJvcigoKSA9PiBbYCR7Y2FsbGJhY2tOYW1lfSBmYWlsZWQgZm9yIGNoYW5uZWwgc3ViICR7c3Vic2NyaXB0aW9uLnN1YnNjcmlwdGlvbklkfWAsIGVycm9yXSlcbiAgICAgIH1cbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogSGFuZGxlcyBge3R5cGU6IFwic2Vzc2lvbi1yZXN1bWVcIn1gLiBUaGlzIHNlc3Npb24gKHRoZSBuZXdseS1cbiAgICogY3JlYXRlZCBvbmUgd2hvc2Ugc29ja2V0IGp1c3QgY29ubmVjdGVkKSB0cmFuc2ZlcnMgc3RhdGUgZnJvbVxuICAgKiB0aGUgcGF1c2VkIHNlc3Npb24gYW5kIGluc3RydWN0cyB0aGUgY2xpZW50IHZpYVxuICAgKiBgc2Vzc2lvbi1yZXN1bWVkYCBvciBgc2Vzc2lvbi1nb25lYC5cbiAgICogQHBhcmFtIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59IG1lc3NhZ2UgLSBTZXNzaW9uLXJlc3VtZSBmcmFtZSBjb250YWluaW5nIHRoZSBwYXVzZWQgc2Vzc2lvbiBpZGVudGlmaWVyLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn1cbiAgICovXG4gIGFzeW5jIF9oYW5kbGVTZXNzaW9uUmVzdW1lKG1lc3NhZ2UpIHtcbiAgICBjb25zdCByZXN1bWVTZXNzaW9uSWQgPSBtZXNzYWdlLnNlc3Npb25JZFxuXG4gICAgaWYgKHR5cGVvZiByZXN1bWVTZXNzaW9uSWQgIT09IFwic3RyaW5nXCIgfHwgIXJlc3VtZVNlc3Npb25JZCkge1xuICAgICAgdGhpcy5zZW5kSnNvbih7dHlwZTogXCJzZXNzaW9uLWdvbmVcIn0pXG4gICAgICByZXR1cm5cbiAgICB9XG5cbiAgICBjb25zdCBwYXVzZWQgPSB0aGlzLmNvbmZpZ3VyYXRpb24uX2ZpbmRQYXVzZWRXZWJzb2NrZXRTZXNzaW9uKHJlc3VtZVNlc3Npb25JZClcblxuICAgIGlmICghcGF1c2VkKSB7XG4gICAgICB0aGlzLnNlbmRKc29uKHt0eXBlOiBcInNlc3Npb24tZ29uZVwifSlcbiAgICAgIHJldHVyblxuICAgIH1cblxuICAgIC8vIEF1dGggcmUtdmVyaWZ5OiBjb21wYXJlIHRoZSBmcmVzaCBjYWxsZXIncyBpZGVudGl0eSBhZ2FpbnN0IHRoZVxuICAgIC8vIG9uZSBjYXB0dXJlZCBhdCBwYXVzZS4gTWlzbWF0Y2ggbWVhbnMgYSBkaWZmZXJlbnQgdXNlciAob3IgYVxuICAgIC8vIHNpZ25lZC1vdXQgc2Vzc2lvbikgaXMgdHJ5aW5nIHRvIHJlY2xhaW0gc3RhdGUgdGhhdCBpc24ndFxuICAgIC8vIHRoZWlycyDigJQgZGVzdHJveSB0aGUgcGF1c2VkIHNlc3Npb24gb3V0cmlnaHQuXG4gICAgY29uc3QgcmVzb2x2ZXIgPSB0aGlzLmNvbmZpZ3VyYXRpb24uZ2V0V2Vic29ja2V0U2Vzc2lvbklkZW50aXR5UmVzb2x2ZXI/LigpXG5cbiAgICBpZiAodHlwZW9mIHJlc29sdmVyID09PSBcImZ1bmN0aW9uXCIpIHtcbiAgICAgIGNvbnN0IHBhdXNlZElkZW50aXR5ID0gYXdhaXQgcGF1c2VkLl9yZXN1bWVJZGVudGl0eVByb21pc2VcbiAgICAgIGxldCBmcmVzaElkZW50aXR5XG5cbiAgICAgIHRyeSB7XG4gICAgICAgIGZyZXNoSWRlbnRpdHkgPSBhd2FpdCByZXNvbHZlcih0aGlzKVxuICAgICAgfSBjYXRjaCAoY2F1Z2h0RXJyb3IpIHtcbiAgICAgICAgY29uc3QgZXJyb3IgPSB0aGlzLl9yZXBvcnRVbmV4cGVjdGVkRGlzcGF0Y2hFcnJvcihjYXVnaHRFcnJvciwge1xuICAgICAgICAgIHN0YWdlOiBcIndlYnNvY2tldC1zZXNzaW9uLWlkZW50aXR5LXJlc3VtZVwiXG4gICAgICAgIH0pXG5cbiAgICAgICAgdGhpcy5sb2dnZXIuZXJyb3IoKCkgPT4gW1wiV2Vic29ja2V0IHNlc3Npb24gaWRlbnRpdHkgcmVzb2x2ZXIgZmFpbGVkIGF0IHJlc3VtZVwiLCBlcnJvcl0pXG4gICAgICAgIGZyZXNoSWRlbnRpdHkgPSB1bmRlZmluZWRcbiAgICAgIH1cblxuICAgICAgaWYgKCFpZGVudGl0aWVzTWF0Y2gocGF1c2VkSWRlbnRpdHksIGZyZXNoSWRlbnRpdHkpKSB7XG4gICAgICAgIHRoaXMuY29uZmlndXJhdGlvbi5fY2xlYXJQYXVzZWRXZWJzb2NrZXRTZXNzaW9uKHJlc3VtZVNlc3Npb25JZClcbiAgICAgICAgcGF1c2VkLl9maW5hbGl6ZUdyYWNlRXhwaXJ5KClcbiAgICAgICAgdGhpcy5zZW5kSnNvbih7dHlwZTogXCJzZXNzaW9uLWdvbmVcIn0pXG4gICAgICAgIHJldHVyblxuICAgICAgfVxuICAgIH1cblxuICAgIHRoaXMuY29uZmlndXJhdGlvbi5fY2xlYXJQYXVzZWRXZWJzb2NrZXRTZXNzaW9uKHJlc3VtZVNlc3Npb25JZClcblxuICAgIHRoaXMuX3JlbGVhc2VPd25lcnNoaXAoKVxuICAgIHBhdXNlZC5fcmVsZWFzZU93bmVyc2hpcCgpXG5cbiAgICAvLyBUcmFuc2ZlciByZXN1bWFibGUgc3RhdGUgb250byB0aGlzIChsaXZlKSBzZXNzaW9uLiBUaGUgcGF1c2VkXG4gICAgLy8gc2Vzc2lvbiBzaGVsbCBpcyBkaXNjYXJkZWQgYWZ0ZXIgdGhlIHRyYW5zZmVyLlxuICAgIGZvciAoY29uc3QgW2Nvbm5lY3Rpb25JZCwgY29ubmVjdGlvbl0gb2YgcGF1c2VkLl9jb25uZWN0aW9ucykge1xuICAgICAgY29ubmVjdGlvbi5zZXNzaW9uID0gdGhpc1xuICAgICAgdGhpcy5fY29ubmVjdGlvbnMuc2V0KGNvbm5lY3Rpb25JZCwgY29ubmVjdGlvbilcbiAgICB9XG5cbiAgICBmb3IgKGNvbnN0IFtzdWJJZCwgZW50cnldIG9mIHBhdXNlZC5fY2hhbm5lbFN1YnNjcmlwdGlvbnMpIHtcbiAgICAgIGVudHJ5LnN1YnNjcmlwdGlvbi5zZXNzaW9uID0gdGhpc1xuICAgICAgdGhpcy5fY2hhbm5lbFN1YnNjcmlwdGlvbnMuc2V0KHN1YklkLCBlbnRyeSlcbiAgICB9XG5cbiAgICB0aGlzLl9tZXRhZGF0YSA9IHsuLi5wYXVzZWQuX21ldGFkYXRhfVxuICAgIHRoaXMuZGF0YSA9IHBhdXNlZC5kYXRhXG4gICAgdGhpcy5zZXNzaW9uSWQgPSByZXN1bWVTZXNzaW9uSWRcblxuICAgIC8vIFRyYW5zZmVyIGFueSBmcmFtZXMgcXVldWVkIHdoaWxlIHRoZSBwYXVzZWQgc2Vzc2lvbiBoYWQgbm9cbiAgICAvLyBzb2NrZXQuIFRoZXkgZmx1c2ggQUZURVIgc2Vzc2lvbi1yZXN1bWVkIHNvIHRoZSBjbGllbnQga25vd3NcbiAgICAvLyB3aGljaCBzZXNzaW9uIHRoZXkgYmVsb25nIHRvLlxuICAgIGNvbnN0IHF1ZXVlZCA9IHBhdXNlZC5fb3V0Ym91bmRRdWV1ZSB8fCBbXVxuXG4gICAgcGF1c2VkLl9vdXRib3VuZFF1ZXVlID0gW11cbiAgICBwYXVzZWQuX2Nvbm5lY3Rpb25zLmNsZWFyKClcbiAgICBwYXVzZWQuX2NoYW5uZWxTdWJzY3JpcHRpb25zLmNsZWFyKClcbiAgICBwYXVzZWQuX3BhdXNlZCA9IGZhbHNlXG4gICAgcGF1c2VkLmRlc3Ryb3koKVxuXG4gICAgdGhpcy5fY2xhaW1Pd25lcnNoaXAoKVxuICAgIHRoaXMuc2VuZEpzb24oe3R5cGU6IFwic2Vzc2lvbi1yZXN1bWVkXCIsIHNlc3Npb25JZDogcmVzdW1lU2Vzc2lvbklkfSlcbiAgICBmb3IgKGNvbnN0IGJvZHkgb2YgcXVldWVkKSB0aGlzLnNlbmRKc29uKGJvZHkpXG4gICAgYXdhaXQgdGhpcy5fZmlyZU9uUmVzdW1lKClcbiAgfVxuXG4gIC8qKlxuICAgKiBGaXJlcyBgb25DbG9zZShyZWFzb24pYCBvbiBldmVyeSBsaXZlIGFwcC1kZWZpbmVkIGNvbm5lY3Rpb24sIHRoZW5cbiAgICogZHJvcHMgdGhlbSBmcm9tIHRoZSByZWdpc3RyeS4gTm8gbmV0d29yayBmcmFtZSBpcyBzZW50IOKAlCB0aGVcbiAgICogc29ja2V0IGlzIGFscmVhZHkgZ29pbmcgYXdheS5cbiAgICogQHBhcmFtIHtcInNlc3Npb25fZGVzdHJveWVkXCIgfCBcImdyYWNlX2V4cGlyZWRcIiB8IFwiZXJyb3JcIn0gcmVhc29uIC0gUGVybWFuZW50IHRlYXJkb3duIHJlYXNvbiBwYXNzZWQgdG8gZWFjaCBjb25uZWN0aW9uLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn1cbiAgICovXG4gIGFzeW5jIF90ZWFyZG93bkNvbm5lY3Rpb25zKHJlYXNvbikge1xuICAgIGNvbnN0IGNvbm5lY3Rpb25zID0gWy4uLnRoaXMuX2Nvbm5lY3Rpb25zLnZhbHVlcygpXVxuXG4gICAgdGhpcy5fY29ubmVjdGlvbnMuY2xlYXIoKVxuXG4gICAgZm9yIChjb25zdCBjb25uZWN0aW9uIG9mIGNvbm5lY3Rpb25zKSB7XG4gICAgICBjb25uZWN0aW9uLl9jbG9zZWQgPSB0cnVlXG5cbiAgICAgIHRyeSB7XG4gICAgICAgIGF3YWl0IHRoaXMuX3dpdGhDb25uZWN0aW9ucyhhc3luYyAoKSA9PiB7XG4gICAgICAgICAgYXdhaXQgY29ubmVjdGlvbi5vbkNsb3NlKHJlYXNvbilcbiAgICAgICAgfSlcbiAgICAgIH0gY2F0Y2ggKGNhdWdodEVycm9yKSB7XG4gICAgICAgIGNvbnN0IGVycm9yID0gdGhpcy5fcmVwb3J0VW5leHBlY3RlZERpc3BhdGNoRXJyb3IoY2F1Z2h0RXJyb3IsIHtcbiAgICAgICAgICBjb25uZWN0aW9uSWQ6IGNvbm5lY3Rpb24uY29ubmVjdGlvbklkLFxuICAgICAgICAgIHJlYXNvbixcbiAgICAgICAgICBzdGFnZTogXCJ3ZWJzb2NrZXQtY29ubmVjdGlvbi10ZWFyZG93blwiXG4gICAgICAgIH0pXG5cbiAgICAgICAgdGhpcy5sb2dnZXIuZXJyb3IoKCkgPT4gW2BGYWlsZWQgdG8gdGVhciBkb3duIGNvbm5lY3Rpb24gJHtjb25uZWN0aW9uLmNvbm5lY3Rpb25JZH1gLCBlcnJvcl0pXG4gICAgICB9XG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIEhhbmRsZXMgYSBge3R5cGU6IFwiY29ubmVjdGlvbi1vcGVuXCJ9YCBtZXNzYWdlIOKAlCBpbnN0YW50aWF0ZXMgdGhlXG4gICAqIHJlZ2lzdGVyZWQgY29ubmVjdGlvbiBjbGFzcywgc3RvcmVzIGl0IG9uIGBfY29ubmVjdGlvbnNgLCBhbmRcbiAgICogZmlyZXMgYG9uQ29ubmVjdCgpYC4gU2VuZHMgYGNvbm5lY3Rpb24tb3BlbmVkYCBvbiBzdWNjZXNzIG9yXG4gICAqIGBjb25uZWN0aW9uLWVycm9yYCBvbiBmYWlsdXJlLlxuICAgKiBAcGFyYW0ge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gbWVzc2FnZSAtIENvbm5lY3Rpb24tb3BlbiBmcmFtZSBuYW1pbmcgdGhlIGNvbm5lY3Rpb24gdHlwZSBhbmQgaWRlbnRpZmllci5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59XG4gICAqL1xuICBhc3luYyBfaGFuZGxlQ29ubmVjdGlvbk9wZW4obWVzc2FnZSkge1xuICAgIGNvbnN0IGNvbm5lY3Rpb25JZCA9IG1lc3NhZ2UuY29ubmVjdGlvbklkXG4gICAgY29uc3QgY29ubmVjdGlvblR5cGUgPSBtZXNzYWdlLmNvbm5lY3Rpb25UeXBlXG4gICAgY29uc3QgcGFyYW1zID0gbWVzc2FnZS5wYXJhbXMgfHwge31cblxuICAgIGlmICh0eXBlb2YgY29ubmVjdGlvbklkICE9PSBcInN0cmluZ1wiIHx8ICFjb25uZWN0aW9uSWQpIHtcbiAgICAgIHRoaXMuc2VuZEpzb24oe3R5cGU6IFwiZXJyb3JcIiwgZXJyb3I6IFwiY29ubmVjdGlvbi1vcGVuIHJlcXVpcmVzIGNvbm5lY3Rpb25JZFwifSlcbiAgICAgIHJldHVyblxuICAgIH1cblxuICAgIGlmICh0eXBlb2YgY29ubmVjdGlvblR5cGUgIT09IFwic3RyaW5nXCIgfHwgIWNvbm5lY3Rpb25UeXBlKSB7XG4gICAgICB0aGlzLnNlbmRKc29uKHt0eXBlOiBcImNvbm5lY3Rpb24tZXJyb3JcIiwgY29ubmVjdGlvbklkLCBtZXNzYWdlOiBcImNvbm5lY3Rpb25UeXBlIGlzIHJlcXVpcmVkXCJ9KVxuICAgICAgcmV0dXJuXG4gICAgfVxuXG4gICAgaWYgKHRoaXMuX2Nvbm5lY3Rpb25zLmhhcyhjb25uZWN0aW9uSWQpKSB7XG4gICAgICB0aGlzLnNlbmRKc29uKHt0eXBlOiBcImNvbm5lY3Rpb24tZXJyb3JcIiwgY29ubmVjdGlvbklkLCBtZXNzYWdlOiBcIkNvbm5lY3Rpb24gaWQgYWxyZWFkeSBpbiB1c2VcIn0pXG4gICAgICByZXR1cm5cbiAgICB9XG5cbiAgICBjb25zdCBDb25uZWN0aW9uQ2xhc3MgPSB0aGlzLmNvbmZpZ3VyYXRpb24uZ2V0V2Vic29ja2V0Q29ubmVjdGlvbkNsYXNzPy4oY29ubmVjdGlvblR5cGUpXG5cbiAgICBpZiAoIUNvbm5lY3Rpb25DbGFzcykge1xuICAgICAgdGhpcy5zZW5kSnNvbih7dHlwZTogXCJjb25uZWN0aW9uLWVycm9yXCIsIGNvbm5lY3Rpb25JZCwgbWVzc2FnZTogYFVua25vd24gY29ubmVjdGlvbiB0eXBlOiAke2Nvbm5lY3Rpb25UeXBlfWB9KVxuICAgICAgcmV0dXJuXG4gICAgfVxuXG4gICAgY29uc3QgY29ubmVjdGlvbiA9IG5ldyBDb25uZWN0aW9uQ2xhc3Moe2Nvbm5lY3Rpb25JZCwgcGFyYW1zLCBzZXNzaW9uOiB0aGlzfSlcblxuICAgIHRyeSB7XG4gICAgICBhd2FpdCB0aGlzLl93aXRoQ29ubmVjdGlvbnMoYXN5bmMgKCkgPT4ge1xuICAgICAgICBhd2FpdCBjb25uZWN0aW9uLm9uQ29ubmVjdCgpXG4gICAgICB9KVxuICAgICAgLy8gUmVnaXN0ZXIgb25seSBhZnRlciBvbkNvbm5lY3QgcmVzb2x2ZXMgc28gYSBjb25uZWN0aW9uLW1lc3NhZ2VcbiAgICAgIC8vIGNhbiBuZXZlciBiZSByb3V0ZWQgdG8gYSBwYXJ0aWFsbHkgaW5pdGlhbGl6ZWQgY29ubmVjdGlvbi5cbiAgICAgIHRoaXMuX2Nvbm5lY3Rpb25zLnNldChjb25uZWN0aW9uSWQsIGNvbm5lY3Rpb24pXG4gICAgICB0aGlzLnNlbmRKc29uKHt0eXBlOiBcImNvbm5lY3Rpb24tb3BlbmVkXCIsIGNvbm5lY3Rpb25JZH0pXG4gICAgfSBjYXRjaCAoY2F1Z2h0RXJyb3IpIHtcbiAgICAgIGNvbnN0IGNsaWVudEVycm9yTWVzc2FnZSA9IGNhdWdodEVycm9yIGluc3RhbmNlb2YgRXJyb3IgPyBjYXVnaHRFcnJvci5tZXNzYWdlIDogXCJcIlxuICAgICAgY29uc3QgZXJyb3IgPSB0aGlzLl9yZXBvcnRVbmV4cGVjdGVkRGlzcGF0Y2hFcnJvcihjYXVnaHRFcnJvciwge1xuICAgICAgICBjb25uZWN0aW9uSWQsXG4gICAgICAgIGNvbm5lY3Rpb25UeXBlLFxuICAgICAgICBzdGFnZTogXCJ3ZWJzb2NrZXQtY29ubmVjdGlvbi1vcGVuXCJcbiAgICAgIH0pXG5cbiAgICAgIHRoaXMubG9nZ2VyLmVycm9yKCgpID0+IFtgRmFpbGVkIHRvIG9wZW4gY29ubmVjdGlvbiAke2Nvbm5lY3Rpb25UeXBlfToke2Nvbm5lY3Rpb25JZH1gLCBlcnJvcl0pXG4gICAgICB0aGlzLnNlbmRKc29uKHt0eXBlOiBcImNvbm5lY3Rpb24tZXJyb3JcIiwgY29ubmVjdGlvbklkLCBtZXNzYWdlOiBjbGllbnRFcnJvck1lc3NhZ2UgfHwgXCJGYWlsZWQgdG8gb3BlbiBjb25uZWN0aW9uXCJ9KVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBIYW5kbGVzIGEgYHt0eXBlOiBcImNvbm5lY3Rpb24tbWVzc2FnZVwifWAgZnJvbSB0aGUgY2xpZW50LlxuICAgKiBAcGFyYW0ge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gbWVzc2FnZSAtIENvbm5lY3Rpb24tbWVzc2FnZSBmcmFtZSBjb250YWluaW5nIHRoZSB0YXJnZXQgaWRlbnRpZmllciBhbmQgYm9keS5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59XG4gICAqL1xuICBhc3luYyBfaGFuZGxlQ29ubmVjdGlvbk1lc3NhZ2UobWVzc2FnZSkge1xuICAgIGNvbnN0IGNvbm5lY3Rpb25JZCA9IG1lc3NhZ2UuY29ubmVjdGlvbklkXG4gICAgY29uc3QgY29ubmVjdGlvbiA9IHR5cGVvZiBjb25uZWN0aW9uSWQgPT09IFwic3RyaW5nXCIgPyB0aGlzLl9jb25uZWN0aW9ucy5nZXQoY29ubmVjdGlvbklkKSA6IG51bGxcblxuICAgIGlmICghY29ubmVjdGlvbikge1xuICAgICAgdGhpcy5zZW5kSnNvbih7dHlwZTogXCJjb25uZWN0aW9uLWVycm9yXCIsIGNvbm5lY3Rpb25JZCwgbWVzc2FnZTogXCJVbmtub3duIGNvbm5lY3Rpb24gaWRcIn0pXG4gICAgICByZXR1cm5cbiAgICB9XG5cbiAgICB0cnkge1xuICAgICAgYXdhaXQgdGhpcy5fd2l0aENvbm5lY3Rpb25zKGFzeW5jICgpID0+IHtcbiAgICAgICAgYXdhaXQgY29ubmVjdGlvbi5vbk1lc3NhZ2UobWVzc2FnZS5ib2R5KVxuICAgICAgfSlcbiAgICB9IGNhdGNoIChjYXVnaHRFcnJvcikge1xuICAgICAgY29uc3QgY2xpZW50RXJyb3JNZXNzYWdlID0gY2F1Z2h0RXJyb3IgaW5zdGFuY2VvZiBFcnJvciA/IGNhdWdodEVycm9yLm1lc3NhZ2UgOiBcIlwiXG4gICAgICBjb25zdCBlcnJvciA9IHRoaXMuX3JlcG9ydFVuZXhwZWN0ZWREaXNwYXRjaEVycm9yKGNhdWdodEVycm9yLCB7XG4gICAgICAgIGNvbm5lY3Rpb25JZCxcbiAgICAgICAgc3RhZ2U6IFwid2Vic29ja2V0LWNvbm5lY3Rpb24tbWVzc2FnZVwiXG4gICAgICB9KVxuXG4gICAgICB0aGlzLmxvZ2dlci5lcnJvcigoKSA9PiBbYEZhaWxlZCB0byBoYW5kbGUgY29ubmVjdGlvbi1tZXNzYWdlIGZvciAke2Nvbm5lY3Rpb25JZH1gLCBlcnJvcl0pXG4gICAgICB0aGlzLnNlbmRKc29uKHt0eXBlOiBcImNvbm5lY3Rpb24tZXJyb3JcIiwgY29ubmVjdGlvbklkLCBtZXNzYWdlOiBjbGllbnRFcnJvck1lc3NhZ2UgfHwgXCJGYWlsZWQgdG8gaGFuZGxlIG1lc3NhZ2VcIn0pXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIEhhbmRsZXMgYSBge3R5cGU6IFwiY29ubmVjdGlvbi1jbG9zZVwifWAgZnJvbSB0aGUgY2xpZW50IOKAlCBmaXJlc1xuICAgKiBgb25DbG9zZShcImNsaWVudF9jbG9zZVwiKWAgYW5kIGNvbmZpcm1zIHdpdGggYGNvbm5lY3Rpb24tY2xvc2VkYC5cbiAgICogQHBhcmFtIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59IG1lc3NhZ2UgLSBDb25uZWN0aW9uLWNsb3NlIGZyYW1lIGNvbnRhaW5pbmcgdGhlIHRhcmdldCBpZGVudGlmaWVyLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn1cbiAgICovXG4gIGFzeW5jIF9oYW5kbGVDb25uZWN0aW9uQ2xvc2UobWVzc2FnZSkge1xuICAgIGNvbnN0IGNvbm5lY3Rpb25JZCA9IG1lc3NhZ2UuY29ubmVjdGlvbklkXG4gICAgY29uc3QgY29ubmVjdGlvbiA9IHR5cGVvZiBjb25uZWN0aW9uSWQgPT09IFwic3RyaW5nXCIgPyB0aGlzLl9jb25uZWN0aW9ucy5nZXQoY29ubmVjdGlvbklkKSA6IG51bGxcblxuICAgIGlmICghY29ubmVjdGlvbikgcmV0dXJuXG5cbiAgICB0aGlzLl9jb25uZWN0aW9ucy5kZWxldGUoY29ubmVjdGlvbklkKVxuICAgIC8vIE1hcmsgY2xvc2VkIGJlZm9yZSBmaXJpbmcgb25DbG9zZSBzbyBhcHAgY29kZSBob2xkaW5nIHRoZVxuICAgIC8vIGhhbmRsZSBzZWVzIGBpc0Nsb3NlZCgpID09PSB0cnVlYCBhbmQgY2FuJ3QgcmUtZW50ZXIgc2VuZE1lc3NhZ2UuXG4gICAgY29ubmVjdGlvbi5fY2xvc2VkID0gdHJ1ZVxuXG4gICAgdHJ5IHtcbiAgICAgIGF3YWl0IHRoaXMuX3dpdGhDb25uZWN0aW9ucyhhc3luYyAoKSA9PiB7XG4gICAgICAgIGF3YWl0IGNvbm5lY3Rpb24ub25DbG9zZShcImNsaWVudF9jbG9zZVwiKVxuICAgICAgfSlcbiAgICB9IGNhdGNoIChjYXVnaHRFcnJvcikge1xuICAgICAgY29uc3QgZXJyb3IgPSB0aGlzLl9yZXBvcnRVbmV4cGVjdGVkRGlzcGF0Y2hFcnJvcihjYXVnaHRFcnJvciwge1xuICAgICAgICBjb25uZWN0aW9uSWQsXG4gICAgICAgIHN0YWdlOiBcIndlYnNvY2tldC1jb25uZWN0aW9uLWNsb3NlXCJcbiAgICAgIH0pXG5cbiAgICAgIHRoaXMubG9nZ2VyLmVycm9yKCgpID0+IFtgRmFpbGVkIHRvIHRlYXIgZG93biBjb25uZWN0aW9uICR7Y29ubmVjdGlvbklkfWAsIGVycm9yXSlcbiAgICB9XG5cbiAgICB0aGlzLnNlbmRKc29uKHt0eXBlOiBcImNvbm5lY3Rpb24tY2xvc2VkXCIsIGNvbm5lY3Rpb25JZCwgcmVhc29uOiBcImNsaWVudF9jbG9zZVwifSlcbiAgfVxuXG4gIC8qKlxuICAgKiBIYW5kbGVzIGB7dHlwZTogXCJjaGFubmVsLXN1YnNjcmliZVwifWAg4oCUIHJ1bnMgYGNhblN1YnNjcmliZSgpYCxcbiAgICogcmVnaXN0ZXJzIHdpdGggdGhlIENvbmZpZ3VyYXRpb24ncyBnbG9iYWwgcm91dGluZyByZWdpc3RyeSBvblxuICAgKiBzdWNjZXNzLCBhbmQgc2VuZHMgYGNoYW5uZWwtc3Vic2NyaWJlZGAgb3IgYGNoYW5uZWwtZXJyb3JgLlxuICAgKiBAcGFyYW0ge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gbWVzc2FnZSAtIENoYW5uZWwtc3Vic2NyaWJlIGZyYW1lIGRlc2NyaWJpbmcgdGhlIHJlcXVlc3RlZCBzdWJzY3JpcHRpb24uXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fVxuICAgKi9cbiAgYXN5bmMgX2hhbmRsZUNoYW5uZWxTdWJzY3JpYmUobWVzc2FnZSkge1xuICAgIGNvbnN0IHN1YnNjcmlwdGlvbklkID0gbWVzc2FnZS5zdWJzY3JpcHRpb25JZFxuICAgIGNvbnN0IGNoYW5uZWxUeXBlID0gbWVzc2FnZS5jaGFubmVsVHlwZVxuICAgIGNvbnN0IHBhcmFtcyA9IG1lc3NhZ2UucGFyYW1zIHx8IHt9XG4gICAgY29uc3QgbGFzdEV2ZW50SWQgPSBtZXNzYWdlLmxhc3RFdmVudElkXG5cbiAgICBpZiAodHlwZW9mIHN1YnNjcmlwdGlvbklkICE9PSBcInN0cmluZ1wiIHx8ICFzdWJzY3JpcHRpb25JZCkge1xuICAgICAgdGhpcy5zZW5kSnNvbih7dHlwZTogXCJlcnJvclwiLCBlcnJvcjogXCJjaGFubmVsLXN1YnNjcmliZSByZXF1aXJlcyBzdWJzY3JpcHRpb25JZFwifSlcbiAgICAgIHJldHVyblxuICAgIH1cblxuICAgIGlmICh0eXBlb2YgY2hhbm5lbFR5cGUgIT09IFwic3RyaW5nXCIgfHwgIWNoYW5uZWxUeXBlKSB7XG4gICAgICB0aGlzLnNlbmRKc29uKHt0eXBlOiBcImNoYW5uZWwtZXJyb3JcIiwgc3Vic2NyaXB0aW9uSWQsIG1lc3NhZ2U6IFwiY2hhbm5lbFR5cGUgaXMgcmVxdWlyZWRcIn0pXG4gICAgICByZXR1cm5cbiAgICB9XG5cbiAgICBpZiAodGhpcy5fY2hhbm5lbFN1YnNjcmlwdGlvbnMuaGFzKHN1YnNjcmlwdGlvbklkKSkge1xuICAgICAgdGhpcy5zZW5kSnNvbih7dHlwZTogXCJjaGFubmVsLWVycm9yXCIsIHN1YnNjcmlwdGlvbklkLCBtZXNzYWdlOiBcIlN1YnNjcmlwdGlvbiBpZCBhbHJlYWR5IGluIHVzZVwifSlcbiAgICAgIHJldHVyblxuICAgIH1cblxuICAgIGNvbnN0IENoYW5uZWxDbGFzcyA9IHRoaXMuY29uZmlndXJhdGlvbi5nZXRXZWJzb2NrZXRDaGFubmVsQ2xhc3M/LihjaGFubmVsVHlwZSlcblxuICAgIGlmICghQ2hhbm5lbENsYXNzKSB7XG4gICAgICB0aGlzLnNlbmRKc29uKHt0eXBlOiBcImNoYW5uZWwtZXJyb3JcIiwgc3Vic2NyaXB0aW9uSWQsIG1lc3NhZ2U6IGBVbmtub3duIGNoYW5uZWwgdHlwZTogJHtjaGFubmVsVHlwZX1gfSlcbiAgICAgIHJldHVyblxuICAgIH1cblxuICAgIGNvbnN0IHN1YnNjcmlwdGlvbiA9IG5ldyBDaGFubmVsQ2xhc3Moe3N1YnNjcmlwdGlvbklkLCBwYXJhbXMsIHNlc3Npb246IHRoaXN9KVxuXG4gICAgdHJ5IHtcbiAgICAgIC8vIFJlc29sdmluZyB0aGUgdGVuYW50IGNhbiBydW4gZGF0YWJhc2UgcXVlcmllcyAoZS5nLiBsb29raW5nIHVwIHRoZVxuICAgICAgLy8gcmVjb3JkJ3MgcHJvamVjdCBhbmQgdGhlIGNhbGxlcidzIGFjY2VzcyksIHNvIGl0IG11c3QgaGFwcGVuIGluc2lkZSBhXG4gICAgICAvLyBjb25uZWN0aW9uIHNjb3BlLiBXaXRob3V0IHRoaXMgdGhlIHJlc29sdmVyIGJvcnJvd3MgYSBjb25uZWN0aW9uIHRoYXRcbiAgICAgIC8vIGlzIGNoZWNrZWQgYmFjayBpbiBiZWZvcmUvd2hpbGUgaXQgcXVlcmllcywgaW50ZXJtaXR0ZW50bHkgc3VyZmFjaW5nIGFzXG4gICAgICAvLyBcIkNvbm5lY3Rpb24g4oCmIGRvZXNuJ3QgZXhpc3QgYW55IG1vcmVcIiBvciBhIGZhbHNlbHkgdW5hdXRob3JpemVkXG4gICAgICAvLyBzdWJzY3JpcHRpb24uXG4gICAgICBsZXQgdGVuYW50XG4gICAgICBhd2FpdCB0aGlzLl93aXRoQ29ubmVjdGlvbnMoYXN5bmMgKCkgPT4ge1xuICAgICAgICB0ZW5hbnQgPSBhd2FpdCB0aGlzLl9yZXNvbHZlVGVuYW50KHtjaGFubmVsOiBjaGFubmVsVHlwZSwgcGFyYW1zfSlcbiAgICAgIH0pXG5cbiAgICAgIGF3YWl0IHRoaXMuY29uZmlndXJhdGlvbi5ydW5XaXRoVGVuYW50KHRlbmFudCwgYXN5bmMgKCkgPT4ge1xuICAgICAgICBsZXQgYWxsb3dlZCA9IGZhbHNlXG5cbiAgICAgICAgYXdhaXQgdGhpcy5fd2l0aENvbm5lY3Rpb25zKGFzeW5jICgpID0+IHtcbiAgICAgICAgICBhbGxvd2VkID0gQm9vbGVhbihhd2FpdCBzdWJzY3JpcHRpb24uY2FuU3Vic2NyaWJlKCkpXG4gICAgICAgIH0pXG5cbiAgICAgICAgaWYgKCFhbGxvd2VkKSB7XG4gICAgICAgICAgdGhpcy5zZW5kSnNvbih7dHlwZTogXCJjaGFubmVsLWVycm9yXCIsIHN1YnNjcmlwdGlvbklkLCBtZXNzYWdlOiBcIlN1YnNjcmlwdGlvbiBub3QgYXV0aG9yaXplZFwifSlcbiAgICAgICAgICByZXR1cm5cbiAgICAgICAgfVxuXG4gICAgICAgIHRoaXMuX2NoYW5uZWxTdWJzY3JpcHRpb25zLnNldChzdWJzY3JpcHRpb25JZCwge2NoYW5uZWxUeXBlLCBzdWJzY3JpcHRpb259KVxuICAgICAgICB0aGlzLmNvbmZpZ3VyYXRpb24uX3JlZ2lzdGVyV2Vic29ja2V0Q2hhbm5lbFN1YnNjcmlwdGlvbihjaGFubmVsVHlwZSwgc3Vic2NyaXB0aW9uKVxuXG4gICAgICAgIGF3YWl0IHRoaXMuX3dpdGhDb25uZWN0aW9ucyhhc3luYyAoKSA9PiBhd2FpdCBzdWJzY3JpcHRpb24uc3Vic2NyaWJlZCgpKVxuXG4gICAgICAgIC8vIFJlcGxheSBtaXNzZWQgZXZlbnRzIEJFRk9SRSBzZW5kaW5nIGNoYW5uZWwtc3Vic2NyaWJlZCBzb1xuICAgICAgICAvLyB0aGUgY2xpZW50IGtub3dzOiBldmVyeXRoaW5nIGJlZm9yZSB0aGUgY29uZmlybWF0aW9uIGlzXG4gICAgICAgIC8vIHJlcGxheWVkLCBldmVyeXRoaW5nIGFmdGVyIGlzIGxpdmUuXG4gICAgICAgIGlmICh0eXBlb2YgbGFzdEV2ZW50SWQgPT09IFwic3RyaW5nXCIgJiYgbGFzdEV2ZW50SWQubGVuZ3RoID4gMCkge1xuICAgICAgICAgIGF3YWl0IHRoaXMuX3JlcGxheUNoYW5uZWxFdmVudHNGb3JTdWJzY3JpcHRpb24oe2NoYW5uZWxUeXBlLCBsYXN0RXZlbnRJZCwgc3Vic2NyaXB0aW9ufSlcbiAgICAgICAgfVxuXG4gICAgICAgIHRoaXMuc2VuZEpzb24oe3R5cGU6IFwiY2hhbm5lbC1zdWJzY3JpYmVkXCIsIHN1YnNjcmlwdGlvbklkfSlcbiAgICAgIH0pXG4gICAgfSBjYXRjaCAoY2F1Z2h0RXJyb3IpIHtcbiAgICAgIGNvbnN0IGNsaWVudEVycm9yTWVzc2FnZSA9IGNhdWdodEVycm9yIGluc3RhbmNlb2YgRXJyb3IgPyBjYXVnaHRFcnJvci5tZXNzYWdlIDogXCJcIlxuXG4gICAgICB0aGlzLl9jaGFubmVsU3Vic2NyaXB0aW9ucy5kZWxldGUoc3Vic2NyaXB0aW9uSWQpXG4gICAgICB0aGlzLmNvbmZpZ3VyYXRpb24uX3VucmVnaXN0ZXJXZWJzb2NrZXRDaGFubmVsU3Vic2NyaXB0aW9uKGNoYW5uZWxUeXBlLCBzdWJzY3JpcHRpb24pXG4gICAgICBjb25zdCBlcnJvciA9IHRoaXMuX3JlcG9ydFVuZXhwZWN0ZWREaXNwYXRjaEVycm9yKGNhdWdodEVycm9yLCB7XG4gICAgICAgIGNoYW5uZWxUeXBlLFxuICAgICAgICBzdGFnZTogXCJ3ZWJzb2NrZXQtY2hhbm5lbC1zdWJzY3JpYmVcIixcbiAgICAgICAgc3Vic2NyaXB0aW9uSWRcbiAgICAgIH0pXG5cbiAgICAgIHRoaXMubG9nZ2VyLmVycm9yKCgpID0+IFtgRmFpbGVkIHRvIHN1YnNjcmliZSBjaGFubmVsICR7Y2hhbm5lbFR5cGV9OiR7c3Vic2NyaXB0aW9uSWR9YCwgZXJyb3JdKVxuICAgICAgdGhpcy5zZW5kSnNvbih7dHlwZTogXCJjaGFubmVsLWVycm9yXCIsIHN1YnNjcmlwdGlvbklkLCBtZXNzYWdlOiBjbGllbnRFcnJvck1lc3NhZ2UgfHwgXCJGYWlsZWQgdG8gc3Vic2NyaWJlXCJ9KVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBSZXBsYXlzIG1pc3NlZCBldmVudHMgZnJvbSB0aGUgcGVyc2lzdGVudCBldmVudC1sb2cgc3RvcmUgZm9yIGFcbiAgICogY2hhbm5lbCBzdWJzY3JpcHRpb24gdGhhdCBwcm92aWRlZCBgbGFzdEV2ZW50SWRgLiBTZW5kcyBlYWNoXG4gICAqIG1pc3NlZCBldmVudCBhcyBhIGBjaGFubmVsLW1lc3NhZ2VgIHdpdGggYHJlcGxheWVkOiB0cnVlYC5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBPcHRpb25zLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gYXJncy5jaGFubmVsVHlwZSAtIENoYW5uZWwgdHlwZSBuYW1lIChldmVudC1sb2cga2V5KS5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGFyZ3MubGFzdEV2ZW50SWQgLSBDbGllbnQncyBsYXN0LXNlZW4gZXZlbnQgaWQuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vd2Vic29ja2V0LWNoYW5uZWwuanNcIikuZGVmYXVsdH0gYXJncy5zdWJzY3JpcHRpb24gLSBMaXZlIHN1YnNjcmlwdGlvbi5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59XG4gICAqL1xuICBhc3luYyBfcmVwbGF5Q2hhbm5lbEV2ZW50c0ZvclN1YnNjcmlwdGlvbih7Y2hhbm5lbFR5cGUsIGxhc3RFdmVudElkLCBzdWJzY3JpcHRpb259KSB7XG4gICAgY29uc3Qgc3RvcmUgPSB3ZWJzb2NrZXRFdmVudExvZ1N0b3JlRm9yQ29uZmlndXJhdGlvbih0aGlzLmNvbmZpZ3VyYXRpb24pXG5cbiAgICBhd2FpdCB0aGlzLmNvbmZpZ3VyYXRpb24uYXdhaXRQZW5kaW5nQnJvYWRjYXN0cygpXG5cbiAgICBjb25zdCBjaGVja3BvaW50ID0gYXdhaXQgc3RvcmUuZ2V0RXZlbnRCeUlkKHtjaGFubmVsOiBjaGFubmVsVHlwZSwgaWQ6IGxhc3RFdmVudElkfSlcblxuICAgIGlmICghY2hlY2twb2ludCkge1xuICAgICAgdGhpcy5zZW5kSnNvbih7XG4gICAgICAgIHR5cGU6IFwiY2hhbm5lbC1yZXBsYXktZ2FwXCIsXG4gICAgICAgIHN1YnNjcmlwdGlvbklkOiBzdWJzY3JpcHRpb24uc3Vic2NyaXB0aW9uSWQsXG4gICAgICAgIGxhc3RFdmVudElkXG4gICAgICB9KVxuICAgICAgcmV0dXJuXG4gICAgfVxuXG4gICAgY29uc3QgY2VpbGluZyA9IGF3YWl0IHN0b3JlLmxhdGVzdFNlcXVlbmNlKGNoYW5uZWxUeXBlKVxuXG4gICAgaWYgKCFjZWlsaW5nIHx8IGNlaWxpbmcgPD0gY2hlY2twb2ludC5zZXF1ZW5jZSkgcmV0dXJuXG5cbiAgICBjb25zdCBldmVudHMgPSBhd2FpdCBzdG9yZS5nZXRFdmVudHNBZnRlcih7XG4gICAgICBjaGFubmVsOiBjaGFubmVsVHlwZSxcbiAgICAgIHNlcXVlbmNlOiBjaGVja3BvaW50LnNlcXVlbmNlLFxuICAgICAgdXBUb1NlcXVlbmNlOiBjZWlsaW5nXG4gICAgfSlcblxuICAgIGZvciAoY29uc3QgZXZlbnQgb2YgZXZlbnRzKSB7XG4gICAgICBpZiAoc3Vic2NyaXB0aW9uLmlzQ2xvc2VkKCkpIGJyZWFrXG5cbiAgICAgIGlmIChhd2FpdCBzdWJzY3JpcHRpb24uX3JlcXVpcmVzUmVwbGF5R2FwKGV2ZW50LnBheWxvYWQpKSB7XG4gICAgICAgIHRoaXMuc2VuZEpzb24oe1xuICAgICAgICAgIHR5cGU6IFwiY2hhbm5lbC1yZXBsYXktZ2FwXCIsXG4gICAgICAgICAgc3Vic2NyaXB0aW9uSWQ6IHN1YnNjcmlwdGlvbi5zdWJzY3JpcHRpb25JZCxcbiAgICAgICAgICBsYXN0RXZlbnRJZFxuICAgICAgICB9KVxuICAgICAgICByZXR1cm5cbiAgICAgIH1cblxuICAgICAgYXdhaXQgc3Vic2NyaXB0aW9uLmRlbGl2ZXJCcm9hZGNhc3QoXG4gICAgICAgIC8qKiBAdHlwZSB7aW1wb3J0KFwiLi4vd2Vic29ja2V0LWNoYW5uZWwuanNcIikuV2Vic29ja2V0SnNvblZhbHVlfSAqLyAoZXZlbnQucGF5bG9hZCksXG4gICAgICAgIHtldmVudElkOiBldmVudC5pZH1cbiAgICAgIClcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogSGFuZGxlcyBge3R5cGU6IFwiY2hhbm5lbC11bnN1YnNjcmliZVwifWAgZnJvbSB0aGUgY2xpZW50IOKAlCBjYWxsc1xuICAgKiBgdW5zdWJzY3JpYmVkKClgIGFuZCBzZW5kcyBgY2hhbm5lbC11bnN1YnNjcmliZWRgLlxuICAgKiBAcGFyYW0ge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gbWVzc2FnZSAtIENoYW5uZWwtdW5zdWJzY3JpYmUgZnJhbWUgY29udGFpbmluZyB0aGUgc3Vic2NyaXB0aW9uIGlkZW50aWZpZXIuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fVxuICAgKi9cbiAgYXN5bmMgX2hhbmRsZUNoYW5uZWxVbnN1YnNjcmliZShtZXNzYWdlKSB7XG4gICAgY29uc3Qgc3Vic2NyaXB0aW9uSWQgPSBtZXNzYWdlLnN1YnNjcmlwdGlvbklkXG5cbiAgICBpZiAodHlwZW9mIHN1YnNjcmlwdGlvbklkICE9PSBcInN0cmluZ1wiKSByZXR1cm5cblxuICAgIGNvbnN0IGVudHJ5ID0gdGhpcy5fY2hhbm5lbFN1YnNjcmlwdGlvbnMuZ2V0KHN1YnNjcmlwdGlvbklkKVxuXG4gICAgaWYgKCFlbnRyeSkgcmV0dXJuXG5cbiAgICB0aGlzLl9jaGFubmVsU3Vic2NyaXB0aW9ucy5kZWxldGUoc3Vic2NyaXB0aW9uSWQpXG4gICAgdGhpcy5jb25maWd1cmF0aW9uLl91bnJlZ2lzdGVyV2Vic29ja2V0Q2hhbm5lbFN1YnNjcmlwdGlvbihlbnRyeS5jaGFubmVsVHlwZSwgZW50cnkuc3Vic2NyaXB0aW9uKVxuICAgIGVudHJ5LnN1YnNjcmlwdGlvbi5fY2xvc2VkID0gdHJ1ZVxuXG4gICAgdHJ5IHtcbiAgICAgIGF3YWl0IHRoaXMuX3dpdGhDb25uZWN0aW9ucyhhc3luYyAoKSA9PiBhd2FpdCBlbnRyeS5zdWJzY3JpcHRpb24udW5zdWJzY3JpYmVkKCkpXG4gICAgfSBjYXRjaCAoY2F1Z2h0RXJyb3IpIHtcbiAgICAgIGNvbnN0IGVycm9yID0gdGhpcy5fcmVwb3J0VW5leHBlY3RlZERpc3BhdGNoRXJyb3IoY2F1Z2h0RXJyb3IsIHtcbiAgICAgICAgY2hhbm5lbFR5cGU6IGVudHJ5LmNoYW5uZWxUeXBlLFxuICAgICAgICBzdGFnZTogXCJ3ZWJzb2NrZXQtY2hhbm5lbC11bnN1YnNjcmliZVwiLFxuICAgICAgICBzdWJzY3JpcHRpb25JZFxuICAgICAgfSlcblxuICAgICAgdGhpcy5sb2dnZXIuZXJyb3IoKCkgPT4gW2BGYWlsZWQgdG8gdW5zdWJzY3JpYmUgY2hhbm5lbCAke2VudHJ5LmNoYW5uZWxUeXBlfToke3N1YnNjcmlwdGlvbklkfWAsIGVycm9yXSlcbiAgICB9XG5cbiAgICB0aGlzLnNlbmRKc29uKHt0eXBlOiBcImNoYW5uZWwtdW5zdWJzY3JpYmVkXCIsIHN1YnNjcmlwdGlvbklkfSlcbiAgfVxuXG4gIC8qKlxuICAgKiBGaXJlcyBgdW5zdWJzY3JpYmVkKClgIG9uIGV2ZXJ5IGxpdmUgY2hhbm5lbC12MiBzdWJzY3JpcHRpb24sXG4gICAqIHJlbW92ZXMgdGhlbSBmcm9tIHRoZSBDb25maWd1cmF0aW9uJ3MgZ2xvYmFsIHJlZ2lzdHJ5LCBhbmRcbiAgICogZHJvcHMgdGhlIHNlc3Npb24ncyBvd24gbWFwLiBObyBuZXR3b3JrIGZyYW1lcyDigJQgdGhlIHNvY2tldFxuICAgKiBpcyBhbHJlYWR5IGdvaW5nIGF3YXkuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fVxuICAgKi9cbiAgYXN5bmMgX3RlYXJkb3duQ2hhbm5lbFN1YnNjcmlwdGlvbnMoKSB7XG4gICAgY29uc3QgZW50cmllcyA9IFsuLi50aGlzLl9jaGFubmVsU3Vic2NyaXB0aW9ucy52YWx1ZXMoKV1cblxuICAgIHRoaXMuX2NoYW5uZWxTdWJzY3JpcHRpb25zLmNsZWFyKClcblxuICAgIGZvciAoY29uc3Qge2NoYW5uZWxUeXBlLCBzdWJzY3JpcHRpb259IG9mIGVudHJpZXMpIHtcbiAgICAgIHRoaXMuY29uZmlndXJhdGlvbi5fdW5yZWdpc3RlcldlYnNvY2tldENoYW5uZWxTdWJzY3JpcHRpb24oY2hhbm5lbFR5cGUsIHN1YnNjcmlwdGlvbilcbiAgICAgIHN1YnNjcmlwdGlvbi5fY2xvc2VkID0gdHJ1ZVxuXG4gICAgICB0cnkge1xuICAgICAgICBhd2FpdCB0aGlzLl93aXRoQ29ubmVjdGlvbnMoYXN5bmMgKCkgPT4gYXdhaXQgc3Vic2NyaXB0aW9uLnVuc3Vic2NyaWJlZCgpKVxuICAgICAgfSBjYXRjaCAoY2F1Z2h0RXJyb3IpIHtcbiAgICAgICAgY29uc3QgZXJyb3IgPSB0aGlzLl9yZXBvcnRVbmV4cGVjdGVkRGlzcGF0Y2hFcnJvcihjYXVnaHRFcnJvciwge1xuICAgICAgICAgIGNoYW5uZWxUeXBlLFxuICAgICAgICAgIHN0YWdlOiBcIndlYnNvY2tldC1jaGFubmVsLXRlYXJkb3duXCIsXG4gICAgICAgICAgc3Vic2NyaXB0aW9uSWQ6IHN1YnNjcmlwdGlvbi5zdWJzY3JpcHRpb25JZFxuICAgICAgICB9KVxuXG4gICAgICAgIHRoaXMubG9nZ2VyLmVycm9yKCgpID0+IFtgRmFpbGVkIHRvIHRlYXIgZG93biBjaGFubmVsLXYyICR7Y2hhbm5lbFR5cGV9OiR7c3Vic2NyaXB0aW9uLnN1YnNjcmlwdGlvbklkfWAsIGVycm9yXSlcbiAgICAgIH1cbiAgICB9XG4gIH1cblxuICBhc3luYyBfdGVhcmRvd25DaGFubmVsKCkge1xuICAgIGZvciAoY29uc3QgY2hhbm5lbCBvZiB0aGlzLmNoYW5uZWxzKSB7XG4gICAgICBhd2FpdCB0aGlzLl90ZWFyZG93blNpbmdsZUNoYW5uZWwoY2hhbm5lbClcbiAgICB9XG4gICAgdGhpcy5jaGFubmVscy5jbGVhcigpXG4gICAgdGhpcy5jaGFubmVsUmVwbGF5U3RhdGVzLmNsZWFyKClcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHRlYXJkb3duIHNpbmdsZSBjaGFubmVsLlxuICAgKiBAcGFyYW0ge1dlYnNvY2tldENoYW5uZWx9IGNoYW5uZWwgLSBDaGFubmVsIGluc3RhbmNlLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyB3aGVuIGNvbXBsZXRlLlxuICAgKi9cbiAgYXN5bmMgX3RlYXJkb3duU2luZ2xlQ2hhbm5lbChjaGFubmVsKSB7XG4gICAgdHJ5IHtcbiAgICAgIGNvbnN0IHRlbmFudCA9IHRoaXMuY2hhbm5lbFRlbmFudHMuZ2V0KGNoYW5uZWwpXG5cbiAgICAgIGF3YWl0IHRoaXMuY29uZmlndXJhdGlvbi5ydW5XaXRoVGVuYW50KHRlbmFudCwgYXN5bmMgKCkgPT4ge1xuICAgICAgICBhd2FpdCB0aGlzLl93aXRoQ29ubmVjdGlvbnMoYXN5bmMgKCkgPT4ge1xuICAgICAgICAgIGF3YWl0IGNoYW5uZWw/LnVuc3Vic2NyaWJlZD8uKClcbiAgICAgICAgfSlcbiAgICAgIH0pXG4gICAgfSBjYXRjaCAoY2F1Z2h0RXJyb3IpIHtcbiAgICAgIGNvbnN0IGVycm9yID0gdGhpcy5fcmVwb3J0VW5leHBlY3RlZERpc3BhdGNoRXJyb3IoY2F1Z2h0RXJyb3IsIHtcbiAgICAgICAgc3RhZ2U6IFwid2Vic29ja2V0LWNoYW5uZWwtdGVhcmRvd25cIlxuICAgICAgfSlcblxuICAgICAgdGhpcy5sb2dnZXIuZXJyb3IoKCkgPT4gW1wiRmFpbGVkIHRvIHRlYXJkb3duIHdlYnNvY2tldCBjaGFubmVsXCIsIGVycm9yXSlcbiAgICB9XG5cbiAgICBjb25zdCBzdWJzY3JpcHRpb25zID0gdGhpcy5oYW5kbGVyU3Vic2NyaXB0aW9ucy5nZXQoY2hhbm5lbClcblxuICAgIGlmIChzdWJzY3JpcHRpb25zKSB7XG4gICAgICBmb3IgKGNvbnN0IHN1YnNjcmlwdGlvbkNoYW5uZWwgb2Ygc3Vic2NyaXB0aW9ucykge1xuICAgICAgICB0aGlzLnN1YnNjcmlwdGlvbkhhbmRsZXJzLmdldChzdWJzY3JpcHRpb25DaGFubmVsKT8uZGVsZXRlKGNoYW5uZWwpXG5cbiAgICAgICAgaWYgKHRoaXMuc3Vic2NyaXB0aW9uSGFuZGxlcnMuZ2V0KHN1YnNjcmlwdGlvbkNoYW5uZWwpPy5zaXplID09PSAwKSB7XG4gICAgICAgICAgdGhpcy5zdWJzY3JpcHRpb25IYW5kbGVycy5kZWxldGUoc3Vic2NyaXB0aW9uQ2hhbm5lbClcbiAgICAgICAgfVxuICAgICAgfVxuXG4gICAgICB0aGlzLmhhbmRsZXJTdWJzY3JpcHRpb25zLmRlbGV0ZShjaGFubmVsKVxuICAgIH1cblxuICAgIHRoaXMuY2hhbm5lbFRlbmFudHMuZGVsZXRlKGNoYW5uZWwpXG4gIH1cblxuICAvKipcbiAgICogUnVucyByZWdpc3RlciBjaGFubmVsLlxuICAgKiBAcGFyYW0ge1dlYnNvY2tldENoYW5uZWwgfCB1bmRlZmluZWR9IGNoYW5uZWwgLSBDaGFubmVsIGluc3RhbmNlLlxuICAgKiBAcGFyYW0ge3N0cmluZyB8IG51bGwgfCB1bmRlZmluZWR9IHRlbmFudCAtIFRlbmFudCBrZXkuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIHdoZW4gY29tcGxldGUuXG4gICAqL1xuICBhc3luYyBfcmVnaXN0ZXJDaGFubmVsKGNoYW5uZWwsIHRlbmFudCkge1xuICAgIGlmICghY2hhbm5lbCkgcmV0dXJuXG5cbiAgICB0aGlzLmNoYW5uZWxzLmFkZChjaGFubmVsKVxuICAgIHRoaXMuY2hhbm5lbFRlbmFudHMuc2V0KGNoYW5uZWwsIHRlbmFudClcbiAgICBhd2FpdCB0aGlzLmNvbmZpZ3VyYXRpb24ucnVuV2l0aFRlbmFudCh0ZW5hbnQsIGFzeW5jICgpID0+IHtcbiAgICAgIGF3YWl0IHRoaXMuX3dpdGhDb25uZWN0aW9ucyhhc3luYyAoKSA9PiB7XG4gICAgICAgIGF3YWl0IGNoYW5uZWw/LnN1YnNjcmliZWQ/LigpXG4gICAgICB9KVxuICAgIH0pXG4gIH1cblxuICAvKipcbiAgICogUnVucyB3aXRoIGNvbm5lY3Rpb25zLlxuICAgKiBAcGFyYW0geygpID0+IFByb21pc2U8dm9pZD59IGNhbGxiYWNrIC0gQ2FsbGJhY2suXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIHdoZW4gY29tcGxldGUuXG4gICAqL1xuICBhc3luYyBfd2l0aENvbm5lY3Rpb25zKGNhbGxiYWNrKSB7XG4gICAgYXdhaXQgdGhpcy5jb25maWd1cmF0aW9uLmVuc3VyZUNvbm5lY3Rpb25zKHtuYW1lOiBcIldlYnNvY2tldCBzZXNzaW9uXCJ9LCBhc3luYyAoKSA9PiB7XG4gICAgICBhd2FpdCBjYWxsYmFjaygpXG4gICAgfSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGhhbmRsZSBjaGFubmVsIHN1YnNjcmlwdGlvbi5cbiAgICogQHBhcmFtIHt7Y2hhbm5lbDogc3RyaW5nLCBsYXN0RXZlbnRJZD86IHN0cmluZywgcGFyYW1zPzogUmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fX0gYXJncyAtIFN1YnNjcmlwdGlvbiBhcmdzLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyB3aGVuIGNvbXBsZXRlLlxuICAgKi9cbiAgYXN5bmMgX2hhbmRsZUNoYW5uZWxTdWJzY3JpcHRpb24oe2NoYW5uZWwsIGxhc3RFdmVudElkLCBwYXJhbXN9KSB7XG4gICAgY29uc3QgcmVzb2x2ZXIgPSB0aGlzLmNvbmZpZ3VyYXRpb24uZ2V0V2Vic29ja2V0Q2hhbm5lbFJlc29sdmVyPy4oKVxuXG4gICAgaWYgKCFyZXNvbHZlcikgcmV0dXJuXG5cbiAgICB0cnkge1xuICAgICAgLy8gVGVuYW50IHJlc29sdXRpb24gY2FuIHJ1biBkYXRhYmFzZSBxdWVyaWVzLCBzbyBpdCBtdXN0IGhhcHBlbiBpbnNpZGUgYVxuICAgICAgLy8gY29ubmVjdGlvbiBzY29wZSAoc2VlIF9oYW5kbGVDaGFubmVsU3Vic2NyaWJlKS5cbiAgICAgIGxldCB0ZW5hbnRcbiAgICAgIGF3YWl0IHRoaXMuX3dpdGhDb25uZWN0aW9ucyhhc3luYyAoKSA9PiB7XG4gICAgICAgIHRlbmFudCA9IGF3YWl0IHRoaXMuX3Jlc29sdmVUZW5hbnQoe2NoYW5uZWwsIHBhcmFtc30pXG4gICAgICB9KVxuICAgICAgY29uc3QgcmVzb2x2ZWQgPSBhd2FpdCB0aGlzLmNvbmZpZ3VyYXRpb24ucnVuV2l0aFRlbmFudCh0ZW5hbnQsIGFzeW5jICgpID0+IHtcbiAgICAgICAgcmV0dXJuIGF3YWl0IHJlc29sdmVyKHtcbiAgICAgICAgICBjbGllbnQ6IHRoaXMuY2xpZW50LFxuICAgICAgICAgIGNvbmZpZ3VyYXRpb246IHRoaXMuY29uZmlndXJhdGlvbixcbiAgICAgICAgICByZXF1ZXN0OiB0aGlzLnVwZ3JhZGVSZXF1ZXN0LFxuICAgICAgICAgIHN1YnNjcmlwdGlvbjoge2NoYW5uZWwsIHBhcmFtc30sXG4gICAgICAgICAgd2Vic29ja2V0U2Vzc2lvbjogdGhpc1xuICAgICAgICB9KVxuICAgICAgfSlcblxuICAgICAgaWYgKCFyZXNvbHZlZCkge1xuICAgICAgICB0aGlzLnNlbmRKc29uKHtjaGFubmVsLCBlcnJvcjogXCJTdWJzY3JpcHRpb24gcmVqZWN0ZWRcIiwgdHlwZTogXCJlcnJvclwifSlcbiAgICAgICAgcmV0dXJuXG4gICAgICB9XG5cbiAgICAgIGNvbnN0IGNoYW5uZWxJbnN0YW5jZSA9IHR5cGVvZiByZXNvbHZlZCA9PT0gXCJmdW5jdGlvblwiXG4gICAgICAgID8gbmV3IHJlc29sdmVkKHtcbiAgICAgICAgICBjbGllbnQ6IHRoaXMuY2xpZW50LFxuICAgICAgICAgIGNvbmZpZ3VyYXRpb246IHRoaXMuY29uZmlndXJhdGlvbixcbiAgICAgICAgICBsYXN0RXZlbnRJZCxcbiAgICAgICAgICByZXF1ZXN0OiB0aGlzLnVwZ3JhZGVSZXF1ZXN0LFxuICAgICAgICAgIHN1YnNjcmlwdGlvbkNoYW5uZWw6IGNoYW5uZWwsXG4gICAgICAgICAgc3Vic2NyaXB0aW9uUGFyYW1zOiBwYXJhbXMsXG4gICAgICAgICAgd2Vic29ja2V0U2Vzc2lvbjogdGhpc1xuICAgICAgICB9KVxuICAgICAgICA6IHJlc29sdmVkXG5cbiAgICAgIGlmIChjaGFubmVsSW5zdGFuY2UgJiYgIShjaGFubmVsSW5zdGFuY2UgaW5zdGFuY2VvZiBXZWJzb2NrZXRDaGFubmVsKSkge1xuICAgICAgICB0aHJvdyBuZXcgRXJyb3IoXCJSZXNvbHZlZCB3ZWJzb2NrZXQgY2hhbm5lbCBtdXN0IGV4dGVuZCBXZWJzb2NrZXRDaGFubmVsXCIpXG4gICAgICB9XG5cbiAgICAgIGF3YWl0IHRoaXMuX3JlZ2lzdGVyQ2hhbm5lbChjaGFubmVsSW5zdGFuY2UsIHRlbmFudClcbiAgICB9IGNhdGNoIChjYXVnaHRFcnJvcikge1xuICAgICAgY29uc3QgZXJyb3IgPSB0aGlzLl9yZXBvcnRVbmV4cGVjdGVkRGlzcGF0Y2hFcnJvcihjYXVnaHRFcnJvciwge1xuICAgICAgICBjaGFubmVsLFxuICAgICAgICBzdGFnZTogXCJ3ZWJzb2NrZXQtY2hhbm5lbC1zdWJzY3JpcHRpb25cIlxuICAgICAgfSlcblxuICAgICAgdGhpcy5sb2dnZXIud2FybigoKSA9PiBbXCJXZWJzb2NrZXQgY2hhbm5lbCBzdWJzY3JpcHRpb24gZmFpbGVkXCIsIGVycm9yXSlcbiAgICAgIHRoaXMuc2VuZEpzb24oe2NoYW5uZWwsIGVycm9yOiBcIlN1YnNjcmlwdGlvbiByZWplY3RlZFwiLCB0eXBlOiBcImVycm9yXCJ9KVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHByZXBhcmUgcmVwbGF5IHN0YXRlLlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIE9wdGlvbnMuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBhcmdzLmNoYW5uZWwgLSBJbnRlcm5hbCBjaGFubmVsIG5hbWUuXG4gICAqIEBwYXJhbSB7c3RyaW5nIHwgdW5kZWZpbmVkfSBhcmdzLmxhc3RFdmVudElkIC0gTGFzdCByZWNlaXZlZCBldmVudCBpZC5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGFyZ3Muc3Vic2NyaXB0aW9uQ2hhbm5lbCAtIENsaWVudC1mYWNpbmcgY2hhbm5lbCBuYW1lLlxuICAgKiBAcGFyYW0ge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+PiB8IHVuZGVmaW5lZH0gYXJncy5zdWJzY3JpcHRpb25QYXJhbXMgLSBDbGllbnQtZmFjaW5nIHBhcmFtcy5cbiAgICogQHJldHVybnMge1Byb21pc2U8ZmFsc2UgfCB7YnVmZmVyZWQ6IGJvb2xlYW4sIGNlaWxpbmdTZXF1ZW5jZTogbnVtYmVyLCBjaGVja3BvaW50U2VxdWVuY2U6IG51bWJlciwgcmVwbGF5aW5nOiBib29sZWFufSB8IG51bGw+fSAtIFJlcGxheSBzdGF0ZS5cbiAgICovXG4gIGFzeW5jIF9wcmVwYXJlUmVwbGF5U3RhdGUoe2NoYW5uZWwsIGxhc3RFdmVudElkLCBzdWJzY3JpcHRpb25DaGFubmVsLCBzdWJzY3JpcHRpb25QYXJhbXN9KSB7XG4gICAgaWYgKCFsYXN0RXZlbnRJZCkgcmV0dXJuIG51bGxcblxuICAgIGNvbnN0IHN0b3JlID0gd2Vic29ja2V0RXZlbnRMb2dTdG9yZUZvckNvbmZpZ3VyYXRpb24odGhpcy5jb25maWd1cmF0aW9uKVxuICAgIGNvbnN0IGNoZWNrcG9pbnQgPSBhd2FpdCBzdG9yZS5nZXRFdmVudEJ5SWQoe2NoYW5uZWwsIGlkOiBsYXN0RXZlbnRJZH0pXG5cbiAgICBpZiAoIWNoZWNrcG9pbnQpIHtcbiAgICAgIHRoaXMuc2VuZEpzb24oe2NoYW5uZWw6IHN1YnNjcmlwdGlvbkNoYW5uZWwsIGxhc3RFdmVudElkLCBwYXJhbXM6IHN1YnNjcmlwdGlvblBhcmFtcywgdHlwZTogXCJyZXBsYXktZ2FwXCJ9KVxuICAgICAgcmV0dXJuIGZhbHNlXG4gICAgfVxuXG4gICAgcmV0dXJuIHtcbiAgICAgIGJ1ZmZlcmVkOiBmYWxzZSxcbiAgICAgIGNlaWxpbmdTZXF1ZW5jZTogKGF3YWl0IHN0b3JlLmxhdGVzdFNlcXVlbmNlKGNoYW5uZWwpKSB8fCBjaGVja3BvaW50LnNlcXVlbmNlLFxuICAgICAgY2hlY2twb2ludFNlcXVlbmNlOiBjaGVja3BvaW50LnNlcXVlbmNlLFxuICAgICAgcmVwbGF5aW5nOiB0cnVlXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgcmVwbGF5IGNoYW5uZWwgZXZlbnRzLlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIE9wdGlvbnMuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBhcmdzLmNoYW5uZWwgLSBDaGFubmVsIG5hbWUuXG4gICAqIEBwYXJhbSB7e2J1ZmZlcmVkOiBib29sZWFuLCBjZWlsaW5nU2VxdWVuY2U6IG51bWJlciwgY2hlY2twb2ludFNlcXVlbmNlOiBudW1iZXIsIHJlcGxheWluZzogYm9vbGVhbn19IGFyZ3MucmVwbGF5U3RhdGUgLSBSZXBsYXkgc3RhdGUuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIHdoZW4gcmVwbGF5IGNvbXBsZXRlcy5cbiAgICovXG4gIGFzeW5jIF9yZXBsYXlDaGFubmVsRXZlbnRzKHtjaGFubmVsLCByZXBsYXlTdGF0ZX0pIHtcbiAgICBjb25zdCBzdG9yZSA9IHdlYnNvY2tldEV2ZW50TG9nU3RvcmVGb3JDb25maWd1cmF0aW9uKHRoaXMuY29uZmlndXJhdGlvbilcbiAgICBjb25zdCBldmVudHMgPSBhd2FpdCBzdG9yZS5nZXRFdmVudHNBZnRlcih7XG4gICAgICBjaGFubmVsLFxuICAgICAgc2VxdWVuY2U6IHJlcGxheVN0YXRlLmNoZWNrcG9pbnRTZXF1ZW5jZSxcbiAgICAgIHVwVG9TZXF1ZW5jZTogcmVwbGF5U3RhdGUuY2VpbGluZ1NlcXVlbmNlXG4gICAgfSlcblxuICAgIGZvciAoY29uc3QgZXZlbnQgb2YgZXZlbnRzKSB7XG4gICAgICBhd2FpdCB0aGlzLnNlbmRFdmVudChjaGFubmVsLCBldmVudC5wYXlsb2FkLCB7XG4gICAgICAgIGNyZWF0ZWRBdDogZXZlbnQuY3JlYXRlZEF0LFxuICAgICAgICBldmVudElkOiBldmVudC5pZCxcbiAgICAgICAgcmVwbGF5ZWQ6IHRydWUsXG4gICAgICAgIHNlcXVlbmNlOiBldmVudC5zZXF1ZW5jZVxuICAgICAgfSlcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogUnVucyBmaW5pc2ggcmVwbGF5IHN0YXRlLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gY2hhbm5lbCAtIENoYW5uZWwgbmFtZS5cbiAgICogQHBhcmFtIHt7YnVmZmVyZWQ6IGJvb2xlYW4sIGNlaWxpbmdTZXF1ZW5jZTogbnVtYmVyLCBjaGVja3BvaW50U2VxdWVuY2U6IG51bWJlciwgcmVwbGF5aW5nOiBib29sZWFufX0gcmVwbGF5U3RhdGUgLSBSZXBsYXkgc3RhdGUuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIHdoZW4gYnVmZmVyZWQgZXZlbnRzIGFyZSBmbHVzaGVkLlxuICAgKi9cbiAgYXN5bmMgX2ZpbmlzaFJlcGxheVN0YXRlKGNoYW5uZWwsIHJlcGxheVN0YXRlKSB7XG4gICAgY29uc3Qgc3RvcmUgPSB3ZWJzb2NrZXRFdmVudExvZ1N0b3JlRm9yQ29uZmlndXJhdGlvbih0aGlzLmNvbmZpZ3VyYXRpb24pXG5cbiAgICByZXBsYXlTdGF0ZS5yZXBsYXlpbmcgPSBmYWxzZVxuICAgIHRoaXMuY2hhbm5lbFJlcGxheVN0YXRlcy5kZWxldGUoY2hhbm5lbClcblxuICAgIGlmICghcmVwbGF5U3RhdGUuYnVmZmVyZWQpIHJldHVyblxuXG4gICAgY29uc3QgbGl2ZUV2ZW50cyA9IGF3YWl0IHN0b3JlLmdldEV2ZW50c0FmdGVyKHtcbiAgICAgIGNoYW5uZWwsXG4gICAgICBzZXF1ZW5jZTogcmVwbGF5U3RhdGUuY2VpbGluZ1NlcXVlbmNlXG4gICAgfSlcblxuICAgIGZvciAoY29uc3QgZXZlbnQgb2YgbGl2ZUV2ZW50cykge1xuICAgICAgYXdhaXQgdGhpcy5zZW5kRXZlbnQoY2hhbm5lbCwgZXZlbnQucGF5bG9hZCwge1xuICAgICAgICBjcmVhdGVkQXQ6IGV2ZW50LmNyZWF0ZWRBdCxcbiAgICAgICAgZXZlbnRJZDogZXZlbnQuaWQsXG4gICAgICAgIHNlcXVlbmNlOiBldmVudC5zZXF1ZW5jZVxuICAgICAgfSlcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogUnVucyByZXNvbHZlIHRlbmFudC5cbiAgICogQHBhcmFtIHt7Y2hhbm5lbD86IHN0cmluZywgcGFyYW1zPzogUmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fX0gYXJncyAtIFRlbmFudCByZXNvbHV0aW9uIGFyZ3MuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHN0cmluZyB8IG51bGwgfCB1bmRlZmluZWQ+fSAtIFJlc29sdmVkIHRlbmFudC5cbiAgICovXG4gIGFzeW5jIF9yZXNvbHZlVGVuYW50KHtjaGFubmVsLCBwYXJhbXN9KSB7XG4gICAgY29uc3QgcmVxdWVzdFBhcmFtcyA9IHRoaXMudXBncmFkZVJlcXVlc3Q/LnBhcmFtcz8uKClcbiAgICBjb25zdCBtZXJnZWRQYXJhbXMgPSB7XG4gICAgICAuLi4ocmVxdWVzdFBhcmFtcyAmJiB0eXBlb2YgcmVxdWVzdFBhcmFtcyA9PT0gXCJvYmplY3RcIiA/IHJlcXVlc3RQYXJhbXMgOiB7fSksXG4gICAgICAuLi4ocGFyYW1zICYmIHR5cGVvZiBwYXJhbXMgPT09IFwib2JqZWN0XCIgPyBwYXJhbXMgOiB7fSlcbiAgICB9XG5cbiAgICByZXR1cm4gLyoqIEB0eXBlIHtQcm9taXNlPHN0cmluZyB8IG51bGwgfCB1bmRlZmluZWQ+fSAqLyAodGhpcy5jb25maWd1cmF0aW9uLnJlc29sdmVUZW5hbnQoe1xuICAgICAgcGFyYW1zOiBtZXJnZWRQYXJhbXMsXG4gICAgICByZXF1ZXN0OiB0aGlzLnVwZ3JhZGVSZXF1ZXN0LFxuICAgICAgcmVzcG9uc2U6IHVuZGVmaW5lZCxcbiAgICAgIHN1YnNjcmlwdGlvbjogY2hhbm5lbCA/IHtjaGFubmVsLCBwYXJhbXN9IDogdW5kZWZpbmVkXG4gICAgfSkpXG4gIH1cblxuICAvKipcbiAgICogUnVucyB1bm1hc2sgcGF5bG9hZC5cbiAgICogQHBhcmFtIHtCdWZmZXJ9IHBheWxvYWQgLSBQYXlsb2FkIGRhdGEuXG4gICAqIEBwYXJhbSB7QnVmZmVyfSBtYXNrIC0gTWFzay5cbiAgICogQHJldHVybnMge3ZvaWR9IC0gTm8gcmV0dXJuIHZhbHVlLlxuICAgKi9cbiAgX3VubWFza1BheWxvYWQocGF5bG9hZCwgbWFzaykge1xuICAgIGZvciAobGV0IGkgPSAwOyBpIDwgcGF5bG9hZC5sZW5ndGg7IGkrKykge1xuICAgICAgcGF5bG9hZFtpXSBePSBtYXNrW2kgJSA0XVxuICAgIH1cbiAgfVxuXG4gIGFzeW5jIF9ydW5NZXNzYWdlSGFuZGxlck9wZW4oKSB7XG4gICAgdHJ5IHtcbiAgICAgIGNvbnN0IGhhbmRsZXIgPSB0aGlzLm1lc3NhZ2VIYW5kbGVyXG4gICAgICBjb25zdCBvbk9wZW4gPSBoYW5kbGVyID8gaGFuZGxlci5vbk9wZW4gOiBudWxsXG5cbiAgICAgIGlmIChvbk9wZW4pIHtcbiAgICAgICAgYXdhaXQgb25PcGVuKHtzZXNzaW9uOiB0aGlzfSlcbiAgICAgIH1cbiAgICB9IGNhdGNoIChjYXVnaHRFcnJvcikge1xuICAgICAgY29uc3QgZXJyb3IgPSB0aGlzLl9yZXBvcnRVbmV4cGVjdGVkRGlzcGF0Y2hFcnJvcihjYXVnaHRFcnJvciwge1xuICAgICAgICBzdGFnZTogXCJ3ZWJzb2NrZXQtbWVzc2FnZS1oYW5kbGVyLW9wZW5cIlxuICAgICAgfSlcblxuICAgICAgdGhpcy5sb2dnZXIuZXJyb3IoKCkgPT4gW1wiV2Vic29ja2V0IG9wZW4gaGFuZGxlciBmYWlsZWRcIiwgZXJyb3JdKVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHJ1biBtZXNzYWdlIGhhbmRsZXIgbWVzc2FnZS5cbiAgICogQHBhcmFtIHtXZWJzb2NrZXRTZXNzaW9uTWVzc2FnZX0gbWVzc2FnZSAtIEluY29taW5nIHdlYnNvY2tldCBtZXNzYWdlLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyB3aGVuIGNvbXBsZXRlLlxuICAgKi9cbiAgYXN5bmMgX3J1bk1lc3NhZ2VIYW5kbGVyTWVzc2FnZShtZXNzYWdlKSB7XG4gICAgdHJ5IHtcbiAgICAgIGNvbnN0IGhhbmRsZXIgPSB0aGlzLm1lc3NhZ2VIYW5kbGVyXG4gICAgICBjb25zdCBvbk1lc3NhZ2UgPSBoYW5kbGVyID8gaGFuZGxlci5vbk1lc3NhZ2UgOiBudWxsXG5cbiAgICAgIGlmIChvbk1lc3NhZ2UpIHtcbiAgICAgICAgYXdhaXQgb25NZXNzYWdlKHttZXNzYWdlLCBzZXNzaW9uOiB0aGlzfSlcbiAgICAgIH1cbiAgICB9IGNhdGNoIChjYXVnaHRFcnJvcikge1xuICAgICAgY29uc3QgaGFuZGxlciA9IHRoaXMubWVzc2FnZUhhbmRsZXJcbiAgICAgIGNvbnN0IG9uRXJyb3IgPSBoYW5kbGVyID8gaGFuZGxlci5vbkVycm9yIDogbnVsbFxuICAgICAgY29uc3QgaGFuZGxlckVycm9yID0gZW5zdXJlRXJyb3IoY2F1Z2h0RXJyb3IpXG4gICAgICBjb25zdCBlcnJvciA9IHRoaXMuX3JlcG9ydFVuZXhwZWN0ZWREaXNwYXRjaEVycm9yKGhhbmRsZXJFcnJvciwge1xuICAgICAgICBzdGFnZTogXCJ3ZWJzb2NrZXQtbWVzc2FnZS1oYW5kbGVyXCJcbiAgICAgIH0pXG5cbiAgICAgIHRoaXMubG9nZ2VyLmVycm9yKCgpID0+IFtcIldlYnNvY2tldCBtZXNzYWdlIGhhbmRsZXIgZmFpbGVkXCIsIGVycm9yXSlcbiAgICAgIGlmICghb25FcnJvcikgcmV0dXJuXG5cbiAgICAgIHRyeSB7XG4gICAgICAgIGF3YWl0IG9uRXJyb3Ioe2Vycm9yOiBoYW5kbGVyRXJyb3IsIHNlc3Npb246IHRoaXN9KVxuICAgICAgfSBjYXRjaCAob25FcnJvckNhdWdodEVycm9yKSB7XG4gICAgICAgIGNvbnN0IGNsaWVudEVycm9yTWVzc2FnZSA9IG9uRXJyb3JDYXVnaHRFcnJvciBpbnN0YW5jZW9mIEVycm9yXG4gICAgICAgICAgPyBvbkVycm9yQ2F1Z2h0RXJyb3IubWVzc2FnZVxuICAgICAgICAgIDogU3RyaW5nKG9uRXJyb3JDYXVnaHRFcnJvcilcbiAgICAgICAgY29uc3Qgb25FcnJvckVycm9yID0gdGhpcy5fcmVwb3J0VW5leHBlY3RlZERpc3BhdGNoRXJyb3Iob25FcnJvckNhdWdodEVycm9yLCB7XG4gICAgICAgICAgc3RhZ2U6IFwid2Vic29ja2V0LW1lc3NhZ2UtaGFuZGxlci1lcnJvclwiXG4gICAgICAgIH0pXG5cbiAgICAgICAgdGhpcy5sb2dnZXIuZXJyb3IoKCkgPT4gW1wiV2Vic29ja2V0IG1lc3NhZ2UgZXJyb3IgaGFuZGxlciBmYWlsZWRcIiwgb25FcnJvckVycm9yXSlcbiAgICAgICAgdGhpcy5zZW5kSnNvbih7XG4gICAgICAgICAgZXJyb3I6IGNsaWVudEVycm9yTWVzc2FnZSxcbiAgICAgICAgICB0eXBlOiBcImVycm9yXCJcbiAgICAgICAgfSlcbiAgICAgIH1cbiAgICB9XG4gIH1cblxuICBhc3luYyBfcnVuTWVzc2FnZUhhbmRsZXJDbG9zZSgpIHtcbiAgICB0cnkge1xuICAgICAgY29uc3QgaGFuZGxlciA9IHRoaXMubWVzc2FnZUhhbmRsZXJcbiAgICAgIGNvbnN0IG9uQ2xvc2UgPSBoYW5kbGVyID8gaGFuZGxlci5vbkNsb3NlIDogbnVsbFxuXG4gICAgICBpZiAob25DbG9zZSkge1xuICAgICAgICBhd2FpdCBvbkNsb3NlKHtzZXNzaW9uOiB0aGlzfSlcbiAgICAgIH1cbiAgICB9IGNhdGNoIChjYXVnaHRFcnJvcikge1xuICAgICAgY29uc3QgZXJyb3IgPSB0aGlzLl9yZXBvcnRVbmV4cGVjdGVkRGlzcGF0Y2hFcnJvcihjYXVnaHRFcnJvciwge1xuICAgICAgICBzdGFnZTogXCJ3ZWJzb2NrZXQtbWVzc2FnZS1oYW5kbGVyLWNsb3NlXCJcbiAgICAgIH0pXG5cbiAgICAgIHRoaXMubG9nZ2VyLmVycm9yKCgpID0+IFtcIldlYnNvY2tldCBjbG9zZSBoYW5kbGVyIGZhaWxlZFwiLCBlcnJvcl0pXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgcmVtb3RlIGFkZHJlc3MuXG4gICAqIEByZXR1cm5zIHtzdHJpbmcgfCB1bmRlZmluZWR9IC0gUmVtb3RlIGFkZHJlc3MgcmVzb2x2ZWQgZnJvbSB0aGUgd2Vic29ja2V0IHVwZ3JhZGUgcmVxdWVzdC5cbiAgICovXG4gIHJlbW90ZUFkZHJlc3MoKSB7XG4gICAgcmV0dXJuIHRoaXMudXBncmFkZVJlcXVlc3Q/LnJlbW90ZUFkZHJlc3MoKSB8fCB0aGlzLmNsaWVudC5yZW1vdGVBZGRyZXNzXG4gIH1cblxuICAvKipcbiAgICogUnVucyBzZXQgbWVzc2FnZSBoYW5kbGVyLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uLy4uL2NvbmZpZ3VyYXRpb24tdHlwZXMuanNcIikuV2Vic29ja2V0TWVzc2FnZUhhbmRsZXJ9IGhhbmRsZXIgLSBIYW5kbGVyIGluc3RhbmNlLlxuICAgKiBAcmV0dXJucyB7dm9pZH1cbiAgICovXG4gIHNldE1lc3NhZ2VIYW5kbGVyKGhhbmRsZXIpIHtcbiAgICB0aGlzLm1lc3NhZ2VIYW5kbGVyID0gaGFuZGxlclxuICAgIHZvaWQgdGhpcy5fcnVuTWVzc2FnZUhhbmRsZXJPcGVuKClcbiAgfVxuXG4gIGFzeW5jIF9yZXNvbHZlTWVzc2FnZUhhbmRsZXJQcm9taXNlKCkge1xuICAgIGlmICghdGhpcy5tZXNzYWdlSGFuZGxlclByb21pc2UpIHJldHVyblxuXG4gICAgLyoqIEB0eXBlIHtpbXBvcnQoXCIuLi8uLi9jb25maWd1cmF0aW9uLXR5cGVzLmpzXCIpLldlYnNvY2tldE1lc3NhZ2VIYW5kbGVyIHwgdm9pZH0gKi9cbiAgICBsZXQgaGFuZGxlclxuXG4gICAgdHJ5IHtcbiAgICAgIGhhbmRsZXIgPSBhd2FpdCB0aGlzLm1lc3NhZ2VIYW5kbGVyUHJvbWlzZVxuICAgIH0gY2F0Y2ggKGNhdWdodEVycm9yKSB7XG4gICAgICBjb25zdCBlcnJvciA9IHRoaXMuX3JlcG9ydFVuZXhwZWN0ZWREaXNwYXRjaEVycm9yKGNhdWdodEVycm9yLCB7XG4gICAgICAgIHN0YWdlOiBcIndlYnNvY2tldC1tZXNzYWdlLWhhbmRsZXItcmVzb2x2ZXJcIlxuICAgICAgfSlcblxuICAgICAgdGhpcy5sb2dnZXIuZXJyb3IoKCkgPT4gW1wiV2Vic29ja2V0IG1lc3NhZ2UgaGFuZGxlciByZXNvbHZlciBmYWlsZWRcIiwgZXJyb3JdKVxuICAgICAgdGhpcy5tZXNzYWdlSGFuZGxlclByb21pc2UgPSB1bmRlZmluZWRcbiAgICAgIGF3YWl0IHRoaXMuX2ZpbmlzaE1lc3NhZ2VIYW5kbGVyUmVzb2x1dGlvbih7dXNlSGFuZGxlcjogZmFsc2V9KVxuICAgICAgcmV0dXJuXG4gICAgfVxuXG4gICAgdGhpcy5tZXNzYWdlSGFuZGxlclByb21pc2UgPSB1bmRlZmluZWRcbiAgICBpZiAoIWhhbmRsZXIpIHtcbiAgICAgIGF3YWl0IHRoaXMuX2ZpbmlzaE1lc3NhZ2VIYW5kbGVyUmVzb2x1dGlvbih7dXNlSGFuZGxlcjogZmFsc2V9KVxuICAgICAgcmV0dXJuXG4gICAgfVxuXG4gICAgaWYgKHRoaXMuX2luYm91bmRDbG9zZWQpIHtcbiAgICAgIHRoaXMucGVuZGluZ01lc3NhZ2VIYW5kbGVyID0gZmFsc2VcbiAgICAgIHJldHVyblxuICAgIH1cblxuICAgIC8vIEluc3RhbGwgaGFuZGxlciBhbmQgZHJhaW4gb25PcGVuIGJlZm9yZSByZXBsYXlpbmcgcXVldWVkXG4gICAgLy8gbWVzc2FnZXMuIHNldE1lc3NhZ2VIYW5kbGVyKCkgZmlyZXMgb25PcGVuIGFzIGZpcmUtYW5kLWZvcmdldDtcbiAgICAvLyBhd2FpdGluZyBfcnVuTWVzc2FnZUhhbmRsZXJPcGVuKCkgZGlyZWN0bHkgaGVyZSBjbG9zZXMgdGhlXG4gICAgLy8gcmFjZSB3aGVyZSBxdWV1ZWQgc3Vic2NyaWJlL2Nvbm5lY3Rpb24tKiBmcmFtZXMgd291bGRcbiAgICAvLyBkaXNwYXRjaCB3aGlsZSBhbiBhc3luYyBvbk9wZW4gaXMgc3RpbGwgc2V0dGluZyB1cCBzZXNzaW9uXG4gICAgLy8gc3RhdGUuXG4gICAgdGhpcy5tZXNzYWdlSGFuZGxlciA9IGhhbmRsZXJcbiAgICBhd2FpdCB0aGlzLl9ydW5NZXNzYWdlSGFuZGxlck9wZW4oKVxuICAgIGF3YWl0IHRoaXMuX2ZpbmlzaE1lc3NhZ2VIYW5kbGVyUmVzb2x1dGlvbih7XG4gICAgICB1c2VIYW5kbGVyOiB0eXBlb2YgaGFuZGxlci5vbk1lc3NhZ2UgPT09IFwiZnVuY3Rpb25cIlxuICAgIH0pXG4gIH1cblxuICAvKipcbiAgICogSW5zZXJ0cyByZXNvbHZlciBjb21wbGV0aW9uIGludG8gdGhlIEZJRk8gY2hhaW4gYmVmb3JlIGFsbG93aW5nIG5ldyBkaXNwYXRjaC5cbiAgICogQHBhcmFtIHt7dXNlSGFuZGxlcjogYm9vbGVhbn19IGFyZ3MgLSBSZXNvbHZlciByZXN1bHQuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIGFmdGVyIHF1ZXVlZCBtZXNzYWdlcyBkcmFpbi5cbiAgICovXG4gIGFzeW5jIF9maW5pc2hNZXNzYWdlSGFuZGxlclJlc29sdXRpb24oe3VzZUhhbmRsZXJ9KSB7XG4gICAgY29uc3QgcHJldmlvdXMgPSB0aGlzLl9tZXNzYWdlQ2hhaW5cbiAgICBjb25zdCBkcmFpbiA9IHByZXZpb3VzLnRoZW4oYXN5bmMgKCkgPT4ge1xuICAgICAgdGhpcy5wZW5kaW5nTWVzc2FnZUhhbmRsZXIgPSBmYWxzZVxuICAgICAgaWYgKHRoaXMuX2luYm91bmRDbG9zZWQpIHtcbiAgICAgICAgdGhpcy5tZXNzYWdlUXVldWUgPSBbXVxuICAgICAgICByZXR1cm5cbiAgICAgIH1cblxuICAgICAgYXdhaXQgdGhpcy5fZmx1c2hRdWV1ZWRNZXNzYWdlcyh7dXNlSGFuZGxlcn0pXG4gICAgfSlcblxuICAgIHRoaXMuX21lc3NhZ2VDaGFpbiA9IGRyYWluLmNhdGNoKCgpID0+IHt9KVxuICAgIGF3YWl0IGRyYWluXG4gIH1cblxuICAvKipcbiAgICogUnVucyBmbHVzaCBxdWV1ZWQgbWVzc2FnZXMuXG4gICAqIEBwYXJhbSB7e3VzZUhhbmRsZXI6IGJvb2xlYW59fSBhcmdzIC0gQXJncy5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgd2hlbiBjb21wbGV0ZS5cbiAgICovXG4gIGFzeW5jIF9mbHVzaFF1ZXVlZE1lc3NhZ2VzKHt1c2VIYW5kbGVyfSkge1xuICAgIGlmICh0aGlzLm1lc3NhZ2VRdWV1ZS5sZW5ndGggPT09IDApIHJldHVyblxuXG4gICAgY29uc3QgcXVldWVkID0gdGhpcy5tZXNzYWdlUXVldWVcbiAgICB0aGlzLm1lc3NhZ2VRdWV1ZSA9IFtdXG5cbiAgICBmb3IgKGNvbnN0IHdvcmsgb2YgcXVldWVkKSB7XG4gICAgICBpZiAodGhpcy5faW5ib3VuZENsb3NlZCkge1xuICAgICAgICB0aGlzLl9yZWxlYXNlSW5ib3VuZEFkbWlzc2lvbih3b3JrLmFkbWlzc2lvbilcbiAgICAgICAgY29udGludWVcbiAgICAgIH1cblxuICAgICAgdHJ5IHtcbiAgICAgICAgaWYgKHVzZUhhbmRsZXIgJiYgdGhpcy5tZXNzYWdlSGFuZGxlcikge1xuICAgICAgICAgIGF3YWl0IHRoaXMuX3J1bldpdGhNZXNzYWdlTG9nQ29udGV4dCh3b3JrLm1lc3NhZ2UsIGFzeW5jICgpID0+IHtcbiAgICAgICAgICAgIGF3YWl0IHRoaXMuX3J1bk1lc3NhZ2VIYW5kbGVyTWVzc2FnZSh3b3JrLm1lc3NhZ2UpXG4gICAgICAgICAgfSlcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICBhd2FpdCB0aGlzLl9kaXNwYXRjaE1lc3NhZ2Uod29yay5tZXNzYWdlKVxuICAgICAgICB9XG4gICAgICB9IGNhdGNoIChjYXVnaHRFcnJvcikge1xuICAgICAgICBjb25zdCBjbGllbnRFcnJvck1lc3NhZ2UgPSBjYXVnaHRFcnJvciBpbnN0YW5jZW9mIEVycm9yID8gY2F1Z2h0RXJyb3IubWVzc2FnZSA6IFN0cmluZyhjYXVnaHRFcnJvcilcbiAgICAgICAgY29uc3QgZXJyb3IgPSB0aGlzLl9yZXBvcnRVbmV4cGVjdGVkRGlzcGF0Y2hFcnJvcihjYXVnaHRFcnJvciwge1xuICAgICAgICAgIHN0YWdlOiBcIndlYnNvY2tldC1tZXNzYWdlLWRpc3BhdGNoXCJcbiAgICAgICAgfSlcblxuICAgICAgICB0aGlzLmxvZ2dlci5lcnJvcigoKSA9PiBbXCJXZWJzb2NrZXQgbWVzc2FnZSBoYW5kbGVyIGZhaWxlZFwiLCBlcnJvcl0pXG4gICAgICAgIHRoaXMuc2VuZEpzb24oe1xuICAgICAgICAgIGVycm9yOiBjbGllbnRFcnJvck1lc3NhZ2UsXG4gICAgICAgICAgdHlwZTogXCJlcnJvclwiXG4gICAgICAgIH0pXG4gICAgICB9IGZpbmFsbHkge1xuICAgICAgICB0aGlzLl9yZWxlYXNlSW5ib3VuZEFkbWlzc2lvbih3b3JrLmFkbWlzc2lvbilcbiAgICAgIH1cbiAgICB9XG4gIH1cbn1cbiJdfQ==