// @ts-check
/**
 * Platform-neutral persistence and lifecycle contract used by the background-jobs
 * runtime. Adapters own durable queue state; transport and job execution remain
 * separate concerns.
 */
export default class BackgroundJobsAdapter {
    /**
     * Declares exact durable fencing support for release-scoped generations.
     * Third-party adapters must override this only after implementing the full
     * snapshot, owner, report, and recovery contract.
     * @returns {boolean} - Whether generation mode is supported.
     */
    supportsReleaseScopedGenerations() { return false; }
    /**
     * Ensures the adapter can accept work.
     * @returns {Promise<void>} - Resolves when ready.
     */
    async ensureReady() { throw new Error("BackgroundJobsAdapter#ensureReady is not implemented"); }
    /**
     * Closes adapter-owned resources.
     * @returns {Promise<void>} - Resolves after close.
     */
    async close() { }
    /**
     * Reports adapter health.
     * @returns {Promise<import("./types.js").BackgroundJobsHealth>} - Adapter health.
     */
    async health() {
        return { ready: true };
    }
    /**
     * Ensures framework-owned persistence during a migration lifecycle. Non-SQL
     * adapters may leave this as a no-op.
     * @param {{dbs: Record<string, import("../database/drivers/base.js").default>}} _args - Migrated databases.
     * @returns {Promise<void>} - Resolves when complete.
     */
    async ensureFrameworkSchema(_args) { }
    /**
     * Reconciles configured queue limits.
     * @returns {Promise<void>} - Resolves after reconciliation.
     */
    async reconcileQueueConcurrency() { throw new Error("BackgroundJobsAdapter#reconcileQueueConcurrency is not implemented"); }
    /**
     * Enqueues a job.
     * @param {{jobName: string, args: Array<ReturnType<typeof JSON.parse>>, options?: import("./types.js").BackgroundJobOptions}} _args - Job request.
     * @returns {Promise<string>} - Job id.
     */
    async enqueue(_args) { throw new Error("BackgroundJobsAdapter#enqueue is not implemented"); }
    /**
     * Replaces the owner of a stable schedule key.
     * @param {{scheduleKey: string, jobName: string, args: Array<ReturnType<typeof JSON.parse>>, options?: import("./types.js").BackgroundJobOptions}} _args - Replacement request.
     * @returns {Promise<import("./types.js").BackgroundJobReplacementResult>} - Replacement result.
     */
    async replaceScheduled(_args) { throw new Error("BackgroundJobsAdapter#replaceScheduled is not implemented"); }
    /**
     * Cancels the owner of a stable schedule key.
     * @param {string} _scheduleKey - Stable schedule key.
     * @returns {Promise<import("./types.js").BackgroundJobCancellationResult>} - Cancellation result.
     */
    async cancelScheduled(_scheduleKey) { throw new Error("BackgroundJobsAdapter#cancelScheduled is not implemented"); }
    /**
     * Finds the next eligible job.
     * @param {{executionMode?: import("./types.js").BackgroundJobExecutionMode | import("./types.js").BackgroundJobExecutionMode[]}} [_args] - Dequeue filters.
     * @returns {Promise<import("./types.js").BackgroundJobRow | null>} - Next eligible job.
     */
    async nextAvailableJob(_args = {}) { throw new Error("BackgroundJobsAdapter#nextAvailableJob is not implemented"); }
    /**
     * Finds the soonest future job.
     * @returns {Promise<import("./types.js").BackgroundJobRow | null>} - Soonest future job.
     */
    async nextScheduledJob() { throw new Error("BackgroundJobsAdapter#nextScheduledJob is not implemented"); }
    /**
     * Reads one job.
     * @param {string} _jobId - Job id.
     * @returns {Promise<import("./types.js").BackgroundJobRow | null>} - Job row.
     */
    async getJob(_jobId) { throw new Error("BackgroundJobsAdapter#getJob is not implemented"); }
    /**
     * Starts a job by claiming its durable handoff.
     * When `handoffId` is supplied, the adapter must persist and return that exact
     * id so the caller can fence an ambiguous commit acknowledgement.
     * @param {import("./types.js").BackgroundJobHandoffRequest} _args - Handoff request.
     * @returns {Promise<import("./types.js").BackgroundJobHandoff | null>} - Claimed handoff.
     */
    async markHandedOff(_args) { throw new Error("BackgroundJobsAdapter#markHandedOff is not implemented"); }
    /**
     * Marks a handed-off job successful.
     * @param {{jobId: string, handoffId?: string, workerId?: string, handedOffAtMs?: number}} _args - Completion report.
     * @returns {Promise<boolean>} - Whether the fenced report was accepted.
     */
    async markCompleted(_args) { throw new Error("BackgroundJobsAdapter#markCompleted is not implemented"); }
    /**
     * Returns a handed-off job to its schedule.
     * @param {{jobId: string, delayMs: number, handoffId?: string, workerId?: string, handedOffAtMs?: number}} _args - Reschedule report.
     * @returns {Promise<boolean>} - Whether the fenced report was accepted.
     */
    async markRescheduled(_args) { throw new Error("BackgroundJobsAdapter#markRescheduled is not implemented"); }
    /**
     * Returns a handed-off job to the queue.
     * @param {{jobId: string, handoffId: string}} _args - Handoff release.
     * @returns {Promise<void>} - Resolves after the job is returned.
     */
    async markReturnedToQueue(_args) { throw new Error("BackgroundJobsAdapter#markReturnedToQueue is not implemented"); }
    /**
     * Finds active handoffs for a worker.
     * @param {{workerId: string}} _args - Worker identity.
     * @returns {Promise<Array<{jobId: string, handoffId: string}>>} - Active worker handoffs.
     */
    async handedOffJobsForWorker(_args) { throw new Error("BackgroundJobsAdapter#handedOffJobsForWorker is not implemented"); }
    /**
     * Snapshots exact active handoffs before a new main generation accepts worker
     * reconnects. Adapters that do not persist worker leases may return none.
     * @returns {Promise<import("./types.js").BackgroundJobHandoffSnapshot[]>} - Exact active handoffs.
     */
    async snapshotHandedOffJobs() { return []; }
    /**
     * Applies orphan failure semantics to unchanged exact handoff snapshots.
     * Adapters that return startup snapshots must implement the matching fenced
     * transition.
     * @param {{handoffs: import("./types.js").BackgroundJobHandoffSnapshot[], error: ReturnType<typeof JSON.parse>}} _args - Exact leases and orphan reason.
     * @returns {Promise<import("./types.js").BackgroundJobRow[]>} - Accepted transitions.
     */
    async markOrphanedHandoffs(_args) { return []; }
    /**
     * Marks a handed-off job failed or retryable.
     * @param {{jobId: string, error: ReturnType<typeof JSON.parse>, handoffId?: string, workerId?: string, handedOffAtMs?: number}} _args - Failure report.
     * @returns {Promise<import("./types.js").BackgroundJobRow | null>} - Updated job when accepted.
     */
    async markFailed(_args) { throw new Error("BackgroundJobsAdapter#markFailed is not implemented"); }
    /**
     * Reclaims expired handoffs.
     * @param {{orphanedAfterMs?: number}} [_args] - Sweep options.
     * @returns {Promise<import("./types.js").BackgroundJobRow[]>} - Newly orphaned jobs.
     */
    async markOrphanedJobs(_args = {}) { throw new Error("BackgroundJobsAdapter#markOrphanedJobs is not implemented"); }
    /**
     * Prunes terminal jobs past their retention windows.
     * @param {{completedTtlMs?: number | null, failedTtlMs?: number | null, batchSize?: number}} [_args] - Retention options.
     * @returns {Promise<number>} - Deleted rows.
     */
    async pruneTerminalJobs(_args = {}) { throw new Error("BackgroundJobsAdapter#pruneTerminalJobs is not implemented"); }
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiYWRhcHRlci5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uLy4uLy4uL3NyYy9iYWNrZ3JvdW5kLWpvYnMvYWRhcHRlci5qcyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiQUFBQSxZQUFZO0FBRVo7Ozs7R0FJRztBQUNILE1BQU0sQ0FBQyxPQUFPLE9BQU8scUJBQXFCO0lBQ3hDOzs7OztPQUtHO0lBQ0gsZ0NBQWdDLEtBQUssT0FBTyxLQUFLLENBQUEsQ0FBQyxDQUFDO0lBRW5EOzs7T0FHRztJQUNILEtBQUssQ0FBQyxXQUFXLEtBQUssTUFBTSxJQUFJLEtBQUssQ0FBQyxzREFBc0QsQ0FBQyxDQUFBLENBQUMsQ0FBQztJQUUvRjs7O09BR0c7SUFDSCxLQUFLLENBQUMsS0FBSyxLQUFJLENBQUM7SUFFaEI7OztPQUdHO0lBQ0gsS0FBSyxDQUFDLE1BQU07UUFDVixPQUFPLEVBQUMsS0FBSyxFQUFFLElBQUksRUFBQyxDQUFBO0lBQ3RCLENBQUM7SUFFRDs7Ozs7T0FLRztJQUNILEtBQUssQ0FBQyxxQkFBcUIsQ0FBQyxLQUFLLElBQUcsQ0FBQztJQUVyQzs7O09BR0c7SUFDSCxLQUFLLENBQUMseUJBQXlCLEtBQUssTUFBTSxJQUFJLEtBQUssQ0FBQyxvRUFBb0UsQ0FBQyxDQUFBLENBQUMsQ0FBQztJQUUzSDs7OztPQUlHO0lBQ0gsS0FBSyxDQUFDLE9BQU8sQ0FBQyxLQUFLLElBQUksTUFBTSxJQUFJLEtBQUssQ0FBQyxrREFBa0QsQ0FBQyxDQUFBLENBQUMsQ0FBQztJQUU1Rjs7OztPQUlHO0lBQ0gsS0FBSyxDQUFDLGdCQUFnQixDQUFDLEtBQUssSUFBSSxNQUFNLElBQUksS0FBSyxDQUFDLDJEQUEyRCxDQUFDLENBQUEsQ0FBQyxDQUFDO0lBRTlHOzs7O09BSUc7SUFDSCxLQUFLLENBQUMsZUFBZSxDQUFDLFlBQVksSUFBSSxNQUFNLElBQUksS0FBSyxDQUFDLDBEQUEwRCxDQUFDLENBQUEsQ0FBQyxDQUFDO0lBRW5IOzs7O09BSUc7SUFDSCxLQUFLLENBQUMsZ0JBQWdCLENBQUMsS0FBSyxHQUFHLEVBQUUsSUFBSSxNQUFNLElBQUksS0FBSyxDQUFDLDJEQUEyRCxDQUFDLENBQUEsQ0FBQyxDQUFDO0lBRW5IOzs7T0FHRztJQUNILEtBQUssQ0FBQyxnQkFBZ0IsS0FBSyxNQUFNLElBQUksS0FBSyxDQUFDLDJEQUEyRCxDQUFDLENBQUEsQ0FBQyxDQUFDO0lBRXpHOzs7O09BSUc7SUFDSCxLQUFLLENBQUMsTUFBTSxDQUFDLE1BQU0sSUFBSSxNQUFNLElBQUksS0FBSyxDQUFDLGlEQUFpRCxDQUFDLENBQUEsQ0FBQyxDQUFDO0lBRTNGOzs7Ozs7T0FNRztJQUNILEtBQUssQ0FBQyxhQUFhLENBQUMsS0FBSyxJQUFJLE1BQU0sSUFBSSxLQUFLLENBQUMsd0RBQXdELENBQUMsQ0FBQSxDQUFDLENBQUM7SUFFeEc7Ozs7T0FJRztJQUNILEtBQUssQ0FBQyxhQUFhLENBQUMsS0FBSyxJQUFJLE1BQU0sSUFBSSxLQUFLLENBQUMsd0RBQXdELENBQUMsQ0FBQSxDQUFDLENBQUM7SUFFeEc7Ozs7T0FJRztJQUNILEtBQUssQ0FBQyxlQUFlLENBQUMsS0FBSyxJQUFJLE1BQU0sSUFBSSxLQUFLLENBQUMsMERBQTBELENBQUMsQ0FBQSxDQUFDLENBQUM7SUFFNUc7Ozs7T0FJRztJQUNILEtBQUssQ0FBQyxtQkFBbUIsQ0FBQyxLQUFLLElBQUksTUFBTSxJQUFJLEtBQUssQ0FBQyw4REFBOEQsQ0FBQyxDQUFBLENBQUMsQ0FBQztJQUVwSDs7OztPQUlHO0lBQ0gsS0FBSyxDQUFDLHNCQUFzQixDQUFDLEtBQUssSUFBSSxNQUFNLElBQUksS0FBSyxDQUFDLGlFQUFpRSxDQUFDLENBQUEsQ0FBQyxDQUFDO0lBRTFIOzs7O09BSUc7SUFDSCxLQUFLLENBQUMscUJBQXFCLEtBQUssT0FBTyxFQUFFLENBQUEsQ0FBQyxDQUFDO0lBRTNDOzs7Ozs7T0FNRztJQUNILEtBQUssQ0FBQyxvQkFBb0IsQ0FBQyxLQUFLLElBQUksT0FBTyxFQUFFLENBQUEsQ0FBQyxDQUFDO0lBRS9DOzs7O09BSUc7SUFDSCxLQUFLLENBQUMsVUFBVSxDQUFDLEtBQUssSUFBSSxNQUFNLElBQUksS0FBSyxDQUFDLHFEQUFxRCxDQUFDLENBQUEsQ0FBQyxDQUFDO0lBRWxHOzs7O09BSUc7SUFDSCxLQUFLLENBQUMsZ0JBQWdCLENBQUMsS0FBSyxHQUFHLEVBQUUsSUFBSSxNQUFNLElBQUksS0FBSyxDQUFDLDJEQUEyRCxDQUFDLENBQUEsQ0FBQyxDQUFDO0lBRW5IOzs7O09BSUc7SUFDSCxLQUFLLENBQUMsaUJBQWlCLENBQUMsS0FBSyxHQUFHLEVBQUUsSUFBSSxNQUFNLElBQUksS0FBSyxDQUFDLDREQUE0RCxDQUFDLENBQUEsQ0FBQyxDQUFDO0NBQ3RIIiwic291cmNlc0NvbnRlbnQiOlsiLy8gQHRzLWNoZWNrXG5cbi8qKlxuICogUGxhdGZvcm0tbmV1dHJhbCBwZXJzaXN0ZW5jZSBhbmQgbGlmZWN5Y2xlIGNvbnRyYWN0IHVzZWQgYnkgdGhlIGJhY2tncm91bmQtam9ic1xuICogcnVudGltZS4gQWRhcHRlcnMgb3duIGR1cmFibGUgcXVldWUgc3RhdGU7IHRyYW5zcG9ydCBhbmQgam9iIGV4ZWN1dGlvbiByZW1haW5cbiAqIHNlcGFyYXRlIGNvbmNlcm5zLlxuICovXG5leHBvcnQgZGVmYXVsdCBjbGFzcyBCYWNrZ3JvdW5kSm9ic0FkYXB0ZXIge1xuICAvKipcbiAgICogRGVjbGFyZXMgZXhhY3QgZHVyYWJsZSBmZW5jaW5nIHN1cHBvcnQgZm9yIHJlbGVhc2Utc2NvcGVkIGdlbmVyYXRpb25zLlxuICAgKiBUaGlyZC1wYXJ0eSBhZGFwdGVycyBtdXN0IG92ZXJyaWRlIHRoaXMgb25seSBhZnRlciBpbXBsZW1lbnRpbmcgdGhlIGZ1bGxcbiAgICogc25hcHNob3QsIG93bmVyLCByZXBvcnQsIGFuZCByZWNvdmVyeSBjb250cmFjdC5cbiAgICogQHJldHVybnMge2Jvb2xlYW59IC0gV2hldGhlciBnZW5lcmF0aW9uIG1vZGUgaXMgc3VwcG9ydGVkLlxuICAgKi9cbiAgc3VwcG9ydHNSZWxlYXNlU2NvcGVkR2VuZXJhdGlvbnMoKSB7IHJldHVybiBmYWxzZSB9XG5cbiAgLyoqXG4gICAqIEVuc3VyZXMgdGhlIGFkYXB0ZXIgY2FuIGFjY2VwdCB3b3JrLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyB3aGVuIHJlYWR5LlxuICAgKi9cbiAgYXN5bmMgZW5zdXJlUmVhZHkoKSB7IHRocm93IG5ldyBFcnJvcihcIkJhY2tncm91bmRKb2JzQWRhcHRlciNlbnN1cmVSZWFkeSBpcyBub3QgaW1wbGVtZW50ZWRcIikgfVxuXG4gIC8qKlxuICAgKiBDbG9zZXMgYWRhcHRlci1vd25lZCByZXNvdXJjZXMuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIGFmdGVyIGNsb3NlLlxuICAgKi9cbiAgYXN5bmMgY2xvc2UoKSB7fVxuXG4gIC8qKlxuICAgKiBSZXBvcnRzIGFkYXB0ZXIgaGVhbHRoLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxpbXBvcnQoXCIuL3R5cGVzLmpzXCIpLkJhY2tncm91bmRKb2JzSGVhbHRoPn0gLSBBZGFwdGVyIGhlYWx0aC5cbiAgICovXG4gIGFzeW5jIGhlYWx0aCgpIHtcbiAgICByZXR1cm4ge3JlYWR5OiB0cnVlfVxuICB9XG5cbiAgLyoqXG4gICAqIEVuc3VyZXMgZnJhbWV3b3JrLW93bmVkIHBlcnNpc3RlbmNlIGR1cmluZyBhIG1pZ3JhdGlvbiBsaWZlY3ljbGUuIE5vbi1TUUxcbiAgICogYWRhcHRlcnMgbWF5IGxlYXZlIHRoaXMgYXMgYSBuby1vcC5cbiAgICogQHBhcmFtIHt7ZGJzOiBSZWNvcmQ8c3RyaW5nLCBpbXBvcnQoXCIuLi9kYXRhYmFzZS9kcml2ZXJzL2Jhc2UuanNcIikuZGVmYXVsdD59fSBfYXJncyAtIE1pZ3JhdGVkIGRhdGFiYXNlcy5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgd2hlbiBjb21wbGV0ZS5cbiAgICovXG4gIGFzeW5jIGVuc3VyZUZyYW1ld29ya1NjaGVtYShfYXJncykge31cblxuICAvKipcbiAgICogUmVjb25jaWxlcyBjb25maWd1cmVkIHF1ZXVlIGxpbWl0cy5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgYWZ0ZXIgcmVjb25jaWxpYXRpb24uXG4gICAqL1xuICBhc3luYyByZWNvbmNpbGVRdWV1ZUNvbmN1cnJlbmN5KCkgeyB0aHJvdyBuZXcgRXJyb3IoXCJCYWNrZ3JvdW5kSm9ic0FkYXB0ZXIjcmVjb25jaWxlUXVldWVDb25jdXJyZW5jeSBpcyBub3QgaW1wbGVtZW50ZWRcIikgfVxuXG4gIC8qKlxuICAgKiBFbnF1ZXVlcyBhIGpvYi5cbiAgICogQHBhcmFtIHt7am9iTmFtZTogc3RyaW5nLCBhcmdzOiBBcnJheTxSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj4sIG9wdGlvbnM/OiBpbXBvcnQoXCIuL3R5cGVzLmpzXCIpLkJhY2tncm91bmRKb2JPcHRpb25zfX0gX2FyZ3MgLSBKb2IgcmVxdWVzdC5cbiAgICogQHJldHVybnMge1Byb21pc2U8c3RyaW5nPn0gLSBKb2IgaWQuXG4gICAqL1xuICBhc3luYyBlbnF1ZXVlKF9hcmdzKSB7IHRocm93IG5ldyBFcnJvcihcIkJhY2tncm91bmRKb2JzQWRhcHRlciNlbnF1ZXVlIGlzIG5vdCBpbXBsZW1lbnRlZFwiKSB9XG5cbiAgLyoqXG4gICAqIFJlcGxhY2VzIHRoZSBvd25lciBvZiBhIHN0YWJsZSBzY2hlZHVsZSBrZXkuXG4gICAqIEBwYXJhbSB7e3NjaGVkdWxlS2V5OiBzdHJpbmcsIGpvYk5hbWU6IHN0cmluZywgYXJnczogQXJyYXk8UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+LCBvcHRpb25zPzogaW1wb3J0KFwiLi90eXBlcy5qc1wiKS5CYWNrZ3JvdW5kSm9iT3B0aW9uc319IF9hcmdzIC0gUmVwbGFjZW1lbnQgcmVxdWVzdC5cbiAgICogQHJldHVybnMge1Byb21pc2U8aW1wb3J0KFwiLi90eXBlcy5qc1wiKS5CYWNrZ3JvdW5kSm9iUmVwbGFjZW1lbnRSZXN1bHQ+fSAtIFJlcGxhY2VtZW50IHJlc3VsdC5cbiAgICovXG4gIGFzeW5jIHJlcGxhY2VTY2hlZHVsZWQoX2FyZ3MpIHsgdGhyb3cgbmV3IEVycm9yKFwiQmFja2dyb3VuZEpvYnNBZGFwdGVyI3JlcGxhY2VTY2hlZHVsZWQgaXMgbm90IGltcGxlbWVudGVkXCIpIH1cblxuICAvKipcbiAgICogQ2FuY2VscyB0aGUgb3duZXIgb2YgYSBzdGFibGUgc2NoZWR1bGUga2V5LlxuICAgKiBAcGFyYW0ge3N0cmluZ30gX3NjaGVkdWxlS2V5IC0gU3RhYmxlIHNjaGVkdWxlIGtleS5cbiAgICogQHJldHVybnMge1Byb21pc2U8aW1wb3J0KFwiLi90eXBlcy5qc1wiKS5CYWNrZ3JvdW5kSm9iQ2FuY2VsbGF0aW9uUmVzdWx0Pn0gLSBDYW5jZWxsYXRpb24gcmVzdWx0LlxuICAgKi9cbiAgYXN5bmMgY2FuY2VsU2NoZWR1bGVkKF9zY2hlZHVsZUtleSkgeyB0aHJvdyBuZXcgRXJyb3IoXCJCYWNrZ3JvdW5kSm9ic0FkYXB0ZXIjY2FuY2VsU2NoZWR1bGVkIGlzIG5vdCBpbXBsZW1lbnRlZFwiKSB9XG5cbiAgLyoqXG4gICAqIEZpbmRzIHRoZSBuZXh0IGVsaWdpYmxlIGpvYi5cbiAgICogQHBhcmFtIHt7ZXhlY3V0aW9uTW9kZT86IGltcG9ydChcIi4vdHlwZXMuanNcIikuQmFja2dyb3VuZEpvYkV4ZWN1dGlvbk1vZGUgfCBpbXBvcnQoXCIuL3R5cGVzLmpzXCIpLkJhY2tncm91bmRKb2JFeGVjdXRpb25Nb2RlW119fSBbX2FyZ3NdIC0gRGVxdWV1ZSBmaWx0ZXJzLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxpbXBvcnQoXCIuL3R5cGVzLmpzXCIpLkJhY2tncm91bmRKb2JSb3cgfCBudWxsPn0gLSBOZXh0IGVsaWdpYmxlIGpvYi5cbiAgICovXG4gIGFzeW5jIG5leHRBdmFpbGFibGVKb2IoX2FyZ3MgPSB7fSkgeyB0aHJvdyBuZXcgRXJyb3IoXCJCYWNrZ3JvdW5kSm9ic0FkYXB0ZXIjbmV4dEF2YWlsYWJsZUpvYiBpcyBub3QgaW1wbGVtZW50ZWRcIikgfVxuXG4gIC8qKlxuICAgKiBGaW5kcyB0aGUgc29vbmVzdCBmdXR1cmUgam9iLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxpbXBvcnQoXCIuL3R5cGVzLmpzXCIpLkJhY2tncm91bmRKb2JSb3cgfCBudWxsPn0gLSBTb29uZXN0IGZ1dHVyZSBqb2IuXG4gICAqL1xuICBhc3luYyBuZXh0U2NoZWR1bGVkSm9iKCkgeyB0aHJvdyBuZXcgRXJyb3IoXCJCYWNrZ3JvdW5kSm9ic0FkYXB0ZXIjbmV4dFNjaGVkdWxlZEpvYiBpcyBub3QgaW1wbGVtZW50ZWRcIikgfVxuXG4gIC8qKlxuICAgKiBSZWFkcyBvbmUgam9iLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gX2pvYklkIC0gSm9iIGlkLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxpbXBvcnQoXCIuL3R5cGVzLmpzXCIpLkJhY2tncm91bmRKb2JSb3cgfCBudWxsPn0gLSBKb2Igcm93LlxuICAgKi9cbiAgYXN5bmMgZ2V0Sm9iKF9qb2JJZCkgeyB0aHJvdyBuZXcgRXJyb3IoXCJCYWNrZ3JvdW5kSm9ic0FkYXB0ZXIjZ2V0Sm9iIGlzIG5vdCBpbXBsZW1lbnRlZFwiKSB9XG5cbiAgLyoqXG4gICAqIFN0YXJ0cyBhIGpvYiBieSBjbGFpbWluZyBpdHMgZHVyYWJsZSBoYW5kb2ZmLlxuICAgKiBXaGVuIGBoYW5kb2ZmSWRgIGlzIHN1cHBsaWVkLCB0aGUgYWRhcHRlciBtdXN0IHBlcnNpc3QgYW5kIHJldHVybiB0aGF0IGV4YWN0XG4gICAqIGlkIHNvIHRoZSBjYWxsZXIgY2FuIGZlbmNlIGFuIGFtYmlndW91cyBjb21taXQgYWNrbm93bGVkZ2VtZW50LlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vdHlwZXMuanNcIikuQmFja2dyb3VuZEpvYkhhbmRvZmZSZXF1ZXN0fSBfYXJncyAtIEhhbmRvZmYgcmVxdWVzdC5cbiAgICogQHJldHVybnMge1Byb21pc2U8aW1wb3J0KFwiLi90eXBlcy5qc1wiKS5CYWNrZ3JvdW5kSm9iSGFuZG9mZiB8IG51bGw+fSAtIENsYWltZWQgaGFuZG9mZi5cbiAgICovXG4gIGFzeW5jIG1hcmtIYW5kZWRPZmYoX2FyZ3MpIHsgdGhyb3cgbmV3IEVycm9yKFwiQmFja2dyb3VuZEpvYnNBZGFwdGVyI21hcmtIYW5kZWRPZmYgaXMgbm90IGltcGxlbWVudGVkXCIpIH1cblxuICAvKipcbiAgICogTWFya3MgYSBoYW5kZWQtb2ZmIGpvYiBzdWNjZXNzZnVsLlxuICAgKiBAcGFyYW0ge3tqb2JJZDogc3RyaW5nLCBoYW5kb2ZmSWQ/OiBzdHJpbmcsIHdvcmtlcklkPzogc3RyaW5nLCBoYW5kZWRPZmZBdE1zPzogbnVtYmVyfX0gX2FyZ3MgLSBDb21wbGV0aW9uIHJlcG9ydC5cbiAgICogQHJldHVybnMge1Byb21pc2U8Ym9vbGVhbj59IC0gV2hldGhlciB0aGUgZmVuY2VkIHJlcG9ydCB3YXMgYWNjZXB0ZWQuXG4gICAqL1xuICBhc3luYyBtYXJrQ29tcGxldGVkKF9hcmdzKSB7IHRocm93IG5ldyBFcnJvcihcIkJhY2tncm91bmRKb2JzQWRhcHRlciNtYXJrQ29tcGxldGVkIGlzIG5vdCBpbXBsZW1lbnRlZFwiKSB9XG5cbiAgLyoqXG4gICAqIFJldHVybnMgYSBoYW5kZWQtb2ZmIGpvYiB0byBpdHMgc2NoZWR1bGUuXG4gICAqIEBwYXJhbSB7e2pvYklkOiBzdHJpbmcsIGRlbGF5TXM6IG51bWJlciwgaGFuZG9mZklkPzogc3RyaW5nLCB3b3JrZXJJZD86IHN0cmluZywgaGFuZGVkT2ZmQXRNcz86IG51bWJlcn19IF9hcmdzIC0gUmVzY2hlZHVsZSByZXBvcnQuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPGJvb2xlYW4+fSAtIFdoZXRoZXIgdGhlIGZlbmNlZCByZXBvcnQgd2FzIGFjY2VwdGVkLlxuICAgKi9cbiAgYXN5bmMgbWFya1Jlc2NoZWR1bGVkKF9hcmdzKSB7IHRocm93IG5ldyBFcnJvcihcIkJhY2tncm91bmRKb2JzQWRhcHRlciNtYXJrUmVzY2hlZHVsZWQgaXMgbm90IGltcGxlbWVudGVkXCIpIH1cblxuICAvKipcbiAgICogUmV0dXJucyBhIGhhbmRlZC1vZmYgam9iIHRvIHRoZSBxdWV1ZS5cbiAgICogQHBhcmFtIHt7am9iSWQ6IHN0cmluZywgaGFuZG9mZklkOiBzdHJpbmd9fSBfYXJncyAtIEhhbmRvZmYgcmVsZWFzZS5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgYWZ0ZXIgdGhlIGpvYiBpcyByZXR1cm5lZC5cbiAgICovXG4gIGFzeW5jIG1hcmtSZXR1cm5lZFRvUXVldWUoX2FyZ3MpIHsgdGhyb3cgbmV3IEVycm9yKFwiQmFja2dyb3VuZEpvYnNBZGFwdGVyI21hcmtSZXR1cm5lZFRvUXVldWUgaXMgbm90IGltcGxlbWVudGVkXCIpIH1cblxuICAvKipcbiAgICogRmluZHMgYWN0aXZlIGhhbmRvZmZzIGZvciBhIHdvcmtlci5cbiAgICogQHBhcmFtIHt7d29ya2VySWQ6IHN0cmluZ319IF9hcmdzIC0gV29ya2VyIGlkZW50aXR5LlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxBcnJheTx7am9iSWQ6IHN0cmluZywgaGFuZG9mZklkOiBzdHJpbmd9Pj59IC0gQWN0aXZlIHdvcmtlciBoYW5kb2Zmcy5cbiAgICovXG4gIGFzeW5jIGhhbmRlZE9mZkpvYnNGb3JXb3JrZXIoX2FyZ3MpIHsgdGhyb3cgbmV3IEVycm9yKFwiQmFja2dyb3VuZEpvYnNBZGFwdGVyI2hhbmRlZE9mZkpvYnNGb3JXb3JrZXIgaXMgbm90IGltcGxlbWVudGVkXCIpIH1cblxuICAvKipcbiAgICogU25hcHNob3RzIGV4YWN0IGFjdGl2ZSBoYW5kb2ZmcyBiZWZvcmUgYSBuZXcgbWFpbiBnZW5lcmF0aW9uIGFjY2VwdHMgd29ya2VyXG4gICAqIHJlY29ubmVjdHMuIEFkYXB0ZXJzIHRoYXQgZG8gbm90IHBlcnNpc3Qgd29ya2VyIGxlYXNlcyBtYXkgcmV0dXJuIG5vbmUuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPGltcG9ydChcIi4vdHlwZXMuanNcIikuQmFja2dyb3VuZEpvYkhhbmRvZmZTbmFwc2hvdFtdPn0gLSBFeGFjdCBhY3RpdmUgaGFuZG9mZnMuXG4gICAqL1xuICBhc3luYyBzbmFwc2hvdEhhbmRlZE9mZkpvYnMoKSB7IHJldHVybiBbXSB9XG5cbiAgLyoqXG4gICAqIEFwcGxpZXMgb3JwaGFuIGZhaWx1cmUgc2VtYW50aWNzIHRvIHVuY2hhbmdlZCBleGFjdCBoYW5kb2ZmIHNuYXBzaG90cy5cbiAgICogQWRhcHRlcnMgdGhhdCByZXR1cm4gc3RhcnR1cCBzbmFwc2hvdHMgbXVzdCBpbXBsZW1lbnQgdGhlIG1hdGNoaW5nIGZlbmNlZFxuICAgKiB0cmFuc2l0aW9uLlxuICAgKiBAcGFyYW0ge3toYW5kb2ZmczogaW1wb3J0KFwiLi90eXBlcy5qc1wiKS5CYWNrZ3JvdW5kSm9iSGFuZG9mZlNuYXBzaG90W10sIGVycm9yOiBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn19IF9hcmdzIC0gRXhhY3QgbGVhc2VzIGFuZCBvcnBoYW4gcmVhc29uLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxpbXBvcnQoXCIuL3R5cGVzLmpzXCIpLkJhY2tncm91bmRKb2JSb3dbXT59IC0gQWNjZXB0ZWQgdHJhbnNpdGlvbnMuXG4gICAqL1xuICBhc3luYyBtYXJrT3JwaGFuZWRIYW5kb2ZmcyhfYXJncykgeyByZXR1cm4gW10gfVxuXG4gIC8qKlxuICAgKiBNYXJrcyBhIGhhbmRlZC1vZmYgam9iIGZhaWxlZCBvciByZXRyeWFibGUuXG4gICAqIEBwYXJhbSB7e2pvYklkOiBzdHJpbmcsIGVycm9yOiBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPiwgaGFuZG9mZklkPzogc3RyaW5nLCB3b3JrZXJJZD86IHN0cmluZywgaGFuZGVkT2ZmQXRNcz86IG51bWJlcn19IF9hcmdzIC0gRmFpbHVyZSByZXBvcnQuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPGltcG9ydChcIi4vdHlwZXMuanNcIikuQmFja2dyb3VuZEpvYlJvdyB8IG51bGw+fSAtIFVwZGF0ZWQgam9iIHdoZW4gYWNjZXB0ZWQuXG4gICAqL1xuICBhc3luYyBtYXJrRmFpbGVkKF9hcmdzKSB7IHRocm93IG5ldyBFcnJvcihcIkJhY2tncm91bmRKb2JzQWRhcHRlciNtYXJrRmFpbGVkIGlzIG5vdCBpbXBsZW1lbnRlZFwiKSB9XG5cbiAgLyoqXG4gICAqIFJlY2xhaW1zIGV4cGlyZWQgaGFuZG9mZnMuXG4gICAqIEBwYXJhbSB7e29ycGhhbmVkQWZ0ZXJNcz86IG51bWJlcn19IFtfYXJnc10gLSBTd2VlcCBvcHRpb25zLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxpbXBvcnQoXCIuL3R5cGVzLmpzXCIpLkJhY2tncm91bmRKb2JSb3dbXT59IC0gTmV3bHkgb3JwaGFuZWQgam9icy5cbiAgICovXG4gIGFzeW5jIG1hcmtPcnBoYW5lZEpvYnMoX2FyZ3MgPSB7fSkgeyB0aHJvdyBuZXcgRXJyb3IoXCJCYWNrZ3JvdW5kSm9ic0FkYXB0ZXIjbWFya09ycGhhbmVkSm9icyBpcyBub3QgaW1wbGVtZW50ZWRcIikgfVxuXG4gIC8qKlxuICAgKiBQcnVuZXMgdGVybWluYWwgam9icyBwYXN0IHRoZWlyIHJldGVudGlvbiB3aW5kb3dzLlxuICAgKiBAcGFyYW0ge3tjb21wbGV0ZWRUdGxNcz86IG51bWJlciB8IG51bGwsIGZhaWxlZFR0bE1zPzogbnVtYmVyIHwgbnVsbCwgYmF0Y2hTaXplPzogbnVtYmVyfX0gW19hcmdzXSAtIFJldGVudGlvbiBvcHRpb25zLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxudW1iZXI+fSAtIERlbGV0ZWQgcm93cy5cbiAgICovXG4gIGFzeW5jIHBydW5lVGVybWluYWxKb2JzKF9hcmdzID0ge30pIHsgdGhyb3cgbmV3IEVycm9yKFwiQmFja2dyb3VuZEpvYnNBZGFwdGVyI3BydW5lVGVybWluYWxKb2JzIGlzIG5vdCBpbXBsZW1lbnRlZFwiKSB9XG59XG4iXX0=