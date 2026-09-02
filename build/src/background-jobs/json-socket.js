// @ts-check
import EventEmitter from "../utils/event-emitter.js";
export default class JsonSocket extends EventEmitter {
    /**
     * Runs constructor.
     * @param {import("net").Socket} socket - Socket instance.
     */
    constructor(socket) {
        super();
        this.socket = socket;
        /**
         * Narrows the runtime value to the documented type.
         * @type {string | undefined} */
        this.workerId = undefined;
        /**
         * Narrows the runtime value to the documented type.
         * @type {boolean} */
        this.supportsHandoffIdReporting = false;
        /**
         * Narrows the runtime value to the documented type.
         * @type {boolean} */
        this.acceptsSpawnedJobs = true;
        /**
         * Narrows the runtime value to the documented type.
         * @type {boolean} */
        this.acceptsForkedJobs = true;
        /** @type {boolean} */
        this.acceptsPooledJobs = false;
        /** Number of pooled handoffs this readiness advertisement can accept. */
        this.availablePooledSlots = 0;
        /** Whether the worker/main pair uses consumable pooled-capacity credits. */
        this.usesPooledCapacityCredits = false;
        /** Whether this worker has permanently stopped accepting new handoffs. */
        this.isDraining = false;
        /** Monotonic generation of the worker's latest readiness advertisement. */
        this.readinessVersion = 0;
        /**
         * Narrows the runtime value to the documented type.
         * @type {boolean} */
        this.acceptsInlineJobs = true;
        /**
         * Whether this worker advertised heartbeat support in its hello. Only
         * heartbeat-capable workers are subject to the main's stale-liveness
         * eviction; a legacy worker (e.g. mid rolling deploy) is exempt so its
         * active leases are not released while it is still running them.
         * @type {boolean} */
        this.supportsHeartbeat = false;
        /**
         * Last time (ms) the main saw any message from this worker socket; used by
         * the main's liveness sweep to drop a wedged/silent worker.
         * @type {number | undefined} */
        this.lastSeenAt = undefined;
        /**
         * Internal test-only observability counter — NOT public API. Number of times
         * `destroy()` has run, incremented immediately before the raw socket
         * `destroy()` call so specs can assert the actual teardown method that ran
         * rather than a self-reported flag. Do not read or depend on this outside tests.
         * @type {number} */
        this._destroyCallCount = 0;
        /**
         * Internal test-only observability counter — NOT public API. Number of times
         * `close()` has run, incremented immediately before the raw socket `end()`
         * call. Do not read or depend on this outside tests.
         * @type {number} */
        this._closeCallCount = 0;
        this.buffer = "";
        this.socket.setEncoding("utf8");
        this.socket.on("data", (chunk) => this._onData(String(chunk)));
        this.socket.on("close", () => this.emit("close"));
        this.socket.on("error", (error) => this.emit("error", error));
    }
    /**
     * Runs on data.
     * @param {string} chunk - Data chunk.
     * @returns {void}
     */
    _onData(chunk) {
        this.buffer += chunk;
        while (true) {
            const newlineIndex = this.buffer.indexOf("\n");
            if (newlineIndex === -1)
                break;
            const line = this.buffer.slice(0, newlineIndex).trim();
            this.buffer = this.buffer.slice(newlineIndex + 1);
            if (!line)
                continue;
            try {
                const message = JSON.parse(line);
                this.emit("message", message);
            }
            catch (error) {
                this.emit("error", error);
            }
        }
    }
    /**
     * Runs send.
     * @param {ReturnType<typeof JSON.parse>} message - Message to send.
     * @returns {void}
     */
    send(message) {
        this.socket.write(`${JSON.stringify(message)}\n`);
    }
    /**
     * Runs close.
     * @returns {void}
     */
    close() {
        this._closeCallCount++;
        this.socket.end();
    }
    /**
     * Forcibly destroys the underlying socket. Unlike {@link close}, which
     * half-closes gracefully via `end()`, this tears the connection down
     * immediately so a stalled/aborted request does not leave the socket alive.
     * @returns {void}
     */
    destroy() {
        this._destroyCallCount++;
        this.socket.destroy();
    }
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoianNvbi1zb2NrZXQuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi9zcmMvYmFja2dyb3VuZC1qb2JzL2pzb24tc29ja2V0LmpzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiJBQUFBLFlBQVk7QUFFWixPQUFPLFlBQVksTUFBTSwyQkFBMkIsQ0FBQTtBQUVwRCxNQUFNLENBQUMsT0FBTyxPQUFPLFVBQVcsU0FBUSxZQUFZO0lBQ2xEOzs7T0FHRztJQUNILFlBQVksTUFBTTtRQUNoQixLQUFLLEVBQUUsQ0FBQTtRQUNQLElBQUksQ0FBQyxNQUFNLEdBQUcsTUFBTSxDQUFBO1FBQ3BCOzt3Q0FFZ0M7UUFDaEMsSUFBSSxDQUFDLFFBQVEsR0FBRyxTQUFTLENBQUE7UUFDekI7OzZCQUVxQjtRQUNyQixJQUFJLENBQUMsMEJBQTBCLEdBQUcsS0FBSyxDQUFBO1FBQ3ZDOzs2QkFFcUI7UUFDckIsSUFBSSxDQUFDLGtCQUFrQixHQUFHLElBQUksQ0FBQTtRQUM5Qjs7NkJBRXFCO1FBQ3JCLElBQUksQ0FBQyxpQkFBaUIsR0FBRyxJQUFJLENBQUE7UUFDN0Isc0JBQXNCO1FBQ3RCLElBQUksQ0FBQyxpQkFBaUIsR0FBRyxLQUFLLENBQUE7UUFDOUIseUVBQXlFO1FBQ3pFLElBQUksQ0FBQyxvQkFBb0IsR0FBRyxDQUFDLENBQUE7UUFDN0IsNEVBQTRFO1FBQzVFLElBQUksQ0FBQyx5QkFBeUIsR0FBRyxLQUFLLENBQUE7UUFDdEMsMEVBQTBFO1FBQzFFLElBQUksQ0FBQyxVQUFVLEdBQUcsS0FBSyxDQUFBO1FBQ3ZCLDJFQUEyRTtRQUMzRSxJQUFJLENBQUMsZ0JBQWdCLEdBQUcsQ0FBQyxDQUFBO1FBQ3pCOzs2QkFFcUI7UUFDckIsSUFBSSxDQUFDLGlCQUFpQixHQUFHLElBQUksQ0FBQTtRQUM3Qjs7Ozs7NkJBS3FCO1FBQ3JCLElBQUksQ0FBQyxpQkFBaUIsR0FBRyxLQUFLLENBQUE7UUFDOUI7Ozt3Q0FHZ0M7UUFDaEMsSUFBSSxDQUFDLFVBQVUsR0FBRyxTQUFTLENBQUE7UUFDM0I7Ozs7OzRCQUtvQjtRQUNwQixJQUFJLENBQUMsaUJBQWlCLEdBQUcsQ0FBQyxDQUFBO1FBQzFCOzs7OzRCQUlvQjtRQUNwQixJQUFJLENBQUMsZUFBZSxHQUFHLENBQUMsQ0FBQTtRQUN4QixJQUFJLENBQUMsTUFBTSxHQUFHLEVBQUUsQ0FBQTtRQUNoQixJQUFJLENBQUMsTUFBTSxDQUFDLFdBQVcsQ0FBQyxNQUFNLENBQUMsQ0FBQTtRQUMvQixJQUFJLENBQUMsTUFBTSxDQUFDLEVBQUUsQ0FBQyxNQUFNLEVBQUUsQ0FBQyxLQUFLLEVBQUUsRUFBRSxDQUFDLElBQUksQ0FBQyxPQUFPLENBQUMsTUFBTSxDQUFDLEtBQUssQ0FBQyxDQUFDLENBQUMsQ0FBQTtRQUM5RCxJQUFJLENBQUMsTUFBTSxDQUFDLEVBQUUsQ0FBQyxPQUFPLEVBQUUsR0FBRyxFQUFFLENBQUMsSUFBSSxDQUFDLElBQUksQ0FBQyxPQUFPLENBQUMsQ0FBQyxDQUFBO1FBQ2pELElBQUksQ0FBQyxNQUFNLENBQUMsRUFBRSxDQUFDLE9BQU8sRUFBRSxDQUFDLEtBQUssRUFBRSxFQUFFLENBQUMsSUFBSSxDQUFDLElBQUksQ0FBQyxPQUFPLEVBQUUsS0FBSyxDQUFDLENBQUMsQ0FBQTtJQUMvRCxDQUFDO0lBRUQ7Ozs7T0FJRztJQUNILE9BQU8sQ0FBQyxLQUFLO1FBQ1gsSUFBSSxDQUFDLE1BQU0sSUFBSSxLQUFLLENBQUE7UUFFcEIsT0FBTyxJQUFJLEVBQUUsQ0FBQztZQUNaLE1BQU0sWUFBWSxHQUFHLElBQUksQ0FBQyxNQUFNLENBQUMsT0FBTyxDQUFDLElBQUksQ0FBQyxDQUFBO1lBQzlDLElBQUksWUFBWSxLQUFLLENBQUMsQ0FBQztnQkFBRSxNQUFLO1lBRTlCLE1BQU0sSUFBSSxHQUFHLElBQUksQ0FBQyxNQUFNLENBQUMsS0FBSyxDQUFDLENBQUMsRUFBRSxZQUFZLENBQUMsQ0FBQyxJQUFJLEVBQUUsQ0FBQTtZQUN0RCxJQUFJLENBQUMsTUFBTSxHQUFHLElBQUksQ0FBQyxNQUFNLENBQUMsS0FBSyxDQUFDLFlBQVksR0FBRyxDQUFDLENBQUMsQ0FBQTtZQUVqRCxJQUFJLENBQUMsSUFBSTtnQkFBRSxTQUFRO1lBRW5CLElBQUksQ0FBQztnQkFDSCxNQUFNLE9BQU8sR0FBRyxJQUFJLENBQUMsS0FBSyxDQUFDLElBQUksQ0FBQyxDQUFBO2dCQUNoQyxJQUFJLENBQUMsSUFBSSxDQUFDLFNBQVMsRUFBRSxPQUFPLENBQUMsQ0FBQTtZQUMvQixDQUFDO1lBQUMsT0FBTyxLQUFLLEVBQUUsQ0FBQztnQkFDZixJQUFJLENBQUMsSUFBSSxDQUFDLE9BQU8sRUFBRSxLQUFLLENBQUMsQ0FBQTtZQUMzQixDQUFDO1FBQ0gsQ0FBQztJQUNILENBQUM7SUFFRDs7OztPQUlHO0lBQ0gsSUFBSSxDQUFDLE9BQU87UUFDVixJQUFJLENBQUMsTUFBTSxDQUFDLEtBQUssQ0FBQyxHQUFHLElBQUksQ0FBQyxTQUFTLENBQUMsT0FBTyxDQUFDLElBQUksQ0FBQyxDQUFBO0lBQ25ELENBQUM7SUFFRDs7O09BR0c7SUFDSCxLQUFLO1FBQ0gsSUFBSSxDQUFDLGVBQWUsRUFBRSxDQUFBO1FBQ3RCLElBQUksQ0FBQyxNQUFNLENBQUMsR0FBRyxFQUFFLENBQUE7SUFDbkIsQ0FBQztJQUVEOzs7OztPQUtHO0lBQ0gsT0FBTztRQUNMLElBQUksQ0FBQyxpQkFBaUIsRUFBRSxDQUFBO1FBQ3hCLElBQUksQ0FBQyxNQUFNLENBQUMsT0FBTyxFQUFFLENBQUE7SUFDdkIsQ0FBQztDQUNGIiwic291cmNlc0NvbnRlbnQiOlsiLy8gQHRzLWNoZWNrXG5cbmltcG9ydCBFdmVudEVtaXR0ZXIgZnJvbSBcIi4uL3V0aWxzL2V2ZW50LWVtaXR0ZXIuanNcIlxuXG5leHBvcnQgZGVmYXVsdCBjbGFzcyBKc29uU29ja2V0IGV4dGVuZHMgRXZlbnRFbWl0dGVyIHtcbiAgLyoqXG4gICAqIFJ1bnMgY29uc3RydWN0b3IuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwibmV0XCIpLlNvY2tldH0gc29ja2V0IC0gU29ja2V0IGluc3RhbmNlLlxuICAgKi9cbiAgY29uc3RydWN0b3Ioc29ja2V0KSB7XG4gICAgc3VwZXIoKVxuICAgIHRoaXMuc29ja2V0ID0gc29ja2V0XG4gICAgLyoqXG4gICAgICogTmFycm93cyB0aGUgcnVudGltZSB2YWx1ZSB0byB0aGUgZG9jdW1lbnRlZCB0eXBlLlxuICAgICAqIEB0eXBlIHtzdHJpbmcgfCB1bmRlZmluZWR9ICovXG4gICAgdGhpcy53b3JrZXJJZCA9IHVuZGVmaW5lZFxuICAgIC8qKlxuICAgICAqIE5hcnJvd3MgdGhlIHJ1bnRpbWUgdmFsdWUgdG8gdGhlIGRvY3VtZW50ZWQgdHlwZS5cbiAgICAgKiBAdHlwZSB7Ym9vbGVhbn0gKi9cbiAgICB0aGlzLnN1cHBvcnRzSGFuZG9mZklkUmVwb3J0aW5nID0gZmFsc2VcbiAgICAvKipcbiAgICAgKiBOYXJyb3dzIHRoZSBydW50aW1lIHZhbHVlIHRvIHRoZSBkb2N1bWVudGVkIHR5cGUuXG4gICAgICogQHR5cGUge2Jvb2xlYW59ICovXG4gICAgdGhpcy5hY2NlcHRzU3Bhd25lZEpvYnMgPSB0cnVlXG4gICAgLyoqXG4gICAgICogTmFycm93cyB0aGUgcnVudGltZSB2YWx1ZSB0byB0aGUgZG9jdW1lbnRlZCB0eXBlLlxuICAgICAqIEB0eXBlIHtib29sZWFufSAqL1xuICAgIHRoaXMuYWNjZXB0c0ZvcmtlZEpvYnMgPSB0cnVlXG4gICAgLyoqIEB0eXBlIHtib29sZWFufSAqL1xuICAgIHRoaXMuYWNjZXB0c1Bvb2xlZEpvYnMgPSBmYWxzZVxuICAgIC8qKiBOdW1iZXIgb2YgcG9vbGVkIGhhbmRvZmZzIHRoaXMgcmVhZGluZXNzIGFkdmVydGlzZW1lbnQgY2FuIGFjY2VwdC4gKi9cbiAgICB0aGlzLmF2YWlsYWJsZVBvb2xlZFNsb3RzID0gMFxuICAgIC8qKiBXaGV0aGVyIHRoZSB3b3JrZXIvbWFpbiBwYWlyIHVzZXMgY29uc3VtYWJsZSBwb29sZWQtY2FwYWNpdHkgY3JlZGl0cy4gKi9cbiAgICB0aGlzLnVzZXNQb29sZWRDYXBhY2l0eUNyZWRpdHMgPSBmYWxzZVxuICAgIC8qKiBXaGV0aGVyIHRoaXMgd29ya2VyIGhhcyBwZXJtYW5lbnRseSBzdG9wcGVkIGFjY2VwdGluZyBuZXcgaGFuZG9mZnMuICovXG4gICAgdGhpcy5pc0RyYWluaW5nID0gZmFsc2VcbiAgICAvKiogTW9ub3RvbmljIGdlbmVyYXRpb24gb2YgdGhlIHdvcmtlcidzIGxhdGVzdCByZWFkaW5lc3MgYWR2ZXJ0aXNlbWVudC4gKi9cbiAgICB0aGlzLnJlYWRpbmVzc1ZlcnNpb24gPSAwXG4gICAgLyoqXG4gICAgICogTmFycm93cyB0aGUgcnVudGltZSB2YWx1ZSB0byB0aGUgZG9jdW1lbnRlZCB0eXBlLlxuICAgICAqIEB0eXBlIHtib29sZWFufSAqL1xuICAgIHRoaXMuYWNjZXB0c0lubGluZUpvYnMgPSB0cnVlXG4gICAgLyoqXG4gICAgICogV2hldGhlciB0aGlzIHdvcmtlciBhZHZlcnRpc2VkIGhlYXJ0YmVhdCBzdXBwb3J0IGluIGl0cyBoZWxsby4gT25seVxuICAgICAqIGhlYXJ0YmVhdC1jYXBhYmxlIHdvcmtlcnMgYXJlIHN1YmplY3QgdG8gdGhlIG1haW4ncyBzdGFsZS1saXZlbmVzc1xuICAgICAqIGV2aWN0aW9uOyBhIGxlZ2FjeSB3b3JrZXIgKGUuZy4gbWlkIHJvbGxpbmcgZGVwbG95KSBpcyBleGVtcHQgc28gaXRzXG4gICAgICogYWN0aXZlIGxlYXNlcyBhcmUgbm90IHJlbGVhc2VkIHdoaWxlIGl0IGlzIHN0aWxsIHJ1bm5pbmcgdGhlbS5cbiAgICAgKiBAdHlwZSB7Ym9vbGVhbn0gKi9cbiAgICB0aGlzLnN1cHBvcnRzSGVhcnRiZWF0ID0gZmFsc2VcbiAgICAvKipcbiAgICAgKiBMYXN0IHRpbWUgKG1zKSB0aGUgbWFpbiBzYXcgYW55IG1lc3NhZ2UgZnJvbSB0aGlzIHdvcmtlciBzb2NrZXQ7IHVzZWQgYnlcbiAgICAgKiB0aGUgbWFpbidzIGxpdmVuZXNzIHN3ZWVwIHRvIGRyb3AgYSB3ZWRnZWQvc2lsZW50IHdvcmtlci5cbiAgICAgKiBAdHlwZSB7bnVtYmVyIHwgdW5kZWZpbmVkfSAqL1xuICAgIHRoaXMubGFzdFNlZW5BdCA9IHVuZGVmaW5lZFxuICAgIC8qKlxuICAgICAqIEludGVybmFsIHRlc3Qtb25seSBvYnNlcnZhYmlsaXR5IGNvdW50ZXIg4oCUIE5PVCBwdWJsaWMgQVBJLiBOdW1iZXIgb2YgdGltZXNcbiAgICAgKiBgZGVzdHJveSgpYCBoYXMgcnVuLCBpbmNyZW1lbnRlZCBpbW1lZGlhdGVseSBiZWZvcmUgdGhlIHJhdyBzb2NrZXRcbiAgICAgKiBgZGVzdHJveSgpYCBjYWxsIHNvIHNwZWNzIGNhbiBhc3NlcnQgdGhlIGFjdHVhbCB0ZWFyZG93biBtZXRob2QgdGhhdCByYW5cbiAgICAgKiByYXRoZXIgdGhhbiBhIHNlbGYtcmVwb3J0ZWQgZmxhZy4gRG8gbm90IHJlYWQgb3IgZGVwZW5kIG9uIHRoaXMgb3V0c2lkZSB0ZXN0cy5cbiAgICAgKiBAdHlwZSB7bnVtYmVyfSAqL1xuICAgIHRoaXMuX2Rlc3Ryb3lDYWxsQ291bnQgPSAwXG4gICAgLyoqXG4gICAgICogSW50ZXJuYWwgdGVzdC1vbmx5IG9ic2VydmFiaWxpdHkgY291bnRlciDigJQgTk9UIHB1YmxpYyBBUEkuIE51bWJlciBvZiB0aW1lc1xuICAgICAqIGBjbG9zZSgpYCBoYXMgcnVuLCBpbmNyZW1lbnRlZCBpbW1lZGlhdGVseSBiZWZvcmUgdGhlIHJhdyBzb2NrZXQgYGVuZCgpYFxuICAgICAqIGNhbGwuIERvIG5vdCByZWFkIG9yIGRlcGVuZCBvbiB0aGlzIG91dHNpZGUgdGVzdHMuXG4gICAgICogQHR5cGUge251bWJlcn0gKi9cbiAgICB0aGlzLl9jbG9zZUNhbGxDb3VudCA9IDBcbiAgICB0aGlzLmJ1ZmZlciA9IFwiXCJcbiAgICB0aGlzLnNvY2tldC5zZXRFbmNvZGluZyhcInV0ZjhcIilcbiAgICB0aGlzLnNvY2tldC5vbihcImRhdGFcIiwgKGNodW5rKSA9PiB0aGlzLl9vbkRhdGEoU3RyaW5nKGNodW5rKSkpXG4gICAgdGhpcy5zb2NrZXQub24oXCJjbG9zZVwiLCAoKSA9PiB0aGlzLmVtaXQoXCJjbG9zZVwiKSlcbiAgICB0aGlzLnNvY2tldC5vbihcImVycm9yXCIsIChlcnJvcikgPT4gdGhpcy5lbWl0KFwiZXJyb3JcIiwgZXJyb3IpKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgb24gZGF0YS5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGNodW5rIC0gRGF0YSBjaHVuay5cbiAgICogQHJldHVybnMge3ZvaWR9XG4gICAqL1xuICBfb25EYXRhKGNodW5rKSB7XG4gICAgdGhpcy5idWZmZXIgKz0gY2h1bmtcblxuICAgIHdoaWxlICh0cnVlKSB7XG4gICAgICBjb25zdCBuZXdsaW5lSW5kZXggPSB0aGlzLmJ1ZmZlci5pbmRleE9mKFwiXFxuXCIpXG4gICAgICBpZiAobmV3bGluZUluZGV4ID09PSAtMSkgYnJlYWtcblxuICAgICAgY29uc3QgbGluZSA9IHRoaXMuYnVmZmVyLnNsaWNlKDAsIG5ld2xpbmVJbmRleCkudHJpbSgpXG4gICAgICB0aGlzLmJ1ZmZlciA9IHRoaXMuYnVmZmVyLnNsaWNlKG5ld2xpbmVJbmRleCArIDEpXG5cbiAgICAgIGlmICghbGluZSkgY29udGludWVcblxuICAgICAgdHJ5IHtcbiAgICAgICAgY29uc3QgbWVzc2FnZSA9IEpTT04ucGFyc2UobGluZSlcbiAgICAgICAgdGhpcy5lbWl0KFwibWVzc2FnZVwiLCBtZXNzYWdlKVxuICAgICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgICAgdGhpcy5lbWl0KFwiZXJyb3JcIiwgZXJyb3IpXG4gICAgICB9XG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgc2VuZC5cbiAgICogQHBhcmFtIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gbWVzc2FnZSAtIE1lc3NhZ2UgdG8gc2VuZC5cbiAgICogQHJldHVybnMge3ZvaWR9XG4gICAqL1xuICBzZW5kKG1lc3NhZ2UpIHtcbiAgICB0aGlzLnNvY2tldC53cml0ZShgJHtKU09OLnN0cmluZ2lmeShtZXNzYWdlKX1cXG5gKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgY2xvc2UuXG4gICAqIEByZXR1cm5zIHt2b2lkfVxuICAgKi9cbiAgY2xvc2UoKSB7XG4gICAgdGhpcy5fY2xvc2VDYWxsQ291bnQrK1xuICAgIHRoaXMuc29ja2V0LmVuZCgpXG4gIH1cblxuICAvKipcbiAgICogRm9yY2libHkgZGVzdHJveXMgdGhlIHVuZGVybHlpbmcgc29ja2V0LiBVbmxpa2Uge0BsaW5rIGNsb3NlfSwgd2hpY2hcbiAgICogaGFsZi1jbG9zZXMgZ3JhY2VmdWxseSB2aWEgYGVuZCgpYCwgdGhpcyB0ZWFycyB0aGUgY29ubmVjdGlvbiBkb3duXG4gICAqIGltbWVkaWF0ZWx5IHNvIGEgc3RhbGxlZC9hYm9ydGVkIHJlcXVlc3QgZG9lcyBub3QgbGVhdmUgdGhlIHNvY2tldCBhbGl2ZS5cbiAgICogQHJldHVybnMge3ZvaWR9XG4gICAqL1xuICBkZXN0cm95KCkge1xuICAgIHRoaXMuX2Rlc3Ryb3lDYWxsQ291bnQrK1xuICAgIHRoaXMuc29ja2V0LmRlc3Ryb3koKVxuICB9XG59XG4iXX0=