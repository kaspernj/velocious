// @ts-check
/**
 * Client-side handle for a channel subscription opened via
 * `VelociousWebsocketClient.subscribeChannel()`. Mirrors the server's
 * subscription lifecycle — `subscribed` (resolves `ready`) / `onMessage` /
 * `onClose`.
 *
 * See `docs/websocket-channels.md` for the wire protocol.
 */
export default class VelociousWebsocketClientSubscription {
    /**
     * @param {object} args
     * @param {import("./websocket-client.js").default} args.client
     * @param {string} args.subscriptionId
     * @param {string} args.channelType
     * @param {Record<string, any>} [args.params]
     * @param {string} [args.lastEventId]
     * @param {(body: any) => void} [args.onMessage]
     * @param {() => void} [args.onDisconnect]
     * @param {() => void} [args.onResume]
     * @param {(reason: string) => void} [args.onClose]
     */
    constructor({ client, subscriptionId, channelType, params, lastEventId, onMessage, onDisconnect, onResume, onClose }) {
        this.client = client;
        this.subscriptionId = subscriptionId;
        this.channelType = channelType;
        this.params = params || {};
        this.lastEventId = lastEventId;
        this._onMessage = onMessage;
        this._onDisconnect = onDisconnect;
        this._onResume = onResume;
        this._onClose = onClose;
        this._ready = false;
        this._resumeReadyOnResume = false;
        this._subscribed = false;
        this._subscribeSent = false;
        this._closed = false;
    }
    /** @returns {Promise<void>} */
    _ensureReadyPromise() {
        if (!this._readyPromise || !this._resolveReady || !this._rejectReady) {
            /** @type {Promise<void>} */
            this._readyPromise = new Promise((resolve, reject) => {
                this._resolveReady = resolve;
                this._rejectReady = reject;
            });
        }
        return this._readyPromise;
    }
    /** @returns {Promise<void>} */
    get ready() {
        return this._ensureReadyPromise();
    }
    /** @returns {void} */
    _resolveReadyState() {
        this._ready = true;
        this._resolveReady?.();
        this._resolveReady = null;
        this._rejectReady = null;
    }
    /** @returns {void} */
    _markNotReady() {
        this._ready = false;
    }
    /** @returns {void} */
    _handleSubscribed() {
        if (this._closed || this._subscribed)
            return;
        this._subscribed = true;
        this._resolveReadyState();
    }
    /** @returns {void} */
    _markSubscribeSent() {
        this._subscribeSent = true;
    }
    /** @returns {boolean} */
    _needsSubscribe() {
        return !this._closed && !this._subscribeSent;
    }
    /**
     * @param {any} body
     * @returns {void}
     */
    _handleMessage(body) {
        if (this._closed)
            return;
        this._onMessage?.(body);
    }
    /** @returns {void} */
    _handleDisconnected() {
        if (this._closed)
            return;
        this._resumeReadyOnResume ||= this._subscribed;
        this._subscribed = false;
        this._markNotReady();
        this._onDisconnect?.();
    }
    /** @returns {void} */
    _handleResumed() {
        if (this._closed)
            return;
        if (this._resumeReadyOnResume) {
            this._subscribed = true;
            this._resolveReadyState();
        }
        this._resumeReadyOnResume = false;
        this._onResume?.();
    }
    /**
     * @param {string} reason
     * @returns {void}
     */
    _handleClosed(reason) {
        if (this._closed)
            return;
        this._closed = true;
        try {
            this._onClose?.(reason);
        }
        finally {
            this._resumeReadyOnResume = false;
            if (!this._ready) {
                this._rejectReady?.(new Error(`Subscription closed before acknowledgement: ${reason}`));
            }
            this._resolveReady = null;
            this._rejectReady = null;
        }
    }
    /**
     * @param {{timeoutMs?: number}} [params]
     * @returns {Promise<void>}
     */
    async waitForReady({ timeoutMs = 5000 } = {}) {
        if (this._ready)
            return;
        const readyPromise = this._ensureReadyPromise();
        const timeoutPromise = new Promise((_, reject) => {
            setTimeout(() => reject(new Error(`Subscription not ready after ${timeoutMs}ms`)), timeoutMs);
        });
        await Promise.race([readyPromise, timeoutPromise]);
    }
    /** @returns {void} */
    close() {
        if (this._closed)
            return;
        try {
            if (this.client.isOpen()) {
                this.client._sendMessage({ type: "channel-unsubscribe", subscriptionId: this.subscriptionId });
            }
        }
        catch {
            // Socket already gone; server will clean up on session teardown.
        }
        this.client._removeChannelSubscription(this.subscriptionId);
        this._handleClosed("client_unsubscribe");
    }
    /** @returns {boolean} */
    isClosed() { return this._closed; }
    /** @returns {boolean} */
    isReady() { return this._ready; }
    /** @returns {boolean} */
    isSubscribed() { return this._subscribed && !this._closed; }
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoid2Vic29ja2V0LWNoYW5uZWwuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi9zcmMvaHR0cC1jbGllbnQvd2Vic29ja2V0LWNoYW5uZWwuanMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6IkFBQUEsWUFBWTtBQUVaOzs7Ozs7O0dBT0c7QUFDSCxNQUFNLENBQUMsT0FBTyxPQUFPLG9DQUFvQztJQUN2RDs7Ozs7Ozs7Ozs7T0FXRztJQUNILFlBQVksRUFBQyxNQUFNLEVBQUUsY0FBYyxFQUFFLFdBQVcsRUFBRSxNQUFNLEVBQUUsV0FBVyxFQUFFLFNBQVMsRUFBRSxZQUFZLEVBQUUsUUFBUSxFQUFFLE9BQU8sRUFBQztRQUNoSCxJQUFJLENBQUMsTUFBTSxHQUFHLE1BQU0sQ0FBQTtRQUNwQixJQUFJLENBQUMsY0FBYyxHQUFHLGNBQWMsQ0FBQTtRQUNwQyxJQUFJLENBQUMsV0FBVyxHQUFHLFdBQVcsQ0FBQTtRQUM5QixJQUFJLENBQUMsTUFBTSxHQUFHLE1BQU0sSUFBSSxFQUFFLENBQUE7UUFDMUIsSUFBSSxDQUFDLFdBQVcsR0FBRyxXQUFXLENBQUE7UUFDOUIsSUFBSSxDQUFDLFVBQVUsR0FBRyxTQUFTLENBQUE7UUFDM0IsSUFBSSxDQUFDLGFBQWEsR0FBRyxZQUFZLENBQUE7UUFDakMsSUFBSSxDQUFDLFNBQVMsR0FBRyxRQUFRLENBQUE7UUFDekIsSUFBSSxDQUFDLFFBQVEsR0FBRyxPQUFPLENBQUE7UUFDdkIsSUFBSSxDQUFDLE1BQU0sR0FBRyxLQUFLLENBQUE7UUFDbkIsSUFBSSxDQUFDLG9CQUFvQixHQUFHLEtBQUssQ0FBQTtRQUNqQyxJQUFJLENBQUMsV0FBVyxHQUFHLEtBQUssQ0FBQTtRQUN4QixJQUFJLENBQUMsY0FBYyxHQUFHLEtBQUssQ0FBQTtRQUMzQixJQUFJLENBQUMsT0FBTyxHQUFHLEtBQUssQ0FBQTtRQUVwQixJQUFJLENBQUMsbUJBQW1CLEVBQUUsQ0FBQTtJQUM1QixDQUFDO0lBRUQsK0JBQStCO0lB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MEIsQ0FBQyxJQUFJLENBQUMsY0FBYyxDQUFDLENBQUE7UUFDM0QsSUFBSSxDQUFDLGFBQWEsQ0FBQyxvQkFBb0IsQ0FBQyxDQUFBO0lBQzFDLENBQUM7SUFFRCx5QkFBeUI7SUFDekIsUUFBUSxLQUFLLE9BQU8sSUFBSSxDQUFDLE9BQU8sQ0FBQSxDQUFDLENBQUM7SUFFbEMseUJBQXlCO0lBQ3pCLE9BQU8sS0FBSyxPQUFPLElBQUksQ0FBQyxNQUFNLENBQUEsQ0FBQyxDQUFDO0lBRWhDLHlCQUF5QjtJQUN6QixZQUFZLEtBQUssT0FBTyxJQUFJLENBQUMsV0FBVyxJQUFJLENBQUMsSUFBSSxDQUFDLE9BQU8sQ0FBQSxDQUFDLENBQUM7Q0FDNUQiLCJzb3VyY2VzQ29udGVudCI6WyIvLyBAdHMtY2hlY2tcblxuLyoqXG4gKiBDbGllbnQtc2lkZSBoYW5kbGUgZm9yIGEgY2hhbm5lbCBzdWJzY3JpcHRpb24gb3BlbmVkIHZpYVxuICogYFZlbG9jaW91c1dlYnNvY2tldENsaWVudC5zdWJzY3JpYmVDaGFubmVsKClgLiBNaXJyb3JzIHRoZSBzZXJ2ZXInc1xuICogc3Vic2NyaXB0aW9uIGxpZmVjeWNsZSDigJQgYHN1YnNjcmliZWRgIChyZXNvbHZlcyBgcmVhZHlgKSAvIGBvbk1lc3NhZ2VgIC9cbiAqIGBvbkNsb3NlYC5cbiAqXG4gKiBTZWUgYGRvY3Mvd2Vic29ja2V0LWNoYW5uZWxzLm1kYCBmb3IgdGhlIHdpcmUgcHJvdG9jb2wuXG4gKi9cbmV4cG9ydCBkZWZhdWx0IGNsYXNzIFZlbG9jaW91c1dlYnNvY2tldENsaWVudFN1YnNjcmlwdGlvbiB7XG4gIC8qKlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJnc1xuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vd2Vic29ja2V0LWNsaWVudC5qc1wiKS5kZWZhdWx0fSBhcmdzLmNsaWVudFxuICAgKiBAcGFyYW0ge3N0cmluZ30gYXJncy5zdWJzY3JpcHRpb25JZFxuICAgKiBAcGFyYW0ge3N0cmluZ30gYXJncy5jaGFubmVsVHlwZVxuICAgKiBAcGFyYW0ge1JlY29yZDxzdHJpbmcsIGFueT59IFthcmdzLnBhcmFtc11cbiAgICogQHBhcmFtIHtzdHJpbmd9IFthcmdzLmxhc3RFdmVudElkXVxuICAgKiBAcGFyYW0geyhib2R5OiBhbnkpID0+IHZvaWR9IFthcmdzLm9uTWVzc2FnZV1cbiAgICogQHBhcmFtIHsoKSA9PiB2b2lkfSBbYXJncy5vbkRpc2Nvbm5lY3RdXG4gICAqIEBwYXJhbSB7KCkgPT4gdm9pZH0gW2FyZ3Mub25SZXN1bWVdXG4gICAqIEBwYXJhbSB7KHJlYXNvbjogc3RyaW5nKSA9PiB2b2lkfSBbYXJncy5vbkNsb3NlXVxuICAgKi9cbiAgY29uc3RydWN0b3Ioe2NsaWVudCwgc3Vic2NyaXB0aW9uSWQsIGNoYW5uZWxUeXBlLCBwYXJhbXMsIGxhc3RFdmVudElkLCBvbk1lc3NhZ2UsIG9uRGlzY29ubmVjdCwgb25SZXN1bWUsIG9uQ2xvc2V9KSB7XG4gICAgdGhpcy5jbGllbnQgPSBjbGllbnRcbiAgICB0aGlzLnN1YnNjcmlwdGlvbklkID0gc3Vic2NyaXB0aW9uSWRcbiAgICB0aGlzLmNoYW5uZWxUeXBlID0gY2hhbm5lbFR5cGVcbiAgICB0aGlzLnBhcmFtcyA9IHBhcmFtcyB8fCB7fVxuICAgIHRoaXMubGFzdEV2ZW50SWQgPSBsYXN0RXZlbnRJZFxuICAgIHRoaXMuX29uTWVzc2FnZSA9IG9uTWVzc2FnZVxuICAgIHRoaXMuX29uRGlzY29ubmVjdCA9IG9uRGlzY29ubmVjdFxuICAgIHRoaXMuX29uUmVzdW1lID0gb25SZXN1bWVcbiAgICB0aGlzLl9vbkNsb3NlID0gb25DbG9zZVxuICAgIHRoaXMuX3JlYWR5ID0gZmFsc2VcbiAgICB0aGlzLl9yZXN1bWVSZWFkeU9uUmVzdW1lID0gZmFsc2VcbiAgICB0aGlzLl9zdWJzY3JpYmVkID0gZmFsc2VcbiAgICB0aGlzLl9zdWJzY3JpYmVTZW50ID0gZmFsc2VcbiAgICB0aGlzLl9jbG9zZWQgPSBmYWxzZVxuXG4gICAgdGhpcy5fZW5zdXJlUmVhZHlQcm9taXNlKClcbiAgfVxuXG4gIC8qKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gKi9cbiAgX2Vuc3VyZVJlYWR5UHJvbWlzZSgpIHtcbiAgICBpZiAoIXRoaXMucmVhZHkgfHwgIXRoaXMuX3Jlc29sdmVSZWFkeSB8fCAhdGhpcy5fcmVqZWN0UmVhZHkpIHtcbiAgICAgIC8qKiBAdHlwZSB7UHJvbWlzZTx2b2lkPn0gKi9cbiAgICAgIHRoaXMucmVhZHkgPSBuZXcgUHJvbWlzZSgocmVzb2x2ZSwgcmVqZWN0KSA9PiB7XG4gICAgICAgIHRoaXMuX3Jlc29sdmVSZWFkeSA9IHJlc29sdmVcbiAgICAgICAgdGhpcy5fcmVqZWN0UmVhZHkgPSByZWplY3RcbiAgICAgIH0pXG4gICAgfVxuXG4gICAgcmV0dXJuIHRoaXMucmVhZHlcbiAgfVxuXG4gIC8qKiBAcmV0dXJucyB7dm9pZH0gKi9cbiAgX3Jlc29sdmVSZWFkeVN0YXRlKCkge1xuICAgIHRoaXMuX3JlYWR5ID0gdHJ1ZVxuICAgIHRoaXMuX3Jlc29sdmVSZWFkeT8uKClcbiAgICB0aGlzLl9yZXNvbHZlUmVhZHkgPSBudWxsXG4gICAgdGhpcy5fcmVqZWN0UmVhZHkgPSBudWxsXG4gIH1cblxuICAvKiogQHJldHVybnMge3ZvaWR9ICovXG4gIF9tYXJrTm90UmVhZHkoKSB7XG4gICAgdGhpcy5fcmVhZHkgPSBmYWxzZVxuICB9XG5cbiAgLyoqIEByZXR1cm5zIHt2b2lkfSAqL1xuICBfaGFuZGxlU3Vic2NyaWJlZCgpIHtcbiAgICBpZiAodGhpcy5fY2xvc2VkIHx8IHRoaXMuX3N1YnNjcmliZWQpIHJldHVyblxuICAgIHRoaXMuX3N1YnNjcmliZWQgPSB0cnVlXG4gICAgdGhpcy5fcmVzb2x2ZVJlYWR5U3RhdGUoKVxuICB9XG5cbiAgLyoqIEByZXR1cm5zIHt2b2lkfSAqL1xuICBfbWFya1N1YnNjcmliZVNlbnQoKSB7XG4gICAgdGhpcy5fc3Vic2NyaWJlU2VudCA9IHRydWVcbiAgfVxuXG4gIC8qKiBAcmV0dXJucyB7Ym9vbGVhbn0gKi9cbiAgX25lZWRzU3Vic2NyaWJlKCkge1xuICAgIHJldHVybiAhdGhpcy5fY2xvc2VkICYmICF0aGlzLl9zdWJzY3JpYmVTZW50XG4gIH1cblxuICAvKipcbiAgICogQHBhcmFtIHthbnl9IGJvZHlcbiAgICogQHJldHVybnMge3ZvaWR9XG4gICAqL1xuICBfaGFuZGxlTWVzc2FnZShib2R5KSB7XG4gICAgaWYgKHRoaXMuX2Nsb3NlZCkgcmV0dXJuXG4gICAgdGhpcy5fb25NZXNzYWdlPy4oYm9keSlcbiAgfVxuXG4gIC8qKiBAcmV0dXJucyB7dm9pZH0gKi9cbiAgX2hhbmRsZURpc2Nvbm5lY3RlZCgpIHtcbiAgICBpZiAodGhpcy5fY2xvc2VkKSByZXR1cm5cbiAgICB0aGlzLl9yZXN1bWVSZWFkeU9uUmVzdW1lIHx8PSB0aGlzLl9zdWJzY3JpYmVkXG4gICAgdGhpcy5fc3Vic2NyaWJlZCA9IGZhbHNlXG4gICAgdGhpcy5fbWFya05vdFJlYWR5KClcbiAgICB0aGlzLl9vbkRpc2Nvbm5lY3Q/LigpXG4gIH1cblxuICAvKiogQHJldHVybnMge3ZvaWR9ICovXG4gIF9oYW5kbGVSZXN1bWVkKCkge1xuICAgIGlmICh0aGlzLl9jbG9zZWQpIHJldHVyblxuICAgIGlmICh0aGlzLl9yZXN1bWVSZWFkeU9uUmVzdW1lKSB7XG4gICAgICB0aGlzLl9zdWJzY3JpYmVkID0gdHJ1ZVxuICAgICAgdGhpcy5fcmVzb2x2ZVJlYWR5U3RhdGUoKVxuICAgIH1cbiAgICB0aGlzLl9yZXN1bWVSZWFkeU9uUmVzdW1lID0gZmFsc2VcbiAgICB0aGlzLl9vblJlc3VtZT8uKClcbiAgfVxuXG4gIC8qKlxuICAgKiBAcGFyYW0ge3N0cmluZ30gcmVhc29uXG4gICAqIEByZXR1cm5zIHt2b2lkfVxuICAgKi9cbiAgX2hhbmRsZUNsb3NlZChyZWFzb24pIHtcbiAgICBpZiAodGhpcy5fY2xvc2VkKSByZXR1cm5cbiAgICB0aGlzLl9jbG9zZWQgPSB0cnVlXG5cbiAgICB0cnkge1xuICAgICAgdGhpcy5fb25DbG9zZT8uKHJlYXNvbilcbiAgICB9IGZpbmFsbHkge1xuICAgICAgdGhpcy5fcmVzdW1lUmVhZHlPblJlc3VtZSA9IGZhbHNlXG4gICAgICBpZiAoIXRoaXMuX3JlYWR5KSB7XG4gICAgICAgIHRoaXMuX3JlamVjdFJlYWR5Py4obmV3IEVycm9yKGBTdWJzY3JpcHRpb24gY2xvc2VkIGJlZm9yZSBhY2tub3dsZWRnZW1lbnQ6ICR7cmVhc29ufWApKVxuICAgICAgfVxuXG4gICAgICB0aGlzLl9yZXNvbHZlUmVhZHkgPSBudWxsXG4gICAgICB0aGlzLl9yZWplY3RSZWFkeSA9IG51bGxcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogQHBhcmFtIHt7dGltZW91dE1zPzogbnVtYmVyfX0gW3BhcmFtc11cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59XG4gICAqL1xuICBhc3luYyB3YWl0Rm9yUmVhZHkoe3RpbWVvdXRNcyA9IDUwMDB9ID0ge30pIHtcbiAgICBpZiAodGhpcy5fcmVhZHkpIHJldHVyblxuXG4gICAgY29uc3QgcmVhZHlQcm9taXNlID0gdGhpcy5fZW5zdXJlUmVhZHlQcm9taXNlKClcbiAgICBjb25zdCB0aW1lb3V0UHJvbWlzZSA9IG5ldyBQcm9taXNlKChfLCByZWplY3QpID0+IHtcbiAgICAgIHNldFRpbWVvdXQoKCkgPT4gcmVqZWN0KG5ldyBFcnJvcihgU3Vic2NyaXB0aW9uIG5vdCByZWFkeSBhZnRlciAke3RpbWVvdXRNc31tc2ApKSwgdGltZW91dE1zKVxuICAgIH0pXG5cbiAgICBhd2FpdCBQcm9taXNlLnJhY2UoW3JlYWR5UHJvbWlzZSwgdGltZW91dFByb21pc2VdKVxuICB9XG5cbiAgLyoqIEByZXR1cm5zIHt2b2lkfSAqL1xuICBjbG9zZSgpIHtcbiAgICBpZiAodGhpcy5fY2xvc2VkKSByZXR1cm5cblxuICAgIHRyeSB7XG4gICAgICBpZiAodGhpcy5jbGllbnQuaXNPcGVuKCkpIHtcbiAgICAgICAgdGhpcy5jbGllbnQuX3NlbmRNZXNzYWdlKHt0eXBlOiBcImNoYW5uZWwtdW5zdWJzY3JpYmVcIiwgc3Vic2NyaXB0aW9uSWQ6IHRoaXMuc3Vic2NyaXB0aW9uSWR9KVxuICAgICAgfVxuICAgIH0gY2F0Y2gge1xuICAgICAgLy8gU29ja2V0IGFscmVhZHkgZ29uZTsgc2VydmVyIHdpbGwgY2xlYW4gdXAgb24gc2Vzc2lvbiB0ZWFyZG93bi5cbiAgICB9XG5cbiAgICB0aGlzLmNsaWVudC5fcmVtb3ZlQ2hhbm5lbFN1YnNjcmlwdGlvbih0aGlzLnN1YnNjcmlwdGlvbklkKVxuICAgIHRoaXMuX2hhbmRsZUNsb3NlZChcImNsaWVudF91bnN1YnNjcmliZVwiKVxuICB9XG5cbiAgLyoqIEByZXR1cm5zIHtib29sZWFufSAqL1xuICBpc0Nsb3NlZCgpIHsgcmV0dXJuIHRoaXMuX2Nsb3NlZCB9XG5cbiAgLyoqIEByZXR1cm5zIHtib29sZWFufSAqL1xuICBpc1JlYWR5KCkgeyByZXR1cm4gdGhpcy5fcmVhZHkgfVxuXG4gIC8qKiBAcmV0dXJucyB7Ym9vbGVhbn0gKi9cbiAgaXNTdWJzY3JpYmVkKCkgeyByZXR1cm4gdGhpcy5fc3Vic2NyaWJlZCAmJiAhdGhpcy5fY2xvc2VkIH1cbn1cbiJdfQ==
