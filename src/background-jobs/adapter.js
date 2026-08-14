// @ts-check

/**
 * Platform-neutral persistence and lifecycle contract used by the background-jobs
 * runtime. Adapters own durable queue state; transport and job execution remain
 * separate concerns.
 */
export default class BackgroundJobsAdapter {
  /**
   * Ensures the adapter can accept work.
   * @returns {Promise<void>} - Resolves when ready.
   */
  async ensureReady() { throw new Error("BackgroundJobsAdapter#ensureReady is not implemented") }

  /**
   * Closes adapter-owned resources.
   * @returns {Promise<void>} - Resolves after close.
   */
  async close() {}

  /**
   * Reports adapter health.
   * @returns {Promise<import("./types.js").BackgroundJobsHealth>} - Adapter health.
   */
  async health() {
    return {ready: true}
  }

  /**
   * Ensures framework-owned persistence during a migration lifecycle. Non-SQL
   * adapters may leave this as a no-op.
   * @param {{dbs: Record<string, import("../database/drivers/base.js").default>}} _args - Migrated databases.
   * @returns {Promise<void>} - Resolves when complete.
   */
  async ensureFrameworkSchema(_args) {}

  /**
   * Reconciles configured queue limits.
   * @returns {Promise<void>} - Resolves after reconciliation.
   */
  async reconcileQueueConcurrency() { throw new Error("BackgroundJobsAdapter#reconcileQueueConcurrency is not implemented") }

  /**
   * Enqueues a job.
   * @param {{jobName: string, args: Array<ReturnType<typeof JSON.parse>>, options?: import("./types.js").BackgroundJobOptions}} _args - Job request.
   * @returns {Promise<string>} - Job id.
   */
  async enqueue(_args) { throw new Error("BackgroundJobsAdapter#enqueue is not implemented") }

  /**
   * Replaces the owner of a stable schedule key.
   * @param {{scheduleKey: string, jobName: string, args: Array<ReturnType<typeof JSON.parse>>, options?: import("./types.js").BackgroundJobOptions}} _args - Replacement request.
   * @returns {Promise<import("./types.js").BackgroundJobReplacementResult>} - Replacement result.
   */
  async replaceScheduled(_args) { throw new Error("BackgroundJobsAdapter#replaceScheduled is not implemented") }

  /**
   * Cancels the owner of a stable schedule key.
   * @param {string} _scheduleKey - Stable schedule key.
   * @returns {Promise<import("./types.js").BackgroundJobCancellationResult>} - Cancellation result.
   */
  async cancelScheduled(_scheduleKey) { throw new Error("BackgroundJobsAdapter#cancelScheduled is not implemented") }

  /**
   * Finds the next eligible job.
   * @param {{executionMode?: import("./types.js").BackgroundJobExecutionMode | import("./types.js").BackgroundJobExecutionMode[]}} [_args] - Dequeue filters.
   * @returns {Promise<import("./types.js").BackgroundJobRow | null>} - Next eligible job.
   */
  async nextAvailableJob(_args = {}) { throw new Error("BackgroundJobsAdapter#nextAvailableJob is not implemented") }

  /**
   * Finds the soonest future job.
   * @returns {Promise<import("./types.js").BackgroundJobRow | null>} - Soonest future job.
   */
  async nextScheduledJob() { throw new Error("BackgroundJobsAdapter#nextScheduledJob is not implemented") }

  /**
   * Reads one job.
   * @param {string} _jobId - Job id.
   * @returns {Promise<import("./types.js").BackgroundJobRow | null>} - Job row.
   */
  async getJob(_jobId) { throw new Error("BackgroundJobsAdapter#getJob is not implemented") }

  /**
   * Starts a job by claiming its durable handoff.
   * @param {{jobId: string, workerId?: string}} _args - Handoff request.
   * @returns {Promise<import("./types.js").BackgroundJobHandoff | null>} - Claimed handoff.
   */
  async markHandedOff(_args) { throw new Error("BackgroundJobsAdapter#markHandedOff is not implemented") }

  /**
   * Marks a handed-off job successful.
   * @param {{jobId: string, handoffId?: string, workerId?: string, handedOffAtMs?: number}} _args - Completion report.
   * @returns {Promise<boolean>} - Whether the fenced report was accepted.
   */
  async markCompleted(_args) { throw new Error("BackgroundJobsAdapter#markCompleted is not implemented") }

  /**
   * Returns a handed-off job to its schedule.
   * @param {{jobId: string, delayMs: number, handoffId?: string, workerId?: string, handedOffAtMs?: number}} _args - Reschedule report.
   * @returns {Promise<boolean>} - Whether the fenced report was accepted.
   */
  async markRescheduled(_args) { throw new Error("BackgroundJobsAdapter#markRescheduled is not implemented") }

  /**
   * Returns a handed-off job to the queue.
   * @param {{jobId: string, handoffId: string}} _args - Handoff release.
   * @returns {Promise<void>} - Resolves after the job is returned.
   */
  async markReturnedToQueue(_args) { throw new Error("BackgroundJobsAdapter#markReturnedToQueue is not implemented") }

  /**
   * Finds active handoffs for a worker.
   * @param {{workerId: string}} _args - Worker identity.
   * @returns {Promise<Array<{jobId: string, handoffId: string}>>} - Active worker handoffs.
   */
  async handedOffJobsForWorker(_args) { throw new Error("BackgroundJobsAdapter#handedOffJobsForWorker is not implemented") }

  /**
   * Marks a handed-off job failed or retryable.
   * @param {{jobId: string, error: ReturnType<typeof JSON.parse>, handoffId?: string, workerId?: string, handedOffAtMs?: number}} _args - Failure report.
   * @returns {Promise<import("./types.js").BackgroundJobRow | null>} - Updated job when accepted.
   */
  async markFailed(_args) { throw new Error("BackgroundJobsAdapter#markFailed is not implemented") }

  /**
   * Reclaims expired handoffs.
   * @param {{orphanedAfterMs?: number}} [_args] - Sweep options.
   * @returns {Promise<import("./types.js").BackgroundJobRow[]>} - Newly orphaned jobs.
   */
  async markOrphanedJobs(_args = {}) { throw new Error("BackgroundJobsAdapter#markOrphanedJobs is not implemented") }

  /**
   * Prunes terminal jobs past their retention windows.
   * @param {{completedTtlMs?: number | null, failedTtlMs?: number | null, batchSize?: number}} [_args] - Retention options.
   * @returns {Promise<number>} - Deleted rows.
   */
  async pruneTerminalJobs(_args = {}) { throw new Error("BackgroundJobsAdapter#pruneTerminalJobs is not implemented") }
}
