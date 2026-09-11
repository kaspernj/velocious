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
     * Reads current stable ownership and optional terminal history.
     * @param {string} _scheduleKey - Stable schedule key.
     * @param {{includeLatestTerminal?: boolean}} [_options] - Lookup options.
     * @returns {Promise<import("./types.js").BackgroundJobScheduledLookupResult>} - Normalized public jobs.
     */
    async getScheduledJob(_scheduleKey, _options = {}) { throw new Error("BackgroundJobsAdapter#getScheduledJob is not implemented"); }
    /**
     * Expedites a future queued stable owner without changing its identity.
     * @param {string} _scheduleKey - Stable schedule key.
     * @returns {Promise<import("./types.js").BackgroundJobWakeResult>} - Wake result.
     */
    async wakeScheduled(_scheduleKey) { throw new Error("BackgroundJobsAdapter#wakeScheduled is not implemented"); }
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiYWRhcHRlci5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uLy4uLy4uL3NyYy9iYWNrZ3JvdW5kLWpvYnMvYWRhcHRlci5qcyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiQUFBQSxZQUFZO0FBRVo7Ozs7R0FJRztBQUNILE1BQU0sQ0FBQyxPQUFPLE9BQU8scUJBQXFCO0lBQ3hDOzs7OztPQUtHO0lBQ0gsZ0NBQWdDLEtBQUssT0FBTyxLQUFLLENBQUEsQ0FBQyxDQUFDO0lBRW5EOzs7OztPQUtHO0lBQ0gsK0JBQStCLEtBQUssT0FBTyxLQUFLLENBQUEsQ0FBQyxDQUFDO0lBRWxEOzs7T0FHRztJQUNILEtBQUssQ0FBQyxXQUFXLEtBQUssTUFBTSxJQUFJLEtBQUssQ0FBQyxzREFBc0QsQ0FBQyxDQUFBLENBQUMsQ0FBQztJQUUvRjs7O09BR0c7SUFDSCxLQUFLLENBQUMsS0FBSyxLQUFJLENBQUM7SUFFaEI7OztPQUdHO0lBQ0gsS0FBSyxDQUFDLE1BQU07UUFDVixPQUFPLEVBQUMsS0FBSyxFQUFFLElBQUksRUFBQyxDQUFBO0lBQ3RCLENBQUM7SUFFRDs7Ozs7T0FLRztJQUNILEtBQUssQ0FBQyxxQkFBcUIsQ0FBQyxLQUFLLElBQUcsQ0FBQztJQUVyQzs7O09BR0c7SUFDSCxLQUFLLENBQUMseUJBQXlCLEtBQUssTUFBTSxJQUFJLEtBQUssQ0FBQyxvRUFBb0UsQ0FBQyxDQUFBLENBQUMsQ0FBQztJQUUzSDs7OztPQUlHO0lBQ0gsS0FBSyxDQUFDLDBCQUEwQjtRQUM5QixPQUFPLEVBQUMsY0FBYyxFQUFFLENBQUMsRUFBRSxZQUFZLEVBQUUsQ0FBQyxFQUFFLGFBQWEsRUFBRSxDQUFDLEVBQUUsT0FBTyxFQUFFLEVBQUUsRUFBRSxxQkFBcUIsRUFBRSxDQUFDLEVBQUMsQ0FBQTtJQUN0RyxDQUFDO0lBRUQ7Ozs7T0FJRztJQUNILEtBQUssQ0FBQyxPQUFPLENBQUMsS0FBSyxJQUFJLE1BQU0sSUFBSSxLQUFLLENBQUMsa0RBQWtELENBQUMs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LElBQUksTUFBTSxJQUFJLEtBQUssQ0FBQyw0REFBNEQsQ0FBQyxDQUFBLENBQUMsQ0FBQztDQUN0SCIsInNvdXJjZXNDb250ZW50IjpbIi8vIEB0cy1jaGVja1xuXG4vKipcbiAqIFBsYXRmb3JtLW5ldXRyYWwgcGVyc2lzdGVuY2UgYW5kIGxpZmVjeWNsZSBjb250cmFjdCB1c2VkIGJ5IHRoZSBiYWNrZ3JvdW5kLWpvYnNcbiAqIHJ1bnRpbWUuIEFkYXB0ZXJzIG93biBkdXJhYmxlIHF1ZXVlIHN0YXRlOyB0cmFuc3BvcnQgYW5kIGpvYiBleGVjdXRpb24gcmVtYWluXG4gKiBzZXBhcmF0ZSBjb25jZXJucy5cbiAqL1xuZXhwb3J0IGRlZmF1bHQgY2xhc3MgQmFja2dyb3VuZEpvYnNBZGFwdGVyIHtcbiAgLyoqXG4gICAqIERlY2xhcmVzIGV4YWN0IGR1cmFibGUgZmVuY2luZyBzdXBwb3J0IGZvciByZWxlYXNlLXNjb3BlZCBnZW5lcmF0aW9ucy5cbiAgICogVGhpcmQtcGFydHkgYWRhcHRlcnMgbXVzdCBvdmVycmlkZSB0aGlzIG9ubHkgYWZ0ZXIgaW1wbGVtZW50aW5nIHRoZSBmdWxsXG4gICAqIHNuYXBzaG90LCBvd25lciwgcmVwb3J0LCBhbmQgcmVjb3ZlcnkgY29udHJhY3QuXG4gICAqIEByZXR1cm5zIHtib29sZWFufSAtIFdoZXRoZXIgZ2VuZXJhdGlvbiBtb2RlIGlzIHN1cHBvcnRlZC5cbiAgICovXG4gIHN1cHBvcnRzUmVsZWFzZVNjb3BlZEdlbmVyYXRpb25zKCkgeyByZXR1cm4gZmFsc2UgfVxuXG4gIC8qKlxuICAgKiBEZWNsYXJlcyBhdG9taWMgcHJvZHVjZXItaGFuZG9mZiB2YWxpZGF0aW9uIHBsdXMgZW5xdWV1ZSBzdXBwb3J0LiBBXG4gICAqIGdlbmVyYXRpb24tY2FwYWJsZSBhZGFwdGVyIG11c3Qgb3ZlcnJpZGUgdGhpcyB0b2dldGhlciB3aXRoXG4gICAqIGBlbnF1ZXVlRnJvbU93bmVkSGFuZG9mZmAuXG4gICAqIEByZXR1cm5zIHtib29sZWFufSAtIFdoZXRoZXIgYXRvbWljIG93bmVkIGVucXVldWUgaXMgc3VwcG9ydGVkLlxuICAgKi9cbiAgc3VwcG9ydHNPd25lZEVucXVldWVGcm9tSGFuZG9mZigpIHsgcmV0dXJuIGZhbHNlIH1cblxuICAvKipcbiAgICogRW5zdXJlcyB0aGUgYWRhcHRlciBjYW4gYWNjZXB0IHdvcmsuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIHdoZW4gcmVhZHkuXG4gICAqL1xuICBhc3luYyBlbnN1cmVSZWFkeSgpIHsgdGhyb3cgbmV3IEVycm9yKFwiQmFja2dyb3VuZEpvYnNBZGFwdGVyI2Vuc3VyZVJlYWR5IGlzIG5vdCBpbXBsZW1lbnRlZFwiKSB9XG5cbiAgLyoqXG4gICAqIENsb3NlcyBhZGFwdGVyLW93bmVkIHJlc291cmNlcy5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgYWZ0ZXIgY2xvc2UuXG4gICAqL1xuICBhc3luYyBjbG9zZSgpIHt9XG5cbiAgLyoqXG4gICAqIFJlcG9ydHMgYWRhcHRlciBoZWFsdGguXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPGltcG9ydChcIi4vdHlwZXMuanNcIikuQmFja2dyb3VuZEpvYnNIZWFsdGg+fSAtIEFkYXB0ZXIgaGVhbHRoLlxuICAgKi9cbiAgYXN5bmMgaGVhbHRoKCkge1xuICAgIHJldHVybiB7cmVhZHk6IHRydWV9XG4gIH1cblxuICAvKipcbiAgICogRW5zdXJlcyBmcmFtZXdvcmstb3duZWQgcGVyc2lzdGVuY2UgZHVyaW5nIGEgbWlncmF0aW9uIGxpZmVjeWNsZS4gTm9uLVNRTFxuICAgKiBhZGFwdGVycyBtYXkgbGVhdmUgdGhpcyBhcyBhIG5vLW9wLlxuICAgKiBAcGFyYW0ge3tkYnM6IFJlY29yZDxzdHJpbmcsIGltcG9ydChcIi4uL2RhdGFiYXNlL2RyaXZlcnMvYmFzZS5qc1wiKS5kZWZhdWx0Pn19IF9hcmdzIC0gTWlncmF0ZWQgZGF0YWJhc2VzLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyB3aGVuIGNvbXBsZXRlLlxuICAgKi9cbiAgYXN5bmMgZW5zdXJlRnJhbWV3b3JrU2NoZW1hKF9hcmdzKSB7fVxuXG4gIC8qKlxuICAgKiBSZWNvbmNpbGVzIGNvbmZpZ3VyZWQgcXVldWUgbGltaXRzLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyBhZnRlciByZWNvbmNpbGlhdGlvbi5cbiAgICovXG4gIGFzeW5jIHJlY29uY2lsZVF1ZXVlQ29uY3VycmVuY3koKSB7IHRocm93IG5ldyBFcnJvcihcIkJhY2tncm91bmRKb2JzQWRhcHRlciNyZWNvbmNpbGVRdWV1ZUNvbmN1cnJlbmN5IGlzIG5vdCBpbXBsZW1lbnRlZFwiKSB9XG5cbiAgLyoqXG4gICAqIFJlcGFpcnMgZHJpZnQgaW4gYWRhcHRlci1vd25lZCBkdXJhYmxlIGFjdGl2ZSBjb25jdXJyZW5jeSBjb3VudHMuIEFkYXB0ZXJzXG4gICAqIHdpdGhvdXQgZHVwbGljYXRlIGFjdGl2ZS1jb3VudCBwZXJzaXN0ZW5jZSBjYW4ga2VlcCB0aGlzIG5vLW9wIHJlc3VsdC5cbiAgICogQHJldHVybnMge1Byb21pc2U8aW1wb3J0KFwiLi90eXBlcy5qc1wiKS5CYWNrZ3JvdW5kSm9iQ29uY3VycmVuY3lSZWNvbmNpbGlhdGlvbj59IC0gUmVwYWlyIHN1bW1hcnkuXG4gICAqL1xuICBhc3luYyByZWNvbmNpbGVBY3RpdmVDb25jdXJyZW5jeSgpIHtcbiAgICByZXR1cm4ge2NhbmRpZGF0ZUNvdW50OiAwLCBjaGVja2VkQ291bnQ6IDAsIHJlcGFpcmVkQ291bnQ6IDAsIHJlcGFpcnM6IFtdLCByZXBhaXJzVHJ1bmNhdGVkQ291bnQ6IDB9XG4gIH1cblxuICAvKipcbiAgICogRW5xdWV1ZXMgYSBqb2IuXG4gICAqIEBwYXJhbSB7e2pvYk5hbWU6IHN0cmluZywgYXJnczogQXJyYXk8UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+LCBvcHRpb25zPzogaW1wb3J0KFwiLi90eXBlcy5qc1wiKS5CYWNrZ3JvdW5kSm9iT3B0aW9uc319IF9hcmdzIC0gSm9iIHJlcXVlc3QuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHN0cmluZz59IC0gSm9iIGlkLlxuICAgKi9cbiAgYXN5bmMgZW5xdWV1ZShfYXJncykgeyB0aHJvdyBuZXcgRXJyb3IoXCJCYWNrZ3JvdW5kSm9ic0FkYXB0ZXIjZW5xdWV1ZSBpcyBub3QgaW1wbGVtZW50ZWRcIikgfVxuXG4gIC8qKlxuICAgKiBBdG9taWNhbGx5IHZhbGlkYXRlcyBhbiBleGFjdCBwcm9kdWNpbmcgaGFuZG9mZiBhbmQgZW5xdWV1ZXMgaXRzIGZvbGxvdy11cC5cbiAgICogQHBhcmFtIHt7am9iTmFtZTogc3RyaW5nLCBhcmdzOiBBcnJheTxSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj4sIG9wdGlvbnM/OiBpbXBvcnQoXCIuL3R5cGVzLmpzXCIpLkJhY2tncm91bmRKb2JPcHRpb25zLCBwcm9kdWNlckludm9jYXRpb25JZD86IHN0cmluZywgcHJvZHVjZXJQcm9vZjogaW1wb3J0KFwiLi90eXBlcy5qc1wiKS5CYWNrZ3JvdW5kSm9iUHJvZHVjZXJQcm9vZn19IF9hcmdzIC0gT3duZWQgZW5xdWV1ZSByZXF1ZXN0LlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxzdHJpbmc+fSAtIEpvYiBpZC5cbiAgICovXG4gIGFzeW5jIGVucXVldWVGcm9tT3duZWRIYW5kb2ZmKF9hcmdzKSB7IHRocm93IG5ldyBFcnJvcihcIkJhY2tncm91bmRKb2JzQWRhcHRlciNlbnF1ZXVlRnJvbU93bmVkSGFuZG9mZiBpcyBub3QgaW1wbGVtZW50ZWRcIikgfVxuXG4gIC8qKlxuICAgKiBSZXBsYWNlcyB0aGUgb3duZXIgb2YgYSBzdGFibGUgc2NoZWR1bGUga2V5LlxuICAgKiBAcGFyYW0ge3tzY2hlZHVsZUtleTogc3RyaW5nLCBqb2JOYW1lOiBzdHJpbmcsIGFyZ3M6IEFycmF5PFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Piwgb3B0aW9ucz86IGltcG9ydChcIi4vdHlwZXMuanNcIikuQmFja2dyb3VuZEpvYk9wdGlvbnN9fSBfYXJncyAtIFJlcGxhY2VtZW50IHJlcXVlc3QuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPGltcG9ydChcIi4vdHlwZXMuanNcIikuQmFja2dyb3VuZEpvYlJlcGxhY2VtZW50UmVzdWx0Pn0gLSBSZXBsYWNlbWVudCByZXN1bHQuXG4gICAqL1xuICBhc3luYyByZXBsYWNlU2NoZWR1bGVkKF9hcmdzKSB7IHRocm93IG5ldyBFcnJvcihcIkJhY2tncm91bmRKb2JzQWRhcHRlciNyZXBsYWNlU2NoZWR1bGVkIGlzIG5vdCBpbXBsZW1lbnRlZFwiKSB9XG5cbiAgLyoqXG4gICAqIENhbmNlbHMgdGhlIG93bmVyIG9mIGEgc3RhYmxlIHNjaGVkdWxlIGtleS5cbiAgICogQHBhcmFtIHtzdHJpbmd9IF9zY2hlZHVsZUtleSAtIFN0YWJsZSBzY2hlZHVsZSBrZXkuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPGltcG9ydChcIi4vdHlwZXMuanNcIikuQmFja2dyb3VuZEpvYkNhbmNlbGxhdGlvblJlc3VsdD59IC0gQ2FuY2VsbGF0aW9uIHJlc3VsdC5cbiAgICovXG4gIGFzeW5jIGNhbmNlbFNjaGVkdWxlZChfc2NoZWR1bGVLZXkpIHsgdGhyb3cgbmV3IEVycm9yKFwiQmFja2dyb3VuZEpvYnNBZGFwdGVyI2NhbmNlbFNjaGVkdWxlZCBpcyBub3QgaW1wbGVtZW50ZWRcIikgfVxuXG4gIC8qKlxuICAgKiBSZWFkcyBjdXJyZW50IHN0YWJsZSBvd25lcnNoaXAgYW5kIG9wdGlvbmFsIHRlcm1pbmFsIGhpc3RvcnkuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBfc2NoZWR1bGVLZXkgLSBTdGFibGUgc2NoZWR1bGUga2V5LlxuICAgKiBAcGFyYW0ge3tpbmNsdWRlTGF0ZXN0VGVybWluYWw/OiBib29sZWFufX0gW19vcHRpb25zXSAtIExvb2t1cCBvcHRpb25zLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxpbXBvcnQoXCIuL3R5cGVzLmpzXCIpLkJhY2tncm91bmRKb2JTY2hlZHVsZWRMb29rdXBSZXN1bHQ+fSAtIE5vcm1hbGl6ZWQgcHVibGljIGpvYnMuXG4gICAqL1xuICBhc3luYyBnZXRTY2hlZHVsZWRKb2IoX3NjaGVkdWxlS2V5LCBfb3B0aW9ucyA9IHt9KSB7IHRocm93IG5ldyBFcnJvcihcIkJhY2tncm91bmRKb2JzQWRhcHRlciNnZXRTY2hlZHVsZWRKb2IgaXMgbm90IGltcGxlbWVudGVkXCIpIH1cblxuICAvKipcbiAgICogRXhwZWRpdGVzIGEgZnV0dXJlIHF1ZXVlZCBzdGFibGUgb3duZXIgd2l0aG91dCBjaGFuZ2luZyBpdHMgaWRlbnRpdHkuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBfc2NoZWR1bGVLZXkgLSBTdGFibGUgc2NoZWR1bGUga2V5LlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxpbXBvcnQoXCIuL3R5cGVzLmpzXCIpLkJhY2tncm91bmRKb2JXYWtlUmVzdWx0Pn0gLSBXYWtlIHJlc3VsdC5cbiAgICovXG4gIGFzeW5jIHdha2VTY2hlZHVsZWQoX3NjaGVkdWxlS2V5KSB7IHRocm93IG5ldyBFcnJvcihcIkJhY2tncm91bmRKb2JzQWRhcHRlciN3YWtlU2NoZWR1bGVkIGlzIG5vdCBpbXBsZW1lbnRlZFwiKSB9XG5cbiAgLyoqXG4gICAqIEZpbmRzIHRoZSBuZXh0IGVsaWdpYmxlIGpvYi5cbiAgICogQHBhcmFtIHt7ZXhlY3V0aW9uTW9kZT86IGltcG9ydChcIi4vdHlwZXMuanNcIikuQmFja2dyb3VuZEpvYkV4ZWN1dGlvbk1vZGUgfCBpbXBvcnQoXCIuL3R5cGVzLmpzXCIpLkJhY2tncm91bmRKb2JFeGVjdXRpb25Nb2RlW119fSBbX2FyZ3NdIC0gRGVxdWV1ZSBmaWx0ZXJzLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxpbXBvcnQoXCIuL3R5cGVzLmpzXCIpLkJhY2tncm91bmRKb2JSb3cgfCBudWxsPn0gLSBOZXh0IGVsaWdpYmxlIGpvYi5cbiAgICovXG4gIGFzeW5jIG5leHRBdmFpbGFibGVKb2IoX2FyZ3MgPSB7fSkgeyB0aHJvdyBuZXcgRXJyb3IoXCJCYWNrZ3JvdW5kSm9ic0FkYXB0ZXIjbmV4dEF2YWlsYWJsZUpvYiBpcyBub3QgaW1wbGVtZW50ZWRcIikgfVxuXG4gIC8qKlxuICAgKiBGaW5kcyB0aGUgc29vbmVzdCBmdXR1cmUgam9iLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxpbXBvcnQoXCIuL3R5cGVzLmpzXCIpLkJhY2tncm91bmRKb2JSb3cgfCBudWxsPn0gLSBTb29uZXN0IGZ1dHVyZSBqb2IuXG4gICAqL1xuICBhc3luYyBuZXh0U2NoZWR1bGVkSm9iKCkgeyB0aHJvdyBuZXcgRXJyb3IoXCJCYWNrZ3JvdW5kSm9ic0FkYXB0ZXIjbmV4dFNjaGVkdWxlZEpvYiBpcyBub3QgaW1wbGVtZW50ZWRcIikgfVxuXG4gIC8qKlxuICAgKiBSZWFkcyBvbmUgam9iLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gX2pvYklkIC0gSm9iIGlkLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxpbXBvcnQoXCIuL3R5cGVzLmpzXCIpLkJhY2tncm91bmRKb2JSb3cgfCBudWxsPn0gLSBKb2Igcm93LlxuICAgKi9cbiAgYXN5bmMgZ2V0Sm9iKF9qb2JJZCkgeyB0aHJvdyBuZXcgRXJyb3IoXCJCYWNrZ3JvdW5kSm9ic0FkYXB0ZXIjZ2V0Sm9iIGlzIG5vdCBpbXBsZW1lbnRlZFwiKSB9XG5cbiAgLyoqXG4gICAqIFN0YXJ0cyBhIGpvYiBieSBjbGFpbWluZyBpdHMgZHVyYWJsZSBoYW5kb2ZmLlxuICAgKiBXaGVuIGBoYW5kb2ZmSWRgIGlzIHN1cHBsaWVkLCB0aGUgYWRhcHRlciBtdXN0IHBlcnNpc3QgYW5kIHJldHVybiB0aGF0IGV4YWN0XG4gICAqIGlkIHNvIHRoZSBjYWxsZXIgY2FuIGZlbmNlIGFuIGFtYmlndW91cyBjb21taXQgYWNrbm93bGVkZ2VtZW50LlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vdHlwZXMuanNcIikuQmFja2dyb3VuZEpvYkhhbmRvZmZSZXF1ZXN0fSBfYXJncyAtIEhhbmRvZmYgcmVxdWVzdC5cbiAgICogQHJldHVybnMge1Byb21pc2U8aW1wb3J0KFwiLi90eXBlcy5qc1wiKS5CYWNrZ3JvdW5kSm9iSGFuZG9mZiB8IG51bGw+fSAtIENsYWltZWQgaGFuZG9mZi5cbiAgICovXG4gIGFzeW5jIG1hcmtIYW5kZWRPZmYoX2FyZ3MpIHsgdGhyb3cgbmV3IEVycm9yKFwiQmFja2dyb3VuZEpvYnNBZGFwdGVyI21hcmtIYW5kZWRPZmYgaXMgbm90IGltcGxlbWVudGVkXCIpIH1cblxuICAvKipcbiAgICogTWFya3MgYSBoYW5kZWQtb2ZmIGpvYiBzdWNjZXNzZnVsLlxuICAgKiBAcGFyYW0ge3tqb2JJZDogc3RyaW5nLCBoYW5kb2ZmSWQ/OiBzdHJpbmcsIHdvcmtlcklkPzogc3RyaW5nLCBoYW5kZWRPZmZBdE1zPzogbnVtYmVyfX0gX2FyZ3MgLSBDb21wbGV0aW9uIHJlcG9ydC5cbiAgICogQHJldHVybnMge1Byb21pc2U8Ym9vbGVhbj59IC0gV2hldGhlciB0aGUgZmVuY2VkIHJlcG9ydCB3YXMgYWNjZXB0ZWQuXG4gICAqL1xuICBhc3luYyBtYXJrQ29tcGxldGVkKF9hcmdzKSB7IHRocm93IG5ldyBFcnJvcihcIkJhY2tncm91bmRKb2JzQWRhcHRlciNtYXJrQ29tcGxldGVkIGlzIG5vdCBpbXBsZW1lbnRlZFwiKSB9XG5cbiAgLyoqXG4gICAqIFJlY29yZHMgcG9vbGVkLWNoaWxkIGFjY2VwdGFuY2UgZXZpZGVuY2UgKHJlY2VpdmVkL3N0YXJ0ZWQgdGltZXN0YW1wcyBwbHVzXG4gICAqIHJ1bm5lciBpZGVudGl0eSkgZm9yIGEgaGFuZGVkLW9mZiBqb2IsIGZlbmNlZCBieSBpdHMgYWN0aXZlIGhhbmRvZmYgbGVhc2UuXG4gICAqIE9ubHkgdGhlIGZpZWxkcyBzdXBwbGllZCBhcmUgd3JpdHRlbi5cbiAgICogQHBhcmFtIHt7am9iSWQ6IHN0cmluZywgaGFuZG9mZklkPzogc3RyaW5nLCB3b3JrZXJJZD86IHN0cmluZywgaGFuZGVkT2ZmQXRNcz86IG51bWJlciwgcmVjZWl2ZWRBdE1zPzogbnVtYmVyLCBzdGFydGVkQXRNcz86IG51bWJlciwgY2hpbGRJbnN0YW5jZUlkPzogc3RyaW5nLCBjaGlsZFBpZD86IG51bWJlcn19IF9hcmdzIC0gQWNjZXB0YW5jZSByZXBvcnQuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPGJvb2xlYW4+fSAtIFdoZXRoZXIgdGhlIGZlbmNlZCByZXBvcnQgd2FzIGFjY2VwdGVkLlxuICAgKi9cbiAgYXN5bmMgbWFya0NoaWxkQWNjZXB0ZWQoX2FyZ3MpIHsgdGhyb3cgbmV3IEVycm9yKFwiQmFja2dyb3VuZEpvYnNBZGFwdGVyI21hcmtDaGlsZEFjY2VwdGVkIGlzIG5vdCBpbXBsZW1lbnRlZFwiKSB9XG5cbiAgLyoqXG4gICAqIFJldHVybnMgYSBoYW5kZWQtb2ZmIGpvYiB0byBpdHMgc2NoZWR1bGUuXG4gICAqIEBwYXJhbSB7e2pvYklkOiBzdHJpbmcsIGRlbGF5TXM6IG51bWJlciwgaGFuZG9mZklkPzogc3RyaW5nLCB3b3JrZXJJZD86IHN0cmluZywgaGFuZGVkT2ZmQXRNcz86IG51bWJlcn19IF9hcmdzIC0gUmVzY2hlZHVsZSByZXBvcnQuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPGJvb2xlYW4+fSAtIFdoZXRoZXIgdGhlIGZlbmNlZCByZXBvcnQgd2FzIGFjY2VwdGVkLlxuICAgKi9cbiAgYXN5bmMgbWFya1Jlc2NoZWR1bGVkKF9hcmdzKSB7IHRocm93IG5ldyBFcnJvcihcIkJhY2tncm91bmRKb2JzQWRhcHRlciNtYXJrUmVzY2hlZHVsZWQgaXMgbm90IGltcGxlbWVudGVkXCIpIH1cblxuICAvKipcbiAgICogUmV0dXJucyBhIGhhbmRlZC1vZmYgam9iIHRvIHRoZSBxdWV1ZS5cbiAgICogQHBhcmFtIHt7am9iSWQ6IHN0cmluZywgaGFuZG9mZklkOiBzdHJpbmd9fSBfYXJncyAtIEhhbmRvZmYgcmVsZWFzZS5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgYWZ0ZXIgdGhlIGpvYiBpcyByZXR1cm5lZC5cbiAgICovXG4gIGFzeW5jIG1hcmtSZXR1cm5lZFRvUXVldWUoX2FyZ3MpIHsgdGhyb3cgbmV3IEVycm9yKFwiQmFja2dyb3VuZEpvYnNBZGFwdGVyI21hcmtSZXR1cm5lZFRvUXVldWUgaXMgbm90IGltcGxlbWVudGVkXCIpIH1cblxuICAvKipcbiAgICogRmluZHMgYWN0aXZlIGhhbmRvZmZzIGZvciBhIHdvcmtlci5cbiAgICogQHBhcmFtIHt7d29ya2VySWQ6IHN0cmluZ319IF9hcmdzIC0gV29ya2VyIGlkZW50aXR5LlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxBcnJheTx7am9iSWQ6IHN0cmluZywgaGFuZG9mZklkOiBzdHJpbmd9Pj59IC0gQWN0aXZlIHdvcmtlciBoYW5kb2Zmcy5cbiAgICovXG4gIGFzeW5jIGhhbmRlZE9mZkpvYnNGb3JXb3JrZXIoX2FyZ3MpIHsgdGhyb3cgbmV3IEVycm9yKFwiQmFja2dyb3VuZEpvYnNBZGFwdGVyI2hhbmRlZE9mZkpvYnNGb3JXb3JrZXIgaXMgbm90IGltcGxlbWVudGVkXCIpIH1cblxuICAvKipcbiAgICogU25hcHNob3RzIGV4YWN0IGFjdGl2ZSBoYW5kb2ZmcyBiZWZvcmUgYSBuZXcgbWFpbiBnZW5lcmF0aW9uIGFjY2VwdHMgd29ya2VyXG4gICAqIHJlY29ubmVjdHMuIEFkYXB0ZXJzIHRoYXQgZG8gbm90IHBlcnNpc3Qgd29ya2VyIGxlYXNlcyBtYXkgcmV0dXJuIG5vbmUuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPGltcG9ydChcIi4vdHlwZXMuanNcIikuQmFja2dyb3VuZEpvYkhhbmRvZmZTbmFwc2hvdFtdPn0gLSBFeGFjdCBhY3RpdmUgaGFuZG9mZnMuXG4gICAqL1xuICBhc3luYyBzbmFwc2hvdEhhbmRlZE9mZkpvYnMoKSB7IHJldHVybiBbXSB9XG5cbiAgLyoqXG4gICAqIEFwcGxpZXMgb3JwaGFuIGZhaWx1cmUgc2VtYW50aWNzIHRvIHVuY2hhbmdlZCBleGFjdCBoYW5kb2ZmIHNuYXBzaG90cy5cbiAgICogQWRhcHRlcnMgdGhhdCByZXR1cm4gc3RhcnR1cCBzbmFwc2hvdHMgbXVzdCBpbXBsZW1lbnQgdGhlIG1hdGNoaW5nIGZlbmNlZFxuICAgKiB0cmFuc2l0aW9uLlxuICAgKiBAcGFyYW0ge3toYW5kb2ZmczogaW1wb3J0KFwiLi90eXBlcy5qc1wiKS5CYWNrZ3JvdW5kSm9iSGFuZG9mZlNuYXBzaG90W10sIGVycm9yOiBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn19IF9hcmdzIC0gRXhhY3QgbGVhc2VzIGFuZCBvcnBoYW4gcmVhc29uLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxpbXBvcnQoXCIuL3R5cGVzLmpzXCIpLkJhY2tncm91bmRKb2JSb3dbXT59IC0gQWNjZXB0ZWQgdHJhbnNpdGlvbnMuXG4gICAqL1xuICBhc3luYyBtYXJrT3JwaGFuZWRIYW5kb2ZmcyhfYXJncykgeyByZXR1cm4gW10gfVxuXG4gIC8qKlxuICAgKiBNYXJrcyBhIGhhbmRlZC1vZmYgam9iIGZhaWxlZCBvciByZXRyeWFibGUuXG4gICAqIEBwYXJhbSB7e2pvYklkOiBzdHJpbmcsIGVycm9yOiBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPiwgaGFuZG9mZklkPzogc3RyaW5nLCB3b3JrZXJJZD86IHN0cmluZywgaGFuZGVkT2ZmQXRNcz86IG51bWJlcn19IF9hcmdzIC0gRmFpbHVyZSByZXBvcnQuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPGltcG9ydChcIi4vdHlwZXMuanNcIikuQmFja2dyb3VuZEpvYlJvdyB8IG51bGw+fSAtIFVwZGF0ZWQgam9iIHdoZW4gYWNjZXB0ZWQuXG4gICAqL1xuICBhc3luYyBtYXJrRmFpbGVkKF9hcmdzKSB7IHRocm93IG5ldyBFcnJvcihcIkJhY2tncm91bmRKb2JzQWRhcHRlciNtYXJrRmFpbGVkIGlzIG5vdCBpbXBsZW1lbnRlZFwiKSB9XG5cbiAgLyoqXG4gICAqIFJlY2xhaW1zIGV4cGlyZWQgaGFuZG9mZnMuXG4gICAqIEBwYXJhbSB7e29ycGhhbmVkQWZ0ZXJNcz86IG51bWJlcn19IFtfYXJnc10gLSBTd2VlcCBvcHRpb25zLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxpbXBvcnQoXCIuL3R5cGVzLmpzXCIpLkJhY2tncm91bmRKb2JSb3dbXT59IC0gTmV3bHkgb3JwaGFuZWQgam9icy5cbiAgICovXG4gIGFzeW5jIG1hcmtPcnBoYW5lZEpvYnMoX2FyZ3MgPSB7fSkgeyB0aHJvdyBuZXcgRXJyb3IoXCJCYWNrZ3JvdW5kSm9ic0FkYXB0ZXIjbWFya09ycGhhbmVkSm9icyBpcyBub3QgaW1wbGVtZW50ZWRcIikgfVxuXG4gIC8qKlxuICAgKiBQcnVuZXMgdGVybWluYWwgam9icyBwYXN0IHRoZWlyIHJldGVudGlvbiB3aW5kb3dzLlxuICAgKiBAcGFyYW0ge3tjb21wbGV0ZWRUdGxNcz86IG51bWJlciB8IG51bGwsIGZhaWxlZFR0bE1zPzogbnVtYmVyIHwgbnVsbCwgYmF0Y2hTaXplPzogbnVtYmVyfX0gW19hcmdzXSAtIFJldGVudGlvbiBvcHRpb25zLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxudW1iZXI+fSAtIERlbGV0ZWQgcm93cy5cbiAgICovXG4gIGFzeW5jIHBydW5lVGVybWluYWxKb2JzKF9hcmdzID0ge30pIHsgdGhyb3cgbmV3IEVycm9yKFwiQmFja2dyb3VuZEpvYnNBZGFwdGVyI3BydW5lVGVybWluYWxKb2JzIGlzIG5vdCBpbXBsZW1lbnRlZFwiKSB9XG59XG4iXX0=