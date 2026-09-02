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
            subscription.sendMessage(/** @type {import("../websocket-channel.js").WebsocketJsonValue} */ (event.payload));
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoid2Vic29ja2V0LXNlc3Npb24uanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi8uLi9zcmMvaHR0cC1zZXJ2ZXIvY2xpZW50L3dlYnNvY2tldC1zZXNzaW9uLmpzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiJBQUFBLFlBQVk7QUFFWixPQUFPLEVBQUUsVUFBVSxFQUFFLE1BQU0sYUFBYSxDQUFBO0FBQ3hDLE9BQU8sRUFBRSxXQUFXLEVBQUUsTUFBTSxTQUFTLENBQUE7QUFFckMsT0FBTyxFQUFFLGVBQWUsRUFBRSxNQUFNLGdDQUFnQyxDQUFBO0FBQ2hFLE9BQU8sTUFBTSxNQUFNLGlCQUFpQixDQUFBO0FBQ3BDLE9BQU8sWUFBWSxNQUFNLDhCQUE4QixDQUFBO0FBQ3ZELE9BQU8sYUFBYSxNQUFNLDZCQUE2QixDQUFBO0FBQ3ZELE9BQU8sY0FBYyxNQUFNLDBCQUEwQixDQUFBO0FBQ3JELE9BQU8sZ0JBQWdCLE1BQU0seUJBQXlCLENBQUE7QUFDdEQsT0FBTyxFQUFFLHNDQUFzQyxFQUFFLE1BQU0saUNBQWlDLENBQUE7QUFDeEYsT0FBTyxhQUFhLE1BQU0scUJBQXFCLENBQUE7QUFDL0MsT0FBTyxhQUFhLE1BQU0scUJBQXFCLENBQUE7QUFDL0MsT0FBTyxnQkFBZ0IsTUFBTSx3QkFBd0IsQ0FBQTtBQUVyRDs7O0dBR0c7QUFFSDs7Ozs7R0FLRztBQUVIOzs7O0dBSUc7QUFFSCxNQUFNLHFCQUFxQixHQUFHLElBQUksQ0FBQTtBQUNsQyxNQUFNLDZCQUE2QixHQUFHLEdBQUcsQ0FBQTtBQUN6QyxNQUFNLHFCQUFxQixHQUFHLEdBQUcsQ0FBQTtBQUNqQyxNQUFNLHVCQUF1QixHQUFHLEdBQUcsQ0FBQTtBQUNuQyxNQUFNLHNCQUFzQixHQUFHLEdBQUcsQ0FBQTtBQUNsQyxNQUFNLHFCQUFxQixHQUFHLEdBQUcsQ0FBQTtBQUNqQyxNQUFNLHFCQUFxQixHQUFHLEdBQUcsQ0FBQTtBQUVqQyxNQUFNLHNCQUFzQixHQUFHLElBQUksQ0FBQTtBQUNuQyxNQUFNLGdDQUFnQyxHQUFHLElBQUksQ0FBQTtBQUM3QyxNQUFNLHNDQUFzQyxHQUFHLGtDQUFrQyxDQUFBO0FBQ2pGLE1BQU0sZ0NBQWdDLEdBQUcsR0FBRyxDQUFBO0FBRTVDLHdFQUF3RTtBQUN4RSxNQUFNLDBCQUEwQixHQUFHLElBQUksQ0FBQTtBQUV2QyxtRUFBbUU7QUFDbkUsTUFBTSxzQ0FBc0MsR0FBRyxFQUFFLEdBQUcsSUFBSSxHQUFHLElBQUksQ0FBQTtBQUUvRCxtRUFBbUU7QUFDbkUsTUFBTSwrQkFBK0IsR0FBRyxzQ0FBc0MsQ0FBQTtBQUU5RSxNQUFNLHdDQUF3QyxHQUFHLE1BQU0sQ0FBQywrQkFBK0IsQ0FBQyxDQUFBO0FBRXhGLDZEQUE2RDtBQUM3RCxNQUFNLDBDQUEwQyxHQUFHLElBQUksQ0FBQTtBQUV2RDs7OztHQUlHO0FBQ0gsU0FBUyxnQkFBZ0IsQ0FBQyxPQUFPO0lBQy9CLE9BQU8sT0FBTyxDQUFDLElBQUksS0FBSyxXQUFXO1FBQ2pDLENBQUMsQ0FBQyxpSUFBaUksQ0FBQyxDQUFDLE9BQU8sQ0FBQztRQUM3SSxDQUFDLENBQUMsSUFBSSxDQUFBO0FBQ1YsQ0FBQztBQUVEOzs7O0dBSUc7QUFDSCxTQUFTLGNBQWMsQ0FBQyxPQUFPO0lBQzdCLElBQUksT0FBTyxDQUFDLElBQUksSUFBSSxPQUFPLENBQUMsSUFBSSxLQUFLLFNBQVM7UUFBRSxPQUFPLElBQUksQ0FBQTtJQUUzRCxPQUFPLDJMQUEyTCxDQUFDLENBQUMsT0FBTyxDQUFDLENBQUE7QUFDOU0sQ0FBQztBQUVEOzs7Ozs7OztHQVFHO0FBQ0gsU0FBUyxlQUFlLENBQUMsQ0FBQyxFQUFFLENBQUM7SUFDM0IsSUFBSSxDQUFDLEtBQUssQ0FBQztRQUFFLE9BQU8sSUFBSSxDQUFBO0lBQ3hCLElBQUksQ0FBQyxJQUFJLElBQUksSUFBSSxDQUFDLElBQUksSUFBSTtRQUFFLE9BQU8sS0FBSyxDQUFBO0lBQ3hDLElBQUksT0FBTyxDQUFDLEtBQUssUUFBUSxJQUFJLE9BQU8sQ0FBQyxLQUFLLFFBQVE7UUFBRSxPQUFPLEtBQUssQ0FBQTtJQUVoRSxJQUFJLENBQUM7UUFDSCxPQUFPLElBQUksQ0FBQyxTQUFTLENBQUMsQ0FBQyxDQUFDLEtBQUssSUFBSSxDQUFDLFNBQVMsQ0FBQyxDQUFDLENBQUMsQ0FBQTtJQUNoRCxDQUFDO0lBQUMsTUFBTSxDQUFDO1FBQ1AsT0FBTyxLQUFLLENBQUE7SUFDZCxDQUFDO0FBQ0gsQ0FBQztBQUVELE1BQU0sQ0FBQyxPQUFPLE9BQU8seUNBQXlDO0lBQzVELE1BQU0sR0FBRyxJQUFJLFlBQVksRUFBRSxDQUFBO0lBQzNCLGFBQWEsR0FBRyxJQUFJLEdBQUcsRUFBRSxDQUFBO0lBQ3pCLFFBQVEsR0FBRyxJQUFJLEdBQUcsRUFBRSxDQUFBO0lBQ3BCLG9CQUFvQixHQUFHLElBQUksR0FBRyxFQUFFLENBQUE7SUFDaEMsb0JBQW9CLEdBQUcsSUFBSSxHQUFHLEVBQUUsQ0FBQTtJQUNoQyxjQUFjLEdBQUcsSUFBSSxHQUFHLEVBQUUsQ0FBQTtJQUMxQixtQkFBbUIsR0FBRyxJQUFJLEdBQUcsRUFBRSxDQUFBO0lBQy9COztzQ0FFa0M7SUFDbEMsWUFBWSxHQUFHLEVBQUUsQ0FBQTtJQUVqQjs7Ozs7Ozs7T0FRRztJQUNILFlBQVksRUFBQyxNQUFNLEVBQUUsYUFBYSxFQUFFLGNBQWMsRUFBRSxjQUFjLEVBQUUscUJBQXFCLEVBQUM7UUFDeEYsdUJBQXVCO1FBQ3ZCLElBQUksQ0FBQyxhQUFhLEdBQUcsRUFBRSxDQUFBO1FBQ3ZCLElBQUksQ0FBQyxpQkFBaUIsR0FBRyxDQUFDLENBQUE7UUFDMUIsSUFBSSxDQUFDLGtCQUFrQixHQUFHLENBQUMsQ0FBQTtRQUMzQixJQUFJLENBQUMsY0FBYyxHQUFHLENBQUMsQ0FBQTtRQUN2QixJQUFJLENBQUMsdUJBQXVCLEdBQUcsQ0FBQyxDQUFBO1FBQ2hDLElBQUksQ0FBQyxNQUFNLEdBQUcsTUFBTSxDQUFBO1FBQ3BCLElBQUksQ0FBQyxhQUFhLEdBQUcsYUFBYSxDQUFBO1FBQ2xDLElBQUksQ0FBQyxjQUFjLEdBQUcsY0FBYyxDQUFBO1FBQ3BDLElBQUksQ0FBQyxjQUFjLEdBQUcsY0FBYyxDQUFBO1FBQ3BDLElBQUksQ0FBQyxxQkFBcUIsR0FBRyxxQkFBcUIsQ0FBQTtRQUNsRCxJQUFJLENBQUMscUJBQXFCLEdBQUcsT0FBTyxDQUFDLHFCQUFxQixDQUFDLENBQUE7UUFDM0QsSUFBSSxDQUFDLE1BQU0sR0FBRyxJQUFJLE1BQU0sQ0FBQyxJQUFJLENBQUMsQ0FBQTtRQUM5QixNQUFNLGtCQUFrQixHQUFHLElBQUksQ0FBQyxhQUFhLENBQUMsOEJBQThCLEVBQUUsQ0FBQTtRQUU5RSxJQUFJLENBQUMsdUJBQXVCLEdBQUcsa0JBQWtCLENBQUMsUUFBUSxDQUFBO1FBQzFELElBQUksQ0FBQywwQkFBMEIsR0FBRyxrQkFBa0IsQ0FBQyxXQUFXLENBQUE7UUFDaEUsSUFBSSxDQUFDLG9CQUFvQixHQUFHLENBQUMsQ0FBQTtRQUM3QixJQUFJLENBQUMsdUJBQXVCLEdBQUcsQ0FBQyxDQUFBO1FBQ2hDLElBQUksQ0FBQyw0QkFBNEIsR0FBRyxDQUFDLENBQUE7UUFDckMsSUFBSSxDQUFDLGNBQWMsR0FBRyxLQUFLLENBQUE7UUFDM0IsSUFBSSxDQUFDLHlCQUF5QixHQUFHLEtBQUssQ0FBQTtRQUV0Qzs7bUVBRTJEO1FBQzNELElBQUksQ0FBQyxTQUFTLEdBQUcsRUFBRSxDQUFBO1FBRW5COzs7OztXQUtHO1FBQ0gsSUFBSSxDQUFDLElBQUksR0FBRyxFQUFFLENBQUE7UUFFZDs7K0VBRXVFO1FBQ3ZFLElBQUksQ0FBQyxZQUFZLEdBQUcsSUFBSSxHQUFHLEVBQUUsQ0FBQTtRQUU3Qjs7aUhBRXlHO1FBQ3pHLElBQUksQ0FBQyxxQkFBcUIsR0FBRyxJQUFJLEdBQUcsRUFBRSxDQUFBO1FBRXRDOzs7Ozs7V0FNRztRQUNILElBQUksQ0FBQyxTQUFTLEdBQUcsVUFBVSxFQUFFLENBQUE7UUFFN0I7OztXQUdHO1FBQ0gsSUFBSSxDQUFDLE9BQU8sR0FBRyxLQUFLLENBQUE7UUFFcEI7OztXQUdHO1FBQ0gsSUFBSSxDQUFDLGNBQWMsR0FBRyxFQUFFLENBQUE7UUFFeEI7O3lEQUVpRDtRQUNqRCxJQUFJLENBQUMsTUFBTSxHQUFHLElBQUksQ0FBQTtRQUVsQjs7Ozs7OztXQU9HO1FBQ0gsSUFBSSxDQUFDLGFBQWEsR0FBRyxPQUFPLENBQUMsT0FBTyxFQUFFLENBQUE7UUFFdEM7Ozs7OztXQU1HO1FBQ0gsSUFBSSxDQUFDLHNCQUFzQixHQUFHLFNBQVMsQ0FBQTtRQUV2Qyw0QkFBNEI7UUFDNUIsSUFBSSxDQUFDLGlCQUFpQixHQUFHLElBQUksQ0FBQTtRQUU3Qjs7Ozs7V0FLRztRQUNILElBQUksQ0FBQyxtQkFBbUIsR0FBRyxJQUFJLENBQUE7UUFFL0I7Ozs7O1dBS0c7UUFDSCxJQUFJLENBQUMsaUJBQWlCLEdBQUcsSUFBSSxDQUFBO1FBRTdCOzs7OztXQUtHO1FBQ0gsSUFBSSxDQUFDLGdCQUFnQixHQUFHLENBQUMsQ0FBQTtRQUV6QixJQUFJLENBQUMsYUFBYSxDQUFDLGtCQUFrQixDQUFDLEdBQUcsQ0FBQyxJQUFJLENBQUMsQ0FBQTtRQUUvQzs7Ozs7O1dBTUc7UUFDSCxJQUFJLENBQUMsZUFBZSxHQUFHLElBQUksQ0FBQTtRQUUzQjs7Ozs7O1dBTUc7UUFDSCxJQUFJLENBQUMsZUFBZSxHQUFHLElBQUksQ0FBQTtJQUM3QixDQUFDO0lBRUQ7Ozs7T0FJRztJQUNILHNCQUFzQjtRQUNwQixJQUFJLENBQUMsZUFBZSxFQUFFLENBQUE7UUFDdEIsSUFBSSxDQUFDLFFBQVEsQ0FBQztZQUNaLElBQUksRUFBRSxxQkFBcUI7WUFDM0IsU0FBUyxFQUFFLElBQUksQ0FBQyxTQUFTO1lBQ3pCLFlBQVksRUFBRSxJQUFJLENBQUMsYUFBYSxDQUFDLCtCQUErQixFQUFFLEVBQUUsSUFBSSxHQUFHO1NBQzVFLENBQUMsQ0FBQTtRQUVGLGlFQUFpRTtRQUNqRSxJQUFJLENBQUMsZUFBZSxFQUFFLENBQUE7SUFDeEIsQ0FBQztJQUVEOzs7Ozs7T0FNRztJQUNILGlCQUFpQixDQUFDLFlBQVk7UUFDNUIsSUFBSSxDQUFDLFlBQVksQ0FBQyxNQUFNLENBQUMsWUFBWSxDQUFDLENBQUE7SUFDeEMsQ0FBQztJQUVEOzs7T0FHRztJQUNILFdBQVc7UUFDVCxPQUFPLEVBQUMsR0FBRyxJQUFJLENBQUMsU0FBUyxFQUFDLENBQUE7SUFDNUIsQ0FBQztJQUVEOzs7T0FHRztJQUNILFFBQVE7UUFDTixPQUFPLElBQUksQ0FBQyxPQUFPLENBQUE7SUFDckIsQ0FBQztJQUVEOzs7O09BSUc7SUFDSCxlQUFlLENBQUMsT0FBTztRQUNyQixJQUFJLENBQUMsYUFBYSxDQUFDLEdBQUcsQ0FBQyxPQUFPLENBQUMsQ0FBQTtJQUNqQyxDQUFDO0lBRUQsT0FBTztRQUNMLElBQUksQ0FBQyxpQkFBaUIsRUFBRSxDQUFBO1FBQ3hCLElBQUksQ0FBQyxjQUFjLEVBQUUsQ0FBQTtRQUNyQixJQUFJLENBQUMsb0JBQW9CLEVBQUUsQ0FBQTtRQUMzQixJQUFJLENBQUMseUJBQXlCLEVBQUUsQ0FBQTtRQUNoQyxJQUFJLENBQUMsdUJBQXVCLEVBQUUsQ0FBQTtRQUM5QixJQUFJLENBQUMsYUFBYSxDQUFDLGtCQUFrQixDQUFDLE1BQU0sQ0FBQyxJQUFJLENBQUMsQ0FBQTtRQUNsRCxJQUFJLENBQUMsT0FBTyxHQUFHLEtBQUssQ0FBQTtRQUNwQixLQUFLLElBQUksQ0FBQyxnQkFBZ0IsRUFBRSxDQUFBO1FBQzVCLEtBQUssSUFBSSxDQUFDLG9CQUFvQixDQUFDLG1CQUFtQixDQUFDLENBQUE7UUFDbkQsS0FBSyxJQUFJLENBQUMsNkJBQTZCLEVBQUUsQ0FBQTtRQUN6QyxJQUFJLENBQUMsTUFBTSxDQUFDLGtCQUFrQixFQUFFLENBQUE7SUFDbEMsQ0FBQztJQUVELDhEQUE4RDtJQUM5RCxlQUFlO1FBQ2IsSUFBSSxJQUFJLENBQUMsaUJBQWlCLEtBQUssSUFBSSxDQUFDLFNBQVM7WUFBRSxPQUFNO1FBQ3JELElBQUksSUFBSSxDQUFDLGlCQUFpQjtZQUFFLElBQUksQ0FBQyxpQkFBaUIsRUFBRSxDQUFBO1FBRXBELElBQUksQ0FBQyxpQkFBaUIsR0FBRyxJQUFJLENBQUMsU0FBUyxDQUFBO1FBQ3ZDLElBQUksQ0FBQyxNQUFNLENBQUMsSUFBSSxDQUFDLGtCQUFrQixFQUFFLEVBQUMsU0FBUyxFQUFFLElBQUksQ0FBQyxTQUFTLEVBQUMsQ0FBQyxDQUFBO0lBQ25FLENBQUM7SUFFRCw4REFBOEQ7SUFDOUQsaUJBQWlCO1FBQ2YsTUFBTSxTQUFTLEdBQUcsSUFBSSxDQUFDLGlCQUFpQixDQUFBO1FBRXhDLElBQUksQ0FBQyxTQUFTO1lBQUUsT0FBTTtRQUV0QixJQUFJLENBQUMsaUJBQWlCLEdBQUcsSUFBSSxDQUFBO1FBQzdCLElBQUksQ0FBQyxNQUFNLENBQUMsSUFBSSxDQUFDLG1CQUFtQixFQUFFLEVBQUMsU0FBUyxFQUFDLENBQUMsQ0FBQTtJQUNwRCxDQUFDO0lBRUQ7Ozs7T0FJRztJQUNILGVBQWUsQ0FBQyxPQUFPO1FBQ3JCLE9BQU8sSUFBSSxDQUFDLGFBQWEsQ0FBQyxHQUFHLENBQUMsT0FBTyxDQUFDLENBQUE7SUFDeEMsQ0FBQztJQUVEOzs7O09BSUc7SUFDSCxNQUFNLENBQUMsSUFBSTtRQUNULGdFQUFnRTtRQUNoRSxpRUFBaUU7UUFDakUsb0VBQW9FO1FBQ3BFLHFEQUFxRDtRQUNyRCxJQUFJLENBQUMsZUFBZSxHQUFHLElBQUksQ0FBQTtRQUMzQixJQUFJLElBQUksQ0FBQyxjQUFjLElBQUksSUFBSSxDQUFDLE1BQU0sS0FBSyxDQUFDO1lBQUUsT0FBTTtRQUVwRCxJQUFJLENBQUMsYUFBYSxDQUFDLElBQUksQ0FBQyxJQUFJLENBQUMsQ0FBQTtRQUM3QixJQUFJLENBQUMsY0FBYyxJQUFJLElBQUksQ0FBQyxNQUFNLENBQUE7UUFDbEMsSUFBSSxDQUFDLGNBQWMsRUFBRSxDQUFBO0lBQ3ZCLENBQUM7SUFFRDs7Ozs7O09BTUc7SUFDSCxLQUFLLENBQUMsU0FBUyxDQUFDLE9BQU8sRUFBRSxPQUFPLEVBQUUsT0FBTyxHQUFHLEVBQUU7UUFDNUMsTUFBTSxlQUFlLEdBQUcsSUFBSSxDQUFDLG9CQUFvQixDQUFDLEdBQUcsQ0FBQyxPQUFPLENBQUMsQ0FBQTtRQUM5RCxNQUFNLGtCQUFrQixHQUFHLE9BQU8sQ0FBQyxlQUFlLElBQUksZUFBZSxDQUFDLElBQUksR0FBRyxDQUFDLENBQUMsQ0FBQTtRQUMvRSxNQUFNLFdBQVcsR0FBRyxJQUFJLENBQUMsbUJBQW1CLENBQUMsR0FBRyxDQUFDLE9BQU8sQ0FBQyxDQUFBO1FBRXpELElBQUksV0FBVyxFQUFFLFNBQVMsSUFBSSxDQUFDLE9BQU8sQ0FBQyxRQUFRLEVBQUUsQ0FBQztZQUNoRCxXQUFXLENBQUMsUUFBUSxHQUFHLElBQUksQ0FBQTtZQUMzQixPQUFNO1FBQ1IsQ0FBQztRQUVELElBQUksQ0FBQyxJQUFJLENBQUMsZUFBZSxDQUFDLE9BQU8sQ0FBQyxJQUFJLENBQUMsa0JBQWtCO1lBQUUsT0FBTTtRQUVqRSxJQUFJLGtCQUFrQixFQUFFLENBQUM7WUFDdkIsTUFBTSxPQUFPLENBQUMsR0FBRyxDQUFDLEtBQUssQ0FBQyxJQUFJLENBQUMsZUFBZSxDQUFDLENBQUMsR0FBRyxDQUFDLEtBQUssRUFBRSxPQUFPLEVBQUUsRUFBRTtnQkFDbEUsTUFBTSxNQUFNLEdBQUcsSUFBSSxDQUFDLGNBQWMsQ0FBQyxHQUFHLENBQUMsT0FBTyxDQUFDLENBQUE7Z0JBRS9DLE1BQU0sSUFBSSxDQUFDLGFBQWEsQ0FBQyxhQUFhLENBQUMsTUFBTSxFQUFFLEtBQUssSUFBSSxFQUFFO29CQUN4RCxNQUFNLElBQUksQ0FBQyxnQkFBZ0IsQ0FBQyxLQUFLLElBQUksRUFBRTt3QkFDckMsTUFBTSxPQUFPLENBQUMsaUJBQWlCLENBQUM7NEJBQzlCLE9BQU87NEJBQ1AsU0FBUyxFQUFFLE9BQU8sQ0FBQyxTQUFTOzRCQUM1QixPQUFPLEVBQUUsT0FBTyxDQUFDLE9BQU87NEJBQ3hCLE9BQU87NEJBQ1AsUUFBUSxFQUFFLE9BQU8sQ0FBQyxRQUFROzRCQUMxQixRQUFRLEVBQUUsT0FBTyxDQUFDLFFBQVE7eUJBQzNCLENBQUMsQ0FBQTtvQkFDSixDQUFDLENBQUMsQ0FBQTtnQkFDSixDQUFDLENBQUMsQ0FBQTtZQUNKLENBQUMsQ0FBQyxDQUFDLENBQUE7WUFDSCxPQUFNO1FBQ1IsQ0FBQztRQUVELElBQUksQ0FBQyxRQUFRLENBQUM7WUFDWixPQUFPO1lBQ1AsU0FBUyxFQUFFLE9BQU8sQ0FBQyxTQUFTO1lBQzVCLE9BQU8sRUFBRSxPQUFPLENBQUMsT0FBTztZQUN4QixPQUFPO1lBQ1AsUUFBUSxFQUFFLE9BQU8sQ0FBQyxRQUFRO1lBQzFCLFFBQVEsRUFBRSxPQUFPLENBQUMsUUFBUTtZQUMxQixJQUFJLEVBQUUsT0FBTztTQUNkLENBQUMsQ0FBQTtJQUNKLENBQUM7SUFFRDs7O09BR0c7SUFDSCxLQUFLLENBQUMsaUJBQWlCO1FBQ3JCLElBQUksSUFBSSxDQUFDLHFCQUFxQixFQUFFLENBQUM7WUFDL0IsTUFBTSxJQUFJLENBQUMsNkJBQTZCLEVBQUUsQ0FBQTtZQUUxQyxJQUFJLElBQUksQ0FBQyxjQUFjO2dCQUFFLE9BQU07UUFDakMsQ0FBQztRQUVELElBQUksSUFBSSxDQUFDLGNBQWMsRUFBRSxDQUFDO1lBQ3hCLE1BQU0sSUFBSSxDQUFDLHNCQUFzQixFQUFFLENBQUE7WUFDbkMsT0FBTTtRQUNSLENBQUM7UUFFRCxNQUFNLFFBQVEsR0FBRyxJQUFJLENBQUMsYUFBYSxDQUFDLDJCQUEyQixFQUFFLEVBQUUsQ0FBQTtRQUVuRSxJQUFJLENBQUMsUUFBUTtZQUFFLE9BQU07UUFFckIsSUFBSSxDQUFDO1lBQ0gsTUFBTSxNQUFNLEdBQUcsTUFBTSxJQUFJLENBQUMsY0FBYyxDQUFDLEVBQUUsQ0FBQyxDQUFBO1lBQzVDLE1BQU0sUUFBUSxHQUFHLE1BQU0sSUFBSSxDQUFDLGFBQWEsQ0FBQyxhQUFhLENBQUMsTUFBTSxFQUFFLEtBQUssSUFBSSxFQUFFO2dCQUN6RSxPQUFPLE1BQU0sUUFBUSxDQUFDO29CQUNwQixNQUFNLEVBQUUsSUFBSSxDQUFDLE1BQU07b0JBQ25CLGFBQWEsRUFBRSxJQUFJLENBQUMsYUFBYTtvQkFDakMsT0FBTyxFQUFFLElBQUksQ0FBQyxjQUFjO29CQUM1QixnQkFBZ0IsRUFBRSxJQUFJO2lCQUN2QixDQUFDLENBQUE7WUFDSixDQUFDLENBQUMsQ0FBQTtZQUVGLElBQUksQ0FBQyxRQUFRO2dCQUFFLE9BQU07WUFFckIsTUFBTSxPQUFPLEdBQUcsT0FBTyxRQUFRLEtBQUssVUFBVTtnQkFDNUMsQ0FBQyxDQUFDLElBQUksUUFBUSxDQUFDLEVBQUMsTUFBTSxFQUFFLElBQUksQ0FBQyxNQUFNLEVBQUUsYUFBYSxFQUFFLElBQUksQ0FBQyxhQUFhLEVBQUUsT0FBTyxFQUFFLElBQUksQ0FBQyxjQUFjLEVBQUUsZ0JBQWdCLEVBQUUsSUFBSSxFQUFDLENBQUM7Z0JBQzlILENBQUMsQ0FBQyxRQUFRLENBQUE7WUFFWixJQUFJLE9BQU8sSUFBSSxDQUFDLENBQUMsT0FBTyxZQUFZLGdCQUFnQixDQUFDLEVBQUUsQ0FBQztnQkFDdEQsTUFBTSxJQUFJLEtBQUssQ0FBQyx5REFBeUQsQ0FBQyxDQUFBO1lBQzVFLENBQUM7WUFFRCxNQUFNLElBQUksQ0FBQyxnQkFBZ0IsQ0FBQyxPQUFPLEVBQUUsTUFBTSxDQUFDLENBQUE7UUFDOUMsQ0FBQztRQUFDLE9BQU8sV0FBVyxFQUFFLENBQUM7WUFDckIsTUFBTSxLQUFLLEdBQUcsSUFBSSxDQUFDLDhCQUE4QixDQUFDLFdBQVcsRUFBRTtnQkFDN0QsS0FBSyxFQUFFLDhCQUE4QjthQUN0QyxDQUFDLENBQUE7WUFFRixJQUFJLENBQUMsTUFBTSxDQUFDLEtBQUssQ0FBQyxHQUFHLEVBQUUsQ0FBQyxDQUFDLHdDQUF3QyxFQUFFLEtBQUssQ0FBQyxDQUFDLENBQUE7UUFDNUUsQ0FBQztJQUNILENBQUM7SUFFRDs7Ozs7T0FLRztJQUNILFdBQVcsQ0FBQyxNQUFNLEVBQUUsRUFBQyxJQUFJLEVBQUUsTUFBTSxHQUFHLEVBQUUsRUFBQyxHQUFHLEVBQUU7UUFDMUMsSUFBSSxPQUFPLENBQUE7UUFFWCxJQUFJLElBQUksS0FBSyxTQUFTLEVBQUUsQ0FBQztZQUN2QixPQUFPLEdBQUcsTUFBTSxDQUFDLEtBQUssQ0FBQyxDQUFDLENBQUMsQ0FBQTtRQUMzQixDQUFDO2FBQU0sQ0FBQztZQUNOLE1BQU0sV0FBVyxHQUFHLE1BQU0sQ0FBQyxJQUFJLENBQUMsTUFBTSxFQUFFLE9BQU8sQ0FBQyxDQUFBO1lBRWhELElBQUksV0FBVyxDQUFDLE1BQU0sR0FBRyxnQ0FBZ0MsRUFBRSxDQUFDO2dCQUMxRCxNQUFNLElBQUksVUFBVSxDQUFDLHdEQUF3RCxDQUFDLENBQUE7WUFDaEYsQ0FBQztZQUVELE9BQU8sR0FBRyxNQUFNLENBQUMsV0FBVyxDQUFDLENBQUMsR0FBRyxXQUFXLENBQUMsTUFBTSxDQUFDLENBQUE7WUFDcEQsT0FBTyxDQUFDLGFBQWEsQ0FBQyxJQUFJLEVBQUUsQ0FBQyxDQUFDLENBQUE7WUFDOUIsV0FBVyxDQUFDLElBQUksQ0FBQyxPQUFPLEVBQUUsQ0FBQyxDQUFDLENBQUE7UUFDOUIsQ0FBQztRQUVELE1BQU0sS0FBSyxHQUFHLE1BQU0sQ0FBQyxNQUFNLENBQUM7WUFDMUIsTUFBTSxDQUFDLElBQUksQ0FBQyxDQUFDLHFCQUFxQixHQUFHLHNCQUFzQixFQUFFLE9BQU8sQ0FBQyxNQUFNLENBQUMsQ0FBQztZQUM3RSxPQUFPO1NBQ1IsQ0FBQyxDQUFBO1FBRUYsTUFBTSxDQUFDLE1BQU0sQ0FBQyxJQUFJLENBQUMsUUFBUSxFQUFFLEtBQUssRUFBRSxFQUFDLGNBQWMsRUFBRSxJQUFJLEVBQUMsQ0FBQyxDQUFBO0lBQzdELENBQUM7SUFFRDs7OztPQUlHO0lBQ0gsb0JBQW9CLENBQUMsS0FBSztRQUN4QixJQUFJLEtBQUssWUFBWSxlQUFlO1lBQUUsT0FBTyxJQUFJLENBQUE7UUFDakQsSUFBSSxLQUFLLFlBQVksY0FBYyxJQUFJLEtBQUssQ0FBQyxZQUFZO1lBQUUsT0FBTyxJQUFJLENBQUE7UUFFdEUsTUFBTSxjQUFjLEdBQUcsc0dBQXNHLENBQUMsQ0FBQyxLQUFLLENBQUMsQ0FBQTtRQUVySSxJQUFJLGFBQWEsQ0FBQyxjQUFjLENBQUMsU0FBUyxDQUFDO1lBQUUsT0FBTyxJQUFJLENBQUE7UUFFeEQsT0FBTyxPQUFPLGNBQWMsQ0FBQyxTQUFTLEtBQUssUUFBUSxJQUFJLGNBQWMsQ0FBQyxTQUFTLENBQUMsTUFBTSxHQUFHLENBQUMsQ0FBQTtJQUM1RixDQUFDO0lBRUQ7Ozs7O09BS0c7SUFDSCw4QkFBOEIsQ0FBQyxXQUFXLEVBQUUsT0FBTztRQUNqRCxNQUFNLEtBQUssR0FBRyxXQUFXLENBQUMsV0FBVyxDQUFDLENBQUE7UUFDdEMsTUFBTSxRQUFRLEdBQUcsSUFBSSxDQUFDLGFBQWEsQ0FBQyxjQUFjLEVBQUUsQ0FBQTtRQUNwRCxNQUFNLGFBQWEsR0FBRyxJQUFJLENBQUMsYUFBYSxDQUFDLHVCQUF1QixFQUFFLENBQUE7UUFDbEUsSUFBSSxlQUFlLEdBQUcsYUFBYSxDQUFDLENBQUMsQ0FBQyxhQUFhLENBQUMscUJBQXFCLEVBQUUsQ0FBQyxDQUFDLENBQUMsSUFBSSxHQUFHLEVBQUUsQ0FBQTtRQUV2RixJQUFJLElBQUksQ0FBQyxjQUFjLEVBQUUsQ0FBQztZQUN4QixlQUFlLEdBQUcsUUFBUSxDQUFDLHNCQUFzQixDQUFDLElBQUksQ0FBQyxjQUFjLEVBQUUsZUFBZSxDQUFDLENBQUE7UUFDekYsQ0FBQztRQUVELE1BQU0sYUFBYSxHQUFHLFFBQVEsQ0FBQyxXQUFXLENBQUMsS0FBSyxFQUFFLGVBQWUsQ0FBQyxDQUFBO1FBQ2xFLE1BQU0sZUFBZSxHQUFHLDREQUE0RCxDQUFDLENBQ25GLFFBQVEsQ0FBQyxnQkFBZ0IsQ0FBQyxPQUFPLEVBQUUsZUFBZSxDQUFDLENBQ3BELENBQUE7UUFFRCxJQUFJLElBQUksQ0FBQyxvQkFBb0IsQ0FBQyxLQUFLLENBQUM7WUFBRSxPQUFPLGFBQWEsQ0FBQTtRQUUxRCxNQUFNLFlBQVksR0FBRztZQUNuQixPQUFPLEVBQUUsZUFBZTtZQUN4QixLQUFLLEVBQUUsYUFBYTtZQUNwQixPQUFPLEVBQUUsSUFBSSxDQUFDLGNBQWM7U0FDN0IsQ0FBQTtRQUNELE1BQU0sV0FBVyxHQUFHLElBQUksQ0FBQyxhQUFhLENBQUMsY0FBYyxFQUFFLENBQUE7UUFFdkQsV0FBVyxDQUFDLElBQUksQ0FBQyxpQkFBaUIsRUFBRSxZQUFZLENBQUMsQ0FBQTtRQUNqRCxXQUFXLENBQUMsSUFBSSxDQUFDLFdBQVcsRUFBRSxFQUFDLEdBQUcsWUFBWSxFQUFFLFNBQVMsRUFBRSxpQkFBaUIsRUFBQyxDQUFDLENBQUE7UUFFOUUsT0FBTyxhQUFhLENBQUE7SUFDdEIsQ0FBQztJQUVEOzs7O09BSUc7SUFDSCxLQUFLLENBQUMsY0FBYyxDQUFDLE9BQU87UUFDMUIsTUFBTSxTQUFTLEdBQUcsSUFBSSxDQUFDLG9CQUFvQixDQUFDLENBQUMsQ0FBQyxDQUFBO1FBRTlDLElBQUksQ0FBQyxTQUFTO1lBQUUsT0FBTTtRQUN0QixNQUFNLElBQUksQ0FBQyxrQkFBa0IsQ0FBQyxFQUFDLFNBQVMsRUFBRSxPQUFPLEVBQUMsQ0FBQyxDQUFBO0lBQ3JELENBQUM7SUFFRDs7OztPQUlHO0lBQ0gsS0FBSyxDQUFDLGtCQUFrQixDQUFDLElBQUk7UUFDM0IsZ0VBQWdFO1FBQ2hFLDZEQUE2RDtRQUM3RCxxREFBcUQ7UUFDckQsbURBQW1EO1FBQ25ELE1BQU0sUUFBUSxHQUFHLElBQUksQ0FBQyxhQUFhLENBQUE7UUFDbkMsTUFBTSxJQUFJLEdBQUcsUUFBUSxDQUFDLElBQUksQ0FBQyxHQUFHLEVBQUUsQ0FBQyxJQUFJLENBQUMsZUFBZSxDQUFDLElBQUksQ0FBQyxDQUFDLENBQUE7UUFFNUQsSUFBSSxDQUFDLGFBQWEsR0FBRyxJQUFJLENBQUMsS0FBSyxDQUFDLEdBQUcsRUFBRSxHQUFFLENBQUMsQ0FBQyxDQUFBO1FBQ3pDLE1BQU0sSUFBSSxDQUFBO0lBQ1osQ0FBQztJQUVEOzs7O09BSUc7SUFDSCxLQUFLLENBQUMsZUFBZSxDQUFDLElBQUk7UUFDeEIsSUFBSSxJQUFJLENBQUMsY0FBYyxFQUFFLENBQUM7WUFDeEIsSUFBSSxDQUFDLHdCQUF3QixDQUFDLElBQUksQ0FBQyxTQUFTLENBQUMsQ0FBQTtZQUM3QyxPQUFNO1FBQ1IsQ0FBQztRQUVELElBQUksSUFBSSxDQUFDLHFCQUFxQixFQUFFLENBQUM7WUFDL0IsSUFBSSxDQUFDLFlBQVksQ0FBQyxJQUFJLENBQUMsSUFBSSxDQUFDLENBQUE7WUFDNUIsT0FBTTtRQUNSLENBQUM7UUFFRCxJQUFJLENBQUM7WUFDSCxNQUFNLElBQUksQ0FBQyxnQkFBZ0IsQ0FBQyxJQUFJLENBQUMsT0FBTyxDQUFDLENBQUE7UUFDM0MsQ0FBQztnQkFBUyxDQUFDO1lBQ1QsSUFBSSxDQUFDLHdCQUF3QixDQUFDLElBQUksQ0FBQyxTQUFTLENBQUMsQ0FBQTtRQUMvQyxDQUFDO0lBQ0gsQ0FBQztJQUVEOzs7O09BSUc7SUFDSCxLQUFLLENBQUMsZ0JBQWdCLENBQUMsT0FBTztRQUM1QixNQUFNLElBQUksQ0FBQyx5QkFBeUIsQ0FBQyxPQUFPLEVBQUUsS0FBSyxJQUFJLEVBQUU7WUFDdkQsTUFBTSxPQUFPLEdBQUcsSUFBSSxDQUFDLGFBQWEsQ0FBQyx5QkFBeUIsRUFBRSxFQUFFLENBQUE7WUFFaEUsSUFBSSxPQUFPLEVBQUUsQ0FBQztnQkFDWixNQUFNLE9BQU8sQ0FBQyxJQUFJLEVBQUUsR0FBRyxFQUFFLENBQUMsSUFBSSxDQUFDLG1CQUFtQixDQUFDLE9BQU8sQ0FBQyxDQUFDLENBQUE7Z0JBQzVELE9BQU07WUFDUixDQUFDO1lBRUQsTUFBTSxJQUFJLENBQUMsbUJBQW1CLENBQUMsT0FBTyxDQUFDLENBQUE7UUFDekMsQ0FBQyxDQUFDLENBQUE7SUFDSixDQUFDO0lBRUQ7Ozs7O09BS0c7SUFDSCxLQUFLLENBQUMseUJBQXlCLENBQUMsT0FBTyxFQUFFLFFBQVE7UUFDL0MsTUFBTSxhQUFhLEdBQUcsSUFBSSxhQUFhLEVBQUUsQ0FBQTtRQUN6QyxNQUFNLFFBQVEsR0FBRyxJQUFJLENBQUMsYUFBYSxDQUFDLGNBQWMsRUFBRSxDQUFBO1FBQ3BELElBQUksZUFBZSxHQUFHLFFBQVEsQ0FBQyxlQUFlLENBQUMsT0FBTyxDQUFDLENBQUE7UUFFdkQsZUFBZSxHQUFHLFFBQVEsQ0FBQyxlQUFlLENBQUMsSUFBSSxDQUFDLFdBQVcsRUFBRSxFQUFFLGVBQWUsQ0FBQyxDQUFBO1FBRS9FLElBQUksSUFBSSxDQUFDLGNBQWMsRUFBRSxDQUFDO1lBQ3hCLGVBQWUsR0FBRyxRQUFRLENBQUMsc0JBQXNCLENBQUMsSUFBSSxDQUFDLGNBQWMsRUFBRSxlQUFlLENBQUMsQ0FBQTtRQUN6RixDQUFDO1FBRUQsYUFBYSxDQUFDLDBCQUEwQixDQUFDLGVBQWUsQ0FBQyxDQUFBO1FBRXpELE1BQU0sSUFBSSxDQUFDLGFBQWEsQ0FBQyxvQkFBb0IsQ0FBQyxhQUFhLEVBQUUsUUFBUSxDQUFDLENBQUE7SUFDeEUsQ0FBQztJQUVEOzs7Ozs7T0FNRztJQUNILEtBQUssQ0FBQyxtQkFBbUIsQ0FBQyxPQUFPO1FBQy9CLGtFQUFrRTtRQUNsRSxpRUFBaUU7UUFDakUsaUVBQWlFO1FBQ2pFLGlFQUFpRTtRQUNqRSx3REFBd0Q7UUFDeEQsSUFBSSxJQUFJLENBQUMsY0FBYyxJQUFJLE9BQU8sSUFBSSxDQUFDLGNBQWMsQ0FBQyxTQUFTLEtBQUssVUFBVSxFQUFFLENBQUM7WUFDL0UsTUFBTSxJQUFJLENBQUMseUJBQXlCLENBQUMsT0FBTyxDQUFDLENBQUE7WUFDN0MsT0FBTTtRQUNSLENBQUM7UUFFRCxNQUFNLGdCQUFnQixHQUFHLGdCQUFnQixDQUFDLE9BQU8sQ0FBQyxDQUFBO1FBRWxELElBQUksZ0JBQWdCLEVBQUUsQ0FBQztZQUNyQixNQUFNLEVBQUMsT0FBTyxFQUFFLFdBQVcsRUFBRSxNQUFNLEVBQUMsR0FBRyxnQkFBZ0IsQ0FBQTtZQUV2RCxJQUFJLENBQUMsT0FBTztnQkFBRSxNQUFNLGNBQWMsQ0FBQyxJQUFJLENBQUMsbUNBQW1DLENBQUMsQ0FBQTtZQUM1RSxNQUFNLFFBQVEsR0FBRyxJQUFJLENBQUMsYUFBYSxDQUFDLDJCQUEyQixFQUFFLEVBQUUsQ0FBQTtZQUVuRSxJQUFJLFFBQVEsRUFBRSxDQUFDO2dCQUNiLE1BQU0sSUFBSSxDQUFDLDBCQUEwQixDQUFDLEVBQUMsT0FBTyxFQUFFLFdBQVcsRUFBRSxNQUFNLEVBQUMsQ0FBQyxDQUFBO1lBQ3ZFLENBQUM7aUJBQU0sQ0FBQztnQkFDTixNQUFNLElBQUksQ0FBQyxrQkFBa0IsQ0FBQyxPQUFPLEVBQUUsRUFBQyxXQUFXLEVBQUUsSUFBSSxFQUFFLFdBQVcsRUFBRSxNQUFNLEVBQUMsQ0FBQyxDQUFBO1lBQ2xGLENBQUM7WUFFRCxPQUFNO1FBQ1IsQ0FBQztRQUVELElBQUksT0FBTyxDQUFDLElBQUksS0FBSyxVQUFVLEVBQUUsQ0FBQztZQUNoQyxNQUFNLGVBQWUsR0FBRyxxRUFBcUUsQ0FBQyxDQUFDLE9BQU8sQ0FBQyxDQUFBO1lBRXZHLElBQUksQ0FBQyxTQUFTLEdBQUcsZUFBZSxDQUFDLElBQUksSUFBSSxPQUFPLGVBQWUsQ0FBQyxJQUFJLEtBQUssUUFBUSxDQUFDLENBQUMsQ0FBQyxFQUFDLEdBQUcsZUFBZSxDQUFDLElBQUksRUFBQyxDQUFDLENBQUMsQ0FBQyxFQUFFLENBQUE7WUFFbEgsS0FBSyxNQUFNLEVBQUMsWUFBWSxFQUFDLElBQUksSUFBSSxDQUFDLHFCQUFxQixDQUFDLE1BQU0sRUFBRSxFQUFFLENBQUM7Z0JBQ2pFLElBQUksT0FBTyxZQUFZLENBQUMsaUJBQWlCLEtBQUssVUFBVSxFQUFFLENBQUM7b0JBQ3pELE1BQU0sSUFBSSxDQUFDLGdCQUFnQixDQUFDLEtBQUssSUFBSSxFQUFFO3dCQUNyQyxNQUFNLFlBQVksQ0FBQyxpQkFBaUIsQ0FBQyxJQUFJLENBQUMsU0FBUyxDQUFDLENBQUE7b0JBQ3RELENBQUMsQ0FBQyxDQUFBO2dCQUNKLENBQUM7WUFDSCxDQUFDO1lBRUQsT0FBTTtRQUNSLENBQUM7UUFFRCxJQUFJLE9BQU8sQ0FBQyxJQUFJLEtBQUssZ0JBQWdCLEVBQUUsQ0FBQztZQUN0QyxNQUFNLElBQUksQ0FBQyxvQkFBb0IsQ0FBQyxPQUFPLENBQUMsQ0FBQTtZQUN4QyxPQUFNO1FBQ1IsQ0FBQztRQUVELElBQUksT0FBTyxDQUFDLElBQUksS0FBSyxpQkFBaUIsRUFBRSxDQUFDO1lBQ3ZDLE1BQU0sSUFBSSxDQUFDLHFCQUFxQixDQUFDLE9BQU8sQ0FBQyxDQUFBO1lBQ3pDLE9BQU07UUFDUixDQUFDO1FBRUQsSUFBSSxPQUFPLENBQUMsSUFBSSxLQUFLLG9CQUFvQixFQUFFLENBQUM7WUFDMUMsTUFBTSxJQUFJLENBQUMsd0JBQXdCLENBQUMsT0FBTyxDQUFDLENBQUE7WUFDNUMsT0FBTTtRQUNSLENBQUM7UUFFRCxJQUFJLE9BQU8sQ0FBQyxJQUFJLEtBQUssa0JBQWtCLEVBQUUsQ0FBQztZQUN4QyxNQUFNLElBQUksQ0FBQyxzQkFBc0IsQ0FBQyxPQUFPLENBQUMsQ0FBQTtZQUMxQyxPQUFNO1FBQ1IsQ0FBQztRQUVELElBQUksT0FBTyxDQUFDLElBQUksS0FBSyxtQkFBbUIsRUFBRSxDQUFDO1lBQ3pDLE1BQU0sSUFBSSxDQUFDLHVCQUF1QixDQUFDLE9BQU8sQ0FBQyxDQUFBO1lBQzNDLE9BQU07UUFDUixDQUFDO1FBRUQsSUFBSSxPQUFPLENBQUMsSUFBSSxLQUFLLHFCQUFxQixFQUFFLENBQUM7WUFDM0MsTUFBTSxJQUFJLENBQUMseUJBQXlCLENBQUMsT0FBTyxDQUFDLENBQUE7WUFDN0MsT0FBTTtRQUNSLENBQUM7UUFFRCxJQUFJLE9BQU8sQ0FBQyxJQUFJLElBQUksT0FBTyxDQUFDLElBQUksS0FBSyxTQUFTLEVBQUUsQ0FBQztZQUMvQyxJQUFJLENBQUMsUUFBUSxDQUFDLEVBQUMsS0FBSyxFQUFFLHlCQUF5QixPQUFPLENBQUMsSUFBSSxFQUFFLEVBQUUsSUFBSSxFQUFFLE9BQU8sRUFBQyxDQUFDLENBQUE7WUFDOUUsT0FBTTtRQUNSLENBQUM7UUFFRCxNQUFNLGNBQWMsR0FBRyxjQUFjLENBQUMsT0FBTyxDQUFDLENBQUE7UUFFOUMsSUFBSSxDQUFDLGNBQWMsRUFBRSxDQUFDO1lBQ3BCLElBQUksQ0FBQyxRQUFRLENBQUMsRUFBQyxLQUFLLEVBQUUseUJBQXlCLE9BQU8sQ0FBQyxJQUFJLEVBQUUsRUFBRSxJQUFJLEVBQUUsT0FBTyxFQUFDLENBQUMsQ0FBQTtZQUM5RSxPQUFNO1FBQ1IsQ0FBQztRQUVELE1BQU0sRUFBQyxJQUFJLEVBQUUsT0FBTyxFQUFFLEVBQUUsRUFBRSxNQUFNLEVBQUUsSUFBSSxFQUFDLEdBQUcsY0FBYyxDQUFBO1FBRXhELElBQUksQ0FBQyxNQUFNO1lBQUUsTUFBTSxjQUFjLENBQUMsSUFBSSxDQUFDLG9CQUFvQixDQUFDLENBQUE7UUFDNUQsSUFBSSxDQUFDLElBQUk7WUFBRSxNQUFNLGNBQWMsQ0FBQyxJQUFJLENBQUMsa0JBQWtCLENBQUMsQ0FBQTtRQUV4RCxNQUFNLE9BQU8sR0FBRyxJQUFJLGdCQUFnQixDQUFDO1lBQ25DLElBQUk7WUFDSixPQUFPO1lBQ1AsUUFBUSxFQUFFLElBQUksQ0FBQyxXQUFXLEVBQUU7WUFDNUIsTUFBTTtZQUNOLElBQUk7WUFDSixhQUFhLEVBQUUsSUFBSSxDQUFDLGFBQWEsRUFBRTtTQUNwQyxDQUFDLENBQUE7UUFDRixNQUFNLGFBQWEsR0FBRyxJQUFJLGFBQWEsQ0FBQztZQUN0QyxhQUFhLEVBQUUsSUFBSSxDQUFDLGFBQWE7WUFDakMsT0FBTztTQUNSLENBQUMsQ0FBQTtRQUVGLGFBQWEsQ0FBQyxNQUFNLENBQUMsRUFBRSxDQUFDLE1BQU0sRUFBRSxHQUFHLEVBQUU7WUFDbkMsTUFBTSxRQUFRLEdBQUcsYUFBYSxDQUFDLFFBQVEsQ0FBQTtZQUN2QyxNQUFNLElBQUksR0FBRyxRQUFRLENBQUMsT0FBTyxFQUFFLENBQUE7WUFDL0IsTUFBTSxPQUFPLEdBQUcsUUFBUSxDQUFDLE9BQU8sQ0FBQTtZQUVoQyxJQUFJLENBQUMsUUFBUSxDQUFDO2dCQUNaLElBQUk7Z0JBQ0osT0FBTztnQkFDUCxFQUFFO2dCQUNGLFVBQVUsRUFBRSxRQUFRLENBQUMsYUFBYSxFQUFFO2dCQUNwQyxhQUFhLEVBQUUsUUFBUSxDQUFDLGdCQUFnQixFQUFFO2dCQUMxQyxJQUFJLEVBQUUsVUFBVTthQUNqQixDQUFDLENBQUE7WUFDRixLQUFLLGFBQWEsQ0FBQyxtQkFBbUIsRUFBRSxDQUFDLEtBQUssQ0FBQyxDQUFDLEtBQUssRUFBRSxFQUFFO2dCQUN2RCxJQUFJLENBQUMsTUFBTSxDQUFDLElBQUksQ0FBQyxpQ0FBaUMsRUFBRSxLQUFLLENBQUMsQ0FBQTtZQUM1RCxDQUFDLENBQUMsQ0FBQTtRQUNKLENBQUMsQ0FBQyxDQUFBO1FBRUYsTUFBTSxhQUFhLENBQUMsR0FBRyxFQUFFLENBQUE7SUFDM0IsQ0FBQztJQUVEOzs7T0FHRztJQUNILGNBQWM7UUFDWixPQUFPLElBQUksQ0FBQyxjQUFjLElBQUksQ0FBQyxFQUFFLENBQUM7WUFDaEMsTUFBTSxhQUFhLEdBQUcsSUFBSSxDQUFDLGtCQUFrQixDQUFDLENBQUMsQ0FBQyxDQUFBO1lBQ2hELE1BQU0sU0FBUyxHQUFHLGFBQWEsQ0FBQyxDQUFDLENBQUMsQ0FBQTtZQUNsQyxNQUFNLFVBQVUsR0FBRyxhQUFhLENBQUMsQ0FBQyxDQUFDLENBQUE7WUFDbkMsTUFBTSxPQUFPLEdBQUcsQ0FBQyxTQUFTLEdBQUcscUJBQXFCLENBQUMsS0FBSyxxQkFBcUIsQ0FBQTtZQUM3RSxNQUFNLE1BQU0sR0FBRyxTQUFTLEdBQUcsSUFBSSxDQUFBO1lBQy9CLE1BQU0sUUFBUSxHQUFHLENBQUMsVUFBVSxHQUFHLElBQUksQ0FBQyxLQUFLLElBQUksQ0FBQTtZQUM3QyxJQUFJLGFBQWEsR0FBRyxVQUFVLEdBQUcsSUFBSSxDQUFBO1lBQ3JDLElBQUksTUFBTSxHQUFHLENBQUMsQ0FBQTtZQUVkLElBQUksYUFBYSxLQUFLLEdBQUcsRUFBRSxDQUFDO2dCQUMxQixJQUFJLElBQUksQ0FBQyxjQUFjLEdBQUcsTUFBTSxHQUFHLENBQUM7b0JBQUUsT0FBTTtnQkFDNUMsYUFBYSxHQUFHLElBQUksQ0FBQyxrQkFBa0IsQ0FBQyxNQUFNLEdBQUcsQ0FBQyxDQUFDLENBQUMsWUFBWSxDQUFDLE1BQU0sQ0FBQyxDQUFBO2dCQUN4RSxNQUFNLElBQUksQ0FBQyxDQUFBO1lBQ2IsQ0FBQztpQkFBTSxJQUFJLGFBQWEsS0FBSyxHQUFHLEVBQUUsQ0FBQztnQkFDakMsSUFBSSxJQUFJLENBQUMsY0FBYyxHQUFHLE1BQU0sR0FBRyxDQUFDO29CQUFFLE9BQU07Z0JBQzVDLE1BQU0sU0FBUyxHQUFHLElBQUksQ0FBQyxrQkFBa0IsQ0FBQyxNQUFNLEdBQUcsQ0FBQyxDQUFDLENBQUMsZUFBZSxDQUFDLE1BQU0sQ0FBQyxDQUFBO2dCQUU3RSxJQUFJLFNBQVMsR0FBRyx3Q0FBd0MsRUFBRSxDQUFDO29CQUN6RCxJQUFJLENBQUMsTUFBTSxDQUFDLElBQUksQ0FBQyxHQUFHLEVBQUUsQ0FBQzt3QkFDckIsdURBQXVEO3dCQUN2RCxFQUFDLFVBQVUsRUFBRSxTQUFTLENBQUMsUUFBUSxFQUFFLEVBQUUsUUFBUSxFQUFFLCtCQUErQixFQUFDO3FCQUM5RSxDQUFDLENBQUE7b0JBQ0YsSUFBSSxDQUFDLHFCQUFxQixFQUFFLENBQUE7b0JBQzVCLE9BQU07Z0JBQ1IsQ0FBQztnQkFFRCxhQUFhLEdBQUcsTUFBTSxDQUFDLFNBQVMsQ0FBQyxDQUFBO2dCQUNqQyxNQUFNLElBQUksQ0FBQyxDQUFBO1lBQ2IsQ0FBQztZQUVELE1BQU0sVUFBVSxHQUFHLFFBQVEsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUE7WUFFbkMsTUFBTSxXQUFXLEdBQUcsTUFBTSxHQUFHLFVBQVUsR0FBRyxhQUFhLENBQUE7WUFFdkQsSUFBSSxJQUFJLENBQUMsY0FBYyxHQUFHLFdBQVc7Z0JBQUUsT0FBTTtZQUU3QyxNQUFNLEtBQUssR0FBRyxJQUFJLENBQUMscUJBQXFCLENBQUMsV0FBVyxDQUFDLENBQUE7WUFFckQscUJBQXFCO1lBQ3JCLElBQUksT0FBTyxHQUFHLEtBQUssQ0FBQyxRQUFRLENBQUMsTUFBTSxHQUFHLFVBQVUsRUFBRSxXQUFXLENBQUMsQ0FBQTtZQUU5RCxJQUFJLFFBQVEsRUFBRSxDQUFDO2dCQUNiLE1BQU0sSUFBSSxHQUFHLEtBQUssQ0FBQyxRQUFRLENBQUMsTUFBTSxFQUFFLE1BQU0sR0FBRyxVQUFVLENBQUMsQ0FBQTtnQkFDeEQsSUFBSSxDQUFDLGNBQWMsQ0FBQyxPQUFPLEVBQUUsSUFBSSxDQUFDLENBQUE7WUFDcEMsQ0FBQztZQUVELDREQUE0RDtZQUM1RCw2REFBNkQ7WUFDN0QsMkRBQTJEO1lBQzNELGVBQWU7WUFDZixJQUFJLE1BQU0sS0FBSyxxQkFBcUIsRUFBRSxDQUFDO2dCQUNyQyxJQUFJLENBQUMsaUJBQWlCLENBQUMscUJBQXFCLEVBQUUsT0FBTyxDQUFDLENBQUE7Z0JBQ3RELFNBQVE7WUFDVixDQUFDO1lBRUQsSUFBSSxNQUFNLEtBQUssc0JBQXNCLEVBQUUsQ0FBQztnQkFDdEMsTUFBTSxXQUFXLEdBQUcsT0FBTyxDQUFDLE1BQU0sR0FBRyxDQUFDLElBQUksT0FBTyxDQUFDLFlBQVksQ0FBQyxDQUFDLENBQUMsS0FBSyxzQkFBc0IsQ0FBQTtnQkFFNUYsSUFBSSxDQUFDLFdBQVcsQ0FBQyxJQUFJLENBQUMsTUFBTSxDQUFDLENBQUE7Z0JBQzdCLElBQUksQ0FBQyxZQUFZLENBQUMsRUFBQyxXQUFXLEVBQUMsQ0FBQyxDQUFBO2dCQUNoQyxTQUFRO1lBQ1YsQ0FBQztZQUVELElBQUksTUFBTSxLQUFLLHFCQUFxQixFQUFFLENBQUM7Z0JBQ3JDLDhEQUE4RDtnQkFDOUQsU0FBUTtZQUNWLENBQUM7WUFFRCxJQUFJLE1BQU0sSUFBSSxHQUFHLEVBQUUsQ0FBQztnQkFDbEIsSUFBSSxDQUFDLE1BQU0sQ0FBQyxJQUFJLENBQUMseUNBQXlDLE1BQU0sRUFBRSxDQUFDLENBQUE7Z0JBQ25FLFNBQVE7WUFDVixDQUFDO1lBRUQsOERBQThEO1lBQzlELDhEQUE4RDtZQUM5RCw0REFBNEQ7WUFDNUQsMERBQTBEO1lBQzFELHNEQUFzRDtZQUN0RCw4REFBOEQ7WUFDOUQsZUFBZTtZQUNmLElBQUksTUFBTSxLQUFLLDZCQUE2QixFQUFFLENBQUM7Z0JBQzdDLElBQUksSUFBSSxDQUFDLG1CQUFtQixLQUFLLElBQUksRUFBRSxDQUFDO29CQUN0QyxJQUFJLENBQUMsTUFBTSxDQUFDLElBQUksQ0FBQyxvRUFBb0UsQ0FBQyxDQUFBO29CQUN0RixTQUFRO2dCQUNWLENBQUM7Z0JBRUQsSUFBSSxDQUFDLElBQUksQ0FBQyxlQUFlLENBQUMsT0FBTyxDQUFDO29CQUFFLE9BQU07Z0JBRTFDLElBQUksQ0FBQyxPQUFPO29CQUFFLFNBQVE7WUFDeEIsQ0FBQztpQkFBTSxJQUFJLE1BQU0sS0FBSyxxQkFBcUIsSUFBSSxNQUFNLEtBQUssdUJBQXVCLEVBQUUsQ0FBQztnQkFDbEYsSUFBSSxJQUFJLENBQUMsbUJBQW1CLEtBQUssSUFBSSxFQUFFLENBQUM7b0JBQ3RDLElBQUksQ0FBQyxNQUFNLENBQUMsSUFBSSxDQUFDLGdHQUFnRyxDQUFDLENBQUE7b0JBQ2xILElBQUksQ0FBQyxvQkFBb0IsRUFBRSxDQUFBO2dCQUM3QixDQUFDO2dCQUVELElBQUksQ0FBQyxPQUFPLEVBQUUsQ0FBQztvQkFDYixJQUFJLENBQUMsbUJBQW1CLEdBQUcsQ0FBQyxPQUFPLENBQUMsQ0FBQTtvQkFDcEMsSUFBSSxDQUFDLGlCQUFpQixHQUFHLE1BQU0sQ0FBQTtvQkFDL0IsSUFBSSxDQUFDLGdCQUFnQixHQUFHLE9BQU8sQ0FBQyxNQUFNLENBQUE7b0JBRXRDLElBQUksQ0FBQyxJQUFJLENBQUMsc0JBQXNCLEVBQUU7d0JBQUUsT0FBTTtvQkFFMUMsU0FBUTtnQkFDVixDQUFDO1lBQ0gsQ0FBQztpQkFBTSxDQUFDO2dCQUNOLElBQUksQ0FBQyxNQUFNLENBQUMsSUFBSSxDQUFDLHNDQUFzQyxNQUFNLEVBQUUsQ0FBQyxDQUFBO2dCQUNoRSxTQUFRO1lBQ1YsQ0FBQztZQUVEOztnQ0FFb0I7WUFDcEIsSUFBSSxZQUFZLENBQUE7WUFDaEI7O2dDQUVvQjtZQUNwQixJQUFJLFdBQVcsQ0FBQTtZQUVmLElBQUksSUFBSSxDQUFDLG1CQUFtQixLQUFLLElBQUksRUFBRSxDQUFDO2dCQUN0QyxJQUFJLE1BQU0sS0FBSyw2QkFBNkIsRUFBRSxDQUFDO29CQUM3QyxZQUFZLEdBQUcsTUFBTSxDQUFDLE1BQU0sQ0FBQyxJQUFJLENBQUMsbUJBQW1CLENBQUMsQ0FBQTtvQkFDdEQsV0FBVyxHQUFHLElBQUksQ0FBQyxpQkFBaUIsSUFBSSxxQkFBcUIsQ0FBQTtnQkFDL0QsQ0FBQztxQkFBTSxDQUFDO29CQUNOLFlBQVksR0FBRyxPQUFPLENBQUE7b0JBQ3RCLFdBQVcsR0FBRyxNQUFNLENBQUE7Z0JBQ3RCLENBQUM7Z0JBQ0QsSUFBSSxDQUFDLG9CQUFvQixFQUFFLENBQUE7WUFDN0IsQ0FBQztpQkFBTSxDQUFDO2dCQUNOLFlBQVksR0FBRyxPQUFPLENBQUE7Z0JBQ3RCLFdBQVcsR0FBRyxNQUFNLENBQUE7WUFDdEIsQ0FBQztZQUVELElBQUksV0FBVyxLQUFLLHFCQUFxQixFQUFFLENBQUM7Z0JBQzFDLElBQUksQ0FBQyxNQUFNLENBQUMsSUFBSSxDQUFDLHVEQUF1RCxXQUFXLEVBQUUsQ0FBQyxDQUFBO2dCQUN0RixTQUFRO1lBQ1YsQ0FBQztZQUVELE1BQU0sU0FBUyxHQUFHLElBQUksQ0FBQyxvQkFBb0IsQ0FBQyxZQUFZLENBQUMsTUFBTSxDQUFDLENBQUE7WUFFaEUsSUFBSSxDQUFDLFNBQVM7Z0JBQUUsT0FBTTtZQUV0QixJQUFJLENBQUM7Z0JBQ0gsTUFBTSxPQUFPLEdBQUcsSUFBSSxDQUFDLEtBQUssQ0FBQyxZQUFZLENBQUMsUUFBUSxDQUFDLE9BQU8sQ0FBQyxDQUFDLENBQUE7Z0JBRTFELElBQUksQ0FBQyxrQkFBa0IsQ0FBQyxFQUFDLFNBQVMsRUFBRSxPQUFPLEVBQUMsQ0FBQyxDQUFDLEtBQUssQ0FBQyxDQUFDLFdBQVcsRUFBRSxFQUFFO29CQUNsRSxNQUFNLGtCQUFrQixHQUFHLFdBQVcsWUFBWSxLQUFLLENBQUMsQ0FBQyxDQUFDLFdBQVcsQ0FBQyxPQUFPLENBQUMsQ0FBQyxDQUFDLE1BQU0sQ0FBQyxXQUFXLENBQUMsQ0FBQTtvQkFDbkcsTUFBTSxLQUFLLEdBQUcsSUFBSSxDQUFDLDhCQUE4QixDQUFDLFdBQVcsRUFBRTt3QkFDN0QsS0FBSyxFQUFFLDRCQUE0QjtxQkFDcEMsQ0FBQyxDQUFBO29CQUVGLElBQUksQ0FBQyxNQUFNLENBQUMsS0FBSyxDQUFDLEdBQUcsRUFBRSxDQUFDLENBQUMsa0NBQWtDLEVBQUUsS0FBSyxDQUFDLENBQUMsQ0FBQTtvQkFDcEUsSUFBSSxDQUFDLFFBQVEsQ0FBQzt3QkFDWixLQUFLLEVBQUUsa0JBQWtCO3dCQUN6QixJQUFJLEVBQUUsT0FBTztxQkFDZCxDQUFDLENBQUE7Z0JBQ0osQ0FBQyxDQUFDLENBQUE7WUFDSixDQUFDO1lBQUMsT0FBTyxLQUFLLEVBQUUsQ0FBQztnQkFDZixJQUFJLENBQUMsd0JBQXdCLENBQUMsU0FBUyxDQUFDLENBQUE7Z0JBQ3hDLElBQUksQ0FBQyxNQUFNLENBQUMsS0FBSyxDQUFDLEdBQUcsRUFBRSxDQUFDLENBQUMsbUNBQW1DLEVBQUUsS0FBSyxDQUFDLENBQUMsQ0FBQTtnQkFDckUsSUFBSSxDQUFDLFFBQVEsQ0FBQyxFQUFDLEtBQUssRUFBRSwyQkFBMkIsRUFBRSxJQUFJLEVBQUUsT0FBTyxFQUFDLENBQUMsQ0FBQTtZQUNwRSxDQUFDO1FBQ0gsQ0FBQztJQUNILENBQUM7SUFFRDs7Ozs7T0FLRztJQUNILGtCQUFrQixDQUFDLFNBQVM7UUFDMUIsTUFBTSxNQUFNLEdBQUcsTUFBTSxDQUFDLFdBQVcsQ0FBQyxTQUFTLENBQUMsQ0FBQTtRQUM1QyxJQUFJLFdBQVcsR0FBRyxDQUFDLENBQUE7UUFDbkIsSUFBSSxXQUFXLEdBQUcsSUFBSSxDQUFDLGtCQUFrQixDQUFBO1FBRXpDLEtBQUssSUFBSSxVQUFVLEdBQUcsSUFBSSxDQUFDLGlCQUFpQixFQUFFLFVBQVUsR0FBRyxJQUFJLENBQUMsYUFBYSxDQUFDLE1BQU0sRUFBRSxVQUFVLElBQUksQ0FBQyxFQUFFLENBQUM7WUFDdEcsTUFBTSxLQUFLLEdBQUcsSUFBSSxDQUFDLGFBQWEsQ0FBQyxVQUFVLENBQUMsQ0FBQTtZQUM1QyxNQUFNLGNBQWMsR0FBRyxJQUFJLENBQUMsR0FBRyxDQUFDLEtBQUssQ0FBQyxNQUFNLEdBQUcsV0FBVyxFQUFFLFNBQVMsR0FBRyxXQUFXLENBQUMsQ0FBQTtZQUVwRixLQUFLLENBQUMsSUFBSSxDQUFDLE1BQU0sRUFBRSxXQUFXLEVBQUUsV0FBVyxFQUFFLFdBQVcsR0FBRyxjQUFjLENBQUMsQ0FBQTtZQUMxRSxXQUFXLElBQUksY0FBYyxDQUFBO1lBQzdCLFdBQVcsR0FBRyxDQUFDLENBQUE7WUFDZixJQUFJLFdBQVcsS0FBSyxTQUFTO2dCQUFFLE1BQUs7UUFDdEMsQ0FBQztRQUVELE9BQU8sTUFBTSxDQUFBO0lBQ2YsQ0FBQztJQUVEOzs7O09BSUc7SUFDSCxxQkFBcUIsQ0FBQyxTQUFTO1FBQzdCLE1BQU0sTUFBTSxHQUFHLE1BQU0sQ0FBQyxXQUFXLENBQUMsU0FBUyxDQUFDLENBQUE7UUFDNUMsSUFBSSxXQUFXLEdBQUcsQ0FBQyxDQUFBO1FBRW5CLE9BQU8sV0FBVyxHQUFHLFNBQVMsRUFBRSxDQUFDO1lBQy9CLE1BQU0sS0FBSyxHQUFHLElBQUksQ0FBQyxhQUFhLENBQUMsSUFBSSxDQUFDLGlCQUFpQixDQUFDLENBQUE7WUFDeEQsTUFBTSxjQUFjLEdBQUcsSUFBSSxDQUFDLEdBQUcsQ0FBQyxLQUFLLENBQUMsTUFBTSxHQUFHLElBQUksQ0FBQyxrQkFBa0IsRUFBRSxTQUFTLEdBQUcsV0FBVyxDQUFDLENBQUE7WUFFaEcsS0FBSyxDQUFDLElBQUksQ0FDUixNQUFNLEVBQ04sV0FBVyxFQUNYLElBQUksQ0FBQyxrQkFBa0IsRUFDdkIsSUFBSSxDQUFDLGtCQUFrQixHQUFHLGNBQWMsQ0FDekMsQ0FBQTtZQUNELFdBQVcsSUFBSSxjQUFjLENBQUE7WUFDN0IsSUFBSSxDQUFDLGtCQUFrQixJQUFJLGNBQWMsQ0FBQTtZQUV6QyxJQUFJLElBQUksQ0FBQyxrQkFBa0IsS0FBSyxLQUFLLENBQUMsTUFBTSxFQUFFLENBQUM7Z0JBQzdDLElBQUksQ0FBQyxpQkFBaUIsSUFBSSxDQUFDLENBQUE7Z0JBQzNCLElBQUksQ0FBQyxrQkFBa0IsR0FBRyxDQUFDLENBQUE7WUFDN0IsQ0FBQztRQUNILENBQUM7UUFFRCxJQUFJLElBQUksQ0FBQyxpQkFBaUIsS0FBSyxJQUFJLENBQUMsYUFBYSxDQUFDLE1BQU0sRUFBRSxDQUFDO1lBQ3pELElBQUksQ0FBQyxhQUFhLEdBQUcsRUFBRSxDQUFBO1lBQ3ZCLElBQUksQ0FBQyxpQkFBaUIsR0FBRyxDQUFDLENBQUE7UUFDNUIsQ0FBQzthQUFNLElBQ0wsSUFBSSxDQUFDLGlCQUFpQixJQUFJLEVBQUU7WUFDNUIsSUFBSSxDQUFDLGlCQUFpQixHQUFHLENBQUMsSUFBSSxJQUFJLENBQUMsYUFBYSxDQUFDLE1BQU0sRUFDdkQsQ0FBQztZQUNELElBQUksQ0FBQyxhQUFhLEdBQUcsSUFBSSxDQUFDLGFBQWEsQ0FBQyxLQUFLLENBQUMsSUFBSSxDQUFDLGlCQUFpQixDQUFDLENBQUE7WUFDckUsSUFBSSxDQUFDLGlCQUFpQixHQUFHLENBQUMsQ0FBQTtRQUM1QixDQUFDO1FBRUQsSUFBSSxDQUFDLGNBQWMsSUFBSSxTQUFTLENBQUE7UUFDaEMsSUFBSSxDQUFDLHVCQUF1QixJQUFJLFNBQVMsQ0FBQTtRQUV6QyxPQUFPLE1BQU0sQ0FBQTtJQUNmLENBQUM7SUFFRDs7O09BR0c7SUFDSCx5QkFBeUI7UUFDdkIsSUFBSSxDQUFDLGFBQWEsR0FBRyxFQUFFLENBQUE7UUFDdkIsSUFBSSxDQUFDLGlCQUFpQixHQUFHLENBQUMsQ0FBQTtRQUMxQixJQUFJLENBQUMsa0JBQWtCLEdBQUcsQ0FBQyxDQUFBO1FBQzNCLElBQUksQ0FBQyxjQUFjLEdBQUcsQ0FBQyxDQUFBO0lBQ3pCLENBQUM7SUFFRDs7OztPQUlHO0lBQ0gsb0JBQW9CLENBQUMsVUFBVTtRQUM3QixJQUFJLElBQUksQ0FBQyxjQUFjO1lBQUUsT0FBTyxJQUFJLENBQUE7UUFFcEMsSUFDRSxJQUFJLENBQUMsdUJBQXVCLEdBQUcsQ0FBQyxHQUFHLElBQUksQ0FBQywwQkFBMEI7WUFDbEUsSUFBSSxDQUFDLG9CQUFvQixHQUFHLFVBQVUsR0FBRyxJQUFJLENBQUMsdUJBQXVCLEVBQ3JFLENBQUM7WUFDRCxJQUFJLENBQUMsdUJBQXVCLENBQUMsVUFBVSxDQUFDLENBQUE7WUFDeEMsT0FBTyxJQUFJLENBQUE7UUFDYixDQUFDO1FBRUQsSUFBSSxDQUFDLHVCQUF1QixJQUFJLENBQUMsQ0FBQTtRQUNqQyxJQUFJLENBQUMsb0JBQW9CLElBQUksVUFBVSxDQUFBO1FBRXZDLE9BQU87WUFDTCxVQUFVO1lBQ1YsVUFBVSxFQUFFLElBQUksQ0FBQyw0QkFBNEI7WUFDN0MsUUFBUSxFQUFFLEtBQUs7U0FDaEIsQ0FBQTtJQUNILENBQUM7SUFFRDs7OztPQUlHO0lBQ0gsd0JBQXdCLENBQUMsU0FBUztRQUNoQyxJQUFJLFNBQVMsQ0FBQyxRQUFRO1lBQUUsT0FBTTtRQUU5QixTQUFTLENBQUMsUUFBUSxHQUFHLElBQUksQ0FBQTtRQUN6QixJQUFJLFNBQVMsQ0FBQyxVQUFVLEtBQUssSUFBSSxDQUFDLDRCQUE0QjtZQUFFLE9BQU07UUFFdEUsSUFBSSxDQUFDLHVCQUF1QixJQUFJLENBQUMsQ0FBQTtRQUNqQyxJQUFJLENBQUMsb0JBQW9CLElBQUksU0FBUyxDQUFDLFVBQVUsQ0FBQTtJQUNuRCxDQUFDO0lBRUQ7OztPQUdHO0lBQ0gsdUJBQXVCO1FBQ3JCLElBQUksQ0FBQyxjQUFjLEdBQUcsSUFBSSxDQUFBO1FBQzFCLElBQUksQ0FBQyw0QkFBNEIsSUFBSSxDQUFDLENBQUE7UUFDdEMsSUFBSSxDQUFDLG9CQUFvQixHQUFHLENBQUMsQ0FBQTtRQUM3QixJQUFJLENBQUMsdUJBQXVCLEdBQUcsQ0FBQyxDQUFBO1FBQ2hDLElBQUksQ0FBQyxZQUFZLEdBQUcsRUFBRSxDQUFBO0lBQ3hCLENBQUM7SUFFRDs7OztPQUlHO0lBQ0gsdUJBQXVCLENBQUMsYUFBYTtRQUNuQyxJQUFJLElBQUksQ0FBQyx5QkFBeUIsSUFBSSxJQUFJLENBQUMsY0FBYztZQUFFLE9BQU07UUFFakUsSUFBSSxDQUFDLHlCQUF5QixHQUFHLElBQUksQ0FBQTtRQUNyQyxJQUFJLENBQUMsTUFBTSxDQUFDLElBQUksQ0FBQyxHQUFHLEVBQUUsQ0FBQztZQUNyQixnRUFBZ0U7WUFDaEU7Z0JBQ0UsUUFBUSxFQUFFLElBQUksQ0FBQyx1QkFBdUI7Z0JBQ3RDLFdBQVcsRUFBRSxJQUFJLENBQUMsMEJBQTBCO2dCQUM1QyxZQUFZLEVBQUUsSUFBSSxDQUFDLG9CQUFvQjtnQkFDdkMsZUFBZSxFQUFFLElBQUksQ0FBQyx1QkFBdUI7Z0JBQzdDLGFBQWE7YUFDZDtTQUNGLENBQUMsQ0FBQTtRQUNGLElBQUksQ0FBQyxXQUFXLENBQUMsSUFBSSxDQUFDLE1BQU0sRUFBRTtZQUM1QixJQUFJLEVBQUUsZ0NBQWdDO1lBQ3RDLE1BQU0sRUFBRSxzQ0FBc0M7U0FDL0MsQ0FBQyxDQUFBO1FBQ0YsSUFBSSxDQUFDLFlBQVksQ0FBQyxFQUFDLFdBQVcsRUFBRSxLQUFLLEVBQUMsQ0FBQyxDQUFBO0lBQ3pDLENBQUM7SUFFRDs7O09BR0c7SUFDSCxxQkFBcUI7UUFDbkIsSUFBSSxDQUFDLG9CQUFvQixFQUFFLENBQUE7UUFDM0IsSUFBSSxDQUFDLHlCQUF5QixFQUFFLENBQUE7UUFDaEMsSUFBSSxDQUFDLFdBQVcsQ0FBQyxJQUFJLENBQUMsTUFBTSxDQUFDLENBQUE7UUFDN0IsSUFBSSxDQUFDLFlBQVksRUFBRSxDQUFBO0lBQ3JCLENBQUM7SUFFRDs7Ozs7OztPQU9HO0lBQ0gsZUFBZSxDQUFDLE9BQU87UUFDckIsaUVBQWlFO1FBQ2pFLDZEQUE2RDtRQUM3RCxzQkFBc0I7UUFDdEIsSUFBSSxDQUFDLG1CQUFtQixFQUFFLElBQUksQ0FBQyxPQUFPLENBQUMsQ0FBQTtRQUN2QyxJQUFJLENBQUMsZ0JBQWdCLElBQUksT0FBTyxDQUFDLE1BQU0sQ0FBQTtRQUV2QyxPQUFPLElBQUksQ0FBQyxzQkFBc0IsRUFBRSxDQUFBO0lBQ3RDLENBQUM7SUFFRDs7Ozs7OztPQU9HO0lBQ0gsc0JBQXNCO1FBQ3BCLElBQUksSUFBSSxDQUFDLG1CQUFtQixLQUFLLElBQUk7WUFBRSxPQUFPLElBQUksQ0FBQTtRQUVsRCxNQUFNLGFBQWEsR0FBRyxJQUFJLENBQUMsbUJBQW1CLENBQUMsTUFBTSxDQUFBO1FBQ3JELE1BQU0sU0FBUyxHQUFHLElBQUksQ0FBQyxnQkFBZ0IsR0FBRyxzQ0FBc0MsQ0FBQTtRQUNoRixNQUFNLGFBQWEsR0FBRyxhQUFhLEdBQUcsMENBQTBDLENBQUE7UUFFaEYsSUFBSSxDQUFDLFNBQVMsSUFBSSxDQUFDLGFBQWE7WUFBRSxPQUFPLElBQUksQ0FBQTtRQUU3QyxJQUFJLENBQUMsTUFBTSxDQUFDLElBQUksQ0FBQyxHQUFHLEVBQUUsQ0FBQztZQUNyQixnRUFBZ0U7WUFDaEU7Z0JBQ0UsYUFBYSxFQUFFLElBQUksQ0FBQyxnQkFBZ0I7Z0JBQ3BDLGFBQWE7Z0JBQ2IsUUFBUSxFQUFFLHNDQUFzQztnQkFDaEQsWUFBWSxFQUFFLDBDQUEwQzthQUN6RDtTQUNGLENBQUMsQ0FBQTtRQUVGLElBQUksQ0FBQyxxQkFBcUIsRUFBRSxDQUFBO1FBRTVCLE9BQU8sS0FBSyxDQUFBO0lBQ2QsQ0FBQztJQUVEOzt5QkFFcUI7SUFDckIsb0JBQW9CO1FBQ2xCLElBQUksQ0FBQyxtQkFBbUIsR0FBRyxJQUFJLENBQUE7UUFDL0IsSUFBSSxDQUFDLGlCQUFpQixHQUFHLElBQUksQ0FBQTtRQUM3QixJQUFJLENBQUMsZ0JBQWdCLEdBQUcsQ0FBQyxDQUFBO0lBQzNCLENBQUM7SUFFRDs7Ozs7OztPQU9HO0lBQ0gsZUFBZTtRQUNiLE1BQU0sZUFBZSxHQUFHLElBQUksQ0FBQyxhQUFhLENBQUMsbUNBQW1DLEVBQUUsQ0FBQTtRQUVoRixJQUFJLENBQUMsZUFBZSxJQUFJLGVBQWUsSUFBSSxDQUFDO1lBQUUsT0FBTTtRQUVwRCxJQUFJLENBQUMsZUFBZSxHQUFHLFdBQVcsQ0FBQyxHQUFHLEVBQUUsQ0FBQyxJQUFJLENBQUMsY0FBYyxFQUFFLEVBQUUsZUFBZSxHQUFHLElBQUksQ0FBQyxDQUFBO1FBRXZGLHdEQUF3RDtRQUN4RCxJQUFJLE9BQU8sSUFBSSxDQUFDLGVBQWUsQ0FBQyxLQUFLLEtBQUssVUFBVTtZQUFFLElBQUksQ0FBQyxlQUFlLENBQUMsS0FBSyxFQUFFLENBQUE7SUFDcEYsQ0FBQztJQUVEOzs7Ozs7O09BT0c7SUFDSCxjQUFjO1FBQ1osSUFBSSxJQUFJLENBQUMsT0FBTyxJQUFJLENBQUMsSUFBSSxDQUFDLE1BQU0sRUFBRSxNQUFNO1lBQUUsT0FBTTtRQUVoRCxJQUFJLENBQUMsSUFBSSxDQUFDLGVBQWUsRUFBRSxDQUFDO1lBQzFCLDZEQUE2RDtZQUM3RCwrREFBK0Q7WUFDL0QseURBQXlEO1lBQ3pELElBQUksQ0FBQyxjQUFjLEVBQUUsQ0FBQTtZQUNyQixJQUFJLENBQUMsWUFBWSxFQUFFLENBQUE7WUFDbkIsT0FBTTtRQUNSLENBQUM7UUFFRCxJQUFJLENBQUMsZUFBZSxHQUFHLEtBQUssQ0FBQTtRQUM1QixJQUFJLENBQUMsaUJBQWlCLENBQUMscUJBQXFCLEVBQUUsTUFBTSxDQUFDLEtBQUssQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFBO0lBQ2hFLENBQUM7SUFFRDs7O09BR0c7SUFDSCxjQUFjO1FBQ1osSUFBSSxJQUFJLENBQUMsZUFBZSxFQUFFLENBQUM7WUFDekIsYUFBYSxDQUFDLElBQUksQ0FBQyxlQUFlLENBQUMsQ0FBQTtZQUNuQyxJQUFJLENBQUMsZUFBZSxHQUFHLElBQUksQ0FBQTtRQUM3QixDQUFDO0lBQ0gsQ0FBQztJQUVEOzs7OztPQUtHO0lBQ0gsaUJBQWlCLENBQUMsTUFBTSxFQUFFLE9BQU87UUFDL0IsTUFBTSxNQUFNLEdBQUcsTUFBTSxDQUFDLEtBQUssQ0FBQyxDQUFDLENBQUMsQ0FBQTtRQUU5QixNQUFNLENBQUMsQ0FBQyxDQUFDLEdBQUcscUJBQXFCLEdBQUcsTUFBTSxDQUFBO1FBQzFDLE1BQU0sQ0FBQyxDQUFDLENBQUMsR0FBRyxPQUFPLENBQUMsTUFBTSxDQUFBO1FBRTFCLElBQUksQ0FBQyxNQUFNLENBQUMsTUFBTSxDQUFDLElBQUksQ0FBQyxRQUFRLEVBQUUsTUFBTSxDQUFDLE1BQU0sQ0FBQyxDQUFDLE1BQU0sRUFBRSxPQUFPLENBQUMsQ0FBQyxFQUFFLEVBQUMsY0FBYyxFQUFFLElBQUksRUFBQyxDQUFDLENBQUE7SUFDN0YsQ0FBQztJQUVEOzs7O09BSUc7SUFDSCxRQUFRLENBQUMsSUFBSTtRQUNYLDBEQUEwRDtRQUMxRCw4REFBOEQ7UUFDOUQsMERBQTBEO1FBQzFELElBQUksSUFBSSxDQUFDLE9BQU8sRUFBRSxDQUFDO1lBQ2pCLElBQUksQ0FBQyxjQUFjLEtBQUssRUFBRSxDQUFBO1lBRTFCLElBQUksSUFBSSxDQUFDLGNBQWMsQ0FBQyxNQUFNLElBQUksMEJBQTBCLEVBQUUsQ0FBQztnQkFDN0QsMERBQTBEO2dCQUMxRCxJQUFJLENBQUMsY0FBYyxDQUFDLEtBQUssRUFBRSxDQUFBO1lBQzdCLENBQUM7WUFFRCxJQUFJLENBQUMsY0FBYyxDQUFDLElBQUksQ0FBQyxJQUFJLENBQUMsQ0FBQTtZQUM5QixPQUFNO1FBQ1IsQ0FBQztRQUVELElBQUksQ0FBQyxJQUFJLENBQUMsTUFBTSxFQUFFLE1BQU07WUFBRSxPQUFNO1FBRWhDLE1BQU0sSUFBSSxHQUFHLElBQUksQ0FBQyxTQUFTLENBQUMsSUFBSSxDQUFDLENBQUE7UUFDakMsTUFBTSxPQUFPLEdBQUcsTUFBTSxDQUFDLElBQUksQ0FBQyxJQUFJLEVBQUUsT0FBTyxDQUFDLENBQUE7UUFDMUMsSUFBSSxNQUFNLENBQUE7UUFFVixJQUFJLE9BQU8sQ0FBQyxNQUFNLEdBQUcsR0FBRyxFQUFFLENBQUM7WUFDekIsTUFBTSxHQUFHLE1BQU0sQ0FBQyxLQUFLLENBQUMsQ0FBQyxDQUFDLENBQUE7WUFDeEIsTUFBTSxDQUFDLENBQUMsQ0FBQyxHQUFHLE9BQU8sQ0FBQyxNQUFNLENBQUE7UUFDNUIsQ0FBQzthQUFNLElBQUksT0FBTyxDQUFDLE1BQU0sR0FBRyxLQUFLLEVBQUUsQ0FBQztZQUNsQyxNQUFNLEdBQUcsTUFBTSxDQUFDLEtBQUssQ0FBQyxDQUFDLENBQUMsQ0FBQTtZQUN4QixNQUFNLENBQUMsQ0FBQyxDQUFDLEdBQUcsR0FBRyxDQUFBO1lBQ2YsTUFBTSxDQUFDLGFBQWEsQ0FBQyxPQUFPLENBQUMsTUFBTSxFQUFFLENBQUMsQ0FBQyxDQUFBO1FBQ3pDLENBQUM7YUFBTSxDQUFDO1lBQ04sTUFBTSxHQUFHLE1BQU0sQ0FBQyxLQUFLLENBQUMsRUFBRSxDQUFDLENBQUE7WUFDekIsTUFBTSxDQUFDLENBQUMsQ0FBQyxHQUFHLEdBQUcsQ0FBQTtZQUNmLE1BQU0sQ0FBQyxnQkFBZ0IsQ0FBQyxNQUFNLENBQUMsT0FBTyxDQUFDLE1BQU0sQ0FBQyxFQUFFLENBQUMsQ0FBQyxDQUFBO1FBQ3BELENBQUM7UUFFRCxNQUFNLENBQUMsQ0FBQyxDQUFDLEdBQUcscUJBQXFCLEdBQUcscUJBQXFCLENBQUE7UUFFekQsSUFBSSxDQUFDLE1BQU0sQ0FBQyxNQUFNLENBQUMsSUFBSSxDQUFDLFFBQVEsRUFBRSxNQUFNLENBQUMsTUFBTSxDQUFDLENBQUMsTUFBTSxFQUFFLE9BQU8sQ0FBQyxDQUFDLEVBQUUsRUFBQyxjQUFjLEVBQUUsSUFBSSxFQUFDLENBQUMsQ0FBQTtJQUM3RixDQUFDO0lBRUQ7Ozs7O09BS0c7SUFDSCxtQkFBbUI7UUFDakIsTUFBTSxLQUFLLEdBQUcsSUFBSSxDQUFDLGNBQWMsSUFBSSxFQUFFLENBQUE7UUFFdkMsSUFBSSxDQUFDLGNBQWMsR0FBRyxFQUFFLENBQUE7UUFFeEIsS0FBSyxNQUFNLElBQUksSUFBSSxLQUFLLEVBQUUsQ0FBQztZQUN6QixJQUFJLENBQUMsUUFBUSxDQUFDLElBQUksQ0FBQyxDQUFBO1FBQ3JCLENBQUM7SUFDSCxDQUFDO0lBRUQ7Ozs7O09BS0c7SUFDSCxLQUFLLENBQUMsa0JBQWtCLENBQUMsT0FBTyxFQUFFLEVBQUMsV0FBVyxHQUFHLElBQUksRUFBRSxjQUFjLEVBQUUsV0FBVyxFQUFFLE1BQU0sRUFBRSxtQkFBbUIsRUFBQyxHQUFHLEVBQUU7UUFDbkgsTUFBTSxzQ0FBc0MsQ0FBQyxJQUFJLENBQUMsYUFBYSxDQUFDLENBQUMscUJBQXFCLENBQUMsT0FBTyxDQUFDLENBQUE7UUFFL0YsTUFBTSxXQUFXLEdBQUcsTUFBTSxJQUFJLENBQUMsbUJBQW1CLENBQUM7WUFDakQsT0FBTztZQUNQLFdBQVc7WUFDWCxtQkFBbUIsRUFBRSxtQkFBbUIsSUFBSSxPQUFPO1lBQ25ELGtCQUFrQixFQUFFLE1BQU07U0FDM0IsQ0FBQyxDQUFBO1FBRUYsSUFBSSxXQUFXLEtBQUssS0FBSztZQUFFLE9BQU8sS0FBSyxDQUFBO1FBQ3ZDLElBQUksV0FBVyxFQUFFLENBQUM7WUFDaEIsSUFBSSxDQUFDLG1CQUFtQixDQUFDLEdBQUcsQ0FBQyxPQUFPLEVBQUUsV0FBVyxDQUFDLENBQUE7UUFDcEQsQ0FBQztRQUVELElBQUksQ0FBQyxlQUFlLENBQUMsT0FBTyxDQUFDLENBQUE7UUFFN0IsSUFBSSxjQUFjLEVBQUUsQ0FBQztZQUNuQixJQUFJLENBQUMsSUFBSSxDQUFDLG9CQUFvQixDQUFDLEdBQUcsQ0FBQyxPQUFPLENBQUMsRUFBRSxDQUFDO2dCQUM1QyxJQUFJLENBQUMsb0JBQW9CLENBQUMsR0FBRyxDQUFDLE9BQU8sRUFBRSxJQUFJLEdBQUcsRUFBRSxDQUFDLENBQUE7WUFDbkQsQ0FBQztZQUVELElBQUksQ0FBQyxvQkFBb0IsQ0FBQyxHQUFHLENBQUMsT0FBTyxDQUFDLEVBQUUsR0FBRyxDQUFDLGNBQWMsQ0FBQyxDQUFBO1lBRTNELElBQUksQ0FBQyxJQUFJLENBQUMsb0JBQW9CLENBQUMsR0FBRyxDQUFDLGNBQWMsQ0FBQyxFQUFFLENBQUM7Z0JBQ25ELElBQUksQ0FBQyxvQkFBb0IsQ0FBQyxHQUFHLENBQUMsY0FBYyxFQUFFLElBQUksR0FBRyxFQUFFLENBQUMsQ0FBQTtZQUMxRCxDQUFDO1lBRUQsSUFBSSxDQUFDLG9CQUFvQixDQUFDLEdBQUcsQ0FBQyxjQUFjLENBQUMsRUFBRSxHQUFHLENBQUMsT0FBTyxDQUFDLENBQUE7UUFDN0QsQ0FBQztRQUVELElBQUksV0FBVyxFQUFFLENBQUM7WUFDaEIsSUFBSSxDQUFDO2dCQUNILE1BQU0sSUFBSSxDQUFDLG9CQUFvQixDQUFDLEVBQUMsT0FBTyxFQUFFLFdBQVcsRUFBQyxDQUFDLENBQUE7WUFDekQsQ0FBQztvQkFBUyxDQUFDO2dCQUNULE1BQU0sSUFBSSxDQUFDLGtCQUFrQixDQUFDLE9BQU8sRUFBRSxXQUFXLENBQUMsQ0FBQTtZQUNyRCxDQUFDO1FBQ0gsQ0FBQztRQUVELElBQUksV0FBVyxFQUFFLENBQUM7WUFDaEIsSUFBSSxDQUFDLFFBQVEsQ0FBQyxFQUFDLE9BQU8sRUFBRSxJQUFJLEVBQUUsWUFBWSxFQUFDLENBQUMsQ0FBQTtRQUM5QyxDQUFDO1FBQ0QsT0FBTyxJQUFJLENBQUE7SUFDYixDQUFDO0lBRUQ7Ozs7T0FJRztJQUNILFlBQVksQ0FBQyxFQUFDLFdBQVcsR0FBRyxJQUFJLEVBQUMsR0FBRyxFQUFFO1FBQ3BDLElBQUksQ0FBQyxvQkFBb0IsRUFBRSxDQUFBO1FBQzNCLElBQUksQ0FBQyx5QkFBeUIsRUFBRSxDQUFBO1FBQ2hDLElBQUksQ0FBQyx1QkFBdUIsRUFBRSxDQUFBO1FBRTlCLHlEQUF5RDtRQUN6RCw0REFBNEQ7UUFDNUQsaUVBQWlFO1FBQ2pFLDhEQUE4RDtRQUM5RCxNQUFNLGlCQUFpQixHQUFHLElBQUksQ0FBQyxZQUFZLENBQUMsSUFBSSxHQUFHLENBQUMsSUFBSSxJQUFJLENBQUMscUJBQXFCLENBQUMsSUFBSSxHQUFHLENBQUMsQ0FBQTtRQUUzRixJQUFJLFdBQVcsSUFBSSxpQkFBaUIsSUFBSSxDQUFDLElBQUksQ0FBQyxPQUFPLEVBQUUsQ0FBQztZQUN0RCwrREFBK0Q7WUFDL0QsMENBQTBDO1lBQzFDLElBQUksQ0FBQyxjQUFjLEVBQUUsQ0FBQTtZQUNyQixJQUFJLENBQUMsT0FBTyxHQUFHLElBQUksQ0FBQTtZQUNuQixJQUFJLENBQUMsTUFBTSxHQUFHLElBQUksQ0FBQTtZQUNsQiwrREFBK0Q7WUFDL0Qsb0RBQW9EO1lBQ3BELGdFQUFnRTtZQUNoRSw4REFBOEQ7WUFDOUQsZUFBZTtZQUNmLElBQUksQ0FBQyxzQkFBc0IsR0FBRyxJQUFJLENBQUMsc0JBQXNCLEVBQUUsQ0FBQTtZQUMzRCxLQUFLLElBQUksQ0FBQyxpQkFBaUIsRUFBRSxDQUFBO1lBQzdCLElBQUksQ0FBQyxhQUFhLENBQUMsc0JBQXNCLENBQUMsSUFBSSxDQUFDLENBQUE7WUFDL0MsSUFBSSxDQUFDLE1BQU0sQ0FBQyxJQUFJLENBQUMsT0FBTyxDQUFDLENBQUE7WUFDekIsT0FBTTtRQUNSLENBQUM7UUFFRCxJQUFJLENBQUMsY0FBYyxFQUFFLENBQUE7UUFDckIsSUFBSSxDQUFDLGlCQUFpQixFQUFFLENBQUE7UUFDeEIsSUFBSSxDQUFDLGFBQWEsQ0FBQyxrQkFBa0IsQ0FBQyxNQUFNLENBQUMsSUFBSSxDQUFDLENBQUE7UUFDbEQsS0FBSyxJQUFJLENBQUMsdUJBQXVCLEVBQUUsQ0FBQTtRQUNuQyxLQUFLLElBQUksQ0FBQyxnQkFBZ0IsRUFBRSxDQUFBO1FBQzVCLEtBQUssSUFBSSxDQUFDLG9CQUFvQixDQUFDLG1CQUFtQixDQUFDLENBQUE7UUFDbkQsS0FBSyxJQUFJLENBQUMsNkJBQTZCLEVBQUUsQ0FBQTtRQUN6QyxJQUFJLENBQUMsTUFBTSxDQUFDLElBQUksQ0FBQyxPQUFPLENBQUMsQ0FBQTtJQUMzQixDQUFDO0lBRUQ7Ozs7O09BS0c7SUFDSCxvQkFBb0I7UUFDbEIsSUFBSSxDQUFDLGNBQWMsRUFBRSxDQUFBO1FBQ3JCLElBQUksQ0FBQyxpQkFBaUIsRUFBRSxDQUFBO1FBQ3hCLElBQUksQ0FBQyxvQkFBb0IsRUFBRSxDQUFBO1FBQzNCLElBQUksQ0FBQyx5QkFBeUIsRUFBRSxDQUFBO1FBQ2hDLElBQUksQ0FBQyx1QkFBdUIsRUFBRSxDQUFBO1FBQzlCLElBQUksQ0FBQyxhQUFhLENBQUMsa0JBQWtCLENBQUMsTUFBTSxDQUFDLElBQUksQ0FBQyxDQUFBO1FBQ2xELEtBQUssSUFBSSxDQUFDLHVCQUF1QixFQUFFLENBQUE7UUFDbkMsS0FBSyxJQUFJLENBQUMsZ0JBQWdCLEVBQUUsQ0FBQTtRQUM1QixLQUFLLElBQUksQ0FBQyxvQkFBb0IsQ0FBQyxlQUFlLENBQUMsQ0FBQTtRQUMvQyxLQUFLLElBQUksQ0FBQyw2QkFBNkIsRUFBRSxDQUFBO1FBQ3pDLElBQUksQ0FBQyxNQUFNLENBQUMsSUFBSSxDQUFDLE9BQU8sQ0FBQyxDQUFBO0lBQzNCLENBQUM7SUFFRDs7Ozs7O09BTUc7SUFDSCxLQUFLLENBQUMsc0JBQXNCO1FBQzFCLE1BQU0sUUFBUSxHQUFHLElBQUksQ0FBQyxhQUFhLENBQUMsbUNBQW1DLEVBQUUsRUFBRSxDQUFBO1FBRTNFLElBQUksT0FBTyxRQUFRLEtBQUssVUFBVTtZQUFFLE9BQU8sU0FBUyxDQUFBO1FBRXBELElBQUksQ0FBQztZQUNILE9BQU8sTUFBTSxRQUFRLENBQUMsSUFBSSxDQUFDLENBQUE7UUFDN0IsQ0FBQztRQUFDLE9BQU8sV0FBVyxFQUFFLENBQUM7WUFDckIsTUFBTSxLQUFLLEdBQUcsSUFBSSxDQUFDLDhCQUE4QixDQUFDLFdBQVcsRUFBRTtnQkFDN0QsS0FBSyxFQUFFLGtDQUFrQzthQUMxQyxDQUFDLENBQUE7WUFFRixJQUFJLENBQUMsTUFBTSxDQUFDLEtBQUssQ0FBQyxHQUFHLEVBQUUsQ0FBQyxDQUFDLHFEQUFxRCxFQUFFLEtBQUssQ0FBQyxDQUFDLENBQUE7WUFDdkYsT0FBTyxTQUFTLENBQUE7UUFDbEIsQ0FBQztJQUNILENBQUM7SUFFRDs7Ozs7O09BTUc7SUFDSCxLQUFLLENBQUMsaUJBQWlCO1FBQ3JCLE1BQU0sSUFBSSxDQUFDLHNCQUFzQixDQUFDLGNBQWMsQ0FBQyxDQUFBO0lBQ25ELENBQUM7SUFFRDs7OztPQUlHO0lBQ0gsS0FBSyxDQUFDLGFBQWE7UUFDakIsTUFBTSxJQUFJLENBQUMsc0JBQXNCLENBQUMsVUFBVSxDQUFDLENBQUE7SUFDL0MsQ0FBQztJQUVEOzs7O09BSUc7SUFDSCxLQUFLLENBQUMsc0JBQXNCLENBQUMsWUFBWTtRQUN2QyxLQUFLLE1BQU0sVUFBVSxJQUFJLElBQUksQ0FBQyxZQUFZLENBQUMsTUFBTSxFQUFFLEVBQUUsQ0FBQztZQUNwRCxJQUFJLENBQUM7Z0JBQ0gsTUFBTSxVQUFVLENBQUMsWUFBWSxDQUFDLEVBQUUsRUFBRSxDQUFBO1lBQ3BDLENBQUM7WUFBQyxPQUFPLFdBQVcsRUFBRSxDQUFDO2dCQUNyQixNQUFNLEtBQUssR0FBRyxJQUFJLENBQUMsOEJBQThCLENBQUMsV0FBVyxFQUFFO29CQUM3RCxZQUFZO29CQUNaLFlBQVksRUFBRSxVQUFVLENBQUMsWUFBWTtvQkFDckMsS0FBSyxFQUFFLGdDQUFnQztpQkFDeEMsQ0FBQyxDQUFBO2dCQUVGLElBQUksQ0FBQyxNQUFNLENBQUMsS0FBSyxDQUFDLEdBQUcsRUFBRSxDQUFDLENBQUMsR0FBRyxZQUFZLGVBQWUsVUFBVSxDQUFDLFlBQVksRUFBRSxFQUFFLEtBQUssQ0FBQyxDQUFDLENBQUE7WUFDM0YsQ0FBQztRQUNILENBQUM7UUFFRCxLQUFLLE1BQU0sRUFBQyxZQUFZLEVBQUMsSUFBSSxJQUFJLENBQUMscUJBQXFCLENBQUMsTUFBTSxFQUFFLEVBQUUsQ0FBQztZQUNqRSxJQUFJLENBQUM7Z0JBQ0gsTUFBTSxZQUFZLENBQUMsWUFBWSxDQUFDLEVBQUUsRUFBRSxDQUFBO1lBQ3RDLENBQUM7WUFBQyxPQUFPLFdBQVcsRUFBRSxDQUFDO2dCQUNyQixNQUFNLEtBQUssR0FBRyxJQUFJLENBQUMsOEJBQThCLENBQUMsV0FBVyxFQUFFO29CQUM3RCxZQUFZO29CQUNaLEtBQUssRUFBRSw2QkFBNkI7b0JBQ3BDLGNBQWMsRUFBRSxZQUFZLENBQUMsY0FBYztpQkFDNUMsQ0FBQyxDQUFBO2dCQUVGLElBQUksQ0FBQyxNQUFNLENBQUMsS0FBSyxDQUFDLEdBQUcsRUFBRSxDQUFDLENBQUMsR0FBRyxZQUFZLDJCQUEyQixZQUFZLENBQUMsY0FBYyxFQUFFLEVBQUUsS0FBSyxDQUFDLENBQUMsQ0FBQTtZQUMzRyxDQUFDO1FBQ0gsQ0FBQztJQUNILENBQUM7SUFFRDs7Ozs7OztPQU9HO0lBQ0gsS0FBSyxDQUFDLG9CQUFvQixDQUFDLE9BQU87UUFDaEMsTUFBTSxlQUFlLEdBQUcsT0FBTyxDQUFDLFNBQVMsQ0FBQTtRQUV6QyxJQUFJLE9BQU8sZUFBZSxLQUFLLFFBQVEsSUFBSSxDQUFDLGVBQWUsRUFBRSxDQUFDO1lBQzVELElBQUksQ0FBQyxRQUFRLENBQUMsRUFBQyxJQUFJLEVBQUUsY0FBYyxFQUFDLENBQUMsQ0FBQTtZQUNyQyxPQUFNO1FBQ1IsQ0FBQztRQUVELE1BQU0sTUFBTSxHQUFHLElBQUksQ0FBQyxhQUFhLENBQUMsMkJBQTJCLENBQUMsZUFBZSxDQUFDLENBQUE7UUFFOUUsSUFBSSxDQUFDLE1BQU0sRUFBRSxDQUFDO1lBQ1osSUFBSSxDQUFDLFFBQVEsQ0FBQyxFQUFDLElBQUksRUFBRSxjQUFjLEVBQUMsQ0FBQyxDQUFBO1lBQ3JDLE9BQU07UUFDUixDQUFDO1FBRUQsa0VBQWtFO1FBQ2xFLCtEQUErRDtRQUMvRCw0REFBNEQ7UUFDNUQsZ0RBQWdEO1FBQ2hELE1BQU0sUUFBUSxHQUFHLElBQUksQ0FBQyxhQUFhLENBQUMsbUNBQW1DLEVBQUUsRUFBRSxDQUFBO1FBRTNFLElBQUksT0FBTyxRQUFRLEtBQUssVUFBVSxFQUFFLENBQUM7WUFDbkMsTUFBTSxjQUFjLEdBQUcsTUFBTSxNQUFNLENBQUMsc0JBQXNCLENBQUE7WUFDMUQsSUFBSSxhQUFhLENBQUE7WUFFakIsSUFBSSxDQUFDO2dCQUNILGFBQWEsR0FBRyxNQUFNLFFBQVEsQ0FBQyxJQUFJLENBQUMsQ0FBQTtZQUN0QyxDQUFDO1lBQUMsT0FBTyxXQUFXLEVBQUUsQ0FBQztnQkFDckIsTUFBTSxLQUFLLEdBQUcsSUFBSSxDQUFDLDhCQUE4QixDQUFDLFdBQVcsRUFBRTtvQkFDN0QsS0FBSyxFQUFFLG1DQUFtQztpQkFDM0MsQ0FBQyxDQUFBO2dCQUVGLElBQUksQ0FBQyxNQUFNLENBQUMsS0FBSyxDQUFDLEdBQUcsRUFBRSxDQUFDLENBQUMsc0RBQXNELEVBQUUsS0FBSyxDQUFDLENBQUMsQ0FBQTtnQkFDeEYsYUFBYSxHQUFHLFNBQVMsQ0FBQTtZQUMzQixDQUFDO1lBRUQsSUFBSSxDQUFDLGVBQWUsQ0FBQyxjQUFjLEVBQUUsYUFBYSxDQUFDLEVBQUUsQ0FBQztnQkFDcEQsSUFBSSxDQUFDLGFBQWEsQ0FBQyw0QkFBNEIsQ0FBQyxlQUFlLENBQUMsQ0FBQTtnQkFDaEUsTUFBTSxDQUFDLG9CQUFvQixFQUFFLENBQUE7Z0JBQzdCLElBQUksQ0FBQyxRQUFRLENBQUMsRUFBQyxJQUFJLEVBQUUsY0FBYyxFQUFDLENBQUMsQ0FBQTtnQkFDckMsT0FBTTtZQUNSLENBQUM7UUFDSCxDQUFDO1FBRUQsSUFBSSxDQUFDLGFBQWEsQ0FBQyw0QkFBNEIsQ0FBQyxlQUFlLENBQUMsQ0FBQTtRQUVoRSxJQUFJLENBQUMsaUJBQWlCLEVBQUUsQ0FBQTtRQUN4QixNQUFNLENBQUMsaUJBQWlCLEVBQUUsQ0FBQTtRQUUxQixnRUFBZ0U7UUFDaEUsaURBQWlEO1FBQ2pELEtBQUssTUFBTSxDQUFDLFlBQVksRUFBRSxVQUFVLENBQUMsSUFBSSxNQUFNLENBQUMsWUFBWSxFQUFFLENBQUM7WUFDN0QsVUFBVSxDQUFDLE9BQU8sR0FBRyxJQUFJLENBQUE7WUFDekIsSUFBSSxDQUFDLFlBQVksQ0FBQyxHQUFHLENBQUMsWUFBWSxFQUFFLFVBQVUsQ0FBQyxDQUFBO1FBQ2pELENBQUM7UUFFRCxLQUFLLE1BQU0sQ0FBQyxLQUFLLEVBQUUsS0FBSyxDQUFDLElBQUksTUFBTSxDQUFDLHFCQUFxQixFQUFFLENBQUM7WUFDMUQsS0FBSyxDQUFDLFlBQVksQ0FBQyxPQUFPLEdBQUcsSUFBSSxDQUFBO1lBQ2pDLElBQUksQ0FBQyxxQkFBcUIsQ0FBQyxHQUFHLENBQUMsS0FBSyxFQUFFLEtBQUssQ0FBQyxDQUFBO1FBQzlDLENBQUM7UUFFRCxJQUFJLENBQUMsU0FBUyxHQUFHLEVBQUMsR0FBRyxNQUFNLENBQUMsU0FBUyxFQUFDLENBQUE7UUFDdEMsSUFBSSxDQUFDLElBQUksR0FBRyxNQUFNLENBQUMsSUFBSSxDQUFBO1FBQ3ZCLElBQUksQ0FBQyxTQUFTLEdBQUcsZUFBZSxDQUFBO1FBRWhDLDZEQUE2RDtRQUM3RCwrREFBK0Q7UUFDL0QsZ0NBQWdDO1FBQ2hDLE1BQU0sTUFBTSxHQUFHLE1BQU0sQ0FBQyxjQUFjLElBQUksRUFBRSxDQUFBO1FBRTFDLE1BQU0sQ0FBQyxjQUFjLEdBQUcsRUFBRSxDQUFBO1FBQzFCLE1BQU0sQ0FBQyxZQUFZLENBQUMsS0FBSyxFQUFFLENBQUE7UUFDM0IsTUFBTSxDQUFDLHFCQUFxQixDQUFDLEtBQUssRUFBRSxDQUFBO1FBQ3BDLE1BQU0sQ0FBQyxPQUFPLEdBQUcsS0FBSyxDQUFBO1FBQ3RCLE1BQU0sQ0FBQyxPQUFPLEVBQUUsQ0FBQTtRQUVoQixJQUFJLENBQUMsZUFBZSxFQUFFLENBQUE7UUFDdEIsSUFBSSxDQUFDLFFBQVEsQ0FBQyxFQUFDLElBQUksRUFBRSxpQkFBaUIsRUFBRSxTQUFTLEVBQUUsZUFBZSxFQUFDLENBQUMsQ0FBQTtRQUNwRSxLQUFLLE1BQU0sSUFBSSxJQUFJLE1BQU07WUFBRSxJQUFJLENBQUMsUUFBUSxDQUFDLElBQUksQ0FBQyxDQUFBO1FBQzlDLE1BQU0sSUFBSSxDQUFDLGFBQWEsRUFBRSxDQUFBO0lBQzVCLENBQUM7SUFFRDs7Ozs7O09BTUc7SUFDSCxLQUFLLENBQUMsb0JBQW9CLENBQUMsTUFBTTtRQUMvQixNQUFNLFdBQVcsR0FBRyxDQUFDLEdBQUcsSUFBSSxDQUFDLFlBQVksQ0FBQyxNQUFNLEVBQUUsQ0FBQyxDQUFBO1FBRW5ELElBQUksQ0FBQyxZQUFZLENBQUMsS0FBSyxFQUFFLENBQUE7UUFFekIsS0FBSyxNQUFNLFVBQVUsSUFBSSxXQUFXLEVBQUUsQ0FBQztZQUNyQyxVQUFVLENBQUMsT0FBTyxHQUFHLElBQUksQ0FBQTtZQUV6QixJQUFJLENBQUM7Z0JBQ0gsTUFBTSxJQUFJLENBQUMsZ0JBQWdCLENBQUMsS0FBSyxJQUFJLEVBQUU7b0JBQ3JDLE1BQU0sVUFBVSxDQUFDLE9BQU8sQ0FBQyxNQUFNLENBQUMsQ0FBQTtnQkFDbEMsQ0FBQyxDQUFDLENBQUE7WUFDSixDQUFDO1lBQUMsT0FBTyxXQUFXLEVBQUUsQ0FBQztnQkFDckIsTUFBTSxLQUFLLEdBQUcsSUFBSSxDQUFDLDhCQUE4QixDQUFDLFdBQVcsRUFBRTtvQkFDN0QsWUFBWSxFQUFFLFVBQVUsQ0FBQyxZQUFZO29CQUNyQyxNQUFNO29CQUNOLEtBQUssRUFBRSwrQkFBK0I7aUJBQ3ZDLENBQUMsQ0FBQTtnQkFFRixJQUFJLENBQUMsTUFBTSxDQUFDLEtBQUssQ0FBQyxHQUFHLEVBQUUsQ0FBQyxDQUFDLGtDQUFrQyxVQUFVLENBQUMsWUFBWSxFQUFFLEVBQUUsS0FBSyxDQUFDLENBQUMsQ0FBQTtZQUMvRixDQUFDO1FBQ0gsQ0FBQztJQUNILENBQUM7SUFFRDs7Ozs7OztPQU9HO0lBQ0gsS0FBSyxDQUFDLHFCQUFxQixDQUFDLE9BQU87UUFDakMsTUFBTSxZQUFZLEdBQUcsT0FBTyxDQUFDLFlBQVksQ0FBQTtRQUN6QyxNQUFNLGNBQWMsR0FBRyxPQUFPLENBQUMsY0FBYyxDQUFBO1FBQzdDLE1BQU0sTUFBTSxHQUFHLE9BQU8sQ0FBQyxNQUFNLElBQUksRUFBRSxDQUFBO1FBRW5DLElBQUksT0FBTyxZQUFZLEtBQUssUUFBUSxJQUFJLENBQUMsWUFBWSxFQUFFLENBQUM7WUFDdEQsSUFBSSxDQUFDLFFBQVEsQ0FBQyxFQUFDLElBQUksRUFBRSxPQUFPLEVBQUUsS0FBSyxFQUFFLHVDQUF1QyxFQUFDLENBQUMsQ0FBQTtZQUM5RSxPQUFNO1FBQ1IsQ0FBQztRQUVELElBQUksT0FBTyxjQUFjLEtBQUssUUFBUSxJQUFJLENBQUMsY0FBYyxFQUFFLENBQUM7WUFDMUQsSUFBSSxDQUFDLFFBQVEsQ0FBQyxFQUFDLElBQUksRUFBRSxrQkFBa0IsRUFBRSxZQUFZLEVBQUUsT0FBTyxFQUFFLDRCQUE0QixFQUFDLENBQUMsQ0FBQTtZQUM5RixPQUFNO1FBQ1IsQ0FBQztRQUVELElBQUksSUFBSSxDQUFDLFlBQVksQ0FBQyxHQUFHLENBQUMsWUFBWSxDQUFDLEVBQUUsQ0FBQztZQUN4QyxJQUFJLENBQUMsUUFBUSxDQUFDLEVBQUMsSUFBSSxFQUFFLGtCQUFrQixFQUFFLFlBQVksRUFBRSxPQUFPLEVBQUUsOEJBQThCLEVBQUMsQ0FBQyxDQUFBO1lBQ2hHLE9BQU07UUFDUixDQUFDO1FBRUQsTUFBTSxlQUFlLEdBQUcsSUFBSSxDQUFDLGFBQWEsQ0FBQywyQkFBMkIsRUFBRSxDQUFDLGNBQWMsQ0FBQyxDQUFBO1FBRXhGLElBQUksQ0FBQyxlQUFlLEVBQUUsQ0FBQztZQUNyQixJQUFJLENBQUMsUUFBUSxDQUFDLEVBQUMsSUFBSSxFQUFFLGtCQUFrQixFQUFFLFlBQVksRUFBRSxPQUFPLEVBQUUsNEJBQTRCLGNBQWMsRUFBRSxFQUFDLENBQUMsQ0FBQTtZQUM5RyxPQUFNO1FBQ1IsQ0FBQztRQUVELE1BQU0sVUFBVSxHQUFHLElBQUksZUFBZSxDQUFDLEVBQUMsWUFBWSxFQUFFLE1BQU0sRUFBRSxPQUFPLEVBQUUsSUFBSSxFQUFDLENBQUMsQ0FBQTtRQUU3RSxJQUFJLENBQUM7WUFDSCxNQUFNLElBQUksQ0FBQyxnQkFBZ0IsQ0FBQyxLQUFLLElBQUksRUFBRTtnQkFDckMsTUFBTSxVQUFVLENBQUMsU0FBUyxFQUFFLENBQUE7WUFDOUIsQ0FBQyxDQUFDLENBQUE7WUFDRixpRUFBaUU7WUFDakUsNkRBQTZEO1lBQzdELElBQUksQ0FBQyxZQUFZLENBQUMsR0FBRyxDQUFDLFlBQVksRUFBRSxVQUFVLENBQUMsQ0FBQTtZQUMvQyxJQUFJLENBQUMsUUFBUSxDQUFDLEVBQUMsSUFBSSxFQUFFLG1CQUFtQixFQUFFLFlBQVksRUFBQyxDQUFDLENBQUE7UUFDMUQsQ0FBQztRQUFDLE9BQU8sV0FBVyxFQUFFLENBQUM7WUFDckIsTUFBTSxrQkFBa0IsR0FBRyxXQUFXLFlBQVksS0FBSyxDQUFDLENBQUMsQ0FBQyxXQUFXLENBQUMsT0FBTyxDQUFDLENBQUMsQ0FBQyxFQUFFLENBQUE7WUFDbEYsTUFBTSxLQUFLLEdBQUcsSUFBSSxDQUFDLDhCQUE4QixDQUFDLFdBQVcsRUFBRTtnQkFDN0QsWUFBWTtnQkFDWixjQUFjO2dCQUNkLEtBQUssRUFBRSwyQkFBMkI7YUFDbkMsQ0FBQyxDQUFBO1lBRUYsSUFBSSxDQUFDLE1BQU0sQ0FBQyxLQUFLLENBQUMsR0FBRyxFQUFFLENBQUMsQ0FBQyw2QkFBNkIsY0FBYyxJQUFJLFlBQVksRUFBRSxFQUFFLEtBQUssQ0FBQyxDQUFDLENBQUE7WUFDL0YsSUFBSSxDQUFDLFFBQVEsQ0FBQyxFQUFDLElBQUksRUFBRSxrQkFBa0IsRUFBRSxZQUFZLEVBQUUsT0FBTyxFQUFFLGtCQUFrQixJQUFJLDJCQUEyQixFQUFDLENBQUMsQ0FBQTtRQUNySCxDQUFDO0lBQ0gsQ0FBQztJQUVEOzs7O09BSUc7SUFDSCxLQUFLLENBQUMsd0JBQXdCLENBQUMsT0FBTztRQUNwQyxNQUFNLFlBQVksR0FBRyxPQUFPLENBQUMsWUFBWSxDQUFBO1FBQ3pDLE1BQU0sVUFBVSxHQUFHLE9BQU8sWUFBWSxLQUFLLFFBQVEsQ0FBQyxDQUFDLENBQUMsSUFBSSxDQUFDLFlBQVksQ0FBQyxHQUFHLENBQUMsWUFBWSxDQUFDLENBQUMsQ0FBQyxDQUFDLElBQUksQ0FBQTtRQUVoRyxJQUFJLENBQUMsVUFBVSxFQUFFLENBQUM7WUFDaEIsSUFBSSxDQUFDLFFBQVEsQ0FBQyxFQUFDLElBQUksRUFBRSxrQkFBa0IsRUFBRSxZQUFZLEVBQUUsT0FBTyxFQUFFLHVCQUF1QixFQUFDLENBQUMsQ0FBQTtZQUN6RixPQUFNO1FBQ1IsQ0FBQztRQUVELElBQUksQ0FBQztZQUNILE1BQU0sSUFBSSxDQUFDLGdCQUFnQixDQUFDLEtBQUssSUFBSSxFQUFFO2dCQUNyQyxNQUFNLFVBQVUsQ0FBQyxTQUFTLENBQUMsT0FBTyxDQUFDLElBQUksQ0FBQyxDQUFBO1lBQzFDLENBQUMsQ0FBQyxDQUFBO1FBQ0osQ0FBQztRQUFDLE9BQU8sV0FBVyxFQUFFLENBQUM7WUFDckIsTUFBTSxrQkFBa0IsR0FBRyxXQUFXLFlBQVksS0FBSyxDQUFDLENBQUMsQ0FBQyxXQUFXLENBQUMsT0FBTyxDQUFDLENBQUMsQ0FBQyxFQUFFLENBQUE7WUFDbEYsTUFBTSxLQUFLLEdBQUcsSUFBSSxDQUFDLDhCQUE4QixDQUFDLFdBQVcsRUFBRTtnQkFDN0QsWUFBWTtnQkFDWixLQUFLLEVBQUUsOEJBQThCO2FBQ3RDLENBQUMsQ0FBQTtZQUVGLElBQUksQ0FBQyxNQUFNLENBQUMsS0FBSyxDQUFDLEdBQUcsRUFBRSxDQUFDLENBQUMsMkNBQTJDLFlBQVksRUFBRSxFQUFFLEtBQUssQ0FBQyxDQUFDLENBQUE7WUFDM0YsSUFBSSxDQUFDLFFBQVEsQ0FBQyxFQUFDLElBQUksRUFBRSxrQkFBa0IsRUFBRSxZQUFZLEVBQUUsT0FBTyxFQUFFLGtCQUFrQixJQUFJLDBCQUEwQixFQUFDLENBQUMsQ0FBQTtRQUNwSCxDQUFDO0lBQ0gsQ0FBQztJQUVEOzs7OztPQUtHO0lBQ0gsS0FBSyxDQUFDLHNCQUFzQixDQUFDLE9BQU87UUFDbEMsTUFBTSxZQUFZLEdBQUcsT0FBTyxDQUFDLFlBQVksQ0FBQTtRQUN6QyxNQUFNLFVBQVUsR0FBRyxPQUFPLFlBQVksS0FBSyxRQUFRLENBQUMsQ0FBQyxDQUFDLElBQUksQ0FBQyxZQUFZLENBQUMsR0FBRyxDQUFDLFlBQVksQ0FBQyxDQUFDLENBQUMsQ0FBQyxJQUFJLENBQUE7UUFFaEcsSUFBSSxDQUFDLFVBQVU7WUFBRSxPQUFNO1FBRXZCLElBQUksQ0FBQyxZQUFZLENBQUMsTUFBTSxDQUFDLFlBQVksQ0FBQyxDQUFBO1FBQ3RDLDREQUE0RDtRQUM1RCxvRUFBb0U7UUFDcEUsVUFBVSxDQUFDLE9BQU8sR0FBRyxJQUFJLENBQUE7UUFFekIsSUFBSSxDQUFDO1lBQ0gsTUFBTSxJQUFJLENBQUMsZ0JBQWdCLENBQUMsS0FBSyxJQUFJLEVBQUU7Z0JBQ3JDLE1BQU0sVUFBVSxDQUFDLE9BQU8sQ0FBQyxjQUFjLENBQUMsQ0FBQTtZQUMxQyxDQUFDLENBQUMsQ0FBQTtRQUNKLENBQUM7UUFBQyxPQUFPLFdBQVcsRUFBRSxDQUFDO1lBQ3JCLE1BQU0sS0FBSyxHQUFHLElBQUksQ0FBQyw4QkFBOEIsQ0FBQyxXQUFXLEVBQUU7Z0JBQzdELFlBQVk7Z0JBQ1osS0FBSyxFQUFFLDRCQUE0QjthQUNwQyxDQUFDLENBQUE7WUFFRixJQUFJLENBQUMsTUFBTSxDQUFDLEtBQUssQ0FBQyxHQUFHLEVBQUUsQ0FBQyxDQUFDLGtDQUFrQyxZQUFZLEVBQUUsRUFBRSxLQUFLLENBQUMsQ0FBQyxDQUFBO1FBQ3BGLENBQUM7UUFFRCxJQUFJLENBQUMsUUFBUSxDQUFDLEVBQUMsSUFBSSxFQUFFLG1CQUFtQixFQUFFLFlBQVksRUFBRSxNQUFNLEVBQUUsY0FBYyxFQUFDLENBQUMsQ0FBQTtJQUNsRixDQUFDO0lBRUQ7Ozs7OztPQU1HO0lBQ0gsS0FBSyxDQUFDLHVCQUF1QixDQUFDLE9BQU87UUFDbkMsTUFBTSxjQUFjLEdBQUcsT0FBTyxDQUFDLGNBQWMsQ0FBQTtRQUM3QyxNQUFNLFdBQVcsR0FBRyxPQUFPLENBQUMsV0FBVyxDQUFBO1FBQ3ZDLE1BQU0sTUFBTSxHQUFHLE9BQU8sQ0FBQyxNQUFNLElBQUksRUFBRSxDQUFBO1FBQ25DLE1BQU0sV0FBVyxHQUFHLE9BQU8sQ0FBQyxXQUFXLENBQUE7UUFFdkMsSUFBSSxPQUFPLGNBQWMsS0FBSyxRQUFRLElBQUksQ0FBQyxjQUFjLEVBQUUsQ0FBQztZQUMxRCxJQUFJLENBQUMsUUFBUSxDQUFDLEVBQUMsSUFBSSxFQUFFLE9BQU8sRUFBRSxLQUFLLEVBQUUsMkNBQTJDLEVBQUMsQ0FBQyxDQUFBO1lBQ2xGLE9BQU07UUFDUixDQUFDO1FBRUQsSUFBSSxPQUFPLFdBQVcsS0FBSyxRQUFRLElBQUksQ0FBQyxXQUFXLEVBQUUsQ0FBQztZQUNwRCxJQUFJLENBQUMsUUFBUSxDQUFDLEVBQUMsSUFBSSxFQUFFLGVBQWUsRUFBRSxjQUFjLEVBQUUsT0FBTyxFQUFFLHlCQUF5QixFQUFDLENBQUMsQ0FBQTtZQUMxRixPQUFNO1FBQ1IsQ0FBQztRQUVELElBQUksSUFBSSxDQUFDLHFCQUFxQixDQUFDLEdBQUcsQ0FBQyxjQUFjLENBQUMsRUFBRSxDQUFDO1lBQ25ELElBQUksQ0FBQyxRQUFRLENBQUMsRUFBQyxJQUFJLEVBQUUsZUFBZSxFQUFFLGNBQWMsRUFBRSxPQUFPLEVBQUUsZ0NBQWdDLEVBQUMsQ0FBQyxDQUFBO1lBQ2pHLE9BQU07UUFDUixDQUFDO1FBRUQsTUFBTSxZQUFZLEdBQUcsSUFBSSxDQUFDLGFBQWEsQ0FBQyx3QkFBd0IsRUFBRSxDQUFDLFdBQVcsQ0FBQyxDQUFBO1FBRS9FLElBQUksQ0FBQyxZQUFZLEVBQUUsQ0FBQztZQUNsQixJQUFJLENBQUMsUUFBUSxDQUFDLEVBQUMsSUFBSSxFQUFFLGVBQWUsRUFBRSxjQUFjLEVBQUUsT0FBTyxFQUFFLHlCQUF5QixXQUFXLEVBQUUsRUFBQyxDQUFDLENBQUE7WUFDdkcsT0FBTTtRQUNSLENBQUM7UUFFRCxNQUFNLFlBQVksR0FBRyxJQUFJLFlBQVksQ0FBQyxFQUFDLGNBQWMsRUFBRSxNQUFNLEVBQUUsT0FBTyxFQUFFLElBQUksRUFBQyxDQUFDLENBQUE7UUFFOUUsSUFBSSxDQUFDO1lBQ0gscUVBQXFFO1lBQ3JFLHdFQUF3RTtZQUN4RSx3RUFBd0U7WUFDeEUsMEVBQTBFO1lBQzFFLGtFQUFrRTtZQUNsRSxnQkFBZ0I7WUFDaEIsSUFBSSxNQUFNLENBQUE7WUFDVixNQUFNLElBQUksQ0FBQyxnQkFBZ0IsQ0FBQyxLQUFLLElBQUksRUFBRTtnQkFDckMsTUFBTSxHQUFHLE1BQU0sSUFBSSxDQUFDLGNBQWMsQ0FBQyxFQUFDLE9BQU8sRUFBRSxXQUFXLEVBQUUsTUFBTSxFQUFDLENBQUMsQ0FBQTtZQUNwRSxDQUFDLENBQUMsQ0FBQTtZQUVGLE1BQU0sSUFBSSxDQUFDLGFBQWEsQ0FBQyxhQUFhLENBQUMsTUFBTSxFQUFFLEtBQUssSUFBSSxFQUFFO2dCQUN4RCxJQUFJLE9BQU8sR0FBRyxLQUFLLENBQUE7Z0JBRW5CLE1BQU0sSUFBSSxDQUFDLGdCQUFnQixDQUFDLEtBQUssSUFBSSxFQUFFO29CQUNyQyxPQUFPLEdBQUcsT0FBTyxDQUFDLE1BQU0sWUFBWSxDQUFDLFlBQVksRUFBRSxDQUFDLENBQUE7Z0JBQ3RELENBQUMsQ0FBQyxDQUFBO2dCQUVGLElBQUksQ0FBQyxPQUFPLEVBQUUsQ0FBQztvQkFDYixJQUFJLENBQUMsUUFBUSxDQUFDLEVBQUMsSUFBSSxFQUFFLGVBQWUsRUFBRSxjQUFjLEVBQUUsT0FBTyxFQUFFLDZCQUE2QixFQUFDLENBQUMsQ0FBQTtvQkFDOUYsT0FBTTtnQkFDUixDQUFDO2dCQUVELElBQUksQ0FBQyxxQkFBcUIsQ0FBQyxHQUFHLENBQUMsY0FBYyxFQUFFLEVBQUMsV0FBVyxFQUFFLFlBQVksRUFBQyxDQUFDLENBQUE7Z0JBQzNFLElBQUksQ0FBQyxhQUFhLENBQUMscUNBQXFDLENBQUMsV0FBVyxFQUFFLFlBQVksQ0FBQyxDQUFBO2dCQUVuRixNQUFNLElBQUksQ0FBQyxnQkFBZ0IsQ0FBQyxLQUFLLElBQUksRUFBRSxDQUFDLE1BQU0sWUFBWSxDQUFDLFVBQVUsRUFBRSxDQUFDLENBQUE7Z0JBRXhFLDREQUE0RDtnQkFDNUQsMERBQTBEO2dCQUMxRCxzQ0FBc0M7Z0JBQ3RDLElBQUksT0FBTyxXQUFXLEtBQUssUUFBUSxJQUFJLFdBQVcsQ0FBQyxNQUFNLEdBQUcsQ0FBQyxFQUFFLENBQUM7b0JBQzlELE1BQU0sSUFBSSxDQUFDLG1DQUFtQyxDQUFDLEVBQUMsV0FBVyxFQUFFLFdBQVcsRUFBRSxZQUFZLEVBQUMsQ0FBQyxDQUFBO2dCQUMxRixDQUFDO2dCQUVELElBQUksQ0FBQyxRQUFRLENBQUMsRUFBQyxJQUFJLEVBQUUsb0JBQW9CLEVBQUUsY0FBYyxFQUFDLENBQUMsQ0FBQTtZQUM3RCxDQUFDLENBQUMsQ0FBQTtRQUNKLENBQUM7UUFBQyxPQUFPLFdBQVcsRUFBRSxDQUFDO1lBQ3JCLE1BQU0sa0JBQWtCLEdBQUcsV0FBVyxZQUFZLEtBQUssQ0FBQyxDQUFDLENBQUMsV0FBVyxDQUFDLE9BQU8sQ0FBQyxDQUFDLENBQUMsRUFBRSxDQUFBO1lBRWxGLElBQUksQ0FBQyxxQkFBcUIsQ0FBQyxNQUFNLENBQUMsY0FBYyxDQUFDLENBQUE7WUFDakQsSUFBSSxDQUFDLGFBQWEsQ0FBQyx1Q0FBdUMsQ0FBQyxXQUFXLEVBQUUsWUFBWSxDQUFDLENBQUE7WUFDckYsTUFBTSxLQUFLLEdBQUcsSUFBSSxDQUFDLDhCQUE4QixDQUFDLFdBQVcsRUFBRTtnQkFDN0QsV0FBVztnQkFDWCxLQUFLLEVBQUUsNkJBQTZCO2dCQUNwQyxjQUFjO2FBQ2YsQ0FBQyxDQUFBO1lBRUYsSUFBSSxDQUFDLE1BQU0sQ0FBQyxLQUFLLENBQUMsR0FBRyxFQUFFLENBQUMsQ0FBQywrQkFBK0IsV0FBVyxJQUFJLGNBQWMsRUFBRSxFQUFFLEtBQUssQ0FBQyxDQUFDLENBQUE7WUFDaEcsSUFBSSxDQUFDLFFBQVEsQ0FBQyxFQUFDLElBQUksRUFBRSxlQUFlLEVBQUUsY0FBYyxFQUFFLE9BQU8sRUFBRSxrQkFBa0IsSUFBSSxxQkFBcUIsRUFBQyxDQUFDLENBQUE7UUFDOUcsQ0FBQztJQUNILENBQUM7SUFFRDs7Ozs7Ozs7O09BU0c7SUFDSCxLQUFLLENBQUMsbUNBQW1DLENBQUMsRUFBQyxXQUFXLEVBQUUsV0FBVyxFQUFFLFlBQVksRUFBQztRQUNoRixNQUFNLEtBQUssR0FBRyxzQ0FBc0MsQ0FBQyxJQUFJLENBQUMsYUFBYSxDQUFDLENBQUE7UUFFeEUsTUFBTSxJQUFJLENBQUMsYUFBYSxDQUFDLHNCQUFzQixFQUFFLENBQUE7UUFFakQsTUFBTSxVQUFVLEdBQUcsTUFBTSxLQUFLLENBQUMsWUFBWSxDQUFDLEVBQUMsT0FBTyxFQUFFLFdBQVcsRUFBRSxFQUFFLEVBQUUsV0FBVyxFQUFDLENBQUMsQ0FBQTtRQUVwRixJQUFJLENBQUMsVUFBVSxFQUFFLENBQUM7WUFDaEIsSUFBSSxDQUFDLFFBQVEsQ0FBQztnQkFDWixJQUFJLEVBQUUsb0JBQW9CO2dCQUMxQixjQUFjLEVBQUUsWUFBWSxDQUFDLGNBQWM7Z0JBQzNDLFdBQVc7YUFDWixDQUFDLENBQUE7WUFDRixPQUFNO1FBQ1IsQ0FBQztRQUVELE1BQU0sT0FBTyxHQUFHLE1BQU0sS0FBSyxDQUFDLGNBQWMsQ0FBQyxXQUFXLENBQUMsQ0FBQTtRQUV2RCxJQUFJLENBQUMsT0FBTyxJQUFJLE9BQU8sSUFBSSxVQUFVLENBQUMsUUFBUTtZQUFFLE9BQU07UUFFdEQsTUFBTSxNQUFNLEdBQUcsTUFBTSxLQUFLLENBQUMsY0FBYyxDQUFDO1lBQ3hDLE9BQU8sRUFBRSxXQUFXO1lBQ3BCLFFBQVEsRUFBRSxVQUFVLENBQUMsUUFBUTtZQUM3QixZQUFZLEVBQUUsT0FBTztTQUN0QixDQUFDLENBQUE7UUFFRixLQUFLLE1BQU0sS0FBSyxJQUFJLE1BQU0sRUFBRSxDQUFDO1lBQzNCLElBQUksWUFBWSxDQUFDLFFBQVEsRUFBRTtnQkFBRSxNQUFLO1lBRWxDLFlBQVksQ0FBQyxXQUFXLENBQUMsbUVBQW1FLENBQUMsQ0FBQyxLQUFLLENBQUMsT0FBTyxDQUFDLENBQUMsQ0FBQTtRQUMvRyxDQUFDO0lBQ0gsQ0FBQztJQUVEOzs7OztPQUtHO0lBQ0gsS0FBSyxDQUFDLHlCQUF5QixDQUFDLE9BQU87UUFDckMsTUFBTSxjQUFjLEdBQUcsT0FBTyxDQUFDLGNBQWMsQ0FBQTtRQUU3QyxJQUFJLE9BQU8sY0FBYyxLQUFLLFFBQVE7WUFBRSxPQUFNO1FBRTlDLE1BQU0sS0FBSyxHQUFHLElBQUksQ0FBQyxxQkFBcUIsQ0FBQyxHQUFHLENBQUMsY0FBYyxDQUFDLENBQUE7UUFFNUQsSUFBSSxDQUFDLEtBQUs7WUFBRSxPQUFNO1FBRWxCLElBQUksQ0FBQyxxQkFBcUIsQ0FBQyxNQUFNLENBQUMsY0FBYyxDQUFDLENBQUE7UUFDakQsSUFBSSxDQUFDLGFBQWEsQ0FBQyx1Q0FBdUMsQ0FBQyxLQUFLLENBQUMsV0FBVyxFQUFFLEtBQUssQ0FBQyxZQUFZLENBQUMsQ0FBQTtRQUNqRyxLQUFLLENBQUMsWUFBWSxDQUFDLE9BQU8sR0FBRyxJQUFJLENBQUE7UUFFakMsSUFBSSxDQUFDO1lBQ0gsTUFBTSxJQUFJLENBQUMsZ0JBQWdCLENBQUMsS0FBSyxJQUFJLEVBQUUsQ0FBQyxNQUFNLEtBQUssQ0FBQyxZQUFZLENBQUMsWUFBWSxFQUFFLENBQUMsQ0FBQTtRQUNsRixDQUFDO1FBQUMsT0FBTyxXQUFXLEVBQUUsQ0FBQztZQUNyQixNQUFNLEtBQUssR0FBRyxJQUFJLENBQUMsOEJBQThCLENBQUMsV0FBVyxFQUFFO2dCQUM3RCxXQUFXLEVBQUUsS0FBSyxDQUFDLFdBQVc7Z0JBQzlCLEtBQUssRUFBRSwrQkFBK0I7Z0JBQ3RDLGNBQWM7YUFDZixDQUFDLENBQUE7WUFFRixJQUFJLENBQUMsTUFBTSxDQUFDLEtBQUssQ0FBQyxHQUFHLEVBQUUsQ0FBQyxDQUFDLGlDQUFpQyxLQUFLLENBQUMsV0FBVyxJQUFJLGNBQWMsRUFBRSxFQUFFLEtBQUssQ0FBQyxDQUFDLENBQUE7UUFDMUcsQ0FBQztRQUVELElBQUksQ0FBQyxRQUFRLENBQUMsRUFBQyxJQUFJLEVBQUUsc0JBQXNCLEVBQUUsY0FBYyxFQUFDLENBQUMsQ0FBQTtJQUMvRCxDQUFDO0lBRUQ7Ozs7OztPQU1HO0lBQ0gsS0FBSyxDQUFDLDZCQUE2QjtRQUNqQyxNQUFNLE9BQU8sR0FBRyxDQUFDLEdBQUcsSUFBSSxDQUFDLHFCQUFxQixDQUFDLE1BQU0sRUFBRSxDQUFDLENBQUE7UUFFeEQsSUFBSSxDQUFDLHFCQUFxQixDQUFDLEtBQUssRUFBRSxDQUFBO1FBRWxDLEtBQUssTUFBTSxFQUFDLFdBQVcsRUFBRSxZQUFZLEVBQUMsSUFBSSxPQUFPLEVBQUUsQ0FBQztZQUNsRCxJQUFJLENBQUMsYUFBYSxDQUFDLHVDQUF1QyxDQUFDLFdBQVcsRUFBRSxZQUFZLENBQUMsQ0FBQTtZQUNyRixZQUFZLENBQUMsT0FBTyxHQUFHLElBQUksQ0FBQTtZQUUzQixJQUFJLENBQUM7Z0JBQ0gsTUFBTSxJQUFJLENBQUMsZ0JBQWdCLENBQUMsS0FBSyxJQUFJLEVBQUUsQ0FBQyxNQUFNLFlBQVksQ0FBQyxZQUFZLEVBQUUsQ0FBQyxDQUFBO1lBQzVFLENBQUM7WUFBQyxPQUFPLFdBQVcsRUFBRSxDQUFDO2dCQUNyQixNQUFNLEtBQUssR0FBRyxJQUFJLENBQUMsOEJBQThCLENBQUMsV0FBVyxFQUFFO29CQUM3RCxXQUFXO29CQUNYLEtBQUssRUFBRSw0QkFBNEI7b0JBQ25DLGNBQWMsRUFBRSxZQUFZLENBQUMsY0FBYztpQkFDNUMsQ0FBQyxDQUFBO2dCQUVGLElBQUksQ0FBQyxNQUFNLENBQUMsS0FBSyxDQUFDLEdBQUcsRUFBRSxDQUFDLENBQUMsa0NBQWtDLFdBQVcsSUFBSSxZQUFZLENBQUMsY0FBYyxFQUFFLEVBQUUsS0FBSyxDQUFDLENBQUMsQ0FBQTtZQUNsSCxDQUFDO1FBQ0gsQ0FBQztJQUNILENBQUM7SUFFRCxLQUFLLENBQUMsZ0JBQWdCO1FBQ3BCLEtBQUssTUFBTSxPQUFPLElBQUksSUFBSSxDQUFDLFFBQVEsRUFBRSxDQUFDO1lBQ3BDLE1BQU0sSUFBSSxDQUFDLHNCQUFzQixDQUFDLE9BQU8sQ0FBQyxDQUFBO1FBQzVDLENBQUM7UUFDRCxJQUFJLENBQUMsUUFBUSxDQUFDLEtBQUssRUFBRSxDQUFBO1FBQ3JCLElBQUksQ0FBQyxtQkFBbUIsQ0FBQyxLQUFLLEVBQUUsQ0FBQTtJQUNsQyxDQUFDO0lBRUQ7Ozs7T0FJRztJQUNILEtBQUssQ0FBQyxzQkFBc0IsQ0FBQyxPQUFPO1FBQ2xDLElBQUksQ0FBQztZQUNILE1BQU0sTUFBTSxHQUFHLElBQUksQ0FBQyxjQUFjLENBQUMsR0FBRyxDQUFDLE9BQU8sQ0FBQyxDQUFBO1lBRS9DLE1BQU0sSUFBSSxDQUFDLGFBQWEsQ0FBQyxhQUFhLENBQUMsTUFBTSxFQUFFLEtBQUssSUFBSSxFQUFFO2dCQUN4RCxNQUFNLElBQUksQ0FBQyxnQkFBZ0IsQ0FBQyxLQUFLLElBQUksRUFBRTtvQkFDckMsTUFBTSxPQUFPLEVBQUUsWUFBWSxFQUFFLEVBQUUsQ0FBQTtnQkFDakMsQ0FBQyxDQUFDLENBQUE7WUFDSixDQUFDLENBQUMsQ0FBQTtRQUNKLENBQUM7UUFBQyxPQUFPLFdBQVcsRUFBRSxDQUFDO1lBQ3JCLE1BQU0sS0FBSyxHQUFHLElBQUksQ0FBQyw4QkFBOEIsQ0FBQyxXQUFXLEVBQUU7Z0JBQzdELEtBQUssRUFBRSw0QkFBNEI7YUFDcEMsQ0FBQyxDQUFBO1lBRUYsSUFBSSxDQUFDLE1BQU0sQ0FBQyxLQUFLLENBQUMsR0FBRyxFQUFFLENBQUMsQ0FBQyxzQ0FBc0MsRUFBRSxLQUFLLENBQUMsQ0FBQyxDQUFBO1FBQzFFLENBQUM7UUFFRCxNQUFNLGFBQWEsR0FBRyxJQUFJLENBQUMsb0JBQW9CLENBQUMsR0FBRyxDQUFDLE9BQU8sQ0FBQyxDQUFBO1FBRTVELElBQUksYUFBYSxFQUFFLENBQUM7WUFDbEIsS0FBSyxNQUFNLG1CQUFtQixJQUFJLGFBQWEsRUFBRSxDQUFDO2dCQUNoRCxJQUFJLENBQUMsb0JBQW9CLENBQUMsR0FBRyxDQUFDLG1CQUFtQixDQUFDLEVBQUUsTUFBTSxDQUFDLE9BQU8sQ0FBQyxDQUFBO2dCQUVuRSxJQUFJLElBQUksQ0FBQyxvQkFBb0IsQ0FBQyxHQUFHLENBQUMsbUJBQW1CLENBQUMsRUFBRSxJQUFJLEtBQUssQ0FBQyxFQUFFLENBQUM7b0JBQ25FLElBQUksQ0FBQyxvQkFBb0IsQ0FBQyxNQUFNLENBQUMsbUJBQW1CLENBQUMsQ0FBQTtnQkFDdkQsQ0FBQztZQUNILENBQUM7WUFFRCxJQUFJLENBQUMsb0JBQW9CLENBQUMsTUFBTSxDQUFDLE9BQU8sQ0FBQyxDQUFBO1FBQzNDLENBQUM7UUFFRCxJQUFJLENBQUMsY0FBYyxDQUFDLE1BQU0sQ0FBQyxPQUFPLENBQUMsQ0FBQTtJQUNyQyxDQUFDO0lBRUQ7Ozs7O09BS0c7SUFDSCxLQUFLLENBQUMsZ0JBQWdCLENBQUMsT0FBTyxFQUFFLE1BQU07UUFDcEMsSUFBSSxDQUFDLE9BQU87WUFBRSxPQUFNO1FBRXBCLElBQUksQ0FBQyxRQUFRLENBQUMsR0FBRyxDQUFDLE9BQU8sQ0FBQyxDQUFBO1FBQzFCLElBQUksQ0FBQyxjQUFjLENBQUMsR0FBRyxDQUFDLE9BQU8sRUFBRSxNQUFNLENBQUMsQ0FBQTtRQUN4QyxNQUFNLElBQUksQ0FBQyxhQUFhLENBQUMsYUFBYSxDQUFDLE1BQU0sRUFBRSxLQUFLLElBQUksRUFBRTtZQUN4RCxNQUFNLElBQUksQ0FBQyxnQkFBZ0IsQ0FBQyxLQUFLLElBQUksRUFBRTtnQkFDckMsTUFBTSxPQUFPLEVBQUUsVUFBVSxFQUFFLEVBQUUsQ0FBQTtZQUMvQixDQUFDLENBQUMsQ0FBQTtRQUNKLENBQUMsQ0FBQyxDQUFBO0lBQ0osQ0FBQztJQUVEOzs7O09BSUc7SUFDSCxLQUFLLENBQUMsZ0JBQWdCLENBQUMsUUFBUTtRQUM3QixNQUFNLElBQUksQ0FBQyxhQUFhLENBQUMsaUJBQWlCLENBQUMsRUFBQyxJQUFJLEVBQUUsbUJBQW1CLEVBQUMsRUFBRSxLQUFLLElBQUksRUFBRTtZQUNqRixNQUFNLFFBQVEsRUFBRSxDQUFBO1FBQ2xCLENBQUMsQ0FBQyxDQUFBO0lBQ0osQ0FBQztJQUVEOzs7O09BSUc7SUFDSCxLQUFLLENBQUMsMEJBQTBCLENBQUMsRUFBQyxPQUFPLEVBQUUsV0FBVyxFQUFFLE1BQU0sRUFBQztRQUM3RCxNQUFNLFFBQVEsR0FBRyxJQUFJLENBQUMsYUFBYSxDQUFDLDJCQUEyQixFQUFFLEVBQUUsQ0FBQTtRQUVuRSxJQUFJLENBQUMsUUFBUTtZQUFFLE9BQU07UUFFckIsSUFBSSxDQUFDO1lBQ0gseUVBQXlFO1lBQ3pFLGtEQUFrRDtZQUNsRCxJQUFJLE1BQU0sQ0FBQTtZQUNWLE1BQU0sSUFBSSxDQUFDLGdCQUFnQixDQUFDLEtBQUssSUFBSSxFQUFFO2dCQUNyQyxNQUFNLEdBQUcsTUFBTSxJQUFJLENBQUMsY0FBYyxDQUFDLEVBQUMsT0FBTyxFQUFFLE1BQU0sRUFBQyxDQUFDLENBQUE7WUFDdkQsQ0FBQyxDQUFDLENBQUE7WUFDRixNQUFNLFFBQVEsR0FBRyxNQUFNLElBQUksQ0FBQyxhQUFhLENBQUMsYUFBYSxDQUFDLE1BQU0sRUFBRSxLQUFLLElBQUksRUFBRTtnQkFDekUsT0FBTyxNQUFNLFFBQVEsQ0FBQztvQkFDcEIsTUFBTSxFQUFFLElBQUksQ0FBQyxNQUFNO29CQUNuQixhQUFhLEVBQUUsSUFBSSxDQUFDLGFBQWE7b0JBQ2pDLE9BQU8sRUFBRSxJQUFJLENBQUMsY0FBYztvQkFDNUIsWUFBWSxFQUFFLEVBQUMsT0FBTyxFQUFFLE1BQU0sRUFBQztvQkFDL0IsZ0JBQWdCLEVBQUUsSUFBSTtpQkFDdkIsQ0FBQyxDQUFBO1lBQ0osQ0FBQyxDQUFDLENBQUE7WUFFRixJQUFJLENBQUMsUUFBUSxFQUFFLENBQUM7Z0JBQ2QsSUFBSSxDQUFDLFFBQVEsQ0FBQyxFQUFDLE9BQU8sRUFBRSxLQUFLLEVBQUUsdUJBQXVCLEVBQUUsSUFBSSxFQUFFLE9BQU8sRUFBQyxDQUFDLENBQUE7Z0JBQ3ZFLE9BQU07WUFDUixDQUFDO1lBRUQsTUFBTSxlQUFlLEdBQUcsT0FBTyxRQUFRLEtBQUssVUFBVTtnQkFDcEQsQ0FBQyxDQUFDLElBQUksUUFBUSxDQUFDO29CQUNiLE1BQU0sRUFBRSxJQUFJLENBQUMsTUFBTTtvQkFDbkIsYUFBYSxFQUFFLElBQUksQ0FBQyxhQUFhO29CQUNqQyxXQUFXO29CQUNYLE9BQU8sRUFBRSxJQUFJLENBQUMsY0FBYztvQkFDNUIsbUJBQW1CLEVBQUUsT0FBTztvQkFDNUIsa0JBQWtCLEVBQUUsTUFBTTtvQkFDMUIsZ0JBQWdCLEVBQUUsSUFBSTtpQkFDdkIsQ0FBQztnQkFDRixDQUFDLENBQUMsUUFBUSxDQUFBO1lBRVosSUFBSSxlQUFlLElBQUksQ0FBQyxDQUFDLGVBQWUsWUFBWSxnQkFBZ0IsQ0FBQyxFQUFFLENBQUM7Z0JBQ3RFLE1BQU0sSUFBSSxLQUFLLENBQUMseURBQXlELENBQUMsQ0FBQTtZQUM1RSxDQUFDO1lBRUQsTUFBTSxJQUFJLENBQUMsZ0JBQWdCLENBQUMsZUFBZSxFQUFFLE1BQU0sQ0FBQyxDQUFBO1FBQ3RELENBQUM7UUFBQyxPQUFPLFdBQVcsRUFBRSxDQUFDO1lBQ3JCLE1BQU0sS0FBSyxHQUFHLElBQUksQ0FBQyw4QkFBOEIsQ0FBQyxXQUFXLEVBQUU7Z0JBQzdELE9BQU87Z0JBQ1AsS0FBSyxFQUFFLGdDQUFnQzthQUN4QyxDQUFDLENBQUE7WUFFRixJQUFJLENBQUMsTUFBTSxDQUFDLElBQUksQ0FBQyxHQUFHLEVBQUUsQ0FBQyxDQUFDLHVDQUF1QyxFQUFFLEtBQUssQ0FBQyxDQUFDLENBQUE7WUFDeEUsSUFBSSxDQUFDLFFBQVEsQ0FBQyxFQUFDLE9BQU8sRUFBRSxLQUFLLEVBQUUsdUJBQXVCLEVBQUUsSUFBSSxFQUFFLE9BQU8sRUFBQyxDQUFDLENBQUE7UUFDekUsQ0FBQztJQUNILENBQUM7SUFFRDs7Ozs7Ozs7T0FRRztJQUNILEtBQUssQ0FBQyxtQkFBbUIsQ0FBQyxFQUFDLE9BQU8sRUFBRSxXQUFXLEVBQUUsbUJBQW1CLEVBQUUsa0JBQWtCLEVBQUM7UUFDdkYsSUFBSSxDQUFDLFdBQVc7WUFBRSxPQUFPLElBQUksQ0FBQTtRQUU3QixNQUFNLEtBQUssR0FBRyxzQ0FBc0MsQ0FBQyxJQUFJLENBQUMsYUFBYSxDQUFDLENBQUE7UUFDeEUsTUFBTSxVQUFVLEdBQUcsTUFBTSxLQUFLLENBQUMsWUFBWSxDQUFDLEVBQUMsT0FBTyxFQUFFLEVBQUUsRUFBRSxXQUFXLEVBQUMsQ0FBQyxDQUFBO1FBRXZFLElBQUksQ0FBQyxVQUFVLEVBQUUsQ0FBQztZQUNoQixJQUFJLENBQUMsUUFBUSxDQUFDLEVBQUMsT0FBTyxFQUFFLG1CQUFtQixFQUFFLFdBQVcsRUFBRSxNQUFNLEVBQUUsa0JBQWtCLEVBQUUsSUFBSSxFQUFFLFlBQVksRUFBQyxDQUFDLENBQUE7WUFDMUcsT0FBTyxLQUFLLENBQUE7UUFDZCxDQUFDO1FBRUQsT0FBTztZQUNMLFFBQVEsRUFBRSxLQUFLO1lBQ2YsZUFBZSxFQUFFLENBQUMsTUFBTSxLQUFLLENBQUMsY0FBYyxDQUFDLE9BQU8sQ0FBQyxDQUFDLElBQUksVUFBVSxDQUFDLFFBQVE7WUFDN0Usa0JBQWtCLEVBQUUsVUFBVSxDQUFDLFFBQVE7WUFDdkMsU0FBUyxFQUFFLElBQUk7U0FDaEIsQ0FBQTtJQUNILENBQUM7SUFFRDs7Ozs7O09BTUc7SUFDSCxLQUFLLENBQUMsb0JBQW9CLENBQUMsRUFBQyxPQUFPLEVBQUUsV0FBVyxFQUFDO1FBQy9DLE1BQU0sS0FBSyxHQUFHLHNDQUFzQyxDQUFDLElBQUksQ0FBQyxhQUFhLENBQUMsQ0FBQTtRQUN4RSxNQUFNLE1BQU0sR0FBRyxNQUFNLEtBQUssQ0FBQyxjQUFjLENBQUM7WUFDeEMsT0FBTztZQUNQLFFBQVEsRUFBRSxXQUFXLENBQUMsa0JBQWtCO1lBQ3hDLFlBQVksRUFBRSxXQUFXLENBQUMsZUFBZTtTQUMxQyxDQUFDLENBQUE7UUFFRixLQUFLLE1BQU0sS0FBSyxJQUFJLE1BQU0sRUFBRSxDQUFDO1lBQzNCLE1BQU0sSUFBSSxDQUFDLFNBQVMsQ0FBQyxPQUFPLEVBQUUsS0FBSyxDQUFDLE9BQU8sRUFBRTtnQkFDM0MsU0FBUyxFQUFFLEtBQUssQ0FBQyxTQUFTO2dCQUMxQixPQUFPLEVBQUUsS0FBSyxDQUFDLEVBQUU7Z0JBQ2pCLFFBQVEsRUFBRSxJQUFJO2dCQUNkLFFBQVEsRUFBRSxLQUFLLENBQUMsUUFBUTthQUN6QixDQUFDLENBQUE7UUFDSixDQUFDO0lBQ0gsQ0FBQztJQUVEOzs7OztPQUtHO0lBQ0gsS0FBSyxDQUFDLGtCQUFrQixDQUFDLE9BQU8sRUFBRSxXQUFXO1FBQzNDLE1BQU0sS0FBSyxHQUFHLHNDQUFzQyxDQUFDLElBQUksQ0FBQyxhQUFhLENBQUMsQ0FBQTtRQUV4RSxXQUFXLENBQUMsU0FBUyxHQUFHLEtBQUssQ0FBQTtRQUM3QixJQUFJLENBQUMsbUJBQW1CLENBQUMsTUFBTSxDQUFDLE9BQU8sQ0FBQyxDQUFBO1FBRXhDLElBQUksQ0FBQyxXQUFXLENBQUMsUUFBUTtZQUFFLE9BQU07UUFFakMsTUFBTSxVQUFVLEdBQUcsTUFBTSxLQUFLLENBQUMsY0FBYyxDQUFDO1lBQzVDLE9BQU87WUFDUCxRQUFRLEVBQUUsV0FBVyxDQUFDLGVBQWU7U0FDdEMsQ0FBQyxDQUFBO1FBRUYsS0FBSyxNQUFNLEtBQUssSUFBSSxVQUFVLEVBQUUsQ0FBQztZQUMvQixNQUFNLElBQUksQ0FBQyxTQUFTLENBQUMsT0FBTyxFQUFFLEtBQUssQ0FBQyxPQUFPLEVBQUU7Z0JBQzNDLFNBQVMsRUFBRSxLQUFLLENBQUMsU0FBUztnQkFDMUIsT0FBTyxFQUFFLEtBQUssQ0FBQyxFQUFFO2dCQUNqQixRQUFRLEVBQUUsS0FBSyxDQUFDLFFBQVE7YUFDekIsQ0FBQyxDQUFBO1FBQ0osQ0FBQztJQUNILENBQUM7SUFFRDs7OztPQUlHO0lBQ0gsS0FBSyxDQUFDLGNBQWMsQ0FBQyxFQUFDLE9BQU8sRUFBRSxNQUFNLEVBQUM7UUFDcEMsTUFBTSxhQUFhLEdBQUcsSUFBSSxDQUFDLGNBQWMsRUFBRSxNQUFNLEVBQUUsRUFBRSxDQUFBO1FBQ3JELE1BQU0sWUFBWSxHQUFHO1lBQ25CLEdBQUcsQ0FBQyxhQUFhLElBQUksT0FBTyxhQUFhLEtBQUssUUFBUSxDQUFDLENBQUMsQ0FBQyxhQUFhLENBQUMsQ0FBQyxDQUFDLEVBQUUsQ0FBQztZQUM1RSxHQUFHLENBQUMsTUFBTSxJQUFJLE9BQU8sTUFBTSxLQUFLLFFBQVEsQ0FBQyxDQUFDLENBQUMsTUFBTSxDQUFDLENBQUMsQ0FBQyxFQUFFLENBQUM7U0FDeEQsQ0FBQTtRQUVELE9BQU8saURBQWlELENBQUMsQ0FBQyxJQUFJLENBQUMsYUFBYSxDQUFDLGFBQWEsQ0FBQztZQUN6RixNQUFNLEVBQUUsWUFBWTtZQUNwQixPQUFPLEVBQUUsSUFBSSxDQUFDLGNBQWM7WUFDNUIsUUFBUSxFQUFFLFNBQVM7WUFDbkIsWUFBWSxFQUFFLE9BQU8sQ0FBQyxDQUFDLENBQUMsRUFBQyxPQUFPLEVBQUUsTUFBTSxFQUFDLENBQUMsQ0FBQyxDQUFDLFNBQVM7U0FDdEQsQ0FBQyxDQUFDLENBQUE7SUFDTCxDQUFDO0lBRUQ7Ozs7O09BS0c7SUFDSCxjQUFjLENBQUMsT0FBTyxFQUFFLElBQUk7UUFDMUIsS0FBSyxJQUFJLENBQUMsR0FBRyxDQUFDLEVBQUUsQ0FBQyxHQUFHLE9BQU8sQ0FBQyxNQUFNLEVBQUUsQ0FBQyxFQUFFLEVBQUUsQ0FBQztZQUN4QyxPQUFPLENBQUMsQ0FBQyxDQUFDLElBQUksSUFBSSxDQUFDLENBQUMsR0FBRyxDQUFDLENBQUMsQ0FBQTtRQUMzQixDQUFDO0lBQ0gsQ0FBQztJQUVELEtBQUssQ0FBQyxzQkFBc0I7UUFDMUIsSUFBSSxDQUFDO1lBQ0gsTUFBTSxPQUFPLEdBQUcsSUFBSSxDQUFDLGNBQWMsQ0FBQTtZQUNuQyxNQUFNLE1BQU0sR0FBRyxPQUFPLENBQUMsQ0FBQyxDQUFDLE9BQU8sQ0FBQyxNQUFNLENBQUMsQ0FBQyxDQUFDLElBQUksQ0FBQTtZQUU5QyxJQUFJLE1BQU0sRUFBRSxDQUFDO2dCQUNYLE1BQU0sTUFBTSxDQUFDLEVBQUMsT0FBTyxFQUFFLElBQUksRUFBQyxDQUFDLENBQUE7WUFDL0IsQ0FBQztRQUNILENBQUM7UUFBQyxPQUFPLFdBQVcsRUFBRSxDQUFDO1lBQ3JCLE1BQU0sS0FBSyxHQUFHLElBQUksQ0FBQyw4QkFBOEIsQ0FBQyxXQUFXLEVBQUU7Z0JBQzdELEtBQUssRUFBRSxnQ0FBZ0M7YUFDeEMsQ0FBQyxDQUFBO1lBRUYsSUFBSSxDQUFDLE1BQU0sQ0FBQyxLQUFLLENBQUMsR0FBRyxFQUFFLENBQUMsQ0FBQywrQkFBK0IsRUFBRSxLQUFLLENBQUMsQ0FBQyxDQUFBO1FBQ25FLENBQUM7SUFDSCxDQUFDO0lBRUQ7Ozs7T0FJRztJQUNILEtBQUssQ0FBQyx5QkFBeUIsQ0FBQyxPQUFPO1FBQ3JDLElBQUksQ0FBQztZQUNILE1BQU0sT0FBTyxHQUFHLElBQUksQ0FBQyxjQUFjLENBQUE7WUFDbkMsTUFBTSxTQUFTLEdBQUcsT0FBTyxDQUFDLENBQUMsQ0FBQyxPQUFPLENBQUMsU0FBUyxDQUFDLENBQUMsQ0FBQyxJQUFJLENBQUE7WUFFcEQsSUFBSSxTQUFTLEVBQUUsQ0FBQztnQkFDZCxNQUFNLFNBQVMsQ0FBQyxFQUFDLE9BQU8sRUFBRSxPQUFPLEVBQUUsSUFBSSxFQUFDLENBQUMsQ0FBQTtZQUMzQyxDQUFDO1FBQ0gsQ0FBQztRQUFDLE9BQU8sV0FBVyxFQUFFLENBQUM7WUFDckIsTUFBTSxPQUFPLEdBQUcsSUFBSSxDQUFDLGNBQWMsQ0FBQTtZQUNuQyxNQUFNLE9BQU8sR0FBRyxPQUFPLENBQUMsQ0FBQyxDQUFDLE9BQU8sQ0FBQyxPQUFPLENBQUMsQ0FBQyxDQUFDLElBQUksQ0FBQTtZQUNoRCxNQUFNLFlBQVksR0FBRyxXQUFXLENBQUMsV0FBVyxDQUFDLENBQUE7WUFDN0MsTUFBTSxLQUFLLEdBQUcsSUFBSSxDQUFDLDhCQUE4QixDQUFDLFlBQVksRUFBRTtnQkFDOUQsS0FBSyxFQUFFLDJCQUEyQjthQUNuQyxDQUFDLENBQUE7WUFFRixJQUFJLENBQUMsTUFBTSxDQUFDLEtBQUssQ0FBQyxHQUFHLEVBQUUsQ0FBQyxDQUFDLGtDQUFrQyxFQUFFLEtBQUssQ0FBQyxDQUFDLENBQUE7WUFDcEUsSUFBSSxDQUFDLE9BQU87Z0JBQUUsT0FBTTtZQUVwQixJQUFJLENBQUM7Z0JBQ0gsTUFBTSxPQUFPLENBQUMsRUFBQyxLQUFLLEVBQUUsWUFBWSxFQUFFLE9BQU8sRUFBRSxJQUFJLEVBQUMsQ0FBQyxDQUFBO1lBQ3JELENBQUM7WUFBQyxPQUFPLGtCQUFrQixFQUFFLENBQUM7Z0JBQzVCLE1BQU0sa0JBQWtCLEdBQUcsa0JBQWtCLFlBQVksS0FBSztvQkFDNUQsQ0FBQyxDQUFDLGtCQUFrQixDQUFDLE9BQU87b0JBQzVCLENBQUMsQ0FBQyxNQUFNLENBQUMsa0JBQWtCLENBQUMsQ0FBQTtnQkFDOUIsTUFBTSxZQUFZLEdBQUcsSUFBSSxDQUFDLDhCQUE4QixDQUFDLGtCQUFrQixFQUFFO29CQUMzRSxLQUFLLEVBQUUsaUNBQWlDO2lCQUN6QyxDQUFDLENBQUE7Z0JBRUYsSUFBSSxDQUFDLE1BQU0sQ0FBQyxLQUFLLENBQUMsR0FBRyxFQUFFLENBQUMsQ0FBQyx3Q0FBd0MsRUFBRSxZQUFZLENBQUMsQ0FBQyxDQUFBO2dCQUNqRixJQUFJLENBQUMsUUFBUSxDQUFDO29CQUNaLEtBQUssRUFBRSxrQkFBa0I7b0JBQ3pCLElBQUksRUFBRSxPQUFPO2lCQUNkLENBQUMsQ0FBQTtZQUNKLENBQUM7UUFDSCxDQUFDO0lBQ0gsQ0FBQztJQUVELEtBQUssQ0FBQyx1QkFBdUI7UUFDM0IsSUFBSSxDQUFDO1lBQ0gsTUFBTSxPQUFPLEdBQUcsSUFBSSxDQUFDLGNBQWMsQ0FBQTtZQUNuQyxNQUFNLE9BQU8sR0FBRyxPQUFPLENBQUMsQ0FBQyxDQUFDLE9BQU8sQ0FBQyxPQUFPLENBQUMsQ0FBQyxDQUFDLElBQUksQ0FBQTtZQUVoRCxJQUFJLE9BQU8sRUFBRSxDQUFDO2dCQUNaLE1BQU0sT0FBTyxDQUFDLEVBQUMsT0FBTyxFQUFFLElBQUksRUFBQyxDQUFDLENBQUE7WUFDaEMsQ0FBQztRQUNILENBQUM7UUFBQyxPQUFPLFdBQVcsRUFBRSxDQUFDO1lBQ3JCLE1BQU0sS0FBSyxHQUFHLElBQUksQ0FBQyw4QkFBOEIsQ0FBQyxXQUFXLEVBQUU7Z0JBQzdELEtBQUssRUFBRSxpQ0FBaUM7YUFDekMsQ0FBQyxDQUFBO1lBRUYsSUFBSSxDQUFDLE1BQU0sQ0FBQyxLQUFLLENBQUMsR0FBRyxFQUFFLENBQUMsQ0FBQyxnQ0FBZ0MsRUFBRSxLQUFLLENBQUMsQ0FBQyxDQUFBO1FBQ3BFLENBQUM7SUFDSCxDQUFDO0lBRUQ7OztPQUdHO0lBQ0gsYUFBYTtRQUNYLE9BQU8sSUFBSSxDQUFDLGNBQWMsRUFBRSxhQUFhLEVBQUUsSUFBSSxJQUFJLENBQUMsTUFBTSxDQUFDLGFBQWEsQ0FBQTtJQUMxRSxDQUFDO0lBRUQ7Ozs7T0FJRztJQUNILGlCQUFpQixDQUFDLE9BQU87UUFDdkIsSUFBSSxDQUFDLGNBQWMsR0FBRyxPQUFPLENBQUE7UUFDN0IsS0FBSyxJQUFJLENBQUMsc0JBQXNCLEVBQUUsQ0FBQTtJQUNwQyxDQUFDO0lBRUQsS0FBSyxDQUFDLDZCQUE2QjtRQUNqQyxJQUFJLENBQUMsSUFBSSxDQUFDLHFCQUFxQjtZQUFFLE9BQU07UUFFdkMsb0ZBQW9GO1FBQ3BGLElBQUksT0FBTyxDQUFBO1FBRVgsSUFBSSxDQUFDO1lBQ0gsT0FBTyxHQUFHLE1BQU0sSUFBSSxDQUFDLHFCQUFxQixDQUFBO1FBQzVDLENBQUM7UUFBQyxPQUFPLFdBQVcsRUFBRSxDQUFDO1lBQ3JCLE1BQU0sS0FBSyxHQUFHLElBQUksQ0FBQyw4QkFBOEIsQ0FBQyxXQUFXLEVBQUU7Z0JBQzdELEtBQUssRUFBRSxvQ0FBb0M7YUFDNUMsQ0FBQyxDQUFBO1lBRUYsSUFBSSxDQUFDLE1BQU0sQ0FBQyxLQUFLLENBQUMsR0FBRyxFQUFFLENBQUMsQ0FBQywyQ0FBMkMsRUFBRSxLQUFLLENBQUMsQ0FBQyxDQUFBO1lBQzdFLElBQUksQ0FBQyxxQkFBcUIsR0FBRyxTQUFTLENBQUE7WUFDdEMsTUFBTSxJQUFJLENBQUMsK0JBQStCLENBQUMsRUFBQyxVQUFVLEVBQUUsS0FBSyxFQUFDLENBQUMsQ0FBQTtZQUMvRCxPQUFNO1FBQ1IsQ0FBQztRQUVELElBQUksQ0FBQyxxQkFBcUIsR0FBRyxTQUFTLENBQUE7UUFDdEMsSUFBSSxDQUFDLE9BQU8sRUFBRSxDQUFDO1lBQ2IsTUFBTSxJQUFJLENBQUMsK0JBQStCLENBQUMsRUFBQyxVQUFVLEVBQUUsS0FBSyxFQUFDLENBQUMsQ0FBQTtZQUMvRCxPQUFNO1FBQ1IsQ0FBQztRQUVELElBQUksSUFBSSxDQUFDLGNBQWMsRUFBRSxDQUFDO1lBQ3hCLElBQUksQ0FBQyxxQkFBcUIsR0FBRyxLQUFLLENBQUE7WUFDbEMsT0FBTTtRQUNSLENBQUM7UUFFRCwyREFBMkQ7UUFDM0QsaUVBQWlFO1FBQ2pFLDZEQUE2RDtRQUM3RCx3REFBd0Q7UUFDeEQsNkRBQTZEO1FBQzdELFNBQVM7UUFDVCxJQUFJLENBQUMsY0FBYyxHQUFHLE9BQU8sQ0FBQTtRQUM3QixNQUFNLElBQUksQ0FBQyxzQkFBc0IsRUFBRSxDQUFBO1FBQ25DLE1BQU0sSUFBSSxDQUFDLCtCQUErQixDQUFDO1lBQ3pDLFVBQVUsRUFBRSxPQUFPLE9BQU8sQ0FBQyxTQUFTLEtBQUssVUFBVTtTQUNwRCxDQUFDLENBQUE7SUFDSixDQUFDO0lBRUQ7Ozs7T0FJRztJQUNILEtBQUssQ0FBQywrQkFBK0IsQ0FBQyxFQUFDLFVBQVUsRUFBQztRQUNoRCxNQUFNLFFBQVEsR0FBRyxJQUFJLENBQUMsYUFBYSxDQUFBO1FBQ25DLE1BQU0sS0FBSyxHQUFHLFFBQVEsQ0FBQyxJQUFJLENBQUMsS0FBSyxJQUFJLEVBQUU7WUFDckMsSUFBSSxDQUFDLHFCQUFxQixHQUFHLEtBQUssQ0FBQTtZQUNsQyxJQUFJLElBQUksQ0FBQyxjQUFjLEVBQUUsQ0FBQztnQkFDeEIsSUFBSSxDQUFDLFlBQVksR0FBRyxFQUFFLENBQUE7Z0JBQ3RCLE9BQU07WUFDUixDQUFDO1lBRUQsTUFBTSxJQUFJLENBQUMsb0JBQW9CLENBQUMsRUFBQyxVQUFVLEVBQUMsQ0FBQyxDQUFBO1FBQy9DLENBQUMsQ0FBQyxDQUFBO1FBRUYsSUFBSSxDQUFDLGFBQWEsR0FBRyxLQUFLLENBQUMsS0FBSyxDQUFDLEdBQUcsRUFBRSxHQUFFLENBQUMsQ0FBQyxDQUFBO1FBQzFDLE1BQU0sS0FBSyxDQUFBO0lBQ2IsQ0FBQztJQUVEOzs7O09BSUc7SUFDSCxLQUFLLENBQUMsb0JBQW9CLENBQUMsRUFBQyxVQUFVLEVBQUM7UUFDckMsSUFBSSxJQUFJLENBQUMsWUFBWSxDQUFDLE1BQU0sS0FBSyxDQUFDO1lBQUUsT0FBTTtRQUUxQyxNQUFNLE1BQU0sR0FBRyxJQUFJLENBQUMsWUFBWSxDQUFBO1FBQ2hDLElBQUksQ0FBQyxZQUFZLEdBQUcsRUFBRSxDQUFBO1FBRXRCLEtBQUssTUFBTSxJQUFJLElBQUksTUFBTSxFQUFFLENBQUM7WUFDMUIsSUFBSSxJQUFJLENBQUMsY0FBYyxFQUFFLENBQUM7Z0JBQ3hCLElBQUksQ0FBQyx3QkFBd0IsQ0FBQyxJQUFJLENBQUMsU0FBUyxDQUFDLENBQUE7Z0JBQzdDLFNBQVE7WUFDVixDQUFDO1lBRUQsSUFBSSxDQUFDO2dCQUNILElBQUksVUFBVSxJQUFJLElBQUksQ0FBQyxjQUFjLEVBQUUsQ0FBQztvQkFDdEMsTUFBTSxJQUFJLENBQUMseUJBQXlCLENBQUMsSUFBSSxDQUFDLE9BQU8sRUFBRSxLQUFLLElBQUksRUFBRTt3QkFDNUQsTUFBTSxJQUFJLENBQUMseUJBQXlCLENBQUMsSUFBSSxDQUFDLE9BQU8sQ0FBQyxDQUFBO29CQUNwRCxDQUFDLENBQUMsQ0FBQTtnQkFDSixDQUFDO3FCQUFNLENBQUM7b0JBQ04sTUFBTSxJQUFJLENBQUMsZ0JBQWdCLENBQUMsSUFBSSxDQUFDLE9BQU8sQ0FBQyxDQUFBO2dCQUMzQyxDQUFDO1lBQ0gsQ0FBQztZQUFDLE9BQU8sV0FBVyxFQUFFLENBQUM7Z0JBQ3JCLE1BQU0sa0JBQWtCLEdBQUcsV0FBVyxZQUFZLEtBQUssQ0FBQyxDQUFDLENBQUMsV0FBVyxDQUFDLE9BQU8sQ0FBQyxDQUFDLENBQUMsTUFBTSxDQUFDLFdBQVcsQ0FBQyxDQUFBO2dCQUNuRyxNQUFNLEtBQUssR0FBRyxJQUFJLENBQUMsOEJBQThCLENBQUMsV0FBVyxFQUFFO29CQUM3RCxLQUFLLEVBQUUsNEJBQTRCO2lCQUNwQyxDQUFDLENBQUE7Z0JBRUYsSUFBSSxDQUFDLE1BQU0sQ0FBQyxLQUFLLENBQUMsR0FBRyxFQUFFLENBQUMsQ0FBQyxrQ0FBa0MsRUFBRSxLQUFLLENBQUMsQ0FBQyxDQUFBO2dCQUNwRSxJQUFJLENBQUMsUUFBUSxDQUFDO29CQUNaLEtBQUssRUFBRSxrQkFBa0I7b0JBQ3pCLElBQUksRUFBRSxPQUFPO2lCQUNkLENBQUMsQ0FBQTtZQUNKLENBQUM7b0JBQVMsQ0FBQztnQkFDVCxJQUFJLENBQUMsd0JBQXdCLENBQUMsSUFBSSxDQUFDLFNBQVMsQ0FBQyxDQUFBO1lBQy9DLENBQUM7UUFDSCxDQUFDO0lBQ0gsQ0FBQztDQUNGIiwic291cmNlc0NvbnRlbnQiOlsiLy8gQHRzLWNoZWNrXG5cbmltcG9ydCB7IHJhbmRvbVVVSUQgfSBmcm9tIFwibm9kZTpjcnlwdG9cIlxuaW1wb3J0IHsgZW5zdXJlRXJyb3IgfSBmcm9tIFwidHlwYW5pY1wiXG5cbmltcG9ydCB7IFZhbGlkYXRpb25FcnJvciB9IGZyb20gXCIuLi8uLi9kYXRhYmFzZS9yZWNvcmQvaW5kZXguanNcIlxuaW1wb3J0IExvZ2dlciBmcm9tIFwiLi4vLi4vbG9nZ2VyLmpzXCJcbmltcG9ydCBFdmVudEVtaXR0ZXIgZnJvbSBcIi4uLy4uL3V0aWxzL2V2ZW50LWVtaXR0ZXIuanNcIlxuaW1wb3J0IGlzUGxhaW5PYmplY3QgZnJvbSBcIi4uLy4uL3V0aWxzL3BsYWluLW9iamVjdC5qc1wiXG5pbXBvcnQgVmVsb2Npb3VzRXJyb3IgZnJvbSBcIi4uLy4uL3ZlbG9jaW91cy1lcnJvci5qc1wiXG5pbXBvcnQgV2Vic29ja2V0Q2hhbm5lbCBmcm9tIFwiLi4vd2Vic29ja2V0LWNoYW5uZWwuanNcIlxuaW1wb3J0IHsgd2Vic29ja2V0RXZlbnRMb2dTdG9yZUZvckNvbmZpZ3VyYXRpb24gfSBmcm9tIFwiLi4vd2Vic29ja2V0LWV2ZW50LWxvZy1zdG9yZS5qc1wiXG5pbXBvcnQgUmVxdWVzdFJ1bm5lciBmcm9tIFwiLi9yZXF1ZXN0LXJ1bm5lci5qc1wiXG5pbXBvcnQgUmVxdWVzdFRpbWluZyBmcm9tIFwiLi9yZXF1ZXN0LXRpbWluZy5qc1wiXG5pbXBvcnQgV2Vic29ja2V0UmVxdWVzdCBmcm9tIFwiLi93ZWJzb2NrZXQtcmVxdWVzdC5qc1wiXG5cbi8qKlxuICogRGVmaW5lcyB0aGlzIHR5cGVkZWYuXG4gKiBAdHlwZWRlZiB7e3R5cGU6IFwic3Vic2NyaWJlXCIsIGNoYW5uZWw6IHN0cmluZywgbGFzdEV2ZW50SWQ/OiBzdHJpbmcsIHBhcmFtcz86IFJlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gfCB7dHlwZTogXCJtZXRhZGF0YVwiLCBkYXRhPzogUmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSB8IHt0eXBlPzogXCJyZXF1ZXN0XCIsIGJvZHk/OiBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPiwgaGVhZGVycz86IFJlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+PiwgaWQ/OiBzdHJpbmcgfCBudW1iZXIgfCBudWxsLCBtZXRob2Q6IHN0cmluZywgcGF0aDogc3RyaW5nfSB8IFJlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gV2Vic29ja2V0U2Vzc2lvbk1lc3NhZ2VcbiAqL1xuXG4vKipcbiAqIEB0eXBlZGVmIHtvYmplY3R9IEluYm91bmRNZXNzYWdlQWRtaXNzaW9uXG4gKiBAcHJvcGVydHkge251bWJlcn0gYnl0ZUxlbmd0aCAtIEV4YWN0IHJhdyB0ZXh0IHBheWxvYWQgYnl0ZXMgY2hhcmdlZCB0byB0aGlzIGFkbWlzc2lvbi5cbiAqIEBwcm9wZXJ0eSB7bnVtYmVyfSBnZW5lcmF0aW9uIC0gQWNjb3VudGluZyBnZW5lcmF0aW9uIGFjdGl2ZSB3aGVuIGFkbWl0dGVkLlxuICogQHByb3BlcnR5IHtib29sZWFufSByZWxlYXNlZCAtIFdoZXRoZXIgdGhpcyBhZG1pc3Npb24gaGFzIGFscmVhZHkgYmVlbiByZWxlYXNlZC5cbiAqL1xuXG4vKipcbiAqIEB0eXBlZGVmIHtvYmplY3R9IEluYm91bmRNZXNzYWdlV29ya1xuICogQHByb3BlcnR5IHtJbmJvdW5kTWVzc2FnZUFkbWlzc2lvbn0gYWRtaXNzaW9uIC0gQWRtaXNzaW9uIG93bmVyc2hpcC5cbiAqIEBwcm9wZXJ0eSB7V2Vic29ja2V0U2Vzc2lvbk1lc3NhZ2V9IG1lc3NhZ2UgLSBEZWNvZGVkIGNsaWVudCBtZXNzYWdlLlxuICovXG5cbmNvbnN0IFdFQlNPQ0tFVF9GSU5BTF9GUkFNRSA9IDB4ODBcbmNvbnN0IFdFQlNPQ0tFVF9PUENPREVfQ09OVElOVUFUSU9OID0gMHgwXG5jb25zdCBXRUJTT0NLRVRfT1BDT0RFX1RFWFQgPSAweDFcbmNvbnN0IFdFQlNPQ0tFVF9PUENPREVfQklOQVJZID0gMHgyXG5jb25zdCBXRUJTT0NLRVRfT1BDT0RFX0NMT1NFID0gMHg4XG5jb25zdCBXRUJTT0NLRVRfT1BDT0RFX1BJTkcgPSAweDlcbmNvbnN0IFdFQlNPQ0tFVF9PUENPREVfUE9ORyA9IDB4QVxuXG5jb25zdCBXRUJTT0NLRVRfQ0xPU0VfTk9STUFMID0gMTAwMFxuY29uc3QgV0VCU09DS0VUX0NMT1NFX1BPTElDWV9WSU9MQVRJT04gPSAxMDA4XG5jb25zdCBXRUJTT0NLRVRfSU5CT1VORF9CQUNLTE9HX0NMT1NFX1JFQVNPTiA9IFwiSW5ib3VuZCBtZXNzYWdlIGJhY2tsb2cgZXhjZWVkZWRcIlxuY29uc3QgV0VCU09DS0VUX01BWF9DTE9TRV9SRUFTT05fQllURVMgPSAxMjNcblxuLyoqIENhcCBvbiB0aGUgcGF1c2VkIG91dGJvdW5kIHF1ZXVlOyBvbGRlc3QgZnJhbWVzIGRyb3Agb24gb3ZlcmZsb3cuICovXG5jb25zdCBXRUJTT0NLRVRfUEFVU0VEX1FVRVVFX0NBUCA9IDEwMDBcblxuLyoqIENhcCBvbiB0b3RhbCBieXRlcyBidWZmZXJlZCBmb3IgYSBzaW5nbGUgZnJhZ21lbnRlZCBtZXNzYWdlLiAqL1xuY29uc3QgV0VCU09DS0VUX01BWF9GUkFHTUVOVEVEX01FU1NBR0VfQllURVMgPSAxNiAqIDEwMjQgKiAxMDI0XG5cbi8qKiBDYXAgb24gcGF5bG9hZCBieXRlcyBidWZmZXJlZCBmb3IgYSBzaW5nbGUgZmluYWwgZGF0YSBmcmFtZS4gKi9cbmNvbnN0IFdFQlNPQ0tFVF9NQVhfRklOQUxfRlJBTUVfQllURVMgPSBXRUJTT0NLRVRfTUFYX0ZSQUdNRU5URURfTUVTU0FHRV9CWVRFU1xuXG5jb25zdCBXRUJTT0NLRVRfTUFYX0lOQk9VTkRfRlJBTUVfQllURVNfQklHSU5UID0gQmlnSW50KFdFQlNPQ0tFVF9NQVhfRklOQUxfRlJBTUVfQllURVMpXG5cbi8qKiBDYXAgb24gZnJhZ21lbnQgY291bnQgZm9yIGEgc2luZ2xlIGZyYWdtZW50ZWQgbWVzc2FnZS4gKi9cbmNvbnN0IFdFQlNPQ0tFVF9NQVhfRlJBR01FTlRFRF9NRVNTQUdFX0ZSQUdNRU5UUyA9IDEwMjRcblxuLyoqXG4gKiBSdW5zIHN1YnNjcmliZSBtZXNzYWdlLlxuICogQHBhcmFtIHtXZWJzb2NrZXRTZXNzaW9uTWVzc2FnZX0gbWVzc2FnZSAtIFJhdyB3ZWJzb2NrZXQgbWVzc2FnZS5cbiAqIEByZXR1cm5zIHt7dHlwZTogXCJzdWJzY3JpYmVcIiwgY2hhbm5lbDogc3RyaW5nLCBsYXN0RXZlbnRJZD86IHN0cmluZywgcGFyYW1zPzogUmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSB8IG51bGx9IC0gU3Vic2NyaWJlIG1lc3NhZ2Ugd2hlbiBtYXRjaGVkLlxuICovXG5mdW5jdGlvbiBzdWJzY3JpYmVNZXNzYWdlKG1lc3NhZ2UpIHtcbiAgcmV0dXJuIG1lc3NhZ2UudHlwZSA9PT0gXCJzdWJzY3JpYmVcIlxuICAgID8gLyoqIEB0eXBlIHt7dHlwZTogXCJzdWJzY3JpYmVcIiwgY2hhbm5lbDogc3RyaW5nLCBsYXN0RXZlbnRJZD86IHN0cmluZywgcGFyYW1zPzogUmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fX0gKi8gKG1lc3NhZ2UpXG4gICAgOiBudWxsXG59XG5cbi8qKlxuICogUnVucyByZXF1ZXN0IG1lc3NhZ2UuXG4gKiBAcGFyYW0ge1dlYnNvY2tldFNlc3Npb25NZXNzYWdlfSBtZXNzYWdlIC0gUmF3IHdlYnNvY2tldCBtZXNzYWdlLlxuICogQHJldHVybnMge3t0eXBlPzogXCJyZXF1ZXN0XCIsIGJvZHk/OiBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPiwgaGVhZGVycz86IFJlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+PiwgaWQ/OiBzdHJpbmcgfCBudW1iZXIgfCBudWxsLCBtZXRob2Q6IHN0cmluZywgcGF0aDogc3RyaW5nfSB8IG51bGx9IC0gUmVxdWVzdCBtZXNzYWdlIHdoZW4gbWF0Y2hlZC5cbiAqL1xuZnVuY3Rpb24gcmVxdWVzdE1lc3NhZ2UobWVzc2FnZSkge1xuICBpZiAobWVzc2FnZS50eXBlICYmIG1lc3NhZ2UudHlwZSAhPT0gXCJyZXF1ZXN0XCIpIHJldHVybiBudWxsXG5cbiAgcmV0dXJuIC8qKiBAdHlwZSB7e3R5cGU/OiBcInJlcXVlc3RcIiwgYm9keT86IFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+LCBoZWFkZXJzPzogUmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+LCBpZD86IHN0cmluZyB8IG51bWJlciB8IG51bGwsIG1ldGhvZDogc3RyaW5nLCBwYXRoOiBzdHJpbmd9fSAqLyAobWVzc2FnZSlcbn1cblxuLyoqXG4gKiBDb21wYXJlcyB0d28gaWRlbnRpdHkgdmFsdWVzIGZyb20gYGdldFdlYnNvY2tldFNlc3Npb25JZGVudGl0eVJlc29sdmVyYC5cbiAqIE51bGxpc2ggdmFsdWVzIGNvbXBhcmUgZXF1YWwgdG8gZWFjaCBvdGhlciBidXQgbm90IHRvIGEgcmVhbCBpZGVudGl0eS5cbiAqIFBsYWluIG9iamVjdHMgYXJlIGNvbXBhcmVkIHZpYSBKU09OIHJvdW5kLXRyaXAgc28gYXBwcyBjYW4gcmV0dXJuIGFcbiAqIGB7dXNlcklkLCB0ZW5hbnRJZH1gLXN0eWxlIG9iamVjdCB3aXRob3V0IGJ1aWxkaW5nIHRoZWlyIG93biBlcXVhbGl0eS5cbiAqIEBwYXJhbSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59IGEgLSBQYXVzZWQtdGltZSBpZGVudGl0eS5cbiAqIEBwYXJhbSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59IGIgLSBSZXN1bWUtdGltZSBpZGVudGl0eS5cbiAqIEByZXR1cm5zIHtib29sZWFufSAtIFRydWUgd2hlbiB0aGUgdHdvIGlkZW50aXRpZXMgYXJlIGNvbnNpZGVyZWQgdGhlIHNhbWUgY2FsbGVyLlxuICovXG5mdW5jdGlvbiBpZGVudGl0aWVzTWF0Y2goYSwgYikge1xuICBpZiAoYSA9PT0gYikgcmV0dXJuIHRydWVcbiAgaWYgKGEgPT0gbnVsbCB8fCBiID09IG51bGwpIHJldHVybiBmYWxzZVxuICBpZiAodHlwZW9mIGEgIT09IFwib2JqZWN0XCIgfHwgdHlwZW9mIGIgIT09IFwib2JqZWN0XCIpIHJldHVybiBmYWxzZVxuXG4gIHRyeSB7XG4gICAgcmV0dXJuIEpTT04uc3RyaW5naWZ5KGEpID09PSBKU09OLnN0cmluZ2lmeShiKVxuICB9IGNhdGNoIHtcbiAgICByZXR1cm4gZmFsc2VcbiAgfVxufVxuXG5leHBvcnQgZGVmYXVsdCBjbGFzcyBWZWxvY2lvdXNIdHRwU2VydmVyQ2xpZW50V2Vic29ja2V0U2Vzc2lvbiB7XG4gIGV2ZW50cyA9IG5ldyBFdmVudEVtaXR0ZXIoKVxuICBzdWJzY3JpcHRpb25zID0gbmV3IFNldCgpXG4gIGNoYW5uZWxzID0gbmV3IFNldCgpXG4gIHN1YnNjcmlwdGlvbkhhbmRsZXJzID0gbmV3IE1hcCgpXG4gIGhhbmRsZXJTdWJzY3JpcHRpb25zID0gbmV3IE1hcCgpXG4gIGNoYW5uZWxUZW5hbnRzID0gbmV3IE1hcCgpXG4gIGNoYW5uZWxSZXBsYXlTdGF0ZXMgPSBuZXcgTWFwKClcbiAgLyoqXG4gICAqIE1lc3NhZ2UgcXVldWUuXG4gICAqIEB0eXBlIHtJbmJvdW5kTWVzc2FnZVdvcmtbXX0gKi9cbiAgbWVzc2FnZVF1ZXVlID0gW11cblxuICAvKipcbiAgICogUnVucyBjb25zdHJ1Y3Rvci5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBPcHRpb25zIG9iamVjdC5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi8uLi9jb25maWd1cmF0aW9uLmpzXCIpLmRlZmF1bHR9IGFyZ3MuY29uZmlndXJhdGlvbiAtIENvbmZpZ3VyYXRpb24gaW5zdGFuY2UuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi9pbmRleC5qc1wiKS5kZWZhdWx0fSBhcmdzLmNsaWVudCAtIENsaWVudCBpbnN0YW5jZS5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL3JlcXVlc3QuanNcIikuZGVmYXVsdCB8IGltcG9ydChcIi4vd2Vic29ja2V0LXJlcXVlc3QuanNcIikuZGVmYXVsdH0gW2FyZ3MudXBncmFkZVJlcXVlc3RdIC0gSW5pdGlhbCB3ZWJzb2NrZXQgdXBncmFkZSByZXF1ZXN0LlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uLy4uL2NvbmZpZ3VyYXRpb24tdHlwZXMuanNcIikuV2Vic29ja2V0TWVzc2FnZUhhbmRsZXJ9IFthcmdzLm1lc3NhZ2VIYW5kbGVyXSAtIE9wdGlvbmFsIHJhdyBtZXNzYWdlIGhhbmRsZXIuXG4gICAqIEBwYXJhbSB7UHJvbWlzZTxpbXBvcnQoXCIuLi8uLi9jb25maWd1cmF0aW9uLXR5cGVzLmpzXCIpLldlYnNvY2tldE1lc3NhZ2VIYW5kbGVyIHwgdm9pZD59IFthcmdzLm1lc3NhZ2VIYW5kbGVyUHJvbWlzZV0gLSBPcHRpb25hbCByYXcgbWVzc2FnZSBoYW5kbGVyIHByb21pc2UuXG4gICAqL1xuICBjb25zdHJ1Y3Rvcih7Y2xpZW50LCBjb25maWd1cmF0aW9uLCB1cGdyYWRlUmVxdWVzdCwgbWVzc2FnZUhhbmRsZXIsIG1lc3NhZ2VIYW5kbGVyUHJvbWlzZX0pIHtcbiAgICAvKiogQHR5cGUge0J1ZmZlcltdfSAqL1xuICAgIHRoaXMuX2J1ZmZlckNodW5rcyA9IFtdXG4gICAgdGhpcy5fYnVmZmVyQ2h1bmtJbmRleCA9IDBcbiAgICB0aGlzLl9idWZmZXJDaHVua09mZnNldCA9IDBcbiAgICB0aGlzLl9idWZmZXJlZEJ5dGVzID0gMFxuICAgIHRoaXMuX2J1ZmZlcmVkRnJhbWVDb3B5Qnl0ZXMgPSAwXG4gICAgdGhpcy5jbGllbnQgPSBjbGllbnRcbiAgICB0aGlzLmNvbmZpZ3VyYXRpb24gPSBjb25maWd1cmF0aW9uXG4gICAgdGhpcy51cGdyYWRlUmVxdWVzdCA9IHVwZ3JhZGVSZXF1ZXN0XG4gICAgdGhpcy5tZXNzYWdlSGFuZGxlciA9IG1lc3NhZ2VIYW5kbGVyXG4gICAgdGhpcy5tZXNzYWdlSGFuZGxlclByb21pc2UgPSBtZXNzYWdlSGFuZGxlclByb21pc2VcbiAgICB0aGlzLnBlbmRpbmdNZXNzYWdlSGFuZGxlciA9IEJvb2xlYW4obWVzc2FnZUhhbmRsZXJQcm9taXNlKVxuICAgIHRoaXMubG9nZ2VyID0gbmV3IExvZ2dlcih0aGlzKVxuICAgIGNvbnN0IGluYm91bmRRdWV1ZUxpbWl0cyA9IHRoaXMuY29uZmlndXJhdGlvbi5nZXRXZWJzb2NrZXRJbmJvdW5kUXVldWVMaW1pdHMoKVxuXG4gICAgdGhpcy5faW5ib3VuZE1heFBlbmRpbmdCeXRlcyA9IGluYm91bmRRdWV1ZUxpbWl0cy5tYXhCeXRlc1xuICAgIHRoaXMuX2luYm91bmRNYXhQZW5kaW5nTWVzc2FnZXMgPSBpbmJvdW5kUXVldWVMaW1pdHMubWF4TWVzc2FnZXNcbiAgICB0aGlzLl9pbmJvdW5kUGVuZGluZ0J5dGVzID0gMFxuICAgIHRoaXMuX2luYm91bmRQZW5kaW5nTWVzc2FnZXMgPSAwXG4gICAgdGhpcy5faW5ib3VuZEFjY291bnRpbmdHZW5lcmF0aW9uID0gMFxuICAgIHRoaXMuX2luYm91bmRDbG9zZWQgPSBmYWxzZVxuICAgIHRoaXMuX2luYm91bmRCYWNrbG9nT3ZlcmxvYWRlZCA9IGZhbHNlXG5cbiAgICAvKipcbiAgICAgKiBOYXJyb3dzIHRoZSBydW50aW1lIHZhbHVlIHRvIHRoZSBkb2N1bWVudGVkIHR5cGUuXG4gICAgICogQHR5cGUge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gKi9cbiAgICB0aGlzLl9tZXRhZGF0YSA9IHt9XG5cbiAgICAvKipcbiAgICAgKiBMb25nLWxpdmVkIHBlci1zZXNzaW9uIHN0YXRlIGJhZy4gU3RhYmxlIGFjcm9zcyByZWNvbm5lY3RzIG9uY2VcbiAgICAgKiBncmFjZS1wZXJpb2QgcmVzdW1wdGlvbiBsYW5kcyBpbiBQaGFzZSAyOyB0b2RheSBpdCBqdXN0IGxpdmVzXG4gICAgICogZm9yIHRoZSBkdXJhdGlvbiBvZiB0aGUgdW5kZXJseWluZyBzb2NrZXQuXG4gICAgICogQHR5cGUge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn1cbiAgICAgKi9cbiAgICB0aGlzLmRhdGEgPSB7fVxuXG4gICAgLyoqXG4gICAgICogTmFycm93cyB0aGUgcnVudGltZSB2YWx1ZSB0byB0aGUgZG9jdW1lbnRlZCB0eXBlLlxuICAgICAqIEB0eXBlIHtNYXA8c3RyaW5nLCBpbXBvcnQoXCIuLi93ZWJzb2NrZXQtY29ubmVjdGlvbi5qc1wiKS5kZWZhdWx0Pn0gKi9cbiAgICB0aGlzLl9jb25uZWN0aW9ucyA9IG5ldyBNYXAoKVxuXG4gICAgLyoqXG4gICAgICogTmFycm93cyB0aGUgcnVudGltZSB2YWx1ZSB0byB0aGUgZG9jdW1lbnRlZCB0eXBlLlxuICAgICAqIEB0eXBlIHtNYXA8c3RyaW5nLCB7Y2hhbm5lbFR5cGU6IHN0cmluZywgc3Vic2NyaXB0aW9uOiBpbXBvcnQoXCIuLi93ZWJzb2NrZXQtY2hhbm5lbC5qc1wiKS5kZWZhdWx0fT59ICovXG4gICAgdGhpcy5fY2hhbm5lbFN1YnNjcmlwdGlvbnMgPSBuZXcgTWFwKClcblxuICAgIC8qKlxuICAgICAqIFVuaXF1ZSBpZCBhc3NpZ25lZCB0byB0aGlzIHNlc3Npb24gb24gZmlyc3QgY29ubmVjdC4gU2VudCB0byB0aGVcbiAgICAgKiBjbGllbnQgdmlhIGBzZXNzaW9uLWVzdGFibGlzaGVkYDsgdGhlIGNsaWVudCBlY2hvZXMgaXQgYmFjayB2aWFcbiAgICAgKiBgc2Vzc2lvbi1yZXN1bWVgIGFmdGVyIGEgV1MgZHJvcCB0byByZWF0dGFjaCB0byB0aGlzIHNlc3Npb25cbiAgICAgKiB3aXRoaW4gdGhlIGdyYWNlIHBlcmlvZC5cbiAgICAgKiBAdHlwZSB7c3RyaW5nfVxuICAgICAqL1xuICAgIHRoaXMuc2Vzc2lvbklkID0gcmFuZG9tVVVJRCgpXG5cbiAgICAvKipcbiAgICAgKiBOYXJyb3dzIHRoZSBydW50aW1lIHZhbHVlIHRvIHRoZSBkb2N1bWVudGVkIHR5cGUuXG4gICAgICogQHR5cGUge2Jvb2xlYW59IC0gdHJ1ZSBhZnRlciBgX2hhbmRsZUNsb3NlYCBwYXVzZXMgaW5zdGVhZCBvZiB0ZWFyaW5nIGRvd24uXG4gICAgICovXG4gICAgdGhpcy5fcGF1c2VkID0gZmFsc2VcblxuICAgIC8qKlxuICAgICAqIE5hcnJvd3MgdGhlIHJ1bnRpbWUgdmFsdWUgdG8gdGhlIGRvY3VtZW50ZWQgdHlwZS5cbiAgICAgKiBAdHlwZSB7QXJyYXk8UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSAtIGZyYW1lcyBwcm9kdWNlZCB3aGlsZSBwYXVzZWQ7IGZsdXNoZWQgb24gcmVzdW1lLlxuICAgICAqL1xuICAgIHRoaXMuX291dGJvdW5kUXVldWUgPSBbXVxuXG4gICAgLyoqXG4gICAgICogTmFycm93cyB0aGUgcnVudGltZSB2YWx1ZSB0byB0aGUgZG9jdW1lbnRlZCB0eXBlLlxuICAgICAqIEB0eXBlIHtpbXBvcnQoXCIuL2luZGV4LmpzXCIpLmRlZmF1bHQgfCBudWxsfSAqL1xuICAgIHRoaXMuc29ja2V0ID0gbnVsbFxuXG4gICAgLyoqXG4gICAgICogVGFpbCBvZiBhIHBlci1zZXNzaW9uIHByb21pc2UgY2hhaW4gdGhhdCBzZXJpYWxpemVzIG1lc3NhZ2VcbiAgICAgKiBoYW5kbGluZy4gUHJldmVudHMgcmFjZXMgd2hlcmUgbWVzc2FnZSBCIHJlYWRzIGBzZXNzaW9uLmRhdGFgXG4gICAgICogYmVmb3JlIG1lc3NhZ2UgQSdzIGhhbmRsZXIgZmluaXNoZXMgd3JpdGluZyBpdCAoZS5nLiBhXG4gICAgICogY29ubmVjdGlvbi1tZXNzYWdlIHNldHRpbmcgdGhlIGxvY2FsZSB2cy4gYSBzdWJzZXF1ZW50IHJlcXVlc3RcbiAgICAgKiB3aG9zZSBhcm91bmRSZXF1ZXN0IHdyYXBwZXIgcmVhZHMgaXQpLlxuICAgICAqIEB0eXBlIHtQcm9taXNlPHZvaWQ+fVxuICAgICAqL1xuICAgIHRoaXMuX21lc3NhZ2VDaGFpbiA9IFByb21pc2UucmVzb2x2ZSgpXG5cbiAgICAvKipcbiAgICAgKiBQcm9taXNlIHRoYXQgcmVzb2x2ZXMgdG8gdGhlIGF1dGggaWRlbnRpdHkgY2FwdHVyZWQgYXQgcGF1c2VcbiAgICAgKiB0aW1lIGJ5IGBnZXRXZWJzb2NrZXRTZXNzaW9uSWRlbnRpdHlSZXNvbHZlcmAuIEF3YWl0ZWQgYXQgcmVzdW1lXG4gICAgICogdGltZSB0byBjb21wYXJlIGFnYWluc3QgdGhlIGZyZXNoIGNhbGxlcidzIGlkZW50aXR5LiBVbmRlZmluZWRcbiAgICAgKiBvbiBhIGxpdmUgKG5vbi1wYXVzZWQpIHNlc3Npb24uXG4gICAgICogQHR5cGUge1Byb21pc2U8UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+IHwgdW5kZWZpbmVkfVxuICAgICAqL1xuICAgIHRoaXMuX3Jlc3VtZUlkZW50aXR5UHJvbWlzZSA9IHVuZGVmaW5lZFxuXG4gICAgLyoqIEB0eXBlIHtzdHJpbmcgfCBudWxsfSAqL1xuICAgIHRoaXMuX2NsYWltZWRTZXNzaW9uSWQgPSBudWxsXG5cbiAgICAvKipcbiAgICAgKiBBY2N1bXVsYXRlcyBwYXlsb2FkcyBmb3IgYSBmcmFnbWVudGVkIHdlYnNvY2tldCBtZXNzYWdlIHBlclxuICAgICAqIFJGQyA2NDU1LiBOb24tbnVsbCB3aGlsZSBtaWQtZnJhZ21lbnQ7IGNsZWFyZWQgd2hlbiB0aGUgZnJhbWVcbiAgICAgKiB3aXRoIEZJTj0xIGNvbXBsZXRlcyBhbmQgdGhlIG1lc3NhZ2UgaXMgZGlzcGF0Y2hlZC5cbiAgICAgKiBAdHlwZSB7QnVmZmVyW10gfCBudWxsfVxuICAgICAqL1xuICAgIHRoaXMuX2ZyYWdtZW50ZWRQYXlsb2FkcyA9IG51bGxcblxuICAgIC8qKlxuICAgICAqIE9wY29kZSAoVEVYVC9CSU5BUlkpIGNhcHR1cmVkIGZyb20gdGhlIGZpcnN0IGZyYW1lIG9mIGFcbiAgICAgKiBmcmFnbWVudGVkIG1lc3NhZ2UuIENvbnRpbnVhdGlvbiBmcmFtZXMgKG9wY29kZSAwKSBpbmhlcml0IGl0XG4gICAgICogYXQgcmVhc3NlbWJseSB0aW1lLlxuICAgICAqIEB0eXBlIHtudW1iZXIgfCBudWxsfVxuICAgICAqL1xuICAgIHRoaXMuX2ZyYWdtZW50ZWRPcGNvZGUgPSBudWxsXG5cbiAgICAvKipcbiAgICAgKiBSdW5uaW5nIGJ5dGUgdG90YWwgZm9yIGBfZnJhZ21lbnRlZFBheWxvYWRzYC4gVXNlZCB0byBlbmZvcmNlXG4gICAgICogYFdFQlNPQ0tFVF9NQVhfRlJBR01FTlRFRF9NRVNTQUdFX0JZVEVTYCBzbyBhIHBlZXIgY2Fubm90XG4gICAgICogZXhoYXVzdCBtZW1vcnkgYnkgc3RyZWFtaW5nIG5vbi1maW5hbCBmcmFnbWVudHMgaW5kZWZpbml0ZWx5LlxuICAgICAqIEB0eXBlIHtudW1iZXJ9XG4gICAgICovXG4gICAgdGhpcy5fZnJhZ21lbnRlZEJ5dGVzID0gMFxuXG4gICAgdGhpcy5jb25maWd1cmF0aW9uLl93ZWJzb2NrZXRTZXNzaW9ucy5hZGQodGhpcylcblxuICAgIC8qKlxuICAgICAqIEhlYXJ0YmVhdCBsaXZlbmVzcyBmbGFnLiBTZXQgdHJ1ZSBvbiBldmVyeSBpbmJvdW5kIGZyYW1lXG4gICAgICogKGluY2x1ZGluZyB0aGUgY2xpZW50J3MgYXV0by1wb25nKSBhbmQgY2xlYXJlZCBlYWNoIHRpbWUgYSBwaW5nXG4gICAgICogaXMgc2VudDsgYSBzdGlsbC1mYWxzZSBmbGFnIGF0IHRoZSBuZXh0IHRpY2sgbWVhbnMgdGhlIHNvY2tldFxuICAgICAqIGhhcyBnb25lIHNpbGVudC5cbiAgICAgKiBAdHlwZSB7Ym9vbGVhbn1cbiAgICAgKi9cbiAgICB0aGlzLl9oZWFydGJlYXRBbGl2ZSA9IHRydWVcblxuICAgIC8qKlxuICAgICAqIFBlci1zZXNzaW9uIGhlYXJ0YmVhdCBpbnRlcnZhbCBoYW5kbGUuIFN0YXJ0ZWQgZnJvbVxuICAgICAqIGBzZW5kU2Vzc2lvbkVzdGFibGlzaGVkYCBvbmNlIHRoZSBzb2NrZXQgaXMgbGl2ZSwgbm90IGF0XG4gICAgICogY29uc3RydWN0aW9uLCBzbyBkaXJlY3RseS1jb25zdHJ1Y3RlZCBzZXNzaW9ucyBpbiB0ZXN0cyBkb24ndFxuICAgICAqIHNwaW4gdXAgYSBiYWNrZ3JvdW5kIHRpbWVyLlxuICAgICAqIEB0eXBlIHtSZXR1cm5UeXBlPHR5cGVvZiBzZXRJbnRlcnZhbD4gfCBudWxsfVxuICAgICAqL1xuICAgIHRoaXMuX2hlYXJ0YmVhdFRpbWVyID0gbnVsbFxuICB9XG5cbiAgLyoqXG4gICAqIFNlbmRzIHRoZSBjbGllbnQgaXRzIHNlc3Npb25JZCArIGdyYWNlIHdpbmRvdy4gQ2FsbGVkIGJ5XG4gICAqIGBWZWxvY2lvdXNIdHRwU2VydmVyQ2xpZW50YCBhZnRlciB0aGUgV1MgdXBncmFkZSBjb21wbGV0ZXMuXG4gICAqIEByZXR1cm5zIHt2b2lkfVxuICAgKi9cbiAgc2VuZFNlc3Npb25Fc3RhYmxpc2hlZCgpIHtcbiAgICB0aGlzLl9jbGFpbU93bmVyc2hpcCgpXG4gICAgdGhpcy5zZW5kSnNvbih7XG4gICAgICB0eXBlOiBcInNlc3Npb24tZXN0YWJsaXNoZWRcIixcbiAgICAgIHNlc3Npb25JZDogdGhpcy5zZXNzaW9uSWQsXG4gICAgICBncmFjZVNlY29uZHM6IHRoaXMuY29uZmlndXJhdGlvbi5nZXRXZWJzb2NrZXRTZXNzaW9uR3JhY2VTZWNvbmRzPy4oKSB8fCAzMDBcbiAgICB9KVxuXG4gICAgLy8gVGhlIHNvY2tldCBpcyBsaXZlIG5vdywgc28gYmVnaW4gcmVhcGluZyBpdCBpZiBpdCBnb2VzIHNpbGVudC5cbiAgICB0aGlzLl9zdGFydEhlYXJ0YmVhdCgpXG4gIH1cblxuICAvKipcbiAgICogUmVtb3ZlcyBhIGNsb3NlZCBjb25uZWN0aW9uIGZyb20gdGhlIHNlc3Npb24gcmVnaXN0cnkuIENhbGxlZCBieVxuICAgKiBgVmVsb2Npb3VzV2Vic29ja2V0Q29ubmVjdGlvbi5jbG9zZSgpYCBhZnRlciBpdCBzZW5kcyB0aGUgZmluYWxcbiAgICogYGNvbm5lY3Rpb24tY2xvc2VkYCBmcmFtZS5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGNvbm5lY3Rpb25JZCAtIENsb3NlZCBjb25uZWN0aW9uIGlkZW50aWZpZXIgdG8gcmVtb3ZlLlxuICAgKiBAcmV0dXJucyB7dm9pZH1cbiAgICovXG4gIF9yZW1vdmVDb25uZWN0aW9uKGNvbm5lY3Rpb25JZCkge1xuICAgIHRoaXMuX2Nvbm5lY3Rpb25zLmRlbGV0ZShjb25uZWN0aW9uSWQpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBnZXQgbWV0YWRhdGEuXG4gICAqIEByZXR1cm5zIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59IC0gQ2xpZW50LXByb3ZpZGVkIG1ldGFkYXRhIChkZWZlbnNpdmUgY29weSkuXG4gICAqL1xuICBnZXRNZXRhZGF0YSgpIHtcbiAgICByZXR1cm4gey4uLnRoaXMuX21ldGFkYXRhfVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgaXMgcGF1c2VkLlxuICAgKiBAcmV0dXJucyB7Ym9vbGVhbn0gLSB0cnVlIHdoaWxlIHRoZSBzZXNzaW9uIGlzIGluIHRoZSBwYXVzZWQvZ3JhY2UgcmVnaXN0cnkuXG4gICAqL1xuICBpc1BhdXNlZCgpIHtcbiAgICByZXR1cm4gdGhpcy5fcGF1c2VkXG4gIH1cblxuICAvKipcbiAgICogUnVucyBhZGQgc3Vic2NyaXB0aW9uLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gY2hhbm5lbCAtIENoYW5uZWwgbmFtZS5cbiAgICogQHJldHVybnMge3ZvaWR9IC0gTm8gcmV0dXJuIHZhbHVlLlxuICAgKi9cbiAgYWRkU3Vic2NyaXB0aW9uKGNoYW5uZWwpIHtcbiAgICB0aGlzLnN1YnNjcmlwdGlvbnMuYWRkKGNoYW5uZWwpXG4gIH1cblxuICBkZXN0cm95KCkge1xuICAgIHRoaXMuX3JlbGVhc2VPd25lcnNoaXAoKVxuICAgIHRoaXMuX3N0b3BIZWFydGJlYXQoKVxuICAgIHRoaXMuX3Jlc2V0RnJhZ21lbnRCdWZmZXIoKVxuICAgIHRoaXMuX2NsZWFyQnVmZmVyZWRGcmFtZUNodW5rcygpXG4gICAgdGhpcy5fYWJhbmRvbkluYm91bmRNZXNzYWdlcygpXG4gICAgdGhpcy5jb25maWd1cmF0aW9uLl93ZWJzb2NrZXRTZXNzaW9ucy5kZWxldGUodGhpcylcbiAgICB0aGlzLl9wYXVzZWQgPSBmYWxzZVxuICAgIHZvaWQgdGhpcy5fdGVhcmRvd25DaGFubmVsKClcbiAgICB2b2lkIHRoaXMuX3RlYXJkb3duQ29ubmVjdGlvbnMoXCJzZXNzaW9uX2Rlc3Ryb3llZFwiKVxuICAgIHZvaWQgdGhpcy5fdGVhcmRvd25DaGFubmVsU3Vic2NyaXB0aW9ucygpXG4gICAgdGhpcy5ldmVudHMucmVtb3ZlQWxsTGlzdGVuZXJzKClcbiAgfVxuXG4gIC8qKiBDbGFpbXMgdGhpcyBzZXNzaW9uIGlkIGZvciBob3N0LXNpZGUgcmVjb25uZWN0IHJvdXRpbmcuICovXG4gIF9jbGFpbU93bmVyc2hpcCgpIHtcbiAgICBpZiAodGhpcy5fY2xhaW1lZFNlc3Npb25JZCA9PT0gdGhpcy5zZXNzaW9uSWQpIHJldHVyblxuICAgIGlmICh0aGlzLl9jbGFpbWVkU2Vzc2lvbklkKSB0aGlzLl9yZWxlYXNlT3duZXJzaGlwKClcblxuICAgIHRoaXMuX2NsYWltZWRTZXNzaW9uSWQgPSB0aGlzLnNlc3Npb25JZFxuICAgIHRoaXMuZXZlbnRzLmVtaXQoXCJvd25lcnNoaXBDbGFpbWVkXCIsIHtzZXNzaW9uSWQ6IHRoaXMuc2Vzc2lvbklkfSlcbiAgfVxuXG4gIC8qKiBSZWxlYXNlcyB0aGUgY3VycmVudGx5IGNsYWltZWQgc2Vzc2lvbiBpZCBleGFjdGx5IG9uY2UuICovXG4gIF9yZWxlYXNlT3duZXJzaGlwKCkge1xuICAgIGNvbnN0IHNlc3Npb25JZCA9IHRoaXMuX2NsYWltZWRTZXNzaW9uSWRcblxuICAgIGlmICghc2Vzc2lvbklkKSByZXR1cm5cblxuICAgIHRoaXMuX2NsYWltZWRTZXNzaW9uSWQgPSBudWxsXG4gICAgdGhpcy5ldmVudHMuZW1pdChcIm93bmVyc2hpcFJlbGVhc2VkXCIsIHtzZXNzaW9uSWR9KVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgaGFzIHN1YnNjcmlwdGlvbi5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGNoYW5uZWwgLSBDaGFubmVsIG5hbWUuXG4gICAqIEByZXR1cm5zIHtib29sZWFufSAtIFdoZXRoZXIgaXQgaGFzIHN1YnNjcmlwdGlvbi5cbiAgICovXG4gIGhhc1N1YnNjcmlwdGlvbihjaGFubmVsKSB7XG4gICAgcmV0dXJuIHRoaXMuc3Vic2NyaXB0aW9ucy5oYXMoY2hhbm5lbClcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIG9uIGRhdGEuXG4gICAqIEBwYXJhbSB7QnVmZmVyfSBkYXRhIC0gRGF0YSBwYXlsb2FkLlxuICAgKiBAcmV0dXJucyB7dm9pZH0gLSBObyByZXR1cm4gdmFsdWUuXG4gICAqL1xuICBvbkRhdGEoZGF0YSkge1xuICAgIC8vIEFueSBpbmJvdW5kIGJ5dGVzIOKAlCBhIGRhdGEgZnJhbWUsIHRoZSBhdXRvLXBvbmcgYW5zd2VyaW5nIG91clxuICAgIC8vIGhlYXJ0YmVhdCwgb3IgYSBwYXJ0aWFsIGZyYW1lIHN0aWxsIGJlaW5nIHVwbG9hZGVkIOKAlCBwcm92ZSB0aGVcbiAgICAvLyBzb2NrZXQgaXMgYWxpdmUuIE1hcmsgaXQgaGVyZSwgYmVmb3JlIGBfcHJvY2Vzc0J1ZmZlcmAgbWF5IHJldHVyblxuICAgIC8vIGVhcmx5IHdhaXRpbmcgZm9yIHRoZSByZXN0IG9mIGFuIGluY29tcGxldGUgZnJhbWUuXG4gICAgdGhpcy5faGVhcnRiZWF0QWxpdmUgPSB0cnVlXG4gICAgaWYgKHRoaXMuX2luYm91bmRDbG9zZWQgfHwgZGF0YS5sZW5ndGggPT09IDApIHJldHVyblxuXG4gICAgdGhpcy5fYnVmZmVyQ2h1bmtzLnB1c2goZGF0YSlcbiAgICB0aGlzLl9idWZmZXJlZEJ5dGVzICs9IGRhdGEubGVuZ3RoXG4gICAgdGhpcy5fcHJvY2Vzc0J1ZmZlcigpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBzZW5kIGV2ZW50LlxuICAgKiBAcGFyYW0ge3N0cmluZ30gY2hhbm5lbCAtIENoYW5uZWwgbmFtZS5cbiAgICogQHBhcmFtIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gcGF5bG9hZCAtIFBheWxvYWQgZGF0YS5cbiAgICogQHBhcmFtIHt7Y3JlYXRlZEF0Pzogc3RyaW5nLCBldmVudElkPzogc3RyaW5nLCByZXBsYXllZD86IGJvb2xlYW4sIHNlcXVlbmNlPzogbnVtYmVyfX0gW29wdGlvbnNdIC0gRXZlbnQgbWV0YWRhdGEuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIHdoZW4gY29tcGxldGUuXG4gICAqL1xuICBhc3luYyBzZW5kRXZlbnQoY2hhbm5lbCwgcGF5bG9hZCwgb3B0aW9ucyA9IHt9KSB7XG4gICAgY29uc3QgY2hhbm5lbEhhbmRsZXJzID0gdGhpcy5zdWJzY3JpcHRpb25IYW5kbGVycy5nZXQoY2hhbm5lbClcbiAgICBjb25zdCBoYXNDaGFubmVsSGFuZGxlcnMgPSBCb29sZWFuKGNoYW5uZWxIYW5kbGVycyAmJiBjaGFubmVsSGFuZGxlcnMuc2l6ZSA+IDApXG4gICAgY29uc3QgcmVwbGF5U3RhdGUgPSB0aGlzLmNoYW5uZWxSZXBsYXlTdGF0ZXMuZ2V0KGNoYW5uZWwpXG5cbiAgICBpZiAocmVwbGF5U3RhdGU/LnJlcGxheWluZyAmJiAhb3B0aW9ucy5yZXBsYXllZCkge1xuICAgICAgcmVwbGF5U3RhdGUuYnVmZmVyZWQgPSB0cnVlXG4gICAgICByZXR1cm5cbiAgICB9XG5cbiAgICBpZiAoIXRoaXMuaGFzU3Vic2NyaXB0aW9uKGNoYW5uZWwpICYmICFoYXNDaGFubmVsSGFuZGxlcnMpIHJldHVyblxuXG4gICAgaWYgKGhhc0NoYW5uZWxIYW5kbGVycykge1xuICAgICAgYXdhaXQgUHJvbWlzZS5hbGwoQXJyYXkuZnJvbShjaGFubmVsSGFuZGxlcnMpLm1hcChhc3luYyAoaGFuZGxlcikgPT4ge1xuICAgICAgICBjb25zdCB0ZW5hbnQgPSB0aGlzLmNoYW5uZWxUZW5hbnRzLmdldChoYW5kbGVyKVxuXG4gICAgICAgIGF3YWl0IHRoaXMuY29uZmlndXJhdGlvbi5ydW5XaXRoVGVuYW50KHRlbmFudCwgYXN5bmMgKCkgPT4ge1xuICAgICAgICAgIGF3YWl0IHRoaXMuX3dpdGhDb25uZWN0aW9ucyhhc3luYyAoKSA9PiB7XG4gICAgICAgICAgICBhd2FpdCBoYW5kbGVyLnJlY2VpdmVkQnJvYWRjYXN0KHtcbiAgICAgICAgICAgICAgY2hhbm5lbCxcbiAgICAgICAgICAgICAgY3JlYXRlZEF0OiBvcHRpb25zLmNyZWF0ZWRBdCxcbiAgICAgICAgICAgICAgZXZlbnRJZDogb3B0aW9ucy5ldmVudElkLFxuICAgICAgICAgICAgICBwYXlsb2FkLFxuICAgICAgICAgICAgICByZXBsYXllZDogb3B0aW9ucy5yZXBsYXllZCxcbiAgICAgICAgICAgICAgc2VxdWVuY2U6IG9wdGlvbnMuc2VxdWVuY2VcbiAgICAgICAgICAgIH0pXG4gICAgICAgICAgfSlcbiAgICAgICAgfSlcbiAgICAgIH0pKVxuICAgICAgcmV0dXJuXG4gICAgfVxuXG4gICAgdGhpcy5zZW5kSnNvbih7XG4gICAgICBjaGFubmVsLFxuICAgICAgY3JlYXRlZEF0OiBvcHRpb25zLmNyZWF0ZWRBdCxcbiAgICAgIGV2ZW50SWQ6IG9wdGlvbnMuZXZlbnRJZCxcbiAgICAgIHBheWxvYWQsXG4gICAgICByZXBsYXllZDogb3B0aW9ucy5yZXBsYXllZCxcbiAgICAgIHNlcXVlbmNlOiBvcHRpb25zLnNlcXVlbmNlLFxuICAgICAgdHlwZTogXCJldmVudFwiXG4gICAgfSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGluaXRpYWxpemUgY2hhbm5lbC5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgd2hlbiBjb21wbGV0ZS5cbiAgICovXG4gIGFzeW5jIGluaXRpYWxpemVDaGFubmVsKCkge1xuICAgIGlmICh0aGlzLm1lc3NhZ2VIYW5kbGVyUHJvbWlzZSkge1xuICAgICAgYXdhaXQgdGhpcy5fcmVzb2x2ZU1lc3NhZ2VIYW5kbGVyUHJvbWlzZSgpXG5cbiAgICAgIGlmICh0aGlzLm1lc3NhZ2VIYW5kbGVyKSByZXR1cm5cbiAgICB9XG5cbiAgICBpZiAodGhpcy5tZXNzYWdlSGFuZGxlcikge1xuICAgICAgYXdhaXQgdGhpcy5fcnVuTWVzc2FnZUhhbmRsZXJPcGVuKClcbiAgICAgIHJldHVyblxuICAgIH1cblxuICAgIGNvbnN0IHJlc29sdmVyID0gdGhpcy5jb25maWd1cmF0aW9uLmdldFdlYnNvY2tldENoYW5uZWxSZXNvbHZlcj8uKClcblxuICAgIGlmICghcmVzb2x2ZXIpIHJldHVyblxuXG4gICAgdHJ5IHtcbiAgICAgIGNvbnN0IHRlbmFudCA9IGF3YWl0IHRoaXMuX3Jlc29sdmVUZW5hbnQoe30pXG4gICAgICBjb25zdCByZXNvbHZlZCA9IGF3YWl0IHRoaXMuY29uZmlndXJhdGlvbi5ydW5XaXRoVGVuYW50KHRlbmFudCwgYXN5bmMgKCkgPT4ge1xuICAgICAgICByZXR1cm4gYXdhaXQgcmVzb2x2ZXIoe1xuICAgICAgICAgIGNsaWVudDogdGhpcy5jbGllbnQsXG4gICAgICAgICAgY29uZmlndXJhdGlvbjogdGhpcy5jb25maWd1cmF0aW9uLFxuICAgICAgICAgIHJlcXVlc3Q6IHRoaXMudXBncmFkZVJlcXVlc3QsXG4gICAgICAgICAgd2Vic29ja2V0U2Vzc2lvbjogdGhpc1xuICAgICAgICB9KVxuICAgICAgfSlcblxuICAgICAgaWYgKCFyZXNvbHZlZCkgcmV0dXJuXG5cbiAgICAgIGNvbnN0IGNoYW5uZWwgPSB0eXBlb2YgcmVzb2x2ZWQgPT09IFwiZnVuY3Rpb25cIlxuICAgICAgICA/IG5ldyByZXNvbHZlZCh7Y2xpZW50OiB0aGlzLmNsaWVudCwgY29uZmlndXJhdGlvbjogdGhpcy5jb25maWd1cmF0aW9uLCByZXF1ZXN0OiB0aGlzLnVwZ3JhZGVSZXF1ZXN0LCB3ZWJzb2NrZXRTZXNzaW9uOiB0aGlzfSlcbiAgICAgICAgOiByZXNvbHZlZFxuXG4gICAgICBpZiAoY2hhbm5lbCAmJiAhKGNoYW5uZWwgaW5zdGFuY2VvZiBXZWJzb2NrZXRDaGFubmVsKSkge1xuICAgICAgICB0aHJvdyBuZXcgRXJyb3IoXCJSZXNvbHZlZCB3ZWJzb2NrZXQgY2hhbm5lbCBtdXN0IGV4dGVuZCBXZWJzb2NrZXRDaGFubmVsXCIpXG4gICAgICB9XG5cbiAgICAgIGF3YWl0IHRoaXMuX3JlZ2lzdGVyQ2hhbm5lbChjaGFubmVsLCB0ZW5hbnQpXG4gICAgfSBjYXRjaCAoY2F1Z2h0RXJyb3IpIHtcbiAgICAgIGNvbnN0IGVycm9yID0gdGhpcy5fcmVwb3J0VW5leHBlY3RlZERpc3BhdGNoRXJyb3IoY2F1Z2h0RXJyb3IsIHtcbiAgICAgICAgc3RhZ2U6IFwid2Vic29ja2V0LWNoYW5uZWwtaW5pdGlhbGl6ZVwiXG4gICAgICB9KVxuXG4gICAgICB0aGlzLmxvZ2dlci5lcnJvcigoKSA9PiBbXCJGYWlsZWQgdG8gaW5pdGlhbGl6ZSB3ZWJzb2NrZXQgY2hhbm5lbFwiLCBlcnJvcl0pXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgc2VuZCBnb29kYnllLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vaW5kZXguanNcIikuZGVmYXVsdH0gY2xpZW50IC0gQ2xpZW50IGluc3RhbmNlLlxuICAgKiBAcGFyYW0ge3tjb2RlPzogbnVtYmVyLCByZWFzb24/OiBzdHJpbmd9fSBbb3B0aW9uc10gLSBPcHRpb25hbCBjbG9zZSBzdGF0dXMuXG4gICAqIEByZXR1cm5zIHt2b2lkfSAtIE5vIHJldHVybiB2YWx1ZS5cbiAgICovXG4gIHNlbmRHb29kYnllKGNsaWVudCwge2NvZGUsIHJlYXNvbiA9IFwiXCJ9ID0ge30pIHtcbiAgICBsZXQgcGF5bG9hZFxuXG4gICAgaWYgKGNvZGUgPT09IHVuZGVmaW5lZCkge1xuICAgICAgcGF5bG9hZCA9IEJ1ZmZlci5hbGxvYygwKVxuICAgIH0gZWxzZSB7XG4gICAgICBjb25zdCByZWFzb25CeXRlcyA9IEJ1ZmZlci5mcm9tKHJlYXNvbiwgXCJ1dGYtOFwiKVxuXG4gICAgICBpZiAocmVhc29uQnl0ZXMubGVuZ3RoID4gV0VCU09DS0VUX01BWF9DTE9TRV9SRUFTT05fQllURVMpIHtcbiAgICAgICAgdGhyb3cgbmV3IFJhbmdlRXJyb3IoXCJXZWJTb2NrZXQgY2xvc2UgcmVhc29uIG11c3Qgbm90IGV4Y2VlZCAxMjMgVVRGLTggYnl0ZXNcIilcbiAgICAgIH1cblxuICAgICAgcGF5bG9hZCA9IEJ1ZmZlci5hbGxvY1Vuc2FmZSgyICsgcmVhc29uQnl0ZXMubGVuZ3RoKVxuICAgICAgcGF5bG9hZC53cml0ZVVJbnQxNkJFKGNvZGUsIDApXG4gICAgICByZWFzb25CeXRlcy5jb3B5KHBheWxvYWQsIDIpXG4gICAgfVxuXG4gICAgY29uc3QgZnJhbWUgPSBCdWZmZXIuY29uY2F0KFtcbiAgICAgIEJ1ZmZlci5mcm9tKFtXRUJTT0NLRVRfRklOQUxfRlJBTUUgfCBXRUJTT0NLRVRfT1BDT0RFX0NMT1NFLCBwYXlsb2FkLmxlbmd0aF0pLFxuICAgICAgcGF5bG9hZFxuICAgIF0pXG5cbiAgICBjbGllbnQuZXZlbnRzLmVtaXQoXCJvdXRwdXRcIiwgZnJhbWUsIHt3ZWJzb2NrZXRGcmFtZTogdHJ1ZX0pXG4gIH1cblxuICAvKipcbiAgICogV2hldGhlciBhIGNhdWdodCBkaXNwYXRjaCBlcnJvciBpcyBhbiBleHBlY3RlZCBjbGllbnQtZmxvdyBmYWlsdXJlLlxuICAgKiBAcGFyYW0ge0Vycm9yfSBlcnJvciAtIE5vcm1hbGl6ZWQgZGlzcGF0Y2ggZXJyb3IuXG4gICAqIEByZXR1cm5zIHtib29sZWFufSAtIFdoZXRoZXIgZnJhbWV3b3JrIGVycm9yIHJlcG9ydGVycyBzaG91bGQgaWdub3JlIGl0LlxuICAgKi9cbiAgX2V4cGVjdGVkQ2xpZW50RXJyb3IoZXJyb3IpIHtcbiAgICBpZiAoZXJyb3IgaW5zdGFuY2VvZiBWYWxpZGF0aW9uRXJyb3IpIHJldHVybiB0cnVlXG4gICAgaWYgKGVycm9yIGluc3RhbmNlb2YgVmVsb2Npb3VzRXJyb3IgJiYgZXJyb3Iuc2FmZVRvRXhwb3NlKSByZXR1cm4gdHJ1ZVxuXG4gICAgY29uc3QgYW5ub3RhdGVkRXJyb3IgPSAvKiogQHR5cGUge0Vycm9yICYge2Vycm9yVHlwZT86IHN0cmluZywgdmVsb2Npb3VzPzogUmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fX0gKi8gKGVycm9yKVxuXG4gICAgaWYgKGlzUGxhaW5PYmplY3QoYW5ub3RhdGVkRXJyb3IudmVsb2Npb3VzKSkgcmV0dXJuIHRydWVcblxuICAgIHJldHVybiB0eXBlb2YgYW5ub3RhdGVkRXJyb3IuZXJyb3JUeXBlID09PSBcInN0cmluZ1wiICYmIGFubm90YXRlZEVycm9yLmVycm9yVHlwZS5sZW5ndGggPiAwXG4gIH1cblxuICAvKipcbiAgICogUmVwb3J0cyBvbmUgdW5leHBlY3RlZCBXZWJTb2NrZXQgZGlzcGF0Y2ggZmFpbHVyZSBhbmQgcmV0dXJucyBpdHMgcmVkYWN0ZWQgRXJyb3IgZGlhZ25vc3RpYy5cbiAgICogQHBhcmFtIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gY2F1Z2h0RXJyb3IgLSBDYXVnaHQgZGlzcGF0Y2ggZmFpbHVyZS5cbiAgICogQHBhcmFtIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59IGNvbnRleHQgLSBTdHJ1Y3R1cmVkIGRpc3BhdGNoIGNvbnRleHQuXG4gICAqIEByZXR1cm5zIHtFcnJvcn0gLSBSZWRhY3RlZCBlcnJvciBmb3IgbG9ncyBhbmQgZnJhbWV3b3JrIGVycm9yIGV2ZW50cy5cbiAgICovXG4gIF9yZXBvcnRVbmV4cGVjdGVkRGlzcGF0Y2hFcnJvcihjYXVnaHRFcnJvciwgY29udGV4dCkge1xuICAgIGNvbnN0IGVycm9yID0gZW5zdXJlRXJyb3IoY2F1Z2h0RXJyb3IpXG4gICAgY29uc3QgcmVkYWN0b3IgPSB0aGlzLmNvbmZpZ3VyYXRpb24uZ2V0TG9nUmVkYWN0b3IoKVxuICAgIGNvbnN0IHJlcXVlc3RUaW1pbmcgPSB0aGlzLmNvbmZpZ3VyYXRpb24uZ2V0Q3VycmVudFJlcXVlc3RUaW1pbmcoKVxuICAgIGxldCBzZW5zaXRpdmVWYWx1ZXMgPSByZXF1ZXN0VGltaW5nID8gcmVxdWVzdFRpbWluZy5nZXRMb2dTZW5zaXRpdmVWYWx1ZXMoKSA6IG5ldyBTZXQoKVxuXG4gICAgaWYgKHRoaXMudXBncmFkZVJlcXVlc3QpIHtcbiAgICAgIHNlbnNpdGl2ZVZhbHVlcyA9IHJlZGFjdG9yLnJlcXVlc3RTZW5zaXRpdmVWYWx1ZXModGhpcy51cGdyYWRlUmVxdWVzdCwgc2Vuc2l0aXZlVmFsdWVzKVxuICAgIH1cblxuICAgIGNvbnN0IHJlZGFjdGVkRXJyb3IgPSByZWRhY3Rvci5yZWRhY3RFcnJvcihlcnJvciwgc2Vuc2l0aXZlVmFsdWVzKVxuICAgIGNvbnN0IHJlZGFjdGVkQ29udGV4dCA9IC8qKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSAqLyAoXG4gICAgICByZWRhY3Rvci5yZWRhY3RTdHJ1Y3R1cmVkKGNvbnRleHQsIHNlbnNpdGl2ZVZhbHVlcylcbiAgICApXG5cbiAgICBpZiAodGhpcy5fZXhwZWN0ZWRDbGllbnRFcnJvcihlcnJvcikpIHJldHVybiByZWRhY3RlZEVycm9yXG5cbiAgICBjb25zdCBlcnJvclBheWxvYWQgPSB7XG4gICAgICBjb250ZXh0OiByZWRhY3RlZENvbnRleHQsXG4gICAgICBlcnJvcjogcmVkYWN0ZWRFcnJvcixcbiAgICAgIHJlcXVlc3Q6IHRoaXMudXBncmFkZVJlcXVlc3RcbiAgICB9XG4gICAgY29uc3QgZXJyb3JFdmVudHMgPSB0aGlzLmNvbmZpZ3VyYXRpb24uZ2V0RXJyb3JFdmVudHMoKVxuXG4gICAgZXJyb3JFdmVudHMuZW1pdChcImZyYW1ld29yay1lcnJvclwiLCBlcnJvclBheWxvYWQpXG4gICAgZXJyb3JFdmVudHMuZW1pdChcImFsbC1lcnJvclwiLCB7Li4uZXJyb3JQYXlsb2FkLCBlcnJvclR5cGU6IFwiZnJhbWV3b3JrLWVycm9yXCJ9KVxuXG4gICAgcmV0dXJuIHJlZGFjdGVkRXJyb3JcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGhhbmRsZSBtZXNzYWdlLlxuICAgKiBAcGFyYW0ge1dlYnNvY2tldFNlc3Npb25NZXNzYWdlfSBtZXNzYWdlIC0gTWVzc2FnZSB0ZXh0LlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyB3aGVuIGNvbXBsZXRlLlxuICAgKi9cbiAgYXN5bmMgX2hhbmRsZU1lc3NhZ2UobWVzc2FnZSkge1xuICAgIGNvbnN0IGFkbWlzc2lvbiA9IHRoaXMuX2FkbWl0SW5ib3VuZE1lc3NhZ2UoMClcblxuICAgIGlmICghYWRtaXNzaW9uKSByZXR1cm5cbiAgICBhd2FpdCB0aGlzLl9oYW5kbGVNZXNzYWdlV29yayh7YWRtaXNzaW9uLCBtZXNzYWdlfSlcbiAgfVxuXG4gIC8qKlxuICAgKiBBcHBlbmRzIGFuIGFkbWl0dGVkIG1lc3NhZ2UgdG8gdGhlIHBlci1zZXNzaW9uIEZJRk8gY2hhaW4uXG4gICAqIEBwYXJhbSB7SW5ib3VuZE1lc3NhZ2VXb3JrfSB3b3JrIC0gQWRtaXR0ZWQgZGVjb2RlZCBtZXNzYWdlLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyB3aGVuIGNvbXBsZXRlLlxuICAgKi9cbiAgYXN5bmMgX2hhbmRsZU1lc3NhZ2VXb3JrKHdvcmspIHtcbiAgICAvLyBTZXJpYWxpemUgcGVyLXNlc3Npb246IGNoYWluIG9udG8gYF9tZXNzYWdlQ2hhaW5gIHNvIG1lc3NhZ2VzXG4gICAgLy8gYXJlIHByb2Nlc3NlZCBvbmUgYXQgYSB0aW1lLiBXaXRob3V0IHRoaXMsIGZpcmUtYW5kLWZvcmdldFxuICAgIC8vIGRpc3BhdGNoIGZyb20gYF9wcm9jZXNzQnVmZmVyYCBsZXRzIG1lc3NhZ2UgQiByZWFkXG4gICAgLy8gYHNlc3Npb24uZGF0YWAgYmVmb3JlIEEgaGFzIGZpbmlzaGVkIHdyaXRpbmcgaXQuXG4gICAgY29uc3QgcHJldmlvdXMgPSB0aGlzLl9tZXNzYWdlQ2hhaW5cbiAgICBjb25zdCBuZXh0ID0gcHJldmlvdXMudGhlbigoKSA9PiB0aGlzLl9ydW5NZXNzYWdlV29yayh3b3JrKSlcblxuICAgIHRoaXMuX21lc3NhZ2VDaGFpbiA9IG5leHQuY2F0Y2goKCkgPT4ge30pXG4gICAgYXdhaXQgbmV4dFxuICB9XG5cbiAgLyoqXG4gICAqIERpc3BhdGNoZXMgb3IgdHJhbnNmZXJzIG9uZSBhZG1pdHRlZCBtZXNzYWdlIHdoaWxlIHJldGFpbmluZyBpdHMgYWNjb3VudGluZy5cbiAgICogQHBhcmFtIHtJbmJvdW5kTWVzc2FnZVdvcmt9IHdvcmsgLSBBZG1pdHRlZCBkZWNvZGVkIG1lc3NhZ2UuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIGFmdGVyIGRpc3BhdGNoIG9yIHJlc29sdmVyLXF1ZXVlIHRyYW5zZmVyLlxuICAgKi9cbiAgYXN5bmMgX3J1bk1lc3NhZ2VXb3JrKHdvcmspIHtcbiAgICBpZiAodGhpcy5faW5ib3VuZENsb3NlZCkge1xuICAgICAgdGhpcy5fcmVsZWFzZUluYm91bmRBZG1pc3Npb24od29yay5hZG1pc3Npb24pXG4gICAgICByZXR1cm5cbiAgICB9XG5cbiAgICBpZiAodGhpcy5wZW5kaW5nTWVzc2FnZUhhbmRsZXIpIHtcbiAgICAgIHRoaXMubWVzc2FnZVF1ZXVlLnB1c2god29yaylcbiAgICAgIHJldHVyblxuICAgIH1cblxuICAgIHRyeSB7XG4gICAgICBhd2FpdCB0aGlzLl9kaXNwYXRjaE1lc3NhZ2Uod29yay5tZXNzYWdlKVxuICAgIH0gZmluYWxseSB7XG4gICAgICB0aGlzLl9yZWxlYXNlSW5ib3VuZEFkbWlzc2lvbih3b3JrLmFkbWlzc2lvbilcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogUnVucyBkaXNwYXRjaCBtZXNzYWdlLlxuICAgKiBAcGFyYW0ge1dlYnNvY2tldFNlc3Npb25NZXNzYWdlfSBtZXNzYWdlIC0gTWVzc2FnZSB0ZXh0LlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyB3aGVuIGNvbXBsZXRlLlxuICAgKi9cbiAgYXN5bmMgX2Rpc3BhdGNoTWVzc2FnZShtZXNzYWdlKSB7XG4gICAgYXdhaXQgdGhpcy5fcnVuV2l0aE1lc3NhZ2VMb2dDb250ZXh0KG1lc3NhZ2UsIGFzeW5jICgpID0+IHtcbiAgICAgIGNvbnN0IHdyYXBwZXIgPSB0aGlzLmNvbmZpZ3VyYXRpb24uZ2V0V2Vic29ja2V0QXJvdW5kUmVxdWVzdD8uKClcblxuICAgICAgaWYgKHdyYXBwZXIpIHtcbiAgICAgICAgYXdhaXQgd3JhcHBlcih0aGlzLCAoKSA9PiB0aGlzLl9oYW5kbGVNZXNzYWdlSW5uZXIobWVzc2FnZSkpXG4gICAgICAgIHJldHVyblxuICAgICAgfVxuXG4gICAgICBhd2FpdCB0aGlzLl9oYW5kbGVNZXNzYWdlSW5uZXIobWVzc2FnZSlcbiAgICB9KVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgb25lIGRlY29kZWQgbWVzc2FnZSBpbiBpdHMgb3duIHJlcXVlc3QgdGltaW5nIGFuZCBzZW5zaXRpdmUtdmFsdWUgY29udGV4dC5cbiAgICogQHBhcmFtIHtXZWJzb2NrZXRTZXNzaW9uTWVzc2FnZX0gbWVzc2FnZSAtIERlY29kZWQgY2xpZW50IG1lc3NhZ2UuXG4gICAqIEBwYXJhbSB7KCkgPT4gUHJvbWlzZTx2b2lkPn0gY2FsbGJhY2sgLSBNZXNzYWdlIGRpc3BhdGNoIGNhbGxiYWNrLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyBhZnRlciB0aGUgbWVzc2FnZSBmaW5pc2hlcy5cbiAgICovXG4gIGFzeW5jIF9ydW5XaXRoTWVzc2FnZUxvZ0NvbnRleHQobWVzc2FnZSwgY2FsbGJhY2spIHtcbiAgICBjb25zdCByZXF1ZXN0VGltaW5nID0gbmV3IFJlcXVlc3RUaW1pbmcoKVxuICAgIGNvbnN0IHJlZGFjdG9yID0gdGhpcy5jb25maWd1cmF0aW9uLmdldExvZ1JlZGFjdG9yKClcbiAgICBsZXQgc2Vuc2l0aXZlVmFsdWVzID0gcmVkYWN0b3Iuc2Vuc2l0aXZlVmFsdWVzKG1lc3NhZ2UpXG5cbiAgICBzZW5zaXRpdmVWYWx1ZXMgPSByZWRhY3Rvci5zZW5zaXRpdmVWYWx1ZXModGhpcy5nZXRNZXRhZGF0YSgpLCBzZW5zaXRpdmVWYWx1ZXMpXG5cbiAgICBpZiAodGhpcy51cGdyYWRlUmVxdWVzdCkge1xuICAgICAgc2Vuc2l0aXZlVmFsdWVzID0gcmVkYWN0b3IucmVxdWVzdFNlbnNpdGl2ZVZhbHVlcyh0aGlzLnVwZ3JhZGVSZXF1ZXN0LCBzZW5zaXRpdmVWYWx1ZXMpXG4gICAgfVxuXG4gICAgcmVxdWVzdFRpbWluZy5yZWdpc3RlckxvZ1NlbnNpdGl2ZVZhbHVlcyhzZW5zaXRpdmVWYWx1ZXMpXG5cbiAgICBhd2FpdCB0aGlzLmNvbmZpZ3VyYXRpb24ucnVuV2l0aFJlcXVlc3RUaW1pbmcocmVxdWVzdFRpbWluZywgY2FsbGJhY2spXG4gIH1cblxuICAvKipcbiAgICogVGhlIGFjdHVhbCBtZXNzYWdlIGRpc3BhdGNoLCBleHRyYWN0ZWQgc29cbiAgICogYGNvbmZpZ3VyYXRpb24uZ2V0V2Vic29ja2V0QXJvdW5kUmVxdWVzdCgpYCBjYW4gd3JhcCBpdCBpbiBhbnlcbiAgICogcGVyLXJlcXVlc3QgY29udGV4dCAoQXN5bmNMb2NhbFN0b3JhZ2UsIHRyYWNpbmcsIGV0Yy4pLlxuICAgKiBAcGFyYW0ge1dlYnNvY2tldFNlc3Npb25NZXNzYWdlfSBtZXNzYWdlIC0gRGVjb2RlZCBjbGllbnQgZnJhbWUgdG8gZGlzcGF0Y2ggYnkgbWVzc2FnZSB0eXBlLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn1cbiAgICovXG4gIGFzeW5jIF9oYW5kbGVNZXNzYWdlSW5uZXIobWVzc2FnZSkge1xuICAgIC8vIFRoZSBtZXNzYWdlSGFuZGxlciBzaG9ydC1jaXJjdWl0cyBkZWZhdWx0IHJvdXRpbmcgb25seSB3aGVuIHRoZVxuICAgIC8vIGFwcCBhY3R1YWxseSBkZWNsYXJlZCBhbiBgb25NZXNzYWdlYCBob29rLiBBcHBzIHRoYXQgb25seSB3YW50XG4gICAgLy8gc2Vzc2lvbi1saWZlY3ljbGUgdHJhY2tpbmcgKGBvbk9wZW5gL2BvbkNsb3NlYCkgc3RpbGwgbmVlZCB0aGVcbiAgICAvLyBidWlsdC1pbiBzdWJzY3JpYmUvY29ubmVjdGlvbi9jaGFubmVsLXN1YnNjcmliZSByb3V0aW5nIGJlbG93LFxuICAgIC8vIG90aGVyd2lzZSBldmVyeSBpbmNvbWluZyBtZXNzYWdlIGlzIHNpbGVudGx5IGRyb3BwZWQuXG4gICAgaWYgKHRoaXMubWVzc2FnZUhhbmRsZXIgJiYgdHlwZW9mIHRoaXMubWVzc2FnZUhhbmRsZXIub25NZXNzYWdlID09PSBcImZ1bmN0aW9uXCIpIHtcbiAgICAgIGF3YWl0IHRoaXMuX3J1bk1lc3NhZ2VIYW5kbGVyTWVzc2FnZShtZXNzYWdlKVxuICAgICAgcmV0dXJuXG4gICAgfVxuXG4gICAgY29uc3Qgc3Vic2NyaWJlUGF5bG9hZCA9IHN1YnNjcmliZU1lc3NhZ2UobWVzc2FnZSlcblxuICAgIGlmIChzdWJzY3JpYmVQYXlsb2FkKSB7XG4gICAgICBjb25zdCB7Y2hhbm5lbCwgbGFzdEV2ZW50SWQsIHBhcmFtc30gPSBzdWJzY3JpYmVQYXlsb2FkXG5cbiAgICAgIGlmICghY2hhbm5lbCkgdGhyb3cgVmVsb2Npb3VzRXJyb3Iuc2FmZShcImNoYW5uZWwgaXMgcmVxdWlyZWQgZm9yIHN1YnNjcmliZVwiKVxuICAgICAgY29uc3QgcmVzb2x2ZXIgPSB0aGlzLmNvbmZpZ3VyYXRpb24uZ2V0V2Vic29ja2V0Q2hhbm5lbFJlc29sdmVyPy4oKVxuXG4gICAgICBpZiAocmVzb2x2ZXIpIHtcbiAgICAgICAgYXdhaXQgdGhpcy5faGFuZGxlQ2hhbm5lbFN1YnNjcmlwdGlvbih7Y2hhbm5lbCwgbGFzdEV2ZW50SWQsIHBhcmFtc30pXG4gICAgICB9IGVsc2Uge1xuICAgICAgICBhd2FpdCB0aGlzLnN1YnNjcmliZVRvQ2hhbm5lbChjaGFubmVsLCB7YWNrbm93bGVkZ2U6IHRydWUsIGxhc3RFdmVudElkLCBwYXJhbXN9KVxuICAgICAgfVxuXG4gICAgICByZXR1cm5cbiAgICB9XG5cbiAgICBpZiAobWVzc2FnZS50eXBlID09PSBcIm1ldGFkYXRhXCIpIHtcbiAgICAgIGNvbnN0IG1ldGFkYXRhUGF5bG9hZCA9IC8qKiBAdHlwZSB7e2RhdGE/OiBSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59fSAqLyAobWVzc2FnZSlcblxuICAgICAgdGhpcy5fbWV0YWRhdGEgPSBtZXRhZGF0YVBheWxvYWQuZGF0YSAmJiB0eXBlb2YgbWV0YWRhdGFQYXlsb2FkLmRhdGEgPT09IFwib2JqZWN0XCIgPyB7Li4ubWV0YWRhdGFQYXlsb2FkLmRhdGF9IDoge31cblxuICAgICAgZm9yIChjb25zdCB7c3Vic2NyaXB0aW9ufSBvZiB0aGlzLl9jaGFubmVsU3Vic2NyaXB0aW9ucy52YWx1ZXMoKSkge1xuICAgICAgICBpZiAodHlwZW9mIHN1YnNjcmlwdGlvbi5vbk1ldGFkYXRhQ2hhbmdlZCA9PT0gXCJmdW5jdGlvblwiKSB7XG4gICAgICAgICAgYXdhaXQgdGhpcy5fd2l0aENvbm5lY3Rpb25zKGFzeW5jICgpID0+IHtcbiAgICAgICAgICAgIGF3YWl0IHN1YnNjcmlwdGlvbi5vbk1ldGFkYXRhQ2hhbmdlZCh0aGlzLl9tZXRhZGF0YSlcbiAgICAgICAgICB9KVxuICAgICAgICB9XG4gICAgICB9XG5cbiAgICAgIHJldHVyblxuICAgIH1cblxuICAgIGlmIChtZXNzYWdlLnR5cGUgPT09IFwic2Vzc2lvbi1yZXN1bWVcIikge1xuICAgICAgYXdhaXQgdGhpcy5faGFuZGxlU2Vzc2lvblJlc3VtZShtZXNzYWdlKVxuICAgICAgcmV0dXJuXG4gICAgfVxuXG4gICAgaWYgKG1lc3NhZ2UudHlwZSA9PT0gXCJjb25uZWN0aW9uLW9wZW5cIikge1xuICAgICAgYXdhaXQgdGhpcy5faGFuZGxlQ29ubmVjdGlvbk9wZW4obWVzc2FnZSlcbiAgICAgIHJldHVyblxuICAgIH1cblxuICAgIGlmIChtZXNzYWdlLnR5cGUgPT09IFwiY29ubmVjdGlvbi1tZXNzYWdlXCIpIHtcbiAgICAgIGF3YWl0IHRoaXMuX2hhbmRsZUNvbm5lY3Rpb25NZXNzYWdlKG1lc3NhZ2UpXG4gICAgICByZXR1cm5cbiAgICB9XG5cbiAgICBpZiAobWVzc2FnZS50eXBlID09PSBcImNvbm5lY3Rpb24tY2xvc2VcIikge1xuICAgICAgYXdhaXQgdGhpcy5faGFuZGxlQ29ubmVjdGlvbkNsb3NlKG1lc3NhZ2UpXG4gICAgICByZXR1cm5cbiAgICB9XG5cbiAgICBpZiAobWVzc2FnZS50eXBlID09PSBcImNoYW5uZWwtc3Vic2NyaWJlXCIpIHtcbiAgICAgIGF3YWl0IHRoaXMuX2hhbmRsZUNoYW5uZWxTdWJzY3JpYmUobWVzc2FnZSlcbiAgICAgIHJldHVyblxuICAgIH1cblxuICAgIGlmIChtZXNzYWdlLnR5cGUgPT09IFwiY2hhbm5lbC11bnN1YnNjcmliZVwiKSB7XG4gICAgICBhd2FpdCB0aGlzLl9oYW5kbGVDaGFubmVsVW5zdWJzY3JpYmUobWVzc2FnZSlcbiAgICAgIHJldHVyblxuICAgIH1cblxuICAgIGlmIChtZXNzYWdlLnR5cGUgJiYgbWVzc2FnZS50eXBlICE9PSBcInJlcXVlc3RcIikge1xuICAgICAgdGhpcy5zZW5kSnNvbih7ZXJyb3I6IGBVbmtub3duIG1lc3NhZ2UgdHlwZTogJHttZXNzYWdlLnR5cGV9YCwgdHlwZTogXCJlcnJvclwifSlcbiAgICAgIHJldHVyblxuICAgIH1cblxuICAgIGNvbnN0IHJlcXVlc3RQYXlsb2FkID0gcmVxdWVzdE1lc3NhZ2UobWVzc2FnZSlcblxuICAgIGlmICghcmVxdWVzdFBheWxvYWQpIHtcbiAgICAgIHRoaXMuc2VuZEpzb24oe2Vycm9yOiBgVW5rbm93biBtZXNzYWdlIHR5cGU6ICR7bWVzc2FnZS50eXBlfWAsIHR5cGU6IFwiZXJyb3JcIn0pXG4gICAgICByZXR1cm5cbiAgICB9XG5cbiAgICBjb25zdCB7Ym9keSwgaGVhZGVycywgaWQsIG1ldGhvZCwgcGF0aH0gPSByZXF1ZXN0UGF5bG9hZFxuXG4gICAgaWYgKCFtZXRob2QpIHRocm93IFZlbG9jaW91c0Vycm9yLnNhZmUoXCJtZXRob2QgaXMgcmVxdWlyZWRcIilcbiAgICBpZiAoIXBhdGgpIHRocm93IFZlbG9jaW91c0Vycm9yLnNhZmUoXCJwYXRoIGlzIHJlcXVpcmVkXCIpXG5cbiAgICBjb25zdCByZXF1ZXN0ID0gbmV3IFdlYnNvY2tldFJlcXVlc3Qoe1xuICAgICAgYm9keSxcbiAgICAgIGhlYWRlcnMsXG4gICAgICBtZXRhZGF0YTogdGhpcy5nZXRNZXRhZGF0YSgpLFxuICAgICAgbWV0aG9kLFxuICAgICAgcGF0aCxcbiAgICAgIHJlbW90ZUFkZHJlc3M6IHRoaXMucmVtb3RlQWRkcmVzcygpXG4gICAgfSlcbiAgICBjb25zdCByZXF1ZXN0UnVubmVyID0gbmV3IFJlcXVlc3RSdW5uZXIoe1xuICAgICAgY29uZmlndXJhdGlvbjogdGhpcy5jb25maWd1cmF0aW9uLFxuICAgICAgcmVxdWVzdFxuICAgIH0pXG5cbiAgICByZXF1ZXN0UnVubmVyLmV2ZW50cy5vbihcImRvbmVcIiwgKCkgPT4ge1xuICAgICAgY29uc3QgcmVzcG9uc2UgPSByZXF1ZXN0UnVubmVyLnJlc3BvbnNlXG4gICAgICBjb25zdCBib2R5ID0gcmVzcG9uc2UuZ2V0Qm9keSgpXG4gICAgICBjb25zdCBoZWFkZXJzID0gcmVzcG9uc2UuaGVhZGVyc1xuXG4gICAgICB0aGlzLnNlbmRKc29uKHtcbiAgICAgICAgYm9keSxcbiAgICAgICAgaGVhZGVycyxcbiAgICAgICAgaWQsXG4gICAgICAgIHN0YXR1c0NvZGU6IHJlc3BvbnNlLmdldFN0YXR1c0NvZGUoKSxcbiAgICAgICAgc3RhdHVzTWVzc2FnZTogcmVzcG9uc2UuZ2V0U3RhdHVzTWVzc2FnZSgpLFxuICAgICAgICB0eXBlOiBcInJlc3BvbnNlXCJcbiAgICAgIH0pXG4gICAgICB2b2lkIHJlcXVlc3RSdW5uZXIubG9nQ29tcGxldGVkUmVxdWVzdCgpLmNhdGNoKChlcnJvcikgPT4ge1xuICAgICAgICB0aGlzLmxvZ2dlci53YXJuKFwiRmFpbGVkIHRvIGxvZyBjb21wbGV0ZWQgcmVxdWVzdFwiLCBlcnJvcilcbiAgICAgIH0pXG4gICAgfSlcblxuICAgIGF3YWl0IHJlcXVlc3RSdW5uZXIucnVuKClcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHByb2Nlc3MgYnVmZmVyLlxuICAgKiBAcmV0dXJucyB7dm9pZH0gLSBObyByZXR1cm4gdmFsdWUuXG4gICAqL1xuICBfcHJvY2Vzc0J1ZmZlcigpIHtcbiAgICB3aGlsZSAodGhpcy5fYnVmZmVyZWRCeXRlcyA+PSAyKSB7XG4gICAgICBjb25zdCBpbml0aWFsSGVhZGVyID0gdGhpcy5fcGVla0J1ZmZlcmVkQnl0ZXMoMilcbiAgICAgIGNvbnN0IGZpcnN0Qnl0ZSA9IGluaXRpYWxIZWFkZXJbMF1cbiAgICAgIGNvbnN0IHNlY29uZEJ5dGUgPSBpbml0aWFsSGVhZGVyWzFdXG4gICAgICBjb25zdCBpc0ZpbmFsID0gKGZpcnN0Qnl0ZSAmIFdFQlNPQ0tFVF9GSU5BTF9GUkFNRSkgPT09IFdFQlNPQ0tFVF9GSU5BTF9GUkFNRVxuICAgICAgY29uc3Qgb3Bjb2RlID0gZmlyc3RCeXRlICYgMHgwRlxuICAgICAgY29uc3QgaXNNYXNrZWQgPSAoc2Vjb25kQnl0ZSAmIDB4ODApID09PSAweDgwXG4gICAgICBsZXQgcGF5bG9hZExlbmd0aCA9IHNlY29uZEJ5dGUgJiAweDdGXG4gICAgICBsZXQgb2Zmc2V0ID0gMlxuXG4gICAgICBpZiAocGF5bG9hZExlbmd0aCA9PT0gMTI2KSB7XG4gICAgICAgIGlmICh0aGlzLl9idWZmZXJlZEJ5dGVzIDwgb2Zmc2V0ICsgMikgcmV0dXJuXG4gICAgICAgIHBheWxvYWRMZW5ndGggPSB0aGlzLl9wZWVrQnVmZmVyZWRCeXRlcyhvZmZzZXQgKyAyKS5yZWFkVUludDE2QkUob2Zmc2V0KVxuICAgICAgICBvZmZzZXQgKz0gMlxuICAgICAgfSBlbHNlIGlmIChwYXlsb2FkTGVuZ3RoID09PSAxMjcpIHtcbiAgICAgICAgaWYgKHRoaXMuX2J1ZmZlcmVkQnl0ZXMgPCBvZmZzZXQgKyA4KSByZXR1cm5cbiAgICAgICAgY29uc3QgYmlnTGVuZ3RoID0gdGhpcy5fcGVla0J1ZmZlcmVkQnl0ZXMob2Zmc2V0ICsgOCkucmVhZEJpZ1VJbnQ2NEJFKG9mZnNldClcblxuICAgICAgICBpZiAoYmlnTGVuZ3RoID4gV0VCU09DS0VUX01BWF9JTkJPVU5EX0ZSQU1FX0JZVEVTX0JJR0lOVCkge1xuICAgICAgICAgIHRoaXMubG9nZ2VyLndhcm4oKCkgPT4gW1xuICAgICAgICAgICAgXCJXZWJzb2NrZXQgZnJhbWUgZXhjZWVkZWQgYnl0ZSBjYXA7IGNsb3NpbmcgY29ubmVjdGlvblwiLFxuICAgICAgICAgICAge2ZyYW1lQnl0ZXM6IGJpZ0xlbmd0aC50b1N0cmluZygpLCBtYXhCeXRlczogV0VCU09DS0VUX01BWF9GSU5BTF9GUkFNRV9CWVRFU31cbiAgICAgICAgICBdKVxuICAgICAgICAgIHRoaXMuX2Nsb3NlRm9ySW5ib3VuZExpbWl0KClcbiAgICAgICAgICByZXR1cm5cbiAgICAgICAgfVxuXG4gICAgICAgIHBheWxvYWRMZW5ndGggPSBOdW1iZXIoYmlnTGVuZ3RoKVxuICAgICAgICBvZmZzZXQgKz0gOFxuICAgICAgfVxuXG4gICAgICBjb25zdCBtYXNrTGVuZ3RoID0gaXNNYXNrZWQgPyA0IDogMFxuXG4gICAgICBjb25zdCBmcmFtZUxlbmd0aCA9IG9mZnNldCArIG1hc2tMZW5ndGggKyBwYXlsb2FkTGVuZ3RoXG5cbiAgICAgIGlmICh0aGlzLl9idWZmZXJlZEJ5dGVzIDwgZnJhbWVMZW5ndGgpIHJldHVyblxuXG4gICAgICBjb25zdCBmcmFtZSA9IHRoaXMuX2NvbnN1bWVCdWZmZXJlZEJ5dGVzKGZyYW1lTGVuZ3RoKVxuXG4gICAgICAvKiogQHR5cGUge0J1ZmZlcn0gKi9cbiAgICAgIGxldCBwYXlsb2FkID0gZnJhbWUuc3ViYXJyYXkob2Zmc2V0ICsgbWFza0xlbmd0aCwgZnJhbWVMZW5ndGgpXG5cbiAgICAgIGlmIChpc01hc2tlZCkge1xuICAgICAgICBjb25zdCBtYXNrID0gZnJhbWUuc3ViYXJyYXkob2Zmc2V0LCBvZmZzZXQgKyBtYXNrTGVuZ3RoKVxuICAgICAgICB0aGlzLl91bm1hc2tQYXlsb2FkKHBheWxvYWQsIG1hc2spXG4gICAgICB9XG5cbiAgICAgIC8vIENvbnRyb2wgZnJhbWVzIChvcGNvZGUgPj0gMHg4KSBtdXN0IG5vdCBiZSBmcmFnbWVudGVkIHBlclxuICAgICAgLy8gUkZDIDY0NTUgYW5kIGNhbiBhcnJpdmUgaW50ZXJsZWF2ZWQgd2l0aCBhIGZyYWdtZW50ZWQgZGF0YVxuICAgICAgLy8gbWVzc2FnZS4gSGFuZGxlIHRoZW0gZmlyc3Qgd2l0aG91dCB0b3VjaGluZyB0aGUgZnJhZ21lbnRcbiAgICAgIC8vIGFjY3VtdWxhdG9yLlxuICAgICAgaWYgKG9wY29kZSA9PT0gV0VCU09DS0VUX09QQ09ERV9QSU5HKSB7XG4gICAgICAgIHRoaXMuX3NlbmRDb250cm9sRnJhbWUoV0VCU09DS0VUX09QQ09ERV9QT05HLCBwYXlsb2FkKVxuICAgICAgICBjb250aW51ZVxuICAgICAgfVxuXG4gICAgICBpZiAob3Bjb2RlID09PSBXRUJTT0NLRVRfT1BDT0RFX0NMT1NFKSB7XG4gICAgICAgIGNvbnN0IGFsbG93UmVzdW1lID0gcGF5bG9hZC5sZW5ndGggPCAyIHx8IHBheWxvYWQucmVhZFVJbnQxNkJFKDApICE9PSBXRUJTT0NLRVRfQ0xPU0VfTk9STUFMXG5cbiAgICAgICAgdGhpcy5zZW5kR29vZGJ5ZSh0aGlzLmNsaWVudClcbiAgICAgICAgdGhpcy5faGFuZGxlQ2xvc2Uoe2FsbG93UmVzdW1lfSlcbiAgICAgICAgY29udGludWVcbiAgICAgIH1cblxuICAgICAgaWYgKG9wY29kZSA9PT0gV0VCU09DS0VUX09QQ09ERV9QT05HKSB7XG4gICAgICAgIC8vIEFuc3dlciB0byBhIGhlYXJ0YmVhdCBwaW5nOyBsaXZlbmVzcyBpcyByZWNvcmRlZCBpbiBvbkRhdGEuXG4gICAgICAgIGNvbnRpbnVlXG4gICAgICB9XG5cbiAgICAgIGlmIChvcGNvZGUgPj0gMHg4KSB7XG4gICAgICAgIHRoaXMubG9nZ2VyLndhcm4oYFVuc3VwcG9ydGVkIHdlYnNvY2tldCBjb250cm9sIG9wY29kZTogJHtvcGNvZGV9YClcbiAgICAgICAgY29udGludWVcbiAgICAgIH1cblxuICAgICAgLy8gRGF0YSBmcmFtZSAoVEVYVC9CSU5BUlkvQ09OVElOVUFUSU9OKS4gUmVhc3NlbWJsZSBmcmFnbWVudHNcbiAgICAgIC8vIGJlZm9yZSBkaXNwYXRjaGluZy4gQnJvd3NlcnMgKENocm9tZSkgbGVnaXRpbWF0ZWx5IGZyYWdtZW50XG4gICAgICAvLyBsb25nZXIgY2xpZW504oaSc2VydmVyIHRleHQgZnJhbWVzOyBhIHByaW9yIHZlcnNpb24gZHJvcHBlZFxuICAgICAgLy8gZXZlcnkgZnJhZ21lbnRlZCBtZXNzYWdlIHNpbGVudGx5LCBzbyBhbnkgcGF5bG9hZCBsYXJnZVxuICAgICAgLy8gZW5vdWdoIHRvIGhpdCB0aGUgYnJvd3NlcidzIGZyYWdtZW50YXRpb24gdGhyZXNob2xkXG4gICAgICAvLyAoZS5nLiBhIGNoYW5uZWwtc3Vic2NyaWJlIHdpdGggYW4gYXV0aCB0b2tlbikgbmV2ZXIgcmVhY2hlZFxuICAgICAgLy8gdGhlIGhhbmRsZXIuXG4gICAgICBpZiAob3Bjb2RlID09PSBXRUJTT0NLRVRfT1BDT0RFX0NPTlRJTlVBVElPTikge1xuICAgICAgICBpZiAodGhpcy5fZnJhZ21lbnRlZFBheWxvYWRzID09PSBudWxsKSB7XG4gICAgICAgICAgdGhpcy5sb2dnZXIud2FybihcIlJlY2VpdmVkIGNvbnRpbnVhdGlvbiBmcmFtZSB3aXRoIG5vIGZyYWdtZW50ZWQgbWVzc2FnZSBpbiBwcm9ncmVzc1wiKVxuICAgICAgICAgIGNvbnRpbnVlXG4gICAgICAgIH1cblxuICAgICAgICBpZiAoIXRoaXMuX2FwcGVuZEZyYWdtZW50KHBheWxvYWQpKSByZXR1cm5cblxuICAgICAgICBpZiAoIWlzRmluYWwpIGNvbnRpbnVlXG4gICAgICB9IGVsc2UgaWYgKG9wY29kZSA9PT0gV0VCU09DS0VUX09QQ09ERV9URVhUIHx8IG9wY29kZSA9PT0gV0VCU09DS0VUX09QQ09ERV9CSU5BUlkpIHtcbiAgICAgICAgaWYgKHRoaXMuX2ZyYWdtZW50ZWRQYXlsb2FkcyAhPT0gbnVsbCkge1xuICAgICAgICAgIHRoaXMubG9nZ2VyLndhcm4oXCJSZWNlaXZlZCBuZXcgZGF0YSBmcmFtZSB3aGlsZSBhIGZyYWdtZW50ZWQgbWVzc2FnZSB3YXMgaW4gcHJvZ3Jlc3M7IGRpc2NhcmRpbmcgcHJpb3IgZnJhZ21lbnRzXCIpXG4gICAgICAgICAgdGhpcy5fcmVzZXRGcmFnbWVudEJ1ZmZlcigpXG4gICAgICAgIH1cblxuICAgICAgICBpZiAoIWlzRmluYWwpIHtcbiAgICAgICAgICB0aGlzLl9mcmFnbWVudGVkUGF5bG9hZHMgPSBbcGF5bG9hZF1cbiAgICAgICAgICB0aGlzLl9mcmFnbWVudGVkT3Bjb2RlID0gb3Bjb2RlXG4gICAgICAgICAgdGhpcy5fZnJhZ21lbnRlZEJ5dGVzID0gcGF5bG9hZC5sZW5ndGhcblxuICAgICAgICAgIGlmICghdGhpcy5fZW5mb3JjZUZyYWdtZW50TGltaXRzKCkpIHJldHVyblxuXG4gICAgICAgICAgY29udGludWVcbiAgICAgICAgfVxuICAgICAgfSBlbHNlIHtcbiAgICAgICAgdGhpcy5sb2dnZXIud2FybihgVW5zdXBwb3J0ZWQgd2Vic29ja2V0IGRhdGEgb3Bjb2RlOiAke29wY29kZX1gKVxuICAgICAgICBjb250aW51ZVxuICAgICAgfVxuXG4gICAgICAvKipcbiAgICAgICAqIERlZmluZXMgZmluYWxQYXlsb2FkLlxuICAgICAgICogQHR5cGUge0J1ZmZlcn0gKi9cbiAgICAgIGxldCBmaW5hbFBheWxvYWRcbiAgICAgIC8qKlxuICAgICAgICogRGVmaW5lcyBmaW5hbE9wY29kZS5cbiAgICAgICAqIEB0eXBlIHtudW1iZXJ9ICovXG4gICAgICBsZXQgZmluYWxPcGNvZGVcblxuICAgICAgaWYgKHRoaXMuX2ZyYWdtZW50ZWRQYXlsb2FkcyAhPT0gbnVsbCkge1xuICAgICAgICBpZiAob3Bjb2RlID09PSBXRUJTT0NLRVRfT1BDT0RFX0NPTlRJTlVBVElPTikge1xuICAgICAgICAgIGZpbmFsUGF5bG9hZCA9IEJ1ZmZlci5jb25jYXQodGhpcy5fZnJhZ21lbnRlZFBheWxvYWRzKVxuICAgICAgICAgIGZpbmFsT3Bjb2RlID0gdGhpcy5fZnJhZ21lbnRlZE9wY29kZSA/PyBXRUJTT0NLRVRfT1BDT0RFX1RFWFRcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICBmaW5hbFBheWxvYWQgPSBwYXlsb2FkXG4gICAgICAgICAgZmluYWxPcGNvZGUgPSBvcGNvZGVcbiAgICAgICAgfVxuICAgICAgICB0aGlzLl9yZXNldEZyYWdtZW50QnVmZmVyKClcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIGZpbmFsUGF5bG9hZCA9IHBheWxvYWRcbiAgICAgICAgZmluYWxPcGNvZGUgPSBvcGNvZGVcbiAgICAgIH1cblxuICAgICAgaWYgKGZpbmFsT3Bjb2RlICE9PSBXRUJTT0NLRVRfT1BDT0RFX1RFWFQpIHtcbiAgICAgICAgdGhpcy5sb2dnZXIud2FybihgVW5zdXBwb3J0ZWQgd2Vic29ja2V0IGRhdGEgb3Bjb2RlIGFmdGVyIHJlYXNzZW1ibHk6ICR7ZmluYWxPcGNvZGV9YClcbiAgICAgICAgY29udGludWVcbiAgICAgIH1cblxuICAgICAgY29uc3QgYWRtaXNzaW9uID0gdGhpcy5fYWRtaXRJbmJvdW5kTWVzc2FnZShmaW5hbFBheWxvYWQubGVuZ3RoKVxuXG4gICAgICBpZiAoIWFkbWlzc2lvbikgcmV0dXJuXG5cbiAgICAgIHRyeSB7XG4gICAgICAgIGNvbnN0IG1lc3NhZ2UgPSBKU09OLnBhcnNlKGZpbmFsUGF5bG9hZC50b1N0cmluZyhcInV0Zi04XCIpKVxuXG4gICAgICAgIHRoaXMuX2hhbmRsZU1lc3NhZ2VXb3JrKHthZG1pc3Npb24sIG1lc3NhZ2V9KS5jYXRjaCgoY2F1Z2h0RXJyb3IpID0+IHtcbiAgICAgICAgICBjb25zdCBjbGllbnRFcnJvck1lc3NhZ2UgPSBjYXVnaHRFcnJvciBpbnN0YW5jZW9mIEVycm9yID8gY2F1Z2h0RXJyb3IubWVzc2FnZSA6IFN0cmluZyhjYXVnaHRFcnJvcilcbiAgICAgICAgICBjb25zdCBlcnJvciA9IHRoaXMuX3JlcG9ydFVuZXhwZWN0ZWREaXNwYXRjaEVycm9yKGNhdWdodEVycm9yLCB7XG4gICAgICAgICAgICBzdGFnZTogXCJ3ZWJzb2NrZXQtbWVzc2FnZS1kaXNwYXRjaFwiXG4gICAgICAgICAgfSlcblxuICAgICAgICAgIHRoaXMubG9nZ2VyLmVycm9yKCgpID0+IFtcIldlYnNvY2tldCBtZXNzYWdlIGhhbmRsZXIgZmFpbGVkXCIsIGVycm9yXSlcbiAgICAgICAgICB0aGlzLnNlbmRKc29uKHtcbiAgICAgICAgICAgIGVycm9yOiBjbGllbnRFcnJvck1lc3NhZ2UsXG4gICAgICAgICAgICB0eXBlOiBcImVycm9yXCJcbiAgICAgICAgICB9KVxuICAgICAgICB9KVxuICAgICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgICAgdGhpcy5fcmVsZWFzZUluYm91bmRBZG1pc3Npb24oYWRtaXNzaW9uKVxuICAgICAgICB0aGlzLmxvZ2dlci5lcnJvcigoKSA9PiBbXCJGYWlsZWQgdG8gcGFyc2Ugd2Vic29ja2V0IG1lc3NhZ2VcIiwgZXJyb3JdKVxuICAgICAgICB0aGlzLnNlbmRKc29uKHtlcnJvcjogXCJJbnZhbGlkIHdlYnNvY2tldCBtZXNzYWdlXCIsIHR5cGU6IFwiZXJyb3JcIn0pXG4gICAgICB9XG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIENvcGllcyB0aGUgbGVhZGluZyBidWZmZXJlZCBieXRlcyB3aXRob3V0IGNvbnN1bWluZyB0aGVtLiBIZWFkZXJcbiAgICogaW5zcGVjdGlvbiBpcyBib3VuZGVkIHRvIHRoZSB3ZWJzb2NrZXQgaGVhZGVyIHNpemUuXG4gICAqIEBwYXJhbSB7bnVtYmVyfSBieXRlQ291bnQgLSBOdW1iZXIgb2YgbGVhZGluZyBieXRlcyB0byBpbnNwZWN0LlxuICAgKiBAcmV0dXJucyB7QnVmZmVyfSAtIENvcGllZCBwcmVmaXguXG4gICAqL1xuICBfcGVla0J1ZmZlcmVkQnl0ZXMoYnl0ZUNvdW50KSB7XG4gICAgY29uc3QgcHJlZml4ID0gQnVmZmVyLmFsbG9jVW5zYWZlKGJ5dGVDb3VudClcbiAgICBsZXQgY29waWVkQnl0ZXMgPSAwXG4gICAgbGV0IGNodW5rT2Zmc2V0ID0gdGhpcy5fYnVmZmVyQ2h1bmtPZmZzZXRcblxuICAgIGZvciAobGV0IGNodW5rSW5kZXggPSB0aGlzLl9idWZmZXJDaHVua0luZGV4OyBjaHVua0luZGV4IDwgdGhpcy5fYnVmZmVyQ2h1bmtzLmxlbmd0aDsgY2h1bmtJbmRleCArPSAxKSB7XG4gICAgICBjb25zdCBjaHVuayA9IHRoaXMuX2J1ZmZlckNodW5rc1tjaHVua0luZGV4XVxuICAgICAgY29uc3QgYnl0ZXNGcm9tQ2h1bmsgPSBNYXRoLm1pbihjaHVuay5sZW5ndGggLSBjaHVua09mZnNldCwgYnl0ZUNvdW50IC0gY29waWVkQnl0ZXMpXG5cbiAgICAgIGNodW5rLmNvcHkocHJlZml4LCBjb3BpZWRCeXRlcywgY2h1bmtPZmZzZXQsIGNodW5rT2Zmc2V0ICsgYnl0ZXNGcm9tQ2h1bmspXG4gICAgICBjb3BpZWRCeXRlcyArPSBieXRlc0Zyb21DaHVua1xuICAgICAgY2h1bmtPZmZzZXQgPSAwXG4gICAgICBpZiAoY29waWVkQnl0ZXMgPT09IGJ5dGVDb3VudCkgYnJlYWtcbiAgICB9XG5cbiAgICByZXR1cm4gcHJlZml4XG4gIH1cblxuICAvKipcbiAgICogQ29uc3VtZXMgYSBjb21wbGV0ZSBmcmFtZSBmcm9tIHRoZSBjaHVuayBxdWV1ZSB3aXRoIG9uZSBib3VuZGVkIGNvcHkuXG4gICAqIEBwYXJhbSB7bnVtYmVyfSBieXRlQ291bnQgLSBDb21wbGV0ZSBmcmFtZSBieXRlIGNvdW50LlxuICAgKiBAcmV0dXJucyB7QnVmZmVyfSAtIENvbnRpZ3VvdXMgZnJhbWUgYnl0ZXMuXG4gICAqL1xuICBfY29uc3VtZUJ1ZmZlcmVkQnl0ZXMoYnl0ZUNvdW50KSB7XG4gICAgY29uc3QgcmVzdWx0ID0gQnVmZmVyLmFsbG9jVW5zYWZlKGJ5dGVDb3VudClcbiAgICBsZXQgY29waWVkQnl0ZXMgPSAwXG5cbiAgICB3aGlsZSAoY29waWVkQnl0ZXMgPCBieXRlQ291bnQpIHtcbiAgICAgIGNvbnN0IGNodW5rID0gdGhpcy5fYnVmZmVyQ2h1bmtzW3RoaXMuX2J1ZmZlckNodW5rSW5kZXhdXG4gICAgICBjb25zdCBieXRlc0Zyb21DaHVuayA9IE1hdGgubWluKGNodW5rLmxlbmd0aCAtIHRoaXMuX2J1ZmZlckNodW5rT2Zmc2V0LCBieXRlQ291bnQgLSBjb3BpZWRCeXRlcylcblxuICAgICAgY2h1bmsuY29weShcbiAgICAgICAgcmVzdWx0LFxuICAgICAgICBjb3BpZWRCeXRlcyxcbiAgICAgICAgdGhpcy5fYnVmZmVyQ2h1bmtPZmZzZXQsXG4gICAgICAgIHRoaXMuX2J1ZmZlckNodW5rT2Zmc2V0ICsgYnl0ZXNGcm9tQ2h1bmtcbiAgICAgIClcbiAgICAgIGNvcGllZEJ5dGVzICs9IGJ5dGVzRnJvbUNodW5rXG4gICAgICB0aGlzLl9idWZmZXJDaHVua09mZnNldCArPSBieXRlc0Zyb21DaHVua1xuXG4gICAgICBpZiAodGhpcy5fYnVmZmVyQ2h1bmtPZmZzZXQgPT09IGNodW5rLmxlbmd0aCkge1xuICAgICAgICB0aGlzLl9idWZmZXJDaHVua0luZGV4ICs9IDFcbiAgICAgICAgdGhpcy5fYnVmZmVyQ2h1bmtPZmZzZXQgPSAwXG4gICAgICB9XG4gICAgfVxuXG4gICAgaWYgKHRoaXMuX2J1ZmZlckNodW5rSW5kZXggPT09IHRoaXMuX2J1ZmZlckNodW5rcy5sZW5ndGgpIHtcbiAgICAgIHRoaXMuX2J1ZmZlckNodW5rcyA9IFtdXG4gICAgICB0aGlzLl9idWZmZXJDaHVua0luZGV4ID0gMFxuICAgIH0gZWxzZSBpZiAoXG4gICAgICB0aGlzLl9idWZmZXJDaHVua0luZGV4ID49IDY0ICYmXG4gICAgICB0aGlzLl9idWZmZXJDaHVua0luZGV4ICogMiA+PSB0aGlzLl9idWZmZXJDaHVua3MubGVuZ3RoXG4gICAgKSB7XG4gICAgICB0aGlzLl9idWZmZXJDaHVua3MgPSB0aGlzLl9idWZmZXJDaHVua3Muc2xpY2UodGhpcy5fYnVmZmVyQ2h1bmtJbmRleClcbiAgICAgIHRoaXMuX2J1ZmZlckNodW5rSW5kZXggPSAwXG4gICAgfVxuXG4gICAgdGhpcy5fYnVmZmVyZWRCeXRlcyAtPSBieXRlQ291bnRcbiAgICB0aGlzLl9idWZmZXJlZEZyYW1lQ29weUJ5dGVzICs9IGJ5dGVDb3VudFxuXG4gICAgcmV0dXJuIHJlc3VsdFxuICB9XG5cbiAgLyoqXG4gICAqIERyb3BzIGFsbCBpbmNvbXBsZXRlIGZyYW1lIGNodW5rcy5cbiAgICogQHJldHVybnMge3ZvaWR9XG4gICAqL1xuICBfY2xlYXJCdWZmZXJlZEZyYW1lQ2h1bmtzKCkge1xuICAgIHRoaXMuX2J1ZmZlckNodW5rcyA9IFtdXG4gICAgdGhpcy5fYnVmZmVyQ2h1bmtJbmRleCA9IDBcbiAgICB0aGlzLl9idWZmZXJDaHVua09mZnNldCA9IDBcbiAgICB0aGlzLl9idWZmZXJlZEJ5dGVzID0gMFxuICB9XG5cbiAgLyoqXG4gICAqIFRlbnRhdGl2ZWx5IGFkbWl0cyBvbmUgY29tcGxldGUgdGV4dCBtZXNzYWdlIGJlZm9yZSBkZWNvZGluZyBpdC5cbiAgICogQHBhcmFtIHtudW1iZXJ9IGJ5dGVMZW5ndGggLSBFeGFjdCBjb21wbGV0ZSByYXcgdGV4dCBwYXlsb2FkIGJ5dGVzLlxuICAgKiBAcmV0dXJucyB7SW5ib3VuZE1lc3NhZ2VBZG1pc3Npb24gfCBudWxsfSAtIEFkbWlzc2lvbiBvd25lcnNoaXAsIG9yIG51bGwgYWZ0ZXIgb3ZlcmxvYWQvY2xvc2UuXG4gICAqL1xuICBfYWRtaXRJbmJvdW5kTWVzc2FnZShieXRlTGVuZ3RoKSB7XG4gICAgaWYgKHRoaXMuX2luYm91bmRDbG9zZWQpIHJldHVybiBudWxsXG5cbiAgICBpZiAoXG4gICAgICB0aGlzLl9pbmJvdW5kUGVuZGluZ01lc3NhZ2VzICsgMSA+IHRoaXMuX2luYm91bmRNYXhQZW5kaW5nTWVzc2FnZXMgfHxcbiAgICAgIHRoaXMuX2luYm91bmRQZW5kaW5nQnl0ZXMgKyBieXRlTGVuZ3RoID4gdGhpcy5faW5ib3VuZE1heFBlbmRpbmdCeXRlc1xuICAgICkge1xuICAgICAgdGhpcy5fY2xvc2VGb3JJbmJvdW5kQmFja2xvZyhieXRlTGVuZ3RoKVxuICAgICAgcmV0dXJuIG51bGxcbiAgICB9XG5cbiAgICB0aGlzLl9pbmJvdW5kUGVuZGluZ01lc3NhZ2VzICs9IDFcbiAgICB0aGlzLl9pbmJvdW5kUGVuZGluZ0J5dGVzICs9IGJ5dGVMZW5ndGhcblxuICAgIHJldHVybiB7XG4gICAgICBieXRlTGVuZ3RoLFxuICAgICAgZ2VuZXJhdGlvbjogdGhpcy5faW5ib3VuZEFjY291bnRpbmdHZW5lcmF0aW9uLFxuICAgICAgcmVsZWFzZWQ6IGZhbHNlXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIFJlbGVhc2VzIG9uZSBhZG1pc3Npb24gZXhhY3RseSBvbmNlLlxuICAgKiBAcGFyYW0ge0luYm91bmRNZXNzYWdlQWRtaXNzaW9ufSBhZG1pc3Npb24gLSBBZG1pc3Npb24gb3duZXJzaGlwLlxuICAgKiBAcmV0dXJucyB7dm9pZH1cbiAgICovXG4gIF9yZWxlYXNlSW5ib3VuZEFkbWlzc2lvbihhZG1pc3Npb24pIHtcbiAgICBpZiAoYWRtaXNzaW9uLnJlbGVhc2VkKSByZXR1cm5cblxuICAgIGFkbWlzc2lvbi5yZWxlYXNlZCA9IHRydWVcbiAgICBpZiAoYWRtaXNzaW9uLmdlbmVyYXRpb24gIT09IHRoaXMuX2luYm91bmRBY2NvdW50aW5nR2VuZXJhdGlvbikgcmV0dXJuXG5cbiAgICB0aGlzLl9pbmJvdW5kUGVuZGluZ01lc3NhZ2VzIC09IDFcbiAgICB0aGlzLl9pbmJvdW5kUGVuZGluZ0J5dGVzIC09IGFkbWlzc2lvbi5ieXRlTGVuZ3RoXG4gIH1cblxuICAvKipcbiAgICogQWJhbmRvbnMgYWxsIGFkbWl0dGVkIGlucHV0IGFuZCBpbnZhbGlkYXRlcyBsYXRlIHNldHRsZW1lbnRzLlxuICAgKiBAcmV0dXJucyB7dm9pZH1cbiAgICovXG4gIF9hYmFuZG9uSW5ib3VuZE1lc3NhZ2VzKCkge1xuICAgIHRoaXMuX2luYm91bmRDbG9zZWQgPSB0cnVlXG4gICAgdGhpcy5faW5ib3VuZEFjY291bnRpbmdHZW5lcmF0aW9uICs9IDFcbiAgICB0aGlzLl9pbmJvdW5kUGVuZGluZ0J5dGVzID0gMFxuICAgIHRoaXMuX2luYm91bmRQZW5kaW5nTWVzc2FnZXMgPSAwXG4gICAgdGhpcy5tZXNzYWdlUXVldWUgPSBbXVxuICB9XG5cbiAgLyoqXG4gICAqIFBlcm1hbmVudGx5IGNsb3NlcyBhIHNlc3Npb24gd2hvc2UgbmV4dCBtZXNzYWdlIGV4Y2VlZGVkIGl0cyBiYWNrbG9nIGJ1ZGdldC5cbiAgICogQHBhcmFtIHtudW1iZXJ9IHJlamVjdGVkQnl0ZXMgLSBSYXcgcGF5bG9hZCBieXRlcyByZWplY3RlZCBhdCBhZG1pc3Npb24uXG4gICAqIEByZXR1cm5zIHt2b2lkfVxuICAgKi9cbiAgX2Nsb3NlRm9ySW5ib3VuZEJhY2tsb2cocmVqZWN0ZWRCeXRlcykge1xuICAgIGlmICh0aGlzLl9pbmJvdW5kQmFja2xvZ092ZXJsb2FkZWQgfHwgdGhpcy5faW5ib3VuZENsb3NlZCkgcmV0dXJuXG5cbiAgICB0aGlzLl9pbmJvdW5kQmFja2xvZ092ZXJsb2FkZWQgPSB0cnVlXG4gICAgdGhpcy5sb2dnZXIud2FybigoKSA9PiBbXG4gICAgICBcIkluYm91bmQgd2Vic29ja2V0IG1lc3NhZ2UgYmFja2xvZyBleGNlZWRlZDsgY2xvc2luZyBjb25uZWN0aW9uXCIsXG4gICAgICB7XG4gICAgICAgIG1heEJ5dGVzOiB0aGlzLl9pbmJvdW5kTWF4UGVuZGluZ0J5dGVzLFxuICAgICAgICBtYXhNZXNzYWdlczogdGhpcy5faW5ib3VuZE1heFBlbmRpbmdNZXNzYWdlcyxcbiAgICAgICAgcGVuZGluZ0J5dGVzOiB0aGlzLl9pbmJvdW5kUGVuZGluZ0J5dGVzLFxuICAgICAgICBwZW5kaW5nTWVzc2FnZXM6IHRoaXMuX2luYm91bmRQZW5kaW5nTWVzc2FnZXMsXG4gICAgICAgIHJlamVjdGVkQnl0ZXNcbiAgICAgIH1cbiAgICBdKVxuICAgIHRoaXMuc2VuZEdvb2RieWUodGhpcy5jbGllbnQsIHtcbiAgICAgIGNvZGU6IFdFQlNPQ0tFVF9DTE9TRV9QT0xJQ1lfVklPTEFUSU9OLFxuICAgICAgcmVhc29uOiBXRUJTT0NLRVRfSU5CT1VORF9CQUNLTE9HX0NMT1NFX1JFQVNPTlxuICAgIH0pXG4gICAgdGhpcy5faGFuZGxlQ2xvc2Uoe2FsbG93UmVzdW1lOiBmYWxzZX0pXG4gIH1cblxuICAvKipcbiAgICogQ2xvc2VzIGFmdGVyIGFuIGluYm91bmQgYnVmZmVyaW5nIGxpbWl0IGFuZCByZWxlYXNlcyBhbGwgcGFyc2VyLW93bmVkIGlucHV0LlxuICAgKiBAcmV0dXJucyB7dm9pZH1cbiAgICovXG4gIF9jbG9zZUZvckluYm91bmRMaW1pdCgpIHtcbiAgICB0aGlzLl9yZXNldEZyYWdtZW50QnVmZmVyKClcbiAgICB0aGlzLl9jbGVhckJ1ZmZlcmVkRnJhbWVDaHVua3MoKVxuICAgIHRoaXMuc2VuZEdvb2RieWUodGhpcy5jbGllbnQpXG4gICAgdGhpcy5faGFuZGxlQ2xvc2UoKVxuICB9XG5cbiAgLyoqXG4gICAqIEFwcGVuZHMgYSBjb250aW51YXRpb24tZnJhbWUgcGF5bG9hZCB0byB0aGUgaW4tcHJvZ3Jlc3NcbiAgICogZnJhZ21lbnRlZCBtZXNzYWdlLiBSZXR1cm5zIHRydWUgd2hlbiB0aGUgZnJhZ21lbnQgd2FzIGFjY2VwdGVkXG4gICAqIGFuZCBmYWxzZSB3aGVuIHRoZSBwZXItbWVzc2FnZSBjYXAgd2FzIGhpdCBhbmQgdGhlIHNvY2tldCBoYXNcbiAgICogYmVlbiBjbG9zZWQuXG4gICAqIEBwYXJhbSB7QnVmZmVyfSBwYXlsb2FkIC0gQ29udGludWF0aW9uLWZyYW1lIGJ5dGVzIHRvIGFwcGVuZC5cbiAgICogQHJldHVybnMge2Jvb2xlYW59IC0gV2hldGhlciB0aGUgZnJhZ21lbnQgd2FzIGFjY2VwdGVkLlxuICAgKi9cbiAgX2FwcGVuZEZyYWdtZW50KHBheWxvYWQpIHtcbiAgICAvLyBHdWFyZCBwdXNoaW5nIGZpcnN0IHNvIGBfZW5mb3JjZUZyYWdtZW50TGltaXRzYCBzZWVzIHRoZSBmaW5hbFxuICAgIC8vIHN0YXRlOyBvbiBvdmVyZmxvdyB0aGUgcmVzZXQgaW5zaWRlIHRoZSBlbmZvcmNlciBkcm9wcyB0aGVcbiAgICAvLyBidWZmZXJlZCBmcmFnbWVudHMuXG4gICAgdGhpcy5fZnJhZ21lbnRlZFBheWxvYWRzPy5wdXNoKHBheWxvYWQpXG4gICAgdGhpcy5fZnJhZ21lbnRlZEJ5dGVzICs9IHBheWxvYWQubGVuZ3RoXG5cbiAgICByZXR1cm4gdGhpcy5fZW5mb3JjZUZyYWdtZW50TGltaXRzKClcbiAgfVxuXG4gIC8qKlxuICAgKiBWZXJpZmllcyB0aGUgZnJhZ21lbnRlZCBtZXNzYWdlIGhhcyBub3QgZXhjZWVkZWQgdGhlIGJ5dGUgb3JcbiAgICogZnJhZ21lbnQtY291bnQgY2Fwcy4gT24gb3ZlcmZsb3csIGNsZWFycyB0aGUgYnVmZmVyLCBzZW5kcyBhXG4gICAqIGNsb3NlIGZyYW1lLCBhbmQgdGVhcnMgdGhlIHNlc3Npb24gZG93bi4gUmV0dXJucyB0cnVlIHdoZW4gdGhlXG4gICAqIGNhbGxlciBjYW4gY29udGludWUgcHJvY2Vzc2luZywgZmFsc2Ugd2hlbiB0aGUgc2Vzc2lvbiBpcyBiZWluZ1xuICAgKiBjbG9zZWQuXG4gICAqIEByZXR1cm5zIHtib29sZWFufSAtIFdoZXRoZXIgZnJhZ21lbnQgcHJvY2Vzc2luZyBtYXkgY29udGludWUuXG4gICAqL1xuICBfZW5mb3JjZUZyYWdtZW50TGltaXRzKCkge1xuICAgIGlmICh0aGlzLl9mcmFnbWVudGVkUGF5bG9hZHMgPT09IG51bGwpIHJldHVybiB0cnVlXG5cbiAgICBjb25zdCBmcmFnbWVudENvdW50ID0gdGhpcy5fZnJhZ21lbnRlZFBheWxvYWRzLmxlbmd0aFxuICAgIGNvbnN0IG92ZXJCeXRlcyA9IHRoaXMuX2ZyYWdtZW50ZWRCeXRlcyA+IFdFQlNPQ0tFVF9NQVhfRlJBR01FTlRFRF9NRVNTQUdFX0JZVEVTXG4gICAgY29uc3Qgb3ZlckZyYWdtZW50cyA9IGZyYWdtZW50Q291bnQgPiBXRUJTT0NLRVRfTUFYX0ZSQUdNRU5URURfTUVTU0FHRV9GUkFHTUVOVFNcblxuICAgIGlmICghb3ZlckJ5dGVzICYmICFvdmVyRnJhZ21lbnRzKSByZXR1cm4gdHJ1ZVxuXG4gICAgdGhpcy5sb2dnZXIud2FybigoKSA9PiBbXG4gICAgICBcIkZyYWdtZW50ZWQgd2Vic29ja2V0IG1lc3NhZ2UgZXhjZWVkZWQgY2FwczsgY2xvc2luZyBjb25uZWN0aW9uXCIsXG4gICAgICB7XG4gICAgICAgIGZyYWdtZW50Qnl0ZXM6IHRoaXMuX2ZyYWdtZW50ZWRCeXRlcyxcbiAgICAgICAgZnJhZ21lbnRDb3VudCxcbiAgICAgICAgbWF4Qnl0ZXM6IFdFQlNPQ0tFVF9NQVhfRlJBR01FTlRFRF9NRVNTQUdFX0JZVEVTLFxuICAgICAgICBtYXhGcmFnbWVudHM6IFdFQlNPQ0tFVF9NQVhfRlJBR01FTlRFRF9NRVNTQUdFX0ZSQUdNRU5UU1xuICAgICAgfVxuICAgIF0pXG5cbiAgICB0aGlzLl9jbG9zZUZvckluYm91bmRMaW1pdCgpXG5cbiAgICByZXR1cm4gZmFsc2VcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHJlc2V0IGZyYWdtZW50IGJ1ZmZlci5cbiAgICogQHJldHVybnMge3ZvaWR9ICovXG4gIF9yZXNldEZyYWdtZW50QnVmZmVyKCkge1xuICAgIHRoaXMuX2ZyYWdtZW50ZWRQYXlsb2FkcyA9IG51bGxcbiAgICB0aGlzLl9mcmFnbWVudGVkT3Bjb2RlID0gbnVsbFxuICAgIHRoaXMuX2ZyYWdtZW50ZWRCeXRlcyA9IDBcbiAgfVxuXG4gIC8qKlxuICAgKiBTdGFydHMgdGhlIHBlci1zZXNzaW9uIGhlYXJ0YmVhdC4gRWFjaCB0aWNrIHBpbmdzIHRoZSBjbGllbnQgYW5kXG4gICAqIHJlYXBzIHRoZSBzZXNzaW9uIGlmIHRoZSBwcmV2aW91cyBwaW5nIHdlbnQgdW5hbnN3ZXJlZCwgc28gYVxuICAgKiBoYWxmLW9wZW4gc29ja2V0IChjbGllbnQgZ29uZSB3aXRob3V0IGEgVENQIEZJTiAvIGNsb3NlIGZyYW1lKVxuICAgKiBjYW5ub3QgbGluZ2VyIGZvcmV2ZXIgaG9sZGluZyBjaGFubmVsIHN1YnNjcmlwdGlvbnMuIERpc2FibGVkIHdoZW5cbiAgICogdGhlIGNvbmZpZ3VyZWQgaW50ZXJ2YWwgaXMgMC5cbiAgICogQHJldHVybnMge3ZvaWR9XG4gICAqL1xuICBfc3RhcnRIZWFydGJlYXQoKSB7XG4gICAgY29uc3QgaW50ZXJ2YWxTZWNvbmRzID0gdGhpcy5jb25maWd1cmF0aW9uLmdldFdlYnNvY2tldFNlc3Npb25IZWFydGJlYXRTZWNvbmRzKClcblxuICAgIGlmICghaW50ZXJ2YWxTZWNvbmRzIHx8IGludGVydmFsU2Vjb25kcyA8PSAwKSByZXR1cm5cblxuICAgIHRoaXMuX2hlYXJ0YmVhdFRpbWVyID0gc2V0SW50ZXJ2YWwoKCkgPT4gdGhpcy5faGVhcnRiZWF0VGljaygpLCBpbnRlcnZhbFNlY29uZHMgKiAxMDAwKVxuXG4gICAgLy8gRG9uJ3QgbGV0IHRoZSBoZWFydGJlYXQgdGltZXIga2VlcCB0aGUgcHJvY2VzcyBhbGl2ZS5cbiAgICBpZiAodHlwZW9mIHRoaXMuX2hlYXJ0YmVhdFRpbWVyLnVucmVmID09PSBcImZ1bmN0aW9uXCIpIHRoaXMuX2hlYXJ0YmVhdFRpbWVyLnVucmVmKClcbiAgfVxuXG4gIC8qKlxuICAgKiBPbmUgaGVhcnRiZWF0IGN5Y2xlLiBSZWFwcyB0aGUgc2Vzc2lvbiB2aWEgdGhlIG5vcm1hbCBjbG9zZSBwYXRoXG4gICAqIHdoZW4gdGhlIHByZXZpb3VzIHBpbmcgd2FzIG5vdCBhbnN3ZXJlZDsgb3RoZXJ3aXNlIG1hcmtzIGl0XG4gICAqIHBlbmRpbmcgYW5kIHBpbmdzIGFnYWluLiBCcm93c2VycyBhbmQgUmVhY3QgTmF0aXZlIHNvY2tldHMgYW5zd2VyXG4gICAqIHNlcnZlciBwaW5ncyB3aXRoIGFuIGF1dG9tYXRpYyBwb25nLCB3aGljaCBsYW5kcyBpbiBgX3Byb2Nlc3NCdWZmZXJgXG4gICAqIGFuZCByZS1tYXJrcyB0aGUgc2Vzc2lvbiBhbGl2ZS5cbiAgICogQHJldHVybnMge3ZvaWR9XG4gICAqL1xuICBfaGVhcnRiZWF0VGljaygpIHtcbiAgICBpZiAodGhpcy5fcGF1c2VkIHx8ICF0aGlzLmNsaWVudD8uZXZlbnRzKSByZXR1cm5cblxuICAgIGlmICghdGhpcy5faGVhcnRiZWF0QWxpdmUpIHtcbiAgICAgIC8vIE5vIGZyYW1lIGFycml2ZWQgc2luY2UgdGhlIGxhc3QgcGluZyDigJQgdGhlIHNvY2tldCBpcyBkZWFkLlxuICAgICAgLy8gUm91dGUgdGhyb3VnaCBgX2hhbmRsZUNsb3NlYCBzbyByZXN1bWFibGUgc3RhdGUgc3RpbGwgcGF1c2VzXG4gICAgICAvLyBmb3IgdGhlIGdyYWNlIHdpbmRvdyBhbmQgZXZlcnl0aGluZyBlbHNlIGlzIHRvcm4gZG93bi5cbiAgICAgIHRoaXMuX3N0b3BIZWFydGJlYXQoKVxuICAgICAgdGhpcy5faGFuZGxlQ2xvc2UoKVxuICAgICAgcmV0dXJuXG4gICAgfVxuXG4gICAgdGhpcy5faGVhcnRiZWF0QWxpdmUgPSBmYWxzZVxuICAgIHRoaXMuX3NlbmRDb250cm9sRnJhbWUoV0VCU09DS0VUX09QQ09ERV9QSU5HLCBCdWZmZXIuYWxsb2MoMCkpXG4gIH1cblxuICAvKipcbiAgICogU3RvcHMgdGhlIHBlci1zZXNzaW9uIGhlYXJ0YmVhdCB0aW1lciwgaWYgYW55LlxuICAgKiBAcmV0dXJucyB7dm9pZH1cbiAgICovXG4gIF9zdG9wSGVhcnRiZWF0KCkge1xuICAgIGlmICh0aGlzLl9oZWFydGJlYXRUaW1lcikge1xuICAgICAgY2xlYXJJbnRlcnZhbCh0aGlzLl9oZWFydGJlYXRUaW1lcilcbiAgICAgIHRoaXMuX2hlYXJ0YmVhdFRpbWVyID0gbnVsbFxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHNlbmQgY29udHJvbCBmcmFtZS5cbiAgICogQHBhcmFtIHtudW1iZXJ9IG9wY29kZSAtIE9wY29kZS5cbiAgICogQHBhcmFtIHtCdWZmZXJ9IHBheWxvYWQgLSBQYXlsb2FkIGRhdGEuXG4gICAqIEByZXR1cm5zIHt2b2lkfSAtIE5vIHJldHVybiB2YWx1ZS5cbiAgICovXG4gIF9zZW5kQ29udHJvbEZyYW1lKG9wY29kZSwgcGF5bG9hZCkge1xuICAgIGNvbnN0IGhlYWRlciA9IEJ1ZmZlci5hbGxvYygyKVxuXG4gICAgaGVhZGVyWzBdID0gV0VCU09DS0VUX0ZJTkFMX0ZSQU1FIHwgb3Bjb2RlXG4gICAgaGVhZGVyWzFdID0gcGF5bG9hZC5sZW5ndGhcblxuICAgIHRoaXMuY2xpZW50LmV2ZW50cy5lbWl0KFwib3V0cHV0XCIsIEJ1ZmZlci5jb25jYXQoW2hlYWRlciwgcGF5bG9hZF0pLCB7d2Vic29ja2V0RnJhbWU6IHRydWV9KVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgc2VuZCBqc29uLlxuICAgKiBAcGFyYW0ge29iamVjdH0gYm9keSAtIFJlcXVlc3QgYm9keS5cbiAgICogQHJldHVybnMge3ZvaWR9IC0gTm8gcmV0dXJuIHZhbHVlLlxuICAgKi9cbiAgc2VuZEpzb24oYm9keSkge1xuICAgIC8vIFdoaWxlIHBhdXNlZCAod2FpdGluZyBmb3IgYSByZXN1bWUpLCBzdGFzaCBmcmFtZXMgaW4gYW5cbiAgICAvLyBvdXRib3VuZCBxdWV1ZSBhbmQgZmx1c2ggdGhlbSBpbiBvcmRlciBvbiByZXN1bWUuIENhcHBlZCB0b1xuICAgIC8vIHByZXZlbnQgcnVuYXdheSBtZW1vcnkgdXNlIHdoaWxlIHRoZSBjbGllbnQgaXMgb2ZmbGluZS5cbiAgICBpZiAodGhpcy5fcGF1c2VkKSB7XG4gICAgICB0aGlzLl9vdXRib3VuZFF1ZXVlIHx8PSBbXVxuXG4gICAgICBpZiAodGhpcy5fb3V0Ym91bmRRdWV1ZS5sZW5ndGggPj0gV0VCU09DS0VUX1BBVVNFRF9RVUVVRV9DQVApIHtcbiAgICAgICAgLy8gRHJvcCBvbGRlc3Qgc28gdGhlIG1vc3QgcmVjZW50IGFjdGl2aXR5IHdpbnMgb24gcmVzdW1lLlxuICAgICAgICB0aGlzLl9vdXRib3VuZFF1ZXVlLnNoaWZ0KClcbiAgICAgIH1cblxuICAgICAgdGhpcy5fb3V0Ym91bmRRdWV1ZS5wdXNoKGJvZHkpXG4gICAgICByZXR1cm5cbiAgICB9XG5cbiAgICBpZiAoIXRoaXMuY2xpZW50Py5ldmVudHMpIHJldHVyblxuXG4gICAgY29uc3QganNvbiA9IEpTT04uc3RyaW5naWZ5KGJvZHkpXG4gICAgY29uc3QgcGF5bG9hZCA9IEJ1ZmZlci5mcm9tKGpzb24sIFwidXRmLThcIilcbiAgICBsZXQgaGVhZGVyXG5cbiAgICBpZiAocGF5bG9hZC5sZW5ndGggPCAxMjYpIHtcbiAgICAgIGhlYWRlciA9IEJ1ZmZlci5hbGxvYygyKVxuICAgICAgaGVhZGVyWzFdID0gcGF5bG9hZC5sZW5ndGhcbiAgICB9IGVsc2UgaWYgKHBheWxvYWQubGVuZ3RoIDwgNjU1MzYpIHtcbiAgICAgIGhlYWRlciA9IEJ1ZmZlci5hbGxvYyg0KVxuICAgICAgaGVhZGVyWzFdID0gMTI2XG4gICAgICBoZWFkZXIud3JpdGVVSW50MTZCRShwYXlsb2FkLmxlbmd0aCwgMilcbiAgICB9IGVsc2Uge1xuICAgICAgaGVhZGVyID0gQnVmZmVyLmFsbG9jKDEwKVxuICAgICAgaGVhZGVyWzFdID0gMTI3XG4gICAgICBoZWFkZXIud3JpdGVCaWdVSW50NjRCRShCaWdJbnQocGF5bG9hZC5sZW5ndGgpLCAyKVxuICAgIH1cblxuICAgIGhlYWRlclswXSA9IFdFQlNPQ0tFVF9GSU5BTF9GUkFNRSB8IFdFQlNPQ0tFVF9PUENPREVfVEVYVFxuXG4gICAgdGhpcy5jbGllbnQuZXZlbnRzLmVtaXQoXCJvdXRwdXRcIiwgQnVmZmVyLmNvbmNhdChbaGVhZGVyLCBwYXlsb2FkXSksIHt3ZWJzb2NrZXRGcmFtZTogdHJ1ZX0pXG4gIH1cblxuICAvKipcbiAgICogRmx1c2hlcyB0aGUgcGF1c2VkIG91dGJvdW5kIHF1ZXVlIG92ZXIgdGhlIGN1cnJlbnQgc29ja2V0LlxuICAgKiBDYWxsZWQgZHVyaW5nIHJlc3VtZSBhZnRlciBgc2Vzc2lvbi1yZXN1bWVkYCBoYXMgYmVlbiBzZW50IG9uXG4gICAqIHRoZSBORVcgc2Vzc2lvbidzIHNvY2tldCAobm90IHRoaXMgc2Vzc2lvbidzKS5cbiAgICogQHJldHVybnMge3ZvaWR9XG4gICAqL1xuICBfZmx1c2hPdXRib3VuZFF1ZXVlKCkge1xuICAgIGNvbnN0IHF1ZXVlID0gdGhpcy5fb3V0Ym91bmRRdWV1ZSB8fCBbXVxuXG4gICAgdGhpcy5fb3V0Ym91bmRRdWV1ZSA9IFtdXG5cbiAgICBmb3IgKGNvbnN0IGJvZHkgb2YgcXVldWUpIHtcbiAgICAgIHRoaXMuc2VuZEpzb24oYm9keSlcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogUnVucyBzdWJzY3JpYmUgdG8gY2hhbm5lbC5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGNoYW5uZWwgLSBDaGFubmVsIG5hbWUuXG4gICAqIEBwYXJhbSB7e2Fja25vd2xlZGdlPzogYm9vbGVhbiwgY2hhbm5lbEhhbmRsZXI/OiBpbXBvcnQoXCIuLi93ZWJzb2NrZXQtY2hhbm5lbC5qc1wiKS5kZWZhdWx0LCBsYXN0RXZlbnRJZD86IHN0cmluZywgcGFyYW1zPzogUmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+LCBzdWJzY3JpcHRpb25DaGFubmVsPzogc3RyaW5nfX0gW29wdGlvbnNdIC0gU3Vic2NyaWJlIG9wdGlvbnMuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPGJvb2xlYW4+fSAtIFdoZXRoZXIgdGhlIHN1YnNjcmlwdGlvbiB3YXMgYWRkZWQuXG4gICAqL1xuICBhc3luYyBzdWJzY3JpYmVUb0NoYW5uZWwoY2hhbm5lbCwge2Fja25vd2xlZGdlID0gdHJ1ZSwgY2hhbm5lbEhhbmRsZXIsIGxhc3RFdmVudElkLCBwYXJhbXMsIHN1YnNjcmlwdGlvbkNoYW5uZWx9ID0ge30pIHtcbiAgICBhd2FpdCB3ZWJzb2NrZXRFdmVudExvZ1N0b3JlRm9yQ29uZmlndXJhdGlvbih0aGlzLmNvbmZpZ3VyYXRpb24pLm1hcmtDaGFubmVsSW50ZXJlc3RlZChjaGFubmVsKVxuXG4gICAgY29uc3QgcmVwbGF5U3RhdGUgPSBhd2FpdCB0aGlzLl9wcmVwYXJlUmVwbGF5U3RhdGUoe1xuICAgICAgY2hhbm5lbCxcbiAgICAgIGxhc3RFdmVudElkLFxuICAgICAgc3Vic2NyaXB0aW9uQ2hhbm5lbDogc3Vic2NyaXB0aW9uQ2hhbm5lbCB8fCBjaGFubmVsLFxuICAgICAgc3Vic2NyaXB0aW9uUGFyYW1zOiBwYXJhbXNcbiAgICB9KVxuXG4gICAgaWYgKHJlcGxheVN0YXRlID09PSBmYWxzZSkgcmV0dXJuIGZhbHNlXG4gICAgaWYgKHJlcGxheVN0YXRlKSB7XG4gICAgICB0aGlzLmNoYW5uZWxSZXBsYXlTdGF0ZXMuc2V0KGNoYW5uZWwsIHJlcGxheVN0YXRlKVxuICAgIH1cblxuICAgIHRoaXMuYWRkU3Vic2NyaXB0aW9uKGNoYW5uZWwpXG5cbiAgICBpZiAoY2hhbm5lbEhhbmRsZXIpIHtcbiAgICAgIGlmICghdGhpcy5zdWJzY3JpcHRpb25IYW5kbGVycy5oYXMoY2hhbm5lbCkpIHtcbiAgICAgICAgdGhpcy5zdWJzY3JpcHRpb25IYW5kbGVycy5zZXQoY2hhbm5lbCwgbmV3IFNldCgpKVxuICAgICAgfVxuXG4gICAgICB0aGlzLnN1YnNjcmlwdGlvbkhhbmRsZXJzLmdldChjaGFubmVsKT8uYWRkKGNoYW5uZWxIYW5kbGVyKVxuXG4gICAgICBpZiAoIXRoaXMuaGFuZGxlclN1YnNjcmlwdGlvbnMuaGFzKGNoYW5uZWxIYW5kbGVyKSkge1xuICAgICAgICB0aGlzLmhhbmRsZXJTdWJzY3JpcHRpb25zLnNldChjaGFubmVsSGFuZGxlciwgbmV3IFNldCgpKVxuICAgICAgfVxuXG4gICAgICB0aGlzLmhhbmRsZXJTdWJzY3JpcHRpb25zLmdldChjaGFubmVsSGFuZGxlcik/LmFkZChjaGFubmVsKVxuICAgIH1cblxuICAgIGlmIChyZXBsYXlTdGF0ZSkge1xuICAgICAgdHJ5IHtcbiAgICAgICAgYXdhaXQgdGhpcy5fcmVwbGF5Q2hhbm5lbEV2ZW50cyh7Y2hhbm5lbCwgcmVwbGF5U3RhdGV9KVxuICAgICAgfSBmaW5hbGx5IHtcbiAgICAgICAgYXdhaXQgdGhpcy5fZmluaXNoUmVwbGF5U3RhdGUoY2hhbm5lbCwgcmVwbGF5U3RhdGUpXG4gICAgICB9XG4gICAgfVxuXG4gICAgaWYgKGFja25vd2xlZGdlKSB7XG4gICAgICB0aGlzLnNlbmRKc29uKHtjaGFubmVsLCB0eXBlOiBcInN1YnNjcmliZWRcIn0pXG4gICAgfVxuICAgIHJldHVybiB0cnVlXG4gIH1cblxuICAvKipcbiAgICogSGFuZGxlcyBzb2NrZXQgY2xvc3VyZSBhbmQgb3B0aW9uYWxseSByZXRhaW5zIHJlc3VtYWJsZSBzdGF0ZS5cbiAgICogQHBhcmFtIHt7YWxsb3dSZXN1bWU/OiBib29sZWFufX0gW29wdGlvbnNdIC0gQ2xvc3VyZSBiZWhhdmlvci5cbiAgICogQHJldHVybnMge3ZvaWR9XG4gICAqL1xuICBfaGFuZGxlQ2xvc2Uoe2FsbG93UmVzdW1lID0gdHJ1ZX0gPSB7fSkge1xuICAgIHRoaXMuX3Jlc2V0RnJhZ21lbnRCdWZmZXIoKVxuICAgIHRoaXMuX2NsZWFyQnVmZmVyZWRGcmFtZUNodW5rcygpXG4gICAgdGhpcy5fYWJhbmRvbkluYm91bmRNZXNzYWdlcygpXG5cbiAgICAvLyBJZiB0aGUgc2Vzc2lvbiBoYXMgcmVzdW1hYmxlIHN0YXRlIChsaXZlIENvbm5lY3Rpb24gb3JcbiAgICAvLyBDaGFubmVsVjIgc3Vic2NyaXB0aW9uKSwgbW92ZSBpdCBpbnRvIHRoZSBwYXVzZWQgcmVnaXN0cnlcbiAgICAvLyBpbnN0ZWFkIG9mIHRlYXJpbmcgZG93bjsgYSBuZXcgc29ja2V0IHByZXNlbnRpbmcgdGhlIHNlc3Npb25JZFxuICAgIC8vIHZpYSBgc2Vzc2lvbi1yZXN1bWVgIHdpdGhpbiB0aGUgZ3JhY2Ugd2luZG93IHdpbGwgcmVhdHRhY2guXG4gICAgY29uc3QgaGFzUmVzdW1hYmxlU3RhdGUgPSB0aGlzLl9jb25uZWN0aW9ucy5zaXplID4gMCB8fCB0aGlzLl9jaGFubmVsU3Vic2NyaXB0aW9ucy5zaXplID4gMFxuXG4gICAgaWYgKGFsbG93UmVzdW1lICYmIGhhc1Jlc3VtYWJsZVN0YXRlICYmICF0aGlzLl9wYXVzZWQpIHtcbiAgICAgIC8vIFBhdXNlZCBzZXNzaW9ucyBoYXZlIG5vIGxpdmUgc29ja2V0IHRvIHBpbmc7IHRoZSBncmFjZSB0aW1lclxuICAgICAgLy8gb3ducyB0aGVpciBldmVudHVhbCB0ZWFyZG93biBmcm9tIGhlcmUuXG4gICAgICB0aGlzLl9zdG9wSGVhcnRiZWF0KClcbiAgICAgIHRoaXMuX3BhdXNlZCA9IHRydWVcbiAgICAgIHRoaXMuc29ja2V0ID0gbnVsbFxuICAgICAgLy8gS2ljayBvZmYgYXV0aC1pZGVudGl0eSBjYXB0dXJlIGZvciByZXN1bWUgdmVyaWZpY2F0aW9uLiBSdW5zXG4gICAgICAvLyBpbiB0aGUgYmFja2dyb3VuZCDigJQgYF9oYW5kbGVTZXNzaW9uUmVzdW1lYCBhd2FpdHNcbiAgICAgIC8vIGBfcmVzdW1lSWRlbnRpdHlQcm9taXNlYCBiZWZvcmUgY29tcGFyaW5nLiBQYXVzZSByZWdpc3RyYXRpb25cbiAgICAgIC8vIGlzIHN5bmNocm9ub3VzIHNvIGEgcmVzdW1lIGFycml2aW5nIGltbWVkaWF0ZWx5IHN0aWxsIGZpbmRzXG4gICAgICAvLyB0aGUgc2Vzc2lvbi5cbiAgICAgIHRoaXMuX3Jlc3VtZUlkZW50aXR5UHJvbWlzZSA9IHRoaXMuX2NhcHR1cmVSZXN1bWVJZGVudGl0eSgpXG4gICAgICB2b2lkIHRoaXMuX2ZpcmVPbkRpc2Nvbm5lY3QoKVxuICAgICAgdGhpcy5jb25maWd1cmF0aW9uLl9wYXVzZVdlYnNvY2tldFNlc3Npb24odGhpcylcbiAgICAgIHRoaXMuZXZlbnRzLmVtaXQoXCJjbG9zZVwiKVxuICAgICAgcmV0dXJuXG4gICAgfVxuXG4gICAgdGhpcy5fc3RvcEhlYXJ0YmVhdCgpXG4gICAgdGhpcy5fcmVsZWFzZU93bmVyc2hpcCgpXG4gICAgdGhpcy5jb25maWd1cmF0aW9uLl93ZWJzb2NrZXRTZXNzaW9ucy5kZWxldGUodGhpcylcbiAgICB2b2lkIHRoaXMuX3J1bk1lc3NhZ2VIYW5kbGVyQ2xvc2UoKVxuICAgIHZvaWQgdGhpcy5fdGVhcmRvd25DaGFubmVsKClcbiAgICB2b2lkIHRoaXMuX3RlYXJkb3duQ29ubmVjdGlvbnMoXCJzZXNzaW9uX2Rlc3Ryb3llZFwiKVxuICAgIHZvaWQgdGhpcy5fdGVhcmRvd25DaGFubmVsU3Vic2NyaXB0aW9ucygpXG4gICAgdGhpcy5ldmVudHMuZW1pdChcImNsb3NlXCIpXG4gIH1cblxuICAvKipcbiAgICogQ2FsbGVkIGJ5IHRoZSBncmFjZSB0aW1lciB3aGVuIHRoZSBwYXVzZWQgcGVyaW9kIGV4cGlyZXMgd2l0aG91dFxuICAgKiBhIHJlc3VtZS4gVGVhcnMgZG93biBhbGwgbGl2ZSBDb25uZWN0aW9ucyArIENoYW5uZWwgc3VicyBhbmRcbiAgICogZHJvcHMgdGhlIHNlc3Npb24uXG4gICAqIEByZXR1cm5zIHt2b2lkfVxuICAgKi9cbiAgX2ZpbmFsaXplR3JhY2VFeHBpcnkoKSB7XG4gICAgdGhpcy5fc3RvcEhlYXJ0YmVhdCgpXG4gICAgdGhpcy5fcmVsZWFzZU93bmVyc2hpcCgpXG4gICAgdGhpcy5fcmVzZXRGcmFnbWVudEJ1ZmZlcigpXG4gICAgdGhpcy5fY2xlYXJCdWZmZXJlZEZyYW1lQ2h1bmtzKClcbiAgICB0aGlzLl9hYmFuZG9uSW5ib3VuZE1lc3NhZ2VzKClcbiAgICB0aGlzLmNvbmZpZ3VyYXRpb24uX3dlYnNvY2tldFNlc3Npb25zLmRlbGV0ZSh0aGlzKVxuICAgIHZvaWQgdGhpcy5fcnVuTWVzc2FnZUhhbmRsZXJDbG9zZSgpXG4gICAgdm9pZCB0aGlzLl90ZWFyZG93bkNoYW5uZWwoKVxuICAgIHZvaWQgdGhpcy5fdGVhcmRvd25Db25uZWN0aW9ucyhcImdyYWNlX2V4cGlyZWRcIilcbiAgICB2b2lkIHRoaXMuX3RlYXJkb3duQ2hhbm5lbFN1YnNjcmlwdGlvbnMoKVxuICAgIHRoaXMuZXZlbnRzLmVtaXQoXCJjbG9zZVwiKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgdGhlIGNvbmZpZ3VyZWQgaWRlbnRpdHkgcmVzb2x2ZXIgYWdhaW5zdCB0aGlzIHNlc3Npb24uXG4gICAqIFRoZSByZXR1cm5lZCBwcm9taXNlIGlzIHN0b3JlZCBhdCBwYXVzZSB0aW1lIGFuZCBhd2FpdGVkIGF0XG4gICAqIHJlc3VtZSB0aW1lIHNvIHdlIGNhbiByZWplY3QgcmVzdW1lIGF0dGVtcHRzIGZyb20gYSBkaWZmZXJlbnRcbiAgICogYXV0aGVudGljYXRlZCBjYWxsZXIgKHNpZ25lZCBvdXQsIHN3YXBwZWQgdXNlciwgZXhwaXJlZCBjb29raWUpLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59IC0gQ2FwdHVyZWQgYXV0aGVudGljYXRlZCBpZGVudGl0eSBmb3IgcmVzdW1lIHZhbGlkYXRpb24uXG4gICAqL1xuICBhc3luYyBfY2FwdHVyZVJlc3VtZUlkZW50aXR5KCkge1xuICAgIGNvbnN0IHJlc29sdmVyID0gdGhpcy5jb25maWd1cmF0aW9uLmdldFdlYnNvY2tldFNlc3Npb25JZGVudGl0eVJlc29sdmVyPy4oKVxuXG4gICAgaWYgKHR5cGVvZiByZXNvbHZlciAhPT0gXCJmdW5jdGlvblwiKSByZXR1cm4gdW5kZWZpbmVkXG5cbiAgICB0cnkge1xuICAgICAgcmV0dXJuIGF3YWl0IHJlc29sdmVyKHRoaXMpXG4gICAgfSBjYXRjaCAoY2F1Z2h0RXJyb3IpIHtcbiAgICAgIGNvbnN0IGVycm9yID0gdGhpcy5fcmVwb3J0VW5leHBlY3RlZERpc3BhdGNoRXJyb3IoY2F1Z2h0RXJyb3IsIHtcbiAgICAgICAgc3RhZ2U6IFwid2Vic29ja2V0LXNlc3Npb24taWRlbnRpdHktcGF1c2VcIlxuICAgICAgfSlcblxuICAgICAgdGhpcy5sb2dnZXIuZXJyb3IoKCkgPT4gW1wiV2Vic29ja2V0IHNlc3Npb24gaWRlbnRpdHkgcmVzb2x2ZXIgZmFpbGVkIGF0IHBhdXNlXCIsIGVycm9yXSlcbiAgICAgIHJldHVybiB1bmRlZmluZWRcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogRmlyZXMgYG9uRGlzY29ubmVjdGAgb24gZXZlcnkgbGl2ZSBDb25uZWN0aW9uIGFuZCBDaGFubmVsIHN1YiBzb1xuICAgKiBhcHBzIGNhbiBwYXVzZSBwZXItaW5zdGFuY2Ugd29yayB3aGlsZSB0aGUgc2Vzc2lvbiBpcyBwYXVzZWQuXG4gICAqIEVycm9ycyBhcmUgbG9nZ2VkLCBub3QgcmV0aHJvd24g4oCUIG9uZSBicm9rZW4gaGFuZGxlciBtdXN0IG5vdFxuICAgKiBibG9jayB0aGUgcmVzdC5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59XG4gICAqL1xuICBhc3luYyBfZmlyZU9uRGlzY29ubmVjdCgpIHtcbiAgICBhd2FpdCB0aGlzLl9maXJlTGlmZWN5Y2xlQ2FsbGJhY2soXCJvbkRpc2Nvbm5lY3RcIilcbiAgfVxuXG4gIC8qKlxuICAgKiBGaXJlcyBgb25SZXN1bWVgIG9uIGV2ZXJ5IGxpdmUgQ29ubmVjdGlvbiBhbmQgQ2hhbm5lbCBzdWIgYWZ0ZXJcbiAgICogYSBzdWNjZXNzZnVsIGBzZXNzaW9uLXJlc3VtZWAgaGFuZG9mZi5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59XG4gICAqL1xuICBhc3luYyBfZmlyZU9uUmVzdW1lKCkge1xuICAgIGF3YWl0IHRoaXMuX2ZpcmVMaWZlY3ljbGVDYWxsYmFjayhcIm9uUmVzdW1lXCIpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBmaXJlIGxpZmVjeWNsZSBjYWxsYmFjay5cbiAgICogQHBhcmFtIHtcIm9uRGlzY29ubmVjdFwiIHwgXCJvblJlc3VtZVwifSBjYWxsYmFja05hbWUgTGlmZWN5Y2xlIGNhbGxiYWNrIHRvIGZpcmUuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSBSZXNvbHZlcyB3aGVuIGV2ZXJ5IGxpdmUgaGFuZGxlciBoYXMgYmVlbiBhdHRlbXB0ZWQuXG4gICAqL1xuICBhc3luYyBfZmlyZUxpZmVjeWNsZUNhbGxiYWNrKGNhbGxiYWNrTmFtZSkge1xuICAgIGZvciAoY29uc3QgY29ubmVjdGlvbiBvZiB0aGlzLl9jb25uZWN0aW9ucy52YWx1ZXMoKSkge1xuICAgICAgdHJ5IHtcbiAgICAgICAgYXdhaXQgY29ubmVjdGlvbltjYWxsYmFja05hbWVdPy4oKVxuICAgICAgfSBjYXRjaCAoY2F1Z2h0RXJyb3IpIHtcbiAgICAgICAgY29uc3QgZXJyb3IgPSB0aGlzLl9yZXBvcnRVbmV4cGVjdGVkRGlzcGF0Y2hFcnJvcihjYXVnaHRFcnJvciwge1xuICAgICAgICAgIGNhbGxiYWNrTmFtZSxcbiAgICAgICAgICBjb25uZWN0aW9uSWQ6IGNvbm5lY3Rpb24uY29ubmVjdGlvbklkLFxuICAgICAgICAgIHN0YWdlOiBcIndlYnNvY2tldC1jb25uZWN0aW9uLWxpZmVjeWNsZVwiXG4gICAgICAgIH0pXG5cbiAgICAgICAgdGhpcy5sb2dnZXIuZXJyb3IoKCkgPT4gW2Ake2NhbGxiYWNrTmFtZX0gZmFpbGVkIGZvciAke2Nvbm5lY3Rpb24uY29ubmVjdGlvbklkfWAsIGVycm9yXSlcbiAgICAgIH1cbiAgICB9XG5cbiAgICBmb3IgKGNvbnN0IHtzdWJzY3JpcHRpb259IG9mIHRoaXMuX2NoYW5uZWxTdWJzY3JpcHRpb25zLnZhbHVlcygpKSB7XG4gICAgICB0cnkge1xuICAgICAgICBhd2FpdCBzdWJzY3JpcHRpb25bY2FsbGJhY2tOYW1lXT8uKClcbiAgICAgIH0gY2F0Y2ggKGNhdWdodEVycm9yKSB7XG4gICAgICAgIGNvbnN0IGVycm9yID0gdGhpcy5fcmVwb3J0VW5leHBlY3RlZERpc3BhdGNoRXJyb3IoY2F1Z2h0RXJyb3IsIHtcbiAgICAgICAgICBjYWxsYmFja05hbWUsXG4gICAgICAgICAgc3RhZ2U6IFwid2Vic29ja2V0LWNoYW5uZWwtbGlmZWN5Y2xlXCIsXG4gICAgICAgICAgc3Vic2NyaXB0aW9uSWQ6IHN1YnNjcmlwdGlvbi5zdWJzY3JpcHRpb25JZFxuICAgICAgICB9KVxuXG4gICAgICAgIHRoaXMubG9nZ2VyLmVycm9yKCgpID0+IFtgJHtjYWxsYmFja05hbWV9IGZhaWxlZCBmb3IgY2hhbm5lbCBzdWIgJHtzdWJzY3JpcHRpb24uc3Vic2NyaXB0aW9uSWR9YCwgZXJyb3JdKVxuICAgICAgfVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBIYW5kbGVzIGB7dHlwZTogXCJzZXNzaW9uLXJlc3VtZVwifWAuIFRoaXMgc2Vzc2lvbiAodGhlIG5ld2x5LVxuICAgKiBjcmVhdGVkIG9uZSB3aG9zZSBzb2NrZXQganVzdCBjb25uZWN0ZWQpIHRyYW5zZmVycyBzdGF0ZSBmcm9tXG4gICAqIHRoZSBwYXVzZWQgc2Vzc2lvbiBhbmQgaW5zdHJ1Y3RzIHRoZSBjbGllbnQgdmlhXG4gICAqIGBzZXNzaW9uLXJlc3VtZWRgIG9yIGBzZXNzaW9uLWdvbmVgLlxuICAgKiBAcGFyYW0ge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gbWVzc2FnZSAtIFNlc3Npb24tcmVzdW1lIGZyYW1lIGNvbnRhaW5pbmcgdGhlIHBhdXNlZCBzZXNzaW9uIGlkZW50aWZpZXIuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fVxuICAgKi9cbiAgYXN5bmMgX2hhbmRsZVNlc3Npb25SZXN1bWUobWVzc2FnZSkge1xuICAgIGNvbnN0IHJlc3VtZVNlc3Npb25JZCA9IG1lc3NhZ2Uuc2Vzc2lvbklkXG5cbiAgICBpZiAodHlwZW9mIHJlc3VtZVNlc3Npb25JZCAhPT0gXCJzdHJpbmdcIiB8fCAhcmVzdW1lU2Vzc2lvbklkKSB7XG4gICAgICB0aGlzLnNlbmRKc29uKHt0eXBlOiBcInNlc3Npb24tZ29uZVwifSlcbiAgICAgIHJldHVyblxuICAgIH1cblxuICAgIGNvbnN0IHBhdXNlZCA9IHRoaXMuY29uZmlndXJhdGlvbi5fZmluZFBhdXNlZFdlYnNvY2tldFNlc3Npb24ocmVzdW1lU2Vzc2lvbklkKVxuXG4gICAgaWYgKCFwYXVzZWQpIHtcbiAgICAgIHRoaXMuc2VuZEpzb24oe3R5cGU6IFwic2Vzc2lvbi1nb25lXCJ9KVxuICAgICAgcmV0dXJuXG4gICAgfVxuXG4gICAgLy8gQXV0aCByZS12ZXJpZnk6IGNvbXBhcmUgdGhlIGZyZXNoIGNhbGxlcidzIGlkZW50aXR5IGFnYWluc3QgdGhlXG4gICAgLy8gb25lIGNhcHR1cmVkIGF0IHBhdXNlLiBNaXNtYXRjaCBtZWFucyBhIGRpZmZlcmVudCB1c2VyIChvciBhXG4gICAgLy8gc2lnbmVkLW91dCBzZXNzaW9uKSBpcyB0cnlpbmcgdG8gcmVjbGFpbSBzdGF0ZSB0aGF0IGlzbid0XG4gICAgLy8gdGhlaXJzIOKAlCBkZXN0cm95IHRoZSBwYXVzZWQgc2Vzc2lvbiBvdXRyaWdodC5cbiAgICBjb25zdCByZXNvbHZlciA9IHRoaXMuY29uZmlndXJhdGlvbi5nZXRXZWJzb2NrZXRTZXNzaW9uSWRlbnRpdHlSZXNvbHZlcj8uKClcblxuICAgIGlmICh0eXBlb2YgcmVzb2x2ZXIgPT09IFwiZnVuY3Rpb25cIikge1xuICAgICAgY29uc3QgcGF1c2VkSWRlbnRpdHkgPSBhd2FpdCBwYXVzZWQuX3Jlc3VtZUlkZW50aXR5UHJvbWlzZVxuICAgICAgbGV0IGZyZXNoSWRlbnRpdHlcblxuICAgICAgdHJ5IHtcbiAgICAgICAgZnJlc2hJZGVudGl0eSA9IGF3YWl0IHJlc29sdmVyKHRoaXMpXG4gICAgICB9IGNhdGNoIChjYXVnaHRFcnJvcikge1xuICAgICAgICBjb25zdCBlcnJvciA9IHRoaXMuX3JlcG9ydFVuZXhwZWN0ZWREaXNwYXRjaEVycm9yKGNhdWdodEVycm9yLCB7XG4gICAgICAgICAgc3RhZ2U6IFwid2Vic29ja2V0LXNlc3Npb24taWRlbnRpdHktcmVzdW1lXCJcbiAgICAgICAgfSlcblxuICAgICAgICB0aGlzLmxvZ2dlci5lcnJvcigoKSA9PiBbXCJXZWJzb2NrZXQgc2Vzc2lvbiBpZGVudGl0eSByZXNvbHZlciBmYWlsZWQgYXQgcmVzdW1lXCIsIGVycm9yXSlcbiAgICAgICAgZnJlc2hJZGVudGl0eSA9IHVuZGVmaW5lZFxuICAgICAgfVxuXG4gICAgICBpZiAoIWlkZW50aXRpZXNNYXRjaChwYXVzZWRJZGVudGl0eSwgZnJlc2hJZGVudGl0eSkpIHtcbiAgICAgICAgdGhpcy5jb25maWd1cmF0aW9uLl9jbGVhclBhdXNlZFdlYnNvY2tldFNlc3Npb24ocmVzdW1lU2Vzc2lvbklkKVxuICAgICAgICBwYXVzZWQuX2ZpbmFsaXplR3JhY2VFeHBpcnkoKVxuICAgICAgICB0aGlzLnNlbmRKc29uKHt0eXBlOiBcInNlc3Npb24tZ29uZVwifSlcbiAgICAgICAgcmV0dXJuXG4gICAgICB9XG4gICAgfVxuXG4gICAgdGhpcy5jb25maWd1cmF0aW9uLl9jbGVhclBhdXNlZFdlYnNvY2tldFNlc3Npb24ocmVzdW1lU2Vzc2lvbklkKVxuXG4gICAgdGhpcy5fcmVsZWFzZU93bmVyc2hpcCgpXG4gICAgcGF1c2VkLl9yZWxlYXNlT3duZXJzaGlwKClcblxuICAgIC8vIFRyYW5zZmVyIHJlc3VtYWJsZSBzdGF0ZSBvbnRvIHRoaXMgKGxpdmUpIHNlc3Npb24uIFRoZSBwYXVzZWRcbiAgICAvLyBzZXNzaW9uIHNoZWxsIGlzIGRpc2NhcmRlZCBhZnRlciB0aGUgdHJhbnNmZXIuXG4gICAgZm9yIChjb25zdCBbY29ubmVjdGlvbklkLCBjb25uZWN0aW9uXSBvZiBwYXVzZWQuX2Nvbm5lY3Rpb25zKSB7XG4gICAgICBjb25uZWN0aW9uLnNlc3Npb24gPSB0aGlzXG4gICAgICB0aGlzLl9jb25uZWN0aW9ucy5zZXQoY29ubmVjdGlvbklkLCBjb25uZWN0aW9uKVxuICAgIH1cblxuICAgIGZvciAoY29uc3QgW3N1YklkLCBlbnRyeV0gb2YgcGF1c2VkLl9jaGFubmVsU3Vic2NyaXB0aW9ucykge1xuICAgICAgZW50cnkuc3Vic2NyaXB0aW9uLnNlc3Npb24gPSB0aGlzXG4gICAgICB0aGlzLl9jaGFubmVsU3Vic2NyaXB0aW9ucy5zZXQoc3ViSWQsIGVudHJ5KVxuICAgIH1cblxuICAgIHRoaXMuX21ldGFkYXRhID0gey4uLnBhdXNlZC5fbWV0YWRhdGF9XG4gICAgdGhpcy5kYXRhID0gcGF1c2VkLmRhdGFcbiAgICB0aGlzLnNlc3Npb25JZCA9IHJlc3VtZVNlc3Npb25JZFxuXG4gICAgLy8gVHJhbnNmZXIgYW55IGZyYW1lcyBxdWV1ZWQgd2hpbGUgdGhlIHBhdXNlZCBzZXNzaW9uIGhhZCBub1xuICAgIC8vIHNvY2tldC4gVGhleSBmbHVzaCBBRlRFUiBzZXNzaW9uLXJlc3VtZWQgc28gdGhlIGNsaWVudCBrbm93c1xuICAgIC8vIHdoaWNoIHNlc3Npb24gdGhleSBiZWxvbmcgdG8uXG4gICAgY29uc3QgcXVldWVkID0gcGF1c2VkLl9vdXRib3VuZFF1ZXVlIHx8IFtdXG5cbiAgICBwYXVzZWQuX291dGJvdW5kUXVldWUgPSBbXVxuICAgIHBhdXNlZC5fY29ubmVjdGlvbnMuY2xlYXIoKVxuICAgIHBhdXNlZC5fY2hhbm5lbFN1YnNjcmlwdGlvbnMuY2xlYXIoKVxuICAgIHBhdXNlZC5fcGF1c2VkID0gZmFsc2VcbiAgICBwYXVzZWQuZGVzdHJveSgpXG5cbiAgICB0aGlzLl9jbGFpbU93bmVyc2hpcCgpXG4gICAgdGhpcy5zZW5kSnNvbih7dHlwZTogXCJzZXNzaW9uLXJlc3VtZWRcIiwgc2Vzc2lvbklkOiByZXN1bWVTZXNzaW9uSWR9KVxuICAgIGZvciAoY29uc3QgYm9keSBvZiBxdWV1ZWQpIHRoaXMuc2VuZEpzb24oYm9keSlcbiAgICBhd2FpdCB0aGlzLl9maXJlT25SZXN1bWUoKVxuICB9XG5cbiAgLyoqXG4gICAqIEZpcmVzIGBvbkNsb3NlKHJlYXNvbilgIG9uIGV2ZXJ5IGxpdmUgYXBwLWRlZmluZWQgY29ubmVjdGlvbiwgdGhlblxuICAgKiBkcm9wcyB0aGVtIGZyb20gdGhlIHJlZ2lzdHJ5LiBObyBuZXR3b3JrIGZyYW1lIGlzIHNlbnQg4oCUIHRoZVxuICAgKiBzb2NrZXQgaXMgYWxyZWFkeSBnb2luZyBhd2F5LlxuICAgKiBAcGFyYW0ge1wic2Vzc2lvbl9kZXN0cm95ZWRcIiB8IFwiZ3JhY2VfZXhwaXJlZFwiIHwgXCJlcnJvclwifSByZWFzb24gLSBQZXJtYW5lbnQgdGVhcmRvd24gcmVhc29uIHBhc3NlZCB0byBlYWNoIGNvbm5lY3Rpb24uXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fVxuICAgKi9cbiAgYXN5bmMgX3RlYXJkb3duQ29ubmVjdGlvbnMocmVhc29uKSB7XG4gICAgY29uc3QgY29ubmVjdGlvbnMgPSBbLi4udGhpcy5fY29ubmVjdGlvbnMudmFsdWVzKCldXG5cbiAgICB0aGlzLl9jb25uZWN0aW9ucy5jbGVhcigpXG5cbiAgICBmb3IgKGNvbnN0IGNvbm5lY3Rpb24gb2YgY29ubmVjdGlvbnMpIHtcbiAgICAgIGNvbm5lY3Rpb24uX2Nsb3NlZCA9IHRydWVcblxuICAgICAgdHJ5IHtcbiAgICAgICAgYXdhaXQgdGhpcy5fd2l0aENvbm5lY3Rpb25zKGFzeW5jICgpID0+IHtcbiAgICAgICAgICBhd2FpdCBjb25uZWN0aW9uLm9uQ2xvc2UocmVhc29uKVxuICAgICAgICB9KVxuICAgICAgfSBjYXRjaCAoY2F1Z2h0RXJyb3IpIHtcbiAgICAgICAgY29uc3QgZXJyb3IgPSB0aGlzLl9yZXBvcnRVbmV4cGVjdGVkRGlzcGF0Y2hFcnJvcihjYXVnaHRFcnJvciwge1xuICAgICAgICAgIGNvbm5lY3Rpb25JZDogY29ubmVjdGlvbi5jb25uZWN0aW9uSWQsXG4gICAgICAgICAgcmVhc29uLFxuICAgICAgICAgIHN0YWdlOiBcIndlYnNvY2tldC1jb25uZWN0aW9uLXRlYXJkb3duXCJcbiAgICAgICAgfSlcblxuICAgICAgICB0aGlzLmxvZ2dlci5lcnJvcigoKSA9PiBbYEZhaWxlZCB0byB0ZWFyIGRvd24gY29ubmVjdGlvbiAke2Nvbm5lY3Rpb24uY29ubmVjdGlvbklkfWAsIGVycm9yXSlcbiAgICAgIH1cbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogSGFuZGxlcyBhIGB7dHlwZTogXCJjb25uZWN0aW9uLW9wZW5cIn1gIG1lc3NhZ2Ug4oCUIGluc3RhbnRpYXRlcyB0aGVcbiAgICogcmVnaXN0ZXJlZCBjb25uZWN0aW9uIGNsYXNzLCBzdG9yZXMgaXQgb24gYF9jb25uZWN0aW9uc2AsIGFuZFxuICAgKiBmaXJlcyBgb25Db25uZWN0KClgLiBTZW5kcyBgY29ubmVjdGlvbi1vcGVuZWRgIG9uIHN1Y2Nlc3Mgb3JcbiAgICogYGNvbm5lY3Rpb24tZXJyb3JgIG9uIGZhaWx1cmUuXG4gICAqIEBwYXJhbSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSBtZXNzYWdlIC0gQ29ubmVjdGlvbi1vcGVuIGZyYW1lIG5hbWluZyB0aGUgY29ubmVjdGlvbiB0eXBlIGFuZCBpZGVudGlmaWVyLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn1cbiAgICovXG4gIGFzeW5jIF9oYW5kbGVDb25uZWN0aW9uT3BlbihtZXNzYWdlKSB7XG4gICAgY29uc3QgY29ubmVjdGlvbklkID0gbWVzc2FnZS5jb25uZWN0aW9uSWRcbiAgICBjb25zdCBjb25uZWN0aW9uVHlwZSA9IG1lc3NhZ2UuY29ubmVjdGlvblR5cGVcbiAgICBjb25zdCBwYXJhbXMgPSBtZXNzYWdlLnBhcmFtcyB8fCB7fVxuXG4gICAgaWYgKHR5cGVvZiBjb25uZWN0aW9uSWQgIT09IFwic3RyaW5nXCIgfHwgIWNvbm5lY3Rpb25JZCkge1xuICAgICAgdGhpcy5zZW5kSnNvbih7dHlwZTogXCJlcnJvclwiLCBlcnJvcjogXCJjb25uZWN0aW9uLW9wZW4gcmVxdWlyZXMgY29ubmVjdGlvbklkXCJ9KVxuICAgICAgcmV0dXJuXG4gICAgfVxuXG4gICAgaWYgKHR5cGVvZiBjb25uZWN0aW9uVHlwZSAhPT0gXCJzdHJpbmdcIiB8fCAhY29ubmVjdGlvblR5cGUpIHtcbiAgICAgIHRoaXMuc2VuZEpzb24oe3R5cGU6IFwiY29ubmVjdGlvbi1lcnJvclwiLCBjb25uZWN0aW9uSWQsIG1lc3NhZ2U6IFwiY29ubmVjdGlvblR5cGUgaXMgcmVxdWlyZWRcIn0pXG4gICAgICByZXR1cm5cbiAgICB9XG5cbiAgICBpZiAodGhpcy5fY29ubmVjdGlvbnMuaGFzKGNvbm5lY3Rpb25JZCkpIHtcbiAgICAgIHRoaXMuc2VuZEpzb24oe3R5cGU6IFwiY29ubmVjdGlvbi1lcnJvclwiLCBjb25uZWN0aW9uSWQsIG1lc3NhZ2U6IFwiQ29ubmVjdGlvbiBpZCBhbHJlYWR5IGluIHVzZVwifSlcbiAgICAgIHJldHVyblxuICAgIH1cblxuICAgIGNvbnN0IENvbm5lY3Rpb25DbGFzcyA9IHRoaXMuY29uZmlndXJhdGlvbi5nZXRXZWJzb2NrZXRDb25uZWN0aW9uQ2xhc3M/Lihjb25uZWN0aW9uVHlwZSlcblxuICAgIGlmICghQ29ubmVjdGlvbkNsYXNzKSB7XG4gICAgICB0aGlzLnNlbmRKc29uKHt0eXBlOiBcImNvbm5lY3Rpb24tZXJyb3JcIiwgY29ubmVjdGlvbklkLCBtZXNzYWdlOiBgVW5rbm93biBjb25uZWN0aW9uIHR5cGU6ICR7Y29ubmVjdGlvblR5cGV9YH0pXG4gICAgICByZXR1cm5cbiAgICB9XG5cbiAgICBjb25zdCBjb25uZWN0aW9uID0gbmV3IENvbm5lY3Rpb25DbGFzcyh7Y29ubmVjdGlvbklkLCBwYXJhbXMsIHNlc3Npb246IHRoaXN9KVxuXG4gICAgdHJ5IHtcbiAgICAgIGF3YWl0IHRoaXMuX3dpdGhDb25uZWN0aW9ucyhhc3luYyAoKSA9PiB7XG4gICAgICAgIGF3YWl0IGNvbm5lY3Rpb24ub25Db25uZWN0KClcbiAgICAgIH0pXG4gICAgICAvLyBSZWdpc3RlciBvbmx5IGFmdGVyIG9uQ29ubmVjdCByZXNvbHZlcyBzbyBhIGNvbm5lY3Rpb24tbWVzc2FnZVxuICAgICAgLy8gY2FuIG5ldmVyIGJlIHJvdXRlZCB0byBhIHBhcnRpYWxseSBpbml0aWFsaXplZCBjb25uZWN0aW9uLlxuICAgICAgdGhpcy5fY29ubmVjdGlvbnMuc2V0KGNvbm5lY3Rpb25JZCwgY29ubmVjdGlvbilcbiAgICAgIHRoaXMuc2VuZEpzb24oe3R5cGU6IFwiY29ubmVjdGlvbi1vcGVuZWRcIiwgY29ubmVjdGlvbklkfSlcbiAgICB9IGNhdGNoIChjYXVnaHRFcnJvcikge1xuICAgICAgY29uc3QgY2xpZW50RXJyb3JNZXNzYWdlID0gY2F1Z2h0RXJyb3IgaW5zdGFuY2VvZiBFcnJvciA/IGNhdWdodEVycm9yLm1lc3NhZ2UgOiBcIlwiXG4gICAgICBjb25zdCBlcnJvciA9IHRoaXMuX3JlcG9ydFVuZXhwZWN0ZWREaXNwYXRjaEVycm9yKGNhdWdodEVycm9yLCB7XG4gICAgICAgIGNvbm5lY3Rpb25JZCxcbiAgICAgICAgY29ubmVjdGlvblR5cGUsXG4gICAgICAgIHN0YWdlOiBcIndlYnNvY2tldC1jb25uZWN0aW9uLW9wZW5cIlxuICAgICAgfSlcblxuICAgICAgdGhpcy5sb2dnZXIuZXJyb3IoKCkgPT4gW2BGYWlsZWQgdG8gb3BlbiBjb25uZWN0aW9uICR7Y29ubmVjdGlvblR5cGV9OiR7Y29ubmVjdGlvbklkfWAsIGVycm9yXSlcbiAgICAgIHRoaXMuc2VuZEpzb24oe3R5cGU6IFwiY29ubmVjdGlvbi1lcnJvclwiLCBjb25uZWN0aW9uSWQsIG1lc3NhZ2U6IGNsaWVudEVycm9yTWVzc2FnZSB8fCBcIkZhaWxlZCB0byBvcGVuIGNvbm5lY3Rpb25cIn0pXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIEhhbmRsZXMgYSBge3R5cGU6IFwiY29ubmVjdGlvbi1tZXNzYWdlXCJ9YCBmcm9tIHRoZSBjbGllbnQuXG4gICAqIEBwYXJhbSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSBtZXNzYWdlIC0gQ29ubmVjdGlvbi1tZXNzYWdlIGZyYW1lIGNvbnRhaW5pbmcgdGhlIHRhcmdldCBpZGVudGlmaWVyIGFuZCBib2R5LlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn1cbiAgICovXG4gIGFzeW5jIF9oYW5kbGVDb25uZWN0aW9uTWVzc2FnZShtZXNzYWdlKSB7XG4gICAgY29uc3QgY29ubmVjdGlvbklkID0gbWVzc2FnZS5jb25uZWN0aW9uSWRcbiAgICBjb25zdCBjb25uZWN0aW9uID0gdHlwZW9mIGNvbm5lY3Rpb25JZCA9PT0gXCJzdHJpbmdcIiA/IHRoaXMuX2Nvbm5lY3Rpb25zLmdldChjb25uZWN0aW9uSWQpIDogbnVsbFxuXG4gICAgaWYgKCFjb25uZWN0aW9uKSB7XG4gICAgICB0aGlzLnNlbmRKc29uKHt0eXBlOiBcImNvbm5lY3Rpb24tZXJyb3JcIiwgY29ubmVjdGlvbklkLCBtZXNzYWdlOiBcIlVua25vd24gY29ubmVjdGlvbiBpZFwifSlcbiAgICAgIHJldHVyblxuICAgIH1cblxuICAgIHRyeSB7XG4gICAgICBhd2FpdCB0aGlzLl93aXRoQ29ubmVjdGlvbnMoYXN5bmMgKCkgPT4ge1xuICAgICAgICBhd2FpdCBjb25uZWN0aW9uLm9uTWVzc2FnZShtZXNzYWdlLmJvZHkpXG4gICAgICB9KVxuICAgIH0gY2F0Y2ggKGNhdWdodEVycm9yKSB7XG4gICAgICBjb25zdCBjbGllbnRFcnJvck1lc3NhZ2UgPSBjYXVnaHRFcnJvciBpbnN0YW5jZW9mIEVycm9yID8gY2F1Z2h0RXJyb3IubWVzc2FnZSA6IFwiXCJcbiAgICAgIGNvbnN0IGVycm9yID0gdGhpcy5fcmVwb3J0VW5leHBlY3RlZERpc3BhdGNoRXJyb3IoY2F1Z2h0RXJyb3IsIHtcbiAgICAgICAgY29ubmVjdGlvbklkLFxuICAgICAgICBzdGFnZTogXCJ3ZWJzb2NrZXQtY29ubmVjdGlvbi1tZXNzYWdlXCJcbiAgICAgIH0pXG5cbiAgICAgIHRoaXMubG9nZ2VyLmVycm9yKCgpID0+IFtgRmFpbGVkIHRvIGhhbmRsZSBjb25uZWN0aW9uLW1lc3NhZ2UgZm9yICR7Y29ubmVjdGlvbklkfWAsIGVycm9yXSlcbiAgICAgIHRoaXMuc2VuZEpzb24oe3R5cGU6IFwiY29ubmVjdGlvbi1lcnJvclwiLCBjb25uZWN0aW9uSWQsIG1lc3NhZ2U6IGNsaWVudEVycm9yTWVzc2FnZSB8fCBcIkZhaWxlZCB0byBoYW5kbGUgbWVzc2FnZVwifSlcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogSGFuZGxlcyBhIGB7dHlwZTogXCJjb25uZWN0aW9uLWNsb3NlXCJ9YCBmcm9tIHRoZSBjbGllbnQg4oCUIGZpcmVzXG4gICAqIGBvbkNsb3NlKFwiY2xpZW50X2Nsb3NlXCIpYCBhbmQgY29uZmlybXMgd2l0aCBgY29ubmVjdGlvbi1jbG9zZWRgLlxuICAgKiBAcGFyYW0ge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gbWVzc2FnZSAtIENvbm5lY3Rpb24tY2xvc2UgZnJhbWUgY29udGFpbmluZyB0aGUgdGFyZ2V0IGlkZW50aWZpZXIuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fVxuICAgKi9cbiAgYXN5bmMgX2hhbmRsZUNvbm5lY3Rpb25DbG9zZShtZXNzYWdlKSB7XG4gICAgY29uc3QgY29ubmVjdGlvbklkID0gbWVzc2FnZS5jb25uZWN0aW9uSWRcbiAgICBjb25zdCBjb25uZWN0aW9uID0gdHlwZW9mIGNvbm5lY3Rpb25JZCA9PT0gXCJzdHJpbmdcIiA/IHRoaXMuX2Nvbm5lY3Rpb25zLmdldChjb25uZWN0aW9uSWQpIDogbnVsbFxuXG4gICAgaWYgKCFjb25uZWN0aW9uKSByZXR1cm5cblxuICAgIHRoaXMuX2Nvbm5lY3Rpb25zLmRlbGV0ZShjb25uZWN0aW9uSWQpXG4gICAgLy8gTWFyayBjbG9zZWQgYmVmb3JlIGZpcmluZyBvbkNsb3NlIHNvIGFwcCBjb2RlIGhvbGRpbmcgdGhlXG4gICAgLy8gaGFuZGxlIHNlZXMgYGlzQ2xvc2VkKCkgPT09IHRydWVgIGFuZCBjYW4ndCByZS1lbnRlciBzZW5kTWVzc2FnZS5cbiAgICBjb25uZWN0aW9uLl9jbG9zZWQgPSB0cnVlXG5cbiAgICB0cnkge1xuICAgICAgYXdhaXQgdGhpcy5fd2l0aENvbm5lY3Rpb25zKGFzeW5jICgpID0+IHtcbiAgICAgICAgYXdhaXQgY29ubmVjdGlvbi5vbkNsb3NlKFwiY2xpZW50X2Nsb3NlXCIpXG4gICAgICB9KVxuICAgIH0gY2F0Y2ggKGNhdWdodEVycm9yKSB7XG4gICAgICBjb25zdCBlcnJvciA9IHRoaXMuX3JlcG9ydFVuZXhwZWN0ZWREaXNwYXRjaEVycm9yKGNhdWdodEVycm9yLCB7XG4gICAgICAgIGNvbm5lY3Rpb25JZCxcbiAgICAgICAgc3RhZ2U6IFwid2Vic29ja2V0LWNvbm5lY3Rpb24tY2xvc2VcIlxuICAgICAgfSlcblxuICAgICAgdGhpcy5sb2dnZXIuZXJyb3IoKCkgPT4gW2BGYWlsZWQgdG8gdGVhciBkb3duIGNvbm5lY3Rpb24gJHtjb25uZWN0aW9uSWR9YCwgZXJyb3JdKVxuICAgIH1cblxuICAgIHRoaXMuc2VuZEpzb24oe3R5cGU6IFwiY29ubmVjdGlvbi1jbG9zZWRcIiwgY29ubmVjdGlvbklkLCByZWFzb246IFwiY2xpZW50X2Nsb3NlXCJ9KVxuICB9XG5cbiAgLyoqXG4gICAqIEhhbmRsZXMgYHt0eXBlOiBcImNoYW5uZWwtc3Vic2NyaWJlXCJ9YCDigJQgcnVucyBgY2FuU3Vic2NyaWJlKClgLFxuICAgKiByZWdpc3RlcnMgd2l0aCB0aGUgQ29uZmlndXJhdGlvbidzIGdsb2JhbCByb3V0aW5nIHJlZ2lzdHJ5IG9uXG4gICAqIHN1Y2Nlc3MsIGFuZCBzZW5kcyBgY2hhbm5lbC1zdWJzY3JpYmVkYCBvciBgY2hhbm5lbC1lcnJvcmAuXG4gICAqIEBwYXJhbSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSBtZXNzYWdlIC0gQ2hhbm5lbC1zdWJzY3JpYmUgZnJhbWUgZGVzY3JpYmluZyB0aGUgcmVxdWVzdGVkIHN1YnNjcmlwdGlvbi5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59XG4gICAqL1xuICBhc3luYyBfaGFuZGxlQ2hhbm5lbFN1YnNjcmliZShtZXNzYWdlKSB7XG4gICAgY29uc3Qgc3Vic2NyaXB0aW9uSWQgPSBtZXNzYWdlLnN1YnNjcmlwdGlvbklkXG4gICAgY29uc3QgY2hhbm5lbFR5cGUgPSBtZXNzYWdlLmNoYW5uZWxUeXBlXG4gICAgY29uc3QgcGFyYW1zID0gbWVzc2FnZS5wYXJhbXMgfHwge31cbiAgICBjb25zdCBsYXN0RXZlbnRJZCA9IG1lc3NhZ2UubGFzdEV2ZW50SWRcblxuICAgIGlmICh0eXBlb2Ygc3Vic2NyaXB0aW9uSWQgIT09IFwic3RyaW5nXCIgfHwgIXN1YnNjcmlwdGlvbklkKSB7XG4gICAgICB0aGlzLnNlbmRKc29uKHt0eXBlOiBcImVycm9yXCIsIGVycm9yOiBcImNoYW5uZWwtc3Vic2NyaWJlIHJlcXVpcmVzIHN1YnNjcmlwdGlvbklkXCJ9KVxuICAgICAgcmV0dXJuXG4gICAgfVxuXG4gICAgaWYgKHR5cGVvZiBjaGFubmVsVHlwZSAhPT0gXCJzdHJpbmdcIiB8fCAhY2hhbm5lbFR5cGUpIHtcbiAgICAgIHRoaXMuc2VuZEpzb24oe3R5cGU6IFwiY2hhbm5lbC1lcnJvclwiLCBzdWJzY3JpcHRpb25JZCwgbWVzc2FnZTogXCJjaGFubmVsVHlwZSBpcyByZXF1aXJlZFwifSlcbiAgICAgIHJldHVyblxuICAgIH1cblxuICAgIGlmICh0aGlzLl9jaGFubmVsU3Vic2NyaXB0aW9ucy5oYXMoc3Vic2NyaXB0aW9uSWQpKSB7XG4gICAgICB0aGlzLnNlbmRKc29uKHt0eXBlOiBcImNoYW5uZWwtZXJyb3JcIiwgc3Vic2NyaXB0aW9uSWQsIG1lc3NhZ2U6IFwiU3Vic2NyaXB0aW9uIGlkIGFscmVhZHkgaW4gdXNlXCJ9KVxuICAgICAgcmV0dXJuXG4gICAgfVxuXG4gICAgY29uc3QgQ2hhbm5lbENsYXNzID0gdGhpcy5jb25maWd1cmF0aW9uLmdldFdlYnNvY2tldENoYW5uZWxDbGFzcz8uKGNoYW5uZWxUeXBlKVxuXG4gICAgaWYgKCFDaGFubmVsQ2xhc3MpIHtcbiAgICAgIHRoaXMuc2VuZEpzb24oe3R5cGU6IFwiY2hhbm5lbC1lcnJvclwiLCBzdWJzY3JpcHRpb25JZCwgbWVzc2FnZTogYFVua25vd24gY2hhbm5lbCB0eXBlOiAke2NoYW5uZWxUeXBlfWB9KVxuICAgICAgcmV0dXJuXG4gICAgfVxuXG4gICAgY29uc3Qgc3Vic2NyaXB0aW9uID0gbmV3IENoYW5uZWxDbGFzcyh7c3Vic2NyaXB0aW9uSWQsIHBhcmFtcywgc2Vzc2lvbjogdGhpc30pXG5cbiAgICB0cnkge1xuICAgICAgLy8gUmVzb2x2aW5nIHRoZSB0ZW5hbnQgY2FuIHJ1biBkYXRhYmFzZSBxdWVyaWVzIChlLmcuIGxvb2tpbmcgdXAgdGhlXG4gICAgICAvLyByZWNvcmQncyBwcm9qZWN0IGFuZCB0aGUgY2FsbGVyJ3MgYWNjZXNzKSwgc28gaXQgbXVzdCBoYXBwZW4gaW5zaWRlIGFcbiAgICAgIC8vIGNvbm5lY3Rpb24gc2NvcGUuIFdpdGhvdXQgdGhpcyB0aGUgcmVzb2x2ZXIgYm9ycm93cyBhIGNvbm5lY3Rpb24gdGhhdFxuICAgICAgLy8gaXMgY2hlY2tlZCBiYWNrIGluIGJlZm9yZS93aGlsZSBpdCBxdWVyaWVzLCBpbnRlcm1pdHRlbnRseSBzdXJmYWNpbmcgYXNcbiAgICAgIC8vIFwiQ29ubmVjdGlvbiDigKYgZG9lc24ndCBleGlzdCBhbnkgbW9yZVwiIG9yIGEgZmFsc2VseSB1bmF1dGhvcml6ZWRcbiAgICAgIC8vIHN1YnNjcmlwdGlvbi5cbiAgICAgIGxldCB0ZW5hbnRcbiAgICAgIGF3YWl0IHRoaXMuX3dpdGhDb25uZWN0aW9ucyhhc3luYyAoKSA9PiB7XG4gICAgICAgIHRlbmFudCA9IGF3YWl0IHRoaXMuX3Jlc29sdmVUZW5hbnQoe2NoYW5uZWw6IGNoYW5uZWxUeXBlLCBwYXJhbXN9KVxuICAgICAgfSlcblxuICAgICAgYXdhaXQgdGhpcy5jb25maWd1cmF0aW9uLnJ1bldpdGhUZW5hbnQodGVuYW50LCBhc3luYyAoKSA9PiB7XG4gICAgICAgIGxldCBhbGxvd2VkID0gZmFsc2VcblxuICAgICAgICBhd2FpdCB0aGlzLl93aXRoQ29ubmVjdGlvbnMoYXN5bmMgKCkgPT4ge1xuICAgICAgICAgIGFsbG93ZWQgPSBCb29sZWFuKGF3YWl0IHN1YnNjcmlwdGlvbi5jYW5TdWJzY3JpYmUoKSlcbiAgICAgICAgfSlcblxuICAgICAgICBpZiAoIWFsbG93ZWQpIHtcbiAgICAgICAgICB0aGlzLnNlbmRKc29uKHt0eXBlOiBcImNoYW5uZWwtZXJyb3JcIiwgc3Vic2NyaXB0aW9uSWQsIG1lc3NhZ2U6IFwiU3Vic2NyaXB0aW9uIG5vdCBhdXRob3JpemVkXCJ9KVxuICAgICAgICAgIHJldHVyblxuICAgICAgICB9XG5cbiAgICAgICAgdGhpcy5fY2hhbm5lbFN1YnNjcmlwdGlvbnMuc2V0KHN1YnNjcmlwdGlvbklkLCB7Y2hhbm5lbFR5cGUsIHN1YnNjcmlwdGlvbn0pXG4gICAgICAgIHRoaXMuY29uZmlndXJhdGlvbi5fcmVnaXN0ZXJXZWJzb2NrZXRDaGFubmVsU3Vic2NyaXB0aW9uKGNoYW5uZWxUeXBlLCBzdWJzY3JpcHRpb24pXG5cbiAgICAgICAgYXdhaXQgdGhpcy5fd2l0aENvbm5lY3Rpb25zKGFzeW5jICgpID0+IGF3YWl0IHN1YnNjcmlwdGlvbi5zdWJzY3JpYmVkKCkpXG5cbiAgICAgICAgLy8gUmVwbGF5IG1pc3NlZCBldmVudHMgQkVGT1JFIHNlbmRpbmcgY2hhbm5lbC1zdWJzY3JpYmVkIHNvXG4gICAgICAgIC8vIHRoZSBjbGllbnQga25vd3M6IGV2ZXJ5dGhpbmcgYmVmb3JlIHRoZSBjb25maXJtYXRpb24gaXNcbiAgICAgICAgLy8gcmVwbGF5ZWQsIGV2ZXJ5dGhpbmcgYWZ0ZXIgaXMgbGl2ZS5cbiAgICAgICAgaWYgKHR5cGVvZiBsYXN0RXZlbnRJZCA9PT0gXCJzdHJpbmdcIiAmJiBsYXN0RXZlbnRJZC5sZW5ndGggPiAwKSB7XG4gICAgICAgICAgYXdhaXQgdGhpcy5fcmVwbGF5Q2hhbm5lbEV2ZW50c0ZvclN1YnNjcmlwdGlvbih7Y2hhbm5lbFR5cGUsIGxhc3RFdmVudElkLCBzdWJzY3JpcHRpb259KVxuICAgICAgICB9XG5cbiAgICAgICAgdGhpcy5zZW5kSnNvbih7dHlwZTogXCJjaGFubmVsLXN1YnNjcmliZWRcIiwgc3Vic2NyaXB0aW9uSWR9KVxuICAgICAgfSlcbiAgICB9IGNhdGNoIChjYXVnaHRFcnJvcikge1xuICAgICAgY29uc3QgY2xpZW50RXJyb3JNZXNzYWdlID0gY2F1Z2h0RXJyb3IgaW5zdGFuY2VvZiBFcnJvciA/IGNhdWdodEVycm9yLm1lc3NhZ2UgOiBcIlwiXG5cbiAgICAgIHRoaXMuX2NoYW5uZWxTdWJzY3JpcHRpb25zLmRlbGV0ZShzdWJzY3JpcHRpb25JZClcbiAgICAgIHRoaXMuY29uZmlndXJhdGlvbi5fdW5yZWdpc3RlcldlYnNvY2tldENoYW5uZWxTdWJzY3JpcHRpb24oY2hhbm5lbFR5cGUsIHN1YnNjcmlwdGlvbilcbiAgICAgIGNvbnN0IGVycm9yID0gdGhpcy5fcmVwb3J0VW5leHBlY3RlZERpc3BhdGNoRXJyb3IoY2F1Z2h0RXJyb3IsIHtcbiAgICAgICAgY2hhbm5lbFR5cGUsXG4gICAgICAgIHN0YWdlOiBcIndlYnNvY2tldC1jaGFubmVsLXN1YnNjcmliZVwiLFxuICAgICAgICBzdWJzY3JpcHRpb25JZFxuICAgICAgfSlcblxuICAgICAgdGhpcy5sb2dnZXIuZXJyb3IoKCkgPT4gW2BGYWlsZWQgdG8gc3Vic2NyaWJlIGNoYW5uZWwgJHtjaGFubmVsVHlwZX06JHtzdWJzY3JpcHRpb25JZH1gLCBlcnJvcl0pXG4gICAgICB0aGlzLnNlbmRKc29uKHt0eXBlOiBcImNoYW5uZWwtZXJyb3JcIiwgc3Vic2NyaXB0aW9uSWQsIG1lc3NhZ2U6IGNsaWVudEVycm9yTWVzc2FnZSB8fCBcIkZhaWxlZCB0byBzdWJzY3JpYmVcIn0pXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIFJlcGxheXMgbWlzc2VkIGV2ZW50cyBmcm9tIHRoZSBwZXJzaXN0ZW50IGV2ZW50LWxvZyBzdG9yZSBmb3IgYVxuICAgKiBjaGFubmVsIHN1YnNjcmlwdGlvbiB0aGF0IHByb3ZpZGVkIGBsYXN0RXZlbnRJZGAuIFNlbmRzIGVhY2hcbiAgICogbWlzc2VkIGV2ZW50IGFzIGEgYGNoYW5uZWwtbWVzc2FnZWAgd2l0aCBgcmVwbGF5ZWQ6IHRydWVgLlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIE9wdGlvbnMuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBhcmdzLmNoYW5uZWxUeXBlIC0gQ2hhbm5lbCB0eXBlIG5hbWUgKGV2ZW50LWxvZyBrZXkpLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gYXJncy5sYXN0RXZlbnRJZCAtIENsaWVudCdzIGxhc3Qtc2VlbiBldmVudCBpZC5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi93ZWJzb2NrZXQtY2hhbm5lbC5qc1wiKS5kZWZhdWx0fSBhcmdzLnN1YnNjcmlwdGlvbiAtIExpdmUgc3Vic2NyaXB0aW9uLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn1cbiAgICovXG4gIGFzeW5jIF9yZXBsYXlDaGFubmVsRXZlbnRzRm9yU3Vic2NyaXB0aW9uKHtjaGFubmVsVHlwZSwgbGFzdEV2ZW50SWQsIHN1YnNjcmlwdGlvbn0pIHtcbiAgICBjb25zdCBzdG9yZSA9IHdlYnNvY2tldEV2ZW50TG9nU3RvcmVGb3JDb25maWd1cmF0aW9uKHRoaXMuY29uZmlndXJhdGlvbilcblxuICAgIGF3YWl0IHRoaXMuY29uZmlndXJhdGlvbi5hd2FpdFBlbmRpbmdCcm9hZGNhc3RzKClcblxuICAgIGNvbnN0IGNoZWNrcG9pbnQgPSBhd2FpdCBzdG9yZS5nZXRFdmVudEJ5SWQoe2NoYW5uZWw6IGNoYW5uZWxUeXBlLCBpZDogbGFzdEV2ZW50SWR9KVxuXG4gICAgaWYgKCFjaGVja3BvaW50KSB7XG4gICAgICB0aGlzLnNlbmRKc29uKHtcbiAgICAgICAgdHlwZTogXCJjaGFubmVsLXJlcGxheS1nYXBcIixcbiAgICAgICAgc3Vic2NyaXB0aW9uSWQ6IHN1YnNjcmlwdGlvbi5zdWJzY3JpcHRpb25JZCxcbiAgICAgICAgbGFzdEV2ZW50SWRcbiAgICAgIH0pXG4gICAgICByZXR1cm5cbiAgICB9XG5cbiAgICBjb25zdCBjZWlsaW5nID0gYXdhaXQgc3RvcmUubGF0ZXN0U2VxdWVuY2UoY2hhbm5lbFR5cGUpXG5cbiAgICBpZiAoIWNlaWxpbmcgfHwgY2VpbGluZyA8PSBjaGVja3BvaW50LnNlcXVlbmNlKSByZXR1cm5cblxuICAgIGNvbnN0IGV2ZW50cyA9IGF3YWl0IHN0b3JlLmdldEV2ZW50c0FmdGVyKHtcbiAgICAgIGNoYW5uZWw6IGNoYW5uZWxUeXBlLFxuICAgICAgc2VxdWVuY2U6IGNoZWNrcG9pbnQuc2VxdWVuY2UsXG4gICAgICB1cFRvU2VxdWVuY2U6IGNlaWxpbmdcbiAgICB9KVxuXG4gICAgZm9yIChjb25zdCBldmVudCBvZiBldmVudHMpIHtcbiAgICAgIGlmIChzdWJzY3JpcHRpb24uaXNDbG9zZWQoKSkgYnJlYWtcblxuICAgICAgc3Vic2NyaXB0aW9uLnNlbmRNZXNzYWdlKC8qKiBAdHlwZSB7aW1wb3J0KFwiLi4vd2Vic29ja2V0LWNoYW5uZWwuanNcIikuV2Vic29ja2V0SnNvblZhbHVlfSAqLyAoZXZlbnQucGF5bG9hZCkpXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIEhhbmRsZXMgYHt0eXBlOiBcImNoYW5uZWwtdW5zdWJzY3JpYmVcIn1gIGZyb20gdGhlIGNsaWVudCDigJQgY2FsbHNcbiAgICogYHVuc3Vic2NyaWJlZCgpYCBhbmQgc2VuZHMgYGNoYW5uZWwtdW5zdWJzY3JpYmVkYC5cbiAgICogQHBhcmFtIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59IG1lc3NhZ2UgLSBDaGFubmVsLXVuc3Vic2NyaWJlIGZyYW1lIGNvbnRhaW5pbmcgdGhlIHN1YnNjcmlwdGlvbiBpZGVudGlmaWVyLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn1cbiAgICovXG4gIGFzeW5jIF9oYW5kbGVDaGFubmVsVW5zdWJzY3JpYmUobWVzc2FnZSkge1xuICAgIGNvbnN0IHN1YnNjcmlwdGlvbklkID0gbWVzc2FnZS5zdWJzY3JpcHRpb25JZFxuXG4gICAgaWYgKHR5cGVvZiBzdWJzY3JpcHRpb25JZCAhPT0gXCJzdHJpbmdcIikgcmV0dXJuXG5cbiAgICBjb25zdCBlbnRyeSA9IHRoaXMuX2NoYW5uZWxTdWJzY3JpcHRpb25zLmdldChzdWJzY3JpcHRpb25JZClcblxuICAgIGlmICghZW50cnkpIHJldHVyblxuXG4gICAgdGhpcy5fY2hhbm5lbFN1YnNjcmlwdGlvbnMuZGVsZXRlKHN1YnNjcmlwdGlvbklkKVxuICAgIHRoaXMuY29uZmlndXJhdGlvbi5fdW5yZWdpc3RlcldlYnNvY2tldENoYW5uZWxTdWJzY3JpcHRpb24oZW50cnkuY2hhbm5lbFR5cGUsIGVudHJ5LnN1YnNjcmlwdGlvbilcbiAgICBlbnRyeS5zdWJzY3JpcHRpb24uX2Nsb3NlZCA9IHRydWVcblxuICAgIHRyeSB7XG4gICAgICBhd2FpdCB0aGlzLl93aXRoQ29ubmVjdGlvbnMoYXN5bmMgKCkgPT4gYXdhaXQgZW50cnkuc3Vic2NyaXB0aW9uLnVuc3Vic2NyaWJlZCgpKVxuICAgIH0gY2F0Y2ggKGNhdWdodEVycm9yKSB7XG4gICAgICBjb25zdCBlcnJvciA9IHRoaXMuX3JlcG9ydFVuZXhwZWN0ZWREaXNwYXRjaEVycm9yKGNhdWdodEVycm9yLCB7XG4gICAgICAgIGNoYW5uZWxUeXBlOiBlbnRyeS5jaGFubmVsVHlwZSxcbiAgICAgICAgc3RhZ2U6IFwid2Vic29ja2V0LWNoYW5uZWwtdW5zdWJzY3JpYmVcIixcbiAgICAgICAgc3Vic2NyaXB0aW9uSWRcbiAgICAgIH0pXG5cbiAgICAgIHRoaXMubG9nZ2VyLmVycm9yKCgpID0+IFtgRmFpbGVkIHRvIHVuc3Vic2NyaWJlIGNoYW5uZWwgJHtlbnRyeS5jaGFubmVsVHlwZX06JHtzdWJzY3JpcHRpb25JZH1gLCBlcnJvcl0pXG4gICAgfVxuXG4gICAgdGhpcy5zZW5kSnNvbih7dHlwZTogXCJjaGFubmVsLXVuc3Vic2NyaWJlZFwiLCBzdWJzY3JpcHRpb25JZH0pXG4gIH1cblxuICAvKipcbiAgICogRmlyZXMgYHVuc3Vic2NyaWJlZCgpYCBvbiBldmVyeSBsaXZlIGNoYW5uZWwtdjIgc3Vic2NyaXB0aW9uLFxuICAgKiByZW1vdmVzIHRoZW0gZnJvbSB0aGUgQ29uZmlndXJhdGlvbidzIGdsb2JhbCByZWdpc3RyeSwgYW5kXG4gICAqIGRyb3BzIHRoZSBzZXNzaW9uJ3Mgb3duIG1hcC4gTm8gbmV0d29yayBmcmFtZXMg4oCUIHRoZSBzb2NrZXRcbiAgICogaXMgYWxyZWFkeSBnb2luZyBhd2F5LlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn1cbiAgICovXG4gIGFzeW5jIF90ZWFyZG93bkNoYW5uZWxTdWJzY3JpcHRpb25zKCkge1xuICAgIGNvbnN0IGVudHJpZXMgPSBbLi4udGhpcy5fY2hhbm5lbFN1YnNjcmlwdGlvbnMudmFsdWVzKCldXG5cbiAgICB0aGlzLl9jaGFubmVsU3Vic2NyaXB0aW9ucy5jbGVhcigpXG5cbiAgICBmb3IgKGNvbnN0IHtjaGFubmVsVHlwZSwgc3Vic2NyaXB0aW9ufSBvZiBlbnRyaWVzKSB7XG4gICAgICB0aGlzLmNvbmZpZ3VyYXRpb24uX3VucmVnaXN0ZXJXZWJzb2NrZXRDaGFubmVsU3Vic2NyaXB0aW9uKGNoYW5uZWxUeXBlLCBzdWJzY3JpcHRpb24pXG4gICAgICBzdWJzY3JpcHRpb24uX2Nsb3NlZCA9IHRydWVcblxuICAgICAgdHJ5IHtcbiAgICAgICAgYXdhaXQgdGhpcy5fd2l0aENvbm5lY3Rpb25zKGFzeW5jICgpID0+IGF3YWl0IHN1YnNjcmlwdGlvbi51bnN1YnNjcmliZWQoKSlcbiAgICAgIH0gY2F0Y2ggKGNhdWdodEVycm9yKSB7XG4gICAgICAgIGNvbnN0IGVycm9yID0gdGhpcy5fcmVwb3J0VW5leHBlY3RlZERpc3BhdGNoRXJyb3IoY2F1Z2h0RXJyb3IsIHtcbiAgICAgICAgICBjaGFubmVsVHlwZSxcbiAgICAgICAgICBzdGFnZTogXCJ3ZWJzb2NrZXQtY2hhbm5lbC10ZWFyZG93blwiLFxuICAgICAgICAgIHN1YnNjcmlwdGlvbklkOiBzdWJzY3JpcHRpb24uc3Vic2NyaXB0aW9uSWRcbiAgICAgICAgfSlcblxuICAgICAgICB0aGlzLmxvZ2dlci5lcnJvcigoKSA9PiBbYEZhaWxlZCB0byB0ZWFyIGRvd24gY2hhbm5lbC12MiAke2NoYW5uZWxUeXBlfToke3N1YnNjcmlwdGlvbi5zdWJzY3JpcHRpb25JZH1gLCBlcnJvcl0pXG4gICAgICB9XG4gICAgfVxuICB9XG5cbiAgYXN5bmMgX3RlYXJkb3duQ2hhbm5lbCgpIHtcbiAgICBmb3IgKGNvbnN0IGNoYW5uZWwgb2YgdGhpcy5jaGFubmVscykge1xuICAgICAgYXdhaXQgdGhpcy5fdGVhcmRvd25TaW5nbGVDaGFubmVsKGNoYW5uZWwpXG4gICAgfVxuICAgIHRoaXMuY2hhbm5lbHMuY2xlYXIoKVxuICAgIHRoaXMuY2hhbm5lbFJlcGxheVN0YXRlcy5jbGVhcigpXG4gIH1cblxuICAvKipcbiAgICogUnVucyB0ZWFyZG93biBzaW5nbGUgY2hhbm5lbC5cbiAgICogQHBhcmFtIHtXZWJzb2NrZXRDaGFubmVsfSBjaGFubmVsIC0gQ2hhbm5lbCBpbnN0YW5jZS5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgd2hlbiBjb21wbGV0ZS5cbiAgICovXG4gIGFzeW5jIF90ZWFyZG93blNpbmdsZUNoYW5uZWwoY2hhbm5lbCkge1xuICAgIHRyeSB7XG4gICAgICBjb25zdCB0ZW5hbnQgPSB0aGlzLmNoYW5uZWxUZW5hbnRzLmdldChjaGFubmVsKVxuXG4gICAgICBhd2FpdCB0aGlzLmNvbmZpZ3VyYXRpb24ucnVuV2l0aFRlbmFudCh0ZW5hbnQsIGFzeW5jICgpID0+IHtcbiAgICAgICAgYXdhaXQgdGhpcy5fd2l0aENvbm5lY3Rpb25zKGFzeW5jICgpID0+IHtcbiAgICAgICAgICBhd2FpdCBjaGFubmVsPy51bnN1YnNjcmliZWQ/LigpXG4gICAgICAgIH0pXG4gICAgICB9KVxuICAgIH0gY2F0Y2ggKGNhdWdodEVycm9yKSB7XG4gICAgICBjb25zdCBlcnJvciA9IHRoaXMuX3JlcG9ydFVuZXhwZWN0ZWREaXNwYXRjaEVycm9yKGNhdWdodEVycm9yLCB7XG4gICAgICAgIHN0YWdlOiBcIndlYnNvY2tldC1jaGFubmVsLXRlYXJkb3duXCJcbiAgICAgIH0pXG5cbiAgICAgIHRoaXMubG9nZ2VyLmVycm9yKCgpID0+IFtcIkZhaWxlZCB0byB0ZWFyZG93biB3ZWJzb2NrZXQgY2hhbm5lbFwiLCBlcnJvcl0pXG4gICAgfVxuXG4gICAgY29uc3Qgc3Vic2NyaXB0aW9ucyA9IHRoaXMuaGFuZGxlclN1YnNjcmlwdGlvbnMuZ2V0KGNoYW5uZWwpXG5cbiAgICBpZiAoc3Vic2NyaXB0aW9ucykge1xuICAgICAgZm9yIChjb25zdCBzdWJzY3JpcHRpb25DaGFubmVsIG9mIHN1YnNjcmlwdGlvbnMpIHtcbiAgICAgICAgdGhpcy5zdWJzY3JpcHRpb25IYW5kbGVycy5nZXQoc3Vic2NyaXB0aW9uQ2hhbm5lbCk/LmRlbGV0ZShjaGFubmVsKVxuXG4gICAgICAgIGlmICh0aGlzLnN1YnNjcmlwdGlvbkhhbmRsZXJzLmdldChzdWJzY3JpcHRpb25DaGFubmVsKT8uc2l6ZSA9PT0gMCkge1xuICAgICAgICAgIHRoaXMuc3Vic2NyaXB0aW9uSGFuZGxlcnMuZGVsZXRlKHN1YnNjcmlwdGlvbkNoYW5uZWwpXG4gICAgICAgIH1cbiAgICAgIH1cblxuICAgICAgdGhpcy5oYW5kbGVyU3Vic2NyaXB0aW9ucy5kZWxldGUoY2hhbm5lbClcbiAgICB9XG5cbiAgICB0aGlzLmNoYW5uZWxUZW5hbnRzLmRlbGV0ZShjaGFubmVsKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgcmVnaXN0ZXIgY2hhbm5lbC5cbiAgICogQHBhcmFtIHtXZWJzb2NrZXRDaGFubmVsIHwgdW5kZWZpbmVkfSBjaGFubmVsIC0gQ2hhbm5lbCBpbnN0YW5jZS5cbiAgICogQHBhcmFtIHtzdHJpbmcgfCBudWxsIHwgdW5kZWZpbmVkfSB0ZW5hbnQgLSBUZW5hbnQga2V5LlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyB3aGVuIGNvbXBsZXRlLlxuICAgKi9cbiAgYXN5bmMgX3JlZ2lzdGVyQ2hhbm5lbChjaGFubmVsLCB0ZW5hbnQpIHtcbiAgICBpZiAoIWNoYW5uZWwpIHJldHVyblxuXG4gICAgdGhpcy5jaGFubmVscy5hZGQoY2hhbm5lbClcbiAgICB0aGlzLmNoYW5uZWxUZW5hbnRzLnNldChjaGFubmVsLCB0ZW5hbnQpXG4gICAgYXdhaXQgdGhpcy5jb25maWd1cmF0aW9uLnJ1bldpdGhUZW5hbnQodGVuYW50LCBhc3luYyAoKSA9PiB7XG4gICAgICBhd2FpdCB0aGlzLl93aXRoQ29ubmVjdGlvbnMoYXN5bmMgKCkgPT4ge1xuICAgICAgICBhd2FpdCBjaGFubmVsPy5zdWJzY3JpYmVkPy4oKVxuICAgICAgfSlcbiAgICB9KVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgd2l0aCBjb25uZWN0aW9ucy5cbiAgICogQHBhcmFtIHsoKSA9PiBQcm9taXNlPHZvaWQ+fSBjYWxsYmFjayAtIENhbGxiYWNrLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyB3aGVuIGNvbXBsZXRlLlxuICAgKi9cbiAgYXN5bmMgX3dpdGhDb25uZWN0aW9ucyhjYWxsYmFjaykge1xuICAgIGF3YWl0IHRoaXMuY29uZmlndXJhdGlvbi5lbnN1cmVDb25uZWN0aW9ucyh7bmFtZTogXCJXZWJzb2NrZXQgc2Vzc2lvblwifSwgYXN5bmMgKCkgPT4ge1xuICAgICAgYXdhaXQgY2FsbGJhY2soKVxuICAgIH0pXG4gIH1cblxuICAvKipcbiAgICogUnVucyBoYW5kbGUgY2hhbm5lbCBzdWJzY3JpcHRpb24uXG4gICAqIEBwYXJhbSB7e2NoYW5uZWw6IHN0cmluZywgbGFzdEV2ZW50SWQ/OiBzdHJpbmcsIHBhcmFtcz86IFJlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn19IGFyZ3MgLSBTdWJzY3JpcHRpb24gYXJncy5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgd2hlbiBjb21wbGV0ZS5cbiAgICovXG4gIGFzeW5jIF9oYW5kbGVDaGFubmVsU3Vic2NyaXB0aW9uKHtjaGFubmVsLCBsYXN0RXZlbnRJZCwgcGFyYW1zfSkge1xuICAgIGNvbnN0IHJlc29sdmVyID0gdGhpcy5jb25maWd1cmF0aW9uLmdldFdlYnNvY2tldENoYW5uZWxSZXNvbHZlcj8uKClcblxuICAgIGlmICghcmVzb2x2ZXIpIHJldHVyblxuXG4gICAgdHJ5IHtcbiAgICAgIC8vIFRlbmFudCByZXNvbHV0aW9uIGNhbiBydW4gZGF0YWJhc2UgcXVlcmllcywgc28gaXQgbXVzdCBoYXBwZW4gaW5zaWRlIGFcbiAgICAgIC8vIGNvbm5lY3Rpb24gc2NvcGUgKHNlZSBfaGFuZGxlQ2hhbm5lbFN1YnNjcmliZSkuXG4gICAgICBsZXQgdGVuYW50XG4gICAgICBhd2FpdCB0aGlzLl93aXRoQ29ubmVjdGlvbnMoYXN5bmMgKCkgPT4ge1xuICAgICAgICB0ZW5hbnQgPSBhd2FpdCB0aGlzLl9yZXNvbHZlVGVuYW50KHtjaGFubmVsLCBwYXJhbXN9KVxuICAgICAgfSlcbiAgICAgIGNvbnN0IHJlc29sdmVkID0gYXdhaXQgdGhpcy5jb25maWd1cmF0aW9uLnJ1bldpdGhUZW5hbnQodGVuYW50LCBhc3luYyAoKSA9PiB7XG4gICAgICAgIHJldHVybiBhd2FpdCByZXNvbHZlcih7XG4gICAgICAgICAgY2xpZW50OiB0aGlzLmNsaWVudCxcbiAgICAgICAgICBjb25maWd1cmF0aW9uOiB0aGlzLmNvbmZpZ3VyYXRpb24sXG4gICAgICAgICAgcmVxdWVzdDogdGhpcy51cGdyYWRlUmVxdWVzdCxcbiAgICAgICAgICBzdWJzY3JpcHRpb246IHtjaGFubmVsLCBwYXJhbXN9LFxuICAgICAgICAgIHdlYnNvY2tldFNlc3Npb246IHRoaXNcbiAgICAgICAgfSlcbiAgICAgIH0pXG5cbiAgICAgIGlmICghcmVzb2x2ZWQpIHtcbiAgICAgICAgdGhpcy5zZW5kSnNvbih7Y2hhbm5lbCwgZXJyb3I6IFwiU3Vic2NyaXB0aW9uIHJlamVjdGVkXCIsIHR5cGU6IFwiZXJyb3JcIn0pXG4gICAgICAgIHJldHVyblxuICAgICAgfVxuXG4gICAgICBjb25zdCBjaGFubmVsSW5zdGFuY2UgPSB0eXBlb2YgcmVzb2x2ZWQgPT09IFwiZnVuY3Rpb25cIlxuICAgICAgICA/IG5ldyByZXNvbHZlZCh7XG4gICAgICAgICAgY2xpZW50OiB0aGlzLmNsaWVudCxcbiAgICAgICAgICBjb25maWd1cmF0aW9uOiB0aGlzLmNvbmZpZ3VyYXRpb24sXG4gICAgICAgICAgbGFzdEV2ZW50SWQsXG4gICAgICAgICAgcmVxdWVzdDogdGhpcy51cGdyYWRlUmVxdWVzdCxcbiAgICAgICAgICBzdWJzY3JpcHRpb25DaGFubmVsOiBjaGFubmVsLFxuICAgICAgICAgIHN1YnNjcmlwdGlvblBhcmFtczogcGFyYW1zLFxuICAgICAgICAgIHdlYnNvY2tldFNlc3Npb246IHRoaXNcbiAgICAgICAgfSlcbiAgICAgICAgOiByZXNvbHZlZFxuXG4gICAgICBpZiAoY2hhbm5lbEluc3RhbmNlICYmICEoY2hhbm5lbEluc3RhbmNlIGluc3RhbmNlb2YgV2Vic29ja2V0Q2hhbm5lbCkpIHtcbiAgICAgICAgdGhyb3cgbmV3IEVycm9yKFwiUmVzb2x2ZWQgd2Vic29ja2V0IGNoYW5uZWwgbXVzdCBleHRlbmQgV2Vic29ja2V0Q2hhbm5lbFwiKVxuICAgICAgfVxuXG4gICAgICBhd2FpdCB0aGlzLl9yZWdpc3RlckNoYW5uZWwoY2hhbm5lbEluc3RhbmNlLCB0ZW5hbnQpXG4gICAgfSBjYXRjaCAoY2F1Z2h0RXJyb3IpIHtcbiAgICAgIGNvbnN0IGVycm9yID0gdGhpcy5fcmVwb3J0VW5leHBlY3RlZERpc3BhdGNoRXJyb3IoY2F1Z2h0RXJyb3IsIHtcbiAgICAgICAgY2hhbm5lbCxcbiAgICAgICAgc3RhZ2U6IFwid2Vic29ja2V0LWNoYW5uZWwtc3Vic2NyaXB0aW9uXCJcbiAgICAgIH0pXG5cbiAgICAgIHRoaXMubG9nZ2VyLndhcm4oKCkgPT4gW1wiV2Vic29ja2V0IGNoYW5uZWwgc3Vic2NyaXB0aW9uIGZhaWxlZFwiLCBlcnJvcl0pXG4gICAgICB0aGlzLnNlbmRKc29uKHtjaGFubmVsLCBlcnJvcjogXCJTdWJzY3JpcHRpb24gcmVqZWN0ZWRcIiwgdHlwZTogXCJlcnJvclwifSlcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogUnVucyBwcmVwYXJlIHJlcGxheSBzdGF0ZS5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBPcHRpb25zLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gYXJncy5jaGFubmVsIC0gSW50ZXJuYWwgY2hhbm5lbCBuYW1lLlxuICAgKiBAcGFyYW0ge3N0cmluZyB8IHVuZGVmaW5lZH0gYXJncy5sYXN0RXZlbnRJZCAtIExhc3QgcmVjZWl2ZWQgZXZlbnQgaWQuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBhcmdzLnN1YnNjcmlwdGlvbkNoYW5uZWwgLSBDbGllbnQtZmFjaW5nIGNoYW5uZWwgbmFtZS5cbiAgICogQHBhcmFtIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj4gfCB1bmRlZmluZWR9IGFyZ3Muc3Vic2NyaXB0aW9uUGFyYW1zIC0gQ2xpZW50LWZhY2luZyBwYXJhbXMuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPGZhbHNlIHwge2J1ZmZlcmVkOiBib29sZWFuLCBjZWlsaW5nU2VxdWVuY2U6IG51bWJlciwgY2hlY2twb2ludFNlcXVlbmNlOiBudW1iZXIsIHJlcGxheWluZzogYm9vbGVhbn0gfCBudWxsPn0gLSBSZXBsYXkgc3RhdGUuXG4gICAqL1xuICBhc3luYyBfcHJlcGFyZVJlcGxheVN0YXRlKHtjaGFubmVsLCBsYXN0RXZlbnRJZCwgc3Vic2NyaXB0aW9uQ2hhbm5lbCwgc3Vic2NyaXB0aW9uUGFyYW1zfSkge1xuICAgIGlmICghbGFzdEV2ZW50SWQpIHJldHVybiBudWxsXG5cbiAgICBjb25zdCBzdG9yZSA9IHdlYnNvY2tldEV2ZW50TG9nU3RvcmVGb3JDb25maWd1cmF0aW9uKHRoaXMuY29uZmlndXJhdGlvbilcbiAgICBjb25zdCBjaGVja3BvaW50ID0gYXdhaXQgc3RvcmUuZ2V0RXZlbnRCeUlkKHtjaGFubmVsLCBpZDogbGFzdEV2ZW50SWR9KVxuXG4gICAgaWYgKCFjaGVja3BvaW50KSB7XG4gICAgICB0aGlzLnNlbmRKc29uKHtjaGFubmVsOiBzdWJzY3JpcHRpb25DaGFubmVsLCBsYXN0RXZlbnRJZCwgcGFyYW1zOiBzdWJzY3JpcHRpb25QYXJhbXMsIHR5cGU6IFwicmVwbGF5LWdhcFwifSlcbiAgICAgIHJldHVybiBmYWxzZVxuICAgIH1cblxuICAgIHJldHVybiB7XG4gICAgICBidWZmZXJlZDogZmFsc2UsXG4gICAgICBjZWlsaW5nU2VxdWVuY2U6IChhd2FpdCBzdG9yZS5sYXRlc3RTZXF1ZW5jZShjaGFubmVsKSkgfHwgY2hlY2twb2ludC5zZXF1ZW5jZSxcbiAgICAgIGNoZWNrcG9pbnRTZXF1ZW5jZTogY2hlY2twb2ludC5zZXF1ZW5jZSxcbiAgICAgIHJlcGxheWluZzogdHJ1ZVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHJlcGxheSBjaGFubmVsIGV2ZW50cy5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBPcHRpb25zLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gYXJncy5jaGFubmVsIC0gQ2hhbm5lbCBuYW1lLlxuICAgKiBAcGFyYW0ge3tidWZmZXJlZDogYm9vbGVhbiwgY2VpbGluZ1NlcXVlbmNlOiBudW1iZXIsIGNoZWNrcG9pbnRTZXF1ZW5jZTogbnVtYmVyLCByZXBsYXlpbmc6IGJvb2xlYW59fSBhcmdzLnJlcGxheVN0YXRlIC0gUmVwbGF5IHN0YXRlLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyB3aGVuIHJlcGxheSBjb21wbGV0ZXMuXG4gICAqL1xuICBhc3luYyBfcmVwbGF5Q2hhbm5lbEV2ZW50cyh7Y2hhbm5lbCwgcmVwbGF5U3RhdGV9KSB7XG4gICAgY29uc3Qgc3RvcmUgPSB3ZWJzb2NrZXRFdmVudExvZ1N0b3JlRm9yQ29uZmlndXJhdGlvbih0aGlzLmNvbmZpZ3VyYXRpb24pXG4gICAgY29uc3QgZXZlbnRzID0gYXdhaXQgc3RvcmUuZ2V0RXZlbnRzQWZ0ZXIoe1xuICAgICAgY2hhbm5lbCxcbiAgICAgIHNlcXVlbmNlOiByZXBsYXlTdGF0ZS5jaGVja3BvaW50U2VxdWVuY2UsXG4gICAgICB1cFRvU2VxdWVuY2U6IHJlcGxheVN0YXRlLmNlaWxpbmdTZXF1ZW5jZVxuICAgIH0pXG5cbiAgICBmb3IgKGNvbnN0IGV2ZW50IG9mIGV2ZW50cykge1xuICAgICAgYXdhaXQgdGhpcy5zZW5kRXZlbnQoY2hhbm5lbCwgZXZlbnQucGF5bG9hZCwge1xuICAgICAgICBjcmVhdGVkQXQ6IGV2ZW50LmNyZWF0ZWRBdCxcbiAgICAgICAgZXZlbnRJZDogZXZlbnQuaWQsXG4gICAgICAgIHJlcGxheWVkOiB0cnVlLFxuICAgICAgICBzZXF1ZW5jZTogZXZlbnQuc2VxdWVuY2VcbiAgICAgIH0pXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZmluaXNoIHJlcGxheSBzdGF0ZS5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGNoYW5uZWwgLSBDaGFubmVsIG5hbWUuXG4gICAqIEBwYXJhbSB7e2J1ZmZlcmVkOiBib29sZWFuLCBjZWlsaW5nU2VxdWVuY2U6IG51bWJlciwgY2hlY2twb2ludFNlcXVlbmNlOiBudW1iZXIsIHJlcGxheWluZzogYm9vbGVhbn19IHJlcGxheVN0YXRlIC0gUmVwbGF5IHN0YXRlLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyB3aGVuIGJ1ZmZlcmVkIGV2ZW50cyBhcmUgZmx1c2hlZC5cbiAgICovXG4gIGFzeW5jIF9maW5pc2hSZXBsYXlTdGF0ZShjaGFubmVsLCByZXBsYXlTdGF0ZSkge1xuICAgIGNvbnN0IHN0b3JlID0gd2Vic29ja2V0RXZlbnRMb2dTdG9yZUZvckNvbmZpZ3VyYXRpb24odGhpcy5jb25maWd1cmF0aW9uKVxuXG4gICAgcmVwbGF5U3RhdGUucmVwbGF5aW5nID0gZmFsc2VcbiAgICB0aGlzLmNoYW5uZWxSZXBsYXlTdGF0ZXMuZGVsZXRlKGNoYW5uZWwpXG5cbiAgICBpZiAoIXJlcGxheVN0YXRlLmJ1ZmZlcmVkKSByZXR1cm5cblxuICAgIGNvbnN0IGxpdmVFdmVudHMgPSBhd2FpdCBzdG9yZS5nZXRFdmVudHNBZnRlcih7XG4gICAgICBjaGFubmVsLFxuICAgICAgc2VxdWVuY2U6IHJlcGxheVN0YXRlLmNlaWxpbmdTZXF1ZW5jZVxuICAgIH0pXG5cbiAgICBmb3IgKGNvbnN0IGV2ZW50IG9mIGxpdmVFdmVudHMpIHtcbiAgICAgIGF3YWl0IHRoaXMuc2VuZEV2ZW50KGNoYW5uZWwsIGV2ZW50LnBheWxvYWQsIHtcbiAgICAgICAgY3JlYXRlZEF0OiBldmVudC5jcmVhdGVkQXQsXG4gICAgICAgIGV2ZW50SWQ6IGV2ZW50LmlkLFxuICAgICAgICBzZXF1ZW5jZTogZXZlbnQuc2VxdWVuY2VcbiAgICAgIH0pXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgcmVzb2x2ZSB0ZW5hbnQuXG4gICAqIEBwYXJhbSB7e2NoYW5uZWw/OiBzdHJpbmcsIHBhcmFtcz86IFJlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn19IGFyZ3MgLSBUZW5hbnQgcmVzb2x1dGlvbiBhcmdzLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxzdHJpbmcgfCBudWxsIHwgdW5kZWZpbmVkPn0gLSBSZXNvbHZlZCB0ZW5hbnQuXG4gICAqL1xuICBhc3luYyBfcmVzb2x2ZVRlbmFudCh7Y2hhbm5lbCwgcGFyYW1zfSkge1xuICAgIGNvbnN0IHJlcXVlc3RQYXJhbXMgPSB0aGlzLnVwZ3JhZGVSZXF1ZXN0Py5wYXJhbXM/LigpXG4gICAgY29uc3QgbWVyZ2VkUGFyYW1zID0ge1xuICAgICAgLi4uKHJlcXVlc3RQYXJhbXMgJiYgdHlwZW9mIHJlcXVlc3RQYXJhbXMgPT09IFwib2JqZWN0XCIgPyByZXF1ZXN0UGFyYW1zIDoge30pLFxuICAgICAgLi4uKHBhcmFtcyAmJiB0eXBlb2YgcGFyYW1zID09PSBcIm9iamVjdFwiID8gcGFyYW1zIDoge30pXG4gICAgfVxuXG4gICAgcmV0dXJuIC8qKiBAdHlwZSB7UHJvbWlzZTxzdHJpbmcgfCBudWxsIHwgdW5kZWZpbmVkPn0gKi8gKHRoaXMuY29uZmlndXJhdGlvbi5yZXNvbHZlVGVuYW50KHtcbiAgICAgIHBhcmFtczogbWVyZ2VkUGFyYW1zLFxuICAgICAgcmVxdWVzdDogdGhpcy51cGdyYWRlUmVxdWVzdCxcbiAgICAgIHJlc3BvbnNlOiB1bmRlZmluZWQsXG4gICAgICBzdWJzY3JpcHRpb246IGNoYW5uZWwgPyB7Y2hhbm5lbCwgcGFyYW1zfSA6IHVuZGVmaW5lZFxuICAgIH0pKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgdW5tYXNrIHBheWxvYWQuXG4gICAqIEBwYXJhbSB7QnVmZmVyfSBwYXlsb2FkIC0gUGF5bG9hZCBkYXRhLlxuICAgKiBAcGFyYW0ge0J1ZmZlcn0gbWFzayAtIE1hc2suXG4gICAqIEByZXR1cm5zIHt2b2lkfSAtIE5vIHJldHVybiB2YWx1ZS5cbiAgICovXG4gIF91bm1hc2tQYXlsb2FkKHBheWxvYWQsIG1hc2spIHtcbiAgICBmb3IgKGxldCBpID0gMDsgaSA8IHBheWxvYWQubGVuZ3RoOyBpKyspIHtcbiAgICAgIHBheWxvYWRbaV0gXj0gbWFza1tpICUgNF1cbiAgICB9XG4gIH1cblxuICBhc3luYyBfcnVuTWVzc2FnZUhhbmRsZXJPcGVuKCkge1xuICAgIHRyeSB7XG4gICAgICBjb25zdCBoYW5kbGVyID0gdGhpcy5tZXNzYWdlSGFuZGxlclxuICAgICAgY29uc3Qgb25PcGVuID0gaGFuZGxlciA/IGhhbmRsZXIub25PcGVuIDogbnVsbFxuXG4gICAgICBpZiAob25PcGVuKSB7XG4gICAgICAgIGF3YWl0IG9uT3Blbih7c2Vzc2lvbjogdGhpc30pXG4gICAgICB9XG4gICAgfSBjYXRjaCAoY2F1Z2h0RXJyb3IpIHtcbiAgICAgIGNvbnN0IGVycm9yID0gdGhpcy5fcmVwb3J0VW5leHBlY3RlZERpc3BhdGNoRXJyb3IoY2F1Z2h0RXJyb3IsIHtcbiAgICAgICAgc3RhZ2U6IFwid2Vic29ja2V0LW1lc3NhZ2UtaGFuZGxlci1vcGVuXCJcbiAgICAgIH0pXG5cbiAgICAgIHRoaXMubG9nZ2VyLmVycm9yKCgpID0+IFtcIldlYnNvY2tldCBvcGVuIGhhbmRsZXIgZmFpbGVkXCIsIGVycm9yXSlcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogUnVucyBydW4gbWVzc2FnZSBoYW5kbGVyIG1lc3NhZ2UuXG4gICAqIEBwYXJhbSB7V2Vic29ja2V0U2Vzc2lvbk1lc3NhZ2V9IG1lc3NhZ2UgLSBJbmNvbWluZyB3ZWJzb2NrZXQgbWVzc2FnZS5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgd2hlbiBjb21wbGV0ZS5cbiAgICovXG4gIGFzeW5jIF9ydW5NZXNzYWdlSGFuZGxlck1lc3NhZ2UobWVzc2FnZSkge1xuICAgIHRyeSB7XG4gICAgICBjb25zdCBoYW5kbGVyID0gdGhpcy5tZXNzYWdlSGFuZGxlclxuICAgICAgY29uc3Qgb25NZXNzYWdlID0gaGFuZGxlciA/IGhhbmRsZXIub25NZXNzYWdlIDogbnVsbFxuXG4gICAgICBpZiAob25NZXNzYWdlKSB7XG4gICAgICAgIGF3YWl0IG9uTWVzc2FnZSh7bWVzc2FnZSwgc2Vzc2lvbjogdGhpc30pXG4gICAgICB9XG4gICAgfSBjYXRjaCAoY2F1Z2h0RXJyb3IpIHtcbiAgICAgIGNvbnN0IGhhbmRsZXIgPSB0aGlzLm1lc3NhZ2VIYW5kbGVyXG4gICAgICBjb25zdCBvbkVycm9yID0gaGFuZGxlciA/IGhhbmRsZXIub25FcnJvciA6IG51bGxcbiAgICAgIGNvbnN0IGhhbmRsZXJFcnJvciA9IGVuc3VyZUVycm9yKGNhdWdodEVycm9yKVxuICAgICAgY29uc3QgZXJyb3IgPSB0aGlzLl9yZXBvcnRVbmV4cGVjdGVkRGlzcGF0Y2hFcnJvcihoYW5kbGVyRXJyb3IsIHtcbiAgICAgICAgc3RhZ2U6IFwid2Vic29ja2V0LW1lc3NhZ2UtaGFuZGxlclwiXG4gICAgICB9KVxuXG4gICAgICB0aGlzLmxvZ2dlci5lcnJvcigoKSA9PiBbXCJXZWJzb2NrZXQgbWVzc2FnZSBoYW5kbGVyIGZhaWxlZFwiLCBlcnJvcl0pXG4gICAgICBpZiAoIW9uRXJyb3IpIHJldHVyblxuXG4gICAgICB0cnkge1xuICAgICAgICBhd2FpdCBvbkVycm9yKHtlcnJvcjogaGFuZGxlckVycm9yLCBzZXNzaW9uOiB0aGlzfSlcbiAgICAgIH0gY2F0Y2ggKG9uRXJyb3JDYXVnaHRFcnJvcikge1xuICAgICAgICBjb25zdCBjbGllbnRFcnJvck1lc3NhZ2UgPSBvbkVycm9yQ2F1Z2h0RXJyb3IgaW5zdGFuY2VvZiBFcnJvclxuICAgICAgICAgID8gb25FcnJvckNhdWdodEVycm9yLm1lc3NhZ2VcbiAgICAgICAgICA6IFN0cmluZyhvbkVycm9yQ2F1Z2h0RXJyb3IpXG4gICAgICAgIGNvbnN0IG9uRXJyb3JFcnJvciA9IHRoaXMuX3JlcG9ydFVuZXhwZWN0ZWREaXNwYXRjaEVycm9yKG9uRXJyb3JDYXVnaHRFcnJvciwge1xuICAgICAgICAgIHN0YWdlOiBcIndlYnNvY2tldC1tZXNzYWdlLWhhbmRsZXItZXJyb3JcIlxuICAgICAgICB9KVxuXG4gICAgICAgIHRoaXMubG9nZ2VyLmVycm9yKCgpID0+IFtcIldlYnNvY2tldCBtZXNzYWdlIGVycm9yIGhhbmRsZXIgZmFpbGVkXCIsIG9uRXJyb3JFcnJvcl0pXG4gICAgICAgIHRoaXMuc2VuZEpzb24oe1xuICAgICAgICAgIGVycm9yOiBjbGllbnRFcnJvck1lc3NhZ2UsXG4gICAgICAgICAgdHlwZTogXCJlcnJvclwiXG4gICAgICAgIH0pXG4gICAgICB9XG4gICAgfVxuICB9XG5cbiAgYXN5bmMgX3J1bk1lc3NhZ2VIYW5kbGVyQ2xvc2UoKSB7XG4gICAgdHJ5IHtcbiAgICAgIGNvbnN0IGhhbmRsZXIgPSB0aGlzLm1lc3NhZ2VIYW5kbGVyXG4gICAgICBjb25zdCBvbkNsb3NlID0gaGFuZGxlciA/IGhhbmRsZXIub25DbG9zZSA6IG51bGxcblxuICAgICAgaWYgKG9uQ2xvc2UpIHtcbiAgICAgICAgYXdhaXQgb25DbG9zZSh7c2Vzc2lvbjogdGhpc30pXG4gICAgICB9XG4gICAgfSBjYXRjaCAoY2F1Z2h0RXJyb3IpIHtcbiAgICAgIGNvbnN0IGVycm9yID0gdGhpcy5fcmVwb3J0VW5leHBlY3RlZERpc3BhdGNoRXJyb3IoY2F1Z2h0RXJyb3IsIHtcbiAgICAgICAgc3RhZ2U6IFwid2Vic29ja2V0LW1lc3NhZ2UtaGFuZGxlci1jbG9zZVwiXG4gICAgICB9KVxuXG4gICAgICB0aGlzLmxvZ2dlci5lcnJvcigoKSA9PiBbXCJXZWJzb2NrZXQgY2xvc2UgaGFuZGxlciBmYWlsZWRcIiwgZXJyb3JdKVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHJlbW90ZSBhZGRyZXNzLlxuICAgKiBAcmV0dXJucyB7c3RyaW5nIHwgdW5kZWZpbmVkfSAtIFJlbW90ZSBhZGRyZXNzIHJlc29sdmVkIGZyb20gdGhlIHdlYnNvY2tldCB1cGdyYWRlIHJlcXVlc3QuXG4gICAqL1xuICByZW1vdGVBZGRyZXNzKCkge1xuICAgIHJldHVybiB0aGlzLnVwZ3JhZGVSZXF1ZXN0Py5yZW1vdGVBZGRyZXNzKCkgfHwgdGhpcy5jbGllbnQucmVtb3RlQWRkcmVzc1xuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgc2V0IG1lc3NhZ2UgaGFuZGxlci5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi8uLi9jb25maWd1cmF0aW9uLXR5cGVzLmpzXCIpLldlYnNvY2tldE1lc3NhZ2VIYW5kbGVyfSBoYW5kbGVyIC0gSGFuZGxlciBpbnN0YW5jZS5cbiAgICogQHJldHVybnMge3ZvaWR9XG4gICAqL1xuICBzZXRNZXNzYWdlSGFuZGxlcihoYW5kbGVyKSB7XG4gICAgdGhpcy5tZXNzYWdlSGFuZGxlciA9IGhhbmRsZXJcbiAgICB2b2lkIHRoaXMuX3J1bk1lc3NhZ2VIYW5kbGVyT3BlbigpXG4gIH1cblxuICBhc3luYyBfcmVzb2x2ZU1lc3NhZ2VIYW5kbGVyUHJvbWlzZSgpIHtcbiAgICBpZiAoIXRoaXMubWVzc2FnZUhhbmRsZXJQcm9taXNlKSByZXR1cm5cblxuICAgIC8qKiBAdHlwZSB7aW1wb3J0KFwiLi4vLi4vY29uZmlndXJhdGlvbi10eXBlcy5qc1wiKS5XZWJzb2NrZXRNZXNzYWdlSGFuZGxlciB8IHZvaWR9ICovXG4gICAgbGV0IGhhbmRsZXJcblxuICAgIHRyeSB7XG4gICAgICBoYW5kbGVyID0gYXdhaXQgdGhpcy5tZXNzYWdlSGFuZGxlclByb21pc2VcbiAgICB9IGNhdGNoIChjYXVnaHRFcnJvcikge1xuICAgICAgY29uc3QgZXJyb3IgPSB0aGlzLl9yZXBvcnRVbmV4cGVjdGVkRGlzcGF0Y2hFcnJvcihjYXVnaHRFcnJvciwge1xuICAgICAgICBzdGFnZTogXCJ3ZWJzb2NrZXQtbWVzc2FnZS1oYW5kbGVyLXJlc29sdmVyXCJcbiAgICAgIH0pXG5cbiAgICAgIHRoaXMubG9nZ2VyLmVycm9yKCgpID0+IFtcIldlYnNvY2tldCBtZXNzYWdlIGhhbmRsZXIgcmVzb2x2ZXIgZmFpbGVkXCIsIGVycm9yXSlcbiAgICAgIHRoaXMubWVzc2FnZUhhbmRsZXJQcm9taXNlID0gdW5kZWZpbmVkXG4gICAgICBhd2FpdCB0aGlzLl9maW5pc2hNZXNzYWdlSGFuZGxlclJlc29sdXRpb24oe3VzZUhhbmRsZXI6IGZhbHNlfSlcbiAgICAgIHJldHVyblxuICAgIH1cblxuICAgIHRoaXMubWVzc2FnZUhhbmRsZXJQcm9taXNlID0gdW5kZWZpbmVkXG4gICAgaWYgKCFoYW5kbGVyKSB7XG4gICAgICBhd2FpdCB0aGlzLl9maW5pc2hNZXNzYWdlSGFuZGxlclJlc29sdXRpb24oe3VzZUhhbmRsZXI6IGZhbHNlfSlcbiAgICAgIHJldHVyblxuICAgIH1cblxuICAgIGlmICh0aGlzLl9pbmJvdW5kQ2xvc2VkKSB7XG4gICAgICB0aGlzLnBlbmRpbmdNZXNzYWdlSGFuZGxlciA9IGZhbHNlXG4gICAgICByZXR1cm5cbiAgICB9XG5cbiAgICAvLyBJbnN0YWxsIGhhbmRsZXIgYW5kIGRyYWluIG9uT3BlbiBiZWZvcmUgcmVwbGF5aW5nIHF1ZXVlZFxuICAgIC8vIG1lc3NhZ2VzLiBzZXRNZXNzYWdlSGFuZGxlcigpIGZpcmVzIG9uT3BlbiBhcyBmaXJlLWFuZC1mb3JnZXQ7XG4gICAgLy8gYXdhaXRpbmcgX3J1bk1lc3NhZ2VIYW5kbGVyT3BlbigpIGRpcmVjdGx5IGhlcmUgY2xvc2VzIHRoZVxuICAgIC8vIHJhY2Ugd2hlcmUgcXVldWVkIHN1YnNjcmliZS9jb25uZWN0aW9uLSogZnJhbWVzIHdvdWxkXG4gICAgLy8gZGlzcGF0Y2ggd2hpbGUgYW4gYXN5bmMgb25PcGVuIGlzIHN0aWxsIHNldHRpbmcgdXAgc2Vzc2lvblxuICAgIC8vIHN0YXRlLlxuICAgIHRoaXMubWVzc2FnZUhhbmRsZXIgPSBoYW5kbGVyXG4gICAgYXdhaXQgdGhpcy5fcnVuTWVzc2FnZUhhbmRsZXJPcGVuKClcbiAgICBhd2FpdCB0aGlzLl9maW5pc2hNZXNzYWdlSGFuZGxlclJlc29sdXRpb24oe1xuICAgICAgdXNlSGFuZGxlcjogdHlwZW9mIGhhbmRsZXIub25NZXNzYWdlID09PSBcImZ1bmN0aW9uXCJcbiAgICB9KVxuICB9XG5cbiAgLyoqXG4gICAqIEluc2VydHMgcmVzb2x2ZXIgY29tcGxldGlvbiBpbnRvIHRoZSBGSUZPIGNoYWluIGJlZm9yZSBhbGxvd2luZyBuZXcgZGlzcGF0Y2guXG4gICAqIEBwYXJhbSB7e3VzZUhhbmRsZXI6IGJvb2xlYW59fSBhcmdzIC0gUmVzb2x2ZXIgcmVzdWx0LlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyBhZnRlciBxdWV1ZWQgbWVzc2FnZXMgZHJhaW4uXG4gICAqL1xuICBhc3luYyBfZmluaXNoTWVzc2FnZUhhbmRsZXJSZXNvbHV0aW9uKHt1c2VIYW5kbGVyfSkge1xuICAgIGNvbnN0IHByZXZpb3VzID0gdGhpcy5fbWVzc2FnZUNoYWluXG4gICAgY29uc3QgZHJhaW4gPSBwcmV2aW91cy50aGVuKGFzeW5jICgpID0+IHtcbiAgICAgIHRoaXMucGVuZGluZ01lc3NhZ2VIYW5kbGVyID0gZmFsc2VcbiAgICAgIGlmICh0aGlzLl9pbmJvdW5kQ2xvc2VkKSB7XG4gICAgICAgIHRoaXMubWVzc2FnZVF1ZXVlID0gW11cbiAgICAgICAgcmV0dXJuXG4gICAgICB9XG5cbiAgICAgIGF3YWl0IHRoaXMuX2ZsdXNoUXVldWVkTWVzc2FnZXMoe3VzZUhhbmRsZXJ9KVxuICAgIH0pXG5cbiAgICB0aGlzLl9tZXNzYWdlQ2hhaW4gPSBkcmFpbi5jYXRjaCgoKSA9PiB7fSlcbiAgICBhd2FpdCBkcmFpblxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZmx1c2ggcXVldWVkIG1lc3NhZ2VzLlxuICAgKiBAcGFyYW0ge3t1c2VIYW5kbGVyOiBib29sZWFufX0gYXJncyAtIEFyZ3MuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIHdoZW4gY29tcGxldGUuXG4gICAqL1xuICBhc3luYyBfZmx1c2hRdWV1ZWRNZXNzYWdlcyh7dXNlSGFuZGxlcn0pIHtcbiAgICBpZiAodGhpcy5tZXNzYWdlUXVldWUubGVuZ3RoID09PSAwKSByZXR1cm5cblxuICAgIGNvbnN0IHF1ZXVlZCA9IHRoaXMubWVzc2FnZVF1ZXVlXG4gICAgdGhpcy5tZXNzYWdlUXVldWUgPSBbXVxuXG4gICAgZm9yIChjb25zdCB3b3JrIG9mIHF1ZXVlZCkge1xuICAgICAgaWYgKHRoaXMuX2luYm91bmRDbG9zZWQpIHtcbiAgICAgICAgdGhpcy5fcmVsZWFzZUluYm91bmRBZG1pc3Npb24od29yay5hZG1pc3Npb24pXG4gICAgICAgIGNvbnRpbnVlXG4gICAgICB9XG5cbiAgICAgIHRyeSB7XG4gICAgICAgIGlmICh1c2VIYW5kbGVyICYmIHRoaXMubWVzc2FnZUhhbmRsZXIpIHtcbiAgICAgICAgICBhd2FpdCB0aGlzLl9ydW5XaXRoTWVzc2FnZUxvZ0NvbnRleHQod29yay5tZXNzYWdlLCBhc3luYyAoKSA9PiB7XG4gICAgICAgICAgICBhd2FpdCB0aGlzLl9ydW5NZXNzYWdlSGFuZGxlck1lc3NhZ2Uod29yay5tZXNzYWdlKVxuICAgICAgICAgIH0pXG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgYXdhaXQgdGhpcy5fZGlzcGF0Y2hNZXNzYWdlKHdvcmsubWVzc2FnZSlcbiAgICAgICAgfVxuICAgICAgfSBjYXRjaCAoY2F1Z2h0RXJyb3IpIHtcbiAgICAgICAgY29uc3QgY2xpZW50RXJyb3JNZXNzYWdlID0gY2F1Z2h0RXJyb3IgaW5zdGFuY2VvZiBFcnJvciA/IGNhdWdodEVycm9yLm1lc3NhZ2UgOiBTdHJpbmcoY2F1Z2h0RXJyb3IpXG4gICAgICAgIGNvbnN0IGVycm9yID0gdGhpcy5fcmVwb3J0VW5leHBlY3RlZERpc3BhdGNoRXJyb3IoY2F1Z2h0RXJyb3IsIHtcbiAgICAgICAgICBzdGFnZTogXCJ3ZWJzb2NrZXQtbWVzc2FnZS1kaXNwYXRjaFwiXG4gICAgICAgIH0pXG5cbiAgICAgICAgdGhpcy5sb2dnZXIuZXJyb3IoKCkgPT4gW1wiV2Vic29ja2V0IG1lc3NhZ2UgaGFuZGxlciBmYWlsZWRcIiwgZXJyb3JdKVxuICAgICAgICB0aGlzLnNlbmRKc29uKHtcbiAgICAgICAgICBlcnJvcjogY2xpZW50RXJyb3JNZXNzYWdlLFxuICAgICAgICAgIHR5cGU6IFwiZXJyb3JcIlxuICAgICAgICB9KVxuICAgICAgfSBmaW5hbGx5IHtcbiAgICAgICAgdGhpcy5fcmVsZWFzZUluYm91bmRBZG1pc3Npb24od29yay5hZG1pc3Npb24pXG4gICAgICB9XG4gICAgfVxuICB9XG59XG4iXX0=