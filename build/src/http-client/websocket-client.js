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
        const channelSubscriptions = [...this._channelSubscriptions.values()];
        const socket = this.socket;
        this._channelSubscriptions.clear();
        const { promise: publishedClosePromise, reject: rejectPublishedClose, resolve: resolvePublishedClose } = Promise.withResolvers();
        this.gracefulClosePromise = publishedClosePromise;
        // This internal bridge exists only for synchronous reentrancy. Its rejection
        // duplicates closePromise, which remains the public error source below.
        void publishedClosePromise.catch(() => { });
        const closePromise = (async () => {
            /** @type {unknown[]} */
            const closeErrors = [];
            for (const subscription of channelSubscriptions) {
                try {
                    subscription._handleClosed("client_close");
                }
                catch (error) {
                    closeErrors.push(error);
                }
            }
            try {
                if (socket && socket.readyState === socket.OPEN) {
                    await new Promise((resolve) => {
                        socket.addEventListener("close", () => resolve(undefined), { once: true });
                        socket.close(1000);
                    });
                }
            }
            catch (error) {
                closeErrors.push(error);
            }
            try {
                await super.close();
            }
            catch (error) {
                closeErrors.push(error);
            }
            if (closeErrors.length === 1)
                throw closeErrors[0];
            if (closeErrors.length > 1)
                throw new AggregateError(closeErrors, "Failed to close WebSocket client");
        })();
        this.gracefulClosePromise = closePromise;
        void closePromise.then(resolvePublishedClose, rejectPublishedClose);
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
        while (this.runningReconnectTasks.size > 0) {
            await Promise.all(this.runningReconnectTasks);
        }
        // A stale attempt may have finished during the first close after changing
        // stopped state, even when the task set is already empty here.
        await super.disconnectAndStopReconnect();
    }
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoid2Vic29ja2V0LWNsaWVudC5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uLy4uLy4uL3NyYy9odHRwLWNsaWVudC93ZWJzb2NrZXQtY2xpZW50LmpzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiJBQUFBLFlBQVk7QUFFWixPQUFPLHNCQUFzQixNQUFNLG1CQUFtQixDQUFBO0FBQ3RELE9BQU8sRUFBQyxzQ0FBc0MsRUFBQyxNQUFNLCtDQUErQyxDQUFBO0FBRXBHLE1BQU0sV0FBVyxHQUFHLCtCQUErQixDQUFBO0FBQ25ELE1BQU0seUJBQXlCLEdBQUcsb0JBQW9CLENBQUE7QUFFdEQ7Ozs7OztHQU1HO0FBQ0gsTUFBTSxDQUFDLE9BQU8sT0FBTyx3QkFBeUIsU0FBUSxzQkFBc0I7SUFDMUU7OztPQUdHO0lBQ0gsWUFBWSxJQUFJLEdBQUcsRUFBRTtRQUNuQixLQUFLLENBQUM7WUFDSixHQUFHLElBQUk7WUFDUCxHQUFHLEVBQUUsSUFBSSxDQUFDLEdBQUcsSUFBSSxXQUFXO1lBQzVCLFdBQVcsRUFBRSxJQUFJLENBQUMsV0FBVyxJQUFJLHNDQUFzQztTQUN4RSxDQUFDLENBQUE7UUFDRixJQUFJLENBQUMsbUJBQW1CLEdBQUcsQ0FBQyxDQUFBO1FBQzVCLGlDQUFpQztRQUNqQyxJQUFJLENBQUMscUJBQXFCLEdBQUcsSUFBSSxHQUFHLEVBQUUsQ0FBQTtRQUN0QyxtQ0FBbUM7UUFDbkMsSUFBSSxDQUFDLG9CQUFvQixHQUFHLElBQUksQ0FBQTtRQUNoQyxJQUFJLENBQUMsY0FBYyxHQUFHLElBQUksQ0FBQyxHQUFHLENBQUE7SUFDaEMsQ0FBQztJQUVEOzs7O09BSUc7SUFDSCxLQUFLLENBQUMsMkJBQTJCO1FBQy9CLDRFQUE0RTtRQUM1RSwyRUFBMkU7UUFDM0UsTUFBTSxZQUFZLEdBQUcsa0xBQWtMLENBQUMsRUFBQyxzQkFBdUIsQ0FBQyxJQUFJLENBQUMsQ0FBQyxDQUFBO1FBRXZPLElBQUksWUFBWSxDQUFDLFVBQVUsSUFBSSxZQUFZLENB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RUQsSUFBSSxXQUFXLENBQUMsTUFBTSxLQUFLLENBQUM7Z0JBQUUsTUFBTSxXQUFXLENBQUMsQ0FBQyxDQUFDLENBQUE7WUFDbEQsSUFBSSxXQUFXLENBQUMsTUFBTSxHQUFHLENBQUM7Z0JBQUUsTUFBTSxJQUFJLGNBQWMsQ0FBQyxXQUFXLEVBQUUsa0NBQWtDLENBQUMsQ0FBQTtRQUN2RyxDQUFDLENBQUMsRUFBRSxDQUFBO1FBRUosSUFBSSxDQUFDLG9CQUFvQixHQUFHLFlBQVksQ0FBQTtRQUN4QyxLQUFLLFlBQVksQ0FBQyxJQUFJLENBQUMscUJBQXFCLEVBQUUsb0JBQW9CLENBQUMsQ0FBQTtRQUVuRSxJQUFJLENBQUM7WUFDSCxNQUFNLFlBQVksQ0FBQTtRQUNwQixDQUFDO2dCQUFTLENBQUM7WUFDVCxJQUFJLElBQUksQ0FBQyxvQkFBb0IsS0FBSyxZQUFZO2dCQUFFLElBQUksQ0FBQyxvQkFBb0IsR0FBRyxJQUFJLENBQUE7UUFDbEYsQ0FBQztJQUNILENBQUM7SUFFRDs7OztPQUlHO0lBQ0gsS0FBSyxDQUFDLDBCQUEwQjtRQUM5QixJQUFJLENBQUMsbUJBQW1CLElBQUksQ0FBQyxDQUFBO1FBQzdCLE1BQU0sS0FBSyxDQUFDLDBCQUEwQixFQUFFLENBQUE7UUFFeEMsT0FBTyxJQUFJLENBQUMscUJBQXFCLENBQUMsSUFBSSxHQUFHLENBQUMsRUFBRSxDQUFDO1lBQzNDLE1BQU0sT0FBTyxDQUFDLEdBQUcsQ0FBQyxJQUFJLENBQUMscUJBQXFCLENBQUMsQ0FBQTtRQUMvQyxDQUFDO1FBRUQsMEVBQTBFO1FBQzFFLCtEQUErRDtRQUMvRCxNQUFNLEtBQUssQ0FBQywwQkFBMEIsRUFBRSxDQUFBO0lBQzFDLENBQUM7Q0FDRiIsInNvdXJjZXNDb250ZW50IjpbIi8vIEB0cy1jaGVja1xuXG5pbXBvcnQgU25hcFJlcVdlYlNvY2tldENsaWVudCBmcm9tIFwic25hcHJlcS93ZWJzb2NrZXRcIlxuaW1wb3J0IHtkZXNlcmlhbGl6ZUZyb250ZW5kTW9kZWxUcmFuc3BvcnRWYWx1ZX0gZnJvbSBcIi4uL2Zyb250ZW5kLW1vZGVscy90cmFuc3BvcnQtc2VyaWFsaXphdGlvbi5qc1wiXG5cbmNvbnN0IERFRkFVTFRfVVJMID0gXCJ3czovLzEyNy4wLjAuMTozMDA2L3dlYnNvY2tldFwiXG5jb25zdCBTRVNTSU9OX1JPVVRJTkdfUEFSQU1FVEVSID0gXCJ2ZWxvY2lvdXNTZXNzaW9uSWRcIlxuXG4vKipcbiAqIFZlbG9jaW91cydzIFdlYlNvY2tldCBjbGllbnQuIFRoZSBjcm9zcy1wbGF0Zm9ybSBjb25uZWN0aW9uL3Nlc3Npb24vY2hhbm5lbFxuICogbWFjaGluZXJ5IGxpdmVzIGluIHNuYXByZXEncyBgU25hcFJlcVdlYlNvY2tldENsaWVudGA7IHRoaXMgdGhpbiBzdWJjbGFzcyBvbmx5XG4gKiBwcmUtd2lyZXMgdGhlIHR3byBWZWxvY2lvdXMtc3BlY2lmaWMgZGVmYXVsdHM6IHRoZSBsb2NhbCBkZXZlbG9wbWVudCB3ZWJzb2NrZXRcbiAqIFVSTCBhbmQgZnJvbnRlbmQtbW9kZWwgdHJhbnNwb3J0IGRlc2VyaWFsaXphdGlvbiBpbnNpZGUgYHJlc3BvbnNlLmpzb24oKWAuXG4gKiBAYXVnbWVudHMgU25hcFJlcVdlYlNvY2tldENsaWVudFxuICovXG5leHBvcnQgZGVmYXVsdCBjbGFzcyBWZWxvY2lvdXNXZWJzb2NrZXRDbGllbnQgZXh0ZW5kcyBTbmFwUmVxV2ViU29ja2V0Q2xpZW50IHtcbiAgLyoqXG4gICAqIFJ1bnMgY29uc3RydWN0b3IuXG4gICAqIEBwYXJhbSB7UGFydGlhbDxDb25zdHJ1Y3RvclBhcmFtZXRlcnM8dHlwZW9mIFNuYXBSZXFXZWJTb2NrZXRDbGllbnQ+WzBdPn0gW2FyZ3NdIC0gT3B0aW9ucyBmb3J3YXJkZWQgdG8gYFNuYXBSZXFXZWJTb2NrZXRDbGllbnRgLlxuICAgKi9cbiAgY29uc3RydWN0b3IoYXJncyA9IHt9KSB7XG4gICAgc3VwZXIoe1xuICAgICAgLi4uYXJncyxcbiAgICAgIHVybDogYXJncy51cmwgPz8gREVGQVVMVF9VUkwsXG4gICAgICBkZXNlcmlhbGl6ZTogYXJncy5kZXNlcmlhbGl6ZSA/PyBkZXNlcmlhbGl6ZUZyb250ZW5kTW9kZWxUcmFuc3BvcnRWYWx1ZVxuICAgIH0pXG4gICAgdGhpcy5yZWNvbm5lY3RHZW5lcmF0aW9uID0gMFxuICAgIC8qKiBAdHlwZSB7U2V0PFByb21pc2U8dm9pZD4+fSAqL1xuICAgIHRoaXMucnVubmluZ1JlY29ubmVjdFRhc2tzID0gbmV3IFNldCgpXG4gICAgLyoqIEB0eXBlIHtQcm9taXNlPHZvaWQ+IHwgbnVsbH0gKi9cbiAgICB0aGlzLmdyYWNlZnVsQ2xvc2VQcm9taXNlID0gbnVsbFxuICAgIHRoaXMucm91dGluZ0Jhc2VVcmwgPSB0aGlzLnVybFxuICB9XG5cbiAgLyoqXG4gICAqIFJlc3RvcmVzIGEgcGVyc2lzdGVkIHNlc3Npb24gYmVmb3JlIG9wZW5pbmcgdGhlIHNvY2tldCBzbyB0aGUgaG9zdCBjYW4gcm91dGVcbiAgICogdGhlIEhUVFAgdXBncmFkZSB0byB0aGUgd29ya2VyIHRoYXQgb3ducyBpdHMgcGF1c2VkIHN0YXRlLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn1cbiAgICovXG4gIGFzeW5jIF9yZXN0b3JlU2Vzc2lvbklkRm9yUm91dGluZygpIHtcbiAgICAvLyBTbmFwUmVxIGluaXRpYWxpemVzIHRoZXNlIGludGVybmFsIHNlc3Npb24gZmllbGRzIGluIGl0cyBjb25zdHJ1Y3RvciwgYnV0XG4gICAgLy8gaXRzIGRlY2xhcmF0aW9uIGRvZXMgbm90IGV4cG9zZSB0aGF0IGRlZmluaXRlLWFzc2lnbm1lbnQgbGlmZWN5Y2xlIGhlcmUuXG4gICAgY29uc3Qgcm91dGluZ1N0YXRlID0gLyoqIEB0eXBlIHt7X3Nlc3Npb25JZDogc3RyaW5nIHwgbnVsbCwgX3Nlc3Npb25TdG9yZToge2dldDogKCkgPT4gc3RyaW5nIHwgbnVsbCB8IHVuZGVmaW5lZCB8IFByb21pc2U8c3RyaW5nIHwgbnVsbCB8IHVuZGVmaW5lZD59IHwgdW5kZWZpbmVkLCBfc2Vzc2lvblN0b3JlUmVzdG9yZWQ6IGJvb2xlYW59fSAqLyAoLyoqIEB0eXBlIHt1bmtub3dufSAqLyAodGhpcykpXG5cbiAgICBpZiAocm91dGluZ1N0YXRlLl9zZXNzaW9uSWQgfHwgcm91dGluZ1N0YXRlLl9zZXNzaW9uU3RvcmVSZXN0b3JlZCB8fCAhcm91dGluZ1N0YXRlLl9zZXNzaW9uU3RvcmUpIHJldHVyblxuXG4gICAgcm91dGluZ1N0YXRlLl9zZXNzaW9uU3RvcmVSZXN0b3JlZCA9IHRydWVcblxuICAgIHRyeSB7XG4gICAgICBjb25zdCBzdG9yZWRJZCA9IGF3YWl0IHJvdXRpbmdTdGF0ZS5fc2Vzc2lvblN0b3JlLmdldCgpXG5cbiAgICAgIGlmICh0eXBlb2Ygc3RvcmVkSWQgPT09IFwic3RyaW5nXCIgJiYgc3RvcmVkSWQubGVuZ3RoID4gMCkgcm91dGluZ1N0YXRlLl9zZXNzaW9uSWQgPSBzdG9yZWRJZFxuICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICB0aGlzLl9kZWJ1ZyhcInNlc3Npb25TdG9yZS5nZXQgZmFpbGVkXCIsIGVycm9yKVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBCdWlsZHMgdGhlIFdlYlNvY2tldCBVUkwgY2Fycnlpbmcgb25seSB0aGUgY3VycmVudCByZXN1bWFibGUgc2Vzc2lvbiByb3V0aW5nIGhpbnQuXG4gICAqIEByZXR1cm5zIHtzdHJpbmd9IC0gV2ViU29ja2V0IFVSTC5cbiAgICovXG4gIF9zZXNzaW9uUm91dGluZ1VybCgpIHtcbiAgICBjb25zdCB1cmwgPSBuZXcgVVJMKHRoaXMucm91dGluZ0Jhc2VVcmwpXG5cbiAgICBpZiAodGhpcy5fc2Vzc2lvbklkKSB7XG4gICAgICB1cmwuc2VhcmNoUGFyYW1zLnNldChTRVNTSU9OX1JPVVRJTkdfUEFSQU1FVEVSLCB0aGlzLl9zZXNzaW9uSWQpXG4gICAgfSBlbHNlIHtcbiAgICAgIHVybC5zZWFyY2hQYXJhbXMuZGVsZXRlKFNFU1NJT05fUk9VVElOR19QQVJBTUVURVIpXG4gICAgfVxuXG4gICAgcmV0dXJuIHVybC50b1N0cmluZygpXG4gIH1cblxuICAvKipcbiAgICogUmVzdG9yZXMgcm91dGluZyBzdGF0ZSBiZWZvcmUgZGVsZWdhdGluZyBzb2NrZXQgY3JlYXRpb24gdG8gU25hcFJlcS5cbiAgICogQHBhcmFtIHtQYXJhbWV0ZXJzPFNuYXBSZXFXZWJTb2NrZXRDbGllbnRbXCJfY29ubmVjdFwiXT5bMF19IFtvcHRpb25zXSAtIENvbm5lY3Qgb3B0aW9ucy5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgd2hlbiB0aGUgc2Vzc2lvbiBpcyByZWFkeS5cbiAgICovXG4gIGFzeW5jIF9jb25uZWN0KG9wdGlvbnMpIHtcbiAgICBhd2FpdCB0aGlzLl9yZXN0b3JlU2Vzc2lvbklkRm9yUm91dGluZygpXG4gICAgdGhpcy51cmwgPSB0aGlzLl9zZXNzaW9uUm91dGluZ1VybCgpXG4gICAgYXdhaXQgc3VwZXIuX2Nvbm5lY3Qob3B0aW9ucylcbiAgfVxuXG4gIC8qKlxuICAgKiBJZ25vcmVzIGFuIG9ubGluZSByZXN1bHQgcmVzb2x2ZWQgYWZ0ZXIgcmVjb25uZWN0IHRlYXJkb3duIGJlZ2FuLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxib29sZWFuPn0gLSBXaGV0aGVyIHRoaXMgY2xpZW50IGdlbmVyYXRpb24gaXMgb25saW5lLlxuICAgKi9cbiAgYXN5bmMgX2lzT25saW5lKCkge1xuICAgIGNvbnN0IGdlbmVyYXRpb24gPSB0aGlzLnJlY29ubmVjdEdlbmVyYXRpb25cbiAgICBjb25zdCBpc09ubGluZSA9IGF3YWl0IHN1cGVyLl9pc09ubGluZSgpXG5cbiAgICByZXR1cm4gZ2VuZXJhdGlvbiA9PT0gdGhpcy5yZWNvbm5lY3RHZW5lcmF0aW9uICYmIGlzT25saW5lXG4gIH1cblxuICAvKipcbiAgICogVHJhY2tzIGF1dG9tYXRpYyByZWNvbm5lY3Qgd29yayBzbyB0ZWFyZG93biBjYW4gZHJhaW4gc3RhbGUgYXR0ZW1wdHMuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIGFmdGVyIHRoZSByZWNvbm5lY3QgYXR0ZW1wdCBzZXR0bGVzLlxuICAgKi9cbiAgYXN5bmMgX2F0dGVtcHRSZWNvbm5lY3QoKSB7XG4gICAgY29uc3QgcmVjb25uZWN0VGFzayA9IHN1cGVyLl9hdHRlbXB0UmVjb25uZWN0KClcblxuICAgIHRoaXMucnVubmluZ1JlY29ubmVjdFRhc2tzLmFkZChyZWNvbm5lY3RUYXNrKVxuXG4gICAgdHJ5IHtcbiAgICAgIGF3YWl0IHJlY29ubmVjdFRhc2tcbiAgICB9IGZpbmFsbHkge1xuICAgICAgdGhpcy5ydW5uaW5nUmVjb25uZWN0VGFza3MuZGVsZXRlKHJlY29ubmVjdFRhc2spXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIENsb3NlcyB0aGUgV2ViU29ja2V0IGFzIGEgbm9ybWFsIHNodXRkb3duIHNvIHRoZSBzZXJ2ZXIgcGVybWFuZW50bHlcbiAgICogcmVsZWFzZXMgcmVzdW1hYmxlIHNlc3Npb24gc3RhdGUuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIG9uY2UgY2xvc2VkLlxuICAgKi9cbiAgYXN5bmMgY2xvc2UoKSB7XG4gICAgaWYgKHRoaXMuZ3JhY2VmdWxDbG9zZVByb21pc2UpIHJldHVybiBhd2FpdCB0aGlzLmdyYWNlZnVsQ2xvc2VQcm9taXNlXG5cbiAgICB0aGlzLmF1dG9SZWNvbm5lY3QgPSBmYWxzZVxuICAgIGNvbnN0IGNoYW5uZWxTdWJzY3JpcHRpb25zID0gWy4uLnRoaXMuX2NoYW5uZWxTdWJzY3JpcHRpb25zLnZhbHVlcygpXVxuICAgIGNvbnN0IHNvY2tldCA9IHRoaXMuc29ja2V0XG5cbiAgICB0aGlzLl9jaGFubmVsU3Vic2NyaXB0aW9ucy5jbGVhcigpXG4gICAgY29uc3Qge3Byb21pc2U6IHB1Ymxpc2hlZENsb3NlUHJvbWlzZSwgcmVqZWN0OiByZWplY3RQdWJsaXNoZWRDbG9zZSwgcmVzb2x2ZTogcmVzb2x2ZVB1Ymxpc2hlZENsb3NlfSA9IFByb21pc2Uud2l0aFJlc29sdmVycygpXG5cbiAgICB0aGlzLmdyYWNlZnVsQ2xvc2VQcm9taXNlID0gcHVibGlzaGVkQ2xvc2VQcm9taXNlXG4gICAgLy8gVGhpcyBpbnRlcm5hbCBicmlkZ2UgZXhpc3RzIG9ubHkgZm9yIHN5bmNocm9ub3VzIHJlZW50cmFuY3kuIEl0cyByZWplY3Rpb25cbiAgICAvLyBkdXBsaWNhdGVzIGNsb3NlUHJvbWlzZSwgd2hpY2ggcmVtYWlucyB0aGUgcHVibGljIGVycm9yIHNvdXJjZSBiZWxvdy5cbiAgICB2b2lkIHB1Ymxpc2hlZENsb3NlUHJvbWlzZS5jYXRjaCgoKSA9PiB7fSlcbiAgICBjb25zdCBjbG9zZVByb21pc2UgPSAoYXN5bmMgKCkgPT4ge1xuICAgICAgLyoqIEB0eXBlIHt1bmtub3duW119ICovXG4gICAgICBjb25zdCBjbG9zZUVycm9ycyA9IFtdXG5cbiAgICAgIGZvciAoY29uc3Qgc3Vic2NyaXB0aW9uIG9mIGNoYW5uZWxTdWJzY3JpcHRpb25zKSB7XG4gICAgICAgIHRyeSB7XG4gICAgICAgICAgc3Vic2NyaXB0aW9uLl9oYW5kbGVDbG9zZWQoXCJjbGllbnRfY2xvc2VcIilcbiAgICAgICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgICAgICBjbG9zZUVycm9ycy5wdXNoKGVycm9yKVxuICAgICAgICB9XG4gICAgICB9XG5cbiAgICAgIHRyeSB7XG4gICAgICAgIGlmIChzb2NrZXQgJiYgc29ja2V0LnJlYWR5U3RhdGUgPT09IHNvY2tldC5PUEVOKSB7XG4gICAgICAgICAgYXdhaXQgbmV3IFByb21pc2UoKHJlc29sdmUpID0+IHtcbiAgICAgICAgICAgIHNvY2tldC5hZGRFdmVudExpc3RlbmVyKFwiY2xvc2VcIiwgKCkgPT4gcmVzb2x2ZSh1bmRlZmluZWQpLCB7b25jZTogdHJ1ZX0pXG4gICAgICAgICAgICBzb2NrZXQuY2xvc2UoMTAwMClcbiAgICAgICAgICB9KVxuICAgICAgICB9XG4gICAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgICBjbG9zZUVycm9ycy5wdXNoKGVycm9yKVxuICAgICAgfVxuXG4gICAgICB0cnkge1xuICAgICAgICBhd2FpdCBzdXBlci5jbG9zZSgpXG4gICAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgICBjbG9zZUVycm9ycy5wdXNoKGVycm9yKVxuICAgICAgfVxuXG4gICAgICBpZiAoY2xvc2VFcnJvcnMubGVuZ3RoID09PSAxKSB0aHJvdyBjbG9zZUVycm9yc1swXVxuICAgICAgaWYgKGNsb3NlRXJyb3JzLmxlbmd0aCA+IDEpIHRocm93IG5ldyBBZ2dyZWdhdGVFcnJvcihjbG9zZUVycm9ycywgXCJGYWlsZWQgdG8gY2xvc2UgV2ViU29ja2V0IGNsaWVudFwiKVxuICAgIH0pKClcblxuICAgIHRoaXMuZ3JhY2VmdWxDbG9zZVByb21pc2UgPSBjbG9zZVByb21pc2VcbiAgICB2b2lkIGNsb3NlUHJvbWlzZS50aGVuKHJlc29sdmVQdWJsaXNoZWRDbG9zZSwgcmVqZWN0UHVibGlzaGVkQ2xvc2UpXG5cbiAgICB0cnkge1xuICAgICAgYXdhaXQgY2xvc2VQcm9taXNlXG4gICAgfSBmaW5hbGx5IHtcbiAgICAgIGlmICh0aGlzLmdyYWNlZnVsQ2xvc2VQcm9taXNlID09PSBjbG9zZVByb21pc2UpIHRoaXMuZ3JhY2VmdWxDbG9zZVByb21pc2UgPSBudWxsXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIFN0b3BzIHJlY29ubmVjdCwgZHJhaW5zIHdvcmsgdGhhdCBhbHJlYWR5IHBhc3NlZCBTbmFwUmVxJ3MgcmVjb25uZWN0IGd1YXJkLFxuICAgKiBhbmQgY2xlYXJzIHN0YXRlIGNoYW5nZWQgYnkgYSBzdGFsZSBhdHRlbXB0IHdoaWxlIGl0IHNldHRsZWQuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIG9uY2Ugbm8gcmVjb25uZWN0IGNhbiByZXN1cnJlY3QgYSBzb2NrZXQuXG4gICAqL1xuICBhc3luYyBkaXNjb25uZWN0QW5kU3RvcFJlY29ubmVjdCgpIHtcbiAgICB0aGlzLnJlY29ubmVjdEdlbmVyYXRpb24gKz0gMVxuICAgIGF3YWl0IHN1cGVyLmRpc2Nvbm5lY3RBbmRTdG9wUmVjb25uZWN0KClcblxuICAgIHdoaWxlICh0aGlzLnJ1bm5pbmdSZWNvbm5lY3RUYXNrcy5zaXplID4gMCkge1xuICAgICAgYXdhaXQgUHJvbWlzZS5hbGwodGhpcy5ydW5uaW5nUmVjb25uZWN0VGFza3MpXG4gICAgfVxuXG4gICAgLy8gQSBzdGFsZSBhdHRlbXB0IG1heSBoYXZlIGZpbmlzaGVkIGR1cmluZyB0aGUgZmlyc3QgY2xvc2UgYWZ0ZXIgY2hhbmdpbmdcbiAgICAvLyBzdG9wcGVkIHN0YXRlLCBldmVuIHdoZW4gdGhlIHRhc2sgc2V0IGlzIGFscmVhZHkgZW1wdHkgaGVyZS5cbiAgICBhd2FpdCBzdXBlci5kaXNjb25uZWN0QW5kU3RvcFJlY29ubmVjdCgpXG4gIH1cbn1cbiJdfQ==