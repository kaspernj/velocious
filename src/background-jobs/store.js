// @ts-check

import {randomUUID} from "crypto"
import Logger from "../logger.js"
import TableData from "../database/table-data/index.js"
import BackgroundJobRecord from "./job-record.js"

const MIGRATIONS_TABLE = "velocious_internal_migrations"
const MIGRATION_SCOPE = "background_jobs"
const MIGRATION_VERSION = "20250215000000"
const JOBS_TABLE = "background_jobs"
const DEFAULT_MAX_RETRIES = 10
const ORPHANED_AFTER_MS = 2 * 60 * 60 * 1000

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
    const forked = options?.forked !== false
    const maxRetries = this._normalizeMaxRetries(options?.maxRetries)
    const argsJson = JSON.stringify(args || [])

    await this._withDb(async (db) => {
      await db.insert({
        tableName: JOBS_TABLE,
        data: {
          id: jobId,
          job_name: jobName,
          args_json: argsJson,
          forked,
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
   * @returns {Promise<import("./store.js").BackgroundJobRow | null>} - Next job.
   */
  async nextAvailableJob() {
    await this.ensureReady()

    return await this._withDb(async (db) => {
      const now = Date.now()
      const query = db
        .newQuery()
        .from(JOBS_TABLE)
        .where({status: "queued"})
        .where(`scheduled_at_ms <= ${db.quote(now)}`)
        .order("scheduled_at_ms ASC")
        .order("created_at_ms ASC")
        .limit(1)

      const rows = await query.results()
      const row = rows[0]

      if (!row) return null

      return this._normalizeJobRow(row)
    })
  }

  /**
   * @param {string} jobId - Job id.
   * @returns {Promise<import("./store.js").BackgroundJobRow | null>} - Job row.
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
   * @returns {Promise<void>} - Resolves when updated.
   */
  async markFailed({jobId, error, workerId, handedOffAtMs}) {
    await this.ensureReady()

    await this._withDb(async (db) => {
      const job = await this._getJobRowById(db, jobId)

      if (!job) return
      if (!this._shouldAcceptReport({job, workerId, handedOffAtMs})) return

      await this._applyFailure({db, job, error, markOrphaned: false})
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
   * @param {number | undefined} maxRetries - Input.
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

      if (alreadyApplied) return

      await this._applyMigrations(db)
      await db.insert({
        tableName: MIGRATIONS_TABLE,
        data: {
          key: this._migrationKey(),
          scope: MIGRATION_SCOPE,
          version: MIGRATION_VERSION,
          applied_at_ms: Date.now()
        }
      })
    })
  }

  async _ensureMigrationsTable(db) {
    if (await db.tableExists(MIGRATIONS_TABLE)) return

    const table = new TableData(MIGRATIONS_TABLE, {ifNotExists: true})

    table.string("key", {null: false, primaryKey: true})
    table.string("scope", {null: false})
    table.string("version", {null: false})
    table.bigint("applied_at_ms", {null: false})

    await db.createTable(table)
  }

  async _hasMigration(db) {
    const query = db
      .newQuery()
      .from(MIGRATIONS_TABLE)
      .where({key: this._migrationKey()})
      .limit(1)

    const rows = await query.results()

    return rows.length > 0
  }

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

  async _initializeModel() {
    BackgroundJobRecord.setDatabaseIdentifier(this.getDatabaseIdentifier())

    if (BackgroundJobRecord.isInitialized()) return

    const pool = this.configuration.getDatabasePool(this.getDatabaseIdentifier())

    await pool.withConnection(async () => {
      await BackgroundJobRecord.initializeRecord({configuration: this.configuration})
    })
  }

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

  async _applyFailure({db, job, error, markOrphaned}) {
    const now = Date.now()
    const nextAttempt = (job.attempts || 0) + 1
    const maxRetries = this._normalizeMaxRetries(job.maxRetries)
    const shouldRetry = nextAttempt <= maxRetries
    const failureMessage = this._normalizeError(error)
    const scheduledAt = shouldRetry ? now + this.getRetryDelayMs(nextAttempt) : job.scheduledAtMs

    /** @type {Record<string, any>} */
    const update = {
      attempts: nextAttempt,
      handed_off_at_ms: null,
      worker_id: null,
      last_error: failureMessage
    }

    if (markOrphaned) {
      update.orphaned_at_ms = now
    }

    if (shouldRetry) {
      update.status = "queued"
      update.scheduled_at_ms = scheduledAt
    } else if (markOrphaned) {
      update.status = "orphaned"
    } else {
      update.status = "failed"
      update.failed_at_ms = now
    }

    await db.update({
      tableName: JOBS_TABLE,
      data: update,
      conditions: {id: job.id}
    })
  }

  _normalizeJobRow(row) {
    return {
      id: String(row.id),
      jobName: String(row.job_name),
      args: this._parseArgs(row.args_json),
      forked: this._normalizeBoolean(row.forked),
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

  _normalizeNumber(value) {
    if (value === null || value === undefined || value === "") return null

    const numeric = Number(value)

    if (Number.isNaN(numeric)) return null

    return numeric
  }

  _normalizeBoolean(value) {
    if (value === null || value === undefined) return false
    if (typeof value === "boolean") return value
    if (typeof value === "number") return value !== 0

    return value === "true"
  }

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

  _normalizeError(error) {
    if (error instanceof Error) return error.stack || error.message
    if (typeof error === "string") return error

    try {
      return JSON.stringify(error)
    } catch {
      return String(error)
    }
  }

  async _withDb(callback) {
    const pool = this.configuration.getDatabasePool(this.getDatabaseIdentifier())
    let result

    await pool.withConnection(async (db) => {
      result = await callback(db)
    })

    return result
  }

  /**
   * @param {object} args - Options.
   * @param {import("./store.js").BackgroundJobRow} args.job - Job row.
   * @param {string | null | undefined} args.workerId - Worker id from report.
   * @param {number | null | undefined} args.handedOffAtMs - Handed off timestamp from report.
   * @returns {boolean} - Whether to accept the report.
   */
  _shouldAcceptReport({job, workerId, handedOffAtMs}) {
    if (job.status !== "handed_off") return false

    if (workerId && job.workerId && workerId !== job.workerId) return false

    if (handedOffAtMs && job.handedOffAtMs && handedOffAtMs !== job.handedOffAtMs) return false

    return true
  }

  _migrationKey() {
    return `${MIGRATION_SCOPE}:${MIGRATION_VERSION}`
  }
}

/**
 * @typedef {object} BackgroundJobRow
 * @property {string} id - Job id.
 * @property {string} jobName - Job class name.
 * @property {any[]} args - Serialized job arguments.
 * @property {boolean} forked - Whether the job is forked.
 * @property {string} status - Current job status.
 * @property {number | null} attempts - Failure attempts count.
 * @property {number | null} maxRetries - Max retry attempts.
 * @property {number | null} scheduledAtMs - Next scheduled time in ms.
 * @property {number | null} createdAtMs - Creation time in ms.
 * @property {number | null} handedOffAtMs - Time handed to worker in ms.
 * @property {number | null} completedAtMs - Completion time in ms.
 * @property {number | null} failedAtMs - Failure time in ms.
 * @property {number | null} orphanedAtMs - Orphaned time in ms.
 * @property {string | null} workerId - Worker id handling the job.
 * @property {string | null} lastError - Last failure message.
 */
