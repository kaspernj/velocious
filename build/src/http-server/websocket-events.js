// @ts-check
export default class VelociousHttpServerWebsocketEvents {
    /**
     * Runs constructor.
     * @param {object} args - Options object.
     * @param {import("node:worker_threads").MessagePort | null} args.parentPort - Parent port.
     * @param {number} args.workerCount - Worker count.
     */
    constructor({ parentPort, workerCount }) {
        this.parentPort = parentPort;
        this.workerCount = workerCount;
    }
    /**
     * Runs publish.
     * @param {string} channel - Channel name.
     * @param {ReturnType<typeof JSON.parse>} payload - Payload data.
     * @returns {void} - No return value.
     */
    publish(channel, payload) {
        if (!channel)
            throw new Error("channel is required");
        if (!this.parentPort)
            throw new Error("parentPort is required");
        this.parentPort.postMessage({ channel, command: "websocketPublish", payload, workerCount: this.workerCount });
    }
    /**
     * Fan-out entry point for `configuration.broadcastToChannel` on V2
     * channels. The worker posts to the main process, which fans out to
     * every worker so subscribers on any worker receive the broadcast.
     * @param {object} args - Options object.
     * @param {string} args.channel - Channel name.
     * @param {Record<string, ReturnType<typeof JSON.parse>>} args.broadcastParams - Filter params forwarded to `matches()`.
     * @param {ReturnType<typeof JSON.parse>} args.body - Message body delivered via `sendMessage()`.
     * @returns {void}
     */
    publishV2Broadcast({ channel, broadcastParams, body }) {
        if (!channel)
            throw new Error("channel is required");
        if (!this.parentPort)
            throw new Error("parentPort is required");
        this.parentPort.postMessage({
            body,
            broadcastParams,
            channel,
            command: "websocketV2Broadcast",
            workerCount: this.workerCount
        });
    }
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoid2Vic29ja2V0LWV2ZW50cy5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uLy4uLy4uL3NyYy9odHRwLXNlcnZlci93ZWJzb2NrZXQtZXZlbnRzLmpzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiJBQUFBLFlBQVk7QUFFWixNQUFNLENBQUMsT0FBTyxPQUFPLGtDQUFrQztJQUNyRDs7Ozs7T0FLRztJQUNILFlBQVksRUFBQyxVQUFVLEVBQUUsV0FBVyxFQUFDO1FBQ25DLElBQUksQ0FBQyxVQUFVLEdBQUcsVUFBVSxDQUFBO1FBQzVCLElBQUksQ0FBQyxXQUFXLEdBQUcsV0FBVyxDQUFBO0lBQ2hDLENBQUM7SUFFRDs7Ozs7T0FLRztJQUNILE9BQU8sQ0FBQyxPQUFPLEVBQUUsT0FBTztRQUN0QixJQUFJLENBQUMsT0FBTztZQUFFLE1BQU0sSUFBSSxLQUFLLENBQUMscUJBQXFCLENBQUMsQ0FBQTtRQUNwRCxJQUFJLENBQUMsSUFBSSxDQUFDLFVBQVU7WUFBRSxNQUFNLElBQUksS0FBSyxDQUFDLHdCQUF3QixDQUFDLENBQUE7UUFFL0QsSUFBSSxDQUFDLFVBQVUsQ0FBQyxXQUFXLENBQUMsRUFBQyxPQUFPLEVBQUUsT0FBTyxFQUFFLGtCQUFrQixFQUFFLE9BQU8sRUFBRSxXQUFXLEVBQUUsSUFBSSxDQUFDLFdBQVcsRUFBQyxDQUFDLENBQUE7SUFDN0csQ0FBQztJQUVEOzs7Ozs7Ozs7T0FTRztJQUNILGtCQUFrQixDQUFDLEVBQUMsT0FBTyxFQUFFLGVBQWUsRUFBRSxJQUFJLEVBQUM7UUFDakQsSUFBSSxDQUFDLE9BQU87WUFBRSxNQUFNLElBQUksS0FBSyxDQUFDLHFCQUFxQixDQUFDLENBQUE7UUFDcEQsSUFBSSxDQUFDLElBQUksQ0FBQyxVQUFVO1lBQUUsTUFBTSxJQUFJLEtBQUssQ0FBQyx3QkFBd0IsQ0FBQyxDQUFBO1FBRS9ELElBQUksQ0FBQyxVQUFVLENBQUMsV0FBVyxDQUFDO1lBQzFCLElBQUk7WUFDSixlQUFlO1lBQ2YsT0FBTztZQUNQLE9BQU8sRUFBRSxzQkFBc0I7WUFDL0IsV0FBVyxFQUFFLElBQUksQ0FBQyxXQUFXO1NBQzlCLENBQUMsQ0FBQTtJQUNKLENBQUM7Q0FDRiIsInNvdXJjZXNDb250ZW50IjpbIi8vIEB0cy1jaGVja1xuXG5leHBvcnQgZGVmYXVsdCBjbGFzcyBWZWxvY2lvdXNIdHRwU2VydmVyV2Vic29ja2V0RXZlbnRzIHtcbiAgLyoqXG4gICAqIFJ1bnMgY29uc3RydWN0b3IuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gT3B0aW9ucyBvYmplY3QuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwibm9kZTp3b3JrZXJfdGhyZWFkc1wiKS5NZXNzYWdlUG9ydCB8IG51bGx9IGFyZ3MucGFyZW50UG9ydCAtIFBhcmVudCBwb3J0LlxuICAgKiBAcGFyYW0ge251bWJlcn0gYXJncy53b3JrZXJDb3VudCAtIFdvcmtlciBjb3VudC5cbiAgICovXG4gIGNvbnN0cnVjdG9yKHtwYXJlbnRQb3J0LCB3b3JrZXJDb3VudH0pIHtcbiAgICB0aGlzLnBhcmVudFBvcnQgPSBwYXJlbnRQb3J0XG4gICAgdGhpcy53b3JrZXJDb3VudCA9IHdvcmtlckNvdW50XG4gIH1cblxuICAvKipcbiAgICogUnVucyBwdWJsaXNoLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gY2hhbm5lbCAtIENoYW5uZWwgbmFtZS5cbiAgICogQHBhcmFtIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gcGF5bG9hZCAtIFBheWxvYWQgZGF0YS5cbiAgICogQHJldHVybnMge3ZvaWR9IC0gTm8gcmV0dXJuIHZhbHVlLlxuICAgKi9cbiAgcHVibGlzaChjaGFubmVsLCBwYXlsb2FkKSB7XG4gICAgaWYgKCFjaGFubmVsKSB0aHJvdyBuZXcgRXJyb3IoXCJjaGFubmVsIGlzIHJlcXVpcmVkXCIpXG4gICAgaWYgKCF0aGlzLnBhcmVudFBvcnQpIHRocm93IG5ldyBFcnJvcihcInBhcmVudFBvcnQgaXMgcmVxdWlyZWRcIilcblxuICAgIHRoaXMucGFyZW50UG9ydC5wb3N0TWVzc2FnZSh7Y2hhbm5lbCwgY29tbWFuZDogXCJ3ZWJzb2NrZXRQdWJsaXNoXCIsIHBheWxvYWQsIHdvcmtlckNvdW50OiB0aGlzLndvcmtlckNvdW50fSlcbiAgfVxuXG4gIC8qKlxuICAgKiBGYW4tb3V0IGVudHJ5IHBvaW50IGZvciBgY29uZmlndXJhdGlvbi5icm9hZGNhc3RUb0NoYW5uZWxgIG9uIFYyXG4gICAqIGNoYW5uZWxzLiBUaGUgd29ya2VyIHBvc3RzIHRvIHRoZSBtYWluIHByb2Nlc3MsIHdoaWNoIGZhbnMgb3V0IHRvXG4gICAqIGV2ZXJ5IHdvcmtlciBzbyBzdWJzY3JpYmVycyBvbiBhbnkgd29ya2VyIHJlY2VpdmUgdGhlIGJyb2FkY2FzdC5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBPcHRpb25zIG9iamVjdC5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGFyZ3MuY2hhbm5lbCAtIENoYW5uZWwgbmFtZS5cbiAgICogQHBhcmFtIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59IGFyZ3MuYnJvYWRjYXN0UGFyYW1zIC0gRmlsdGVyIHBhcmFtcyBmb3J3YXJkZWQgdG8gYG1hdGNoZXMoKWAuXG4gICAqIEBwYXJhbSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59IGFyZ3MuYm9keSAtIE1lc3NhZ2UgYm9keSBkZWxpdmVyZWQgdmlhIGBzZW5kTWVzc2FnZSgpYC5cbiAgICogQHJldHVybnMge3ZvaWR9XG4gICAqL1xuICBwdWJsaXNoVjJCcm9hZGNhc3Qoe2NoYW5uZWwsIGJyb2FkY2FzdFBhcmFtcywgYm9keX0pIHtcbiAgICBpZiAoIWNoYW5uZWwpIHRocm93IG5ldyBFcnJvcihcImNoYW5uZWwgaXMgcmVxdWlyZWRcIilcbiAgICBpZiAoIXRoaXMucGFyZW50UG9ydCkgdGhyb3cgbmV3IEVycm9yKFwicGFyZW50UG9ydCBpcyByZXF1aXJlZFwiKVxuXG4gICAgdGhpcy5wYXJlbnRQb3J0LnBvc3RNZXNzYWdlKHtcbiAgICAgIGJvZHksXG4gICAgICBicm9hZGNhc3RQYXJhbXMsXG4gICAgICBjaGFubmVsLFxuICAgICAgY29tbWFuZDogXCJ3ZWJzb2NrZXRWMkJyb2FkY2FzdFwiLFxuICAgICAgd29ya2VyQ291bnQ6IHRoaXMud29ya2VyQ291bnRcbiAgICB9KVxuICB9XG59XG4iXX0=