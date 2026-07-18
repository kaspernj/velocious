// @ts-check

import {randomUUID} from "crypto"
import Logger from "../logger.js"
import TableData from "../database/table-data/index.js"
import VelociousError from "../velocious-error.js"
import BackgroundJobRecord from "./job-record.js"
import normalizeBackgroundJobError from "./normalize-error.js"

const MIGRATIONS_TABLE = "velocious_internal_migrations"
const MIGRATION_SCOPE = "background_jobs"
const MIGRATION_VERSION = "20250215000000"
const EXECUTION_MODE_BACKFILL_MIGRATION_VERSION = "20260607131010"
const JOBS_TABLE = "background_jobs"
const CONCURRENCY_TABLE = "background_job_concurrency"
const DEFAULT_MAX_RETRIES = 10
const ORPHANED_AFTER_MS = 2 * 60 * 60 * 1000
/**
 * Execution modes.
 * @type {import("./types.js").BackgroundJobExecutionMode[]} */
const EXECUTION_MODES = ["inline", "forked", "spawned"]
const DEFAULT_EXECUTION_MODE = "forked"
const DEFAULT_QUEUE = "default"
// Queue-derived durable concurrency keys are namespaced so they can't collide
// with explicit caller-supplied concurrencyKeys.
const QUEUE_CONCURRENCY_KEY_PREFIX = "queue:"

/**
 * Columns the dashboard is allowed to sort job listings by, mapped to their
 * database column names. Restricting to this set keeps the sort parameter
 * (which originates from untrusted query strings) from reaching raw SQL.
 * @type {Record<string, string>}
 */
const SORTABLE_COLUMNS = {
  attempts: "attempts",
  completedAtMs: "completed_at_ms",
  createdAtMs: "created_at_ms",
  failedAtMs: "failed_at_ms",
  handedOffAtMs: "handed_off_at_ms",
  scheduledAtMs: "scheduled_at_ms"
}

export default class BackgroundJobsStore {
  /**
   * Runs constructor.
   * @param {object} args - Options.
   * @param {import("../configuration.js").default} args.configuration - Configuration.
   * @param {string} [args.databaseIdentifier] - Database identifier.
   */
  constructor({configuration, databaseIdentifier}) {
    this.configuration = configuration
    this.databaseIdentifier = databaseIdentifier
    this.logger = new Logger(this)
    this._readyPromise = null
    this._queueConcurrencyReconciled = false
  }

  /**
   * Runs get database identifier.
   * @returns {string} - Database identifier.
   */
  getDatabaseIdentifier() {
    if (this.databaseIdentifier) return this.databaseIdentifier

    return this.configuration.getBackgroundJobsConfig().databaseIdentifier
  }

  /**
   * Runs ensure ready.
   * @returns {Promise<void>} - Resolves when ready.
   */
  async ensureReady() {
    if (this._readyPromise) return await this._readyPromise

    this._readyPromise = (async () => {
      this.configuration.setCurrent()
      await this._ensureSchema()
      await this._initializeModel()
    })()

    try {
      await this._readyPromise
    } finally {
      this._readyPromise = null
    }
  }

  /**
   * Runs enqueue.
   * @param {object} args - Options.
   * @param {string} args.jobName - Job name.
   * @param {Array<?>} args.args - Arguments.
   * @param {import("./types.js").BackgroundJobOptions} [args.options] - Options.
   * @returns {Promise<string>} - Job id.
   */
  async enqueue({jobName, args, options}) {
    await this.ensureReady()

    const jobId = randomUUID()
    const now = Date.now()
    const executionMode = this._normalizeExecutionMode(options)
    const maxRetries = this._normalizeMaxRetries(options?.maxRetries)
    const scheduledAtMs = this._normalizeScheduledAtMs(options?.scheduledAtMs, now)
    const argsJson = JSON.stringify(args || [])
    const queue = this._normalizeQueue(options)
    const concurrency = this._resolveConcurrency(options, queue)
    /** @type {string} */
    let resultJobId = jobId

    await this._withDb(async (db) => {
      if (options?.deduplicateWhileQueued && concurrency?.concurrencyKey) {
        const existing = await db
          .newQuery()
          .from(JOBS_TABLE)
          .select("id")
          .where({status: "queued", concurrency_key: concurrency.concurrencyKey})
          .limit(1)
          .results()

        if (existing[0]) {
          resultJobId = String(/** @type {Record<string, ?>} */ (existing[0]).id)

          return
        }
      }

      if (concurrency) {
        if (concurrency.queueDerived) {
          await this._ensureQueueConcurrencyKey(db, concurrency)
        } else {
          await this._ensureConcurrencyKey(db, concurrency)
        }
      }
      await db.insert({
        tableName: JOBS_TABLE,
        data: {
          id: jobId,
          job_name: jobName,
          args_json: argsJson,
          forked: executionMode !== "inline",
          execution_mode: executionMode,
          queue,
          max_retries: maxRetries,
          attempts: 0,
          status: "queued",
          scheduled_at_ms: scheduledAtMs,
          created_at_ms: now,
          concurrency_key: concurrency?.concurrencyKey || null,
          max_concurrency: concurrency?.maxConcurrency || null
        }
      })
    })

    return resultJobId
  }

  /**
   * Runs next available job.
   * @param {object} [args] - Options.
   * @param {boolean} [args.forked] - Compatibility filter for non-inline vs inline jobs.
   * @param {import("./types.js").BackgroundJobExecutionMode | import("./types.js").BackgroundJobExecutionMode[]} [args.executionMode] - Execution mode or modes to match.
   * @returns {Promise<import("./types.js").BackgroundJobRow | null>} - Next job.
   */
  async nextAvailableJob(args = {}) {
    await this.ensureReady()

    return await this._withDb(async (db) => {
      return await this._nextQueuedJob({
        db,
        scheduledAtOperator: "<=",
        forked: args.forked,
        executionMode: args.executionMode
      })
    })
  }

  /**
   * Returns the soonest future-scheduled queued job (one whose
   * `scheduled_at_ms` is in the future), or null when there are no
   * future-scheduled jobs. Used by the event-driven dispatcher to arm a
   * `setTimeout` for the exact moment the next scheduled job becomes
   * eligible, replacing the legacy 1-second polling loop.
   * @returns {Promise<import("./types.js").BackgroundJobRow | null>} - Soonest future-scheduled job, or null.
   */
  async nextScheduledJob() {
    await this.ensureReady()

    return await this._withDb(async (db) => {
      return await this._nextQueuedJob({db, scheduledAtOperator: ">"})
    })
  }

  /**
   * Runs next queued job.
   * @param {object} args - Options.
   * @param {import("../database/drivers/base.js").default} args.db - Database connection.
   * @param {"<=" | ">"} args.scheduledAtOperator - Scheduled timestamp operator.
   * @param {boolean} [args.forked] - Compatibility filter for non-inline vs inline jobs.
   * @param {import("./types.js").BackgroundJobExecutionMode | import("./types.js").BackgroundJobExecutionMode[]} [args.executionMode] - Execution mode or modes to match.
   * @returns {Promise<import("./types.js").BackgroundJobRow | null>} - Next matching queued job.
   */
  async _nextQueuedJob({db, scheduledAtOperator, forked, executionMode}) {
    const now = Date.now()
    let query = db
      .newQuery()
      .from(JOBS_TABLE)
      .where({status: "queued"})
      .where(`scheduled_at_ms ${scheduledAtOperator} ${db.quote(now)}`)

    if (scheduledAtOperator === "<=") {
      const jobsTable = db.quoteTable(JOBS_TABLE)
      const concurrencyTable = db.quoteTable(CONCURRENCY_TABLE)
      query = query.where(
        `(${jobsTable}.${db.quoteColumn("concurrency_key")} IS NULL OR EXISTS (` +
        `SELECT 1 FROM ${concurrencyTable} WHERE ` +
        `${concurrencyTable}.${db.quoteColumn("concurrency_key")} = ${jobsTable}.${db.quoteColumn("concurrency_key")} AND ` +
        `${concurrencyTable}.${db.quoteColumn("active_count")} < ${concurrencyTable}.${db.quoteColumn("max_concurrency")}))`
      )
    }

    if (typeof forked === "boolean") {
      query = query.where({forked})
    }
    if (executionMode) {
      const executionModes = Array.isArray(executionMode) ? executionMode : [executionMode]

      query = query.where({execution_mode: executionModes})
    }

    if (scheduledAtOperator === "<=") {
      const priorityOrder = this._queuePriorityOrderSql(db)

      if (priorityOrder) query = query.order(`${priorityOrder} DESC`)
    }

    query = query
      .order("scheduled_at_ms ASC")
      .order("created_at_ms ASC")
      .limit(1)

    const rows = await query.results()
    const row = rows[0]

    if (!row) return null

    return this._normalizeJobRow(row)
  }

  /**
   * Builds a raw SQL ORDER BY expression ranking queued jobs by their queue's
   * configured priority (`backgroundJobs.queues[queue].priority`, default `0`),
   * so the dispatcher picks higher-priority queues first regardless of enqueue
   * order. Only applied to the dispatch path (`scheduledAtOperator === "<="`);
   * the future-scheduled lookup must stay strictly time-ordered. Composes with
   * the concurrency EXISTS filter: a higher-priority queue already at its cap is
   * filtered out, so dispatch falls through to the next eligible lower-priority
   * job. Returns null when no queue configures a non-zero priority so the plain
   * FIFO ordering is left untouched (and no needless filesort is introduced).
   * @param {import("../database/drivers/base.js").default} db - Database connection.
   * @returns {string | null} - Raw SQL CASE expression, or null when no queue is prioritized.
   */
  _queuePriorityOrderSql(db) {
    const queues = this.configuration.getBackgroundJobsConfig().queues || {}
    /** @type {Array<[string, number]>} */
    const prioritized = []

    for (const [queue, queueConfig] of Object.entries(queues)) {
      const priority = queueConfig?.priority

      if (Number.isFinite(priority) && Number(priority) !== 0) prioritized.push([queue, Number(priority)])
    }

    if (prioritized.length === 0) return null

    const queueColumn = db.quoteColumn("queue")
    const whens = prioritized
      .map(([queue, priority]) => `WHEN ${db.quote(queue)} THEN ${priority}`)
      .join(" ")

    return `CASE COALESCE(${queueColumn}, ${db.quote(DEFAULT_QUEUE)}) ${whens} ELSE 0 END`
  }

  /**
   * Runs get job.
   * @param {string} jobId - Job id.
   * @returns {Promise<import("./types.js").BackgroundJobRow | null>} - Job row.
   */
  async getJob(jobId) {
    await this.ensureReady()

    return await this._withDb(async (db) => {
      const query = db
        .newQuery()
        .from(JOBS_TABLE)
        .where({id: jobId})
        .limit(1)

      const rows = await query.results()
      const row = rows[0]

      if (!row) return null

      return this._normalizeJobRow(row)
    })
  }

  /**
   * Counts jobs grouped by status. Used by the dashboard overview.
   * @returns {Promise<Record<string, number>>} - Counts keyed by status.
   */
  async countsByStatus() {
    await this.ensureReady()

    return await this._withDb(async (db) => {
      const rows = await db
        .newQuery()
        .from(JOBS_TABLE)
        .select("status")
        .select("COUNT(*) AS count")
        .group("status")
        .results()

      /**
       * Counts.
       * @type {Record<string, number>} */
      const counts = {}

      for (const row of rows) {
        const typedRow = /** @type {Record<string, ?>} */ (row)

        counts[String(typedRow.status)] = this._normalizeNumber(typedRow.count) || 0
      }

      return counts
    })
  }

  /**
   * Counts jobs matching the given filters.
   * @param {object} [args] - Options.
   * @param {string} [args.status] - Filter by status.
   * @param {string} [args.jobName] - Filter by job name.
   * @returns {Promise<number>} - Matching job count.
   */
  async countJobs({status, jobName} = {}) {
    await this.ensureReady()

    return await this._withDb(async (db) => {
      let query = db.newQuery().from(JOBS_TABLE).select("COUNT(*) AS count")

      if (status) query = query.where({status})
      if (jobName) query = query.where({job_name: jobName})

      const rows = await query.results()
      const countRow = /** @type {Record<string, ?>} */ (rows[0] || {})

      return this._normalizeNumber(countRow.count) || 0
    })
  }

  /**
   * Lists jobs for the dashboard, filtered, sorted and paginated.
   * @param {object} [args] - Options.
   * @param {string} [args.status] - Filter by status.
   * @param {string} [args.jobName] - Filter by job name.
   * @param {number} [args.limit] - Maximum rows to return.
   * @param {number} [args.offset] - Rows to skip.
   * @param {string} [args.sortColumn] - Camel-cased column to sort by (see SORTABLE_COLUMNS).
   * @param {"ASC" | "DESC"} [args.sortDirection] - Sort direction.
   * @returns {Promise<import("./types.js").BackgroundJobRow[]>} - Normalized job rows.
   */
  async listJobs({status, jobName, limit = 25, offset = 0, sortColumn = "createdAtMs", sortDirection = "DESC"} = {}) {
    await this.ensureReady()

    const column = SORTABLE_COLUMNS[sortColumn] || SORTABLE_COLUMNS.createdAtMs
    const direction = sortDirection === "ASC" ? "ASC" : "DESC"

    return await this._withDb(async (db) => {
      let query = db.newQuery().from(JOBS_TABLE)

      if (status) query = query.where({status})
      if (jobName) query = query.where({job_name: jobName})

      query = query.order({column, direction})
      if (column !== SORTABLE_COLUMNS.createdAtMs) query = query.order({column: SORTABLE_COLUMNS.createdAtMs, direction: "DESC"})

      const rows = await query.limit(limit).offset(offset).results()

      return rows.map((row) => this._normalizeJobRow(row))
    })
  }

  /**
   * Runs mark handed off.
   * @param {object} args - Options.
   * @param {string} args.jobId - Job id.
   * @param {string} [args.workerId] - Worker id.
   * @returns {Promise<import("./types.js").BackgroundJobHandoff | null>} - Claimed handoff lease, or null when no longer queued.
   */
  async markHandedOff({jobId, workerId}) {
    await this.ensureReady()

    const handedOffAtMs = Date.now()
    const handoffId = randomUUID()

    return await this._withDb(async (db) => await this._transactionResult(db, async () => {
      const queuedJob = await this._getJobRowById(db, jobId)
      if (!queuedJob || queuedJob.status !== "queued") return null
      if (queuedJob.concurrencyKey && !(await this._reserveConcurrency(db, queuedJob.concurrencyKey))) return null

      const affectedRows = await this._updateAffectedRows(db, {
        tableName: JOBS_TABLE,
        data: {
          status: "handed_off",
          handed_off_at_ms: handedOffAtMs,
          handoff_id: handoffId,
          worker_id: workerId || null
        },
        conditions: {id: jobId, status: "queued"}
      })

      if (affectedRows !== 1) {
        await this._releaseConcurrency(db, queuedJob.concurrencyKey)
        return null
      }

      return {handedOffAtMs, handoffId}
    }))
  }

  /**
   * Runs mark completed.
   * @param {object} args - Options.
   * @param {string} args.jobId - Job id.
   * @param {string} [args.handoffId] - Handoff lease id.
   * @param {string} [args.workerId] - Worker id.
   * @param {number} [args.handedOffAtMs] - Handed off timestamp.
   * @returns {Promise<boolean>} - Whether the fenced report was accepted.
   */
  async markCompleted({jobId, handoffId, workerId, handedOffAtMs}) {
    await this.ensureReady()

    return await this._withDb(async (db) => await this._transactionResult(db, async () => {
      const job = await this._getJobRowById(db, jobId)

      if (!job) return false
      if (!this._shouldAcceptReport({job, handoffId, workerId, handedOffAtMs})) return false

      const affectedRows = await this._updateAffectedRows(db, {
        tableName: JOBS_TABLE,
        data: {
          status: "completed",
          completed_at_ms: Date.now()
        },
        conditions: this._activeHandoffConditions(job)
      })

      if (affectedRows !== 1) return false
      await this._releaseConcurrency(db, job.concurrencyKey)
      return true
    }))
  }

  /**
   * Runs mark returned to queue.
   * @param {object} args - Options.
   * @param {string} args.jobId - Job id.
   * @param {string} args.handoffId - Handoff lease id.
   * @returns {Promise<void>} - Resolves when updated.
   */
  async markReturnedToQueue({jobId, handoffId}) {
    await this.ensureReady()

    await this._withDb(async (db) => await db.transaction(async () => {
      const job = await this._getJobRowById(db, jobId)
      if (!job || job.handoffId !== handoffId || job.status !== "handed_off") return
      const affectedRows = await this._updateAffectedRows(db, {
        tableName: JOBS_TABLE,
        data: {
          status: "queued",
          scheduled_at_ms: Date.now(),
          handed_off_at_ms: null,
          handoff_id: null,
          worker_id: null
        },
        conditions: {handoff_id: handoffId, id: jobId, status: "handed_off"}
      })
      if (affectedRows === 1) await this._releaseConcurrency(db, job.concurrencyKey)
    }))
  }

  /**
   * Returns the active `handed_off` jobs (jobId + handoffId) held under a worker
   * id. Used on worker reconnect: after a main restart a worker reconnects with
   * its stable id, and the fresh main adopts these leases so they are tracked —
   * and released if the reconnected worker later disconnects — instead of
   * sitting stuck until the age-based orphan sweep. This never reclaims, so a
   * gracefully-draining worker that keeps running its in-flight jobs is left
   * untouched. Rows with a null handoff id (legacy) are skipped; the orphan
   * sweep reclaims those via its `handed_off_at_ms` fence.
   * @param {object} args - Options.
   * @param {string} args.workerId - Worker id.
   * @returns {Promise<Array<{jobId: string, handoffId: string}>>} - Active handoffs.
   */
  async handedOffJobsForWorker({workerId}) {
    await this.ensureReady()

    const rows = await this._withDb(async (db) =>
      await db.newQuery().from(JOBS_TABLE).where({status: "handed_off", worker_id: workerId}).results()
    )

    /** @type {Array<{jobId: string, handoffId: string}>} */
    const handoffs = []

    for (const row of rows) {
      const job = this._normalizeJobRow(row)

      if (job.handoffId) handoffs.push({jobId: job.id, handoffId: job.handoffId})
    }

    return handoffs
  }

  /**
   * Runs mark failed.
   * @param {object} args - Options.
   * @param {string} args.jobId - Job id.
   * @param {?} args.error - Error.
   * @param {string} [args.handoffId] - Handoff lease id.
   * @param {string} [args.workerId] - Worker id.
   * @param {number} [args.handedOffAtMs] - Handed off timestamp.
   * @returns {Promise<import("./types.js").BackgroundJobRow | null>} - Updated job row when the report was accepted.
   */
  async markFailed({jobId, error, handoffId, workerId, handedOffAtMs}) {
    await this.ensureReady()

    return await this._withDb(async (db) => await this._transactionResult(db, async () => {
      const job = await this._getJobRowById(db, jobId)

      if (!job) return null
      if (!this._shouldAcceptReport({job, handoffId, workerId, handedOffAtMs})) return null

      const updatedJob = await this._applyFailure({db, job, error, markOrphaned: false})
      return updatedJob
    }))
  }

  /**
   * Runs mark orphaned jobs.
   * @param {object} [args] - Options.
   * @param {number} [args.orphanedAfterMs] - Mark jobs orphaned after this duration.
   * @returns {Promise<number>} - Count of orphaned jobs.
   */
  async markOrphanedJobs({orphanedAfterMs = ORPHANED_AFTER_MS} = {}) {
    await this.ensureReady()

    return await this._withDb(async (db) => {
      const cutoff = Date.now() - orphanedAfterMs
      const query = db
        .newQuery()
        .from(JOBS_TABLE)
        .where({status: "handed_off"})
        .where(`handed_off_at_ms <= ${db.quote(cutoff)}`)

      const rows = await query.results()

      let orphanedCount = 0

      for (const row of rows) {
        const job = this._normalizeJobRow(row)

        // Fence the reclaim on the exact handoff this sweep selected, using its
        // `handed_off_at_ms` rather than its `handoff_id`. Two reasons:
        //   1. Null-safe. Some rows have a null `handoff_id` (handed off by an
        //      older velocious before handoff-id fencing). `{handoff_id: null}`
        //      renders as `handoff_id = NULL`, which matches nothing, so those
        //      rows would be stranded in `handed_off` forever.
        //   2. Race-safe. If the row is returned to the queue and re-handed-off
        //      between the SELECT above and this update, it gets a fresh
        //      `handed_off_at_ms` (always "now"), so this stale cutoff-era
        //      timestamp no longer matches and we won't fail/orphan — or
        //      wrongly release the concurrency reservation of — that new lease.
        // `handed_off_at_ms` is always set on a handed-off row (and the SELECT
        // required it `<= cutoff`), so it is a reliable null-safe lease pin.
        const orphanedJob = await this._applyFailure({
          db,
          job,
          error: "Job orphaned after timeout",
          markOrphaned: true,
          conditions: {id: job.id, status: "handed_off", handed_off_at_ms: job.handedOffAtMs}
        })

        if (orphanedJob) orphanedCount += 1
      }

      return orphanedCount
    })
  }

  /**
   * Deletes terminal job rows past their retention window so the jobs table
   * does not grow unbounded (completed rows in particular accumulate forever
   * otherwise). Batched by id — SELECT a page of ids, then
   * `DELETE ... WHERE id IN (...)` — rather than `DELETE ... LIMIT`, which not
   * every driver supports; each batch runs on its own connection so the sweep
   * yields between batches instead of holding one long transaction.
   * @param {object} [args] - Options.
   * @param {number | null} [args.completedTtlMs] - Delete `completed` jobs whose `completed_at_ms` is older than this many ms. Falsy or `<= 0` disables completed pruning.
   * @param {number | null} [args.failedTtlMs] - Delete terminal `failed`/`orphaned` jobs older than this many ms (by `failed_at_ms`/`orphaned_at_ms`). Falsy or `<= 0` disables.
   * @param {number} [args.batchSize] - Max rows deleted per batch. Default `1000`.
   * @returns {Promise<number>} - Total rows deleted.
   */
  async pruneTerminalJobs({completedTtlMs = null, failedTtlMs = null, batchSize = 1000} = {}) {
    await this.ensureReady()

    const now = Date.now()
    const size = batchSize > 0 ? batchSize : 1000
    let deleted = 0

    if (completedTtlMs && completedTtlMs > 0) {
      deleted += await this._pruneStatusBatches({status: "completed", column: "completed_at_ms", cutoff: now - completedTtlMs, batchSize: size})
    }

    if (failedTtlMs && failedTtlMs > 0) {
      deleted += await this._pruneStatusBatches({status: "failed", column: "failed_at_ms", cutoff: now - failedTtlMs, batchSize: size})
      deleted += await this._pruneStatusBatches({status: "orphaned", column: "orphaned_at_ms", cutoff: now - failedTtlMs, batchSize: size})
    }

    return deleted
  }

  /**
   * Deletes rows of one terminal status older than a cutoff, batch by batch,
   * until a page returns fewer than `batchSize` rows.
   * @param {object} args - Options.
   * @param {string} args.status - Terminal status to prune.
   * @param {string} args.column - Timestamp column compared against the cutoff.
   * @param {number} args.cutoff - Delete rows whose column value is `<= cutoff`.
   * @param {number} args.batchSize - Max rows per batch.
   * @returns {Promise<number>} - Rows deleted for this status.
   */
  async _pruneStatusBatches({status, column, cutoff, batchSize}) {
    let deleted = 0

    for (;;) {
      const removed = await this._withDb(async (db) => {
        const rows = await db
          .newQuery()
          .from(JOBS_TABLE)
          .select("id")
          .where({status})
          .where(`${db.quoteColumn(column)} <= ${db.quote(cutoff)}`)
          .limit(batchSize)
          .results()

        if (rows.length === 0) return 0

        const ids = rows.map((/** @type {Record<string, ?>} */ row) => db.quote(String(row.id))).join(", ")

        await db.query(`DELETE FROM ${db.quoteTable(JOBS_TABLE)} WHERE ${db.quoteColumn("id")} IN (${ids})`)

        return rows.length
      })

      deleted += removed
      if (removed < batchSize) break
    }

    return deleted
  }

  /**
   * Runs clear all.
   * @returns {Promise<void>} - Resolves when cleared.
   */
  async clearAll() {
    await this.ensureReady()

    await this._withDb(async (db) => {
      await db.query(`DELETE FROM ${db.quoteTable(JOBS_TABLE)}`)
      if (await db.tableExists(CONCURRENCY_TABLE)) await db.query(`DELETE FROM ${db.quoteTable(CONCURRENCY_TABLE)}`)
    })
  }

  /**
   * Cancels a queued or handed-off job and releases any durable concurrency reservation.
   * @param {string} jobId - Job id.
   * @returns {Promise<boolean>} - Whether the job was cancelled.
   */
  async cancel(jobId) {
    await this.ensureReady()
    return await this._withDb(async (db) => await this._transactionResult(db, async () => {
      const job = await this._getJobRowById(db, jobId)
      if (!job || (job.status !== "queued" && job.status !== "handed_off")) return false
      const affectedRows = await this._updateAffectedRows(db, {tableName: JOBS_TABLE, data: {status: "cancelled"}, conditions: {id: job.id, status: job.status}})
      if (affectedRows !== 1) return false
      if (job.status === "handed_off") await this._releaseConcurrency(db, job.concurrencyKey)
      return true
    }))
  }

  /**
   * Runs get retry delay ms.
   * @param {number} retryCount - Retry attempt count (1-based).
   * @returns {number} - Delay in milliseconds.
   */
  getRetryDelayMs(retryCount) {
    const scheduleSeconds = [10, 60, 600, 3600]

    if (retryCount <= scheduleSeconds.length) {
      return scheduleSeconds[retryCount - 1] * 1000
    }

    return (retryCount - 3) * 60 * 60 * 1000
  }

  /**
   * Runs normalize max retries.
   * @param {number | null | undefined} maxRetries - Input.
   * @returns {number} - Normalized max retries.
   */
  _normalizeMaxRetries(maxRetries) {
    if (typeof maxRetries === "number" && Number.isFinite(maxRetries) && maxRetries >= 0) {
      return Math.floor(maxRetries)
    }

    return DEFAULT_MAX_RETRIES
  }

  /**
   * Runs normalize scheduled at ms.
   * @param {number | undefined} scheduledAtMs - Requested dispatch timestamp.
   * @param {number} defaultScheduledAtMs - Default dispatch timestamp.
   * @returns {number} - Dispatch timestamp.
   */
  _normalizeScheduledAtMs(scheduledAtMs, defaultScheduledAtMs) {
    if (scheduledAtMs === undefined) return defaultScheduledAtMs
    if (Number.isSafeInteger(scheduledAtMs) && scheduledAtMs >= 0) return scheduledAtMs

    throw VelociousError.safe("background job scheduledAtMs must be a non-negative safe integer")
  }

  async _ensureSchema() {
    await this._withDb(async (db) => {
      await this._ensureMigrationsTable(db)

      const alreadyApplied = await this._hasMigration(db)

      // Even when the migration row is present, the jobs table itself can have
      // been dropped underneath us by a transaction rollback in another caller
      // (DDL is transactional on SQLite/MSSQL). Verify the table physically
      // exists and recreate it when missing rather than trusting the migration
      // row alone, otherwise later callers fail with "no such table".
      if (alreadyApplied && await db.tableExists(JOBS_TABLE)) {
        await this._ensureJobsTableColumns(db)
        await this._ensureConcurrencyTable(db)
        await this._reconcileQueueConcurrency(db)
        await this._reconcileConcurrency(db)
        return
      }

      await this._applyMigrations(db)
      await this._ensureJobsTableColumns(db)
      await this._ensureConcurrencyTable(db)
      await this._reconcileQueueConcurrency(db)
      await this._reconcileConcurrency(db)

      if (alreadyApplied) return

      await this._recordMigration(db, MIGRATION_VERSION)
    })
  }

  /**
   * Runs ensure migrations table.
   * @param {import("../database/drivers/base.js").default} db - Database connection.
   * @returns {Promise<void>} - Resolves when complete.
   */
  async _ensureMigrationsTable(db) {
    if (await db.tableExists(MIGRATIONS_TABLE)) return

    const table = new TableData(MIGRATIONS_TABLE, {ifNotExists: true})

    table.string("key", {null: false, primaryKey: true})
    table.string("scope", {null: false})
    table.string("version", {null: false})
    table.bigint("applied_at_ms", {null: false})

    await db.createTable(table)
  }

  /**
   * Runs has migration.
   * @param {import("../database/drivers/base.js").default} db - Database connection.
   * @param {string} [version] - Migration version.
   * @returns {Promise<boolean>} - Whether migration exists.
   */
  async _hasMigration(db, version = MIGRATION_VERSION) {
    const query = db
      .newQuery()
      .from(MIGRATIONS_TABLE)
      .where({key: this._migrationKey(version)})
      .limit(1)

    const rows = await query.results()

    return rows.length > 0
  }

  /**
   * Runs apply migrations.
   * @param {import("../database/drivers/base.js").default} db - Database connection.
   * @returns {Promise<void>} - Resolves when complete.
   */
  async _applyMigrations(db) {
    this.logger.info("Applying background jobs schema")

    if (await db.tableExists(JOBS_TABLE)) {
      this.logger.info("Background jobs table already exists - skipping create")
      return
    }

    const table = new TableData(JOBS_TABLE, {ifNotExists: true})

    table.string("id", {primaryKey: true})
    table.string("job_name", {null: false, index: true})
    table.text("args_json", {null: false})
    table.boolean("forked", {null: false})
    table.string("execution_mode", {null: false})
    table.string("queue", {null: true, index: true})
    table.integer("max_retries", {null: false})
    table.integer("attempts", {null: false})
    table.string("status", {null: false, index: true})
    table.bigint("scheduled_at_ms", {null: false, index: true})
    table.bigint("created_at_ms", {null: false, index: true})
    table.bigint("handed_off_at_ms", {null: true, index: true})
    table.string("handoff_id", {null: true})
    table.bigint("completed_at_ms", {null: true})
    table.bigint("failed_at_ms", {null: true})
    table.bigint("orphaned_at_ms", {null: true, index: true})
    table.string("worker_id", {null: true})
    table.text("last_error", {null: true})
    table.string("concurrency_key", {null: true, index: true})
    table.integer("max_concurrency", {null: true})

    await db.createTable(table)
  }

  /**
   * Runs ensure jobs table columns.
   * @param {import("../database/drivers/base.js").default} db - Database connection.
   * @returns {Promise<void>} - Resolves when complete.
   */
  async _ensureJobsTableColumns(db) {
    if (!(await db.tableExists(JOBS_TABLE))) return

    const table = await db.getTableByNameOrFail(JOBS_TABLE)
    const executionModeColumn = await table.getColumnByName("execution_mode")

    if (!executionModeColumn) {
      const tableData = new TableData(JOBS_TABLE)
      tableData.string("execution_mode", {null: true})
      const sqls = await db.alterTableSQLs(tableData)

      for (const sql of sqls) {
        await db.query(sql)
      }

      db.clearSchemaCache()
    }

    const refreshedTable = await db.getTableByNameOrFail(JOBS_TABLE)
    const handoffIdColumn = await refreshedTable.getColumnByName("handoff_id")

    if (!handoffIdColumn) {
      const lockName = `${MIGRATION_SCOPE}:handoff_id_column`
      const acquired = await db.acquireAdvisoryLock(lockName)

      if (!acquired) throw new Error("Failed to acquire background jobs handoff schema lock")

      try {
        db.clearSchemaCache()
        const lockedTable = await db.getTableByNameOrFail(JOBS_TABLE)

        if (!(await lockedTable.getColumnByName("handoff_id"))) {
          const tableData = new TableData(JOBS_TABLE)
          tableData.string("handoff_id", {null: true})
          const sqls = await db.alterTableSQLs(tableData)

          for (const sql of sqls) {
            await db.query(sql)
          }

          db.clearSchemaCache()
        }
      } finally {
        await db.releaseAdvisoryLock(lockName)
      }
    }

    await this._backfillExecutionModesOnce(db)

    const lockName = `${MIGRATION_SCOPE}:concurrency_columns`
    const acquired = await db.acquireAdvisoryLock(lockName)

    if (!acquired) throw new Error("Failed to acquire background jobs concurrency schema lock")

    try {
      // SQL Server schema reads can deadlock with a concurrent ALTER TABLE, so
      // acquire the lock before inspecting either column rather than only
      // protecting the mutation.
      db.clearSchemaCache()
      const lockedTable = await db.getTableByNameOrFail(JOBS_TABLE)
      const concurrencyColumnNames = ["concurrency_key", "max_concurrency"]

      for (const concurrencyColumnName of concurrencyColumnNames) {
        if (await lockedTable.getColumnByName(concurrencyColumnName)) continue

        const tableData = new TableData(JOBS_TABLE)
        if (concurrencyColumnName == "concurrency_key") {
          tableData.string("concurrency_key", {null: true, index: true})
        } else {
          tableData.integer("max_concurrency", {null: true})
        }

        for (const sql of await db.alterTableSQLs(tableData)) await db.query(sql)
      }

      db.clearSchemaCache()
    } finally {
      await db.releaseAdvisoryLock(lockName)
    }

    await this._ensureQueueColumn(db)
  }

  /**
   * Idempotently adds the `queue` column to an existing jobs table. Existing
   * rows read back as the default queue (see {@link _normalizeJobRow}), so no
   * data backfill is required.
   * @param {import("../database/drivers/base.js").default} db - Database connection.
   * @returns {Promise<void>} - Resolves when ensured.
   */
  async _ensureQueueColumn(db) {
    const lockName = `${MIGRATION_SCOPE}:queue_column`
    const acquired = await db.acquireAdvisoryLock(lockName)

    if (!acquired) throw new Error("Failed to acquire background jobs queue schema lock")

    try {
      // SQL Server schema reads can deadlock with a concurrent ALTER TABLE, so
      // acquire the lock before inspecting the column rather than only
      // protecting the mutation (mirrors the concurrency-column migration).
      db.clearSchemaCache()
      const lockedTable = await db.getTableByNameOrFail(JOBS_TABLE)

      if (!(await lockedTable.getColumnByName("queue"))) {
        const tableData = new TableData(JOBS_TABLE)

        tableData.string("queue", {null: true, index: true})

        for (const sql of await db.alterTableSQLs(tableData)) await db.query(sql)

        db.clearSchemaCache()
      }
    } finally {
      await db.releaseAdvisoryLock(lockName)
    }
  }

  /**
   * Runs backfill execution modes once.
   * @param {import("../database/drivers/base.js").default} db - Database connection.
   * @returns {Promise<void>} - Resolves when complete.
   */
  async _backfillExecutionModesOnce(db) {
    const migrationVersion = EXECUTION_MODE_BACKFILL_MIGRATION_VERSION
    const migrationKey = this._migrationKey(migrationVersion)

    if (await this._hasMigration(db, migrationVersion)) return

    await db.acquireAdvisoryLock(migrationKey)

    try {
      if (await this._hasMigration(db, migrationVersion)) return

      const tableNameSql = db.quoteTable(JOBS_TABLE)
      const forkedColumnSql = db.quoteColumn("forked")
      const executionModeColumnSql = db.quoteColumn("execution_mode")

      await db.query(
        `UPDATE ${tableNameSql} SET ${executionModeColumnSql} = ${db.quote(DEFAULT_EXECUTION_MODE)} ` +
        `WHERE ${forkedColumnSql} = ${db.quote(true)} AND ${executionModeColumnSql} IS NULL`
      )
      await db.query(
        `UPDATE ${tableNameSql} SET ${executionModeColumnSql} = ${db.quote("inline")} ` +
        `WHERE ${forkedColumnSql} = ${db.quote(false)} AND ${executionModeColumnSql} IS NULL`
      )

      await this._recordMigration(db, migrationVersion)
    } finally {
      await db.releaseAdvisoryLock(migrationKey)
    }
  }

  /**
   * Runs record migration.
   * @param {import("../database/drivers/base.js").default} db - Database connection.
   * @param {string} version - Migration version.
   * @returns {Promise<void>} - Resolves when complete.
   */
  async _recordMigration(db, version) {
    await db.upsert({
      tableName: MIGRATIONS_TABLE,
      data: {
        key: this._migrationKey(version),
        scope: MIGRATION_SCOPE,
        version,
        applied_at_ms: Date.now()
      },
      conflictColumns: ["key"],
      updateColumns: ["scope", "version", "applied_at_ms"]
    })
  }

  async _initializeModel() {
    BackgroundJobRecord.setDatabaseIdentifier(this.getDatabaseIdentifier())

    if (BackgroundJobRecord.isInitialized()) return

    const pool = this.configuration.getDatabasePool(this.getDatabaseIdentifier())

    await pool.withConnection({name: "Background jobs store initialize model"}, async () => {
      await BackgroundJobRecord.initializeRecord({configuration: this.configuration})
    })
  }

  /**
   * Runs get job row by id.
   * @param {import("../database/drivers/base.js").default} db - Database connection.
   * @param {string} jobId - Job id.
   * @returns {Promise<import("./types.js").BackgroundJobRow | null>} - Job row.
   */
  async _getJobRowById(db, jobId) {
    const query = db
      .newQuery()
      .from(JOBS_TABLE)
      .where({id: jobId})
      .limit(1)

    const rows = await query.results()

    if (!rows[0]) return null

    return this._normalizeJobRow(rows[0])
  }

  /**
   * Runs apply failure.
   * @param {object} args - Options.
   * @param {import("../database/drivers/base.js").default} args.db - Database connection.
   * @param {import("./types.js").BackgroundJobRow} args.job - Job row.
   * @param {?} args.error - Error.
   * @param {boolean} args.markOrphaned - Whether marking orphaned.
   * @param {Record<string, ?>} [args.conditions] - Update fencing conditions. Defaults to the active-handoff lease match; the time-based orphan sweep overrides this with an id/status match so it can reclaim rows whose `handoff_id` is null (e.g. handed off by an older velocious before handoff-id fencing existed).
   * @returns {Promise<import("./types.js").BackgroundJobRow | null>} - Updated job row when the lease transition won.
   */
  async _applyFailure({db, job, error, markOrphaned, conditions}) {
    const now = Date.now()
    const nextAttempt = (job.attempts || 0) + 1
    const maxRetries = this._normalizeMaxRetries(job.maxRetries)
    const shouldRetry = nextAttempt <= maxRetries
    const failureMessage = normalizeBackgroundJobError(error)
    const scheduledAt = shouldRetry ? now + this.getRetryDelayMs(nextAttempt) : job.scheduledAtMs
    const update = this._failureUpdate({
      failureMessage,
      markOrphaned,
      nextAttempt,
      now,
      scheduledAt,
      shouldRetry
    })

    const affectedRows = await this._updateAffectedRows(db, {
      tableName: JOBS_TABLE,
      data: update,
      conditions: conditions ?? this._activeHandoffConditions(job)
    })

    if (affectedRows !== 1) return null
    await this._releaseConcurrency(db, job.concurrencyKey)

    const updatedJob = await this._getJobRowById(db, job.id)

    if (!updatedJob) return null
    return updatedJob
  }

  /**
   * Runs failure update.
   * @param {object} args - Options.
   * @param {string} args.failureMessage - Last failure message.
   * @param {boolean} args.markOrphaned - Whether marking orphaned.
   * @param {number} args.nextAttempt - Next attempt count.
   * @param {number} args.now - Current timestamp.
   * @param {number | null} args.scheduledAt - Next scheduled timestamp.
   * @param {boolean} args.shouldRetry - Whether the job should retry.
   * @returns {Record<string, ?>} - Database update data.
   */
  _failureUpdate({failureMessage, markOrphaned, nextAttempt, now, scheduledAt, shouldRetry}) {
    /**
     * Update.
     * @type {Record<string, ?>} */
    const update = {
      attempts: nextAttempt,
      handed_off_at_ms: null,
      worker_id: null,
      last_error: failureMessage
    }

    this._applyOrphanedFailureUpdate({markOrphaned, now, update})
    this._applyFailureStatusUpdate({markOrphaned, now, scheduledAt, shouldRetry, update})

    return update
  }

  /**
   * Runs apply orphaned failure update.
   * @param {object} args - Options.
   * @param {boolean} args.markOrphaned - Whether marking orphaned.
   * @param {number} args.now - Current timestamp.
   * @param {Record<string, ?>} args.update - Database update data.
   * @returns {void}
   */
  _applyOrphanedFailureUpdate({markOrphaned, now, update}) {
    if (markOrphaned) update.orphaned_at_ms = now
  }

  /**
   * Runs apply failure status update.
   * @param {object} args - Options.
   * @param {boolean} args.markOrphaned - Whether marking orphaned.
   * @param {number} args.now - Current timestamp.
   * @param {number | null} args.scheduledAt - Next scheduled timestamp.
   * @param {boolean} args.shouldRetry - Whether the job should retry.
   * @param {Record<string, ?>} args.update - Database update data.
   * @returns {void}
   */
  _applyFailureStatusUpdate({markOrphaned, now, scheduledAt, shouldRetry, update}) {
    if (shouldRetry) {
      update.status = "queued"
      update.scheduled_at_ms = scheduledAt
      return
    }

    if (markOrphaned) {
      update.status = "orphaned"
      return
    }

    update.status = "failed"
    update.failed_at_ms = now
  }

  /**
   * Runs normalize job row.
   * @param {Record<string, ?>} row - Raw database row.
   * @returns {import("./types.js").BackgroundJobRow} - Normalized job row.
   */
  _normalizeJobRow(row) {
    const executionMode = row.execution_mode
      ? this._normalizeExecutionModeName(String(row.execution_mode))
      : this._normalizeExecutionMode({forked: this._normalizeBoolean(row.forked)})

    return {
      id: String(row.id),
      jobName: String(row.job_name),
      args: this._parseArgs(row.args_json),
      executionMode,
      forked: executionMode !== "inline",
      queue: row.queue ? String(row.queue) : DEFAULT_QUEUE,
      status: row.status ? String(row.status) : "queued",
      attempts: this._normalizeNumber(row.attempts),
      maxRetries: this._normalizeNumber(row.max_retries),
      scheduledAtMs: this._normalizeNumber(row.scheduled_at_ms),
      createdAtMs: this._normalizeNumber(row.created_at_ms),
      handedOffAtMs: this._normalizeNumber(row.handed_off_at_ms),
      handoffId: row.handoff_id ? String(row.handoff_id) : null,
      completedAtMs: this._normalizeNumber(row.completed_at_ms),
      failedAtMs: this._normalizeNumber(row.failed_at_ms),
      orphanedAtMs: this._normalizeNumber(row.orphaned_at_ms),
      workerId: row.worker_id ? String(row.worker_id) : null,
      lastError: row.last_error ? String(row.last_error) : null,
      concurrencyKey: row.concurrency_key ? String(row.concurrency_key) : null,
      maxConcurrency: this._normalizeNumber(row.max_concurrency)
    }
  }

  /**
   * Validates concurrency options.
   * @param {import("./types.js").BackgroundJobOptions | undefined} options - Job options.
   * @returns {{concurrencyKey: string, maxConcurrency: number} | null} - Normalized configuration.
   */
  _normalizeConcurrencyOptions(options) {
    const key = options?.concurrencyKey
    const cap = options?.maxConcurrency
    if (key === undefined && cap === undefined) return null
    if (typeof key !== "string" || key.length === 0 || !Number.isInteger(cap) || Number(cap) <= 0) {
      throw new Error("background job concurrencyKey and maxConcurrency must be paired; concurrencyKey must be non-empty and maxConcurrency must be a positive integer")
    }
    if (key.startsWith(QUEUE_CONCURRENCY_KEY_PREFIX)) {
      throw new Error(`background job concurrencyKey must not start with the reserved "${QUEUE_CONCURRENCY_KEY_PREFIX}" prefix, which is reserved for queue-derived concurrency caps`)
    }
    return {concurrencyKey: key, maxConcurrency: Number(cap)}
  }

  /**
   * Normalizes a job's queue name, defaulting to "default".
   * @param {import("./types.js").BackgroundJobOptions | undefined} options - Job options.
   * @returns {string} - Queue name.
   */
  _normalizeQueue(options) {
    const queue = options?.queue

    if (typeof queue === "string" && queue.trim().length > 0) return queue.trim()

    return DEFAULT_QUEUE
  }

  /**
   * Resolves a job's durable concurrency. An explicit concurrencyKey/maxConcurrency
   * pair always wins. Otherwise, when the job's queue has a configured cap
   * (`backgroundJobs.queues[queue].maxConcurrent`), derive a queue-scoped
   * concurrency key so the queue cap is enforced cluster-wide through the
   * existing durable concurrency mechanism.
   * @param {import("./types.js").BackgroundJobOptions | undefined} options - Job options.
   * @param {string} queue - Normalized queue name.
   * @returns {{concurrencyKey: string, maxConcurrency: number, queueDerived: boolean} | null} - Resolved concurrency.
   */
  _resolveConcurrency(options, queue) {
    const explicit = this._normalizeConcurrencyOptions(options)

    if (explicit) return {...explicit, queueDerived: false}

    const cap = this._queueMaxConcurrency(queue)

    if (cap === null) return null

    return {concurrencyKey: `${QUEUE_CONCURRENCY_KEY_PREFIX}${queue}`, maxConcurrency: cap, queueDerived: true}
  }

  /**
   * Reads the configured max concurrency for a queue from the background-jobs config.
   * @param {string} queue - Queue name.
   * @returns {number | null} - Positive integer cap, or null when the queue has no configured cap.
   */
  _queueMaxConcurrency(queue) {
    const queues = this.configuration.getBackgroundJobsConfig().queues
    const cap = queues?.[queue]?.maxConcurrent

    if (Number.isInteger(cap) && Number(cap) > 0) return Number(cap)

    return null
  }

  /**
   * Like {@link _ensureConcurrencyKey}, but for queue-derived keys the configured
   * queue cap is the source of truth: if it changed, update the stored cap
   * instead of throwing on conflict (config-driven caps must be tunable).
   * @param {import("../database/drivers/base.js").default} db - Database connection.
   * @param {{concurrencyKey: string, maxConcurrency: number}} concurrency - Concurrency configuration.
   * @returns {Promise<void>} - Resolves when ensured.
   */
  async _ensureQueueConcurrencyKey(db, {concurrencyKey, maxConcurrency}) {
    const rows = await db.newQuery().from(CONCURRENCY_TABLE).where({concurrency_key: concurrencyKey}).limit(1).results()

    if (!rows[0]) {
      try {
        await db.insert({tableName: CONCURRENCY_TABLE, data: {active_count: 0, concurrency_key: concurrencyKey, max_concurrency: maxConcurrency}})

        return
      } catch (error) {
        const racedRows = await db.newQuery().from(CONCURRENCY_TABLE).where({concurrency_key: concurrencyKey}).limit(1).results()

        if (!racedRows[0]) throw error

        rows[0] = racedRows[0]
      }
    }

    const configured = /** @type {{max_concurrency?: number | string}} */ (rows[0])

    if (this._normalizeNumber(configured.max_concurrency) !== maxConcurrency) {
      const table = db.quoteTable(CONCURRENCY_TABLE)

      await db.query(`UPDATE ${table} SET ${db.quoteColumn("max_concurrency")} = ${Number(maxConcurrency)} WHERE ${db.quoteColumn("concurrency_key")} = ${db.quote(concurrencyKey)}`)
    }
  }

  /**
   * Ensures the concurrency state table exists.
   * @param {import("../database/drivers/base.js").default} db - Database connection.
   * @returns {Promise<void>} - Resolves when ready.
   */
  async _ensureConcurrencyTable(db) {
    if (await db.tableExists(CONCURRENCY_TABLE)) return
    const table = new TableData(CONCURRENCY_TABLE, {ifNotExists: true})
    table.string("concurrency_key", {primaryKey: true})
    table.integer("max_concurrency", {null: false})
    table.integer("active_count", {null: false})
    await db.createTable(table)
  }

  /**
   * Registers or verifies a stable key configuration.
   * @param {import("../database/drivers/base.js").default} db - Database connection.
   * @param {object} concurrency - Concurrency configuration.
   * @param {string} concurrency.concurrencyKey - Concurrency key.
   * @param {number} concurrency.maxConcurrency - Stable cap.
   * @returns {Promise<void>} - Resolves when verified.
   */
  async _ensureConcurrencyKey(db, {concurrencyKey, maxConcurrency}) {
    const rows = await db.newQuery().from(CONCURRENCY_TABLE).where({concurrency_key: concurrencyKey}).limit(1).results()
    if (!rows[0]) {
      try {
        await db.insert({tableName: CONCURRENCY_TABLE, data: {active_count: 0, concurrency_key: concurrencyKey, max_concurrency: maxConcurrency}})
        return
      } catch (error) {
        const racedRows = await db.newQuery().from(CONCURRENCY_TABLE).where({concurrency_key: concurrencyKey}).limit(1).results()
        if (!racedRows[0]) throw error
        rows[0] = racedRows[0]
      }
    }
    const configured = /** @type {{max_concurrency?: number | string}} */ (rows[0])
    if (this._normalizeNumber(configured.max_concurrency) !== maxConcurrency) throw new Error(`Conflicting maxConcurrency for background job concurrencyKey: ${concurrencyKey}`)
  }

  /**
   * Atomically reserves capacity for a key.
   * @param {import("../database/drivers/base.js").default} db - Database connection.
   * @param {string} concurrencyKey - Concurrency key.
   * @returns {Promise<boolean>} - Whether capacity was reserved.
   */
  async _reserveConcurrency(db, concurrencyKey) {
    const table = db.quoteTable(CONCURRENCY_TABLE)
    const count = db.quoteColumn("active_count")
    const affectedRows = await db.affectedRows(`UPDATE ${table} SET ${count} = ${count} + 1 WHERE ${db.quoteColumn("concurrency_key")} = ${db.quote(concurrencyKey)} AND ${count} < ${db.quoteColumn("max_concurrency")}`)
    return affectedRows === 1
  }

  /**
   * Runs a portable update and returns its affected-row count.
   * @param {import("../database/drivers/base.js").default} db - Database connection.
   * @param {import("../database/drivers/base.js").UpdateSqlArgsType} args - Update options.
   * @returns {Promise<number>} - Affected row count.
   */
  async _updateAffectedRows(db, args) {
    return await db.affectedRows(db.updateSql(args))
  }

  /**
   * Releases capacity for a key.
   * @param {import("../database/drivers/base.js").default} db - Database connection.
   * @param {string | null} concurrencyKey - Concurrency key.
   * @returns {Promise<void>} - Resolves when released.
   */
  async _releaseConcurrency(db, concurrencyKey) {
    if (!concurrencyKey) return
    const table = db.quoteTable(CONCURRENCY_TABLE)
    const count = db.quoteColumn("active_count")
    await db.query(`UPDATE ${table} SET ${count} = ${count} - 1 WHERE ${db.quoteColumn("concurrency_key")} = ${db.quote(concurrencyKey)} AND ${count} > 0`)
  }

  /**
   * Rebuilds durable counts from active handoffs after startup.
   * @param {import("../database/drivers/base.js").default} db - Database connection.
   * @returns {Promise<void>} - Resolves when reconciled.
   */
  async _reconcileConcurrency(db) {
    if (!(await db.tableExists(CONCURRENCY_TABLE))) return
    const concurrencyTable = db.quoteTable(CONCURRENCY_TABLE)
    const jobsTable = db.quoteTable(JOBS_TABLE)
    await db.query(
      `UPDATE ${concurrencyTable} SET ${db.quoteColumn("active_count")} = (` +
      `SELECT COUNT(*) FROM ${jobsTable} WHERE ${jobsTable}.${db.quoteColumn("status")} = ${db.quote("handed_off")} AND ` +
      `${jobsTable}.${db.quoteColumn("concurrency_key")} = ${concurrencyTable}.${db.quoteColumn("concurrency_key")})`
    )
  }

  /**
   * Reconciles queue-derived concurrency with the current configuration, once
   * per process. Enqueue only consults config for new jobs, so a cap added,
   * removed, or changed while a backlog exists otherwise leaves persisted rows
   * stale: pre-cap jobs keep a null key and bypass the cap, post-removal jobs
   * stay capped under a now-unconfigured key, and a changed numeric cap stays
   * stale until the next enqueue. Bring the durable state in line with config:
   * sync each configured queue's stored cap, adopt not-yet-keyed non-terminal
   * jobs onto their queue key, and release non-terminal jobs from queue keys
   * whose queue is no longer capped. Runs before {@link _reconcileConcurrency}
   * so the rebuilt active counts reflect the adopted/released keys.
   * @param {import("../database/drivers/base.js").default} db - Database connection.
   * @returns {Promise<void>} - Resolves when reconciled.
   */
  async _reconcileQueueConcurrency(db) {
    if (this._queueConcurrencyReconciled) return
    if (!(await db.tableExists(CONCURRENCY_TABLE))) return

    const queuesConfig = this.configuration.getBackgroundJobsConfig().queues || {}
    const jobsTable = db.quoteTable(JOBS_TABLE)
    const keyColumn = db.quoteColumn("concurrency_key")
    const capColumn = db.quoteColumn("max_concurrency")
    const queueColumn = db.quoteColumn("queue")
    const nonTerminal = `${db.quoteColumn("status")} IN (${db.quote("queued")}, ${db.quote("handed_off")})`
    /** @type {Set<string>} */
    const cappedQueues = new Set()

    for (const queue of Object.keys(queuesConfig)) {
      const cap = this._queueMaxConcurrency(queue)

      if (cap === null) continue

      cappedQueues.add(queue)
      const concurrencyKey = `${QUEUE_CONCURRENCY_KEY_PREFIX}${queue}`

      await this._ensureQueueConcurrencyKey(db, {concurrencyKey, maxConcurrency: cap})
      await db.query(
        `UPDATE ${jobsTable} SET ${keyColumn} = ${db.quote(concurrencyKey)}, ${capColumn} = ${Number(cap)} ` +
        `WHERE ${queueColumn} = ${db.quote(queue)} AND ${keyColumn} IS NULL AND ${nonTerminal}`
      )
    }

    const concurrencyRows = await db.newQuery().from(CONCURRENCY_TABLE).select("concurrency_key").results()

    for (const row of concurrencyRows) {
      const concurrencyKey = String(/** @type {Record<string, ?>} */ (row).concurrency_key)

      if (!concurrencyKey.startsWith(QUEUE_CONCURRENCY_KEY_PREFIX)) continue
      if (cappedQueues.has(concurrencyKey.slice(QUEUE_CONCURRENCY_KEY_PREFIX.length))) continue

      await db.query(
        `UPDATE ${jobsTable} SET ${keyColumn} = NULL, ${capColumn} = NULL ` +
        `WHERE ${keyColumn} = ${db.quote(concurrencyKey)} AND ${nonTerminal}`
      )
    }

    this._queueConcurrencyReconciled = true
  }

  /**
   * Runs normalize number.
   * @param {?} value - Input value.
   * @returns {number | null} - Normalized number.
   */
  _normalizeNumber(value) {
    if (value === null || value === undefined || value === "") return null

    const numeric = Number(value)

    if (Number.isNaN(numeric)) return null

    return numeric
  }

  /**
   * Runs normalize boolean.
   * @param {?} value - Input value.
   * @returns {boolean} - Normalized boolean.
   */
  _normalizeBoolean(value) {
    if (value === null || value === undefined) return false
    if (typeof value === "boolean") return value
    if (typeof value === "number") return value !== 0

    return value === "true"
  }

  /**
   * Runs normalize execution mode.
   * @param {import("./types.js").BackgroundJobOptions} [options] - Job options.
   * @returns {import("./types.js").BackgroundJobExecutionMode} - Normalized execution mode.
   */
  _normalizeExecutionMode(options) {
    const executionMode = options?.executionMode

    if (executionMode) {
      return this._normalizeExecutionModeName(executionMode)
    }
    if (options?.forked === false) return "inline"

    return DEFAULT_EXECUTION_MODE
  }

  /**
   * Runs normalize execution mode name.
   * @param {string} executionMode - Execution mode name.
   * @returns {import("./types.js").BackgroundJobExecutionMode} - Normalized execution mode.
   */
  _normalizeExecutionModeName(executionMode) {
    for (const mode of EXECUTION_MODES) {
      if (mode === executionMode) return mode
    }

    throw new Error(`Invalid background job executionMode: ${executionMode}`)
  }

  /**
   * Runs parse args.
   * @param {?} value - Input value.
   * @returns {Array<?>} - Parsed args.
   */
  _parseArgs(value) {
    if (!value) return []

    try {
      const parsed = JSON.parse(String(value))

      if (Array.isArray(parsed)) return parsed
    } catch {
      // Ignore parse errors.
    }

    return []
  }

  /**
   * Runs with db.
   * @template T
   * @param {(db: import("../database/drivers/base.js").default) => Promise<T>} callback - Callback.
   * @returns {Promise<T>} - Callback result.
   */
  async _withDb(callback) {
    const pool = this.configuration.getDatabasePool(this.getDatabaseIdentifier())
    let callbackCalled = false
    /**
     * Defines result.
     * @type {T | undefined} */
    let result

    await pool.withConnection({name: "Background jobs store"}, async (db) => {
      callbackCalled = true
      result = await callback(db)
    })

    if (!callbackCalled) {
      throw new Error("Background jobs store callback was not invoked")
    }

    return /** @type {T} */ (result)
  }

  /**
   * Runs a value-returning callback inside the driver's void-typed transaction API.
   * @template T
   * @param {import("../database/drivers/base.js").default} db - Database connection.
   * @param {() => Promise<T>} callback - Transaction callback.
   * @returns {Promise<T>} - Callback result.
   */
  async _transactionResult(db, callback) {
    let completed = false
    /** @type {T | undefined} */
    let result
    await db.transaction(async () => {
      result = await callback()
      completed = true
    })
    if (!completed) throw new Error("Background jobs transaction callback was not invoked")
    return /** @type {T} */ (result)
  }

  /**
   * Runs should accept report.
   * @param {object} args - Options.
   * @param {import("./types.js").BackgroundJobRow} args.job - Job row.
   * @param {string | null | undefined} args.handoffId - Handoff lease id from report.
   * @param {string | null | undefined} args.workerId - Worker id from report.
   * @param {number | null | undefined} args.handedOffAtMs - Handed off timestamp from report.
   * @returns {boolean} - Whether to accept the report.
   */
  _shouldAcceptReport({job, handoffId, workerId, handedOffAtMs}) {
    if (job.status !== "handed_off") return false

    return this._handoffIdReportMatches({handoffId, job})
      && this._workerReportMatches({job, workerId})
      && this._handoffReportMatches({handedOffAtMs, job})
  }

  /**
   * Runs active handoff conditions.
   * @param {import("./types.js").BackgroundJobRow} job - Job row.
   * @returns {Record<string, string | null>} - Conditional transition fence.
   */
  _activeHandoffConditions(job) {
    return {handoff_id: job.handoffId, id: job.id, status: "handed_off"}
  }

  /**
   * Runs handoff id report matches.
   * @param {object} args - Options.
   * @param {string | null | undefined} args.handoffId - Handoff lease id from report.
   * @param {import("./types.js").BackgroundJobRow} args.job - Job row.
   * @returns {boolean} - Whether the handoff lease matches.
   */
  _handoffIdReportMatches({handoffId, job}) {
    if (!job.handoffId) return true

    return handoffId === job.handoffId
  }

  /**
   * Runs worker report matches.
   * @param {object} args - Options.
   * @param {import("./types.js").BackgroundJobRow} args.job - Job row.
   * @param {string | null | undefined} args.workerId - Worker id from report.
   * @returns {boolean} - Whether the worker report matches.
   */
  _workerReportMatches({job, workerId}) {
    if (!workerId) return true
    if (!job.workerId) return true

    return workerId === job.workerId
  }

  /**
   * Runs handoff report matches.
   * @param {object} args - Options.
   * @param {number | null | undefined} args.handedOffAtMs - Handed off timestamp from report.
   * @param {import("./types.js").BackgroundJobRow} args.job - Job row.
   * @returns {boolean} - Whether the handoff report matches.
   */
  _handoffReportMatches({handedOffAtMs, job}) {
    if (!handedOffAtMs) return true
    if (!job.handedOffAtMs) return true

    return handedOffAtMs === job.handedOffAtMs
  }

  /**
   * Runs migration key.
   * @param {string} [version] - Migration version.
   * @returns {string} - Migration key.
   */
  _migrationKey(version = MIGRATION_VERSION) {
    return `${MIGRATION_SCOPE}:${version}`
  }
}
