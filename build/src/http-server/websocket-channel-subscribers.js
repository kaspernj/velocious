// @ts-check
/**
 * Per-process registry of channel subscribers used by worker code that
 * needs to react to events broadcast via `websocketEventsHost.publish(...)`
 * without holding an actual websocket session.
 *
 * Each Velocious worker thread (and the in-process handler used in tests)
 * gets its own instance attached to the configuration via
 * `setWebsocketChannelSubscribers(...)`.
 */
export default class VelociousWebsocketChannelSubscribers {
    constructor() {
        /**
         * Narrows the runtime value to the documented type.
         * @type {Map<string, Set<(payload: ReturnType<typeof JSON.parse>, meta: {channel: string, createdAt?: string, eventId?: string}) => void | Promise<void>>>} */
        this._subscribers = new Map();
    }
    /**
     * Runs subscribe.
     * @param {string} channel - Channel name to subscribe to.
     * @param {(payload: ReturnType<typeof JSON.parse>, meta: {channel: string, createdAt?: string, eventId?: string}) => void | Promise<void>} callback - Callback invoked for each event on the channel.
     * @returns {() => void} - Unsubscribe function.
     */
    subscribe(channel, callback) {
        if (!channel)
            throw new Error("channel is required");
        if (typeof callback !== "function")
            throw new Error("callback must be a function");
        let set = this._subscribers.get(channel);
        if (!set) {
            set = new Set();
            this._subscribers.set(channel, set);
        }
        set.add(callback);
        return () => this.unsubscribe(channel, callback);
    }
    /**
     * Runs unsubscribe.
     * @param {string} channel - Channel name.
     * @param {(payload: ReturnType<typeof JSON.parse>, meta: {channel: string, createdAt?: string, eventId?: string}) => void | Promise<void>} callback - Previously registered callback.
     * @returns {void}
     */
    unsubscribe(channel, callback) {
        const set = this._subscribers.get(channel);
        if (!set)
            return;
        set.delete(callback);
        if (set.size === 0) {
            this._subscribers.delete(channel);
        }
    }
    /**
     * Runs has subscribers.
     * @param {string} channel - Channel name.
     * @returns {boolean} - Whether any subscribers exist for the channel.
     */
    hasSubscribers(channel) {
        const set = this._subscribers.get(channel);
        return Boolean(set && set.size > 0);
    }
    /**
     * Dispatch an event to all subscribers of the channel.
     * @param {object} args - Event args.
     * @param {string} args.channel - Channel name.
     * @param {ReturnType<typeof JSON.parse>} args.payload - Event payload.
     * @param {string} [args.createdAt] - Event creation time.
     * @param {string} [args.eventId] - Event identifier.
     * @returns {Promise<void>} - Resolves when all subscribers have completed.
     */
    async dispatch({ channel, payload, createdAt, eventId }) {
        const set = this._subscribers.get(channel);
        if (!set || set.size === 0)
            return;
        // Snapshot the subscribers so callbacks that unsubscribe (themselves or
        // others) during dispatch do not skip later deliveries for this event.
        const callbacks = Array.from(set);
        const meta = { channel, createdAt, eventId };
        const tasks = [];
        for (const callback of callbacks) {
            try {
                const result = callback(payload, meta);
                if (result && typeof /** @type {Promise<void>} */ (result).then === "function") {
                    tasks.push(/** @type {Promise<void>} */ (result));
                }
            }
            catch (error) {
                // Don't let one subscriber's failure abort the others; surface via the returned promises instead.
                tasks.push(Promise.reject(error));
            }
        }
        await Promise.all(tasks);
    }
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoid2Vic29ja2V0LWNoYW5uZWwtc3Vic2NyaWJlcnMuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi9zcmMvaHR0cC1zZXJ2ZXIvd2Vic29ja2V0LWNoYW5uZWwtc3Vic2NyaWJlcnMuanMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6IkFBQUEsWUFBWTtBQUVaOzs7Ozs7OztHQVFHO0FBQ0gsTUFBTSxDQUFDLE9BQU8sT0FBTyxvQ0FBb0M7SUFDdkQ7UUFDRTs7dUtBRStKO1FBQy9KLElBQUksQ0FBQyxZQUFZLEdBQUcsSUFBSSxHQUFHLEVBQUUsQ0FBQTtJQUMvQixDQUFDO0lBRUQ7Ozs7O09BS0c7SUFDSCxTQUFTLENBQUMsT0FBTyxFQUFFLFFBQVE7UUFDekIsSUFBSSxDQUFDLE9BQU87WUFBRSxNQUFNLElBQUksS0FBSyxDQUFDLHFCQUFxQixDQUFDLENBQUE7UUFDcEQsSUFBSSxPQUFPLFFBQVEsS0FBSyxVQUFVO1lBQUUsTUFBTSxJQUFJLEtBQUssQ0FBQyw2QkFBNkIsQ0FBQyxDQUFBO1FBRWxGLElBQUksR0FBRyxHQUFHLElBQUksQ0FBQyxZQUFZLENBQUMsR0FBRyxDQUFDLE9BQU8sQ0FBQyxDQUFBO1FBRXhDLElBQUksQ0FBQyxHQUFHLEVBQUUsQ0FBQztZQUNULEdBQUcsR0FBRyxJQUFJLEdBQUcsRUFBRSxDQUFBO1lBQ2YsSUFBSSxDQUFDLFlBQVksQ0FBQyxHQUFHLENBQUMsT0FBTyxFQUFFLEdBQUcsQ0FBQyxDQUFBO1FBQ3JDLENBQUM7UUFFRCxHQUFHLENBQUMsR0FBRyxDQUFDLFFBQVEsQ0FBQyxDQUFBO1FBRWpCLE9BQU8sR0FBRyxFQUFFLENBQUMsSUFBSSxDQUFDLFdBQVcsQ0FBQyxPQUFPLEVBQUUsUUFBUSxDQUFDLENBQUE7SUFDbEQsQ0FBQztJQUVEOzs7OztPQUtHO0lBQ0gsV0FBVyxDQUFDLE9BQU8sRUFBRSxRQUFRO1FBQzNCLE1BQU0sR0FBRyxHQUFHLElBQUksQ0FBQyxZQUFZLENBQUMsR0FBRyxDQUFDLE9BQU8sQ0FBQyxDQUFBO1FBRTFDLElBQUksQ0FBQyxHQUFHO1lBQUUsT0FBTTtRQUVoQixHQUFHLENBQUMsTUFBTSxDQUFDLFFBQVEsQ0FBQyxDQUFBO1FBRXBCLElBQUksR0FBRyxDQUFDLElBQUksS0FBSyxDQUFDLEVBQUUsQ0FBQztZQUNuQixJQUFJLENBQUMsWUFBWSxDQUFDLE1BQU0sQ0FBQyxPQUFPLENBQUMsQ0FBQTtRQUNuQyxDQUFDO0lBQ0gsQ0FBQztJQUVEOzs7O09BSUc7SUFDSCxjQUFjLENBQUMsT0FBTztRQUNwQixNQUFNLEdBQUcsR0FBRyxJQUFJLENBQUMsWUFBWSxDQUFDLEdBQUcsQ0FBQyxPQUFPLENBQUMsQ0FBQTtRQUUxQyxPQUFPLE9BQU8sQ0FBQyxHQUFHLElBQUksR0FBRyxDQUFDLElBQUksR0FBRyxDQUFDLENBQUMsQ0FBQTtJQUNyQyxDQUFDO0lBRUQ7Ozs7Ozs7O09BUUc7SUFDSCxLQUFLLENBQUMsUUFBUSxDQUFDLEVBQUMsT0FBTyxFQUFFLE9BQU8sRUFBRSxTQUFTLEVBQUUsT0FBTyxFQUFDO1FBQ25ELE1BQU0sR0FBRyxHQUFHLElBQUksQ0FBQyxZQUFZLENBQUMsR0FBRyxDQUFDLE9BQU8sQ0FBQyxDQUFBO1FBRTFDLElBQUksQ0FBQyxHQUFHLElBQUksR0FBRyxDQUFDLElBQUksS0FBSyxDQUFDO1lBQUUsT0FBTTtRQUVsQyx3RUFBd0U7UUFDeEUsdUVBQXVFO1FBQ3ZFLE1BQU0sU0FBUyxHQUFHLEtBQUssQ0FBQyxJQUFJLENBQUMsR0FBRyxDQUFDLENBQUE7UUFDakMsTUFBTSxJQUFJLEdBQUcsRUFBQyxPQUFPLEVBQUUsU0FBUyxFQUFFLE9BQU8sRUFBQyxDQUFBO1FBQzFDLE1BQU0sS0FBSyxHQUFHLEVBQUUsQ0FBQTtRQUVoQixLQUFLLE1BQU0sUUFBUSxJQUFJLFNBQVMsRUFBRSxDQUFDO1lBQ2pDLElBQUksQ0FBQztnQkFDSCxNQUFNLE1BQU0sR0FBRyxRQUFRLENBQUMsT0FBTyxFQUFFLElBQUksQ0FBQyxDQUFBO2dCQUV0QyxJQUFJLE1BQU0sSUFBSSxPQUFRLDRCQUE0QixDQUFDLENBQUMsTUFBTSxDQUFFLENBQUMsSUFBSSxLQUFLLFVBQVUsRUFBRSxDQUFDO29CQUNqRixLQUFLLENBQUMsSUFBSSxDQUFDLDRCQUE0QixDQUFDLENBQUMsTUFBTSxDQUFDLENBQUMsQ0FBQTtnQkFDbkQsQ0FBQztZQUNILENBQUM7WUFBQyxPQUFPLEtBQUssRUFBRSxDQUFDO2dCQUNmLGtHQUFrRztnQkFDbEcsS0FBSyxDQUFDLElBQUksQ0FBQyxPQUFPLENBQUMsTUFBTSxDQUFDLEtBQUssQ0FBQyxDQUFDLENBQUE7WUFDbkMsQ0FBQztRQUNILENBQUM7UUFFRCxNQUFNLE9BQU8sQ0FBQyxHQUFHLENBQUMsS0FBSyxDQUFDLENBQUE7SUFDMUIsQ0FBQztDQUNGIiwic291cmNlc0NvbnRlbnQiOlsiLy8gQHRzLWNoZWNrXG5cbi8qKlxuICogUGVyLXByb2Nlc3MgcmVnaXN0cnkgb2YgY2hhbm5lbCBzdWJzY3JpYmVycyB1c2VkIGJ5IHdvcmtlciBjb2RlIHRoYXRcbiAqIG5lZWRzIHRvIHJlYWN0IHRvIGV2ZW50cyBicm9hZGNhc3QgdmlhIGB3ZWJzb2NrZXRFdmVudHNIb3N0LnB1Ymxpc2goLi4uKWBcbiAqIHdpdGhvdXQgaG9sZGluZyBhbiBhY3R1YWwgd2Vic29ja2V0IHNlc3Npb24uXG4gKlxuICogRWFjaCBWZWxvY2lvdXMgd29ya2VyIHRocmVhZCAoYW5kIHRoZSBpbi1wcm9jZXNzIGhhbmRsZXIgdXNlZCBpbiB0ZXN0cylcbiAqIGdldHMgaXRzIG93biBpbnN0YW5jZSBhdHRhY2hlZCB0byB0aGUgY29uZmlndXJhdGlvbiB2aWFcbiAqIGBzZXRXZWJzb2NrZXRDaGFubmVsU3Vic2NyaWJlcnMoLi4uKWAuXG4gKi9cbmV4cG9ydCBkZWZhdWx0IGNsYXNzIFZlbG9jaW91c1dlYnNvY2tldENoYW5uZWxTdWJzY3JpYmVycyB7XG4gIGNvbnN0cnVjdG9yKCkge1xuICAgIC8qKlxuICAgICAqIE5hcnJvd3MgdGhlIHJ1bnRpbWUgdmFsdWUgdG8gdGhlIGRvY3VtZW50ZWQgdHlwZS5cbiAgICAgKiBAdHlwZSB7TWFwPHN0cmluZywgU2V0PChwYXlsb2FkOiBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPiwgbWV0YToge2NoYW5uZWw6IHN0cmluZywgY3JlYXRlZEF0Pzogc3RyaW5nLCBldmVudElkPzogc3RyaW5nfSkgPT4gdm9pZCB8IFByb21pc2U8dm9pZD4+Pn0gKi9cbiAgICB0aGlzLl9zdWJzY3JpYmVycyA9IG5ldyBNYXAoKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgc3Vic2NyaWJlLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gY2hhbm5lbCAtIENoYW5uZWwgbmFtZSB0byBzdWJzY3JpYmUgdG8uXG4gICAqIEBwYXJhbSB7KHBheWxvYWQ6IFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+LCBtZXRhOiB7Y2hhbm5lbDogc3RyaW5nLCBjcmVhdGVkQXQ/OiBzdHJpbmcsIGV2ZW50SWQ/OiBzdHJpbmd9KSA9PiB2b2lkIHwgUHJvbWlzZTx2b2lkPn0gY2FsbGJhY2sgLSBDYWxsYmFjayBpbnZva2VkIGZvciBlYWNoIGV2ZW50IG9uIHRoZSBjaGFubmVsLlxuICAgKiBAcmV0dXJucyB7KCkgPT4gdm9pZH0gLSBVbnN1YnNjcmliZSBmdW5jdGlvbi5cbiAgICovXG4gIHN1YnNjcmliZShjaGFubmVsLCBjYWxsYmFjaykge1xuICAgIGlmICghY2hhbm5lbCkgdGhyb3cgbmV3IEVycm9yKFwiY2hhbm5lbCBpcyByZXF1aXJlZFwiKVxuICAgIGlmICh0eXBlb2YgY2FsbGJhY2sgIT09IFwiZnVuY3Rpb25cIikgdGhyb3cgbmV3IEVycm9yKFwiY2FsbGJhY2sgbXVzdCBiZSBhIGZ1bmN0aW9uXCIpXG5cbiAgICBsZXQgc2V0ID0gdGhpcy5fc3Vic2NyaWJlcnMuZ2V0KGNoYW5uZWwpXG5cbiAgICBpZiAoIXNldCkge1xuICAgICAgc2V0ID0gbmV3IFNldCgpXG4gICAgICB0aGlzLl9zdWJzY3JpYmVycy5zZXQoY2hhbm5lbCwgc2V0KVxuICAgIH1cblxuICAgIHNldC5hZGQoY2FsbGJhY2spXG5cbiAgICByZXR1cm4gKCkgPT4gdGhpcy51bnN1YnNjcmliZShjaGFubmVsLCBjYWxsYmFjaylcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHVuc3Vic2NyaWJlLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gY2hhbm5lbCAtIENoYW5uZWwgbmFtZS5cbiAgICogQHBhcmFtIHsocGF5bG9hZDogUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4sIG1ldGE6IHtjaGFubmVsOiBzdHJpbmcsIGNyZWF0ZWRBdD86IHN0cmluZywgZXZlbnRJZD86IHN0cmluZ30pID0+IHZvaWQgfCBQcm9taXNlPHZvaWQ+fSBjYWxsYmFjayAtIFByZXZpb3VzbHkgcmVnaXN0ZXJlZCBjYWxsYmFjay5cbiAgICogQHJldHVybnMge3ZvaWR9XG4gICAqL1xuICB1bnN1YnNjcmliZShjaGFubmVsLCBjYWxsYmFjaykge1xuICAgIGNvbnN0IHNldCA9IHRoaXMuX3N1YnNjcmliZXJzLmdldChjaGFubmVsKVxuXG4gICAgaWYgKCFzZXQpIHJldHVyblxuXG4gICAgc2V0LmRlbGV0ZShjYWxsYmFjaylcblxuICAgIGlmIChzZXQuc2l6ZSA9PT0gMCkge1xuICAgICAgdGhpcy5fc3Vic2NyaWJlcnMuZGVsZXRlKGNoYW5uZWwpXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgaGFzIHN1YnNjcmliZXJzLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gY2hhbm5lbCAtIENoYW5uZWwgbmFtZS5cbiAgICogQHJldHVybnMge2Jvb2xlYW59IC0gV2hldGhlciBhbnkgc3Vic2NyaWJlcnMgZXhpc3QgZm9yIHRoZSBjaGFubmVsLlxuICAgKi9cbiAgaGFzU3Vic2NyaWJlcnMoY2hhbm5lbCkge1xuICAgIGNvbnN0IHNldCA9IHRoaXMuX3N1YnNjcmliZXJzLmdldChjaGFubmVsKVxuXG4gICAgcmV0dXJuIEJvb2xlYW4oc2V0ICYmIHNldC5zaXplID4gMClcbiAgfVxuXG4gIC8qKlxuICAgKiBEaXNwYXRjaCBhbiBldmVudCB0byBhbGwgc3Vic2NyaWJlcnMgb2YgdGhlIGNoYW5uZWwuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gRXZlbnQgYXJncy5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGFyZ3MuY2hhbm5lbCAtIENoYW5uZWwgbmFtZS5cbiAgICogQHBhcmFtIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gYXJncy5wYXlsb2FkIC0gRXZlbnQgcGF5bG9hZC5cbiAgICogQHBhcmFtIHtzdHJpbmd9IFthcmdzLmNyZWF0ZWRBdF0gLSBFdmVudCBjcmVhdGlvbiB0aW1lLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gW2FyZ3MuZXZlbnRJZF0gLSBFdmVudCBpZGVudGlmaWVyLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyB3aGVuIGFsbCBzdWJzY3JpYmVycyBoYXZlIGNvbXBsZXRlZC5cbiAgICovXG4gIGFzeW5jIGRpc3BhdGNoKHtjaGFubmVsLCBwYXlsb2FkLCBjcmVhdGVkQXQsIGV2ZW50SWR9KSB7XG4gICAgY29uc3Qgc2V0ID0gdGhpcy5fc3Vic2NyaWJlcnMuZ2V0KGNoYW5uZWwpXG5cbiAgICBpZiAoIXNldCB8fCBzZXQuc2l6ZSA9PT0gMCkgcmV0dXJuXG5cbiAgICAvLyBTbmFwc2hvdCB0aGUgc3Vic2NyaWJlcnMgc28gY2FsbGJhY2tzIHRoYXQgdW5zdWJzY3JpYmUgKHRoZW1zZWx2ZXMgb3JcbiAgICAvLyBvdGhlcnMpIGR1cmluZyBkaXNwYXRjaCBkbyBub3Qgc2tpcCBsYXRlciBkZWxpdmVyaWVzIGZvciB0aGlzIGV2ZW50LlxuICAgIGNvbnN0IGNhbGxiYWNrcyA9IEFycmF5LmZyb20oc2V0KVxuICAgIGNvbnN0IG1ldGEgPSB7Y2hhbm5lbCwgY3JlYXRlZEF0LCBldmVudElkfVxuICAgIGNvbnN0IHRhc2tzID0gW11cblxuICAgIGZvciAoY29uc3QgY2FsbGJhY2sgb2YgY2FsbGJhY2tzKSB7XG4gICAgICB0cnkge1xuICAgICAgICBjb25zdCByZXN1bHQgPSBjYWxsYmFjayhwYXlsb2FkLCBtZXRhKVxuXG4gICAgICAgIGlmIChyZXN1bHQgJiYgdHlwZW9mICgvKiogQHR5cGUge1Byb21pc2U8dm9pZD59ICovIChyZXN1bHQpKS50aGVuID09PSBcImZ1bmN0aW9uXCIpIHtcbiAgICAgICAgICB0YXNrcy5wdXNoKC8qKiBAdHlwZSB7UHJvbWlzZTx2b2lkPn0gKi8gKHJlc3VsdCkpXG4gICAgICAgIH1cbiAgICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICAgIC8vIERvbid0IGxldCBvbmUgc3Vic2NyaWJlcidzIGZhaWx1cmUgYWJvcnQgdGhlIG90aGVyczsgc3VyZmFjZSB2aWEgdGhlIHJldHVybmVkIHByb21pc2VzIGluc3RlYWQuXG4gICAgICAgIHRhc2tzLnB1c2goUHJvbWlzZS5yZWplY3QoZXJyb3IpKVxuICAgICAgfVxuICAgIH1cblxuICAgIGF3YWl0IFByb21pc2UuYWxsKHRhc2tzKVxuICB9XG59XG4iXX0=