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
            const scheduledAtMs = this._rescheduledAtMs(delayMs);
            const affectedRows = await this._updateAffectedRows(db, {
                tableName: JOBS_TABLE,
                data: {
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
            const affectedRows = await this._updateAffectedRows(db, {
                tableName: JOBS_TABLE,
                data: {
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
        const update = this._failureUpdate({
            failureMessage,
            markOrphaned,
            nextAttempt,
            now,
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
     * @param {number | null} args.scheduledAt - Next scheduled timestamp.
     * @param {boolean} args.shouldRetry - Whether the job should retry.
     * @returns {Record<string, ReturnType<typeof JSON.parse>>} - Database update data.
     */
    _failureUpdate({ failureMessage, markOrphaned, nextAttempt, now, scheduledAt, shouldRetry }) {
        /**
         * Update.
         * @type {Record<string, ReturnType<typeof JSON.parse>>} */
        const update = {
            attempts: nextAttempt,
            handed_off_at_ms: null,
            worker_id: null,
            last_error: failureMessage
        };
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoic3RvcmUuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi9zcmMvYmFja2dyb3VuZC1qb2JzL3N0b3JlLmpzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiJBQUFBLFlBQVk7QUFFWixPQUFPLEVBQUMsVUFBVSxFQUFFLFVBQVUsRUFBQyxNQUFNLFFBQVEsQ0FBQTtBQUM3QyxPQUFPLHFCQUFxQixNQUFNLGNBQWMsQ0FBQTtBQUNoRCxPQUFPLE1BQU0sTUFBTSxjQUFjLENBQUE7QUFDakMsT0FBTyxTQUFTLE1BQU0saUNBQWlDLENBQUE7QUFDdkQsT0FBTyxjQUFjLE1BQU0sdUJBQXVCLENBQUE7QUFDbEQsT0FBTyxtQkFBbUIsTUFBTSxpQkFBaUIsQ0FBQTtBQUNqRCxPQUFPLDJCQUEyQixNQUFNLHNCQUFzQixDQUFBO0FBQzlELE9BQU8sRUFBRSxxQ0FBcUMsRUFBRSxNQUFNLHlEQUF5RCxDQUFBO0FBQy9HLE9BQU8sbUJBQW1CLE1BQU0seUJBQXlCLENBQUE7QUFDekQsT0FBTyxFQUNMLDhCQUE4QixFQUM5QixxQ0FBcUMsRUFDckMsNEJBQTRCLEVBQzVCLDRCQUE0QixFQUM1QixpQ0FBaUMsRUFDakMsbUNBQW1DLEVBQ25DLGdDQUFnQyxFQUNoQywyQkFBMkIsRUFDM0IsbUNBQW1DLEVBQ25DLDRCQUE0QixFQUM1QixZQUFZLEVBQ2IsTUFBTSxvQkFBb0IsQ0FBQTtBQUMzQixPQUFPLEVBQ0wsOEJBQThCLEVBQzlCLDJCQUEyQixFQUMzQix3QkFBd0IsRUFDekIsTUFBTSxpQ0FBaUMsQ0FBQTtBQUV4Qzs7Ozs7Ozs7Ozs7OztHQWFHO0FBRUg7Ozs7O0dBS0c7QUFFSDs7OztHQUlHO0FBRUg7Ozs7O0dBS0c7QUFFSCxNQUFNLGdCQUFnQixHQUFHLCtCQUErQixDQUFBO0FBQ3hELE1BQU0sZUFBZSxHQUFHLGlCQUFpQixDQUFBO0FBQ3pDLE1BQU0saUJBQWlCLEdBQUcsZ0JBQWdCLENBQUE7QUFDMUMsTUFBTSwrQkFBK0IsR0FBRyx5QkFB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QWlCO1FBQ3ZDLE9BQU8sR0FBRyxlQUFlLElBQUksT0FBTyxFQUFFLENBQUE7SUFDeEMsQ0FBQztDQUNGIiwic291cmNlc0NvbnRlbnQiOlsiLy8gQHRzLWNoZWNrXG5cbmltcG9ydCB7Y3JlYXRlSGFzaCwgcmFuZG9tVVVJRH0gZnJvbSBcImNyeXB0b1wiXG5pbXBvcnQgQmFja2dyb3VuZEpvYnNBZGFwdGVyIGZyb20gXCIuL2FkYXB0ZXIuanNcIlxuaW1wb3J0IExvZ2dlciBmcm9tIFwiLi4vbG9nZ2VyLmpzXCJcbmltcG9ydCBUYWJsZURhdGEgZnJvbSBcIi4uL2RhdGFiYXNlL3RhYmxlLWRhdGEvaW5kZXguanNcIlxuaW1wb3J0IFZlbG9jaW91c0Vycm9yIGZyb20gXCIuLi92ZWxvY2lvdXMtZXJyb3IuanNcIlxuaW1wb3J0IEJhY2tncm91bmRKb2JSZWNvcmQgZnJvbSBcIi4vam9iLXJlY29yZC5qc1wiXG5pbXBvcnQgbm9ybWFsaXplQmFja2dyb3VuZEpvYkVycm9yIGZyb20gXCIuL25vcm1hbGl6ZS1lcnJvci5qc1wiXG5pbXBvcnQgeyBjb29yZGluYXRlU2hhcmVkVHJhbnNhY3Rpb25Db25uZWN0aW9uIH0gZnJvbSBcIi4uL3Rlc3Rpbmcvc2hhcmVkLXRyYW5zYWN0aW9uLWNvbm5lY3Rpb24tY29vcmRpbmF0b3IuanNcIlxuaW1wb3J0IHN0YWJsZUpzb25TdHJpbmdpZnkgZnJvbSBcIi4uL3V0aWxzL3N0YWJsZS1qc29uLmpzXCJcbmltcG9ydCB7XG4gIEJBQ0tHUk9VTkRfSk9CX0VYRUNVVElPTl9NT0RFUyxcbiAgREVGQVVMVF9CQUNLR1JPVU5EX0pPQl9FWEVDVVRJT05fTU9ERSxcbiAgREVGQVVMVF9CQUNLR1JPVU5EX0pPQl9RVUVVRSxcbiAgUVVFVUVfQ09OQ1VSUkVOQ1lfS0VZX1BSRUZJWCxcbiAgbm9ybWFsaXplQmFja2dyb3VuZEpvYkNvbmN1cnJlbmN5LFxuICBub3JtYWxpemVCYWNrZ3JvdW5kSm9iRXhlY3V0aW9uTW9kZSxcbiAgbm9ybWFsaXplQmFja2dyb3VuZEpvYk1heFJldHJpZXMsXG4gIG5vcm1hbGl6ZUJhY2tncm91bmRKb2JRdWV1ZSxcbiAgbm9ybWFsaXplQmFja2dyb3VuZEpvYlNjaGVkdWxlZEF0TXMsXG4gIHJlc2NoZWR1bGVkQmFja2dyb3VuZEpvYkF0TXMsXG4gIHJldHJ5RGVsYXlNc1xufSBmcm9tIFwiLi9qb2Itc2VtYW50aWNzLmpzXCJcbmltcG9ydCB7XG4gIE1BSUxfREVMSVZFUllfT1BFUkFUSU9OU19UQUJMRSxcbiAgbWFpbERlbGl2ZXJ5T3BlcmF0aW9uRm9ySm9iLFxuICBtYWlsRGVsaXZlcnlPcGVyYXRpb25LZXlcbn0gZnJvbSBcIi4uL21haWxlci9kZWxpdmVyeS1vcGVyYXRpb24uanNcIlxuXG4vKipcbiAqIFByZXBhcmVkQmFja2dyb3VuZEpvYiB0eXBlLlxuICogQHR5cGVkZWYge29iamVjdH0gUHJlcGFyZWRCYWNrZ3JvdW5kSm9iXG4gKiBAcHJvcGVydHkge3N0cmluZ30gYXJnc0pzb24gLSBTZXJpYWxpemVkIGFyZ3VtZW50cy5cbiAqIEBwcm9wZXJ0eSB7e2NvbmN1cnJlbmN5S2V5OiBzdHJpbmcsIG1heENvbmN1cnJlbmN5OiBudW1iZXIsIHF1ZXVlRGVyaXZlZDogYm9vbGVhbn0gfCBudWxsfSBjb25jdXJyZW5jeSAtIFJlc29sdmVkIGNvbmN1cnJlbmN5LlxuICogQHByb3BlcnR5IHtudW1iZXJ9IGNyZWF0ZWRBdE1zIC0gQ3JlYXRpb24gdGltZXN0YW1wLlxuICogQHByb3BlcnR5IHtpbXBvcnQoXCIuL3R5cGVzLmpzXCIpLkJhY2tncm91bmRKb2JFeGVjdXRpb25Nb2RlfSBleGVjdXRpb25Nb2RlIC0gRXhlY3V0aW9uIG1vZGUuXG4gKiBAcHJvcGVydHkge3N0cmluZ30gam9iSWQgLSBOZXcgam9iIGlkLlxuICogQHByb3BlcnR5IHtzdHJpbmd9IGpvYk5hbWUgLSBKb2IgbmFtZS5cbiAqIEBwcm9wZXJ0eSB7bnVtYmVyfSBtYXhSZXRyaWVzIC0gUmV0cnkgY2FwLlxuICogQHByb3BlcnR5IHtzdHJpbmd9IHF1ZXVlIC0gUXVldWUgbmFtZS5cbiAqIEBwcm9wZXJ0eSB7bnVtYmVyfSBzY2hlZHVsZWRBdE1zIC0gRWxpZ2liaWxpdHkgdGltZXN0YW1wLlxuICogQHByb3BlcnR5IHtudW1iZXIgfCBudWxsfSB0aW1lb3V0TXMgLSBQZXItam9iIHRpbWVvdXQgb3ZlcnJpZGUsIG9yIG51bGwgd2hlbiBvbWl0dGVkLlxuICovXG5cbi8qKlxuICogQmFja2dyb3VuZEpvYk9ycGhhblNlbGVjdGlvbiB0eXBlLlxuICogQHR5cGVkZWYge29iamVjdH0gQmFja2dyb3VuZEpvYk9ycGhhblNlbGVjdGlvblxuICogQHByb3BlcnR5IHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59IGNvbmRpdGlvbnMgLSBFeGFjdCB1cGRhdGUgZmVuY2UuXG4gKiBAcHJvcGVydHkge2ltcG9ydChcIi4vdHlwZXMuanNcIikuQmFja2dyb3VuZEpvYlJvd30gam9iIC0gU2VsZWN0ZWQgYWN0aXZlIGhhbmRvZmYuXG4gKi9cblxuLyoqXG4gKiBCYWNrZ3JvdW5kSm9iVHJhbnNhY3Rpb25TZXJpYWxpemF0aW9uT3B0aW9ucyB0eXBlLlxuICogQHR5cGVkZWYge29iamVjdH0gQmFja2dyb3VuZEpvYlRyYW5zYWN0aW9uU2VyaWFsaXphdGlvbk9wdGlvbnNcbiAqIEBwcm9wZXJ0eSB7e2ZhaWx1cmVNZXNzYWdlOiBzdHJpbmcsIG5hbWU6IHN0cmluZ319IFthZHZpc29yeUxvY2tdIC0gU2Vzc2lvbiBsb2NrIGhlbGQgYXJvdW5kIHRoZSB0cmFuc2FjdGlvbi5cbiAqL1xuXG4vKipcbiAqIEJhY2tncm91bmRKb2JDb25jdXJyZW5jeUNvdW50Um93IHR5cGUuXG4gKiBAdHlwZWRlZiB7b2JqZWN0fSBCYWNrZ3JvdW5kSm9iQ29uY3VycmVuY3lDb3VudFJvd1xuICogQHByb3BlcnR5IHtudW1iZXIgfCBzdHJpbmd9IGFjdGl2ZV9jb3VudCAtIFBlcnNpc3RlZCBvciBhZ2dyZWdhdGVkIGFjdGl2ZSBjb3VudC5cbiAqIEBwcm9wZXJ0eSB7c3RyaW5nfSBjb25jdXJyZW5jeV9rZXkgLSBEdXJhYmxlIGNhcCBpZGVudGl0eS5cbiAqL1xuXG5jb25zdCBNSUdSQVRJT05TX1RBQkxFID0gXCJ2ZWxvY2lvdXNfaW50ZXJuYWxfbWlncmF0aW9uc1wiXG5jb25zdCBNSUdSQVRJT05fU0NPUEUgPSBcImJhY2tncm91bmRfam9ic1wiXG5jb25zdCBNSUdSQVRJT05fVkVSU0lPTiA9IFwiMjAyNTAyMTUwMDAwMDBcIlxuY29uc3QgU0NIRU1BX1JFQ09WRVJZX1BFTkRJTkdfVkVSU0lPTiA9IFwic2NoZW1hLXJlY292ZXJ5LXBlbmRpbmdcIlxuY29uc3QgRVhFQ1VUSU9OX01PREVfQkFDS0ZJTExfTUlHUkFUSU9OX1ZFUlNJT04gPSBcIjIwMjYwNjA3MTMxMDEwXCJcbi8vIERyb3BzIHRoZSByZWR1bmRhbnQgbGVnYWN5IGBmb3JrZWRgIGJvb2xlYW4gY29sdW1uIGFuZCByZXdyaXRlcyBwb29sZWQgcm93cyB0b1xuLy8gcGVyc2lzdCBgZXhlY3V0aW9uX21vZGUgPSBcInBvb2xlZFwiYCBkaXJlY3RseSAocmV0aXJpbmcgdGhlIHBvb2xlZC1hcy1mb3JrZWRcbi8vIGhhbmRvZmYtbWFya2VyIHdvcmthcm91bmQpLCBsZWF2aW5nIGBleGVjdXRpb25fbW9kZWAgYXMgdGhlIHNpbmdsZSBzb3VyY2Ugb2Zcbi8vIHRydXRoIGZvciBhIGpvYidzIHJ1bnRpbWUuXG5jb25zdCBEUk9QX0ZPUktFRF9DT0xVTU5fTUlHUkFUSU9OX1ZFUlNJT04gPSBcIjIwMjYwNzE5MDAwMDAwXCJcbmNvbnN0IEpPQlNfSU5ERVhfUkVQQUlSX01JR1JBVElPTl9WRVJTSU9OID0gXCIyMDI2MDkwMzEyMDAwMFwiXG4vLyBMZWdhY3kgbWFya2VyIHByZWZpeCB1c2VkIGJ5IHJvd3Mgd3JpdHRlbiBiZWZvcmUgdGhpcyBtaWdyYXRpb246IHBvb2xlZCBqb2JzXG4vLyB1c2VkIHRvIHBlcnNpc3QgYXMgYGV4ZWN1dGlvbl9tb2RlID0gXCJmb3JrZWRcImAgcGx1cyBhIGB2ZWxvY2lvdXMtcG9vbGVkOipgXG4vLyBoYW5kb2ZmIGlkLiBSZXRhaW5lZCBvbmx5IHRvIGRldGVjdCBhbmQgY29udmVydCB0aG9zZSByb3dzIGluIHRoZSBtaWdyYXRpb24uXG5jb25zdCBMRUdBQ1lfUE9PTEVEX0hBTkRPRkZfSURfUFJFRklYID0gXCJ2ZWxvY2lvdXMtcG9vbGVkOlwiXG5jb25zdCBMRUdBQ1lfUE9PTEVEX1FVRVVFRF9IQU5ET0ZGX0lEID0gYCR7TEVHQUNZX1BPT0xFRF9IQU5ET0ZGX0lEX1BSRUZJWH1xdWV1ZWRgXG5jb25zdCBKT0JTX1RBQkxFID0gXCJiYWNrZ3JvdW5kX2pvYnNcIlxuY29uc3QgSk9CU19JTkRFWF9DT0xVTU5fTkFNRVMgPSBbXG4gIFwiam9iX25hbWVcIixcbiAgXCJxdWV1ZVwiLFxuICBcInN0YXR1c1wiLFxuICBcInNjaGVkdWxlZF9hdF9tc1wiLFxuICBcImNyZWF0ZWRfYXRfbXNcIixcbiAgXCJzY2hlZHVsZV9rZXlcIixcbiAgXCJoYW5kZWRfb2ZmX2F0X21zXCIsXG4gIFwib3JwaGFuZWRfYXRfbXNcIixcbiAgXCJjb25jdXJyZW5jeV9rZXlcIlxuXVxuY29uc3QgSURFTVBPVEVOQ1lfS0VZU19UQUJMRSA9IFwiYmFja2dyb3VuZF9qb2JfaWRlbXBvdGVuY3lfa2V5c1wiXG5jb25zdCBTQ0hFRFVMRV9LRVlTX1RBQkxFID0gXCJiYWNrZ3JvdW5kX2pvYl9zY2hlZHVsZV9rZXlzXCJcbmNvbnN0IENPTkNVUlJFTkNZX1RBQkxFID0gXCJiYWNrZ3JvdW5kX2pvYl9jb25jdXJyZW5jeVwiXG5jb25zdCBDT1VOVFNfUkVWSVNJT05fVEFCTEUgPSBcImJhY2tncm91bmRfam9iX2NvdW50X3JldmlzaW9uc1wiXG5jb25zdCBDT1VOVFNfUkVWSVNJT05fS0VZID0gXCJjb3VudHNcIlxuY29uc3QgQ09OQ1VSUkVOQ1lfUkVDT05DSUxJQVRJT05fTE9DSyA9IFwiYmFja2dyb3VuZC1qb2JzOnF1ZXVlLWNvbmN1cnJlbmN5LXJlY29uY2lsZVwiXG5jb25zdCBDT05DVVJSRU5DWV9SRVBBSVJfU0FNUExFX0xJTUlUID0gMTBcbmV4cG9ydCBjb25zdCBCQUNLR1JPVU5EX0pPQl9DT1VOVFNfQ0hBTk5FTCA9IFwidmVsb2Npb3VzLWJhY2tncm91bmQtam9iLWNvdW50c1wiXG5leHBvcnQgY29uc3QgQkFDS0dST1VORF9KT0JfQ09VTlRfQlVDS0VUUyA9IFtcImFsbFwiLCBcInF1ZXVlZFwiLCBcImhhbmRlZF9vZmZcIiwgXCJjb21wbGV0ZWRcIiwgXCJmYWlsZWRcIiwgXCJvcnBoYW5lZFwiXVxuY29uc3QgQ09VTlRFRF9KT0JfU1RBVFVTRVMgPSBCQUNLR1JPVU5EX0pPQl9DT1VOVF9CVUNLRVRTLnNsaWNlKDEpXG5jb25zdCBNQVhfSk9CX1RJTUVPVVRfTVMgPSAyXzE0N180ODNfNjQ3XG5jb25zdCBKT0JfVElNRU9VVF9WQUxJREFUSU9OX01FU1NBR0UgPSBgYmFja2dyb3VuZCBqb2IgdGltZW91dE1zIG11c3QgYmUgYSBmaW5pdGUgbm9uLXBvc2l0aXZlIG51bWJlciBvciBhbiBpbnRlZ2VyIGJldHdlZW4gMSBhbmQgJHtNQVhfSk9CX1RJTUVPVVRfTVN9YFxuY29uc3QgT1JQSEFORURfQUZURVJfTVMgPSAyICogNjAgKiA2MCAqIDEwMDBcblxuLyoqXG4gKiBDb2x1bW5zIHRoZSBkYXNoYm9hcmQgaXMgYWxsb3dlZCB0byBzb3J0IGpvYiBsaXN0aW5ncyBieSwgbWFwcGVkIHRvIHRoZWlyXG4gKiBkYXRhYmFzZSBjb2x1bW4gbmFtZXMuIFJlc3RyaWN0aW5nIHRvIHRoaXMgc2V0IGtlZXBzIHRoZSBzb3J0IHBhcmFtZXRlclxuICogKHdoaWNoIG9yaWdpbmF0ZXMgZnJvbSB1bnRydXN0ZWQgcXVlcnkgc3RyaW5ncykgZnJvbSByZWFjaGluZyByYXcgU1FMLlxuICogQHR5cGUge1JlY29yZDxzdHJpbmcsIHN0cmluZz59XG4gKi9cbmNvbnN0IFNPUlRBQkxFX0NPTFVNTlMgPSB7XG4gIGF0dGVtcHRzOiBcImF0dGVtcHRzXCIsXG4gIGNvbXBsZXRlZEF0TXM6IFwiY29tcGxldGVkX2F0X21zXCIsXG4gIGNyZWF0ZWRBdE1zOiBcImNyZWF0ZWRfYXRfbXNcIixcbiAgZmFpbGVkQXRNczogXCJmYWlsZWRfYXRfbXNcIixcbiAgaGFuZGVkT2ZmQXRNczogXCJoYW5kZWRfb2ZmX2F0X21zXCIsXG4gIHNjaGVkdWxlZEF0TXM6IFwic2NoZWR1bGVkX2F0X21zXCJcbn1cblxuLyoqXG4gKiBTZXJpYWxpemVzIGNvbmN1cnJlbnQgYF9hcHBseVNjaGVtYWAgcnVucyB3aXRoaW4gVEhJUyBwcm9jZXNzLCBrZXllZCBieSBkYXRhYmFzZVxuICogaWRlbnRpZmllciwgYmVmb3JlIGNhbGxlcnMgd2l0aG91dCBhbiBleGlzdGluZyBjb25uZWN0aW9uIGNoZWNrIG9uZSBvdXQuIFR3b1xuICogc3RvcmVzIHRoYXQgc2hhcmUgb25lIGNvbm5lY3Rpb24gKFNpbmdsZU11bHRpVXNlIC8gU1FMaXRlKVxuICogb3RoZXJ3aXNlIGludGVybGVhdmUgdGhlIG11bHRpLXN0ZXAgdGFibGUgcmVidWlsZCBhbmQgY29ycnVwdCBpdCAodGhlIGpvYnMgdGFibGVcbiAqIGlzIGxlZnQgYXMgaXRzIGAqX3ZlbG9jaW91c19yZWJ1aWxkYCB0ZW1wKS4gQSBEQiBhZHZpc29yeSBsb2NrIGNhbid0IGZpeCB0aGF0OiBvblxuICogYSBzZXNzaW9uLXNjb3BlZCAvIHJlLWVudHJhbnQgZHJpdmVyIChNeVNRTCBgR0VUX0xPQ0tgKSBhIHNlY29uZCBhY3F1aXJlIG9uIHRoZVxuICogc2FtZSBzZXNzaW9uIHN1Y2NlZWRzIGltbWVkaWF0ZWx5IHNvIGJvdGggY2FsbGVycyBwcm9jZWVkLCBhbmQgdGFraW5nIGl0IG9uIGFcbiAqIHNlcGFyYXRlIGNvbm5lY3Rpb24gYmxvY2tzIGNyb3NzLXNlc3Npb24gZm9yZXZlci4gQW4gaW4tcHJvY2VzcyBwcm9taXNlLWNoYWluXG4gKiBtdXRleCBzZXJpYWxpemVzIHNhbWUtcHJvY2VzcyBjYWxsZXJzIHdpdGggbmVpdGhlciBoYXphcmQuIENyb3NzLXByb2Nlc3Mgc2NoZW1hXG4gKiByYWNlcyBzdGF5IGNvdmVyZWQgYnkgdGhlIHBlci1zdGVwIGFkdmlzb3J5IGxvY2tzICsgcmVjaGVja3MgaW5zaWRlIHRoZSBzdGVwcy5cbiAqIEB0eXBlIHtNYXA8c3RyaW5nLCBQcm9taXNlPHZvaWQ+Pn1cbiAqL1xuY29uc3Qgc2NoZW1hQXBwbHlDaGFpbnMgPSBuZXcgTWFwKClcbi8qKiBAdHlwZSB7TWFwPHN0cmluZywgUHJvbWlzZTx2b2lkPj59ICovXG5jb25zdCB0cmFuc2FjdGlvbk11dGF0aW9uQ2hhaW5zID0gbmV3IE1hcCgpXG5cbmV4cG9ydCBkZWZhdWx0IGNsYXNzIEJhY2tncm91bmRKb2JzU3RvcmUgZXh0ZW5kcyBCYWNrZ3JvdW5kSm9ic0FkYXB0ZXIge1xuICAvKipcbiAgICogUnVucyBjb25zdHJ1Y3Rvci5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBPcHRpb25zLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL2NvbmZpZ3VyYXRpb24uanNcIikuZGVmYXVsdH0gYXJncy5jb25maWd1cmF0aW9uIC0gQ29uZmlndXJhdGlvbi5cbiAgICogQHBhcmFtIHtzdHJpbmd9IFthcmdzLmRhdGFiYXNlSWRlbnRpZmllcl0gLSBEYXRhYmFzZSBpZGVudGlmaWVyLlxuICAgKi9cbiAgY29uc3RydWN0b3Ioe2NvbmZpZ3VyYXRpb24sIGRhdGFiYXNlSWRlbnRpZmllcn0pIHtcbiAgICBzdXBlcigpXG4gICAgdGhpcy5jb25maWd1cmF0aW9uID0gY29uZmlndXJhdGlvblxuICAgIHRoaXMuZGF0YWJhc2VJZGVudGlmaWVyID0gZGF0YWJhc2VJZGVudGlmaWVyXG4gICAgdGhpcy5sb2dnZXIgPSBuZXcgTG9nZ2VyKHRoaXMpXG4gICAgdGhpcy5fcmVhZHlQcm9taXNlID0gbnVsbFxuICAgIHRoaXMuX3F1ZXVlQ29uY3VycmVuY3lSZWNvbmNpbGVkID0gZmFsc2VcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGdldCBkYXRhYmFzZSBpZGVudGlmaWVyLlxuICAgKiBAcmV0dXJucyB7c3RyaW5nfSAtIERhdGFiYXNlIGlkZW50aWZpZXIuXG4gICAqL1xuICBnZXREYXRhYmFzZUlkZW50aWZpZXIoKSB7XG4gICAgaWYgKHRoaXMuZGF0YWJhc2VJZGVudGlmaWVyKSByZXR1cm4gdGhpcy5kYXRhYmFzZUlkZW50aWZpZXJcblxuICAgIHJldHVybiB0aGlzLmNvbmZpZ3VyYXRpb24uZ2V0QmFja2dyb3VuZEpvYnNDb25maWcoKS5kYXRhYmFzZUlkZW50aWZpZXJcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGVuc3VyZSByZWFkeS5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgd2hlbiByZWFkeS5cbiAgICovXG4gIGFzeW5jIGVuc3VyZVJlYWR5KCkge1xuICAgIGlmICh0aGlzLl9yZWFkeVByb21pc2UpIHJldHVybiBhd2FpdCB0aGlzLl9yZWFkeVByb21pc2VcblxuICAgIHRoaXMuX3JlYWR5UHJvbWlzZSA9IChhc3luYyAoKSA9PiB7XG4gICAgICB0aGlzLmNvbmZpZ3VyYXRpb24uc2V0Q3VycmVudCgpXG4gICAgICBhd2FpdCB0aGlzLl9lbnN1cmVTY2hlbWEoKVxuICAgICAgYXdhaXQgdGhpcy5faW5pdGlhbGl6ZU1vZGVsKClcbiAgICB9KSgpXG5cbiAgICB0cnkge1xuICAgICAgYXdhaXQgdGhpcy5fcmVhZHlQcm9taXNlXG4gICAgfSBmaW5hbGx5IHtcbiAgICAgIHRoaXMuX3JlYWR5UHJvbWlzZSA9IG51bGxcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogRW5zdXJlcyB0aGUgYmFja2dyb3VuZC1qb2JzIHNjaGVtYSAodGFibGVzICsgY29sdW1ucykgZXhpc3RzIG9uIHRoZSBjb25maWd1cmVkXG4gICAqIGRhdGFiYXNlLCB3aXRob3V0IGluaXRpYWxpemluZyB0aGUgcnVudGltZSBtb2RlbC4gTGV0cyBgZGI6bWlncmF0ZWAgY3JlYXRlIHRoZVxuICAgKiBmcmFtZXdvcmsncyBvd24gc2NoZW1hIGRldGVybWluaXN0aWNhbGx5IGFsb25nc2lkZSBhcHAgbWlncmF0aW9ucyDigJQgYW5kIGNhcHR1cmVcbiAgICogaXQgaW4gdGhlIGR1bXBlZCBzdHJ1Y3R1cmUgU1FMIOKAlCBpbnN0ZWFkIG9mIGl0IG9ubHkgYXBwZWFyaW5nIG9uY2UgYSBzdG9yZSBib290cy5cbiAgICogSWRlbXBvdGVudDogcmV1c2VzIHRoZSBzYW1lIGBfZW5zdXJlU2NoZW1hYCB0aGUgcnVudGltZSBzdG9yZSB1c2VzLCB3aGljaCBza2lwc1xuICAgKiB3b3JrIGFscmVhZHkgYXBwbGllZCAodHJhY2tlZCBpbiBgdmVsb2Npb3VzX2ludGVybmFsX21pZ3JhdGlvbnNgKS5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9kYXRhYmFzZS9kcml2ZXJzL2Jhc2UuanNcIikuZGVmYXVsdH0gW2RiXSAtIFJldXNlIGFuIGFscmVhZHlcbiAgICogICBjaGVja2VkLW91dCBjb25uZWN0aW9uIChlLmcuIHRoZSBvbmUgYGRiOm1pZ3JhdGVgIGhvbGRzKSByYXRoZXIgdGhhbiBvcGVuaW5nIGFcbiAgICogICBuZXN0ZWQgY2hlY2tvdXQgdGhhdCB3b3VsZCBkZWFkbG9jayBhIHNpbmdsZS1jb25uZWN0aW9uIHBvb2wuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIHdoZW4gdGhlIHNjaGVtYSBpcyBwcmVzZW50LlxuICAgKi9cbiAgYXN5bmMgZW5zdXJlU2NoZW1hKGRiKSB7XG4gICAgLy8gV2hlbiBhIGNvbm5lY3Rpb24gaXMgaGFuZGVkIGluICh0aGUgZGI6bWlncmF0ZSBwYXRoKSwgdGhlIGNhbGxlciBhbHJlYWR5IG93bnNcbiAgICAvLyB0aGUgYWN0aXZlIGNvbmZpZ3VyYXRpb24gKyBjb25uZWN0aW9uIGNvbnRleHQ7IGNhbGxpbmcgc2V0Q3VycmVudCgpIGhlcmUgd291bGRcbiAgICAvLyBjbG9iYmVyIGl0IChlLmcuIHRoZSBicm93c2VyIHRlc3QgcnVubmVyIGp1Z2dsZXMgbXVsdGlwbGUgY29uZmlndXJhdGlvbnMpLlxuICAgIGlmICghZGIpIHRoaXMuY29uZmlndXJhdGlvbi5zZXRDdXJyZW50KClcblxuICAgIGF3YWl0IHRoaXMuX2Vuc3VyZVNjaGVtYShkYilcbiAgfVxuXG4gIC8qKlxuICAgKiBSZWNvbmNpbGVzIHF1ZXVlLWRlcml2ZWQgY29uY3VycmVuY3kgd2l0aCB0aGUgY3VycmVudCBjb25maWd1cmF0aW9uOiB0aGVcbiAgICogZXhwbGljaXQgbGlmZWN5Y2xlIHBhdGggdGhhdCBhZG9wdHMvcmVsZWFzZXMgcGVyc2lzdGVkIHF1ZXVlZCBqb2JzIG9udG9cbiAgICogcXVldWUgY29uY3VycmVuY3kga2V5cyB3aGVuIGBxdWV1ZXNbbmFtZV0ubWF4Q29uY3VycmVudGAgaXMgYWRkZWQsIHJlbW92ZWQsXG4gICAqIG9yIGNoYW5nZWQuIENhbGxlZCBieSB0aGUgYmFja2dyb3VuZC1qb2JzIG1haW4gcHJvY2VzcyBvbiBzdGFydHVwIOKAlCB0aGVcbiAgICogZGVwbG95LXRpbWUgbW9tZW50IHF1ZXVlIGNvbmZpZ3VyYXRpb24gY2hhbmdlcyB0YWtlIGVmZmVjdC4gU2NoZW1hL3RlbmFudFxuICAgKiBjaGVja3MgYW5kIHJvdXRpbmUgY29ubmVjdGlvbiBpbml0aWFsaXphdGlvbiBkZWxpYmVyYXRlbHkgbmV2ZXIgcnVuIHRoaXM6XG4gICAqIHRoZXkgc3RheSByZWFkLW9ubHkgcmVnYXJkaW5nIHF1ZXVlZCBqb2Igcm93cywgYmVjYXVzZSB0aGUgYnJvYWRcbiAgICogYWRvcHRpb24vcmVsZWFzZSBVUERBVEVzIGRlYWRsb2NrIGFnYWluc3QgYWN0aXZlIGpvYiBwcm9jZXNzZXMgdW5kZXJcbiAgICogY29uY3VycmVudCB0ZW5hbnQgaW5pdGlhbGl6YXRpb24uIFNlcmlhbGl6ZWQgYWNyb3NzIHByb2Nlc3NlcyB3aXRoIGFcbiAgICogZGF0YWJhc2UgYWR2aXNvcnkgbG9jayBzbyBjb25jdXJyZW50bHkgc3RhcnRlZCBtYWlucyBjYW5ub3QgaW50ZXJsZWF2ZSB0aGVcbiAgICogVVBEQVRFczsgdGhlIHBlci1pbnN0YW5jZSBtZW1vIG9ubHkgc2tpcHMgcmVwZWF0IHdvcmsgd2l0aGluIHRoaXMgcHJvY2Vzcy5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgd2hlbiByZWNvbmNpbGVkLlxuICAgKi9cbiAgYXN5bmMgcmVjb25jaWxlUXVldWVDb25jdXJyZW5jeSgpIHtcbiAgICBpZiAodGhpcy5fcXVldWVDb25jdXJyZW5jeVJlY29uY2lsZWQpIHJldHVyblxuXG4gICAgY29uc3QgZGF0YWJhc2VJZGVudGlmaWVyID0gdGhpcy5nZXREYXRhYmFzZUlkZW50aWZpZXIoKVxuICAgIGNvbnN0IHN0YXJ0ZWRBdE1zID0gRGF0ZS5ub3coKVxuXG4gICAgYXdhaXQgdGhpcy5sb2dnZXIuaW5mbygoKSA9PiBbXG4gICAgICBcIlN0YXJ0aW5nIGJhY2tncm91bmQgam9icyBxdWV1ZS1jb25jdXJyZW5jeSBzdGFydHVwIHJlY29uY2lsaWF0aW9uXCIsXG4gICAgICB7ZGF0YWJhc2VJZGVudGlmaWVyfVxuICAgIF0pXG4gICAgYXdhaXQgdGhpcy5lbnN1cmVSZWFkeSgpXG5cbiAgICBhd2FpdCB0aGlzLl93aXRoRGIoYXN5bmMgKGRiKSA9PiB7XG4gICAgICBjb25zdCBhY3F1aXJlZCA9IGF3YWl0IGRiLmFjcXVpcmVBZHZpc29yeUxvY2soQ09OQ1VSUkVOQ1lfUkVDT05DSUxJQVRJT05fTE9DSylcblxuICAgICAgaWYgKCFhY3F1aXJlZCkgdGhyb3cgbmV3IEVycm9yKFwiRmFpbGVkIHRvIGFjcXVpcmUgYmFja2dyb3VuZCBqb2IgcXVldWUtY29uY3VycmVuY3kgcmVjb25jaWxlIGxvY2tcIilcblxuICAgICAgdHJ5IHtcbiAgICAgICAgYXdhaXQgdGhpcy5fcmVjb25jaWxlUXVldWVDb25jdXJyZW5jeShkYilcbiAgICAgICAgYXdhaXQgdGhpcy5fcmVjb25jaWxlQ29uY3VycmVuY3koZGIpXG5cbiAgICAgICAgLy8gTGF0Y2ggdGhlIG1lbW8gb25seSBhZnRlciBCT1RIIHN0ZXBzIHN1Y2NlZWQ6IGlmIHRoZSBjb3VudCByZWJ1aWxkXG4gICAgICAgIC8vIGZhaWxzIGFmdGVyIGFkb3B0aW9uLCBhIHJldHJ5IG9uIHRoaXMgc3RvcmUgbXVzdCByZS1lbnRlciBhbmQgcmVwYWlyXG4gICAgICAgIC8vIHRoZSBjb3VudHMgKGFkb3B0aW9uIGl0c2VsZiBpcyBpZGVtcG90ZW50KS5cbiAgICAgICAgdGhpcy5fcXVldWVDb25jdXJyZW5jeVJlY29uY2lsZWQgPSB0cnVlXG4gICAgICB9IGZpbmFsbHkge1xuICAgICAgICBhd2FpdCBkYi5yZWxlYXNlQWR2aXNvcnlMb2NrKENPTkNVUlJFTkNZX1JFQ09OQ0lMSUFUSU9OX0xPQ0spXG4gICAgICB9XG4gICAgfSlcblxuICAgIGF3YWl0IHRoaXMubG9nZ2VyLmluZm8oKCkgPT4gW1xuICAgICAgXCJDb21wbGV0ZWQgYmFja2dyb3VuZCBqb2JzIHF1ZXVlLWNvbmN1cnJlbmN5IHN0YXJ0dXAgcmVjb25jaWxpYXRpb25cIixcbiAgICAgIHtkYXRhYmFzZUlkZW50aWZpZXIsIGR1cmF0aW9uTXM6IERhdGUubm93KCkgLSBzdGFydGVkQXRNc31cbiAgICBdKVxuICB9XG5cbiAgLyoqXG4gICAqIFJlcGFpcnMgZHVyYWJsZSBhY3RpdmUtY291bnQgZHJpZnQgd2hpbGUgYSBtYWluIHByb2Nlc3MgcmVtYWlucyBsaXZlLiBUaGVcbiAgICogaW5pdGlhbCBzbmFwc2hvdCBpcyByZWFkLW9ubHk7IG9ubHkgc3VzcGVjdGVkIG1pc21hdGNoZXMgdGFrZSB0aGVpclxuICAgKiBjb3VudGVyIGxvY2sgYW5kIHJlLWNvdW50IGluc2lkZSB0aGUgc2VyaWFsaXplZCB0cmFuc2FjdGlvbiBwYXRoLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxpbXBvcnQoXCIuL3R5cGVzLmpzXCIpLkJhY2tncm91bmRKb2JDb25jdXJyZW5jeVJlY29uY2lsaWF0aW9uPn0gLSBSZXBhaXIgc3VtbWFyeS5cbiAgICovXG4gIGFzeW5jIHJlY29uY2lsZUFjdGl2ZUNvbmN1cnJlbmN5KCkge1xuICAgIGNvbnN0IGRhdGFiYXNlSWRlbnRpZmllciA9IHRoaXMuZ2V0RGF0YWJhc2VJZGVudGlmaWVyKClcbiAgICBjb25zdCBzdGFydGVkQXRNcyA9IERhdGUubm93KClcblxuICAgIGF3YWl0IHRoaXMuZW5zdXJlUmVhZHkoKVxuXG4gICAgY29uc3QgcmVzdWx0ID0gYXdhaXQgdGhpcy5fc2VyaWFsaXplZFRyYW5zYWN0aW9uTXV0YXRpb24oXG4gICAgICBhc3luYyAoZGIpID0+IGF3YWl0IHRoaXMuX3JlY29uY2lsZUNvbmN1cnJlbmN5KGRiLCB7aW5zaWRlVHJhbnNhY3Rpb246IHRydWV9KSxcbiAgICAgIHtcbiAgICAgICAgYWR2aXNvcnlMb2NrOiB7XG4gICAgICAgICAgZmFpbHVyZU1lc3NhZ2U6IFwiRmFpbGVkIHRvIGFjcXVpcmUgYmFja2dyb3VuZCBqb2IgYWN0aXZlLWNvbmN1cnJlbmN5IHJlY29uY2lsZSBsb2NrXCIsXG4gICAgICAgICAgbmFtZTogQ09OQ1VSUkVOQ1lfUkVDT05DSUxJQVRJT05fTE9DS1xuICAgICAgICB9XG4gICAgICB9XG4gICAgKVxuXG4gICAgaWYgKHJlc3VsdC5yZXBhaXJlZENvdW50ID4gMCkge1xuICAgICAgYXdhaXQgdGhpcy5sb2dnZXIud2FybigoKSA9PiBbXG4gICAgICAgIFwiUmVwYWlyZWQgYmFja2dyb3VuZCBqb2JzIGFjdGl2ZS1jb25jdXJyZW5jeSBjb3VudCBkcmlmdFwiLFxuICAgICAgICB7XG4gICAgICAgICAgZGF0YWJhc2VJZGVudGlmaWVyLFxuICAgICAgICAgIGR1cmF0aW9uTXM6IERhdGUubm93KCkgLSBzdGFydGVkQXRNcyxcbiAgICAgICAgICByZXBhaXJlZENvdW50OiByZXN1bHQucmVwYWlyZWRDb3VudCxcbiAgICAgICAgICByZXBhaXJzOiByZXN1bHQucmVwYWlycyxcbiAgICAgICAgICByZXBhaXJzVHJ1bmNhdGVkQ291bnQ6IHJlc3VsdC5yZXBhaXJzVHJ1bmNhdGVkQ291bnRcbiAgICAgICAgfVxuICAgICAgXSlcbiAgICB9XG5cbiAgICByZXR1cm4gcmVzdWx0XG4gIH1cblxuICAvKipcbiAgICogUnVucyBlbnF1ZXVlLlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIE9wdGlvbnMuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBhcmdzLmpvYk5hbWUgLSBKb2IgbmFtZS5cbiAgICogQHBhcmFtIHtBcnJheTxSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59IGFyZ3MuYXJncyAtIEFyZ3VtZW50cy5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL3R5cGVzLmpzXCIpLkJhY2tncm91bmRKb2JPcHRpb25zfSBbYXJncy5vcHRpb25zXSAtIE9wdGlvbnMuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHN0cmluZz59IC0gSm9iIGlkLlxuICAgKi9cbiAgYXN5bmMgZW5xdWV1ZSh7am9iTmFtZSwgYXJncywgb3B0aW9uc30pIHtcbiAgICBhd2FpdCB0aGlzLmVuc3VyZVJlYWR5KClcblxuICAgIGNvbnN0IHByZXBhcmVkSm9iID0gdGhpcy5fcHJlcGFyZUpvYih7am9iTmFtZSwgYXJncywgb3B0aW9uc30pXG5cbiAgICBpZiAob3B0aW9ucz8uaWRlbXBvdGVuY3lLZXkgIT09IHVuZGVmaW5lZCkge1xuICAgICAgcmV0dXJuIGF3YWl0IHRoaXMuX2VucXVldWVJZGVtcG90ZW50bHkoe2FyZ3M6IGFyZ3MgfHwgW10sIG9wdGlvbnMsIHByZXBhcmVkSm9ifSlcbiAgICB9XG5cbiAgICAvKiogQHR5cGUge3N0cmluZ30gKi9cbiAgICBsZXQgcmVzdWx0Sm9iSWQgPSBwcmVwYXJlZEpvYi5qb2JJZFxuXG4gICAgYXdhaXQgdGhpcy5fc2VyaWFsaXplZENvdW50TXV0YXRpb24oYXN5bmMgKGRiKSA9PiB7XG4gICAgICBpZiAob3B0aW9ucz8uZGVkdXBsaWNhdGVXaGlsZVF1ZXVlZCkge1xuICAgICAgICAvLyBEZWR1cGUgb24gdGhlIGpvYidzIGlkZW50aXR5IChuYW1lICsgYXJncyArIHF1ZXVlKSwgTk9UIGl0cyBjb25jdXJyZW5jeSBrZXksIHNvIGEgam9iXG4gICAgICAgIC8vIGtlZXBzIHdoYXRldmVyIGNvbmN1cnJlbmN5IGl0IHJlc29sdmVzIHRvLiBPbmx5IGFuIGV4aXN0aW5nIGpvYiBzY2hlZHVsZWQgbm8gbGF0ZXIgdGhhblxuICAgICAgICAvLyB0aGlzIGVucXVldWUgY2FuIGNvdmVyIGl0OyBhIHJldHJ5IGJhY2tlZCBvZmYgaW50byB0aGUgZnV0dXJlIG11c3Qgbm90IHN1cHByZXNzIGVhcmxpZXJcbiAgICAgICAgLy8gd29yay4gT3JkZXJpbmcgcmV0dXJucyB0aGUgZWFybGllc3QgY292ZXJpbmcgam9iIHdoZW4gc2V2ZXJhbCBxdWV1ZWQgcm93cyBhbHJlYWR5IGV4aXN0LlxuICAgICAgICBjb25zdCBleGlzdGluZyA9IGF3YWl0IGRiXG4gICAgICAgICAgLm5ld1F1ZXJ5KClcbiAgICAgICAgICAuZnJvbShKT0JTX1RBQkxFKVxuICAgICAgICAgIC5zZWxlY3QoXCJpZFwiKVxuICAgICAgICAgIC53aGVyZSh7c3RhdHVzOiBcInF1ZXVlZFwiLCBqb2JfbmFtZTogam9iTmFtZSwgYXJnc19qc29uOiBwcmVwYXJlZEpvYi5hcmdzSnNvbiwgcXVldWU6IHByZXBhcmVkSm9iLnF1ZXVlfSlcbiAgICAgICAgICAud2hlcmUoYHNjaGVkdWxlZF9hdF9tcyA8PSAke2RiLnF1b3RlKHByZXBhcmVkSm9iLnNjaGVkdWxlZEF0TXMpfWApXG4gICAgICAgICAgLm9yZGVyKFwic2NoZWR1bGVkX2F0X21zIEFTQ1wiKVxuICAgICAgICAgIC5saW1pdCgxKVxuICAgICAgICAgIC5yZXN1bHRzKClcblxuICAgICAgICBpZiAoZXhpc3RpbmdbMF0pIHtcbiAgICAgICAgICByZXN1bHRKb2JJZCA9IFN0cmluZygvKiogQHR5cGUge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gKi8gKGV4aXN0aW5nWzBdKS5pZClcblxuICAgICAgICAgIHJldHVyblxuICAgICAgICB9XG4gICAgICB9XG5cbiAgICAgIGF3YWl0IHRoaXMuX2luc2VydFByZXBhcmVkSm9iKGRiLCB7cHJlcGFyZWRKb2IsIHNjaGVkdWxlS2V5OiBudWxsfSlcbiAgICAgIGF3YWl0IHRoaXMuX3JlY29yZENvdW50RGVsdGEoZGIsIHthbGw6IDEsIHF1ZXVlZDogMX0pXG4gICAgfSlcblxuICAgIHJldHVybiByZXN1bHRKb2JJZFxuICB9XG5cbiAgLyoqXG4gICAqIEF0b21pY2FsbHkgb3ducyBvbmUgZHVyYWJsZSBpZGVtcG90ZW5jeSBzY29wZSBhbmQgY3JlYXRlcyBpdHMgam9iIGV4YWN0bHkgb25jZS5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBFbnF1ZXVlIGlucHV0LlxuICAgKiBAcGFyYW0ge0FycmF5PFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gYXJncy5hcmdzIC0gSm9iIGFyZ3VtZW50cy5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL3R5cGVzLmpzXCIpLkJhY2tncm91bmRKb2JPcHRpb25zfSBhcmdzLm9wdGlvbnMgLSBKb2Igb3B0aW9ucy5cbiAgICogQHBhcmFtIHtQcmVwYXJlZEJhY2tncm91bmRKb2J9IGFyZ3MucHJlcGFyZWRKb2IgLSBOb3JtYWxpemVkIGpvYi5cbiAgICogQHJldHVybnMge1Byb21pc2U8c3RyaW5nPn0gLSBTdGFibGUgb3JpZ2luYWwgam9iIGlkLlxuICAgKi9cbiAgYXN5bmMgX2VucXVldWVJZGVtcG90ZW50bHkoe2FyZ3MsIG9wdGlvbnMsIHByZXBhcmVkSm9ifSkge1xuICAgIGNvbnN0IGlkZW1wb3RlbmN5S2V5ID0gdGhpcy5fbm9ybWFsaXplSWRlbXBvdGVuY3lLZXkob3B0aW9ucy5pZGVtcG90ZW5jeUtleSlcbiAgICBjb25zdCBzY29wZURpZ2VzdCA9IHRoaXMuX2lkZW1wb3RlbmN5U2NvcGVEaWdlc3Qoe2lkZW1wb3RlbmN5S2V5LCBqb2JOYW1lOiBwcmVwYXJlZEpvYi5qb2JOYW1lLCBxdWV1ZTogcHJlcGFyZWRKb2IucXVldWV9KVxuICAgIGNvbnN0IHJlcXVlc3REaWdlc3QgPSB0aGlzLl9pZGVtcG90ZW5jeVJlcXVlc3REaWdlc3Qoe2FyZ3MsIG9wdGlvbnMsIHByZXBhcmVkSm9ifSlcbiAgICBjb25zdCBvd25lcnNoaXAgPSB7XG4gICAgICBjcmVhdGVkX2F0X21zOiBwcmVwYXJlZEpvYi5jcmVhdGVkQXRNcyxcbiAgICAgIGlkZW1wb3RlbmN5X2tleTogaWRlbXBvdGVuY3lLZXksXG4gICAgICBqb2JfaWQ6IHByZXBhcmVkSm9iLmpvYklkLFxuICAgICAgam9iX25hbWU6IHByZXBhcmVkSm9iLmpvYk5hbWUsXG4gICAgICBxdWV1ZTogcHJlcGFyZWRKb2IucXVldWUsXG4gICAgICByZXF1ZXN0X2RpZ2VzdDogcmVxdWVzdERpZ2VzdCxcbiAgICAgIHNjb3BlX2RpZ2VzdDogc2NvcGVEaWdlc3RcbiAgICB9XG4gICAgY29uc3QgbWFpbE9wZXJhdGlvbklucHV0ID0gbWFpbERlbGl2ZXJ5T3BlcmF0aW9uRm9ySm9iKHByZXBhcmVkSm9iLmpvYk5hbWUsIGFyZ3MpXG5cbiAgICBpZiAobWFpbE9wZXJhdGlvbklucHV0ICYmIG1haWxPcGVyYXRpb25JbnB1dC5vcGVyYXRpb24uaWQgIT09IGlkZW1wb3RlbmN5S2V5KSB7XG4gICAgICB0aHJvdyBWZWxvY2lvdXNFcnJvci5zYWZlKFwiTWFpbCBkZWxpdmVyeSBvcGVyYXRpb24gaWQgbXVzdCBlcXVhbCBpdHMgYmFja2dyb3VuZCBqb2IgaWRlbXBvdGVuY3kga2V5LlwiLCB7XG4gICAgICAgIGNvZGU6IFwibWFpbC1kZWxpdmVyeS1pZGVtcG90ZW5jeS1rZXktbWlzbWF0Y2hcIlxuICAgICAgfSlcbiAgICB9XG5cbiAgICAvLyBSZXVzZSBvcmRpbmFyeSBlbnF1ZXVlIHRyYW5zYWN0aW9uIGFkbWlzc2lvbiBiZWNhdXNlIHRoaXMgcGF0aCBjaGFuZ2VzXG4gICAgLy8gdGhlIHNhbWUgZHVyYWJsZSBjb3VudCByZXZpc2lvbi4gVGhlIHNjb3BlIHByaW1hcnkga2V5IHJlbWFpbnMgdGhlXG4gICAgLy8gY3Jvc3MtcHJvY2VzcyBjb252ZXJnZW5jZSBvd25lci5cbiAgICByZXR1cm4gYXdhaXQgdGhpcy5faWRlbXBvdGVudEVucXVldWVUcmFuc2FjdGlvbihhc3luYyAoZGIpID0+IHtcbiAgICAgIGNvbnN0IGV4aXN0aW5nID0gYXdhaXQgdGhpcy5faWRlbXBvdGVuY3lPd25lcnNoaXAoZGIsIHNjb3BlRGlnZXN0KVxuXG4gICAgICBpZiAoZXhpc3RpbmcpIHtcbiAgICAgICAgdGhpcy5fdmFsaWRhdGVJZGVtcG90ZW5jeU93bmVyc2hpcCh7ZXhpc3RpbmcsIG93bmVyc2hpcH0pXG4gICAgICAgIGF3YWl0IHRoaXMuX3ZhbGlkYXRlTWFpbERlbGl2ZXJ5T3BlcmF0aW9uKGRiLCB7am9iSWQ6IFN0cmluZyhleGlzdGluZy5qb2JfaWQpLCBtYWlsT3BlcmF0aW9uSW5wdXR9KVxuICAgICAgICByZXR1cm4gU3RyaW5nKGV4aXN0aW5nLmpvYl9pZClcbiAgICAgIH1cblxuICAgICAgY29uc3QgY2xhaW1lZCA9IGF3YWl0IHRoaXMuX2NsYWltSWRlbXBvdGVuY3lPd25lcnNoaXAoZGIsIG93bmVyc2hpcClcblxuICAgICAgaWYgKCFjbGFpbWVkLmNyZWF0ZWQpIHtcbiAgICAgICAgdGhpcy5fdmFsaWRhdGVJZGVtcG90ZW5jeU93bmVyc2hpcCh7ZXhpc3Rpbmc6IGNsYWltZWQucm93LCBvd25lcnNoaXB9KVxuICAgICAgICBhd2FpdCB0aGlzLl92YWxpZGF0ZU1haWxEZWxpdmVyeU9wZXJhdGlvbihkYiwge2pvYklkOiBTdHJpbmcoY2xhaW1lZC5yb3cuam9iX2lkKSwgbWFpbE9wZXJhdGlvbklucHV0fSlcbiAgICAgICAgcmV0dXJuIFN0cmluZyhjbGFpbWVkLnJvdy5qb2JfaWQpXG4gICAgICB9XG5cbiAgICAgIGF3YWl0IHRoaXMuX2xvY2tDb3VudFJldmlzaW9uKGRiKVxuICAgICAgYXdhaXQgdGhpcy5faW5zZXJ0UHJlcGFyZWRKb2IoZGIsIHtwcmVwYXJlZEpvYiwgc2NoZWR1bGVLZXk6IG51bGx9KVxuICAgICAgYXdhaXQgdGhpcy5fcGVyc2lzdE1haWxEZWxpdmVyeU9wZXJhdGlvbihkYiwge2pvYklkOiBwcmVwYXJlZEpvYi5qb2JJZCwgbWFpbE9wZXJhdGlvbklucHV0LCBjcmVhdGVkQXRNczogcHJlcGFyZWRKb2IuY3JlYXRlZEF0TXN9KVxuICAgICAgYXdhaXQgdGhpcy5fcmVjb3JkQ291bnREZWx0YShkYiwge2FsbDogMSwgcXVldWVkOiAxfSlcblxuICAgICAgcmV0dXJuIHByZXBhcmVkSm9iLmpvYklkXG4gICAgfSlcbiAgfVxuXG4gIC8qKlxuICAgKiBTZXJpYWxpemVzIG9uZSBwaHlzaWNhbCBjb25uZWN0aW9uIGxvY2FsbHkgd2l0aG91dCB0YWtpbmcgb3duZXJzaGlwIGF3YXlcbiAgICogZnJvbSB0aGUgZGF0YWJhc2UgdW5pcXVlbmVzcyBjb25zdHJhaW50IHNoYXJlZCBieSBhbGwgcHJvY2Vzc2VzLlxuICAgKiBAdGVtcGxhdGUgVFxuICAgKiBAcGFyYW0geyhkYjogaW1wb3J0KFwiLi4vZGF0YWJhc2UvZHJpdmVycy9iYXNlLmpzXCIpLmRlZmF1bHQpID0+IFByb21pc2U8VD59IGNhbGxiYWNrIC0gVHJhbnNhY3Rpb24gd29yay5cbiAgICogQHJldHVybnMge1Byb21pc2U8VD59IC0gQ2FsbGJhY2sgcmVzdWx0LlxuICAgKi9cbiAgYXN5bmMgX2lkZW1wb3RlbnRFbnF1ZXVlVHJhbnNhY3Rpb24oY2FsbGJhY2spIHtcbiAgICByZXR1cm4gYXdhaXQgdGhpcy5fc2VyaWFsaXplZFRyYW5zYWN0aW9uTXV0YXRpb24oY2FsbGJhY2spXG4gIH1cblxuICAvKipcbiAgICogSW5zZXJ0cyBhbiBvd25lcnNoaXAgcm93LCByZXNvbHZpbmcgb25seSBhIGRhdGFiYXNlIHVuaXF1ZW5lc3MgcmFjZS5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9kYXRhYmFzZS9kcml2ZXJzL2Jhc2UuanNcIikuZGVmYXVsdH0gZGIgLSBUcmFuc2FjdGlvbiBjb25uZWN0aW9uLlxuICAgKiBAcGFyYW0ge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gb3duZXJzaGlwIC0gT3duZXJzaGlwIHJvdy5cbiAgICogQHJldHVybnMge1Byb21pc2U8e2NyZWF0ZWQ6IGJvb2xlYW4sIHJvdzogUmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fT59IC0gQ2xhaW0gcmVzdWx0LlxuICAgKi9cbiAgYXN5bmMgX2NsYWltSWRlbXBvdGVuY3lPd25lcnNoaXAoZGIsIG93bmVyc2hpcCkge1xuICAgIHRyeSB7XG4gICAgICAvLyBUaGUgc2F2ZXBvaW50IGtlZXBzIFBvc3RncmVTUUwncyBvdXRlciB0cmFuc2FjdGlvbiB1c2FibGUgYWZ0ZXIgYVxuICAgICAgLy8gY29uY3VycmVudCB1bmlxdWUta2V5IGxvc3MuIFRoZSB1bmlxdWUgcHJpbWFyeSBrZXksIG5vdCBhIHByb2Nlc3NcbiAgICAgIC8vIG11dGV4LCBpcyB0aGUgY3Jvc3MtcHJvY2VzcyBjb252ZXJnZW5jZSBhdXRob3JpdHkuXG4gICAgICBhd2FpdCBkYi50cmFuc2FjdGlvbihhc3luYyAoKSA9PiB7XG4gICAgICAgIGF3YWl0IGRiLmluc2VydCh7dGFibGVOYW1lOiBJREVNUE9URU5DWV9LRVlTX1RBQkxFLCBkYXRhOiBvd25lcnNoaXB9KVxuICAgICAgfSlcblxuICAgICAgcmV0dXJuIHtjcmVhdGVkOiB0cnVlLCByb3c6IG93bmVyc2hpcH1cbiAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgY29uc3QgcmFjZWQgPSBhd2FpdCB0aGlzLl9pZGVtcG90ZW5jeU93bmVyc2hpcChkYiwgU3RyaW5nKG93bmVyc2hpcC5zY29wZV9kaWdlc3QpKVxuXG4gICAgICBpZiAoIXJhY2VkKSB0aHJvdyBlcnJvclxuICAgICAgcmV0dXJuIHtjcmVhdGVkOiBmYWxzZSwgcm93OiByYWNlZH1cbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogTG9hZHMgb25lIGR1cmFibGUgZW5xdWV1ZSBvd25lci5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9kYXRhYmFzZS9kcml2ZXJzL2Jhc2UuanNcIikuZGVmYXVsdH0gZGIgLSBEYXRhYmFzZSBjb25uZWN0aW9uLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gc2NvcGVEaWdlc3QgLSBGaXhlZC1zaXplIHNjb3BlIGRpZ2VzdC5cbiAgICogQHJldHVybnMge1Byb21pc2U8UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+IHwgbnVsbD59IC0gUm93IG9yIG51bGwuXG4gICAqL1xuICBhc3luYyBfaWRlbXBvdGVuY3lPd25lcnNoaXAoZGIsIHNjb3BlRGlnZXN0KSB7XG4gICAgY29uc3Qgcm93cyA9IGF3YWl0IGRiLm5ld1F1ZXJ5KCkuZnJvbShJREVNUE9URU5DWV9LRVlTX1RBQkxFKS53aGVyZSh7c2NvcGVfZGlnZXN0OiBzY29wZURpZ2VzdH0pLmxpbWl0KDEpLnJlc3VsdHMoKVxuXG4gICAgcmV0dXJuIHJvd3NbMF0gPyAvKiogQHR5cGUge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gKi8gKHJvd3NbMF0pIDogbnVsbFxuICB9XG5cbiAgLyoqXG4gICAqIEZhaWxzIGNsb3NlZCB3aGVuIGEgZHVyYWJsZSBrZXkgaXMgcmV1c2VkIGZvciBhIGRpZmZlcmVudCBjYW5vbmljYWwgcmVxdWVzdC5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBWYWxpZGF0aW9uIGlucHV0LlxuICAgKiBAcGFyYW0ge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gYXJncy5leGlzdGluZyAtIFN0b3JlZCBvd25lci5cbiAgICogQHBhcmFtIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59IGFyZ3Mub3duZXJzaGlwIC0gUmVxdWVzdGVkIG93bmVyLlxuICAgKiBAcmV0dXJucyB7dm9pZH1cbiAgICovXG4gIF92YWxpZGF0ZUlkZW1wb3RlbmN5T3duZXJzaGlwKHtleGlzdGluZywgb3duZXJzaGlwfSkge1xuICAgIGNvbnN0IGV4YWN0U2NvcGUgPSBTdHJpbmcoZXhpc3Rpbmcuam9iX25hbWUpID09PSBvd25lcnNoaXAuam9iX25hbWVcbiAgICAgICYmIFN0cmluZyhleGlzdGluZy5xdWV1ZSkgPT09IG93bmVyc2hpcC5xdWV1ZVxuICAgICAgJiYgU3RyaW5nKGV4aXN0aW5nLmlkZW1wb3RlbmN5X2tleSkgPT09IG93bmVyc2hpcC5pZGVtcG90ZW5jeV9rZXlcblxuICAgIGlmICghZXhhY3RTY29wZSB8fCBTdHJpbmcoZXhpc3RpbmcucmVxdWVzdF9kaWdlc3QpICE9PSBvd25lcnNoaXAucmVxdWVzdF9kaWdlc3QpIHtcbiAgICAgIHRocm93IFZlbG9jaW91c0Vycm9yLnNhZmUoXCJUaGUgYmFja2dyb3VuZCBqb2IgaWRlbXBvdGVuY3kga2V5IHdhcyBhbHJlYWR5IHVzZWQgZm9yIGEgZGlmZmVyZW50IHJlcXVlc3QuXCIsIHtcbiAgICAgICAgY29kZTogXCJiYWNrZ3JvdW5kLWpvYi1pZGVtcG90ZW5jeS1jb25mbGljdFwiXG4gICAgICB9KVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBQZXJzaXN0cyB0aGUgYnVpbHQtaW4gbWFpbCBvcGVyYXRpb24gaW4gdGhlIHNhbWUgZmlyc3QtZW5xdWV1ZSB0cmFuc2FjdGlvbi5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9kYXRhYmFzZS9kcml2ZXJzL2Jhc2UuanNcIikuZGVmYXVsdH0gZGIgLSBUcmFuc2FjdGlvbiBjb25uZWN0aW9uLlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIE9wZXJhdGlvbiBpbnB1dC5cbiAgICogQHBhcmFtIHtudW1iZXJ9IGFyZ3MuY3JlYXRlZEF0TXMgLSBDcmVhdGlvbiB0aW1lc3RhbXAuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBhcmdzLmpvYklkIC0gTmF0aXZlIGpvYiBpZC5cbiAgICogQHBhcmFtIHt7b3BlcmF0aW9uOiBpbXBvcnQoXCIuLi9tYWlsZXIvaW5kZXguanNcIikuTWFpbGVyRGVsaXZlcnlPcGVyYXRpb24sIHBheWxvYWQ6IGltcG9ydChcIi4uL21haWxlci9pbmRleC5qc1wiKS5NYWlsZXJEZWxpdmVyeVBheWxvYWR9IHwgbnVsbH0gYXJncy5tYWlsT3BlcmF0aW9uSW5wdXQgLSBNYWlsIG9wZXJhdGlvbi5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgYWZ0ZXIgcGVyc2lzdGVuY2UuXG4gICAqL1xuICBhc3luYyBfcGVyc2lzdE1haWxEZWxpdmVyeU9wZXJhdGlvbihkYiwge2NyZWF0ZWRBdE1zLCBqb2JJZCwgbWFpbE9wZXJhdGlvbklucHV0fSkge1xuICAgIGlmICghbWFpbE9wZXJhdGlvbklucHV0KSByZXR1cm5cbiAgICBjb25zdCB7b3BlcmF0aW9ufSA9IG1haWxPcGVyYXRpb25JbnB1dFxuICAgIGNvbnN0IG9wZXJhdGlvbktleSA9IG1haWxEZWxpdmVyeU9wZXJhdGlvbktleShvcGVyYXRpb24uaWQpXG4gICAgY29uc3Qgcm93ID0ge1xuICAgICAgYmFja2dyb3VuZF9qb2JfaWQ6IGpvYklkLFxuICAgICAgY3JlYXRlZF9hdF9tczogY3JlYXRlZEF0TXMsXG4gICAgICBmaXJzdF9hdHRlbXB0X3N0YXJ0ZWRfYXRfbXM6IG51bGwsXG4gICAgICBvcGVyYXRpb25faWQ6IG9wZXJhdGlvbi5pZCxcbiAgICAgIG9wZXJhdGlvbl9rZXk6IG9wZXJhdGlvbktleSxcbiAgICAgIHBheWxvYWRfZGlnZXN0OiBvcGVyYXRpb24ucGF5bG9hZERpZ2VzdCxcbiAgICAgIHByb3ZpZGVyX2tpbmQ6IG9wZXJhdGlvbi5wcm92aWRlcktpbmQsXG4gICAgICBwcm92aWRlcl9yZXRlbnRpb25fbXM6IG9wZXJhdGlvbi5wcm92aWRlclJldGVudGlvbk1zXG4gICAgfVxuXG4gICAgdHJ5IHtcbiAgICAgIGF3YWl0IGRiLnRyYW5zYWN0aW9uKGFzeW5jICgpID0+IHtcbiAgICAgICAgYXdhaXQgZGIuaW5zZXJ0KHt0YWJsZU5hbWU6IE1BSUxfREVMSVZFUllfT1BFUkFUSU9OU19UQUJMRSwgZGF0YTogcm93fSlcbiAgICAgIH0pXG4gICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgIGNvbnN0IGV4aXN0aW5nID0gYXdhaXQgdGhpcy5fbWFpbERlbGl2ZXJ5T3BlcmF0aW9uKGRiLCBvcGVyYXRpb25LZXkpXG5cbiAgICAgIGlmICghZXhpc3RpbmcpIHRocm93IGVycm9yXG4gICAgICB0aGlzLl92YWxpZGF0ZU1haWxEZWxpdmVyeU9wZXJhdGlvblJvdyh7ZXhpc3RpbmcsIHJlcXVlc3RlZDogcm93fSlcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogVmFsaWRhdGVzIHRoZSBkdXJhYmxlIG1haWwgcm93IGR1cmluZyBhbiBleGFjdCBnZW5lcmljIGVucXVldWUgcmVwbGF5LlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL2RhdGFiYXNlL2RyaXZlcnMvYmFzZS5qc1wiKS5kZWZhdWx0fSBkYiAtIERhdGFiYXNlIGNvbm5lY3Rpb24uXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gVmFsaWRhdGlvbiBpbnB1dC5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGFyZ3Muam9iSWQgLSBPd25lZCBqb2IgaWQuXG4gICAqIEBwYXJhbSB7e29wZXJhdGlvbjogaW1wb3J0KFwiLi4vbWFpbGVyL2luZGV4LmpzXCIpLk1haWxlckRlbGl2ZXJ5T3BlcmF0aW9uLCBwYXlsb2FkOiBpbXBvcnQoXCIuLi9tYWlsZXIvaW5kZXguanNcIikuTWFpbGVyRGVsaXZlcnlQYXlsb2FkfSB8IG51bGx9IGFyZ3MubWFpbE9wZXJhdGlvbklucHV0IC0gTWFpbCBvcGVyYXRpb24uXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIHdoZW4gZXhhY3QuXG4gICAqL1xuICBhc3luYyBfdmFsaWRhdGVNYWlsRGVsaXZlcnlPcGVyYXRpb24oZGIsIHtqb2JJZCwgbWFpbE9wZXJhdGlvbklucHV0fSkge1xuICAgIGlmICghbWFpbE9wZXJhdGlvbklucHV0KSByZXR1cm5cbiAgICBjb25zdCB7b3BlcmF0aW9ufSA9IG1haWxPcGVyYXRpb25JbnB1dFxuICAgIGNvbnN0IGV4aXN0aW5nID0gYXdhaXQgdGhpcy5fbWFpbERlbGl2ZXJ5T3BlcmF0aW9uKGRiLCBtYWlsRGVsaXZlcnlPcGVyYXRpb25LZXkob3BlcmF0aW9uLmlkKSlcblxuICAgIGlmICghZXhpc3RpbmcpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihcIkJhY2tncm91bmQgam9iIGlkZW1wb3RlbmN5IG93bmVyc2hpcCBpcyBtaXNzaW5nIGl0cyBkdXJhYmxlIG1haWwgZGVsaXZlcnkgb3BlcmF0aW9uXCIpXG4gICAgfVxuXG4gICAgdGhpcy5fdmFsaWRhdGVNYWlsRGVsaXZlcnlPcGVyYXRpb25Sb3coe1xuICAgICAgZXhpc3RpbmcsXG4gICAgICByZXF1ZXN0ZWQ6IHtcbiAgICAgICAgYmFja2dyb3VuZF9qb2JfaWQ6IGpvYklkLFxuICAgICAgICBvcGVyYXRpb25faWQ6IG9wZXJhdGlvbi5pZCxcbiAgICAgICAgcGF5bG9hZF9kaWdlc3Q6IG9wZXJhdGlvbi5wYXlsb2FkRGlnZXN0LFxuICAgICAgICBwcm92aWRlcl9raW5kOiBvcGVyYXRpb24ucHJvdmlkZXJLaW5kLFxuICAgICAgICBwcm92aWRlcl9yZXRlbnRpb25fbXM6IG9wZXJhdGlvbi5wcm92aWRlclJldGVudGlvbk1zXG4gICAgICB9XG4gICAgfSlcbiAgfVxuXG4gIC8qKlxuICAgKiBMb2FkcyBhIGR1cmFibGUgbWFpbCBvcGVyYXRpb24uXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vZGF0YWJhc2UvZHJpdmVycy9iYXNlLmpzXCIpLmRlZmF1bHR9IGRiIC0gRGF0YWJhc2UgY29ubmVjdGlvbi5cbiAgICogQHBhcmFtIHtzdHJpbmd9IG9wZXJhdGlvbktleSAtIEZpeGVkLXNpemUgb3BlcmF0aW9uIGtleS5cbiAgICogQHJldHVybnMge1Byb21pc2U8UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+IHwgbnVsbD59IC0gUm93IG9yIG51bGwuXG4gICAqL1xuICBhc3luYyBfbWFpbERlbGl2ZXJ5T3BlcmF0aW9uKGRiLCBvcGVyYXRpb25LZXkpIHtcbiAgICBjb25zdCByb3dzID0gYXdhaXQgZGIubmV3UXVlcnkoKS5mcm9tKE1BSUxfREVMSVZFUllfT1BFUkFUSU9OU19UQUJMRSkud2hlcmUoe29wZXJhdGlvbl9rZXk6IG9wZXJhdGlvbktleX0pLmxpbWl0KDEpLnJlc3VsdHMoKVxuXG4gICAgcmV0dXJuIHJvd3NbMF0gPyAvKiogQHR5cGUge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gKi8gKHJvd3NbMF0pIDogbnVsbFxuICB9XG5cbiAgLyoqXG4gICAqIENvbXBhcmVzIHByb3ZpZGVyLXJlbGV2YW50IGR1cmFibGUgbWFpbCBvcGVyYXRpb24gZmllbGRzLlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIFZhbGlkYXRpb24gaW5wdXQuXG4gICAqIEBwYXJhbSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSBhcmdzLmV4aXN0aW5nIC0gU3RvcmVkIHJvdy5cbiAgICogQHBhcmFtIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59IGFyZ3MucmVxdWVzdGVkIC0gUmVxdWVzdGVkIHJvdy5cbiAgICogQHJldHVybnMge3ZvaWR9XG4gICAqL1xuICBfdmFsaWRhdGVNYWlsRGVsaXZlcnlPcGVyYXRpb25Sb3coe2V4aXN0aW5nLCByZXF1ZXN0ZWR9KSB7XG4gICAgY29uc3QgbWF0Y2hlcyA9IFN0cmluZyhleGlzdGluZy5vcGVyYXRpb25faWQpID09PSByZXF1ZXN0ZWQub3BlcmF0aW9uX2lkXG4gICAgICAmJiBTdHJpbmcoZXhpc3RpbmcucGF5bG9hZF9kaWdlc3QpID09PSByZXF1ZXN0ZWQucGF5bG9hZF9kaWdlc3RcbiAgICAgICYmIFN0cmluZyhleGlzdGluZy5iYWNrZ3JvdW5kX2pvYl9pZCkgPT09IHJlcXVlc3RlZC5iYWNrZ3JvdW5kX2pvYl9pZFxuICAgICAgJiYgU3RyaW5nKGV4aXN0aW5nLnByb3ZpZGVyX2tpbmQpID09PSByZXF1ZXN0ZWQucHJvdmlkZXJfa2luZFxuICAgICAgJiYgdGhpcy5fbm9ybWFsaXplTnVtYmVyKGV4aXN0aW5nLnByb3ZpZGVyX3JldGVudGlvbl9tcykgPT09IHJlcXVlc3RlZC5wcm92aWRlcl9yZXRlbnRpb25fbXNcblxuICAgIGlmICghbWF0Y2hlcykge1xuICAgICAgdGhyb3cgVmVsb2Npb3VzRXJyb3Iuc2FmZShcIlRoZSBtYWlsIGRlbGl2ZXJ5IG9wZXJhdGlvbiB3YXMgYWxyZWFkeSB1c2VkIGZvciBhIGRpZmZlcmVudCBwYXlsb2FkIG9yIHByb3ZpZGVyLlwiLCB7XG4gICAgICAgIGNvZGU6IFwibWFpbC1kZWxpdmVyeS1pZGVtcG90ZW5jeS1jb25mbGljdFwiXG4gICAgICB9KVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBDYW5vbmljYWwgcmVxdWVzdCBkaWdlc3QgZXhjbHVkaW5nIGdlbmVyYXRlZCBpZHMgYW5kIGltbWVkaWF0ZSBlbnF1ZXVlIHRpbWUuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gRGlnZXN0IGlucHV0LlxuICAgKiBAcGFyYW0ge0FycmF5PFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gYXJncy5hcmdzIC0gSm9iIGFyZ3VtZW50cy5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL3R5cGVzLmpzXCIpLkJhY2tncm91bmRKb2JPcHRpb25zfSBhcmdzLm9wdGlvbnMgLSBKb2Igb3B0aW9ucy5cbiAgICogQHBhcmFtIHtQcmVwYXJlZEJhY2tncm91bmRKb2J9IGFyZ3MucHJlcGFyZWRKb2IgLSBOb3JtYWxpemVkIGpvYi5cbiAgICogQHJldHVybnMge3N0cmluZ30gLSBTSEEtMjU2IGRpZ2VzdC5cbiAgICovXG4gIF9pZGVtcG90ZW5jeVJlcXVlc3REaWdlc3Qoe2FyZ3MsIG9wdGlvbnMsIHByZXBhcmVkSm9ifSkge1xuICAgIGNvbnN0IHNlcmlhbGl6ZWQgPSBzdGFibGVKc29uU3RyaW5naWZ5KHtcbiAgICAgIGFyZ3MsXG4gICAgICBjb25jdXJyZW5jeTogcHJlcGFyZWRKb2IuY29uY3VycmVuY3ksXG4gICAgICBleGVjdXRpb25Nb2RlOiBwcmVwYXJlZEpvYi5leGVjdXRpb25Nb2RlLFxuICAgICAgZm9ybWF0OiBcInZlbG9jaW91cy1iYWNrZ3JvdW5kLWpvYi1pZGVtcG90ZW5jeS12MVwiLFxuICAgICAgam9iTmFtZTogcHJlcGFyZWRKb2Iuam9iTmFtZSxcbiAgICAgIG1heFJldHJpZXM6IHByZXBhcmVkSm9iLm1heFJldHJpZXMsXG4gICAgICBxdWV1ZTogcHJlcGFyZWRKb2IucXVldWUsXG4gICAgICBzY2hlZHVsZWRBdE1zOiBvcHRpb25zLnNjaGVkdWxlZEF0TXMgPT09IHVuZGVmaW5lZCA/IG51bGwgOiBwcmVwYXJlZEpvYi5zY2hlZHVsZWRBdE1zLFxuICAgICAgc2NoZWR1bGluZzogb3B0aW9ucy5zY2hlZHVsZWRBdE1zID09PSB1bmRlZmluZWQgPyBcImltbWVkaWF0ZVwiIDogXCJzY2hlZHVsZWRcIixcbiAgICAgIC4uLihwcmVwYXJlZEpvYi50aW1lb3V0TXMgPT09IG51bGwgPyB7fSA6IHt0aW1lb3V0TXM6IHByZXBhcmVkSm9iLnRpbWVvdXRNc30pXG4gICAgfSlcblxuICAgIHJldHVybiBjcmVhdGVIYXNoKFwic2hhMjU2XCIpLnVwZGF0ZShzZXJpYWxpemVkKS5kaWdlc3QoXCJoZXhcIilcbiAgfVxuXG4gIC8qKlxuICAgKiBGaXhlZC1zaXplIGdsb2JhbGx5IGluZGV4ZWQgcmVwcmVzZW50YXRpb24gb2YgdGhlIGRvY3VtZW50ZWQgc2NvcGUgdHVwbGUuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gU2NvcGUgaW5wdXQuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBhcmdzLmlkZW1wb3RlbmN5S2V5IC0gQ2FsbGVyIGtleS5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGFyZ3Muam9iTmFtZSAtIEpvYiBjbGFzcyBuYW1lLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gYXJncy5xdWV1ZSAtIFF1ZXVlIG5hbWUuXG4gICAqIEByZXR1cm5zIHtzdHJpbmd9IC0gU0hBLTI1NiBzY29wZSBkaWdlc3QuXG4gICAqL1xuICBfaWRlbXBvdGVuY3lTY29wZURpZ2VzdCh7aWRlbXBvdGVuY3lLZXksIGpvYk5hbWUsIHF1ZXVlfSkge1xuICAgIHJldHVybiBjcmVhdGVIYXNoKFwic2hhMjU2XCIpXG4gICAgICAudXBkYXRlKHN0YWJsZUpzb25TdHJpbmdpZnkoe2Zvcm1hdDogXCJ2ZWxvY2lvdXMtYmFja2dyb3VuZC1qb2ItaWRlbXBvdGVuY3ktc2NvcGUtdjFcIiwgaWRlbXBvdGVuY3lLZXksIGpvYk5hbWUsIHF1ZXVlfSkpXG4gICAgICAuZGlnZXN0KFwiaGV4XCIpXG4gIH1cblxuICAvKipcbiAgICogVmFsaWRhdGVzIG9uZSBjYWxsZXIga2V5LlxuICAgKiBAcGFyYW0ge3N0cmluZyB8IHVuZGVmaW5lZH0gaWRlbXBvdGVuY3lLZXkgLSBDYWxsZXIga2V5LlxuICAgKiBAcmV0dXJucyB7c3RyaW5nfSAtIFZhbGlkIGtleS5cbiAgICovXG4gIF9ub3JtYWxpemVJZGVtcG90ZW5jeUtleShpZGVtcG90ZW5jeUtleSkge1xuICAgIGlmICh0eXBlb2YgaWRlbXBvdGVuY3lLZXkgIT09IFwic3RyaW5nXCIgfHwgaWRlbXBvdGVuY3lLZXkubGVuZ3RoID09PSAwKSB7XG4gICAgICB0aHJvdyBWZWxvY2lvdXNFcnJvci5zYWZlKFwiQmFja2dyb3VuZCBqb2IgaWRlbXBvdGVuY3lLZXkgbXVzdCBiZSBhIG5vbi1lbXB0eSBzdHJpbmcuXCIsIHtcbiAgICAgICAgY29kZTogXCJiYWNrZ3JvdW5kLWpvYi1pZGVtcG90ZW5jeS1rZXktaW52YWxpZFwiXG4gICAgICB9KVxuICAgIH1cblxuICAgIHJldHVybiBpZGVtcG90ZW5jeUtleVxuICB9XG5cbiAgLyoqXG4gICAqIFJlcGxhY2VzIHRoZSBxdWV1ZWQgb3duZXIgb2YgYSBzdGFibGUgc2NoZWR1bGUga2V5IHdpdGggYSBuZXcgb25lLW9mZiBqb2IuXG4gICAqIEEgaGFuZGVkLW9mZiBvd25lciBpcyBsZWZ0IHJ1bm5pbmcgYW5kIHJlcG9ydGVkIHRydXRoZnVsbHkuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gT3B0aW9ucy5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGFyZ3Muc2NoZWR1bGVLZXkgLSBTdGFibGUgbG9naWNhbCBzY2hlZHVsZSBrZXkuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBhcmdzLmpvYk5hbWUgLSBKb2IgbmFtZS5cbiAgICogQHBhcmFtIHtBcnJheTxSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59IGFyZ3MuYXJncyAtIEFyZ3VtZW50cy5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL3R5cGVzLmpzXCIpLkJhY2tncm91bmRKb2JPcHRpb25zfSBbYXJncy5vcHRpb25zXSAtIE9wdGlvbnMuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPGltcG9ydChcIi4vdHlwZXMuanNcIikuQmFja2dyb3VuZEpvYlJlcGxhY2VtZW50UmVzdWx0Pn0gLSBSZXBsYWNlbWVudCByZXN1bHQuXG4gICAqL1xuICBhc3luYyByZXBsYWNlU2NoZWR1bGVkKHtzY2hlZHVsZUtleSwgam9iTmFtZSwgYXJncywgb3B0aW9uc30pIHtcbiAgICBhd2FpdCB0aGlzLmVuc3VyZVJlYWR5KClcblxuICAgIGNvbnN0IG5vcm1hbGl6ZWRTY2hlZHVsZUtleSA9IHRoaXMuX25vcm1hbGl6ZVNjaGVkdWxlS2V5KHNjaGVkdWxlS2V5KVxuICAgIGNvbnN0IHByZXBhcmVkSm9iID0gdGhpcy5fcHJlcGFyZUpvYih7am9iTmFtZSwgYXJncywgb3B0aW9uc30pXG5cbiAgICByZXR1cm4gYXdhaXQgdGhpcy5fc2VyaWFsaXplZENvdW50TXV0YXRpb24oYXN5bmMgKGRiKSA9PiB7XG4gICAgICBjb25zdCBvd25lclJvd3MgPSBhd2FpdCBkYlxuICAgICAgICAubmV3UXVlcnkoKVxuICAgICAgICAuZnJvbShTQ0hFRFVMRV9LRVlTX1RBQkxFKVxuICAgICAgICAud2hlcmUoe3NjaGVkdWxlX2tleTogbm9ybWFsaXplZFNjaGVkdWxlS2V5fSlcbiAgICAgICAgLmxpbWl0KDEpXG4gICAgICAgIC5yZXN1bHRzKClcbiAgICAgIGNvbnN0IG93bmVySm9iSWQgPSBvd25lclJvd3NbMF0gPyBTdHJpbmcoLyoqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59ICovIChvd25lclJvd3NbMF0pLmpvYl9pZCkgOiBudWxsXG4gICAgICBjb25zdCBvd25lckpvYiA9IG93bmVySm9iSWQgPyBhd2FpdCB0aGlzLl9nZXRKb2JSb3dCeUlkKGRiLCBvd25lckpvYklkKSA6IG51bGxcbiAgICAgIC8qKiBAdHlwZSB7aW1wb3J0KFwiLi90eXBlcy5qc1wiKS5CYWNrZ3JvdW5kSm9iUmVwbGFjZW1lbnRQcmV2aW91c1N0YXR1c30gKi9cbiAgICAgIGxldCBwcmV2aW91c1N0YXR1cyA9IG51bGxcbiAgICAgIGxldCBwcmV2aW91c0pvYklkID0gbnVsbFxuXG4gICAgICBpZiAob3duZXJKb2I/LnN0YXR1cyA9PT0gXCJxdWV1ZWRcIikge1xuICAgICAgICBjb25zdCBhZmZlY3RlZFJvd3MgPSBhd2FpdCB0aGlzLl91cGRhdGVBZmZlY3RlZFJvd3MoZGIsIHtcbiAgICAgICAgICB0YWJsZU5hbWU6IEpPQlNfVEFCTEUsXG4gICAgICAgICAgZGF0YToge3N0YXR1czogXCJjYW5jZWxsZWRcIn0sXG4gICAgICAgICAgY29uZGl0aW9uczoge2lkOiBvd25lckpvYi5pZCwgc3RhdHVzOiBcInF1ZXVlZFwifVxuICAgICAgICB9KVxuXG4gICAgICAgIGlmIChhZmZlY3RlZFJvd3MgPT09IDEpIHtcbiAgICAgICAgICBwcmV2aW91c0pvYklkID0gb3duZXJKb2IuaWRcbiAgICAgICAgICBwcmV2aW91c1N0YXR1cyA9IFwicXVldWVkXCJcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICBjb25zdCBjdXJyZW50T3duZXJKb2IgPSBhd2FpdCB0aGlzLl9nZXRKb2JSb3dCeUlkKGRiLCBvd25lckpvYi5pZClcblxuICAgICAgICAgIGlmIChjdXJyZW50T3duZXJKb2I/LnN0YXR1cyA9PT0gXCJoYW5kZWRfb2ZmXCIpIHtcbiAgICAgICAgICAgIHByZXZpb3VzSm9iSWQgPSBjdXJyZW50T3duZXJKb2IuaWRcbiAgICAgICAgICAgIHByZXZpb3VzU3RhdHVzID0gXCJoYW5kZWRfb2ZmXCJcbiAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICAgIH0gZWxzZSBpZiAob3duZXJKb2I/LnN0YXR1cyA9PT0gXCJoYW5kZWRfb2ZmXCIpIHtcbiAgICAgICAgcHJldmlvdXNKb2JJZCA9IG93bmVySm9iLmlkXG4gICAgICAgIHByZXZpb3VzU3RhdHVzID0gXCJoYW5kZWRfb2ZmXCJcbiAgICAgIH1cblxuICAgICAgYXdhaXQgdGhpcy5faW5zZXJ0UHJlcGFyZWRKb2IoZGIsIHtwcmVwYXJlZEpvYiwgc2NoZWR1bGVLZXk6IG5vcm1hbGl6ZWRTY2hlZHVsZUtleX0pXG4gICAgICBhd2FpdCBkYi51cHNlcnQoe1xuICAgICAgICB0YWJsZU5hbWU6IFNDSEVEVUxFX0tFWVNfVEFCTEUsXG4gICAgICAgIGRhdGE6IHtzY2hlZHVsZV9rZXk6IG5vcm1hbGl6ZWRTY2hlZHVsZUtleSwgam9iX2lkOiBwcmVwYXJlZEpvYi5qb2JJZH0sXG4gICAgICAgIGNvbmZsaWN0Q29sdW1uczogW1wic2NoZWR1bGVfa2V5XCJdLFxuICAgICAgICB1cGRhdGVDb2x1bW5zOiBbXCJqb2JfaWRcIl1cbiAgICAgIH0pXG5cbiAgICAgIGlmIChwcmV2aW91c1N0YXR1cyAhPT0gXCJxdWV1ZWRcIikgYXdhaXQgdGhpcy5fcmVjb3JkQ291bnREZWx0YShkYiwge2FsbDogMSwgcXVldWVkOiAxfSlcbiAgICAgIHJldHVybiB7am9iSWQ6IHByZXBhcmVkSm9iLmpvYklkLCBwcmV2aW91c0pvYklkLCBwcmV2aW91c1N0YXR1c31cbiAgICB9LCB7XG4gICAgICBhZHZpc29yeUxvY2s6IHtcbiAgICAgICAgZmFpbHVyZU1lc3NhZ2U6IFwiRmFpbGVkIHRvIGFjcXVpcmUgYmFja2dyb3VuZCBqb2Igc2NoZWR1bGUta2V5IGxvY2tcIixcbiAgICAgICAgbmFtZTogdGhpcy5fc2NoZWR1bGVLZXlMb2NrTmFtZShub3JtYWxpemVkU2NoZWR1bGVLZXkpXG4gICAgICB9XG4gICAgfSlcbiAgfVxuXG4gIC8qKlxuICAgKiBDYW5jZWxzIHRoZSBxdWV1ZWQgb3duZXIgb2YgYSBzdGFibGUgc2NoZWR1bGUga2V5LiBBIGhhbmRlZC1vZmYgb3duZXIgaXNcbiAgICogZGV0YWNoZWQgYnV0IG5vdCBtYXJrZWQgc3RvcHBlZCBiZWNhdXNlIGV4ZWN1dGlvbiBtYXkgYWxyZWFkeSBiZSBydW5uaW5nLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gc2NoZWR1bGVLZXkgLSBTdGFibGUgbG9naWNhbCBzY2hlZHVsZSBrZXkuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPGltcG9ydChcIi4vdHlwZXMuanNcIikuQmFja2dyb3VuZEpvYkNhbmNlbGxhdGlvblJlc3VsdD59IC0gQ2FuY2VsbGF0aW9uIHJlc3VsdC5cbiAgICovXG4gIGFzeW5jIGNhbmNlbFNjaGVkdWxlZChzY2hlZHVsZUtleSkge1xuICAgIGF3YWl0IHRoaXMuZW5zdXJlUmVhZHkoKVxuXG4gICAgY29uc3Qgbm9ybWFsaXplZFNjaGVkdWxlS2V5ID0gdGhpcy5fbm9ybWFsaXplU2NoZWR1bGVLZXkoc2NoZWR1bGVLZXkpXG5cbiAgICByZXR1cm4gYXdhaXQgdGhpcy5fc2VyaWFsaXplZENvdW50TXV0YXRpb24oYXN5bmMgKGRiKSA9PiB7XG4gICAgICBjb25zdCBvd25lclJvd3MgPSBhd2FpdCBkYlxuICAgICAgICAubmV3UXVlcnkoKVxuICAgICAgICAuZnJvbShTQ0hFRFVMRV9LRVlTX1RBQkxFKVxuICAgICAgICAud2hlcmUoe3NjaGVkdWxlX2tleTogbm9ybWFsaXplZFNjaGVkdWxlS2V5fSlcbiAgICAgICAgLmxpbWl0KDEpXG4gICAgICAgIC5yZXN1bHRzKClcblxuICAgICAgaWYgKCFvd25lclJvd3NbMF0pIHJldHVybiB7am9iSWQ6IG51bGwsIG91dGNvbWU6IFwibm90X2ZvdW5kXCJ9XG5cbiAgICAgIGNvbnN0IGpvYklkID0gU3RyaW5nKC8qKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSAqLyAob3duZXJSb3dzWzBdKS5qb2JfaWQpXG4gICAgICBjb25zdCBqb2IgPSBhd2FpdCB0aGlzLl9nZXRKb2JSb3dCeUlkKGRiLCBqb2JJZClcblxuICAgICAgaWYgKGpvYj8uc3RhdHVzID09PSBcInF1ZXVlZFwiKSB7XG4gICAgICAgIGNvbnN0IGFmZmVjdGVkUm93cyA9IGF3YWl0IHRoaXMuX3VwZGF0ZUFmZmVjdGVkUm93cyhkYiwge1xuICAgICAgICAgIHRhYmxlTmFtZTogSk9CU19UQUJMRSxcbiAgICAgICAgICBkYXRhOiB7c3RhdHVzOiBcImNhbmNlbGxlZFwifSxcbiAgICAgICAgICBjb25kaXRpb25zOiB7aWQ6IGpvYi5pZCwgc3RhdHVzOiBcInF1ZXVlZFwifVxuICAgICAgICB9KVxuXG4gICAgICAgIGlmIChhZmZlY3RlZFJvd3MgPT09IDEpIHtcbiAgICAgICAgICBhd2FpdCB0aGlzLl9yZWxlYXNlU2NoZWR1bGVPd25lcnNoaXAoZGIsIHtqb2JJZCwgc2NoZWR1bGVLZXk6IG5vcm1hbGl6ZWRTY2hlZHVsZUtleX0pXG4gICAgICAgICAgYXdhaXQgdGhpcy5fcmVjb3JkU3RhdHVzVHJhbnNpdGlvbihkYiwgXCJxdWV1ZWRcIiwgXCJjYW5jZWxsZWRcIilcblxuICAgICAgICAgIHJldHVybiB7am9iSWQsIG91dGNvbWU6IFwiY2FuY2VsbGVkXCJ9XG4gICAgICAgIH1cbiAgICAgIH1cblxuICAgICAgY29uc3QgY3VycmVudEpvYiA9IGF3YWl0IHRoaXMuX2dldEpvYlJvd0J5SWQoZGIsIGpvYklkKVxuXG4gICAgICBhd2FpdCB0aGlzLl9yZWxlYXNlU2NoZWR1bGVPd25lcnNoaXAoZGIsIHtqb2JJZCwgc2NoZWR1bGVLZXk6IG5vcm1hbGl6ZWRTY2hlZHVsZUtleX0pXG5cbiAgICAgIGlmIChjdXJyZW50Sm9iPy5zdGF0dXMgPT09IFwiaGFuZGVkX29mZlwiKSByZXR1cm4ge2pvYklkLCBvdXRjb21lOiBcImhhbmRlZF9vZmZcIn1cbiAgICAgIHJldHVybiB7am9iSWQ6IG51bGwsIG91dGNvbWU6IFwibm90X2ZvdW5kXCJ9XG4gICAgfSwge1xuICAgICAgYWR2aXNvcnlMb2NrOiB7XG4gICAgICAgIGZhaWx1cmVNZXNzYWdlOiBcIkZhaWxlZCB0byBhY3F1aXJlIGJhY2tncm91bmQgam9iIHNjaGVkdWxlLWtleSBsb2NrXCIsXG4gICAgICAgIG5hbWU6IHRoaXMuX3NjaGVkdWxlS2V5TG9ja05hbWUobm9ybWFsaXplZFNjaGVkdWxlS2V5KVxuICAgICAgfVxuICAgIH0pXG4gIH1cblxuICAvKipcbiAgICogUnVucyBuZXh0IGF2YWlsYWJsZSBqb2IuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBbYXJnc10gLSBPcHRpb25zLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vdHlwZXMuanNcIikuQmFja2dyb3VuZEpvYkV4ZWN1dGlvbk1vZGUgfCBpbXBvcnQoXCIuL3R5cGVzLmpzXCIpLkJhY2tncm91bmRKb2JFeGVjdXRpb25Nb2RlW119IFthcmdzLmV4ZWN1dGlvbk1vZGVdIC0gRXhlY3V0aW9uIG1vZGUgb3IgbW9kZXMgdG8gbWF0Y2guXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPGltcG9ydChcIi4vdHlwZXMuanNcIikuQmFja2dyb3VuZEpvYlJvdyB8IG51bGw+fSAtIE5leHQgam9iLlxuICAgKi9cbiAgYXN5bmMgbmV4dEF2YWlsYWJsZUpvYihhcmdzID0ge30pIHtcbiAgICBhd2FpdCB0aGlzLmVuc3VyZVJlYWR5KClcblxuICAgIHJldHVybiBhd2FpdCB0aGlzLl93aXRoRGIoYXN5bmMgKGRiKSA9PiB7XG4gICAgICByZXR1cm4gYXdhaXQgdGhpcy5fbmV4dFF1ZXVlZEpvYih7XG4gICAgICAgIGRiLFxuICAgICAgICBzY2hlZHVsZWRBdE9wZXJhdG9yOiBcIjw9XCIsXG4gICAgICAgIGV4ZWN1dGlvbk1vZGU6IGFyZ3MuZXhlY3V0aW9uTW9kZVxuICAgICAgfSlcbiAgICB9KVxuICB9XG5cbiAgLyoqXG4gICAqIFJldHVybnMgdGhlIHNvb25lc3QgZnV0dXJlLXNjaGVkdWxlZCBxdWV1ZWQgam9iIChvbmUgd2hvc2VcbiAgICogYHNjaGVkdWxlZF9hdF9tc2AgaXMgaW4gdGhlIGZ1dHVyZSksIG9yIG51bGwgd2hlbiB0aGVyZSBhcmUgbm9cbiAgICogZnV0dXJlLXNjaGVkdWxlZCBqb2JzLiBVc2VkIGJ5IHRoZSBldmVudC1kcml2ZW4gZGlzcGF0Y2hlciB0byBhcm0gYVxuICAgKiBgc2V0VGltZW91dGAgZm9yIHRoZSBleGFjdCBtb21lbnQgdGhlIG5leHQgc2NoZWR1bGVkIGpvYiBiZWNvbWVzXG4gICAqIGVsaWdpYmxlLCByZXBsYWNpbmcgdGhlIGxlZ2FjeSAxLXNlY29uZCBwb2xsaW5nIGxvb3AuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPGltcG9ydChcIi4vdHlwZXMuanNcIikuQmFja2dyb3VuZEpvYlJvdyB8IG51bGw+fSAtIFNvb25lc3QgZnV0dXJlLXNjaGVkdWxlZCBqb2IsIG9yIG51bGwuXG4gICAqL1xuICBhc3luYyBuZXh0U2NoZWR1bGVkSm9iKCkge1xuICAgIGF3YWl0IHRoaXMuZW5zdXJlUmVhZHkoKVxuXG4gICAgcmV0dXJuIGF3YWl0IHRoaXMuX3dpdGhEYihhc3luYyAoZGIpID0+IHtcbiAgICAgIHJldHVybiBhd2FpdCB0aGlzLl9uZXh0UXVldWVkSm9iKHtkYiwgc2NoZWR1bGVkQXRPcGVyYXRvcjogXCI+XCJ9KVxuICAgIH0pXG4gIH1cblxuICAvKipcbiAgICogUnVucyBuZXh0IHF1ZXVlZCBqb2IuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gT3B0aW9ucy5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9kYXRhYmFzZS9kcml2ZXJzL2Jhc2UuanNcIikuZGVmYXVsdH0gYXJncy5kYiAtIERhdGFiYXNlIGNvbm5lY3Rpb24uXG4gICAqIEBwYXJhbSB7XCI8PVwiIHwgXCI+XCJ9IGFyZ3Muc2NoZWR1bGVkQXRPcGVyYXRvciAtIFNjaGVkdWxlZCB0aW1lc3RhbXAgb3BlcmF0b3IuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi90eXBlcy5qc1wiKS5CYWNrZ3JvdW5kSm9iRXhlY3V0aW9uTW9kZSB8IGltcG9ydChcIi4vdHlwZXMuanNcIikuQmFja2dyb3VuZEpvYkV4ZWN1dGlvbk1vZGVbXX0gW2FyZ3MuZXhlY3V0aW9uTW9kZV0gLSBFeGVjdXRpb24gbW9kZSBvciBtb2RlcyB0byBtYXRjaC5cbiAgICogQHJldHVybnMge1Byb21pc2U8aW1wb3J0KFwiLi90eXBlcy5qc1wiKS5CYWNrZ3JvdW5kSm9iUm93IHwgbnVsbD59IC0gTmV4dCBtYXRjaGluZyBxdWV1ZWQgam9iLlxuICAgKi9cbiAgYXN5bmMgX25leHRRdWV1ZWRKb2Ioe2RiLCBzY2hlZHVsZWRBdE9wZXJhdG9yLCBleGVjdXRpb25Nb2RlfSkge1xuICAgIGNvbnN0IG5vdyA9IERhdGUubm93KClcbiAgICBsZXQgcXVlcnkgPSBkYlxuICAgICAgLm5ld1F1ZXJ5KClcbiAgICAgIC5mcm9tKEpPQlNfVEFCTEUpXG4gICAgICAud2hlcmUoe3N0YXR1czogXCJxdWV1ZWRcIn0pXG4gICAgICAud2hlcmUoYHNjaGVkdWxlZF9hdF9tcyAke3NjaGVkdWxlZEF0T3BlcmF0b3J9ICR7ZGIucXVvdGUobm93KX1gKVxuXG4gICAgaWYgKHNjaGVkdWxlZEF0T3BlcmF0b3IgPT09IFwiPD1cIikge1xuICAgICAgY29uc3Qgam9ic1RhYmxlID0gZGIucXVvdGVUYWJsZShKT0JTX1RBQkxFKVxuICAgICAgY29uc3QgY29uY3VycmVuY3lUYWJsZSA9IGRiLnF1b3RlVGFibGUoQ09OQ1VSUkVOQ1lfVEFCTEUpXG4gICAgICBxdWVyeSA9IHF1ZXJ5LndoZXJlKFxuICAgICAgICBgKCR7am9ic1RhYmxlfS4ke2RiLnF1b3RlQ29sdW1uKFwiY29uY3VycmVuY3lfa2V5XCIpfSBJUyBOVUxMIE9SIEVYSVNUUyAoYCArXG4gICAgICAgIGBTRUxFQ1QgMSBGUk9NICR7Y29uY3VycmVuY3lUYWJsZX0gV0hFUkUgYCArXG4gICAgICAgIGAke2NvbmN1cnJlbmN5VGFibGV9LiR7ZGIucXVvdGVDb2x1bW4oXCJjb25jdXJyZW5jeV9rZXlcIil9ID0gJHtqb2JzVGFibGV9LiR7ZGIucXVvdGVDb2x1bW4oXCJjb25jdXJyZW5jeV9rZXlcIil9IEFORCBgICtcbiAgICAgICAgYCR7Y29uY3VycmVuY3lUYWJsZX0uJHtkYi5xdW90ZUNvbHVtbihcImFjdGl2ZV9jb3VudFwiKX0gPCAke2NvbmN1cnJlbmN5VGFibGV9LiR7ZGIucXVvdGVDb2x1bW4oXCJtYXhfY29uY3VycmVuY3lcIil9KSlgXG4gICAgICApXG4gICAgfVxuXG4gICAgaWYgKGV4ZWN1dGlvbk1vZGUpIHF1ZXJ5ID0gdGhpcy5fd2hlcmVFeGVjdXRpb25Nb2RlKHtkYiwgZXhlY3V0aW9uTW9kZSwgcXVlcnl9KVxuXG4gICAgaWYgKHNjaGVkdWxlZEF0T3BlcmF0b3IgPT09IFwiPD1cIikge1xuICAgICAgY29uc3QgcHJpb3JpdHlPcmRlciA9IHRoaXMuX3F1ZXVlUHJpb3JpdHlPcmRlclNxbChkYilcblxuICAgICAgaWYgKHByaW9yaXR5T3JkZXIpIHF1ZXJ5ID0gcXVlcnkub3JkZXIoYCR7cHJpb3JpdHlPcmRlcn0gREVTQ2ApXG4gICAgfVxuXG4gICAgcXVlcnkgPSBxdWVyeVxuICAgICAgLm9yZGVyKFwic2NoZWR1bGVkX2F0X21zIEFTQ1wiKVxuICAgICAgLm9yZGVyKFwiY3JlYXRlZF9hdF9tcyBBU0NcIilcbiAgICAgIC5saW1pdCgxKVxuXG4gICAgY29uc3Qgcm93cyA9IGF3YWl0IHF1ZXJ5LnJlc3VsdHMoKVxuICAgIGNvbnN0IHJvdyA9IHJvd3NbMF1cblxuICAgIGlmICghcm93KSByZXR1cm4gbnVsbFxuXG4gICAgcmV0dXJuIHRoaXMuX25vcm1hbGl6ZUpvYlJvdyhyb3cpXG4gIH1cblxuICAvKipcbiAgICogQnVpbGRzIGEgcmF3IFNRTCBPUkRFUiBCWSBleHByZXNzaW9uIHJhbmtpbmcgcXVldWVkIGpvYnMgYnkgdGhlaXIgcXVldWUnc1xuICAgKiBjb25maWd1cmVkIHByaW9yaXR5IChgYmFja2dyb3VuZEpvYnMucXVldWVzW3F1ZXVlXS5wcmlvcml0eWAsIGRlZmF1bHQgYDBgKSxcbiAgICogc28gdGhlIGRpc3BhdGNoZXIgcGlja3MgaGlnaGVyLXByaW9yaXR5IHF1ZXVlcyBmaXJzdCByZWdhcmRsZXNzIG9mIGVucXVldWVcbiAgICogb3JkZXIuIE9ubHkgYXBwbGllZCB0byB0aGUgZGlzcGF0Y2ggcGF0aCAoYHNjaGVkdWxlZEF0T3BlcmF0b3IgPT09IFwiPD1cImApO1xuICAgKiB0aGUgZnV0dXJlLXNjaGVkdWxlZCBsb29rdXAgbXVzdCBzdGF5IHN0cmljdGx5IHRpbWUtb3JkZXJlZC4gQ29tcG9zZXMgd2l0aFxuICAgKiB0aGUgY29uY3VycmVuY3kgRVhJU1RTIGZpbHRlcjogYSBoaWdoZXItcHJpb3JpdHkgcXVldWUgYWxyZWFkeSBhdCBpdHMgY2FwIGlzXG4gICAqIGZpbHRlcmVkIG91dCwgc28gZGlzcGF0Y2ggZmFsbHMgdGhyb3VnaCB0byB0aGUgbmV4dCBlbGlnaWJsZSBsb3dlci1wcmlvcml0eVxuICAgKiBqb2IuIFJldHVybnMgbnVsbCB3aGVuIG5vIHF1ZXVlIGNvbmZpZ3VyZXMgYSBub24temVybyBwcmlvcml0eSBzbyB0aGUgcGxhaW5cbiAgICogRklGTyBvcmRlcmluZyBpcyBsZWZ0IHVudG91Y2hlZCAoYW5kIG5vIG5lZWRsZXNzIGZpbGVzb3J0IGlzIGludHJvZHVjZWQpLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL2RhdGFiYXNlL2RyaXZlcnMvYmFzZS5qc1wiKS5kZWZhdWx0fSBkYiAtIERhdGFiYXNlIGNvbm5lY3Rpb24uXG4gICAqIEByZXR1cm5zIHtzdHJpbmcgfCBudWxsfSAtIFJhdyBTUUwgQ0FTRSBleHByZXNzaW9uLCBvciBudWxsIHdoZW4gbm8gcXVldWUgaXMgcHJpb3JpdGl6ZWQuXG4gICAqL1xuICBfcXVldWVQcmlvcml0eU9yZGVyU3FsKGRiKSB7XG4gICAgY29uc3QgcXVldWVzID0gdGhpcy5jb25maWd1cmF0aW9uLmdldEJhY2tncm91bmRKb2JzQ29uZmlnKCkucXVldWVzIHx8IHt9XG4gICAgLyoqIEB0eXBlIHtBcnJheTxbc3RyaW5nLCBudW1iZXJdPn0gKi9cbiAgICBjb25zdCBwcmlvcml0aXplZCA9IFtdXG5cbiAgICBmb3IgKGNvbnN0IFtxdWV1ZSwgcXVldWVDb25maWddIG9mIE9iamVjdC5lbnRyaWVzKHF1ZXVlcykpIHtcbiAgICAgIGNvbnN0IHByaW9yaXR5ID0gcXVldWVDb25maWc/LnByaW9yaXR5XG5cbiAgICAgIGlmIChOdW1iZXIuaXNGaW5pdGUocHJpb3JpdHkpICYmIE51bWJlcihwcmlvcml0eSkgIT09IDApIHByaW9yaXRpemVkLnB1c2goW3F1ZXVlLCBOdW1iZXIocHJpb3JpdHkpXSlcbiAgICB9XG5cbiAgICBpZiAocHJpb3JpdGl6ZWQubGVuZ3RoID09PSAwKSByZXR1cm4gbnVsbFxuXG4gICAgY29uc3QgcXVldWVDb2x1bW4gPSBkYi5xdW90ZUNvbHVtbihcInF1ZXVlXCIpXG4gICAgY29uc3Qgd2hlbnMgPSBwcmlvcml0aXplZFxuICAgICAgLm1hcCgoW3F1ZXVlLCBwcmlvcml0eV0pID0+IGBXSEVOICR7ZGIucXVvdGUocXVldWUpfSBUSEVOICR7cHJpb3JpdHl9YClcbiAgICAgIC5qb2luKFwiIFwiKVxuXG4gICAgcmV0dXJuIGBDQVNFIENPQUxFU0NFKCR7cXVldWVDb2x1bW59LCAke2RiLnF1b3RlKERFRkFVTFRfQkFDS0dST1VORF9KT0JfUVVFVUUpfSkgJHt3aGVuc30gRUxTRSAwIEVORGBcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGdldCBqb2IuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBqb2JJZCAtIEpvYiBpZC5cbiAgICogQHJldHVybnMge1Byb21pc2U8aW1wb3J0KFwiLi90eXBlcy5qc1wiKS5CYWNrZ3JvdW5kSm9iUm93IHwgbnVsbD59IC0gSm9iIHJvdy5cbiAgICovXG4gIGFzeW5jIGdldEpvYihqb2JJZCkge1xuICAgIGF3YWl0IHRoaXMuZW5zdXJlUmVhZHkoKVxuXG4gICAgcmV0dXJuIGF3YWl0IHRoaXMuX3dpdGhEYihhc3luYyAoZGIpID0+IHtcbiAgICAgIGNvbnN0IHF1ZXJ5ID0gZGJcbiAgICAgICAgLm5ld1F1ZXJ5KClcbiAgICAgICAgLmZyb20oSk9CU19UQUJMRSlcbiAgICAgICAgLndoZXJlKHtpZDogam9iSWR9KVxuICAgICAgICAubGltaXQoMSlcblxuICAgICAgY29uc3Qgcm93cyA9IGF3YWl0IHF1ZXJ5LnJlc3VsdHMoKVxuICAgICAgY29uc3Qgcm93ID0gcm93c1swXVxuXG4gICAgICBpZiAoIXJvdykgcmV0dXJuIG51bGxcblxuICAgICAgcmV0dXJuIHRoaXMuX25vcm1hbGl6ZUpvYlJvdyhyb3cpXG4gICAgfSlcbiAgfVxuXG4gIC8qKlxuICAgKiBDb3VudHMgam9icyBncm91cGVkIGJ5IHN0YXR1cy4gVXNlZCBieSB0aGUgZGFzaGJvYXJkIG92ZXJ2aWV3LlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxSZWNvcmQ8c3RyaW5nLCBudW1iZXI+Pn0gLSBDb3VudHMga2V5ZWQgYnkgc3RhdHVzLlxuICAgKi9cbiAgYXN5bmMgY291bnRzQnlTdGF0dXMoKSB7XG4gICAgYXdhaXQgdGhpcy5lbnN1cmVSZWFkeSgpXG5cbiAgICByZXR1cm4gYXdhaXQgdGhpcy5fd2l0aERiKGFzeW5jIChkYikgPT4ge1xuICAgICAgY29uc3Qgcm93cyA9IGF3YWl0IGRiXG4gICAgICAgIC5uZXdRdWVyeSgpXG4gICAgICAgIC5mcm9tKEpPQlNfVEFCTEUpXG4gICAgICAgIC5zZWxlY3QoXCJzdGF0dXNcIilcbiAgICAgICAgLnNlbGVjdChcIkNPVU5UKCopIEFTIGNvdW50XCIpXG4gICAgICAgIC5ncm91cChcInN0YXR1c1wiKVxuICAgICAgICAucmVzdWx0cygpXG5cbiAgICAgIC8qKlxuICAgICAgICogQ291bnRzLlxuICAgICAgICogQHR5cGUge1JlY29yZDxzdHJpbmcsIG51bWJlcj59ICovXG4gICAgICBjb25zdCBjb3VudHMgPSB7fVxuXG4gICAgICBmb3IgKGNvbnN0IHJvdyBvZiByb3dzKSB7XG4gICAgICAgIGNvbnN0IHR5cGVkUm93ID0gLyoqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59ICovIChyb3cpXG5cbiAgICAgICAgY291bnRzW1N0cmluZyh0eXBlZFJvdy5zdGF0dXMpXSA9IHRoaXMuX25vcm1hbGl6ZU51bWJlcih0eXBlZFJvdy5jb3VudCkgfHwgMFxuICAgICAgfVxuXG4gICAgICByZXR1cm4gY291bnRzXG4gICAgfSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSZXR1cm5zIHRoZSBhdXRob3JpdGF0aXZlIGRhc2hib2FyZCBjb3VudCBzbmFwc2hvdCBhbmQgaXRzIG1hdGNoaW5nIGR1cmFibGVcbiAgICogcmV2aXNpb24uIExvY2tpbmcgdGhlIHJldmlzaW9uIHJvdyBiZWZvcmUgY291bnRpbmcgcHJldmVudHMgYSB3cml0ZXIgZnJvbVxuICAgKiBjb21taXR0aW5nIGJldHdlZW4gdGhlIGNvdW50IHF1ZXJ5IGFuZCByZXZpc2lvbiByZWFkLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx7Y291bnRzOiBSZWNvcmQ8c3RyaW5nLCBudW1iZXI+LCByZXZpc2lvbjogbnVtYmVyLCB0b3RhbDogbnVtYmVyfT59IFNuYXBzaG90LlxuICAgKi9cbiAgYXN5bmMgY291bnRTbmFwc2hvdCgpIHtcbiAgICBhd2FpdCB0aGlzLmVuc3VyZVJlYWR5KClcblxuICAgIHJldHVybiBhd2FpdCB0aGlzLl9zZXJpYWxpemVkQ291bnRNdXRhdGlvbihhc3luYyAoZGIpID0+IHtcbiAgICAgIHJldHVybiBhd2FpdCB0aGlzLl9jb3VudFNuYXBzaG90T25Mb2NrZWRDb25uZWN0aW9uKGRiKVxuICAgIH0pXG4gIH1cblxuICAvKipcbiAgICogQ291bnRzIGpvYnMgbWF0Y2hpbmcgdGhlIGdpdmVuIGZpbHRlcnMuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBbYXJnc10gLSBPcHRpb25zLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gW2FyZ3Muc3RhdHVzXSAtIEZpbHRlciBieSBzdGF0dXMuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBbYXJncy5qb2JOYW1lXSAtIEZpbHRlciBieSBqb2IgbmFtZS5cbiAgICogQHJldHVybnMge1Byb21pc2U8bnVtYmVyPn0gLSBNYXRjaGluZyBqb2IgY291bnQuXG4gICAqL1xuICBhc3luYyBjb3VudEpvYnMoe3N0YXR1cywgam9iTmFtZX0gPSB7fSkge1xuICAgIGF3YWl0IHRoaXMuZW5zdXJlUmVhZHkoKVxuXG4gICAgcmV0dXJuIGF3YWl0IHRoaXMuX3dpdGhEYihhc3luYyAoZGIpID0+IHtcbiAgICAgIGxldCBxdWVyeSA9IGRiLm5ld1F1ZXJ5KCkuZnJvbShKT0JTX1RBQkxFKS5zZWxlY3QoXCJDT1VOVCgqKSBBUyBjb3VudFwiKVxuXG4gICAgICBpZiAoc3RhdHVzKSBxdWVyeSA9IHF1ZXJ5LndoZXJlKHtzdGF0dXN9KVxuICAgICAgaWYgKGpvYk5hbWUpIHF1ZXJ5ID0gcXVlcnkud2hlcmUoe2pvYl9uYW1lOiBqb2JOYW1lfSlcblxuICAgICAgY29uc3Qgcm93cyA9IGF3YWl0IHF1ZXJ5LnJlc3VsdHMoKVxuICAgICAgY29uc3QgY291bnRSb3cgPSAvKiogQHR5cGUge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gKi8gKHJvd3NbMF0gfHwge30pXG5cbiAgICAgIHJldHVybiB0aGlzLl9ub3JtYWxpemVOdW1iZXIoY291bnRSb3cuY291bnQpIHx8IDBcbiAgICB9KVxuICB9XG5cbiAgLyoqXG4gICAqIExpc3RzIGpvYnMgZm9yIHRoZSBkYXNoYm9hcmQsIGZpbHRlcmVkLCBzb3J0ZWQgYW5kIHBhZ2luYXRlZC5cbiAgICogQHBhcmFtIHtvYmplY3R9IFthcmdzXSAtIE9wdGlvbnMuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBbYXJncy5zdGF0dXNdIC0gRmlsdGVyIGJ5IHN0YXR1cy5cbiAgICogQHBhcmFtIHtzdHJpbmd9IFthcmdzLmpvYk5hbWVdIC0gRmlsdGVyIGJ5IGpvYiBuYW1lLlxuICAgKiBAcGFyYW0ge251bWJlcn0gW2FyZ3MubGltaXRdIC0gTWF4aW11bSByb3dzIHRvIHJldHVybi5cbiAgICogQHBhcmFtIHtudW1iZXJ9IFthcmdzLm9mZnNldF0gLSBSb3dzIHRvIHNraXAuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBbYXJncy5zb3J0Q29sdW1uXSAtIENhbWVsLWNhc2VkIGNvbHVtbiB0byBzb3J0IGJ5IChzZWUgU09SVEFCTEVfQ09MVU1OUykuXG4gICAqIEBwYXJhbSB7XCJBU0NcIiB8IFwiREVTQ1wifSBbYXJncy5zb3J0RGlyZWN0aW9uXSAtIFNvcnQgZGlyZWN0aW9uLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxpbXBvcnQoXCIuL3R5cGVzLmpzXCIpLkJhY2tncm91bmRKb2JSb3dbXT59IC0gTm9ybWFsaXplZCBqb2Igcm93cy5cbiAgICovXG4gIGFzeW5jIGxpc3RKb2JzKHtzdGF0dXMsIGpvYk5hbWUsIGxpbWl0ID0gMjUsIG9mZnNldCA9IDAsIHNvcnRDb2x1bW4gPSBcImNyZWF0ZWRBdE1zXCIsIHNvcnREaXJlY3Rpb24gPSBcIkRFU0NcIn0gPSB7fSkge1xuICAgIGF3YWl0IHRoaXMuZW5zdXJlUmVhZHkoKVxuXG4gICAgY29uc3QgY29sdW1uID0gU09SVEFCTEVfQ09MVU1OU1tzb3J0Q29sdW1uXSB8fCBTT1JUQUJMRV9DT0xVTU5TLmNyZWF0ZWRBdE1zXG4gICAgY29uc3QgZGlyZWN0aW9uID0gc29ydERpcmVjdGlvbiA9PT0gXCJBU0NcIiA/IFwiQVNDXCIgOiBcIkRFU0NcIlxuXG4gICAgcmV0dXJuIGF3YWl0IHRoaXMuX3dpdGhEYihhc3luYyAoZGIpID0+IHtcbiAgICAgIGxldCBxdWVyeSA9IGRiLm5ld1F1ZXJ5KCkuZnJvbShKT0JTX1RBQkxFKVxuXG4gICAgICBpZiAoc3RhdHVzKSBxdWVyeSA9IHF1ZXJ5LndoZXJlKHtzdGF0dXN9KVxuICAgICAgaWYgKGpvYk5hbWUpIHF1ZXJ5ID0gcXVlcnkud2hlcmUoe2pvYl9uYW1lOiBqb2JOYW1lfSlcblxuICAgICAgcXVlcnkgPSBxdWVyeS5vcmRlcih7Y29sdW1uLCBkaXJlY3Rpb259KVxuICAgICAgaWYgKGNvbHVtbiAhPT0gU09SVEFCTEVfQ09MVU1OUy5jcmVhdGVkQXRNcykgcXVlcnkgPSBxdWVyeS5vcmRlcih7Y29sdW1uOiBTT1JUQUJMRV9DT0xVTU5TLmNyZWF0ZWRBdE1zLCBkaXJlY3Rpb246IFwiREVTQ1wifSlcblxuICAgICAgY29uc3Qgcm93cyA9IGF3YWl0IHF1ZXJ5LmxpbWl0KGxpbWl0KS5vZmZzZXQob2Zmc2V0KS5yZXN1bHRzKClcblxuICAgICAgcmV0dXJuIHJvd3MubWFwKChyb3cpID0+IHRoaXMuX25vcm1hbGl6ZUpvYlJvdyhyb3cpKVxuICAgIH0pXG4gIH1cblxuICAvKipcbiAgICogUnVucyBtYXJrIGhhbmRlZCBvZmYuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gT3B0aW9ucy5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGFyZ3Muam9iSWQgLSBKb2IgaWQuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBbYXJncy5oYW5kb2ZmSWRdIC0gQ2FsbGVyLXNlbGVjdGVkIGV4YWN0IGxlYXNlIGlkLiBHZW5lcmF0ZWQgZm9yIGxlZ2FjeSBkaXJlY3QgY2FsbGVycyB3aGVuIG9taXR0ZWQuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBbYXJncy53b3JrZXJJZF0gLSBXb3JrZXIgaWQuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPGltcG9ydChcIi4vdHlwZXMuanNcIikuQmFja2dyb3VuZEpvYkhhbmRvZmYgfCBudWxsPn0gLSBDbGFpbWVkIGhhbmRvZmYgbGVhc2UsIG9yIG51bGwgd2hlbiBubyBsb25nZXIgcXVldWVkLlxuICAgKi9cbiAgYXN5bmMgbWFya0hhbmRlZE9mZih7am9iSWQsIGhhbmRvZmZJZCA9IHJhbmRvbVVVSUQoKSwgd29ya2VySWR9KSB7XG4gICAgYXdhaXQgdGhpcy5lbnN1cmVSZWFkeSgpXG5cbiAgICBjb25zdCBoYW5kZWRPZmZBdE1zID0gRGF0ZS5ub3coKVxuXG4gICAgcmV0dXJuIGF3YWl0IHRoaXMuX3NlcmlhbGl6ZWRDb3VudE11dGF0aW9uKGFzeW5jIChkYikgPT4ge1xuICAgICAgY29uc3QgcXVldWVkSm9iID0gYXdhaXQgdGhpcy5fZ2V0Sm9iUm93QnlJZChkYiwgam9iSWQpXG4gICAgICBpZiAoIXF1ZXVlZEpvYiB8fCBxdWV1ZWRKb2Iuc3RhdHVzICE9PSBcInF1ZXVlZFwiKSByZXR1cm4gbnVsbFxuICAgICAgaWYgKHF1ZXVlZEpvYi5jb25jdXJyZW5jeUtleSAmJiAhKGF3YWl0IHRoaXMuX3Jlc2VydmVDb25jdXJyZW5jeShkYiwgcXVldWVkSm9iLmNvbmN1cnJlbmN5S2V5KSkpIHJldHVybiBudWxsXG4gICAgICBjb25zdCBhZmZlY3RlZFJvd3MgPSBhd2FpdCB0aGlzLl91cGRhdGVBZmZlY3RlZFJvd3MoZGIsIHtcbiAgICAgICAgdGFibGVOYW1lOiBKT0JTX1RBQkxFLFxuICAgICAgICBkYXRhOiB7XG4gICAgICAgICAgc3RhdHVzOiBcImhhbmRlZF9vZmZcIixcbiAgICAgICAgICBoYW5kZWRfb2ZmX2F0X21zOiBoYW5kZWRPZmZBdE1zLFxuICAgICAgICAgIGhhbmRvZmZfaWQ6IGhhbmRvZmZJZCxcbiAgICAgICAgICB3b3JrZXJfaWQ6IHdvcmtlcklkIHx8IG51bGxcbiAgICAgICAgfSxcbiAgICAgICAgY29uZGl0aW9uczoge2NvbmN1cnJlbmN5X2tleTogcXVldWVkSm9iLmNvbmN1cnJlbmN5S2V5LCBpZDogam9iSWQsIHN0YXR1czogXCJxdWV1ZWRcIn1cbiAgICAgIH0pXG5cbiAgICAgIGlmIChhZmZlY3RlZFJvd3MgIT09IDEpIHtcbiAgICAgICAgYXdhaXQgdGhpcy5fcmVsZWFzZUNvbmN1cnJlbmN5KGRiLCBxdWV1ZWRKb2IuY29uY3VycmVuY3lLZXkpXG4gICAgICAgIHJldHVybiBudWxsXG4gICAgICB9XG5cbiAgICAgIGF3YWl0IHRoaXMuX3JlY29yZFN0YXR1c1RyYW5zaXRpb24oZGIsIFwicXVldWVkXCIsIFwiaGFuZGVkX29mZlwiKVxuICAgICAgcmV0dXJuIHtoYW5kZWRPZmZBdE1zLCBoYW5kb2ZmSWR9XG4gICAgfSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIG1hcmsgY29tcGxldGVkLlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIE9wdGlvbnMuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBhcmdzLmpvYklkIC0gSm9iIGlkLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gW2FyZ3MuaGFuZG9mZklkXSAtIEhhbmRvZmYgbGVhc2UgaWQuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBbYXJncy53b3JrZXJJZF0gLSBXb3JrZXIgaWQuXG4gICAqIEBwYXJhbSB7bnVtYmVyfSBbYXJncy5oYW5kZWRPZmZBdE1zXSAtIEhhbmRlZCBvZmYgdGltZXN0YW1wLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxib29sZWFuPn0gLSBXaGV0aGVyIHRoZSBmZW5jZWQgcmVwb3J0IHdhcyBhY2NlcHRlZC5cbiAgICovXG4gIGFzeW5jIG1hcmtDb21wbGV0ZWQoe2pvYklkLCBoYW5kb2ZmSWQsIHdvcmtlcklkLCBoYW5kZWRPZmZBdE1zfSkge1xuICAgIGF3YWl0IHRoaXMuZW5zdXJlUmVhZHkoKVxuXG4gICAgcmV0dXJuIGF3YWl0IHRoaXMuX3NlcmlhbGl6ZWRDb3VudE11dGF0aW9uKGFzeW5jIChkYikgPT4ge1xuICAgICAgY29uc3Qgam9iID0gYXdhaXQgdGhpcy5fZ2V0Sm9iUm93QnlJZChkYiwgam9iSWQpXG5cbiAgICAgIGlmICgham9iKSByZXR1cm4gZmFsc2VcbiAgICAgIGlmICghdGhpcy5fc2hvdWxkQWNjZXB0UmVwb3J0KHtqb2IsIGhhbmRvZmZJZCwgd29ya2VySWQsIGhhbmRlZE9mZkF0TXN9KSkgcmV0dXJuIGZhbHNlXG5cbiAgICAgIGF3YWl0IHRoaXMuX2xvY2tDb25jdXJyZW5jeVJvdyhkYiwgam9iLmNvbmN1cnJlbmN5S2V5KVxuICAgICAgY29uc3QgYWZmZWN0ZWRSb3dzID0gYXdhaXQgdGhpcy5fdXBkYXRlQWZmZWN0ZWRSb3dzKGRiLCB7XG4gICAgICAgIHRhYmxlTmFtZTogSk9CU19UQUJMRSxcbiAgICAgICAgZGF0YToge1xuICAgICAgICAgIHN0YXR1czogXCJjb21wbGV0ZWRcIixcbiAgICAgICAgICBjb21wbGV0ZWRfYXRfbXM6IERhdGUubm93KClcbiAgICAgICAgfSxcbiAgICAgICAgY29uZGl0aW9uczogdGhpcy5fYWN0aXZlSGFuZG9mZkNvbmRpdGlvbnMoam9iKVxuICAgICAgfSlcblxuICAgICAgaWYgKGFmZmVjdGVkUm93cyAhPT0gMSkgcmV0dXJuIGZhbHNlXG4gICAgICBhd2FpdCB0aGlzLl9yZWxlYXNlU2NoZWR1bGVPd25lcnNoaXBGb3JKb2IoZGIsIGpvYilcbiAgICAgIGF3YWl0IHRoaXMuX3JlbGVhc2VDb25jdXJyZW5jeShkYiwgam9iLmNvbmN1cnJlbmN5S2V5KVxuICAgICAgYXdhaXQgdGhpcy5fcmVjb3JkU3RhdHVzVHJhbnNpdGlvbihkYiwgXCJoYW5kZWRfb2ZmXCIsIFwiY29tcGxldGVkXCIpXG4gICAgICByZXR1cm4gdHJ1ZVxuICAgIH0pXG4gIH1cblxuICAvKipcbiAgICogUmV0dXJucyBhbiBhY3RpdmUgaGFuZG9mZiB0byB0aGUgcXVldWUgYXQgYSBjYWxsZXItcmVxdWVzdGVkIGZ1dHVyZSB0aW1lLlxuICAgKiBUaGlzIGlzIG5vcm1hbCBqb2IgY29udHJvbCBmbG93OiBpdCBwcmVzZXJ2ZXMgZmFpbHVyZSBhdHRlbXB0cyBhbmQgbWV0YWRhdGEuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gT3B0aW9ucy5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGFyZ3Muam9iSWQgLSBKb2IgaWQuXG4gICAqIEBwYXJhbSB7bnVtYmVyfSBhcmdzLmRlbGF5TXMgLSBEZWxheSBmcm9tIHBlcnNpc3RlbmNlIHRpbWUgaW4gbWlsbGlzZWNvbmRzLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gW2FyZ3MuaGFuZG9mZklkXSAtIEhhbmRvZmYgbGVhc2UgaWQuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBbYXJncy53b3JrZXJJZF0gLSBXb3JrZXIgaWQuXG4gICAqIEBwYXJhbSB7bnVtYmVyfSBbYXJncy5oYW5kZWRPZmZBdE1zXSAtIEhhbmRlZCBvZmYgdGltZXN0YW1wLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxib29sZWFuPn0gLSBXaGV0aGVyIHRoZSBmZW5jZWQgcmVwb3J0IHdhcyBhY2NlcHRlZC5cbiAgICovXG4gIGFzeW5jIG1hcmtSZXNjaGVkdWxlZCh7am9iSWQsIGRlbGF5TXMsIGhhbmRvZmZJZCwgd29ya2VySWQsIGhhbmRlZE9mZkF0TXN9KSB7XG4gICAgYXdhaXQgdGhpcy5lbnN1cmVSZWFkeSgpXG4gICAgdGhpcy5fdmFsaWRhdGVSZXNjaGVkdWxlRGVsYXlNcyhkZWxheU1zKVxuXG4gICAgcmV0dXJuIGF3YWl0IHRoaXMuX3NlcmlhbGl6ZWRDb3VudE11dGF0aW9uKGFzeW5jIChkYikgPT4ge1xuICAgICAgY29uc3Qgam9iID0gYXdhaXQgdGhpcy5fZ2V0Sm9iUm93QnlJZChkYiwgam9iSWQpXG5cbiAgICAgIGlmICgham9iKSByZXR1cm4gZmFsc2VcbiAgICAgIGlmICghdGhpcy5fc2hvdWxkQWNjZXB0UmVwb3J0KHtqb2IsIGhhbmRvZmZJZCwgd29ya2VySWQsIGhhbmRlZE9mZkF0TXN9KSkgcmV0dXJuIGZhbHNlXG5cbiAgICAgIGF3YWl0IHRoaXMuX2xvY2tDb25jdXJyZW5jeVJvdyhkYiwgam9iLmNvbmN1cnJlbmN5S2V5KVxuICAgICAgY29uc3Qgc2NoZWR1bGVkQXRNcyA9IHRoaXMuX3Jlc2NoZWR1bGVkQXRNcyhkZWxheU1zKVxuICAgICAgY29uc3QgYWZmZWN0ZWRSb3dzID0gYXdhaXQgdGhpcy5fdXBkYXRlQWZmZWN0ZWRSb3dzKGRiLCB7XG4gICAgICAgIHRhYmxlTmFtZTogSk9CU19UQUJMRSxcbiAgICAgICAgZGF0YToge1xuICAgICAgICAgIHN0YXR1czogXCJxdWV1ZWRcIixcbiAgICAgICAgICBzY2hlZHVsZWRfYXRfbXM6IHNjaGVkdWxlZEF0TXMsXG4gICAgICAgICAgaGFuZGVkX29mZl9hdF9tczogbnVsbCxcbiAgICAgICAgICBoYW5kb2ZmX2lkOiBudWxsLFxuICAgICAgICAgIHdvcmtlcl9pZDogbnVsbFxuICAgICAgICB9LFxuICAgICAgICBjb25kaXRpb25zOiB0aGlzLl9hY3RpdmVIYW5kb2ZmQ29uZGl0aW9ucyhqb2IpXG4gICAgICB9KVxuXG4gICAgICBpZiAoYWZmZWN0ZWRSb3dzICE9PSAxKSByZXR1cm4gZmFsc2VcbiAgICAgIGF3YWl0IHRoaXMuX3JlbGVhc2VDb25jdXJyZW5jeShkYiwgam9iLmNvbmN1cnJlbmN5S2V5KVxuICAgICAgYXdhaXQgdGhpcy5fcmVjb3JkU3RhdHVzVHJhbnNpdGlvbihkYiwgXCJoYW5kZWRfb2ZmXCIsIFwicXVldWVkXCIpXG4gICAgICByZXR1cm4gdHJ1ZVxuICAgIH0pXG4gIH1cblxuICAvKipcbiAgICogUnVucyBtYXJrIHJldHVybmVkIHRvIHF1ZXVlLlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIE9wdGlvbnMuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBhcmdzLmpvYklkIC0gSm9iIGlkLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gYXJncy5oYW5kb2ZmSWQgLSBIYW5kb2ZmIGxlYXNlIGlkLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyB3aGVuIHVwZGF0ZWQuXG4gICAqL1xuICBhc3luYyBtYXJrUmV0dXJuZWRUb1F1ZXVlKHtqb2JJZCwgaGFuZG9mZklkfSkge1xuICAgIGF3YWl0IHRoaXMuZW5zdXJlUmVhZHkoKVxuXG4gICAgYXdhaXQgdGhpcy5fc2VyaWFsaXplZENvdW50TXV0YXRpb24oYXN5bmMgKGRiKSA9PiB7XG4gICAgICBjb25zdCBqb2IgPSBhd2FpdCB0aGlzLl9nZXRKb2JSb3dCeUlkKGRiLCBqb2JJZClcbiAgICAgIGlmICgham9iIHx8IGpvYi5oYW5kb2ZmSWQgIT09IGhhbmRvZmZJZCB8fCBqb2Iuc3RhdHVzICE9PSBcImhhbmRlZF9vZmZcIikgcmV0dXJuXG4gICAgICBhd2FpdCB0aGlzLl9sb2NrQ29uY3VycmVuY3lSb3coZGIsIGpvYi5jb25jdXJyZW5jeUtleSlcbiAgICAgIGNvbnN0IGFmZmVjdGVkUm93cyA9IGF3YWl0IHRoaXMuX3VwZGF0ZUFmZmVjdGVkUm93cyhkYiwge1xuICAgICAgICB0YWJsZU5hbWU6IEpPQlNfVEFCTEUsXG4gICAgICAgIGRhdGE6IHtcbiAgICAgICAgICBzdGF0dXM6IFwicXVldWVkXCIsXG4gICAgICAgICAgc2NoZWR1bGVkX2F0X21zOiBEYXRlLm5vdygpLFxuICAgICAgICAgIGhhbmRlZF9vZmZfYXRfbXM6IG51bGwsXG4gICAgICAgICAgaGFuZG9mZl9pZDogbnVsbCxcbiAgICAgICAgICB3b3JrZXJfaWQ6IG51bGxcbiAgICAgICAgfSxcbiAgICAgICAgY29uZGl0aW9uczoge2hhbmRvZmZfaWQ6IGhhbmRvZmZJZCwgaWQ6IGpvYklkLCBzdGF0dXM6IFwiaGFuZGVkX29mZlwifVxuICAgICAgfSlcbiAgICAgIGlmIChhZmZlY3RlZFJvd3MgPT09IDEpIHtcbiAgICAgICAgYXdhaXQgdGhpcy5fcmVsZWFzZUNvbmN1cnJlbmN5KGRiLCBqb2IuY29uY3VycmVuY3lLZXkpXG4gICAgICAgIGF3YWl0IHRoaXMuX3JlY29yZFN0YXR1c1RyYW5zaXRpb24oZGIsIFwiaGFuZGVkX29mZlwiLCBcInF1ZXVlZFwiKVxuICAgICAgfVxuICAgIH0pXG4gIH1cblxuICAvKipcbiAgICogUmV0dXJucyB0aGUgYWN0aXZlIGBoYW5kZWRfb2ZmYCBqb2JzIChqb2JJZCArIGhhbmRvZmZJZCkgaGVsZCB1bmRlciBhIHdvcmtlclxuICAgKiBpZC4gVXNlZCBvbiB3b3JrZXIgcmVjb25uZWN0OiBhZnRlciBhIG1haW4gcmVzdGFydCBhIHdvcmtlciByZWNvbm5lY3RzIHdpdGhcbiAgICogaXRzIHN0YWJsZSBpZCwgYW5kIHRoZSBmcmVzaCBtYWluIGFkb3B0cyB0aGVzZSBsZWFzZXMgc28gdGhleSBhcmUgdHJhY2tlZCDigJRcbiAgICogYW5kIHJlbGVhc2VkIGlmIHRoZSByZWNvbm5lY3RlZCB3b3JrZXIgbGF0ZXIgZGlzY29ubmVjdHMg4oCUIGluc3RlYWQgb2ZcbiAgICogc2l0dGluZyBzdHVjayB1bnRpbCB0aGUgYWdlLWJhc2VkIG9ycGhhbiBzd2VlcC4gVGhpcyBuZXZlciByZWNsYWltcywgc28gYVxuICAgKiBncmFjZWZ1bGx5LWRyYWluaW5nIHdvcmtlciB0aGF0IGtlZXBzIHJ1bm5pbmcgaXRzIGluLWZsaWdodCBqb2JzIGlzIGxlZnRcbiAgICogdW50b3VjaGVkLiBSb3dzIHdpdGggYSBudWxsIGhhbmRvZmYgaWQgKGxlZ2FjeSkgYXJlIHNraXBwZWQ7IHRoZSBvcnBoYW5cbiAgICogc3dlZXAgcmVjbGFpbXMgdGhvc2UgdmlhIGl0cyBgaGFuZGVkX29mZl9hdF9tc2AgZmVuY2UuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gT3B0aW9ucy5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGFyZ3Mud29ya2VySWQgLSBXb3JrZXIgaWQuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPEFycmF5PHtqb2JJZDogc3RyaW5nLCBoYW5kb2ZmSWQ6IHN0cmluZ30+Pn0gLSBBY3RpdmUgaGFuZG9mZnMuXG4gICAqL1xuICBhc3luYyBoYW5kZWRPZmZKb2JzRm9yV29ya2VyKHt3b3JrZXJJZH0pIHtcbiAgICBhd2FpdCB0aGlzLmVuc3VyZVJlYWR5KClcblxuICAgIGNvbnN0IHJvd3MgPSBhd2FpdCB0aGlzLl93aXRoRGIoYXN5bmMgKGRiKSA9PlxuICAgICAgYXdhaXQgZGIubmV3UXVlcnkoKS5mcm9tKEpPQlNfVEFCTEUpLndoZXJlKHtzdGF0dXM6IFwiaGFuZGVkX29mZlwiLCB3b3JrZXJfaWQ6IHdvcmtlcklkfSkucmVzdWx0cygpXG4gICAgKVxuXG4gICAgLyoqIEB0eXBlIHtBcnJheTx7am9iSWQ6IHN0cmluZywgaGFuZG9mZklkOiBzdHJpbmd9Pn0gKi9cbiAgICBjb25zdCBoYW5kb2ZmcyA9IFtdXG5cbiAgICBmb3IgKGNvbnN0IHJvdyBvZiByb3dzKSB7XG4gICAgICBjb25zdCBqb2IgPSB0aGlzLl9ub3JtYWxpemVKb2JSb3cocm93KVxuXG4gICAgICBpZiAoam9iLmhhbmRvZmZJZCkgaGFuZG9mZnMucHVzaCh7am9iSWQ6IGpvYi5pZCwgaGFuZG9mZklkOiBqb2IuaGFuZG9mZklkfSlcbiAgICB9XG5cbiAgICByZXR1cm4gaGFuZG9mZnNcbiAgfVxuXG4gIC8qKlxuICAgKiBTbmFwc2hvdHMgZXhhY3QsIGxlYXNlLWF3YXJlIGFjdGl2ZSBoYW5kb2ZmcyBiZWZvcmUgYSBuZXcgbWFpbiBnZW5lcmF0aW9uXG4gICAqIHN0YXJ0cyBhY2NlcHRpbmcgd29ya2VyIHJlY29ubmVjdHMuIExlZ2FjeSByb3dzIHdpdGhvdXQgYSBjb21wbGV0ZSB3b3JrZXIsXG4gICAqIGxlYXNlLCBhbmQgdGltZXN0YW1wIGlkZW50aXR5IHN0YXkgb3duZWQgYnkgdGhlIGFnZS1iYXNlZCBvcnBoYW4gc3dlZXAuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPGltcG9ydChcIi4vdHlwZXMuanNcIikuQmFja2dyb3VuZEpvYkhhbmRvZmZTbmFwc2hvdFtdPn0gLSBFeGFjdCBzdGFydHVwIGhhbmRvZmZzLlxuICAgKi9cbiAgYXN5bmMgc25hcHNob3RIYW5kZWRPZmZKb2JzKCkge1xuICAgIGF3YWl0IHRoaXMuZW5zdXJlUmVhZHkoKVxuXG4gICAgY29uc3Qgcm93cyA9IGF3YWl0IHRoaXMuX3dpdGhEYihhc3luYyAoZGIpID0+IGF3YWl0IGRiXG4gICAgICAubmV3UXVlcnkoKVxuICAgICAgLmZyb20oSk9CU19UQUJMRSlcbiAgICAgIC53aGVyZSh7c3RhdHVzOiBcImhhbmRlZF9vZmZcIn0pXG4gICAgICAub3JkZXIoXCJjcmVhdGVkX2F0X21zIEFTQ1wiKVxuICAgICAgLm9yZGVyKFwiaWQgQVNDXCIpXG4gICAgICAucmVzdWx0cygpKVxuICAgIC8qKiBAdHlwZSB7aW1wb3J0KFwiLi90eXBlcy5qc1wiKS5CYWNrZ3JvdW5kSm9iSGFuZG9mZlNuYXBzaG90W119ICovXG4gICAgY29uc3QgaGFuZG9mZnMgPSBbXVxuXG4gICAgZm9yIChjb25zdCByb3cgb2Ygcm93cykge1xuICAgICAgY29uc3Qgam9iID0gdGhpcy5fbm9ybWFsaXplSm9iUm93KHJvdylcblxuICAgICAgaWYgKCFqb2IuaGFuZG9mZklkIHx8ICFqb2Iud29ya2VySWQgfHwgdHlwZW9mIGpvYi5oYW5kZWRPZmZBdE1zICE9PSBcIm51bWJlclwiKSBjb250aW51ZVxuXG4gICAgICBoYW5kb2Zmcy5wdXNoKHtcbiAgICAgICAgaGFuZGVkT2ZmQXRNczogam9iLmhhbmRlZE9mZkF0TXMsXG4gICAgICAgIGhhbmRvZmZJZDogam9iLmhhbmRvZmZJZCxcbiAgICAgICAgam9iSWQ6IGpvYi5pZCxcbiAgICAgICAgd29ya2VySWQ6IGpvYi53b3JrZXJJZFxuICAgICAgfSlcbiAgICB9XG5cbiAgICByZXR1cm4gaGFuZG9mZnNcbiAgfVxuXG4gIC8qKlxuICAgKiBSZWNsYWltcyBvbmx5IHVuY2hhbmdlZCBleGFjdCBoYW5kb2ZmcyBzZWxlY3RlZCBieSBhIG1haW4tZ2VuZXJhdGlvbiBzdGFydHVwXG4gICAqIHNuYXBzaG90LiBUaGUgb3JkaW5hcnkgb3JwaGFuIGZhaWx1cmUgcGF0aCBvd25zIHJldHJpZXMsIHRlcm1pbmFsIHN0YXR1cyxcbiAgICogY291bnQgdHJhbnNpdGlvbnMsIHNjaGVkdWxlIG93bmVyc2hpcCwgYW5kIGNvbmN1cnJlbmN5IHJlbGVhc2UuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gT3B0aW9ucy5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL3R5cGVzLmpzXCIpLkJhY2tncm91bmRKb2JIYW5kb2ZmU25hcHNob3RbXX0gYXJncy5oYW5kb2ZmcyAtIEV4YWN0IHN0YXJ0dXAgc25hcHNob3RzLlxuICAgKiBAcGFyYW0ge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSBhcmdzLmVycm9yIC0gT3JwaGFuIHJlYXNvbi5cbiAgICogQHJldHVybnMge1Byb21pc2U8aW1wb3J0KFwiLi90eXBlcy5qc1wiKS5CYWNrZ3JvdW5kSm9iUm93W10+fSAtIEFjY2VwdGVkIHRyYW5zaXRpb25zLlxuICAgKi9cbiAgYXN5bmMgbWFya09ycGhhbmVkSGFuZG9mZnMoe2hhbmRvZmZzLCBlcnJvcn0pIHtcbiAgICBhd2FpdCB0aGlzLmVuc3VyZVJlYWR5KClcblxuICAgIHJldHVybiBhd2FpdCB0aGlzLl9zZXJpYWxpemVkQ291bnRNdXRhdGlvbihhc3luYyAoZGIpID0+IHtcbiAgICAgIC8qKiBAdHlwZSB7QmFja2dyb3VuZEpvYk9ycGhhblNlbGVjdGlvbltdfSAqL1xuICAgICAgY29uc3Qgc2VsZWN0aW9ucyA9IFtdXG5cbiAgICAgIGZvciAoY29uc3QgaGFuZG9mZiBvZiBoYW5kb2Zmcykge1xuICAgICAgICBjb25zdCBqb2IgPSBhd2FpdCB0aGlzLl9nZXRKb2JSb3dCeUlkKGRiLCBoYW5kb2ZmLmpvYklkKVxuXG4gICAgICAgIGlmICgham9iIHx8IGpvYi5zdGF0dXMgIT09IFwiaGFuZGVkX29mZlwiKSBjb250aW51ZVxuICAgICAgICBpZiAoam9iLmhhbmRvZmZJZCAhPT0gaGFuZG9mZi5oYW5kb2ZmSWQpIGNvbnRpbnVlXG4gICAgICAgIGlmIChqb2Iud29ya2VySWQgIT09IGhhbmRvZmYud29ya2VySWQpIGNvbnRpbnVlXG4gICAgICAgIGlmIChqb2IuaGFuZGVkT2ZmQXRNcyAhPT0gaGFuZG9mZi5oYW5kZWRPZmZBdE1zKSBjb250aW51ZVxuXG4gICAgICAgIHNlbGVjdGlvbnMucHVzaCh7XG4gICAgICAgICAgY29uZGl0aW9uczoge1xuICAgICAgICAgICAgaGFuZGVkX29mZl9hdF9tczogaGFuZG9mZi5oYW5kZWRPZmZBdE1zLFxuICAgICAgICAgICAgaGFuZG9mZl9pZDogaGFuZG9mZi5oYW5kb2ZmSWQsXG4gICAgICAgICAgICBpZDogaGFuZG9mZi5qb2JJZCxcbiAgICAgICAgICAgIHN0YXR1czogXCJoYW5kZWRfb2ZmXCIsXG4gICAgICAgICAgICB3b3JrZXJfaWQ6IGhhbmRvZmYud29ya2VySWRcbiAgICAgICAgICB9LFxuICAgICAgICAgIGpvYlxuICAgICAgICB9KVxuICAgICAgfVxuXG4gICAgICByZXR1cm4gYXdhaXQgdGhpcy5fbWFya09ycGhhblNlbGVjdGlvbnMoe2RiLCBlcnJvciwgc2VsZWN0aW9uc30pXG4gICAgfSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIG1hcmsgZmFpbGVkLlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIE9wdGlvbnMuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBhcmdzLmpvYklkIC0gSm9iIGlkLlxuICAgKiBAcGFyYW0ge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSBhcmdzLmVycm9yIC0gRXJyb3IuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBbYXJncy5oYW5kb2ZmSWRdIC0gSGFuZG9mZiBsZWFzZSBpZC5cbiAgICogQHBhcmFtIHtzdHJpbmd9IFthcmdzLndvcmtlcklkXSAtIFdvcmtlciBpZC5cbiAgICogQHBhcmFtIHtudW1iZXJ9IFthcmdzLmhhbmRlZE9mZkF0TXNdIC0gSGFuZGVkIG9mZiB0aW1lc3RhbXAuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPGltcG9ydChcIi4vdHlwZXMuanNcIikuQmFja2dyb3VuZEpvYlJvdyB8IG51bGw+fSAtIFVwZGF0ZWQgam9iIHJvdyB3aGVuIHRoZSByZXBvcnQgd2FzIGFjY2VwdGVkLlxuICAgKi9cbiAgYXN5bmMgbWFya0ZhaWxlZCh7am9iSWQsIGVycm9yLCBoYW5kb2ZmSWQsIHdvcmtlcklkLCBoYW5kZWRPZmZBdE1zfSkge1xuICAgIGF3YWl0IHRoaXMuZW5zdXJlUmVhZHkoKVxuXG4gICAgcmV0dXJuIGF3YWl0IHRoaXMuX3NlcmlhbGl6ZWRDb3VudE11dGF0aW9uKGFzeW5jIChkYikgPT4ge1xuICAgICAgY29uc3Qgam9iID0gYXdhaXQgdGhpcy5fZ2V0Sm9iUm93QnlJZChkYiwgam9iSWQpXG5cbiAgICAgIGlmICgham9iKSByZXR1cm4gbnVsbFxuICAgICAgaWYgKCF0aGlzLl9zaG91bGRBY2NlcHRSZXBvcnQoe2pvYiwgaGFuZG9mZklkLCB3b3JrZXJJZCwgaGFuZGVkT2ZmQXRNc30pKSByZXR1cm4gbnVsbFxuXG4gICAgICBjb25zdCB1cGRhdGVkSm9iID0gYXdhaXQgdGhpcy5fYXBwbHlGYWlsdXJlKHtkYiwgam9iLCBlcnJvciwgbWFya09ycGhhbmVkOiBmYWxzZX0pXG5cbiAgICAgIGlmICh1cGRhdGVkSm9iKSBhd2FpdCB0aGlzLl9yZWNvcmRTdGF0dXNUcmFuc2l0aW9uKGRiLCBqb2Iuc3RhdHVzLCB1cGRhdGVkSm9iLnN0YXR1cylcbiAgICAgIHJldHVybiB1cGRhdGVkSm9iXG4gICAgfSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIG1hcmsgb3JwaGFuZWQgam9icy5cbiAgICogQHBhcmFtIHtvYmplY3R9IFthcmdzXSAtIE9wdGlvbnMuXG4gICAqIEBwYXJhbSB7bnVtYmVyfSBbYXJncy5vcnBoYW5lZEFmdGVyTXNdIC0gTWFyayBqb2JzIG9ycGhhbmVkIGFmdGVyIHRoaXMgZHVyYXRpb24uXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPGltcG9ydChcIi4vdHlwZXMuanNcIikuQmFja2dyb3VuZEpvYlJvd1tdPn0gLSBUaGUgam9icyB0aGlzIHN3ZWVwIG1hcmtlZCBvcnBoYW5lZC5cbiAgICovXG4gIGFzeW5jIG1hcmtPcnBoYW5lZEpvYnMoe29ycGhhbmVkQWZ0ZXJNcyA9IE9SUEhBTkVEX0FGVEVSX01TfSA9IHt9KSB7XG4gICAgYXdhaXQgdGhpcy5lbnN1cmVSZWFkeSgpXG5cbiAgICByZXR1cm4gYXdhaXQgdGhpcy5fc2VyaWFsaXplZENvdW50TXV0YXRpb24oYXN5bmMgKGRiKSA9PiB7XG4gICAgICBjb25zdCBjdXRvZmYgPSBEYXRlLm5vdygpIC0gb3JwaGFuZWRBZnRlck1zXG4gICAgICBjb25zdCBxdWVyeSA9IGRiXG4gICAgICAgIC5uZXdRdWVyeSgpXG4gICAgICAgIC5mcm9tKEpPQlNfVEFCTEUpXG4gICAgICAgIC53aGVyZSh7c3RhdHVzOiBcImhhbmRlZF9vZmZcIn0pXG4gICAgICAgIC53aGVyZShgaGFuZGVkX29mZl9hdF9tcyA8PSAke2RiLnF1b3RlKGN1dG9mZil9YClcblxuICAgICAgY29uc3Qgcm93cyA9IGF3YWl0IHF1ZXJ5LnJlc3VsdHMoKVxuXG4gICAgICAvKiogQHR5cGUge0JhY2tncm91bmRKb2JPcnBoYW5TZWxlY3Rpb25bXX0gKi9cbiAgICAgIGNvbnN0IHNlbGVjdGlvbnMgPSBbXVxuXG4gICAgICBmb3IgKGNvbnN0IHJvdyBvZiByb3dzKSB7XG4gICAgICAgIGNvbnN0IGpvYiA9IHRoaXMuX25vcm1hbGl6ZUpvYlJvdyhyb3cpXG5cbiAgICAgICAgLy8gRmVuY2UgdGhlIHJlY2xhaW0gb24gdGhlIGV4YWN0IGhhbmRvZmYgdGhpcyBzd2VlcCBzZWxlY3RlZCwgdXNpbmcgaXRzXG4gICAgICAgIC8vIGBoYW5kZWRfb2ZmX2F0X21zYCByYXRoZXIgdGhhbiBpdHMgYGhhbmRvZmZfaWRgLiBUd28gcmVhc29uczpcbiAgICAgICAgLy8gICAxLiBOdWxsLXNhZmUuIFNvbWUgcm93cyBoYXZlIGEgbnVsbCBgaGFuZG9mZl9pZGAgKGhhbmRlZCBvZmYgYnkgYW5cbiAgICAgICAgLy8gICAgICBvbGRlciB2ZWxvY2lvdXMgYmVmb3JlIGhhbmRvZmYtaWQgZmVuY2luZykuIGB7aGFuZG9mZl9pZDogbnVsbH1gXG4gICAgICAgIC8vICAgICAgcmVuZGVycyBhcyBgaGFuZG9mZl9pZCA9IE5VTExgLCB3aGljaCBtYXRjaGVzIG5vdGhpbmcsIHNvIHRob3NlXG4gICAgICAgIC8vICAgICAgcm93cyB3b3VsZCBiZSBzdHJhbmRlZCBpbiBgaGFuZGVkX29mZmAgZm9yZXZlci5cbiAgICAgICAgLy8gICAyLiBSYWNlLXNhZmUuIElmIHRoZSByb3cgaXMgcmV0dXJuZWQgdG8gdGhlIHF1ZXVlIGFuZCByZS1oYW5kZWQtb2ZmXG4gICAgICAgIC8vICAgICAgYmV0d2VlbiB0aGUgU0VMRUNUIGFib3ZlIGFuZCB0aGlzIHVwZGF0ZSwgaXQgZ2V0cyBhIGZyZXNoXG4gICAgICAgIC8vICAgICAgYGhhbmRlZF9vZmZfYXRfbXNgIChhbHdheXMgXCJub3dcIiksIHNvIHRoaXMgc3RhbGUgY3V0b2ZmLWVyYVxuICAgICAgICAvLyAgICAgIHRpbWVzdGFtcCBubyBsb25nZXIgbWF0Y2hlcyBhbmQgd2Ugd29uJ3QgZmFpbC9vcnBoYW4g4oCUIG9yXG4gICAgICAgIC8vICAgICAgd3JvbmdseSByZWxlYXNlIHRoZSBjb25jdXJyZW5jeSByZXNlcnZhdGlvbiBvZiDigJQgdGhhdCBuZXcgbGVhc2UuXG4gICAgICAgIC8vIGBoYW5kZWRfb2ZmX2F0X21zYCBpcyBhbHdheXMgc2V0IG9uIGEgaGFuZGVkLW9mZiByb3cgKGFuZCB0aGUgU0VMRUNUXG4gICAgICAgIC8vIHJlcXVpcmVkIGl0IGA8PSBjdXRvZmZgKSwgc28gaXQgaXMgYSByZWxpYWJsZSBudWxsLXNhZmUgbGVhc2UgcGluLlxuICAgICAgICBzZWxlY3Rpb25zLnB1c2goe1xuICAgICAgICAgIGNvbmRpdGlvbnM6IHtpZDogam9iLmlkLCBzdGF0dXM6IFwiaGFuZGVkX29mZlwiLCBoYW5kZWRfb2ZmX2F0X21zOiBqb2IuaGFuZGVkT2ZmQXRNc30sXG4gICAgICAgICAgam9iXG4gICAgICAgIH0pXG4gICAgICB9XG5cbiAgICAgIHJldHVybiBhd2FpdCB0aGlzLl9tYXJrT3JwaGFuU2VsZWN0aW9ucyh7XG4gICAgICAgIGRiLFxuICAgICAgICBlcnJvcjogXCJKb2Igb3JwaGFuZWQgYWZ0ZXIgdGltZW91dFwiLFxuICAgICAgICBzZWxlY3Rpb25zXG4gICAgICB9KVxuICAgIH0pXG4gIH1cblxuICAvKipcbiAgICogQXBwbGllcyB0aGUgY29tbW9uIGZlbmNlZCBvcnBoYW4gdHJhbnNpdGlvbiBhbmQgcmVjb3JkcyBvbmUgYWdncmVnYXRlIGNvdW50XG4gICAqIGRlbHRhIGZvciB0aGUgYWNjZXB0ZWQgcm93cy5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBPcHRpb25zLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL2RhdGFiYXNlL2RyaXZlcnMvYmFzZS5qc1wiKS5kZWZhdWx0fSBhcmdzLmRiIC0gVHJhbnNhY3Rpb24gY29ubmVjdGlvbi5cbiAgICogQHBhcmFtIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gYXJncy5lcnJvciAtIE9ycGhhbiByZWFzb24uXG4gICAqIEBwYXJhbSB7QmFja2dyb3VuZEpvYk9ycGhhblNlbGVjdGlvbltdfSBhcmdzLnNlbGVjdGlvbnMgLSBTZWxlY3RlZCBoYW5kb2ZmcyBhbmQgZXhhY3QgZmVuY2VzLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxpbXBvcnQoXCIuL3R5cGVzLmpzXCIpLkJhY2tncm91bmRKb2JSb3dbXT59IC0gQWNjZXB0ZWQgdHJhbnNpdGlvbnMuXG4gICAqL1xuICBhc3luYyBfbWFya09ycGhhblNlbGVjdGlvbnMoe2RiLCBlcnJvciwgc2VsZWN0aW9uc30pIHtcbiAgICAvKiogQHR5cGUge2ltcG9ydChcIi4vdHlwZXMuanNcIikuQmFja2dyb3VuZEpvYlJvd1tdfSAqL1xuICAgIGNvbnN0IG9ycGhhbmVkSm9icyA9IFtdXG5cbiAgICBmb3IgKGNvbnN0IHtjb25kaXRpb25zLCBqb2J9IG9mIHNlbGVjdGlvbnMpIHtcbiAgICAgIGNvbnN0IG9ycGhhbmVkSm9iID0gYXdhaXQgdGhpcy5fYXBwbHlGYWlsdXJlKHtcbiAgICAgICAgY29uZGl0aW9ucyxcbiAgICAgICAgZGIsXG4gICAgICAgIGVycm9yLFxuICAgICAgICBqb2IsXG4gICAgICAgIG1hcmtPcnBoYW5lZDogdHJ1ZVxuICAgICAgfSlcblxuICAgICAgaWYgKG9ycGhhbmVkSm9iKSBvcnBoYW5lZEpvYnMucHVzaChvcnBoYW5lZEpvYilcbiAgICB9XG5cbiAgICBjb25zdCBzdGF0dXNDb3VudHMgPSB0aGlzLl9zdGF0dXNDb3VudHMob3JwaGFuZWRKb2JzKVxuICAgIGNvbnN0IGRlbHRhcyA9IHRoaXMuX2VtcHR5Q291bnRCdWNrZXRzKClcblxuICAgIGZvciAoY29uc3QgW3N0YXR1cywgY291bnRdIG9mIE9iamVjdC5lbnRyaWVzKHN0YXR1c0NvdW50cykpIHtcbiAgICAgIGRlbHRhcy5oYW5kZWRfb2ZmIC09IGNvdW50XG4gICAgICBkZWx0YXNbc3RhdHVzXSArPSBjb3VudFxuICAgIH1cbiAgICBhd2FpdCB0aGlzLl9yZWNvcmRDb3VudERlbHRhKGRiLCBkZWx0YXMpXG5cbiAgICByZXR1cm4gb3JwaGFuZWRKb2JzXG4gIH1cblxuICAvKipcbiAgICogRGVsZXRlcyB0ZXJtaW5hbCBqb2Igcm93cyBwYXN0IHRoZWlyIHJldGVudGlvbiB3aW5kb3cgc28gdGhlIGpvYnMgdGFibGVcbiAgICogZG9lcyBub3QgZ3JvdyB1bmJvdW5kZWQgKGNvbXBsZXRlZCByb3dzIGluIHBhcnRpY3VsYXIgYWNjdW11bGF0ZSBmb3JldmVyXG4gICAqIG90aGVyd2lzZSkuIEJhdGNoZWQgYnkgaWQg4oCUIFNFTEVDVCBhIHBhZ2Ugb2YgaWRzLCB0aGVuXG4gICAqIGBERUxFVEUgLi4uIFdIRVJFIGlkIElOICguLi4pYCDigJQgcmF0aGVyIHRoYW4gYERFTEVURSAuLi4gTElNSVRgLCB3aGljaCBub3RcbiAgICogZXZlcnkgZHJpdmVyIHN1cHBvcnRzOyBlYWNoIGJhdGNoIHJ1bnMgb24gaXRzIG93biBjb25uZWN0aW9uIHNvIHRoZSBzd2VlcFxuICAgKiB5aWVsZHMgYmV0d2VlbiBiYXRjaGVzIGluc3RlYWQgb2YgaG9sZGluZyBvbmUgbG9uZyB0cmFuc2FjdGlvbi5cbiAgICogQHBhcmFtIHtvYmplY3R9IFthcmdzXSAtIE9wdGlvbnMuXG4gICAqIEBwYXJhbSB7bnVtYmVyIHwgbnVsbH0gW2FyZ3MuY29tcGxldGVkVHRsTXNdIC0gRGVsZXRlIGBjb21wbGV0ZWRgIGpvYnMgd2hvc2UgYGNvbXBsZXRlZF9hdF9tc2AgaXMgb2xkZXIgdGhhbiB0aGlzIG1hbnkgbXMuIEZhbHN5IG9yIGA8PSAwYCBkaXNhYmxlcyBjb21wbGV0ZWQgcHJ1bmluZy5cbiAgICogQHBhcmFtIHtudW1iZXIgfCBudWxsfSBbYXJncy5mYWlsZWRUdGxNc10gLSBEZWxldGUgdGVybWluYWwgYGZhaWxlZGAvYG9ycGhhbmVkYCBqb2JzIG9sZGVyIHRoYW4gdGhpcyBtYW55IG1zIChieSBgZmFpbGVkX2F0X21zYC9gb3JwaGFuZWRfYXRfbXNgKS4gRmFsc3kgb3IgYDw9IDBgIGRpc2FibGVzLlxuICAgKiBAcGFyYW0ge251bWJlcn0gW2FyZ3MuYmF0Y2hTaXplXSAtIE1heCByb3dzIGRlbGV0ZWQgcGVyIGJhdGNoLiBEZWZhdWx0IGAxMDAwYC5cbiAgICogQHJldHVybnMge1Byb21pc2U8bnVtYmVyPn0gLSBUb3RhbCByb3dzIGRlbGV0ZWQuXG4gICAqL1xuICBhc3luYyBwcnVuZVRlcm1pbmFsSm9icyh7Y29tcGxldGVkVHRsTXMgPSBudWxsLCBmYWlsZWRUdGxNcyA9IG51bGwsIGJhdGNoU2l6ZSA9IDEwMDB9ID0ge30pIHtcbiAgICBhd2FpdCB0aGlzLmVuc3VyZVJlYWR5KClcblxuICAgIGNvbnN0IG5vdyA9IERhdGUubm93KClcbiAgICBjb25zdCBzaXplID0gYmF0Y2hTaXplID4gMCA/IGJhdGNoU2l6ZSA6IDEwMDBcbiAgICBsZXQgZGVsZXRlZCA9IDBcblxuICAgIGlmIChjb21wbGV0ZWRUdGxNcyAmJiBjb21wbGV0ZWRUdGxNcyA+IDApIHtcbiAgICAgIGRlbGV0ZWQgKz0gYXdhaXQgdGhpcy5fcHJ1bmVTdGF0dXNCYXRjaGVzKHtzdGF0dXM6IFwiY29tcGxldGVkXCIsIGNvbHVtbjogXCJjb21wbGV0ZWRfYXRfbXNcIiwgY3V0b2ZmOiBub3cgLSBjb21wbGV0ZWRUdGxNcywgYmF0Y2hTaXplOiBzaXplfSlcbiAgICB9XG5cbiAgICBpZiAoZmFpbGVkVHRsTXMgJiYgZmFpbGVkVHRsTXMgPiAwKSB7XG4gICAgICBkZWxldGVkICs9IGF3YWl0IHRoaXMuX3BydW5lU3RhdHVzQmF0Y2hlcyh7c3RhdHVzOiBcImZhaWxlZFwiLCBjb2x1bW46IFwiZmFpbGVkX2F0X21zXCIsIGN1dG9mZjogbm93IC0gZmFpbGVkVHRsTXMsIGJhdGNoU2l6ZTogc2l6ZX0pXG4gICAgICBkZWxldGVkICs9IGF3YWl0IHRoaXMuX3BydW5lU3RhdHVzQmF0Y2hlcyh7c3RhdHVzOiBcIm9ycGhhbmVkXCIsIGNvbHVtbjogXCJvcnBoYW5lZF9hdF9tc1wiLCBjdXRvZmY6IG5vdyAtIGZhaWxlZFR0bE1zLCBiYXRjaFNpemU6IHNpemV9KVxuICAgIH1cblxuICAgIHJldHVybiBkZWxldGVkXG4gIH1cblxuICAvKipcbiAgICogRGVsZXRlcyByb3dzIG9mIG9uZSB0ZXJtaW5hbCBzdGF0dXMgb2xkZXIgdGhhbiBhIGN1dG9mZiwgYmF0Y2ggYnkgYmF0Y2gsXG4gICAqIHVudGlsIGEgcGFnZSByZXR1cm5zIGZld2VyIHRoYW4gYGJhdGNoU2l6ZWAgcm93cy5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBPcHRpb25zLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gYXJncy5zdGF0dXMgLSBUZXJtaW5hbCBzdGF0dXMgdG8gcHJ1bmUuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBhcmdzLmNvbHVtbiAtIFRpbWVzdGFtcCBjb2x1bW4gY29tcGFyZWQgYWdhaW5zdCB0aGUgY3V0b2ZmLlxuICAgKiBAcGFyYW0ge251bWJlcn0gYXJncy5jdXRvZmYgLSBEZWxldGUgcm93cyB3aG9zZSBjb2x1bW4gdmFsdWUgaXMgYDw9IGN1dG9mZmAuXG4gICAqIEBwYXJhbSB7bnVtYmVyfSBhcmdzLmJhdGNoU2l6ZSAtIE1heCByb3dzIHBlciBiYXRjaC5cbiAgICogQHJldHVybnMge1Byb21pc2U8bnVtYmVyPn0gLSBSb3dzIGRlbGV0ZWQgZm9yIHRoaXMgc3RhdHVzLlxuICAgKi9cbiAgYXN5bmMgX3BydW5lU3RhdHVzQmF0Y2hlcyh7c3RhdHVzLCBjb2x1bW4sIGN1dG9mZiwgYmF0Y2hTaXplfSkge1xuICAgIGxldCBkZWxldGVkID0gMFxuXG4gICAgZm9yICg7Oykge1xuICAgICAgY29uc3QgcmVtb3ZlZCA9IGF3YWl0IHRoaXMuX3NlcmlhbGl6ZWRDb3VudE11dGF0aW9uKGFzeW5jIChkYikgPT4ge1xuICAgICAgICBjb25zdCByb3dzID0gYXdhaXQgZGJcbiAgICAgICAgICAubmV3UXVlcnkoKVxuICAgICAgICAgIC5mcm9tKEpPQlNfVEFCTEUpXG4gICAgICAgICAgLnNlbGVjdChcImlkXCIpXG4gICAgICAgICAgLndoZXJlKHtzdGF0dXN9KVxuICAgICAgICAgIC53aGVyZShgJHtkYi5xdW90ZUNvbHVtbihjb2x1bW4pfSA8PSAke2RiLnF1b3RlKGN1dG9mZil9YClcbiAgICAgICAgICAubGltaXQoYmF0Y2hTaXplKVxuICAgICAgICAgIC5yZXN1bHRzKClcblxuICAgICAgICBpZiAocm93cy5sZW5ndGggPT09IDApIHJldHVybiAwXG5cbiAgICAgICAgY29uc3QgaWRzID0gcm93cy5tYXAoKC8qKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSAqLyByb3cpID0+IGRiLnF1b3RlKFN0cmluZyhyb3cuaWQpKSkuam9pbihcIiwgXCIpXG5cbiAgICAgICAgY29uc3QgcmVtb3ZlZCA9IGF3YWl0IGRiLmFmZmVjdGVkUm93cyhcbiAgICAgICAgICBgREVMRVRFIEZST00gJHtkYi5xdW90ZVRhYmxlKEpPQlNfVEFCTEUpfSBXSEVSRSAke2RiLnF1b3RlQ29sdW1uKFwiaWRcIil9IElOICgke2lkc30pYFxuICAgICAgICApXG5cbiAgICAgICAgYXdhaXQgdGhpcy5fcmVjb3JkQ291bnREZWx0YShkYiwge2FsbDogLXJlbW92ZWQsIFtzdGF0dXNdOiAtcmVtb3ZlZH0pXG5cbiAgICAgICAgcmV0dXJuIHJlbW92ZWRcbiAgICAgIH0pXG5cbiAgICAgIGRlbGV0ZWQgKz0gcmVtb3ZlZFxuICAgICAgaWYgKHJlbW92ZWQgPCBiYXRjaFNpemUpIGJyZWFrXG4gICAgfVxuXG4gICAgcmV0dXJuIGRlbGV0ZWRcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGNsZWFyIGFsbC5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgd2hlbiBjbGVhcmVkLlxuICAgKi9cbiAgYXN5bmMgY2xlYXJBbGwoKSB7XG4gICAgYXdhaXQgdGhpcy5lbnN1cmVSZWFkeSgpXG5cbiAgICBhd2FpdCB0aGlzLl9zZXJpYWxpemVkQ291bnRNdXRhdGlvbihhc3luYyAoZGIpID0+IHtcbiAgICAgIGNvbnN0IHNuYXBzaG90ID0gYXdhaXQgdGhpcy5fY291bnRTbmFwc2hvdE9uTG9ja2VkQ29ubmVjdGlvbihkYilcbiAgICAgIGlmIChhd2FpdCBkYi50YWJsZUV4aXN0cyhNQUlMX0RFTElWRVJZX09QRVJBVElPTlNfVEFCTEUpKSBhd2FpdCBkYi5xdWVyeShgREVMRVRFIEZST00gJHtkYi5xdW90ZVRhYmxlKE1BSUxfREVMSVZFUllfT1BFUkFUSU9OU19UQUJMRSl9YClcbiAgICAgIGlmIChhd2FpdCBkYi50YWJsZUV4aXN0cyhJREVNUE9URU5DWV9LRVlTX1RBQkxFKSkgYXdhaXQgZGIucXVlcnkoYERFTEVURSBGUk9NICR7ZGIucXVvdGVUYWJsZShJREVNUE9URU5DWV9LRVlTX1RBQkxFKX1gKVxuICAgICAgaWYgKGF3YWl0IGRiLnRhYmxlRXhpc3RzKFNDSEVEVUxFX0tFWVNfVEFCTEUpKSBhd2FpdCBkYi5xdWVyeShgREVMRVRFIEZST00gJHtkYi5xdW90ZVRhYmxlKFNDSEVEVUxFX0tFWVNfVEFCTEUpfWApXG4gICAgICBhd2FpdCBkYi5xdWVyeShgREVMRVRFIEZST00gJHtkYi5xdW90ZVRhYmxlKEpPQlNfVEFCTEUpfWApXG4gICAgICBpZiAoYXdhaXQgZGIudGFibGVFeGlzdHMoQ09OQ1VSUkVOQ1lfVEFCTEUpKSBhd2FpdCBkYi5xdWVyeShgREVMRVRFIEZST00gJHtkYi5xdW90ZVRhYmxlKENPTkNVUlJFTkNZX1RBQkxFKX1gKVxuICAgICAgY29uc3QgZGVsdGFzID0gT2JqZWN0LmZyb21FbnRyaWVzKE9iamVjdC5lbnRyaWVzKHNuYXBzaG90LmNvdW50cykubWFwKChba2V5LCB2YWx1ZV0pID0+IFtrZXksIC12YWx1ZV0pKVxuICAgICAgYXdhaXQgdGhpcy5fcmVjb3JkQ291bnREZWx0YShkYiwgZGVsdGFzKVxuICAgIH0pXG4gIH1cblxuICAvKipcbiAgICogQ2FuY2VscyBhIHF1ZXVlZCBvciBoYW5kZWQtb2ZmIGpvYiBhbmQgcmVsZWFzZXMgYW55IGR1cmFibGUgY29uY3VycmVuY3kgcmVzZXJ2YXRpb24uXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBqb2JJZCAtIEpvYiBpZC5cbiAgICogQHJldHVybnMge1Byb21pc2U8Ym9vbGVhbj59IC0gV2hldGhlciB0aGUgam9iIHdhcyBjYW5jZWxsZWQuXG4gICAqL1xuICBhc3luYyBjYW5jZWwoam9iSWQpIHtcbiAgICBhd2FpdCB0aGlzLmVuc3VyZVJlYWR5KClcbiAgICByZXR1cm4gYXdhaXQgdGhpcy5fc2VyaWFsaXplZENvdW50TXV0YXRpb24oYXN5bmMgKGRiKSA9PiB7XG4gICAgICBjb25zdCBqb2IgPSBhd2FpdCB0aGlzLl9nZXRKb2JSb3dCeUlkKGRiLCBqb2JJZClcbiAgICAgIGlmICgham9iIHx8IChqb2Iuc3RhdHVzICE9PSBcInF1ZXVlZFwiICYmIGpvYi5zdGF0dXMgIT09IFwiaGFuZGVkX29mZlwiKSkgcmV0dXJuIGZhbHNlXG4gICAgICAvLyBPbmx5IGEgaGFuZGVkX29mZiBqb2IgaG9sZHMgYSBjb25jdXJyZW5jeSByZXNlcnZhdGlvbiwgc28gb25seSB0aGF0IGNhc2UgdG91Y2hlcyB0aGVcbiAgICAgIC8vIHNoYXJlZCBjb3VudGVyIHJvdyBhbmQgbmVlZHMgdGhlIGNvbmN1cnJlbmN5LXRoZW4tam9iIGxvY2sgb3JkZXJpbmcuXG4gICAgICBpZiAoam9iLnN0YXR1cyA9PT0gXCJoYW5kZWRfb2ZmXCIpIGF3YWl0IHRoaXMuX2xvY2tDb25jdXJyZW5jeVJvdyhkYiwgam9iLmNvbmN1cnJlbmN5S2V5KVxuICAgICAgY29uc3QgYWZmZWN0ZWRSb3dzID0gYXdhaXQgdGhpcy5fdXBkYXRlQWZmZWN0ZWRSb3dzKGRiLCB7dGFibGVOYW1lOiBKT0JTX1RBQkxFLCBkYXRhOiB7c3RhdHVzOiBcImNhbmNlbGxlZFwifSwgY29uZGl0aW9uczoge2lkOiBqb2IuaWQsIHN0YXR1czogam9iLnN0YXR1c319KVxuICAgICAgaWYgKGFmZmVjdGVkUm93cyAhPT0gMSkgcmV0dXJuIGZhbHNlXG4gICAgICBhd2FpdCB0aGlzLl9yZWxlYXNlU2NoZWR1bGVPd25lcnNoaXBGb3JKb2IoZGIsIGpvYilcbiAgICAgIGlmIChqb2Iuc3RhdHVzID09PSBcImhhbmRlZF9vZmZcIikgYXdhaXQgdGhpcy5fcmVsZWFzZUNvbmN1cnJlbmN5KGRiLCBqb2IuY29uY3VycmVuY3lLZXkpXG4gICAgICBhd2FpdCB0aGlzLl9yZWNvcmRTdGF0dXNUcmFuc2l0aW9uKGRiLCBqb2Iuc3RhdHVzLCBcImNhbmNlbGxlZFwiKVxuICAgICAgcmV0dXJuIHRydWVcbiAgICB9KVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZ2V0IHJldHJ5IGRlbGF5IG1zLlxuICAgKiBAcGFyYW0ge251bWJlcn0gcmV0cnlDb3VudCAtIFJldHJ5IGF0dGVtcHQgY291bnQgKDEtYmFzZWQpLlxuICAgKiBAcmV0dXJucyB7bnVtYmVyfSAtIERlbGF5IGluIG1pbGxpc2Vjb25kcy5cbiAgICovXG4gIGdldFJldHJ5RGVsYXlNcyhyZXRyeUNvdW50KSB7XG4gICAgcmV0dXJuIHJldHJ5RGVsYXlNcyhyZXRyeUNvdW50KVxuICB9XG5cbiAgLyoqXG4gICAqIE5vcm1hbGl6ZXMgb25lIG5ldyBqb2IgYmVmb3JlIGVudGVyaW5nIGl0cyBwZXJzaXN0ZW5jZSB0cmFuc2FjdGlvbi5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBKb2IgaW5wdXQuXG4gICAqIEBwYXJhbSB7QXJyYXk8UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSBhcmdzLmFyZ3MgLSBKb2IgYXJndW1lbnRzLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gYXJncy5qb2JOYW1lIC0gSm9iIG5hbWUuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi90eXBlcy5qc1wiKS5CYWNrZ3JvdW5kSm9iT3B0aW9uc30gW2FyZ3Mub3B0aW9uc10gLSBKb2Igb3B0aW9ucy5cbiAgICogQHJldHVybnMge1ByZXBhcmVkQmFja2dyb3VuZEpvYn0gLSBQcmVwYXJlZCBqb2IuXG4gICAqL1xuICBfcHJlcGFyZUpvYih7YXJncywgam9iTmFtZSwgb3B0aW9uc30pIHtcbiAgICBjb25zdCBjcmVhdGVkQXRNcyA9IERhdGUubm93KClcbiAgICBjb25zdCBxdWV1ZSA9IHRoaXMuX25vcm1hbGl6ZVF1ZXVlKG9wdGlvbnMpXG5cbiAgICByZXR1cm4ge1xuICAgICAgYXJnc0pzb246IEpTT04uc3RyaW5naWZ5KGFyZ3MgfHwgW10pLFxuICAgICAgY29uY3VycmVuY3k6IHRoaXMuX3Jlc29sdmVDb25jdXJyZW5jeShvcHRpb25zLCBxdWV1ZSksXG4gICAgICBjcmVhdGVkQXRNcyxcbiAgICAgIGV4ZWN1dGlvbk1vZGU6IHRoaXMuX25vcm1hbGl6ZUV4ZWN1dGlvbk1vZGUob3B0aW9ucyksXG4gICAgICBqb2JJZDogcmFuZG9tVVVJRCgpLFxuICAgICAgam9iTmFtZSxcbiAgICAgIG1heFJldHJpZXM6IHRoaXMuX25vcm1hbGl6ZU1heFJldHJpZXMob3B0aW9ucz8ubWF4UmV0cmllcyksXG4gICAgICBxdWV1ZSxcbiAgICAgIHNjaGVkdWxlZEF0TXM6IHRoaXMuX25vcm1hbGl6ZVNjaGVkdWxlZEF0TXMob3B0aW9ucz8uc2NoZWR1bGVkQXRNcywgY3JlYXRlZEF0TXMpLFxuICAgICAgdGltZW91dE1zOiB0aGlzLl9ub3JtYWxpemVKb2JUaW1lb3V0TXMob3B0aW9ucylcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogTm9ybWFsaXplcyBhIHBlci1qb2IgdGltZW91dCB3aGlsZSBwcmVzZXJ2aW5nIG9taXR0ZWQgKHdvcmtlciBmYWxsYmFjaylcbiAgICogc2VwYXJhdGVseSBmcm9tIGV4cGxpY2l0bHkgZGlzYWJsZWQuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi90eXBlcy5qc1wiKS5CYWNrZ3JvdW5kSm9iT3B0aW9ucyB8IHVuZGVmaW5lZH0gb3B0aW9ucyAtIEpvYiBvcHRpb25zLlxuICAgKiBAcmV0dXJucyB7bnVtYmVyIHwgbnVsbH0gLSBQb3NpdGl2ZSB0aW1lb3V0LCB6ZXJvIGZvciBkaXNhYmxlZCwgb3IgbnVsbCB3aGVuIG9taXR0ZWQuXG4gICAqL1xuICBfbm9ybWFsaXplSm9iVGltZW91dE1zKG9wdGlvbnMpIHtcbiAgICBpZiAob3B0aW9ucz8udGltZW91dE1zID09PSB1bmRlZmluZWQpIHJldHVybiBudWxsXG5cbiAgICBjb25zdCB0aW1lb3V0TXMgPSBvcHRpb25zLnRpbWVvdXRNc1xuXG4gICAgaWYgKHR5cGVvZiB0aW1lb3V0TXMgIT09IFwibnVtYmVyXCIgfHwgIU51bWJlci5pc0Zpbml0ZSh0aW1lb3V0TXMpKSB7XG4gICAgICB0aHJvdyBWZWxvY2lvdXNFcnJvci5zYWZlKEpPQl9USU1FT1VUX1ZBTElEQVRJT05fTUVTU0FHRSlcbiAgICB9XG5cbiAgICBpZiAodGltZW91dE1zIDw9IDApIHJldHVybiAwXG5cbiAgICBpZiAoIU51bWJlci5pc0ludGVnZXIodGltZW91dE1zKSB8fCB0aW1lb3V0TXMgPiBNQVhfSk9CX1RJTUVPVVRfTVMpIHtcbiAgICAgIHRocm93IFZlbG9jaW91c0Vycm9yLnNhZmUoSk9CX1RJTUVPVVRfVkFMSURBVElPTl9NRVNTQUdFKVxuICAgIH1cblxuICAgIHJldHVybiB0aW1lb3V0TXNcbiAgfVxuXG4gIC8qKlxuICAgKiBJbnNlcnRzIG9uZSBwcmVwYXJlZCBxdWV1ZWQgam9iLCBpbmNsdWRpbmcgaXRzIGNvbmN1cnJlbmN5IHJlZ2lzdHJhdGlvbi5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9kYXRhYmFzZS9kcml2ZXJzL2Jhc2UuanNcIikuZGVmYXVsdH0gZGIgLSBEYXRhYmFzZSBjb25uZWN0aW9uLlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIEluc2VydCBpbnB1dC5cbiAgICogQHBhcmFtIHtQcmVwYXJlZEJhY2tncm91bmRKb2J9IGFyZ3MucHJlcGFyZWRKb2IgLSBQcmVwYXJlZCBqb2IuXG4gICAqIEBwYXJhbSB7c3RyaW5nIHwgbnVsbH0gYXJncy5zY2hlZHVsZUtleSAtIEhpc3RvcmljYWwgc3RhYmxlIGtleS5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgYWZ0ZXIgaW5zZXJ0aW9uLlxuICAgKi9cbiAgYXN5bmMgX2luc2VydFByZXBhcmVkSm9iKGRiLCB7cHJlcGFyZWRKb2IsIHNjaGVkdWxlS2V5fSkge1xuICAgIGNvbnN0IHtjb25jdXJyZW5jeX0gPSBwcmVwYXJlZEpvYlxuXG4gICAgaWYgKGNvbmN1cnJlbmN5KSB7XG4gICAgICBpZiAoY29uY3VycmVuY3kucXVldWVEZXJpdmVkKSB7XG4gICAgICAgIGF3YWl0IHRoaXMuX2Vuc3VyZVF1ZXVlQ29uY3VycmVuY3lLZXkoZGIsIGNvbmN1cnJlbmN5KVxuICAgICAgfSBlbHNlIHtcbiAgICAgICAgYXdhaXQgdGhpcy5fZW5zdXJlQ29uY3VycmVuY3lLZXkoZGIsIGNvbmN1cnJlbmN5KVxuICAgICAgfVxuICAgIH1cblxuICAgIGF3YWl0IGRiLmluc2VydCh7XG4gICAgICB0YWJsZU5hbWU6IEpPQlNfVEFCTEUsXG4gICAgICBkYXRhOiB7XG4gICAgICAgIGlkOiBwcmVwYXJlZEpvYi5qb2JJZCxcbiAgICAgICAgam9iX25hbWU6IHByZXBhcmVkSm9iLmpvYk5hbWUsXG4gICAgICAgIGFyZ3NfanNvbjogcHJlcGFyZWRKb2IuYXJnc0pzb24sXG4gICAgICAgIGV4ZWN1dGlvbl9tb2RlOiBwcmVwYXJlZEpvYi5leGVjdXRpb25Nb2RlLFxuICAgICAgICBxdWV1ZTogcHJlcGFyZWRKb2IucXVldWUsXG4gICAgICAgIG1heF9yZXRyaWVzOiBwcmVwYXJlZEpvYi5tYXhSZXRyaWVzLFxuICAgICAgICBhdHRlbXB0czogMCxcbiAgICAgICAgc3RhdHVzOiBcInF1ZXVlZFwiLFxuICAgICAgICBzY2hlZHVsZWRfYXRfbXM6IHByZXBhcmVkSm9iLnNjaGVkdWxlZEF0TXMsXG4gICAgICAgIGNyZWF0ZWRfYXRfbXM6IHByZXBhcmVkSm9iLmNyZWF0ZWRBdE1zLFxuICAgICAgICBzY2hlZHVsZV9rZXk6IHNjaGVkdWxlS2V5LFxuICAgICAgICBjb25jdXJyZW5jeV9rZXk6IGNvbmN1cnJlbmN5Py5jb25jdXJyZW5jeUtleSB8fCBudWxsLFxuICAgICAgICBtYXhfY29uY3VycmVuY3k6IGNvbmN1cnJlbmN5Py5tYXhDb25jdXJyZW5jeSB8fCBudWxsLFxuICAgICAgICB0aW1lb3V0X21zOiBwcmVwYXJlZEpvYi50aW1lb3V0TXMsXG4gICAgICAgIGhhbmRvZmZfaWQ6IG51bGxcbiAgICAgIH1cbiAgICB9KVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgbm9ybWFsaXplIG1heCByZXRyaWVzLlxuICAgKiBAcGFyYW0ge251bWJlciB8IG51bGwgfCB1bmRlZmluZWR9IG1heFJldHJpZXMgLSBJbnB1dC5cbiAgICogQHJldHVybnMge251bWJlcn0gLSBOb3JtYWxpemVkIG1heCByZXRyaWVzLlxuICAgKi9cbiAgX25vcm1hbGl6ZU1heFJldHJpZXMobWF4UmV0cmllcykge1xuICAgIHJldHVybiBub3JtYWxpemVCYWNrZ3JvdW5kSm9iTWF4UmV0cmllcyhtYXhSZXRyaWVzKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgbm9ybWFsaXplIHNjaGVkdWxlZCBhdCBtcy5cbiAgICogQHBhcmFtIHtudW1iZXIgfCB1bmRlZmluZWR9IHNjaGVkdWxlZEF0TXMgLSBSZXF1ZXN0ZWQgZGlzcGF0Y2ggdGltZXN0YW1wLlxuICAgKiBAcGFyYW0ge251bWJlcn0gZGVmYXVsdFNjaGVkdWxlZEF0TXMgLSBEZWZhdWx0IGRpc3BhdGNoIHRpbWVzdGFtcC5cbiAgICogQHJldHVybnMge251bWJlcn0gLSBEaXNwYXRjaCB0aW1lc3RhbXAuXG4gICAqL1xuICBfbm9ybWFsaXplU2NoZWR1bGVkQXRNcyhzY2hlZHVsZWRBdE1zLCBkZWZhdWx0U2NoZWR1bGVkQXRNcykge1xuICAgIHJldHVybiBub3JtYWxpemVCYWNrZ3JvdW5kSm9iU2NoZWR1bGVkQXRNcyhzY2hlZHVsZWRBdE1zLCBkZWZhdWx0U2NoZWR1bGVkQXRNcylcbiAgfVxuXG4gIC8qKlxuICAgKiBSZXNvbHZlcyBhIHJlc2NoZWR1bGUgZGVsYXkgYWdhaW5zdCBwZXJzaXN0ZW5jZSB0aW1lLlxuICAgKiBAcGFyYW0ge251bWJlcn0gZGVsYXlNcyAtIERlbGF5IGluIG1pbGxpc2Vjb25kcy5cbiAgICogQHJldHVybnMge251bWJlcn0gLSBGdXR1cmUgZWxpZ2liaWxpdHkgdGltZXN0YW1wLlxuICAgKi9cbiAgX3Jlc2NoZWR1bGVkQXRNcyhkZWxheU1zKSB7XG4gICAgcmV0dXJuIHJlc2NoZWR1bGVkQmFja2dyb3VuZEpvYkF0TXMoZGVsYXlNcywgRGF0ZS5ub3coKSlcbiAgfVxuXG4gIC8qKlxuICAgKiBWYWxpZGF0ZXMgYSBwdWJsaWMgcmVzY2hlZHVsZSBkZWxheSBiZWZvcmUgcGVyc2lzdGVuY2Ugd29yayBiZWdpbnMuXG4gICAqIEBwYXJhbSB7bnVtYmVyfSBkZWxheU1zIC0gRGVsYXkgaW4gbWlsbGlzZWNvbmRzLlxuICAgKiBAcmV0dXJucyB7dm9pZH1cbiAgICovXG4gIF92YWxpZGF0ZVJlc2NoZWR1bGVEZWxheU1zKGRlbGF5TXMpIHtcbiAgICByZXNjaGVkdWxlZEJhY2tncm91bmRKb2JBdE1zKGRlbGF5TXMsIDApXG4gIH1cblxuICAvKipcbiAgICogVmFsaWRhdGVzIGEgc3RhYmxlIHNjaGVkdWxlIGtleSBhdCB0aGUgcHVibGljIHN0b3JhZ2UgYm91bmRhcnkuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBzY2hlZHVsZUtleSAtIFN0YWJsZSBsb2dpY2FsIHNjaGVkdWxlIGtleS5cbiAgICogQHJldHVybnMge3N0cmluZ30gLSBWYWxpZGF0ZWQga2V5LlxuICAgKi9cbiAgX25vcm1hbGl6ZVNjaGVkdWxlS2V5KHNjaGVkdWxlS2V5KSB7XG4gICAgaWYgKHR5cGVvZiBzY2hlZHVsZUtleSA9PT0gXCJzdHJpbmdcIiAmJiBzY2hlZHVsZUtleS5sZW5ndGggPiAwICYmIHNjaGVkdWxlS2V5Lmxlbmd0aCA8PSAyNTUpIHJldHVybiBzY2hlZHVsZUtleVxuXG4gICAgdGhyb3cgVmVsb2Npb3VzRXJyb3Iuc2FmZShcImJhY2tncm91bmQgam9iIHNjaGVkdWxlS2V5IG11c3QgYmUgYSBub24tZW1wdHkgc3RyaW5nIG9mIGF0IG1vc3QgMjU1IGNoYXJhY3RlcnNcIilcbiAgfVxuXG4gIC8qKlxuICAgKiBCdWlsZHMgYSBib3VuZGVkIGFkdmlzb3J5LWxvY2sgbmFtZSBmb3Igb25lIHN0YWJsZSBzY2hlZHVsZSBrZXkuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBzY2hlZHVsZUtleSAtIFZhbGlkYXRlZCBzdGFibGUgc2NoZWR1bGUga2V5LlxuICAgKiBAcmV0dXJucyB7c3RyaW5nfSAtIEFkdmlzb3J5LWxvY2sgbmFtZS5cbiAgICovXG4gIF9zY2hlZHVsZUtleUxvY2tOYW1lKHNjaGVkdWxlS2V5KSB7XG4gICAgY29uc3QgaGFzaCA9IGNyZWF0ZUhhc2goXCJzaGEyNTZcIikudXBkYXRlKHNjaGVkdWxlS2V5KS5kaWdlc3QoXCJoZXhcIikuc2xpY2UoMCwgMzIpXG5cbiAgICByZXR1cm4gYGJhY2tncm91bmQtam9iczpzY2hlZHVsZToke2hhc2h9YFxuICB9XG5cbiAgLyoqXG4gICAqIEVuc3VyZXMgdGhlIGJhY2tncm91bmQtam9icyBzY2hlbWEgZXhpc3RzLCByZXVzaW5nIGEgY2FsbGVyLWhlbGQgY29ubmVjdGlvbiB3aGVuXG4gICAqIG9uZSBpcyBnaXZlbiByYXRoZXIgdGhhbiBjaGVja2luZyBvdXQgaXRzIG93bi5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9kYXRhYmFzZS9kcml2ZXJzL2Jhc2UuanNcIikuZGVmYXVsdH0gW2V4aXN0aW5nRGJdIC0gUmV1c2UgYW5cbiAgICogICBhbHJlYWR5LWNoZWNrZWQtb3V0IGNvbm5lY3Rpb24gKGUuZy4gdGhlIG9uZSBgZGI6bWlncmF0ZWAgaG9sZHMpIGluc3RlYWQgb2ZcbiAgICogICBjaGVja2luZyBvdXQgYSBuZXN0ZWQgb25lIOKAlCB0aGUgbmVzdGVkIGNoZWNrb3V0IHdvdWxkIGRlYWRsb2NrIGEgZGF0YWJhc2VcbiAgICogICB3aG9zZSBwb29sIGlzIGNhcHBlZCBhdCBhIHNpbmdsZSBjb25uZWN0aW9uIGFscmVhZHkgaGVsZCBieSB0aGUgY2FsbGVyLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyB3aGVuIHRoZSBzY2hlbWEgaXMgcHJlc2VudC5cbiAgICovXG4gIGFzeW5jIF9lbnN1cmVTY2hlbWEoZXhpc3RpbmdEYikge1xuICAgIGF3YWl0IHRoaXMuX2FwcGx5U2NoZW1hKGV4aXN0aW5nRGIpXG4gIH1cblxuICAvKipcbiAgICogU2VyaWFsaXplcyBjcmVhdGlvbiBvciB1cGdyYWRlIG9mIHRoZSBiYWNrZ3JvdW5kLWpvYnMgc2NoZW1hLCBjaGVja2luZyBvdXQgYVxuICAgKiBjb25uZWN0aW9uIG9ubHkgYWZ0ZXIgZWFybGllciBzY2hlbWEgd29yayBoYXMgY29tcGxldGVkIHdoZW4gb25lIGlzIG5vdCBzdXBwbGllZC5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9kYXRhYmFzZS9kcml2ZXJzL2Jhc2UuanNcIikuZGVmYXVsdH0gW2V4aXN0aW5nRGJdIC0gQ2FsbGVyLW93bmVkXG4gICAqICAgZGF0YWJhc2UgY29ubmVjdGlvbi5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgd2hlbiB0aGUgc2NoZW1hIGlzIHByZXNlbnQuXG4gICAqL1xuICBhc3luYyBfYXBwbHlTY2hlbWEoZXhpc3RpbmdEYikge1xuICAgIC8vIFNlcmlhbGl6ZSBjb25jdXJyZW50IHNjaGVtYSBhcHBsaWVzIHdpdGhpbiB0aGlzIHByb2Nlc3MsIGtleWVkIGJ5IGRhdGFiYXNlXG4gICAgLy8gaWRlbnRpZmllciAoc2VlIGBzY2hlbWFBcHBseUNoYWluc2ApLiBUaGUgcGVyLXN0ZXAgbG9ja3MgaW5zaWRlIHRoZSBzdGVwcyB1c2VcbiAgICAvLyBESUZGRVJFTlQgbG9jayBuYW1lcywgc28gdHdvIGNvbmN1cnJlbnQgY2FsbGVycyBjb3VsZCBvdGhlcndpc2UgZWFjaCBob2xkIGFcbiAgICAvLyBkaWZmZXJlbnQgc3RlcCBsb2NrIHdoaWxlIGJvdGggcmVidWlsZCB0aGUgam9icyB0YWJsZSDigJQgYW5kIG9uIFNRTGl0ZS9NU1NRTCBhblxuICAgIC8vIGFkZC1jb2x1bW4gaXMgYSBjcmVhdGUtY29weS1kcm9wLXJlbmFtZSByZWJ1aWxkLCBzbyBvdmVybGFwcGluZyByZWJ1aWxkc1xuICAgIC8vIGNvcnJ1cHQgaXQuIFRoaXMgbXV0ZXggbWFrZXMgdGhlIHdob2xlIGFwcGx5IG11dHVhbGx5IGV4Y2x1c2l2ZSBwZXIgcHJvY2VzcztcbiAgICAvLyB0aGUgc2Vjb25kIGNhbGxlciB0aGVuIHJlLWNoZWNrcyBhbmQgZmluZHMgZXZlcnkgc3RlcCBhbHJlYWR5IGRvbmUuXG4gICAgY29uc3QgaWRlbnRpZmllciA9IHRoaXMuZ2V0RGF0YWJhc2VJZGVudGlmaWVyKCkgPz8gXCJkZWZhdWx0XCJcbiAgICBjb25zdCBwcmV2aW91cyA9IHNjaGVtYUFwcGx5Q2hhaW5zLmdldChpZGVudGlmaWVyKSA/PyBQcm9taXNlLnJlc29sdmUoKVxuICAgIGNvbnN0IGFwcGx5V2l0aENvbm5lY3Rpb24gPSBhc3luYyAoKSA9PiB7XG4gICAgICBpZiAoZXhpc3RpbmdEYikge1xuICAgICAgICBhd2FpdCB0aGlzLl9hcHBseVNjaGVtYVN0ZXBzKGV4aXN0aW5nRGIpXG5cbiAgICAgICAgcmV0dXJuXG4gICAgICB9XG5cbiAgICAgIGF3YWl0IHRoaXMuX3dpdGhEYigoZGIpID0+IHRoaXMuX2FwcGx5U2NoZW1hU3RlcHMoZGIpKVxuICAgIH1cbiAgICBjb25zdCBydW4gPSBwcmV2aW91cy50aGVuKGFwcGx5V2l0aENvbm5lY3Rpb24sIGFwcGx5V2l0aENvbm5lY3Rpb24pXG5cbiAgICAvLyBLZWVwIHRoZSBjaGFpbiBhbGl2ZSByZWdhcmRsZXNzIG9mIHRoaXMgcnVuJ3Mgb3V0Y29tZSBzbyBvbmUgZmFpbGVkIGFwcGx5IGRvZXNcbiAgICAvLyBub3Qgd2VkZ2UgbGF0ZXIgY2FsbGVyczsgdGhpcyBydW4gc3RpbGwgcHJvcGFnYXRlcyBpdHMgb3duIHJlc3VsdC9lcnJvci5cbiAgICBzY2hlbWFBcHBseUNoYWlucy5zZXQoaWRlbnRpZmllciwgcnVuLnRoZW4oKCkgPT4ge30sICgpID0+IHt9KSlcblxuICAgIHJldHVybiBhd2FpdCBydW5cbiAgfVxuXG4gIC8qKlxuICAgKiBDcmVhdGVzIG9yIHVwZ3JhZGVzIHRoZSBiYWNrZ3JvdW5kLWpvYnMgdGFibGVzLCBjb2x1bW5zIGFuZCBjb25jdXJyZW5jeSByb3dzIG9uXG4gICAqIHRoZSBnaXZlbiBjb25uZWN0aW9uLiBTZXJpYWxpemVkIHBlciBwcm9jZXNzIGJ5IHtAbGluayBCYWNrZ3JvdW5kSm9ic1N0b3JlI19hcHBseVNjaGVtYX0uXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vZGF0YWJhc2UvZHJpdmVycy9iYXNlLmpzXCIpLmRlZmF1bHR9IGRiIC0gRGF0YWJhc2UgY29ubmVjdGlvbi5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgd2hlbiB0aGUgc2NoZW1hIGlzIHByZXNlbnQuXG4gICAqL1xuICBhc3luYyBfYXBwbHlTY2hlbWFTdGVwcyhkYikge1xuICAgIGF3YWl0IHRoaXMuX2Vuc3VyZU1pZ3JhdGlvbnNUYWJsZShkYilcblxuICAgIGNvbnN0IGFscmVhZHlBcHBsaWVkID0gYXdhaXQgdGhpcy5faGFzTWlncmF0aW9uKGRiKVxuICAgIGNvbnN0IHNjaGVtYVJlY292ZXJ5UGVuZGluZyA9IGF3YWl0IHRoaXMuX2hhc01pZ3JhdGlvbihkYiwgU0NIRU1BX1JFQ09WRVJZX1BFTkRJTkdfVkVSU0lPTilcbiAgICBjb25zdCBqb2JzVGFibGVFeGlzdHMgPSBhd2FpdCBkYi50YWJsZUV4aXN0cyhKT0JTX1RBQkxFKVxuXG4gICAgLy8gRXZlbiB3aGVuIHRoZSBtaWdyYXRpb24gcm93IGlzIHByZXNlbnQsIHRoZSBqb2JzIHRhYmxlIGl0c2VsZiBjYW4gaGF2ZVxuICAgIC8vIGJlZW4gZHJvcHBlZCB1bmRlcm5lYXRoIHVzIGJ5IGEgdHJhbnNhY3Rpb24gcm9sbGJhY2sgaW4gYW5vdGhlciBjYWxsZXJcbiAgICAvLyAoRERMIGlzIHRyYW5zYWN0aW9uYWwgb24gU1FMaXRlL01TU1FMKS4gVmVyaWZ5IHRoZSB0YWJsZSBwaHlzaWNhbGx5XG4gICAgLy8gZXhpc3RzIGFuZCByZWNyZWF0ZSBpdCB3aGVuIG1pc3NpbmcgcmF0aGVyIHRoYW4gdHJ1c3RpbmcgdGhlIG1pZ3JhdGlvblxuICAgIC8vIHJvdyBhbG9uZSwgb3RoZXJ3aXNlIGxhdGVyIGNhbGxlcnMgZmFpbCB3aXRoIFwibm8gc3VjaCB0YWJsZVwiLlxuICAgIGlmIChhbHJlYWR5QXBwbGllZCAmJiBqb2JzVGFibGVFeGlzdHMgJiYgIXNjaGVtYVJlY292ZXJ5UGVuZGluZykge1xuICAgICAgYXdhaXQgdGhpcy5fZW5zdXJlSm9ic1RhYmxlQ29sdW1ucyhkYilcbiAgICAgIGF3YWl0IHRoaXMuX2Vuc3VyZUlkZW1wb3RlbmN5S2V5c1RhYmxlKGRiKVxuICAgICAgYXdhaXQgdGhpcy5fZW5zdXJlTWFpbERlbGl2ZXJ5T3BlcmF0aW9uc1RhYmxlKGRiKVxuICAgICAgYXdhaXQgdGhpcy5fZW5zdXJlU2NoZWR1bGVLZXlzVGFibGUoZGIpXG4gICAgICBhd2FpdCB0aGlzLl9lbnN1cmVDb25jdXJyZW5jeVRhYmxlKGRiKVxuICAgICAgYXdhaXQgdGhpcy5fZW5zdXJlQ291bnRSZXZpc2lvblRhYmxlKGRiKVxuXG4gICAgICByZXR1cm5cbiAgICB9XG5cbiAgICBpZiAoYWxyZWFkeUFwcGxpZWQgJiYgIXNjaGVtYVJlY292ZXJ5UGVuZGluZykge1xuICAgICAgYXdhaXQgdGhpcy5fcmVjb3JkTWlncmF0aW9uKGRiLCBTQ0hFTUFfUkVDT1ZFUllfUEVORElOR19WRVJTSU9OKVxuICAgIH1cblxuICAgIGF3YWl0IHRoaXMuX2FwcGx5TWlncmF0aW9ucyhkYilcbiAgICBhd2FpdCB0aGlzLl9lbnN1cmVKb2JzVGFibGVDb2x1bW5zKGRiKVxuICAgIGF3YWl0IHRoaXMuX2Vuc3VyZUlkZW1wb3RlbmN5S2V5c1RhYmxlKGRiKVxuICAgIGF3YWl0IHRoaXMuX2Vuc3VyZU1haWxEZWxpdmVyeU9wZXJhdGlvbnNUYWJsZShkYilcbiAgICBhd2FpdCB0aGlzLl9lbnN1cmVTY2hlZHVsZUtleXNUYWJsZShkYilcbiAgICBhd2FpdCB0aGlzLl9lbnN1cmVDb25jdXJyZW5jeVRhYmxlKGRiKVxuICAgIGF3YWl0IHRoaXMuX2Vuc3VyZUNvdW50UmV2aXNpb25UYWJsZShkYilcblxuICAgIGlmIChhbHJlYWR5QXBwbGllZCkge1xuICAgICAgLy8gVGhlIHJlY3JlYXRlZCBqb2JzIHRhYmxlIGlzIGVtcHR5LCBidXQgdGhlIHN1cnZpdmluZyBjb25jdXJyZW5jeSB0YWJsZVxuICAgICAgLy8gY2FuIHN0aWxsIGNvdW50IGhhbmRvZmZzIHRoYXQgZGlzYXBwZWFyZWQgd2l0aCB0aGUgZHJvcHBlZCBqb2JzIHRhYmxlLlxuICAgICAgYXdhaXQgdGhpcy5fcmVjb25jaWxlQ29uY3VycmVuY3koZGIpXG4gICAgICBhd2FpdCBkYi5kZWxldGUoe1xuICAgICAgICB0YWJsZU5hbWU6IE1JR1JBVElPTlNfVEFCTEUsXG4gICAgICAgIGNvbmRpdGlvbnM6IHtrZXk6IHRoaXMuX21pZ3JhdGlvbktleShTQ0hFTUFfUkVDT1ZFUllfUEVORElOR19WRVJTSU9OKX1cbiAgICAgIH0pXG5cbiAgICAgIHJldHVyblxuICAgIH1cblxuICAgIGF3YWl0IHRoaXMuX3JlY29yZE1pZ3JhdGlvbihkYiwgTUlHUkFUSU9OX1ZFUlNJT04pXG4gIH1cblxuICAvKipcbiAgICogUnVucyBlbnN1cmUgbWlncmF0aW9ucyB0YWJsZS5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9kYXRhYmFzZS9kcml2ZXJzL2Jhc2UuanNcIikuZGVmYXVsdH0gZGIgLSBEYXRhYmFzZSBjb25uZWN0aW9uLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyB3aGVuIGNvbXBsZXRlLlxuICAgKi9cbiAgYXN5bmMgX2Vuc3VyZU1pZ3JhdGlvbnNUYWJsZShkYikge1xuICAgIGlmIChhd2FpdCBkYi50YWJsZUV4aXN0cyhNSUdSQVRJT05TX1RBQkxFKSkgcmV0dXJuXG5cbiAgICBjb25zdCB0YWJsZSA9IG5ldyBUYWJsZURhdGEoTUlHUkFUSU9OU19UQUJMRSwge2lmTm90RXhpc3RzOiB0cnVlfSlcblxuICAgIHRhYmxlLnN0cmluZyhcImtleVwiLCB7bnVsbDogZmFsc2UsIHByaW1hcnlLZXk6IHRydWV9KVxuICAgIHRhYmxlLnN0cmluZyhcInNjb3BlXCIsIHtudWxsOiBmYWxzZX0pXG4gICAgdGFibGUuc3RyaW5nKFwidmVyc2lvblwiLCB7bnVsbDogZmFsc2V9KVxuICAgIHRhYmxlLmJpZ2ludChcImFwcGxpZWRfYXRfbXNcIiwge251bGw6IGZhbHNlfSlcblxuICAgIGF3YWl0IGRiLmNyZWF0ZVRhYmxlKHRhYmxlKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgaGFzIG1pZ3JhdGlvbi5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9kYXRhYmFzZS9kcml2ZXJzL2Jhc2UuanNcIikuZGVmYXVsdH0gZGIgLSBEYXRhYmFzZSBjb25uZWN0aW9uLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gW3ZlcnNpb25dIC0gTWlncmF0aW9uIHZlcnNpb24uXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPGJvb2xlYW4+fSAtIFdoZXRoZXIgbWlncmF0aW9uIGV4aXN0cy5cbiAgICovXG4gIGFzeW5jIF9oYXNNaWdyYXRpb24oZGIsIHZlcnNpb24gPSBNSUdSQVRJT05fVkVSU0lPTikge1xuICAgIGNvbnN0IHF1ZXJ5ID0gZGJcbiAgICAgIC5uZXdRdWVyeSgpXG4gICAgICAuZnJvbShNSUdSQVRJT05TX1RBQkxFKVxuICAgICAgLndoZXJlKHtrZXk6IHRoaXMuX21pZ3JhdGlvbktleSh2ZXJzaW9uKX0pXG4gICAgICAubGltaXQoMSlcblxuICAgIGNvbnN0IHJvd3MgPSBhd2FpdCBxdWVyeS5yZXN1bHRzKClcblxuICAgIHJldHVybiByb3dzLmxlbmd0aCA+IDBcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGFwcGx5IG1pZ3JhdGlvbnMuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vZGF0YWJhc2UvZHJpdmVycy9iYXNlLmpzXCIpLmRlZmF1bHR9IGRiIC0gRGF0YWJhc2UgY29ubmVjdGlvbi5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgd2hlbiBjb21wbGV0ZS5cbiAgICovXG4gIGFzeW5jIF9hcHBseU1pZ3JhdGlvbnMoZGIpIHtcbiAgICB0aGlzLmxvZ2dlci5pbmZvKFwiQXBwbHlpbmcgYmFja2dyb3VuZCBqb2JzIHNjaGVtYVwiKVxuXG4gICAgaWYgKGF3YWl0IGRiLnRhYmxlRXhpc3RzKEpPQlNfVEFCTEUpKSB7XG4gICAgICB0aGlzLmxvZ2dlci5pbmZvKFwiQmFja2dyb3VuZCBqb2JzIHRhYmxlIGFscmVhZHkgZXhpc3RzIC0gc2tpcHBpbmcgY3JlYXRlXCIpXG4gICAgICByZXR1cm5cbiAgICB9XG5cbiAgICBjb25zdCB0YWJsZSA9IG5ldyBUYWJsZURhdGEoSk9CU19UQUJMRSwge2lmTm90RXhpc3RzOiB0cnVlfSlcblxuICAgIHRhYmxlLnN0cmluZyhcImlkXCIsIHtwcmltYXJ5S2V5OiB0cnVlfSlcbiAgICB0YWJsZS5zdHJpbmcoXCJqb2JfbmFtZVwiLCB7bnVsbDogZmFsc2UsIGluZGV4OiB0cnVlfSlcbiAgICB0YWJsZS50ZXh0KFwiYXJnc19qc29uXCIsIHtudWxsOiBmYWxzZX0pXG4gICAgdGFibGUuc3RyaW5nKFwiZXhlY3V0aW9uX21vZGVcIiwge251bGw6IGZhbHNlfSlcbiAgICB0YWJsZS5zdHJpbmcoXCJxdWV1ZVwiLCB7bnVsbDogdHJ1ZSwgaW5kZXg6IHRydWV9KVxuICAgIHRhYmxlLmludGVnZXIoXCJtYXhfcmV0cmllc1wiLCB7bnVsbDogZmFsc2V9KVxuICAgIHRhYmxlLmludGVnZXIoXCJhdHRlbXB0c1wiLCB7bnVsbDogZmFsc2V9KVxuICAgIHRhYmxlLnN0cmluZyhcInN0YXR1c1wiLCB7bnVsbDogZmFsc2UsIGluZGV4OiB0cnVlfSlcbiAgICB0YWJsZS5iaWdpbnQoXCJzY2hlZHVsZWRfYXRfbXNcIiwge251bGw6IGZhbHNlLCBpbmRleDogdHJ1ZX0pXG4gICAgdGFibGUuYmlnaW50KFwiY3JlYXRlZF9hdF9tc1wiLCB7bnVsbDogZmFsc2UsIGluZGV4OiB0cnVlfSlcbiAgICB0YWJsZS5zdHJpbmcoXCJzY2hlZHVsZV9rZXlcIiwge251bGw6IHRydWUsIGluZGV4OiB0cnVlfSlcbiAgICB0YWJsZS5iaWdpbnQoXCJoYW5kZWRfb2ZmX2F0X21zXCIsIHtudWxsOiB0cnVlLCBpbmRleDogdHJ1ZX0pXG4gICAgdGFibGUuc3RyaW5nKFwiaGFuZG9mZl9pZFwiLCB7bnVsbDogdHJ1ZX0pXG4gICAgdGFibGUuYmlnaW50KFwiY29tcGxldGVkX2F0X21zXCIsIHtudWxsOiB0cnVlfSlcbiAgICB0YWJsZS5iaWdpbnQoXCJmYWlsZWRfYXRfbXNcIiwge251bGw6IHRydWV9KVxuICAgIHRhYmxlLmJpZ2ludChcIm9ycGhhbmVkX2F0X21zXCIsIHtudWxsOiB0cnVlLCBpbmRleDogdHJ1ZX0pXG4gICAgdGFibGUuc3RyaW5nKFwid29ya2VyX2lkXCIsIHtudWxsOiB0cnVlfSlcbiAgICB0YWJsZS50ZXh0KFwibGFzdF9lcnJvclwiLCB7bnVsbDogdHJ1ZX0pXG4gICAgdGFibGUuc3RyaW5nKFwiY29uY3VycmVuY3lfa2V5XCIsIHtudWxsOiB0cnVlLCBpbmRleDogdHJ1ZX0pXG4gICAgdGFibGUuaW50ZWdlcihcIm1heF9jb25jdXJyZW5jeVwiLCB7bnVsbDogdHJ1ZX0pXG4gICAgdGFibGUuYmlnaW50KFwidGltZW91dF9tc1wiLCB7bnVsbDogdHJ1ZX0pXG5cbiAgICBhd2FpdCBkYi5jcmVhdGVUYWJsZSh0YWJsZSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGVuc3VyZSBqb2JzIHRhYmxlIGNvbHVtbnMuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vZGF0YWJhc2UvZHJpdmVycy9iYXNlLmpzXCIpLmRlZmF1bHR9IGRiIC0gRGF0YWJhc2UgY29ubmVjdGlvbi5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgd2hlbiBjb21wbGV0ZS5cbiAgICovXG4gIGFzeW5jIF9lbnN1cmVKb2JzVGFibGVDb2x1bW5zKGRiKSB7XG4gICAgaWYgKCEoYXdhaXQgZGIudGFibGVFeGlzdHMoSk9CU19UQUJMRSkpKSByZXR1cm5cblxuICAgIGNvbnN0IHRhYmxlID0gYXdhaXQgZGIuZ2V0VGFibGVCeU5hbWVPckZhaWwoSk9CU19UQUJMRSlcbiAgICBjb25zdCBleGVjdXRpb25Nb2RlQ29sdW1uID0gYXdhaXQgdGFibGUuZ2V0Q29sdW1uQnlOYW1lKFwiZXhlY3V0aW9uX21vZGVcIilcblxuICAgIGlmICghZXhlY3V0aW9uTW9kZUNvbHVtbikge1xuICAgICAgY29uc3QgdGFibGVEYXRhID0gbmV3IFRhYmxlRGF0YShKT0JTX1RBQkxFKVxuICAgICAgdGFibGVEYXRhLnN0cmluZyhcImV4ZWN1dGlvbl9tb2RlXCIsIHtudWxsOiB0cnVlfSlcbiAgICAgIGNvbnN0IHNxbHMgPSBhd2FpdCBkYi5hbHRlclRhYmxlU1FMcyh0YWJsZURhdGEpXG5cbiAgICAgIGZvciAoY29uc3Qgc3FsIG9mIHNxbHMpIHtcbiAgICAgICAgYXdhaXQgZGIucXVlcnkoc3FsKVxuICAgICAgfVxuXG4gICAgICBkYi5jbGVhclNjaGVtYUNhY2hlKClcbiAgICB9XG5cbiAgICBjb25zdCByZWZyZXNoZWRUYWJsZSA9IGF3YWl0IGRiLmdldFRhYmxlQnlOYW1lT3JGYWlsKEpPQlNfVEFCTEUpXG4gICAgY29uc3QgaGFuZG9mZklkQ29sdW1uID0gYXdhaXQgcmVmcmVzaGVkVGFibGUuZ2V0Q29sdW1uQnlOYW1lKFwiaGFuZG9mZl9pZFwiKVxuXG4gICAgaWYgKCFoYW5kb2ZmSWRDb2x1bW4pIHtcbiAgICAgIGNvbnN0IGxvY2tOYW1lID0gYCR7TUlHUkFUSU9OX1NDT1BFfTpoYW5kb2ZmX2lkX2NvbHVtbmBcbiAgICAgIGNvbnN0IGFjcXVpcmVkID0gYXdhaXQgZGIuYWNxdWlyZUFkdmlzb3J5TG9jayhsb2NrTmFtZSlcblxuICAgICAgaWYgKCFhY3F1aXJlZCkgdGhyb3cgbmV3IEVycm9yKFwiRmFpbGVkIHRvIGFjcXVpcmUgYmFja2dyb3VuZCBqb2JzIGhhbmRvZmYgc2NoZW1hIGxvY2tcIilcblxuICAgICAgdHJ5IHtcbiAgICAgICAgZGIuY2xlYXJTY2hlbWFDYWNoZSgpXG4gICAgICAgIGNvbnN0IGxvY2tlZFRhYmxlID0gYXdhaXQgZGIuZ2V0VGFibGVCeU5hbWVPckZhaWwoSk9CU19UQUJMRSlcblxuICAgICAgICBpZiAoIShhd2FpdCBsb2NrZWRUYWJsZS5nZXRDb2x1bW5CeU5hbWUoXCJoYW5kb2ZmX2lkXCIpKSkge1xuICAgICAgICAgIGNvbnN0IHRhYmxlRGF0YSA9IG5ldyBUYWJsZURhdGEoSk9CU19UQUJMRSlcbiAgICAgICAgICB0YWJsZURhdGEuc3RyaW5nKFwiaGFuZG9mZl9pZFwiLCB7bnVsbDogdHJ1ZX0pXG4gICAgICAgICAgY29uc3Qgc3FscyA9IGF3YWl0IGRiLmFsdGVyVGFibGVTUUxzKHRhYmxlRGF0YSlcblxuICAgICAgICAgIGZvciAoY29uc3Qgc3FsIG9mIHNxbHMpIHtcbiAgICAgICAgICAgIGF3YWl0IGRiLnF1ZXJ5KHNxbClcbiAgICAgICAgICB9XG5cbiAgICAgICAgICBkYi5jbGVhclNjaGVtYUNhY2hlKClcbiAgICAgICAgfVxuICAgICAgfSBmaW5hbGx5IHtcbiAgICAgICAgYXdhaXQgZGIucmVsZWFzZUFkdmlzb3J5TG9jayhsb2NrTmFtZSlcbiAgICAgIH1cbiAgICB9XG5cbiAgICBhd2FpdCB0aGlzLl9iYWNrZmlsbEV4ZWN1dGlvbk1vZGVzT25jZShkYilcbiAgICBhd2FpdCB0aGlzLl9kcm9wRm9ya2VkQ29sdW1uT25jZShkYilcblxuICAgIGNvbnN0IGxvY2tOYW1lID0gYCR7TUlHUkFUSU9OX1NDT1BFfTpjb25jdXJyZW5jeV9jb2x1bW5zYFxuICAgIGNvbnN0IGFjcXVpcmVkID0gYXdhaXQgZGIuYWNxdWlyZUFkdmlzb3J5TG9jayhsb2NrTmFtZSlcblxuICAgIGlmICghYWNxdWlyZWQpIHRocm93IG5ldyBFcnJvcihcIkZhaWxlZCB0byBhY3F1aXJlIGJhY2tncm91bmQgam9icyBjb25jdXJyZW5jeSBzY2hlbWEgbG9ja1wiKVxuXG4gICAgdHJ5IHtcbiAgICAgIC8vIFNRTCBTZXJ2ZXIgc2NoZW1hIHJlYWRzIGNhbiBkZWFkbG9jayB3aXRoIGEgY29uY3VycmVudCBBTFRFUiBUQUJMRSwgc29cbiAgICAgIC8vIGFjcXVpcmUgdGhlIGxvY2sgYmVmb3JlIGluc3BlY3RpbmcgZWl0aGVyIGNvbHVtbiByYXRoZXIgdGhhbiBvbmx5XG4gICAgICAvLyBwcm90ZWN0aW5nIHRoZSBtdXRhdGlvbi5cbiAgICAgIGRiLmNsZWFyU2NoZW1hQ2FjaGUoKVxuICAgICAgY29uc3QgbG9ja2VkVGFibGUgPSBhd2FpdCBkYi5nZXRUYWJsZUJ5TmFtZU9yRmFpbChKT0JTX1RBQkxFKVxuICAgICAgY29uc3QgY29uY3VycmVuY3lDb2x1bW5OYW1lcyA9IFtcImNvbmN1cnJlbmN5X2tleVwiLCBcIm1heF9jb25jdXJyZW5jeVwiXVxuXG4gICAgICBmb3IgKGNvbnN0IGNvbmN1cnJlbmN5Q29sdW1uTmFtZSBvZiBjb25jdXJyZW5jeUNvbHVtbk5hbWVzKSB7XG4gICAgICAgIGlmIChhd2FpdCBsb2NrZWRUYWJsZS5nZXRDb2x1bW5CeU5hbWUoY29uY3VycmVuY3lDb2x1bW5OYW1lKSkgY29udGludWVcblxuICAgICAgICBjb25zdCB0YWJsZURhdGEgPSBuZXcgVGFibGVEYXRhKEpPQlNfVEFCTEUpXG4gICAgICAgIGlmIChjb25jdXJyZW5jeUNvbHVtbk5hbWUgPT0gXCJjb25jdXJyZW5jeV9rZXlcIikge1xuICAgICAgICAgIHRhYmxlRGF0YS5zdHJpbmcoXCJjb25jdXJyZW5jeV9rZXlcIiwge251bGw6IHRydWUsIGluZGV4OiB0cnVlfSlcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICB0YWJsZURhdGEuaW50ZWdlcihcIm1heF9jb25jdXJyZW5jeVwiLCB7bnVsbDogdHJ1ZX0pXG4gICAgICAgIH1cblxuICAgICAgICBmb3IgKGNvbnN0IHNxbCBvZiBhd2FpdCBkYi5hbHRlclRhYmxlU1FMcyh0YWJsZURhdGEpKSBhd2FpdCBkYi5xdWVyeShzcWwpXG4gICAgICB9XG5cbiAgICAgIGRiLmNsZWFyU2NoZW1hQ2FjaGUoKVxuICAgIH0gZmluYWxseSB7XG4gICAgICBhd2FpdCBkYi5yZWxlYXNlQWR2aXNvcnlMb2NrKGxvY2tOYW1lKVxuICAgIH1cblxuICAgIGF3YWl0IHRoaXMuX2Vuc3VyZVF1ZXVlQ29sdW1uKGRiKVxuICAgIGF3YWl0IHRoaXMuX2Vuc3VyZVNjaGVkdWxlS2V5Q29sdW1uKGRiKVxuICAgIGF3YWl0IHRoaXMuX2Vuc3VyZUpvYlRpbWVvdXRDb2x1bW4oZGIpXG4gICAgYXdhaXQgdGhpcy5fZW5zdXJlSm9ic1RhYmxlSW5kZXhlc09uY2UoZGIpXG4gIH1cblxuICAvKipcbiAgICogUmVwYWlycyBzZWNvbmRhcnkgaW5kZXhlcyB0aGF0IG9sZGVyIGFkZC1jb2x1bW4gdXBncmFkZXMgZGVjbGFyZWQgYnV0IGRpZFxuICAgKiBub3QgY3JlYXRlIG9uIGV2ZXJ5IFNRTCBkcml2ZXIuIFRoZSBtaWdyYXRpb24gbGVkZ2VyIGtlZXBzIHJvdXRpbmUgc3RvcmVcbiAgICogcmVhZGluZXNzIGZyb20gcmVwZWF0ZWRseSBpbnRyb3NwZWN0aW5nIHRoZSBmdWxsIGluZGV4IHNldC5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9kYXRhYmFzZS9kcml2ZXJzL2Jhc2UuanNcIikuZGVmYXVsdH0gZGIgLSBEYXRhYmFzZSBjb25uZWN0aW9uLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyB3aGVuIGFsbCBleHBlY3RlZCBpbmRleGVzIGV4aXN0LlxuICAgKi9cbiAgYXN5bmMgX2Vuc3VyZUpvYnNUYWJsZUluZGV4ZXNPbmNlKGRiKSB7XG4gICAgY29uc3QgbWlncmF0aW9uVmVyc2lvbiA9IEpPQlNfSU5ERVhfUkVQQUlSX01JR1JBVElPTl9WRVJTSU9OXG4gICAgY29uc3QgbWlncmF0aW9uS2V5ID0gdGhpcy5fbWlncmF0aW9uS2V5KG1pZ3JhdGlvblZlcnNpb24pXG5cbiAgICBpZiAoYXdhaXQgdGhpcy5faGFzTWlncmF0aW9uKGRiLCBtaWdyYXRpb25WZXJzaW9uKSkgcmV0dXJuXG5cbiAgICBjb25zdCBhY3F1aXJlZCA9IGF3YWl0IGRiLmFjcXVpcmVBZHZpc29yeUxvY2sobWlncmF0aW9uS2V5KVxuXG4gICAgaWYgKCFhY3F1aXJlZCkgdGhyb3cgbmV3IEVycm9yKFwiRmFpbGVkIHRvIGFjcXVpcmUgYmFja2dyb3VuZCBqb2JzIGluZGV4IHJlcGFpciBsb2NrXCIpXG5cbiAgICB0cnkge1xuICAgICAgaWYgKGF3YWl0IHRoaXMuX2hhc01pZ3JhdGlvbihkYiwgbWlncmF0aW9uVmVyc2lvbikpIHJldHVyblxuXG4gICAgICBkYi5jbGVhclNjaGVtYUNhY2hlKClcbiAgICAgIGNvbnN0IHRhYmxlID0gYXdhaXQgZGIuZ2V0VGFibGVCeU5hbWVPckZhaWwoSk9CU19UQUJMRSlcbiAgICAgIGNvbnN0IGluZGV4ZWRDb2x1bW5OYW1lcyA9IG5ldyBTZXQoXG4gICAgICAgIChhd2FpdCB0YWJsZS5nZXRJbmRleGVzKCkpXG4gICAgICAgICAgLmZpbHRlcigoaW5kZXgpID0+ICFpbmRleC5pc1ByaW1hcnlLZXkoKSAmJiBpbmRleC5nZXRDb2x1bW5OYW1lcygpLmxlbmd0aCA9PT0gMSlcbiAgICAgICAgICAubWFwKChpbmRleCkgPT4gaW5kZXguZ2V0Q29sdW1uTmFtZXMoKVswXSlcbiAgICAgIClcblxuICAgICAgZm9yIChjb25zdCBjb2x1bW5OYW1lIG9mIEpPQlNfSU5ERVhfQ09MVU1OX05BTUVTKSB7XG4gICAgICAgIGlmIChpbmRleGVkQ29sdW1uTmFtZXMuaGFzKGNvbHVtbk5hbWUpKSBjb250aW51ZVxuXG4gICAgICAgIGZvciAoY29uc3Qgc3FsIG9mIGF3YWl0IGRiLmNyZWF0ZUluZGV4U1FMcyh7Y29sdW1uczogW2NvbHVtbk5hbWVdLCBpZk5vdEV4aXN0czogZGIuZ2V0VHlwZSgpID09PSBcInNxbGl0ZVwiLCB0YWJsZU5hbWU6IEpPQlNfVEFCTEV9KSkge1xuICAgICAgICAgIGF3YWl0IGRiLnF1ZXJ5KHNxbClcbiAgICAgICAgfVxuICAgICAgfVxuXG4gICAgICBkYi5jbGVhclNjaGVtYUNhY2hlKClcbiAgICAgIGF3YWl0IHRoaXMuX3JlY29yZE1pZ3JhdGlvbihkYiwgbWlncmF0aW9uVmVyc2lvbilcbiAgICB9IGZpbmFsbHkge1xuICAgICAgYXdhaXQgZGIucmVsZWFzZUFkdmlzb3J5TG9jayhtaWdyYXRpb25LZXkpXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIElkZW1wb3RlbnRseSBhZGRzIHRoZSBwZXItam9iIHdhbGwtY2xvY2sgdGltZW91dCB0byBleGlzdGluZyBqb2IgdGFibGVzLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL2RhdGFiYXNlL2RyaXZlcnMvYmFzZS5qc1wiKS5kZWZhdWx0fSBkYiAtIERhdGFiYXNlIGNvbm5lY3Rpb24uXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIHdoZW4gZW5zdXJlZC5cbiAgICovXG4gIGFzeW5jIF9lbnN1cmVKb2JUaW1lb3V0Q29sdW1uKGRiKSB7XG4gICAgY29uc3QgbG9ja05hbWUgPSBgJHtNSUdSQVRJT05fU0NPUEV9OnRpbWVvdXRfbXNfY29sdW1uYFxuICAgIGNvbnN0IGFjcXVpcmVkID0gYXdhaXQgZGIuYWNxdWlyZUFkdmlzb3J5TG9jayhsb2NrTmFtZSlcblxuICAgIGlmICghYWNxdWlyZWQpIHRocm93IG5ldyBFcnJvcihcIkZhaWxlZCB0byBhY3F1aXJlIGJhY2tncm91bmQgam9icyB0aW1lb3V0IHNjaGVtYSBsb2NrXCIpXG5cbiAgICB0cnkge1xuICAgICAgZGIuY2xlYXJTY2hlbWFDYWNoZSgpXG4gICAgICBjb25zdCB0YWJsZSA9IGF3YWl0IGRiLmdldFRhYmxlQnlOYW1lT3JGYWlsKEpPQlNfVEFCTEUpXG5cbiAgICAgIGlmICghKGF3YWl0IHRhYmxlLmdldENvbHVtbkJ5TmFtZShcInRpbWVvdXRfbXNcIikpKSB7XG4gICAgICAgIGNvbnN0IHRhYmxlRGF0YSA9IG5ldyBUYWJsZURhdGEoSk9CU19UQUJMRSlcbiAgICAgICAgdGFibGVEYXRhLmJpZ2ludChcInRpbWVvdXRfbXNcIiwge251bGw6IHRydWV9KVxuXG4gICAgICAgIGZvciAoY29uc3Qgc3FsIG9mIGF3YWl0IGRiLmFsdGVyVGFibGVTUUxzKHRhYmxlRGF0YSkpIGF3YWl0IGRiLnF1ZXJ5KHNxbClcblxuICAgICAgICBkYi5jbGVhclNjaGVtYUNhY2hlKClcbiAgICAgIH1cbiAgICB9IGZpbmFsbHkge1xuICAgICAgYXdhaXQgZGIucmVsZWFzZUFkdmlzb3J5TG9jayhsb2NrTmFtZSlcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogSWRlbXBvdGVudGx5IGFkZHMgdGhlIGhpc3RvcmljYWwgc3RhYmxlIHNjaGVkdWxlIGtleSB0byBleGlzdGluZyBqb2JzLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL2RhdGFiYXNlL2RyaXZlcnMvYmFzZS5qc1wiKS5kZWZhdWx0fSBkYiAtIERhdGFiYXNlIGNvbm5lY3Rpb24uXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIHdoZW4gZW5zdXJlZC5cbiAgICovXG4gIGFzeW5jIF9lbnN1cmVTY2hlZHVsZUtleUNvbHVtbihkYikge1xuICAgIGNvbnN0IGxvY2tOYW1lID0gYCR7TUlHUkFUSU9OX1NDT1BFfTpzY2hlZHVsZV9rZXlfY29sdW1uYFxuICAgIGNvbnN0IGFjcXVpcmVkID0gYXdhaXQgZGIuYWNxdWlyZUFkdmlzb3J5TG9jayhsb2NrTmFtZSlcblxuICAgIGlmICghYWNxdWlyZWQpIHRocm93IG5ldyBFcnJvcihcIkZhaWxlZCB0byBhY3F1aXJlIGJhY2tncm91bmQgam9icyBzY2hlZHVsZS1rZXkgc2NoZW1hIGxvY2tcIilcblxuICAgIHRyeSB7XG4gICAgICBkYi5jbGVhclNjaGVtYUNhY2hlKClcbiAgICAgIGNvbnN0IGxvY2tlZFRhYmxlID0gYXdhaXQgZGIuZ2V0VGFibGVCeU5hbWVPckZhaWwoSk9CU19UQUJMRSlcblxuICAgICAgaWYgKCEoYXdhaXQgbG9ja2VkVGFibGUuZ2V0Q29sdW1uQnlOYW1lKFwic2NoZWR1bGVfa2V5XCIpKSkge1xuICAgICAgICBjb25zdCB0YWJsZURhdGEgPSBuZXcgVGFibGVEYXRhKEpPQlNfVEFCTEUpXG5cbiAgICAgICAgdGFibGVEYXRhLnN0cmluZyhcInNjaGVkdWxlX2tleVwiLCB7bnVsbDogdHJ1ZSwgaW5kZXg6IHRydWV9KVxuXG4gICAgICAgIGZvciAoY29uc3Qgc3FsIG9mIGF3YWl0IGRiLmFsdGVyVGFibGVTUUxzKHRhYmxlRGF0YSkpIGF3YWl0IGRiLnF1ZXJ5KHNxbClcblxuICAgICAgICBkYi5jbGVhclNjaGVtYUNhY2hlKClcbiAgICAgIH1cbiAgICB9IGZpbmFsbHkge1xuICAgICAgYXdhaXQgZGIucmVsZWFzZUFkdmlzb3J5TG9jayhsb2NrTmFtZSlcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogSWRlbXBvdGVudGx5IGFkZHMgdGhlIGBxdWV1ZWAgY29sdW1uIHRvIGFuIGV4aXN0aW5nIGpvYnMgdGFibGUuIEV4aXN0aW5nXG4gICAqIHJvd3MgcmVhZCBiYWNrIGFzIHRoZSBkZWZhdWx0IHF1ZXVlIChzZWUge0BsaW5rIF9ub3JtYWxpemVKb2JSb3d9KSwgc28gbm9cbiAgICogZGF0YSBiYWNrZmlsbCBpcyByZXF1aXJlZC5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9kYXRhYmFzZS9kcml2ZXJzL2Jhc2UuanNcIikuZGVmYXVsdH0gZGIgLSBEYXRhYmFzZSBjb25uZWN0aW9uLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyB3aGVuIGVuc3VyZWQuXG4gICAqL1xuICBhc3luYyBfZW5zdXJlUXVldWVDb2x1bW4oZGIpIHtcbiAgICBjb25zdCBsb2NrTmFtZSA9IGAke01JR1JBVElPTl9TQ09QRX06cXVldWVfY29sdW1uYFxuICAgIGNvbnN0IGFjcXVpcmVkID0gYXdhaXQgZGIuYWNxdWlyZUFkdmlzb3J5TG9jayhsb2NrTmFtZSlcblxuICAgIGlmICghYWNxdWlyZWQpIHRocm93IG5ldyBFcnJvcihcIkZhaWxlZCB0byBhY3F1aXJlIGJhY2tncm91bmQgam9icyBxdWV1ZSBzY2hlbWEgbG9ja1wiKVxuXG4gICAgdHJ5IHtcbiAgICAgIC8vIFNRTCBTZXJ2ZXIgc2NoZW1hIHJlYWRzIGNhbiBkZWFkbG9jayB3aXRoIGEgY29uY3VycmVudCBBTFRFUiBUQUJMRSwgc29cbiAgICAgIC8vIGFjcXVpcmUgdGhlIGxvY2sgYmVmb3JlIGluc3BlY3RpbmcgdGhlIGNvbHVtbiByYXRoZXIgdGhhbiBvbmx5XG4gICAgICAvLyBwcm90ZWN0aW5nIHRoZSBtdXRhdGlvbiAobWlycm9ycyB0aGUgY29uY3VycmVuY3ktY29sdW1uIG1pZ3JhdGlvbikuXG4gICAgICBkYi5jbGVhclNjaGVtYUNhY2hlKClcbiAgICAgIGNvbnN0IGxvY2tlZFRhYmxlID0gYXdhaXQgZGIuZ2V0VGFibGVCeU5hbWVPckZhaWwoSk9CU19UQUJMRSlcblxuICAgICAgaWYgKCEoYXdhaXQgbG9ja2VkVGFibGUuZ2V0Q29sdW1uQnlOYW1lKFwicXVldWVcIikpKSB7XG4gICAgICAgIGNvbnN0IHRhYmxlRGF0YSA9IG5ldyBUYWJsZURhdGEoSk9CU19UQUJMRSlcblxuICAgICAgICB0YWJsZURhdGEuc3RyaW5nKFwicXVldWVcIiwge251bGw6IHRydWUsIGluZGV4OiB0cnVlfSlcblxuICAgICAgICBmb3IgKGNvbnN0IHNxbCBvZiBhd2FpdCBkYi5hbHRlclRhYmxlU1FMcyh0YWJsZURhdGEpKSBhd2FpdCBkYi5xdWVyeShzcWwpXG5cbiAgICAgICAgZGIuY2xlYXJTY2hlbWFDYWNoZSgpXG4gICAgICB9XG4gICAgfSBmaW5hbGx5IHtcbiAgICAgIGF3YWl0IGRiLnJlbGVhc2VBZHZpc29yeUxvY2sobG9ja05hbWUpXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgYmFja2ZpbGwgZXhlY3V0aW9uIG1vZGVzIG9uY2UuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vZGF0YWJhc2UvZHJpdmVycy9iYXNlLmpzXCIpLmRlZmF1bHR9IGRiIC0gRGF0YWJhc2UgY29ubmVjdGlvbi5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgd2hlbiBjb21wbGV0ZS5cbiAgICovXG4gIGFzeW5jIF9iYWNrZmlsbEV4ZWN1dGlvbk1vZGVzT25jZShkYikge1xuICAgIGNvbnN0IG1pZ3JhdGlvblZlcnNpb24gPSBFWEVDVVRJT05fTU9ERV9CQUNLRklMTF9NSUdSQVRJT05fVkVSU0lPTlxuICAgIGNvbnN0IG1pZ3JhdGlvbktleSA9IHRoaXMuX21pZ3JhdGlvbktleShtaWdyYXRpb25WZXJzaW9uKVxuXG4gICAgaWYgKGF3YWl0IHRoaXMuX2hhc01pZ3JhdGlvbihkYiwgbWlncmF0aW9uVmVyc2lvbikpIHJldHVyblxuXG4gICAgYXdhaXQgZGIuYWNxdWlyZUFkdmlzb3J5TG9jayhtaWdyYXRpb25LZXkpXG5cbiAgICB0cnkge1xuICAgICAgaWYgKGF3YWl0IHRoaXMuX2hhc01pZ3JhdGlvbihkYiwgbWlncmF0aW9uVmVyc2lvbikpIHJldHVyblxuXG4gICAgICAvLyBBIHRhYmxlIGNyZWF0ZWQgYWZ0ZXIgdGhlIGBmb3JrZWRgIGNvbHVtbiB3YXMgZHJvcHBlZCBoYXMgbm90aGluZyB0b1xuICAgICAgLy8gYmFja2ZpbGwgZnJvbTsgcmVjb3JkIHRoZSBtaWdyYXRpb24gc28gaXQgaXMgbm90IHJlLWF0dGVtcHRlZC5cbiAgICAgIGRiLmNsZWFyU2NoZW1hQ2FjaGUoKVxuICAgICAgaWYgKCEoYXdhaXQgKGF3YWl0IGRiLmdldFRhYmxlQnlOYW1lT3JGYWlsKEpPQlNfVEFCTEUpKS5nZXRDb2x1bW5CeU5hbWUoXCJmb3JrZWRcIikpKSB7XG4gICAgICAgIGF3YWl0IHRoaXMuX3JlY29yZE1pZ3JhdGlvbihkYiwgbWlncmF0aW9uVmVyc2lvbilcbiAgICAgICAgcmV0dXJuXG4gICAgICB9XG5cbiAgICAgIGNvbnN0IHRhYmxlTmFtZVNxbCA9IGRiLnF1b3RlVGFibGUoSk9CU19UQUJMRSlcbiAgICAgIGNvbnN0IGZvcmtlZENvbHVtblNxbCA9IGRiLnF1b3RlQ29sdW1uKFwiZm9ya2VkXCIpXG4gICAgICBjb25zdCBleGVjdXRpb25Nb2RlQ29sdW1uU3FsID0gZGIucXVvdGVDb2x1bW4oXCJleGVjdXRpb25fbW9kZVwiKVxuXG4gICAgICBhd2FpdCBkYi5xdWVyeShcbiAgICAgICAgYFVQREFURSAke3RhYmxlTmFtZVNxbH0gU0VUICR7ZXhlY3V0aW9uTW9kZUNvbHVtblNxbH0gPSAke2RiLnF1b3RlKFwiZm9ya2VkXCIpfSBgICtcbiAgICAgICAgYFdIRVJFICR7Zm9ya2VkQ29sdW1uU3FsfSA9ICR7ZGIucXVvdGUodHJ1ZSl9IEFORCAke2V4ZWN1dGlvbk1vZGVDb2x1bW5TcWx9IElTIE5VTExgXG4gICAgICApXG4gICAgICBhd2FpdCBkYi5xdWVyeShcbiAgICAgICAgYFVQREFURSAke3RhYmxlTmFtZVNxbH0gU0VUICR7ZXhlY3V0aW9uTW9kZUNvbHVtblNxbH0gPSAke2RiLnF1b3RlKFwiaW5saW5lXCIpfSBgICtcbiAgICAgICAgYFdIRVJFICR7Zm9ya2VkQ29sdW1uU3FsfSA9ICR7ZGIucXVvdGUoZmFsc2UpfSBBTkQgJHtleGVjdXRpb25Nb2RlQ29sdW1uU3FsfSBJUyBOVUxMYFxuICAgICAgKVxuXG4gICAgICBhd2FpdCB0aGlzLl9yZWNvcmRNaWdyYXRpb24oZGIsIG1pZ3JhdGlvblZlcnNpb24pXG4gICAgfSBmaW5hbGx5IHtcbiAgICAgIGF3YWl0IGRiLnJlbGVhc2VBZHZpc29yeUxvY2sobWlncmF0aW9uS2V5KVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBSZXdyaXRlcyBwcmUtZXhpc3RpbmcgcG9vbGVkIHJvd3MgKHBlcnNpc3RlZCBhcyBgZXhlY3V0aW9uX21vZGUgPSBcImZvcmtlZFwiYFxuICAgKiBwbHVzIGEgYHZlbG9jaW91cy1wb29sZWQ6KmAgaGFuZG9mZiBtYXJrZXIpIHRvIGBleGVjdXRpb25fbW9kZSA9IFwicG9vbGVkXCJgLFxuICAgKiBjbGVhcnMgdGhlIHF1ZXVlZCBtYXJrZXIsIHRoZW4gZHJvcHMgdGhlIG5vdy1yZWR1bmRhbnQgYGZvcmtlZGAgY29sdW1uIHNvXG4gICAqIGBleGVjdXRpb25fbW9kZWAgaXMgdGhlIHNpbmdsZSBzb3VyY2Ugb2YgdHJ1dGguIFJ1bnMgb25jZSwgZ3VhcmRlZCBieSB0aGVcbiAgICogbWlncmF0aW9uIGxlZGdlciBhbmQgYSBwZXIta2V5IGFkdmlzb3J5IGxvY2s7IGEgZnJlc2ggdGFibGUgKGNyZWF0ZWQgd2l0aG91dFxuICAgKiB0aGUgY29sdW1uKSBzaG9ydC1jaXJjdWl0cy5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9kYXRhYmFzZS9kcml2ZXJzL2Jhc2UuanNcIikuZGVmYXVsdH0gZGIgLSBEYXRhYmFzZSBjb25uZWN0aW9uLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyB3aGVuIGNvbXBsZXRlLlxuICAgKi9cbiAgYXN5bmMgX2Ryb3BGb3JrZWRDb2x1bW5PbmNlKGRiKSB7XG4gICAgY29uc3QgbWlncmF0aW9uVmVyc2lvbiA9IERST1BfRk9SS0VEX0NPTFVNTl9NSUdSQVRJT05fVkVSU0lPTlxuICAgIGNvbnN0IG1pZ3JhdGlvbktleSA9IHRoaXMuX21pZ3JhdGlvbktleShtaWdyYXRpb25WZXJzaW9uKVxuXG4gICAgaWYgKGF3YWl0IHRoaXMuX2hhc01pZ3JhdGlvbihkYiwgbWlncmF0aW9uVmVyc2lvbikpIHJldHVyblxuXG4gICAgYXdhaXQgZGIuYWNxdWlyZUFkdmlzb3J5TG9jayhtaWdyYXRpb25LZXkpXG5cbiAgICB0cnkge1xuICAgICAgaWYgKGF3YWl0IHRoaXMuX2hhc01pZ3JhdGlvbihkYiwgbWlncmF0aW9uVmVyc2lvbikpIHJldHVyblxuXG4gICAgICBkYi5jbGVhclNjaGVtYUNhY2hlKClcblxuICAgICAgaWYgKGF3YWl0IChhd2FpdCBkYi5nZXRUYWJsZUJ5TmFtZU9yRmFpbChKT0JTX1RBQkxFKSkuZ2V0Q29sdW1uQnlOYW1lKFwiZm9ya2VkXCIpKSB7XG4gICAgICAgIGNvbnN0IHRhYmxlTmFtZVNxbCA9IGRiLnF1b3RlVGFibGUoSk9CU19UQUJMRSlcbiAgICAgICAgY29uc3QgZXhlY3V0aW9uTW9kZUNvbHVtblNxbCA9IGRiLnF1b3RlQ29sdW1uKFwiZXhlY3V0aW9uX21vZGVcIilcbiAgICAgICAgY29uc3QgaGFuZG9mZklkQ29sdW1uU3FsID0gZGIucXVvdGVDb2x1bW4oXCJoYW5kb2ZmX2lkXCIpXG5cbiAgICAgICAgLy8gUG9vbGVkIHJvd3MgdXNlZCB0byBwZXJzaXN0IGFzIGV4ZWN1dGlvbl9tb2RlIFwiZm9ya2VkXCIgKyBhIHBvb2xlZCBoYW5kb2ZmXG4gICAgICAgIC8vIG1hcmtlcjsgcmVjb3ZlciB0aGVpciByZWFsIG1vZGUgYmVmb3JlIHRoZSBtYXJrZXIgaXMgY2xlYXJlZC5cbiAgICAgICAgYXdhaXQgZGIucXVlcnkoXG4gICAgICAgICAgYFVQREFURSAke3RhYmxlTmFtZVNxbH0gU0VUICR7ZXhlY3V0aW9uTW9kZUNvbHVtblNxbH0gPSAke2RiLnF1b3RlKFwicG9vbGVkXCIpfSBgICtcbiAgICAgICAgICBgV0hFUkUgJHtleGVjdXRpb25Nb2RlQ29sdW1uU3FsfSA9ICR7ZGIucXVvdGUoXCJmb3JrZWRcIil9IGAgK1xuICAgICAgICAgIGBBTkQgJHtoYW5kb2ZmSWRDb2x1bW5TcWx9IExJS0UgJHtkYi5xdW90ZShgJHtMRUdBQ1lfUE9PTEVEX0hBTkRPRkZfSURfUFJFRklYfSVgKX1gXG4gICAgICAgIClcbiAgICAgICAgLy8gVGhlIHF1ZXVlZC1wb29sZWQgbWFya2VyIHdhcyBhIHNlbnRpbmVsLCBub3QgYSByZWFsIGxlYXNlOyBjbGVhciBpdC5cbiAgICAgICAgYXdhaXQgZGIucXVlcnkoXG4gICAgICAgICAgYFVQREFURSAke3RhYmxlTmFtZVNxbH0gU0VUICR7aGFuZG9mZklkQ29sdW1uU3FsfSA9IE5VTEwgYCArXG4gICAgICAgICAgYFdIRVJFICR7aGFuZG9mZklkQ29sdW1uU3FsfSA9ICR7ZGIucXVvdGUoTEVHQUNZX1BPT0xFRF9RVUVVRURfSEFORE9GRl9JRCl9YFxuICAgICAgICApXG5cbiAgICAgICAgY29uc3QgZHJvcEZvcmtlZCA9IG5ldyBUYWJsZURhdGEoSk9CU19UQUJMRSlcbiAgICAgICAgZHJvcEZvcmtlZC5hZGRDb2x1bW4oXCJmb3JrZWRcIiwge2Ryb3BDb2x1bW46IHRydWV9KVxuICAgICAgICBmb3IgKGNvbnN0IHNxbCBvZiBhd2FpdCBkYi5hbHRlclRhYmxlU1FMcyhkcm9wRm9ya2VkKSkgYXdhaXQgZGIucXVlcnkoc3FsKVxuXG4gICAgICAgIGRiLmNsZWFyU2NoZW1hQ2FjaGUoKVxuICAgICAgfVxuXG4gICAgICBhd2FpdCB0aGlzLl9yZWNvcmRNaWdyYXRpb24oZGIsIG1pZ3JhdGlvblZlcnNpb24pXG4gICAgfSBmaW5hbGx5IHtcbiAgICAgIGF3YWl0IGRiLnJlbGVhc2VBZHZpc29yeUxvY2sobWlncmF0aW9uS2V5KVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHJlY29yZCBtaWdyYXRpb24uXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vZGF0YWJhc2UvZHJpdmVycy9iYXNlLmpzXCIpLmRlZmF1bHR9IGRiIC0gRGF0YWJhc2UgY29ubmVjdGlvbi5cbiAgICogQHBhcmFtIHtzdHJpbmd9IHZlcnNpb24gLSBNaWdyYXRpb24gdmVyc2lvbi5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgd2hlbiBjb21wbGV0ZS5cbiAgICovXG4gIGFzeW5jIF9yZWNvcmRNaWdyYXRpb24oZGIsIHZlcnNpb24pIHtcbiAgICBhd2FpdCBkYi51cHNlcnQoe1xuICAgICAgdGFibGVOYW1lOiBNSUdSQVRJT05TX1RBQkxFLFxuICAgICAgZGF0YToge1xuICAgICAgICBrZXk6IHRoaXMuX21pZ3JhdGlvbktleSh2ZXJzaW9uKSxcbiAgICAgICAgc2NvcGU6IE1JR1JBVElPTl9TQ09QRSxcbiAgICAgICAgdmVyc2lvbixcbiAgICAgICAgYXBwbGllZF9hdF9tczogRGF0ZS5ub3coKVxuICAgICAgfSxcbiAgICAgIGNvbmZsaWN0Q29sdW1uczogW1wia2V5XCJdLFxuICAgICAgdXBkYXRlQ29sdW1uczogW1wic2NvcGVcIiwgXCJ2ZXJzaW9uXCIsIFwiYXBwbGllZF9hdF9tc1wiXVxuICAgIH0pXG4gIH1cblxuICBhc3luYyBfaW5pdGlhbGl6ZU1vZGVsKCkge1xuICAgIGlmIChCYWNrZ3JvdW5kSm9iUmVjb3JkLmlzSW5pdGlhbGl6ZWQoKSkgcmV0dXJuXG5cbiAgICBCYWNrZ3JvdW5kSm9iUmVjb3JkLnNldERhdGFiYXNlSWRlbnRpZmllcih0aGlzLmdldERhdGFiYXNlSWRlbnRpZmllcigpKVxuICAgIGNvbnN0IHBvb2wgPSB0aGlzLmNvbmZpZ3VyYXRpb24uZ2V0RGF0YWJhc2VQb29sKHRoaXMuZ2V0RGF0YWJhc2VJZGVudGlmaWVyKCkpXG5cbiAgICBhd2FpdCBwb29sLndpdGhDb25uZWN0aW9uKHtuYW1lOiBcIkJhY2tncm91bmQgam9icyBzdG9yZSBpbml0aWFsaXplIG1vZGVsXCJ9LCBhc3luYyAoKSA9PiB7XG4gICAgICBhd2FpdCBCYWNrZ3JvdW5kSm9iUmVjb3JkLmluaXRpYWxpemVSZWNvcmQoe2NvbmZpZ3VyYXRpb246IHRoaXMuY29uZmlndXJhdGlvbn0pXG4gICAgfSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGdldCBqb2Igcm93IGJ5IGlkLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL2RhdGFiYXNlL2RyaXZlcnMvYmFzZS5qc1wiKS5kZWZhdWx0fSBkYiAtIERhdGFiYXNlIGNvbm5lY3Rpb24uXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBqb2JJZCAtIEpvYiBpZC5cbiAgICogQHJldHVybnMge1Byb21pc2U8aW1wb3J0KFwiLi90eXBlcy5qc1wiKS5CYWNrZ3JvdW5kSm9iUm93IHwgbnVsbD59IC0gSm9iIHJvdy5cbiAgICovXG4gIGFzeW5jIF9nZXRKb2JSb3dCeUlkKGRiLCBqb2JJZCkge1xuICAgIGNvbnN0IHF1ZXJ5ID0gZGJcbiAgICAgIC5uZXdRdWVyeSgpXG4gICAgICAuZnJvbShKT0JTX1RBQkxFKVxuICAgICAgLndoZXJlKHtpZDogam9iSWR9KVxuICAgICAgLmxpbWl0KDEpXG5cbiAgICBjb25zdCByb3dzID0gYXdhaXQgcXVlcnkucmVzdWx0cygpXG5cbiAgICBpZiAoIXJvd3NbMF0pIHJldHVybiBudWxsXG5cbiAgICByZXR1cm4gdGhpcy5fbm9ybWFsaXplSm9iUm93KHJvd3NbMF0pXG4gIH1cblxuICAvKipcbiAgICogUmVsZWFzZXMgb3duZXJzaGlwIG9ubHkgd2hlbiB0aGUga2V5IHN0aWxsIHBvaW50cyBhdCB0aGUgZXhwZWN0ZWQgam9iLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL2RhdGFiYXNlL2RyaXZlcnMvYmFzZS5qc1wiKS5kZWZhdWx0fSBkYiAtIERhdGFiYXNlIGNvbm5lY3Rpb24uXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gT3duZXJzaGlwIGlkZW50aXR5LlxuICAgKiBAcGFyYW0ge3N0cmluZ30gYXJncy5qb2JJZCAtIEV4cGVjdGVkIG93bmVyIGpvYiBpZC5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGFyZ3Muc2NoZWR1bGVLZXkgLSBTdGFibGUgc2NoZWR1bGUga2V5LlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyB3aGVuIGRlbGV0ZWQgb3IgYWxyZWFkeSBzdXBlcnNlZGVkLlxuICAgKi9cbiAgYXN5bmMgX3JlbGVhc2VTY2hlZHVsZU93bmVyc2hpcChkYiwge2pvYklkLCBzY2hlZHVsZUtleX0pIHtcbiAgICBhd2FpdCBkYi5kZWxldGUoe1xuICAgICAgdGFibGVOYW1lOiBTQ0hFRFVMRV9LRVlTX1RBQkxFLFxuICAgICAgY29uZGl0aW9uczoge2pvYl9pZDogam9iSWQsIHNjaGVkdWxlX2tleTogc2NoZWR1bGVLZXl9XG4gICAgfSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSZWxlYXNlcyBhIGpvYidzIG93bmVyc2hpcCB3aGVuIGl0IGhhcyBhIGhpc3RvcmljYWwgc2NoZWR1bGUga2V5LlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL2RhdGFiYXNlL2RyaXZlcnMvYmFzZS5qc1wiKS5kZWZhdWx0fSBkYiAtIERhdGFiYXNlIGNvbm5lY3Rpb24uXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi90eXBlcy5qc1wiKS5CYWNrZ3JvdW5kSm9iUm93fSBqb2IgLSBUZXJtaW5hbCBqb2IuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIHdoZW4gZGVsZXRlZCBvciBub3QgYXBwbGljYWJsZS5cbiAgICovXG4gIGFzeW5jIF9yZWxlYXNlU2NoZWR1bGVPd25lcnNoaXBGb3JKb2IoZGIsIGpvYikge1xuICAgIGlmICgham9iLnNjaGVkdWxlS2V5KSByZXR1cm5cblxuICAgIGF3YWl0IHRoaXMuX3JlbGVhc2VTY2hlZHVsZU93bmVyc2hpcChkYiwge2pvYklkOiBqb2IuaWQsIHNjaGVkdWxlS2V5OiBqb2Iuc2NoZWR1bGVLZXl9KVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgYXBwbHkgZmFpbHVyZS5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBPcHRpb25zLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL2RhdGFiYXNlL2RyaXZlcnMvYmFzZS5qc1wiKS5kZWZhdWx0fSBhcmdzLmRiIC0gRGF0YWJhc2UgY29ubmVjdGlvbi5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL3R5cGVzLmpzXCIpLkJhY2tncm91bmRKb2JSb3d9IGFyZ3Muam9iIC0gSm9iIHJvdy5cbiAgICogQHBhcmFtIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gYXJncy5lcnJvciAtIEVycm9yLlxuICAgKiBAcGFyYW0ge2Jvb2xlYW59IGFyZ3MubWFya09ycGhhbmVkIC0gV2hldGhlciBtYXJraW5nIG9ycGhhbmVkLlxuICAgKiBAcGFyYW0ge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gW2FyZ3MuY29uZGl0aW9uc10gLSBVcGRhdGUgZmVuY2luZyBjb25kaXRpb25zLiBEZWZhdWx0cyB0byB0aGUgYWN0aXZlLWhhbmRvZmYgbGVhc2UgbWF0Y2g7IHRoZSB0aW1lLWJhc2VkIG9ycGhhbiBzd2VlcCBvdmVycmlkZXMgdGhpcyB3aXRoIGFuIGlkL3N0YXR1cyBtYXRjaCBzbyBpdCBjYW4gcmVjbGFpbSByb3dzIHdob3NlIGBoYW5kb2ZmX2lkYCBpcyBudWxsIChlLmcuIGhhbmRlZCBvZmYgYnkgYW4gb2xkZXIgdmVsb2Npb3VzIGJlZm9yZSBoYW5kb2ZmLWlkIGZlbmNpbmcgZXhpc3RlZCkuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPGltcG9ydChcIi4vdHlwZXMuanNcIikuQmFja2dyb3VuZEpvYlJvdyB8IG51bGw+fSAtIFVwZGF0ZWQgam9iIHJvdyB3aGVuIHRoZSBsZWFzZSB0cmFuc2l0aW9uIHdvbi5cbiAgICovXG4gIGFzeW5jIF9hcHBseUZhaWx1cmUoe2RiLCBqb2IsIGVycm9yLCBtYXJrT3JwaGFuZWQsIGNvbmRpdGlvbnN9KSB7XG4gICAgY29uc3Qgbm93ID0gRGF0ZS5ub3coKVxuICAgIGNvbnN0IG5leHRBdHRlbXB0ID0gKGpvYi5hdHRlbXB0cyB8fCAwKSArIDFcbiAgICBjb25zdCBtYXhSZXRyaWVzID0gdGhpcy5fbm9ybWFsaXplTWF4UmV0cmllcyhqb2IubWF4UmV0cmllcylcbiAgICBjb25zdCBzaG91bGRSZXRyeSA9IG5leHRBdHRlbXB0IDw9IG1heFJldHJpZXNcbiAgICBjb25zdCBmYWlsdXJlTWVzc2FnZSA9IG5vcm1hbGl6ZUJhY2tncm91bmRKb2JFcnJvcihlcnJvcilcbiAgICBjb25zdCBzY2hlZHVsZWRBdCA9IHNob3VsZFJldHJ5ID8gbm93ICsgdGhpcy5nZXRSZXRyeURlbGF5TXMobmV4dEF0dGVtcHQpIDogam9iLnNjaGVkdWxlZEF0TXNcbiAgICBjb25zdCB1cGRhdGUgPSB0aGlzLl9mYWlsdXJlVXBkYXRlKHtcbiAgICAgIGZhaWx1cmVNZXNzYWdlLFxuICAgICAgbWFya09ycGhhbmVkLFxuICAgICAgbmV4dEF0dGVtcHQsXG4gICAgICBub3csXG4gICAgICBzY2hlZHVsZWRBdCxcbiAgICAgIHNob3VsZFJldHJ5XG4gICAgfSlcblxuICAgIGF3YWl0IHRoaXMuX2xvY2tDb25jdXJyZW5jeVJvdyhkYiwgam9iLmNvbmN1cnJlbmN5S2V5KVxuICAgIGNvbnN0IGFmZmVjdGVkUm93cyA9IGF3YWl0IHRoaXMuX3VwZGF0ZUFmZmVjdGVkUm93cyhkYiwge1xuICAgICAgdGFibGVOYW1lOiBKT0JTX1RBQkxFLFxuICAgICAgZGF0YTogdXBkYXRlLFxuICAgICAgY29uZGl0aW9uczogY29uZGl0aW9ucyA/PyB0aGlzLl9hY3RpdmVIYW5kb2ZmQ29uZGl0aW9ucyhqb2IpXG4gICAgfSlcblxuICAgIGlmIChhZmZlY3RlZFJvd3MgIT09IDEpIHJldHVybiBudWxsXG4gICAgaWYgKCFzaG91bGRSZXRyeSkgYXdhaXQgdGhpcy5fcmVsZWFzZVNjaGVkdWxlT3duZXJzaGlwRm9ySm9iKGRiLCBqb2IpXG4gICAgYXdhaXQgdGhpcy5fcmVsZWFzZUNvbmN1cnJlbmN5KGRiLCBqb2IuY29uY3VycmVuY3lLZXkpXG5cbiAgICAvLyBSZXR1cm4gYSBzbmFwc2hvdCBvZiB0aGUgdHJhbnNpdGlvbiB0aGlzIHVwZGF0ZSBqdXN0IGFwcGxpZWQgcmF0aGVyIHRoYW4gcmUtcmVhZGluZyB0aGUgcm93LlxuICAgIC8vIFdlIHdvbiB0aGUgY29uZGl0aW9uYWwgdXBkYXRlIChhZmZlY3RlZFJvd3MgPT09IDEpLCBzbyB0aGlzIHN0YXRlIGlzIGF1dGhvcml0YXRpdmU7IHJlLXJlYWRpbmdcbiAgICAvLyBjb3VsZCBpbnN0ZWFkIG9ic2VydmUgYSBuZXdlciBzdGF0ZSBpZiBhbm90aGVyIGRpc3BhdGNoZXIgcmVjbGFpbXMgYSByZXF1ZXVlZCBqb2IgYmV0d2VlbiB0aGVcbiAgICAvLyB1cGRhdGUgYW5kIHRoZSByZWFkIChvdmVybGFwcGluZyBtYWlucyAvIHBvbGxpbmcgZGlzcGF0Y2gpLCB3aGljaCB3b3VsZCBtaXNyZXBvcnQgdGhlXG4gICAgLy8gc3RhdHVzL3Rlcm1pbmFsL3dpbGxSZXRyeSBvZiB0aGlzIHRyYW5zaXRpb24gdG8gZmFpbHVyZS9vcnBoYW4gZXZlbnQgbGlzdGVuZXJzLlxuICAgIGNvbnN0IHN0YXR1cyA9IHNob3VsZFJldHJ5ID8gXCJxdWV1ZWRcIiA6IChtYXJrT3JwaGFuZWQgPyBcIm9ycGhhbmVkXCIgOiBcImZhaWxlZFwiKVxuICAgIC8qKiBAdHlwZSB7aW1wb3J0KFwiLi90eXBlcy5qc1wiKS5CYWNrZ3JvdW5kSm9iUm93fSAqL1xuICAgIGNvbnN0IHRyYW5zaXRpb25lZEpvYiA9IHtcbiAgICAgIC4uLmpvYixcbiAgICAgIGF0dGVtcHRzOiBuZXh0QXR0ZW1wdCxcbiAgICAgIGhhbmRlZE9mZkF0TXM6IG51bGwsXG4gICAgICBsYXN0RXJyb3I6IGZhaWx1cmVNZXNzYWdlLFxuICAgICAgc3RhdHVzLFxuICAgICAgd29ya2VySWQ6IG51bGxcbiAgICB9XG5cbiAgICBpZiAobWFya09ycGhhbmVkKSB0cmFuc2l0aW9uZWRKb2Iub3JwaGFuZWRBdE1zID0gbm93XG4gICAgaWYgKHNob3VsZFJldHJ5KSB7XG4gICAgICB0cmFuc2l0aW9uZWRKb2Iuc2NoZWR1bGVkQXRNcyA9IHNjaGVkdWxlZEF0XG4gICAgfSBlbHNlIGlmICghbWFya09ycGhhbmVkKSB7XG4gICAgICB0cmFuc2l0aW9uZWRKb2IuZmFpbGVkQXRNcyA9IG5vd1xuICAgIH1cblxuICAgIHJldHVybiB0cmFuc2l0aW9uZWRKb2JcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGZhaWx1cmUgdXBkYXRlLlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIE9wdGlvbnMuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBhcmdzLmZhaWx1cmVNZXNzYWdlIC0gTGFzdCBmYWlsdXJlIG1lc3NhZ2UuXG4gICAqIEBwYXJhbSB7Ym9vbGVhbn0gYXJncy5tYXJrT3JwaGFuZWQgLSBXaGV0aGVyIG1hcmtpbmcgb3JwaGFuZWQuXG4gICAqIEBwYXJhbSB7bnVtYmVyfSBhcmdzLm5leHRBdHRlbXB0IC0gTmV4dCBhdHRlbXB0IGNvdW50LlxuICAgKiBAcGFyYW0ge251bWJlcn0gYXJncy5ub3cgLSBDdXJyZW50IHRpbWVzdGFtcC5cbiAgICogQHBhcmFtIHtudW1iZXIgfCBudWxsfSBhcmdzLnNjaGVkdWxlZEF0IC0gTmV4dCBzY2hlZHVsZWQgdGltZXN0YW1wLlxuICAgKiBAcGFyYW0ge2Jvb2xlYW59IGFyZ3Muc2hvdWxkUmV0cnkgLSBXaGV0aGVyIHRoZSBqb2Igc2hvdWxkIHJldHJ5LlxuICAgKiBAcmV0dXJucyB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSAtIERhdGFiYXNlIHVwZGF0ZSBkYXRhLlxuICAgKi9cbiAgX2ZhaWx1cmVVcGRhdGUoe2ZhaWx1cmVNZXNzYWdlLCBtYXJrT3JwaGFuZWQsIG5leHRBdHRlbXB0LCBub3csIHNjaGVkdWxlZEF0LCBzaG91bGRSZXRyeX0pIHtcbiAgICAvKipcbiAgICAgKiBVcGRhdGUuXG4gICAgICogQHR5cGUge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gKi9cbiAgICBjb25zdCB1cGRhdGUgPSB7XG4gICAgICBhdHRlbXB0czogbmV4dEF0dGVtcHQsXG4gICAgICBoYW5kZWRfb2ZmX2F0X21zOiBudWxsLFxuICAgICAgd29ya2VyX2lkOiBudWxsLFxuICAgICAgbGFzdF9lcnJvcjogZmFpbHVyZU1lc3NhZ2VcbiAgICB9XG5cbiAgICB0aGlzLl9hcHBseU9ycGhhbmVkRmFpbHVyZVVwZGF0ZSh7bWFya09ycGhhbmVkLCBub3csIHVwZGF0ZX0pXG4gICAgdGhpcy5fYXBwbHlGYWlsdXJlU3RhdHVzVXBkYXRlKHttYXJrT3JwaGFuZWQsIG5vdywgc2NoZWR1bGVkQXQsIHNob3VsZFJldHJ5LCB1cGRhdGV9KVxuXG4gICAgcmV0dXJuIHVwZGF0ZVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgYXBwbHkgb3JwaGFuZWQgZmFpbHVyZSB1cGRhdGUuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gT3B0aW9ucy5cbiAgICogQHBhcmFtIHtib29sZWFufSBhcmdzLm1hcmtPcnBoYW5lZCAtIFdoZXRoZXIgbWFya2luZyBvcnBoYW5lZC5cbiAgICogQHBhcmFtIHtudW1iZXJ9IGFyZ3Mubm93IC0gQ3VycmVudCB0aW1lc3RhbXAuXG4gICAqIEBwYXJhbSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSBhcmdzLnVwZGF0ZSAtIERhdGFiYXNlIHVwZGF0ZSBkYXRhLlxuICAgKiBAcmV0dXJucyB7dm9pZH1cbiAgICovXG4gIF9hcHBseU9ycGhhbmVkRmFpbHVyZVVwZGF0ZSh7bWFya09ycGhhbmVkLCBub3csIHVwZGF0ZX0pIHtcbiAgICBpZiAobWFya09ycGhhbmVkKSB1cGRhdGUub3JwaGFuZWRfYXRfbXMgPSBub3dcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGFwcGx5IGZhaWx1cmUgc3RhdHVzIHVwZGF0ZS5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBPcHRpb25zLlxuICAgKiBAcGFyYW0ge2Jvb2xlYW59IGFyZ3MubWFya09ycGhhbmVkIC0gV2hldGhlciBtYXJraW5nIG9ycGhhbmVkLlxuICAgKiBAcGFyYW0ge251bWJlcn0gYXJncy5ub3cgLSBDdXJyZW50IHRpbWVzdGFtcC5cbiAgICogQHBhcmFtIHtudW1iZXIgfCBudWxsfSBhcmdzLnNjaGVkdWxlZEF0IC0gTmV4dCBzY2hlZHVsZWQgdGltZXN0YW1wLlxuICAgKiBAcGFyYW0ge2Jvb2xlYW59IGFyZ3Muc2hvdWxkUmV0cnkgLSBXaGV0aGVyIHRoZSBqb2Igc2hvdWxkIHJldHJ5LlxuICAgKiBAcGFyYW0ge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gYXJncy51cGRhdGUgLSBEYXRhYmFzZSB1cGRhdGUgZGF0YS5cbiAgICogQHJldHVybnMge3ZvaWR9XG4gICAqL1xuICBfYXBwbHlGYWlsdXJlU3RhdHVzVXBkYXRlKHttYXJrT3JwaGFuZWQsIG5vdywgc2NoZWR1bGVkQXQsIHNob3VsZFJldHJ5LCB1cGRhdGV9KSB7XG4gICAgaWYgKHNob3VsZFJldHJ5KSB7XG4gICAgICB1cGRhdGUuc3RhdHVzID0gXCJxdWV1ZWRcIlxuICAgICAgdXBkYXRlLnNjaGVkdWxlZF9hdF9tcyA9IHNjaGVkdWxlZEF0XG4gICAgICByZXR1cm5cbiAgICB9XG5cbiAgICBpZiAobWFya09ycGhhbmVkKSB7XG4gICAgICB1cGRhdGUuc3RhdHVzID0gXCJvcnBoYW5lZFwiXG4gICAgICByZXR1cm5cbiAgICB9XG5cbiAgICB1cGRhdGUuc3RhdHVzID0gXCJmYWlsZWRcIlxuICAgIHVwZGF0ZS5mYWlsZWRfYXRfbXMgPSBub3dcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIG5vcm1hbGl6ZSBqb2Igcm93LlxuICAgKiBAcGFyYW0ge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gcm93IC0gUmF3IGRhdGFiYXNlIHJvdy5cbiAgICogQHJldHVybnMge2ltcG9ydChcIi4vdHlwZXMuanNcIikuQmFja2dyb3VuZEpvYlJvd30gLSBOb3JtYWxpemVkIGpvYiByb3cuXG4gICAqL1xuICBfbm9ybWFsaXplSm9iUm93KHJvdykge1xuICAgIGNvbnN0IGhhbmRvZmZJZCA9IHJvdy5oYW5kb2ZmX2lkID8gU3RyaW5nKHJvdy5oYW5kb2ZmX2lkKSA6IG51bGxcbiAgICAvLyBgZXhlY3V0aW9uX21vZGVgIGlzIHRoZSBzaW5nbGUgc291cmNlIG9mIHRydXRoIGZvciBhIGpvYidzIHJ1bnRpbWUgYW5kIGlzXG4gICAgLy8gd3JpdHRlbiBvbiBldmVyeSBlbnF1ZXVlOyB0aGUgZHJvcC1mb3JrZWQgbWlncmF0aW9uIGJhY2tmaWxscyBhbnkgcHJlLWV4aXN0aW5nXG4gICAgLy8gcm93cyBiZWZvcmUgdGhlIGxlZ2FjeSBgZm9ya2VkYCBjb2x1bW4gaXMgcmVtb3ZlZC5cbiAgICBjb25zdCBleGVjdXRpb25Nb2RlID0gcm93LmV4ZWN1dGlvbl9tb2RlID8gdGhpcy5fbm9ybWFsaXplRXhlY3V0aW9uTW9kZU5hbWUoU3RyaW5nKHJvdy5leGVjdXRpb25fbW9kZSkpIDogREVGQVVMVF9CQUNLR1JPVU5EX0pPQl9FWEVDVVRJT05fTU9ERVxuXG4gICAgcmV0dXJuIHtcbiAgICAgIGlkOiBTdHJpbmcocm93LmlkKSxcbiAgICAgIGpvYk5hbWU6IFN0cmluZyhyb3cuam9iX25hbWUpLFxuICAgICAgYXJnczogdGhpcy5fcGFyc2VBcmdzKHJvdy5hcmdzX2pzb24pLFxuICAgICAgZXhlY3V0aW9uTW9kZSxcbiAgICAgIHF1ZXVlOiByb3cucXVldWUgPyBTdHJpbmcocm93LnF1ZXVlKSA6IERFRkFVTFRfQkFDS0dST1VORF9KT0JfUVVFVUUsXG4gICAgICBzY2hlZHVsZUtleTogcm93LnNjaGVkdWxlX2tleSA/IFN0cmluZyhyb3cuc2NoZWR1bGVfa2V5KSA6IG51bGwsXG4gICAgICBzdGF0dXM6IHJvdy5zdGF0dXMgPyBTdHJpbmcocm93LnN0YXR1cykgOiBcInF1ZXVlZFwiLFxuICAgICAgYXR0ZW1wdHM6IHRoaXMuX25vcm1hbGl6ZU51bWJlcihyb3cuYXR0ZW1wdHMpLFxuICAgICAgbWF4UmV0cmllczogdGhpcy5fbm9ybWFsaXplTnVtYmVyKHJvdy5tYXhfcmV0cmllcyksXG4gICAgICBzY2hlZHVsZWRBdE1zOiB0aGlzLl9ub3JtYWxpemVOdW1iZXIocm93LnNjaGVkdWxlZF9hdF9tcyksXG4gICAgICBjcmVhdGVkQXRNczogdGhpcy5fbm9ybWFsaXplTnVtYmVyKHJvdy5jcmVhdGVkX2F0X21zKSxcbiAgICAgIGhhbmRlZE9mZkF0TXM6IHRoaXMuX25vcm1hbGl6ZU51bWJlcihyb3cuaGFuZGVkX29mZl9hdF9tcyksXG4gICAgICBoYW5kb2ZmSWQsXG4gICAgICBjb21wbGV0ZWRBdE1zOiB0aGlzLl9ub3JtYWxpemVOdW1iZXIocm93LmNvbXBsZXRlZF9hdF9tcyksXG4gICAgICBmYWlsZWRBdE1zOiB0aGlzLl9ub3JtYWxpemVOdW1iZXIocm93LmZhaWxlZF9hdF9tcyksXG4gICAgICBvcnBoYW5lZEF0TXM6IHRoaXMuX25vcm1hbGl6ZU51bWJlcihyb3cub3JwaGFuZWRfYXRfbXMpLFxuICAgICAgd29ya2VySWQ6IHJvdy53b3JrZXJfaWQgPyBTdHJpbmcocm93Lndvcmtlcl9pZCkgOiBudWxsLFxuICAgICAgbGFzdEVycm9yOiByb3cubGFzdF9lcnJvciA/IFN0cmluZyhyb3cubGFzdF9lcnJvcikgOiBudWxsLFxuICAgICAgY29uY3VycmVuY3lLZXk6IHJvdy5jb25jdXJyZW5jeV9rZXkgPyBTdHJpbmcocm93LmNvbmN1cnJlbmN5X2tleSkgOiBudWxsLFxuICAgICAgbWF4Q29uY3VycmVuY3k6IHRoaXMuX25vcm1hbGl6ZU51bWJlcihyb3cubWF4X2NvbmN1cnJlbmN5KSxcbiAgICAgIHRpbWVvdXRNczogdGhpcy5fbm9ybWFsaXplTnVtYmVyKHJvdy50aW1lb3V0X21zKVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBOb3JtYWxpemVzIGEgam9iJ3MgcXVldWUgbmFtZSwgZGVmYXVsdGluZyB0byBcImRlZmF1bHRcIi5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL3R5cGVzLmpzXCIpLkJhY2tncm91bmRKb2JPcHRpb25zIHwgdW5kZWZpbmVkfSBvcHRpb25zIC0gSm9iIG9wdGlvbnMuXG4gICAqIEByZXR1cm5zIHtzdHJpbmd9IC0gUXVldWUgbmFtZS5cbiAgICovXG4gIF9ub3JtYWxpemVRdWV1ZShvcHRpb25zKSB7XG4gICAgcmV0dXJuIG5vcm1hbGl6ZUJhY2tncm91bmRKb2JRdWV1ZShvcHRpb25zKVxuICB9XG5cbiAgLyoqXG4gICAqIFJlc29sdmVzIGEgam9iJ3MgZHVyYWJsZSBjb25jdXJyZW5jeS4gQW4gZXhwbGljaXQgY29uY3VycmVuY3lLZXkvbWF4Q29uY3VycmVuY3lcbiAgICogcGFpciBhbHdheXMgd2lucy4gT3RoZXJ3aXNlLCB3aGVuIHRoZSBqb2IncyBxdWV1ZSBoYXMgYSBjb25maWd1cmVkIGNhcFxuICAgKiAoYGJhY2tncm91bmRKb2JzLnF1ZXVlc1txdWV1ZV0ubWF4Q29uY3VycmVudGApLCBkZXJpdmUgYSBxdWV1ZS1zY29wZWRcbiAgICogY29uY3VycmVuY3kga2V5IHNvIHRoZSBxdWV1ZSBjYXAgaXMgZW5mb3JjZWQgY2x1c3Rlci13aWRlIHRocm91Z2ggdGhlXG4gICAqIGV4aXN0aW5nIGR1cmFibGUgY29uY3VycmVuY3kgbWVjaGFuaXNtLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vdHlwZXMuanNcIikuQmFja2dyb3VuZEpvYk9wdGlvbnMgfCB1bmRlZmluZWR9IG9wdGlvbnMgLSBKb2Igb3B0aW9ucy5cbiAgICogQHBhcmFtIHtzdHJpbmd9IHF1ZXVlIC0gTm9ybWFsaXplZCBxdWV1ZSBuYW1lLlxuICAgKiBAcmV0dXJucyB7e2NvbmN1cnJlbmN5S2V5OiBzdHJpbmcsIG1heENvbmN1cnJlbmN5OiBudW1iZXIsIHF1ZXVlRGVyaXZlZDogYm9vbGVhbn0gfCBudWxsfSAtIFJlc29sdmVkIGNvbmN1cnJlbmN5LlxuICAgKi9cbiAgX3Jlc29sdmVDb25jdXJyZW5jeShvcHRpb25zLCBxdWV1ZSkge1xuICAgIHJldHVybiBub3JtYWxpemVCYWNrZ3JvdW5kSm9iQ29uY3VycmVuY3koe1xuICAgICAgb3B0aW9uczogb3B0aW9ucyB8fCB7fSxcbiAgICAgIHF1ZXVlLFxuICAgICAgcXVldWVzOiB0aGlzLmNvbmZpZ3VyYXRpb24uZ2V0QmFja2dyb3VuZEpvYnNDb25maWcoKS5xdWV1ZXNcbiAgICB9KVxuICB9XG5cbiAgLyoqXG4gICAqIFJlYWRzIHRoZSBjb25maWd1cmVkIG1heCBjb25jdXJyZW5jeSBmb3IgYSBxdWV1ZSBmcm9tIHRoZSBiYWNrZ3JvdW5kLWpvYnMgY29uZmlnLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gcXVldWUgLSBRdWV1ZSBuYW1lLlxuICAgKiBAcmV0dXJucyB7bnVtYmVyIHwgbnVsbH0gLSBQb3NpdGl2ZSBpbnRlZ2VyIGNhcCwgb3IgbnVsbCB3aGVuIHRoZSBxdWV1ZSBoYXMgbm8gY29uZmlndXJlZCBjYXAuXG4gICAqL1xuICBfcXVldWVNYXhDb25jdXJyZW5jeShxdWV1ZSkge1xuICAgIGNvbnN0IHF1ZXVlcyA9IHRoaXMuY29uZmlndXJhdGlvbi5nZXRCYWNrZ3JvdW5kSm9ic0NvbmZpZygpLnF1ZXVlc1xuICAgIGNvbnN0IGNhcCA9IHF1ZXVlcz8uW3F1ZXVlXT8ubWF4Q29uY3VycmVudFxuXG4gICAgaWYgKE51bWJlci5pc0ludGVnZXIoY2FwKSAmJiBOdW1iZXIoY2FwKSA+IDApIHJldHVybiBOdW1iZXIoY2FwKVxuXG4gICAgcmV0dXJuIG51bGxcbiAgfVxuXG4gIC8qKlxuICAgKiBMaWtlIHtAbGluayBfZW5zdXJlQ29uY3VycmVuY3lLZXl9LCBidXQgZm9yIHF1ZXVlLWRlcml2ZWQga2V5cyB0aGUgY29uZmlndXJlZFxuICAgKiBxdWV1ZSBjYXAgaXMgdGhlIHNvdXJjZSBvZiB0cnV0aDogaWYgaXQgY2hhbmdlZCwgdXBkYXRlIHRoZSBzdG9yZWQgY2FwXG4gICAqIGluc3RlYWQgb2YgdGhyb3dpbmcgb24gY29uZmxpY3QgKGNvbmZpZy1kcml2ZW4gY2FwcyBtdXN0IGJlIHR1bmFibGUpLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL2RhdGFiYXNlL2RyaXZlcnMvYmFzZS5qc1wiKS5kZWZhdWx0fSBkYiAtIERhdGFiYXNlIGNvbm5lY3Rpb24uXG4gICAqIEBwYXJhbSB7e2NvbmN1cnJlbmN5S2V5OiBzdHJpbmcsIG1heENvbmN1cnJlbmN5OiBudW1iZXJ9fSBjb25jdXJyZW5jeSAtIENvbmN1cnJlbmN5IGNvbmZpZ3VyYXRpb24uXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIHdoZW4gZW5zdXJlZC5cbiAgICovXG4gIGFzeW5jIF9lbnN1cmVRdWV1ZUNvbmN1cnJlbmN5S2V5KGRiLCB7Y29uY3VycmVuY3lLZXksIG1heENvbmN1cnJlbmN5fSkge1xuICAgIGNvbnN0IHJvd3MgPSBhd2FpdCBkYi5uZXdRdWVyeSgpLmZyb20oQ09OQ1VSUkVOQ1lfVEFCTEUpLndoZXJlKHtjb25jdXJyZW5jeV9rZXk6IGNvbmN1cnJlbmN5S2V5fSkubGltaXQoMSkucmVzdWx0cygpXG5cbiAgICBpZiAoIXJvd3NbMF0pIHtcbiAgICAgIHRyeSB7XG4gICAgICAgIGF3YWl0IGRiLmluc2VydCh7dGFibGVOYW1lOiBDT05DVVJSRU5DWV9UQUJMRSwgZGF0YToge2FjdGl2ZV9jb3VudDogMCwgY29uY3VycmVuY3lfa2V5OiBjb25jdXJyZW5jeUtleSwgbWF4X2NvbmN1cnJlbmN5OiBtYXhDb25jdXJyZW5jeX19KVxuXG4gICAgICAgIHJldHVyblxuICAgICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgICAgY29uc3QgcmFjZWRSb3dzID0gYXdhaXQgZGIubmV3UXVlcnkoKS5mcm9tKENPTkNVUlJFTkNZX1RBQkxFKS53aGVyZSh7Y29uY3VycmVuY3lfa2V5OiBjb25jdXJyZW5jeUtleX0pLmxpbWl0KDEpLnJlc3VsdHMoKVxuXG4gICAgICAgIGlmICghcmFjZWRSb3dzWzBdKSB0aHJvdyBlcnJvclxuXG4gICAgICAgIHJvd3NbMF0gPSByYWNlZFJvd3NbMF1cbiAgICAgIH1cbiAgICB9XG5cbiAgICBjb25zdCBjb25maWd1cmVkID0gLyoqIEB0eXBlIHt7bWF4X2NvbmN1cnJlbmN5PzogbnVtYmVyIHwgc3RyaW5nfX0gKi8gKHJvd3NbMF0pXG5cbiAgICBpZiAodGhpcy5fbm9ybWFsaXplTnVtYmVyKGNvbmZpZ3VyZWQubWF4X2NvbmN1cnJlbmN5KSAhPT0gbWF4Q29uY3VycmVuY3kpIHtcbiAgICAgIGNvbnN0IHRhYmxlID0gZGIucXVvdGVUYWJsZShDT05DVVJSRU5DWV9UQUJMRSlcblxuICAgICAgYXdhaXQgZGIucXVlcnkoYFVQREFURSAke3RhYmxlfSBTRVQgJHtkYi5xdW90ZUNvbHVtbihcIm1heF9jb25jdXJyZW5jeVwiKX0gPSAke051bWJlcihtYXhDb25jdXJyZW5jeSl9IFdIRVJFICR7ZGIucXVvdGVDb2x1bW4oXCJjb25jdXJyZW5jeV9rZXlcIil9ID0gJHtkYi5xdW90ZShjb25jdXJyZW5jeUtleSl9YClcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogRW5zdXJlcyB0aGUgY29uY3VycmVuY3kgc3RhdGUgdGFibGUgZXhpc3RzLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL2RhdGFiYXNlL2RyaXZlcnMvYmFzZS5qc1wiKS5kZWZhdWx0fSBkYiAtIERhdGFiYXNlIGNvbm5lY3Rpb24uXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIHdoZW4gcmVhZHkuXG4gICAqL1xuICBhc3luYyBfZW5zdXJlQ29uY3VycmVuY3lUYWJsZShkYikge1xuICAgIGlmIChhd2FpdCBkYi50YWJsZUV4aXN0cyhDT05DVVJSRU5DWV9UQUJMRSkpIHJldHVyblxuICAgIGNvbnN0IHRhYmxlID0gbmV3IFRhYmxlRGF0YShDT05DVVJSRU5DWV9UQUJMRSwge2lmTm90RXhpc3RzOiB0cnVlfSlcbiAgICB0YWJsZS5zdHJpbmcoXCJjb25jdXJyZW5jeV9rZXlcIiwge3ByaW1hcnlLZXk6IHRydWV9KVxuICAgIHRhYmxlLmludGVnZXIoXCJtYXhfY29uY3VycmVuY3lcIiwge251bGw6IGZhbHNlfSlcbiAgICB0YWJsZS5pbnRlZ2VyKFwiYWN0aXZlX2NvdW50XCIsIHtudWxsOiBmYWxzZX0pXG4gICAgYXdhaXQgZGIuY3JlYXRlVGFibGUodGFibGUpXG4gIH1cblxuICAvKipcbiAgICogRW5zdXJlcyB0aGUgc3RhYmxlIHNjaGVkdWxlLWtleSBvd25lcnNoaXAgdGFibGUgZXhpc3RzLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL2RhdGFiYXNlL2RyaXZlcnMvYmFzZS5qc1wiKS5kZWZhdWx0fSBkYiAtIERhdGFiYXNlIGNvbm5lY3Rpb24uXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIHdoZW4gcmVhZHkuXG4gICAqL1xuICBhc3luYyBfZW5zdXJlU2NoZWR1bGVLZXlzVGFibGUoZGIpIHtcbiAgICBpZiAoYXdhaXQgZGIudGFibGVFeGlzdHMoU0NIRURVTEVfS0VZU19UQUJMRSkpIHJldHVyblxuXG4gICAgY29uc3QgbG9ja05hbWUgPSBgJHtNSUdSQVRJT05fU0NPUEV9OnNjaGVkdWxlX2tleXNfdGFibGVgXG4gICAgY29uc3QgYWNxdWlyZWQgPSBhd2FpdCBkYi5hY3F1aXJlQWR2aXNvcnlMb2NrKGxvY2tOYW1lKVxuXG4gICAgaWYgKCFhY3F1aXJlZCkgdGhyb3cgbmV3IEVycm9yKFwiRmFpbGVkIHRvIGFjcXVpcmUgYmFja2dyb3VuZCBqb2JzIHNjaGVkdWxlLWtleSB0YWJsZSBzY2hlbWEgbG9ja1wiKVxuXG4gICAgdHJ5IHtcbiAgICAgIGRiLmNsZWFyU2NoZW1hQ2FjaGUoKVxuICAgICAgaWYgKGF3YWl0IGRiLnRhYmxlRXhpc3RzKFNDSEVEVUxFX0tFWVNfVEFCTEUpKSByZXR1cm5cblxuICAgICAgY29uc3QgdGFibGUgPSBuZXcgVGFibGVEYXRhKFNDSEVEVUxFX0tFWVNfVEFCTEUsIHtpZk5vdEV4aXN0czogdHJ1ZX0pXG5cbiAgICAgIHRhYmxlLnN0cmluZyhcInNjaGVkdWxlX2tleVwiLCB7cHJpbWFyeUtleTogdHJ1ZX0pXG4gICAgICB0YWJsZS5zdHJpbmcoXCJqb2JfaWRcIiwge251bGw6IGZhbHNlLCBpbmRleDogdHJ1ZX0pXG4gICAgICBhd2FpdCBkYi5jcmVhdGVUYWJsZSh0YWJsZSlcbiAgICAgIGRiLmNsZWFyU2NoZW1hQ2FjaGUoKVxuICAgIH0gZmluYWxseSB7XG4gICAgICBhd2FpdCBkYi5yZWxlYXNlQWR2aXNvcnlMb2NrKGxvY2tOYW1lKVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBFbnN1cmVzIGR1cmFibGUgZ2VuZXJpYyBlbnF1ZXVlIG93bmVyc2hpcCBleGlzdHMgaW5kZXBlbmRlbnRseSBvZiBqb2Igcm93cy5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9kYXRhYmFzZS9kcml2ZXJzL2Jhc2UuanNcIikuZGVmYXVsdH0gZGIgLSBEYXRhYmFzZSBjb25uZWN0aW9uLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyB3aGVuIHJlYWR5LlxuICAgKi9cbiAgYXN5bmMgX2Vuc3VyZUlkZW1wb3RlbmN5S2V5c1RhYmxlKGRiKSB7XG4gICAgaWYgKGF3YWl0IGRiLnRhYmxlRXhpc3RzKElERU1QT1RFTkNZX0tFWVNfVEFCTEUpKSByZXR1cm5cblxuICAgIGNvbnN0IGxvY2tOYW1lID0gYCR7TUlHUkFUSU9OX1NDT1BFfTppZGVtcG90ZW5jeV9rZXlzX3RhYmxlYFxuICAgIGNvbnN0IGFjcXVpcmVkID0gYXdhaXQgZGIuYWNxdWlyZUFkdmlzb3J5TG9jayhsb2NrTmFtZSlcblxuICAgIGlmICghYWNxdWlyZWQpIHRocm93IG5ldyBFcnJvcihcIkZhaWxlZCB0byBhY3F1aXJlIGJhY2tncm91bmQgam9iIGlkZW1wb3RlbmN5LWtleSB0YWJsZSBzY2hlbWEgbG9ja1wiKVxuXG4gICAgdHJ5IHtcbiAgICAgIGRiLmNsZWFyU2NoZW1hQ2FjaGUoKVxuICAgICAgaWYgKGF3YWl0IGRiLnRhYmxlRXhpc3RzKElERU1QT1RFTkNZX0tFWVNfVEFCTEUpKSByZXR1cm5cblxuICAgICAgY29uc3QgdGFibGUgPSBuZXcgVGFibGVEYXRhKElERU1QT1RFTkNZX0tFWVNfVEFCTEUsIHtpZk5vdEV4aXN0czogdHJ1ZX0pXG5cbiAgICAgIHRhYmxlLnN0cmluZyhcInNjb3BlX2RpZ2VzdFwiLCB7cHJpbWFyeUtleTogdHJ1ZX0pXG4gICAgICB0YWJsZS5zdHJpbmcoXCJqb2JfbmFtZVwiLCB7bnVsbDogZmFsc2V9KVxuICAgICAgdGFibGUuc3RyaW5nKFwicXVldWVcIiwge251bGw6IGZhbHNlfSlcbiAgICAgIHRhYmxlLnRleHQoXCJpZGVtcG90ZW5jeV9rZXlcIiwge251bGw6IGZhbHNlfSlcbiAgICAgIHRhYmxlLnN0cmluZyhcImpvYl9pZFwiLCB7aW5kZXg6IHRydWUsIG51bGw6IGZhbHNlfSlcbiAgICAgIHRhYmxlLnN0cmluZyhcInJlcXVlc3RfZGlnZXN0XCIsIHtudWxsOiBmYWxzZX0pXG4gICAgICB0YWJsZS5iaWdpbnQoXCJjcmVhdGVkX2F0X21zXCIsIHtudWxsOiBmYWxzZX0pXG4gICAgICBhd2FpdCBkYi5jcmVhdGVUYWJsZSh0YWJsZSlcbiAgICAgIGRiLmNsZWFyU2NoZW1hQ2FjaGUoKVxuICAgIH0gZmluYWxseSB7XG4gICAgICBhd2FpdCBkYi5yZWxlYXNlQWR2aXNvcnlMb2NrKGxvY2tOYW1lKVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBFbnN1cmVzIGR1cmFibGUgcHJvdmlkZXItYmFja2VkIG1haWwgb3BlcmF0aW9uIHN0YXRlIGV4aXN0cyBpbmRlcGVuZGVudGx5IG9mIGpvYnMuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vZGF0YWJhc2UvZHJpdmVycy9iYXNlLmpzXCIpLmRlZmF1bHR9IGRiIC0gRGF0YWJhc2UgY29ubmVjdGlvbi5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgd2hlbiByZWFkeS5cbiAgICovXG4gIGFzeW5jIF9lbnN1cmVNYWlsRGVsaXZlcnlPcGVyYXRpb25zVGFibGUoZGIpIHtcbiAgICBpZiAoYXdhaXQgZGIudGFibGVFeGlzdHMoTUFJTF9ERUxJVkVSWV9PUEVSQVRJT05TX1RBQkxFKSkgcmV0dXJuXG5cbiAgICBjb25zdCBsb2NrTmFtZSA9IGAke01JR1JBVElPTl9TQ09QRX06bWFpbF9kZWxpdmVyeV9vcGVyYXRpb25zX3RhYmxlYFxuICAgIGNvbnN0IGFjcXVpcmVkID0gYXdhaXQgZGIuYWNxdWlyZUFkdmlzb3J5TG9jayhsb2NrTmFtZSlcblxuICAgIGlmICghYWNxdWlyZWQpIHRocm93IG5ldyBFcnJvcihcIkZhaWxlZCB0byBhY3F1aXJlIG1haWwgZGVsaXZlcnkgb3BlcmF0aW9uIHRhYmxlIHNjaGVtYSBsb2NrXCIpXG5cbiAgICB0cnkge1xuICAgICAgZGIuY2xlYXJTY2hlbWFDYWNoZSgpXG4gICAgICBpZiAoYXdhaXQgZGIudGFibGVFeGlzdHMoTUFJTF9ERUxJVkVSWV9PUEVSQVRJT05TX1RBQkxFKSkgcmV0dXJuXG5cbiAgICAgIGNvbnN0IHRhYmxlID0gbmV3IFRhYmxlRGF0YShNQUlMX0RFTElWRVJZX09QRVJBVElPTlNfVEFCTEUsIHtpZk5vdEV4aXN0czogdHJ1ZX0pXG5cbiAgICAgIHRhYmxlLnN0cmluZyhcIm9wZXJhdGlvbl9rZXlcIiwge3ByaW1hcnlLZXk6IHRydWV9KVxuICAgICAgdGFibGUudGV4dChcIm9wZXJhdGlvbl9pZFwiLCB7bnVsbDogZmFsc2V9KVxuICAgICAgdGFibGUuc3RyaW5nKFwicGF5bG9hZF9kaWdlc3RcIiwge251bGw6IGZhbHNlfSlcbiAgICAgIHRhYmxlLnN0cmluZyhcImJhY2tncm91bmRfam9iX2lkXCIsIHtpbmRleDogdHJ1ZSwgbnVsbDogZmFsc2V9KVxuICAgICAgdGFibGUuYmlnaW50KFwiZmlyc3RfYXR0ZW1wdF9zdGFydGVkX2F0X21zXCIsIHtudWxsOiB0cnVlfSlcbiAgICAgIHRhYmxlLnN0cmluZyhcInByb3ZpZGVyX2tpbmRcIiwge251bGw6IGZhbHNlfSlcbiAgICAgIHRhYmxlLmJpZ2ludChcInByb3ZpZGVyX3JldGVudGlvbl9tc1wiLCB7bnVsbDogZmFsc2V9KVxuICAgICAgdGFibGUuYmlnaW50KFwiY3JlYXRlZF9hdF9tc1wiLCB7bnVsbDogZmFsc2V9KVxuICAgICAgYXdhaXQgZGIuY3JlYXRlVGFibGUodGFibGUpXG4gICAgICBkYi5jbGVhclNjaGVtYUNhY2hlKClcbiAgICB9IGZpbmFsbHkge1xuICAgICAgYXdhaXQgZGIucmVsZWFzZUFkdmlzb3J5TG9jayhsb2NrTmFtZSlcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogRW5zdXJlcyB0aGUgc2luZ2xldG9uIGR1cmFibGUgY291bnQtcmV2aXNpb24gcm93IGV4aXN0cy5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9kYXRhYmFzZS9kcml2ZXJzL2Jhc2UuanNcIikuZGVmYXVsdH0gZGIgLSBEYXRhYmFzZSBjb25uZWN0aW9uLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gUmVzb2x2ZXMgd2hlbiByZWFkeS5cbiAgICovXG4gIGFzeW5jIF9lbnN1cmVDb3VudFJldmlzaW9uVGFibGUoZGIpIHtcbiAgICBpZiAoIShhd2FpdCBkYi50YWJsZUV4aXN0cyhDT1VOVFNfUkVWSVNJT05fVEFCTEUpKSkge1xuICAgICAgY29uc3QgdGFibGUgPSBuZXcgVGFibGVEYXRhKENPVU5UU19SRVZJU0lPTl9UQUJMRSwge2lmTm90RXhpc3RzOiB0cnVlfSlcblxuICAgICAgdGFibGUuc3RyaW5nKFwia2V5XCIsIHtwcmltYXJ5S2V5OiB0cnVlfSlcbiAgICAgIHRhYmxlLmJpZ2ludChcInJldmlzaW9uXCIsIHtudWxsOiBmYWxzZX0pXG4gICAgICBhd2FpdCBkYi5jcmVhdGVUYWJsZSh0YWJsZSlcbiAgICB9XG5cbiAgICBjb25zdCByb3dzID0gYXdhaXQgZGIubmV3UXVlcnkoKS5mcm9tKENPVU5UU19SRVZJU0lPTl9UQUJMRSkud2hlcmUoe2tleTogQ09VTlRTX1JFVklTSU9OX0tFWX0pLmxpbWl0KDEpLnJlc3VsdHMoKVxuXG4gICAgaWYgKHJvd3MubGVuZ3RoID4gMCkgcmV0dXJuXG5cbiAgICB0cnkge1xuICAgICAgYXdhaXQgZGIuaW5zZXJ0KHt0YWJsZU5hbWU6IENPVU5UU19SRVZJU0lPTl9UQUJMRSwgZGF0YToge2tleTogQ09VTlRTX1JFVklTSU9OX0tFWSwgcmV2aXNpb246IDB9fSlcbiAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgY29uc3QgcmFjZWRSb3dzID0gYXdhaXQgZGIubmV3UXVlcnkoKS5mcm9tKENPVU5UU19SRVZJU0lPTl9UQUJMRSkud2hlcmUoe2tleTogQ09VTlRTX1JFVklTSU9OX0tFWX0pLmxpbWl0KDEpLnJlc3VsdHMoKVxuXG4gICAgICBpZiAocmFjZWRSb3dzLmxlbmd0aCA9PT0gMCkgdGhyb3cgZXJyb3JcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogUmVjb3JkcyBvbmUgbG9naWNhbCBjb3VudCBtdXRhdGlvbiBhdG9taWNhbGx5IGFuZCBicm9hZGNhc3RzIGl0IGFmdGVyIGNvbW1pdC5cbiAgICogWmVybyBlbnRyaWVzIGFyZSBvbWl0dGVkOyBhIHdob2xseSB6ZXJvLW5ldCBtdXRhdGlvbiBkb2VzIG5vdCBjb25zdW1lIGEgcmV2aXNpb24uXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vZGF0YWJhc2UvZHJpdmVycy9iYXNlLmpzXCIpLmRlZmF1bHR9IGRiIC0gVHJhbnNhY3Rpb24gY29ubmVjdGlvbi5cbiAgICogQHBhcmFtIHtSZWNvcmQ8c3RyaW5nLCBudW1iZXI+fSByZXF1ZXN0ZWREZWx0YXMgLSBTaWduZWQgYnVja2V0IGNoYW5nZXMuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSBSZXNvbHZlcyB3aGVuIHJlY29yZGVkLlxuICAgKi9cbiAgYXN5bmMgX3JlY29yZENvdW50RGVsdGEoZGIsIHJlcXVlc3RlZERlbHRhcykge1xuICAgIC8qKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgbnVtYmVyPn0gKi9cbiAgICBjb25zdCBkZWx0YXMgPSB7fVxuXG4gICAgZm9yIChjb25zdCBidWNrZXQgb2YgQkFDS0dST1VORF9KT0JfQ09VTlRfQlVDS0VUUykge1xuICAgICAgY29uc3QgYW1vdW50ID0gcmVxdWVzdGVkRGVsdGFzW2J1Y2tldF0gfHwgMFxuXG4gICAgICBpZiAoIU51bWJlci5pc0ludGVnZXIoYW1vdW50KSkgdGhyb3cgbmV3IEVycm9yKGBJbnZhbGlkIGJhY2tncm91bmQgam9iIGNvdW50IGRlbHRhIGZvciAke2J1Y2tldH06ICR7YW1vdW50fWApXG4gICAgICBpZiAoYW1vdW50ICE9PSAwKSBkZWx0YXNbYnVja2V0XSA9IGFtb3VudFxuICAgIH1cblxuICAgIGlmIChPYmplY3Qua2V5cyhkZWx0YXMpLmxlbmd0aCA9PT0gMCkgcmV0dXJuXG5cbiAgICBjb25zdCB0YWJsZSA9IGRiLnF1b3RlVGFibGUoQ09VTlRTX1JFVklTSU9OX1RBQkxFKVxuICAgIGNvbnN0IHJldmlzaW9uQ29sdW1uID0gZGIucXVvdGVDb2x1bW4oXCJyZXZpc2lvblwiKVxuICAgIGNvbnN0IGFmZmVjdGVkUm93cyA9IGF3YWl0IGRiLmFmZmVjdGVkUm93cyhcbiAgICAgIGBVUERBVEUgJHt0YWJsZX0gU0VUICR7cmV2aXNpb25Db2x1bW59ID0gJHtyZXZpc2lvbkNvbHVtbn0gKyAxIFdIRVJFICR7ZGIucXVvdGVDb2x1bW4oXCJrZXlcIil9ID0gJHtkYi5xdW90ZShDT1VOVFNfUkVWSVNJT05fS0VZKX1gXG4gICAgKVxuXG4gICAgaWYgKGFmZmVjdGVkUm93cyAhPT0gMSkgdGhyb3cgbmV3IEVycm9yKFwiQmFja2dyb3VuZCBqb2IgY291bnQgcmV2aXNpb24gcm93IGlzIG1pc3NpbmdcIilcblxuICAgIGNvbnN0IHJldmlzaW9uID0gYXdhaXQgdGhpcy5fY291bnRSZXZpc2lvbihkYilcbiAgICBjb25zdCBib2R5ID0ge2RlbHRhcywgcmV2aXNpb24sIHR5cGU6IFwiYmFja2dyb3VuZC1qb2ItY291bnQtZGVsdGFcIn1cbiAgICBjb25zdCBkYXRhYmFzZUlkZW50aWZpZXIgPSB0aGlzLmdldERhdGFiYXNlSWRlbnRpZmllcigpIHx8IFwiZGVmYXVsdFwiXG5cbiAgICBhd2FpdCBkYi5hZnRlckNvbW1pdCgoKSA9PiB7XG4gICAgICB0aGlzLmNvbmZpZ3VyYXRpb24uYnJvYWRjYXN0VG9DaGFubmVsKEJBQ0tHUk9VTkRfSk9CX0NPVU5UU19DSEFOTkVMLCB7ZGF0YWJhc2VJZGVudGlmaWVyfSwgYm9keSlcbiAgICB9KVxuICB9XG5cbiAgLyoqXG4gICAqIFJlY29yZHMgYSB0cmFuc2l0aW9uIGJldHdlZW4gcGVyc2lzdGVkIHN0YXR1c2VzLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL2RhdGFiYXNlL2RyaXZlcnMvYmFzZS5qc1wiKS5kZWZhdWx0fSBkYiAtIFRyYW5zYWN0aW9uIGNvbm5lY3Rpb24uXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBvbGRTdGF0dXMgLSBQcmV2aW91cyBzdGF0dXMuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBuZXdTdGF0dXMgLSBOZXcgc3RhdHVzLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gUmVzb2x2ZXMgd2hlbiByZWNvcmRlZC5cbiAgICovXG4gIGFzeW5jIF9yZWNvcmRTdGF0dXNUcmFuc2l0aW9uKGRiLCBvbGRTdGF0dXMsIG5ld1N0YXR1cykge1xuICAgIGNvbnN0IG9sZENvdW50ZWQgPSBDT1VOVEVEX0pPQl9TVEFUVVNFUy5pbmNsdWRlcyhvbGRTdGF0dXMpXG4gICAgY29uc3QgbmV3Q291bnRlZCA9IENPVU5URURfSk9CX1NUQVRVU0VTLmluY2x1ZGVzKG5ld1N0YXR1cylcblxuICAgIGlmICghb2xkQ291bnRlZCAmJiBvbGRTdGF0dXMgIT09IFwiY2FuY2VsbGVkXCIpIHRocm93IG5ldyBFcnJvcihgVW5rbm93biBwcmV2aW91cyBiYWNrZ3JvdW5kIGpvYiBzdGF0dXM6ICR7b2xkU3RhdHVzfWApXG4gICAgaWYgKCFuZXdDb3VudGVkICYmIG5ld1N0YXR1cyAhPT0gXCJjYW5jZWxsZWRcIikgdGhyb3cgbmV3IEVycm9yKGBVbmtub3duIG5leHQgYmFja2dyb3VuZCBqb2Igc3RhdHVzOiAke25ld1N0YXR1c31gKVxuICAgIGlmIChvbGRTdGF0dXMgPT09IG5ld1N0YXR1cykgcmV0dXJuXG5cbiAgICAvKiogQHR5cGUge1JlY29yZDxzdHJpbmcsIG51bWJlcj59ICovXG4gICAgY29uc3QgZGVsdGFzID0ge31cblxuICAgIGlmIChvbGRDb3VudGVkKSBkZWx0YXNbb2xkU3RhdHVzXSA9IC0xXG4gICAgaWYgKG5ld0NvdW50ZWQpIGRlbHRhc1tuZXdTdGF0dXNdID0gMVxuICAgIGlmIChvbGRDb3VudGVkICE9PSBuZXdDb3VudGVkKSBkZWx0YXMuYWxsID0gbmV3Q291bnRlZCA/IDEgOiAtMVxuICAgIGF3YWl0IHRoaXMuX3JlY29yZENvdW50RGVsdGEoZGIsIGRlbHRhcylcbiAgfVxuXG4gIC8qKlxuICAgKiBSZWFkcyB0aGUgbG9ja2VkIHJldmlzaW9uLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL2RhdGFiYXNlL2RyaXZlcnMvYmFzZS5qc1wiKS5kZWZhdWx0fSBkYiAtIERhdGFiYXNlIGNvbm5lY3Rpb24uXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPG51bWJlcj59IFJldmlzaW9uLlxuICAgKi9cbiAgYXN5bmMgX2NvdW50UmV2aXNpb24oZGIpIHtcbiAgICBjb25zdCByb3dzID0gYXdhaXQgZGIubmV3UXVlcnkoKS5mcm9tKENPVU5UU19SRVZJU0lPTl9UQUJMRSkuc2VsZWN0KFwicmV2aXNpb25cIikud2hlcmUoe2tleTogQ09VTlRTX1JFVklTSU9OX0tFWX0pLmxpbWl0KDEpLnJlc3VsdHMoKVxuICAgIGNvbnN0IHJldmlzaW9uID0gdGhpcy5fbm9ybWFsaXplTnVtYmVyKC8qKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSAqLyAocm93c1swXSB8fCB7fSkucmV2aXNpb24pXG5cbiAgICBpZiAocmV2aXNpb24gPT09IG51bGwgfHwgIU51bWJlci5pc1NhZmVJbnRlZ2VyKHJldmlzaW9uKSB8fCByZXZpc2lvbiA8IDApIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihgSW52YWxpZCBiYWNrZ3JvdW5kIGpvYiBjb3VudCByZXZpc2lvbjogJHtyZXZpc2lvbn1gKVxuICAgIH1cblxuICAgIHJldHVybiByZXZpc2lvblxuICB9XG5cbiAgLyoqXG4gICAqIFRha2VzIGEgcG9ydGFibGUgd3JpdGUgbG9jayBvbiB0aGUgc2luZ2xldG9uIHJldmlzaW9uIHJvdy5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9kYXRhYmFzZS9kcml2ZXJzL2Jhc2UuanNcIikuZGVmYXVsdH0gZGIgLSBEYXRhYmFzZSBjb25uZWN0aW9uLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gUmVzb2x2ZXMgd2hlbiBsb2NrZWQuXG4gICAqL1xuICBhc3luYyBfbG9ja0NvdW50UmV2aXNpb24oZGIpIHtcbiAgICBjb25zdCB0YWJsZSA9IGRiLnF1b3RlVGFibGUoQ09VTlRTX1JFVklTSU9OX1RBQkxFKVxuICAgIGNvbnN0IHJldmlzaW9uID0gZGIucXVvdGVDb2x1bW4oXCJyZXZpc2lvblwiKVxuXG4gICAgYXdhaXQgZGIucXVlcnkoYFVQREFURSAke3RhYmxlfSBTRVQgJHtyZXZpc2lvbn0gPSAke3JldmlzaW9ufSBXSEVSRSAke2RiLnF1b3RlQ29sdW1uKFwia2V5XCIpfSA9ICR7ZGIucXVvdGUoQ09VTlRTX1JFVklTSU9OX0tFWSl9YClcbiAgfVxuXG4gIC8qKlxuICAgKiBCdWlsZHMgemVyb2VkIGNhbm9uaWNhbCBidWNrZXRzLlxuICAgKiBAcmV0dXJucyB7UmVjb3JkPHN0cmluZywgbnVtYmVyPn0gWmVyb2VkIGNhbm9uaWNhbCBidWNrZXRzLlxuICAgKi9cbiAgX2VtcHR5Q291bnRCdWNrZXRzKCkge1xuICAgIHJldHVybiBPYmplY3QuZnJvbUVudHJpZXMoQkFDS0dST1VORF9KT0JfQ09VTlRfQlVDS0VUUy5tYXAoKGJ1Y2tldCkgPT4gW2J1Y2tldCwgMF0pKVxuICB9XG5cbiAgLyoqXG4gICAqIENvdW50cyBub3JtYWxpemVkIHJvd3MgYnkgY2Fub25pY2FsIHN0YXR1cy5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL3R5cGVzLmpzXCIpLkJhY2tncm91bmRKb2JSb3dbXX0gam9icyAtIEpvYnMuXG4gICAqIEByZXR1cm5zIHtSZWNvcmQ8c3RyaW5nLCBudW1iZXI+fSBDb3VudHMuXG4gICAqL1xuICBfc3RhdHVzQ291bnRzKGpvYnMpIHtcbiAgICAvKiogQHR5cGUge1JlY29yZDxzdHJpbmcsIG51bWJlcj59ICovXG4gICAgY29uc3QgY291bnRzID0ge31cblxuICAgIGZvciAoY29uc3Qgam9iIG9mIGpvYnMpIHtcbiAgICAgIGlmICghQ09VTlRFRF9KT0JfU1RBVFVTRVMuaW5jbHVkZXMoam9iLnN0YXR1cykpIHRocm93IG5ldyBFcnJvcihgVW5rbm93biBiYWNrZ3JvdW5kIGpvYiBzdGF0dXM6ICR7am9iLnN0YXR1c31gKVxuICAgICAgY291bnRzW2pvYi5zdGF0dXNdID0gKGNvdW50c1tqb2Iuc3RhdHVzXSB8fCAwKSArIDFcbiAgICB9XG5cbiAgICByZXR1cm4gY291bnRzXG4gIH1cblxuICAvKipcbiAgICogUmVhZHMgYSBjYW5vbmljYWwgc25hcHNob3QgYWZ0ZXIgbG9ja2luZyB0aGUgcmV2aXNpb24gcm93LlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL2RhdGFiYXNlL2RyaXZlcnMvYmFzZS5qc1wiKS5kZWZhdWx0fSBkYiAtIFRyYW5zYWN0aW9uIGNvbm5lY3Rpb24uXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHtjb3VudHM6IFJlY29yZDxzdHJpbmcsIG51bWJlcj4sIHJldmlzaW9uOiBudW1iZXIsIHRvdGFsOiBudW1iZXJ9Pn0gU25hcHNob3QuXG4gICAqL1xuICBhc3luYyBfY291bnRTbmFwc2hvdE9uTG9ja2VkQ29ubmVjdGlvbihkYikge1xuICAgIGNvbnN0IHJvd3MgPSBhd2FpdCBkYi5uZXdRdWVyeSgpLmZyb20oSk9CU19UQUJMRSkuc2VsZWN0KFwic3RhdHVzXCIpLnNlbGVjdChcIkNPVU5UKCopIEFTIGNvdW50XCIpLmdyb3VwKFwic3RhdHVzXCIpLnJlc3VsdHMoKVxuICAgIGNvbnN0IGNvdW50cyA9IHRoaXMuX2VtcHR5Q291bnRCdWNrZXRzKClcbiAgICBsZXQgdG90YWwgPSAwXG5cbiAgICBmb3IgKGNvbnN0IHJvdyBvZiByb3dzKSB7XG4gICAgICBjb25zdCB0eXBlZFJvdyA9IC8qKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSAqLyAocm93KVxuICAgICAgY29uc3Qgc3RhdHVzID0gU3RyaW5nKHR5cGVkUm93LnN0YXR1cylcbiAgICAgIGNvbnN0IGNvdW50ID0gdGhpcy5fbm9ybWFsaXplTnVtYmVyKHR5cGVkUm93LmNvdW50KSB8fCAwXG5cbiAgICAgIHRvdGFsICs9IGNvdW50XG5cbiAgICAgIGlmICghQ09VTlRFRF9KT0JfU1RBVFVTRVMuaW5jbHVkZXMoc3RhdHVzKSkgY29udGludWVcbiAgICAgIGNvdW50c1tzdGF0dXNdID0gY291bnRcbiAgICAgIGNvdW50cy5hbGwgKz0gY291bnRzW3N0YXR1c11cbiAgICB9XG5cbiAgICByZXR1cm4ge2NvdW50cywgcmV2aXNpb246IGF3YWl0IHRoaXMuX2NvdW50UmV2aXNpb24oZGIpLCB0b3RhbH1cbiAgfVxuXG4gIC8qKlxuICAgKiBSZWdpc3RlcnMgb3IgdmVyaWZpZXMgYSBzdGFibGUga2V5IGNvbmZpZ3VyYXRpb24uXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vZGF0YWJhc2UvZHJpdmVycy9iYXNlLmpzXCIpLmRlZmF1bHR9IGRiIC0gRGF0YWJhc2UgY29ubmVjdGlvbi5cbiAgICogQHBhcmFtIHtvYmplY3R9IGNvbmN1cnJlbmN5IC0gQ29uY3VycmVuY3kgY29uZmlndXJhdGlvbi5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGNvbmN1cnJlbmN5LmNvbmN1cnJlbmN5S2V5IC0gQ29uY3VycmVuY3kga2V5LlxuICAgKiBAcGFyYW0ge251bWJlcn0gY29uY3VycmVuY3kubWF4Q29uY3VycmVuY3kgLSBTdGFibGUgY2FwLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyB3aGVuIHZlcmlmaWVkLlxuICAgKi9cbiAgYXN5bmMgX2Vuc3VyZUNvbmN1cnJlbmN5S2V5KGRiLCB7Y29uY3VycmVuY3lLZXksIG1heENvbmN1cnJlbmN5fSkge1xuICAgIGNvbnN0IHJvd3MgPSBhd2FpdCBkYi5uZXdRdWVyeSgpLmZyb20oQ09OQ1VSUkVOQ1lfVEFCTEUpLndoZXJlKHtjb25jdXJyZW5jeV9rZXk6IGNvbmN1cnJlbmN5S2V5fSkubGltaXQoMSkucmVzdWx0cygpXG4gICAgaWYgKCFyb3dzWzBdKSB7XG4gICAgICB0cnkge1xuICAgICAgICBhd2FpdCBkYi5pbnNlcnQoe3RhYmxlTmFtZTogQ09OQ1VSUkVOQ1lfVEFCTEUsIGRhdGE6IHthY3RpdmVfY291bnQ6IDAsIGNvbmN1cnJlbmN5X2tleTogY29uY3VycmVuY3lLZXksIG1heF9jb25jdXJyZW5jeTogbWF4Q29uY3VycmVuY3l9fSlcbiAgICAgICAgcmV0dXJuXG4gICAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgICBjb25zdCByYWNlZFJvd3MgPSBhd2FpdCBkYi5uZXdRdWVyeSgpLmZyb20oQ09OQ1VSUkVOQ1lfVEFCTEUpLndoZXJlKHtjb25jdXJyZW5jeV9rZXk6IGNvbmN1cnJlbmN5S2V5fSkubGltaXQoMSkucmVzdWx0cygpXG4gICAgICAgIGlmICghcmFjZWRSb3dzWzBdKSB0aHJvdyBlcnJvclxuICAgICAgICByb3dzWzBdID0gcmFjZWRSb3dzWzBdXG4gICAgICB9XG4gICAgfVxuICAgIGNvbnN0IGNvbmZpZ3VyZWQgPSAvKiogQHR5cGUge3ttYXhfY29uY3VycmVuY3k/OiBudW1iZXIgfCBzdHJpbmd9fSAqLyAocm93c1swXSlcbiAgICBpZiAodGhpcy5fbm9ybWFsaXplTnVtYmVyKGNvbmZpZ3VyZWQubWF4X2NvbmN1cnJlbmN5KSAhPT0gbWF4Q29uY3VycmVuY3kpIHRocm93IG5ldyBFcnJvcihgQ29uZmxpY3RpbmcgbWF4Q29uY3VycmVuY3kgZm9yIGJhY2tncm91bmQgam9iIGNvbmN1cnJlbmN5S2V5OiAke2NvbmN1cnJlbmN5S2V5fWApXG4gIH1cblxuICAvKipcbiAgICogTG9ja3MgdGhlIGNvbmN1cnJlbmN5IGNvdW50ZXIgcm93IHNvIGEgam9iLXJlbGVhc2UgdHJhbnNhY3Rpb24gYWNxdWlyZXMgaXQgKmJlZm9yZSogdGhlIGpvYlxuICAgKiByb3cuIHtAbGluayBtYXJrSGFuZGVkT2ZmfSByZXNlcnZlcyBjYXBhY2l0eSAobG9ja2luZyB0aGUgY291bnRlciByb3cpIGJlZm9yZSBpdCB1cGRhdGVzIHRoZVxuICAgKiBqb2IsIHNvIGl0IGxvY2tzIGNvbmN1cnJlbmN5LXRoZW4tam9iOyB0aGUgcmVsZWFzZSBwYXRocyB1cGRhdGUgdGhlIGpvYiBiZWZvcmUgcmVsZWFzaW5nXG4gICAqIGNhcGFjaXR5LCB3aGljaCBpcyBqb2ItdGhlbi1jb25jdXJyZW5jeS4gVGhvc2Ugb3Bwb3NpdGUgb3JkZXJzIG9uIHRoZSBzYW1lIHNoYXJlZCBjb3VudGVyIHJvd1xuICAgKiBhcmUgd2hhdCBkZWFkbG9jayAoQUItQkEpIHVuZGVyIGEgZHJhaW5pbmcgd29ya2VyLiBUYWtpbmcgdGhpcyBsb2NrIGZpcnN0IGdpdmVzIGV2ZXJ5XG4gICAqIHRyYW5zYWN0aW9uIGEgc2luZ2xlIGNvbmN1cnJlbmN5LXRoZW4tam9iIG9yZGVyIGFuZCByZW1vdmVzIHRoZSBjeWNsZS5cbiAgICpcbiAgICogVXNlcyBhIHZhbHVlLXByZXNlcnZpbmcgYFVQREFURWAgcmF0aGVyIHRoYW4gYFNFTEVDVCAuLi4gRk9SIFVQREFURWAgc28gaXQgc3RheXMgcG9ydGFibGVcbiAgICogYWNyb3NzIGRyaXZlcnMgd2l0aG91dCByb3ctbGV2ZWwgbG9ja2luZyByZWFkcyAoZS5nLiBTUUxpdGUpOyBvbiByb3ctbG9ja2luZyBlbmdpbmVzIHRoZVxuICAgKiBtYXRjaGVkIHJvdyBpcyB3cml0ZS1sb2NrZWQgZm9yIHRoZSByZXN0IG9mIHRoZSB0cmFuc2FjdGlvbiBldmVuIHRob3VnaCBpdHMgdmFsdWUgaXMgdW5jaGFuZ2VkLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL2RhdGFiYXNlL2RyaXZlcnMvYmFzZS5qc1wiKS5kZWZhdWx0fSBkYiAtIERhdGFiYXNlIGNvbm5lY3Rpb24uXG4gICAqIEBwYXJhbSB7c3RyaW5nIHwgbnVsbH0gY29uY3VycmVuY3lLZXkgLSBDb25jdXJyZW5jeSBrZXkuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIHdoZW4gdGhlIGNvdW50ZXIgcm93IGlzIGxvY2tlZC5cbiAgICovXG4gIGFzeW5jIF9sb2NrQ29uY3VycmVuY3lSb3coZGIsIGNvbmN1cnJlbmN5S2V5KSB7XG4gICAgaWYgKCFjb25jdXJyZW5jeUtleSkgcmV0dXJuXG4gICAgY29uc3QgdGFibGUgPSBkYi5xdW90ZVRhYmxlKENPTkNVUlJFTkNZX1RBQkxFKVxuICAgIGNvbnN0IGNvdW50ID0gZGIucXVvdGVDb2x1bW4oXCJhY3RpdmVfY291bnRcIilcbiAgICBhd2FpdCBkYi5xdWVyeShgVVBEQVRFICR7dGFibGV9IFNFVCAke2NvdW50fSA9ICR7Y291bnR9IFdIRVJFICR7ZGIucXVvdGVDb2x1bW4oXCJjb25jdXJyZW5jeV9rZXlcIil9ID0gJHtkYi5xdW90ZShjb25jdXJyZW5jeUtleSl9YClcbiAgfVxuXG4gIC8qKlxuICAgKiBBdG9taWNhbGx5IHJlc2VydmVzIGNhcGFjaXR5IGZvciBhIGtleS5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9kYXRhYmFzZS9kcml2ZXJzL2Jhc2UuanNcIikuZGVmYXVsdH0gZGIgLSBEYXRhYmFzZSBjb25uZWN0aW9uLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gY29uY3VycmVuY3lLZXkgLSBDb25jdXJyZW5jeSBrZXkuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPGJvb2xlYW4+fSAtIFdoZXRoZXIgY2FwYWNpdHkgd2FzIHJlc2VydmVkLlxuICAgKi9cbiAgYXN5bmMgX3Jlc2VydmVDb25jdXJyZW5jeShkYiwgY29uY3VycmVuY3lLZXkpIHtcbiAgICBjb25zdCB0YWJsZSA9IGRiLnF1b3RlVGFibGUoQ09OQ1VSUkVOQ1lfVEFCTEUpXG4gICAgY29uc3QgY291bnQgPSBkYi5xdW90ZUNvbHVtbihcImFjdGl2ZV9jb3VudFwiKVxuICAgIGNvbnN0IGFmZmVjdGVkUm93cyA9IGF3YWl0IGRiLmFmZmVjdGVkUm93cyhgVVBEQVRFICR7dGFibGV9IFNFVCAke2NvdW50fSA9ICR7Y291bnR9ICsgMSBXSEVSRSAke2RiLnF1b3RlQ29sdW1uKFwiY29uY3VycmVuY3lfa2V5XCIpfSA9ICR7ZGIucXVvdGUoY29uY3VycmVuY3lLZXkpfSBBTkQgJHtjb3VudH0gPCAke2RiLnF1b3RlQ29sdW1uKFwibWF4X2NvbmN1cnJlbmN5XCIpfWApXG4gICAgcmV0dXJuIGFmZmVjdGVkUm93cyA9PT0gMVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgYSBwb3J0YWJsZSB1cGRhdGUgYW5kIHJldHVybnMgaXRzIGFmZmVjdGVkLXJvdyBjb3VudC5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9kYXRhYmFzZS9kcml2ZXJzL2Jhc2UuanNcIikuZGVmYXVsdH0gZGIgLSBEYXRhYmFzZSBjb25uZWN0aW9uLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL2RhdGFiYXNlL2RyaXZlcnMvYmFzZS5qc1wiKS5VcGRhdGVTcWxBcmdzVHlwZX0gYXJncyAtIFVwZGF0ZSBvcHRpb25zLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxudW1iZXI+fSAtIEFmZmVjdGVkIHJvdyBjb3VudC5cbiAgICovXG4gIGFzeW5jIF91cGRhdGVBZmZlY3RlZFJvd3MoZGIsIGFyZ3MpIHtcbiAgICByZXR1cm4gYXdhaXQgZGIuYWZmZWN0ZWRSb3dzKGRiLnVwZGF0ZVNxbChhcmdzKSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSZWxlYXNlcyBjYXBhY2l0eSBmb3IgYSBrZXkuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vZGF0YWJhc2UvZHJpdmVycy9iYXNlLmpzXCIpLmRlZmF1bHR9IGRiIC0gRGF0YWJhc2UgY29ubmVjdGlvbi5cbiAgICogQHBhcmFtIHtzdHJpbmcgfCBudWxsfSBjb25jdXJyZW5jeUtleSAtIENvbmN1cnJlbmN5IGtleS5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgd2hlbiByZWxlYXNlZC5cbiAgICovXG4gIGFzeW5jIF9yZWxlYXNlQ29uY3VycmVuY3koZGIsIGNvbmN1cnJlbmN5S2V5KSB7XG4gICAgaWYgKCFjb25jdXJyZW5jeUtleSkgcmV0dXJuXG4gICAgY29uc3QgdGFibGUgPSBkYi5xdW90ZVRhYmxlKENPTkNVUlJFTkNZX1RBQkxFKVxuICAgIGNvbnN0IGNvdW50ID0gZGIucXVvdGVDb2x1bW4oXCJhY3RpdmVfY291bnRcIilcbiAgICBhd2FpdCBkYi5xdWVyeShgVVBEQVRFICR7dGFibGV9IFNFVCAke2NvdW50fSA9ICR7Y291bnR9IC0gMSBXSEVSRSAke2RiLnF1b3RlQ29sdW1uKFwiY29uY3VycmVuY3lfa2V5XCIpfSA9ICR7ZGIucXVvdGUoY29uY3VycmVuY3lLZXkpfSBBTkQgJHtjb3VudH0gPiAwYClcbiAgfVxuXG4gIC8qKlxuICAgKiBSZWJ1aWxkcyBkdXJhYmxlIGNvdW50cyBmcm9tIGFjdGl2ZSBoYW5kb2Zmcy5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9kYXRhYmFzZS9kcml2ZXJzL2Jhc2UuanNcIikuZGVmYXVsdH0gZGIgLSBEYXRhYmFzZSBjb25uZWN0aW9uLlxuICAgKiBAcGFyYW0ge3tpbnNpZGVUcmFuc2FjdGlvbj86IGJvb2xlYW59fSBbb3B0aW9uc10gLSBSZXVzZSBhbiBlbmNsb3NpbmcgdHJhbnNhY3Rpb24uXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPGltcG9ydChcIi4vdHlwZXMuanNcIikuQmFja2dyb3VuZEpvYkNvbmN1cnJlbmN5UmVjb25jaWxpYXRpb24+fSAtIFJlcGFpciBzdW1tYXJ5LlxuICAgKi9cbiAgYXN5bmMgX3JlY29uY2lsZUNvbmN1cnJlbmN5KGRiLCB7aW5zaWRlVHJhbnNhY3Rpb24gPSBmYWxzZX0gPSB7fSkge1xuICAgIGlmICghKGF3YWl0IGRiLnRhYmxlRXhpc3RzKENPTkNVUlJFTkNZX1RBQkxFKSkpIHtcbiAgICAgIHJldHVybiB7Y2FuZGlkYXRlQ291bnQ6IDAsIGNoZWNrZWRDb3VudDogMCwgcmVwYWlyZWRDb3VudDogMCwgcmVwYWlyczogW10sIHJlcGFpcnNUcnVuY2F0ZWRDb3VudDogMH1cbiAgICB9XG5cbiAgICBjb25zdCBhY3RpdmVSb3dzID0gYXdhaXQgZGJcbiAgICAgIC5uZXdRdWVyeSgpXG4gICAgICAuZnJvbShKT0JTX1RBQkxFKVxuICAgICAgLnNlbGVjdChcImNvbmN1cnJlbmN5X2tleVwiKVxuICAgICAgLnNlbGVjdChcIkNPVU5UKCopIEFTIGFjdGl2ZV9jb3VudFwiKVxuICAgICAgLndoZXJlKHtzdGF0dXM6IFwiaGFuZGVkX29mZlwifSlcbiAgICAgIC53aGVyZShgJHtkYi5xdW90ZUNvbHVtbihcImNvbmN1cnJlbmN5X2tleVwiKX0gSVMgTk9UIE5VTExgKVxuICAgICAgLmdyb3VwKFwiY29uY3VycmVuY3lfa2V5XCIpXG4gICAgICAucmVzdWx0cygpXG4gICAgY29uc3Qgc3RhbGVSb3dzID0gYXdhaXQgZGJcbiAgICAgIC5uZXdRdWVyeSgpXG4gICAgICAuZnJvbShDT05DVVJSRU5DWV9UQUJMRSlcbiAgICAgIC5zZWxlY3QoXCJjb25jdXJyZW5jeV9rZXlcIilcbiAgICAgIC5zZWxlY3QoXCJhY3RpdmVfY291bnRcIilcbiAgICAgIC53aGVyZShgJHtkYi5xdW90ZUNvbHVtbihcImFjdGl2ZV9jb3VudFwiKX0gIT0gMGApXG4gICAgICAucmVzdWx0cygpXG4gICAgLyoqIEB0eXBlIHtNYXA8c3RyaW5nLCBudW1iZXI+fSAqL1xuICAgIGNvbnN0IGFjdGl2ZUNvdW50cyA9IG5ldyBNYXAoKVxuICAgIC8qKiBAdHlwZSB7TWFwPHN0cmluZywgbnVtYmVyPn0gKi9cbiAgICBjb25zdCBwZXJzaXN0ZWRDb3VudHMgPSBuZXcgTWFwKClcblxuICAgIGZvciAoY29uc3QgcmF3Um93IG9mIGFjdGl2ZVJvd3MpIHtcbiAgICAgIGNvbnN0IHJvdyA9IC8qKiBAdHlwZSB7QmFja2dyb3VuZEpvYkNvbmN1cnJlbmN5Q291bnRSb3d9ICovIChyYXdSb3cpXG4gICAgICBhY3RpdmVDb3VudHMuc2V0KHJvdy5jb25jdXJyZW5jeV9rZXksIHRoaXMuX3ZhbGlkYXRlZENvbmN1cnJlbmN5Q291bnQocm93LmFjdGl2ZV9jb3VudCwgcm93LmNvbmN1cnJlbmN5X2tleSkpXG4gICAgfVxuXG4gICAgZm9yIChjb25zdCByYXdSb3cgb2Ygc3RhbGVSb3dzKSB7XG4gICAgICBjb25zdCByb3cgPSAvKiogQHR5cGUge0JhY2tncm91bmRKb2JDb25jdXJyZW5jeUNvdW50Um93fSAqLyAocmF3Um93KVxuICAgICAgcGVyc2lzdGVkQ291bnRzLnNldChyb3cuY29uY3VycmVuY3lfa2V5LCB0aGlzLl92YWxpZGF0ZWRDb25jdXJyZW5jeUNvdW50KHJvdy5hY3RpdmVfY291bnQsIHJvdy5jb25jdXJyZW5jeV9rZXkpKVxuICAgIH1cblxuICAgIGNvbnN0IGNvbmN1cnJlbmN5S2V5cyA9IFsuLi5uZXcgU2V0KFsuLi5hY3RpdmVDb3VudHMua2V5cygpLCAuLi5wZXJzaXN0ZWRDb3VudHMua2V5cygpXSldLnNvcnQoKVxuICAgIGNvbnN0IGNhbmRpZGF0ZUtleXMgPSBjb25jdXJyZW5jeUtleXMuZmlsdGVyKChjb25jdXJyZW5jeUtleSkgPT4ge1xuICAgICAgcmV0dXJuIChhY3RpdmVDb3VudHMuZ2V0KGNvbmN1cnJlbmN5S2V5KSB8fCAwKSAhPT0gKHBlcnNpc3RlZENvdW50cy5nZXQoY29uY3VycmVuY3lLZXkpIHx8IDApXG4gICAgfSlcbiAgICAvKiogQHR5cGUge2ltcG9ydChcIi4vdHlwZXMuanNcIikuQmFja2dyb3VuZEpvYkNvbmN1cnJlbmN5UmVwYWlyW119ICovXG4gICAgY29uc3QgcmVwYWlycyA9IFtdXG4gICAgbGV0IHJlcGFpcmVkQ291bnQgPSAwXG5cbiAgICBmb3IgKGNvbnN0IGNvbmN1cnJlbmN5S2V5IG9mIGNhbmRpZGF0ZUtleXMpIHtcbiAgICAgIGNvbnN0IHJlcGFpciA9IGluc2lkZVRyYW5zYWN0aW9uXG4gICAgICAgID8gYXdhaXQgdGhpcy5fcmVjb25jaWxlQ29uY3VycmVuY3lLZXkoZGIsIGNvbmN1cnJlbmN5S2V5KVxuICAgICAgICA6IGF3YWl0IHRoaXMuX3RyYW5zYWN0aW9uUmVzdWx0KGRiLCBhc3luYyAoKSA9PiBhd2FpdCB0aGlzLl9yZWNvbmNpbGVDb25jdXJyZW5jeUtleShkYiwgY29uY3VycmVuY3lLZXkpKVxuXG4gICAgICBpZiAoIXJlcGFpcikgY29udGludWVcblxuICAgICAgcmVwYWlyZWRDb3VudCsrXG4gICAgICBpZiAocmVwYWlycy5sZW5ndGggPCBDT05DVVJSRU5DWV9SRVBBSVJfU0FNUExFX0xJTUlUKSByZXBhaXJzLnB1c2gocmVwYWlyKVxuICAgIH1cblxuICAgIHJldHVybiB7XG4gICAgICBjYW5kaWRhdGVDb3VudDogY2FuZGlkYXRlS2V5cy5sZW5ndGgsXG4gICAgICBjaGVja2VkQ291bnQ6IGNvbmN1cnJlbmN5S2V5cy5sZW5ndGgsXG4gICAgICByZXBhaXJlZENvdW50LFxuICAgICAgcmVwYWlycyxcbiAgICAgIHJlcGFpcnNUcnVuY2F0ZWRDb3VudDogcmVwYWlyZWRDb3VudCAtIHJlcGFpcnMubGVuZ3RoXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIFJlYnVpbGRzIG9uZSBjb3VudGVyIGFmdGVyIGxvY2tpbmcgaXQgYWhlYWQgb2YgdGhlIGpvYiByb3dzLCBtYXRjaGluZyB0aGVcbiAgICogbG9jayBvcmRlciB1c2VkIGJ5IGhhbmRvZmYgYW5kIGNvbXBsZXRpb24gdHJhbnNpdGlvbnMuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vZGF0YWJhc2UvZHJpdmVycy9iYXNlLmpzXCIpLmRlZmF1bHR9IGRiIC0gRGF0YWJhc2UgY29ubmVjdGlvbi5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGNvbmN1cnJlbmN5S2V5IC0gQ291bnRlciBrZXkuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPGltcG9ydChcIi4vdHlwZXMuanNcIikuQmFja2dyb3VuZEpvYkNvbmN1cnJlbmN5UmVwYWlyIHwgbnVsbD59IC0gQXBwbGllZCByZXBhaXIuXG4gICAqL1xuICBhc3luYyBfcmVjb25jaWxlQ29uY3VycmVuY3lLZXkoZGIsIGNvbmN1cnJlbmN5S2V5KSB7XG4gICAgYXdhaXQgdGhpcy5fbG9ja0NvbmN1cnJlbmN5Um93KGRiLCBjb25jdXJyZW5jeUtleSlcbiAgICBjb25zdCBwZXJzaXN0ZWRSb3dzID0gYXdhaXQgZGJcbiAgICAgIC5uZXdRdWVyeSgpXG4gICAgICAuZnJvbShDT05DVVJSRU5DWV9UQUJMRSlcbiAgICAgIC5zZWxlY3QoXCJhY3RpdmVfY291bnRcIilcbiAgICAgIC5zZWxlY3QoXCJjb25jdXJyZW5jeV9rZXlcIilcbiAgICAgIC53aGVyZSh7Y29uY3VycmVuY3lfa2V5OiBjb25jdXJyZW5jeUtleX0pXG4gICAgICAubGltaXQoMSlcbiAgICAgIC5yZXN1bHRzKClcblxuICAgIGlmICghcGVyc2lzdGVkUm93c1swXSkgdGhyb3cgbmV3IEVycm9yKGBNaXNzaW5nIGJhY2tncm91bmQgam9iIGNvbmN1cnJlbmN5IGNvdW50ZXIgZm9yICR7Y29uY3VycmVuY3lLZXl9YClcblxuICAgIGNvbnN0IHBlcnNpc3RlZFJvdyA9IC8qKiBAdHlwZSB7QmFja2dyb3VuZEpvYkNvbmN1cnJlbmN5Q291bnRSb3d9ICovIChwZXJzaXN0ZWRSb3dzWzBdKVxuICAgIGNvbnN0IHByZXZpb3VzQWN0aXZlQ291bnQgPSB0aGlzLl92YWxpZGF0ZWRDb25jdXJyZW5jeUNvdW50KHBlcnNpc3RlZFJvdy5hY3RpdmVfY291bnQsIGNvbmN1cnJlbmN5S2V5KVxuICAgIGNvbnN0IHJvd3MgPSBhd2FpdCBkYlxuICAgICAgLm5ld1F1ZXJ5KClcbiAgICAgIC5mcm9tKEpPQlNfVEFCTEUpXG4gICAgICAuc2VsZWN0KFwiQ09VTlQoKikgQVMgYWN0aXZlX2NvdW50XCIpXG4gICAgICAud2hlcmUoe2NvbmN1cnJlbmN5X2tleTogY29uY3VycmVuY3lLZXksIHN0YXR1czogXCJoYW5kZWRfb2ZmXCJ9KVxuICAgICAgLnJlc3VsdHMoKVxuICAgIGNvbnN0IGNvdW50Um93ID0gLyoqIEB0eXBlIHt7YWN0aXZlX2NvdW50OiBudW1iZXIgfCBzdHJpbmd9fSAqLyAocm93c1swXSlcbiAgICBjb25zdCBhY3RpdmVDb3VudCA9IHRoaXMuX3ZhbGlkYXRlZENvbmN1cnJlbmN5Q291bnQoY291bnRSb3cuYWN0aXZlX2NvdW50LCBjb25jdXJyZW5jeUtleSlcblxuICAgIGlmIChhY3RpdmVDb3VudCA9PT0gcHJldmlvdXNBY3RpdmVDb3VudCkgcmV0dXJuIG51bGxcblxuICAgIGF3YWl0IGRiLnVwZGF0ZSh7XG4gICAgICB0YWJsZU5hbWU6IENPTkNVUlJFTkNZX1RBQkxFLFxuICAgICAgZGF0YToge2FjdGl2ZV9jb3VudDogYWN0aXZlQ291bnR9LFxuICAgICAgY29uZGl0aW9uczoge2NvbmN1cnJlbmN5X2tleTogY29uY3VycmVuY3lLZXl9XG4gICAgfSlcblxuICAgIHJldHVybiB7YWN0aXZlQ291bnQsIGNvbmN1cnJlbmN5S2V5LCBwcmV2aW91c0FjdGl2ZUNvdW50fVxuICB9XG5cbiAgLyoqXG4gICAqIFZhbGlkYXRlcyBhIGRhdGFiYXNlIGNvdW50IGJlZm9yZSBpdCBwYXJ0aWNpcGF0ZXMgaW4gcmVjb25jaWxpYXRpb24uXG4gICAqIEBwYXJhbSB7bnVtYmVyIHwgc3RyaW5nfSB2YWx1ZSAtIFJhdyBjb3VudC5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGNvbmN1cnJlbmN5S2V5IC0gQ291bnRlciBrZXkgZm9yIGRpYWdub3N0aWNzLlxuICAgKiBAcmV0dXJucyB7bnVtYmVyfSAtIFNhZmUgbm9uLW5lZ2F0aXZlIGNvdW50LlxuICAgKi9cbiAgX3ZhbGlkYXRlZENvbmN1cnJlbmN5Q291bnQodmFsdWUsIGNvbmN1cnJlbmN5S2V5KSB7XG4gICAgY29uc3QgY291bnQgPSB0aGlzLl9ub3JtYWxpemVOdW1iZXIodmFsdWUpXG5cbiAgICBpZiAoY291bnQgPT09IG51bGwgfHwgIU51bWJlci5pc1NhZmVJbnRlZ2VyKGNvdW50KSB8fCBjb3VudCA8IDApIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihgSW52YWxpZCByZWNvbmNpbGVkIGJhY2tncm91bmQgam9iIGNvbmN1cnJlbmN5IGNvdW50IGZvciAke2NvbmN1cnJlbmN5S2V5fTogJHtjb3VudH1gKVxuICAgIH1cblxuICAgIHJldHVybiBjb3VudFxuICB9XG5cbiAgLyoqXG4gICAqIFJlY29uY2lsZXMgcXVldWUtZGVyaXZlZCBjb25jdXJyZW5jeSB3aXRoIHRoZSBjdXJyZW50IGNvbmZpZ3VyYXRpb24uIE9ubHlcbiAgICogaW52b2tlZCB0aHJvdWdoIHtAbGluayByZWNvbmNpbGVRdWV1ZUNvbmN1cnJlbmN5fSDigJQgdGhlIGV4cGxpY2l0IGxpZmVjeWNsZVxuICAgKiBwYXRoIHJ1biBhdCBtYWluLXByb2Nlc3Mgc3RhcnR1cCB1bmRlciBhIGNyb3NzLXByb2Nlc3MgYWR2aXNvcnkgbG9jayDigJRcbiAgICogbmV2ZXIgZnJvbSBzY2hlbWEvdGVuYW50IGNoZWNrcyBvciByb3V0aW5lIGNvbm5lY3Rpb24gaW5pdGlhbGl6YXRpb24sXG4gICAqIHdoaWNoIHN0YXkgcmVhZC1vbmx5IHJlZ2FyZGluZyBxdWV1ZWQgam9iIHJvd3MuIFRoZSBwZXItcHJvY2VzcyBtZW1vIGlzXG4gICAqIGxhdGNoZWQgYnkge0BsaW5rIHJlY29uY2lsZVF1ZXVlQ29uY3VycmVuY3l9IG9ubHkgYWZ0ZXIgdGhlIGZvbGxvd2luZ1xuICAgKiBjb3VudCByZWJ1aWxkIGFsc28gc3VjY2VlZHMsIHNvIGEgZmFpbGVkIHJlYnVpbGQgcmUtZW50ZXJzIGhlcmUgb24gcmV0cnlcbiAgICogKHRoZSBhZG9wdGlvbiBVUERBVEVzIGJlbG93IGFyZSBpZGVtcG90ZW50KS4gRW5xdWV1ZSBvbmx5IGNvbnN1bHRzIGNvbmZpZyBmb3IgbmV3IGpvYnMsIHNvIGEgY2FwIGFkZGVkLCByZW1vdmVkLCBvciBjaGFuZ2VkXG4gICAqIHdoaWxlIGEgYmFja2xvZyBleGlzdHMgb3RoZXJ3aXNlIGxlYXZlcyBwZXJzaXN0ZWQgcm93cyBzdGFsZTogcHJlLWNhcCBqb2JzXG4gICAqIGtlZXAgYSBudWxsIGtleSBhbmQgYnlwYXNzIHRoZSBjYXAsIHBvc3QtcmVtb3ZhbCBqb2JzIHN0YXkgY2FwcGVkIHVuZGVyIGFcbiAgICogbm93LXVuY29uZmlndXJlZCBrZXksIGFuZCBhIGNoYW5nZWQgbnVtZXJpYyBjYXAgc3RheXMgc3RhbGUgdW50aWwgdGhlIG5leHRcbiAgICogZW5xdWV1ZS4gQnJpbmcgcXVldWVkIGR1cmFibGUgc3RhdGUgaW4gbGluZSB3aXRoIGNvbmZpZzogc3luYyBlYWNoIGNvbmZpZ3VyZWRcbiAgICogcXVldWUncyBzdG9yZWQgY2FwLCBhZG9wdCBub3QteWV0LWtleWVkIHF1ZXVlZCBqb2JzIG9udG8gdGhlaXIgcXVldWUga2V5LFxuICAgKiBhbmQgcmVsZWFzZSBxdWV1ZWQgam9icyBmcm9tIHF1ZXVlIGtleXMgd2hvc2UgcXVldWUgaXMgbm8gbG9uZ2VyIGNhcHBlZC5cbiAgICogRXhpc3RpbmcgaGFuZG9mZnMgcmV0YWluIHRoZSBwb2xpY3kgYW5kIHJlc2VydmF0aW9uIHRoZXkgc3RhcnRlZCB3aXRoLCBzb1xuICAgKiByZWNvbmNpbGlhdGlvbiBjYW5ub3QgcmFjZSB0aGVpciBjb21wbGV0aW9uL3JldHJ5IHRyYW5zaXRpb25zLiBSdW5zIGJlZm9yZVxuICAgKiB7QGxpbmsgX3JlY29uY2lsZUNvbmN1cnJlbmN5fSBzbyBhbnkgcHJlLWV4aXN0aW5nIGFjdGl2ZSBjb3VudHMgYXJlIGV4YWN0LlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL2RhdGFiYXNlL2RyaXZlcnMvYmFzZS5qc1wiKS5kZWZhdWx0fSBkYiAtIERhdGFiYXNlIGNvbm5lY3Rpb24uXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIHdoZW4gcmVjb25jaWxlZC5cbiAgICovXG4gIGFzeW5jIF9yZWNvbmNpbGVRdWV1ZUNvbmN1cnJlbmN5KGRiKSB7XG4gICAgaWYgKHRoaXMuX3F1ZXVlQ29uY3VycmVuY3lSZWNvbmNpbGVkKSByZXR1cm5cbiAgICBpZiAoIShhd2FpdCBkYi50YWJsZUV4aXN0cyhDT05DVVJSRU5DWV9UQUJMRSkpKSByZXR1cm5cblxuICAgIGNvbnN0IHF1ZXVlc0NvbmZpZyA9IHRoaXMuY29uZmlndXJhdGlvbi5nZXRCYWNrZ3JvdW5kSm9ic0NvbmZpZygpLnF1ZXVlcyB8fCB7fVxuICAgIGNvbnN0IGpvYnNUYWJsZSA9IGRiLnF1b3RlVGFibGUoSk9CU19UQUJMRSlcbiAgICBjb25zdCBrZXlDb2x1bW4gPSBkYi5xdW90ZUNvbHVtbihcImNvbmN1cnJlbmN5X2tleVwiKVxuICAgIGNvbnN0IGNhcENvbHVtbiA9IGRiLnF1b3RlQ29sdW1uKFwibWF4X2NvbmN1cnJlbmN5XCIpXG4gICAgY29uc3QgcXVldWVDb2x1bW4gPSBkYi5xdW90ZUNvbHVtbihcInF1ZXVlXCIpXG4gICAgY29uc3QgcXVldWVkID0gYCR7ZGIucXVvdGVDb2x1bW4oXCJzdGF0dXNcIil9ID0gJHtkYi5xdW90ZShcInF1ZXVlZFwiKX1gXG4gICAgLyoqIEB0eXBlIHtTZXQ8c3RyaW5nPn0gKi9cbiAgICBjb25zdCBjYXBwZWRRdWV1ZXMgPSBuZXcgU2V0KClcblxuICAgIGZvciAoY29uc3QgcXVldWUgb2YgT2JqZWN0LmtleXMocXVldWVzQ29uZmlnKSkge1xuICAgICAgY29uc3QgY2FwID0gdGhpcy5fcXVldWVNYXhDb25jdXJyZW5jeShxdWV1ZSlcblxuICAgICAgaWYgKGNhcCA9PT0gbnVsbCkgY29udGludWVcblxuICAgICAgY2FwcGVkUXVldWVzLmFkZChxdWV1ZSlcbiAgICAgIGNvbnN0IGNvbmN1cnJlbmN5S2V5ID0gYCR7UVVFVUVfQ09OQ1VSUkVOQ1lfS0VZX1BSRUZJWH0ke3F1ZXVlfWBcblxuICAgICAgYXdhaXQgdGhpcy5fZW5zdXJlUXVldWVDb25jdXJyZW5jeUtleShkYiwge2NvbmN1cnJlbmN5S2V5LCBtYXhDb25jdXJyZW5jeTogY2FwfSlcbiAgICAgIGF3YWl0IGRiLnF1ZXJ5KFxuICAgICAgICBgVVBEQVRFICR7am9ic1RhYmxlfSBTRVQgJHtrZXlDb2x1bW59ID0gJHtkYi5xdW90ZShjb25jdXJyZW5jeUtleSl9LCAke2NhcENvbHVtbn0gPSAke051bWJlcihjYXApfSBgICtcbiAgICAgICAgYFdIRVJFICR7cXVldWVDb2x1bW59ID0gJHtkYi5xdW90ZShxdWV1ZSl9IEFORCAke2tleUNvbHVtbn0gSVMgTlVMTCBBTkQgJHtxdWV1ZWR9YFxuICAgICAgKVxuICAgIH1cblxuICAgIGNvbnN0IGNvbmN1cnJlbmN5Um93cyA9IGF3YWl0IGRiXG4gICAgICAubmV3UXVlcnkoKVxuICAgICAgLmZyb20oQ09OQ1VSUkVOQ1lfVEFCTEUpXG4gICAgICAuc2VsZWN0KFwiY29uY3VycmVuY3lfa2V5XCIpXG4gICAgICAud2hlcmUoYCR7ZGIucXVvdGVDb2x1bW4oXCJjb25jdXJyZW5jeV9rZXlcIil9IExJS0UgJHtkYi5xdW90ZShgJHtRVUVVRV9DT05DVVJSRU5DWV9LRVlfUFJFRklYfSVgKX1gKVxuICAgICAgLnJlc3VsdHMoKVxuXG4gICAgZm9yIChjb25zdCByb3cgb2YgY29uY3VycmVuY3lSb3dzKSB7XG4gICAgICBjb25zdCBjb25jdXJyZW5jeUtleSA9IFN0cmluZygvKiogQHR5cGUge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gKi8gKHJvdykuY29uY3VycmVuY3lfa2V5KVxuXG4gICAgICBpZiAoIWNvbmN1cnJlbmN5S2V5LnN0YXJ0c1dpdGgoUVVFVUVfQ09OQ1VSUkVOQ1lfS0VZX1BSRUZJWCkpIGNvbnRpbnVlXG4gICAgICBpZiAoY2FwcGVkUXVldWVzLmhhcyhjb25jdXJyZW5jeUtleS5zbGljZShRVUVVRV9DT05DVVJSRU5DWV9LRVlfUFJFRklYLmxlbmd0aCkpKSBjb250aW51ZVxuXG4gICAgICBhd2FpdCBkYi5xdWVyeShcbiAgICAgICAgYFVQREFURSAke2pvYnNUYWJsZX0gU0VUICR7a2V5Q29sdW1ufSA9IE5VTEwsICR7Y2FwQ29sdW1ufSA9IE5VTEwgYCArXG4gICAgICAgIGBXSEVSRSAke2tleUNvbHVtbn0gPSAke2RiLnF1b3RlKGNvbmN1cnJlbmN5S2V5KX0gQU5EICR7cXVldWVkfWBcbiAgICAgIClcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogUnVucyBub3JtYWxpemUgbnVtYmVyLlxuICAgKiBAcGFyYW0ge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSB2YWx1ZSAtIElucHV0IHZhbHVlLlxuICAgKiBAcmV0dXJucyB7bnVtYmVyIHwgbnVsbH0gLSBOb3JtYWxpemVkIG51bWJlci5cbiAgICovXG4gIF9ub3JtYWxpemVOdW1iZXIodmFsdWUpIHtcbiAgICBpZiAodmFsdWUgPT09IG51bGwgfHwgdmFsdWUgPT09IHVuZGVmaW5lZCB8fCB2YWx1ZSA9PT0gXCJcIikgcmV0dXJuIG51bGxcblxuICAgIGNvbnN0IG51bWVyaWMgPSBOdW1iZXIodmFsdWUpXG5cbiAgICBpZiAoTnVtYmVyLmlzTmFOKG51bWVyaWMpKSByZXR1cm4gbnVsbFxuXG4gICAgcmV0dXJuIG51bWVyaWNcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIG5vcm1hbGl6ZSBleGVjdXRpb24gbW9kZS5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL3R5cGVzLmpzXCIpLkJhY2tncm91bmRKb2JPcHRpb25zfSBbb3B0aW9uc10gLSBKb2Igb3B0aW9ucy5cbiAgICogQHJldHVybnMge2ltcG9ydChcIi4vdHlwZXMuanNcIikuQmFja2dyb3VuZEpvYkV4ZWN1dGlvbk1vZGV9IC0gTm9ybWFsaXplZCBleGVjdXRpb24gbW9kZS5cbiAgICovXG4gIF9ub3JtYWxpemVFeGVjdXRpb25Nb2RlKG9wdGlvbnMpIHtcbiAgICByZXR1cm4gbm9ybWFsaXplQmFja2dyb3VuZEpvYkV4ZWN1dGlvbk1vZGUob3B0aW9ucyB8fCB7fSwgREVGQVVMVF9CQUNLR1JPVU5EX0pPQl9FWEVDVVRJT05fTU9ERSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIG5vcm1hbGl6ZSBleGVjdXRpb24gbW9kZSBuYW1lLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gZXhlY3V0aW9uTW9kZSAtIEV4ZWN1dGlvbiBtb2RlIG5hbWUuXG4gICAqIEByZXR1cm5zIHtpbXBvcnQoXCIuL3R5cGVzLmpzXCIpLkJhY2tncm91bmRKb2JFeGVjdXRpb25Nb2RlfSAtIE5vcm1hbGl6ZWQgZXhlY3V0aW9uIG1vZGUuXG4gICAqL1xuICBfbm9ybWFsaXplRXhlY3V0aW9uTW9kZU5hbWUoZXhlY3V0aW9uTW9kZSkge1xuICAgIHJldHVybiBub3JtYWxpemVCYWNrZ3JvdW5kSm9iRXhlY3V0aW9uTW9kZShcbiAgICAgIHtleGVjdXRpb25Nb2RlOiAvKiogQHR5cGUge2ltcG9ydChcIi4vdHlwZXMuanNcIikuQmFja2dyb3VuZEpvYkV4ZWN1dGlvbk1vZGV9ICovIChleGVjdXRpb25Nb2RlKX0sXG4gICAgICBERUZBVUxUX0JBQ0tHUk9VTkRfSk9CX0VYRUNVVElPTl9NT0RFLFxuICAgICAgQkFDS0dST1VORF9KT0JfRVhFQ1VUSU9OX01PREVTXG4gICAgKVxuICB9XG5cbiAgLyoqXG4gICAqIEZpbHRlcnMgcXVldWVkIGpvYnMgYnkgb25lIG9yIG1vcmUgZXhlY3V0aW9uIG1vZGVzIGFnYWluc3QgdGhlXG4gICAqIGBleGVjdXRpb25fbW9kZWAgY29sdW1uICh0aGUgc2luZ2xlIHNvdXJjZSBvZiB0cnV0aCkuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gT3B0aW9ucy5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9kYXRhYmFzZS9kcml2ZXJzL2Jhc2UuanNcIikuZGVmYXVsdH0gYXJncy5kYiAtIERhdGFiYXNlIGNvbm5lY3Rpb24uXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi90eXBlcy5qc1wiKS5CYWNrZ3JvdW5kSm9iRXhlY3V0aW9uTW9kZSB8IGltcG9ydChcIi4vdHlwZXMuanNcIikuQmFja2dyb3VuZEpvYkV4ZWN1dGlvbk1vZGVbXX0gYXJncy5leGVjdXRpb25Nb2RlIC0gUnVudGltZSBtb2Rlcy5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9kYXRhYmFzZS9xdWVyeS9pbmRleC5qc1wiKS5kZWZhdWx0fSBhcmdzLnF1ZXJ5IC0gUXVlcnkgdG8gZmlsdGVyLlxuICAgKiBAcmV0dXJucyB7aW1wb3J0KFwiLi4vZGF0YWJhc2UvcXVlcnkvaW5kZXguanNcIikuZGVmYXVsdH0gLSBGaWx0ZXJlZCBxdWVyeS5cbiAgICovXG4gIF93aGVyZUV4ZWN1dGlvbk1vZGUoe2RiLCBleGVjdXRpb25Nb2RlLCBxdWVyeX0pIHtcbiAgICBjb25zdCBleGVjdXRpb25Nb2RlcyA9IEFycmF5LmlzQXJyYXkoZXhlY3V0aW9uTW9kZSkgPyBleGVjdXRpb25Nb2RlIDogW2V4ZWN1dGlvbk1vZGVdXG4gICAgY29uc3QgZXhlY3V0aW9uTW9kZUNvbHVtbiA9IGRiLnF1b3RlQ29sdW1uKFwiZXhlY3V0aW9uX21vZGVcIilcbiAgICBjb25zdCBjb25kaXRpb25zID0gZXhlY3V0aW9uTW9kZXMubWFwKChtb2RlKSA9PiBgJHtleGVjdXRpb25Nb2RlQ29sdW1ufSA9ICR7ZGIucXVvdGUobW9kZSl9YClcblxuICAgIHJldHVybiBxdWVyeS53aGVyZShgKCR7Y29uZGl0aW9ucy5qb2luKFwiIE9SIFwiKX0pYClcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHBhcnNlIGFyZ3MuXG4gICAqIEBwYXJhbSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59IHZhbHVlIC0gSW5wdXQgdmFsdWUuXG4gICAqIEByZXR1cm5zIHtBcnJheTxSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59IC0gUGFyc2VkIGFyZ3MuXG4gICAqL1xuICBfcGFyc2VBcmdzKHZhbHVlKSB7XG4gICAgaWYgKCF2YWx1ZSkgcmV0dXJuIFtdXG5cbiAgICB0cnkge1xuICAgICAgY29uc3QgcGFyc2VkID0gSlNPTi5wYXJzZShTdHJpbmcodmFsdWUpKVxuXG4gICAgICBpZiAoQXJyYXkuaXNBcnJheShwYXJzZWQpKSByZXR1cm4gcGFyc2VkXG4gICAgfSBjYXRjaCB7XG4gICAgICAvLyBJZ25vcmUgcGFyc2UgZXJyb3JzLlxuICAgIH1cblxuICAgIHJldHVybiBbXVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgd2l0aCBkYi5cbiAgICogQHRlbXBsYXRlIFRcbiAgICogQHBhcmFtIHsoZGI6IGltcG9ydChcIi4uL2RhdGFiYXNlL2RyaXZlcnMvYmFzZS5qc1wiKS5kZWZhdWx0KSA9PiBQcm9taXNlPFQ+fSBjYWxsYmFjayAtIENhbGxiYWNrLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxUPn0gLSBDYWxsYmFjayByZXN1bHQuXG4gICAqL1xuICBhc3luYyBfd2l0aERiKGNhbGxiYWNrKSB7XG4gICAgY29uc3QgZGF0YWJhc2VJZGVudGlmaWVyID0gdGhpcy5nZXREYXRhYmFzZUlkZW50aWZpZXIoKVxuICAgIGNvbnN0IHBvb2wgPSB0aGlzLmNvbmZpZ3VyYXRpb24uZ2V0RGF0YWJhc2VQb29sKGRhdGFiYXNlSWRlbnRpZmllcilcblxuICAgIGlmICghcG9vbC50ZXN0U2hhcmVkQ29ubmVjdGlvbigpKSB7XG4gICAgICByZXR1cm4gYXdhaXQgcG9vbC53aXRoQ29ubmVjdGlvbih7bmFtZTogXCJCYWNrZ3JvdW5kIGpvYnMgc3RvcmVcIn0sIGNhbGxiYWNrKVxuICAgIH1cblxuICAgIHJldHVybiBhd2FpdCB0aGlzLmNvbmZpZ3VyYXRpb24ucnVuV2l0aFRlc3RTaGFyZWRDb25uZWN0aW9uQ29udGV4dHMoYXN5bmMgKCkgPT4ge1xuICAgICAgcmV0dXJuIGF3YWl0IHRoaXMuY29uZmlndXJhdGlvbi5lbnN1cmVDb25uZWN0aW9ucyh7ZGF0YWJhc2VJZGVudGlmaWVyczogW2RhdGFiYXNlSWRlbnRpZmllcl0sIG5hbWU6IFwiQmFja2dyb3VuZCBqb2JzIHN0b3JlXCJ9LCBhc3luYyAoZGJzKSA9PiB7XG4gICAgICAgIGNvbnN0IGNvbm5lY3Rpb24gPSBkYnNbZGF0YWJhc2VJZGVudGlmaWVyXVxuICAgICAgICByZXR1cm4gYXdhaXQgY29vcmRpbmF0ZVNoYXJlZFRyYW5zYWN0aW9uQ29ubmVjdGlvbihjb25uZWN0aW9uLCBhc3luYyAoKSA9PiBhd2FpdCBjYWxsYmFjayhjb25uZWN0aW9uKSlcbiAgICAgIH0pXG4gICAgfSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGEgdmFsdWUtcmV0dXJuaW5nIGNhbGxiYWNrIGluc2lkZSB0aGUgZHJpdmVyJ3Mgdm9pZC10eXBlZCB0cmFuc2FjdGlvbiBBUEkuXG4gICAqIEB0ZW1wbGF0ZSBUXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vZGF0YWJhc2UvZHJpdmVycy9iYXNlLmpzXCIpLmRlZmF1bHR9IGRiIC0gRGF0YWJhc2UgY29ubmVjdGlvbi5cbiAgICogQHBhcmFtIHsoKSA9PiBQcm9taXNlPFQ+fSBjYWxsYmFjayAtIFRyYW5zYWN0aW9uIGNhbGxiYWNrLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxUPn0gLSBDYWxsYmFjayByZXN1bHQuXG4gICAqL1xuICBhc3luYyBfdHJhbnNhY3Rpb25SZXN1bHQoZGIsIGNhbGxiYWNrKSB7XG4gICAgbGV0IGNvbXBsZXRlZCA9IGZhbHNlXG4gICAgLyoqIEB0eXBlIHtUIHwgdW5kZWZpbmVkfSAqL1xuICAgIGxldCByZXN1bHRcbiAgICBhd2FpdCBkYi50cmFuc2FjdGlvbihhc3luYyAoKSA9PiB7XG4gICAgICByZXN1bHQgPSBhd2FpdCBjYWxsYmFjaygpXG4gICAgICBjb21wbGV0ZWQgPSB0cnVlXG4gICAgfSlcbiAgICBpZiAoIWNvbXBsZXRlZCkgdGhyb3cgbmV3IEVycm9yKFwiQmFja2dyb3VuZCBqb2JzIHRyYW5zYWN0aW9uIGNhbGxiYWNrIHdhcyBub3QgaW52b2tlZFwiKVxuICAgIHJldHVybiAvKiogQHR5cGUge1R9ICovIChyZXN1bHQpXG4gIH1cblxuICAvKipcbiAgICogU2VyaWFsaXplcyBjb3VudC1jaGFuZ2luZyB0cmFuc2FjdGlvbnMgYmVmb3JlIGNoZWNraW5nIG91dCB0aGVpciBjb25uZWN0aW9uLlxuICAgKiBEYXRhYmFzZSByb3cgbG9ja2luZyBzdGlsbCBwcm92aWRlcyBjcm9zcy1wcm9jZXNzIG9yZGVyaW5nOyB0aGlzIGd1YXJkXG4gICAqIHByZXZlbnRzIGNvbmN1cnJlbnQgY2FsbGVycyBvbiBTUUxpdGUncyBzaGFyZWQgY29ubmVjdGlvbiBmcm9tIGF0dGVtcHRpbmdcbiAgICogb3ZlcmxhcHBpbmcgdG9wLWxldmVsIHRyYW5zYWN0aW9ucy5cbiAgICogQHRlbXBsYXRlIFRcbiAgICogQHBhcmFtIHsoZGI6IGltcG9ydChcIi4uL2RhdGFiYXNlL2RyaXZlcnMvYmFzZS5qc1wiKS5kZWZhdWx0KSA9PiBQcm9taXNlPFQ+fSBjYWxsYmFjayAtIFRyYW5zYWN0aW9uIGNhbGxiYWNrLlxuICAgKiBAcGFyYW0ge0JhY2tncm91bmRKb2JUcmFuc2FjdGlvblNlcmlhbGl6YXRpb25PcHRpb25zfSBbb3B0aW9uc10gLSBTZXJpYWxpemF0aW9uIG9wdGlvbnMuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPFQ+fSBDYWxsYmFjayByZXN1bHQuXG4gICAqL1xuICBhc3luYyBfc2VyaWFsaXplZENvdW50TXV0YXRpb24oY2FsbGJhY2ssIG9wdGlvbnMgPSB7fSkge1xuICAgIHJldHVybiBhd2FpdCB0aGlzLl9zZXJpYWxpemVkVHJhbnNhY3Rpb25NdXRhdGlvbihhc3luYyAoZGIpID0+IHtcbiAgICAgIGF3YWl0IHRoaXMuX2xvY2tDb3VudFJldmlzaW9uKGRiKVxuXG4gICAgICByZXR1cm4gYXdhaXQgY2FsbGJhY2soZGIpXG4gICAgfSwgb3B0aW9ucylcbiAgfVxuXG4gIC8qKlxuICAgKiBBZG1pdHMgdHJhbnNhY3Rpb25zIHRvIHRoZSBwcm9jZXNzLWxvY2FsIEZJRk8gYmVmb3JlIHRoZXkgY2hlY2sgb3V0IGFcbiAgICogY29ubmVjdGlvbi4gQ3Jvc3MtcHJvY2VzcyBvcmRlcmluZyByZW1haW5zIHRoZSByZXNwb25zaWJpbGl0eSBvZiBkdXJhYmxlXG4gICAqIHJvdy9hZHZpc29yeSBsb2NrcyBhbmQgdW5pcXVlIGNvbnN0cmFpbnRzIGFjcXVpcmVkIGFyb3VuZCB0aGUgY2FsbGJhY2suXG4gICAqIEB0ZW1wbGF0ZSBUXG4gICAqIEBwYXJhbSB7KGRiOiBpbXBvcnQoXCIuLi9kYXRhYmFzZS9kcml2ZXJzL2Jhc2UuanNcIikuZGVmYXVsdCkgPT4gUHJvbWlzZTxUPn0gY2FsbGJhY2sgLSBUcmFuc2FjdGlvbiBjYWxsYmFjay5cbiAgICogQHBhcmFtIHtCYWNrZ3JvdW5kSm9iVHJhbnNhY3Rpb25TZXJpYWxpemF0aW9uT3B0aW9uc30gW29wdGlvbnNdIC0gU2VyaWFsaXphdGlvbiBvcHRpb25zLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxUPn0gQ2FsbGJhY2sgcmVzdWx0LlxuICAgKi9cbiAgYXN5bmMgX3NlcmlhbGl6ZWRUcmFuc2FjdGlvbk11dGF0aW9uKGNhbGxiYWNrLCBvcHRpb25zID0ge30pIHtcbiAgICBjb25zdCBpZGVudGlmaWVyID0gdGhpcy5nZXREYXRhYmFzZUlkZW50aWZpZXIoKSB8fCBcImRlZmF1bHRcIlxuICAgIGNvbnN0IHByZXZpb3VzID0gdHJhbnNhY3Rpb25NdXRhdGlvbkNoYWlucy5nZXQoaWRlbnRpZmllcikgfHwgUHJvbWlzZS5yZXNvbHZlKClcbiAgICBsZXQgcmVzb2x2ZVJ1biA9ICgpID0+IHt9XG4gICAgLyoqIEB0eXBlIHtQcm9taXNlPHZvaWQ+fSAqL1xuICAgIGNvbnN0IHJ1biA9IG5ldyBQcm9taXNlKChyZXNvbHZlKSA9PiB7XG4gICAgICByZXNvbHZlUnVuID0gKCkgPT4gcmVzb2x2ZSh1bmRlZmluZWQpXG4gICAgfSlcbiAgICBjb25zdCBjaGFpbiA9IHByZXZpb3VzLnRoZW4oKCkgPT4gcnVuKVxuXG4gICAgdHJhbnNhY3Rpb25NdXRhdGlvbkNoYWlucy5zZXQoaWRlbnRpZmllciwgY2hhaW4pXG4gICAgYXdhaXQgcHJldmlvdXNcblxuICAgIHRyeSB7XG4gICAgICByZXR1cm4gYXdhaXQgdGhpcy5fd2l0aERiKGFzeW5jIChkYikgPT4ge1xuICAgICAgICBjb25zdCB7YWR2aXNvcnlMb2NrfSA9IG9wdGlvbnNcblxuICAgICAgICBpZiAoYWR2aXNvcnlMb2NrKSB7XG4gICAgICAgICAgY29uc3QgYWNxdWlyZWQgPSBhd2FpdCBkYi5hY3F1aXJlQWR2aXNvcnlMb2NrKGFkdmlzb3J5TG9jay5uYW1lKVxuXG4gICAgICAgICAgaWYgKCFhY3F1aXJlZCkgdGhyb3cgbmV3IEVycm9yKGFkdmlzb3J5TG9jay5mYWlsdXJlTWVzc2FnZSlcbiAgICAgICAgfVxuXG4gICAgICAgIHRyeSB7XG4gICAgICAgICAgcmV0dXJuIGF3YWl0IHRoaXMuX3RyYW5zYWN0aW9uUmVzdWx0KGRiLCBhc3luYyAoKSA9PiBhd2FpdCBjYWxsYmFjayhkYikpXG4gICAgICAgIH0gZmluYWxseSB7XG4gICAgICAgICAgaWYgKGFkdmlzb3J5TG9jaykgYXdhaXQgZGIucmVsZWFzZUFkdmlzb3J5TG9jayhhZHZpc29yeUxvY2submFtZSlcbiAgICAgICAgfVxuICAgICAgfSlcbiAgICB9IGZpbmFsbHkge1xuICAgICAgcmVzb2x2ZVJ1bigpXG4gICAgICBpZiAodHJhbnNhY3Rpb25NdXRhdGlvbkNoYWlucy5nZXQoaWRlbnRpZmllcikgPT09IGNoYWluKSB0cmFuc2FjdGlvbk11dGF0aW9uQ2hhaW5zLmRlbGV0ZShpZGVudGlmaWVyKVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHNob3VsZCBhY2NlcHQgcmVwb3J0LlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIE9wdGlvbnMuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi90eXBlcy5qc1wiKS5CYWNrZ3JvdW5kSm9iUm93fSBhcmdzLmpvYiAtIEpvYiByb3cuXG4gICAqIEBwYXJhbSB7c3RyaW5nIHwgbnVsbCB8IHVuZGVmaW5lZH0gYXJncy5oYW5kb2ZmSWQgLSBIYW5kb2ZmIGxlYXNlIGlkIGZyb20gcmVwb3J0LlxuICAgKiBAcGFyYW0ge3N0cmluZyB8IG51bGwgfCB1bmRlZmluZWR9IGFyZ3Mud29ya2VySWQgLSBXb3JrZXIgaWQgZnJvbSByZXBvcnQuXG4gICAqIEBwYXJhbSB7bnVtYmVyIHwgbnVsbCB8IHVuZGVmaW5lZH0gYXJncy5oYW5kZWRPZmZBdE1zIC0gSGFuZGVkIG9mZiB0aW1lc3RhbXAgZnJvbSByZXBvcnQuXG4gICAqIEByZXR1cm5zIHtib29sZWFufSAtIFdoZXRoZXIgdG8gYWNjZXB0IHRoZSByZXBvcnQuXG4gICAqL1xuICBfc2hvdWxkQWNjZXB0UmVwb3J0KHtqb2IsIGhhbmRvZmZJZCwgd29ya2VySWQsIGhhbmRlZE9mZkF0TXN9KSB7XG4gICAgaWYgKGpvYi5zdGF0dXMgIT09IFwiaGFuZGVkX29mZlwiKSByZXR1cm4gZmFsc2VcblxuICAgIHJldHVybiB0aGlzLl9oYW5kb2ZmSWRSZXBvcnRNYXRjaGVzKHtoYW5kb2ZmSWQsIGpvYn0pXG4gICAgICAmJiB0aGlzLl93b3JrZXJSZXBvcnRNYXRjaGVzKHtqb2IsIHdvcmtlcklkfSlcbiAgICAgICYmIHRoaXMuX2hhbmRvZmZSZXBvcnRNYXRjaGVzKHtoYW5kZWRPZmZBdE1zLCBqb2J9KVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgYWN0aXZlIGhhbmRvZmYgY29uZGl0aW9ucy5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL3R5cGVzLmpzXCIpLkJhY2tncm91bmRKb2JSb3d9IGpvYiAtIEpvYiByb3cuXG4gICAqIEByZXR1cm5zIHtSZWNvcmQ8c3RyaW5nLCBzdHJpbmcgfCBudWxsPn0gLSBDb25kaXRpb25hbCB0cmFuc2l0aW9uIGZlbmNlLlxuICAgKi9cbiAgX2FjdGl2ZUhhbmRvZmZDb25kaXRpb25zKGpvYikge1xuICAgIHJldHVybiB7aGFuZG9mZl9pZDogam9iLmhhbmRvZmZJZCwgaWQ6IGpvYi5pZCwgc3RhdHVzOiBcImhhbmRlZF9vZmZcIn1cbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGhhbmRvZmYgaWQgcmVwb3J0IG1hdGNoZXMuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gT3B0aW9ucy5cbiAgICogQHBhcmFtIHtzdHJpbmcgfCBudWxsIHwgdW5kZWZpbmVkfSBhcmdzLmhhbmRvZmZJZCAtIEhhbmRvZmYgbGVhc2UgaWQgZnJvbSByZXBvcnQuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi90eXBlcy5qc1wiKS5CYWNrZ3JvdW5kSm9iUm93fSBhcmdzLmpvYiAtIEpvYiByb3cuXG4gICAqIEByZXR1cm5zIHtib29sZWFufSAtIFdoZXRoZXIgdGhlIGhhbmRvZmYgbGVhc2UgbWF0Y2hlcy5cbiAgICovXG4gIF9oYW5kb2ZmSWRSZXBvcnRNYXRjaGVzKHtoYW5kb2ZmSWQsIGpvYn0pIHtcbiAgICBpZiAoIWpvYi5oYW5kb2ZmSWQpIHJldHVybiB0cnVlXG5cbiAgICByZXR1cm4gaGFuZG9mZklkID09PSBqb2IuaGFuZG9mZklkXG4gIH1cblxuICAvKipcbiAgICogUnVucyB3b3JrZXIgcmVwb3J0IG1hdGNoZXMuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gT3B0aW9ucy5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL3R5cGVzLmpzXCIpLkJhY2tncm91bmRKb2JSb3d9IGFyZ3Muam9iIC0gSm9iIHJvdy5cbiAgICogQHBhcmFtIHtzdHJpbmcgfCBudWxsIHwgdW5kZWZpbmVkfSBhcmdzLndvcmtlcklkIC0gV29ya2VyIGlkIGZyb20gcmVwb3J0LlxuICAgKiBAcmV0dXJucyB7Ym9vbGVhbn0gLSBXaGV0aGVyIHRoZSB3b3JrZXIgcmVwb3J0IG1hdGNoZXMuXG4gICAqL1xuICBfd29ya2VyUmVwb3J0TWF0Y2hlcyh7am9iLCB3b3JrZXJJZH0pIHtcbiAgICBpZiAoIXdvcmtlcklkKSByZXR1cm4gdHJ1ZVxuICAgIGlmICgham9iLndvcmtlcklkKSByZXR1cm4gdHJ1ZVxuXG4gICAgcmV0dXJuIHdvcmtlcklkID09PSBqb2Iud29ya2VySWRcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGhhbmRvZmYgcmVwb3J0IG1hdGNoZXMuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gT3B0aW9ucy5cbiAgICogQHBhcmFtIHtudW1iZXIgfCBudWxsIHwgdW5kZWZpbmVkfSBhcmdzLmhhbmRlZE9mZkF0TXMgLSBIYW5kZWQgb2ZmIHRpbWVzdGFtcCBmcm9tIHJlcG9ydC5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL3R5cGVzLmpzXCIpLkJhY2tncm91bmRKb2JSb3d9IGFyZ3Muam9iIC0gSm9iIHJvdy5cbiAgICogQHJldHVybnMge2Jvb2xlYW59IC0gV2hldGhlciB0aGUgaGFuZG9mZiByZXBvcnQgbWF0Y2hlcy5cbiAgICovXG4gIF9oYW5kb2ZmUmVwb3J0TWF0Y2hlcyh7aGFuZGVkT2ZmQXRNcywgam9ifSkge1xuICAgIGlmICghaGFuZGVkT2ZmQXRNcykgcmV0dXJuIHRydWVcbiAgICBpZiAoIWpvYi5oYW5kZWRPZmZBdE1zKSByZXR1cm4gdHJ1ZVxuXG4gICAgcmV0dXJuIGhhbmRlZE9mZkF0TXMgPT09IGpvYi5oYW5kZWRPZmZBdE1zXG4gIH1cblxuICAvKipcbiAgICogUnVucyBtaWdyYXRpb24ga2V5LlxuICAgKiBAcGFyYW0ge3N0cmluZ30gW3ZlcnNpb25dIC0gTWlncmF0aW9uIHZlcnNpb24uXG4gICAqIEByZXR1cm5zIHtzdHJpbmd9IC0gTWlncmF0aW9uIGtleS5cbiAgICovXG4gIF9taWdyYXRpb25LZXkodmVyc2lvbiA9IE1JR1JBVElPTl9WRVJTSU9OKSB7XG4gICAgcmV0dXJuIGAke01JR1JBVElPTl9TQ09QRX06JHt2ZXJzaW9ufWBcbiAgfVxufVxuIl19