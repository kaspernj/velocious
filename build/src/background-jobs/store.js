// @ts-check
import { createHash, randomUUID } from "crypto";
import BackgroundJobsAdapter from "./adapter.js";
import Logger from "../logger.js";
import TableData from "../database/table-data/index.js";
import VelociousError from "../velocious-error.js";
import BackgroundJobRecord from "./job-record.js";
import normalizeBackgroundJobError from "./normalize-error.js";
import { coordinateSharedTransactionConnection } from "../testing/shared-transaction-connection-coordinator.js";
import stableJsonStringify from "../utils/stable-json.js";
import { BACKGROUND_JOB_EXECUTION_MODES, DEFAULT_BACKGROUND_JOB_EXECUTION_MODE, DEFAULT_BACKGROUND_JOB_QUEUE, QUEUE_CONCURRENCY_KEY_PREFIX, normalizeBackgroundJobConcurrency, normalizeBackgroundJobExecutionMode, normalizeBackgroundJobMaxRetries, normalizeBackgroundJobQueue, normalizeBackgroundJobScheduledAtMs, rescheduledBackgroundJobAtMs, retryDelayMs } from "./job-semantics.js";
import { MAIL_DELIVERY_OPERATIONS_TABLE, mailDeliveryOperationForJob, mailDeliveryOperationKey } from "../mailer/delivery-operation.js";
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
const MIGRATIONS_TABLE = "velocious_internal_migrations";
const MIGRATION_SCOPE = "background_jobs";
const MIGRATION_VERSION = "20250215000000";
const SCHEMA_RECOVERY_PENDING_VERSION = "schema-recovery-pending";
const EXECUTION_MODE_BACKFILL_MIGRATION_VERSION = "20260607131010";
// Drops the redundant legacy `forked` boolean column and rewrites pooled rows to
// persist `execution_mode = "pooled"` directly (retiring the pooled-as-forked
// handoff-marker workaround), leaving `execution_mode` as the single source of
// truth for a job's runtime.
const DROP_FORKED_COLUMN_MIGRATION_VERSION = "20260719000000";
const JOBS_INDEX_REPAIR_MIGRATION_VERSION = "20260903120000";
// Legacy marker prefix used by rows written before this migration: pooled jobs
// used to persist as `execution_mode = "forked"` plus a `velocious-pooled:*`
// handoff id. Retained only to detect and convert those rows in the migration.
const LEGACY_POOLED_HANDOFF_ID_PREFIX = "velocious-pooled:";
const LEGACY_POOLED_QUEUED_HANDOFF_ID = `${LEGACY_POOLED_HANDOFF_ID_PREFIX}queued`;
const JOBS_TABLE = "background_jobs";
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
];
const IDEMPOTENCY_KEYS_TABLE = "background_job_idempotency_keys";
const SCHEDULE_KEYS_TABLE = "background_job_schedule_keys";
const CONCURRENCY_TABLE = "background_job_concurrency";
const COUNTS_REVISION_TABLE = "background_job_count_revisions";
const COUNTS_REVISION_KEY = "counts";
const CONCURRENCY_RECONCILIATION_LOCK = "background-jobs:queue-concurrency-reconcile";
const CONCURRENCY_REPAIR_SAMPLE_LIMIT = 10;
export const BACKGROUND_JOB_COUNTS_CHANNEL = "velocious-background-job-counts";
export const BACKGROUND_JOB_COUNT_BUCKETS = ["all", "queued", "handed_off", "completed", "failed", "orphaned"];
const COUNTED_JOB_STATUSES = BACKGROUND_JOB_COUNT_BUCKETS.slice(1);
const MAX_JOB_TIMEOUT_MS = 2_147_483_647;
const JOB_TIMEOUT_VALIDATION_MESSAGE = `background job timeoutMs must be a finite non-positive number or an integer between 1 and ${MAX_JOB_TIMEOUT_MS}`;
const ORPHANED_AFTER_MS = 2 * 60 * 60 * 1000;
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
};
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
const schemaApplyChains = new Map();
/** @type {Map<string, Promise<void>>} */
const transactionMutationChains = new Map();
export default class BackgroundJobsStore extends BackgroundJobsAdapter {
    /**
     * Runs constructor.
     * @param {object} args - Options.
     * @param {import("../configuration.js").default} args.configuration - Configuration.
     * @param {string} [args.databaseIdentifier] - Database identifier.
     */
    constructor({ configuration, databaseIdentifier }) {
        super();
        this.configuration = configuration;
        this.databaseIdentifier = databaseIdentifier;
        this.logger = new Logger(this);
        this._readyPromise = null;
        this._queueConcurrencyReconciled = false;
    }
    /**
     * Runs get database identifier.
     * @returns {string} - Database identifier.
     */
    getDatabaseIdentifier() {
        if (this.databaseIdentifier)
            return this.databaseIdentifier;
        return this.configuration.getBackgroundJobsConfig().databaseIdentifier;
    }
    /**
     * Runs ensure ready.
     * @returns {Promise<void>} - Resolves when ready.
     */
    async ensureReady() {
        if (this._readyPromise)
            return await this._readyPromise;
        this._readyPromise = (async () => {
            this.configuration.setCurrent();
            await this._ensureSchema();
            await this._initializeModel();
        })();
        try {
            await this._readyPromise;
        }
        finally {
            this._readyPromise = null;
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
        if (!db)
            this.configuration.setCurrent();
        await this._ensureSchema(db);
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
        if (this._queueConcurrencyReconciled)
            return;
        const databaseIdentifier = this.getDatabaseIdentifier();
        const startedAtMs = Date.now();
        await this.logger.info(() => [
            "Starting background jobs queue-concurrency startup reconciliation",
            { databaseIdentifier }
        ]);
        await this.ensureReady();
        await this._withDb(async (db) => {
            const acquired = await db.acquireAdvisoryLock(CONCURRENCY_RECONCILIATION_LOCK);
            if (!acquired)
                throw new Error("Failed to acquire background job queue-concurrency reconcile lock");
            try {
                await this._reconcileQueueConcurrency(db);
                await this._reconcileConcurrency(db);
                // Latch the memo only after BOTH steps succeed: if the count rebuild
                // fails after adoption, a retry on this store must re-enter and repair
                // the counts (adoption itself is idempotent).
                this._queueConcurrencyReconciled = true;
            }
            finally {
                await db.releaseAdvisoryLock(CONCURRENCY_RECONCILIATION_LOCK);
            }
        });
        await this.logger.info(() => [
            "Completed background jobs queue-concurrency startup reconciliation",
            { databaseIdentifier, durationMs: Date.now() - startedAtMs }
        ]);
    }
    /**
     * Repairs durable active-count drift while a main process remains live. The
     * initial snapshot is read-only; only suspected mismatches take their
     * counter lock and re-count inside the serialized transaction path.
     * @returns {Promise<import("./types.js").BackgroundJobConcurrencyReconciliation>} - Repair summary.
     */
    async reconcileActiveConcurrency() {
        const databaseIdentifier = this.getDatabaseIdentifier();
        const startedAtMs = Date.now();
        await this.ensureReady();
        const result = await this._serializedTransactionMutation(async (db) => await this._reconcileConcurrency(db, { insideTransaction: true }), {
            advisoryLock: {
                failureMessage: "Failed to acquire background job active-concurrency reconcile lock",
                name: CONCURRENCY_RECONCILIATION_LOCK
            }
        });
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
            ]);
        }
        return result;
    }
    /**
     * Runs enqueue.
     * @param {object} args - Options.
     * @param {string} args.jobName - Job name.
     * @param {Array<ReturnType<typeof JSON.parse>>} args.args - Arguments.
     * @param {import("./types.js").BackgroundJobOptions} [args.options] - Options.
     * @returns {Promise<string>} - Job id.
     */
    async enqueue({ jobName, args, options }) {
        await this.ensureReady();
        const preparedJob = this._prepareJob({ jobName, args, options });
        if (options?.idempotencyKey !== undefined) {
            return await this._enqueueIdempotently({ args: args || [], options, preparedJob });
        }
        /** @type {string} */
        let resultJobId = preparedJob.jobId;
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
                    .where({ status: "queued", job_name: jobName, args_json: preparedJob.argsJson, queue: preparedJob.queue })
                    .where(`scheduled_at_ms <= ${db.quote(preparedJob.scheduledAtMs)}`)
                    .order("scheduled_at_ms ASC")
                    .limit(1)
                    .results();
                if (existing[0]) {
                    resultJobId = String(/** @type {Record<string, ReturnType<typeof JSON.parse>>} */ (existing[0]).id);
                    return;
                }
            }
            await this._insertPreparedJob(db, { preparedJob, scheduleKey: null });
            await this._recordCountDelta(db, { all: 1, queued: 1 });
        });
        return resultJobId;
    }
    /**
     * Atomically owns one durable idempotency scope and creates its job exactly once.
     * @param {object} args - Enqueue input.
     * @param {Array<ReturnType<typeof JSON.parse>>} args.args - Job arguments.
     * @param {import("./types.js").BackgroundJobOptions} args.options - Job options.
     * @param {PreparedBackgroundJob} args.preparedJob - Normalized job.
     * @returns {Promise<string>} - Stable original job id.
     */
    async _enqueueIdempotently({ args, options, preparedJob }) {
        const idempotencyKey = this._normalizeIdempotencyKey(options.idempotencyKey);
        const scopeDigest = this._idempotencyScopeDigest({ idempotencyKey, jobName: preparedJob.jobName, queue: preparedJob.queue });
        const requestDigest = this._idempotencyRequestDigest({ args, options, preparedJob });
        const ownership = {
            created_at_ms: preparedJob.createdAtMs,
            idempotency_key: idempotencyKey,
            job_id: preparedJob.jobId,
            job_name: preparedJob.jobName,
            queue: preparedJob.queue,
            request_digest: requestDigest,
            scope_digest: scopeDigest
        };
        const mailOperationInput = mailDeliveryOperationForJob(preparedJob.jobName, args);
        if (mailOperationInput && mailOperationInput.operation.id !== idempotencyKey) {
            throw VelociousError.safe("Mail delivery operation id must equal its background job idempotency key.", {
                code: "mail-delivery-idempotency-key-mismatch"
            });
        }
        // Reuse ordinary enqueue transaction admission because this path changes
        // the same durable count revision. The scope primary key remains the
        // cross-process convergence owner.
        return await this._idempotentEnqueueTransaction(async (db) => {
            const existing = await this._idempotencyOwnership(db, scopeDigest);
            if (existing) {
                this._validateIdempotencyOwnership({ existing, ownership });
                await this._validateMailDeliveryOperation(db, { jobId: String(existing.job_id), mailOperationInput });
                return String(existing.job_id);
            }
            const claimed = await this._claimIdempotencyOwnership(db, ownership);
            if (!claimed.created) {
                this._validateIdempotencyOwnership({ existing: claimed.row, ownership });
                await this._validateMailDeliveryOperation(db, { jobId: String(claimed.row.job_id), mailOperationInput });
                return String(claimed.row.job_id);
            }
            await this._lockCountRevision(db);
            await this._insertPreparedJob(db, { preparedJob, scheduleKey: null });
            await this._persistMailDeliveryOperation(db, { jobId: preparedJob.jobId, mailOperationInput, createdAtMs: preparedJob.createdAtMs });
            await this._recordCountDelta(db, { all: 1, queued: 1 });
            return preparedJob.jobId;
        });
    }
    /**
     * Serializes one physical connection locally without taking ownership away
     * from the database uniqueness constraint shared by all processes.
     * @template T
     * @param {(db: import("../database/drivers/base.js").default) => Promise<T>} callback - Transaction work.
     * @returns {Promise<T>} - Callback result.
     */
    async _idempotentEnqueueTransaction(callback) {
        return await this._serializedTransactionMutation(callback);
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
                await db.insert({ tableName: IDEMPOTENCY_KEYS_TABLE, data: ownership });
            });
            return { created: true, row: ownership };
        }
        catch (error) {
            const raced = await this._idempotencyOwnership(db, String(ownership.scope_digest));
            if (!raced)
                throw error;
            return { created: false, row: raced };
        }
    }
    /**
     * Loads one durable enqueue owner.
     * @param {import("../database/drivers/base.js").default} db - Database connection.
     * @param {string} scopeDigest - Fixed-size scope digest.
     * @returns {Promise<Record<string, ReturnType<typeof JSON.parse>> | null>} - Row or null.
     */
    async _idempotencyOwnership(db, scopeDigest) {
        const rows = await db.newQuery().from(IDEMPOTENCY_KEYS_TABLE).where({ scope_digest: scopeDigest }).limit(1).results();
        return rows[0] ? /** @type {Record<string, ReturnType<typeof JSON.parse>>} */ (rows[0]) : null;
    }
    /**
     * Fails closed when a durable key is reused for a different canonical request.
     * @param {object} args - Validation input.
     * @param {Record<string, ReturnType<typeof JSON.parse>>} args.existing - Stored owner.
     * @param {Record<string, ReturnType<typeof JSON.parse>>} args.ownership - Requested owner.
     * @returns {void}
     */
    _validateIdempotencyOwnership({ existing, ownership }) {
        const exactScope = String(existing.job_name) === ownership.job_name
            && String(existing.queue) === ownership.queue
            && String(existing.idempotency_key) === ownership.idempotency_key;
        if (!exactScope || String(existing.request_digest) !== ownership.request_digest) {
            throw VelociousError.safe("The background job idempotency key was already used for a different request.", {
                code: "background-job-idempotency-conflict"
            });
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
    async _persistMailDeliveryOperation(db, { createdAtMs, jobId, mailOperationInput }) {
        if (!mailOperationInput)
            return;
        const { operation } = mailOperationInput;
        const operationKey = mailDeliveryOperationKey(operation.id);
        const row = {
            background_job_id: jobId,
            created_at_ms: createdAtMs,
            first_attempt_started_at_ms: null,
            operation_id: operation.id,
            operation_key: operationKey,
            payload_digest: operation.payloadDigest,
            provider_kind: operation.providerKind,
            provider_retention_ms: operation.providerRetentionMs
        };
        try {
            await db.transaction(async () => {
                await db.insert({ tableName: MAIL_DELIVERY_OPERATIONS_TABLE, data: row });
            });
        }
        catch (error) {
            const existing = await this._mailDeliveryOperation(db, operationKey);
            if (!existing)
                throw error;
            this._validateMailDeliveryOperationRow({ existing, requested: row });
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
    async _validateMailDeliveryOperation(db, { jobId, mailOperationInput }) {
        if (!mailOperationInput)
            return;
        const { operation } = mailOperationInput;
        const existing = await this._mailDeliveryOperation(db, mailDeliveryOperationKey(operation.id));
        if (!existing) {
            throw new Error("Background job idempotency ownership is missing its durable mail delivery operation");
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
        });
    }
    /**
     * Loads a durable mail operation.
     * @param {import("../database/drivers/base.js").default} db - Database connection.
     * @param {string} operationKey - Fixed-size operation key.
     * @returns {Promise<Record<string, ReturnType<typeof JSON.parse>> | null>} - Row or null.
     */
    async _mailDeliveryOperation(db, operationKey) {
        const rows = await db.newQuery().from(MAIL_DELIVERY_OPERATIONS_TABLE).where({ operation_key: operationKey }).limit(1).results();
        return rows[0] ? /** @type {Record<string, ReturnType<typeof JSON.parse>>} */ (rows[0]) : null;
    }
    /**
     * Compares provider-relevant durable mail operation fields.
     * @param {object} args - Validation input.
     * @param {Record<string, ReturnType<typeof JSON.parse>>} args.existing - Stored row.
     * @param {Record<string, ReturnType<typeof JSON.parse>>} args.requested - Requested row.
     * @returns {void}
     */
    _validateMailDeliveryOperationRow({ existing, requested }) {
        const matches = String(existing.operation_id) === requested.operation_id
            && String(existing.payload_digest) === requested.payload_digest
            && String(existing.background_job_id) === requested.background_job_id
            && String(existing.provider_kind) === requested.provider_kind
            && this._normalizeNumber(existing.provider_retention_ms) === requested.provider_retention_ms;
        if (!matches) {
            throw VelociousError.safe("The mail delivery operation was already used for a different payload or provider.", {
                code: "mail-delivery-idempotency-conflict"
            });
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
    _idempotencyRequestDigest({ args, options, preparedJob }) {
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
            ...(preparedJob.timeoutMs === null ? {} : { timeoutMs: preparedJob.timeoutMs })
        });
        return createHash("sha256").update(serialized).digest("hex");
    }
    /**
     * Fixed-size globally indexed representation of the documented scope tuple.
     * @param {object} args - Scope input.
     * @param {string} args.idempotencyKey - Caller key.
     * @param {string} args.jobName - Job class name.
     * @param {string} args.queue - Queue name.
     * @returns {string} - SHA-256 scope digest.
     */
    _idempotencyScopeDigest({ idempotencyKey, jobName, queue }) {
        return createHash("sha256")
            .update(stableJsonStringify({ format: "velocious-background-job-idempotency-scope-v1", idempotencyKey, jobName, queue }))
            .digest("hex");
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
            });
        }
        return idempotencyKey;
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
    async replaceScheduled({ scheduleKey, jobName, args, options }) {
        await this.ensureReady();
        const normalizedScheduleKey = this._normalizeScheduleKey(scheduleKey);
        const preparedJob = this._prepareJob({ jobName, args, options });
        return await this._serializedCountMutation(async (db) => {
            const ownerRows = await db
                .newQuery()
                .from(SCHEDULE_KEYS_TABLE)
                .where({ schedule_key: normalizedScheduleKey })
                .limit(1)
                .results();
            const ownerJobId = ownerRows[0] ? String(/** @type {Record<string, ReturnType<typeof JSON.parse>>} */ (ownerRows[0]).job_id) : null;
            const ownerJob = ownerJobId ? await this._getJobRowById(db, ownerJobId) : null;
            /** @type {import("./types.js").BackgroundJobReplacementPreviousStatus} */
            let previousStatus = null;
            let previousJobId = null;
            if (ownerJob?.status === "queued") {
                const affectedRows = await this._updateAffectedRows(db, {
                    tableName: JOBS_TABLE,
                    data: { status: "cancelled" },
                    conditions: { id: ownerJob.id, status: "queued" }
                });
                if (affectedRows === 1) {
                    previousJobId = ownerJob.id;
                    previousStatus = "queued";
                }
                else {
                    const currentOwnerJob = await this._getJobRowById(db, ownerJob.id);
                    if (currentOwnerJob?.status === "handed_off") {
                        previousJobId = currentOwnerJob.id;
                        previousStatus = "handed_off";
                    }
                }
            }
            else if (ownerJob?.status === "handed_off") {
                previousJobId = ownerJob.id;
                previousStatus = "handed_off";
            }
            await this._insertPreparedJob(db, { preparedJob, scheduleKey: normalizedScheduleKey });
            await db.upsert({
                tableName: SCHEDULE_KEYS_TABLE,
                data: { schedule_key: normalizedScheduleKey, job_id: preparedJob.jobId },
                conflictColumns: ["schedule_key"],
                updateColumns: ["job_id"]
            });
            if (previousStatus !== "queued")
                await this._recordCountDelta(db, { all: 1, queued: 1 });
            return { jobId: preparedJob.jobId, previousJobId, previousStatus };
        }, {
            advisoryLock: {
                failureMessage: "Failed to acquire background job schedule-key lock",
                name: this._scheduleKeyLockName(normalizedScheduleKey)
            }
        });
    }
    /**
     * Cancels the queued owner of a stable schedule key. A handed-off owner is
     * detached but not marked stopped because execution may already be running.
     * @param {string} scheduleKey - Stable logical schedule key.
     * @returns {Promise<import("./types.js").BackgroundJobCancellationResult>} - Cancellation result.
     */
    async cancelScheduled(scheduleKey) {
        await this.ensureReady();
        const normalizedScheduleKey = this._normalizeScheduleKey(scheduleKey);
        return await this._serializedCountMutation(async (db) => {
            const ownerRows = await db
                .newQuery()
                .from(SCHEDULE_KEYS_TABLE)
                .where({ schedule_key: normalizedScheduleKey })
                .limit(1)
                .results();
            if (!ownerRows[0])
                return { jobId: null, outcome: "not_found" };
            const jobId = String(/** @type {Record<string, ReturnType<typeof JSON.parse>>} */ (ownerRows[0]).job_id);
            const job = await this._getJobRowById(db, jobId);
            if (job?.status === "queued") {
                const affectedRows = await this._updateAffectedRows(db, {
                    tableName: JOBS_TABLE,
                    data: { status: "cancelled" },
                    conditions: { id: job.id, status: "queued" }
                });
                if (affectedRows === 1) {
                    await this._releaseScheduleOwnership(db, { jobId, scheduleKey: normalizedScheduleKey });
                    await this._recordStatusTransition(db, "queued", "cancelled");
                    return { jobId, outcome: "cancelled" };
                }
            }
            const currentJob = await this._getJobRowById(db, jobId);
            await this._releaseScheduleOwnership(db, { jobId, scheduleKey: normalizedScheduleKey });
            if (currentJob?.status === "handed_off")
                return { jobId, outcome: "handed_off" };
            return { jobId: null, outcome: "not_found" };
        }, {
            advisoryLock: {
                failureMessage: "Failed to acquire background job schedule-key lock",
                name: this._scheduleKeyLockName(normalizedScheduleKey)
            }
        });
    }
    /**
     * Runs next available job.
     * @param {object} [args] - Options.
     * @param {import("./types.js").BackgroundJobExecutionMode | import("./types.js").BackgroundJobExecutionMode[]} [args.executionMode] - Execution mode or modes to match.
     * @returns {Promise<import("./types.js").BackgroundJobRow | null>} - Next job.
     */
    async nextAvailableJob(args = {}) {
        await this.ensureReady();
        return await this._withDb(async (db) => {
            return await this._nextQueuedJob({
                db,
                scheduledAtOperator: "<=",
                executionMode: args.executionMode
            });
        });
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
        await this.ensureReady();
        return await this._withDb(async (db) => {
            return await this._nextQueuedJob({ db, scheduledAtOperator: ">" });
        });
    }
    /**
     * Runs next queued job.
     * @param {object} args - Options.
     * @param {import("../database/drivers/base.js").default} args.db - Database connection.
     * @param {"<=" | ">"} args.scheduledAtOperator - Scheduled timestamp operator.
     * @param {import("./types.js").BackgroundJobExecutionMode | import("./types.js").BackgroundJobExecutionMode[]} [args.executionMode] - Execution mode or modes to match.
     * @returns {Promise<import("./types.js").BackgroundJobRow | null>} - Next matching queued job.
     */
    async _nextQueuedJob({ db, scheduledAtOperator, executionMode }) {
        const now = Date.now();
        let query = db
            .newQuery()
            .from(JOBS_TABLE)
            .where({ status: "queued" })
            .where(`scheduled_at_ms ${scheduledAtOperator} ${db.quote(now)}`);
        if (scheduledAtOperator === "<=") {
            const jobsTable = db.quoteTable(JOBS_TABLE);
            const concurrencyTable = db.quoteTable(CONCURRENCY_TABLE);
            query = query.where(`(${jobsTable}.${db.quoteColumn("concurrency_key")} IS NULL OR EXISTS (` +
                `SELECT 1 FROM ${concurrencyTable} WHERE ` +
                `${concurrencyTable}.${db.quoteColumn("concurrency_key")} = ${jobsTable}.${db.quoteColumn("concurrency_key")} AND ` +
                `${concurrencyTable}.${db.quoteColumn("active_count")} < ${concurrencyTable}.${db.quoteColumn("max_concurrency")}))`);
        }
        if (executionMode)
            query = this._whereExecutionMode({ db, executionMode, query });
        if (scheduledAtOperator === "<=") {
            const priorityOrder = this._queuePriorityOrderSql(db);
            if (priorityOrder)
                query = query.order(`${priorityOrder} DESC`);
        }
        query = query
            .order("scheduled_at_ms ASC")
            .order("created_at_ms ASC")
            .limit(1);
        const rows = await query.results();
        const row = rows[0];
        if (!row)
            return null;
        return this._normalizeJobRow(row);
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
        const queues = this.configuration.getBackgroundJobsConfig().queues || {};
        /** @type {Array<[string, number]>} */
        const prioritized = [];
        for (const [queue, queueConfig] of Object.entries(queues)) {
            const priority = queueConfig?.priority;
            if (Number.isFinite(priority) && Number(priority) !== 0)
                prioritized.push([queue, Number(priority)]);
        }
        if (prioritized.length === 0)
            return null;
        const queueColumn = db.quoteColumn("queue");
        const whens = prioritized
            .map(([queue, priority]) => `WHEN ${db.quote(queue)} THEN ${priority}`)
            .join(" ");
        return `CASE COALESCE(${queueColumn}, ${db.quote(DEFAULT_BACKGROUND_JOB_QUEUE)}) ${whens} ELSE 0 END`;
    }
    /**
     * Runs get job.
     * @param {string} jobId - Job id.
     * @returns {Promise<import("./types.js").BackgroundJobRow | null>} - Job row.
     */
    async getJob(jobId) {
        await this.ensureReady();
        return await this._withDb(async (db) => {
            const query = db
                .newQuery()
                .from(JOBS_TABLE)
                .where({ id: jobId })
                .limit(1);
            const rows = await query.results();
            const row = rows[0];
            if (!row)
                return null;
            return this._normalizeJobRow(row);
        });
    }
    /**
     * Counts jobs grouped by status. Used by the dashboard overview.
     * @returns {Promise<Record<string, number>>} - Counts keyed by status.
     */
    async countsByStatus() {
        await this.ensureReady();
        return await this._withDb(async (db) => {
            const rows = await db
                .newQuery()
                .from(JOBS_TABLE)
                .select("status")
                .select("COUNT(*) AS count")
                .group("status")
                .results();
            /**
             * Counts.
             * @type {Record<string, number>} */
            const counts = {};
            for (const row of rows) {
                const typedRow = /** @type {Record<string, ReturnType<typeof JSON.parse>>} */ (row);
                counts[String(typedRow.status)] = this._normalizeNumber(typedRow.count) || 0;
            }
            return counts;
        });
    }
    /**
     * Returns the authoritative dashboard count snapshot and its matching durable
     * revision. Locking the revision row before counting prevents a writer from
     * committing between the count query and revision read.
     * @returns {Promise<{counts: Record<string, number>, revision: number, total: number}>} Snapshot.
     */
    async countSnapshot() {
        await this.ensureReady();
        return await this._serializedCountMutation(async (db) => {
            return await this._countSnapshotOnLockedConnection(db);
        });
    }
    /**
     * Counts jobs matching the given filters.
     * @param {object} [args] - Options.
     * @param {string} [args.status] - Filter by status.
     * @param {string} [args.jobName] - Filter by job name.
     * @returns {Promise<number>} - Matching job count.
     */
    async countJobs({ status, jobName } = {}) {
        await this.ensureReady();
        return await this._withDb(async (db) => {
            let query = db.newQuery().from(JOBS_TABLE).select("COUNT(*) AS count");
            if (status)
                query = query.where({ status });
            if (jobName)
                query = query.where({ job_name: jobName });
            const rows = await query.results();
            const countRow = /** @type {Record<string, ReturnType<typeof JSON.parse>>} */ (rows[0] || {});
            return this._normalizeNumber(countRow.count) || 0;
        });
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
    async listJobs({ status, jobName, limit = 25, offset = 0, sortColumn = "createdAtMs", sortDirection = "DESC" } = {}) {
        await this.ensureReady();
        const column = SORTABLE_COLUMNS[sortColumn] || SORTABLE_COLUMNS.createdAtMs;
        const direction = sortDirection === "ASC" ? "ASC" : "DESC";
        return await this._withDb(async (db) => {
            let query = db.newQuery().from(JOBS_TABLE);
            if (status)
                query = query.where({ status });
            if (jobName)
                query = query.where({ job_name: jobName });
            query = query.order({ column, direction });
            if (column !== SORTABLE_COLUMNS.createdAtMs)
                query = query.order({ column: SORTABLE_COLUMNS.createdAtMs, direction: "DESC" });
            const rows = await query.limit(limit).offset(offset).results();
            return rows.map((row) => this._normalizeJobRow(row));
        });
    }
    /**
     * Runs mark handed off.
     * @param {object} args - Options.
     * @param {string} args.jobId - Job id.
     * @param {string} [args.handoffId] - Caller-selected exact lease id. Generated for legacy direct callers when omitted.
     * @param {string} [args.workerId] - Worker id.
     * @returns {Promise<import("./types.js").BackgroundJobHandoff | null>} - Claimed handoff lease, or null when no longer queued.
     */
    async markHandedOff({ jobId, handoffId = randomUUID(), workerId }) {
        await this.ensureReady();
        const handedOffAtMs = Date.now();
        return await this._serializedCountMutation(async (db) => {
            const queuedJob = await this._getJobRowById(db, jobId);
            if (!queuedJob || queuedJob.status !== "queued")
                return null;
            if (queuedJob.concurrencyKey && !(await this._reserveConcurrency(db, queuedJob.concurrencyKey)))
                return null;
            const affectedRows = await this._updateAffectedRows(db, {
                tableName: JOBS_TABLE,
                data: {
                    status: "handed_off",
                    handed_off_at_ms: handedOffAtMs,
                    handoff_id: handoffId,
                    worker_id: workerId || null
                },
                conditions: { concurrency_key: queuedJob.concurrencyKey, id: jobId, status: "queued" }
            });
            if (affectedRows !== 1) {
                await this._releaseConcurrency(db, queuedJob.concurrencyKey);
                return null;
            }
            await this._recordStatusTransition(db, "queued", "handed_off");
            return { handedOffAtMs, handoffId };
        });
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
    async markCompleted({ jobId, handoffId, workerId, handedOffAtMs }) {
        await this.ensureReady();
        return await this._serializedCountMutation(async (db) => {
            const job = await this._getJobRowById(db, jobId);
            if (!job)
                return false;
            if (!this._shouldAcceptReport({ job, handoffId, workerId, handedOffAtMs }))
                return false;
            await this._lockConcurrencyRow(db, job.concurrencyKey);
            const affectedRows = await this._updateAffectedRows(db, {
                tableName: JOBS_TABLE,
                data: {
                    status: "completed",
                    completed_at_ms: Date.now()
                },
                conditions: this._activeHandoffConditions(job)
            });
            if (affectedRows !== 1)
                return false;
            await this._releaseScheduleOwnershipForJob(db, job);
            await this._releaseConcurrency(db, job.concurrencyKey);
            await this._recordStatusTransition(db, "handed_off", "completed");
            return true;
        });
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
    async markRescheduled({ jobId, delayMs, handoffId, workerId, handedOffAtMs }) {
        await this.ensureReady();
        this._validateRescheduleDelayMs(delayMs);
        return await this._serializedCountMutation(async (db) => {
            const job = await this._getJobRowById(db, jobId);
            if (!job)
                return false;
            if (!this._shouldAcceptReport({ job, handoffId, workerId, handedOffAtMs }))
                return false;
            await this._lockConcurrencyRow(db, job.concurrencyKey);
            const queuedConcurrency = await this._requeuedJobConcurrency(db, job);
            const scheduledAtMs = this._rescheduledAtMs(delayMs);
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
            });
            if (affectedRows !== 1)
                return false;
            await this._releaseConcurrency(db, job.concurrencyKey);
            await this._recordStatusTransition(db, "handed_off", "queued");
            return true;
        });
    }
    /**
     * Runs mark returned to queue.
     * @param {object} args - Options.
     * @param {string} args.jobId - Job id.
     * @param {string} args.handoffId - Handoff lease id.
     * @returns {Promise<void>} - Resolves when updated.
     */
    async markReturnedToQueue({ jobId, handoffId }) {
        await this.ensureReady();
        await this._serializedCountMutation(async (db) => {
            const job = await this._getJobRowById(db, jobId);
            if (!job || job.handoffId !== handoffId || job.status !== "handed_off")
                return;
            await this._lockConcurrencyRow(db, job.concurrencyKey);
            const queuedConcurrency = await this._requeuedJobConcurrency(db, job);
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
                conditions: { handoff_id: handoffId, id: jobId, status: "handed_off" }
            });
            if (affectedRows === 1) {
                await this._releaseConcurrency(db, job.concurrencyKey);
                await this._recordStatusTransition(db, "handed_off", "queued");
            }
        });
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
    async handedOffJobsForWorker({ workerId }) {
        await this.ensureReady();
        const rows = await this._withDb(async (db) => await db.newQuery().from(JOBS_TABLE).where({ status: "handed_off", worker_id: workerId }).results());
        /** @type {Array<{jobId: string, handoffId: string}>} */
        const handoffs = [];
        for (const row of rows) {
            const job = this._normalizeJobRow(row);
            if (job.handoffId)
                handoffs.push({ jobId: job.id, handoffId: job.handoffId });
        }
        return handoffs;
    }
    /**
     * Snapshots exact, lease-aware active handoffs before a new main generation
     * starts accepting worker reconnects. Legacy rows without a complete worker,
     * lease, and timestamp identity stay owned by the age-based orphan sweep.
     * @returns {Promise<import("./types.js").BackgroundJobHandoffSnapshot[]>} - Exact startup handoffs.
     */
    async snapshotHandedOffJobs() {
        await this.ensureReady();
        const rows = await this._withDb(async (db) => await db
            .newQuery()
            .from(JOBS_TABLE)
            .where({ status: "handed_off" })
            .order("created_at_ms ASC")
            .order("id ASC")
            .results());
        /** @type {import("./types.js").BackgroundJobHandoffSnapshot[]} */
        const handoffs = [];
        for (const row of rows) {
            const job = this._normalizeJobRow(row);
            if (!job.handoffId || !job.workerId || typeof job.handedOffAtMs !== "number")
                continue;
            handoffs.push({
                handedOffAtMs: job.handedOffAtMs,
                handoffId: job.handoffId,
                jobId: job.id,
                workerId: job.workerId
            });
        }
        return handoffs;
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
    async markOrphanedHandoffs({ handoffs, error }) {
        await this.ensureReady();
        return await this._serializedCountMutation(async (db) => {
            /** @type {BackgroundJobOrphanSelection[]} */
            const selections = [];
            for (const handoff of handoffs) {
                const job = await this._getJobRowById(db, handoff.jobId);
                if (!job || job.status !== "handed_off")
                    continue;
                if (job.handoffId !== handoff.handoffId)
                    continue;
                if (job.workerId !== handoff.workerId)
                    continue;
                if (job.handedOffAtMs !== handoff.handedOffAtMs)
                    continue;
                selections.push({
                    conditions: {
                        handed_off_at_ms: handoff.handedOffAtMs,
                        handoff_id: handoff.handoffId,
                        id: handoff.jobId,
                        status: "handed_off",
                        worker_id: handoff.workerId
                    },
                    job
                });
            }
            return await this._markOrphanSelections({ db, error, selections });
        });
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
    async markFailed({ jobId, error, handoffId, workerId, handedOffAtMs }) {
        await this.ensureReady();
        return await this._serializedCountMutation(async (db) => {
            const job = await this._getJobRowById(db, jobId);
            if (!job)
                return null;
            if (!this._shouldAcceptReport({ job, handoffId, workerId, handedOffAtMs }))
                return null;
            const updatedJob = await this._applyFailure({ db, job, error, markOrphaned: false });
            if (updatedJob)
                await this._recordStatusTransition(db, job.status, updatedJob.status);
            return updatedJob;
        });
    }
    /**
     * Runs mark orphaned jobs.
     * @param {object} [args] - Options.
     * @param {number} [args.orphanedAfterMs] - Mark jobs orphaned after this duration.
     * @returns {Promise<import("./types.js").BackgroundJobRow[]>} - The jobs this sweep marked orphaned.
     */
    async markOrphanedJobs({ orphanedAfterMs = ORPHANED_AFTER_MS } = {}) {
        await this.ensureReady();
        return await this._serializedCountMutation(async (db) => {
            const cutoff = Date.now() - orphanedAfterMs;
            const query = db
                .newQuery()
                .from(JOBS_TABLE)
                .where({ status: "handed_off" })
                .where(`handed_off_at_ms <= ${db.quote(cutoff)}`);
            const rows = await query.results();
            /** @type {BackgroundJobOrphanSelection[]} */
            const selections = [];
            for (const row of rows) {
                const job = this._normalizeJobRow(row);
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
                    conditions: { id: job.id, status: "handed_off", handed_off_at_ms: job.handedOffAtMs },
                    job
                });
            }
            return await this._markOrphanSelections({
                db,
                error: "Job orphaned after timeout",
                selections
            });
        });
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
    async _markOrphanSelections({ db, error, selections }) {
        /** @type {import("./types.js").BackgroundJobRow[]} */
        const orphanedJobs = [];
        for (const { conditions, job } of selections) {
            const orphanedJob = await this._applyFailure({
                conditions,
                db,
                error,
                job,
                markOrphaned: true
            });
            if (orphanedJob)
                orphanedJobs.push(orphanedJob);
        }
        const statusCounts = this._statusCounts(orphanedJobs);
        const deltas = this._emptyCountBuckets();
        for (const [status, count] of Object.entries(statusCounts)) {
            deltas.handed_off -= count;
            deltas[status] += count;
        }
        await this._recordCountDelta(db, deltas);
        return orphanedJobs;
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
    async pruneTerminalJobs({ completedTtlMs = null, failedTtlMs = null, batchSize = 1000 } = {}) {
        await this.ensureReady();
        const now = Date.now();
        const size = batchSize > 0 ? batchSize : 1000;
        let deleted = 0;
        if (completedTtlMs && completedTtlMs > 0) {
            deleted += await this._pruneStatusBatches({ status: "completed", column: "completed_at_ms", cutoff: now - completedTtlMs, batchSize: size });
        }
        if (failedTtlMs && failedTtlMs > 0) {
            deleted += await this._pruneStatusBatches({ status: "failed", column: "failed_at_ms", cutoff: now - failedTtlMs, batchSize: size });
            deleted += await this._pruneStatusBatches({ status: "orphaned", column: "orphaned_at_ms", cutoff: now - failedTtlMs, batchSize: size });
        }
        return deleted;
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
    async _pruneStatusBatches({ status, column, cutoff, batchSize }) {
        let deleted = 0;
        for (;;) {
            const removed = await this._serializedCountMutation(async (db) => {
                const rows = await db
                    .newQuery()
                    .from(JOBS_TABLE)
                    .select("id")
                    .where({ status })
                    .where(`${db.quoteColumn(column)} <= ${db.quote(cutoff)}`)
                    .limit(batchSize)
                    .results();
                if (rows.length === 0)
                    return 0;
                const ids = rows.map((/** @type {Record<string, ReturnType<typeof JSON.parse>>} */ row) => db.quote(String(row.id))).join(", ");
                const removed = await db.affectedRows(`DELETE FROM ${db.quoteTable(JOBS_TABLE)} WHERE ${db.quoteColumn("id")} IN (${ids})`);
                await this._recordCountDelta(db, { all: -removed, [status]: -removed });
                return removed;
            });
            deleted += removed;
            if (removed < batchSize)
                break;
        }
        return deleted;
    }
    /**
     * Runs clear all.
     * @returns {Promise<void>} - Resolves when cleared.
     */
    async clearAll() {
        await this.ensureReady();
        await this._serializedCountMutation(async (db) => {
            const snapshot = await this._countSnapshotOnLockedConnection(db);
            if (await db.tableExists(MAIL_DELIVERY_OPERATIONS_TABLE))
                await db.query(`DELETE FROM ${db.quoteTable(MAIL_DELIVERY_OPERATIONS_TABLE)}`);
            if (await db.tableExists(IDEMPOTENCY_KEYS_TABLE))
                await db.query(`DELETE FROM ${db.quoteTable(IDEMPOTENCY_KEYS_TABLE)}`);
            if (await db.tableExists(SCHEDULE_KEYS_TABLE))
                await db.query(`DELETE FROM ${db.quoteTable(SCHEDULE_KEYS_TABLE)}`);
            await db.query(`DELETE FROM ${db.quoteTable(JOBS_TABLE)}`);
            if (await db.tableExists(CONCURRENCY_TABLE))
                await db.query(`DELETE FROM ${db.quoteTable(CONCURRENCY_TABLE)}`);
            const deltas = Object.fromEntries(Object.entries(snapshot.counts).map(([key, value]) => [key, -value]));
            await this._recordCountDelta(db, deltas);
        });
    }
    /**
     * Cancels a queued or handed-off job and releases any durable concurrency reservation.
     * @param {string} jobId - Job id.
     * @returns {Promise<boolean>} - Whether the job was cancelled.
     */
    async cancel(jobId) {
        await this.ensureReady();
        return await this._serializedCountMutation(async (db) => {
            const job = await this._getJobRowById(db, jobId);
            if (!job || (job.status !== "queued" && job.status !== "handed_off"))
                return false;
            // Only a handed_off job holds a concurrency reservation, so only that case touches the
            // shared counter row and needs the concurrency-then-job lock ordering.
            if (job.status === "handed_off")
                await this._lockConcurrencyRow(db, job.concurrencyKey);
            const affectedRows = await this._updateAffectedRows(db, { tableName: JOBS_TABLE, data: { status: "cancelled" }, conditions: { id: job.id, status: job.status } });
            if (affectedRows !== 1)
                return false;
            await this._releaseScheduleOwnershipForJob(db, job);
            if (job.status === "handed_off")
                await this._releaseConcurrency(db, job.concurrencyKey);
            await this._recordStatusTransition(db, job.status, "cancelled");
            return true;
        });
    }
    /**
     * Runs get retry delay ms.
     * @param {number} retryCount - Retry attempt count (1-based).
     * @returns {number} - Delay in milliseconds.
     */
    getRetryDelayMs(retryCount) {
        return retryDelayMs(retryCount);
    }
    /**
     * Normalizes one new job before entering its persistence transaction.
     * @param {object} args - Job input.
     * @param {Array<ReturnType<typeof JSON.parse>>} args.args - Job arguments.
     * @param {string} args.jobName - Job name.
     * @param {import("./types.js").BackgroundJobOptions} [args.options] - Job options.
     * @returns {PreparedBackgroundJob} - Prepared job.
     */
    _prepareJob({ args, jobName, options }) {
        const createdAtMs = Date.now();
        const queue = this._normalizeQueue(options);
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
        };
    }
    /**
     * Normalizes a per-job timeout while preserving omitted (worker fallback)
     * separately from explicitly disabled.
     * @param {import("./types.js").BackgroundJobOptions | undefined} options - Job options.
     * @returns {number | null} - Positive timeout, zero for disabled, or null when omitted.
     */
    _normalizeJobTimeoutMs(options) {
        if (options?.timeoutMs === undefined)
            return null;
        const timeoutMs = options.timeoutMs;
        if (typeof timeoutMs !== "number" || !Number.isFinite(timeoutMs)) {
            throw VelociousError.safe(JOB_TIMEOUT_VALIDATION_MESSAGE);
        }
        if (timeoutMs <= 0)
            return 0;
        if (!Number.isInteger(timeoutMs) || timeoutMs > MAX_JOB_TIMEOUT_MS) {
            throw VelociousError.safe(JOB_TIMEOUT_VALIDATION_MESSAGE);
        }
        return timeoutMs;
    }
    /**
     * Inserts one prepared queued job, including its concurrency registration.
     * @param {import("../database/drivers/base.js").default} db - Database connection.
     * @param {object} args - Insert input.
     * @param {PreparedBackgroundJob} args.preparedJob - Prepared job.
     * @param {string | null} args.scheduleKey - Historical stable key.
     * @returns {Promise<void>} - Resolves after insertion.
     */
    async _insertPreparedJob(db, { preparedJob, scheduleKey }) {
        const { concurrency } = preparedJob;
        if (concurrency) {
            if (concurrency.queueDerived) {
                await this._ensureQueueConcurrencyKey(db, concurrency);
            }
            else {
                await this._ensureConcurrencyKey(db, concurrency);
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
        });
    }
    /**
     * Runs normalize max retries.
     * @param {number | null | undefined} maxRetries - Input.
     * @returns {number} - Normalized max retries.
     */
    _normalizeMaxRetries(maxRetries) {
        return normalizeBackgroundJobMaxRetries(maxRetries);
    }
    /**
     * Runs normalize scheduled at ms.
     * @param {number | undefined} scheduledAtMs - Requested dispatch timestamp.
     * @param {number} defaultScheduledAtMs - Default dispatch timestamp.
     * @returns {number} - Dispatch timestamp.
     */
    _normalizeScheduledAtMs(scheduledAtMs, defaultScheduledAtMs) {
        return normalizeBackgroundJobScheduledAtMs(scheduledAtMs, defaultScheduledAtMs);
    }
    /**
     * Resolves a reschedule delay against persistence time.
     * @param {number} delayMs - Delay in milliseconds.
     * @returns {number} - Future eligibility timestamp.
     */
    _rescheduledAtMs(delayMs) {
        return rescheduledBackgroundJobAtMs(delayMs, Date.now());
    }
    /**
     * Validates a public reschedule delay before persistence work begins.
     * @param {number} delayMs - Delay in milliseconds.
     * @returns {void}
     */
    _validateRescheduleDelayMs(delayMs) {
        rescheduledBackgroundJobAtMs(delayMs, 0);
    }
    /**
     * Validates a stable schedule key at the public storage boundary.
     * @param {string} scheduleKey - Stable logical schedule key.
     * @returns {string} - Validated key.
     */
    _normalizeScheduleKey(scheduleKey) {
        if (typeof scheduleKey === "string" && scheduleKey.length > 0 && scheduleKey.length <= 255)
            return scheduleKey;
        throw VelociousError.safe("background job scheduleKey must be a non-empty string of at most 255 characters");
    }
    /**
     * Builds a bounded advisory-lock name for one stable schedule key.
     * @param {string} scheduleKey - Validated stable schedule key.
     * @returns {string} - Advisory-lock name.
     */
    _scheduleKeyLockName(scheduleKey) {
        const hash = createHash("sha256").update(scheduleKey).digest("hex").slice(0, 32);
        return `background-jobs:schedule:${hash}`;
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
        await this._applySchema(existingDb);
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
        const identifier = this.getDatabaseIdentifier() ?? "default";
        const previous = schemaApplyChains.get(identifier) ?? Promise.resolve();
        const applyWithConnection = async () => {
            if (existingDb) {
                await this._applySchemaSteps(existingDb);
                return;
            }
            await this._withDb((db) => this._applySchemaSteps(db));
        };
        const run = previous.then(applyWithConnection, applyWithConnection);
        // Keep the chain alive regardless of this run's outcome so one failed apply does
        // not wedge later callers; this run still propagates its own result/error.
        schemaApplyChains.set(identifier, run.then(() => { }, () => { }));
        return await run;
    }
    /**
     * Creates or upgrades the background-jobs tables, columns and concurrency rows on
     * the given connection. Serialized per process by {@link BackgroundJobsStore#_applySchema}.
     * @param {import("../database/drivers/base.js").default} db - Database connection.
     * @returns {Promise<void>} - Resolves when the schema is present.
     */
    async _applySchemaSteps(db) {
        await this._ensureMigrationsTable(db);
        const alreadyApplied = await this._hasMigration(db);
        const schemaRecoveryPending = await this._hasMigration(db, SCHEMA_RECOVERY_PENDING_VERSION);
        const jobsTableExists = await db.tableExists(JOBS_TABLE);
        // Even when the migration row is present, the jobs table itself can have
        // been dropped underneath us by a transaction rollback in another caller
        // (DDL is transactional on SQLite/MSSQL). Verify the table physically
        // exists and recreate it when missing rather than trusting the migration
        // row alone, otherwise later callers fail with "no such table".
        if (alreadyApplied && jobsTableExists && !schemaRecoveryPending) {
            await this._ensureJobsTableColumns(db);
            await this._ensureIdempotencyKeysTable(db);
            await this._ensureMailDeliveryOperationsTable(db);
            await this._ensureScheduleKeysTable(db);
            await this._ensureConcurrencyTable(db);
            await this._ensureCountRevisionTable(db);
            return;
        }
        if (alreadyApplied && !schemaRecoveryPending) {
            await this._recordMigration(db, SCHEMA_RECOVERY_PENDING_VERSION);
        }
        await this._applyMigrations(db);
        await this._ensureJobsTableColumns(db);
        await this._ensureIdempotencyKeysTable(db);
        await this._ensureMailDeliveryOperationsTable(db);
        await this._ensureScheduleKeysTable(db);
        await this._ensureConcurrencyTable(db);
        await this._ensureCountRevisionTable(db);
        if (alreadyApplied) {
            // The recreated jobs table is empty, but the surviving concurrency table
            // can still count handoffs that disappeared with the dropped jobs table.
            await this._reconcileConcurrency(db);
            await db.delete({
                tableName: MIGRATIONS_TABLE,
                conditions: { key: this._migrationKey(SCHEMA_RECOVERY_PENDING_VERSION) }
            });
            return;
        }
        await this._recordMigration(db, MIGRATION_VERSION);
    }
    /**
     * Runs ensure migrations table.
     * @param {import("../database/drivers/base.js").default} db - Database connection.
     * @returns {Promise<void>} - Resolves when complete.
     */
    async _ensureMigrationsTable(db) {
        if (await db.tableExists(MIGRATIONS_TABLE))
            return;
        const table = new TableData(MIGRATIONS_TABLE, { ifNotExists: true });
        table.string("key", { null: false, primaryKey: true });
        table.string("scope", { null: false });
        table.string("version", { null: false });
        table.bigint("applied_at_ms", { null: false });
        await db.createTable(table);
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
            .where({ key: this._migrationKey(version) })
            .limit(1);
        const rows = await query.results();
        return rows.length > 0;
    }
    /**
     * Runs apply migrations.
     * @param {import("../database/drivers/base.js").default} db - Database connection.
     * @returns {Promise<void>} - Resolves when complete.
     */
    async _applyMigrations(db) {
        this.logger.info("Applying background jobs schema");
        if (await db.tableExists(JOBS_TABLE)) {
            this.logger.info("Background jobs table already exists - skipping create");
            return;
        }
        const table = new TableData(JOBS_TABLE, { ifNotExists: true });
        table.string("id", { primaryKey: true });
        table.string("job_name", { null: false, index: true });
        table.text("args_json", { null: false });
        table.string("execution_mode", { null: false });
        table.string("queue", { null: true, index: true });
        table.integer("max_retries", { null: false });
        table.integer("attempts", { null: false });
        table.string("status", { null: false, index: true });
        table.bigint("scheduled_at_ms", { null: false, index: true });
        table.bigint("created_at_ms", { null: false, index: true });
        table.string("schedule_key", { null: true, index: true });
        table.bigint("handed_off_at_ms", { null: true, index: true });
        table.string("handoff_id", { null: true });
        table.bigint("completed_at_ms", { null: true });
        table.bigint("failed_at_ms", { null: true });
        table.bigint("orphaned_at_ms", { null: true, index: true });
        table.string("worker_id", { null: true });
        table.text("last_error", { null: true });
        table.string("concurrency_key", { null: true, index: true });
        table.integer("max_concurrency", { null: true });
        table.bigint("timeout_ms", { null: true });
        await db.createTable(table);
    }
    /**
     * Runs ensure jobs table columns.
     * @param {import("../database/drivers/base.js").default} db - Database connection.
     * @returns {Promise<void>} - Resolves when complete.
     */
    async _ensureJobsTableColumns(db) {
        if (!(await db.tableExists(JOBS_TABLE)))
            return;
        const table = await db.getTableByNameOrFail(JOBS_TABLE);
        const executionModeColumn = await table.getColumnByName("execution_mode");
        if (!executionModeColumn) {
            const tableData = new TableData(JOBS_TABLE);
            tableData.string("execution_mode", { null: true });
            const sqls = await db.alterTableSQLs(tableData);
            for (const sql of sqls) {
                await db.query(sql);
            }
            db.clearSchemaCache();
        }
        const refreshedTable = await db.getTableByNameOrFail(JOBS_TABLE);
        const handoffIdColumn = await refreshedTable.getColumnByName("handoff_id");
        if (!handoffIdColumn) {
            const lockName = `${MIGRATION_SCOPE}:handoff_id_column`;
            const acquired = await db.acquireAdvisoryLock(lockName);
            if (!acquired)
                throw new Error("Failed to acquire background jobs handoff schema lock");
            try {
                db.clearSchemaCache();
                const lockedTable = await db.getTableByNameOrFail(JOBS_TABLE);
                if (!(await lockedTable.getColumnByName("handoff_id"))) {
                    const tableData = new TableData(JOBS_TABLE);
                    tableData.string("handoff_id", { null: true });
                    const sqls = await db.alterTableSQLs(tableData);
                    for (const sql of sqls) {
                        await db.query(sql);
                    }
                    db.clearSchemaCache();
                }
            }
            finally {
                await db.releaseAdvisoryLock(lockName);
            }
        }
        await this._backfillExecutionModesOnce(db);
        await this._dropForkedColumnOnce(db);
        const lockName = `${MIGRATION_SCOPE}:concurrency_columns`;
        const acquired = await db.acquireAdvisoryLock(lockName);
        if (!acquired)
            throw new Error("Failed to acquire background jobs concurrency schema lock");
        try {
            // SQL Server schema reads can deadlock with a concurrent ALTER TABLE, so
            // acquire the lock before inspecting either column rather than only
            // protecting the mutation.
            db.clearSchemaCache();
            const lockedTable = await db.getTableByNameOrFail(JOBS_TABLE);
            const concurrencyColumnNames = ["concurrency_key", "max_concurrency"];
            for (const concurrencyColumnName of concurrencyColumnNames) {
                if (await lockedTable.getColumnByName(concurrencyColumnName))
                    continue;
                const tableData = new TableData(JOBS_TABLE);
                if (concurrencyColumnName == "concurrency_key") {
                    tableData.string("concurrency_key", { null: true, index: true });
                }
                else {
                    tableData.integer("max_concurrency", { null: true });
                }
                for (const sql of await db.alterTableSQLs(tableData))
                    await db.query(sql);
            }
            db.clearSchemaCache();
        }
        finally {
            await db.releaseAdvisoryLock(lockName);
        }
        await this._ensureQueueColumn(db);
        await this._ensureScheduleKeyColumn(db);
        await this._ensureJobTimeoutColumn(db);
        await this._ensureJobsTableIndexesOnce(db);
    }
    /**
     * Repairs secondary indexes that older add-column upgrades declared but did
     * not create on every SQL driver. The migration ledger keeps routine store
     * readiness from repeatedly introspecting the full index set.
     * @param {import("../database/drivers/base.js").default} db - Database connection.
     * @returns {Promise<void>} - Resolves when all expected indexes exist.
     */
    async _ensureJobsTableIndexesOnce(db) {
        const migrationVersion = JOBS_INDEX_REPAIR_MIGRATION_VERSION;
        const migrationKey = this._migrationKey(migrationVersion);
        if (await this._hasMigration(db, migrationVersion))
            return;
        const acquired = await db.acquireAdvisoryLock(migrationKey);
        if (!acquired)
            throw new Error("Failed to acquire background jobs index repair lock");
        try {
            if (await this._hasMigration(db, migrationVersion))
                return;
            db.clearSchemaCache();
            const table = await db.getTableByNameOrFail(JOBS_TABLE);
            const indexedColumnNames = new Set((await table.getIndexes())
                .filter((index) => !index.isPrimaryKey() && index.getColumnNames().length === 1)
                .map((index) => index.getColumnNames()[0]));
            for (const columnName of JOBS_INDEX_COLUMN_NAMES) {
                if (indexedColumnNames.has(columnName))
                    continue;
                for (const sql of await db.createIndexSQLs({ columns: [columnName], ifNotExists: db.getType() === "sqlite", tableName: JOBS_TABLE })) {
                    await db.query(sql);
                }
            }
            db.clearSchemaCache();
            await this._recordMigration(db, migrationVersion);
        }
        finally {
            await db.releaseAdvisoryLock(migrationKey);
        }
    }
    /**
     * Idempotently adds the per-job wall-clock timeout to existing job tables.
     * @param {import("../database/drivers/base.js").default} db - Database connection.
     * @returns {Promise<void>} - Resolves when ensured.
     */
    async _ensureJobTimeoutColumn(db) {
        const lockName = `${MIGRATION_SCOPE}:timeout_ms_column`;
        const acquired = await db.acquireAdvisoryLock(lockName);
        if (!acquired)
            throw new Error("Failed to acquire background jobs timeout schema lock");
        try {
            db.clearSchemaCache();
            const table = await db.getTableByNameOrFail(JOBS_TABLE);
            if (!(await table.getColumnByName("timeout_ms"))) {
                const tableData = new TableData(JOBS_TABLE);
                tableData.bigint("timeout_ms", { null: true });
                for (const sql of await db.alterTableSQLs(tableData))
                    await db.query(sql);
                db.clearSchemaCache();
            }
        }
        finally {
            await db.releaseAdvisoryLock(lockName);
        }
    }
    /**
     * Idempotently adds the historical stable schedule key to existing jobs.
     * @param {import("../database/drivers/base.js").default} db - Database connection.
     * @returns {Promise<void>} - Resolves when ensured.
     */
    async _ensureScheduleKeyColumn(db) {
        const lockName = `${MIGRATION_SCOPE}:schedule_key_column`;
        const acquired = await db.acquireAdvisoryLock(lockName);
        if (!acquired)
            throw new Error("Failed to acquire background jobs schedule-key schema lock");
        try {
            db.clearSchemaCache();
            const lockedTable = await db.getTableByNameOrFail(JOBS_TABLE);
            if (!(await lockedTable.getColumnByName("schedule_key"))) {
                const tableData = new TableData(JOBS_TABLE);
                tableData.string("schedule_key", { null: true, index: true });
                for (const sql of await db.alterTableSQLs(tableData))
                    await db.query(sql);
                db.clearSchemaCache();
            }
        }
        finally {
            await db.releaseAdvisoryLock(lockName);
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
        const lockName = `${MIGRATION_SCOPE}:queue_column`;
        const acquired = await db.acquireAdvisoryLock(lockName);
        if (!acquired)
            throw new Error("Failed to acquire background jobs queue schema lock");
        try {
            // SQL Server schema reads can deadlock with a concurrent ALTER TABLE, so
            // acquire the lock before inspecting the column rather than only
            // protecting the mutation (mirrors the concurrency-column migration).
            db.clearSchemaCache();
            const lockedTable = await db.getTableByNameOrFail(JOBS_TABLE);
            if (!(await lockedTable.getColumnByName("queue"))) {
                const tableData = new TableData(JOBS_TABLE);
                tableData.string("queue", { null: true, index: true });
                for (const sql of await db.alterTableSQLs(tableData))
                    await db.query(sql);
                db.clearSchemaCache();
            }
        }
        finally {
            await db.releaseAdvisoryLock(lockName);
        }
    }
    /**
     * Runs backfill execution modes once.
     * @param {import("../database/drivers/base.js").default} db - Database connection.
     * @returns {Promise<void>} - Resolves when complete.
     */
    async _backfillExecutionModesOnce(db) {
        const migrationVersion = EXECUTION_MODE_BACKFILL_MIGRATION_VERSION;
        const migrationKey = this._migrationKey(migrationVersion);
        if (await this._hasMigration(db, migrationVersion))
            return;
        await db.acquireAdvisoryLock(migrationKey);
        try {
            if (await this._hasMigration(db, migrationVersion))
                return;
            // A table created after the `forked` column was dropped has nothing to
            // backfill from; record the migration so it is not re-attempted.
            db.clearSchemaCache();
            if (!(await (await db.getTableByNameOrFail(JOBS_TABLE)).getColumnByName("forked"))) {
                await this._recordMigration(db, migrationVersion);
                return;
            }
            const tableNameSql = db.quoteTable(JOBS_TABLE);
            const forkedColumnSql = db.quoteColumn("forked");
            const executionModeColumnSql = db.quoteColumn("execution_mode");
            await db.query(`UPDATE ${tableNameSql} SET ${executionModeColumnSql} = ${db.quote("forked")} ` +
                `WHERE ${forkedColumnSql} = ${db.quote(true)} AND ${executionModeColumnSql} IS NULL`);
            await db.query(`UPDATE ${tableNameSql} SET ${executionModeColumnSql} = ${db.quote("inline")} ` +
                `WHERE ${forkedColumnSql} = ${db.quote(false)} AND ${executionModeColumnSql} IS NULL`);
            await this._recordMigration(db, migrationVersion);
        }
        finally {
            await db.releaseAdvisoryLock(migrationKey);
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
        const migrationVersion = DROP_FORKED_COLUMN_MIGRATION_VERSION;
        const migrationKey = this._migrationKey(migrationVersion);
        if (await this._hasMigration(db, migrationVersion))
            return;
        await db.acquireAdvisoryLock(migrationKey);
        try {
            if (await this._hasMigration(db, migrationVersion))
                return;
            db.clearSchemaCache();
            if (await (await db.getTableByNameOrFail(JOBS_TABLE)).getColumnByName("forked")) {
                const tableNameSql = db.quoteTable(JOBS_TABLE);
                const executionModeColumnSql = db.quoteColumn("execution_mode");
                const handoffIdColumnSql = db.quoteColumn("handoff_id");
                // Pooled rows used to persist as execution_mode "forked" + a pooled handoff
                // marker; recover their real mode before the marker is cleared.
                await db.query(`UPDATE ${tableNameSql} SET ${executionModeColumnSql} = ${db.quote("pooled")} ` +
                    `WHERE ${executionModeColumnSql} = ${db.quote("forked")} ` +
                    `AND ${handoffIdColumnSql} LIKE ${db.quote(`${LEGACY_POOLED_HANDOFF_ID_PREFIX}%`)}`);
                // The queued-pooled marker was a sentinel, not a real lease; clear it.
                await db.query(`UPDATE ${tableNameSql} SET ${handoffIdColumnSql} = NULL ` +
                    `WHERE ${handoffIdColumnSql} = ${db.quote(LEGACY_POOLED_QUEUED_HANDOFF_ID)}`);
                const dropForked = new TableData(JOBS_TABLE);
                dropForked.addColumn("forked", { dropColumn: true });
                for (const sql of await db.alterTableSQLs(dropForked))
                    await db.query(sql);
                db.clearSchemaCache();
            }
            await this._recordMigration(db, migrationVersion);
        }
        finally {
            await db.releaseAdvisoryLock(migrationKey);
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
        });
    }
    async _initializeModel() {
        if (BackgroundJobRecord.isInitialized())
            return;
        BackgroundJobRecord.setDatabaseIdentifier(this.getDatabaseIdentifier());
        const pool = this.configuration.getDatabasePool(this.getDatabaseIdentifier());
        await pool.withConnection({ name: "Background jobs store initialize model" }, async () => {
            await BackgroundJobRecord.initializeRecord({ configuration: this.configuration });
        });
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
            .where({ id: jobId })
            .limit(1);
        const rows = await query.results();
        if (!rows[0])
            return null;
        return this._normalizeJobRow(rows[0]);
    }
    /**
     * Releases ownership only when the key still points at the expected job.
     * @param {import("../database/drivers/base.js").default} db - Database connection.
     * @param {object} args - Ownership identity.
     * @param {string} args.jobId - Expected owner job id.
     * @param {string} args.scheduleKey - Stable schedule key.
     * @returns {Promise<void>} - Resolves when deleted or already superseded.
     */
    async _releaseScheduleOwnership(db, { jobId, scheduleKey }) {
        await db.delete({
            tableName: SCHEDULE_KEYS_TABLE,
            conditions: { job_id: jobId, schedule_key: scheduleKey }
        });
    }
    /**
     * Releases a job's ownership when it has a historical schedule key.
     * @param {import("../database/drivers/base.js").default} db - Database connection.
     * @param {import("./types.js").BackgroundJobRow} job - Terminal job.
     * @returns {Promise<void>} - Resolves when deleted or not applicable.
     */
    async _releaseScheduleOwnershipForJob(db, job) {
        if (!job.scheduleKey)
            return;
        await this._releaseScheduleOwnership(db, { jobId: job.id, scheduleKey: job.scheduleKey });
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
    async _applyFailure({ db, job, error, markOrphaned, conditions }) {
        const now = Date.now();
        const nextAttempt = (job.attempts || 0) + 1;
        const maxRetries = this._normalizeMaxRetries(job.maxRetries);
        const shouldRetry = nextAttempt <= maxRetries;
        const failureMessage = normalizeBackgroundJobError(error);
        const scheduledAt = shouldRetry ? now + this.getRetryDelayMs(nextAttempt) : job.scheduledAtMs;
        const queuedConcurrency = shouldRetry ? await this._requeuedJobConcurrency(db, job) : null;
        const update = this._failureUpdate({
            failureMessage,
            markOrphaned,
            nextAttempt,
            now,
            queuedConcurrency,
            scheduledAt,
            shouldRetry
        });
        await this._lockConcurrencyRow(db, job.concurrencyKey);
        const affectedRows = await this._updateAffectedRows(db, {
            tableName: JOBS_TABLE,
            data: update,
            conditions: conditions ?? this._activeHandoffConditions(job)
        });
        if (affectedRows !== 1)
            return null;
        if (!shouldRetry)
            await this._releaseScheduleOwnershipForJob(db, job);
        await this._releaseConcurrency(db, job.concurrencyKey);
        // Return a snapshot of the transition this update just applied rather than re-reading the row.
        // We won the conditional update (affectedRows === 1), so this state is authoritative; re-reading
        // could instead observe a newer state if another dispatcher reclaims a requeued job between the
        // update and the read (overlapping mains / polling dispatch), which would misreport the
        // status/terminal/willRetry of this transition to failure/orphan event listeners.
        const status = shouldRetry ? "queued" : (markOrphaned ? "orphaned" : "failed");
        /** @type {import("./types.js").BackgroundJobRow} */
        const transitionedJob = {
            ...job,
            attempts: nextAttempt,
            handedOffAtMs: null,
            lastError: failureMessage,
            status,
            workerId: null
        };
        if (queuedConcurrency) {
            transitionedJob.concurrencyKey = queuedConcurrency.concurrencyKey;
            transitionedJob.maxConcurrency = queuedConcurrency.maxConcurrency;
        }
        if (markOrphaned)
            transitionedJob.orphanedAtMs = now;
        if (shouldRetry) {
            transitionedJob.scheduledAtMs = scheduledAt;
        }
        else if (!markOrphaned) {
            transitionedJob.failedAtMs = now;
        }
        return transitionedJob;
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
    _failureUpdate({ failureMessage, markOrphaned, nextAttempt, now, queuedConcurrency, scheduledAt, shouldRetry }) {
        /**
         * Update.
         * @type {Record<string, ReturnType<typeof JSON.parse>>} */
        const update = {
            attempts: nextAttempt,
            handed_off_at_ms: null,
            worker_id: null,
            last_error: failureMessage
        };
        if (queuedConcurrency) {
            update.concurrency_key = queuedConcurrency.concurrencyKey;
            update.max_concurrency = queuedConcurrency.maxConcurrency;
        }
        this._applyOrphanedFailureUpdate({ markOrphaned, now, update });
        this._applyFailureStatusUpdate({ markOrphaned, now, scheduledAt, shouldRetry, update });
        return update;
    }
    /**
     * Runs apply orphaned failure update.
     * @param {object} args - Options.
     * @param {boolean} args.markOrphaned - Whether marking orphaned.
     * @param {number} args.now - Current timestamp.
     * @param {Record<string, ReturnType<typeof JSON.parse>>} args.update - Database update data.
     * @returns {void}
     */
    _applyOrphanedFailureUpdate({ markOrphaned, now, update }) {
        if (markOrphaned)
            update.orphaned_at_ms = now;
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
    _applyFailureStatusUpdate({ markOrphaned, now, scheduledAt, shouldRetry, update }) {
        if (shouldRetry) {
            update.status = "queued";
            update.scheduled_at_ms = scheduledAt;
            return;
        }
        if (markOrphaned) {
            update.status = "orphaned";
            return;
        }
        update.status = "failed";
        update.failed_at_ms = now;
    }
    /**
     * Runs normalize job row.
     * @param {Record<string, ReturnType<typeof JSON.parse>>} row - Raw database row.
     * @returns {import("./types.js").BackgroundJobRow} - Normalized job row.
     */
    _normalizeJobRow(row) {
        const handoffId = row.handoff_id ? String(row.handoff_id) : null;
        // `execution_mode` is the single source of truth for a job's runtime and is
        // written on every enqueue; the drop-forked migration backfills any pre-existing
        // rows before the legacy `forked` column is removed.
        const executionMode = row.execution_mode ? this._normalizeExecutionModeName(String(row.execution_mode)) : DEFAULT_BACKGROUND_JOB_EXECUTION_MODE;
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
        };
    }
    /**
     * Normalizes a job's queue name, defaulting to "default".
     * @param {import("./types.js").BackgroundJobOptions | undefined} options - Job options.
     * @returns {string} - Queue name.
     */
    _normalizeQueue(options) {
        return normalizeBackgroundJobQueue(options);
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
        });
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
            return { concurrencyKey: job.concurrencyKey, maxConcurrency: job.maxConcurrency };
        }
        const concurrency = this._resolveConcurrency({}, job.queue);
        if (!concurrency)
            return { concurrencyKey: null, maxConcurrency: null };
        await this._ensureQueueConcurrencyKey(db, concurrency);
        return { concurrencyKey: concurrency.concurrencyKey, maxConcurrency: concurrency.maxConcurrency };
    }
    /**
     * Reads the configured max concurrency for a queue from the background-jobs config.
     * @param {string} queue - Queue name.
     * @returns {number | null} - Positive integer cap, or null when the queue has no configured cap.
     */
    _queueMaxConcurrency(queue) {
        const queues = this.configuration.getBackgroundJobsConfig().queues;
        const cap = queues?.[queue]?.maxConcurrent;
        if (Number.isInteger(cap) && Number(cap) > 0)
            return Number(cap);
        return null;
    }
    /**
     * Like {@link _ensureConcurrencyKey}, but for queue-derived keys the configured
     * queue cap is the source of truth: if it changed, update the stored cap
     * instead of throwing on conflict (config-driven caps must be tunable).
     * @param {import("../database/drivers/base.js").default} db - Database connection.
     * @param {{concurrencyKey: string, maxConcurrency: number}} concurrency - Concurrency configuration.
     * @returns {Promise<void>} - Resolves when ensured.
     */
    async _ensureQueueConcurrencyKey(db, { concurrencyKey, maxConcurrency }) {
        const rows = await db.newQuery().from(CONCURRENCY_TABLE).where({ concurrency_key: concurrencyKey }).limit(1).results();
        if (!rows[0]) {
            try {
                await db.insert({ tableName: CONCURRENCY_TABLE, data: { active_count: 0, concurrency_key: concurrencyKey, max_concurrency: maxConcurrency } });
                return;
            }
            catch (error) {
                const racedRows = await db.newQuery().from(CONCURRENCY_TABLE).where({ concurrency_key: concurrencyKey }).limit(1).results();
                if (!racedRows[0])
                    throw error;
                rows[0] = racedRows[0];
            }
        }
        const configured = /** @type {{max_concurrency?: number | string}} */ (rows[0]);
        if (this._normalizeNumber(configured.max_concurrency) !== maxConcurrency) {
            const table = db.quoteTable(CONCURRENCY_TABLE);
            await db.query(`UPDATE ${table} SET ${db.quoteColumn("max_concurrency")} = ${Number(maxConcurrency)} WHERE ${db.quoteColumn("concurrency_key")} = ${db.quote(concurrencyKey)}`);
        }
    }
    /**
     * Ensures the concurrency state table exists.
     * @param {import("../database/drivers/base.js").default} db - Database connection.
     * @returns {Promise<void>} - Resolves when ready.
     */
    async _ensureConcurrencyTable(db) {
        if (await db.tableExists(CONCURRENCY_TABLE))
            return;
        const table = new TableData(CONCURRENCY_TABLE, { ifNotExists: true });
        table.string("concurrency_key", { primaryKey: true });
        table.integer("max_concurrency", { null: false });
        table.integer("active_count", { null: false });
        await db.createTable(table);
    }
    /**
     * Ensures the stable schedule-key ownership table exists.
     * @param {import("../database/drivers/base.js").default} db - Database connection.
     * @returns {Promise<void>} - Resolves when ready.
     */
    async _ensureScheduleKeysTable(db) {
        if (await db.tableExists(SCHEDULE_KEYS_TABLE))
            return;
        const lockName = `${MIGRATION_SCOPE}:schedule_keys_table`;
        const acquired = await db.acquireAdvisoryLock(lockName);
        if (!acquired)
            throw new Error("Failed to acquire background jobs schedule-key table schema lock");
        try {
            db.clearSchemaCache();
            if (await db.tableExists(SCHEDULE_KEYS_TABLE))
                return;
            const table = new TableData(SCHEDULE_KEYS_TABLE, { ifNotExists: true });
            table.string("schedule_key", { primaryKey: true });
            table.string("job_id", { null: false, index: true });
            await db.createTable(table);
            db.clearSchemaCache();
        }
        finally {
            await db.releaseAdvisoryLock(lockName);
        }
    }
    /**
     * Ensures durable generic enqueue ownership exists independently of job rows.
     * @param {import("../database/drivers/base.js").default} db - Database connection.
     * @returns {Promise<void>} - Resolves when ready.
     */
    async _ensureIdempotencyKeysTable(db) {
        if (await db.tableExists(IDEMPOTENCY_KEYS_TABLE))
            return;
        const lockName = `${MIGRATION_SCOPE}:idempotency_keys_table`;
        const acquired = await db.acquireAdvisoryLock(lockName);
        if (!acquired)
            throw new Error("Failed to acquire background job idempotency-key table schema lock");
        try {
            db.clearSchemaCache();
            if (await db.tableExists(IDEMPOTENCY_KEYS_TABLE))
                return;
            const table = new TableData(IDEMPOTENCY_KEYS_TABLE, { ifNotExists: true });
            table.string("scope_digest", { primaryKey: true });
            table.string("job_name", { null: false });
            table.string("queue", { null: false });
            table.text("idempotency_key", { null: false });
            table.string("job_id", { index: true, null: false });
            table.string("request_digest", { null: false });
            table.bigint("created_at_ms", { null: false });
            await db.createTable(table);
            db.clearSchemaCache();
        }
        finally {
            await db.releaseAdvisoryLock(lockName);
        }
    }
    /**
     * Ensures durable provider-backed mail operation state exists independently of jobs.
     * @param {import("../database/drivers/base.js").default} db - Database connection.
     * @returns {Promise<void>} - Resolves when ready.
     */
    async _ensureMailDeliveryOperationsTable(db) {
        if (await db.tableExists(MAIL_DELIVERY_OPERATIONS_TABLE))
            return;
        const lockName = `${MIGRATION_SCOPE}:mail_delivery_operations_table`;
        const acquired = await db.acquireAdvisoryLock(lockName);
        if (!acquired)
            throw new Error("Failed to acquire mail delivery operation table schema lock");
        try {
            db.clearSchemaCache();
            if (await db.tableExists(MAIL_DELIVERY_OPERATIONS_TABLE))
                return;
            const table = new TableData(MAIL_DELIVERY_OPERATIONS_TABLE, { ifNotExists: true });
            table.string("operation_key", { primaryKey: true });
            table.text("operation_id", { null: false });
            table.string("payload_digest", { null: false });
            table.string("background_job_id", { index: true, null: false });
            table.bigint("first_attempt_started_at_ms", { null: true });
            table.string("provider_kind", { null: false });
            table.bigint("provider_retention_ms", { null: false });
            table.bigint("created_at_ms", { null: false });
            await db.createTable(table);
            db.clearSchemaCache();
        }
        finally {
            await db.releaseAdvisoryLock(lockName);
        }
    }
    /**
     * Ensures the singleton durable count-revision row exists.
     * @param {import("../database/drivers/base.js").default} db - Database connection.
     * @returns {Promise<void>} Resolves when ready.
     */
    async _ensureCountRevisionTable(db) {
        if (!(await db.tableExists(COUNTS_REVISION_TABLE))) {
            const table = new TableData(COUNTS_REVISION_TABLE, { ifNotExists: true });
            table.string("key", { primaryKey: true });
            table.bigint("revision", { null: false });
            await db.createTable(table);
        }
        const rows = await db.newQuery().from(COUNTS_REVISION_TABLE).where({ key: COUNTS_REVISION_KEY }).limit(1).results();
        if (rows.length > 0)
            return;
        try {
            await db.insert({ tableName: COUNTS_REVISION_TABLE, data: { key: COUNTS_REVISION_KEY, revision: 0 } });
        }
        catch (error) {
            const racedRows = await db.newQuery().from(COUNTS_REVISION_TABLE).where({ key: COUNTS_REVISION_KEY }).limit(1).results();
            if (racedRows.length === 0)
                throw error;
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
        const deltas = {};
        for (const bucket of BACKGROUND_JOB_COUNT_BUCKETS) {
            const amount = requestedDeltas[bucket] || 0;
            if (!Number.isInteger(amount))
                throw new Error(`Invalid background job count delta for ${bucket}: ${amount}`);
            if (amount !== 0)
                deltas[bucket] = amount;
        }
        if (Object.keys(deltas).length === 0)
            return;
        const table = db.quoteTable(COUNTS_REVISION_TABLE);
        const revisionColumn = db.quoteColumn("revision");
        const affectedRows = await db.affectedRows(`UPDATE ${table} SET ${revisionColumn} = ${revisionColumn} + 1 WHERE ${db.quoteColumn("key")} = ${db.quote(COUNTS_REVISION_KEY)}`);
        if (affectedRows !== 1)
            throw new Error("Background job count revision row is missing");
        const revision = await this._countRevision(db);
        const body = { deltas, revision, type: "background-job-count-delta" };
        const databaseIdentifier = this.getDatabaseIdentifier() || "default";
        await db.afterCommit(() => {
            this.configuration.broadcastToChannel(BACKGROUND_JOB_COUNTS_CHANNEL, { databaseIdentifier }, body);
        });
    }
    /**
     * Records a transition between persisted statuses.
     * @param {import("../database/drivers/base.js").default} db - Transaction connection.
     * @param {string} oldStatus - Previous status.
     * @param {string} newStatus - New status.
     * @returns {Promise<void>} Resolves when recorded.
     */
    async _recordStatusTransition(db, oldStatus, newStatus) {
        const oldCounted = COUNTED_JOB_STATUSES.includes(oldStatus);
        const newCounted = COUNTED_JOB_STATUSES.includes(newStatus);
        if (!oldCounted && oldStatus !== "cancelled")
            throw new Error(`Unknown previous background job status: ${oldStatus}`);
        if (!newCounted && newStatus !== "cancelled")
            throw new Error(`Unknown next background job status: ${newStatus}`);
        if (oldStatus === newStatus)
            return;
        /** @type {Record<string, number>} */
        const deltas = {};
        if (oldCounted)
            deltas[oldStatus] = -1;
        if (newCounted)
            deltas[newStatus] = 1;
        if (oldCounted !== newCounted)
            deltas.all = newCounted ? 1 : -1;
        await this._recordCountDelta(db, deltas);
    }
    /**
     * Reads the locked revision.
     * @param {import("../database/drivers/base.js").default} db - Database connection.
     * @returns {Promise<number>} Revision.
     */
    async _countRevision(db) {
        const rows = await db.newQuery().from(COUNTS_REVISION_TABLE).select("revision").where({ key: COUNTS_REVISION_KEY }).limit(1).results();
        const revision = this._normalizeNumber(/** @type {Record<string, ReturnType<typeof JSON.parse>>} */ (rows[0] || {}).revision);
        if (revision === null || !Number.isSafeInteger(revision) || revision < 0) {
            throw new Error(`Invalid background job count revision: ${revision}`);
        }
        return revision;
    }
    /**
     * Takes a portable write lock on the singleton revision row.
     * @param {import("../database/drivers/base.js").default} db - Database connection.
     * @returns {Promise<void>} Resolves when locked.
     */
    async _lockCountRevision(db) {
        const table = db.quoteTable(COUNTS_REVISION_TABLE);
        const revision = db.quoteColumn("revision");
        await db.query(`UPDATE ${table} SET ${revision} = ${revision} WHERE ${db.quoteColumn("key")} = ${db.quote(COUNTS_REVISION_KEY)}`);
    }
    /**
     * Builds zeroed canonical buckets.
     * @returns {Record<string, number>} Zeroed canonical buckets.
     */
    _emptyCountBuckets() {
        return Object.fromEntries(BACKGROUND_JOB_COUNT_BUCKETS.map((bucket) => [bucket, 0]));
    }
    /**
     * Counts normalized rows by canonical status.
     * @param {import("./types.js").BackgroundJobRow[]} jobs - Jobs.
     * @returns {Record<string, number>} Counts.
     */
    _statusCounts(jobs) {
        /** @type {Record<string, number>} */
        const counts = {};
        for (const job of jobs) {
            if (!COUNTED_JOB_STATUSES.includes(job.status))
                throw new Error(`Unknown background job status: ${job.status}`);
            counts[job.status] = (counts[job.status] || 0) + 1;
        }
        return counts;
    }
    /**
     * Reads a canonical snapshot after locking the revision row.
     * @param {import("../database/drivers/base.js").default} db - Transaction connection.
     * @returns {Promise<{counts: Record<string, number>, revision: number, total: number}>} Snapshot.
     */
    async _countSnapshotOnLockedConnection(db) {
        const rows = await db.newQuery().from(JOBS_TABLE).select("status").select("COUNT(*) AS count").group("status").results();
        const counts = this._emptyCountBuckets();
        let total = 0;
        for (const row of rows) {
            const typedRow = /** @type {Record<string, ReturnType<typeof JSON.parse>>} */ (row);
            const status = String(typedRow.status);
            const count = this._normalizeNumber(typedRow.count) || 0;
            total += count;
            if (!COUNTED_JOB_STATUSES.includes(status))
                continue;
            counts[status] = count;
            counts.all += counts[status];
        }
        return { counts, revision: await this._countRevision(db), total };
    }
    /**
     * Registers or verifies a stable key configuration.
     * @param {import("../database/drivers/base.js").default} db - Database connection.
     * @param {object} concurrency - Concurrency configuration.
     * @param {string} concurrency.concurrencyKey - Concurrency key.
     * @param {number} concurrency.maxConcurrency - Stable cap.
     * @returns {Promise<void>} - Resolves when verified.
     */
    async _ensureConcurrencyKey(db, { concurrencyKey, maxConcurrency }) {
        const rows = await db.newQuery().from(CONCURRENCY_TABLE).where({ concurrency_key: concurrencyKey }).limit(1).results();
        if (!rows[0]) {
            try {
                await db.insert({ tableName: CONCURRENCY_TABLE, data: { active_count: 0, concurrency_key: concurrencyKey, max_concurrency: maxConcurrency } });
                return;
            }
            catch (error) {
                const racedRows = await db.newQuery().from(CONCURRENCY_TABLE).where({ concurrency_key: concurrencyKey }).limit(1).results();
                if (!racedRows[0])
                    throw error;
                rows[0] = racedRows[0];
            }
        }
        const configured = /** @type {{max_concurrency?: number | string}} */ (rows[0]);
        if (this._normalizeNumber(configured.max_concurrency) !== maxConcurrency)
            throw new Error(`Conflicting maxConcurrency for background job concurrencyKey: ${concurrencyKey}`);
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
        if (!concurrencyKey)
            return;
        const table = db.quoteTable(CONCURRENCY_TABLE);
        const count = db.quoteColumn("active_count");
        await db.query(`UPDATE ${table} SET ${count} = ${count} WHERE ${db.quoteColumn("concurrency_key")} = ${db.quote(concurrencyKey)}`);
    }
    /**
     * Atomically reserves capacity for a key.
     * @param {import("../database/drivers/base.js").default} db - Database connection.
     * @param {string} concurrencyKey - Concurrency key.
     * @returns {Promise<boolean>} - Whether capacity was reserved.
     */
    async _reserveConcurrency(db, concurrencyKey) {
        const table = db.quoteTable(CONCURRENCY_TABLE);
        const count = db.quoteColumn("active_count");
        const affectedRows = await db.affectedRows(`UPDATE ${table} SET ${count} = ${count} + 1 WHERE ${db.quoteColumn("concurrency_key")} = ${db.quote(concurrencyKey)} AND ${count} < ${db.quoteColumn("max_concurrency")}`);
        return affectedRows === 1;
    }
    /**
     * Runs a portable update and returns its affected-row count.
     * @param {import("../database/drivers/base.js").default} db - Database connection.
     * @param {import("../database/drivers/base.js").UpdateSqlArgsType} args - Update options.
     * @returns {Promise<number>} - Affected row count.
     */
    async _updateAffectedRows(db, args) {
        return await db.affectedRows(db.updateSql(args));
    }
    /**
     * Releases capacity for a key.
     * @param {import("../database/drivers/base.js").default} db - Database connection.
     * @param {string | null} concurrencyKey - Concurrency key.
     * @returns {Promise<void>} - Resolves when released.
     */
    async _releaseConcurrency(db, concurrencyKey) {
        if (!concurrencyKey)
            return;
        const table = db.quoteTable(CONCURRENCY_TABLE);
        const count = db.quoteColumn("active_count");
        await db.query(`UPDATE ${table} SET ${count} = ${count} - 1 WHERE ${db.quoteColumn("concurrency_key")} = ${db.quote(concurrencyKey)} AND ${count} > 0`);
    }
    /**
     * Rebuilds durable counts from active handoffs.
     * @param {import("../database/drivers/base.js").default} db - Database connection.
     * @param {{insideTransaction?: boolean}} [options] - Reuse an enclosing transaction.
     * @returns {Promise<import("./types.js").BackgroundJobConcurrencyReconciliation>} - Repair summary.
     */
    async _reconcileConcurrency(db, { insideTransaction = false } = {}) {
        if (!(await db.tableExists(CONCURRENCY_TABLE))) {
            return { candidateCount: 0, checkedCount: 0, repairedCount: 0, repairs: [], repairsTruncatedCount: 0 };
        }
        const activeRows = await db
            .newQuery()
            .from(JOBS_TABLE)
            .select("concurrency_key")
            .select("COUNT(*) AS active_count")
            .where({ status: "handed_off" })
            .where(`${db.quoteColumn("concurrency_key")} IS NOT NULL`)
            .group("concurrency_key")
            .results();
        const staleRows = await db
            .newQuery()
            .from(CONCURRENCY_TABLE)
            .select("concurrency_key")
            .select("active_count")
            .where(`${db.quoteColumn("active_count")} != 0`)
            .results();
        /** @type {Map<string, number>} */
        const activeCounts = new Map();
        /** @type {Map<string, number>} */
        const persistedCounts = new Map();
        for (const rawRow of activeRows) {
            const row = /** @type {BackgroundJobConcurrencyCountRow} */ (rawRow);
            activeCounts.set(row.concurrency_key, this._validatedConcurrencyCount(row.active_count, row.concurrency_key));
        }
        for (const rawRow of staleRows) {
            const row = /** @type {BackgroundJobConcurrencyCountRow} */ (rawRow);
            persistedCounts.set(row.concurrency_key, this._validatedConcurrencyCount(row.active_count, row.concurrency_key));
        }
        const concurrencyKeys = [...new Set([...activeCounts.keys(), ...persistedCounts.keys()])].sort();
        const candidateKeys = concurrencyKeys.filter((concurrencyKey) => {
            return (activeCounts.get(concurrencyKey) || 0) !== (persistedCounts.get(concurrencyKey) || 0);
        });
        /** @type {import("./types.js").BackgroundJobConcurrencyRepair[]} */
        const repairs = [];
        let repairedCount = 0;
        for (const concurrencyKey of candidateKeys) {
            const repair = insideTransaction
                ? await this._reconcileConcurrencyKey(db, concurrencyKey)
                : await this._transactionResult(db, async () => await this._reconcileConcurrencyKey(db, concurrencyKey));
            if (!repair)
                continue;
            repairedCount++;
            if (repairs.length < CONCURRENCY_REPAIR_SAMPLE_LIMIT)
                repairs.push(repair);
        }
        return {
            candidateCount: candidateKeys.length,
            checkedCount: concurrencyKeys.length,
            repairedCount,
            repairs,
            repairsTruncatedCount: repairedCount - repairs.length
        };
    }
    /**
     * Rebuilds one counter after locking it ahead of the job rows, matching the
     * lock order used by handoff and completion transitions.
     * @param {import("../database/drivers/base.js").default} db - Database connection.
     * @param {string} concurrencyKey - Counter key.
     * @returns {Promise<import("./types.js").BackgroundJobConcurrencyRepair | null>} - Applied repair.
     */
    async _reconcileConcurrencyKey(db, concurrencyKey) {
        await this._lockConcurrencyRow(db, concurrencyKey);
        const persistedRows = await db
            .newQuery()
            .from(CONCURRENCY_TABLE)
            .select("active_count")
            .select("concurrency_key")
            .where({ concurrency_key: concurrencyKey })
            .limit(1)
            .results();
        if (!persistedRows[0])
            throw new Error(`Missing background job concurrency counter for ${concurrencyKey}`);
        const persistedRow = /** @type {BackgroundJobConcurrencyCountRow} */ (persistedRows[0]);
        const previousActiveCount = this._validatedConcurrencyCount(persistedRow.active_count, concurrencyKey);
        const rows = await db
            .newQuery()
            .from(JOBS_TABLE)
            .select("COUNT(*) AS active_count")
            .where({ concurrency_key: concurrencyKey, status: "handed_off" })
            .results();
        const countRow = /** @type {{active_count: number | string}} */ (rows[0]);
        const activeCount = this._validatedConcurrencyCount(countRow.active_count, concurrencyKey);
        if (activeCount === previousActiveCount)
            return null;
        await db.update({
            tableName: CONCURRENCY_TABLE,
            data: { active_count: activeCount },
            conditions: { concurrency_key: concurrencyKey }
        });
        return { activeCount, concurrencyKey, previousActiveCount };
    }
    /**
     * Validates a database count before it participates in reconciliation.
     * @param {number | string} value - Raw count.
     * @param {string} concurrencyKey - Counter key for diagnostics.
     * @returns {number} - Safe non-negative count.
     */
    _validatedConcurrencyCount(value, concurrencyKey) {
        const count = this._normalizeNumber(value);
        if (count === null || !Number.isSafeInteger(count) || count < 0) {
            throw new Error(`Invalid reconciled background job concurrency count for ${concurrencyKey}: ${count}`);
        }
        return count;
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
        if (this._queueConcurrencyReconciled)
            return;
        if (!(await db.tableExists(CONCURRENCY_TABLE)))
            return;
        const queuesConfig = this.configuration.getBackgroundJobsConfig().queues || {};
        const jobsTable = db.quoteTable(JOBS_TABLE);
        const keyColumn = db.quoteColumn("concurrency_key");
        const capColumn = db.quoteColumn("max_concurrency");
        const queueColumn = db.quoteColumn("queue");
        const queued = `${db.quoteColumn("status")} = ${db.quote("queued")}`;
        /** @type {Set<string>} */
        const cappedQueues = new Set();
        for (const queue of Object.keys(queuesConfig)) {
            const cap = this._queueMaxConcurrency(queue);
            if (cap === null)
                continue;
            cappedQueues.add(queue);
            const concurrencyKey = `${QUEUE_CONCURRENCY_KEY_PREFIX}${queue}`;
            await this._ensureQueueConcurrencyKey(db, { concurrencyKey, maxConcurrency: cap });
            await db.query(`UPDATE ${jobsTable} SET ${keyColumn} = ${db.quote(concurrencyKey)}, ${capColumn} = ${Number(cap)} ` +
                `WHERE ${queueColumn} = ${db.quote(queue)} AND ${keyColumn} IS NULL AND ${queued}`);
        }
        const concurrencyRows = await db
            .newQuery()
            .from(CONCURRENCY_TABLE)
            .select("concurrency_key")
            .where(`${db.quoteColumn("concurrency_key")} LIKE ${db.quote(`${QUEUE_CONCURRENCY_KEY_PREFIX}%`)}`)
            .results();
        for (const row of concurrencyRows) {
            const concurrencyKey = String(/** @type {Record<string, ReturnType<typeof JSON.parse>>} */ (row).concurrency_key);
            if (!concurrencyKey.startsWith(QUEUE_CONCURRENCY_KEY_PREFIX))
                continue;
            if (cappedQueues.has(concurrencyKey.slice(QUEUE_CONCURRENCY_KEY_PREFIX.length)))
                continue;
            await db.query(`UPDATE ${jobsTable} SET ${keyColumn} = NULL, ${capColumn} = NULL ` +
                `WHERE ${keyColumn} = ${db.quote(concurrencyKey)} AND ${queued}`);
        }
    }
    /**
     * Runs normalize number.
     * @param {ReturnType<typeof JSON.parse>} value - Input value.
     * @returns {number | null} - Normalized number.
     */
    _normalizeNumber(value) {
        if (value === null || value === undefined || value === "")
            return null;
        const numeric = Number(value);
        if (Number.isNaN(numeric))
            return null;
        return numeric;
    }
    /**
     * Runs normalize execution mode.
     * @param {import("./types.js").BackgroundJobOptions} [options] - Job options.
     * @returns {import("./types.js").BackgroundJobExecutionMode} - Normalized execution mode.
     */
    _normalizeExecutionMode(options) {
        return normalizeBackgroundJobExecutionMode(options || {}, DEFAULT_BACKGROUND_JOB_EXECUTION_MODE);
    }
    /**
     * Runs normalize execution mode name.
     * @param {string} executionMode - Execution mode name.
     * @returns {import("./types.js").BackgroundJobExecutionMode} - Normalized execution mode.
     */
    _normalizeExecutionModeName(executionMode) {
        return normalizeBackgroundJobExecutionMode({ executionMode: /** @type {import("./types.js").BackgroundJobExecutionMode} */ (executionMode) }, DEFAULT_BACKGROUND_JOB_EXECUTION_MODE, BACKGROUND_JOB_EXECUTION_MODES);
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
    _whereExecutionMode({ db, executionMode, query }) {
        const executionModes = Array.isArray(executionMode) ? executionMode : [executionMode];
        const executionModeColumn = db.quoteColumn("execution_mode");
        const conditions = executionModes.map((mode) => `${executionModeColumn} = ${db.quote(mode)}`);
        return query.where(`(${conditions.join(" OR ")})`);
    }
    /**
     * Runs parse args.
     * @param {ReturnType<typeof JSON.parse>} value - Input value.
     * @returns {Array<ReturnType<typeof JSON.parse>>} - Parsed args.
     */
    _parseArgs(value) {
        if (!value)
            return [];
        try {
            const parsed = JSON.parse(String(value));
            if (Array.isArray(parsed))
                return parsed;
        }
        catch {
            // Ignore parse errors.
        }
        return [];
    }
    /**
     * Runs with db.
     * @template T
     * @param {(db: import("../database/drivers/base.js").default) => Promise<T>} callback - Callback.
     * @returns {Promise<T>} - Callback result.
     */
    async _withDb(callback) {
        const databaseIdentifier = this.getDatabaseIdentifier();
        const pool = this.configuration.getDatabasePool(databaseIdentifier);
        if (!pool.testSharedConnection()) {
            return await pool.withConnection({ name: "Background jobs store" }, callback);
        }
        return await this.configuration.runWithTestSharedConnectionContexts(async () => {
            return await this.configuration.ensureConnections({ databaseIdentifiers: [databaseIdentifier], name: "Background jobs store" }, async (dbs) => {
                const connection = dbs[databaseIdentifier];
                return await coordinateSharedTransactionConnection(connection, async () => await callback(connection));
            });
        });
    }
    /**
     * Runs a value-returning callback inside the driver's void-typed transaction API.
     * @template T
     * @param {import("../database/drivers/base.js").default} db - Database connection.
     * @param {() => Promise<T>} callback - Transaction callback.
     * @returns {Promise<T>} - Callback result.
     */
    async _transactionResult(db, callback) {
        let completed = false;
        /** @type {T | undefined} */
        let result;
        await db.transaction(async () => {
            result = await callback();
            completed = true;
        });
        if (!completed)
            throw new Error("Background jobs transaction callback was not invoked");
        return /** @type {T} */ (result);
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
            await this._lockCountRevision(db);
            return await callback(db);
        }, options);
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
        const identifier = this.getDatabaseIdentifier() || "default";
        const previous = transactionMutationChains.get(identifier) || Promise.resolve();
        let resolveRun = () => { };
        /** @type {Promise<void>} */
        const run = new Promise((resolve) => {
            resolveRun = () => resolve(undefined);
        });
        const chain = previous.then(() => run);
        transactionMutationChains.set(identifier, chain);
        await previous;
        try {
            return await this._withDb(async (db) => {
                const { advisoryLock } = options;
                if (advisoryLock) {
                    const acquired = await db.acquireAdvisoryLock(advisoryLock.name);
                    if (!acquired)
                        throw new Error(advisoryLock.failureMessage);
                }
                try {
                    return await this._transactionResult(db, async () => await callback(db));
                }
                finally {
                    if (advisoryLock)
                        await db.releaseAdvisoryLock(advisoryLock.name);
                }
            });
        }
        finally {
            resolveRun();
            if (transactionMutationChains.get(identifier) === chain)
                transactionMutationChains.delete(identifier);
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
    _shouldAcceptReport({ job, handoffId, workerId, handedOffAtMs }) {
        if (job.status !== "handed_off")
            return false;
        return this._handoffIdReportMatches({ handoffId, job })
            && this._workerReportMatches({ job, workerId })
            && this._handoffReportMatches({ handedOffAtMs, job });
    }
    /**
     * Runs active handoff conditions.
     * @param {import("./types.js").BackgroundJobRow} job - Job row.
     * @returns {Record<string, string | null>} - Conditional transition fence.
     */
    _activeHandoffConditions(job) {
        return { handoff_id: job.handoffId, id: job.id, status: "handed_off" };
    }
    /**
     * Runs handoff id report matches.
     * @param {object} args - Options.
     * @param {string | null | undefined} args.handoffId - Handoff lease id from report.
     * @param {import("./types.js").BackgroundJobRow} args.job - Job row.
     * @returns {boolean} - Whether the handoff lease matches.
     */
    _handoffIdReportMatches({ handoffId, job }) {
        if (!job.handoffId)
            return true;
        return handoffId === job.handoffId;
    }
    /**
     * Runs worker report matches.
     * @param {object} args - Options.
     * @param {import("./types.js").BackgroundJobRow} args.job - Job row.
     * @param {string | null | undefined} args.workerId - Worker id from report.
     * @returns {boolean} - Whether the worker report matches.
     */
    _workerReportMatches({ job, workerId }) {
        if (!workerId)
            return true;
        if (!job.workerId)
            return true;
        return workerId === job.workerId;
    }
    /**
     * Runs handoff report matches.
     * @param {object} args - Options.
     * @param {number | null | undefined} args.handedOffAtMs - Handed off timestamp from report.
     * @param {import("./types.js").BackgroundJobRow} args.job - Job row.
     * @returns {boolean} - Whether the handoff report matches.
     */
    _handoffReportMatches({ handedOffAtMs, job }) {
        if (!handedOffAtMs)
            return true;
        if (!job.handedOffAtMs)
            return true;
        return handedOffAtMs === job.handedOffAtMs;
    }
    /**
     * Runs migration key.
     * @param {string} [version] - Migration version.
     * @returns {string} - Migration key.
     */
    _migrationKey(version = MIGRATION_VERSION) {
        return `${MIGRATION_SCOPE}:${version}`;
    }
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoic3RvcmUuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi9zcmMvYmFja2dyb3VuZC1qb2JzL3N0b3JlLmpzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiJBQUFBLFlBQVk7QUFFWixPQUFPLEVBQUMsVUFBVSxFQUFFLFVBQVUsRUFBQyxNQUFNLFFBQVEsQ0FBQTtBQUM3QyxPQUFPLHFCQUFxQixNQUFNLGNBQWMsQ0FBQTtBQUNoRCxPQUFPLE1BQU0sTUFBTSxjQUFjLENBQUE7QUFDakMsT0FBTyxTQUFTLE1BQU0saUNBQWlDLENBQUE7QUFDdkQsT0FBTyxjQUFjLE1BQU0sdUJBQXVCLENBQUE7QUFDbEQsT0FBTyxtQkFBbUIsTUFBTSxpQkFBaUIsQ0FBQTtBQUNqRCxPQUFPLDJCQUEyQixNQUFNLHNCQUFzQixDQUFBO0FBQzlELE9BQU8sRUFBRSxxQ0FBcUMsRUFBRSxNQUFNLHlEQUF5RCxDQUFBO0FBQy9HLE9BQU8sbUJBQW1CLE1BQU0seUJBQXlCLENBQUE7QUFDekQsT0FBTyxFQUNMLDhCQUE4QixFQUM5QixxQ0FBcUMsRUFDckMsNEJBQTRCLEVBQzVCLDRCQUE0QixFQUM1QixpQ0FBaUMsRUFDakMsbUNBQW1DLEVBQ25DLGdDQUFnQyxFQUNoQywyQkFBMkIsRUFDM0IsbUNBQW1DLEVBQ25DLDRCQUE0QixFQUM1QixZQUFZLEVBQ2IsTUFBTSxvQkFBb0IsQ0FBQTtBQUMzQixPQUFPLEVBQ0wsOEJBQThCLEVBQzlCLDJCQUEyQixFQUMzQix3QkFBd0IsRUFDekIsTUFBTSxpQ0FBaUMsQ0FBQTtBQUV4Qzs7Ozs7Ozs7Ozs7OztHQWFHO0FBRUg7Ozs7O0dBS0c7QUFFSDs7OztHQUlHO0FBRUg7Ozs7O0dBS0c7QUFFSDs7Ozs7R0FLRztBQUVILE1BQU0sZ0JBQWdCLEdBQUcsK0JBQStCLENBQUE7QUFDeEQsTUFBTSxlQUFlLEdBQUcsaUJBQWlCLENBQUE7QUFDekMsTUFBTSxpQkFBaUIsR0FBRyxnQkFBZ0IsQ0FBQTtBQUMxQyxNQUFNLCtC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SUFBSSxDQUFBO1FBQzFCLElBQUksQ0FBQyxHQUFHLENBQUMsUUFBUTtZQUFFLE9BQU8sSUFBSSxDQUFBO1FBRTlCLE9BQU8sUUFBUSxLQUFLLEdBQUcsQ0FBQyxRQUFRLENBQUE7SUFDbEMsQ0FBQztJQUVEOzs7Ozs7T0FNRztJQUNILHFCQUFxQixDQUFDLEVBQUMsYUFBYSxFQUFFLEdBQUcsRUFBQztRQUN4QyxJQUFJLENBQUMsYUFBYTtZQUFFLE9BQU8sSUFBSSxDQUFBO1FBQy9CLElBQUksQ0FBQyxHQUFHLENBQUMsYUFBYTtZQUFFLE9BQU8sSUFBSSxDQUFBO1FBRW5DLE9BQU8sYUFBYSxLQUFLLEdBQUcsQ0FBQyxhQUFhLENBQUE7SUFDNUMsQ0FBQztJQUVEOzs7O09BSUc7SUFDSCxhQUFhLENBQUMsT0FBTyxHQUFHLGlCQUFpQjtRQUN2QyxPQUFPLEdBQUcsZUFBZSxJQUFJLE9BQU8sRUFBRSxDQUFBO0lBQ3hDLENBQUM7Q0FDRiIsInNvdXJjZXNDb250ZW50IjpbIi8vIEB0cy1jaGVja1xuXG5pbXBvcnQge2NyZWF0ZUhhc2gsIHJhbmRvbVVVSUR9IGZyb20gXCJjcnlwdG9cIlxuaW1wb3J0IEJhY2tncm91bmRKb2JzQWRhcHRlciBmcm9tIFwiLi9hZGFwdGVyLmpzXCJcbmltcG9ydCBMb2dnZXIgZnJvbSBcIi4uL2xvZ2dlci5qc1wiXG5pbXBvcnQgVGFibGVEYXRhIGZyb20gXCIuLi9kYXRhYmFzZS90YWJsZS1kYXRhL2luZGV4LmpzXCJcbmltcG9ydCBWZWxvY2lvdXNFcnJvciBmcm9tIFwiLi4vdmVsb2Npb3VzLWVycm9yLmpzXCJcbmltcG9ydCBCYWNrZ3JvdW5kSm9iUmVjb3JkIGZyb20gXCIuL2pvYi1yZWNvcmQuanNcIlxuaW1wb3J0IG5vcm1hbGl6ZUJhY2tncm91bmRKb2JFcnJvciBmcm9tIFwiLi9ub3JtYWxpemUtZXJyb3IuanNcIlxuaW1wb3J0IHsgY29vcmRpbmF0ZVNoYXJlZFRyYW5zYWN0aW9uQ29ubmVjdGlvbiB9IGZyb20gXCIuLi90ZXN0aW5nL3NoYXJlZC10cmFuc2FjdGlvbi1jb25uZWN0aW9uLWNvb3JkaW5hdG9yLmpzXCJcbmltcG9ydCBzdGFibGVKc29uU3RyaW5naWZ5IGZyb20gXCIuLi91dGlscy9zdGFibGUtanNvbi5qc1wiXG5pbXBvcnQge1xuICBCQUNLR1JPVU5EX0pPQl9FWEVDVVRJT05fTU9ERVMsXG4gIERFRkFVTFRfQkFDS0dST1VORF9KT0JfRVhFQ1VUSU9OX01PREUsXG4gIERFRkFVTFRfQkFDS0dST1VORF9KT0JfUVVFVUUsXG4gIFFVRVVFX0NPTkNVUlJFTkNZX0tFWV9QUkVGSVgsXG4gIG5vcm1hbGl6ZUJhY2tncm91bmRKb2JDb25jdXJyZW5jeSxcbiAgbm9ybWFsaXplQmFja2dyb3VuZEpvYkV4ZWN1dGlvbk1vZGUsXG4gIG5vcm1hbGl6ZUJhY2tncm91bmRKb2JNYXhSZXRyaWVzLFxuICBub3JtYWxpemVCYWNrZ3JvdW5kSm9iUXVldWUsXG4gIG5vcm1hbGl6ZUJhY2tncm91bmRKb2JTY2hlZHVsZWRBdE1zLFxuICByZXNjaGVkdWxlZEJhY2tncm91bmRKb2JBdE1zLFxuICByZXRyeURlbGF5TXNcbn0gZnJvbSBcIi4vam9iLXNlbWFudGljcy5qc1wiXG5pbXBvcnQge1xuICBNQUlMX0RFTElWRVJZX09QRVJBVElPTlNfVEFCTEUsXG4gIG1haWxEZWxpdmVyeU9wZXJhdGlvbkZvckpvYixcbiAgbWFpbERlbGl2ZXJ5T3BlcmF0aW9uS2V5XG59IGZyb20gXCIuLi9tYWlsZXIvZGVsaXZlcnktb3BlcmF0aW9uLmpzXCJcblxuLyoqXG4gKiBQcmVwYXJlZEJhY2tncm91bmRKb2IgdHlwZS5cbiAqIEB0eXBlZGVmIHtvYmplY3R9IFByZXBhcmVkQmFja2dyb3VuZEpvYlxuICogQHByb3BlcnR5IHtzdHJpbmd9IGFyZ3NKc29uIC0gU2VyaWFsaXplZCBhcmd1bWVudHMuXG4gKiBAcHJvcGVydHkge3tjb25jdXJyZW5jeUtleTogc3RyaW5nLCBtYXhDb25jdXJyZW5jeTogbnVtYmVyLCBxdWV1ZURlcml2ZWQ6IGJvb2xlYW59IHwgbnVsbH0gY29uY3VycmVuY3kgLSBSZXNvbHZlZCBjb25jdXJyZW5jeS5cbiAqIEBwcm9wZXJ0eSB7bnVtYmVyfSBjcmVhdGVkQXRNcyAtIENyZWF0aW9uIHRpbWVzdGFtcC5cbiAqIEBwcm9wZXJ0eSB7aW1wb3J0KFwiLi90eXBlcy5qc1wiKS5CYWNrZ3JvdW5kSm9iRXhlY3V0aW9uTW9kZX0gZXhlY3V0aW9uTW9kZSAtIEV4ZWN1dGlvbiBtb2RlLlxuICogQHByb3BlcnR5IHtzdHJpbmd9IGpvYklkIC0gTmV3IGpvYiBpZC5cbiAqIEBwcm9wZXJ0eSB7c3RyaW5nfSBqb2JOYW1lIC0gSm9iIG5hbWUuXG4gKiBAcHJvcGVydHkge251bWJlcn0gbWF4UmV0cmllcyAtIFJldHJ5IGNhcC5cbiAqIEBwcm9wZXJ0eSB7c3RyaW5nfSBxdWV1ZSAtIFF1ZXVlIG5hbWUuXG4gKiBAcHJvcGVydHkge251bWJlcn0gc2NoZWR1bGVkQXRNcyAtIEVsaWdpYmlsaXR5IHRpbWVzdGFtcC5cbiAqIEBwcm9wZXJ0eSB7bnVtYmVyIHwgbnVsbH0gdGltZW91dE1zIC0gUGVyLWpvYiB0aW1lb3V0IG92ZXJyaWRlLCBvciBudWxsIHdoZW4gb21pdHRlZC5cbiAqL1xuXG4vKipcbiAqIEJhY2tncm91bmRKb2JPcnBoYW5TZWxlY3Rpb24gdHlwZS5cbiAqIEB0eXBlZGVmIHtvYmplY3R9IEJhY2tncm91bmRKb2JPcnBoYW5TZWxlY3Rpb25cbiAqIEBwcm9wZXJ0eSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSBjb25kaXRpb25zIC0gRXhhY3QgdXBkYXRlIGZlbmNlLlxuICogQHByb3BlcnR5IHtpbXBvcnQoXCIuL3R5cGVzLmpzXCIpLkJhY2tncm91bmRKb2JSb3d9IGpvYiAtIFNlbGVjdGVkIGFjdGl2ZSBoYW5kb2ZmLlxuICovXG5cbi8qKlxuICogQmFja2dyb3VuZEpvYlRyYW5zYWN0aW9uU2VyaWFsaXphdGlvbk9wdGlvbnMgdHlwZS5cbiAqIEB0eXBlZGVmIHtvYmplY3R9IEJhY2tncm91bmRKb2JUcmFuc2FjdGlvblNlcmlhbGl6YXRpb25PcHRpb25zXG4gKiBAcHJvcGVydHkge3tmYWlsdXJlTWVzc2FnZTogc3RyaW5nLCBuYW1lOiBzdHJpbmd9fSBbYWR2aXNvcnlMb2NrXSAtIFNlc3Npb24gbG9jayBoZWxkIGFyb3VuZCB0aGUgdHJhbnNhY3Rpb24uXG4gKi9cblxuLyoqXG4gKiBCYWNrZ3JvdW5kSm9iQ29uY3VycmVuY3lDb3VudFJvdyB0eXBlLlxuICogQHR5cGVkZWYge29iamVjdH0gQmFja2dyb3VuZEpvYkNvbmN1cnJlbmN5Q291bnRSb3dcbiAqIEBwcm9wZXJ0eSB7bnVtYmVyIHwgc3RyaW5nfSBhY3RpdmVfY291bnQgLSBQZXJzaXN0ZWQgb3IgYWdncmVnYXRlZCBhY3RpdmUgY291bnQuXG4gKiBAcHJvcGVydHkge3N0cmluZ30gY29uY3VycmVuY3lfa2V5IC0gRHVyYWJsZSBjYXAgaWRlbnRpdHkuXG4gKi9cblxuLyoqXG4gKiBCYWNrZ3JvdW5kSm9iUXVldWVkQ29uY3VycmVuY3kgdHlwZS5cbiAqIEB0eXBlZGVmIHtvYmplY3R9IEJhY2tncm91bmRKb2JRdWV1ZWRDb25jdXJyZW5jeVxuICogQHByb3BlcnR5IHtzdHJpbmcgfCBudWxsfSBjb25jdXJyZW5jeUtleSAtIEN1cnJlbnQgY29uY3VycmVuY3kga2V5IGZvciBxdWV1ZWQgd29yay5cbiAqIEBwcm9wZXJ0eSB7bnVtYmVyIHwgbnVsbH0gbWF4Q29uY3VycmVuY3kgLSBDdXJyZW50IGNvbmN1cnJlbmN5IGNhcCBmb3IgcXVldWVkIHdvcmsuXG4gKi9cblxuY29uc3QgTUlHUkFUSU9OU19UQUJMRSA9IFwidmVsb2Npb3VzX2ludGVybmFsX21pZ3JhdGlvbnNcIlxuY29uc3QgTUlHUkFUSU9OX1NDT1BFID0gXCJiYWNrZ3JvdW5kX2pvYnNcIlxuY29uc3QgTUlHUkFUSU9OX1ZFUlNJT04gPSBcIjIwMjUwMjE1MDAwMDAwXCJcbmNvbnN0IFNDSEVNQV9SRUNPVkVSWV9QRU5ESU5HX1ZFUlNJT04gPSBcInNjaGVtYS1yZWNvdmVyeS1wZW5kaW5nXCJcbmNvbnN0IEVYRUNVVElPTl9NT0RFX0JBQ0tGSUxMX01JR1JBVElPTl9WRVJTSU9OID0gXCIyMDI2MDYwNzEzMTAxMFwiXG4vLyBEcm9wcyB0aGUgcmVkdW5kYW50IGxlZ2FjeSBgZm9ya2VkYCBib29sZWFuIGNvbHVtbiBhbmQgcmV3cml0ZXMgcG9vbGVkIHJvd3MgdG9cbi8vIHBlcnNpc3QgYGV4ZWN1dGlvbl9tb2RlID0gXCJwb29sZWRcImAgZGlyZWN0bHkgKHJldGlyaW5nIHRoZSBwb29sZWQtYXMtZm9ya2VkXG4vLyBoYW5kb2ZmLW1hcmtlciB3b3JrYXJvdW5kKSwgbGVhdmluZyBgZXhlY3V0aW9uX21vZGVgIGFzIHRoZSBzaW5nbGUgc291cmNlIG9mXG4vLyB0cnV0aCBmb3IgYSBqb2IncyBydW50aW1lLlxuY29uc3QgRFJPUF9GT1JLRURfQ09MVU1OX01JR1JBVElPTl9WRVJTSU9OID0gXCIyMDI2MDcxOTAwMDAwMFwiXG5jb25zdCBKT0JTX0lOREVYX1JFUEFJUl9NSUdSQVRJT05fVkVSU0lPTiA9IFwiMjAyNjA5MDMxMjAwMDBcIlxuLy8gTGVnYWN5IG1hcmtlciBwcmVmaXggdXNlZCBieSByb3dzIHdyaXR0ZW4gYmVmb3JlIHRoaXMgbWlncmF0aW9uOiBwb29sZWQgam9ic1xuLy8gdXNlZCB0byBwZXJzaXN0IGFzIGBleGVjdXRpb25fbW9kZSA9IFwiZm9ya2VkXCJgIHBsdXMgYSBgdmVsb2Npb3VzLXBvb2xlZDoqYFxuLy8gaGFuZG9mZiBpZC4gUmV0YWluZWQgb25seSB0byBkZXRlY3QgYW5kIGNvbnZlcnQgdGhvc2Ugcm93cyBpbiB0aGUgbWlncmF0aW9uLlxuY29uc3QgTEVHQUNZX1BPT0xFRF9IQU5ET0ZGX0lEX1BSRUZJWCA9IFwidmVsb2Npb3VzLXBvb2xlZDpcIlxuY29uc3QgTEVHQUNZX1BPT0xFRF9RVUVVRURfSEFORE9GRl9JRCA9IGAke0xFR0FDWV9QT09MRURfSEFORE9GRl9JRF9QUkVGSVh9cXVldWVkYFxuY29uc3QgSk9CU19UQUJMRSA9IFwiYmFja2dyb3VuZF9qb2JzXCJcbmNvbnN0IEpPQlNfSU5ERVhfQ09MVU1OX05BTUVTID0gW1xuICBcImpvYl9uYW1lXCIsXG4gIFwicXVldWVcIixcbiAgXCJzdGF0dXNcIixcbiAgXCJzY2hlZHVsZWRfYXRfbXNcIixcbiAgXCJjcmVhdGVkX2F0X21zXCIsXG4gIFwic2NoZWR1bGVfa2V5XCIsXG4gIFwiaGFuZGVkX29mZl9hdF9tc1wiLFxuICBcIm9ycGhhbmVkX2F0X21zXCIsXG4gIFwiY29uY3VycmVuY3lfa2V5XCJcbl1cbmNvbnN0IElERU1QT1RFTkNZX0tFWVNfVEFCTEUgPSBcImJhY2tncm91bmRfam9iX2lkZW1wb3RlbmN5X2tleXNcIlxuY29uc3QgU0NIRURVTEVfS0VZU19UQUJMRSA9IFwiYmFja2dyb3VuZF9qb2Jfc2NoZWR1bGVfa2V5c1wiXG5jb25zdCBDT05DVVJSRU5DWV9UQUJMRSA9IFwiYmFja2dyb3VuZF9qb2JfY29uY3VycmVuY3lcIlxuY29uc3QgQ09VTlRTX1JFVklTSU9OX1RBQkxFID0gXCJiYWNrZ3JvdW5kX2pvYl9jb3VudF9yZXZpc2lvbnNcIlxuY29uc3QgQ09VTlRTX1JFVklTSU9OX0tFWSA9IFwiY291bnRzXCJcbmNvbnN0IENPTkNVUlJFTkNZX1JFQ09OQ0lMSUFUSU9OX0xPQ0sgPSBcImJhY2tncm91bmQtam9iczpxdWV1ZS1jb25jdXJyZW5jeS1yZWNvbmNpbGVcIlxuY29uc3QgQ09OQ1VSUkVOQ1lfUkVQQUlSX1NBTVBMRV9MSU1JVCA9IDEwXG5leHBvcnQgY29uc3QgQkFDS0dST1VORF9KT0JfQ09VTlRTX0NIQU5ORUwgPSBcInZlbG9jaW91cy1iYWNrZ3JvdW5kLWpvYi1jb3VudHNcIlxuZXhwb3J0IGNvbnN0IEJBQ0tHUk9VTkRfSk9CX0NPVU5UX0JVQ0tFVFMgPSBbXCJhbGxcIiwgXCJxdWV1ZWRcIiwgXCJoYW5kZWRfb2ZmXCIsIFwiY29tcGxldGVkXCIsIFwiZmFpbGVkXCIsIFwib3JwaGFuZWRcIl1cbmNvbnN0IENPVU5URURfSk9CX1NUQVRVU0VTID0gQkFDS0dST1VORF9KT0JfQ09VTlRfQlVDS0VUUy5zbGljZSgxKVxuY29uc3QgTUFYX0pPQl9USU1FT1VUX01TID0gMl8xNDdfNDgzXzY0N1xuY29uc3QgSk9CX1RJTUVPVVRfVkFMSURBVElPTl9NRVNTQUdFID0gYGJhY2tncm91bmQgam9iIHRpbWVvdXRNcyBtdXN0IGJlIGEgZmluaXRlIG5vbi1wb3NpdGl2ZSBudW1iZXIgb3IgYW4gaW50ZWdlciBiZXR3ZWVuIDEgYW5kICR7TUFYX0pPQl9USU1FT1VUX01TfWBcbmNvbnN0IE9SUEhBTkVEX0FGVEVSX01TID0gMiAqIDYwICogNjAgKiAxMDAwXG5cbi8qKlxuICogQ29sdW1ucyB0aGUgZGFzaGJvYXJkIGlzIGFsbG93ZWQgdG8gc29ydCBqb2IgbGlzdGluZ3MgYnksIG1hcHBlZCB0byB0aGVpclxuICogZGF0YWJhc2UgY29sdW1uIG5hbWVzLiBSZXN0cmljdGluZyB0byB0aGlzIHNldCBrZWVwcyB0aGUgc29ydCBwYXJhbWV0ZXJcbiAqICh3aGljaCBvcmlnaW5hdGVzIGZyb20gdW50cnVzdGVkIHF1ZXJ5IHN0cmluZ3MpIGZyb20gcmVhY2hpbmcgcmF3IFNRTC5cbiAqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBzdHJpbmc+fVxuICovXG5jb25zdCBTT1JUQUJMRV9DT0xVTU5TID0ge1xuICBhdHRlbXB0czogXCJhdHRlbXB0c1wiLFxuICBjb21wbGV0ZWRBdE1zOiBcImNvbXBsZXRlZF9hdF9tc1wiLFxuICBjcmVhdGVkQXRNczogXCJjcmVhdGVkX2F0X21zXCIsXG4gIGZhaWxlZEF0TXM6IFwiZmFpbGVkX2F0X21zXCIsXG4gIGhhbmRlZE9mZkF0TXM6IFwiaGFuZGVkX29mZl9hdF9tc1wiLFxuICBzY2hlZHVsZWRBdE1zOiBcInNjaGVkdWxlZF9hdF9tc1wiXG59XG5cbi8qKlxuICogU2VyaWFsaXplcyBjb25jdXJyZW50IGBfYXBwbHlTY2hlbWFgIHJ1bnMgd2l0aGluIFRISVMgcHJvY2Vzcywga2V5ZWQgYnkgZGF0YWJhc2VcbiAqIGlkZW50aWZpZXIsIGJlZm9yZSBjYWxsZXJzIHdpdGhvdXQgYW4gZXhpc3RpbmcgY29ubmVjdGlvbiBjaGVjayBvbmUgb3V0LiBUd29cbiAqIHN0b3JlcyB0aGF0IHNoYXJlIG9uZSBjb25uZWN0aW9uIChTaW5nbGVNdWx0aVVzZSAvIFNRTGl0ZSlcbiAqIG90aGVyd2lzZSBpbnRlcmxlYXZlIHRoZSBtdWx0aS1zdGVwIHRhYmxlIHJlYnVpbGQgYW5kIGNvcnJ1cHQgaXQgKHRoZSBqb2JzIHRhYmxlXG4gKiBpcyBsZWZ0IGFzIGl0cyBgKl92ZWxvY2lvdXNfcmVidWlsZGAgdGVtcCkuIEEgREIgYWR2aXNvcnkgbG9jayBjYW4ndCBmaXggdGhhdDogb25cbiAqIGEgc2Vzc2lvbi1zY29wZWQgLyByZS1lbnRyYW50IGRyaXZlciAoTXlTUUwgYEdFVF9MT0NLYCkgYSBzZWNvbmQgYWNxdWlyZSBvbiB0aGVcbiAqIHNhbWUgc2Vzc2lvbiBzdWNjZWVkcyBpbW1lZGlhdGVseSBzbyBib3RoIGNhbGxlcnMgcHJvY2VlZCwgYW5kIHRha2luZyBpdCBvbiBhXG4gKiBzZXBhcmF0ZSBjb25uZWN0aW9uIGJsb2NrcyBjcm9zcy1zZXNzaW9uIGZvcmV2ZXIuIEFuIGluLXByb2Nlc3MgcHJvbWlzZS1jaGFpblxuICogbXV0ZXggc2VyaWFsaXplcyBzYW1lLXByb2Nlc3MgY2FsbGVycyB3aXRoIG5laXRoZXIgaGF6YXJkLiBDcm9zcy1wcm9jZXNzIHNjaGVtYVxuICogcmFjZXMgc3RheSBjb3ZlcmVkIGJ5IHRoZSBwZXItc3RlcCBhZHZpc29yeSBsb2NrcyArIHJlY2hlY2tzIGluc2lkZSB0aGUgc3RlcHMuXG4gKiBAdHlwZSB7TWFwPHN0cmluZywgUHJvbWlzZTx2b2lkPj59XG4gKi9cbmNvbnN0IHNjaGVtYUFwcGx5Q2hhaW5zID0gbmV3IE1hcCgpXG4vKiogQHR5cGUge01hcDxzdHJpbmcsIFByb21pc2U8dm9pZD4+fSAqL1xuY29uc3QgdHJhbnNhY3Rpb25NdXRhdGlvbkNoYWlucyA9IG5ldyBNYXAoKVxuXG5leHBvcnQgZGVmYXVsdCBjbGFzcyBCYWNrZ3JvdW5kSm9ic1N0b3JlIGV4dGVuZHMgQmFja2dyb3VuZEpvYnNBZGFwdGVyIHtcbiAgLyoqXG4gICAqIFJ1bnMgY29uc3RydWN0b3IuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gT3B0aW9ucy5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9jb25maWd1cmF0aW9uLmpzXCIpLmRlZmF1bHR9IGFyZ3MuY29uZmlndXJhdGlvbiAtIENvbmZpZ3VyYXRpb24uXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBbYXJncy5kYXRhYmFzZUlkZW50aWZpZXJdIC0gRGF0YWJhc2UgaWRlbnRpZmllci5cbiAgICovXG4gIGNvbnN0cnVjdG9yKHtjb25maWd1cmF0aW9uLCBkYXRhYmFzZUlkZW50aWZpZXJ9KSB7XG4gICAgc3VwZXIoKVxuICAgIHRoaXMuY29uZmlndXJhdGlvbiA9IGNvbmZpZ3VyYXRpb25cbiAgICB0aGlzLmRhdGFiYXNlSWRlbnRpZmllciA9IGRhdGFiYXNlSWRlbnRpZmllclxuICAgIHRoaXMubG9nZ2VyID0gbmV3IExvZ2dlcih0aGlzKVxuICAgIHRoaXMuX3JlYWR5UHJvbWlzZSA9IG51bGxcbiAgICB0aGlzLl9xdWV1ZUNvbmN1cnJlbmN5UmVjb25jaWxlZCA9IGZhbHNlXG4gIH1cblxuICAvKipcbiAgICogUnVucyBnZXQgZGF0YWJhc2UgaWRlbnRpZmllci5cbiAgICogQHJldHVybnMge3N0cmluZ30gLSBEYXRhYmFzZSBpZGVudGlmaWVyLlxuICAgKi9cbiAgZ2V0RGF0YWJhc2VJZGVudGlmaWVyKCkge1xuICAgIGlmICh0aGlzLmRhdGFiYXNlSWRlbnRpZmllcikgcmV0dXJuIHRoaXMuZGF0YWJhc2VJZGVudGlmaWVyXG5cbiAgICByZXR1cm4gdGhpcy5jb25maWd1cmF0aW9uLmdldEJhY2tncm91bmRKb2JzQ29uZmlnKCkuZGF0YWJhc2VJZGVudGlmaWVyXG4gIH1cblxuICAvKipcbiAgICogUnVucyBlbnN1cmUgcmVhZHkuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIHdoZW4gcmVhZHkuXG4gICAqL1xuICBhc3luYyBlbnN1cmVSZWFkeSgpIHtcbiAgICBpZiAodGhpcy5fcmVhZHlQcm9taXNlKSByZXR1cm4gYXdhaXQgdGhpcy5fcmVhZHlQcm9taXNlXG5cbiAgICB0aGlzLl9yZWFkeVByb21pc2UgPSAoYXN5bmMgKCkgPT4ge1xuICAgICAgdGhpcy5jb25maWd1cmF0aW9uLnNldEN1cnJlbnQoKVxuICAgICAgYXdhaXQgdGhpcy5fZW5zdXJlU2NoZW1hKClcbiAgICAgIGF3YWl0IHRoaXMuX2luaXRpYWxpemVNb2RlbCgpXG4gICAgfSkoKVxuXG4gICAgdHJ5IHtcbiAgICAgIGF3YWl0IHRoaXMuX3JlYWR5UHJvbWlzZVxuICAgIH0gZmluYWxseSB7XG4gICAgICB0aGlzLl9yZWFkeVByb21pc2UgPSBudWxsXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIEVuc3VyZXMgdGhlIGJhY2tncm91bmQtam9icyBzY2hlbWEgKHRhYmxlcyArIGNvbHVtbnMpIGV4aXN0cyBvbiB0aGUgY29uZmlndXJlZFxuICAgKiBkYXRhYmFzZSwgd2l0aG91dCBpbml0aWFsaXppbmcgdGhlIHJ1bnRpbWUgbW9kZWwuIExldHMgYGRiOm1pZ3JhdGVgIGNyZWF0ZSB0aGVcbiAgICogZnJhbWV3b3JrJ3Mgb3duIHNjaGVtYSBkZXRlcm1pbmlzdGljYWxseSBhbG9uZ3NpZGUgYXBwIG1pZ3JhdGlvbnMg4oCUIGFuZCBjYXB0dXJlXG4gICAqIGl0IGluIHRoZSBkdW1wZWQgc3RydWN0dXJlIFNRTCDigJQgaW5zdGVhZCBvZiBpdCBvbmx5IGFwcGVhcmluZyBvbmNlIGEgc3RvcmUgYm9vdHMuXG4gICAqIElkZW1wb3RlbnQ6IHJldXNlcyB0aGUgc2FtZSBgX2Vuc3VyZVNjaGVtYWAgdGhlIHJ1bnRpbWUgc3RvcmUgdXNlcywgd2hpY2ggc2tpcHNcbiAgICogd29yayBhbHJlYWR5IGFwcGxpZWQgKHRyYWNrZWQgaW4gYHZlbG9jaW91c19pbnRlcm5hbF9taWdyYXRpb25zYCkuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vZGF0YWJhc2UvZHJpdmVycy9iYXNlLmpzXCIpLmRlZmF1bHR9IFtkYl0gLSBSZXVzZSBhbiBhbHJlYWR5XG4gICAqICAgY2hlY2tlZC1vdXQgY29ubmVjdGlvbiAoZS5nLiB0aGUgb25lIGBkYjptaWdyYXRlYCBob2xkcykgcmF0aGVyIHRoYW4gb3BlbmluZyBhXG4gICAqICAgbmVzdGVkIGNoZWNrb3V0IHRoYXQgd291bGQgZGVhZGxvY2sgYSBzaW5nbGUtY29ubmVjdGlvbiBwb29sLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyB3aGVuIHRoZSBzY2hlbWEgaXMgcHJlc2VudC5cbiAgICovXG4gIGFzeW5jIGVuc3VyZVNjaGVtYShkYikge1xuICAgIC8vIFdoZW4gYSBjb25uZWN0aW9uIGlzIGhhbmRlZCBpbiAodGhlIGRiOm1pZ3JhdGUgcGF0aCksIHRoZSBjYWxsZXIgYWxyZWFkeSBvd25zXG4gICAgLy8gdGhlIGFjdGl2ZSBjb25maWd1cmF0aW9uICsgY29ubmVjdGlvbiBjb250ZXh0OyBjYWxsaW5nIHNldEN1cnJlbnQoKSBoZXJlIHdvdWxkXG4gICAgLy8gY2xvYmJlciBpdCAoZS5nLiB0aGUgYnJvd3NlciB0ZXN0IHJ1bm5lciBqdWdnbGVzIG11bHRpcGxlIGNvbmZpZ3VyYXRpb25zKS5cbiAgICBpZiAoIWRiKSB0aGlzLmNvbmZpZ3VyYXRpb24uc2V0Q3VycmVudCgpXG5cbiAgICBhd2FpdCB0aGlzLl9lbnN1cmVTY2hlbWEoZGIpXG4gIH1cblxuICAvKipcbiAgICogUmVjb25jaWxlcyBxdWV1ZS1kZXJpdmVkIGNvbmN1cnJlbmN5IHdpdGggdGhlIGN1cnJlbnQgY29uZmlndXJhdGlvbjogdGhlXG4gICAqIGV4cGxpY2l0IGxpZmVjeWNsZSBwYXRoIHRoYXQgYWRvcHRzL3JlbGVhc2VzIHBlcnNpc3RlZCBxdWV1ZWQgam9icyBvbnRvXG4gICAqIHF1ZXVlIGNvbmN1cnJlbmN5IGtleXMgd2hlbiBgcXVldWVzW25hbWVdLm1heENvbmN1cnJlbnRgIGlzIGFkZGVkLCByZW1vdmVkLFxuICAgKiBvciBjaGFuZ2VkLiBDYWxsZWQgYnkgdGhlIGJhY2tncm91bmQtam9icyBtYWluIHByb2Nlc3Mgb24gc3RhcnR1cCDigJQgdGhlXG4gICAqIGRlcGxveS10aW1lIG1vbWVudCBxdWV1ZSBjb25maWd1cmF0aW9uIGNoYW5nZXMgdGFrZSBlZmZlY3QuIFNjaGVtYS90ZW5hbnRcbiAgICogY2hlY2tzIGFuZCByb3V0aW5lIGNvbm5lY3Rpb24gaW5pdGlhbGl6YXRpb24gZGVsaWJlcmF0ZWx5IG5ldmVyIHJ1biB0aGlzOlxuICAgKiB0aGV5IHN0YXkgcmVhZC1vbmx5IHJlZ2FyZGluZyBxdWV1ZWQgam9iIHJvd3MsIGJlY2F1c2UgdGhlIGJyb2FkXG4gICAqIGFkb3B0aW9uL3JlbGVhc2UgVVBEQVRFcyBkZWFkbG9jayBhZ2FpbnN0IGFjdGl2ZSBqb2IgcHJvY2Vzc2VzIHVuZGVyXG4gICAqIGNvbmN1cnJlbnQgdGVuYW50IGluaXRpYWxpemF0aW9uLiBTZXJpYWxpemVkIGFjcm9zcyBwcm9jZXNzZXMgd2l0aCBhXG4gICAqIGRhdGFiYXNlIGFkdmlzb3J5IGxvY2sgc28gY29uY3VycmVudGx5IHN0YXJ0ZWQgbWFpbnMgY2Fubm90IGludGVybGVhdmUgdGhlXG4gICAqIFVQREFURXM7IHRoZSBwZXItaW5zdGFuY2UgbWVtbyBvbmx5IHNraXBzIHJlcGVhdCB3b3JrIHdpdGhpbiB0aGlzIHByb2Nlc3MuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIHdoZW4gcmVjb25jaWxlZC5cbiAgICovXG4gIGFzeW5jIHJlY29uY2lsZVF1ZXVlQ29uY3VycmVuY3koKSB7XG4gICAgaWYgKHRoaXMuX3F1ZXVlQ29uY3VycmVuY3lSZWNvbmNpbGVkKSByZXR1cm5cblxuICAgIGNvbnN0IGRhdGFiYXNlSWRlbnRpZmllciA9IHRoaXMuZ2V0RGF0YWJhc2VJZGVudGlmaWVyKClcbiAgICBjb25zdCBzdGFydGVkQXRNcyA9IERhdGUubm93KClcblxuICAgIGF3YWl0IHRoaXMubG9nZ2VyLmluZm8oKCkgPT4gW1xuICAgICAgXCJTdGFydGluZyBiYWNrZ3JvdW5kIGpvYnMgcXVldWUtY29uY3VycmVuY3kgc3RhcnR1cCByZWNvbmNpbGlhdGlvblwiLFxuICAgICAge2RhdGFiYXNlSWRlbnRpZmllcn1cbiAgICBdKVxuICAgIGF3YWl0IHRoaXMuZW5zdXJlUmVhZHkoKVxuXG4gICAgYXdhaXQgdGhpcy5fd2l0aERiKGFzeW5jIChkYikgPT4ge1xuICAgICAgY29uc3QgYWNxdWlyZWQgPSBhd2FpdCBkYi5hY3F1aXJlQWR2aXNvcnlMb2NrKENPTkNVUlJFTkNZX1JFQ09OQ0lMSUFUSU9OX0xPQ0spXG5cbiAgICAgIGlmICghYWNxdWlyZWQpIHRocm93IG5ldyBFcnJvcihcIkZhaWxlZCB0byBhY3F1aXJlIGJhY2tncm91bmQgam9iIHF1ZXVlLWNvbmN1cnJlbmN5IHJlY29uY2lsZSBsb2NrXCIpXG5cbiAgICAgIHRyeSB7XG4gICAgICAgIGF3YWl0IHRoaXMuX3JlY29uY2lsZVF1ZXVlQ29uY3VycmVuY3koZGIpXG4gICAgICAgIGF3YWl0IHRoaXMuX3JlY29uY2lsZUNvbmN1cnJlbmN5KGRiKVxuXG4gICAgICAgIC8vIExhdGNoIHRoZSBtZW1vIG9ubHkgYWZ0ZXIgQk9USCBzdGVwcyBzdWNjZWVkOiBpZiB0aGUgY291bnQgcmVidWlsZFxuICAgICAgICAvLyBmYWlscyBhZnRlciBhZG9wdGlvbiwgYSByZXRyeSBvbiB0aGlzIHN0b3JlIG11c3QgcmUtZW50ZXIgYW5kIHJlcGFpclxuICAgICAgICAvLyB0aGUgY291bnRzIChhZG9wdGlvbiBpdHNlbGYgaXMgaWRlbXBvdGVudCkuXG4gICAgICAgIHRoaXMuX3F1ZXVlQ29uY3VycmVuY3lSZWNvbmNpbGVkID0gdHJ1ZVxuICAgICAgfSBmaW5hbGx5IHtcbiAgICAgICAgYXdhaXQgZGIucmVsZWFzZUFkdmlzb3J5TG9jayhDT05DVVJSRU5DWV9SRUNPTkNJTElBVElPTl9MT0NLKVxuICAgICAgfVxuICAgIH0pXG5cbiAgICBhd2FpdCB0aGlzLmxvZ2dlci5pbmZvKCgpID0+IFtcbiAgICAgIFwiQ29tcGxldGVkIGJhY2tncm91bmQgam9icyBxdWV1ZS1jb25jdXJyZW5jeSBzdGFydHVwIHJlY29uY2lsaWF0aW9uXCIsXG4gICAgICB7ZGF0YWJhc2VJZGVudGlmaWVyLCBkdXJhdGlvbk1zOiBEYXRlLm5vdygpIC0gc3RhcnRlZEF0TXN9XG4gICAgXSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSZXBhaXJzIGR1cmFibGUgYWN0aXZlLWNvdW50IGRyaWZ0IHdoaWxlIGEgbWFpbiBwcm9jZXNzIHJlbWFpbnMgbGl2ZS4gVGhlXG4gICAqIGluaXRpYWwgc25hcHNob3QgaXMgcmVhZC1vbmx5OyBvbmx5IHN1c3BlY3RlZCBtaXNtYXRjaGVzIHRha2UgdGhlaXJcbiAgICogY291bnRlciBsb2NrIGFuZCByZS1jb3VudCBpbnNpZGUgdGhlIHNlcmlhbGl6ZWQgdHJhbnNhY3Rpb24gcGF0aC5cbiAgICogQHJldHVybnMge1Byb21pc2U8aW1wb3J0KFwiLi90eXBlcy5qc1wiKS5CYWNrZ3JvdW5kSm9iQ29uY3VycmVuY3lSZWNvbmNpbGlhdGlvbj59IC0gUmVwYWlyIHN1bW1hcnkuXG4gICAqL1xuICBhc3luYyByZWNvbmNpbGVBY3RpdmVDb25jdXJyZW5jeSgpIHtcbiAgICBjb25zdCBkYXRhYmFzZUlkZW50aWZpZXIgPSB0aGlzLmdldERhdGFiYXNlSWRlbnRpZmllcigpXG4gICAgY29uc3Qgc3RhcnRlZEF0TXMgPSBEYXRlLm5vdygpXG5cbiAgICBhd2FpdCB0aGlzLmVuc3VyZVJlYWR5KClcblxuICAgIGNvbnN0IHJlc3VsdCA9IGF3YWl0IHRoaXMuX3NlcmlhbGl6ZWRUcmFuc2FjdGlvbk11dGF0aW9uKFxuICAgICAgYXN5bmMgKGRiKSA9PiBhd2FpdCB0aGlzLl9yZWNvbmNpbGVDb25jdXJyZW5jeShkYiwge2luc2lkZVRyYW5zYWN0aW9uOiB0cnVlfSksXG4gICAgICB7XG4gICAgICAgIGFkdmlzb3J5TG9jazoge1xuICAgICAgICAgIGZhaWx1cmVNZXNzYWdlOiBcIkZhaWxlZCB0byBhY3F1aXJlIGJhY2tncm91bmQgam9iIGFjdGl2ZS1jb25jdXJyZW5jeSByZWNvbmNpbGUgbG9ja1wiLFxuICAgICAgICAgIG5hbWU6IENPTkNVUlJFTkNZX1JFQ09OQ0lMSUFUSU9OX0xPQ0tcbiAgICAgICAgfVxuICAgICAgfVxuICAgIClcblxuICAgIGlmIChyZXN1bHQucmVwYWlyZWRDb3VudCA+IDApIHtcbiAgICAgIGF3YWl0IHRoaXMubG9nZ2VyLndhcm4oKCkgPT4gW1xuICAgICAgICBcIlJlcGFpcmVkIGJhY2tncm91bmQgam9icyBhY3RpdmUtY29uY3VycmVuY3kgY291bnQgZHJpZnRcIixcbiAgICAgICAge1xuICAgICAgICAgIGRhdGFiYXNlSWRlbnRpZmllcixcbiAgICAgICAgICBkdXJhdGlvbk1zOiBEYXRlLm5vdygpIC0gc3RhcnRlZEF0TXMsXG4gICAgICAgICAgcmVwYWlyZWRDb3VudDogcmVzdWx0LnJlcGFpcmVkQ291bnQsXG4gICAgICAgICAgcmVwYWlyczogcmVzdWx0LnJlcGFpcnMsXG4gICAgICAgICAgcmVwYWlyc1RydW5jYXRlZENvdW50OiByZXN1bHQucmVwYWlyc1RydW5jYXRlZENvdW50XG4gICAgICAgIH1cbiAgICAgIF0pXG4gICAgfVxuXG4gICAgcmV0dXJuIHJlc3VsdFxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZW5xdWV1ZS5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBPcHRpb25zLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gYXJncy5qb2JOYW1lIC0gSm9iIG5hbWUuXG4gICAqIEBwYXJhbSB7QXJyYXk8UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSBhcmdzLmFyZ3MgLSBBcmd1bWVudHMuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi90eXBlcy5qc1wiKS5CYWNrZ3JvdW5kSm9iT3B0aW9uc30gW2FyZ3Mub3B0aW9uc10gLSBPcHRpb25zLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxzdHJpbmc+fSAtIEpvYiBpZC5cbiAgICovXG4gIGFzeW5jIGVucXVldWUoe2pvYk5hbWUsIGFyZ3MsIG9wdGlvbnN9KSB7XG4gICAgYXdhaXQgdGhpcy5lbnN1cmVSZWFkeSgpXG5cbiAgICBjb25zdCBwcmVwYXJlZEpvYiA9IHRoaXMuX3ByZXBhcmVKb2Ioe2pvYk5hbWUsIGFyZ3MsIG9wdGlvbnN9KVxuXG4gICAgaWYgKG9wdGlvbnM/LmlkZW1wb3RlbmN5S2V5ICE9PSB1bmRlZmluZWQpIHtcbiAgICAgIHJldHVybiBhd2FpdCB0aGlzLl9lbnF1ZXVlSWRlbXBvdGVudGx5KHthcmdzOiBhcmdzIHx8IFtdLCBvcHRpb25zLCBwcmVwYXJlZEpvYn0pXG4gICAgfVxuXG4gICAgLyoqIEB0eXBlIHtzdHJpbmd9ICovXG4gICAgbGV0IHJlc3VsdEpvYklkID0gcHJlcGFyZWRKb2Iuam9iSWRcblxuICAgIGF3YWl0IHRoaXMuX3NlcmlhbGl6ZWRDb3VudE11dGF0aW9uKGFzeW5jIChkYikgPT4ge1xuICAgICAgaWYgKG9wdGlvbnM/LmRlZHVwbGljYXRlV2hpbGVRdWV1ZWQpIHtcbiAgICAgICAgLy8gRGVkdXBlIG9uIHRoZSBqb2IncyBpZGVudGl0eSAobmFtZSArIGFyZ3MgKyBxdWV1ZSksIE5PVCBpdHMgY29uY3VycmVuY3kga2V5LCBzbyBhIGpvYlxuICAgICAgICAvLyBrZWVwcyB3aGF0ZXZlciBjb25jdXJyZW5jeSBpdCByZXNvbHZlcyB0by4gT25seSBhbiBleGlzdGluZyBqb2Igc2NoZWR1bGVkIG5vIGxhdGVyIHRoYW5cbiAgICAgICAgLy8gdGhpcyBlbnF1ZXVlIGNhbiBjb3ZlciBpdDsgYSByZXRyeSBiYWNrZWQgb2ZmIGludG8gdGhlIGZ1dHVyZSBtdXN0IG5vdCBzdXBwcmVzcyBlYXJsaWVyXG4gICAgICAgIC8vIHdvcmsuIE9yZGVyaW5nIHJldHVybnMgdGhlIGVhcmxpZXN0IGNvdmVyaW5nIGpvYiB3aGVuIHNldmVyYWwgcXVldWVkIHJvd3MgYWxyZWFkeSBleGlzdC5cbiAgICAgICAgY29uc3QgZXhpc3RpbmcgPSBhd2FpdCBkYlxuICAgICAgICAgIC5uZXdRdWVyeSgpXG4gICAgICAgICAgLmZyb20oSk9CU19UQUJMRSlcbiAgICAgICAgICAuc2VsZWN0KFwiaWRcIilcbiAgICAgICAgICAud2hlcmUoe3N0YXR1czogXCJxdWV1ZWRcIiwgam9iX25hbWU6IGpvYk5hbWUsIGFyZ3NfanNvbjogcHJlcGFyZWRKb2IuYXJnc0pzb24sIHF1ZXVlOiBwcmVwYXJlZEpvYi5xdWV1ZX0pXG4gICAgICAgICAgLndoZXJlKGBzY2hlZHVsZWRfYXRfbXMgPD0gJHtkYi5xdW90ZShwcmVwYXJlZEpvYi5zY2hlZHVsZWRBdE1zKX1gKVxuICAgICAgICAgIC5vcmRlcihcInNjaGVkdWxlZF9hdF9tcyBBU0NcIilcbiAgICAgICAgICAubGltaXQoMSlcbiAgICAgICAgICAucmVzdWx0cygpXG5cbiAgICAgICAgaWYgKGV4aXN0aW5nWzBdKSB7XG4gICAgICAgICAgcmVzdWx0Sm9iSWQgPSBTdHJpbmcoLyoqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59ICovIChleGlzdGluZ1swXSkuaWQpXG5cbiAgICAgICAgICByZXR1cm5cbiAgICAgICAgfVxuICAgICAgfVxuXG4gICAgICBhd2FpdCB0aGlzLl9pbnNlcnRQcmVwYXJlZEpvYihkYiwge3ByZXBhcmVkSm9iLCBzY2hlZHVsZUtleTogbnVsbH0pXG4gICAgICBhd2FpdCB0aGlzLl9yZWNvcmRDb3VudERlbHRhKGRiLCB7YWxsOiAxLCBxdWV1ZWQ6IDF9KVxuICAgIH0pXG5cbiAgICByZXR1cm4gcmVzdWx0Sm9iSWRcbiAgfVxuXG4gIC8qKlxuICAgKiBBdG9taWNhbGx5IG93bnMgb25lIGR1cmFibGUgaWRlbXBvdGVuY3kgc2NvcGUgYW5kIGNyZWF0ZXMgaXRzIGpvYiBleGFjdGx5IG9uY2UuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gRW5xdWV1ZSBpbnB1dC5cbiAgICogQHBhcmFtIHtBcnJheTxSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59IGFyZ3MuYXJncyAtIEpvYiBhcmd1bWVudHMuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi90eXBlcy5qc1wiKS5CYWNrZ3JvdW5kSm9iT3B0aW9uc30gYXJncy5vcHRpb25zIC0gSm9iIG9wdGlvbnMuXG4gICAqIEBwYXJhbSB7UHJlcGFyZWRCYWNrZ3JvdW5kSm9ifSBhcmdzLnByZXBhcmVkSm9iIC0gTm9ybWFsaXplZCBqb2IuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHN0cmluZz59IC0gU3RhYmxlIG9yaWdpbmFsIGpvYiBpZC5cbiAgICovXG4gIGFzeW5jIF9lbnF1ZXVlSWRlbXBvdGVudGx5KHthcmdzLCBvcHRpb25zLCBwcmVwYXJlZEpvYn0pIHtcbiAgICBjb25zdCBpZGVtcG90ZW5jeUtleSA9IHRoaXMuX25vcm1hbGl6ZUlkZW1wb3RlbmN5S2V5KG9wdGlvbnMuaWRlbXBvdGVuY3lLZXkpXG4gICAgY29uc3Qgc2NvcGVEaWdlc3QgPSB0aGlzLl9pZGVtcG90ZW5jeVNjb3BlRGlnZXN0KHtpZGVtcG90ZW5jeUtleSwgam9iTmFtZTogcHJlcGFyZWRKb2Iuam9iTmFtZSwgcXVldWU6IHByZXBhcmVkSm9iLnF1ZXVlfSlcbiAgICBjb25zdCByZXF1ZXN0RGlnZXN0ID0gdGhpcy5faWRlbXBvdGVuY3lSZXF1ZXN0RGlnZXN0KHthcmdzLCBvcHRpb25zLCBwcmVwYXJlZEpvYn0pXG4gICAgY29uc3Qgb3duZXJzaGlwID0ge1xuICAgICAgY3JlYXRlZF9hdF9tczogcHJlcGFyZWRKb2IuY3JlYXRlZEF0TXMsXG4gICAgICBpZGVtcG90ZW5jeV9rZXk6IGlkZW1wb3RlbmN5S2V5LFxuICAgICAgam9iX2lkOiBwcmVwYXJlZEpvYi5qb2JJZCxcbiAgICAgIGpvYl9uYW1lOiBwcmVwYXJlZEpvYi5qb2JOYW1lLFxuICAgICAgcXVldWU6IHByZXBhcmVkSm9iLnF1ZXVlLFxuICAgICAgcmVxdWVzdF9kaWdlc3Q6IHJlcXVlc3REaWdlc3QsXG4gICAgICBzY29wZV9kaWdlc3Q6IHNjb3BlRGlnZXN0XG4gICAgfVxuICAgIGNvbnN0IG1haWxPcGVyYXRpb25JbnB1dCA9IG1haWxEZWxpdmVyeU9wZXJhdGlvbkZvckpvYihwcmVwYXJlZEpvYi5qb2JOYW1lLCBhcmdzKVxuXG4gICAgaWYgKG1haWxPcGVyYXRpb25JbnB1dCAmJiBtYWlsT3BlcmF0aW9uSW5wdXQub3BlcmF0aW9uLmlkICE9PSBpZGVtcG90ZW5jeUtleSkge1xuICAgICAgdGhyb3cgVmVsb2Npb3VzRXJyb3Iuc2FmZShcIk1haWwgZGVsaXZlcnkgb3BlcmF0aW9uIGlkIG11c3QgZXF1YWwgaXRzIGJhY2tncm91bmQgam9iIGlkZW1wb3RlbmN5IGtleS5cIiwge1xuICAgICAgICBjb2RlOiBcIm1haWwtZGVsaXZlcnktaWRlbXBvdGVuY3kta2V5LW1pc21hdGNoXCJcbiAgICAgIH0pXG4gICAgfVxuXG4gICAgLy8gUmV1c2Ugb3JkaW5hcnkgZW5xdWV1ZSB0cmFuc2FjdGlvbiBhZG1pc3Npb24gYmVjYXVzZSB0aGlzIHBhdGggY2hhbmdlc1xuICAgIC8vIHRoZSBzYW1lIGR1cmFibGUgY291bnQgcmV2aXNpb24uIFRoZSBzY29wZSBwcmltYXJ5IGtleSByZW1haW5zIHRoZVxuICAgIC8vIGNyb3NzLXByb2Nlc3MgY29udmVyZ2VuY2Ugb3duZXIuXG4gICAgcmV0dXJuIGF3YWl0IHRoaXMuX2lkZW1wb3RlbnRFbnF1ZXVlVHJhbnNhY3Rpb24oYXN5bmMgKGRiKSA9PiB7XG4gICAgICBjb25zdCBleGlzdGluZyA9IGF3YWl0IHRoaXMuX2lkZW1wb3RlbmN5T3duZXJzaGlwKGRiLCBzY29wZURpZ2VzdClcblxuICAgICAgaWYgKGV4aXN0aW5nKSB7XG4gICAgICAgIHRoaXMuX3ZhbGlkYXRlSWRlbXBvdGVuY3lPd25lcnNoaXAoe2V4aXN0aW5nLCBvd25lcnNoaXB9KVxuICAgICAgICBhd2FpdCB0aGlzLl92YWxpZGF0ZU1haWxEZWxpdmVyeU9wZXJhdGlvbihkYiwge2pvYklkOiBTdHJpbmcoZXhpc3Rpbmcuam9iX2lkKSwgbWFpbE9wZXJhdGlvbklucHV0fSlcbiAgICAgICAgcmV0dXJuIFN0cmluZyhleGlzdGluZy5qb2JfaWQpXG4gICAgICB9XG5cbiAgICAgIGNvbnN0IGNsYWltZWQgPSBhd2FpdCB0aGlzLl9jbGFpbUlkZW1wb3RlbmN5T3duZXJzaGlwKGRiLCBvd25lcnNoaXApXG5cbiAgICAgIGlmICghY2xhaW1lZC5jcmVhdGVkKSB7XG4gICAgICAgIHRoaXMuX3ZhbGlkYXRlSWRlbXBvdGVuY3lPd25lcnNoaXAoe2V4aXN0aW5nOiBjbGFpbWVkLnJvdywgb3duZXJzaGlwfSlcbiAgICAgICAgYXdhaXQgdGhpcy5fdmFsaWRhdGVNYWlsRGVsaXZlcnlPcGVyYXRpb24oZGIsIHtqb2JJZDogU3RyaW5nKGNsYWltZWQucm93LmpvYl9pZCksIG1haWxPcGVyYXRpb25JbnB1dH0pXG4gICAgICAgIHJldHVybiBTdHJpbmcoY2xhaW1lZC5yb3cuam9iX2lkKVxuICAgICAgfVxuXG4gICAgICBhd2FpdCB0aGlzLl9sb2NrQ291bnRSZXZpc2lvbihkYilcbiAgICAgIGF3YWl0IHRoaXMuX2luc2VydFByZXBhcmVkSm9iKGRiLCB7cHJlcGFyZWRKb2IsIHNjaGVkdWxlS2V5OiBudWxsfSlcbiAgICAgIGF3YWl0IHRoaXMuX3BlcnNpc3RNYWlsRGVsaXZlcnlPcGVyYXRpb24oZGIsIHtqb2JJZDogcHJlcGFyZWRKb2Iuam9iSWQsIG1haWxPcGVyYXRpb25JbnB1dCwgY3JlYXRlZEF0TXM6IHByZXBhcmVkSm9iLmNyZWF0ZWRBdE1zfSlcbiAgICAgIGF3YWl0IHRoaXMuX3JlY29yZENvdW50RGVsdGEoZGIsIHthbGw6IDEsIHF1ZXVlZDogMX0pXG5cbiAgICAgIHJldHVybiBwcmVwYXJlZEpvYi5qb2JJZFxuICAgIH0pXG4gIH1cblxuICAvKipcbiAgICogU2VyaWFsaXplcyBvbmUgcGh5c2ljYWwgY29ubmVjdGlvbiBsb2NhbGx5IHdpdGhvdXQgdGFraW5nIG93bmVyc2hpcCBhd2F5XG4gICAqIGZyb20gdGhlIGRhdGFiYXNlIHVuaXF1ZW5lc3MgY29uc3RyYWludCBzaGFyZWQgYnkgYWxsIHByb2Nlc3Nlcy5cbiAgICogQHRlbXBsYXRlIFRcbiAgICogQHBhcmFtIHsoZGI6IGltcG9ydChcIi4uL2RhdGFiYXNlL2RyaXZlcnMvYmFzZS5qc1wiKS5kZWZhdWx0KSA9PiBQcm9taXNlPFQ+fSBjYWxsYmFjayAtIFRyYW5zYWN0aW9uIHdvcmsuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPFQ+fSAtIENhbGxiYWNrIHJlc3VsdC5cbiAgICovXG4gIGFzeW5jIF9pZGVtcG90ZW50RW5xdWV1ZVRyYW5zYWN0aW9uKGNhbGxiYWNrKSB7XG4gICAgcmV0dXJuIGF3YWl0IHRoaXMuX3NlcmlhbGl6ZWRUcmFuc2FjdGlvbk11dGF0aW9uKGNhbGxiYWNrKVxuICB9XG5cbiAgLyoqXG4gICAqIEluc2VydHMgYW4gb3duZXJzaGlwIHJvdywgcmVzb2x2aW5nIG9ubHkgYSBkYXRhYmFzZSB1bmlxdWVuZXNzIHJhY2UuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vZGF0YWJhc2UvZHJpdmVycy9iYXNlLmpzXCIpLmRlZmF1bHR9IGRiIC0gVHJhbnNhY3Rpb24gY29ubmVjdGlvbi5cbiAgICogQHBhcmFtIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59IG93bmVyc2hpcCAtIE93bmVyc2hpcCByb3cuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHtjcmVhdGVkOiBib29sZWFuLCByb3c6IFJlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0+fSAtIENsYWltIHJlc3VsdC5cbiAgICovXG4gIGFzeW5jIF9jbGFpbUlkZW1wb3RlbmN5T3duZXJzaGlwKGRiLCBvd25lcnNoaXApIHtcbiAgICB0cnkge1xuICAgICAgLy8gVGhlIHNhdmVwb2ludCBrZWVwcyBQb3N0Z3JlU1FMJ3Mgb3V0ZXIgdHJhbnNhY3Rpb24gdXNhYmxlIGFmdGVyIGFcbiAgICAgIC8vIGNvbmN1cnJlbnQgdW5pcXVlLWtleSBsb3NzLiBUaGUgdW5pcXVlIHByaW1hcnkga2V5LCBub3QgYSBwcm9jZXNzXG4gICAgICAvLyBtdXRleCwgaXMgdGhlIGNyb3NzLXByb2Nlc3MgY29udmVyZ2VuY2UgYXV0aG9yaXR5LlxuICAgICAgYXdhaXQgZGIudHJhbnNhY3Rpb24oYXN5bmMgKCkgPT4ge1xuICAgICAgICBhd2FpdCBkYi5pbnNlcnQoe3RhYmxlTmFtZTogSURFTVBPVEVOQ1lfS0VZU19UQUJMRSwgZGF0YTogb3duZXJzaGlwfSlcbiAgICAgIH0pXG5cbiAgICAgIHJldHVybiB7Y3JlYXRlZDogdHJ1ZSwgcm93OiBvd25lcnNoaXB9XG4gICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgIGNvbnN0IHJhY2VkID0gYXdhaXQgdGhpcy5faWRlbXBvdGVuY3lPd25lcnNoaXAoZGIsIFN0cmluZyhvd25lcnNoaXAuc2NvcGVfZGlnZXN0KSlcblxuICAgICAgaWYgKCFyYWNlZCkgdGhyb3cgZXJyb3JcbiAgICAgIHJldHVybiB7Y3JlYXRlZDogZmFsc2UsIHJvdzogcmFjZWR9XG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIExvYWRzIG9uZSBkdXJhYmxlIGVucXVldWUgb3duZXIuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vZGF0YWJhc2UvZHJpdmVycy9iYXNlLmpzXCIpLmRlZmF1bHR9IGRiIC0gRGF0YWJhc2UgY29ubmVjdGlvbi5cbiAgICogQHBhcmFtIHtzdHJpbmd9IHNjb3BlRGlnZXN0IC0gRml4ZWQtc2l6ZSBzY29wZSBkaWdlc3QuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPFJlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+PiB8IG51bGw+fSAtIFJvdyBvciBudWxsLlxuICAgKi9cbiAgYXN5bmMgX2lkZW1wb3RlbmN5T3duZXJzaGlwKGRiLCBzY29wZURpZ2VzdCkge1xuICAgIGNvbnN0IHJvd3MgPSBhd2FpdCBkYi5uZXdRdWVyeSgpLmZyb20oSURFTVBPVEVOQ1lfS0VZU19UQUJMRSkud2hlcmUoe3Njb3BlX2RpZ2VzdDogc2NvcGVEaWdlc3R9KS5saW1pdCgxKS5yZXN1bHRzKClcblxuICAgIHJldHVybiByb3dzWzBdID8gLyoqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59ICovIChyb3dzWzBdKSA6IG51bGxcbiAgfVxuXG4gIC8qKlxuICAgKiBGYWlscyBjbG9zZWQgd2hlbiBhIGR1cmFibGUga2V5IGlzIHJldXNlZCBmb3IgYSBkaWZmZXJlbnQgY2Fub25pY2FsIHJlcXVlc3QuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gVmFsaWRhdGlvbiBpbnB1dC5cbiAgICogQHBhcmFtIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59IGFyZ3MuZXhpc3RpbmcgLSBTdG9yZWQgb3duZXIuXG4gICAqIEBwYXJhbSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSBhcmdzLm93bmVyc2hpcCAtIFJlcXVlc3RlZCBvd25lci5cbiAgICogQHJldHVybnMge3ZvaWR9XG4gICAqL1xuICBfdmFsaWRhdGVJZGVtcG90ZW5jeU93bmVyc2hpcCh7ZXhpc3RpbmcsIG93bmVyc2hpcH0pIHtcbiAgICBjb25zdCBleGFjdFNjb3BlID0gU3RyaW5nKGV4aXN0aW5nLmpvYl9uYW1lKSA9PT0gb3duZXJzaGlwLmpvYl9uYW1lXG4gICAgICAmJiBTdHJpbmcoZXhpc3RpbmcucXVldWUpID09PSBvd25lcnNoaXAucXVldWVcbiAgICAgICYmIFN0cmluZyhleGlzdGluZy5pZGVtcG90ZW5jeV9rZXkpID09PSBvd25lcnNoaXAuaWRlbXBvdGVuY3lfa2V5XG5cbiAgICBpZiAoIWV4YWN0U2NvcGUgfHwgU3RyaW5nKGV4aXN0aW5nLnJlcXVlc3RfZGlnZXN0KSAhPT0gb3duZXJzaGlwLnJlcXVlc3RfZGlnZXN0KSB7XG4gICAgICB0aHJvdyBWZWxvY2lvdXNFcnJvci5zYWZlKFwiVGhlIGJhY2tncm91bmQgam9iIGlkZW1wb3RlbmN5IGtleSB3YXMgYWxyZWFkeSB1c2VkIGZvciBhIGRpZmZlcmVudCByZXF1ZXN0LlwiLCB7XG4gICAgICAgIGNvZGU6IFwiYmFja2dyb3VuZC1qb2ItaWRlbXBvdGVuY3ktY29uZmxpY3RcIlxuICAgICAgfSlcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogUGVyc2lzdHMgdGhlIGJ1aWx0LWluIG1haWwgb3BlcmF0aW9uIGluIHRoZSBzYW1lIGZpcnN0LWVucXVldWUgdHJhbnNhY3Rpb24uXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vZGF0YWJhc2UvZHJpdmVycy9iYXNlLmpzXCIpLmRlZmF1bHR9IGRiIC0gVHJhbnNhY3Rpb24gY29ubmVjdGlvbi5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBPcGVyYXRpb24gaW5wdXQuXG4gICAqIEBwYXJhbSB7bnVtYmVyfSBhcmdzLmNyZWF0ZWRBdE1zIC0gQ3JlYXRpb24gdGltZXN0YW1wLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gYXJncy5qb2JJZCAtIE5hdGl2ZSBqb2IgaWQuXG4gICAqIEBwYXJhbSB7e29wZXJhdGlvbjogaW1wb3J0KFwiLi4vbWFpbGVyL2luZGV4LmpzXCIpLk1haWxlckRlbGl2ZXJ5T3BlcmF0aW9uLCBwYXlsb2FkOiBpbXBvcnQoXCIuLi9tYWlsZXIvaW5kZXguanNcIikuTWFpbGVyRGVsaXZlcnlQYXlsb2FkfSB8IG51bGx9IGFyZ3MubWFpbE9wZXJhdGlvbklucHV0IC0gTWFpbCBvcGVyYXRpb24uXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIGFmdGVyIHBlcnNpc3RlbmNlLlxuICAgKi9cbiAgYXN5bmMgX3BlcnNpc3RNYWlsRGVsaXZlcnlPcGVyYXRpb24oZGIsIHtjcmVhdGVkQXRNcywgam9iSWQsIG1haWxPcGVyYXRpb25JbnB1dH0pIHtcbiAgICBpZiAoIW1haWxPcGVyYXRpb25JbnB1dCkgcmV0dXJuXG4gICAgY29uc3Qge29wZXJhdGlvbn0gPSBtYWlsT3BlcmF0aW9uSW5wdXRcbiAgICBjb25zdCBvcGVyYXRpb25LZXkgPSBtYWlsRGVsaXZlcnlPcGVyYXRpb25LZXkob3BlcmF0aW9uLmlkKVxuICAgIGNvbnN0IHJvdyA9IHtcbiAgICAgIGJhY2tncm91bmRfam9iX2lkOiBqb2JJZCxcbiAgICAgIGNyZWF0ZWRfYXRfbXM6IGNyZWF0ZWRBdE1zLFxuICAgICAgZmlyc3RfYXR0ZW1wdF9zdGFydGVkX2F0X21zOiBudWxsLFxuICAgICAgb3BlcmF0aW9uX2lkOiBvcGVyYXRpb24uaWQsXG4gICAgICBvcGVyYXRpb25fa2V5OiBvcGVyYXRpb25LZXksXG4gICAgICBwYXlsb2FkX2RpZ2VzdDogb3BlcmF0aW9uLnBheWxvYWREaWdlc3QsXG4gICAgICBwcm92aWRlcl9raW5kOiBvcGVyYXRpb24ucHJvdmlkZXJLaW5kLFxuICAgICAgcHJvdmlkZXJfcmV0ZW50aW9uX21zOiBvcGVyYXRpb24ucHJvdmlkZXJSZXRlbnRpb25Nc1xuICAgIH1cblxuICAgIHRyeSB7XG4gICAgICBhd2FpdCBkYi50cmFuc2FjdGlvbihhc3luYyAoKSA9PiB7XG4gICAgICAgIGF3YWl0IGRiLmluc2VydCh7dGFibGVOYW1lOiBNQUlMX0RFTElWRVJZX09QRVJBVElPTlNfVEFCTEUsIGRhdGE6IHJvd30pXG4gICAgICB9KVxuICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICBjb25zdCBleGlzdGluZyA9IGF3YWl0IHRoaXMuX21haWxEZWxpdmVyeU9wZXJhdGlvbihkYiwgb3BlcmF0aW9uS2V5KVxuXG4gICAgICBpZiAoIWV4aXN0aW5nKSB0aHJvdyBlcnJvclxuICAgICAgdGhpcy5fdmFsaWRhdGVNYWlsRGVsaXZlcnlPcGVyYXRpb25Sb3coe2V4aXN0aW5nLCByZXF1ZXN0ZWQ6IHJvd30pXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIFZhbGlkYXRlcyB0aGUgZHVyYWJsZSBtYWlsIHJvdyBkdXJpbmcgYW4gZXhhY3QgZ2VuZXJpYyBlbnF1ZXVlIHJlcGxheS5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9kYXRhYmFzZS9kcml2ZXJzL2Jhc2UuanNcIikuZGVmYXVsdH0gZGIgLSBEYXRhYmFzZSBjb25uZWN0aW9uLlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIFZhbGlkYXRpb24gaW5wdXQuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBhcmdzLmpvYklkIC0gT3duZWQgam9iIGlkLlxuICAgKiBAcGFyYW0ge3tvcGVyYXRpb246IGltcG9ydChcIi4uL21haWxlci9pbmRleC5qc1wiKS5NYWlsZXJEZWxpdmVyeU9wZXJhdGlvbiwgcGF5bG9hZDogaW1wb3J0KFwiLi4vbWFpbGVyL2luZGV4LmpzXCIpLk1haWxlckRlbGl2ZXJ5UGF5bG9hZH0gfCBudWxsfSBhcmdzLm1haWxPcGVyYXRpb25JbnB1dCAtIE1haWwgb3BlcmF0aW9uLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyB3aGVuIGV4YWN0LlxuICAgKi9cbiAgYXN5bmMgX3ZhbGlkYXRlTWFpbERlbGl2ZXJ5T3BlcmF0aW9uKGRiLCB7am9iSWQsIG1haWxPcGVyYXRpb25JbnB1dH0pIHtcbiAgICBpZiAoIW1haWxPcGVyYXRpb25JbnB1dCkgcmV0dXJuXG4gICAgY29uc3Qge29wZXJhdGlvbn0gPSBtYWlsT3BlcmF0aW9uSW5wdXRcbiAgICBjb25zdCBleGlzdGluZyA9IGF3YWl0IHRoaXMuX21haWxEZWxpdmVyeU9wZXJhdGlvbihkYiwgbWFpbERlbGl2ZXJ5T3BlcmF0aW9uS2V5KG9wZXJhdGlvbi5pZCkpXG5cbiAgICBpZiAoIWV4aXN0aW5nKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoXCJCYWNrZ3JvdW5kIGpvYiBpZGVtcG90ZW5jeSBvd25lcnNoaXAgaXMgbWlzc2luZyBpdHMgZHVyYWJsZSBtYWlsIGRlbGl2ZXJ5IG9wZXJhdGlvblwiKVxuICAgIH1cblxuICAgIHRoaXMuX3ZhbGlkYXRlTWFpbERlbGl2ZXJ5T3BlcmF0aW9uUm93KHtcbiAgICAgIGV4aXN0aW5nLFxuICAgICAgcmVxdWVzdGVkOiB7XG4gICAgICAgIGJhY2tncm91bmRfam9iX2lkOiBqb2JJZCxcbiAgICAgICAgb3BlcmF0aW9uX2lkOiBvcGVyYXRpb24uaWQsXG4gICAgICAgIHBheWxvYWRfZGlnZXN0OiBvcGVyYXRpb24ucGF5bG9hZERpZ2VzdCxcbiAgICAgICAgcHJvdmlkZXJfa2luZDogb3BlcmF0aW9uLnByb3ZpZGVyS2luZCxcbiAgICAgICAgcHJvdmlkZXJfcmV0ZW50aW9uX21zOiBvcGVyYXRpb24ucHJvdmlkZXJSZXRlbnRpb25Nc1xuICAgICAgfVxuICAgIH0pXG4gIH1cblxuICAvKipcbiAgICogTG9hZHMgYSBkdXJhYmxlIG1haWwgb3BlcmF0aW9uLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL2RhdGFiYXNlL2RyaXZlcnMvYmFzZS5qc1wiKS5kZWZhdWx0fSBkYiAtIERhdGFiYXNlIGNvbm5lY3Rpb24uXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBvcGVyYXRpb25LZXkgLSBGaXhlZC1zaXplIG9wZXJhdGlvbiBrZXkuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPFJlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+PiB8IG51bGw+fSAtIFJvdyBvciBudWxsLlxuICAgKi9cbiAgYXN5bmMgX21haWxEZWxpdmVyeU9wZXJhdGlvbihkYiwgb3BlcmF0aW9uS2V5KSB7XG4gICAgY29uc3Qgcm93cyA9IGF3YWl0IGRiLm5ld1F1ZXJ5KCkuZnJvbShNQUlMX0RFTElWRVJZX09QRVJBVElPTlNfVEFCTEUpLndoZXJlKHtvcGVyYXRpb25fa2V5OiBvcGVyYXRpb25LZXl9KS5saW1pdCgxKS5yZXN1bHRzKClcblxuICAgIHJldHVybiByb3dzWzBdID8gLyoqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59ICovIChyb3dzWzBdKSA6IG51bGxcbiAgfVxuXG4gIC8qKlxuICAgKiBDb21wYXJlcyBwcm92aWRlci1yZWxldmFudCBkdXJhYmxlIG1haWwgb3BlcmF0aW9uIGZpZWxkcy5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBWYWxpZGF0aW9uIGlucHV0LlxuICAgKiBAcGFyYW0ge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gYXJncy5leGlzdGluZyAtIFN0b3JlZCByb3cuXG4gICAqIEBwYXJhbSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSBhcmdzLnJlcXVlc3RlZCAtIFJlcXVlc3RlZCByb3cuXG4gICAqIEByZXR1cm5zIHt2b2lkfVxuICAgKi9cbiAgX3ZhbGlkYXRlTWFpbERlbGl2ZXJ5T3BlcmF0aW9uUm93KHtleGlzdGluZywgcmVxdWVzdGVkfSkge1xuICAgIGNvbnN0IG1hdGNoZXMgPSBTdHJpbmcoZXhpc3Rpbmcub3BlcmF0aW9uX2lkKSA9PT0gcmVxdWVzdGVkLm9wZXJhdGlvbl9pZFxuICAgICAgJiYgU3RyaW5nKGV4aXN0aW5nLnBheWxvYWRfZGlnZXN0KSA9PT0gcmVxdWVzdGVkLnBheWxvYWRfZGlnZXN0XG4gICAgICAmJiBTdHJpbmcoZXhpc3RpbmcuYmFja2dyb3VuZF9qb2JfaWQpID09PSByZXF1ZXN0ZWQuYmFja2dyb3VuZF9qb2JfaWRcbiAgICAgICYmIFN0cmluZyhleGlzdGluZy5wcm92aWRlcl9raW5kKSA9PT0gcmVxdWVzdGVkLnByb3ZpZGVyX2tpbmRcbiAgICAgICYmIHRoaXMuX25vcm1hbGl6ZU51bWJlcihleGlzdGluZy5wcm92aWRlcl9yZXRlbnRpb25fbXMpID09PSByZXF1ZXN0ZWQucHJvdmlkZXJfcmV0ZW50aW9uX21zXG5cbiAgICBpZiAoIW1hdGNoZXMpIHtcbiAgICAgIHRocm93IFZlbG9jaW91c0Vycm9yLnNhZmUoXCJUaGUgbWFpbCBkZWxpdmVyeSBvcGVyYXRpb24gd2FzIGFscmVhZHkgdXNlZCBmb3IgYSBkaWZmZXJlbnQgcGF5bG9hZCBvciBwcm92aWRlci5cIiwge1xuICAgICAgICBjb2RlOiBcIm1haWwtZGVsaXZlcnktaWRlbXBvdGVuY3ktY29uZmxpY3RcIlxuICAgICAgfSlcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogQ2Fub25pY2FsIHJlcXVlc3QgZGlnZXN0IGV4Y2x1ZGluZyBnZW5lcmF0ZWQgaWRzIGFuZCBpbW1lZGlhdGUgZW5xdWV1ZSB0aW1lLlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIERpZ2VzdCBpbnB1dC5cbiAgICogQHBhcmFtIHtBcnJheTxSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59IGFyZ3MuYXJncyAtIEpvYiBhcmd1bWVudHMuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi90eXBlcy5qc1wiKS5CYWNrZ3JvdW5kSm9iT3B0aW9uc30gYXJncy5vcHRpb25zIC0gSm9iIG9wdGlvbnMuXG4gICAqIEBwYXJhbSB7UHJlcGFyZWRCYWNrZ3JvdW5kSm9ifSBhcmdzLnByZXBhcmVkSm9iIC0gTm9ybWFsaXplZCBqb2IuXG4gICAqIEByZXR1cm5zIHtzdHJpbmd9IC0gU0hBLTI1NiBkaWdlc3QuXG4gICAqL1xuICBfaWRlbXBvdGVuY3lSZXF1ZXN0RGlnZXN0KHthcmdzLCBvcHRpb25zLCBwcmVwYXJlZEpvYn0pIHtcbiAgICBjb25zdCBzZXJpYWxpemVkID0gc3RhYmxlSnNvblN0cmluZ2lmeSh7XG4gICAgICBhcmdzLFxuICAgICAgY29uY3VycmVuY3k6IHByZXBhcmVkSm9iLmNvbmN1cnJlbmN5LFxuICAgICAgZXhlY3V0aW9uTW9kZTogcHJlcGFyZWRKb2IuZXhlY3V0aW9uTW9kZSxcbiAgICAgIGZvcm1hdDogXCJ2ZWxvY2lvdXMtYmFja2dyb3VuZC1qb2ItaWRlbXBvdGVuY3ktdjFcIixcbiAgICAgIGpvYk5hbWU6IHByZXBhcmVkSm9iLmpvYk5hbWUsXG4gICAgICBtYXhSZXRyaWVzOiBwcmVwYXJlZEpvYi5tYXhSZXRyaWVzLFxuICAgICAgcXVldWU6IHByZXBhcmVkSm9iLnF1ZXVlLFxuICAgICAgc2NoZWR1bGVkQXRNczogb3B0aW9ucy5zY2hlZHVsZWRBdE1zID09PSB1bmRlZmluZWQgPyBudWxsIDogcHJlcGFyZWRKb2Iuc2NoZWR1bGVkQXRNcyxcbiAgICAgIHNjaGVkdWxpbmc6IG9wdGlvbnMuc2NoZWR1bGVkQXRNcyA9PT0gdW5kZWZpbmVkID8gXCJpbW1lZGlhdGVcIiA6IFwic2NoZWR1bGVkXCIsXG4gICAgICAuLi4ocHJlcGFyZWRKb2IudGltZW91dE1zID09PSBudWxsID8ge30gOiB7dGltZW91dE1zOiBwcmVwYXJlZEpvYi50aW1lb3V0TXN9KVxuICAgIH0pXG5cbiAgICByZXR1cm4gY3JlYXRlSGFzaChcInNoYTI1NlwiKS51cGRhdGUoc2VyaWFsaXplZCkuZGlnZXN0KFwiaGV4XCIpXG4gIH1cblxuICAvKipcbiAgICogRml4ZWQtc2l6ZSBnbG9iYWxseSBpbmRleGVkIHJlcHJlc2VudGF0aW9uIG9mIHRoZSBkb2N1bWVudGVkIHNjb3BlIHR1cGxlLlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIFNjb3BlIGlucHV0LlxuICAgKiBAcGFyYW0ge3N0cmluZ30gYXJncy5pZGVtcG90ZW5jeUtleSAtIENhbGxlciBrZXkuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBhcmdzLmpvYk5hbWUgLSBKb2IgY2xhc3MgbmFtZS5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGFyZ3MucXVldWUgLSBRdWV1ZSBuYW1lLlxuICAgKiBAcmV0dXJucyB7c3RyaW5nfSAtIFNIQS0yNTYgc2NvcGUgZGlnZXN0LlxuICAgKi9cbiAgX2lkZW1wb3RlbmN5U2NvcGVEaWdlc3Qoe2lkZW1wb3RlbmN5S2V5LCBqb2JOYW1lLCBxdWV1ZX0pIHtcbiAgICByZXR1cm4gY3JlYXRlSGFzaChcInNoYTI1NlwiKVxuICAgICAgLnVwZGF0ZShzdGFibGVKc29uU3RyaW5naWZ5KHtmb3JtYXQ6IFwidmVsb2Npb3VzLWJhY2tncm91bmQtam9iLWlkZW1wb3RlbmN5LXNjb3BlLXYxXCIsIGlkZW1wb3RlbmN5S2V5LCBqb2JOYW1lLCBxdWV1ZX0pKVxuICAgICAgLmRpZ2VzdChcImhleFwiKVxuICB9XG5cbiAgLyoqXG4gICAqIFZhbGlkYXRlcyBvbmUgY2FsbGVyIGtleS5cbiAgICogQHBhcmFtIHtzdHJpbmcgfCB1bmRlZmluZWR9IGlkZW1wb3RlbmN5S2V5IC0gQ2FsbGVyIGtleS5cbiAgICogQHJldHVybnMge3N0cmluZ30gLSBWYWxpZCBrZXkuXG4gICAqL1xuICBfbm9ybWFsaXplSWRlbXBvdGVuY3lLZXkoaWRlbXBvdGVuY3lLZXkpIHtcbiAgICBpZiAodHlwZW9mIGlkZW1wb3RlbmN5S2V5ICE9PSBcInN0cmluZ1wiIHx8IGlkZW1wb3RlbmN5S2V5Lmxlbmd0aCA9PT0gMCkge1xuICAgICAgdGhyb3cgVmVsb2Npb3VzRXJyb3Iuc2FmZShcIkJhY2tncm91bmQgam9iIGlkZW1wb3RlbmN5S2V5IG11c3QgYmUgYSBub24tZW1wdHkgc3RyaW5nLlwiLCB7XG4gICAgICAgIGNvZGU6IFwiYmFja2dyb3VuZC1qb2ItaWRlbXBvdGVuY3kta2V5LWludmFsaWRcIlxuICAgICAgfSlcbiAgICB9XG5cbiAgICByZXR1cm4gaWRlbXBvdGVuY3lLZXlcbiAgfVxuXG4gIC8qKlxuICAgKiBSZXBsYWNlcyB0aGUgcXVldWVkIG93bmVyIG9mIGEgc3RhYmxlIHNjaGVkdWxlIGtleSB3aXRoIGEgbmV3IG9uZS1vZmYgam9iLlxuICAgKiBBIGhhbmRlZC1vZmYgb3duZXIgaXMgbGVmdCBydW5uaW5nIGFuZCByZXBvcnRlZCB0cnV0aGZ1bGx5LlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIE9wdGlvbnMuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBhcmdzLnNjaGVkdWxlS2V5IC0gU3RhYmxlIGxvZ2ljYWwgc2NoZWR1bGUga2V5LlxuICAgKiBAcGFyYW0ge3N0cmluZ30gYXJncy5qb2JOYW1lIC0gSm9iIG5hbWUuXG4gICAqIEBwYXJhbSB7QXJyYXk8UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSBhcmdzLmFyZ3MgLSBBcmd1bWVudHMuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi90eXBlcy5qc1wiKS5CYWNrZ3JvdW5kSm9iT3B0aW9uc30gW2FyZ3Mub3B0aW9uc10gLSBPcHRpb25zLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxpbXBvcnQoXCIuL3R5cGVzLmpzXCIpLkJhY2tncm91bmRKb2JSZXBsYWNlbWVudFJlc3VsdD59IC0gUmVwbGFjZW1lbnQgcmVzdWx0LlxuICAgKi9cbiAgYXN5bmMgcmVwbGFjZVNjaGVkdWxlZCh7c2NoZWR1bGVLZXksIGpvYk5hbWUsIGFyZ3MsIG9wdGlvbnN9KSB7XG4gICAgYXdhaXQgdGhpcy5lbnN1cmVSZWFkeSgpXG5cbiAgICBjb25zdCBub3JtYWxpemVkU2NoZWR1bGVLZXkgPSB0aGlzLl9ub3JtYWxpemVTY2hlZHVsZUtleShzY2hlZHVsZUtleSlcbiAgICBjb25zdCBwcmVwYXJlZEpvYiA9IHRoaXMuX3ByZXBhcmVKb2Ioe2pvYk5hbWUsIGFyZ3MsIG9wdGlvbnN9KVxuXG4gICAgcmV0dXJuIGF3YWl0IHRoaXMuX3NlcmlhbGl6ZWRDb3VudE11dGF0aW9uKGFzeW5jIChkYikgPT4ge1xuICAgICAgY29uc3Qgb3duZXJSb3dzID0gYXdhaXQgZGJcbiAgICAgICAgLm5ld1F1ZXJ5KClcbiAgICAgICAgLmZyb20oU0NIRURVTEVfS0VZU19UQUJMRSlcbiAgICAgICAgLndoZXJlKHtzY2hlZHVsZV9rZXk6IG5vcm1hbGl6ZWRTY2hlZHVsZUtleX0pXG4gICAgICAgIC5saW1pdCgxKVxuICAgICAgICAucmVzdWx0cygpXG4gICAgICBjb25zdCBvd25lckpvYklkID0gb3duZXJSb3dzWzBdID8gU3RyaW5nKC8qKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSAqLyAob3duZXJSb3dzWzBdKS5qb2JfaWQpIDogbnVsbFxuICAgICAgY29uc3Qgb3duZXJKb2IgPSBvd25lckpvYklkID8gYXdhaXQgdGhpcy5fZ2V0Sm9iUm93QnlJZChkYiwgb3duZXJKb2JJZCkgOiBudWxsXG4gICAgICAvKiogQHR5cGUge2ltcG9ydChcIi4vdHlwZXMuanNcIikuQmFja2dyb3VuZEpvYlJlcGxhY2VtZW50UHJldmlvdXNTdGF0dXN9ICovXG4gICAgICBsZXQgcHJldmlvdXNTdGF0dXMgPSBudWxsXG4gICAgICBsZXQgcHJldmlvdXNKb2JJZCA9IG51bGxcblxuICAgICAgaWYgKG93bmVySm9iPy5zdGF0dXMgPT09IFwicXVldWVkXCIpIHtcbiAgICAgICAgY29uc3QgYWZmZWN0ZWRSb3dzID0gYXdhaXQgdGhpcy5fdXBkYXRlQWZmZWN0ZWRSb3dzKGRiLCB7XG4gICAgICAgICAgdGFibGVOYW1lOiBKT0JTX1RBQkxFLFxuICAgICAgICAgIGRhdGE6IHtzdGF0dXM6IFwiY2FuY2VsbGVkXCJ9LFxuICAgICAgICAgIGNvbmRpdGlvbnM6IHtpZDogb3duZXJKb2IuaWQsIHN0YXR1czogXCJxdWV1ZWRcIn1cbiAgICAgICAgfSlcblxuICAgICAgICBpZiAoYWZmZWN0ZWRSb3dzID09PSAxKSB7XG4gICAgICAgICAgcHJldmlvdXNKb2JJZCA9IG93bmVySm9iLmlkXG4gICAgICAgICAgcHJldmlvdXNTdGF0dXMgPSBcInF1ZXVlZFwiXG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgY29uc3QgY3VycmVudE93bmVySm9iID0gYXdhaXQgdGhpcy5fZ2V0Sm9iUm93QnlJZChkYiwgb3duZXJKb2IuaWQpXG5cbiAgICAgICAgICBpZiAoY3VycmVudE93bmVySm9iPy5zdGF0dXMgPT09IFwiaGFuZGVkX29mZlwiKSB7XG4gICAgICAgICAgICBwcmV2aW91c0pvYklkID0gY3VycmVudE93bmVySm9iLmlkXG4gICAgICAgICAgICBwcmV2aW91c1N0YXR1cyA9IFwiaGFuZGVkX29mZlwiXG4gICAgICAgICAgfVxuICAgICAgICB9XG4gICAgICB9IGVsc2UgaWYgKG93bmVySm9iPy5zdGF0dXMgPT09IFwiaGFuZGVkX29mZlwiKSB7XG4gICAgICAgIHByZXZpb3VzSm9iSWQgPSBvd25lckpvYi5pZFxuICAgICAgICBwcmV2aW91c1N0YXR1cyA9IFwiaGFuZGVkX29mZlwiXG4gICAgICB9XG5cbiAgICAgIGF3YWl0IHRoaXMuX2luc2VydFByZXBhcmVkSm9iKGRiLCB7cHJlcGFyZWRKb2IsIHNjaGVkdWxlS2V5OiBub3JtYWxpemVkU2NoZWR1bGVLZXl9KVxuICAgICAgYXdhaXQgZGIudXBzZXJ0KHtcbiAgICAgICAgdGFibGVOYW1lOiBTQ0hFRFVMRV9LRVlTX1RBQkxFLFxuICAgICAgICBkYXRhOiB7c2NoZWR1bGVfa2V5OiBub3JtYWxpemVkU2NoZWR1bGVLZXksIGpvYl9pZDogcHJlcGFyZWRKb2Iuam9iSWR9LFxuICAgICAgICBjb25mbGljdENvbHVtbnM6IFtcInNjaGVkdWxlX2tleVwiXSxcbiAgICAgICAgdXBkYXRlQ29sdW1uczogW1wiam9iX2lkXCJdXG4gICAgICB9KVxuXG4gICAgICBpZiAocHJldmlvdXNTdGF0dXMgIT09IFwicXVldWVkXCIpIGF3YWl0IHRoaXMuX3JlY29yZENvdW50RGVsdGEoZGIsIHthbGw6IDEsIHF1ZXVlZDogMX0pXG4gICAgICByZXR1cm4ge2pvYklkOiBwcmVwYXJlZEpvYi5qb2JJZCwgcHJldmlvdXNKb2JJZCwgcHJldmlvdXNTdGF0dXN9XG4gICAgfSwge1xuICAgICAgYWR2aXNvcnlMb2NrOiB7XG4gICAgICAgIGZhaWx1cmVNZXNzYWdlOiBcIkZhaWxlZCB0byBhY3F1aXJlIGJhY2tncm91bmQgam9iIHNjaGVkdWxlLWtleSBsb2NrXCIsXG4gICAgICAgIG5hbWU6IHRoaXMuX3NjaGVkdWxlS2V5TG9ja05hbWUobm9ybWFsaXplZFNjaGVkdWxlS2V5KVxuICAgICAgfVxuICAgIH0pXG4gIH1cblxuICAvKipcbiAgICogQ2FuY2VscyB0aGUgcXVldWVkIG93bmVyIG9mIGEgc3RhYmxlIHNjaGVkdWxlIGtleS4gQSBoYW5kZWQtb2ZmIG93bmVyIGlzXG4gICAqIGRldGFjaGVkIGJ1dCBub3QgbWFya2VkIHN0b3BwZWQgYmVjYXVzZSBleGVjdXRpb24gbWF5IGFscmVhZHkgYmUgcnVubmluZy5cbiAgICogQHBhcmFtIHtzdHJpbmd9IHNjaGVkdWxlS2V5IC0gU3RhYmxlIGxvZ2ljYWwgc2NoZWR1bGUga2V5LlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxpbXBvcnQoXCIuL3R5cGVzLmpzXCIpLkJhY2tncm91bmRKb2JDYW5jZWxsYXRpb25SZXN1bHQ+fSAtIENhbmNlbGxhdGlvbiByZXN1bHQuXG4gICAqL1xuICBhc3luYyBjYW5jZWxTY2hlZHVsZWQoc2NoZWR1bGVLZXkpIHtcbiAgICBhd2FpdCB0aGlzLmVuc3VyZVJlYWR5KClcblxuICAgIGNvbnN0IG5vcm1hbGl6ZWRTY2hlZHVsZUtleSA9IHRoaXMuX25vcm1hbGl6ZVNjaGVkdWxlS2V5KHNjaGVkdWxlS2V5KVxuXG4gICAgcmV0dXJuIGF3YWl0IHRoaXMuX3NlcmlhbGl6ZWRDb3VudE11dGF0aW9uKGFzeW5jIChkYikgPT4ge1xuICAgICAgY29uc3Qgb3duZXJSb3dzID0gYXdhaXQgZGJcbiAgICAgICAgLm5ld1F1ZXJ5KClcbiAgICAgICAgLmZyb20oU0NIRURVTEVfS0VZU19UQUJMRSlcbiAgICAgICAgLndoZXJlKHtzY2hlZHVsZV9rZXk6IG5vcm1hbGl6ZWRTY2hlZHVsZUtleX0pXG4gICAgICAgIC5saW1pdCgxKVxuICAgICAgICAucmVzdWx0cygpXG5cbiAgICAgIGlmICghb3duZXJSb3dzWzBdKSByZXR1cm4ge2pvYklkOiBudWxsLCBvdXRjb21lOiBcIm5vdF9mb3VuZFwifVxuXG4gICAgICBjb25zdCBqb2JJZCA9IFN0cmluZygvKiogQHR5cGUge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gKi8gKG93bmVyUm93c1swXSkuam9iX2lkKVxuICAgICAgY29uc3Qgam9iID0gYXdhaXQgdGhpcy5fZ2V0Sm9iUm93QnlJZChkYiwgam9iSWQpXG5cbiAgICAgIGlmIChqb2I/LnN0YXR1cyA9PT0gXCJxdWV1ZWRcIikge1xuICAgICAgICBjb25zdCBhZmZlY3RlZFJvd3MgPSBhd2FpdCB0aGlzLl91cGRhdGVBZmZlY3RlZFJvd3MoZGIsIHtcbiAgICAgICAgICB0YWJsZU5hbWU6IEpPQlNfVEFCTEUsXG4gICAgICAgICAgZGF0YToge3N0YXR1czogXCJjYW5jZWxsZWRcIn0sXG4gICAgICAgICAgY29uZGl0aW9uczoge2lkOiBqb2IuaWQsIHN0YXR1czogXCJxdWV1ZWRcIn1cbiAgICAgICAgfSlcblxuICAgICAgICBpZiAoYWZmZWN0ZWRSb3dzID09PSAxKSB7XG4gICAgICAgICAgYXdhaXQgdGhpcy5fcmVsZWFzZVNjaGVkdWxlT3duZXJzaGlwKGRiLCB7am9iSWQsIHNjaGVkdWxlS2V5OiBub3JtYWxpemVkU2NoZWR1bGVLZXl9KVxuICAgICAgICAgIGF3YWl0IHRoaXMuX3JlY29yZFN0YXR1c1RyYW5zaXRpb24oZGIsIFwicXVldWVkXCIsIFwiY2FuY2VsbGVkXCIpXG5cbiAgICAgICAgICByZXR1cm4ge2pvYklkLCBvdXRjb21lOiBcImNhbmNlbGxlZFwifVxuICAgICAgICB9XG4gICAgICB9XG5cbiAgICAgIGNvbnN0IGN1cnJlbnRKb2IgPSBhd2FpdCB0aGlzLl9nZXRKb2JSb3dCeUlkKGRiLCBqb2JJZClcblxuICAgICAgYXdhaXQgdGhpcy5fcmVsZWFzZVNjaGVkdWxlT3duZXJzaGlwKGRiLCB7am9iSWQsIHNjaGVkdWxlS2V5OiBub3JtYWxpemVkU2NoZWR1bGVLZXl9KVxuXG4gICAgICBpZiAoY3VycmVudEpvYj8uc3RhdHVzID09PSBcImhhbmRlZF9vZmZcIikgcmV0dXJuIHtqb2JJZCwgb3V0Y29tZTogXCJoYW5kZWRfb2ZmXCJ9XG4gICAgICByZXR1cm4ge2pvYklkOiBudWxsLCBvdXRjb21lOiBcIm5vdF9mb3VuZFwifVxuICAgIH0sIHtcbiAgICAgIGFkdmlzb3J5TG9jazoge1xuICAgICAgICBmYWlsdXJlTWVzc2FnZTogXCJGYWlsZWQgdG8gYWNxdWlyZSBiYWNrZ3JvdW5kIGpvYiBzY2hlZHVsZS1rZXkgbG9ja1wiLFxuICAgICAgICBuYW1lOiB0aGlzLl9zY2hlZHVsZUtleUxvY2tOYW1lKG5vcm1hbGl6ZWRTY2hlZHVsZUtleSlcbiAgICAgIH1cbiAgICB9KVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgbmV4dCBhdmFpbGFibGUgam9iLlxuICAgKiBAcGFyYW0ge29iamVjdH0gW2FyZ3NdIC0gT3B0aW9ucy5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL3R5cGVzLmpzXCIpLkJhY2tncm91bmRKb2JFeGVjdXRpb25Nb2RlIHwgaW1wb3J0KFwiLi90eXBlcy5qc1wiKS5CYWNrZ3JvdW5kSm9iRXhlY3V0aW9uTW9kZVtdfSBbYXJncy5leGVjdXRpb25Nb2RlXSAtIEV4ZWN1dGlvbiBtb2RlIG9yIG1vZGVzIHRvIG1hdGNoLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxpbXBvcnQoXCIuL3R5cGVzLmpzXCIpLkJhY2tncm91bmRKb2JSb3cgfCBudWxsPn0gLSBOZXh0IGpvYi5cbiAgICovXG4gIGFzeW5jIG5leHRBdmFpbGFibGVKb2IoYXJncyA9IHt9KSB7XG4gICAgYXdhaXQgdGhpcy5lbnN1cmVSZWFkeSgpXG5cbiAgICByZXR1cm4gYXdhaXQgdGhpcy5fd2l0aERiKGFzeW5jIChkYikgPT4ge1xuICAgICAgcmV0dXJuIGF3YWl0IHRoaXMuX25leHRRdWV1ZWRKb2Ioe1xuICAgICAgICBkYixcbiAgICAgICAgc2NoZWR1bGVkQXRPcGVyYXRvcjogXCI8PVwiLFxuICAgICAgICBleGVjdXRpb25Nb2RlOiBhcmdzLmV4ZWN1dGlvbk1vZGVcbiAgICAgIH0pXG4gICAgfSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSZXR1cm5zIHRoZSBzb29uZXN0IGZ1dHVyZS1zY2hlZHVsZWQgcXVldWVkIGpvYiAob25lIHdob3NlXG4gICAqIGBzY2hlZHVsZWRfYXRfbXNgIGlzIGluIHRoZSBmdXR1cmUpLCBvciBudWxsIHdoZW4gdGhlcmUgYXJlIG5vXG4gICAqIGZ1dHVyZS1zY2hlZHVsZWQgam9icy4gVXNlZCBieSB0aGUgZXZlbnQtZHJpdmVuIGRpc3BhdGNoZXIgdG8gYXJtIGFcbiAgICogYHNldFRpbWVvdXRgIGZvciB0aGUgZXhhY3QgbW9tZW50IHRoZSBuZXh0IHNjaGVkdWxlZCBqb2IgYmVjb21lc1xuICAgKiBlbGlnaWJsZSwgcmVwbGFjaW5nIHRoZSBsZWdhY3kgMS1zZWNvbmQgcG9sbGluZyBsb29wLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxpbXBvcnQoXCIuL3R5cGVzLmpzXCIpLkJhY2tncm91bmRKb2JSb3cgfCBudWxsPn0gLSBTb29uZXN0IGZ1dHVyZS1zY2hlZHVsZWQgam9iLCBvciBudWxsLlxuICAgKi9cbiAgYXN5bmMgbmV4dFNjaGVkdWxlZEpvYigpIHtcbiAgICBhd2FpdCB0aGlzLmVuc3VyZVJlYWR5KClcblxuICAgIHJldHVybiBhd2FpdCB0aGlzLl93aXRoRGIoYXN5bmMgKGRiKSA9PiB7XG4gICAgICByZXR1cm4gYXdhaXQgdGhpcy5fbmV4dFF1ZXVlZEpvYih7ZGIsIHNjaGVkdWxlZEF0T3BlcmF0b3I6IFwiPlwifSlcbiAgICB9KVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgbmV4dCBxdWV1ZWQgam9iLlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIE9wdGlvbnMuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vZGF0YWJhc2UvZHJpdmVycy9iYXNlLmpzXCIpLmRlZmF1bHR9IGFyZ3MuZGIgLSBEYXRhYmFzZSBjb25uZWN0aW9uLlxuICAgKiBAcGFyYW0ge1wiPD1cIiB8IFwiPlwifSBhcmdzLnNjaGVkdWxlZEF0T3BlcmF0b3IgLSBTY2hlZHVsZWQgdGltZXN0YW1wIG9wZXJhdG9yLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vdHlwZXMuanNcIikuQmFja2dyb3VuZEpvYkV4ZWN1dGlvbk1vZGUgfCBpbXBvcnQoXCIuL3R5cGVzLmpzXCIpLkJhY2tncm91bmRKb2JFeGVjdXRpb25Nb2RlW119IFthcmdzLmV4ZWN1dGlvbk1vZGVdIC0gRXhlY3V0aW9uIG1vZGUgb3IgbW9kZXMgdG8gbWF0Y2guXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPGltcG9ydChcIi4vdHlwZXMuanNcIikuQmFja2dyb3VuZEpvYlJvdyB8IG51bGw+fSAtIE5leHQgbWF0Y2hpbmcgcXVldWVkIGpvYi5cbiAgICovXG4gIGFzeW5jIF9uZXh0UXVldWVkSm9iKHtkYiwgc2NoZWR1bGVkQXRPcGVyYXRvciwgZXhlY3V0aW9uTW9kZX0pIHtcbiAgICBjb25zdCBub3cgPSBEYXRlLm5vdygpXG4gICAgbGV0IHF1ZXJ5ID0gZGJcbiAgICAgIC5uZXdRdWVyeSgpXG4gICAgICAuZnJvbShKT0JTX1RBQkxFKVxuICAgICAgLndoZXJlKHtzdGF0dXM6IFwicXVldWVkXCJ9KVxuICAgICAgLndoZXJlKGBzY2hlZHVsZWRfYXRfbXMgJHtzY2hlZHVsZWRBdE9wZXJhdG9yfSAke2RiLnF1b3RlKG5vdyl9YClcblxuICAgIGlmIChzY2hlZHVsZWRBdE9wZXJhdG9yID09PSBcIjw9XCIpIHtcbiAgICAgIGNvbnN0IGpvYnNUYWJsZSA9IGRiLnF1b3RlVGFibGUoSk9CU19UQUJMRSlcbiAgICAgIGNvbnN0IGNvbmN1cnJlbmN5VGFibGUgPSBkYi5xdW90ZVRhYmxlKENPTkNVUlJFTkNZX1RBQkxFKVxuICAgICAgcXVlcnkgPSBxdWVyeS53aGVyZShcbiAgICAgICAgYCgke2pvYnNUYWJsZX0uJHtkYi5xdW90ZUNvbHVtbihcImNvbmN1cnJlbmN5X2tleVwiKX0gSVMgTlVMTCBPUiBFWElTVFMgKGAgK1xuICAgICAgICBgU0VMRUNUIDEgRlJPTSAke2NvbmN1cnJlbmN5VGFibGV9IFdIRVJFIGAgK1xuICAgICAgICBgJHtjb25jdXJyZW5jeVRhYmxlfS4ke2RiLnF1b3RlQ29sdW1uKFwiY29uY3VycmVuY3lfa2V5XCIpfSA9ICR7am9ic1RhYmxlfS4ke2RiLnF1b3RlQ29sdW1uKFwiY29uY3VycmVuY3lfa2V5XCIpfSBBTkQgYCArXG4gICAgICAgIGAke2NvbmN1cnJlbmN5VGFibGV9LiR7ZGIucXVvdGVDb2x1bW4oXCJhY3RpdmVfY291bnRcIil9IDwgJHtjb25jdXJyZW5jeVRhYmxlfS4ke2RiLnF1b3RlQ29sdW1uKFwibWF4X2NvbmN1cnJlbmN5XCIpfSkpYFxuICAgICAgKVxuICAgIH1cblxuICAgIGlmIChleGVjdXRpb25Nb2RlKSBxdWVyeSA9IHRoaXMuX3doZXJlRXhlY3V0aW9uTW9kZSh7ZGIsIGV4ZWN1dGlvbk1vZGUsIHF1ZXJ5fSlcblxuICAgIGlmIChzY2hlZHVsZWRBdE9wZXJhdG9yID09PSBcIjw9XCIpIHtcbiAgICAgIGNvbnN0IHByaW9yaXR5T3JkZXIgPSB0aGlzLl9xdWV1ZVByaW9yaXR5T3JkZXJTcWwoZGIpXG5cbiAgICAgIGlmIChwcmlvcml0eU9yZGVyKSBxdWVyeSA9IHF1ZXJ5Lm9yZGVyKGAke3ByaW9yaXR5T3JkZXJ9IERFU0NgKVxuICAgIH1cblxuICAgIHF1ZXJ5ID0gcXVlcnlcbiAgICAgIC5vcmRlcihcInNjaGVkdWxlZF9hdF9tcyBBU0NcIilcbiAgICAgIC5vcmRlcihcImNyZWF0ZWRfYXRfbXMgQVNDXCIpXG4gICAgICAubGltaXQoMSlcblxuICAgIGNvbnN0IHJvd3MgPSBhd2FpdCBxdWVyeS5yZXN1bHRzKClcbiAgICBjb25zdCByb3cgPSByb3dzWzBdXG5cbiAgICBpZiAoIXJvdykgcmV0dXJuIG51bGxcblxuICAgIHJldHVybiB0aGlzLl9ub3JtYWxpemVKb2JSb3cocm93KVxuICB9XG5cbiAgLyoqXG4gICAqIEJ1aWxkcyBhIHJhdyBTUUwgT1JERVIgQlkgZXhwcmVzc2lvbiByYW5raW5nIHF1ZXVlZCBqb2JzIGJ5IHRoZWlyIHF1ZXVlJ3NcbiAgICogY29uZmlndXJlZCBwcmlvcml0eSAoYGJhY2tncm91bmRKb2JzLnF1ZXVlc1txdWV1ZV0ucHJpb3JpdHlgLCBkZWZhdWx0IGAwYCksXG4gICAqIHNvIHRoZSBkaXNwYXRjaGVyIHBpY2tzIGhpZ2hlci1wcmlvcml0eSBxdWV1ZXMgZmlyc3QgcmVnYXJkbGVzcyBvZiBlbnF1ZXVlXG4gICAqIG9yZGVyLiBPbmx5IGFwcGxpZWQgdG8gdGhlIGRpc3BhdGNoIHBhdGggKGBzY2hlZHVsZWRBdE9wZXJhdG9yID09PSBcIjw9XCJgKTtcbiAgICogdGhlIGZ1dHVyZS1zY2hlZHVsZWQgbG9va3VwIG11c3Qgc3RheSBzdHJpY3RseSB0aW1lLW9yZGVyZWQuIENvbXBvc2VzIHdpdGhcbiAgICogdGhlIGNvbmN1cnJlbmN5IEVYSVNUUyBmaWx0ZXI6IGEgaGlnaGVyLXByaW9yaXR5IHF1ZXVlIGFscmVhZHkgYXQgaXRzIGNhcCBpc1xuICAgKiBmaWx0ZXJlZCBvdXQsIHNvIGRpc3BhdGNoIGZhbGxzIHRocm91Z2ggdG8gdGhlIG5leHQgZWxpZ2libGUgbG93ZXItcHJpb3JpdHlcbiAgICogam9iLiBSZXR1cm5zIG51bGwgd2hlbiBubyBxdWV1ZSBjb25maWd1cmVzIGEgbm9uLXplcm8gcHJpb3JpdHkgc28gdGhlIHBsYWluXG4gICAqIEZJRk8gb3JkZXJpbmcgaXMgbGVmdCB1bnRvdWNoZWQgKGFuZCBubyBuZWVkbGVzcyBmaWxlc29ydCBpcyBpbnRyb2R1Y2VkKS5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9kYXRhYmFzZS9kcml2ZXJzL2Jhc2UuanNcIikuZGVmYXVsdH0gZGIgLSBEYXRhYmFzZSBjb25uZWN0aW9uLlxuICAgKiBAcmV0dXJucyB7c3RyaW5nIHwgbnVsbH0gLSBSYXcgU1FMIENBU0UgZXhwcmVzc2lvbiwgb3IgbnVsbCB3aGVuIG5vIHF1ZXVlIGlzIHByaW9yaXRpemVkLlxuICAgKi9cbiAgX3F1ZXVlUHJpb3JpdHlPcmRlclNxbChkYikge1xuICAgIGNvbnN0IHF1ZXVlcyA9IHRoaXMuY29uZmlndXJhdGlvbi5nZXRCYWNrZ3JvdW5kSm9ic0NvbmZpZygpLnF1ZXVlcyB8fCB7fVxuICAgIC8qKiBAdHlwZSB7QXJyYXk8W3N0cmluZywgbnVtYmVyXT59ICovXG4gICAgY29uc3QgcHJpb3JpdGl6ZWQgPSBbXVxuXG4gICAgZm9yIChjb25zdCBbcXVldWUsIHF1ZXVlQ29uZmlnXSBvZiBPYmplY3QuZW50cmllcyhxdWV1ZXMpKSB7XG4gICAgICBjb25zdCBwcmlvcml0eSA9IHF1ZXVlQ29uZmlnPy5wcmlvcml0eVxuXG4gICAgICBpZiAoTnVtYmVyLmlzRmluaXRlKHByaW9yaXR5KSAmJiBOdW1iZXIocHJpb3JpdHkpICE9PSAwKSBwcmlvcml0aXplZC5wdXNoKFtxdWV1ZSwgTnVtYmVyKHByaW9yaXR5KV0pXG4gICAgfVxuXG4gICAgaWYgKHByaW9yaXRpemVkLmxlbmd0aCA9PT0gMCkgcmV0dXJuIG51bGxcblxuICAgIGNvbnN0IHF1ZXVlQ29sdW1uID0gZGIucXVvdGVDb2x1bW4oXCJxdWV1ZVwiKVxuICAgIGNvbnN0IHdoZW5zID0gcHJpb3JpdGl6ZWRcbiAgICAgIC5tYXAoKFtxdWV1ZSwgcHJpb3JpdHldKSA9PiBgV0hFTiAke2RiLnF1b3RlKHF1ZXVlKX0gVEhFTiAke3ByaW9yaXR5fWApXG4gICAgICAuam9pbihcIiBcIilcblxuICAgIHJldHVybiBgQ0FTRSBDT0FMRVNDRSgke3F1ZXVlQ29sdW1ufSwgJHtkYi5xdW90ZShERUZBVUxUX0JBQ0tHUk9VTkRfSk9CX1FVRVVFKX0pICR7d2hlbnN9IEVMU0UgMCBFTkRgXG4gIH1cblxuICAvKipcbiAgICogUnVucyBnZXQgam9iLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gam9iSWQgLSBKb2IgaWQuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPGltcG9ydChcIi4vdHlwZXMuanNcIikuQmFja2dyb3VuZEpvYlJvdyB8IG51bGw+fSAtIEpvYiByb3cuXG4gICAqL1xuICBhc3luYyBnZXRKb2Ioam9iSWQpIHtcbiAgICBhd2FpdCB0aGlzLmVuc3VyZVJlYWR5KClcblxuICAgIHJldHVybiBhd2FpdCB0aGlzLl93aXRoRGIoYXN5bmMgKGRiKSA9PiB7XG4gICAgICBjb25zdCBxdWVyeSA9IGRiXG4gICAgICAgIC5uZXdRdWVyeSgpXG4gICAgICAgIC5mcm9tKEpPQlNfVEFCTEUpXG4gICAgICAgIC53aGVyZSh7aWQ6IGpvYklkfSlcbiAgICAgICAgLmxpbWl0KDEpXG5cbiAgICAgIGNvbnN0IHJvd3MgPSBhd2FpdCBxdWVyeS5yZXN1bHRzKClcbiAgICAgIGNvbnN0IHJvdyA9IHJvd3NbMF1cblxuICAgICAgaWYgKCFyb3cpIHJldHVybiBudWxsXG5cbiAgICAgIHJldHVybiB0aGlzLl9ub3JtYWxpemVKb2JSb3cocm93KVxuICAgIH0pXG4gIH1cblxuICAvKipcbiAgICogQ291bnRzIGpvYnMgZ3JvdXBlZCBieSBzdGF0dXMuIFVzZWQgYnkgdGhlIGRhc2hib2FyZCBvdmVydmlldy5cbiAgICogQHJldHVybnMge1Byb21pc2U8UmVjb3JkPHN0cmluZywgbnVtYmVyPj59IC0gQ291bnRzIGtleWVkIGJ5IHN0YXR1cy5cbiAgICovXG4gIGFzeW5jIGNvdW50c0J5U3RhdHVzKCkge1xuICAgIGF3YWl0IHRoaXMuZW5zdXJlUmVhZHkoKVxuXG4gICAgcmV0dXJuIGF3YWl0IHRoaXMuX3dpdGhEYihhc3luYyAoZGIpID0+IHtcbiAgICAgIGNvbnN0IHJvd3MgPSBhd2FpdCBkYlxuICAgICAgICAubmV3UXVlcnkoKVxuICAgICAgICAuZnJvbShKT0JTX1RBQkxFKVxuICAgICAgICAuc2VsZWN0KFwic3RhdHVzXCIpXG4gICAgICAgIC5zZWxlY3QoXCJDT1VOVCgqKSBBUyBjb3VudFwiKVxuICAgICAgICAuZ3JvdXAoXCJzdGF0dXNcIilcbiAgICAgICAgLnJlc3VsdHMoKVxuXG4gICAgICAvKipcbiAgICAgICAqIENvdW50cy5cbiAgICAgICAqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBudW1iZXI+fSAqL1xuICAgICAgY29uc3QgY291bnRzID0ge31cblxuICAgICAgZm9yIChjb25zdCByb3cgb2Ygcm93cykge1xuICAgICAgICBjb25zdCB0eXBlZFJvdyA9IC8qKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSAqLyAocm93KVxuXG4gICAgICAgIGNvdW50c1tTdHJpbmcodHlwZWRSb3cuc3RhdHVzKV0gPSB0aGlzLl9ub3JtYWxpemVOdW1iZXIodHlwZWRSb3cuY291bnQpIHx8IDBcbiAgICAgIH1cblxuICAgICAgcmV0dXJuIGNvdW50c1xuICAgIH0pXG4gIH1cblxuICAvKipcbiAgICogUmV0dXJucyB0aGUgYXV0aG9yaXRhdGl2ZSBkYXNoYm9hcmQgY291bnQgc25hcHNob3QgYW5kIGl0cyBtYXRjaGluZyBkdXJhYmxlXG4gICAqIHJldmlzaW9uLiBMb2NraW5nIHRoZSByZXZpc2lvbiByb3cgYmVmb3JlIGNvdW50aW5nIHByZXZlbnRzIGEgd3JpdGVyIGZyb21cbiAgICogY29tbWl0dGluZyBiZXR3ZWVuIHRoZSBjb3VudCBxdWVyeSBhbmQgcmV2aXNpb24gcmVhZC5cbiAgICogQHJldHVybnMge1Byb21pc2U8e2NvdW50czogUmVjb3JkPHN0cmluZywgbnVtYmVyPiwgcmV2aXNpb246IG51bWJlciwgdG90YWw6IG51bWJlcn0+fSBTbmFwc2hvdC5cbiAgICovXG4gIGFzeW5jIGNvdW50U25hcHNob3QoKSB7XG4gICAgYXdhaXQgdGhpcy5lbnN1cmVSZWFkeSgpXG5cbiAgICByZXR1cm4gYXdhaXQgdGhpcy5fc2VyaWFsaXplZENvdW50TXV0YXRpb24oYXN5bmMgKGRiKSA9PiB7XG4gICAgICByZXR1cm4gYXdhaXQgdGhpcy5fY291bnRTbmFwc2hvdE9uTG9ja2VkQ29ubmVjdGlvbihkYilcbiAgICB9KVxuICB9XG5cbiAgLyoqXG4gICAqIENvdW50cyBqb2JzIG1hdGNoaW5nIHRoZSBnaXZlbiBmaWx0ZXJzLlxuICAgKiBAcGFyYW0ge29iamVjdH0gW2FyZ3NdIC0gT3B0aW9ucy5cbiAgICogQHBhcmFtIHtzdHJpbmd9IFthcmdzLnN0YXR1c10gLSBGaWx0ZXIgYnkgc3RhdHVzLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gW2FyZ3Muam9iTmFtZV0gLSBGaWx0ZXIgYnkgam9iIG5hbWUuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPG51bWJlcj59IC0gTWF0Y2hpbmcgam9iIGNvdW50LlxuICAgKi9cbiAgYXN5bmMgY291bnRKb2JzKHtzdGF0dXMsIGpvYk5hbWV9ID0ge30pIHtcbiAgICBhd2FpdCB0aGlzLmVuc3VyZVJlYWR5KClcblxuICAgIHJldHVybiBhd2FpdCB0aGlzLl93aXRoRGIoYXN5bmMgKGRiKSA9PiB7XG4gICAgICBsZXQgcXVlcnkgPSBkYi5uZXdRdWVyeSgpLmZyb20oSk9CU19UQUJMRSkuc2VsZWN0KFwiQ09VTlQoKikgQVMgY291bnRcIilcblxuICAgICAgaWYgKHN0YXR1cykgcXVlcnkgPSBxdWVyeS53aGVyZSh7c3RhdHVzfSlcbiAgICAgIGlmIChqb2JOYW1lKSBxdWVyeSA9IHF1ZXJ5LndoZXJlKHtqb2JfbmFtZTogam9iTmFtZX0pXG5cbiAgICAgIGNvbnN0IHJvd3MgPSBhd2FpdCBxdWVyeS5yZXN1bHRzKClcbiAgICAgIGNvbnN0IGNvdW50Um93ID0gLyoqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59ICovIChyb3dzWzBdIHx8IHt9KVxuXG4gICAgICByZXR1cm4gdGhpcy5fbm9ybWFsaXplTnVtYmVyKGNvdW50Um93LmNvdW50KSB8fCAwXG4gICAgfSlcbiAgfVxuXG4gIC8qKlxuICAgKiBMaXN0cyBqb2JzIGZvciB0aGUgZGFzaGJvYXJkLCBmaWx0ZXJlZCwgc29ydGVkIGFuZCBwYWdpbmF0ZWQuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBbYXJnc10gLSBPcHRpb25zLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gW2FyZ3Muc3RhdHVzXSAtIEZpbHRlciBieSBzdGF0dXMuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBbYXJncy5qb2JOYW1lXSAtIEZpbHRlciBieSBqb2IgbmFtZS5cbiAgICogQHBhcmFtIHtudW1iZXJ9IFthcmdzLmxpbWl0XSAtIE1heGltdW0gcm93cyB0byByZXR1cm4uXG4gICAqIEBwYXJhbSB7bnVtYmVyfSBbYXJncy5vZmZzZXRdIC0gUm93cyB0byBza2lwLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gW2FyZ3Muc29ydENvbHVtbl0gLSBDYW1lbC1jYXNlZCBjb2x1bW4gdG8gc29ydCBieSAoc2VlIFNPUlRBQkxFX0NPTFVNTlMpLlxuICAgKiBAcGFyYW0ge1wiQVNDXCIgfCBcIkRFU0NcIn0gW2FyZ3Muc29ydERpcmVjdGlvbl0gLSBTb3J0IGRpcmVjdGlvbi5cbiAgICogQHJldHVybnMge1Byb21pc2U8aW1wb3J0KFwiLi90eXBlcy5qc1wiKS5CYWNrZ3JvdW5kSm9iUm93W10+fSAtIE5vcm1hbGl6ZWQgam9iIHJvd3MuXG4gICAqL1xuICBhc3luYyBsaXN0Sm9icyh7c3RhdHVzLCBqb2JOYW1lLCBsaW1pdCA9IDI1LCBvZmZzZXQgPSAwLCBzb3J0Q29sdW1uID0gXCJjcmVhdGVkQXRNc1wiLCBzb3J0RGlyZWN0aW9uID0gXCJERVNDXCJ9ID0ge30pIHtcbiAgICBhd2FpdCB0aGlzLmVuc3VyZVJlYWR5KClcblxuICAgIGNvbnN0IGNvbHVtbiA9IFNPUlRBQkxFX0NPTFVNTlNbc29ydENvbHVtbl0gfHwgU09SVEFCTEVfQ09MVU1OUy5jcmVhdGVkQXRNc1xuICAgIGNvbnN0IGRpcmVjdGlvbiA9IHNvcnREaXJlY3Rpb24gPT09IFwiQVNDXCIgPyBcIkFTQ1wiIDogXCJERVNDXCJcblxuICAgIHJldHVybiBhd2FpdCB0aGlzLl93aXRoRGIoYXN5bmMgKGRiKSA9PiB7XG4gICAgICBsZXQgcXVlcnkgPSBkYi5uZXdRdWVyeSgpLmZyb20oSk9CU19UQUJMRSlcblxuICAgICAgaWYgKHN0YXR1cykgcXVlcnkgPSBxdWVyeS53aGVyZSh7c3RhdHVzfSlcbiAgICAgIGlmIChqb2JOYW1lKSBxdWVyeSA9IHF1ZXJ5LndoZXJlKHtqb2JfbmFtZTogam9iTmFtZX0pXG5cbiAgICAgIHF1ZXJ5ID0gcXVlcnkub3JkZXIoe2NvbHVtbiwgZGlyZWN0aW9ufSlcbiAgICAgIGlmIChjb2x1bW4gIT09IFNPUlRBQkxFX0NPTFVNTlMuY3JlYXRlZEF0TXMpIHF1ZXJ5ID0gcXVlcnkub3JkZXIoe2NvbHVtbjogU09SVEFCTEVfQ09MVU1OUy5jcmVhdGVkQXRNcywgZGlyZWN0aW9uOiBcIkRFU0NcIn0pXG5cbiAgICAgIGNvbnN0IHJvd3MgPSBhd2FpdCBxdWVyeS5saW1pdChsaW1pdCkub2Zmc2V0KG9mZnNldCkucmVzdWx0cygpXG5cbiAgICAgIHJldHVybiByb3dzLm1hcCgocm93KSA9PiB0aGlzLl9ub3JtYWxpemVKb2JSb3cocm93KSlcbiAgICB9KVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgbWFyayBoYW5kZWQgb2ZmLlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIE9wdGlvbnMuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBhcmdzLmpvYklkIC0gSm9iIGlkLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gW2FyZ3MuaGFuZG9mZklkXSAtIENhbGxlci1zZWxlY3RlZCBleGFjdCBsZWFzZSBpZC4gR2VuZXJhdGVkIGZvciBsZWdhY3kgZGlyZWN0IGNhbGxlcnMgd2hlbiBvbWl0dGVkLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gW2FyZ3Mud29ya2VySWRdIC0gV29ya2VyIGlkLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxpbXBvcnQoXCIuL3R5cGVzLmpzXCIpLkJhY2tncm91bmRKb2JIYW5kb2ZmIHwgbnVsbD59IC0gQ2xhaW1lZCBoYW5kb2ZmIGxlYXNlLCBvciBudWxsIHdoZW4gbm8gbG9uZ2VyIHF1ZXVlZC5cbiAgICovXG4gIGFzeW5jIG1hcmtIYW5kZWRPZmYoe2pvYklkLCBoYW5kb2ZmSWQgPSByYW5kb21VVUlEKCksIHdvcmtlcklkfSkge1xuICAgIGF3YWl0IHRoaXMuZW5zdXJlUmVhZHkoKVxuXG4gICAgY29uc3QgaGFuZGVkT2ZmQXRNcyA9IERhdGUubm93KClcblxuICAgIHJldHVybiBhd2FpdCB0aGlzLl9zZXJpYWxpemVkQ291bnRNdXRhdGlvbihhc3luYyAoZGIpID0+IHtcbiAgICAgIGNvbnN0IHF1ZXVlZEpvYiA9IGF3YWl0IHRoaXMuX2dldEpvYlJvd0J5SWQoZGIsIGpvYklkKVxuICAgICAgaWYgKCFxdWV1ZWRKb2IgfHwgcXVldWVkSm9iLnN0YXR1cyAhPT0gXCJxdWV1ZWRcIikgcmV0dXJuIG51bGxcbiAgICAgIGlmIChxdWV1ZWRKb2IuY29uY3VycmVuY3lLZXkgJiYgIShhd2FpdCB0aGlzLl9yZXNlcnZlQ29uY3VycmVuY3koZGIsIHF1ZXVlZEpvYi5jb25jdXJyZW5jeUtleSkpKSByZXR1cm4gbnVsbFxuICAgICAgY29uc3QgYWZmZWN0ZWRSb3dzID0gYXdhaXQgdGhpcy5fdXBkYXRlQWZmZWN0ZWRSb3dzKGRiLCB7XG4gICAgICAgIHRhYmxlTmFtZTogSk9CU19UQUJMRSxcbiAgICAgICAgZGF0YToge1xuICAgICAgICAgIHN0YXR1czogXCJoYW5kZWRfb2ZmXCIsXG4gICAgICAgICAgaGFuZGVkX29mZl9hdF9tczogaGFuZGVkT2ZmQXRNcyxcbiAgICAgICAgICBoYW5kb2ZmX2lkOiBoYW5kb2ZmSWQsXG4gICAgICAgICAgd29ya2VyX2lkOiB3b3JrZXJJZCB8fCBudWxsXG4gICAgICAgIH0sXG4gICAgICAgIGNvbmRpdGlvbnM6IHtjb25jdXJyZW5jeV9rZXk6IHF1ZXVlZEpvYi5jb25jdXJyZW5jeUtleSwgaWQ6IGpvYklkLCBzdGF0dXM6IFwicXVldWVkXCJ9XG4gICAgICB9KVxuXG4gICAgICBpZiAoYWZmZWN0ZWRSb3dzICE9PSAxKSB7XG4gICAgICAgIGF3YWl0IHRoaXMuX3JlbGVhc2VDb25jdXJyZW5jeShkYiwgcXVldWVkSm9iLmNvbmN1cnJlbmN5S2V5KVxuICAgICAgICByZXR1cm4gbnVsbFxuICAgICAgfVxuXG4gICAgICBhd2FpdCB0aGlzLl9yZWNvcmRTdGF0dXNUcmFuc2l0aW9uKGRiLCBcInF1ZXVlZFwiLCBcImhhbmRlZF9vZmZcIilcbiAgICAgIHJldHVybiB7aGFuZGVkT2ZmQXRNcywgaGFuZG9mZklkfVxuICAgIH0pXG4gIH1cblxuICAvKipcbiAgICogUnVucyBtYXJrIGNvbXBsZXRlZC5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBPcHRpb25zLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gYXJncy5qb2JJZCAtIEpvYiBpZC5cbiAgICogQHBhcmFtIHtzdHJpbmd9IFthcmdzLmhhbmRvZmZJZF0gLSBIYW5kb2ZmIGxlYXNlIGlkLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gW2FyZ3Mud29ya2VySWRdIC0gV29ya2VyIGlkLlxuICAgKiBAcGFyYW0ge251bWJlcn0gW2FyZ3MuaGFuZGVkT2ZmQXRNc10gLSBIYW5kZWQgb2ZmIHRpbWVzdGFtcC5cbiAgICogQHJldHVybnMge1Byb21pc2U8Ym9vbGVhbj59IC0gV2hldGhlciB0aGUgZmVuY2VkIHJlcG9ydCB3YXMgYWNjZXB0ZWQuXG4gICAqL1xuICBhc3luYyBtYXJrQ29tcGxldGVkKHtqb2JJZCwgaGFuZG9mZklkLCB3b3JrZXJJZCwgaGFuZGVkT2ZmQXRNc30pIHtcbiAgICBhd2FpdCB0aGlzLmVuc3VyZVJlYWR5KClcblxuICAgIHJldHVybiBhd2FpdCB0aGlzLl9zZXJpYWxpemVkQ291bnRNdXRhdGlvbihhc3luYyAoZGIpID0+IHtcbiAgICAgIGNvbnN0IGpvYiA9IGF3YWl0IHRoaXMuX2dldEpvYlJvd0J5SWQoZGIsIGpvYklkKVxuXG4gICAgICBpZiAoIWpvYikgcmV0dXJuIGZhbHNlXG4gICAgICBpZiAoIXRoaXMuX3Nob3VsZEFjY2VwdFJlcG9ydCh7am9iLCBoYW5kb2ZmSWQsIHdvcmtlcklkLCBoYW5kZWRPZmZBdE1zfSkpIHJldHVybiBmYWxzZVxuXG4gICAgICBhd2FpdCB0aGlzLl9sb2NrQ29uY3VycmVuY3lSb3coZGIsIGpvYi5jb25jdXJyZW5jeUtleSlcbiAgICAgIGNvbnN0IGFmZmVjdGVkUm93cyA9IGF3YWl0IHRoaXMuX3VwZGF0ZUFmZmVjdGVkUm93cyhkYiwge1xuICAgICAgICB0YWJsZU5hbWU6IEpPQlNfVEFCTEUsXG4gICAgICAgIGRhdGE6IHtcbiAgICAgICAgICBzdGF0dXM6IFwiY29tcGxldGVkXCIsXG4gICAgICAgICAgY29tcGxldGVkX2F0X21zOiBEYXRlLm5vdygpXG4gICAgICAgIH0sXG4gICAgICAgIGNvbmRpdGlvbnM6IHRoaXMuX2FjdGl2ZUhhbmRvZmZDb25kaXRpb25zKGpvYilcbiAgICAgIH0pXG5cbiAgICAgIGlmIChhZmZlY3RlZFJvd3MgIT09IDEpIHJldHVybiBmYWxzZVxuICAgICAgYXdhaXQgdGhpcy5fcmVsZWFzZVNjaGVkdWxlT3duZXJzaGlwRm9ySm9iKGRiLCBqb2IpXG4gICAgICBhd2FpdCB0aGlzLl9yZWxlYXNlQ29uY3VycmVuY3koZGIsIGpvYi5jb25jdXJyZW5jeUtleSlcbiAgICAgIGF3YWl0IHRoaXMuX3JlY29yZFN0YXR1c1RyYW5zaXRpb24oZGIsIFwiaGFuZGVkX29mZlwiLCBcImNvbXBsZXRlZFwiKVxuICAgICAgcmV0dXJuIHRydWVcbiAgICB9KVxuICB9XG5cbiAgLyoqXG4gICAqIFJldHVybnMgYW4gYWN0aXZlIGhhbmRvZmYgdG8gdGhlIHF1ZXVlIGF0IGEgY2FsbGVyLXJlcXVlc3RlZCBmdXR1cmUgdGltZS5cbiAgICogVGhpcyBpcyBub3JtYWwgam9iIGNvbnRyb2wgZmxvdzogaXQgcHJlc2VydmVzIGZhaWx1cmUgYXR0ZW1wdHMgYW5kIG1ldGFkYXRhLlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIE9wdGlvbnMuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBhcmdzLmpvYklkIC0gSm9iIGlkLlxuICAgKiBAcGFyYW0ge251bWJlcn0gYXJncy5kZWxheU1zIC0gRGVsYXkgZnJvbSBwZXJzaXN0ZW5jZSB0aW1lIGluIG1pbGxpc2Vjb25kcy5cbiAgICogQHBhcmFtIHtzdHJpbmd9IFthcmdzLmhhbmRvZmZJZF0gLSBIYW5kb2ZmIGxlYXNlIGlkLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gW2FyZ3Mud29ya2VySWRdIC0gV29ya2VyIGlkLlxuICAgKiBAcGFyYW0ge251bWJlcn0gW2FyZ3MuaGFuZGVkT2ZmQXRNc10gLSBIYW5kZWQgb2ZmIHRpbWVzdGFtcC5cbiAgICogQHJldHVybnMge1Byb21pc2U8Ym9vbGVhbj59IC0gV2hldGhlciB0aGUgZmVuY2VkIHJlcG9ydCB3YXMgYWNjZXB0ZWQuXG4gICAqL1xuICBhc3luYyBtYXJrUmVzY2hlZHVsZWQoe2pvYklkLCBkZWxheU1zLCBoYW5kb2ZmSWQsIHdvcmtlcklkLCBoYW5kZWRPZmZBdE1zfSkge1xuICAgIGF3YWl0IHRoaXMuZW5zdXJlUmVhZHkoKVxuICAgIHRoaXMuX3ZhbGlkYXRlUmVzY2hlZHVsZURlbGF5TXMoZGVsYXlNcylcblxuICAgIHJldHVybiBhd2FpdCB0aGlzLl9zZXJpYWxpemVkQ291bnRNdXRhdGlvbihhc3luYyAoZGIpID0+IHtcbiAgICAgIGNvbnN0IGpvYiA9IGF3YWl0IHRoaXMuX2dldEpvYlJvd0J5SWQoZGIsIGpvYklkKVxuXG4gICAgICBpZiAoIWpvYikgcmV0dXJuIGZhbHNlXG4gICAgICBpZiAoIXRoaXMuX3Nob3VsZEFjY2VwdFJlcG9ydCh7am9iLCBoYW5kb2ZmSWQsIHdvcmtlcklkLCBoYW5kZWRPZmZBdE1zfSkpIHJldHVybiBmYWxzZVxuXG4gICAgICBhd2FpdCB0aGlzLl9sb2NrQ29uY3VycmVuY3lSb3coZGIsIGpvYi5jb25jdXJyZW5jeUtleSlcbiAgICAgIGNvbnN0IHF1ZXVlZENvbmN1cnJlbmN5ID0gYXdhaXQgdGhpcy5fcmVxdWV1ZWRKb2JDb25jdXJyZW5jeShkYiwgam9iKVxuICAgICAgY29uc3Qgc2NoZWR1bGVkQXRNcyA9IHRoaXMuX3Jlc2NoZWR1bGVkQXRNcyhkZWxheU1zKVxuICAgICAgY29uc3QgYWZmZWN0ZWRSb3dzID0gYXdhaXQgdGhpcy5fdXBkYXRlQWZmZWN0ZWRSb3dzKGRiLCB7XG4gICAgICAgIHRhYmxlTmFtZTogSk9CU19UQUJMRSxcbiAgICAgICAgZGF0YToge1xuICAgICAgICAgIGNvbmN1cnJlbmN5X2tleTogcXVldWVkQ29uY3VycmVuY3kuY29uY3VycmVuY3lLZXksXG4gICAgICAgICAgbWF4X2NvbmN1cnJlbmN5OiBxdWV1ZWRDb25jdXJyZW5jeS5tYXhDb25jdXJyZW5jeSxcbiAgICAgICAgICBzdGF0dXM6IFwicXVldWVkXCIsXG4gICAgICAgICAgc2NoZWR1bGVkX2F0X21zOiBzY2hlZHVsZWRBdE1zLFxuICAgICAgICAgIGhhbmRlZF9vZmZfYXRfbXM6IG51bGwsXG4gICAgICAgICAgaGFuZG9mZl9pZDogbnVsbCxcbiAgICAgICAgICB3b3JrZXJfaWQ6IG51bGxcbiAgICAgICAgfSxcbiAgICAgICAgY29uZGl0aW9uczogdGhpcy5fYWN0aXZlSGFuZG9mZkNvbmRpdGlvbnMoam9iKVxuICAgICAgfSlcblxuICAgICAgaWYgKGFmZmVjdGVkUm93cyAhPT0gMSkgcmV0dXJuIGZhbHNlXG4gICAgICBhd2FpdCB0aGlzLl9yZWxlYXNlQ29uY3VycmVuY3koZGIsIGpvYi5jb25jdXJyZW5jeUtleSlcbiAgICAgIGF3YWl0IHRoaXMuX3JlY29yZFN0YXR1c1RyYW5zaXRpb24oZGIsIFwiaGFuZGVkX29mZlwiLCBcInF1ZXVlZFwiKVxuICAgICAgcmV0dXJuIHRydWVcbiAgICB9KVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgbWFyayByZXR1cm5lZCB0byBxdWV1ZS5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBPcHRpb25zLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gYXJncy5qb2JJZCAtIEpvYiBpZC5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGFyZ3MuaGFuZG9mZklkIC0gSGFuZG9mZiBsZWFzZSBpZC5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgd2hlbiB1cGRhdGVkLlxuICAgKi9cbiAgYXN5bmMgbWFya1JldHVybmVkVG9RdWV1ZSh7am9iSWQsIGhhbmRvZmZJZH0pIHtcbiAgICBhd2FpdCB0aGlzLmVuc3VyZVJlYWR5KClcblxuICAgIGF3YWl0IHRoaXMuX3NlcmlhbGl6ZWRDb3VudE11dGF0aW9uKGFzeW5jIChkYikgPT4ge1xuICAgICAgY29uc3Qgam9iID0gYXdhaXQgdGhpcy5fZ2V0Sm9iUm93QnlJZChkYiwgam9iSWQpXG4gICAgICBpZiAoIWpvYiB8fCBqb2IuaGFuZG9mZklkICE9PSBoYW5kb2ZmSWQgfHwgam9iLnN0YXR1cyAhPT0gXCJoYW5kZWRfb2ZmXCIpIHJldHVyblxuICAgICAgYXdhaXQgdGhpcy5fbG9ja0NvbmN1cnJlbmN5Um93KGRiLCBqb2IuY29uY3VycmVuY3lLZXkpXG4gICAgICBjb25zdCBxdWV1ZWRDb25jdXJyZW5jeSA9IGF3YWl0IHRoaXMuX3JlcXVldWVkSm9iQ29uY3VycmVuY3koZGIsIGpvYilcbiAgICAgIGNvbnN0IGFmZmVjdGVkUm93cyA9IGF3YWl0IHRoaXMuX3VwZGF0ZUFmZmVjdGVkUm93cyhkYiwge1xuICAgICAgICB0YWJsZU5hbWU6IEpPQlNfVEFCTEUsXG4gICAgICAgIGRhdGE6IHtcbiAgICAgICAgICBjb25jdXJyZW5jeV9rZXk6IHF1ZXVlZENvbmN1cnJlbmN5LmNvbmN1cnJlbmN5S2V5LFxuICAgICAgICAgIG1heF9jb25jdXJyZW5jeTogcXVldWVkQ29uY3VycmVuY3kubWF4Q29uY3VycmVuY3ksXG4gICAgICAgICAgc3RhdHVzOiBcInF1ZXVlZFwiLFxuICAgICAgICAgIHNjaGVkdWxlZF9hdF9tczogRGF0ZS5ub3coKSxcbiAgICAgICAgICBoYW5kZWRfb2ZmX2F0X21zOiBudWxsLFxuICAgICAgICAgIGhhbmRvZmZfaWQ6IG51bGwsXG4gICAgICAgICAgd29ya2VyX2lkOiBudWxsXG4gICAgICAgIH0sXG4gICAgICAgIGNvbmRpdGlvbnM6IHtoYW5kb2ZmX2lkOiBoYW5kb2ZmSWQsIGlkOiBqb2JJZCwgc3RhdHVzOiBcImhhbmRlZF9vZmZcIn1cbiAgICAgIH0pXG4gICAgICBpZiAoYWZmZWN0ZWRSb3dzID09PSAxKSB7XG4gICAgICAgIGF3YWl0IHRoaXMuX3JlbGVhc2VDb25jdXJyZW5jeShkYiwgam9iLmNvbmN1cnJlbmN5S2V5KVxuICAgICAgICBhd2FpdCB0aGlzLl9yZWNvcmRTdGF0dXNUcmFuc2l0aW9uKGRiLCBcImhhbmRlZF9vZmZcIiwgXCJxdWV1ZWRcIilcbiAgICAgIH1cbiAgICB9KVxuICB9XG5cbiAgLyoqXG4gICAqIFJldHVybnMgdGhlIGFjdGl2ZSBgaGFuZGVkX29mZmAgam9icyAoam9iSWQgKyBoYW5kb2ZmSWQpIGhlbGQgdW5kZXIgYSB3b3JrZXJcbiAgICogaWQuIFVzZWQgb24gd29ya2VyIHJlY29ubmVjdDogYWZ0ZXIgYSBtYWluIHJlc3RhcnQgYSB3b3JrZXIgcmVjb25uZWN0cyB3aXRoXG4gICAqIGl0cyBzdGFibGUgaWQsIGFuZCB0aGUgZnJlc2ggbWFpbiBhZG9wdHMgdGhlc2UgbGVhc2VzIHNvIHRoZXkgYXJlIHRyYWNrZWQg4oCUXG4gICAqIGFuZCByZWxlYXNlZCBpZiB0aGUgcmVjb25uZWN0ZWQgd29ya2VyIGxhdGVyIGRpc2Nvbm5lY3RzIOKAlCBpbnN0ZWFkIG9mXG4gICAqIHNpdHRpbmcgc3R1Y2sgdW50aWwgdGhlIGFnZS1iYXNlZCBvcnBoYW4gc3dlZXAuIFRoaXMgbmV2ZXIgcmVjbGFpbXMsIHNvIGFcbiAgICogZ3JhY2VmdWxseS1kcmFpbmluZyB3b3JrZXIgdGhhdCBrZWVwcyBydW5uaW5nIGl0cyBpbi1mbGlnaHQgam9icyBpcyBsZWZ0XG4gICAqIHVudG91Y2hlZC4gUm93cyB3aXRoIGEgbnVsbCBoYW5kb2ZmIGlkIChsZWdhY3kpIGFyZSBza2lwcGVkOyB0aGUgb3JwaGFuXG4gICAqIHN3ZWVwIHJlY2xhaW1zIHRob3NlIHZpYSBpdHMgYGhhbmRlZF9vZmZfYXRfbXNgIGZlbmNlLlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIE9wdGlvbnMuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBhcmdzLndvcmtlcklkIC0gV29ya2VyIGlkLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxBcnJheTx7am9iSWQ6IHN0cmluZywgaGFuZG9mZklkOiBzdHJpbmd9Pj59IC0gQWN0aXZlIGhhbmRvZmZzLlxuICAgKi9cbiAgYXN5bmMgaGFuZGVkT2ZmSm9ic0Zvcldvcmtlcih7d29ya2VySWR9KSB7XG4gICAgYXdhaXQgdGhpcy5lbnN1cmVSZWFkeSgpXG5cbiAgICBjb25zdCByb3dzID0gYXdhaXQgdGhpcy5fd2l0aERiKGFzeW5jIChkYikgPT5cbiAgICAgIGF3YWl0IGRiLm5ld1F1ZXJ5KCkuZnJvbShKT0JTX1RBQkxFKS53aGVyZSh7c3RhdHVzOiBcImhhbmRlZF9vZmZcIiwgd29ya2VyX2lkOiB3b3JrZXJJZH0pLnJlc3VsdHMoKVxuICAgIClcblxuICAgIC8qKiBAdHlwZSB7QXJyYXk8e2pvYklkOiBzdHJpbmcsIGhhbmRvZmZJZDogc3RyaW5nfT59ICovXG4gICAgY29uc3QgaGFuZG9mZnMgPSBbXVxuXG4gICAgZm9yIChjb25zdCByb3cgb2Ygcm93cykge1xuICAgICAgY29uc3Qgam9iID0gdGhpcy5fbm9ybWFsaXplSm9iUm93KHJvdylcblxuICAgICAgaWYgKGpvYi5oYW5kb2ZmSWQpIGhhbmRvZmZzLnB1c2goe2pvYklkOiBqb2IuaWQsIGhhbmRvZmZJZDogam9iLmhhbmRvZmZJZH0pXG4gICAgfVxuXG4gICAgcmV0dXJuIGhhbmRvZmZzXG4gIH1cblxuICAvKipcbiAgICogU25hcHNob3RzIGV4YWN0LCBsZWFzZS1hd2FyZSBhY3RpdmUgaGFuZG9mZnMgYmVmb3JlIGEgbmV3IG1haW4gZ2VuZXJhdGlvblxuICAgKiBzdGFydHMgYWNjZXB0aW5nIHdvcmtlciByZWNvbm5lY3RzLiBMZWdhY3kgcm93cyB3aXRob3V0IGEgY29tcGxldGUgd29ya2VyLFxuICAgKiBsZWFzZSwgYW5kIHRpbWVzdGFtcCBpZGVudGl0eSBzdGF5IG93bmVkIGJ5IHRoZSBhZ2UtYmFzZWQgb3JwaGFuIHN3ZWVwLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxpbXBvcnQoXCIuL3R5cGVzLmpzXCIpLkJhY2tncm91bmRKb2JIYW5kb2ZmU25hcHNob3RbXT59IC0gRXhhY3Qgc3RhcnR1cCBoYW5kb2Zmcy5cbiAgICovXG4gIGFzeW5jIHNuYXBzaG90SGFuZGVkT2ZmSm9icygpIHtcbiAgICBhd2FpdCB0aGlzLmVuc3VyZVJlYWR5KClcblxuICAgIGNvbnN0IHJvd3MgPSBhd2FpdCB0aGlzLl93aXRoRGIoYXN5bmMgKGRiKSA9PiBhd2FpdCBkYlxuICAgICAgLm5ld1F1ZXJ5KClcbiAgICAgIC5mcm9tKEpPQlNfVEFCTEUpXG4gICAgICAud2hlcmUoe3N0YXR1czogXCJoYW5kZWRfb2ZmXCJ9KVxuICAgICAgLm9yZGVyKFwiY3JlYXRlZF9hdF9tcyBBU0NcIilcbiAgICAgIC5vcmRlcihcImlkIEFTQ1wiKVxuICAgICAgLnJlc3VsdHMoKSlcbiAgICAvKiogQHR5cGUge2ltcG9ydChcIi4vdHlwZXMuanNcIikuQmFja2dyb3VuZEpvYkhhbmRvZmZTbmFwc2hvdFtdfSAqL1xuICAgIGNvbnN0IGhhbmRvZmZzID0gW11cblxuICAgIGZvciAoY29uc3Qgcm93IG9mIHJvd3MpIHtcbiAgICAgIGNvbnN0IGpvYiA9IHRoaXMuX25vcm1hbGl6ZUpvYlJvdyhyb3cpXG5cbiAgICAgIGlmICgham9iLmhhbmRvZmZJZCB8fCAham9iLndvcmtlcklkIHx8IHR5cGVvZiBqb2IuaGFuZGVkT2ZmQXRNcyAhPT0gXCJudW1iZXJcIikgY29udGludWVcblxuICAgICAgaGFuZG9mZnMucHVzaCh7XG4gICAgICAgIGhhbmRlZE9mZkF0TXM6IGpvYi5oYW5kZWRPZmZBdE1zLFxuICAgICAgICBoYW5kb2ZmSWQ6IGpvYi5oYW5kb2ZmSWQsXG4gICAgICAgIGpvYklkOiBqb2IuaWQsXG4gICAgICAgIHdvcmtlcklkOiBqb2Iud29ya2VySWRcbiAgICAgIH0pXG4gICAgfVxuXG4gICAgcmV0dXJuIGhhbmRvZmZzXG4gIH1cblxuICAvKipcbiAgICogUmVjbGFpbXMgb25seSB1bmNoYW5nZWQgZXhhY3QgaGFuZG9mZnMgc2VsZWN0ZWQgYnkgYSBtYWluLWdlbmVyYXRpb24gc3RhcnR1cFxuICAgKiBzbmFwc2hvdC4gVGhlIG9yZGluYXJ5IG9ycGhhbiBmYWlsdXJlIHBhdGggb3ducyByZXRyaWVzLCB0ZXJtaW5hbCBzdGF0dXMsXG4gICAqIGNvdW50IHRyYW5zaXRpb25zLCBzY2hlZHVsZSBvd25lcnNoaXAsIGFuZCBjb25jdXJyZW5jeSByZWxlYXNlLlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIE9wdGlvbnMuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi90eXBlcy5qc1wiKS5CYWNrZ3JvdW5kSm9iSGFuZG9mZlNuYXBzaG90W119IGFyZ3MuaGFuZG9mZnMgLSBFeGFjdCBzdGFydHVwIHNuYXBzaG90cy5cbiAgICogQHBhcmFtIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gYXJncy5lcnJvciAtIE9ycGhhbiByZWFzb24uXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPGltcG9ydChcIi4vdHlwZXMuanNcIikuQmFja2dyb3VuZEpvYlJvd1tdPn0gLSBBY2NlcHRlZCB0cmFuc2l0aW9ucy5cbiAgICovXG4gIGFzeW5jIG1hcmtPcnBoYW5lZEhhbmRvZmZzKHtoYW5kb2ZmcywgZXJyb3J9KSB7XG4gICAgYXdhaXQgdGhpcy5lbnN1cmVSZWFkeSgpXG5cbiAgICByZXR1cm4gYXdhaXQgdGhpcy5fc2VyaWFsaXplZENvdW50TXV0YXRpb24oYXN5bmMgKGRiKSA9PiB7XG4gICAgICAvKiogQHR5cGUge0JhY2tncm91bmRKb2JPcnBoYW5TZWxlY3Rpb25bXX0gKi9cbiAgICAgIGNvbnN0IHNlbGVjdGlvbnMgPSBbXVxuXG4gICAgICBmb3IgKGNvbnN0IGhhbmRvZmYgb2YgaGFuZG9mZnMpIHtcbiAgICAgICAgY29uc3Qgam9iID0gYXdhaXQgdGhpcy5fZ2V0Sm9iUm93QnlJZChkYiwgaGFuZG9mZi5qb2JJZClcblxuICAgICAgICBpZiAoIWpvYiB8fCBqb2Iuc3RhdHVzICE9PSBcImhhbmRlZF9vZmZcIikgY29udGludWVcbiAgICAgICAgaWYgKGpvYi5oYW5kb2ZmSWQgIT09IGhhbmRvZmYuaGFuZG9mZklkKSBjb250aW51ZVxuICAgICAgICBpZiAoam9iLndvcmtlcklkICE9PSBoYW5kb2ZmLndvcmtlcklkKSBjb250aW51ZVxuICAgICAgICBpZiAoam9iLmhhbmRlZE9mZkF0TXMgIT09IGhhbmRvZmYuaGFuZGVkT2ZmQXRNcykgY29udGludWVcblxuICAgICAgICBzZWxlY3Rpb25zLnB1c2goe1xuICAgICAgICAgIGNvbmRpdGlvbnM6IHtcbiAgICAgICAgICAgIGhhbmRlZF9vZmZfYXRfbXM6IGhhbmRvZmYuaGFuZGVkT2ZmQXRNcyxcbiAgICAgICAgICAgIGhhbmRvZmZfaWQ6IGhhbmRvZmYuaGFuZG9mZklkLFxuICAgICAgICAgICAgaWQ6IGhhbmRvZmYuam9iSWQsXG4gICAgICAgICAgICBzdGF0dXM6IFwiaGFuZGVkX29mZlwiLFxuICAgICAgICAgICAgd29ya2VyX2lkOiBoYW5kb2ZmLndvcmtlcklkXG4gICAgICAgICAgfSxcbiAgICAgICAgICBqb2JcbiAgICAgICAgfSlcbiAgICAgIH1cblxuICAgICAgcmV0dXJuIGF3YWl0IHRoaXMuX21hcmtPcnBoYW5TZWxlY3Rpb25zKHtkYiwgZXJyb3IsIHNlbGVjdGlvbnN9KVxuICAgIH0pXG4gIH1cblxuICAvKipcbiAgICogUnVucyBtYXJrIGZhaWxlZC5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBPcHRpb25zLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gYXJncy5qb2JJZCAtIEpvYiBpZC5cbiAgICogQHBhcmFtIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gYXJncy5lcnJvciAtIEVycm9yLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gW2FyZ3MuaGFuZG9mZklkXSAtIEhhbmRvZmYgbGVhc2UgaWQuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBbYXJncy53b3JrZXJJZF0gLSBXb3JrZXIgaWQuXG4gICAqIEBwYXJhbSB7bnVtYmVyfSBbYXJncy5oYW5kZWRPZmZBdE1zXSAtIEhhbmRlZCBvZmYgdGltZXN0YW1wLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxpbXBvcnQoXCIuL3R5cGVzLmpzXCIpLkJhY2tncm91bmRKb2JSb3cgfCBudWxsPn0gLSBVcGRhdGVkIGpvYiByb3cgd2hlbiB0aGUgcmVwb3J0IHdhcyBhY2NlcHRlZC5cbiAgICovXG4gIGFzeW5jIG1hcmtGYWlsZWQoe2pvYklkLCBlcnJvciwgaGFuZG9mZklkLCB3b3JrZXJJZCwgaGFuZGVkT2ZmQXRNc30pIHtcbiAgICBhd2FpdCB0aGlzLmVuc3VyZVJlYWR5KClcblxuICAgIHJldHVybiBhd2FpdCB0aGlzLl9zZXJpYWxpemVkQ291bnRNdXRhdGlvbihhc3luYyAoZGIpID0+IHtcbiAgICAgIGNvbnN0IGpvYiA9IGF3YWl0IHRoaXMuX2dldEpvYlJvd0J5SWQoZGIsIGpvYklkKVxuXG4gICAgICBpZiAoIWpvYikgcmV0dXJuIG51bGxcbiAgICAgIGlmICghdGhpcy5fc2hvdWxkQWNjZXB0UmVwb3J0KHtqb2IsIGhhbmRvZmZJZCwgd29ya2VySWQsIGhhbmRlZE9mZkF0TXN9KSkgcmV0dXJuIG51bGxcblxuICAgICAgY29uc3QgdXBkYXRlZEpvYiA9IGF3YWl0IHRoaXMuX2FwcGx5RmFpbHVyZSh7ZGIsIGpvYiwgZXJyb3IsIG1hcmtPcnBoYW5lZDogZmFsc2V9KVxuXG4gICAgICBpZiAodXBkYXRlZEpvYikgYXdhaXQgdGhpcy5fcmVjb3JkU3RhdHVzVHJhbnNpdGlvbihkYiwgam9iLnN0YXR1cywgdXBkYXRlZEpvYi5zdGF0dXMpXG4gICAgICByZXR1cm4gdXBkYXRlZEpvYlxuICAgIH0pXG4gIH1cblxuICAvKipcbiAgICogUnVucyBtYXJrIG9ycGhhbmVkIGpvYnMuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBbYXJnc10gLSBPcHRpb25zLlxuICAgKiBAcGFyYW0ge251bWJlcn0gW2FyZ3Mub3JwaGFuZWRBZnRlck1zXSAtIE1hcmsgam9icyBvcnBoYW5lZCBhZnRlciB0aGlzIGR1cmF0aW9uLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxpbXBvcnQoXCIuL3R5cGVzLmpzXCIpLkJhY2tncm91bmRKb2JSb3dbXT59IC0gVGhlIGpvYnMgdGhpcyBzd2VlcCBtYXJrZWQgb3JwaGFuZWQuXG4gICAqL1xuICBhc3luYyBtYXJrT3JwaGFuZWRKb2JzKHtvcnBoYW5lZEFmdGVyTXMgPSBPUlBIQU5FRF9BRlRFUl9NU30gPSB7fSkge1xuICAgIGF3YWl0IHRoaXMuZW5zdXJlUmVhZHkoKVxuXG4gICAgcmV0dXJuIGF3YWl0IHRoaXMuX3NlcmlhbGl6ZWRDb3VudE11dGF0aW9uKGFzeW5jIChkYikgPT4ge1xuICAgICAgY29uc3QgY3V0b2ZmID0gRGF0ZS5ub3coKSAtIG9ycGhhbmVkQWZ0ZXJNc1xuICAgICAgY29uc3QgcXVlcnkgPSBkYlxuICAgICAgICAubmV3UXVlcnkoKVxuICAgICAgICAuZnJvbShKT0JTX1RBQkxFKVxuICAgICAgICAud2hlcmUoe3N0YXR1czogXCJoYW5kZWRfb2ZmXCJ9KVxuICAgICAgICAud2hlcmUoYGhhbmRlZF9vZmZfYXRfbXMgPD0gJHtkYi5xdW90ZShjdXRvZmYpfWApXG5cbiAgICAgIGNvbnN0IHJvd3MgPSBhd2FpdCBxdWVyeS5yZXN1bHRzKClcblxuICAgICAgLyoqIEB0eXBlIHtCYWNrZ3JvdW5kSm9iT3JwaGFuU2VsZWN0aW9uW119ICovXG4gICAgICBjb25zdCBzZWxlY3Rpb25zID0gW11cblxuICAgICAgZm9yIChjb25zdCByb3cgb2Ygcm93cykge1xuICAgICAgICBjb25zdCBqb2IgPSB0aGlzLl9ub3JtYWxpemVKb2JSb3cocm93KVxuXG4gICAgICAgIC8vIEZlbmNlIHRoZSByZWNsYWltIG9uIHRoZSBleGFjdCBoYW5kb2ZmIHRoaXMgc3dlZXAgc2VsZWN0ZWQsIHVzaW5nIGl0c1xuICAgICAgICAvLyBgaGFuZGVkX29mZl9hdF9tc2AgcmF0aGVyIHRoYW4gaXRzIGBoYW5kb2ZmX2lkYC4gVHdvIHJlYXNvbnM6XG4gICAgICAgIC8vICAgMS4gTnVsbC1zYWZlLiBTb21lIHJvd3MgaGF2ZSBhIG51bGwgYGhhbmRvZmZfaWRgIChoYW5kZWQgb2ZmIGJ5IGFuXG4gICAgICAgIC8vICAgICAgb2xkZXIgdmVsb2Npb3VzIGJlZm9yZSBoYW5kb2ZmLWlkIGZlbmNpbmcpLiBge2hhbmRvZmZfaWQ6IG51bGx9YFxuICAgICAgICAvLyAgICAgIHJlbmRlcnMgYXMgYGhhbmRvZmZfaWQgPSBOVUxMYCwgd2hpY2ggbWF0Y2hlcyBub3RoaW5nLCBzbyB0aG9zZVxuICAgICAgICAvLyAgICAgIHJvd3Mgd291bGQgYmUgc3RyYW5kZWQgaW4gYGhhbmRlZF9vZmZgIGZvcmV2ZXIuXG4gICAgICAgIC8vICAgMi4gUmFjZS1zYWZlLiBJZiB0aGUgcm93IGlzIHJldHVybmVkIHRvIHRoZSBxdWV1ZSBhbmQgcmUtaGFuZGVkLW9mZlxuICAgICAgICAvLyAgICAgIGJldHdlZW4gdGhlIFNFTEVDVCBhYm92ZSBhbmQgdGhpcyB1cGRhdGUsIGl0IGdldHMgYSBmcmVzaFxuICAgICAgICAvLyAgICAgIGBoYW5kZWRfb2ZmX2F0X21zYCAoYWx3YXlzIFwibm93XCIpLCBzbyB0aGlzIHN0YWxlIGN1dG9mZi1lcmFcbiAgICAgICAgLy8gICAgICB0aW1lc3RhbXAgbm8gbG9uZ2VyIG1hdGNoZXMgYW5kIHdlIHdvbid0IGZhaWwvb3JwaGFuIOKAlCBvclxuICAgICAgICAvLyAgICAgIHdyb25nbHkgcmVsZWFzZSB0aGUgY29uY3VycmVuY3kgcmVzZXJ2YXRpb24gb2Yg4oCUIHRoYXQgbmV3IGxlYXNlLlxuICAgICAgICAvLyBgaGFuZGVkX29mZl9hdF9tc2AgaXMgYWx3YXlzIHNldCBvbiBhIGhhbmRlZC1vZmYgcm93IChhbmQgdGhlIFNFTEVDVFxuICAgICAgICAvLyByZXF1aXJlZCBpdCBgPD0gY3V0b2ZmYCksIHNvIGl0IGlzIGEgcmVsaWFibGUgbnVsbC1zYWZlIGxlYXNlIHBpbi5cbiAgICAgICAgc2VsZWN0aW9ucy5wdXNoKHtcbiAgICAgICAgICBjb25kaXRpb25zOiB7aWQ6IGpvYi5pZCwgc3RhdHVzOiBcImhhbmRlZF9vZmZcIiwgaGFuZGVkX29mZl9hdF9tczogam9iLmhhbmRlZE9mZkF0TXN9LFxuICAgICAgICAgIGpvYlxuICAgICAgICB9KVxuICAgICAgfVxuXG4gICAgICByZXR1cm4gYXdhaXQgdGhpcy5fbWFya09ycGhhblNlbGVjdGlvbnMoe1xuICAgICAgICBkYixcbiAgICAgICAgZXJyb3I6IFwiSm9iIG9ycGhhbmVkIGFmdGVyIHRpbWVvdXRcIixcbiAgICAgICAgc2VsZWN0aW9uc1xuICAgICAgfSlcbiAgICB9KVxuICB9XG5cbiAgLyoqXG4gICAqIEFwcGxpZXMgdGhlIGNvbW1vbiBmZW5jZWQgb3JwaGFuIHRyYW5zaXRpb24gYW5kIHJlY29yZHMgb25lIGFnZ3JlZ2F0ZSBjb3VudFxuICAgKiBkZWx0YSBmb3IgdGhlIGFjY2VwdGVkIHJvd3MuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gT3B0aW9ucy5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9kYXRhYmFzZS9kcml2ZXJzL2Jhc2UuanNcIikuZGVmYXVsdH0gYXJncy5kYiAtIFRyYW5zYWN0aW9uIGNvbm5lY3Rpb24uXG4gICAqIEBwYXJhbSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59IGFyZ3MuZXJyb3IgLSBPcnBoYW4gcmVhc29uLlxuICAgKiBAcGFyYW0ge0JhY2tncm91bmRKb2JPcnBoYW5TZWxlY3Rpb25bXX0gYXJncy5zZWxlY3Rpb25zIC0gU2VsZWN0ZWQgaGFuZG9mZnMgYW5kIGV4YWN0IGZlbmNlcy5cbiAgICogQHJldHVybnMge1Byb21pc2U8aW1wb3J0KFwiLi90eXBlcy5qc1wiKS5CYWNrZ3JvdW5kSm9iUm93W10+fSAtIEFjY2VwdGVkIHRyYW5zaXRpb25zLlxuICAgKi9cbiAgYXN5bmMgX21hcmtPcnBoYW5TZWxlY3Rpb25zKHtkYiwgZXJyb3IsIHNlbGVjdGlvbnN9KSB7XG4gICAgLyoqIEB0eXBlIHtpbXBvcnQoXCIuL3R5cGVzLmpzXCIpLkJhY2tncm91bmRKb2JSb3dbXX0gKi9cbiAgICBjb25zdCBvcnBoYW5lZEpvYnMgPSBbXVxuXG4gICAgZm9yIChjb25zdCB7Y29uZGl0aW9ucywgam9ifSBvZiBzZWxlY3Rpb25zKSB7XG4gICAgICBjb25zdCBvcnBoYW5lZEpvYiA9IGF3YWl0IHRoaXMuX2FwcGx5RmFpbHVyZSh7XG4gICAgICAgIGNvbmRpdGlvbnMsXG4gICAgICAgIGRiLFxuICAgICAgICBlcnJvcixcbiAgICAgICAgam9iLFxuICAgICAgICBtYXJrT3JwaGFuZWQ6IHRydWVcbiAgICAgIH0pXG5cbiAgICAgIGlmIChvcnBoYW5lZEpvYikgb3JwaGFuZWRKb2JzLnB1c2gob3JwaGFuZWRKb2IpXG4gICAgfVxuXG4gICAgY29uc3Qgc3RhdHVzQ291bnRzID0gdGhpcy5fc3RhdHVzQ291bnRzKG9ycGhhbmVkSm9icylcbiAgICBjb25zdCBkZWx0YXMgPSB0aGlzLl9lbXB0eUNvdW50QnVja2V0cygpXG5cbiAgICBmb3IgKGNvbnN0IFtzdGF0dXMsIGNvdW50XSBvZiBPYmplY3QuZW50cmllcyhzdGF0dXNDb3VudHMpKSB7XG4gICAgICBkZWx0YXMuaGFuZGVkX29mZiAtPSBjb3VudFxuICAgICAgZGVsdGFzW3N0YXR1c10gKz0gY291bnRcbiAgICB9XG4gICAgYXdhaXQgdGhpcy5fcmVjb3JkQ291bnREZWx0YShkYiwgZGVsdGFzKVxuXG4gICAgcmV0dXJuIG9ycGhhbmVkSm9ic1xuICB9XG5cbiAgLyoqXG4gICAqIERlbGV0ZXMgdGVybWluYWwgam9iIHJvd3MgcGFzdCB0aGVpciByZXRlbnRpb24gd2luZG93IHNvIHRoZSBqb2JzIHRhYmxlXG4gICAqIGRvZXMgbm90IGdyb3cgdW5ib3VuZGVkIChjb21wbGV0ZWQgcm93cyBpbiBwYXJ0aWN1bGFyIGFjY3VtdWxhdGUgZm9yZXZlclxuICAgKiBvdGhlcndpc2UpLiBCYXRjaGVkIGJ5IGlkIOKAlCBTRUxFQ1QgYSBwYWdlIG9mIGlkcywgdGhlblxuICAgKiBgREVMRVRFIC4uLiBXSEVSRSBpZCBJTiAoLi4uKWAg4oCUIHJhdGhlciB0aGFuIGBERUxFVEUgLi4uIExJTUlUYCwgd2hpY2ggbm90XG4gICAqIGV2ZXJ5IGRyaXZlciBzdXBwb3J0czsgZWFjaCBiYXRjaCBydW5zIG9uIGl0cyBvd24gY29ubmVjdGlvbiBzbyB0aGUgc3dlZXBcbiAgICogeWllbGRzIGJldHdlZW4gYmF0Y2hlcyBpbnN0ZWFkIG9mIGhvbGRpbmcgb25lIGxvbmcgdHJhbnNhY3Rpb24uXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBbYXJnc10gLSBPcHRpb25zLlxuICAgKiBAcGFyYW0ge251bWJlciB8IG51bGx9IFthcmdzLmNvbXBsZXRlZFR0bE1zXSAtIERlbGV0ZSBgY29tcGxldGVkYCBqb2JzIHdob3NlIGBjb21wbGV0ZWRfYXRfbXNgIGlzIG9sZGVyIHRoYW4gdGhpcyBtYW55IG1zLiBGYWxzeSBvciBgPD0gMGAgZGlzYWJsZXMgY29tcGxldGVkIHBydW5pbmcuXG4gICAqIEBwYXJhbSB7bnVtYmVyIHwgbnVsbH0gW2FyZ3MuZmFpbGVkVHRsTXNdIC0gRGVsZXRlIHRlcm1pbmFsIGBmYWlsZWRgL2BvcnBoYW5lZGAgam9icyBvbGRlciB0aGFuIHRoaXMgbWFueSBtcyAoYnkgYGZhaWxlZF9hdF9tc2AvYG9ycGhhbmVkX2F0X21zYCkuIEZhbHN5IG9yIGA8PSAwYCBkaXNhYmxlcy5cbiAgICogQHBhcmFtIHtudW1iZXJ9IFthcmdzLmJhdGNoU2l6ZV0gLSBNYXggcm93cyBkZWxldGVkIHBlciBiYXRjaC4gRGVmYXVsdCBgMTAwMGAuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPG51bWJlcj59IC0gVG90YWwgcm93cyBkZWxldGVkLlxuICAgKi9cbiAgYXN5bmMgcHJ1bmVUZXJtaW5hbEpvYnMoe2NvbXBsZXRlZFR0bE1zID0gbnVsbCwgZmFpbGVkVHRsTXMgPSBudWxsLCBiYXRjaFNpemUgPSAxMDAwfSA9IHt9KSB7XG4gICAgYXdhaXQgdGhpcy5lbnN1cmVSZWFkeSgpXG5cbiAgICBjb25zdCBub3cgPSBEYXRlLm5vdygpXG4gICAgY29uc3Qgc2l6ZSA9IGJhdGNoU2l6ZSA+IDAgPyBiYXRjaFNpemUgOiAxMDAwXG4gICAgbGV0IGRlbGV0ZWQgPSAwXG5cbiAgICBpZiAoY29tcGxldGVkVHRsTXMgJiYgY29tcGxldGVkVHRsTXMgPiAwKSB7XG4gICAgICBkZWxldGVkICs9IGF3YWl0IHRoaXMuX3BydW5lU3RhdHVzQmF0Y2hlcyh7c3RhdHVzOiBcImNvbXBsZXRlZFwiLCBjb2x1bW46IFwiY29tcGxldGVkX2F0X21zXCIsIGN1dG9mZjogbm93IC0gY29tcGxldGVkVHRsTXMsIGJhdGNoU2l6ZTogc2l6ZX0pXG4gICAgfVxuXG4gICAgaWYgKGZhaWxlZFR0bE1zICYmIGZhaWxlZFR0bE1zID4gMCkge1xuICAgICAgZGVsZXRlZCArPSBhd2FpdCB0aGlzLl9wcnVuZVN0YXR1c0JhdGNoZXMoe3N0YXR1czogXCJmYWlsZWRcIiwgY29sdW1uOiBcImZhaWxlZF9hdF9tc1wiLCBjdXRvZmY6IG5vdyAtIGZhaWxlZFR0bE1zLCBiYXRjaFNpemU6IHNpemV9KVxuICAgICAgZGVsZXRlZCArPSBhd2FpdCB0aGlzLl9wcnVuZVN0YXR1c0JhdGNoZXMoe3N0YXR1czogXCJvcnBoYW5lZFwiLCBjb2x1bW46IFwib3JwaGFuZWRfYXRfbXNcIiwgY3V0b2ZmOiBub3cgLSBmYWlsZWRUdGxNcywgYmF0Y2hTaXplOiBzaXplfSlcbiAgICB9XG5cbiAgICByZXR1cm4gZGVsZXRlZFxuICB9XG5cbiAgLyoqXG4gICAqIERlbGV0ZXMgcm93cyBvZiBvbmUgdGVybWluYWwgc3RhdHVzIG9sZGVyIHRoYW4gYSBjdXRvZmYsIGJhdGNoIGJ5IGJhdGNoLFxuICAgKiB1bnRpbCBhIHBhZ2UgcmV0dXJucyBmZXdlciB0aGFuIGBiYXRjaFNpemVgIHJvd3MuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gT3B0aW9ucy5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGFyZ3Muc3RhdHVzIC0gVGVybWluYWwgc3RhdHVzIHRvIHBydW5lLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gYXJncy5jb2x1bW4gLSBUaW1lc3RhbXAgY29sdW1uIGNvbXBhcmVkIGFnYWluc3QgdGhlIGN1dG9mZi5cbiAgICogQHBhcmFtIHtudW1iZXJ9IGFyZ3MuY3V0b2ZmIC0gRGVsZXRlIHJvd3Mgd2hvc2UgY29sdW1uIHZhbHVlIGlzIGA8PSBjdXRvZmZgLlxuICAgKiBAcGFyYW0ge251bWJlcn0gYXJncy5iYXRjaFNpemUgLSBNYXggcm93cyBwZXIgYmF0Y2guXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPG51bWJlcj59IC0gUm93cyBkZWxldGVkIGZvciB0aGlzIHN0YXR1cy5cbiAgICovXG4gIGFzeW5jIF9wcnVuZVN0YXR1c0JhdGNoZXMoe3N0YXR1cywgY29sdW1uLCBjdXRvZmYsIGJhdGNoU2l6ZX0pIHtcbiAgICBsZXQgZGVsZXRlZCA9IDBcblxuICAgIGZvciAoOzspIHtcbiAgICAgIGNvbnN0IHJlbW92ZWQgPSBhd2FpdCB0aGlzLl9zZXJpYWxpemVkQ291bnRNdXRhdGlvbihhc3luYyAoZGIpID0+IHtcbiAgICAgICAgY29uc3Qgcm93cyA9IGF3YWl0IGRiXG4gICAgICAgICAgLm5ld1F1ZXJ5KClcbiAgICAgICAgICAuZnJvbShKT0JTX1RBQkxFKVxuICAgICAgICAgIC5zZWxlY3QoXCJpZFwiKVxuICAgICAgICAgIC53aGVyZSh7c3RhdHVzfSlcbiAgICAgICAgICAud2hlcmUoYCR7ZGIucXVvdGVDb2x1bW4oY29sdW1uKX0gPD0gJHtkYi5xdW90ZShjdXRvZmYpfWApXG4gICAgICAgICAgLmxpbWl0KGJhdGNoU2l6ZSlcbiAgICAgICAgICAucmVzdWx0cygpXG5cbiAgICAgICAgaWYgKHJvd3MubGVuZ3RoID09PSAwKSByZXR1cm4gMFxuXG4gICAgICAgIGNvbnN0IGlkcyA9IHJvd3MubWFwKCgvKiogQHR5cGUge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gKi8gcm93KSA9PiBkYi5xdW90ZShTdHJpbmcocm93LmlkKSkpLmpvaW4oXCIsIFwiKVxuXG4gICAgICAgIGNvbnN0IHJlbW92ZWQgPSBhd2FpdCBkYi5hZmZlY3RlZFJvd3MoXG4gICAgICAgICAgYERFTEVURSBGUk9NICR7ZGIucXVvdGVUYWJsZShKT0JTX1RBQkxFKX0gV0hFUkUgJHtkYi5xdW90ZUNvbHVtbihcImlkXCIpfSBJTiAoJHtpZHN9KWBcbiAgICAgICAgKVxuXG4gICAgICAgIGF3YWl0IHRoaXMuX3JlY29yZENvdW50RGVsdGEoZGIsIHthbGw6IC1yZW1vdmVkLCBbc3RhdHVzXTogLXJlbW92ZWR9KVxuXG4gICAgICAgIHJldHVybiByZW1vdmVkXG4gICAgICB9KVxuXG4gICAgICBkZWxldGVkICs9IHJlbW92ZWRcbiAgICAgIGlmIChyZW1vdmVkIDwgYmF0Y2hTaXplKSBicmVha1xuICAgIH1cblxuICAgIHJldHVybiBkZWxldGVkXG4gIH1cblxuICAvKipcbiAgICogUnVucyBjbGVhciBhbGwuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIHdoZW4gY2xlYXJlZC5cbiAgICovXG4gIGFzeW5jIGNsZWFyQWxsKCkge1xuICAgIGF3YWl0IHRoaXMuZW5zdXJlUmVhZHkoKVxuXG4gICAgYXdhaXQgdGhpcy5fc2VyaWFsaXplZENvdW50TXV0YXRpb24oYXN5bmMgKGRiKSA9PiB7XG4gICAgICBjb25zdCBzbmFwc2hvdCA9IGF3YWl0IHRoaXMuX2NvdW50U25hcHNob3RPbkxvY2tlZENvbm5lY3Rpb24oZGIpXG4gICAgICBpZiAoYXdhaXQgZGIudGFibGVFeGlzdHMoTUFJTF9ERUxJVkVSWV9PUEVSQVRJT05TX1RBQkxFKSkgYXdhaXQgZGIucXVlcnkoYERFTEVURSBGUk9NICR7ZGIucXVvdGVUYWJsZShNQUlMX0RFTElWRVJZX09QRVJBVElPTlNfVEFCTEUpfWApXG4gICAgICBpZiAoYXdhaXQgZGIudGFibGVFeGlzdHMoSURFTVBPVEVOQ1lfS0VZU19UQUJMRSkpIGF3YWl0IGRiLnF1ZXJ5KGBERUxFVEUgRlJPTSAke2RiLnF1b3RlVGFibGUoSURFTVBPVEVOQ1lfS0VZU19UQUJMRSl9YClcbiAgICAgIGlmIChhd2FpdCBkYi50YWJsZUV4aXN0cyhTQ0hFRFVMRV9LRVlTX1RBQkxFKSkgYXdhaXQgZGIucXVlcnkoYERFTEVURSBGUk9NICR7ZGIucXVvdGVUYWJsZShTQ0hFRFVMRV9LRVlTX1RBQkxFKX1gKVxuICAgICAgYXdhaXQgZGIucXVlcnkoYERFTEVURSBGUk9NICR7ZGIucXVvdGVUYWJsZShKT0JTX1RBQkxFKX1gKVxuICAgICAgaWYgKGF3YWl0IGRiLnRhYmxlRXhpc3RzKENPTkNVUlJFTkNZX1RBQkxFKSkgYXdhaXQgZGIucXVlcnkoYERFTEVURSBGUk9NICR7ZGIucXVvdGVUYWJsZShDT05DVVJSRU5DWV9UQUJMRSl9YClcbiAgICAgIGNvbnN0IGRlbHRhcyA9IE9iamVjdC5mcm9tRW50cmllcyhPYmplY3QuZW50cmllcyhzbmFwc2hvdC5jb3VudHMpLm1hcCgoW2tleSwgdmFsdWVdKSA9PiBba2V5LCAtdmFsdWVdKSlcbiAgICAgIGF3YWl0IHRoaXMuX3JlY29yZENvdW50RGVsdGEoZGIsIGRlbHRhcylcbiAgICB9KVxuICB9XG5cbiAgLyoqXG4gICAqIENhbmNlbHMgYSBxdWV1ZWQgb3IgaGFuZGVkLW9mZiBqb2IgYW5kIHJlbGVhc2VzIGFueSBkdXJhYmxlIGNvbmN1cnJlbmN5IHJlc2VydmF0aW9uLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gam9iSWQgLSBKb2IgaWQuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPGJvb2xlYW4+fSAtIFdoZXRoZXIgdGhlIGpvYiB3YXMgY2FuY2VsbGVkLlxuICAgKi9cbiAgYXN5bmMgY2FuY2VsKGpvYklkKSB7XG4gICAgYXdhaXQgdGhpcy5lbnN1cmVSZWFkeSgpXG4gICAgcmV0dXJuIGF3YWl0IHRoaXMuX3NlcmlhbGl6ZWRDb3VudE11dGF0aW9uKGFzeW5jIChkYikgPT4ge1xuICAgICAgY29uc3Qgam9iID0gYXdhaXQgdGhpcy5fZ2V0Sm9iUm93QnlJZChkYiwgam9iSWQpXG4gICAgICBpZiAoIWpvYiB8fCAoam9iLnN0YXR1cyAhPT0gXCJxdWV1ZWRcIiAmJiBqb2Iuc3RhdHVzICE9PSBcImhhbmRlZF9vZmZcIikpIHJldHVybiBmYWxzZVxuICAgICAgLy8gT25seSBhIGhhbmRlZF9vZmYgam9iIGhvbGRzIGEgY29uY3VycmVuY3kgcmVzZXJ2YXRpb24sIHNvIG9ubHkgdGhhdCBjYXNlIHRvdWNoZXMgdGhlXG4gICAgICAvLyBzaGFyZWQgY291bnRlciByb3cgYW5kIG5lZWRzIHRoZSBjb25jdXJyZW5jeS10aGVuLWpvYiBsb2NrIG9yZGVyaW5nLlxuICAgICAgaWYgKGpvYi5zdGF0dXMgPT09IFwiaGFuZGVkX29mZlwiKSBhd2FpdCB0aGlzLl9sb2NrQ29uY3VycmVuY3lSb3coZGIsIGpvYi5jb25jdXJyZW5jeUtleSlcbiAgICAgIGNvbnN0IGFmZmVjdGVkUm93cyA9IGF3YWl0IHRoaXMuX3VwZGF0ZUFmZmVjdGVkUm93cyhkYiwge3RhYmxlTmFtZTogSk9CU19UQUJMRSwgZGF0YToge3N0YXR1czogXCJjYW5jZWxsZWRcIn0sIGNvbmRpdGlvbnM6IHtpZDogam9iLmlkLCBzdGF0dXM6IGpvYi5zdGF0dXN9fSlcbiAgICAgIGlmIChhZmZlY3RlZFJvd3MgIT09IDEpIHJldHVybiBmYWxzZVxuICAgICAgYXdhaXQgdGhpcy5fcmVsZWFzZVNjaGVkdWxlT3duZXJzaGlwRm9ySm9iKGRiLCBqb2IpXG4gICAgICBpZiAoam9iLnN0YXR1cyA9PT0gXCJoYW5kZWRfb2ZmXCIpIGF3YWl0IHRoaXMuX3JlbGVhc2VDb25jdXJyZW5jeShkYiwgam9iLmNvbmN1cnJlbmN5S2V5KVxuICAgICAgYXdhaXQgdGhpcy5fcmVjb3JkU3RhdHVzVHJhbnNpdGlvbihkYiwgam9iLnN0YXR1cywgXCJjYW5jZWxsZWRcIilcbiAgICAgIHJldHVybiB0cnVlXG4gICAgfSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGdldCByZXRyeSBkZWxheSBtcy5cbiAgICogQHBhcmFtIHtudW1iZXJ9IHJldHJ5Q291bnQgLSBSZXRyeSBhdHRlbXB0IGNvdW50ICgxLWJhc2VkKS5cbiAgICogQHJldHVybnMge251bWJlcn0gLSBEZWxheSBpbiBtaWxsaXNlY29uZHMuXG4gICAqL1xuICBnZXRSZXRyeURlbGF5TXMocmV0cnlDb3VudCkge1xuICAgIHJldHVybiByZXRyeURlbGF5TXMocmV0cnlDb3VudClcbiAgfVxuXG4gIC8qKlxuICAgKiBOb3JtYWxpemVzIG9uZSBuZXcgam9iIGJlZm9yZSBlbnRlcmluZyBpdHMgcGVyc2lzdGVuY2UgdHJhbnNhY3Rpb24uXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gSm9iIGlucHV0LlxuICAgKiBAcGFyYW0ge0FycmF5PFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gYXJncy5hcmdzIC0gSm9iIGFyZ3VtZW50cy5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGFyZ3Muam9iTmFtZSAtIEpvYiBuYW1lLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vdHlwZXMuanNcIikuQmFja2dyb3VuZEpvYk9wdGlvbnN9IFthcmdzLm9wdGlvbnNdIC0gSm9iIG9wdGlvbnMuXG4gICAqIEByZXR1cm5zIHtQcmVwYXJlZEJhY2tncm91bmRKb2J9IC0gUHJlcGFyZWQgam9iLlxuICAgKi9cbiAgX3ByZXBhcmVKb2Ioe2FyZ3MsIGpvYk5hbWUsIG9wdGlvbnN9KSB7XG4gICAgY29uc3QgY3JlYXRlZEF0TXMgPSBEYXRlLm5vdygpXG4gICAgY29uc3QgcXVldWUgPSB0aGlzLl9ub3JtYWxpemVRdWV1ZShvcHRpb25zKVxuXG4gICAgcmV0dXJuIHtcbiAgICAgIGFyZ3NKc29uOiBKU09OLnN0cmluZ2lmeShhcmdzIHx8IFtdKSxcbiAgICAgIGNvbmN1cnJlbmN5OiB0aGlzLl9yZXNvbHZlQ29uY3VycmVuY3kob3B0aW9ucywgcXVldWUpLFxuICAgICAgY3JlYXRlZEF0TXMsXG4gICAgICBleGVjdXRpb25Nb2RlOiB0aGlzLl9ub3JtYWxpemVFeGVjdXRpb25Nb2RlKG9wdGlvbnMpLFxuICAgICAgam9iSWQ6IHJhbmRvbVVVSUQoKSxcbiAgICAgIGpvYk5hbWUsXG4gICAgICBtYXhSZXRyaWVzOiB0aGlzLl9ub3JtYWxpemVNYXhSZXRyaWVzKG9wdGlvbnM/Lm1heFJldHJpZXMpLFxuICAgICAgcXVldWUsXG4gICAgICBzY2hlZHVsZWRBdE1zOiB0aGlzLl9ub3JtYWxpemVTY2hlZHVsZWRBdE1zKG9wdGlvbnM/LnNjaGVkdWxlZEF0TXMsIGNyZWF0ZWRBdE1zKSxcbiAgICAgIHRpbWVvdXRNczogdGhpcy5fbm9ybWFsaXplSm9iVGltZW91dE1zKG9wdGlvbnMpXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIE5vcm1hbGl6ZXMgYSBwZXItam9iIHRpbWVvdXQgd2hpbGUgcHJlc2VydmluZyBvbWl0dGVkICh3b3JrZXIgZmFsbGJhY2spXG4gICAqIHNlcGFyYXRlbHkgZnJvbSBleHBsaWNpdGx5IGRpc2FibGVkLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vdHlwZXMuanNcIikuQmFja2dyb3VuZEpvYk9wdGlvbnMgfCB1bmRlZmluZWR9IG9wdGlvbnMgLSBKb2Igb3B0aW9ucy5cbiAgICogQHJldHVybnMge251bWJlciB8IG51bGx9IC0gUG9zaXRpdmUgdGltZW91dCwgemVybyBmb3IgZGlzYWJsZWQsIG9yIG51bGwgd2hlbiBvbWl0dGVkLlxuICAgKi9cbiAgX25vcm1hbGl6ZUpvYlRpbWVvdXRNcyhvcHRpb25zKSB7XG4gICAgaWYgKG9wdGlvbnM/LnRpbWVvdXRNcyA9PT0gdW5kZWZpbmVkKSByZXR1cm4gbnVsbFxuXG4gICAgY29uc3QgdGltZW91dE1zID0gb3B0aW9ucy50aW1lb3V0TXNcblxuICAgIGlmICh0eXBlb2YgdGltZW91dE1zICE9PSBcIm51bWJlclwiIHx8ICFOdW1iZXIuaXNGaW5pdGUodGltZW91dE1zKSkge1xuICAgICAgdGhyb3cgVmVsb2Npb3VzRXJyb3Iuc2FmZShKT0JfVElNRU9VVF9WQUxJREFUSU9OX01FU1NBR0UpXG4gICAgfVxuXG4gICAgaWYgKHRpbWVvdXRNcyA8PSAwKSByZXR1cm4gMFxuXG4gICAgaWYgKCFOdW1iZXIuaXNJbnRlZ2VyKHRpbWVvdXRNcykgfHwgdGltZW91dE1zID4gTUFYX0pPQl9USU1FT1VUX01TKSB7XG4gICAgICB0aHJvdyBWZWxvY2lvdXNFcnJvci5zYWZlKEpPQl9USU1FT1VUX1ZBTElEQVRJT05fTUVTU0FHRSlcbiAgICB9XG5cbiAgICByZXR1cm4gdGltZW91dE1zXG4gIH1cblxuICAvKipcbiAgICogSW5zZXJ0cyBvbmUgcHJlcGFyZWQgcXVldWVkIGpvYiwgaW5jbHVkaW5nIGl0cyBjb25jdXJyZW5jeSByZWdpc3RyYXRpb24uXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vZGF0YWJhc2UvZHJpdmVycy9iYXNlLmpzXCIpLmRlZmF1bHR9IGRiIC0gRGF0YWJhc2UgY29ubmVjdGlvbi5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBJbnNlcnQgaW5wdXQuXG4gICAqIEBwYXJhbSB7UHJlcGFyZWRCYWNrZ3JvdW5kSm9ifSBhcmdzLnByZXBhcmVkSm9iIC0gUHJlcGFyZWQgam9iLlxuICAgKiBAcGFyYW0ge3N0cmluZyB8IG51bGx9IGFyZ3Muc2NoZWR1bGVLZXkgLSBIaXN0b3JpY2FsIHN0YWJsZSBrZXkuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIGFmdGVyIGluc2VydGlvbi5cbiAgICovXG4gIGFzeW5jIF9pbnNlcnRQcmVwYXJlZEpvYihkYiwge3ByZXBhcmVkSm9iLCBzY2hlZHVsZUtleX0pIHtcbiAgICBjb25zdCB7Y29uY3VycmVuY3l9ID0gcHJlcGFyZWRKb2JcblxuICAgIGlmIChjb25jdXJyZW5jeSkge1xuICAgICAgaWYgKGNvbmN1cnJlbmN5LnF1ZXVlRGVyaXZlZCkge1xuICAgICAgICBhd2FpdCB0aGlzLl9lbnN1cmVRdWV1ZUNvbmN1cnJlbmN5S2V5KGRiLCBjb25jdXJyZW5jeSlcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIGF3YWl0IHRoaXMuX2Vuc3VyZUNvbmN1cnJlbmN5S2V5KGRiLCBjb25jdXJyZW5jeSlcbiAgICAgIH1cbiAgICB9XG5cbiAgICBhd2FpdCBkYi5pbnNlcnQoe1xuICAgICAgdGFibGVOYW1lOiBKT0JTX1RBQkxFLFxuICAgICAgZGF0YToge1xuICAgICAgICBpZDogcHJlcGFyZWRKb2Iuam9iSWQsXG4gICAgICAgIGpvYl9uYW1lOiBwcmVwYXJlZEpvYi5qb2JOYW1lLFxuICAgICAgICBhcmdzX2pzb246IHByZXBhcmVkSm9iLmFyZ3NKc29uLFxuICAgICAgICBleGVjdXRpb25fbW9kZTogcHJlcGFyZWRKb2IuZXhlY3V0aW9uTW9kZSxcbiAgICAgICAgcXVldWU6IHByZXBhcmVkSm9iLnF1ZXVlLFxuICAgICAgICBtYXhfcmV0cmllczogcHJlcGFyZWRKb2IubWF4UmV0cmllcyxcbiAgICAgICAgYXR0ZW1wdHM6IDAsXG4gICAgICAgIHN0YXR1czogXCJxdWV1ZWRcIixcbiAgICAgICAgc2NoZWR1bGVkX2F0X21zOiBwcmVwYXJlZEpvYi5zY2hlZHVsZWRBdE1zLFxuICAgICAgICBjcmVhdGVkX2F0X21zOiBwcmVwYXJlZEpvYi5jcmVhdGVkQXRNcyxcbiAgICAgICAgc2NoZWR1bGVfa2V5OiBzY2hlZHVsZUtleSxcbiAgICAgICAgY29uY3VycmVuY3lfa2V5OiBjb25jdXJyZW5jeT8uY29uY3VycmVuY3lLZXkgfHwgbnVsbCxcbiAgICAgICAgbWF4X2NvbmN1cnJlbmN5OiBjb25jdXJyZW5jeT8ubWF4Q29uY3VycmVuY3kgfHwgbnVsbCxcbiAgICAgICAgdGltZW91dF9tczogcHJlcGFyZWRKb2IudGltZW91dE1zLFxuICAgICAgICBoYW5kb2ZmX2lkOiBudWxsXG4gICAgICB9XG4gICAgfSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIG5vcm1hbGl6ZSBtYXggcmV0cmllcy5cbiAgICogQHBhcmFtIHtudW1iZXIgfCBudWxsIHwgdW5kZWZpbmVkfSBtYXhSZXRyaWVzIC0gSW5wdXQuXG4gICAqIEByZXR1cm5zIHtudW1iZXJ9IC0gTm9ybWFsaXplZCBtYXggcmV0cmllcy5cbiAgICovXG4gIF9ub3JtYWxpemVNYXhSZXRyaWVzKG1heFJldHJpZXMpIHtcbiAgICByZXR1cm4gbm9ybWFsaXplQmFja2dyb3VuZEpvYk1heFJldHJpZXMobWF4UmV0cmllcylcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIG5vcm1hbGl6ZSBzY2hlZHVsZWQgYXQgbXMuXG4gICAqIEBwYXJhbSB7bnVtYmVyIHwgdW5kZWZpbmVkfSBzY2hlZHVsZWRBdE1zIC0gUmVxdWVzdGVkIGRpc3BhdGNoIHRpbWVzdGFtcC5cbiAgICogQHBhcmFtIHtudW1iZXJ9IGRlZmF1bHRTY2hlZHVsZWRBdE1zIC0gRGVmYXVsdCBkaXNwYXRjaCB0aW1lc3RhbXAuXG4gICAqIEByZXR1cm5zIHtudW1iZXJ9IC0gRGlzcGF0Y2ggdGltZXN0YW1wLlxuICAgKi9cbiAgX25vcm1hbGl6ZVNjaGVkdWxlZEF0TXMoc2NoZWR1bGVkQXRNcywgZGVmYXVsdFNjaGVkdWxlZEF0TXMpIHtcbiAgICByZXR1cm4gbm9ybWFsaXplQmFja2dyb3VuZEpvYlNjaGVkdWxlZEF0TXMoc2NoZWR1bGVkQXRNcywgZGVmYXVsdFNjaGVkdWxlZEF0TXMpXG4gIH1cblxuICAvKipcbiAgICogUmVzb2x2ZXMgYSByZXNjaGVkdWxlIGRlbGF5IGFnYWluc3QgcGVyc2lzdGVuY2UgdGltZS5cbiAgICogQHBhcmFtIHtudW1iZXJ9IGRlbGF5TXMgLSBEZWxheSBpbiBtaWxsaXNlY29uZHMuXG4gICAqIEByZXR1cm5zIHtudW1iZXJ9IC0gRnV0dXJlIGVsaWdpYmlsaXR5IHRpbWVzdGFtcC5cbiAgICovXG4gIF9yZXNjaGVkdWxlZEF0TXMoZGVsYXlNcykge1xuICAgIHJldHVybiByZXNjaGVkdWxlZEJhY2tncm91bmRKb2JBdE1zKGRlbGF5TXMsIERhdGUubm93KCkpXG4gIH1cblxuICAvKipcbiAgICogVmFsaWRhdGVzIGEgcHVibGljIHJlc2NoZWR1bGUgZGVsYXkgYmVmb3JlIHBlcnNpc3RlbmNlIHdvcmsgYmVnaW5zLlxuICAgKiBAcGFyYW0ge251bWJlcn0gZGVsYXlNcyAtIERlbGF5IGluIG1pbGxpc2Vjb25kcy5cbiAgICogQHJldHVybnMge3ZvaWR9XG4gICAqL1xuICBfdmFsaWRhdGVSZXNjaGVkdWxlRGVsYXlNcyhkZWxheU1zKSB7XG4gICAgcmVzY2hlZHVsZWRCYWNrZ3JvdW5kSm9iQXRNcyhkZWxheU1zLCAwKVxuICB9XG5cbiAgLyoqXG4gICAqIFZhbGlkYXRlcyBhIHN0YWJsZSBzY2hlZHVsZSBrZXkgYXQgdGhlIHB1YmxpYyBzdG9yYWdlIGJvdW5kYXJ5LlxuICAgKiBAcGFyYW0ge3N0cmluZ30gc2NoZWR1bGVLZXkgLSBTdGFibGUgbG9naWNhbCBzY2hlZHVsZSBrZXkuXG4gICAqIEByZXR1cm5zIHtzdHJpbmd9IC0gVmFsaWRhdGVkIGtleS5cbiAgICovXG4gIF9ub3JtYWxpemVTY2hlZHVsZUtleShzY2hlZHVsZUtleSkge1xuICAgIGlmICh0eXBlb2Ygc2NoZWR1bGVLZXkgPT09IFwic3RyaW5nXCIgJiYgc2NoZWR1bGVLZXkubGVuZ3RoID4gMCAmJiBzY2hlZHVsZUtleS5sZW5ndGggPD0gMjU1KSByZXR1cm4gc2NoZWR1bGVLZXlcblxuICAgIHRocm93IFZlbG9jaW91c0Vycm9yLnNhZmUoXCJiYWNrZ3JvdW5kIGpvYiBzY2hlZHVsZUtleSBtdXN0IGJlIGEgbm9uLWVtcHR5IHN0cmluZyBvZiBhdCBtb3N0IDI1NSBjaGFyYWN0ZXJzXCIpXG4gIH1cblxuICAvKipcbiAgICogQnVpbGRzIGEgYm91bmRlZCBhZHZpc29yeS1sb2NrIG5hbWUgZm9yIG9uZSBzdGFibGUgc2NoZWR1bGUga2V5LlxuICAgKiBAcGFyYW0ge3N0cmluZ30gc2NoZWR1bGVLZXkgLSBWYWxpZGF0ZWQgc3RhYmxlIHNjaGVkdWxlIGtleS5cbiAgICogQHJldHVybnMge3N0cmluZ30gLSBBZHZpc29yeS1sb2NrIG5hbWUuXG4gICAqL1xuICBfc2NoZWR1bGVLZXlMb2NrTmFtZShzY2hlZHVsZUtleSkge1xuICAgIGNvbnN0IGhhc2ggPSBjcmVhdGVIYXNoKFwic2hhMjU2XCIpLnVwZGF0ZShzY2hlZHVsZUtleSkuZGlnZXN0KFwiaGV4XCIpLnNsaWNlKDAsIDMyKVxuXG4gICAgcmV0dXJuIGBiYWNrZ3JvdW5kLWpvYnM6c2NoZWR1bGU6JHtoYXNofWBcbiAgfVxuXG4gIC8qKlxuICAgKiBFbnN1cmVzIHRoZSBiYWNrZ3JvdW5kLWpvYnMgc2NoZW1hIGV4aXN0cywgcmV1c2luZyBhIGNhbGxlci1oZWxkIGNvbm5lY3Rpb24gd2hlblxuICAgKiBvbmUgaXMgZ2l2ZW4gcmF0aGVyIHRoYW4gY2hlY2tpbmcgb3V0IGl0cyBvd24uXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vZGF0YWJhc2UvZHJpdmVycy9iYXNlLmpzXCIpLmRlZmF1bHR9IFtleGlzdGluZ0RiXSAtIFJldXNlIGFuXG4gICAqICAgYWxyZWFkeS1jaGVja2VkLW91dCBjb25uZWN0aW9uIChlLmcuIHRoZSBvbmUgYGRiOm1pZ3JhdGVgIGhvbGRzKSBpbnN0ZWFkIG9mXG4gICAqICAgY2hlY2tpbmcgb3V0IGEgbmVzdGVkIG9uZSDigJQgdGhlIG5lc3RlZCBjaGVja291dCB3b3VsZCBkZWFkbG9jayBhIGRhdGFiYXNlXG4gICAqICAgd2hvc2UgcG9vbCBpcyBjYXBwZWQgYXQgYSBzaW5nbGUgY29ubmVjdGlvbiBhbHJlYWR5IGhlbGQgYnkgdGhlIGNhbGxlci5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgd2hlbiB0aGUgc2NoZW1hIGlzIHByZXNlbnQuXG4gICAqL1xuICBhc3luYyBfZW5zdXJlU2NoZW1hKGV4aXN0aW5nRGIpIHtcbiAgICBhd2FpdCB0aGlzLl9hcHBseVNjaGVtYShleGlzdGluZ0RiKVxuICB9XG5cbiAgLyoqXG4gICAqIFNlcmlhbGl6ZXMgY3JlYXRpb24gb3IgdXBncmFkZSBvZiB0aGUgYmFja2dyb3VuZC1qb2JzIHNjaGVtYSwgY2hlY2tpbmcgb3V0IGFcbiAgICogY29ubmVjdGlvbiBvbmx5IGFmdGVyIGVhcmxpZXIgc2NoZW1hIHdvcmsgaGFzIGNvbXBsZXRlZCB3aGVuIG9uZSBpcyBub3Qgc3VwcGxpZWQuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vZGF0YWJhc2UvZHJpdmVycy9iYXNlLmpzXCIpLmRlZmF1bHR9IFtleGlzdGluZ0RiXSAtIENhbGxlci1vd25lZFxuICAgKiAgIGRhdGFiYXNlIGNvbm5lY3Rpb24uXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIHdoZW4gdGhlIHNjaGVtYSBpcyBwcmVzZW50LlxuICAgKi9cbiAgYXN5bmMgX2FwcGx5U2NoZW1hKGV4aXN0aW5nRGIpIHtcbiAgICAvLyBTZXJpYWxpemUgY29uY3VycmVudCBzY2hlbWEgYXBwbGllcyB3aXRoaW4gdGhpcyBwcm9jZXNzLCBrZXllZCBieSBkYXRhYmFzZVxuICAgIC8vIGlkZW50aWZpZXIgKHNlZSBgc2NoZW1hQXBwbHlDaGFpbnNgKS4gVGhlIHBlci1zdGVwIGxvY2tzIGluc2lkZSB0aGUgc3RlcHMgdXNlXG4gICAgLy8gRElGRkVSRU5UIGxvY2sgbmFtZXMsIHNvIHR3byBjb25jdXJyZW50IGNhbGxlcnMgY291bGQgb3RoZXJ3aXNlIGVhY2ggaG9sZCBhXG4gICAgLy8gZGlmZmVyZW50IHN0ZXAgbG9jayB3aGlsZSBib3RoIHJlYnVpbGQgdGhlIGpvYnMgdGFibGUg4oCUIGFuZCBvbiBTUUxpdGUvTVNTUUwgYW5cbiAgICAvLyBhZGQtY29sdW1uIGlzIGEgY3JlYXRlLWNvcHktZHJvcC1yZW5hbWUgcmVidWlsZCwgc28gb3ZlcmxhcHBpbmcgcmVidWlsZHNcbiAgICAvLyBjb3JydXB0IGl0LiBUaGlzIG11dGV4IG1ha2VzIHRoZSB3aG9sZSBhcHBseSBtdXR1YWxseSBleGNsdXNpdmUgcGVyIHByb2Nlc3M7XG4gICAgLy8gdGhlIHNlY29uZCBjYWxsZXIgdGhlbiByZS1jaGVja3MgYW5kIGZpbmRzIGV2ZXJ5IHN0ZXAgYWxyZWFkeSBkb25lLlxuICAgIGNvbnN0IGlkZW50aWZpZXIgPSB0aGlzLmdldERhdGFiYXNlSWRlbnRpZmllcigpID8/IFwiZGVmYXVsdFwiXG4gICAgY29uc3QgcHJldmlvdXMgPSBzY2hlbWFBcHBseUNoYWlucy5nZXQoaWRlbnRpZmllcikgPz8gUHJvbWlzZS5yZXNvbHZlKClcbiAgICBjb25zdCBhcHBseVdpdGhDb25uZWN0aW9uID0gYXN5bmMgKCkgPT4ge1xuICAgICAgaWYgKGV4aXN0aW5nRGIpIHtcbiAgICAgICAgYXdhaXQgdGhpcy5fYXBwbHlTY2hlbWFTdGVwcyhleGlzdGluZ0RiKVxuXG4gICAgICAgIHJldHVyblxuICAgICAgfVxuXG4gICAgICBhd2FpdCB0aGlzLl93aXRoRGIoKGRiKSA9PiB0aGlzLl9hcHBseVNjaGVtYVN0ZXBzKGRiKSlcbiAgICB9XG4gICAgY29uc3QgcnVuID0gcHJldmlvdXMudGhlbihhcHBseVdpdGhDb25uZWN0aW9uLCBhcHBseVdpdGhDb25uZWN0aW9uKVxuXG4gICAgLy8gS2VlcCB0aGUgY2hhaW4gYWxpdmUgcmVnYXJkbGVzcyBvZiB0aGlzIHJ1bidzIG91dGNvbWUgc28gb25lIGZhaWxlZCBhcHBseSBkb2VzXG4gICAgLy8gbm90IHdlZGdlIGxhdGVyIGNhbGxlcnM7IHRoaXMgcnVuIHN0aWxsIHByb3BhZ2F0ZXMgaXRzIG93biByZXN1bHQvZXJyb3IuXG4gICAgc2NoZW1hQXBwbHlDaGFpbnMuc2V0KGlkZW50aWZpZXIsIHJ1bi50aGVuKCgpID0+IHt9LCAoKSA9PiB7fSkpXG5cbiAgICByZXR1cm4gYXdhaXQgcnVuXG4gIH1cblxuICAvKipcbiAgICogQ3JlYXRlcyBvciB1cGdyYWRlcyB0aGUgYmFja2dyb3VuZC1qb2JzIHRhYmxlcywgY29sdW1ucyBhbmQgY29uY3VycmVuY3kgcm93cyBvblxuICAgKiB0aGUgZ2l2ZW4gY29ubmVjdGlvbi4gU2VyaWFsaXplZCBwZXIgcHJvY2VzcyBieSB7QGxpbmsgQmFja2dyb3VuZEpvYnNTdG9yZSNfYXBwbHlTY2hlbWF9LlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL2RhdGFiYXNlL2RyaXZlcnMvYmFzZS5qc1wiKS5kZWZhdWx0fSBkYiAtIERhdGFiYXNlIGNvbm5lY3Rpb24uXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIHdoZW4gdGhlIHNjaGVtYSBpcyBwcmVzZW50LlxuICAgKi9cbiAgYXN5bmMgX2FwcGx5U2NoZW1hU3RlcHMoZGIpIHtcbiAgICBhd2FpdCB0aGlzLl9lbnN1cmVNaWdyYXRpb25zVGFibGUoZGIpXG5cbiAgICBjb25zdCBhbHJlYWR5QXBwbGllZCA9IGF3YWl0IHRoaXMuX2hhc01pZ3JhdGlvbihkYilcbiAgICBjb25zdCBzY2hlbWFSZWNvdmVyeVBlbmRpbmcgPSBhd2FpdCB0aGlzLl9oYXNNaWdyYXRpb24oZGIsIFNDSEVNQV9SRUNPVkVSWV9QRU5ESU5HX1ZFUlNJT04pXG4gICAgY29uc3Qgam9ic1RhYmxlRXhpc3RzID0gYXdhaXQgZGIudGFibGVFeGlzdHMoSk9CU19UQUJMRSlcblxuICAgIC8vIEV2ZW4gd2hlbiB0aGUgbWlncmF0aW9uIHJvdyBpcyBwcmVzZW50LCB0aGUgam9icyB0YWJsZSBpdHNlbGYgY2FuIGhhdmVcbiAgICAvLyBiZWVuIGRyb3BwZWQgdW5kZXJuZWF0aCB1cyBieSBhIHRyYW5zYWN0aW9uIHJvbGxiYWNrIGluIGFub3RoZXIgY2FsbGVyXG4gICAgLy8gKERETCBpcyB0cmFuc2FjdGlvbmFsIG9uIFNRTGl0ZS9NU1NRTCkuIFZlcmlmeSB0aGUgdGFibGUgcGh5c2ljYWxseVxuICAgIC8vIGV4aXN0cyBhbmQgcmVjcmVhdGUgaXQgd2hlbiBtaXNzaW5nIHJhdGhlciB0aGFuIHRydXN0aW5nIHRoZSBtaWdyYXRpb25cbiAgICAvLyByb3cgYWxvbmUsIG90aGVyd2lzZSBsYXRlciBjYWxsZXJzIGZhaWwgd2l0aCBcIm5vIHN1Y2ggdGFibGVcIi5cbiAgICBpZiAoYWxyZWFkeUFwcGxpZWQgJiYgam9ic1RhYmxlRXhpc3RzICYmICFzY2hlbWFSZWNvdmVyeVBlbmRpbmcpIHtcbiAgICAgIGF3YWl0IHRoaXMuX2Vuc3VyZUpvYnNUYWJsZUNvbHVtbnMoZGIpXG4gICAgICBhd2FpdCB0aGlzLl9lbnN1cmVJZGVtcG90ZW5jeUtleXNUYWJsZShkYilcbiAgICAgIGF3YWl0IHRoaXMuX2Vuc3VyZU1haWxEZWxpdmVyeU9wZXJhdGlvbnNUYWJsZShkYilcbiAgICAgIGF3YWl0IHRoaXMuX2Vuc3VyZVNjaGVkdWxlS2V5c1RhYmxlKGRiKVxuICAgICAgYXdhaXQgdGhpcy5fZW5zdXJlQ29uY3VycmVuY3lUYWJsZShkYilcbiAgICAgIGF3YWl0IHRoaXMuX2Vuc3VyZUNvdW50UmV2aXNpb25UYWJsZShkYilcblxuICAgICAgcmV0dXJuXG4gICAgfVxuXG4gICAgaWYgKGFscmVhZHlBcHBsaWVkICYmICFzY2hlbWFSZWNvdmVyeVBlbmRpbmcpIHtcbiAgICAgIGF3YWl0IHRoaXMuX3JlY29yZE1pZ3JhdGlvbihkYiwgU0NIRU1BX1JFQ09WRVJZX1BFTkRJTkdfVkVSU0lPTilcbiAgICB9XG5cbiAgICBhd2FpdCB0aGlzLl9hcHBseU1pZ3JhdGlvbnMoZGIpXG4gICAgYXdhaXQgdGhpcy5fZW5zdXJlSm9ic1RhYmxlQ29sdW1ucyhkYilcbiAgICBhd2FpdCB0aGlzLl9lbnN1cmVJZGVtcG90ZW5jeUtleXNUYWJsZShkYilcbiAgICBhd2FpdCB0aGlzLl9lbnN1cmVNYWlsRGVsaXZlcnlPcGVyYXRpb25zVGFibGUoZGIpXG4gICAgYXdhaXQgdGhpcy5fZW5zdXJlU2NoZWR1bGVLZXlzVGFibGUoZGIpXG4gICAgYXdhaXQgdGhpcy5fZW5zdXJlQ29uY3VycmVuY3lUYWJsZShkYilcbiAgICBhd2FpdCB0aGlzLl9lbnN1cmVDb3VudFJldmlzaW9uVGFibGUoZGIpXG5cbiAgICBpZiAoYWxyZWFkeUFwcGxpZWQpIHtcbiAgICAgIC8vIFRoZSByZWNyZWF0ZWQgam9icyB0YWJsZSBpcyBlbXB0eSwgYnV0IHRoZSBzdXJ2aXZpbmcgY29uY3VycmVuY3kgdGFibGVcbiAgICAgIC8vIGNhbiBzdGlsbCBjb3VudCBoYW5kb2ZmcyB0aGF0IGRpc2FwcGVhcmVkIHdpdGggdGhlIGRyb3BwZWQgam9icyB0YWJsZS5cbiAgICAgIGF3YWl0IHRoaXMuX3JlY29uY2lsZUNvbmN1cnJlbmN5KGRiKVxuICAgICAgYXdhaXQgZGIuZGVsZXRlKHtcbiAgICAgICAgdGFibGVOYW1lOiBNSUdSQVRJT05TX1RBQkxFLFxuICAgICAgICBjb25kaXRpb25zOiB7a2V5OiB0aGlzLl9taWdyYXRpb25LZXkoU0NIRU1BX1JFQ09WRVJZX1BFTkRJTkdfVkVSU0lPTil9XG4gICAgICB9KVxuXG4gICAgICByZXR1cm5cbiAgICB9XG5cbiAgICBhd2FpdCB0aGlzLl9yZWNvcmRNaWdyYXRpb24oZGIsIE1JR1JBVElPTl9WRVJTSU9OKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZW5zdXJlIG1pZ3JhdGlvbnMgdGFibGUuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vZGF0YWJhc2UvZHJpdmVycy9iYXNlLmpzXCIpLmRlZmF1bHR9IGRiIC0gRGF0YWJhc2UgY29ubmVjdGlvbi5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgd2hlbiBjb21wbGV0ZS5cbiAgICovXG4gIGFzeW5jIF9lbnN1cmVNaWdyYXRpb25zVGFibGUoZGIpIHtcbiAgICBpZiAoYXdhaXQgZGIudGFibGVFeGlzdHMoTUlHUkFUSU9OU19UQUJMRSkpIHJldHVyblxuXG4gICAgY29uc3QgdGFibGUgPSBuZXcgVGFibGVEYXRhKE1JR1JBVElPTlNfVEFCTEUsIHtpZk5vdEV4aXN0czogdHJ1ZX0pXG5cbiAgICB0YWJsZS5zdHJpbmcoXCJrZXlcIiwge251bGw6IGZhbHNlLCBwcmltYXJ5S2V5OiB0cnVlfSlcbiAgICB0YWJsZS5zdHJpbmcoXCJzY29wZVwiLCB7bnVsbDogZmFsc2V9KVxuICAgIHRhYmxlLnN0cmluZyhcInZlcnNpb25cIiwge251bGw6IGZhbHNlfSlcbiAgICB0YWJsZS5iaWdpbnQoXCJhcHBsaWVkX2F0X21zXCIsIHtudWxsOiBmYWxzZX0pXG5cbiAgICBhd2FpdCBkYi5jcmVhdGVUYWJsZSh0YWJsZSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGhhcyBtaWdyYXRpb24uXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vZGF0YWJhc2UvZHJpdmVycy9iYXNlLmpzXCIpLmRlZmF1bHR9IGRiIC0gRGF0YWJhc2UgY29ubmVjdGlvbi5cbiAgICogQHBhcmFtIHtzdHJpbmd9IFt2ZXJzaW9uXSAtIE1pZ3JhdGlvbiB2ZXJzaW9uLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxib29sZWFuPn0gLSBXaGV0aGVyIG1pZ3JhdGlvbiBleGlzdHMuXG4gICAqL1xuICBhc3luYyBfaGFzTWlncmF0aW9uKGRiLCB2ZXJzaW9uID0gTUlHUkFUSU9OX1ZFUlNJT04pIHtcbiAgICBjb25zdCBxdWVyeSA9IGRiXG4gICAgICAubmV3UXVlcnkoKVxuICAgICAgLmZyb20oTUlHUkFUSU9OU19UQUJMRSlcbiAgICAgIC53aGVyZSh7a2V5OiB0aGlzLl9taWdyYXRpb25LZXkodmVyc2lvbil9KVxuICAgICAgLmxpbWl0KDEpXG5cbiAgICBjb25zdCByb3dzID0gYXdhaXQgcXVlcnkucmVzdWx0cygpXG5cbiAgICByZXR1cm4gcm93cy5sZW5ndGggPiAwXG4gIH1cblxuICAvKipcbiAgICogUnVucyBhcHBseSBtaWdyYXRpb25zLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL2RhdGFiYXNlL2RyaXZlcnMvYmFzZS5qc1wiKS5kZWZhdWx0fSBkYiAtIERhdGFiYXNlIGNvbm5lY3Rpb24uXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIHdoZW4gY29tcGxldGUuXG4gICAqL1xuICBhc3luYyBfYXBwbHlNaWdyYXRpb25zKGRiKSB7XG4gICAgdGhpcy5sb2dnZXIuaW5mbyhcIkFwcGx5aW5nIGJhY2tncm91bmQgam9icyBzY2hlbWFcIilcblxuICAgIGlmIChhd2FpdCBkYi50YWJsZUV4aXN0cyhKT0JTX1RBQkxFKSkge1xuICAgICAgdGhpcy5sb2dnZXIuaW5mbyhcIkJhY2tncm91bmQgam9icyB0YWJsZSBhbHJlYWR5IGV4aXN0cyAtIHNraXBwaW5nIGNyZWF0ZVwiKVxuICAgICAgcmV0dXJuXG4gICAgfVxuXG4gICAgY29uc3QgdGFibGUgPSBuZXcgVGFibGVEYXRhKEpPQlNfVEFCTEUsIHtpZk5vdEV4aXN0czogdHJ1ZX0pXG5cbiAgICB0YWJsZS5zdHJpbmcoXCJpZFwiLCB7cHJpbWFyeUtleTogdHJ1ZX0pXG4gICAgdGFibGUuc3RyaW5nKFwiam9iX25hbWVcIiwge251bGw6IGZhbHNlLCBpbmRleDogdHJ1ZX0pXG4gICAgdGFibGUudGV4dChcImFyZ3NfanNvblwiLCB7bnVsbDogZmFsc2V9KVxuICAgIHRhYmxlLnN0cmluZyhcImV4ZWN1dGlvbl9tb2RlXCIsIHtudWxsOiBmYWxzZX0pXG4gICAgdGFibGUuc3RyaW5nKFwicXVldWVcIiwge251bGw6IHRydWUsIGluZGV4OiB0cnVlfSlcbiAgICB0YWJsZS5pbnRlZ2VyKFwibWF4X3JldHJpZXNcIiwge251bGw6IGZhbHNlfSlcbiAgICB0YWJsZS5pbnRlZ2VyKFwiYXR0ZW1wdHNcIiwge251bGw6IGZhbHNlfSlcbiAgICB0YWJsZS5zdHJpbmcoXCJzdGF0dXNcIiwge251bGw6IGZhbHNlLCBpbmRleDogdHJ1ZX0pXG4gICAgdGFibGUuYmlnaW50KFwic2NoZWR1bGVkX2F0X21zXCIsIHtudWxsOiBmYWxzZSwgaW5kZXg6IHRydWV9KVxuICAgIHRhYmxlLmJpZ2ludChcImNyZWF0ZWRfYXRfbXNcIiwge251bGw6IGZhbHNlLCBpbmRleDogdHJ1ZX0pXG4gICAgdGFibGUuc3RyaW5nKFwic2NoZWR1bGVfa2V5XCIsIHtudWxsOiB0cnVlLCBpbmRleDogdHJ1ZX0pXG4gICAgdGFibGUuYmlnaW50KFwiaGFuZGVkX29mZl9hdF9tc1wiLCB7bnVsbDogdHJ1ZSwgaW5kZXg6IHRydWV9KVxuICAgIHRhYmxlLnN0cmluZyhcImhhbmRvZmZfaWRcIiwge251bGw6IHRydWV9KVxuICAgIHRhYmxlLmJpZ2ludChcImNvbXBsZXRlZF9hdF9tc1wiLCB7bnVsbDogdHJ1ZX0pXG4gICAgdGFibGUuYmlnaW50KFwiZmFpbGVkX2F0X21zXCIsIHtudWxsOiB0cnVlfSlcbiAgICB0YWJsZS5iaWdpbnQoXCJvcnBoYW5lZF9hdF9tc1wiLCB7bnVsbDogdHJ1ZSwgaW5kZXg6IHRydWV9KVxuICAgIHRhYmxlLnN0cmluZyhcIndvcmtlcl9pZFwiLCB7bnVsbDogdHJ1ZX0pXG4gICAgdGFibGUudGV4dChcImxhc3RfZXJyb3JcIiwge251bGw6IHRydWV9KVxuICAgIHRhYmxlLnN0cmluZyhcImNvbmN1cnJlbmN5X2tleVwiLCB7bnVsbDogdHJ1ZSwgaW5kZXg6IHRydWV9KVxuICAgIHRhYmxlLmludGVnZXIoXCJtYXhfY29uY3VycmVuY3lcIiwge251bGw6IHRydWV9KVxuICAgIHRhYmxlLmJpZ2ludChcInRpbWVvdXRfbXNcIiwge251bGw6IHRydWV9KVxuXG4gICAgYXdhaXQgZGIuY3JlYXRlVGFibGUodGFibGUpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBlbnN1cmUgam9icyB0YWJsZSBjb2x1bW5zLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL2RhdGFiYXNlL2RyaXZlcnMvYmFzZS5qc1wiKS5kZWZhdWx0fSBkYiAtIERhdGFiYXNlIGNvbm5lY3Rpb24uXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIHdoZW4gY29tcGxldGUuXG4gICAqL1xuICBhc3luYyBfZW5zdXJlSm9ic1RhYmxlQ29sdW1ucyhkYikge1xuICAgIGlmICghKGF3YWl0IGRiLnRhYmxlRXhpc3RzKEpPQlNfVEFCTEUpKSkgcmV0dXJuXG5cbiAgICBjb25zdCB0YWJsZSA9IGF3YWl0IGRiLmdldFRhYmxlQnlOYW1lT3JGYWlsKEpPQlNfVEFCTEUpXG4gICAgY29uc3QgZXhlY3V0aW9uTW9kZUNvbHVtbiA9IGF3YWl0IHRhYmxlLmdldENvbHVtbkJ5TmFtZShcImV4ZWN1dGlvbl9tb2RlXCIpXG5cbiAgICBpZiAoIWV4ZWN1dGlvbk1vZGVDb2x1bW4pIHtcbiAgICAgIGNvbnN0IHRhYmxlRGF0YSA9IG5ldyBUYWJsZURhdGEoSk9CU19UQUJMRSlcbiAgICAgIHRhYmxlRGF0YS5zdHJpbmcoXCJleGVjdXRpb25fbW9kZVwiLCB7bnVsbDogdHJ1ZX0pXG4gICAgICBjb25zdCBzcWxzID0gYXdhaXQgZGIuYWx0ZXJUYWJsZVNRTHModGFibGVEYXRhKVxuXG4gICAgICBmb3IgKGNvbnN0IHNxbCBvZiBzcWxzKSB7XG4gICAgICAgIGF3YWl0IGRiLnF1ZXJ5KHNxbClcbiAgICAgIH1cblxuICAgICAgZGIuY2xlYXJTY2hlbWFDYWNoZSgpXG4gICAgfVxuXG4gICAgY29uc3QgcmVmcmVzaGVkVGFibGUgPSBhd2FpdCBkYi5nZXRUYWJsZUJ5TmFtZU9yRmFpbChKT0JTX1RBQkxFKVxuICAgIGNvbnN0IGhhbmRvZmZJZENvbHVtbiA9IGF3YWl0IHJlZnJlc2hlZFRhYmxlLmdldENvbHVtbkJ5TmFtZShcImhhbmRvZmZfaWRcIilcblxuICAgIGlmICghaGFuZG9mZklkQ29sdW1uKSB7XG4gICAgICBjb25zdCBsb2NrTmFtZSA9IGAke01JR1JBVElPTl9TQ09QRX06aGFuZG9mZl9pZF9jb2x1bW5gXG4gICAgICBjb25zdCBhY3F1aXJlZCA9IGF3YWl0IGRiLmFjcXVpcmVBZHZpc29yeUxvY2sobG9ja05hbWUpXG5cbiAgICAgIGlmICghYWNxdWlyZWQpIHRocm93IG5ldyBFcnJvcihcIkZhaWxlZCB0byBhY3F1aXJlIGJhY2tncm91bmQgam9icyBoYW5kb2ZmIHNjaGVtYSBsb2NrXCIpXG5cbiAgICAgIHRyeSB7XG4gICAgICAgIGRiLmNsZWFyU2NoZW1hQ2FjaGUoKVxuICAgICAgICBjb25zdCBsb2NrZWRUYWJsZSA9IGF3YWl0IGRiLmdldFRhYmxlQnlOYW1lT3JGYWlsKEpPQlNfVEFCTEUpXG5cbiAgICAgICAgaWYgKCEoYXdhaXQgbG9ja2VkVGFibGUuZ2V0Q29sdW1uQnlOYW1lKFwiaGFuZG9mZl9pZFwiKSkpIHtcbiAgICAgICAgICBjb25zdCB0YWJsZURhdGEgPSBuZXcgVGFibGVEYXRhKEpPQlNfVEFCTEUpXG4gICAgICAgICAgdGFibGVEYXRhLnN0cmluZyhcImhhbmRvZmZfaWRcIiwge251bGw6IHRydWV9KVxuICAgICAgICAgIGNvbnN0IHNxbHMgPSBhd2FpdCBkYi5hbHRlclRhYmxlU1FMcyh0YWJsZURhdGEpXG5cbiAgICAgICAgICBmb3IgKGNvbnN0IHNxbCBvZiBzcWxzKSB7XG4gICAgICAgICAgICBhd2FpdCBkYi5xdWVyeShzcWwpXG4gICAgICAgICAgfVxuXG4gICAgICAgICAgZGIuY2xlYXJTY2hlbWFDYWNoZSgpXG4gICAgICAgIH1cbiAgICAgIH0gZmluYWxseSB7XG4gICAgICAgIGF3YWl0IGRiLnJlbGVhc2VBZHZpc29yeUxvY2sobG9ja05hbWUpXG4gICAgICB9XG4gICAgfVxuXG4gICAgYXdhaXQgdGhpcy5fYmFja2ZpbGxFeGVjdXRpb25Nb2Rlc09uY2UoZGIpXG4gICAgYXdhaXQgdGhpcy5fZHJvcEZvcmtlZENvbHVtbk9uY2UoZGIpXG5cbiAgICBjb25zdCBsb2NrTmFtZSA9IGAke01JR1JBVElPTl9TQ09QRX06Y29uY3VycmVuY3lfY29sdW1uc2BcbiAgICBjb25zdCBhY3F1aXJlZCA9IGF3YWl0IGRiLmFjcXVpcmVBZHZpc29yeUxvY2sobG9ja05hbWUpXG5cbiAgICBpZiAoIWFjcXVpcmVkKSB0aHJvdyBuZXcgRXJyb3IoXCJGYWlsZWQgdG8gYWNxdWlyZSBiYWNrZ3JvdW5kIGpvYnMgY29uY3VycmVuY3kgc2NoZW1hIGxvY2tcIilcblxuICAgIHRyeSB7XG4gICAgICAvLyBTUUwgU2VydmVyIHNjaGVtYSByZWFkcyBjYW4gZGVhZGxvY2sgd2l0aCBhIGNvbmN1cnJlbnQgQUxURVIgVEFCTEUsIHNvXG4gICAgICAvLyBhY3F1aXJlIHRoZSBsb2NrIGJlZm9yZSBpbnNwZWN0aW5nIGVpdGhlciBjb2x1bW4gcmF0aGVyIHRoYW4gb25seVxuICAgICAgLy8gcHJvdGVjdGluZyB0aGUgbXV0YXRpb24uXG4gICAgICBkYi5jbGVhclNjaGVtYUNhY2hlKClcbiAgICAgIGNvbnN0IGxvY2tlZFRhYmxlID0gYXdhaXQgZGIuZ2V0VGFibGVCeU5hbWVPckZhaWwoSk9CU19UQUJMRSlcbiAgICAgIGNvbnN0IGNvbmN1cnJlbmN5Q29sdW1uTmFtZXMgPSBbXCJjb25jdXJyZW5jeV9rZXlcIiwgXCJtYXhfY29uY3VycmVuY3lcIl1cblxuICAgICAgZm9yIChjb25zdCBjb25jdXJyZW5jeUNvbHVtbk5hbWUgb2YgY29uY3VycmVuY3lDb2x1bW5OYW1lcykge1xuICAgICAgICBpZiAoYXdhaXQgbG9ja2VkVGFibGUuZ2V0Q29sdW1uQnlOYW1lKGNvbmN1cnJlbmN5Q29sdW1uTmFtZSkpIGNvbnRpbnVlXG5cbiAgICAgICAgY29uc3QgdGFibGVEYXRhID0gbmV3IFRhYmxlRGF0YShKT0JTX1RBQkxFKVxuICAgICAgICBpZiAoY29uY3VycmVuY3lDb2x1bW5OYW1lID09IFwiY29uY3VycmVuY3lfa2V5XCIpIHtcbiAgICAgICAgICB0YWJsZURhdGEuc3RyaW5nKFwiY29uY3VycmVuY3lfa2V5XCIsIHtudWxsOiB0cnVlLCBpbmRleDogdHJ1ZX0pXG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgdGFibGVEYXRhLmludGVnZXIoXCJtYXhfY29uY3VycmVuY3lcIiwge251bGw6IHRydWV9KVxuICAgICAgICB9XG5cbiAgICAgICAgZm9yIChjb25zdCBzcWwgb2YgYXdhaXQgZGIuYWx0ZXJUYWJsZVNRTHModGFibGVEYXRhKSkgYXdhaXQgZGIucXVlcnkoc3FsKVxuICAgICAgfVxuXG4gICAgICBkYi5jbGVhclNjaGVtYUNhY2hlKClcbiAgICB9IGZpbmFsbHkge1xuICAgICAgYXdhaXQgZGIucmVsZWFzZUFkdmlzb3J5TG9jayhsb2NrTmFtZSlcbiAgICB9XG5cbiAgICBhd2FpdCB0aGlzLl9lbnN1cmVRdWV1ZUNvbHVtbihkYilcbiAgICBhd2FpdCB0aGlzLl9lbnN1cmVTY2hlZHVsZUtleUNvbHVtbihkYilcbiAgICBhd2FpdCB0aGlzLl9lbnN1cmVKb2JUaW1lb3V0Q29sdW1uKGRiKVxuICAgIGF3YWl0IHRoaXMuX2Vuc3VyZUpvYnNUYWJsZUluZGV4ZXNPbmNlKGRiKVxuICB9XG5cbiAgLyoqXG4gICAqIFJlcGFpcnMgc2Vjb25kYXJ5IGluZGV4ZXMgdGhhdCBvbGRlciBhZGQtY29sdW1uIHVwZ3JhZGVzIGRlY2xhcmVkIGJ1dCBkaWRcbiAgICogbm90IGNyZWF0ZSBvbiBldmVyeSBTUUwgZHJpdmVyLiBUaGUgbWlncmF0aW9uIGxlZGdlciBrZWVwcyByb3V0aW5lIHN0b3JlXG4gICAqIHJlYWRpbmVzcyBmcm9tIHJlcGVhdGVkbHkgaW50cm9zcGVjdGluZyB0aGUgZnVsbCBpbmRleCBzZXQuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vZGF0YWJhc2UvZHJpdmVycy9iYXNlLmpzXCIpLmRlZmF1bHR9IGRiIC0gRGF0YWJhc2UgY29ubmVjdGlvbi5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgd2hlbiBhbGwgZXhwZWN0ZWQgaW5kZXhlcyBleGlzdC5cbiAgICovXG4gIGFzeW5jIF9lbnN1cmVKb2JzVGFibGVJbmRleGVzT25jZShkYikge1xuICAgIGNvbnN0IG1pZ3JhdGlvblZlcnNpb24gPSBKT0JTX0lOREVYX1JFUEFJUl9NSUdSQVRJT05fVkVSU0lPTlxuICAgIGNvbnN0IG1pZ3JhdGlvbktleSA9IHRoaXMuX21pZ3JhdGlvbktleShtaWdyYXRpb25WZXJzaW9uKVxuXG4gICAgaWYgKGF3YWl0IHRoaXMuX2hhc01pZ3JhdGlvbihkYiwgbWlncmF0aW9uVmVyc2lvbikpIHJldHVyblxuXG4gICAgY29uc3QgYWNxdWlyZWQgPSBhd2FpdCBkYi5hY3F1aXJlQWR2aXNvcnlMb2NrKG1pZ3JhdGlvbktleSlcblxuICAgIGlmICghYWNxdWlyZWQpIHRocm93IG5ldyBFcnJvcihcIkZhaWxlZCB0byBhY3F1aXJlIGJhY2tncm91bmQgam9icyBpbmRleCByZXBhaXIgbG9ja1wiKVxuXG4gICAgdHJ5IHtcbiAgICAgIGlmIChhd2FpdCB0aGlzLl9oYXNNaWdyYXRpb24oZGIsIG1pZ3JhdGlvblZlcnNpb24pKSByZXR1cm5cblxuICAgICAgZGIuY2xlYXJTY2hlbWFDYWNoZSgpXG4gICAgICBjb25zdCB0YWJsZSA9IGF3YWl0IGRiLmdldFRhYmxlQnlOYW1lT3JGYWlsKEpPQlNfVEFCTEUpXG4gICAgICBjb25zdCBpbmRleGVkQ29sdW1uTmFtZXMgPSBuZXcgU2V0KFxuICAgICAgICAoYXdhaXQgdGFibGUuZ2V0SW5kZXhlcygpKVxuICAgICAgICAgIC5maWx0ZXIoKGluZGV4KSA9PiAhaW5kZXguaXNQcmltYXJ5S2V5KCkgJiYgaW5kZXguZ2V0Q29sdW1uTmFtZXMoKS5sZW5ndGggPT09IDEpXG4gICAgICAgICAgLm1hcCgoaW5kZXgpID0+IGluZGV4LmdldENvbHVtbk5hbWVzKClbMF0pXG4gICAgICApXG5cbiAgICAgIGZvciAoY29uc3QgY29sdW1uTmFtZSBvZiBKT0JTX0lOREVYX0NPTFVNTl9OQU1FUykge1xuICAgICAgICBpZiAoaW5kZXhlZENvbHVtbk5hbWVzLmhhcyhjb2x1bW5OYW1lKSkgY29udGludWVcblxuICAgICAgICBmb3IgKGNvbnN0IHNxbCBvZiBhd2FpdCBkYi5jcmVhdGVJbmRleFNRTHMoe2NvbHVtbnM6IFtjb2x1bW5OYW1lXSwgaWZOb3RFeGlzdHM6IGRiLmdldFR5cGUoKSA9PT0gXCJzcWxpdGVcIiwgdGFibGVOYW1lOiBKT0JTX1RBQkxFfSkpIHtcbiAgICAgICAgICBhd2FpdCBkYi5xdWVyeShzcWwpXG4gICAgICAgIH1cbiAgICAgIH1cblxuICAgICAgZGIuY2xlYXJTY2hlbWFDYWNoZSgpXG4gICAgICBhd2FpdCB0aGlzLl9yZWNvcmRNaWdyYXRpb24oZGIsIG1pZ3JhdGlvblZlcnNpb24pXG4gICAgfSBmaW5hbGx5IHtcbiAgICAgIGF3YWl0IGRiLnJlbGVhc2VBZHZpc29yeUxvY2sobWlncmF0aW9uS2V5KVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBJZGVtcG90ZW50bHkgYWRkcyB0aGUgcGVyLWpvYiB3YWxsLWNsb2NrIHRpbWVvdXQgdG8gZXhpc3Rpbmcgam9iIHRhYmxlcy5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9kYXRhYmFzZS9kcml2ZXJzL2Jhc2UuanNcIikuZGVmYXVsdH0gZGIgLSBEYXRhYmFzZSBjb25uZWN0aW9uLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyB3aGVuIGVuc3VyZWQuXG4gICAqL1xuICBhc3luYyBfZW5zdXJlSm9iVGltZW91dENvbHVtbihkYikge1xuICAgIGNvbnN0IGxvY2tOYW1lID0gYCR7TUlHUkFUSU9OX1NDT1BFfTp0aW1lb3V0X21zX2NvbHVtbmBcbiAgICBjb25zdCBhY3F1aXJlZCA9IGF3YWl0IGRiLmFjcXVpcmVBZHZpc29yeUxvY2sobG9ja05hbWUpXG5cbiAgICBpZiAoIWFjcXVpcmVkKSB0aHJvdyBuZXcgRXJyb3IoXCJGYWlsZWQgdG8gYWNxdWlyZSBiYWNrZ3JvdW5kIGpvYnMgdGltZW91dCBzY2hlbWEgbG9ja1wiKVxuXG4gICAgdHJ5IHtcbiAgICAgIGRiLmNsZWFyU2NoZW1hQ2FjaGUoKVxuICAgICAgY29uc3QgdGFibGUgPSBhd2FpdCBkYi5nZXRUYWJsZUJ5TmFtZU9yRmFpbChKT0JTX1RBQkxFKVxuXG4gICAgICBpZiAoIShhd2FpdCB0YWJsZS5nZXRDb2x1bW5CeU5hbWUoXCJ0aW1lb3V0X21zXCIpKSkge1xuICAgICAgICBjb25zdCB0YWJsZURhdGEgPSBuZXcgVGFibGVEYXRhKEpPQlNfVEFCTEUpXG4gICAgICAgIHRhYmxlRGF0YS5iaWdpbnQoXCJ0aW1lb3V0X21zXCIsIHtudWxsOiB0cnVlfSlcblxuICAgICAgICBmb3IgKGNvbnN0IHNxbCBvZiBhd2FpdCBkYi5hbHRlclRhYmxlU1FMcyh0YWJsZURhdGEpKSBhd2FpdCBkYi5xdWVyeShzcWwpXG5cbiAgICAgICAgZGIuY2xlYXJTY2hlbWFDYWNoZSgpXG4gICAgICB9XG4gICAgfSBmaW5hbGx5IHtcbiAgICAgIGF3YWl0IGRiLnJlbGVhc2VBZHZpc29yeUxvY2sobG9ja05hbWUpXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIElkZW1wb3RlbnRseSBhZGRzIHRoZSBoaXN0b3JpY2FsIHN0YWJsZSBzY2hlZHVsZSBrZXkgdG8gZXhpc3Rpbmcgam9icy5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9kYXRhYmFzZS9kcml2ZXJzL2Jhc2UuanNcIikuZGVmYXVsdH0gZGIgLSBEYXRhYmFzZSBjb25uZWN0aW9uLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyB3aGVuIGVuc3VyZWQuXG4gICAqL1xuICBhc3luYyBfZW5zdXJlU2NoZWR1bGVLZXlDb2x1bW4oZGIpIHtcbiAgICBjb25zdCBsb2NrTmFtZSA9IGAke01JR1JBVElPTl9TQ09QRX06c2NoZWR1bGVfa2V5X2NvbHVtbmBcbiAgICBjb25zdCBhY3F1aXJlZCA9IGF3YWl0IGRiLmFjcXVpcmVBZHZpc29yeUxvY2sobG9ja05hbWUpXG5cbiAgICBpZiAoIWFjcXVpcmVkKSB0aHJvdyBuZXcgRXJyb3IoXCJGYWlsZWQgdG8gYWNxdWlyZSBiYWNrZ3JvdW5kIGpvYnMgc2NoZWR1bGUta2V5IHNjaGVtYSBsb2NrXCIpXG5cbiAgICB0cnkge1xuICAgICAgZGIuY2xlYXJTY2hlbWFDYWNoZSgpXG4gICAgICBjb25zdCBsb2NrZWRUYWJsZSA9IGF3YWl0IGRiLmdldFRhYmxlQnlOYW1lT3JGYWlsKEpPQlNfVEFCTEUpXG5cbiAgICAgIGlmICghKGF3YWl0IGxvY2tlZFRhYmxlLmdldENvbHVtbkJ5TmFtZShcInNjaGVkdWxlX2tleVwiKSkpIHtcbiAgICAgICAgY29uc3QgdGFibGVEYXRhID0gbmV3IFRhYmxlRGF0YShKT0JTX1RBQkxFKVxuXG4gICAgICAgIHRhYmxlRGF0YS5zdHJpbmcoXCJzY2hlZHVsZV9rZXlcIiwge251bGw6IHRydWUsIGluZGV4OiB0cnVlfSlcblxuICAgICAgICBmb3IgKGNvbnN0IHNxbCBvZiBhd2FpdCBkYi5hbHRlclRhYmxlU1FMcyh0YWJsZURhdGEpKSBhd2FpdCBkYi5xdWVyeShzcWwpXG5cbiAgICAgICAgZGIuY2xlYXJTY2hlbWFDYWNoZSgpXG4gICAgICB9XG4gICAgfSBmaW5hbGx5IHtcbiAgICAgIGF3YWl0IGRiLnJlbGVhc2VBZHZpc29yeUxvY2sobG9ja05hbWUpXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIElkZW1wb3RlbnRseSBhZGRzIHRoZSBgcXVldWVgIGNvbHVtbiB0byBhbiBleGlzdGluZyBqb2JzIHRhYmxlLiBFeGlzdGluZ1xuICAgKiByb3dzIHJlYWQgYmFjayBhcyB0aGUgZGVmYXVsdCBxdWV1ZSAoc2VlIHtAbGluayBfbm9ybWFsaXplSm9iUm93fSksIHNvIG5vXG4gICAqIGRhdGEgYmFja2ZpbGwgaXMgcmVxdWlyZWQuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vZGF0YWJhc2UvZHJpdmVycy9iYXNlLmpzXCIpLmRlZmF1bHR9IGRiIC0gRGF0YWJhc2UgY29ubmVjdGlvbi5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgd2hlbiBlbnN1cmVkLlxuICAgKi9cbiAgYXN5bmMgX2Vuc3VyZVF1ZXVlQ29sdW1uKGRiKSB7XG4gICAgY29uc3QgbG9ja05hbWUgPSBgJHtNSUdSQVRJT05fU0NPUEV9OnF1ZXVlX2NvbHVtbmBcbiAgICBjb25zdCBhY3F1aXJlZCA9IGF3YWl0IGRiLmFjcXVpcmVBZHZpc29yeUxvY2sobG9ja05hbWUpXG5cbiAgICBpZiAoIWFjcXVpcmVkKSB0aHJvdyBuZXcgRXJyb3IoXCJGYWlsZWQgdG8gYWNxdWlyZSBiYWNrZ3JvdW5kIGpvYnMgcXVldWUgc2NoZW1hIGxvY2tcIilcblxuICAgIHRyeSB7XG4gICAgICAvLyBTUUwgU2VydmVyIHNjaGVtYSByZWFkcyBjYW4gZGVhZGxvY2sgd2l0aCBhIGNvbmN1cnJlbnQgQUxURVIgVEFCTEUsIHNvXG4gICAgICAvLyBhY3F1aXJlIHRoZSBsb2NrIGJlZm9yZSBpbnNwZWN0aW5nIHRoZSBjb2x1bW4gcmF0aGVyIHRoYW4gb25seVxuICAgICAgLy8gcHJvdGVjdGluZyB0aGUgbXV0YXRpb24gKG1pcnJvcnMgdGhlIGNvbmN1cnJlbmN5LWNvbHVtbiBtaWdyYXRpb24pLlxuICAgICAgZGIuY2xlYXJTY2hlbWFDYWNoZSgpXG4gICAgICBjb25zdCBsb2NrZWRUYWJsZSA9IGF3YWl0IGRiLmdldFRhYmxlQnlOYW1lT3JGYWlsKEpPQlNfVEFCTEUpXG5cbiAgICAgIGlmICghKGF3YWl0IGxvY2tlZFRhYmxlLmdldENvbHVtbkJ5TmFtZShcInF1ZXVlXCIpKSkge1xuICAgICAgICBjb25zdCB0YWJsZURhdGEgPSBuZXcgVGFibGVEYXRhKEpPQlNfVEFCTEUpXG5cbiAgICAgICAgdGFibGVEYXRhLnN0cmluZyhcInF1ZXVlXCIsIHtudWxsOiB0cnVlLCBpbmRleDogdHJ1ZX0pXG5cbiAgICAgICAgZm9yIChjb25zdCBzcWwgb2YgYXdhaXQgZGIuYWx0ZXJUYWJsZVNRTHModGFibGVEYXRhKSkgYXdhaXQgZGIucXVlcnkoc3FsKVxuXG4gICAgICAgIGRiLmNsZWFyU2NoZW1hQ2FjaGUoKVxuICAgICAgfVxuICAgIH0gZmluYWxseSB7XG4gICAgICBhd2FpdCBkYi5yZWxlYXNlQWR2aXNvcnlMb2NrKGxvY2tOYW1lKVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGJhY2tmaWxsIGV4ZWN1dGlvbiBtb2RlcyBvbmNlLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL2RhdGFiYXNlL2RyaXZlcnMvYmFzZS5qc1wiKS5kZWZhdWx0fSBkYiAtIERhdGFiYXNlIGNvbm5lY3Rpb24uXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIHdoZW4gY29tcGxldGUuXG4gICAqL1xuICBhc3luYyBfYmFja2ZpbGxFeGVjdXRpb25Nb2Rlc09uY2UoZGIpIHtcbiAgICBjb25zdCBtaWdyYXRpb25WZXJzaW9uID0gRVhFQ1VUSU9OX01PREVfQkFDS0ZJTExfTUlHUkFUSU9OX1ZFUlNJT05cbiAgICBjb25zdCBtaWdyYXRpb25LZXkgPSB0aGlzLl9taWdyYXRpb25LZXkobWlncmF0aW9uVmVyc2lvbilcblxuICAgIGlmIChhd2FpdCB0aGlzLl9oYXNNaWdyYXRpb24oZGIsIG1pZ3JhdGlvblZlcnNpb24pKSByZXR1cm5cblxuICAgIGF3YWl0IGRiLmFjcXVpcmVBZHZpc29yeUxvY2sobWlncmF0aW9uS2V5KVxuXG4gICAgdHJ5IHtcbiAgICAgIGlmIChhd2FpdCB0aGlzLl9oYXNNaWdyYXRpb24oZGIsIG1pZ3JhdGlvblZlcnNpb24pKSByZXR1cm5cblxuICAgICAgLy8gQSB0YWJsZSBjcmVhdGVkIGFmdGVyIHRoZSBgZm9ya2VkYCBjb2x1bW4gd2FzIGRyb3BwZWQgaGFzIG5vdGhpbmcgdG9cbiAgICAgIC8vIGJhY2tmaWxsIGZyb207IHJlY29yZCB0aGUgbWlncmF0aW9uIHNvIGl0IGlzIG5vdCByZS1hdHRlbXB0ZWQuXG4gICAgICBkYi5jbGVhclNjaGVtYUNhY2hlKClcbiAgICAgIGlmICghKGF3YWl0IChhd2FpdCBkYi5nZXRUYWJsZUJ5TmFtZU9yRmFpbChKT0JTX1RBQkxFKSkuZ2V0Q29sdW1uQnlOYW1lKFwiZm9ya2VkXCIpKSkge1xuICAgICAgICBhd2FpdCB0aGlzLl9yZWNvcmRNaWdyYXRpb24oZGIsIG1pZ3JhdGlvblZlcnNpb24pXG4gICAgICAgIHJldHVyblxuICAgICAgfVxuXG4gICAgICBjb25zdCB0YWJsZU5hbWVTcWwgPSBkYi5xdW90ZVRhYmxlKEpPQlNfVEFCTEUpXG4gICAgICBjb25zdCBmb3JrZWRDb2x1bW5TcWwgPSBkYi5xdW90ZUNvbHVtbihcImZvcmtlZFwiKVxuICAgICAgY29uc3QgZXhlY3V0aW9uTW9kZUNvbHVtblNxbCA9IGRiLnF1b3RlQ29sdW1uKFwiZXhlY3V0aW9uX21vZGVcIilcblxuICAgICAgYXdhaXQgZGIucXVlcnkoXG4gICAgICAgIGBVUERBVEUgJHt0YWJsZU5hbWVTcWx9IFNFVCAke2V4ZWN1dGlvbk1vZGVDb2x1bW5TcWx9ID0gJHtkYi5xdW90ZShcImZvcmtlZFwiKX0gYCArXG4gICAgICAgIGBXSEVSRSAke2ZvcmtlZENvbHVtblNxbH0gPSAke2RiLnF1b3RlKHRydWUpfSBBTkQgJHtleGVjdXRpb25Nb2RlQ29sdW1uU3FsfSBJUyBOVUxMYFxuICAgICAgKVxuICAgICAgYXdhaXQgZGIucXVlcnkoXG4gICAgICAgIGBVUERBVEUgJHt0YWJsZU5hbWVTcWx9IFNFVCAke2V4ZWN1dGlvbk1vZGVDb2x1bW5TcWx9ID0gJHtkYi5xdW90ZShcImlubGluZVwiKX0gYCArXG4gICAgICAgIGBXSEVSRSAke2ZvcmtlZENvbHVtblNxbH0gPSAke2RiLnF1b3RlKGZhbHNlKX0gQU5EICR7ZXhlY3V0aW9uTW9kZUNvbHVtblNxbH0gSVMgTlVMTGBcbiAgICAgIClcblxuICAgICAgYXdhaXQgdGhpcy5fcmVjb3JkTWlncmF0aW9uKGRiLCBtaWdyYXRpb25WZXJzaW9uKVxuICAgIH0gZmluYWxseSB7XG4gICAgICBhd2FpdCBkYi5yZWxlYXNlQWR2aXNvcnlMb2NrKG1pZ3JhdGlvbktleSlcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogUmV3cml0ZXMgcHJlLWV4aXN0aW5nIHBvb2xlZCByb3dzIChwZXJzaXN0ZWQgYXMgYGV4ZWN1dGlvbl9tb2RlID0gXCJmb3JrZWRcImBcbiAgICogcGx1cyBhIGB2ZWxvY2lvdXMtcG9vbGVkOipgIGhhbmRvZmYgbWFya2VyKSB0byBgZXhlY3V0aW9uX21vZGUgPSBcInBvb2xlZFwiYCxcbiAgICogY2xlYXJzIHRoZSBxdWV1ZWQgbWFya2VyLCB0aGVuIGRyb3BzIHRoZSBub3ctcmVkdW5kYW50IGBmb3JrZWRgIGNvbHVtbiBzb1xuICAgKiBgZXhlY3V0aW9uX21vZGVgIGlzIHRoZSBzaW5nbGUgc291cmNlIG9mIHRydXRoLiBSdW5zIG9uY2UsIGd1YXJkZWQgYnkgdGhlXG4gICAqIG1pZ3JhdGlvbiBsZWRnZXIgYW5kIGEgcGVyLWtleSBhZHZpc29yeSBsb2NrOyBhIGZyZXNoIHRhYmxlIChjcmVhdGVkIHdpdGhvdXRcbiAgICogdGhlIGNvbHVtbikgc2hvcnQtY2lyY3VpdHMuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vZGF0YWJhc2UvZHJpdmVycy9iYXNlLmpzXCIpLmRlZmF1bHR9IGRiIC0gRGF0YWJhc2UgY29ubmVjdGlvbi5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgd2hlbiBjb21wbGV0ZS5cbiAgICovXG4gIGFzeW5jIF9kcm9wRm9ya2VkQ29sdW1uT25jZShkYikge1xuICAgIGNvbnN0IG1pZ3JhdGlvblZlcnNpb24gPSBEUk9QX0ZPUktFRF9DT0xVTU5fTUlHUkFUSU9OX1ZFUlNJT05cbiAgICBjb25zdCBtaWdyYXRpb25LZXkgPSB0aGlzLl9taWdyYXRpb25LZXkobWlncmF0aW9uVmVyc2lvbilcblxuICAgIGlmIChhd2FpdCB0aGlzLl9oYXNNaWdyYXRpb24oZGIsIG1pZ3JhdGlvblZlcnNpb24pKSByZXR1cm5cblxuICAgIGF3YWl0IGRiLmFjcXVpcmVBZHZpc29yeUxvY2sobWlncmF0aW9uS2V5KVxuXG4gICAgdHJ5IHtcbiAgICAgIGlmIChhd2FpdCB0aGlzLl9oYXNNaWdyYXRpb24oZGIsIG1pZ3JhdGlvblZlcnNpb24pKSByZXR1cm5cblxuICAgICAgZGIuY2xlYXJTY2hlbWFDYWNoZSgpXG5cbiAgICAgIGlmIChhd2FpdCAoYXdhaXQgZGIuZ2V0VGFibGVCeU5hbWVPckZhaWwoSk9CU19UQUJMRSkpLmdldENvbHVtbkJ5TmFtZShcImZvcmtlZFwiKSkge1xuICAgICAgICBjb25zdCB0YWJsZU5hbWVTcWwgPSBkYi5xdW90ZVRhYmxlKEpPQlNfVEFCTEUpXG4gICAgICAgIGNvbnN0IGV4ZWN1dGlvbk1vZGVDb2x1bW5TcWwgPSBkYi5xdW90ZUNvbHVtbihcImV4ZWN1dGlvbl9tb2RlXCIpXG4gICAgICAgIGNvbnN0IGhhbmRvZmZJZENvbHVtblNxbCA9IGRiLnF1b3RlQ29sdW1uKFwiaGFuZG9mZl9pZFwiKVxuXG4gICAgICAgIC8vIFBvb2xlZCByb3dzIHVzZWQgdG8gcGVyc2lzdCBhcyBleGVjdXRpb25fbW9kZSBcImZvcmtlZFwiICsgYSBwb29sZWQgaGFuZG9mZlxuICAgICAgICAvLyBtYXJrZXI7IHJlY292ZXIgdGhlaXIgcmVhbCBtb2RlIGJlZm9yZSB0aGUgbWFya2VyIGlzIGNsZWFyZWQuXG4gICAgICAgIGF3YWl0IGRiLnF1ZXJ5KFxuICAgICAgICAgIGBVUERBVEUgJHt0YWJsZU5hbWVTcWx9IFNFVCAke2V4ZWN1dGlvbk1vZGVDb2x1bW5TcWx9ID0gJHtkYi5xdW90ZShcInBvb2xlZFwiKX0gYCArXG4gICAgICAgICAgYFdIRVJFICR7ZXhlY3V0aW9uTW9kZUNvbHVtblNxbH0gPSAke2RiLnF1b3RlKFwiZm9ya2VkXCIpfSBgICtcbiAgICAgICAgICBgQU5EICR7aGFuZG9mZklkQ29sdW1uU3FsfSBMSUtFICR7ZGIucXVvdGUoYCR7TEVHQUNZX1BPT0xFRF9IQU5ET0ZGX0lEX1BSRUZJWH0lYCl9YFxuICAgICAgICApXG4gICAgICAgIC8vIFRoZSBxdWV1ZWQtcG9vbGVkIG1hcmtlciB3YXMgYSBzZW50aW5lbCwgbm90IGEgcmVhbCBsZWFzZTsgY2xlYXIgaXQuXG4gICAgICAgIGF3YWl0IGRiLnF1ZXJ5KFxuICAgICAgICAgIGBVUERBVEUgJHt0YWJsZU5hbWVTcWx9IFNFVCAke2hhbmRvZmZJZENvbHVtblNxbH0gPSBOVUxMIGAgK1xuICAgICAgICAgIGBXSEVSRSAke2hhbmRvZmZJZENvbHVtblNxbH0gPSAke2RiLnF1b3RlKExFR0FDWV9QT09MRURfUVVFVUVEX0hBTkRPRkZfSUQpfWBcbiAgICAgICAgKVxuXG4gICAgICAgIGNvbnN0IGRyb3BGb3JrZWQgPSBuZXcgVGFibGVEYXRhKEpPQlNfVEFCTEUpXG4gICAgICAgIGRyb3BGb3JrZWQuYWRkQ29sdW1uKFwiZm9ya2VkXCIsIHtkcm9wQ29sdW1uOiB0cnVlfSlcbiAgICAgICAgZm9yIChjb25zdCBzcWwgb2YgYXdhaXQgZGIuYWx0ZXJUYWJsZVNRTHMoZHJvcEZvcmtlZCkpIGF3YWl0IGRiLnF1ZXJ5KHNxbClcblxuICAgICAgICBkYi5jbGVhclNjaGVtYUNhY2hlKClcbiAgICAgIH1cblxuICAgICAgYXdhaXQgdGhpcy5fcmVjb3JkTWlncmF0aW9uKGRiLCBtaWdyYXRpb25WZXJzaW9uKVxuICAgIH0gZmluYWxseSB7XG4gICAgICBhd2FpdCBkYi5yZWxlYXNlQWR2aXNvcnlMb2NrKG1pZ3JhdGlvbktleSlcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogUnVucyByZWNvcmQgbWlncmF0aW9uLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL2RhdGFiYXNlL2RyaXZlcnMvYmFzZS5qc1wiKS5kZWZhdWx0fSBkYiAtIERhdGFiYXNlIGNvbm5lY3Rpb24uXG4gICAqIEBwYXJhbSB7c3RyaW5nfSB2ZXJzaW9uIC0gTWlncmF0aW9uIHZlcnNpb24uXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIHdoZW4gY29tcGxldGUuXG4gICAqL1xuICBhc3luYyBfcmVjb3JkTWlncmF0aW9uKGRiLCB2ZXJzaW9uKSB7XG4gICAgYXdhaXQgZGIudXBzZXJ0KHtcbiAgICAgIHRhYmxlTmFtZTogTUlHUkFUSU9OU19UQUJMRSxcbiAgICAgIGRhdGE6IHtcbiAgICAgICAga2V5OiB0aGlzLl9taWdyYXRpb25LZXkodmVyc2lvbiksXG4gICAgICAgIHNjb3BlOiBNSUdSQVRJT05fU0NPUEUsXG4gICAgICAgIHZlcnNpb24sXG4gICAgICAgIGFwcGxpZWRfYXRfbXM6IERhdGUubm93KClcbiAgICAgIH0sXG4gICAgICBjb25mbGljdENvbHVtbnM6IFtcImtleVwiXSxcbiAgICAgIHVwZGF0ZUNvbHVtbnM6IFtcInNjb3BlXCIsIFwidmVyc2lvblwiLCBcImFwcGxpZWRfYXRfbXNcIl1cbiAgICB9KVxuICB9XG5cbiAgYXN5bmMgX2luaXRpYWxpemVNb2RlbCgpIHtcbiAgICBpZiAoQmFja2dyb3VuZEpvYlJlY29yZC5pc0luaXRpYWxpemVkKCkpIHJldHVyblxuXG4gICAgQmFja2dyb3VuZEpvYlJlY29yZC5zZXREYXRhYmFzZUlkZW50aWZpZXIodGhpcy5nZXREYXRhYmFzZUlkZW50aWZpZXIoKSlcbiAgICBjb25zdCBwb29sID0gdGhpcy5jb25maWd1cmF0aW9uLmdldERhdGFiYXNlUG9vbCh0aGlzLmdldERhdGFiYXNlSWRlbnRpZmllcigpKVxuXG4gICAgYXdhaXQgcG9vbC53aXRoQ29ubmVjdGlvbih7bmFtZTogXCJCYWNrZ3JvdW5kIGpvYnMgc3RvcmUgaW5pdGlhbGl6ZSBtb2RlbFwifSwgYXN5bmMgKCkgPT4ge1xuICAgICAgYXdhaXQgQmFja2dyb3VuZEpvYlJlY29yZC5pbml0aWFsaXplUmVjb3JkKHtjb25maWd1cmF0aW9uOiB0aGlzLmNvbmZpZ3VyYXRpb259KVxuICAgIH0pXG4gIH1cblxuICAvKipcbiAgICogUnVucyBnZXQgam9iIHJvdyBieSBpZC5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9kYXRhYmFzZS9kcml2ZXJzL2Jhc2UuanNcIikuZGVmYXVsdH0gZGIgLSBEYXRhYmFzZSBjb25uZWN0aW9uLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gam9iSWQgLSBKb2IgaWQuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPGltcG9ydChcIi4vdHlwZXMuanNcIikuQmFja2dyb3VuZEpvYlJvdyB8IG51bGw+fSAtIEpvYiByb3cuXG4gICAqL1xuICBhc3luYyBfZ2V0Sm9iUm93QnlJZChkYiwgam9iSWQpIHtcbiAgICBjb25zdCBxdWVyeSA9IGRiXG4gICAgICAubmV3UXVlcnkoKVxuICAgICAgLmZyb20oSk9CU19UQUJMRSlcbiAgICAgIC53aGVyZSh7aWQ6IGpvYklkfSlcbiAgICAgIC5saW1pdCgxKVxuXG4gICAgY29uc3Qgcm93cyA9IGF3YWl0IHF1ZXJ5LnJlc3VsdHMoKVxuXG4gICAgaWYgKCFyb3dzWzBdKSByZXR1cm4gbnVsbFxuXG4gICAgcmV0dXJuIHRoaXMuX25vcm1hbGl6ZUpvYlJvdyhyb3dzWzBdKVxuICB9XG5cbiAgLyoqXG4gICAqIFJlbGVhc2VzIG93bmVyc2hpcCBvbmx5IHdoZW4gdGhlIGtleSBzdGlsbCBwb2ludHMgYXQgdGhlIGV4cGVjdGVkIGpvYi5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9kYXRhYmFzZS9kcml2ZXJzL2Jhc2UuanNcIikuZGVmYXVsdH0gZGIgLSBEYXRhYmFzZSBjb25uZWN0aW9uLlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIE93bmVyc2hpcCBpZGVudGl0eS5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGFyZ3Muam9iSWQgLSBFeHBlY3RlZCBvd25lciBqb2IgaWQuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBhcmdzLnNjaGVkdWxlS2V5IC0gU3RhYmxlIHNjaGVkdWxlIGtleS5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgd2hlbiBkZWxldGVkIG9yIGFscmVhZHkgc3VwZXJzZWRlZC5cbiAgICovXG4gIGFzeW5jIF9yZWxlYXNlU2NoZWR1bGVPd25lcnNoaXAoZGIsIHtqb2JJZCwgc2NoZWR1bGVLZXl9KSB7XG4gICAgYXdhaXQgZGIuZGVsZXRlKHtcbiAgICAgIHRhYmxlTmFtZTogU0NIRURVTEVfS0VZU19UQUJMRSxcbiAgICAgIGNvbmRpdGlvbnM6IHtqb2JfaWQ6IGpvYklkLCBzY2hlZHVsZV9rZXk6IHNjaGVkdWxlS2V5fVxuICAgIH0pXG4gIH1cblxuICAvKipcbiAgICogUmVsZWFzZXMgYSBqb2IncyBvd25lcnNoaXAgd2hlbiBpdCBoYXMgYSBoaXN0b3JpY2FsIHNjaGVkdWxlIGtleS5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9kYXRhYmFzZS9kcml2ZXJzL2Jhc2UuanNcIikuZGVmYXVsdH0gZGIgLSBEYXRhYmFzZSBjb25uZWN0aW9uLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vdHlwZXMuanNcIikuQmFja2dyb3VuZEpvYlJvd30gam9iIC0gVGVybWluYWwgam9iLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyB3aGVuIGRlbGV0ZWQgb3Igbm90IGFwcGxpY2FibGUuXG4gICAqL1xuICBhc3luYyBfcmVsZWFzZVNjaGVkdWxlT3duZXJzaGlwRm9ySm9iKGRiLCBqb2IpIHtcbiAgICBpZiAoIWpvYi5zY2hlZHVsZUtleSkgcmV0dXJuXG5cbiAgICBhd2FpdCB0aGlzLl9yZWxlYXNlU2NoZWR1bGVPd25lcnNoaXAoZGIsIHtqb2JJZDogam9iLmlkLCBzY2hlZHVsZUtleTogam9iLnNjaGVkdWxlS2V5fSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGFwcGx5IGZhaWx1cmUuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gT3B0aW9ucy5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9kYXRhYmFzZS9kcml2ZXJzL2Jhc2UuanNcIikuZGVmYXVsdH0gYXJncy5kYiAtIERhdGFiYXNlIGNvbm5lY3Rpb24uXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi90eXBlcy5qc1wiKS5CYWNrZ3JvdW5kSm9iUm93fSBhcmdzLmpvYiAtIEpvYiByb3cuXG4gICAqIEBwYXJhbSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59IGFyZ3MuZXJyb3IgLSBFcnJvci5cbiAgICogQHBhcmFtIHtib29sZWFufSBhcmdzLm1hcmtPcnBoYW5lZCAtIFdoZXRoZXIgbWFya2luZyBvcnBoYW5lZC5cbiAgICogQHBhcmFtIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59IFthcmdzLmNvbmRpdGlvbnNdIC0gVXBkYXRlIGZlbmNpbmcgY29uZGl0aW9ucy4gRGVmYXVsdHMgdG8gdGhlIGFjdGl2ZS1oYW5kb2ZmIGxlYXNlIG1hdGNoOyB0aGUgdGltZS1iYXNlZCBvcnBoYW4gc3dlZXAgb3ZlcnJpZGVzIHRoaXMgd2l0aCBhbiBpZC9zdGF0dXMgbWF0Y2ggc28gaXQgY2FuIHJlY2xhaW0gcm93cyB3aG9zZSBgaGFuZG9mZl9pZGAgaXMgbnVsbCAoZS5nLiBoYW5kZWQgb2ZmIGJ5IGFuIG9sZGVyIHZlbG9jaW91cyBiZWZvcmUgaGFuZG9mZi1pZCBmZW5jaW5nIGV4aXN0ZWQpLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxpbXBvcnQoXCIuL3R5cGVzLmpzXCIpLkJhY2tncm91bmRKb2JSb3cgfCBudWxsPn0gLSBVcGRhdGVkIGpvYiByb3cgd2hlbiB0aGUgbGVhc2UgdHJhbnNpdGlvbiB3b24uXG4gICAqL1xuICBhc3luYyBfYXBwbHlGYWlsdXJlKHtkYiwgam9iLCBlcnJvciwgbWFya09ycGhhbmVkLCBjb25kaXRpb25zfSkge1xuICAgIGNvbnN0IG5vdyA9IERhdGUubm93KClcbiAgICBjb25zdCBuZXh0QXR0ZW1wdCA9IChqb2IuYXR0ZW1wdHMgfHwgMCkgKyAxXG4gICAgY29uc3QgbWF4UmV0cmllcyA9IHRoaXMuX25vcm1hbGl6ZU1heFJldHJpZXMoam9iLm1heFJldHJpZXMpXG4gICAgY29uc3Qgc2hvdWxkUmV0cnkgPSBuZXh0QXR0ZW1wdCA8PSBtYXhSZXRyaWVzXG4gICAgY29uc3QgZmFpbHVyZU1lc3NhZ2UgPSBub3JtYWxpemVCYWNrZ3JvdW5kSm9iRXJyb3IoZXJyb3IpXG4gICAgY29uc3Qgc2NoZWR1bGVkQXQgPSBzaG91bGRSZXRyeSA/IG5vdyArIHRoaXMuZ2V0UmV0cnlEZWxheU1zKG5leHRBdHRlbXB0KSA6IGpvYi5zY2hlZHVsZWRBdE1zXG4gICAgY29uc3QgcXVldWVkQ29uY3VycmVuY3kgPSBzaG91bGRSZXRyeSA/IGF3YWl0IHRoaXMuX3JlcXVldWVkSm9iQ29uY3VycmVuY3koZGIsIGpvYikgOiBudWxsXG4gICAgY29uc3QgdXBkYXRlID0gdGhpcy5fZmFpbHVyZVVwZGF0ZSh7XG4gICAgICBmYWlsdXJlTWVzc2FnZSxcbiAgICAgIG1hcmtPcnBoYW5lZCxcbiAgICAgIG5leHRBdHRlbXB0LFxuICAgICAgbm93LFxuICAgICAgcXVldWVkQ29uY3VycmVuY3ksXG4gICAgICBzY2hlZHVsZWRBdCxcbiAgICAgIHNob3VsZFJldHJ5XG4gICAgfSlcblxuICAgIGF3YWl0IHRoaXMuX2xvY2tDb25jdXJyZW5jeVJvdyhkYiwgam9iLmNvbmN1cnJlbmN5S2V5KVxuICAgIGNvbnN0IGFmZmVjdGVkUm93cyA9IGF3YWl0IHRoaXMuX3VwZGF0ZUFmZmVjdGVkUm93cyhkYiwge1xuICAgICAgdGFibGVOYW1lOiBKT0JTX1RBQkxFLFxuICAgICAgZGF0YTogdXBkYXRlLFxuICAgICAgY29uZGl0aW9uczogY29uZGl0aW9ucyA/PyB0aGlzLl9hY3RpdmVIYW5kb2ZmQ29uZGl0aW9ucyhqb2IpXG4gICAgfSlcblxuICAgIGlmIChhZmZlY3RlZFJvd3MgIT09IDEpIHJldHVybiBudWxsXG4gICAgaWYgKCFzaG91bGRSZXRyeSkgYXdhaXQgdGhpcy5fcmVsZWFzZVNjaGVkdWxlT3duZXJzaGlwRm9ySm9iKGRiLCBqb2IpXG4gICAgYXdhaXQgdGhpcy5fcmVsZWFzZUNvbmN1cnJlbmN5KGRiLCBqb2IuY29uY3VycmVuY3lLZXkpXG5cbiAgICAvLyBSZXR1cm4gYSBzbmFwc2hvdCBvZiB0aGUgdHJhbnNpdGlvbiB0aGlzIHVwZGF0ZSBqdXN0IGFwcGxpZWQgcmF0aGVyIHRoYW4gcmUtcmVhZGluZyB0aGUgcm93LlxuICAgIC8vIFdlIHdvbiB0aGUgY29uZGl0aW9uYWwgdXBkYXRlIChhZmZlY3RlZFJvd3MgPT09IDEpLCBzbyB0aGlzIHN0YXRlIGlzIGF1dGhvcml0YXRpdmU7IHJlLXJlYWRpbmdcbiAgICAvLyBjb3VsZCBpbnN0ZWFkIG9ic2VydmUgYSBuZXdlciBzdGF0ZSBpZiBhbm90aGVyIGRpc3BhdGNoZXIgcmVjbGFpbXMgYSByZXF1ZXVlZCBqb2IgYmV0d2VlbiB0aGVcbiAgICAvLyB1cGRhdGUgYW5kIHRoZSByZWFkIChvdmVybGFwcGluZyBtYWlucyAvIHBvbGxpbmcgZGlzcGF0Y2gpLCB3aGljaCB3b3VsZCBtaXNyZXBvcnQgdGhlXG4gICAgLy8gc3RhdHVzL3Rlcm1pbmFsL3dpbGxSZXRyeSBvZiB0aGlzIHRyYW5zaXRpb24gdG8gZmFpbHVyZS9vcnBoYW4gZXZlbnQgbGlzdGVuZXJzLlxuICAgIGNvbnN0IHN0YXR1cyA9IHNob3VsZFJldHJ5ID8gXCJxdWV1ZWRcIiA6IChtYXJrT3JwaGFuZWQgPyBcIm9ycGhhbmVkXCIgOiBcImZhaWxlZFwiKVxuICAgIC8qKiBAdHlwZSB7aW1wb3J0KFwiLi90eXBlcy5qc1wiKS5CYWNrZ3JvdW5kSm9iUm93fSAqL1xuICAgIGNvbnN0IHRyYW5zaXRpb25lZEpvYiA9IHtcbiAgICAgIC4uLmpvYixcbiAgICAgIGF0dGVtcHRzOiBuZXh0QXR0ZW1wdCxcbiAgICAgIGhhbmRlZE9mZkF0TXM6IG51bGwsXG4gICAgICBsYXN0RXJyb3I6IGZhaWx1cmVNZXNzYWdlLFxuICAgICAgc3RhdHVzLFxuICAgICAgd29ya2VySWQ6IG51bGxcbiAgICB9XG5cbiAgICBpZiAocXVldWVkQ29uY3VycmVuY3kpIHtcbiAgICAgIHRyYW5zaXRpb25lZEpvYi5jb25jdXJyZW5jeUtleSA9IHF1ZXVlZENvbmN1cnJlbmN5LmNvbmN1cnJlbmN5S2V5XG4gICAgICB0cmFuc2l0aW9uZWRKb2IubWF4Q29uY3VycmVuY3kgPSBxdWV1ZWRDb25jdXJyZW5jeS5tYXhDb25jdXJyZW5jeVxuICAgIH1cbiAgICBpZiAobWFya09ycGhhbmVkKSB0cmFuc2l0aW9uZWRKb2Iub3JwaGFuZWRBdE1zID0gbm93XG4gICAgaWYgKHNob3VsZFJldHJ5KSB7XG4gICAgICB0cmFuc2l0aW9uZWRKb2Iuc2NoZWR1bGVkQXRNcyA9IHNjaGVkdWxlZEF0XG4gICAgfSBlbHNlIGlmICghbWFya09ycGhhbmVkKSB7XG4gICAgICB0cmFuc2l0aW9uZWRKb2IuZmFpbGVkQXRNcyA9IG5vd1xuICAgIH1cblxuICAgIHJldHVybiB0cmFuc2l0aW9uZWRKb2JcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGZhaWx1cmUgdXBkYXRlLlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIE9wdGlvbnMuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBhcmdzLmZhaWx1cmVNZXNzYWdlIC0gTGFzdCBmYWlsdXJlIG1lc3NhZ2UuXG4gICAqIEBwYXJhbSB7Ym9vbGVhbn0gYXJncy5tYXJrT3JwaGFuZWQgLSBXaGV0aGVyIG1hcmtpbmcgb3JwaGFuZWQuXG4gICAqIEBwYXJhbSB7bnVtYmVyfSBhcmdzLm5leHRBdHRlbXB0IC0gTmV4dCBhdHRlbXB0IGNvdW50LlxuICAgKiBAcGFyYW0ge251bWJlcn0gYXJncy5ub3cgLSBDdXJyZW50IHRpbWVzdGFtcC5cbiAgICogQHBhcmFtIHtCYWNrZ3JvdW5kSm9iUXVldWVkQ29uY3VycmVuY3kgfCBudWxsfSBhcmdzLnF1ZXVlZENvbmN1cnJlbmN5IC0gQ3VycmVudCBxdWV1ZSBwb2xpY3kgZm9yIGEgcmV0cnkuXG4gICAqIEBwYXJhbSB7bnVtYmVyIHwgbnVsbH0gYXJncy5zY2hlZHVsZWRBdCAtIE5leHQgc2NoZWR1bGVkIHRpbWVzdGFtcC5cbiAgICogQHBhcmFtIHtib29sZWFufSBhcmdzLnNob3VsZFJldHJ5IC0gV2hldGhlciB0aGUgam9iIHNob3VsZCByZXRyeS5cbiAgICogQHJldHVybnMge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gLSBEYXRhYmFzZSB1cGRhdGUgZGF0YS5cbiAgICovXG4gIF9mYWlsdXJlVXBkYXRlKHtmYWlsdXJlTWVzc2FnZSwgbWFya09ycGhhbmVkLCBuZXh0QXR0ZW1wdCwgbm93LCBxdWV1ZWRDb25jdXJyZW5jeSwgc2NoZWR1bGVkQXQsIHNob3VsZFJldHJ5fSkge1xuICAgIC8qKlxuICAgICAqIFVwZGF0ZS5cbiAgICAgKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSAqL1xuICAgIGNvbnN0IHVwZGF0ZSA9IHtcbiAgICAgIGF0dGVtcHRzOiBuZXh0QXR0ZW1wdCxcbiAgICAgIGhhbmRlZF9vZmZfYXRfbXM6IG51bGwsXG4gICAgICB3b3JrZXJfaWQ6IG51bGwsXG4gICAgICBsYXN0X2Vycm9yOiBmYWlsdXJlTWVzc2FnZVxuICAgIH1cblxuICAgIGlmIChxdWV1ZWRDb25jdXJyZW5jeSkge1xuICAgICAgdXBkYXRlLmNvbmN1cnJlbmN5X2tleSA9IHF1ZXVlZENvbmN1cnJlbmN5LmNvbmN1cnJlbmN5S2V5XG4gICAgICB1cGRhdGUubWF4X2NvbmN1cnJlbmN5ID0gcXVldWVkQ29uY3VycmVuY3kubWF4Q29uY3VycmVuY3lcbiAgICB9XG4gICAgdGhpcy5fYXBwbHlPcnBoYW5lZEZhaWx1cmVVcGRhdGUoe21hcmtPcnBoYW5lZCwgbm93LCB1cGRhdGV9KVxuICAgIHRoaXMuX2FwcGx5RmFpbHVyZVN0YXR1c1VwZGF0ZSh7bWFya09ycGhhbmVkLCBub3csIHNjaGVkdWxlZEF0LCBzaG91bGRSZXRyeSwgdXBkYXRlfSlcblxuICAgIHJldHVybiB1cGRhdGVcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGFwcGx5IG9ycGhhbmVkIGZhaWx1cmUgdXBkYXRlLlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIE9wdGlvbnMuXG4gICAqIEBwYXJhbSB7Ym9vbGVhbn0gYXJncy5tYXJrT3JwaGFuZWQgLSBXaGV0aGVyIG1hcmtpbmcgb3JwaGFuZWQuXG4gICAqIEBwYXJhbSB7bnVtYmVyfSBhcmdzLm5vdyAtIEN1cnJlbnQgdGltZXN0YW1wLlxuICAgKiBAcGFyYW0ge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gYXJncy51cGRhdGUgLSBEYXRhYmFzZSB1cGRhdGUgZGF0YS5cbiAgICogQHJldHVybnMge3ZvaWR9XG4gICAqL1xuICBfYXBwbHlPcnBoYW5lZEZhaWx1cmVVcGRhdGUoe21hcmtPcnBoYW5lZCwgbm93LCB1cGRhdGV9KSB7XG4gICAgaWYgKG1hcmtPcnBoYW5lZCkgdXBkYXRlLm9ycGhhbmVkX2F0X21zID0gbm93XG4gIH1cblxuICAvKipcbiAgICogUnVucyBhcHBseSBmYWlsdXJlIHN0YXR1cyB1cGRhdGUuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gT3B0aW9ucy5cbiAgICogQHBhcmFtIHtib29sZWFufSBhcmdzLm1hcmtPcnBoYW5lZCAtIFdoZXRoZXIgbWFya2luZyBvcnBoYW5lZC5cbiAgICogQHBhcmFtIHtudW1iZXJ9IGFyZ3Mubm93IC0gQ3VycmVudCB0aW1lc3RhbXAuXG4gICAqIEBwYXJhbSB7bnVtYmVyIHwgbnVsbH0gYXJncy5zY2hlZHVsZWRBdCAtIE5leHQgc2NoZWR1bGVkIHRpbWVzdGFtcC5cbiAgICogQHBhcmFtIHtib29sZWFufSBhcmdzLnNob3VsZFJldHJ5IC0gV2hldGhlciB0aGUgam9iIHNob3VsZCByZXRyeS5cbiAgICogQHBhcmFtIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59IGFyZ3MudXBkYXRlIC0gRGF0YWJhc2UgdXBkYXRlIGRhdGEuXG4gICAqIEByZXR1cm5zIHt2b2lkfVxuICAgKi9cbiAgX2FwcGx5RmFpbHVyZVN0YXR1c1VwZGF0ZSh7bWFya09ycGhhbmVkLCBub3csIHNjaGVkdWxlZEF0LCBzaG91bGRSZXRyeSwgdXBkYXRlfSkge1xuICAgIGlmIChzaG91bGRSZXRyeSkge1xuICAgICAgdXBkYXRlLnN0YXR1cyA9IFwicXVldWVkXCJcbiAgICAgIHVwZGF0ZS5zY2hlZHVsZWRfYXRfbXMgPSBzY2hlZHVsZWRBdFxuICAgICAgcmV0dXJuXG4gICAgfVxuXG4gICAgaWYgKG1hcmtPcnBoYW5lZCkge1xuICAgICAgdXBkYXRlLnN0YXR1cyA9IFwib3JwaGFuZWRcIlxuICAgICAgcmV0dXJuXG4gICAgfVxuXG4gICAgdXBkYXRlLnN0YXR1cyA9IFwiZmFpbGVkXCJcbiAgICB1cGRhdGUuZmFpbGVkX2F0X21zID0gbm93XG4gIH1cblxuICAvKipcbiAgICogUnVucyBub3JtYWxpemUgam9iIHJvdy5cbiAgICogQHBhcmFtIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59IHJvdyAtIFJhdyBkYXRhYmFzZSByb3cuXG4gICAqIEByZXR1cm5zIHtpbXBvcnQoXCIuL3R5cGVzLmpzXCIpLkJhY2tncm91bmRKb2JSb3d9IC0gTm9ybWFsaXplZCBqb2Igcm93LlxuICAgKi9cbiAgX25vcm1hbGl6ZUpvYlJvdyhyb3cpIHtcbiAgICBjb25zdCBoYW5kb2ZmSWQgPSByb3cuaGFuZG9mZl9pZCA/IFN0cmluZyhyb3cuaGFuZG9mZl9pZCkgOiBudWxsXG4gICAgLy8gYGV4ZWN1dGlvbl9tb2RlYCBpcyB0aGUgc2luZ2xlIHNvdXJjZSBvZiB0cnV0aCBmb3IgYSBqb2IncyBydW50aW1lIGFuZCBpc1xuICAgIC8vIHdyaXR0ZW4gb24gZXZlcnkgZW5xdWV1ZTsgdGhlIGRyb3AtZm9ya2VkIG1pZ3JhdGlvbiBiYWNrZmlsbHMgYW55IHByZS1leGlzdGluZ1xuICAgIC8vIHJvd3MgYmVmb3JlIHRoZSBsZWdhY3kgYGZvcmtlZGAgY29sdW1uIGlzIHJlbW92ZWQuXG4gICAgY29uc3QgZXhlY3V0aW9uTW9kZSA9IHJvdy5leGVjdXRpb25fbW9kZSA/IHRoaXMuX25vcm1hbGl6ZUV4ZWN1dGlvbk1vZGVOYW1lKFN0cmluZyhyb3cuZXhlY3V0aW9uX21vZGUpKSA6IERFRkFVTFRfQkFDS0dST1VORF9KT0JfRVhFQ1VUSU9OX01PREVcblxuICAgIHJldHVybiB7XG4gICAgICBpZDogU3RyaW5nKHJvdy5pZCksXG4gICAgICBqb2JOYW1lOiBTdHJpbmcocm93LmpvYl9uYW1lKSxcbiAgICAgIGFyZ3M6IHRoaXMuX3BhcnNlQXJncyhyb3cuYXJnc19qc29uKSxcbiAgICAgIGV4ZWN1dGlvbk1vZGUsXG4gICAgICBxdWV1ZTogcm93LnF1ZXVlID8gU3RyaW5nKHJvdy5xdWV1ZSkgOiBERUZBVUxUX0JBQ0tHUk9VTkRfSk9CX1FVRVVFLFxuICAgICAgc2NoZWR1bGVLZXk6IHJvdy5zY2hlZHVsZV9rZXkgPyBTdHJpbmcocm93LnNjaGVkdWxlX2tleSkgOiBudWxsLFxuICAgICAgc3RhdHVzOiByb3cuc3RhdHVzID8gU3RyaW5nKHJvdy5zdGF0dXMpIDogXCJxdWV1ZWRcIixcbiAgICAgIGF0dGVtcHRzOiB0aGlzLl9ub3JtYWxpemVOdW1iZXIocm93LmF0dGVtcHRzKSxcbiAgICAgIG1heFJldHJpZXM6IHRoaXMuX25vcm1hbGl6ZU51bWJlcihyb3cubWF4X3JldHJpZXMpLFxuICAgICAgc2NoZWR1bGVkQXRNczogdGhpcy5fbm9ybWFsaXplTnVtYmVyKHJvdy5zY2hlZHVsZWRfYXRfbXMpLFxuICAgICAgY3JlYXRlZEF0TXM6IHRoaXMuX25vcm1hbGl6ZU51bWJlcihyb3cuY3JlYXRlZF9hdF9tcyksXG4gICAgICBoYW5kZWRPZmZBdE1zOiB0aGlzLl9ub3JtYWxpemVOdW1iZXIocm93LmhhbmRlZF9vZmZfYXRfbXMpLFxuICAgICAgaGFuZG9mZklkLFxuICAgICAgY29tcGxldGVkQXRNczogdGhpcy5fbm9ybWFsaXplTnVtYmVyKHJvdy5jb21wbGV0ZWRfYXRfbXMpLFxuICAgICAgZmFpbGVkQXRNczogdGhpcy5fbm9ybWFsaXplTnVtYmVyKHJvdy5mYWlsZWRfYXRfbXMpLFxuICAgICAgb3JwaGFuZWRBdE1zOiB0aGlzLl9ub3JtYWxpemVOdW1iZXIocm93Lm9ycGhhbmVkX2F0X21zKSxcbiAgICAgIHdvcmtlcklkOiByb3cud29ya2VyX2lkID8gU3RyaW5nKHJvdy53b3JrZXJfaWQpIDogbnVsbCxcbiAgICAgIGxhc3RFcnJvcjogcm93Lmxhc3RfZXJyb3IgPyBTdHJpbmcocm93Lmxhc3RfZXJyb3IpIDogbnVsbCxcbiAgICAgIGNvbmN1cnJlbmN5S2V5OiByb3cuY29uY3VycmVuY3lfa2V5ID8gU3RyaW5nKHJvdy5jb25jdXJyZW5jeV9rZXkpIDogbnVsbCxcbiAgICAgIG1heENvbmN1cnJlbmN5OiB0aGlzLl9ub3JtYWxpemVOdW1iZXIocm93Lm1heF9jb25jdXJyZW5jeSksXG4gICAgICB0aW1lb3V0TXM6IHRoaXMuX25vcm1hbGl6ZU51bWJlcihyb3cudGltZW91dF9tcylcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogTm9ybWFsaXplcyBhIGpvYidzIHF1ZXVlIG5hbWUsIGRlZmF1bHRpbmcgdG8gXCJkZWZhdWx0XCIuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi90eXBlcy5qc1wiKS5CYWNrZ3JvdW5kSm9iT3B0aW9ucyB8IHVuZGVmaW5lZH0gb3B0aW9ucyAtIEpvYiBvcHRpb25zLlxuICAgKiBAcmV0dXJucyB7c3RyaW5nfSAtIFF1ZXVlIG5hbWUuXG4gICAqL1xuICBfbm9ybWFsaXplUXVldWUob3B0aW9ucykge1xuICAgIHJldHVybiBub3JtYWxpemVCYWNrZ3JvdW5kSm9iUXVldWUob3B0aW9ucylcbiAgfVxuXG4gIC8qKlxuICAgKiBSZXNvbHZlcyBhIGpvYidzIGR1cmFibGUgY29uY3VycmVuY3kuIEFuIGV4cGxpY2l0IGNvbmN1cnJlbmN5S2V5L21heENvbmN1cnJlbmN5XG4gICAqIHBhaXIgYWx3YXlzIHdpbnMuIE90aGVyd2lzZSwgd2hlbiB0aGUgam9iJ3MgcXVldWUgaGFzIGEgY29uZmlndXJlZCBjYXBcbiAgICogKGBiYWNrZ3JvdW5kSm9icy5xdWV1ZXNbcXVldWVdLm1heENvbmN1cnJlbnRgKSwgZGVyaXZlIGEgcXVldWUtc2NvcGVkXG4gICAqIGNvbmN1cnJlbmN5IGtleSBzbyB0aGUgcXVldWUgY2FwIGlzIGVuZm9yY2VkIGNsdXN0ZXItd2lkZSB0aHJvdWdoIHRoZVxuICAgKiBleGlzdGluZyBkdXJhYmxlIGNvbmN1cnJlbmN5IG1lY2hhbmlzbS5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL3R5cGVzLmpzXCIpLkJhY2tncm91bmRKb2JPcHRpb25zIHwgdW5kZWZpbmVkfSBvcHRpb25zIC0gSm9iIG9wdGlvbnMuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBxdWV1ZSAtIE5vcm1hbGl6ZWQgcXVldWUgbmFtZS5cbiAgICogQHJldHVybnMge3tjb25jdXJyZW5jeUtleTogc3RyaW5nLCBtYXhDb25jdXJyZW5jeTogbnVtYmVyLCBxdWV1ZURlcml2ZWQ6IGJvb2xlYW59IHwgbnVsbH0gLSBSZXNvbHZlZCBjb25jdXJyZW5jeS5cbiAgICovXG4gIF9yZXNvbHZlQ29uY3VycmVuY3kob3B0aW9ucywgcXVldWUpIHtcbiAgICByZXR1cm4gbm9ybWFsaXplQmFja2dyb3VuZEpvYkNvbmN1cnJlbmN5KHtcbiAgICAgIG9wdGlvbnM6IG9wdGlvbnMgfHwge30sXG4gICAgICBxdWV1ZSxcbiAgICAgIHF1ZXVlczogdGhpcy5jb25maWd1cmF0aW9uLmdldEJhY2tncm91bmRKb2JzQ29uZmlnKCkucXVldWVzXG4gICAgfSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSZXNvbHZlcyB0aGUgY3VycmVudCBjb25jdXJyZW5jeSBwb2xpY3kgZm9yIGEgdHJhbnNpdGlvbiBiYWNrIHRvIHF1ZXVlZC5cbiAgICogRXhwbGljaXQgY29uY3VycmVuY3kgcmVtYWlucyBvd25lZCBieSB0aGUgZW5xdWV1ZSByZXF1ZXN0OyBxdWV1ZS1kZXJpdmVkXG4gICAqIGNvbmN1cnJlbmN5IGFkb3B0cyB0aGUgcXVldWUncyBjdXJyZW50IGNhcCBvciByZW1vdmFsLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL2RhdGFiYXNlL2RyaXZlcnMvYmFzZS5qc1wiKS5kZWZhdWx0fSBkYiAtIERhdGFiYXNlIGNvbm5lY3Rpb24uXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi90eXBlcy5qc1wiKS5CYWNrZ3JvdW5kSm9iUm93fSBqb2IgLSBBY3RpdmUgaGFuZG9mZiBzbmFwc2hvdC5cbiAgICogQHJldHVybnMge1Byb21pc2U8QmFja2dyb3VuZEpvYlF1ZXVlZENvbmN1cnJlbmN5Pn0gLSBDdXJyZW50IHF1ZXVlZCBjb25jdXJyZW5jeS5cbiAgICovXG4gIGFzeW5jIF9yZXF1ZXVlZEpvYkNvbmN1cnJlbmN5KGRiLCBqb2IpIHtcbiAgICBpZiAoam9iLmNvbmN1cnJlbmN5S2V5ICYmICFqb2IuY29uY3VycmVuY3lLZXkuc3RhcnRzV2l0aChRVUVVRV9DT05DVVJSRU5DWV9LRVlfUFJFRklYKSkge1xuICAgICAgcmV0dXJuIHtjb25jdXJyZW5jeUtleTogam9iLmNvbmN1cnJlbmN5S2V5LCBtYXhDb25jdXJyZW5jeTogam9iLm1heENvbmN1cnJlbmN5fVxuICAgIH1cblxuICAgIGNvbnN0IGNvbmN1cnJlbmN5ID0gdGhpcy5fcmVzb2x2ZUNvbmN1cnJlbmN5KHt9LCBqb2IucXVldWUpXG5cbiAgICBpZiAoIWNvbmN1cnJlbmN5KSByZXR1cm4ge2NvbmN1cnJlbmN5S2V5OiBudWxsLCBtYXhDb25jdXJyZW5jeTogbnVsbH1cblxuICAgIGF3YWl0IHRoaXMuX2Vuc3VyZVF1ZXVlQ29uY3VycmVuY3lLZXkoZGIsIGNvbmN1cnJlbmN5KVxuXG4gICAgcmV0dXJuIHtjb25jdXJyZW5jeUtleTogY29uY3VycmVuY3kuY29uY3VycmVuY3lLZXksIG1heENvbmN1cnJlbmN5OiBjb25jdXJyZW5jeS5tYXhDb25jdXJyZW5jeX1cbiAgfVxuXG4gIC8qKlxuICAgKiBSZWFkcyB0aGUgY29uZmlndXJlZCBtYXggY29uY3VycmVuY3kgZm9yIGEgcXVldWUgZnJvbSB0aGUgYmFja2dyb3VuZC1qb2JzIGNvbmZpZy5cbiAgICogQHBhcmFtIHtzdHJpbmd9IHF1ZXVlIC0gUXVldWUgbmFtZS5cbiAgICogQHJldHVybnMge251bWJlciB8IG51bGx9IC0gUG9zaXRpdmUgaW50ZWdlciBjYXAsIG9yIG51bGwgd2hlbiB0aGUgcXVldWUgaGFzIG5vIGNvbmZpZ3VyZWQgY2FwLlxuICAgKi9cbiAgX3F1ZXVlTWF4Q29uY3VycmVuY3kocXVldWUpIHtcbiAgICBjb25zdCBxdWV1ZXMgPSB0aGlzLmNvbmZpZ3VyYXRpb24uZ2V0QmFja2dyb3VuZEpvYnNDb25maWcoKS5xdWV1ZXNcbiAgICBjb25zdCBjYXAgPSBxdWV1ZXM/LltxdWV1ZV0/Lm1heENvbmN1cnJlbnRcblxuICAgIGlmIChOdW1iZXIuaXNJbnRlZ2VyKGNhcCkgJiYgTnVtYmVyKGNhcCkgPiAwKSByZXR1cm4gTnVtYmVyKGNhcClcblxuICAgIHJldHVybiBudWxsXG4gIH1cblxuICAvKipcbiAgICogTGlrZSB7QGxpbmsgX2Vuc3VyZUNvbmN1cnJlbmN5S2V5fSwgYnV0IGZvciBxdWV1ZS1kZXJpdmVkIGtleXMgdGhlIGNvbmZpZ3VyZWRcbiAgICogcXVldWUgY2FwIGlzIHRoZSBzb3VyY2Ugb2YgdHJ1dGg6IGlmIGl0IGNoYW5nZWQsIHVwZGF0ZSB0aGUgc3RvcmVkIGNhcFxuICAgKiBpbnN0ZWFkIG9mIHRocm93aW5nIG9uIGNvbmZsaWN0IChjb25maWctZHJpdmVuIGNhcHMgbXVzdCBiZSB0dW5hYmxlKS5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9kYXRhYmFzZS9kcml2ZXJzL2Jhc2UuanNcIikuZGVmYXVsdH0gZGIgLSBEYXRhYmFzZSBjb25uZWN0aW9uLlxuICAgKiBAcGFyYW0ge3tjb25jdXJyZW5jeUtleTogc3RyaW5nLCBtYXhDb25jdXJyZW5jeTogbnVtYmVyfX0gY29uY3VycmVuY3kgLSBDb25jdXJyZW5jeSBjb25maWd1cmF0aW9uLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyB3aGVuIGVuc3VyZWQuXG4gICAqL1xuICBhc3luYyBfZW5zdXJlUXVldWVDb25jdXJyZW5jeUtleShkYiwge2NvbmN1cnJlbmN5S2V5LCBtYXhDb25jdXJyZW5jeX0pIHtcbiAgICBjb25zdCByb3dzID0gYXdhaXQgZGIubmV3UXVlcnkoKS5mcm9tKENPTkNVUlJFTkNZX1RBQkxFKS53aGVyZSh7Y29uY3VycmVuY3lfa2V5OiBjb25jdXJyZW5jeUtleX0pLmxpbWl0KDEpLnJlc3VsdHMoKVxuXG4gICAgaWYgKCFyb3dzWzBdKSB7XG4gICAgICB0cnkge1xuICAgICAgICBhd2FpdCBkYi5pbnNlcnQoe3RhYmxlTmFtZTogQ09OQ1VSUkVOQ1lfVEFCTEUsIGRhdGE6IHthY3RpdmVfY291bnQ6IDAsIGNvbmN1cnJlbmN5X2tleTogY29uY3VycmVuY3lLZXksIG1heF9jb25jdXJyZW5jeTogbWF4Q29uY3VycmVuY3l9fSlcblxuICAgICAgICByZXR1cm5cbiAgICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICAgIGNvbnN0IHJhY2VkUm93cyA9IGF3YWl0IGRiLm5ld1F1ZXJ5KCkuZnJvbShDT05DVVJSRU5DWV9UQUJMRSkud2hlcmUoe2NvbmN1cnJlbmN5X2tleTogY29uY3VycmVuY3lLZXl9KS5saW1pdCgxKS5yZXN1bHRzKClcblxuICAgICAgICBpZiAoIXJhY2VkUm93c1swXSkgdGhyb3cgZXJyb3JcblxuICAgICAgICByb3dzWzBdID0gcmFjZWRSb3dzWzBdXG4gICAgICB9XG4gICAgfVxuXG4gICAgY29uc3QgY29uZmlndXJlZCA9IC8qKiBAdHlwZSB7e21heF9jb25jdXJyZW5jeT86IG51bWJlciB8IHN0cmluZ319ICovIChyb3dzWzBdKVxuXG4gICAgaWYgKHRoaXMuX25vcm1hbGl6ZU51bWJlcihjb25maWd1cmVkLm1heF9jb25jdXJyZW5jeSkgIT09IG1heENvbmN1cnJlbmN5KSB7XG4gICAgICBjb25zdCB0YWJsZSA9IGRiLnF1b3RlVGFibGUoQ09OQ1VSUkVOQ1lfVEFCTEUpXG5cbiAgICAgIGF3YWl0IGRiLnF1ZXJ5KGBVUERBVEUgJHt0YWJsZX0gU0VUICR7ZGIucXVvdGVDb2x1bW4oXCJtYXhfY29uY3VycmVuY3lcIil9ID0gJHtOdW1iZXIobWF4Q29uY3VycmVuY3kpfSBXSEVSRSAke2RiLnF1b3RlQ29sdW1uKFwiY29uY3VycmVuY3lfa2V5XCIpfSA9ICR7ZGIucXVvdGUoY29uY3VycmVuY3lLZXkpfWApXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIEVuc3VyZXMgdGhlIGNvbmN1cnJlbmN5IHN0YXRlIHRhYmxlIGV4aXN0cy5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9kYXRhYmFzZS9kcml2ZXJzL2Jhc2UuanNcIikuZGVmYXVsdH0gZGIgLSBEYXRhYmFzZSBjb25uZWN0aW9uLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyB3aGVuIHJlYWR5LlxuICAgKi9cbiAgYXN5bmMgX2Vuc3VyZUNvbmN1cnJlbmN5VGFibGUoZGIpIHtcbiAgICBpZiAoYXdhaXQgZGIudGFibGVFeGlzdHMoQ09OQ1VSUkVOQ1lfVEFCTEUpKSByZXR1cm5cbiAgICBjb25zdCB0YWJsZSA9IG5ldyBUYWJsZURhdGEoQ09OQ1VSUkVOQ1lfVEFCTEUsIHtpZk5vdEV4aXN0czogdHJ1ZX0pXG4gICAgdGFibGUuc3RyaW5nKFwiY29uY3VycmVuY3lfa2V5XCIsIHtwcmltYXJ5S2V5OiB0cnVlfSlcbiAgICB0YWJsZS5pbnRlZ2VyKFwibWF4X2NvbmN1cnJlbmN5XCIsIHtudWxsOiBmYWxzZX0pXG4gICAgdGFibGUuaW50ZWdlcihcImFjdGl2ZV9jb3VudFwiLCB7bnVsbDogZmFsc2V9KVxuICAgIGF3YWl0IGRiLmNyZWF0ZVRhYmxlKHRhYmxlKVxuICB9XG5cbiAgLyoqXG4gICAqIEVuc3VyZXMgdGhlIHN0YWJsZSBzY2hlZHVsZS1rZXkgb3duZXJzaGlwIHRhYmxlIGV4aXN0cy5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9kYXRhYmFzZS9kcml2ZXJzL2Jhc2UuanNcIikuZGVmYXVsdH0gZGIgLSBEYXRhYmFzZSBjb25uZWN0aW9uLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyB3aGVuIHJlYWR5LlxuICAgKi9cbiAgYXN5bmMgX2Vuc3VyZVNjaGVkdWxlS2V5c1RhYmxlKGRiKSB7XG4gICAgaWYgKGF3YWl0IGRiLnRhYmxlRXhpc3RzKFNDSEVEVUxFX0tFWVNfVEFCTEUpKSByZXR1cm5cblxuICAgIGNvbnN0IGxvY2tOYW1lID0gYCR7TUlHUkFUSU9OX1NDT1BFfTpzY2hlZHVsZV9rZXlzX3RhYmxlYFxuICAgIGNvbnN0IGFjcXVpcmVkID0gYXdhaXQgZGIuYWNxdWlyZUFkdmlzb3J5TG9jayhsb2NrTmFtZSlcblxuICAgIGlmICghYWNxdWlyZWQpIHRocm93IG5ldyBFcnJvcihcIkZhaWxlZCB0byBhY3F1aXJlIGJhY2tncm91bmQgam9icyBzY2hlZHVsZS1rZXkgdGFibGUgc2NoZW1hIGxvY2tcIilcblxuICAgIHRyeSB7XG4gICAgICBkYi5jbGVhclNjaGVtYUNhY2hlKClcbiAgICAgIGlmIChhd2FpdCBkYi50YWJsZUV4aXN0cyhTQ0hFRFVMRV9LRVlTX1RBQkxFKSkgcmV0dXJuXG5cbiAgICAgIGNvbnN0IHRhYmxlID0gbmV3IFRhYmxlRGF0YShTQ0hFRFVMRV9LRVlTX1RBQkxFLCB7aWZOb3RFeGlzdHM6IHRydWV9KVxuXG4gICAgICB0YWJsZS5zdHJpbmcoXCJzY2hlZHVsZV9rZXlcIiwge3ByaW1hcnlLZXk6IHRydWV9KVxuICAgICAgdGFibGUuc3RyaW5nKFwiam9iX2lkXCIsIHtudWxsOiBmYWxzZSwgaW5kZXg6IHRydWV9KVxuICAgICAgYXdhaXQgZGIuY3JlYXRlVGFibGUodGFibGUpXG4gICAgICBkYi5jbGVhclNjaGVtYUNhY2hlKClcbiAgICB9IGZpbmFsbHkge1xuICAgICAgYXdhaXQgZGIucmVsZWFzZUFkdmlzb3J5TG9jayhsb2NrTmFtZSlcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogRW5zdXJlcyBkdXJhYmxlIGdlbmVyaWMgZW5xdWV1ZSBvd25lcnNoaXAgZXhpc3RzIGluZGVwZW5kZW50bHkgb2Ygam9iIHJvd3MuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vZGF0YWJhc2UvZHJpdmVycy9iYXNlLmpzXCIpLmRlZmF1bHR9IGRiIC0gRGF0YWJhc2UgY29ubmVjdGlvbi5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgd2hlbiByZWFkeS5cbiAgICovXG4gIGFzeW5jIF9lbnN1cmVJZGVtcG90ZW5jeUtleXNUYWJsZShkYikge1xuICAgIGlmIChhd2FpdCBkYi50YWJsZUV4aXN0cyhJREVNUE9URU5DWV9LRVlTX1RBQkxFKSkgcmV0dXJuXG5cbiAgICBjb25zdCBsb2NrTmFtZSA9IGAke01JR1JBVElPTl9TQ09QRX06aWRlbXBvdGVuY3lfa2V5c190YWJsZWBcbiAgICBjb25zdCBhY3F1aXJlZCA9IGF3YWl0IGRiLmFjcXVpcmVBZHZpc29yeUxvY2sobG9ja05hbWUpXG5cbiAgICBpZiAoIWFjcXVpcmVkKSB0aHJvdyBuZXcgRXJyb3IoXCJGYWlsZWQgdG8gYWNxdWlyZSBiYWNrZ3JvdW5kIGpvYiBpZGVtcG90ZW5jeS1rZXkgdGFibGUgc2NoZW1hIGxvY2tcIilcblxuICAgIHRyeSB7XG4gICAgICBkYi5jbGVhclNjaGVtYUNhY2hlKClcbiAgICAgIGlmIChhd2FpdCBkYi50YWJsZUV4aXN0cyhJREVNUE9URU5DWV9LRVlTX1RBQkxFKSkgcmV0dXJuXG5cbiAgICAgIGNvbnN0IHRhYmxlID0gbmV3IFRhYmxlRGF0YShJREVNUE9URU5DWV9LRVlTX1RBQkxFLCB7aWZOb3RFeGlzdHM6IHRydWV9KVxuXG4gICAgICB0YWJsZS5zdHJpbmcoXCJzY29wZV9kaWdlc3RcIiwge3ByaW1hcnlLZXk6IHRydWV9KVxuICAgICAgdGFibGUuc3RyaW5nKFwiam9iX25hbWVcIiwge251bGw6IGZhbHNlfSlcbiAgICAgIHRhYmxlLnN0cmluZyhcInF1ZXVlXCIsIHtudWxsOiBmYWxzZX0pXG4gICAgICB0YWJsZS50ZXh0KFwiaWRlbXBvdGVuY3lfa2V5XCIsIHtudWxsOiBmYWxzZX0pXG4gICAgICB0YWJsZS5zdHJpbmcoXCJqb2JfaWRcIiwge2luZGV4OiB0cnVlLCBudWxsOiBmYWxzZX0pXG4gICAgICB0YWJsZS5zdHJpbmcoXCJyZXF1ZXN0X2RpZ2VzdFwiLCB7bnVsbDogZmFsc2V9KVxuICAgICAgdGFibGUuYmlnaW50KFwiY3JlYXRlZF9hdF9tc1wiLCB7bnVsbDogZmFsc2V9KVxuICAgICAgYXdhaXQgZGIuY3JlYXRlVGFibGUodGFibGUpXG4gICAgICBkYi5jbGVhclNjaGVtYUNhY2hlKClcbiAgICB9IGZpbmFsbHkge1xuICAgICAgYXdhaXQgZGIucmVsZWFzZUFkdmlzb3J5TG9jayhsb2NrTmFtZSlcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogRW5zdXJlcyBkdXJhYmxlIHByb3ZpZGVyLWJhY2tlZCBtYWlsIG9wZXJhdGlvbiBzdGF0ZSBleGlzdHMgaW5kZXBlbmRlbnRseSBvZiBqb2JzLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL2RhdGFiYXNlL2RyaXZlcnMvYmFzZS5qc1wiKS5kZWZhdWx0fSBkYiAtIERhdGFiYXNlIGNvbm5lY3Rpb24uXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIHdoZW4gcmVhZHkuXG4gICAqL1xuICBhc3luYyBfZW5zdXJlTWFpbERlbGl2ZXJ5T3BlcmF0aW9uc1RhYmxlKGRiKSB7XG4gICAgaWYgKGF3YWl0IGRiLnRhYmxlRXhpc3RzKE1BSUxfREVMSVZFUllfT1BFUkFUSU9OU19UQUJMRSkpIHJldHVyblxuXG4gICAgY29uc3QgbG9ja05hbWUgPSBgJHtNSUdSQVRJT05fU0NPUEV9Om1haWxfZGVsaXZlcnlfb3BlcmF0aW9uc190YWJsZWBcbiAgICBjb25zdCBhY3F1aXJlZCA9IGF3YWl0IGRiLmFjcXVpcmVBZHZpc29yeUxvY2sobG9ja05hbWUpXG5cbiAgICBpZiAoIWFjcXVpcmVkKSB0aHJvdyBuZXcgRXJyb3IoXCJGYWlsZWQgdG8gYWNxdWlyZSBtYWlsIGRlbGl2ZXJ5IG9wZXJhdGlvbiB0YWJsZSBzY2hlbWEgbG9ja1wiKVxuXG4gICAgdHJ5IHtcbiAgICAgIGRiLmNsZWFyU2NoZW1hQ2FjaGUoKVxuICAgICAgaWYgKGF3YWl0IGRiLnRhYmxlRXhpc3RzKE1BSUxfREVMSVZFUllfT1BFUkFUSU9OU19UQUJMRSkpIHJldHVyblxuXG4gICAgICBjb25zdCB0YWJsZSA9IG5ldyBUYWJsZURhdGEoTUFJTF9ERUxJVkVSWV9PUEVSQVRJT05TX1RBQkxFLCB7aWZOb3RFeGlzdHM6IHRydWV9KVxuXG4gICAgICB0YWJsZS5zdHJpbmcoXCJvcGVyYXRpb25fa2V5XCIsIHtwcmltYXJ5S2V5OiB0cnVlfSlcbiAgICAgIHRhYmxlLnRleHQoXCJvcGVyYXRpb25faWRcIiwge251bGw6IGZhbHNlfSlcbiAgICAgIHRhYmxlLnN0cmluZyhcInBheWxvYWRfZGlnZXN0XCIsIHtudWxsOiBmYWxzZX0pXG4gICAgICB0YWJsZS5zdHJpbmcoXCJiYWNrZ3JvdW5kX2pvYl9pZFwiLCB7aW5kZXg6IHRydWUsIG51bGw6IGZhbHNlfSlcbiAgICAgIHRhYmxlLmJpZ2ludChcImZpcnN0X2F0dGVtcHRfc3RhcnRlZF9hdF9tc1wiLCB7bnVsbDogdHJ1ZX0pXG4gICAgICB0YWJsZS5zdHJpbmcoXCJwcm92aWRlcl9raW5kXCIsIHtudWxsOiBmYWxzZX0pXG4gICAgICB0YWJsZS5iaWdpbnQoXCJwcm92aWRlcl9yZXRlbnRpb25fbXNcIiwge251bGw6IGZhbHNlfSlcbiAgICAgIHRhYmxlLmJpZ2ludChcImNyZWF0ZWRfYXRfbXNcIiwge251bGw6IGZhbHNlfSlcbiAgICAgIGF3YWl0IGRiLmNyZWF0ZVRhYmxlKHRhYmxlKVxuICAgICAgZGIuY2xlYXJTY2hlbWFDYWNoZSgpXG4gICAgfSBmaW5hbGx5IHtcbiAgICAgIGF3YWl0IGRiLnJlbGVhc2VBZHZpc29yeUxvY2sobG9ja05hbWUpXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIEVuc3VyZXMgdGhlIHNpbmdsZXRvbiBkdXJhYmxlIGNvdW50LXJldmlzaW9uIHJvdyBleGlzdHMuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vZGF0YWJhc2UvZHJpdmVycy9iYXNlLmpzXCIpLmRlZmF1bHR9IGRiIC0gRGF0YWJhc2UgY29ubmVjdGlvbi5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IFJlc29sdmVzIHdoZW4gcmVhZHkuXG4gICAqL1xuICBhc3luYyBfZW5zdXJlQ291bnRSZXZpc2lvblRhYmxlKGRiKSB7XG4gICAgaWYgKCEoYXdhaXQgZGIudGFibGVFeGlzdHMoQ09VTlRTX1JFVklTSU9OX1RBQkxFKSkpIHtcbiAgICAgIGNvbnN0IHRhYmxlID0gbmV3IFRhYmxlRGF0YShDT1VOVFNfUkVWSVNJT05fVEFCTEUsIHtpZk5vdEV4aXN0czogdHJ1ZX0pXG5cbiAgICAgIHRhYmxlLnN0cmluZyhcImtleVwiLCB7cHJpbWFyeUtleTogdHJ1ZX0pXG4gICAgICB0YWJsZS5iaWdpbnQoXCJyZXZpc2lvblwiLCB7bnVsbDogZmFsc2V9KVxuICAgICAgYXdhaXQgZGIuY3JlYXRlVGFibGUodGFibGUpXG4gICAgfVxuXG4gICAgY29uc3Qgcm93cyA9IGF3YWl0IGRiLm5ld1F1ZXJ5KCkuZnJvbShDT1VOVFNfUkVWSVNJT05fVEFCTEUpLndoZXJlKHtrZXk6IENPVU5UU19SRVZJU0lPTl9LRVl9KS5saW1pdCgxKS5yZXN1bHRzKClcblxuICAgIGlmIChyb3dzLmxlbmd0aCA+IDApIHJldHVyblxuXG4gICAgdHJ5IHtcbiAgICAgIGF3YWl0IGRiLmluc2VydCh7dGFibGVOYW1lOiBDT1VOVFNfUkVWSVNJT05fVEFCTEUsIGRhdGE6IHtrZXk6IENPVU5UU19SRVZJU0lPTl9LRVksIHJldmlzaW9uOiAwfX0pXG4gICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgIGNvbnN0IHJhY2VkUm93cyA9IGF3YWl0IGRiLm5ld1F1ZXJ5KCkuZnJvbShDT1VOVFNfUkVWSVNJT05fVEFCTEUpLndoZXJlKHtrZXk6IENPVU5UU19SRVZJU0lPTl9LRVl9KS5saW1pdCgxKS5yZXN1bHRzKClcblxuICAgICAgaWYgKHJhY2VkUm93cy5sZW5ndGggPT09IDApIHRocm93IGVycm9yXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIFJlY29yZHMgb25lIGxvZ2ljYWwgY291bnQgbXV0YXRpb24gYXRvbWljYWxseSBhbmQgYnJvYWRjYXN0cyBpdCBhZnRlciBjb21taXQuXG4gICAqIFplcm8gZW50cmllcyBhcmUgb21pdHRlZDsgYSB3aG9sbHkgemVyby1uZXQgbXV0YXRpb24gZG9lcyBub3QgY29uc3VtZSBhIHJldmlzaW9uLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL2RhdGFiYXNlL2RyaXZlcnMvYmFzZS5qc1wiKS5kZWZhdWx0fSBkYiAtIFRyYW5zYWN0aW9uIGNvbm5lY3Rpb24uXG4gICAqIEBwYXJhbSB7UmVjb3JkPHN0cmluZywgbnVtYmVyPn0gcmVxdWVzdGVkRGVsdGFzIC0gU2lnbmVkIGJ1Y2tldCBjaGFuZ2VzLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gUmVzb2x2ZXMgd2hlbiByZWNvcmRlZC5cbiAgICovXG4gIGFzeW5jIF9yZWNvcmRDb3VudERlbHRhKGRiLCByZXF1ZXN0ZWREZWx0YXMpIHtcbiAgICAvKiogQHR5cGUge1JlY29yZDxzdHJpbmcsIG51bWJlcj59ICovXG4gICAgY29uc3QgZGVsdGFzID0ge31cblxuICAgIGZvciAoY29uc3QgYnVja2V0IG9mIEJBQ0tHUk9VTkRfSk9CX0NPVU5UX0JVQ0tFVFMpIHtcbiAgICAgIGNvbnN0IGFtb3VudCA9IHJlcXVlc3RlZERlbHRhc1tidWNrZXRdIHx8IDBcblxuICAgICAgaWYgKCFOdW1iZXIuaXNJbnRlZ2VyKGFtb3VudCkpIHRocm93IG5ldyBFcnJvcihgSW52YWxpZCBiYWNrZ3JvdW5kIGpvYiBjb3VudCBkZWx0YSBmb3IgJHtidWNrZXR9OiAke2Ftb3VudH1gKVxuICAgICAgaWYgKGFtb3VudCAhPT0gMCkgZGVsdGFzW2J1Y2tldF0gPSBhbW91bnRcbiAgICB9XG5cbiAgICBpZiAoT2JqZWN0LmtleXMoZGVsdGFzKS5sZW5ndGggPT09IDApIHJldHVyblxuXG4gICAgY29uc3QgdGFibGUgPSBkYi5xdW90ZVRhYmxlKENPVU5UU19SRVZJU0lPTl9UQUJMRSlcbiAgICBjb25zdCByZXZpc2lvbkNvbHVtbiA9IGRiLnF1b3RlQ29sdW1uKFwicmV2aXNpb25cIilcbiAgICBjb25zdCBhZmZlY3RlZFJvd3MgPSBhd2FpdCBkYi5hZmZlY3RlZFJvd3MoXG4gICAgICBgVVBEQVRFICR7dGFibGV9IFNFVCAke3JldmlzaW9uQ29sdW1ufSA9ICR7cmV2aXNpb25Db2x1bW59ICsgMSBXSEVSRSAke2RiLnF1b3RlQ29sdW1uKFwia2V5XCIpfSA9ICR7ZGIucXVvdGUoQ09VTlRTX1JFVklTSU9OX0tFWSl9YFxuICAgIClcblxuICAgIGlmIChhZmZlY3RlZFJvd3MgIT09IDEpIHRocm93IG5ldyBFcnJvcihcIkJhY2tncm91bmQgam9iIGNvdW50IHJldmlzaW9uIHJvdyBpcyBtaXNzaW5nXCIpXG5cbiAgICBjb25zdCByZXZpc2lvbiA9IGF3YWl0IHRoaXMuX2NvdW50UmV2aXNpb24oZGIpXG4gICAgY29uc3QgYm9keSA9IHtkZWx0YXMsIHJldmlzaW9uLCB0eXBlOiBcImJhY2tncm91bmQtam9iLWNvdW50LWRlbHRhXCJ9XG4gICAgY29uc3QgZGF0YWJhc2VJZGVudGlmaWVyID0gdGhpcy5nZXREYXRhYmFzZUlkZW50aWZpZXIoKSB8fCBcImRlZmF1bHRcIlxuXG4gICAgYXdhaXQgZGIuYWZ0ZXJDb21taXQoKCkgPT4ge1xuICAgICAgdGhpcy5jb25maWd1cmF0aW9uLmJyb2FkY2FzdFRvQ2hhbm5lbChCQUNLR1JPVU5EX0pPQl9DT1VOVFNfQ0hBTk5FTCwge2RhdGFiYXNlSWRlbnRpZmllcn0sIGJvZHkpXG4gICAgfSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSZWNvcmRzIGEgdHJhbnNpdGlvbiBiZXR3ZWVuIHBlcnNpc3RlZCBzdGF0dXNlcy5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9kYXRhYmFzZS9kcml2ZXJzL2Jhc2UuanNcIikuZGVmYXVsdH0gZGIgLSBUcmFuc2FjdGlvbiBjb25uZWN0aW9uLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gb2xkU3RhdHVzIC0gUHJldmlvdXMgc3RhdHVzLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gbmV3U3RhdHVzIC0gTmV3IHN0YXR1cy5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IFJlc29sdmVzIHdoZW4gcmVjb3JkZWQuXG4gICAqL1xuICBhc3luYyBfcmVjb3JkU3RhdHVzVHJhbnNpdGlvbihkYiwgb2xkU3RhdHVzLCBuZXdTdGF0dXMpIHtcbiAgICBjb25zdCBvbGRDb3VudGVkID0gQ09VTlRFRF9KT0JfU1RBVFVTRVMuaW5jbHVkZXMob2xkU3RhdHVzKVxuICAgIGNvbnN0IG5ld0NvdW50ZWQgPSBDT1VOVEVEX0pPQl9TVEFUVVNFUy5pbmNsdWRlcyhuZXdTdGF0dXMpXG5cbiAgICBpZiAoIW9sZENvdW50ZWQgJiYgb2xkU3RhdHVzICE9PSBcImNhbmNlbGxlZFwiKSB0aHJvdyBuZXcgRXJyb3IoYFVua25vd24gcHJldmlvdXMgYmFja2dyb3VuZCBqb2Igc3RhdHVzOiAke29sZFN0YXR1c31gKVxuICAgIGlmICghbmV3Q291bnRlZCAmJiBuZXdTdGF0dXMgIT09IFwiY2FuY2VsbGVkXCIpIHRocm93IG5ldyBFcnJvcihgVW5rbm93biBuZXh0IGJhY2tncm91bmQgam9iIHN0YXR1czogJHtuZXdTdGF0dXN9YClcbiAgICBpZiAob2xkU3RhdHVzID09PSBuZXdTdGF0dXMpIHJldHVyblxuXG4gICAgLyoqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBudW1iZXI+fSAqL1xuICAgIGNvbnN0IGRlbHRhcyA9IHt9XG5cbiAgICBpZiAob2xkQ291bnRlZCkgZGVsdGFzW29sZFN0YXR1c10gPSAtMVxuICAgIGlmIChuZXdDb3VudGVkKSBkZWx0YXNbbmV3U3RhdHVzXSA9IDFcbiAgICBpZiAob2xkQ291bnRlZCAhPT0gbmV3Q291bnRlZCkgZGVsdGFzLmFsbCA9IG5ld0NvdW50ZWQgPyAxIDogLTFcbiAgICBhd2FpdCB0aGlzLl9yZWNvcmRDb3VudERlbHRhKGRiLCBkZWx0YXMpXG4gIH1cblxuICAvKipcbiAgICogUmVhZHMgdGhlIGxvY2tlZCByZXZpc2lvbi5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9kYXRhYmFzZS9kcml2ZXJzL2Jhc2UuanNcIikuZGVmYXVsdH0gZGIgLSBEYXRhYmFzZSBjb25uZWN0aW9uLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxudW1iZXI+fSBSZXZpc2lvbi5cbiAgICovXG4gIGFzeW5jIF9jb3VudFJldmlzaW9uKGRiKSB7XG4gICAgY29uc3Qgcm93cyA9IGF3YWl0IGRiLm5ld1F1ZXJ5KCkuZnJvbShDT1VOVFNfUkVWSVNJT05fVEFCTEUpLnNlbGVjdChcInJldmlzaW9uXCIpLndoZXJlKHtrZXk6IENPVU5UU19SRVZJU0lPTl9LRVl9KS5saW1pdCgxKS5yZXN1bHRzKClcbiAgICBjb25zdCByZXZpc2lvbiA9IHRoaXMuX25vcm1hbGl6ZU51bWJlcigvKiogQHR5cGUge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gKi8gKHJvd3NbMF0gfHwge30pLnJldmlzaW9uKVxuXG4gICAgaWYgKHJldmlzaW9uID09PSBudWxsIHx8ICFOdW1iZXIuaXNTYWZlSW50ZWdlcihyZXZpc2lvbikgfHwgcmV2aXNpb24gPCAwKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoYEludmFsaWQgYmFja2dyb3VuZCBqb2IgY291bnQgcmV2aXNpb246ICR7cmV2aXNpb259YClcbiAgICB9XG5cbiAgICByZXR1cm4gcmV2aXNpb25cbiAgfVxuXG4gIC8qKlxuICAgKiBUYWtlcyBhIHBvcnRhYmxlIHdyaXRlIGxvY2sgb24gdGhlIHNpbmdsZXRvbiByZXZpc2lvbiByb3cuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vZGF0YWJhc2UvZHJpdmVycy9iYXNlLmpzXCIpLmRlZmF1bHR9IGRiIC0gRGF0YWJhc2UgY29ubmVjdGlvbi5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IFJlc29sdmVzIHdoZW4gbG9ja2VkLlxuICAgKi9cbiAgYXN5bmMgX2xvY2tDb3VudFJldmlzaW9uKGRiKSB7XG4gICAgY29uc3QgdGFibGUgPSBkYi5xdW90ZVRhYmxlKENPVU5UU19SRVZJU0lPTl9UQUJMRSlcbiAgICBjb25zdCByZXZpc2lvbiA9IGRiLnF1b3RlQ29sdW1uKFwicmV2aXNpb25cIilcblxuICAgIGF3YWl0IGRiLnF1ZXJ5KGBVUERBVEUgJHt0YWJsZX0gU0VUICR7cmV2aXNpb259ID0gJHtyZXZpc2lvbn0gV0hFUkUgJHtkYi5xdW90ZUNvbHVtbihcImtleVwiKX0gPSAke2RiLnF1b3RlKENPVU5UU19SRVZJU0lPTl9LRVkpfWApXG4gIH1cblxuICAvKipcbiAgICogQnVpbGRzIHplcm9lZCBjYW5vbmljYWwgYnVja2V0cy5cbiAgICogQHJldHVybnMge1JlY29yZDxzdHJpbmcsIG51bWJlcj59IFplcm9lZCBjYW5vbmljYWwgYnVja2V0cy5cbiAgICovXG4gIF9lbXB0eUNvdW50QnVja2V0cygpIHtcbiAgICByZXR1cm4gT2JqZWN0LmZyb21FbnRyaWVzKEJBQ0tHUk9VTkRfSk9CX0NPVU5UX0JVQ0tFVFMubWFwKChidWNrZXQpID0+IFtidWNrZXQsIDBdKSlcbiAgfVxuXG4gIC8qKlxuICAgKiBDb3VudHMgbm9ybWFsaXplZCByb3dzIGJ5IGNhbm9uaWNhbCBzdGF0dXMuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi90eXBlcy5qc1wiKS5CYWNrZ3JvdW5kSm9iUm93W119IGpvYnMgLSBKb2JzLlxuICAgKiBAcmV0dXJucyB7UmVjb3JkPHN0cmluZywgbnVtYmVyPn0gQ291bnRzLlxuICAgKi9cbiAgX3N0YXR1c0NvdW50cyhqb2JzKSB7XG4gICAgLyoqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBudW1iZXI+fSAqL1xuICAgIGNvbnN0IGNvdW50cyA9IHt9XG5cbiAgICBmb3IgKGNvbnN0IGpvYiBvZiBqb2JzKSB7XG4gICAgICBpZiAoIUNPVU5URURfSk9CX1NUQVRVU0VTLmluY2x1ZGVzKGpvYi5zdGF0dXMpKSB0aHJvdyBuZXcgRXJyb3IoYFVua25vd24gYmFja2dyb3VuZCBqb2Igc3RhdHVzOiAke2pvYi5zdGF0dXN9YClcbiAgICAgIGNvdW50c1tqb2Iuc3RhdHVzXSA9IChjb3VudHNbam9iLnN0YXR1c10gfHwgMCkgKyAxXG4gICAgfVxuXG4gICAgcmV0dXJuIGNvdW50c1xuICB9XG5cbiAgLyoqXG4gICAqIFJlYWRzIGEgY2Fub25pY2FsIHNuYXBzaG90IGFmdGVyIGxvY2tpbmcgdGhlIHJldmlzaW9uIHJvdy5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9kYXRhYmFzZS9kcml2ZXJzL2Jhc2UuanNcIikuZGVmYXVsdH0gZGIgLSBUcmFuc2FjdGlvbiBjb25uZWN0aW9uLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx7Y291bnRzOiBSZWNvcmQ8c3RyaW5nLCBudW1iZXI+LCByZXZpc2lvbjogbnVtYmVyLCB0b3RhbDogbnVtYmVyfT59IFNuYXBzaG90LlxuICAgKi9cbiAgYXN5bmMgX2NvdW50U25hcHNob3RPbkxvY2tlZENvbm5lY3Rpb24oZGIpIHtcbiAgICBjb25zdCByb3dzID0gYXdhaXQgZGIubmV3UXVlcnkoKS5mcm9tKEpPQlNfVEFCTEUpLnNlbGVjdChcInN0YXR1c1wiKS5zZWxlY3QoXCJDT1VOVCgqKSBBUyBjb3VudFwiKS5ncm91cChcInN0YXR1c1wiKS5yZXN1bHRzKClcbiAgICBjb25zdCBjb3VudHMgPSB0aGlzLl9lbXB0eUNvdW50QnVja2V0cygpXG4gICAgbGV0IHRvdGFsID0gMFxuXG4gICAgZm9yIChjb25zdCByb3cgb2Ygcm93cykge1xuICAgICAgY29uc3QgdHlwZWRSb3cgPSAvKiogQHR5cGUge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gKi8gKHJvdylcbiAgICAgIGNvbnN0IHN0YXR1cyA9IFN0cmluZyh0eXBlZFJvdy5zdGF0dXMpXG4gICAgICBjb25zdCBjb3VudCA9IHRoaXMuX25vcm1hbGl6ZU51bWJlcih0eXBlZFJvdy5jb3VudCkgfHwgMFxuXG4gICAgICB0b3RhbCArPSBjb3VudFxuXG4gICAgICBpZiAoIUNPVU5URURfSk9CX1NUQVRVU0VTLmluY2x1ZGVzKHN0YXR1cykpIGNvbnRpbnVlXG4gICAgICBjb3VudHNbc3RhdHVzXSA9IGNvdW50XG4gICAgICBjb3VudHMuYWxsICs9IGNvdW50c1tzdGF0dXNdXG4gICAgfVxuXG4gICAgcmV0dXJuIHtjb3VudHMsIHJldmlzaW9uOiBhd2FpdCB0aGlzLl9jb3VudFJldmlzaW9uKGRiKSwgdG90YWx9XG4gIH1cblxuICAvKipcbiAgICogUmVnaXN0ZXJzIG9yIHZlcmlmaWVzIGEgc3RhYmxlIGtleSBjb25maWd1cmF0aW9uLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL2RhdGFiYXNlL2RyaXZlcnMvYmFzZS5qc1wiKS5kZWZhdWx0fSBkYiAtIERhdGFiYXNlIGNvbm5lY3Rpb24uXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBjb25jdXJyZW5jeSAtIENvbmN1cnJlbmN5IGNvbmZpZ3VyYXRpb24uXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBjb25jdXJyZW5jeS5jb25jdXJyZW5jeUtleSAtIENvbmN1cnJlbmN5IGtleS5cbiAgICogQHBhcmFtIHtudW1iZXJ9IGNvbmN1cnJlbmN5Lm1heENvbmN1cnJlbmN5IC0gU3RhYmxlIGNhcC5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgd2hlbiB2ZXJpZmllZC5cbiAgICovXG4gIGFzeW5jIF9lbnN1cmVDb25jdXJyZW5jeUtleShkYiwge2NvbmN1cnJlbmN5S2V5LCBtYXhDb25jdXJyZW5jeX0pIHtcbiAgICBjb25zdCByb3dzID0gYXdhaXQgZGIubmV3UXVlcnkoKS5mcm9tKENPTkNVUlJFTkNZX1RBQkxFKS53aGVyZSh7Y29uY3VycmVuY3lfa2V5OiBjb25jdXJyZW5jeUtleX0pLmxpbWl0KDEpLnJlc3VsdHMoKVxuICAgIGlmICghcm93c1swXSkge1xuICAgICAgdHJ5IHtcbiAgICAgICAgYXdhaXQgZGIuaW5zZXJ0KHt0YWJsZU5hbWU6IENPTkNVUlJFTkNZX1RBQkxFLCBkYXRhOiB7YWN0aXZlX2NvdW50OiAwLCBjb25jdXJyZW5jeV9rZXk6IGNvbmN1cnJlbmN5S2V5LCBtYXhfY29uY3VycmVuY3k6IG1heENvbmN1cnJlbmN5fX0pXG4gICAgICAgIHJldHVyblxuICAgICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgICAgY29uc3QgcmFjZWRSb3dzID0gYXdhaXQgZGIubmV3UXVlcnkoKS5mcm9tKENPTkNVUlJFTkNZX1RBQkxFKS53aGVyZSh7Y29uY3VycmVuY3lfa2V5OiBjb25jdXJyZW5jeUtleX0pLmxpbWl0KDEpLnJlc3VsdHMoKVxuICAgICAgICBpZiAoIXJhY2VkUm93c1swXSkgdGhyb3cgZXJyb3JcbiAgICAgICAgcm93c1swXSA9IHJhY2VkUm93c1swXVxuICAgICAgfVxuICAgIH1cbiAgICBjb25zdCBjb25maWd1cmVkID0gLyoqIEB0eXBlIHt7bWF4X2NvbmN1cnJlbmN5PzogbnVtYmVyIHwgc3RyaW5nfX0gKi8gKHJvd3NbMF0pXG4gICAgaWYgKHRoaXMuX25vcm1hbGl6ZU51bWJlcihjb25maWd1cmVkLm1heF9jb25jdXJyZW5jeSkgIT09IG1heENvbmN1cnJlbmN5KSB0aHJvdyBuZXcgRXJyb3IoYENvbmZsaWN0aW5nIG1heENvbmN1cnJlbmN5IGZvciBiYWNrZ3JvdW5kIGpvYiBjb25jdXJyZW5jeUtleTogJHtjb25jdXJyZW5jeUtleX1gKVxuICB9XG5cbiAgLyoqXG4gICAqIExvY2tzIHRoZSBjb25jdXJyZW5jeSBjb3VudGVyIHJvdyBzbyBhIGpvYi1yZWxlYXNlIHRyYW5zYWN0aW9uIGFjcXVpcmVzIGl0ICpiZWZvcmUqIHRoZSBqb2JcbiAgICogcm93LiB7QGxpbmsgbWFya0hhbmRlZE9mZn0gcmVzZXJ2ZXMgY2FwYWNpdHkgKGxvY2tpbmcgdGhlIGNvdW50ZXIgcm93KSBiZWZvcmUgaXQgdXBkYXRlcyB0aGVcbiAgICogam9iLCBzbyBpdCBsb2NrcyBjb25jdXJyZW5jeS10aGVuLWpvYjsgdGhlIHJlbGVhc2UgcGF0aHMgdXBkYXRlIHRoZSBqb2IgYmVmb3JlIHJlbGVhc2luZ1xuICAgKiBjYXBhY2l0eSwgd2hpY2ggaXMgam9iLXRoZW4tY29uY3VycmVuY3kuIFRob3NlIG9wcG9zaXRlIG9yZGVycyBvbiB0aGUgc2FtZSBzaGFyZWQgY291bnRlciByb3dcbiAgICogYXJlIHdoYXQgZGVhZGxvY2sgKEFCLUJBKSB1bmRlciBhIGRyYWluaW5nIHdvcmtlci4gVGFraW5nIHRoaXMgbG9jayBmaXJzdCBnaXZlcyBldmVyeVxuICAgKiB0cmFuc2FjdGlvbiBhIHNpbmdsZSBjb25jdXJyZW5jeS10aGVuLWpvYiBvcmRlciBhbmQgcmVtb3ZlcyB0aGUgY3ljbGUuXG4gICAqXG4gICAqIFVzZXMgYSB2YWx1ZS1wcmVzZXJ2aW5nIGBVUERBVEVgIHJhdGhlciB0aGFuIGBTRUxFQ1QgLi4uIEZPUiBVUERBVEVgIHNvIGl0IHN0YXlzIHBvcnRhYmxlXG4gICAqIGFjcm9zcyBkcml2ZXJzIHdpdGhvdXQgcm93LWxldmVsIGxvY2tpbmcgcmVhZHMgKGUuZy4gU1FMaXRlKTsgb24gcm93LWxvY2tpbmcgZW5naW5lcyB0aGVcbiAgICogbWF0Y2hlZCByb3cgaXMgd3JpdGUtbG9ja2VkIGZvciB0aGUgcmVzdCBvZiB0aGUgdHJhbnNhY3Rpb24gZXZlbiB0aG91Z2ggaXRzIHZhbHVlIGlzIHVuY2hhbmdlZC5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9kYXRhYmFzZS9kcml2ZXJzL2Jhc2UuanNcIikuZGVmYXVsdH0gZGIgLSBEYXRhYmFzZSBjb25uZWN0aW9uLlxuICAgKiBAcGFyYW0ge3N0cmluZyB8IG51bGx9IGNvbmN1cnJlbmN5S2V5IC0gQ29uY3VycmVuY3kga2V5LlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyB3aGVuIHRoZSBjb3VudGVyIHJvdyBpcyBsb2NrZWQuXG4gICAqL1xuICBhc3luYyBfbG9ja0NvbmN1cnJlbmN5Um93KGRiLCBjb25jdXJyZW5jeUtleSkge1xuICAgIGlmICghY29uY3VycmVuY3lLZXkpIHJldHVyblxuICAgIGNvbnN0IHRhYmxlID0gZGIucXVvdGVUYWJsZShDT05DVVJSRU5DWV9UQUJMRSlcbiAgICBjb25zdCBjb3VudCA9IGRiLnF1b3RlQ29sdW1uKFwiYWN0aXZlX2NvdW50XCIpXG4gICAgYXdhaXQgZGIucXVlcnkoYFVQREFURSAke3RhYmxlfSBTRVQgJHtjb3VudH0gPSAke2NvdW50fSBXSEVSRSAke2RiLnF1b3RlQ29sdW1uKFwiY29uY3VycmVuY3lfa2V5XCIpfSA9ICR7ZGIucXVvdGUoY29uY3VycmVuY3lLZXkpfWApXG4gIH1cblxuICAvKipcbiAgICogQXRvbWljYWxseSByZXNlcnZlcyBjYXBhY2l0eSBmb3IgYSBrZXkuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vZGF0YWJhc2UvZHJpdmVycy9iYXNlLmpzXCIpLmRlZmF1bHR9IGRiIC0gRGF0YWJhc2UgY29ubmVjdGlvbi5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGNvbmN1cnJlbmN5S2V5IC0gQ29uY3VycmVuY3kga2V5LlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxib29sZWFuPn0gLSBXaGV0aGVyIGNhcGFjaXR5IHdhcyByZXNlcnZlZC5cbiAgICovXG4gIGFzeW5jIF9yZXNlcnZlQ29uY3VycmVuY3koZGIsIGNvbmN1cnJlbmN5S2V5KSB7XG4gICAgY29uc3QgdGFibGUgPSBkYi5xdW90ZVRhYmxlKENPTkNVUlJFTkNZX1RBQkxFKVxuICAgIGNvbnN0IGNvdW50ID0gZGIucXVvdGVDb2x1bW4oXCJhY3RpdmVfY291bnRcIilcbiAgICBjb25zdCBhZmZlY3RlZFJvd3MgPSBhd2FpdCBkYi5hZmZlY3RlZFJvd3MoYFVQREFURSAke3RhYmxlfSBTRVQgJHtjb3VudH0gPSAke2NvdW50fSArIDEgV0hFUkUgJHtkYi5xdW90ZUNvbHVtbihcImNvbmN1cnJlbmN5X2tleVwiKX0gPSAke2RiLnF1b3RlKGNvbmN1cnJlbmN5S2V5KX0gQU5EICR7Y291bnR9IDwgJHtkYi5xdW90ZUNvbHVtbihcIm1heF9jb25jdXJyZW5jeVwiKX1gKVxuICAgIHJldHVybiBhZmZlY3RlZFJvd3MgPT09IDFcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGEgcG9ydGFibGUgdXBkYXRlIGFuZCByZXR1cm5zIGl0cyBhZmZlY3RlZC1yb3cgY291bnQuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vZGF0YWJhc2UvZHJpdmVycy9iYXNlLmpzXCIpLmRlZmF1bHR9IGRiIC0gRGF0YWJhc2UgY29ubmVjdGlvbi5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9kYXRhYmFzZS9kcml2ZXJzL2Jhc2UuanNcIikuVXBkYXRlU3FsQXJnc1R5cGV9IGFyZ3MgLSBVcGRhdGUgb3B0aW9ucy5cbiAgICogQHJldHVybnMge1Byb21pc2U8bnVtYmVyPn0gLSBBZmZlY3RlZCByb3cgY291bnQuXG4gICAqL1xuICBhc3luYyBfdXBkYXRlQWZmZWN0ZWRSb3dzKGRiLCBhcmdzKSB7XG4gICAgcmV0dXJuIGF3YWl0IGRiLmFmZmVjdGVkUm93cyhkYi51cGRhdGVTcWwoYXJncykpXG4gIH1cblxuICAvKipcbiAgICogUmVsZWFzZXMgY2FwYWNpdHkgZm9yIGEga2V5LlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL2RhdGFiYXNlL2RyaXZlcnMvYmFzZS5qc1wiKS5kZWZhdWx0fSBkYiAtIERhdGFiYXNlIGNvbm5lY3Rpb24uXG4gICAqIEBwYXJhbSB7c3RyaW5nIHwgbnVsbH0gY29uY3VycmVuY3lLZXkgLSBDb25jdXJyZW5jeSBrZXkuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIHdoZW4gcmVsZWFzZWQuXG4gICAqL1xuICBhc3luYyBfcmVsZWFzZUNvbmN1cnJlbmN5KGRiLCBjb25jdXJyZW5jeUtleSkge1xuICAgIGlmICghY29uY3VycmVuY3lLZXkpIHJldHVyblxuICAgIGNvbnN0IHRhYmxlID0gZGIucXVvdGVUYWJsZShDT05DVVJSRU5DWV9UQUJMRSlcbiAgICBjb25zdCBjb3VudCA9IGRiLnF1b3RlQ29sdW1uKFwiYWN0aXZlX2NvdW50XCIpXG4gICAgYXdhaXQgZGIucXVlcnkoYFVQREFURSAke3RhYmxlfSBTRVQgJHtjb3VudH0gPSAke2NvdW50fSAtIDEgV0hFUkUgJHtkYi5xdW90ZUNvbHVtbihcImNvbmN1cnJlbmN5X2tleVwiKX0gPSAke2RiLnF1b3RlKGNvbmN1cnJlbmN5S2V5KX0gQU5EICR7Y291bnR9ID4gMGApXG4gIH1cblxuICAvKipcbiAgICogUmVidWlsZHMgZHVyYWJsZSBjb3VudHMgZnJvbSBhY3RpdmUgaGFuZG9mZnMuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vZGF0YWJhc2UvZHJpdmVycy9iYXNlLmpzXCIpLmRlZmF1bHR9IGRiIC0gRGF0YWJhc2UgY29ubmVjdGlvbi5cbiAgICogQHBhcmFtIHt7aW5zaWRlVHJhbnNhY3Rpb24/OiBib29sZWFufX0gW29wdGlvbnNdIC0gUmV1c2UgYW4gZW5jbG9zaW5nIHRyYW5zYWN0aW9uLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxpbXBvcnQoXCIuL3R5cGVzLmpzXCIpLkJhY2tncm91bmRKb2JDb25jdXJyZW5jeVJlY29uY2lsaWF0aW9uPn0gLSBSZXBhaXIgc3VtbWFyeS5cbiAgICovXG4gIGFzeW5jIF9yZWNvbmNpbGVDb25jdXJyZW5jeShkYiwge2luc2lkZVRyYW5zYWN0aW9uID0gZmFsc2V9ID0ge30pIHtcbiAgICBpZiAoIShhd2FpdCBkYi50YWJsZUV4aXN0cyhDT05DVVJSRU5DWV9UQUJMRSkpKSB7XG4gICAgICByZXR1cm4ge2NhbmRpZGF0ZUNvdW50OiAwLCBjaGVja2VkQ291bnQ6IDAsIHJlcGFpcmVkQ291bnQ6IDAsIHJlcGFpcnM6IFtdLCByZXBhaXJzVHJ1bmNhdGVkQ291bnQ6IDB9XG4gICAgfVxuXG4gICAgY29uc3QgYWN0aXZlUm93cyA9IGF3YWl0IGRiXG4gICAgICAubmV3UXVlcnkoKVxuICAgICAgLmZyb20oSk9CU19UQUJMRSlcbiAgICAgIC5zZWxlY3QoXCJjb25jdXJyZW5jeV9rZXlcIilcbiAgICAgIC5zZWxlY3QoXCJDT1VOVCgqKSBBUyBhY3RpdmVfY291bnRcIilcbiAgICAgIC53aGVyZSh7c3RhdHVzOiBcImhhbmRlZF9vZmZcIn0pXG4gICAgICAud2hlcmUoYCR7ZGIucXVvdGVDb2x1bW4oXCJjb25jdXJyZW5jeV9rZXlcIil9IElTIE5PVCBOVUxMYClcbiAgICAgIC5ncm91cChcImNvbmN1cnJlbmN5X2tleVwiKVxuICAgICAgLnJlc3VsdHMoKVxuICAgIGNvbnN0IHN0YWxlUm93cyA9IGF3YWl0IGRiXG4gICAgICAubmV3UXVlcnkoKVxuICAgICAgLmZyb20oQ09OQ1VSUkVOQ1lfVEFCTEUpXG4gICAgICAuc2VsZWN0KFwiY29uY3VycmVuY3lfa2V5XCIpXG4gICAgICAuc2VsZWN0KFwiYWN0aXZlX2NvdW50XCIpXG4gICAgICAud2hlcmUoYCR7ZGIucXVvdGVDb2x1bW4oXCJhY3RpdmVfY291bnRcIil9ICE9IDBgKVxuICAgICAgLnJlc3VsdHMoKVxuICAgIC8qKiBAdHlwZSB7TWFwPHN0cmluZywgbnVtYmVyPn0gKi9cbiAgICBjb25zdCBhY3RpdmVDb3VudHMgPSBuZXcgTWFwKClcbiAgICAvKiogQHR5cGUge01hcDxzdHJpbmcsIG51bWJlcj59ICovXG4gICAgY29uc3QgcGVyc2lzdGVkQ291bnRzID0gbmV3IE1hcCgpXG5cbiAgICBmb3IgKGNvbnN0IHJhd1JvdyBvZiBhY3RpdmVSb3dzKSB7XG4gICAgICBjb25zdCByb3cgPSAvKiogQHR5cGUge0JhY2tncm91bmRKb2JDb25jdXJyZW5jeUNvdW50Um93fSAqLyAocmF3Um93KVxuICAgICAgYWN0aXZlQ291bnRzLnNldChyb3cuY29uY3VycmVuY3lfa2V5LCB0aGlzLl92YWxpZGF0ZWRDb25jdXJyZW5jeUNvdW50KHJvdy5hY3RpdmVfY291bnQsIHJvdy5jb25jdXJyZW5jeV9rZXkpKVxuICAgIH1cblxuICAgIGZvciAoY29uc3QgcmF3Um93IG9mIHN0YWxlUm93cykge1xuICAgICAgY29uc3Qgcm93ID0gLyoqIEB0eXBlIHtCYWNrZ3JvdW5kSm9iQ29uY3VycmVuY3lDb3VudFJvd30gKi8gKHJhd1JvdylcbiAgICAgIHBlcnNpc3RlZENvdW50cy5zZXQocm93LmNvbmN1cnJlbmN5X2tleSwgdGhpcy5fdmFsaWRhdGVkQ29uY3VycmVuY3lDb3VudChyb3cuYWN0aXZlX2NvdW50LCByb3cuY29uY3VycmVuY3lfa2V5KSlcbiAgICB9XG5cbiAgICBjb25zdCBjb25jdXJyZW5jeUtleXMgPSBbLi4ubmV3IFNldChbLi4uYWN0aXZlQ291bnRzLmtleXMoKSwgLi4ucGVyc2lzdGVkQ291bnRzLmtleXMoKV0pXS5zb3J0KClcbiAgICBjb25zdCBjYW5kaWRhdGVLZXlzID0gY29uY3VycmVuY3lLZXlzLmZpbHRlcigoY29uY3VycmVuY3lLZXkpID0+IHtcbiAgICAgIHJldHVybiAoYWN0aXZlQ291bnRzLmdldChjb25jdXJyZW5jeUtleSkgfHwgMCkgIT09IChwZXJzaXN0ZWRDb3VudHMuZ2V0KGNvbmN1cnJlbmN5S2V5KSB8fCAwKVxuICAgIH0pXG4gICAgLyoqIEB0eXBlIHtpbXBvcnQoXCIuL3R5cGVzLmpzXCIpLkJhY2tncm91bmRKb2JDb25jdXJyZW5jeVJlcGFpcltdfSAqL1xuICAgIGNvbnN0IHJlcGFpcnMgPSBbXVxuICAgIGxldCByZXBhaXJlZENvdW50ID0gMFxuXG4gICAgZm9yIChjb25zdCBjb25jdXJyZW5jeUtleSBvZiBjYW5kaWRhdGVLZXlzKSB7XG4gICAgICBjb25zdCByZXBhaXIgPSBpbnNpZGVUcmFuc2FjdGlvblxuICAgICAgICA/IGF3YWl0IHRoaXMuX3JlY29uY2lsZUNvbmN1cnJlbmN5S2V5KGRiLCBjb25jdXJyZW5jeUtleSlcbiAgICAgICAgOiBhd2FpdCB0aGlzLl90cmFuc2FjdGlvblJlc3VsdChkYiwgYXN5bmMgKCkgPT4gYXdhaXQgdGhpcy5fcmVjb25jaWxlQ29uY3VycmVuY3lLZXkoZGIsIGNvbmN1cnJlbmN5S2V5KSlcblxuICAgICAgaWYgKCFyZXBhaXIpIGNvbnRpbnVlXG5cbiAgICAgIHJlcGFpcmVkQ291bnQrK1xuICAgICAgaWYgKHJlcGFpcnMubGVuZ3RoIDwgQ09OQ1VSUkVOQ1lfUkVQQUlSX1NBTVBMRV9MSU1JVCkgcmVwYWlycy5wdXNoKHJlcGFpcilcbiAgICB9XG5cbiAgICByZXR1cm4ge1xuICAgICAgY2FuZGlkYXRlQ291bnQ6IGNhbmRpZGF0ZUtleXMubGVuZ3RoLFxuICAgICAgY2hlY2tlZENvdW50OiBjb25jdXJyZW5jeUtleXMubGVuZ3RoLFxuICAgICAgcmVwYWlyZWRDb3VudCxcbiAgICAgIHJlcGFpcnMsXG4gICAgICByZXBhaXJzVHJ1bmNhdGVkQ291bnQ6IHJlcGFpcmVkQ291bnQgLSByZXBhaXJzLmxlbmd0aFxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBSZWJ1aWxkcyBvbmUgY291bnRlciBhZnRlciBsb2NraW5nIGl0IGFoZWFkIG9mIHRoZSBqb2Igcm93cywgbWF0Y2hpbmcgdGhlXG4gICAqIGxvY2sgb3JkZXIgdXNlZCBieSBoYW5kb2ZmIGFuZCBjb21wbGV0aW9uIHRyYW5zaXRpb25zLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL2RhdGFiYXNlL2RyaXZlcnMvYmFzZS5qc1wiKS5kZWZhdWx0fSBkYiAtIERhdGFiYXNlIGNvbm5lY3Rpb24uXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBjb25jdXJyZW5jeUtleSAtIENvdW50ZXIga2V5LlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxpbXBvcnQoXCIuL3R5cGVzLmpzXCIpLkJhY2tncm91bmRKb2JDb25jdXJyZW5jeVJlcGFpciB8IG51bGw+fSAtIEFwcGxpZWQgcmVwYWlyLlxuICAgKi9cbiAgYXN5bmMgX3JlY29uY2lsZUNvbmN1cnJlbmN5S2V5KGRiLCBjb25jdXJyZW5jeUtleSkge1xuICAgIGF3YWl0IHRoaXMuX2xvY2tDb25jdXJyZW5jeVJvdyhkYiwgY29uY3VycmVuY3lLZXkpXG4gICAgY29uc3QgcGVyc2lzdGVkUm93cyA9IGF3YWl0IGRiXG4gICAgICAubmV3UXVlcnkoKVxuICAgICAgLmZyb20oQ09OQ1VSUkVOQ1lfVEFCTEUpXG4gICAgICAuc2VsZWN0KFwiYWN0aXZlX2NvdW50XCIpXG4gICAgICAuc2VsZWN0KFwiY29uY3VycmVuY3lfa2V5XCIpXG4gICAgICAud2hlcmUoe2NvbmN1cnJlbmN5X2tleTogY29uY3VycmVuY3lLZXl9KVxuICAgICAgLmxpbWl0KDEpXG4gICAgICAucmVzdWx0cygpXG5cbiAgICBpZiAoIXBlcnNpc3RlZFJvd3NbMF0pIHRocm93IG5ldyBFcnJvcihgTWlzc2luZyBiYWNrZ3JvdW5kIGpvYiBjb25jdXJyZW5jeSBjb3VudGVyIGZvciAke2NvbmN1cnJlbmN5S2V5fWApXG5cbiAgICBjb25zdCBwZXJzaXN0ZWRSb3cgPSAvKiogQHR5cGUge0JhY2tncm91bmRKb2JDb25jdXJyZW5jeUNvdW50Um93fSAqLyAocGVyc2lzdGVkUm93c1swXSlcbiAgICBjb25zdCBwcmV2aW91c0FjdGl2ZUNvdW50ID0gdGhpcy5fdmFsaWRhdGVkQ29uY3VycmVuY3lDb3VudChwZXJzaXN0ZWRSb3cuYWN0aXZlX2NvdW50LCBjb25jdXJyZW5jeUtleSlcbiAgICBjb25zdCByb3dzID0gYXdhaXQgZGJcbiAgICAgIC5uZXdRdWVyeSgpXG4gICAgICAuZnJvbShKT0JTX1RBQkxFKVxuICAgICAgLnNlbGVjdChcIkNPVU5UKCopIEFTIGFjdGl2ZV9jb3VudFwiKVxuICAgICAgLndoZXJlKHtjb25jdXJyZW5jeV9rZXk6IGNvbmN1cnJlbmN5S2V5LCBzdGF0dXM6IFwiaGFuZGVkX29mZlwifSlcbiAgICAgIC5yZXN1bHRzKClcbiAgICBjb25zdCBjb3VudFJvdyA9IC8qKiBAdHlwZSB7e2FjdGl2ZV9jb3VudDogbnVtYmVyIHwgc3RyaW5nfX0gKi8gKHJvd3NbMF0pXG4gICAgY29uc3QgYWN0aXZlQ291bnQgPSB0aGlzLl92YWxpZGF0ZWRDb25jdXJyZW5jeUNvdW50KGNvdW50Um93LmFjdGl2ZV9jb3VudCwgY29uY3VycmVuY3lLZXkpXG5cbiAgICBpZiAoYWN0aXZlQ291bnQgPT09IHByZXZpb3VzQWN0aXZlQ291bnQpIHJldHVybiBudWxsXG5cbiAgICBhd2FpdCBkYi51cGRhdGUoe1xuICAgICAgdGFibGVOYW1lOiBDT05DVVJSRU5DWV9UQUJMRSxcbiAgICAgIGRhdGE6IHthY3RpdmVfY291bnQ6IGFjdGl2ZUNvdW50fSxcbiAgICAgIGNvbmRpdGlvbnM6IHtjb25jdXJyZW5jeV9rZXk6IGNvbmN1cnJlbmN5S2V5fVxuICAgIH0pXG5cbiAgICByZXR1cm4ge2FjdGl2ZUNvdW50LCBjb25jdXJyZW5jeUtleSwgcHJldmlvdXNBY3RpdmVDb3VudH1cbiAgfVxuXG4gIC8qKlxuICAgKiBWYWxpZGF0ZXMgYSBkYXRhYmFzZSBjb3VudCBiZWZvcmUgaXQgcGFydGljaXBhdGVzIGluIHJlY29uY2lsaWF0aW9uLlxuICAgKiBAcGFyYW0ge251bWJlciB8IHN0cmluZ30gdmFsdWUgLSBSYXcgY291bnQuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBjb25jdXJyZW5jeUtleSAtIENvdW50ZXIga2V5IGZvciBkaWFnbm9zdGljcy5cbiAgICogQHJldHVybnMge251bWJlcn0gLSBTYWZlIG5vbi1uZWdhdGl2ZSBjb3VudC5cbiAgICovXG4gIF92YWxpZGF0ZWRDb25jdXJyZW5jeUNvdW50KHZhbHVlLCBjb25jdXJyZW5jeUtleSkge1xuICAgIGNvbnN0IGNvdW50ID0gdGhpcy5fbm9ybWFsaXplTnVtYmVyKHZhbHVlKVxuXG4gICAgaWYgKGNvdW50ID09PSBudWxsIHx8ICFOdW1iZXIuaXNTYWZlSW50ZWdlcihjb3VudCkgfHwgY291bnQgPCAwKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoYEludmFsaWQgcmVjb25jaWxlZCBiYWNrZ3JvdW5kIGpvYiBjb25jdXJyZW5jeSBjb3VudCBmb3IgJHtjb25jdXJyZW5jeUtleX06ICR7Y291bnR9YClcbiAgICB9XG5cbiAgICByZXR1cm4gY291bnRcbiAgfVxuXG4gIC8qKlxuICAgKiBSZWNvbmNpbGVzIHF1ZXVlLWRlcml2ZWQgY29uY3VycmVuY3kgd2l0aCB0aGUgY3VycmVudCBjb25maWd1cmF0aW9uLiBPbmx5XG4gICAqIGludm9rZWQgdGhyb3VnaCB7QGxpbmsgcmVjb25jaWxlUXVldWVDb25jdXJyZW5jeX0g4oCUIHRoZSBleHBsaWNpdCBsaWZlY3ljbGVcbiAgICogcGF0aCBydW4gYXQgbWFpbi1wcm9jZXNzIHN0YXJ0dXAgdW5kZXIgYSBjcm9zcy1wcm9jZXNzIGFkdmlzb3J5IGxvY2sg4oCUXG4gICAqIG5ldmVyIGZyb20gc2NoZW1hL3RlbmFudCBjaGVja3Mgb3Igcm91dGluZSBjb25uZWN0aW9uIGluaXRpYWxpemF0aW9uLFxuICAgKiB3aGljaCBzdGF5IHJlYWQtb25seSByZWdhcmRpbmcgcXVldWVkIGpvYiByb3dzLiBUaGUgcGVyLXByb2Nlc3MgbWVtbyBpc1xuICAgKiBsYXRjaGVkIGJ5IHtAbGluayByZWNvbmNpbGVRdWV1ZUNvbmN1cnJlbmN5fSBvbmx5IGFmdGVyIHRoZSBmb2xsb3dpbmdcbiAgICogY291bnQgcmVidWlsZCBhbHNvIHN1Y2NlZWRzLCBzbyBhIGZhaWxlZCByZWJ1aWxkIHJlLWVudGVycyBoZXJlIG9uIHJldHJ5XG4gICAqICh0aGUgYWRvcHRpb24gVVBEQVRFcyBiZWxvdyBhcmUgaWRlbXBvdGVudCkuIEVucXVldWUgb25seSBjb25zdWx0cyBjb25maWcgZm9yIG5ldyBqb2JzLCBzbyBhIGNhcCBhZGRlZCwgcmVtb3ZlZCwgb3IgY2hhbmdlZFxuICAgKiB3aGlsZSBhIGJhY2tsb2cgZXhpc3RzIG90aGVyd2lzZSBsZWF2ZXMgcGVyc2lzdGVkIHJvd3Mgc3RhbGU6IHByZS1jYXAgam9ic1xuICAgKiBrZWVwIGEgbnVsbCBrZXkgYW5kIGJ5cGFzcyB0aGUgY2FwLCBwb3N0LXJlbW92YWwgam9icyBzdGF5IGNhcHBlZCB1bmRlciBhXG4gICAqIG5vdy11bmNvbmZpZ3VyZWQga2V5LCBhbmQgYSBjaGFuZ2VkIG51bWVyaWMgY2FwIHN0YXlzIHN0YWxlIHVudGlsIHRoZSBuZXh0XG4gICAqIGVucXVldWUuIEJyaW5nIHF1ZXVlZCBkdXJhYmxlIHN0YXRlIGluIGxpbmUgd2l0aCBjb25maWc6IHN5bmMgZWFjaCBjb25maWd1cmVkXG4gICAqIHF1ZXVlJ3Mgc3RvcmVkIGNhcCwgYWRvcHQgbm90LXlldC1rZXllZCBxdWV1ZWQgam9icyBvbnRvIHRoZWlyIHF1ZXVlIGtleSxcbiAgICogYW5kIHJlbGVhc2UgcXVldWVkIGpvYnMgZnJvbSBxdWV1ZSBrZXlzIHdob3NlIHF1ZXVlIGlzIG5vIGxvbmdlciBjYXBwZWQuXG4gICAqIEV4aXN0aW5nIGhhbmRvZmZzIHJldGFpbiB0aGUgcG9saWN5IGFuZCByZXNlcnZhdGlvbiB0aGV5IHN0YXJ0ZWQgd2l0aCwgc29cbiAgICogcmVjb25jaWxpYXRpb24gY2Fubm90IHJhY2UgdGhlaXIgY29tcGxldGlvbi9yZXRyeSB0cmFuc2l0aW9ucy4gUnVucyBiZWZvcmVcbiAgICoge0BsaW5rIF9yZWNvbmNpbGVDb25jdXJyZW5jeX0gc28gYW55IHByZS1leGlzdGluZyBhY3RpdmUgY291bnRzIGFyZSBleGFjdC5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9kYXRhYmFzZS9kcml2ZXJzL2Jhc2UuanNcIikuZGVmYXVsdH0gZGIgLSBEYXRhYmFzZSBjb25uZWN0aW9uLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyB3aGVuIHJlY29uY2lsZWQuXG4gICAqL1xuICBhc3luYyBfcmVjb25jaWxlUXVldWVDb25jdXJyZW5jeShkYikge1xuICAgIGlmICh0aGlzLl9xdWV1ZUNvbmN1cnJlbmN5UmVjb25jaWxlZCkgcmV0dXJuXG4gICAgaWYgKCEoYXdhaXQgZGIudGFibGVFeGlzdHMoQ09OQ1VSUkVOQ1lfVEFCTEUpKSkgcmV0dXJuXG5cbiAgICBjb25zdCBxdWV1ZXNDb25maWcgPSB0aGlzLmNvbmZpZ3VyYXRpb24uZ2V0QmFja2dyb3VuZEpvYnNDb25maWcoKS5xdWV1ZXMgfHwge31cbiAgICBjb25zdCBqb2JzVGFibGUgPSBkYi5xdW90ZVRhYmxlKEpPQlNfVEFCTEUpXG4gICAgY29uc3Qga2V5Q29sdW1uID0gZGIucXVvdGVDb2x1bW4oXCJjb25jdXJyZW5jeV9rZXlcIilcbiAgICBjb25zdCBjYXBDb2x1bW4gPSBkYi5xdW90ZUNvbHVtbihcIm1heF9jb25jdXJyZW5jeVwiKVxuICAgIGNvbnN0IHF1ZXVlQ29sdW1uID0gZGIucXVvdGVDb2x1bW4oXCJxdWV1ZVwiKVxuICAgIGNvbnN0IHF1ZXVlZCA9IGAke2RiLnF1b3RlQ29sdW1uKFwic3RhdHVzXCIpfSA9ICR7ZGIucXVvdGUoXCJxdWV1ZWRcIil9YFxuICAgIC8qKiBAdHlwZSB7U2V0PHN0cmluZz59ICovXG4gICAgY29uc3QgY2FwcGVkUXVldWVzID0gbmV3IFNldCgpXG5cbiAgICBmb3IgKGNvbnN0IHF1ZXVlIG9mIE9iamVjdC5rZXlzKHF1ZXVlc0NvbmZpZykpIHtcbiAgICAgIGNvbnN0IGNhcCA9IHRoaXMuX3F1ZXVlTWF4Q29uY3VycmVuY3kocXVldWUpXG5cbiAgICAgIGlmIChjYXAgPT09IG51bGwpIGNvbnRpbnVlXG5cbiAgICAgIGNhcHBlZFF1ZXVlcy5hZGQocXVldWUpXG4gICAgICBjb25zdCBjb25jdXJyZW5jeUtleSA9IGAke1FVRVVFX0NPTkNVUlJFTkNZX0tFWV9QUkVGSVh9JHtxdWV1ZX1gXG5cbiAgICAgIGF3YWl0IHRoaXMuX2Vuc3VyZVF1ZXVlQ29uY3VycmVuY3lLZXkoZGIsIHtjb25jdXJyZW5jeUtleSwgbWF4Q29uY3VycmVuY3k6IGNhcH0pXG4gICAgICBhd2FpdCBkYi5xdWVyeShcbiAgICAgICAgYFVQREFURSAke2pvYnNUYWJsZX0gU0VUICR7a2V5Q29sdW1ufSA9ICR7ZGIucXVvdGUoY29uY3VycmVuY3lLZXkpfSwgJHtjYXBDb2x1bW59ID0gJHtOdW1iZXIoY2FwKX0gYCArXG4gICAgICAgIGBXSEVSRSAke3F1ZXVlQ29sdW1ufSA9ICR7ZGIucXVvdGUocXVldWUpfSBBTkQgJHtrZXlDb2x1bW59IElTIE5VTEwgQU5EICR7cXVldWVkfWBcbiAgICAgIClcbiAgICB9XG5cbiAgICBjb25zdCBjb25jdXJyZW5jeVJvd3MgPSBhd2FpdCBkYlxuICAgICAgLm5ld1F1ZXJ5KClcbiAgICAgIC5mcm9tKENPTkNVUlJFTkNZX1RBQkxFKVxuICAgICAgLnNlbGVjdChcImNvbmN1cnJlbmN5X2tleVwiKVxuICAgICAgLndoZXJlKGAke2RiLnF1b3RlQ29sdW1uKFwiY29uY3VycmVuY3lfa2V5XCIpfSBMSUtFICR7ZGIucXVvdGUoYCR7UVVFVUVfQ09OQ1VSUkVOQ1lfS0VZX1BSRUZJWH0lYCl9YClcbiAgICAgIC5yZXN1bHRzKClcblxuICAgIGZvciAoY29uc3Qgcm93IG9mIGNvbmN1cnJlbmN5Um93cykge1xuICAgICAgY29uc3QgY29uY3VycmVuY3lLZXkgPSBTdHJpbmcoLyoqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59ICovIChyb3cpLmNvbmN1cnJlbmN5X2tleSlcblxuICAgICAgaWYgKCFjb25jdXJyZW5jeUtleS5zdGFydHNXaXRoKFFVRVVFX0NPTkNVUlJFTkNZX0tFWV9QUkVGSVgpKSBjb250aW51ZVxuICAgICAgaWYgKGNhcHBlZFF1ZXVlcy5oYXMoY29uY3VycmVuY3lLZXkuc2xpY2UoUVVFVUVfQ09OQ1VSUkVOQ1lfS0VZX1BSRUZJWC5sZW5ndGgpKSkgY29udGludWVcblxuICAgICAgYXdhaXQgZGIucXVlcnkoXG4gICAgICAgIGBVUERBVEUgJHtqb2JzVGFibGV9IFNFVCAke2tleUNvbHVtbn0gPSBOVUxMLCAke2NhcENvbHVtbn0gPSBOVUxMIGAgK1xuICAgICAgICBgV0hFUkUgJHtrZXlDb2x1bW59ID0gJHtkYi5xdW90ZShjb25jdXJyZW5jeUtleSl9IEFORCAke3F1ZXVlZH1gXG4gICAgICApXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgbm9ybWFsaXplIG51bWJlci5cbiAgICogQHBhcmFtIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gdmFsdWUgLSBJbnB1dCB2YWx1ZS5cbiAgICogQHJldHVybnMge251bWJlciB8IG51bGx9IC0gTm9ybWFsaXplZCBudW1iZXIuXG4gICAqL1xuICBfbm9ybWFsaXplTnVtYmVyKHZhbHVlKSB7XG4gICAgaWYgKHZhbHVlID09PSBudWxsIHx8IHZhbHVlID09PSB1bmRlZmluZWQgfHwgdmFsdWUgPT09IFwiXCIpIHJldHVybiBudWxsXG5cbiAgICBjb25zdCBudW1lcmljID0gTnVtYmVyKHZhbHVlKVxuXG4gICAgaWYgKE51bWJlci5pc05hTihudW1lcmljKSkgcmV0dXJuIG51bGxcblxuICAgIHJldHVybiBudW1lcmljXG4gIH1cblxuICAvKipcbiAgICogUnVucyBub3JtYWxpemUgZXhlY3V0aW9uIG1vZGUuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi90eXBlcy5qc1wiKS5CYWNrZ3JvdW5kSm9iT3B0aW9uc30gW29wdGlvbnNdIC0gSm9iIG9wdGlvbnMuXG4gICAqIEByZXR1cm5zIHtpbXBvcnQoXCIuL3R5cGVzLmpzXCIpLkJhY2tncm91bmRKb2JFeGVjdXRpb25Nb2RlfSAtIE5vcm1hbGl6ZWQgZXhlY3V0aW9uIG1vZGUuXG4gICAqL1xuICBfbm9ybWFsaXplRXhlY3V0aW9uTW9kZShvcHRpb25zKSB7XG4gICAgcmV0dXJuIG5vcm1hbGl6ZUJhY2tncm91bmRKb2JFeGVjdXRpb25Nb2RlKG9wdGlvbnMgfHwge30sIERFRkFVTFRfQkFDS0dST1VORF9KT0JfRVhFQ1VUSU9OX01PREUpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBub3JtYWxpemUgZXhlY3V0aW9uIG1vZGUgbmFtZS5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGV4ZWN1dGlvbk1vZGUgLSBFeGVjdXRpb24gbW9kZSBuYW1lLlxuICAgKiBAcmV0dXJucyB7aW1wb3J0KFwiLi90eXBlcy5qc1wiKS5CYWNrZ3JvdW5kSm9iRXhlY3V0aW9uTW9kZX0gLSBOb3JtYWxpemVkIGV4ZWN1dGlvbiBtb2RlLlxuICAgKi9cbiAgX25vcm1hbGl6ZUV4ZWN1dGlvbk1vZGVOYW1lKGV4ZWN1dGlvbk1vZGUpIHtcbiAgICByZXR1cm4gbm9ybWFsaXplQmFja2dyb3VuZEpvYkV4ZWN1dGlvbk1vZGUoXG4gICAgICB7ZXhlY3V0aW9uTW9kZTogLyoqIEB0eXBlIHtpbXBvcnQoXCIuL3R5cGVzLmpzXCIpLkJhY2tncm91bmRKb2JFeGVjdXRpb25Nb2RlfSAqLyAoZXhlY3V0aW9uTW9kZSl9LFxuICAgICAgREVGQVVMVF9CQUNLR1JPVU5EX0pPQl9FWEVDVVRJT05fTU9ERSxcbiAgICAgIEJBQ0tHUk9VTkRfSk9CX0VYRUNVVElPTl9NT0RFU1xuICAgIClcbiAgfVxuXG4gIC8qKlxuICAgKiBGaWx0ZXJzIHF1ZXVlZCBqb2JzIGJ5IG9uZSBvciBtb3JlIGV4ZWN1dGlvbiBtb2RlcyBhZ2FpbnN0IHRoZVxuICAgKiBgZXhlY3V0aW9uX21vZGVgIGNvbHVtbiAodGhlIHNpbmdsZSBzb3VyY2Ugb2YgdHJ1dGgpLlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIE9wdGlvbnMuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vZGF0YWJhc2UvZHJpdmVycy9iYXNlLmpzXCIpLmRlZmF1bHR9IGFyZ3MuZGIgLSBEYXRhYmFzZSBjb25uZWN0aW9uLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vdHlwZXMuanNcIikuQmFja2dyb3VuZEpvYkV4ZWN1dGlvbk1vZGUgfCBpbXBvcnQoXCIuL3R5cGVzLmpzXCIpLkJhY2tncm91bmRKb2JFeGVjdXRpb25Nb2RlW119IGFyZ3MuZXhlY3V0aW9uTW9kZSAtIFJ1bnRpbWUgbW9kZXMuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vZGF0YWJhc2UvcXVlcnkvaW5kZXguanNcIikuZGVmYXVsdH0gYXJncy5xdWVyeSAtIFF1ZXJ5IHRvIGZpbHRlci5cbiAgICogQHJldHVybnMge2ltcG9ydChcIi4uL2RhdGFiYXNlL3F1ZXJ5L2luZGV4LmpzXCIpLmRlZmF1bHR9IC0gRmlsdGVyZWQgcXVlcnkuXG4gICAqL1xuICBfd2hlcmVFeGVjdXRpb25Nb2RlKHtkYiwgZXhlY3V0aW9uTW9kZSwgcXVlcnl9KSB7XG4gICAgY29uc3QgZXhlY3V0aW9uTW9kZXMgPSBBcnJheS5pc0FycmF5KGV4ZWN1dGlvbk1vZGUpID8gZXhlY3V0aW9uTW9kZSA6IFtleGVjdXRpb25Nb2RlXVxuICAgIGNvbnN0IGV4ZWN1dGlvbk1vZGVDb2x1bW4gPSBkYi5xdW90ZUNvbHVtbihcImV4ZWN1dGlvbl9tb2RlXCIpXG4gICAgY29uc3QgY29uZGl0aW9ucyA9IGV4ZWN1dGlvbk1vZGVzLm1hcCgobW9kZSkgPT4gYCR7ZXhlY3V0aW9uTW9kZUNvbHVtbn0gPSAke2RiLnF1b3RlKG1vZGUpfWApXG5cbiAgICByZXR1cm4gcXVlcnkud2hlcmUoYCgke2NvbmRpdGlvbnMuam9pbihcIiBPUiBcIil9KWApXG4gIH1cblxuICAvKipcbiAgICogUnVucyBwYXJzZSBhcmdzLlxuICAgKiBAcGFyYW0ge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSB2YWx1ZSAtIElucHV0IHZhbHVlLlxuICAgKiBAcmV0dXJucyB7QXJyYXk8UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSAtIFBhcnNlZCBhcmdzLlxuICAgKi9cbiAgX3BhcnNlQXJncyh2YWx1ZSkge1xuICAgIGlmICghdmFsdWUpIHJldHVybiBbXVxuXG4gICAgdHJ5IHtcbiAgICAgIGNvbnN0IHBhcnNlZCA9IEpTT04ucGFyc2UoU3RyaW5nKHZhbHVlKSlcblxuICAgICAgaWYgKEFycmF5LmlzQXJyYXkocGFyc2VkKSkgcmV0dXJuIHBhcnNlZFxuICAgIH0gY2F0Y2gge1xuICAgICAgLy8gSWdub3JlIHBhcnNlIGVycm9ycy5cbiAgICB9XG5cbiAgICByZXR1cm4gW11cbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHdpdGggZGIuXG4gICAqIEB0ZW1wbGF0ZSBUXG4gICAqIEBwYXJhbSB7KGRiOiBpbXBvcnQoXCIuLi9kYXRhYmFzZS9kcml2ZXJzL2Jhc2UuanNcIikuZGVmYXVsdCkgPT4gUHJvbWlzZTxUPn0gY2FsbGJhY2sgLSBDYWxsYmFjay5cbiAgICogQHJldHVybnMge1Byb21pc2U8VD59IC0gQ2FsbGJhY2sgcmVzdWx0LlxuICAgKi9cbiAgYXN5bmMgX3dpdGhEYihjYWxsYmFjaykge1xuICAgIGNvbnN0IGRhdGFiYXNlSWRlbnRpZmllciA9IHRoaXMuZ2V0RGF0YWJhc2VJZGVudGlmaWVyKClcbiAgICBjb25zdCBwb29sID0gdGhpcy5jb25maWd1cmF0aW9uLmdldERhdGFiYXNlUG9vbChkYXRhYmFzZUlkZW50aWZpZXIpXG5cbiAgICBpZiAoIXBvb2wudGVzdFNoYXJlZENvbm5lY3Rpb24oKSkge1xuICAgICAgcmV0dXJuIGF3YWl0IHBvb2wud2l0aENvbm5lY3Rpb24oe25hbWU6IFwiQmFja2dyb3VuZCBqb2JzIHN0b3JlXCJ9LCBjYWxsYmFjaylcbiAgICB9XG5cbiAgICByZXR1cm4gYXdhaXQgdGhpcy5jb25maWd1cmF0aW9uLnJ1bldpdGhUZXN0U2hhcmVkQ29ubmVjdGlvbkNvbnRleHRzKGFzeW5jICgpID0+IHtcbiAgICAgIHJldHVybiBhd2FpdCB0aGlzLmNvbmZpZ3VyYXRpb24uZW5zdXJlQ29ubmVjdGlvbnMoe2RhdGFiYXNlSWRlbnRpZmllcnM6IFtkYXRhYmFzZUlkZW50aWZpZXJdLCBuYW1lOiBcIkJhY2tncm91bmQgam9icyBzdG9yZVwifSwgYXN5bmMgKGRicykgPT4ge1xuICAgICAgICBjb25zdCBjb25uZWN0aW9uID0gZGJzW2RhdGFiYXNlSWRlbnRpZmllcl1cbiAgICAgICAgcmV0dXJuIGF3YWl0IGNvb3JkaW5hdGVTaGFyZWRUcmFuc2FjdGlvbkNvbm5lY3Rpb24oY29ubmVjdGlvbiwgYXN5bmMgKCkgPT4gYXdhaXQgY2FsbGJhY2soY29ubmVjdGlvbikpXG4gICAgICB9KVxuICAgIH0pXG4gIH1cblxuICAvKipcbiAgICogUnVucyBhIHZhbHVlLXJldHVybmluZyBjYWxsYmFjayBpbnNpZGUgdGhlIGRyaXZlcidzIHZvaWQtdHlwZWQgdHJhbnNhY3Rpb24gQVBJLlxuICAgKiBAdGVtcGxhdGUgVFxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL2RhdGFiYXNlL2RyaXZlcnMvYmFzZS5qc1wiKS5kZWZhdWx0fSBkYiAtIERhdGFiYXNlIGNvbm5lY3Rpb24uXG4gICAqIEBwYXJhbSB7KCkgPT4gUHJvbWlzZTxUPn0gY2FsbGJhY2sgLSBUcmFuc2FjdGlvbiBjYWxsYmFjay5cbiAgICogQHJldHVybnMge1Byb21pc2U8VD59IC0gQ2FsbGJhY2sgcmVzdWx0LlxuICAgKi9cbiAgYXN5bmMgX3RyYW5zYWN0aW9uUmVzdWx0KGRiLCBjYWxsYmFjaykge1xuICAgIGxldCBjb21wbGV0ZWQgPSBmYWxzZVxuICAgIC8qKiBAdHlwZSB7VCB8IHVuZGVmaW5lZH0gKi9cbiAgICBsZXQgcmVzdWx0XG4gICAgYXdhaXQgZGIudHJhbnNhY3Rpb24oYXN5bmMgKCkgPT4ge1xuICAgICAgcmVzdWx0ID0gYXdhaXQgY2FsbGJhY2soKVxuICAgICAgY29tcGxldGVkID0gdHJ1ZVxuICAgIH0pXG4gICAgaWYgKCFjb21wbGV0ZWQpIHRocm93IG5ldyBFcnJvcihcIkJhY2tncm91bmQgam9icyB0cmFuc2FjdGlvbiBjYWxsYmFjayB3YXMgbm90IGludm9rZWRcIilcbiAgICByZXR1cm4gLyoqIEB0eXBlIHtUfSAqLyAocmVzdWx0KVxuICB9XG5cbiAgLyoqXG4gICAqIFNlcmlhbGl6ZXMgY291bnQtY2hhbmdpbmcgdHJhbnNhY3Rpb25zIGJlZm9yZSBjaGVja2luZyBvdXQgdGhlaXIgY29ubmVjdGlvbi5cbiAgICogRGF0YWJhc2Ugcm93IGxvY2tpbmcgc3RpbGwgcHJvdmlkZXMgY3Jvc3MtcHJvY2VzcyBvcmRlcmluZzsgdGhpcyBndWFyZFxuICAgKiBwcmV2ZW50cyBjb25jdXJyZW50IGNhbGxlcnMgb24gU1FMaXRlJ3Mgc2hhcmVkIGNvbm5lY3Rpb24gZnJvbSBhdHRlbXB0aW5nXG4gICAqIG92ZXJsYXBwaW5nIHRvcC1sZXZlbCB0cmFuc2FjdGlvbnMuXG4gICAqIEB0ZW1wbGF0ZSBUXG4gICAqIEBwYXJhbSB7KGRiOiBpbXBvcnQoXCIuLi9kYXRhYmFzZS9kcml2ZXJzL2Jhc2UuanNcIikuZGVmYXVsdCkgPT4gUHJvbWlzZTxUPn0gY2FsbGJhY2sgLSBUcmFuc2FjdGlvbiBjYWxsYmFjay5cbiAgICogQHBhcmFtIHtCYWNrZ3JvdW5kSm9iVHJhbnNhY3Rpb25TZXJpYWxpemF0aW9uT3B0aW9uc30gW29wdGlvbnNdIC0gU2VyaWFsaXphdGlvbiBvcHRpb25zLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxUPn0gQ2FsbGJhY2sgcmVzdWx0LlxuICAgKi9cbiAgYXN5bmMgX3NlcmlhbGl6ZWRDb3VudE11dGF0aW9uKGNhbGxiYWNrLCBvcHRpb25zID0ge30pIHtcbiAgICByZXR1cm4gYXdhaXQgdGhpcy5fc2VyaWFsaXplZFRyYW5zYWN0aW9uTXV0YXRpb24oYXN5bmMgKGRiKSA9PiB7XG4gICAgICBhd2FpdCB0aGlzLl9sb2NrQ291bnRSZXZpc2lvbihkYilcblxuICAgICAgcmV0dXJuIGF3YWl0IGNhbGxiYWNrKGRiKVxuICAgIH0sIG9wdGlvbnMpXG4gIH1cblxuICAvKipcbiAgICogQWRtaXRzIHRyYW5zYWN0aW9ucyB0byB0aGUgcHJvY2Vzcy1sb2NhbCBGSUZPIGJlZm9yZSB0aGV5IGNoZWNrIG91dCBhXG4gICAqIGNvbm5lY3Rpb24uIENyb3NzLXByb2Nlc3Mgb3JkZXJpbmcgcmVtYWlucyB0aGUgcmVzcG9uc2liaWxpdHkgb2YgZHVyYWJsZVxuICAgKiByb3cvYWR2aXNvcnkgbG9ja3MgYW5kIHVuaXF1ZSBjb25zdHJhaW50cyBhY3F1aXJlZCBhcm91bmQgdGhlIGNhbGxiYWNrLlxuICAgKiBAdGVtcGxhdGUgVFxuICAgKiBAcGFyYW0geyhkYjogaW1wb3J0KFwiLi4vZGF0YWJhc2UvZHJpdmVycy9iYXNlLmpzXCIpLmRlZmF1bHQpID0+IFByb21pc2U8VD59IGNhbGxiYWNrIC0gVHJhbnNhY3Rpb24gY2FsbGJhY2suXG4gICAqIEBwYXJhbSB7QmFja2dyb3VuZEpvYlRyYW5zYWN0aW9uU2VyaWFsaXphdGlvbk9wdGlvbnN9IFtvcHRpb25zXSAtIFNlcmlhbGl6YXRpb24gb3B0aW9ucy5cbiAgICogQHJldHVybnMge1Byb21pc2U8VD59IENhbGxiYWNrIHJlc3VsdC5cbiAgICovXG4gIGFzeW5jIF9zZXJpYWxpemVkVHJhbnNhY3Rpb25NdXRhdGlvbihjYWxsYmFjaywgb3B0aW9ucyA9IHt9KSB7XG4gICAgY29uc3QgaWRlbnRpZmllciA9IHRoaXMuZ2V0RGF0YWJhc2VJZGVudGlmaWVyKCkgfHwgXCJkZWZhdWx0XCJcbiAgICBjb25zdCBwcmV2aW91cyA9IHRyYW5zYWN0aW9uTXV0YXRpb25DaGFpbnMuZ2V0KGlkZW50aWZpZXIpIHx8IFByb21pc2UucmVzb2x2ZSgpXG4gICAgbGV0IHJlc29sdmVSdW4gPSAoKSA9PiB7fVxuICAgIC8qKiBAdHlwZSB7UHJvbWlzZTx2b2lkPn0gKi9cbiAgICBjb25zdCBydW4gPSBuZXcgUHJvbWlzZSgocmVzb2x2ZSkgPT4ge1xuICAgICAgcmVzb2x2ZVJ1biA9ICgpID0+IHJlc29sdmUodW5kZWZpbmVkKVxuICAgIH0pXG4gICAgY29uc3QgY2hhaW4gPSBwcmV2aW91cy50aGVuKCgpID0+IHJ1bilcblxuICAgIHRyYW5zYWN0aW9uTXV0YXRpb25DaGFpbnMuc2V0KGlkZW50aWZpZXIsIGNoYWluKVxuICAgIGF3YWl0IHByZXZpb3VzXG5cbiAgICB0cnkge1xuICAgICAgcmV0dXJuIGF3YWl0IHRoaXMuX3dpdGhEYihhc3luYyAoZGIpID0+IHtcbiAgICAgICAgY29uc3Qge2Fkdmlzb3J5TG9ja30gPSBvcHRpb25zXG5cbiAgICAgICAgaWYgKGFkdmlzb3J5TG9jaykge1xuICAgICAgICAgIGNvbnN0IGFjcXVpcmVkID0gYXdhaXQgZGIuYWNxdWlyZUFkdmlzb3J5TG9jayhhZHZpc29yeUxvY2submFtZSlcblxuICAgICAgICAgIGlmICghYWNxdWlyZWQpIHRocm93IG5ldyBFcnJvcihhZHZpc29yeUxvY2suZmFpbHVyZU1lc3NhZ2UpXG4gICAgICAgIH1cblxuICAgICAgICB0cnkge1xuICAgICAgICAgIHJldHVybiBhd2FpdCB0aGlzLl90cmFuc2FjdGlvblJlc3VsdChkYiwgYXN5bmMgKCkgPT4gYXdhaXQgY2FsbGJhY2soZGIpKVxuICAgICAgICB9IGZpbmFsbHkge1xuICAgICAgICAgIGlmIChhZHZpc29yeUxvY2spIGF3YWl0IGRiLnJlbGVhc2VBZHZpc29yeUxvY2soYWR2aXNvcnlMb2NrLm5hbWUpXG4gICAgICAgIH1cbiAgICAgIH0pXG4gICAgfSBmaW5hbGx5IHtcbiAgICAgIHJlc29sdmVSdW4oKVxuICAgICAgaWYgKHRyYW5zYWN0aW9uTXV0YXRpb25DaGFpbnMuZ2V0KGlkZW50aWZpZXIpID09PSBjaGFpbikgdHJhbnNhY3Rpb25NdXRhdGlvbkNoYWlucy5kZWxldGUoaWRlbnRpZmllcilcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogUnVucyBzaG91bGQgYWNjZXB0IHJlcG9ydC5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBPcHRpb25zLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vdHlwZXMuanNcIikuQmFja2dyb3VuZEpvYlJvd30gYXJncy5qb2IgLSBKb2Igcm93LlxuICAgKiBAcGFyYW0ge3N0cmluZyB8IG51bGwgfCB1bmRlZmluZWR9IGFyZ3MuaGFuZG9mZklkIC0gSGFuZG9mZiBsZWFzZSBpZCBmcm9tIHJlcG9ydC5cbiAgICogQHBhcmFtIHtzdHJpbmcgfCBudWxsIHwgdW5kZWZpbmVkfSBhcmdzLndvcmtlcklkIC0gV29ya2VyIGlkIGZyb20gcmVwb3J0LlxuICAgKiBAcGFyYW0ge251bWJlciB8IG51bGwgfCB1bmRlZmluZWR9IGFyZ3MuaGFuZGVkT2ZmQXRNcyAtIEhhbmRlZCBvZmYgdGltZXN0YW1wIGZyb20gcmVwb3J0LlxuICAgKiBAcmV0dXJucyB7Ym9vbGVhbn0gLSBXaGV0aGVyIHRvIGFjY2VwdCB0aGUgcmVwb3J0LlxuICAgKi9cbiAgX3Nob3VsZEFjY2VwdFJlcG9ydCh7am9iLCBoYW5kb2ZmSWQsIHdvcmtlcklkLCBoYW5kZWRPZmZBdE1zfSkge1xuICAgIGlmIChqb2Iuc3RhdHVzICE9PSBcImhhbmRlZF9vZmZcIikgcmV0dXJuIGZhbHNlXG5cbiAgICByZXR1cm4gdGhpcy5faGFuZG9mZklkUmVwb3J0TWF0Y2hlcyh7aGFuZG9mZklkLCBqb2J9KVxuICAgICAgJiYgdGhpcy5fd29ya2VyUmVwb3J0TWF0Y2hlcyh7am9iLCB3b3JrZXJJZH0pXG4gICAgICAmJiB0aGlzLl9oYW5kb2ZmUmVwb3J0TWF0Y2hlcyh7aGFuZGVkT2ZmQXRNcywgam9ifSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGFjdGl2ZSBoYW5kb2ZmIGNvbmRpdGlvbnMuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi90eXBlcy5qc1wiKS5CYWNrZ3JvdW5kSm9iUm93fSBqb2IgLSBKb2Igcm93LlxuICAgKiBAcmV0dXJucyB7UmVjb3JkPHN0cmluZywgc3RyaW5nIHwgbnVsbD59IC0gQ29uZGl0aW9uYWwgdHJhbnNpdGlvbiBmZW5jZS5cbiAgICovXG4gIF9hY3RpdmVIYW5kb2ZmQ29uZGl0aW9ucyhqb2IpIHtcbiAgICByZXR1cm4ge2hhbmRvZmZfaWQ6IGpvYi5oYW5kb2ZmSWQsIGlkOiBqb2IuaWQsIHN0YXR1czogXCJoYW5kZWRfb2ZmXCJ9XG4gIH1cblxuICAvKipcbiAgICogUnVucyBoYW5kb2ZmIGlkIHJlcG9ydCBtYXRjaGVzLlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIE9wdGlvbnMuXG4gICAqIEBwYXJhbSB7c3RyaW5nIHwgbnVsbCB8IHVuZGVmaW5lZH0gYXJncy5oYW5kb2ZmSWQgLSBIYW5kb2ZmIGxlYXNlIGlkIGZyb20gcmVwb3J0LlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vdHlwZXMuanNcIikuQmFja2dyb3VuZEpvYlJvd30gYXJncy5qb2IgLSBKb2Igcm93LlxuICAgKiBAcmV0dXJucyB7Ym9vbGVhbn0gLSBXaGV0aGVyIHRoZSBoYW5kb2ZmIGxlYXNlIG1hdGNoZXMuXG4gICAqL1xuICBfaGFuZG9mZklkUmVwb3J0TWF0Y2hlcyh7aGFuZG9mZklkLCBqb2J9KSB7XG4gICAgaWYgKCFqb2IuaGFuZG9mZklkKSByZXR1cm4gdHJ1ZVxuXG4gICAgcmV0dXJuIGhhbmRvZmZJZCA9PT0gam9iLmhhbmRvZmZJZFxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgd29ya2VyIHJlcG9ydCBtYXRjaGVzLlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIE9wdGlvbnMuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi90eXBlcy5qc1wiKS5CYWNrZ3JvdW5kSm9iUm93fSBhcmdzLmpvYiAtIEpvYiByb3cuXG4gICAqIEBwYXJhbSB7c3RyaW5nIHwgbnVsbCB8IHVuZGVmaW5lZH0gYXJncy53b3JrZXJJZCAtIFdvcmtlciBpZCBmcm9tIHJlcG9ydC5cbiAgICogQHJldHVybnMge2Jvb2xlYW59IC0gV2hldGhlciB0aGUgd29ya2VyIHJlcG9ydCBtYXRjaGVzLlxuICAgKi9cbiAgX3dvcmtlclJlcG9ydE1hdGNoZXMoe2pvYiwgd29ya2VySWR9KSB7XG4gICAgaWYgKCF3b3JrZXJJZCkgcmV0dXJuIHRydWVcbiAgICBpZiAoIWpvYi53b3JrZXJJZCkgcmV0dXJuIHRydWVcblxuICAgIHJldHVybiB3b3JrZXJJZCA9PT0gam9iLndvcmtlcklkXG4gIH1cblxuICAvKipcbiAgICogUnVucyBoYW5kb2ZmIHJlcG9ydCBtYXRjaGVzLlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIE9wdGlvbnMuXG4gICAqIEBwYXJhbSB7bnVtYmVyIHwgbnVsbCB8IHVuZGVmaW5lZH0gYXJncy5oYW5kZWRPZmZBdE1zIC0gSGFuZGVkIG9mZiB0aW1lc3RhbXAgZnJvbSByZXBvcnQuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi90eXBlcy5qc1wiKS5CYWNrZ3JvdW5kSm9iUm93fSBhcmdzLmpvYiAtIEpvYiByb3cuXG4gICAqIEByZXR1cm5zIHtib29sZWFufSAtIFdoZXRoZXIgdGhlIGhhbmRvZmYgcmVwb3J0IG1hdGNoZXMuXG4gICAqL1xuICBfaGFuZG9mZlJlcG9ydE1hdGNoZXMoe2hhbmRlZE9mZkF0TXMsIGpvYn0pIHtcbiAgICBpZiAoIWhhbmRlZE9mZkF0TXMpIHJldHVybiB0cnVlXG4gICAgaWYgKCFqb2IuaGFuZGVkT2ZmQXRNcykgcmV0dXJuIHRydWVcblxuICAgIHJldHVybiBoYW5kZWRPZmZBdE1zID09PSBqb2IuaGFuZGVkT2ZmQXRNc1xuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgbWlncmF0aW9uIGtleS5cbiAgICogQHBhcmFtIHtzdHJpbmd9IFt2ZXJzaW9uXSAtIE1pZ3JhdGlvbiB2ZXJzaW9uLlxuICAgKiBAcmV0dXJucyB7c3RyaW5nfSAtIE1pZ3JhdGlvbiBrZXkuXG4gICAqL1xuICBfbWlncmF0aW9uS2V5KHZlcnNpb24gPSBNSUdSQVRJT05fVkVSU0lPTikge1xuICAgIHJldHVybiBgJHtNSUdSQVRJT05fU0NPUEV9OiR7dmVyc2lvbn1gXG4gIH1cbn1cbiJdfQ==