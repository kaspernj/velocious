// @ts-check
import { randomUUID } from "node:crypto";
import EventEmitter from "../utils/event-emitter.js";
import { publishToInProcessPeers, registerInProcessPeer } from "./in-process-broker.js";
/**
 * BeaconBroadcastHandler type.
 * @typedef {(arg: import("./types.js").BeaconBroadcastMessage) => void} BeaconBroadcastHandler
 */
/**
 * In-process counterpart to `BeaconClient`. Registers with the
 * module-level `in-process-broker` singleton so peers in the same
 * process exchange broadcasts without ever touching TCP. Implements the
 * same external surface as `BeaconClient` (`connect`, `publish`,
 * `onBroadcast`, `isConnected`, `getPeerId`, `close`) so
 * `Configuration` can use either client interchangeably.
 *
 * Lifecycle differs from `BeaconClient` in two intentional ways:
 *   - `connect()` and `waitForReady()` resolve immediately; there is no broker to wait for.
 *   - There is no reconnect loop and no `connect-error` / `disconnect`
 *     event surface, because nothing can fail.
 */
export default class InProcessBeaconClient extends EventEmitter {
    /**
     * Runs constructor.
     * @param {object} [args] - Options.
     * @param {string} [args.peerType] - Optional human-readable peer label.
     * @param {string} [args.peerId] - Optional explicit peer id (defaults to a random UUID).
     */
    constructor({ peerType, peerId } = {}) {
        super();
        this.peerType = peerType;
        this.peerId = peerId || randomUUID();
        this._connected = false;
        /**
         * Narrows the runtime value to the documented type.
         * @type {(() => void) | undefined} */
        this._unregister = undefined;
    }
    /**
     * Runs get peer id.
     * @returns {string} - Peer id.
     */
    getPeerId() { return this.peerId; }
    /**
     * Runs is connected.
     * @returns {boolean} - Whether the peer is registered with the broker.
     */
    isConnected() { return this._connected; }
    /**
     * Runs is ready.
     * @returns {boolean} - Whether the peer is ready to publish through the broker.
     */
    isReady() { return this._connected; }
    /**
     * Registers with the in-process broker. Idempotent.
     * @returns {Promise<void>}
     */
    async connect() {
        if (this._connected)
            return;
        this._unregister = registerInProcessPeer(this);
        this._connected = true;
        this.emit("connect");
    }
    /**
     * In-process peers are ready as soon as they are connected.
     * @returns {Promise<void>}
     */
    async waitForReady() {
        if (!this._connected)
            await this.connect();
    }
    /**
     * Publishes a broadcast to every registered peer (including this
     * one). Returns false if `connect()` hasn't been called yet, matching
     * `BeaconClient` semantics.
     * @param {object} args - Broadcast args.
     * @param {string} args.channel - Channel name.
     * @param {Record<string, ReturnType<typeof JSON.parse>>} args.broadcastParams - Routing params.
     * @param {ReturnType<typeof JSON.parse>} args.body - Message body.
     * @returns {boolean} - True when the broadcast was queued.
     */
    publish({ channel, broadcastParams, body }) {
        if (!this._connected)
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
        publishToInProcessPeers(message);
        return true;
    }
    /**
     * Registers a handler called once for every broadcast received.
     * @param {BeaconBroadcastHandler} handler - Handler.
     * @returns {() => void} - Unregister function.
     */
    onBroadcast(handler) {
        this.on("broadcast", handler);
        return () => this.off("broadcast", handler);
    }
    /**
     * Receives a broadcast from the broker. Called by `in-process-broker`.
     * @param {import("./types.js").BeaconBroadcastMessage} message - Broadcast message.
     * @returns {void}
     */
    _receiveBroadcast(message) {
        this.emit("broadcast", message);
    }
    /**
     * Runs close.
     * @returns {Promise<void>} - Unregisters from the broker.
     */
    async close() {
        if (this._unregister)
            this._unregister();
        this._unregister = undefined;
        this._connected = false;
    }
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiaW4tcHJvY2Vzcy1jbGllbnQuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi9zcmMvYmVhY29uL2luLXByb2Nlc3MtY2xpZW50LmpzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiJBQUFBLFlBQVk7QUFFWixPQUFPLEVBQUMsVUFBVSxFQUFDLE1BQU0sYUFBYSxDQUFBO0FBRXRDLE9BQU8sWUFBWSxNQUFNLDJCQUEyQixDQUFBO0FBQ3BELE9BQU8sRUFBQyx1QkFBdUIsRUFBRSxxQkFBcUIsRUFBQyxNQUFNLHdCQUF3QixDQUFBO0FBRXJGOzs7R0FHRztBQUVIOzs7Ozs7Ozs7Ozs7R0FZRztBQUNILE1BQU0sQ0FBQyxPQUFPLE9BQU8scUJBQXNCLFNBQVEsWUFBWTtJQUM3RDs7Ozs7T0FLRztJQUNILFlBQVksRUFBQyxRQUFRLEVBQUUsTUFBTSxFQUFDLEdBQUcsRUFBRTtRQUNqQyxLQUFLLEVBQUUsQ0FBQTtRQUNQLElBQUksQ0FBQyxRQUFRLEdBQUcsUUFBUSxDQUFBO1FBQ3hCLElBQUksQ0FBQyxNQUFNLEdBQUcsTUFBTSxJQUFJLFVBQVUsRUFBRSxDQUFBO1FBQ3BDLElBQUksQ0FBQyxVQUFVLEdBQUcsS0FBSyxDQUFBO1FBQ3ZCOzs4Q0FFc0M7UUFDdEMsSUFBSSxDQUFDLFdBQVcsR0FBRyxTQUFTLENBQUE7SUFDOUIsQ0FBQztJQUVEOzs7T0FHRztJQUNILFNBQVMsS0FBSyxPQUFPLElBQUksQ0FBQyxNQUFNLENBQUEsQ0FBQyxDQUFDO0lBRWxDOzs7T0FHRztJQUNILFdBQVcsS0FBSyxPQUFPLElBQUksQ0FBQyxVQUFVLENBQUEsQ0FBQyxDQUFDO0lBRXhDOzs7T0FHRztJQUNILE9BQU8sS0FBSyxPQUFPLElBQUksQ0FBQyxVQUFVLENBQUEsQ0FBQyxDQUFDO0lBRXBDOzs7T0FHRztJQUNILEtBQUssQ0FBQyxPQUFPO1FBQ1gsSUFBSSxJQUFJLENBQUMsVUFBVTtZQUFFLE9BQU07UUFFM0IsSUFBSSxDQUFDLFdBQVcsR0FBRyxxQkFBcUIsQ0FBQyxJQUFJLENBQUMsQ0FBQTtRQUM5QyxJQUFJLENBQUMsVUFBVSxHQUFHLElBQUksQ0FBQTtRQUN0QixJQUFJLENBQUMsSUFBSSxDQUFDLFNBQVMsQ0FBQyxDQUFBO0lBQ3RCLENBQUM7SUFFRDs7O09BR0c7SUFDSCxLQUFLLENBQUMsWUFBWTtRQUNoQixJQUFJLENBQUMsSUFBSSxDQUFDLFVBQVU7WUFBRSxNQUFNLElBQUksQ0FBQyxPQUFPLEVBQUUsQ0FBQTtJQUM1QyxDQUFDO0lBRUQ7Ozs7Ozs7OztPQVNHO0lBQ0gsT0FBTyxDQUFDLEVBQUMsT0FBTyxFQUFFLGVBQWUsRUFBRSxJQUFJLEVBQUM7UUFDdEMsSUFBSSxDQUFDLElBQUksQ0FBQyxVQUFVO1lBQUUsT0FBTyxLQUFLLENBQUE7UUFFbEM7O2lFQUV5RDtRQUN6RCxNQUFNLE9BQU8sR0FBRztZQUNkLElBQUksRUFBRSxXQUFXO1lBQ2pCLE9BQU87WUFDUCxlQUFlO1lBQ2YsSUFBSTtZQUNKLFlBQVksRUFBRSxJQUFJLENBQUMsTUFBTTtTQUMxQixDQUFBO1FBRUQsdUJBQXVCLENBQUMsT0FBTyxDQUFDLENBQUE7UUFFaEMsT0FBTyxJQUFJLENBQUE7SUFDYixDQUFDO0lBRUQ7Ozs7T0FJRztJQUNILFdBQVcsQ0FBQyxPQUFPO1FBQ2pCLElBQUksQ0FBQyxFQUFFLENBQUMsV0FBVyxFQUFFLE9BQU8sQ0FBQyxDQUFBO1FBQzdCLE9BQU8sR0FBRyxFQUFFLENBQUMsSUFBSSxDQUFDLEdBQUcsQ0FBQyxXQUFXLEVBQUUsT0FBTyxDQUFDLENBQUE7SUFDN0MsQ0FBQztJQUVEOzs7O09BSUc7SUFDSCxpQkFBaUIsQ0FBQyxPQUFPO1FBQ3ZCLElBQUksQ0FBQyxJQUFJLENBQUMsV0FBVyxFQUFFLE9BQU8sQ0FBQyxDQUFBO0lBQ2pDLENBQUM7SUFFRDs7O09BR0c7SUFDSCxLQUFLLENBQUMsS0FBSztRQUNULElBQUksSUFBSSxDQUFDLFdBQVc7WUFBRSxJQUFJLENBQUMsV0FBVyxFQUFFLENBQUE7UUFDeEMsSUFBSSxDQUFDLFdBQVcsR0FBRyxTQUFTLENBQUE7UUFDNUIsSUFBSSxDQUFDLFVBQVUsR0FBRyxLQUFLLENBQUE7SUFDekIsQ0FBQztDQUNGIiwic291cmNlc0NvbnRlbnQiOlsiLy8gQHRzLWNoZWNrXG5cbmltcG9ydCB7cmFuZG9tVVVJRH0gZnJvbSBcIm5vZGU6Y3J5cHRvXCJcblxuaW1wb3J0IEV2ZW50RW1pdHRlciBmcm9tIFwiLi4vdXRpbHMvZXZlbnQtZW1pdHRlci5qc1wiXG5pbXBvcnQge3B1Ymxpc2hUb0luUHJvY2Vzc1BlZXJzLCByZWdpc3RlckluUHJvY2Vzc1BlZXJ9IGZyb20gXCIuL2luLXByb2Nlc3MtYnJva2VyLmpzXCJcblxuLyoqXG4gKiBCZWFjb25Ccm9hZGNhc3RIYW5kbGVyIHR5cGUuXG4gKiBAdHlwZWRlZiB7KGFyZzogaW1wb3J0KFwiLi90eXBlcy5qc1wiKS5CZWFjb25Ccm9hZGNhc3RNZXNzYWdlKSA9PiB2b2lkfSBCZWFjb25Ccm9hZGNhc3RIYW5kbGVyXG4gKi9cblxuLyoqXG4gKiBJbi1wcm9jZXNzIGNvdW50ZXJwYXJ0IHRvIGBCZWFjb25DbGllbnRgLiBSZWdpc3RlcnMgd2l0aCB0aGVcbiAqIG1vZHVsZS1sZXZlbCBgaW4tcHJvY2Vzcy1icm9rZXJgIHNpbmdsZXRvbiBzbyBwZWVycyBpbiB0aGUgc2FtZVxuICogcHJvY2VzcyBleGNoYW5nZSBicm9hZGNhc3RzIHdpdGhvdXQgZXZlciB0b3VjaGluZyBUQ1AuIEltcGxlbWVudHMgdGhlXG4gKiBzYW1lIGV4dGVybmFsIHN1cmZhY2UgYXMgYEJlYWNvbkNsaWVudGAgKGBjb25uZWN0YCwgYHB1Ymxpc2hgLFxuICogYG9uQnJvYWRjYXN0YCwgYGlzQ29ubmVjdGVkYCwgYGdldFBlZXJJZGAsIGBjbG9zZWApIHNvXG4gKiBgQ29uZmlndXJhdGlvbmAgY2FuIHVzZSBlaXRoZXIgY2xpZW50IGludGVyY2hhbmdlYWJseS5cbiAqXG4gKiBMaWZlY3ljbGUgZGlmZmVycyBmcm9tIGBCZWFjb25DbGllbnRgIGluIHR3byBpbnRlbnRpb25hbCB3YXlzOlxuICogICAtIGBjb25uZWN0KClgIGFuZCBgd2FpdEZvclJlYWR5KClgIHJlc29sdmUgaW1tZWRpYXRlbHk7IHRoZXJlIGlzIG5vIGJyb2tlciB0byB3YWl0IGZvci5cbiAqICAgLSBUaGVyZSBpcyBubyByZWNvbm5lY3QgbG9vcCBhbmQgbm8gYGNvbm5lY3QtZXJyb3JgIC8gYGRpc2Nvbm5lY3RgXG4gKiAgICAgZXZlbnQgc3VyZmFjZSwgYmVjYXVzZSBub3RoaW5nIGNhbiBmYWlsLlxuICovXG5leHBvcnQgZGVmYXVsdCBjbGFzcyBJblByb2Nlc3NCZWFjb25DbGllbnQgZXh0ZW5kcyBFdmVudEVtaXR0ZXIge1xuICAvKipcbiAgICogUnVucyBjb25zdHJ1Y3Rvci5cbiAgICogQHBhcmFtIHtvYmplY3R9IFthcmdzXSAtIE9wdGlvbnMuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBbYXJncy5wZWVyVHlwZV0gLSBPcHRpb25hbCBodW1hbi1yZWFkYWJsZSBwZWVyIGxhYmVsLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gW2FyZ3MucGVlcklkXSAtIE9wdGlvbmFsIGV4cGxpY2l0IHBlZXIgaWQgKGRlZmF1bHRzIHRvIGEgcmFuZG9tIFVVSUQpLlxuICAgKi9cbiAgY29uc3RydWN0b3Ioe3BlZXJUeXBlLCBwZWVySWR9ID0ge30pIHtcbiAgICBzdXBlcigpXG4gICAgdGhpcy5wZWVyVHlwZSA9IHBlZXJUeXBlXG4gICAgdGhpcy5wZWVySWQgPSBwZWVySWQgfHwgcmFuZG9tVVVJRCgpXG4gICAgdGhpcy5fY29ubmVjdGVkID0gZmFsc2VcbiAgICAvKipcbiAgICAgKiBOYXJyb3dzIHRoZSBydW50aW1lIHZhbHVlIHRvIHRoZSBkb2N1bWVudGVkIHR5cGUuXG4gICAgICogQHR5cGUgeygoKSA9PiB2b2lkKSB8IHVuZGVmaW5lZH0gKi9cbiAgICB0aGlzLl91bnJlZ2lzdGVyID0gdW5kZWZpbmVkXG4gIH1cblxuICAvKipcbiAgICogUnVucyBnZXQgcGVlciBpZC5cbiAgICogQHJldHVybnMge3N0cmluZ30gLSBQZWVyIGlkLlxuICAgKi9cbiAgZ2V0UGVlcklkKCkgeyByZXR1cm4gdGhpcy5wZWVySWQgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGlzIGNvbm5lY3RlZC5cbiAgICogQHJldHVybnMge2Jvb2xlYW59IC0gV2hldGhlciB0aGUgcGVlciBpcyByZWdpc3RlcmVkIHdpdGggdGhlIGJyb2tlci5cbiAgICovXG4gIGlzQ29ubmVjdGVkKCkgeyByZXR1cm4gdGhpcy5fY29ubmVjdGVkIH1cblxuICAvKipcbiAgICogUnVucyBpcyByZWFkeS5cbiAgICogQHJldHVybnMge2Jvb2xlYW59IC0gV2hldGhlciB0aGUgcGVlciBpcyByZWFkeSB0byBwdWJsaXNoIHRocm91Z2ggdGhlIGJyb2tlci5cbiAgICovXG4gIGlzUmVhZHkoKSB7IHJldHVybiB0aGlzLl9jb25uZWN0ZWQgfVxuXG4gIC8qKlxuICAgKiBSZWdpc3RlcnMgd2l0aCB0aGUgaW4tcHJvY2VzcyBicm9rZXIuIElkZW1wb3RlbnQuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fVxuICAgKi9cbiAgYXN5bmMgY29ubmVjdCgpIHtcbiAgICBpZiAodGhpcy5fY29ubmVjdGVkKSByZXR1cm5cblxuICAgIHRoaXMuX3VucmVnaXN0ZXIgPSByZWdpc3RlckluUHJvY2Vzc1BlZXIodGhpcylcbiAgICB0aGlzLl9jb25uZWN0ZWQgPSB0cnVlXG4gICAgdGhpcy5lbWl0KFwiY29ubmVjdFwiKVxuICB9XG5cbiAgLyoqXG4gICAqIEluLXByb2Nlc3MgcGVlcnMgYXJlIHJlYWR5IGFzIHNvb24gYXMgdGhleSBhcmUgY29ubmVjdGVkLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn1cbiAgICovXG4gIGFzeW5jIHdhaXRGb3JSZWFkeSgpIHtcbiAgICBpZiAoIXRoaXMuX2Nvbm5lY3RlZCkgYXdhaXQgdGhpcy5jb25uZWN0KClcbiAgfVxuXG4gIC8qKlxuICAgKiBQdWJsaXNoZXMgYSBicm9hZGNhc3QgdG8gZXZlcnkgcmVnaXN0ZXJlZCBwZWVyIChpbmNsdWRpbmcgdGhpc1xuICAgKiBvbmUpLiBSZXR1cm5zIGZhbHNlIGlmIGBjb25uZWN0KClgIGhhc24ndCBiZWVuIGNhbGxlZCB5ZXQsIG1hdGNoaW5nXG4gICAqIGBCZWFjb25DbGllbnRgIHNlbWFudGljcy5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBCcm9hZGNhc3QgYXJncy5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGFyZ3MuY2hhbm5lbCAtIENoYW5uZWwgbmFtZS5cbiAgICogQHBhcmFtIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59IGFyZ3MuYnJvYWRjYXN0UGFyYW1zIC0gUm91dGluZyBwYXJhbXMuXG4gICAqIEBwYXJhbSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59IGFyZ3MuYm9keSAtIE1lc3NhZ2UgYm9keS5cbiAgICogQHJldHVybnMge2Jvb2xlYW59IC0gVHJ1ZSB3aGVuIHRoZSBicm9hZGNhc3Qgd2FzIHF1ZXVlZC5cbiAgICovXG4gIHB1Ymxpc2goe2NoYW5uZWwsIGJyb2FkY2FzdFBhcmFtcywgYm9keX0pIHtcbiAgICBpZiAoIXRoaXMuX2Nvbm5lY3RlZCkgcmV0dXJuIGZhbHNlXG5cbiAgICAvKipcbiAgICAgKiBNZXNzYWdlLlxuICAgICAqIEB0eXBlIHtpbXBvcnQoXCIuL3R5cGVzLmpzXCIpLkJlYWNvbkJyb2FkY2FzdE1lc3NhZ2V9ICovXG4gICAgY29uc3QgbWVzc2FnZSA9IHtcbiAgICAgIHR5cGU6IFwiYnJvYWRjYXN0XCIsXG4gICAgICBjaGFubmVsLFxuICAgICAgYnJvYWRjYXN0UGFyYW1zLFxuICAgICAgYm9keSxcbiAgICAgIG9yaWdpblBlZXJJZDogdGhpcy5wZWVySWRcbiAgICB9XG5cbiAgICBwdWJsaXNoVG9JblByb2Nlc3NQZWVycyhtZXNzYWdlKVxuXG4gICAgcmV0dXJuIHRydWVcbiAgfVxuXG4gIC8qKlxuICAgKiBSZWdpc3RlcnMgYSBoYW5kbGVyIGNhbGxlZCBvbmNlIGZvciBldmVyeSBicm9hZGNhc3QgcmVjZWl2ZWQuXG4gICAqIEBwYXJhbSB7QmVhY29uQnJvYWRjYXN0SGFuZGxlcn0gaGFuZGxlciAtIEhhbmRsZXIuXG4gICAqIEByZXR1cm5zIHsoKSA9PiB2b2lkfSAtIFVucmVnaXN0ZXIgZnVuY3Rpb24uXG4gICAqL1xuICBvbkJyb2FkY2FzdChoYW5kbGVyKSB7XG4gICAgdGhpcy5vbihcImJyb2FkY2FzdFwiLCBoYW5kbGVyKVxuICAgIHJldHVybiAoKSA9PiB0aGlzLm9mZihcImJyb2FkY2FzdFwiLCBoYW5kbGVyKVxuICB9XG5cbiAgLyoqXG4gICAqIFJlY2VpdmVzIGEgYnJvYWRjYXN0IGZyb20gdGhlIGJyb2tlci4gQ2FsbGVkIGJ5IGBpbi1wcm9jZXNzLWJyb2tlcmAuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi90eXBlcy5qc1wiKS5CZWFjb25Ccm9hZGNhc3RNZXNzYWdlfSBtZXNzYWdlIC0gQnJvYWRjYXN0IG1lc3NhZ2UuXG4gICAqIEByZXR1cm5zIHt2b2lkfVxuICAgKi9cbiAgX3JlY2VpdmVCcm9hZGNhc3QobWVzc2FnZSkge1xuICAgIHRoaXMuZW1pdChcImJyb2FkY2FzdFwiLCBtZXNzYWdlKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgY2xvc2UuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFVucmVnaXN0ZXJzIGZyb20gdGhlIGJyb2tlci5cbiAgICovXG4gIGFzeW5jIGNsb3NlKCkge1xuICAgIGlmICh0aGlzLl91bnJlZ2lzdGVyKSB0aGlzLl91bnJlZ2lzdGVyKClcbiAgICB0aGlzLl91bnJlZ2lzdGVyID0gdW5kZWZpbmVkXG4gICAgdGhpcy5fY29ubmVjdGVkID0gZmFsc2VcbiAgfVxufVxuIl19