import Logger from "../../logger.js";
import WebsocketChannel from "../websocket-channel.js";
import WebsocketRequest from "./websocket-request.js";
export type WebsocketSessionMessage = {
    type: "subscribe";
    channel: string;
    lastEventId?: string;
    params?: Record<string, ReturnType<typeof JSON.parse>>;
} | {
    type: "metadata";
    data?: Record<string, ReturnType<typeof JSON.parse>>;
} | {
    type?: "request";
    body?: ReturnType<typeof JSON.parse>;
    headers?: Record<string, ReturnType<typeof JSON.parse>>;
    id?: string | number | null;
    method: string;
    path: string;
} | Record<string, ReturnType<typeof JSON.parse>>;
export type InboundMessageAdmission = {
    /**
     * - Exact raw text payload bytes charged to this admission.
     */
    byteLength: number;
    /**
     * - Accounting generation active when admitted.
     */
    generation: number;
    /**
     * - Whether this admission has already been released.
     */
    released: boolean;
};
export type InboundMessageWork = {
    /**
     * - Admission ownership.
     */
    admission: InboundMessageAdmission;
    /**
     * - Decoded client message.
     */
    message: WebsocketSessionMessage;
};
export default class VelociousHttpServerClientWebsocketSession {
    /** @type {Buffer[]} */
    _bufferChunks: Buffer[];
    _bufferChunkIndex: number;
    _bufferChunkOffset: number;
    _bufferedBytes: number;
    _bufferedFrameCopyBytes: number;
    client: import("./index.js").default;
    configuration: import("../../configuration.js").default;
    upgradeRequest: WebsocketRequest | import("./request.js").default | undefined;
    messageHandler: import("../../configuration-types.js").WebsocketMessageHandler | undefined;
    messageHandlerPromise: Promise<void | import("../../configuration-types.js").WebsocketMessageHandler> | undefined;
    pendingMessageHandler: boolean;
    logger: Logger;
    _inboundMaxPendingBytes: number;
    _inboundMaxPendingMessages: number;
    _inboundPendingBytes: number;
    _inboundPendingMessages: number;
    _inboundAccountingGeneration: number;
    _inboundClosed: boolean;
    _inboundBacklogOverloaded: boolean;
    /**
     * Narrows the runtime value to the documented type.
     * @type {Record<string, ReturnType<typeof JSON.parse>>} */
    _metadata: Record<string, ReturnType<typeof JSON.parse>>;
    /**
     * Long-lived per-session state bag. Stable across reconnects once
     * grace-period resumption lands in Phase 2; today it just lives
     * for the duration of the underlying socket.
     * @type {Record<string, ReturnType<typeof JSON.parse>>}
     */
    data: Record<string, ReturnType<typeof JSON.parse>>;
    /**
     * Narrows the runtime value to the documented type.
     * @type {Map<string, import("../websocket-connection.js").default>} */
    _connections: Map<string, import("../websocket-connection.js").default>;
    /**
     * Narrows the runtime value to the documented type.
     * @type {Map<string, {channelType: string, subscription: import("../websocket-channel.js").default}>} */
    _channelSubscriptions: Map<string, {
        channelType: string;
        subscription: import("../websocket-channel.js").default;
    }>;
    /**
     * Unique id assigned to this session on first connect. Sent to the
     * client via `session-established`; the client echoes it back via
     * `session-resume` after a WS drop to reattach to this session
     * within the grace period.
     * @type {string}
     */
    sessionId: string;
    /**
     * Narrows the runtime value to the documented type.
     * @type {boolean} - true after `_handleClose` pauses instead of tearing down.
     */
    _paused: boolean;
    /**
     * Narrows the runtime value to the documented type.
     * @type {Array<ReturnType<typeof JSON.parse>>} - frames produced while paused; flushed on resume.
     */
    _outboundQueue: Array<ReturnType<typeof JSON.parse>>;
    /**
     * Narrows the runtime value to the documented type.
     * @type {import("./index.js").default | null} */
    socket: import("./index.js").default | null;
    /**
     * Tail of a per-session promise chain that serializes message
     * handling. Prevents races where message B reads `session.data`
     * before message A's handler finishes writing it (e.g. a
     * connection-message setting the locale vs. a subsequent request
     * whose aroundRequest wrapper reads it).
     * @type {Promise<void>}
     */
    _messageChain: Promise<void>;
    /**
     * Promise that resolves to the auth identity captured at pause
     * time by `getWebsocketSessionIdentityResolver`. Awaited at resume
     * time to compare against the fresh caller's identity. Undefined
     * on a live (non-paused) session.
     * @type {Promise<ReturnType<typeof JSON.parse>> | undefined}
     */
    _resumeIdentityPromise: Promise<ReturnType<typeof JSON.parse>> | undefined;
    /** @type {string | null} */
    _claimedSessionId: string | null;
    /**
     * Accumulates payloads for a fragmented websocket message per
     * RFC 6455. Non-null while mid-fragment; cleared when the frame
     * with FIN=1 completes and the message is dispatched.
     * @type {Buffer[] | null}
     */
    _fragmentedPayloads: Buffer[] | null;
    /**
     * Opcode (TEXT/BINARY) captured from the first frame of a
     * fragmented message. Continuation frames (opcode 0) inherit it
     * at reassembly time.
     * @type {number | null}
     */
    _fragmentedOpcode: number | null;
    /**
     * Running byte total for `_fragmentedPayloads`. Used to enforce
     * `WEBSOCKET_MAX_FRAGMENTED_MESSAGE_BYTES` so a peer cannot
     * exhaust memory by streaming non-final fragments indefinitely.
     * @type {number}
     */
    _fragmentedBytes: number;
    /**
     * Heartbeat liveness flag. Set true on every inbound frame
     * (including the client's auto-pong) and cleared each time a ping
     * is sent; a still-false flag at the next tick means the socket
     * has gone silent.
     * @type {boolean}
     */
    _heartbeatAlive: boolean;
    /**
     * Per-session heartbeat interval handle. Started from
     * `sendSessionEstablished` once the socket is live, not at
     * construction, so directly-constructed sessions in tests don't
     * spin up a background timer.
     * @type {ReturnType<typeof setInterval> | null}
     */
    _heartbeatTimer: ReturnType<typeof setInterval> | null;
    events: import("eventemitter3").EventEmitter<string | symbol, any>;
    subscriptions: Set<any>;
    channels: Set<any>;
    subscriptionHandlers: Map<any, any>;
    handlerSubscriptions: Map<any, any>;
    channelTenants: Map<any, any>;
    channelReplayStates: Map<any, any>;
    /**
     * Message queue.
     * @type {InboundMessageWork[]} */
    messageQueue: InboundMessageWork[];
    /**
     * Runs constructor.
     * @param {object} args - Options object.
     * @param {import("../../configuration.js").default} args.configuration - Configuration instance.
     * @param {import("./index.js").default} args.client - Client instance.
     * @param {import("./request.js").default | import("./websocket-request.js").default} [args.upgradeRequest] - Initial websocket upgrade request.
     * @param {import("../../configuration-types.js").WebsocketMessageHandler} [args.messageHandler] - Optional raw message handler.
     * @param {Promise<import("../../configuration-types.js").WebsocketMessageHandler | void>} [args.messageHandlerPromise] - Optional raw message handler promise.
     */
    constructor({ client, configuration, upgradeRequest, messageHandler, messageHandlerPromise }: {
        configuration: import("../../configuration.js").default;
        client: import("./index.js").default;
        upgradeRequest?: import("./request.js").default | import("./websocket-request.js").default;
        messageHandler?: import("../../configuration-types.js").WebsocketMessageHandler;
        messageHandlerPromise?: Promise<import("../../configuration-types.js").WebsocketMessageHandler | void>;
    });
    /**
     * Sends the client its sessionId + grace window. Called by
     * `VelociousHttpServerClient` after the WS upgrade completes.
     * @returns {void}
     */
    sendSessionEstablished(): void;
    /**
     * Removes a closed connection from the session registry. Called by
     * `VelociousWebsocketConnection.close()` after it sends the final
     * `connection-closed` frame.
     * @param {string} connectionId - Closed connection identifier to remove.
     * @returns {void}
     */
    _removeConnection(connectionId: string): void;
    /**
     * Runs get metadata.
     * @returns {Record<string, ReturnType<typeof JSON.parse>>} - Client-provided metadata (defensive copy).
     */
    getMetadata(): Record<string, ReturnType<typeof JSON.parse>>;
    /**
     * Runs is paused.
     * @returns {boolean} - true while the session is in the paused/grace registry.
     */
    isPaused(): boolean;
    /**
     * Runs add subscription.
     * @param {string} channel - Channel name.
     * @returns {void} - No return value.
     */
    addSubscription(channel: string): void;
    destroy(): void;
    /** Claims this session id for host-side reconnect routing. */
    _claimOwnership(): void;
    /** Releases the currently claimed session id exactly once. */
    _releaseOwnership(): void;
    /**
     * Runs has subscription.
     * @param {string} channel - Channel name.
     * @returns {boolean} - Whether it has subscription.
     */
    hasSubscription(channel: string): boolean;
    /**
     * Runs on data.
     * @param {Buffer} data - Data payload.
     * @returns {void} - No return value.
     */
    onData(data: Buffer): void;
    /**
     * Runs send event.
     * @param {string} channel - Channel name.
     * @param {ReturnType<typeof JSON.parse>} payload - Payload data.
     * @param {{createdAt?: string, eventId?: string, replayed?: boolean, sequence?: number}} [options] - Event metadata.
     * @returns {Promise<void>} - Resolves when complete.
     */
    sendEvent(channel: string, payload: ReturnType<typeof JSON.parse>, options?: {
        createdAt?: string;
        eventId?: string;
        replayed?: boolean;
        sequence?: number;
    }): Promise<void>;
    /**
     * Runs initialize channel.
     * @returns {Promise<void>} - Resolves when complete.
     */
    initializeChannel(): Promise<void>;
    /**
     * Runs send goodbye.
     * @param {import("./index.js").default} client - Client instance.
     * @param {{code?: number, reason?: string}} [options] - Optional close status.
     * @returns {void} - No return value.
     */
    sendGoodbye(client: import("./index.js").default, { code, reason }?: {
        code?: number;
        reason?: string;
    }): void;
    /**
     * Whether a caught dispatch error is an expected client-flow failure.
     * @param {Error} error - Normalized dispatch error.
     * @returns {boolean} - Whether framework error reporters should ignore it.
     */
    _expectedClientError(error: Error): boolean;
    /**
     * Reports one unexpected WebSocket dispatch failure and returns its redacted Error diagnostic.
     * @param {ReturnType<typeof JSON.parse>} caughtError - Caught dispatch failure.
     * @param {Record<string, ReturnType<typeof JSON.parse>>} context - Structured dispatch context.
     * @returns {Error} - Redacted error for logs and framework error events.
     */
    _reportUnexpectedDispatchError(caughtError: ReturnType<typeof JSON.parse>, context: Record<string, ReturnType<typeof JSON.parse>>): Error;
    /**
     * Runs handle message.
     * @param {WebsocketSessionMessage} message - Message text.
     * @returns {Promise<void>} - Resolves when complete.
     */
    _handleMessage(message: WebsocketSessionMessage): Promise<void>;
    /**
     * Appends an admitted message to the per-session FIFO chain.
     * @param {InboundMessageWork} work - Admitted decoded message.
     * @returns {Promise<void>} - Resolves when complete.
     */
    _handleMessageWork(work: InboundMessageWork): Promise<void>;
    /**
     * Dispatches or transfers one admitted message while retaining its accounting.
     * @param {InboundMessageWork} work - Admitted decoded message.
     * @returns {Promise<void>} - Resolves after dispatch or resolver-queue transfer.
     */
    _runMessageWork(work: InboundMessageWork): Promise<void>;
    /**
     * Runs dispatch message.
     * @param {WebsocketSessionMessage} message - Message text.
     * @returns {Promise<void>} - Resolves when complete.
     */
    _dispatchMessage(message: WebsocketSessionMessage): Promise<void>;
    /**
     * Runs one decoded message in its own request timing and sensitive-value context.
     * @param {WebsocketSessionMessage} message - Decoded client message.
     * @param {() => Promise<void>} callback - Message dispatch callback.
     * @returns {Promise<void>} - Resolves after the message finishes.
     */
    _runWithMessageLogContext(message: WebsocketSessionMessage, callback: () => Promise<void>): Promise<void>;
    /**
     * The actual message dispatch, extracted so
     * `configuration.getWebsocketAroundRequest()` can wrap it in any
     * per-request context (AsyncLocalStorage, tracing, etc.).
     * @param {WebsocketSessionMessage} message - Decoded client frame to dispatch by message type.
     * @returns {Promise<void>}
     */
    _handleMessageInner(message: WebsocketSessionMessage): Promise<void>;
    /**
     * Runs process buffer.
     * @returns {void} - No return value.
     */
    _processBuffer(): void;
    /**
     * Copies the leading buffered bytes without consuming them. Header
     * inspection is bounded to the websocket header size.
     * @param {number} byteCount - Number of leading bytes to inspect.
     * @returns {Buffer} - Copied prefix.
     */
    _peekBufferedBytes(byteCount: number): Buffer;
    /**
     * Consumes a complete frame from the chunk queue with one bounded copy.
     * @param {number} byteCount - Complete frame byte count.
     * @returns {Buffer} - Contiguous frame bytes.
     */
    _consumeBufferedBytes(byteCount: number): Buffer;
    /**
     * Drops all incomplete frame chunks.
     * @returns {void}
     */
    _clearBufferedFrameChunks(): void;
    /**
     * Tentatively admits one complete text message before decoding it.
     * @param {number} byteLength - Exact complete raw text payload bytes.
     * @returns {InboundMessageAdmission | null} - Admission ownership, or null after overload/close.
     */
    _admitInboundMessage(byteLength: number): InboundMessageAdmission | null;
    /**
     * Releases one admission exactly once.
     * @param {InboundMessageAdmission} admission - Admission ownership.
     * @returns {void}
     */
    _releaseInboundAdmission(admission: InboundMessageAdmission): void;
    /**
     * Abandons all admitted input and invalidates late settlements.
     * @returns {void}
     */
    _abandonInboundMessages(): void;
    /**
     * Permanently closes a session whose next message exceeded its backlog budget.
     * @param {number} rejectedBytes - Raw payload bytes rejected at admission.
     * @returns {void}
     */
    _closeForInboundBacklog(rejectedBytes: number): void;
    /**
     * Closes after an inbound buffering limit and releases all parser-owned input.
     * @returns {void}
     */
    _closeForInboundLimit(): void;
    /**
     * Appends a continuation-frame payload to the in-progress
     * fragmented message. Returns true when the fragment was accepted
     * and false when the per-message cap was hit and the socket has
     * been closed.
     * @param {Buffer} payload - Continuation-frame bytes to append.
     * @returns {boolean} - Whether the fragment was accepted.
     */
    _appendFragment(payload: Buffer): boolean;
    /**
     * Verifies the fragmented message has not exceeded the byte or
     * fragment-count caps. On overflow, clears the buffer, sends a
     * close frame, and tears the session down. Returns true when the
     * caller can continue processing, false when the session is being
     * closed.
     * @returns {boolean} - Whether fragment processing may continue.
     */
    _enforceFragmentLimits(): boolean;
    /**
     * Runs reset fragment buffer.
     * @returns {void} */
    _resetFragmentBuffer(): void;
    /**
     * Starts the per-session heartbeat. Each tick pings the client and
     * reaps the session if the previous ping went unanswered, so a
     * half-open socket (client gone without a TCP FIN / close frame)
     * cannot linger forever holding channel subscriptions. Disabled when
     * the configured interval is 0.
     * @returns {void}
     */
    _startHeartbeat(): void;
    /**
     * One heartbeat cycle. Reaps the session via the normal close path
     * when the previous ping was not answered; otherwise marks it
     * pending and pings again. Browsers and React Native sockets answer
     * server pings with an automatic pong, which lands in `_processBuffer`
     * and re-marks the session alive.
     * @returns {void}
     */
    _heartbeatTick(): void;
    /**
     * Stops the per-session heartbeat timer, if any.
     * @returns {void}
     */
    _stopHeartbeat(): void;
    /**
     * Runs send control frame.
     * @param {number} opcode - Opcode.
     * @param {Buffer} payload - Payload data.
     * @returns {void} - No return value.
     */
    _sendControlFrame(opcode: number, payload: Buffer): void;
    /**
     * Runs send json.
     * @param {object} body - Request body.
     * @returns {void} - No return value.
     */
    sendJson(body: object): void;
    /**
     * Flushes the paused outbound queue over the current socket.
     * Called during resume after `session-resumed` has been sent on
     * the NEW session's socket (not this session's).
     * @returns {void}
     */
    _flushOutboundQueue(): void;
    /**
     * Runs subscribe to channel.
     * @param {string} channel - Channel name.
     * @param {{acknowledge?: boolean, channelHandler?: import("../websocket-channel.js").default, lastEventId?: string, params?: Record<string, ReturnType<typeof JSON.parse>>, subscriptionChannel?: string}} [options] - Subscribe options.
     * @returns {Promise<boolean>} - Whether the subscription was added.
     */
    subscribeToChannel(channel: string, { acknowledge, channelHandler, lastEventId, params, subscriptionChannel }?: {
        acknowledge?: boolean;
        channelHandler?: import("../websocket-channel.js").default;
        lastEventId?: string;
        params?: Record<string, ReturnType<typeof JSON.parse>>;
        subscriptionChannel?: string;
    }): Promise<boolean>;
    /**
     * Handles socket closure and optionally retains resumable state.
     * @param {{allowResume?: boolean}} [options] - Closure behavior.
     * @returns {void}
     */
    _handleClose({ allowResume }?: {
        allowResume?: boolean;
    }): void;
    /**
     * Called by the grace timer when the paused period expires without
     * a resume. Tears down all live Connections + Channel subs and
     * drops the session.
     * @returns {void}
     */
    _finalizeGraceExpiry(): void;
    /**
     * Runs the configured identity resolver against this session.
     * The returned promise is stored at pause time and awaited at
     * resume time so we can reject resume attempts from a different
     * authenticated caller (signed out, swapped user, expired cookie).
     * @returns {Promise<ReturnType<typeof JSON.parse>>} - Captured authenticated identity for resume validation.
     */
    _captureResumeIdentity(): Promise<ReturnType<typeof JSON.parse>>;
    /**
     * Fires `onDisconnect` on every live Connection and Channel sub so
     * apps can pause per-instance work while the session is paused.
     * Errors are logged, not rethrown — one broken handler must not
     * block the rest.
     * @returns {Promise<void>}
     */
    _fireOnDisconnect(): Promise<void>;
    /**
     * Fires `onResume` on every live Connection and Channel sub after
     * a successful `session-resume` handoff.
     * @returns {Promise<void>}
     */
    _fireOnResume(): Promise<void>;
    /**
     * Runs fire lifecycle callback.
     * @param {"onDisconnect" | "onResume"} callbackName Lifecycle callback to fire.
     * @returns {Promise<void>} Resolves when every live handler has been attempted.
     */
    _fireLifecycleCallback(callbackName: "onDisconnect" | "onResume"): Promise<void>;
    /**
     * Handles `{type: "session-resume"}`. This session (the newly-
     * created one whose socket just connected) transfers state from
     * the paused session and instructs the client via
     * `session-resumed` or `session-gone`.
     * @param {Record<string, ReturnType<typeof JSON.parse>>} message - Session-resume frame containing the paused session identifier.
     * @returns {Promise<void>}
     */
    _handleSessionResume(message: Record<string, ReturnType<typeof JSON.parse>>): Promise<void>;
    /**
     * Fires `onClose(reason)` on every live app-defined connection, then
     * drops them from the registry. No network frame is sent — the
     * socket is already going away.
     * @param {"session_destroyed" | "grace_expired" | "error"} reason - Permanent teardown reason passed to each connection.
     * @returns {Promise<void>}
     */
    _teardownConnections(reason: "session_destroyed" | "grace_expired" | "error"): Promise<void>;
    /**
     * Handles a `{type: "connection-open"}` message — instantiates the
     * registered connection class, stores it on `_connections`, and
     * fires `onConnect()`. Sends `connection-opened` on success or
     * `connection-error` on failure.
     * @param {Record<string, ReturnType<typeof JSON.parse>>} message - Connection-open frame naming the connection type and identifier.
     * @returns {Promise<void>}
     */
    _handleConnectionOpen(message: Record<string, ReturnType<typeof JSON.parse>>): Promise<void>;
    /**
     * Handles a `{type: "connection-message"}` from the client.
     * @param {Record<string, ReturnType<typeof JSON.parse>>} message - Connection-message frame containing the target identifier and body.
     * @returns {Promise<void>}
     */
    _handleConnectionMessage(message: Record<string, ReturnType<typeof JSON.parse>>): Promise<void>;
    /**
     * Handles a `{type: "connection-close"}` from the client — fires
     * `onClose("client_close")` and confirms with `connection-closed`.
     * @param {Record<string, ReturnType<typeof JSON.parse>>} message - Connection-close frame containing the target identifier.
     * @returns {Promise<void>}
     */
    _handleConnectionClose(message: Record<string, ReturnType<typeof JSON.parse>>): Promise<void>;
    /**
     * Handles `{type: "channel-subscribe"}` — runs `canSubscribe()`,
     * registers with the Configuration's global routing registry on
     * success, and sends `channel-subscribed` or `channel-error`.
     * @param {Record<string, ReturnType<typeof JSON.parse>>} message - Channel-subscribe frame describing the requested subscription.
     * @returns {Promise<void>}
     */
    _handleChannelSubscribe(message: Record<string, ReturnType<typeof JSON.parse>>): Promise<void>;
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
    _replayChannelEventsForSubscription({ channelType, lastEventId, subscription }: {
        channelType: string;
        lastEventId: string;
        subscription: import("../websocket-channel.js").default;
    }): Promise<void>;
    /**
     * Handles `{type: "channel-unsubscribe"}` from the client — calls
     * `unsubscribed()` and sends `channel-unsubscribed`.
     * @param {Record<string, ReturnType<typeof JSON.parse>>} message - Channel-unsubscribe frame containing the subscription identifier.
     * @returns {Promise<void>}
     */
    _handleChannelUnsubscribe(message: Record<string, ReturnType<typeof JSON.parse>>): Promise<void>;
    /**
     * Fires `unsubscribed()` on every live channel-v2 subscription,
     * removes them from the Configuration's global registry, and
     * drops the session's own map. No network frames — the socket
     * is already going away.
     * @returns {Promise<void>}
     */
    _teardownChannelSubscriptions(): Promise<void>;
    _teardownChannel(): Promise<void>;
    /**
     * Runs teardown single channel.
     * @param {WebsocketChannel} channel - Channel instance.
     * @returns {Promise<void>} - Resolves when complete.
     */
    _teardownSingleChannel(channel: WebsocketChannel): Promise<void>;
    /**
     * Runs register channel.
     * @param {WebsocketChannel | undefined} channel - Channel instance.
     * @param {string | null | undefined} tenant - Tenant key.
     * @returns {Promise<void>} - Resolves when complete.
     */
    _registerChannel(channel: WebsocketChannel | undefined, tenant: string | null | undefined): Promise<void>;
    /**
     * Runs with connections.
     * @param {() => Promise<void>} callback - Callback.
     * @returns {Promise<void>} - Resolves when complete.
     */
    _withConnections(callback: () => Promise<void>): Promise<void>;
    /**
     * Runs handle channel subscription.
     * @param {{channel: string, lastEventId?: string, params?: Record<string, ReturnType<typeof JSON.parse>>}} args - Subscription args.
     * @returns {Promise<void>} - Resolves when complete.
     */
    _handleChannelSubscription({ channel, lastEventId, params }: {
        channel: string;
        lastEventId?: string;
        params?: Record<string, ReturnType<typeof JSON.parse>>;
    }): Promise<void>;
    /**
     * Runs prepare replay state.
     * @param {object} args - Options.
     * @param {string} args.channel - Internal channel name.
     * @param {string | undefined} args.lastEventId - Last received event id.
     * @param {string} args.subscriptionChannel - Client-facing channel name.
     * @param {Record<string, ReturnType<typeof JSON.parse>> | undefined} args.subscriptionParams - Client-facing params.
     * @returns {Promise<false | {buffered: boolean, ceilingSequence: number, checkpointSequence: number, replaying: boolean} | null>} - Replay state.
     */
    _prepareReplayState({ channel, lastEventId, subscriptionChannel, subscriptionParams }: {
        channel: string;
        lastEventId: string | undefined;
        subscriptionChannel: string;
        subscriptionParams: Record<string, ReturnType<typeof JSON.parse>> | undefined;
    }): Promise<false | {
        buffered: boolean;
        ceilingSequence: number;
        checkpointSequence: number;
        replaying: boolean;
    } | null>;
    /**
     * Runs replay channel events.
     * @param {object} args - Options.
     * @param {string} args.channel - Channel name.
     * @param {{buffered: boolean, ceilingSequence: number, checkpointSequence: number, replaying: boolean}} args.replayState - Replay state.
     * @returns {Promise<void>} - Resolves when replay completes.
     */
    _replayChannelEvents({ channel, replayState }: {
        channel: string;
        replayState: {
            buffered: boolean;
            ceilingSequence: number;
            checkpointSequence: number;
            replaying: boolean;
        };
    }): Promise<void>;
    /**
     * Runs finish replay state.
     * @param {string} channel - Channel name.
     * @param {{buffered: boolean, ceilingSequence: number, checkpointSequence: number, replaying: boolean}} replayState - Replay state.
     * @returns {Promise<void>} - Resolves when buffered events are flushed.
     */
    _finishReplayState(channel: string, replayState: {
        buffered: boolean;
        ceilingSequence: number;
        checkpointSequence: number;
        replaying: boolean;
    }): Promise<void>;
    /**
     * Runs resolve tenant.
     * @param {{channel?: string, params?: Record<string, ReturnType<typeof JSON.parse>>}} args - Tenant resolution args.
     * @returns {Promise<string | null | undefined>} - Resolved tenant.
     */
    _resolveTenant({ channel, params }: {
        channel?: string;
        params?: Record<string, ReturnType<typeof JSON.parse>>;
    }): Promise<string | null | undefined>;
    /**
     * Runs unmask payload.
     * @param {Buffer} payload - Payload data.
     * @param {Buffer} mask - Mask.
     * @returns {void} - No return value.
     */
    _unmaskPayload(payload: Buffer, mask: Buffer): void;
    _runMessageHandlerOpen(): Promise<void>;
    /**
     * Runs run message handler message.
     * @param {WebsocketSessionMessage} message - Incoming websocket message.
     * @returns {Promise<void>} - Resolves when complete.
     */
    _runMessageHandlerMessage(message: WebsocketSessionMessage): Promise<void>;
    _runMessageHandlerClose(): Promise<void>;
    /**
     * Runs remote address.
     * @returns {string | undefined} - Remote address resolved from the websocket upgrade request.
     */
    remoteAddress(): string | undefined;
    /**
     * Runs set message handler.
     * @param {import("../../configuration-types.js").WebsocketMessageHandler} handler - Handler instance.
     * @returns {void}
     */
    setMessageHandler(handler: import("../../configuration-types.js").WebsocketMessageHandler): void;
    _resolveMessageHandlerPromise(): Promise<void>;
    /**
     * Inserts resolver completion into the FIFO chain before allowing new dispatch.
     * @param {{useHandler: boolean}} args - Resolver result.
     * @returns {Promise<void>} - Resolves after queued messages drain.
     */
    _finishMessageHandlerResolution({ useHandler }: {
        useHandler: boolean;
    }): Promise<void>;
    /**
     * Runs flush queued messages.
     * @param {{useHandler: boolean}} args - Args.
     * @returns {Promise<void>} - Resolves when complete.
     */
    _flushQueuedMessages({ useHandler }: {
        useHandler: boolean;
    }): Promise<void>;
}
//# sourceMappingURL=websocket-session.d.ts.map