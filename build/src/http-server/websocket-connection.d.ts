/**
 * Base class for app-defined 1:1 WebSocket connections. Subclasses
 * override `onConnect`, `onMessage`, and `onClose` to handle the
 * session lifecycle. Use `this.sendMessage(body)` to push messages to
 * the client side of this connection.
 *
 * See `docs/websocket-connections.md` for the wire protocol and full
 * lifecycle semantics.
 */
export default class VelociousWebsocketConnection {
    connectionId: string;
    params: Record<string, any>;
    session: import("./client/websocket-session.js").default;
    _closed: boolean;
    /**
     * Runs constructor.
     * @param {object} args - Owning session, connection parameters, and client identifier.
     * @param {string} args.connectionId - Client-assigned id, unique within the session.
     * @param {Record<string, ReturnType<typeof JSON.parse>>} args.params - Opaque params from the `connection-open` message.
     * @param {import("./client/websocket-session.js").default} args.session - Owning session.
     */
    constructor({ connectionId, params, session }: {
        connectionId: string;
        params: Record<string, ReturnType<typeof JSON.parse>>;
        session: import("./client/websocket-session.js").default;
    });
    /**
     * Called once after the session registers this connection and before
     * any `onMessage` fires. Returning a Promise defers the first
     * `connection-opened` message to the client until it resolves.
     * @returns {void | Promise<void>} - Completes after connection setup.
     */
    onConnect(): void | Promise<void>;
    /**
     * Called for each `connection-message` the client sends to this
     * specific connection. Messages arriving before `onConnect` has
     * resolved are queued and delivered in order once it finishes.
     * @param {ReturnType<typeof JSON.parse>} body - Client-sent payload for this connection.
     * @returns {void | Promise<void>} - Completes after message handling.
     */
    onMessage(body: ReturnType<typeof JSON.parse>): void | Promise<void>;
    /**
     * Called when the underlying socket drops and the session is
     * moved into the paused/grace registry. The connection instance
     * itself survives; either `onResume` fires on a successful
     * client reconnect, or `onClose("grace_expired")` fires when the
     * grace window expires.
     * @returns {void | Promise<void>} - Completes after disconnect handling.
     */
    onDisconnect(): void | Promise<void>;
    /**
     * Called after a client reconnect + `session-resume` rebinds this
     * connection to a new socket.
     * @returns {void | Promise<void>} - Completes after resume handling.
     */
    onResume(): void | Promise<void>;
    /**
     * Called exactly once when the connection is permanently torn
     * down. Reasons: `client_close` (client unsubscribed), `server_close`
     * (server-initiated `close()`), `session_destroyed` (socket dropped
     * and nothing to resume; grace path did not apply), `grace_expired`
     * (paused session's grace window ran out without resume), `error`.
     * @param {"client_close" | "server_close" | "session_destroyed" | "grace_expired" | "error"} reason - Lifecycle reason for permanent connection teardown.
     * @returns {void | Promise<void>} - Completes after close handling.
     */
    onClose(reason: "client_close" | "server_close" | "session_destroyed" | "grace_expired" | "error"): void | Promise<void>;
    /**
     * Sends a `connection-message` frame to the client side of this
     * connection. Throws if the connection has already been closed.
     * @param {ReturnType<typeof JSON.parse>} body - Connection payload to send to the client.
     * @returns {void}
     */
    sendMessage(body: ReturnType<typeof JSON.parse>): void;
    /**
     * Closes this connection from the server side. Fires `onClose`
     * locally and notifies the client with `{type: "connection-closed"}`.
     * @param {"server_close" | "error"} [reason] - Reason reported to the close hook and client.
     * @returns {Promise<void>}
     */
    close(reason?: "server_close" | "error"): Promise<void>;
    /**
     * Runs is closed.
     * @returns {boolean} - Whether the connection is closed.
     */
    isClosed(): boolean;
}
//# sourceMappingURL=websocket-connection.d.ts.map