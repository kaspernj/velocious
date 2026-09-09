import SnapReqWebSocketClient from "snapreq/websocket";
/**
 * Velocious's WebSocket client. The cross-platform connection/session/channel
 * machinery lives in snapreq's `SnapReqWebSocketClient`; this thin subclass only
 * pre-wires the two Velocious-specific defaults: the local development websocket
 * URL and frontend-model transport deserialization inside `response.json()`.
 * @augments SnapReqWebSocketClient
 */
export default class VelociousWebsocketClient extends SnapReqWebSocketClient {
    reconnectGeneration: number;
    /** @type {Set<Promise<void>>} */
    runningReconnectTasks: Set<Promise<void>>;
    /** @type {Promise<void> | null} */
    gracefulClosePromise: Promise<void> | null;
    routingBaseUrl: string;
    /**
     * Runs constructor.
     * @param {Partial<ConstructorParameters<typeof SnapReqWebSocketClient>[0]>} [args] - Options forwarded to `SnapReqWebSocketClient`.
     */
    constructor(args?: Partial<ConstructorParameters<typeof SnapReqWebSocketClient>[0]>);
    /**
     * Restores a persisted session before opening the socket so the host can route
     * the HTTP upgrade to the worker that owns its paused state.
     * @returns {Promise<void>}
     */
    _restoreSessionIdForRouting(): Promise<void>;
    /**
     * Builds the WebSocket URL carrying only the current resumable session routing hint.
     * @returns {string} - WebSocket URL.
     */
    _sessionRoutingUrl(): string;
    /**
     * Restores routing state before delegating socket creation to SnapReq.
     * @param {Parameters<SnapReqWebSocketClient["_connect"]>[0]} [options] - Connect options.
     * @returns {Promise<void>} - Resolves when the session is ready.
     */
    _connect(options?: Parameters<SnapReqWebSocketClient["_connect"]>[0]): Promise<void>;
    /**
     * Ignores an online result resolved after reconnect teardown began.
     * @returns {Promise<boolean>} - Whether this client generation is online.
     */
    _isOnline(): Promise<boolean>;
    /**
     * Tracks automatic reconnect work so teardown can drain stale attempts.
     * @returns {Promise<void>} - Resolves after the reconnect attempt settles.
     */
    _attemptReconnect(): Promise<void>;
    /**
     * Closes the WebSocket as a normal shutdown so the server permanently
     * releases resumable session state.
     * @returns {Promise<void>} - Resolves once closed.
     */
    close(): Promise<void>;
    /**
     * Stops reconnect, drains work that already passed SnapReq's reconnect guard,
     * and clears state changed by a stale attempt while it settled.
     * @returns {Promise<void>} - Resolves once no reconnect can resurrect a socket.
     */
    disconnectAndStopReconnect(): Promise<void>;
}
//# sourceMappingURL=websocket-client.d.ts.map