// @ts-check
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
    /**
     * Runs constructor.
     * @param {object} args - Owning session, connection parameters, and client identifier.
     * @param {string} args.connectionId - Client-assigned id, unique within the session.
     * @param {Record<string, ReturnType<typeof JSON.parse>>} args.params - Opaque params from the `connection-open` message.
     * @param {import("./client/websocket-session.js").default} args.session - Owning session.
     */
    constructor({ connectionId, params, session }) {
        this.connectionId = connectionId;
        this.params = params || {};
        this.session = session;
        this._closed = false;
    }
    /**
     * Called once after the session registers this connection and before
     * any `onMessage` fires. Returning a Promise defers the first
     * `connection-opened` message to the client until it resolves.
     * @returns {void | Promise<void>} - Completes after connection setup.
     */
    onConnect() { }
    /**
     * Called for each `connection-message` the client sends to this
     * specific connection. Messages arriving before `onConnect` has
     * resolved are queued and delivered in order once it finishes.
     * @param {ReturnType<typeof JSON.parse>} body - Client-sent payload for this connection.
     * @returns {void | Promise<void>} - Completes after message handling.
     */
    onMessage(body) { void body; }
    /**
     * Called when the underlying socket drops and the session is
     * moved into the paused/grace registry. The connection instance
     * itself survives; either `onResume` fires on a successful
     * client reconnect, or `onClose("grace_expired")` fires when the
     * grace window expires.
     * @returns {void | Promise<void>} - Completes after disconnect handling.
     */
    onDisconnect() { }
    /**
     * Called after a client reconnect + `session-resume` rebinds this
     * connection to a new socket.
     * @returns {void | Promise<void>} - Completes after resume handling.
     */
    onResume() { }
    /**
     * Called exactly once when the connection is permanently torn
     * down. Reasons: `client_close` (client unsubscribed), `server_close`
     * (server-initiated `close()`), `session_destroyed` (socket dropped
     * and nothing to resume; grace path did not apply), `grace_expired`
     * (paused session's grace window ran out without resume), `error`.
     * @param {"client_close" | "server_close" | "session_destroyed" | "grace_expired" | "error"} reason - Lifecycle reason for permanent connection teardown.
     * @returns {void | Promise<void>} - Completes after close handling.
     */
    onClose(reason) { void reason; }
    /**
     * Sends a `connection-message` frame to the client side of this
     * connection. Throws if the connection has already been closed.
     * @param {ReturnType<typeof JSON.parse>} body - Connection payload to send to the client.
     * @returns {void}
     */
    sendMessage(body) {
        if (this._closed) {
            throw new Error(`Cannot sendMessage on closed connection ${this.connectionId}`);
        }
        this.session.sendJson({
            type: "connection-message",
            connectionId: this.connectionId,
            body
        });
    }
    /**
     * Closes this connection from the server side. Fires `onClose`
     * locally and notifies the client with `{type: "connection-closed"}`.
     * @param {"server_close" | "error"} [reason] - Reason reported to the close hook and client.
     * @returns {Promise<void>}
     */
    async close(reason = "server_close") {
        if (this._closed)
            return;
        this._closed = true;
        try {
            await this.onClose(reason);
        }
        finally {
            this.session.sendJson({
                type: "connection-closed",
                connectionId: this.connectionId,
                reason
            });
            this.session._removeConnection(this.connectionId);
        }
    }
    /**
     * Runs is closed.
     * @returns {boolean} - Whether the connection is closed.
     */
    isClosed() {
        return this._closed;
    }
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoid2Vic29ja2V0LWNvbm5lY3Rpb24uanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi9zcmMvaHR0cC1zZXJ2ZXIvd2Vic29ja2V0LWNvbm5lY3Rpb24uanMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6IkFBQUEsWUFBWTtBQUVaOzs7Ozs7OztHQVFHO0FBQ0gsTUFBTSxDQUFDLE9BQU8sT0FBTyw0QkFBNEI7SUFDL0M7Ozs7OztPQU1HO0lBQ0gsWUFBWSxFQUFDLFlBQVksRUFBRSxNQUFNLEVBQUUsT0FBTyxFQUFDO1FBQ3pDLElBQUksQ0FBQyxZQUFZLEdBQUcsWUFBWSxDQUFBO1FBQ2hDLElBQUksQ0FBQyxNQUFNLEdBQUcsTUFBTSxJQUFJLEVBQUUsQ0FBQTtRQUMxQixJQUFJLENBQUMsT0FBTyxHQUFHLE9BQU8sQ0FBQTtRQUN0QixJQUFJLENBQUMsT0FBTyxHQUFHLEtBQUssQ0FBQTtJQUN0QixDQUFDO0lBRUQ7Ozs7O09BS0c7SUFDSCxTQUFTLEtBQUksQ0FBQztJQUVkOzs7Ozs7T0FNRztJQUNILFNBQVMsQ0FBQyxJQUFJLElBQUksS0FBSyxJQUFJLENBQUEsQ0FBQyxDQUFDO0lBRTdCOzs7Ozs7O09BT0c7SUFDSCxZQUFZLEtBQUksQ0FBQztJQUVqQjs7OztPQUlHO0lBQ0gsUUFBUSxLQUFJLENBQUM7SUFFYjs7Ozs7Ozs7T0FRRztJQUNILE9BQU8sQ0FBQyxNQUFNLElBQUksS0FBSyxNQUFNLENBQUEsQ0FBQyxDQUFDO0lBRS9COzs7OztPQUtHO0lBQ0gsV0FBVyxDQUFDLElBQUk7UUFDZCxJQUFJLElBQUksQ0FBQyxPQUFPLEVBQUUsQ0FBQztZQUNqQixNQUFNLElBQUksS0FBSyxDQUFDLDJDQUEyQyxJQUFJLENBQUMsWUFBWSxFQUFFLENBQUMsQ0FBQTtRQUNqRixDQUFDO1FBRUQsSUFBSSxDQUFDLE9BQU8sQ0FBQyxRQUFRLENBQUM7WUFDcEIsSUFBSSxFQUFFLG9CQUFvQjtZQUMxQixZQUFZLEVBQUUsSUFBSSxDQUFDLFlBQVk7WUFDL0IsSUFBSTtTQUNMLENBQUMsQ0FBQTtJQUNKLENBQUM7SUFFRDs7Ozs7T0FLRztJQUNILEtBQUssQ0FBQyxLQUFLLENBQUMsTUFBTSxHQUFHLGNBQWM7UUFDakMsSUFBSSxJQUFJLENBQUMsT0FBTztZQUFFLE9BQU07UUFDeEIsSUFBSSxDQUFDLE9BQU8sR0FBRyxJQUFJLENBQUE7UUFFbkIsSUFBSSxDQUFDO1lBQ0gsTUFBTSxJQUFJLENBQUMsT0FBTyxDQUFDLE1BQU0sQ0FBQyxDQUFBO1FBQzVCLENBQUM7Z0JBQVMsQ0FBQztZQUNULElBQUksQ0FBQyxPQUFPLENBQUMsUUFBUSxDQUFDO2dCQUNwQixJQUFJLEVBQUUsbUJBQW1CO2dCQUN6QixZQUFZLEVBQUUsSUFBSSxDQUFDLFlBQVk7Z0JBQy9CLE1BQU07YUFDUCxDQUFDLENBQUE7WUFDRixJQUFJLENBQUMsT0FBTyxDQUFDLGlCQUFpQixDQUFDLElBQUksQ0FBQyxZQUFZLENBQUMsQ0FBQTtRQUNuRCxDQUFDO0lBQ0gsQ0FBQztJQUVEOzs7T0FHRztJQUNILFFBQVE7UUFDTixPQUFPLElBQUksQ0FBQyxPQUFPLENBQUE7SUFDckIsQ0FBQztDQUNGIiwic291cmNlc0NvbnRlbnQiOlsiLy8gQHRzLWNoZWNrXG5cbi8qKlxuICogQmFzZSBjbGFzcyBmb3IgYXBwLWRlZmluZWQgMToxIFdlYlNvY2tldCBjb25uZWN0aW9ucy4gU3ViY2xhc3Nlc1xuICogb3ZlcnJpZGUgYG9uQ29ubmVjdGAsIGBvbk1lc3NhZ2VgLCBhbmQgYG9uQ2xvc2VgIHRvIGhhbmRsZSB0aGVcbiAqIHNlc3Npb24gbGlmZWN5Y2xlLiBVc2UgYHRoaXMuc2VuZE1lc3NhZ2UoYm9keSlgIHRvIHB1c2ggbWVzc2FnZXMgdG9cbiAqIHRoZSBjbGllbnQgc2lkZSBvZiB0aGlzIGNvbm5lY3Rpb24uXG4gKlxuICogU2VlIGBkb2NzL3dlYnNvY2tldC1jb25uZWN0aW9ucy5tZGAgZm9yIHRoZSB3aXJlIHByb3RvY29sIGFuZCBmdWxsXG4gKiBsaWZlY3ljbGUgc2VtYW50aWNzLlxuICovXG5leHBvcnQgZGVmYXVsdCBjbGFzcyBWZWxvY2lvdXNXZWJzb2NrZXRDb25uZWN0aW9uIHtcbiAgLyoqXG4gICAqIFJ1bnMgY29uc3RydWN0b3IuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gT3duaW5nIHNlc3Npb24sIGNvbm5lY3Rpb24gcGFyYW1ldGVycywgYW5kIGNsaWVudCBpZGVudGlmaWVyLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gYXJncy5jb25uZWN0aW9uSWQgLSBDbGllbnQtYXNzaWduZWQgaWQsIHVuaXF1ZSB3aXRoaW4gdGhlIHNlc3Npb24uXG4gICAqIEBwYXJhbSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSBhcmdzLnBhcmFtcyAtIE9wYXF1ZSBwYXJhbXMgZnJvbSB0aGUgYGNvbm5lY3Rpb24tb3BlbmAgbWVzc2FnZS5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL2NsaWVudC93ZWJzb2NrZXQtc2Vzc2lvbi5qc1wiKS5kZWZhdWx0fSBhcmdzLnNlc3Npb24gLSBPd25pbmcgc2Vzc2lvbi5cbiAgICovXG4gIGNvbnN0cnVjdG9yKHtjb25uZWN0aW9uSWQsIHBhcmFtcywgc2Vzc2lvbn0pIHtcbiAgICB0aGlzLmNvbm5lY3Rpb25JZCA9IGNvbm5lY3Rpb25JZFxuICAgIHRoaXMucGFyYW1zID0gcGFyYW1zIHx8IHt9XG4gICAgdGhpcy5zZXNzaW9uID0gc2Vzc2lvblxuICAgIHRoaXMuX2Nsb3NlZCA9IGZhbHNlXG4gIH1cblxuICAvKipcbiAgICogQ2FsbGVkIG9uY2UgYWZ0ZXIgdGhlIHNlc3Npb24gcmVnaXN0ZXJzIHRoaXMgY29ubmVjdGlvbiBhbmQgYmVmb3JlXG4gICAqIGFueSBgb25NZXNzYWdlYCBmaXJlcy4gUmV0dXJuaW5nIGEgUHJvbWlzZSBkZWZlcnMgdGhlIGZpcnN0XG4gICAqIGBjb25uZWN0aW9uLW9wZW5lZGAgbWVzc2FnZSB0byB0aGUgY2xpZW50IHVudGlsIGl0IHJlc29sdmVzLlxuICAgKiBAcmV0dXJucyB7dm9pZCB8IFByb21pc2U8dm9pZD59IC0gQ29tcGxldGVzIGFmdGVyIGNvbm5lY3Rpb24gc2V0dXAuXG4gICAqL1xuICBvbkNvbm5lY3QoKSB7fVxuXG4gIC8qKlxuICAgKiBDYWxsZWQgZm9yIGVhY2ggYGNvbm5lY3Rpb24tbWVzc2FnZWAgdGhlIGNsaWVudCBzZW5kcyB0byB0aGlzXG4gICAqIHNwZWNpZmljIGNvbm5lY3Rpb24uIE1lc3NhZ2VzIGFycml2aW5nIGJlZm9yZSBgb25Db25uZWN0YCBoYXNcbiAgICogcmVzb2x2ZWQgYXJlIHF1ZXVlZCBhbmQgZGVsaXZlcmVkIGluIG9yZGVyIG9uY2UgaXQgZmluaXNoZXMuXG4gICAqIEBwYXJhbSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59IGJvZHkgLSBDbGllbnQtc2VudCBwYXlsb2FkIGZvciB0aGlzIGNvbm5lY3Rpb24uXG4gICAqIEByZXR1cm5zIHt2b2lkIHwgUHJvbWlzZTx2b2lkPn0gLSBDb21wbGV0ZXMgYWZ0ZXIgbWVzc2FnZSBoYW5kbGluZy5cbiAgICovXG4gIG9uTWVzc2FnZShib2R5KSB7IHZvaWQgYm9keSB9XG5cbiAgLyoqXG4gICAqIENhbGxlZCB3aGVuIHRoZSB1bmRlcmx5aW5nIHNvY2tldCBkcm9wcyBhbmQgdGhlIHNlc3Npb24gaXNcbiAgICogbW92ZWQgaW50byB0aGUgcGF1c2VkL2dyYWNlIHJlZ2lzdHJ5LiBUaGUgY29ubmVjdGlvbiBpbnN0YW5jZVxuICAgKiBpdHNlbGYgc3Vydml2ZXM7IGVpdGhlciBgb25SZXN1bWVgIGZpcmVzIG9uIGEgc3VjY2Vzc2Z1bFxuICAgKiBjbGllbnQgcmVjb25uZWN0LCBvciBgb25DbG9zZShcImdyYWNlX2V4cGlyZWRcIilgIGZpcmVzIHdoZW4gdGhlXG4gICAqIGdyYWNlIHdpbmRvdyBleHBpcmVzLlxuICAgKiBAcmV0dXJucyB7dm9pZCB8IFByb21pc2U8dm9pZD59IC0gQ29tcGxldGVzIGFmdGVyIGRpc2Nvbm5lY3QgaGFuZGxpbmcuXG4gICAqL1xuICBvbkRpc2Nvbm5lY3QoKSB7fVxuXG4gIC8qKlxuICAgKiBDYWxsZWQgYWZ0ZXIgYSBjbGllbnQgcmVjb25uZWN0ICsgYHNlc3Npb24tcmVzdW1lYCByZWJpbmRzIHRoaXNcbiAgICogY29ubmVjdGlvbiB0byBhIG5ldyBzb2NrZXQuXG4gICAqIEByZXR1cm5zIHt2b2lkIHwgUHJvbWlzZTx2b2lkPn0gLSBDb21wbGV0ZXMgYWZ0ZXIgcmVzdW1lIGhhbmRsaW5nLlxuICAgKi9cbiAgb25SZXN1bWUoKSB7fVxuXG4gIC8qKlxuICAgKiBDYWxsZWQgZXhhY3RseSBvbmNlIHdoZW4gdGhlIGNvbm5lY3Rpb24gaXMgcGVybWFuZW50bHkgdG9yblxuICAgKiBkb3duLiBSZWFzb25zOiBgY2xpZW50X2Nsb3NlYCAoY2xpZW50IHVuc3Vic2NyaWJlZCksIGBzZXJ2ZXJfY2xvc2VgXG4gICAqIChzZXJ2ZXItaW5pdGlhdGVkIGBjbG9zZSgpYCksIGBzZXNzaW9uX2Rlc3Ryb3llZGAgKHNvY2tldCBkcm9wcGVkXG4gICAqIGFuZCBub3RoaW5nIHRvIHJlc3VtZTsgZ3JhY2UgcGF0aCBkaWQgbm90IGFwcGx5KSwgYGdyYWNlX2V4cGlyZWRgXG4gICAqIChwYXVzZWQgc2Vzc2lvbidzIGdyYWNlIHdpbmRvdyByYW4gb3V0IHdpdGhvdXQgcmVzdW1lKSwgYGVycm9yYC5cbiAgICogQHBhcmFtIHtcImNsaWVudF9jbG9zZVwiIHwgXCJzZXJ2ZXJfY2xvc2VcIiB8IFwic2Vzc2lvbl9kZXN0cm95ZWRcIiB8IFwiZ3JhY2VfZXhwaXJlZFwiIHwgXCJlcnJvclwifSByZWFzb24gLSBMaWZlY3ljbGUgcmVhc29uIGZvciBwZXJtYW5lbnQgY29ubmVjdGlvbiB0ZWFyZG93bi5cbiAgICogQHJldHVybnMge3ZvaWQgfCBQcm9taXNlPHZvaWQ+fSAtIENvbXBsZXRlcyBhZnRlciBjbG9zZSBoYW5kbGluZy5cbiAgICovXG4gIG9uQ2xvc2UocmVhc29uKSB7IHZvaWQgcmVhc29uIH1cblxuICAvKipcbiAgICogU2VuZHMgYSBgY29ubmVjdGlvbi1tZXNzYWdlYCBmcmFtZSB0byB0aGUgY2xpZW50IHNpZGUgb2YgdGhpc1xuICAgKiBjb25uZWN0aW9uLiBUaHJvd3MgaWYgdGhlIGNvbm5lY3Rpb24gaGFzIGFscmVhZHkgYmVlbiBjbG9zZWQuXG4gICAqIEBwYXJhbSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59IGJvZHkgLSBDb25uZWN0aW9uIHBheWxvYWQgdG8gc2VuZCB0byB0aGUgY2xpZW50LlxuICAgKiBAcmV0dXJucyB7dm9pZH1cbiAgICovXG4gIHNlbmRNZXNzYWdlKGJvZHkpIHtcbiAgICBpZiAodGhpcy5fY2xvc2VkKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoYENhbm5vdCBzZW5kTWVzc2FnZSBvbiBjbG9zZWQgY29ubmVjdGlvbiAke3RoaXMuY29ubmVjdGlvbklkfWApXG4gICAgfVxuXG4gICAgdGhpcy5zZXNzaW9uLnNlbmRKc29uKHtcbiAgICAgIHR5cGU6IFwiY29ubmVjdGlvbi1tZXNzYWdlXCIsXG4gICAgICBjb25uZWN0aW9uSWQ6IHRoaXMuY29ubmVjdGlvbklkLFxuICAgICAgYm9keVxuICAgIH0pXG4gIH1cblxuICAvKipcbiAgICogQ2xvc2VzIHRoaXMgY29ubmVjdGlvbiBmcm9tIHRoZSBzZXJ2ZXIgc2lkZS4gRmlyZXMgYG9uQ2xvc2VgXG4gICAqIGxvY2FsbHkgYW5kIG5vdGlmaWVzIHRoZSBjbGllbnQgd2l0aCBge3R5cGU6IFwiY29ubmVjdGlvbi1jbG9zZWRcIn1gLlxuICAgKiBAcGFyYW0ge1wic2VydmVyX2Nsb3NlXCIgfCBcImVycm9yXCJ9IFtyZWFzb25dIC0gUmVhc29uIHJlcG9ydGVkIHRvIHRoZSBjbG9zZSBob29rIGFuZCBjbGllbnQuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fVxuICAgKi9cbiAgYXN5bmMgY2xvc2UocmVhc29uID0gXCJzZXJ2ZXJfY2xvc2VcIikge1xuICAgIGlmICh0aGlzLl9jbG9zZWQpIHJldHVyblxuICAgIHRoaXMuX2Nsb3NlZCA9IHRydWVcblxuICAgIHRyeSB7XG4gICAgICBhd2FpdCB0aGlzLm9uQ2xvc2UocmVhc29uKVxuICAgIH0gZmluYWxseSB7XG4gICAgICB0aGlzLnNlc3Npb24uc2VuZEpzb24oe1xuICAgICAgICB0eXBlOiBcImNvbm5lY3Rpb24tY2xvc2VkXCIsXG4gICAgICAgIGNvbm5lY3Rpb25JZDogdGhpcy5jb25uZWN0aW9uSWQsXG4gICAgICAgIHJlYXNvblxuICAgICAgfSlcbiAgICAgIHRoaXMuc2Vzc2lvbi5fcmVtb3ZlQ29ubmVjdGlvbih0aGlzLmNvbm5lY3Rpb25JZClcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogUnVucyBpcyBjbG9zZWQuXG4gICAqIEByZXR1cm5zIHtib29sZWFufSAtIFdoZXRoZXIgdGhlIGNvbm5lY3Rpb24gaXMgY2xvc2VkLlxuICAgKi9cbiAgaXNDbG9zZWQoKSB7XG4gICAgcmV0dXJuIHRoaXMuX2Nsb3NlZFxuICB9XG59XG4iXX0=