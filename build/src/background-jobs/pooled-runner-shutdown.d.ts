/** Maximum job ids copied into a pooled-child shutdown observation or failure snapshot. */
export declare const POOLED_RUNNER_INFLIGHT_JOB_ID_LIMIT = 100;
/** @type {readonly import("./types.js").PooledChildShutdownReason[]} */
export declare const POOLED_CHILD_SHUTDOWN_REASONS: readonly import("./types.js").PooledChildShutdownReason[];
/**
 * Checks one dynamic IPC reason against the complete shutdown contract.
 * @param {ReturnType<typeof JSON.parse>} value - Candidate shutdown reason.
 * @returns {value is import("./types.js").PooledChildShutdownReason} - Whether the value is a known reason.
 */
export declare function isPooledChildShutdownReason(value: ReturnType<typeof JSON.parse>): value is import("./types.js").PooledChildShutdownReason;
/**
 * Checks one dynamic IPC value against Node's named process signals.
 * @param {ReturnType<typeof JSON.parse>} value - Candidate signal.
 * @returns {value is import("node:child_process").ChildProcess["signalCode"]} - Whether the value is null or a named signal.
 */
export declare function isPooledChildShutdownSignal(value: ReturnType<typeof JSON.parse>): value is import("node:child_process").ChildProcess["signalCode"];
/**
 * Sorts, deduplicates, and bounds job ids before they cross IPC/report boundaries.
 * @param {Iterable<string>} jobIds - In-flight durable job ids.
 * @returns {{inflightJobIds: string[], inflightJobIdsTruncatedCount: number}} - Bounded snapshot.
 */
export declare function boundedPooledRunnerInflightJobIds(jobIds: Iterable<string>): {
    inflightJobIds: string[];
    inflightJobIdsTruncatedCount: number;
};
//# sourceMappingURL=pooled-runner-shutdown.d.ts.map