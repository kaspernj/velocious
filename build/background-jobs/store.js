// @ts-check

import {createHash, randomUUID} from "crypto"
import BackgroundJobsAdapter from "./adapter.js"
import Logger from "../logger.js"
import TableData from "../database/table-data/index.js"
import VelociousError from "../velocious-error.js"
import BackgroundJobRecord from "./job-record.js"
import normalizeBackgroundJobError from "./normalize-error.js"
import { coordinateSharedTransactionConnection } from "../testing/shared-transaction-connection-coordinator.js"
import stableJsonStringify from "../utils/stable-json.js"
import {
  BACKGROUND_JOB_EXECUTION_MODES,
  DEFAULT_BACKGROUND_JOB_EXECUTION_MODE,
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
import {
  MAIL_DELIVERY_OPERATIONS_TABLE,
  mailDeliveryOperationForJob,
  mailDeliveryOperationKey
} from "../mailer/delivery-operation.js"

/**
 * PreparedBackgroundJob type.
 * @typedef {object} PreparedBackgroundJob
 * @property {string} argsJson - Serialized arguments.
 * @property {{concurrencyKey: string, maxConcurrency: number, queueDerived: boolean} | null} concurrency - Resolved concurrency.
 * @property {number} createdAtMs - Creation timestamp.
 * @property {import("./types.js").BackgroundJobExecutionMode} executionMode - Execution mode.
 * @property {string} jobId - New job id.
 * @property {string} jobName - Job name.
 * @property {number} maxRetries - Retry cap.
 * @property {string} queue - Queue name.
 * @property {number} scheduledAtMs - Eligibility timestamp.
 * @property {number | null} timeoutMs - Per-job timeout override, or null when omitted.
 */

/**
 * BackgroundJobOrphanSelection type.
 * @typedef {object} BackgroundJobOrphanSelection
 * @property {Record<string, ReturnType<typeof JSON.parse>>} conditions - Exact update fence.
 * @property {import("./types.js").BackgroundJobRow} job - Selected active handoff.
 */

/**
 * BackgroundJobTransactionSerializationOptions type.
 * @typedef {object} BackgroundJobTransactionSerializationOptions
 * @property {{failureMessage: string, name: string}} [advisoryLock] - Session lock held around the transaction.
 */

/**
 * BackgroundJobConcurrencyCountRow type.
 * @typedef {object} BackgroundJobConcurrencyCountRow
 * @property {number | string} active_count - Persisted or aggregated active count.
 * @property {string} concurrency_key - Durable cap identity.
 */

/**
 * BackgroundJobQueuedConcurrency type.
 * @typedef {object} BackgroundJobQueuedConcurrency
 * @property {string | null} concurrencyKey - Current concurrency key for queued work.
 * @property {number | null} maxConcurrency - Current concurrency cap for queued work.
 */

const MIGRATIONS_TABLE = "velocious_internal_migrations"
const MIGRATION_SCOPE = "background_jobs"
const MIGRATION_VERSION = "20250215000000"
const SCHEMA_RECOVERY_PENDING_VERSION = "schema-recovery-pending"
const EXECUTION_MODE_BACKFILL_MIGRATION_VERSION = "20260607131010"
// Drops the redundant legacy `forked` boolean column and rewrites pooled rows to
// persist `execution_mode = "pooled"` directly (retiring the pooled-as-forked
// handoff-marker workaround), leaving `execution_mode` as the single source of
// truth for a job's runtime.
const DROP_FORKED_COLUMN_MIGRATION_VERSION = "20260719000000"
const JOBS_INDEX_REPAIR_MIGRATION_VERSION = "20260903120000"
// Legacy marker prefix used by rows written before this migration: pooled jobs
// used to persist as `execution_mode = "forked"` plus a `velocious-pooled:*`
// handoff id. Retained only to detect and convert those rows in the migration.
const LEGACY_POOLED_HANDOFF_ID_PREFIX = "velocious-pooled:"
const LEGACY_POOLED_QUEUED_HANDOFF_ID = `${LEGACY_POOLED_HANDOFF_ID_PREFIX}queued`
const JOBS_TABLE = "background_jobs"
const JOBS_INDEX_COLUMN_NAMES = [
  "job_name",
  "queue",
  "status",
  "scheduled_at_ms",
  "created_at_ms",
  "schedule_key",
  "handed_off_at_ms",
  "orphaned_at_ms",
  "concurrency_key"
]
const IDEMPOTENCY_KEYS_TABLE = "background_job_idempotency_keys"
const SCHEDULE_KEYS_TABLE = "background_job_schedule_keys"
const CONCURRENCY_TABLE = "background_job_concurrency"
const COUNTS_REVISION_TABLE = "background_job_count_revisions"
const COUNTS_REVISION_KEY = "counts"
const CONCURRENCY_RECONCILIATION_LOCK = "background-jobs:queue-concurrency-reconcile"
const CONCURRENCY_REPAIR_SAMPLE_LIMIT = 10
export const BACKGROUND_JOB_COUNTS_CHANNEL = "velocious-background-job-counts"
export const BACKGROUND_JOB_COUNT_BUCKETS = ["all", "queued", "handed_off", "completed", "failed", "orphaned"]
const COUNTED_JOB_STATUSES = BACKGROUND_JOB_COUNT_BUCKETS.slice(1)
const MAX_JOB_TIMEOUT_MS = 2_147_483_647
const JOB_TIMEOUT_VALIDATION_MESSAGE = `background job timeoutMs must be a finite non-positive number or an integer between 1 and ${MAX_JOB_TIMEOUT_MS}`
const ORPHANED_AFTER_MS = 2 * 60 * 60 * 1000

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

/**
 * Serializes concurrent `_applySchema` runs within THIS process, keyed by database
 * identifier, before callers without an existing connection check one out. Two
 * stores that share one connection (SingleMultiUse / SQLite)
 * otherwise interleave the multi-step table rebuild and corrupt it (the jobs table
 * is left as its `*_velocious_rebuild` temp). A DB advisory lock can't fix that: on
 * a session-scoped / re-entrant driver (MySQL `GET_LOCK`) a second acquire on the
 * same session succeeds immediately so both callers proceed, and taking it on a
 * separate connection blocks cross-session forever. An in-process promise-chain
 * mutex serializes same-process callers with neither hazard. Cross-process schema
 * races stay covered by the per-step advisory locks + rechecks inside the steps.
 * @type {Map<string, Promise<void>>}
 */
const schemaApplyChains = new Map()
/** @type {Map<string, Promise<void>>} */
const transactionMutationChains = new Map()

export default class BackgroundJobsStore extends BackgroundJobsAdapter {
  /**
   * Runs constructor.
   * @param {object} args - Options.
   * @param {import("../configuration.js").default} args.configuration - Configuration.
   * @param {string} [args.databaseIdentifier] - Database identifier.
   */
  constructor({configuration, databaseIdentifier}) {
    super()
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
   * Ensures the background-jobs schema (tables + columns) exists on the configured
   * database, without initializing the runtime model. Lets `db:migrate` create the
   * framework's own schema deterministically alongside app migrations — and capture
   * it in the dumped structure SQL — instead of it only appearing once a store boots.
   * Idempotent: reuses the same `_ensureSchema` the runtime store uses, which skips
   * work already applied (tracked in `velocious_internal_migrations`).
   * @param {import("../database/drivers/base.js").default} [db] - Reuse an already
   *   checked-out connection (e.g. the one `db:migrate` holds) rather than opening a
   *   nested checkout that would deadlock a single-connection pool.
   * @returns {Promise<void>} - Resolves when the schema is present.
   */
  async ensureSchema(db) {
    // When a connection is handed in (the db:migrate path), the caller already owns
    // the active configuration + connection context; calling setCurrent() here would
    // clobber it (e.g. the browser test runner juggles multiple configurations).
    if (!db) this.configuration.setCurrent()

    await this._ensureSchema(db)
  }

  /**
   * Reconciles queue-derived concurrency with the current configuration: the
   * explicit lifecycle path that adopts/releases persisted queued jobs onto
   * queue concurrency keys when `queues[name].maxConcurrent` is added, removed,
   * or changed. Called by the background-jobs main process on startup — the
   * deploy-time moment queue configuration changes take effect. Schema/tenant
   * checks and routine connection initialization deliberately never run this:
   * they stay read-only regarding queued job rows, because the broad
   * adoption/release UPDATEs deadlock against active job processes under
   * concurrent tenant initialization. Serialized across processes with a
   * database advisory lock so concurrently started mains cannot interleave the
   * UPDATEs; the per-instance memo only skips repeat work within this process.
   * @returns {Promise<void>} - Resolves when reconciled.
   */
  async reconcileQueueConcurrency() {
    if (this._queueConcurrencyReconciled) return

    const databaseIdentifier = this.getDatabaseIdentifier()
    const startedAtMs = Date.now()

    await this.logger.info(() => [
      "Starting background jobs queue-concurrency startup reconciliation",
      {databaseIdentifier}
    ])
    await this.ensureReady()

    await this._withDb(async (db) => {
      const acquired = await db.acquireAdvisoryLock(CONCURRENCY_RECONCILIATION_LOCK)

      if (!acquired) throw new Error("Failed to acquire background job queue-concurrency reconcile lock")

      try {
        await this._reconcileQueueConcurrency(db)
        await this._reconcileConcurrency(db)

        // Latch the memo only after BOTH steps succeed: if the count rebuild
        // fails after adoption, a retry on this store must re-enter and repair
        // the counts (adoption itself is idempotent).
        this._queueConcurrencyReconciled = true
      } finally {
        await db.releaseAdvisoryLock(CONCURRENCY_RECONCILIATION_LOCK)
      }
    })

    await this.logger.info(() => [
      "Completed background jobs queue-concurrency startup reconciliation",
      {databaseIdentifier, durationMs: Date.now() - startedAtMs}
    ])
  }

  /**
   * Repairs durable active-count drift while a main process remains live. The
   * initial snapshot is read-only; only suspected mismatches take their
   * counter lock and re-count inside the serialized transaction path.
   * @returns {Promise<import("./types.js").BackgroundJobConcurrencyReconciliation>} - Repair summary.
   */
  async reconcileActiveConcurrency() {
    const databaseIdentifier = this.getDatabaseIdentifier()
    const startedAtMs = Date.now()

    await this.ensureReady()

    const result = await this._serializedTransactionMutation(
      async (db) => await this._reconcileConcurrency(db, {insideTransaction: true}),
      {
        advisoryLock: {
          failureMessage: "Failed to acquire background job active-concurrency reconcile lock",
          name: CONCURRENCY_RECONCILIATION_LOCK
        }
      }
    )

    if (result.repairedCount > 0) {
      await this.logger.warn(() => [
        "Repaired background jobs active-concurrency count drift",
        {
          databaseIdentifier,
          durationMs: Date.now() - startedAtMs,
          repairedCount: result.repairedCount,
          repairs: result.repairs,
          repairsTruncatedCount: result.repairsTruncatedCount
        }
      ])
    }

    return result
  }

  /**
   * Runs enqueue.
   * @param {object} args - Options.
   * @param {string} args.jobName - Job name.
   * @param {Array<ReturnType<typeof JSON.parse>>} args.args - Arguments.
   * @param {import("./types.js").BackgroundJobOptions} [args.options] - Options.
   * @returns {Promise<string>} - Job id.
   */
  async enqueue({jobName, args, options}) {
    await this.ensureReady()

    const preparedJob = this._prepareJob({jobName, args, options})

    if (options?.idempotencyKey !== undefined) {
      return await this._enqueueIdempotently({args: args || [], options, preparedJob})
    }

    /** @type {string} */
    let resultJobId = preparedJob.jobId

    await this._serializedCountMutation(async (db) => {
      if (options?.deduplicateWhileQueued) {
        // Dedupe on the job's identity (name + args + queue), NOT its concurrency key, so a job
        // keeps whatever concurrency it resolves to. Only an existing job scheduled no later than
        // this enqueue can cover it; a retry backed off into the future must not suppress earlier
        // work. Ordering returns the earliest covering job when several queued rows already exist.
        const existing = await db
          .newQuery()
          .from(JOBS_TABLE)
          .select("id")
          .where({status: "queued", job_name: jobName, args_json: preparedJob.argsJson, queue: preparedJob.queue})
          .where(`scheduled_at_ms <= ${db.quote(preparedJob.scheduledAtMs)}`)
          .order("scheduled_at_ms ASC")
          .limit(1)
          .results()

        if (existing[0]) {
          resultJobId = String(/** @type {Record<string, ReturnType<typeof JSON.parse>>} */ (existing[0]).id)

          return
        }
      }

      await this._insertPreparedJob(db, {preparedJob, scheduleKey: null})
      await this._recordCountDelta(db, {all: 1, queued: 1})
    })

    return resultJobId
  }

  /**
   * Atomically owns one durable idempotency scope and creates its job exactly once.
   * @param {object} args - Enqueue input.
   * @param {Array<ReturnType<typeof JSON.parse>>} args.args - Job arguments.
   * @param {import("./types.js").BackgroundJobOptions} args.options - Job options.
   * @param {PreparedBackgroundJob} args.preparedJob - Normalized job.
   * @returns {Promise<string>} - Stable original job id.
   */
  async _enqueueIdempotently({args, options, preparedJob}) {
    const idempotencyKey = this._normalizeIdempotencyKey(options.idempotencyKey)
    const scopeDigest = this._idempotencyScopeDigest({idempotencyKey, jobName: preparedJob.jobName, queue: preparedJob.queue})
    const requestDigest = this._idempotencyRequestDigest({args, options, preparedJob})
    const ownership = {
      created_at_ms: preparedJob.createdAtMs,
      idempotency_key: idempotencyKey,
      job_id: preparedJob.jobId,
      job_name: preparedJob.jobName,
      queue: preparedJob.queue,
      request_digest: requestDigest,
      scope_digest: scopeDigest
    }
    const mailOperationInput = mailDeliveryOperationForJob(preparedJob.jobName, args)

    if (mailOperationInput && mailOperationInput.operation.id !== idempotencyKey) {
      throw VelociousError.safe("Mail delivery operation id must equal its background job idempotency key.", {
        code: "mail-delivery-idempotency-key-mismatch"
      })
    }

    // Reuse ordinary enqueue transaction admission because this path changes
    // the same durable count revision. The scope primary key remains the
    // cross-process convergence owner.
    return await this._idempotentEnqueueTransaction(async (db) => {
      const existing = await this._idempotencyOwnership(db, scopeDigest)

      if (existing) {
        this._validateIdempotencyOwnership({existing, ownership})
        await this._validateMailDeliveryOperation(db, {jobId: String(existing.job_id), mailOperationInput})
        return String(existing.job_id)
      }

      const claimed = await this._claimIdempotencyOwnership(db, ownership)

      if (!claimed.created) {
        this._validateIdempotencyOwnership({existing: claimed.row, ownership})
        await this._validateMailDeliveryOperation(db, {jobId: String(claimed.row.job_id), mailOperationInput})
        return String(claimed.row.job_id)
      }

      await this._lockCountRevision(db)
      await this._insertPreparedJob(db, {preparedJob, scheduleKey: null})
      await this._persistMailDeliveryOperation(db, {jobId: preparedJob.jobId, mailOperationInput, createdAtMs: preparedJob.createdAtMs})
      await this._recordCountDelta(db, {all: 1, queued: 1})

      return preparedJob.jobId
    })
  }

  /**
   * Serializes one physical connection locally without taking ownership away
   * from the database uniqueness constraint shared by all processes.
   * @template T
   * @param {(db: import("../database/drivers/base.js").default) => Promise<T>} callback - Transaction work.
   * @returns {Promise<T>} - Callback result.
   */
  async _idempotentEnqueueTransaction(callback) {
    return await this._serializedTransactionMutation(callback)
  }

  /**
   * Inserts an ownership row, resolving only a database uniqueness race.
   * @param {import("../database/drivers/base.js").default} db - Transaction connection.
   * @param {Record<string, ReturnType<typeof JSON.parse>>} ownership - Ownership row.
   * @returns {Promise<{created: boolean, row: Record<string, ReturnType<typeof JSON.parse>>}>} - Claim result.
   */
  async _claimIdempotencyOwnership(db, ownership) {
    try {
      // The savepoint keeps PostgreSQL's outer transaction usable after a
      // concurrent unique-key loss. The unique primary key, not a process
      // mutex, is the cross-process convergence authority.
      await db.transaction(async () => {
        await db.insert({tableName: IDEMPOTENCY_KEYS_TABLE, data: ownership})
      })

      return {created: true, row: ownership}
    } catch (error) {
      const raced = await this._idempotencyOwnership(db, String(ownership.scope_digest))

      if (!raced) throw error
      return {created: false, row: raced}
    }
  }

  /**
   * Loads one durable enqueue owner.
   * @param {import("../database/drivers/base.js").default} db - Database connection.
   * @param {string} scopeDigest - Fixed-size scope digest.
   * @returns {Promise<Record<string, ReturnType<typeof JSON.parse>> | null>} - Row or null.
   */
  async _idempotencyOwnership(db, scopeDigest) {
    const rows = await db.newQuery().from(IDEMPOTENCY_KEYS_TABLE).where({scope_digest: scopeDigest}).limit(1).results()

    return rows[0] ? /** @type {Record<string, ReturnType<typeof JSON.parse>>} */ (rows[0]) : null
  }

  /**
   * Fails closed when a durable key is reused for a different canonical request.
   * @param {object} args - Validation input.
   * @param {Record<string, ReturnType<typeof JSON.parse>>} args.existing - Stored owner.
   * @param {Record<string, ReturnType<typeof JSON.parse>>} args.ownership - Requested owner.
   * @returns {void}
   */
  _validateIdempotencyOwnership({existing, ownership}) {
    const exactScope = String(existing.job_name) === ownership.job_name
      && String(existing.queue) === ownership.queue
      && String(existing.idempotency_key) === ownership.idempotency_key

    if (!exactScope || String(existing.request_digest) !== ownership.request_digest) {
      throw VelociousError.safe("The background job idempotency key was already used for a different request.", {
        code: "background-job-idempotency-conflict"
      })
    }
  }

  /**
   * Persists the built-in mail operation in the same first-enqueue transaction.
   * @param {import("../database/drivers/base.js").default} db - Transaction connection.
   * @param {object} args - Operation input.
   * @param {number} args.createdAtMs - Creation timestamp.
   * @param {string} args.jobId - Native job id.
   * @param {{operation: import("../mailer/index.js").MailerDeliveryOperation, payload: import("../mailer/index.js").MailerDeliveryPayload} | null} args.mailOperationInput - Mail operation.
   * @returns {Promise<void>} - Resolves after persistence.
   */
  async _persistMailDeliveryOperation(db, {createdAtMs, jobId, mailOperationInput}) {
    if (!mailOperationInput) return
    const {operation} = mailOperationInput
    const operationKey = mailDeliveryOperationKey(operation.id)
    const row = {
      background_job_id: jobId,
      created_at_ms: createdAtMs,
      first_attempt_started_at_ms: null,
      operation_id: operation.id,
      operation_key: operationKey,
      payload_digest: operation.payloadDigest,
      provider_kind: operation.providerKind,
      provider_retention_ms: operation.providerRetentionMs
    }

    try {
      await db.transaction(async () => {
        await db.insert({tableName: MAIL_DELIVERY_OPERATIONS_TABLE, data: row})
      })
    } catch (error) {
      const existing = await this._mailDeliveryOperation(db, operationKey)

      if (!existing) throw error
      this._validateMailDeliveryOperationRow({existing, requested: row})
    }
  }

  /**
   * Validates the durable mail row during an exact generic enqueue replay.
   * @param {import("../database/drivers/base.js").default} db - Database connection.
   * @param {object} args - Validation input.
   * @param {string} args.jobId - Owned job id.
   * @param {{operation: import("../mailer/index.js").MailerDeliveryOperation, payload: import("../mailer/index.js").MailerDeliveryPayload} | null} args.mailOperationInput - Mail operation.
   * @returns {Promise<void>} - Resolves when exact.
   */
  async _validateMailDeliveryOperation(db, {jobId, mailOperationInput}) {
    if (!mailOperationInput) return
    const {operation} = mailOperationInput
    const existing = await this._mailDeliveryOperation(db, mailDeliveryOperationKey(operation.id))

    if (!existing) {
      throw new Error("Background job idempotency ownership is missing its durable mail delivery operation")
    }

    this._validateMailDeliveryOperationRow({
      existing,
      requested: {
        background_job_id: jobId,
        operation_id: operation.id,
        payload_digest: operation.payloadDigest,
        provider_kind: operation.providerKind,
        provider_retention_ms: operation.providerRetentionMs
      }
    })
  }

  /**
   * Loads a durable mail operation.
   * @param {import("../database/drivers/base.js").default} db - Database connection.
   * @param {string} operationKey - Fixed-size operation key.
   * @returns {Promise<Record<string, ReturnType<typeof JSON.parse>> | null>} - Row or null.
   */
  async _mailDeliveryOperation(db, operationKey) {
    const rows = await db.newQuery().from(MAIL_DELIVERY_OPERATIONS_TABLE).where({operation_key: operationKey}).limit(1).results()

    return rows[0] ? /** @type {Record<string, ReturnType<typeof JSON.parse>>} */ (rows[0]) : null
  }

  /**
   * Compares provider-relevant durable mail operation fields.
   * @param {object} args - Validation input.
   * @param {Record<string, ReturnType<typeof JSON.parse>>} args.existing - Stored row.
   * @param {Record<string, ReturnType<typeof JSON.parse>>} args.requested - Requested row.
   * @returns {void}
   */
  _validateMailDeliveryOperationRow({existing, requested}) {
    const matches = String(existing.operation_id) === requested.operation_id
      && String(existing.payload_digest) === requested.payload_digest
      && String(existing.background_job_id) === requested.background_job_id
      && String(existing.provider_kind) === requested.provider_kind
      && this._normalizeNumber(existing.provider_retention_ms) === requested.provider_retention_ms

    if (!matches) {
      throw VelociousError.safe("The mail delivery operation was already used for a different payload or provider.", {
        code: "mail-delivery-idempotency-conflict"
      })
    }
  }

  /**
   * Canonical request digest excluding generated ids and immediate enqueue time.
   * @param {object} args - Digest input.
   * @param {Array<ReturnType<typeof JSON.parse>>} args.args - Job arguments.
   * @param {import("./types.js").BackgroundJobOptions} args.options - Job options.
   * @param {PreparedBackgroundJob} args.preparedJob - Normalized job.
   * @returns {string} - SHA-256 digest.
   */
  _idempotencyRequestDigest({args, options, preparedJob}) {
    const serialized = stableJsonStringify({
      args,
      concurrency: preparedJob.concurrency,
      executionMode: preparedJob.executionMode,
      format: "velocious-background-job-idempotency-v1",
      jobName: preparedJob.jobName,
      maxRetries: preparedJob.maxRetries,
      queue: preparedJob.queue,
      scheduledAtMs: options.scheduledAtMs === undefined ? null : preparedJob.scheduledAtMs,
      scheduling: options.scheduledAtMs === undefined ? "immediate" : "scheduled",
      ...(preparedJob.timeoutMs === null ? {} : {timeoutMs: preparedJob.timeoutMs})
    })

    return createHash("sha256").update(serialized).digest("hex")
  }

  /**
   * Fixed-size globally indexed representation of the documented scope tuple.
   * @param {object} args - Scope input.
   * @param {string} args.idempotencyKey - Caller key.
   * @param {string} args.jobName - Job class name.
   * @param {string} args.queue - Queue name.
   * @returns {string} - SHA-256 scope digest.
   */
  _idempotencyScopeDigest({idempotencyKey, jobName, queue}) {
    return createHash("sha256")
      .update(stableJsonStringify({format: "velocious-background-job-idempotency-scope-v1", idempotencyKey, jobName, queue}))
      .digest("hex")
  }

  /**
   * Validates one caller key.
   * @param {string | undefined} idempotencyKey - Caller key.
   * @returns {string} - Valid key.
   */
  _normalizeIdempotencyKey(idempotencyKey) {
    if (typeof idempotencyKey !== "string" || idempotencyKey.length === 0) {
      throw VelociousError.safe("Background job idempotencyKey must be a non-empty string.", {
        code: "background-job-idempotency-key-invalid"
      })
    }

    return idempotencyKey
  }

  /**
   * Replaces the queued owner of a stable schedule key with a new one-off job.
   * A handed-off owner is left running and reported truthfully.
   * @param {object} args - Options.
   * @param {string} args.scheduleKey - Stable logical schedule key.
   * @param {string} args.jobName - Job name.
   * @param {Array<ReturnType<typeof JSON.parse>>} args.args - Arguments.
   * @param {import("./types.js").BackgroundJobOptions} [args.options] - Options.
   * @returns {Promise<import("./types.js").BackgroundJobReplacementResult>} - Replacement result.
   */
  async replaceScheduled({scheduleKey, jobName, args, options}) {
    await this.ensureReady()

    const normalizedScheduleKey = this._normalizeScheduleKey(scheduleKey)
    const preparedJob = this._prepareJob({jobName, args, options})

    return await this._serializedCountMutation(async (db) => {
      const ownerRows = await db
        .newQuery()
        .from(SCHEDULE_KEYS_TABLE)
        .where({schedule_key: normalizedScheduleKey})
        .limit(1)
        .results()
      const ownerJobId = ownerRows[0] ? String(/** @type {Record<string, ReturnType<typeof JSON.parse>>} */ (ownerRows[0]).job_id) : null
      const ownerJob = ownerJobId ? await this._getJobRowById(db, ownerJobId) : null
      /** @type {import("./types.js").BackgroundJobReplacementPreviousStatus} */
      let previousStatus = null
      let previousJobId = null

      if (ownerJob?.status === "queued") {
        const affectedRows = await this._updateAffectedRows(db, {
          tableName: JOBS_TABLE,
          data: {status: "cancelled"},
          conditions: {id: ownerJob.id, status: "queued"}
        })

        if (affectedRows === 1) {
          previousJobId = ownerJob.id
          previousStatus = "queued"
        } else {
          const currentOwnerJob = await this._getJobRowById(db, ownerJob.id)

          if (currentOwnerJob?.status === "handed_off") {
            previousJobId = currentOwnerJob.id
            previousStatus = "handed_off"
          }
        }
      } else if (ownerJob?.status === "handed_off") {
        previousJobId = ownerJob.id
        previousStatus = "handed_off"
      }

      await this._insertPreparedJob(db, {preparedJob, scheduleKey: normalizedScheduleKey})
      await db.upsert({
        tableName: SCHEDULE_KEYS_TABLE,
        data: {schedule_key: normalizedScheduleKey, job_id: preparedJob.jobId},
        conflictColumns: ["schedule_key"],
        updateColumns: ["job_id"]
      })

      if (previousStatus !== "queued") await this._recordCountDelta(db, {all: 1, queued: 1})
      return {jobId: preparedJob.jobId, previousJobId, previousStatus}
    }, {
      advisoryLock: {
        failureMessage: "Failed to acquire background job schedule-key lock",
        name: this._scheduleKeyLockName(normalizedScheduleKey)
      }
    })
  }

  /**
   * Cancels the queued owner of a stable schedule key. A handed-off owner is
   * detached but not marked stopped because execution may already be running.
   * @param {string} scheduleKey - Stable logical schedule key.
   * @returns {Promise<import("./types.js").BackgroundJobCancellationResult>} - Cancellation result.
   */
  async cancelScheduled(scheduleKey) {
    await this.ensureReady()

    const normalizedScheduleKey = this._normalizeScheduleKey(scheduleKey)

    return await this._serializedCountMutation(async (db) => {
      const ownerRows = await db
        .newQuery()
        .from(SCHEDULE_KEYS_TABLE)
        .where({schedule_key: normalizedScheduleKey})
        .limit(1)
        .results()

      if (!ownerRows[0]) return {jobId: null, outcome: "not_found"}

      const jobId = String(/** @type {Record<string, ReturnType<typeof JSON.parse>>} */ (ownerRows[0]).job_id)
      const job = await this._getJobRowById(db, jobId)

      if (job?.status === "queued") {
        const affectedRows = await this._updateAffectedRows(db, {
          tableName: JOBS_TABLE,
          data: {status: "cancelled"},
          conditions: {id: job.id, status: "queued"}
        })

        if (affectedRows === 1) {
          await this._releaseScheduleOwnership(db, {jobId, scheduleKey: normalizedScheduleKey})
          await this._recordStatusTransition(db, "queued", "cancelled")

          return {jobId, outcome: "cancelled"}
        }
      }

      const currentJob = await this._getJobRowById(db, jobId)

      await this._releaseScheduleOwnership(db, {jobId, scheduleKey: normalizedScheduleKey})

      if (currentJob?.status === "handed_off") return {jobId, outcome: "handed_off"}
      return {jobId: null, outcome: "not_found"}
    }, {
      advisoryLock: {
        failureMessage: "Failed to acquire background job schedule-key lock",
        name: this._scheduleKeyLockName(normalizedScheduleKey)
      }
    })
  }

  /**
   * Runs next available job.
   * @param {object} [args] - Options.
   * @param {import("./types.js").BackgroundJobExecutionMode | import("./types.js").BackgroundJobExecutionMode[]} [args.executionMode] - Execution mode or modes to match.
   * @returns {Promise<import("./types.js").BackgroundJobRow | null>} - Next job.
   */
  async nextAvailableJob(args = {}) {
    await this.ensureReady()

    return await this._withDb(async (db) => {
      return await this._nextQueuedJob({
        db,
        scheduledAtOperator: "<=",
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
   * @param {import("./types.js").BackgroundJobExecutionMode | import("./types.js").BackgroundJobExecutionMode[]} [args.executionMode] - Execution mode or modes to match.
   * @returns {Promise<import("./types.js").BackgroundJobRow | null>} - Next matching queued job.
   */
  async _nextQueuedJob({db, scheduledAtOperator, executionMode}) {
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

    if (executionMode) query = this._whereExecutionMode({db, executionMode, query})

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

    return `CASE COALESCE(${queueColumn}, ${db.quote(DEFAULT_BACKGROUND_JOB_QUEUE)}) ${whens} ELSE 0 END`
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
        const typedRow = /** @type {Record<string, ReturnType<typeof JSON.parse>>} */ (row)

        counts[String(typedRow.status)] = this._normalizeNumber(typedRow.count) || 0
      }

      return counts
    })
  }

  /**
   * Returns the authoritative dashboard count snapshot and its matching durable
   * revision. Locking the revision row before counting prevents a writer from
   * committing between the count query and revision read.
   * @returns {Promise<{counts: Record<string, number>, revision: number, total: number}>} Snapshot.
   */
  async countSnapshot() {
    await this.ensureReady()

    return await this._serializedCountMutation(async (db) => {
      return await this._countSnapshotOnLockedConnection(db)
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
      const countRow = /** @type {Record<string, ReturnType<typeof JSON.parse>>} */ (rows[0] || {})

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
   * @param {string} [args.handoffId] - Caller-selected exact lease id. Generated for legacy direct callers when omitted.
   * @param {string} [args.workerId] - Worker id.
   * @returns {Promise<import("./types.js").BackgroundJobHandoff | null>} - Claimed handoff lease, or null when no longer queued.
   */
  async markHandedOff({jobId, handoffId = randomUUID(), workerId}) {
    await this.ensureReady()

    const handedOffAtMs = Date.now()

    return await this._serializedCountMutation(async (db) => {
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
        conditions: {concurrency_key: queuedJob.concurrencyKey, id: jobId, status: "queued"}
      })

      if (affectedRows !== 1) {
        await this._releaseConcurrency(db, queuedJob.concurrencyKey)
        return null
      }

      await this._recordStatusTransition(db, "queued", "handed_off")
      return {handedOffAtMs, handoffId}
    })
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

    return await this._serializedCountMutation(async (db) => {
      const job = await this._getJobRowById(db, jobId)

      if (!job) return false
      if (!this._shouldAcceptReport({job, handoffId, workerId, handedOffAtMs})) return false

      await this._lockConcurrencyRow(db, job.concurrencyKey)
      const affectedRows = await this._updateAffectedRows(db, {
        tableName: JOBS_TABLE,
        data: {
          status: "completed",
          completed_at_ms: Date.now()
        },
        conditions: this._activeHandoffConditions(job)
      })

      if (affectedRows !== 1) return false
      await this._releaseScheduleOwnershipForJob(db, job)
      await this._releaseConcurrency(db, job.concurrencyKey)
      await this._recordStatusTransition(db, "handed_off", "completed")
      return true
    })
  }

  /**
   * Returns an active handoff to the queue at a caller-requested future time.
   * This is normal job control flow: it preserves failure attempts and metadata.
   * @param {object} args - Options.
   * @param {string} args.jobId - Job id.
   * @param {number} args.delayMs - Delay from persistence time in milliseconds.
   * @param {string} [args.handoffId] - Handoff lease id.
   * @param {string} [args.workerId] - Worker id.
   * @param {number} [args.handedOffAtMs] - Handed off timestamp.
   * @returns {Promise<boolean>} - Whether the fenced report was accepted.
   */
  async markRescheduled({jobId, delayMs, handoffId, workerId, handedOffAtMs}) {
    await this.ensureReady()
    this._validateRescheduleDelayMs(delayMs)

    return await this._serializedCountMutation(async (db) => {
      const job = await this._getJobRowById(db, jobId)

      if (!job) return false
      if (!this._shouldAcceptReport({job, handoffId, workerId, handedOffAtMs})) return false

      await this._lockConcurrencyRow(db, job.concurrencyKey)
      const queuedConcurrency = await this._requeuedJobConcurrency(db, job)
      const scheduledAtMs = this._rescheduledAtMs(delayMs)
      const affectedRows = await this._updateAffectedRows(db, {
        tableName: JOBS_TABLE,
        data: {
          concurrency_key: queuedConcurrency.concurrencyKey,
          max_concurrency: queuedConcurrency.maxConcurrency,
          status: "queued",
          scheduled_at_ms: scheduledAtMs,
          handed_off_at_ms: null,
          handoff_id: null,
          worker_id: null
        },
        conditions: this._activeHandoffConditions(job)
      })

      if (affectedRows !== 1) return false
      await this._releaseConcurrency(db, job.concurrencyKey)
      await this._recordStatusTransition(db, "handed_off", "queued")
      return true
    })
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

    await this._serializedCountMutation(async (db) => {
      const job = await this._getJobRowById(db, jobId)
      if (!job || job.handoffId !== handoffId || job.status !== "handed_off") return
      await this._lockConcurrencyRow(db, job.concurrencyKey)
      const queuedConcurrency = await this._requeuedJobConcurrency(db, job)
      const affectedRows = await this._updateAffectedRows(db, {
        tableName: JOBS_TABLE,
        data: {
          concurrency_key: queuedConcurrency.concurrencyKey,
          max_concurrency: queuedConcurrency.maxConcurrency,
          status: "queued",
          scheduled_at_ms: Date.now(),
          handed_off_at_ms: null,
          handoff_id: null,
          worker_id: null
        },
        conditions: {handoff_id: handoffId, id: jobId, status: "handed_off"}
      })
      if (affectedRows === 1) {
        await this._releaseConcurrency(db, job.concurrencyKey)
        await this._recordStatusTransition(db, "handed_off", "queued")
      }
    })
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
   * Snapshots exact, lease-aware active handoffs before a new main generation
   * starts accepting worker reconnects. Legacy rows without a complete worker,
   * lease, and timestamp identity stay owned by the age-based orphan sweep.
   * @returns {Promise<import("./types.js").BackgroundJobHandoffSnapshot[]>} - Exact startup handoffs.
   */
  async snapshotHandedOffJobs() {
    await this.ensureReady()

    const rows = await this._withDb(async (db) => await db
      .newQuery()
      .from(JOBS_TABLE)
      .where({status: "handed_off"})
      .order("created_at_ms ASC")
      .order("id ASC")
      .results())
    /** @type {import("./types.js").BackgroundJobHandoffSnapshot[]} */
    const handoffs = []

    for (const row of rows) {
      const job = this._normalizeJobRow(row)

      if (!job.handoffId || !job.workerId || typeof job.handedOffAtMs !== "number") continue

      handoffs.push({
        handedOffAtMs: job.handedOffAtMs,
        handoffId: job.handoffId,
        jobId: job.id,
        workerId: job.workerId
      })
    }

    return handoffs
  }

  /**
   * Reclaims only unchanged exact handoffs selected by a main-generation startup
   * snapshot. The ordinary orphan failure path owns retries, terminal status,
   * count transitions, schedule ownership, and concurrency release.
   * @param {object} args - Options.
   * @param {import("./types.js").BackgroundJobHandoffSnapshot[]} args.handoffs - Exact startup snapshots.
   * @param {ReturnType<typeof JSON.parse>} args.error - Orphan reason.
   * @returns {Promise<import("./types.js").BackgroundJobRow[]>} - Accepted transitions.
   */
  async markOrphanedHandoffs({handoffs, error}) {
    await this.ensureReady()

    return await this._serializedCountMutation(async (db) => {
      /** @type {BackgroundJobOrphanSelection[]} */
      const selections = []

      for (const handoff of handoffs) {
        const job = await this._getJobRowById(db, handoff.jobId)

        if (!job || job.status !== "handed_off") continue
        if (job.handoffId !== handoff.handoffId) continue
        if (job.workerId !== handoff.workerId) continue
        if (job.handedOffAtMs !== handoff.handedOffAtMs) continue

        selections.push({
          conditions: {
            handed_off_at_ms: handoff.handedOffAtMs,
            handoff_id: handoff.handoffId,
            id: handoff.jobId,
            status: "handed_off",
            worker_id: handoff.workerId
          },
          job
        })
      }

      return await this._markOrphanSelections({db, error, selections})
    })
  }

  /**
   * Runs mark failed.
   * @param {object} args - Options.
   * @param {string} args.jobId - Job id.
   * @param {ReturnType<typeof JSON.parse>} args.error - Error.
   * @param {string} [args.handoffId] - Handoff lease id.
   * @param {string} [args.workerId] - Worker id.
   * @param {number} [args.handedOffAtMs] - Handed off timestamp.
   * @returns {Promise<import("./types.js").BackgroundJobRow | null>} - Updated job row when the report was accepted.
   */
  async markFailed({jobId, error, handoffId, workerId, handedOffAtMs}) {
    await this.ensureReady()

    return await this._serializedCountMutation(async (db) => {
      const job = await this._getJobRowById(db, jobId)

      if (!job) return null
      if (!this._shouldAcceptReport({job, handoffId, workerId, handedOffAtMs})) return null

      const updatedJob = await this._applyFailure({db, job, error, markOrphaned: false})

      if (updatedJob) await this._recordStatusTransition(db, job.status, updatedJob.status)
      return updatedJob
    })
  }

  /**
   * Runs mark orphaned jobs.
   * @param {object} [args] - Options.
   * @param {number} [args.orphanedAfterMs] - Mark jobs orphaned after this duration.
   * @returns {Promise<import("./types.js").BackgroundJobRow[]>} - The jobs this sweep marked orphaned.
   */
  async markOrphanedJobs({orphanedAfterMs = ORPHANED_AFTER_MS} = {}) {
    await this.ensureReady()

    return await this._serializedCountMutation(async (db) => {
      const cutoff = Date.now() - orphanedAfterMs
      const query = db
        .newQuery()
        .from(JOBS_TABLE)
        .where({status: "handed_off"})
        .where(`handed_off_at_ms <= ${db.quote(cutoff)}`)

      const rows = await query.results()

      /** @type {BackgroundJobOrphanSelection[]} */
      const selections = []

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
        selections.push({
          conditions: {id: job.id, status: "handed_off", handed_off_at_ms: job.handedOffAtMs},
          job
        })
      }

      return await this._markOrphanSelections({
        db,
        error: "Job orphaned after timeout",
        selections
      })
    })
  }

  /**
   * Applies the common fenced orphan transition and records one aggregate count
   * delta for the accepted rows.
   * @param {object} args - Options.
   * @param {import("../database/drivers/base.js").default} args.db - Transaction connection.
   * @param {ReturnType<typeof JSON.parse>} args.error - Orphan reason.
   * @param {BackgroundJobOrphanSelection[]} args.selections - Selected handoffs and exact fences.
   * @returns {Promise<import("./types.js").BackgroundJobRow[]>} - Accepted transitions.
   */
  async _markOrphanSelections({db, error, selections}) {
    /** @type {import("./types.js").BackgroundJobRow[]} */
    const orphanedJobs = []

    for (const {conditions, job} of selections) {
      const orphanedJob = await this._applyFailure({
        conditions,
        db,
        error,
        job,
        markOrphaned: true
      })

      if (orphanedJob) orphanedJobs.push(orphanedJob)
    }

    const statusCounts = this._statusCounts(orphanedJobs)
    const deltas = this._emptyCountBuckets()

    for (const [status, count] of Object.entries(statusCounts)) {
      deltas.handed_off -= count
      deltas[status] += count
    }
    await this._recordCountDelta(db, deltas)

    return orphanedJobs
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
      const removed = await this._serializedCountMutation(async (db) => {
        const rows = await db
          .newQuery()
          .from(JOBS_TABLE)
          .select("id")
          .where({status})
          .where(`${db.quoteColumn(column)} <= ${db.quote(cutoff)}`)
          .limit(batchSize)
          .results()

        if (rows.length === 0) return 0

        const ids = rows.map((/** @type {Record<string, ReturnType<typeof JSON.parse>>} */ row) => db.quote(String(row.id))).join(", ")

        const removed = await db.affectedRows(
          `DELETE FROM ${db.quoteTable(JOBS_TABLE)} WHERE ${db.quoteColumn("id")} IN (${ids})`
        )

        await this._recordCountDelta(db, {all: -removed, [status]: -removed})

        return removed
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

    await this._serializedCountMutation(async (db) => {
      const snapshot = await this._countSnapshotOnLockedConnection(db)
      if (await db.tableExists(MAIL_DELIVERY_OPERATIONS_TABLE)) await db.query(`DELETE FROM ${db.quoteTable(MAIL_DELIVERY_OPERATIONS_TABLE)}`)
      if (await db.tableExists(IDEMPOTENCY_KEYS_TABLE)) await db.query(`DELETE FROM ${db.quoteTable(IDEMPOTENCY_KEYS_TABLE)}`)
      if (await db.tableExists(SCHEDULE_KEYS_TABLE)) await db.query(`DELETE FROM ${db.quoteTable(SCHEDULE_KEYS_TABLE)}`)
      await db.query(`DELETE FROM ${db.quoteTable(JOBS_TABLE)}`)
      if (await db.tableExists(CONCURRENCY_TABLE)) await db.query(`DELETE FROM ${db.quoteTable(CONCURRENCY_TABLE)}`)
      const deltas = Object.fromEntries(Object.entries(snapshot.counts).map(([key, value]) => [key, -value]))
      await this._recordCountDelta(db, deltas)
    })
  }

  /**
   * Cancels a queued or handed-off job and releases any durable concurrency reservation.
   * @param {string} jobId - Job id.
   * @returns {Promise<boolean>} - Whether the job was cancelled.
   */
  async cancel(jobId) {
    await this.ensureReady()
    return await this._serializedCountMutation(async (db) => {
      const job = await this._getJobRowById(db, jobId)
      if (!job || (job.status !== "queued" && job.status !== "handed_off")) return false
      // Only a handed_off job holds a concurrency reservation, so only that case touches the
      // shared counter row and needs the concurrency-then-job lock ordering.
      if (job.status === "handed_off") await this._lockConcurrencyRow(db, job.concurrencyKey)
      const affectedRows = await this._updateAffectedRows(db, {tableName: JOBS_TABLE, data: {status: "cancelled"}, conditions: {id: job.id, status: job.status}})
      if (affectedRows !== 1) return false
      await this._releaseScheduleOwnershipForJob(db, job)
      if (job.status === "handed_off") await this._releaseConcurrency(db, job.concurrencyKey)
      await this._recordStatusTransition(db, job.status, "cancelled")
      return true
    })
  }

  /**
   * Runs get retry delay ms.
   * @param {number} retryCount - Retry attempt count (1-based).
   * @returns {number} - Delay in milliseconds.
   */
  getRetryDelayMs(retryCount) {
    return retryDelayMs(retryCount)
  }

  /**
   * Normalizes one new job before entering its persistence transaction.
   * @param {object} args - Job input.
   * @param {Array<ReturnType<typeof JSON.parse>>} args.args - Job arguments.
   * @param {string} args.jobName - Job name.
   * @param {import("./types.js").BackgroundJobOptions} [args.options] - Job options.
   * @returns {PreparedBackgroundJob} - Prepared job.
   */
  _prepareJob({args, jobName, options}) {
    const createdAtMs = Date.now()
    const queue = this._normalizeQueue(options)

    return {
      argsJson: JSON.stringify(args || []),
      concurrency: this._resolveConcurrency(options, queue),
      createdAtMs,
      executionMode: this._normalizeExecutionMode(options),
      jobId: randomUUID(),
      jobName,
      maxRetries: this._normalizeMaxRetries(options?.maxRetries),
      queue,
      scheduledAtMs: this._normalizeScheduledAtMs(options?.scheduledAtMs, createdAtMs),
      timeoutMs: this._normalizeJobTimeoutMs(options)
    }
  }

  /**
   * Normalizes a per-job timeout while preserving omitted (worker fallback)
   * separately from explicitly disabled.
   * @param {import("./types.js").BackgroundJobOptions | undefined} options - Job options.
   * @returns {number | null} - Positive timeout, zero for disabled, or null when omitted.
   */
  _normalizeJobTimeoutMs(options) {
    if (options?.timeoutMs === undefined) return null

    const timeoutMs = options.timeoutMs

    if (typeof timeoutMs !== "number" || !Number.isFinite(timeoutMs)) {
      throw VelociousError.safe(JOB_TIMEOUT_VALIDATION_MESSAGE)
    }

    if (timeoutMs <= 0) return 0

    if (!Number.isInteger(timeoutMs) || timeoutMs > MAX_JOB_TIMEOUT_MS) {
      throw VelociousError.safe(JOB_TIMEOUT_VALIDATION_MESSAGE)
    }

    return timeoutMs
  }

  /**
   * Inserts one prepared queued job, including its concurrency registration.
   * @param {import("../database/drivers/base.js").default} db - Database connection.
   * @param {object} args - Insert input.
   * @param {PreparedBackgroundJob} args.preparedJob - Prepared job.
   * @param {string | null} args.scheduleKey - Historical stable key.
   * @returns {Promise<void>} - Resolves after insertion.
   */
  async _insertPreparedJob(db, {preparedJob, scheduleKey}) {
    const {concurrency} = preparedJob

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
        id: preparedJob.jobId,
        job_name: preparedJob.jobName,
        args_json: preparedJob.argsJson,
        execution_mode: preparedJob.executionMode,
        queue: preparedJob.queue,
        max_retries: preparedJob.maxRetries,
        attempts: 0,
        status: "queued",
        scheduled_at_ms: preparedJob.scheduledAtMs,
        created_at_ms: preparedJob.createdAtMs,
        schedule_key: scheduleKey,
        concurrency_key: concurrency?.concurrencyKey || null,
        max_concurrency: concurrency?.maxConcurrency || null,
        timeout_ms: preparedJob.timeoutMs,
        handoff_id: null
      }
    })
  }

  /**
   * Runs normalize max retries.
   * @param {number | null | undefined} maxRetries - Input.
   * @returns {number} - Normalized max retries.
   */
  _normalizeMaxRetries(maxRetries) {
    return normalizeBackgroundJobMaxRetries(maxRetries)
  }

  /**
   * Runs normalize scheduled at ms.
   * @param {number | undefined} scheduledAtMs - Requested dispatch timestamp.
   * @param {number} defaultScheduledAtMs - Default dispatch timestamp.
   * @returns {number} - Dispatch timestamp.
   */
  _normalizeScheduledAtMs(scheduledAtMs, defaultScheduledAtMs) {
    return normalizeBackgroundJobScheduledAtMs(scheduledAtMs, defaultScheduledAtMs)
  }

  /**
   * Resolves a reschedule delay against persistence time.
   * @param {number} delayMs - Delay in milliseconds.
   * @returns {number} - Future eligibility timestamp.
   */
  _rescheduledAtMs(delayMs) {
    return rescheduledBackgroundJobAtMs(delayMs, Date.now())
  }

  /**
   * Validates a public reschedule delay before persistence work begins.
   * @param {number} delayMs - Delay in milliseconds.
   * @returns {void}
   */
  _validateRescheduleDelayMs(delayMs) {
    rescheduledBackgroundJobAtMs(delayMs, 0)
  }

  /**
   * Validates a stable schedule key at the public storage boundary.
   * @param {string} scheduleKey - Stable logical schedule key.
   * @returns {string} - Validated key.
   */
  _normalizeScheduleKey(scheduleKey) {
    if (typeof scheduleKey === "string" && scheduleKey.length > 0 && scheduleKey.length <= 255) return scheduleKey

    throw VelociousError.safe("background job scheduleKey must be a non-empty string of at most 255 characters")
  }

  /**
   * Builds a bounded advisory-lock name for one stable schedule key.
   * @param {string} scheduleKey - Validated stable schedule key.
   * @returns {string} - Advisory-lock name.
   */
  _scheduleKeyLockName(scheduleKey) {
    const hash = createHash("sha256").update(scheduleKey).digest("hex").slice(0, 32)

    return `background-jobs:schedule:${hash}`
  }

  /**
   * Ensures the background-jobs schema exists, reusing a caller-held connection when
   * one is given rather than checking out its own.
   * @param {import("../database/drivers/base.js").default} [existingDb] - Reuse an
   *   already-checked-out connection (e.g. the one `db:migrate` holds) instead of
   *   checking out a nested one — the nested checkout would deadlock a database
   *   whose pool is capped at a single connection already held by the caller.
   * @returns {Promise<void>} - Resolves when the schema is present.
   */
  async _ensureSchema(existingDb) {
    await this._applySchema(existingDb)
  }

  /**
   * Serializes creation or upgrade of the background-jobs schema, checking out a
   * connection only after earlier schema work has completed when one is not supplied.
   * @param {import("../database/drivers/base.js").default} [existingDb] - Caller-owned
   *   database connection.
   * @returns {Promise<void>} - Resolves when the schema is present.
   */
  async _applySchema(existingDb) {
    // Serialize concurrent schema applies within this process, keyed by database
    // identifier (see `schemaApplyChains`). The per-step locks inside the steps use
    // DIFFERENT lock names, so two concurrent callers could otherwise each hold a
    // different step lock while both rebuild the jobs table — and on SQLite/MSSQL an
    // add-column is a create-copy-drop-rename rebuild, so overlapping rebuilds
    // corrupt it. This mutex makes the whole apply mutually exclusive per process;
    // the second caller then re-checks and finds every step already done.
    const identifier = this.getDatabaseIdentifier() ?? "default"
    const previous = schemaApplyChains.get(identifier) ?? Promise.resolve()
    const applyWithConnection = async () => {
      if (existingDb) {
        await this._applySchemaSteps(existingDb)

        return
      }

      await this._withDb((db) => this._applySchemaSteps(db))
    }
    const run = previous.then(applyWithConnection, applyWithConnection)

    // Keep the chain alive regardless of this run's outcome so one failed apply does
    // not wedge later callers; this run still propagates its own result/error.
    schemaApplyChains.set(identifier, run.then(() => {}, () => {}))

    return await run
  }

  /**
   * Creates or upgrades the background-jobs tables, columns and concurrency rows on
   * the given connection. Serialized per process by {@link BackgroundJobsStore#_applySchema}.
   * @param {import("../database/drivers/base.js").default} db - Database connection.
   * @returns {Promise<void>} - Resolves when the schema is present.
   */
  async _applySchemaSteps(db) {
    await this._ensureMigrationsTable(db)

    const alreadyApplied = await this._hasMigration(db)
    const schemaRecoveryPending = await this._hasMigration(db, SCHEMA_RECOVERY_PENDING_VERSION)
    const jobsTableExists = await db.tableExists(JOBS_TABLE)

    // Even when the migration row is present, the jobs table itself can have
    // been dropped underneath us by a transaction rollback in another caller
    // (DDL is transactional on SQLite/MSSQL). Verify the table physically
    // exists and recreate it when missing rather than trusting the migration
    // row alone, otherwise later callers fail with "no such table".
    if (alreadyApplied && jobsTableExists && !schemaRecoveryPending) {
      await this._ensureJobsTableColumns(db)
      await this._ensureIdempotencyKeysTable(db)
      await this._ensureMailDeliveryOperationsTable(db)
      await this._ensureScheduleKeysTable(db)
      await this._ensureConcurrencyTable(db)
      await this._ensureCountRevisionTable(db)

      return
    }

    if (alreadyApplied && !schemaRecoveryPending) {
      await this._recordMigration(db, SCHEMA_RECOVERY_PENDING_VERSION)
    }

    await this._applyMigrations(db)
    await this._ensureJobsTableColumns(db)
    await this._ensureIdempotencyKeysTable(db)
    await this._ensureMailDeliveryOperationsTable(db)
    await this._ensureScheduleKeysTable(db)
    await this._ensureConcurrencyTable(db)
    await this._ensureCountRevisionTable(db)

    if (alreadyApplied) {
      // The recreated jobs table is empty, but the surviving concurrency table
      // can still count handoffs that disappeared with the dropped jobs table.
      await this._reconcileConcurrency(db)
      await db.delete({
        tableName: MIGRATIONS_TABLE,
        conditions: {key: this._migrationKey(SCHEMA_RECOVERY_PENDING_VERSION)}
      })

      return
    }

    await this._recordMigration(db, MIGRATION_VERSION)
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
    table.string("execution_mode", {null: false})
    table.string("queue", {null: true, index: true})
    table.integer("max_retries", {null: false})
    table.integer("attempts", {null: false})
    table.string("status", {null: false, index: true})
    table.bigint("scheduled_at_ms", {null: false, index: true})
    table.bigint("created_at_ms", {null: false, index: true})
    table.string("schedule_key", {null: true, index: true})
    table.bigint("handed_off_at_ms", {null: true, index: true})
    table.string("handoff_id", {null: true})
    table.bigint("completed_at_ms", {null: true})
    table.bigint("failed_at_ms", {null: true})
    table.bigint("orphaned_at_ms", {null: true, index: true})
    table.string("worker_id", {null: true})
    table.text("last_error", {null: true})
    table.string("concurrency_key", {null: true, index: true})
    table.integer("max_concurrency", {null: true})
    table.bigint("timeout_ms", {null: true})

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
    await this._dropForkedColumnOnce(db)

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
    await this._ensureScheduleKeyColumn(db)
    await this._ensureJobTimeoutColumn(db)
    await this._ensureJobsTableIndexesOnce(db)
  }

  /**
   * Repairs secondary indexes that older add-column upgrades declared but did
   * not create on every SQL driver. The migration ledger keeps routine store
   * readiness from repeatedly introspecting the full index set.
   * @param {import("../database/drivers/base.js").default} db - Database connection.
   * @returns {Promise<void>} - Resolves when all expected indexes exist.
   */
  async _ensureJobsTableIndexesOnce(db) {
    const migrationVersion = JOBS_INDEX_REPAIR_MIGRATION_VERSION
    const migrationKey = this._migrationKey(migrationVersion)

    if (await this._hasMigration(db, migrationVersion)) return

    const acquired = await db.acquireAdvisoryLock(migrationKey)

    if (!acquired) throw new Error("Failed to acquire background jobs index repair lock")

    try {
      if (await this._hasMigration(db, migrationVersion)) return

      db.clearSchemaCache()
      const table = await db.getTableByNameOrFail(JOBS_TABLE)
      const indexedColumnNames = new Set(
        (await table.getIndexes())
          .filter((index) => !index.isPrimaryKey() && index.getColumnNames().length === 1)
          .map((index) => index.getColumnNames()[0])
      )

      for (const columnName of JOBS_INDEX_COLUMN_NAMES) {
        if (indexedColumnNames.has(columnName)) continue

        for (const sql of await db.createIndexSQLs({columns: [columnName], ifNotExists: db.getType() === "sqlite", tableName: JOBS_TABLE})) {
          await db.query(sql)
        }
      }

      db.clearSchemaCache()
      await this._recordMigration(db, migrationVersion)
    } finally {
      await db.releaseAdvisoryLock(migrationKey)
    }
  }

  /**
   * Idempotently adds the per-job wall-clock timeout to existing job tables.
   * @param {import("../database/drivers/base.js").default} db - Database connection.
   * @returns {Promise<void>} - Resolves when ensured.
   */
  async _ensureJobTimeoutColumn(db) {
    const lockName = `${MIGRATION_SCOPE}:timeout_ms_column`
    const acquired = await db.acquireAdvisoryLock(lockName)

    if (!acquired) throw new Error("Failed to acquire background jobs timeout schema lock")

    try {
      db.clearSchemaCache()
      const table = await db.getTableByNameOrFail(JOBS_TABLE)

      if (!(await table.getColumnByName("timeout_ms"))) {
        const tableData = new TableData(JOBS_TABLE)
        tableData.bigint("timeout_ms", {null: true})

        for (const sql of await db.alterTableSQLs(tableData)) await db.query(sql)

        db.clearSchemaCache()
      }
    } finally {
      await db.releaseAdvisoryLock(lockName)
    }
  }

  /**
   * Idempotently adds the historical stable schedule key to existing jobs.
   * @param {import("../database/drivers/base.js").default} db - Database connection.
   * @returns {Promise<void>} - Resolves when ensured.
   */
  async _ensureScheduleKeyColumn(db) {
    const lockName = `${MIGRATION_SCOPE}:schedule_key_column`
    const acquired = await db.acquireAdvisoryLock(lockName)

    if (!acquired) throw new Error("Failed to acquire background jobs schedule-key schema lock")

    try {
      db.clearSchemaCache()
      const lockedTable = await db.getTableByNameOrFail(JOBS_TABLE)

      if (!(await lockedTable.getColumnByName("schedule_key"))) {
        const tableData = new TableData(JOBS_TABLE)

        tableData.string("schedule_key", {null: true, index: true})

        for (const sql of await db.alterTableSQLs(tableData)) await db.query(sql)

        db.clearSchemaCache()
      }
    } finally {
      await db.releaseAdvisoryLock(lockName)
    }
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

      // A table created after the `forked` column was dropped has nothing to
      // backfill from; record the migration so it is not re-attempted.
      db.clearSchemaCache()
      if (!(await (await db.getTableByNameOrFail(JOBS_TABLE)).getColumnByName("forked"))) {
        await this._recordMigration(db, migrationVersion)
        return
      }

      const tableNameSql = db.quoteTable(JOBS_TABLE)
      const forkedColumnSql = db.quoteColumn("forked")
      const executionModeColumnSql = db.quoteColumn("execution_mode")

      await db.query(
        `UPDATE ${tableNameSql} SET ${executionModeColumnSql} = ${db.quote("forked")} ` +
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
   * Rewrites pre-existing pooled rows (persisted as `execution_mode = "forked"`
   * plus a `velocious-pooled:*` handoff marker) to `execution_mode = "pooled"`,
   * clears the queued marker, then drops the now-redundant `forked` column so
   * `execution_mode` is the single source of truth. Runs once, guarded by the
   * migration ledger and a per-key advisory lock; a fresh table (created without
   * the column) short-circuits.
   * @param {import("../database/drivers/base.js").default} db - Database connection.
   * @returns {Promise<void>} - Resolves when complete.
   */
  async _dropForkedColumnOnce(db) {
    const migrationVersion = DROP_FORKED_COLUMN_MIGRATION_VERSION
    const migrationKey = this._migrationKey(migrationVersion)

    if (await this._hasMigration(db, migrationVersion)) return

    await db.acquireAdvisoryLock(migrationKey)

    try {
      if (await this._hasMigration(db, migrationVersion)) return

      db.clearSchemaCache()

      if (await (await db.getTableByNameOrFail(JOBS_TABLE)).getColumnByName("forked")) {
        const tableNameSql = db.quoteTable(JOBS_TABLE)
        const executionModeColumnSql = db.quoteColumn("execution_mode")
        const handoffIdColumnSql = db.quoteColumn("handoff_id")

        // Pooled rows used to persist as execution_mode "forked" + a pooled handoff
        // marker; recover their real mode before the marker is cleared.
        await db.query(
          `UPDATE ${tableNameSql} SET ${executionModeColumnSql} = ${db.quote("pooled")} ` +
          `WHERE ${executionModeColumnSql} = ${db.quote("forked")} ` +
          `AND ${handoffIdColumnSql} LIKE ${db.quote(`${LEGACY_POOLED_HANDOFF_ID_PREFIX}%`)}`
        )
        // The queued-pooled marker was a sentinel, not a real lease; clear it.
        await db.query(
          `UPDATE ${tableNameSql} SET ${handoffIdColumnSql} = NULL ` +
          `WHERE ${handoffIdColumnSql} = ${db.quote(LEGACY_POOLED_QUEUED_HANDOFF_ID)}`
        )

        const dropForked = new TableData(JOBS_TABLE)
        dropForked.addColumn("forked", {dropColumn: true})
        for (const sql of await db.alterTableSQLs(dropForked)) await db.query(sql)

        db.clearSchemaCache()
      }

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
    if (BackgroundJobRecord.isInitialized()) return

    BackgroundJobRecord.setDatabaseIdentifier(this.getDatabaseIdentifier())
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
   * Releases ownership only when the key still points at the expected job.
   * @param {import("../database/drivers/base.js").default} db - Database connection.
   * @param {object} args - Ownership identity.
   * @param {string} args.jobId - Expected owner job id.
   * @param {string} args.scheduleKey - Stable schedule key.
   * @returns {Promise<void>} - Resolves when deleted or already superseded.
   */
  async _releaseScheduleOwnership(db, {jobId, scheduleKey}) {
    await db.delete({
      tableName: SCHEDULE_KEYS_TABLE,
      conditions: {job_id: jobId, schedule_key: scheduleKey}
    })
  }

  /**
   * Releases a job's ownership when it has a historical schedule key.
   * @param {import("../database/drivers/base.js").default} db - Database connection.
   * @param {import("./types.js").BackgroundJobRow} job - Terminal job.
   * @returns {Promise<void>} - Resolves when deleted or not applicable.
   */
  async _releaseScheduleOwnershipForJob(db, job) {
    if (!job.scheduleKey) return

    await this._releaseScheduleOwnership(db, {jobId: job.id, scheduleKey: job.scheduleKey})
  }

  /**
   * Runs apply failure.
   * @param {object} args - Options.
   * @param {import("../database/drivers/base.js").default} args.db - Database connection.
   * @param {import("./types.js").BackgroundJobRow} args.job - Job row.
   * @param {ReturnType<typeof JSON.parse>} args.error - Error.
   * @param {boolean} args.markOrphaned - Whether marking orphaned.
   * @param {Record<string, ReturnType<typeof JSON.parse>>} [args.conditions] - Update fencing conditions. Defaults to the active-handoff lease match; the time-based orphan sweep overrides this with an id/status match so it can reclaim rows whose `handoff_id` is null (e.g. handed off by an older velocious before handoff-id fencing existed).
   * @returns {Promise<import("./types.js").BackgroundJobRow | null>} - Updated job row when the lease transition won.
   */
  async _applyFailure({db, job, error, markOrphaned, conditions}) {
    const now = Date.now()
    const nextAttempt = (job.attempts || 0) + 1
    const maxRetries = this._normalizeMaxRetries(job.maxRetries)
    const shouldRetry = nextAttempt <= maxRetries
    const failureMessage = normalizeBackgroundJobError(error)
    const scheduledAt = shouldRetry ? now + this.getRetryDelayMs(nextAttempt) : job.scheduledAtMs
    const queuedConcurrency = shouldRetry ? await this._requeuedJobConcurrency(db, job) : null
    const update = this._failureUpdate({
      failureMessage,
      markOrphaned,
      nextAttempt,
      now,
      queuedConcurrency,
      scheduledAt,
      shouldRetry
    })

    await this._lockConcurrencyRow(db, job.concurrencyKey)
    const affectedRows = await this._updateAffectedRows(db, {
      tableName: JOBS_TABLE,
      data: update,
      conditions: conditions ?? this._activeHandoffConditions(job)
    })

    if (affectedRows !== 1) return null
    if (!shouldRetry) await this._releaseScheduleOwnershipForJob(db, job)
    await this._releaseConcurrency(db, job.concurrencyKey)

    // Return a snapshot of the transition this update just applied rather than re-reading the row.
    // We won the conditional update (affectedRows === 1), so this state is authoritative; re-reading
    // could instead observe a newer state if another dispatcher reclaims a requeued job between the
    // update and the read (overlapping mains / polling dispatch), which would misreport the
    // status/terminal/willRetry of this transition to failure/orphan event listeners.
    const status = shouldRetry ? "queued" : (markOrphaned ? "orphaned" : "failed")
    /** @type {import("./types.js").BackgroundJobRow} */
    const transitionedJob = {
      ...job,
      attempts: nextAttempt,
      handedOffAtMs: null,
      lastError: failureMessage,
      status,
      workerId: null
    }

    if (queuedConcurrency) {
      transitionedJob.concurrencyKey = queuedConcurrency.concurrencyKey
      transitionedJob.maxConcurrency = queuedConcurrency.maxConcurrency
    }
    if (markOrphaned) transitionedJob.orphanedAtMs = now
    if (shouldRetry) {
      transitionedJob.scheduledAtMs = scheduledAt
    } else if (!markOrphaned) {
      transitionedJob.failedAtMs = now
    }

    return transitionedJob
  }

  /**
   * Runs failure update.
   * @param {object} args - Options.
   * @param {string} args.failureMessage - Last failure message.
   * @param {boolean} args.markOrphaned - Whether marking orphaned.
   * @param {number} args.nextAttempt - Next attempt count.
   * @param {number} args.now - Current timestamp.
   * @param {BackgroundJobQueuedConcurrency | null} args.queuedConcurrency - Current queue policy for a retry.
   * @param {number | null} args.scheduledAt - Next scheduled timestamp.
   * @param {boolean} args.shouldRetry - Whether the job should retry.
   * @returns {Record<string, ReturnType<typeof JSON.parse>>} - Database update data.
   */
  _failureUpdate({failureMessage, markOrphaned, nextAttempt, now, queuedConcurrency, scheduledAt, shouldRetry}) {
    /**
     * Update.
     * @type {Record<string, ReturnType<typeof JSON.parse>>} */
    const update = {
      attempts: nextAttempt,
      handed_off_at_ms: null,
      worker_id: null,
      last_error: failureMessage
    }

    if (queuedConcurrency) {
      update.concurrency_key = queuedConcurrency.concurrencyKey
      update.max_concurrency = queuedConcurrency.maxConcurrency
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
   * @param {Record<string, ReturnType<typeof JSON.parse>>} args.update - Database update data.
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
   * @param {Record<string, ReturnType<typeof JSON.parse>>} args.update - Database update data.
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
   * @param {Record<string, ReturnType<typeof JSON.parse>>} row - Raw database row.
   * @returns {import("./types.js").BackgroundJobRow} - Normalized job row.
   */
  _normalizeJobRow(row) {
    const handoffId = row.handoff_id ? String(row.handoff_id) : null
    // `execution_mode` is the single source of truth for a job's runtime and is
    // written on every enqueue; the drop-forked migration backfills any pre-existing
    // rows before the legacy `forked` column is removed.
    const executionMode = row.execution_mode ? this._normalizeExecutionModeName(String(row.execution_mode)) : DEFAULT_BACKGROUND_JOB_EXECUTION_MODE

    return {
      id: String(row.id),
      jobName: String(row.job_name),
      args: this._parseArgs(row.args_json),
      executionMode,
      queue: row.queue ? String(row.queue) : DEFAULT_BACKGROUND_JOB_QUEUE,
      scheduleKey: row.schedule_key ? String(row.schedule_key) : null,
      status: row.status ? String(row.status) : "queued",
      attempts: this._normalizeNumber(row.attempts),
      maxRetries: this._normalizeNumber(row.max_retries),
      scheduledAtMs: this._normalizeNumber(row.scheduled_at_ms),
      createdAtMs: this._normalizeNumber(row.created_at_ms),
      handedOffAtMs: this._normalizeNumber(row.handed_off_at_ms),
      handoffId,
      completedAtMs: this._normalizeNumber(row.completed_at_ms),
      failedAtMs: this._normalizeNumber(row.failed_at_ms),
      orphanedAtMs: this._normalizeNumber(row.orphaned_at_ms),
      workerId: row.worker_id ? String(row.worker_id) : null,
      lastError: row.last_error ? String(row.last_error) : null,
      concurrencyKey: row.concurrency_key ? String(row.concurrency_key) : null,
      maxConcurrency: this._normalizeNumber(row.max_concurrency),
      timeoutMs: this._normalizeNumber(row.timeout_ms)
    }
  }

  /**
   * Normalizes a job's queue name, defaulting to "default".
   * @param {import("./types.js").BackgroundJobOptions | undefined} options - Job options.
   * @returns {string} - Queue name.
   */
  _normalizeQueue(options) {
    return normalizeBackgroundJobQueue(options)
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
    return normalizeBackgroundJobConcurrency({
      options: options || {},
      queue,
      queues: this.configuration.getBackgroundJobsConfig().queues
    })
  }

  /**
   * Resolves the current concurrency policy for a transition back to queued.
   * Explicit concurrency remains owned by the enqueue request; queue-derived
   * concurrency adopts the queue's current cap or removal.
   * @param {import("../database/drivers/base.js").default} db - Database connection.
   * @param {import("./types.js").BackgroundJobRow} job - Active handoff snapshot.
   * @returns {Promise<BackgroundJobQueuedConcurrency>} - Current queued concurrency.
   */
  async _requeuedJobConcurrency(db, job) {
    if (job.concurrencyKey && !job.concurrencyKey.startsWith(QUEUE_CONCURRENCY_KEY_PREFIX)) {
      return {concurrencyKey: job.concurrencyKey, maxConcurrency: job.maxConcurrency}
    }

    const concurrency = this._resolveConcurrency({}, job.queue)

    if (!concurrency) return {concurrencyKey: null, maxConcurrency: null}

    await this._ensureQueueConcurrencyKey(db, concurrency)

    return {concurrencyKey: concurrency.concurrencyKey, maxConcurrency: concurrency.maxConcurrency}
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
   * Ensures the stable schedule-key ownership table exists.
   * @param {import("../database/drivers/base.js").default} db - Database connection.
   * @returns {Promise<void>} - Resolves when ready.
   */
  async _ensureScheduleKeysTable(db) {
    if (await db.tableExists(SCHEDULE_KEYS_TABLE)) return

    const lockName = `${MIGRATION_SCOPE}:schedule_keys_table`
    const acquired = await db.acquireAdvisoryLock(lockName)

    if (!acquired) throw new Error("Failed to acquire background jobs schedule-key table schema lock")

    try {
      db.clearSchemaCache()
      if (await db.tableExists(SCHEDULE_KEYS_TABLE)) return

      const table = new TableData(SCHEDULE_KEYS_TABLE, {ifNotExists: true})

      table.string("schedule_key", {primaryKey: true})
      table.string("job_id", {null: false, index: true})
      await db.createTable(table)
      db.clearSchemaCache()
    } finally {
      await db.releaseAdvisoryLock(lockName)
    }
  }

  /**
   * Ensures durable generic enqueue ownership exists independently of job rows.
   * @param {import("../database/drivers/base.js").default} db - Database connection.
   * @returns {Promise<void>} - Resolves when ready.
   */
  async _ensureIdempotencyKeysTable(db) {
    if (await db.tableExists(IDEMPOTENCY_KEYS_TABLE)) return

    const lockName = `${MIGRATION_SCOPE}:idempotency_keys_table`
    const acquired = await db.acquireAdvisoryLock(lockName)

    if (!acquired) throw new Error("Failed to acquire background job idempotency-key table schema lock")

    try {
      db.clearSchemaCache()
      if (await db.tableExists(IDEMPOTENCY_KEYS_TABLE)) return

      const table = new TableData(IDEMPOTENCY_KEYS_TABLE, {ifNotExists: true})

      table.string("scope_digest", {primaryKey: true})
      table.string("job_name", {null: false})
      table.string("queue", {null: false})
      table.text("idempotency_key", {null: false})
      table.string("job_id", {index: true, null: false})
      table.string("request_digest", {null: false})
      table.bigint("created_at_ms", {null: false})
      await db.createTable(table)
      db.clearSchemaCache()
    } finally {
      await db.releaseAdvisoryLock(lockName)
    }
  }

  /**
   * Ensures durable provider-backed mail operation state exists independently of jobs.
   * @param {import("../database/drivers/base.js").default} db - Database connection.
   * @returns {Promise<void>} - Resolves when ready.
   */
  async _ensureMailDeliveryOperationsTable(db) {
    if (await db.tableExists(MAIL_DELIVERY_OPERATIONS_TABLE)) return

    const lockName = `${MIGRATION_SCOPE}:mail_delivery_operations_table`
    const acquired = await db.acquireAdvisoryLock(lockName)

    if (!acquired) throw new Error("Failed to acquire mail delivery operation table schema lock")

    try {
      db.clearSchemaCache()
      if (await db.tableExists(MAIL_DELIVERY_OPERATIONS_TABLE)) return

      const table = new TableData(MAIL_DELIVERY_OPERATIONS_TABLE, {ifNotExists: true})

      table.string("operation_key", {primaryKey: true})
      table.text("operation_id", {null: false})
      table.string("payload_digest", {null: false})
      table.string("background_job_id", {index: true, null: false})
      table.bigint("first_attempt_started_at_ms", {null: true})
      table.string("provider_kind", {null: false})
      table.bigint("provider_retention_ms", {null: false})
      table.bigint("created_at_ms", {null: false})
      await db.createTable(table)
      db.clearSchemaCache()
    } finally {
      await db.releaseAdvisoryLock(lockName)
    }
  }

  /**
   * Ensures the singleton durable count-revision row exists.
   * @param {import("../database/drivers/base.js").default} db - Database connection.
   * @returns {Promise<void>} Resolves when ready.
   */
  async _ensureCountRevisionTable(db) {
    if (!(await db.tableExists(COUNTS_REVISION_TABLE))) {
      const table = new TableData(COUNTS_REVISION_TABLE, {ifNotExists: true})

      table.string("key", {primaryKey: true})
      table.bigint("revision", {null: false})
      await db.createTable(table)
    }

    const rows = await db.newQuery().from(COUNTS_REVISION_TABLE).where({key: COUNTS_REVISION_KEY}).limit(1).results()

    if (rows.length > 0) return

    try {
      await db.insert({tableName: COUNTS_REVISION_TABLE, data: {key: COUNTS_REVISION_KEY, revision: 0}})
    } catch (error) {
      const racedRows = await db.newQuery().from(COUNTS_REVISION_TABLE).where({key: COUNTS_REVISION_KEY}).limit(1).results()

      if (racedRows.length === 0) throw error
    }
  }

  /**
   * Records one logical count mutation atomically and broadcasts it after commit.
   * Zero entries are omitted; a wholly zero-net mutation does not consume a revision.
   * @param {import("../database/drivers/base.js").default} db - Transaction connection.
   * @param {Record<string, number>} requestedDeltas - Signed bucket changes.
   * @returns {Promise<void>} Resolves when recorded.
   */
  async _recordCountDelta(db, requestedDeltas) {
    /** @type {Record<string, number>} */
    const deltas = {}

    for (const bucket of BACKGROUND_JOB_COUNT_BUCKETS) {
      const amount = requestedDeltas[bucket] || 0

      if (!Number.isInteger(amount)) throw new Error(`Invalid background job count delta for ${bucket}: ${amount}`)
      if (amount !== 0) deltas[bucket] = amount
    }

    if (Object.keys(deltas).length === 0) return

    const table = db.quoteTable(COUNTS_REVISION_TABLE)
    const revisionColumn = db.quoteColumn("revision")
    const affectedRows = await db.affectedRows(
      `UPDATE ${table} SET ${revisionColumn} = ${revisionColumn} + 1 WHERE ${db.quoteColumn("key")} = ${db.quote(COUNTS_REVISION_KEY)}`
    )

    if (affectedRows !== 1) throw new Error("Background job count revision row is missing")

    const revision = await this._countRevision(db)
    const body = {deltas, revision, type: "background-job-count-delta"}
    const databaseIdentifier = this.getDatabaseIdentifier() || "default"

    await db.afterCommit(() => {
      this.configuration.broadcastToChannel(BACKGROUND_JOB_COUNTS_CHANNEL, {databaseIdentifier}, body)
    })
  }

  /**
   * Records a transition between persisted statuses.
   * @param {import("../database/drivers/base.js").default} db - Transaction connection.
   * @param {string} oldStatus - Previous status.
   * @param {string} newStatus - New status.
   * @returns {Promise<void>} Resolves when recorded.
   */
  async _recordStatusTransition(db, oldStatus, newStatus) {
    const oldCounted = COUNTED_JOB_STATUSES.includes(oldStatus)
    const newCounted = COUNTED_JOB_STATUSES.includes(newStatus)

    if (!oldCounted && oldStatus !== "cancelled") throw new Error(`Unknown previous background job status: ${oldStatus}`)
    if (!newCounted && newStatus !== "cancelled") throw new Error(`Unknown next background job status: ${newStatus}`)
    if (oldStatus === newStatus) return

    /** @type {Record<string, number>} */
    const deltas = {}

    if (oldCounted) deltas[oldStatus] = -1
    if (newCounted) deltas[newStatus] = 1
    if (oldCounted !== newCounted) deltas.all = newCounted ? 1 : -1
    await this._recordCountDelta(db, deltas)
  }

  /**
   * Reads the locked revision.
   * @param {import("../database/drivers/base.js").default} db - Database connection.
   * @returns {Promise<number>} Revision.
   */
  async _countRevision(db) {
    const rows = await db.newQuery().from(COUNTS_REVISION_TABLE).select("revision").where({key: COUNTS_REVISION_KEY}).limit(1).results()
    const revision = this._normalizeNumber(/** @type {Record<string, ReturnType<typeof JSON.parse>>} */ (rows[0] || {}).revision)

    if (revision === null || !Number.isSafeInteger(revision) || revision < 0) {
      throw new Error(`Invalid background job count revision: ${revision}`)
    }

    return revision
  }

  /**
   * Takes a portable write lock on the singleton revision row.
   * @param {import("../database/drivers/base.js").default} db - Database connection.
   * @returns {Promise<void>} Resolves when locked.
   */
  async _lockCountRevision(db) {
    const table = db.quoteTable(COUNTS_REVISION_TABLE)
    const revision = db.quoteColumn("revision")

    await db.query(`UPDATE ${table} SET ${revision} = ${revision} WHERE ${db.quoteColumn("key")} = ${db.quote(COUNTS_REVISION_KEY)}`)
  }

  /**
   * Builds zeroed canonical buckets.
   * @returns {Record<string, number>} Zeroed canonical buckets.
   */
  _emptyCountBuckets() {
    return Object.fromEntries(BACKGROUND_JOB_COUNT_BUCKETS.map((bucket) => [bucket, 0]))
  }

  /**
   * Counts normalized rows by canonical status.
   * @param {import("./types.js").BackgroundJobRow[]} jobs - Jobs.
   * @returns {Record<string, number>} Counts.
   */
  _statusCounts(jobs) {
    /** @type {Record<string, number>} */
    const counts = {}

    for (const job of jobs) {
      if (!COUNTED_JOB_STATUSES.includes(job.status)) throw new Error(`Unknown background job status: ${job.status}`)
      counts[job.status] = (counts[job.status] || 0) + 1
    }

    return counts
  }

  /**
   * Reads a canonical snapshot after locking the revision row.
   * @param {import("../database/drivers/base.js").default} db - Transaction connection.
   * @returns {Promise<{counts: Record<string, number>, revision: number, total: number}>} Snapshot.
   */
  async _countSnapshotOnLockedConnection(db) {
    const rows = await db.newQuery().from(JOBS_TABLE).select("status").select("COUNT(*) AS count").group("status").results()
    const counts = this._emptyCountBuckets()
    let total = 0

    for (const row of rows) {
      const typedRow = /** @type {Record<string, ReturnType<typeof JSON.parse>>} */ (row)
      const status = String(typedRow.status)
      const count = this._normalizeNumber(typedRow.count) || 0

      total += count

      if (!COUNTED_JOB_STATUSES.includes(status)) continue
      counts[status] = count
      counts.all += counts[status]
    }

    return {counts, revision: await this._countRevision(db), total}
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
   * Locks the concurrency counter row so a job-release transaction acquires it *before* the job
   * row. {@link markHandedOff} reserves capacity (locking the counter row) before it updates the
   * job, so it locks concurrency-then-job; the release paths update the job before releasing
   * capacity, which is job-then-concurrency. Those opposite orders on the same shared counter row
   * are what deadlock (AB-BA) under a draining worker. Taking this lock first gives every
   * transaction a single concurrency-then-job order and removes the cycle.
   *
   * Uses a value-preserving `UPDATE` rather than `SELECT ... FOR UPDATE` so it stays portable
   * across drivers without row-level locking reads (e.g. SQLite); on row-locking engines the
   * matched row is write-locked for the rest of the transaction even though its value is unchanged.
   * @param {import("../database/drivers/base.js").default} db - Database connection.
   * @param {string | null} concurrencyKey - Concurrency key.
   * @returns {Promise<void>} - Resolves when the counter row is locked.
   */
  async _lockConcurrencyRow(db, concurrencyKey) {
    if (!concurrencyKey) return
    const table = db.quoteTable(CONCURRENCY_TABLE)
    const count = db.quoteColumn("active_count")
    await db.query(`UPDATE ${table} SET ${count} = ${count} WHERE ${db.quoteColumn("concurrency_key")} = ${db.quote(concurrencyKey)}`)
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
   * Rebuilds durable counts from active handoffs.
   * @param {import("../database/drivers/base.js").default} db - Database connection.
   * @param {{insideTransaction?: boolean}} [options] - Reuse an enclosing transaction.
   * @returns {Promise<import("./types.js").BackgroundJobConcurrencyReconciliation>} - Repair summary.
   */
  async _reconcileConcurrency(db, {insideTransaction = false} = {}) {
    if (!(await db.tableExists(CONCURRENCY_TABLE))) {
      return {candidateCount: 0, checkedCount: 0, repairedCount: 0, repairs: [], repairsTruncatedCount: 0}
    }

    const activeRows = await db
      .newQuery()
      .from(JOBS_TABLE)
      .select("concurrency_key")
      .select("COUNT(*) AS active_count")
      .where({status: "handed_off"})
      .where(`${db.quoteColumn("concurrency_key")} IS NOT NULL`)
      .group("concurrency_key")
      .results()
    const staleRows = await db
      .newQuery()
      .from(CONCURRENCY_TABLE)
      .select("concurrency_key")
      .select("active_count")
      .where(`${db.quoteColumn("active_count")} != 0`)
      .results()
    /** @type {Map<string, number>} */
    const activeCounts = new Map()
    /** @type {Map<string, number>} */
    const persistedCounts = new Map()

    for (const rawRow of activeRows) {
      const row = /** @type {BackgroundJobConcurrencyCountRow} */ (rawRow)
      activeCounts.set(row.concurrency_key, this._validatedConcurrencyCount(row.active_count, row.concurrency_key))
    }

    for (const rawRow of staleRows) {
      const row = /** @type {BackgroundJobConcurrencyCountRow} */ (rawRow)
      persistedCounts.set(row.concurrency_key, this._validatedConcurrencyCount(row.active_count, row.concurrency_key))
    }

    const concurrencyKeys = [...new Set([...activeCounts.keys(), ...persistedCounts.keys()])].sort()
    const candidateKeys = concurrencyKeys.filter((concurrencyKey) => {
      return (activeCounts.get(concurrencyKey) || 0) !== (persistedCounts.get(concurrencyKey) || 0)
    })
    /** @type {import("./types.js").BackgroundJobConcurrencyRepair[]} */
    const repairs = []
    let repairedCount = 0

    for (const concurrencyKey of candidateKeys) {
      const repair = insideTransaction
        ? await this._reconcileConcurrencyKey(db, concurrencyKey)
        : await this._transactionResult(db, async () => await this._reconcileConcurrencyKey(db, concurrencyKey))

      if (!repair) continue

      repairedCount++
      if (repairs.length < CONCURRENCY_REPAIR_SAMPLE_LIMIT) repairs.push(repair)
    }

    return {
      candidateCount: candidateKeys.length,
      checkedCount: concurrencyKeys.length,
      repairedCount,
      repairs,
      repairsTruncatedCount: repairedCount - repairs.length
    }
  }

  /**
   * Rebuilds one counter after locking it ahead of the job rows, matching the
   * lock order used by handoff and completion transitions.
   * @param {import("../database/drivers/base.js").default} db - Database connection.
   * @param {string} concurrencyKey - Counter key.
   * @returns {Promise<import("./types.js").BackgroundJobConcurrencyRepair | null>} - Applied repair.
   */
  async _reconcileConcurrencyKey(db, concurrencyKey) {
    await this._lockConcurrencyRow(db, concurrencyKey)
    const persistedRows = await db
      .newQuery()
      .from(CONCURRENCY_TABLE)
      .select("active_count")
      .select("concurrency_key")
      .where({concurrency_key: concurrencyKey})
      .limit(1)
      .results()

    if (!persistedRows[0]) throw new Error(`Missing background job concurrency counter for ${concurrencyKey}`)

    const persistedRow = /** @type {BackgroundJobConcurrencyCountRow} */ (persistedRows[0])
    const previousActiveCount = this._validatedConcurrencyCount(persistedRow.active_count, concurrencyKey)
    const rows = await db
      .newQuery()
      .from(JOBS_TABLE)
      .select("COUNT(*) AS active_count")
      .where({concurrency_key: concurrencyKey, status: "handed_off"})
      .results()
    const countRow = /** @type {{active_count: number | string}} */ (rows[0])
    const activeCount = this._validatedConcurrencyCount(countRow.active_count, concurrencyKey)

    if (activeCount === previousActiveCount) return null

    await db.update({
      tableName: CONCURRENCY_TABLE,
      data: {active_count: activeCount},
      conditions: {concurrency_key: concurrencyKey}
    })

    return {activeCount, concurrencyKey, previousActiveCount}
  }

  /**
   * Validates a database count before it participates in reconciliation.
   * @param {number | string} value - Raw count.
   * @param {string} concurrencyKey - Counter key for diagnostics.
   * @returns {number} - Safe non-negative count.
   */
  _validatedConcurrencyCount(value, concurrencyKey) {
    const count = this._normalizeNumber(value)

    if (count === null || !Number.isSafeInteger(count) || count < 0) {
      throw new Error(`Invalid reconciled background job concurrency count for ${concurrencyKey}: ${count}`)
    }

    return count
  }

  /**
   * Reconciles queue-derived concurrency with the current configuration. Only
   * invoked through {@link reconcileQueueConcurrency} — the explicit lifecycle
   * path run at main-process startup under a cross-process advisory lock —
   * never from schema/tenant checks or routine connection initialization,
   * which stay read-only regarding queued job rows. The per-process memo is
   * latched by {@link reconcileQueueConcurrency} only after the following
   * count rebuild also succeeds, so a failed rebuild re-enters here on retry
   * (the adoption UPDATEs below are idempotent). Enqueue only consults config for new jobs, so a cap added, removed, or changed
   * while a backlog exists otherwise leaves persisted rows stale: pre-cap jobs
   * keep a null key and bypass the cap, post-removal jobs stay capped under a
   * now-unconfigured key, and a changed numeric cap stays stale until the next
   * enqueue. Bring queued durable state in line with config: sync each configured
   * queue's stored cap, adopt not-yet-keyed queued jobs onto their queue key,
   * and release queued jobs from queue keys whose queue is no longer capped.
   * Existing handoffs retain the policy and reservation they started with, so
   * reconciliation cannot race their completion/retry transitions. Runs before
   * {@link _reconcileConcurrency} so any pre-existing active counts are exact.
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
    const queued = `${db.quoteColumn("status")} = ${db.quote("queued")}`
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
        `WHERE ${queueColumn} = ${db.quote(queue)} AND ${keyColumn} IS NULL AND ${queued}`
      )
    }

    const concurrencyRows = await db
      .newQuery()
      .from(CONCURRENCY_TABLE)
      .select("concurrency_key")
      .where(`${db.quoteColumn("concurrency_key")} LIKE ${db.quote(`${QUEUE_CONCURRENCY_KEY_PREFIX}%`)}`)
      .results()

    for (const row of concurrencyRows) {
      const concurrencyKey = String(/** @type {Record<string, ReturnType<typeof JSON.parse>>} */ (row).concurrency_key)

      if (!concurrencyKey.startsWith(QUEUE_CONCURRENCY_KEY_PREFIX)) continue
      if (cappedQueues.has(concurrencyKey.slice(QUEUE_CONCURRENCY_KEY_PREFIX.length))) continue

      await db.query(
        `UPDATE ${jobsTable} SET ${keyColumn} = NULL, ${capColumn} = NULL ` +
        `WHERE ${keyColumn} = ${db.quote(concurrencyKey)} AND ${queued}`
      )
    }
  }

  /**
   * Runs normalize number.
   * @param {ReturnType<typeof JSON.parse>} value - Input value.
   * @returns {number | null} - Normalized number.
   */
  _normalizeNumber(value) {
    if (value === null || value === undefined || value === "") return null

    const numeric = Number(value)

    if (Number.isNaN(numeric)) return null

    return numeric
  }

  /**
   * Runs normalize execution mode.
   * @param {import("./types.js").BackgroundJobOptions} [options] - Job options.
   * @returns {import("./types.js").BackgroundJobExecutionMode} - Normalized execution mode.
   */
  _normalizeExecutionMode(options) {
    return normalizeBackgroundJobExecutionMode(options || {}, DEFAULT_BACKGROUND_JOB_EXECUTION_MODE)
  }

  /**
   * Runs normalize execution mode name.
   * @param {string} executionMode - Execution mode name.
   * @returns {import("./types.js").BackgroundJobExecutionMode} - Normalized execution mode.
   */
  _normalizeExecutionModeName(executionMode) {
    return normalizeBackgroundJobExecutionMode(
      {executionMode: /** @type {import("./types.js").BackgroundJobExecutionMode} */ (executionMode)},
      DEFAULT_BACKGROUND_JOB_EXECUTION_MODE,
      BACKGROUND_JOB_EXECUTION_MODES
    )
  }

  /**
   * Filters queued jobs by one or more execution modes against the
   * `execution_mode` column (the single source of truth).
   * @param {object} args - Options.
   * @param {import("../database/drivers/base.js").default} args.db - Database connection.
   * @param {import("./types.js").BackgroundJobExecutionMode | import("./types.js").BackgroundJobExecutionMode[]} args.executionMode - Runtime modes.
   * @param {import("../database/query/index.js").default} args.query - Query to filter.
   * @returns {import("../database/query/index.js").default} - Filtered query.
   */
  _whereExecutionMode({db, executionMode, query}) {
    const executionModes = Array.isArray(executionMode) ? executionMode : [executionMode]
    const executionModeColumn = db.quoteColumn("execution_mode")
    const conditions = executionModes.map((mode) => `${executionModeColumn} = ${db.quote(mode)}`)

    return query.where(`(${conditions.join(" OR ")})`)
  }

  /**
   * Runs parse args.
   * @param {ReturnType<typeof JSON.parse>} value - Input value.
   * @returns {Array<ReturnType<typeof JSON.parse>>} - Parsed args.
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
    const databaseIdentifier = this.getDatabaseIdentifier()
    const pool = this.configuration.getDatabasePool(databaseIdentifier)

    if (!pool.testSharedConnection()) {
      return await pool.withConnection({name: "Background jobs store"}, callback)
    }

    return await this.configuration.runWithTestSharedConnectionContexts(async () => {
      return await this.configuration.ensureConnections({databaseIdentifiers: [databaseIdentifier], name: "Background jobs store"}, async (dbs) => {
        const connection = dbs[databaseIdentifier]
        return await coordinateSharedTransactionConnection(connection, async () => await callback(connection))
      })
    })
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
   * Serializes count-changing transactions before checking out their connection.
   * Database row locking still provides cross-process ordering; this guard
   * prevents concurrent callers on SQLite's shared connection from attempting
   * overlapping top-level transactions.
   * @template T
   * @param {(db: import("../database/drivers/base.js").default) => Promise<T>} callback - Transaction callback.
   * @param {BackgroundJobTransactionSerializationOptions} [options] - Serialization options.
   * @returns {Promise<T>} Callback result.
   */
  async _serializedCountMutation(callback, options = {}) {
    return await this._serializedTransactionMutation(async (db) => {
      await this._lockCountRevision(db)

      return await callback(db)
    }, options)
  }

  /**
   * Admits transactions to the process-local FIFO before they check out a
   * connection. Cross-process ordering remains the responsibility of durable
   * row/advisory locks and unique constraints acquired around the callback.
   * @template T
   * @param {(db: import("../database/drivers/base.js").default) => Promise<T>} callback - Transaction callback.
   * @param {BackgroundJobTransactionSerializationOptions} [options] - Serialization options.
   * @returns {Promise<T>} Callback result.
   */
  async _serializedTransactionMutation(callback, options = {}) {
    const identifier = this.getDatabaseIdentifier() || "default"
    const previous = transactionMutationChains.get(identifier) || Promise.resolve()
    let resolveRun = () => {}
    /** @type {Promise<void>} */
    const run = new Promise((resolve) => {
      resolveRun = () => resolve(undefined)
    })
    const chain = previous.then(() => run)

    transactionMutationChains.set(identifier, chain)
    await previous

    try {
      return await this._withDb(async (db) => {
        const {advisoryLock} = options

        if (advisoryLock) {
          const acquired = await db.acquireAdvisoryLock(advisoryLock.name)

          if (!acquired) throw new Error(advisoryLock.failureMessage)
        }

        try {
          return await this._transactionResult(db, async () => await callback(db))
        } finally {
          if (advisoryLock) await db.releaseAdvisoryLock(advisoryLock.name)
        }
      })
    } finally {
      resolveRun()
      if (transactionMutationChains.get(identifier) === chain) transactionMutationChains.delete(identifier)
    }
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
