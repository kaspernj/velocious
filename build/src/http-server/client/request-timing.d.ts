export type RequestTimingBucket = "controller" | "db" | "views";
export type ActiveTimingBucket = {
    bucket: RequestTimingBucket;
    startedAtMs: number;
};
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
    buckets: Record<RequestTimingBucket, number>;
    /**
     * Bucket stack.
     * @type {ActiveTimingBucket[]} */
    bucketStack: ActiveTimingBucket[];
    dbQueryCount: number;
    /** @type {Set<string>} */
    logSensitiveValues: Set<string>;
    /**
     * Completed log method.
     * @type {"debug" | "info" | undefined} */
    completedLogMethod: "debug" | "info" | undefined;
    /**
     * Completed log subject.
     * @type {string | undefined} */
    completedLogSubject: string | undefined;
    /**
     * Response served at ms.
     * @type {number | undefined} */
    responseServedAtMs: number | undefined;
    startedAtMs: number;
    /**
     * Registers exact sensitive values owned by this request lifecycle.
     * @param {Set<string>} values - Sensitive value representations.
     * @returns {void} - No return value.
     */
    registerLogSensitiveValues(values: Set<string>): void;
    /**
     * Gets the sensitive values owned by this request lifecycle.
     * @returns {Set<string>} - Request-local sensitive value representations.
     */
    getLogSensitiveValues(): Set<string>;
    /**
     * Runs measure.
     * @template T
     * @param {RequestTimingBucket} bucket - Bucket name.
     * @param {() => Promise<T> | T} callback - Callback to measure.
     * @returns {Promise<T>} - Callback result.
     */
    measure<T>(bucket: RequestTimingBucket, callback: () => Promise<T> | T): Promise<T>;
    /**
     * Runs measure sync.
     * @template T
     * @param {RequestTimingBucket} bucket - Bucket name.
     * @param {() => T} callback - Callback to measure.
     * @returns {T} - Callback result.
     */
    measureSync<T>(bucket: RequestTimingBucket, callback: () => T): T;
    /**
     * Runs measure db query.
     * @template T
     * @param {() => Promise<T>} callback - Query callback.
     * @returns {Promise<T>} - Query result.
     */
    measureDbQuery<T>(callback: () => Promise<T>): Promise<T>;
    /**
     * Runs mark response served.
     * @returns {void} - Marks the response as fully served.
     */
    markResponseServed(): void;
    /**
     * Runs summary.
     * @returns {{controllerMs: number, dbMs: number, totalMs: number, velociousMs: number, viewsMs: number, dbQueryCount: number}} - Timing summary.
     */
    summary(): {
        controllerMs: number;
        dbMs: number;
        totalMs: number;
        velociousMs: number;
        viewsMs: number;
        dbQueryCount: number;
    };
    /**
     * Runs bucket totals at.
     * @param {number} now - Timestamp to calculate active bucket elapsed time against.
     * @returns {Record<RequestTimingBucket, number>} - Bucket totals.
     */
    _bucketTotalsAt(now: number): Record<RequestTimingBucket, number>;
    /**
     * Runs push bucket.
     * @param {RequestTimingBucket} bucket - Bucket name.
     * @returns {void} - No return value.
     */
    _pushBucket(bucket: RequestTimingBucket): void;
    /**
     * Runs pop bucket.
     * @returns {void} - No return value.
     */
    _popBucket(): void;
}
//# sourceMappingURL=request-timing.d.ts.map