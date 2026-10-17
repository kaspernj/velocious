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
import { BACKGROUND_JOB_TERMINAL_STATUSES, BACKGROUND_JOB_EXECUTION_MODES, DEFAULT_BACKGROUND_JOB_EXECUTION_MODE, DEFAULT_BACKGROUND_JOB_QUEUE, QUEUE_CONCURRENCY_KEY_PREFIX, normalizeBackgroundJobConcurrency, normalizeBackgroundJobExecutionMode, normalizeBackgroundJobMaxRetries, normalizeBackgroundJobQueue, normalizeBackgroundJobScheduleKey, normalizeBackgroundJobScheduledAtMs, normalizeBackgroundJobStatus, rescheduledBackgroundJobAtMs, retryDelayMs } from "./job-semantics.js";
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
 * BackgroundJobPruneCandidateMetadata type. Immutable metadata for one selected
 * retention candidate batch, exposed to the optional prune barrier hook.
 * @typedef {object} BackgroundJobPruneCandidateMetadata
 * @property {Readonly<Array<string>>} candidates - Job ids selected for this batch.
 * @property {string} status - Terminal status the candidates were selected by.
 * @property {string} column - Terminal timestamp column compared against the cutoff.
 * @property {number} cutoff - Cutoff timestamp the candidates were selected against.
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
const SCHEDULE_ORDER_WATERMARKS_TABLE = "background_job_schedule_order_watermarks";
const SCHEDULE_ORDER_WATERMARK_MIGRATION_VERSION = "20260911120000";
const SCHEDULE_HISTORY_ORDER_INDEX = "index_background_jobs_schedule_history_order";
// Composite retention indexes bound the terminal-status discovery scan to the expired
// (status, terminal_timestamp) range, so retention candidate pages stay cheap on
// multi-million-row tables. Activation was staged separately from the lock-scope fix
// because MariaDB online index DDL makes concurrent metadata inspection fail with
// ER_WARN_I_S_SKIPPED_TABLE; the driver now outlasts that skip with a bounded retry.
const RETENTION_INDEX_MIGRATION_VERSION = "20261012120000";
const RETENTION_INDEX_DEFINITIONS = [
    { columns: ["status", "completed_at_ms", "id"], name: "index_background_jobs_completed_retention" },
    { columns: ["status", "failed_at_ms", "id"], name: "index_background_jobs_failed_retention" },
    { columns: ["status", "orphaned_at_ms", "id"], name: "index_background_jobs_orphaned_retention" }
];
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
     * @param {{now: () => number}} [args.clock] - Injectable persistence clock.
     * @param {(producerProof: import("./types.js").BackgroundJobProducerProof) => void | Promise<void>} [args.afterOwnedProducerValidation] - Exact owned-enqueue validation hook.
     * @param {(metadata: BackgroundJobPruneCandidateMetadata) => void | Promise<void>} [args.afterPruneCandidatesSelected] - Optional barrier invoked after one retention batch's candidate discovery and before its serialized delete transaction.
     */
    constructor({ configuration, databaseIdentifier, clock, afterOwnedProducerValidation, afterPruneCandidatesSelected }) {
        super();
        this.configuration = configuration;
        this.databaseIdentifier = databaseIdentifier;
        this.clock = clock || { now: () => Date.now() };
        this.afterOwnedProducerValidation = afterOwnedProducerValidation;
        this.afterPruneCandidatesSelected = afterPruneCandidatesSelected;
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
        const result = await this._serializedConnectionMutation(async (db) => await this._reconcileConcurrency(db), {
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
                const duplicateJobId = await this._deduplicatedQueuedJobId(db, preparedJob);
                if (duplicateJobId) {
                    resultJobId = duplicateJobId;
                    return;
                }
            }
            await this._insertPreparedJob(db, { preparedJob, scheduleKey: null });
            await this._recordCountDelta(db, { all: 1, queued: 1 });
        });
        return resultJobId;
    }
    /**
     * Atomically validates an exact producing handoff and enqueues its follow-up.
     * Every exact request owns an internal durable replay identity, while queued
     * deduplication can point several distinct producer events at one covering row.
     * @param {object} args - Owned enqueue request.
     * @param {string} args.jobName - Job name.
     * @param {Array<ReturnType<typeof JSON.parse>>} args.args - Arguments.
     * @param {import("./types.js").BackgroundJobOptions} [args.options] - Options.
     * @param {string} [args.producerInvocationId] - Stable identity for one owned enqueue invocation.
     * @param {import("./types.js").BackgroundJobProducerProof} args.producerProof - Exact producer lease.
     * @returns {Promise<string>} - Durable follow-up id.
     */
    async enqueueFromOwnedHandoff({ jobName, args, options, producerInvocationId, producerProof }) {
        await this.ensureReady();
        const normalizedProducerProof = this._normalizeProducerProof(producerProof);
        const normalizedProducerInvocationId = this._normalizeProducerInvocationId(producerInvocationId);
        const preparedJob = this._prepareJob({ jobName, args, options });
        return await this._serializedCountMutation(async (db) => {
            await this._validateOwnedProducerProof(db, normalizedProducerProof);
            if (this.afterOwnedProducerValidation)
                await this.afterOwnedProducerValidation(normalizedProducerProof);
            if (options?.idempotencyKey !== undefined) {
                return await this._enqueueIdempotentlyInTransaction({
                    args: args || [],
                    countRevisionLocked: true,
                    db,
                    options,
                    preparedJob
                });
            }
            return await this._enqueueOwnedReplayInTransaction({
                db,
                options: options || {},
                preparedJob,
                producerInvocationId: normalizedProducerInvocationId,
                producerProof: normalizedProducerProof
            });
        });
    }
    /**
     * Finds the earliest queued job that covers this enqueue's identity and time.
     * @param {import("../database/drivers/base.js").default} db - Transaction connection.
     * @param {PreparedBackgroundJob} preparedJob - Normalized job.
     * @returns {Promise<string | null>} - Covering job id.
     */
    async _deduplicatedQueuedJobId(db, preparedJob) {
        // Dedupe on the job's identity (name + args + queue), NOT its concurrency key, so a job
        // keeps whatever concurrency it resolves to. Only an existing job scheduled no later than
        // this enqueue can cover it; a retry backed off into the future must not suppress earlier
        // work. Ordering returns the earliest covering job when several queued rows already exist.
        const existing = await db
            .newQuery()
            .from(JOBS_TABLE)
            .select("id")
            .where({ status: "queued", job_name: preparedJob.jobName, args_json: preparedJob.argsJson, queue: preparedJob.queue })
            .where(`scheduled_at_ms <= ${db.quote(preparedJob.scheduledAtMs)}`)
            .order("scheduled_at_ms ASC")
            .limit(1)
            .results();
        const row = existing[0];
        return row ? String(/** @type {Record<string, ReturnType<typeof JSON.parse>>} */ (row).id) : null;
    }
    /**
     * Persists one internal exact-replay owner and its queued job in the caller's
     * producer-validation transaction.
     * @param {object} args - Transaction input.
     * @param {import("../database/drivers/base.js").default} args.db - Transaction connection.
     * @param {import("./types.js").BackgroundJobOptions} args.options - Enqueue options.
     * @param {PreparedBackgroundJob} args.preparedJob - Normalized job.
     * @param {string} args.producerInvocationId - Stable identity for one owned enqueue invocation.
     * @param {import("./types.js").BackgroundJobProducerProof} args.producerProof - Exact producer lease.
     * @returns {Promise<string>} - Stable replay job id.
     */
    async _enqueueOwnedReplayInTransaction({ db, options, preparedJob, producerInvocationId, producerProof }) {
        const requestDigest = this._ownedEnqueueRequestDigest({ options, preparedJob });
        const scopeDigest = this._ownedEnqueueScopeDigest({ preparedJob, producerInvocationId, producerProof, requestDigest });
        const idempotencyKey = `owned-handoff:${scopeDigest}`;
        const existing = await this._idempotencyOwnership(db, scopeDigest);
        const baseOwnership = {
            created_at_ms: preparedJob.createdAtMs,
            idempotency_key: idempotencyKey,
            job_name: preparedJob.jobName,
            queue: preparedJob.queue,
            request_digest: requestDigest,
            scope_digest: scopeDigest
        };
        if (existing) {
            this._validateIdempotencyOwnership({ existing, ownership: { ...baseOwnership, job_id: String(existing.job_id) } });
            return String(existing.job_id);
        }
        const duplicateJobId = options.deduplicateWhileQueued
            ? await this._deduplicatedQueuedJobId(db, preparedJob)
            : null;
        const ownership = { ...baseOwnership, job_id: duplicateJobId || preparedJob.jobId };
        const claimed = await this._claimIdempotencyOwnership(db, ownership);
        if (!claimed.created) {
            this._validateIdempotencyOwnership({ existing: claimed.row, ownership });
            return String(claimed.row.job_id);
        }
        if (duplicateJobId)
            return duplicateJobId;
        await this._insertPreparedJob(db, { preparedJob, scheduleKey: null });
        await this._recordCountDelta(db, { all: 1, queued: 1 });
        return preparedJob.jobId;
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
        // Reuse ordinary enqueue transaction admission because this path changes
        // the same durable count revision. The scope primary key remains the
        // cross-process convergence owner.
        return await this._idempotentEnqueueTransaction(async (db) => {
            return await this._enqueueIdempotentlyInTransaction({ args, db, options, preparedJob });
        });
    }
    /**
     * Owns or replays one public idempotency key inside the caller's transaction.
     * @param {object} args - Transaction input.
     * @param {Array<ReturnType<typeof JSON.parse>>} args.args - Job arguments.
     * @param {boolean} [args.countRevisionLocked] - Whether the caller already owns count serialization.
     * @param {import("../database/drivers/base.js").default} args.db - Transaction connection.
     * @param {import("./types.js").BackgroundJobOptions} args.options - Job options.
     * @param {PreparedBackgroundJob} args.preparedJob - Normalized job.
     * @returns {Promise<string>} - Stable original job id.
     */
    async _enqueueIdempotentlyInTransaction({ args, countRevisionLocked = false, db, options, preparedJob }) {
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
        if (!countRevisionLocked)
            await this._lockCountRevision(db);
        await this._insertPreparedJob(db, { preparedJob, scheduleKey: null });
        await this._persistMailDeliveryOperation(db, { jobId: preparedJob.jobId, mailOperationInput, createdAtMs: preparedJob.createdAtMs });
        await this._recordCountDelta(db, { all: 1, queued: 1 });
        return preparedJob.jobId;
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
     * Canonical request identity for an internal owned-handoff replay.
     * Immediate enqueue wall time and generated job ids remain excluded.
     * @param {object} args - Digest input.
     * @param {import("./types.js").BackgroundJobOptions} args.options - Enqueue options.
     * @param {PreparedBackgroundJob} args.preparedJob - Normalized job.
     * @returns {string} - SHA-256 digest.
     */
    _ownedEnqueueRequestDigest({ options, preparedJob }) {
        const serialized = stableJsonStringify({
            argsJson: preparedJob.argsJson,
            concurrency: preparedJob.concurrency,
            deduplicateWhileQueued: options.deduplicateWhileQueued === true,
            executionMode: preparedJob.executionMode,
            format: "velocious-background-job-owned-enqueue-v1",
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
     * Isolates internal producer replay ownership from caller idempotency scopes.
     * @param {object} args - Scope input.
     * @param {PreparedBackgroundJob} args.preparedJob - Normalized job.
     * @param {string} args.producerInvocationId - Stable identity for one owned enqueue invocation.
     * @param {import("./types.js").BackgroundJobProducerProof} args.producerProof - Exact producer lease.
     * @param {string} args.requestDigest - Canonical request digest.
     * @returns {string} - SHA-256 scope digest.
     */
    _ownedEnqueueScopeDigest({ preparedJob, producerInvocationId, producerProof, requestDigest }) {
        return createHash("sha256")
            .update(stableJsonStringify({
            format: "velocious-background-job-owned-enqueue-scope-v1",
            jobName: preparedJob.jobName,
            producerInvocationId,
            producerProof,
            queue: preparedJob.queue,
            requestDigest
        }))
            .digest("hex");
    }
    /**
     * Validates the untrusted identity of one producer-owned enqueue invocation.
     * @param {string | undefined} producerInvocationId - Producer invocation identity.
     * @returns {string} - Validated identity.
     */
    _normalizeProducerInvocationId(producerInvocationId) {
        if (typeof producerInvocationId !== "string" || producerInvocationId.length === 0) {
            throw VelociousError.safe("Background job producer invocation id is invalid.", {
                code: "background-job-producer-invocation-id-invalid"
            });
        }
        return producerInvocationId;
    }
    /**
     * Validates the untrusted transport shape before transaction admission.
     * @param {import("./types.js").BackgroundJobProducerProof} producerProof - Producer proof.
     * @returns {import("./types.js").BackgroundJobProducerProof} - Normalized immutable proof.
     */
    _normalizeProducerProof(producerProof) {
        const exactKeys = ["handedOffAtMs", "handoffId", "jobId", "workerId"];
        const keys = producerProof && typeof producerProof === "object" ? Object.keys(producerProof) : [];
        const valid = producerProof
            && typeof producerProof === "object"
            && keys.length === exactKeys.length
            && keys.every((key) => exactKeys.includes(key))
            && typeof producerProof.jobId === "string"
            && producerProof.jobId.length > 0
            && typeof producerProof.handoffId === "string"
            && producerProof.handoffId.length > 0
            && typeof producerProof.workerId === "string"
            && producerProof.workerId.length > 0
            && Number.isSafeInteger(producerProof.handedOffAtMs)
            && producerProof.handedOffAtMs >= 0;
        if (!valid) {
            throw VelociousError.safe("Background job producer proof is invalid.", {
                code: "background-job-producer-proof-invalid"
            });
        }
        return Object.freeze({
            handedOffAtMs: producerProof.handedOffAtMs,
            handoffId: producerProof.handoffId,
            jobId: producerProof.jobId,
            workerId: producerProof.workerId
        });
    }
    /**
     * Confirms exact active ownership while the enqueue transaction holds the
     * shared mutation fence used by terminal producer transitions.
     * @param {import("../database/drivers/base.js").default} db - Transaction connection.
     * @param {import("./types.js").BackgroundJobProducerProof} producerProof - Exact producer lease.
     * @returns {Promise<void>} - Resolves while ownership remains exact.
     */
    async _validateOwnedProducerProof(db, producerProof) {
        const producer = await this._getJobRowById(db, producerProof.jobId);
        const owned = producer
            && producer.status === "handed_off"
            && producer.handoffId === producerProof.handoffId
            && producer.workerId === producerProof.workerId
            && producer.handedOffAtMs === producerProof.handedOffAtMs;
        if (!owned) {
            throw VelociousError.safe("Background job producer handoff is no longer owned.", {
                code: "background-job-producer-handoff-not-owned"
            });
        }
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
            const scheduleOrder = await this._nextScheduleOrder(db, normalizedScheduleKey);
            await this._insertPreparedJob(db, { preparedJob, scheduleKey: normalizedScheduleKey, scheduleOrder });
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
     * Reads stable ownership and optional latest terminal history in one fenced transaction.
     * @param {string} scheduleKey - Stable logical schedule key.
     * @param {{includeLatestTerminal?: boolean}} [options] - Lookup options.
     * @returns {Promise<import("./types.js").BackgroundJobScheduledLookupResult>} - Normalized public jobs.
     */
    async getScheduledJob(scheduleKey, { includeLatestTerminal = false } = {}) {
        await this.ensureReady();
        const normalizedScheduleKey = this._normalizeScheduleKey(scheduleKey);
        if (typeof includeLatestTerminal !== "boolean") {
            throw VelociousError.safe("background job includeLatestTerminal must be a boolean");
        }
        return await this._serializedCountMutation(async (db) => {
            return await this._scheduledJobLookup(db, {
                includeLatestTerminal,
                scheduleKey: normalizedScheduleKey
            });
        }, {
            advisoryLock: {
                failureMessage: "Failed to acquire background job schedule-key lock",
                name: this._scheduleKeyLockName(normalizedScheduleKey)
            }
        });
    }
    /**
     * Moves only a future queued stable owner to the current time.
     * @param {string} scheduleKey - Stable logical schedule key.
     * @returns {Promise<import("./types.js").BackgroundJobWakeResult>} - Exact wake outcome.
     */
    async wakeScheduled(scheduleKey) {
        await this.ensureReady();
        const normalizedScheduleKey = this._normalizeScheduleKey(scheduleKey);
        return await this._serializedCountMutation(async (db) => {
            const job = await this._scheduledOwnerJob(db, normalizedScheduleKey);
            if (!job || (job.status !== "queued" && job.status !== "handed_off"))
                return { jobId: null, outcome: "not_found" };
            if (job.status === "handed_off")
                return { jobId: job.id, outcome: "handed_off" };
            const nowMs = this.clock.now();
            if (Number(job.scheduledAtMs) <= nowMs)
                return { jobId: job.id, outcome: "already_due" };
            const affectedRows = await this._updateAffectedRows(db, {
                tableName: JOBS_TABLE,
                data: { scheduled_at_ms: nowMs },
                conditions: { id: job.id, scheduled_at_ms: job.scheduledAtMs, status: "queued" }
            });
            if (affectedRows === 1)
                return { jobId: job.id, outcome: "woken" };
            const currentJob = await this._scheduledOwnerJob(db, normalizedScheduleKey);
            if (currentJob?.status === "handed_off")
                return { jobId: currentJob.id, outcome: "handed_off" };
            if (currentJob?.status === "queued" && Number(currentJob.scheduledAtMs) <= nowMs) {
                return { jobId: currentJob.id, outcome: "already_due" };
            }
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
        const now = this.clock.now();
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
        const handedOffAtMs = this.clock.now();
        return await this._serializedCountMutation(async (db) => {
            const selectedJob = await this._getJobRowById(db, jobId);
            if (!selectedJob || selectedJob.status !== "queued")
                return null;
            const queuedJob = await this._reconcileQueuedJobConcurrency(db, selectedJob);
            if (!queuedJob)
                return null;
            if (queuedJob.concurrencyKey && !(await this._reserveConcurrency(db, queuedJob.concurrencyKey)))
                return null;
            const affectedRows = await this._updateAffectedRows(db, {
                tableName: JOBS_TABLE,
                data: {
                    status: "handed_off",
                    handed_off_at_ms: handedOffAtMs,
                    handoff_id: handoffId,
                    worker_id: workerId || null,
                    ...this._clearedChildAcceptanceData()
                },
                conditions: { concurrency_key: queuedJob.concurrencyKey, id: jobId, status: "queued" }
            });
            if (affectedRows !== 1) {
                await this._releaseConcurrency(db, queuedJob.concurrencyKey);
                return null;
            }
            await this._recordStatusTransition(db, "queued", "handed_off");
            /** @type {import("./types.js").BackgroundJobRow} */
            const handedOffJob = {
                ...queuedJob,
                ...this._clearedChildAcceptanceRow(),
                handedOffAtMs,
                handoffId,
                status: "handed_off",
                workerId: workerId || null
            };
            return { handedOffAtMs, handoffId, job: handedOffJob };
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
                    completed_at_ms: this.clock.now()
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
     * Records pooled-child acceptance evidence for an active handoff: when the
     * executing runner child received and/or started the job, plus that child's
     * stable identity and pid. Only the fields supplied are written, so a
     * received-then-started observation lands as two fenced partial updates. The
     * update is fenced by the exact active handoff lease, so a report for a
     * reclaimed or re-handed-off job is dropped instead of stamping the wrong
     * attempt.
     * @param {object} args - Options.
     * @param {string} args.jobId - Job id.
     * @param {string} [args.handoffId] - Handoff lease id.
     * @param {string} [args.workerId] - Worker id.
     * @param {number} [args.handedOffAtMs] - Handed off timestamp.
     * @param {number} [args.receivedAtMs] - Epoch ms the runner child received the job.
     * @param {number} [args.startedAtMs] - Epoch ms the job's perform started in the child.
     * @param {string} [args.childInstanceId] - Stable pooled child identity.
     * @param {number} [args.childPid] - Pooled child OS pid.
     * @param {string} [args.runnerHostname] - Hostname of the machine running the pooled child.
     * @returns {Promise<boolean>} - Whether the fenced report was accepted.
     */
    async markChildAccepted({ jobId, handoffId, workerId, handedOffAtMs, receivedAtMs, startedAtMs, childInstanceId, childPid, runnerHostname }) {
        await this.ensureReady();
        return await this._serializedConnectionMutation(async (db) => {
            const job = await this._getJobRowById(db, jobId);
            if (!job)
                return false;
            if (!this._shouldAcceptReport({ job, handoffId, workerId, handedOffAtMs }))
                return false;
            const data = {};
            if (typeof receivedAtMs === "number")
                data.child_received_at_ms = receivedAtMs;
            if (typeof startedAtMs === "number")
                data.child_started_at_ms = startedAtMs;
            if (typeof childInstanceId === "string")
                data.child_instance_id = childInstanceId;
            if (typeof childPid === "number")
                data.child_pid = childPid;
            if (typeof runnerHostname === "string")
                data.runner_hostname = runnerHostname;
            if (Object.keys(data).length === 0)
                return false;
            const affectedRows = await this._updateAffectedRows(db, {
                tableName: JOBS_TABLE,
                data,
                conditions: this._activeHandoffConditions(job)
            });
            return affectedRows === 1;
        });
    }
    /**
     * Returns the database data that clears pooled-child acceptance evidence.
     * @returns {Record<string, ReturnType<typeof JSON.parse>>} - Cleared acceptance columns.
     */
    _clearedChildAcceptanceData() {
        return { child_instance_id: null, child_pid: null, child_received_at_ms: null, child_started_at_ms: null, runner_hostname: null };
    }
    /**
     * Returns the row-shape counterpart of the cleared acceptance columns.
     * @returns {Pick<import("./types.js").BackgroundJobRow, "childInstanceId" | "childPid" | "childReceivedAtMs" | "childStartedAtMs" | "runnerHostname">} - Cleared acceptance fields.
     */
    _clearedChildAcceptanceRow() {
        return { childInstanceId: null, childPid: null, childReceivedAtMs: null, childStartedAtMs: null, runnerHostname: null };
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
                    worker_id: null,
                    ...this._clearedChildAcceptanceData()
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
                    scheduled_at_ms: this.clock.now(),
                    handed_off_at_ms: null,
                    handoff_id: null,
                    worker_id: null,
                    ...this._clearedChildAcceptanceData()
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
            const cutoff = this.clock.now() - orphanedAfterMs;
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
        const now = this.clock.now();
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
     * until a candidate page returns fewer than `batchSize` rows. Candidate
     * discovery runs on a plain connection — never inside the serialized count
     * mutation — so a long scan cannot hold the count-revision lock and starve
     * enqueue acknowledgements; only the short delete transaction is serialized.
     * The delete revalidates status and cutoff for the selected ids, publishes
     * the delta from the actual affected-row count, and a page whose candidates
     * were already removed by a concurrent pruner still ends the pass only when
     * the page itself is short.
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
            const candidates = await this._withDb(async (db) => await db
                .newQuery()
                .from(JOBS_TABLE)
                .select("id")
                .where({ status })
                .where(`${db.quoteColumn(column)} <= ${db.quote(cutoff)}`)
                .order({ column, direction: "ASC" })
                .order({ column: "id", direction: "ASC" })
                .limit(batchSize)
                .results());
            if (candidates.length === 0)
                break;
            const candidateIds = Object.freeze(candidates.map((/** @type {Record<string, ReturnType<typeof JSON.parse>>} */ row) => String(row.id)));
            if (this.afterPruneCandidatesSelected) {
                await this.afterPruneCandidatesSelected(Object.freeze({
                    candidates: candidateIds,
                    column,
                    cutoff,
                    status
                }));
            }
            const removed = await this._serializedCountMutation(async (db) => {
                const ids = candidateIds.map((id) => db.quote(id)).join(", ");
                const removed = await db.affectedRows(`DELETE FROM ${db.quoteTable(JOBS_TABLE)} WHERE ${db.quoteColumn("id")} IN (${ids}) AND ${db.quoteColumn("status")} = ${db.quote(status)} AND ${db.quoteColumn(column)} <= ${db.quote(cutoff)}`);
                await this._recordCountDelta(db, { all: -removed, [status]: -removed });
                return removed;
            });
            deleted += removed;
            if (candidates.length < batchSize)
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
            if (await db.tableExists(SCHEDULE_ORDER_WATERMARKS_TABLE)) {
                const watermarkRows = await db
                    .newQuery()
                    .from(SCHEDULE_ORDER_WATERMARKS_TABLE)
                    .select("schedule_key")
                    .results();
                for (const watermarkRow of watermarkRows) {
                    await db.delete({
                        tableName: SCHEDULE_ORDER_WATERMARKS_TABLE,
                        conditions: {
                            schedule_key: String(/** @type {Record<string, ReturnType<typeof JSON.parse>>} */ (watermarkRow).schedule_key)
                        }
                    });
                }
            }
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
        const createdAtMs = this.clock.now();
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
     * @param {number | null} [args.scheduleOrder] - Monotonic stable ownership order.
     * @returns {Promise<void>} - Resolves after insertion.
     */
    async _insertPreparedJob(db, { preparedJob, scheduleKey, scheduleOrder = null }) {
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
                schedule_order: scheduleOrder,
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
        return rescheduledBackgroundJobAtMs(delayMs, this.clock.now());
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
        return normalizeBackgroundJobScheduleKey(scheduleKey);
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
            await this._ensureRetentionIndexesOnce(db);
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
        table.bigint("schedule_order", { null: true });
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
        table.bigint("child_received_at_ms", { null: true });
        table.bigint("child_started_at_ms", { null: true });
        table.string("child_instance_id", { null: true });
        table.integer("child_pid", { null: true });
        table.string("runner_hostname", { null: true });
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
        await this._ensureScheduleOrderColumn(db);
        await this._ensureScheduleOrderWatermarksTable(db);
        await this._ensureJobTimeoutColumn(db);
        await this._ensureChildAcceptanceColumns(db);
        await this._ensureJobsTableIndexesOnce(db);
        await this._ensureRetentionIndexesOnce(db);
    }
    /**
     * Idempotently adds the pooled-child acceptance evidence columns to existing
     * job tables. They record when the executing runner child received and
     * started a job plus that child's identity, so a handed-off job can be told
     * apart from one whose runner never picked it up.
     * @param {import("../database/drivers/base.js").default} db - Database connection.
     * @returns {Promise<void>} - Resolves when ensured.
     */
    async _ensureChildAcceptanceColumns(db) {
        const lockName = `${MIGRATION_SCOPE}:child_acceptance_columns`;
        const acquired = await db.acquireAdvisoryLock(lockName);
        if (!acquired)
            throw new Error("Failed to acquire background jobs child-acceptance schema lock");
        try {
            db.clearSchemaCache();
            const table = await db.getTableByNameOrFail(JOBS_TABLE);
            const tableData = new TableData(JOBS_TABLE);
            let added = false;
            if (!(await table.getColumnByName("child_received_at_ms"))) {
                tableData.bigint("child_received_at_ms", { null: true });
                added = true;
            }
            if (!(await table.getColumnByName("child_started_at_ms"))) {
                tableData.bigint("child_started_at_ms", { null: true });
                added = true;
            }
            if (!(await table.getColumnByName("child_instance_id"))) {
                tableData.string("child_instance_id", { null: true });
                added = true;
            }
            if (!(await table.getColumnByName("child_pid"))) {
                tableData.integer("child_pid", { null: true });
                added = true;
            }
            if (!(await table.getColumnByName("runner_hostname"))) {
                tableData.string("runner_hostname", { null: true });
                added = true;
            }
            if (added) {
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
     * Idempotently creates the ordered composite retention indexes. An index
     * with the expected name but a different column order is a manual-repair
     * situation and fails readiness loudly instead of being rebuilt or
     * re-recorded; the migration ledger is written only once every expected
     * index exists with its exact ordered columns.
     * @param {import("../database/drivers/base.js").default} db - Database connection.
     * @returns {Promise<void>} - Resolves when all retention indexes exist.
     */
    async _ensureRetentionIndexesOnce(db) {
        const migrationVersion = RETENTION_INDEX_MIGRATION_VERSION;
        const migrationKey = this._migrationKey(migrationVersion);
        if (await this._hasMigration(db, migrationVersion))
            return;
        const acquired = await db.acquireAdvisoryLock(migrationKey);
        if (!acquired)
            throw new Error("Failed to acquire background jobs retention index lock");
        try {
            if (await this._hasMigration(db, migrationVersion))
                return;
            db.clearSchemaCache();
            const table = await db.getTableByNameOrFail(JOBS_TABLE);
            const existingIndexColumns = new Map((await table.getIndexes()).map((index) => [index.getName(), index.getColumnNames()]));
            for (const { columns, name } of RETENTION_INDEX_DEFINITIONS) {
                const existingColumns = existingIndexColumns.get(name);
                if (existingColumns) {
                    if (existingColumns.join(",") === columns.join(","))
                        continue;
                    throw new Error(`Background jobs retention index ${name} exists with unexpected columns: ${existingColumns.join(",")}`);
                }
                for (const sql of await db.createIndexSQLs({ columns, ifNotExists: db.getType() === "sqlite", name, tableName: JOBS_TABLE })) {
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
     * Idempotently adds monotonic schedule ownership history and its lookup index.
     * Existing rows remain null and use the documented legacy fallback ordering.
     * @param {import("../database/drivers/base.js").default} db - Database connection.
     * @returns {Promise<void>} - Resolves when ensured.
     */
    async _ensureScheduleOrderColumn(db) {
        const lockName = `${MIGRATION_SCOPE}:schedule_order_column`;
        const acquired = await db.acquireAdvisoryLock(lockName);
        if (!acquired)
            throw new Error("Failed to acquire background jobs schedule-order schema lock");
        try {
            db.clearSchemaCache();
            let table = await db.getTableByNameOrFail(JOBS_TABLE);
            if (!(await table.getColumnByName("schedule_order"))) {
                const tableData = new TableData(JOBS_TABLE);
                tableData.bigint("schedule_order", { null: true });
                for (const sql of await db.alterTableSQLs(tableData))
                    await db.query(sql);
                db.clearSchemaCache();
                table = await db.getTableByNameOrFail(JOBS_TABLE);
            }
            const indexNames = new Set((await table.getIndexes()).map((index) => index.getName()));
            if (!indexNames.has(SCHEDULE_HISTORY_ORDER_INDEX)) {
                const sqls = await db.createIndexSQLs({
                    columns: ["schedule_key", "schedule_order", "created_at_ms", "id"],
                    ifNotExists: db.getType() === "sqlite",
                    name: SCHEDULE_HISTORY_ORDER_INDEX,
                    tableName: JOBS_TABLE
                });
                for (const sql of sqls)
                    await db.query(sql);
                db.clearSchemaCache();
            }
        }
        finally {
            await db.releaseAdvisoryLock(lockName);
        }
    }
    /**
     * Creates the retention-independent schedule-order high-water table and
     * initializes it from the greatest retained ordered row for every key.
     * Legacy rows whose order is null deliberately do not establish a watermark.
     * @param {import("../database/drivers/base.js").default} db - Database connection.
     * @returns {Promise<void>} - Resolves when ensured and backfilled.
     */
    async _ensureScheduleOrderWatermarksTable(db) {
        const migrationVersion = SCHEDULE_ORDER_WATERMARK_MIGRATION_VERSION;
        const migrationKey = this._migrationKey(migrationVersion);
        const tableExists = await db.tableExists(SCHEDULE_ORDER_WATERMARKS_TABLE);
        if (tableExists && await this._hasMigration(db, migrationVersion))
            return;
        const acquired = await db.acquireAdvisoryLock(migrationKey);
        if (!acquired)
            throw new Error("Failed to acquire background jobs schedule-order watermark schema lock");
        try {
            db.clearSchemaCache();
            const lockedTableExists = await db.tableExists(SCHEDULE_ORDER_WATERMARKS_TABLE);
            const alreadyApplied = await this._hasMigration(db, migrationVersion);
            if (!lockedTableExists) {
                const table = new TableData(SCHEDULE_ORDER_WATERMARKS_TABLE, { ifNotExists: true });
                table.string("schedule_key", { primaryKey: true });
                table.bigint("high_water_mark", { null: false });
                await db.createTable(table);
                db.clearSchemaCache();
            }
            // Rebuild a missing table even when its migration ledger survived. The
            // retained job rows are the only compatible source for that recovery;
            // once rows are pruned, normal schema durability protects the watermark.
            if (!lockedTableExists || !alreadyApplied)
                await this._backfillScheduleOrderWatermarks(db);
            if (!alreadyApplied)
                await this._recordMigration(db, migrationVersion);
        }
        finally {
            await db.releaseAdvisoryLock(migrationKey);
        }
    }
    /**
     * Backfills each key from its greatest retained non-legacy ownership order.
     * @param {import("../database/drivers/base.js").default} db - Database connection.
     * @returns {Promise<void>} - Resolves after all retained keys are represented.
     */
    async _backfillScheduleOrderWatermarks(db) {
        const keyRows = await db
            .newQuery()
            .from(JOBS_TABLE)
            .select("schedule_key")
            .whereNot({ schedule_key: null })
            .whereNot({ schedule_order: null })
            .distinct()
            .results();
        for (const keyRow of keyRows) {
            const scheduleKey = String(/** @type {Record<string, ReturnType<typeof JSON.parse>>} */ (keyRow).schedule_key);
            const retainedOrder = await this._greatestRetainedScheduleOrder(db, scheduleKey);
            const currentWatermark = await this._scheduleOrderWatermark(db, scheduleKey);
            if (retainedOrder === null)
                continue;
            if (currentWatermark !== null && currentWatermark >= retainedOrder)
                continue;
            await this._writeScheduleOrderWatermark(db, { scheduleKey, scheduleOrder: retainedOrder });
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
     * Reads the job currently named by one stable owner row.
     * @param {import("../database/drivers/base.js").default} db - Database connection.
     * @param {string} scheduleKey - Validated stable schedule key.
     * @returns {Promise<import("./types.js").BackgroundJobRow | null>} - Normalized owner job.
     */
    async _scheduledOwnerJob(db, scheduleKey) {
        const ownerRows = await db
            .newQuery()
            .from(SCHEDULE_KEYS_TABLE)
            .where({ schedule_key: scheduleKey })
            .limit(1)
            .results();
        const ownerRow = ownerRows[0];
        if (!ownerRow)
            return null;
        return await this._getJobRowById(db, String(ownerRow.job_id));
    }
    /**
     * Assigns the next ownership order while the caller holds the schedule-key
     * advisory lock and count-revision transaction fence. The independent
     * watermark survives both ownership release and terminal-history pruning.
     * @param {import("../database/drivers/base.js").default} db - Database connection.
     * @param {string} scheduleKey - Validated stable schedule key.
     * @returns {Promise<number>} - Next monotonic ownership order.
     */
    async _nextScheduleOrder(db, scheduleKey) {
        const durableOrder = await this._scheduleOrderWatermark(db, scheduleKey);
        const retainedOrder = await this._greatestRetainedScheduleOrder(db, scheduleKey);
        let currentOrder = durableOrder;
        if (retainedOrder !== null && (currentOrder === null || retainedOrder > currentOrder))
            currentOrder = retainedOrder;
        const nextOrder = currentOrder === null ? 1 : currentOrder + 1;
        if (!Number.isSafeInteger(nextOrder)) {
            throw new Error(`Background job schedule ownership order exhausted for ${scheduleKey}`);
        }
        await this._writeScheduleOrderWatermark(db, { scheduleKey, scheduleOrder: nextOrder });
        return nextOrder;
    }
    /**
     * Finds the greatest retained non-legacy ownership order for migration and
     * rolling-upgrade compatibility. It is never the sole durability boundary.
     * @param {import("../database/drivers/base.js").default} db - Database connection.
     * @param {string} scheduleKey - Validated stable schedule key.
     * @returns {Promise<number | null>} - Greatest retained order, or null.
     */
    async _greatestRetainedScheduleOrder(db, scheduleKey) {
        const rows = await db
            .newQuery()
            .from(JOBS_TABLE)
            .select("schedule_order")
            .where({ schedule_key: scheduleKey })
            .whereNot({ schedule_order: null })
            .order("schedule_order DESC")
            .limit(1)
            .results();
        const row = rows[0];
        if (!row)
            return null;
        return this._validatedScheduleOrder(
        /** @type {Record<string, ReturnType<typeof JSON.parse>>} */ (row).schedule_order);
    }
    /**
     * Reads and validates one retention-independent schedule-order watermark.
     * @param {import("../database/drivers/base.js").default} db - Database connection.
     * @param {string} scheduleKey - Validated stable schedule key.
     * @returns {Promise<number | null>} - Current watermark, or null before first ownership.
     */
    async _scheduleOrderWatermark(db, scheduleKey) {
        const rows = await db
            .newQuery()
            .from(SCHEDULE_ORDER_WATERMARKS_TABLE)
            .select("high_water_mark")
            .where({ schedule_key: scheduleKey })
            .limit(1)
            .results();
        const row = rows[0];
        if (!row)
            return null;
        return this._validatedScheduleOrder(
        /** @type {Record<string, ReturnType<typeof JSON.parse>>} */ (row).high_water_mark);
    }
    /**
     * Persists one schedule-order watermark without exposing it as a job row.
     * @param {import("../database/drivers/base.js").default} db - Database connection.
     * @param {object} args - Watermark identity and value.
     * @param {string} args.scheduleKey - Validated stable schedule key.
     * @param {number} args.scheduleOrder - Validated monotonic order.
     * @returns {Promise<void>} - Resolves after persistence.
     */
    async _writeScheduleOrderWatermark(db, { scheduleKey, scheduleOrder }) {
        await db.upsert({
            tableName: SCHEDULE_ORDER_WATERMARKS_TABLE,
            data: { high_water_mark: scheduleOrder, schedule_key: scheduleKey },
            conflictColumns: ["schedule_key"],
            updateColumns: ["high_water_mark"]
        });
    }
    /**
     * Validates an ownership order loaded from durable storage.
     * @param {ReturnType<typeof JSON.parse>} value - Stored order.
     * @returns {number} - Positive safe integer ownership order.
     */
    _validatedScheduleOrder(value) {
        const scheduleOrder = this._normalizeNumber(value);
        if (scheduleOrder === null || !Number.isSafeInteger(scheduleOrder) || scheduleOrder < 1) {
            throw new Error(`Invalid background job schedule ownership order: ${scheduleOrder}`);
        }
        return scheduleOrder;
    }
    /**
     * Builds a stable-schedule lookup exclusively from normalized job rows.
     * @param {import("../database/drivers/base.js").default} db - Database connection.
     * @param {object} args - Lookup options.
     * @param {boolean} args.includeLatestTerminal - Whether terminal history is requested.
     * @param {string} args.scheduleKey - Validated stable schedule key.
     * @returns {Promise<import("./types.js").BackgroundJobScheduledLookupResult>} - Normalized public jobs.
     */
    async _scheduledJobLookup(db, { includeLatestTerminal, scheduleKey }) {
        const ownerJob = await this._scheduledOwnerJob(db, scheduleKey);
        const currentJob = ownerJob && (ownerJob.status === "queued" || ownerJob.status === "handed_off") ? ownerJob : null;
        if (!includeLatestTerminal)
            return { currentJob, latestTerminalJob: null };
        const terminalStatuses = BACKGROUND_JOB_TERMINAL_STATUSES.map((status) => db.quote(status)).join(", ");
        const terminalRows = await db
            .newQuery()
            .from(JOBS_TABLE)
            .where({ schedule_key: scheduleKey })
            .where(`${db.quoteColumn("status")} IN (${terminalStatuses})`)
            .order(`CASE WHEN ${db.quoteColumn("schedule_order")} IS NULL THEN 0 ELSE 1 END DESC`)
            .order("schedule_order DESC")
            .order("created_at_ms DESC")
            .order("id DESC")
            .limit(1)
            .results();
        const latestTerminalJob = terminalRows[0] ? this._normalizeJobRow(terminalRows[0]) : null;
        return { currentJob, latestTerminalJob };
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
        const now = this.clock.now();
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
            ...(shouldRetry ? this._clearedChildAcceptanceRow() : {}),
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
        // A retry starts a fresh handoff with a possibly different runner, so the
        // previous child's acceptance evidence must not leak into the next attempt.
        // Terminal failures keep it as historical evidence for the lost attempt.
        if (shouldRetry)
            Object.assign(update, this._clearedChildAcceptanceData());
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
            scheduleOrder: this._normalizeNumber(row.schedule_order),
            status: normalizeBackgroundJobStatus(row.status ? String(row.status) : "queued"),
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
            timeoutMs: this._normalizeNumber(row.timeout_ms),
            childReceivedAtMs: this._normalizeNumber(row.child_received_at_ms),
            childStartedAtMs: this._normalizeNumber(row.child_started_at_ms),
            childInstanceId: row.child_instance_id ? String(row.child_instance_id) : null,
            childPid: this._normalizeNumber(row.child_pid),
            runnerHostname: row.runner_hostname ? String(row.runner_hostname) : null
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
     * Applies the active generation's queue policy immediately before handoff.
     * Explicit concurrency remains owned by the enqueue request.
     * @param {import("../database/drivers/base.js").default} db - Database connection.
     * @param {import("./types.js").BackgroundJobRow} job - Queued job snapshot.
     * @returns {Promise<import("./types.js").BackgroundJobRow | null>} - Reconciled job, or null when its queued-state fence lost.
     */
    async _reconcileQueuedJobConcurrency(db, job) {
        if (job.concurrencyKey && !job.concurrencyKey.startsWith(QUEUE_CONCURRENCY_KEY_PREFIX)) {
            return job;
        }
        const concurrency = this._resolveConcurrency({}, job.queue);
        /** @type {BackgroundJobQueuedConcurrency} */
        const current = concurrency
            ? { concurrencyKey: concurrency.concurrencyKey, maxConcurrency: concurrency.maxConcurrency }
            : { concurrencyKey: null, maxConcurrency: null };
        if (concurrency)
            await this._ensureQueueConcurrencyKey(db, concurrency);
        if (job.concurrencyKey === current.concurrencyKey && job.maxConcurrency === current.maxConcurrency)
            return job;
        const affectedRows = await this._updateAffectedRows(db, {
            tableName: JOBS_TABLE,
            data: {
                concurrency_key: current.concurrencyKey,
                max_concurrency: current.maxConcurrency
            },
            conditions: { concurrency_key: job.concurrencyKey, id: job.id, status: "queued" }
        });
        if (affectedRows !== 1)
            return null;
        return { ...job, concurrencyKey: current.concurrencyKey, maxConcurrency: current.maxConcurrency };
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
     * Runs a serialized callback inside one transaction.
     * @template T
     * @param {(db: import("../database/drivers/base.js").default) => Promise<T>} callback - Transaction callback.
     * @param {BackgroundJobTransactionSerializationOptions} [options] - Serialization options.
     * @returns {Promise<T>} Callback result.
     */
    async _serializedTransactionMutation(callback, options = {}) {
        return await this._serializedConnectionMutation(async (db) => await this._transactionResult(db, async () => await callback(db)), options);
    }
    /**
     * Admits mutation callbacks to the process-local FIFO before they check out a
     * connection. Cross-process ordering remains the responsibility of durable
     * row/advisory locks and unique constraints acquired around the callback.
     * @template T
     * @param {(db: import("../database/drivers/base.js").default) => Promise<T>} callback - Connection callback.
     * @param {BackgroundJobTransactionSerializationOptions} [options] - Serialization options.
     * @returns {Promise<T>} Callback result.
     */
    async _serializedConnectionMutation(callback, options = {}) {
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
                    return await callback(db);
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoic3RvcmUuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi9zcmMvYmFja2dyb3VuZC1qb2JzL3N0b3JlLmpzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiJBQUFBLFlBQVk7QUFFWixPQUFPLEVBQUMsVUFBVSxFQUFFLFVBQVUsRUFBQyxNQUFNLFFBQVEsQ0FBQTtBQUM3QyxPQUFPLHFCQUFxQixNQUFNLGNBQWMsQ0FBQTtBQUNoRCxPQUFPLE1BQU0sTUFBTSxjQUFjLENBQUE7QUFDakMsT0FBTyxTQUFTLE1BQU0saUNBQWlDLENBQUE7QUFDdkQsT0FBTyxjQUFjLE1BQU0sdUJBQXVCLENBQUE7QUFDbEQsT0FBTyxtQkFBbUIsTUFBTSxpQkFBaUIsQ0FBQTtBQUNqRCxPQUFPLDJCQUEyQixNQUFNLHNCQUFzQixDQUFBO0FBQzlELE9BQU8sRUFBRSxxQ0FBcUMsRUFBRSxNQUFNLHlEQUF5RCxDQUFBO0FBQy9HLE9BQU8sbUJBQW1CLE1BQU0seUJBQXlCLENBQUE7QUFDekQsT0FBTyxFQUNMLGdDQUFnQyxFQUNoQyw4QkFBOEIsRUFDOUIscUNBQXFDLEVBQ3JDLDRCQUE0QixFQUM1Qiw0QkFBNEIsRUFDNUIsaUNBQWlDLEVBQ2pDLG1DQUFtQyxFQUNuQyxnQ0FBZ0MsRUFDaEMsMkJBQTJCLEVBQzNCLGlDQUFpQyxFQUNqQyxtQ0FBbUMsRUFDbkMsNEJBQTRCLEVBQzVCLDRCQUE0QixFQUM1QixZQUFZLEVBQ2IsTUFBTSxvQkFBb0IsQ0FBQTtBQUMzQixPQUFPLEVBQ0wsOEJBQThCLEVBQzlCLDJCQUEyQixFQUMzQix3QkFBd0IsRUFDekIsTUFBTSxpQ0FBaUMsQ0FBQTtBQUV4Qzs7Ozs7Ozs7Ozs7OztHQWFHO0FBRUg7Ozs7O0dBS0c7QUFFSDs7OztHQUlHO0FBRUg7Ozs7Ozs7O0dBUUc7QUFFSDs7Ozs7R0FLRztBQUVIOzs7OztHQUtHO0FBRUgsTUFBTSxnQkFBZ0IsR0FBRywrQkFBK0IsQ0FBQTtBQUN4RCxNQUFNLGVBQWUsR0FBRyxpQkFBaUIsQ0FBQTtBQUN6QyxNQUFNLGlCQUFpQixHQUFHLGdCQUFnQixDQUFBO0FBQzFDLE1BQU0sK0JBQStCLEdBQUcseUJBQXlCLENBQUE7QUFDakUsTUFBTSx5Q0FBeUMsR0FBRyxnQkFBZ0IsQ0FBQTtBQUNsRSxpRkFBaUY7QUFDakYsOEVBQThFO0FBQzlFLCtFQUErRTtBQUMvRSw2QkFBNkI7QUFDN0IsTUFBTSxvQ0FBb0MsR0FBRyxnQkFBZ0IsQ0FBQTtBQUM3RCxNQUFNLG1DQUFtQyxHQUFHLGdCQUFnQixDQUFBO0FBQzVELCtFQUErRTtBQUMvRSw2RUFBNkU7QUFDN0UsK0VBQStFO0FBQy9FLE1BQU0sK0JBQStCLEdBQUcsbUJBQW1CLENBQUE7QUFDM0QsTUFBTSwrQkFBK0IsR0FBRyxHQUFHLCtCQUErQixRQUFRLENBQUE7QUFDbEYsTUFBTSxVQUFVLEdBQUcsaUJBQWlCLENBQUE7QUFDcEMsTUFBTSx1QkFBdUIsR0FBRztJQUM5QixVQUFVO0lBQ1YsT0FBTztJQUNQLFFBQVE7SUFDUixpQkFBaUI7SUFDakIsZUFBZTtJQUNmLGNBQWM7SUFDZCxrQkFBa0I7SUFDbEIsZ0JBQWdCO0lBQ2hCLGlCQUFpQjtDQUNsQixDQUFBO0FBQ0QsTUFBTSxzQkFBc0IsR0FBRyxpQ0FBaUMsQ0FBQTtBQUNoRSxNQUFNLG1CQUFtQixHQUFHLDhCQUE4QixDQUFBO0FBQzFELE1BQU0sK0JBQStCLEdBQUcsMENBQTBDLENBQUE7QUFDbEYsTUFBTSwwQ0FBMEMsR0FBRyxnQkFBZ0IsQ0FBQTtBQUNuRSxNQUFNLDRCQUE0QixHQUFHLDhDQUE4QyxDQUFBO0FBQ25GLHNGQUFzRjtBQUN0RixpRkFBaUY7QUFDakYscUZBQXFGO0FBQ3JGLGtGQUFrRjtBQUNsRixxRkFBcUY7QUFDckYsTUFBTSxpQ0FBaUMsR0FBRyxnQkFBZ0IsQ0FBQTtBQUMxRCxNQUFNLDJCQUEyQixHQUFHO0lBQ2xDLEVBQUMsT0FBTyxFQUFFLENBQUMsUUFBUSxFQUFFLGlCQUFpQixFQUFFLElBQUksQ0FBQyxFQUFFLElBQUksRUFBRSwyQ0FBMkMsRUFBQztJQUNqRyxFQUFDLE9BQU8sRUFBRSxDQUFDLFFBQVEsRUFBRSxjQUFjLEVBQUUsSUFBSSxDQUFDLEVBQUUsSUFBSSxFQUFFLHdDQUF3QyxFQUFDO0lBQzNGLEVBQUMsT0FBTyxFQUFFLENBQUMsUUFBUSxFQUFFLGdCQUFnQixFQUFFLElBQUksQ0FBQyxFQUFFLElBQUksRUFBRSwwQ0FBMEMsRUFBQztDQUNoRyxDQUFBO0FBQ0QsTUFBTSxpQkFBaUIsR0FBRyw0QkFBNEIsQ0FBQTtBQUN0RCxNQUFNLHFCQUFxQixHQUFHLGdDQUFnQyxDQUFBO0FBQzlELE1BQU0sbUJBQW1CLEdBQUcsUUFBUSxDQUFBO0FBQ3BDLE1BQU0sK0JBQStCLEdBQUcsNkNBQTZDLENBQUE7QUFDckYsTUFBTSwrQkFBK0IsR0FBRyxFQUFFLENBQUE7QUFDMUMsTUFBTSxDQUFDLE1BQU0sNkJBQTZCLEdBQUcsaUNBQWlDLENBQUE7QUFDOUUsTUFBTSxDQUFDLE1BQU0sNEJBQTRCLEdBQUcsQ0FBQyxLQUFLLEVBQUUsUUFBUSxFQUFFLFlBQVksRUFBRSxXQUFXLEVBQUUsUUFBUSxFQUFFLFVBQVUsQ0FBQyxDQUFBO0FBQzlHLE1BQU0sb0JBQW9CLEdBQUcsNEJBQTRCLENBQUMsS0FBSyxDQUFDLENBQUMsQ0FBQyxDQUFBO0FBQ2xFLE1BQU0sa0JBQWtCLEdBQUcsYUFBYSxDQUFBO0FBQ3hDLE1BQU0sOEJBQThCLEdBQUcsNkZBQTZGLGtCQUFrQixFQUFFLENBQUE7QUFDeEosTUFBTSxpQkFBaUIsR0FBRyxDQUFDLEdBQUcsRUFBRSxHQUFHLEVBQUUsR0FBRyxJQUFJLENBQUE7QUFFNUM7Ozs7O0dBS0c7QUFDSCxNQUFNLGdCQUFnQixHQUFHO0lBQ3ZCLFFBQVEsRUFBRSxVQUFVO0lBQ3BCLGFBQWEsRUFBRSxpQkFBaUI7SUFDaEMsV0FBVyxFQUFFLGVBQWU7SUFDNUIsVUFBVSxFQUFFLGNBQWM7SUFDMUIsYUFBYSxFQUFFLGtCQUFrQjtJQUNqQyxhQUFhLEVBQUUsaUJBQWlCO0NBQ2pDLENBQUE7QUFFRDs7Ozs7Ozs7Ozs7O0dBWUc7QUFDSCxNQUFNLGlCQUFpQixHQUFHLElBQUksR0FBRyxFQUFFLENBQUE7QUFDbkMseUNBQXlDO0FBQ3pDLE1BQU0seUJBQXlCLEdBQUcsSUFBSSxHQUFHLEVBQUUsQ0FBQTtBQUUzQyxNQUFNLENBQUMsT0FBTyxPQUFPLG1CQUFvQixTQUFRLHFCQUFxQjtJQUNwRTs7Ozs7Ozs7T0FRRztJQUNILFlBQVksRUFBQyxhQUFhLEVBQUUsa0JBQWtCLEVBQUUsS0FBSyxFQUFFLDRCQUE0QixFQUFFLDRCQUE0QixFQUFDO1FBQ2hILEtBQUssRUFBRSxDQUFBO1FBQ1AsSUFBSSxDQUFDLGFBQWEsR0FBRyxhQUFhLENBQUE7UUFDbEMsSUFBSSxDQUFDLGtCQUFrQixHQUFHLGtCQUFrQixDQUFBO1FBQzVDLElBQUksQ0FBQyxLQUFLLEdBQUcsS0FBSyxJQUFJLEVBQUMsR0FBRyxFQUFFLEdBQUcsRUFBRSxDQUFDLElBQUksQ0FBQyxHQUFHLEVBQUUsRUFBQyxDQUFBO1FBQzdDLElBQUksQ0FBQyw0QkFBNEIsR0FBRyw0QkFBNEIsQ0FBQTtRQUNoRSxJQUFJLENBQUMsNEJBQTRCLEdBQUcsNEJBQTRCLENBQUE7UUFDaEUsSUFBSSxDQUFDLE1BQU0sR0FBRyxJQUFJLE1BQU0sQ0FBQyxJQUFJLENBQUMsQ0FBQTtRQUM5QixJQUFJLENBQUMsYUFBYSxHQUFHLElBQUksQ0FBQTtRQUN6QixJQUFJLENBQUMsMkJBQTJCLEdBQUcsS0FBSyxDQUFBO0lBQzFDLENBQUM7SUFFRDs7O09BR0c7SUFDSCxxQkFBcUI7UUFDbkIsSUFBSSxJQUFJLENBQUMsa0JBQWtCO1lBQUUsT0FBTyxJQUFJLENBQUMsa0JBQWtCLENBQUE7UUFFM0QsT0FBTyxJQUFJLENBQUMsYUFBYSxDQUFDLHVCQUF1QixFQUFFLENBQUMsa0JBQWtCLENBQUE7SUFDeEUsQ0FBQztJQUVEOzs7T0FHRztJQUNILEtBQUssQ0FBQyxXQUFXO1FBQ2YsSUFBSSxJQUFJLENBQUMsYUFBYTtZQUFFLE9BQU8sTUFBTSxJQUFJLENBQUMsYUFBYSxDQUFBO1FBRXZELElBQUksQ0FBQyxhQUFhLEdBQUcsQ0FBQyxLQUFLLElBQUksRUFBRTtZQUMvQixJQUFJLENBQUMsYUFBYSxDQUFDLFVBQVUsRUFBRSxDQUFBO1lBQy9CLE1BQU0sSUFBSSxDQUFDLGFBQWEsRUFBRSxDQUFBO1lBQzFCLE1BQU0sSUFBSSxDQUFDLGdCQUFnQixFQUFFLENBQUE7UUFDL0IsQ0FBQyxDQUFDLEVBQUUsQ0FBQTtRQUVKLElBQUksQ0FBQztZQUNILE1BQU0sSUFBSSxDQUFDLGFBQWEsQ0FBQTtRQUMxQixDQUFDO2dCQUFTLENBQUM7WUFDVCxJQUFJLENBQUMsYUFBYSxHQUFHLElBQUksQ0FBQTtRQUMzQixDQUFDO0lBQ0gsQ0FBQztJQUVEOzs7Ozs7Ozs7OztPQVdHO0lBQ0gsS0FBSyxDQUFDLFlBQVksQ0FBQyxFQUFFO1FBQ25CLGdGQUFnRjtRQUNoRixpRkFBaUY7UUFDakYsNkVBQTZFO1FBQzdFLElBQUksQ0FBQyxFQUFFO1lBQUUsSUFBSSxDQUFDLGFBQWEsQ0FBQyxVQUFVLEVBQUUsQ0FBQTtRQUV4QyxNQUFNLElBQUksQ0FBQyxhQUFhLENBQUMsRUFBRSxDQUFDLENBQUE7SUFDOUIsQ0FBQztJQUVEOzs7Ozs7Ozs7Ozs7O09BYUc7SUFDSCxLQUFLLENBQUMseUJBQXlCO1FBQzdCLElBQUksSUFBSSxDQUFDLDJCQUEyQjtZQUFFLE9BQU07UUFFNUMsTUFBTSxrQkFBa0IsR0FBRyxJQUFJLENBQUMscUJBQXFCLEVBQUUsQ0FBQTtRQUN2RCxNQUFNLFdBQVcsR0FBRyxJQUFJLENBQUMsR0FBRyxFQUFFLENBQUE7UUFFOUIsTUFBTSxJQUFJLENBQUMsTUFBTSxDQUFDLElBQUksQ0FBQyxHQUFHLEVBQUUsQ0FBQztZQUMzQixtRUFBbUU7WUFDbkUsRUFBQyxrQkFBa0IsRUFBQztTQUNyQixDQUFDLENBQUE7UUFDRixNQUFNLElBQUksQ0FBQyxXQUFXLEVBQUUsQ0FBQTtRQUV4QixNQUFNLElBQUksQ0FBQyxPQUFPLENBQUMsS0FBSyxFQUFFLEVBQUUsRUFBRSxFQUFFO1lBQzlCLE1BQU0sUUFBUSxHQUFHLE1BQU0sRUFBRSxDQUFDLG1CQUFtQixDQUFDLCtCQUErQixDQUFDLENBQUE7WUFFOUUsSUFBSSxDQUFDLFFBQVE7Z0JBQUUsTUFBTSxJQUFJLEtBQUssQ0FBQyxtRUFBbUUsQ0FBQyxDQUFBO1lBRW5HLElBQUksQ0FBQztnQkFDSCxNQUFNLElBQUksQ0FBQywwQkFBMEIsQ0FBQyxFQUFFLENBQUMsQ0FBQTtnQkFDekMsTUFBTSxJQUFJLENBQUMscUJBQXFCLENBQUMsRUFBRSxDQUFDLENBQUE7Z0JBRXBDLHFFQUFxRTtnQkFDckUsdUVBQXVFO2dCQUN2RSw4Q0FBOEM7Z0JBQzlDLElBQUksQ0FBQywyQkFBMkIsR0FBRyxJQUFJLENBQUE7WUFDekMsQ0FBQztvQkFBUyxDQUFDO2dCQUNULE1BQU0sRUFBRSxDQUFDLG1CQUFtQixDQUFDLCtCQUErQixDQUFDLENBQUE7WUFDL0QsQ0FBQztRQUNILENBQUMsQ0FBQyxDQUFBO1FBRUYsTUFBTSxJQUFJLENBQUMsTUFBTSxDQUFDLElBQUksQ0FBQyxHQUFHLEVBQUUsQ0FBQztZQUMzQixvRUFBb0U7WUFDcEUsRUFBQyxrQkFBa0IsRUFBRSxVQUFVLEVBQUUsSUFBSSxDQUFDLEdBQUcsRUFBRSxHQUFHLFdBQVcsRUFBQztTQUMzRCxDQUFDLENBQUE7SUFDSixDQUFDO0lBRUQ7Ozs7O09BS0c7SUFDSCxLQUFLLENBQUMsMEJBQTBCO1FBQzlCLE1BQU0sa0JBQWtCLEdBQUcsSUFBSSxDQUFDLHFCQUFxQixFQUFFLENBQUE7UUFDdkQsTUFBTSxXQUFXLEdBQUcsSUFBSSxDQUFDLEdBQUcsRUFBRSxDQUFBO1FBRTlCLE1BQU0sSUFBSSxDQUFDLFdBQVcsRUFBRSxDQUFBO1FBRXhCLE1BQU0sTUFBTSxHQUFHLE1BQU0sSUFBSSxDQUFDLDZCQUE2QixDQUNyRCxLQUFLLEVBQUUsRUFBRSxFQUFFLEVBQUUsQ0FBQyxNQUFNLElBQUksQ0FBQyxxQkFBcUIsQ0FBQyxFQUFFLENBQUMsRUFDbEQ7WUFDRSxZQUFZLEVBQUU7Z0JBQ1osY0FBYyxFQUFFLG9FQUFvRTtnQkFDcEYsSUFBSSxFQUFFLCtCQUErQjthQUN0QztTQUNGLENBQ0YsQ0FBQTtRQUVELElBQUksTUFBTSxDQUFDLGFBQWEsR0FBRyxDQUFDLEVBQUUsQ0FBQztZQUM3QixNQUFNLElBQUksQ0FBQyxNQUFNLENBQUMsSUFBSSxDQUFDLEdBQUcsRUFBRSxDQUFDO2dCQUMzQix5REFBeUQ7Z0JBQ3pEO29CQUNFLGtCQUFrQjtvQkFDbEIsVUFBVSxFQUFFLElBQUksQ0FBQyxHQUFHLEVBQUUsR0FBRyxXQUFXO29CQUNwQyxhQUFhLEVBQUUsTUFBTSxDQUFDLGFBQWE7b0JBQ25DLE9BQU8sRUFBRSxNQUFNLENBQUMsT0FBTztvQkFDdkIscUJBQXFCLEVBQUUsTUFBTSxDQUFDLHFCQUFxQjtpQkFDcEQ7YUFDRixDQUFDLENBQUE7UUFDSixDQUFDO1FBRUQsT0FBTyxNQUFNLENBQUE7SUFDZixDQUFDO0lBRUQ7Ozs7Ozs7T0FPRztJQUNILEtBQUssQ0FBQyxPQUFPLENBQUMsRUFBQyxPQUFPLEVBQUUsSUFBSSxFQUFFLE9BQU8sRUFBQztRQUNwQyxNQUFNLElBQUksQ0FBQyxXQUFXLEVBQUUsQ0FBQTtRQUV4QixNQUFNLFdBQVcsR0FBRyxJQUFJLENBQUMsV0FBVyxDQUFDLEVBQUMsT0FBTyxFQUFFLElBQUksRUFBRSxPQUFPLEVBQUMsQ0FBQyxDQUFBO1FBRTlELElBQUksT0FBTyxFQUFFLGNBQWMsS0FBSyxTQUFTLEVBQUUsQ0FBQztZQUMxQyxPQUFPLE1BQU0sSUFBSSxDQUFDLG9CQUFvQixDQUFDLEVBQUMsSUFBSSxFQUFFLElBQUksSUFBSSxFQUFFLEVBQUUsT0FBTyxFQUFFLFdBQVcsRUFBQyxDQUFDLENBQUE7UUFDbEYsQ0FBQztRQUVELHFCQUFxQjtRQUNyQixJQUFJLFdBQVcsR0FBRyxXQUFXLENBQUMsS0FBSyxDQUFBO1FBRW5DLE1BQU0sSUFBSSxDQUFDLHdCQUF3QixDQUFDLEtBQUssRUFBRSxFQUFFLEVBQUUsRUFBRTtZQUMvQyxJQUFJLE9BQU8sRUFBRSxzQkFBc0IsRUFBRSxDQUFDO2dCQUNwQyxNQUFNLGNBQWMsR0FBRyxNQUFNLElBQUksQ0FBQyx3QkFBd0IsQ0FBQyxFQUFFLEVBQUUsV0FBVyxDQUFDLENBQUE7Z0JBRTNFLElBQUksY0FBYyxFQUFFLENBQUM7b0JBQ25CLFdBQVcsR0FBRyxjQUFjLENBQUE7b0JBQzVCLE9BQU07Z0JBQ1IsQ0FBQztZQUNILENBQUM7WUFFRCxNQUFNLElBQUksQ0FBQyxrQkFBa0IsQ0FBQyxFQUFFLEVBQUUsRUFBQyxXQUFXLEVBQUUsV0FBVyxFQUFFLElBQUksRUFBQyxDQUFDLENBQUE7WUFDbkUsTUFBTSxJQUFJLENBQUMsaUJBQWlCLENBQUMsRUFBRSxFQUFFLEVBQUMsR0FBRyxFQUFFLENBQUMsRUFBRSxNQUFNLEVBQUUsQ0FBQyxFQUFDLENBQUMsQ0FBQTtRQUN2RCxDQUFDLENBQUMsQ0FBQTtRQUVGLE9BQU8sV0FBVyxDQUFBO0lBQ3BCLENBQUM7SUFFRDs7Ozs7Ozs7Ozs7T0FXRztJQUNILEtBQUssQ0FBQyx1QkFBdUIsQ0FBQyxFQUFDLE9BQU8sRUFBRSxJQUFJLEVBQUUsT0FBTyxFQUFFLG9CQUFvQixFQUFFLGFBQWEsRUFBQztRQUN6RixNQUFNLElBQUksQ0FBQyxXQUFXLEVBQUUsQ0FBQTtRQUV4QixNQUFNLHVCQUF1QixHQUFHLElBQUksQ0FBQyx1QkFBdUIsQ0FBQyxhQUFhLENBQUMsQ0FBQTtRQUMzRSxNQUFNLDhCQUE4QixHQUFHLElBQUksQ0FBQyw4QkFBOEIsQ0FBQyxvQkFBb0IsQ0FBQyxDQUFBO1FBQ2hHLE1BQU0sV0FBVyxHQUFHLElBQUksQ0FBQyxXQUFXLENBQUMsRUFBQyxPQUFPLEVBQUUsSUFBSSxFQUFFLE9BQU8sRUFBQyxDQUFDLENBQUE7UUFFOUQsT0FBTyxNQUFNLElBQUksQ0FBQyx3QkFBd0IsQ0FBQyxLQUFLLEVBQUUsRUFBRSxFQUFFLEVBQUU7WUFDdEQsTUFBTSxJQUFJLENBQUMsMkJBQTJCLENBQUMsRUFBRSxFQUFFLHVCQUF1QixDQUFDLENBQUE7WUFDbkUsSUFBSSxJQUFJLENBQUMsNEJBQTRCO2dCQUFFLE1BQU0sSUFBSSxDQUFDLDRCQUE0QixDQUFDLHVCQUF1QixDQUFDLENBQUE7WUFFdkcsSUFBSSxPQUFPLEVBQUUsY0FBYyxLQUFLLFNBQVMsRUFBRSxDQUFDO2dCQUMxQyxPQUFPLE1BQU0sSUFBSSxDQUFDLGlDQUFpQyxDQUFDO29CQUNsRCxJQUFJLEVBQUUsSUFBSSxJQUFJLEVBQUU7b0JBQ2hCLG1CQUFtQixFQUFFLElBQUk7b0JBQ3pCLEVBQUU7b0JBQ0YsT0FBTztvQkFDUCxXQUFXO2lCQUNaLENBQUMsQ0FBQTtZQUNKLENBQUM7WUFFRCxPQUFPLE1BQU0sSUFBSSxDQUFDLGdDQUFnQyxDQUFDO2dCQUNqRCxFQUFFO2dCQUNGLE9BQU8sRUFBRSxPQUFPLElBQUksRUFBRTtnQkFDdEIsV0FBVztnQkFDWCxvQkFBb0IsRUFBRSw4QkFBOEI7Z0JBQ3BELGFBQWEsRUFBRSx1QkFBdUI7YUFDdkMsQ0FBQyxDQUFBO1FBQ0osQ0FBQyxDQUFDLENBQUE7SUFDSixDQUFDO0lBRUQ7Ozs7O09BS0c7SUFDSCxLQUFLLENBQUMsd0JBQXdCLENBQUMsRUFBRSxFQUFFLFdBQVc7UUFDNUMsd0ZBQXdGO1FBQ3hGLDBGQUEwRjtRQUMxRiwwRkFBMEY7UUFDMUYsMkZBQTJGO1FBQzNGLE1BQU0sUUFBUSxHQUFHLE1BQU0sRUFBRTthQUN0QixRQUFRLEVBQUU7YUFDVixJQUFJLENBQUMsVUFBVSxDQUFDO2FBQ2hCLE1BQU0sQ0FBQyxJQUFJLENBQUM7YUFDWixLQUFLLENBQUMsRUFBQyxNQUFNLEVBQUUsUUFBUSxFQUFFLFFBQVEsRUFBRSxXQUFXLENBQUMsT0FBTyxFQUFFLFNBQVMsRUFBRSxXQUFXLENBQUMsUUFBUSxFQUFFLEtBQUssRUFBRSxXQUFXLENBQUMsS0FBSyxFQUFDLENBQUM7YUFDbkgsS0FBSyxDQUFDLHNCQUFzQixFQUFFLENBQUMsS0FBSyxDQUFDLFdBQVcsQ0FBQyxhQUFhLENBQUMsRUFBRSxDQUFDO2FBQ2xFLEtBQUssQ0FBQyxxQkFBcUIsQ0FBQzthQUM1QixLQUFLLENBQUMsQ0FBQyxDQUFDO2FBQ1IsT0FBTyxFQUFFLENBQUE7UUFDWixNQUFNLEdBQUcsR0FBRyxRQUFRLENBQUMsQ0FBQyxDQUFDLENBQUE7UUFFdkIsT0FBTyxHQUFHLENBQUMsQ0FBQyxDQUFDLE1BQU0sQ0FBQyw0REFBNEQsQ0FBQyxDQUFDLEdBQUcsQ0FBQyxDQUFDLEVBQUUsQ0FBQyxDQUFDLENBQUMsQ0FBQyxJQUFJLENBQUE7SUFDbkcsQ0FBQztJQUVEOzs7Ozs7Ozs7O09BVUc7SUFDSCxLQUFLLENBQUMsZ0NBQWdDLENBQUMsRUFBQyxFQUFFLEVBQUUsT0FBTyxFQUFFLFdBQVcsRUFBRSxvQkFBb0IsRUFBRSxhQUFhLEVBQUM7UUFDcEcsTUFBTSxhQUFhLEdBQUcsSUFBSSxDQUFDLDBCQUEwQixDQUFDLEVBQUMsT0FBTyxFQUFFLFdBQVcsRUFBQyxDQUFDLENBQUE7UUFDN0UsTUFBTSxXQUFXLEdBQUcsSUFBSSxDQUFDLHdCQUF3QixDQUFDLEVBQUMsV0FBVyxFQUFFLG9CQUFvQixFQUFFLGFBQWEsRUFBRSxhQUFhLEVBQUMsQ0FBQyxDQUFBO1FBQ3BILE1BQU0sY0FBYyxHQUFHLGlCQUFpQixXQUFXLEVBQUUsQ0FBQTtRQUNyRCxNQUFNLFFBQVEsR0FBRyxNQUFNLElBQUksQ0FBQyxxQkFBcUIsQ0FBQyxFQUFFLEVBQUUsV0FBVyxDQUFDLENBQUE7UUFDbEUsTUFBTSxhQUFhLEdBQUc7WUFDcEIsYUFBYSxFQUFFLFdBQVcsQ0FBQyxXQUFXO1lBQ3RDLGVBQWUsRUFBRSxjQUFjO1lBQy9CLFFBQVEsRUFBRSxXQUFXLENBQUMsT0FBTztZQUM3QixLQUFLLEVBQUUsV0FBVyxDQUFDLEtBQUs7WUFDeEIsY0FBYyxFQUFFLGFBQWE7WUFDN0IsWUFBWSxFQUFFLFdBQVc7U0FDMUIsQ0FBQTtRQUVELElBQUksUUFBUSxFQUFFLENBQUM7WUFDYixJQUFJLENBQUMsNkJBQTZCLENBQUMsRUFBQyxRQUFRLEVBQUUsU0FBUyxFQUFFLEVBQUMsR0FBRyxhQUFhLEVBQUUsTUFBTSxFQUFFLE1BQU0sQ0FBQyxRQUFRLENBQUMsTUFBTSxDQUFDLEVBQUMsRUFBQyxDQUFDLENBQUE7WUFDOUcsT0FBTyxNQUFNLENBQUMsUUFBUSxDQUFDLE1BQU0sQ0FBQyxDQUFBO1FBQ2hDLENBQUM7UUFFRCxNQUFNLGNBQWMsR0FBRyxPQUFPLENBQUMsc0JBQXNCO1lBQ25ELENBQUMsQ0FBQyxNQUFNLElBQUksQ0FBQyx3QkFBd0IsQ0FBQyxFQUFFLEVBQUUsV0FBVyxDQUFDO1lBQ3RELENBQUMsQ0FBQyxJQUFJLENBQUE7UUFDUixNQUFNLFNBQVMsR0FBRyxFQUFDLEdBQUcsYUFBYSxFQUFFLE1BQU0sRUFBRSxjQUFjLElBQUksV0FBVyxDQUFDLEtBQUssRUFBQyxDQUFBO1FBQ2pGLE1BQU0sT0FBTyxHQUFHLE1BQU0sSUFBSSxDQUFDLDBCQUEwQixDQUFDLEVBQUUsRUFBRSxTQUFTLENBQUMsQ0FBQTtRQUVwRSxJQUFJLENBQUMsT0FBTyxDQUFDLE9BQU8sRUFBRSxDQUFDO1lBQ3JCLElBQUksQ0FBQyw2QkFBNkIsQ0FBQyxFQUFDLFFBQVEsRUFBRSxPQUFPLENBQUMsR0FBRyxFQUFFLFNBQVMsRUFBQyxDQUFDLENBQUE7WUFDdEUsT0FBTyxNQUFNLENBQUMsT0FBTyxDQUFDLEdBQUcsQ0FBQyxNQUFNLENBQUMsQ0FBQTtRQUNuQyxDQUFDO1FBQ0QsSUFBSSxjQUFjO1lBQUUsT0FBTyxjQUFjLENBQUE7UUFFekMsTUFBTSxJQUFJLENBQUMsa0JBQWtCLENBQUMsRUFBRSxFQUFFLEVBQUMsV0FBVyxFQUFFLFdBQVcsRUFBRSxJQUFJLEVBQUMsQ0FBQyxDQUFBO1FBQ25FLE1BQU0sSUFBSSxDQUFDLGlCQUFpQixDQUFDLEVBQUUsRUFBRSxFQUFDLEdBQUcsRUFBRSxDQUFDLEVBQUUsTUFBTSxFQUFFLENBQUMsRUFBQyxDQUFDLENBQUE7UUFFckQsT0FBTyxXQUFXLENBQUMsS0FBSyxDQUFBO0lBQzFCLENBQUM7SUFFRDs7Ozs7OztPQU9HO0lBQ0gsS0FBSyxDQUFDLG9CQUFvQixDQUFDLEVBQUMsSUFBSSxFQUFFLE9BQU8sRUFBRSxXQUFXLEVBQUM7UUFDckQseUVBQXlFO1FBQ3pFLHFFQUFxRTtRQUNyRSxtQ0FBbUM7UUFDbkMsT0FBTyxNQUFNLElBQUksQ0FBQyw2QkFBNkIsQ0FBQyxLQUFLLEVBQUUsRUFBRSxFQUFFLEVBQUU7WUFDM0QsT0FBTyxNQUFNLElBQUksQ0FBQyxpQ0FBaUMsQ0FBQyxFQUFDLElBQUksRUFBRSxFQUFFLEVBQUUsT0FBTyxFQUFFLFdBQVcsRUFBQyxDQUFDLENBQUE7UUFDdkYsQ0FBQyxDQUFDLENBQUE7SUFDSixDQUFDO0lBRUQ7Ozs7Ozs7OztPQVNHO0lBQ0gsS0FBSyxDQUFDLGlDQUFpQyxDQUFDLEVBQUMsSUFBSSxFQUFFLG1CQUFtQixHQUFHLEtBQUssRUFBRSxFQUFFLEVBQUUsT0FBTyxFQUFFLFdBQVcsRUFBQztRQUNuRyxNQUFNLGNBQWMsR0FBRyxJQUFJLENBQUMsd0JBQXdCLENBQUMsT0FBTyxDQUFDLGNBQWMsQ0FBQyxDQUFBO1FBQzVFLE1BQU0sV0FBVyxHQUFHLElBQUksQ0FBQyx1QkFBdUIsQ0FBQyxFQUFDLGNBQWMsRUFBRSxPQUFPLEVBQUUsV0FBVyxDQUFDLE9BQU8sRUFBRSxLQUFLLEVBQUUsV0FBVyxDQUFDLEtBQUssRUFBQyxDQUFDLENBQUE7UUFDMUgsTUFBTSxhQUFhLEdBQUcsSUFBSSxDQUFDLHlCQUF5QixDQUFDLEVBQUMsSUFBSSxFQUFFLE9BQU8sRUFBRSxXQUFXLEVBQUMsQ0FBQyxDQUFBO1FBQ2xGLE1BQU0sU0FBUyxHQUFHO1lBQ2hCLGFBQWEsRUFBRSxXQUFXLENBQUMsV0FBVztZQUN0QyxlQUFlLEVBQUUsY0FBYztZQUMvQixNQUFNLEVBQUUsV0FBVyxDQUFDLEtBQUs7WUFDekIsUUFBUSxFQUFFLFdBQVcsQ0FBQyxPQUFPO1lBQzdCLEtBQUssRUFBRSxXQUFXLENBQUMsS0FBSztZQUN4QixjQUFjLEVBQUUsYUFBYTtZQUM3QixZQUFZLEVBQUUsV0FBVztTQUMxQixDQUFBO1FBQ0QsTUFBTSxrQkFBa0IsR0FBRywyQkFBMkIsQ0FBQyxXQUFXLENBQUMsT0FBTyxFQUFFLElBQUksQ0FBQyxDQUFBO1FBRWpGLElBQUksa0JBQWtCLElBQUksa0JBQWtCLENBQUMsU0FBUyxDQUFDLEVBQUUsS0FBSyxjQUFjLEVBQUUsQ0FBQztZQUM3RSxNQUFNLGNBQWMsQ0FBQyxJQUFJLENBQUMsMkVBQTJFLEVBQUU7Z0JBQ3JHLElBQUksRUFBRSx3Q0FBd0M7YUFDL0MsQ0FBQyxDQUFBO1FBQ0osQ0FBQztRQUVELE1BQU0sUUFBUSxHQUFHLE1BQU0sSUFBSSxDQUFDLHFCQUFxQixDQUFDLEVBQUUsRUFBRSxXQUFXLENBQUMsQ0FBQTtRQUVsRSxJQUFJLFFBQVEsRUFBRSxDQUFDO1lBQ2IsSUFBSSxDQUFDLDZCQUE2QixDQUFDLEVBQUMsUUFBUSxFQUFFLFNBQVMsRUFBQyxDQUFDLENBQUE7WUFDekQsTUFBTSxJQUFJLENBQUMsOEJBQThCLENBQUMsRUFBRSxFQUFFLEVBQUMsS0FBSyxFQUFFLE1BQU0sQ0FBQyxRQUFRLENBQUMsTUFBTSxDQUFDLEVBQUUsa0JBQWtCLEVBQUMsQ0FBQyxDQUFBO1lBQ25HLE9BQU8sTUFBTSxDQUFDLFFBQVEsQ0FBQyxNQUFNLENBQUMsQ0FBQTtRQUNoQyxDQUFDO1FBRUQsTUFBTSxPQUFPLEdBQUcsTUFBTSxJQUFJLENBQUMsMEJBQTBCLENBQUMsRUFBRSxFQUFFLFNBQVMsQ0FBQyxDQUFBO1FBRXBFLElBQUksQ0FBQyxPQUFPLENBQUMsT0FBTyxFQUFFLENBQUM7WUFDckIsSUFBSSxDQUFDLDZCQUE2QixDQUFDLEVBQUMsUUFBUSxFQUFFLE9BQU8sQ0FBQyxHQUFHLEVBQUUsU0FBUyxFQUFDLENBQUMsQ0FBQTtZQUN0RSxNQUFNLElBQUksQ0FBQyw4QkFBOEIsQ0FBQyxFQUFFLEVBQUUsRUFBQyxLQUFLLEVBQUUsTUFBTSxDQUFDLE9BQU8sQ0FBQyxHQUFHLENBQUMsTUFBTSxDQUFDLEVBQUUsa0JBQWtCLEVBQUMsQ0FBQyxDQUFBO1lBQ3RHLE9BQU8sTUFBTSxDQUFDLE9BQU8sQ0FBQyxHQUFHLENBQUMsTUFBTSxDQUFDLENBQUE7UUFDbkMsQ0FBQztRQUVELElBQUksQ0FBQyxtQkFBbUI7WUFBRSxNQUFNLElBQUksQ0FBQyxrQkFBa0IsQ0FBQyxFQUFFLENBQUMsQ0FBQTtRQUMzRCxNQUFNLElBQUksQ0FBQyxrQkFBa0IsQ0FBQyxFQUFFLEVBQUUsRUFBQyxXQUFXLEVBQUUsV0FBVyxFQUFFLElBQUksRUFBQyxDQUFDLENBQUE7UUFDbkUsTUFBTSxJQUFJLENBQUMsNkJBQTZCLENBQUMsRUFBRSxFQUFFLEVBQUMsS0FBSyxFQUFFLFdBQVcsQ0FBQyxLQUFLLEVBQUUsa0JBQWtCLEVBQUUsV0FBVyxFQUFFLFdBQVcsQ0FBQyxXQUFXLEVBQUMsQ0FBQyxDQUFBO1FBQ2xJLE1BQU0sSUFBSSxDQUFDLGlCQUFpQixDQUFDLEVBQUUsRUFBRSxFQUFDLEdBQUcsRUFBRSxDQUFDLEVBQUUsTUFBTSxFQUFFLENBQUMsRUFBQyxDQUFDLENBQUE7UUFFckQsT0FBTyxXQUFXLENBQUMsS0FBSyxDQUFBO0lBQzFCLENBQUM7SUFFRDs7Ozs7O09BTUc7SUFDSCxLQUFLLENBQUMsNkJBQTZCLENBQUMsUUFBUTtRQUMxQyxPQUFPLE1BQU0sSUFBSSxDQUFDLDhCQUE4QixDQUFDLFFBQVEsQ0FBQyxDQUFBO0lBQzVELENBQUM7SUFFRDs7Ozs7T0FLRztJQUNILEtBQUssQ0FBQywwQkFBMEIsQ0FBQyxFQUFFLEVBQUUsU0FBUztRQUM1QyxJQUFJLENBQUM7WUFDSCxvRUFBb0U7WUFDcEUsb0VBQW9FO1lBQ3BFLHFEQUFxRDtZQUNyRCxNQUFNLEVBQUUsQ0FBQyxXQUFXLENBQUMsS0FBSyxJQUFJLEVBQUU7Z0JBQzlCLE1BQU0sRUFBRSxDQUFDLE1BQU0sQ0FBQyxFQUFDLFNBQVMsRUFBRSxzQkFBc0IsRUFBRSxJQUFJLEVBQUUsU0FBUyxFQUFDLENBQUMsQ0FBQTtZQUN2RSxDQUFDLENBQUMsQ0FBQTtZQUVGLE9BQU8sRUFBQyxPQUFPLEVBQUUsSUFBSSxFQUFFLEdBQUcsRUFBRSxTQUFTLEVBQUMsQ0FBQTtRQUN4QyxDQUFDO1FBQUMsT0FBTyxLQUFLLEVBQUUsQ0FBQztZQUNmLE1BQU0sS0FBSyxHQUFHLE1BQU0sSUFBSSxDQUFDLHFCQUFxQixDQUFDLEVBQUUsRUFBRSxNQUFNLENBQUMsU0FBUyxDQUFDLFlBQVksQ0FBQyxDQUFDLENBQUE7WUFFbEYsSUFBSSxDQUFDLEtBQUs7Z0JBQUUsTUFBTSxLQUFLLENBQUE7WUFDdkIsT0FBTyxFQUFDLE9BQU8sRUFBRSxLQUFLLEVBQUUsR0FBRyxFQUFFLEtBQUssRUFBQyxDQUFBO1FBQ3JDLENBQUM7SUFDSCxDQUFDO0lBRUQ7Ozs7O09BS0c7SUFDSCxLQUFLLENBQUMscUJBQXFCLENBQUMsRUFBRSxFQUFFLFdBQVc7UUFDekMsTUFBTSxJQUFJLEdBQUcsTUFBTSxFQUFFLENBQUMsUUFBUSxFQUFFLENBQUMsSUFBSSxDQUFDLHNCQUFzQixDQUFDLENBQUMsS0FBSyxDQUFDLEVBQUMsWUFBWSxFQUFFLFdBQVcsRUFBQyxDQUFDLENBQUMsS0FBSyxDQUFDLENBQUMsQ0FBQyxDQUFDLE9BQU8sRUFBRSxDQUFBO1FBRW5ILE9BQU8sSUFBSSxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyw0REFBNEQsQ0FBQyxDQUFDLElBQUksQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxJQUFJLENBQUE7SUFDaEcsQ0FBQztJQUVEOzs7Ozs7T0FNRztJQUNILDZCQUE2QixDQUFDLEVBQUMsUUFBUSxFQUFFLFNBQVMsRUFBQztRQUNqRCxNQUFNLFVBQVUsR0FBRyxNQUFNLENBQUMsUUFBUSxDQUFDLFFBQVEsQ0FBQyxLQUFLLFNBQVMsQ0FBQyxRQUFRO2VBQzlELE1BQU0sQ0FBQyxRQUFRLENBQUMsS0FBSyxDQUFDLEtBQUssU0FBUyxDQUFDLEtBQUs7ZUFDMUMsTUFBTSxDQUFDLFFBQVEsQ0FBQyxlQUFlLENBQUMsS0FBSyxTQUFTLENBQUMsZUFBZSxDQUFBO1FBRW5FLElBQUksQ0FBQyxVQUFVLElBQUksTUFBTSxDQUFDLFFBQVEsQ0FBQyxjQUFjLENBQUMsS0FBSyxTQUFTLENBQUMsY0FBYyxFQUFFLENBQUM7WUFDaEYsTUFBTSxjQUFjLENBQUMsSUFBSSxDQUFDLDhFQUE4RSxFQUFFO2dCQUN4RyxJQUFJLEVBQUUscUNBQXFDO2FBQzVDLENBQUMsQ0FBQTtRQUNKLENBQUM7SUFDSCxDQUFDO0lBRUQ7Ozs7Ozs7O09BUUc7SUFDSCxLQUFLLENBQUMsNkJBQTZCLENBQUMsRUFBRSxFQUFFLEVBQUMsV0FBVyxFQUFFLEtBQUssRUFBRSxrQkFBa0IsRUFBQztRQUM5RSxJQUFJLENBQUMsa0JBQWtCO1lBQUUsT0FBTTtRQUMvQixNQUFNLEVBQUMsU0FBUyxFQUFDLEdBQUcsa0JBQWtCLENBQUE7UUFDdEMsTUFBTSxZQUFZLEdBQUcsd0JBQXdCLENBQUMsU0FBUyxDQUFDLEVBQUUsQ0FBQyxDQUFBO1FBQzNELE1BQU0sR0FBRyxHQUFHO1lBQ1YsaUJBQWlCLEVBQUUsS0FBSztZQUN4QixhQUFhLEVBQUUsV0FBVztZQUMxQiwyQkFBMkIsRUFBRSxJQUFJO1lBQ2pDLFlBQVksRUFBRSxTQUFTLENBQUMsRUFBRTtZQUMxQixhQUFhLEVBQUUsWUFBWTtZQUMzQixjQUFjLEVBQUUsU0FBUyxDQUFDLGFBQWE7WUFDdkMsYUFBYSxFQUFFLFNBQVMsQ0FBQyxZQUFZO1lBQ3JDLHFCQUFxQixFQUFFLFNBQVMsQ0FBQyxtQkFBbUI7U0FDckQsQ0FBQTtRQUVELElBQUksQ0FBQztZQUNILE1BQU0sRUFBRSxDQUFDLFdBQVcsQ0FBQyxLQUFLLElBQUksRUFBRTtnQkFDOUIsTUFBTSxFQUFFLENBQUMsTUFBTSxDQUFDLEVBQUMsU0FBUyxFQUFFLDhCQUE4QixFQUFFLElBQUksRUFBRSxHQUFHLEVBQUMsQ0FBQyxDQUFBO1lBQ3pFLENBQUMsQ0FBQyxDQUFBO1FBQ0osQ0FBQztRQUFDLE9BQU8sS0FBSyxFQUFFLENBQUM7WUFDZixNQUFNLFFBQVEsR0FBRyxNQUFNLElBQUksQ0FBQyxzQkFBc0IsQ0FBQyxFQUFFLEVBQUUsWUFBWSxDQUFDLENBQUE7WUFFcEUsSUFBSSxDQUFDLFFBQVE7Z0JBQUUsTUFBTSxLQUFLLENBQUE7WUFDMUIsSUFBSSxDQUFDLGlDQUFpQyxDQUFDLEVBQUMsUUFBUSxFQUFFLFNBQVMsRUFBRSxHQUFHLEVBQUMsQ0FBQyxDQUFBO1FBQ3BFLENBQUM7SUFDSCxDQUFDO0lBRUQ7Ozs7Ozs7T0FPRztJQUNILEtBQUssQ0FBQyw4QkFBOEIsQ0FBQyxFQUFFLEVBQUUsRUFBQyxLQUFLLEVBQUUsa0JBQWtCLEVBQUM7UUFDbEUsSUFBSSxDQUFDLGtCQUFrQjtZQUFFLE9BQU07UUFDL0IsTUFBTSxFQUFDLFNBQVMsRUFBQyxHQUFHLGtCQUFrQixDQUFBO1FBQ3RDLE1BQU0sUUFBUSxHQUFHLE1BQU0sSUFBSSxDQUFDLHNCQUFzQixDQUFDLEVBQUUsRUFBRSx3QkFBd0IsQ0FBQyxTQUFTLENBQUMsRUFBRSxDQUFDLENBQUMsQ0FBQTtRQUU5RixJQUFJLENBQUMsUUFBUSxFQUFFLENBQUM7WUFDZCxNQUFNLElBQUksS0FBSyxDQUFDLHFGQUFxRixDQUFDLENBQUE7UUFDeEcsQ0FBQztRQUVELElBQUksQ0FBQyxpQ0FBaUMsQ0FBQztZQUNyQyxRQUFRO1lBQ1IsU0FBUyxFQUFFO2dCQUNULGlCQUFpQixFQUFFLEtBQUs7Z0JBQ3hCLFlBQVksRUFBRSxTQUFTLENBQUMsRUFBRTtnQkFDMUIsY0FBYyxFQUFFLFNBQVMsQ0FBQyxhQUFhO2dCQUN2QyxhQUFhLEVBQUUsU0FBUyxDQUFDLFlBQVk7Z0JBQ3JDLHFCQUFxQixFQUFFLFNBQVMsQ0FBQyxtQkFBbUI7YUFDckQ7U0FDRixDQUFDLENBQUE7SUFDSixDQUFDO0lBRUQ7Ozs7O09BS0c7SUFDSCxLQUFLLENBQUMsc0JBQXNCLENBQUMsRUFBRSxFQUFFLFlBQVk7UUFDM0MsTUFBTSxJQUFJLEdBQUcsTUFBTSxFQUFFLENBQUMsUUFBUSxFQUFFLENBQUMsSUFBSSxDQUFDLDhCQUE4QixDQUFDLENBQUMsS0FBSyxDQUFDLEVBQUMsYUFBYSxFQUFFLFlBQVksRUFBQyxDQUFDLENBQUMsS0FBSyxDQUFDLENBQUMsQ0FBQyxDQUFDLE9BQU8sRUFBRSxDQUFBO1FBRTdILE9BQU8sSUFBSSxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyw0REFBNEQsQ0FBQyxDQUFDLElBQUksQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxJQUFJLENBQUE7SUFDaEcsQ0FBQztJQUVEOzs7Ozs7T0FNRztJQUNILGlDQUFpQyxDQUFDLEVBQUMsUUFBUSxFQUFFLFNBQVMsRUFBQztRQUNyRCxNQUFNLE9BQU8sR0FBRyxNQUFNLENBQUMsUUFBUSxDQUFDLFlBQVksQ0FBQyxLQUFLLFNBQVMsQ0FBQyxZQUFZO2VBQ25FLE1BQU0sQ0FBQyxRQUFRLENBQUMsY0FBYyxDQUFDLEtBQUssU0FBUyxDQUFDLGNBQWM7ZUFDNUQsTUFBTSxDQUFDLFFBQVEsQ0FBQyxpQkFBaUIsQ0FBQyxLQUFLLFNBQVMsQ0FBQyxpQkFBaUI7ZUFDbEUsTUFBTSxDQUFDLFFBQVEsQ0FBQyxhQUFhLENBQUMsS0FBSyxTQUFTLENBQUMsYUFBYTtlQUMxRCxJQUFJLENBQUMsZ0JBQWdCLENBQUMsUUFBUSxDQUFDLHFCQUFxQixDQUFDLEtBQUssU0FBUyxDQUFDLHFCQUFxQixDQUFBO1FBRTlGLElBQUksQ0FBQyxPQUFPLEVBQUUsQ0FBQztZQUNiLE1BQU0sY0FBYyxDQUFDLElBQUksQ0FBQyxtRkFBbUYsRUFBRTtnQkFDN0csSUFBSSxFQUFFLG9DQUFvQzthQUMzQyxDQUFDLENBQUE7UUFDSixDQUFDO0lBQ0gsQ0FBQztJQUVEOzs7Ozs7O09BT0c7SUFDSCx5QkFBeUIsQ0FBQyxFQUFDLElBQUksRUFBRSxPQUFPLEVBQUUsV0FBVyxFQUFDO1FBQ3BELE1BQU0sVUFBVSxHQUFHLG1CQUFtQixDQUFDO1lBQ3JDLElBQUk7WUFDSixXQUFXLEVBQUUsV0FBVyxDQUFDLFdBQVc7WUFDcEMsYUFBYSxFQUFFLFdBQVcsQ0FBQyxhQUFhO1lBQ3hDLE1BQU0sRUFBRSx5Q0FBeUM7WUFDakQsT0FBTyxFQUFFLFdBQVcsQ0FBQyxPQUFPO1lBQzVCLFVBQVUsRUFBRSxXQUFXLENBQUMsVUFBVTtZQUNsQyxLQUFLLEVBQUUsV0FBVyxDQUFDLEtBQUs7WUFDeEIsYUFBYSxFQUFFLE9BQU8sQ0FBQyxhQUFhLEtBQUssU0FBUyxDQUFDLENBQUMsQ0FBQyxJQUFJLENBQUMsQ0FBQyxDQUFDLFdBQVcsQ0FBQyxhQUFhO1lBQ3JGLFVBQVUsRUFBRSxPQUFPLENBQUMsYUFBYSxLQUFLLFNBQVMsQ0FBQyxDQUFDLENBQUMsV0FBVyxDQUFDLENBQUMsQ0FBQyxXQUFXO1lBQzNFLEdBQUcsQ0FBQyxXQUFXLENBQUMsU0FBUyxLQUFLLElBQUksQ0FBQyxDQUFDLENBQUMsRUFBRSxDQUFDLENBQUMsQ0FBQyxFQUFDLFNBQVMsRUFBRSxXQUFXLENBQUMsU0FBUyxFQUFDLENBQUM7U0FDOUUsQ0FBQyxDQUFBO1FBRUYsT0FBTyxVQUFVLENBQUMsUUFBUSxDQUFDLENBQUMsTUFBTSxDQUFDLFVBQVUsQ0FBQyxDQUFDLE1BQU0sQ0FBQyxLQUFLLENBQUMsQ0FBQTtJQUM5RCxDQUFDO0lBRUQ7Ozs7Ozs7T0FPRztJQUNILHVCQUF1QixDQUFDLEVBQUMsY0FBYyxFQUFFLE9BQU8sRUFBRSxLQUFLLEVBQUM7UUFDdEQsT0FBTyxVQUFVLENBQUMsUUFBUSxDQUFDO2FBQ3hCLE1BQU0sQ0FBQyxtQkFBbUIsQ0FBQyxFQUFDLE1BQU0sRUFBRSwrQ0FBK0MsRUFBRSxjQUFjLEVBQUUsT0FBTyxFQUFFLEtBQUssRUFBQyxDQUFDLENBQUM7YUFDdEgsTUFBTSxDQUFDLEtBQUssQ0FBQyxDQUFBO0lBQ2xCLENBQUM7SUFFRDs7OztPQUlHO0lBQ0gsd0JBQXdCLENBQUMsY0FBYztRQUNyQyxJQUFJLE9BQU8sY0FBYyxLQUFLLFFBQVEsSUFBSSxjQUFjLENBQUMsTUFBTSxLQUFLLENBQUMsRUFBRSxDQUFDO1lBQ3RFLE1BQU0sY0FBYyxDQUFDLElBQUksQ0FBQywyREFBMkQsRUFBRTtnQkFDckYsSUFBSSxFQUFFLHdDQUF3QzthQUMvQyxDQUFDLENBQUE7UUFDSixDQUFDO1FBRUQsT0FBTyxjQUFjLENBQUE7SUFDdkIsQ0FBQztJQUVEOzs7Ozs7O09BT0c7SUFDSCwwQkFBMEIsQ0FBQyxFQUFDLE9BQU8sRUFBRSxXQUFXLEVBQUM7UUFDL0MsTUFBTSxVQUFVLEdBQUcsbUJBQW1CLENBQUM7WUFDckMsUUFBUSxFQUFFLFdBQVcsQ0FBQyxRQUFRO1lBQzlCLFdBQVcsRUFBRSxXQUFXLENBQUMsV0FBVztZQUNwQyxzQkFBc0IsRUFBRSxPQUFPLENBQUMsc0JBQXNCLEtBQUssSUFBSTtZQUMvRCxhQUFhLEVBQUUsV0FBVyxDQUFDLGFBQWE7WUFDeEMsTUFBTSxFQUFFLDJDQUEyQztZQUNuRCxPQUFPLEVBQUUsV0FBVyxDQUFDLE9BQU87WUFDNUIsVUFBVSxFQUFFLFdBQVcsQ0FBQyxVQUFVO1lBQ2xDLEtBQUssRUFBRSxXQUFXLENBQUMsS0FBSztZQUN4QixhQUFhLEVBQUUsT0FBTyxDQUFDLGFBQWEsS0FBSyxTQUFTLENBQUMsQ0FBQyxDQUFDLElBQUksQ0FBQyxDQUFDLENBQUMsV0FBVyxDQUFDLGFBQWE7WUFDckYsVUFBVSxFQUFFLE9BQU8sQ0FBQyxhQUFhLEtBQUssU0FBUyxDQUFDLENBQUMsQ0FBQyxXQUFXLENBQUMsQ0FBQyxDQUFDLFdBQVc7WUFDM0UsR0FBRyxDQUFDLFdBQVcsQ0FBQyxTQUFTLEtBQUssSUFBSSxDQUFDLENBQUMsQ0FBQyxFQUFFLENBQUMsQ0FBQyxDQUFDLEVBQUMsU0FBUyxFQUFFLFdBQVcsQ0FBQyxTQUFTLEVBQUMsQ0FBQztTQUM5RSxDQUFDLENBQUE7UUFFRixPQUFPLFVBQVUsQ0FBQyxRQUFRLENBQUMsQ0FBQyxNQUFNLENBQUMsVUFBVSxDQUFDLENBQUMsTUFBTSxDQUFDLEtBQUssQ0FBQyxDQUFBO0lBQzlELENBQUM7SUFFRDs7Ozs7Ozs7T0FRRztJQUNILHdCQUF3QixDQUFDLEVBQUMsV0FBVyxFQUFFLG9CQUFvQixFQUFFLGFBQWEsRUFBRSxhQUFhLEVBQUM7UUFDeEYsT0FBTyxVQUFVLENBQUMsUUFBUSxDQUFDO2FBQ3hCLE1BQU0sQ0FBQyxtQkFBbUIsQ0FBQztZQUMxQixNQUFNLEVBQUUsaURBQWlEO1lBQ3pELE9BQU8sRUFBRSxXQUFXLENBQUMsT0FBTztZQUM1QixvQkFBb0I7WUFDcEIsYUFBYTtZQUNiLEtBQUssRUFBRSxXQUFXLENBQUMsS0FBSztZQUN4QixhQUFhO1NBQ2QsQ0FBQyxDQUFDO2FBQ0YsTUFBTSxDQUFDLEtBQUssQ0FBQyxDQUFBO0lBQ2xCLENBQUM7SUFFRDs7OztPQUlHO0lBQ0gsOEJBQThCLENBQUMsb0JBQW9CO1FBQ2pELElBQUksT0FBTyxvQkFBb0IsS0FBSyxRQUFRLElBQUksb0JBQW9CLENBQUMsTUFBTSxLQUFLLENBQUMsRUFBRSxDQUFDO1lBQ2xGLE1BQU0sY0FBYyxDQUFDLElBQUksQ0FBQyxtREFBbUQsRUFBRTtnQkFDN0UsSUFBSSxFQUFFLCtDQUErQzthQUN0RCxDQUFDLENBQUE7UUFDSixDQUFDO1FBRUQsT0FBTyxvQkFBb0IsQ0FBQTtJQUM3QixDQUFDO0lBRUQ7Ozs7T0FJRztJQUNILHVCQUF1QixDQUFDLGFBQWE7UUFDbkMsTUFBTSxTQUFTLEdBQUcsQ0FBQyxlQUFlLEVBQUUsV0FBVyxFQUFFLE9BQU8sRUFBRSxVQUFVLENBQUMsQ0FBQTtRQUNyRSxNQUFNLElBQUksR0FBRyxhQUFhLElBQUksT0FBTyxhQUFhLEtBQUssUUFBUSxDQUFDLENBQUMsQ0FBQyxNQUFNLENBQUMsSUFBSSxDQUFDLGFBQWEsQ0FBQyxDQUFDLENBQUMsQ0FBQyxFQUFFLENBQUE7UUFDakcsTUFBTSxLQUFLLEdBQUcsYUFBYTtlQUN0QixPQUFPLGFBQWEsS0FBSyxRQUFRO2VBQ2pDLElBQUksQ0FBQyxNQUFNLEtBQUssU0FBUyxDQUFDLE1BQU07ZUFDaEMsSUFBSSxDQUFDLEtBQUssQ0FBQyxDQUFDLEdBQUcsRUFBRSxFQUFFLENBQUMsU0FBUyxDQUFDLFFBQVEsQ0FBQyxHQUFHLENBQUMsQ0FBQztlQUM1QyxPQUFPLGFBQWEsQ0FBQyxLQUFLLEtBQUssUUFBUTtlQUN2QyxhQUFhLENBQUMsS0FBSyxDQUFDLE1BQU0sR0FBRyxDQUFDO2VBQzlCLE9BQU8sYUFBYSxDQUFDLFNBQVMsS0FBSyxRQUFRO2VBQzNDLGFBQWEsQ0FBQyxTQUFTLENBQUMsTUFBTSxHQUFHLENBQUM7ZUFDbEMsT0FBTyxhQUFhLENBQUMsUUFBUSxLQUFLLFFBQVE7ZUFDMUMsYUFBYSxDQUFDLFFBQVEsQ0FBQyxNQUFNLEdBQUcsQ0FBQztlQUNqQyxNQUFNLENBQUMsYUFBYSxDQUFDLGFBQWEsQ0FBQyxhQUFhLENBQUM7ZUFDakQsYUFBYSxDQUFDLGFBQWEsSUFBSSxDQUFDLENBQUE7UUFFckMsSUFBSSxDQUFDLEtBQUssRUFBRSxDQUFDO1lBQ1gsTUFBTSxjQUFjLENBQUMsSUFBSSxDQUFDLDJDQUEyQyxFQUFFO2dCQUNyRSxJQUFJLEVBQUUsdUNBQXVDO2FBQzlDLENBQUMsQ0FBQTtRQUNKLENBQUM7UUFFRCxPQUFPLE1BQU0sQ0FBQyxNQUFNLENBQUM7WUFDbkIsYUFBYSxFQUFFLGFBQWEsQ0FBQyxhQUFhO1lBQzFDLFNBQVMsRUFBRSxhQUFhLENBQUMsU0FBUztZQUNsQyxLQUFLLEVBQUUsYUFBYSxDQUFDLEtBQUs7WUFDMUIsUUFBUSxFQUFFLGFBQWEsQ0FBQyxRQUFRO1NBQ2pDLENBQUMsQ0FBQTtJQUNKLENBQUM7SUFFRDs7Ozs7O09BTUc7SUFDSCxLQUFLLENBQUMsMkJBQTJCLENBQUMsRUFBRSxFQUFFLGFBQWE7UUFDakQsTUFBTSxRQUFRLEdBQUcsTUFBTSxJQUFJLENBQUMsY0FBYyxDQUFDLEVBQUUsRUFBRSxhQUFhLENBQUMsS0FBSyxDQUFDLENBQUE7UUFDbkUsTUFBTSxLQUFLLEdBQUcsUUFBUTtlQUNqQixRQUFRLENBQUMsTUFBTSxLQUFLLFlBQVk7ZUFDaEMsUUFBUSxDQUFDLFNBQVMsS0FBSyxhQUFhLENBQUMsU0FBUztlQUM5QyxRQUFRLENBQUMsUUFBUSxLQUFLLGFBQWEsQ0FBQyxRQUFRO2VBQzVDLFFBQVEsQ0FBQyxhQUFhLEtBQUssYUFBYSxDQUFDLGFBQWEsQ0FBQTtRQUUzRCxJQUFJLENBQUMsS0FBSyxFQUFFLENBQUM7WUFDWCxNQUFNLGNBQWMsQ0FBQyxJQUFJLENBQUMscURBQXFELEVBQUU7Z0JBQy9FLElBQUksRUFBRSwyQ0FBMkM7YUFDbEQsQ0FBQyxDQUFBO1FBQ0osQ0FBQztJQUNILENBQUM7SUFFRDs7Ozs7Ozs7O09BU0c7SUFDSCxLQUFLLENBQUMsZ0JBQWdCLENBQUMsRUFBQyxXQUFXLEVBQUUsT0FBTyxFQUFFLElBQUksRUFBRSxPQUFPLEVBQUM7UUFDMUQsTUFBTSxJQUFJLENBQUMsV0FBVyxFQUFFLENBQUE7UUFFeEIsTUFBTSxxQkFBcUIsR0FBRyxJQUFJLENBQUMscUJBQXFCLENBQUMsV0FBVyxDQUFDLENBQUE7UUFDckUsTUFBTSxXQUFXLEdBQUcsSUFBSSxDQUFDLFdBQVcsQ0FBQyxFQUFDLE9BQU8sRUFBRSxJQUFJLEVBQUUsT0FBTyxFQUFDLENBQUMsQ0FBQTtRQUU5RCxPQUFPLE1BQU0sSUFBSSxDQUFDLHdCQUF3QixDQUFDLEtBQUssRUFBRSxFQUFFLEVBQUUsRUFBRTtZQUN0RCxNQUFNLFNBQVMsR0FBRyxNQUFNLEVBQUU7aUJBQ3ZCLFFBQVEsRUFBRTtpQkFDVixJQUFJLENBQUMsbUJBQW1CLENBQUM7aUJBQ3pCLEtBQUssQ0FBQyxFQUFDLFlBQVksRUFBRSxxQkFBcUIsRUFBQyxDQUFDO2lCQUM1QyxLQUFLLENBQUMsQ0FBQyxDQUFDO2lCQUNSLE9BQU8sRUFBRSxDQUFBO1lBQ1osTUFBTSxVQUFVLEdBQUcsU0FBUyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxNQUFNLENBQUMsNERBQTRELENBQUMsQ0FBQyxTQUFTLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxNQUFNLENBQUMsQ0FBQyxDQUFDLENBQUMsSUFBSSxDQUFBO1lBQ25JLE1BQU0sUUFBUSxHQUFHLFVBQVUsQ0FBQyxDQUFDLENBQUMsTUFBTSxJQUFJLENBQUMsY0FBYyxDQUFDLEVBQUUsRUFBRSxVQUFVLENBQUMsQ0FBQyxDQUFDLENBQUMsSUFBSSxDQUFBO1lBQzlFLDBFQUEwRTtZQUMxRSxJQUFJLGNBQWMsR0FBRyxJQUFJLENBQUE7WUFDekIsSUFBSSxhQUFhLEdBQUcsSUFBSSxDQUFBO1lBRXhCLElBQUksUUFBUSxFQUFFLE1BQU0sS0FBSyxRQUFRLEVBQUUsQ0FBQztnQkFDbEMsTUFBTSxZQUFZLEdBQUcsTUFBTSxJQUFJLENBQUMsbUJBQW1CLENBQUMsRUFBRSxFQUFFO29CQUN0RCxTQUFTLEVBQUUsVUFBVTtvQkFDckIsSUFBSSxFQUFFLEVBQUMsTUFBTSxFQUFFLFdBQVcsRUFBQztvQkFDM0IsVUFBVSxFQUFFLEVBQUMsRUFBRSxFQUFFLFFBQVEsQ0FBQyxFQUFFLEVBQUUsTUFBTSxFQUFFLFFBQVEsRUFBQztpQkFDaEQsQ0FBQyxDQUFBO2dCQUVGLElBQUksWUFBWSxLQUFLLENBQUMsRUFBRSxDQUFDO29CQUN2QixhQUFhLEdBQUcsUUFBUSxDQUFDLEVBQUUsQ0FBQTtvQkFDM0IsY0FBYyxHQUFHLFFBQVEsQ0FBQTtnQkFDM0IsQ0FBQztxQkFBTSxDQUFDO29CQUNOLE1BQU0sZUFBZSxHQUFHLE1BQU0sSUFBSSxDQUFDLGNBQWMsQ0FBQyxFQUFFLEVBQUUsUUFBUSxDQUFDLEVBQUUsQ0FBQyxDQUFBO29CQUVsRSxJQUFJLGVBQWUsRUFBRSxNQUFNLEtBQUssWUFBWSxFQUFFLENBQUM7d0JBQzdDLGFBQWEsR0FBRyxlQUFlLENBQUMsRUFBRSxDQUFBO3dCQUNsQyxjQUFjLEdBQUcsWUFBWSxDQUFBO29CQUMvQixDQUFDO2dCQUNILENBQUM7WUFDSCxDQUFDO2lCQUFNLElBQUksUUFBUSxFQUFFLE1BQU0sS0FBSyxZQUFZLEVBQUUsQ0FBQztnQkFDN0MsYUFBYSxHQUFHLFFBQVEsQ0FBQyxFQUFFLENBQUE7Z0JBQzNCLGNBQWMsR0FBRyxZQUFZLENBQUE7WUFDL0IsQ0FBQztZQUVELE1BQU0sYUFBYSxHQUFHLE1BQU0sSUFBSSxDQUFDLGtCQUFrQixDQUFDLEVBQUUsRUFBRSxxQkFBcUIsQ0FBQyxDQUFBO1lBRTlFLE1BQU0sSUFBSSxDQUFDLGtCQUFrQixDQUFDLEVBQUUsRUFBRSxFQUFDLFdBQVcsRUFBRSxXQUFXLEVBQUUscUJBQXFCLEVBQUUsYUFBYSxFQUFDLENBQUMsQ0FBQTtZQUNuRyxNQUFNLEVBQUUsQ0FBQyxNQUFNLENBQUM7Z0JBQ2QsU0FBUyxFQUFFLG1CQUFtQjtnQkFDOUIsSUFBSSxFQUFFLEVBQUMsWUFBWSxFQUFFLHFCQUFxQixFQUFFLE1BQU0sRUFBRSxXQUFXLENBQUMsS0FBSyxFQUFDO2dCQUN0RSxlQUFlLEVBQUUsQ0FBQyxjQUFjLENBQUM7Z0JBQ2pDLGFBQWEsRUFBRSxDQUFDLFFBQVEsQ0FBQzthQUMxQixDQUFDLENBQUE7WUFFRixJQUFJLGNBQWMsS0FBSyxRQUFRO2dCQUFFLE1BQU0sSUFBSSxDQUFDLGlCQUFpQixDQUFDLEVBQUUsRUFBRSxFQUFDLEdBQUcsRUFBRSxDQUFDLEVBQUUsTUFBTSxFQUFFLENBQUMsRUFBQyxDQUFDLENBQUE7WUFDdEYsT0FBTyxFQUFDLEtBQUssRUFBRSxXQUFXLENBQUMsS0FBSyxFQUFFLGFBQWEsRUFBRSxjQUFjLEVBQUMsQ0FBQTtRQUNsRSxDQUFDLEVBQUU7WUFDRCxZQUFZLEVBQUU7Z0JBQ1osY0FBYyxFQUFFLG9EQUFvRDtnQkFDcEUsSUFBSSxFQUFFLElBQUksQ0FBQyxvQkFBb0IsQ0FBQyxxQkFBcUIsQ0FBQzthQUN2RDtTQUNGLENBQUMsQ0FBQTtJQUNKLENBQUM7SUFFRDs7Ozs7T0FLRztJQUNILEtBQUssQ0FBQyxlQUFlLENBQUMsV0FBVztRQUMvQixNQUFNLElBQUksQ0FBQyxXQUFXLEVBQUUsQ0FBQTtRQUV4QixNQUFNLHFCQUFxQixHQUFHLElBQUksQ0FBQyxxQkFBcUIsQ0FBQyxXQUFXLENBQUMsQ0FBQTtRQUVyRSxPQUFPLE1BQU0sSUFBSSxDQUFDLHdCQUF3QixDQUFDLEtBQUssRUFBRSxFQUFFLEVBQUUsRUFBRTtZQUN0RCxNQUFNLFNBQVMsR0FBRyxNQUFNLEVBQUU7aUJBQ3ZCLFFBQVEsRUFBRTtpQkFDVixJQUFJLENBQUMsbUJBQW1CLENBQUM7aUJBQ3pCLEtBQUssQ0FBQyxFQUFDLFlBQVksRUFBRSxxQkFBcUIsRUFBQyxDQUFDO2lCQUM1QyxLQUFLLENBQUMsQ0FBQyxDQUFDO2lCQUNSLE9BQU8sRUFBRSxDQUFBO1lBRVosSUFBSSxDQUFDLFNBQVMsQ0FBQyxDQUFDLENBQUM7Z0JBQUUsT0FBTyxFQUFDLEtBQUssRUFBRSxJQUFJLEVBQUUsT0FBTyxFQUFFLFdBQVcsRUFBQyxDQUFBO1lBRTdELE1BQU0sS0FBSyxHQUFHLE1BQU0sQ0FBQyw0REFBNEQsQ0FBQyxDQUFDLFNBQVMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLE1BQU0sQ0FBQyxDQUFBO1lBQ3hHLE1BQU0sR0FBRyxHQUFHLE1BQU0sSUFBSSxDQUFDLGNBQWMsQ0FBQyxFQUFFLEVBQUUsS0FBSyxDQUFDLENBQUE7WUFFaEQsSUFBSSxHQUFHLEVBQUUsTUFBTSxLQUFLLFFBQVEsRUFBRSxDQUFDO2dCQUM3QixNQUFNLFlBQVksR0FBRyxNQUFNLElBQUksQ0FBQyxtQkFBbUIsQ0FBQyxFQUFFLEVBQUU7b0JBQ3RELFNBQVMsRUFBRSxVQUFVO29CQUNyQixJQUFJLEVBQUUsRUFBQyxNQUFNLEVBQUUsV0FBVyxFQUFDO29CQUMzQixVQUFVLEVBQUUsRUFBQyxFQUFFLEVBQUUsR0FBRyxDQUFDLEVBQUUsRUFBRSxNQUFNLEVBQUUsUUFBUSxFQUFDO2lCQUMzQyxDQUFDLENBQUE7Z0JBRUYsSUFBSSxZQUFZLEtBQUssQ0FBQyxFQUFFLENBQUM7b0JBQ3ZCLE1BQU0sSUFBSSxDQUFDLHlCQUF5QixDQUFDLEVBQUUsRUFBRSxFQUFDLEtBQUssRUFBRSxXQUFXLEVBQUUscUJBQXFCLEVBQUMsQ0FBQyxDQUFBO29CQUNyRixNQUFNLElBQUksQ0FBQyx1QkFBdUIsQ0FBQyxFQUFFLEVBQUUsUUFBUSxFQUFFLFdBQVcsQ0FBQyxDQUFBO29CQUU3RCxPQUFPLEVBQUMsS0FBSyxFQUFFLE9BQU8sRUFBRSxXQUFXLEVBQUMsQ0FBQTtnQkFDdEMsQ0FBQztZQUNILENBQUM7WUFFRCxNQUFNLFVBQVUsR0FBRyxNQUFNLElBQUksQ0FBQyxjQUFjLENBQUMsRUFBRSxFQUFFLEtBQUssQ0FBQyxDQUFBO1lBRXZELE1BQU0sSUFBSSxDQUFDLHlCQUF5QixDQUFDLEVBQUUsRUFBRSxFQUFDLEtBQUssRUFBRSxXQUFXLEVBQUUscUJBQXFCLEVBQUMsQ0FBQyxDQUFBO1lBRXJGLElBQUksVUFBVSxFQUFFLE1BQU0sS0FBSyxZQUFZO2dCQUFFLE9BQU8sRUFBQyxLQUFLLEVBQUUsT0FBTyxFQUFFLFlBQVksRUFBQyxDQUFBO1lBQzlFLE9BQU8sRUFBQyxLQUFLLEVBQUUsSUFBSSxFQUFFLE9BQU8sRUFBRSxXQUFXLEVBQUMsQ0FBQTtRQUM1QyxDQUFDLEVBQUU7WUFDRCxZQUFZLEVBQUU7Z0JBQ1osY0FBYyxFQUFFLG9EQUFvRDtnQkFDcEUsSUFBSSxFQUFFLElBQUksQ0FBQyxvQkFBb0IsQ0FBQyxxQkFBcUIsQ0FBQzthQUN2RDtTQUNGLENBQUMsQ0FBQTtJQUNKLENBQUM7SUFFRDs7Ozs7T0FLRztJQUNILEtBQUssQ0FBQyxlQUFlLENBQUMsV0FBVyxFQUFFLEVBQUMscUJBQXFCLEdBQUcsS0FBSyxFQUFDLEdBQUcsRUFBRTtRQUNyRSxNQUFNLElBQUksQ0FBQyxXQUFXLEVBQUUsQ0FBQTtRQUV4QixNQUFNLHFCQUFxQixHQUFHLElBQUksQ0FBQyxxQkFBcUIsQ0FBQyxXQUFXLENBQUMsQ0FBQTtRQUVyRSxJQUFJLE9BQU8scUJBQXFCLEtBQUssU0FBUyxFQUFFLENBQUM7WUFDL0MsTUFBTSxjQUFjLENBQUMsSUFBSSxDQUFDLHdEQUF3RCxDQUFDLENBQUE7UUFDckYsQ0FBQztRQUVELE9BQU8sTUFBTSxJQUFJLENBQUMsd0JBQXdCLENBQUMsS0FBSyxFQUFFLEVBQUUsRUFBRSxFQUFFO1lBQ3RELE9BQU8sTUFBTSxJQUFJLENBQUMsbUJBQW1CLENBQUMsRUFBRSxFQUFFO2dCQUN4QyxxQkFBcUI7Z0JBQ3JCLFdBQVcsRUFBRSxxQkFBcUI7YUFDbkMsQ0FBQyxDQUFBO1FBQ0osQ0FBQyxFQUFFO1lBQ0QsWUFBWSxFQUFFO2dCQUNaLGNBQWMsRUFBRSxvREFBb0Q7Z0JBQ3BFLElBQUksRUFBRSxJQUFJLENBQUMsb0JBQW9CLENBQUMscUJBQXFCLENBQUM7YUFDdkQ7U0FDRixDQUFDLENBQUE7SUFDSixDQUFDO0lBRUQ7Ozs7T0FJRztJQUNILEtBQUssQ0FBQyxhQUFhLENBQUMsV0FBVztRQUM3QixNQUFNLElBQUksQ0FBQyxXQUFXLEVBQUUsQ0FBQTtRQUV4QixNQUFNLHFCQUFxQixHQUFHLElBQUksQ0FBQyxxQkFBcUIsQ0FBQyxXQUFXLENBQUMsQ0FBQTtRQUVyRSxPQUFPLE1BQU0sSUFBSSxDQUFDLHdCQUF3QixDQUFDLEtBQUssRUFBRSxFQUFFLEVBQUUsRUFBRTtZQUN0RCxNQUFNLEdBQUcsR0FBRyxNQUFNLElBQUksQ0FBQyxrQkFBa0IsQ0FBQyxFQUFFLEVBQUUscUJBQXFCLENBQUMsQ0FBQTtZQUVwRSxJQUFJLENBQUMsR0FBRyxJQUFJLENBQUMsR0FBRyxDQUFDLE1BQU0sS0FBSyxRQUFRLElBQUksR0FBRyxDQUFDLE1BQU0sS0FBSyxZQUFZLENBQUM7Z0JBQUUsT0FBTyxFQUFDLEtBQUssRUFBRSxJQUFJLEVBQUUsT0FBTyxFQUFFLFdBQVcsRUFBQyxDQUFBO1lBQ2hILElBQUksR0FBRyxDQUFDLE1BQU0sS0FBSyxZQUFZO2dCQUFFLE9BQU8sRUFBQyxLQUFLLEVBQUUsR0FBRyxDQUFDLEVBQUUsRUFBRSxPQUFPLEVBQUUsWUFBWSxFQUFDLENBQUE7WUFFOUUsTUFBTSxLQUFLLEdBQUcsSUFBSSxDQUFDLEtBQUssQ0FBQyxHQUFHLEVBQUUsQ0FBQTtZQUU5QixJQUFJLE1BQU0sQ0FBQyxHQUFHLENBQUMsYUFBYSxDQUFDLElBQUksS0FBSztnQkFBRSxPQUFPLEVBQUMsS0FBSyxFQUFFLEdBQUcsQ0FBQyxFQUFFLEVBQUUsT0FBTyxFQUFFLGFBQWEsRUFBQyxDQUFBO1lBRXRGLE1BQU0sWUFBWSxHQUFHLE1BQU0sSUFBSSxDQUFDLG1CQUFtQixDQUFDLEVBQUUsRUFBRTtnQkFDdEQsU0FBUyxFQUFFLFVBQVU7Z0JBQ3JCLElBQUksRUFBRSxFQUFDLGVBQWUsRUFBRSxLQUFLLEVBQUM7Z0JBQzlCLFVBQVUsRUFBRSxFQUFDLEVBQUUsRUFBRSxHQUFHLENBQUMsRUFBRSxFQUFFLGVBQWUsRUFBRSxHQUFHLENBQUMsYUFBYSxFQUFFLE1BQU0sRUFBRSxRQUFRLEVBQUM7YUFDL0UsQ0FBQyxDQUFBO1lBRUYsSUFBSSxZQUFZLEtBQUssQ0FBQztnQkFBRSxPQUFPLEVBQUMsS0FBSyxFQUFFLEdBQUcsQ0FBQyxFQUFFLEVBQUUsT0FBTyxFQUFFLE9BQU8sRUFBQyxDQUFBO1lBRWhFLE1BQU0sVUFBVSxHQUFHLE1BQU0sSUFBSSxDQUFDLGtCQUFrQixDQUFDLEVBQUUsRUFBRSxxQkFBcUIsQ0FBQyxDQUFBO1lBRTNFLElBQUksVUFBVSxFQUFFLE1BQU0sS0FBSyxZQUFZO2dCQUFFLE9BQU8sRUFBQyxLQUFLLEVBQUUsVUFBVSxDQUFDLEVBQUUsRUFBRSxPQUFPLEVBQUUsWUFBWSxFQUFDLENBQUE7WUFDN0YsSUFBSSxVQUFVLEVBQUUsTUFBTSxLQUFLLFFBQVEsSUFBSSxNQUFNLENBQUMsVUFBVSxDQUFDLGFBQWEsQ0FBQyxJQUFJLEtBQUssRUFBRSxDQUFDO2dCQUNqRixPQUFPLEVBQUMsS0FBSyxFQUFFLFVBQVUsQ0FBQyxFQUFFLEVBQUUsT0FBTyxFQUFFLGFBQWEsRUFBQyxDQUFBO1lBQ3ZELENBQUM7WUFFRCxPQUFPLEVBQUMsS0FBSyxFQUFFLElBQUksRUFBRSxPQUFPLEVBQUUsV0FBVyxFQUFDLENBQUE7UUFDNUMsQ0FBQyxFQUFFO1lBQ0QsWUFBWSxFQUFFO2dCQUNaLGNBQWMsRUFBRSxvREFBb0Q7Z0JBQ3BFLElBQUksRUFBRSxJQUFJLENBQUMsb0JBQW9CLENBQUMscUJBQXFCLENBQUM7YUFDdkQ7U0FDRixDQUFDLENBQUE7SUFDSixDQUFDO0lBRUQ7Ozs7O09BS0c7SUFDSCxLQUFLLENBQUMsZ0JBQWdCLENBQUMsSUFBSSxHQUFHLEVBQUU7UUFDOUIsTUFBTSxJQUFJLENBQUMsV0FBVyxFQUFFLENBQUE7UUFFeEIsT0FBTyxNQUFNLElBQUksQ0FBQyxPQUFPLENBQUMsS0FBSyxFQUFFLEVBQUUsRUFBRSxFQUFFO1lBQ3JDLE9BQU8sTUFBTSxJQUFJLENBQUMsY0FBYyxDQUFDO2dCQUMvQixFQUFFO2dCQUNGLG1CQUFtQixFQUFFLElBQUk7Z0JBQ3pCLGFBQWEsRUFBRSxJQUFJLENBQUMsYUFBYTthQUNsQyxDQUFDLENBQUE7UUFDSixDQUFDLENBQUMsQ0FBQTtJQUNKLENBQUM7SUFFRDs7Ozs7OztPQU9HO0lBQ0gsS0FBSyxDQUFDLGdCQUFnQjtRQUNwQixNQUFNLElBQUksQ0FBQyxXQUFXLEVBQUUsQ0FBQTtRQUV4QixPQUFPLE1BQU0sSUFBSSxDQUFDLE9BQU8sQ0FBQyxLQUFLLEVBQUUsRUFBRSxFQUFFLEVBQUU7WUFDckMsT0FBTyxNQUFNLElBQUksQ0FBQyxjQUFjLENBQUMsRUFBQyxFQUFFLEVBQUUsbUJBQW1CLEVBQUUsR0FBRyxFQUFDLENBQUMsQ0FBQTtRQUNsRSxDQUFDLENBQUMsQ0FBQTtJQUNKLENBQUM7SUFFRDs7Ozs7OztPQU9HO0lBQ0gsS0FBSyxDQUFDLGNBQWMsQ0FBQyxFQUFDLEVBQUUsRUFBRSxtQkFBbUIsRUFBRSxhQUFhLEVBQUM7UUFDM0QsTUFBTSxHQUFHLEdBQUcsSUFBSSxDQUFDLEtBQUssQ0FBQyxHQUFHLEVBQUUsQ0FBQTtRQUM1QixJQUFJLEtBQUssR0FBRyxFQUFFO2FBQ1gsUUFBUSxFQUFFO2FBQ1YsSUFBSSxDQUFDLFVBQVUsQ0FBQzthQUNoQixLQUFLLENBQUMsRUFBQyxNQUFNLEVBQUUsUUFBUSxFQUFDLENBQUM7YUFDekIsS0FBSyxDQUFDLG1CQUFtQixtQkFBbUIsSUFBSSxFQUFFLENBQUMsS0FBSyxDQUFDLEdBQUcsQ0FBQyxFQUFFLENBQUMsQ0FBQTtRQUVuRSxJQUFJLG1CQUFtQixLQUFLLElBQUksRUFBRSxDQUFDO1lBQ2pDLE1BQU0sU0FBUyxHQUFHLEVBQUUsQ0FBQyxVQUFVLENBQUMsVUFBVSxDQUFDLENBQUE7WUFDM0MsTUFBTSxnQkFBZ0IsR0FBRyxFQUFFLENBQUMsVUFBVSxDQUFDLGlCQUFpQixDQUFDLENBQUE7WUFDekQsS0FBSyxHQUFHLEtBQUssQ0FBQyxLQUFLLENBQ2pCLElBQUksU0FBUyxJQUFJLEVBQUUsQ0FBQyxXQUFXLENBQUMsaUJBQWlCLENBQUMsc0JBQXNCO2dCQUN4RSxpQkFBaUIsZ0JBQWdCLFNBQVM7Z0JBQzFDLEdBQUcsZ0JBQWdCLElBQUksRUFBRSxDQUFDLFdBQVcsQ0FBQyxpQkFBaUIsQ0FBQyxNQUFNLFNBQVMsSUFBSSxFQUFFLENBQUMsV0FBVyxDQUFDLGlCQUFpQixDQUFDLE9BQU87Z0JBQ25ILEdBQUcsZ0JBQWdCLElBQUksRUFBRSxDQUFDLFdBQVcsQ0FBQyxjQUFjLENBQUMsTUFBTSxnQkFBZ0IsSUFBSSxFQUFFLENBQUMsV0FBVyxDQUFDLGlCQUFpQixDQUFDLElBQUksQ0FDckgsQ0FBQTtRQUNILENBQUM7UUFFRCxJQUFJLGFBQWE7WUFBRSxLQUFLLEdBQUcsSUFBSSxDQUFDLG1CQUFtQixDQUFDLEVBQUMsRUFBRSxFQUFFLGFBQWEsRUFBRSxLQUFLLEVBQUMsQ0FBQyxDQUFBO1FBRS9FLElBQUksbUJBQW1CLEtBQUssSUFBSSxFQUFFLENBQUM7WUFDakMsTUFBTSxhQUFhLEdBQUcsSUFBSSxDQUFDLHNCQUFzQixDQUFDLEVBQUUsQ0FBQyxDQUFBO1lBRXJELElBQUksYUFBYTtnQkFBRSxLQUFLLEdBQUcsS0FBSyxDQUFDLEtBQUssQ0FBQyxHQUFHLGFBQWEsT0FBTyxDQUFDLENBQUE7UUFDakUsQ0FBQztRQUVELEtBQUssR0FBRyxLQUFLO2FBQ1YsS0FBSyxDQUFDLHFCQUFxQixDQUFDO2FBQzVCLEtBQUssQ0FBQyxtQkFBbUIsQ0FBQzthQUMxQixLQUFLLENBQUMsQ0FBQyxDQUFDLENBQUE7UUFFWCxNQUFNLElBQUksR0FBRyxNQUFNLEtBQUssQ0FBQyxPQUFPLEVBQUUsQ0FBQTtRQUNsQyxNQUFNLEdBQUcsR0FBRyxJQUFJLENBQUMsQ0FBQyxDQUFDLENBQUE7UUFFbkIsSUFBSSxDQUFDLEdBQUc7WUFBRSxPQUFPLElBQUksQ0FBQTtRQUVyQixPQUFPLElBQUksQ0FBQyxnQkFBZ0IsQ0FBQyxHQUFHLENBQUMsQ0FBQTtJQUNuQyxDQUFDO0lBRUQ7Ozs7Ozs7Ozs7OztPQVlHO0lBQ0gsc0JBQXNCLENBQUMsRUFBRTtRQUN2QixNQUFNLE1BQU0sR0FBRyxJQUFJLENBQUMsYUFBYSxDQUFDLHVCQUF1QixFQUFFLENBQUMsTUFBTSxJQUFJLEVBQUUsQ0FBQTtRQUN4RSxzQ0FBc0M7UUFDdEMsTUFBTSxXQUFXLEdBQUcsRUFBRSxDQUFBO1FBRXRCLEtBQUssTUFBTSxDQUFDLEtBQUssRUFBRSxXQUFXLENBQUMsSUFBSSxNQUFNLENBQUMsT0FBTyxDQUFDLE1BQU0sQ0FBQyxFQUFFLENBQUM7WUFDMUQsTUFBTSxRQUFRLEdBQUcsV0FBVyxFQUFFLFFBQVEsQ0FBQTtZQUV0QyxJQUFJLE1BQU0sQ0FBQyxRQUFRLENBQUMsUUFBUSxDQUFDLElBQUksTUFBTSxDQUFDLFFBQVEsQ0FBQyxLQUFLLENBQUM7Z0JBQUUsV0FBVyxDQUFDLElBQUksQ0FBQyxDQUFDLEtBQUssRUFBRSxNQUFNLENBQUMsUUFBUSxDQUFDLENBQUMsQ0FBQyxDQUFBO1FBQ3RHLENBQUM7UUFFRCxJQUFJLFdBQVcsQ0FBQyxNQUFNLEtBQUssQ0FBQztZQUFFLE9BQU8sSUFBSSxDQUFBO1FBRXpDLE1BQU0sV0FBVyxHQUFHLEVBQUUsQ0FBQyxXQUFXLENBQUMsT0FBTyxDQUFDLENBQUE7UUFDM0MsTUFBTSxLQUFLLEdBQUcsV0FBVzthQUN0QixHQUFHLENBQUMsQ0FBQyxDQUFDLEtBQUssRUFBRSxRQUFRLENBQUMsRUFBRSxFQUFFLENBQUMsUUFBUSxFQUFFLENBQUMsS0FBSyxDQUFDLEtBQUssQ0FBQyxTQUFTLFFBQVEsRUFBRSxDQUFDO2FBQ3RFLElBQUksQ0FBQyxHQUFHLENBQUMsQ0FBQTtRQUVaLE9BQU8saUJBQWlCLFdBQVcsS0FBSyxFQUFFLENBQUMsS0FBSyxDQUFDLDRCQUE0QixDQUFDLEtBQUssS0FBSyxhQUFhLENBQUE7SUFDdkcsQ0FBQztJQUVEOzs7O09BSUc7SUFDSCxLQUFLLENBQUMsTUFBTSxDQUFDLEtBQUs7UUFDaEIsTUFBTSxJQUFJLENBQUMsV0FBVyxFQUFFLENBQUE7UUFFeEIsT0FBTyxNQUFNLElBQUksQ0FBQyxPQUFPLENBQUMsS0FBSyxFQUFFLEVBQUUsRUFBRSxFQUFFO1lBQ3JDLE1BQU0sS0FBSyxHQUFHLEVBQUU7aUJBQ2IsUUFBUSxFQUFFO2lCQUNWLElBQUksQ0FBQyxVQUFVLENBQUM7aUJBQ2hCLEtBQUssQ0FBQyxFQUFDLEVBQUUsRUFBRSxLQUFLLEVBQUMsQ0FBQztpQkFDbEIsS0FBSyxDQUFDLENBQUMsQ0FBQyxDQUFBO1lBRVgsTUFBTSxJQUFJLEdBQUcsTUFBTSxLQUFLLENBQUMsT0FBTyxFQUFFLENBQUE7WUFDbEMsTUFBTSxHQUFHLEdBQUcsSUFBSSxDQUFDLENBQUMsQ0FBQyxDQUFBO1lBRW5CLElBQUksQ0FBQyxHQUFHO2dCQUFFLE9BQU8sSUFBSSxDQUFBO1lBRXJCLE9BQU8sSUFBSSxDQUFDLGdCQUFnQixDQUFDLEdBQUcsQ0FBQyxDQUFBO1FBQ25DLENBQUMsQ0FBQyxDQUFBO0lBQ0osQ0FBQztJQUVEOzs7T0FHRztJQUNILEtBQUssQ0FBQyxjQUFjO1FBQ2xCLE1BQU0sSUFBSSxDQUFDLFdBQVcsRUFBRSxDQUFBO1FBRXhCLE9BQU8sTUFBTSxJQUFJLENBQUMsT0FBTyxDQUFDLEtBQUssRUFBRSxFQUFFLEVBQUUsRUFBRTtZQUNyQyxNQUFNLElBQUksR0FBRyxNQUFNLEVBQUU7aUJBQ2xCLFFBQVEsRUFBRTtpQkFDVixJQUFJLENBQUMsVUFBVSxDQUFDO2lCQUNoQixNQUFNLENBQUMsUUFBUSxDQUFDO2lCQUNoQixNQUFNLENBQUMsbUJBQW1CLENBQUM7aUJBQzNCLEtBQUssQ0FBQyxRQUFRLENBQUM7aUJBQ2YsT0FBTyxFQUFFLENBQUE7WUFFWjs7Z0RBRW9DO1lBQ3BDLE1BQU0sTUFBTSxHQUFHLEVBQUUsQ0FBQTtZQUVqQixLQUFLLE1BQU0sR0FBRyxJQUFJLElBQUksRUFBRSxDQUFDO2dCQUN2QixNQUFNLFFBQVEsR0FBRyw0REFBNEQsQ0FBQyxDQUFDLEdBQUcsQ0FBQyxDQUFBO2dCQUVuRixNQUFNLENBQUMsTUFBTSxDQUFDLFFBQVEsQ0FBQyxNQUFNLENBQUMsQ0FBQyxHQUFHLElBQUksQ0FBQyxnQkFBZ0IsQ0FBQyxRQUFRLENBQUMsS0FBSyxDQUFDLElBQUksQ0FBQyxDQUFBO1lBQzlFLENBQUM7WUFFRCxPQUFPLE1BQU0sQ0FBQTtRQUNmLENBQUMsQ0FBQyxDQUFBO0lBQ0osQ0FBQztJQUVEOzs7OztPQUtHO0lBQ0gsS0FBSyxDQUFDLGFBQWE7UUFDakIsTUFBTSxJQUFJLENBQUMsV0FBVyxFQUFFLENBQUE7UUFFeEIsT0FBTyxNQUFNLElBQUksQ0FBQyx3QkFBd0IsQ0FBQyxLQUFLLEVBQUUsRUFBRSxFQUFFLEVBQUU7WUFDdEQsT0FBTyxNQUFNLElBQUksQ0FBQyxnQ0FBZ0MsQ0FBQyxFQUFFLENBQUMsQ0FBQTtRQUN4RCxDQUFDLENBQUMsQ0FBQTtJQUNKLENBQUM7SUFFRDs7Ozs7O09BTUc7SUFDSCxLQUFLLENBQUMsU0FBUyxDQUFDLEVBQUMsTUFBTSxFQUFFLE9BQU8sRUFBQyxHQUFHLEVBQUU7UUFDcEMsTUFBTSxJQUFJLENBQUMsV0FBVyxFQUFFLENBQUE7UUFFeEIsT0FBTyxNQUFNLElBQUksQ0FBQyxPQUFPLENBQUMsS0FBSyxFQUFFLEVBQUUsRUFBRSxFQUFFO1lBQ3JDLElBQUksS0FBSyxHQUFHLEVBQUUsQ0FBQyxRQUFRLEVBQUUsQ0FBQyxJQUFJLENBQUMsVUFBVSxDQUFDLENBQUMsTUFBTSxDQUFDLG1CQUFtQixDQUFDLENBQUE7WUFFdEUsSUFBSSxNQUFNO2dCQUFFLEtBQUssR0FBRyxLQUFLLENBQUMsS0FBSyxDQUFDLEVBQUMsTUFBTSxFQUFDLENBQUMsQ0FBQTtZQUN6QyxJQUFJLE9BQU87Z0JBQUUsS0FBSyxHQUFHLEtBQUssQ0FBQyxLQUFLLENBQUMsRUFBQyxRQUFRLEVBQUUsT0FBTyxFQUFDLENBQUMsQ0FBQTtZQUVyRCxNQUFNLElBQUksR0FBRyxNQUFNLEtBQUssQ0FBQyxPQUFPLEVBQUUsQ0FBQTtZQUNsQyxNQUFNLFFBQVEsR0FBRyw0REFBNEQsQ0FBQyxDQUFDLElBQUksQ0FBQyxDQUFDLENBQUMsSUFBSSxFQUFFLENBQUMsQ0FBQTtZQUU3RixPQUFPLElBQUksQ0FBQyxnQkFBZ0IsQ0FBQyxRQUFRLENBQUMsS0FBSyxDQUFDLElBQUksQ0FBQyxDQUFBO1FBQ25ELENBQUMsQ0FBQyxDQUFBO0lBQ0osQ0FBQztJQUVEOzs7Ozs7Ozs7O09BVUc7SUFDSCxLQUFLLENBQUMsUUFBUSxDQUFDLEVBQUMsTUFBTSxFQUFFLE9BQU8sRUFBRSxLQUFLLEdBQUcsRUFBRSxFQUFFLE1BQU0sR0FBRyxDQUFDLEVBQUUsVUFBVSxHQUFHLGFBQWEsRUFBRSxhQUFhLEdBQUcsTUFBTSxFQUFDLEdBQUcsRUFBRTtRQUMvRyxNQUFNLElBQUksQ0FBQyxXQUFXLEVBQUUsQ0FBQTtRQUV4QixNQUFNLE1BQU0sR0FBRyxnQkFBZ0IsQ0FBQyxVQUFVLENBQUMsSUFBSSxnQkFBZ0IsQ0FBQyxXQUFXLENBQUE7UUFDM0UsTUFBTSxTQUFTLEdBQUcsYUFBYSxLQUFLLEtBQUssQ0FBQyxDQUFDLENBQUMsS0FBSyxDQUFDLENBQUMsQ0FBQyxNQUFNLENBQUE7UUFFMUQsT0FBTyxNQUFNLElBQUksQ0FBQyxPQUFPLENBQUMsS0FBSyxFQUFFLEVBQUUsRUFBRSxFQUFFO1lBQ3JDLElBQUksS0FBSyxHQUFHLEVBQUUsQ0FBQyxRQUFRLEVBQUUsQ0FBQyxJQUFJLENBQUMsVUFBVSxDQUFDLENBQUE7WUFFMUMsSUFBSSxNQUFNO2dCQUFFLEtBQUssR0FBRyxLQUFLLENBQUMsS0FBSyxDQUFDLEVBQUMsTUFBTSxFQUFDLENBQUMsQ0FBQTtZQUN6QyxJQUFJLE9BQU87Z0JBQUUsS0FBSyxHQUFHLEtBQUssQ0FBQyxLQUFLLENBQUMsRUFBQyxRQUFRLEVBQUUsT0FBTyxFQUFDLENBQUMsQ0FBQTtZQUVyRCxLQUFLLEdBQUcsS0FBSyxDQUFDLEtBQUssQ0FBQyxFQUFDLE1BQU0sRUFBRSxTQUFTLEVBQUMsQ0FBQyxDQUFBO1lBQ3hDLElBQUksTUFBTSxLQUFLLGdCQUFnQixDQUFDLFdBQVc7Z0JBQUUsS0FBSyxHQUFHLEtBQUssQ0FBQyxLQUFLLENBQUMsRUFBQyxNQUFNLEVBQUUsZ0JBQWdCLENBQUMsV0FBVyxFQUFFLFNBQVMsRUFBRSxNQUFNLEVBQUMsQ0FBQyxDQUFBO1lBRTNILE1BQU0sSUFBSSxHQUFHLE1BQU0sS0FBSyxDQUFDLEtBQUssQ0FBQyxLQUFLLENBQUMsQ0FBQyxNQUFNLENBQUMsTUFBTSxDQUFDLENBQUMsT0FBTyxFQUFFLENBQUE7WUFFOUQsT0FBTyxJQUFJLENBQUMsR0FBRyxDQUFDLENBQUMsR0FBRyxFQUFFLEVBQUUsQ0FBQyxJQUFJLENBQUMsZ0JBQWdCLENBQUMsR0FBRyxDQUFDLENBQUMsQ0FBQTtRQUN0RCxDQUFDLENBQUMsQ0FBQTtJQUNKLENBQUM7SUFFRDs7Ozs7OztPQU9HO0lBQ0gsS0FBSyxDQUFDLGFBQWEsQ0FBQyxFQUFDLEtBQUssRUFBRSxTQUFTLEdBQUcsVUFBVSxFQUFFLEVBQUUsUUFBUSxFQUFDO1FBQzdELE1BQU0sSUFBSSxDQUFDLFdBQVcsRUFBRSxDQUFBO1FBRXhCLE1BQU0sYUFBYSxHQUFHLElBQUksQ0FBQyxLQUFLLENBQUMsR0FBRyxFQUFFLENBQUE7UUFFdEMsT0FBTyxNQUFNLElBQUksQ0FBQyx3QkFBd0IsQ0FBQyxLQUFLLEVBQUUsRUFBRSxFQUFFLEVBQUU7WUFDdEQsTUFBTSxXQUFXLEdBQUcsTUFBTSxJQUFJLENBQUMsY0FBYyxDQUFDLEVBQUUsRUFBRSxLQUFLLENBQUMsQ0FBQTtZQUN4RCxJQUFJLENBQUMsV0FBVyxJQUFJLFdBQVcsQ0FBQyxNQUFNLEtBQUssUUFBUTtnQkFBRSxPQUFPLElBQUksQ0FBQTtZQUNoRSxNQUFNLFNBQVMsR0FBRyxNQUFNLElBQUksQ0FBQyw4QkFBOEIsQ0FBQyxFQUFFLEVBQUUsV0FBVyxDQUFDLENBQUE7WUFFNUUsSUFBSSxDQUFDLFNBQVM7Z0JBQUUsT0FBTyxJQUFJLENBQUE7WUFDM0IsSUFBSSxTQUFTLENBQUMsY0FBYyxJQUFJLENBQUMsQ0FBQyxNQUFNLElBQUksQ0FBQyxtQkFBbUIsQ0FBQyxFQUFFLEVBQUUsU0FBUyxDQUFDLGNBQWMsQ0FBQyxDQUFDO2dCQUFFLE9BQU8sSUFBSSxDQUFBO1lBQzVHLE1BQU0sWUFBWSxHQUFHLE1BQU0sSUFBSSxDQUFDLG1CQUFtQixDQUFDLEVBQUUsRUFBRTtnQkFDdEQsU0FBUyxFQUFFLFVBQVU7Z0JBQ3JCLElBQUksRUFBRTtvQkFDSixNQUFNLEVBQUUsWUFBWTtvQkFDcEIsZ0JBQWdCLEVBQUUsYUFBYTtvQkFDL0IsVUFBVSxFQUFFLFNBQVM7b0JBQ3JCLFNBQVMsRUFBRSxRQUFRLElBQUksSUFBSTtvQkFDM0IsR0FBRyxJQUFJLENBQUMsMkJBQTJCLEVBQUU7aUJBQ3RDO2dCQUNELFVBQVUsRUFBRSxFQUFDLGVBQWUsRUFBRSxTQUFTLENBQUMsY0FBYyxFQUFFLEVBQUUsRUFBRSxLQUFLLEVBQUUsTUFBTSxFQUFFLFFBQVEsRUFBQzthQUNyRixDQUFDLENBQUE7WUFFRixJQUFJLFlBQVksS0FBSyxDQUFDLEVBQUUsQ0FBQztnQkFDdkIsTUFBTSxJQUFJLENBQUMsbUJBQW1CLENBQUMsRUFBRSxFQUFFLFNBQVMsQ0FBQyxjQUFjLENBQUMsQ0FBQTtnQkFDNUQsT0FBTyxJQUFJLENBQUE7WUFDYixDQUFDO1lBRUQsTUFBTSxJQUFJLENBQUMsdUJBQXVCLENBQUMsRUFBRSxFQUFFLFFBQVEsRUFBRSxZQUFZLENBQUMsQ0FBQTtZQUM5RCxvREFBb0Q7WUFDcEQsTUFBTSxZQUFZLEdBQUc7Z0JBQ25CLEdBQUcsU0FBUztnQkFDWixHQUFHLElBQUksQ0FBQywwQkFBMEIsRUFBRTtnQkFDcEMsYUFBYTtnQkFDYixTQUFTO2dCQUNULE1BQU0sRUFBRSxZQUFZO2dCQUNwQixRQUFRLEVBQUUsUUFBUSxJQUFJLElBQUk7YUFDM0IsQ0FBQTtZQUVELE9BQU8sRUFBQyxhQUFhLEVBQUUsU0FBUyxFQUFFLEdBQUcsRUFBRSxZQUFZLEVBQUMsQ0FBQTtRQUN0RCxDQUFDLENBQUMsQ0FBQTtJQUNKLENBQUM7SUFFRDs7Ozs7Ozs7T0FRRztJQUNILEtBQUssQ0FBQyxhQUFhLENBQUMsRUFBQyxLQUFLLEVBQUUsU0FBUyxFQUFFLFFBQVEsRUFBRSxhQUFhLEVBQUM7UUFDN0QsTUFBTSxJQUFJLENBQUMsV0FBVyxFQUFFLENBQUE7UUFFeEIsT0FBTyxNQUFNLElBQUksQ0FBQyx3QkFBd0IsQ0FBQyxLQUFLLEVBQUUsRUFBRSxFQUFFLEVBQUU7WUFDdEQsTUFBTSxHQUFHLEdBQUcsTUFBTSxJQUFJLENBQUMsY0FBYyxDQUFDLEVBQUUsRUFBRSxLQUFLLENBQUMsQ0FBQTtZQUVoRCxJQUFJLENBQUMsR0FBRztnQkFBRSxPQUFPLEtBQUssQ0FBQTtZQUN0QixJQUFJLENBQUMsSUFBSSxDQUFDLG1CQUFtQixDQUFDLEVBQUMsR0FBRyxFQUFFLFNBQVMsRUFBRSxRQUFRLEVBQUUsYUFBYSxFQUFDLENBQUM7Z0JBQUUsT0FBTyxLQUFLLENBQUE7WUFFdEYsTUFBTSxJQUFJLENBQUMsbUJBQW1CLENBQUMsRUFBRSxFQUFFLEdBQUcsQ0FBQyxjQUFjLENBQUMsQ0FBQTtZQUN0RCxNQUFNLFlBQVksR0FBRyxNQUFNLElBQUksQ0FBQyxtQkFBbUIsQ0FBQyxFQUFFLEVBQUU7Z0JBQ3RELFNBQVMsRUFBRSxVQUFVO2dCQUNyQixJQUFJLEVBQUU7b0JBQ0osTUFBTSxFQUFFLFdBQVc7b0JBQ25CLGVBQWUsRUFBRSxJQUFJLENBQUMsS0FBSyxDQUFDLEdBQUcsRUFBRTtpQkFDbEM7Z0JBQ0QsVUFBVSxFQUFFLElBQUksQ0FBQyx3QkFBd0IsQ0FBQyxHQUFHLENBQUM7YUFDL0MsQ0FBQyxDQUFBO1lBRUYsSUFBSSxZQUFZLEtBQUssQ0FBQztnQkFBRSxPQUFPLEtBQUssQ0FBQTtZQUNwQyxNQUFNLElBQUksQ0FBQywrQkFBK0IsQ0FBQyxFQUFFLEVBQUUsR0FBRyxDQUFDLENBQUE7WUFDbkQsTUFBTSxJQUFJLENBQUMsbUJBQW1CLENBQUMsRUFBRSxFQUFFLEdBQUcsQ0FBQyxjQUFjLENBQUMsQ0FBQTtZQUN0RCxNQUFNLElBQUksQ0FBQyx1QkFBdUIsQ0FBQyxFQUFFLEVBQUUsWUFBWSxFQUFFLFdBQVcsQ0FBQyxDQUFBO1lBQ2pFLE9BQU8sSUFBSSxDQUFBO1FBQ2IsQ0FBQyxDQUFDLENBQUE7SUFDSixDQUFDO0lBRUQ7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7T0FtQkc7SUFDSCxLQUFLLENBQUMsaUJBQWlCLENBQUMsRUFBQyxLQUFLLEVBQUUsU0FBUyxFQUFFLFFBQVEsRUFBRSxhQUFhLEVBQUUsWUFBWSxFQUFFLFdBQVcsRUFBRSxlQUFlLEVBQUUsUUFBUSxFQUFFLGNBQWMsRUFBQztRQUN2SSxNQUFNLElBQUksQ0FBQyxXQUFXLEVBQUUsQ0FBQTtRQUV4QixPQUFPLE1BQU0sSUFBSSxDQUFDLDZCQUE2QixDQUFDLEtBQUssRUFBRSxFQUFFLEVBQUUsRUFBRTtZQUMzRCxNQUFNLEdBQUcsR0FBRyxNQUFNLElBQUksQ0FBQyxjQUFjLENBQUMsRUFBRSxFQUFFLEtBQUssQ0FBQyxDQUFBO1lBRWhELElBQUksQ0FBQyxHQUFHO2dCQUFFLE9BQU8sS0FBSyxDQUFBO1lBQ3RCLElBQUksQ0FBQyxJQUFJLENBQUMsbUJBQW1CLENBQUMsRUFBQyxHQUFHLEVBQUUsU0FBUyxFQUFFLFFBQVEsRUFBRSxhQUFhLEVBQUMsQ0FBQztnQkFBRSxPQUFPLEtBQUssQ0FBQTtZQUV0RixNQUFNLElBQUksR0FBRyxFQUFFLENBQUE7WUFDZixJQUFJLE9BQU8sWUFBWSxLQUFLLFFBQVE7Z0JBQUUsSUFBSSxDQUFDLG9CQUFvQixHQUFHLFlBQVksQ0FBQTtZQUM5RSxJQUFJLE9BQU8sV0FBVyxLQUFLLFFBQVE7Z0JBQUUsSUFBSSxDQUFDLG1CQUFtQixHQUFHLFdBQVcsQ0FBQTtZQUMzRSxJQUFJLE9BQU8sZUFBZSxLQUFLLFFBQVE7Z0JBQUUsSUFBSSxDQUFDLGlCQUFpQixHQUFHLGVBQWUsQ0FBQTtZQUNqRixJQUFJLE9BQU8sUUFBUSxLQUFLLFFBQVE7Z0JBQUUsSUFBSSxDQUFDLFNBQVMsR0FBRyxRQUFRLENBQUE7WUFDM0QsSUFBSSxPQUFPLGNBQWMsS0FBSyxRQUFRO2dCQUFFLElBQUksQ0FBQyxlQUFlLEdBQUcsY0FBYyxDQUFBO1lBQzdFLElBQUksTUFBTSxDQUFDLElBQUksQ0FBQyxJQUFJLENBQUMsQ0FBQyxNQUFNLEtBQUssQ0FBQztnQkFBRSxPQUFPLEtBQUssQ0FBQTtZQUVoRCxNQUFNLFlBQVksR0FBRyxNQUFNLElBQUksQ0FBQyxtQkFBbUIsQ0FBQyxFQUFFLEVBQUU7Z0JBQ3RELFNBQVMsRUFBRSxVQUFVO2dCQUNyQixJQUFJO2dCQUNKLFVBQVUsRUFBRSxJQUFJLENBQUMsd0JBQXdCLENBQUMsR0FBRyxDQUFDO2FBQy9DLENBQUMsQ0FBQTtZQUVGLE9BQU8sWUFBWSxLQUFLLENBQUMsQ0FBQTtRQUMzQixDQUFDLENBQUMsQ0FBQTtJQUNKLENBQUM7SUFFRDs7O09BR0c7SUFDSCwyQkFBMkI7UUFDekIsT0FBTyxFQUFDLGlCQUFpQixFQUFFLElBQUksRUFBRSxTQUFTLEVBQUUsSUFBSSxFQUFFLG9CQUFvQixFQUFFLElBQUksRUFBRSxtQkFBbUIsRUFBRSxJQUFJLEVBQUUsZUFBZSxFQUFFLElBQUksRUFBQyxDQUFBO0lBQ2pJLENBQUM7SUFFRDs7O09BR0c7SUFDSCwwQkFBMEI7UUFDeEIsT0FBTyxFQUFDLGVBQWUsRUFBRSxJQUFJLEVBQUUsUUFBUSxFQUFFLElBQUksRUFBRSxpQkFBaUIsRUFBRSxJQUFJLEVBQUUsZ0JBQWdCLEVBQUUsSUFBSSxFQUFFLGNBQWMsRUFBRSxJQUFJLEVBQUMsQ0FBQTtJQUN2SCxDQUFDO0lBRUQ7Ozs7Ozs7Ozs7T0FVRztJQUNILEtBQUssQ0FBQyxlQUFlLENBQUMsRUFBQyxLQUFLLEVBQUUsT0FBTyxFQUFFLFNBQVMsRUFBRSxRQUFRLEVBQUUsYUFBYSxFQUFDO1FBQ3hFLE1BQU0sSUFBSSxDQUFDLFdBQVcsRUFBRSxDQUFBO1FBQ3hCLElBQUksQ0FBQywwQkFBMEIsQ0FBQyxPQUFPLENBQUMsQ0FBQTtRQUV4QyxPQUFPLE1BQU0sSUFBSSxDQUFDLHdCQUF3QixDQUFDLEtBQUssRUFBRSxFQUFFLEVBQUUsRUFBRTtZQUN0RCxNQUFNLEdBQUcsR0FBRyxNQUFNLElBQUksQ0FBQyxjQUFjLENBQUMsRUFBRSxFQUFFLEtBQUssQ0FBQyxDQUFBO1lBRWhELElBQUksQ0FBQyxHQUFHO2dCQUFFLE9BQU8sS0FBSyxDQUFBO1lBQ3RCLElBQUksQ0FBQyxJQUFJLENBQUMsbUJBQW1CLENBQUMsRUFBQyxHQUFHLEVBQUUsU0FBUyxFQUFFLFFBQVEsRUFBRSxhQUFhLEVBQUMsQ0FBQztnQkFBRSxPQUFPLEtBQUssQ0FBQTtZQUV0RixNQUFNLElBQUksQ0FBQyxtQkFBbUIsQ0FBQyxFQUFFLEVBQUUsR0FBRyxDQUFDLGNBQWMsQ0FBQyxDQUFBO1lBQ3RELE1BQU0sYUFBYSxHQUFHLElBQUksQ0FBQyxnQkFBZ0IsQ0FBQyxPQUFPLENBQUMsQ0FBQTtZQUNwRCxNQUFNLFlBQVksR0FBRyxNQUFNLElBQUksQ0FBQyxtQkFBbUIsQ0FBQyxFQUFFLEVBQUU7Z0JBQ3RELFNBQVMsRUFBRSxVQUFVO2dCQUNyQixJQUFJLEVBQUU7b0JBQ0osTUFBTSxFQUFFLFFBQVE7b0JBQ2hCLGVBQWUsRUFBRSxhQUFhO29CQUM5QixnQkFBZ0IsRUFBRSxJQUFJO29CQUN0QixVQUFVLEVBQUUsSUFBSTtvQkFDaEIsU0FBUyxFQUFFLElBQUk7b0JBQ2YsR0FBRyxJQUFJLENBQUMsMkJBQTJCLEVBQUU7aUJBQ3RDO2dCQUNELFVBQVUsRUFBRSxJQUFJLENBQUMsd0JBQXdCLENBQUMsR0FBRyxDQUFDO2FBQy9DLENBQUMsQ0FBQTtZQUVGLElBQUksWUFBWSxLQUFLLENBQUM7Z0JBQUUsT0FBTyxLQUFLLENBQUE7WUFDcEMsTUFBTSxJQUFJLENBQUMsbUJBQW1CLENBQUMsRUFBRSxFQUFFLEdBQUcsQ0FBQyxjQUFjLENBQUMsQ0FBQTtZQUN0RCxNQUFNLElBQUksQ0FBQyx1QkFBdUIsQ0FBQyxFQUFFLEVBQUUsWUFBWSxFQUFFLFFBQVEsQ0FBQyxDQUFBO1lBQzlELE9BQU8sSUFBSSxDQUFBO1FBQ2IsQ0FBQyxDQUFDLENBQUE7SUFDSixDQUFDO0lBRUQ7Ozs7OztPQU1HO0lBQ0gsS0FBSyxDQUFDLG1CQUFtQixDQUFDLEVBQUMsS0FBSyxFQUFFLFNBQVMsRUFBQztRQUMxQyxNQUFNLElBQUksQ0FBQyxXQUFXLEVBQUUsQ0FBQTtRQUV4QixNQUFNLElBQUksQ0FBQyx3QkFBd0IsQ0FBQyxLQUFLLEVBQUUsRUFBRSxFQUFFLEVBQUU7WUFDL0MsTUFBTSxHQUFHLEdBQUcsTUFBTSxJQUFJLENBQUMsY0FBYyxDQUFDLEVBQUUsRUFBRSxLQUFLLENBQUMsQ0FBQTtZQUNoRCxJQUFJLENBQUMsR0FBRyxJQUFJLEdBQUcsQ0FBQyxTQUFTLEtBQUssU0FBUyxJQUFJLEdBQUcsQ0FBQyxNQUFNLEtBQUssWUFBWTtnQkFBRSxPQUFNO1lBQzlFLE1BQU0sSUFBSSxDQUFDLG1CQUFtQixDQUFDLEVBQUUsRUFBRSxHQUFHLENBQUMsY0FBYyxDQUFDLENBQUE7WUFDdEQsTUFBTSxZQUFZLEdBQUcsTUFBTSxJQUFJLENBQUMsbUJBQW1CLENBQUMsRUFBRSxFQUFFO2dCQUN0RCxTQUFTLEVBQUUsVUFBVTtnQkFDckIsSUFBSSxFQUFFO29CQUNKLE1BQU0sRUFBRSxRQUFRO29CQUNoQixlQUFlLEVBQUUsSUFBSSxDQUFDLEtBQUssQ0FBQyxHQUFHLEVBQUU7b0JBQ2pDLGdCQUFnQixFQUFFLElBQUk7b0JBQ3RCLFVBQVUsRUFBRSxJQUFJO29CQUNoQixTQUFTLEVBQUUsSUFBSTtvQkFDZixHQUFHLElBQUksQ0FBQywyQkFBMkIsRUFBRTtpQkFDdEM7Z0JBQ0QsVUFBVSxFQUFFLEVBQUMsVUFBVSxFQUFFLFNBQVMsRUFBRSxFQUFFLEVBQUUsS0FBSyxFQUFFLE1BQU0sRUFBRSxZQUFZLEVBQUM7YUFDckUsQ0FBQyxDQUFBO1lBQ0YsSUFBSSxZQUFZLEtBQUssQ0FBQyxFQUFFLENBQUM7Z0JBQ3ZCLE1BQU0sSUFBSSxDQUFDLG1CQUFtQixDQUFDLEVBQUUsRUFBRSxHQUFHLENBQUMsY0FBYyxDQUFDLENBQUE7Z0JBQ3RELE1BQU0sSUFBSSxDQUFDLHVCQUF1QixDQUFDLEVBQUUsRUFBRSxZQUFZLEVBQUUsUUFBUSxDQUFDLENBQUE7WUFDaEUsQ0FBQztRQUNILENBQUMsQ0FBQyxDQUFBO0lBQ0osQ0FBQztJQUVEOzs7Ozs7Ozs7Ozs7T0FZRztJQUNILEtBQUssQ0FBQyxzQkFBc0IsQ0FBQyxFQUFDLFFBQVEsRUFBQztRQUNyQyxNQUFNLElBQUksQ0FBQyxXQUFXLEVBQUUsQ0FBQTtRQUV4QixNQUFNLElBQUksR0FBRyxNQUFNLElBQUksQ0FBQyxPQUFPLENBQUMsS0FBSyxFQUFFLEVBQUUsRUFBRSxFQUFFLENBQzNDLE1BQU0sRUFBRSxDQUFDLFFBQVEsRUFBRSxDQUFDLElBQUksQ0FBQyxVQUFVLENBQUMsQ0FBQyxLQUFLLENBQUMsRUFBQyxNQUFNLEVBQUUsWUFBWSxFQUFFLFNBQVMsRUFBRSxRQUFRLEVBQUMsQ0FBQyxDQUFDLE9BQU8sRUFBRSxDQUNsRyxDQUFBO1FBRUQsd0RBQXdEO1FBQ3hELE1BQU0sUUFBUSxHQUFHLEVBQUUsQ0FBQTtRQUVuQixLQUFLLE1BQU0sR0FBRyxJQUFJLElBQUksRUFBRSxDQUFDO1lBQ3ZCLE1BQU0sR0FBRyxHQUFHLElBQUksQ0FBQyxnQkFBZ0IsQ0FBQyxHQUFHLENBQUMsQ0FBQTtZQUV0QyxJQUFJLEdBQUcsQ0FBQyxTQUFTO2dCQUFFLFFBQVEsQ0FBQyxJQUFJLENBQUMsRUFBQyxLQUFLLEVBQUUsR0FBRyxDQUFDLEVBQUUsRUFBRSxTQUFTLEVBQUUsR0FBRyxDQUFDLFNBQVMsRUFBQyxDQUFDLENBQUE7UUFDN0UsQ0FBQztRQUVELE9BQU8sUUFBUSxDQUFBO0lBQ2pCLENBQUM7SUFFRDs7Ozs7T0FLRztJQUNILEtBQUssQ0FBQyxxQkFBcUI7UUFDekIsTUFBTSxJQUFJLENBQUMsV0FBVyxFQUFFLENBQUE7UUFFeEIsTUFBTSxJQUFJLEdBQUcsTUFBTSxJQUFJLENBQUMsT0FBTyxDQUFDLEtBQUssRUFBRSxFQUFFLEVBQUUsRUFBRSxDQUFDLE1BQU0sRUFBRTthQUNuRCxRQUFRLEVBQUU7YUFDVixJQUFJLENBQUMsVUFBVSxDQUFDO2FBQ2hCLEtBQUssQ0FBQyxFQUFDLE1BQU0sRUFBRSxZQUFZLEVBQUMsQ0FBQzthQUM3QixLQUFLLENBQUMsbUJBQW1CLENBQUM7YUFDMUIsS0FBSyxDQUFDLFFBQVEsQ0FBQzthQUNmLE9BQU8sRUFBRSxDQUFDLENBQUE7UUFDYixrRUFBa0U7UUFDbEUsTUFBTSxRQUFRLEdBQUcsRUFBRSxDQUFBO1FBRW5CLEtBQUssTUFBTSxHQUFHLElBQUksSUFBSSxFQUFFLENBQUM7WUFDdkIsTUFBTSxHQUFHLEdBQUcsSUFBSSxDQUFDLGdCQUFnQixDQUFDLEdBQUcsQ0FBQyxDQUFBO1lBRXRDLElBQUksQ0FBQyxHQUFHLENBQUMsU0FBUyxJQUFJLENBQUMsR0FBRyxDQUFDLFFBQVEsSUFBSSxPQUFPLEdBQUcsQ0FBQyxhQUFhLEtBQUssUUFBUTtnQkFBRSxTQUFRO1lBRXRGLFFBQVEsQ0FBQyxJQUFJLENBQUM7Z0JBQ1osYUFBYSxFQUFFLEdBQUcsQ0FBQyxhQUFhO2dCQUNoQyxTQUFTLEVBQUUsR0FBRyxDQUFDLFNBQVM7Z0JBQ3hCLEtBQUssRUFBRSxHQUFHLENBQUMsRUFBRTtnQkFDYixRQUFRLEVBQUUsR0FBRyxDQUFDLFFBQVE7YUFDdkIsQ0FBQyxDQUFBO1FBQ0osQ0FBQztRQUVELE9BQU8sUUFBUSxDQUFBO0lBQ2pCLENBQUM7SUFFRDs7Ozs7Ozs7T0FRRztJQUNILEtBQUssQ0FBQyxvQkFBb0IsQ0FBQyxFQUFDLFFBQVEsRUFBRSxLQUFLLEVBQUM7UUFDMUMsTUFBTSxJQUFJLENBQUMsV0FBVyxFQUFFLENBQUE7UUFFeEIsT0FBTyxNQUFNLElBQUksQ0FBQyx3QkFBd0IsQ0FBQyxLQUFLLEVBQUUsRUFBRSxFQUFFLEVBQUU7WUFDdEQsNkNBQTZDO1lBQzdDLE1BQU0sVUFBVSxHQUFHLEVBQUUsQ0FBQTtZQUVyQixLQUFLLE1BQU0sT0FBTyxJQUFJLFFBQVEsRUFBRSxDQUFDO2dCQUMvQixNQUFNLEdBQUcsR0FBRyxNQUFNLElBQUksQ0FBQyxjQUFjLENBQUMsRUFBRSxFQUFFLE9BQU8sQ0FBQyxLQUFLLENBQUMsQ0FBQTtnQkFFeEQsSUFBSSxDQUFDLEdBQUcsSUFBSSxHQUFHLENBQUMsTUFBTSxLQUFLLFlBQVk7b0JBQUUsU0FBUTtnQkFDakQsSUFBSSxHQUFHLENBQUMsU0FBUyxLQUFLLE9BQU8sQ0FBQyxTQUFTO29CQUFFLFNBQVE7Z0JBQ2pELElBQUksR0FBRyxDQUFDLFFBQVEsS0FBSyxPQUFPLENBQUMsUUFBUTtvQkFBRSxTQUFRO2dCQUMvQyxJQUFJLEdBQUcsQ0FBQyxhQUFhLEtBQUssT0FBTyxDQUFDLGFBQWE7b0JBQUUsU0FBUTtnQkFFekQsVUFBVSxDQUFDLElBQUksQ0FBQztvQkFDZCxVQUFVLEVBQUU7d0JBQ1YsZ0JBQWdCLEVBQUUsT0FBTyxDQUFDLGFBQWE7d0JBQ3ZDLFVBQVUsRUFBRSxPQUFPLENBQUMsU0FBUzt3QkFDN0IsRUFBRSxFQUFFLE9BQU8sQ0FBQyxLQUFLO3dCQUNqQixNQUFNLEVBQUUsWUFBWTt3QkFDcEIsU0FBUyxFQUFFLE9BQU8sQ0FBQyxRQUFRO3FCQUM1QjtvQkFDRCxHQUFHO2lCQUNKLENBQUMsQ0FBQTtZQUNKLENBQUM7WUFFRCxPQUFPLE1BQU0sSUFBSSxDQUFDLHFCQUFxQixDQUFDLEVBQUMsRUFBRSxFQUFFLEtBQUssRUFBRSxVQUFVLEVBQUMsQ0FBQyxDQUFBO1FBQ2xFLENBQUMsQ0FBQyxDQUFBO0lBQ0osQ0FBQztJQUVEOzs7Ozs7Ozs7T0FTRztJQUNILEtBQUssQ0FBQyxVQUFVLENBQUMsRUFBQyxLQUFLLEVBQUUsS0FBSyxFQUFFLFNBQVMsRUFBRSxRQUFRLEVBQUUsYUFBYSxFQUFDO1FBQ2pFLE1BQU0sSUFBSSxDQUFDLFdBQVcsRUFBRSxDQUFBO1FBRXhCLE9BQU8sTUFBTSxJQUFJLENBQUMsd0JBQXdCLENBQUMsS0FBSyxFQUFFLEVBQUUsRUFBRSxFQUFFO1lBQ3RELE1BQU0sR0FBRyxHQUFHLE1BQU0sSUFBSSxDQUFDLGNBQWMsQ0FBQyxFQUFFLEVBQUUsS0FBSyxDQUFDLENBQUE7WUFFaEQsSUFBSSxDQUFDLEdBQUc7Z0JBQUUsT0FBTyxJQUFJLENBQUE7WUFDckIsSUFBSSxDQUFDLElBQUksQ0FBQyxtQkFBbUIsQ0FBQyxFQUFDLEdBQUcsRUFBRSxTQUFTLEVBQUUsUUFBUSxFQUFFLGFBQWEsRUFBQyxDQUFDO2dCQUFFLE9BQU8sSUFBSSxDQUFBO1lBRXJGLE1BQU0sVUFBVSxHQUFHLE1BQU0sSUFBSSxDQUFDLGFBQWEsQ0FBQyxFQUFDLEVBQUUsRUFBRSxHQUFHLEVBQUUsS0FBSyxFQUFFLFlBQVksRUFBRSxLQUFLLEVBQUMsQ0FBQyxDQUFBO1lBRWxGLElBQUksVUFBVTtnQkFBRSxNQUFNLElBQUksQ0FBQyx1QkFBdUIsQ0FBQyxFQUFFLEVBQUUsR0FBRyxDQUFDLE1BQU0sRUFBRSxVQUFVLENBQUMsTUFBTSxDQUFDLENBQUE7WUFDckYsT0FBTyxVQUFVLENBQUE7UUFDbkIsQ0FBQyxDQUFDLENBQUE7SUFDSixDQUFDO0lBRUQ7Ozs7O09BS0c7SUFDSCxLQUFLLENBQUMsZ0JBQWdCLENBQUMsRUFBQyxlQUFlLEdBQUcsaUJBQWlCLEVBQUMsR0FBRyxFQUFFO1FBQy9ELE1BQU0sSUFBSSxDQUFDLFdBQVcsRUFBRSxDQUFBO1FBRXhCLE9BQU8sTUFBTSxJQUFJLENBQUMsd0JBQXdCLENBQUMsS0FBSyxFQUFFLEVBQUUsRUFBRSxFQUFFO1lBQ3RELE1BQU0sTUFBTSxHQUFHLElBQUksQ0FBQyxLQUFLLENBQUMsR0FBRyxFQUFFLEdBQUcsZUFBZSxDQUFBO1lBQ2pELE1BQU0sS0FBSyxHQUFHLEVBQUU7aUJBQ2IsUUFBUSxFQUFFO2lCQUNWLElBQUksQ0FBQyxVQUFVLENBQUM7aUJBQ2hCLEtBQUssQ0FBQyxFQUFDLE1BQU0sRUFBRSxZQUFZLEVBQUMsQ0FBQztpQkFDN0IsS0FBSyxDQUFDLHVCQUF1QixFQUFFLENBQUMsS0FBSyxDQUFDLE1BQU0sQ0FBQyxFQUFFLENBQUMsQ0FBQTtZQUVuRCxNQUFNLElBQUksR0FBRyxNQUFNLEtBQUssQ0FBQyxPQUFPLEVBQUUsQ0FBQTtZQUVsQyw2Q0FBNkM7WUFDN0MsTUFBTSxVQUFVLEdBQUcsRUFBRSxDQUFBO1lBRXJCLEtBQUssTUFBTSxHQUFHLElBQUksSUFBSSxFQUFFLENBQUM7Z0JBQ3ZCLE1BQU0sR0FBRyxHQUFHLElBQUksQ0FBQyxnQkFBZ0IsQ0FBQyxHQUFHLENBQUMsQ0FBQTtnQkFFdEMsd0VBQXdFO2dCQUN4RSxnRUFBZ0U7Z0JBQ2hFLHVFQUF1RTtnQkFDdkUsd0VBQXdFO2dCQUN4RSx1RUFBdUU7Z0JBQ3ZFLHVEQUF1RDtnQkFDdkQsd0VBQXdFO2dCQUN4RSxpRUFBaUU7Z0JBQ2pFLG1FQUFtRTtnQkFDbkUsaUVBQWlFO2dCQUNqRSx3RUFBd0U7Z0JBQ3hFLHVFQUF1RTtnQkFDdkUscUVBQXFFO2dCQUNyRSxVQUFVLENBQUMsSUFBSSxDQUFDO29CQUNkLFVBQVUsRUFBRSxFQUFDLEVBQUUsRUFBRSxHQUFHLENBQUMsRUFBRSxFQUFFLE1BQU0sRUFBRSxZQUFZLEVBQUUsZ0JBQWdCLEVBQUUsR0FBRyxDQUFDLGFBQWEsRUFBQztvQkFDbkYsR0FBRztpQkFDSixDQUFDLENBQUE7WUFDSixDQUFDO1lBRUQsT0FBTyxNQUFNLElBQUksQ0FBQyxxQkFBcUIsQ0FBQztnQkFDdEMsRUFBRTtnQkFDRixLQUFLLEVBQUUsNEJBQTRCO2dCQUNuQyxVQUFVO2FBQ1gsQ0FBQyxDQUFBO1FBQ0osQ0FBQyxDQUFDLENBQUE7SUFDSixDQUFDO0lBRUQ7Ozs7Ozs7O09BUUc7SUFDSCxLQUFLLENBQUMscUJBQXFCLENBQUMsRUFBQyxFQUFFLEVBQUUsS0FBSyxFQUFFLFVBQVUsRUFBQztRQUNqRCxzREFBc0Q7UUFDdEQsTUFBTSxZQUFZLEdBQUcsRUFBRSxDQUFBO1FBRXZCLEtBQUssTUFBTSxFQUFDLFVBQVUsRUFBRSxHQUFHLEVBQUMsSUFBSSxVQUFVLEVBQUUsQ0FBQztZQUMzQyxNQUFNLFdBQVcsR0FBRyxNQUFNLElBQUksQ0FBQyxhQUFhLENBQUM7Z0JBQzNDLFVBQVU7Z0JBQ1YsRUFBRTtnQkFDRixLQUFLO2dCQUNMLEdBQUc7Z0JBQ0gsWUFBWSxFQUFFLElBQUk7YUFDbkIsQ0FBQyxDQUFBO1lBRUYsSUFBSSxXQUFXO2dCQUFFLFlBQVksQ0FBQyxJQUFJLENBQUMsV0FBVyxDQUFDLENBQUE7UUFDakQsQ0FBQztRQUVELE1BQU0sWUFBWSxHQUFHLElBQUksQ0FBQyxhQUFhLENBQUMsWUFBWSxDQUFDLENBQUE7UUFDckQsTUFBTSxNQUFNLEdBQUcsSUFBSSxDQUFDLGtCQUFrQixFQUFFLENBQUE7UUFFeEMsS0FBSyxNQUFNLENBQUMsTUFBTSxFQUFFLEtBQUssQ0FBQyxJQUFJLE1BQU0sQ0FBQyxPQUFPLENBQUMsWUFBWSxDQUFDLEVBQUUsQ0FBQztZQUMzRCxNQUFNLENBQUMsVUFBVSxJQUFJLEtBQUssQ0FBQTtZQUMxQixNQUFNLENBQUMsTUFBTSxDQUFDLElBQUksS0FBSyxDQUFBO1FBQ3pCLENBQUM7UUFDRCxNQUFNLElBQUksQ0FBQyxpQkFBaUIsQ0FBQyxFQUFFLEVBQUUsTUFBTSxDQUFDLENBQUE7UUFFeEMsT0FBTyxZQUFZLENBQUE7SUFDckIsQ0FBQztJQUVEOzs7Ozs7Ozs7Ozs7T0FZRztJQUNILEtBQUssQ0FBQyxpQkFBaUIsQ0FBQyxFQUFDLGNBQWMsR0FBRyxJQUFJLEVBQUUsV0FBVyxHQUFHLElBQUksRUFBRSxTQUFTLEdBQUcsSUFBSSxFQUFDLEdBQUcsRUFBRTtRQUN4RixNQUFNLElBQUksQ0FBQyxXQUFXLEVBQUUsQ0FBQTtRQUV4QixNQUFNLEdBQUcsR0FBRyxJQUFJLENBQUMsS0FBSyxDQUFDLEdBQUcsRUFBRSxDQUFBO1FBQzVCLE1BQU0sSUFBSSxHQUFHLFNBQVMsR0FBRyxDQUFDLENBQUMsQ0FBQyxDQUFDLFNBQVMsQ0FBQyxDQUFDLENBQUMsSUFBSSxDQUFBO1FBQzdDLElBQUksT0FBTyxHQUFHLENBQUMsQ0FBQTtRQUVmLElBQUksY0FBYyxJQUFJLGNBQWMsR0FBRyxDQUFDLEVBQUUsQ0FBQztZQUN6QyxPQUFPLElBQUksTUFBTSxJQUFJLENBQUMsbUJBQW1CLENBQUMsRUFBQyxNQUFNLEVBQUUsV0FBVyxFQUFFLE1BQU0sRUFBRSxpQkFBaUIsRUFBRSxNQUFNLEVBQUUsR0FBRyxHQUFHLGNBQWMsRUFBRSxTQUFTLEVBQUUsSUFBSSxFQUFDLENBQUMsQ0FBQTtRQUM1SSxDQUFDO1FBRUQsSUFBSSxXQUFXLElBQUksV0FBVyxHQUFHLENBQUMsRUFBRSxDQUFDO1lBQ25DLE9BQU8sSUFBSSxNQUFNLElBQUksQ0FBQyxtQkFBbUIsQ0FBQyxFQUFDLE1BQU0sRUFBRSxRQUFRLEVBQUUsTUFBTSxFQUFFLGNBQWMsRUFBRSxNQUFNLEVBQUUsR0FBRyxHQUFHLFdBQVcsRUFBRSxTQUFTLEVBQUUsSUFBSSxFQUFDLENBQUMsQ0FBQTtZQUNqSSxPQUFPLElBQUksTUFBTSxJQUFJLENBQUMsbUJBQW1CLENBQUMsRUFBQyxNQUFNLEVBQUUsVUFBVSxFQUFFLE1BQU0sRUFBRSxnQkFBZ0IsRUFBRSxNQUFNLEVBQUUsR0FBRyxHQUFHLFdBQVcsRUFBRSxTQUFTLEVBQUUsSUFBSSxFQUFDLENBQUMsQ0FBQTtRQUN2SSxDQUFDO1FBRUQsT0FBTyxPQUFPLENBQUE7SUFDaEIsQ0FBQztJQUVEOzs7Ozs7Ozs7Ozs7Ozs7O09BZ0JHO0lBQ0gsS0FBSyxDQUFDLG1CQUFtQixDQUFDLEVBQUMsTUFBTSxFQUFFLE1BQU0sRUFBRSxNQUFNLEVBQUUsU0FBUyxFQUFDO1FBQzNELElBQUksT0FBTyxHQUFHLENBQUMsQ0FBQTtRQUVmLFNBQVMsQ0FBQztZQUNSLE1BQU0sVUFBVSxHQUFHLE1BQU0sSUFBSSxDQUFDLE9BQU8sQ0FBQyxLQUFLLEVBQUUsRUFBRSxFQUFFLEVBQUUsQ0FDakQsTUFBTSxFQUFFO2lCQUNMLFFBQVEsRUFBRTtpQkFDVixJQUFJLENBQUMsVUFBVSxDQUFDO2lCQUNoQixNQUFNLENBQUMsSUFBSSxDQUFDO2lCQUNaLEtBQUssQ0FBQyxFQUFDLE1BQU0sRUFBQyxDQUFDO2lCQUNmLEtBQUssQ0FBQyxHQUFHLEVBQUUsQ0FBQyxXQUFXLENBQUMsTUFBTSxDQUFDLE9BQU8sRUFBRSxDQUFDLEtBQUssQ0FBQyxNQUFNLENBQUMsRUFBRSxDQUFDO2lCQUN6RCxLQUFLLENBQUMsRUFBQyxNQUFNLEVBQUUsU0FBUyxFQUFFLEtBQUssRUFBQyxDQUFDO2lCQUNqQyxLQUFLLENBQUMsRUFBQyxNQUFNLEVBQUUsSUFBSSxFQUFFLFNBQVMsRUFBRSxLQUFLLEVBQUMsQ0FBQztpQkFDdkMsS0FBSyxDQUFDLFNBQVMsQ0FBQztpQkFDaEIsT0FBTyxFQUFFLENBQ2IsQ0FBQTtZQUVELElBQUksVUFBVSxDQUFDLE1BQU0sS0FBSyxDQUFDO2dCQUFFLE1BQUs7WUFFbEMsTUFBTSxZQUFZLEdBQUcsTUFBTSxDQUFDLE1BQU0sQ0FBQyxVQUFVLENBQUMsR0FBRyxDQUFDLENBQUMsNERBQTRELENBQUMsR0FBRyxFQUFFLEVBQUUsQ0FBQyxNQUFNLENBQUMsR0FBRyxDQUFDLEVBQUUsQ0FBQyxDQUFDLENBQUMsQ0FBQTtZQUV4SSxJQUFJLElBQUksQ0FBQyw0QkFBNEIsRUFBRSxDQUFDO2dCQUN0QyxNQUFNLElBQUksQ0FBQyw0QkFBNEIsQ0FBQyxNQUFNLENBQUMsTUFBTSxDQUFDO29CQUNwRCxVQUFVLEVBQUUsWUFBWTtvQkFDeEIsTUFBTTtvQkFDTixNQUFNO29CQUNOLE1BQU07aUJBQ1AsQ0FBQyxDQUFDLENBQUE7WUFDTCxDQUFDO1lBRUQsTUFBTSxPQUFPLEdBQUcsTUFBTSxJQUFJLENBQUMsd0JBQXdCLENBQUMsS0FBSyxFQUFFLEVBQUUsRUFBRSxFQUFFO2dCQUMvRCxNQUFNLEdBQUcsR0FBRyxZQUFZLENBQUMsR0FBRyxDQUFDLENBQUMsRUFBRSxFQUFFLEVBQUUsQ0FBQyxFQUFFLENBQUMsS0FBSyxDQUFDLEVBQUUsQ0FBQyxDQUFDLENBQUMsSUFBSSxDQUFDLElBQUksQ0FBQyxDQUFBO2dCQUU3RCxNQUFNLE9BQU8sR0FBRyxNQUFNLEVBQUUsQ0FBQyxZQUFZLENBQ25DLGVBQWUsRUFBRSxDQUFDLFVBQVUsQ0FBQyxVQUFVLENBQUMsVUFBVSxFQUFFLENBQUMsV0FBVyxDQUFDLElBQUksQ0FBQyxRQUFRLEdBQUcsU0FBUyxFQUFFLENBQUMsV0FBVyxDQUFDLFFBQVEsQ0FBQyxNQUFNLEVBQUUsQ0FBQyxLQUFLLENBQUMsTUFBTSxDQUFDLFFBQVEsRUFBRSxDQUFDLFdBQVcsQ0FBQyxNQUFNLENBQUMsT0FBTyxFQUFFLENBQUMsS0FBSyxDQUFDLE1BQU0sQ0FBQyxFQUFFLENBQ2hNLENBQUE7Z0JBRUQsTUFBTSxJQUFJLENBQUMsaUJBQWlCLENBQUMsRUFBRSxFQUFFLEVBQUMsR0FBRyxFQUFFLENBQUMsT0FBTyxFQUFFLENBQUMsTUFBTSxDQUFDLEVBQUUsQ0FBQyxPQUFPLEVBQUMsQ0FBQyxDQUFBO2dCQUVyRSxPQUFPLE9BQU8sQ0FBQTtZQUNoQixDQUFDLENBQUMsQ0FBQTtZQUVGLE9BQU8sSUFBSSxPQUFPLENBQUE7WUFDbEIsSUFBSSxVQUFVLENBQUMsTUFBTSxHQUFHLFNBQVM7Z0JBQUUsTUFBSztRQUMxQyxDQUFDO1FBRUQsT0FBTyxPQUFPLENBQUE7SUFDaEIsQ0FBQztJQUVEOzs7T0FHRztJQUNILEtBQUssQ0FBQyxRQUFRO1FBQ1osTUFBTSxJQUFJLENBQUMsV0FBVyxFQUFFLENBQUE7UUFFeEIsTUFBTSxJQUFJLENBQUMsd0JBQXdCLENBQUMsS0FBSyxFQUFFLEVBQUUsRUFBRSxFQUFFO1lBQy9DLE1BQU0sUUFBUSxHQUFHLE1BQU0sSUFBSSxDQUFDLGdDQUFnQyxDQUFDLEVBQUUsQ0FBQyxDQUFBO1lBQ2hFLElBQUksTUFBTSxFQUFFLENBQUMsV0FBVyxDQUFDLDhCQUE4QixDQUFDO2dCQUFFLE1BQU0sRUFBRSxDQUFDLEtBQUssQ0FBQyxlQUFlLEVBQUUsQ0FBQyxVQUFVLENBQUMsOEJBQThCLENBQUMsRUFBRSxDQUFDLENBQUE7WUFDeEksSUFBSSxNQUFNLEVBQUUsQ0FBQyxXQUFXLENBQUMsc0JBQXNCLENBQUM7Z0JBQUUsTUFBTSxFQUFFLENBQUMsS0FBSyxDQUFDLGVBQWUsRUFBRSxDQUFDLFVBQVUsQ0FBQyxzQkFBc0IsQ0FBQyxFQUFFLENBQUMsQ0FBQTtZQUN4SCxJQUFJLE1BQU0sRUFBRSxDQUFDLFdBQVcsQ0FBQyxtQkFBbUIsQ0FBQztnQkFBRSxNQUFNLEVBQUUsQ0FBQyxLQUFLLENBQUMsZUFBZSxFQUFFLENBQUMsVUFBVSxDQUFDLG1CQUFtQixDQUFDLEVBQUUsQ0FBQyxDQUFBO1lBQ2xILElBQUksTUFBTSxFQUFFLENBQUMsV0FBVyxDQUFDLCtCQUErQixDQUFDLEVBQUUsQ0FBQztnQkFDMUQsTUFBTSxhQUFhLEdBQUcsTUFBTSxFQUFFO3FCQUMzQixRQUFRLEVBQUU7cUJBQ1YsSUFBSSxDQUFDLCtCQUErQixDQUFDO3FCQUNyQyxNQUFNLENBQUMsY0FBYyxDQUFDO3FCQUN0QixPQUFPLEVBQUUsQ0FBQTtnQkFFWixLQUFLLE1BQU0sWUFBWSxJQUFJLGFBQWEsRUFBRSxDQUFDO29CQUN6QyxNQUFNLEVBQUUsQ0FBQyxNQUFNLENBQUM7d0JBQ2QsU0FBUyxFQUFFLCtCQUErQjt3QkFDMUMsVUFBVSxFQUFFOzRCQUNWLFlBQVksRUFBRSxNQUFNLENBQUMsNERBQTRELENBQUMsQ0FBQyxZQUFZLENBQUMsQ0FBQyxZQUFZLENBQUM7eUJBQy9HO3FCQUNGLENBQUMsQ0FBQTtnQkFDSixDQUFDO1lBQ0gsQ0FBQztZQUNELE1BQU0sRUFBRSxDQUFDLEtBQUssQ0FBQyxlQUFlLEVBQUUsQ0FBQyxVQUFVLENBQUMsVUFBVSxDQUFDLEVBQUUsQ0FBQyxDQUFBO1lBQzFELElBQUksTUFBTSxFQUFFLENBQUMsV0FBVyxDQUFDLGlCQUFpQixDQUFDO2dCQUFFLE1BQU0sRUFBRSxDQUFDLEtBQUssQ0FBQyxlQUFlLEVBQUUsQ0FBQyxVQUFVLENBQUMsaUJBQWlCLENBQUMsRUFBRSxDQUFDLENBQUE7WUFDOUcsTUFBTSxNQUFNLEdBQUcsTUFBTSxDQUFDLFdBQVcsQ0FBQyxNQUFNLENBQUMsT0FBTyxDQUFDLFFBQVEsQ0FBQyxNQUFNLENBQUMsQ0FBQyxHQUFHLENBQUMsQ0FBQyxDQUFDLEdBQUcsRUFBRSxLQUFLLENBQUMsRUFBRSxFQUFFLENBQUMsQ0FBQyxHQUFHLEVBQUUsQ0FBQyxLQUFLLENBQUMsQ0FBQyxDQUFDLENBQUE7WUFDdkcsTUFBTSxJQUFJLENBQUMsaUJBQWlCLENBQUMsRUFBRSxFQUFFLE1BQU0sQ0FBQyxDQUFBO1FBQzFDLENBQUMsQ0FBQyxDQUFBO0lBQ0osQ0FBQztJQUVEOzs7O09BSUc7SUFDSCxLQUFLLENBQUMsTUFBTSxDQUFDLEtBQUs7UUFDaEIsTUFBTSxJQUFJLENBQUMsV0FBVyxFQUFFLENBQUE7UUFDeEIsT0FBTyxNQUFNLElBQUksQ0FBQyx3QkFBd0IsQ0FBQyxLQUFLLEVBQUUsRUFBRSxFQUFFLEVBQUU7WUFDdEQsTUFBTSxHQUFHLEdBQUcsTUFBTSxJQUFJLENBQUMsY0FBYyxDQUFDLEVBQUUsRUFBRSxLQUFLLENBQUMsQ0FBQTtZQUNoRCxJQUFJLENBQUMsR0FBRyxJQUFJLENBQUMsR0FBRyxDQUFDLE1BQU0sS0FBSyxRQUFRLElBQUksR0FBRyxDQUFDLE1BQU0sS0FBSyxZQUFZLENBQUM7Z0JBQUUsT0FBTyxLQUFLLENBQUE7WUFDbEYsdUZBQXVGO1lBQ3ZGLHVFQUF1RTtZQUN2RSxJQUFJLEdBQUcsQ0FBQyxNQUFNLEtBQUssWUFBWTtnQkFBRSxNQUFNLElBQUksQ0FBQyxtQkFBbUIsQ0FBQyxFQUFFLEVBQUUsR0FBRyxDQUFDLGNBQWMsQ0FBQyxDQUFBO1lBQ3ZGLE1BQU0sWUFBWSxHQUFHLE1BQU0sSUFBSSxDQUFDLG1CQUFtQixDQUFDLEVBQUUsRUFBRSxFQUFDLFNBQVMsRUFBRSxVQUFVLEVBQUUsSUFBSSxFQUFFLEVBQUMsTUFBTSxFQUFFLFdBQVcsRUFBQyxFQUFFLFVBQVUsRUFBRSxFQUFDLEVBQUUsRUFBRSxHQUFHLENBQUMsRUFBRSxFQUFFLE1BQU0sRUFBRSxHQUFHLENBQUMsTUFBTSxFQUFDLEVBQUMsQ0FBQyxDQUFBO1lBQzNKLElBQUksWUFBWSxLQUFLLENBQUM7Z0JBQUUsT0FBTyxLQUFLLENBQUE7WUFDcEMsTUFBTSxJQUFJLENBQUMsK0JBQStCLENBQUMsRUFBRSxFQUFFLEdBQUcsQ0FBQyxDQUFBO1lBQ25ELElBQUksR0FBRyxDQUFDLE1BQU0sS0FBSyxZQUFZO2dCQUFFLE1BQU0sSUFBSSxDQUFDLG1CQUFtQixDQUFDLEVBQUUsRUFBRSxHQUFHLENBQUMsY0FBYyxDQUFDLENBQUE7WUFDdkYsTUFBTSxJQUFJLENBQUMsdUJBQXVCLENBQUMsRUFBRSxFQUFFLEdBQUcsQ0FBQyxNQUFNLEVBQUUsV0FBVyxDQUFDLENBQUE7WUFDL0QsT0FBTyxJQUFJLENBQUE7UUFDYixDQUFDLENBQUMsQ0FBQTtJQUNKLENBQUM7SUFFRDs7OztPQUlHO0lBQ0gsZUFBZSxDQUFDLFVBQVU7UUFDeEIsT0FBTyxZQUFZLENBQUMsVUFBVSxDQUFDLENBQUE7SUFDakMsQ0FBQztJQUVEOzs7Ozs7O09BT0c7SUFDSCxXQUFXLENBQUMsRUFBQyxJQUFJLEVBQUUsT0FBTyxFQUFFLE9BQU8sRUFBQztRQUNsQyxNQUFNLFdBQVcsR0FBRyxJQUFJLENBQUMsS0FBSyxDQUFDLEdBQUcsRUFBRSxDQUFBO1FBQ3BDLE1BQU0sS0FBSyxHQUFHLElBQUksQ0FBQyxlQUFlLENBQUMsT0FBTyxDQUFDLENBQUE7UUFFM0MsT0FBTztZQUNMLFFBQVEsRUFBRSxJQUFJLENBQUMsU0FBUyxDQUFDLElBQUksSUFBSSxFQUFFLENBQUM7WUFDcEMsV0FBVyxFQUFFLElBQUksQ0FBQyxtQkFBbUIsQ0FBQyxPQUFPLEVBQUUsS0FBSyxDQUFDO1lBQ3JELFdBQVc7WUFDWCxhQUFhLEVBQUUsSUFBSSxDQUFDLHVCQUF1QixDQUFDLE9BQU8sQ0FBQztZQUNwRCxLQUFLLEVBQUUsVUFBVSxFQUFFO1lBQ25CLE9BQU87WUFDUCxVQUFVLEVBQUUsSUFBSSxDQUFDLG9CQUFvQixDQUFDLE9BQU8sRUFBRSxVQUFVLENBQUM7WUFDMUQsS0FBSztZQUNMLGFBQWEsRUFBRSxJQUFJLENBQUMsdUJBQXVCLENBQUMsT0FBTyxFQUFFLGFBQWEsRUFBRSxXQUFXLENBQUM7WUFDaEYsU0FBUyxFQUFFLElBQUksQ0FBQyxzQkFBc0IsQ0FBQyxPQUFPLENBQUM7U0FDaEQsQ0FBQTtJQUNILENBQUM7SUFFRDs7Ozs7T0FLRztJQUNILHNCQUFzQixDQUFDLE9BQU87UUFDNUIsSUFBSSxPQUFPLEVBQUUsU0FBUyxLQUFLLFNBQVM7WUFBRSxPQUFPLElBQUksQ0FBQTtRQUVqRCxNQUFNLFNBQVMsR0FBRyxPQUFPLENBQUMsU0FBUyxDQUFBO1FBRW5DLElBQUksT0FBTyxTQUFTLEtBQUssUUFBUSxJQUFJLENBQUMsTUFBTSxDQUFDLFFBQVEsQ0FBQyxTQUFTLENBQUMsRUFBRSxDQUFDO1lBQ2pFLE1BQU0sY0FBYyxDQUFDLElBQUksQ0FBQyw4QkFBOEIsQ0FBQyxDQUFBO1FBQzNELENBQUM7UUFFRCxJQUFJLFNBQVMsSUFBSSxDQUFDO1lBQUUsT0FBTyxDQUFDLENBQUE7UUFFNUIsSUFBSSxDQUFDLE1BQU0sQ0FBQyxTQUFTLENBQUMsU0FBUyxDQUFDLElBQUksU0FBUyxHQUFHLGtCQUFrQixFQUFFLENBQUM7WUFDbkUsTUFBTSxjQUFjLENBQUMsSUFBSSxDQUFDLDhCQUE4QixDQUFDLENBQUE7UUFDM0QsQ0FBQztRQUVELE9BQU8sU0FBUyxDQUFBO0lBQ2xCLENBQUM7SUFFRDs7Ozs7Ozs7T0FRRztJQUNILEtBQUssQ0FBQyxrQkFBa0IsQ0FBQyxFQUFFLEVBQUUsRUFBQyxXQUFXLEVBQUUsV0FBVyxFQUFFLGFBQWEsR0FBRyxJQUFJLEVBQUM7UUFDM0UsTUFBTSxFQUFDLFdBQVcsRUFBQyxHQUFHLFdBQVcsQ0FBQTtRQUVqQyxJQUFJLFdBQVcsRUFBRSxDQUFDO1lBQ2hCLElBQUksV0FBVyxDQUFDLFlBQVksRUFBRSxDQUFDO2dCQUM3QixNQUFNLElBQUksQ0FBQywwQkFBMEIsQ0FBQyxFQUFFLEVBQUUsV0FBVyxDQUFDLENBQUE7WUFDeEQsQ0FBQztpQkFBTSxDQUFDO2dCQUNOLE1BQU0sSUFBSSxDQUFDLHFCQUFxQixDQUFDLEVBQUUsRUFBRSxXQUFXLENBQUMsQ0FBQTtZQUNuRCxDQUFDO1FBQ0gsQ0FBQztRQUVELE1BQU0sRUFBRSxDQUFDLE1BQU0sQ0FBQztZQUNkLFNBQVMsRUFBRSxVQUFVO1lBQ3JCLElBQUksRUFBRTtnQkFDSixFQUFFLEVBQUUsV0FBVyxDQUFDLEtBQUs7Z0JBQ3JCLFFBQVEsRUFBRSxXQUFXLENBQUMsT0FBTztnQkFDN0IsU0FBUyxFQUFFLFdBQVcsQ0FBQyxRQUFRO2dCQUMvQixjQUFjLEVBQUUsV0FBVyxDQUFDLGFBQWE7Z0JBQ3pDLEtBQUssRUFBRSxXQUFXLENBQUMsS0FBSztnQkFDeEIsV0FBVyxFQUFFLFdBQVcsQ0FBQyxVQUFVO2dCQUNuQyxRQUFRLEVBQUUsQ0FBQztnQkFDWCxNQUFNLEVBQUUsUUFBUTtnQkFDaEIsZUFBZSxFQUFFLFdBQVcsQ0FBQyxhQUFhO2dCQUMxQyxhQUFhLEVBQUUsV0FBVyxDQUFDLFdBQVc7Z0JBQ3RDLFlBQVksRUFBRSxXQUFXO2dCQUN6QixjQUFjLEVBQUUsYUFBYTtnQkFDN0IsZUFBZSxFQUFFLFdBQVcsRUFBRSxjQUFjLElBQUksSUFBSTtnQkFDcEQsZUFBZSxFQUFFLFdBQVcsRUFBRSxjQUFjLElBQUksSUFBSTtnQkFDcEQsVUFBVSxFQUFFLFdBQVcsQ0FBQyxTQUFTO2dCQUNqQyxVQUFVLEVBQUUsSUFBSTthQUNqQjtTQUNGLENBQUMsQ0FBQTtJQUNKLENBQUM7SUFFRDs7OztPQUlHO0lBQ0gsb0JBQW9CLENBQUMsVUFBVTtRQUM3QixPQUFPLGdDQUFnQyxDQUFDLFVBQVUsQ0FBQyxDQUFBO0lBQ3JELENBQUM7SUFFRDs7Ozs7T0FLRztJQUNILHVCQUF1QixDQUFDLGFBQWEsRUFBRSxvQkFBb0I7UUFDekQsT0FBTyxtQ0FBbUMsQ0FBQyxhQUFhLEVBQUUsb0JBQW9CLENBQUMsQ0FBQTtJQUNqRixDQUFDO0lBRUQ7Ozs7T0FJRztJQUNILGdCQUFnQixDQUFDLE9BQU87UUFDdEIsT0FBTyw0QkFBNEIsQ0FBQyxPQUFPLEVBQUUsSUFBSSxDQUFDLEtBQUssQ0FBQyxHQUFHLEVBQUUsQ0FBQyxDQUFBO0lBQ2hFLENBQUM7SUFFRDs7OztPQUlHO0lBQ0gsMEJBQTBCLENBQUMsT0FBTztRQUNoQyw0QkFBNEIsQ0FBQyxPQUFPLEVBQUUsQ0FBQyxDQUFDLENBQUE7SUFDMUMsQ0FBQztJQUVEOzs7O09BSUc7SUFDSCxxQkFBcUIsQ0FBQyxXQUFXO1FBQy9CLE9BQU8saUNBQWlDLENBQUMsV0FBVyxDQUFDLENBQUE7SUFDdkQsQ0FBQztJQUVEOzs7O09BSUc7SUFDSCxvQkFBb0IsQ0FBQyxXQUFXO1FBQzlCLE1BQU0sSUFBSSxHQUFHLFVBQVUsQ0FBQyxRQUFRLENBQUMsQ0FBQyxNQUFNLENBQUMsV0FBVyxDQUFDLENBQUMsTUFBTSxDQUFDLEtBQUssQ0FBQyxDQUFDLEtBQUssQ0FBQyxDQUFDLEVBQUUsRUFBRSxDQUFDLENBQUE7UUFFaEYsT0FBTyw0QkFBNEIsSUFBSSxFQUFFLENBQUE7SUFDM0MsQ0FBQztJQUVEOzs7Ozs7OztPQVFHO0lBQ0gsS0FBSyxDQUFDLGFBQWEsQ0FBQyxVQUFVO1FBQzVCLE1BQU0sSUFBSSxDQUFDLFlBQVksQ0FBQyxVQUFVLENBQUMsQ0FBQTtJQUNyQyxDQUFDO0lBRUQ7Ozs7OztPQU1HO0lBQ0gsS0FBSyxDQUFDLFlBQVksQ0FBQyxVQUFVO1FBQzNCLDZFQUE2RTtRQUM3RSxnRkFBZ0Y7UUFDaEYsOEVBQThFO1FBQzlFLGlGQUFpRjtRQUNqRiwyRUFBMkU7UUFDM0UsK0VBQStFO1FBQy9FLHNFQUFzRTtRQUN0RSxNQUFNLFVBQVUsR0FBRyxJQUFJLENBQUMscUJBQXFCLEVBQUUsSUFBSSxTQUFTLENBQUE7UUFDNUQsTUFBTSxRQUFRLEdBQUcsaUJBQWlCLENBQUMsR0FBRyxDQUFDLFVBQVUsQ0FBQyxJQUFJLE9BQU8sQ0FBQyxPQUFPLEVBQUUsQ0FBQTtRQUN2RSxNQUFNLG1CQUFtQixHQUFHLEtBQUssSUFBSSxFQUFFO1lBQ3JDLElBQUksVUFBVSxFQUFFLENBQUM7Z0JBQ2YsTUFBTSxJQUFJLENBQUMsaUJBQWlCLENBQUMsVUFBVSxDQUFDLENBQUE7Z0JBRXhDLE9BQU07WUFDUixDQUFDO1lBRUQsTUFBTSxJQUFJLENBQUMsT0FBTyxDQUFDLENBQUMsRUFBRSxFQUFFLEVBQUUsQ0FBQyxJQUFJLENBQUMsaUJBQWlCLENBQUMsRUFBRSxDQUFDLENBQUMsQ0FBQTtRQUN4RCxDQUFDLENBQUE7UUFDRCxNQUFNLEdBQUcsR0FBRyxRQUFRLENBQUMsSUFBSSxDQUFDLG1CQUFtQixFQUFFLG1CQUFtQixDQUFDLENBQUE7UUFFbkUsaUZBQWlGO1FBQ2pGLDJFQUEyRTtRQUMzRSxpQkFBaUIsQ0FBQyxHQUFHLENBQUMsVUFBVSxFQUFFLEdBQUcsQ0FBQyxJQUFJLENBQUMsR0FBRyxFQUFFLEdBQUUsQ0FBQyxFQUFFLEdBQUcsRUFBRSxHQUFFLENBQUMsQ0FBQyxDQUFDLENBQUE7UUFFL0QsT0FBTyxNQUFNLEdBQUcsQ0FBQTtJQUNsQixDQUFDO0lBRUQ7Ozs7O09BS0c7SUFDSCxLQUFLLENBQUMsaUJBQWlCLENBQUMsRUFBRTtRQUN4QixNQUFNLElBQUksQ0FBQyxzQkFBc0IsQ0FBQyxFQUFFLENBQUMsQ0FBQTtRQUVyQyxNQUFNLGNBQWMsR0FBRyxNQUFNLElBQUksQ0FBQyxhQUFhLENBQUMsRUFBRSxDQUFDLENBQUE7UUFDbkQsTUFBTSxxQkFBcUIsR0FBRyxNQUFNLElBQUksQ0FBQyxhQUFhLENBQUMsRUFBRSxFQUFFLCtCQUErQixDQUFDLENBQUE7UUFDM0YsTUFBTSxlQUFlLEdBQUcsTUFBTSxFQUFFLENBQUMsV0FBVyxDQUFDLFVBQVUsQ0FBQyxDQUFBO1FBRXhELHlFQUF5RTtRQUN6RSx5RUFBeUU7UUFDekUsc0VBQXNFO1FBQ3RFLHlFQUF5RTtRQUN6RSxnRUFBZ0U7UUFDaEUsSUFBSSxjQUFjLElBQUksZUFBZSxJQUFJLENBQUMscUJBQXFCLEVBQUUsQ0FBQztZQUNoRSxNQUFNLElBQUksQ0FBQyx1QkFBdUIsQ0FBQyxFQUFFLENBQUMsQ0FBQTtZQUN0QyxNQUFNLElBQUksQ0FBQywyQkFBMkIsQ0FBQyxFQUFFLENBQUMsQ0FBQTtZQUMxQyxNQUFNLElBQUksQ0FBQyxrQ0FBa0MsQ0FBQyxFQUFFLENBQUMsQ0FBQTtZQUNqRCxNQUFNLElBQUksQ0FBQyx3QkFBd0IsQ0FBQyxFQUFFLENBQUMsQ0FBQTtZQUN2QyxNQUFNLElBQUksQ0FBQyx1QkFBdUIsQ0FBQyxFQUFFLENBQUMsQ0FBQTtZQUN0QyxNQUFNLElBQUksQ0FBQyx5QkFBeUIsQ0FBQyxFQUFFLENBQUMsQ0FBQTtZQUN4QyxNQUFNLElBQUksQ0FBQywyQkFBMkIsQ0FBQyxFQUFFLENBQUMsQ0FBQTtZQUUxQyxPQUFNO1FBQ1IsQ0FBQztRQUVELElBQUksY0FBYyxJQUFJLENBQUMscUJBQXFCLEVBQUUsQ0FBQztZQUM3QyxNQUFNLElBQUksQ0FBQyxnQkFBZ0IsQ0FBQyxFQUFFLEVBQUUsK0JBQStCLENBQUMsQ0FBQTtRQUNsRSxDQUFDO1FBRUQsTUFBTSxJQUFJLENBQUMsZ0JBQWdCLENBQUMsRUFBRSxDQUFDLENBQUE7UUFDL0IsTUFBTSxJQUFJLENBQUMsdUJBQXVCLENBQUMsRUFBRSxDQUFDLENBQUE7UUFDdEMsTUFBTSxJQUFJLENBQUMsMkJBQTJCLENBQUMsRUFBRSxDQUFDLENBQUE7UUFDMUMsTUFBTSxJQUFJLENBQUMsa0NBQWtDLENBQUMsRUFBRSxDQUFDLENBQUE7UUFDakQsTUFBTSxJQUFJLENBQUMsd0JBQXdCLENBQUMsRUFBRSxDQUFDLENBQUE7UUFDdkMsTUFBTSxJQUFJLENBQUMsdUJBQXVCLENBQUMsRUFBRSxDQUFDLENBQUE7UUFDdEMsTUFBTSxJQUFJLENBQUMseUJBQXlCLENBQUMsRUFBRSxDQUFDLENBQUE7UUFFeEMsSUFBSSxjQUFjLEVBQUUsQ0FBQztZQUNuQix5RUFBeUU7WUFDekUseUVBQXlFO1lBQ3pFLE1BQU0sSUFBSSxDQUFDLHFCQUFxQixDQUFDLEVBQUUsQ0FBQyxDQUFBO1lBQ3BDLE1BQU0sRUFBRSxDQUFDLE1BQU0sQ0FBQztnQkFDZCxTQUFTLEVBQUUsZ0JBQWdCO2dCQUMzQixVQUFVLEVBQUUsRUFBQyxHQUFHLEVBQUUsSUFBSSxDQUFDLGFBQWEsQ0FBQywrQkFBK0IsQ0FBQyxFQUFDO2FBQ3ZFLENBQUMsQ0FBQTtZQUVGLE9BQU07UUFDUixDQUFDO1FBRUQsTUFBTSxJQUFJLENBQUMsZ0JBQWdCLENBQUMsRUFBRSxFQUFFLGlCQUFpQixDQUFDLENBQUE7SUFDcEQsQ0FBQztJQUVEOzs7O09BSUc7SUFDSCxLQUFLLENBQUMsc0JBQXNCLENBQUMsRUFBRTtRQUM3QixJQUFJLE1BQU0sRUFBRSxDQUFDLFdBQVcsQ0FBQyxnQkFBZ0IsQ0FBQztZQUFFLE9BQU07UUFFbEQsTUFBTSxLQUFLLEdBQUcsSUFBSSxTQUFTLENBQUMsZ0JBQWdCLEVBQUUsRUFBQyxXQUFXLEVBQUUsSUFBSSxFQUFDLENBQUMsQ0FBQTtRQUVsRSxLQUFLLENBQUMsTUFBTSxDQUFDLEtBQUssRUFBRSxFQUFDLElBQUksRUFBRSxLQUFLLEVBQUUsVUFBVSxFQUFFLElBQUksRUFBQyxDQUFDLENBQUE7UUFDcEQsS0FBSyxDQUFDLE1BQU0sQ0FBQyxPQUFPLEVBQUUsRUFBQyxJQUFJLEVBQUUsS0FBSyxFQUFDLENBQUMsQ0FBQTtRQUNwQyxLQUFLLENBQUMsTUFBTSxDQUFDLFNBQVMsRUFBRSxFQUFDLElBQUksRUFBRSxLQUFLLEVBQUMsQ0FBQyxDQUFBO1FBQ3RDLEtBQUssQ0FBQyxNQUFNLENBQUMsZUFBZSxFQUFFLEVBQUMsSUFBSSxFQUFFLEtBQUssRUFBQyxDQUFDLENBQUE7UUFFNUMsTUFBTSxFQUFFLENBQUMsV0FBVyxDQUFDLEtBQUssQ0FBQyxDQUFBO0lBQzdCLENBQUM7SUFFRDs7Ozs7T0FLRztJQUNILEtBQUssQ0FBQyxhQUFhLENBQUMsRUFBRSxFQUFFLE9BQU8sR0FBRyxpQkFBaUI7UUFDakQsTUFBTSxLQUFLLEdBQUcsRUFBRTthQUNiLFFBQVEsRUFBRTthQUNWLElBQUksQ0FBQyxnQkFBZ0IsQ0FBQzthQUN0QixLQUFLLENBQUMsRUFBQyxHQUFHLEVBQUUsSUFBSSxDQUFDLGFBQWEsQ0FBQyxPQUFPLENBQUMsRUFBQyxDQUFDO2FBQ3pDLEtBQUssQ0FBQyxDQUFDLENBQUMsQ0FBQTtRQUVYLE1BQU0sSUFBSSxHQUFHLE1BQU0sS0FBSyxDQUFDLE9BQU8sRUFBRSxDQUFBO1FBRWxDLE9BQU8sSUFBSSxDQUFDLE1BQU0sR0FBRyxDQUFDLENBQUE7SUFDeEIsQ0FBQztJQUVEOzs7O09BSUc7SUFDSCxLQUFLLENBQUMsZ0JBQWdCLENBQUMsRUFBRTtRQUN2QixJQUFJLENBQUMsTUFBTSxDQUFDLElBQUksQ0FBQyxpQ0FBaUMsQ0FBQyxDQUFBO1FBRW5ELElBQUksTUFBTSxFQUFFLENBQUMsV0FBVyxDQUFDLFVBQVUsQ0FBQyxFQUFFLENBQUM7WUFDckMsSUFBSSxDQUFDLE1BQU0sQ0FBQyxJQUFJLENBQUMsd0RBQXdELENBQUMsQ0FBQTtZQUMxRSxPQUFNO1FBQ1IsQ0FBQztRQUVELE1BQU0sS0FBSyxHQUFHLElBQUksU0FBUyxDQUFDLFVBQVUsRUFBRSxFQUFDLFdBQVcsRUFBRSxJQUFJLEVBQUMsQ0FBQyxDQUFBO1FBRTVELEtBQUssQ0FBQyxNQUFNLENBQUMsSUFBSSxFQUFFLEVBQUMsVUFBVSxFQUFFLElBQUksRUFBQyxDQUFDLENBQUE7UUFDdEMsS0FBSyxDQUFDLE1BQU0sQ0FBQyxVQUFVLEVBQUUsRUFBQyxJQUFJLEVBQUUsS0FBSyxFQUFFLEtBQUssRUFBRSxJQUFJLEVBQUMsQ0FBQyxDQUFBO1FBQ3BELEtBQUssQ0FBQyxJQUFJLENBQUMsV0FBVyxFQUFFLEVBQUMsSUFBSSxFQUFFLEtBQUssRUFBQyxDQUFDLENBQUE7UUFDdEMsS0FBSyxDQUFDLE1BQU0sQ0FBQyxnQkFBZ0IsRUFBRSxFQUFDLElBQUksRUFBRSxLQUFLLEVBQUMsQ0FBQyxDQUFBO1FBQzdDLEtBQUssQ0FBQyxNQUFNLENBQUMsT0FBTyxFQUFFLEVBQUMsSUFBSSxFQUFFLElBQUksRUFBRSxLQUFLLEVBQUUsSUFBSSxFQUFDLENBQUMsQ0FBQTtRQUNoRCxLQUFLLENBQUMsT0FBTyxDQUFDLGFBQWEsRUFBRSxFQUFDLElBQUksRUFBRSxLQUFLLEVBQUMsQ0FBQyxDQUFBO1FBQzNDLEtBQUssQ0FBQyxPQUFPLENBQUMsVUFBVSxFQUFFLEVBQUMsSUFBSSxFQUFFLEtBQUssRUFBQyxDQUFDLENBQUE7UUFDeEMsS0FBSyxDQUFDLE1BQU0sQ0FBQyxRQUFRLEVBQUUsRUFBQyxJQUFJLEVBQUUsS0FBSyxFQUFFLEtBQUssRUFBRSxJQUFJLEVBQUMsQ0FBQyxDQUFBO1FBQ2xELEtBQUssQ0FBQyxNQUFNLENBQUMsaUJBQWlCLEVBQUUsRUFBQyxJQUFJLEVBQUUsS0FBSyxFQUFFLEtBQUssRUFBRSxJQUFJLEVBQUMsQ0FBQyxDQUFBO1FBQzNELEtBQUssQ0FBQyxNQUFNLENBQUMsZUFBZSxFQUFFLEVBQUMsSUFBSSxFQUFFLEtBQUssRUFBRSxLQUFLLEVBQUUsSUFBSSxFQUFDLENBQUMsQ0FBQTtRQUN6RCxLQUFLLENBQUMsTUFBTSxDQUFDLGNBQWMsRUFBRSxFQUFDLElBQUksRUFBRSxJQUFJLEVBQUUsS0FBSyxFQUFFLElBQUksRUFBQyxDQUFDLENBQUE7UUFDdkQsS0FBSyxDQUFDLE1BQU0sQ0FBQyxnQkFBZ0IsRUFBRSxFQUFDLElBQUksRUFBRSxJQUFJLEVBQUMsQ0FBQyxDQUFBO1FBQzVDLEtBQUssQ0FBQyxNQUFNLENBQUMsa0JBQWtCLEVBQUUsRUFBQyxJQUFJLEVBQUUsSUFBSSxFQUFFLEtBQUssRUFBRSxJQUFJLEVBQUMsQ0FBQyxDQUFBO1FBQzNELEtBQUssQ0FBQyxNQUFNLENBQUMsWUFBWSxFQUFFLEVBQUMsSUFBSSxFQUFFLElBQUksRUFBQyxDQUFDLENBQUE7UUFDeEMsS0FBSyxDQUFDLE1BQU0sQ0FBQyxpQkFBaUIsRUFBRSxFQUFDLElBQUksRUFBRSxJQUFJLEVBQUMsQ0FBQyxDQUFBO1FBQzdDLEtBQUssQ0FBQyxNQUFNLENBQUMsY0FBYyxFQUFFLEVBQUMsSUFBSSxFQUFFLElBQUksRUFBQyxDQUFDLENBQUE7UUFDMUMsS0FBSyxDQUFDLE1BQU0sQ0FBQyxnQkFBZ0IsRUFBRSxFQUFDLElBQUksRUFBRSxJQUFJLEVBQUUsS0FBSyxFQUFFLElBQUksRUFBQyxDQUFDLENBQUE7UUFDekQsS0FBSyxDQUFDLE1BQU0sQ0FBQyxXQUFXLEVBQUUsRUFBQyxJQUFJLEVBQUUsSUFBSSxFQUFDLENBQUMsQ0FBQTtRQUN2QyxLQUFLLENBQUMsSUFBSSxDQUFDLFlBQVksRUFBRSxFQUFDLElBQUksRUFBRSxJQUFJLEVBQUMsQ0FBQyxDQUFBO1FBQ3RDLEtBQUssQ0FBQyxNQUFNLENBQUMsaUJBQWlCLEVBQUUsRUFBQyxJQUFJLEVBQUUsSUFBSSxFQUFFLEtBQUssRUFBRSxJQUFJLEVBQUMsQ0FBQyxDQUFBO1FBQzFELEtBQUssQ0FBQyxPQUFPLENBQUMsaUJBQWlCLEVBQUUsRUFBQyxJQUFJLEVBQUUsSUFBSSxFQUFDLENBQUMsQ0FBQTtRQUM5QyxLQUFLLENBQUMsTUFBTSxDQUFDLFlBQVksRUFBRSxFQUFDLElBQUksRUFBRSxJQUFJLEVBQUMsQ0FBQyxDQUFBO1FBQ3hDLEtBQUssQ0FBQyxNQUFNLENBQUMsc0JBQXNCLEVBQUUsRUFBQyxJQUFJLEVBQUUsSUFBSSxFQUFDLENBQUMsQ0FBQTtRQUNsRCxLQUFLLENBQUMsTUFBTSxDQUFDLHFCQUFxQixFQUFFLEVBQUMsSUFBSSxFQUFFLElBQUksRUFBQyxDQUFDLENBQUE7UUFDakQsS0FBSyxDQUFDLE1BQU0sQ0FBQyxtQkFBbUIsRUFBRSxFQUFDLElBQUksRUFBRSxJQUFJLEVBQUMsQ0FBQyxDQUFBO1FBQy9DLEtBQUssQ0FBQyxPQUFPLENBQUMsV0FBVyxFQUFFLEVBQUMsSUFBSSxFQUFFLElBQUksRUFBQyxDQUFDLENBQUE7UUFDeEMsS0FBSyxDQUFDLE1BQU0sQ0FBQyxpQkFBaUIsRUFBRSxFQUFDLElBQUksRUFBRSxJQUFJLEVBQUMsQ0FBQyxDQUFBO1FBRTdDLE1BQU0sRUFBRSxDQUFDLFdBQVcsQ0FBQyxLQUFLLENBQUMsQ0FBQTtJQUM3QixDQUFDO0lBRUQ7Ozs7T0FJRztJQUNILEtBQUssQ0FBQyx1QkFBdUIsQ0FBQyxFQUFFO1FBQzlCLElBQUksQ0FBQyxDQUFDLE1BQU0sRUFBRSxDQUFDLFdBQVcsQ0FBQyxVQUFVLENBQUMsQ0FBQztZQUFFLE9BQU07UUFFL0MsTUFBTSxLQUFLLEdBQUcsTUFBTSxFQUFFLENBQUMsb0JBQW9CLENBQUMsVUFBVSxDQUFDLENBQUE7UUFDdkQsTUFBTSxtQkFBbUIsR0FBRyxNQUFNLEtBQUssQ0FBQyxlQUFlLENBQUMsZ0JBQWdCLENBQUMsQ0FBQTtRQUV6RSxJQUFJLENBQUMsbUJBQW1CLEVBQUUsQ0FBQztZQUN6QixNQUFNLFNBQVMsR0FBRyxJQUFJLFNBQVMsQ0FBQyxVQUFVLENBQUMsQ0FBQTtZQUMzQyxTQUFTLENBQUMsTUFBTSxDQUFDLGdCQUFnQixFQUFFLEVBQUMsSUFBSSxFQUFFLElBQUksRUFBQyxDQUFDLENBQUE7WUFDaEQsTUFBTSxJQUFJLEdBQUcsTUFBTSxFQUFFLENBQUMsY0FBYyxDQUFDLFNBQVMsQ0FBQyxDQUFBO1lBRS9DLEtBQUssTUFBTSxHQUFHLElBQUksSUFBSSxFQUFFLENBQUM7Z0JBQ3ZCLE1BQU0sRUFBRSxDQUFDLEtBQUssQ0FBQyxHQUFHLENBQUMsQ0FBQTtZQUNyQixDQUFDO1lBRUQsRUFBRSxDQUFDLGdCQUFnQixFQUFFLENBQUE7UUFDdkIsQ0FBQztRQUVELE1BQU0sY0FBYyxHQUFHLE1BQU0sRUFBRSxDQUFDLG9CQUFvQixDQUFDLFVBQVUsQ0FBQyxDQUFBO1FBQ2hFLE1BQU0sZUFBZSxHQUFHLE1BQU0sY0FBYyxDQUFDLGVBQWUsQ0FBQyxZQUFZLENBQUMsQ0FBQTtRQUUxRSxJQUFJLENBQUMsZUFBZSxFQUFFLENBQUM7WUFDckIsTUFBTSxRQUFRLEdBQUcsR0FBRyxlQUFlLG9CQUFvQixDQUFBO1lBQ3ZELE1BQU0sUUFBUSxHQUFHLE1BQU0sRUFBRSxDQUFDLG1CQUFtQixDQUFDLFFBQVEsQ0FBQyxDQUFBO1lBRXZELElBQUksQ0FBQyxRQUFRO2dCQUFFLE1BQU0sSUFBSSxLQUFLLENBQUMsdURBQXVELENBQUMsQ0FBQTtZQUV2RixJQUFJLENBQUM7Z0JBQ0gsRUFBRSxDQUFDLGdCQUFnQixFQUFFLENBQUE7Z0JBQ3JCLE1BQU0sV0FBVyxHQUFHLE1BQU0sRUFBRSxDQUFDLG9CQUFvQixDQUFDLFVBQVUsQ0FBQyxDQUFBO2dCQUU3RCxJQUFJLENBQUMsQ0FBQyxNQUFNLFdBQVcsQ0FBQyxlQUFlLENBQUMsWUFBWSxDQUFDLENBQUMsRUFBRSxDQUFDO29CQUN2RCxNQUFNLFNBQVMsR0FBRyxJQUFJLFNBQVMsQ0FBQyxVQUFVLENBQUMsQ0FBQTtvQkFDM0MsU0FBUyxDQUFDLE1BQU0sQ0FBQyxZQUFZLEVBQUUsRUFBQyxJQUFJLEVBQUUsSUFBSSxFQUFDLENBQUMsQ0FBQTtvQkFDNUMsTUFBTSxJQUFJLEdBQUcsTUFBTSxFQUFFLENBQUMsY0FBYyxDQUFDLFNBQVMsQ0FBQyxDQUFBO29CQUUvQyxLQUFLLE1BQU0sR0FBRyxJQUFJLElBQUksRUFBRSxDQUFDO3dCQUN2QixNQUFNLEVBQUUsQ0FBQyxLQUFLLENBQUMsR0FBRyxDQUFDLENBQUE7b0JBQ3JCLENBQUM7b0JBRUQsRUFBRSxDQUFDLGdCQUFnQixFQUFFLENBQUE7Z0JBQ3ZCLENBQUM7WUFDSCxDQUFDO29CQUFTLENBQUM7Z0JBQ1QsTUFBTSxFQUFFLENBQUMsbUJBQW1CLENBQUMsUUFBUSxDQUFDLENBQUE7WUFDeEMsQ0FBQztRQUNILENBQUM7UUFFRCxNQUFNLElBQUksQ0FBQywyQkFBMkIsQ0FBQyxFQUFFLENBQUMsQ0FBQTtRQUMxQyxNQUFNLElBQUksQ0FBQyxxQkFBcUIsQ0FBQyxFQUFFLENBQUMsQ0FBQTtRQUVwQyxNQUFNLFFBQVEsR0FBRyxHQUFHLGVBQWUsc0JBQXNCLENBQUE7UUFDekQsTUFBTSxRQUFRLEdBQUcsTUFBTSxFQUFFLENBQUMsbUJBQW1CLENBQUMsUUFBUSxDQUFDLENBQUE7UUFFdkQsSUFBSSxDQUFDLFFBQVE7WUFBRSxNQUFNLElBQUksS0FBSyxDQUFDLDJEQUEyRCxDQUFDLENBQUE7UUFFM0YsSUFBSSxDQUFDO1lBQ0gseUVBQXlFO1lBQ3pFLG9FQUFvRTtZQUNwRSwyQkFBMkI7WUFDM0IsRUFBRSxDQUFDLGdCQUFnQixFQUFFLENBQUE7WUFDckIsTUFBTSxXQUFXLEdBQUcsTUFBTSxFQUFFLENBQUMsb0JBQW9CLENBQUMsVUFBVSxDQUFDLENBQUE7WUFDN0QsTUFBTSxzQkFBc0IsR0FBRyxDQUFDLGlCQUFpQixFQUFFLGlCQUFpQixDQUFDLENBQUE7WUFFckUsS0FBSyxNQUFNLHFCQUFxQixJQUFJLHNCQUFzQixFQUFFLENBQUM7Z0JBQzNELElBQUksTUFBTSxXQUFXLENBQUMsZUFBZSxDQUFDLHFCQUFxQixDQUFDO29CQUFFLFNBQVE7Z0JBRXRFLE1BQU0sU0FBUyxHQUFHLElBQUksU0FBUyxDQUFDLFVBQVUsQ0FBQyxDQUFBO2dCQUMzQyxJQUFJLHFCQUFxQixJQUFJLGlCQUFpQixFQUFFLENBQUM7b0JBQy9DLFNBQVMsQ0FBQyxNQUFNLENBQUMsaUJBQWlCLEVBQUUsRUFBQyxJQUFJLEVBQUUsSUFBSSxFQUFFLEtBQUssRUFBRSxJQUFJLEVBQUMsQ0FBQyxDQUFBO2dCQUNoRSxDQUFDO3FCQUFNLENBQUM7b0JBQ04sU0FBUyxDQUFDLE9BQU8sQ0FBQyxpQkFBaUIsRUFBRSxFQUFDLElBQUksRUFBRSxJQUFJLEVBQUMsQ0FBQyxDQUFBO2dCQUNwRCxDQUFDO2dCQUVELEtBQUssTUFBTSxHQUFHLElBQUksTUFBTSxFQUFFLENBQUMsY0FBYyxDQUFDLFNBQVMsQ0FBQztvQkFBRSxNQUFNLEVBQUUsQ0FBQyxLQUFLLENBQUMsR0FBRyxDQUFDLENBQUE7WUFDM0UsQ0FBQztZQUVELEVBQUUsQ0FBQyxnQkFBZ0IsRUFBRSxDQUFBO1FBQ3ZCLENBQUM7Z0JBQVMsQ0FBQztZQUNULE1BQU0sRUFBRSxDQUFDLG1CQUFtQixDQUFDLFFBQVEsQ0FBQyxDQUFBO1FBQ3hDLENBQUM7UUFFRCxNQUFNLElBQUksQ0FBQyxrQkFBa0IsQ0FBQyxFQUFFLENBQUMsQ0FBQTtRQUNqQyxNQUFNLElBQUksQ0FBQyx3QkFBd0IsQ0FBQyxFQUFFLENBQUMsQ0FBQTtRQUN2QyxNQUFNLElBQUksQ0FBQywwQkFBMEIsQ0FBQyxFQUFFLENBQUMsQ0FBQTtRQUN6QyxNQUFNLElBQUksQ0FBQyxtQ0FBbUMsQ0FBQyxFQUFFLENBQUMsQ0FBQTtRQUNsRCxNQUFNLElBQUksQ0FBQyx1QkFBdUIsQ0FBQyxFQUFFLENBQUMsQ0FBQTtRQUN0QyxNQUFNLElBQUksQ0FBQyw2QkFBNkIsQ0FBQyxFQUFFLENBQUMsQ0FBQTtRQUM1QyxNQUFNLElBQUksQ0FBQywyQkFBMkIsQ0FBQyxFQUFFLENBQUMsQ0FBQTtRQUMxQyxNQUFNLElBQUksQ0FBQywyQkFBMkIsQ0FBQyxFQUFFLENBQUMsQ0FBQTtJQUM1QyxDQUFDO0lBRUQ7Ozs7Ozs7T0FPRztJQUNILEtBQUssQ0FBQyw2QkFBNkIsQ0FBQyxFQUFFO1FBQ3BDLE1BQU0sUUFBUSxHQUFHLEdBQUcsZUFBZSwyQkFBMkIsQ0FBQTtRQUM5RCxNQUFNLFFBQVEsR0FBRyxNQUFNLEVBQUUsQ0FBQyxtQkFBbUIsQ0FBQyxRQUFRLENBQUMsQ0FBQTtRQUV2RCxJQUFJLENBQUMsUUFBUTtZQUFFLE1BQU0sSUFBSSxLQUFLLENBQUMsZ0VBQWdFLENBQUMsQ0FBQTtRQUVoRyxJQUFJLENBQUM7WUFDSCxFQUFFLENBQUMsZ0JBQWdCLEVBQUUsQ0FBQTtZQUNyQixNQUFNLEtBQUssR0FBRyxNQUFNLEVBQUUsQ0FBQyxvQkFBb0IsQ0FBQyxVQUFVLENBQUMsQ0FBQTtZQUN2RCxNQUFNLFNBQVMsR0FBRyxJQUFJLFNBQVMsQ0FBQyxVQUFVLENBQUMsQ0FBQTtZQUMzQyxJQUFJLEtBQUssR0FBRyxLQUFLLENBQUE7WUFFakIsSUFBSSxDQUFDLENBQUMsTUFBTSxLQUFLLENBQUMsZUFBZSxDQUFDLHNCQUFzQixDQUFDLENBQUMsRUFBRSxDQUFDO2dCQUMzRCxTQUFTLENBQUMsTUFBTSxDQUFDLHNCQUFzQixFQUFFLEVBQUMsSUFBSSxFQUFFLElBQUksRUFBQyxDQUFDLENBQUE7Z0JBQ3RELEtBQUssR0FBRyxJQUFJLENBQUE7WUFDZCxDQUFDO1lBQ0QsSUFBSSxDQUFDLENBQUMsTUFBTSxLQUFLLENBQUMsZUFBZSxDQUFDLHFCQUFxQixDQUFDLENBQUMsRUFBRSxDQUFDO2dCQUMxRCxTQUFTLENBQUMsTUFBTSxDQUFDLHFCQUFxQixFQUFFLEVBQUMsSUFBSSxFQUFFLElBQUksRUFBQyxDQUFDLENBQUE7Z0JBQ3JELEtBQUssR0FBRyxJQUFJLENBQUE7WUFDZCxDQUFDO1lBQ0QsSUFBSSxDQUFDLENBQUMsTUFBTSxLQUFLLENBQUMsZUFBZSxDQUFDLG1CQUFtQixDQUFDLENBQUMsRUFBRSxDQUFDO2dCQUN4RCxTQUFTLENBQUMsTUFBTSxDQUFDLG1CQUFtQixFQUFFLEVBQUMsSUFBSSxFQUFFLElBQUksRUFBQyxDQUFDLENBQUE7Z0JBQ25ELEtBQUssR0FBRyxJQUFJLENBQUE7WUFDZCxDQUFDO1lBQ0QsSUFBSSxDQUFDLENBQUMsTUFBTSxLQUFLLENBQUMsZUFBZSxDQUFDLFdBQVcsQ0FBQyxDQUFDLEVBQUUsQ0FBQztnQkFDaEQsU0FBUyxDQUFDLE9BQU8sQ0FBQyxXQUFXLEVBQUUsRUFBQyxJQUFJLEVBQUUsSUFBSSxFQUFDLENBQUMsQ0FBQTtnQkFDNUMsS0FBSyxHQUFHLElBQUksQ0FBQTtZQUNkLENBQUM7WUFDRCxJQUFJLENBQUMsQ0FBQyxNQUFNLEtBQUssQ0FBQyxlQUFlLENBQUMsaUJBQWlCLENBQUMsQ0FBQyxFQUFFLENBQUM7Z0JBQ3RELFNBQVMsQ0FBQyxNQUFNLENBQUMsaUJBQWlCLEVBQUUsRUFBQyxJQUFJLEVBQUUsSUFBSSxFQUFDLENBQUMsQ0FBQTtnQkFDakQsS0FBSyxHQUFHLElBQUksQ0FBQTtZQUNkLENBQUM7WUFFRCxJQUFJLEtBQUssRUFBRSxDQUFDO2dCQUNWLEtBQUssTUFBTSxHQUFHLElBQUksTUFBTSxFQUFFLENBQUMsY0FBYyxDQUFDLFNBQVMsQ0FBQztvQkFBRSxNQUFNLEVBQUUsQ0FBQyxLQUFLLENBQUMsR0FBRyxDQUFDLENBQUE7Z0JBQ3pFLEVBQUUsQ0FBQyxnQkFBZ0IsRUFBRSxDQUFBO1lBQ3ZCLENBQUM7UUFDSCxDQUFDO2dCQUFTLENBQUM7WUFDVCxNQUFNLEVBQUUsQ0FBQyxtQkFBbUIsQ0FBQyxRQUFRLENBQUMsQ0FBQTtRQUN4QyxDQUFDO0lBQ0gsQ0FBQztJQUVEOzs7Ozs7T0FNRztJQUNILEtBQUssQ0FBQywyQkFBMkIsQ0FBQyxFQUFFO1FBQ2xDLE1BQU0sZ0JBQWdCLEdBQUcsbUNBQW1DLENBQUE7UUFDNUQsTUFBTSxZQUFZLEdBQUcsSUFBSSxDQUFDLGFBQWEsQ0FBQyxnQkFBZ0IsQ0FBQyxDQUFBO1FBRXpELElBQUksTUFBTSxJQUFJLENBQUMsYUFBYSxDQUFDLEVBQUUsRUFBRSxnQkFBZ0IsQ0FBQztZQUFFLE9BQU07UUFFMUQsTUFBTSxRQUFRLEdBQUcsTUFBTSxFQUFFLENBQUMsbUJBQW1CLENBQUMsWUFBWSxDQUFDLENBQUE7UUFFM0QsSUFBSSxDQUFDLFFBQVE7WUFBRSxNQUFNLElBQUksS0FBSyxDQUFDLHFEQUFxRCxDQUFDLENBQUE7UUFFckYsSUFBSSxDQUFDO1lBQ0gsSUFBSSxNQUFNLElBQUksQ0FBQyxhQUFhLENBQUMsRUFBRSxFQUFFLGdCQUFnQixDQUFDO2dCQUFFLE9BQU07WUFFMUQsRUFBRSxDQUFDLGdCQUFnQixFQUFFLENBQUE7WUFDckIsTUFBTSxLQUFLLEdBQUcsTUFBTSxFQUFFLENBQUMsb0JBQW9CLENBQUMsVUFBVSxDQUFDLENBQUE7WUFDdkQsTUFBTSxrQkFBa0IsR0FBRyxJQUFJLEdBQUcsQ0FDaEMsQ0FBQyxNQUFNLEtBQUssQ0FBQyxVQUFVLEVBQUUsQ0FBQztpQkFDdkIsTUFBTSxDQUFDLENBQUMsS0FBSyxFQUFFLEVBQUUsQ0FBQyxDQUFDLEtBQUssQ0FBQyxZQUFZLEVBQUUsSUFBSSxLQUFLLENBQUMsY0FBYyxFQUFFLENBQUMsTUFBTSxLQUFLLENBQUMsQ0FBQztpQkFDL0UsR0FBRyxDQUFDLENBQUMsS0FBSyxFQUFFLEVBQUUsQ0FBQyxLQUFLLENBQUMsY0FBYyxFQUFFLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FDN0MsQ0FBQTtZQUVELEtBQUssTUFBTSxVQUFVLElBQUksdUJBQXVCLEVBQUUsQ0FBQztnQkFDakQsSUFBSSxrQkFBa0IsQ0FBQyxHQUFHLENBQUMsVUFBVSxDQUFDO29CQUFFLFNBQVE7Z0JBRWhELEtBQUssTUFBTSxHQUFHLElBQUksTUFBTSxFQUFFLENBQUMsZUFBZSxDQUFDLEVBQUMsT0FBTyxFQUFFLENBQUMsVUFBVSxDQUFDLEVBQUUsV0FBVyxFQUFFLEVBQUUsQ0FBQyxPQUFPLEVBQUUsS0FBSyxRQUFRLEVBQUUsU0FBUyxFQUFFLFVBQVUsRUFBQyxDQUFDLEVBQUUsQ0FBQztvQkFDbkksTUFBTSxFQUFFLENBQUMsS0FBSyxDQUFDLEdBQUcsQ0FBQyxDQUFBO2dCQUNyQixDQUFDO1lBQ0gsQ0FBQztZQUVELEVBQUUsQ0FBQyxnQkFBZ0IsRUFBRSxDQUFBO1lBQ3JCLE1BQU0sSUFBSSxDQUFDLGdCQUFnQixDQUFDLEVBQUUsRUFBRSxnQkFBZ0IsQ0FBQyxDQUFBO1FBQ25ELENBQUM7Z0JBQVMsQ0FBQztZQUNULE1BQU0sRUFBRSxDQUFDLG1CQUFtQixDQUFDLFlBQVksQ0FBQyxDQUFBO1FBQzVDLENBQUM7SUFDSCxDQUFDO0lBRUQ7Ozs7Ozs7O09BUUc7SUFDSCxLQUFLLENBQUMsMkJBQTJCLENBQUMsRUFBRTtRQUNsQyxNQUFNLGdCQUFnQixHQUFHLGlDQUFpQyxDQUFBO1FBQzFELE1BQU0sWUFBWSxHQUFHLElBQUksQ0FBQyxhQUFhLENBQUMsZ0JBQWdCLENBQUMsQ0FBQTtRQUV6RCxJQUFJLE1BQU0sSUFBSSxDQUFDLGFBQWEsQ0FBQyxFQUFFLEVBQUUsZ0JBQWdCLENBQUM7WUFBRSxPQUFNO1FBRTFELE1BQU0sUUFBUSxHQUFHLE1BQU0sRUFBRSxDQUFDLG1CQUFtQixDQUFDLFlBQVksQ0FBQyxDQUFBO1FBRTNELElBQUksQ0FBQyxRQUFRO1lBQUUsTUFBTSxJQUFJLEtBQUssQ0FBQyx3REFBd0QsQ0FBQyxDQUFBO1FBRXhGLElBQUksQ0FBQztZQUNILElBQUksTUFBTSxJQUFJLENBQUMsYUFBYSxDQUFDLEVBQUUsRUFBRSxnQkFBZ0IsQ0FBQztnQkFBRSxPQUFNO1lBRTFELEVBQUUsQ0FBQyxnQkFBZ0IsRUFBRSxDQUFBO1lBQ3JCLE1BQU0sS0FBSyxHQUFHLE1BQU0sRUFBRSxDQUFDLG9CQUFvQixDQUFDLFVBQVUsQ0FBQyxDQUFBO1lBQ3ZELE1BQU0sb0JBQW9CLEdBQUcsSUFBSSxHQUFHLENBQ2xDLENBQUMsTUFBTSxLQUFLLENBQUMsVUFBVSxFQUFFLENBQUMsQ0FBQyxHQUFHLENBQUMsQ0FBQyxLQUFLLEVBQUUsRUFBRSxDQUFDLENBQUMsS0FBSyxDQUFDLE9BQU8sRUFBRSxFQUFFLEtBQUssQ0FBQyxjQUFjLEVBQUUsQ0FBQyxDQUFDLENBQ3JGLENBQUE7WUFFRCxLQUFLLE1BQU0sRUFBQyxPQUFPLEVBQUUsSUFBSSxFQUFDLElBQUksMkJBQTJCLEVBQUUsQ0FBQztnQkFDMUQsTUFBTSxlQUFlLEdBQUcsb0JBQW9CLENBQUMsR0FBRyxDQUFDLElBQUksQ0FBQyxDQUFBO2dCQUV0RCxJQUFJLGVBQWUsRUFBRSxDQUFDO29CQUNwQixJQUFJLGVBQWUsQ0FBQyxJQUFJLENBQUMsR0FBRyxDQUFDLEtBQUssT0FBTyxDQUFDLElBQUksQ0FBQyxHQUFHLENBQUM7d0JBQUUsU0FBUTtvQkFDN0QsTUFBTSxJQUFJLEtBQUssQ0FBQyxtQ0FBbUMsSUFBSSxvQ0FBb0MsZUFBZSxDQUFDLElBQUksQ0FBQyxHQUFHLENBQUMsRUFBRSxDQUFDLENBQUE7Z0JBQ3pILENBQUM7Z0JBRUQsS0FBSyxNQUFNLEdBQUcsSUFBSSxNQUFNLEVBQUUsQ0FBQyxlQUFlLENBQUMsRUFBQyxPQUFPLEVBQUUsV0FBVyxFQUFFLEVBQUUsQ0FBQyxPQUFPLEVBQUUsS0FBSyxRQUFRLEVBQUUsSUFBSSxFQUFFLFNBQVMsRUFBRSxVQUFVLEVBQUMsQ0FBQyxFQUFFLENBQUM7b0JBQzNILE1BQU0sRUFBRSxDQUFDLEtBQUssQ0FBQyxHQUFHLENBQUMsQ0FBQTtnQkFDckIsQ0FBQztZQUNILENBQUM7WUFFRCxFQUFFLENBQUMsZ0JBQWdCLEVBQUUsQ0FBQTtZQUNyQixNQUFNLElBQUksQ0FBQyxnQkFBZ0IsQ0FBQyxFQUFFLEVBQUUsZ0JBQWdCLENBQUMsQ0FBQTtRQUNuRCxDQUFDO2dCQUFTLENBQUM7WUFDVCxNQUFNLEVBQUUsQ0FBQyxtQkFBbUIsQ0FBQyxZQUFZLENBQUMsQ0FBQTtRQUM1QyxDQUFDO0lBQ0gsQ0FBQztJQUVEOzs7O09BSUc7SUFDSCxLQUFLLENBQUMsdUJBQXVCLENBQUMsRUFBRTtRQUM5QixNQUFNLFFBQVEsR0FBRyxHQUFHLGVBQWUsb0JBQW9CLENBQUE7UUFDdkQsTUFBTSxRQUFRLEdBQUcsTUFBTSxFQUFFLENBQUMsbUJBQW1CLENBQUMsUUFBUSxDQUFDLENBQUE7UUFFdkQsSUFBSSxDQUFDLFFBQVE7WUFBRSxNQUFNLElBQUksS0FBSyxDQUFDLHVEQUF1RCxDQUFDLENBQUE7UUFFdkYsSUFBSSxDQUFDO1lBQ0gsRUFBRSxDQUFDLGdCQUFnQixFQUFFLENBQUE7WUFDckIsTUFBTSxLQUFLLEdBQUcsTUFBTSxFQUFFLENBQUMsb0JBQW9CLENBQUMsVUFBVSxDQUFDLENBQUE7WUFFdkQsSUFBSSxDQUFDLENBQUMsTUFBTSxLQUFLLENBQUMsZUFBZSxDQUFDLFlBQVksQ0FBQyxDQUFDLEVBQUUsQ0FBQztnQkFDakQsTUFBTSxTQUFTLEdBQUcsSUFBSSxTQUFTLENBQUMsVUFBVSxDQUFDLENBQUE7Z0JBQzNDLFNBQVMsQ0FBQyxNQUFNLENBQUMsWUFBWSxFQUFFLEVBQUMsSUFBSSxFQUFFLElBQUksRUFBQyxDQUFDLENBQUE7Z0JBRTVDLEtBQUssTUFBTSxHQUFHLElBQUksTUFBTSxFQUFFLENBQUMsY0FBYyxDQUFDLFNBQVMsQ0FBQztvQkFBRSxNQUFNLEVBQUUsQ0FBQyxLQUFLLENBQUMsR0FBRyxDQUFDLENBQUE7Z0JBRXpFLEVBQUUsQ0FBQyxnQkFBZ0IsRUFBRSxDQUFBO1lBQ3ZCLENBQUM7UUFDSCxDQUFDO2dCQUFTLENBQUM7WUFDVCxNQUFNLEVBQUUsQ0FBQyxtQkFBbUIsQ0FBQyxRQUFRLENBQUMsQ0FBQTtRQUN4QyxDQUFDO0lBQ0gsQ0FBQztJQUVEOzs7O09BSUc7SUFDSCxLQUFLLENBQUMsd0JBQXdCLENBQUMsRUFBRTtRQUMvQixNQUFNLFFBQVEsR0FBRyxHQUFHLGVBQWUsc0JBQXNCLENBQUE7UUFDekQsTUFBTSxRQUFRLEdBQUcsTUFBTSxFQUFFLENBQUMsbUJBQW1CLENBQUMsUUFBUSxDQUFDLENBQUE7UUFFdkQsSUFBSSxDQUFDLFFBQVE7WUFBRSxNQUFNLElBQUksS0FBSyxDQUFDLDREQUE0RCxDQUFDLENBQUE7UUFFNUYsSUFBSSxDQUFDO1lBQ0gsRUFBRSxDQUFDLGdCQUFnQixFQUFFLENBQUE7WUFDckIsTUFBTSxXQUFXLEdBQUcsTUFBTSxFQUFFLENBQUMsb0JBQW9CLENBQUMsVUFBVSxDQUFDLENBQUE7WUFFN0QsSUFBSSxDQUFDLENBQUMsTUFBTSxXQUFXLENBQUMsZUFBZSxDQUFDLGNBQWMsQ0FBQyxDQUFDLEVBQUUsQ0FBQztnQkFDekQsTUFBTSxTQUFTLEdBQUcsSUFBSSxTQUFTLENBQUMsVUFBVSxDQUFDLENBQUE7Z0JBRTNDLFNBQVMsQ0FBQyxNQUFNLENBQUMsY0FBYyxFQUFFLEVBQUMsSUFBSSxFQUFFLElBQUksRUFBRSxLQUFLLEVBQUUsSUFBSSxFQUFDLENBQUMsQ0FBQTtnQkFFM0QsS0FBSyxNQUFNLEdBQUcsSUFBSSxNQUFNLEVBQUUsQ0FBQyxjQUFjLENBQUMsU0FBUyxDQUFDO29CQUFFLE1BQU0sRUFBRSxDQUFDLEtBQUssQ0FBQyxHQUFHLENBQUMsQ0FBQTtnQkFFekUsRUFBRSxDQUFDLGdCQUFnQixFQUFFLENBQUE7WUFDdkIsQ0FBQztRQUNILENBQUM7Z0JBQVMsQ0FBQztZQUNULE1BQU0sRUFBRSxDQUFDLG1CQUFtQixDQUFDLFFBQVEsQ0FBQyxDQUFBO1FBQ3hDLENBQUM7SUFDSCxDQUFDO0lBRUQ7Ozs7O09BS0c7SUFDSCxLQUFLLENBQUMsMEJBQTBCLENBQUMsRUFBRTtRQUNqQyxNQUFNLFFBQVEsR0FBRyxHQUFHLGVBQWUsd0JBQXdCLENBQUE7UUFDM0QsTUFBTSxRQUFRLEdBQUcsTUFBTSxFQUFFLENBQUMsbUJBQW1CLENBQUMsUUFBUSxDQUFDLENBQUE7UUFFdkQsSUFBSSxDQUFDLFFBQVE7WUFBRSxNQUFNLElBQUksS0FBSyxDQUFDLDhEQUE4RCxDQUFDLENBQUE7UUFFOUYsSUFBSSxDQUFDO1lBQ0gsRUFBRSxDQUFDLGdCQUFnQixFQUFFLENBQUE7WUFDckIsSUFBSSxLQUFLLEdBQUcsTUFBTSxFQUFFLENBQUMsb0JBQW9CLENBQUMsVUFBVSxDQUFDLENBQUE7WUFFckQsSUFBSSxDQUFDLENBQUMsTUFBTSxLQUFLLENBQUMsZUFBZSxDQUFDLGdCQUFnQixDQUFDLENBQUMsRUFBRSxDQUFDO2dCQUNyRCxNQUFNLFNBQVMsR0FBRyxJQUFJLFNBQVMsQ0FBQyxVQUFVLENBQUMsQ0FBQTtnQkFFM0MsU0FBUyxDQUFDLE1BQU0sQ0FBQyxnQkFBZ0IsRUFBRSxFQUFDLElBQUksRUFBRSxJQUFJLEVBQUMsQ0FBQyxDQUFBO2dCQUNoRCxLQUFLLE1BQU0sR0FBRyxJQUFJLE1BQU0sRUFBRSxDQUFDLGNBQWMsQ0FBQyxTQUFTLENBQUM7b0JBQUUsTUFBTSxFQUFFLENBQUMsS0FBSyxDQUFDLEdBQUcsQ0FBQyxDQUFBO2dCQUN6RSxFQUFFLENBQUMsZ0JBQWdCLEVBQUUsQ0FBQTtnQkFDckIsS0FBSyxHQUFHLE1BQU0sRUFBRSxDQUFDLG9CQUFvQixDQUFDLFVBQVUsQ0FBQyxDQUFBO1lBQ25ELENBQUM7WUFFRCxNQUFNLFVBQVUsR0FBRyxJQUFJLEdBQUcsQ0FBQyxDQUFDLE1BQU0sS0FBSyxDQUFDLFVBQVUsRUFBRSxDQUFDLENBQUMsR0FBRyxDQUFDLENBQUMsS0FBSyxFQUFFLEVBQUUsQ0FBQyxLQUFLLENBQUMsT0FBTyxFQUFFLENBQUMsQ0FBQyxDQUFBO1lBRXRGLElBQUksQ0FBQyxVQUFVLENBQUMsR0FBRyxDQUFDLDRCQUE0QixDQUFDLEVBQUUsQ0FBQztnQkFDbEQsTUFBTSxJQUFJLEdBQUcsTUFBTSxFQUFFLENBQUMsZUFBZSxDQUFDO29CQUNwQyxPQUFPLEVBQUUsQ0FBQyxjQUFjLEVBQUUsZ0JBQWdCLEVBQUUsZUFBZSxFQUFFLElBQUksQ0FBQztvQkFDbEUsV0FBVyxFQUFFLEVBQUUsQ0FBQyxPQUFPLEVBQUUsS0FBSyxRQUFRO29CQUN0QyxJQUFJLEVBQUUsNEJBQTRCO29CQUNsQyxTQUFTLEVBQUUsVUFBVTtpQkFDdEIsQ0FBQyxDQUFBO2dCQUVGLEtBQUssTUFBTSxHQUFHLElBQUksSUFBSTtvQkFBRSxNQUFNLEVBQUUsQ0FBQyxLQUFLLENBQUMsR0FBRyxDQUFDLENBQUE7Z0JBQzNDLEVBQUUsQ0FBQyxnQkFBZ0IsRUFBRSxDQUFBO1lBQ3ZCLENBQUM7UUFDSCxDQUFDO2dCQUFTLENBQUM7WUFDVCxNQUFNLEVBQUUsQ0FBQyxtQkFBbUIsQ0FBQyxRQUFRLENBQUMsQ0FBQTtRQUN4QyxDQUFDO0lBQ0gsQ0FBQztJQUVEOzs7Ozs7T0FNRztJQUNILEtBQUssQ0FBQyxtQ0FBbUMsQ0FBQyxFQUFFO1FBQzFDLE1BQU0sZ0JBQWdCLEdBQUcsMENBQTBDLENBQUE7UUFDbkUsTUFBTSxZQUFZLEdBQUcsSUFBSSxDQUFDLGFBQWEsQ0FBQyxnQkFBZ0IsQ0FBQyxDQUFBO1FBQ3pELE1BQU0sV0FBVyxHQUFHLE1BQU0sRUFBRSxDQUFDLFdBQVcsQ0FBQywrQkFBK0IsQ0FBQyxDQUFBO1FBRXpFLElBQUksV0FBVyxJQUFJLE1BQU0sSUFBSSxDQUFDLGFBQWEsQ0FBQyxFQUFFLEVBQUUsZ0JBQWdCLENBQUM7WUFBRSxPQUFNO1FBRXpFLE1BQU0sUUFBUSxHQUFHLE1BQU0sRUFBRSxDQUFDLG1CQUFtQixDQUFDLFlBQVksQ0FBQyxDQUFBO1FBRTNELElBQUksQ0FBQyxRQUFRO1lBQUUsTUFBTSxJQUFJLEtBQUssQ0FBQyx3RUFBd0UsQ0FBQyxDQUFBO1FBRXhHLElBQUksQ0FBQztZQUNILEVBQUUsQ0FBQyxnQkFBZ0IsRUFBRSxDQUFBO1lBQ3JCLE1BQU0saUJBQWlCLEdBQUcsTUFBTSxFQUFFLENBQUMsV0FBVyxDQUFDLCtCQUErQixDQUFDLENBQUE7WUFDL0UsTUFBTSxjQUFjLEdBQUcsTUFBTSxJQUFJLENBQUMsYUFBYSxDQUFDLEVBQUUsRUFBRSxnQkFBZ0IsQ0FBQyxDQUFBO1lBRXJFLElBQUksQ0FBQyxpQkFBaUIsRUFBRSxDQUFDO2dCQUN2QixNQUFNLEtBQUssR0FBRyxJQUFJLFNBQVMsQ0FBQywrQkFBK0IsRUFBRSxFQUFDLFdBQVcsRUFBRSxJQUFJLEVBQUMsQ0FBQyxDQUFBO2dCQUVqRixLQUFLLENBQUMsTUFBTSxDQUFDLGNBQWMsRUFBRSxFQUFDLFVBQVUsRUFBRSxJQUFJLEVBQUMsQ0FBQyxDQUFBO2dCQUNoRCxLQUFLLENBQUMsTUFBTSxDQUFDLGlCQUFpQixFQUFFLEVBQUMsSUFBSSxFQUFFLEtBQUssRUFBQyxDQUFDLENBQUE7Z0JBQzlDLE1BQU0sRUFBRSxDQUFDLFdBQVcsQ0FBQyxLQUFLLENBQUMsQ0FBQTtnQkFDM0IsRUFBRSxDQUFDLGdCQUFnQixFQUFFLENBQUE7WUFDdkIsQ0FBQztZQUVELHVFQUF1RTtZQUN2RSxzRUFBc0U7WUFDdEUseUVBQXlFO1lBQ3pFLElBQUksQ0FBQyxpQkFBaUIsSUFBSSxDQUFDLGNBQWM7Z0JBQUUsTUFBTSxJQUFJLENBQUMsZ0NBQWdDLENBQUMsRUFBRSxDQUFDLENBQUE7WUFDMUYsSUFBSSxDQUFDLGNBQWM7Z0JBQUUsTUFBTSxJQUFJLENBQUMsZ0JBQWdCLENBQUMsRUFBRSxFQUFFLGdCQUFnQixDQUFDLENBQUE7UUFDeEUsQ0FBQztnQkFBUyxDQUFDO1lBQ1QsTUFBTSxFQUFFLENBQUMsbUJBQW1CLENBQUMsWUFBWSxDQUFDLENBQUE7UUFDNUMsQ0FBQztJQUNILENBQUM7SUFFRDs7OztPQUlHO0lBQ0gsS0FBSyxDQUFDLGdDQUFnQyxDQUFDLEVBQUU7UUFDdkMsTUFBTSxPQUFPLEdBQUcsTUFBTSxFQUFFO2FBQ3JCLFFBQVEsRUFBRTthQUNWLElBQUksQ0FBQyxVQUFVLENBQUM7YUFDaEIsTUFBTSxDQUFDLGNBQWMsQ0FBQzthQUN0QixRQUFRLENBQUMsRUFBQyxZQUFZLEVBQUUsSUFBSSxFQUFDLENBQUM7YUFDOUIsUUFBUSxDQUFDLEVBQUMsY0FBYyxFQUFFLElBQUksRUFBQyxDQUFDO2FBQ2hDLFFBQVEsRUFBRTthQUNWLE9BQU8sRUFBRSxDQUFBO1FBRVosS0FBSyxNQUFNLE1BQU0sSUFBSSxPQUFPLEVBQUUsQ0FBQztZQUM3QixNQUFNLFdBQVcsR0FBRyxNQUFNLENBQUMsNERBQTRELENBQUMsQ0FBQyxNQUFNLENBQUMsQ0FBQyxZQUFZLENBQUMsQ0FBQTtZQUM5RyxNQUFNLGFBQWEsR0FBRyxNQUFNLElBQUksQ0FBQyw4QkFBOEIsQ0FBQyxFQUFFLEVBQUUsV0FBVyxDQUFDLENBQUE7WUFDaEYsTUFBTSxnQkFBZ0IsR0FBRyxNQUFNLElBQUksQ0FBQyx1QkFBdUIsQ0FBQyxFQUFFLEVBQUUsV0FBVyxDQUFDLENBQUE7WUFFNUUsSUFBSSxhQUFhLEtBQUssSUFBSTtnQkFBRSxTQUFRO1lBQ3BDLElBQUksZ0JBQWdCLEtBQUssSUFBSSxJQUFJLGdCQUFnQixJQUFJLGFBQWE7Z0JBQUUsU0FBUTtZQUM1RSxNQUFNLElBQUksQ0FBQyw0QkFBNEIsQ0FBQyxFQUFFLEVBQUUsRUFBQyxXQUFXLEVBQUUsYUFBYSxFQUFFLGFBQWEsRUFBQyxDQUFDLENBQUE7UUFDMUYsQ0FBQztJQUNILENBQUM7SUFFRDs7Ozs7O09BTUc7SUFDSCxLQUFLLENBQUMsa0JBQWtCLENBQUMsRUFBRTtRQUN6QixNQUFNLFFBQVEsR0FBRyxHQUFHLGVBQWUsZUFBZSxDQUFBO1FBQ2xELE1BQU0sUUFBUSxHQUFHLE1BQU0sRUFBRSxDQUFDLG1CQUFtQixDQUFDLFFBQVEsQ0FBQyxDQUFBO1FBRXZELElBQUksQ0FBQyxRQUFRO1lBQUUsTUFBTSxJQUFJLEtBQUssQ0FBQyxxREFBcUQsQ0FBQyxDQUFBO1FBRXJGLElBQUksQ0FBQztZQUNILHlFQUF5RTtZQUN6RSxpRUFBaUU7WUFDakUsc0VBQXNFO1lBQ3RFLEVBQUUsQ0FBQyxnQkFBZ0IsRUFBRSxDQUFBO1lBQ3JCLE1BQU0sV0FBVyxHQUFHLE1BQU0sRUFBRSxDQUFDLG9CQUFvQixDQUFDLFVBQVUsQ0FBQyxDQUFBO1lBRTdELElBQUksQ0FBQyxDQUFDLE1BQU0sV0FBVyxDQUFDLGVBQWUsQ0FBQyxPQUFPLENBQUMsQ0FBQyxFQUFFLENBQUM7Z0JBQ2xELE1BQU0sU0FBUyxHQUFHLElBQUksU0FBUyxDQUFDLFVBQVUsQ0FBQyxDQUFBO2dCQUUzQyxTQUFTLENBQUMsTUFBTSxDQUFDLE9BQU8sRUFBRSxFQUFDLElBQUksRUFBRSxJQUFJLEVBQUUsS0FBSyxFQUFFLElBQUksRUFBQyxDQUFDLENBQUE7Z0JBRXBELEtBQUssTUFBTSxHQUFHLElBQUksTUFBTSxFQUFFLENBQUMsY0FBYyxDQUFDLFNBQVMsQ0FBQztvQkFBRSxNQUFNLEVBQUUsQ0FBQyxLQUFLLENBQUMsR0FBRyxDQUFDLENBQUE7Z0JBRXpFLEVBQUUsQ0FBQyxnQkFBZ0IsRUFBRSxDQUFBO1lBQ3ZCLENBQUM7UUFDSCxDQUFDO2dCQUFTLENBQUM7WUFDVCxNQUFNLEVBQUUsQ0FBQyxtQkFBbUIsQ0FBQyxRQUFRLENBQUMsQ0FBQTtRQUN4QyxDQUFDO0lBQ0gsQ0FBQztJQUVEOzs7O09BSUc7SUFDSCxLQUFLLENBQUMsMkJBQTJCLENBQUMsRUFBRTtRQUNsQyxNQUFNLGdCQUFnQixHQUFHLHlDQUF5QyxDQUFBO1FBQ2xFLE1BQU0sWUFBWSxHQUFHLElBQUksQ0FBQyxhQUFhLENBQUMsZ0JBQWdCLENBQUMsQ0FBQTtRQUV6RCxJQUFJLE1BQU0sSUFBSSxDQUFDLGFBQWEsQ0FBQyxFQUFFLEVBQUUsZ0JBQWdCLENBQUM7WUFBRSxPQUFNO1FBRTFELE1BQU0sRUFBRSxDQUFDLG1CQUFtQixDQUFDLFlBQVksQ0FBQyxDQUFBO1FBRTFDLElBQUksQ0FBQztZQUNILElBQUksTUFBTSxJQUFJLENBQUMsYUFBYSxDQUFDLEVBQUUsRUFBRSxnQkFBZ0IsQ0FBQztnQkFBRSxPQUFNO1lBRTFELHVFQUF1RTtZQUN2RSxpRUFBaUU7WUFDakUsRUFBRSxDQUFDLGdCQUFnQixFQUFFLENBQUE7WUFDckIsSUFBSSxDQUFDLENBQUMsTUFBTSxDQUFDLE1BQU0sRUFBRSxDQUFDLG9CQUFvQixDQUFDLFVBQVUsQ0FBQyxDQUFDLENBQUMsZUFBZSxDQUFDLFFBQVEsQ0FBQyxDQUFDLEVBQUUsQ0FBQztnQkFDbkYsTUFBTSxJQUFJLENBQUMsZ0JBQWdCLENBQUMsRUFBRSxFQUFFLGdCQUFnQixDQUFDLENBQUE7Z0JBQ2pELE9BQU07WUFDUixDQUFDO1lBRUQsTUFBTSxZQUFZLEdBQUcsRUFBRSxDQUFDLFVBQVUsQ0FBQyxVQUFVLENBQUMsQ0FBQTtZQUM5QyxNQUFNLGVBQWUsR0FBRyxFQUFFLENBQUMsV0FBVyxDQUFDLFFBQVEsQ0FBQyxDQUFBO1lBQ2hELE1BQU0sc0JBQXNCLEdBQUcsRUFBRSxDQUFDLFdBQVcsQ0FBQyxnQkFBZ0IsQ0FBQyxDQUFBO1lBRS9ELE1BQU0sRUFBRSxDQUFDLEtBQUssQ0FDWixVQUFVLFlBQVksUUFBUSxzQkFBc0IsTUFBTSxFQUFFLENBQUMsS0FBSyxDQUFDLFFBQVEsQ0FBQyxHQUFHO2dCQUMvRSxTQUFTLGVBQWUsTUFBTSxFQUFFLENBQUMsS0FBSyxDQUFDLElBQUksQ0FBQyxRQUFRLHNCQUFzQixVQUFVLENBQ3JGLENBQUE7WUFDRCxNQUFNLEVBQUUsQ0FBQyxLQUFLLENBQ1osVUFBVSxZQUFZLFFBQVEsc0JBQXNCLE1BQU0sRUFBRSxDQUFDLEtBQUssQ0FBQyxRQUFRLENBQUMsR0FBRztnQkFDL0UsU0FBUyxlQUFlLE1BQU0sRUFBRSxDQUFDLEtBQUssQ0FBQyxLQUFLLENBQUMsUUFBUSxzQkFBc0IsVUFBVSxDQUN0RixDQUFBO1lBRUQsTUFBTSxJQUFJLENBQUMsZ0JBQWdCLENBQUMsRUFBRSxFQUFFLGdCQUFnQixDQUFDLENBQUE7UUFDbkQsQ0FBQztnQkFBUyxDQUFDO1lBQ1QsTUFBTSxFQUFFLENBQUMsbUJBQW1CLENBQUMsWUFBWSxDQUFDLENBQUE7UUFDNUMsQ0FBQztJQUNILENBQUM7SUFFRDs7Ozs7Ozs7O09BU0c7SUFDSCxLQUFLLENBQUMscUJBQXFCLENBQUMsRUFBRTtRQUM1QixNQUFNLGdCQUFnQixHQUFHLG9DQUFvQyxDQUFBO1FBQzdELE1BQU0sWUFBWSxHQUFHLElBQUksQ0FBQyxhQUFhLENBQUMsZ0JBQWdCLENBQUMsQ0FBQTtRQUV6RCxJQUFJLE1BQU0sSUFBSSxDQUFDLGFBQWEsQ0FBQyxFQUFFLEVBQUUsZ0JBQWdCLENBQUM7WUFBRSxPQUFNO1FBRTFELE1BQU0sRUFBRSxDQUFDLG1CQUFtQixDQUFDLFlBQVksQ0FBQyxDQUFBO1FBRTFDLElBQUksQ0FBQztZQUNILElBQUksTUFBTSxJQUFJLENBQUMsYUFBYSxDQUFDLEVBQUUsRUFBRSxnQkFBZ0IsQ0FBQztnQkFBRSxPQUFNO1lBRTFELEVBQUUsQ0FBQyxnQkFBZ0IsRUFBRSxDQUFBO1lBRXJCLElBQUksTUFBTSxDQUFDLE1BQU0sRUFBRSxDQUFDLG9CQUFvQixDQUFDLFVBQVUsQ0FBQyxDQUFDLENBQUMsZUFBZSxDQUFDLFFBQVEsQ0FBQyxFQUFFLENBQUM7Z0JBQ2hGLE1BQU0sWUFBWSxHQUFHLEVBQUUsQ0FBQyxVQUFVLENBQUMsVUFBVSxDQUFDLENBQUE7Z0JBQzlDLE1BQU0sc0JBQXNCLEdBQUcsRUFBRSxDQUFDLFdBQVcsQ0FBQyxnQkFBZ0IsQ0FBQyxDQUFBO2dCQUMvRCxNQUFNLGtCQUFrQixHQUFHLEVBQUUsQ0FBQyxXQUFXLENBQUMsWUFBWSxDQUFDLENBQUE7Z0JBRXZELDRFQUE0RTtnQkFDNUUsZ0VBQWdFO2dCQUNoRSxNQUFNLEVBQUUsQ0FBQyxLQUFLLENBQ1osVUFBVSxZQUFZLFFBQVEsc0JBQXNCLE1BQU0sRUFBRSxDQUFDLEtBQUssQ0FBQyxRQUFRLENBQUMsR0FBRztvQkFDL0UsU0FBUyxzQkFBc0IsTUFBTSxFQUFFLENBQUMsS0FBSyxDQUFDLFFBQVEsQ0FBQyxHQUFHO29CQUMxRCxPQUFPLGtCQUFrQixTQUFTLEVBQUUsQ0FBQyxLQUFLLENBQUMsR0FBRywrQkFBK0IsR0FBRyxDQUFDLEVBQUUsQ0FDcEYsQ0FBQTtnQkFDRCx1RUFBdUU7Z0JBQ3ZFLE1BQU0sRUFBRSxDQUFDLEtBQUssQ0FDWixVQUFVLFlBQVksUUFBUSxrQkFBa0IsVUFBVTtvQkFDMUQsU0FBUyxrQkFBa0IsTUFBTSxFQUFFLENBQUMsS0FBSyxDQUFDLCtCQUErQixDQUFDLEVBQUUsQ0FDN0UsQ0FBQTtnQkFFRCxNQUFNLFVBQVUsR0FBRyxJQUFJLFNBQVMsQ0FBQyxVQUFVLENBQUMsQ0FBQTtnQkFDNUMsVUFBVSxDQUFDLFNBQVMsQ0FBQyxRQUFRLEVBQUUsRUFBQyxVQUFVLEVBQUUsSUFBSSxFQUFDLENBQUMsQ0FBQTtnQkFDbEQsS0FBSyxNQUFNLEdBQUcsSUFBSSxNQUFNLEVBQUUsQ0FBQyxjQUFjLENBQUMsVUFBVSxDQUFDO29CQUFFLE1BQU0sRUFBRSxDQUFDLEtBQUssQ0FBQyxHQUFHLENBQUMsQ0FBQTtnQkFFMUUsRUFBRSxDQUFDLGdCQUFnQixFQUFFLENBQUE7WUFDdkIsQ0FBQztZQUVELE1BQU0sSUFBSSxDQUFDLGdCQUFnQixDQUFDLEVBQUUsRUFBRSxnQkFBZ0IsQ0FBQyxDQUFBO1FBQ25ELENBQUM7Z0JBQVMsQ0FBQztZQUNULE1BQU0sRUFBRSxDQUFDLG1CQUFtQixDQUFDLFlBQVksQ0FBQyxDQUFBO1FBQzVDLENBQUM7SUFDSCxDQUFDO0lBRUQ7Ozs7O09BS0c7SUFDSCxLQUFLLENBQUMsZ0JBQWdCLENBQUMsRUFBRSxFQUFFLE9BQU87UUFDaEMsTUFBTSxFQUFFLENBQUMsTUFBTSxDQUFDO1lBQ2QsU0FBUyxFQUFFLGdCQUFnQjtZQUMzQixJQUFJLEVBQUU7Z0JBQ0osR0FBRyxFQUFFLElBQUksQ0FBQyxhQUFhLENBQUMsT0FBTyxDQUFDO2dCQUNoQyxLQUFLLEVBQUUsZUFBZTtnQkFDdEIsT0FBTztnQkFDUCxhQUFhLEVBQUUsSUFBSSxDQUFDLEdBQUcsRUFBRTthQUMxQjtZQUNELGVBQWUsRUFBRSxDQUFDLEtBQUssQ0FBQztZQUN4QixhQUFhLEVBQUUsQ0FBQyxPQUFPLEVBQUUsU0FBUyxFQUFFLGVBQWUsQ0FBQztTQUNyRCxDQUFDLENBQUE7SUFDSixDQUFDO0lBRUQsS0FBSyxDQUFDLGdCQUFnQjtRQUNwQixJQUFJLG1CQUFtQixDQUFDLGFBQWEsRUFBRTtZQUFFLE9BQU07UUFFL0MsbUJBQW1CLENBQUMscUJBQXFCLENBQUMsSUFBSSxDQUFDLHFCQUFxQixFQUFFLENBQUMsQ0FBQTtRQUN2RSxNQUFNLElBQUksR0FBRyxJQUFJLENBQUMsYUFBYSxDQUFDLGVBQWUsQ0FBQyxJQUFJLENBQUMscUJBQXFCLEVBQUUsQ0FBQyxDQUFBO1FBRTdFLE1BQU0sSUFBSSxDQUFDLGNBQWMsQ0FBQyxFQUFDLElBQUksRUFBRSx3Q0FBd0MsRUFBQyxFQUFFLEtBQUssSUFBSSxFQUFFO1lBQ3JGLE1BQU0sbUJBQW1CLENBQUMsZ0JBQWdCLENBQUMsRUFBQyxhQUFhLEVBQUUsSUFBSSxDQUFDLGFBQWEsRUFBQyxDQUFDLENBQUE7UUFDakYsQ0FBQyxDQUFDLENBQUE7SUFDSixDQUFDO0lBRUQ7Ozs7O09BS0c7SUFDSCxLQUFLLENBQUMsY0FBYyxDQUFDLEVBQUUsRUFBRSxLQUFLO1FBQzVCLE1BQU0sS0FBSyxHQUFHLEVBQUU7YUFDYixRQUFRLEVBQUU7YUFDVixJQUFJLENBQUMsVUFBVSxDQUFDO2FBQ2hCLEtBQUssQ0FBQyxFQUFDLEVBQUUsRUFBRSxLQUFLLEVBQUMsQ0FBQzthQUNsQixLQUFLLENBQUMsQ0FBQyxDQUFDLENBQUE7UUFFWCxNQUFNLElBQUksR0FBRyxNQUFNLEtBQUssQ0FBQyxPQUFPLEVBQUUsQ0FBQTtRQUVsQyxJQUFJLENBQUMsSUFBSSxDQUFDLENBQUMsQ0FBQztZQUFFLE9BQU8sSUFBSSxDQUFBO1FBRXpCLE9BQU8sSUFBSSxDQUFDLGdCQUFnQixDQUFDLElBQUksQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFBO0lBQ3ZDLENBQUM7SUFFRDs7Ozs7T0FLRztJQUNILEtBQUssQ0FBQyxrQkFBa0IsQ0FBQyxFQUFFLEVBQUUsV0FBVztRQUN0QyxNQUFNLFNBQVMsR0FBRyxNQUFNLEVBQUU7YUFDdkIsUUFBUSxFQUFFO2FBQ1YsSUFBSSxDQUFDLG1CQUFtQixDQUFDO2FBQ3pCLEtBQUssQ0FBQyxFQUFDLFlBQVksRUFBRSxXQUFXLEVBQUMsQ0FBQzthQUNsQyxLQUFLLENBQUMsQ0FBQyxDQUFDO2FBQ1IsT0FBTyxFQUFFLENBQUE7UUFDWixNQUFNLFFBQVEsR0FBRyxTQUFTLENBQUMsQ0FBQyxDQUFDLENBQUE7UUFFN0IsSUFBSSxDQUFDLFFBQVE7WUFBRSxPQUFPLElBQUksQ0FBQTtRQUUxQixPQUFPLE1BQU0sSUFBSSxDQUFDLGNBQWMsQ0FBQyxFQUFFLEVBQUUsTUFBTSxDQUFDLFFBQVEsQ0FBQyxNQUFNLENBQUMsQ0FBQyxDQUFBO0lBQy9ELENBQUM7SUFFRDs7Ozs7OztPQU9HO0lBQ0gsS0FBSyxDQUFDLGtCQUFrQixDQUFDLEVBQUUsRUFBRSxXQUFXO1FBQ3RDLE1BQU0sWUFBWSxHQUFHLE1BQU0sSUFBSSxDQUFDLHVCQUF1QixDQUFDLEVBQUUsRUFBRSxXQUFXLENBQUMsQ0FBQTtRQUN4RSxNQUFNLGFBQWEsR0FBRyxNQUFNLElBQUksQ0FBQyw4QkFBOEIsQ0FBQyxFQUFFLEVBQUUsV0FBVyxDQUFDLENBQUE7UUFDaEYsSUFBSSxZQUFZLEdBQUcsWUFBWSxDQUFBO1FBRS9CLElBQUksYUFBYSxLQUFLLElBQUksSUFBSSxDQUFDLFlBQVksS0FBSyxJQUFJLElBQUksYUFBYSxHQUFHLFlBQVksQ0FBQztZQUFFLFlBQVksR0FBRyxhQUFhLENBQUE7UUFDbkgsTUFBTSxTQUFTLEdBQUcsWUFBWSxLQUFLLElBQUksQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxZQUFZLEdBQUcsQ0FBQyxDQUFBO1FBRTlELElBQUksQ0FBQyxNQUFNLENBQUMsYUFBYSxDQUFDLFNBQVMsQ0FBQyxFQUFFLENBQUM7WUFDckMsTUFBTSxJQUFJLEtBQUssQ0FBQyx5REFBeUQsV0FBVyxFQUFFLENBQUMsQ0FBQTtRQUN6RixDQUFDO1FBRUQsTUFBTSxJQUFJLENBQUMsNEJBQTRCLENBQUMsRUFBRSxFQUFFLEVBQUMsV0FBVyxFQUFFLGFBQWEsRUFBRSxTQUFTLEVBQUMsQ0FBQyxDQUFBO1FBRXBGLE9BQU8sU0FBUyxDQUFBO0lBQ2xCLENBQUM7SUFFRDs7Ozs7O09BTUc7SUFDSCxLQUFLLENBQUMsOEJBQThCLENBQUMsRUFBRSxFQUFFLFdBQVc7UUFDbEQsTUFBTSxJQUFJLEdBQUcsTUFBTSxFQUFFO2FBQ2xCLFFBQVEsRUFBRTthQUNWLElBQUksQ0FBQyxVQUFVLENBQUM7YUFDaEIsTUFBTSxDQUFDLGdCQUFnQixDQUFDO2FBQ3hCLEtBQUssQ0FBQyxFQUFDLFlBQVksRUFBRSxXQUFXLEVBQUMsQ0FBQzthQUNsQyxRQUFRLENBQUMsRUFBQyxjQUFjLEVBQUUsSUFBSSxFQUFDLENBQUM7YUFDaEMsS0FBSyxDQUFDLHFCQUFxQixDQUFDO2FBQzVCLEtBQUssQ0FBQyxDQUFDLENBQUM7YUFDUixPQUFPLEVBQUUsQ0FBQTtRQUNaLE1BQU0sR0FBRyxHQUFHLElBQUksQ0FBQyxDQUFDLENBQUMsQ0FBQTtRQUVuQixJQUFJLENBQUMsR0FBRztZQUFFLE9BQU8sSUFBSSxDQUFBO1FBRXJCLE9BQU8sSUFBSSxDQUFDLHVCQUF1QjtRQUNqQyw0REFBNEQsQ0FBQyxDQUFDLEdBQUcsQ0FBQyxDQUFDLGNBQWMsQ0FDbEYsQ0FBQTtJQUNILENBQUM7SUFFRDs7Ozs7T0FLRztJQUNILEtBQUssQ0FBQyx1QkFBdUIsQ0FBQyxFQUFFLEVBQUUsV0FBVztRQUMzQyxNQUFNLElBQUksR0FBRyxNQUFNLEVBQUU7YUFDbEIsUUFBUSxFQUFFO2FBQ1YsSUFBSSxDQUFDLCtCQUErQixDQUFDO2FBQ3JDLE1BQU0sQ0FBQyxpQkFBaUIsQ0FBQzthQUN6QixLQUFLLENBQUMsRUFBQyxZQUFZLEVBQUUsV0FBVyxFQUFDLENBQUM7YUFDbEMsS0FBSyxDQUFDLENBQUMsQ0FBQzthQUNSLE9BQU8sRUFBRSxDQUFBO1FBQ1osTUFBTSxHQUFHLEdBQUcsSUFBSSxDQUFDLENBQUMsQ0FBQyxDQUFBO1FBRW5CLElBQUksQ0FBQyxHQUFHO1lBQUUsT0FBTyxJQUFJLENBQUE7UUFFckIsT0FBTyxJQUFJLENBQUMsdUJBQXVCO1FBQ2pDLDREQUE0RCxDQUFDLENBQUMsR0FBRyxDQUFDLENBQUMsZUFBZSxDQUNuRixDQUFBO0lBQ0gsQ0FBQztJQUVEOzs7Ozs7O09BT0c7SUFDSCxLQUFLLENBQUMsNEJBQTRCLENBQUMsRUFBRSxFQUFFLEVBQUMsV0FBVyxFQUFFLGFBQWEsRUFBQztRQUNqRSxNQUFNLEVBQUUsQ0FBQyxNQUFNLENBQUM7WUFDZCxTQUFTLEVBQUUsK0JBQStCO1lBQzFDLElBQUksRUFBRSxFQUFDLGVBQWUsRUFBRSxhQUFhLEVBQUUsWUFBWSxFQUFFLFdBQVcsRUFBQztZQUNqRSxlQUFlLEVBQUUsQ0FBQyxjQUFjLENBQUM7WUFDakMsYUFBYSxFQUFFLENBQUMsaUJBQWlCLENBQUM7U0FDbkMsQ0FBQyxDQUFBO0lBQ0osQ0FBQztJQUVEOzs7O09BSUc7SUFDSCx1QkFBdUIsQ0FBQyxLQUFLO1FBQzNCLE1BQU0sYUFBYSxHQUFHLElBQUksQ0FBQyxnQkFBZ0IsQ0FBQyxLQUFLLENBQUMsQ0FBQTtRQUVsRCxJQUFJLGFBQWEsS0FBSyxJQUFJLElBQUksQ0FBQyxNQUFNLENBQUMsYUFBYSxDQUFDLGFBQWEsQ0FBQyxJQUFJLGFBQWEsR0FBRyxDQUFDLEVBQUUsQ0FBQztZQUN4RixNQUFNLElBQUksS0FBSyxDQUFDLG9EQUFvRCxhQUFhLEVBQUUsQ0FBQyxDQUFBO1FBQ3RGLENBQUM7UUFFRCxPQUFPLGFBQWEsQ0FBQTtJQUN0QixDQUFDO0lBRUQ7Ozs7Ozs7T0FPRztJQUNILEtBQUssQ0FBQyxtQkFBbUIsQ0FBQyxFQUFFLEVBQUUsRUFBQyxxQkFBcUIsRUFBRSxXQUFXLEVBQUM7UUFDaEUsTUFBTSxRQUFRLEdBQUcsTUFBTSxJQUFJLENBQUMsa0JBQWtCLENBQUMsRUFBRSxFQUFFLFdBQVcsQ0FBQyxDQUFBO1FBQy9ELE1BQU0sVUFBVSxHQUFHLFFBQVEsSUFBSSxDQUFDLFFBQVEsQ0FBQyxNQUFNLEtBQUssUUFBUSxJQUFJLFFBQVEsQ0FBQyxNQUFNLEtBQUssWUFBWSxDQUFDLENBQUMsQ0FBQyxDQUFDLFFBQVEsQ0FBQyxDQUFDLENBQUMsSUFBSSxDQUFBO1FBRW5ILElBQUksQ0FBQyxxQkFBcUI7WUFBRSxPQUFPLEVBQUMsVUFBVSxFQUFFLGlCQUFpQixFQUFFLElBQUksRUFBQyxDQUFBO1FBRXhFLE1BQU0sZ0JBQWdCLEdBQUcsZ0NBQWdDLENBQUMsR0FBRyxDQUFDLENBQUMsTUFBTSxFQUFFLEVBQUUsQ0FBQyxFQUFFLENBQUMsS0FBSyxDQUFDLE1BQU0sQ0FBQyxDQUFDLENBQUMsSUFBSSxDQUFDLElBQUksQ0FBQyxDQUFBO1FBQ3RHLE1BQU0sWUFBWSxHQUFHLE1BQU0sRUFBRTthQUMxQixRQUFRLEVBQUU7YUFDVixJQUFJLENBQUMsVUFBVSxDQUFDO2FBQ2hCLEtBQUssQ0FBQyxFQUFDLFlBQVksRUFBRSxXQUFXLEVBQUMsQ0FBQzthQUNsQyxLQUFLLENBQUMsR0FBRyxFQUFFLENBQUMsV0FBVyxDQUFDLFFBQVEsQ0FBQyxRQUFRLGdCQUFnQixHQUFHLENBQUM7YUFDN0QsS0FBSyxDQUFDLGFBQWEsRUFBRSxDQUFDLFdBQVcsQ0FBQyxnQkFBZ0IsQ0FBQyxpQ0FBaUMsQ0FBQzthQUNyRixLQUFLLENBQUMscUJBQXFCLENBQUM7YUFDNUIsS0FBSyxDQUFDLG9CQUFvQixDQUFDO2FBQzNCLEtBQUssQ0FBQyxTQUFTLENBQUM7YUFDaEIsS0FBSyxDQUFDLENBQUMsQ0FBQzthQUNSLE9BQU8sRUFBRSxDQUFBO1FBQ1osTUFBTSxpQkFBaUIsR0FBRyxZQUFZLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLElBQUksQ0FBQyxnQkFBZ0IsQ0FBQyxZQUFZLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsSUFBSSxDQUFBO1FBRXpGLE9BQU8sRUFBQyxVQUFVLEVBQUUsaUJBQWlCLEVBQUMsQ0FBQTtJQUN4QyxDQUFDO0lBRUQ7Ozs7Ozs7T0FPRztJQUNILEtBQUssQ0FBQyx5QkFBeUIsQ0FBQyxFQUFFLEVBQUUsRUFBQyxLQUFLLEVBQUUsV0FBVyxFQUFDO1FBQ3RELE1BQU0sRUFBRSxDQUFDLE1BQU0sQ0FBQztZQUNkLFNBQVMsRUFBRSxtQkFBbUI7WUFDOUIsVUFBVSxFQUFFLEVBQUMsTUFBTSxFQUFFLEtBQUssRUFBRSxZQUFZLEVBQUUsV0FBVyxFQUFDO1NBQ3ZELENBQUMsQ0FBQTtJQUNKLENBQUM7SUFFRDs7Ozs7T0FLRztJQUNILEtBQUssQ0FBQywrQkFBK0IsQ0FBQyxFQUFFLEVBQUUsR0FBRztRQUMzQyxJQUFJLENBQUMsR0FBRyxDQUFDLFdBQVc7WUFBRSxPQUFNO1FBRTVCLE1BQU0sSUFBSSxDQUFDLHlCQUF5QixDQUFDLEVBQUUsRUFBRSxFQUFDLEtBQUssRUFBRSxHQUFHLENBQUMsRUFBRSxFQUFFLFdBQVcsRUFBRSxHQUFHLENBQUMsV0FBVyxFQUFDLENBQUMsQ0FBQTtJQUN6RixDQUFDO0lBRUQ7Ozs7Ozs7OztPQVNHO0lBQ0gsS0FBSyxDQUFDLGFBQWEsQ0FBQyxFQUFDLEVBQUUsRUFBRSxHQUFHLEVBQUUsS0FBSyxFQUFFLFlBQVksRUFBRSxVQUFVLEVBQUM7UUFDNUQsTUFBTSxHQUFHLEdBQUcsSUFBSSxDQUFDLEtBQUssQ0FBQyxHQUFHLEVBQUUsQ0FBQTtRQUM1QixNQUFNLFdBQVcsR0FBRyxDQUFDLEdBQUcsQ0FBQyxRQUFRLElBQUksQ0FBQyxDQUFDLEdBQUcsQ0FBQyxDQUFBO1FBQzNDLE1BQU0sVUFBVSxHQUFHLElBQUksQ0FBQyxvQkFBb0IsQ0FBQyxHQUFHLENBQUMsVUFBVSxDQUFDLENBQUE7UUFDNUQsTUFBTSxXQUFXLEdBQUcsV0FBVyxJQUFJLFVBQVUsQ0FBQTtRQUM3QyxNQUFNLGNBQWMsR0FBRywyQkFBMkIsQ0FBQyxLQUFLLENBQUMsQ0FBQTtRQUN6RCxNQUFNLFdBQVcsR0FBRyxXQUFXLENBQUMsQ0FBQyxDQUFDLEdBQUcsR0FBRyxJQUFJLENBQUMsZUFBZSxDQUFDLFdBQVcsQ0FBQyxDQUFDLENBQUMsQ0FBQyxHQUFHLENBQUMsYUFBYSxDQUFBO1FBQzdGLE1BQU0sTUFBTSxHQUFHLElBQUksQ0FBQyxjQUFjLENBQUM7WUFDakMsY0FBYztZQUNkLFlBQVk7WUFDWixXQUFXO1lBQ1gsR0FBRztZQUNILFdBQVc7WUFDWCxXQUFXO1NBQ1osQ0FBQyxDQUFBO1FBRUYsTUFBTSxJQUFJLENBQUMsbUJBQW1CLENBQUMsRUFBRSxFQUFFLEdBQUcsQ0FBQyxjQUFjLENBQUMsQ0FBQTtRQUN0RCxNQUFNLFlBQVksR0FBRyxNQUFNLElBQUksQ0FBQyxtQkFBbUIsQ0FBQyxFQUFFLEVBQUU7WUFDdEQsU0FBUyxFQUFFLFVBQVU7WUFDckIsSUFBSSxFQUFFLE1BQU07WUFDWixVQUFVLEVBQUUsVUFBVSxJQUFJLElBQUksQ0FBQyx3QkFBd0IsQ0FBQyxHQUFHLENBQUM7U0FDN0QsQ0FBQyxDQUFBO1FBRUYsSUFBSSxZQUFZLEtBQUssQ0FBQztZQUFFLE9BQU8sSUFBSSxDQUFBO1FBQ25DLElBQUksQ0FBQyxXQUFXO1lBQUUsTUFBTSxJQUFJLENBQUMsK0JBQStCLENBQUMsRUFBRSxFQUFFLEdBQUcsQ0FBQyxDQUFBO1FBQ3JFLE1BQU0sSUFBSSxDQUFDLG1CQUFtQixDQUFDLEVBQUUsRUFBRSxHQUFHLENBQUMsY0FBYyxDQUFDLENBQUE7UUFFdEQsK0ZBQStGO1FBQy9GLGlHQUFpRztRQUNqRyxnR0FBZ0c7UUFDaEcsd0ZBQXdGO1FBQ3hGLGtGQUFrRjtRQUNsRixNQUFNLE1BQU0sR0FBRyxXQUFXLENBQUMsQ0FBQyxDQUFDLFFBQVEsQ0FBQyxDQUFDLENBQUMsQ0FBQyxZQUFZLENBQUMsQ0FBQyxDQUFDLFVBQVUsQ0FBQyxDQUFDLENBQUMsUUFBUSxDQUFDLENBQUE7UUFDOUUsb0RBQW9EO1FBQ3BELE1BQU0sZUFBZSxHQUFHO1lBQ3RCLEdBQUcsR0FBRztZQUNOLEdBQUcsQ0FBQyxXQUFXLENBQUMsQ0FBQyxDQUFDLElBQUksQ0FBQywwQkFBMEIsRUFBRSxDQUFDLENBQUMsQ0FBQyxFQUFFLENBQUM7WUFDekQsUUFBUSxFQUFFLFdBQVc7WUFDckIsYUFBYSxFQUFFLElBQUk7WUFDbkIsU0FBUyxFQUFFLGNBQWM7WUFDekIsTUFBTTtZQUNOLFFBQVEsRUFBRSxJQUFJO1NBQ2YsQ0FBQTtRQUVELElBQUksWUFBWTtZQUFFLGVBQWUsQ0FBQyxZQUFZLEdBQUcsR0FBRyxDQUFBO1FBQ3BELElBQUksV0FBVyxFQUFFLENBQUM7WUFDaEIsZUFBZSxDQUFDLGFBQWEsR0FBRyxXQUFXLENBQUE7UUFDN0MsQ0FBQzthQUFNLElBQUksQ0FBQyxZQUFZLEVBQUUsQ0FBQztZQUN6QixlQUFlLENBQUMsVUFBVSxHQUFHLEdBQUcsQ0FBQTtRQUNsQyxDQUFDO1FBRUQsT0FBTyxlQUFlLENBQUE7SUFDeEIsQ0FBQztJQUVEOzs7Ozs7Ozs7O09BVUc7SUFDSCxjQUFjLENBQUMsRUFBQyxjQUFjLEVBQUUsWUFBWSxFQUFFLFdBQVcsRUFBRSxHQUFHLEVBQUUsV0FBVyxFQUFFLFdBQVcsRUFBQztRQUN2Rjs7bUVBRTJEO1FBQzNELE1BQU0sTUFBTSxHQUFHO1lBQ2IsUUFBUSxFQUFFLFdBQVc7WUFDckIsZ0JBQWdCLEVBQUUsSUFBSTtZQUN0QixTQUFTLEVBQUUsSUFBSTtZQUNmLFVBQVUsRUFBRSxjQUFjO1NBQzNCLENBQUE7UUFFRCwwRUFBMEU7UUFDMUUsNEVBQTRFO1FBQzVFLHlFQUF5RTtRQUN6RSxJQUFJLFdBQVc7WUFBRSxNQUFNLENBQUMsTUFBTSxDQUFDLE1BQU0sRUFBRSxJQUFJLENBQUMsMkJBQTJCLEVBQUUsQ0FBQyxDQUFBO1FBRTFFLElBQUksQ0FBQywyQkFBMkIsQ0FBQyxFQUFDLFlBQVksRUFBRSxHQUFHLEVBQUUsTUFBTSxFQUFDLENBQUMsQ0FBQTtRQUM3RCxJQUFJLENBQUMseUJBQXlCLENBQUMsRUFBQyxZQUFZLEVBQUUsR0FBRyxFQUFFLFdBQVcsRUFBRSxXQUFXLEVBQUUsTUFBTSxFQUFDLENBQUMsQ0FBQTtRQUVyRixPQUFPLE1BQU0sQ0FBQTtJQUNmLENBQUM7SUFFRDs7Ozs7OztPQU9HO0lBQ0gsMkJBQTJCLENBQUMsRUFBQyxZQUFZLEVBQUUsR0FBRyxFQUFFLE1BQU0sRUFBQztRQUNyRCxJQUFJLFlBQVk7WUFBRSxNQUFNLENBQUMsY0FBYyxHQUFHLEdBQUcsQ0FBQTtJQUMvQyxDQUFDO0lBRUQ7Ozs7Ozs7OztPQVNHO0lBQ0gseUJBQXlCLENBQUMsRUFBQyxZQUFZLEVBQUUsR0FBRyxFQUFFLFdBQVcsRUFBRSxXQUFXLEVBQUUsTUFBTSxFQUFDO1FBQzdFLElBQUksV0FBVyxFQUFFLENBQUM7WUFDaEIsTUFBTSxDQUFDLE1BQU0sR0FBRyxRQUFRLENBQUE7WUFDeEIsTUFBTSxDQUFDLGVBQWUsR0FBRyxXQUFXLENBQUE7WUFDcEMsT0FBTTtRQUNSLENBQUM7UUFFRCxJQUFJLFlBQVksRUFBRSxDQUFDO1lBQ2pCLE1BQU0sQ0FBQyxNQUFNLEdBQUcsVUFBVSxDQUFBO1lBQzFCLE9BQU07UUFDUixDQUFDO1FBRUQsTUFBTSxDQUFDLE1BQU0sR0FBRyxRQUFRLENBQUE7UUFDeEIsTUFBTSxDQUFDLFlBQVksR0FBRyxHQUFHLENBQUE7SUFDM0IsQ0FBQztJQUVEOzs7O09BSUc7SUFDSCxnQkFBZ0IsQ0FBQyxHQUFHO1FBQ2xCLE1BQU0sU0FBUyxHQUFHLEdBQUcsQ0FBQyxVQUFVLENBQUMsQ0FBQyxDQUFDLE1BQU0sQ0FBQyxHQUFHLENBQUMsVUFBVSxDQUFDLENBQUMsQ0FBQyxDQUFDLElBQUksQ0FBQTtRQUNoRSw0RUFBNEU7UUFDNUUsaUZBQWlGO1FBQ2pGLHFEQUFxRDtRQUNyRCxNQUFNLGFBQWEsR0FBRyxHQUFHLENBQUMsY0FBYyxDQUFDLENBQUMsQ0FBQyxJQUFJLENBQUMsMkJBQTJCLENBQUMsTUFBTSxDQUFDLEdBQUcsQ0FBQyxjQUFjLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxxQ0FBcUMsQ0FBQTtRQUUvSSxPQUFPO1lBQ0wsRUFBRSxFQUFFLE1BQU0sQ0FBQyxHQUFHLENBQUMsRUFBRSxDQUFDO1lBQ2xCLE9BQU8sRUFBRSxNQUFNLENBQUMsR0FBRyxDQUFDLFFBQVEsQ0FBQztZQUM3QixJQUFJLEVBQUUsSUFBSSxDQUFDLFVBQVUsQ0FBQyxHQUFHLENBQUMsU0FBUyxDQUFDO1lBQ3BDLGFBQWE7WUFDYixLQUFLLEVBQUUsR0FBRyxDQUFDLEtBQUssQ0FBQyxDQUFDLENBQUMsTUFBTSxDQUFDLEdBQUcsQ0FBQyxLQUFLLENBQUMsQ0FBQyxDQUFDLENBQUMsNEJBQTRCO1lBQ25FLFdBQVcsRUFBRSxHQUFHLENBQUMsWUFBWSxDQUFDLENBQUMsQ0FBQyxNQUFNLENBQUMsR0FBRyxDQUFDLFlBQVksQ0FBQyxDQUFDLENBQUMsQ0FBQyxJQUFJO1lBQy9ELGFBQWEsRUFBRSxJQUFJLENBQUMsZ0JBQWdCLENBQUMsR0FBRyxDQUFDLGNBQWMsQ0FBQztZQUN4RCxNQUFNLEVBQUUsNEJBQTRCLENBQUMsR0FBRyxDQUFDLE1BQU0sQ0FBQyxDQUFDLENBQUMsTUFBTSxDQUFDLEdBQUcsQ0FBQyxNQUFNLENBQUMsQ0FBQyxDQUFDLENBQUMsUUFBUSxDQUFDO1lBQ2hGLFFBQVEsRUFBRSxJQUFJLENBQUMsZ0JBQWdCLENBQUMsR0FBRyxDQUFDLFFBQVEsQ0FBQztZQUM3QyxVQUFVLEVBQUUsSUFBSSxDQUFDLGdCQUFnQixDQUFDLEdBQUcsQ0FBQyxXQUFXLENBQUM7WUFDbEQsYUFBYSxFQUFFLElBQUksQ0FBQyxnQkFBZ0IsQ0FBQyxHQUFHLENBQUMsZUFBZSxDQUFDO1lBQ3pELFdBQVcsRUFBRSxJQUFJLENBQUMsZ0JBQWdCLENBQUMsR0FBRyxDQUFDLGFBQWEsQ0FBQztZQUNyRCxhQUFhLEVBQUUsSUFBSSxDQUFDLGdCQUFnQixDQUFDLEdBQUcsQ0FBQyxnQkFBZ0IsQ0FBQztZQUMxRCxTQUFTO1lBQ1QsYUFBYSxFQUFFLElBQUksQ0FBQyxnQkFBZ0IsQ0FBQyxHQUFHLENBQUMsZUFBZSxDQUFDO1lBQ3pELFVBQVUsRUFBRSxJQUFJLENBQUMsZ0JBQWdCLENBQUMsR0FBRyxDQUFDLFlBQVksQ0FBQztZQUNuRCxZQUFZLEVBQUUsSUFBSSxDQUFDLGdCQUFnQixDQUFDLEdBQUcsQ0FBQyxjQUFjLENBQUM7WUFDdkQsUUFBUSxFQUFFLEdBQUcsQ0FBQyxTQUFTLENBQUMsQ0FBQyxDQUFDLE1BQU0sQ0FBQyxHQUFHLENBQUMsU0FBUyxDQUFDLENBQUMsQ0FBQyxDQUFDLElBQUk7WUFDdEQsU0FBUyxFQUFFLEdBQUcsQ0FBQyxVQUFVLENBQUMsQ0FBQyxDQUFDLE1BQU0sQ0FBQyxHQUFHLENBQUMsVUFBVSxDQUFDLENBQUMsQ0FBQyxDQUFDLElBQUk7WUFDekQsY0FBYyxFQUFFLEdBQUcsQ0FBQyxlQUFlLENBQUMsQ0FBQyxDQUFDLE1BQU0sQ0FBQyxHQUFHLENBQUMsZUFBZSxDQUFDLENBQUMsQ0FBQyxDQUFDLElBQUk7WUFDeEUsY0FBYyxFQUFFLElBQUksQ0FBQyxnQkFBZ0IsQ0FBQyxHQUFHLENBQUMsZUFBZSxDQUFDO1lBQzFELFNBQVMsRUFBRSxJQUFJLENBQUMsZ0JBQWdCLENBQUMsR0FBRyxDQUFDLFVBQVUsQ0FBQztZQUNoRCxpQkFBaUIsRUFBRSxJQUFJLENBQUMsZ0JBQWdCLENBQUMsR0FBRyxDQUFDLG9CQUFvQixDQUFDO1lBQ2xFLGdCQUFnQixFQUFFLElBQUksQ0FBQyxnQkFBZ0IsQ0FBQyxHQUFHLENBQUMsbUJBQW1CLENBQUM7WUFDaEUsZUFBZSxFQUFFLEdBQUcsQ0FBQyxpQkFBaUIsQ0FBQyxDQUFDLENBQUMsTUFBTSxDQUFDLEdBQUcsQ0FBQyxpQkFBaUIsQ0FBQyxDQUFDLENBQUMsQ0FBQyxJQUFJO1lBQzdFLFFBQVEsRUFBRSxJQUFJLENBQUMsZ0JBQWdCLENBQUMsR0FBRyxDQUFDLFNBQVMsQ0FBQztZQUM5QyxjQUFjLEVBQUUsR0FBRyxDQUFDLGVBQWUsQ0FBQyxDQUFDLENBQUMsTUFBTSxDQUFDLEdBQUcsQ0FBQyxlQUFlLENBQUMsQ0FBQyxDQUFDLENBQUMsSUFBSTtTQUN6RSxDQUFBO0lBQ0gsQ0FBQztJQUVEOzs7O09BSUc7SUFDSCxlQUFlLENBQUMsT0FBTztRQUNyQixPQUFPLDJCQUEyQixDQUFDLE9BQU8sQ0FBQyxDQUFBO0lBQzdDLENBQUM7SUFFRDs7Ozs7Ozs7O09BU0c7SUFDSCxtQkFBbUIsQ0FBQyxPQUFPLEVBQUUsS0FBSztRQUNoQyxPQUFPLGlDQUFpQyxDQUFDO1lBQ3ZDLE9BQU8sRUFBRSxPQUFPLElBQUksRUFBRTtZQUN0QixLQUFLO1lBQ0wsTUFBTSxFQUFFLElBQUksQ0FBQyxhQUFhLENBQUMsdUJBQXVCLEVBQUUsQ0FBQyxNQUFNO1NBQzVELENBQUMsQ0FBQTtJQUNKLENBQUM7SUFFRDs7Ozs7O09BTUc7SUFDSCxLQUFLLENBQUMsOEJBQThCLENBQUMsRUFBRSxFQUFFLEdBQUc7UUFDMUMsSUFBSSxHQUFHLENBQUMsY0FBYyxJQUFJLENBQUMsR0FBRyxDQUFDLGNBQWMsQ0FBQyxVQUFVLENBQUMsNEJBQTRCLENBQUMsRUFBRSxDQUFDO1lBQ3ZGLE9BQU8sR0FBRyxDQUFBO1FBQ1osQ0FBQztRQUVELE1BQU0sV0FBVyxHQUFHLElBQUksQ0FBQyxtQkFBbUIsQ0FBQyxFQUFFLEVBQUUsR0FBRyxDQUFDLEtBQUssQ0FBQyxDQUFBO1FBQzNELDZDQUE2QztRQUM3QyxNQUFNLE9BQU8sR0FBRyxXQUFXO1lBQ3pCLENBQUMsQ0FBQyxFQUFDLGNBQWMsRUFBRSxXQUFXLENBQUMsY0FBYyxFQUFFLGNBQWMsRUFBRSxXQUFXLENBQUMsY0FBYyxFQUFDO1lBQzFGLENBQUMsQ0FBQyxFQUFDLGNBQWMsRUFBRSxJQUFJLEVBQUUsY0FBYyxFQUFFLElBQUksRUFBQyxDQUFBO1FBRWhELElBQUksV0FBVztZQUFFLE1BQU0sSUFBSSxDQUFDLDBCQUEwQixDQUFDLEVBQUUsRUFBRSxXQUFXLENBQUMsQ0FBQTtRQUN2RSxJQUFJLEdBQUcsQ0FBQyxjQUFjLEtBQUssT0FBTyxDQUFDLGNBQWMsSUFBSSxHQUFHLENBQUMsY0FBYyxLQUFLLE9BQU8sQ0FBQyxjQUFjO1lBQUUsT0FBTyxHQUFHLENBQUE7UUFFOUcsTUFBTSxZQUFZLEdBQUcsTUFBTSxJQUFJLENBQUMsbUJBQW1CLENBQUMsRUFBRSxFQUFFO1lBQ3RELFNBQVMsRUFBRSxVQUFVO1lBQ3JCLElBQUksRUFBRTtnQkFDSixlQUFlLEVBQUUsT0FBTyxDQUFDLGNBQWM7Z0JBQ3ZDLGVBQWUsRUFBRSxPQUFPLENBQUMsY0FBYzthQUN4QztZQUNELFVBQVUsRUFBRSxFQUFDLGVBQWUsRUFBRSxHQUFHLENBQUMsY0FBYyxFQUFFLEVBQUUsRUFBRSxHQUFHLENBQUMsRUFBRSxFQUFFLE1BQU0sRUFBRSxRQUFRLEVBQUM7U0FDaEYsQ0FBQyxDQUFBO1FBRUYsSUFBSSxZQUFZLEtBQUssQ0FBQztZQUFFLE9BQU8sSUFBSSxDQUFBO1FBRW5DLE9BQU8sRUFBQyxHQUFHLEdBQUcsRUFBRSxjQUFjLEVBQUUsT0FBTyxDQUFDLGNBQWMsRUFBRSxjQUFjLEVBQUUsT0FBTyxDQUFDLGNBQWMsRUFBQyxDQUFBO0lBQ2pHLENBQUM7SUFFRDs7OztPQUlHO0lBQ0gsb0JBQW9CLENBQUMsS0FBSztRQUN4QixNQUFNLE1BQU0sR0FBRyxJQUFJLENBQUMsYUFBYSxDQUFDLHVCQUF1QixFQUFFLENBQUMsTUFBTSxDQUFBO1FBQ2xFLE1BQU0sR0FBRyxHQUFHLE1BQU0sRUFBRSxDQUFDLEtBQUssQ0FBQyxFQUFFLGFBQWEsQ0FBQTtRQUUxQyxJQUFJLE1BQU0sQ0FBQyxTQUFTLENBQUMsR0FBRyxDQUFDLElBQUksTUFBTSxDQUFDLEdBQUcsQ0FBQyxHQUFHLENBQUM7WUFBRSxPQUFPLE1BQU0sQ0FBQyxHQUFHLENBQUMsQ0FBQTtRQUVoRSxPQUFPLElBQUksQ0FBQTtJQUNiLENBQUM7SUFFRDs7Ozs7OztPQU9HO0lBQ0gsS0FBSyxDQUFDLDBCQUEwQixDQUFDLEVBQUUsRUFBRSxFQUFDLGNBQWMsRUFBRSxjQUFjLEVBQUM7UUFDbkUsTUFBTSxJQUFJLEdBQUcsTUFBTSxFQUFFLENBQUMsUUFBUSxFQUFFLENBQUMsSUFBSSxDQUFDLGlCQUFpQixDQUFDLENBQUMsS0FBSyxDQUFDLEVBQUMsZUFBZSxFQUFFLGNBQWMsRUFBQyxDQUFDLENBQUMsS0FBSyxDQUFDLENBQUMsQ0FBQyxDQUFDLE9BQU8sRUFBRSxDQUFBO1FBRXBILElBQUksQ0FBQyxJQUFJLENBQUMsQ0FBQyxDQUFDLEVBQUUsQ0FBQztZQUNiLElBQUksQ0FBQztnQkFDSCxNQUFNLEVBQUUsQ0FBQyxNQUFNLENBQUMsRUFBQyxTQUFTLEVBQUUsaUJBQWlCLEVBQUUsSUFBSSxFQUFFLEVBQUMsWUFBWSxFQUFFLENBQUMsRUFBRSxlQUFlLEVBQUUsY0FBYyxFQUFFLGVBQWUsRUFBRSxjQUFjLEVBQUMsRUFBQyxDQUFDLENBQUE7Z0JBRTFJLE9BQU07WUFDUixDQUFDO1lBQUMsT0FBTyxLQUFLLEVBQUUsQ0FBQztnQkFDZixNQUFNLFNBQVMsR0FBRyxNQUFNLEVBQUUsQ0FBQyxRQUFRLEVBQUUsQ0FBQyxJQUFJLENBQUMsaUJBQWlCLENBQUMsQ0FBQyxLQUFLLENBQUMsRUFBQyxlQUFlLEVBQUUsY0FBYyxFQUFDLENBQUMsQ0FBQyxLQUFLLENBQUMsQ0FBQyxDQUFDLENBQUMsT0FBTyxFQUFFLENBQUE7Z0JBRXpILElBQUksQ0FBQyxTQUFTLENBQUMsQ0FBQyxDQUFDO29CQUFFLE1BQU0sS0FBSyxDQUFBO2dCQUU5QixJQUFJLENBQUMsQ0FBQyxDQUFDLEdBQUcsU0FBUyxDQUFDLENBQUMsQ0FBQyxDQUFBO1lBQ3hCLENBQUM7UUFDSCxDQUFDO1FBRUQsTUFBTSxVQUFVLEdBQUcsa0RBQWtELENBQUMsQ0FBQyxJQUFJLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQTtRQUUvRSxJQUFJLElBQUksQ0FBQyxnQkFBZ0IsQ0FBQyxVQUFVLENBQUMsZUFBZSxDQUFDLEtBQUssY0FBYyxFQUFFLENBQUM7WUFDekUsTUFBTSxLQUFLLEdBQUcsRUFBRSxDQUFDLFVBQVUsQ0FBQyxpQkFBaUIsQ0FBQyxDQUFBO1lBRTlDLE1BQU0sRUFBRSxDQUFDLEtBQUssQ0FBQyxVQUFVLEtBQUssUUFBUSxFQUFFLENBQUMsV0FBVyxDQUFDLGlCQUFpQixDQUFDLE1BQU0sTUFBTSxDQUFDLGNBQWMsQ0FBQyxVQUFVLEVBQUUsQ0FBQyxXQUFXLENBQUMsaUJBQWlCLENBQUMsTUFBTSxFQUFFLENBQUMsS0FBSyxDQUFDLGNBQWMsQ0FBQyxFQUFFLENBQUMsQ0FBQTtRQUNqTCxDQUFDO0lBQ0gsQ0FBQztJQUVEOzs7O09BSUc7SUFDSCxLQUFLLENBQUMsdUJBQXVCLENBQUMsRUFBRTtRQUM5QixJQUFJLE1BQU0sRUFBRSxDQUFDLFdBQVcsQ0FBQyxpQkFBaUIsQ0FBQztZQUFFLE9BQU07UUFDbkQsTUFBTSxLQUFLLEdBQUcsSUFBSSxTQUFTLENBQUMsaUJBQWlCLEVBQUUsRUFBQyxXQUFXLEVBQUUsSUFBSSxFQUFDLENBQUMsQ0FBQTtRQUNuRSxLQUFLLENBQUMsTUFBTSxDQUFDLGlCQUFpQixFQUFFLEVBQUMsVUFBVSxFQUFFLElBQUksRUFBQyxDQUFDLENBQUE7UUFDbkQsS0FBSyxDQUFDLE9BQU8sQ0FBQyxpQkFBaUIsRUFBRSxFQUFDLElBQUksRUFBRSxLQUFLLEVBQUMsQ0FBQyxDQUFBO1FBQy9DLEtBQUssQ0FBQyxPQUFPLENBQUMsY0FBYyxFQUFFLEVBQUMsSUFBSSxFQUFFLEtBQUssRUFBQyxDQUFDLENBQUE7UUFDNUMsTUFBTSxFQUFFLENBQUMsV0FBVyxDQUFDLEtBQUssQ0FBQyxDQUFBO0lBQzdCLENBQUM7SUFFRDs7OztPQUlHO0lBQ0gsS0FBSyxDQUFDLHdCQUF3QixDQUFDLEVBQUU7UUFDL0IsSUFBSSxNQUFNLEVBQUUsQ0FBQyxXQUFXLENBQUMsbUJBQW1CLENBQUM7WUFBRSxPQUFNO1FBRXJELE1BQU0sUUFBUSxHQUFHLEdBQUcsZUFBZSxzQkFBc0IsQ0FBQTtRQUN6RCxNQUFNLFFBQVEsR0FBRyxNQUFNLEVBQUUsQ0FBQyxtQkFBbUIsQ0FBQyxRQUFRLENBQUMsQ0FBQTtRQUV2RCxJQUFJLENBQUMsUUFBUTtZQUFFLE1BQU0sSUFBSSxLQUFLLENBQUMsa0VBQWtFLENBQUMsQ0FBQTtRQUVsRyxJQUFJLENBQUM7WUFDSCxFQUFFLENBQUMsZ0JBQWdCLEVBQUUsQ0FBQTtZQUNyQixJQUFJLE1BQU0sRUFBRSxDQUFDLFdBQVcsQ0FBQyxtQkFBbUIsQ0FBQztnQkFBRSxPQUFNO1lBRXJELE1BQU0sS0FBSyxHQUFHLElBQUksU0FBUyxDQUFDLG1CQUFtQixFQUFFLEVBQUMsV0FBVyxFQUFFLElBQUksRUFBQyxDQUFDLENBQUE7WUFFckUsS0FBSyxDQUFDLE1BQU0sQ0FBQyxjQUFjLEVBQUUsRUFBQyxVQUFVLEVBQUUsSUFBSSxFQUFDLENBQUMsQ0FBQTtZQUNoRCxLQUFLLENBQUMsTUFBTSxDQUFDLFFBQVEsRUFBRSxFQUFDLElBQUksRUFBRSxLQUFLLEVBQUUsS0FBSyxFQUFFLElBQUksRUFBQyxDQUFDLENBQUE7WUFDbEQsTUFBTSxFQUFFLENBQUMsV0FBVyxDQUFDLEtBQUssQ0FBQyxDQUFBO1lBQzNCLEVBQUUsQ0FBQyxnQkFBZ0IsRUFBRSxDQUFBO1FBQ3ZCLENBQUM7Z0JBQVMsQ0FBQztZQUNULE1BQU0sRUFBRSxDQUFDLG1CQUFtQixDQUFDLFFBQVEsQ0FBQyxDQUFBO1FBQ3hDLENBQUM7SUFDSCxDQUFDO0lBRUQ7Ozs7T0FJRztJQUNILEtBQUssQ0FBQywyQkFBMkIsQ0FBQyxFQUFFO1FBQ2xDLElBQUksTUFBTSxFQUFFLENBQUMsV0FBVyxDQUFDLHNCQUFzQixDQUFDO1lBQUUsT0FBTTtRQUV4RCxNQUFNLFFBQVEsR0FBRyxHQUFHLGVBQWUseUJBQXlCLENBQUE7UUFDNUQsTUFBTSxRQUFRLEdBQUcsTUFBTSxFQUFFLENBQUMsbUJBQW1CLENBQUMsUUFBUSxDQUFDLENBQUE7UUFFdkQsSUFBSSxDQUFDLFFBQVE7WUFBRSxNQUFNLElBQUksS0FBSyxDQUFDLG9FQUFvRSxDQUFDLENBQUE7UUFFcEcsSUFBSSxDQUFDO1lBQ0gsRUFBRSxDQUFDLGdCQUFnQixFQUFFLENBQUE7WUFDckIsSUFBSSxNQUFNLEVBQUUsQ0FBQyxXQUFXLENBQUMsc0JBQXNCLENBQUM7Z0JBQUUsT0FBTTtZQUV4RCxNQUFNLEtBQUssR0FBRyxJQUFJLFNBQVMsQ0FBQyxzQkFBc0IsRUFBRSxFQUFDLFdBQVcsRUFBRSxJQUFJLEVBQUMsQ0FBQyxDQUFBO1lBRXhFLEtBQUssQ0FBQyxNQUFNLENBQUMsY0FBYyxFQUFFLEVBQUMsVUFBVSxFQUFFLElBQUksRUFBQyxDQUFDLENBQUE7WUFDaEQsS0FBSyxDQUFDLE1BQU0sQ0FBQyxVQUFVLEVBQUUsRUFBQyxJQUFJLEVBQUUsS0FBSyxFQUFDLENBQUMsQ0FBQTtZQUN2QyxLQUFLLENBQUMsTUFBTSxDQUFDLE9BQU8sRUFBRSxFQUFDLElBQUksRUFBRSxLQUFLLEVBQUMsQ0FBQyxDQUFBO1lBQ3BDLEtBQUssQ0FBQyxJQUFJLENBQUMsaUJBQWlCLEVBQUUsRUFBQyxJQUFJLEVBQUUsS0FBSyxFQUFDLENBQUMsQ0FBQTtZQUM1QyxLQUFLLENBQUMsTUFBTSxDQUFDLFFBQVEsRUFBRSxFQUFDLEtBQUssRUFBRSxJQUFJLEVBQUUsSUFBSSxFQUFFLEtBQUssRUFBQyxDQUFDLENBQUE7WUFDbEQsS0FBSyxDQUFDLE1BQU0sQ0FBQyxnQkFBZ0IsRUFBRSxFQUFDLElBQUksRUFBRSxLQUFLLEVBQUMsQ0FBQyxDQUFBO1lBQzdDLEtBQUssQ0FBQyxNQUFNLENBQUMsZUFBZSxFQUFFLEVBQUMsSUFBSSxFQUFFLEtBQUssRUFBQyxDQUFDLENBQUE7WUFDNUMsTUFBTSxFQUFFLENBQUMsV0FBVyxDQUFDLEtBQUssQ0FBQyxDQUFBO1lBQzNCLEVBQUUsQ0FBQyxnQkFBZ0IsRUFBRSxDQUFBO1FBQ3ZCLENBQUM7Z0JBQVMsQ0FBQztZQUNULE1BQU0sRUFBRSxDQUFDLG1CQUFtQixDQUFDLFFBQVEsQ0FBQyxDQUFBO1FBQ3hDLENBQUM7SUFDSCxDQUFDO0lBRUQ7Ozs7T0FJRztJQUNILEtBQUssQ0FBQyxrQ0FBa0MsQ0FBQyxFQUFFO1FBQ3pDLElBQUksTUFBTSxFQUFFLENBQUMsV0FBVyxDQUFDLDhCQUE4QixDQUFDO1lBQUUsT0FBTTtRQUVoRSxNQUFNLFFBQVEsR0FBRyxHQUFHLGVBQWUsaUNBQWlDLENBQUE7UUFDcEUsTUFBTSxRQUFRLEdBQUcsTUFBTSxFQUFFLENBQUMsbUJBQW1CLENBQUMsUUFBUSxDQUFDLENBQUE7UUFFdkQsSUFBSSxDQUFDLFFBQVE7WUFBRSxNQUFNLElBQUksS0FBSyxDQUFDLDZEQUE2RCxDQUFDLENBQUE7UUFFN0YsSUFBSSxDQUFDO1lBQ0gsRUFBRSxDQUFDLGdCQUFnQixFQUFFLENBQUE7WUFDckIsSUFBSSxNQUFNLEVBQUUsQ0FBQyxXQUFXLENBQUMsOEJBQThCLENBQUM7Z0JBQUUsT0FBTTtZQUVoRSxNQUFNLEtBQUssR0FBRyxJQUFJLFNBQVMsQ0FBQyw4QkFBOEIsRUFBRSxFQUFDLFdBQVcsRUFBRSxJQUFJLEVBQUMsQ0FBQyxDQUFBO1lBRWhGLEtBQUssQ0FBQyxNQUFNLENBQUMsZUFBZSxFQUFFLEVBQUMsVUFBVSxFQUFFLElBQUksRUFBQyxDQUFDLENBQUE7WUFDakQsS0FBSyxDQUFDLElBQUksQ0FBQyxjQUFjLEVBQUUsRUFBQyxJQUFJLEVBQUUsS0FBSyxFQUFDLENBQUMsQ0FBQTtZQUN6QyxLQUFLLENBQUMsTUFBTSxDQUFDLGdCQUFnQixFQUFFLEVBQUMsSUFBSSxFQUFFLEtBQUssRUFBQyxDQUFDLENBQUE7WUFDN0MsS0FBSyxDQUFDLE1BQU0sQ0FBQyxtQkFBbUIsRUFBRSxFQUFDLEtBQUssRUFBRSxJQUFJLEVBQUUsSUFBSSxFQUFFLEtBQUssRUFBQyxDQUFDLENBQUE7WUFDN0QsS0FBSyxDQUFDLE1BQU0sQ0FBQyw2QkFBNkIsRUFBRSxFQUFDLElBQUksRUFBRSxJQUFJLEVBQUMsQ0FBQyxDQUFBO1lBQ3pELEtBQUssQ0FBQyxNQUFNLENBQUMsZUFBZSxFQUFFLEVBQUMsSUFBSSxFQUFFLEtBQUssRUFBQyxDQUFDLENBQUE7WUFDNUMsS0FBSyxDQUFDLE1BQU0sQ0FBQyx1QkFBdUIsRUFBRSxFQUFDLElBQUksRUFBRSxLQUFLLEVBQUMsQ0FBQyxDQUFBO1lBQ3BELEtBQUssQ0FBQyxNQUFNLENBQUMsZUFBZSxFQUFFLEVBQUMsSUFBSSxFQUFFLEtBQUssRUFBQyxDQUFDLENBQUE7WUFDNUMsTUFBTSxFQUFFLENBQUMsV0FBVyxDQUFDLEtBQUssQ0FBQyxDQUFBO1lBQzNCLEVBQUUsQ0FBQyxnQkFBZ0IsRUFBRSxDQUFBO1FBQ3ZCLENBQUM7Z0JBQVMsQ0FBQztZQUNULE1BQU0sRUFBRSxDQUFDLG1CQUFtQixDQUFDLFFBQVEsQ0FBQyxDQUFBO1FBQ3hDLENBQUM7SUFDSCxDQUFDO0lBRUQ7Ozs7T0FJRztJQUNILEtBQUssQ0FBQyx5QkFBeUIsQ0FBQyxFQUFFO1FBQ2hDLElBQUksQ0FBQyxDQUFDLE1BQU0sRUFBRSxDQUFDLFdBQVcsQ0FBQyxxQkFBcUIsQ0FBQyxDQUFDLEVBQUUsQ0FBQztZQUNuRCxNQUFNLEtBQUssR0FBRyxJQUFJLFNBQVMsQ0FBQyxxQkFBcUIsRUFBRSxFQUFDLFdBQVcsRUFBRSxJQUFJLEVBQUMsQ0FBQyxDQUFBO1lBRXZFLEtBQUssQ0FBQyxNQUFNLENBQUMsS0FBSyxFQUFFLEVBQUMsVUFBVSxFQUFFLElBQUksRUFBQyxDQUFDLENBQUE7WUFDdkMsS0FBSyxDQUFDLE1BQU0sQ0FBQyxVQUFVLEVBQUUsRUFBQyxJQUFJLEVBQUUsS0FBSyxFQUFDLENBQUMsQ0FBQTtZQUN2QyxNQUFNLEVBQUUsQ0FBQyxXQUFXLENBQUMsS0FBSyxDQUFDLENBQUE7UUFDN0IsQ0FBQztRQUVELE1BQU0sSUFBSSxHQUFHLE1BQU0sRUFBRSxDQUFDLFFBQVEsRUFBRSxDQUFDLElBQUksQ0FBQyxxQkFBcUIsQ0FBQyxDQUFDLEtBQUssQ0FBQyxFQUFDLEdBQUcsRUFBRSxtQkFBbUIsRUFBQyxDQUFDLENBQUMsS0FBSyxDQUFDLENBQUMsQ0FBQyxDQUFDLE9BQU8sRUFBRSxDQUFBO1FBRWpILElBQUksSUFBSSxDQUFDLE1BQU0sR0FBRyxDQUFDO1lBQUUsT0FBTTtRQUUzQixJQUFJLENBQUM7WUFDSCxNQUFNLEVBQUUsQ0FBQyxNQUFNLENBQUMsRUFBQyxTQUFTLEVBQUUscUJBQXFCLEVBQUUsSUFBSSxFQUFFLEVBQUMsR0FBRyxFQUFFLG1CQUFtQixFQUFFLFFBQVEsRUFBRSxDQUFDLEVBQUMsRUFBQyxDQUFDLENBQUE7UUFDcEcsQ0FBQztRQUFDLE9BQU8sS0FBSyxFQUFFLENBQUM7WUFDZixNQUFNLFNBQVMsR0FBRyxNQUFNLEVBQUUsQ0FBQyxRQUFRLEVBQUUsQ0FBQyxJQUFJLENBQUMscUJBQXFCLENBQUMsQ0FBQyxLQUFLLENBQUMsRUFBQyxHQUFHLEVBQUUsbUJBQW1CLEVBQUMsQ0FBQyxDQUFDLEtBQUssQ0FBQyxDQUFDLENBQUMsQ0FBQyxPQUFPLEVBQUUsQ0FBQTtZQUV0SCxJQUFJLFNBQVMsQ0FBQyxNQUFNLEtBQUssQ0FBQztnQkFBRSxNQUFNLEtBQUssQ0FBQTtRQUN6QyxDQUFDO0lBQ0gsQ0FBQztJQUVEOzs7Ozs7T0FNRztJQUNILEtBQUssQ0FBQyxpQkFBaUIsQ0FBQyxFQUFFLEVBQUUsZUFBZTtRQUN6QyxxQ0FBcUM7UUFDckMsTUFBTSxNQUFNLEdBQUcsRUFBRSxDQUFBO1FBRWpCLEtBQUssTUFBTSxNQUFNLElBQUksNEJBQTRCLEVBQUUsQ0FBQztZQUNsRCxNQUFNLE1BQU0sR0FBRyxlQUFlLENBQUMsTUFBTSxDQUFDLElBQUksQ0FBQyxDQUFBO1lBRTNDLElBQUksQ0FBQyxNQUFNLENBQUMsU0FBUyxDQUFDLE1BQU0sQ0FBQztnQkFBRSxNQUFNLElBQUksS0FBSyxDQUFDLDBDQUEwQyxNQUFNLEtBQUssTUFBTSxFQUFFLENBQUMsQ0FBQTtZQUM3RyxJQUFJLE1BQU0sS0FBSyxDQUFDO2dCQUFFLE1BQU0sQ0FBQyxNQUFNLENBQUMsR0FBRyxNQUFNLENBQUE7UUFDM0MsQ0FBQztRQUVELElBQUksTUFBTSxDQUFDLElBQUksQ0FBQyxNQUFNLENBQUMsQ0FBQyxNQUFNLEtBQUssQ0FBQztZQUFFLE9BQU07UUFFNUMsTUFBTSxLQUFLLEdBQUcsRUFBRSxDQUFDLFVBQVUsQ0FBQyxxQkFBcUIsQ0FBQyxDQUFBO1FBQ2xELE1BQU0sY0FBYyxHQUFHLEVBQUUsQ0FBQyxXQUFXLENBQUMsVUFBVSxDQUFDLENBQUE7UUFDakQsTUFBTSxZQUFZLEdBQUcsTUFBTSxFQUFFLENBQUMsWUFBWSxDQUN4QyxVQUFVLEtBQUssUUFBUSxjQUFjLE1BQU0sY0FBYyxjQUFjLEVBQUUsQ0FBQyxXQUFXLENBQUMsS0FBSyxDQUFDLE1BQU0sRUFBRSxDQUFDLEtBQUssQ0FBQyxtQkFBbUIsQ0FBQyxFQUFFLENBQ2xJLENBQUE7UUFFRCxJQUFJLFlBQVksS0FBSyxDQUFDO1lBQUUsTUFBTSxJQUFJLEtBQUssQ0FBQyw4Q0FBOEMsQ0FBQyxDQUFBO1FBRXZGLE1BQU0sUUFBUSxHQUFHLE1BQU0sSUFBSSxDQUFDLGNBQWMsQ0FBQyxFQUFFLENBQUMsQ0FBQTtRQUM5QyxNQUFNLElBQUksR0FBRyxFQUFDLE1BQU0sRUFBRSxRQUFRLEVBQUUsSUFBSSxFQUFFLDRCQUE0QixFQUFDLENBQUE7UUFDbkUsTUFBTSxrQkFBa0IsR0FBRyxJQUFJLENBQUMscUJBQXFCLEVBQUUsSUFBSSxTQUFTLENBQUE7UUFFcEUsTUFBTSxFQUFFLENBQUMsV0FBVyxDQUFDLEdBQUcsRUFBRTtZQUN4QixJQUFJLENBQUMsYUFBYSxDQUFDLGtCQUFrQixDQUFDLDZCQUE2QixFQUFFLEVBQUMsa0JBQWtCLEVBQUMsRUFBRSxJQUFJLENBQUMsQ0FBQTtRQUNsRyxDQUFDLENBQUMsQ0FBQTtJQUNKLENBQUM7SUFFRDs7Ozs7O09BTUc7SUFDSCxLQUFLLENBQUMsdUJBQXVCLENBQUMsRUFBRSxFQUFFLFNBQVMsRUFBRSxTQUFTO1FBQ3BELE1BQU0sVUFBVSxHQUFHLG9CQUFvQixDQUFDLFFBQVEsQ0FBQyxTQUFTLENBQUMsQ0FBQTtRQUMzRCxNQUFNLFVBQVUsR0FBRyxvQkFBb0IsQ0FBQyxRQUFRLENBQUMsU0FBUyxDQUFDLENBQUE7UUFFM0QsSUFBSSxDQUFDLFVBQVUsSUFBSSxTQUFTLEtBQUssV0FBVztZQUFFLE1BQU0sSUFBSSxLQUFLLENBQUMsMkNBQTJDLFNBQVMsRUFBRSxDQUFDLENBQUE7UUFDckgsSUFBSSxDQUFDLFVBQVUsSUFBSSxTQUFTLEtBQUssV0FBVztZQUFFLE1BQU0sSUFBSSxLQUFLLENBQUMsdUNBQXVDLFNBQVMsRUFBRSxDQUFDLENBQUE7UUFDakgsSUFBSSxTQUFTLEtBQUssU0FBUztZQUFFLE9BQU07UUFFbkMscUNBQXFDO1FBQ3JDLE1BQU0sTUFBTSxHQUFHLEVBQUUsQ0FBQTtRQUVqQixJQUFJLFVBQVU7WUFBRSxNQUFNLENBQUMsU0FBUyxDQUFDLEdBQUcsQ0FBQyxDQUFDLENBQUE7UUFDdEMsSUFBSSxVQUFVO1lBQUUsTUFBTSxDQUFDLFNBQVMsQ0FBQyxHQUFHLENBQUMsQ0FBQTtRQUNyQyxJQUFJLFVBQVUsS0FBSyxVQUFVO1lBQUUsTUFBTSxDQUFDLEdBQUcsR0FBRyxVQUFVLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUE7UUFDL0QsTUFBTSxJQUFJLENBQUMsaUJBQWlCLENBQUMsRUFBRSxFQUFFLE1BQU0sQ0FBQyxDQUFBO0lBQzFDLENBQUM7SUFFRDs7OztPQUlHO0lBQ0gsS0FBSyxDQUFDLGNBQWMsQ0FBQyxFQUFFO1FBQ3JCLE1BQU0sSUFBSSxHQUFHLE1BQU0sRUFBRSxDQUFDLFFBQVEsRUFBRSxDQUFDLElBQUksQ0FBQyxxQkFBcUIsQ0FBQyxDQUFDLE1BQU0sQ0FBQyxVQUFVLENBQUMsQ0FBQyxLQUFLLENBQUMsRUFBQyxHQUFHLEVBQUUsbUJBQW1CLEVBQUMsQ0FBQyxDQUFDLEtBQUssQ0FBQyxDQUFDLENBQUMsQ0FBQyxPQUFPLEVBQUUsQ0FBQTtRQUNwSSxNQUFNLFFBQVEsR0FBRyxJQUFJLENBQUMsZ0JBQWdCLENBQUMsNERBQTRELENBQUMsQ0FBQyxJQUFJLENBQUMsQ0FBQyxDQUFDLElBQUksRUFBRSxDQUFDLENBQUMsUUFBUSxDQUFDLENBQUE7UUFFN0gsSUFBSSxRQUFRLEtBQUssSUFBSSxJQUFJLENBQUMsTUFBTSxDQUFDLGFBQWEsQ0FBQyxRQUFRLENBQUMsSUFBSSxRQUFRLEdBQUcsQ0FBQyxFQUFFLENBQUM7WUFDekUsTUFBTSxJQUFJLEtBQUssQ0FBQywwQ0FBMEMsUUFBUSxFQUFFLENBQUMsQ0FBQTtRQUN2RSxDQUFDO1FBRUQsT0FBTyxRQUFRLENBQUE7SUFDakIsQ0FBQztJQUVEOzs7O09BSUc7SUFDSCxLQUFLLENBQUMsa0JBQWtCLENBQUMsRUFBRTtRQUN6QixNQUFNLEtBQUssR0FBRyxFQUFFLENBQUMsVUFBVSxDQUFDLHFCQUFxQixDQUFDLENBQUE7UUFDbEQsTUFBTSxRQUFRLEdBQUcsRUFBRSxDQUFDLFdBQVcsQ0FBQyxVQUFVLENBQUMsQ0FBQTtRQUUzQyxNQUFNLEVBQUUsQ0FBQyxLQUFLLENBQUMsVUFBVSxLQUFLLFFBQVEsUUFBUSxNQUFNLFFBQVEsVUFBVSxFQUFFLENBQUMsV0FBVyxDQUFDLEtBQUssQ0FBQyxNQUFNLEVBQUUsQ0FBQyxLQUFLLENBQUMsbUJBQW1CLENBQUMsRUFBRSxDQUFDLENBQUE7SUFDbkksQ0FBQztJQUVEOzs7T0FHRztJQUNILGtCQUFrQjtRQUNoQixPQUFPLE1BQU0sQ0FBQyxXQUFXLENBQUMsNEJBQTRCLENBQUMsR0FBRyxDQUFDLENBQUMsTUFBTSxFQUFFLEVBQUUsQ0FBQyxDQUFDLE1BQU0sRUFBRSxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUE7SUFDdEYsQ0FBQztJQUVEOzs7O09BSUc7SUFDSCxhQUFhLENBQUMsSUFBSTtRQUNoQixxQ0FBcUM7UUFDckMsTUFBTSxNQUFNLEdBQUcsRUFBRSxDQUFBO1FBRWpCLEtBQUssTUFBTSxHQUFHLElBQUksSUFBSSxFQUFFLENBQUM7WUFDdkIsSUFBSSxDQUFDLG9CQUFvQixDQUFDLFFBQVEsQ0FBQyxHQUFHLENBQUMsTUFBTSxDQUFDO2dCQUFFLE1BQU0sSUFBSSxLQUFLLENBQUMsa0NBQWtDLEdBQUcsQ0FBQyxNQUFNLEVBQUUsQ0FBQyxDQUFBO1lBQy9HLE1BQU0sQ0FBQyxHQUFHLENBQUMsTUFBTSxDQUFDLEdBQUcsQ0FBQyxNQUFNLENBQUMsR0FBRyxDQUFDLE1BQU0sQ0FBQyxJQUFJLENBQUMsQ0FBQyxHQUFHLENBQUMsQ0FBQTtRQUNwRCxDQUFDO1FBRUQsT0FBTyxNQUFNLENBQUE7SUFDZixDQUFDO0lBRUQ7Ozs7T0FJRztJQUNILEtBQUssQ0FBQyxnQ0FBZ0MsQ0FBQyxFQUFFO1FBQ3ZDLE1BQU0sSUFBSSxHQUFHLE1BQU0sRUFBRSxDQUFDLFFBQVEsRUFBRSxDQUFDLElBQUksQ0FBQyxVQUFVLENBQUMsQ0FBQyxNQUFNLENBQUMsUUFBUSxDQUFDLENBQUMsTUFBTSxDQUFDLG1CQUFtQixDQUFDLENBQUMsS0FBSyxDQUFDLFFBQVEsQ0FBQyxDQUFDLE9BQU8sRUFBRSxDQUFBO1FBQ3hILE1BQU0sTUFBTSxHQUFHLElBQUksQ0FBQyxrQkFBa0IsRUFBRSxDQUFBO1FBQ3hDLElBQUksS0FBSyxHQUFHLENBQUMsQ0FBQTtRQUViLEtBQUssTUFBTSxHQUFHLElBQUksSUFBSSxFQUFFLENBQUM7WUFDdkIsTUFBTSxRQUFRLEdBQUcsNERBQTRELENBQUMsQ0FBQyxHQUFHLENBQUMsQ0FBQTtZQUNuRixNQUFNLE1BQU0sR0FBRyxNQUFNLENBQUMsUUFBUSxDQUFDLE1BQU0sQ0FBQyxDQUFBO1lBQ3RDLE1BQU0sS0FBSyxHQUFHLElBQUksQ0FBQyxnQkFBZ0IsQ0FBQyxRQUFRLENBQUMsS0FBSyxDQUFDLElBQUksQ0FBQyxDQUFBO1lBRXhELEtBQUssSUFBSSxLQUFLLENBQUE7WUFFZCxJQUFJLENBQUMsb0JBQW9CLENBQUMsUUFBUSxDQUFDLE1BQU0sQ0FBQztnQkFBRSxTQUFRO1lBQ3BELE1BQU0sQ0FBQyxNQUFNLENBQUMsR0FBRyxLQUFLLENBQUE7WUFDdEIsTUFBTSxDQUFDLEdBQUcsSUFBSSxNQUFNLENBQUMsTUFBTSxDQUFDLENBQUE7UUFDOUIsQ0FBQztRQUVELE9BQU8sRUFBQyxNQUFNLEVBQUUsUUFBUSxFQUFFLE1BQU0sSUFBSSxDQUFDLGNBQWMsQ0FBQyxFQUFFLENBQUMsRUFBRSxLQUFLLEVBQUMsQ0FBQTtJQUNqRSxDQUFDO0lBRUQ7Ozs7Ozs7T0FPRztJQUNILEtBQUssQ0FBQyxxQkFBcUIsQ0FBQyxFQUFFLEVBQUUsRUFBQyxjQUFjLEVBQUUsY0FBYyxFQUFDO1FBQzlELE1BQU0sSUFBSSxHQUFHLE1BQU0sRUFBRSxDQUFDLFFBQVEsRUFBRSxDQUFDLElBQUksQ0FBQyxpQkFBaUIsQ0FBQyxDQUFDLEtBQUssQ0FBQyxFQUFDLGVBQWUsRUFBRSxjQUFjLEVBQUMsQ0FBQyxDQUFDLEtBQUssQ0FBQyxDQUFDLENBQUMsQ0FBQyxPQUFPLEVBQUUsQ0FBQTtRQUNwSCxJQUFJLENBQUMsSUFBSSxDQUFDLENBQUMsQ0FBQyxFQUFFLENBQUM7WUFDYixJQUFJLENBQUM7Z0JBQ0gsTUFBTSxFQUFFLENBQUMsTUFBTSxDQUFDLEVBQUMsU0FBUyxFQUFFLGlCQUFpQixFQUFFLElBQUksRUFBRSxFQUFDLFlBQVksRUFBRSxDQUFDLEVBQUUsZUFBZSxFQUFFLGNBQWMsRUFBRSxlQUFlLEVBQUUsY0FBYyxFQUFDLEVBQUMsQ0FBQyxDQUFBO2dCQUMxSSxPQUFNO1lBQ1IsQ0FBQztZQUFDLE9BQU8sS0FBSyxFQUFFLENBQUM7Z0JBQ2YsTUFBTSxTQUFTLEdBQUcsTUFBTSxFQUFFLENBQUMsUUFBUSxFQUFFLENBQUMsSUFBSSxDQUFDLGlCQUFpQixDQUFDLENBQUMsS0FBSyxDQUFDLEVBQUMsZUFBZSxFQUFFLGNBQWMsRUFBQyxDQUFDLENBQUMsS0FBSyxDQUFDLENBQUMsQ0FBQyxDQUFDLE9BQU8sRUFBRSxDQUFBO2dCQUN6SCxJQUFJLENBQUMsU0FBUyxDQUFDLENBQUMsQ0FBQztvQkFBRSxNQUFNLEtBQUssQ0FBQTtnQkFDOUIsSUFBSSxDQUFDLENBQUMsQ0FBQyxHQUFHLFNBQVMsQ0FBQyxDQUFDLENBQUMsQ0FBQTtZQUN4QixDQUFDO1FBQ0gsQ0FBQztRQUNELE1BQU0sVUFBVSxHQUFHLGtEQUFrRCxDQUFDLENBQUMsSUFBSSxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUE7UUFDL0UsSUFBSSxJQUFJLENBQUMsZ0JBQWdCLENBQUMsVUFBVSxDQUFDLGVBQWUsQ0FBQyxLQUFLLGNBQWM7WUFBRSxNQUFNLElBQUksS0FBSyxDQUFDLGlFQUFpRSxjQUFjLEVBQUUsQ0FBQyxDQUFBO0lBQzlLLENBQUM7SUFFRDs7Ozs7Ozs7Ozs7Ozs7T0FjRztJQUNILEtBQUssQ0FBQyxtQkFBbUIsQ0FBQyxFQUFFLEVBQUUsY0FBYztRQUMxQyxJQUFJLENBQUMsY0FBYztZQUFFLE9BQU07UUFDM0IsTUFBTSxLQUFLLEdBQUcsRUFBRSxDQUFDLFVBQVUsQ0FBQyxpQkFBaUIsQ0FBQyxDQUFBO1FBQzlDLE1BQU0sS0FBSyxHQUFHLEVBQUUsQ0FBQyxXQUFXLENBQUMsY0FBYyxDQUFDLENBQUE7UUFDNUMsTUFBTSxFQUFFLENBQUMsS0FBSyxDQUFDLFVBQVUsS0FBSyxRQUFRLEtBQUssTUFBTSxLQUFLLFVBQVUsRUFBRSxDQUFDLFdBQVcsQ0FBQyxpQkFBaUIsQ0FBQyxNQUFNLEVBQUUsQ0FBQyxLQUFLLENBQUMsY0FBYyxDQUFDLEVBQUUsQ0FBQyxDQUFBO0lBQ3BJLENBQUM7SUFFRDs7Ozs7T0FLRztJQUNILEtBQUssQ0FBQyxtQkFBbUIsQ0FBQyxFQUFFLEVBQUUsY0FBYztRQUMxQyxNQUFNLEtBQUssR0FBRyxFQUFFLENBQUMsVUFBVSxDQUFDLGlCQUFpQixDQUFDLENBQUE7UUFDOUMsTUFBTSxLQUFLLEdBQUcsRUFBRSxDQUFDLFdBQVcsQ0FBQyxjQUFjLENBQUMsQ0FBQTtRQUM1QyxNQUFNLFlBQVksR0FBRyxNQUFNLEVBQUUsQ0FBQyxZQUFZLENBQUMsVUFBVSxLQUFLLFFBQVEsS0FBSyxNQUFNLEtBQUssY0FBYyxFQUFFLENBQUMsV0FBVyxDQUFDLGlCQUFpQixDQUFDLE1BQU0sRUFBRSxDQUFDLEtBQUssQ0FBQyxjQUFjLENBQUMsUUFBUSxLQUFLLE1BQU0sRUFBRSxDQUFDLFdBQVcsQ0FBQyxpQkFBaUIsQ0FBQyxFQUFFLENBQUMsQ0FBQTtRQUN0TixPQUFPLFlBQVksS0FBSyxDQUFDLENBQUE7SUFDM0IsQ0FBQztJQUVEOzs7OztPQUtHO0lBQ0gsS0FBSyxDQUFDLG1CQUFtQixDQUFDLEVBQUUsRUFBRSxJQUFJO1FBQ2hDLE9BQU8sTUFBTSxFQUFFLENBQUMsWUFBWSxDQUFDLEVBQUUsQ0FBQyxTQUFTLENBQUMsSUFBSSxDQUFDLENBQUMsQ0FBQTtJQUNsRCxDQUFDO0lBRUQ7Ozs7O09BS0c7SUFDSCxLQUFLLENBQUMsbUJBQW1CLENBQUMsRUFBRSxFQUFFLGNBQWM7UUFDMUMsSUFBSSxDQUFDLGNBQWM7WUFBRSxPQUFNO1FBQzNCLE1BQU0sS0FBSyxHQUFHLEVBQUUsQ0FBQyxVQUFVLENBQUMsaUJBQWlCLENBQUMsQ0FBQTtRQUM5QyxNQUFNLEtBQUssR0FBRyxFQUFFLENBQUMsV0FBVyxDQUFDLGNBQWMsQ0FBQyxDQUFBO1FBQzVDLE1BQU0sRUFBRSxDQUFDLEtBQUssQ0FBQyxVQUFVLEtBQUssUUFBUSxLQUFLLE1BQU0sS0FBSyxjQUFjLEVBQUUsQ0FBQyxXQUFXLENBQUMsaUJBQWlCLENBQUMsTUFBTSxFQUFFLENBQUMsS0FBSyxDQUFDLGNBQWMsQ0FBQyxRQUFRLEtBQUssTUFBTSxDQUFDLENBQUE7SUFDekosQ0FBQztJQUVEOzs7OztPQUtHO0lBQ0gsS0FBSyxDQUFDLHFCQUFxQixDQUFDLEVBQUUsRUFBRSxFQUFDLGlCQUFpQixHQUFHLEtBQUssRUFBQyxHQUFHLEVBQUU7UUFDOUQsSUFBSSxDQUFDLENBQUMsTUFBTSxFQUFFLENBQUMsV0FBVyxDQUFDLGlCQUFpQixDQUFDLENBQUMsRUFBRSxDQUFDO1lBQy9DLE9BQU8sRUFBQyxjQUFjLEVBQUUsQ0FBQyxFQUFFLFlBQVksRUFBRSxDQUFDLEVBQUUsYUFBYSxFQUFFLENBQUMsRUFBRSxPQUFPLEVBQUUsRUFBRSxFQUFFLHFCQUFxQixFQUFFLENBQUMsRUFBQyxDQUFBO1FBQ3RHLENBQUM7UUFFRCxNQUFNLFVBQVUsR0FBRyxNQUFNLEVBQUU7YUFDeEIsUUFBUSxFQUFFO2FBQ1YsSUFBSSxDQUFDLFVBQVUsQ0FBQzthQUNoQixNQUFNLENBQUMsaUJBQWlCLENBQUM7YUFDekIsTUFBTSxDQUFDLDBCQUEwQixDQUFDO2FBQ2xDLEtBQUssQ0FBQyxFQUFDLE1BQU0sRUFBRSxZQUFZLEVBQUMsQ0FBQzthQUM3QixLQUFLLENBQUMsR0FBRyxFQUFFLENBQUMsV0FBVyxDQUFDLGlCQUFpQixDQUFDLGNBQWMsQ0FBQzthQUN6RCxLQUFLLENBQUMsaUJBQWlCLENBQUM7YUFDeEIsT0FBTyxFQUFFLENBQUE7UUFDWixNQUFNLFNBQVMsR0FBRyxNQUFNLEVBQUU7YUFDdkIsUUFBUSxFQUFFO2FBQ1YsSUFBSSxDQUFDLGlCQUFpQixDQUFDO2FBQ3ZCLE1BQU0sQ0FBQyxpQkFBaUIsQ0FBQzthQUN6QixNQUFNLENBQUMsY0FBYyxDQUFDO2FBQ3RCLEtBQUssQ0FBQyxHQUFHLEVBQUUsQ0FBQyxXQUFXLENBQUMsY0FBYyxDQUFDLE9BQU8sQ0FBQzthQUMvQyxPQUFPLEVBQUUsQ0FBQTtRQUNaLGtDQUFrQztRQUNsQyxNQUFNLFlBQVksR0FBRyxJQUFJLEdBQUcsRUFBRSxDQUFBO1FBQzlCLGtDQUFrQztRQUNsQyxNQUFNLGVBQWUsR0FBRyxJQUFJLEdBQUcsRUFBRSxDQUFBO1FBRWpDLEtBQUssTUFBTSxNQUFNLElBQUksVUFBVSxFQUFFLENBQUM7WUFDaEMsTUFBTSxHQUFHLEdBQUcsK0NBQStDLENBQUMsQ0FBQyxNQUFNLENBQUMsQ0FBQTtZQUNwRSxZQUFZLENBQUMsR0FBRyxDQUFDLEdBQUcsQ0FBQyxlQUFlLEVBQUUsSUFBSSxDQUFDLDBCQUEwQixDQUFDLEdBQUcsQ0FBQyxZQUFZLEVBQUUsR0FBRyxDQUFDLGVBQWUsQ0FBQyxDQUFDLENBQUE7UUFDL0csQ0FBQztRQUVELEtBQUssTUFBTSxNQUFNLElBQUksU0FBUyxFQUFFLENBQUM7WUFDL0IsTUFBTSxHQUFHLEdBQUcsK0NBQStDLENBQUMsQ0FBQyxNQUFNLENBQUMsQ0FBQTtZQUNwRSxlQUFlLENBQUMsR0FBRyxDQUFDLEdBQUcsQ0FBQyxlQUFlLEVBQUUsSUFBSSxDQUFDLDBCQUEwQixDQUFDLEdBQUcsQ0FBQyxZQUFZLEVBQUUsR0FBRyxDQUFDLGVBQWUsQ0FBQyxDQUFDLENBQUE7UUFDbEgsQ0FBQztRQUVELE1BQU0sZUFBZSxHQUFHLENBQUMsR0FBRyxJQUFJLEdBQUcsQ0FBQyxDQUFDLEdBQUcsWUFBWSxDQUFDLElBQUksRUFBRSxFQUFFLEdBQUcsZUFBZSxDQUFDLElBQUksRUFBRSxDQUFDLENBQUMsQ0FBQyxDQUFDLElBQUksRUFBRSxDQUFBO1FBQ2hHLE1BQU0sYUFBYSxHQUFHLGVBQWUsQ0FBQyxNQUFNLENBQUMsQ0FBQyxjQUFjLEVBQUUsRUFBRTtZQUM5RCxPQUFPLENBQUMsWUFBWSxDQUFDLEdBQUcsQ0FBQyxjQUFjLENBQUMsSUFBSSxDQUFDLENBQUMsS0FBSyxDQUFDLGVBQWUsQ0FBQyxHQUFHLENBQUMsY0FBYyxDQUFDLElBQUksQ0FBQyxDQUFDLENBQUE7UUFDL0YsQ0FBQyxDQUFDLENBQUE7UUFDRixvRUFBb0U7UUFDcEUsTUFBTSxPQUFPLEdBQUcsRUFBRSxDQUFBO1FBQ2xCLElBQUksYUFBYSxHQUFHLENBQUMsQ0FBQTtRQUVyQixLQUFLLE1BQU0sY0FBYyxJQUFJLGFBQWEsRUFBRSxDQUFDO1lBQzNDLE1BQU0sTUFBTSxHQUFHLGlCQUFpQjtnQkFDOUIsQ0FBQyxDQUFDLE1BQU0sSUFBSSxDQUFDLHdCQUF3QixDQUFDLEVBQUUsRUFBRSxjQUFjLENBQUM7Z0JBQ3pELENBQUMsQ0FBQyxNQUFNLElBQUksQ0FBQyxrQkFBa0IsQ0FBQyxFQUFFLEVBQUUsS0FBSyxJQUFJLEVBQUUsQ0FBQyxNQUFNLElBQUksQ0FBQyx3QkFBd0IsQ0FBQyxFQUFFLEVBQUUsY0FBYyxDQUFDLENBQUMsQ0FBQTtZQUUxRyxJQUFJLENBQUMsTUFBTTtnQkFBRSxTQUFRO1lBRXJCLGFBQWEsRUFBRSxDQUFBO1lBQ2YsSUFBSSxPQUFPLENBQUMsTUFBTSxHQUFHLCtCQUErQjtnQkFBRSxPQUFPLENBQUMsSUFBSSxDQUFDLE1BQU0sQ0FBQyxDQUFBO1FBQzVFLENBQUM7UUFFRCxPQUFPO1lBQ0wsY0FBYyxFQUFFLGFBQWEsQ0FBQyxNQUFNO1lBQ3BDLFlBQVksRUFBRSxlQUFlLENBQUMsTUFBTTtZQUNwQyxhQUFhO1lBQ2IsT0FBTztZQUNQLHFCQUFxQixFQUFFLGFBQWEsR0FBRyxPQUFPLENBQUMsTUFBTTtTQUN0RCxDQUFBO0lBQ0gsQ0FBQztJQUVEOzs7Ozs7T0FNRztJQUNILEtBQUssQ0FBQyx3QkFBd0IsQ0FBQyxFQUFFLEVBQUUsY0FBYztRQUMvQyxNQUFNLElBQUksQ0FBQyxtQkFBbUIsQ0FBQyxFQUFFLEVBQUUsY0FBYyxDQUFDLENBQUE7UUFDbEQsTUFBTSxhQUFhLEdBQUcsTUFBTSxFQUFFO2FBQzNCLFFBQVEsRUFBRTthQUNWLElBQUksQ0FBQyxpQkFBaUIsQ0FBQzthQUN2QixNQUFNLENBQUMsY0FBYyxDQUFDO2FBQ3RCLE1BQU0sQ0FBQyxpQkFBaUIsQ0FBQzthQUN6QixLQUFLLENBQUMsRUFBQyxlQUFlLEVBQUUsY0FBYyxFQUFDLENBQUM7YUFDeEMsS0FBSyxDQUFDLENBQUMsQ0FBQzthQUNSLE9BQU8sRUFBRSxDQUFBO1FBRVosSUFBSSxDQUFDLGFBQWEsQ0FBQyxDQUFDLENBQUM7WUFBRSxNQUFNLElBQUksS0FBSyxDQUFDLGtEQUFrRCxjQUFjLEVBQUUsQ0FBQyxDQUFBO1FBRTFHLE1BQU0sWUFBWSxHQUFHLCtDQUErQyxDQUFDLENBQUMsYUFBYSxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUE7UUFDdkYsTUFBTSxtQkFBbUIsR0FBRyxJQUFJLENBQUMsMEJBQTBCLENBQUMsWUFBWSxDQUFDLFlBQVksRUFBRSxjQUFjLENBQUMsQ0FBQTtRQUN0RyxNQUFNLElBQUksR0FBRyxNQUFNLEVBQUU7YUFDbEIsUUFBUSxFQUFFO2FBQ1YsSUFBSSxDQUFDLFVBQVUsQ0FBQzthQUNoQixNQUFNLENBQUMsMEJBQTBCLENBQUM7YUFDbEMsS0FBSyxDQUFDLEVBQUMsZUFBZSxFQUFFLGNBQWMsRUFBRSxNQUFNLEVBQUUsWUFBWSxFQUFDLENBQUM7YUFDOUQsT0FBTyxFQUFFLENBQUE7UUFDWixNQUFNLFFBQVEsR0FBRyw4Q0FBOEMsQ0FBQyxDQUFDLElBQUksQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFBO1FBQ3pFLE1BQU0sV0FBVyxHQUFHLElBQUksQ0FBQywwQkFBMEIsQ0FBQyxRQUFRLENBQUMsWUFBWSxFQUFFLGNBQWMsQ0FBQyxDQUFBO1FBRTFGLElBQUksV0FBVyxLQUFLLG1CQUFtQjtZQUFFLE9BQU8sSUFBSSxDQUFBO1FBRXBELE1BQU0sRUFBRSxDQUFDLE1BQU0sQ0FBQztZQUNkLFNBQVMsRUFBRSxpQkFBaUI7WUFDNUIsSUFBSSxFQUFFLEVBQUMsWUFBWSxFQUFFLFdBQVcsRUFBQztZQUNqQyxVQUFVLEVBQUUsRUFBQyxlQUFlLEVBQUUsY0FBYyxFQUFDO1NBQzlDLENBQUMsQ0FBQTtRQUVGLE9BQU8sRUFBQyxXQUFXLEVBQUUsY0FBYyxFQUFFLG1CQUFtQixFQUFDLENBQUE7SUFDM0QsQ0FBQztJQUVEOzs7OztPQUtHO0lBQ0gsMEJBQTBCLENBQUMsS0FBSyxFQUFFLGNBQWM7UUFDOUMsTUFBTSxLQUFLLEdBQUcsSUFBSSxDQUFDLGdCQUFnQixDQUFDLEtBQUssQ0FBQyxDQUFBO1FBRTFDLElBQUksS0FBSyxLQUFLLElBQUksSUFBSSxDQUFDLE1BQU0sQ0FBQyxhQUFhLENBQUMsS0FBSyxDQUFDLElBQUksS0FBSyxHQUFHLENBQUMsRUFBRSxDQUFDO1lBQ2hFLE1BQU0sSUFBSSxLQUFLLENBQUMsMkRBQTJELGNBQWMsS0FBSyxLQUFLLEVBQUUsQ0FBQyxDQUFBO1FBQ3hHLENBQUM7UUFFRCxPQUFPLEtBQUssQ0FBQTtJQUNkLENBQUM7SUFFRDs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7T0FvQkc7SUFDSCxLQUFLLENBQUMsMEJBQTBCLENBQUMsRUFBRTtRQUNqQyxJQUFJLElBQUksQ0FBQywyQkFBMkI7WUFBRSxPQUFNO1FBQzVDLElBQUksQ0FBQyxDQUFDLE1BQU0sRUFBRSxDQUFDLFdBQVcsQ0FBQyxpQkFBaUIsQ0FBQyxDQUFDO1lBQUUsT0FBTTtRQUV0RCxNQUFNLFlBQVksR0FBRyxJQUFJLENBQUMsYUFBYSxDQUFDLHVCQUF1QixFQUFFLENBQUMsTUFBTSxJQUFJLEVBQUUsQ0FBQTtRQUM5RSxNQUFNLFNBQVMsR0FBRyxFQUFFLENBQUMsVUFBVSxDQUFDLFVBQVUsQ0FBQyxDQUFBO1FBQzNDLE1BQU0sU0FBUyxHQUFHLEVBQUUsQ0FBQyxXQUFXLENBQUMsaUJBQWlCLENBQUMsQ0FBQTtRQUNuRCxNQUFNLFNBQVMsR0FBRyxFQUFFLENBQUMsV0FBVyxDQUFDLGlCQUFpQixDQUFDLENBQUE7UUFDbkQsTUFBTSxXQUFXLEdBQUcsRUFBRSxDQUFDLFdBQVcsQ0FBQyxPQUFPLENBQUMsQ0FBQTtRQUMzQyxNQUFNLE1BQU0sR0FBRyxHQUFHLEVBQUUsQ0FBQyxXQUFXLENBQUMsUUFBUSxDQUFDLE1BQU0sRUFBRSxDQUFDLEtBQUssQ0FBQyxRQUFRLENBQUMsRUFBRSxDQUFBO1FBQ3BFLDBCQUEwQjtRQUMxQixNQUFNLFlBQVksR0FBRyxJQUFJLEdBQUcsRUFBRSxDQUFBO1FBRTlCLEtBQUssTUFBTSxLQUFLLElBQUksTUFBTSxDQUFDLElBQUksQ0FBQyxZQUFZLENBQUMsRUFBRSxDQUFDO1lBQzlDLE1BQU0sR0FBRyxHQUFHLElBQUksQ0FBQyxvQkFBb0IsQ0FBQyxLQUFLLENBQUMsQ0FBQTtZQUU1QyxJQUFJLEdBQUcsS0FBSyxJQUFJO2dCQUFFLFNBQVE7WUFFMUIsWUFBWSxDQUFDLEdBQUcsQ0FBQyxLQUFLLENBQUMsQ0FBQTtZQUN2QixNQUFNLGNBQWMsR0FBRyxHQUFHLDRCQUE0QixHQUFHLEtBQUssRUFBRSxDQUFBO1lBRWhFLE1BQU0sSUFBSSxDQUFDLDBCQUEwQixDQUFDLEVBQUUsRUFBRSxFQUFDLGNBQWMsRUFBRSxjQUFjLEVBQUUsR0FBRyxFQUFDLENBQUMsQ0FBQTtZQUNoRixNQUFNLEVBQUUsQ0FBQyxLQUFLLENBQ1osVUFBVSxTQUFTLFFBQVEsU0FBUyxNQUFNLEVBQUUsQ0FBQyxLQUFLLENBQUMsY0FBYyxDQUFDLEtBQUssU0FBUyxNQUFNLE1BQU0sQ0FBQyxHQUFHLENBQUMsR0FBRztnQkFDcEcsU0FBUyxXQUFXLE1BQU0sRUFBRSxDQUFDLEtBQUssQ0FBQyxLQUFLLENBQUMsUUFBUSxTQUFTLGdCQUFnQixNQUFNLEVBQUUsQ0FDbkYsQ0FBQTtRQUNILENBQUM7UUFFRCxNQUFNLGVBQWUsR0FBRyxNQUFNLEVBQUU7YUFDN0IsUUFBUSxFQUFFO2FBQ1YsSUFBSSxDQUFDLGlCQUFpQixDQUFDO2FBQ3ZCLE1BQU0sQ0FBQyxpQkFBaUIsQ0FBQzthQUN6QixLQUFLLENBQUMsR0FBRyxFQUFFLENBQUMsV0FBVyxDQUFDLGlCQUFpQixDQUFDLFNBQVMsRUFBRSxDQUFDLEtBQUssQ0FBQyxHQUFHLDRCQUE0QixHQUFHLENBQUMsRUFBRSxDQUFDO2FBQ2xHLE9BQU8sRUFBRSxDQUFBO1FBRVosS0FBSyxNQUFNLEdBQUcsSUFBSSxlQUFlLEVBQUUsQ0FBQztZQUNsQyxNQUFNLGNBQWMsR0FBRyxNQUFNLENBQUMsNERBQTRELENBQUMsQ0FBQyxHQUFHLENBQUMsQ0FBQyxlQUFlLENBQUMsQ0FBQTtZQUVqSCxJQUFJLENBQUMsY0FBYyxDQUFDLFVBQVUsQ0FBQyw0QkFBNEIsQ0FBQztnQkFBRSxTQUFRO1lBQ3RFLElBQUksWUFBWSxDQUFDLEdBQUcsQ0FBQyxjQUFjLENBQUMsS0FBSyxDQUFDLDRCQUE0QixDQUFDLE1BQU0sQ0FBQyxDQUFDO2dCQUFFLFNBQVE7WUFFekYsTUFBTSxFQUFFLENBQUMsS0FBSyxDQUNaLFVBQVUsU0FBUyxRQUFRLFNBQVMsWUFBWSxTQUFTLFVBQVU7Z0JBQ25FLFNBQVMsU0FBUyxNQUFNLEVBQUUsQ0FBQyxLQUFLLENBQUMsY0FBYyxDQUFDLFFBQVEsTUFBTSxFQUFFLENBQ2pFLENBQUE7UUFDSCxDQUFDO0lBQ0gsQ0FBQztJQUVEOzs7O09BSUc7SUFDSCxnQkFBZ0IsQ0FBQyxLQUFLO1FBQ3BCLElBQUksS0FBSyxLQUFLLElBQUksSUFBSSxLQUFLLEtBQUssU0FBUyxJQUFJLEtBQUssS0FBSyxFQUFFO1lBQUUsT0FBTyxJQUFJLENBQUE7UUFFdEUsTUFBTSxPQUFPLEdBQUcsTUFBTSxDQUFDLEtBQUssQ0FBQyxDQUFBO1FBRTdCLElBQUksTUFBTSxDQUFDLEtBQUssQ0FBQyxPQUFPLENBQUM7WUFBRSxPQUFPLElBQUksQ0FBQTtRQUV0QyxPQUFPLE9BQU8sQ0FBQTtJQUNoQixDQUFDO0lBRUQ7Ozs7T0FJRztJQUNILHVCQUF1QixDQUFDLE9BQU87UUFDN0IsT0FBTyxtQ0FBbUMsQ0FBQyxPQUFPLElBQUksRUFBRSxFQUFFLHFDQUFxQyxDQUFDLENBQUE7SUFDbEcsQ0FBQztJQUVEOzs7O09BSUc7SUFDSCwyQkFBMkIsQ0FBQyxhQUFhO1FBQ3ZDLE9BQU8sbUNBQW1DLENBQ3hDLEVBQUMsYUFBYSxFQUFFLDhEQUE4RCxDQUFDLENBQUMsYUFBYSxDQUFDLEVBQUMsRUFDL0YscUNBQXFDLEVBQ3JDLDhCQUE4QixDQUMvQixDQUFBO0lBQ0gsQ0FBQztJQUVEOzs7Ozs7OztPQVFHO0lBQ0gsbUJBQW1CLENBQUMsRUFBQyxFQUFFLEVBQUUsYUFBYSxFQUFFLEtBQUssRUFBQztRQUM1QyxNQUFNLGNBQWMsR0FBRyxLQUFLLENBQUMsT0FBTyxDQUFDLGFBQWEsQ0FBQyxDQUFDLENBQUMsQ0FBQyxhQUFhLENBQUMsQ0FBQyxDQUFDLENBQUMsYUFBYSxDQUFDLENBQUE7UUFDckYsTUFBTSxtQkFBbUIsR0FBRyxFQUFFLENBQUMsV0FBVyxDQUFDLGdCQUFnQixDQUFDLENBQUE7UUFDNUQsTUFBTSxVQUFVLEdBQUcsY0FBYyxDQUFDLEdBQUcsQ0FBQyxDQUFDLElBQUksRUFBRSxFQUFFLENBQUMsR0FBRyxtQkFBbUIsTUFBTSxFQUFFLENBQUMsS0FBSyxDQUFDLElBQUksQ0FBQyxFQUFFLENBQUMsQ0FBQTtRQUU3RixPQUFPLEtBQUssQ0FBQyxLQUFLLENBQUMsSUFBSSxVQUFVLENBQUMsSUFBSSxDQUFDLE1BQU0sQ0FBQyxHQUFHLENBQUMsQ0FBQTtJQUNwRCxDQUFDO0lBRUQ7Ozs7T0FJRztJQUNILFVBQVUsQ0FBQyxLQUFLO1FBQ2QsSUFBSSxDQUFDLEtBQUs7WUFBRSxPQUFPLEVBQUUsQ0FBQTtRQUVyQixJQUFJLENBQUM7WUFDSCxNQUFNLE1BQU0sR0FBRyxJQUFJLENBQUMsS0FBSyxDQUFDLE1BQU0sQ0FBQyxLQUFLLENBQUMsQ0FBQyxDQUFBO1lBRXhDLElBQUksS0FBSyxDQUFDLE9BQU8sQ0FBQyxNQUFNLENBQUM7Z0JBQUUsT0FBTyxNQUFNLENBQUE7UUFDMUMsQ0FBQztRQUFDLE1BQU0sQ0FBQztZQUNQLHVCQUF1QjtRQUN6QixDQUFDO1FBRUQsT0FBTyxFQUFFLENBQUE7SUFDWCxDQUFDO0lBRUQ7Ozs7O09BS0c7SUFDSCxLQUFLLENBQUMsT0FBTyxDQUFDLFFBQVE7UUFDcEIsTUFBTSxrQkFBa0IsR0FBRyxJQUFJLENBQUMscUJBQXFCLEVBQUUsQ0FBQTtRQUN2RCxNQUFNLElBQUksR0FBRyxJQUFJLENBQUMsYUFBYSxDQUFDLGVBQWUsQ0FBQyxrQkFBa0IsQ0FBQyxDQUFBO1FBRW5FLElBQUksQ0FBQyxJQUFJLENBQUMsb0JBQW9CLEVBQUUsRUFBRSxDQUFDO1lBQ2pDLE9BQU8sTUFBTSxJQUFJLENBQUMsY0FBYyxDQUFDLEVBQUMsSUFBSSxFQUFFLHVCQUF1QixFQUFDLEVBQUUsUUFBUSxDQUFDLENBQUE7UUFDN0UsQ0FBQztRQUVELE9BQU8sTUFBTSxJQUFJLENBQUMsYUFBYSxDQUFDLG1DQUFtQyxDQUFDLEtBQUssSUFBSSxFQUFFO1lBQzdFLE9BQU8sTUFBTSxJQUFJLENBQUMsYUFBYSxDQUFDLGlCQUFpQixDQUFDLEVBQUMsbUJBQW1CLEVBQUUsQ0FBQyxrQkFBa0IsQ0FBQyxFQUFFLElBQUksRUFBRSx1QkFBdUIsRUFBQyxFQUFFLEtBQUssRUFBRSxHQUFHLEVBQUUsRUFBRTtnQkFDMUksTUFBTSxVQUFVLEdBQUcsR0FBRyxDQUFDLGtCQUFrQixDQUFDLENBQUE7Z0JBQzFDLE9BQU8sTUFBTSxxQ0FBcUMsQ0FBQyxVQUFVLEVBQUUsS0FBSyxJQUFJLEVBQUUsQ0FBQyxNQUFNLFFBQVEsQ0FBQyxVQUFVLENBQUMsQ0FBQyxDQUFBO1lBQ3hHLENBQUMsQ0FBQyxDQUFBO1FBQ0osQ0FBQyxDQUFDLENBQUE7SUFDSixDQUFDO0lBRUQ7Ozs7OztPQU1HO0lBQ0gsS0FBSyxDQUFDLGtCQUFrQixDQUFDLEVBQUUsRUFBRSxRQUFRO1FBQ25DLElBQUksU0FBUyxHQUFHLEtBQUssQ0FBQTtRQUNyQiw0QkFBNEI7UUFDNUIsSUFBSSxNQUFNLENBQUE7UUFDVixNQUFNLEVBQUUsQ0FBQyxXQUFXLENBQUMsS0FBSyxJQUFJLEVBQUU7WUFDOUIsTUFBTSxHQUFHLE1BQU0sUUFBUSxFQUFFLENBQUE7WUFDekIsU0FBUyxHQUFHLElBQUksQ0FBQTtRQUNsQixDQUFDLENBQUMsQ0FBQTtRQUNGLElBQUksQ0FBQyxTQUFTO1lBQUUsTUFBTSxJQUFJLEtBQUssQ0FBQyxzREFBc0QsQ0FBQyxDQUFBO1FBQ3ZGLE9BQU8sZ0JBQWdCLENBQUMsQ0FBQyxNQUFNLENBQUMsQ0FBQTtJQUNsQyxDQUFDO0lBRUQ7Ozs7Ozs7OztPQVNHO0lBQ0gsS0FBSyxDQUFDLHdCQUF3QixDQUFDLFFBQVEsRUFBRSxPQUFPLEdBQUcsRUFBRTtRQUNuRCxPQUFPLE1BQU0sSUFBSSxDQUFDLDhCQUE4QixDQUFDLEtBQUssRUFBRSxFQUFFLEVBQUUsRUFBRTtZQUM1RCxNQUFNLElBQUksQ0FBQyxrQkFBa0IsQ0FBQyxFQUFFLENBQUMsQ0FBQTtZQUVqQyxPQUFPLE1BQU0sUUFBUSxDQUFDLEVBQUUsQ0FBQyxDQUFBO1FBQzNCLENBQUMsRUFBRSxPQUFPLENBQUMsQ0FBQTtJQUNiLENBQUM7SUFFRDs7Ozs7O09BTUc7SUFDSCxLQUFLLENBQUMsOEJBQThCLENBQUMsUUFBUSxFQUFFLE9BQU8sR0FBRyxFQUFFO1FBQ3pELE9BQU8sTUFBTSxJQUFJLENBQUMsNkJBQTZCLENBQzdDLEtBQUssRUFBRSxFQUFFLEVBQUUsRUFBRSxDQUFDLE1BQU0sSUFBSSxDQUFDLGtCQUFrQixDQUFDLEVBQUUsRUFBRSxLQUFLLElBQUksRUFBRSxDQUFDLE1BQU0sUUFBUSxDQUFDLEVBQUUsQ0FBQyxDQUFDLEVBQy9FLE9BQU8sQ0FDUixDQUFBO0lBQ0gsQ0FBQztJQUVEOzs7Ozs7OztPQVFHO0lBQ0gsS0FBSyxDQUFDLDZCQUE2QixDQUFDLFFBQVEsRUFBRSxPQUFPLEdBQUcsRUFBRTtRQUN4RCxNQUFNLFVBQVUsR0FBRyxJQUFJLENBQUMscUJBQXFCLEVBQUUsSUFBSSxTQUFTLENBQUE7UUFDNUQsTUFBTSxRQUFRLEdBQUcseUJBQXlCLENBQUMsR0FBRyxDQUFDLFVBQVUsQ0FBQyxJQUFJLE9BQU8sQ0FBQyxPQUFPLEVBQUUsQ0FBQTtRQUMvRSxJQUFJLFVBQVUsR0FBRyxHQUFHLEVBQUUsR0FBRSxDQUFDLENBQUE7UUFDekIsNEJBQTRCO1FBQzVCLE1BQU0sR0FBRyxHQUFHLElBQUksT0FBTyxDQUFDLENBQUMsT0FBTyxFQUFFLEVBQUU7WUFDbEMsVUFBVSxHQUFHLEdBQUcsRUFBRSxDQUFDLE9BQU8sQ0FBQyxTQUFTLENBQUMsQ0FBQTtRQUN2QyxDQUFDLENBQUMsQ0FBQTtRQUNGLE1BQU0sS0FBSyxHQUFHLFFBQVEsQ0FBQyxJQUFJLENBQUMsR0FBRyxFQUFFLENBQUMsR0FBRyxDQUFDLENBQUE7UUFFdEMseUJBQXlCLENBQUMsR0FBRyxDQUFDLFVBQVUsRUFBRSxLQUFLLENBQUMsQ0FBQTtRQUNoRCxNQUFNLFFBQVEsQ0FBQTtRQUVkLElBQUksQ0FBQztZQUNILE9BQU8sTUFBTSxJQUFJLENBQUMsT0FBTyxDQUFDLEtBQUssRUFBRSxFQUFFLEVBQUUsRUFBRTtnQkFDckMsTUFBTSxFQUFDLFlBQVksRUFBQyxHQUFHLE9BQU8sQ0FBQTtnQkFFOUIsSUFBSSxZQUFZLEVBQUUsQ0FBQztvQkFDakIsTUFBTSxRQUFRLEdBQUcsTUFBTSxFQUFFLENBQUMsbUJBQW1CLENBQUMsWUFBWSxDQUFDLElBQUksQ0FBQyxDQUFBO29CQUVoRSxJQUFJLENBQUMsUUFBUTt3QkFBRSxNQUFNLElBQUksS0FBSyxDQUFDLFlBQVksQ0FBQyxjQUFjLENBQUMsQ0FBQTtnQkFDN0QsQ0FBQztnQkFFRCxJQUFJLENBQUM7b0JBQ0gsT0FBTyxNQUFNLFFBQVEsQ0FBQyxFQUFFLENBQUMsQ0FBQTtnQkFDM0IsQ0FBQzt3QkFBUyxDQUFDO29CQUNULElBQUksWUFBWTt3QkFBRSxNQUFNLEVBQUUsQ0FBQyxtQkFBbUIsQ0FBQyxZQUFZLENBQUMsSUFBSSxDQUFDLENBQUE7Z0JBQ25FLENBQUM7WUFDSCxDQUFDLENBQUMsQ0FBQTtRQUNKLENBQUM7Z0JBQVMsQ0FBQztZQUNULFVBQVUsRUFBRSxDQUFBO1lBQ1osSUFBSSx5QkFBeUIsQ0FBQyxHQUFHLENBQUMsVUFBVSxDQUFDLEtBQUssS0FBSztnQkFBRSx5QkFBeUIsQ0FBQyxNQUFNLENBQUMsVUFBVSxDQUFDLENBQUE7UUFDdkcsQ0FBQztJQUNILENBQUM7SUFFRDs7Ozs7Ozs7T0FRRztJQUNILG1CQUFtQixDQUFDLEVBQUMsR0FBRyxFQUFFLFNBQVMsRUFBRSxRQUFRLEVBQUUsYUFBYSxFQUFDO1FBQzNELElBQUksR0FBRyxDQUFDLE1BQU0sS0FBSyxZQUFZO1lBQUUsT0FBTyxLQUFLLENBQUE7UUFFN0MsT0FBTyxJQUFJLENBQUMsdUJBQXVCLENBQUMsRUFBQyxTQUFTLEVBQUUsR0FBRyxFQUFDLENBQUM7ZUFDaEQsSUFBSSxDQUFDLG9CQUFvQixDQUFDLEVBQUMsR0FBRyxFQUFFLFFBQVEsRUFBQyxDQUFDO2VBQzFDLElBQUksQ0FBQyxxQkFBcUIsQ0FBQyxFQUFDLGFBQWEsRUFBRSxHQUFHLEVBQUMsQ0FBQyxDQUFBO0lBQ3ZELENBQUM7SUFFRDs7OztPQUlHO0lBQ0gsd0JBQXdCLENBQUMsR0FBRztRQUMxQixPQUFPLEVBQUMsVUFBVSxFQUFFLEdBQUcsQ0FBQyxTQUFTLEVBQUUsRUFBRSxFQUFFLEdBQUcsQ0FBQyxFQUFFLEVBQUUsTUFBTSxFQUFFLFlBQVksRUFBQyxDQUFBO0lBQ3RFLENBQUM7SUFFRDs7Ozs7O09BTUc7SUFDSCx1QkFBdUIsQ0FBQyxFQUFDLFNBQVMsRUFBRSxHQUFHLEVBQUM7UUFDdEMsSUFBSSxDQUFDLEdBQUcsQ0FBQyxTQUFTO1lBQUUsT0FBTyxJQUFJLENBQUE7UUFFL0IsT0FBTyxTQUFTLEtBQUssR0FBRyxDQUFDLFNBQVMsQ0FBQTtJQUNwQyxDQUFDO0lBRUQ7Ozs7OztPQU1HO0lBQ0gsb0JBQW9CLENBQUMsRUFBQyxHQUFHLEVBQUUsUUFBUSxFQUFDO1FBQ2xDLElBQUksQ0FBQyxRQUFRO1lBQUUsT0FBTyxJQUFJLENBQUE7UUFDMUIsSUFBSSxDQUFDLEdBQUcsQ0FBQyxRQUFRO1lBQUUsT0FBTyxJQUFJLENBQUE7UUFFOUIsT0FBTyxRQUFRLEtBQUssR0FBRyxDQUFDLFFBQVEsQ0FBQTtJQUNsQyxDQUFDO0lBRUQ7Ozs7OztPQU1HO0lBQ0gscUJBQXFCLENBQUMsRUFBQyxhQUFhLEVBQUUsR0FBRyxFQUFDO1FBQ3hDLElBQUksQ0FBQyxhQUFhO1lBQUUsT0FBTyxJQUFJLENBQUE7UUFDL0IsSUFBSSxDQUFDLEdBQUcsQ0FBQyxhQUFhO1lBQUUsT0FBTyxJQUFJLENBQUE7UUFFbkMsT0FBTyxhQUFhLEtBQUssR0FBRyxDQUFDLGFBQWEsQ0FBQTtJQUM1QyxDQUFDO0lBRUQ7Ozs7T0FJRztJQUNILGFBQWEsQ0FBQyxPQUFPLEdBQUcsaUJBQWlCO1FBQ3ZDLE9BQU8sR0FBRyxlQUFlLElBQUksT0FBTyxFQUFFLENBQUE7SUFDeEMsQ0FBQztDQUNGIiwic291cmNlc0NvbnRlbnQiOlsiLy8gQHRzLWNoZWNrXG5cbmltcG9ydCB7Y3JlYXRlSGFzaCwgcmFuZG9tVVVJRH0gZnJvbSBcImNyeXB0b1wiXG5pbXBvcnQgQmFja2dyb3VuZEpvYnNBZGFwdGVyIGZyb20gXCIuL2FkYXB0ZXIuanNcIlxuaW1wb3J0IExvZ2dlciBmcm9tIFwiLi4vbG9nZ2VyLmpzXCJcbmltcG9ydCBUYWJsZURhdGEgZnJvbSBcIi4uL2RhdGFiYXNlL3RhYmxlLWRhdGEvaW5kZXguanNcIlxuaW1wb3J0IFZlbG9jaW91c0Vycm9yIGZyb20gXCIuLi92ZWxvY2lvdXMtZXJyb3IuanNcIlxuaW1wb3J0IEJhY2tncm91bmRKb2JSZWNvcmQgZnJvbSBcIi4vam9iLXJlY29yZC5qc1wiXG5pbXBvcnQgbm9ybWFsaXplQmFja2dyb3VuZEpvYkVycm9yIGZyb20gXCIuL25vcm1hbGl6ZS1lcnJvci5qc1wiXG5pbXBvcnQgeyBjb29yZGluYXRlU2hhcmVkVHJhbnNhY3Rpb25Db25uZWN0aW9uIH0gZnJvbSBcIi4uL3Rlc3Rpbmcvc2hhcmVkLXRyYW5zYWN0aW9uLWNvbm5lY3Rpb24tY29vcmRpbmF0b3IuanNcIlxuaW1wb3J0IHN0YWJsZUpzb25TdHJpbmdpZnkgZnJvbSBcIi4uL3V0aWxzL3N0YWJsZS1qc29uLmpzXCJcbmltcG9ydCB7XG4gIEJBQ0tHUk9VTkRfSk9CX1RFUk1JTkFMX1NUQVRVU0VTLFxuICBCQUNLR1JPVU5EX0pPQl9FWEVDVVRJT05fTU9ERVMsXG4gIERFRkFVTFRfQkFDS0dST1VORF9KT0JfRVhFQ1VUSU9OX01PREUsXG4gIERFRkFVTFRfQkFDS0dST1VORF9KT0JfUVVFVUUsXG4gIFFVRVVFX0NPTkNVUlJFTkNZX0tFWV9QUkVGSVgsXG4gIG5vcm1hbGl6ZUJhY2tncm91bmRKb2JDb25jdXJyZW5jeSxcbiAgbm9ybWFsaXplQmFja2dyb3VuZEpvYkV4ZWN1dGlvbk1vZGUsXG4gIG5vcm1hbGl6ZUJhY2tncm91bmRKb2JNYXhSZXRyaWVzLFxuICBub3JtYWxpemVCYWNrZ3JvdW5kSm9iUXVldWUsXG4gIG5vcm1hbGl6ZUJhY2tncm91bmRKb2JTY2hlZHVsZUtleSxcbiAgbm9ybWFsaXplQmFja2dyb3VuZEpvYlNjaGVkdWxlZEF0TXMsXG4gIG5vcm1hbGl6ZUJhY2tncm91bmRKb2JTdGF0dXMsXG4gIHJlc2NoZWR1bGVkQmFja2dyb3VuZEpvYkF0TXMsXG4gIHJldHJ5RGVsYXlNc1xufSBmcm9tIFwiLi9qb2Itc2VtYW50aWNzLmpzXCJcbmltcG9ydCB7XG4gIE1BSUxfREVMSVZFUllfT1BFUkFUSU9OU19UQUJMRSxcbiAgbWFpbERlbGl2ZXJ5T3BlcmF0aW9uRm9ySm9iLFxuICBtYWlsRGVsaXZlcnlPcGVyYXRpb25LZXlcbn0gZnJvbSBcIi4uL21haWxlci9kZWxpdmVyeS1vcGVyYXRpb24uanNcIlxuXG4vKipcbiAqIFByZXBhcmVkQmFja2dyb3VuZEpvYiB0eXBlLlxuICogQHR5cGVkZWYge29iamVjdH0gUHJlcGFyZWRCYWNrZ3JvdW5kSm9iXG4gKiBAcHJvcGVydHkge3N0cmluZ30gYXJnc0pzb24gLSBTZXJpYWxpemVkIGFyZ3VtZW50cy5cbiAqIEBwcm9wZXJ0eSB7e2NvbmN1cnJlbmN5S2V5OiBzdHJpbmcsIG1heENvbmN1cnJlbmN5OiBudW1iZXIsIHF1ZXVlRGVyaXZlZDogYm9vbGVhbn0gfCBudWxsfSBjb25jdXJyZW5jeSAtIFJlc29sdmVkIGNvbmN1cnJlbmN5LlxuICogQHByb3BlcnR5IHtudW1iZXJ9IGNyZWF0ZWRBdE1zIC0gQ3JlYXRpb24gdGltZXN0YW1wLlxuICogQHByb3BlcnR5IHtpbXBvcnQoXCIuL3R5cGVzLmpzXCIpLkJhY2tncm91bmRKb2JFeGVjdXRpb25Nb2RlfSBleGVjdXRpb25Nb2RlIC0gRXhlY3V0aW9uIG1vZGUuXG4gKiBAcHJvcGVydHkge3N0cmluZ30gam9iSWQgLSBOZXcgam9iIGlkLlxuICogQHByb3BlcnR5IHtzdHJpbmd9IGpvYk5hbWUgLSBKb2IgbmFtZS5cbiAqIEBwcm9wZXJ0eSB7bnVtYmVyfSBtYXhSZXRyaWVzIC0gUmV0cnkgY2FwLlxuICogQHByb3BlcnR5IHtzdHJpbmd9IHF1ZXVlIC0gUXVldWUgbmFtZS5cbiAqIEBwcm9wZXJ0eSB7bnVtYmVyfSBzY2hlZHVsZWRBdE1zIC0gRWxpZ2liaWxpdHkgdGltZXN0YW1wLlxuICogQHByb3BlcnR5IHtudW1iZXIgfCBudWxsfSB0aW1lb3V0TXMgLSBQZXItam9iIHRpbWVvdXQgb3ZlcnJpZGUsIG9yIG51bGwgd2hlbiBvbWl0dGVkLlxuICovXG5cbi8qKlxuICogQmFja2dyb3VuZEpvYk9ycGhhblNlbGVjdGlvbiB0eXBlLlxuICogQHR5cGVkZWYge29iamVjdH0gQmFja2dyb3VuZEpvYk9ycGhhblNlbGVjdGlvblxuICogQHByb3BlcnR5IHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59IGNvbmRpdGlvbnMgLSBFeGFjdCB1cGRhdGUgZmVuY2UuXG4gKiBAcHJvcGVydHkge2ltcG9ydChcIi4vdHlwZXMuanNcIikuQmFja2dyb3VuZEpvYlJvd30gam9iIC0gU2VsZWN0ZWQgYWN0aXZlIGhhbmRvZmYuXG4gKi9cblxuLyoqXG4gKiBCYWNrZ3JvdW5kSm9iVHJhbnNhY3Rpb25TZXJpYWxpemF0aW9uT3B0aW9ucyB0eXBlLlxuICogQHR5cGVkZWYge29iamVjdH0gQmFja2dyb3VuZEpvYlRyYW5zYWN0aW9uU2VyaWFsaXphdGlvbk9wdGlvbnNcbiAqIEBwcm9wZXJ0eSB7e2ZhaWx1cmVNZXNzYWdlOiBzdHJpbmcsIG5hbWU6IHN0cmluZ319IFthZHZpc29yeUxvY2tdIC0gU2Vzc2lvbiBsb2NrIGhlbGQgYXJvdW5kIHRoZSB0cmFuc2FjdGlvbi5cbiAqL1xuXG4vKipcbiAqIEJhY2tncm91bmRKb2JQcnVuZUNhbmRpZGF0ZU1ldGFkYXRhIHR5cGUuIEltbXV0YWJsZSBtZXRhZGF0YSBmb3Igb25lIHNlbGVjdGVkXG4gKiByZXRlbnRpb24gY2FuZGlkYXRlIGJhdGNoLCBleHBvc2VkIHRvIHRoZSBvcHRpb25hbCBwcnVuZSBiYXJyaWVyIGhvb2suXG4gKiBAdHlwZWRlZiB7b2JqZWN0fSBCYWNrZ3JvdW5kSm9iUHJ1bmVDYW5kaWRhdGVNZXRhZGF0YVxuICogQHByb3BlcnR5IHtSZWFkb25seTxBcnJheTxzdHJpbmc+Pn0gY2FuZGlkYXRlcyAtIEpvYiBpZHMgc2VsZWN0ZWQgZm9yIHRoaXMgYmF0Y2guXG4gKiBAcHJvcGVydHkge3N0cmluZ30gc3RhdHVzIC0gVGVybWluYWwgc3RhdHVzIHRoZSBjYW5kaWRhdGVzIHdlcmUgc2VsZWN0ZWQgYnkuXG4gKiBAcHJvcGVydHkge3N0cmluZ30gY29sdW1uIC0gVGVybWluYWwgdGltZXN0YW1wIGNvbHVtbiBjb21wYXJlZCBhZ2FpbnN0IHRoZSBjdXRvZmYuXG4gKiBAcHJvcGVydHkge251bWJlcn0gY3V0b2ZmIC0gQ3V0b2ZmIHRpbWVzdGFtcCB0aGUgY2FuZGlkYXRlcyB3ZXJlIHNlbGVjdGVkIGFnYWluc3QuXG4gKi9cblxuLyoqXG4gKiBCYWNrZ3JvdW5kSm9iQ29uY3VycmVuY3lDb3VudFJvdyB0eXBlLlxuICogQHR5cGVkZWYge29iamVjdH0gQmFja2dyb3VuZEpvYkNvbmN1cnJlbmN5Q291bnRSb3dcbiAqIEBwcm9wZXJ0eSB7bnVtYmVyIHwgc3RyaW5nfSBhY3RpdmVfY291bnQgLSBQZXJzaXN0ZWQgb3IgYWdncmVnYXRlZCBhY3RpdmUgY291bnQuXG4gKiBAcHJvcGVydHkge3N0cmluZ30gY29uY3VycmVuY3lfa2V5IC0gRHVyYWJsZSBjYXAgaWRlbnRpdHkuXG4gKi9cblxuLyoqXG4gKiBCYWNrZ3JvdW5kSm9iUXVldWVkQ29uY3VycmVuY3kgdHlwZS5cbiAqIEB0eXBlZGVmIHtvYmplY3R9IEJhY2tncm91bmRKb2JRdWV1ZWRDb25jdXJyZW5jeVxuICogQHByb3BlcnR5IHtzdHJpbmcgfCBudWxsfSBjb25jdXJyZW5jeUtleSAtIEN1cnJlbnQgY29uY3VycmVuY3kga2V5IGZvciBxdWV1ZWQgd29yay5cbiAqIEBwcm9wZXJ0eSB7bnVtYmVyIHwgbnVsbH0gbWF4Q29uY3VycmVuY3kgLSBDdXJyZW50IGNvbmN1cnJlbmN5IGNhcCBmb3IgcXVldWVkIHdvcmsuXG4gKi9cblxuY29uc3QgTUlHUkFUSU9OU19UQUJMRSA9IFwidmVsb2Npb3VzX2ludGVybmFsX21pZ3JhdGlvbnNcIlxuY29uc3QgTUlHUkFUSU9OX1NDT1BFID0gXCJiYWNrZ3JvdW5kX2pvYnNcIlxuY29uc3QgTUlHUkFUSU9OX1ZFUlNJT04gPSBcIjIwMjUwMjE1MDAwMDAwXCJcbmNvbnN0IFNDSEVNQV9SRUNPVkVSWV9QRU5ESU5HX1ZFUlNJT04gPSBcInNjaGVtYS1yZWNvdmVyeS1wZW5kaW5nXCJcbmNvbnN0IEVYRUNVVElPTl9NT0RFX0JBQ0tGSUxMX01JR1JBVElPTl9WRVJTSU9OID0gXCIyMDI2MDYwNzEzMTAxMFwiXG4vLyBEcm9wcyB0aGUgcmVkdW5kYW50IGxlZ2FjeSBgZm9ya2VkYCBib29sZWFuIGNvbHVtbiBhbmQgcmV3cml0ZXMgcG9vbGVkIHJvd3MgdG9cbi8vIHBlcnNpc3QgYGV4ZWN1dGlvbl9tb2RlID0gXCJwb29sZWRcImAgZGlyZWN0bHkgKHJldGlyaW5nIHRoZSBwb29sZWQtYXMtZm9ya2VkXG4vLyBoYW5kb2ZmLW1hcmtlciB3b3JrYXJvdW5kKSwgbGVhdmluZyBgZXhlY3V0aW9uX21vZGVgIGFzIHRoZSBzaW5nbGUgc291cmNlIG9mXG4vLyB0cnV0aCBmb3IgYSBqb2IncyBydW50aW1lLlxuY29uc3QgRFJPUF9GT1JLRURfQ09MVU1OX01JR1JBVElPTl9WRVJTSU9OID0gXCIyMDI2MDcxOTAwMDAwMFwiXG5jb25zdCBKT0JTX0lOREVYX1JFUEFJUl9NSUdSQVRJT05fVkVSU0lPTiA9IFwiMjAyNjA5MDMxMjAwMDBcIlxuLy8gTGVnYWN5IG1hcmtlciBwcmVmaXggdXNlZCBieSByb3dzIHdyaXR0ZW4gYmVmb3JlIHRoaXMgbWlncmF0aW9uOiBwb29sZWQgam9ic1xuLy8gdXNlZCB0byBwZXJzaXN0IGFzIGBleGVjdXRpb25fbW9kZSA9IFwiZm9ya2VkXCJgIHBsdXMgYSBgdmVsb2Npb3VzLXBvb2xlZDoqYFxuLy8gaGFuZG9mZiBpZC4gUmV0YWluZWQgb25seSB0byBkZXRlY3QgYW5kIGNvbnZlcnQgdGhvc2Ugcm93cyBpbiB0aGUgbWlncmF0aW9uLlxuY29uc3QgTEVHQUNZX1BPT0xFRF9IQU5ET0ZGX0lEX1BSRUZJWCA9IFwidmVsb2Npb3VzLXBvb2xlZDpcIlxuY29uc3QgTEVHQUNZX1BPT0xFRF9RVUVVRURfSEFORE9GRl9JRCA9IGAke0xFR0FDWV9QT09MRURfSEFORE9GRl9JRF9QUkVGSVh9cXVldWVkYFxuY29uc3QgSk9CU19UQUJMRSA9IFwiYmFja2dyb3VuZF9qb2JzXCJcbmNvbnN0IEpPQlNfSU5ERVhfQ09MVU1OX05BTUVTID0gW1xuICBcImpvYl9uYW1lXCIsXG4gIFwicXVldWVcIixcbiAgXCJzdGF0dXNcIixcbiAgXCJzY2hlZHVsZWRfYXRfbXNcIixcbiAgXCJjcmVhdGVkX2F0X21zXCIsXG4gIFwic2NoZWR1bGVfa2V5XCIsXG4gIFwiaGFuZGVkX29mZl9hdF9tc1wiLFxuICBcIm9ycGhhbmVkX2F0X21zXCIsXG4gIFwiY29uY3VycmVuY3lfa2V5XCJcbl1cbmNvbnN0IElERU1QT1RFTkNZX0tFWVNfVEFCTEUgPSBcImJhY2tncm91bmRfam9iX2lkZW1wb3RlbmN5X2tleXNcIlxuY29uc3QgU0NIRURVTEVfS0VZU19UQUJMRSA9IFwiYmFja2dyb3VuZF9qb2Jfc2NoZWR1bGVfa2V5c1wiXG5jb25zdCBTQ0hFRFVMRV9PUkRFUl9XQVRFUk1BUktTX1RBQkxFID0gXCJiYWNrZ3JvdW5kX2pvYl9zY2hlZHVsZV9vcmRlcl93YXRlcm1hcmtzXCJcbmNvbnN0IFNDSEVEVUxFX09SREVSX1dBVEVSTUFSS19NSUdSQVRJT05fVkVSU0lPTiA9IFwiMjAyNjA5MTExMjAwMDBcIlxuY29uc3QgU0NIRURVTEVfSElTVE9SWV9PUkRFUl9JTkRFWCA9IFwiaW5kZXhfYmFja2dyb3VuZF9qb2JzX3NjaGVkdWxlX2hpc3Rvcnlfb3JkZXJcIlxuLy8gQ29tcG9zaXRlIHJldGVudGlvbiBpbmRleGVzIGJvdW5kIHRoZSB0ZXJtaW5hbC1zdGF0dXMgZGlzY292ZXJ5IHNjYW4gdG8gdGhlIGV4cGlyZWRcbi8vIChzdGF0dXMsIHRlcm1pbmFsX3RpbWVzdGFtcCkgcmFuZ2UsIHNvIHJldGVudGlvbiBjYW5kaWRhdGUgcGFnZXMgc3RheSBjaGVhcCBvblxuLy8gbXVsdGktbWlsbGlvbi1yb3cgdGFibGVzLiBBY3RpdmF0aW9uIHdhcyBzdGFnZWQgc2VwYXJhdGVseSBmcm9tIHRoZSBsb2NrLXNjb3BlIGZpeFxuLy8gYmVjYXVzZSBNYXJpYURCIG9ubGluZSBpbmRleCBEREwgbWFrZXMgY29uY3VycmVudCBtZXRhZGF0YSBpbnNwZWN0aW9uIGZhaWwgd2l0aFxuLy8gRVJfV0FSTl9JX1NfU0tJUFBFRF9UQUJMRTsgdGhlIGRyaXZlciBub3cgb3V0bGFzdHMgdGhhdCBza2lwIHdpdGggYSBib3VuZGVkIHJldHJ5LlxuY29uc3QgUkVURU5USU9OX0lOREVYX01JR1JBVElPTl9WRVJTSU9OID0gXCIyMDI2MTAxMjEyMDAwMFwiXG5jb25zdCBSRVRFTlRJT05fSU5ERVhfREVGSU5JVElPTlMgPSBbXG4gIHtjb2x1bW5zOiBbXCJzdGF0dXNcIiwgXCJjb21wbGV0ZWRfYXRfbXNcIiwgXCJpZFwiXSwgbmFtZTogXCJpbmRleF9iYWNrZ3JvdW5kX2pvYnNfY29tcGxldGVkX3JldGVudGlvblwifSxcbiAge2NvbHVtbnM6IFtcInN0YXR1c1wiLCBcImZhaWxlZF9hdF9tc1wiLCBcImlkXCJdLCBuYW1lOiBcImluZGV4X2JhY2tncm91bmRfam9ic19mYWlsZWRfcmV0ZW50aW9uXCJ9LFxuICB7Y29sdW1uczogW1wic3RhdHVzXCIsIFwib3JwaGFuZWRfYXRfbXNcIiwgXCJpZFwiXSwgbmFtZTogXCJpbmRleF9iYWNrZ3JvdW5kX2pvYnNfb3JwaGFuZWRfcmV0ZW50aW9uXCJ9XG5dXG5jb25zdCBDT05DVVJSRU5DWV9UQUJMRSA9IFwiYmFja2dyb3VuZF9qb2JfY29uY3VycmVuY3lcIlxuY29uc3QgQ09VTlRTX1JFVklTSU9OX1RBQkxFID0gXCJiYWNrZ3JvdW5kX2pvYl9jb3VudF9yZXZpc2lvbnNcIlxuY29uc3QgQ09VTlRTX1JFVklTSU9OX0tFWSA9IFwiY291bnRzXCJcbmNvbnN0IENPTkNVUlJFTkNZX1JFQ09OQ0lMSUFUSU9OX0xPQ0sgPSBcImJhY2tncm91bmQtam9iczpxdWV1ZS1jb25jdXJyZW5jeS1yZWNvbmNpbGVcIlxuY29uc3QgQ09OQ1VSUkVOQ1lfUkVQQUlSX1NBTVBMRV9MSU1JVCA9IDEwXG5leHBvcnQgY29uc3QgQkFDS0dST1VORF9KT0JfQ09VTlRTX0NIQU5ORUwgPSBcInZlbG9jaW91cy1iYWNrZ3JvdW5kLWpvYi1jb3VudHNcIlxuZXhwb3J0IGNvbnN0IEJBQ0tHUk9VTkRfSk9CX0NPVU5UX0JVQ0tFVFMgPSBbXCJhbGxcIiwgXCJxdWV1ZWRcIiwgXCJoYW5kZWRfb2ZmXCIsIFwiY29tcGxldGVkXCIsIFwiZmFpbGVkXCIsIFwib3JwaGFuZWRcIl1cbmNvbnN0IENPVU5URURfSk9CX1NUQVRVU0VTID0gQkFDS0dST1VORF9KT0JfQ09VTlRfQlVDS0VUUy5zbGljZSgxKVxuY29uc3QgTUFYX0pPQl9USU1FT1VUX01TID0gMl8xNDdfNDgzXzY0N1xuY29uc3QgSk9CX1RJTUVPVVRfVkFMSURBVElPTl9NRVNTQUdFID0gYGJhY2tncm91bmQgam9iIHRpbWVvdXRNcyBtdXN0IGJlIGEgZmluaXRlIG5vbi1wb3NpdGl2ZSBudW1iZXIgb3IgYW4gaW50ZWdlciBiZXR3ZWVuIDEgYW5kICR7TUFYX0pPQl9USU1FT1VUX01TfWBcbmNvbnN0IE9SUEhBTkVEX0FGVEVSX01TID0gMiAqIDYwICogNjAgKiAxMDAwXG5cbi8qKlxuICogQ29sdW1ucyB0aGUgZGFzaGJvYXJkIGlzIGFsbG93ZWQgdG8gc29ydCBqb2IgbGlzdGluZ3MgYnksIG1hcHBlZCB0byB0aGVpclxuICogZGF0YWJhc2UgY29sdW1uIG5hbWVzLiBSZXN0cmljdGluZyB0byB0aGlzIHNldCBrZWVwcyB0aGUgc29ydCBwYXJhbWV0ZXJcbiAqICh3aGljaCBvcmlnaW5hdGVzIGZyb20gdW50cnVzdGVkIHF1ZXJ5IHN0cmluZ3MpIGZyb20gcmVhY2hpbmcgcmF3IFNRTC5cbiAqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBzdHJpbmc+fVxuICovXG5jb25zdCBTT1JUQUJMRV9DT0xVTU5TID0ge1xuICBhdHRlbXB0czogXCJhdHRlbXB0c1wiLFxuICBjb21wbGV0ZWRBdE1zOiBcImNvbXBsZXRlZF9hdF9tc1wiLFxuICBjcmVhdGVkQXRNczogXCJjcmVhdGVkX2F0X21zXCIsXG4gIGZhaWxlZEF0TXM6IFwiZmFpbGVkX2F0X21zXCIsXG4gIGhhbmRlZE9mZkF0TXM6IFwiaGFuZGVkX29mZl9hdF9tc1wiLFxuICBzY2hlZHVsZWRBdE1zOiBcInNjaGVkdWxlZF9hdF9tc1wiXG59XG5cbi8qKlxuICogU2VyaWFsaXplcyBjb25jdXJyZW50IGBfYXBwbHlTY2hlbWFgIHJ1bnMgd2l0aGluIFRISVMgcHJvY2Vzcywga2V5ZWQgYnkgZGF0YWJhc2VcbiAqIGlkZW50aWZpZXIsIGJlZm9yZSBjYWxsZXJzIHdpdGhvdXQgYW4gZXhpc3RpbmcgY29ubmVjdGlvbiBjaGVjayBvbmUgb3V0LiBUd29cbiAqIHN0b3JlcyB0aGF0IHNoYXJlIG9uZSBjb25uZWN0aW9uIChTaW5nbGVNdWx0aVVzZSAvIFNRTGl0ZSlcbiAqIG90aGVyd2lzZSBpbnRlcmxlYXZlIHRoZSBtdWx0aS1zdGVwIHRhYmxlIHJlYnVpbGQgYW5kIGNvcnJ1cHQgaXQgKHRoZSBqb2JzIHRhYmxlXG4gKiBpcyBsZWZ0IGFzIGl0cyBgKl92ZWxvY2lvdXNfcmVidWlsZGAgdGVtcCkuIEEgREIgYWR2aXNvcnkgbG9jayBjYW4ndCBmaXggdGhhdDogb25cbiAqIGEgc2Vzc2lvbi1zY29wZWQgLyByZS1lbnRyYW50IGRyaXZlciAoTXlTUUwgYEdFVF9MT0NLYCkgYSBzZWNvbmQgYWNxdWlyZSBvbiB0aGVcbiAqIHNhbWUgc2Vzc2lvbiBzdWNjZWVkcyBpbW1lZGlhdGVseSBzbyBib3RoIGNhbGxlcnMgcHJvY2VlZCwgYW5kIHRha2luZyBpdCBvbiBhXG4gKiBzZXBhcmF0ZSBjb25uZWN0aW9uIGJsb2NrcyBjcm9zcy1zZXNzaW9uIGZvcmV2ZXIuIEFuIGluLXByb2Nlc3MgcHJvbWlzZS1jaGFpblxuICogbXV0ZXggc2VyaWFsaXplcyBzYW1lLXByb2Nlc3MgY2FsbGVycyB3aXRoIG5laXRoZXIgaGF6YXJkLiBDcm9zcy1wcm9jZXNzIHNjaGVtYVxuICogcmFjZXMgc3RheSBjb3ZlcmVkIGJ5IHRoZSBwZXItc3RlcCBhZHZpc29yeSBsb2NrcyArIHJlY2hlY2tzIGluc2lkZSB0aGUgc3RlcHMuXG4gKiBAdHlwZSB7TWFwPHN0cmluZywgUHJvbWlzZTx2b2lkPj59XG4gKi9cbmNvbnN0IHNjaGVtYUFwcGx5Q2hhaW5zID0gbmV3IE1hcCgpXG4vKiogQHR5cGUge01hcDxzdHJpbmcsIFByb21pc2U8dm9pZD4+fSAqL1xuY29uc3QgdHJhbnNhY3Rpb25NdXRhdGlvbkNoYWlucyA9IG5ldyBNYXAoKVxuXG5leHBvcnQgZGVmYXVsdCBjbGFzcyBCYWNrZ3JvdW5kSm9ic1N0b3JlIGV4dGVuZHMgQmFja2dyb3VuZEpvYnNBZGFwdGVyIHtcbiAgLyoqXG4gICAqIFJ1bnMgY29uc3RydWN0b3IuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gT3B0aW9ucy5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9jb25maWd1cmF0aW9uLmpzXCIpLmRlZmF1bHR9IGFyZ3MuY29uZmlndXJhdGlvbiAtIENvbmZpZ3VyYXRpb24uXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBbYXJncy5kYXRhYmFzZUlkZW50aWZpZXJdIC0gRGF0YWJhc2UgaWRlbnRpZmllci5cbiAgICogQHBhcmFtIHt7bm93OiAoKSA9PiBudW1iZXJ9fSBbYXJncy5jbG9ja10gLSBJbmplY3RhYmxlIHBlcnNpc3RlbmNlIGNsb2NrLlxuICAgKiBAcGFyYW0geyhwcm9kdWNlclByb29mOiBpbXBvcnQoXCIuL3R5cGVzLmpzXCIpLkJhY2tncm91bmRKb2JQcm9kdWNlclByb29mKSA9PiB2b2lkIHwgUHJvbWlzZTx2b2lkPn0gW2FyZ3MuYWZ0ZXJPd25lZFByb2R1Y2VyVmFsaWRhdGlvbl0gLSBFeGFjdCBvd25lZC1lbnF1ZXVlIHZhbGlkYXRpb24gaG9vay5cbiAgICogQHBhcmFtIHsobWV0YWRhdGE6IEJhY2tncm91bmRKb2JQcnVuZUNhbmRpZGF0ZU1ldGFkYXRhKSA9PiB2b2lkIHwgUHJvbWlzZTx2b2lkPn0gW2FyZ3MuYWZ0ZXJQcnVuZUNhbmRpZGF0ZXNTZWxlY3RlZF0gLSBPcHRpb25hbCBiYXJyaWVyIGludm9rZWQgYWZ0ZXIgb25lIHJldGVudGlvbiBiYXRjaCdzIGNhbmRpZGF0ZSBkaXNjb3ZlcnkgYW5kIGJlZm9yZSBpdHMgc2VyaWFsaXplZCBkZWxldGUgdHJhbnNhY3Rpb24uXG4gICAqL1xuICBjb25zdHJ1Y3Rvcih7Y29uZmlndXJhdGlvbiwgZGF0YWJhc2VJZGVudGlmaWVyLCBjbG9jaywgYWZ0ZXJPd25lZFByb2R1Y2VyVmFsaWRhdGlvbiwgYWZ0ZXJQcnVuZUNhbmRpZGF0ZXNTZWxlY3RlZH0pIHtcbiAgICBzdXBlcigpXG4gICAgdGhpcy5jb25maWd1cmF0aW9uID0gY29uZmlndXJhdGlvblxuICAgIHRoaXMuZGF0YWJhc2VJZGVudGlmaWVyID0gZGF0YWJhc2VJZGVudGlmaWVyXG4gICAgdGhpcy5jbG9jayA9IGNsb2NrIHx8IHtub3c6ICgpID0+IERhdGUubm93KCl9XG4gICAgdGhpcy5hZnRlck93bmVkUHJvZHVjZXJWYWxpZGF0aW9uID0gYWZ0ZXJPd25lZFByb2R1Y2VyVmFsaWRhdGlvblxuICAgIHRoaXMuYWZ0ZXJQcnVuZUNhbmRpZGF0ZXNTZWxlY3RlZCA9IGFmdGVyUHJ1bmVDYW5kaWRhdGVzU2VsZWN0ZWRcbiAgICB0aGlzLmxvZ2dlciA9IG5ldyBMb2dnZXIodGhpcylcbiAgICB0aGlzLl9yZWFkeVByb21pc2UgPSBudWxsXG4gICAgdGhpcy5fcXVldWVDb25jdXJyZW5jeVJlY29uY2lsZWQgPSBmYWxzZVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZ2V0IGRhdGFiYXNlIGlkZW50aWZpZXIuXG4gICAqIEByZXR1cm5zIHtzdHJpbmd9IC0gRGF0YWJhc2UgaWRlbnRpZmllci5cbiAgICovXG4gIGdldERhdGFiYXNlSWRlbnRpZmllcigpIHtcbiAgICBpZiAodGhpcy5kYXRhYmFzZUlkZW50aWZpZXIpIHJldHVybiB0aGlzLmRhdGFiYXNlSWRlbnRpZmllclxuXG4gICAgcmV0dXJuIHRoaXMuY29uZmlndXJhdGlvbi5nZXRCYWNrZ3JvdW5kSm9ic0NvbmZpZygpLmRhdGFiYXNlSWRlbnRpZmllclxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZW5zdXJlIHJlYWR5LlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyB3aGVuIHJlYWR5LlxuICAgKi9cbiAgYXN5bmMgZW5zdXJlUmVhZHkoKSB7XG4gICAgaWYgKHRoaXMuX3JlYWR5UHJvbWlzZSkgcmV0dXJuIGF3YWl0IHRoaXMuX3JlYWR5UHJvbWlzZVxuXG4gICAgdGhpcy5fcmVhZHlQcm9taXNlID0gKGFzeW5jICgpID0+IHtcbiAgICAgIHRoaXMuY29uZmlndXJhdGlvbi5zZXRDdXJyZW50KClcbiAgICAgIGF3YWl0IHRoaXMuX2Vuc3VyZVNjaGVtYSgpXG4gICAgICBhd2FpdCB0aGlzLl9pbml0aWFsaXplTW9kZWwoKVxuICAgIH0pKClcblxuICAgIHRyeSB7XG4gICAgICBhd2FpdCB0aGlzLl9yZWFkeVByb21pc2VcbiAgICB9IGZpbmFsbHkge1xuICAgICAgdGhpcy5fcmVhZHlQcm9taXNlID0gbnVsbFxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBFbnN1cmVzIHRoZSBiYWNrZ3JvdW5kLWpvYnMgc2NoZW1hICh0YWJsZXMgKyBjb2x1bW5zKSBleGlzdHMgb24gdGhlIGNvbmZpZ3VyZWRcbiAgICogZGF0YWJhc2UsIHdpdGhvdXQgaW5pdGlhbGl6aW5nIHRoZSBydW50aW1lIG1vZGVsLiBMZXRzIGBkYjptaWdyYXRlYCBjcmVhdGUgdGhlXG4gICAqIGZyYW1ld29yaydzIG93biBzY2hlbWEgZGV0ZXJtaW5pc3RpY2FsbHkgYWxvbmdzaWRlIGFwcCBtaWdyYXRpb25zIOKAlCBhbmQgY2FwdHVyZVxuICAgKiBpdCBpbiB0aGUgZHVtcGVkIHN0cnVjdHVyZSBTUUwg4oCUIGluc3RlYWQgb2YgaXQgb25seSBhcHBlYXJpbmcgb25jZSBhIHN0b3JlIGJvb3RzLlxuICAgKiBJZGVtcG90ZW50OiByZXVzZXMgdGhlIHNhbWUgYF9lbnN1cmVTY2hlbWFgIHRoZSBydW50aW1lIHN0b3JlIHVzZXMsIHdoaWNoIHNraXBzXG4gICAqIHdvcmsgYWxyZWFkeSBhcHBsaWVkICh0cmFja2VkIGluIGB2ZWxvY2lvdXNfaW50ZXJuYWxfbWlncmF0aW9uc2ApLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL2RhdGFiYXNlL2RyaXZlcnMvYmFzZS5qc1wiKS5kZWZhdWx0fSBbZGJdIC0gUmV1c2UgYW4gYWxyZWFkeVxuICAgKiAgIGNoZWNrZWQtb3V0IGNvbm5lY3Rpb24gKGUuZy4gdGhlIG9uZSBgZGI6bWlncmF0ZWAgaG9sZHMpIHJhdGhlciB0aGFuIG9wZW5pbmcgYVxuICAgKiAgIG5lc3RlZCBjaGVja291dCB0aGF0IHdvdWxkIGRlYWRsb2NrIGEgc2luZ2xlLWNvbm5lY3Rpb24gcG9vbC5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgd2hlbiB0aGUgc2NoZW1hIGlzIHByZXNlbnQuXG4gICAqL1xuICBhc3luYyBlbnN1cmVTY2hlbWEoZGIpIHtcbiAgICAvLyBXaGVuIGEgY29ubmVjdGlvbiBpcyBoYW5kZWQgaW4gKHRoZSBkYjptaWdyYXRlIHBhdGgpLCB0aGUgY2FsbGVyIGFscmVhZHkgb3duc1xuICAgIC8vIHRoZSBhY3RpdmUgY29uZmlndXJhdGlvbiArIGNvbm5lY3Rpb24gY29udGV4dDsgY2FsbGluZyBzZXRDdXJyZW50KCkgaGVyZSB3b3VsZFxuICAgIC8vIGNsb2JiZXIgaXQgKGUuZy4gdGhlIGJyb3dzZXIgdGVzdCBydW5uZXIganVnZ2xlcyBtdWx0aXBsZSBjb25maWd1cmF0aW9ucykuXG4gICAgaWYgKCFkYikgdGhpcy5jb25maWd1cmF0aW9uLnNldEN1cnJlbnQoKVxuXG4gICAgYXdhaXQgdGhpcy5fZW5zdXJlU2NoZW1hKGRiKVxuICB9XG5cbiAgLyoqXG4gICAqIFJlY29uY2lsZXMgcXVldWUtZGVyaXZlZCBjb25jdXJyZW5jeSB3aXRoIHRoZSBjdXJyZW50IGNvbmZpZ3VyYXRpb246IHRoZVxuICAgKiBleHBsaWNpdCBsaWZlY3ljbGUgcGF0aCB0aGF0IGFkb3B0cy9yZWxlYXNlcyBwZXJzaXN0ZWQgcXVldWVkIGpvYnMgb250b1xuICAgKiBxdWV1ZSBjb25jdXJyZW5jeSBrZXlzIHdoZW4gYHF1ZXVlc1tuYW1lXS5tYXhDb25jdXJyZW50YCBpcyBhZGRlZCwgcmVtb3ZlZCxcbiAgICogb3IgY2hhbmdlZC4gQ2FsbGVkIGJ5IHRoZSBiYWNrZ3JvdW5kLWpvYnMgbWFpbiBwcm9jZXNzIG9uIHN0YXJ0dXAg4oCUIHRoZVxuICAgKiBkZXBsb3ktdGltZSBtb21lbnQgcXVldWUgY29uZmlndXJhdGlvbiBjaGFuZ2VzIHRha2UgZWZmZWN0LiBTY2hlbWEvdGVuYW50XG4gICAqIGNoZWNrcyBhbmQgcm91dGluZSBjb25uZWN0aW9uIGluaXRpYWxpemF0aW9uIGRlbGliZXJhdGVseSBuZXZlciBydW4gdGhpczpcbiAgICogdGhleSBzdGF5IHJlYWQtb25seSByZWdhcmRpbmcgcXVldWVkIGpvYiByb3dzLCBiZWNhdXNlIHRoZSBicm9hZFxuICAgKiBhZG9wdGlvbi9yZWxlYXNlIFVQREFURXMgZGVhZGxvY2sgYWdhaW5zdCBhY3RpdmUgam9iIHByb2Nlc3NlcyB1bmRlclxuICAgKiBjb25jdXJyZW50IHRlbmFudCBpbml0aWFsaXphdGlvbi4gU2VyaWFsaXplZCBhY3Jvc3MgcHJvY2Vzc2VzIHdpdGggYVxuICAgKiBkYXRhYmFzZSBhZHZpc29yeSBsb2NrIHNvIGNvbmN1cnJlbnRseSBzdGFydGVkIG1haW5zIGNhbm5vdCBpbnRlcmxlYXZlIHRoZVxuICAgKiBVUERBVEVzOyB0aGUgcGVyLWluc3RhbmNlIG1lbW8gb25seSBza2lwcyByZXBlYXQgd29yayB3aXRoaW4gdGhpcyBwcm9jZXNzLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyB3aGVuIHJlY29uY2lsZWQuXG4gICAqL1xuICBhc3luYyByZWNvbmNpbGVRdWV1ZUNvbmN1cnJlbmN5KCkge1xuICAgIGlmICh0aGlzLl9xdWV1ZUNvbmN1cnJlbmN5UmVjb25jaWxlZCkgcmV0dXJuXG5cbiAgICBjb25zdCBkYXRhYmFzZUlkZW50aWZpZXIgPSB0aGlzLmdldERhdGFiYXNlSWRlbnRpZmllcigpXG4gICAgY29uc3Qgc3RhcnRlZEF0TXMgPSBEYXRlLm5vdygpXG5cbiAgICBhd2FpdCB0aGlzLmxvZ2dlci5pbmZvKCgpID0+IFtcbiAgICAgIFwiU3RhcnRpbmcgYmFja2dyb3VuZCBqb2JzIHF1ZXVlLWNvbmN1cnJlbmN5IHN0YXJ0dXAgcmVjb25jaWxpYXRpb25cIixcbiAgICAgIHtkYXRhYmFzZUlkZW50aWZpZXJ9XG4gICAgXSlcbiAgICBhd2FpdCB0aGlzLmVuc3VyZVJlYWR5KClcblxuICAgIGF3YWl0IHRoaXMuX3dpdGhEYihhc3luYyAoZGIpID0+IHtcbiAgICAgIGNvbnN0IGFjcXVpcmVkID0gYXdhaXQgZGIuYWNxdWlyZUFkdmlzb3J5TG9jayhDT05DVVJSRU5DWV9SRUNPTkNJTElBVElPTl9MT0NLKVxuXG4gICAgICBpZiAoIWFjcXVpcmVkKSB0aHJvdyBuZXcgRXJyb3IoXCJGYWlsZWQgdG8gYWNxdWlyZSBiYWNrZ3JvdW5kIGpvYiBxdWV1ZS1jb25jdXJyZW5jeSByZWNvbmNpbGUgbG9ja1wiKVxuXG4gICAgICB0cnkge1xuICAgICAgICBhd2FpdCB0aGlzLl9yZWNvbmNpbGVRdWV1ZUNvbmN1cnJlbmN5KGRiKVxuICAgICAgICBhd2FpdCB0aGlzLl9yZWNvbmNpbGVDb25jdXJyZW5jeShkYilcblxuICAgICAgICAvLyBMYXRjaCB0aGUgbWVtbyBvbmx5IGFmdGVyIEJPVEggc3RlcHMgc3VjY2VlZDogaWYgdGhlIGNvdW50IHJlYnVpbGRcbiAgICAgICAgLy8gZmFpbHMgYWZ0ZXIgYWRvcHRpb24sIGEgcmV0cnkgb24gdGhpcyBzdG9yZSBtdXN0IHJlLWVudGVyIGFuZCByZXBhaXJcbiAgICAgICAgLy8gdGhlIGNvdW50cyAoYWRvcHRpb24gaXRzZWxmIGlzIGlkZW1wb3RlbnQpLlxuICAgICAgICB0aGlzLl9xdWV1ZUNvbmN1cnJlbmN5UmVjb25jaWxlZCA9IHRydWVcbiAgICAgIH0gZmluYWxseSB7XG4gICAgICAgIGF3YWl0IGRiLnJlbGVhc2VBZHZpc29yeUxvY2soQ09OQ1VSUkVOQ1lfUkVDT05DSUxJQVRJT05fTE9DSylcbiAgICAgIH1cbiAgICB9KVxuXG4gICAgYXdhaXQgdGhpcy5sb2dnZXIuaW5mbygoKSA9PiBbXG4gICAgICBcIkNvbXBsZXRlZCBiYWNrZ3JvdW5kIGpvYnMgcXVldWUtY29uY3VycmVuY3kgc3RhcnR1cCByZWNvbmNpbGlhdGlvblwiLFxuICAgICAge2RhdGFiYXNlSWRlbnRpZmllciwgZHVyYXRpb25NczogRGF0ZS5ub3coKSAtIHN0YXJ0ZWRBdE1zfVxuICAgIF0pXG4gIH1cblxuICAvKipcbiAgICogUmVwYWlycyBkdXJhYmxlIGFjdGl2ZS1jb3VudCBkcmlmdCB3aGlsZSBhIG1haW4gcHJvY2VzcyByZW1haW5zIGxpdmUuIFRoZVxuICAgKiBpbml0aWFsIHNuYXBzaG90IGlzIHJlYWQtb25seTsgb25seSBzdXNwZWN0ZWQgbWlzbWF0Y2hlcyB0YWtlIHRoZWlyXG4gICAqIGNvdW50ZXIgbG9jayBhbmQgcmUtY291bnQgaW5zaWRlIHRoZSBzZXJpYWxpemVkIHRyYW5zYWN0aW9uIHBhdGguXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPGltcG9ydChcIi4vdHlwZXMuanNcIikuQmFja2dyb3VuZEpvYkNvbmN1cnJlbmN5UmVjb25jaWxpYXRpb24+fSAtIFJlcGFpciBzdW1tYXJ5LlxuICAgKi9cbiAgYXN5bmMgcmVjb25jaWxlQWN0aXZlQ29uY3VycmVuY3koKSB7XG4gICAgY29uc3QgZGF0YWJhc2VJZGVudGlmaWVyID0gdGhpcy5nZXREYXRhYmFzZUlkZW50aWZpZXIoKVxuICAgIGNvbnN0IHN0YXJ0ZWRBdE1zID0gRGF0ZS5ub3coKVxuXG4gICAgYXdhaXQgdGhpcy5lbnN1cmVSZWFkeSgpXG5cbiAgICBjb25zdCByZXN1bHQgPSBhd2FpdCB0aGlzLl9zZXJpYWxpemVkQ29ubmVjdGlvbk11dGF0aW9uKFxuICAgICAgYXN5bmMgKGRiKSA9PiBhd2FpdCB0aGlzLl9yZWNvbmNpbGVDb25jdXJyZW5jeShkYiksXG4gICAgICB7XG4gICAgICAgIGFkdmlzb3J5TG9jazoge1xuICAgICAgICAgIGZhaWx1cmVNZXNzYWdlOiBcIkZhaWxlZCB0byBhY3F1aXJlIGJhY2tncm91bmQgam9iIGFjdGl2ZS1jb25jdXJyZW5jeSByZWNvbmNpbGUgbG9ja1wiLFxuICAgICAgICAgIG5hbWU6IENPTkNVUlJFTkNZX1JFQ09OQ0lMSUFUSU9OX0xPQ0tcbiAgICAgICAgfVxuICAgICAgfVxuICAgIClcblxuICAgIGlmIChyZXN1bHQucmVwYWlyZWRDb3VudCA+IDApIHtcbiAgICAgIGF3YWl0IHRoaXMubG9nZ2VyLndhcm4oKCkgPT4gW1xuICAgICAgICBcIlJlcGFpcmVkIGJhY2tncm91bmQgam9icyBhY3RpdmUtY29uY3VycmVuY3kgY291bnQgZHJpZnRcIixcbiAgICAgICAge1xuICAgICAgICAgIGRhdGFiYXNlSWRlbnRpZmllcixcbiAgICAgICAgICBkdXJhdGlvbk1zOiBEYXRlLm5vdygpIC0gc3RhcnRlZEF0TXMsXG4gICAgICAgICAgcmVwYWlyZWRDb3VudDogcmVzdWx0LnJlcGFpcmVkQ291bnQsXG4gICAgICAgICAgcmVwYWlyczogcmVzdWx0LnJlcGFpcnMsXG4gICAgICAgICAgcmVwYWlyc1RydW5jYXRlZENvdW50OiByZXN1bHQucmVwYWlyc1RydW5jYXRlZENvdW50XG4gICAgICAgIH1cbiAgICAgIF0pXG4gICAgfVxuXG4gICAgcmV0dXJuIHJlc3VsdFxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZW5xdWV1ZS5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBPcHRpb25zLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gYXJncy5qb2JOYW1lIC0gSm9iIG5hbWUuXG4gICAqIEBwYXJhbSB7QXJyYXk8UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSBhcmdzLmFyZ3MgLSBBcmd1bWVudHMuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi90eXBlcy5qc1wiKS5CYWNrZ3JvdW5kSm9iT3B0aW9uc30gW2FyZ3Mub3B0aW9uc10gLSBPcHRpb25zLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxzdHJpbmc+fSAtIEpvYiBpZC5cbiAgICovXG4gIGFzeW5jIGVucXVldWUoe2pvYk5hbWUsIGFyZ3MsIG9wdGlvbnN9KSB7XG4gICAgYXdhaXQgdGhpcy5lbnN1cmVSZWFkeSgpXG5cbiAgICBjb25zdCBwcmVwYXJlZEpvYiA9IHRoaXMuX3ByZXBhcmVKb2Ioe2pvYk5hbWUsIGFyZ3MsIG9wdGlvbnN9KVxuXG4gICAgaWYgKG9wdGlvbnM/LmlkZW1wb3RlbmN5S2V5ICE9PSB1bmRlZmluZWQpIHtcbiAgICAgIHJldHVybiBhd2FpdCB0aGlzLl9lbnF1ZXVlSWRlbXBvdGVudGx5KHthcmdzOiBhcmdzIHx8IFtdLCBvcHRpb25zLCBwcmVwYXJlZEpvYn0pXG4gICAgfVxuXG4gICAgLyoqIEB0eXBlIHtzdHJpbmd9ICovXG4gICAgbGV0IHJlc3VsdEpvYklkID0gcHJlcGFyZWRKb2Iuam9iSWRcblxuICAgIGF3YWl0IHRoaXMuX3NlcmlhbGl6ZWRDb3VudE11dGF0aW9uKGFzeW5jIChkYikgPT4ge1xuICAgICAgaWYgKG9wdGlvbnM/LmRlZHVwbGljYXRlV2hpbGVRdWV1ZWQpIHtcbiAgICAgICAgY29uc3QgZHVwbGljYXRlSm9iSWQgPSBhd2FpdCB0aGlzLl9kZWR1cGxpY2F0ZWRRdWV1ZWRKb2JJZChkYiwgcHJlcGFyZWRKb2IpXG5cbiAgICAgICAgaWYgKGR1cGxpY2F0ZUpvYklkKSB7XG4gICAgICAgICAgcmVzdWx0Sm9iSWQgPSBkdXBsaWNhdGVKb2JJZFxuICAgICAgICAgIHJldHVyblxuICAgICAgICB9XG4gICAgICB9XG5cbiAgICAgIGF3YWl0IHRoaXMuX2luc2VydFByZXBhcmVkSm9iKGRiLCB7cHJlcGFyZWRKb2IsIHNjaGVkdWxlS2V5OiBudWxsfSlcbiAgICAgIGF3YWl0IHRoaXMuX3JlY29yZENvdW50RGVsdGEoZGIsIHthbGw6IDEsIHF1ZXVlZDogMX0pXG4gICAgfSlcblxuICAgIHJldHVybiByZXN1bHRKb2JJZFxuICB9XG5cbiAgLyoqXG4gICAqIEF0b21pY2FsbHkgdmFsaWRhdGVzIGFuIGV4YWN0IHByb2R1Y2luZyBoYW5kb2ZmIGFuZCBlbnF1ZXVlcyBpdHMgZm9sbG93LXVwLlxuICAgKiBFdmVyeSBleGFjdCByZXF1ZXN0IG93bnMgYW4gaW50ZXJuYWwgZHVyYWJsZSByZXBsYXkgaWRlbnRpdHksIHdoaWxlIHF1ZXVlZFxuICAgKiBkZWR1cGxpY2F0aW9uIGNhbiBwb2ludCBzZXZlcmFsIGRpc3RpbmN0IHByb2R1Y2VyIGV2ZW50cyBhdCBvbmUgY292ZXJpbmcgcm93LlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIE93bmVkIGVucXVldWUgcmVxdWVzdC5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGFyZ3Muam9iTmFtZSAtIEpvYiBuYW1lLlxuICAgKiBAcGFyYW0ge0FycmF5PFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gYXJncy5hcmdzIC0gQXJndW1lbnRzLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vdHlwZXMuanNcIikuQmFja2dyb3VuZEpvYk9wdGlvbnN9IFthcmdzLm9wdGlvbnNdIC0gT3B0aW9ucy5cbiAgICogQHBhcmFtIHtzdHJpbmd9IFthcmdzLnByb2R1Y2VySW52b2NhdGlvbklkXSAtIFN0YWJsZSBpZGVudGl0eSBmb3Igb25lIG93bmVkIGVucXVldWUgaW52b2NhdGlvbi5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL3R5cGVzLmpzXCIpLkJhY2tncm91bmRKb2JQcm9kdWNlclByb29mfSBhcmdzLnByb2R1Y2VyUHJvb2YgLSBFeGFjdCBwcm9kdWNlciBsZWFzZS5cbiAgICogQHJldHVybnMge1Byb21pc2U8c3RyaW5nPn0gLSBEdXJhYmxlIGZvbGxvdy11cCBpZC5cbiAgICovXG4gIGFzeW5jIGVucXVldWVGcm9tT3duZWRIYW5kb2ZmKHtqb2JOYW1lLCBhcmdzLCBvcHRpb25zLCBwcm9kdWNlckludm9jYXRpb25JZCwgcHJvZHVjZXJQcm9vZn0pIHtcbiAgICBhd2FpdCB0aGlzLmVuc3VyZVJlYWR5KClcblxuICAgIGNvbnN0IG5vcm1hbGl6ZWRQcm9kdWNlclByb29mID0gdGhpcy5fbm9ybWFsaXplUHJvZHVjZXJQcm9vZihwcm9kdWNlclByb29mKVxuICAgIGNvbnN0IG5vcm1hbGl6ZWRQcm9kdWNlckludm9jYXRpb25JZCA9IHRoaXMuX25vcm1hbGl6ZVByb2R1Y2VySW52b2NhdGlvbklkKHByb2R1Y2VySW52b2NhdGlvbklkKVxuICAgIGNvbnN0IHByZXBhcmVkSm9iID0gdGhpcy5fcHJlcGFyZUpvYih7am9iTmFtZSwgYXJncywgb3B0aW9uc30pXG5cbiAgICByZXR1cm4gYXdhaXQgdGhpcy5fc2VyaWFsaXplZENvdW50TXV0YXRpb24oYXN5bmMgKGRiKSA9PiB7XG4gICAgICBhd2FpdCB0aGlzLl92YWxpZGF0ZU93bmVkUHJvZHVjZXJQcm9vZihkYiwgbm9ybWFsaXplZFByb2R1Y2VyUHJvb2YpXG4gICAgICBpZiAodGhpcy5hZnRlck93bmVkUHJvZHVjZXJWYWxpZGF0aW9uKSBhd2FpdCB0aGlzLmFmdGVyT3duZWRQcm9kdWNlclZhbGlkYXRpb24obm9ybWFsaXplZFByb2R1Y2VyUHJvb2YpXG5cbiAgICAgIGlmIChvcHRpb25zPy5pZGVtcG90ZW5jeUtleSAhPT0gdW5kZWZpbmVkKSB7XG4gICAgICAgIHJldHVybiBhd2FpdCB0aGlzLl9lbnF1ZXVlSWRlbXBvdGVudGx5SW5UcmFuc2FjdGlvbih7XG4gICAgICAgICAgYXJnczogYXJncyB8fCBbXSxcbiAgICAgICAgICBjb3VudFJldmlzaW9uTG9ja2VkOiB0cnVlLFxuICAgICAgICAgIGRiLFxuICAgICAgICAgIG9wdGlvbnMsXG4gICAgICAgICAgcHJlcGFyZWRKb2JcbiAgICAgICAgfSlcbiAgICAgIH1cblxuICAgICAgcmV0dXJuIGF3YWl0IHRoaXMuX2VucXVldWVPd25lZFJlcGxheUluVHJhbnNhY3Rpb24oe1xuICAgICAgICBkYixcbiAgICAgICAgb3B0aW9uczogb3B0aW9ucyB8fCB7fSxcbiAgICAgICAgcHJlcGFyZWRKb2IsXG4gICAgICAgIHByb2R1Y2VySW52b2NhdGlvbklkOiBub3JtYWxpemVkUHJvZHVjZXJJbnZvY2F0aW9uSWQsXG4gICAgICAgIHByb2R1Y2VyUHJvb2Y6IG5vcm1hbGl6ZWRQcm9kdWNlclByb29mXG4gICAgICB9KVxuICAgIH0pXG4gIH1cblxuICAvKipcbiAgICogRmluZHMgdGhlIGVhcmxpZXN0IHF1ZXVlZCBqb2IgdGhhdCBjb3ZlcnMgdGhpcyBlbnF1ZXVlJ3MgaWRlbnRpdHkgYW5kIHRpbWUuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vZGF0YWJhc2UvZHJpdmVycy9iYXNlLmpzXCIpLmRlZmF1bHR9IGRiIC0gVHJhbnNhY3Rpb24gY29ubmVjdGlvbi5cbiAgICogQHBhcmFtIHtQcmVwYXJlZEJhY2tncm91bmRKb2J9IHByZXBhcmVkSm9iIC0gTm9ybWFsaXplZCBqb2IuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHN0cmluZyB8IG51bGw+fSAtIENvdmVyaW5nIGpvYiBpZC5cbiAgICovXG4gIGFzeW5jIF9kZWR1cGxpY2F0ZWRRdWV1ZWRKb2JJZChkYiwgcHJlcGFyZWRKb2IpIHtcbiAgICAvLyBEZWR1cGUgb24gdGhlIGpvYidzIGlkZW50aXR5IChuYW1lICsgYXJncyArIHF1ZXVlKSwgTk9UIGl0cyBjb25jdXJyZW5jeSBrZXksIHNvIGEgam9iXG4gICAgLy8ga2VlcHMgd2hhdGV2ZXIgY29uY3VycmVuY3kgaXQgcmVzb2x2ZXMgdG8uIE9ubHkgYW4gZXhpc3Rpbmcgam9iIHNjaGVkdWxlZCBubyBsYXRlciB0aGFuXG4gICAgLy8gdGhpcyBlbnF1ZXVlIGNhbiBjb3ZlciBpdDsgYSByZXRyeSBiYWNrZWQgb2ZmIGludG8gdGhlIGZ1dHVyZSBtdXN0IG5vdCBzdXBwcmVzcyBlYXJsaWVyXG4gICAgLy8gd29yay4gT3JkZXJpbmcgcmV0dXJucyB0aGUgZWFybGllc3QgY292ZXJpbmcgam9iIHdoZW4gc2V2ZXJhbCBxdWV1ZWQgcm93cyBhbHJlYWR5IGV4aXN0LlxuICAgIGNvbnN0IGV4aXN0aW5nID0gYXdhaXQgZGJcbiAgICAgIC5uZXdRdWVyeSgpXG4gICAgICAuZnJvbShKT0JTX1RBQkxFKVxuICAgICAgLnNlbGVjdChcImlkXCIpXG4gICAgICAud2hlcmUoe3N0YXR1czogXCJxdWV1ZWRcIiwgam9iX25hbWU6IHByZXBhcmVkSm9iLmpvYk5hbWUsIGFyZ3NfanNvbjogcHJlcGFyZWRKb2IuYXJnc0pzb24sIHF1ZXVlOiBwcmVwYXJlZEpvYi5xdWV1ZX0pXG4gICAgICAud2hlcmUoYHNjaGVkdWxlZF9hdF9tcyA8PSAke2RiLnF1b3RlKHByZXBhcmVkSm9iLnNjaGVkdWxlZEF0TXMpfWApXG4gICAgICAub3JkZXIoXCJzY2hlZHVsZWRfYXRfbXMgQVNDXCIpXG4gICAgICAubGltaXQoMSlcbiAgICAgIC5yZXN1bHRzKClcbiAgICBjb25zdCByb3cgPSBleGlzdGluZ1swXVxuXG4gICAgcmV0dXJuIHJvdyA/IFN0cmluZygvKiogQHR5cGUge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gKi8gKHJvdykuaWQpIDogbnVsbFxuICB9XG5cbiAgLyoqXG4gICAqIFBlcnNpc3RzIG9uZSBpbnRlcm5hbCBleGFjdC1yZXBsYXkgb3duZXIgYW5kIGl0cyBxdWV1ZWQgam9iIGluIHRoZSBjYWxsZXInc1xuICAgKiBwcm9kdWNlci12YWxpZGF0aW9uIHRyYW5zYWN0aW9uLlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIFRyYW5zYWN0aW9uIGlucHV0LlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL2RhdGFiYXNlL2RyaXZlcnMvYmFzZS5qc1wiKS5kZWZhdWx0fSBhcmdzLmRiIC0gVHJhbnNhY3Rpb24gY29ubmVjdGlvbi5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL3R5cGVzLmpzXCIpLkJhY2tncm91bmRKb2JPcHRpb25zfSBhcmdzLm9wdGlvbnMgLSBFbnF1ZXVlIG9wdGlvbnMuXG4gICAqIEBwYXJhbSB7UHJlcGFyZWRCYWNrZ3JvdW5kSm9ifSBhcmdzLnByZXBhcmVkSm9iIC0gTm9ybWFsaXplZCBqb2IuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBhcmdzLnByb2R1Y2VySW52b2NhdGlvbklkIC0gU3RhYmxlIGlkZW50aXR5IGZvciBvbmUgb3duZWQgZW5xdWV1ZSBpbnZvY2F0aW9uLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vdHlwZXMuanNcIikuQmFja2dyb3VuZEpvYlByb2R1Y2VyUHJvb2Z9IGFyZ3MucHJvZHVjZXJQcm9vZiAtIEV4YWN0IHByb2R1Y2VyIGxlYXNlLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxzdHJpbmc+fSAtIFN0YWJsZSByZXBsYXkgam9iIGlkLlxuICAgKi9cbiAgYXN5bmMgX2VucXVldWVPd25lZFJlcGxheUluVHJhbnNhY3Rpb24oe2RiLCBvcHRpb25zLCBwcmVwYXJlZEpvYiwgcHJvZHVjZXJJbnZvY2F0aW9uSWQsIHByb2R1Y2VyUHJvb2Z9KSB7XG4gICAgY29uc3QgcmVxdWVzdERpZ2VzdCA9IHRoaXMuX293bmVkRW5xdWV1ZVJlcXVlc3REaWdlc3Qoe29wdGlvbnMsIHByZXBhcmVkSm9ifSlcbiAgICBjb25zdCBzY29wZURpZ2VzdCA9IHRoaXMuX293bmVkRW5xdWV1ZVNjb3BlRGlnZXN0KHtwcmVwYXJlZEpvYiwgcHJvZHVjZXJJbnZvY2F0aW9uSWQsIHByb2R1Y2VyUHJvb2YsIHJlcXVlc3REaWdlc3R9KVxuICAgIGNvbnN0IGlkZW1wb3RlbmN5S2V5ID0gYG93bmVkLWhhbmRvZmY6JHtzY29wZURpZ2VzdH1gXG4gICAgY29uc3QgZXhpc3RpbmcgPSBhd2FpdCB0aGlzLl9pZGVtcG90ZW5jeU93bmVyc2hpcChkYiwgc2NvcGVEaWdlc3QpXG4gICAgY29uc3QgYmFzZU93bmVyc2hpcCA9IHtcbiAgICAgIGNyZWF0ZWRfYXRfbXM6IHByZXBhcmVkSm9iLmNyZWF0ZWRBdE1zLFxuICAgICAgaWRlbXBvdGVuY3lfa2V5OiBpZGVtcG90ZW5jeUtleSxcbiAgICAgIGpvYl9uYW1lOiBwcmVwYXJlZEpvYi5qb2JOYW1lLFxuICAgICAgcXVldWU6IHByZXBhcmVkSm9iLnF1ZXVlLFxuICAgICAgcmVxdWVzdF9kaWdlc3Q6IHJlcXVlc3REaWdlc3QsXG4gICAgICBzY29wZV9kaWdlc3Q6IHNjb3BlRGlnZXN0XG4gICAgfVxuXG4gICAgaWYgKGV4aXN0aW5nKSB7XG4gICAgICB0aGlzLl92YWxpZGF0ZUlkZW1wb3RlbmN5T3duZXJzaGlwKHtleGlzdGluZywgb3duZXJzaGlwOiB7Li4uYmFzZU93bmVyc2hpcCwgam9iX2lkOiBTdHJpbmcoZXhpc3Rpbmcuam9iX2lkKX19KVxuICAgICAgcmV0dXJuIFN0cmluZyhleGlzdGluZy5qb2JfaWQpXG4gICAgfVxuXG4gICAgY29uc3QgZHVwbGljYXRlSm9iSWQgPSBvcHRpb25zLmRlZHVwbGljYXRlV2hpbGVRdWV1ZWRcbiAgICAgID8gYXdhaXQgdGhpcy5fZGVkdXBsaWNhdGVkUXVldWVkSm9iSWQoZGIsIHByZXBhcmVkSm9iKVxuICAgICAgOiBudWxsXG4gICAgY29uc3Qgb3duZXJzaGlwID0gey4uLmJhc2VPd25lcnNoaXAsIGpvYl9pZDogZHVwbGljYXRlSm9iSWQgfHwgcHJlcGFyZWRKb2Iuam9iSWR9XG4gICAgY29uc3QgY2xhaW1lZCA9IGF3YWl0IHRoaXMuX2NsYWltSWRlbXBvdGVuY3lPd25lcnNoaXAoZGIsIG93bmVyc2hpcClcblxuICAgIGlmICghY2xhaW1lZC5jcmVhdGVkKSB7XG4gICAgICB0aGlzLl92YWxpZGF0ZUlkZW1wb3RlbmN5T3duZXJzaGlwKHtleGlzdGluZzogY2xhaW1lZC5yb3csIG93bmVyc2hpcH0pXG4gICAgICByZXR1cm4gU3RyaW5nKGNsYWltZWQucm93LmpvYl9pZClcbiAgICB9XG4gICAgaWYgKGR1cGxpY2F0ZUpvYklkKSByZXR1cm4gZHVwbGljYXRlSm9iSWRcblxuICAgIGF3YWl0IHRoaXMuX2luc2VydFByZXBhcmVkSm9iKGRiLCB7cHJlcGFyZWRKb2IsIHNjaGVkdWxlS2V5OiBudWxsfSlcbiAgICBhd2FpdCB0aGlzLl9yZWNvcmRDb3VudERlbHRhKGRiLCB7YWxsOiAxLCBxdWV1ZWQ6IDF9KVxuXG4gICAgcmV0dXJuIHByZXBhcmVkSm9iLmpvYklkXG4gIH1cblxuICAvKipcbiAgICogQXRvbWljYWxseSBvd25zIG9uZSBkdXJhYmxlIGlkZW1wb3RlbmN5IHNjb3BlIGFuZCBjcmVhdGVzIGl0cyBqb2IgZXhhY3RseSBvbmNlLlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIEVucXVldWUgaW5wdXQuXG4gICAqIEBwYXJhbSB7QXJyYXk8UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSBhcmdzLmFyZ3MgLSBKb2IgYXJndW1lbnRzLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vdHlwZXMuanNcIikuQmFja2dyb3VuZEpvYk9wdGlvbnN9IGFyZ3Mub3B0aW9ucyAtIEpvYiBvcHRpb25zLlxuICAgKiBAcGFyYW0ge1ByZXBhcmVkQmFja2dyb3VuZEpvYn0gYXJncy5wcmVwYXJlZEpvYiAtIE5vcm1hbGl6ZWQgam9iLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxzdHJpbmc+fSAtIFN0YWJsZSBvcmlnaW5hbCBqb2IgaWQuXG4gICAqL1xuICBhc3luYyBfZW5xdWV1ZUlkZW1wb3RlbnRseSh7YXJncywgb3B0aW9ucywgcHJlcGFyZWRKb2J9KSB7XG4gICAgLy8gUmV1c2Ugb3JkaW5hcnkgZW5xdWV1ZSB0cmFuc2FjdGlvbiBhZG1pc3Npb24gYmVjYXVzZSB0aGlzIHBhdGggY2hhbmdlc1xuICAgIC8vIHRoZSBzYW1lIGR1cmFibGUgY291bnQgcmV2aXNpb24uIFRoZSBzY29wZSBwcmltYXJ5IGtleSByZW1haW5zIHRoZVxuICAgIC8vIGNyb3NzLXByb2Nlc3MgY29udmVyZ2VuY2Ugb3duZXIuXG4gICAgcmV0dXJuIGF3YWl0IHRoaXMuX2lkZW1wb3RlbnRFbnF1ZXVlVHJhbnNhY3Rpb24oYXN5bmMgKGRiKSA9PiB7XG4gICAgICByZXR1cm4gYXdhaXQgdGhpcy5fZW5xdWV1ZUlkZW1wb3RlbnRseUluVHJhbnNhY3Rpb24oe2FyZ3MsIGRiLCBvcHRpb25zLCBwcmVwYXJlZEpvYn0pXG4gICAgfSlcbiAgfVxuXG4gIC8qKlxuICAgKiBPd25zIG9yIHJlcGxheXMgb25lIHB1YmxpYyBpZGVtcG90ZW5jeSBrZXkgaW5zaWRlIHRoZSBjYWxsZXIncyB0cmFuc2FjdGlvbi5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBUcmFuc2FjdGlvbiBpbnB1dC5cbiAgICogQHBhcmFtIHtBcnJheTxSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59IGFyZ3MuYXJncyAtIEpvYiBhcmd1bWVudHMuXG4gICAqIEBwYXJhbSB7Ym9vbGVhbn0gW2FyZ3MuY291bnRSZXZpc2lvbkxvY2tlZF0gLSBXaGV0aGVyIHRoZSBjYWxsZXIgYWxyZWFkeSBvd25zIGNvdW50IHNlcmlhbGl6YXRpb24uXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vZGF0YWJhc2UvZHJpdmVycy9iYXNlLmpzXCIpLmRlZmF1bHR9IGFyZ3MuZGIgLSBUcmFuc2FjdGlvbiBjb25uZWN0aW9uLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vdHlwZXMuanNcIikuQmFja2dyb3VuZEpvYk9wdGlvbnN9IGFyZ3Mub3B0aW9ucyAtIEpvYiBvcHRpb25zLlxuICAgKiBAcGFyYW0ge1ByZXBhcmVkQmFja2dyb3VuZEpvYn0gYXJncy5wcmVwYXJlZEpvYiAtIE5vcm1hbGl6ZWQgam9iLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxzdHJpbmc+fSAtIFN0YWJsZSBvcmlnaW5hbCBqb2IgaWQuXG4gICAqL1xuICBhc3luYyBfZW5xdWV1ZUlkZW1wb3RlbnRseUluVHJhbnNhY3Rpb24oe2FyZ3MsIGNvdW50UmV2aXNpb25Mb2NrZWQgPSBmYWxzZSwgZGIsIG9wdGlvbnMsIHByZXBhcmVkSm9ifSkge1xuICAgIGNvbnN0IGlkZW1wb3RlbmN5S2V5ID0gdGhpcy5fbm9ybWFsaXplSWRlbXBvdGVuY3lLZXkob3B0aW9ucy5pZGVtcG90ZW5jeUtleSlcbiAgICBjb25zdCBzY29wZURpZ2VzdCA9IHRoaXMuX2lkZW1wb3RlbmN5U2NvcGVEaWdlc3Qoe2lkZW1wb3RlbmN5S2V5LCBqb2JOYW1lOiBwcmVwYXJlZEpvYi5qb2JOYW1lLCBxdWV1ZTogcHJlcGFyZWRKb2IucXVldWV9KVxuICAgIGNvbnN0IHJlcXVlc3REaWdlc3QgPSB0aGlzLl9pZGVtcG90ZW5jeVJlcXVlc3REaWdlc3Qoe2FyZ3MsIG9wdGlvbnMsIHByZXBhcmVkSm9ifSlcbiAgICBjb25zdCBvd25lcnNoaXAgPSB7XG4gICAgICBjcmVhdGVkX2F0X21zOiBwcmVwYXJlZEpvYi5jcmVhdGVkQXRNcyxcbiAgICAgIGlkZW1wb3RlbmN5X2tleTogaWRlbXBvdGVuY3lLZXksXG4gICAgICBqb2JfaWQ6IHByZXBhcmVkSm9iLmpvYklkLFxuICAgICAgam9iX25hbWU6IHByZXBhcmVkSm9iLmpvYk5hbWUsXG4gICAgICBxdWV1ZTogcHJlcGFyZWRKb2IucXVldWUsXG4gICAgICByZXF1ZXN0X2RpZ2VzdDogcmVxdWVzdERpZ2VzdCxcbiAgICAgIHNjb3BlX2RpZ2VzdDogc2NvcGVEaWdlc3RcbiAgICB9XG4gICAgY29uc3QgbWFpbE9wZXJhdGlvbklucHV0ID0gbWFpbERlbGl2ZXJ5T3BlcmF0aW9uRm9ySm9iKHByZXBhcmVkSm9iLmpvYk5hbWUsIGFyZ3MpXG5cbiAgICBpZiAobWFpbE9wZXJhdGlvbklucHV0ICYmIG1haWxPcGVyYXRpb25JbnB1dC5vcGVyYXRpb24uaWQgIT09IGlkZW1wb3RlbmN5S2V5KSB7XG4gICAgICB0aHJvdyBWZWxvY2lvdXNFcnJvci5zYWZlKFwiTWFpbCBkZWxpdmVyeSBvcGVyYXRpb24gaWQgbXVzdCBlcXVhbCBpdHMgYmFja2dyb3VuZCBqb2IgaWRlbXBvdGVuY3kga2V5LlwiLCB7XG4gICAgICAgIGNvZGU6IFwibWFpbC1kZWxpdmVyeS1pZGVtcG90ZW5jeS1rZXktbWlzbWF0Y2hcIlxuICAgICAgfSlcbiAgICB9XG5cbiAgICBjb25zdCBleGlzdGluZyA9IGF3YWl0IHRoaXMuX2lkZW1wb3RlbmN5T3duZXJzaGlwKGRiLCBzY29wZURpZ2VzdClcblxuICAgIGlmIChleGlzdGluZykge1xuICAgICAgdGhpcy5fdmFsaWRhdGVJZGVtcG90ZW5jeU93bmVyc2hpcCh7ZXhpc3RpbmcsIG93bmVyc2hpcH0pXG4gICAgICBhd2FpdCB0aGlzLl92YWxpZGF0ZU1haWxEZWxpdmVyeU9wZXJhdGlvbihkYiwge2pvYklkOiBTdHJpbmcoZXhpc3Rpbmcuam9iX2lkKSwgbWFpbE9wZXJhdGlvbklucHV0fSlcbiAgICAgIHJldHVybiBTdHJpbmcoZXhpc3Rpbmcuam9iX2lkKVxuICAgIH1cblxuICAgIGNvbnN0IGNsYWltZWQgPSBhd2FpdCB0aGlzLl9jbGFpbUlkZW1wb3RlbmN5T3duZXJzaGlwKGRiLCBvd25lcnNoaXApXG5cbiAgICBpZiAoIWNsYWltZWQuY3JlYXRlZCkge1xuICAgICAgdGhpcy5fdmFsaWRhdGVJZGVtcG90ZW5jeU93bmVyc2hpcCh7ZXhpc3Rpbmc6IGNsYWltZWQucm93LCBvd25lcnNoaXB9KVxuICAgICAgYXdhaXQgdGhpcy5fdmFsaWRhdGVNYWlsRGVsaXZlcnlPcGVyYXRpb24oZGIsIHtqb2JJZDogU3RyaW5nKGNsYWltZWQucm93LmpvYl9pZCksIG1haWxPcGVyYXRpb25JbnB1dH0pXG4gICAgICByZXR1cm4gU3RyaW5nKGNsYWltZWQucm93LmpvYl9pZClcbiAgICB9XG5cbiAgICBpZiAoIWNvdW50UmV2aXNpb25Mb2NrZWQpIGF3YWl0IHRoaXMuX2xvY2tDb3VudFJldmlzaW9uKGRiKVxuICAgIGF3YWl0IHRoaXMuX2luc2VydFByZXBhcmVkSm9iKGRiLCB7cHJlcGFyZWRKb2IsIHNjaGVkdWxlS2V5OiBudWxsfSlcbiAgICBhd2FpdCB0aGlzLl9wZXJzaXN0TWFpbERlbGl2ZXJ5T3BlcmF0aW9uKGRiLCB7am9iSWQ6IHByZXBhcmVkSm9iLmpvYklkLCBtYWlsT3BlcmF0aW9uSW5wdXQsIGNyZWF0ZWRBdE1zOiBwcmVwYXJlZEpvYi5jcmVhdGVkQXRNc30pXG4gICAgYXdhaXQgdGhpcy5fcmVjb3JkQ291bnREZWx0YShkYiwge2FsbDogMSwgcXVldWVkOiAxfSlcblxuICAgIHJldHVybiBwcmVwYXJlZEpvYi5qb2JJZFxuICB9XG5cbiAgLyoqXG4gICAqIFNlcmlhbGl6ZXMgb25lIHBoeXNpY2FsIGNvbm5lY3Rpb24gbG9jYWxseSB3aXRob3V0IHRha2luZyBvd25lcnNoaXAgYXdheVxuICAgKiBmcm9tIHRoZSBkYXRhYmFzZSB1bmlxdWVuZXNzIGNvbnN0cmFpbnQgc2hhcmVkIGJ5IGFsbCBwcm9jZXNzZXMuXG4gICAqIEB0ZW1wbGF0ZSBUXG4gICAqIEBwYXJhbSB7KGRiOiBpbXBvcnQoXCIuLi9kYXRhYmFzZS9kcml2ZXJzL2Jhc2UuanNcIikuZGVmYXVsdCkgPT4gUHJvbWlzZTxUPn0gY2FsbGJhY2sgLSBUcmFuc2FjdGlvbiB3b3JrLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxUPn0gLSBDYWxsYmFjayByZXN1bHQuXG4gICAqL1xuICBhc3luYyBfaWRlbXBvdGVudEVucXVldWVUcmFuc2FjdGlvbihjYWxsYmFjaykge1xuICAgIHJldHVybiBhd2FpdCB0aGlzLl9zZXJpYWxpemVkVHJhbnNhY3Rpb25NdXRhdGlvbihjYWxsYmFjaylcbiAgfVxuXG4gIC8qKlxuICAgKiBJbnNlcnRzIGFuIG93bmVyc2hpcCByb3csIHJlc29sdmluZyBvbmx5IGEgZGF0YWJhc2UgdW5pcXVlbmVzcyByYWNlLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL2RhdGFiYXNlL2RyaXZlcnMvYmFzZS5qc1wiKS5kZWZhdWx0fSBkYiAtIFRyYW5zYWN0aW9uIGNvbm5lY3Rpb24uXG4gICAqIEBwYXJhbSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSBvd25lcnNoaXAgLSBPd25lcnNoaXAgcm93LlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx7Y3JlYXRlZDogYm9vbGVhbiwgcm93OiBSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59Pn0gLSBDbGFpbSByZXN1bHQuXG4gICAqL1xuICBhc3luYyBfY2xhaW1JZGVtcG90ZW5jeU93bmVyc2hpcChkYiwgb3duZXJzaGlwKSB7XG4gICAgdHJ5IHtcbiAgICAgIC8vIFRoZSBzYXZlcG9pbnQga2VlcHMgUG9zdGdyZVNRTCdzIG91dGVyIHRyYW5zYWN0aW9uIHVzYWJsZSBhZnRlciBhXG4gICAgICAvLyBjb25jdXJyZW50IHVuaXF1ZS1rZXkgbG9zcy4gVGhlIHVuaXF1ZSBwcmltYXJ5IGtleSwgbm90IGEgcHJvY2Vzc1xuICAgICAgLy8gbXV0ZXgsIGlzIHRoZSBjcm9zcy1wcm9jZXNzIGNvbnZlcmdlbmNlIGF1dGhvcml0eS5cbiAgICAgIGF3YWl0IGRiLnRyYW5zYWN0aW9uKGFzeW5jICgpID0+IHtcbiAgICAgICAgYXdhaXQgZGIuaW5zZXJ0KHt0YWJsZU5hbWU6IElERU1QT1RFTkNZX0tFWVNfVEFCTEUsIGRhdGE6IG93bmVyc2hpcH0pXG4gICAgICB9KVxuXG4gICAgICByZXR1cm4ge2NyZWF0ZWQ6IHRydWUsIHJvdzogb3duZXJzaGlwfVxuICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICBjb25zdCByYWNlZCA9IGF3YWl0IHRoaXMuX2lkZW1wb3RlbmN5T3duZXJzaGlwKGRiLCBTdHJpbmcob3duZXJzaGlwLnNjb3BlX2RpZ2VzdCkpXG5cbiAgICAgIGlmICghcmFjZWQpIHRocm93IGVycm9yXG4gICAgICByZXR1cm4ge2NyZWF0ZWQ6IGZhbHNlLCByb3c6IHJhY2VkfVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBMb2FkcyBvbmUgZHVyYWJsZSBlbnF1ZXVlIG93bmVyLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL2RhdGFiYXNlL2RyaXZlcnMvYmFzZS5qc1wiKS5kZWZhdWx0fSBkYiAtIERhdGFiYXNlIGNvbm5lY3Rpb24uXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBzY29wZURpZ2VzdCAtIEZpeGVkLXNpemUgc2NvcGUgZGlnZXN0LlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj4gfCBudWxsPn0gLSBSb3cgb3IgbnVsbC5cbiAgICovXG4gIGFzeW5jIF9pZGVtcG90ZW5jeU93bmVyc2hpcChkYiwgc2NvcGVEaWdlc3QpIHtcbiAgICBjb25zdCByb3dzID0gYXdhaXQgZGIubmV3UXVlcnkoKS5mcm9tKElERU1QT1RFTkNZX0tFWVNfVEFCTEUpLndoZXJlKHtzY29wZV9kaWdlc3Q6IHNjb3BlRGlnZXN0fSkubGltaXQoMSkucmVzdWx0cygpXG5cbiAgICByZXR1cm4gcm93c1swXSA/IC8qKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSAqLyAocm93c1swXSkgOiBudWxsXG4gIH1cblxuICAvKipcbiAgICogRmFpbHMgY2xvc2VkIHdoZW4gYSBkdXJhYmxlIGtleSBpcyByZXVzZWQgZm9yIGEgZGlmZmVyZW50IGNhbm9uaWNhbCByZXF1ZXN0LlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIFZhbGlkYXRpb24gaW5wdXQuXG4gICAqIEBwYXJhbSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSBhcmdzLmV4aXN0aW5nIC0gU3RvcmVkIG93bmVyLlxuICAgKiBAcGFyYW0ge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gYXJncy5vd25lcnNoaXAgLSBSZXF1ZXN0ZWQgb3duZXIuXG4gICAqIEByZXR1cm5zIHt2b2lkfVxuICAgKi9cbiAgX3ZhbGlkYXRlSWRlbXBvdGVuY3lPd25lcnNoaXAoe2V4aXN0aW5nLCBvd25lcnNoaXB9KSB7XG4gICAgY29uc3QgZXhhY3RTY29wZSA9IFN0cmluZyhleGlzdGluZy5qb2JfbmFtZSkgPT09IG93bmVyc2hpcC5qb2JfbmFtZVxuICAgICAgJiYgU3RyaW5nKGV4aXN0aW5nLnF1ZXVlKSA9PT0gb3duZXJzaGlwLnF1ZXVlXG4gICAgICAmJiBTdHJpbmcoZXhpc3RpbmcuaWRlbXBvdGVuY3lfa2V5KSA9PT0gb3duZXJzaGlwLmlkZW1wb3RlbmN5X2tleVxuXG4gICAgaWYgKCFleGFjdFNjb3BlIHx8IFN0cmluZyhleGlzdGluZy5yZXF1ZXN0X2RpZ2VzdCkgIT09IG93bmVyc2hpcC5yZXF1ZXN0X2RpZ2VzdCkge1xuICAgICAgdGhyb3cgVmVsb2Npb3VzRXJyb3Iuc2FmZShcIlRoZSBiYWNrZ3JvdW5kIGpvYiBpZGVtcG90ZW5jeSBrZXkgd2FzIGFscmVhZHkgdXNlZCBmb3IgYSBkaWZmZXJlbnQgcmVxdWVzdC5cIiwge1xuICAgICAgICBjb2RlOiBcImJhY2tncm91bmQtam9iLWlkZW1wb3RlbmN5LWNvbmZsaWN0XCJcbiAgICAgIH0pXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIFBlcnNpc3RzIHRoZSBidWlsdC1pbiBtYWlsIG9wZXJhdGlvbiBpbiB0aGUgc2FtZSBmaXJzdC1lbnF1ZXVlIHRyYW5zYWN0aW9uLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL2RhdGFiYXNlL2RyaXZlcnMvYmFzZS5qc1wiKS5kZWZhdWx0fSBkYiAtIFRyYW5zYWN0aW9uIGNvbm5lY3Rpb24uXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gT3BlcmF0aW9uIGlucHV0LlxuICAgKiBAcGFyYW0ge251bWJlcn0gYXJncy5jcmVhdGVkQXRNcyAtIENyZWF0aW9uIHRpbWVzdGFtcC5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGFyZ3Muam9iSWQgLSBOYXRpdmUgam9iIGlkLlxuICAgKiBAcGFyYW0ge3tvcGVyYXRpb246IGltcG9ydChcIi4uL21haWxlci9pbmRleC5qc1wiKS5NYWlsZXJEZWxpdmVyeU9wZXJhdGlvbiwgcGF5bG9hZDogaW1wb3J0KFwiLi4vbWFpbGVyL2luZGV4LmpzXCIpLk1haWxlckRlbGl2ZXJ5UGF5bG9hZH0gfCBudWxsfSBhcmdzLm1haWxPcGVyYXRpb25JbnB1dCAtIE1haWwgb3BlcmF0aW9uLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyBhZnRlciBwZXJzaXN0ZW5jZS5cbiAgICovXG4gIGFzeW5jIF9wZXJzaXN0TWFpbERlbGl2ZXJ5T3BlcmF0aW9uKGRiLCB7Y3JlYXRlZEF0TXMsIGpvYklkLCBtYWlsT3BlcmF0aW9uSW5wdXR9KSB7XG4gICAgaWYgKCFtYWlsT3BlcmF0aW9uSW5wdXQpIHJldHVyblxuICAgIGNvbnN0IHtvcGVyYXRpb259ID0gbWFpbE9wZXJhdGlvbklucHV0XG4gICAgY29uc3Qgb3BlcmF0aW9uS2V5ID0gbWFpbERlbGl2ZXJ5T3BlcmF0aW9uS2V5KG9wZXJhdGlvbi5pZClcbiAgICBjb25zdCByb3cgPSB7XG4gICAgICBiYWNrZ3JvdW5kX2pvYl9pZDogam9iSWQsXG4gICAgICBjcmVhdGVkX2F0X21zOiBjcmVhdGVkQXRNcyxcbiAgICAgIGZpcnN0X2F0dGVtcHRfc3RhcnRlZF9hdF9tczogbnVsbCxcbiAgICAgIG9wZXJhdGlvbl9pZDogb3BlcmF0aW9uLmlkLFxuICAgICAgb3BlcmF0aW9uX2tleTogb3BlcmF0aW9uS2V5LFxuICAgICAgcGF5bG9hZF9kaWdlc3Q6IG9wZXJhdGlvbi5wYXlsb2FkRGlnZXN0LFxuICAgICAgcHJvdmlkZXJfa2luZDogb3BlcmF0aW9uLnByb3ZpZGVyS2luZCxcbiAgICAgIHByb3ZpZGVyX3JldGVudGlvbl9tczogb3BlcmF0aW9uLnByb3ZpZGVyUmV0ZW50aW9uTXNcbiAgICB9XG5cbiAgICB0cnkge1xuICAgICAgYXdhaXQgZGIudHJhbnNhY3Rpb24oYXN5bmMgKCkgPT4ge1xuICAgICAgICBhd2FpdCBkYi5pbnNlcnQoe3RhYmxlTmFtZTogTUFJTF9ERUxJVkVSWV9PUEVSQVRJT05TX1RBQkxFLCBkYXRhOiByb3d9KVxuICAgICAgfSlcbiAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgY29uc3QgZXhpc3RpbmcgPSBhd2FpdCB0aGlzLl9tYWlsRGVsaXZlcnlPcGVyYXRpb24oZGIsIG9wZXJhdGlvbktleSlcblxuICAgICAgaWYgKCFleGlzdGluZykgdGhyb3cgZXJyb3JcbiAgICAgIHRoaXMuX3ZhbGlkYXRlTWFpbERlbGl2ZXJ5T3BlcmF0aW9uUm93KHtleGlzdGluZywgcmVxdWVzdGVkOiByb3d9KVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBWYWxpZGF0ZXMgdGhlIGR1cmFibGUgbWFpbCByb3cgZHVyaW5nIGFuIGV4YWN0IGdlbmVyaWMgZW5xdWV1ZSByZXBsYXkuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vZGF0YWJhc2UvZHJpdmVycy9iYXNlLmpzXCIpLmRlZmF1bHR9IGRiIC0gRGF0YWJhc2UgY29ubmVjdGlvbi5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBWYWxpZGF0aW9uIGlucHV0LlxuICAgKiBAcGFyYW0ge3N0cmluZ30gYXJncy5qb2JJZCAtIE93bmVkIGpvYiBpZC5cbiAgICogQHBhcmFtIHt7b3BlcmF0aW9uOiBpbXBvcnQoXCIuLi9tYWlsZXIvaW5kZXguanNcIikuTWFpbGVyRGVsaXZlcnlPcGVyYXRpb24sIHBheWxvYWQ6IGltcG9ydChcIi4uL21haWxlci9pbmRleC5qc1wiKS5NYWlsZXJEZWxpdmVyeVBheWxvYWR9IHwgbnVsbH0gYXJncy5tYWlsT3BlcmF0aW9uSW5wdXQgLSBNYWlsIG9wZXJhdGlvbi5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgd2hlbiBleGFjdC5cbiAgICovXG4gIGFzeW5jIF92YWxpZGF0ZU1haWxEZWxpdmVyeU9wZXJhdGlvbihkYiwge2pvYklkLCBtYWlsT3BlcmF0aW9uSW5wdXR9KSB7XG4gICAgaWYgKCFtYWlsT3BlcmF0aW9uSW5wdXQpIHJldHVyblxuICAgIGNvbnN0IHtvcGVyYXRpb259ID0gbWFpbE9wZXJhdGlvbklucHV0XG4gICAgY29uc3QgZXhpc3RpbmcgPSBhd2FpdCB0aGlzLl9tYWlsRGVsaXZlcnlPcGVyYXRpb24oZGIsIG1haWxEZWxpdmVyeU9wZXJhdGlvbktleShvcGVyYXRpb24uaWQpKVxuXG4gICAgaWYgKCFleGlzdGluZykge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKFwiQmFja2dyb3VuZCBqb2IgaWRlbXBvdGVuY3kgb3duZXJzaGlwIGlzIG1pc3NpbmcgaXRzIGR1cmFibGUgbWFpbCBkZWxpdmVyeSBvcGVyYXRpb25cIilcbiAgICB9XG5cbiAgICB0aGlzLl92YWxpZGF0ZU1haWxEZWxpdmVyeU9wZXJhdGlvblJvdyh7XG4gICAgICBleGlzdGluZyxcbiAgICAgIHJlcXVlc3RlZDoge1xuICAgICAgICBiYWNrZ3JvdW5kX2pvYl9pZDogam9iSWQsXG4gICAgICAgIG9wZXJhdGlvbl9pZDogb3BlcmF0aW9uLmlkLFxuICAgICAgICBwYXlsb2FkX2RpZ2VzdDogb3BlcmF0aW9uLnBheWxvYWREaWdlc3QsXG4gICAgICAgIHByb3ZpZGVyX2tpbmQ6IG9wZXJhdGlvbi5wcm92aWRlcktpbmQsXG4gICAgICAgIHByb3ZpZGVyX3JldGVudGlvbl9tczogb3BlcmF0aW9uLnByb3ZpZGVyUmV0ZW50aW9uTXNcbiAgICAgIH1cbiAgICB9KVxuICB9XG5cbiAgLyoqXG4gICAqIExvYWRzIGEgZHVyYWJsZSBtYWlsIG9wZXJhdGlvbi5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9kYXRhYmFzZS9kcml2ZXJzL2Jhc2UuanNcIikuZGVmYXVsdH0gZGIgLSBEYXRhYmFzZSBjb25uZWN0aW9uLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gb3BlcmF0aW9uS2V5IC0gRml4ZWQtc2l6ZSBvcGVyYXRpb24ga2V5LlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj4gfCBudWxsPn0gLSBSb3cgb3IgbnVsbC5cbiAgICovXG4gIGFzeW5jIF9tYWlsRGVsaXZlcnlPcGVyYXRpb24oZGIsIG9wZXJhdGlvbktleSkge1xuICAgIGNvbnN0IHJvd3MgPSBhd2FpdCBkYi5uZXdRdWVyeSgpLmZyb20oTUFJTF9ERUxJVkVSWV9PUEVSQVRJT05TX1RBQkxFKS53aGVyZSh7b3BlcmF0aW9uX2tleTogb3BlcmF0aW9uS2V5fSkubGltaXQoMSkucmVzdWx0cygpXG5cbiAgICByZXR1cm4gcm93c1swXSA/IC8qKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSAqLyAocm93c1swXSkgOiBudWxsXG4gIH1cblxuICAvKipcbiAgICogQ29tcGFyZXMgcHJvdmlkZXItcmVsZXZhbnQgZHVyYWJsZSBtYWlsIG9wZXJhdGlvbiBmaWVsZHMuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gVmFsaWRhdGlvbiBpbnB1dC5cbiAgICogQHBhcmFtIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59IGFyZ3MuZXhpc3RpbmcgLSBTdG9yZWQgcm93LlxuICAgKiBAcGFyYW0ge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gYXJncy5yZXF1ZXN0ZWQgLSBSZXF1ZXN0ZWQgcm93LlxuICAgKiBAcmV0dXJucyB7dm9pZH1cbiAgICovXG4gIF92YWxpZGF0ZU1haWxEZWxpdmVyeU9wZXJhdGlvblJvdyh7ZXhpc3RpbmcsIHJlcXVlc3RlZH0pIHtcbiAgICBjb25zdCBtYXRjaGVzID0gU3RyaW5nKGV4aXN0aW5nLm9wZXJhdGlvbl9pZCkgPT09IHJlcXVlc3RlZC5vcGVyYXRpb25faWRcbiAgICAgICYmIFN0cmluZyhleGlzdGluZy5wYXlsb2FkX2RpZ2VzdCkgPT09IHJlcXVlc3RlZC5wYXlsb2FkX2RpZ2VzdFxuICAgICAgJiYgU3RyaW5nKGV4aXN0aW5nLmJhY2tncm91bmRfam9iX2lkKSA9PT0gcmVxdWVzdGVkLmJhY2tncm91bmRfam9iX2lkXG4gICAgICAmJiBTdHJpbmcoZXhpc3RpbmcucHJvdmlkZXJfa2luZCkgPT09IHJlcXVlc3RlZC5wcm92aWRlcl9raW5kXG4gICAgICAmJiB0aGlzLl9ub3JtYWxpemVOdW1iZXIoZXhpc3RpbmcucHJvdmlkZXJfcmV0ZW50aW9uX21zKSA9PT0gcmVxdWVzdGVkLnByb3ZpZGVyX3JldGVudGlvbl9tc1xuXG4gICAgaWYgKCFtYXRjaGVzKSB7XG4gICAgICB0aHJvdyBWZWxvY2lvdXNFcnJvci5zYWZlKFwiVGhlIG1haWwgZGVsaXZlcnkgb3BlcmF0aW9uIHdhcyBhbHJlYWR5IHVzZWQgZm9yIGEgZGlmZmVyZW50IHBheWxvYWQgb3IgcHJvdmlkZXIuXCIsIHtcbiAgICAgICAgY29kZTogXCJtYWlsLWRlbGl2ZXJ5LWlkZW1wb3RlbmN5LWNvbmZsaWN0XCJcbiAgICAgIH0pXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIENhbm9uaWNhbCByZXF1ZXN0IGRpZ2VzdCBleGNsdWRpbmcgZ2VuZXJhdGVkIGlkcyBhbmQgaW1tZWRpYXRlIGVucXVldWUgdGltZS5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBEaWdlc3QgaW5wdXQuXG4gICAqIEBwYXJhbSB7QXJyYXk8UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSBhcmdzLmFyZ3MgLSBKb2IgYXJndW1lbnRzLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vdHlwZXMuanNcIikuQmFja2dyb3VuZEpvYk9wdGlvbnN9IGFyZ3Mub3B0aW9ucyAtIEpvYiBvcHRpb25zLlxuICAgKiBAcGFyYW0ge1ByZXBhcmVkQmFja2dyb3VuZEpvYn0gYXJncy5wcmVwYXJlZEpvYiAtIE5vcm1hbGl6ZWQgam9iLlxuICAgKiBAcmV0dXJucyB7c3RyaW5nfSAtIFNIQS0yNTYgZGlnZXN0LlxuICAgKi9cbiAgX2lkZW1wb3RlbmN5UmVxdWVzdERpZ2VzdCh7YXJncywgb3B0aW9ucywgcHJlcGFyZWRKb2J9KSB7XG4gICAgY29uc3Qgc2VyaWFsaXplZCA9IHN0YWJsZUpzb25TdHJpbmdpZnkoe1xuICAgICAgYXJncyxcbiAgICAgIGNvbmN1cnJlbmN5OiBwcmVwYXJlZEpvYi5jb25jdXJyZW5jeSxcbiAgICAgIGV4ZWN1dGlvbk1vZGU6IHByZXBhcmVkSm9iLmV4ZWN1dGlvbk1vZGUsXG4gICAgICBmb3JtYXQ6IFwidmVsb2Npb3VzLWJhY2tncm91bmQtam9iLWlkZW1wb3RlbmN5LXYxXCIsXG4gICAgICBqb2JOYW1lOiBwcmVwYXJlZEpvYi5qb2JOYW1lLFxuICAgICAgbWF4UmV0cmllczogcHJlcGFyZWRKb2IubWF4UmV0cmllcyxcbiAgICAgIHF1ZXVlOiBwcmVwYXJlZEpvYi5xdWV1ZSxcbiAgICAgIHNjaGVkdWxlZEF0TXM6IG9wdGlvbnMuc2NoZWR1bGVkQXRNcyA9PT0gdW5kZWZpbmVkID8gbnVsbCA6IHByZXBhcmVkSm9iLnNjaGVkdWxlZEF0TXMsXG4gICAgICBzY2hlZHVsaW5nOiBvcHRpb25zLnNjaGVkdWxlZEF0TXMgPT09IHVuZGVmaW5lZCA/IFwiaW1tZWRpYXRlXCIgOiBcInNjaGVkdWxlZFwiLFxuICAgICAgLi4uKHByZXBhcmVkSm9iLnRpbWVvdXRNcyA9PT0gbnVsbCA/IHt9IDoge3RpbWVvdXRNczogcHJlcGFyZWRKb2IudGltZW91dE1zfSlcbiAgICB9KVxuXG4gICAgcmV0dXJuIGNyZWF0ZUhhc2goXCJzaGEyNTZcIikudXBkYXRlKHNlcmlhbGl6ZWQpLmRpZ2VzdChcImhleFwiKVxuICB9XG5cbiAgLyoqXG4gICAqIEZpeGVkLXNpemUgZ2xvYmFsbHkgaW5kZXhlZCByZXByZXNlbnRhdGlvbiBvZiB0aGUgZG9jdW1lbnRlZCBzY29wZSB0dXBsZS5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBTY29wZSBpbnB1dC5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGFyZ3MuaWRlbXBvdGVuY3lLZXkgLSBDYWxsZXIga2V5LlxuICAgKiBAcGFyYW0ge3N0cmluZ30gYXJncy5qb2JOYW1lIC0gSm9iIGNsYXNzIG5hbWUuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBhcmdzLnF1ZXVlIC0gUXVldWUgbmFtZS5cbiAgICogQHJldHVybnMge3N0cmluZ30gLSBTSEEtMjU2IHNjb3BlIGRpZ2VzdC5cbiAgICovXG4gIF9pZGVtcG90ZW5jeVNjb3BlRGlnZXN0KHtpZGVtcG90ZW5jeUtleSwgam9iTmFtZSwgcXVldWV9KSB7XG4gICAgcmV0dXJuIGNyZWF0ZUhhc2goXCJzaGEyNTZcIilcbiAgICAgIC51cGRhdGUoc3RhYmxlSnNvblN0cmluZ2lmeSh7Zm9ybWF0OiBcInZlbG9jaW91cy1iYWNrZ3JvdW5kLWpvYi1pZGVtcG90ZW5jeS1zY29wZS12MVwiLCBpZGVtcG90ZW5jeUtleSwgam9iTmFtZSwgcXVldWV9KSlcbiAgICAgIC5kaWdlc3QoXCJoZXhcIilcbiAgfVxuXG4gIC8qKlxuICAgKiBWYWxpZGF0ZXMgb25lIGNhbGxlciBrZXkuXG4gICAqIEBwYXJhbSB7c3RyaW5nIHwgdW5kZWZpbmVkfSBpZGVtcG90ZW5jeUtleSAtIENhbGxlciBrZXkuXG4gICAqIEByZXR1cm5zIHtzdHJpbmd9IC0gVmFsaWQga2V5LlxuICAgKi9cbiAgX25vcm1hbGl6ZUlkZW1wb3RlbmN5S2V5KGlkZW1wb3RlbmN5S2V5KSB7XG4gICAgaWYgKHR5cGVvZiBpZGVtcG90ZW5jeUtleSAhPT0gXCJzdHJpbmdcIiB8fCBpZGVtcG90ZW5jeUtleS5sZW5ndGggPT09IDApIHtcbiAgICAgIHRocm93IFZlbG9jaW91c0Vycm9yLnNhZmUoXCJCYWNrZ3JvdW5kIGpvYiBpZGVtcG90ZW5jeUtleSBtdXN0IGJlIGEgbm9uLWVtcHR5IHN0cmluZy5cIiwge1xuICAgICAgICBjb2RlOiBcImJhY2tncm91bmQtam9iLWlkZW1wb3RlbmN5LWtleS1pbnZhbGlkXCJcbiAgICAgIH0pXG4gICAgfVxuXG4gICAgcmV0dXJuIGlkZW1wb3RlbmN5S2V5XG4gIH1cblxuICAvKipcbiAgICogQ2Fub25pY2FsIHJlcXVlc3QgaWRlbnRpdHkgZm9yIGFuIGludGVybmFsIG93bmVkLWhhbmRvZmYgcmVwbGF5LlxuICAgKiBJbW1lZGlhdGUgZW5xdWV1ZSB3YWxsIHRpbWUgYW5kIGdlbmVyYXRlZCBqb2IgaWRzIHJlbWFpbiBleGNsdWRlZC5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBEaWdlc3QgaW5wdXQuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi90eXBlcy5qc1wiKS5CYWNrZ3JvdW5kSm9iT3B0aW9uc30gYXJncy5vcHRpb25zIC0gRW5xdWV1ZSBvcHRpb25zLlxuICAgKiBAcGFyYW0ge1ByZXBhcmVkQmFja2dyb3VuZEpvYn0gYXJncy5wcmVwYXJlZEpvYiAtIE5vcm1hbGl6ZWQgam9iLlxuICAgKiBAcmV0dXJucyB7c3RyaW5nfSAtIFNIQS0yNTYgZGlnZXN0LlxuICAgKi9cbiAgX293bmVkRW5xdWV1ZVJlcXVlc3REaWdlc3Qoe29wdGlvbnMsIHByZXBhcmVkSm9ifSkge1xuICAgIGNvbnN0IHNlcmlhbGl6ZWQgPSBzdGFibGVKc29uU3RyaW5naWZ5KHtcbiAgICAgIGFyZ3NKc29uOiBwcmVwYXJlZEpvYi5hcmdzSnNvbixcbiAgICAgIGNvbmN1cnJlbmN5OiBwcmVwYXJlZEpvYi5jb25jdXJyZW5jeSxcbiAgICAgIGRlZHVwbGljYXRlV2hpbGVRdWV1ZWQ6IG9wdGlvbnMuZGVkdXBsaWNhdGVXaGlsZVF1ZXVlZCA9PT0gdHJ1ZSxcbiAgICAgIGV4ZWN1dGlvbk1vZGU6IHByZXBhcmVkSm9iLmV4ZWN1dGlvbk1vZGUsXG4gICAgICBmb3JtYXQ6IFwidmVsb2Npb3VzLWJhY2tncm91bmQtam9iLW93bmVkLWVucXVldWUtdjFcIixcbiAgICAgIGpvYk5hbWU6IHByZXBhcmVkSm9iLmpvYk5hbWUsXG4gICAgICBtYXhSZXRyaWVzOiBwcmVwYXJlZEpvYi5tYXhSZXRyaWVzLFxuICAgICAgcXVldWU6IHByZXBhcmVkSm9iLnF1ZXVlLFxuICAgICAgc2NoZWR1bGVkQXRNczogb3B0aW9ucy5zY2hlZHVsZWRBdE1zID09PSB1bmRlZmluZWQgPyBudWxsIDogcHJlcGFyZWRKb2Iuc2NoZWR1bGVkQXRNcyxcbiAgICAgIHNjaGVkdWxpbmc6IG9wdGlvbnMuc2NoZWR1bGVkQXRNcyA9PT0gdW5kZWZpbmVkID8gXCJpbW1lZGlhdGVcIiA6IFwic2NoZWR1bGVkXCIsXG4gICAgICAuLi4ocHJlcGFyZWRKb2IudGltZW91dE1zID09PSBudWxsID8ge30gOiB7dGltZW91dE1zOiBwcmVwYXJlZEpvYi50aW1lb3V0TXN9KVxuICAgIH0pXG5cbiAgICByZXR1cm4gY3JlYXRlSGFzaChcInNoYTI1NlwiKS51cGRhdGUoc2VyaWFsaXplZCkuZGlnZXN0KFwiaGV4XCIpXG4gIH1cblxuICAvKipcbiAgICogSXNvbGF0ZXMgaW50ZXJuYWwgcHJvZHVjZXIgcmVwbGF5IG93bmVyc2hpcCBmcm9tIGNhbGxlciBpZGVtcG90ZW5jeSBzY29wZXMuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gU2NvcGUgaW5wdXQuXG4gICAqIEBwYXJhbSB7UHJlcGFyZWRCYWNrZ3JvdW5kSm9ifSBhcmdzLnByZXBhcmVkSm9iIC0gTm9ybWFsaXplZCBqb2IuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBhcmdzLnByb2R1Y2VySW52b2NhdGlvbklkIC0gU3RhYmxlIGlkZW50aXR5IGZvciBvbmUgb3duZWQgZW5xdWV1ZSBpbnZvY2F0aW9uLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vdHlwZXMuanNcIikuQmFja2dyb3VuZEpvYlByb2R1Y2VyUHJvb2Z9IGFyZ3MucHJvZHVjZXJQcm9vZiAtIEV4YWN0IHByb2R1Y2VyIGxlYXNlLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gYXJncy5yZXF1ZXN0RGlnZXN0IC0gQ2Fub25pY2FsIHJlcXVlc3QgZGlnZXN0LlxuICAgKiBAcmV0dXJucyB7c3RyaW5nfSAtIFNIQS0yNTYgc2NvcGUgZGlnZXN0LlxuICAgKi9cbiAgX293bmVkRW5xdWV1ZVNjb3BlRGlnZXN0KHtwcmVwYXJlZEpvYiwgcHJvZHVjZXJJbnZvY2F0aW9uSWQsIHByb2R1Y2VyUHJvb2YsIHJlcXVlc3REaWdlc3R9KSB7XG4gICAgcmV0dXJuIGNyZWF0ZUhhc2goXCJzaGEyNTZcIilcbiAgICAgIC51cGRhdGUoc3RhYmxlSnNvblN0cmluZ2lmeSh7XG4gICAgICAgIGZvcm1hdDogXCJ2ZWxvY2lvdXMtYmFja2dyb3VuZC1qb2Itb3duZWQtZW5xdWV1ZS1zY29wZS12MVwiLFxuICAgICAgICBqb2JOYW1lOiBwcmVwYXJlZEpvYi5qb2JOYW1lLFxuICAgICAgICBwcm9kdWNlckludm9jYXRpb25JZCxcbiAgICAgICAgcHJvZHVjZXJQcm9vZixcbiAgICAgICAgcXVldWU6IHByZXBhcmVkSm9iLnF1ZXVlLFxuICAgICAgICByZXF1ZXN0RGlnZXN0XG4gICAgICB9KSlcbiAgICAgIC5kaWdlc3QoXCJoZXhcIilcbiAgfVxuXG4gIC8qKlxuICAgKiBWYWxpZGF0ZXMgdGhlIHVudHJ1c3RlZCBpZGVudGl0eSBvZiBvbmUgcHJvZHVjZXItb3duZWQgZW5xdWV1ZSBpbnZvY2F0aW9uLlxuICAgKiBAcGFyYW0ge3N0cmluZyB8IHVuZGVmaW5lZH0gcHJvZHVjZXJJbnZvY2F0aW9uSWQgLSBQcm9kdWNlciBpbnZvY2F0aW9uIGlkZW50aXR5LlxuICAgKiBAcmV0dXJucyB7c3RyaW5nfSAtIFZhbGlkYXRlZCBpZGVudGl0eS5cbiAgICovXG4gIF9ub3JtYWxpemVQcm9kdWNlckludm9jYXRpb25JZChwcm9kdWNlckludm9jYXRpb25JZCkge1xuICAgIGlmICh0eXBlb2YgcHJvZHVjZXJJbnZvY2F0aW9uSWQgIT09IFwic3RyaW5nXCIgfHwgcHJvZHVjZXJJbnZvY2F0aW9uSWQubGVuZ3RoID09PSAwKSB7XG4gICAgICB0aHJvdyBWZWxvY2lvdXNFcnJvci5zYWZlKFwiQmFja2dyb3VuZCBqb2IgcHJvZHVjZXIgaW52b2NhdGlvbiBpZCBpcyBpbnZhbGlkLlwiLCB7XG4gICAgICAgIGNvZGU6IFwiYmFja2dyb3VuZC1qb2ItcHJvZHVjZXItaW52b2NhdGlvbi1pZC1pbnZhbGlkXCJcbiAgICAgIH0pXG4gICAgfVxuXG4gICAgcmV0dXJuIHByb2R1Y2VySW52b2NhdGlvbklkXG4gIH1cblxuICAvKipcbiAgICogVmFsaWRhdGVzIHRoZSB1bnRydXN0ZWQgdHJhbnNwb3J0IHNoYXBlIGJlZm9yZSB0cmFuc2FjdGlvbiBhZG1pc3Npb24uXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi90eXBlcy5qc1wiKS5CYWNrZ3JvdW5kSm9iUHJvZHVjZXJQcm9vZn0gcHJvZHVjZXJQcm9vZiAtIFByb2R1Y2VyIHByb29mLlxuICAgKiBAcmV0dXJucyB7aW1wb3J0KFwiLi90eXBlcy5qc1wiKS5CYWNrZ3JvdW5kSm9iUHJvZHVjZXJQcm9vZn0gLSBOb3JtYWxpemVkIGltbXV0YWJsZSBwcm9vZi5cbiAgICovXG4gIF9ub3JtYWxpemVQcm9kdWNlclByb29mKHByb2R1Y2VyUHJvb2YpIHtcbiAgICBjb25zdCBleGFjdEtleXMgPSBbXCJoYW5kZWRPZmZBdE1zXCIsIFwiaGFuZG9mZklkXCIsIFwiam9iSWRcIiwgXCJ3b3JrZXJJZFwiXVxuICAgIGNvbnN0IGtleXMgPSBwcm9kdWNlclByb29mICYmIHR5cGVvZiBwcm9kdWNlclByb29mID09PSBcIm9iamVjdFwiID8gT2JqZWN0LmtleXMocHJvZHVjZXJQcm9vZikgOiBbXVxuICAgIGNvbnN0IHZhbGlkID0gcHJvZHVjZXJQcm9vZlxuICAgICAgJiYgdHlwZW9mIHByb2R1Y2VyUHJvb2YgPT09IFwib2JqZWN0XCJcbiAgICAgICYmIGtleXMubGVuZ3RoID09PSBleGFjdEtleXMubGVuZ3RoXG4gICAgICAmJiBrZXlzLmV2ZXJ5KChrZXkpID0+IGV4YWN0S2V5cy5pbmNsdWRlcyhrZXkpKVxuICAgICAgJiYgdHlwZW9mIHByb2R1Y2VyUHJvb2Yuam9iSWQgPT09IFwic3RyaW5nXCJcbiAgICAgICYmIHByb2R1Y2VyUHJvb2Yuam9iSWQubGVuZ3RoID4gMFxuICAgICAgJiYgdHlwZW9mIHByb2R1Y2VyUHJvb2YuaGFuZG9mZklkID09PSBcInN0cmluZ1wiXG4gICAgICAmJiBwcm9kdWNlclByb29mLmhhbmRvZmZJZC5sZW5ndGggPiAwXG4gICAgICAmJiB0eXBlb2YgcHJvZHVjZXJQcm9vZi53b3JrZXJJZCA9PT0gXCJzdHJpbmdcIlxuICAgICAgJiYgcHJvZHVjZXJQcm9vZi53b3JrZXJJZC5sZW5ndGggPiAwXG4gICAgICAmJiBOdW1iZXIuaXNTYWZlSW50ZWdlcihwcm9kdWNlclByb29mLmhhbmRlZE9mZkF0TXMpXG4gICAgICAmJiBwcm9kdWNlclByb29mLmhhbmRlZE9mZkF0TXMgPj0gMFxuXG4gICAgaWYgKCF2YWxpZCkge1xuICAgICAgdGhyb3cgVmVsb2Npb3VzRXJyb3Iuc2FmZShcIkJhY2tncm91bmQgam9iIHByb2R1Y2VyIHByb29mIGlzIGludmFsaWQuXCIsIHtcbiAgICAgICAgY29kZTogXCJiYWNrZ3JvdW5kLWpvYi1wcm9kdWNlci1wcm9vZi1pbnZhbGlkXCJcbiAgICAgIH0pXG4gICAgfVxuXG4gICAgcmV0dXJuIE9iamVjdC5mcmVlemUoe1xuICAgICAgaGFuZGVkT2ZmQXRNczogcHJvZHVjZXJQcm9vZi5oYW5kZWRPZmZBdE1zLFxuICAgICAgaGFuZG9mZklkOiBwcm9kdWNlclByb29mLmhhbmRvZmZJZCxcbiAgICAgIGpvYklkOiBwcm9kdWNlclByb29mLmpvYklkLFxuICAgICAgd29ya2VySWQ6IHByb2R1Y2VyUHJvb2Yud29ya2VySWRcbiAgICB9KVxuICB9XG5cbiAgLyoqXG4gICAqIENvbmZpcm1zIGV4YWN0IGFjdGl2ZSBvd25lcnNoaXAgd2hpbGUgdGhlIGVucXVldWUgdHJhbnNhY3Rpb24gaG9sZHMgdGhlXG4gICAqIHNoYXJlZCBtdXRhdGlvbiBmZW5jZSB1c2VkIGJ5IHRlcm1pbmFsIHByb2R1Y2VyIHRyYW5zaXRpb25zLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL2RhdGFiYXNlL2RyaXZlcnMvYmFzZS5qc1wiKS5kZWZhdWx0fSBkYiAtIFRyYW5zYWN0aW9uIGNvbm5lY3Rpb24uXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi90eXBlcy5qc1wiKS5CYWNrZ3JvdW5kSm9iUHJvZHVjZXJQcm9vZn0gcHJvZHVjZXJQcm9vZiAtIEV4YWN0IHByb2R1Y2VyIGxlYXNlLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyB3aGlsZSBvd25lcnNoaXAgcmVtYWlucyBleGFjdC5cbiAgICovXG4gIGFzeW5jIF92YWxpZGF0ZU93bmVkUHJvZHVjZXJQcm9vZihkYiwgcHJvZHVjZXJQcm9vZikge1xuICAgIGNvbnN0IHByb2R1Y2VyID0gYXdhaXQgdGhpcy5fZ2V0Sm9iUm93QnlJZChkYiwgcHJvZHVjZXJQcm9vZi5qb2JJZClcbiAgICBjb25zdCBvd25lZCA9IHByb2R1Y2VyXG4gICAgICAmJiBwcm9kdWNlci5zdGF0dXMgPT09IFwiaGFuZGVkX29mZlwiXG4gICAgICAmJiBwcm9kdWNlci5oYW5kb2ZmSWQgPT09IHByb2R1Y2VyUHJvb2YuaGFuZG9mZklkXG4gICAgICAmJiBwcm9kdWNlci53b3JrZXJJZCA9PT0gcHJvZHVjZXJQcm9vZi53b3JrZXJJZFxuICAgICAgJiYgcHJvZHVjZXIuaGFuZGVkT2ZmQXRNcyA9PT0gcHJvZHVjZXJQcm9vZi5oYW5kZWRPZmZBdE1zXG5cbiAgICBpZiAoIW93bmVkKSB7XG4gICAgICB0aHJvdyBWZWxvY2lvdXNFcnJvci5zYWZlKFwiQmFja2dyb3VuZCBqb2IgcHJvZHVjZXIgaGFuZG9mZiBpcyBubyBsb25nZXIgb3duZWQuXCIsIHtcbiAgICAgICAgY29kZTogXCJiYWNrZ3JvdW5kLWpvYi1wcm9kdWNlci1oYW5kb2ZmLW5vdC1vd25lZFwiXG4gICAgICB9KVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBSZXBsYWNlcyB0aGUgcXVldWVkIG93bmVyIG9mIGEgc3RhYmxlIHNjaGVkdWxlIGtleSB3aXRoIGEgbmV3IG9uZS1vZmYgam9iLlxuICAgKiBBIGhhbmRlZC1vZmYgb3duZXIgaXMgbGVmdCBydW5uaW5nIGFuZCByZXBvcnRlZCB0cnV0aGZ1bGx5LlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIE9wdGlvbnMuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBhcmdzLnNjaGVkdWxlS2V5IC0gU3RhYmxlIGxvZ2ljYWwgc2NoZWR1bGUga2V5LlxuICAgKiBAcGFyYW0ge3N0cmluZ30gYXJncy5qb2JOYW1lIC0gSm9iIG5hbWUuXG4gICAqIEBwYXJhbSB7QXJyYXk8UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSBhcmdzLmFyZ3MgLSBBcmd1bWVudHMuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi90eXBlcy5qc1wiKS5CYWNrZ3JvdW5kSm9iT3B0aW9uc30gW2FyZ3Mub3B0aW9uc10gLSBPcHRpb25zLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxpbXBvcnQoXCIuL3R5cGVzLmpzXCIpLkJhY2tncm91bmRKb2JSZXBsYWNlbWVudFJlc3VsdD59IC0gUmVwbGFjZW1lbnQgcmVzdWx0LlxuICAgKi9cbiAgYXN5bmMgcmVwbGFjZVNjaGVkdWxlZCh7c2NoZWR1bGVLZXksIGpvYk5hbWUsIGFyZ3MsIG9wdGlvbnN9KSB7XG4gICAgYXdhaXQgdGhpcy5lbnN1cmVSZWFkeSgpXG5cbiAgICBjb25zdCBub3JtYWxpemVkU2NoZWR1bGVLZXkgPSB0aGlzLl9ub3JtYWxpemVTY2hlZHVsZUtleShzY2hlZHVsZUtleSlcbiAgICBjb25zdCBwcmVwYXJlZEpvYiA9IHRoaXMuX3ByZXBhcmVKb2Ioe2pvYk5hbWUsIGFyZ3MsIG9wdGlvbnN9KVxuXG4gICAgcmV0dXJuIGF3YWl0IHRoaXMuX3NlcmlhbGl6ZWRDb3VudE11dGF0aW9uKGFzeW5jIChkYikgPT4ge1xuICAgICAgY29uc3Qgb3duZXJSb3dzID0gYXdhaXQgZGJcbiAgICAgICAgLm5ld1F1ZXJ5KClcbiAgICAgICAgLmZyb20oU0NIRURVTEVfS0VZU19UQUJMRSlcbiAgICAgICAgLndoZXJlKHtzY2hlZHVsZV9rZXk6IG5vcm1hbGl6ZWRTY2hlZHVsZUtleX0pXG4gICAgICAgIC5saW1pdCgxKVxuICAgICAgICAucmVzdWx0cygpXG4gICAgICBjb25zdCBvd25lckpvYklkID0gb3duZXJSb3dzWzBdID8gU3RyaW5nKC8qKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSAqLyAob3duZXJSb3dzWzBdKS5qb2JfaWQpIDogbnVsbFxuICAgICAgY29uc3Qgb3duZXJKb2IgPSBvd25lckpvYklkID8gYXdhaXQgdGhpcy5fZ2V0Sm9iUm93QnlJZChkYiwgb3duZXJKb2JJZCkgOiBudWxsXG4gICAgICAvKiogQHR5cGUge2ltcG9ydChcIi4vdHlwZXMuanNcIikuQmFja2dyb3VuZEpvYlJlcGxhY2VtZW50UHJldmlvdXNTdGF0dXN9ICovXG4gICAgICBsZXQgcHJldmlvdXNTdGF0dXMgPSBudWxsXG4gICAgICBsZXQgcHJldmlvdXNKb2JJZCA9IG51bGxcblxuICAgICAgaWYgKG93bmVySm9iPy5zdGF0dXMgPT09IFwicXVldWVkXCIpIHtcbiAgICAgICAgY29uc3QgYWZmZWN0ZWRSb3dzID0gYXdhaXQgdGhpcy5fdXBkYXRlQWZmZWN0ZWRSb3dzKGRiLCB7XG4gICAgICAgICAgdGFibGVOYW1lOiBKT0JTX1RBQkxFLFxuICAgICAgICAgIGRhdGE6IHtzdGF0dXM6IFwiY2FuY2VsbGVkXCJ9LFxuICAgICAgICAgIGNvbmRpdGlvbnM6IHtpZDogb3duZXJKb2IuaWQsIHN0YXR1czogXCJxdWV1ZWRcIn1cbiAgICAgICAgfSlcblxuICAgICAgICBpZiAoYWZmZWN0ZWRSb3dzID09PSAxKSB7XG4gICAgICAgICAgcHJldmlvdXNKb2JJZCA9IG93bmVySm9iLmlkXG4gICAgICAgICAgcHJldmlvdXNTdGF0dXMgPSBcInF1ZXVlZFwiXG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgY29uc3QgY3VycmVudE93bmVySm9iID0gYXdhaXQgdGhpcy5fZ2V0Sm9iUm93QnlJZChkYiwgb3duZXJKb2IuaWQpXG5cbiAgICAgICAgICBpZiAoY3VycmVudE93bmVySm9iPy5zdGF0dXMgPT09IFwiaGFuZGVkX29mZlwiKSB7XG4gICAgICAgICAgICBwcmV2aW91c0pvYklkID0gY3VycmVudE93bmVySm9iLmlkXG4gICAgICAgICAgICBwcmV2aW91c1N0YXR1cyA9IFwiaGFuZGVkX29mZlwiXG4gICAgICAgICAgfVxuICAgICAgICB9XG4gICAgICB9IGVsc2UgaWYgKG93bmVySm9iPy5zdGF0dXMgPT09IFwiaGFuZGVkX29mZlwiKSB7XG4gICAgICAgIHByZXZpb3VzSm9iSWQgPSBvd25lckpvYi5pZFxuICAgICAgICBwcmV2aW91c1N0YXR1cyA9IFwiaGFuZGVkX29mZlwiXG4gICAgICB9XG5cbiAgICAgIGNvbnN0IHNjaGVkdWxlT3JkZXIgPSBhd2FpdCB0aGlzLl9uZXh0U2NoZWR1bGVPcmRlcihkYiwgbm9ybWFsaXplZFNjaGVkdWxlS2V5KVxuXG4gICAgICBhd2FpdCB0aGlzLl9pbnNlcnRQcmVwYXJlZEpvYihkYiwge3ByZXBhcmVkSm9iLCBzY2hlZHVsZUtleTogbm9ybWFsaXplZFNjaGVkdWxlS2V5LCBzY2hlZHVsZU9yZGVyfSlcbiAgICAgIGF3YWl0IGRiLnVwc2VydCh7XG4gICAgICAgIHRhYmxlTmFtZTogU0NIRURVTEVfS0VZU19UQUJMRSxcbiAgICAgICAgZGF0YToge3NjaGVkdWxlX2tleTogbm9ybWFsaXplZFNjaGVkdWxlS2V5LCBqb2JfaWQ6IHByZXBhcmVkSm9iLmpvYklkfSxcbiAgICAgICAgY29uZmxpY3RDb2x1bW5zOiBbXCJzY2hlZHVsZV9rZXlcIl0sXG4gICAgICAgIHVwZGF0ZUNvbHVtbnM6IFtcImpvYl9pZFwiXVxuICAgICAgfSlcblxuICAgICAgaWYgKHByZXZpb3VzU3RhdHVzICE9PSBcInF1ZXVlZFwiKSBhd2FpdCB0aGlzLl9yZWNvcmRDb3VudERlbHRhKGRiLCB7YWxsOiAxLCBxdWV1ZWQ6IDF9KVxuICAgICAgcmV0dXJuIHtqb2JJZDogcHJlcGFyZWRKb2Iuam9iSWQsIHByZXZpb3VzSm9iSWQsIHByZXZpb3VzU3RhdHVzfVxuICAgIH0sIHtcbiAgICAgIGFkdmlzb3J5TG9jazoge1xuICAgICAgICBmYWlsdXJlTWVzc2FnZTogXCJGYWlsZWQgdG8gYWNxdWlyZSBiYWNrZ3JvdW5kIGpvYiBzY2hlZHVsZS1rZXkgbG9ja1wiLFxuICAgICAgICBuYW1lOiB0aGlzLl9zY2hlZHVsZUtleUxvY2tOYW1lKG5vcm1hbGl6ZWRTY2hlZHVsZUtleSlcbiAgICAgIH1cbiAgICB9KVxuICB9XG5cbiAgLyoqXG4gICAqIENhbmNlbHMgdGhlIHF1ZXVlZCBvd25lciBvZiBhIHN0YWJsZSBzY2hlZHVsZSBrZXkuIEEgaGFuZGVkLW9mZiBvd25lciBpc1xuICAgKiBkZXRhY2hlZCBidXQgbm90IG1hcmtlZCBzdG9wcGVkIGJlY2F1c2UgZXhlY3V0aW9uIG1heSBhbHJlYWR5IGJlIHJ1bm5pbmcuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBzY2hlZHVsZUtleSAtIFN0YWJsZSBsb2dpY2FsIHNjaGVkdWxlIGtleS5cbiAgICogQHJldHVybnMge1Byb21pc2U8aW1wb3J0KFwiLi90eXBlcy5qc1wiKS5CYWNrZ3JvdW5kSm9iQ2FuY2VsbGF0aW9uUmVzdWx0Pn0gLSBDYW5jZWxsYXRpb24gcmVzdWx0LlxuICAgKi9cbiAgYXN5bmMgY2FuY2VsU2NoZWR1bGVkKHNjaGVkdWxlS2V5KSB7XG4gICAgYXdhaXQgdGhpcy5lbnN1cmVSZWFkeSgpXG5cbiAgICBjb25zdCBub3JtYWxpemVkU2NoZWR1bGVLZXkgPSB0aGlzLl9ub3JtYWxpemVTY2hlZHVsZUtleShzY2hlZHVsZUtleSlcblxuICAgIHJldHVybiBhd2FpdCB0aGlzLl9zZXJpYWxpemVkQ291bnRNdXRhdGlvbihhc3luYyAoZGIpID0+IHtcbiAgICAgIGNvbnN0IG93bmVyUm93cyA9IGF3YWl0IGRiXG4gICAgICAgIC5uZXdRdWVyeSgpXG4gICAgICAgIC5mcm9tKFNDSEVEVUxFX0tFWVNfVEFCTEUpXG4gICAgICAgIC53aGVyZSh7c2NoZWR1bGVfa2V5OiBub3JtYWxpemVkU2NoZWR1bGVLZXl9KVxuICAgICAgICAubGltaXQoMSlcbiAgICAgICAgLnJlc3VsdHMoKVxuXG4gICAgICBpZiAoIW93bmVyUm93c1swXSkgcmV0dXJuIHtqb2JJZDogbnVsbCwgb3V0Y29tZTogXCJub3RfZm91bmRcIn1cblxuICAgICAgY29uc3Qgam9iSWQgPSBTdHJpbmcoLyoqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59ICovIChvd25lclJvd3NbMF0pLmpvYl9pZClcbiAgICAgIGNvbnN0IGpvYiA9IGF3YWl0IHRoaXMuX2dldEpvYlJvd0J5SWQoZGIsIGpvYklkKVxuXG4gICAgICBpZiAoam9iPy5zdGF0dXMgPT09IFwicXVldWVkXCIpIHtcbiAgICAgICAgY29uc3QgYWZmZWN0ZWRSb3dzID0gYXdhaXQgdGhpcy5fdXBkYXRlQWZmZWN0ZWRSb3dzKGRiLCB7XG4gICAgICAgICAgdGFibGVOYW1lOiBKT0JTX1RBQkxFLFxuICAgICAgICAgIGRhdGE6IHtzdGF0dXM6IFwiY2FuY2VsbGVkXCJ9LFxuICAgICAgICAgIGNvbmRpdGlvbnM6IHtpZDogam9iLmlkLCBzdGF0dXM6IFwicXVldWVkXCJ9XG4gICAgICAgIH0pXG5cbiAgICAgICAgaWYgKGFmZmVjdGVkUm93cyA9PT0gMSkge1xuICAgICAgICAgIGF3YWl0IHRoaXMuX3JlbGVhc2VTY2hlZHVsZU93bmVyc2hpcChkYiwge2pvYklkLCBzY2hlZHVsZUtleTogbm9ybWFsaXplZFNjaGVkdWxlS2V5fSlcbiAgICAgICAgICBhd2FpdCB0aGlzLl9yZWNvcmRTdGF0dXNUcmFuc2l0aW9uKGRiLCBcInF1ZXVlZFwiLCBcImNhbmNlbGxlZFwiKVxuXG4gICAgICAgICAgcmV0dXJuIHtqb2JJZCwgb3V0Y29tZTogXCJjYW5jZWxsZWRcIn1cbiAgICAgICAgfVxuICAgICAgfVxuXG4gICAgICBjb25zdCBjdXJyZW50Sm9iID0gYXdhaXQgdGhpcy5fZ2V0Sm9iUm93QnlJZChkYiwgam9iSWQpXG5cbiAgICAgIGF3YWl0IHRoaXMuX3JlbGVhc2VTY2hlZHVsZU93bmVyc2hpcChkYiwge2pvYklkLCBzY2hlZHVsZUtleTogbm9ybWFsaXplZFNjaGVkdWxlS2V5fSlcblxuICAgICAgaWYgKGN1cnJlbnRKb2I/LnN0YXR1cyA9PT0gXCJoYW5kZWRfb2ZmXCIpIHJldHVybiB7am9iSWQsIG91dGNvbWU6IFwiaGFuZGVkX29mZlwifVxuICAgICAgcmV0dXJuIHtqb2JJZDogbnVsbCwgb3V0Y29tZTogXCJub3RfZm91bmRcIn1cbiAgICB9LCB7XG4gICAgICBhZHZpc29yeUxvY2s6IHtcbiAgICAgICAgZmFpbHVyZU1lc3NhZ2U6IFwiRmFpbGVkIHRvIGFjcXVpcmUgYmFja2dyb3VuZCBqb2Igc2NoZWR1bGUta2V5IGxvY2tcIixcbiAgICAgICAgbmFtZTogdGhpcy5fc2NoZWR1bGVLZXlMb2NrTmFtZShub3JtYWxpemVkU2NoZWR1bGVLZXkpXG4gICAgICB9XG4gICAgfSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSZWFkcyBzdGFibGUgb3duZXJzaGlwIGFuZCBvcHRpb25hbCBsYXRlc3QgdGVybWluYWwgaGlzdG9yeSBpbiBvbmUgZmVuY2VkIHRyYW5zYWN0aW9uLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gc2NoZWR1bGVLZXkgLSBTdGFibGUgbG9naWNhbCBzY2hlZHVsZSBrZXkuXG4gICAqIEBwYXJhbSB7e2luY2x1ZGVMYXRlc3RUZXJtaW5hbD86IGJvb2xlYW59fSBbb3B0aW9uc10gLSBMb29rdXAgb3B0aW9ucy5cbiAgICogQHJldHVybnMge1Byb21pc2U8aW1wb3J0KFwiLi90eXBlcy5qc1wiKS5CYWNrZ3JvdW5kSm9iU2NoZWR1bGVkTG9va3VwUmVzdWx0Pn0gLSBOb3JtYWxpemVkIHB1YmxpYyBqb2JzLlxuICAgKi9cbiAgYXN5bmMgZ2V0U2NoZWR1bGVkSm9iKHNjaGVkdWxlS2V5LCB7aW5jbHVkZUxhdGVzdFRlcm1pbmFsID0gZmFsc2V9ID0ge30pIHtcbiAgICBhd2FpdCB0aGlzLmVuc3VyZVJlYWR5KClcblxuICAgIGNvbnN0IG5vcm1hbGl6ZWRTY2hlZHVsZUtleSA9IHRoaXMuX25vcm1hbGl6ZVNjaGVkdWxlS2V5KHNjaGVkdWxlS2V5KVxuXG4gICAgaWYgKHR5cGVvZiBpbmNsdWRlTGF0ZXN0VGVybWluYWwgIT09IFwiYm9vbGVhblwiKSB7XG4gICAgICB0aHJvdyBWZWxvY2lvdXNFcnJvci5zYWZlKFwiYmFja2dyb3VuZCBqb2IgaW5jbHVkZUxhdGVzdFRlcm1pbmFsIG11c3QgYmUgYSBib29sZWFuXCIpXG4gICAgfVxuXG4gICAgcmV0dXJuIGF3YWl0IHRoaXMuX3NlcmlhbGl6ZWRDb3VudE11dGF0aW9uKGFzeW5jIChkYikgPT4ge1xuICAgICAgcmV0dXJuIGF3YWl0IHRoaXMuX3NjaGVkdWxlZEpvYkxvb2t1cChkYiwge1xuICAgICAgICBpbmNsdWRlTGF0ZXN0VGVybWluYWwsXG4gICAgICAgIHNjaGVkdWxlS2V5OiBub3JtYWxpemVkU2NoZWR1bGVLZXlcbiAgICAgIH0pXG4gICAgfSwge1xuICAgICAgYWR2aXNvcnlMb2NrOiB7XG4gICAgICAgIGZhaWx1cmVNZXNzYWdlOiBcIkZhaWxlZCB0byBhY3F1aXJlIGJhY2tncm91bmQgam9iIHNjaGVkdWxlLWtleSBsb2NrXCIsXG4gICAgICAgIG5hbWU6IHRoaXMuX3NjaGVkdWxlS2V5TG9ja05hbWUobm9ybWFsaXplZFNjaGVkdWxlS2V5KVxuICAgICAgfVxuICAgIH0pXG4gIH1cblxuICAvKipcbiAgICogTW92ZXMgb25seSBhIGZ1dHVyZSBxdWV1ZWQgc3RhYmxlIG93bmVyIHRvIHRoZSBjdXJyZW50IHRpbWUuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBzY2hlZHVsZUtleSAtIFN0YWJsZSBsb2dpY2FsIHNjaGVkdWxlIGtleS5cbiAgICogQHJldHVybnMge1Byb21pc2U8aW1wb3J0KFwiLi90eXBlcy5qc1wiKS5CYWNrZ3JvdW5kSm9iV2FrZVJlc3VsdD59IC0gRXhhY3Qgd2FrZSBvdXRjb21lLlxuICAgKi9cbiAgYXN5bmMgd2FrZVNjaGVkdWxlZChzY2hlZHVsZUtleSkge1xuICAgIGF3YWl0IHRoaXMuZW5zdXJlUmVhZHkoKVxuXG4gICAgY29uc3Qgbm9ybWFsaXplZFNjaGVkdWxlS2V5ID0gdGhpcy5fbm9ybWFsaXplU2NoZWR1bGVLZXkoc2NoZWR1bGVLZXkpXG5cbiAgICByZXR1cm4gYXdhaXQgdGhpcy5fc2VyaWFsaXplZENvdW50TXV0YXRpb24oYXN5bmMgKGRiKSA9PiB7XG4gICAgICBjb25zdCBqb2IgPSBhd2FpdCB0aGlzLl9zY2hlZHVsZWRPd25lckpvYihkYiwgbm9ybWFsaXplZFNjaGVkdWxlS2V5KVxuXG4gICAgICBpZiAoIWpvYiB8fCAoam9iLnN0YXR1cyAhPT0gXCJxdWV1ZWRcIiAmJiBqb2Iuc3RhdHVzICE9PSBcImhhbmRlZF9vZmZcIikpIHJldHVybiB7am9iSWQ6IG51bGwsIG91dGNvbWU6IFwibm90X2ZvdW5kXCJ9XG4gICAgICBpZiAoam9iLnN0YXR1cyA9PT0gXCJoYW5kZWRfb2ZmXCIpIHJldHVybiB7am9iSWQ6IGpvYi5pZCwgb3V0Y29tZTogXCJoYW5kZWRfb2ZmXCJ9XG5cbiAgICAgIGNvbnN0IG5vd01zID0gdGhpcy5jbG9jay5ub3coKVxuXG4gICAgICBpZiAoTnVtYmVyKGpvYi5zY2hlZHVsZWRBdE1zKSA8PSBub3dNcykgcmV0dXJuIHtqb2JJZDogam9iLmlkLCBvdXRjb21lOiBcImFscmVhZHlfZHVlXCJ9XG5cbiAgICAgIGNvbnN0IGFmZmVjdGVkUm93cyA9IGF3YWl0IHRoaXMuX3VwZGF0ZUFmZmVjdGVkUm93cyhkYiwge1xuICAgICAgICB0YWJsZU5hbWU6IEpPQlNfVEFCTEUsXG4gICAgICAgIGRhdGE6IHtzY2hlZHVsZWRfYXRfbXM6IG5vd01zfSxcbiAgICAgICAgY29uZGl0aW9uczoge2lkOiBqb2IuaWQsIHNjaGVkdWxlZF9hdF9tczogam9iLnNjaGVkdWxlZEF0TXMsIHN0YXR1czogXCJxdWV1ZWRcIn1cbiAgICAgIH0pXG5cbiAgICAgIGlmIChhZmZlY3RlZFJvd3MgPT09IDEpIHJldHVybiB7am9iSWQ6IGpvYi5pZCwgb3V0Y29tZTogXCJ3b2tlblwifVxuXG4gICAgICBjb25zdCBjdXJyZW50Sm9iID0gYXdhaXQgdGhpcy5fc2NoZWR1bGVkT3duZXJKb2IoZGIsIG5vcm1hbGl6ZWRTY2hlZHVsZUtleSlcblxuICAgICAgaWYgKGN1cnJlbnRKb2I/LnN0YXR1cyA9PT0gXCJoYW5kZWRfb2ZmXCIpIHJldHVybiB7am9iSWQ6IGN1cnJlbnRKb2IuaWQsIG91dGNvbWU6IFwiaGFuZGVkX29mZlwifVxuICAgICAgaWYgKGN1cnJlbnRKb2I/LnN0YXR1cyA9PT0gXCJxdWV1ZWRcIiAmJiBOdW1iZXIoY3VycmVudEpvYi5zY2hlZHVsZWRBdE1zKSA8PSBub3dNcykge1xuICAgICAgICByZXR1cm4ge2pvYklkOiBjdXJyZW50Sm9iLmlkLCBvdXRjb21lOiBcImFscmVhZHlfZHVlXCJ9XG4gICAgICB9XG5cbiAgICAgIHJldHVybiB7am9iSWQ6IG51bGwsIG91dGNvbWU6IFwibm90X2ZvdW5kXCJ9XG4gICAgfSwge1xuICAgICAgYWR2aXNvcnlMb2NrOiB7XG4gICAgICAgIGZhaWx1cmVNZXNzYWdlOiBcIkZhaWxlZCB0byBhY3F1aXJlIGJhY2tncm91bmQgam9iIHNjaGVkdWxlLWtleSBsb2NrXCIsXG4gICAgICAgIG5hbWU6IHRoaXMuX3NjaGVkdWxlS2V5TG9ja05hbWUobm9ybWFsaXplZFNjaGVkdWxlS2V5KVxuICAgICAgfVxuICAgIH0pXG4gIH1cblxuICAvKipcbiAgICogUnVucyBuZXh0IGF2YWlsYWJsZSBqb2IuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBbYXJnc10gLSBPcHRpb25zLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vdHlwZXMuanNcIikuQmFja2dyb3VuZEpvYkV4ZWN1dGlvbk1vZGUgfCBpbXBvcnQoXCIuL3R5cGVzLmpzXCIpLkJhY2tncm91bmRKb2JFeGVjdXRpb25Nb2RlW119IFthcmdzLmV4ZWN1dGlvbk1vZGVdIC0gRXhlY3V0aW9uIG1vZGUgb3IgbW9kZXMgdG8gbWF0Y2guXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPGltcG9ydChcIi4vdHlwZXMuanNcIikuQmFja2dyb3VuZEpvYlJvdyB8IG51bGw+fSAtIE5leHQgam9iLlxuICAgKi9cbiAgYXN5bmMgbmV4dEF2YWlsYWJsZUpvYihhcmdzID0ge30pIHtcbiAgICBhd2FpdCB0aGlzLmVuc3VyZVJlYWR5KClcblxuICAgIHJldHVybiBhd2FpdCB0aGlzLl93aXRoRGIoYXN5bmMgKGRiKSA9PiB7XG4gICAgICByZXR1cm4gYXdhaXQgdGhpcy5fbmV4dFF1ZXVlZEpvYih7XG4gICAgICAgIGRiLFxuICAgICAgICBzY2hlZHVsZWRBdE9wZXJhdG9yOiBcIjw9XCIsXG4gICAgICAgIGV4ZWN1dGlvbk1vZGU6IGFyZ3MuZXhlY3V0aW9uTW9kZVxuICAgICAgfSlcbiAgICB9KVxuICB9XG5cbiAgLyoqXG4gICAqIFJldHVybnMgdGhlIHNvb25lc3QgZnV0dXJlLXNjaGVkdWxlZCBxdWV1ZWQgam9iIChvbmUgd2hvc2VcbiAgICogYHNjaGVkdWxlZF9hdF9tc2AgaXMgaW4gdGhlIGZ1dHVyZSksIG9yIG51bGwgd2hlbiB0aGVyZSBhcmUgbm9cbiAgICogZnV0dXJlLXNjaGVkdWxlZCBqb2JzLiBVc2VkIGJ5IHRoZSBldmVudC1kcml2ZW4gZGlzcGF0Y2hlciB0byBhcm0gYVxuICAgKiBgc2V0VGltZW91dGAgZm9yIHRoZSBleGFjdCBtb21lbnQgdGhlIG5leHQgc2NoZWR1bGVkIGpvYiBiZWNvbWVzXG4gICAqIGVsaWdpYmxlLCByZXBsYWNpbmcgdGhlIGxlZ2FjeSAxLXNlY29uZCBwb2xsaW5nIGxvb3AuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPGltcG9ydChcIi4vdHlwZXMuanNcIikuQmFja2dyb3VuZEpvYlJvdyB8IG51bGw+fSAtIFNvb25lc3QgZnV0dXJlLXNjaGVkdWxlZCBqb2IsIG9yIG51bGwuXG4gICAqL1xuICBhc3luYyBuZXh0U2NoZWR1bGVkSm9iKCkge1xuICAgIGF3YWl0IHRoaXMuZW5zdXJlUmVhZHkoKVxuXG4gICAgcmV0dXJuIGF3YWl0IHRoaXMuX3dpdGhEYihhc3luYyAoZGIpID0+IHtcbiAgICAgIHJldHVybiBhd2FpdCB0aGlzLl9uZXh0UXVldWVkSm9iKHtkYiwgc2NoZWR1bGVkQXRPcGVyYXRvcjogXCI+XCJ9KVxuICAgIH0pXG4gIH1cblxuICAvKipcbiAgICogUnVucyBuZXh0IHF1ZXVlZCBqb2IuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gT3B0aW9ucy5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9kYXRhYmFzZS9kcml2ZXJzL2Jhc2UuanNcIikuZGVmYXVsdH0gYXJncy5kYiAtIERhdGFiYXNlIGNvbm5lY3Rpb24uXG4gICAqIEBwYXJhbSB7XCI8PVwiIHwgXCI+XCJ9IGFyZ3Muc2NoZWR1bGVkQXRPcGVyYXRvciAtIFNjaGVkdWxlZCB0aW1lc3RhbXAgb3BlcmF0b3IuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi90eXBlcy5qc1wiKS5CYWNrZ3JvdW5kSm9iRXhlY3V0aW9uTW9kZSB8IGltcG9ydChcIi4vdHlwZXMuanNcIikuQmFja2dyb3VuZEpvYkV4ZWN1dGlvbk1vZGVbXX0gW2FyZ3MuZXhlY3V0aW9uTW9kZV0gLSBFeGVjdXRpb24gbW9kZSBvciBtb2RlcyB0byBtYXRjaC5cbiAgICogQHJldHVybnMge1Byb21pc2U8aW1wb3J0KFwiLi90eXBlcy5qc1wiKS5CYWNrZ3JvdW5kSm9iUm93IHwgbnVsbD59IC0gTmV4dCBtYXRjaGluZyBxdWV1ZWQgam9iLlxuICAgKi9cbiAgYXN5bmMgX25leHRRdWV1ZWRKb2Ioe2RiLCBzY2hlZHVsZWRBdE9wZXJhdG9yLCBleGVjdXRpb25Nb2RlfSkge1xuICAgIGNvbnN0IG5vdyA9IHRoaXMuY2xvY2subm93KClcbiAgICBsZXQgcXVlcnkgPSBkYlxuICAgICAgLm5ld1F1ZXJ5KClcbiAgICAgIC5mcm9tKEpPQlNfVEFCTEUpXG4gICAgICAud2hlcmUoe3N0YXR1czogXCJxdWV1ZWRcIn0pXG4gICAgICAud2hlcmUoYHNjaGVkdWxlZF9hdF9tcyAke3NjaGVkdWxlZEF0T3BlcmF0b3J9ICR7ZGIucXVvdGUobm93KX1gKVxuXG4gICAgaWYgKHNjaGVkdWxlZEF0T3BlcmF0b3IgPT09IFwiPD1cIikge1xuICAgICAgY29uc3Qgam9ic1RhYmxlID0gZGIucXVvdGVUYWJsZShKT0JTX1RBQkxFKVxuICAgICAgY29uc3QgY29uY3VycmVuY3lUYWJsZSA9IGRiLnF1b3RlVGFibGUoQ09OQ1VSUkVOQ1lfVEFCTEUpXG4gICAgICBxdWVyeSA9IHF1ZXJ5LndoZXJlKFxuICAgICAgICBgKCR7am9ic1RhYmxlfS4ke2RiLnF1b3RlQ29sdW1uKFwiY29uY3VycmVuY3lfa2V5XCIpfSBJUyBOVUxMIE9SIEVYSVNUUyAoYCArXG4gICAgICAgIGBTRUxFQ1QgMSBGUk9NICR7Y29uY3VycmVuY3lUYWJsZX0gV0hFUkUgYCArXG4gICAgICAgIGAke2NvbmN1cnJlbmN5VGFibGV9LiR7ZGIucXVvdGVDb2x1bW4oXCJjb25jdXJyZW5jeV9rZXlcIil9ID0gJHtqb2JzVGFibGV9LiR7ZGIucXVvdGVDb2x1bW4oXCJjb25jdXJyZW5jeV9rZXlcIil9IEFORCBgICtcbiAgICAgICAgYCR7Y29uY3VycmVuY3lUYWJsZX0uJHtkYi5xdW90ZUNvbHVtbihcImFjdGl2ZV9jb3VudFwiKX0gPCAke2NvbmN1cnJlbmN5VGFibGV9LiR7ZGIucXVvdGVDb2x1bW4oXCJtYXhfY29uY3VycmVuY3lcIil9KSlgXG4gICAgICApXG4gICAgfVxuXG4gICAgaWYgKGV4ZWN1dGlvbk1vZGUpIHF1ZXJ5ID0gdGhpcy5fd2hlcmVFeGVjdXRpb25Nb2RlKHtkYiwgZXhlY3V0aW9uTW9kZSwgcXVlcnl9KVxuXG4gICAgaWYgKHNjaGVkdWxlZEF0T3BlcmF0b3IgPT09IFwiPD1cIikge1xuICAgICAgY29uc3QgcHJpb3JpdHlPcmRlciA9IHRoaXMuX3F1ZXVlUHJpb3JpdHlPcmRlclNxbChkYilcblxuICAgICAgaWYgKHByaW9yaXR5T3JkZXIpIHF1ZXJ5ID0gcXVlcnkub3JkZXIoYCR7cHJpb3JpdHlPcmRlcn0gREVTQ2ApXG4gICAgfVxuXG4gICAgcXVlcnkgPSBxdWVyeVxuICAgICAgLm9yZGVyKFwic2NoZWR1bGVkX2F0X21zIEFTQ1wiKVxuICAgICAgLm9yZGVyKFwiY3JlYXRlZF9hdF9tcyBBU0NcIilcbiAgICAgIC5saW1pdCgxKVxuXG4gICAgY29uc3Qgcm93cyA9IGF3YWl0IHF1ZXJ5LnJlc3VsdHMoKVxuICAgIGNvbnN0IHJvdyA9IHJvd3NbMF1cblxuICAgIGlmICghcm93KSByZXR1cm4gbnVsbFxuXG4gICAgcmV0dXJuIHRoaXMuX25vcm1hbGl6ZUpvYlJvdyhyb3cpXG4gIH1cblxuICAvKipcbiAgICogQnVpbGRzIGEgcmF3IFNRTCBPUkRFUiBCWSBleHByZXNzaW9uIHJhbmtpbmcgcXVldWVkIGpvYnMgYnkgdGhlaXIgcXVldWUnc1xuICAgKiBjb25maWd1cmVkIHByaW9yaXR5IChgYmFja2dyb3VuZEpvYnMucXVldWVzW3F1ZXVlXS5wcmlvcml0eWAsIGRlZmF1bHQgYDBgKSxcbiAgICogc28gdGhlIGRpc3BhdGNoZXIgcGlja3MgaGlnaGVyLXByaW9yaXR5IHF1ZXVlcyBmaXJzdCByZWdhcmRsZXNzIG9mIGVucXVldWVcbiAgICogb3JkZXIuIE9ubHkgYXBwbGllZCB0byB0aGUgZGlzcGF0Y2ggcGF0aCAoYHNjaGVkdWxlZEF0T3BlcmF0b3IgPT09IFwiPD1cImApO1xuICAgKiB0aGUgZnV0dXJlLXNjaGVkdWxlZCBsb29rdXAgbXVzdCBzdGF5IHN0cmljdGx5IHRpbWUtb3JkZXJlZC4gQ29tcG9zZXMgd2l0aFxuICAgKiB0aGUgY29uY3VycmVuY3kgRVhJU1RTIGZpbHRlcjogYSBoaWdoZXItcHJpb3JpdHkgcXVldWUgYWxyZWFkeSBhdCBpdHMgY2FwIGlzXG4gICAqIGZpbHRlcmVkIG91dCwgc28gZGlzcGF0Y2ggZmFsbHMgdGhyb3VnaCB0byB0aGUgbmV4dCBlbGlnaWJsZSBsb3dlci1wcmlvcml0eVxuICAgKiBqb2IuIFJldHVybnMgbnVsbCB3aGVuIG5vIHF1ZXVlIGNvbmZpZ3VyZXMgYSBub24temVybyBwcmlvcml0eSBzbyB0aGUgcGxhaW5cbiAgICogRklGTyBvcmRlcmluZyBpcyBsZWZ0IHVudG91Y2hlZCAoYW5kIG5vIG5lZWRsZXNzIGZpbGVzb3J0IGlzIGludHJvZHVjZWQpLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL2RhdGFiYXNlL2RyaXZlcnMvYmFzZS5qc1wiKS5kZWZhdWx0fSBkYiAtIERhdGFiYXNlIGNvbm5lY3Rpb24uXG4gICAqIEByZXR1cm5zIHtzdHJpbmcgfCBudWxsfSAtIFJhdyBTUUwgQ0FTRSBleHByZXNzaW9uLCBvciBudWxsIHdoZW4gbm8gcXVldWUgaXMgcHJpb3JpdGl6ZWQuXG4gICAqL1xuICBfcXVldWVQcmlvcml0eU9yZGVyU3FsKGRiKSB7XG4gICAgY29uc3QgcXVldWVzID0gdGhpcy5jb25maWd1cmF0aW9uLmdldEJhY2tncm91bmRKb2JzQ29uZmlnKCkucXVldWVzIHx8IHt9XG4gICAgLyoqIEB0eXBlIHtBcnJheTxbc3RyaW5nLCBudW1iZXJdPn0gKi9cbiAgICBjb25zdCBwcmlvcml0aXplZCA9IFtdXG5cbiAgICBmb3IgKGNvbnN0IFtxdWV1ZSwgcXVldWVDb25maWddIG9mIE9iamVjdC5lbnRyaWVzKHF1ZXVlcykpIHtcbiAgICAgIGNvbnN0IHByaW9yaXR5ID0gcXVldWVDb25maWc/LnByaW9yaXR5XG5cbiAgICAgIGlmIChOdW1iZXIuaXNGaW5pdGUocHJpb3JpdHkpICYmIE51bWJlcihwcmlvcml0eSkgIT09IDApIHByaW9yaXRpemVkLnB1c2goW3F1ZXVlLCBOdW1iZXIocHJpb3JpdHkpXSlcbiAgICB9XG5cbiAgICBpZiAocHJpb3JpdGl6ZWQubGVuZ3RoID09PSAwKSByZXR1cm4gbnVsbFxuXG4gICAgY29uc3QgcXVldWVDb2x1bW4gPSBkYi5xdW90ZUNvbHVtbihcInF1ZXVlXCIpXG4gICAgY29uc3Qgd2hlbnMgPSBwcmlvcml0aXplZFxuICAgICAgLm1hcCgoW3F1ZXVlLCBwcmlvcml0eV0pID0+IGBXSEVOICR7ZGIucXVvdGUocXVldWUpfSBUSEVOICR7cHJpb3JpdHl9YClcbiAgICAgIC5qb2luKFwiIFwiKVxuXG4gICAgcmV0dXJuIGBDQVNFIENPQUxFU0NFKCR7cXVldWVDb2x1bW59LCAke2RiLnF1b3RlKERFRkFVTFRfQkFDS0dST1VORF9KT0JfUVVFVUUpfSkgJHt3aGVuc30gRUxTRSAwIEVORGBcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGdldCBqb2IuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBqb2JJZCAtIEpvYiBpZC5cbiAgICogQHJldHVybnMge1Byb21pc2U8aW1wb3J0KFwiLi90eXBlcy5qc1wiKS5CYWNrZ3JvdW5kSm9iUm93IHwgbnVsbD59IC0gSm9iIHJvdy5cbiAgICovXG4gIGFzeW5jIGdldEpvYihqb2JJZCkge1xuICAgIGF3YWl0IHRoaXMuZW5zdXJlUmVhZHkoKVxuXG4gICAgcmV0dXJuIGF3YWl0IHRoaXMuX3dpdGhEYihhc3luYyAoZGIpID0+IHtcbiAgICAgIGNvbnN0IHF1ZXJ5ID0gZGJcbiAgICAgICAgLm5ld1F1ZXJ5KClcbiAgICAgICAgLmZyb20oSk9CU19UQUJMRSlcbiAgICAgICAgLndoZXJlKHtpZDogam9iSWR9KVxuICAgICAgICAubGltaXQoMSlcblxuICAgICAgY29uc3Qgcm93cyA9IGF3YWl0IHF1ZXJ5LnJlc3VsdHMoKVxuICAgICAgY29uc3Qgcm93ID0gcm93c1swXVxuXG4gICAgICBpZiAoIXJvdykgcmV0dXJuIG51bGxcblxuICAgICAgcmV0dXJuIHRoaXMuX25vcm1hbGl6ZUpvYlJvdyhyb3cpXG4gICAgfSlcbiAgfVxuXG4gIC8qKlxuICAgKiBDb3VudHMgam9icyBncm91cGVkIGJ5IHN0YXR1cy4gVXNlZCBieSB0aGUgZGFzaGJvYXJkIG92ZXJ2aWV3LlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxSZWNvcmQ8c3RyaW5nLCBudW1iZXI+Pn0gLSBDb3VudHMga2V5ZWQgYnkgc3RhdHVzLlxuICAgKi9cbiAgYXN5bmMgY291bnRzQnlTdGF0dXMoKSB7XG4gICAgYXdhaXQgdGhpcy5lbnN1cmVSZWFkeSgpXG5cbiAgICByZXR1cm4gYXdhaXQgdGhpcy5fd2l0aERiKGFzeW5jIChkYikgPT4ge1xuICAgICAgY29uc3Qgcm93cyA9IGF3YWl0IGRiXG4gICAgICAgIC5uZXdRdWVyeSgpXG4gICAgICAgIC5mcm9tKEpPQlNfVEFCTEUpXG4gICAgICAgIC5zZWxlY3QoXCJzdGF0dXNcIilcbiAgICAgICAgLnNlbGVjdChcIkNPVU5UKCopIEFTIGNvdW50XCIpXG4gICAgICAgIC5ncm91cChcInN0YXR1c1wiKVxuICAgICAgICAucmVzdWx0cygpXG5cbiAgICAgIC8qKlxuICAgICAgICogQ291bnRzLlxuICAgICAgICogQHR5cGUge1JlY29yZDxzdHJpbmcsIG51bWJlcj59ICovXG4gICAgICBjb25zdCBjb3VudHMgPSB7fVxuXG4gICAgICBmb3IgKGNvbnN0IHJvdyBvZiByb3dzKSB7XG4gICAgICAgIGNvbnN0IHR5cGVkUm93ID0gLyoqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59ICovIChyb3cpXG5cbiAgICAgICAgY291bnRzW1N0cmluZyh0eXBlZFJvdy5zdGF0dXMpXSA9IHRoaXMuX25vcm1hbGl6ZU51bWJlcih0eXBlZFJvdy5jb3VudCkgfHwgMFxuICAgICAgfVxuXG4gICAgICByZXR1cm4gY291bnRzXG4gICAgfSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSZXR1cm5zIHRoZSBhdXRob3JpdGF0aXZlIGRhc2hib2FyZCBjb3VudCBzbmFwc2hvdCBhbmQgaXRzIG1hdGNoaW5nIGR1cmFibGVcbiAgICogcmV2aXNpb24uIExvY2tpbmcgdGhlIHJldmlzaW9uIHJvdyBiZWZvcmUgY291bnRpbmcgcHJldmVudHMgYSB3cml0ZXIgZnJvbVxuICAgKiBjb21taXR0aW5nIGJldHdlZW4gdGhlIGNvdW50IHF1ZXJ5IGFuZCByZXZpc2lvbiByZWFkLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx7Y291bnRzOiBSZWNvcmQ8c3RyaW5nLCBudW1iZXI+LCByZXZpc2lvbjogbnVtYmVyLCB0b3RhbDogbnVtYmVyfT59IFNuYXBzaG90LlxuICAgKi9cbiAgYXN5bmMgY291bnRTbmFwc2hvdCgpIHtcbiAgICBhd2FpdCB0aGlzLmVuc3VyZVJlYWR5KClcblxuICAgIHJldHVybiBhd2FpdCB0aGlzLl9zZXJpYWxpemVkQ291bnRNdXRhdGlvbihhc3luYyAoZGIpID0+IHtcbiAgICAgIHJldHVybiBhd2FpdCB0aGlzLl9jb3VudFNuYXBzaG90T25Mb2NrZWRDb25uZWN0aW9uKGRiKVxuICAgIH0pXG4gIH1cblxuICAvKipcbiAgICogQ291bnRzIGpvYnMgbWF0Y2hpbmcgdGhlIGdpdmVuIGZpbHRlcnMuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBbYXJnc10gLSBPcHRpb25zLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gW2FyZ3Muc3RhdHVzXSAtIEZpbHRlciBieSBzdGF0dXMuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBbYXJncy5qb2JOYW1lXSAtIEZpbHRlciBieSBqb2IgbmFtZS5cbiAgICogQHJldHVybnMge1Byb21pc2U8bnVtYmVyPn0gLSBNYXRjaGluZyBqb2IgY291bnQuXG4gICAqL1xuICBhc3luYyBjb3VudEpvYnMoe3N0YXR1cywgam9iTmFtZX0gPSB7fSkge1xuICAgIGF3YWl0IHRoaXMuZW5zdXJlUmVhZHkoKVxuXG4gICAgcmV0dXJuIGF3YWl0IHRoaXMuX3dpdGhEYihhc3luYyAoZGIpID0+IHtcbiAgICAgIGxldCBxdWVyeSA9IGRiLm5ld1F1ZXJ5KCkuZnJvbShKT0JTX1RBQkxFKS5zZWxlY3QoXCJDT1VOVCgqKSBBUyBjb3VudFwiKVxuXG4gICAgICBpZiAoc3RhdHVzKSBxdWVyeSA9IHF1ZXJ5LndoZXJlKHtzdGF0dXN9KVxuICAgICAgaWYgKGpvYk5hbWUpIHF1ZXJ5ID0gcXVlcnkud2hlcmUoe2pvYl9uYW1lOiBqb2JOYW1lfSlcblxuICAgICAgY29uc3Qgcm93cyA9IGF3YWl0IHF1ZXJ5LnJlc3VsdHMoKVxuICAgICAgY29uc3QgY291bnRSb3cgPSAvKiogQHR5cGUge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gKi8gKHJvd3NbMF0gfHwge30pXG5cbiAgICAgIHJldHVybiB0aGlzLl9ub3JtYWxpemVOdW1iZXIoY291bnRSb3cuY291bnQpIHx8IDBcbiAgICB9KVxuICB9XG5cbiAgLyoqXG4gICAqIExpc3RzIGpvYnMgZm9yIHRoZSBkYXNoYm9hcmQsIGZpbHRlcmVkLCBzb3J0ZWQgYW5kIHBhZ2luYXRlZC5cbiAgICogQHBhcmFtIHtvYmplY3R9IFthcmdzXSAtIE9wdGlvbnMuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBbYXJncy5zdGF0dXNdIC0gRmlsdGVyIGJ5IHN0YXR1cy5cbiAgICogQHBhcmFtIHtzdHJpbmd9IFthcmdzLmpvYk5hbWVdIC0gRmlsdGVyIGJ5IGpvYiBuYW1lLlxuICAgKiBAcGFyYW0ge251bWJlcn0gW2FyZ3MubGltaXRdIC0gTWF4aW11bSByb3dzIHRvIHJldHVybi5cbiAgICogQHBhcmFtIHtudW1iZXJ9IFthcmdzLm9mZnNldF0gLSBSb3dzIHRvIHNraXAuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBbYXJncy5zb3J0Q29sdW1uXSAtIENhbWVsLWNhc2VkIGNvbHVtbiB0byBzb3J0IGJ5IChzZWUgU09SVEFCTEVfQ09MVU1OUykuXG4gICAqIEBwYXJhbSB7XCJBU0NcIiB8IFwiREVTQ1wifSBbYXJncy5zb3J0RGlyZWN0aW9uXSAtIFNvcnQgZGlyZWN0aW9uLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxpbXBvcnQoXCIuL3R5cGVzLmpzXCIpLkJhY2tncm91bmRKb2JSb3dbXT59IC0gTm9ybWFsaXplZCBqb2Igcm93cy5cbiAgICovXG4gIGFzeW5jIGxpc3RKb2JzKHtzdGF0dXMsIGpvYk5hbWUsIGxpbWl0ID0gMjUsIG9mZnNldCA9IDAsIHNvcnRDb2x1bW4gPSBcImNyZWF0ZWRBdE1zXCIsIHNvcnREaXJlY3Rpb24gPSBcIkRFU0NcIn0gPSB7fSkge1xuICAgIGF3YWl0IHRoaXMuZW5zdXJlUmVhZHkoKVxuXG4gICAgY29uc3QgY29sdW1uID0gU09SVEFCTEVfQ09MVU1OU1tzb3J0Q29sdW1uXSB8fCBTT1JUQUJMRV9DT0xVTU5TLmNyZWF0ZWRBdE1zXG4gICAgY29uc3QgZGlyZWN0aW9uID0gc29ydERpcmVjdGlvbiA9PT0gXCJBU0NcIiA/IFwiQVNDXCIgOiBcIkRFU0NcIlxuXG4gICAgcmV0dXJuIGF3YWl0IHRoaXMuX3dpdGhEYihhc3luYyAoZGIpID0+IHtcbiAgICAgIGxldCBxdWVyeSA9IGRiLm5ld1F1ZXJ5KCkuZnJvbShKT0JTX1RBQkxFKVxuXG4gICAgICBpZiAoc3RhdHVzKSBxdWVyeSA9IHF1ZXJ5LndoZXJlKHtzdGF0dXN9KVxuICAgICAgaWYgKGpvYk5hbWUpIHF1ZXJ5ID0gcXVlcnkud2hlcmUoe2pvYl9uYW1lOiBqb2JOYW1lfSlcblxuICAgICAgcXVlcnkgPSBxdWVyeS5vcmRlcih7Y29sdW1uLCBkaXJlY3Rpb259KVxuICAgICAgaWYgKGNvbHVtbiAhPT0gU09SVEFCTEVfQ09MVU1OUy5jcmVhdGVkQXRNcykgcXVlcnkgPSBxdWVyeS5vcmRlcih7Y29sdW1uOiBTT1JUQUJMRV9DT0xVTU5TLmNyZWF0ZWRBdE1zLCBkaXJlY3Rpb246IFwiREVTQ1wifSlcblxuICAgICAgY29uc3Qgcm93cyA9IGF3YWl0IHF1ZXJ5LmxpbWl0KGxpbWl0KS5vZmZzZXQob2Zmc2V0KS5yZXN1bHRzKClcblxuICAgICAgcmV0dXJuIHJvd3MubWFwKChyb3cpID0+IHRoaXMuX25vcm1hbGl6ZUpvYlJvdyhyb3cpKVxuICAgIH0pXG4gIH1cblxuICAvKipcbiAgICogUnVucyBtYXJrIGhhbmRlZCBvZmYuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gT3B0aW9ucy5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGFyZ3Muam9iSWQgLSBKb2IgaWQuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBbYXJncy5oYW5kb2ZmSWRdIC0gQ2FsbGVyLXNlbGVjdGVkIGV4YWN0IGxlYXNlIGlkLiBHZW5lcmF0ZWQgZm9yIGxlZ2FjeSBkaXJlY3QgY2FsbGVycyB3aGVuIG9taXR0ZWQuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBbYXJncy53b3JrZXJJZF0gLSBXb3JrZXIgaWQuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPGltcG9ydChcIi4vdHlwZXMuanNcIikuQmFja2dyb3VuZEpvYkhhbmRvZmYgfCBudWxsPn0gLSBDbGFpbWVkIGhhbmRvZmYgbGVhc2UsIG9yIG51bGwgd2hlbiBubyBsb25nZXIgcXVldWVkLlxuICAgKi9cbiAgYXN5bmMgbWFya0hhbmRlZE9mZih7am9iSWQsIGhhbmRvZmZJZCA9IHJhbmRvbVVVSUQoKSwgd29ya2VySWR9KSB7XG4gICAgYXdhaXQgdGhpcy5lbnN1cmVSZWFkeSgpXG5cbiAgICBjb25zdCBoYW5kZWRPZmZBdE1zID0gdGhpcy5jbG9jay5ub3coKVxuXG4gICAgcmV0dXJuIGF3YWl0IHRoaXMuX3NlcmlhbGl6ZWRDb3VudE11dGF0aW9uKGFzeW5jIChkYikgPT4ge1xuICAgICAgY29uc3Qgc2VsZWN0ZWRKb2IgPSBhd2FpdCB0aGlzLl9nZXRKb2JSb3dCeUlkKGRiLCBqb2JJZClcbiAgICAgIGlmICghc2VsZWN0ZWRKb2IgfHwgc2VsZWN0ZWRKb2Iuc3RhdHVzICE9PSBcInF1ZXVlZFwiKSByZXR1cm4gbnVsbFxuICAgICAgY29uc3QgcXVldWVkSm9iID0gYXdhaXQgdGhpcy5fcmVjb25jaWxlUXVldWVkSm9iQ29uY3VycmVuY3koZGIsIHNlbGVjdGVkSm9iKVxuXG4gICAgICBpZiAoIXF1ZXVlZEpvYikgcmV0dXJuIG51bGxcbiAgICAgIGlmIChxdWV1ZWRKb2IuY29uY3VycmVuY3lLZXkgJiYgIShhd2FpdCB0aGlzLl9yZXNlcnZlQ29uY3VycmVuY3koZGIsIHF1ZXVlZEpvYi5jb25jdXJyZW5jeUtleSkpKSByZXR1cm4gbnVsbFxuICAgICAgY29uc3QgYWZmZWN0ZWRSb3dzID0gYXdhaXQgdGhpcy5fdXBkYXRlQWZmZWN0ZWRSb3dzKGRiLCB7XG4gICAgICAgIHRhYmxlTmFtZTogSk9CU19UQUJMRSxcbiAgICAgICAgZGF0YToge1xuICAgICAgICAgIHN0YXR1czogXCJoYW5kZWRfb2ZmXCIsXG4gICAgICAgICAgaGFuZGVkX29mZl9hdF9tczogaGFuZGVkT2ZmQXRNcyxcbiAgICAgICAgICBoYW5kb2ZmX2lkOiBoYW5kb2ZmSWQsXG4gICAgICAgICAgd29ya2VyX2lkOiB3b3JrZXJJZCB8fCBudWxsLFxuICAgICAgICAgIC4uLnRoaXMuX2NsZWFyZWRDaGlsZEFjY2VwdGFuY2VEYXRhKClcbiAgICAgICAgfSxcbiAgICAgICAgY29uZGl0aW9uczoge2NvbmN1cnJlbmN5X2tleTogcXVldWVkSm9iLmNvbmN1cnJlbmN5S2V5LCBpZDogam9iSWQsIHN0YXR1czogXCJxdWV1ZWRcIn1cbiAgICAgIH0pXG5cbiAgICAgIGlmIChhZmZlY3RlZFJvd3MgIT09IDEpIHtcbiAgICAgICAgYXdhaXQgdGhpcy5fcmVsZWFzZUNvbmN1cnJlbmN5KGRiLCBxdWV1ZWRKb2IuY29uY3VycmVuY3lLZXkpXG4gICAgICAgIHJldHVybiBudWxsXG4gICAgICB9XG5cbiAgICAgIGF3YWl0IHRoaXMuX3JlY29yZFN0YXR1c1RyYW5zaXRpb24oZGIsIFwicXVldWVkXCIsIFwiaGFuZGVkX29mZlwiKVxuICAgICAgLyoqIEB0eXBlIHtpbXBvcnQoXCIuL3R5cGVzLmpzXCIpLkJhY2tncm91bmRKb2JSb3d9ICovXG4gICAgICBjb25zdCBoYW5kZWRPZmZKb2IgPSB7XG4gICAgICAgIC4uLnF1ZXVlZEpvYixcbiAgICAgICAgLi4udGhpcy5fY2xlYXJlZENoaWxkQWNjZXB0YW5jZVJvdygpLFxuICAgICAgICBoYW5kZWRPZmZBdE1zLFxuICAgICAgICBoYW5kb2ZmSWQsXG4gICAgICAgIHN0YXR1czogXCJoYW5kZWRfb2ZmXCIsXG4gICAgICAgIHdvcmtlcklkOiB3b3JrZXJJZCB8fCBudWxsXG4gICAgICB9XG5cbiAgICAgIHJldHVybiB7aGFuZGVkT2ZmQXRNcywgaGFuZG9mZklkLCBqb2I6IGhhbmRlZE9mZkpvYn1cbiAgICB9KVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgbWFyayBjb21wbGV0ZWQuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gT3B0aW9ucy5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGFyZ3Muam9iSWQgLSBKb2IgaWQuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBbYXJncy5oYW5kb2ZmSWRdIC0gSGFuZG9mZiBsZWFzZSBpZC5cbiAgICogQHBhcmFtIHtzdHJpbmd9IFthcmdzLndvcmtlcklkXSAtIFdvcmtlciBpZC5cbiAgICogQHBhcmFtIHtudW1iZXJ9IFthcmdzLmhhbmRlZE9mZkF0TXNdIC0gSGFuZGVkIG9mZiB0aW1lc3RhbXAuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPGJvb2xlYW4+fSAtIFdoZXRoZXIgdGhlIGZlbmNlZCByZXBvcnQgd2FzIGFjY2VwdGVkLlxuICAgKi9cbiAgYXN5bmMgbWFya0NvbXBsZXRlZCh7am9iSWQsIGhhbmRvZmZJZCwgd29ya2VySWQsIGhhbmRlZE9mZkF0TXN9KSB7XG4gICAgYXdhaXQgdGhpcy5lbnN1cmVSZWFkeSgpXG5cbiAgICByZXR1cm4gYXdhaXQgdGhpcy5fc2VyaWFsaXplZENvdW50TXV0YXRpb24oYXN5bmMgKGRiKSA9PiB7XG4gICAgICBjb25zdCBqb2IgPSBhd2FpdCB0aGlzLl9nZXRKb2JSb3dCeUlkKGRiLCBqb2JJZClcblxuICAgICAgaWYgKCFqb2IpIHJldHVybiBmYWxzZVxuICAgICAgaWYgKCF0aGlzLl9zaG91bGRBY2NlcHRSZXBvcnQoe2pvYiwgaGFuZG9mZklkLCB3b3JrZXJJZCwgaGFuZGVkT2ZmQXRNc30pKSByZXR1cm4gZmFsc2VcblxuICAgICAgYXdhaXQgdGhpcy5fbG9ja0NvbmN1cnJlbmN5Um93KGRiLCBqb2IuY29uY3VycmVuY3lLZXkpXG4gICAgICBjb25zdCBhZmZlY3RlZFJvd3MgPSBhd2FpdCB0aGlzLl91cGRhdGVBZmZlY3RlZFJvd3MoZGIsIHtcbiAgICAgICAgdGFibGVOYW1lOiBKT0JTX1RBQkxFLFxuICAgICAgICBkYXRhOiB7XG4gICAgICAgICAgc3RhdHVzOiBcImNvbXBsZXRlZFwiLFxuICAgICAgICAgIGNvbXBsZXRlZF9hdF9tczogdGhpcy5jbG9jay5ub3coKVxuICAgICAgICB9LFxuICAgICAgICBjb25kaXRpb25zOiB0aGlzLl9hY3RpdmVIYW5kb2ZmQ29uZGl0aW9ucyhqb2IpXG4gICAgICB9KVxuXG4gICAgICBpZiAoYWZmZWN0ZWRSb3dzICE9PSAxKSByZXR1cm4gZmFsc2VcbiAgICAgIGF3YWl0IHRoaXMuX3JlbGVhc2VTY2hlZHVsZU93bmVyc2hpcEZvckpvYihkYiwgam9iKVxuICAgICAgYXdhaXQgdGhpcy5fcmVsZWFzZUNvbmN1cnJlbmN5KGRiLCBqb2IuY29uY3VycmVuY3lLZXkpXG4gICAgICBhd2FpdCB0aGlzLl9yZWNvcmRTdGF0dXNUcmFuc2l0aW9uKGRiLCBcImhhbmRlZF9vZmZcIiwgXCJjb21wbGV0ZWRcIilcbiAgICAgIHJldHVybiB0cnVlXG4gICAgfSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSZWNvcmRzIHBvb2xlZC1jaGlsZCBhY2NlcHRhbmNlIGV2aWRlbmNlIGZvciBhbiBhY3RpdmUgaGFuZG9mZjogd2hlbiB0aGVcbiAgICogZXhlY3V0aW5nIHJ1bm5lciBjaGlsZCByZWNlaXZlZCBhbmQvb3Igc3RhcnRlZCB0aGUgam9iLCBwbHVzIHRoYXQgY2hpbGQnc1xuICAgKiBzdGFibGUgaWRlbnRpdHkgYW5kIHBpZC4gT25seSB0aGUgZmllbGRzIHN1cHBsaWVkIGFyZSB3cml0dGVuLCBzbyBhXG4gICAqIHJlY2VpdmVkLXRoZW4tc3RhcnRlZCBvYnNlcnZhdGlvbiBsYW5kcyBhcyB0d28gZmVuY2VkIHBhcnRpYWwgdXBkYXRlcy4gVGhlXG4gICAqIHVwZGF0ZSBpcyBmZW5jZWQgYnkgdGhlIGV4YWN0IGFjdGl2ZSBoYW5kb2ZmIGxlYXNlLCBzbyBhIHJlcG9ydCBmb3IgYVxuICAgKiByZWNsYWltZWQgb3IgcmUtaGFuZGVkLW9mZiBqb2IgaXMgZHJvcHBlZCBpbnN0ZWFkIG9mIHN0YW1waW5nIHRoZSB3cm9uZ1xuICAgKiBhdHRlbXB0LlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIE9wdGlvbnMuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBhcmdzLmpvYklkIC0gSm9iIGlkLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gW2FyZ3MuaGFuZG9mZklkXSAtIEhhbmRvZmYgbGVhc2UgaWQuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBbYXJncy53b3JrZXJJZF0gLSBXb3JrZXIgaWQuXG4gICAqIEBwYXJhbSB7bnVtYmVyfSBbYXJncy5oYW5kZWRPZmZBdE1zXSAtIEhhbmRlZCBvZmYgdGltZXN0YW1wLlxuICAgKiBAcGFyYW0ge251bWJlcn0gW2FyZ3MucmVjZWl2ZWRBdE1zXSAtIEVwb2NoIG1zIHRoZSBydW5uZXIgY2hpbGQgcmVjZWl2ZWQgdGhlIGpvYi5cbiAgICogQHBhcmFtIHtudW1iZXJ9IFthcmdzLnN0YXJ0ZWRBdE1zXSAtIEVwb2NoIG1zIHRoZSBqb2IncyBwZXJmb3JtIHN0YXJ0ZWQgaW4gdGhlIGNoaWxkLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gW2FyZ3MuY2hpbGRJbnN0YW5jZUlkXSAtIFN0YWJsZSBwb29sZWQgY2hpbGQgaWRlbnRpdHkuXG4gICAqIEBwYXJhbSB7bnVtYmVyfSBbYXJncy5jaGlsZFBpZF0gLSBQb29sZWQgY2hpbGQgT1MgcGlkLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gW2FyZ3MucnVubmVySG9zdG5hbWVdIC0gSG9zdG5hbWUgb2YgdGhlIG1hY2hpbmUgcnVubmluZyB0aGUgcG9vbGVkIGNoaWxkLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxib29sZWFuPn0gLSBXaGV0aGVyIHRoZSBmZW5jZWQgcmVwb3J0IHdhcyBhY2NlcHRlZC5cbiAgICovXG4gIGFzeW5jIG1hcmtDaGlsZEFjY2VwdGVkKHtqb2JJZCwgaGFuZG9mZklkLCB3b3JrZXJJZCwgaGFuZGVkT2ZmQXRNcywgcmVjZWl2ZWRBdE1zLCBzdGFydGVkQXRNcywgY2hpbGRJbnN0YW5jZUlkLCBjaGlsZFBpZCwgcnVubmVySG9zdG5hbWV9KSB7XG4gICAgYXdhaXQgdGhpcy5lbnN1cmVSZWFkeSgpXG5cbiAgICByZXR1cm4gYXdhaXQgdGhpcy5fc2VyaWFsaXplZENvbm5lY3Rpb25NdXRhdGlvbihhc3luYyAoZGIpID0+IHtcbiAgICAgIGNvbnN0IGpvYiA9IGF3YWl0IHRoaXMuX2dldEpvYlJvd0J5SWQoZGIsIGpvYklkKVxuXG4gICAgICBpZiAoIWpvYikgcmV0dXJuIGZhbHNlXG4gICAgICBpZiAoIXRoaXMuX3Nob3VsZEFjY2VwdFJlcG9ydCh7am9iLCBoYW5kb2ZmSWQsIHdvcmtlcklkLCBoYW5kZWRPZmZBdE1zfSkpIHJldHVybiBmYWxzZVxuXG4gICAgICBjb25zdCBkYXRhID0ge31cbiAgICAgIGlmICh0eXBlb2YgcmVjZWl2ZWRBdE1zID09PSBcIm51bWJlclwiKSBkYXRhLmNoaWxkX3JlY2VpdmVkX2F0X21zID0gcmVjZWl2ZWRBdE1zXG4gICAgICBpZiAodHlwZW9mIHN0YXJ0ZWRBdE1zID09PSBcIm51bWJlclwiKSBkYXRhLmNoaWxkX3N0YXJ0ZWRfYXRfbXMgPSBzdGFydGVkQXRNc1xuICAgICAgaWYgKHR5cGVvZiBjaGlsZEluc3RhbmNlSWQgPT09IFwic3RyaW5nXCIpIGRhdGEuY2hpbGRfaW5zdGFuY2VfaWQgPSBjaGlsZEluc3RhbmNlSWRcbiAgICAgIGlmICh0eXBlb2YgY2hpbGRQaWQgPT09IFwibnVtYmVyXCIpIGRhdGEuY2hpbGRfcGlkID0gY2hpbGRQaWRcbiAgICAgIGlmICh0eXBlb2YgcnVubmVySG9zdG5hbWUgPT09IFwic3RyaW5nXCIpIGRhdGEucnVubmVyX2hvc3RuYW1lID0gcnVubmVySG9zdG5hbWVcbiAgICAgIGlmIChPYmplY3Qua2V5cyhkYXRhKS5sZW5ndGggPT09IDApIHJldHVybiBmYWxzZVxuXG4gICAgICBjb25zdCBhZmZlY3RlZFJvd3MgPSBhd2FpdCB0aGlzLl91cGRhdGVBZmZlY3RlZFJvd3MoZGIsIHtcbiAgICAgICAgdGFibGVOYW1lOiBKT0JTX1RBQkxFLFxuICAgICAgICBkYXRhLFxuICAgICAgICBjb25kaXRpb25zOiB0aGlzLl9hY3RpdmVIYW5kb2ZmQ29uZGl0aW9ucyhqb2IpXG4gICAgICB9KVxuXG4gICAgICByZXR1cm4gYWZmZWN0ZWRSb3dzID09PSAxXG4gICAgfSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSZXR1cm5zIHRoZSBkYXRhYmFzZSBkYXRhIHRoYXQgY2xlYXJzIHBvb2xlZC1jaGlsZCBhY2NlcHRhbmNlIGV2aWRlbmNlLlxuICAgKiBAcmV0dXJucyB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSAtIENsZWFyZWQgYWNjZXB0YW5jZSBjb2x1bW5zLlxuICAgKi9cbiAgX2NsZWFyZWRDaGlsZEFjY2VwdGFuY2VEYXRhKCkge1xuICAgIHJldHVybiB7Y2hpbGRfaW5zdGFuY2VfaWQ6IG51bGwsIGNoaWxkX3BpZDogbnVsbCwgY2hpbGRfcmVjZWl2ZWRfYXRfbXM6IG51bGwsIGNoaWxkX3N0YXJ0ZWRfYXRfbXM6IG51bGwsIHJ1bm5lcl9ob3N0bmFtZTogbnVsbH1cbiAgfVxuXG4gIC8qKlxuICAgKiBSZXR1cm5zIHRoZSByb3ctc2hhcGUgY291bnRlcnBhcnQgb2YgdGhlIGNsZWFyZWQgYWNjZXB0YW5jZSBjb2x1bW5zLlxuICAgKiBAcmV0dXJucyB7UGljazxpbXBvcnQoXCIuL3R5cGVzLmpzXCIpLkJhY2tncm91bmRKb2JSb3csIFwiY2hpbGRJbnN0YW5jZUlkXCIgfCBcImNoaWxkUGlkXCIgfCBcImNoaWxkUmVjZWl2ZWRBdE1zXCIgfCBcImNoaWxkU3RhcnRlZEF0TXNcIiB8IFwicnVubmVySG9zdG5hbWVcIj59IC0gQ2xlYXJlZCBhY2NlcHRhbmNlIGZpZWxkcy5cbiAgICovXG4gIF9jbGVhcmVkQ2hpbGRBY2NlcHRhbmNlUm93KCkge1xuICAgIHJldHVybiB7Y2hpbGRJbnN0YW5jZUlkOiBudWxsLCBjaGlsZFBpZDogbnVsbCwgY2hpbGRSZWNlaXZlZEF0TXM6IG51bGwsIGNoaWxkU3RhcnRlZEF0TXM6IG51bGwsIHJ1bm5lckhvc3RuYW1lOiBudWxsfVxuICB9XG5cbiAgLyoqXG4gICAqIFJldHVybnMgYW4gYWN0aXZlIGhhbmRvZmYgdG8gdGhlIHF1ZXVlIGF0IGEgY2FsbGVyLXJlcXVlc3RlZCBmdXR1cmUgdGltZS5cbiAgICogVGhpcyBpcyBub3JtYWwgam9iIGNvbnRyb2wgZmxvdzogaXQgcHJlc2VydmVzIGZhaWx1cmUgYXR0ZW1wdHMgYW5kIG1ldGFkYXRhLlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIE9wdGlvbnMuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBhcmdzLmpvYklkIC0gSm9iIGlkLlxuICAgKiBAcGFyYW0ge251bWJlcn0gYXJncy5kZWxheU1zIC0gRGVsYXkgZnJvbSBwZXJzaXN0ZW5jZSB0aW1lIGluIG1pbGxpc2Vjb25kcy5cbiAgICogQHBhcmFtIHtzdHJpbmd9IFthcmdzLmhhbmRvZmZJZF0gLSBIYW5kb2ZmIGxlYXNlIGlkLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gW2FyZ3Mud29ya2VySWRdIC0gV29ya2VyIGlkLlxuICAgKiBAcGFyYW0ge251bWJlcn0gW2FyZ3MuaGFuZGVkT2ZmQXRNc10gLSBIYW5kZWQgb2ZmIHRpbWVzdGFtcC5cbiAgICogQHJldHVybnMge1Byb21pc2U8Ym9vbGVhbj59IC0gV2hldGhlciB0aGUgZmVuY2VkIHJlcG9ydCB3YXMgYWNjZXB0ZWQuXG4gICAqL1xuICBhc3luYyBtYXJrUmVzY2hlZHVsZWQoe2pvYklkLCBkZWxheU1zLCBoYW5kb2ZmSWQsIHdvcmtlcklkLCBoYW5kZWRPZmZBdE1zfSkge1xuICAgIGF3YWl0IHRoaXMuZW5zdXJlUmVhZHkoKVxuICAgIHRoaXMuX3ZhbGlkYXRlUmVzY2hlZHVsZURlbGF5TXMoZGVsYXlNcylcblxuICAgIHJldHVybiBhd2FpdCB0aGlzLl9zZXJpYWxpemVkQ291bnRNdXRhdGlvbihhc3luYyAoZGIpID0+IHtcbiAgICAgIGNvbnN0IGpvYiA9IGF3YWl0IHRoaXMuX2dldEpvYlJvd0J5SWQoZGIsIGpvYklkKVxuXG4gICAgICBpZiAoIWpvYikgcmV0dXJuIGZhbHNlXG4gICAgICBpZiAoIXRoaXMuX3Nob3VsZEFjY2VwdFJlcG9ydCh7am9iLCBoYW5kb2ZmSWQsIHdvcmtlcklkLCBoYW5kZWRPZmZBdE1zfSkpIHJldHVybiBmYWxzZVxuXG4gICAgICBhd2FpdCB0aGlzLl9sb2NrQ29uY3VycmVuY3lSb3coZGIsIGpvYi5jb25jdXJyZW5jeUtleSlcbiAgICAgIGNvbnN0IHNjaGVkdWxlZEF0TXMgPSB0aGlzLl9yZXNjaGVkdWxlZEF0TXMoZGVsYXlNcylcbiAgICAgIGNvbnN0IGFmZmVjdGVkUm93cyA9IGF3YWl0IHRoaXMuX3VwZGF0ZUFmZmVjdGVkUm93cyhkYiwge1xuICAgICAgICB0YWJsZU5hbWU6IEpPQlNfVEFCTEUsXG4gICAgICAgIGRhdGE6IHtcbiAgICAgICAgICBzdGF0dXM6IFwicXVldWVkXCIsXG4gICAgICAgICAgc2NoZWR1bGVkX2F0X21zOiBzY2hlZHVsZWRBdE1zLFxuICAgICAgICAgIGhhbmRlZF9vZmZfYXRfbXM6IG51bGwsXG4gICAgICAgICAgaGFuZG9mZl9pZDogbnVsbCxcbiAgICAgICAgICB3b3JrZXJfaWQ6IG51bGwsXG4gICAgICAgICAgLi4udGhpcy5fY2xlYXJlZENoaWxkQWNjZXB0YW5jZURhdGEoKVxuICAgICAgICB9LFxuICAgICAgICBjb25kaXRpb25zOiB0aGlzLl9hY3RpdmVIYW5kb2ZmQ29uZGl0aW9ucyhqb2IpXG4gICAgICB9KVxuXG4gICAgICBpZiAoYWZmZWN0ZWRSb3dzICE9PSAxKSByZXR1cm4gZmFsc2VcbiAgICAgIGF3YWl0IHRoaXMuX3JlbGVhc2VDb25jdXJyZW5jeShkYiwgam9iLmNvbmN1cnJlbmN5S2V5KVxuICAgICAgYXdhaXQgdGhpcy5fcmVjb3JkU3RhdHVzVHJhbnNpdGlvbihkYiwgXCJoYW5kZWRfb2ZmXCIsIFwicXVldWVkXCIpXG4gICAgICByZXR1cm4gdHJ1ZVxuICAgIH0pXG4gIH1cblxuICAvKipcbiAgICogUnVucyBtYXJrIHJldHVybmVkIHRvIHF1ZXVlLlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIE9wdGlvbnMuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBhcmdzLmpvYklkIC0gSm9iIGlkLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gYXJncy5oYW5kb2ZmSWQgLSBIYW5kb2ZmIGxlYXNlIGlkLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyB3aGVuIHVwZGF0ZWQuXG4gICAqL1xuICBhc3luYyBtYXJrUmV0dXJuZWRUb1F1ZXVlKHtqb2JJZCwgaGFuZG9mZklkfSkge1xuICAgIGF3YWl0IHRoaXMuZW5zdXJlUmVhZHkoKVxuXG4gICAgYXdhaXQgdGhpcy5fc2VyaWFsaXplZENvdW50TXV0YXRpb24oYXN5bmMgKGRiKSA9PiB7XG4gICAgICBjb25zdCBqb2IgPSBhd2FpdCB0aGlzLl9nZXRKb2JSb3dCeUlkKGRiLCBqb2JJZClcbiAgICAgIGlmICgham9iIHx8IGpvYi5oYW5kb2ZmSWQgIT09IGhhbmRvZmZJZCB8fCBqb2Iuc3RhdHVzICE9PSBcImhhbmRlZF9vZmZcIikgcmV0dXJuXG4gICAgICBhd2FpdCB0aGlzLl9sb2NrQ29uY3VycmVuY3lSb3coZGIsIGpvYi5jb25jdXJyZW5jeUtleSlcbiAgICAgIGNvbnN0IGFmZmVjdGVkUm93cyA9IGF3YWl0IHRoaXMuX3VwZGF0ZUFmZmVjdGVkUm93cyhkYiwge1xuICAgICAgICB0YWJsZU5hbWU6IEpPQlNfVEFCTEUsXG4gICAgICAgIGRhdGE6IHtcbiAgICAgICAgICBzdGF0dXM6IFwicXVldWVkXCIsXG4gICAgICAgICAgc2NoZWR1bGVkX2F0X21zOiB0aGlzLmNsb2NrLm5vdygpLFxuICAgICAgICAgIGhhbmRlZF9vZmZfYXRfbXM6IG51bGwsXG4gICAgICAgICAgaGFuZG9mZl9pZDogbnVsbCxcbiAgICAgICAgICB3b3JrZXJfaWQ6IG51bGwsXG4gICAgICAgICAgLi4udGhpcy5fY2xlYXJlZENoaWxkQWNjZXB0YW5jZURhdGEoKVxuICAgICAgICB9LFxuICAgICAgICBjb25kaXRpb25zOiB7aGFuZG9mZl9pZDogaGFuZG9mZklkLCBpZDogam9iSWQsIHN0YXR1czogXCJoYW5kZWRfb2ZmXCJ9XG4gICAgICB9KVxuICAgICAgaWYgKGFmZmVjdGVkUm93cyA9PT0gMSkge1xuICAgICAgICBhd2FpdCB0aGlzLl9yZWxlYXNlQ29uY3VycmVuY3koZGIsIGpvYi5jb25jdXJyZW5jeUtleSlcbiAgICAgICAgYXdhaXQgdGhpcy5fcmVjb3JkU3RhdHVzVHJhbnNpdGlvbihkYiwgXCJoYW5kZWRfb2ZmXCIsIFwicXVldWVkXCIpXG4gICAgICB9XG4gICAgfSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSZXR1cm5zIHRoZSBhY3RpdmUgYGhhbmRlZF9vZmZgIGpvYnMgKGpvYklkICsgaGFuZG9mZklkKSBoZWxkIHVuZGVyIGEgd29ya2VyXG4gICAqIGlkLiBVc2VkIG9uIHdvcmtlciByZWNvbm5lY3Q6IGFmdGVyIGEgbWFpbiByZXN0YXJ0IGEgd29ya2VyIHJlY29ubmVjdHMgd2l0aFxuICAgKiBpdHMgc3RhYmxlIGlkLCBhbmQgdGhlIGZyZXNoIG1haW4gYWRvcHRzIHRoZXNlIGxlYXNlcyBzbyB0aGV5IGFyZSB0cmFja2VkIOKAlFxuICAgKiBhbmQgcmVsZWFzZWQgaWYgdGhlIHJlY29ubmVjdGVkIHdvcmtlciBsYXRlciBkaXNjb25uZWN0cyDigJQgaW5zdGVhZCBvZlxuICAgKiBzaXR0aW5nIHN0dWNrIHVudGlsIHRoZSBhZ2UtYmFzZWQgb3JwaGFuIHN3ZWVwLiBUaGlzIG5ldmVyIHJlY2xhaW1zLCBzbyBhXG4gICAqIGdyYWNlZnVsbHktZHJhaW5pbmcgd29ya2VyIHRoYXQga2VlcHMgcnVubmluZyBpdHMgaW4tZmxpZ2h0IGpvYnMgaXMgbGVmdFxuICAgKiB1bnRvdWNoZWQuIFJvd3Mgd2l0aCBhIG51bGwgaGFuZG9mZiBpZCAobGVnYWN5KSBhcmUgc2tpcHBlZDsgdGhlIG9ycGhhblxuICAgKiBzd2VlcCByZWNsYWltcyB0aG9zZSB2aWEgaXRzIGBoYW5kZWRfb2ZmX2F0X21zYCBmZW5jZS5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBPcHRpb25zLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gYXJncy53b3JrZXJJZCAtIFdvcmtlciBpZC5cbiAgICogQHJldHVybnMge1Byb21pc2U8QXJyYXk8e2pvYklkOiBzdHJpbmcsIGhhbmRvZmZJZDogc3RyaW5nfT4+fSAtIEFjdGl2ZSBoYW5kb2Zmcy5cbiAgICovXG4gIGFzeW5jIGhhbmRlZE9mZkpvYnNGb3JXb3JrZXIoe3dvcmtlcklkfSkge1xuICAgIGF3YWl0IHRoaXMuZW5zdXJlUmVhZHkoKVxuXG4gICAgY29uc3Qgcm93cyA9IGF3YWl0IHRoaXMuX3dpdGhEYihhc3luYyAoZGIpID0+XG4gICAgICBhd2FpdCBkYi5uZXdRdWVyeSgpLmZyb20oSk9CU19UQUJMRSkud2hlcmUoe3N0YXR1czogXCJoYW5kZWRfb2ZmXCIsIHdvcmtlcl9pZDogd29ya2VySWR9KS5yZXN1bHRzKClcbiAgICApXG5cbiAgICAvKiogQHR5cGUge0FycmF5PHtqb2JJZDogc3RyaW5nLCBoYW5kb2ZmSWQ6IHN0cmluZ30+fSAqL1xuICAgIGNvbnN0IGhhbmRvZmZzID0gW11cblxuICAgIGZvciAoY29uc3Qgcm93IG9mIHJvd3MpIHtcbiAgICAgIGNvbnN0IGpvYiA9IHRoaXMuX25vcm1hbGl6ZUpvYlJvdyhyb3cpXG5cbiAgICAgIGlmIChqb2IuaGFuZG9mZklkKSBoYW5kb2Zmcy5wdXNoKHtqb2JJZDogam9iLmlkLCBoYW5kb2ZmSWQ6IGpvYi5oYW5kb2ZmSWR9KVxuICAgIH1cblxuICAgIHJldHVybiBoYW5kb2Zmc1xuICB9XG5cbiAgLyoqXG4gICAqIFNuYXBzaG90cyBleGFjdCwgbGVhc2UtYXdhcmUgYWN0aXZlIGhhbmRvZmZzIGJlZm9yZSBhIG5ldyBtYWluIGdlbmVyYXRpb25cbiAgICogc3RhcnRzIGFjY2VwdGluZyB3b3JrZXIgcmVjb25uZWN0cy4gTGVnYWN5IHJvd3Mgd2l0aG91dCBhIGNvbXBsZXRlIHdvcmtlcixcbiAgICogbGVhc2UsIGFuZCB0aW1lc3RhbXAgaWRlbnRpdHkgc3RheSBvd25lZCBieSB0aGUgYWdlLWJhc2VkIG9ycGhhbiBzd2VlcC5cbiAgICogQHJldHVybnMge1Byb21pc2U8aW1wb3J0KFwiLi90eXBlcy5qc1wiKS5CYWNrZ3JvdW5kSm9iSGFuZG9mZlNuYXBzaG90W10+fSAtIEV4YWN0IHN0YXJ0dXAgaGFuZG9mZnMuXG4gICAqL1xuICBhc3luYyBzbmFwc2hvdEhhbmRlZE9mZkpvYnMoKSB7XG4gICAgYXdhaXQgdGhpcy5lbnN1cmVSZWFkeSgpXG5cbiAgICBjb25zdCByb3dzID0gYXdhaXQgdGhpcy5fd2l0aERiKGFzeW5jIChkYikgPT4gYXdhaXQgZGJcbiAgICAgIC5uZXdRdWVyeSgpXG4gICAgICAuZnJvbShKT0JTX1RBQkxFKVxuICAgICAgLndoZXJlKHtzdGF0dXM6IFwiaGFuZGVkX29mZlwifSlcbiAgICAgIC5vcmRlcihcImNyZWF0ZWRfYXRfbXMgQVNDXCIpXG4gICAgICAub3JkZXIoXCJpZCBBU0NcIilcbiAgICAgIC5yZXN1bHRzKCkpXG4gICAgLyoqIEB0eXBlIHtpbXBvcnQoXCIuL3R5cGVzLmpzXCIpLkJhY2tncm91bmRKb2JIYW5kb2ZmU25hcHNob3RbXX0gKi9cbiAgICBjb25zdCBoYW5kb2ZmcyA9IFtdXG5cbiAgICBmb3IgKGNvbnN0IHJvdyBvZiByb3dzKSB7XG4gICAgICBjb25zdCBqb2IgPSB0aGlzLl9ub3JtYWxpemVKb2JSb3cocm93KVxuXG4gICAgICBpZiAoIWpvYi5oYW5kb2ZmSWQgfHwgIWpvYi53b3JrZXJJZCB8fCB0eXBlb2Ygam9iLmhhbmRlZE9mZkF0TXMgIT09IFwibnVtYmVyXCIpIGNvbnRpbnVlXG5cbiAgICAgIGhhbmRvZmZzLnB1c2goe1xuICAgICAgICBoYW5kZWRPZmZBdE1zOiBqb2IuaGFuZGVkT2ZmQXRNcyxcbiAgICAgICAgaGFuZG9mZklkOiBqb2IuaGFuZG9mZklkLFxuICAgICAgICBqb2JJZDogam9iLmlkLFxuICAgICAgICB3b3JrZXJJZDogam9iLndvcmtlcklkXG4gICAgICB9KVxuICAgIH1cblxuICAgIHJldHVybiBoYW5kb2Zmc1xuICB9XG5cbiAgLyoqXG4gICAqIFJlY2xhaW1zIG9ubHkgdW5jaGFuZ2VkIGV4YWN0IGhhbmRvZmZzIHNlbGVjdGVkIGJ5IGEgbWFpbi1nZW5lcmF0aW9uIHN0YXJ0dXBcbiAgICogc25hcHNob3QuIFRoZSBvcmRpbmFyeSBvcnBoYW4gZmFpbHVyZSBwYXRoIG93bnMgcmV0cmllcywgdGVybWluYWwgc3RhdHVzLFxuICAgKiBjb3VudCB0cmFuc2l0aW9ucywgc2NoZWR1bGUgb3duZXJzaGlwLCBhbmQgY29uY3VycmVuY3kgcmVsZWFzZS5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBPcHRpb25zLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vdHlwZXMuanNcIikuQmFja2dyb3VuZEpvYkhhbmRvZmZTbmFwc2hvdFtdfSBhcmdzLmhhbmRvZmZzIC0gRXhhY3Qgc3RhcnR1cCBzbmFwc2hvdHMuXG4gICAqIEBwYXJhbSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59IGFyZ3MuZXJyb3IgLSBPcnBoYW4gcmVhc29uLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxpbXBvcnQoXCIuL3R5cGVzLmpzXCIpLkJhY2tncm91bmRKb2JSb3dbXT59IC0gQWNjZXB0ZWQgdHJhbnNpdGlvbnMuXG4gICAqL1xuICBhc3luYyBtYXJrT3JwaGFuZWRIYW5kb2Zmcyh7aGFuZG9mZnMsIGVycm9yfSkge1xuICAgIGF3YWl0IHRoaXMuZW5zdXJlUmVhZHkoKVxuXG4gICAgcmV0dXJuIGF3YWl0IHRoaXMuX3NlcmlhbGl6ZWRDb3VudE11dGF0aW9uKGFzeW5jIChkYikgPT4ge1xuICAgICAgLyoqIEB0eXBlIHtCYWNrZ3JvdW5kSm9iT3JwaGFuU2VsZWN0aW9uW119ICovXG4gICAgICBjb25zdCBzZWxlY3Rpb25zID0gW11cblxuICAgICAgZm9yIChjb25zdCBoYW5kb2ZmIG9mIGhhbmRvZmZzKSB7XG4gICAgICAgIGNvbnN0IGpvYiA9IGF3YWl0IHRoaXMuX2dldEpvYlJvd0J5SWQoZGIsIGhhbmRvZmYuam9iSWQpXG5cbiAgICAgICAgaWYgKCFqb2IgfHwgam9iLnN0YXR1cyAhPT0gXCJoYW5kZWRfb2ZmXCIpIGNvbnRpbnVlXG4gICAgICAgIGlmIChqb2IuaGFuZG9mZklkICE9PSBoYW5kb2ZmLmhhbmRvZmZJZCkgY29udGludWVcbiAgICAgICAgaWYgKGpvYi53b3JrZXJJZCAhPT0gaGFuZG9mZi53b3JrZXJJZCkgY29udGludWVcbiAgICAgICAgaWYgKGpvYi5oYW5kZWRPZmZBdE1zICE9PSBoYW5kb2ZmLmhhbmRlZE9mZkF0TXMpIGNvbnRpbnVlXG5cbiAgICAgICAgc2VsZWN0aW9ucy5wdXNoKHtcbiAgICAgICAgICBjb25kaXRpb25zOiB7XG4gICAgICAgICAgICBoYW5kZWRfb2ZmX2F0X21zOiBoYW5kb2ZmLmhhbmRlZE9mZkF0TXMsXG4gICAgICAgICAgICBoYW5kb2ZmX2lkOiBoYW5kb2ZmLmhhbmRvZmZJZCxcbiAgICAgICAgICAgIGlkOiBoYW5kb2ZmLmpvYklkLFxuICAgICAgICAgICAgc3RhdHVzOiBcImhhbmRlZF9vZmZcIixcbiAgICAgICAgICAgIHdvcmtlcl9pZDogaGFuZG9mZi53b3JrZXJJZFxuICAgICAgICAgIH0sXG4gICAgICAgICAgam9iXG4gICAgICAgIH0pXG4gICAgICB9XG5cbiAgICAgIHJldHVybiBhd2FpdCB0aGlzLl9tYXJrT3JwaGFuU2VsZWN0aW9ucyh7ZGIsIGVycm9yLCBzZWxlY3Rpb25zfSlcbiAgICB9KVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgbWFyayBmYWlsZWQuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gT3B0aW9ucy5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGFyZ3Muam9iSWQgLSBKb2IgaWQuXG4gICAqIEBwYXJhbSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59IGFyZ3MuZXJyb3IgLSBFcnJvci5cbiAgICogQHBhcmFtIHtzdHJpbmd9IFthcmdzLmhhbmRvZmZJZF0gLSBIYW5kb2ZmIGxlYXNlIGlkLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gW2FyZ3Mud29ya2VySWRdIC0gV29ya2VyIGlkLlxuICAgKiBAcGFyYW0ge251bWJlcn0gW2FyZ3MuaGFuZGVkT2ZmQXRNc10gLSBIYW5kZWQgb2ZmIHRpbWVzdGFtcC5cbiAgICogQHJldHVybnMge1Byb21pc2U8aW1wb3J0KFwiLi90eXBlcy5qc1wiKS5CYWNrZ3JvdW5kSm9iUm93IHwgbnVsbD59IC0gVXBkYXRlZCBqb2Igcm93IHdoZW4gdGhlIHJlcG9ydCB3YXMgYWNjZXB0ZWQuXG4gICAqL1xuICBhc3luYyBtYXJrRmFpbGVkKHtqb2JJZCwgZXJyb3IsIGhhbmRvZmZJZCwgd29ya2VySWQsIGhhbmRlZE9mZkF0TXN9KSB7XG4gICAgYXdhaXQgdGhpcy5lbnN1cmVSZWFkeSgpXG5cbiAgICByZXR1cm4gYXdhaXQgdGhpcy5fc2VyaWFsaXplZENvdW50TXV0YXRpb24oYXN5bmMgKGRiKSA9PiB7XG4gICAgICBjb25zdCBqb2IgPSBhd2FpdCB0aGlzLl9nZXRKb2JSb3dCeUlkKGRiLCBqb2JJZClcblxuICAgICAgaWYgKCFqb2IpIHJldHVybiBudWxsXG4gICAgICBpZiAoIXRoaXMuX3Nob3VsZEFjY2VwdFJlcG9ydCh7am9iLCBoYW5kb2ZmSWQsIHdvcmtlcklkLCBoYW5kZWRPZmZBdE1zfSkpIHJldHVybiBudWxsXG5cbiAgICAgIGNvbnN0IHVwZGF0ZWRKb2IgPSBhd2FpdCB0aGlzLl9hcHBseUZhaWx1cmUoe2RiLCBqb2IsIGVycm9yLCBtYXJrT3JwaGFuZWQ6IGZhbHNlfSlcblxuICAgICAgaWYgKHVwZGF0ZWRKb2IpIGF3YWl0IHRoaXMuX3JlY29yZFN0YXR1c1RyYW5zaXRpb24oZGIsIGpvYi5zdGF0dXMsIHVwZGF0ZWRKb2Iuc3RhdHVzKVxuICAgICAgcmV0dXJuIHVwZGF0ZWRKb2JcbiAgICB9KVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgbWFyayBvcnBoYW5lZCBqb2JzLlxuICAgKiBAcGFyYW0ge29iamVjdH0gW2FyZ3NdIC0gT3B0aW9ucy5cbiAgICogQHBhcmFtIHtudW1iZXJ9IFthcmdzLm9ycGhhbmVkQWZ0ZXJNc10gLSBNYXJrIGpvYnMgb3JwaGFuZWQgYWZ0ZXIgdGhpcyBkdXJhdGlvbi5cbiAgICogQHJldHVybnMge1Byb21pc2U8aW1wb3J0KFwiLi90eXBlcy5qc1wiKS5CYWNrZ3JvdW5kSm9iUm93W10+fSAtIFRoZSBqb2JzIHRoaXMgc3dlZXAgbWFya2VkIG9ycGhhbmVkLlxuICAgKi9cbiAgYXN5bmMgbWFya09ycGhhbmVkSm9icyh7b3JwaGFuZWRBZnRlck1zID0gT1JQSEFORURfQUZURVJfTVN9ID0ge30pIHtcbiAgICBhd2FpdCB0aGlzLmVuc3VyZVJlYWR5KClcblxuICAgIHJldHVybiBhd2FpdCB0aGlzLl9zZXJpYWxpemVkQ291bnRNdXRhdGlvbihhc3luYyAoZGIpID0+IHtcbiAgICAgIGNvbnN0IGN1dG9mZiA9IHRoaXMuY2xvY2subm93KCkgLSBvcnBoYW5lZEFmdGVyTXNcbiAgICAgIGNvbnN0IHF1ZXJ5ID0gZGJcbiAgICAgICAgLm5ld1F1ZXJ5KClcbiAgICAgICAgLmZyb20oSk9CU19UQUJMRSlcbiAgICAgICAgLndoZXJlKHtzdGF0dXM6IFwiaGFuZGVkX29mZlwifSlcbiAgICAgICAgLndoZXJlKGBoYW5kZWRfb2ZmX2F0X21zIDw9ICR7ZGIucXVvdGUoY3V0b2ZmKX1gKVxuXG4gICAgICBjb25zdCByb3dzID0gYXdhaXQgcXVlcnkucmVzdWx0cygpXG5cbiAgICAgIC8qKiBAdHlwZSB7QmFja2dyb3VuZEpvYk9ycGhhblNlbGVjdGlvbltdfSAqL1xuICAgICAgY29uc3Qgc2VsZWN0aW9ucyA9IFtdXG5cbiAgICAgIGZvciAoY29uc3Qgcm93IG9mIHJvd3MpIHtcbiAgICAgICAgY29uc3Qgam9iID0gdGhpcy5fbm9ybWFsaXplSm9iUm93KHJvdylcblxuICAgICAgICAvLyBGZW5jZSB0aGUgcmVjbGFpbSBvbiB0aGUgZXhhY3QgaGFuZG9mZiB0aGlzIHN3ZWVwIHNlbGVjdGVkLCB1c2luZyBpdHNcbiAgICAgICAgLy8gYGhhbmRlZF9vZmZfYXRfbXNgIHJhdGhlciB0aGFuIGl0cyBgaGFuZG9mZl9pZGAuIFR3byByZWFzb25zOlxuICAgICAgICAvLyAgIDEuIE51bGwtc2FmZS4gU29tZSByb3dzIGhhdmUgYSBudWxsIGBoYW5kb2ZmX2lkYCAoaGFuZGVkIG9mZiBieSBhblxuICAgICAgICAvLyAgICAgIG9sZGVyIHZlbG9jaW91cyBiZWZvcmUgaGFuZG9mZi1pZCBmZW5jaW5nKS4gYHtoYW5kb2ZmX2lkOiBudWxsfWBcbiAgICAgICAgLy8gICAgICByZW5kZXJzIGFzIGBoYW5kb2ZmX2lkID0gTlVMTGAsIHdoaWNoIG1hdGNoZXMgbm90aGluZywgc28gdGhvc2VcbiAgICAgICAgLy8gICAgICByb3dzIHdvdWxkIGJlIHN0cmFuZGVkIGluIGBoYW5kZWRfb2ZmYCBmb3JldmVyLlxuICAgICAgICAvLyAgIDIuIFJhY2Utc2FmZS4gSWYgdGhlIHJvdyBpcyByZXR1cm5lZCB0byB0aGUgcXVldWUgYW5kIHJlLWhhbmRlZC1vZmZcbiAgICAgICAgLy8gICAgICBiZXR3ZWVuIHRoZSBTRUxFQ1QgYWJvdmUgYW5kIHRoaXMgdXBkYXRlLCBpdCBnZXRzIGEgZnJlc2hcbiAgICAgICAgLy8gICAgICBgaGFuZGVkX29mZl9hdF9tc2AgKGFsd2F5cyBcIm5vd1wiKSwgc28gdGhpcyBzdGFsZSBjdXRvZmYtZXJhXG4gICAgICAgIC8vICAgICAgdGltZXN0YW1wIG5vIGxvbmdlciBtYXRjaGVzIGFuZCB3ZSB3b24ndCBmYWlsL29ycGhhbiDigJQgb3JcbiAgICAgICAgLy8gICAgICB3cm9uZ2x5IHJlbGVhc2UgdGhlIGNvbmN1cnJlbmN5IHJlc2VydmF0aW9uIG9mIOKAlCB0aGF0IG5ldyBsZWFzZS5cbiAgICAgICAgLy8gYGhhbmRlZF9vZmZfYXRfbXNgIGlzIGFsd2F5cyBzZXQgb24gYSBoYW5kZWQtb2ZmIHJvdyAoYW5kIHRoZSBTRUxFQ1RcbiAgICAgICAgLy8gcmVxdWlyZWQgaXQgYDw9IGN1dG9mZmApLCBzbyBpdCBpcyBhIHJlbGlhYmxlIG51bGwtc2FmZSBsZWFzZSBwaW4uXG4gICAgICAgIHNlbGVjdGlvbnMucHVzaCh7XG4gICAgICAgICAgY29uZGl0aW9uczoge2lkOiBqb2IuaWQsIHN0YXR1czogXCJoYW5kZWRfb2ZmXCIsIGhhbmRlZF9vZmZfYXRfbXM6IGpvYi5oYW5kZWRPZmZBdE1zfSxcbiAgICAgICAgICBqb2JcbiAgICAgICAgfSlcbiAgICAgIH1cblxuICAgICAgcmV0dXJuIGF3YWl0IHRoaXMuX21hcmtPcnBoYW5TZWxlY3Rpb25zKHtcbiAgICAgICAgZGIsXG4gICAgICAgIGVycm9yOiBcIkpvYiBvcnBoYW5lZCBhZnRlciB0aW1lb3V0XCIsXG4gICAgICAgIHNlbGVjdGlvbnNcbiAgICAgIH0pXG4gICAgfSlcbiAgfVxuXG4gIC8qKlxuICAgKiBBcHBsaWVzIHRoZSBjb21tb24gZmVuY2VkIG9ycGhhbiB0cmFuc2l0aW9uIGFuZCByZWNvcmRzIG9uZSBhZ2dyZWdhdGUgY291bnRcbiAgICogZGVsdGEgZm9yIHRoZSBhY2NlcHRlZCByb3dzLlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIE9wdGlvbnMuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vZGF0YWJhc2UvZHJpdmVycy9iYXNlLmpzXCIpLmRlZmF1bHR9IGFyZ3MuZGIgLSBUcmFuc2FjdGlvbiBjb25uZWN0aW9uLlxuICAgKiBAcGFyYW0ge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSBhcmdzLmVycm9yIC0gT3JwaGFuIHJlYXNvbi5cbiAgICogQHBhcmFtIHtCYWNrZ3JvdW5kSm9iT3JwaGFuU2VsZWN0aW9uW119IGFyZ3Muc2VsZWN0aW9ucyAtIFNlbGVjdGVkIGhhbmRvZmZzIGFuZCBleGFjdCBmZW5jZXMuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPGltcG9ydChcIi4vdHlwZXMuanNcIikuQmFja2dyb3VuZEpvYlJvd1tdPn0gLSBBY2NlcHRlZCB0cmFuc2l0aW9ucy5cbiAgICovXG4gIGFzeW5jIF9tYXJrT3JwaGFuU2VsZWN0aW9ucyh7ZGIsIGVycm9yLCBzZWxlY3Rpb25zfSkge1xuICAgIC8qKiBAdHlwZSB7aW1wb3J0KFwiLi90eXBlcy5qc1wiKS5CYWNrZ3JvdW5kSm9iUm93W119ICovXG4gICAgY29uc3Qgb3JwaGFuZWRKb2JzID0gW11cblxuICAgIGZvciAoY29uc3Qge2NvbmRpdGlvbnMsIGpvYn0gb2Ygc2VsZWN0aW9ucykge1xuICAgICAgY29uc3Qgb3JwaGFuZWRKb2IgPSBhd2FpdCB0aGlzLl9hcHBseUZhaWx1cmUoe1xuICAgICAgICBjb25kaXRpb25zLFxuICAgICAgICBkYixcbiAgICAgICAgZXJyb3IsXG4gICAgICAgIGpvYixcbiAgICAgICAgbWFya09ycGhhbmVkOiB0cnVlXG4gICAgICB9KVxuXG4gICAgICBpZiAob3JwaGFuZWRKb2IpIG9ycGhhbmVkSm9icy5wdXNoKG9ycGhhbmVkSm9iKVxuICAgIH1cblxuICAgIGNvbnN0IHN0YXR1c0NvdW50cyA9IHRoaXMuX3N0YXR1c0NvdW50cyhvcnBoYW5lZEpvYnMpXG4gICAgY29uc3QgZGVsdGFzID0gdGhpcy5fZW1wdHlDb3VudEJ1Y2tldHMoKVxuXG4gICAgZm9yIChjb25zdCBbc3RhdHVzLCBjb3VudF0gb2YgT2JqZWN0LmVudHJpZXMoc3RhdHVzQ291bnRzKSkge1xuICAgICAgZGVsdGFzLmhhbmRlZF9vZmYgLT0gY291bnRcbiAgICAgIGRlbHRhc1tzdGF0dXNdICs9IGNvdW50XG4gICAgfVxuICAgIGF3YWl0IHRoaXMuX3JlY29yZENvdW50RGVsdGEoZGIsIGRlbHRhcylcblxuICAgIHJldHVybiBvcnBoYW5lZEpvYnNcbiAgfVxuXG4gIC8qKlxuICAgKiBEZWxldGVzIHRlcm1pbmFsIGpvYiByb3dzIHBhc3QgdGhlaXIgcmV0ZW50aW9uIHdpbmRvdyBzbyB0aGUgam9icyB0YWJsZVxuICAgKiBkb2VzIG5vdCBncm93IHVuYm91bmRlZCAoY29tcGxldGVkIHJvd3MgaW4gcGFydGljdWxhciBhY2N1bXVsYXRlIGZvcmV2ZXJcbiAgICogb3RoZXJ3aXNlKS4gQmF0Y2hlZCBieSBpZCDigJQgU0VMRUNUIGEgcGFnZSBvZiBpZHMsIHRoZW5cbiAgICogYERFTEVURSAuLi4gV0hFUkUgaWQgSU4gKC4uLilgIOKAlCByYXRoZXIgdGhhbiBgREVMRVRFIC4uLiBMSU1JVGAsIHdoaWNoIG5vdFxuICAgKiBldmVyeSBkcml2ZXIgc3VwcG9ydHM7IGVhY2ggYmF0Y2ggcnVucyBvbiBpdHMgb3duIGNvbm5lY3Rpb24gc28gdGhlIHN3ZWVwXG4gICAqIHlpZWxkcyBiZXR3ZWVuIGJhdGNoZXMgaW5zdGVhZCBvZiBob2xkaW5nIG9uZSBsb25nIHRyYW5zYWN0aW9uLlxuICAgKiBAcGFyYW0ge29iamVjdH0gW2FyZ3NdIC0gT3B0aW9ucy5cbiAgICogQHBhcmFtIHtudW1iZXIgfCBudWxsfSBbYXJncy5jb21wbGV0ZWRUdGxNc10gLSBEZWxldGUgYGNvbXBsZXRlZGAgam9icyB3aG9zZSBgY29tcGxldGVkX2F0X21zYCBpcyBvbGRlciB0aGFuIHRoaXMgbWFueSBtcy4gRmFsc3kgb3IgYDw9IDBgIGRpc2FibGVzIGNvbXBsZXRlZCBwcnVuaW5nLlxuICAgKiBAcGFyYW0ge251bWJlciB8IG51bGx9IFthcmdzLmZhaWxlZFR0bE1zXSAtIERlbGV0ZSB0ZXJtaW5hbCBgZmFpbGVkYC9gb3JwaGFuZWRgIGpvYnMgb2xkZXIgdGhhbiB0aGlzIG1hbnkgbXMgKGJ5IGBmYWlsZWRfYXRfbXNgL2BvcnBoYW5lZF9hdF9tc2ApLiBGYWxzeSBvciBgPD0gMGAgZGlzYWJsZXMuXG4gICAqIEBwYXJhbSB7bnVtYmVyfSBbYXJncy5iYXRjaFNpemVdIC0gTWF4IHJvd3MgZGVsZXRlZCBwZXIgYmF0Y2guIERlZmF1bHQgYDEwMDBgLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxudW1iZXI+fSAtIFRvdGFsIHJvd3MgZGVsZXRlZC5cbiAgICovXG4gIGFzeW5jIHBydW5lVGVybWluYWxKb2JzKHtjb21wbGV0ZWRUdGxNcyA9IG51bGwsIGZhaWxlZFR0bE1zID0gbnVsbCwgYmF0Y2hTaXplID0gMTAwMH0gPSB7fSkge1xuICAgIGF3YWl0IHRoaXMuZW5zdXJlUmVhZHkoKVxuXG4gICAgY29uc3Qgbm93ID0gdGhpcy5jbG9jay5ub3coKVxuICAgIGNvbnN0IHNpemUgPSBiYXRjaFNpemUgPiAwID8gYmF0Y2hTaXplIDogMTAwMFxuICAgIGxldCBkZWxldGVkID0gMFxuXG4gICAgaWYgKGNvbXBsZXRlZFR0bE1zICYmIGNvbXBsZXRlZFR0bE1zID4gMCkge1xuICAgICAgZGVsZXRlZCArPSBhd2FpdCB0aGlzLl9wcnVuZVN0YXR1c0JhdGNoZXMoe3N0YXR1czogXCJjb21wbGV0ZWRcIiwgY29sdW1uOiBcImNvbXBsZXRlZF9hdF9tc1wiLCBjdXRvZmY6IG5vdyAtIGNvbXBsZXRlZFR0bE1zLCBiYXRjaFNpemU6IHNpemV9KVxuICAgIH1cblxuICAgIGlmIChmYWlsZWRUdGxNcyAmJiBmYWlsZWRUdGxNcyA+IDApIHtcbiAgICAgIGRlbGV0ZWQgKz0gYXdhaXQgdGhpcy5fcHJ1bmVTdGF0dXNCYXRjaGVzKHtzdGF0dXM6IFwiZmFpbGVkXCIsIGNvbHVtbjogXCJmYWlsZWRfYXRfbXNcIiwgY3V0b2ZmOiBub3cgLSBmYWlsZWRUdGxNcywgYmF0Y2hTaXplOiBzaXplfSlcbiAgICAgIGRlbGV0ZWQgKz0gYXdhaXQgdGhpcy5fcHJ1bmVTdGF0dXNCYXRjaGVzKHtzdGF0dXM6IFwib3JwaGFuZWRcIiwgY29sdW1uOiBcIm9ycGhhbmVkX2F0X21zXCIsIGN1dG9mZjogbm93IC0gZmFpbGVkVHRsTXMsIGJhdGNoU2l6ZTogc2l6ZX0pXG4gICAgfVxuXG4gICAgcmV0dXJuIGRlbGV0ZWRcbiAgfVxuXG4gIC8qKlxuICAgKiBEZWxldGVzIHJvd3Mgb2Ygb25lIHRlcm1pbmFsIHN0YXR1cyBvbGRlciB0aGFuIGEgY3V0b2ZmLCBiYXRjaCBieSBiYXRjaCxcbiAgICogdW50aWwgYSBjYW5kaWRhdGUgcGFnZSByZXR1cm5zIGZld2VyIHRoYW4gYGJhdGNoU2l6ZWAgcm93cy4gQ2FuZGlkYXRlXG4gICAqIGRpc2NvdmVyeSBydW5zIG9uIGEgcGxhaW4gY29ubmVjdGlvbiDigJQgbmV2ZXIgaW5zaWRlIHRoZSBzZXJpYWxpemVkIGNvdW50XG4gICAqIG11dGF0aW9uIOKAlCBzbyBhIGxvbmcgc2NhbiBjYW5ub3QgaG9sZCB0aGUgY291bnQtcmV2aXNpb24gbG9jayBhbmQgc3RhcnZlXG4gICAqIGVucXVldWUgYWNrbm93bGVkZ2VtZW50czsgb25seSB0aGUgc2hvcnQgZGVsZXRlIHRyYW5zYWN0aW9uIGlzIHNlcmlhbGl6ZWQuXG4gICAqIFRoZSBkZWxldGUgcmV2YWxpZGF0ZXMgc3RhdHVzIGFuZCBjdXRvZmYgZm9yIHRoZSBzZWxlY3RlZCBpZHMsIHB1Ymxpc2hlc1xuICAgKiB0aGUgZGVsdGEgZnJvbSB0aGUgYWN0dWFsIGFmZmVjdGVkLXJvdyBjb3VudCwgYW5kIGEgcGFnZSB3aG9zZSBjYW5kaWRhdGVzXG4gICAqIHdlcmUgYWxyZWFkeSByZW1vdmVkIGJ5IGEgY29uY3VycmVudCBwcnVuZXIgc3RpbGwgZW5kcyB0aGUgcGFzcyBvbmx5IHdoZW5cbiAgICogdGhlIHBhZ2UgaXRzZWxmIGlzIHNob3J0LlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIE9wdGlvbnMuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBhcmdzLnN0YXR1cyAtIFRlcm1pbmFsIHN0YXR1cyB0byBwcnVuZS5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGFyZ3MuY29sdW1uIC0gVGltZXN0YW1wIGNvbHVtbiBjb21wYXJlZCBhZ2FpbnN0IHRoZSBjdXRvZmYuXG4gICAqIEBwYXJhbSB7bnVtYmVyfSBhcmdzLmN1dG9mZiAtIERlbGV0ZSByb3dzIHdob3NlIGNvbHVtbiB2YWx1ZSBpcyBgPD0gY3V0b2ZmYC5cbiAgICogQHBhcmFtIHtudW1iZXJ9IGFyZ3MuYmF0Y2hTaXplIC0gTWF4IHJvd3MgcGVyIGJhdGNoLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxudW1iZXI+fSAtIFJvd3MgZGVsZXRlZCBmb3IgdGhpcyBzdGF0dXMuXG4gICAqL1xuICBhc3luYyBfcHJ1bmVTdGF0dXNCYXRjaGVzKHtzdGF0dXMsIGNvbHVtbiwgY3V0b2ZmLCBiYXRjaFNpemV9KSB7XG4gICAgbGV0IGRlbGV0ZWQgPSAwXG5cbiAgICBmb3IgKDs7KSB7XG4gICAgICBjb25zdCBjYW5kaWRhdGVzID0gYXdhaXQgdGhpcy5fd2l0aERiKGFzeW5jIChkYikgPT5cbiAgICAgICAgYXdhaXQgZGJcbiAgICAgICAgICAubmV3UXVlcnkoKVxuICAgICAgICAgIC5mcm9tKEpPQlNfVEFCTEUpXG4gICAgICAgICAgLnNlbGVjdChcImlkXCIpXG4gICAgICAgICAgLndoZXJlKHtzdGF0dXN9KVxuICAgICAgICAgIC53aGVyZShgJHtkYi5xdW90ZUNvbHVtbihjb2x1bW4pfSA8PSAke2RiLnF1b3RlKGN1dG9mZil9YClcbiAgICAgICAgICAub3JkZXIoe2NvbHVtbiwgZGlyZWN0aW9uOiBcIkFTQ1wifSlcbiAgICAgICAgICAub3JkZXIoe2NvbHVtbjogXCJpZFwiLCBkaXJlY3Rpb246IFwiQVNDXCJ9KVxuICAgICAgICAgIC5saW1pdChiYXRjaFNpemUpXG4gICAgICAgICAgLnJlc3VsdHMoKVxuICAgICAgKVxuXG4gICAgICBpZiAoY2FuZGlkYXRlcy5sZW5ndGggPT09IDApIGJyZWFrXG5cbiAgICAgIGNvbnN0IGNhbmRpZGF0ZUlkcyA9IE9iamVjdC5mcmVlemUoY2FuZGlkYXRlcy5tYXAoKC8qKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSAqLyByb3cpID0+IFN0cmluZyhyb3cuaWQpKSlcblxuICAgICAgaWYgKHRoaXMuYWZ0ZXJQcnVuZUNhbmRpZGF0ZXNTZWxlY3RlZCkge1xuICAgICAgICBhd2FpdCB0aGlzLmFmdGVyUHJ1bmVDYW5kaWRhdGVzU2VsZWN0ZWQoT2JqZWN0LmZyZWV6ZSh7XG4gICAgICAgICAgY2FuZGlkYXRlczogY2FuZGlkYXRlSWRzLFxuICAgICAgICAgIGNvbHVtbixcbiAgICAgICAgICBjdXRvZmYsXG4gICAgICAgICAgc3RhdHVzXG4gICAgICAgIH0pKVxuICAgICAgfVxuXG4gICAgICBjb25zdCByZW1vdmVkID0gYXdhaXQgdGhpcy5fc2VyaWFsaXplZENvdW50TXV0YXRpb24oYXN5bmMgKGRiKSA9PiB7XG4gICAgICAgIGNvbnN0IGlkcyA9IGNhbmRpZGF0ZUlkcy5tYXAoKGlkKSA9PiBkYi5xdW90ZShpZCkpLmpvaW4oXCIsIFwiKVxuXG4gICAgICAgIGNvbnN0IHJlbW92ZWQgPSBhd2FpdCBkYi5hZmZlY3RlZFJvd3MoXG4gICAgICAgICAgYERFTEVURSBGUk9NICR7ZGIucXVvdGVUYWJsZShKT0JTX1RBQkxFKX0gV0hFUkUgJHtkYi5xdW90ZUNvbHVtbihcImlkXCIpfSBJTiAoJHtpZHN9KSBBTkQgJHtkYi5xdW90ZUNvbHVtbihcInN0YXR1c1wiKX0gPSAke2RiLnF1b3RlKHN0YXR1cyl9IEFORCAke2RiLnF1b3RlQ29sdW1uKGNvbHVtbil9IDw9ICR7ZGIucXVvdGUoY3V0b2ZmKX1gXG4gICAgICAgIClcblxuICAgICAgICBhd2FpdCB0aGlzLl9yZWNvcmRDb3VudERlbHRhKGRiLCB7YWxsOiAtcmVtb3ZlZCwgW3N0YXR1c106IC1yZW1vdmVkfSlcblxuICAgICAgICByZXR1cm4gcmVtb3ZlZFxuICAgICAgfSlcblxuICAgICAgZGVsZXRlZCArPSByZW1vdmVkXG4gICAgICBpZiAoY2FuZGlkYXRlcy5sZW5ndGggPCBiYXRjaFNpemUpIGJyZWFrXG4gICAgfVxuXG4gICAgcmV0dXJuIGRlbGV0ZWRcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGNsZWFyIGFsbC5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgd2hlbiBjbGVhcmVkLlxuICAgKi9cbiAgYXN5bmMgY2xlYXJBbGwoKSB7XG4gICAgYXdhaXQgdGhpcy5lbnN1cmVSZWFkeSgpXG5cbiAgICBhd2FpdCB0aGlzLl9zZXJpYWxpemVkQ291bnRNdXRhdGlvbihhc3luYyAoZGIpID0+IHtcbiAgICAgIGNvbnN0IHNuYXBzaG90ID0gYXdhaXQgdGhpcy5fY291bnRTbmFwc2hvdE9uTG9ja2VkQ29ubmVjdGlvbihkYilcbiAgICAgIGlmIChhd2FpdCBkYi50YWJsZUV4aXN0cyhNQUlMX0RFTElWRVJZX09QRVJBVElPTlNfVEFCTEUpKSBhd2FpdCBkYi5xdWVyeShgREVMRVRFIEZST00gJHtkYi5xdW90ZVRhYmxlKE1BSUxfREVMSVZFUllfT1BFUkFUSU9OU19UQUJMRSl9YClcbiAgICAgIGlmIChhd2FpdCBkYi50YWJsZUV4aXN0cyhJREVNUE9URU5DWV9LRVlTX1RBQkxFKSkgYXdhaXQgZGIucXVlcnkoYERFTEVURSBGUk9NICR7ZGIucXVvdGVUYWJsZShJREVNUE9URU5DWV9LRVlTX1RBQkxFKX1gKVxuICAgICAgaWYgKGF3YWl0IGRiLnRhYmxlRXhpc3RzKFNDSEVEVUxFX0tFWVNfVEFCTEUpKSBhd2FpdCBkYi5xdWVyeShgREVMRVRFIEZST00gJHtkYi5xdW90ZVRhYmxlKFNDSEVEVUxFX0tFWVNfVEFCTEUpfWApXG4gICAgICBpZiAoYXdhaXQgZGIudGFibGVFeGlzdHMoU0NIRURVTEVfT1JERVJfV0FURVJNQVJLU19UQUJMRSkpIHtcbiAgICAgICAgY29uc3Qgd2F0ZXJtYXJrUm93cyA9IGF3YWl0IGRiXG4gICAgICAgICAgLm5ld1F1ZXJ5KClcbiAgICAgICAgICAuZnJvbShTQ0hFRFVMRV9PUkRFUl9XQVRFUk1BUktTX1RBQkxFKVxuICAgICAgICAgIC5zZWxlY3QoXCJzY2hlZHVsZV9rZXlcIilcbiAgICAgICAgICAucmVzdWx0cygpXG5cbiAgICAgICAgZm9yIChjb25zdCB3YXRlcm1hcmtSb3cgb2Ygd2F0ZXJtYXJrUm93cykge1xuICAgICAgICAgIGF3YWl0IGRiLmRlbGV0ZSh7XG4gICAgICAgICAgICB0YWJsZU5hbWU6IFNDSEVEVUxFX09SREVSX1dBVEVSTUFSS1NfVEFCTEUsXG4gICAgICAgICAgICBjb25kaXRpb25zOiB7XG4gICAgICAgICAgICAgIHNjaGVkdWxlX2tleTogU3RyaW5nKC8qKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSAqLyAod2F0ZXJtYXJrUm93KS5zY2hlZHVsZV9rZXkpXG4gICAgICAgICAgICB9XG4gICAgICAgICAgfSlcbiAgICAgICAgfVxuICAgICAgfVxuICAgICAgYXdhaXQgZGIucXVlcnkoYERFTEVURSBGUk9NICR7ZGIucXVvdGVUYWJsZShKT0JTX1RBQkxFKX1gKVxuICAgICAgaWYgKGF3YWl0IGRiLnRhYmxlRXhpc3RzKENPTkNVUlJFTkNZX1RBQkxFKSkgYXdhaXQgZGIucXVlcnkoYERFTEVURSBGUk9NICR7ZGIucXVvdGVUYWJsZShDT05DVVJSRU5DWV9UQUJMRSl9YClcbiAgICAgIGNvbnN0IGRlbHRhcyA9IE9iamVjdC5mcm9tRW50cmllcyhPYmplY3QuZW50cmllcyhzbmFwc2hvdC5jb3VudHMpLm1hcCgoW2tleSwgdmFsdWVdKSA9PiBba2V5LCAtdmFsdWVdKSlcbiAgICAgIGF3YWl0IHRoaXMuX3JlY29yZENvdW50RGVsdGEoZGIsIGRlbHRhcylcbiAgICB9KVxuICB9XG5cbiAgLyoqXG4gICAqIENhbmNlbHMgYSBxdWV1ZWQgb3IgaGFuZGVkLW9mZiBqb2IgYW5kIHJlbGVhc2VzIGFueSBkdXJhYmxlIGNvbmN1cnJlbmN5IHJlc2VydmF0aW9uLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gam9iSWQgLSBKb2IgaWQuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPGJvb2xlYW4+fSAtIFdoZXRoZXIgdGhlIGpvYiB3YXMgY2FuY2VsbGVkLlxuICAgKi9cbiAgYXN5bmMgY2FuY2VsKGpvYklkKSB7XG4gICAgYXdhaXQgdGhpcy5lbnN1cmVSZWFkeSgpXG4gICAgcmV0dXJuIGF3YWl0IHRoaXMuX3NlcmlhbGl6ZWRDb3VudE11dGF0aW9uKGFzeW5jIChkYikgPT4ge1xuICAgICAgY29uc3Qgam9iID0gYXdhaXQgdGhpcy5fZ2V0Sm9iUm93QnlJZChkYiwgam9iSWQpXG4gICAgICBpZiAoIWpvYiB8fCAoam9iLnN0YXR1cyAhPT0gXCJxdWV1ZWRcIiAmJiBqb2Iuc3RhdHVzICE9PSBcImhhbmRlZF9vZmZcIikpIHJldHVybiBmYWxzZVxuICAgICAgLy8gT25seSBhIGhhbmRlZF9vZmYgam9iIGhvbGRzIGEgY29uY3VycmVuY3kgcmVzZXJ2YXRpb24sIHNvIG9ubHkgdGhhdCBjYXNlIHRvdWNoZXMgdGhlXG4gICAgICAvLyBzaGFyZWQgY291bnRlciByb3cgYW5kIG5lZWRzIHRoZSBjb25jdXJyZW5jeS10aGVuLWpvYiBsb2NrIG9yZGVyaW5nLlxuICAgICAgaWYgKGpvYi5zdGF0dXMgPT09IFwiaGFuZGVkX29mZlwiKSBhd2FpdCB0aGlzLl9sb2NrQ29uY3VycmVuY3lSb3coZGIsIGpvYi5jb25jdXJyZW5jeUtleSlcbiAgICAgIGNvbnN0IGFmZmVjdGVkUm93cyA9IGF3YWl0IHRoaXMuX3VwZGF0ZUFmZmVjdGVkUm93cyhkYiwge3RhYmxlTmFtZTogSk9CU19UQUJMRSwgZGF0YToge3N0YXR1czogXCJjYW5jZWxsZWRcIn0sIGNvbmRpdGlvbnM6IHtpZDogam9iLmlkLCBzdGF0dXM6IGpvYi5zdGF0dXN9fSlcbiAgICAgIGlmIChhZmZlY3RlZFJvd3MgIT09IDEpIHJldHVybiBmYWxzZVxuICAgICAgYXdhaXQgdGhpcy5fcmVsZWFzZVNjaGVkdWxlT3duZXJzaGlwRm9ySm9iKGRiLCBqb2IpXG4gICAgICBpZiAoam9iLnN0YXR1cyA9PT0gXCJoYW5kZWRfb2ZmXCIpIGF3YWl0IHRoaXMuX3JlbGVhc2VDb25jdXJyZW5jeShkYiwgam9iLmNvbmN1cnJlbmN5S2V5KVxuICAgICAgYXdhaXQgdGhpcy5fcmVjb3JkU3RhdHVzVHJhbnNpdGlvbihkYiwgam9iLnN0YXR1cywgXCJjYW5jZWxsZWRcIilcbiAgICAgIHJldHVybiB0cnVlXG4gICAgfSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGdldCByZXRyeSBkZWxheSBtcy5cbiAgICogQHBhcmFtIHtudW1iZXJ9IHJldHJ5Q291bnQgLSBSZXRyeSBhdHRlbXB0IGNvdW50ICgxLWJhc2VkKS5cbiAgICogQHJldHVybnMge251bWJlcn0gLSBEZWxheSBpbiBtaWxsaXNlY29uZHMuXG4gICAqL1xuICBnZXRSZXRyeURlbGF5TXMocmV0cnlDb3VudCkge1xuICAgIHJldHVybiByZXRyeURlbGF5TXMocmV0cnlDb3VudClcbiAgfVxuXG4gIC8qKlxuICAgKiBOb3JtYWxpemVzIG9uZSBuZXcgam9iIGJlZm9yZSBlbnRlcmluZyBpdHMgcGVyc2lzdGVuY2UgdHJhbnNhY3Rpb24uXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gSm9iIGlucHV0LlxuICAgKiBAcGFyYW0ge0FycmF5PFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gYXJncy5hcmdzIC0gSm9iIGFyZ3VtZW50cy5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGFyZ3Muam9iTmFtZSAtIEpvYiBuYW1lLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vdHlwZXMuanNcIikuQmFja2dyb3VuZEpvYk9wdGlvbnN9IFthcmdzLm9wdGlvbnNdIC0gSm9iIG9wdGlvbnMuXG4gICAqIEByZXR1cm5zIHtQcmVwYXJlZEJhY2tncm91bmRKb2J9IC0gUHJlcGFyZWQgam9iLlxuICAgKi9cbiAgX3ByZXBhcmVKb2Ioe2FyZ3MsIGpvYk5hbWUsIG9wdGlvbnN9KSB7XG4gICAgY29uc3QgY3JlYXRlZEF0TXMgPSB0aGlzLmNsb2NrLm5vdygpXG4gICAgY29uc3QgcXVldWUgPSB0aGlzLl9ub3JtYWxpemVRdWV1ZShvcHRpb25zKVxuXG4gICAgcmV0dXJuIHtcbiAgICAgIGFyZ3NKc29uOiBKU09OLnN0cmluZ2lmeShhcmdzIHx8IFtdKSxcbiAgICAgIGNvbmN1cnJlbmN5OiB0aGlzLl9yZXNvbHZlQ29uY3VycmVuY3kob3B0aW9ucywgcXVldWUpLFxuICAgICAgY3JlYXRlZEF0TXMsXG4gICAgICBleGVjdXRpb25Nb2RlOiB0aGlzLl9ub3JtYWxpemVFeGVjdXRpb25Nb2RlKG9wdGlvbnMpLFxuICAgICAgam9iSWQ6IHJhbmRvbVVVSUQoKSxcbiAgICAgIGpvYk5hbWUsXG4gICAgICBtYXhSZXRyaWVzOiB0aGlzLl9ub3JtYWxpemVNYXhSZXRyaWVzKG9wdGlvbnM/Lm1heFJldHJpZXMpLFxuICAgICAgcXVldWUsXG4gICAgICBzY2hlZHVsZWRBdE1zOiB0aGlzLl9ub3JtYWxpemVTY2hlZHVsZWRBdE1zKG9wdGlvbnM/LnNjaGVkdWxlZEF0TXMsIGNyZWF0ZWRBdE1zKSxcbiAgICAgIHRpbWVvdXRNczogdGhpcy5fbm9ybWFsaXplSm9iVGltZW91dE1zKG9wdGlvbnMpXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIE5vcm1hbGl6ZXMgYSBwZXItam9iIHRpbWVvdXQgd2hpbGUgcHJlc2VydmluZyBvbWl0dGVkICh3b3JrZXIgZmFsbGJhY2spXG4gICAqIHNlcGFyYXRlbHkgZnJvbSBleHBsaWNpdGx5IGRpc2FibGVkLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vdHlwZXMuanNcIikuQmFja2dyb3VuZEpvYk9wdGlvbnMgfCB1bmRlZmluZWR9IG9wdGlvbnMgLSBKb2Igb3B0aW9ucy5cbiAgICogQHJldHVybnMge251bWJlciB8IG51bGx9IC0gUG9zaXRpdmUgdGltZW91dCwgemVybyBmb3IgZGlzYWJsZWQsIG9yIG51bGwgd2hlbiBvbWl0dGVkLlxuICAgKi9cbiAgX25vcm1hbGl6ZUpvYlRpbWVvdXRNcyhvcHRpb25zKSB7XG4gICAgaWYgKG9wdGlvbnM/LnRpbWVvdXRNcyA9PT0gdW5kZWZpbmVkKSByZXR1cm4gbnVsbFxuXG4gICAgY29uc3QgdGltZW91dE1zID0gb3B0aW9ucy50aW1lb3V0TXNcblxuICAgIGlmICh0eXBlb2YgdGltZW91dE1zICE9PSBcIm51bWJlclwiIHx8ICFOdW1iZXIuaXNGaW5pdGUodGltZW91dE1zKSkge1xuICAgICAgdGhyb3cgVmVsb2Npb3VzRXJyb3Iuc2FmZShKT0JfVElNRU9VVF9WQUxJREFUSU9OX01FU1NBR0UpXG4gICAgfVxuXG4gICAgaWYgKHRpbWVvdXRNcyA8PSAwKSByZXR1cm4gMFxuXG4gICAgaWYgKCFOdW1iZXIuaXNJbnRlZ2VyKHRpbWVvdXRNcykgfHwgdGltZW91dE1zID4gTUFYX0pPQl9USU1FT1VUX01TKSB7XG4gICAgICB0aHJvdyBWZWxvY2lvdXNFcnJvci5zYWZlKEpPQl9USU1FT1VUX1ZBTElEQVRJT05fTUVTU0FHRSlcbiAgICB9XG5cbiAgICByZXR1cm4gdGltZW91dE1zXG4gIH1cblxuICAvKipcbiAgICogSW5zZXJ0cyBvbmUgcHJlcGFyZWQgcXVldWVkIGpvYiwgaW5jbHVkaW5nIGl0cyBjb25jdXJyZW5jeSByZWdpc3RyYXRpb24uXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vZGF0YWJhc2UvZHJpdmVycy9iYXNlLmpzXCIpLmRlZmF1bHR9IGRiIC0gRGF0YWJhc2UgY29ubmVjdGlvbi5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBJbnNlcnQgaW5wdXQuXG4gICAqIEBwYXJhbSB7UHJlcGFyZWRCYWNrZ3JvdW5kSm9ifSBhcmdzLnByZXBhcmVkSm9iIC0gUHJlcGFyZWQgam9iLlxuICAgKiBAcGFyYW0ge3N0cmluZyB8IG51bGx9IGFyZ3Muc2NoZWR1bGVLZXkgLSBIaXN0b3JpY2FsIHN0YWJsZSBrZXkuXG4gICAqIEBwYXJhbSB7bnVtYmVyIHwgbnVsbH0gW2FyZ3Muc2NoZWR1bGVPcmRlcl0gLSBNb25vdG9uaWMgc3RhYmxlIG93bmVyc2hpcCBvcmRlci5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgYWZ0ZXIgaW5zZXJ0aW9uLlxuICAgKi9cbiAgYXN5bmMgX2luc2VydFByZXBhcmVkSm9iKGRiLCB7cHJlcGFyZWRKb2IsIHNjaGVkdWxlS2V5LCBzY2hlZHVsZU9yZGVyID0gbnVsbH0pIHtcbiAgICBjb25zdCB7Y29uY3VycmVuY3l9ID0gcHJlcGFyZWRKb2JcblxuICAgIGlmIChjb25jdXJyZW5jeSkge1xuICAgICAgaWYgKGNvbmN1cnJlbmN5LnF1ZXVlRGVyaXZlZCkge1xuICAgICAgICBhd2FpdCB0aGlzLl9lbnN1cmVRdWV1ZUNvbmN1cnJlbmN5S2V5KGRiLCBjb25jdXJyZW5jeSlcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIGF3YWl0IHRoaXMuX2Vuc3VyZUNvbmN1cnJlbmN5S2V5KGRiLCBjb25jdXJyZW5jeSlcbiAgICAgIH1cbiAgICB9XG5cbiAgICBhd2FpdCBkYi5pbnNlcnQoe1xuICAgICAgdGFibGVOYW1lOiBKT0JTX1RBQkxFLFxuICAgICAgZGF0YToge1xuICAgICAgICBpZDogcHJlcGFyZWRKb2Iuam9iSWQsXG4gICAgICAgIGpvYl9uYW1lOiBwcmVwYXJlZEpvYi5qb2JOYW1lLFxuICAgICAgICBhcmdzX2pzb246IHByZXBhcmVkSm9iLmFyZ3NKc29uLFxuICAgICAgICBleGVjdXRpb25fbW9kZTogcHJlcGFyZWRKb2IuZXhlY3V0aW9uTW9kZSxcbiAgICAgICAgcXVldWU6IHByZXBhcmVkSm9iLnF1ZXVlLFxuICAgICAgICBtYXhfcmV0cmllczogcHJlcGFyZWRKb2IubWF4UmV0cmllcyxcbiAgICAgICAgYXR0ZW1wdHM6IDAsXG4gICAgICAgIHN0YXR1czogXCJxdWV1ZWRcIixcbiAgICAgICAgc2NoZWR1bGVkX2F0X21zOiBwcmVwYXJlZEpvYi5zY2hlZHVsZWRBdE1zLFxuICAgICAgICBjcmVhdGVkX2F0X21zOiBwcmVwYXJlZEpvYi5jcmVhdGVkQXRNcyxcbiAgICAgICAgc2NoZWR1bGVfa2V5OiBzY2hlZHVsZUtleSxcbiAgICAgICAgc2NoZWR1bGVfb3JkZXI6IHNjaGVkdWxlT3JkZXIsXG4gICAgICAgIGNvbmN1cnJlbmN5X2tleTogY29uY3VycmVuY3k/LmNvbmN1cnJlbmN5S2V5IHx8IG51bGwsXG4gICAgICAgIG1heF9jb25jdXJyZW5jeTogY29uY3VycmVuY3k/Lm1heENvbmN1cnJlbmN5IHx8IG51bGwsXG4gICAgICAgIHRpbWVvdXRfbXM6IHByZXBhcmVkSm9iLnRpbWVvdXRNcyxcbiAgICAgICAgaGFuZG9mZl9pZDogbnVsbFxuICAgICAgfVxuICAgIH0pXG4gIH1cblxuICAvKipcbiAgICogUnVucyBub3JtYWxpemUgbWF4IHJldHJpZXMuXG4gICAqIEBwYXJhbSB7bnVtYmVyIHwgbnVsbCB8IHVuZGVmaW5lZH0gbWF4UmV0cmllcyAtIElucHV0LlxuICAgKiBAcmV0dXJucyB7bnVtYmVyfSAtIE5vcm1hbGl6ZWQgbWF4IHJldHJpZXMuXG4gICAqL1xuICBfbm9ybWFsaXplTWF4UmV0cmllcyhtYXhSZXRyaWVzKSB7XG4gICAgcmV0dXJuIG5vcm1hbGl6ZUJhY2tncm91bmRKb2JNYXhSZXRyaWVzKG1heFJldHJpZXMpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBub3JtYWxpemUgc2NoZWR1bGVkIGF0IG1zLlxuICAgKiBAcGFyYW0ge251bWJlciB8IHVuZGVmaW5lZH0gc2NoZWR1bGVkQXRNcyAtIFJlcXVlc3RlZCBkaXNwYXRjaCB0aW1lc3RhbXAuXG4gICAqIEBwYXJhbSB7bnVtYmVyfSBkZWZhdWx0U2NoZWR1bGVkQXRNcyAtIERlZmF1bHQgZGlzcGF0Y2ggdGltZXN0YW1wLlxuICAgKiBAcmV0dXJucyB7bnVtYmVyfSAtIERpc3BhdGNoIHRpbWVzdGFtcC5cbiAgICovXG4gIF9ub3JtYWxpemVTY2hlZHVsZWRBdE1zKHNjaGVkdWxlZEF0TXMsIGRlZmF1bHRTY2hlZHVsZWRBdE1zKSB7XG4gICAgcmV0dXJuIG5vcm1hbGl6ZUJhY2tncm91bmRKb2JTY2hlZHVsZWRBdE1zKHNjaGVkdWxlZEF0TXMsIGRlZmF1bHRTY2hlZHVsZWRBdE1zKVxuICB9XG5cbiAgLyoqXG4gICAqIFJlc29sdmVzIGEgcmVzY2hlZHVsZSBkZWxheSBhZ2FpbnN0IHBlcnNpc3RlbmNlIHRpbWUuXG4gICAqIEBwYXJhbSB7bnVtYmVyfSBkZWxheU1zIC0gRGVsYXkgaW4gbWlsbGlzZWNvbmRzLlxuICAgKiBAcmV0dXJucyB7bnVtYmVyfSAtIEZ1dHVyZSBlbGlnaWJpbGl0eSB0aW1lc3RhbXAuXG4gICAqL1xuICBfcmVzY2hlZHVsZWRBdE1zKGRlbGF5TXMpIHtcbiAgICByZXR1cm4gcmVzY2hlZHVsZWRCYWNrZ3JvdW5kSm9iQXRNcyhkZWxheU1zLCB0aGlzLmNsb2NrLm5vdygpKVxuICB9XG5cbiAgLyoqXG4gICAqIFZhbGlkYXRlcyBhIHB1YmxpYyByZXNjaGVkdWxlIGRlbGF5IGJlZm9yZSBwZXJzaXN0ZW5jZSB3b3JrIGJlZ2lucy5cbiAgICogQHBhcmFtIHtudW1iZXJ9IGRlbGF5TXMgLSBEZWxheSBpbiBtaWxsaXNlY29uZHMuXG4gICAqIEByZXR1cm5zIHt2b2lkfVxuICAgKi9cbiAgX3ZhbGlkYXRlUmVzY2hlZHVsZURlbGF5TXMoZGVsYXlNcykge1xuICAgIHJlc2NoZWR1bGVkQmFja2dyb3VuZEpvYkF0TXMoZGVsYXlNcywgMClcbiAgfVxuXG4gIC8qKlxuICAgKiBWYWxpZGF0ZXMgYSBzdGFibGUgc2NoZWR1bGUga2V5IGF0IHRoZSBwdWJsaWMgc3RvcmFnZSBib3VuZGFyeS5cbiAgICogQHBhcmFtIHtzdHJpbmd9IHNjaGVkdWxlS2V5IC0gU3RhYmxlIGxvZ2ljYWwgc2NoZWR1bGUga2V5LlxuICAgKiBAcmV0dXJucyB7c3RyaW5nfSAtIFZhbGlkYXRlZCBrZXkuXG4gICAqL1xuICBfbm9ybWFsaXplU2NoZWR1bGVLZXkoc2NoZWR1bGVLZXkpIHtcbiAgICByZXR1cm4gbm9ybWFsaXplQmFja2dyb3VuZEpvYlNjaGVkdWxlS2V5KHNjaGVkdWxlS2V5KVxuICB9XG5cbiAgLyoqXG4gICAqIEJ1aWxkcyBhIGJvdW5kZWQgYWR2aXNvcnktbG9jayBuYW1lIGZvciBvbmUgc3RhYmxlIHNjaGVkdWxlIGtleS5cbiAgICogQHBhcmFtIHtzdHJpbmd9IHNjaGVkdWxlS2V5IC0gVmFsaWRhdGVkIHN0YWJsZSBzY2hlZHVsZSBrZXkuXG4gICAqIEByZXR1cm5zIHtzdHJpbmd9IC0gQWR2aXNvcnktbG9jayBuYW1lLlxuICAgKi9cbiAgX3NjaGVkdWxlS2V5TG9ja05hbWUoc2NoZWR1bGVLZXkpIHtcbiAgICBjb25zdCBoYXNoID0gY3JlYXRlSGFzaChcInNoYTI1NlwiKS51cGRhdGUoc2NoZWR1bGVLZXkpLmRpZ2VzdChcImhleFwiKS5zbGljZSgwLCAzMilcblxuICAgIHJldHVybiBgYmFja2dyb3VuZC1qb2JzOnNjaGVkdWxlOiR7aGFzaH1gXG4gIH1cblxuICAvKipcbiAgICogRW5zdXJlcyB0aGUgYmFja2dyb3VuZC1qb2JzIHNjaGVtYSBleGlzdHMsIHJldXNpbmcgYSBjYWxsZXItaGVsZCBjb25uZWN0aW9uIHdoZW5cbiAgICogb25lIGlzIGdpdmVuIHJhdGhlciB0aGFuIGNoZWNraW5nIG91dCBpdHMgb3duLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL2RhdGFiYXNlL2RyaXZlcnMvYmFzZS5qc1wiKS5kZWZhdWx0fSBbZXhpc3RpbmdEYl0gLSBSZXVzZSBhblxuICAgKiAgIGFscmVhZHktY2hlY2tlZC1vdXQgY29ubmVjdGlvbiAoZS5nLiB0aGUgb25lIGBkYjptaWdyYXRlYCBob2xkcykgaW5zdGVhZCBvZlxuICAgKiAgIGNoZWNraW5nIG91dCBhIG5lc3RlZCBvbmUg4oCUIHRoZSBuZXN0ZWQgY2hlY2tvdXQgd291bGQgZGVhZGxvY2sgYSBkYXRhYmFzZVxuICAgKiAgIHdob3NlIHBvb2wgaXMgY2FwcGVkIGF0IGEgc2luZ2xlIGNvbm5lY3Rpb24gYWxyZWFkeSBoZWxkIGJ5IHRoZSBjYWxsZXIuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIHdoZW4gdGhlIHNjaGVtYSBpcyBwcmVzZW50LlxuICAgKi9cbiAgYXN5bmMgX2Vuc3VyZVNjaGVtYShleGlzdGluZ0RiKSB7XG4gICAgYXdhaXQgdGhpcy5fYXBwbHlTY2hlbWEoZXhpc3RpbmdEYilcbiAgfVxuXG4gIC8qKlxuICAgKiBTZXJpYWxpemVzIGNyZWF0aW9uIG9yIHVwZ3JhZGUgb2YgdGhlIGJhY2tncm91bmQtam9icyBzY2hlbWEsIGNoZWNraW5nIG91dCBhXG4gICAqIGNvbm5lY3Rpb24gb25seSBhZnRlciBlYXJsaWVyIHNjaGVtYSB3b3JrIGhhcyBjb21wbGV0ZWQgd2hlbiBvbmUgaXMgbm90IHN1cHBsaWVkLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL2RhdGFiYXNlL2RyaXZlcnMvYmFzZS5qc1wiKS5kZWZhdWx0fSBbZXhpc3RpbmdEYl0gLSBDYWxsZXItb3duZWRcbiAgICogICBkYXRhYmFzZSBjb25uZWN0aW9uLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyB3aGVuIHRoZSBzY2hlbWEgaXMgcHJlc2VudC5cbiAgICovXG4gIGFzeW5jIF9hcHBseVNjaGVtYShleGlzdGluZ0RiKSB7XG4gICAgLy8gU2VyaWFsaXplIGNvbmN1cnJlbnQgc2NoZW1hIGFwcGxpZXMgd2l0aGluIHRoaXMgcHJvY2Vzcywga2V5ZWQgYnkgZGF0YWJhc2VcbiAgICAvLyBpZGVudGlmaWVyIChzZWUgYHNjaGVtYUFwcGx5Q2hhaW5zYCkuIFRoZSBwZXItc3RlcCBsb2NrcyBpbnNpZGUgdGhlIHN0ZXBzIHVzZVxuICAgIC8vIERJRkZFUkVOVCBsb2NrIG5hbWVzLCBzbyB0d28gY29uY3VycmVudCBjYWxsZXJzIGNvdWxkIG90aGVyd2lzZSBlYWNoIGhvbGQgYVxuICAgIC8vIGRpZmZlcmVudCBzdGVwIGxvY2sgd2hpbGUgYm90aCByZWJ1aWxkIHRoZSBqb2JzIHRhYmxlIOKAlCBhbmQgb24gU1FMaXRlL01TU1FMIGFuXG4gICAgLy8gYWRkLWNvbHVtbiBpcyBhIGNyZWF0ZS1jb3B5LWRyb3AtcmVuYW1lIHJlYnVpbGQsIHNvIG92ZXJsYXBwaW5nIHJlYnVpbGRzXG4gICAgLy8gY29ycnVwdCBpdC4gVGhpcyBtdXRleCBtYWtlcyB0aGUgd2hvbGUgYXBwbHkgbXV0dWFsbHkgZXhjbHVzaXZlIHBlciBwcm9jZXNzO1xuICAgIC8vIHRoZSBzZWNvbmQgY2FsbGVyIHRoZW4gcmUtY2hlY2tzIGFuZCBmaW5kcyBldmVyeSBzdGVwIGFscmVhZHkgZG9uZS5cbiAgICBjb25zdCBpZGVudGlmaWVyID0gdGhpcy5nZXREYXRhYmFzZUlkZW50aWZpZXIoKSA/PyBcImRlZmF1bHRcIlxuICAgIGNvbnN0IHByZXZpb3VzID0gc2NoZW1hQXBwbHlDaGFpbnMuZ2V0KGlkZW50aWZpZXIpID8/IFByb21pc2UucmVzb2x2ZSgpXG4gICAgY29uc3QgYXBwbHlXaXRoQ29ubmVjdGlvbiA9IGFzeW5jICgpID0+IHtcbiAgICAgIGlmIChleGlzdGluZ0RiKSB7XG4gICAgICAgIGF3YWl0IHRoaXMuX2FwcGx5U2NoZW1hU3RlcHMoZXhpc3RpbmdEYilcblxuICAgICAgICByZXR1cm5cbiAgICAgIH1cblxuICAgICAgYXdhaXQgdGhpcy5fd2l0aERiKChkYikgPT4gdGhpcy5fYXBwbHlTY2hlbWFTdGVwcyhkYikpXG4gICAgfVxuICAgIGNvbnN0IHJ1biA9IHByZXZpb3VzLnRoZW4oYXBwbHlXaXRoQ29ubmVjdGlvbiwgYXBwbHlXaXRoQ29ubmVjdGlvbilcblxuICAgIC8vIEtlZXAgdGhlIGNoYWluIGFsaXZlIHJlZ2FyZGxlc3Mgb2YgdGhpcyBydW4ncyBvdXRjb21lIHNvIG9uZSBmYWlsZWQgYXBwbHkgZG9lc1xuICAgIC8vIG5vdCB3ZWRnZSBsYXRlciBjYWxsZXJzOyB0aGlzIHJ1biBzdGlsbCBwcm9wYWdhdGVzIGl0cyBvd24gcmVzdWx0L2Vycm9yLlxuICAgIHNjaGVtYUFwcGx5Q2hhaW5zLnNldChpZGVudGlmaWVyLCBydW4udGhlbigoKSA9PiB7fSwgKCkgPT4ge30pKVxuXG4gICAgcmV0dXJuIGF3YWl0IHJ1blxuICB9XG5cbiAgLyoqXG4gICAqIENyZWF0ZXMgb3IgdXBncmFkZXMgdGhlIGJhY2tncm91bmQtam9icyB0YWJsZXMsIGNvbHVtbnMgYW5kIGNvbmN1cnJlbmN5IHJvd3Mgb25cbiAgICogdGhlIGdpdmVuIGNvbm5lY3Rpb24uIFNlcmlhbGl6ZWQgcGVyIHByb2Nlc3MgYnkge0BsaW5rIEJhY2tncm91bmRKb2JzU3RvcmUjX2FwcGx5U2NoZW1hfS5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9kYXRhYmFzZS9kcml2ZXJzL2Jhc2UuanNcIikuZGVmYXVsdH0gZGIgLSBEYXRhYmFzZSBjb25uZWN0aW9uLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyB3aGVuIHRoZSBzY2hlbWEgaXMgcHJlc2VudC5cbiAgICovXG4gIGFzeW5jIF9hcHBseVNjaGVtYVN0ZXBzKGRiKSB7XG4gICAgYXdhaXQgdGhpcy5fZW5zdXJlTWlncmF0aW9uc1RhYmxlKGRiKVxuXG4gICAgY29uc3QgYWxyZWFkeUFwcGxpZWQgPSBhd2FpdCB0aGlzLl9oYXNNaWdyYXRpb24oZGIpXG4gICAgY29uc3Qgc2NoZW1hUmVjb3ZlcnlQZW5kaW5nID0gYXdhaXQgdGhpcy5faGFzTWlncmF0aW9uKGRiLCBTQ0hFTUFfUkVDT1ZFUllfUEVORElOR19WRVJTSU9OKVxuICAgIGNvbnN0IGpvYnNUYWJsZUV4aXN0cyA9IGF3YWl0IGRiLnRhYmxlRXhpc3RzKEpPQlNfVEFCTEUpXG5cbiAgICAvLyBFdmVuIHdoZW4gdGhlIG1pZ3JhdGlvbiByb3cgaXMgcHJlc2VudCwgdGhlIGpvYnMgdGFibGUgaXRzZWxmIGNhbiBoYXZlXG4gICAgLy8gYmVlbiBkcm9wcGVkIHVuZGVybmVhdGggdXMgYnkgYSB0cmFuc2FjdGlvbiByb2xsYmFjayBpbiBhbm90aGVyIGNhbGxlclxuICAgIC8vIChEREwgaXMgdHJhbnNhY3Rpb25hbCBvbiBTUUxpdGUvTVNTUUwpLiBWZXJpZnkgdGhlIHRhYmxlIHBoeXNpY2FsbHlcbiAgICAvLyBleGlzdHMgYW5kIHJlY3JlYXRlIGl0IHdoZW4gbWlzc2luZyByYXRoZXIgdGhhbiB0cnVzdGluZyB0aGUgbWlncmF0aW9uXG4gICAgLy8gcm93IGFsb25lLCBvdGhlcndpc2UgbGF0ZXIgY2FsbGVycyBmYWlsIHdpdGggXCJubyBzdWNoIHRhYmxlXCIuXG4gICAgaWYgKGFscmVhZHlBcHBsaWVkICYmIGpvYnNUYWJsZUV4aXN0cyAmJiAhc2NoZW1hUmVjb3ZlcnlQZW5kaW5nKSB7XG4gICAgICBhd2FpdCB0aGlzLl9lbnN1cmVKb2JzVGFibGVDb2x1bW5zKGRiKVxuICAgICAgYXdhaXQgdGhpcy5fZW5zdXJlSWRlbXBvdGVuY3lLZXlzVGFibGUoZGIpXG4gICAgICBhd2FpdCB0aGlzLl9lbnN1cmVNYWlsRGVsaXZlcnlPcGVyYXRpb25zVGFibGUoZGIpXG4gICAgICBhd2FpdCB0aGlzLl9lbnN1cmVTY2hlZHVsZUtleXNUYWJsZShkYilcbiAgICAgIGF3YWl0IHRoaXMuX2Vuc3VyZUNvbmN1cnJlbmN5VGFibGUoZGIpXG4gICAgICBhd2FpdCB0aGlzLl9lbnN1cmVDb3VudFJldmlzaW9uVGFibGUoZGIpXG4gICAgICBhd2FpdCB0aGlzLl9lbnN1cmVSZXRlbnRpb25JbmRleGVzT25jZShkYilcblxuICAgICAgcmV0dXJuXG4gICAgfVxuXG4gICAgaWYgKGFscmVhZHlBcHBsaWVkICYmICFzY2hlbWFSZWNvdmVyeVBlbmRpbmcpIHtcbiAgICAgIGF3YWl0IHRoaXMuX3JlY29yZE1pZ3JhdGlvbihkYiwgU0NIRU1BX1JFQ09WRVJZX1BFTkRJTkdfVkVSU0lPTilcbiAgICB9XG5cbiAgICBhd2FpdCB0aGlzLl9hcHBseU1pZ3JhdGlvbnMoZGIpXG4gICAgYXdhaXQgdGhpcy5fZW5zdXJlSm9ic1RhYmxlQ29sdW1ucyhkYilcbiAgICBhd2FpdCB0aGlzLl9lbnN1cmVJZGVtcG90ZW5jeUtleXNUYWJsZShkYilcbiAgICBhd2FpdCB0aGlzLl9lbnN1cmVNYWlsRGVsaXZlcnlPcGVyYXRpb25zVGFibGUoZGIpXG4gICAgYXdhaXQgdGhpcy5fZW5zdXJlU2NoZWR1bGVLZXlzVGFibGUoZGIpXG4gICAgYXdhaXQgdGhpcy5fZW5zdXJlQ29uY3VycmVuY3lUYWJsZShkYilcbiAgICBhd2FpdCB0aGlzLl9lbnN1cmVDb3VudFJldmlzaW9uVGFibGUoZGIpXG5cbiAgICBpZiAoYWxyZWFkeUFwcGxpZWQpIHtcbiAgICAgIC8vIFRoZSByZWNyZWF0ZWQgam9icyB0YWJsZSBpcyBlbXB0eSwgYnV0IHRoZSBzdXJ2aXZpbmcgY29uY3VycmVuY3kgdGFibGVcbiAgICAgIC8vIGNhbiBzdGlsbCBjb3VudCBoYW5kb2ZmcyB0aGF0IGRpc2FwcGVhcmVkIHdpdGggdGhlIGRyb3BwZWQgam9icyB0YWJsZS5cbiAgICAgIGF3YWl0IHRoaXMuX3JlY29uY2lsZUNvbmN1cnJlbmN5KGRiKVxuICAgICAgYXdhaXQgZGIuZGVsZXRlKHtcbiAgICAgICAgdGFibGVOYW1lOiBNSUdSQVRJT05TX1RBQkxFLFxuICAgICAgICBjb25kaXRpb25zOiB7a2V5OiB0aGlzLl9taWdyYXRpb25LZXkoU0NIRU1BX1JFQ09WRVJZX1BFTkRJTkdfVkVSU0lPTil9XG4gICAgICB9KVxuXG4gICAgICByZXR1cm5cbiAgICB9XG5cbiAgICBhd2FpdCB0aGlzLl9yZWNvcmRNaWdyYXRpb24oZGIsIE1JR1JBVElPTl9WRVJTSU9OKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZW5zdXJlIG1pZ3JhdGlvbnMgdGFibGUuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vZGF0YWJhc2UvZHJpdmVycy9iYXNlLmpzXCIpLmRlZmF1bHR9IGRiIC0gRGF0YWJhc2UgY29ubmVjdGlvbi5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgd2hlbiBjb21wbGV0ZS5cbiAgICovXG4gIGFzeW5jIF9lbnN1cmVNaWdyYXRpb25zVGFibGUoZGIpIHtcbiAgICBpZiAoYXdhaXQgZGIudGFibGVFeGlzdHMoTUlHUkFUSU9OU19UQUJMRSkpIHJldHVyblxuXG4gICAgY29uc3QgdGFibGUgPSBuZXcgVGFibGVEYXRhKE1JR1JBVElPTlNfVEFCTEUsIHtpZk5vdEV4aXN0czogdHJ1ZX0pXG5cbiAgICB0YWJsZS5zdHJpbmcoXCJrZXlcIiwge251bGw6IGZhbHNlLCBwcmltYXJ5S2V5OiB0cnVlfSlcbiAgICB0YWJsZS5zdHJpbmcoXCJzY29wZVwiLCB7bnVsbDogZmFsc2V9KVxuICAgIHRhYmxlLnN0cmluZyhcInZlcnNpb25cIiwge251bGw6IGZhbHNlfSlcbiAgICB0YWJsZS5iaWdpbnQoXCJhcHBsaWVkX2F0X21zXCIsIHtudWxsOiBmYWxzZX0pXG5cbiAgICBhd2FpdCBkYi5jcmVhdGVUYWJsZSh0YWJsZSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGhhcyBtaWdyYXRpb24uXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vZGF0YWJhc2UvZHJpdmVycy9iYXNlLmpzXCIpLmRlZmF1bHR9IGRiIC0gRGF0YWJhc2UgY29ubmVjdGlvbi5cbiAgICogQHBhcmFtIHtzdHJpbmd9IFt2ZXJzaW9uXSAtIE1pZ3JhdGlvbiB2ZXJzaW9uLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxib29sZWFuPn0gLSBXaGV0aGVyIG1pZ3JhdGlvbiBleGlzdHMuXG4gICAqL1xuICBhc3luYyBfaGFzTWlncmF0aW9uKGRiLCB2ZXJzaW9uID0gTUlHUkFUSU9OX1ZFUlNJT04pIHtcbiAgICBjb25zdCBxdWVyeSA9IGRiXG4gICAgICAubmV3UXVlcnkoKVxuICAgICAgLmZyb20oTUlHUkFUSU9OU19UQUJMRSlcbiAgICAgIC53aGVyZSh7a2V5OiB0aGlzLl9taWdyYXRpb25LZXkodmVyc2lvbil9KVxuICAgICAgLmxpbWl0KDEpXG5cbiAgICBjb25zdCByb3dzID0gYXdhaXQgcXVlcnkucmVzdWx0cygpXG5cbiAgICByZXR1cm4gcm93cy5sZW5ndGggPiAwXG4gIH1cblxuICAvKipcbiAgICogUnVucyBhcHBseSBtaWdyYXRpb25zLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL2RhdGFiYXNlL2RyaXZlcnMvYmFzZS5qc1wiKS5kZWZhdWx0fSBkYiAtIERhdGFiYXNlIGNvbm5lY3Rpb24uXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIHdoZW4gY29tcGxldGUuXG4gICAqL1xuICBhc3luYyBfYXBwbHlNaWdyYXRpb25zKGRiKSB7XG4gICAgdGhpcy5sb2dnZXIuaW5mbyhcIkFwcGx5aW5nIGJhY2tncm91bmQgam9icyBzY2hlbWFcIilcblxuICAgIGlmIChhd2FpdCBkYi50YWJsZUV4aXN0cyhKT0JTX1RBQkxFKSkge1xuICAgICAgdGhpcy5sb2dnZXIuaW5mbyhcIkJhY2tncm91bmQgam9icyB0YWJsZSBhbHJlYWR5IGV4aXN0cyAtIHNraXBwaW5nIGNyZWF0ZVwiKVxuICAgICAgcmV0dXJuXG4gICAgfVxuXG4gICAgY29uc3QgdGFibGUgPSBuZXcgVGFibGVEYXRhKEpPQlNfVEFCTEUsIHtpZk5vdEV4aXN0czogdHJ1ZX0pXG5cbiAgICB0YWJsZS5zdHJpbmcoXCJpZFwiLCB7cHJpbWFyeUtleTogdHJ1ZX0pXG4gICAgdGFibGUuc3RyaW5nKFwiam9iX25hbWVcIiwge251bGw6IGZhbHNlLCBpbmRleDogdHJ1ZX0pXG4gICAgdGFibGUudGV4dChcImFyZ3NfanNvblwiLCB7bnVsbDogZmFsc2V9KVxuICAgIHRhYmxlLnN0cmluZyhcImV4ZWN1dGlvbl9tb2RlXCIsIHtudWxsOiBmYWxzZX0pXG4gICAgdGFibGUuc3RyaW5nKFwicXVldWVcIiwge251bGw6IHRydWUsIGluZGV4OiB0cnVlfSlcbiAgICB0YWJsZS5pbnRlZ2VyKFwibWF4X3JldHJpZXNcIiwge251bGw6IGZhbHNlfSlcbiAgICB0YWJsZS5pbnRlZ2VyKFwiYXR0ZW1wdHNcIiwge251bGw6IGZhbHNlfSlcbiAgICB0YWJsZS5zdHJpbmcoXCJzdGF0dXNcIiwge251bGw6IGZhbHNlLCBpbmRleDogdHJ1ZX0pXG4gICAgdGFibGUuYmlnaW50KFwic2NoZWR1bGVkX2F0X21zXCIsIHtudWxsOiBmYWxzZSwgaW5kZXg6IHRydWV9KVxuICAgIHRhYmxlLmJpZ2ludChcImNyZWF0ZWRfYXRfbXNcIiwge251bGw6IGZhbHNlLCBpbmRleDogdHJ1ZX0pXG4gICAgdGFibGUuc3RyaW5nKFwic2NoZWR1bGVfa2V5XCIsIHtudWxsOiB0cnVlLCBpbmRleDogdHJ1ZX0pXG4gICAgdGFibGUuYmlnaW50KFwic2NoZWR1bGVfb3JkZXJcIiwge251bGw6IHRydWV9KVxuICAgIHRhYmxlLmJpZ2ludChcImhhbmRlZF9vZmZfYXRfbXNcIiwge251bGw6IHRydWUsIGluZGV4OiB0cnVlfSlcbiAgICB0YWJsZS5zdHJpbmcoXCJoYW5kb2ZmX2lkXCIsIHtudWxsOiB0cnVlfSlcbiAgICB0YWJsZS5iaWdpbnQoXCJjb21wbGV0ZWRfYXRfbXNcIiwge251bGw6IHRydWV9KVxuICAgIHRhYmxlLmJpZ2ludChcImZhaWxlZF9hdF9tc1wiLCB7bnVsbDogdHJ1ZX0pXG4gICAgdGFibGUuYmlnaW50KFwib3JwaGFuZWRfYXRfbXNcIiwge251bGw6IHRydWUsIGluZGV4OiB0cnVlfSlcbiAgICB0YWJsZS5zdHJpbmcoXCJ3b3JrZXJfaWRcIiwge251bGw6IHRydWV9KVxuICAgIHRhYmxlLnRleHQoXCJsYXN0X2Vycm9yXCIsIHtudWxsOiB0cnVlfSlcbiAgICB0YWJsZS5zdHJpbmcoXCJjb25jdXJyZW5jeV9rZXlcIiwge251bGw6IHRydWUsIGluZGV4OiB0cnVlfSlcbiAgICB0YWJsZS5pbnRlZ2VyKFwibWF4X2NvbmN1cnJlbmN5XCIsIHtudWxsOiB0cnVlfSlcbiAgICB0YWJsZS5iaWdpbnQoXCJ0aW1lb3V0X21zXCIsIHtudWxsOiB0cnVlfSlcbiAgICB0YWJsZS5iaWdpbnQoXCJjaGlsZF9yZWNlaXZlZF9hdF9tc1wiLCB7bnVsbDogdHJ1ZX0pXG4gICAgdGFibGUuYmlnaW50KFwiY2hpbGRfc3RhcnRlZF9hdF9tc1wiLCB7bnVsbDogdHJ1ZX0pXG4gICAgdGFibGUuc3RyaW5nKFwiY2hpbGRfaW5zdGFuY2VfaWRcIiwge251bGw6IHRydWV9KVxuICAgIHRhYmxlLmludGVnZXIoXCJjaGlsZF9waWRcIiwge251bGw6IHRydWV9KVxuICAgIHRhYmxlLnN0cmluZyhcInJ1bm5lcl9ob3N0bmFtZVwiLCB7bnVsbDogdHJ1ZX0pXG5cbiAgICBhd2FpdCBkYi5jcmVhdGVUYWJsZSh0YWJsZSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGVuc3VyZSBqb2JzIHRhYmxlIGNvbHVtbnMuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vZGF0YWJhc2UvZHJpdmVycy9iYXNlLmpzXCIpLmRlZmF1bHR9IGRiIC0gRGF0YWJhc2UgY29ubmVjdGlvbi5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgd2hlbiBjb21wbGV0ZS5cbiAgICovXG4gIGFzeW5jIF9lbnN1cmVKb2JzVGFibGVDb2x1bW5zKGRiKSB7XG4gICAgaWYgKCEoYXdhaXQgZGIudGFibGVFeGlzdHMoSk9CU19UQUJMRSkpKSByZXR1cm5cblxuICAgIGNvbnN0IHRhYmxlID0gYXdhaXQgZGIuZ2V0VGFibGVCeU5hbWVPckZhaWwoSk9CU19UQUJMRSlcbiAgICBjb25zdCBleGVjdXRpb25Nb2RlQ29sdW1uID0gYXdhaXQgdGFibGUuZ2V0Q29sdW1uQnlOYW1lKFwiZXhlY3V0aW9uX21vZGVcIilcblxuICAgIGlmICghZXhlY3V0aW9uTW9kZUNvbHVtbikge1xuICAgICAgY29uc3QgdGFibGVEYXRhID0gbmV3IFRhYmxlRGF0YShKT0JTX1RBQkxFKVxuICAgICAgdGFibGVEYXRhLnN0cmluZyhcImV4ZWN1dGlvbl9tb2RlXCIsIHtudWxsOiB0cnVlfSlcbiAgICAgIGNvbnN0IHNxbHMgPSBhd2FpdCBkYi5hbHRlclRhYmxlU1FMcyh0YWJsZURhdGEpXG5cbiAgICAgIGZvciAoY29uc3Qgc3FsIG9mIHNxbHMpIHtcbiAgICAgICAgYXdhaXQgZGIucXVlcnkoc3FsKVxuICAgICAgfVxuXG4gICAgICBkYi5jbGVhclNjaGVtYUNhY2hlKClcbiAgICB9XG5cbiAgICBjb25zdCByZWZyZXNoZWRUYWJsZSA9IGF3YWl0IGRiLmdldFRhYmxlQnlOYW1lT3JGYWlsKEpPQlNfVEFCTEUpXG4gICAgY29uc3QgaGFuZG9mZklkQ29sdW1uID0gYXdhaXQgcmVmcmVzaGVkVGFibGUuZ2V0Q29sdW1uQnlOYW1lKFwiaGFuZG9mZl9pZFwiKVxuXG4gICAgaWYgKCFoYW5kb2ZmSWRDb2x1bW4pIHtcbiAgICAgIGNvbnN0IGxvY2tOYW1lID0gYCR7TUlHUkFUSU9OX1NDT1BFfTpoYW5kb2ZmX2lkX2NvbHVtbmBcbiAgICAgIGNvbnN0IGFjcXVpcmVkID0gYXdhaXQgZGIuYWNxdWlyZUFkdmlzb3J5TG9jayhsb2NrTmFtZSlcblxuICAgICAgaWYgKCFhY3F1aXJlZCkgdGhyb3cgbmV3IEVycm9yKFwiRmFpbGVkIHRvIGFjcXVpcmUgYmFja2dyb3VuZCBqb2JzIGhhbmRvZmYgc2NoZW1hIGxvY2tcIilcblxuICAgICAgdHJ5IHtcbiAgICAgICAgZGIuY2xlYXJTY2hlbWFDYWNoZSgpXG4gICAgICAgIGNvbnN0IGxvY2tlZFRhYmxlID0gYXdhaXQgZGIuZ2V0VGFibGVCeU5hbWVPckZhaWwoSk9CU19UQUJMRSlcblxuICAgICAgICBpZiAoIShhd2FpdCBsb2NrZWRUYWJsZS5nZXRDb2x1bW5CeU5hbWUoXCJoYW5kb2ZmX2lkXCIpKSkge1xuICAgICAgICAgIGNvbnN0IHRhYmxlRGF0YSA9IG5ldyBUYWJsZURhdGEoSk9CU19UQUJMRSlcbiAgICAgICAgICB0YWJsZURhdGEuc3RyaW5nKFwiaGFuZG9mZl9pZFwiLCB7bnVsbDogdHJ1ZX0pXG4gICAgICAgICAgY29uc3Qgc3FscyA9IGF3YWl0IGRiLmFsdGVyVGFibGVTUUxzKHRhYmxlRGF0YSlcblxuICAgICAgICAgIGZvciAoY29uc3Qgc3FsIG9mIHNxbHMpIHtcbiAgICAgICAgICAgIGF3YWl0IGRiLnF1ZXJ5KHNxbClcbiAgICAgICAgICB9XG5cbiAgICAgICAgICBkYi5jbGVhclNjaGVtYUNhY2hlKClcbiAgICAgICAgfVxuICAgICAgfSBmaW5hbGx5IHtcbiAgICAgICAgYXdhaXQgZGIucmVsZWFzZUFkdmlzb3J5TG9jayhsb2NrTmFtZSlcbiAgICAgIH1cbiAgICB9XG5cbiAgICBhd2FpdCB0aGlzLl9iYWNrZmlsbEV4ZWN1dGlvbk1vZGVzT25jZShkYilcbiAgICBhd2FpdCB0aGlzLl9kcm9wRm9ya2VkQ29sdW1uT25jZShkYilcblxuICAgIGNvbnN0IGxvY2tOYW1lID0gYCR7TUlHUkFUSU9OX1NDT1BFfTpjb25jdXJyZW5jeV9jb2x1bW5zYFxuICAgIGNvbnN0IGFjcXVpcmVkID0gYXdhaXQgZGIuYWNxdWlyZUFkdmlzb3J5TG9jayhsb2NrTmFtZSlcblxuICAgIGlmICghYWNxdWlyZWQpIHRocm93IG5ldyBFcnJvcihcIkZhaWxlZCB0byBhY3F1aXJlIGJhY2tncm91bmQgam9icyBjb25jdXJyZW5jeSBzY2hlbWEgbG9ja1wiKVxuXG4gICAgdHJ5IHtcbiAgICAgIC8vIFNRTCBTZXJ2ZXIgc2NoZW1hIHJlYWRzIGNhbiBkZWFkbG9jayB3aXRoIGEgY29uY3VycmVudCBBTFRFUiBUQUJMRSwgc29cbiAgICAgIC8vIGFjcXVpcmUgdGhlIGxvY2sgYmVmb3JlIGluc3BlY3RpbmcgZWl0aGVyIGNvbHVtbiByYXRoZXIgdGhhbiBvbmx5XG4gICAgICAvLyBwcm90ZWN0aW5nIHRoZSBtdXRhdGlvbi5cbiAgICAgIGRiLmNsZWFyU2NoZW1hQ2FjaGUoKVxuICAgICAgY29uc3QgbG9ja2VkVGFibGUgPSBhd2FpdCBkYi5nZXRUYWJsZUJ5TmFtZU9yRmFpbChKT0JTX1RBQkxFKVxuICAgICAgY29uc3QgY29uY3VycmVuY3lDb2x1bW5OYW1lcyA9IFtcImNvbmN1cnJlbmN5X2tleVwiLCBcIm1heF9jb25jdXJyZW5jeVwiXVxuXG4gICAgICBmb3IgKGNvbnN0IGNvbmN1cnJlbmN5Q29sdW1uTmFtZSBvZiBjb25jdXJyZW5jeUNvbHVtbk5hbWVzKSB7XG4gICAgICAgIGlmIChhd2FpdCBsb2NrZWRUYWJsZS5nZXRDb2x1bW5CeU5hbWUoY29uY3VycmVuY3lDb2x1bW5OYW1lKSkgY29udGludWVcblxuICAgICAgICBjb25zdCB0YWJsZURhdGEgPSBuZXcgVGFibGVEYXRhKEpPQlNfVEFCTEUpXG4gICAgICAgIGlmIChjb25jdXJyZW5jeUNvbHVtbk5hbWUgPT0gXCJjb25jdXJyZW5jeV9rZXlcIikge1xuICAgICAgICAgIHRhYmxlRGF0YS5zdHJpbmcoXCJjb25jdXJyZW5jeV9rZXlcIiwge251bGw6IHRydWUsIGluZGV4OiB0cnVlfSlcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICB0YWJsZURhdGEuaW50ZWdlcihcIm1heF9jb25jdXJyZW5jeVwiLCB7bnVsbDogdHJ1ZX0pXG4gICAgICAgIH1cblxuICAgICAgICBmb3IgKGNvbnN0IHNxbCBvZiBhd2FpdCBkYi5hbHRlclRhYmxlU1FMcyh0YWJsZURhdGEpKSBhd2FpdCBkYi5xdWVyeShzcWwpXG4gICAgICB9XG5cbiAgICAgIGRiLmNsZWFyU2NoZW1hQ2FjaGUoKVxuICAgIH0gZmluYWxseSB7XG4gICAgICBhd2FpdCBkYi5yZWxlYXNlQWR2aXNvcnlMb2NrKGxvY2tOYW1lKVxuICAgIH1cblxuICAgIGF3YWl0IHRoaXMuX2Vuc3VyZVF1ZXVlQ29sdW1uKGRiKVxuICAgIGF3YWl0IHRoaXMuX2Vuc3VyZVNjaGVkdWxlS2V5Q29sdW1uKGRiKVxuICAgIGF3YWl0IHRoaXMuX2Vuc3VyZVNjaGVkdWxlT3JkZXJDb2x1bW4oZGIpXG4gICAgYXdhaXQgdGhpcy5fZW5zdXJlU2NoZWR1bGVPcmRlcldhdGVybWFya3NUYWJsZShkYilcbiAgICBhd2FpdCB0aGlzLl9lbnN1cmVKb2JUaW1lb3V0Q29sdW1uKGRiKVxuICAgIGF3YWl0IHRoaXMuX2Vuc3VyZUNoaWxkQWNjZXB0YW5jZUNvbHVtbnMoZGIpXG4gICAgYXdhaXQgdGhpcy5fZW5zdXJlSm9ic1RhYmxlSW5kZXhlc09uY2UoZGIpXG4gICAgYXdhaXQgdGhpcy5fZW5zdXJlUmV0ZW50aW9uSW5kZXhlc09uY2UoZGIpXG4gIH1cblxuICAvKipcbiAgICogSWRlbXBvdGVudGx5IGFkZHMgdGhlIHBvb2xlZC1jaGlsZCBhY2NlcHRhbmNlIGV2aWRlbmNlIGNvbHVtbnMgdG8gZXhpc3RpbmdcbiAgICogam9iIHRhYmxlcy4gVGhleSByZWNvcmQgd2hlbiB0aGUgZXhlY3V0aW5nIHJ1bm5lciBjaGlsZCByZWNlaXZlZCBhbmRcbiAgICogc3RhcnRlZCBhIGpvYiBwbHVzIHRoYXQgY2hpbGQncyBpZGVudGl0eSwgc28gYSBoYW5kZWQtb2ZmIGpvYiBjYW4gYmUgdG9sZFxuICAgKiBhcGFydCBmcm9tIG9uZSB3aG9zZSBydW5uZXIgbmV2ZXIgcGlja2VkIGl0IHVwLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL2RhdGFiYXNlL2RyaXZlcnMvYmFzZS5qc1wiKS5kZWZhdWx0fSBkYiAtIERhdGFiYXNlIGNvbm5lY3Rpb24uXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIHdoZW4gZW5zdXJlZC5cbiAgICovXG4gIGFzeW5jIF9lbnN1cmVDaGlsZEFjY2VwdGFuY2VDb2x1bW5zKGRiKSB7XG4gICAgY29uc3QgbG9ja05hbWUgPSBgJHtNSUdSQVRJT05fU0NPUEV9OmNoaWxkX2FjY2VwdGFuY2VfY29sdW1uc2BcbiAgICBjb25zdCBhY3F1aXJlZCA9IGF3YWl0IGRiLmFjcXVpcmVBZHZpc29yeUxvY2sobG9ja05hbWUpXG5cbiAgICBpZiAoIWFjcXVpcmVkKSB0aHJvdyBuZXcgRXJyb3IoXCJGYWlsZWQgdG8gYWNxdWlyZSBiYWNrZ3JvdW5kIGpvYnMgY2hpbGQtYWNjZXB0YW5jZSBzY2hlbWEgbG9ja1wiKVxuXG4gICAgdHJ5IHtcbiAgICAgIGRiLmNsZWFyU2NoZW1hQ2FjaGUoKVxuICAgICAgY29uc3QgdGFibGUgPSBhd2FpdCBkYi5nZXRUYWJsZUJ5TmFtZU9yRmFpbChKT0JTX1RBQkxFKVxuICAgICAgY29uc3QgdGFibGVEYXRhID0gbmV3IFRhYmxlRGF0YShKT0JTX1RBQkxFKVxuICAgICAgbGV0IGFkZGVkID0gZmFsc2VcblxuICAgICAgaWYgKCEoYXdhaXQgdGFibGUuZ2V0Q29sdW1uQnlOYW1lKFwiY2hpbGRfcmVjZWl2ZWRfYXRfbXNcIikpKSB7XG4gICAgICAgIHRhYmxlRGF0YS5iaWdpbnQoXCJjaGlsZF9yZWNlaXZlZF9hdF9tc1wiLCB7bnVsbDogdHJ1ZX0pXG4gICAgICAgIGFkZGVkID0gdHJ1ZVxuICAgICAgfVxuICAgICAgaWYgKCEoYXdhaXQgdGFibGUuZ2V0Q29sdW1uQnlOYW1lKFwiY2hpbGRfc3RhcnRlZF9hdF9tc1wiKSkpIHtcbiAgICAgICAgdGFibGVEYXRhLmJpZ2ludChcImNoaWxkX3N0YXJ0ZWRfYXRfbXNcIiwge251bGw6IHRydWV9KVxuICAgICAgICBhZGRlZCA9IHRydWVcbiAgICAgIH1cbiAgICAgIGlmICghKGF3YWl0IHRhYmxlLmdldENvbHVtbkJ5TmFtZShcImNoaWxkX2luc3RhbmNlX2lkXCIpKSkge1xuICAgICAgICB0YWJsZURhdGEuc3RyaW5nKFwiY2hpbGRfaW5zdGFuY2VfaWRcIiwge251bGw6IHRydWV9KVxuICAgICAgICBhZGRlZCA9IHRydWVcbiAgICAgIH1cbiAgICAgIGlmICghKGF3YWl0IHRhYmxlLmdldENvbHVtbkJ5TmFtZShcImNoaWxkX3BpZFwiKSkpIHtcbiAgICAgICAgdGFibGVEYXRhLmludGVnZXIoXCJjaGlsZF9waWRcIiwge251bGw6IHRydWV9KVxuICAgICAgICBhZGRlZCA9IHRydWVcbiAgICAgIH1cbiAgICAgIGlmICghKGF3YWl0IHRhYmxlLmdldENvbHVtbkJ5TmFtZShcInJ1bm5lcl9ob3N0bmFtZVwiKSkpIHtcbiAgICAgICAgdGFibGVEYXRhLnN0cmluZyhcInJ1bm5lcl9ob3N0bmFtZVwiLCB7bnVsbDogdHJ1ZX0pXG4gICAgICAgIGFkZGVkID0gdHJ1ZVxuICAgICAgfVxuXG4gICAgICBpZiAoYWRkZWQpIHtcbiAgICAgICAgZm9yIChjb25zdCBzcWwgb2YgYXdhaXQgZGIuYWx0ZXJUYWJsZVNRTHModGFibGVEYXRhKSkgYXdhaXQgZGIucXVlcnkoc3FsKVxuICAgICAgICBkYi5jbGVhclNjaGVtYUNhY2hlKClcbiAgICAgIH1cbiAgICB9IGZpbmFsbHkge1xuICAgICAgYXdhaXQgZGIucmVsZWFzZUFkdmlzb3J5TG9jayhsb2NrTmFtZSlcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogUmVwYWlycyBzZWNvbmRhcnkgaW5kZXhlcyB0aGF0IG9sZGVyIGFkZC1jb2x1bW4gdXBncmFkZXMgZGVjbGFyZWQgYnV0IGRpZFxuICAgKiBub3QgY3JlYXRlIG9uIGV2ZXJ5IFNRTCBkcml2ZXIuIFRoZSBtaWdyYXRpb24gbGVkZ2VyIGtlZXBzIHJvdXRpbmUgc3RvcmVcbiAgICogcmVhZGluZXNzIGZyb20gcmVwZWF0ZWRseSBpbnRyb3NwZWN0aW5nIHRoZSBmdWxsIGluZGV4IHNldC5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9kYXRhYmFzZS9kcml2ZXJzL2Jhc2UuanNcIikuZGVmYXVsdH0gZGIgLSBEYXRhYmFzZSBjb25uZWN0aW9uLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyB3aGVuIGFsbCBleHBlY3RlZCBpbmRleGVzIGV4aXN0LlxuICAgKi9cbiAgYXN5bmMgX2Vuc3VyZUpvYnNUYWJsZUluZGV4ZXNPbmNlKGRiKSB7XG4gICAgY29uc3QgbWlncmF0aW9uVmVyc2lvbiA9IEpPQlNfSU5ERVhfUkVQQUlSX01JR1JBVElPTl9WRVJTSU9OXG4gICAgY29uc3QgbWlncmF0aW9uS2V5ID0gdGhpcy5fbWlncmF0aW9uS2V5KG1pZ3JhdGlvblZlcnNpb24pXG5cbiAgICBpZiAoYXdhaXQgdGhpcy5faGFzTWlncmF0aW9uKGRiLCBtaWdyYXRpb25WZXJzaW9uKSkgcmV0dXJuXG5cbiAgICBjb25zdCBhY3F1aXJlZCA9IGF3YWl0IGRiLmFjcXVpcmVBZHZpc29yeUxvY2sobWlncmF0aW9uS2V5KVxuXG4gICAgaWYgKCFhY3F1aXJlZCkgdGhyb3cgbmV3IEVycm9yKFwiRmFpbGVkIHRvIGFjcXVpcmUgYmFja2dyb3VuZCBqb2JzIGluZGV4IHJlcGFpciBsb2NrXCIpXG5cbiAgICB0cnkge1xuICAgICAgaWYgKGF3YWl0IHRoaXMuX2hhc01pZ3JhdGlvbihkYiwgbWlncmF0aW9uVmVyc2lvbikpIHJldHVyblxuXG4gICAgICBkYi5jbGVhclNjaGVtYUNhY2hlKClcbiAgICAgIGNvbnN0IHRhYmxlID0gYXdhaXQgZGIuZ2V0VGFibGVCeU5hbWVPckZhaWwoSk9CU19UQUJMRSlcbiAgICAgIGNvbnN0IGluZGV4ZWRDb2x1bW5OYW1lcyA9IG5ldyBTZXQoXG4gICAgICAgIChhd2FpdCB0YWJsZS5nZXRJbmRleGVzKCkpXG4gICAgICAgICAgLmZpbHRlcigoaW5kZXgpID0+ICFpbmRleC5pc1ByaW1hcnlLZXkoKSAmJiBpbmRleC5nZXRDb2x1bW5OYW1lcygpLmxlbmd0aCA9PT0gMSlcbiAgICAgICAgICAubWFwKChpbmRleCkgPT4gaW5kZXguZ2V0Q29sdW1uTmFtZXMoKVswXSlcbiAgICAgIClcblxuICAgICAgZm9yIChjb25zdCBjb2x1bW5OYW1lIG9mIEpPQlNfSU5ERVhfQ09MVU1OX05BTUVTKSB7XG4gICAgICAgIGlmIChpbmRleGVkQ29sdW1uTmFtZXMuaGFzKGNvbHVtbk5hbWUpKSBjb250aW51ZVxuXG4gICAgICAgIGZvciAoY29uc3Qgc3FsIG9mIGF3YWl0IGRiLmNyZWF0ZUluZGV4U1FMcyh7Y29sdW1uczogW2NvbHVtbk5hbWVdLCBpZk5vdEV4aXN0czogZGIuZ2V0VHlwZSgpID09PSBcInNxbGl0ZVwiLCB0YWJsZU5hbWU6IEpPQlNfVEFCTEV9KSkge1xuICAgICAgICAgIGF3YWl0IGRiLnF1ZXJ5KHNxbClcbiAgICAgICAgfVxuICAgICAgfVxuXG4gICAgICBkYi5jbGVhclNjaGVtYUNhY2hlKClcbiAgICAgIGF3YWl0IHRoaXMuX3JlY29yZE1pZ3JhdGlvbihkYiwgbWlncmF0aW9uVmVyc2lvbilcbiAgICB9IGZpbmFsbHkge1xuICAgICAgYXdhaXQgZGIucmVsZWFzZUFkdmlzb3J5TG9jayhtaWdyYXRpb25LZXkpXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIElkZW1wb3RlbnRseSBjcmVhdGVzIHRoZSBvcmRlcmVkIGNvbXBvc2l0ZSByZXRlbnRpb24gaW5kZXhlcy4gQW4gaW5kZXhcbiAgICogd2l0aCB0aGUgZXhwZWN0ZWQgbmFtZSBidXQgYSBkaWZmZXJlbnQgY29sdW1uIG9yZGVyIGlzIGEgbWFudWFsLXJlcGFpclxuICAgKiBzaXR1YXRpb24gYW5kIGZhaWxzIHJlYWRpbmVzcyBsb3VkbHkgaW5zdGVhZCBvZiBiZWluZyByZWJ1aWx0IG9yXG4gICAqIHJlLXJlY29yZGVkOyB0aGUgbWlncmF0aW9uIGxlZGdlciBpcyB3cml0dGVuIG9ubHkgb25jZSBldmVyeSBleHBlY3RlZFxuICAgKiBpbmRleCBleGlzdHMgd2l0aCBpdHMgZXhhY3Qgb3JkZXJlZCBjb2x1bW5zLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL2RhdGFiYXNlL2RyaXZlcnMvYmFzZS5qc1wiKS5kZWZhdWx0fSBkYiAtIERhdGFiYXNlIGNvbm5lY3Rpb24uXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIHdoZW4gYWxsIHJldGVudGlvbiBpbmRleGVzIGV4aXN0LlxuICAgKi9cbiAgYXN5bmMgX2Vuc3VyZVJldGVudGlvbkluZGV4ZXNPbmNlKGRiKSB7XG4gICAgY29uc3QgbWlncmF0aW9uVmVyc2lvbiA9IFJFVEVOVElPTl9JTkRFWF9NSUdSQVRJT05fVkVSU0lPTlxuICAgIGNvbnN0IG1pZ3JhdGlvbktleSA9IHRoaXMuX21pZ3JhdGlvbktleShtaWdyYXRpb25WZXJzaW9uKVxuXG4gICAgaWYgKGF3YWl0IHRoaXMuX2hhc01pZ3JhdGlvbihkYiwgbWlncmF0aW9uVmVyc2lvbikpIHJldHVyblxuXG4gICAgY29uc3QgYWNxdWlyZWQgPSBhd2FpdCBkYi5hY3F1aXJlQWR2aXNvcnlMb2NrKG1pZ3JhdGlvbktleSlcblxuICAgIGlmICghYWNxdWlyZWQpIHRocm93IG5ldyBFcnJvcihcIkZhaWxlZCB0byBhY3F1aXJlIGJhY2tncm91bmQgam9icyByZXRlbnRpb24gaW5kZXggbG9ja1wiKVxuXG4gICAgdHJ5IHtcbiAgICAgIGlmIChhd2FpdCB0aGlzLl9oYXNNaWdyYXRpb24oZGIsIG1pZ3JhdGlvblZlcnNpb24pKSByZXR1cm5cblxuICAgICAgZGIuY2xlYXJTY2hlbWFDYWNoZSgpXG4gICAgICBjb25zdCB0YWJsZSA9IGF3YWl0IGRiLmdldFRhYmxlQnlOYW1lT3JGYWlsKEpPQlNfVEFCTEUpXG4gICAgICBjb25zdCBleGlzdGluZ0luZGV4Q29sdW1ucyA9IG5ldyBNYXAoXG4gICAgICAgIChhd2FpdCB0YWJsZS5nZXRJbmRleGVzKCkpLm1hcCgoaW5kZXgpID0+IFtpbmRleC5nZXROYW1lKCksIGluZGV4LmdldENvbHVtbk5hbWVzKCldKVxuICAgICAgKVxuXG4gICAgICBmb3IgKGNvbnN0IHtjb2x1bW5zLCBuYW1lfSBvZiBSRVRFTlRJT05fSU5ERVhfREVGSU5JVElPTlMpIHtcbiAgICAgICAgY29uc3QgZXhpc3RpbmdDb2x1bW5zID0gZXhpc3RpbmdJbmRleENvbHVtbnMuZ2V0KG5hbWUpXG5cbiAgICAgICAgaWYgKGV4aXN0aW5nQ29sdW1ucykge1xuICAgICAgICAgIGlmIChleGlzdGluZ0NvbHVtbnMuam9pbihcIixcIikgPT09IGNvbHVtbnMuam9pbihcIixcIikpIGNvbnRpbnVlXG4gICAgICAgICAgdGhyb3cgbmV3IEVycm9yKGBCYWNrZ3JvdW5kIGpvYnMgcmV0ZW50aW9uIGluZGV4ICR7bmFtZX0gZXhpc3RzIHdpdGggdW5leHBlY3RlZCBjb2x1bW5zOiAke2V4aXN0aW5nQ29sdW1ucy5qb2luKFwiLFwiKX1gKVxuICAgICAgICB9XG5cbiAgICAgICAgZm9yIChjb25zdCBzcWwgb2YgYXdhaXQgZGIuY3JlYXRlSW5kZXhTUUxzKHtjb2x1bW5zLCBpZk5vdEV4aXN0czogZGIuZ2V0VHlwZSgpID09PSBcInNxbGl0ZVwiLCBuYW1lLCB0YWJsZU5hbWU6IEpPQlNfVEFCTEV9KSkge1xuICAgICAgICAgIGF3YWl0IGRiLnF1ZXJ5KHNxbClcbiAgICAgICAgfVxuICAgICAgfVxuXG4gICAgICBkYi5jbGVhclNjaGVtYUNhY2hlKClcbiAgICAgIGF3YWl0IHRoaXMuX3JlY29yZE1pZ3JhdGlvbihkYiwgbWlncmF0aW9uVmVyc2lvbilcbiAgICB9IGZpbmFsbHkge1xuICAgICAgYXdhaXQgZGIucmVsZWFzZUFkdmlzb3J5TG9jayhtaWdyYXRpb25LZXkpXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIElkZW1wb3RlbnRseSBhZGRzIHRoZSBwZXItam9iIHdhbGwtY2xvY2sgdGltZW91dCB0byBleGlzdGluZyBqb2IgdGFibGVzLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL2RhdGFiYXNlL2RyaXZlcnMvYmFzZS5qc1wiKS5kZWZhdWx0fSBkYiAtIERhdGFiYXNlIGNvbm5lY3Rpb24uXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIHdoZW4gZW5zdXJlZC5cbiAgICovXG4gIGFzeW5jIF9lbnN1cmVKb2JUaW1lb3V0Q29sdW1uKGRiKSB7XG4gICAgY29uc3QgbG9ja05hbWUgPSBgJHtNSUdSQVRJT05fU0NPUEV9OnRpbWVvdXRfbXNfY29sdW1uYFxuICAgIGNvbnN0IGFjcXVpcmVkID0gYXdhaXQgZGIuYWNxdWlyZUFkdmlzb3J5TG9jayhsb2NrTmFtZSlcblxuICAgIGlmICghYWNxdWlyZWQpIHRocm93IG5ldyBFcnJvcihcIkZhaWxlZCB0byBhY3F1aXJlIGJhY2tncm91bmQgam9icyB0aW1lb3V0IHNjaGVtYSBsb2NrXCIpXG5cbiAgICB0cnkge1xuICAgICAgZGIuY2xlYXJTY2hlbWFDYWNoZSgpXG4gICAgICBjb25zdCB0YWJsZSA9IGF3YWl0IGRiLmdldFRhYmxlQnlOYW1lT3JGYWlsKEpPQlNfVEFCTEUpXG5cbiAgICAgIGlmICghKGF3YWl0IHRhYmxlLmdldENvbHVtbkJ5TmFtZShcInRpbWVvdXRfbXNcIikpKSB7XG4gICAgICAgIGNvbnN0IHRhYmxlRGF0YSA9IG5ldyBUYWJsZURhdGEoSk9CU19UQUJMRSlcbiAgICAgICAgdGFibGVEYXRhLmJpZ2ludChcInRpbWVvdXRfbXNcIiwge251bGw6IHRydWV9KVxuXG4gICAgICAgIGZvciAoY29uc3Qgc3FsIG9mIGF3YWl0IGRiLmFsdGVyVGFibGVTUUxzKHRhYmxlRGF0YSkpIGF3YWl0IGRiLnF1ZXJ5KHNxbClcblxuICAgICAgICBkYi5jbGVhclNjaGVtYUNhY2hlKClcbiAgICAgIH1cbiAgICB9IGZpbmFsbHkge1xuICAgICAgYXdhaXQgZGIucmVsZWFzZUFkdmlzb3J5TG9jayhsb2NrTmFtZSlcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogSWRlbXBvdGVudGx5IGFkZHMgdGhlIGhpc3RvcmljYWwgc3RhYmxlIHNjaGVkdWxlIGtleSB0byBleGlzdGluZyBqb2JzLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL2RhdGFiYXNlL2RyaXZlcnMvYmFzZS5qc1wiKS5kZWZhdWx0fSBkYiAtIERhdGFiYXNlIGNvbm5lY3Rpb24uXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIHdoZW4gZW5zdXJlZC5cbiAgICovXG4gIGFzeW5jIF9lbnN1cmVTY2hlZHVsZUtleUNvbHVtbihkYikge1xuICAgIGNvbnN0IGxvY2tOYW1lID0gYCR7TUlHUkFUSU9OX1NDT1BFfTpzY2hlZHVsZV9rZXlfY29sdW1uYFxuICAgIGNvbnN0IGFjcXVpcmVkID0gYXdhaXQgZGIuYWNxdWlyZUFkdmlzb3J5TG9jayhsb2NrTmFtZSlcblxuICAgIGlmICghYWNxdWlyZWQpIHRocm93IG5ldyBFcnJvcihcIkZhaWxlZCB0byBhY3F1aXJlIGJhY2tncm91bmQgam9icyBzY2hlZHVsZS1rZXkgc2NoZW1hIGxvY2tcIilcblxuICAgIHRyeSB7XG4gICAgICBkYi5jbGVhclNjaGVtYUNhY2hlKClcbiAgICAgIGNvbnN0IGxvY2tlZFRhYmxlID0gYXdhaXQgZGIuZ2V0VGFibGVCeU5hbWVPckZhaWwoSk9CU19UQUJMRSlcblxuICAgICAgaWYgKCEoYXdhaXQgbG9ja2VkVGFibGUuZ2V0Q29sdW1uQnlOYW1lKFwic2NoZWR1bGVfa2V5XCIpKSkge1xuICAgICAgICBjb25zdCB0YWJsZURhdGEgPSBuZXcgVGFibGVEYXRhKEpPQlNfVEFCTEUpXG5cbiAgICAgICAgdGFibGVEYXRhLnN0cmluZyhcInNjaGVkdWxlX2tleVwiLCB7bnVsbDogdHJ1ZSwgaW5kZXg6IHRydWV9KVxuXG4gICAgICAgIGZvciAoY29uc3Qgc3FsIG9mIGF3YWl0IGRiLmFsdGVyVGFibGVTUUxzKHRhYmxlRGF0YSkpIGF3YWl0IGRiLnF1ZXJ5KHNxbClcblxuICAgICAgICBkYi5jbGVhclNjaGVtYUNhY2hlKClcbiAgICAgIH1cbiAgICB9IGZpbmFsbHkge1xuICAgICAgYXdhaXQgZGIucmVsZWFzZUFkdmlzb3J5TG9jayhsb2NrTmFtZSlcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogSWRlbXBvdGVudGx5IGFkZHMgbW9ub3RvbmljIHNjaGVkdWxlIG93bmVyc2hpcCBoaXN0b3J5IGFuZCBpdHMgbG9va3VwIGluZGV4LlxuICAgKiBFeGlzdGluZyByb3dzIHJlbWFpbiBudWxsIGFuZCB1c2UgdGhlIGRvY3VtZW50ZWQgbGVnYWN5IGZhbGxiYWNrIG9yZGVyaW5nLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL2RhdGFiYXNlL2RyaXZlcnMvYmFzZS5qc1wiKS5kZWZhdWx0fSBkYiAtIERhdGFiYXNlIGNvbm5lY3Rpb24uXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIHdoZW4gZW5zdXJlZC5cbiAgICovXG4gIGFzeW5jIF9lbnN1cmVTY2hlZHVsZU9yZGVyQ29sdW1uKGRiKSB7XG4gICAgY29uc3QgbG9ja05hbWUgPSBgJHtNSUdSQVRJT05fU0NPUEV9OnNjaGVkdWxlX29yZGVyX2NvbHVtbmBcbiAgICBjb25zdCBhY3F1aXJlZCA9IGF3YWl0IGRiLmFjcXVpcmVBZHZpc29yeUxvY2sobG9ja05hbWUpXG5cbiAgICBpZiAoIWFjcXVpcmVkKSB0aHJvdyBuZXcgRXJyb3IoXCJGYWlsZWQgdG8gYWNxdWlyZSBiYWNrZ3JvdW5kIGpvYnMgc2NoZWR1bGUtb3JkZXIgc2NoZW1hIGxvY2tcIilcblxuICAgIHRyeSB7XG4gICAgICBkYi5jbGVhclNjaGVtYUNhY2hlKClcbiAgICAgIGxldCB0YWJsZSA9IGF3YWl0IGRiLmdldFRhYmxlQnlOYW1lT3JGYWlsKEpPQlNfVEFCTEUpXG5cbiAgICAgIGlmICghKGF3YWl0IHRhYmxlLmdldENvbHVtbkJ5TmFtZShcInNjaGVkdWxlX29yZGVyXCIpKSkge1xuICAgICAgICBjb25zdCB0YWJsZURhdGEgPSBuZXcgVGFibGVEYXRhKEpPQlNfVEFCTEUpXG5cbiAgICAgICAgdGFibGVEYXRhLmJpZ2ludChcInNjaGVkdWxlX29yZGVyXCIsIHtudWxsOiB0cnVlfSlcbiAgICAgICAgZm9yIChjb25zdCBzcWwgb2YgYXdhaXQgZGIuYWx0ZXJUYWJsZVNRTHModGFibGVEYXRhKSkgYXdhaXQgZGIucXVlcnkoc3FsKVxuICAgICAgICBkYi5jbGVhclNjaGVtYUNhY2hlKClcbiAgICAgICAgdGFibGUgPSBhd2FpdCBkYi5nZXRUYWJsZUJ5TmFtZU9yRmFpbChKT0JTX1RBQkxFKVxuICAgICAgfVxuXG4gICAgICBjb25zdCBpbmRleE5hbWVzID0gbmV3IFNldCgoYXdhaXQgdGFibGUuZ2V0SW5kZXhlcygpKS5tYXAoKGluZGV4KSA9PiBpbmRleC5nZXROYW1lKCkpKVxuXG4gICAgICBpZiAoIWluZGV4TmFtZXMuaGFzKFNDSEVEVUxFX0hJU1RPUllfT1JERVJfSU5ERVgpKSB7XG4gICAgICAgIGNvbnN0IHNxbHMgPSBhd2FpdCBkYi5jcmVhdGVJbmRleFNRTHMoe1xuICAgICAgICAgIGNvbHVtbnM6IFtcInNjaGVkdWxlX2tleVwiLCBcInNjaGVkdWxlX29yZGVyXCIsIFwiY3JlYXRlZF9hdF9tc1wiLCBcImlkXCJdLFxuICAgICAgICAgIGlmTm90RXhpc3RzOiBkYi5nZXRUeXBlKCkgPT09IFwic3FsaXRlXCIsXG4gICAgICAgICAgbmFtZTogU0NIRURVTEVfSElTVE9SWV9PUkRFUl9JTkRFWCxcbiAgICAgICAgICB0YWJsZU5hbWU6IEpPQlNfVEFCTEVcbiAgICAgICAgfSlcblxuICAgICAgICBmb3IgKGNvbnN0IHNxbCBvZiBzcWxzKSBhd2FpdCBkYi5xdWVyeShzcWwpXG4gICAgICAgIGRiLmNsZWFyU2NoZW1hQ2FjaGUoKVxuICAgICAgfVxuICAgIH0gZmluYWxseSB7XG4gICAgICBhd2FpdCBkYi5yZWxlYXNlQWR2aXNvcnlMb2NrKGxvY2tOYW1lKVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBDcmVhdGVzIHRoZSByZXRlbnRpb24taW5kZXBlbmRlbnQgc2NoZWR1bGUtb3JkZXIgaGlnaC13YXRlciB0YWJsZSBhbmRcbiAgICogaW5pdGlhbGl6ZXMgaXQgZnJvbSB0aGUgZ3JlYXRlc3QgcmV0YWluZWQgb3JkZXJlZCByb3cgZm9yIGV2ZXJ5IGtleS5cbiAgICogTGVnYWN5IHJvd3Mgd2hvc2Ugb3JkZXIgaXMgbnVsbCBkZWxpYmVyYXRlbHkgZG8gbm90IGVzdGFibGlzaCBhIHdhdGVybWFyay5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9kYXRhYmFzZS9kcml2ZXJzL2Jhc2UuanNcIikuZGVmYXVsdH0gZGIgLSBEYXRhYmFzZSBjb25uZWN0aW9uLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyB3aGVuIGVuc3VyZWQgYW5kIGJhY2tmaWxsZWQuXG4gICAqL1xuICBhc3luYyBfZW5zdXJlU2NoZWR1bGVPcmRlcldhdGVybWFya3NUYWJsZShkYikge1xuICAgIGNvbnN0IG1pZ3JhdGlvblZlcnNpb24gPSBTQ0hFRFVMRV9PUkRFUl9XQVRFUk1BUktfTUlHUkFUSU9OX1ZFUlNJT05cbiAgICBjb25zdCBtaWdyYXRpb25LZXkgPSB0aGlzLl9taWdyYXRpb25LZXkobWlncmF0aW9uVmVyc2lvbilcbiAgICBjb25zdCB0YWJsZUV4aXN0cyA9IGF3YWl0IGRiLnRhYmxlRXhpc3RzKFNDSEVEVUxFX09SREVSX1dBVEVSTUFSS1NfVEFCTEUpXG5cbiAgICBpZiAodGFibGVFeGlzdHMgJiYgYXdhaXQgdGhpcy5faGFzTWlncmF0aW9uKGRiLCBtaWdyYXRpb25WZXJzaW9uKSkgcmV0dXJuXG5cbiAgICBjb25zdCBhY3F1aXJlZCA9IGF3YWl0IGRiLmFjcXVpcmVBZHZpc29yeUxvY2sobWlncmF0aW9uS2V5KVxuXG4gICAgaWYgKCFhY3F1aXJlZCkgdGhyb3cgbmV3IEVycm9yKFwiRmFpbGVkIHRvIGFjcXVpcmUgYmFja2dyb3VuZCBqb2JzIHNjaGVkdWxlLW9yZGVyIHdhdGVybWFyayBzY2hlbWEgbG9ja1wiKVxuXG4gICAgdHJ5IHtcbiAgICAgIGRiLmNsZWFyU2NoZW1hQ2FjaGUoKVxuICAgICAgY29uc3QgbG9ja2VkVGFibGVFeGlzdHMgPSBhd2FpdCBkYi50YWJsZUV4aXN0cyhTQ0hFRFVMRV9PUkRFUl9XQVRFUk1BUktTX1RBQkxFKVxuICAgICAgY29uc3QgYWxyZWFkeUFwcGxpZWQgPSBhd2FpdCB0aGlzLl9oYXNNaWdyYXRpb24oZGIsIG1pZ3JhdGlvblZlcnNpb24pXG5cbiAgICAgIGlmICghbG9ja2VkVGFibGVFeGlzdHMpIHtcbiAgICAgICAgY29uc3QgdGFibGUgPSBuZXcgVGFibGVEYXRhKFNDSEVEVUxFX09SREVSX1dBVEVSTUFSS1NfVEFCTEUsIHtpZk5vdEV4aXN0czogdHJ1ZX0pXG5cbiAgICAgICAgdGFibGUuc3RyaW5nKFwic2NoZWR1bGVfa2V5XCIsIHtwcmltYXJ5S2V5OiB0cnVlfSlcbiAgICAgICAgdGFibGUuYmlnaW50KFwiaGlnaF93YXRlcl9tYXJrXCIsIHtudWxsOiBmYWxzZX0pXG4gICAgICAgIGF3YWl0IGRiLmNyZWF0ZVRhYmxlKHRhYmxlKVxuICAgICAgICBkYi5jbGVhclNjaGVtYUNhY2hlKClcbiAgICAgIH1cblxuICAgICAgLy8gUmVidWlsZCBhIG1pc3NpbmcgdGFibGUgZXZlbiB3aGVuIGl0cyBtaWdyYXRpb24gbGVkZ2VyIHN1cnZpdmVkLiBUaGVcbiAgICAgIC8vIHJldGFpbmVkIGpvYiByb3dzIGFyZSB0aGUgb25seSBjb21wYXRpYmxlIHNvdXJjZSBmb3IgdGhhdCByZWNvdmVyeTtcbiAgICAgIC8vIG9uY2Ugcm93cyBhcmUgcHJ1bmVkLCBub3JtYWwgc2NoZW1hIGR1cmFiaWxpdHkgcHJvdGVjdHMgdGhlIHdhdGVybWFyay5cbiAgICAgIGlmICghbG9ja2VkVGFibGVFeGlzdHMgfHwgIWFscmVhZHlBcHBsaWVkKSBhd2FpdCB0aGlzLl9iYWNrZmlsbFNjaGVkdWxlT3JkZXJXYXRlcm1hcmtzKGRiKVxuICAgICAgaWYgKCFhbHJlYWR5QXBwbGllZCkgYXdhaXQgdGhpcy5fcmVjb3JkTWlncmF0aW9uKGRiLCBtaWdyYXRpb25WZXJzaW9uKVxuICAgIH0gZmluYWxseSB7XG4gICAgICBhd2FpdCBkYi5yZWxlYXNlQWR2aXNvcnlMb2NrKG1pZ3JhdGlvbktleSlcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogQmFja2ZpbGxzIGVhY2gga2V5IGZyb20gaXRzIGdyZWF0ZXN0IHJldGFpbmVkIG5vbi1sZWdhY3kgb3duZXJzaGlwIG9yZGVyLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL2RhdGFiYXNlL2RyaXZlcnMvYmFzZS5qc1wiKS5kZWZhdWx0fSBkYiAtIERhdGFiYXNlIGNvbm5lY3Rpb24uXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIGFmdGVyIGFsbCByZXRhaW5lZCBrZXlzIGFyZSByZXByZXNlbnRlZC5cbiAgICovXG4gIGFzeW5jIF9iYWNrZmlsbFNjaGVkdWxlT3JkZXJXYXRlcm1hcmtzKGRiKSB7XG4gICAgY29uc3Qga2V5Um93cyA9IGF3YWl0IGRiXG4gICAgICAubmV3UXVlcnkoKVxuICAgICAgLmZyb20oSk9CU19UQUJMRSlcbiAgICAgIC5zZWxlY3QoXCJzY2hlZHVsZV9rZXlcIilcbiAgICAgIC53aGVyZU5vdCh7c2NoZWR1bGVfa2V5OiBudWxsfSlcbiAgICAgIC53aGVyZU5vdCh7c2NoZWR1bGVfb3JkZXI6IG51bGx9KVxuICAgICAgLmRpc3RpbmN0KClcbiAgICAgIC5yZXN1bHRzKClcblxuICAgIGZvciAoY29uc3Qga2V5Um93IG9mIGtleVJvd3MpIHtcbiAgICAgIGNvbnN0IHNjaGVkdWxlS2V5ID0gU3RyaW5nKC8qKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSAqLyAoa2V5Um93KS5zY2hlZHVsZV9rZXkpXG4gICAgICBjb25zdCByZXRhaW5lZE9yZGVyID0gYXdhaXQgdGhpcy5fZ3JlYXRlc3RSZXRhaW5lZFNjaGVkdWxlT3JkZXIoZGIsIHNjaGVkdWxlS2V5KVxuICAgICAgY29uc3QgY3VycmVudFdhdGVybWFyayA9IGF3YWl0IHRoaXMuX3NjaGVkdWxlT3JkZXJXYXRlcm1hcmsoZGIsIHNjaGVkdWxlS2V5KVxuXG4gICAgICBpZiAocmV0YWluZWRPcmRlciA9PT0gbnVsbCkgY29udGludWVcbiAgICAgIGlmIChjdXJyZW50V2F0ZXJtYXJrICE9PSBudWxsICYmIGN1cnJlbnRXYXRlcm1hcmsgPj0gcmV0YWluZWRPcmRlcikgY29udGludWVcbiAgICAgIGF3YWl0IHRoaXMuX3dyaXRlU2NoZWR1bGVPcmRlcldhdGVybWFyayhkYiwge3NjaGVkdWxlS2V5LCBzY2hlZHVsZU9yZGVyOiByZXRhaW5lZE9yZGVyfSlcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogSWRlbXBvdGVudGx5IGFkZHMgdGhlIGBxdWV1ZWAgY29sdW1uIHRvIGFuIGV4aXN0aW5nIGpvYnMgdGFibGUuIEV4aXN0aW5nXG4gICAqIHJvd3MgcmVhZCBiYWNrIGFzIHRoZSBkZWZhdWx0IHF1ZXVlIChzZWUge0BsaW5rIF9ub3JtYWxpemVKb2JSb3d9KSwgc28gbm9cbiAgICogZGF0YSBiYWNrZmlsbCBpcyByZXF1aXJlZC5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9kYXRhYmFzZS9kcml2ZXJzL2Jhc2UuanNcIikuZGVmYXVsdH0gZGIgLSBEYXRhYmFzZSBjb25uZWN0aW9uLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyB3aGVuIGVuc3VyZWQuXG4gICAqL1xuICBhc3luYyBfZW5zdXJlUXVldWVDb2x1bW4oZGIpIHtcbiAgICBjb25zdCBsb2NrTmFtZSA9IGAke01JR1JBVElPTl9TQ09QRX06cXVldWVfY29sdW1uYFxuICAgIGNvbnN0IGFjcXVpcmVkID0gYXdhaXQgZGIuYWNxdWlyZUFkdmlzb3J5TG9jayhsb2NrTmFtZSlcblxuICAgIGlmICghYWNxdWlyZWQpIHRocm93IG5ldyBFcnJvcihcIkZhaWxlZCB0byBhY3F1aXJlIGJhY2tncm91bmQgam9icyBxdWV1ZSBzY2hlbWEgbG9ja1wiKVxuXG4gICAgdHJ5IHtcbiAgICAgIC8vIFNRTCBTZXJ2ZXIgc2NoZW1hIHJlYWRzIGNhbiBkZWFkbG9jayB3aXRoIGEgY29uY3VycmVudCBBTFRFUiBUQUJMRSwgc29cbiAgICAgIC8vIGFjcXVpcmUgdGhlIGxvY2sgYmVmb3JlIGluc3BlY3RpbmcgdGhlIGNvbHVtbiByYXRoZXIgdGhhbiBvbmx5XG4gICAgICAvLyBwcm90ZWN0aW5nIHRoZSBtdXRhdGlvbiAobWlycm9ycyB0aGUgY29uY3VycmVuY3ktY29sdW1uIG1pZ3JhdGlvbikuXG4gICAgICBkYi5jbGVhclNjaGVtYUNhY2hlKClcbiAgICAgIGNvbnN0IGxvY2tlZFRhYmxlID0gYXdhaXQgZGIuZ2V0VGFibGVCeU5hbWVPckZhaWwoSk9CU19UQUJMRSlcblxuICAgICAgaWYgKCEoYXdhaXQgbG9ja2VkVGFibGUuZ2V0Q29sdW1uQnlOYW1lKFwicXVldWVcIikpKSB7XG4gICAgICAgIGNvbnN0IHRhYmxlRGF0YSA9IG5ldyBUYWJsZURhdGEoSk9CU19UQUJMRSlcblxuICAgICAgICB0YWJsZURhdGEuc3RyaW5nKFwicXVldWVcIiwge251bGw6IHRydWUsIGluZGV4OiB0cnVlfSlcblxuICAgICAgICBmb3IgKGNvbnN0IHNxbCBvZiBhd2FpdCBkYi5hbHRlclRhYmxlU1FMcyh0YWJsZURhdGEpKSBhd2FpdCBkYi5xdWVyeShzcWwpXG5cbiAgICAgICAgZGIuY2xlYXJTY2hlbWFDYWNoZSgpXG4gICAgICB9XG4gICAgfSBmaW5hbGx5IHtcbiAgICAgIGF3YWl0IGRiLnJlbGVhc2VBZHZpc29yeUxvY2sobG9ja05hbWUpXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgYmFja2ZpbGwgZXhlY3V0aW9uIG1vZGVzIG9uY2UuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vZGF0YWJhc2UvZHJpdmVycy9iYXNlLmpzXCIpLmRlZmF1bHR9IGRiIC0gRGF0YWJhc2UgY29ubmVjdGlvbi5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgd2hlbiBjb21wbGV0ZS5cbiAgICovXG4gIGFzeW5jIF9iYWNrZmlsbEV4ZWN1dGlvbk1vZGVzT25jZShkYikge1xuICAgIGNvbnN0IG1pZ3JhdGlvblZlcnNpb24gPSBFWEVDVVRJT05fTU9ERV9CQUNLRklMTF9NSUdSQVRJT05fVkVSU0lPTlxuICAgIGNvbnN0IG1pZ3JhdGlvbktleSA9IHRoaXMuX21pZ3JhdGlvbktleShtaWdyYXRpb25WZXJzaW9uKVxuXG4gICAgaWYgKGF3YWl0IHRoaXMuX2hhc01pZ3JhdGlvbihkYiwgbWlncmF0aW9uVmVyc2lvbikpIHJldHVyblxuXG4gICAgYXdhaXQgZGIuYWNxdWlyZUFkdmlzb3J5TG9jayhtaWdyYXRpb25LZXkpXG5cbiAgICB0cnkge1xuICAgICAgaWYgKGF3YWl0IHRoaXMuX2hhc01pZ3JhdGlvbihkYiwgbWlncmF0aW9uVmVyc2lvbikpIHJldHVyblxuXG4gICAgICAvLyBBIHRhYmxlIGNyZWF0ZWQgYWZ0ZXIgdGhlIGBmb3JrZWRgIGNvbHVtbiB3YXMgZHJvcHBlZCBoYXMgbm90aGluZyB0b1xuICAgICAgLy8gYmFja2ZpbGwgZnJvbTsgcmVjb3JkIHRoZSBtaWdyYXRpb24gc28gaXQgaXMgbm90IHJlLWF0dGVtcHRlZC5cbiAgICAgIGRiLmNsZWFyU2NoZW1hQ2FjaGUoKVxuICAgICAgaWYgKCEoYXdhaXQgKGF3YWl0IGRiLmdldFRhYmxlQnlOYW1lT3JGYWlsKEpPQlNfVEFCTEUpKS5nZXRDb2x1bW5CeU5hbWUoXCJmb3JrZWRcIikpKSB7XG4gICAgICAgIGF3YWl0IHRoaXMuX3JlY29yZE1pZ3JhdGlvbihkYiwgbWlncmF0aW9uVmVyc2lvbilcbiAgICAgICAgcmV0dXJuXG4gICAgICB9XG5cbiAgICAgIGNvbnN0IHRhYmxlTmFtZVNxbCA9IGRiLnF1b3RlVGFibGUoSk9CU19UQUJMRSlcbiAgICAgIGNvbnN0IGZvcmtlZENvbHVtblNxbCA9IGRiLnF1b3RlQ29sdW1uKFwiZm9ya2VkXCIpXG4gICAgICBjb25zdCBleGVjdXRpb25Nb2RlQ29sdW1uU3FsID0gZGIucXVvdGVDb2x1bW4oXCJleGVjdXRpb25fbW9kZVwiKVxuXG4gICAgICBhd2FpdCBkYi5xdWVyeShcbiAgICAgICAgYFVQREFURSAke3RhYmxlTmFtZVNxbH0gU0VUICR7ZXhlY3V0aW9uTW9kZUNvbHVtblNxbH0gPSAke2RiLnF1b3RlKFwiZm9ya2VkXCIpfSBgICtcbiAgICAgICAgYFdIRVJFICR7Zm9ya2VkQ29sdW1uU3FsfSA9ICR7ZGIucXVvdGUodHJ1ZSl9IEFORCAke2V4ZWN1dGlvbk1vZGVDb2x1bW5TcWx9IElTIE5VTExgXG4gICAgICApXG4gICAgICBhd2FpdCBkYi5xdWVyeShcbiAgICAgICAgYFVQREFURSAke3RhYmxlTmFtZVNxbH0gU0VUICR7ZXhlY3V0aW9uTW9kZUNvbHVtblNxbH0gPSAke2RiLnF1b3RlKFwiaW5saW5lXCIpfSBgICtcbiAgICAgICAgYFdIRVJFICR7Zm9ya2VkQ29sdW1uU3FsfSA9ICR7ZGIucXVvdGUoZmFsc2UpfSBBTkQgJHtleGVjdXRpb25Nb2RlQ29sdW1uU3FsfSBJUyBOVUxMYFxuICAgICAgKVxuXG4gICAgICBhd2FpdCB0aGlzLl9yZWNvcmRNaWdyYXRpb24oZGIsIG1pZ3JhdGlvblZlcnNpb24pXG4gICAgfSBmaW5hbGx5IHtcbiAgICAgIGF3YWl0IGRiLnJlbGVhc2VBZHZpc29yeUxvY2sobWlncmF0aW9uS2V5KVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBSZXdyaXRlcyBwcmUtZXhpc3RpbmcgcG9vbGVkIHJvd3MgKHBlcnNpc3RlZCBhcyBgZXhlY3V0aW9uX21vZGUgPSBcImZvcmtlZFwiYFxuICAgKiBwbHVzIGEgYHZlbG9jaW91cy1wb29sZWQ6KmAgaGFuZG9mZiBtYXJrZXIpIHRvIGBleGVjdXRpb25fbW9kZSA9IFwicG9vbGVkXCJgLFxuICAgKiBjbGVhcnMgdGhlIHF1ZXVlZCBtYXJrZXIsIHRoZW4gZHJvcHMgdGhlIG5vdy1yZWR1bmRhbnQgYGZvcmtlZGAgY29sdW1uIHNvXG4gICAqIGBleGVjdXRpb25fbW9kZWAgaXMgdGhlIHNpbmdsZSBzb3VyY2Ugb2YgdHJ1dGguIFJ1bnMgb25jZSwgZ3VhcmRlZCBieSB0aGVcbiAgICogbWlncmF0aW9uIGxlZGdlciBhbmQgYSBwZXIta2V5IGFkdmlzb3J5IGxvY2s7IGEgZnJlc2ggdGFibGUgKGNyZWF0ZWQgd2l0aG91dFxuICAgKiB0aGUgY29sdW1uKSBzaG9ydC1jaXJjdWl0cy5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9kYXRhYmFzZS9kcml2ZXJzL2Jhc2UuanNcIikuZGVmYXVsdH0gZGIgLSBEYXRhYmFzZSBjb25uZWN0aW9uLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyB3aGVuIGNvbXBsZXRlLlxuICAgKi9cbiAgYXN5bmMgX2Ryb3BGb3JrZWRDb2x1bW5PbmNlKGRiKSB7XG4gICAgY29uc3QgbWlncmF0aW9uVmVyc2lvbiA9IERST1BfRk9SS0VEX0NPTFVNTl9NSUdSQVRJT05fVkVSU0lPTlxuICAgIGNvbnN0IG1pZ3JhdGlvbktleSA9IHRoaXMuX21pZ3JhdGlvbktleShtaWdyYXRpb25WZXJzaW9uKVxuXG4gICAgaWYgKGF3YWl0IHRoaXMuX2hhc01pZ3JhdGlvbihkYiwgbWlncmF0aW9uVmVyc2lvbikpIHJldHVyblxuXG4gICAgYXdhaXQgZGIuYWNxdWlyZUFkdmlzb3J5TG9jayhtaWdyYXRpb25LZXkpXG5cbiAgICB0cnkge1xuICAgICAgaWYgKGF3YWl0IHRoaXMuX2hhc01pZ3JhdGlvbihkYiwgbWlncmF0aW9uVmVyc2lvbikpIHJldHVyblxuXG4gICAgICBkYi5jbGVhclNjaGVtYUNhY2hlKClcblxuICAgICAgaWYgKGF3YWl0IChhd2FpdCBkYi5nZXRUYWJsZUJ5TmFtZU9yRmFpbChKT0JTX1RBQkxFKSkuZ2V0Q29sdW1uQnlOYW1lKFwiZm9ya2VkXCIpKSB7XG4gICAgICAgIGNvbnN0IHRhYmxlTmFtZVNxbCA9IGRiLnF1b3RlVGFibGUoSk9CU19UQUJMRSlcbiAgICAgICAgY29uc3QgZXhlY3V0aW9uTW9kZUNvbHVtblNxbCA9IGRiLnF1b3RlQ29sdW1uKFwiZXhlY3V0aW9uX21vZGVcIilcbiAgICAgICAgY29uc3QgaGFuZG9mZklkQ29sdW1uU3FsID0gZGIucXVvdGVDb2x1bW4oXCJoYW5kb2ZmX2lkXCIpXG5cbiAgICAgICAgLy8gUG9vbGVkIHJvd3MgdXNlZCB0byBwZXJzaXN0IGFzIGV4ZWN1dGlvbl9tb2RlIFwiZm9ya2VkXCIgKyBhIHBvb2xlZCBoYW5kb2ZmXG4gICAgICAgIC8vIG1hcmtlcjsgcmVjb3ZlciB0aGVpciByZWFsIG1vZGUgYmVmb3JlIHRoZSBtYXJrZXIgaXMgY2xlYXJlZC5cbiAgICAgICAgYXdhaXQgZGIucXVlcnkoXG4gICAgICAgICAgYFVQREFURSAke3RhYmxlTmFtZVNxbH0gU0VUICR7ZXhlY3V0aW9uTW9kZUNvbHVtblNxbH0gPSAke2RiLnF1b3RlKFwicG9vbGVkXCIpfSBgICtcbiAgICAgICAgICBgV0hFUkUgJHtleGVjdXRpb25Nb2RlQ29sdW1uU3FsfSA9ICR7ZGIucXVvdGUoXCJmb3JrZWRcIil9IGAgK1xuICAgICAgICAgIGBBTkQgJHtoYW5kb2ZmSWRDb2x1bW5TcWx9IExJS0UgJHtkYi5xdW90ZShgJHtMRUdBQ1lfUE9PTEVEX0hBTkRPRkZfSURfUFJFRklYfSVgKX1gXG4gICAgICAgIClcbiAgICAgICAgLy8gVGhlIHF1ZXVlZC1wb29sZWQgbWFya2VyIHdhcyBhIHNlbnRpbmVsLCBub3QgYSByZWFsIGxlYXNlOyBjbGVhciBpdC5cbiAgICAgICAgYXdhaXQgZGIucXVlcnkoXG4gICAgICAgICAgYFVQREFURSAke3RhYmxlTmFtZVNxbH0gU0VUICR7aGFuZG9mZklkQ29sdW1uU3FsfSA9IE5VTEwgYCArXG4gICAgICAgICAgYFdIRVJFICR7aGFuZG9mZklkQ29sdW1uU3FsfSA9ICR7ZGIucXVvdGUoTEVHQUNZX1BPT0xFRF9RVUVVRURfSEFORE9GRl9JRCl9YFxuICAgICAgICApXG5cbiAgICAgICAgY29uc3QgZHJvcEZvcmtlZCA9IG5ldyBUYWJsZURhdGEoSk9CU19UQUJMRSlcbiAgICAgICAgZHJvcEZvcmtlZC5hZGRDb2x1bW4oXCJmb3JrZWRcIiwge2Ryb3BDb2x1bW46IHRydWV9KVxuICAgICAgICBmb3IgKGNvbnN0IHNxbCBvZiBhd2FpdCBkYi5hbHRlclRhYmxlU1FMcyhkcm9wRm9ya2VkKSkgYXdhaXQgZGIucXVlcnkoc3FsKVxuXG4gICAgICAgIGRiLmNsZWFyU2NoZW1hQ2FjaGUoKVxuICAgICAgfVxuXG4gICAgICBhd2FpdCB0aGlzLl9yZWNvcmRNaWdyYXRpb24oZGIsIG1pZ3JhdGlvblZlcnNpb24pXG4gICAgfSBmaW5hbGx5IHtcbiAgICAgIGF3YWl0IGRiLnJlbGVhc2VBZHZpc29yeUxvY2sobWlncmF0aW9uS2V5KVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHJlY29yZCBtaWdyYXRpb24uXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vZGF0YWJhc2UvZHJpdmVycy9iYXNlLmpzXCIpLmRlZmF1bHR9IGRiIC0gRGF0YWJhc2UgY29ubmVjdGlvbi5cbiAgICogQHBhcmFtIHtzdHJpbmd9IHZlcnNpb24gLSBNaWdyYXRpb24gdmVyc2lvbi5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgd2hlbiBjb21wbGV0ZS5cbiAgICovXG4gIGFzeW5jIF9yZWNvcmRNaWdyYXRpb24oZGIsIHZlcnNpb24pIHtcbiAgICBhd2FpdCBkYi51cHNlcnQoe1xuICAgICAgdGFibGVOYW1lOiBNSUdSQVRJT05TX1RBQkxFLFxuICAgICAgZGF0YToge1xuICAgICAgICBrZXk6IHRoaXMuX21pZ3JhdGlvbktleSh2ZXJzaW9uKSxcbiAgICAgICAgc2NvcGU6IE1JR1JBVElPTl9TQ09QRSxcbiAgICAgICAgdmVyc2lvbixcbiAgICAgICAgYXBwbGllZF9hdF9tczogRGF0ZS5ub3coKVxuICAgICAgfSxcbiAgICAgIGNvbmZsaWN0Q29sdW1uczogW1wia2V5XCJdLFxuICAgICAgdXBkYXRlQ29sdW1uczogW1wic2NvcGVcIiwgXCJ2ZXJzaW9uXCIsIFwiYXBwbGllZF9hdF9tc1wiXVxuICAgIH0pXG4gIH1cblxuICBhc3luYyBfaW5pdGlhbGl6ZU1vZGVsKCkge1xuICAgIGlmIChCYWNrZ3JvdW5kSm9iUmVjb3JkLmlzSW5pdGlhbGl6ZWQoKSkgcmV0dXJuXG5cbiAgICBCYWNrZ3JvdW5kSm9iUmVjb3JkLnNldERhdGFiYXNlSWRlbnRpZmllcih0aGlzLmdldERhdGFiYXNlSWRlbnRpZmllcigpKVxuICAgIGNvbnN0IHBvb2wgPSB0aGlzLmNvbmZpZ3VyYXRpb24uZ2V0RGF0YWJhc2VQb29sKHRoaXMuZ2V0RGF0YWJhc2VJZGVudGlmaWVyKCkpXG5cbiAgICBhd2FpdCBwb29sLndpdGhDb25uZWN0aW9uKHtuYW1lOiBcIkJhY2tncm91bmQgam9icyBzdG9yZSBpbml0aWFsaXplIG1vZGVsXCJ9LCBhc3luYyAoKSA9PiB7XG4gICAgICBhd2FpdCBCYWNrZ3JvdW5kSm9iUmVjb3JkLmluaXRpYWxpemVSZWNvcmQoe2NvbmZpZ3VyYXRpb246IHRoaXMuY29uZmlndXJhdGlvbn0pXG4gICAgfSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGdldCBqb2Igcm93IGJ5IGlkLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL2RhdGFiYXNlL2RyaXZlcnMvYmFzZS5qc1wiKS5kZWZhdWx0fSBkYiAtIERhdGFiYXNlIGNvbm5lY3Rpb24uXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBqb2JJZCAtIEpvYiBpZC5cbiAgICogQHJldHVybnMge1Byb21pc2U8aW1wb3J0KFwiLi90eXBlcy5qc1wiKS5CYWNrZ3JvdW5kSm9iUm93IHwgbnVsbD59IC0gSm9iIHJvdy5cbiAgICovXG4gIGFzeW5jIF9nZXRKb2JSb3dCeUlkKGRiLCBqb2JJZCkge1xuICAgIGNvbnN0IHF1ZXJ5ID0gZGJcbiAgICAgIC5uZXdRdWVyeSgpXG4gICAgICAuZnJvbShKT0JTX1RBQkxFKVxuICAgICAgLndoZXJlKHtpZDogam9iSWR9KVxuICAgICAgLmxpbWl0KDEpXG5cbiAgICBjb25zdCByb3dzID0gYXdhaXQgcXVlcnkucmVzdWx0cygpXG5cbiAgICBpZiAoIXJvd3NbMF0pIHJldHVybiBudWxsXG5cbiAgICByZXR1cm4gdGhpcy5fbm9ybWFsaXplSm9iUm93KHJvd3NbMF0pXG4gIH1cblxuICAvKipcbiAgICogUmVhZHMgdGhlIGpvYiBjdXJyZW50bHkgbmFtZWQgYnkgb25lIHN0YWJsZSBvd25lciByb3cuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vZGF0YWJhc2UvZHJpdmVycy9iYXNlLmpzXCIpLmRlZmF1bHR9IGRiIC0gRGF0YWJhc2UgY29ubmVjdGlvbi5cbiAgICogQHBhcmFtIHtzdHJpbmd9IHNjaGVkdWxlS2V5IC0gVmFsaWRhdGVkIHN0YWJsZSBzY2hlZHVsZSBrZXkuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPGltcG9ydChcIi4vdHlwZXMuanNcIikuQmFja2dyb3VuZEpvYlJvdyB8IG51bGw+fSAtIE5vcm1hbGl6ZWQgb3duZXIgam9iLlxuICAgKi9cbiAgYXN5bmMgX3NjaGVkdWxlZE93bmVySm9iKGRiLCBzY2hlZHVsZUtleSkge1xuICAgIGNvbnN0IG93bmVyUm93cyA9IGF3YWl0IGRiXG4gICAgICAubmV3UXVlcnkoKVxuICAgICAgLmZyb20oU0NIRURVTEVfS0VZU19UQUJMRSlcbiAgICAgIC53aGVyZSh7c2NoZWR1bGVfa2V5OiBzY2hlZHVsZUtleX0pXG4gICAgICAubGltaXQoMSlcbiAgICAgIC5yZXN1bHRzKClcbiAgICBjb25zdCBvd25lclJvdyA9IG93bmVyUm93c1swXVxuXG4gICAgaWYgKCFvd25lclJvdykgcmV0dXJuIG51bGxcblxuICAgIHJldHVybiBhd2FpdCB0aGlzLl9nZXRKb2JSb3dCeUlkKGRiLCBTdHJpbmcob3duZXJSb3cuam9iX2lkKSlcbiAgfVxuXG4gIC8qKlxuICAgKiBBc3NpZ25zIHRoZSBuZXh0IG93bmVyc2hpcCBvcmRlciB3aGlsZSB0aGUgY2FsbGVyIGhvbGRzIHRoZSBzY2hlZHVsZS1rZXlcbiAgICogYWR2aXNvcnkgbG9jayBhbmQgY291bnQtcmV2aXNpb24gdHJhbnNhY3Rpb24gZmVuY2UuIFRoZSBpbmRlcGVuZGVudFxuICAgKiB3YXRlcm1hcmsgc3Vydml2ZXMgYm90aCBvd25lcnNoaXAgcmVsZWFzZSBhbmQgdGVybWluYWwtaGlzdG9yeSBwcnVuaW5nLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL2RhdGFiYXNlL2RyaXZlcnMvYmFzZS5qc1wiKS5kZWZhdWx0fSBkYiAtIERhdGFiYXNlIGNvbm5lY3Rpb24uXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBzY2hlZHVsZUtleSAtIFZhbGlkYXRlZCBzdGFibGUgc2NoZWR1bGUga2V5LlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxudW1iZXI+fSAtIE5leHQgbW9ub3RvbmljIG93bmVyc2hpcCBvcmRlci5cbiAgICovXG4gIGFzeW5jIF9uZXh0U2NoZWR1bGVPcmRlcihkYiwgc2NoZWR1bGVLZXkpIHtcbiAgICBjb25zdCBkdXJhYmxlT3JkZXIgPSBhd2FpdCB0aGlzLl9zY2hlZHVsZU9yZGVyV2F0ZXJtYXJrKGRiLCBzY2hlZHVsZUtleSlcbiAgICBjb25zdCByZXRhaW5lZE9yZGVyID0gYXdhaXQgdGhpcy5fZ3JlYXRlc3RSZXRhaW5lZFNjaGVkdWxlT3JkZXIoZGIsIHNjaGVkdWxlS2V5KVxuICAgIGxldCBjdXJyZW50T3JkZXIgPSBkdXJhYmxlT3JkZXJcblxuICAgIGlmIChyZXRhaW5lZE9yZGVyICE9PSBudWxsICYmIChjdXJyZW50T3JkZXIgPT09IG51bGwgfHwgcmV0YWluZWRPcmRlciA+IGN1cnJlbnRPcmRlcikpIGN1cnJlbnRPcmRlciA9IHJldGFpbmVkT3JkZXJcbiAgICBjb25zdCBuZXh0T3JkZXIgPSBjdXJyZW50T3JkZXIgPT09IG51bGwgPyAxIDogY3VycmVudE9yZGVyICsgMVxuXG4gICAgaWYgKCFOdW1iZXIuaXNTYWZlSW50ZWdlcihuZXh0T3JkZXIpKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoYEJhY2tncm91bmQgam9iIHNjaGVkdWxlIG93bmVyc2hpcCBvcmRlciBleGhhdXN0ZWQgZm9yICR7c2NoZWR1bGVLZXl9YClcbiAgICB9XG5cbiAgICBhd2FpdCB0aGlzLl93cml0ZVNjaGVkdWxlT3JkZXJXYXRlcm1hcmsoZGIsIHtzY2hlZHVsZUtleSwgc2NoZWR1bGVPcmRlcjogbmV4dE9yZGVyfSlcblxuICAgIHJldHVybiBuZXh0T3JkZXJcbiAgfVxuXG4gIC8qKlxuICAgKiBGaW5kcyB0aGUgZ3JlYXRlc3QgcmV0YWluZWQgbm9uLWxlZ2FjeSBvd25lcnNoaXAgb3JkZXIgZm9yIG1pZ3JhdGlvbiBhbmRcbiAgICogcm9sbGluZy11cGdyYWRlIGNvbXBhdGliaWxpdHkuIEl0IGlzIG5ldmVyIHRoZSBzb2xlIGR1cmFiaWxpdHkgYm91bmRhcnkuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vZGF0YWJhc2UvZHJpdmVycy9iYXNlLmpzXCIpLmRlZmF1bHR9IGRiIC0gRGF0YWJhc2UgY29ubmVjdGlvbi5cbiAgICogQHBhcmFtIHtzdHJpbmd9IHNjaGVkdWxlS2V5IC0gVmFsaWRhdGVkIHN0YWJsZSBzY2hlZHVsZSBrZXkuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPG51bWJlciB8IG51bGw+fSAtIEdyZWF0ZXN0IHJldGFpbmVkIG9yZGVyLCBvciBudWxsLlxuICAgKi9cbiAgYXN5bmMgX2dyZWF0ZXN0UmV0YWluZWRTY2hlZHVsZU9yZGVyKGRiLCBzY2hlZHVsZUtleSkge1xuICAgIGNvbnN0IHJvd3MgPSBhd2FpdCBkYlxuICAgICAgLm5ld1F1ZXJ5KClcbiAgICAgIC5mcm9tKEpPQlNfVEFCTEUpXG4gICAgICAuc2VsZWN0KFwic2NoZWR1bGVfb3JkZXJcIilcbiAgICAgIC53aGVyZSh7c2NoZWR1bGVfa2V5OiBzY2hlZHVsZUtleX0pXG4gICAgICAud2hlcmVOb3Qoe3NjaGVkdWxlX29yZGVyOiBudWxsfSlcbiAgICAgIC5vcmRlcihcInNjaGVkdWxlX29yZGVyIERFU0NcIilcbiAgICAgIC5saW1pdCgxKVxuICAgICAgLnJlc3VsdHMoKVxuICAgIGNvbnN0IHJvdyA9IHJvd3NbMF1cblxuICAgIGlmICghcm93KSByZXR1cm4gbnVsbFxuXG4gICAgcmV0dXJuIHRoaXMuX3ZhbGlkYXRlZFNjaGVkdWxlT3JkZXIoXG4gICAgICAvKiogQHR5cGUge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gKi8gKHJvdykuc2NoZWR1bGVfb3JkZXJcbiAgICApXG4gIH1cblxuICAvKipcbiAgICogUmVhZHMgYW5kIHZhbGlkYXRlcyBvbmUgcmV0ZW50aW9uLWluZGVwZW5kZW50IHNjaGVkdWxlLW9yZGVyIHdhdGVybWFyay5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9kYXRhYmFzZS9kcml2ZXJzL2Jhc2UuanNcIikuZGVmYXVsdH0gZGIgLSBEYXRhYmFzZSBjb25uZWN0aW9uLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gc2NoZWR1bGVLZXkgLSBWYWxpZGF0ZWQgc3RhYmxlIHNjaGVkdWxlIGtleS5cbiAgICogQHJldHVybnMge1Byb21pc2U8bnVtYmVyIHwgbnVsbD59IC0gQ3VycmVudCB3YXRlcm1hcmssIG9yIG51bGwgYmVmb3JlIGZpcnN0IG93bmVyc2hpcC5cbiAgICovXG4gIGFzeW5jIF9zY2hlZHVsZU9yZGVyV2F0ZXJtYXJrKGRiLCBzY2hlZHVsZUtleSkge1xuICAgIGNvbnN0IHJvd3MgPSBhd2FpdCBkYlxuICAgICAgLm5ld1F1ZXJ5KClcbiAgICAgIC5mcm9tKFNDSEVEVUxFX09SREVSX1dBVEVSTUFSS1NfVEFCTEUpXG4gICAgICAuc2VsZWN0KFwiaGlnaF93YXRlcl9tYXJrXCIpXG4gICAgICAud2hlcmUoe3NjaGVkdWxlX2tleTogc2NoZWR1bGVLZXl9KVxuICAgICAgLmxpbWl0KDEpXG4gICAgICAucmVzdWx0cygpXG4gICAgY29uc3Qgcm93ID0gcm93c1swXVxuXG4gICAgaWYgKCFyb3cpIHJldHVybiBudWxsXG5cbiAgICByZXR1cm4gdGhpcy5fdmFsaWRhdGVkU2NoZWR1bGVPcmRlcihcbiAgICAgIC8qKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSAqLyAocm93KS5oaWdoX3dhdGVyX21hcmtcbiAgICApXG4gIH1cblxuICAvKipcbiAgICogUGVyc2lzdHMgb25lIHNjaGVkdWxlLW9yZGVyIHdhdGVybWFyayB3aXRob3V0IGV4cG9zaW5nIGl0IGFzIGEgam9iIHJvdy5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9kYXRhYmFzZS9kcml2ZXJzL2Jhc2UuanNcIikuZGVmYXVsdH0gZGIgLSBEYXRhYmFzZSBjb25uZWN0aW9uLlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIFdhdGVybWFyayBpZGVudGl0eSBhbmQgdmFsdWUuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBhcmdzLnNjaGVkdWxlS2V5IC0gVmFsaWRhdGVkIHN0YWJsZSBzY2hlZHVsZSBrZXkuXG4gICAqIEBwYXJhbSB7bnVtYmVyfSBhcmdzLnNjaGVkdWxlT3JkZXIgLSBWYWxpZGF0ZWQgbW9ub3RvbmljIG9yZGVyLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyBhZnRlciBwZXJzaXN0ZW5jZS5cbiAgICovXG4gIGFzeW5jIF93cml0ZVNjaGVkdWxlT3JkZXJXYXRlcm1hcmsoZGIsIHtzY2hlZHVsZUtleSwgc2NoZWR1bGVPcmRlcn0pIHtcbiAgICBhd2FpdCBkYi51cHNlcnQoe1xuICAgICAgdGFibGVOYW1lOiBTQ0hFRFVMRV9PUkRFUl9XQVRFUk1BUktTX1RBQkxFLFxuICAgICAgZGF0YToge2hpZ2hfd2F0ZXJfbWFyazogc2NoZWR1bGVPcmRlciwgc2NoZWR1bGVfa2V5OiBzY2hlZHVsZUtleX0sXG4gICAgICBjb25mbGljdENvbHVtbnM6IFtcInNjaGVkdWxlX2tleVwiXSxcbiAgICAgIHVwZGF0ZUNvbHVtbnM6IFtcImhpZ2hfd2F0ZXJfbWFya1wiXVxuICAgIH0pXG4gIH1cblxuICAvKipcbiAgICogVmFsaWRhdGVzIGFuIG93bmVyc2hpcCBvcmRlciBsb2FkZWQgZnJvbSBkdXJhYmxlIHN0b3JhZ2UuXG4gICAqIEBwYXJhbSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59IHZhbHVlIC0gU3RvcmVkIG9yZGVyLlxuICAgKiBAcmV0dXJucyB7bnVtYmVyfSAtIFBvc2l0aXZlIHNhZmUgaW50ZWdlciBvd25lcnNoaXAgb3JkZXIuXG4gICAqL1xuICBfdmFsaWRhdGVkU2NoZWR1bGVPcmRlcih2YWx1ZSkge1xuICAgIGNvbnN0IHNjaGVkdWxlT3JkZXIgPSB0aGlzLl9ub3JtYWxpemVOdW1iZXIodmFsdWUpXG5cbiAgICBpZiAoc2NoZWR1bGVPcmRlciA9PT0gbnVsbCB8fCAhTnVtYmVyLmlzU2FmZUludGVnZXIoc2NoZWR1bGVPcmRlcikgfHwgc2NoZWR1bGVPcmRlciA8IDEpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihgSW52YWxpZCBiYWNrZ3JvdW5kIGpvYiBzY2hlZHVsZSBvd25lcnNoaXAgb3JkZXI6ICR7c2NoZWR1bGVPcmRlcn1gKVxuICAgIH1cblxuICAgIHJldHVybiBzY2hlZHVsZU9yZGVyXG4gIH1cblxuICAvKipcbiAgICogQnVpbGRzIGEgc3RhYmxlLXNjaGVkdWxlIGxvb2t1cCBleGNsdXNpdmVseSBmcm9tIG5vcm1hbGl6ZWQgam9iIHJvd3MuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vZGF0YWJhc2UvZHJpdmVycy9iYXNlLmpzXCIpLmRlZmF1bHR9IGRiIC0gRGF0YWJhc2UgY29ubmVjdGlvbi5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBMb29rdXAgb3B0aW9ucy5cbiAgICogQHBhcmFtIHtib29sZWFufSBhcmdzLmluY2x1ZGVMYXRlc3RUZXJtaW5hbCAtIFdoZXRoZXIgdGVybWluYWwgaGlzdG9yeSBpcyByZXF1ZXN0ZWQuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBhcmdzLnNjaGVkdWxlS2V5IC0gVmFsaWRhdGVkIHN0YWJsZSBzY2hlZHVsZSBrZXkuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPGltcG9ydChcIi4vdHlwZXMuanNcIikuQmFja2dyb3VuZEpvYlNjaGVkdWxlZExvb2t1cFJlc3VsdD59IC0gTm9ybWFsaXplZCBwdWJsaWMgam9icy5cbiAgICovXG4gIGFzeW5jIF9zY2hlZHVsZWRKb2JMb29rdXAoZGIsIHtpbmNsdWRlTGF0ZXN0VGVybWluYWwsIHNjaGVkdWxlS2V5fSkge1xuICAgIGNvbnN0IG93bmVySm9iID0gYXdhaXQgdGhpcy5fc2NoZWR1bGVkT3duZXJKb2IoZGIsIHNjaGVkdWxlS2V5KVxuICAgIGNvbnN0IGN1cnJlbnRKb2IgPSBvd25lckpvYiAmJiAob3duZXJKb2Iuc3RhdHVzID09PSBcInF1ZXVlZFwiIHx8IG93bmVySm9iLnN0YXR1cyA9PT0gXCJoYW5kZWRfb2ZmXCIpID8gb3duZXJKb2IgOiBudWxsXG5cbiAgICBpZiAoIWluY2x1ZGVMYXRlc3RUZXJtaW5hbCkgcmV0dXJuIHtjdXJyZW50Sm9iLCBsYXRlc3RUZXJtaW5hbEpvYjogbnVsbH1cblxuICAgIGNvbnN0IHRlcm1pbmFsU3RhdHVzZXMgPSBCQUNLR1JPVU5EX0pPQl9URVJNSU5BTF9TVEFUVVNFUy5tYXAoKHN0YXR1cykgPT4gZGIucXVvdGUoc3RhdHVzKSkuam9pbihcIiwgXCIpXG4gICAgY29uc3QgdGVybWluYWxSb3dzID0gYXdhaXQgZGJcbiAgICAgIC5uZXdRdWVyeSgpXG4gICAgICAuZnJvbShKT0JTX1RBQkxFKVxuICAgICAgLndoZXJlKHtzY2hlZHVsZV9rZXk6IHNjaGVkdWxlS2V5fSlcbiAgICAgIC53aGVyZShgJHtkYi5xdW90ZUNvbHVtbihcInN0YXR1c1wiKX0gSU4gKCR7dGVybWluYWxTdGF0dXNlc30pYClcbiAgICAgIC5vcmRlcihgQ0FTRSBXSEVOICR7ZGIucXVvdGVDb2x1bW4oXCJzY2hlZHVsZV9vcmRlclwiKX0gSVMgTlVMTCBUSEVOIDAgRUxTRSAxIEVORCBERVNDYClcbiAgICAgIC5vcmRlcihcInNjaGVkdWxlX29yZGVyIERFU0NcIilcbiAgICAgIC5vcmRlcihcImNyZWF0ZWRfYXRfbXMgREVTQ1wiKVxuICAgICAgLm9yZGVyKFwiaWQgREVTQ1wiKVxuICAgICAgLmxpbWl0KDEpXG4gICAgICAucmVzdWx0cygpXG4gICAgY29uc3QgbGF0ZXN0VGVybWluYWxKb2IgPSB0ZXJtaW5hbFJvd3NbMF0gPyB0aGlzLl9ub3JtYWxpemVKb2JSb3codGVybWluYWxSb3dzWzBdKSA6IG51bGxcblxuICAgIHJldHVybiB7Y3VycmVudEpvYiwgbGF0ZXN0VGVybWluYWxKb2J9XG4gIH1cblxuICAvKipcbiAgICogUmVsZWFzZXMgb3duZXJzaGlwIG9ubHkgd2hlbiB0aGUga2V5IHN0aWxsIHBvaW50cyBhdCB0aGUgZXhwZWN0ZWQgam9iLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL2RhdGFiYXNlL2RyaXZlcnMvYmFzZS5qc1wiKS5kZWZhdWx0fSBkYiAtIERhdGFiYXNlIGNvbm5lY3Rpb24uXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gT3duZXJzaGlwIGlkZW50aXR5LlxuICAgKiBAcGFyYW0ge3N0cmluZ30gYXJncy5qb2JJZCAtIEV4cGVjdGVkIG93bmVyIGpvYiBpZC5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGFyZ3Muc2NoZWR1bGVLZXkgLSBTdGFibGUgc2NoZWR1bGUga2V5LlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyB3aGVuIGRlbGV0ZWQgb3IgYWxyZWFkeSBzdXBlcnNlZGVkLlxuICAgKi9cbiAgYXN5bmMgX3JlbGVhc2VTY2hlZHVsZU93bmVyc2hpcChkYiwge2pvYklkLCBzY2hlZHVsZUtleX0pIHtcbiAgICBhd2FpdCBkYi5kZWxldGUoe1xuICAgICAgdGFibGVOYW1lOiBTQ0hFRFVMRV9LRVlTX1RBQkxFLFxuICAgICAgY29uZGl0aW9uczoge2pvYl9pZDogam9iSWQsIHNjaGVkdWxlX2tleTogc2NoZWR1bGVLZXl9XG4gICAgfSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSZWxlYXNlcyBhIGpvYidzIG93bmVyc2hpcCB3aGVuIGl0IGhhcyBhIGhpc3RvcmljYWwgc2NoZWR1bGUga2V5LlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL2RhdGFiYXNlL2RyaXZlcnMvYmFzZS5qc1wiKS5kZWZhdWx0fSBkYiAtIERhdGFiYXNlIGNvbm5lY3Rpb24uXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi90eXBlcy5qc1wiKS5CYWNrZ3JvdW5kSm9iUm93fSBqb2IgLSBUZXJtaW5hbCBqb2IuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIHdoZW4gZGVsZXRlZCBvciBub3QgYXBwbGljYWJsZS5cbiAgICovXG4gIGFzeW5jIF9yZWxlYXNlU2NoZWR1bGVPd25lcnNoaXBGb3JKb2IoZGIsIGpvYikge1xuICAgIGlmICgham9iLnNjaGVkdWxlS2V5KSByZXR1cm5cblxuICAgIGF3YWl0IHRoaXMuX3JlbGVhc2VTY2hlZHVsZU93bmVyc2hpcChkYiwge2pvYklkOiBqb2IuaWQsIHNjaGVkdWxlS2V5OiBqb2Iuc2NoZWR1bGVLZXl9KVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgYXBwbHkgZmFpbHVyZS5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBPcHRpb25zLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL2RhdGFiYXNlL2RyaXZlcnMvYmFzZS5qc1wiKS5kZWZhdWx0fSBhcmdzLmRiIC0gRGF0YWJhc2UgY29ubmVjdGlvbi5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL3R5cGVzLmpzXCIpLkJhY2tncm91bmRKb2JSb3d9IGFyZ3Muam9iIC0gSm9iIHJvdy5cbiAgICogQHBhcmFtIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gYXJncy5lcnJvciAtIEVycm9yLlxuICAgKiBAcGFyYW0ge2Jvb2xlYW59IGFyZ3MubWFya09ycGhhbmVkIC0gV2hldGhlciBtYXJraW5nIG9ycGhhbmVkLlxuICAgKiBAcGFyYW0ge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gW2FyZ3MuY29uZGl0aW9uc10gLSBVcGRhdGUgZmVuY2luZyBjb25kaXRpb25zLiBEZWZhdWx0cyB0byB0aGUgYWN0aXZlLWhhbmRvZmYgbGVhc2UgbWF0Y2g7IHRoZSB0aW1lLWJhc2VkIG9ycGhhbiBzd2VlcCBvdmVycmlkZXMgdGhpcyB3aXRoIGFuIGlkL3N0YXR1cyBtYXRjaCBzbyBpdCBjYW4gcmVjbGFpbSByb3dzIHdob3NlIGBoYW5kb2ZmX2lkYCBpcyBudWxsIChlLmcuIGhhbmRlZCBvZmYgYnkgYW4gb2xkZXIgdmVsb2Npb3VzIGJlZm9yZSBoYW5kb2ZmLWlkIGZlbmNpbmcgZXhpc3RlZCkuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPGltcG9ydChcIi4vdHlwZXMuanNcIikuQmFja2dyb3VuZEpvYlJvdyB8IG51bGw+fSAtIFVwZGF0ZWQgam9iIHJvdyB3aGVuIHRoZSBsZWFzZSB0cmFuc2l0aW9uIHdvbi5cbiAgICovXG4gIGFzeW5jIF9hcHBseUZhaWx1cmUoe2RiLCBqb2IsIGVycm9yLCBtYXJrT3JwaGFuZWQsIGNvbmRpdGlvbnN9KSB7XG4gICAgY29uc3Qgbm93ID0gdGhpcy5jbG9jay5ub3coKVxuICAgIGNvbnN0IG5leHRBdHRlbXB0ID0gKGpvYi5hdHRlbXB0cyB8fCAwKSArIDFcbiAgICBjb25zdCBtYXhSZXRyaWVzID0gdGhpcy5fbm9ybWFsaXplTWF4UmV0cmllcyhqb2IubWF4UmV0cmllcylcbiAgICBjb25zdCBzaG91bGRSZXRyeSA9IG5leHRBdHRlbXB0IDw9IG1heFJldHJpZXNcbiAgICBjb25zdCBmYWlsdXJlTWVzc2FnZSA9IG5vcm1hbGl6ZUJhY2tncm91bmRKb2JFcnJvcihlcnJvcilcbiAgICBjb25zdCBzY2hlZHVsZWRBdCA9IHNob3VsZFJldHJ5ID8gbm93ICsgdGhpcy5nZXRSZXRyeURlbGF5TXMobmV4dEF0dGVtcHQpIDogam9iLnNjaGVkdWxlZEF0TXNcbiAgICBjb25zdCB1cGRhdGUgPSB0aGlzLl9mYWlsdXJlVXBkYXRlKHtcbiAgICAgIGZhaWx1cmVNZXNzYWdlLFxuICAgICAgbWFya09ycGhhbmVkLFxuICAgICAgbmV4dEF0dGVtcHQsXG4gICAgICBub3csXG4gICAgICBzY2hlZHVsZWRBdCxcbiAgICAgIHNob3VsZFJldHJ5XG4gICAgfSlcblxuICAgIGF3YWl0IHRoaXMuX2xvY2tDb25jdXJyZW5jeVJvdyhkYiwgam9iLmNvbmN1cnJlbmN5S2V5KVxuICAgIGNvbnN0IGFmZmVjdGVkUm93cyA9IGF3YWl0IHRoaXMuX3VwZGF0ZUFmZmVjdGVkUm93cyhkYiwge1xuICAgICAgdGFibGVOYW1lOiBKT0JTX1RBQkxFLFxuICAgICAgZGF0YTogdXBkYXRlLFxuICAgICAgY29uZGl0aW9uczogY29uZGl0aW9ucyA/PyB0aGlzLl9hY3RpdmVIYW5kb2ZmQ29uZGl0aW9ucyhqb2IpXG4gICAgfSlcblxuICAgIGlmIChhZmZlY3RlZFJvd3MgIT09IDEpIHJldHVybiBudWxsXG4gICAgaWYgKCFzaG91bGRSZXRyeSkgYXdhaXQgdGhpcy5fcmVsZWFzZVNjaGVkdWxlT3duZXJzaGlwRm9ySm9iKGRiLCBqb2IpXG4gICAgYXdhaXQgdGhpcy5fcmVsZWFzZUNvbmN1cnJlbmN5KGRiLCBqb2IuY29uY3VycmVuY3lLZXkpXG5cbiAgICAvLyBSZXR1cm4gYSBzbmFwc2hvdCBvZiB0aGUgdHJhbnNpdGlvbiB0aGlzIHVwZGF0ZSBqdXN0IGFwcGxpZWQgcmF0aGVyIHRoYW4gcmUtcmVhZGluZyB0aGUgcm93LlxuICAgIC8vIFdlIHdvbiB0aGUgY29uZGl0aW9uYWwgdXBkYXRlIChhZmZlY3RlZFJvd3MgPT09IDEpLCBzbyB0aGlzIHN0YXRlIGlzIGF1dGhvcml0YXRpdmU7IHJlLXJlYWRpbmdcbiAgICAvLyBjb3VsZCBpbnN0ZWFkIG9ic2VydmUgYSBuZXdlciBzdGF0ZSBpZiBhbm90aGVyIGRpc3BhdGNoZXIgcmVjbGFpbXMgYSByZXF1ZXVlZCBqb2IgYmV0d2VlbiB0aGVcbiAgICAvLyB1cGRhdGUgYW5kIHRoZSByZWFkIChvdmVybGFwcGluZyBtYWlucyAvIHBvbGxpbmcgZGlzcGF0Y2gpLCB3aGljaCB3b3VsZCBtaXNyZXBvcnQgdGhlXG4gICAgLy8gc3RhdHVzL3Rlcm1pbmFsL3dpbGxSZXRyeSBvZiB0aGlzIHRyYW5zaXRpb24gdG8gZmFpbHVyZS9vcnBoYW4gZXZlbnQgbGlzdGVuZXJzLlxuICAgIGNvbnN0IHN0YXR1cyA9IHNob3VsZFJldHJ5ID8gXCJxdWV1ZWRcIiA6IChtYXJrT3JwaGFuZWQgPyBcIm9ycGhhbmVkXCIgOiBcImZhaWxlZFwiKVxuICAgIC8qKiBAdHlwZSB7aW1wb3J0KFwiLi90eXBlcy5qc1wiKS5CYWNrZ3JvdW5kSm9iUm93fSAqL1xuICAgIGNvbnN0IHRyYW5zaXRpb25lZEpvYiA9IHtcbiAgICAgIC4uLmpvYixcbiAgICAgIC4uLihzaG91bGRSZXRyeSA/IHRoaXMuX2NsZWFyZWRDaGlsZEFjY2VwdGFuY2VSb3coKSA6IHt9KSxcbiAgICAgIGF0dGVtcHRzOiBuZXh0QXR0ZW1wdCxcbiAgICAgIGhhbmRlZE9mZkF0TXM6IG51bGwsXG4gICAgICBsYXN0RXJyb3I6IGZhaWx1cmVNZXNzYWdlLFxuICAgICAgc3RhdHVzLFxuICAgICAgd29ya2VySWQ6IG51bGxcbiAgICB9XG5cbiAgICBpZiAobWFya09ycGhhbmVkKSB0cmFuc2l0aW9uZWRKb2Iub3JwaGFuZWRBdE1zID0gbm93XG4gICAgaWYgKHNob3VsZFJldHJ5KSB7XG4gICAgICB0cmFuc2l0aW9uZWRKb2Iuc2NoZWR1bGVkQXRNcyA9IHNjaGVkdWxlZEF0XG4gICAgfSBlbHNlIGlmICghbWFya09ycGhhbmVkKSB7XG4gICAgICB0cmFuc2l0aW9uZWRKb2IuZmFpbGVkQXRNcyA9IG5vd1xuICAgIH1cblxuICAgIHJldHVybiB0cmFuc2l0aW9uZWRKb2JcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGZhaWx1cmUgdXBkYXRlLlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIE9wdGlvbnMuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBhcmdzLmZhaWx1cmVNZXNzYWdlIC0gTGFzdCBmYWlsdXJlIG1lc3NhZ2UuXG4gICAqIEBwYXJhbSB7Ym9vbGVhbn0gYXJncy5tYXJrT3JwaGFuZWQgLSBXaGV0aGVyIG1hcmtpbmcgb3JwaGFuZWQuXG4gICAqIEBwYXJhbSB7bnVtYmVyfSBhcmdzLm5leHRBdHRlbXB0IC0gTmV4dCBhdHRlbXB0IGNvdW50LlxuICAgKiBAcGFyYW0ge251bWJlcn0gYXJncy5ub3cgLSBDdXJyZW50IHRpbWVzdGFtcC5cbiAgICogQHBhcmFtIHtudW1iZXIgfCBudWxsfSBhcmdzLnNjaGVkdWxlZEF0IC0gTmV4dCBzY2hlZHVsZWQgdGltZXN0YW1wLlxuICAgKiBAcGFyYW0ge2Jvb2xlYW59IGFyZ3Muc2hvdWxkUmV0cnkgLSBXaGV0aGVyIHRoZSBqb2Igc2hvdWxkIHJldHJ5LlxuICAgKiBAcmV0dXJucyB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSAtIERhdGFiYXNlIHVwZGF0ZSBkYXRhLlxuICAgKi9cbiAgX2ZhaWx1cmVVcGRhdGUoe2ZhaWx1cmVNZXNzYWdlLCBtYXJrT3JwaGFuZWQsIG5leHRBdHRlbXB0LCBub3csIHNjaGVkdWxlZEF0LCBzaG91bGRSZXRyeX0pIHtcbiAgICAvKipcbiAgICAgKiBVcGRhdGUuXG4gICAgICogQHR5cGUge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gKi9cbiAgICBjb25zdCB1cGRhdGUgPSB7XG4gICAgICBhdHRlbXB0czogbmV4dEF0dGVtcHQsXG4gICAgICBoYW5kZWRfb2ZmX2F0X21zOiBudWxsLFxuICAgICAgd29ya2VyX2lkOiBudWxsLFxuICAgICAgbGFzdF9lcnJvcjogZmFpbHVyZU1lc3NhZ2VcbiAgICB9XG5cbiAgICAvLyBBIHJldHJ5IHN0YXJ0cyBhIGZyZXNoIGhhbmRvZmYgd2l0aCBhIHBvc3NpYmx5IGRpZmZlcmVudCBydW5uZXIsIHNvIHRoZVxuICAgIC8vIHByZXZpb3VzIGNoaWxkJ3MgYWNjZXB0YW5jZSBldmlkZW5jZSBtdXN0IG5vdCBsZWFrIGludG8gdGhlIG5leHQgYXR0ZW1wdC5cbiAgICAvLyBUZXJtaW5hbCBmYWlsdXJlcyBrZWVwIGl0IGFzIGhpc3RvcmljYWwgZXZpZGVuY2UgZm9yIHRoZSBsb3N0IGF0dGVtcHQuXG4gICAgaWYgKHNob3VsZFJldHJ5KSBPYmplY3QuYXNzaWduKHVwZGF0ZSwgdGhpcy5fY2xlYXJlZENoaWxkQWNjZXB0YW5jZURhdGEoKSlcblxuICAgIHRoaXMuX2FwcGx5T3JwaGFuZWRGYWlsdXJlVXBkYXRlKHttYXJrT3JwaGFuZWQsIG5vdywgdXBkYXRlfSlcbiAgICB0aGlzLl9hcHBseUZhaWx1cmVTdGF0dXNVcGRhdGUoe21hcmtPcnBoYW5lZCwgbm93LCBzY2hlZHVsZWRBdCwgc2hvdWxkUmV0cnksIHVwZGF0ZX0pXG5cbiAgICByZXR1cm4gdXBkYXRlXG4gIH1cblxuICAvKipcbiAgICogUnVucyBhcHBseSBvcnBoYW5lZCBmYWlsdXJlIHVwZGF0ZS5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBPcHRpb25zLlxuICAgKiBAcGFyYW0ge2Jvb2xlYW59IGFyZ3MubWFya09ycGhhbmVkIC0gV2hldGhlciBtYXJraW5nIG9ycGhhbmVkLlxuICAgKiBAcGFyYW0ge251bWJlcn0gYXJncy5ub3cgLSBDdXJyZW50IHRpbWVzdGFtcC5cbiAgICogQHBhcmFtIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59IGFyZ3MudXBkYXRlIC0gRGF0YWJhc2UgdXBkYXRlIGRhdGEuXG4gICAqIEByZXR1cm5zIHt2b2lkfVxuICAgKi9cbiAgX2FwcGx5T3JwaGFuZWRGYWlsdXJlVXBkYXRlKHttYXJrT3JwaGFuZWQsIG5vdywgdXBkYXRlfSkge1xuICAgIGlmIChtYXJrT3JwaGFuZWQpIHVwZGF0ZS5vcnBoYW5lZF9hdF9tcyA9IG5vd1xuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgYXBwbHkgZmFpbHVyZSBzdGF0dXMgdXBkYXRlLlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIE9wdGlvbnMuXG4gICAqIEBwYXJhbSB7Ym9vbGVhbn0gYXJncy5tYXJrT3JwaGFuZWQgLSBXaGV0aGVyIG1hcmtpbmcgb3JwaGFuZWQuXG4gICAqIEBwYXJhbSB7bnVtYmVyfSBhcmdzLm5vdyAtIEN1cnJlbnQgdGltZXN0YW1wLlxuICAgKiBAcGFyYW0ge251bWJlciB8IG51bGx9IGFyZ3Muc2NoZWR1bGVkQXQgLSBOZXh0IHNjaGVkdWxlZCB0aW1lc3RhbXAuXG4gICAqIEBwYXJhbSB7Ym9vbGVhbn0gYXJncy5zaG91bGRSZXRyeSAtIFdoZXRoZXIgdGhlIGpvYiBzaG91bGQgcmV0cnkuXG4gICAqIEBwYXJhbSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSBhcmdzLnVwZGF0ZSAtIERhdGFiYXNlIHVwZGF0ZSBkYXRhLlxuICAgKiBAcmV0dXJucyB7dm9pZH1cbiAgICovXG4gIF9hcHBseUZhaWx1cmVTdGF0dXNVcGRhdGUoe21hcmtPcnBoYW5lZCwgbm93LCBzY2hlZHVsZWRBdCwgc2hvdWxkUmV0cnksIHVwZGF0ZX0pIHtcbiAgICBpZiAoc2hvdWxkUmV0cnkpIHtcbiAgICAgIHVwZGF0ZS5zdGF0dXMgPSBcInF1ZXVlZFwiXG4gICAgICB1cGRhdGUuc2NoZWR1bGVkX2F0X21zID0gc2NoZWR1bGVkQXRcbiAgICAgIHJldHVyblxuICAgIH1cblxuICAgIGlmIChtYXJrT3JwaGFuZWQpIHtcbiAgICAgIHVwZGF0ZS5zdGF0dXMgPSBcIm9ycGhhbmVkXCJcbiAgICAgIHJldHVyblxuICAgIH1cblxuICAgIHVwZGF0ZS5zdGF0dXMgPSBcImZhaWxlZFwiXG4gICAgdXBkYXRlLmZhaWxlZF9hdF9tcyA9IG5vd1xuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgbm9ybWFsaXplIGpvYiByb3cuXG4gICAqIEBwYXJhbSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSByb3cgLSBSYXcgZGF0YWJhc2Ugcm93LlxuICAgKiBAcmV0dXJucyB7aW1wb3J0KFwiLi90eXBlcy5qc1wiKS5CYWNrZ3JvdW5kSm9iUm93fSAtIE5vcm1hbGl6ZWQgam9iIHJvdy5cbiAgICovXG4gIF9ub3JtYWxpemVKb2JSb3cocm93KSB7XG4gICAgY29uc3QgaGFuZG9mZklkID0gcm93LmhhbmRvZmZfaWQgPyBTdHJpbmcocm93LmhhbmRvZmZfaWQpIDogbnVsbFxuICAgIC8vIGBleGVjdXRpb25fbW9kZWAgaXMgdGhlIHNpbmdsZSBzb3VyY2Ugb2YgdHJ1dGggZm9yIGEgam9iJ3MgcnVudGltZSBhbmQgaXNcbiAgICAvLyB3cml0dGVuIG9uIGV2ZXJ5IGVucXVldWU7IHRoZSBkcm9wLWZvcmtlZCBtaWdyYXRpb24gYmFja2ZpbGxzIGFueSBwcmUtZXhpc3RpbmdcbiAgICAvLyByb3dzIGJlZm9yZSB0aGUgbGVnYWN5IGBmb3JrZWRgIGNvbHVtbiBpcyByZW1vdmVkLlxuICAgIGNvbnN0IGV4ZWN1dGlvbk1vZGUgPSByb3cuZXhlY3V0aW9uX21vZGUgPyB0aGlzLl9ub3JtYWxpemVFeGVjdXRpb25Nb2RlTmFtZShTdHJpbmcocm93LmV4ZWN1dGlvbl9tb2RlKSkgOiBERUZBVUxUX0JBQ0tHUk9VTkRfSk9CX0VYRUNVVElPTl9NT0RFXG5cbiAgICByZXR1cm4ge1xuICAgICAgaWQ6IFN0cmluZyhyb3cuaWQpLFxuICAgICAgam9iTmFtZTogU3RyaW5nKHJvdy5qb2JfbmFtZSksXG4gICAgICBhcmdzOiB0aGlzLl9wYXJzZUFyZ3Mocm93LmFyZ3NfanNvbiksXG4gICAgICBleGVjdXRpb25Nb2RlLFxuICAgICAgcXVldWU6IHJvdy5xdWV1ZSA/IFN0cmluZyhyb3cucXVldWUpIDogREVGQVVMVF9CQUNLR1JPVU5EX0pPQl9RVUVVRSxcbiAgICAgIHNjaGVkdWxlS2V5OiByb3cuc2NoZWR1bGVfa2V5ID8gU3RyaW5nKHJvdy5zY2hlZHVsZV9rZXkpIDogbnVsbCxcbiAgICAgIHNjaGVkdWxlT3JkZXI6IHRoaXMuX25vcm1hbGl6ZU51bWJlcihyb3cuc2NoZWR1bGVfb3JkZXIpLFxuICAgICAgc3RhdHVzOiBub3JtYWxpemVCYWNrZ3JvdW5kSm9iU3RhdHVzKHJvdy5zdGF0dXMgPyBTdHJpbmcocm93LnN0YXR1cykgOiBcInF1ZXVlZFwiKSxcbiAgICAgIGF0dGVtcHRzOiB0aGlzLl9ub3JtYWxpemVOdW1iZXIocm93LmF0dGVtcHRzKSxcbiAgICAgIG1heFJldHJpZXM6IHRoaXMuX25vcm1hbGl6ZU51bWJlcihyb3cubWF4X3JldHJpZXMpLFxuICAgICAgc2NoZWR1bGVkQXRNczogdGhpcy5fbm9ybWFsaXplTnVtYmVyKHJvdy5zY2hlZHVsZWRfYXRfbXMpLFxuICAgICAgY3JlYXRlZEF0TXM6IHRoaXMuX25vcm1hbGl6ZU51bWJlcihyb3cuY3JlYXRlZF9hdF9tcyksXG4gICAgICBoYW5kZWRPZmZBdE1zOiB0aGlzLl9ub3JtYWxpemVOdW1iZXIocm93LmhhbmRlZF9vZmZfYXRfbXMpLFxuICAgICAgaGFuZG9mZklkLFxuICAgICAgY29tcGxldGVkQXRNczogdGhpcy5fbm9ybWFsaXplTnVtYmVyKHJvdy5jb21wbGV0ZWRfYXRfbXMpLFxuICAgICAgZmFpbGVkQXRNczogdGhpcy5fbm9ybWFsaXplTnVtYmVyKHJvdy5mYWlsZWRfYXRfbXMpLFxuICAgICAgb3JwaGFuZWRBdE1zOiB0aGlzLl9ub3JtYWxpemVOdW1iZXIocm93Lm9ycGhhbmVkX2F0X21zKSxcbiAgICAgIHdvcmtlcklkOiByb3cud29ya2VyX2lkID8gU3RyaW5nKHJvdy53b3JrZXJfaWQpIDogbnVsbCxcbiAgICAgIGxhc3RFcnJvcjogcm93Lmxhc3RfZXJyb3IgPyBTdHJpbmcocm93Lmxhc3RfZXJyb3IpIDogbnVsbCxcbiAgICAgIGNvbmN1cnJlbmN5S2V5OiByb3cuY29uY3VycmVuY3lfa2V5ID8gU3RyaW5nKHJvdy5jb25jdXJyZW5jeV9rZXkpIDogbnVsbCxcbiAgICAgIG1heENvbmN1cnJlbmN5OiB0aGlzLl9ub3JtYWxpemVOdW1iZXIocm93Lm1heF9jb25jdXJyZW5jeSksXG4gICAgICB0aW1lb3V0TXM6IHRoaXMuX25vcm1hbGl6ZU51bWJlcihyb3cudGltZW91dF9tcyksXG4gICAgICBjaGlsZFJlY2VpdmVkQXRNczogdGhpcy5fbm9ybWFsaXplTnVtYmVyKHJvdy5jaGlsZF9yZWNlaXZlZF9hdF9tcyksXG4gICAgICBjaGlsZFN0YXJ0ZWRBdE1zOiB0aGlzLl9ub3JtYWxpemVOdW1iZXIocm93LmNoaWxkX3N0YXJ0ZWRfYXRfbXMpLFxuICAgICAgY2hpbGRJbnN0YW5jZUlkOiByb3cuY2hpbGRfaW5zdGFuY2VfaWQgPyBTdHJpbmcocm93LmNoaWxkX2luc3RhbmNlX2lkKSA6IG51bGwsXG4gICAgICBjaGlsZFBpZDogdGhpcy5fbm9ybWFsaXplTnVtYmVyKHJvdy5jaGlsZF9waWQpLFxuICAgICAgcnVubmVySG9zdG5hbWU6IHJvdy5ydW5uZXJfaG9zdG5hbWUgPyBTdHJpbmcocm93LnJ1bm5lcl9ob3N0bmFtZSkgOiBudWxsXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIE5vcm1hbGl6ZXMgYSBqb2IncyBxdWV1ZSBuYW1lLCBkZWZhdWx0aW5nIHRvIFwiZGVmYXVsdFwiLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vdHlwZXMuanNcIikuQmFja2dyb3VuZEpvYk9wdGlvbnMgfCB1bmRlZmluZWR9IG9wdGlvbnMgLSBKb2Igb3B0aW9ucy5cbiAgICogQHJldHVybnMge3N0cmluZ30gLSBRdWV1ZSBuYW1lLlxuICAgKi9cbiAgX25vcm1hbGl6ZVF1ZXVlKG9wdGlvbnMpIHtcbiAgICByZXR1cm4gbm9ybWFsaXplQmFja2dyb3VuZEpvYlF1ZXVlKG9wdGlvbnMpXG4gIH1cblxuICAvKipcbiAgICogUmVzb2x2ZXMgYSBqb2IncyBkdXJhYmxlIGNvbmN1cnJlbmN5LiBBbiBleHBsaWNpdCBjb25jdXJyZW5jeUtleS9tYXhDb25jdXJyZW5jeVxuICAgKiBwYWlyIGFsd2F5cyB3aW5zLiBPdGhlcndpc2UsIHdoZW4gdGhlIGpvYidzIHF1ZXVlIGhhcyBhIGNvbmZpZ3VyZWQgY2FwXG4gICAqIChgYmFja2dyb3VuZEpvYnMucXVldWVzW3F1ZXVlXS5tYXhDb25jdXJyZW50YCksIGRlcml2ZSBhIHF1ZXVlLXNjb3BlZFxuICAgKiBjb25jdXJyZW5jeSBrZXkgc28gdGhlIHF1ZXVlIGNhcCBpcyBlbmZvcmNlZCBjbHVzdGVyLXdpZGUgdGhyb3VnaCB0aGVcbiAgICogZXhpc3RpbmcgZHVyYWJsZSBjb25jdXJyZW5jeSBtZWNoYW5pc20uXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi90eXBlcy5qc1wiKS5CYWNrZ3JvdW5kSm9iT3B0aW9ucyB8IHVuZGVmaW5lZH0gb3B0aW9ucyAtIEpvYiBvcHRpb25zLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gcXVldWUgLSBOb3JtYWxpemVkIHF1ZXVlIG5hbWUuXG4gICAqIEByZXR1cm5zIHt7Y29uY3VycmVuY3lLZXk6IHN0cmluZywgbWF4Q29uY3VycmVuY3k6IG51bWJlciwgcXVldWVEZXJpdmVkOiBib29sZWFufSB8IG51bGx9IC0gUmVzb2x2ZWQgY29uY3VycmVuY3kuXG4gICAqL1xuICBfcmVzb2x2ZUNvbmN1cnJlbmN5KG9wdGlvbnMsIHF1ZXVlKSB7XG4gICAgcmV0dXJuIG5vcm1hbGl6ZUJhY2tncm91bmRKb2JDb25jdXJyZW5jeSh7XG4gICAgICBvcHRpb25zOiBvcHRpb25zIHx8IHt9LFxuICAgICAgcXVldWUsXG4gICAgICBxdWV1ZXM6IHRoaXMuY29uZmlndXJhdGlvbi5nZXRCYWNrZ3JvdW5kSm9ic0NvbmZpZygpLnF1ZXVlc1xuICAgIH0pXG4gIH1cblxuICAvKipcbiAgICogQXBwbGllcyB0aGUgYWN0aXZlIGdlbmVyYXRpb24ncyBxdWV1ZSBwb2xpY3kgaW1tZWRpYXRlbHkgYmVmb3JlIGhhbmRvZmYuXG4gICAqIEV4cGxpY2l0IGNvbmN1cnJlbmN5IHJlbWFpbnMgb3duZWQgYnkgdGhlIGVucXVldWUgcmVxdWVzdC5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9kYXRhYmFzZS9kcml2ZXJzL2Jhc2UuanNcIikuZGVmYXVsdH0gZGIgLSBEYXRhYmFzZSBjb25uZWN0aW9uLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vdHlwZXMuanNcIikuQmFja2dyb3VuZEpvYlJvd30gam9iIC0gUXVldWVkIGpvYiBzbmFwc2hvdC5cbiAgICogQHJldHVybnMge1Byb21pc2U8aW1wb3J0KFwiLi90eXBlcy5qc1wiKS5CYWNrZ3JvdW5kSm9iUm93IHwgbnVsbD59IC0gUmVjb25jaWxlZCBqb2IsIG9yIG51bGwgd2hlbiBpdHMgcXVldWVkLXN0YXRlIGZlbmNlIGxvc3QuXG4gICAqL1xuICBhc3luYyBfcmVjb25jaWxlUXVldWVkSm9iQ29uY3VycmVuY3koZGIsIGpvYikge1xuICAgIGlmIChqb2IuY29uY3VycmVuY3lLZXkgJiYgIWpvYi5jb25jdXJyZW5jeUtleS5zdGFydHNXaXRoKFFVRVVFX0NPTkNVUlJFTkNZX0tFWV9QUkVGSVgpKSB7XG4gICAgICByZXR1cm4gam9iXG4gICAgfVxuXG4gICAgY29uc3QgY29uY3VycmVuY3kgPSB0aGlzLl9yZXNvbHZlQ29uY3VycmVuY3koe30sIGpvYi5xdWV1ZSlcbiAgICAvKiogQHR5cGUge0JhY2tncm91bmRKb2JRdWV1ZWRDb25jdXJyZW5jeX0gKi9cbiAgICBjb25zdCBjdXJyZW50ID0gY29uY3VycmVuY3lcbiAgICAgID8ge2NvbmN1cnJlbmN5S2V5OiBjb25jdXJyZW5jeS5jb25jdXJyZW5jeUtleSwgbWF4Q29uY3VycmVuY3k6IGNvbmN1cnJlbmN5Lm1heENvbmN1cnJlbmN5fVxuICAgICAgOiB7Y29uY3VycmVuY3lLZXk6IG51bGwsIG1heENvbmN1cnJlbmN5OiBudWxsfVxuXG4gICAgaWYgKGNvbmN1cnJlbmN5KSBhd2FpdCB0aGlzLl9lbnN1cmVRdWV1ZUNvbmN1cnJlbmN5S2V5KGRiLCBjb25jdXJyZW5jeSlcbiAgICBpZiAoam9iLmNvbmN1cnJlbmN5S2V5ID09PSBjdXJyZW50LmNvbmN1cnJlbmN5S2V5ICYmIGpvYi5tYXhDb25jdXJyZW5jeSA9PT0gY3VycmVudC5tYXhDb25jdXJyZW5jeSkgcmV0dXJuIGpvYlxuXG4gICAgY29uc3QgYWZmZWN0ZWRSb3dzID0gYXdhaXQgdGhpcy5fdXBkYXRlQWZmZWN0ZWRSb3dzKGRiLCB7XG4gICAgICB0YWJsZU5hbWU6IEpPQlNfVEFCTEUsXG4gICAgICBkYXRhOiB7XG4gICAgICAgIGNvbmN1cnJlbmN5X2tleTogY3VycmVudC5jb25jdXJyZW5jeUtleSxcbiAgICAgICAgbWF4X2NvbmN1cnJlbmN5OiBjdXJyZW50Lm1heENvbmN1cnJlbmN5XG4gICAgICB9LFxuICAgICAgY29uZGl0aW9uczoge2NvbmN1cnJlbmN5X2tleTogam9iLmNvbmN1cnJlbmN5S2V5LCBpZDogam9iLmlkLCBzdGF0dXM6IFwicXVldWVkXCJ9XG4gICAgfSlcblxuICAgIGlmIChhZmZlY3RlZFJvd3MgIT09IDEpIHJldHVybiBudWxsXG5cbiAgICByZXR1cm4gey4uLmpvYiwgY29uY3VycmVuY3lLZXk6IGN1cnJlbnQuY29uY3VycmVuY3lLZXksIG1heENvbmN1cnJlbmN5OiBjdXJyZW50Lm1heENvbmN1cnJlbmN5fVxuICB9XG5cbiAgLyoqXG4gICAqIFJlYWRzIHRoZSBjb25maWd1cmVkIG1heCBjb25jdXJyZW5jeSBmb3IgYSBxdWV1ZSBmcm9tIHRoZSBiYWNrZ3JvdW5kLWpvYnMgY29uZmlnLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gcXVldWUgLSBRdWV1ZSBuYW1lLlxuICAgKiBAcmV0dXJucyB7bnVtYmVyIHwgbnVsbH0gLSBQb3NpdGl2ZSBpbnRlZ2VyIGNhcCwgb3IgbnVsbCB3aGVuIHRoZSBxdWV1ZSBoYXMgbm8gY29uZmlndXJlZCBjYXAuXG4gICAqL1xuICBfcXVldWVNYXhDb25jdXJyZW5jeShxdWV1ZSkge1xuICAgIGNvbnN0IHF1ZXVlcyA9IHRoaXMuY29uZmlndXJhdGlvbi5nZXRCYWNrZ3JvdW5kSm9ic0NvbmZpZygpLnF1ZXVlc1xuICAgIGNvbnN0IGNhcCA9IHF1ZXVlcz8uW3F1ZXVlXT8ubWF4Q29uY3VycmVudFxuXG4gICAgaWYgKE51bWJlci5pc0ludGVnZXIoY2FwKSAmJiBOdW1iZXIoY2FwKSA+IDApIHJldHVybiBOdW1iZXIoY2FwKVxuXG4gICAgcmV0dXJuIG51bGxcbiAgfVxuXG4gIC8qKlxuICAgKiBMaWtlIHtAbGluayBfZW5zdXJlQ29uY3VycmVuY3lLZXl9LCBidXQgZm9yIHF1ZXVlLWRlcml2ZWQga2V5cyB0aGUgY29uZmlndXJlZFxuICAgKiBxdWV1ZSBjYXAgaXMgdGhlIHNvdXJjZSBvZiB0cnV0aDogaWYgaXQgY2hhbmdlZCwgdXBkYXRlIHRoZSBzdG9yZWQgY2FwXG4gICAqIGluc3RlYWQgb2YgdGhyb3dpbmcgb24gY29uZmxpY3QgKGNvbmZpZy1kcml2ZW4gY2FwcyBtdXN0IGJlIHR1bmFibGUpLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL2RhdGFiYXNlL2RyaXZlcnMvYmFzZS5qc1wiKS5kZWZhdWx0fSBkYiAtIERhdGFiYXNlIGNvbm5lY3Rpb24uXG4gICAqIEBwYXJhbSB7e2NvbmN1cnJlbmN5S2V5OiBzdHJpbmcsIG1heENvbmN1cnJlbmN5OiBudW1iZXJ9fSBjb25jdXJyZW5jeSAtIENvbmN1cnJlbmN5IGNvbmZpZ3VyYXRpb24uXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIHdoZW4gZW5zdXJlZC5cbiAgICovXG4gIGFzeW5jIF9lbnN1cmVRdWV1ZUNvbmN1cnJlbmN5S2V5KGRiLCB7Y29uY3VycmVuY3lLZXksIG1heENvbmN1cnJlbmN5fSkge1xuICAgIGNvbnN0IHJvd3MgPSBhd2FpdCBkYi5uZXdRdWVyeSgpLmZyb20oQ09OQ1VSUkVOQ1lfVEFCTEUpLndoZXJlKHtjb25jdXJyZW5jeV9rZXk6IGNvbmN1cnJlbmN5S2V5fSkubGltaXQoMSkucmVzdWx0cygpXG5cbiAgICBpZiAoIXJvd3NbMF0pIHtcbiAgICAgIHRyeSB7XG4gICAgICAgIGF3YWl0IGRiLmluc2VydCh7dGFibGVOYW1lOiBDT05DVVJSRU5DWV9UQUJMRSwgZGF0YToge2FjdGl2ZV9jb3VudDogMCwgY29uY3VycmVuY3lfa2V5OiBjb25jdXJyZW5jeUtleSwgbWF4X2NvbmN1cnJlbmN5OiBtYXhDb25jdXJyZW5jeX19KVxuXG4gICAgICAgIHJldHVyblxuICAgICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgICAgY29uc3QgcmFjZWRSb3dzID0gYXdhaXQgZGIubmV3UXVlcnkoKS5mcm9tKENPTkNVUlJFTkNZX1RBQkxFKS53aGVyZSh7Y29uY3VycmVuY3lfa2V5OiBjb25jdXJyZW5jeUtleX0pLmxpbWl0KDEpLnJlc3VsdHMoKVxuXG4gICAgICAgIGlmICghcmFjZWRSb3dzWzBdKSB0aHJvdyBlcnJvclxuXG4gICAgICAgIHJvd3NbMF0gPSByYWNlZFJvd3NbMF1cbiAgICAgIH1cbiAgICB9XG5cbiAgICBjb25zdCBjb25maWd1cmVkID0gLyoqIEB0eXBlIHt7bWF4X2NvbmN1cnJlbmN5PzogbnVtYmVyIHwgc3RyaW5nfX0gKi8gKHJvd3NbMF0pXG5cbiAgICBpZiAodGhpcy5fbm9ybWFsaXplTnVtYmVyKGNvbmZpZ3VyZWQubWF4X2NvbmN1cnJlbmN5KSAhPT0gbWF4Q29uY3VycmVuY3kpIHtcbiAgICAgIGNvbnN0IHRhYmxlID0gZGIucXVvdGVUYWJsZShDT05DVVJSRU5DWV9UQUJMRSlcblxuICAgICAgYXdhaXQgZGIucXVlcnkoYFVQREFURSAke3RhYmxlfSBTRVQgJHtkYi5xdW90ZUNvbHVtbihcIm1heF9jb25jdXJyZW5jeVwiKX0gPSAke051bWJlcihtYXhDb25jdXJyZW5jeSl9IFdIRVJFICR7ZGIucXVvdGVDb2x1bW4oXCJjb25jdXJyZW5jeV9rZXlcIil9ID0gJHtkYi5xdW90ZShjb25jdXJyZW5jeUtleSl9YClcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogRW5zdXJlcyB0aGUgY29uY3VycmVuY3kgc3RhdGUgdGFibGUgZXhpc3RzLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL2RhdGFiYXNlL2RyaXZlcnMvYmFzZS5qc1wiKS5kZWZhdWx0fSBkYiAtIERhdGFiYXNlIGNvbm5lY3Rpb24uXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIHdoZW4gcmVhZHkuXG4gICAqL1xuICBhc3luYyBfZW5zdXJlQ29uY3VycmVuY3lUYWJsZShkYikge1xuICAgIGlmIChhd2FpdCBkYi50YWJsZUV4aXN0cyhDT05DVVJSRU5DWV9UQUJMRSkpIHJldHVyblxuICAgIGNvbnN0IHRhYmxlID0gbmV3IFRhYmxlRGF0YShDT05DVVJSRU5DWV9UQUJMRSwge2lmTm90RXhpc3RzOiB0cnVlfSlcbiAgICB0YWJsZS5zdHJpbmcoXCJjb25jdXJyZW5jeV9rZXlcIiwge3ByaW1hcnlLZXk6IHRydWV9KVxuICAgIHRhYmxlLmludGVnZXIoXCJtYXhfY29uY3VycmVuY3lcIiwge251bGw6IGZhbHNlfSlcbiAgICB0YWJsZS5pbnRlZ2VyKFwiYWN0aXZlX2NvdW50XCIsIHtudWxsOiBmYWxzZX0pXG4gICAgYXdhaXQgZGIuY3JlYXRlVGFibGUodGFibGUpXG4gIH1cblxuICAvKipcbiAgICogRW5zdXJlcyB0aGUgc3RhYmxlIHNjaGVkdWxlLWtleSBvd25lcnNoaXAgdGFibGUgZXhpc3RzLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL2RhdGFiYXNlL2RyaXZlcnMvYmFzZS5qc1wiKS5kZWZhdWx0fSBkYiAtIERhdGFiYXNlIGNvbm5lY3Rpb24uXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIHdoZW4gcmVhZHkuXG4gICAqL1xuICBhc3luYyBfZW5zdXJlU2NoZWR1bGVLZXlzVGFibGUoZGIpIHtcbiAgICBpZiAoYXdhaXQgZGIudGFibGVFeGlzdHMoU0NIRURVTEVfS0VZU19UQUJMRSkpIHJldHVyblxuXG4gICAgY29uc3QgbG9ja05hbWUgPSBgJHtNSUdSQVRJT05fU0NPUEV9OnNjaGVkdWxlX2tleXNfdGFibGVgXG4gICAgY29uc3QgYWNxdWlyZWQgPSBhd2FpdCBkYi5hY3F1aXJlQWR2aXNvcnlMb2NrKGxvY2tOYW1lKVxuXG4gICAgaWYgKCFhY3F1aXJlZCkgdGhyb3cgbmV3IEVycm9yKFwiRmFpbGVkIHRvIGFjcXVpcmUgYmFja2dyb3VuZCBqb2JzIHNjaGVkdWxlLWtleSB0YWJsZSBzY2hlbWEgbG9ja1wiKVxuXG4gICAgdHJ5IHtcbiAgICAgIGRiLmNsZWFyU2NoZW1hQ2FjaGUoKVxuICAgICAgaWYgKGF3YWl0IGRiLnRhYmxlRXhpc3RzKFNDSEVEVUxFX0tFWVNfVEFCTEUpKSByZXR1cm5cblxuICAgICAgY29uc3QgdGFibGUgPSBuZXcgVGFibGVEYXRhKFNDSEVEVUxFX0tFWVNfVEFCTEUsIHtpZk5vdEV4aXN0czogdHJ1ZX0pXG5cbiAgICAgIHRhYmxlLnN0cmluZyhcInNjaGVkdWxlX2tleVwiLCB7cHJpbWFyeUtleTogdHJ1ZX0pXG4gICAgICB0YWJsZS5zdHJpbmcoXCJqb2JfaWRcIiwge251bGw6IGZhbHNlLCBpbmRleDogdHJ1ZX0pXG4gICAgICBhd2FpdCBkYi5jcmVhdGVUYWJsZSh0YWJsZSlcbiAgICAgIGRiLmNsZWFyU2NoZW1hQ2FjaGUoKVxuICAgIH0gZmluYWxseSB7XG4gICAgICBhd2FpdCBkYi5yZWxlYXNlQWR2aXNvcnlMb2NrKGxvY2tOYW1lKVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBFbnN1cmVzIGR1cmFibGUgZ2VuZXJpYyBlbnF1ZXVlIG93bmVyc2hpcCBleGlzdHMgaW5kZXBlbmRlbnRseSBvZiBqb2Igcm93cy5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9kYXRhYmFzZS9kcml2ZXJzL2Jhc2UuanNcIikuZGVmYXVsdH0gZGIgLSBEYXRhYmFzZSBjb25uZWN0aW9uLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyB3aGVuIHJlYWR5LlxuICAgKi9cbiAgYXN5bmMgX2Vuc3VyZUlkZW1wb3RlbmN5S2V5c1RhYmxlKGRiKSB7XG4gICAgaWYgKGF3YWl0IGRiLnRhYmxlRXhpc3RzKElERU1QT1RFTkNZX0tFWVNfVEFCTEUpKSByZXR1cm5cblxuICAgIGNvbnN0IGxvY2tOYW1lID0gYCR7TUlHUkFUSU9OX1NDT1BFfTppZGVtcG90ZW5jeV9rZXlzX3RhYmxlYFxuICAgIGNvbnN0IGFjcXVpcmVkID0gYXdhaXQgZGIuYWNxdWlyZUFkdmlzb3J5TG9jayhsb2NrTmFtZSlcblxuICAgIGlmICghYWNxdWlyZWQpIHRocm93IG5ldyBFcnJvcihcIkZhaWxlZCB0byBhY3F1aXJlIGJhY2tncm91bmQgam9iIGlkZW1wb3RlbmN5LWtleSB0YWJsZSBzY2hlbWEgbG9ja1wiKVxuXG4gICAgdHJ5IHtcbiAgICAgIGRiLmNsZWFyU2NoZW1hQ2FjaGUoKVxuICAgICAgaWYgKGF3YWl0IGRiLnRhYmxlRXhpc3RzKElERU1QT1RFTkNZX0tFWVNfVEFCTEUpKSByZXR1cm5cblxuICAgICAgY29uc3QgdGFibGUgPSBuZXcgVGFibGVEYXRhKElERU1QT1RFTkNZX0tFWVNfVEFCTEUsIHtpZk5vdEV4aXN0czogdHJ1ZX0pXG5cbiAgICAgIHRhYmxlLnN0cmluZyhcInNjb3BlX2RpZ2VzdFwiLCB7cHJpbWFyeUtleTogdHJ1ZX0pXG4gICAgICB0YWJsZS5zdHJpbmcoXCJqb2JfbmFtZVwiLCB7bnVsbDogZmFsc2V9KVxuICAgICAgdGFibGUuc3RyaW5nKFwicXVldWVcIiwge251bGw6IGZhbHNlfSlcbiAgICAgIHRhYmxlLnRleHQoXCJpZGVtcG90ZW5jeV9rZXlcIiwge251bGw6IGZhbHNlfSlcbiAgICAgIHRhYmxlLnN0cmluZyhcImpvYl9pZFwiLCB7aW5kZXg6IHRydWUsIG51bGw6IGZhbHNlfSlcbiAgICAgIHRhYmxlLnN0cmluZyhcInJlcXVlc3RfZGlnZXN0XCIsIHtudWxsOiBmYWxzZX0pXG4gICAgICB0YWJsZS5iaWdpbnQoXCJjcmVhdGVkX2F0X21zXCIsIHtudWxsOiBmYWxzZX0pXG4gICAgICBhd2FpdCBkYi5jcmVhdGVUYWJsZSh0YWJsZSlcbiAgICAgIGRiLmNsZWFyU2NoZW1hQ2FjaGUoKVxuICAgIH0gZmluYWxseSB7XG4gICAgICBhd2FpdCBkYi5yZWxlYXNlQWR2aXNvcnlMb2NrKGxvY2tOYW1lKVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBFbnN1cmVzIGR1cmFibGUgcHJvdmlkZXItYmFja2VkIG1haWwgb3BlcmF0aW9uIHN0YXRlIGV4aXN0cyBpbmRlcGVuZGVudGx5IG9mIGpvYnMuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vZGF0YWJhc2UvZHJpdmVycy9iYXNlLmpzXCIpLmRlZmF1bHR9IGRiIC0gRGF0YWJhc2UgY29ubmVjdGlvbi5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgd2hlbiByZWFkeS5cbiAgICovXG4gIGFzeW5jIF9lbnN1cmVNYWlsRGVsaXZlcnlPcGVyYXRpb25zVGFibGUoZGIpIHtcbiAgICBpZiAoYXdhaXQgZGIudGFibGVFeGlzdHMoTUFJTF9ERUxJVkVSWV9PUEVSQVRJT05TX1RBQkxFKSkgcmV0dXJuXG5cbiAgICBjb25zdCBsb2NrTmFtZSA9IGAke01JR1JBVElPTl9TQ09QRX06bWFpbF9kZWxpdmVyeV9vcGVyYXRpb25zX3RhYmxlYFxuICAgIGNvbnN0IGFjcXVpcmVkID0gYXdhaXQgZGIuYWNxdWlyZUFkdmlzb3J5TG9jayhsb2NrTmFtZSlcblxuICAgIGlmICghYWNxdWlyZWQpIHRocm93IG5ldyBFcnJvcihcIkZhaWxlZCB0byBhY3F1aXJlIG1haWwgZGVsaXZlcnkgb3BlcmF0aW9uIHRhYmxlIHNjaGVtYSBsb2NrXCIpXG5cbiAgICB0cnkge1xuICAgICAgZGIuY2xlYXJTY2hlbWFDYWNoZSgpXG4gICAgICBpZiAoYXdhaXQgZGIudGFibGVFeGlzdHMoTUFJTF9ERUxJVkVSWV9PUEVSQVRJT05TX1RBQkxFKSkgcmV0dXJuXG5cbiAgICAgIGNvbnN0IHRhYmxlID0gbmV3IFRhYmxlRGF0YShNQUlMX0RFTElWRVJZX09QRVJBVElPTlNfVEFCTEUsIHtpZk5vdEV4aXN0czogdHJ1ZX0pXG5cbiAgICAgIHRhYmxlLnN0cmluZyhcIm9wZXJhdGlvbl9rZXlcIiwge3ByaW1hcnlLZXk6IHRydWV9KVxuICAgICAgdGFibGUudGV4dChcIm9wZXJhdGlvbl9pZFwiLCB7bnVsbDogZmFsc2V9KVxuICAgICAgdGFibGUuc3RyaW5nKFwicGF5bG9hZF9kaWdlc3RcIiwge251bGw6IGZhbHNlfSlcbiAgICAgIHRhYmxlLnN0cmluZyhcImJhY2tncm91bmRfam9iX2lkXCIsIHtpbmRleDogdHJ1ZSwgbnVsbDogZmFsc2V9KVxuICAgICAgdGFibGUuYmlnaW50KFwiZmlyc3RfYXR0ZW1wdF9zdGFydGVkX2F0X21zXCIsIHtudWxsOiB0cnVlfSlcbiAgICAgIHRhYmxlLnN0cmluZyhcInByb3ZpZGVyX2tpbmRcIiwge251bGw6IGZhbHNlfSlcbiAgICAgIHRhYmxlLmJpZ2ludChcInByb3ZpZGVyX3JldGVudGlvbl9tc1wiLCB7bnVsbDogZmFsc2V9KVxuICAgICAgdGFibGUuYmlnaW50KFwiY3JlYXRlZF9hdF9tc1wiLCB7bnVsbDogZmFsc2V9KVxuICAgICAgYXdhaXQgZGIuY3JlYXRlVGFibGUodGFibGUpXG4gICAgICBkYi5jbGVhclNjaGVtYUNhY2hlKClcbiAgICB9IGZpbmFsbHkge1xuICAgICAgYXdhaXQgZGIucmVsZWFzZUFkdmlzb3J5TG9jayhsb2NrTmFtZSlcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogRW5zdXJlcyB0aGUgc2luZ2xldG9uIGR1cmFibGUgY291bnQtcmV2aXNpb24gcm93IGV4aXN0cy5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9kYXRhYmFzZS9kcml2ZXJzL2Jhc2UuanNcIikuZGVmYXVsdH0gZGIgLSBEYXRhYmFzZSBjb25uZWN0aW9uLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gUmVzb2x2ZXMgd2hlbiByZWFkeS5cbiAgICovXG4gIGFzeW5jIF9lbnN1cmVDb3VudFJldmlzaW9uVGFibGUoZGIpIHtcbiAgICBpZiAoIShhd2FpdCBkYi50YWJsZUV4aXN0cyhDT1VOVFNfUkVWSVNJT05fVEFCTEUpKSkge1xuICAgICAgY29uc3QgdGFibGUgPSBuZXcgVGFibGVEYXRhKENPVU5UU19SRVZJU0lPTl9UQUJMRSwge2lmTm90RXhpc3RzOiB0cnVlfSlcblxuICAgICAgdGFibGUuc3RyaW5nKFwia2V5XCIsIHtwcmltYXJ5S2V5OiB0cnVlfSlcbiAgICAgIHRhYmxlLmJpZ2ludChcInJldmlzaW9uXCIsIHtudWxsOiBmYWxzZX0pXG4gICAgICBhd2FpdCBkYi5jcmVhdGVUYWJsZSh0YWJsZSlcbiAgICB9XG5cbiAgICBjb25zdCByb3dzID0gYXdhaXQgZGIubmV3UXVlcnkoKS5mcm9tKENPVU5UU19SRVZJU0lPTl9UQUJMRSkud2hlcmUoe2tleTogQ09VTlRTX1JFVklTSU9OX0tFWX0pLmxpbWl0KDEpLnJlc3VsdHMoKVxuXG4gICAgaWYgKHJvd3MubGVuZ3RoID4gMCkgcmV0dXJuXG5cbiAgICB0cnkge1xuICAgICAgYXdhaXQgZGIuaW5zZXJ0KHt0YWJsZU5hbWU6IENPVU5UU19SRVZJU0lPTl9UQUJMRSwgZGF0YToge2tleTogQ09VTlRTX1JFVklTSU9OX0tFWSwgcmV2aXNpb246IDB9fSlcbiAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgY29uc3QgcmFjZWRSb3dzID0gYXdhaXQgZGIubmV3UXVlcnkoKS5mcm9tKENPVU5UU19SRVZJU0lPTl9UQUJMRSkud2hlcmUoe2tleTogQ09VTlRTX1JFVklTSU9OX0tFWX0pLmxpbWl0KDEpLnJlc3VsdHMoKVxuXG4gICAgICBpZiAocmFjZWRSb3dzLmxlbmd0aCA9PT0gMCkgdGhyb3cgZXJyb3JcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogUmVjb3JkcyBvbmUgbG9naWNhbCBjb3VudCBtdXRhdGlvbiBhdG9taWNhbGx5IGFuZCBicm9hZGNhc3RzIGl0IGFmdGVyIGNvbW1pdC5cbiAgICogWmVybyBlbnRyaWVzIGFyZSBvbWl0dGVkOyBhIHdob2xseSB6ZXJvLW5ldCBtdXRhdGlvbiBkb2VzIG5vdCBjb25zdW1lIGEgcmV2aXNpb24uXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vZGF0YWJhc2UvZHJpdmVycy9iYXNlLmpzXCIpLmRlZmF1bHR9IGRiIC0gVHJhbnNhY3Rpb24gY29ubmVjdGlvbi5cbiAgICogQHBhcmFtIHtSZWNvcmQ8c3RyaW5nLCBudW1iZXI+fSByZXF1ZXN0ZWREZWx0YXMgLSBTaWduZWQgYnVja2V0IGNoYW5nZXMuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSBSZXNvbHZlcyB3aGVuIHJlY29yZGVkLlxuICAgKi9cbiAgYXN5bmMgX3JlY29yZENvdW50RGVsdGEoZGIsIHJlcXVlc3RlZERlbHRhcykge1xuICAgIC8qKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgbnVtYmVyPn0gKi9cbiAgICBjb25zdCBkZWx0YXMgPSB7fVxuXG4gICAgZm9yIChjb25zdCBidWNrZXQgb2YgQkFDS0dST1VORF9KT0JfQ09VTlRfQlVDS0VUUykge1xuICAgICAgY29uc3QgYW1vdW50ID0gcmVxdWVzdGVkRGVsdGFzW2J1Y2tldF0gfHwgMFxuXG4gICAgICBpZiAoIU51bWJlci5pc0ludGVnZXIoYW1vdW50KSkgdGhyb3cgbmV3IEVycm9yKGBJbnZhbGlkIGJhY2tncm91bmQgam9iIGNvdW50IGRlbHRhIGZvciAke2J1Y2tldH06ICR7YW1vdW50fWApXG4gICAgICBpZiAoYW1vdW50ICE9PSAwKSBkZWx0YXNbYnVja2V0XSA9IGFtb3VudFxuICAgIH1cblxuICAgIGlmIChPYmplY3Qua2V5cyhkZWx0YXMpLmxlbmd0aCA9PT0gMCkgcmV0dXJuXG5cbiAgICBjb25zdCB0YWJsZSA9IGRiLnF1b3RlVGFibGUoQ09VTlRTX1JFVklTSU9OX1RBQkxFKVxuICAgIGNvbnN0IHJldmlzaW9uQ29sdW1uID0gZGIucXVvdGVDb2x1bW4oXCJyZXZpc2lvblwiKVxuICAgIGNvbnN0IGFmZmVjdGVkUm93cyA9IGF3YWl0IGRiLmFmZmVjdGVkUm93cyhcbiAgICAgIGBVUERBVEUgJHt0YWJsZX0gU0VUICR7cmV2aXNpb25Db2x1bW59ID0gJHtyZXZpc2lvbkNvbHVtbn0gKyAxIFdIRVJFICR7ZGIucXVvdGVDb2x1bW4oXCJrZXlcIil9ID0gJHtkYi5xdW90ZShDT1VOVFNfUkVWSVNJT05fS0VZKX1gXG4gICAgKVxuXG4gICAgaWYgKGFmZmVjdGVkUm93cyAhPT0gMSkgdGhyb3cgbmV3IEVycm9yKFwiQmFja2dyb3VuZCBqb2IgY291bnQgcmV2aXNpb24gcm93IGlzIG1pc3NpbmdcIilcblxuICAgIGNvbnN0IHJldmlzaW9uID0gYXdhaXQgdGhpcy5fY291bnRSZXZpc2lvbihkYilcbiAgICBjb25zdCBib2R5ID0ge2RlbHRhcywgcmV2aXNpb24sIHR5cGU6IFwiYmFja2dyb3VuZC1qb2ItY291bnQtZGVsdGFcIn1cbiAgICBjb25zdCBkYXRhYmFzZUlkZW50aWZpZXIgPSB0aGlzLmdldERhdGFiYXNlSWRlbnRpZmllcigpIHx8IFwiZGVmYXVsdFwiXG5cbiAgICBhd2FpdCBkYi5hZnRlckNvbW1pdCgoKSA9PiB7XG4gICAgICB0aGlzLmNvbmZpZ3VyYXRpb24uYnJvYWRjYXN0VG9DaGFubmVsKEJBQ0tHUk9VTkRfSk9CX0NPVU5UU19DSEFOTkVMLCB7ZGF0YWJhc2VJZGVudGlmaWVyfSwgYm9keSlcbiAgICB9KVxuICB9XG5cbiAgLyoqXG4gICAqIFJlY29yZHMgYSB0cmFuc2l0aW9uIGJldHdlZW4gcGVyc2lzdGVkIHN0YXR1c2VzLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL2RhdGFiYXNlL2RyaXZlcnMvYmFzZS5qc1wiKS5kZWZhdWx0fSBkYiAtIFRyYW5zYWN0aW9uIGNvbm5lY3Rpb24uXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBvbGRTdGF0dXMgLSBQcmV2aW91cyBzdGF0dXMuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBuZXdTdGF0dXMgLSBOZXcgc3RhdHVzLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gUmVzb2x2ZXMgd2hlbiByZWNvcmRlZC5cbiAgICovXG4gIGFzeW5jIF9yZWNvcmRTdGF0dXNUcmFuc2l0aW9uKGRiLCBvbGRTdGF0dXMsIG5ld1N0YXR1cykge1xuICAgIGNvbnN0IG9sZENvdW50ZWQgPSBDT1VOVEVEX0pPQl9TVEFUVVNFUy5pbmNsdWRlcyhvbGRTdGF0dXMpXG4gICAgY29uc3QgbmV3Q291bnRlZCA9IENPVU5URURfSk9CX1NUQVRVU0VTLmluY2x1ZGVzKG5ld1N0YXR1cylcblxuICAgIGlmICghb2xkQ291bnRlZCAmJiBvbGRTdGF0dXMgIT09IFwiY2FuY2VsbGVkXCIpIHRocm93IG5ldyBFcnJvcihgVW5rbm93biBwcmV2aW91cyBiYWNrZ3JvdW5kIGpvYiBzdGF0dXM6ICR7b2xkU3RhdHVzfWApXG4gICAgaWYgKCFuZXdDb3VudGVkICYmIG5ld1N0YXR1cyAhPT0gXCJjYW5jZWxsZWRcIikgdGhyb3cgbmV3IEVycm9yKGBVbmtub3duIG5leHQgYmFja2dyb3VuZCBqb2Igc3RhdHVzOiAke25ld1N0YXR1c31gKVxuICAgIGlmIChvbGRTdGF0dXMgPT09IG5ld1N0YXR1cykgcmV0dXJuXG5cbiAgICAvKiogQHR5cGUge1JlY29yZDxzdHJpbmcsIG51bWJlcj59ICovXG4gICAgY29uc3QgZGVsdGFzID0ge31cblxuICAgIGlmIChvbGRDb3VudGVkKSBkZWx0YXNbb2xkU3RhdHVzXSA9IC0xXG4gICAgaWYgKG5ld0NvdW50ZWQpIGRlbHRhc1tuZXdTdGF0dXNdID0gMVxuICAgIGlmIChvbGRDb3VudGVkICE9PSBuZXdDb3VudGVkKSBkZWx0YXMuYWxsID0gbmV3Q291bnRlZCA/IDEgOiAtMVxuICAgIGF3YWl0IHRoaXMuX3JlY29yZENvdW50RGVsdGEoZGIsIGRlbHRhcylcbiAgfVxuXG4gIC8qKlxuICAgKiBSZWFkcyB0aGUgbG9ja2VkIHJldmlzaW9uLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL2RhdGFiYXNlL2RyaXZlcnMvYmFzZS5qc1wiKS5kZWZhdWx0fSBkYiAtIERhdGFiYXNlIGNvbm5lY3Rpb24uXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPG51bWJlcj59IFJldmlzaW9uLlxuICAgKi9cbiAgYXN5bmMgX2NvdW50UmV2aXNpb24oZGIpIHtcbiAgICBjb25zdCByb3dzID0gYXdhaXQgZGIubmV3UXVlcnkoKS5mcm9tKENPVU5UU19SRVZJU0lPTl9UQUJMRSkuc2VsZWN0KFwicmV2aXNpb25cIikud2hlcmUoe2tleTogQ09VTlRTX1JFVklTSU9OX0tFWX0pLmxpbWl0KDEpLnJlc3VsdHMoKVxuICAgIGNvbnN0IHJldmlzaW9uID0gdGhpcy5fbm9ybWFsaXplTnVtYmVyKC8qKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSAqLyAocm93c1swXSB8fCB7fSkucmV2aXNpb24pXG5cbiAgICBpZiAocmV2aXNpb24gPT09IG51bGwgfHwgIU51bWJlci5pc1NhZmVJbnRlZ2VyKHJldmlzaW9uKSB8fCByZXZpc2lvbiA8IDApIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihgSW52YWxpZCBiYWNrZ3JvdW5kIGpvYiBjb3VudCByZXZpc2lvbjogJHtyZXZpc2lvbn1gKVxuICAgIH1cblxuICAgIHJldHVybiByZXZpc2lvblxuICB9XG5cbiAgLyoqXG4gICAqIFRha2VzIGEgcG9ydGFibGUgd3JpdGUgbG9jayBvbiB0aGUgc2luZ2xldG9uIHJldmlzaW9uIHJvdy5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9kYXRhYmFzZS9kcml2ZXJzL2Jhc2UuanNcIikuZGVmYXVsdH0gZGIgLSBEYXRhYmFzZSBjb25uZWN0aW9uLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gUmVzb2x2ZXMgd2hlbiBsb2NrZWQuXG4gICAqL1xuICBhc3luYyBfbG9ja0NvdW50UmV2aXNpb24oZGIpIHtcbiAgICBjb25zdCB0YWJsZSA9IGRiLnF1b3RlVGFibGUoQ09VTlRTX1JFVklTSU9OX1RBQkxFKVxuICAgIGNvbnN0IHJldmlzaW9uID0gZGIucXVvdGVDb2x1bW4oXCJyZXZpc2lvblwiKVxuXG4gICAgYXdhaXQgZGIucXVlcnkoYFVQREFURSAke3RhYmxlfSBTRVQgJHtyZXZpc2lvbn0gPSAke3JldmlzaW9ufSBXSEVSRSAke2RiLnF1b3RlQ29sdW1uKFwia2V5XCIpfSA9ICR7ZGIucXVvdGUoQ09VTlRTX1JFVklTSU9OX0tFWSl9YClcbiAgfVxuXG4gIC8qKlxuICAgKiBCdWlsZHMgemVyb2VkIGNhbm9uaWNhbCBidWNrZXRzLlxuICAgKiBAcmV0dXJucyB7UmVjb3JkPHN0cmluZywgbnVtYmVyPn0gWmVyb2VkIGNhbm9uaWNhbCBidWNrZXRzLlxuICAgKi9cbiAgX2VtcHR5Q291bnRCdWNrZXRzKCkge1xuICAgIHJldHVybiBPYmplY3QuZnJvbUVudHJpZXMoQkFDS0dST1VORF9KT0JfQ09VTlRfQlVDS0VUUy5tYXAoKGJ1Y2tldCkgPT4gW2J1Y2tldCwgMF0pKVxuICB9XG5cbiAgLyoqXG4gICAqIENvdW50cyBub3JtYWxpemVkIHJvd3MgYnkgY2Fub25pY2FsIHN0YXR1cy5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL3R5cGVzLmpzXCIpLkJhY2tncm91bmRKb2JSb3dbXX0gam9icyAtIEpvYnMuXG4gICAqIEByZXR1cm5zIHtSZWNvcmQ8c3RyaW5nLCBudW1iZXI+fSBDb3VudHMuXG4gICAqL1xuICBfc3RhdHVzQ291bnRzKGpvYnMpIHtcbiAgICAvKiogQHR5cGUge1JlY29yZDxzdHJpbmcsIG51bWJlcj59ICovXG4gICAgY29uc3QgY291bnRzID0ge31cblxuICAgIGZvciAoY29uc3Qgam9iIG9mIGpvYnMpIHtcbiAgICAgIGlmICghQ09VTlRFRF9KT0JfU1RBVFVTRVMuaW5jbHVkZXMoam9iLnN0YXR1cykpIHRocm93IG5ldyBFcnJvcihgVW5rbm93biBiYWNrZ3JvdW5kIGpvYiBzdGF0dXM6ICR7am9iLnN0YXR1c31gKVxuICAgICAgY291bnRzW2pvYi5zdGF0dXNdID0gKGNvdW50c1tqb2Iuc3RhdHVzXSB8fCAwKSArIDFcbiAgICB9XG5cbiAgICByZXR1cm4gY291bnRzXG4gIH1cblxuICAvKipcbiAgICogUmVhZHMgYSBjYW5vbmljYWwgc25hcHNob3QgYWZ0ZXIgbG9ja2luZyB0aGUgcmV2aXNpb24gcm93LlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL2RhdGFiYXNlL2RyaXZlcnMvYmFzZS5qc1wiKS5kZWZhdWx0fSBkYiAtIFRyYW5zYWN0aW9uIGNvbm5lY3Rpb24uXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHtjb3VudHM6IFJlY29yZDxzdHJpbmcsIG51bWJlcj4sIHJldmlzaW9uOiBudW1iZXIsIHRvdGFsOiBudW1iZXJ9Pn0gU25hcHNob3QuXG4gICAqL1xuICBhc3luYyBfY291bnRTbmFwc2hvdE9uTG9ja2VkQ29ubmVjdGlvbihkYikge1xuICAgIGNvbnN0IHJvd3MgPSBhd2FpdCBkYi5uZXdRdWVyeSgpLmZyb20oSk9CU19UQUJMRSkuc2VsZWN0KFwic3RhdHVzXCIpLnNlbGVjdChcIkNPVU5UKCopIEFTIGNvdW50XCIpLmdyb3VwKFwic3RhdHVzXCIpLnJlc3VsdHMoKVxuICAgIGNvbnN0IGNvdW50cyA9IHRoaXMuX2VtcHR5Q291bnRCdWNrZXRzKClcbiAgICBsZXQgdG90YWwgPSAwXG5cbiAgICBmb3IgKGNvbnN0IHJvdyBvZiByb3dzKSB7XG4gICAgICBjb25zdCB0eXBlZFJvdyA9IC8qKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSAqLyAocm93KVxuICAgICAgY29uc3Qgc3RhdHVzID0gU3RyaW5nKHR5cGVkUm93LnN0YXR1cylcbiAgICAgIGNvbnN0IGNvdW50ID0gdGhpcy5fbm9ybWFsaXplTnVtYmVyKHR5cGVkUm93LmNvdW50KSB8fCAwXG5cbiAgICAgIHRvdGFsICs9IGNvdW50XG5cbiAgICAgIGlmICghQ09VTlRFRF9KT0JfU1RBVFVTRVMuaW5jbHVkZXMoc3RhdHVzKSkgY29udGludWVcbiAgICAgIGNvdW50c1tzdGF0dXNdID0gY291bnRcbiAgICAgIGNvdW50cy5hbGwgKz0gY291bnRzW3N0YXR1c11cbiAgICB9XG5cbiAgICByZXR1cm4ge2NvdW50cywgcmV2aXNpb246IGF3YWl0IHRoaXMuX2NvdW50UmV2aXNpb24oZGIpLCB0b3RhbH1cbiAgfVxuXG4gIC8qKlxuICAgKiBSZWdpc3RlcnMgb3IgdmVyaWZpZXMgYSBzdGFibGUga2V5IGNvbmZpZ3VyYXRpb24uXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vZGF0YWJhc2UvZHJpdmVycy9iYXNlLmpzXCIpLmRlZmF1bHR9IGRiIC0gRGF0YWJhc2UgY29ubmVjdGlvbi5cbiAgICogQHBhcmFtIHtvYmplY3R9IGNvbmN1cnJlbmN5IC0gQ29uY3VycmVuY3kgY29uZmlndXJhdGlvbi5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGNvbmN1cnJlbmN5LmNvbmN1cnJlbmN5S2V5IC0gQ29uY3VycmVuY3kga2V5LlxuICAgKiBAcGFyYW0ge251bWJlcn0gY29uY3VycmVuY3kubWF4Q29uY3VycmVuY3kgLSBTdGFibGUgY2FwLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyB3aGVuIHZlcmlmaWVkLlxuICAgKi9cbiAgYXN5bmMgX2Vuc3VyZUNvbmN1cnJlbmN5S2V5KGRiLCB7Y29uY3VycmVuY3lLZXksIG1heENvbmN1cnJlbmN5fSkge1xuICAgIGNvbnN0IHJvd3MgPSBhd2FpdCBkYi5uZXdRdWVyeSgpLmZyb20oQ09OQ1VSUkVOQ1lfVEFCTEUpLndoZXJlKHtjb25jdXJyZW5jeV9rZXk6IGNvbmN1cnJlbmN5S2V5fSkubGltaXQoMSkucmVzdWx0cygpXG4gICAgaWYgKCFyb3dzWzBdKSB7XG4gICAgICB0cnkge1xuICAgICAgICBhd2FpdCBkYi5pbnNlcnQoe3RhYmxlTmFtZTogQ09OQ1VSUkVOQ1lfVEFCTEUsIGRhdGE6IHthY3RpdmVfY291bnQ6IDAsIGNvbmN1cnJlbmN5X2tleTogY29uY3VycmVuY3lLZXksIG1heF9jb25jdXJyZW5jeTogbWF4Q29uY3VycmVuY3l9fSlcbiAgICAgICAgcmV0dXJuXG4gICAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgICBjb25zdCByYWNlZFJvd3MgPSBhd2FpdCBkYi5uZXdRdWVyeSgpLmZyb20oQ09OQ1VSUkVOQ1lfVEFCTEUpLndoZXJlKHtjb25jdXJyZW5jeV9rZXk6IGNvbmN1cnJlbmN5S2V5fSkubGltaXQoMSkucmVzdWx0cygpXG4gICAgICAgIGlmICghcmFjZWRSb3dzWzBdKSB0aHJvdyBlcnJvclxuICAgICAgICByb3dzWzBdID0gcmFjZWRSb3dzWzBdXG4gICAgICB9XG4gICAgfVxuICAgIGNvbnN0IGNvbmZpZ3VyZWQgPSAvKiogQHR5cGUge3ttYXhfY29uY3VycmVuY3k/OiBudW1iZXIgfCBzdHJpbmd9fSAqLyAocm93c1swXSlcbiAgICBpZiAodGhpcy5fbm9ybWFsaXplTnVtYmVyKGNvbmZpZ3VyZWQubWF4X2NvbmN1cnJlbmN5KSAhPT0gbWF4Q29uY3VycmVuY3kpIHRocm93IG5ldyBFcnJvcihgQ29uZmxpY3RpbmcgbWF4Q29uY3VycmVuY3kgZm9yIGJhY2tncm91bmQgam9iIGNvbmN1cnJlbmN5S2V5OiAke2NvbmN1cnJlbmN5S2V5fWApXG4gIH1cblxuICAvKipcbiAgICogTG9ja3MgdGhlIGNvbmN1cnJlbmN5IGNvdW50ZXIgcm93IHNvIGEgam9iLXJlbGVhc2UgdHJhbnNhY3Rpb24gYWNxdWlyZXMgaXQgKmJlZm9yZSogdGhlIGpvYlxuICAgKiByb3cuIHtAbGluayBtYXJrSGFuZGVkT2ZmfSByZXNlcnZlcyBjYXBhY2l0eSAobG9ja2luZyB0aGUgY291bnRlciByb3cpIGJlZm9yZSBpdCB1cGRhdGVzIHRoZVxuICAgKiBqb2IsIHNvIGl0IGxvY2tzIGNvbmN1cnJlbmN5LXRoZW4tam9iOyB0aGUgcmVsZWFzZSBwYXRocyB1cGRhdGUgdGhlIGpvYiBiZWZvcmUgcmVsZWFzaW5nXG4gICAqIGNhcGFjaXR5LCB3aGljaCBpcyBqb2ItdGhlbi1jb25jdXJyZW5jeS4gVGhvc2Ugb3Bwb3NpdGUgb3JkZXJzIG9uIHRoZSBzYW1lIHNoYXJlZCBjb3VudGVyIHJvd1xuICAgKiBhcmUgd2hhdCBkZWFkbG9jayAoQUItQkEpIHVuZGVyIGEgZHJhaW5pbmcgd29ya2VyLiBUYWtpbmcgdGhpcyBsb2NrIGZpcnN0IGdpdmVzIGV2ZXJ5XG4gICAqIHRyYW5zYWN0aW9uIGEgc2luZ2xlIGNvbmN1cnJlbmN5LXRoZW4tam9iIG9yZGVyIGFuZCByZW1vdmVzIHRoZSBjeWNsZS5cbiAgICpcbiAgICogVXNlcyBhIHZhbHVlLXByZXNlcnZpbmcgYFVQREFURWAgcmF0aGVyIHRoYW4gYFNFTEVDVCAuLi4gRk9SIFVQREFURWAgc28gaXQgc3RheXMgcG9ydGFibGVcbiAgICogYWNyb3NzIGRyaXZlcnMgd2l0aG91dCByb3ctbGV2ZWwgbG9ja2luZyByZWFkcyAoZS5nLiBTUUxpdGUpOyBvbiByb3ctbG9ja2luZyBlbmdpbmVzIHRoZVxuICAgKiBtYXRjaGVkIHJvdyBpcyB3cml0ZS1sb2NrZWQgZm9yIHRoZSByZXN0IG9mIHRoZSB0cmFuc2FjdGlvbiBldmVuIHRob3VnaCBpdHMgdmFsdWUgaXMgdW5jaGFuZ2VkLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL2RhdGFiYXNlL2RyaXZlcnMvYmFzZS5qc1wiKS5kZWZhdWx0fSBkYiAtIERhdGFiYXNlIGNvbm5lY3Rpb24uXG4gICAqIEBwYXJhbSB7c3RyaW5nIHwgbnVsbH0gY29uY3VycmVuY3lLZXkgLSBDb25jdXJyZW5jeSBrZXkuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIHdoZW4gdGhlIGNvdW50ZXIgcm93IGlzIGxvY2tlZC5cbiAgICovXG4gIGFzeW5jIF9sb2NrQ29uY3VycmVuY3lSb3coZGIsIGNvbmN1cnJlbmN5S2V5KSB7XG4gICAgaWYgKCFjb25jdXJyZW5jeUtleSkgcmV0dXJuXG4gICAgY29uc3QgdGFibGUgPSBkYi5xdW90ZVRhYmxlKENPTkNVUlJFTkNZX1RBQkxFKVxuICAgIGNvbnN0IGNvdW50ID0gZGIucXVvdGVDb2x1bW4oXCJhY3RpdmVfY291bnRcIilcbiAgICBhd2FpdCBkYi5xdWVyeShgVVBEQVRFICR7dGFibGV9IFNFVCAke2NvdW50fSA9ICR7Y291bnR9IFdIRVJFICR7ZGIucXVvdGVDb2x1bW4oXCJjb25jdXJyZW5jeV9rZXlcIil9ID0gJHtkYi5xdW90ZShjb25jdXJyZW5jeUtleSl9YClcbiAgfVxuXG4gIC8qKlxuICAgKiBBdG9taWNhbGx5IHJlc2VydmVzIGNhcGFjaXR5IGZvciBhIGtleS5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9kYXRhYmFzZS9kcml2ZXJzL2Jhc2UuanNcIikuZGVmYXVsdH0gZGIgLSBEYXRhYmFzZSBjb25uZWN0aW9uLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gY29uY3VycmVuY3lLZXkgLSBDb25jdXJyZW5jeSBrZXkuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPGJvb2xlYW4+fSAtIFdoZXRoZXIgY2FwYWNpdHkgd2FzIHJlc2VydmVkLlxuICAgKi9cbiAgYXN5bmMgX3Jlc2VydmVDb25jdXJyZW5jeShkYiwgY29uY3VycmVuY3lLZXkpIHtcbiAgICBjb25zdCB0YWJsZSA9IGRiLnF1b3RlVGFibGUoQ09OQ1VSUkVOQ1lfVEFCTEUpXG4gICAgY29uc3QgY291bnQgPSBkYi5xdW90ZUNvbHVtbihcImFjdGl2ZV9jb3VudFwiKVxuICAgIGNvbnN0IGFmZmVjdGVkUm93cyA9IGF3YWl0IGRiLmFmZmVjdGVkUm93cyhgVVBEQVRFICR7dGFibGV9IFNFVCAke2NvdW50fSA9ICR7Y291bnR9ICsgMSBXSEVSRSAke2RiLnF1b3RlQ29sdW1uKFwiY29uY3VycmVuY3lfa2V5XCIpfSA9ICR7ZGIucXVvdGUoY29uY3VycmVuY3lLZXkpfSBBTkQgJHtjb3VudH0gPCAke2RiLnF1b3RlQ29sdW1uKFwibWF4X2NvbmN1cnJlbmN5XCIpfWApXG4gICAgcmV0dXJuIGFmZmVjdGVkUm93cyA9PT0gMVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgYSBwb3J0YWJsZSB1cGRhdGUgYW5kIHJldHVybnMgaXRzIGFmZmVjdGVkLXJvdyBjb3VudC5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9kYXRhYmFzZS9kcml2ZXJzL2Jhc2UuanNcIikuZGVmYXVsdH0gZGIgLSBEYXRhYmFzZSBjb25uZWN0aW9uLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL2RhdGFiYXNlL2RyaXZlcnMvYmFzZS5qc1wiKS5VcGRhdGVTcWxBcmdzVHlwZX0gYXJncyAtIFVwZGF0ZSBvcHRpb25zLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxudW1iZXI+fSAtIEFmZmVjdGVkIHJvdyBjb3VudC5cbiAgICovXG4gIGFzeW5jIF91cGRhdGVBZmZlY3RlZFJvd3MoZGIsIGFyZ3MpIHtcbiAgICByZXR1cm4gYXdhaXQgZGIuYWZmZWN0ZWRSb3dzKGRiLnVwZGF0ZVNxbChhcmdzKSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSZWxlYXNlcyBjYXBhY2l0eSBmb3IgYSBrZXkuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vZGF0YWJhc2UvZHJpdmVycy9iYXNlLmpzXCIpLmRlZmF1bHR9IGRiIC0gRGF0YWJhc2UgY29ubmVjdGlvbi5cbiAgICogQHBhcmFtIHtzdHJpbmcgfCBudWxsfSBjb25jdXJyZW5jeUtleSAtIENvbmN1cnJlbmN5IGtleS5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgd2hlbiByZWxlYXNlZC5cbiAgICovXG4gIGFzeW5jIF9yZWxlYXNlQ29uY3VycmVuY3koZGIsIGNvbmN1cnJlbmN5S2V5KSB7XG4gICAgaWYgKCFjb25jdXJyZW5jeUtleSkgcmV0dXJuXG4gICAgY29uc3QgdGFibGUgPSBkYi5xdW90ZVRhYmxlKENPTkNVUlJFTkNZX1RBQkxFKVxuICAgIGNvbnN0IGNvdW50ID0gZGIucXVvdGVDb2x1bW4oXCJhY3RpdmVfY291bnRcIilcbiAgICBhd2FpdCBkYi5xdWVyeShgVVBEQVRFICR7dGFibGV9IFNFVCAke2NvdW50fSA9ICR7Y291bnR9IC0gMSBXSEVSRSAke2RiLnF1b3RlQ29sdW1uKFwiY29uY3VycmVuY3lfa2V5XCIpfSA9ICR7ZGIucXVvdGUoY29uY3VycmVuY3lLZXkpfSBBTkQgJHtjb3VudH0gPiAwYClcbiAgfVxuXG4gIC8qKlxuICAgKiBSZWJ1aWxkcyBkdXJhYmxlIGNvdW50cyBmcm9tIGFjdGl2ZSBoYW5kb2Zmcy5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9kYXRhYmFzZS9kcml2ZXJzL2Jhc2UuanNcIikuZGVmYXVsdH0gZGIgLSBEYXRhYmFzZSBjb25uZWN0aW9uLlxuICAgKiBAcGFyYW0ge3tpbnNpZGVUcmFuc2FjdGlvbj86IGJvb2xlYW59fSBbb3B0aW9uc10gLSBSZXVzZSBhbiBlbmNsb3NpbmcgdHJhbnNhY3Rpb24uXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPGltcG9ydChcIi4vdHlwZXMuanNcIikuQmFja2dyb3VuZEpvYkNvbmN1cnJlbmN5UmVjb25jaWxpYXRpb24+fSAtIFJlcGFpciBzdW1tYXJ5LlxuICAgKi9cbiAgYXN5bmMgX3JlY29uY2lsZUNvbmN1cnJlbmN5KGRiLCB7aW5zaWRlVHJhbnNhY3Rpb24gPSBmYWxzZX0gPSB7fSkge1xuICAgIGlmICghKGF3YWl0IGRiLnRhYmxlRXhpc3RzKENPTkNVUlJFTkNZX1RBQkxFKSkpIHtcbiAgICAgIHJldHVybiB7Y2FuZGlkYXRlQ291bnQ6IDAsIGNoZWNrZWRDb3VudDogMCwgcmVwYWlyZWRDb3VudDogMCwgcmVwYWlyczogW10sIHJlcGFpcnNUcnVuY2F0ZWRDb3VudDogMH1cbiAgICB9XG5cbiAgICBjb25zdCBhY3RpdmVSb3dzID0gYXdhaXQgZGJcbiAgICAgIC5uZXdRdWVyeSgpXG4gICAgICAuZnJvbShKT0JTX1RBQkxFKVxuICAgICAgLnNlbGVjdChcImNvbmN1cnJlbmN5X2tleVwiKVxuICAgICAgLnNlbGVjdChcIkNPVU5UKCopIEFTIGFjdGl2ZV9jb3VudFwiKVxuICAgICAgLndoZXJlKHtzdGF0dXM6IFwiaGFuZGVkX29mZlwifSlcbiAgICAgIC53aGVyZShgJHtkYi5xdW90ZUNvbHVtbihcImNvbmN1cnJlbmN5X2tleVwiKX0gSVMgTk9UIE5VTExgKVxuICAgICAgLmdyb3VwKFwiY29uY3VycmVuY3lfa2V5XCIpXG4gICAgICAucmVzdWx0cygpXG4gICAgY29uc3Qgc3RhbGVSb3dzID0gYXdhaXQgZGJcbiAgICAgIC5uZXdRdWVyeSgpXG4gICAgICAuZnJvbShDT05DVVJSRU5DWV9UQUJMRSlcbiAgICAgIC5zZWxlY3QoXCJjb25jdXJyZW5jeV9rZXlcIilcbiAgICAgIC5zZWxlY3QoXCJhY3RpdmVfY291bnRcIilcbiAgICAgIC53aGVyZShgJHtkYi5xdW90ZUNvbHVtbihcImFjdGl2ZV9jb3VudFwiKX0gIT0gMGApXG4gICAgICAucmVzdWx0cygpXG4gICAgLyoqIEB0eXBlIHtNYXA8c3RyaW5nLCBudW1iZXI+fSAqL1xuICAgIGNvbnN0IGFjdGl2ZUNvdW50cyA9IG5ldyBNYXAoKVxuICAgIC8qKiBAdHlwZSB7TWFwPHN0cmluZywgbnVtYmVyPn0gKi9cbiAgICBjb25zdCBwZXJzaXN0ZWRDb3VudHMgPSBuZXcgTWFwKClcblxuICAgIGZvciAoY29uc3QgcmF3Um93IG9mIGFjdGl2ZVJvd3MpIHtcbiAgICAgIGNvbnN0IHJvdyA9IC8qKiBAdHlwZSB7QmFja2dyb3VuZEpvYkNvbmN1cnJlbmN5Q291bnRSb3d9ICovIChyYXdSb3cpXG4gICAgICBhY3RpdmVDb3VudHMuc2V0KHJvdy5jb25jdXJyZW5jeV9rZXksIHRoaXMuX3ZhbGlkYXRlZENvbmN1cnJlbmN5Q291bnQocm93LmFjdGl2ZV9jb3VudCwgcm93LmNvbmN1cnJlbmN5X2tleSkpXG4gICAgfVxuXG4gICAgZm9yIChjb25zdCByYXdSb3cgb2Ygc3RhbGVSb3dzKSB7XG4gICAgICBjb25zdCByb3cgPSAvKiogQHR5cGUge0JhY2tncm91bmRKb2JDb25jdXJyZW5jeUNvdW50Um93fSAqLyAocmF3Um93KVxuICAgICAgcGVyc2lzdGVkQ291bnRzLnNldChyb3cuY29uY3VycmVuY3lfa2V5LCB0aGlzLl92YWxpZGF0ZWRDb25jdXJyZW5jeUNvdW50KHJvdy5hY3RpdmVfY291bnQsIHJvdy5jb25jdXJyZW5jeV9rZXkpKVxuICAgIH1cblxuICAgIGNvbnN0IGNvbmN1cnJlbmN5S2V5cyA9IFsuLi5uZXcgU2V0KFsuLi5hY3RpdmVDb3VudHMua2V5cygpLCAuLi5wZXJzaXN0ZWRDb3VudHMua2V5cygpXSldLnNvcnQoKVxuICAgIGNvbnN0IGNhbmRpZGF0ZUtleXMgPSBjb25jdXJyZW5jeUtleXMuZmlsdGVyKChjb25jdXJyZW5jeUtleSkgPT4ge1xuICAgICAgcmV0dXJuIChhY3RpdmVDb3VudHMuZ2V0KGNvbmN1cnJlbmN5S2V5KSB8fCAwKSAhPT0gKHBlcnNpc3RlZENvdW50cy5nZXQoY29uY3VycmVuY3lLZXkpIHx8IDApXG4gICAgfSlcbiAgICAvKiogQHR5cGUge2ltcG9ydChcIi4vdHlwZXMuanNcIikuQmFja2dyb3VuZEpvYkNvbmN1cnJlbmN5UmVwYWlyW119ICovXG4gICAgY29uc3QgcmVwYWlycyA9IFtdXG4gICAgbGV0IHJlcGFpcmVkQ291bnQgPSAwXG5cbiAgICBmb3IgKGNvbnN0IGNvbmN1cnJlbmN5S2V5IG9mIGNhbmRpZGF0ZUtleXMpIHtcbiAgICAgIGNvbnN0IHJlcGFpciA9IGluc2lkZVRyYW5zYWN0aW9uXG4gICAgICAgID8gYXdhaXQgdGhpcy5fcmVjb25jaWxlQ29uY3VycmVuY3lLZXkoZGIsIGNvbmN1cnJlbmN5S2V5KVxuICAgICAgICA6IGF3YWl0IHRoaXMuX3RyYW5zYWN0aW9uUmVzdWx0KGRiLCBhc3luYyAoKSA9PiBhd2FpdCB0aGlzLl9yZWNvbmNpbGVDb25jdXJyZW5jeUtleShkYiwgY29uY3VycmVuY3lLZXkpKVxuXG4gICAgICBpZiAoIXJlcGFpcikgY29udGludWVcblxuICAgICAgcmVwYWlyZWRDb3VudCsrXG4gICAgICBpZiAocmVwYWlycy5sZW5ndGggPCBDT05DVVJSRU5DWV9SRVBBSVJfU0FNUExFX0xJTUlUKSByZXBhaXJzLnB1c2gocmVwYWlyKVxuICAgIH1cblxuICAgIHJldHVybiB7XG4gICAgICBjYW5kaWRhdGVDb3VudDogY2FuZGlkYXRlS2V5cy5sZW5ndGgsXG4gICAgICBjaGVja2VkQ291bnQ6IGNvbmN1cnJlbmN5S2V5cy5sZW5ndGgsXG4gICAgICByZXBhaXJlZENvdW50LFxuICAgICAgcmVwYWlycyxcbiAgICAgIHJlcGFpcnNUcnVuY2F0ZWRDb3VudDogcmVwYWlyZWRDb3VudCAtIHJlcGFpcnMubGVuZ3RoXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIFJlYnVpbGRzIG9uZSBjb3VudGVyIGFmdGVyIGxvY2tpbmcgaXQgYWhlYWQgb2YgdGhlIGpvYiByb3dzLCBtYXRjaGluZyB0aGVcbiAgICogbG9jayBvcmRlciB1c2VkIGJ5IGhhbmRvZmYgYW5kIGNvbXBsZXRpb24gdHJhbnNpdGlvbnMuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vZGF0YWJhc2UvZHJpdmVycy9iYXNlLmpzXCIpLmRlZmF1bHR9IGRiIC0gRGF0YWJhc2UgY29ubmVjdGlvbi5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGNvbmN1cnJlbmN5S2V5IC0gQ291bnRlciBrZXkuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPGltcG9ydChcIi4vdHlwZXMuanNcIikuQmFja2dyb3VuZEpvYkNvbmN1cnJlbmN5UmVwYWlyIHwgbnVsbD59IC0gQXBwbGllZCByZXBhaXIuXG4gICAqL1xuICBhc3luYyBfcmVjb25jaWxlQ29uY3VycmVuY3lLZXkoZGIsIGNvbmN1cnJlbmN5S2V5KSB7XG4gICAgYXdhaXQgdGhpcy5fbG9ja0NvbmN1cnJlbmN5Um93KGRiLCBjb25jdXJyZW5jeUtleSlcbiAgICBjb25zdCBwZXJzaXN0ZWRSb3dzID0gYXdhaXQgZGJcbiAgICAgIC5uZXdRdWVyeSgpXG4gICAgICAuZnJvbShDT05DVVJSRU5DWV9UQUJMRSlcbiAgICAgIC5zZWxlY3QoXCJhY3RpdmVfY291bnRcIilcbiAgICAgIC5zZWxlY3QoXCJjb25jdXJyZW5jeV9rZXlcIilcbiAgICAgIC53aGVyZSh7Y29uY3VycmVuY3lfa2V5OiBjb25jdXJyZW5jeUtleX0pXG4gICAgICAubGltaXQoMSlcbiAgICAgIC5yZXN1bHRzKClcblxuICAgIGlmICghcGVyc2lzdGVkUm93c1swXSkgdGhyb3cgbmV3IEVycm9yKGBNaXNzaW5nIGJhY2tncm91bmQgam9iIGNvbmN1cnJlbmN5IGNvdW50ZXIgZm9yICR7Y29uY3VycmVuY3lLZXl9YClcblxuICAgIGNvbnN0IHBlcnNpc3RlZFJvdyA9IC8qKiBAdHlwZSB7QmFja2dyb3VuZEpvYkNvbmN1cnJlbmN5Q291bnRSb3d9ICovIChwZXJzaXN0ZWRSb3dzWzBdKVxuICAgIGNvbnN0IHByZXZpb3VzQWN0aXZlQ291bnQgPSB0aGlzLl92YWxpZGF0ZWRDb25jdXJyZW5jeUNvdW50KHBlcnNpc3RlZFJvdy5hY3RpdmVfY291bnQsIGNvbmN1cnJlbmN5S2V5KVxuICAgIGNvbnN0IHJvd3MgPSBhd2FpdCBkYlxuICAgICAgLm5ld1F1ZXJ5KClcbiAgICAgIC5mcm9tKEpPQlNfVEFCTEUpXG4gICAgICAuc2VsZWN0KFwiQ09VTlQoKikgQVMgYWN0aXZlX2NvdW50XCIpXG4gICAgICAud2hlcmUoe2NvbmN1cnJlbmN5X2tleTogY29uY3VycmVuY3lLZXksIHN0YXR1czogXCJoYW5kZWRfb2ZmXCJ9KVxuICAgICAgLnJlc3VsdHMoKVxuICAgIGNvbnN0IGNvdW50Um93ID0gLyoqIEB0eXBlIHt7YWN0aXZlX2NvdW50OiBudW1iZXIgfCBzdHJpbmd9fSAqLyAocm93c1swXSlcbiAgICBjb25zdCBhY3RpdmVDb3VudCA9IHRoaXMuX3ZhbGlkYXRlZENvbmN1cnJlbmN5Q291bnQoY291bnRSb3cuYWN0aXZlX2NvdW50LCBjb25jdXJyZW5jeUtleSlcblxuICAgIGlmIChhY3RpdmVDb3VudCA9PT0gcHJldmlvdXNBY3RpdmVDb3VudCkgcmV0dXJuIG51bGxcblxuICAgIGF3YWl0IGRiLnVwZGF0ZSh7XG4gICAgICB0YWJsZU5hbWU6IENPTkNVUlJFTkNZX1RBQkxFLFxuICAgICAgZGF0YToge2FjdGl2ZV9jb3VudDogYWN0aXZlQ291bnR9LFxuICAgICAgY29uZGl0aW9uczoge2NvbmN1cnJlbmN5X2tleTogY29uY3VycmVuY3lLZXl9XG4gICAgfSlcblxuICAgIHJldHVybiB7YWN0aXZlQ291bnQsIGNvbmN1cnJlbmN5S2V5LCBwcmV2aW91c0FjdGl2ZUNvdW50fVxuICB9XG5cbiAgLyoqXG4gICAqIFZhbGlkYXRlcyBhIGRhdGFiYXNlIGNvdW50IGJlZm9yZSBpdCBwYXJ0aWNpcGF0ZXMgaW4gcmVjb25jaWxpYXRpb24uXG4gICAqIEBwYXJhbSB7bnVtYmVyIHwgc3RyaW5nfSB2YWx1ZSAtIFJhdyBjb3VudC5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGNvbmN1cnJlbmN5S2V5IC0gQ291bnRlciBrZXkgZm9yIGRpYWdub3N0aWNzLlxuICAgKiBAcmV0dXJucyB7bnVtYmVyfSAtIFNhZmUgbm9uLW5lZ2F0aXZlIGNvdW50LlxuICAgKi9cbiAgX3ZhbGlkYXRlZENvbmN1cnJlbmN5Q291bnQodmFsdWUsIGNvbmN1cnJlbmN5S2V5KSB7XG4gICAgY29uc3QgY291bnQgPSB0aGlzLl9ub3JtYWxpemVOdW1iZXIodmFsdWUpXG5cbiAgICBpZiAoY291bnQgPT09IG51bGwgfHwgIU51bWJlci5pc1NhZmVJbnRlZ2VyKGNvdW50KSB8fCBjb3VudCA8IDApIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihgSW52YWxpZCByZWNvbmNpbGVkIGJhY2tncm91bmQgam9iIGNvbmN1cnJlbmN5IGNvdW50IGZvciAke2NvbmN1cnJlbmN5S2V5fTogJHtjb3VudH1gKVxuICAgIH1cblxuICAgIHJldHVybiBjb3VudFxuICB9XG5cbiAgLyoqXG4gICAqIFJlY29uY2lsZXMgcXVldWUtZGVyaXZlZCBjb25jdXJyZW5jeSB3aXRoIHRoZSBjdXJyZW50IGNvbmZpZ3VyYXRpb24uIE9ubHlcbiAgICogaW52b2tlZCB0aHJvdWdoIHtAbGluayByZWNvbmNpbGVRdWV1ZUNvbmN1cnJlbmN5fSDigJQgdGhlIGV4cGxpY2l0IGxpZmVjeWNsZVxuICAgKiBwYXRoIHJ1biBhdCBtYWluLXByb2Nlc3Mgc3RhcnR1cCB1bmRlciBhIGNyb3NzLXByb2Nlc3MgYWR2aXNvcnkgbG9jayDigJRcbiAgICogbmV2ZXIgZnJvbSBzY2hlbWEvdGVuYW50IGNoZWNrcyBvciByb3V0aW5lIGNvbm5lY3Rpb24gaW5pdGlhbGl6YXRpb24sXG4gICAqIHdoaWNoIHN0YXkgcmVhZC1vbmx5IHJlZ2FyZGluZyBxdWV1ZWQgam9iIHJvd3MuIFRoZSBwZXItcHJvY2VzcyBtZW1vIGlzXG4gICAqIGxhdGNoZWQgYnkge0BsaW5rIHJlY29uY2lsZVF1ZXVlQ29uY3VycmVuY3l9IG9ubHkgYWZ0ZXIgdGhlIGZvbGxvd2luZ1xuICAgKiBjb3VudCByZWJ1aWxkIGFsc28gc3VjY2VlZHMsIHNvIGEgZmFpbGVkIHJlYnVpbGQgcmUtZW50ZXJzIGhlcmUgb24gcmV0cnlcbiAgICogKHRoZSBhZG9wdGlvbiBVUERBVEVzIGJlbG93IGFyZSBpZGVtcG90ZW50KS4gRW5xdWV1ZSBvbmx5IGNvbnN1bHRzIGNvbmZpZyBmb3IgbmV3IGpvYnMsIHNvIGEgY2FwIGFkZGVkLCByZW1vdmVkLCBvciBjaGFuZ2VkXG4gICAqIHdoaWxlIGEgYmFja2xvZyBleGlzdHMgb3RoZXJ3aXNlIGxlYXZlcyBwZXJzaXN0ZWQgcm93cyBzdGFsZTogcHJlLWNhcCBqb2JzXG4gICAqIGtlZXAgYSBudWxsIGtleSBhbmQgYnlwYXNzIHRoZSBjYXAsIHBvc3QtcmVtb3ZhbCBqb2JzIHN0YXkgY2FwcGVkIHVuZGVyIGFcbiAgICogbm93LXVuY29uZmlndXJlZCBrZXksIGFuZCBhIGNoYW5nZWQgbnVtZXJpYyBjYXAgc3RheXMgc3RhbGUgdW50aWwgdGhlIG5leHRcbiAgICogZW5xdWV1ZS4gQnJpbmcgcXVldWVkIGR1cmFibGUgc3RhdGUgaW4gbGluZSB3aXRoIGNvbmZpZzogc3luYyBlYWNoIGNvbmZpZ3VyZWRcbiAgICogcXVldWUncyBzdG9yZWQgY2FwLCBhZG9wdCBub3QteWV0LWtleWVkIHF1ZXVlZCBqb2JzIG9udG8gdGhlaXIgcXVldWUga2V5LFxuICAgKiBhbmQgcmVsZWFzZSBxdWV1ZWQgam9icyBmcm9tIHF1ZXVlIGtleXMgd2hvc2UgcXVldWUgaXMgbm8gbG9uZ2VyIGNhcHBlZC5cbiAgICogRXhpc3RpbmcgaGFuZG9mZnMgcmV0YWluIHRoZSBwb2xpY3kgYW5kIHJlc2VydmF0aW9uIHRoZXkgc3RhcnRlZCB3aXRoLCBzb1xuICAgKiByZWNvbmNpbGlhdGlvbiBjYW5ub3QgcmFjZSB0aGVpciBjb21wbGV0aW9uL3JldHJ5IHRyYW5zaXRpb25zLiBSdW5zIGJlZm9yZVxuICAgKiB7QGxpbmsgX3JlY29uY2lsZUNvbmN1cnJlbmN5fSBzbyBhbnkgcHJlLWV4aXN0aW5nIGFjdGl2ZSBjb3VudHMgYXJlIGV4YWN0LlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL2RhdGFiYXNlL2RyaXZlcnMvYmFzZS5qc1wiKS5kZWZhdWx0fSBkYiAtIERhdGFiYXNlIGNvbm5lY3Rpb24uXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIHdoZW4gcmVjb25jaWxlZC5cbiAgICovXG4gIGFzeW5jIF9yZWNvbmNpbGVRdWV1ZUNvbmN1cnJlbmN5KGRiKSB7XG4gICAgaWYgKHRoaXMuX3F1ZXVlQ29uY3VycmVuY3lSZWNvbmNpbGVkKSByZXR1cm5cbiAgICBpZiAoIShhd2FpdCBkYi50YWJsZUV4aXN0cyhDT05DVVJSRU5DWV9UQUJMRSkpKSByZXR1cm5cblxuICAgIGNvbnN0IHF1ZXVlc0NvbmZpZyA9IHRoaXMuY29uZmlndXJhdGlvbi5nZXRCYWNrZ3JvdW5kSm9ic0NvbmZpZygpLnF1ZXVlcyB8fCB7fVxuICAgIGNvbnN0IGpvYnNUYWJsZSA9IGRiLnF1b3RlVGFibGUoSk9CU19UQUJMRSlcbiAgICBjb25zdCBrZXlDb2x1bW4gPSBkYi5xdW90ZUNvbHVtbihcImNvbmN1cnJlbmN5X2tleVwiKVxuICAgIGNvbnN0IGNhcENvbHVtbiA9IGRiLnF1b3RlQ29sdW1uKFwibWF4X2NvbmN1cnJlbmN5XCIpXG4gICAgY29uc3QgcXVldWVDb2x1bW4gPSBkYi5xdW90ZUNvbHVtbihcInF1ZXVlXCIpXG4gICAgY29uc3QgcXVldWVkID0gYCR7ZGIucXVvdGVDb2x1bW4oXCJzdGF0dXNcIil9ID0gJHtkYi5xdW90ZShcInF1ZXVlZFwiKX1gXG4gICAgLyoqIEB0eXBlIHtTZXQ8c3RyaW5nPn0gKi9cbiAgICBjb25zdCBjYXBwZWRRdWV1ZXMgPSBuZXcgU2V0KClcblxuICAgIGZvciAoY29uc3QgcXVldWUgb2YgT2JqZWN0LmtleXMocXVldWVzQ29uZmlnKSkge1xuICAgICAgY29uc3QgY2FwID0gdGhpcy5fcXVldWVNYXhDb25jdXJyZW5jeShxdWV1ZSlcblxuICAgICAgaWYgKGNhcCA9PT0gbnVsbCkgY29udGludWVcblxuICAgICAgY2FwcGVkUXVldWVzLmFkZChxdWV1ZSlcbiAgICAgIGNvbnN0IGNvbmN1cnJlbmN5S2V5ID0gYCR7UVVFVUVfQ09OQ1VSUkVOQ1lfS0VZX1BSRUZJWH0ke3F1ZXVlfWBcblxuICAgICAgYXdhaXQgdGhpcy5fZW5zdXJlUXVldWVDb25jdXJyZW5jeUtleShkYiwge2NvbmN1cnJlbmN5S2V5LCBtYXhDb25jdXJyZW5jeTogY2FwfSlcbiAgICAgIGF3YWl0IGRiLnF1ZXJ5KFxuICAgICAgICBgVVBEQVRFICR7am9ic1RhYmxlfSBTRVQgJHtrZXlDb2x1bW59ID0gJHtkYi5xdW90ZShjb25jdXJyZW5jeUtleSl9LCAke2NhcENvbHVtbn0gPSAke051bWJlcihjYXApfSBgICtcbiAgICAgICAgYFdIRVJFICR7cXVldWVDb2x1bW59ID0gJHtkYi5xdW90ZShxdWV1ZSl9IEFORCAke2tleUNvbHVtbn0gSVMgTlVMTCBBTkQgJHtxdWV1ZWR9YFxuICAgICAgKVxuICAgIH1cblxuICAgIGNvbnN0IGNvbmN1cnJlbmN5Um93cyA9IGF3YWl0IGRiXG4gICAgICAubmV3UXVlcnkoKVxuICAgICAgLmZyb20oQ09OQ1VSUkVOQ1lfVEFCTEUpXG4gICAgICAuc2VsZWN0KFwiY29uY3VycmVuY3lfa2V5XCIpXG4gICAgICAud2hlcmUoYCR7ZGIucXVvdGVDb2x1bW4oXCJjb25jdXJyZW5jeV9rZXlcIil9IExJS0UgJHtkYi5xdW90ZShgJHtRVUVVRV9DT05DVVJSRU5DWV9LRVlfUFJFRklYfSVgKX1gKVxuICAgICAgLnJlc3VsdHMoKVxuXG4gICAgZm9yIChjb25zdCByb3cgb2YgY29uY3VycmVuY3lSb3dzKSB7XG4gICAgICBjb25zdCBjb25jdXJyZW5jeUtleSA9IFN0cmluZygvKiogQHR5cGUge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gKi8gKHJvdykuY29uY3VycmVuY3lfa2V5KVxuXG4gICAgICBpZiAoIWNvbmN1cnJlbmN5S2V5LnN0YXJ0c1dpdGgoUVVFVUVfQ09OQ1VSUkVOQ1lfS0VZX1BSRUZJWCkpIGNvbnRpbnVlXG4gICAgICBpZiAoY2FwcGVkUXVldWVzLmhhcyhjb25jdXJyZW5jeUtleS5zbGljZShRVUVVRV9DT05DVVJSRU5DWV9LRVlfUFJFRklYLmxlbmd0aCkpKSBjb250aW51ZVxuXG4gICAgICBhd2FpdCBkYi5xdWVyeShcbiAgICAgICAgYFVQREFURSAke2pvYnNUYWJsZX0gU0VUICR7a2V5Q29sdW1ufSA9IE5VTEwsICR7Y2FwQ29sdW1ufSA9IE5VTEwgYCArXG4gICAgICAgIGBXSEVSRSAke2tleUNvbHVtbn0gPSAke2RiLnF1b3RlKGNvbmN1cnJlbmN5S2V5KX0gQU5EICR7cXVldWVkfWBcbiAgICAgIClcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogUnVucyBub3JtYWxpemUgbnVtYmVyLlxuICAgKiBAcGFyYW0ge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSB2YWx1ZSAtIElucHV0IHZhbHVlLlxuICAgKiBAcmV0dXJucyB7bnVtYmVyIHwgbnVsbH0gLSBOb3JtYWxpemVkIG51bWJlci5cbiAgICovXG4gIF9ub3JtYWxpemVOdW1iZXIodmFsdWUpIHtcbiAgICBpZiAodmFsdWUgPT09IG51bGwgfHwgdmFsdWUgPT09IHVuZGVmaW5lZCB8fCB2YWx1ZSA9PT0gXCJcIikgcmV0dXJuIG51bGxcblxuICAgIGNvbnN0IG51bWVyaWMgPSBOdW1iZXIodmFsdWUpXG5cbiAgICBpZiAoTnVtYmVyLmlzTmFOKG51bWVyaWMpKSByZXR1cm4gbnVsbFxuXG4gICAgcmV0dXJuIG51bWVyaWNcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIG5vcm1hbGl6ZSBleGVjdXRpb24gbW9kZS5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL3R5cGVzLmpzXCIpLkJhY2tncm91bmRKb2JPcHRpb25zfSBbb3B0aW9uc10gLSBKb2Igb3B0aW9ucy5cbiAgICogQHJldHVybnMge2ltcG9ydChcIi4vdHlwZXMuanNcIikuQmFja2dyb3VuZEpvYkV4ZWN1dGlvbk1vZGV9IC0gTm9ybWFsaXplZCBleGVjdXRpb24gbW9kZS5cbiAgICovXG4gIF9ub3JtYWxpemVFeGVjdXRpb25Nb2RlKG9wdGlvbnMpIHtcbiAgICByZXR1cm4gbm9ybWFsaXplQmFja2dyb3VuZEpvYkV4ZWN1dGlvbk1vZGUob3B0aW9ucyB8fCB7fSwgREVGQVVMVF9CQUNLR1JPVU5EX0pPQl9FWEVDVVRJT05fTU9ERSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIG5vcm1hbGl6ZSBleGVjdXRpb24gbW9kZSBuYW1lLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gZXhlY3V0aW9uTW9kZSAtIEV4ZWN1dGlvbiBtb2RlIG5hbWUuXG4gICAqIEByZXR1cm5zIHtpbXBvcnQoXCIuL3R5cGVzLmpzXCIpLkJhY2tncm91bmRKb2JFeGVjdXRpb25Nb2RlfSAtIE5vcm1hbGl6ZWQgZXhlY3V0aW9uIG1vZGUuXG4gICAqL1xuICBfbm9ybWFsaXplRXhlY3V0aW9uTW9kZU5hbWUoZXhlY3V0aW9uTW9kZSkge1xuICAgIHJldHVybiBub3JtYWxpemVCYWNrZ3JvdW5kSm9iRXhlY3V0aW9uTW9kZShcbiAgICAgIHtleGVjdXRpb25Nb2RlOiAvKiogQHR5cGUge2ltcG9ydChcIi4vdHlwZXMuanNcIikuQmFja2dyb3VuZEpvYkV4ZWN1dGlvbk1vZGV9ICovIChleGVjdXRpb25Nb2RlKX0sXG4gICAgICBERUZBVUxUX0JBQ0tHUk9VTkRfSk9CX0VYRUNVVElPTl9NT0RFLFxuICAgICAgQkFDS0dST1VORF9KT0JfRVhFQ1VUSU9OX01PREVTXG4gICAgKVxuICB9XG5cbiAgLyoqXG4gICAqIEZpbHRlcnMgcXVldWVkIGpvYnMgYnkgb25lIG9yIG1vcmUgZXhlY3V0aW9uIG1vZGVzIGFnYWluc3QgdGhlXG4gICAqIGBleGVjdXRpb25fbW9kZWAgY29sdW1uICh0aGUgc2luZ2xlIHNvdXJjZSBvZiB0cnV0aCkuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gT3B0aW9ucy5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9kYXRhYmFzZS9kcml2ZXJzL2Jhc2UuanNcIikuZGVmYXVsdH0gYXJncy5kYiAtIERhdGFiYXNlIGNvbm5lY3Rpb24uXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi90eXBlcy5qc1wiKS5CYWNrZ3JvdW5kSm9iRXhlY3V0aW9uTW9kZSB8IGltcG9ydChcIi4vdHlwZXMuanNcIikuQmFja2dyb3VuZEpvYkV4ZWN1dGlvbk1vZGVbXX0gYXJncy5leGVjdXRpb25Nb2RlIC0gUnVudGltZSBtb2Rlcy5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9kYXRhYmFzZS9xdWVyeS9pbmRleC5qc1wiKS5kZWZhdWx0fSBhcmdzLnF1ZXJ5IC0gUXVlcnkgdG8gZmlsdGVyLlxuICAgKiBAcmV0dXJucyB7aW1wb3J0KFwiLi4vZGF0YWJhc2UvcXVlcnkvaW5kZXguanNcIikuZGVmYXVsdH0gLSBGaWx0ZXJlZCBxdWVyeS5cbiAgICovXG4gIF93aGVyZUV4ZWN1dGlvbk1vZGUoe2RiLCBleGVjdXRpb25Nb2RlLCBxdWVyeX0pIHtcbiAgICBjb25zdCBleGVjdXRpb25Nb2RlcyA9IEFycmF5LmlzQXJyYXkoZXhlY3V0aW9uTW9kZSkgPyBleGVjdXRpb25Nb2RlIDogW2V4ZWN1dGlvbk1vZGVdXG4gICAgY29uc3QgZXhlY3V0aW9uTW9kZUNvbHVtbiA9IGRiLnF1b3RlQ29sdW1uKFwiZXhlY3V0aW9uX21vZGVcIilcbiAgICBjb25zdCBjb25kaXRpb25zID0gZXhlY3V0aW9uTW9kZXMubWFwKChtb2RlKSA9PiBgJHtleGVjdXRpb25Nb2RlQ29sdW1ufSA9ICR7ZGIucXVvdGUobW9kZSl9YClcblxuICAgIHJldHVybiBxdWVyeS53aGVyZShgKCR7Y29uZGl0aW9ucy5qb2luKFwiIE9SIFwiKX0pYClcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHBhcnNlIGFyZ3MuXG4gICAqIEBwYXJhbSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59IHZhbHVlIC0gSW5wdXQgdmFsdWUuXG4gICAqIEByZXR1cm5zIHtBcnJheTxSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59IC0gUGFyc2VkIGFyZ3MuXG4gICAqL1xuICBfcGFyc2VBcmdzKHZhbHVlKSB7XG4gICAgaWYgKCF2YWx1ZSkgcmV0dXJuIFtdXG5cbiAgICB0cnkge1xuICAgICAgY29uc3QgcGFyc2VkID0gSlNPTi5wYXJzZShTdHJpbmcodmFsdWUpKVxuXG4gICAgICBpZiAoQXJyYXkuaXNBcnJheShwYXJzZWQpKSByZXR1cm4gcGFyc2VkXG4gICAgfSBjYXRjaCB7XG4gICAgICAvLyBJZ25vcmUgcGFyc2UgZXJyb3JzLlxuICAgIH1cblxuICAgIHJldHVybiBbXVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgd2l0aCBkYi5cbiAgICogQHRlbXBsYXRlIFRcbiAgICogQHBhcmFtIHsoZGI6IGltcG9ydChcIi4uL2RhdGFiYXNlL2RyaXZlcnMvYmFzZS5qc1wiKS5kZWZhdWx0KSA9PiBQcm9taXNlPFQ+fSBjYWxsYmFjayAtIENhbGxiYWNrLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxUPn0gLSBDYWxsYmFjayByZXN1bHQuXG4gICAqL1xuICBhc3luYyBfd2l0aERiKGNhbGxiYWNrKSB7XG4gICAgY29uc3QgZGF0YWJhc2VJZGVudGlmaWVyID0gdGhpcy5nZXREYXRhYmFzZUlkZW50aWZpZXIoKVxuICAgIGNvbnN0IHBvb2wgPSB0aGlzLmNvbmZpZ3VyYXRpb24uZ2V0RGF0YWJhc2VQb29sKGRhdGFiYXNlSWRlbnRpZmllcilcblxuICAgIGlmICghcG9vbC50ZXN0U2hhcmVkQ29ubmVjdGlvbigpKSB7XG4gICAgICByZXR1cm4gYXdhaXQgcG9vbC53aXRoQ29ubmVjdGlvbih7bmFtZTogXCJCYWNrZ3JvdW5kIGpvYnMgc3RvcmVcIn0sIGNhbGxiYWNrKVxuICAgIH1cblxuICAgIHJldHVybiBhd2FpdCB0aGlzLmNvbmZpZ3VyYXRpb24ucnVuV2l0aFRlc3RTaGFyZWRDb25uZWN0aW9uQ29udGV4dHMoYXN5bmMgKCkgPT4ge1xuICAgICAgcmV0dXJuIGF3YWl0IHRoaXMuY29uZmlndXJhdGlvbi5lbnN1cmVDb25uZWN0aW9ucyh7ZGF0YWJhc2VJZGVudGlmaWVyczogW2RhdGFiYXNlSWRlbnRpZmllcl0sIG5hbWU6IFwiQmFja2dyb3VuZCBqb2JzIHN0b3JlXCJ9LCBhc3luYyAoZGJzKSA9PiB7XG4gICAgICAgIGNvbnN0IGNvbm5lY3Rpb24gPSBkYnNbZGF0YWJhc2VJZGVudGlmaWVyXVxuICAgICAgICByZXR1cm4gYXdhaXQgY29vcmRpbmF0ZVNoYXJlZFRyYW5zYWN0aW9uQ29ubmVjdGlvbihjb25uZWN0aW9uLCBhc3luYyAoKSA9PiBhd2FpdCBjYWxsYmFjayhjb25uZWN0aW9uKSlcbiAgICAgIH0pXG4gICAgfSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGEgdmFsdWUtcmV0dXJuaW5nIGNhbGxiYWNrIGluc2lkZSB0aGUgZHJpdmVyJ3Mgdm9pZC10eXBlZCB0cmFuc2FjdGlvbiBBUEkuXG4gICAqIEB0ZW1wbGF0ZSBUXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vZGF0YWJhc2UvZHJpdmVycy9iYXNlLmpzXCIpLmRlZmF1bHR9IGRiIC0gRGF0YWJhc2UgY29ubmVjdGlvbi5cbiAgICogQHBhcmFtIHsoKSA9PiBQcm9taXNlPFQ+fSBjYWxsYmFjayAtIFRyYW5zYWN0aW9uIGNhbGxiYWNrLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxUPn0gLSBDYWxsYmFjayByZXN1bHQuXG4gICAqL1xuICBhc3luYyBfdHJhbnNhY3Rpb25SZXN1bHQoZGIsIGNhbGxiYWNrKSB7XG4gICAgbGV0IGNvbXBsZXRlZCA9IGZhbHNlXG4gICAgLyoqIEB0eXBlIHtUIHwgdW5kZWZpbmVkfSAqL1xuICAgIGxldCByZXN1bHRcbiAgICBhd2FpdCBkYi50cmFuc2FjdGlvbihhc3luYyAoKSA9PiB7XG4gICAgICByZXN1bHQgPSBhd2FpdCBjYWxsYmFjaygpXG4gICAgICBjb21wbGV0ZWQgPSB0cnVlXG4gICAgfSlcbiAgICBpZiAoIWNvbXBsZXRlZCkgdGhyb3cgbmV3IEVycm9yKFwiQmFja2dyb3VuZCBqb2JzIHRyYW5zYWN0aW9uIGNhbGxiYWNrIHdhcyBub3QgaW52b2tlZFwiKVxuICAgIHJldHVybiAvKiogQHR5cGUge1R9ICovIChyZXN1bHQpXG4gIH1cblxuICAvKipcbiAgICogU2VyaWFsaXplcyBjb3VudC1jaGFuZ2luZyB0cmFuc2FjdGlvbnMgYmVmb3JlIGNoZWNraW5nIG91dCB0aGVpciBjb25uZWN0aW9uLlxuICAgKiBEYXRhYmFzZSByb3cgbG9ja2luZyBzdGlsbCBwcm92aWRlcyBjcm9zcy1wcm9jZXNzIG9yZGVyaW5nOyB0aGlzIGd1YXJkXG4gICAqIHByZXZlbnRzIGNvbmN1cnJlbnQgY2FsbGVycyBvbiBTUUxpdGUncyBzaGFyZWQgY29ubmVjdGlvbiBmcm9tIGF0dGVtcHRpbmdcbiAgICogb3ZlcmxhcHBpbmcgdG9wLWxldmVsIHRyYW5zYWN0aW9ucy5cbiAgICogQHRlbXBsYXRlIFRcbiAgICogQHBhcmFtIHsoZGI6IGltcG9ydChcIi4uL2RhdGFiYXNlL2RyaXZlcnMvYmFzZS5qc1wiKS5kZWZhdWx0KSA9PiBQcm9taXNlPFQ+fSBjYWxsYmFjayAtIFRyYW5zYWN0aW9uIGNhbGxiYWNrLlxuICAgKiBAcGFyYW0ge0JhY2tncm91bmRKb2JUcmFuc2FjdGlvblNlcmlhbGl6YXRpb25PcHRpb25zfSBbb3B0aW9uc10gLSBTZXJpYWxpemF0aW9uIG9wdGlvbnMuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPFQ+fSBDYWxsYmFjayByZXN1bHQuXG4gICAqL1xuICBhc3luYyBfc2VyaWFsaXplZENvdW50TXV0YXRpb24oY2FsbGJhY2ssIG9wdGlvbnMgPSB7fSkge1xuICAgIHJldHVybiBhd2FpdCB0aGlzLl9zZXJpYWxpemVkVHJhbnNhY3Rpb25NdXRhdGlvbihhc3luYyAoZGIpID0+IHtcbiAgICAgIGF3YWl0IHRoaXMuX2xvY2tDb3VudFJldmlzaW9uKGRiKVxuXG4gICAgICByZXR1cm4gYXdhaXQgY2FsbGJhY2soZGIpXG4gICAgfSwgb3B0aW9ucylcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGEgc2VyaWFsaXplZCBjYWxsYmFjayBpbnNpZGUgb25lIHRyYW5zYWN0aW9uLlxuICAgKiBAdGVtcGxhdGUgVFxuICAgKiBAcGFyYW0geyhkYjogaW1wb3J0KFwiLi4vZGF0YWJhc2UvZHJpdmVycy9iYXNlLmpzXCIpLmRlZmF1bHQpID0+IFByb21pc2U8VD59IGNhbGxiYWNrIC0gVHJhbnNhY3Rpb24gY2FsbGJhY2suXG4gICAqIEBwYXJhbSB7QmFja2dyb3VuZEpvYlRyYW5zYWN0aW9uU2VyaWFsaXphdGlvbk9wdGlvbnN9IFtvcHRpb25zXSAtIFNlcmlhbGl6YXRpb24gb3B0aW9ucy5cbiAgICogQHJldHVybnMge1Byb21pc2U8VD59IENhbGxiYWNrIHJlc3VsdC5cbiAgICovXG4gIGFzeW5jIF9zZXJpYWxpemVkVHJhbnNhY3Rpb25NdXRhdGlvbihjYWxsYmFjaywgb3B0aW9ucyA9IHt9KSB7XG4gICAgcmV0dXJuIGF3YWl0IHRoaXMuX3NlcmlhbGl6ZWRDb25uZWN0aW9uTXV0YXRpb24oXG4gICAgICBhc3luYyAoZGIpID0+IGF3YWl0IHRoaXMuX3RyYW5zYWN0aW9uUmVzdWx0KGRiLCBhc3luYyAoKSA9PiBhd2FpdCBjYWxsYmFjayhkYikpLFxuICAgICAgb3B0aW9uc1xuICAgIClcbiAgfVxuXG4gIC8qKlxuICAgKiBBZG1pdHMgbXV0YXRpb24gY2FsbGJhY2tzIHRvIHRoZSBwcm9jZXNzLWxvY2FsIEZJRk8gYmVmb3JlIHRoZXkgY2hlY2sgb3V0IGFcbiAgICogY29ubmVjdGlvbi4gQ3Jvc3MtcHJvY2VzcyBvcmRlcmluZyByZW1haW5zIHRoZSByZXNwb25zaWJpbGl0eSBvZiBkdXJhYmxlXG4gICAqIHJvdy9hZHZpc29yeSBsb2NrcyBhbmQgdW5pcXVlIGNvbnN0cmFpbnRzIGFjcXVpcmVkIGFyb3VuZCB0aGUgY2FsbGJhY2suXG4gICAqIEB0ZW1wbGF0ZSBUXG4gICAqIEBwYXJhbSB7KGRiOiBpbXBvcnQoXCIuLi9kYXRhYmFzZS9kcml2ZXJzL2Jhc2UuanNcIikuZGVmYXVsdCkgPT4gUHJvbWlzZTxUPn0gY2FsbGJhY2sgLSBDb25uZWN0aW9uIGNhbGxiYWNrLlxuICAgKiBAcGFyYW0ge0JhY2tncm91bmRKb2JUcmFuc2FjdGlvblNlcmlhbGl6YXRpb25PcHRpb25zfSBbb3B0aW9uc10gLSBTZXJpYWxpemF0aW9uIG9wdGlvbnMuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPFQ+fSBDYWxsYmFjayByZXN1bHQuXG4gICAqL1xuICBhc3luYyBfc2VyaWFsaXplZENvbm5lY3Rpb25NdXRhdGlvbihjYWxsYmFjaywgb3B0aW9ucyA9IHt9KSB7XG4gICAgY29uc3QgaWRlbnRpZmllciA9IHRoaXMuZ2V0RGF0YWJhc2VJZGVudGlmaWVyKCkgfHwgXCJkZWZhdWx0XCJcbiAgICBjb25zdCBwcmV2aW91cyA9IHRyYW5zYWN0aW9uTXV0YXRpb25DaGFpbnMuZ2V0KGlkZW50aWZpZXIpIHx8IFByb21pc2UucmVzb2x2ZSgpXG4gICAgbGV0IHJlc29sdmVSdW4gPSAoKSA9PiB7fVxuICAgIC8qKiBAdHlwZSB7UHJvbWlzZTx2b2lkPn0gKi9cbiAgICBjb25zdCBydW4gPSBuZXcgUHJvbWlzZSgocmVzb2x2ZSkgPT4ge1xuICAgICAgcmVzb2x2ZVJ1biA9ICgpID0+IHJlc29sdmUodW5kZWZpbmVkKVxuICAgIH0pXG4gICAgY29uc3QgY2hhaW4gPSBwcmV2aW91cy50aGVuKCgpID0+IHJ1bilcblxuICAgIHRyYW5zYWN0aW9uTXV0YXRpb25DaGFpbnMuc2V0KGlkZW50aWZpZXIsIGNoYWluKVxuICAgIGF3YWl0IHByZXZpb3VzXG5cbiAgICB0cnkge1xuICAgICAgcmV0dXJuIGF3YWl0IHRoaXMuX3dpdGhEYihhc3luYyAoZGIpID0+IHtcbiAgICAgICAgY29uc3Qge2Fkdmlzb3J5TG9ja30gPSBvcHRpb25zXG5cbiAgICAgICAgaWYgKGFkdmlzb3J5TG9jaykge1xuICAgICAgICAgIGNvbnN0IGFjcXVpcmVkID0gYXdhaXQgZGIuYWNxdWlyZUFkdmlzb3J5TG9jayhhZHZpc29yeUxvY2submFtZSlcblxuICAgICAgICAgIGlmICghYWNxdWlyZWQpIHRocm93IG5ldyBFcnJvcihhZHZpc29yeUxvY2suZmFpbHVyZU1lc3NhZ2UpXG4gICAgICAgIH1cblxuICAgICAgICB0cnkge1xuICAgICAgICAgIHJldHVybiBhd2FpdCBjYWxsYmFjayhkYilcbiAgICAgICAgfSBmaW5hbGx5IHtcbiAgICAgICAgICBpZiAoYWR2aXNvcnlMb2NrKSBhd2FpdCBkYi5yZWxlYXNlQWR2aXNvcnlMb2NrKGFkdmlzb3J5TG9jay5uYW1lKVxuICAgICAgICB9XG4gICAgICB9KVxuICAgIH0gZmluYWxseSB7XG4gICAgICByZXNvbHZlUnVuKClcbiAgICAgIGlmICh0cmFuc2FjdGlvbk11dGF0aW9uQ2hhaW5zLmdldChpZGVudGlmaWVyKSA9PT0gY2hhaW4pIHRyYW5zYWN0aW9uTXV0YXRpb25DaGFpbnMuZGVsZXRlKGlkZW50aWZpZXIpXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgc2hvdWxkIGFjY2VwdCByZXBvcnQuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gT3B0aW9ucy5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL3R5cGVzLmpzXCIpLkJhY2tncm91bmRKb2JSb3d9IGFyZ3Muam9iIC0gSm9iIHJvdy5cbiAgICogQHBhcmFtIHtzdHJpbmcgfCBudWxsIHwgdW5kZWZpbmVkfSBhcmdzLmhhbmRvZmZJZCAtIEhhbmRvZmYgbGVhc2UgaWQgZnJvbSByZXBvcnQuXG4gICAqIEBwYXJhbSB7c3RyaW5nIHwgbnVsbCB8IHVuZGVmaW5lZH0gYXJncy53b3JrZXJJZCAtIFdvcmtlciBpZCBmcm9tIHJlcG9ydC5cbiAgICogQHBhcmFtIHtudW1iZXIgfCBudWxsIHwgdW5kZWZpbmVkfSBhcmdzLmhhbmRlZE9mZkF0TXMgLSBIYW5kZWQgb2ZmIHRpbWVzdGFtcCBmcm9tIHJlcG9ydC5cbiAgICogQHJldHVybnMge2Jvb2xlYW59IC0gV2hldGhlciB0byBhY2NlcHQgdGhlIHJlcG9ydC5cbiAgICovXG4gIF9zaG91bGRBY2NlcHRSZXBvcnQoe2pvYiwgaGFuZG9mZklkLCB3b3JrZXJJZCwgaGFuZGVkT2ZmQXRNc30pIHtcbiAgICBpZiAoam9iLnN0YXR1cyAhPT0gXCJoYW5kZWRfb2ZmXCIpIHJldHVybiBmYWxzZVxuXG4gICAgcmV0dXJuIHRoaXMuX2hhbmRvZmZJZFJlcG9ydE1hdGNoZXMoe2hhbmRvZmZJZCwgam9ifSlcbiAgICAgICYmIHRoaXMuX3dvcmtlclJlcG9ydE1hdGNoZXMoe2pvYiwgd29ya2VySWR9KVxuICAgICAgJiYgdGhpcy5faGFuZG9mZlJlcG9ydE1hdGNoZXMoe2hhbmRlZE9mZkF0TXMsIGpvYn0pXG4gIH1cblxuICAvKipcbiAgICogUnVucyBhY3RpdmUgaGFuZG9mZiBjb25kaXRpb25zLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vdHlwZXMuanNcIikuQmFja2dyb3VuZEpvYlJvd30gam9iIC0gSm9iIHJvdy5cbiAgICogQHJldHVybnMge1JlY29yZDxzdHJpbmcsIHN0cmluZyB8IG51bGw+fSAtIENvbmRpdGlvbmFsIHRyYW5zaXRpb24gZmVuY2UuXG4gICAqL1xuICBfYWN0aXZlSGFuZG9mZkNvbmRpdGlvbnMoam9iKSB7XG4gICAgcmV0dXJuIHtoYW5kb2ZmX2lkOiBqb2IuaGFuZG9mZklkLCBpZDogam9iLmlkLCBzdGF0dXM6IFwiaGFuZGVkX29mZlwifVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgaGFuZG9mZiBpZCByZXBvcnQgbWF0Y2hlcy5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBPcHRpb25zLlxuICAgKiBAcGFyYW0ge3N0cmluZyB8IG51bGwgfCB1bmRlZmluZWR9IGFyZ3MuaGFuZG9mZklkIC0gSGFuZG9mZiBsZWFzZSBpZCBmcm9tIHJlcG9ydC5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL3R5cGVzLmpzXCIpLkJhY2tncm91bmRKb2JSb3d9IGFyZ3Muam9iIC0gSm9iIHJvdy5cbiAgICogQHJldHVybnMge2Jvb2xlYW59IC0gV2hldGhlciB0aGUgaGFuZG9mZiBsZWFzZSBtYXRjaGVzLlxuICAgKi9cbiAgX2hhbmRvZmZJZFJlcG9ydE1hdGNoZXMoe2hhbmRvZmZJZCwgam9ifSkge1xuICAgIGlmICgham9iLmhhbmRvZmZJZCkgcmV0dXJuIHRydWVcblxuICAgIHJldHVybiBoYW5kb2ZmSWQgPT09IGpvYi5oYW5kb2ZmSWRcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHdvcmtlciByZXBvcnQgbWF0Y2hlcy5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBPcHRpb25zLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vdHlwZXMuanNcIikuQmFja2dyb3VuZEpvYlJvd30gYXJncy5qb2IgLSBKb2Igcm93LlxuICAgKiBAcGFyYW0ge3N0cmluZyB8IG51bGwgfCB1bmRlZmluZWR9IGFyZ3Mud29ya2VySWQgLSBXb3JrZXIgaWQgZnJvbSByZXBvcnQuXG4gICAqIEByZXR1cm5zIHtib29sZWFufSAtIFdoZXRoZXIgdGhlIHdvcmtlciByZXBvcnQgbWF0Y2hlcy5cbiAgICovXG4gIF93b3JrZXJSZXBvcnRNYXRjaGVzKHtqb2IsIHdvcmtlcklkfSkge1xuICAgIGlmICghd29ya2VySWQpIHJldHVybiB0cnVlXG4gICAgaWYgKCFqb2Iud29ya2VySWQpIHJldHVybiB0cnVlXG5cbiAgICByZXR1cm4gd29ya2VySWQgPT09IGpvYi53b3JrZXJJZFxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgaGFuZG9mZiByZXBvcnQgbWF0Y2hlcy5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBPcHRpb25zLlxuICAgKiBAcGFyYW0ge251bWJlciB8IG51bGwgfCB1bmRlZmluZWR9IGFyZ3MuaGFuZGVkT2ZmQXRNcyAtIEhhbmRlZCBvZmYgdGltZXN0YW1wIGZyb20gcmVwb3J0LlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vdHlwZXMuanNcIikuQmFja2dyb3VuZEpvYlJvd30gYXJncy5qb2IgLSBKb2Igcm93LlxuICAgKiBAcmV0dXJucyB7Ym9vbGVhbn0gLSBXaGV0aGVyIHRoZSBoYW5kb2ZmIHJlcG9ydCBtYXRjaGVzLlxuICAgKi9cbiAgX2hhbmRvZmZSZXBvcnRNYXRjaGVzKHtoYW5kZWRPZmZBdE1zLCBqb2J9KSB7XG4gICAgaWYgKCFoYW5kZWRPZmZBdE1zKSByZXR1cm4gdHJ1ZVxuICAgIGlmICgham9iLmhhbmRlZE9mZkF0TXMpIHJldHVybiB0cnVlXG5cbiAgICByZXR1cm4gaGFuZGVkT2ZmQXRNcyA9PT0gam9iLmhhbmRlZE9mZkF0TXNcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIG1pZ3JhdGlvbiBrZXkuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBbdmVyc2lvbl0gLSBNaWdyYXRpb24gdmVyc2lvbi5cbiAgICogQHJldHVybnMge3N0cmluZ30gLSBNaWdyYXRpb24ga2V5LlxuICAgKi9cbiAgX21pZ3JhdGlvbktleSh2ZXJzaW9uID0gTUlHUkFUSU9OX1ZFUlNJT04pIHtcbiAgICByZXR1cm4gYCR7TUlHUkFUSU9OX1NDT1BFfToke3ZlcnNpb259YFxuICB9XG59XG4iXX0=