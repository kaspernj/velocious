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
     * @param {{jobName: string, args: Array<ReturnType<typeof JSON.parse>>, options?: import("./types.js").BackgroundJobOptions, producerInvocationId?: string, producerProof: import("./types.js").BackgroundJobProducerProof}} _args - Owned enqueue request.
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
     * Records pooled-child acceptance evidence (received/started timestamps plus
     * runner identity) for a handed-off job, fenced by its active handoff lease.
     * Only the fields supplied are written.
     * @param {{jobId: string, handoffId?: string, workerId?: string, handedOffAtMs?: number, receivedAtMs?: number, startedAtMs?: number, childInstanceId?: string, childPid?: number}} _args - Acceptance report.
     * @returns {Promise<boolean>} - Whether the fenced report was accepted.
     */
    async markChildAccepted(_args) { throw new Error("BackgroundJobsAdapter#markChildAccepted is not implemented"); }
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiYWRhcHRlci5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uLy4uLy4uL3NyYy9iYWNrZ3JvdW5kLWpvYnMvYWRhcHRlci5qcyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiQUFBQSxZQUFZO0FBRVo7Ozs7R0FJRztBQUNILE1BQU0sQ0FBQyxPQUFPLE9BQU8scUJBQXFCO0lBQ3hDOzs7OztPQUtHO0lBQ0gsZ0NBQWdDLEtBQUssT0FBTyxLQUFLLENBQUEsQ0FBQyxDQUFDO0lBRW5EOzs7OztPQUtHO0lBQ0gsK0JBQStCLEtBQUssT0FBTyxLQUFLLENBQUEsQ0FBQyxDQUFDO0lBRWxEOzs7T0FHRztJQUNILEtBQUssQ0FBQyxXQUFXLEtBQUssTUFBTSxJQUFJLEtBQUssQ0FBQyxzREFBc0QsQ0FBQyxDQUFBLENBQUMsQ0FBQztJQUUvRjs7O09BR0c7SUFDSCxLQUFLLENBQUMsS0FBSyxLQUFJLENBQUM7SUFFaEI7OztPQUdHO0lBQ0gsS0FBSyxDQUFDLE1BQU07UUFDVixPQUFPLEVBQUMsS0FBSyxFQUFFLElBQUksRUFBQyxDQUFBO0lBQ3RCLENBQUM7SUFFRDs7Ozs7T0FLRztJQUNILEtBQUssQ0FBQyxxQkFBcUIsQ0FBQyxLQUFLLElBQUcsQ0FBQztJQUVyQzs7O09BR0c7SUFDSCxLQUFLLENBQUMseUJBQXlCLEtBQUssTUFBTSxJQUFJLEtBQUssQ0FBQyxvRUFBb0UsQ0FBQyxDQUFBLENBQUMsQ0FBQztJQUUzSDs7OztPQUlHO0lBQ0gsS0FBSyxDQUFDLDBCQUEwQjtRQUM5QixPQUFPLEVBQUMsY0FBYyxFQUFFLENBQUMsRUFBRSxZQUFZLEVBQUUsQ0FBQyxFQUFFLGFBQWEsRUFBRSxDQUFDLEVBQUUsT0FBTyxFQUFFLEVBQUUsRUFBRSxxQkFBcUIsRUFBRSxDQUFDLEVBQUMsQ0FBQTtJQUN0RyxDQUFDO0lBRUQ7Ozs7T0FJRztJQUNILEtBQUssQ0FBQyxPQUFPLENBQUMsS0FBSyxJQUFJLE1BQU0sSUFBSSxLQUFLLENBQUMsa0RBQWtELENBQUMsQ0FBQSxDQUFDLENBQUM7SUFFNUY7Ozs7T0FJRztJQUNILEtBQUssQ0FBQyx1QkFBdUIsQ0FBQyxLQUFLLElBQUksTUFBTSxJQUFJLEtBQUssQ0FBQyxrRUFBa0UsQ0FBQyxDQUFBLENBQUMsQ0FBQztJQUU1SDs7OztPQUlHO0lBQ0gsS0FBSyxDQUFDLGdCQUFnQixDQUFDLEtBQUssSUFBSSxNQUFNLElBQUksS0FBSyxDQUFDLDJEQUEyRCxDQUFDLENBQUEsQ0FBQyxDQUFDO0lBRTlHOzs7O09BSUc7SUFDSCxLQUFLLENBQUMsZUFBZSxDQUFDLFlBQVksSUFBSSxNQUFNLElBQUksS0FBSyxDQUFDLDBEQUEwRCxDQUFDLENBQUEsQ0FBQyxDQUFDO0lBRW5IOzs7O09BSUc7SUFDSCxLQUFLLENBQUMsZ0JBQWdCLENBQUMsS0FBSyxHQUFHLEVBQUUsSUFBSSxNQUFNLElBQUksS0FBSyxDQUFDLDJEQUEyRCxDQUFDLENBQUEsQ0FBQyxDQUFDO0lBRW5IOzs7T0FHRztJQUNILEtBQUssQ0FBQyxnQkFBZ0IsS0FBSyxNQUFNLElBQUksS0FBSyxDQUFDLDJEQUEyRCxDQUFDLENBQUEsQ0FBQyxDQUFDO0lBRXpHOzs7O09BSUc7SUFDSCxLQUFLLENBQUMsTUFBTSxDQUFDLE1BQU0sSUFBSSxNQUFNLElBQUksS0FBSyxDQUFDLGlEQUFpRCxDQUFDLENBQUEsQ0FBQyxDQUFDO0lBRTNGOzs7Ozs7T0FNRztJQUNILEtBQUssQ0FBQyxhQUFhLENBQUMsS0FBSyxJQUFJLE1BQU0sSUFBSSxLQUFLLENBQUMsd0RBQXdELENBQUMsQ0FBQSxDQUFDLENBQUM7SUFFeEc7Ozs7T0FJRztJQUNILEtBQUssQ0FBQyxhQUFhLENBQUMsS0FBSyxJQUFJLE1BQU0sSUFBSSxLQUFLLENBQUMsd0RBQXdELENBQUMsQ0FBQSxDQUFDLENBQUM7SUFFeEc7Ozs7OztPQU1HO0lBQ0gsS0FBSyxDQUFDLGlCQUFpQixDQUFDLEtBQUssSUFBSSxNQUFNLElBQUksS0FBSyxDQUFDLDREQUE0RCxDQUFDLENBQUEsQ0FBQyxDQUFDO0lBRWhIOzs7O09BSUc7SUFDSCxLQUFLLENBQUMsZUFBZSxDQUFDLEtBQUssSUFBSSxNQUFNLElBQUksS0FBSyxDQUFDLDBEQUEwRCxDQUFDLENBQUEsQ0FBQyxDQUFDO0lBRTVHOzs7O09BSUc7SUFDSCxLQUFLLENBQUMsbUJBQW1CLENBQUMsS0FBSyxJQUFJLE1BQU0sSUFBSSxLQUFLLENBQUMsOERBQThELENBQUMsQ0FBQSxDQUFDLENBQUM7SUFFcEg7Ozs7T0FJRztJQUNILEtBQUssQ0FBQyxzQkFBc0IsQ0FBQyxLQUFLLElBQUksTUFBTSxJQUFJLEtBQUssQ0FBQyxpRUFBaUUsQ0FBQyxDQUFBLENBQUMsQ0FBQztJQUUxSDs7OztPQUlHO0lBQ0gsS0FBSyxDQUFDLHFCQUFxQixLQUFLLE9BQU8sRUFBRSxDQUFBLENBQUMsQ0FBQztJQUUzQzs7Ozs7O09BTUc7SUFDSCxLQUFLLENBQUMsb0JBQW9CLENBQUMsS0FBSyxJQUFJLE9BQU8sRUFBRSxDQUFBLENBQUMsQ0FBQztJQUUvQzs7OztPQUlHO0lBQ0gsS0FBSyxDQUFDLFVBQVUsQ0FBQyxLQUFLLElBQUksTUFBTSxJQUFJLEtBQUssQ0FBQyxxREFBcUQsQ0FBQyxDQUFBLENBQUMsQ0FBQztJQUVsRzs7OztPQUlHO0lBQ0gsS0FBSyxDQUFDLGdCQUFnQixDQUFDLEtBQUssR0FBRyxFQUFFLElBQUksTUFBTSxJQUFJLEtBQUssQ0FBQywyREFBMkQsQ0FBQyxDQUFBLENBQUMsQ0FBQztJQUVuSDs7OztPQUlHO0lBQ0gsS0FBSyxDQUFDLGlCQUFpQixDQUFDLEtBQUssR0FBRyxFQUFFLElBQUksTUFBTSxJQUFJLEtBQUssQ0FBQyw0REFBNEQsQ0FBQyxDQUFBLENBQUMsQ0FBQztDQUN0SCIsInNvdXJjZXNDb250ZW50IjpbIi8vIEB0cy1jaGVja1xuXG4vKipcbiAqIFBsYXRmb3JtLW5ldXRyYWwgcGVyc2lzdGVuY2UgYW5kIGxpZmVjeWNsZSBjb250cmFjdCB1c2VkIGJ5IHRoZSBiYWNrZ3JvdW5kLWpvYnNcbiAqIHJ1bnRpbWUuIEFkYXB0ZXJzIG93biBkdXJhYmxlIHF1ZXVlIHN0YXRlOyB0cmFuc3BvcnQgYW5kIGpvYiBleGVjdXRpb24gcmVtYWluXG4gKiBzZXBhcmF0ZSBjb25jZXJucy5cbiAqL1xuZXhwb3J0IGRlZmF1bHQgY2xhc3MgQmFja2dyb3VuZEpvYnNBZGFwdGVyIHtcbiAgLyoqXG4gICAqIERlY2xhcmVzIGV4YWN0IGR1cmFibGUgZmVuY2luZyBzdXBwb3J0IGZvciByZWxlYXNlLXNjb3BlZCBnZW5lcmF0aW9ucy5cbiAgICogVGhpcmQtcGFydHkgYWRhcHRlcnMgbXVzdCBvdmVycmlkZSB0aGlzIG9ubHkgYWZ0ZXIgaW1wbGVtZW50aW5nIHRoZSBmdWxsXG4gICAqIHNuYXBzaG90LCBvd25lciwgcmVwb3J0LCBhbmQgcmVjb3ZlcnkgY29udHJhY3QuXG4gICAqIEByZXR1cm5zIHtib29sZWFufSAtIFdoZXRoZXIgZ2VuZXJhdGlvbiBtb2RlIGlzIHN1cHBvcnRlZC5cbiAgICovXG4gIHN1cHBvcnRzUmVsZWFzZVNjb3BlZEdlbmVyYXRpb25zKCkgeyByZXR1cm4gZmFsc2UgfVxuXG4gIC8qKlxuICAgKiBEZWNsYXJlcyBhdG9taWMgcHJvZHVjZXItaGFuZG9mZiB2YWxpZGF0aW9uIHBsdXMgZW5xdWV1ZSBzdXBwb3J0LiBBXG4gICAqIGdlbmVyYXRpb24tY2FwYWJsZSBhZGFwdGVyIG11c3Qgb3ZlcnJpZGUgdGhpcyB0b2dldGhlciB3aXRoXG4gICAqIGBlbnF1ZXVlRnJvbU93bmVkSGFuZG9mZmAuXG4gICAqIEByZXR1cm5zIHtib29sZWFufSAtIFdoZXRoZXIgYXRvbWljIG93bmVkIGVucXVldWUgaXMgc3VwcG9ydGVkLlxuICAgKi9cbiAgc3VwcG9ydHNPd25lZEVucXVldWVGcm9tSGFuZG9mZigpIHsgcmV0dXJuIGZhbHNlIH1cblxuICAvKipcbiAgICogRW5zdXJlcyB0aGUgYWRhcHRlciBjYW4gYWNjZXB0IHdvcmsuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIHdoZW4gcmVhZHkuXG4gICAqL1xuICBhc3luYyBlbnN1cmVSZWFkeSgpIHsgdGhyb3cgbmV3IEVycm9yKFwiQmFja2dyb3VuZEpvYnNBZGFwdGVyI2Vuc3VyZVJlYWR5IGlzIG5vdCBpbXBsZW1lbnRlZFwiKSB9XG5cbiAgLyoqXG4gICAqIENsb3NlcyBhZGFwdGVyLW93bmVkIHJlc291cmNlcy5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgYWZ0ZXIgY2xvc2UuXG4gICAqL1xuICBhc3luYyBjbG9zZSgpIHt9XG5cbiAgLyoqXG4gICAqIFJlcG9ydHMgYWRhcHRlciBoZWFsdGguXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPGltcG9ydChcIi4vdHlwZXMuanNcIikuQmFja2dyb3VuZEpvYnNIZWFsdGg+fSAtIEFkYXB0ZXIgaGVhbHRoLlxuICAgKi9cbiAgYXN5bmMgaGVhbHRoKCkge1xuICAgIHJldHVybiB7cmVhZHk6IHRydWV9XG4gIH1cblxuICAvKipcbiAgICogRW5zdXJlcyBmcmFtZXdvcmstb3duZWQgcGVyc2lzdGVuY2UgZHVyaW5nIGEgbWlncmF0aW9uIGxpZmVjeWNsZS4gTm9uLVNRTFxuICAgKiBhZGFwdGVycyBtYXkgbGVhdmUgdGhpcyBhcyBhIG5vLW9wLlxuICAgKiBAcGFyYW0ge3tkYnM6IFJlY29yZDxzdHJpbmcsIGltcG9ydChcIi4uL2RhdGFiYXNlL2RyaXZlcnMvYmFzZS5qc1wiKS5kZWZhdWx0Pn19IF9hcmdzIC0gTWlncmF0ZWQgZGF0YWJhc2VzLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyB3aGVuIGNvbXBsZXRlLlxuICAgKi9cbiAgYXN5bmMgZW5zdXJlRnJhbWV3b3JrU2NoZW1hKF9hcmdzKSB7fVxuXG4gIC8qKlxuICAgKiBSZWNvbmNpbGVzIGNvbmZpZ3VyZWQgcXVldWUgbGltaXRzLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyBhZnRlciByZWNvbmNpbGlhdGlvbi5cbiAgICovXG4gIGFzeW5jIHJlY29uY2lsZVF1ZXVlQ29uY3VycmVuY3koKSB7IHRocm93IG5ldyBFcnJvcihcIkJhY2tncm91bmRKb2JzQWRhcHRlciNyZWNvbmNpbGVRdWV1ZUNvbmN1cnJlbmN5IGlzIG5vdCBpbXBsZW1lbnRlZFwiKSB9XG5cbiAgLyoqXG4gICAqIFJlcGFpcnMgZHJpZnQgaW4gYWRhcHRlci1vd25lZCBkdXJhYmxlIGFjdGl2ZSBjb25jdXJyZW5jeSBjb3VudHMuIEFkYXB0ZXJzXG4gICAqIHdpdGhvdXQgZHVwbGljYXRlIGFjdGl2ZS1jb3VudCBwZXJzaXN0ZW5jZSBjYW4ga2VlcCB0aGlzIG5vLW9wIHJlc3VsdC5cbiAgICogQHJldHVybnMge1Byb21pc2U8aW1wb3J0KFwiLi90eXBlcy5qc1wiKS5CYWNrZ3JvdW5kSm9iQ29uY3VycmVuY3lSZWNvbmNpbGlhdGlvbj59IC0gUmVwYWlyIHN1bW1hcnkuXG4gICAqL1xuICBhc3luYyByZWNvbmNpbGVBY3RpdmVDb25jdXJyZW5jeSgpIHtcbiAgICByZXR1cm4ge2NhbmRpZGF0ZUNvdW50OiAwLCBjaGVja2VkQ291bnQ6IDAsIHJlcGFpcmVkQ291bnQ6IDAsIHJlcGFpcnM6IFtdLCByZXBhaXJzVHJ1bmNhdGVkQ291bnQ6IDB9XG4gIH1cblxuICAvKipcbiAgICogRW5xdWV1ZXMgYSBqb2IuXG4gICAqIEBwYXJhbSB7e2pvYk5hbWU6IHN0cmluZywgYXJnczogQXJyYXk8UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+LCBvcHRpb25zPzogaW1wb3J0KFwiLi90eXBlcy5qc1wiKS5CYWNrZ3JvdW5kSm9iT3B0aW9uc319IF9hcmdzIC0gSm9iIHJlcXVlc3QuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHN0cmluZz59IC0gSm9iIGlkLlxuICAgKi9cbiAgYXN5bmMgZW5xdWV1ZShfYXJncykgeyB0aHJvdyBuZXcgRXJyb3IoXCJCYWNrZ3JvdW5kSm9ic0FkYXB0ZXIjZW5xdWV1ZSBpcyBub3QgaW1wbGVtZW50ZWRcIikgfVxuXG4gIC8qKlxuICAgKiBBdG9taWNhbGx5IHZhbGlkYXRlcyBhbiBleGFjdCBwcm9kdWNpbmcgaGFuZG9mZiBhbmQgZW5xdWV1ZXMgaXRzIGZvbGxvdy11cC5cbiAgICogQHBhcmFtIHt7am9iTmFtZTogc3RyaW5nLCBhcmdzOiBBcnJheTxSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj4sIG9wdGlvbnM/OiBpbXBvcnQoXCIuL3R5cGVzLmpzXCIpLkJhY2tncm91bmRKb2JPcHRpb25zLCBwcm9kdWNlckludm9jYXRpb25JZD86IHN0cmluZywgcHJvZHVjZXJQcm9vZjogaW1wb3J0KFwiLi90eXBlcy5qc1wiKS5CYWNrZ3JvdW5kSm9iUHJvZHVjZXJQcm9vZn19IF9hcmdzIC0gT3duZWQgZW5xdWV1ZSByZXF1ZXN0LlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxzdHJpbmc+fSAtIEpvYiBpZC5cbiAgICovXG4gIGFzeW5jIGVucXVldWVGcm9tT3duZWRIYW5kb2ZmKF9hcmdzKSB7IHRocm93IG5ldyBFcnJvcihcIkJhY2tncm91bmRKb2JzQWRhcHRlciNlbnF1ZXVlRnJvbU93bmVkSGFuZG9mZiBpcyBub3QgaW1wbGVtZW50ZWRcIikgfVxuXG4gIC8qKlxuICAgKiBSZXBsYWNlcyB0aGUgb3duZXIgb2YgYSBzdGFibGUgc2NoZWR1bGUga2V5LlxuICAgKiBAcGFyYW0ge3tzY2hlZHVsZUtleTogc3RyaW5nLCBqb2JOYW1lOiBzdHJpbmcsIGFyZ3M6IEFycmF5PFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Piwgb3B0aW9ucz86IGltcG9ydChcIi4vdHlwZXMuanNcIikuQmFja2dyb3VuZEpvYk9wdGlvbnN9fSBfYXJncyAtIFJlcGxhY2VtZW50IHJlcXVlc3QuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPGltcG9ydChcIi4vdHlwZXMuanNcIikuQmFja2dyb3VuZEpvYlJlcGxhY2VtZW50UmVzdWx0Pn0gLSBSZXBsYWNlbWVudCByZXN1bHQuXG4gICAqL1xuICBhc3luYyByZXBsYWNlU2NoZWR1bGVkKF9hcmdzKSB7IHRocm93IG5ldyBFcnJvcihcIkJhY2tncm91bmRKb2JzQWRhcHRlciNyZXBsYWNlU2NoZWR1bGVkIGlzIG5vdCBpbXBsZW1lbnRlZFwiKSB9XG5cbiAgLyoqXG4gICAqIENhbmNlbHMgdGhlIG93bmVyIG9mIGEgc3RhYmxlIHNjaGVkdWxlIGtleS5cbiAgICogQHBhcmFtIHtzdHJpbmd9IF9zY2hlZHVsZUtleSAtIFN0YWJsZSBzY2hlZHVsZSBrZXkuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPGltcG9ydChcIi4vdHlwZXMuanNcIikuQmFja2dyb3VuZEpvYkNhbmNlbGxhdGlvblJlc3VsdD59IC0gQ2FuY2VsbGF0aW9uIHJlc3VsdC5cbiAgICovXG4gIGFzeW5jIGNhbmNlbFNjaGVkdWxlZChfc2NoZWR1bGVLZXkpIHsgdGhyb3cgbmV3IEVycm9yKFwiQmFja2dyb3VuZEpvYnNBZGFwdGVyI2NhbmNlbFNjaGVkdWxlZCBpcyBub3QgaW1wbGVtZW50ZWRcIikgfVxuXG4gIC8qKlxuICAgKiBGaW5kcyB0aGUgbmV4dCBlbGlnaWJsZSBqb2IuXG4gICAqIEBwYXJhbSB7e2V4ZWN1dGlvbk1vZGU/OiBpbXBvcnQoXCIuL3R5cGVzLmpzXCIpLkJhY2tncm91bmRKb2JFeGVjdXRpb25Nb2RlIHwgaW1wb3J0KFwiLi90eXBlcy5qc1wiKS5CYWNrZ3JvdW5kSm9iRXhlY3V0aW9uTW9kZVtdfX0gW19hcmdzXSAtIERlcXVldWUgZmlsdGVycy5cbiAgICogQHJldHVybnMge1Byb21pc2U8aW1wb3J0KFwiLi90eXBlcy5qc1wiKS5CYWNrZ3JvdW5kSm9iUm93IHwgbnVsbD59IC0gTmV4dCBlbGlnaWJsZSBqb2IuXG4gICAqL1xuICBhc3luYyBuZXh0QXZhaWxhYmxlSm9iKF9hcmdzID0ge30pIHsgdGhyb3cgbmV3IEVycm9yKFwiQmFja2dyb3VuZEpvYnNBZGFwdGVyI25leHRBdmFpbGFibGVKb2IgaXMgbm90IGltcGxlbWVudGVkXCIpIH1cblxuICAvKipcbiAgICogRmluZHMgdGhlIHNvb25lc3QgZnV0dXJlIGpvYi5cbiAgICogQHJldHVybnMge1Byb21pc2U8aW1wb3J0KFwiLi90eXBlcy5qc1wiKS5CYWNrZ3JvdW5kSm9iUm93IHwgbnVsbD59IC0gU29vbmVzdCBmdXR1cmUgam9iLlxuICAgKi9cbiAgYXN5bmMgbmV4dFNjaGVkdWxlZEpvYigpIHsgdGhyb3cgbmV3IEVycm9yKFwiQmFja2dyb3VuZEpvYnNBZGFwdGVyI25leHRTY2hlZHVsZWRKb2IgaXMgbm90IGltcGxlbWVudGVkXCIpIH1cblxuICAvKipcbiAgICogUmVhZHMgb25lIGpvYi5cbiAgICogQHBhcmFtIHtzdHJpbmd9IF9qb2JJZCAtIEpvYiBpZC5cbiAgICogQHJldHVybnMge1Byb21pc2U8aW1wb3J0KFwiLi90eXBlcy5qc1wiKS5CYWNrZ3JvdW5kSm9iUm93IHwgbnVsbD59IC0gSm9iIHJvdy5cbiAgICovXG4gIGFzeW5jIGdldEpvYihfam9iSWQpIHsgdGhyb3cgbmV3IEVycm9yKFwiQmFja2dyb3VuZEpvYnNBZGFwdGVyI2dldEpvYiBpcyBub3QgaW1wbGVtZW50ZWRcIikgfVxuXG4gIC8qKlxuICAgKiBTdGFydHMgYSBqb2IgYnkgY2xhaW1pbmcgaXRzIGR1cmFibGUgaGFuZG9mZi5cbiAgICogV2hlbiBgaGFuZG9mZklkYCBpcyBzdXBwbGllZCwgdGhlIGFkYXB0ZXIgbXVzdCBwZXJzaXN0IGFuZCByZXR1cm4gdGhhdCBleGFjdFxuICAgKiBpZCBzbyB0aGUgY2FsbGVyIGNhbiBmZW5jZSBhbiBhbWJpZ3VvdXMgY29tbWl0IGFja25vd2xlZGdlbWVudC5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL3R5cGVzLmpzXCIpLkJhY2tncm91bmRKb2JIYW5kb2ZmUmVxdWVzdH0gX2FyZ3MgLSBIYW5kb2ZmIHJlcXVlc3QuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPGltcG9ydChcIi4vdHlwZXMuanNcIikuQmFja2dyb3VuZEpvYkhhbmRvZmYgfCBudWxsPn0gLSBDbGFpbWVkIGhhbmRvZmYuXG4gICAqL1xuICBhc3luYyBtYXJrSGFuZGVkT2ZmKF9hcmdzKSB7IHRocm93IG5ldyBFcnJvcihcIkJhY2tncm91bmRKb2JzQWRhcHRlciNtYXJrSGFuZGVkT2ZmIGlzIG5vdCBpbXBsZW1lbnRlZFwiKSB9XG5cbiAgLyoqXG4gICAqIE1hcmtzIGEgaGFuZGVkLW9mZiBqb2Igc3VjY2Vzc2Z1bC5cbiAgICogQHBhcmFtIHt7am9iSWQ6IHN0cmluZywgaGFuZG9mZklkPzogc3RyaW5nLCB3b3JrZXJJZD86IHN0cmluZywgaGFuZGVkT2ZmQXRNcz86IG51bWJlcn19IF9hcmdzIC0gQ29tcGxldGlvbiByZXBvcnQuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPGJvb2xlYW4+fSAtIFdoZXRoZXIgdGhlIGZlbmNlZCByZXBvcnQgd2FzIGFjY2VwdGVkLlxuICAgKi9cbiAgYXN5bmMgbWFya0NvbXBsZXRlZChfYXJncykgeyB0aHJvdyBuZXcgRXJyb3IoXCJCYWNrZ3JvdW5kSm9ic0FkYXB0ZXIjbWFya0NvbXBsZXRlZCBpcyBub3QgaW1wbGVtZW50ZWRcIikgfVxuXG4gIC8qKlxuICAgKiBSZWNvcmRzIHBvb2xlZC1jaGlsZCBhY2NlcHRhbmNlIGV2aWRlbmNlIChyZWNlaXZlZC9zdGFydGVkIHRpbWVzdGFtcHMgcGx1c1xuICAgKiBydW5uZXIgaWRlbnRpdHkpIGZvciBhIGhhbmRlZC1vZmYgam9iLCBmZW5jZWQgYnkgaXRzIGFjdGl2ZSBoYW5kb2ZmIGxlYXNlLlxuICAgKiBPbmx5IHRoZSBmaWVsZHMgc3VwcGxpZWQgYXJlIHdyaXR0ZW4uXG4gICAqIEBwYXJhbSB7e2pvYklkOiBzdHJpbmcsIGhhbmRvZmZJZD86IHN0cmluZywgd29ya2VySWQ/OiBzdHJpbmcsIGhhbmRlZE9mZkF0TXM/OiBudW1iZXIsIHJlY2VpdmVkQXRNcz86IG51bWJlciwgc3RhcnRlZEF0TXM/OiBudW1iZXIsIGNoaWxkSW5zdGFuY2VJZD86IHN0cmluZywgY2hpbGRQaWQ/OiBudW1iZXJ9fSBfYXJncyAtIEFjY2VwdGFuY2UgcmVwb3J0LlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxib29sZWFuPn0gLSBXaGV0aGVyIHRoZSBmZW5jZWQgcmVwb3J0IHdhcyBhY2NlcHRlZC5cbiAgICovXG4gIGFzeW5jIG1hcmtDaGlsZEFjY2VwdGVkKF9hcmdzKSB7IHRocm93IG5ldyBFcnJvcihcIkJhY2tncm91bmRKb2JzQWRhcHRlciNtYXJrQ2hpbGRBY2NlcHRlZCBpcyBub3QgaW1wbGVtZW50ZWRcIikgfVxuXG4gIC8qKlxuICAgKiBSZXR1cm5zIGEgaGFuZGVkLW9mZiBqb2IgdG8gaXRzIHNjaGVkdWxlLlxuICAgKiBAcGFyYW0ge3tqb2JJZDogc3RyaW5nLCBkZWxheU1zOiBudW1iZXIsIGhhbmRvZmZJZD86IHN0cmluZywgd29ya2VySWQ/OiBzdHJpbmcsIGhhbmRlZE9mZkF0TXM/OiBudW1iZXJ9fSBfYXJncyAtIFJlc2NoZWR1bGUgcmVwb3J0LlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxib29sZWFuPn0gLSBXaGV0aGVyIHRoZSBmZW5jZWQgcmVwb3J0IHdhcyBhY2NlcHRlZC5cbiAgICovXG4gIGFzeW5jIG1hcmtSZXNjaGVkdWxlZChfYXJncykgeyB0aHJvdyBuZXcgRXJyb3IoXCJCYWNrZ3JvdW5kSm9ic0FkYXB0ZXIjbWFya1Jlc2NoZWR1bGVkIGlzIG5vdCBpbXBsZW1lbnRlZFwiKSB9XG5cbiAgLyoqXG4gICAqIFJldHVybnMgYSBoYW5kZWQtb2ZmIGpvYiB0byB0aGUgcXVldWUuXG4gICAqIEBwYXJhbSB7e2pvYklkOiBzdHJpbmcsIGhhbmRvZmZJZDogc3RyaW5nfX0gX2FyZ3MgLSBIYW5kb2ZmIHJlbGVhc2UuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIGFmdGVyIHRoZSBqb2IgaXMgcmV0dXJuZWQuXG4gICAqL1xuICBhc3luYyBtYXJrUmV0dXJuZWRUb1F1ZXVlKF9hcmdzKSB7IHRocm93IG5ldyBFcnJvcihcIkJhY2tncm91bmRKb2JzQWRhcHRlciNtYXJrUmV0dXJuZWRUb1F1ZXVlIGlzIG5vdCBpbXBsZW1lbnRlZFwiKSB9XG5cbiAgLyoqXG4gICAqIEZpbmRzIGFjdGl2ZSBoYW5kb2ZmcyBmb3IgYSB3b3JrZXIuXG4gICAqIEBwYXJhbSB7e3dvcmtlcklkOiBzdHJpbmd9fSBfYXJncyAtIFdvcmtlciBpZGVudGl0eS5cbiAgICogQHJldHVybnMge1Byb21pc2U8QXJyYXk8e2pvYklkOiBzdHJpbmcsIGhhbmRvZmZJZDogc3RyaW5nfT4+fSAtIEFjdGl2ZSB3b3JrZXIgaGFuZG9mZnMuXG4gICAqL1xuICBhc3luYyBoYW5kZWRPZmZKb2JzRm9yV29ya2VyKF9hcmdzKSB7IHRocm93IG5ldyBFcnJvcihcIkJhY2tncm91bmRKb2JzQWRhcHRlciNoYW5kZWRPZmZKb2JzRm9yV29ya2VyIGlzIG5vdCBpbXBsZW1lbnRlZFwiKSB9XG5cbiAgLyoqXG4gICAqIFNuYXBzaG90cyBleGFjdCBhY3RpdmUgaGFuZG9mZnMgYmVmb3JlIGEgbmV3IG1haW4gZ2VuZXJhdGlvbiBhY2NlcHRzIHdvcmtlclxuICAgKiByZWNvbm5lY3RzLiBBZGFwdGVycyB0aGF0IGRvIG5vdCBwZXJzaXN0IHdvcmtlciBsZWFzZXMgbWF5IHJldHVybiBub25lLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxpbXBvcnQoXCIuL3R5cGVzLmpzXCIpLkJhY2tncm91bmRKb2JIYW5kb2ZmU25hcHNob3RbXT59IC0gRXhhY3QgYWN0aXZlIGhhbmRvZmZzLlxuICAgKi9cbiAgYXN5bmMgc25hcHNob3RIYW5kZWRPZmZKb2JzKCkgeyByZXR1cm4gW10gfVxuXG4gIC8qKlxuICAgKiBBcHBsaWVzIG9ycGhhbiBmYWlsdXJlIHNlbWFudGljcyB0byB1bmNoYW5nZWQgZXhhY3QgaGFuZG9mZiBzbmFwc2hvdHMuXG4gICAqIEFkYXB0ZXJzIHRoYXQgcmV0dXJuIHN0YXJ0dXAgc25hcHNob3RzIG11c3QgaW1wbGVtZW50IHRoZSBtYXRjaGluZyBmZW5jZWRcbiAgICogdHJhbnNpdGlvbi5cbiAgICogQHBhcmFtIHt7aGFuZG9mZnM6IGltcG9ydChcIi4vdHlwZXMuanNcIikuQmFja2dyb3VuZEpvYkhhbmRvZmZTbmFwc2hvdFtdLCBlcnJvcjogUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59fSBfYXJncyAtIEV4YWN0IGxlYXNlcyBhbmQgb3JwaGFuIHJlYXNvbi5cbiAgICogQHJldHVybnMge1Byb21pc2U8aW1wb3J0KFwiLi90eXBlcy5qc1wiKS5CYWNrZ3JvdW5kSm9iUm93W10+fSAtIEFjY2VwdGVkIHRyYW5zaXRpb25zLlxuICAgKi9cbiAgYXN5bmMgbWFya09ycGhhbmVkSGFuZG9mZnMoX2FyZ3MpIHsgcmV0dXJuIFtdIH1cblxuICAvKipcbiAgICogTWFya3MgYSBoYW5kZWQtb2ZmIGpvYiBmYWlsZWQgb3IgcmV0cnlhYmxlLlxuICAgKiBAcGFyYW0ge3tqb2JJZDogc3RyaW5nLCBlcnJvcjogUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4sIGhhbmRvZmZJZD86IHN0cmluZywgd29ya2VySWQ/OiBzdHJpbmcsIGhhbmRlZE9mZkF0TXM/OiBudW1iZXJ9fSBfYXJncyAtIEZhaWx1cmUgcmVwb3J0LlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxpbXBvcnQoXCIuL3R5cGVzLmpzXCIpLkJhY2tncm91bmRKb2JSb3cgfCBudWxsPn0gLSBVcGRhdGVkIGpvYiB3aGVuIGFjY2VwdGVkLlxuICAgKi9cbiAgYXN5bmMgbWFya0ZhaWxlZChfYXJncykgeyB0aHJvdyBuZXcgRXJyb3IoXCJCYWNrZ3JvdW5kSm9ic0FkYXB0ZXIjbWFya0ZhaWxlZCBpcyBub3QgaW1wbGVtZW50ZWRcIikgfVxuXG4gIC8qKlxuICAgKiBSZWNsYWltcyBleHBpcmVkIGhhbmRvZmZzLlxuICAgKiBAcGFyYW0ge3tvcnBoYW5lZEFmdGVyTXM/OiBudW1iZXJ9fSBbX2FyZ3NdIC0gU3dlZXAgb3B0aW9ucy5cbiAgICogQHJldHVybnMge1Byb21pc2U8aW1wb3J0KFwiLi90eXBlcy5qc1wiKS5CYWNrZ3JvdW5kSm9iUm93W10+fSAtIE5ld2x5IG9ycGhhbmVkIGpvYnMuXG4gICAqL1xuICBhc3luYyBtYXJrT3JwaGFuZWRKb2JzKF9hcmdzID0ge30pIHsgdGhyb3cgbmV3IEVycm9yKFwiQmFja2dyb3VuZEpvYnNBZGFwdGVyI21hcmtPcnBoYW5lZEpvYnMgaXMgbm90IGltcGxlbWVudGVkXCIpIH1cblxuICAvKipcbiAgICogUHJ1bmVzIHRlcm1pbmFsIGpvYnMgcGFzdCB0aGVpciByZXRlbnRpb24gd2luZG93cy5cbiAgICogQHBhcmFtIHt7Y29tcGxldGVkVHRsTXM/OiBudW1iZXIgfCBudWxsLCBmYWlsZWRUdGxNcz86IG51bWJlciB8IG51bGwsIGJhdGNoU2l6ZT86IG51bWJlcn19IFtfYXJnc10gLSBSZXRlbnRpb24gb3B0aW9ucy5cbiAgICogQHJldHVybnMge1Byb21pc2U8bnVtYmVyPn0gLSBEZWxldGVkIHJvd3MuXG4gICAqL1xuICBhc3luYyBwcnVuZVRlcm1pbmFsSm9icyhfYXJncyA9IHt9KSB7IHRocm93IG5ldyBFcnJvcihcIkJhY2tncm91bmRKb2JzQWRhcHRlciNwcnVuZVRlcm1pbmFsSm9icyBpcyBub3QgaW1wbGVtZW50ZWRcIikgfVxufVxuIl19