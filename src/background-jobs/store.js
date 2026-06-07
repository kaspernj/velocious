// @ts-check

import {randomUUID} from "crypto"
import Logger from "../logger.js"
import TableData from "../database/table-data/index.js"
import BackgroundJobRecord from "./job-record.js"
import normalizeBackgroundJobError from "./normalize-error.js"

const MIGRATIONS_TABLE = "velocious_internal_migrations"
const MIGRATION_SCOPE = "background_jobs"
const MIGRATION_VERSION = "20250215000000"
const EXECUTION_MODE_BACKFILL_MIGRATION_VERSION = "20260607131010"
const JOBS_TABLE = "background_jobs"
const DEFAULT_MAX_RETRIES = 10
const ORPHANED_AFTER_MS = 2 * 60 * 60 * 1000
/** @type {import("./types.js").BackgroundJobExecutionMode[]} */
const EXECUTION_MODES = ["inline", "forked", "spawned"]
const DEFAULT_EXECUTION_MODE = "forked"

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
   * @param {object} args - Options.
   * @param {import("../configuration.js").default} args.configuration - Configuration.
   * @param {string} [args.databaseIdentifier] - Database identifier.
   */
  constructor({configuration, databaseIdentifier}) {
    this.configuration = configuration
    this.databaseIdentifier = databaseIdentifier
    this.logger = new Logger(this)
    this._readyPromise = null
  }

  /**
   * @returns {string} - Database identifier.
   */
  getDatabaseIdentifier() {
    if (this.databaseIdentifier) return this.databaseIdentifier

    return this.configuration.getBackgroundJobsConfig().databaseIdentifier
  }

  /**
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
   * @param {object} args - Options.
   * @param {string} args.jobName - Job name.
   * @param {any[]} args.args - Arguments.
   * @param {import("./types.js").BackgroundJobOptions} [args.options] - Options.
   * @returns {Promise<string>} - Job id.
   */
  async enqueue({jobName, args, options}) {
    await this.ensureReady()

    const jobId = randomUUID()
    const now = Date.now()
    const executionMode = this._normalizeExecutionMode(options)
    const maxRetries = this._normalizeMaxRetries(options?.maxRetries)
    const argsJson = JSON.stringify(args || [])

    await this._withDb(async (db) => {
      await db.insert({
        tableName: JOBS_TABLE,
        data: {
          id: jobId,
          job_name: jobName,
          args_json: argsJson,
          forked: executionMode !== "inline",
          execution_mode: executionMode,
          max_retries: maxRetries,
          attempts: 0,
          status: "queued",
          scheduled_at_ms: now,
          created_at_ms: now
        }
      })
    })

    return jobId
  }

  /**
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

    if (typeof forked === "boolean") {
      query = query.where({forked})
    }
    if (executionMode) {
      const executionModes = Array.isArray(executionMode) ? executionMode : [executionMode]

      query = query.where({execution_mode: executionModes})
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

      /** @type {Record<string, number>} */
      const counts = {}

      for (const row of rows) {
        const typedRow = /** @type {Record<string, any>} */ (row)

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
      const countRow = /** @type {Record<string, any>} */ (rows[0] || {})

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
   * @param {object} args - Options.
   * @param {string} args.jobId - Job id.
   * @param {string} [args.workerId] - Worker id.
   * @returns {Promise<number>} - Resolves with handed off timestamp.
   */
  async markHandedOff({jobId, workerId}) {
    await this.ensureReady()

    const handedOffAtMs = Date.now()

    await this._withDb(async (db) => {
      await db.update({
        tableName: JOBS_TABLE,
        data: {
          status: "handed_off",
          handed_off_at_ms: handedOffAtMs,
          worker_id: workerId || null
        },
        conditions: {id: jobId}
      })
    })

    return handedOffAtMs
  }

  /**
   * @param {object} args - Options.
   * @param {string} args.jobId - Job id.
   * @param {string} [args.workerId] - Worker id.
   * @param {number} [args.handedOffAtMs] - Handed off timestamp.
   * @returns {Promise<void>} - Resolves when updated.
   */
  async markCompleted({jobId, workerId, handedOffAtMs}) {
    await this.ensureReady()

    await this._withDb(async (db) => {
      const job = await this._getJobRowById(db, jobId)

      if (!job) return
      if (!this._shouldAcceptReport({job, workerId, handedOffAtMs})) return

      await db.update({
        tableName: JOBS_TABLE,
        data: {
          status: "completed",
          completed_at_ms: Date.now()
        },
        conditions: {id: jobId}
      })
    })
  }

  /**
   * @param {object} args - Options.
   * @param {string} args.jobId - Job id.
   * @returns {Promise<void>} - Resolves when updated.
   */
  async markReturnedToQueue({jobId}) {
    await this.ensureReady()

    await this._withDb(async (db) => {
      await db.update({
        tableName: JOBS_TABLE,
        data: {
          status: "queued",
          scheduled_at_ms: Date.now(),
          handed_off_at_ms: null,
          worker_id: null
        },
        conditions: {id: jobId}
      })
    })
  }

  /**
   * @param {object} args - Options.
   * @param {string} args.jobId - Job id.
   * @param {unknown} args.error - Error.
   * @param {string} [args.workerId] - Worker id.
   * @param {number} [args.handedOffAtMs] - Handed off timestamp.
   * @returns {Promise<import("./types.js").BackgroundJobRow | null>} - Updated job row when the report was accepted.
   */
  async markFailed({jobId, error, workerId, handedOffAtMs}) {
    await this.ensureReady()

    return await this._withDb(async (db) => {
      const job = await this._getJobRowById(db, jobId)

      if (!job) return null
      if (!this._shouldAcceptReport({job, workerId, handedOffAtMs})) return null

      return await this._applyFailure({db, job, error, markOrphaned: false})
    })
  }

  /**
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

      for (const row of rows) {
        const job = this._normalizeJobRow(row)

        await this._applyFailure({
          db,
          job,
          error: "Job orphaned after timeout",
          markOrphaned: true
        })
      }

      return rows.length
    })
  }

  /**
   * @returns {Promise<void>} - Resolves when cleared.
   */
  async clearAll() {
    await this.ensureReady()

    await this._withDb(async (db) => {
      await db.query(`DELETE FROM ${db.quoteTable(JOBS_TABLE)}`)
    })
  }

  /**
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
   * @param {number | null | undefined} maxRetries - Input.
   * @returns {number} - Normalized max retries.
   */
  _normalizeMaxRetries(maxRetries) {
    if (typeof maxRetries === "number" && Number.isFinite(maxRetries) && maxRetries >= 0) {
      return Math.floor(maxRetries)
    }

    return DEFAULT_MAX_RETRIES
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
        return
      }

      await this._applyMigrations(db)
      await this._ensureJobsTableColumns(db)

      if (alreadyApplied) return

      await this._recordMigration(db, MIGRATION_VERSION)
    })
  }

  /**
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
    table.integer("max_retries", {null: false})
    table.integer("attempts", {null: false})
    table.string("status", {null: false, index: true})
    table.bigint("scheduled_at_ms", {null: false, index: true})
    table.bigint("created_at_ms", {null: false, index: true})
    table.bigint("handed_off_at_ms", {null: true, index: true})
    table.bigint("completed_at_ms", {null: true})
    table.bigint("failed_at_ms", {null: true})
    table.bigint("orphaned_at_ms", {null: true, index: true})
    table.string("worker_id", {null: true})
    table.text("last_error", {null: true})

    await db.createTable(table)
  }

  /**
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

    await this._backfillExecutionModesOnce(db)
  }

  /**
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
   * @param {import("../database/drivers/base.js").default} db - Database connection.
   * @param {string} version - Migration version.
   * @returns {Promise<void>} - Resolves when complete.
   */
  async _recordMigration(db, version) {
    await db.insert({
      tableName: MIGRATIONS_TABLE,
      data: {
        key: this._migrationKey(version),
        scope: MIGRATION_SCOPE,
        version,
        applied_at_ms: Date.now()
      }
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
   * @param {object} args - Options.
   * @param {import("../database/drivers/base.js").default} args.db - Database connection.
   * @param {import("./types.js").BackgroundJobRow} args.job - Job row.
   * @param {unknown} args.error - Error.
   * @param {boolean} args.markOrphaned - Whether marking orphaned.
   * @returns {Promise<import("./types.js").BackgroundJobRow>} - Updated job row.
   */
  async _applyFailure({db, job, error, markOrphaned}) {
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

    await db.update({
      tableName: JOBS_TABLE,
      data: update,
      conditions: {id: job.id}
    })

    return this._jobWithFailureUpdate({failureMessage, job, nextAttempt, update})
  }

  /**
   * @param {object} args - Options.
   * @param {string} args.failureMessage - Last failure message.
   * @param {boolean} args.markOrphaned - Whether marking orphaned.
   * @param {number} args.nextAttempt - Next attempt count.
   * @param {number} args.now - Current timestamp.
   * @param {number | null} args.scheduledAt - Next scheduled timestamp.
   * @param {boolean} args.shouldRetry - Whether the job should retry.
   * @returns {Record<string, any>} - Database update data.
   */
  _failureUpdate({failureMessage, markOrphaned, nextAttempt, now, scheduledAt, shouldRetry}) {
    /** @type {Record<string, any>} */
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
   * @param {object} args - Options.
   * @param {boolean} args.markOrphaned - Whether marking orphaned.
   * @param {number} args.now - Current timestamp.
   * @param {Record<string, any>} args.update - Database update data.
   * @returns {void}
   */
  _applyOrphanedFailureUpdate({markOrphaned, now, update}) {
    if (markOrphaned) update.orphaned_at_ms = now
  }

  /**
   * @param {object} args - Options.
   * @param {boolean} args.markOrphaned - Whether marking orphaned.
   * @param {number} args.now - Current timestamp.
   * @param {number | null} args.scheduledAt - Next scheduled timestamp.
   * @param {boolean} args.shouldRetry - Whether the job should retry.
   * @param {Record<string, any>} args.update - Database update data.
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
   * @param {object} args - Options.
   * @param {string} args.failureMessage - Last failure message.
   * @param {import("./types.js").BackgroundJobRow} args.job - Job row.
   * @param {number} args.nextAttempt - Next attempt count.
   * @param {Record<string, any>} args.update - Database update data.
   * @returns {import("./types.js").BackgroundJobRow} - Updated job row.
   */
  _jobWithFailureUpdate({failureMessage, job, nextAttempt, update}) {
    return {
      ...job,
      attempts: nextAttempt,
      failedAtMs: update.failed_at_ms ?? job.failedAtMs,
      handedOffAtMs: null,
      lastError: failureMessage,
      orphanedAtMs: update.orphaned_at_ms ?? job.orphanedAtMs,
      scheduledAtMs: update.scheduled_at_ms ?? job.scheduledAtMs,
      status: update.status,
      workerId: null
    }
  }

  /**
   * @param {Record<string, any>} row - Raw database row.
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
      status: row.status ? String(row.status) : "queued",
      attempts: this._normalizeNumber(row.attempts),
      maxRetries: this._normalizeNumber(row.max_retries),
      scheduledAtMs: this._normalizeNumber(row.scheduled_at_ms),
      createdAtMs: this._normalizeNumber(row.created_at_ms),
      handedOffAtMs: this._normalizeNumber(row.handed_off_at_ms),
      completedAtMs: this._normalizeNumber(row.completed_at_ms),
      failedAtMs: this._normalizeNumber(row.failed_at_ms),
      orphanedAtMs: this._normalizeNumber(row.orphaned_at_ms),
      workerId: row.worker_id ? String(row.worker_id) : null,
      lastError: row.last_error ? String(row.last_error) : null
    }
  }

  /**
   * @param {unknown} value - Input value.
   * @returns {number | null} - Normalized number.
   */
  _normalizeNumber(value) {
    if (value === null || value === undefined || value === "") return null

    const numeric = Number(value)

    if (Number.isNaN(numeric)) return null

    return numeric
  }

  /**
   * @param {unknown} value - Input value.
   * @returns {boolean} - Normalized boolean.
   */
  _normalizeBoolean(value) {
    if (value === null || value === undefined) return false
    if (typeof value === "boolean") return value
    if (typeof value === "number") return value !== 0

    return value === "true"
  }

  /**
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
   * @param {unknown} value - Input value.
   * @returns {any[]} - Parsed args.
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
   * @template T
   * @param {(db: import("../database/drivers/base.js").default) => Promise<T>} callback - Callback.
   * @returns {Promise<T>} - Callback result.
   */
  async _withDb(callback) {
    const pool = this.configuration.getDatabasePool(this.getDatabaseIdentifier())
    let callbackCalled = false
    /** @type {T | undefined} */
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
   * @param {object} args - Options.
   * @param {import("./types.js").BackgroundJobRow} args.job - Job row.
   * @param {string | null | undefined} args.workerId - Worker id from report.
   * @param {number | null | undefined} args.handedOffAtMs - Handed off timestamp from report.
   * @returns {boolean} - Whether to accept the report.
   */
  _shouldAcceptReport({job, workerId, handedOffAtMs}) {
    if (job.status !== "handed_off") return false

    return this._workerReportMatches({job, workerId}) && this._handoffReportMatches({handedOffAtMs, job})
  }

  /**
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
   * @param {string} [version] - Migration version.
   * @returns {string} - Migration key.
   */
  _migrationKey(version = MIGRATION_VERSION) {
    return `${MIGRATION_SCOPE}:${version}`
  }
}
