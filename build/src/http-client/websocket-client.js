// @ts-check
import SnapReqWebSocketClient from "snapreq/websocket";
import { deserializeFrontendModelTransportValue } from "../frontend-models/transport-serialization.js";
const DEFAULT_URL = "ws://127.0.0.1:3006/websocket";
const SESSION_ROUTING_PARAMETER = "velociousSessionId";
/**
 * Velocious's WebSocket client. The cross-platform connection/session/channel
 * machinery lives in snapreq's `SnapReqWebSocketClient`; this thin subclass only
 * pre-wires the two Velocious-specific defaults: the local development websocket
 * URL and frontend-model transport deserialization inside `response.json()`.
 * @augments SnapReqWebSocketClient
 */
export default class VelociousWebsocketClient extends SnapReqWebSocketClient {
    /**
     * Runs constructor.
     * @param {Partial<ConstructorParameters<typeof SnapReqWebSocketClient>[0]>} [args] - Options forwarded to `SnapReqWebSocketClient`.
     */
    constructor(args = {}) {
        super({
            ...args,
            url: args.url ?? DEFAULT_URL,
            deserialize: args.deserialize ?? deserializeFrontendModelTransportValue
        });
        this.reconnectGeneration = 0;
        /** @type {Set<Promise<void>>} */
        this.runningReconnectTasks = new Set();
        /** @type {Promise<void> | null} */
        this.gracefulClosePromise = null;
        this.routingBaseUrl = this.url;
    }
    /**
     * Restores a persisted session before opening the socket so the host can route
     * the HTTP upgrade to the worker that owns its paused state.
     * @returns {Promise<void>}
     */
    async _restoreSessionIdForRouting() {
        // SnapReq initializes these internal session fields in its constructor, but
        // its declaration does not expose that definite-assignment lifecycle here.
        const routingState = /** @type {{_sessionId: string | null, _sessionStore: {get: () => string | null | undefined | Promise<string | null | undefined>} | undefined, _sessionStoreRestored: boolean}} */ ( /** @type {unknown} */(this));
        if (routingState._sessionId || routingState._sessionStoreRestored || !routingState._sessionStore)
            return;
        routingState._sessionStoreRestored = true;
        try {
            const storedId = await routingState._sessionStore.get();
            if (typeof storedId === "string" && storedId.length > 0)
                routingState._sessionId = storedId;
        }
        catch (error) {
            this._debug("sessionStore.get failed", error);
        }
    }
    /**
     * Builds the WebSocket URL carrying only the current resumable session routing hint.
     * @returns {string} - WebSocket URL.
     */
    _sessionRoutingUrl() {
        const url = new URL(this.routingBaseUrl);
        if (this._sessionId) {
            url.searchParams.set(SESSION_ROUTING_PARAMETER, this._sessionId);
        }
        else {
            url.searchParams.delete(SESSION_ROUTING_PARAMETER);
        }
        return url.toString();
    }
    /**
     * Restores routing state before delegating socket creation to SnapReq.
     * @param {Parameters<SnapReqWebSocketClient["_connect"]>[0]} [options] - Connect options.
     * @returns {Promise<void>} - Resolves when the session is ready.
     */
    async _connect(options) {
        await this._restoreSessionIdForRouting();
        this.url = this._sessionRoutingUrl();
        await super._connect(options);
    }
    /**
     * Ignores an online result resolved after reconnect teardown began.
     * @returns {Promise<boolean>} - Whether this client generation is online.
     */
    async _isOnline() {
        const generation = this.reconnectGeneration;
        const isOnline = await super._isOnline();
        return generation === this.reconnectGeneration && isOnline;
    }
    /**
     * Tracks automatic reconnect work so teardown can drain stale attempts.
     * @returns {Promise<void>} - Resolves after the reconnect attempt settles.
     */
    async _attemptReconnect() {
        const reconnectTask = super._attemptReconnect();
        this.runningReconnectTasks.add(reconnectTask);
        try {
            await reconnectTask;
        }
        finally {
            this.runningReconnectTasks.delete(reconnectTask);
        }
    }
    /**
     * Closes the WebSocket as a normal shutdown so the server permanently
     * releases resumable session state.
     * @returns {Promise<void>} - Resolves once closed.
     */
    async close() {
        if (this.gracefulClosePromise)
            return await this.gracefulClosePromise;
        this.autoReconnect = false;
        const socket = this.socket;
        const closePromise = (async () => {
            if (socket && socket.readyState === socket.OPEN) {
                await new Promise((resolve) => {
                    socket.addEventListener("close", () => resolve(undefined), { once: true });
                    socket.close(1000);
                });
            }
            await super.close();
        })();
        this.gracefulClosePromise = closePromise;
        try {
            await closePromise;
        }
        finally {
            if (this.gracefulClosePromise === closePromise)
                this.gracefulClosePromise = null;
        }
    }
    /**
     * Stops reconnect, drains work that already passed SnapReq's reconnect guard,
     * and clears state changed by a stale attempt while it settled.
     * @returns {Promise<void>} - Resolves once no reconnect can resurrect a socket.
     */
    async disconnectAndStopReconnect() {
        this.reconnectGeneration += 1;
        await super.disconnectAndStopReconnect();
        if (this.runningReconnectTasks.size === 0)
            return;
        while (this.runningReconnectTasks.size > 0) {
            await Promise.all(this.runningReconnectTasks);
        }
        await super.disconnectAndStopReconnect();
    }
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoid2Vic29ja2V0LWNsaWVudC5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uLy4uLy4uL3NyYy9odHRwLWNsaWVudC93ZWJzb2NrZXQtY2xpZW50LmpzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiJBQUFBLFlBQVk7QUFFWixPQUFPLHNCQUFzQixNQUFNLG1CQUFtQixDQUFBO0FBQ3RELE9BQU8sRUFBQyxzQ0FBc0MsRUFBQyxNQUFNLCtDQUErQyxDQUFBO0FBRXBHLE1BQU0sV0FBVyxHQUFHLCtCQUErQixDQUFBO0FBQ25ELE1BQU0seUJBQXlCLEdBQUcsb0JBQW9CLENBQUE7QUFFdEQ7Ozs7OztHQU1HO0FBQ0gsTUFBTSxDQUFDLE9BQU8sT0FBTyx3QkFBeUIsU0FBUSxzQkFBc0I7SUFDMUU7OztPQUdHO0lBQ0gsWUFBWSxJQUFJLEdBQUcsRUFBRTtRQUNuQixLQUFLLENBQUM7WUFDSixHQUFHLElBQUk7WUFDUCxHQUFHLEVBQUUsSUFBSSxDQUFDLEdBQUcsSUFBSSxXQUFXO1lBQzVCLFdBQVcsRUFBRSxJQUFJLENBQUMsV0FBVyxJQUFJLHNDQUFzQztTQUN4RSxDQUFDLENBQUE7UUFDRixJQUFJLENBQUMsbUJBQW1CLEdBQUcsQ0FBQyxDQUFBO1FBQzVCLGlDQUFpQztRQUNqQyxJQUFJLENBQUMscUJBQXFCLEdBQUcsSUFBSSxHQUFHLEVBQUUsQ0FBQTtRQUN0QyxtQ0FBbUM7UUFDbkMsSUFBSSxDQUFDLG9CQUFvQixHQUFHLElBQUksQ0FBQTtRQUNoQyxJQUFJLENBQUMsY0FBYyxHQUFHLElBQUksQ0FBQyxHQUFHLENBQUE7SUFDaEMsQ0FBQztJQUVEOzs7O09BSUc7SUFDSCxLQUFLLENBQUMsMkJBQTJCO1FBQy9CLDRFQUE0RTtRQUM1RSwyRUFBMkU7UUFDM0UsTUFBTSxZQUFZLEdBQUcsa0xBQWtMLENBQUMsRUFBQyxzQkFBdUIsQ0FBQyxJQUFJLENBQUMsQ0FBQyxDQUFBO1FBRXZPLElBQUksWUFBWSxDQUFDLFVBQVUsSUFBSSxZQUFZLENB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QUFDLElBQUksQ0FBQyxDQUFBO2dCQUNwQixDQUFDLENBQUMsQ0FBQTtZQUNKLENBQUM7WUFFRCxNQUFNLEtBQUssQ0FBQyxLQUFLLEVBQUUsQ0FBQTtRQUNyQixDQUFDLENBQUMsRUFBRSxDQUFBO1FBRUosSUFBSSxDQUFDLG9CQUFvQixHQUFHLFlBQVksQ0FBQTtRQUV4QyxJQUFJLENBQUM7WUFDSCxNQUFNLFlBQVksQ0FBQTtRQUNwQixDQUFDO2dCQUFTLENBQUM7WUFDVCxJQUFJLElBQUksQ0FBQyxvQkFBb0IsS0FBSyxZQUFZO2dCQUFFLElBQUksQ0FBQyxvQkFBb0IsR0FBRyxJQUFJLENBQUE7UUFDbEYsQ0FBQztJQUNILENBQUM7SUFFRDs7OztPQUlHO0lBQ0gsS0FBSyxDQUFDLDBCQUEwQjtRQUM5QixJQUFJLENBQUMsbUJBQW1CLElBQUksQ0FBQyxDQUFBO1FBQzdCLE1BQU0sS0FBSyxDQUFDLDBCQUEwQixFQUFFLENBQUE7UUFFeEMsSUFBSSxJQUFJLENBQUMscUJBQXFCLENBQUMsSUFBSSxLQUFLLENBQUM7WUFBRSxPQUFNO1FBRWpELE9BQU8sSUFBSSxDQUFDLHFCQUFxQixDQUFDLElBQUksR0FBRyxDQUFDLEVBQUUsQ0FBQztZQUMzQyxNQUFNLE9BQU8sQ0FBQyxHQUFHLENBQUMsSUFBSSxDQUFDLHFCQUFxQixDQUFDLENBQUE7UUFDL0MsQ0FBQztRQUVELE1BQU0sS0FBSyxDQUFDLDBCQUEwQixFQUFFLENBQUE7SUFDMUMsQ0FBQztDQUNGIiwic291cmNlc0NvbnRlbnQiOlsiLy8gQHRzLWNoZWNrXG5cbmltcG9ydCBTbmFwUmVxV2ViU29ja2V0Q2xpZW50IGZyb20gXCJzbmFwcmVxL3dlYnNvY2tldFwiXG5pbXBvcnQge2Rlc2VyaWFsaXplRnJvbnRlbmRNb2RlbFRyYW5zcG9ydFZhbHVlfSBmcm9tIFwiLi4vZnJvbnRlbmQtbW9kZWxzL3RyYW5zcG9ydC1zZXJpYWxpemF0aW9uLmpzXCJcblxuY29uc3QgREVGQVVMVF9VUkwgPSBcIndzOi8vMTI3LjAuMC4xOjMwMDYvd2Vic29ja2V0XCJcbmNvbnN0IFNFU1NJT05fUk9VVElOR19QQVJBTUVURVIgPSBcInZlbG9jaW91c1Nlc3Npb25JZFwiXG5cbi8qKlxuICogVmVsb2Npb3VzJ3MgV2ViU29ja2V0IGNsaWVudC4gVGhlIGNyb3NzLXBsYXRmb3JtIGNvbm5lY3Rpb24vc2Vzc2lvbi9jaGFubmVsXG4gKiBtYWNoaW5lcnkgbGl2ZXMgaW4gc25hcHJlcSdzIGBTbmFwUmVxV2ViU29ja2V0Q2xpZW50YDsgdGhpcyB0aGluIHN1YmNsYXNzIG9ubHlcbiAqIHByZS13aXJlcyB0aGUgdHdvIFZlbG9jaW91cy1zcGVjaWZpYyBkZWZhdWx0czogdGhlIGxvY2FsIGRldmVsb3BtZW50IHdlYnNvY2tldFxuICogVVJMIGFuZCBmcm9udGVuZC1tb2RlbCB0cmFuc3BvcnQgZGVzZXJpYWxpemF0aW9uIGluc2lkZSBgcmVzcG9uc2UuanNvbigpYC5cbiAqIEBhdWdtZW50cyBTbmFwUmVxV2ViU29ja2V0Q2xpZW50XG4gKi9cbmV4cG9ydCBkZWZhdWx0IGNsYXNzIFZlbG9jaW91c1dlYnNvY2tldENsaWVudCBleHRlbmRzIFNuYXBSZXFXZWJTb2NrZXRDbGllbnQge1xuICAvKipcbiAgICogUnVucyBjb25zdHJ1Y3Rvci5cbiAgICogQHBhcmFtIHtQYXJ0aWFsPENvbnN0cnVjdG9yUGFyYW1ldGVyczx0eXBlb2YgU25hcFJlcVdlYlNvY2tldENsaWVudD5bMF0+fSBbYXJnc10gLSBPcHRpb25zIGZvcndhcmRlZCB0byBgU25hcFJlcVdlYlNvY2tldENsaWVudGAuXG4gICAqL1xuICBjb25zdHJ1Y3RvcihhcmdzID0ge30pIHtcbiAgICBzdXBlcih7XG4gICAgICAuLi5hcmdzLFxuICAgICAgdXJsOiBhcmdzLnVybCA/PyBERUZBVUxUX1VSTCxcbiAgICAgIGRlc2VyaWFsaXplOiBhcmdzLmRlc2VyaWFsaXplID8/IGRlc2VyaWFsaXplRnJvbnRlbmRNb2RlbFRyYW5zcG9ydFZhbHVlXG4gICAgfSlcbiAgICB0aGlzLnJlY29ubmVjdEdlbmVyYXRpb24gPSAwXG4gICAgLyoqIEB0eXBlIHtTZXQ8UHJvbWlzZTx2b2lkPj59ICovXG4gICAgdGhpcy5ydW5uaW5nUmVjb25uZWN0VGFza3MgPSBuZXcgU2V0KClcbiAgICAvKiogQHR5cGUge1Byb21pc2U8dm9pZD4gfCBudWxsfSAqL1xuICAgIHRoaXMuZ3JhY2VmdWxDbG9zZVByb21pc2UgPSBudWxsXG4gICAgdGhpcy5yb3V0aW5nQmFzZVVybCA9IHRoaXMudXJsXG4gIH1cblxuICAvKipcbiAgICogUmVzdG9yZXMgYSBwZXJzaXN0ZWQgc2Vzc2lvbiBiZWZvcmUgb3BlbmluZyB0aGUgc29ja2V0IHNvIHRoZSBob3N0IGNhbiByb3V0ZVxuICAgKiB0aGUgSFRUUCB1cGdyYWRlIHRvIHRoZSB3b3JrZXIgdGhhdCBvd25zIGl0cyBwYXVzZWQgc3RhdGUuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fVxuICAgKi9cbiAgYXN5bmMgX3Jlc3RvcmVTZXNzaW9uSWRGb3JSb3V0aW5nKCkge1xuICAgIC8vIFNuYXBSZXEgaW5pdGlhbGl6ZXMgdGhlc2UgaW50ZXJuYWwgc2Vzc2lvbiBmaWVsZHMgaW4gaXRzIGNvbnN0cnVjdG9yLCBidXRcbiAgICAvLyBpdHMgZGVjbGFyYXRpb24gZG9lcyBub3QgZXhwb3NlIHRoYXQgZGVmaW5pdGUtYXNzaWdubWVudCBsaWZlY3ljbGUgaGVyZS5cbiAgICBjb25zdCByb3V0aW5nU3RhdGUgPSAvKiogQHR5cGUge3tfc2Vzc2lvbklkOiBzdHJpbmcgfCBudWxsLCBfc2Vzc2lvblN0b3JlOiB7Z2V0OiAoKSA9PiBzdHJpbmcgfCBudWxsIHwgdW5kZWZpbmVkIHwgUHJvbWlzZTxzdHJpbmcgfCBudWxsIHwgdW5kZWZpbmVkPn0gfCB1bmRlZmluZWQsIF9zZXNzaW9uU3RvcmVSZXN0b3JlZDogYm9vbGVhbn19ICovICgvKiogQHR5cGUge3Vua25vd259ICovICh0aGlzKSlcblxuICAgIGlmIChyb3V0aW5nU3RhdGUuX3Nlc3Npb25JZCB8fCByb3V0aW5nU3RhdGUuX3Nlc3Npb25TdG9yZVJlc3RvcmVkIHx8ICFyb3V0aW5nU3RhdGUuX3Nlc3Npb25TdG9yZSkgcmV0dXJuXG5cbiAgICByb3V0aW5nU3RhdGUuX3Nlc3Npb25TdG9yZVJlc3RvcmVkID0gdHJ1ZVxuXG4gICAgdHJ5IHtcbiAgICAgIGNvbnN0IHN0b3JlZElkID0gYXdhaXQgcm91dGluZ1N0YXRlLl9zZXNzaW9uU3RvcmUuZ2V0KClcblxuICAgICAgaWYgKHR5cGVvZiBzdG9yZWRJZCA9PT0gXCJzdHJpbmdcIiAmJiBzdG9yZWRJZC5sZW5ndGggPiAwKSByb3V0aW5nU3RhdGUuX3Nlc3Npb25JZCA9IHN0b3JlZElkXG4gICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgIHRoaXMuX2RlYnVnKFwic2Vzc2lvblN0b3JlLmdldCBmYWlsZWRcIiwgZXJyb3IpXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIEJ1aWxkcyB0aGUgV2ViU29ja2V0IFVSTCBjYXJyeWluZyBvbmx5IHRoZSBjdXJyZW50IHJlc3VtYWJsZSBzZXNzaW9uIHJvdXRpbmcgaGludC5cbiAgICogQHJldHVybnMge3N0cmluZ30gLSBXZWJTb2NrZXQgVVJMLlxuICAgKi9cbiAgX3Nlc3Npb25Sb3V0aW5nVXJsKCkge1xuICAgIGNvbnN0IHVybCA9IG5ldyBVUkwodGhpcy5yb3V0aW5nQmFzZVVybClcblxuICAgIGlmICh0aGlzLl9zZXNzaW9uSWQpIHtcbiAgICAgIHVybC5zZWFyY2hQYXJhbXMuc2V0KFNFU1NJT05fUk9VVElOR19QQVJBTUVURVIsIHRoaXMuX3Nlc3Npb25JZClcbiAgICB9IGVsc2Uge1xuICAgICAgdXJsLnNlYXJjaFBhcmFtcy5kZWxldGUoU0VTU0lPTl9ST1VUSU5HX1BBUkFNRVRFUilcbiAgICB9XG5cbiAgICByZXR1cm4gdXJsLnRvU3RyaW5nKClcbiAgfVxuXG4gIC8qKlxuICAgKiBSZXN0b3JlcyByb3V0aW5nIHN0YXRlIGJlZm9yZSBkZWxlZ2F0aW5nIHNvY2tldCBjcmVhdGlvbiB0byBTbmFwUmVxLlxuICAgKiBAcGFyYW0ge1BhcmFtZXRlcnM8U25hcFJlcVdlYlNvY2tldENsaWVudFtcIl9jb25uZWN0XCJdPlswXX0gW29wdGlvbnNdIC0gQ29ubmVjdCBvcHRpb25zLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyB3aGVuIHRoZSBzZXNzaW9uIGlzIHJlYWR5LlxuICAgKi9cbiAgYXN5bmMgX2Nvbm5lY3Qob3B0aW9ucykge1xuICAgIGF3YWl0IHRoaXMuX3Jlc3RvcmVTZXNzaW9uSWRGb3JSb3V0aW5nKClcbiAgICB0aGlzLnVybCA9IHRoaXMuX3Nlc3Npb25Sb3V0aW5nVXJsKClcbiAgICBhd2FpdCBzdXBlci5fY29ubmVjdChvcHRpb25zKVxuICB9XG5cbiAgLyoqXG4gICAqIElnbm9yZXMgYW4gb25saW5lIHJlc3VsdCByZXNvbHZlZCBhZnRlciByZWNvbm5lY3QgdGVhcmRvd24gYmVnYW4uXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPGJvb2xlYW4+fSAtIFdoZXRoZXIgdGhpcyBjbGllbnQgZ2VuZXJhdGlvbiBpcyBvbmxpbmUuXG4gICAqL1xuICBhc3luYyBfaXNPbmxpbmUoKSB7XG4gICAgY29uc3QgZ2VuZXJhdGlvbiA9IHRoaXMucmVjb25uZWN0R2VuZXJhdGlvblxuICAgIGNvbnN0IGlzT25saW5lID0gYXdhaXQgc3VwZXIuX2lzT25saW5lKClcblxuICAgIHJldHVybiBnZW5lcmF0aW9uID09PSB0aGlzLnJlY29ubmVjdEdlbmVyYXRpb24gJiYgaXNPbmxpbmVcbiAgfVxuXG4gIC8qKlxuICAgKiBUcmFja3MgYXV0b21hdGljIHJlY29ubmVjdCB3b3JrIHNvIHRlYXJkb3duIGNhbiBkcmFpbiBzdGFsZSBhdHRlbXB0cy5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgYWZ0ZXIgdGhlIHJlY29ubmVjdCBhdHRlbXB0IHNldHRsZXMuXG4gICAqL1xuICBhc3luYyBfYXR0ZW1wdFJlY29ubmVjdCgpIHtcbiAgICBjb25zdCByZWNvbm5lY3RUYXNrID0gc3VwZXIuX2F0dGVtcHRSZWNvbm5lY3QoKVxuXG4gICAgdGhpcy5ydW5uaW5nUmVjb25uZWN0VGFza3MuYWRkKHJlY29ubmVjdFRhc2spXG5cbiAgICB0cnkge1xuICAgICAgYXdhaXQgcmVjb25uZWN0VGFza1xuICAgIH0gZmluYWxseSB7XG4gICAgICB0aGlzLnJ1bm5pbmdSZWNvbm5lY3RUYXNrcy5kZWxldGUocmVjb25uZWN0VGFzaylcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogQ2xvc2VzIHRoZSBXZWJTb2NrZXQgYXMgYSBub3JtYWwgc2h1dGRvd24gc28gdGhlIHNlcnZlciBwZXJtYW5lbnRseVxuICAgKiByZWxlYXNlcyByZXN1bWFibGUgc2Vzc2lvbiBzdGF0ZS5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgb25jZSBjbG9zZWQuXG4gICAqL1xuICBhc3luYyBjbG9zZSgpIHtcbiAgICBpZiAodGhpcy5ncmFjZWZ1bENsb3NlUHJvbWlzZSkgcmV0dXJuIGF3YWl0IHRoaXMuZ3JhY2VmdWxDbG9zZVByb21pc2VcblxuICAgIHRoaXMuYXV0b1JlY29ubmVjdCA9IGZhbHNlXG4gICAgY29uc3Qgc29ja2V0ID0gdGhpcy5zb2NrZXRcbiAgICBjb25zdCBjbG9zZVByb21pc2UgPSAoYXN5bmMgKCkgPT4ge1xuICAgICAgaWYgKHNvY2tldCAmJiBzb2NrZXQucmVhZHlTdGF0ZSA9PT0gc29ja2V0Lk9QRU4pIHtcbiAgICAgICAgYXdhaXQgbmV3IFByb21pc2UoKHJlc29sdmUpID0+IHtcbiAgICAgICAgICBzb2NrZXQuYWRkRXZlbnRMaXN0ZW5lcihcImNsb3NlXCIsICgpID0+IHJlc29sdmUodW5kZWZpbmVkKSwge29uY2U6IHRydWV9KVxuICAgICAgICAgIHNvY2tldC5jbG9zZSgxMDAwKVxuICAgICAgICB9KVxuICAgICAgfVxuXG4gICAgICBhd2FpdCBzdXBlci5jbG9zZSgpXG4gICAgfSkoKVxuXG4gICAgdGhpcy5ncmFjZWZ1bENsb3NlUHJvbWlzZSA9IGNsb3NlUHJvbWlzZVxuXG4gICAgdHJ5IHtcbiAgICAgIGF3YWl0IGNsb3NlUHJvbWlzZVxuICAgIH0gZmluYWxseSB7XG4gICAgICBpZiAodGhpcy5ncmFjZWZ1bENsb3NlUHJvbWlzZSA9PT0gY2xvc2VQcm9taXNlKSB0aGlzLmdyYWNlZnVsQ2xvc2VQcm9taXNlID0gbnVsbFxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBTdG9wcyByZWNvbm5lY3QsIGRyYWlucyB3b3JrIHRoYXQgYWxyZWFkeSBwYXNzZWQgU25hcFJlcSdzIHJlY29ubmVjdCBndWFyZCxcbiAgICogYW5kIGNsZWFycyBzdGF0ZSBjaGFuZ2VkIGJ5IGEgc3RhbGUgYXR0ZW1wdCB3aGlsZSBpdCBzZXR0bGVkLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyBvbmNlIG5vIHJlY29ubmVjdCBjYW4gcmVzdXJyZWN0IGEgc29ja2V0LlxuICAgKi9cbiAgYXN5bmMgZGlzY29ubmVjdEFuZFN0b3BSZWNvbm5lY3QoKSB7XG4gICAgdGhpcy5yZWNvbm5lY3RHZW5lcmF0aW9uICs9IDFcbiAgICBhd2FpdCBzdXBlci5kaXNjb25uZWN0QW5kU3RvcFJlY29ubmVjdCgpXG5cbiAgICBpZiAodGhpcy5ydW5uaW5nUmVjb25uZWN0VGFza3Muc2l6ZSA9PT0gMCkgcmV0dXJuXG5cbiAgICB3aGlsZSAodGhpcy5ydW5uaW5nUmVjb25uZWN0VGFza3Muc2l6ZSA+IDApIHtcbiAgICAgIGF3YWl0IFByb21pc2UuYWxsKHRoaXMucnVubmluZ1JlY29ubmVjdFRhc2tzKVxuICAgIH1cblxuICAgIGF3YWl0IHN1cGVyLmRpc2Nvbm5lY3RBbmRTdG9wUmVjb25uZWN0KClcbiAgfVxufVxuIl19