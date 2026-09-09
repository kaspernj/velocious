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
     * Declares atomic producer-handoff validation plus enqueue support. A
     * generation-capable adapter must override this together with
     * `enqueueFromOwnedHandoff`.
     * @returns {boolean} - Whether atomic owned enqueue is supported.
     */
    supportsOwnedEnqueueFromHandoff() { return false; }
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
     * Repairs drift in adapter-owned durable active concurrency counts. Adapters
     * without duplicate active-count persistence can keep this no-op result.
     * @returns {Promise<import("./types.js").BackgroundJobConcurrencyReconciliation>} - Repair summary.
     */
    async reconcileActiveConcurrency() {
        return { candidateCount: 0, checkedCount: 0, repairedCount: 0, repairs: [], repairsTruncatedCount: 0 };
    }
    /**
     * Enqueues a job.
     * @param {{jobName: string, args: Array<ReturnType<typeof JSON.parse>>, options?: import("./types.js").BackgroundJobOptions}} _args - Job request.
     * @returns {Promise<string>} - Job id.
     */
    async enqueue(_args) { throw new Error("BackgroundJobsAdapter#enqueue is not implemented"); }
    /**
     * Atomically validates an exact producing handoff and enqueues its follow-up.
     * @param {{jobName: string, args: Array<ReturnType<typeof JSON.parse>>, options?: import("./types.js").BackgroundJobOptions, producerProof: import("./types.js").BackgroundJobProducerProof}} _args - Owned enqueue request.
     * @returns {Promise<string>} - Job id.
     */
    async enqueueFromOwnedHandoff(_args) { throw new Error("BackgroundJobsAdapter#enqueueFromOwnedHandoff is not implemented"); }
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiYWRhcHRlci5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uLy4uLy4uL3NyYy9iYWNrZ3JvdW5kLWpvYnMvYWRhcHRlci5qcyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiQUFBQSxZQUFZO0FBRVo7Ozs7R0FJRztBQUNILE1BQU0sQ0FBQyxPQUFPLE9BQU8scUJBQXFCO0lBQ3hDOzs7OztPQUtHO0lBQ0gsZ0NBQWdDLEtBQUssT0FBTyxLQUFLLENBQUEsQ0FBQyxDQUFDO0lBRW5EOzs7OztPQUtHO0lBQ0gsK0JBQStCLEtBQUssT0FBTyxLQUFLLENBQUEsQ0FBQyxDQUFDO0lBRWxEOzs7T0FHRztJQUNILEtBQUssQ0FBQyxXQUFXLEtBQUssTUFBTSxJQUFJLEtBQUssQ0FBQyxzREFBc0QsQ0FBQyxDQUFBLENBQUMsQ0FBQztJQUUvRjs7O09BR0c7SUFDSCxLQUFLLENBQUMsS0FBSyxLQUFJLENBQUM7SUFFaEI7OztPQUdHO0lBQ0gsS0FBSyxDQUFDLE1BQU07UUFDVixPQUFPLEVBQUMsS0FBSyxFQUFFLElBQUksRUFBQyxDQUFBO0lBQ3RCLENBQUM7SUFFRDs7Ozs7T0FLRztJQUNILEtBQUssQ0FBQyxxQkFBcUIsQ0FBQyxLQUFLLElBQUcsQ0FBQztJQUVyQzs7O09BR0c7SUFDSCxLQUFLLENBQUMseUJBQXlCLEtBQUssTUFBTSxJQUFJLEtBQUssQ0FBQyxvRUFBb0UsQ0FBQyxDQUFBLENBQUMsQ0FBQztJQUUzSDs7OztPQUlHO0lBQ0gsS0FBSyxDQUFDLDBCQUEwQjtRQUM5QixPQUFPLEVBQUMsY0FBYyxFQUFFLENBQUMsRUFBRSxZQUFZLEVBQUUsQ0FBQyxFQUFFLGFBQWEsRUFBRSxDQUFDLEVBQUUsT0FBTyxFQUFFLEVBQUUsRUFBRSxxQkFBcUIsRUFBRSxDQUFDLEVBQUMsQ0FBQTtJQUN0RyxDQUFDO0lBRUQ7Ozs7T0FJRztJQUNILEtBQUssQ0FBQyxPQUFPLENBQUMsS0FBSyxJQUFJLE1BQU0sSUFBSSxLQUFLLENBQUMsa0RBQWtELENBQUMsQ0FBQSxDQUFDLENBQUM7SUFFNUY7Ozs7T0FJRztJQUNILEtBQUssQ0FBQyx1QkFBdUIsQ0FBQyxLQUFLLElBQUksTUFBTSxJQUFJLEtBQUssQ0FBQyxrRUFBa0UsQ0FBQyxDQUFBLENBQUMsQ0FBQztJQUU1SDs7OztPQUlHO0lBQ0gsS0FBSyxDQUFDLGdCQUFnQixDQUFDLEtBQUssSUFBSSxNQUFNLElBQUksS0FBSyxDQUFDLDJEQUEyRCxDQUFDLENBQUEsQ0FBQyxDQUFDO0lBRTlHOzs7O09BSUc7SUFDSCxLQUFLLENBQUMsZUFBZSxDQUFDLFlBQVksSUFBSSxNQUFNLElBQUksS0FBSyxDQUFDLDBEQUEwRCxDQUFDLENBQUEsQ0FBQyxDQUFDO0lBRW5IOzs7O09BSUc7SUFDSCxLQUFLLENBQUMsZ0JBQWdCLENBQUMsS0FBSyxHQUFHLEVBQUUsSUFBSSxNQUFNLElBQUksS0FBSyxDQUFDLDJEQUEyRCxDQUFDLENBQUEsQ0FBQyxDQUFDO0lBRW5IOzs7T0FHRztJQUNILEtBQUssQ0FBQyxnQkFBZ0IsS0FBSyxNQUFNLElBQUksS0FBSyxDQUFDLDJEQUEyRCxDQUFDLENBQUEsQ0FBQyxDQUFDO0lBRXpHOzs7O09BSUc7SUFDSCxLQUFLLENBQUMsTUFBTSxDQUFDLE1BQU0sSUFBSSxNQUFNLElBQUksS0FBSyxDQUFDLGlEQUFpRCxDQUFDLENBQUEsQ0FBQyxDQUFDO0lBRTNGOzs7Ozs7T0FNRztJQUNILEtBQUssQ0FBQyxhQUFhLENBQUMsS0FBSyxJQUFJLE1BQU0sSUFBSSxLQUFLLENBQUMsd0RBQXdELENBQUMsQ0FBQSxDQUFDLENBQUM7SUFFeEc7Ozs7T0FJRztJQUNILEtBQUssQ0FBQyxhQUFhLENBQUMsS0FBSyxJQUFJLE1BQU0sSUFBSSxLQUFLLENBQUMsd0RBQXdELENBQUMsQ0FBQSxDQUFDLENBQUM7SUFFeEc7Ozs7T0FJRztJQUNILEtBQUssQ0FBQyxlQUFlLENBQUMsS0FBSyxJQUFJLE1BQU0sSUFBSSxLQUFLLENBQUMsMERBQTBELENBQUMsQ0FBQSxDQUFDLENBQUM7SUFFNUc7Ozs7T0FJRztJQUNILEtBQUssQ0FBQyxtQkFBbUIsQ0FBQyxLQUFLLElBQUksTUFBTSxJQUFJLEtBQUssQ0FBQyw4REFBOEQsQ0FBQyxDQUFBLENBQUMsQ0FBQztJQUVwSDs7OztPQUlHO0lBQ0gsS0FBSyxDQUFDLHNCQUFzQixDQUFDLEtBQUssSUFBSSxNQUFNLElBQUksS0FBSyxDQUFDLGlFQUFpRSxDQUFDLENBQUEsQ0FBQyxDQUFDO0lBRTFIOzs7O09BSUc7SUFDSCxLQUFLLENBQUMscUJBQXFCLEtBQUssT0FBTyxFQUFFLENBQUEsQ0FBQyxDQUFDO0lBRTNDOzs7Ozs7T0FNRztJQUNILEtBQUssQ0FBQyxvQkFBb0IsQ0FBQyxLQUFLLElBQUksT0FBTyxFQUFFLENBQUEsQ0FBQyxDQUFDO0lBRS9DOzs7O09BSUc7SUFDSCxLQUFLLENBQUMsVUFBVSxDQUFDLEtBQUssSUFBSSxNQUFNLElBQUksS0FBSyxDQUFDLHFEQUFxRCxDQUFDLENBQUEsQ0FBQyxDQUFDO0lBRWxHOzs7O09BSUc7SUFDSCxLQUFLLENBQUMsZ0JBQWdCLENBQUMsS0FBSyxHQUFHLEVBQUUsSUFBSSxNQUFNLElBQUksS0FBSyxDQUFDLDJEQUEyRCxDQUFDLENBQUEsQ0FBQyxDQUFDO0lBRW5IOzs7O09BSUc7SUFDSCxLQUFLLENBQUMsaUJBQWlCLENBQUMsS0FBSyxHQUFHLEVBQUUsSUFBSSxNQUFNLElBQUksS0FBSyxDQUFDLDREQUE0RCxDQUFDLENBQUEsQ0FBQyxDQUFDO0NBQ3RIIiwic291cmNlc0NvbnRlbnQiOlsiLy8gQHRzLWNoZWNrXG5cbi8qKlxuICogUGxhdGZvcm0tbmV1dHJhbCBwZXJzaXN0ZW5jZSBhbmQgbGlmZWN5Y2xlIGNvbnRyYWN0IHVzZWQgYnkgdGhlIGJhY2tncm91bmQtam9ic1xuICogcnVudGltZS4gQWRhcHRlcnMgb3duIGR1cmFibGUgcXVldWUgc3RhdGU7IHRyYW5zcG9ydCBhbmQgam9iIGV4ZWN1dGlvbiByZW1haW5cbiAqIHNlcGFyYXRlIGNvbmNlcm5zLlxuICovXG5leHBvcnQgZGVmYXVsdCBjbGFzcyBCYWNrZ3JvdW5kSm9ic0FkYXB0ZXIge1xuICAvKipcbiAgICogRGVjbGFyZXMgZXhhY3QgZHVyYWJsZSBmZW5jaW5nIHN1cHBvcnQgZm9yIHJlbGVhc2Utc2NvcGVkIGdlbmVyYXRpb25zLlxuICAgKiBUaGlyZC1wYXJ0eSBhZGFwdGVycyBtdXN0IG92ZXJyaWRlIHRoaXMgb25seSBhZnRlciBpbXBsZW1lbnRpbmcgdGhlIGZ1bGxcbiAgICogc25hcHNob3QsIG93bmVyLCByZXBvcnQsIGFuZCByZWNvdmVyeSBjb250cmFjdC5cbiAgICogQHJldHVybnMge2Jvb2xlYW59IC0gV2hldGhlciBnZW5lcmF0aW9uIG1vZGUgaXMgc3VwcG9ydGVkLlxuICAgKi9cbiAgc3VwcG9ydHNSZWxlYXNlU2NvcGVkR2VuZXJhdGlvbnMoKSB7IHJldHVybiBmYWxzZSB9XG5cbiAgLyoqXG4gICAqIERlY2xhcmVzIGF0b21pYyBwcm9kdWNlci1oYW5kb2ZmIHZhbGlkYXRpb24gcGx1cyBlbnF1ZXVlIHN1cHBvcnQuIEFcbiAgICogZ2VuZXJhdGlvbi1jYXBhYmxlIGFkYXB0ZXIgbXVzdCBvdmVycmlkZSB0aGlzIHRvZ2V0aGVyIHdpdGhcbiAgICogYGVucXVldWVGcm9tT3duZWRIYW5kb2ZmYC5cbiAgICogQHJldHVybnMge2Jvb2xlYW59IC0gV2hldGhlciBhdG9taWMgb3duZWQgZW5xdWV1ZSBpcyBzdXBwb3J0ZWQuXG4gICAqL1xuICBzdXBwb3J0c093bmVkRW5xdWV1ZUZyb21IYW5kb2ZmKCkgeyByZXR1cm4gZmFsc2UgfVxuXG4gIC8qKlxuICAgKiBFbnN1cmVzIHRoZSBhZGFwdGVyIGNhbiBhY2NlcHQgd29yay5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgd2hlbiByZWFkeS5cbiAgICovXG4gIGFzeW5jIGVuc3VyZVJlYWR5KCkgeyB0aHJvdyBuZXcgRXJyb3IoXCJCYWNrZ3JvdW5kSm9ic0FkYXB0ZXIjZW5zdXJlUmVhZHkgaXMgbm90IGltcGxlbWVudGVkXCIpIH1cblxuICAvKipcbiAgICogQ2xvc2VzIGFkYXB0ZXItb3duZWQgcmVzb3VyY2VzLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyBhZnRlciBjbG9zZS5cbiAgICovXG4gIGFzeW5jIGNsb3NlKCkge31cblxuICAvKipcbiAgICogUmVwb3J0cyBhZGFwdGVyIGhlYWx0aC5cbiAgICogQHJldHVybnMge1Byb21pc2U8aW1wb3J0KFwiLi90eXBlcy5qc1wiKS5CYWNrZ3JvdW5kSm9ic0hlYWx0aD59IC0gQWRhcHRlciBoZWFsdGguXG4gICAqL1xuICBhc3luYyBoZWFsdGgoKSB7XG4gICAgcmV0dXJuIHtyZWFkeTogdHJ1ZX1cbiAgfVxuXG4gIC8qKlxuICAgKiBFbnN1cmVzIGZyYW1ld29yay1vd25lZCBwZXJzaXN0ZW5jZSBkdXJpbmcgYSBtaWdyYXRpb24gbGlmZWN5Y2xlLiBOb24tU1FMXG4gICAqIGFkYXB0ZXJzIG1heSBsZWF2ZSB0aGlzIGFzIGEgbm8tb3AuXG4gICAqIEBwYXJhbSB7e2RiczogUmVjb3JkPHN0cmluZywgaW1wb3J0KFwiLi4vZGF0YWJhc2UvZHJpdmVycy9iYXNlLmpzXCIpLmRlZmF1bHQ+fX0gX2FyZ3MgLSBNaWdyYXRlZCBkYXRhYmFzZXMuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIHdoZW4gY29tcGxldGUuXG4gICAqL1xuICBhc3luYyBlbnN1cmVGcmFtZXdvcmtTY2hlbWEoX2FyZ3MpIHt9XG5cbiAgLyoqXG4gICAqIFJlY29uY2lsZXMgY29uZmlndXJlZCBxdWV1ZSBsaW1pdHMuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIGFmdGVyIHJlY29uY2lsaWF0aW9uLlxuICAgKi9cbiAgYXN5bmMgcmVjb25jaWxlUXVldWVDb25jdXJyZW5jeSgpIHsgdGhyb3cgbmV3IEVycm9yKFwiQmFja2dyb3VuZEpvYnNBZGFwdGVyI3JlY29uY2lsZVF1ZXVlQ29uY3VycmVuY3kgaXMgbm90IGltcGxlbWVudGVkXCIpIH1cblxuICAvKipcbiAgICogUmVwYWlycyBkcmlmdCBpbiBhZGFwdGVyLW93bmVkIGR1cmFibGUgYWN0aXZlIGNvbmN1cnJlbmN5IGNvdW50cy4gQWRhcHRlcnNcbiAgICogd2l0aG91dCBkdXBsaWNhdGUgYWN0aXZlLWNvdW50IHBlcnNpc3RlbmNlIGNhbiBrZWVwIHRoaXMgbm8tb3AgcmVzdWx0LlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxpbXBvcnQoXCIuL3R5cGVzLmpzXCIpLkJhY2tncm91bmRKb2JDb25jdXJyZW5jeVJlY29uY2lsaWF0aW9uPn0gLSBSZXBhaXIgc3VtbWFyeS5cbiAgICovXG4gIGFzeW5jIHJlY29uY2lsZUFjdGl2ZUNvbmN1cnJlbmN5KCkge1xuICAgIHJldHVybiB7Y2FuZGlkYXRlQ291bnQ6IDAsIGNoZWNrZWRDb3VudDogMCwgcmVwYWlyZWRDb3VudDogMCwgcmVwYWlyczogW10sIHJlcGFpcnNUcnVuY2F0ZWRDb3VudDogMH1cbiAgfVxuXG4gIC8qKlxuICAgKiBFbnF1ZXVlcyBhIGpvYi5cbiAgICogQHBhcmFtIHt7am9iTmFtZTogc3RyaW5nLCBhcmdzOiBBcnJheTxSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj4sIG9wdGlvbnM/OiBpbXBvcnQoXCIuL3R5cGVzLmpzXCIpLkJhY2tncm91bmRKb2JPcHRpb25zfX0gX2FyZ3MgLSBKb2IgcmVxdWVzdC5cbiAgICogQHJldHVybnMge1Byb21pc2U8c3RyaW5nPn0gLSBKb2IgaWQuXG4gICAqL1xuICBhc3luYyBlbnF1ZXVlKF9hcmdzKSB7IHRocm93IG5ldyBFcnJvcihcIkJhY2tncm91bmRKb2JzQWRhcHRlciNlbnF1ZXVlIGlzIG5vdCBpbXBsZW1lbnRlZFwiKSB9XG5cbiAgLyoqXG4gICAqIEF0b21pY2FsbHkgdmFsaWRhdGVzIGFuIGV4YWN0IHByb2R1Y2luZyBoYW5kb2ZmIGFuZCBlbnF1ZXVlcyBpdHMgZm9sbG93LXVwLlxuICAgKiBAcGFyYW0ge3tqb2JOYW1lOiBzdHJpbmcsIGFyZ3M6IEFycmF5PFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Piwgb3B0aW9ucz86IGltcG9ydChcIi4vdHlwZXMuanNcIikuQmFja2dyb3VuZEpvYk9wdGlvbnMsIHByb2R1Y2VyUHJvb2Y6IGltcG9ydChcIi4vdHlwZXMuanNcIikuQmFja2dyb3VuZEpvYlByb2R1Y2VyUHJvb2Z9fSBfYXJncyAtIE93bmVkIGVucXVldWUgcmVxdWVzdC5cbiAgICogQHJldHVybnMge1Byb21pc2U8c3RyaW5nPn0gLSBKb2IgaWQuXG4gICAqL1xuICBhc3luYyBlbnF1ZXVlRnJvbU93bmVkSGFuZG9mZihfYXJncykgeyB0aHJvdyBuZXcgRXJyb3IoXCJCYWNrZ3JvdW5kSm9ic0FkYXB0ZXIjZW5xdWV1ZUZyb21Pd25lZEhhbmRvZmYgaXMgbm90IGltcGxlbWVudGVkXCIpIH1cblxuICAvKipcbiAgICogUmVwbGFjZXMgdGhlIG93bmVyIG9mIGEgc3RhYmxlIHNjaGVkdWxlIGtleS5cbiAgICogQHBhcmFtIHt7c2NoZWR1bGVLZXk6IHN0cmluZywgam9iTmFtZTogc3RyaW5nLCBhcmdzOiBBcnJheTxSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj4sIG9wdGlvbnM/OiBpbXBvcnQoXCIuL3R5cGVzLmpzXCIpLkJhY2tncm91bmRKb2JPcHRpb25zfX0gX2FyZ3MgLSBSZXBsYWNlbWVudCByZXF1ZXN0LlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxpbXBvcnQoXCIuL3R5cGVzLmpzXCIpLkJhY2tncm91bmRKb2JSZXBsYWNlbWVudFJlc3VsdD59IC0gUmVwbGFjZW1lbnQgcmVzdWx0LlxuICAgKi9cbiAgYXN5bmMgcmVwbGFjZVNjaGVkdWxlZChfYXJncykgeyB0aHJvdyBuZXcgRXJyb3IoXCJCYWNrZ3JvdW5kSm9ic0FkYXB0ZXIjcmVwbGFjZVNjaGVkdWxlZCBpcyBub3QgaW1wbGVtZW50ZWRcIikgfVxuXG4gIC8qKlxuICAgKiBDYW5jZWxzIHRoZSBvd25lciBvZiBhIHN0YWJsZSBzY2hlZHVsZSBrZXkuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBfc2NoZWR1bGVLZXkgLSBTdGFibGUgc2NoZWR1bGUga2V5LlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxpbXBvcnQoXCIuL3R5cGVzLmpzXCIpLkJhY2tncm91bmRKb2JDYW5jZWxsYXRpb25SZXN1bHQ+fSAtIENhbmNlbGxhdGlvbiByZXN1bHQuXG4gICAqL1xuICBhc3luYyBjYW5jZWxTY2hlZHVsZWQoX3NjaGVkdWxlS2V5KSB7IHRocm93IG5ldyBFcnJvcihcIkJhY2tncm91bmRKb2JzQWRhcHRlciNjYW5jZWxTY2hlZHVsZWQgaXMgbm90IGltcGxlbWVudGVkXCIpIH1cblxuICAvKipcbiAgICogRmluZHMgdGhlIG5leHQgZWxpZ2libGUgam9iLlxuICAgKiBAcGFyYW0ge3tleGVjdXRpb25Nb2RlPzogaW1wb3J0KFwiLi90eXBlcy5qc1wiKS5CYWNrZ3JvdW5kSm9iRXhlY3V0aW9uTW9kZSB8IGltcG9ydChcIi4vdHlwZXMuanNcIikuQmFja2dyb3VuZEpvYkV4ZWN1dGlvbk1vZGVbXX19IFtfYXJnc10gLSBEZXF1ZXVlIGZpbHRlcnMuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPGltcG9ydChcIi4vdHlwZXMuanNcIikuQmFja2dyb3VuZEpvYlJvdyB8IG51bGw+fSAtIE5leHQgZWxpZ2libGUgam9iLlxuICAgKi9cbiAgYXN5bmMgbmV4dEF2YWlsYWJsZUpvYihfYXJncyA9IHt9KSB7IHRocm93IG5ldyBFcnJvcihcIkJhY2tncm91bmRKb2JzQWRhcHRlciNuZXh0QXZhaWxhYmxlSm9iIGlzIG5vdCBpbXBsZW1lbnRlZFwiKSB9XG5cbiAgLyoqXG4gICAqIEZpbmRzIHRoZSBzb29uZXN0IGZ1dHVyZSBqb2IuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPGltcG9ydChcIi4vdHlwZXMuanNcIikuQmFja2dyb3VuZEpvYlJvdyB8IG51bGw+fSAtIFNvb25lc3QgZnV0dXJlIGpvYi5cbiAgICovXG4gIGFzeW5jIG5leHRTY2hlZHVsZWRKb2IoKSB7IHRocm93IG5ldyBFcnJvcihcIkJhY2tncm91bmRKb2JzQWRhcHRlciNuZXh0U2NoZWR1bGVkSm9iIGlzIG5vdCBpbXBsZW1lbnRlZFwiKSB9XG5cbiAgLyoqXG4gICAqIFJlYWRzIG9uZSBqb2IuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBfam9iSWQgLSBKb2IgaWQuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPGltcG9ydChcIi4vdHlwZXMuanNcIikuQmFja2dyb3VuZEpvYlJvdyB8IG51bGw+fSAtIEpvYiByb3cuXG4gICAqL1xuICBhc3luYyBnZXRKb2IoX2pvYklkKSB7IHRocm93IG5ldyBFcnJvcihcIkJhY2tncm91bmRKb2JzQWRhcHRlciNnZXRKb2IgaXMgbm90IGltcGxlbWVudGVkXCIpIH1cblxuICAvKipcbiAgICogU3RhcnRzIGEgam9iIGJ5IGNsYWltaW5nIGl0cyBkdXJhYmxlIGhhbmRvZmYuXG4gICAqIFdoZW4gYGhhbmRvZmZJZGAgaXMgc3VwcGxpZWQsIHRoZSBhZGFwdGVyIG11c3QgcGVyc2lzdCBhbmQgcmV0dXJuIHRoYXQgZXhhY3RcbiAgICogaWQgc28gdGhlIGNhbGxlciBjYW4gZmVuY2UgYW4gYW1iaWd1b3VzIGNvbW1pdCBhY2tub3dsZWRnZW1lbnQuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi90eXBlcy5qc1wiKS5CYWNrZ3JvdW5kSm9iSGFuZG9mZlJlcXVlc3R9IF9hcmdzIC0gSGFuZG9mZiByZXF1ZXN0LlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxpbXBvcnQoXCIuL3R5cGVzLmpzXCIpLkJhY2tncm91bmRKb2JIYW5kb2ZmIHwgbnVsbD59IC0gQ2xhaW1lZCBoYW5kb2ZmLlxuICAgKi9cbiAgYXN5bmMgbWFya0hhbmRlZE9mZihfYXJncykgeyB0aHJvdyBuZXcgRXJyb3IoXCJCYWNrZ3JvdW5kSm9ic0FkYXB0ZXIjbWFya0hhbmRlZE9mZiBpcyBub3QgaW1wbGVtZW50ZWRcIikgfVxuXG4gIC8qKlxuICAgKiBNYXJrcyBhIGhhbmRlZC1vZmYgam9iIHN1Y2Nlc3NmdWwuXG4gICAqIEBwYXJhbSB7e2pvYklkOiBzdHJpbmcsIGhhbmRvZmZJZD86IHN0cmluZywgd29ya2VySWQ/OiBzdHJpbmcsIGhhbmRlZE9mZkF0TXM/OiBudW1iZXJ9fSBfYXJncyAtIENvbXBsZXRpb24gcmVwb3J0LlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxib29sZWFuPn0gLSBXaGV0aGVyIHRoZSBmZW5jZWQgcmVwb3J0IHdhcyBhY2NlcHRlZC5cbiAgICovXG4gIGFzeW5jIG1hcmtDb21wbGV0ZWQoX2FyZ3MpIHsgdGhyb3cgbmV3IEVycm9yKFwiQmFja2dyb3VuZEpvYnNBZGFwdGVyI21hcmtDb21wbGV0ZWQgaXMgbm90IGltcGxlbWVudGVkXCIpIH1cblxuICAvKipcbiAgICogUmV0dXJucyBhIGhhbmRlZC1vZmYgam9iIHRvIGl0cyBzY2hlZHVsZS5cbiAgICogQHBhcmFtIHt7am9iSWQ6IHN0cmluZywgZGVsYXlNczogbnVtYmVyLCBoYW5kb2ZmSWQ/OiBzdHJpbmcsIHdvcmtlcklkPzogc3RyaW5nLCBoYW5kZWRPZmZBdE1zPzogbnVtYmVyfX0gX2FyZ3MgLSBSZXNjaGVkdWxlIHJlcG9ydC5cbiAgICogQHJldHVybnMge1Byb21pc2U8Ym9vbGVhbj59IC0gV2hldGhlciB0aGUgZmVuY2VkIHJlcG9ydCB3YXMgYWNjZXB0ZWQuXG4gICAqL1xuICBhc3luYyBtYXJrUmVzY2hlZHVsZWQoX2FyZ3MpIHsgdGhyb3cgbmV3IEVycm9yKFwiQmFja2dyb3VuZEpvYnNBZGFwdGVyI21hcmtSZXNjaGVkdWxlZCBpcyBub3QgaW1wbGVtZW50ZWRcIikgfVxuXG4gIC8qKlxuICAgKiBSZXR1cm5zIGEgaGFuZGVkLW9mZiBqb2IgdG8gdGhlIHF1ZXVlLlxuICAgKiBAcGFyYW0ge3tqb2JJZDogc3RyaW5nLCBoYW5kb2ZmSWQ6IHN0cmluZ319IF9hcmdzIC0gSGFuZG9mZiByZWxlYXNlLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyBhZnRlciB0aGUgam9iIGlzIHJldHVybmVkLlxuICAgKi9cbiAgYXN5bmMgbWFya1JldHVybmVkVG9RdWV1ZShfYXJncykgeyB0aHJvdyBuZXcgRXJyb3IoXCJCYWNrZ3JvdW5kSm9ic0FkYXB0ZXIjbWFya1JldHVybmVkVG9RdWV1ZSBpcyBub3QgaW1wbGVtZW50ZWRcIikgfVxuXG4gIC8qKlxuICAgKiBGaW5kcyBhY3RpdmUgaGFuZG9mZnMgZm9yIGEgd29ya2VyLlxuICAgKiBAcGFyYW0ge3t3b3JrZXJJZDogc3RyaW5nfX0gX2FyZ3MgLSBXb3JrZXIgaWRlbnRpdHkuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPEFycmF5PHtqb2JJZDogc3RyaW5nLCBoYW5kb2ZmSWQ6IHN0cmluZ30+Pn0gLSBBY3RpdmUgd29ya2VyIGhhbmRvZmZzLlxuICAgKi9cbiAgYXN5bmMgaGFuZGVkT2ZmSm9ic0ZvcldvcmtlcihfYXJncykgeyB0aHJvdyBuZXcgRXJyb3IoXCJCYWNrZ3JvdW5kSm9ic0FkYXB0ZXIjaGFuZGVkT2ZmSm9ic0ZvcldvcmtlciBpcyBub3QgaW1wbGVtZW50ZWRcIikgfVxuXG4gIC8qKlxuICAgKiBTbmFwc2hvdHMgZXhhY3QgYWN0aXZlIGhhbmRvZmZzIGJlZm9yZSBhIG5ldyBtYWluIGdlbmVyYXRpb24gYWNjZXB0cyB3b3JrZXJcbiAgICogcmVjb25uZWN0cy4gQWRhcHRlcnMgdGhhdCBkbyBub3QgcGVyc2lzdCB3b3JrZXIgbGVhc2VzIG1heSByZXR1cm4gbm9uZS5cbiAgICogQHJldHVybnMge1Byb21pc2U8aW1wb3J0KFwiLi90eXBlcy5qc1wiKS5CYWNrZ3JvdW5kSm9iSGFuZG9mZlNuYXBzaG90W10+fSAtIEV4YWN0IGFjdGl2ZSBoYW5kb2Zmcy5cbiAgICovXG4gIGFzeW5jIHNuYXBzaG90SGFuZGVkT2ZmSm9icygpIHsgcmV0dXJuIFtdIH1cblxuICAvKipcbiAgICogQXBwbGllcyBvcnBoYW4gZmFpbHVyZSBzZW1hbnRpY3MgdG8gdW5jaGFuZ2VkIGV4YWN0IGhhbmRvZmYgc25hcHNob3RzLlxuICAgKiBBZGFwdGVycyB0aGF0IHJldHVybiBzdGFydHVwIHNuYXBzaG90cyBtdXN0IGltcGxlbWVudCB0aGUgbWF0Y2hpbmcgZmVuY2VkXG4gICAqIHRyYW5zaXRpb24uXG4gICAqIEBwYXJhbSB7e2hhbmRvZmZzOiBpbXBvcnQoXCIuL3R5cGVzLmpzXCIpLkJhY2tncm91bmRKb2JIYW5kb2ZmU25hcHNob3RbXSwgZXJyb3I6IFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fX0gX2FyZ3MgLSBFeGFjdCBsZWFzZXMgYW5kIG9ycGhhbiByZWFzb24uXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPGltcG9ydChcIi4vdHlwZXMuanNcIikuQmFja2dyb3VuZEpvYlJvd1tdPn0gLSBBY2NlcHRlZCB0cmFuc2l0aW9ucy5cbiAgICovXG4gIGFzeW5jIG1hcmtPcnBoYW5lZEhhbmRvZmZzKF9hcmdzKSB7IHJldHVybiBbXSB9XG5cbiAgLyoqXG4gICAqIE1hcmtzIGEgaGFuZGVkLW9mZiBqb2IgZmFpbGVkIG9yIHJldHJ5YWJsZS5cbiAgICogQHBhcmFtIHt7am9iSWQ6IHN0cmluZywgZXJyb3I6IFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+LCBoYW5kb2ZmSWQ/OiBzdHJpbmcsIHdvcmtlcklkPzogc3RyaW5nLCBoYW5kZWRPZmZBdE1zPzogbnVtYmVyfX0gX2FyZ3MgLSBGYWlsdXJlIHJlcG9ydC5cbiAgICogQHJldHVybnMge1Byb21pc2U8aW1wb3J0KFwiLi90eXBlcy5qc1wiKS5CYWNrZ3JvdW5kSm9iUm93IHwgbnVsbD59IC0gVXBkYXRlZCBqb2Igd2hlbiBhY2NlcHRlZC5cbiAgICovXG4gIGFzeW5jIG1hcmtGYWlsZWQoX2FyZ3MpIHsgdGhyb3cgbmV3IEVycm9yKFwiQmFja2dyb3VuZEpvYnNBZGFwdGVyI21hcmtGYWlsZWQgaXMgbm90IGltcGxlbWVudGVkXCIpIH1cblxuICAvKipcbiAgICogUmVjbGFpbXMgZXhwaXJlZCBoYW5kb2Zmcy5cbiAgICogQHBhcmFtIHt7b3JwaGFuZWRBZnRlck1zPzogbnVtYmVyfX0gW19hcmdzXSAtIFN3ZWVwIG9wdGlvbnMuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPGltcG9ydChcIi4vdHlwZXMuanNcIikuQmFja2dyb3VuZEpvYlJvd1tdPn0gLSBOZXdseSBvcnBoYW5lZCBqb2JzLlxuICAgKi9cbiAgYXN5bmMgbWFya09ycGhhbmVkSm9icyhfYXJncyA9IHt9KSB7IHRocm93IG5ldyBFcnJvcihcIkJhY2tncm91bmRKb2JzQWRhcHRlciNtYXJrT3JwaGFuZWRKb2JzIGlzIG5vdCBpbXBsZW1lbnRlZFwiKSB9XG5cbiAgLyoqXG4gICAqIFBydW5lcyB0ZXJtaW5hbCBqb2JzIHBhc3QgdGhlaXIgcmV0ZW50aW9uIHdpbmRvd3MuXG4gICAqIEBwYXJhbSB7e2NvbXBsZXRlZFR0bE1zPzogbnVtYmVyIHwgbnVsbCwgZmFpbGVkVHRsTXM/OiBudW1iZXIgfCBudWxsLCBiYXRjaFNpemU/OiBudW1iZXJ9fSBbX2FyZ3NdIC0gUmV0ZW50aW9uIG9wdGlvbnMuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPG51bWJlcj59IC0gRGVsZXRlZCByb3dzLlxuICAgKi9cbiAgYXN5bmMgcHJ1bmVUZXJtaW5hbEpvYnMoX2FyZ3MgPSB7fSkgeyB0aHJvdyBuZXcgRXJyb3IoXCJCYWNrZ3JvdW5kSm9ic0FkYXB0ZXIjcHJ1bmVUZXJtaW5hbEpvYnMgaXMgbm90IGltcGxlbWVudGVkXCIpIH1cbn1cbiJdfQ==