// @ts-check
import { randomUUID } from "node:crypto";
import net from "node:net";
import timeout from "awaitery/build/timeout.js";
import JsonSocket from "../background-jobs/json-socket.js";
import EventEmitter from "../utils/event-emitter.js";
/**
 * BeaconBroadcastHandler type.
 * @typedef {(arg: import("./types.js").BeaconBroadcastMessage) => void} BeaconBroadcastHandler
 */
const DEFAULT_RECONNECT_DELAY_MS = 1000;
const MAX_RECONNECT_DELAY_MS = 30_000;
const DEFAULT_CLOSE_TIMEOUT_MS = 1000;
/**
 * BeaconClient connects to a `velocious beacon` daemon and exchanges
 * broadcasts with all peer processes connected to the same daemon.
 *
 * Lifecycle:
 *   const client = new BeaconClient({host, port, peerType: "server"})
 *   await client.connect()                         // resolves on first successful connect
 *   await client.waitForReady({timeoutMs: 1000})   // resolves after the daemon hello-ack
 *   client.onBroadcast((message) => { ... })       // every fan-out
 *   client.publish({channel, broadcastParams, body})
 *   await client.close()
 *
 * Reconnect: on socket close (without an explicit `close()` call) the
 * client schedules a reconnect with exponential backoff. While the
 * underlying socket is down, `publish(...)` returns false and the
 * caller can fall back to local-only delivery; subsequent reconnects do
 * not replay missed publishes (Beacon is pubsub, not a queue).
 */
export default class BeaconClient extends EventEmitter {
    /**
     * Runs constructor.
     * @param {object} args - Options.
     * @param {string} args.host - Beacon host.
     * @param {number} args.port - Beacon port.
     * @param {string} [args.peerType] - Optional human-readable peer label.
     * @param {string} [args.peerId] - Optional explicit peer id (defaults to a random UUID).
     * @param {number} [args.reconnectDelayMs] - Starting reconnect delay in ms.
     * @param {number} [args.maxReconnectDelayMs] - Maximum reconnect delay in ms.
     * @param {number} [args.closeTimeoutMs] - Maximum graceful socket close wait in ms.
     */
    constructor({ host, port, peerType, peerId, reconnectDelayMs, maxReconnectDelayMs, closeTimeoutMs }) {
        super();
        this.host = host;
        this.port = port;
        this.peerType = peerType;
        this.peerId = peerId || randomUUID();
        this._initialReconnectDelayMs = reconnectDelayMs ?? DEFAULT_RECONNECT_DELAY_MS;
        this._maxReconnectDelayMs = maxReconnectDelayMs ?? MAX_RECONNECT_DELAY_MS;
        this._reconnectDelayMs = this._initialReconnectDelayMs;
        this._closeTimeoutMs = closeTimeoutMs ?? DEFAULT_CLOSE_TIMEOUT_MS;
        /**
         * Narrows the runtime value to the documented type.
         * @type {JsonSocket | undefined} */
        this._jsonSocket = undefined;
        /**
         * Narrows the runtime value to the documented type.
         * @type {net.Socket | undefined} */
        this._socket = undefined;
        this._connected = false;
        this._ready = false;
        this._closed = false;
        /**
         * Narrows the runtime value to the documented type.
         * @type {ReturnType<typeof setTimeout> | undefined} */
        this._reconnectTimer = undefined;
        /**
         * Narrows the runtime value to the documented type.
         * @type {Promise<void> | undefined} */
        this._connectPromise = undefined;
        /**
         * Last socket error observed while connected, surfaced as the disconnect reason.
         * @type {Error | undefined}
         */
        this._lastSocketError = undefined;
    }
    /**
     * Runs get peer id.
     * @returns {string} - The peer id sent on the hello handshake.
     */
    getPeerId() { return this.peerId; }
    /**
     * Runs is connected.
     * @returns {boolean} - Whether the underlying socket is currently connected.
     */
    isConnected() { return this._connected; }
    /**
     * Runs is ready.
     * @returns {boolean} - Whether the daemon has acknowledged this peer registration.
     */
    isReady() { return this._ready; }
    /**
     * Resolves on the first successful connect. Subsequent calls return
     * the same promise. Subsequent reconnects after a drop are silent —
     * use `on("connect")` / `on("disconnect", reason)` to observe them.
     * The `disconnect` listener receives an `Error` reason: either the
     * underlying socket error, or `Error("Beacon broker disconnected")`
     * when the close had no preceding error.
     * @returns {Promise<void>}
     */
    async connect() {
        if (this._closed)
            throw new Error("BeaconClient has been closed");
        if (this._connectPromise)
            return await this._connectPromise;
        this._connectPromise = new Promise((resolve, reject) => {
            const onConnect = () => {
                this.off("connect", onConnect);
                this.off("connect-error", onError);
                resolve();
            };
            const onError = (/** @type {Error} */ error) => {
                this.off("connect", onConnect);
                this.off("connect-error", onError);
                reject(error);
            };
            this.on("connect", onConnect);
            this.on("connect-error", onError);
        });
        this._openSocket();
        return await this._connectPromise;
    }
    /**
     * Resolves after the Beacon daemon has acknowledged this peer's
     * hello handshake. This is stronger than `isConnected()`: connected
     * means the TCP socket is open, ready means the daemon has registered
     * the peer and broadcasts can be routed through the bus.
     * @param {object} [args] - Options.
     * @param {number} [args.timeoutMs] - Optional timeout in milliseconds.
     * @returns {Promise<void>}
     */
    async waitForReady({ timeoutMs } = {}) {
        if (this._ready)
            return;
        /**
         * Cleans up the ready listener and timeout.
         * @type {() => void}
         */
        let cleanup = () => { };
        const readyPromise = new Promise((resolve) => {
            const onReady = () => {
                cleanup();
                resolve(undefined);
            };
            cleanup = () => this.off("ready", onReady);
            this.on("ready", onReady);
        });
        try {
            if (typeof timeoutMs === "number") {
                await timeout({ timeout: timeoutMs }, async () => {
                    await readyPromise;
                });
            }
            else {
                await readyPromise;
            }
        }
        finally {
            cleanup();
        }
    }
    /**
     * Publishes a broadcast message to all peers (including this one,
     * unless the daemon is restarted mid-publish).
     * @param {object} args - Broadcast args.
     * @param {string} args.channel - Channel name.
     * @param {Record<string, ReturnType<typeof JSON.parse>>} args.broadcastParams - Routing params.
     * @param {ReturnType<typeof JSON.parse>} args.body - Message body.
     * @returns {boolean} - True if the publish was written to the socket. False if the client is currently disconnected.
     */
    publish({ channel, broadcastParams, body }) {
        if (!this._connected || !this._jsonSocket)
            return false;
        /**
         * Message.
         * @type {import("./types.js").BeaconBroadcastMessage} */
        const message = {
            type: "broadcast",
            channel,
            broadcastParams,
            body,
            originPeerId: this.peerId
        };
        try {
            this._jsonSocket.send(message);
            return true;
        }
        catch {
            return false;
        }
    }
    /**
     * Registers a handler called once for every `broadcast` message
     * received from the daemon (including echoes of this client's own
     * publishes — synapse-style fan-out).
     * @param {BeaconBroadcastHandler} handler - Handler.
     * @returns {() => void} - Unregister function.
     */
    onBroadcast(handler) {
        this.on("broadcast", handler);
        return () => this.off("broadcast", handler);
    }
    /**
     * Runs close.
     * @returns {Promise<void>} - Resolves once the socket is closed.
     */
    async close() {
        this._closed = true;
        if (this._reconnectTimer) {
            clearTimeout(this._reconnectTimer);
            this._reconnectTimer = undefined;
        }
        const socket = this._socket;
        if (!socket)
            return;
        this._socket = undefined;
        this._jsonSocket = undefined;
        if (socket.destroyed)
            return;
        await timeout({ timeout: this._closeTimeoutMs }, async () => {
            await new Promise((resolve) => {
                socket.once("close", () => resolve(undefined));
                socket.end();
                socket.destroySoon();
            });
        }).catch(() => {
            socket.destroy();
        });
    }
    /**
     * Runs open socket.
     * @returns {void}
     */
    _openSocket() {
        if (this._closed)
            return;
        const socket = net.createConnection({ host: this.host, port: this.port });
        this._socket = socket;
        const jsonSocket = new JsonSocket(socket);
        this._jsonSocket = jsonSocket;
        socket.on("connect", () => {
            this._connected = true;
            this._ready = false;
            this._reconnectDelayMs = this._initialReconnectDelayMs;
            jsonSocket.send({
                type: "hello",
                role: "client",
                peerId: this.peerId,
                peerType: this.peerType
            });
            this.emit("connect");
        });
        jsonSocket.on("message", (/** @type {import("./types.js").BeaconSocketMessage} */ message) => {
            if (message?.type === "hello-ack" && message.peerId === this.peerId) {
                this._ready = true;
                this.emit("ready");
            }
            else if (message?.type === "broadcast") {
                this.emit("broadcast", message);
            }
        });
        jsonSocket.on("error", (error) => {
            if (!this._connected) {
                // Initial connect failed — surface to `connect()`'s promise via `connect-error`.
                // No `error` emit: that channel is for established-session errors; the
                // initial-connect path is owned by `connect-error`.
                this.emit("connect-error", error);
            }
            else {
                // Established session error. Cache so the upcoming `close` event can
                // surface it as the disconnect reason.
                this._lastSocketError = error;
                this.emit("error", error);
            }
        });
        jsonSocket.on("close", () => {
            const wasConnected = this._connected;
            this._connected = false;
            this._ready = false;
            this._jsonSocket = undefined;
            this._socket = undefined;
            // Explicit close() sets `_closed = true` before ending the socket.
            // Don't surface user-initiated teardown as a disconnect "error" —
            // only network-driven drops should be reported.
            if (wasConnected && !this._closed) {
                const reason = this._lastSocketError || new Error("Beacon broker disconnected");
                this.emit("disconnect", reason);
            }
            this._lastSocketError = undefined;
            if (this._closed)
                return;
            this._scheduleReconnect();
        });
    }
    /**
     * Runs schedule reconnect.
     * @returns {void}
     */
    _scheduleReconnect() {
        if (this._reconnectTimer)
            return;
        const delay = this._reconnectDelayMs;
        this._reconnectTimer = setTimeout(() => {
            this._reconnectTimer = undefined;
            this._reconnectDelayMs = Math.min(delay * 2, this._maxReconnectDelayMs);
            this._openSocket();
        }, delay);
    }
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiY2xpZW50LmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiLi4vLi4vLi4vc3JjL2JlYWNvbi9jbGllbnQuanMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6IkFBQUEsWUFBWTtBQUVaLE9BQU8sRUFBQyxVQUFVLEVBQUMsTUFBTSxhQUFhLENBQUE7QUFDdEMsT0FBTyxHQUFHLE1BQU0sVUFBVSxDQUFBO0FBQzFCLE9BQU8sT0FBTyxNQUFNLDJCQUEyQixDQUFBO0FBRS9DLE9BQU8sVUFBVSxNQUFNLG1DQUFtQyxDQUFBO0FBQzFELE9BQU8sWUFBWSxNQUFNLDJCQUEyQixDQUFBO0FBRXBEOzs7R0FHRztBQUNILE1BQU0sMEJBQTBCLEdBQUcsSUFBSSxDQUFBO0FBQ3ZDLE1BQU0sc0JBQXNCLEdBQUcsTUFBTSxDQUFBO0FBQ3JDLE1BQU0sd0JBQXdCLEdBQUcsSUFBSSxDQUFBO0FBRXJDOzs7Ozs7Ozs7Ozs7Ozs7OztHQWlCRztBQUNILE1BQU0sQ0FBQyxPQUFPLE9BQU8sWUFBYSxTQUFRLFlBQVk7SUFDcEQ7Ozs7Ozs7Ozs7T0FVRztJQUNILFlBQVksRUFBQyxJQUFJLEVBQUUsSUFBSSxFQUFFLFFBQVEsRUFBRSxNQUFNLEVBQUUsZ0JBQWdCLEVBQUUsbUJBQW1CLEVBQUUsY0FBYyxFQUFDO1FBQy9GLEtBQUssRUFBRSxDQUFBO1FBQ1AsSUFBSSxDQUFDLElBQUksR0FBRyxJQUFJLENBQUE7UUFDaEIsSUFBSSxDQUFDLElBQUksR0FBRyxJQUFJLENBQUE7UUFDaEIsSUFBSSxDQUFDLFFBQVEsR0FBRyxRQUFRLENBQUE7UUFDeEIsSUFBSSxDQUFDLE1BQU0sR0FBRyxNQUFNLElBQUksVUFBVSxFQUFFLENBQUE7UUFDcEMsSUFBSSxDQUFDLHdCQUF3QixHQUFHLGdCQUFnQixJQUFJLDBCQUEwQixDQUFBO1FBQzlFLElBQUksQ0FBQyxvQkFBb0IsR0FBRyxtQkFBbUIsSUFBSSxzQkFBc0IsQ0FBQTtRQUN6RSxJQUFJLENBQUMsaUJBQWlCLEdBQUcsSUFBSSxD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Q0FBQyxnQkFBZ0IsR0FBRyxTQUFTLENBQUE7WUFFakMsSUFBSSxJQUFJLENBQUMsT0FBTztnQkFBRSxPQUFNO1lBRXhCLElBQUksQ0FBQyxrQkFBa0IsRUFBRSxDQUFBO1FBQzNCLENBQUMsQ0FBQyxDQUFBO0lBQ0osQ0FBQztJQUVEOzs7T0FHRztJQUNILGtCQUFrQjtRQUNoQixJQUFJLElBQUksQ0FBQyxlQUFlO1lBQUUsT0FBTTtRQUVoQyxNQUFNLEtBQUssR0FBRyxJQUFJLENBQUMsaUJBQWlCLENBQUE7UUFFcEMsSUFBSSxDQUFDLGVBQWUsR0FBRyxVQUFVLENBQUMsR0FBRyxFQUFFO1lBQ3JDLElBQUksQ0FBQyxlQUFlLEdBQUcsU0FBUyxDQUFBO1lBQ2hDLElBQUksQ0FBQyxpQkFBaUIsR0FBRyxJQUFJLENBQUMsR0FBRyxDQUFDLEtBQUssR0FBRyxDQUFDLEVBQUUsSUFBSSxDQUFDLG9CQUFvQixDQUFDLENBQUE7WUFDdkUsSUFBSSxDQUFDLFdBQVcsRUFBRSxDQUFBO1FBQ3BCLENBQUMsRUFBRSxLQUFLLENBQUMsQ0FBQTtJQUNYLENBQUM7Q0FDRiIsInNvdXJjZXNDb250ZW50IjpbIi8vIEB0cy1jaGVja1xuXG5pbXBvcnQge3JhbmRvbVVVSUR9IGZyb20gXCJub2RlOmNyeXB0b1wiXG5pbXBvcnQgbmV0IGZyb20gXCJub2RlOm5ldFwiXG5pbXBvcnQgdGltZW91dCBmcm9tIFwiYXdhaXRlcnkvYnVpbGQvdGltZW91dC5qc1wiXG5cbmltcG9ydCBKc29uU29ja2V0IGZyb20gXCIuLi9iYWNrZ3JvdW5kLWpvYnMvanNvbi1zb2NrZXQuanNcIlxuaW1wb3J0IEV2ZW50RW1pdHRlciBmcm9tIFwiLi4vdXRpbHMvZXZlbnQtZW1pdHRlci5qc1wiXG5cbi8qKlxuICogQmVhY29uQnJvYWRjYXN0SGFuZGxlciB0eXBlLlxuICogQHR5cGVkZWYgeyhhcmc6IGltcG9ydChcIi4vdHlwZXMuanNcIikuQmVhY29uQnJvYWRjYXN0TWVzc2FnZSkgPT4gdm9pZH0gQmVhY29uQnJvYWRjYXN0SGFuZGxlclxuICovXG5jb25zdCBERUZBVUxUX1JFQ09OTkVDVF9ERUxBWV9NUyA9IDEwMDBcbmNvbnN0IE1BWF9SRUNPTk5FQ1RfREVMQVlfTVMgPSAzMF8wMDBcbmNvbnN0IERFRkFVTFRfQ0xPU0VfVElNRU9VVF9NUyA9IDEwMDBcblxuLyoqXG4gKiBCZWFjb25DbGllbnQgY29ubmVjdHMgdG8gYSBgdmVsb2Npb3VzIGJlYWNvbmAgZGFlbW9uIGFuZCBleGNoYW5nZXNcbiAqIGJyb2FkY2FzdHMgd2l0aCBhbGwgcGVlciBwcm9jZXNzZXMgY29ubmVjdGVkIHRvIHRoZSBzYW1lIGRhZW1vbi5cbiAqXG4gKiBMaWZlY3ljbGU6XG4gKiAgIGNvbnN0IGNsaWVudCA9IG5ldyBCZWFjb25DbGllbnQoe2hvc3QsIHBvcnQsIHBlZXJUeXBlOiBcInNlcnZlclwifSlcbiAqICAgYXdhaXQgY2xpZW50LmNvbm5lY3QoKSAgICAgICAgICAgICAgICAgICAgICAgICAvLyByZXNvbHZlcyBvbiBmaXJzdCBzdWNjZXNzZnVsIGNvbm5lY3RcbiAqICAgYXdhaXQgY2xpZW50LndhaXRGb3JSZWFkeSh7dGltZW91dE1zOiAxMDAwfSkgICAvLyByZXNvbHZlcyBhZnRlciB0aGUgZGFlbW9uIGhlbGxvLWFja1xuICogICBjbGllbnQub25Ccm9hZGNhc3QoKG1lc3NhZ2UpID0+IHsgLi4uIH0pICAgICAgIC8vIGV2ZXJ5IGZhbi1vdXRcbiAqICAgY2xpZW50LnB1Ymxpc2goe2NoYW5uZWwsIGJyb2FkY2FzdFBhcmFtcywgYm9keX0pXG4gKiAgIGF3YWl0IGNsaWVudC5jbG9zZSgpXG4gKlxuICogUmVjb25uZWN0OiBvbiBzb2NrZXQgY2xvc2UgKHdpdGhvdXQgYW4gZXhwbGljaXQgYGNsb3NlKClgIGNhbGwpIHRoZVxuICogY2xpZW50IHNjaGVkdWxlcyBhIHJlY29ubmVjdCB3aXRoIGV4cG9uZW50aWFsIGJhY2tvZmYuIFdoaWxlIHRoZVxuICogdW5kZXJseWluZyBzb2NrZXQgaXMgZG93biwgYHB1Ymxpc2goLi4uKWAgcmV0dXJucyBmYWxzZSBhbmQgdGhlXG4gKiBjYWxsZXIgY2FuIGZhbGwgYmFjayB0byBsb2NhbC1vbmx5IGRlbGl2ZXJ5OyBzdWJzZXF1ZW50IHJlY29ubmVjdHMgZG9cbiAqIG5vdCByZXBsYXkgbWlzc2VkIHB1Ymxpc2hlcyAoQmVhY29uIGlzIHB1YnN1Yiwgbm90IGEgcXVldWUpLlxuICovXG5leHBvcnQgZGVmYXVsdCBjbGFzcyBCZWFjb25DbGllbnQgZXh0ZW5kcyBFdmVudEVtaXR0ZXIge1xuICAvKipcbiAgICogUnVucyBjb25zdHJ1Y3Rvci5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBPcHRpb25zLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gYXJncy5ob3N0IC0gQmVhY29uIGhvc3QuXG4gICAqIEBwYXJhbSB7bnVtYmVyfSBhcmdzLnBvcnQgLSBCZWFjb24gcG9ydC5cbiAgICogQHBhcmFtIHtzdHJpbmd9IFthcmdzLnBlZXJUeXBlXSAtIE9wdGlvbmFsIGh1bWFuLXJlYWRhYmxlIHBlZXIgbGFiZWwuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBbYXJncy5wZWVySWRdIC0gT3B0aW9uYWwgZXhwbGljaXQgcGVlciBpZCAoZGVmYXVsdHMgdG8gYSByYW5kb20gVVVJRCkuXG4gICAqIEBwYXJhbSB7bnVtYmVyfSBbYXJncy5yZWNvbm5lY3REZWxheU1zXSAtIFN0YXJ0aW5nIHJlY29ubmVjdCBkZWxheSBpbiBtcy5cbiAgICogQHBhcmFtIHtudW1iZXJ9IFthcmdzLm1heFJlY29ubmVjdERlbGF5TXNdIC0gTWF4aW11bSByZWNvbm5lY3QgZGVsYXkgaW4gbXMuXG4gICAqIEBwYXJhbSB7bnVtYmVyfSBbYXJncy5jbG9zZVRpbWVvdXRNc10gLSBNYXhpbXVtIGdyYWNlZnVsIHNvY2tldCBjbG9zZSB3YWl0IGluIG1zLlxuICAgKi9cbiAgY29uc3RydWN0b3Ioe2hvc3QsIHBvcnQsIHBlZXJUeXBlLCBwZWVySWQsIHJlY29ubmVjdERlbGF5TXMsIG1heFJlY29ubmVjdERlbGF5TXMsIGNsb3NlVGltZW91dE1zfSkge1xuICAgIHN1cGVyKClcbiAgICB0aGlzLmhvc3QgPSBob3N0XG4gICAgdGhpcy5wb3J0ID0gcG9ydFxuICAgIHRoaXMucGVlclR5cGUgPSBwZWVyVHlwZVxuICAgIHRoaXMucGVlcklkID0gcGVlcklkIHx8IHJhbmRvbVVVSUQoKVxuICAgIHRoaXMuX2luaXRpYWxSZWNvbm5lY3REZWxheU1zID0gcmVjb25uZWN0RGVsYXlNcyA/PyBERUZBVUxUX1JFQ09OTkVDVF9ERUxBWV9NU1xuICAgIHRoaXMuX21heFJlY29ubmVjdERlbGF5TXMgPSBtYXhSZWNvbm5lY3REZWxheU1zID8/IE1BWF9SRUNPTk5FQ1RfREVMQVlfTVNcbiAgICB0aGlzLl9yZWNvbm5lY3REZWxheU1zID0gdGhpcy5faW5pdGlhbFJlY29ubmVjdERlbGF5TXNcbiAgICB0aGlzLl9jbG9zZVRpbWVvdXRNcyA9IGNsb3NlVGltZW91dE1zID8/IERFRkFVTFRfQ0xPU0VfVElNRU9VVF9NU1xuICAgIC8qKlxuICAgICAqIE5hcnJvd3MgdGhlIHJ1bnRpbWUgdmFsdWUgdG8gdGhlIGRvY3VtZW50ZWQgdHlwZS5cbiAgICAgKiBAdHlwZSB7SnNvblNvY2tldCB8IHVuZGVmaW5lZH0gKi9cbiAgICB0aGlzLl9qc29uU29ja2V0ID0gdW5kZWZpbmVkXG4gICAgLyoqXG4gICAgICogTmFycm93cyB0aGUgcnVudGltZSB2YWx1ZSB0byB0aGUgZG9jdW1lbnRlZCB0eXBlLlxuICAgICAqIEB0eXBlIHtuZXQuU29ja2V0IHwgdW5kZWZpbmVkfSAqL1xuICAgIHRoaXMuX3NvY2tldCA9IHVuZGVmaW5lZFxuICAgIHRoaXMuX2Nvbm5lY3RlZCA9IGZhbHNlXG4gICAgdGhpcy5fcmVhZHkgPSBmYWxzZVxuICAgIHRoaXMuX2Nsb3NlZCA9IGZhbHNlXG4gICAgLyoqXG4gICAgICogTmFycm93cyB0aGUgcnVudGltZSB2YWx1ZSB0byB0aGUgZG9jdW1lbnRlZCB0eXBlLlxuICAgICAqIEB0eXBlIHtSZXR1cm5UeXBlPHR5cGVvZiBzZXRUaW1lb3V0PiB8IHVuZGVmaW5lZH0gKi9cbiAgICB0aGlzLl9yZWNvbm5lY3RUaW1lciA9IHVuZGVmaW5lZFxuICAgIC8qKlxuICAgICAqIE5hcnJvd3MgdGhlIHJ1bnRpbWUgdmFsdWUgdG8gdGhlIGRvY3VtZW50ZWQgdHlwZS5cbiAgICAgKiBAdHlwZSB7UHJvbWlzZTx2b2lkPiB8IHVuZGVmaW5lZH0gKi9cbiAgICB0aGlzLl9jb25uZWN0UHJvbWlzZSA9IHVuZGVmaW5lZFxuICAgIC8qKlxuICAgICAqIExhc3Qgc29ja2V0IGVycm9yIG9ic2VydmVkIHdoaWxlIGNvbm5lY3RlZCwgc3VyZmFjZWQgYXMgdGhlIGRpc2Nvbm5lY3QgcmVhc29uLlxuICAgICAqIEB0eXBlIHtFcnJvciB8IHVuZGVmaW5lZH1cbiAgICAgKi9cbiAgICB0aGlzLl9sYXN0U29ja2V0RXJyb3IgPSB1bmRlZmluZWRcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGdldCBwZWVyIGlkLlxuICAgKiBAcmV0dXJucyB7c3RyaW5nfSAtIFRoZSBwZWVyIGlkIHNlbnQgb24gdGhlIGhlbGxvIGhhbmRzaGFrZS5cbiAgICovXG4gIGdldFBlZXJJZCgpIHsgcmV0dXJuIHRoaXMucGVlcklkIH1cblxuICAvKipcbiAgICogUnVucyBpcyBjb25uZWN0ZWQuXG4gICAqIEByZXR1cm5zIHtib29sZWFufSAtIFdoZXRoZXIgdGhlIHVuZGVybHlpbmcgc29ja2V0IGlzIGN1cnJlbnRseSBjb25uZWN0ZWQuXG4gICAqL1xuICBpc0Nvbm5lY3RlZCgpIHsgcmV0dXJuIHRoaXMuX2Nvbm5lY3RlZCB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgaXMgcmVhZHkuXG4gICAqIEByZXR1cm5zIHtib29sZWFufSAtIFdoZXRoZXIgdGhlIGRhZW1vbiBoYXMgYWNrbm93bGVkZ2VkIHRoaXMgcGVlciByZWdpc3RyYXRpb24uXG4gICAqL1xuICBpc1JlYWR5KCkgeyByZXR1cm4gdGhpcy5fcmVhZHkgfVxuXG4gIC8qKlxuICAgKiBSZXNvbHZlcyBvbiB0aGUgZmlyc3Qgc3VjY2Vzc2Z1bCBjb25uZWN0LiBTdWJzZXF1ZW50IGNhbGxzIHJldHVyblxuICAgKiB0aGUgc2FtZSBwcm9taXNlLiBTdWJzZXF1ZW50IHJlY29ubmVjdHMgYWZ0ZXIgYSBkcm9wIGFyZSBzaWxlbnQg4oCUXG4gICAqIHVzZSBgb24oXCJjb25uZWN0XCIpYCAvIGBvbihcImRpc2Nvbm5lY3RcIiwgcmVhc29uKWAgdG8gb2JzZXJ2ZSB0aGVtLlxuICAgKiBUaGUgYGRpc2Nvbm5lY3RgIGxpc3RlbmVyIHJlY2VpdmVzIGFuIGBFcnJvcmAgcmVhc29uOiBlaXRoZXIgdGhlXG4gICAqIHVuZGVybHlpbmcgc29ja2V0IGVycm9yLCBvciBgRXJyb3IoXCJCZWFjb24gYnJva2VyIGRpc2Nvbm5lY3RlZFwiKWBcbiAgICogd2hlbiB0aGUgY2xvc2UgaGFkIG5vIHByZWNlZGluZyBlcnJvci5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59XG4gICAqL1xuICBhc3luYyBjb25uZWN0KCkge1xuICAgIGlmICh0aGlzLl9jbG9zZWQpIHRocm93IG5ldyBFcnJvcihcIkJlYWNvbkNsaWVudCBoYXMgYmVlbiBjbG9zZWRcIilcbiAgICBpZiAodGhpcy5fY29ubmVjdFByb21pc2UpIHJldHVybiBhd2FpdCB0aGlzLl9jb25uZWN0UHJvbWlzZVxuXG4gICAgdGhpcy5fY29ubmVjdFByb21pc2UgPSBuZXcgUHJvbWlzZSgocmVzb2x2ZSwgcmVqZWN0KSA9PiB7XG4gICAgICBjb25zdCBvbkNvbm5lY3QgPSAoKSA9PiB7XG4gICAgICAgIHRoaXMub2ZmKFwiY29ubmVjdFwiLCBvbkNvbm5lY3QpXG4gICAgICAgIHRoaXMub2ZmKFwiY29ubmVjdC1lcnJvclwiLCBvbkVycm9yKVxuICAgICAgICByZXNvbHZlKClcbiAgICAgIH1cbiAgICAgIGNvbnN0IG9uRXJyb3IgPSAoLyoqIEB0eXBlIHtFcnJvcn0gKi8gZXJyb3IpID0+IHtcbiAgICAgICAgdGhpcy5vZmYoXCJjb25uZWN0XCIsIG9uQ29ubmVjdClcbiAgICAgICAgdGhpcy5vZmYoXCJjb25uZWN0LWVycm9yXCIsIG9uRXJyb3IpXG4gICAgICAgIHJlamVjdChlcnJvcilcbiAgICAgIH1cblxuICAgICAgdGhpcy5vbihcImNvbm5lY3RcIiwgb25Db25uZWN0KVxuICAgICAgdGhpcy5vbihcImNvbm5lY3QtZXJyb3JcIiwgb25FcnJvcilcbiAgICB9KVxuXG4gICAgdGhpcy5fb3BlblNvY2tldCgpXG5cbiAgICByZXR1cm4gYXdhaXQgdGhpcy5fY29ubmVjdFByb21pc2VcbiAgfVxuXG4gIC8qKlxuICAgKiBSZXNvbHZlcyBhZnRlciB0aGUgQmVhY29uIGRhZW1vbiBoYXMgYWNrbm93bGVkZ2VkIHRoaXMgcGVlcidzXG4gICAqIGhlbGxvIGhhbmRzaGFrZS4gVGhpcyBpcyBzdHJvbmdlciB0aGFuIGBpc0Nvbm5lY3RlZCgpYDogY29ubmVjdGVkXG4gICAqIG1lYW5zIHRoZSBUQ1Agc29ja2V0IGlzIG9wZW4sIHJlYWR5IG1lYW5zIHRoZSBkYWVtb24gaGFzIHJlZ2lzdGVyZWRcbiAgICogdGhlIHBlZXIgYW5kIGJyb2FkY2FzdHMgY2FuIGJlIHJvdXRlZCB0aHJvdWdoIHRoZSBidXMuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBbYXJnc10gLSBPcHRpb25zLlxuICAgKiBAcGFyYW0ge251bWJlcn0gW2FyZ3MudGltZW91dE1zXSAtIE9wdGlvbmFsIHRpbWVvdXQgaW4gbWlsbGlzZWNvbmRzLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn1cbiAgICovXG4gIGFzeW5jIHdhaXRGb3JSZWFkeSh7dGltZW91dE1zfSA9IHt9KSB7XG4gICAgaWYgKHRoaXMuX3JlYWR5KSByZXR1cm5cblxuICAgIC8qKlxuICAgICAqIENsZWFucyB1cCB0aGUgcmVhZHkgbGlzdGVuZXIgYW5kIHRpbWVvdXQuXG4gICAgICogQHR5cGUgeygpID0+IHZvaWR9XG4gICAgICovXG4gICAgbGV0IGNsZWFudXAgPSAoKSA9PiB7fVxuICAgIGNvbnN0IHJlYWR5UHJvbWlzZSA9IG5ldyBQcm9taXNlKChyZXNvbHZlKSA9PiB7XG4gICAgICBjb25zdCBvblJlYWR5ID0gKCkgPT4ge1xuICAgICAgICBjbGVhbnVwKClcbiAgICAgICAgcmVzb2x2ZSh1bmRlZmluZWQpXG4gICAgICB9XG5cbiAgICAgIGNsZWFudXAgPSAoKSA9PiB0aGlzLm9mZihcInJlYWR5XCIsIG9uUmVhZHkpXG4gICAgICB0aGlzLm9uKFwicmVhZHlcIiwgb25SZWFkeSlcbiAgICB9KVxuXG4gICAgdHJ5IHtcbiAgICAgIGlmICh0eXBlb2YgdGltZW91dE1zID09PSBcIm51bWJlclwiKSB7XG4gICAgICAgIGF3YWl0IHRpbWVvdXQoe3RpbWVvdXQ6IHRpbWVvdXRNc30sIGFzeW5jICgpID0+IHtcbiAgICAgICAgICBhd2FpdCByZWFkeVByb21pc2VcbiAgICAgICAgfSlcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIGF3YWl0IHJlYWR5UHJvbWlzZVxuICAgICAgfVxuICAgIH0gZmluYWxseSB7XG4gICAgICBjbGVhbnVwKClcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogUHVibGlzaGVzIGEgYnJvYWRjYXN0IG1lc3NhZ2UgdG8gYWxsIHBlZXJzIChpbmNsdWRpbmcgdGhpcyBvbmUsXG4gICAqIHVubGVzcyB0aGUgZGFlbW9uIGlzIHJlc3RhcnRlZCBtaWQtcHVibGlzaCkuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gQnJvYWRjYXN0IGFyZ3MuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBhcmdzLmNoYW5uZWwgLSBDaGFubmVsIG5hbWUuXG4gICAqIEBwYXJhbSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSBhcmdzLmJyb2FkY2FzdFBhcmFtcyAtIFJvdXRpbmcgcGFyYW1zLlxuICAgKiBAcGFyYW0ge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSBhcmdzLmJvZHkgLSBNZXNzYWdlIGJvZHkuXG4gICAqIEByZXR1cm5zIHtib29sZWFufSAtIFRydWUgaWYgdGhlIHB1Ymxpc2ggd2FzIHdyaXR0ZW4gdG8gdGhlIHNvY2tldC4gRmFsc2UgaWYgdGhlIGNsaWVudCBpcyBjdXJyZW50bHkgZGlzY29ubmVjdGVkLlxuICAgKi9cbiAgcHVibGlzaCh7Y2hhbm5lbCwgYnJvYWRjYXN0UGFyYW1zLCBib2R5fSkge1xuICAgIGlmICghdGhpcy5fY29ubmVjdGVkIHx8ICF0aGlzLl9qc29uU29ja2V0KSByZXR1cm4gZmFsc2VcblxuICAgIC8qKlxuICAgICAqIE1lc3NhZ2UuXG4gICAgICogQHR5cGUge2ltcG9ydChcIi4vdHlwZXMuanNcIikuQmVhY29uQnJvYWRjYXN0TWVzc2FnZX0gKi9cbiAgICBjb25zdCBtZXNzYWdlID0ge1xuICAgICAgdHlwZTogXCJicm9hZGNhc3RcIixcbiAgICAgIGNoYW5uZWwsXG4gICAgICBicm9hZGNhc3RQYXJhbXMsXG4gICAgICBib2R5LFxuICAgICAgb3JpZ2luUGVlcklkOiB0aGlzLnBlZXJJZFxuICAgIH1cblxuICAgIHRyeSB7XG4gICAgICB0aGlzLl9qc29uU29ja2V0LnNlbmQobWVzc2FnZSlcbiAgICAgIHJldHVybiB0cnVlXG4gICAgfSBjYXRjaCB7XG4gICAgICByZXR1cm4gZmFsc2VcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogUmVnaXN0ZXJzIGEgaGFuZGxlciBjYWxsZWQgb25jZSBmb3IgZXZlcnkgYGJyb2FkY2FzdGAgbWVzc2FnZVxuICAgKiByZWNlaXZlZCBmcm9tIHRoZSBkYWVtb24gKGluY2x1ZGluZyBlY2hvZXMgb2YgdGhpcyBjbGllbnQncyBvd25cbiAgICogcHVibGlzaGVzIOKAlCBzeW5hcHNlLXN0eWxlIGZhbi1vdXQpLlxuICAgKiBAcGFyYW0ge0JlYWNvbkJyb2FkY2FzdEhhbmRsZXJ9IGhhbmRsZXIgLSBIYW5kbGVyLlxuICAgKiBAcmV0dXJucyB7KCkgPT4gdm9pZH0gLSBVbnJlZ2lzdGVyIGZ1bmN0aW9uLlxuICAgKi9cbiAgb25Ccm9hZGNhc3QoaGFuZGxlcikge1xuICAgIHRoaXMub24oXCJicm9hZGNhc3RcIiwgaGFuZGxlcilcbiAgICByZXR1cm4gKCkgPT4gdGhpcy5vZmYoXCJicm9hZGNhc3RcIiwgaGFuZGxlcilcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGNsb3NlLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyBvbmNlIHRoZSBzb2NrZXQgaXMgY2xvc2VkLlxuICAgKi9cbiAgYXN5bmMgY2xvc2UoKSB7XG4gICAgdGhpcy5fY2xvc2VkID0gdHJ1ZVxuXG4gICAgaWYgKHRoaXMuX3JlY29ubmVjdFRpbWVyKSB7XG4gICAgICBjbGVhclRpbWVvdXQodGhpcy5fcmVjb25uZWN0VGltZXIpXG4gICAgICB0aGlzLl9yZWNvbm5lY3RUaW1lciA9IHVuZGVmaW5lZFxuICAgIH1cblxuICAgIGNvbnN0IHNvY2tldCA9IHRoaXMuX3NvY2tldFxuXG4gICAgaWYgKCFzb2NrZXQpIHJldHVyblxuXG4gICAgdGhpcy5fc29ja2V0ID0gdW5kZWZpbmVkXG4gICAgdGhpcy5fanNvblNvY2tldCA9IHVuZGVmaW5lZFxuXG4gICAgaWYgKHNvY2tldC5kZXN0cm95ZWQpIHJldHVyblxuXG4gICAgYXdhaXQgdGltZW91dCh7dGltZW91dDogdGhpcy5fY2xvc2VUaW1lb3V0TXN9LCBhc3luYyAoKSA9PiB7XG4gICAgICBhd2FpdCBuZXcgUHJvbWlzZSgocmVzb2x2ZSkgPT4ge1xuICAgICAgICBzb2NrZXQub25jZShcImNsb3NlXCIsICgpID0+IHJlc29sdmUodW5kZWZpbmVkKSlcbiAgICAgICAgc29ja2V0LmVuZCgpXG4gICAgICAgIHNvY2tldC5kZXN0cm95U29vbigpXG4gICAgICB9KVxuICAgIH0pLmNhdGNoKCgpID0+IHtcbiAgICAgIHNvY2tldC5kZXN0cm95KClcbiAgICB9KVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgb3BlbiBzb2NrZXQuXG4gICAqIEByZXR1cm5zIHt2b2lkfVxuICAgKi9cbiAgX29wZW5Tb2NrZXQoKSB7XG4gICAgaWYgKHRoaXMuX2Nsb3NlZCkgcmV0dXJuXG5cbiAgICBjb25zdCBzb2NrZXQgPSBuZXQuY3JlYXRlQ29ubmVjdGlvbih7aG9zdDogdGhpcy5ob3N0LCBwb3J0OiB0aGlzLnBvcnR9KVxuICAgIHRoaXMuX3NvY2tldCA9IHNvY2tldFxuICAgIGNvbnN0IGpzb25Tb2NrZXQgPSBuZXcgSnNvblNvY2tldChzb2NrZXQpXG4gICAgdGhpcy5fanNvblNvY2tldCA9IGpzb25Tb2NrZXRcblxuICAgIHNvY2tldC5vbihcImNvbm5lY3RcIiwgKCkgPT4ge1xuICAgICAgdGhpcy5fY29ubmVjdGVkID0gdHJ1ZVxuICAgICAgdGhpcy5fcmVhZHkgPSBmYWxzZVxuICAgICAgdGhpcy5fcmVjb25uZWN0RGVsYXlNcyA9IHRoaXMuX2luaXRpYWxSZWNvbm5lY3REZWxheU1zXG5cbiAgICAgIGpzb25Tb2NrZXQuc2VuZCh7XG4gICAgICAgIHR5cGU6IFwiaGVsbG9cIixcbiAgICAgICAgcm9sZTogXCJjbGllbnRcIixcbiAgICAgICAgcGVlcklkOiB0aGlzLnBlZXJJZCxcbiAgICAgICAgcGVlclR5cGU6IHRoaXMucGVlclR5cGVcbiAgICAgIH0pXG5cbiAgICAgIHRoaXMuZW1pdChcImNvbm5lY3RcIilcbiAgICB9KVxuXG4gICAganNvblNvY2tldC5vbihcIm1lc3NhZ2VcIiwgKC8qKiBAdHlwZSB7aW1wb3J0KFwiLi90eXBlcy5qc1wiKS5CZWFjb25Tb2NrZXRNZXNzYWdlfSAqLyBtZXNzYWdlKSA9PiB7XG4gICAgICBpZiAobWVzc2FnZT8udHlwZSA9PT0gXCJoZWxsby1hY2tcIiAmJiBtZXNzYWdlLnBlZXJJZCA9PT0gdGhpcy5wZWVySWQpIHtcbiAgICAgICAgdGhpcy5fcmVhZHkgPSB0cnVlXG4gICAgICAgIHRoaXMuZW1pdChcInJlYWR5XCIpXG4gICAgICB9IGVsc2UgaWYgKG1lc3NhZ2U/LnR5cGUgPT09IFwiYnJvYWRjYXN0XCIpIHtcbiAgICAgICAgdGhpcy5lbWl0KFwiYnJvYWRjYXN0XCIsIG1lc3NhZ2UpXG4gICAgICB9XG4gICAgfSlcblxuICAgIGpzb25Tb2NrZXQub24oXCJlcnJvclwiLCAoZXJyb3IpID0+IHtcbiAgICAgIGlmICghdGhpcy5fY29ubmVjdGVkKSB7XG4gICAgICAgIC8vIEluaXRpYWwgY29ubmVjdCBmYWlsZWQg4oCUIHN1cmZhY2UgdG8gYGNvbm5lY3QoKWAncyBwcm9taXNlIHZpYSBgY29ubmVjdC1lcnJvcmAuXG4gICAgICAgIC8vIE5vIGBlcnJvcmAgZW1pdDogdGhhdCBjaGFubmVsIGlzIGZvciBlc3RhYmxpc2hlZC1zZXNzaW9uIGVycm9yczsgdGhlXG4gICAgICAgIC8vIGluaXRpYWwtY29ubmVjdCBwYXRoIGlzIG93bmVkIGJ5IGBjb25uZWN0LWVycm9yYC5cbiAgICAgICAgdGhpcy5lbWl0KFwiY29ubmVjdC1lcnJvclwiLCBlcnJvcilcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIC8vIEVzdGFibGlzaGVkIHNlc3Npb24gZXJyb3IuIENhY2hlIHNvIHRoZSB1cGNvbWluZyBgY2xvc2VgIGV2ZW50IGNhblxuICAgICAgICAvLyBzdXJmYWNlIGl0IGFzIHRoZSBkaXNjb25uZWN0IHJlYXNvbi5cbiAgICAgICAgdGhpcy5fbGFzdFNvY2tldEVycm9yID0gZXJyb3JcbiAgICAgICAgdGhpcy5lbWl0KFwiZXJyb3JcIiwgZXJyb3IpXG4gICAgICB9XG4gICAgfSlcblxuICAgIGpzb25Tb2NrZXQub24oXCJjbG9zZVwiLCAoKSA9PiB7XG4gICAgICBjb25zdCB3YXNDb25uZWN0ZWQgPSB0aGlzLl9jb25uZWN0ZWRcblxuICAgICAgdGhpcy5fY29ubmVjdGVkID0gZmFsc2VcbiAgICAgIHRoaXMuX3JlYWR5ID0gZmFsc2VcbiAgICAgIHRoaXMuX2pzb25Tb2NrZXQgPSB1bmRlZmluZWRcbiAgICAgIHRoaXMuX3NvY2tldCA9IHVuZGVmaW5lZFxuXG4gICAgICAvLyBFeHBsaWNpdCBjbG9zZSgpIHNldHMgYF9jbG9zZWQgPSB0cnVlYCBiZWZvcmUgZW5kaW5nIHRoZSBzb2NrZXQuXG4gICAgICAvLyBEb24ndCBzdXJmYWNlIHVzZXItaW5pdGlhdGVkIHRlYXJkb3duIGFzIGEgZGlzY29ubmVjdCBcImVycm9yXCIg4oCUXG4gICAgICAvLyBvbmx5IG5ldHdvcmstZHJpdmVuIGRyb3BzIHNob3VsZCBiZSByZXBvcnRlZC5cbiAgICAgIGlmICh3YXNDb25uZWN0ZWQgJiYgIXRoaXMuX2Nsb3NlZCkge1xuICAgICAgICBjb25zdCByZWFzb24gPSB0aGlzLl9sYXN0U29ja2V0RXJyb3IgfHwgbmV3IEVycm9yKFwiQmVhY29uIGJyb2tlciBkaXNjb25uZWN0ZWRcIilcblxuICAgICAgICB0aGlzLmVtaXQoXCJkaXNjb25uZWN0XCIsIHJlYXNvbilcbiAgICAgIH1cblxuICAgICAgdGhpcy5fbGFzdFNvY2tldEVycm9yID0gdW5kZWZpbmVkXG5cbiAgICAgIGlmICh0aGlzLl9jbG9zZWQpIHJldHVyblxuXG4gICAgICB0aGlzLl9zY2hlZHVsZVJlY29ubmVjdCgpXG4gICAgfSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHNjaGVkdWxlIHJlY29ubmVjdC5cbiAgICogQHJldHVybnMge3ZvaWR9XG4gICAqL1xuICBfc2NoZWR1bGVSZWNvbm5lY3QoKSB7XG4gICAgaWYgKHRoaXMuX3JlY29ubmVjdFRpbWVyKSByZXR1cm5cblxuICAgIGNvbnN0IGRlbGF5ID0gdGhpcy5fcmVjb25uZWN0RGVsYXlNc1xuXG4gICAgdGhpcy5fcmVjb25uZWN0VGltZXIgPSBzZXRUaW1lb3V0KCgpID0+IHtcbiAgICAgIHRoaXMuX3JlY29ubmVjdFRpbWVyID0gdW5kZWZpbmVkXG4gICAgICB0aGlzLl9yZWNvbm5lY3REZWxheU1zID0gTWF0aC5taW4oZGVsYXkgKiAyLCB0aGlzLl9tYXhSZWNvbm5lY3REZWxheU1zKVxuICAgICAgdGhpcy5fb3BlblNvY2tldCgpXG4gICAgfSwgZGVsYXkpXG4gIH1cbn1cbiJdfQ==