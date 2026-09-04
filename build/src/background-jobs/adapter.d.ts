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
    supportsReleaseScopedGenerations(): boolean;
    /**
     * Ensures the adapter can accept work.
     * @returns {Promise<void>} - Resolves when ready.
     */
    ensureReady(): Promise<void>;
    /**
     * Closes adapter-owned resources.
     * @returns {Promise<void>} - Resolves after close.
     */
    close(): Promise<void>;
    /**
     * Reports adapter health.
     * @returns {Promise<import("./types.js").BackgroundJobsHealth>} - Adapter health.
     */
    health(): Promise<import("./types.js").BackgroundJobsHealth>;
    /**
     * Ensures framework-owned persistence during a migration lifecycle. Non-SQL
     * adapters may leave this as a no-op.
     * @param {{dbs: Record<string, import("../database/drivers/base.js").default>}} _args - Migrated databases.
     * @returns {Promise<void>} - Resolves when complete.
     */
    ensureFrameworkSchema(_args: {
        dbs: Record<string, import("../database/drivers/base.js").default>;
    }): Promise<void>;
    /**
     * Reconciles configured queue limits.
     * @returns {Promise<void>} - Resolves after reconciliation.
     */
    reconcileQueueConcurrency(): Promise<void>;
    /**
     * Repairs drift in adapter-owned durable active concurrency counts. Adapters
     * without duplicate active-count persistence can keep this no-op result.
     * @returns {Promise<import("./types.js").BackgroundJobConcurrencyReconciliation>} - Repair summary.
     */
    reconcileActiveConcurrency(): Promise<import("./types.js").BackgroundJobConcurrencyReconciliation>;
    /**
     * Enqueues a job.
     * @param {{jobName: string, args: Array<ReturnType<typeof JSON.parse>>, options?: import("./types.js").BackgroundJobOptions}} _args - Job request.
     * @returns {Promise<string>} - Job id.
     */
    enqueue(_args: {
        jobName: string;
        args: Array<ReturnType<typeof JSON.parse>>;
        options?: import("./types.js").BackgroundJobOptions;
    }): Promise<string>;
    /**
     * Replaces the owner of a stable schedule key.
     * @param {{scheduleKey: string, jobName: string, args: Array<ReturnType<typeof JSON.parse>>, options?: import("./types.js").BackgroundJobOptions}} _args - Replacement request.
     * @returns {Promise<import("./types.js").BackgroundJobReplacementResult>} - Replacement result.
     */
    replaceScheduled(_args: {
        scheduleKey: string;
        jobName: string;
        args: Array<ReturnType<typeof JSON.parse>>;
        options?: import("./types.js").BackgroundJobOptions;
    }): Promise<import("./types.js").BackgroundJobReplacementResult>;
    /**
     * Cancels the owner of a stable schedule key.
     * @param {string} _scheduleKey - Stable schedule key.
     * @returns {Promise<import("./types.js").BackgroundJobCancellationResult>} - Cancellation result.
     */
    cancelScheduled(_scheduleKey: string): Promise<import("./types.js").BackgroundJobCancellationResult>;
    /**
     * Finds the next eligible job.
     * @param {{executionMode?: import("./types.js").BackgroundJobExecutionMode | import("./types.js").BackgroundJobExecutionMode[]}} [_args] - Dequeue filters.
     * @returns {Promise<import("./types.js").BackgroundJobRow | null>} - Next eligible job.
     */
    nextAvailableJob(_args?: {
        executionMode?: import("./types.js").BackgroundJobExecutionMode | import("./types.js").BackgroundJobExecutionMode[];
    }): Promise<import("./types.js").BackgroundJobRow | null>;
    /**
     * Finds the soonest future job.
     * @returns {Promise<import("./types.js").BackgroundJobRow | null>} - Soonest future job.
     */
    nextScheduledJob(): Promise<import("./types.js").BackgroundJobRow | null>;
    /**
     * Reads one job.
     * @param {string} _jobId - Job id.
     * @returns {Promise<import("./types.js").BackgroundJobRow | null>} - Job row.
     */
    getJob(_jobId: string): Promise<import("./types.js").BackgroundJobRow | null>;
    /**
     * Starts a job by claiming its durable handoff.
     * When `handoffId` is supplied, the adapter must persist and return that exact
     * id so the caller can fence an ambiguous commit acknowledgement.
     * @param {import("./types.js").BackgroundJobHandoffRequest} _args - Handoff request.
     * @returns {Promise<import("./types.js").BackgroundJobHandoff | null>} - Claimed handoff.
     */
    markHandedOff(_args: import("./types.js").BackgroundJobHandoffRequest): Promise<import("./types.js").BackgroundJobHandoff | null>;
    /**
     * Marks a handed-off job successful.
     * @param {{jobId: string, handoffId?: string, workerId?: string, handedOffAtMs?: number}} _args - Completion report.
     * @returns {Promise<boolean>} - Whether the fenced report was accepted.
     */
    markCompleted(_args: {
        jobId: string;
        handoffId?: string;
        workerId?: string;
        handedOffAtMs?: number;
    }): Promise<boolean>;
    /**
     * Returns a handed-off job to its schedule.
     * @param {{jobId: string, delayMs: number, handoffId?: string, workerId?: string, handedOffAtMs?: number}} _args - Reschedule report.
     * @returns {Promise<boolean>} - Whether the fenced report was accepted.
     */
    markRescheduled(_args: {
        jobId: string;
        delayMs: number;
        handoffId?: string;
        workerId?: string;
        handedOffAtMs?: number;
    }): Promise<boolean>;
    /**
     * Returns a handed-off job to the queue.
     * @param {{jobId: string, handoffId: string}} _args - Handoff release.
     * @returns {Promise<void>} - Resolves after the job is returned.
     */
    markReturnedToQueue(_args: {
        jobId: string;
        handoffId: string;
    }): Promise<void>;
    /**
     * Finds active handoffs for a worker.
     * @param {{workerId: string}} _args - Worker identity.
     * @returns {Promise<Array<{jobId: string, handoffId: string}>>} - Active worker handoffs.
     */
    handedOffJobsForWorker(_args: {
        workerId: string;
    }): Promise<Array<{
        jobId: string;
        handoffId: string;
    }>>;
    /**
     * Snapshots exact active handoffs before a new main generation accepts worker
     * reconnects. Adapters that do not persist worker leases may return none.
     * @returns {Promise<import("./types.js").BackgroundJobHandoffSnapshot[]>} - Exact active handoffs.
     */
    snapshotHandedOffJobs(): Promise<import("./types.js").BackgroundJobHandoffSnapshot[]>;
    /**
     * Applies orphan failure semantics to unchanged exact handoff snapshots.
     * Adapters that return startup snapshots must implement the matching fenced
     * transition.
     * @param {{handoffs: import("./types.js").BackgroundJobHandoffSnapshot[], error: ReturnType<typeof JSON.parse>}} _args - Exact leases and orphan reason.
     * @returns {Promise<import("./types.js").BackgroundJobRow[]>} - Accepted transitions.
     */
    markOrphanedHandoffs(_args: {
        handoffs: import("./types.js").BackgroundJobHandoffSnapshot[];
        error: ReturnType<typeof JSON.parse>;
    }): Promise<import("./types.js").BackgroundJobRow[]>;
    /**
     * Marks a handed-off job failed or retryable.
     * @param {{jobId: string, error: ReturnType<typeof JSON.parse>, handoffId?: string, workerId?: string, handedOffAtMs?: number}} _args - Failure report.
     * @returns {Promise<import("./types.js").BackgroundJobRow | null>} - Updated job when accepted.
     */
    markFailed(_args: {
        jobId: string;
        error: ReturnType<typeof JSON.parse>;
        handoffId?: string;
        workerId?: string;
        handedOffAtMs?: number;
    }): Promise<import("./types.js").BackgroundJobRow | null>;
    /**
     * Reclaims expired handoffs.
     * @param {{orphanedAfterMs?: number}} [_args] - Sweep options.
     * @returns {Promise<import("./types.js").BackgroundJobRow[]>} - Newly orphaned jobs.
     */
    markOrphanedJobs(_args?: {
        orphanedAfterMs?: number;
    }): Promise<import("./types.js").BackgroundJobRow[]>;
    /**
     * Prunes terminal jobs past their retention windows.
     * @param {{completedTtlMs?: number | null, failedTtlMs?: number | null, batchSize?: number}} [_args] - Retention options.
     * @returns {Promise<number>} - Deleted rows.
     */
    pruneTerminalJobs(_args?: {
        completedTtlMs?: number | null;
        failedTtlMs?: number | null;
        batchSize?: number;
    }): Promise<number>;
}
//# sourceMappingURL=adapter.d.ts.map