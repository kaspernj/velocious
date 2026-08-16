// @ts-check

import UUID from "pure-uuid"

import TableData from "../database/table-data/index.js"
import TableIndex from "../database/table-data/table-index.js"
import sha256Hex from "../utils/sha256-hex.js"
import normalizeBackgroundJobError from "./normalize-error.js"
import {
  DEFAULT_BACKGROUND_JOB_QUEUE,
  QUEUE_CONCURRENCY_KEY_PREFIX,
  normalizeBackgroundJobConcurrency,
  normalizeBackgroundJobExecutionMode,
  normalizeBackgroundJobMaxRetries,
  normalizeBackgroundJobQueue,
  normalizeBackgroundJobScheduledAtMs,
  rescheduledBackgroundJobAtMs,
  retryDelayMs
} from "./job-semantics.js"

export const LOCAL_BACKGROUND_JOBS_TABLE = "velocious_local_background_jobs"
export const LOCAL_BACKGROUND_JOB_CONCURRENCY_TABLE = "velocious_local_background_job_concurrency"
const MIGRATIONS_TABLE = "velocious_internal_migrations"
const MIGRATION_SCOPE = "local_background_jobs"
const MIGRATION_VERSION = "1"
const LOCAL_EXECUTION_MODES = [/** @type {const} */ ("inline")]
export const LOCAL_BACKGROUND_JOBS_INDEX_NAMES = [
  "index_velocious_local_background_jobs_due",
  "index_velocious_local_background_jobs_queue_status",
  "index_velocious_local_background_jobs_deduplication",
  "index_velocious_local_background_jobs_concurrency"
]
const EXPECTED_JOB_COLUMNS = [
  "id",
  "job_name",
  "args_json",
  "args_digest",
  "execution_mode",
  "queue",
  "max_retries",
  "attempts",
  "status",
  "scheduled_at_ms",
  "created_at_ms",
  "handed_off_at_ms",
  "handoff_id",
  "worker_id",
  "completed_at_ms",
  "failed_at_ms",
  "last_error",
  "concurrency_key",
  "max_concurrency"
]
const EXPECTED_CONCURRENCY_COLUMNS = ["concurrency_key", "max_concurrency", "active_count"]

/**
 * Creates the production clock used by local dispatch.
 * @returns {import("./types.js").LocalBackgroundJobsClock} - Production clock.
 */
export function localBackgroundJobsClock() {
  return {
    clearTimeout: (timerId) => globalThis.clearTimeout(timerId),
    now: () => Date.now(),
    setTimeout: (callback, delayMs) => globalThis.setTimeout(callback, delayMs)
  }
}

/** Namespaced portable SQLite persistence for local background jobs. */
export default class LocalBackgroundJobsStore {
  /**
   * Creates a store for one configuration and local database.
   * @param {object} args - Store options.
   * @param {import("../configuration.js").default} args.configuration - Owning configuration.
   * @param {import("./types.js").LocalBackgroundJobsClock} [args.clock] - Persistence clock.
   * @param {string} [args.databaseIdentifier] - Configured local database identifier.
   * @param {() => void} [args.onCommittedEnqueue] - Commit-aware dispatcher wake.
   */
  constructor({configuration, clock = localBackgroundJobsClock(), databaseIdentifier, onCommittedEnqueue}) {
    this.clock = clock
    this.configuration = configuration
    this.databaseIdentifier = databaseIdentifier
    this.onCommittedEnqueue = onCommittedEnqueue
    this._isReady = false
    /** @type {Promise<void> | null} */
    this._readyPromise = null
    /** @type {WeakMap<import("../database/drivers/base.js").default, {completion: Promise<void>, promise: Promise<void>}>} */
    this._transactionReadyPromises = new WeakMap()
  }

  /**
   * Resolves the configured local database identifier.
   * @returns {string} - Database identifier.
   */
  getDatabaseIdentifier() {
    return this.databaseIdentifier || this.configuration.getBackgroundJobsConfig().databaseIdentifier
  }

  /**
   * Ensures the versioned physical schema exists.
   * @returns {Promise<void>} - Resolves when ready.
   */
  async ensureReady() {
    if (this._isReady) return

    await this._withDb(async (db) => await this._ensureReadyWithDb(db))
  }

  /**
   * Clears the per-instance readiness latch for a deliberate adapter reopen.
   * @returns {void} - No return value.
   */
  resetReadiness() {
    this._isReady = false
    this._readyPromise = null
    this._transactionReadyPromises = new WeakMap()
  }

  /**
   * Coordinates physical and transaction-local schema readiness.
   * @param {import("../database/drivers/base.js").default} db - Local SQLite connection.
   * @returns {Promise<void>} - Resolves when this caller can use the schema.
   */
  async _ensureReadyWithDb(db) {
    if (this._isReady) return

    const transactionCompletion = db.insideTransaction() ? db.transactionCompletion() : null
    const transactionReady = this._transactionReadyPromises.get(db)

    if (transactionCompletion && transactionReady?.completion === transactionCompletion) {
      await transactionReady.promise
      return
    }

    if (this._readyPromise) {
      const readyPromise = this._readyPromise

      await readyPromise
      if (this._readyPromise === readyPromise) this._readyPromise = null
      if (this._isReady) return

      await this.ensureReady()
      return
    }

    if (transactionCompletion) {
      const schemaReadyPromise = this._applySchema(db)
      const transactionReadyPromise = schemaReadyPromise.then(() => undefined)
      const transactionReady = {completion: transactionCompletion, promise: transactionReadyPromise}
      const durableReadyPromise = schemaReadyPromise.then(async (changed) => {
        if (!changed) {
          this._isReady = true
          return
        }

        await transactionCompletion
      }, () => {
        // The transaction-local caller below owns and rethrows this same schema error.
        // This branch only settles the shared durability barrier so it cannot become
        // an independent unhandled rejection while failed ownership is cleared.
      })

      this._transactionReadyPromises.set(db, transactionReady)
      this._readyPromise = durableReadyPromise

      try {
        await transactionReadyPromise
      } catch (error) {
        if (this._transactionReadyPromises.get(db) === transactionReady) this._transactionReadyPromises.delete(db)
        if (this._readyPromise === durableReadyPromise) this._readyPromise = null
        throw error
      }
      return
    }

    this._readyPromise = this._transactionResult(db, async () => await this._applySchema(db)).then(() => {
      this._isReady = true
    })

    try {
      await this._readyPromise
    } finally {
      if (!this._isReady) this._readyPromise = null
    }
  }

  /**
   * Creates or repairs version-one tables and indexes.
   * @param {import("../database/drivers/base.js").default} db - Local SQLite connection.
   * @returns {Promise<boolean>} - Whether schema state changed.
   */
  async _applySchema(db) {
    let changed = false

    if (!(await db.tableExists(MIGRATIONS_TABLE))) {
      await db.createTable(this._migrationsTableData())
      changed = true
    }

    if (!(await db.tableExists(LOCAL_BACKGROUND_JOBS_TABLE))) {
      await db.createTable(this._jobsTableData())
      changed = true
    } else {
      await this._assertColumns(db, LOCAL_BACKGROUND_JOBS_TABLE, EXPECTED_JOB_COLUMNS)
    }

    if (!(await db.tableExists(LOCAL_BACKGROUND_JOB_CONCURRENCY_TABLE))) {
      await db.createTable(this._concurrencyTableData())
      changed = true
    } else {
      await this._assertColumns(db, LOCAL_BACKGROUND_JOB_CONCURRENCY_TABLE, EXPECTED_CONCURRENCY_COLUMNS)
    }

    if (await this._ensureIndexes(db)) changed = true

    if (!(await this._hasMigration(db))) {
      await db.upsert({
        tableName: MIGRATIONS_TABLE,
        data: {
          applied_at_ms: this.clock.now(),
          key: this._migrationKey(),
          scope: MIGRATION_SCOPE,
          version: MIGRATION_VERSION
        },
        conflictColumns: ["key"],
        updateColumns: ["scope", "version", "applied_at_ms"]
      })
      changed = true
    }

    return changed
  }

  /**
   * Builds the migration ledger table definition.
   * @returns {TableData} - Migration ledger table.
   */
  _migrationsTableData() {
    const table = new TableData(MIGRATIONS_TABLE, {ifNotExists: true})

    table.string("key", {null: false, primaryKey: true})
    table.string("scope", {null: false})
    table.string("version", {null: false})
    table.bigint("applied_at_ms", {null: false})
    return table
  }

  /**
   * Builds the local jobs table definition.
   * @returns {TableData} - Local jobs table definition.
   */
  _jobsTableData() {
    const table = new TableData(LOCAL_BACKGROUND_JOBS_TABLE, {ifNotExists: true})

    table.string("id", {null: false, primaryKey: true})
    table.string("job_name", {null: false})
    table.text("args_json", {null: false})
    table.string("args_digest", {maxLength: 64, null: false})
    table.string("execution_mode", {null: false})
    table.string("queue", {null: false})
    table.integer("max_retries", {null: false})
    table.integer("attempts", {null: false})
    table.string("status", {null: false})
    table.bigint("scheduled_at_ms", {null: false})
    table.bigint("created_at_ms", {null: false})
    table.bigint("handed_off_at_ms", {null: true})
    table.string("handoff_id", {null: true})
    table.string("worker_id", {null: true})
    table.bigint("completed_at_ms", {null: true})
    table.bigint("failed_at_ms", {null: true})
    table.text("last_error", {null: true})
    table.string("concurrency_key", {null: true})
    table.integer("max_concurrency", {null: true})
    table.addIndex(new TableIndex(["status", "scheduled_at_ms", "created_at_ms", "id"], {name: LOCAL_BACKGROUND_JOBS_INDEX_NAMES[0]}))
    table.addIndex(new TableIndex(["queue", "status", "created_at_ms"], {name: LOCAL_BACKGROUND_JOBS_INDEX_NAMES[1]}))
    table.addIndex(new TableIndex(["args_digest"], {name: LOCAL_BACKGROUND_JOBS_INDEX_NAMES[2]}))
    table.addIndex(new TableIndex(["status", "concurrency_key", "scheduled_at_ms"], {name: LOCAL_BACKGROUND_JOBS_INDEX_NAMES[3]}))
    return table
  }

  /**
   * Builds the local concurrency counter table definition.
   * @returns {TableData} - Concurrency counter table definition.
   */
  _concurrencyTableData() {
    const table = new TableData(LOCAL_BACKGROUND_JOB_CONCURRENCY_TABLE, {ifNotExists: true})

    table.string("concurrency_key", {null: false, primaryKey: true})
    table.integer("max_concurrency", {null: false})
    table.integer("active_count", {null: false})
    return table
  }

  /**
   * Rejects an incompatible current-version table rather than rebuilding data.
   * @param {import("../database/drivers/base.js").default} db - Local SQLite connection.
   * @param {string} tableName - Table name.
   * @param {string[]} expectedColumns - Required columns.
   * @returns {Promise<void>} - Resolves when compatible.
   */
  async _assertColumns(db, tableName, expectedColumns) {
    const table = await db.getTableByNameOrFail(tableName)
    const columns = await table.getColumns()
    const names = new Set(columns.map((column) => column.getName()))
    const missing = expectedColumns.filter((columnName) => !names.has(columnName))

    if (missing.length === 0) return

    const error = new Error(`Incompatible local background-jobs schema for ${tableName}; missing columns: ${missing.join(", ")}`)

    this._reportFrameworkError({error, stage: "local-background-jobs-schema"})
    throw error
  }

  /**
   * Recreates missing indexes declared by the current schema.
   * @param {import("../database/drivers/base.js").default} db - Local SQLite connection.
   * @returns {Promise<boolean>} - Whether an index was created.
   */
  async _ensureIndexes(db) {
    db.clearSchemaCache()
    const jobsTable = await db.getTableByNameOrFail(LOCAL_BACKGROUND_JOBS_TABLE)
    const existingNames = new Set((await jobsTable.getIndexes()).map((index) => index.getName()))
    let changed = false

    for (const index of this._jobsTableData().getIndexes()) {
      const indexName = index.getName()

      if (!indexName || existingNames.has(indexName)) continue

      const sqls = await db.createIndexSQLs({
        columns: index.getColumns(),
        ifNotExists: true,
        name: indexName,
        tableName: LOCAL_BACKGROUND_JOBS_TABLE,
        unique: index.getUnique()
      })

      for (const sql of sqls) await db.query(sql)
      changed = true
    }

    if (changed) db.clearSchemaCache()
    return changed
  }

  /**
   * Checks whether the current local schema version is recorded.
   * @param {import("../database/drivers/base.js").default} db - Connection.
   * @returns {Promise<boolean>} - Whether version one is recorded.
   */
  async _hasMigration(db) {
    const rows = await db
      .newQuery()
      .from(MIGRATIONS_TABLE)
      .where({key: this._migrationKey()})
      .limit(1)
      .results()

    return rows.length > 0
  }

  /**
   * Builds the scoped migration key.
   * @returns {string} - Scoped migration key.
   */
  _migrationKey() { return `${MIGRATION_SCOPE}:${MIGRATION_VERSION}` }

  /**
   * Enqueues a local job in the caller's active transaction when present.
   * @param {object} args - Enqueue request.
   * @param {string} args.jobName - Registered job name.
   * @param {Array<ReturnType<typeof JSON.parse>>} args.args - Serialized job arguments.
   * @param {import("./types.js").BackgroundJobOptions} [args.options] - Job options.
   * @returns {Promise<string>} - Durable job id.
   */
  async enqueue({jobName, args, options = {}}) {
    await this.ensureReady()

    const preparedJob = this._prepareJob({args, jobName, options})

    return await this._withDb(async (connection) => await this._mutate(connection, async (db) => {
      let jobId = preparedJob.jobId

      if (options.deduplicateWhileQueued) {
        const existing = await db
          .newQuery()
          .from(LOCAL_BACKGROUND_JOBS_TABLE)
          .select("id")
          .where({
            args_digest: preparedJob.argsDigest,
            args_json: preparedJob.argsJson,
            job_name: preparedJob.jobName,
            queue: preparedJob.queue,
            status: "queued"
          })
          .where(`scheduled_at_ms <= ${db.quote(preparedJob.scheduledAtMs)}`)
          .order("scheduled_at_ms ASC")
          .order("created_at_ms ASC")
          .limit(1)
          .results()

        const existingRow = /** @type {{id: string | number} | undefined} */ (existing[0])

        if (existingRow) jobId = String(existingRow.id)
      }

      if (jobId === preparedJob.jobId) await this._insertPreparedJob(db, preparedJob)
      if (this.onCommittedEnqueue) await db.afterCommit(this.onCommittedEnqueue)

      return jobId
    }))
  }

  /**
   * Prepares validated local job data for insertion.
   * @param {{args: Array<ReturnType<typeof JSON.parse>>, jobName: string, options: import("./types.js").BackgroundJobOptions}} args - Job request.
   * @returns {import("./types.js").PreparedLocalBackgroundJob} - Prepared row data.
   */
  _prepareJob({args, jobName, options}) {
    if (options.idempotencyKey !== undefined) {
      throw new Error("idempotencyKey is not supported by the local background-jobs adapter")
    }

    const createdAtMs = this.clock.now()
    const queue = normalizeBackgroundJobQueue(options)
    const queues = this.configuration.getBackgroundJobsConfig().queues
    const argsJson = JSON.stringify(args || [])
    const executionMode = normalizeBackgroundJobExecutionMode(options, "inline", LOCAL_EXECUTION_MODES)

    if (typeof argsJson !== "string") throw new TypeError("Local background job arguments must be JSON serializable")
    if (executionMode !== "inline") throw new Error("Local background job execution mode invariant was violated")

    return {
      argsDigest: sha256Hex(argsJson),
      argsJson,
      concurrency: normalizeBackgroundJobConcurrency({options, queue, queues}),
      createdAtMs,
      executionMode,
      jobId: new UUID(4).format(),
      jobName,
      maxRetries: normalizeBackgroundJobMaxRetries(options.maxRetries),
      queue,
      scheduledAtMs: normalizeBackgroundJobScheduledAtMs(options.scheduledAtMs, createdAtMs)
    }
  }

  /**
   * Inserts one prepared local job row and its concurrency metadata.
   * @param {import("../database/drivers/base.js").default} db - Local SQLite connection.
   * @param {import("./types.js").PreparedLocalBackgroundJob} preparedJob - Prepared row data.
   * @returns {Promise<void>} - Resolves after insertion.
   */
  async _insertPreparedJob(db, preparedJob) {
    if (preparedJob.concurrency) await this._ensureConcurrency(db, preparedJob.concurrency)

    await db.insert({
      tableName: LOCAL_BACKGROUND_JOBS_TABLE,
      data: {
        args_digest: preparedJob.argsDigest,
        args_json: preparedJob.argsJson,
        attempts: 0,
        completed_at_ms: null,
        concurrency_key: preparedJob.concurrency?.concurrencyKey || null,
        created_at_ms: preparedJob.createdAtMs,
        execution_mode: preparedJob.executionMode,
        failed_at_ms: null,
        handed_off_at_ms: null,
        handoff_id: null,
        id: preparedJob.jobId,
        job_name: preparedJob.jobName,
        last_error: null,
        max_concurrency: preparedJob.concurrency?.maxConcurrency || null,
        max_retries: preparedJob.maxRetries,
        queue: preparedJob.queue,
        scheduled_at_ms: preparedJob.scheduledAtMs,
        status: "queued",
        worker_id: null
      }
    })
  }

  /**
   * Reconciles configured queue-derived caps and durable counters.
   * @returns {Promise<void>} - Resolves after reconciliation.
   */
  async reconcileQueueConcurrency() {
    await this.ensureReady()

    await this._withDb(async (connection) => await this._mutate(connection, async (db) => {
      const queues = this.configuration.getBackgroundJobsConfig().queues
      const rows = await db.newQuery().from(LOCAL_BACKGROUND_JOBS_TABLE).where({status: "queued"}).results()

      for (const rawRow of rows) {
        await this._reconcileQueuedJobConcurrency(db, this._normalizeRow(rawRow), queues)
      }

      await this._rebuildConcurrencyCounts(db)
    }))
  }

  /**
   * Applies current queue-derived concurrency policy to one queued row.
   * Explicit concurrency keys remain owned by the enqueue contract.
   * @param {import("../database/drivers/base.js").default} db - Local SQLite connection.
   * @param {import("./types.js").BackgroundJobRow} job - Queued job snapshot.
   * @param {Record<string, {maxConcurrent?: number, priority?: number}>} queues - Current queue policy snapshot.
   * @returns {Promise<import("./types.js").BackgroundJobRow>} - Reconciled snapshot.
   */
  async _reconcileQueuedJobConcurrency(db, job, queues) {
    const currentIsQueueDerived = Boolean(job.concurrencyKey?.startsWith(QUEUE_CONCURRENCY_KEY_PREFIX))

    if (job.concurrencyKey && !currentIsQueueDerived) return job

    const concurrency = normalizeBackgroundJobConcurrency({
      options: {},
      queue: job.queue,
      queues
    })

    if (!concurrency) {
      if (currentIsQueueDerived) {
        await db.update({
          conditions: {id: job.id, status: "queued"},
          data: {concurrency_key: null, max_concurrency: null},
          tableName: LOCAL_BACKGROUND_JOBS_TABLE
        })
      }

      return {...job, concurrencyKey: null, maxConcurrency: null}
    }

    await this._ensureConcurrency(db, concurrency)
    if (job.concurrencyKey !== concurrency.concurrencyKey || job.maxConcurrency !== concurrency.maxConcurrency) {
      await db.update({
        conditions: {id: job.id, status: "queued"},
        data: {concurrency_key: concurrency.concurrencyKey, max_concurrency: concurrency.maxConcurrency},
        tableName: LOCAL_BACKGROUND_JOBS_TABLE
      })
    }

    return {...job, concurrencyKey: concurrency.concurrencyKey, maxConcurrency: concurrency.maxConcurrency}
  }

  /**
   * Finds the next eligible local job.
   * @returns {Promise<import("./types.js").BackgroundJobRow | null>} - Next eligible local job.
   */
  async nextAvailableJob() {
    await this.ensureReady()

    return await this._withDb(async (db) => {
      const jobsTable = db.quoteTable(LOCAL_BACKGROUND_JOBS_TABLE)
      const concurrencyTable = db.quoteTable(LOCAL_BACKGROUND_JOB_CONCURRENCY_TABLE)
      const priorityOrder = this._queuePriorityOrderSql(db)
      let query = db
        .newQuery()
        .from(LOCAL_BACKGROUND_JOBS_TABLE)
        .where({status: "queued"})
        .where(`scheduled_at_ms <= ${db.quote(this.clock.now())}`)
        .where(
          `(${jobsTable}.${db.quoteColumn("concurrency_key")} IS NULL OR EXISTS (` +
          `SELECT 1 FROM ${concurrencyTable} WHERE ` +
          `${concurrencyTable}.${db.quoteColumn("concurrency_key")} = ${jobsTable}.${db.quoteColumn("concurrency_key")} AND ` +
          `${concurrencyTable}.${db.quoteColumn("active_count")} < ${concurrencyTable}.${db.quoteColumn("max_concurrency")}))`
        )

      if (priorityOrder) query = query.order(`${priorityOrder} DESC`)

      const rows = await query
        .order("scheduled_at_ms ASC")
        .order("created_at_ms ASC")
        .order("id ASC")
        .limit(1)
        .results()

      return rows[0] ? this._normalizeRow(rows[0]) : null
    })
  }

  /**
   * Finds the soonest future queued job.
   * @returns {Promise<import("./types.js").BackgroundJobRow | null>} - Soonest future queued job.
   */
  async nextScheduledJob() {
    await this.ensureReady()

    return await this._withDb(async (db) => {
      const rows = await db
        .newQuery()
        .from(LOCAL_BACKGROUND_JOBS_TABLE)
        .where({status: "queued"})
        .where(`scheduled_at_ms > ${db.quote(this.clock.now())}`)
        .order("scheduled_at_ms ASC")
        .order("created_at_ms ASC")
        .order("id ASC")
        .limit(1)
        .results()

      return rows[0] ? this._normalizeRow(rows[0]) : null
    })
  }

  /**
   * Finds a persisted local job by id.
   * @param {string} jobId - Job id.
   * @returns {Promise<import("./types.js").BackgroundJobRow | null>} - Persisted job.
   */
  async getJob(jobId) {
    await this.ensureReady()

    return await this._withDb(async (db) => await this._getJob(db, jobId))
  }

  /**
   * Lists local jobs in creation order.
   * @returns {Promise<import("./types.js").BackgroundJobRow[]>} - All local jobs in creation order.
   */
  async listJobs() {
    await this.ensureReady()

    return await this._withDb(async (db) => {
      const rows = await db
        .newQuery()
        .from(LOCAL_BACKGROUND_JOBS_TABLE)
        .order("created_at_ms ASC")
        .order("id ASC")
        .results()

      return rows.map((row) => this._normalizeRow(row))
    })
  }

  /**
   * Atomically reserves concurrency and claims one queued job.
   * @param {{jobId: string}} args - Claim request.
   * @returns {Promise<import("./types.js").BackgroundJobHandoff | null>} - Fenced claim.
   */
  async markHandedOff({jobId}) {
    await this.ensureReady()

    return await this._withDb(async (connection) => await this._mutate(connection, async (db) => {
      const job = await this._getJob(db, jobId)

      if (!job || job.status !== "queued" || Number(job.scheduledAtMs) > this.clock.now()) return null
      if (job.concurrencyKey && !(await this._reserveConcurrency(db, job.concurrencyKey))) return null

      const handedOffAtMs = this.clock.now()
      const handoffId = new UUID(4).format()
      const affectedRows = await this._updateAffectedRows(db, {
        conditions: {id: jobId, status: "queued"},
        data: {handed_off_at_ms: handedOffAtMs, handoff_id: handoffId, status: "handed_off", worker_id: "local"},
        tableName: LOCAL_BACKGROUND_JOBS_TABLE
      })

      if (affectedRows !== 1) {
        await this._releaseConcurrency(db, job.concurrencyKey)
        return null
      }

      return {handedOffAtMs, handoffId}
    }))
  }

  /**
   * Applies a fenced successful acknowledgement.
   * @param {{jobId: string, handoffId?: string}} args - Completion report.
   * @returns {Promise<boolean>} - Whether the lease won.
   */
  async markCompleted({jobId, handoffId}) {
    await this.ensureReady()

    return await this._withDb(async (connection) => await this._mutate(connection, async (db) => {
      const job = await this._getJob(db, jobId)

      if (!this._acceptsHandoff(job, handoffId)) return false
      await this._lockConcurrencyRow(db, job.concurrencyKey)

      const affectedRows = await this._updateAffectedRows(db, {
        conditions: {handoff_id: handoffId, id: jobId, status: "handed_off"},
        data: {completed_at_ms: this.clock.now(), status: "completed"},
        tableName: LOCAL_BACKGROUND_JOBS_TABLE
      })

      if (affectedRows !== 1) return false
      await this._releaseConcurrency(db, job.concurrencyKey)
      return true
    }))
  }

  /**
   * Applies a fenced reschedule without consuming an attempt.
   * @param {{jobId: string, handoffId?: string, delayMs: number}} args - Reschedule report.
   * @returns {Promise<boolean>} - Whether the lease won.
   */
  async markRescheduled({jobId, handoffId, delayMs}) {
    await this.ensureReady()

    return await this._withDb(async (connection) => await this._mutate(connection, async (db) => {
      const job = await this._getJob(db, jobId)

      if (!this._acceptsHandoff(job, handoffId)) return false
      await this._lockConcurrencyRow(db, job.concurrencyKey)

      const affectedRows = await this._updateAffectedRows(db, {
        conditions: {handoff_id: handoffId, id: jobId, status: "handed_off"},
        data: {
          handed_off_at_ms: null,
          handoff_id: null,
          scheduled_at_ms: rescheduledBackgroundJobAtMs(delayMs, this.clock.now()),
          status: "queued",
          worker_id: null
        },
        tableName: LOCAL_BACKGROUND_JOBS_TABLE
      })

      if (affectedRows !== 1) return false
      await this._releaseConcurrency(db, job.concurrencyKey)
      return true
    }))
  }

  /**
   * Applies a fenced failure, retry, or terminal transition.
   * @param {{jobId: string, handoffId?: string, error: ReturnType<typeof JSON.parse>}} args - Failure report.
   * @returns {Promise<import("./types.js").BackgroundJobRow | null>} - Accepted transition snapshot.
   */
  async markFailed({jobId, handoffId, error}) {
    await this.ensureReady()

    return await this._withDb(async (connection) => await this._mutate(connection, async (db) => {
      const job = await this._getJob(db, jobId)

      if (!this._acceptsHandoff(job, handoffId)) return null

      return await this._applyFailure(db, job, error)
    }))
  }

  /**
   * Turns every abandoned local handoff into the normal failure/retry path.
   * @returns {Promise<import("./types.js").BackgroundJobRow[]>} - Recovered transitions.
   */
  async recoverHandedOffJobs() {
    await this.ensureReady()

    return await this._withDb(async (connection) => await this._mutate(connection, async (db) => {
      const queues = this.configuration.getBackgroundJobsConfig().queues
      const rows = await db.newQuery().from(LOCAL_BACKGROUND_JOBS_TABLE).where({status: "handed_off"}).results()
      /** @type {import("./types.js").BackgroundJobRow[]} */
      const recovered = []

      for (const rawRow of rows) {
        const job = this._normalizeRow(rawRow)
        const updated = await this._applyFailure(db, job, new Error("Local background job recovered after an interrupted dispatcher"))

        if (!updated) continue

        const reconciled = updated.status === "queued"
          ? await this._reconcileQueuedJobConcurrency(db, updated, queues)
          : updated

        recovered.push(reconciled)
      }

      await this._rebuildConcurrencyCounts(db)
      return recovered
    }))
  }

  /**
   * Deletes local queue state for focused tests.
   * @returns {Promise<void>} - Resolves after deletion.
   */
  async clearAll() {
    await this.ensureReady()
    await this._withDb(async (connection) => await this._mutate(connection, async (db) => {
      await db.delete({conditions: {}, tableName: LOCAL_BACKGROUND_JOBS_TABLE})
      await db.delete({conditions: {}, tableName: LOCAL_BACKGROUND_JOB_CONCURRENCY_TABLE})
    }))
  }

  /**
   * Applies the common retry or exhausted failure transition.
   * @param {import("../database/drivers/base.js").default} db - Local SQLite connection.
   * @param {import("./types.js").BackgroundJobRow} job - Active handoff.
   * @param {ReturnType<typeof JSON.parse>} error - Performance error.
   * @returns {Promise<import("./types.js").BackgroundJobRow | null>} - Transition snapshot.
   */
  async _applyFailure(db, job, error) {
    const attempts = (job.attempts || 0) + 1
    const maxRetries = normalizeBackgroundJobMaxRetries(job.maxRetries)
    const willRetry = attempts <= maxRetries
    const nowMs = this.clock.now()
    /** @type {Record<string, ReturnType<typeof JSON.parse>>} */
    const data = {
      attempts,
      handed_off_at_ms: null,
      handoff_id: null,
      last_error: normalizeBackgroundJobError(error),
      status: willRetry ? "queued" : "failed",
      worker_id: null
    }

    if (willRetry) {
      Object.assign(data, {scheduled_at_ms: nowMs + retryDelayMs(attempts)})
    } else {
      Object.assign(data, {failed_at_ms: nowMs})
    }

    await this._lockConcurrencyRow(db, job.concurrencyKey)
    const affectedRows = await this._updateAffectedRows(db, {
      conditions: {handoff_id: job.handoffId, id: job.id, status: "handed_off"},
      data,
      tableName: LOCAL_BACKGROUND_JOBS_TABLE
    })

    if (affectedRows !== 1) return null
    await this._releaseConcurrency(db, job.concurrencyKey)

    return {
      ...job,
      attempts,
      failedAtMs: willRetry ? job.failedAtMs : nowMs,
      handedOffAtMs: null,
      handoffId: null,
      lastError: data.last_error,
      scheduledAtMs: willRetry ? Number(data.scheduled_at_ms) : job.scheduledAtMs,
      status: data.status,
      workerId: null
    }
  }

  /**
   * Ensures that a durable concurrency counter exists with the required cap.
   * @param {import("../database/drivers/base.js").default} db - Local SQLite connection.
   * @param {import("./types.js").ResolvedBackgroundJobConcurrency} concurrency - Desired counter.
   * @returns {Promise<void>} - Resolves when ensured.
   */
  async _ensureConcurrency(db, concurrency) {
    const rows = await db
      .newQuery()
      .from(LOCAL_BACKGROUND_JOB_CONCURRENCY_TABLE)
      .where({concurrency_key: concurrency.concurrencyKey})
      .limit(1)
      .results()

    if (!rows[0]) {
      await db.insert({
        tableName: LOCAL_BACKGROUND_JOB_CONCURRENCY_TABLE,
        data: {active_count: 0, concurrency_key: concurrency.concurrencyKey, max_concurrency: concurrency.maxConcurrency}
      })
      return
    }

    const existingRow = /** @type {{max_concurrency: number | string}} */ (rows[0])
    const existingCap = Number(existingRow.max_concurrency)

    if (existingCap === concurrency.maxConcurrency) return
    if (!concurrency.queueDerived) throw new Error(`Conflicting maxConcurrency for background job concurrencyKey: ${concurrency.concurrencyKey}`)

    await db.update({
      conditions: {concurrency_key: concurrency.concurrencyKey},
      data: {max_concurrency: concurrency.maxConcurrency},
      tableName: LOCAL_BACKGROUND_JOB_CONCURRENCY_TABLE
    })
  }

  /**
   * Atomically reserves one slot for a concurrency key.
   * @param {import("../database/drivers/base.js").default} db - Connection.
   * @param {string} concurrencyKey - Concurrency key.
   * @returns {Promise<boolean>} - Whether a slot was reserved.
   */
  async _reserveConcurrency(db, concurrencyKey) {
    const table = db.quoteTable(LOCAL_BACKGROUND_JOB_CONCURRENCY_TABLE)
    const count = db.quoteColumn("active_count")
    const affectedRows = await db.affectedRows(
      `UPDATE ${table} SET ${count} = ${count} + 1 ` +
      `WHERE ${db.quoteColumn("concurrency_key")} = ${db.quote(concurrencyKey)} ` +
      `AND ${count} < ${db.quoteColumn("max_concurrency")}`
    )

    return affectedRows === 1
  }

  /**
   * Releases one slot for a concurrency key.
   * @param {import("../database/drivers/base.js").default} db - Connection.
   * @param {string | null} concurrencyKey - Concurrency key.
   * @returns {Promise<void>} - Resolves after release.
   */
  async _releaseConcurrency(db, concurrencyKey) {
    if (!concurrencyKey) return

    const table = db.quoteTable(LOCAL_BACKGROUND_JOB_CONCURRENCY_TABLE)
    const count = db.quoteColumn("active_count")

    await db.affectedRows(
      `UPDATE ${table} SET ${count} = ${count} - 1 ` +
      `WHERE ${db.quoteColumn("concurrency_key")} = ${db.quote(concurrencyKey)} AND ${count} > 0`
    )
  }

  /**
   * Acquires the transaction's write lock for a concurrency counter row.
   * @param {import("../database/drivers/base.js").default} db - Connection.
   * @param {string | null} concurrencyKey - Concurrency key.
   * @returns {Promise<void>} - Resolves after locking.
   */
  async _lockConcurrencyRow(db, concurrencyKey) {
    if (!concurrencyKey) return

    const table = db.quoteTable(LOCAL_BACKGROUND_JOB_CONCURRENCY_TABLE)
    const count = db.quoteColumn("active_count")

    await db.query(
      `UPDATE ${table} SET ${count} = ${count} ` +
      `WHERE ${db.quoteColumn("concurrency_key")} = ${db.quote(concurrencyKey)}`
    )
  }

  /**
   * Rebuilds active counters from durable handed-off jobs.
   * @param {import("../database/drivers/base.js").default} db - Connection.
   * @returns {Promise<void>} - Resolves after counter rebuild.
   */
  async _rebuildConcurrencyCounts(db) {
    const concurrencyTable = db.quoteTable(LOCAL_BACKGROUND_JOB_CONCURRENCY_TABLE)
    const jobsTable = db.quoteTable(LOCAL_BACKGROUND_JOBS_TABLE)

    await db.query(
      `UPDATE ${concurrencyTable} SET ${db.quoteColumn("active_count")} = (` +
      `SELECT COUNT(*) FROM ${jobsTable} WHERE ${jobsTable}.${db.quoteColumn("status")} = ${db.quote("handed_off")} AND ` +
      `${jobsTable}.${db.quoteColumn("concurrency_key")} = ${concurrencyTable}.${db.quoteColumn("concurrency_key")})`
    )
  }

  /**
   * Builds the configured queue-priority ordering expression.
   * @param {import("../database/drivers/base.js").default} db - Connection.
   * @returns {string | null} - Queue priority expression.
   */
  _queuePriorityOrderSql(db) {
    const queues = this.configuration.getBackgroundJobsConfig().queues
    const prioritized = Object.entries(queues)
      .filter(([, queue]) => Number.isFinite(queue?.priority) && Number(queue.priority) !== 0)
      .map(([queueName, queue]) => [queueName, Number(queue.priority)])

    if (prioritized.length === 0) return null

    const whens = prioritized
      .map(([queue, priority]) => `WHEN ${db.quote(queue)} THEN ${priority}`)
      .join(" ")

    return `CASE COALESCE(${db.quoteColumn("queue")}, ${db.quote(DEFAULT_BACKGROUND_JOB_QUEUE)}) ${whens} ELSE 0 END`
  }

  /**
   * Checks whether a persisted handoff owns the supplied acknowledgement fence.
   * @param {import("./types.js").BackgroundJobRow | null} job - Persisted job.
   * @param {string | undefined} handoffId - Handoff fence.
   * @returns {job is import("./types.js").BackgroundJobRow} - Whether accepted.
   */
  _acceptsHandoff(job, handoffId) {
    return Boolean(job && job.status === "handed_off" && job.handoffId && job.handoffId === handoffId)
  }

  /**
   * Finds a persisted local job using the current connection.
   * @param {import("../database/drivers/base.js").default} db - Connection.
   * @param {string} jobId - Job id.
   * @returns {Promise<import("./types.js").BackgroundJobRow | null>} - Persisted row.
   */
  async _getJob(db, jobId) {
    const rows = await db.newQuery().from(LOCAL_BACKGROUND_JOBS_TABLE).where({id: jobId}).limit(1).results()

    return rows[0] ? this._normalizeRow(rows[0]) : null
  }

  /**
   * Normalizes one raw local database row.
   * @param {Record<string, ReturnType<typeof JSON.parse>>} row - Raw row.
   * @returns {import("./types.js").BackgroundJobRow} - Normalized row.
   */
  _normalizeRow(row) {
    const parsedArgs = JSON.parse(String(row.args_json))
    const executionMode = normalizeBackgroundJobExecutionMode({executionMode: String(row.execution_mode)}, "inline", LOCAL_EXECUTION_MODES)

    if (!Array.isArray(parsedArgs)) throw new Error(`Invalid local background job args_json for job: ${String(row.id)}`)
    if (executionMode !== "inline") throw new Error("Local background job execution mode invariant was violated")

    return {
      args: parsedArgs,
      attempts: this._numberOrNull(row.attempts),
      completedAtMs: this._numberOrNull(row.completed_at_ms),
      concurrencyKey: row.concurrency_key === null || row.concurrency_key === undefined ? null : String(row.concurrency_key),
      createdAtMs: this._numberOrNull(row.created_at_ms),
      executionMode,
      failedAtMs: this._numberOrNull(row.failed_at_ms),
      handedOffAtMs: this._numberOrNull(row.handed_off_at_ms),
      handoffId: row.handoff_id === null || row.handoff_id === undefined ? null : String(row.handoff_id),
      id: String(row.id),
      jobName: String(row.job_name),
      lastError: row.last_error === null || row.last_error === undefined ? null : String(row.last_error),
      maxConcurrency: this._numberOrNull(row.max_concurrency),
      maxRetries: this._numberOrNull(row.max_retries),
      orphanedAtMs: null,
      queue: row.queue ? String(row.queue) : DEFAULT_BACKGROUND_JOB_QUEUE,
      scheduleKey: null,
      scheduledAtMs: this._numberOrNull(row.scheduled_at_ms),
      status: row.status ? String(row.status) : "queued",
      workerId: row.worker_id === null || row.worker_id === undefined ? null : String(row.worker_id)
    }
  }

  /**
   * Normalizes one nullable database number.
   * @param {ReturnType<typeof JSON.parse>} value - Database number.
   * @returns {number | null} - Normalized number.
   */
  _numberOrNull(value) {
    if (value === null || value === undefined || value === "") return null

    const number = Number(value)

    return Number.isNaN(number) ? null : number
  }

  /**
   * Executes a structured update and reports its affected-row count.
   * @param {import("../database/drivers/base.js").default} db - Connection.
   * @param {import("../database/drivers/base.js").UpdateSqlArgsType} args - Update arguments.
   * @returns {Promise<number>} - Affected rows.
   */
  async _updateAffectedRows(db, args) { return await db.affectedRows(db.updateSql(args)) }

  /**
   * Joins an ambient app transaction or uses the database's scoped operation lease.
   * @template T
   * @param {import("../database/drivers/base.js").default} db - Connection.
   * @param {(db: import("../database/drivers/base.js").default) => Promise<T>} callback - Mutation.
   * @returns {Promise<T>} - Mutation result.
   */
  async _mutate(db, callback) {
    if (db.insideTransaction()) return await this._transactionResult(db, async () => await callback(db))

    return await this.configuration.withTransaction({
      databaseIdentifier: this.getDatabaseIdentifier(),
      name: "Local background jobs mutation"
    }, async (operation) => await callback(operation.connection()))
  }

  /**
   * Runs a callback in a transaction and returns its captured result.
   * @template T
   * @param {import("../database/drivers/base.js").default} db - Connection.
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

    if (!completed) throw new Error("Local background jobs transaction callback was not invoked")
    return /** @type {T} */ (result)
  }

  /**
   * Runs a callback with the configured local database connection.
   * @template T
   * @param {(db: import("../database/drivers/base.js").default) => Promise<T>} callback - Connection callback.
   * @returns {Promise<T>} - Callback result.
   */
  async _withDb(callback) {
    const databaseIdentifier = this.getDatabaseIdentifier()

    return await this.configuration.ensureConnections({databaseIdentifiers: [databaseIdentifier], name: "Local background jobs store"}, async (dbs) => {
      const db = dbs[databaseIdentifier]

      if (!db) throw new Error(`No local background-jobs database connection available for identifier: ${databaseIdentifier}`)

      return await callback(db)
    })
  }

  /**
   * Reports an unexpected local-store failure through framework channels.
   * @param {{error: Error, stage: string}} args - Error report.
   * @returns {void} - No return value.
   */
  _reportFrameworkError({error, stage}) {
    const payload = {context: {stage}, error}
    const errorEvents = this.configuration.getErrorEvents()

    errorEvents.emit("framework-error", payload)
    errorEvents.emit("all-error", {...payload, errorType: "framework-error"})
  }
}
