// @ts-check
/**
 * RequestTimingBucket type.
 * @typedef {"controller" | "db" | "views"} RequestTimingBucket
 */
/**
 * Defines this typedef.
 * @typedef {{bucket: RequestTimingBucket, startedAtMs: number}} ActiveTimingBucket
 */
/**
 * Tracks exclusive request timing buckets. When a nested bucket starts,
 * the currently active bucket is paused until the nested bucket exits.
 */
export default class RequestTiming {
    /**
     * Buckets.
     * @type {Record<RequestTimingBucket, number>} */
    buckets = {
        controller: 0,
        db: 0,
        views: 0
    };
    /**
     * Bucket stack.
     * @type {ActiveTimingBucket[]} */
    bucketStack = [];
    dbQueryCount = 0;
    /** @type {Set<string>} */
    logSensitiveValues = new Set();
    /**
     * Completed log method.
     * @type {"debug" | "info" | undefined} */
    completedLogMethod = undefined;
    /**
     * Completed log subject.
     * @type {string | undefined} */
    completedLogSubject = undefined;
    /**
     * Response served at ms.
     * @type {number | undefined} */
    responseServedAtMs = undefined;
    startedAtMs = Date.now();
    /**
     * Registers exact sensitive values owned by this request lifecycle.
     * @param {Set<string>} values - Sensitive value representations.
     * @returns {void} - No return value.
     */
    registerLogSensitiveValues(values) {
        for (const value of values)
            this.logSensitiveValues.add(value);
    }
    /**
     * Gets the sensitive values owned by this request lifecycle.
     * @returns {Set<string>} - Request-local sensitive value representations.
     */
    getLogSensitiveValues() {
        return this.logSensitiveValues;
    }
    /**
     * Runs measure.
     * @template T
     * @param {RequestTimingBucket} bucket - Bucket name.
     * @param {() => Promise<T> | T} callback - Callback to measure.
     * @returns {Promise<T>} - Callback result.
     */
    async measure(bucket, callback) {
        this._pushBucket(bucket);
        try {
            return await callback();
        }
        finally {
            this._popBucket();
        }
    }
    /**
     * Runs measure sync.
     * @template T
     * @param {RequestTimingBucket} bucket - Bucket name.
     * @param {() => T} callback - Callback to measure.
     * @returns {T} - Callback result.
     */
    measureSync(bucket, callback) {
        this._pushBucket(bucket);
        try {
            return callback();
        }
        finally {
            this._popBucket();
        }
    }
    /**
     * Runs measure db query.
     * @template T
     * @param {() => Promise<T>} callback - Query callback.
     * @returns {Promise<T>} - Query result.
     */
    async measureDbQuery(callback) {
        this.dbQueryCount += 1;
        return await this.measure("db", callback);
    }
    /**
     * Runs mark response served.
     * @returns {void} - Marks the response as fully served.
     */
    markResponseServed() {
        this.responseServedAtMs = Date.now();
    }
    /**
     * Runs summary.
     * @returns {{controllerMs: number, dbMs: number, totalMs: number, velociousMs: number, viewsMs: number, dbQueryCount: number}} - Timing summary.
     */
    summary() {
        const now = this.responseServedAtMs || Date.now();
        const buckets = this._bucketTotalsAt(now);
        const totalMs = now - this.startedAtMs;
        const controllerMs = buckets.controller;
        const dbMs = buckets.db;
        const viewsMs = buckets.views;
        const velociousMs = Math.max(totalMs - controllerMs - dbMs - viewsMs, 0);
        return {
            controllerMs,
            dbMs,
            dbQueryCount: this.dbQueryCount,
            totalMs,
            velociousMs,
            viewsMs
        };
    }
    /**
     * Runs bucket totals at.
     * @param {number} now - Timestamp to calculate active bucket elapsed time against.
     * @returns {Record<RequestTimingBucket, number>} - Bucket totals.
     */
    _bucketTotalsAt(now) {
        const buckets = Object.assign({}, this.buckets);
        const activeBucket = this.bucketStack[this.bucketStack.length - 1];
        if (activeBucket) {
            buckets[activeBucket.bucket] += Math.max(now - activeBucket.startedAtMs, 0);
        }
        return buckets;
    }
    /**
     * Runs push bucket.
     * @param {RequestTimingBucket} bucket - Bucket name.
     * @returns {void} - No return value.
     */
    _pushBucket(bucket) {
        const now = Date.now();
        const activeBucket = this.bucketStack[this.bucketStack.length - 1];
        if (activeBucket) {
            this.buckets[activeBucket.bucket] += now - activeBucket.startedAtMs;
        }
        this.bucketStack.push({ bucket, startedAtMs: now });
    }
    /**
     * Runs pop bucket.
     * @returns {void} - No return value.
     */
    _popBucket() {
        const now = Date.now();
        const activeBucket = this.bucketStack.pop();
        if (!activeBucket)
            throw new Error("No active request timing bucket");
        this.buckets[activeBucket.bucket] += now - activeBucket.startedAtMs;
        const parentBucket = this.bucketStack[this.bucketStack.length - 1];
        if (parentBucket)
            parentBucket.startedAtMs = now;
    }
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoicmVxdWVzdC10aW1pbmcuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi8uLi9zcmMvaHR0cC1zZXJ2ZXIvY2xpZW50L3JlcXVlc3QtdGltaW5nLmpzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiJBQUFBLFlBQVk7QUFFWjs7O0dBR0c7QUFFSDs7O0dBR0c7QUFFSDs7O0dBR0c7QUFDSCxNQUFNLENBQUMsT0FBTyxPQUFPLGFBQWE7SUFDaEM7O3FEQUVpRDtJQUNqRCxPQUFPLEdBQUc7UUFDUixVQUFVLEVBQUUsQ0FBQztRQUNiLEVBQUUsRUFBRSxDQUFDO1FBQ0wsS0FBSyxFQUFFLENBQUM7S0FDVCxDQUFBO0lBRUQ7O3NDQUVrQztJQUNsQyxXQUFXLEdBQUcsRUFBRSxDQUFBO0lBRWhCLFlBQVksR0FBRyxDQUFDLENBQUE7SUFDaEIsMEJBQTBCO0lBQzFCLGtCQUFrQixHQUFHLElBQUksR0FBRyxFQUFFLENBQUE7SUFDOUI7OzhDQUUwQztJQUMxQyxrQkFBa0IsR0FBRyxTQUFTLENBQUE7SUFDOUI7O29DQUVnQztJQUNoQyxtQkFBbUIsR0FBRyxTQUFTLENBQUE7SUFDL0I7O29DQUVnQztJQUNoQyxrQkFBa0IsR0FBRyxTQUFTLENBQUE7SUFDOUIsV0FBVyxHQUFHLElBQUksQ0FBQyxHQUFHLEVBQUUsQ0FBQTtJQUV4Qjs7OztPQUlHO0lBQ0gsMEJBQTBCLENBQUMsTUFBTTtRQUMvQixLQUFLLE1BQU0sS0FBSyxJQUFJLE1BQU07WUFBRSxJQUFJLENBQUMsa0JBQWtCLENBQUMsR0FBRyxDQUFDLEtBQUssQ0FBQyxDQUFBO0lBQ2hFLENBQUM7SUFFRDs7O09BR0c7SUFDSCxxQkFBcUI7UUFDbkIsT0FBTyxJQUFJLENBQUMsa0JBQWtCLENBQUE7SUFDaEMsQ0FBQztJQUVEOzs7Ozs7T0FNRztJQUNILEtBQUssQ0FBQyxPQUFPLENBQUMsTUFBTSxFQUFFLFFBQVE7UUFDNUIsSUFBSSxDQUFDLFdBQVcsQ0FBQyxNQUFNLENBQUMsQ0FBQTtR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RyxFQUFDLENBQUMsQ0FBQTtJQUNuRCxDQUFDO0lBRUQ7OztPQUdHO0lBQ0gsVUFBVTtRQUNSLE1BQU0sR0FBRyxHQUFHLElBQUksQ0FBQyxHQUFHLEVBQUUsQ0FBQTtRQUN0QixNQUFNLFlBQVksR0FBRyxJQUFJLENBQUMsV0FBVyxDQUFDLEdBQUcsRUFBRSxDQUFBO1FBRTNDLElBQUksQ0FBQyxZQUFZO1lBQUUsTUFBTSxJQUFJLEtBQUssQ0FBQyxpQ0FBaUMsQ0FBQyxDQUFBO1FBRXJFLElBQUksQ0FBQyxPQUFPLENBQUMsWUFBWSxDQUFDLE1BQU0sQ0FBQyxJQUFJLEdBQUcsR0FBRyxZQUFZLENBQUMsV0FBVyxDQUFBO1FBRW5FLE1BQU0sWUFBWSxHQUFHLElBQUksQ0FBQyxXQUFXLENBQUMsSUFBSSxDQUFDLFdBQVcsQ0FBQyxNQUFNLEdBQUcsQ0FBQyxDQUFDLENBQUE7UUFDbEUsSUFBSSxZQUFZO1lBQUUsWUFBWSxDQUFDLFdBQVcsR0FBRyxHQUFHLENBQUE7SUFDbEQsQ0FBQztDQUNGIiwic291cmNlc0NvbnRlbnQiOlsiLy8gQHRzLWNoZWNrXG5cbi8qKlxuICogUmVxdWVzdFRpbWluZ0J1Y2tldCB0eXBlLlxuICogQHR5cGVkZWYge1wiY29udHJvbGxlclwiIHwgXCJkYlwiIHwgXCJ2aWV3c1wifSBSZXF1ZXN0VGltaW5nQnVja2V0XG4gKi9cblxuLyoqXG4gKiBEZWZpbmVzIHRoaXMgdHlwZWRlZi5cbiAqIEB0eXBlZGVmIHt7YnVja2V0OiBSZXF1ZXN0VGltaW5nQnVja2V0LCBzdGFydGVkQXRNczogbnVtYmVyfX0gQWN0aXZlVGltaW5nQnVja2V0XG4gKi9cblxuLyoqXG4gKiBUcmFja3MgZXhjbHVzaXZlIHJlcXVlc3QgdGltaW5nIGJ1Y2tldHMuIFdoZW4gYSBuZXN0ZWQgYnVja2V0IHN0YXJ0cyxcbiAqIHRoZSBjdXJyZW50bHkgYWN0aXZlIGJ1Y2tldCBpcyBwYXVzZWQgdW50aWwgdGhlIG5lc3RlZCBidWNrZXQgZXhpdHMuXG4gKi9cbmV4cG9ydCBkZWZhdWx0IGNsYXNzIFJlcXVlc3RUaW1pbmcge1xuICAvKipcbiAgICogQnVja2V0cy5cbiAgICogQHR5cGUge1JlY29yZDxSZXF1ZXN0VGltaW5nQnVja2V0LCBudW1iZXI+fSAqL1xuICBidWNrZXRzID0ge1xuICAgIGNvbnRyb2xsZXI6IDAsXG4gICAgZGI6IDAsXG4gICAgdmlld3M6IDBcbiAgfVxuXG4gIC8qKlxuICAgKiBCdWNrZXQgc3RhY2suXG4gICAqIEB0eXBlIHtBY3RpdmVUaW1pbmdCdWNrZXRbXX0gKi9cbiAgYnVja2V0U3RhY2sgPSBbXVxuXG4gIGRiUXVlcnlDb3VudCA9IDBcbiAgLyoqIEB0eXBlIHtTZXQ8c3RyaW5nPn0gKi9cbiAgbG9nU2Vuc2l0aXZlVmFsdWVzID0gbmV3IFNldCgpXG4gIC8qKlxuICAgKiBDb21wbGV0ZWQgbG9nIG1ldGhvZC5cbiAgICogQHR5cGUge1wiZGVidWdcIiB8IFwiaW5mb1wiIHwgdW5kZWZpbmVkfSAqL1xuICBjb21wbGV0ZWRMb2dNZXRob2QgPSB1bmRlZmluZWRcbiAgLyoqXG4gICAqIENvbXBsZXRlZCBsb2cgc3ViamVjdC5cbiAgICogQHR5cGUge3N0cmluZyB8IHVuZGVmaW5lZH0gKi9cbiAgY29tcGxldGVkTG9nU3ViamVjdCA9IHVuZGVmaW5lZFxuICAvKipcbiAgICogUmVzcG9uc2Ugc2VydmVkIGF0IG1zLlxuICAgKiBAdHlwZSB7bnVtYmVyIHwgdW5kZWZpbmVkfSAqL1xuICByZXNwb25zZVNlcnZlZEF0TXMgPSB1bmRlZmluZWRcbiAgc3RhcnRlZEF0TXMgPSBEYXRlLm5vdygpXG5cbiAgLyoqXG4gICAqIFJlZ2lzdGVycyBleGFjdCBzZW5zaXRpdmUgdmFsdWVzIG93bmVkIGJ5IHRoaXMgcmVxdWVzdCBsaWZlY3ljbGUuXG4gICAqIEBwYXJhbSB7U2V0PHN0cmluZz59IHZhbHVlcyAtIFNlbnNpdGl2ZSB2YWx1ZSByZXByZXNlbnRhdGlvbnMuXG4gICAqIEByZXR1cm5zIHt2b2lkfSAtIE5vIHJldHVybiB2YWx1ZS5cbiAgICovXG4gIHJlZ2lzdGVyTG9nU2Vuc2l0aXZlVmFsdWVzKHZhbHVlcykge1xuICAgIGZvciAoY29uc3QgdmFsdWUgb2YgdmFsdWVzKSB0aGlzLmxvZ1NlbnNpdGl2ZVZhbHVlcy5hZGQodmFsdWUpXG4gIH1cblxuICAvKipcbiAgICogR2V0cyB0aGUgc2Vuc2l0aXZlIHZhbHVlcyBvd25lZCBieSB0aGlzIHJlcXVlc3QgbGlmZWN5Y2xlLlxuICAgKiBAcmV0dXJucyB7U2V0PHN0cmluZz59IC0gUmVxdWVzdC1sb2NhbCBzZW5zaXRpdmUgdmFsdWUgcmVwcmVzZW50YXRpb25zLlxuICAgKi9cbiAgZ2V0TG9nU2Vuc2l0aXZlVmFsdWVzKCkge1xuICAgIHJldHVybiB0aGlzLmxvZ1NlbnNpdGl2ZVZhbHVlc1xuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgbWVhc3VyZS5cbiAgICogQHRlbXBsYXRlIFRcbiAgICogQHBhcmFtIHtSZXF1ZXN0VGltaW5nQnVja2V0fSBidWNrZXQgLSBCdWNrZXQgbmFtZS5cbiAgICogQHBhcmFtIHsoKSA9PiBQcm9taXNlPFQ+IHwgVH0gY2FsbGJhY2sgLSBDYWxsYmFjayB0byBtZWFzdXJlLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxUPn0gLSBDYWxsYmFjayByZXN1bHQuXG4gICAqL1xuICBhc3luYyBtZWFzdXJlKGJ1Y2tldCwgY2FsbGJhY2spIHtcbiAgICB0aGlzLl9wdXNoQnVja2V0KGJ1Y2tldClcblxuICAgIHRyeSB7XG4gICAgICByZXR1cm4gYXdhaXQgY2FsbGJhY2soKVxuICAgIH0gZmluYWxseSB7XG4gICAgICB0aGlzLl9wb3BCdWNrZXQoKVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIG1lYXN1cmUgc3luYy5cbiAgICogQHRlbXBsYXRlIFRcbiAgICogQHBhcmFtIHtSZXF1ZXN0VGltaW5nQnVja2V0fSBidWNrZXQgLSBCdWNrZXQgbmFtZS5cbiAgICogQHBhcmFtIHsoKSA9PiBUfSBjYWxsYmFjayAtIENhbGxiYWNrIHRvIG1lYXN1cmUuXG4gICAqIEByZXR1cm5zIHtUfSAtIENhbGxiYWNrIHJlc3VsdC5cbiAgICovXG4gIG1lYXN1cmVTeW5jKGJ1Y2tldCwgY2FsbGJhY2spIHtcbiAgICB0aGlzLl9wdXNoQnVja2V0KGJ1Y2tldClcblxuICAgIHRyeSB7XG4gICAgICByZXR1cm4gY2FsbGJhY2soKVxuICAgIH0gZmluYWxseSB7XG4gICAgICB0aGlzLl9wb3BCdWNrZXQoKVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIG1lYXN1cmUgZGIgcXVlcnkuXG4gICAqIEB0ZW1wbGF0ZSBUXG4gICAqIEBwYXJhbSB7KCkgPT4gUHJvbWlzZTxUPn0gY2FsbGJhY2sgLSBRdWVyeSBjYWxsYmFjay5cbiAgICogQHJldHVybnMge1Byb21pc2U8VD59IC0gUXVlcnkgcmVzdWx0LlxuICAgKi9cbiAgYXN5bmMgbWVhc3VyZURiUXVlcnkoY2FsbGJhY2spIHtcbiAgICB0aGlzLmRiUXVlcnlDb3VudCArPSAxXG5cbiAgICByZXR1cm4gYXdhaXQgdGhpcy5tZWFzdXJlKFwiZGJcIiwgY2FsbGJhY2spXG4gIH1cblxuICAvKipcbiAgICogUnVucyBtYXJrIHJlc3BvbnNlIHNlcnZlZC5cbiAgICogQHJldHVybnMge3ZvaWR9IC0gTWFya3MgdGhlIHJlc3BvbnNlIGFzIGZ1bGx5IHNlcnZlZC5cbiAgICovXG4gIG1hcmtSZXNwb25zZVNlcnZlZCgpIHtcbiAgICB0aGlzLnJlc3BvbnNlU2VydmVkQXRNcyA9IERhdGUubm93KClcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHN1bW1hcnkuXG4gICAqIEByZXR1cm5zIHt7Y29udHJvbGxlck1zOiBudW1iZXIsIGRiTXM6IG51bWJlciwgdG90YWxNczogbnVtYmVyLCB2ZWxvY2lvdXNNczogbnVtYmVyLCB2aWV3c01zOiBudW1iZXIsIGRiUXVlcnlDb3VudDogbnVtYmVyfX0gLSBUaW1pbmcgc3VtbWFyeS5cbiAgICovXG4gIHN1bW1hcnkoKSB7XG4gICAgY29uc3Qgbm93ID0gdGhpcy5yZXNwb25zZVNlcnZlZEF0TXMgfHwgRGF0ZS5ub3coKVxuICAgIGNvbnN0IGJ1Y2tldHMgPSB0aGlzLl9idWNrZXRUb3RhbHNBdChub3cpXG4gICAgY29uc3QgdG90YWxNcyA9IG5vdyAtIHRoaXMuc3RhcnRlZEF0TXNcbiAgICBjb25zdCBjb250cm9sbGVyTXMgPSBidWNrZXRzLmNvbnRyb2xsZXJcbiAgICBjb25zdCBkYk1zID0gYnVja2V0cy5kYlxuICAgIGNvbnN0IHZpZXdzTXMgPSBidWNrZXRzLnZpZXdzXG4gICAgY29uc3QgdmVsb2Npb3VzTXMgPSBNYXRoLm1heCh0b3RhbE1zIC0gY29udHJvbGxlck1zIC0gZGJNcyAtIHZpZXdzTXMsIDApXG5cbiAgICByZXR1cm4ge1xuICAgICAgY29udHJvbGxlck1zLFxuICAgICAgZGJNcyxcbiAgICAgIGRiUXVlcnlDb3VudDogdGhpcy5kYlF1ZXJ5Q291bnQsXG4gICAgICB0b3RhbE1zLFxuICAgICAgdmVsb2Npb3VzTXMsXG4gICAgICB2aWV3c01zXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgYnVja2V0IHRvdGFscyBhdC5cbiAgICogQHBhcmFtIHtudW1iZXJ9IG5vdyAtIFRpbWVzdGFtcCB0byBjYWxjdWxhdGUgYWN0aXZlIGJ1Y2tldCBlbGFwc2VkIHRpbWUgYWdhaW5zdC5cbiAgICogQHJldHVybnMge1JlY29yZDxSZXF1ZXN0VGltaW5nQnVja2V0LCBudW1iZXI+fSAtIEJ1Y2tldCB0b3RhbHMuXG4gICAqL1xuICBfYnVja2V0VG90YWxzQXQobm93KSB7XG4gICAgY29uc3QgYnVja2V0cyA9IE9iamVjdC5hc3NpZ24oe30sIHRoaXMuYnVja2V0cylcbiAgICBjb25zdCBhY3RpdmVCdWNrZXQgPSB0aGlzLmJ1Y2tldFN0YWNrW3RoaXMuYnVja2V0U3RhY2subGVuZ3RoIC0gMV1cblxuICAgIGlmIChhY3RpdmVCdWNrZXQpIHtcbiAgICAgIGJ1Y2tldHNbYWN0aXZlQnVja2V0LmJ1Y2tldF0gKz0gTWF0aC5tYXgobm93IC0gYWN0aXZlQnVja2V0LnN0YXJ0ZWRBdE1zLCAwKVxuICAgIH1cblxuICAgIHJldHVybiBidWNrZXRzXG4gIH1cblxuICAvKipcbiAgICogUnVucyBwdXNoIGJ1Y2tldC5cbiAgICogQHBhcmFtIHtSZXF1ZXN0VGltaW5nQnVja2V0fSBidWNrZXQgLSBCdWNrZXQgbmFtZS5cbiAgICogQHJldHVybnMge3ZvaWR9IC0gTm8gcmV0dXJuIHZhbHVlLlxuICAgKi9cbiAgX3B1c2hCdWNrZXQoYnVja2V0KSB7XG4gICAgY29uc3Qgbm93ID0gRGF0ZS5ub3coKVxuICAgIGNvbnN0IGFjdGl2ZUJ1Y2tldCA9IHRoaXMuYnVja2V0U3RhY2tbdGhpcy5idWNrZXRTdGFjay5sZW5ndGggLSAxXVxuXG4gICAgaWYgKGFjdGl2ZUJ1Y2tldCkge1xuICAgICAgdGhpcy5idWNrZXRzW2FjdGl2ZUJ1Y2tldC5idWNrZXRdICs9IG5vdyAtIGFjdGl2ZUJ1Y2tldC5zdGFydGVkQXRNc1xuICAgIH1cblxuICAgIHRoaXMuYnVja2V0U3RhY2sucHVzaCh7YnVja2V0LCBzdGFydGVkQXRNczogbm93fSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHBvcCBidWNrZXQuXG4gICAqIEByZXR1cm5zIHt2b2lkfSAtIE5vIHJldHVybiB2YWx1ZS5cbiAgICovXG4gIF9wb3BCdWNrZXQoKSB7XG4gICAgY29uc3Qgbm93ID0gRGF0ZS5ub3coKVxuICAgIGNvbnN0IGFjdGl2ZUJ1Y2tldCA9IHRoaXMuYnVja2V0U3RhY2sucG9wKClcblxuICAgIGlmICghYWN0aXZlQnVja2V0KSB0aHJvdyBuZXcgRXJyb3IoXCJObyBhY3RpdmUgcmVxdWVzdCB0aW1pbmcgYnVja2V0XCIpXG5cbiAgICB0aGlzLmJ1Y2tldHNbYWN0aXZlQnVja2V0LmJ1Y2tldF0gKz0gbm93IC0gYWN0aXZlQnVja2V0LnN0YXJ0ZWRBdE1zXG5cbiAgICBjb25zdCBwYXJlbnRCdWNrZXQgPSB0aGlzLmJ1Y2tldFN0YWNrW3RoaXMuYnVja2V0U3RhY2subGVuZ3RoIC0gMV1cbiAgICBpZiAocGFyZW50QnVja2V0KSBwYXJlbnRCdWNrZXQuc3RhcnRlZEF0TXMgPSBub3dcbiAgfVxufVxuIl19