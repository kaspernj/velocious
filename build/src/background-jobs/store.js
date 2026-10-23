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
 * @property {number} priority - Dispatch priority within the queue.
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
const BACKGROUND_JOB_PRIORITY_VALIDATION_MESSAGE = "background job priority must be a non-negative integer";
const ORPHANED_AFTER_MS = 2 * 60 * 60 * 1000;
/**
 * Priority a job is demoted to when it is re-queued after a failed attempt.
 * A retry has already consumed capacity and time, so it must never overtake
 * work that has not had its first chance yet. Enqueue priorities are validated
 * to be non-negative integers, which makes `-1` the lowest reachable priority.
 */
export const RETRY_BACKGROUND_JOB_PRIORITY = -1;
/**
 * Priority a job gets when the producer does not ask for one.
 */
export const DEFAULT_BACKGROUND_JOB_PRIORITY = 0;
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
            // Job-level priority applies inside the queue ranking above. A retry is
            // stored at RETRY_BACKGROUND_JOB_PRIORITY (-1), so it sorts behind every
            // first attempt without delaying itself further than the backoff already
            // does. COALESCE covers rows written before the column existed.
            query = query.order(`COALESCE(${db.quoteColumn("priority")}, ${DEFAULT_BACKGROUND_JOB_PRIORITY}) DESC`);
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
            priority: this._normalizeJobPriority(options),
            queue,
            scheduledAtMs: this._normalizeScheduledAtMs(options?.scheduledAtMs, createdAtMs),
            timeoutMs: this._normalizeJobTimeoutMs(options)
        };
    }
    /**
     * Normalizes a requested dispatch priority. Priorities order jobs within their
     * queue on the dispatch path only: higher goes first, and the default keeps
     * FIFO order. Negative priorities are rejected because the store reserves them
     * for {@link RETRY_BACKGROUND_JOB_PRIORITY}, which must stay the lowest.
     * @param {import("./types.js").BackgroundJobOptions | undefined} options - Job options.
     * @returns {number} - Priority.
     */
    _normalizeJobPriority(options) {
        const priority = options?.priority;
        if (priority === undefined)
            return DEFAULT_BACKGROUND_JOB_PRIORITY;
        if (typeof priority !== "number" || !Number.isInteger(priority) || priority < 0) {
            throw VelociousError.safe(BACKGROUND_JOB_PRIORITY_VALIDATION_MESSAGE);
        }
        return priority;
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
                priority: preparedJob.priority,
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
        const priorityLockName = `${MIGRATION_SCOPE}:priority_column`;
        const priorityLockAcquired = await db.acquireAdvisoryLock(priorityLockName);
        if (!priorityLockAcquired)
            throw new Error("Failed to acquire background jobs priority schema lock");
        try {
            db.clearSchemaCache();
            const priorityTable = await db.getTableByNameOrFail(JOBS_TABLE);
            if (!(await priorityTable.getColumnByName("priority"))) {
                const tableData = new TableData(JOBS_TABLE);
                tableData.bigint("priority", { null: true });
                const sqls = await db.alterTableSQLs(tableData);
                for (const sql of sqls) {
                    await db.query(sql);
                }
                db.clearSchemaCache();
            }
        }
        finally {
            await db.releaseAdvisoryLock(priorityLockName);
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
            transitionedJob.priority = RETRY_BACKGROUND_JOB_PRIORITY;
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
        if (shouldRetry) {
            Object.assign(update, this._clearedChildAcceptanceData());
            // Retried work goes to the back of the dispatch order. It has already had
            // a turn, and letting it overtake first attempts is how a failing producer
            // starves healthy jobs of the same queue.
            update.priority = RETRY_BACKGROUND_JOB_PRIORITY;
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
            scheduleOrder: this._normalizeNumber(row.schedule_order),
            status: normalizeBackgroundJobStatus(row.status ? String(row.status) : "queued"),
            attempts: this._normalizeNumber(row.attempts),
            maxRetries: this._normalizeNumber(row.max_retries),
            priority: this._normalizeNumber(row.priority) ?? DEFAULT_BACKGROUND_JOB_PRIORITY,
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoic3RvcmUuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi9zcmMvYmFja2dyb3VuZC1qb2JzL3N0b3JlLmpzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiJBQUFBLFlBQVk7QUFFWixPQUFPLEVBQUMsVUFBVSxFQUFFLFVBQVUsRUFBQyxNQUFNLFFBQVEsQ0FBQTtBQUM3QyxPQUFPLHFCQUFxQixNQUFNLGNBQWMsQ0FBQTtBQUNoRCxPQUFPLE1BQU0sTUFBTSxjQUFjLENBQUE7QUFDakMsT0FBTyxTQUFTLE1BQU0saUNBQWlDLENBQUE7QUFDdkQsT0FBTyxjQUFjLE1BQU0sdUJBQXVCLENBQUE7QUFDbEQsT0FBTyxtQkFBbUIsTUFBTSxpQkFBaUIsQ0FBQTtBQUNqRCxPQUFPLDJCQUEyQixNQUFNLHNCQUFzQixDQUFBO0FBQzlELE9BQU8sRUFBRSxxQ0FBcUMsRUFBRSxNQUFNLHlEQUF5RCxDQUFBO0FBQy9HLE9BQU8sbUJBQW1CLE1BQU0seUJBQXlCLENBQUE7QUFDekQsT0FBTyxFQUNMLGdDQUFnQyxFQUNoQyw4QkFBOEIsRUFDOUIscUNBQXFDLEVBQ3JDLDRCQUE0QixFQUM1Qiw0QkFBNEIsRUFDNUIsaUNBQWlDLEVBQ2pDLG1DQUFtQyxFQUNuQyxnQ0FBZ0MsRUFDaEMsMkJBQTJCLEVBQzNCLGlDQUFpQyxFQUNqQyxtQ0FBbUMsRUFDbkMsNEJBQTRCLEVBQzVCLDRCQUE0QixFQUM1QixZQUFZLEVBQ2IsTUFBTSxvQkFBb0IsQ0FBQTtBQUMzQixPQUFPLEVBQ0wsOEJBQThCLEVBQzlCLDJCQUEyQixFQUMzQix3QkFBd0IsRUFDekIsTUFBTSxpQ0FBaUMsQ0FBQTtBQUV4Qzs7Ozs7Ozs7Ozs7Ozs7R0FjRztBQUVIOzs7OztHQUtHO0FBRUg7Ozs7R0FJRztBQUVIOzs7Ozs7OztHQVFHO0FBRUg7Ozs7O0dBS0c7QUFFSDs7Ozs7R0FLRztBQUVILE1BQU0sZ0JBQWdCLEdBQUcsK0JBQStCLENBQUE7QUFDeEQsTUFBTSxlQUFlLEdBQUcsaUJB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SSxFQUFFLEtBQUssRUFBRSxJQUFJLEVBQUMsQ0FBQyxDQUFBO1FBQ3ZELEtBQUssQ0FBQyxNQUFNLENBQUMsZ0JBQWdCLEVBQUUsRUFBQyxJQUFJLEVBQUUsSUFBSSxFQUFDLENBQUMsQ0FBQTtRQUM1QyxLQUFLLENBQUMsTUFBTSxDQUFDLGtCQUFrQixFQUFFLEVBQUMsSUFBSSxFQUFFLElBQUksRUFBRSxLQUFLLEVBQUUsSUFBSSxFQUFDLENBQUMsQ0FBQTtRQUMzRCxLQUFLLENBQUMsTUFBTSxDQUFDLFlBQVksRUFBRSxFQUFDLElBQUksRUFBRSxJQUFJLEVBQUMsQ0FBQyxDQUFBO1FBQ3hDLEtBQUssQ0FBQyxNQUFNLENBQUMsaUJBQWlCLEVBQUUsRUFBQyxJQUFJLEVBQUUsSUFBSSxFQUFDLENBQUMsQ0FBQTtRQUM3QyxLQUFLLENBQUMsTUFBTSxDQUFDLGNBQWMsRUFBRSxFQUFDLElBQUksRUFBRSxJQUFJLEVBQUMsQ0FBQyxDQUFBO1FBQzFDLEtBQUssQ0FBQyxNQUFNLENBQUMsZ0JBQWdCLEVBQUUsRUFBQyxJQUFJLEVBQUUsSUFBSSxFQUFFLEtBQUssRUFBRSxJQUFJLEVBQUMsQ0FBQyxDQUFBO1FBQ3pELEtBQUssQ0FBQyxNQUFNLENBQUMsV0FBVyxFQUFFLEVBQUMsSUFBSSxFQUFFLElBQUksRUFBQyxDQUFDLENBQUE7UUFDdkMsS0FBSyxDQUFDLElBQUksQ0FBQyxZQUFZLEVBQUUsRUFBQyxJQUFJLEVBQUUsSUFBSSxFQUFDLENBQUMsQ0FBQTtRQUN0QyxLQUFLLENBQUMsTUFBTSxDQUFDLGlCQUFpQixFQUFFLEVBQUMsSUFBSSxFQUFFLElBQUksRUFBRSxLQUFLLEVBQUUsSUFBSSxFQUFDLENBQUMsQ0FBQTtRQUMxRCxLQUFLLENBQUMsT0FBTyxDQUFDLGlCQUFpQixFQUFFLEVBQUMsSUFBSSxFQUFFLElBQUksRUFBQyxDQUFDLENBQUE7UUFDOUMsS0FBSyxDQUFDLE1BQU0sQ0FBQyxZQUFZLEVBQUUsRUFBQyxJQUFJLEVBQUUsSUFBSSxFQUFDLENBQUMsQ0FBQTtRQUN4QyxLQUFL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LEVBQUUsR0FBRyxDQUFDLFNBQVMsRUFBRSxFQUFFLEVBQUUsR0FBRyxDQUFDLEVBQUUsRUFBRSxNQUFNLEVBQUUsWUFBWSxFQUFDLENBQUE7SUFDdEUsQ0FBQztJQUVEOzs7Ozs7T0FNRztJQUNILHVCQUF1QixDQUFDLEVBQUMsU0FBUyxFQUFFLEdBQUcsRUFBQztRQUN0QyxJQUFJLENBQUMsR0FBRyxDQUFDLFNBQVM7WUFBRSxPQUFPLElBQUksQ0FBQTtRQUUvQixPQUFPLFNBQVMsS0FBSyxHQUFHLENBQUMsU0FBUyxDQUFBO0lBQ3BDLENBQUM7SUFFRDs7Ozs7O09BTUc7SUFDSCxvQkFBb0IsQ0FBQyxFQUFDLEdBQUcsRUFBRSxRQUFRLEVBQUM7UUFDbEMsSUFBSSxDQUFDLFFBQVE7WUFBRSxPQUFPLElBQUksQ0FBQTtRQUMxQixJQUFJLENBQUMsR0FBRyxDQUFDLFFBQVE7WUFBRSxPQUFPLElBQUksQ0FBQTtRQUU5QixPQUFPLFFBQVEsS0FBSyxHQUFHLENBQUMsUUFBUSxDQUFBO0lBQ2xDLENBQUM7SUFFRDs7Ozs7O09BTUc7SUFDSCxxQkFBcUIsQ0FBQyxFQUFDLGFBQWEsRUFBRSxHQUFHLEVBQUM7UUFDeEMsSUFBSSxDQUFDLGFBQWE7WUFBRSxPQUFPLElBQUksQ0FBQTtRQUMvQixJQUFJLENBQUMsR0FBRyxDQUFDLGFBQWE7WUFBRSxPQUFPLElBQUksQ0FBQTtRQUVuQyxPQUFPLGFBQWEsS0FBSyxHQUFHLENBQUMsYUFBYSxDQUFBO0lBQzVDLENBQUM7SUFFRDs7OztPQUlHO0lBQ0gsYUFBYSxDQUFDLE9BQU8sR0FBRyxpQkFBaUI7UUFDdkMsT0FBTyxHQUFHLGVBQWUsSUFBSSxPQUFPLEVBQUUsQ0FBQTtJQUN4QyxDQUFDO0NBQ0YiLCJzb3VyY2VzQ29udGVudCI6WyIvLyBAdHMtY2hlY2tcblxuaW1wb3J0IHtjcmVhdGVIYXNoLCByYW5kb21VVUlEfSBmcm9tIFwiY3J5cHRvXCJcbmltcG9ydCBCYWNrZ3JvdW5kSm9ic0FkYXB0ZXIgZnJvbSBcIi4vYWRhcHRlci5qc1wiXG5pbXBvcnQgTG9nZ2VyIGZyb20gXCIuLi9sb2dnZXIuanNcIlxuaW1wb3J0IFRhYmxlRGF0YSBmcm9tIFwiLi4vZGF0YWJhc2UvdGFibGUtZGF0YS9pbmRleC5qc1wiXG5pbXBvcnQgVmVsb2Npb3VzRXJyb3IgZnJvbSBcIi4uL3ZlbG9jaW91cy1lcnJvci5qc1wiXG5pbXBvcnQgQmFja2dyb3VuZEpvYlJlY29yZCBmcm9tIFwiLi9qb2ItcmVjb3JkLmpzXCJcbmltcG9ydCBub3JtYWxpemVCYWNrZ3JvdW5kSm9iRXJyb3IgZnJvbSBcIi4vbm9ybWFsaXplLWVycm9yLmpzXCJcbmltcG9ydCB7IGNvb3JkaW5hdGVTaGFyZWRUcmFuc2FjdGlvbkNvbm5lY3Rpb24gfSBmcm9tIFwiLi4vdGVzdGluZy9zaGFyZWQtdHJhbnNhY3Rpb24tY29ubmVjdGlvbi1jb29yZGluYXRvci5qc1wiXG5pbXBvcnQgc3RhYmxlSnNvblN0cmluZ2lmeSBmcm9tIFwiLi4vdXRpbHMvc3RhYmxlLWpzb24uanNcIlxuaW1wb3J0IHtcbiAgQkFDS0dST1VORF9KT0JfVEVSTUlOQUxfU1RBVFVTRVMsXG4gIEJBQ0tHUk9VTkRfSk9CX0VYRUNVVElPTl9NT0RFUyxcbiAgREVGQVVMVF9CQUNLR1JPVU5EX0pPQl9FWEVDVVRJT05fTU9ERSxcbiAgREVGQVVMVF9CQUNLR1JPVU5EX0pPQl9RVUVVRSxcbiAgUVVFVUVfQ09OQ1VSUkVOQ1lfS0VZX1BSRUZJWCxcbiAgbm9ybWFsaXplQmFja2dyb3VuZEpvYkNvbmN1cnJlbmN5LFxuICBub3JtYWxpemVCYWNrZ3JvdW5kSm9iRXhlY3V0aW9uTW9kZSxcbiAgbm9ybWFsaXplQmFja2dyb3VuZEpvYk1heFJldHJpZXMsXG4gIG5vcm1hbGl6ZUJhY2tncm91bmRKb2JRdWV1ZSxcbiAgbm9ybWFsaXplQmFja2dyb3VuZEpvYlNjaGVkdWxlS2V5LFxuICBub3JtYWxpemVCYWNrZ3JvdW5kSm9iU2NoZWR1bGVkQXRNcyxcbiAgbm9ybWFsaXplQmFja2dyb3VuZEpvYlN0YXR1cyxcbiAgcmVzY2hlZHVsZWRCYWNrZ3JvdW5kSm9iQXRNcyxcbiAgcmV0cnlEZWxheU1zXG59IGZyb20gXCIuL2pvYi1zZW1hbnRpY3MuanNcIlxuaW1wb3J0IHtcbiAgTUFJTF9ERUxJVkVSWV9PUEVSQVRJT05TX1RBQkxFLFxuICBtYWlsRGVsaXZlcnlPcGVyYXRpb25Gb3JKb2IsXG4gIG1haWxEZWxpdmVyeU9wZXJhdGlvbktleVxufSBmcm9tIFwiLi4vbWFpbGVyL2RlbGl2ZXJ5LW9wZXJhdGlvbi5qc1wiXG5cbi8qKlxuICogUHJlcGFyZWRCYWNrZ3JvdW5kSm9iIHR5cGUuXG4gKiBAdHlwZWRlZiB7b2JqZWN0fSBQcmVwYXJlZEJhY2tncm91bmRKb2JcbiAqIEBwcm9wZXJ0eSB7c3RyaW5nfSBhcmdzSnNvbiAtIFNlcmlhbGl6ZWQgYXJndW1lbnRzLlxuICogQHByb3BlcnR5IHt7Y29uY3VycmVuY3lLZXk6IHN0cmluZywgbWF4Q29uY3VycmVuY3k6IG51bWJlciwgcXVldWVEZXJpdmVkOiBib29sZWFufSB8IG51bGx9IGNvbmN1cnJlbmN5IC0gUmVzb2x2ZWQgY29uY3VycmVuY3kuXG4gKiBAcHJvcGVydHkge251bWJlcn0gY3JlYXRlZEF0TXMgLSBDcmVhdGlvbiB0aW1lc3RhbXAuXG4gKiBAcHJvcGVydHkge2ltcG9ydChcIi4vdHlwZXMuanNcIikuQmFja2dyb3VuZEpvYkV4ZWN1dGlvbk1vZGV9IGV4ZWN1dGlvbk1vZGUgLSBFeGVjdXRpb24gbW9kZS5cbiAqIEBwcm9wZXJ0eSB7c3RyaW5nfSBqb2JJZCAtIE5ldyBqb2IgaWQuXG4gKiBAcHJvcGVydHkge3N0cmluZ30gam9iTmFtZSAtIEpvYiBuYW1lLlxuICogQHByb3BlcnR5IHtudW1iZXJ9IG1heFJldHJpZXMgLSBSZXRyeSBjYXAuXG4gKiBAcHJvcGVydHkge251bWJlcn0gcHJpb3JpdHkgLSBEaXNwYXRjaCBwcmlvcml0eSB3aXRoaW4gdGhlIHF1ZXVlLlxuICogQHByb3BlcnR5IHtzdHJpbmd9IHF1ZXVlIC0gUXVldWUgbmFtZS5cbiAqIEBwcm9wZXJ0eSB7bnVtYmVyfSBzY2hlZHVsZWRBdE1zIC0gRWxpZ2liaWxpdHkgdGltZXN0YW1wLlxuICogQHByb3BlcnR5IHtudW1iZXIgfCBudWxsfSB0aW1lb3V0TXMgLSBQZXItam9iIHRpbWVvdXQgb3ZlcnJpZGUsIG9yIG51bGwgd2hlbiBvbWl0dGVkLlxuICovXG5cbi8qKlxuICogQmFja2dyb3VuZEpvYk9ycGhhblNlbGVjdGlvbiB0eXBlLlxuICogQHR5cGVkZWYge29iamVjdH0gQmFja2dyb3VuZEpvYk9ycGhhblNlbGVjdGlvblxuICogQHByb3BlcnR5IHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59IGNvbmRpdGlvbnMgLSBFeGFjdCB1cGRhdGUgZmVuY2UuXG4gKiBAcHJvcGVydHkge2ltcG9ydChcIi4vdHlwZXMuanNcIikuQmFja2dyb3VuZEpvYlJvd30gam9iIC0gU2VsZWN0ZWQgYWN0aXZlIGhhbmRvZmYuXG4gKi9cblxuLyoqXG4gKiBCYWNrZ3JvdW5kSm9iVHJhbnNhY3Rpb25TZXJpYWxpemF0aW9uT3B0aW9ucyB0eXBlLlxuICogQHR5cGVkZWYge29iamVjdH0gQmFja2dyb3VuZEpvYlRyYW5zYWN0aW9uU2VyaWFsaXphdGlvbk9wdGlvbnNcbiAqIEBwcm9wZXJ0eSB7e2ZhaWx1cmVNZXNzYWdlOiBzdHJpbmcsIG5hbWU6IHN0cmluZ319IFthZHZpc29yeUxvY2tdIC0gU2Vzc2lvbiBsb2NrIGhlbGQgYXJvdW5kIHRoZSB0cmFuc2FjdGlvbi5cbiAqL1xuXG4vKipcbiAqIEJhY2tncm91bmRKb2JQcnVuZUNhbmRpZGF0ZU1ldGFkYXRhIHR5cGUuIEltbXV0YWJsZSBtZXRhZGF0YSBmb3Igb25lIHNlbGVjdGVkXG4gKiByZXRlbnRpb24gY2FuZGlkYXRlIGJhdGNoLCBleHBvc2VkIHRvIHRoZSBvcHRpb25hbCBwcnVuZSBiYXJyaWVyIGhvb2suXG4gKiBAdHlwZWRlZiB7b2JqZWN0fSBCYWNrZ3JvdW5kSm9iUHJ1bmVDYW5kaWRhdGVNZXRhZGF0YVxuICogQHByb3BlcnR5IHtSZWFkb25seTxBcnJheTxzdHJpbmc+Pn0gY2FuZGlkYXRlcyAtIEpvYiBpZHMgc2VsZWN0ZWQgZm9yIHRoaXMgYmF0Y2guXG4gKiBAcHJvcGVydHkge3N0cmluZ30gc3RhdHVzIC0gVGVybWluYWwgc3RhdHVzIHRoZSBjYW5kaWRhdGVzIHdlcmUgc2VsZWN0ZWQgYnkuXG4gKiBAcHJvcGVydHkge3N0cmluZ30gY29sdW1uIC0gVGVybWluYWwgdGltZXN0YW1wIGNvbHVtbiBjb21wYXJlZCBhZ2FpbnN0IHRoZSBjdXRvZmYuXG4gKiBAcHJvcGVydHkge251bWJlcn0gY3V0b2ZmIC0gQ3V0b2ZmIHRpbWVzdGFtcCB0aGUgY2FuZGlkYXRlcyB3ZXJlIHNlbGVjdGVkIGFnYWluc3QuXG4gKi9cblxuLyoqXG4gKiBCYWNrZ3JvdW5kSm9iQ29uY3VycmVuY3lDb3VudFJvdyB0eXBlLlxuICogQHR5cGVkZWYge29iamVjdH0gQmFja2dyb3VuZEpvYkNvbmN1cnJlbmN5Q291bnRSb3dcbiAqIEBwcm9wZXJ0eSB7bnVtYmVyIHwgc3RyaW5nfSBhY3RpdmVfY291bnQgLSBQZXJzaXN0ZWQgb3IgYWdncmVnYXRlZCBhY3RpdmUgY291bnQuXG4gKiBAcHJvcGVydHkge3N0cmluZ30gY29uY3VycmVuY3lfa2V5IC0gRHVyYWJsZSBjYXAgaWRlbnRpdHkuXG4gKi9cblxuLyoqXG4gKiBCYWNrZ3JvdW5kSm9iUXVldWVkQ29uY3VycmVuY3kgdHlwZS5cbiAqIEB0eXBlZGVmIHtvYmplY3R9IEJhY2tncm91bmRKb2JRdWV1ZWRDb25jdXJyZW5jeVxuICogQHByb3BlcnR5IHtzdHJpbmcgfCBudWxsfSBjb25jdXJyZW5jeUtleSAtIEN1cnJlbnQgY29uY3VycmVuY3kga2V5IGZvciBxdWV1ZWQgd29yay5cbiAqIEBwcm9wZXJ0eSB7bnVtYmVyIHwgbnVsbH0gbWF4Q29uY3VycmVuY3kgLSBDdXJyZW50IGNvbmN1cnJlbmN5IGNhcCBmb3IgcXVldWVkIHdvcmsuXG4gKi9cblxuY29uc3QgTUlHUkFUSU9OU19UQUJMRSA9IFwidmVsb2Npb3VzX2ludGVybmFsX21pZ3JhdGlvbnNcIlxuY29uc3QgTUlHUkFUSU9OX1NDT1BFID0gXCJiYWNrZ3JvdW5kX2pvYnNcIlxuY29uc3QgTUlHUkFUSU9OX1ZFUlNJT04gPSBcIjIwMjUwMjE1MDAwMDAwXCJcbmNvbnN0IFNDSEVNQV9SRUNPVkVSWV9QRU5ESU5HX1ZFUlNJT04gPSBcInNjaGVtYS1yZWNvdmVyeS1wZW5kaW5nXCJcbmNvbnN0IEVYRUNVVElPTl9NT0RFX0JBQ0tGSUxMX01JR1JBVElPTl9WRVJTSU9OID0gXCIyMDI2MDYwNzEzMTAxMFwiXG4vLyBEcm9wcyB0aGUgcmVkdW5kYW50IGxlZ2FjeSBgZm9ya2VkYCBib29sZWFuIGNvbHVtbiBhbmQgcmV3cml0ZXMgcG9vbGVkIHJvd3MgdG9cbi8vIHBlcnNpc3QgYGV4ZWN1dGlvbl9tb2RlID0gXCJwb29sZWRcImAgZGlyZWN0bHkgKHJldGlyaW5nIHRoZSBwb29sZWQtYXMtZm9ya2VkXG4vLyBoYW5kb2ZmLW1hcmtlciB3b3JrYXJvdW5kKSwgbGVhdmluZyBgZXhlY3V0aW9uX21vZGVgIGFzIHRoZSBzaW5nbGUgc291cmNlIG9mXG4vLyB0cnV0aCBmb3IgYSBqb2IncyBydW50aW1lLlxuY29uc3QgRFJPUF9GT1JLRURfQ09MVU1OX01JR1JBVElPTl9WRVJTSU9OID0gXCIyMDI2MDcxOTAwMDAwMFwiXG5jb25zdCBKT0JTX0lOREVYX1JFUEFJUl9NSUdSQVRJT05fVkVSU0lPTiA9IFwiMjAyNjA5MDMxMjAwMDBcIlxuLy8gTGVnYWN5IG1hcmtlciBwcmVmaXggdXNlZCBieSByb3dzIHdyaXR0ZW4gYmVmb3JlIHRoaXMgbWlncmF0aW9uOiBwb29sZWQgam9ic1xuLy8gdXNlZCB0byBwZXJzaXN0IGFzIGBleGVjdXRpb25fbW9kZSA9IFwiZm9ya2VkXCJgIHBsdXMgYSBgdmVsb2Npb3VzLXBvb2xlZDoqYFxuLy8gaGFuZG9mZiBpZC4gUmV0YWluZWQgb25seSB0byBkZXRlY3QgYW5kIGNvbnZlcnQgdGhvc2Ugcm93cyBpbiB0aGUgbWlncmF0aW9uLlxuY29uc3QgTEVHQUNZX1BPT0xFRF9IQU5ET0ZGX0lEX1BSRUZJWCA9IFwidmVsb2Npb3VzLXBvb2xlZDpcIlxuY29uc3QgTEVHQUNZX1BPT0xFRF9RVUVVRURfSEFORE9GRl9JRCA9IGAke0xFR0FDWV9QT09MRURfSEFORE9GRl9JRF9QUkVGSVh9cXVldWVkYFxuY29uc3QgSk9CU19UQUJMRSA9IFwiYmFja2dyb3VuZF9qb2JzXCJcbmNvbnN0IEpPQlNfSU5ERVhfQ09MVU1OX05BTUVTID0gW1xuICBcImpvYl9uYW1lXCIsXG4gIFwicXVldWVcIixcbiAgXCJzdGF0dXNcIixcbiAgXCJzY2hlZHVsZWRfYXRfbXNcIixcbiAgXCJjcmVhdGVkX2F0X21zXCIsXG4gIFwic2NoZWR1bGVfa2V5XCIsXG4gIFwiaGFuZGVkX29mZl9hdF9tc1wiLFxuICBcIm9ycGhhbmVkX2F0X21zXCIsXG4gIFwiY29uY3VycmVuY3lfa2V5XCJcbl1cbmNvbnN0IElERU1QT1RFTkNZX0tFWVNfVEFCTEUgPSBcImJhY2tncm91bmRfam9iX2lkZW1wb3RlbmN5X2tleXNcIlxuY29uc3QgU0NIRURVTEVfS0VZU19UQUJMRSA9IFwiYmFja2dyb3VuZF9qb2Jfc2NoZWR1bGVfa2V5c1wiXG5jb25zdCBTQ0hFRFVMRV9PUkRFUl9XQVRFUk1BUktTX1RBQkxFID0gXCJiYWNrZ3JvdW5kX2pvYl9zY2hlZHVsZV9vcmRlcl93YXRlcm1hcmtzXCJcbmNvbnN0IFNDSEVEVUxFX09SREVSX1dBVEVSTUFSS19NSUdSQVRJT05fVkVSU0lPTiA9IFwiMjAyNjA5MTExMjAwMDBcIlxuY29uc3QgU0NIRURVTEVfSElTVE9SWV9PUkRFUl9JTkRFWCA9IFwiaW5kZXhfYmFja2dyb3VuZF9qb2JzX3NjaGVkdWxlX2hpc3Rvcnlfb3JkZXJcIlxuLy8gQ29tcG9zaXRlIHJldGVudGlvbiBpbmRleGVzIGJvdW5kIHRoZSB0ZXJtaW5hbC1zdGF0dXMgZGlzY292ZXJ5IHNjYW4gdG8gdGhlIGV4cGlyZWRcbi8vIChzdGF0dXMsIHRlcm1pbmFsX3RpbWVzdGFtcCkgcmFuZ2UsIHNvIHJldGVudGlvbiBjYW5kaWRhdGUgcGFnZXMgc3RheSBjaGVhcCBvblxuLy8gbXVsdGktbWlsbGlvbi1yb3cgdGFibGVzLiBBY3RpdmF0aW9uIHdhcyBzdGFnZWQgc2VwYXJhdGVseSBmcm9tIHRoZSBsb2NrLXNjb3BlIGZpeFxuLy8gYmVjYXVzZSBNYXJpYURCIG9ubGluZSBpbmRleCBEREwgbWFrZXMgY29uY3VycmVudCBtZXRhZGF0YSBpbnNwZWN0aW9uIGZhaWwgd2l0aFxuLy8gRVJfV0FSTl9JX1NfU0tJUFBFRF9UQUJMRTsgdGhlIGRyaXZlciBub3cgb3V0bGFzdHMgdGhhdCBza2lwIHdpdGggYSBib3VuZGVkIHJldHJ5LlxuY29uc3QgUkVURU5USU9OX0lOREVYX01JR1JBVElPTl9WRVJTSU9OID0gXCIyMDI2MTAxMjEyMDAwMFwiXG5jb25zdCBSRVRFTlRJT05fSU5ERVhfREVGSU5JVElPTlMgPSBbXG4gIHtjb2x1bW5zOiBbXCJzdGF0dXNcIiwgXCJjb21wbGV0ZWRfYXRfbXNcIiwgXCJpZFwiXSwgbmFtZTogXCJpbmRleF9iYWNrZ3JvdW5kX2pvYnNfY29tcGxldGVkX3JldGVudGlvblwifSxcbiAge2NvbHVtbnM6IFtcInN0YXR1c1wiLCBcImZhaWxlZF9hdF9tc1wiLCBcImlkXCJdLCBuYW1lOiBcImluZGV4X2JhY2tncm91bmRfam9ic19mYWlsZWRfcmV0ZW50aW9uXCJ9LFxuICB7Y29sdW1uczogW1wic3RhdHVzXCIsIFwib3JwaGFuZWRfYXRfbXNcIiwgXCJpZFwiXSwgbmFtZTogXCJpbmRleF9iYWNrZ3JvdW5kX2pvYnNfb3JwaGFuZWRfcmV0ZW50aW9uXCJ9XG5dXG5jb25zdCBDT05DVVJSRU5DWV9UQUJMRSA9IFwiYmFja2dyb3VuZF9qb2JfY29uY3VycmVuY3lcIlxuY29uc3QgQ09VTlRTX1JFVklTSU9OX1RBQkxFID0gXCJiYWNrZ3JvdW5kX2pvYl9jb3VudF9yZXZpc2lvbnNcIlxuY29uc3QgQ09VTlRTX1JFVklTSU9OX0tFWSA9IFwiY291bnRzXCJcbmNvbnN0IENPTkNVUlJFTkNZX1JFQ09OQ0lMSUFUSU9OX0xPQ0sgPSBcImJhY2tncm91bmQtam9iczpxdWV1ZS1jb25jdXJyZW5jeS1yZWNvbmNpbGVcIlxuY29uc3QgQ09OQ1VSUkVOQ1lfUkVQQUlSX1NBTVBMRV9MSU1JVCA9IDEwXG5leHBvcnQgY29uc3QgQkFDS0dST1VORF9KT0JfQ09VTlRTX0NIQU5ORUwgPSBcInZlbG9jaW91cy1iYWNrZ3JvdW5kLWpvYi1jb3VudHNcIlxuZXhwb3J0IGNvbnN0IEJBQ0tHUk9VTkRfSk9CX0NPVU5UX0JVQ0tFVFMgPSBbXCJhbGxcIiwgXCJxdWV1ZWRcIiwgXCJoYW5kZWRfb2ZmXCIsIFwiY29tcGxldGVkXCIsIFwiZmFpbGVkXCIsIFwib3JwaGFuZWRcIl1cbmNvbnN0IENPVU5URURfSk9CX1NUQVRVU0VTID0gQkFDS0dST1VORF9KT0JfQ09VTlRfQlVDS0VUUy5zbGljZSgxKVxuY29uc3QgTUFYX0pPQl9USU1FT1VUX01TID0gMl8xNDdfNDgzXzY0N1xuY29uc3QgSk9CX1RJTUVPVVRfVkFMSURBVElPTl9NRVNTQUdFID0gYGJhY2tncm91bmQgam9iIHRpbWVvdXRNcyBtdXN0IGJlIGEgZmluaXRlIG5vbi1wb3NpdGl2ZSBudW1iZXIgb3IgYW4gaW50ZWdlciBiZXR3ZWVuIDEgYW5kICR7TUFYX0pPQl9USU1FT1VUX01TfWBcbmNvbnN0IEJBQ0tHUk9VTkRfSk9CX1BSSU9SSVRZX1ZBTElEQVRJT05fTUVTU0FHRSA9IFwiYmFja2dyb3VuZCBqb2IgcHJpb3JpdHkgbXVzdCBiZSBhIG5vbi1uZWdhdGl2ZSBpbnRlZ2VyXCJcbmNvbnN0IE9SUEhBTkVEX0FGVEVSX01TID0gMiAqIDYwICogNjAgKiAxMDAwXG5cbi8qKlxuICogUHJpb3JpdHkgYSBqb2IgaXMgZGVtb3RlZCB0byB3aGVuIGl0IGlzIHJlLXF1ZXVlZCBhZnRlciBhIGZhaWxlZCBhdHRlbXB0LlxuICogQSByZXRyeSBoYXMgYWxyZWFkeSBjb25zdW1lZCBjYXBhY2l0eSBhbmQgdGltZSwgc28gaXQgbXVzdCBuZXZlciBvdmVydGFrZVxuICogd29yayB0aGF0IGhhcyBub3QgaGFkIGl0cyBmaXJzdCBjaGFuY2UgeWV0LiBFbnF1ZXVlIHByaW9yaXRpZXMgYXJlIHZhbGlkYXRlZFxuICogdG8gYmUgbm9uLW5lZ2F0aXZlIGludGVnZXJzLCB3aGljaCBtYWtlcyBgLTFgIHRoZSBsb3dlc3QgcmVhY2hhYmxlIHByaW9yaXR5LlxuICovXG5leHBvcnQgY29uc3QgUkVUUllfQkFDS0dST1VORF9KT0JfUFJJT1JJVFkgPSAtMVxuXG4vKipcbiAqIFByaW9yaXR5IGEgam9iIGdldHMgd2hlbiB0aGUgcHJvZHVjZXIgZG9lcyBub3QgYXNrIGZvciBvbmUuXG4gKi9cbmV4cG9ydCBjb25zdCBERUZBVUxUX0JBQ0tHUk9VTkRfSk9CX1BSSU9SSVRZID0gMFxuXG4vKipcbiAqIENvbHVtbnMgdGhlIGRhc2hib2FyZCBpcyBhbGxvd2VkIHRvIHNvcnQgam9iIGxpc3RpbmdzIGJ5LCBtYXBwZWQgdG8gdGhlaXJcbiAqIGRhdGFiYXNlIGNvbHVtbiBuYW1lcy4gUmVzdHJpY3RpbmcgdG8gdGhpcyBzZXQga2VlcHMgdGhlIHNvcnQgcGFyYW1ldGVyXG4gKiAod2hpY2ggb3JpZ2luYXRlcyBmcm9tIHVudHJ1c3RlZCBxdWVyeSBzdHJpbmdzKSBmcm9tIHJlYWNoaW5nIHJhdyBTUUwuXG4gKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgc3RyaW5nPn1cbiAqL1xuY29uc3QgU09SVEFCTEVfQ09MVU1OUyA9IHtcbiAgYXR0ZW1wdHM6IFwiYXR0ZW1wdHNcIixcbiAgY29tcGxldGVkQXRNczogXCJjb21wbGV0ZWRfYXRfbXNcIixcbiAgY3JlYXRlZEF0TXM6IFwiY3JlYXRlZF9hdF9tc1wiLFxuICBmYWlsZWRBdE1zOiBcImZhaWxlZF9hdF9tc1wiLFxuICBoYW5kZWRPZmZBdE1zOiBcImhhbmRlZF9vZmZfYXRfbXNcIixcbiAgc2NoZWR1bGVkQXRNczogXCJzY2hlZHVsZWRfYXRfbXNcIlxufVxuXG4vKipcbiAqIFNlcmlhbGl6ZXMgY29uY3VycmVudCBgX2FwcGx5U2NoZW1hYCBydW5zIHdpdGhpbiBUSElTIHByb2Nlc3MsIGtleWVkIGJ5IGRhdGFiYXNlXG4gKiBpZGVudGlmaWVyLCBiZWZvcmUgY2FsbGVycyB3aXRob3V0IGFuIGV4aXN0aW5nIGNvbm5lY3Rpb24gY2hlY2sgb25lIG91dC4gVHdvXG4gKiBzdG9yZXMgdGhhdCBzaGFyZSBvbmUgY29ubmVjdGlvbiAoU2luZ2xlTXVsdGlVc2UgLyBTUUxpdGUpXG4gKiBvdGhlcndpc2UgaW50ZXJsZWF2ZSB0aGUgbXVsdGktc3RlcCB0YWJsZSByZWJ1aWxkIGFuZCBjb3JydXB0IGl0ICh0aGUgam9icyB0YWJsZVxuICogaXMgbGVmdCBhcyBpdHMgYCpfdmVsb2Npb3VzX3JlYnVpbGRgIHRlbXApLiBBIERCIGFkdmlzb3J5IGxvY2sgY2FuJ3QgZml4IHRoYXQ6IG9uXG4gKiBhIHNlc3Npb24tc2NvcGVkIC8gcmUtZW50cmFudCBkcml2ZXIgKE15U1FMIGBHRVRfTE9DS2ApIGEgc2Vjb25kIGFjcXVpcmUgb24gdGhlXG4gKiBzYW1lIHNlc3Npb24gc3VjY2VlZHMgaW1tZWRpYXRlbHkgc28gYm90aCBjYWxsZXJzIHByb2NlZWQsIGFuZCB0YWtpbmcgaXQgb24gYVxuICogc2VwYXJhdGUgY29ubmVjdGlvbiBibG9ja3MgY3Jvc3Mtc2Vzc2lvbiBmb3JldmVyLiBBbiBpbi1wcm9jZXNzIHByb21pc2UtY2hhaW5cbiAqIG11dGV4IHNlcmlhbGl6ZXMgc2FtZS1wcm9jZXNzIGNhbGxlcnMgd2l0aCBuZWl0aGVyIGhhemFyZC4gQ3Jvc3MtcHJvY2VzcyBzY2hlbWFcbiAqIHJhY2VzIHN0YXkgY292ZXJlZCBieSB0aGUgcGVyLXN0ZXAgYWR2aXNvcnkgbG9ja3MgKyByZWNoZWNrcyBpbnNpZGUgdGhlIHN0ZXBzLlxuICogQHR5cGUge01hcDxzdHJpbmcsIFByb21pc2U8dm9pZD4+fVxuICovXG5jb25zdCBzY2hlbWFBcHBseUNoYWlucyA9IG5ldyBNYXAoKVxuLyoqIEB0eXBlIHtNYXA8c3RyaW5nLCBQcm9taXNlPHZvaWQ+Pn0gKi9cbmNvbnN0IHRyYW5zYWN0aW9uTXV0YXRpb25DaGFpbnMgPSBuZXcgTWFwKClcblxuZXhwb3J0IGRlZmF1bHQgY2xhc3MgQmFja2dyb3VuZEpvYnNTdG9yZSBleHRlbmRzIEJhY2tncm91bmRKb2JzQWRhcHRlciB7XG4gIC8qKlxuICAgKiBSdW5zIGNvbnN0cnVjdG9yLlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIE9wdGlvbnMuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vY29uZmlndXJhdGlvbi5qc1wiKS5kZWZhdWx0fSBhcmdzLmNvbmZpZ3VyYXRpb24gLSBDb25maWd1cmF0aW9uLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gW2FyZ3MuZGF0YWJhc2VJZGVudGlmaWVyXSAtIERhdGFiYXNlIGlkZW50aWZpZXIuXG4gICAqIEBwYXJhbSB7e25vdzogKCkgPT4gbnVtYmVyfX0gW2FyZ3MuY2xvY2tdIC0gSW5qZWN0YWJsZSBwZXJzaXN0ZW5jZSBjbG9jay5cbiAgICogQHBhcmFtIHsocHJvZHVjZXJQcm9vZjogaW1wb3J0KFwiLi90eXBlcy5qc1wiKS5CYWNrZ3JvdW5kSm9iUHJvZHVjZXJQcm9vZikgPT4gdm9pZCB8IFByb21pc2U8dm9pZD59IFthcmdzLmFmdGVyT3duZWRQcm9kdWNlclZhbGlkYXRpb25dIC0gRXhhY3Qgb3duZWQtZW5xdWV1ZSB2YWxpZGF0aW9uIGhvb2suXG4gICAqIEBwYXJhbSB7KG1ldGFkYXRhOiBCYWNrZ3JvdW5kSm9iUHJ1bmVDYW5kaWRhdGVNZXRhZGF0YSkgPT4gdm9pZCB8IFByb21pc2U8dm9pZD59IFthcmdzLmFmdGVyUHJ1bmVDYW5kaWRhdGVzU2VsZWN0ZWRdIC0gT3B0aW9uYWwgYmFycmllciBpbnZva2VkIGFmdGVyIG9uZSByZXRlbnRpb24gYmF0Y2gncyBjYW5kaWRhdGUgZGlzY292ZXJ5IGFuZCBiZWZvcmUgaXRzIHNlcmlhbGl6ZWQgZGVsZXRlIHRyYW5zYWN0aW9uLlxuICAgKi9cbiAgY29uc3RydWN0b3Ioe2NvbmZpZ3VyYXRpb24sIGRhdGFiYXNlSWRlbnRpZmllciwgY2xvY2ssIGFmdGVyT3duZWRQcm9kdWNlclZhbGlkYXRpb24sIGFmdGVyUHJ1bmVDYW5kaWRhdGVzU2VsZWN0ZWR9KSB7XG4gICAgc3VwZXIoKVxuICAgIHRoaXMuY29uZmlndXJhdGlvbiA9IGNvbmZpZ3VyYXRpb25cbiAgICB0aGlzLmRhdGFiYXNlSWRlbnRpZmllciA9IGRhdGFiYXNlSWRlbnRpZmllclxuICAgIHRoaXMuY2xvY2sgPSBjbG9jayB8fCB7bm93OiAoKSA9PiBEYXRlLm5vdygpfVxuICAgIHRoaXMuYWZ0ZXJPd25lZFByb2R1Y2VyVmFsaWRhdGlvbiA9IGFmdGVyT3duZWRQcm9kdWNlclZhbGlkYXRpb25cbiAgICB0aGlzLmFmdGVyUHJ1bmVDYW5kaWRhdGVzU2VsZWN0ZWQgPSBhZnRlclBydW5lQ2FuZGlkYXRlc1NlbGVjdGVkXG4gICAgdGhpcy5sb2dnZXIgPSBuZXcgTG9nZ2VyKHRoaXMpXG4gICAgdGhpcy5fcmVhZHlQcm9taXNlID0gbnVsbFxuICAgIHRoaXMuX3F1ZXVlQ29uY3VycmVuY3lSZWNvbmNpbGVkID0gZmFsc2VcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGdldCBkYXRhYmFzZSBpZGVudGlmaWVyLlxuICAgKiBAcmV0dXJucyB7c3RyaW5nfSAtIERhdGFiYXNlIGlkZW50aWZpZXIuXG4gICAqL1xuICBnZXREYXRhYmFzZUlkZW50aWZpZXIoKSB7XG4gICAgaWYgKHRoaXMuZGF0YWJhc2VJZGVudGlmaWVyKSByZXR1cm4gdGhpcy5kYXRhYmFzZUlkZW50aWZpZXJcblxuICAgIHJldHVybiB0aGlzLmNvbmZpZ3VyYXRpb24uZ2V0QmFja2dyb3VuZEpvYnNDb25maWcoKS5kYXRhYmFzZUlkZW50aWZpZXJcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGVuc3VyZSByZWFkeS5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgd2hlbiByZWFkeS5cbiAgICovXG4gIGFzeW5jIGVuc3VyZVJlYWR5KCkge1xuICAgIGlmICh0aGlzLl9yZWFkeVByb21pc2UpIHJldHVybiBhd2FpdCB0aGlzLl9yZWFkeVByb21pc2VcblxuICAgIHRoaXMuX3JlYWR5UHJvbWlzZSA9IChhc3luYyAoKSA9PiB7XG4gICAgICB0aGlzLmNvbmZpZ3VyYXRpb24uc2V0Q3VycmVudCgpXG4gICAgICBhd2FpdCB0aGlzLl9lbnN1cmVTY2hlbWEoKVxuICAgICAgYXdhaXQgdGhpcy5faW5pdGlhbGl6ZU1vZGVsKClcbiAgICB9KSgpXG5cbiAgICB0cnkge1xuICAgICAgYXdhaXQgdGhpcy5fcmVhZHlQcm9taXNlXG4gICAgfSBmaW5hbGx5IHtcbiAgICAgIHRoaXMuX3JlYWR5UHJvbWlzZSA9IG51bGxcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogRW5zdXJlcyB0aGUgYmFja2dyb3VuZC1qb2JzIHNjaGVtYSAodGFibGVzICsgY29sdW1ucykgZXhpc3RzIG9uIHRoZSBjb25maWd1cmVkXG4gICAqIGRhdGFiYXNlLCB3aXRob3V0IGluaXRpYWxpemluZyB0aGUgcnVudGltZSBtb2RlbC4gTGV0cyBgZGI6bWlncmF0ZWAgY3JlYXRlIHRoZVxuICAgKiBmcmFtZXdvcmsncyBvd24gc2NoZW1hIGRldGVybWluaXN0aWNhbGx5IGFsb25nc2lkZSBhcHAgbWlncmF0aW9ucyDigJQgYW5kIGNhcHR1cmVcbiAgICogaXQgaW4gdGhlIGR1bXBlZCBzdHJ1Y3R1cmUgU1FMIOKAlCBpbnN0ZWFkIG9mIGl0IG9ubHkgYXBwZWFyaW5nIG9uY2UgYSBzdG9yZSBib290cy5cbiAgICogSWRlbXBvdGVudDogcmV1c2VzIHRoZSBzYW1lIGBfZW5zdXJlU2NoZW1hYCB0aGUgcnVudGltZSBzdG9yZSB1c2VzLCB3aGljaCBza2lwc1xuICAgKiB3b3JrIGFscmVhZHkgYXBwbGllZCAodHJhY2tlZCBpbiBgdmVsb2Npb3VzX2ludGVybmFsX21pZ3JhdGlvbnNgKS5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9kYXRhYmFzZS9kcml2ZXJzL2Jhc2UuanNcIikuZGVmYXVsdH0gW2RiXSAtIFJldXNlIGFuIGFscmVhZHlcbiAgICogICBjaGVja2VkLW91dCBjb25uZWN0aW9uIChlLmcuIHRoZSBvbmUgYGRiOm1pZ3JhdGVgIGhvbGRzKSByYXRoZXIgdGhhbiBvcGVuaW5nIGFcbiAgICogICBuZXN0ZWQgY2hlY2tvdXQgdGhhdCB3b3VsZCBkZWFkbG9jayBhIHNpbmdsZS1jb25uZWN0aW9uIHBvb2wuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIHdoZW4gdGhlIHNjaGVtYSBpcyBwcmVzZW50LlxuICAgKi9cbiAgYXN5bmMgZW5zdXJlU2NoZW1hKGRiKSB7XG4gICAgLy8gV2hlbiBhIGNvbm5lY3Rpb24gaXMgaGFuZGVkIGluICh0aGUgZGI6bWlncmF0ZSBwYXRoKSwgdGhlIGNhbGxlciBhbHJlYWR5IG93bnNcbiAgICAvLyB0aGUgYWN0aXZlIGNvbmZpZ3VyYXRpb24gKyBjb25uZWN0aW9uIGNvbnRleHQ7IGNhbGxpbmcgc2V0Q3VycmVudCgpIGhlcmUgd291bGRcbiAgICAvLyBjbG9iYmVyIGl0IChlLmcuIHRoZSBicm93c2VyIHRlc3QgcnVubmVyIGp1Z2dsZXMgbXVsdGlwbGUgY29uZmlndXJhdGlvbnMpLlxuICAgIGlmICghZGIpIHRoaXMuY29uZmlndXJhdGlvbi5zZXRDdXJyZW50KClcblxuICAgIGF3YWl0IHRoaXMuX2Vuc3VyZVNjaGVtYShkYilcbiAgfVxuXG4gIC8qKlxuICAgKiBSZWNvbmNpbGVzIHF1ZXVlLWRlcml2ZWQgY29uY3VycmVuY3kgd2l0aCB0aGUgY3VycmVudCBjb25maWd1cmF0aW9uOiB0aGVcbiAgICogZXhwbGljaXQgbGlmZWN5Y2xlIHBhdGggdGhhdCBhZG9wdHMvcmVsZWFzZXMgcGVyc2lzdGVkIHF1ZXVlZCBqb2JzIG9udG9cbiAgICogcXVldWUgY29uY3VycmVuY3kga2V5cyB3aGVuIGBxdWV1ZXNbbmFtZV0ubWF4Q29uY3VycmVudGAgaXMgYWRkZWQsIHJlbW92ZWQsXG4gICAqIG9yIGNoYW5nZWQuIENhbGxlZCBieSB0aGUgYmFja2dyb3VuZC1qb2JzIG1haW4gcHJvY2VzcyBvbiBzdGFydHVwIOKAlCB0aGVcbiAgICogZGVwbG95LXRpbWUgbW9tZW50IHF1ZXVlIGNvbmZpZ3VyYXRpb24gY2hhbmdlcyB0YWtlIGVmZmVjdC4gU2NoZW1hL3RlbmFudFxuICAgKiBjaGVja3MgYW5kIHJvdXRpbmUgY29ubmVjdGlvbiBpbml0aWFsaXphdGlvbiBkZWxpYmVyYXRlbHkgbmV2ZXIgcnVuIHRoaXM6XG4gICAqIHRoZXkgc3RheSByZWFkLW9ubHkgcmVnYXJkaW5nIHF1ZXVlZCBqb2Igcm93cywgYmVjYXVzZSB0aGUgYnJvYWRcbiAgICogYWRvcHRpb24vcmVsZWFzZSBVUERBVEVzIGRlYWRsb2NrIGFnYWluc3QgYWN0aXZlIGpvYiBwcm9jZXNzZXMgdW5kZXJcbiAgICogY29uY3VycmVudCB0ZW5hbnQgaW5pdGlhbGl6YXRpb24uIFNlcmlhbGl6ZWQgYWNyb3NzIHByb2Nlc3NlcyB3aXRoIGFcbiAgICogZGF0YWJhc2UgYWR2aXNvcnkgbG9jayBzbyBjb25jdXJyZW50bHkgc3RhcnRlZCBtYWlucyBjYW5ub3QgaW50ZXJsZWF2ZSB0aGVcbiAgICogVVBEQVRFczsgdGhlIHBlci1pbnN0YW5jZSBtZW1vIG9ubHkgc2tpcHMgcmVwZWF0IHdvcmsgd2l0aGluIHRoaXMgcHJvY2Vzcy5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgd2hlbiByZWNvbmNpbGVkLlxuICAgKi9cbiAgYXN5bmMgcmVjb25jaWxlUXVldWVDb25jdXJyZW5jeSgpIHtcbiAgICBpZiAodGhpcy5fcXVldWVDb25jdXJyZW5jeVJlY29uY2lsZWQpIHJldHVyblxuXG4gICAgY29uc3QgZGF0YWJhc2VJZGVudGlmaWVyID0gdGhpcy5nZXREYXRhYmFzZUlkZW50aWZpZXIoKVxuICAgIGNvbnN0IHN0YXJ0ZWRBdE1zID0gRGF0ZS5ub3coKVxuXG4gICAgYXdhaXQgdGhpcy5sb2dnZXIuaW5mbygoKSA9PiBbXG4gICAgICBcIlN0YXJ0aW5nIGJhY2tncm91bmQgam9icyBxdWV1ZS1jb25jdXJyZW5jeSBzdGFydHVwIHJlY29uY2lsaWF0aW9uXCIsXG4gICAgICB7ZGF0YWJhc2VJZGVudGlmaWVyfVxuICAgIF0pXG4gICAgYXdhaXQgdGhpcy5lbnN1cmVSZWFkeSgpXG5cbiAgICBhd2FpdCB0aGlzLl93aXRoRGIoYXN5bmMgKGRiKSA9PiB7XG4gICAgICBjb25zdCBhY3F1aXJlZCA9IGF3YWl0IGRiLmFjcXVpcmVBZHZpc29yeUxvY2soQ09OQ1VSUkVOQ1lfUkVDT05DSUxJQVRJT05fTE9DSylcblxuICAgICAgaWYgKCFhY3F1aXJlZCkgdGhyb3cgbmV3IEVycm9yKFwiRmFpbGVkIHRvIGFjcXVpcmUgYmFja2dyb3VuZCBqb2IgcXVldWUtY29uY3VycmVuY3kgcmVjb25jaWxlIGxvY2tcIilcblxuICAgICAgdHJ5IHtcbiAgICAgICAgYXdhaXQgdGhpcy5fcmVjb25jaWxlUXVldWVDb25jdXJyZW5jeShkYilcbiAgICAgICAgYXdhaXQgdGhpcy5fcmVjb25jaWxlQ29uY3VycmVuY3koZGIpXG5cbiAgICAgICAgLy8gTGF0Y2ggdGhlIG1lbW8gb25seSBhZnRlciBCT1RIIHN0ZXBzIHN1Y2NlZWQ6IGlmIHRoZSBjb3VudCByZWJ1aWxkXG4gICAgICAgIC8vIGZhaWxzIGFmdGVyIGFkb3B0aW9uLCBhIHJldHJ5IG9uIHRoaXMgc3RvcmUgbXVzdCByZS1lbnRlciBhbmQgcmVwYWlyXG4gICAgICAgIC8vIHRoZSBjb3VudHMgKGFkb3B0aW9uIGl0c2VsZiBpcyBpZGVtcG90ZW50KS5cbiAgICAgICAgdGhpcy5fcXVldWVDb25jdXJyZW5jeVJlY29uY2lsZWQgPSB0cnVlXG4gICAgICB9IGZpbmFsbHkge1xuICAgICAgICBhd2FpdCBkYi5yZWxlYXNlQWR2aXNvcnlMb2NrKENPTkNVUlJFTkNZX1JFQ09OQ0lMSUFUSU9OX0xPQ0spXG4gICAgICB9XG4gICAgfSlcblxuICAgIGF3YWl0IHRoaXMubG9nZ2VyLmluZm8oKCkgPT4gW1xuICAgICAgXCJDb21wbGV0ZWQgYmFja2dyb3VuZCBqb2JzIHF1ZXVlLWNvbmN1cnJlbmN5IHN0YXJ0dXAgcmVjb25jaWxpYXRpb25cIixcbiAgICAgIHtkYXRhYmFzZUlkZW50aWZpZXIsIGR1cmF0aW9uTXM6IERhdGUubm93KCkgLSBzdGFydGVkQXRNc31cbiAgICBdKVxuICB9XG5cbiAgLyoqXG4gICAqIFJlcGFpcnMgZHVyYWJsZSBhY3RpdmUtY291bnQgZHJpZnQgd2hpbGUgYSBtYWluIHByb2Nlc3MgcmVtYWlucyBsaXZlLiBUaGVcbiAgICogaW5pdGlhbCBzbmFwc2hvdCBpcyByZWFkLW9ubHk7IG9ubHkgc3VzcGVjdGVkIG1pc21hdGNoZXMgdGFrZSB0aGVpclxuICAgKiBjb3VudGVyIGxvY2sgYW5kIHJlLWNvdW50IGluc2lkZSB0aGUgc2VyaWFsaXplZCB0cmFuc2FjdGlvbiBwYXRoLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxpbXBvcnQoXCIuL3R5cGVzLmpzXCIpLkJhY2tncm91bmRKb2JDb25jdXJyZW5jeVJlY29uY2lsaWF0aW9uPn0gLSBSZXBhaXIgc3VtbWFyeS5cbiAgICovXG4gIGFzeW5jIHJlY29uY2lsZUFjdGl2ZUNvbmN1cnJlbmN5KCkge1xuICAgIGNvbnN0IGRhdGFiYXNlSWRlbnRpZmllciA9IHRoaXMuZ2V0RGF0YWJhc2VJZGVudGlmaWVyKClcbiAgICBjb25zdCBzdGFydGVkQXRNcyA9IERhdGUubm93KClcblxuICAgIGF3YWl0IHRoaXMuZW5zdXJlUmVhZHkoKVxuXG4gICAgY29uc3QgcmVzdWx0ID0gYXdhaXQgdGhpcy5fc2VyaWFsaXplZENvbm5lY3Rpb25NdXRhdGlvbihcbiAgICAgIGFzeW5jIChkYikgPT4gYXdhaXQgdGhpcy5fcmVjb25jaWxlQ29uY3VycmVuY3koZGIpLFxuICAgICAge1xuICAgICAgICBhZHZpc29yeUxvY2s6IHtcbiAgICAgICAgICBmYWlsdXJlTWVzc2FnZTogXCJGYWlsZWQgdG8gYWNxdWlyZSBiYWNrZ3JvdW5kIGpvYiBhY3RpdmUtY29uY3VycmVuY3kgcmVjb25jaWxlIGxvY2tcIixcbiAgICAgICAgICBuYW1lOiBDT05DVVJSRU5DWV9SRUNPTkNJTElBVElPTl9MT0NLXG4gICAgICAgIH1cbiAgICAgIH1cbiAgICApXG5cbiAgICBpZiAocmVzdWx0LnJlcGFpcmVkQ291bnQgPiAwKSB7XG4gICAgICBhd2FpdCB0aGlzLmxvZ2dlci53YXJuKCgpID0+IFtcbiAgICAgICAgXCJSZXBhaXJlZCBiYWNrZ3JvdW5kIGpvYnMgYWN0aXZlLWNvbmN1cnJlbmN5IGNvdW50IGRyaWZ0XCIsXG4gICAgICAgIHtcbiAgICAgICAgICBkYXRhYmFzZUlkZW50aWZpZXIsXG4gICAgICAgICAgZHVyYXRpb25NczogRGF0ZS5ub3coKSAtIHN0YXJ0ZWRBdE1zLFxuICAgICAgICAgIHJlcGFpcmVkQ291bnQ6IHJlc3VsdC5yZXBhaXJlZENvdW50LFxuICAgICAgICAgIHJlcGFpcnM6IHJlc3VsdC5yZXBhaXJzLFxuICAgICAgICAgIHJlcGFpcnNUcnVuY2F0ZWRDb3VudDogcmVzdWx0LnJlcGFpcnNUcnVuY2F0ZWRDb3VudFxuICAgICAgICB9XG4gICAgICBdKVxuICAgIH1cblxuICAgIHJldHVybiByZXN1bHRcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGVucXVldWUuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gT3B0aW9ucy5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGFyZ3Muam9iTmFtZSAtIEpvYiBuYW1lLlxuICAgKiBAcGFyYW0ge0FycmF5PFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gYXJncy5hcmdzIC0gQXJndW1lbnRzLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vdHlwZXMuanNcIikuQmFja2dyb3VuZEpvYk9wdGlvbnN9IFthcmdzLm9wdGlvbnNdIC0gT3B0aW9ucy5cbiAgICogQHJldHVybnMge1Byb21pc2U8c3RyaW5nPn0gLSBKb2IgaWQuXG4gICAqL1xuICBhc3luYyBlbnF1ZXVlKHtqb2JOYW1lLCBhcmdzLCBvcHRpb25zfSkge1xuICAgIGF3YWl0IHRoaXMuZW5zdXJlUmVhZHkoKVxuXG4gICAgY29uc3QgcHJlcGFyZWRKb2IgPSB0aGlzLl9wcmVwYXJlSm9iKHtqb2JOYW1lLCBhcmdzLCBvcHRpb25zfSlcblxuICAgIGlmIChvcHRpb25zPy5pZGVtcG90ZW5jeUtleSAhPT0gdW5kZWZpbmVkKSB7XG4gICAgICByZXR1cm4gYXdhaXQgdGhpcy5fZW5xdWV1ZUlkZW1wb3RlbnRseSh7YXJnczogYXJncyB8fCBbXSwgb3B0aW9ucywgcHJlcGFyZWRKb2J9KVxuICAgIH1cblxuICAgIC8qKiBAdHlwZSB7c3RyaW5nfSAqL1xuICAgIGxldCByZXN1bHRKb2JJZCA9IHByZXBhcmVkSm9iLmpvYklkXG5cbiAgICBhd2FpdCB0aGlzLl9zZXJpYWxpemVkQ291bnRNdXRhdGlvbihhc3luYyAoZGIpID0+IHtcbiAgICAgIGlmIChvcHRpb25zPy5kZWR1cGxpY2F0ZVdoaWxlUXVldWVkKSB7XG4gICAgICAgIGNvbnN0IGR1cGxpY2F0ZUpvYklkID0gYXdhaXQgdGhpcy5fZGVkdXBsaWNhdGVkUXVldWVkSm9iSWQoZGIsIHByZXBhcmVkSm9iKVxuXG4gICAgICAgIGlmIChkdXBsaWNhdGVKb2JJZCkge1xuICAgICAgICAgIHJlc3VsdEpvYklkID0gZHVwbGljYXRlSm9iSWRcbiAgICAgICAgICByZXR1cm5cbiAgICAgICAgfVxuICAgICAgfVxuXG4gICAgICBhd2FpdCB0aGlzLl9pbnNlcnRQcmVwYXJlZEpvYihkYiwge3ByZXBhcmVkSm9iLCBzY2hlZHVsZUtleTogbnVsbH0pXG4gICAgICBhd2FpdCB0aGlzLl9yZWNvcmRDb3VudERlbHRhKGRiLCB7YWxsOiAxLCBxdWV1ZWQ6IDF9KVxuICAgIH0pXG5cbiAgICByZXR1cm4gcmVzdWx0Sm9iSWRcbiAgfVxuXG4gIC8qKlxuICAgKiBBdG9taWNhbGx5IHZhbGlkYXRlcyBhbiBleGFjdCBwcm9kdWNpbmcgaGFuZG9mZiBhbmQgZW5xdWV1ZXMgaXRzIGZvbGxvdy11cC5cbiAgICogRXZlcnkgZXhhY3QgcmVxdWVzdCBvd25zIGFuIGludGVybmFsIGR1cmFibGUgcmVwbGF5IGlkZW50aXR5LCB3aGlsZSBxdWV1ZWRcbiAgICogZGVkdXBsaWNhdGlvbiBjYW4gcG9pbnQgc2V2ZXJhbCBkaXN0aW5jdCBwcm9kdWNlciBldmVudHMgYXQgb25lIGNvdmVyaW5nIHJvdy5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBPd25lZCBlbnF1ZXVlIHJlcXVlc3QuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBhcmdzLmpvYk5hbWUgLSBKb2IgbmFtZS5cbiAgICogQHBhcmFtIHtBcnJheTxSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59IGFyZ3MuYXJncyAtIEFyZ3VtZW50cy5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL3R5cGVzLmpzXCIpLkJhY2tncm91bmRKb2JPcHRpb25zfSBbYXJncy5vcHRpb25zXSAtIE9wdGlvbnMuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBbYXJncy5wcm9kdWNlckludm9jYXRpb25JZF0gLSBTdGFibGUgaWRlbnRpdHkgZm9yIG9uZSBvd25lZCBlbnF1ZXVlIGludm9jYXRpb24uXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi90eXBlcy5qc1wiKS5CYWNrZ3JvdW5kSm9iUHJvZHVjZXJQcm9vZn0gYXJncy5wcm9kdWNlclByb29mIC0gRXhhY3QgcHJvZHVjZXIgbGVhc2UuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHN0cmluZz59IC0gRHVyYWJsZSBmb2xsb3ctdXAgaWQuXG4gICAqL1xuICBhc3luYyBlbnF1ZXVlRnJvbU93bmVkSGFuZG9mZih7am9iTmFtZSwgYXJncywgb3B0aW9ucywgcHJvZHVjZXJJbnZvY2F0aW9uSWQsIHByb2R1Y2VyUHJvb2Z9KSB7XG4gICAgYXdhaXQgdGhpcy5lbnN1cmVSZWFkeSgpXG5cbiAgICBjb25zdCBub3JtYWxpemVkUHJvZHVjZXJQcm9vZiA9IHRoaXMuX25vcm1hbGl6ZVByb2R1Y2VyUHJvb2YocHJvZHVjZXJQcm9vZilcbiAgICBjb25zdCBub3JtYWxpemVkUHJvZHVjZXJJbnZvY2F0aW9uSWQgPSB0aGlzLl9ub3JtYWxpemVQcm9kdWNlckludm9jYXRpb25JZChwcm9kdWNlckludm9jYXRpb25JZClcbiAgICBjb25zdCBwcmVwYXJlZEpvYiA9IHRoaXMuX3ByZXBhcmVKb2Ioe2pvYk5hbWUsIGFyZ3MsIG9wdGlvbnN9KVxuXG4gICAgcmV0dXJuIGF3YWl0IHRoaXMuX3NlcmlhbGl6ZWRDb3VudE11dGF0aW9uKGFzeW5jIChkYikgPT4ge1xuICAgICAgYXdhaXQgdGhpcy5fdmFsaWRhdGVPd25lZFByb2R1Y2VyUHJvb2YoZGIsIG5vcm1hbGl6ZWRQcm9kdWNlclByb29mKVxuICAgICAgaWYgKHRoaXMuYWZ0ZXJPd25lZFByb2R1Y2VyVmFsaWRhdGlvbikgYXdhaXQgdGhpcy5hZnRlck93bmVkUHJvZHVjZXJWYWxpZGF0aW9uKG5vcm1hbGl6ZWRQcm9kdWNlclByb29mKVxuXG4gICAgICBpZiAob3B0aW9ucz8uaWRlbXBvdGVuY3lLZXkgIT09IHVuZGVmaW5lZCkge1xuICAgICAgICByZXR1cm4gYXdhaXQgdGhpcy5fZW5xdWV1ZUlkZW1wb3RlbnRseUluVHJhbnNhY3Rpb24oe1xuICAgICAgICAgIGFyZ3M6IGFyZ3MgfHwgW10sXG4gICAgICAgICAgY291bnRSZXZpc2lvbkxvY2tlZDogdHJ1ZSxcbiAgICAgICAgICBkYixcbiAgICAgICAgICBvcHRpb25zLFxuICAgICAgICAgIHByZXBhcmVkSm9iXG4gICAgICAgIH0pXG4gICAgICB9XG5cbiAgICAgIHJldHVybiBhd2FpdCB0aGlzLl9lbnF1ZXVlT3duZWRSZXBsYXlJblRyYW5zYWN0aW9uKHtcbiAgICAgICAgZGIsXG4gICAgICAgIG9wdGlvbnM6IG9wdGlvbnMgfHwge30sXG4gICAgICAgIHByZXBhcmVkSm9iLFxuICAgICAgICBwcm9kdWNlckludm9jYXRpb25JZDogbm9ybWFsaXplZFByb2R1Y2VySW52b2NhdGlvbklkLFxuICAgICAgICBwcm9kdWNlclByb29mOiBub3JtYWxpemVkUHJvZHVjZXJQcm9vZlxuICAgICAgfSlcbiAgICB9KVxuICB9XG5cbiAgLyoqXG4gICAqIEZpbmRzIHRoZSBlYXJsaWVzdCBxdWV1ZWQgam9iIHRoYXQgY292ZXJzIHRoaXMgZW5xdWV1ZSdzIGlkZW50aXR5IGFuZCB0aW1lLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL2RhdGFiYXNlL2RyaXZlcnMvYmFzZS5qc1wiKS5kZWZhdWx0fSBkYiAtIFRyYW5zYWN0aW9uIGNvbm5lY3Rpb24uXG4gICAqIEBwYXJhbSB7UHJlcGFyZWRCYWNrZ3JvdW5kSm9ifSBwcmVwYXJlZEpvYiAtIE5vcm1hbGl6ZWQgam9iLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxzdHJpbmcgfCBudWxsPn0gLSBDb3ZlcmluZyBqb2IgaWQuXG4gICAqL1xuICBhc3luYyBfZGVkdXBsaWNhdGVkUXVldWVkSm9iSWQoZGIsIHByZXBhcmVkSm9iKSB7XG4gICAgLy8gRGVkdXBlIG9uIHRoZSBqb2IncyBpZGVudGl0eSAobmFtZSArIGFyZ3MgKyBxdWV1ZSksIE5PVCBpdHMgY29uY3VycmVuY3kga2V5LCBzbyBhIGpvYlxuICAgIC8vIGtlZXBzIHdoYXRldmVyIGNvbmN1cnJlbmN5IGl0IHJlc29sdmVzIHRvLiBPbmx5IGFuIGV4aXN0aW5nIGpvYiBzY2hlZHVsZWQgbm8gbGF0ZXIgdGhhblxuICAgIC8vIHRoaXMgZW5xdWV1ZSBjYW4gY292ZXIgaXQ7IGEgcmV0cnkgYmFja2VkIG9mZiBpbnRvIHRoZSBmdXR1cmUgbXVzdCBub3Qgc3VwcHJlc3MgZWFybGllclxuICAgIC8vIHdvcmsuIE9yZGVyaW5nIHJldHVybnMgdGhlIGVhcmxpZXN0IGNvdmVyaW5nIGpvYiB3aGVuIHNldmVyYWwgcXVldWVkIHJvd3MgYWxyZWFkeSBleGlzdC5cbiAgICBjb25zdCBleGlzdGluZyA9IGF3YWl0IGRiXG4gICAgICAubmV3UXVlcnkoKVxuICAgICAgLmZyb20oSk9CU19UQUJMRSlcbiAgICAgIC5zZWxlY3QoXCJpZFwiKVxuICAgICAgLndoZXJlKHtzdGF0dXM6IFwicXVldWVkXCIsIGpvYl9uYW1lOiBwcmVwYXJlZEpvYi5qb2JOYW1lLCBhcmdzX2pzb246IHByZXBhcmVkSm9iLmFyZ3NKc29uLCBxdWV1ZTogcHJlcGFyZWRKb2IucXVldWV9KVxuICAgICAgLndoZXJlKGBzY2hlZHVsZWRfYXRfbXMgPD0gJHtkYi5xdW90ZShwcmVwYXJlZEpvYi5zY2hlZHVsZWRBdE1zKX1gKVxuICAgICAgLm9yZGVyKFwic2NoZWR1bGVkX2F0X21zIEFTQ1wiKVxuICAgICAgLmxpbWl0KDEpXG4gICAgICAucmVzdWx0cygpXG4gICAgY29uc3Qgcm93ID0gZXhpc3RpbmdbMF1cblxuICAgIHJldHVybiByb3cgPyBTdHJpbmcoLyoqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59ICovIChyb3cpLmlkKSA6IG51bGxcbiAgfVxuXG4gIC8qKlxuICAgKiBQZXJzaXN0cyBvbmUgaW50ZXJuYWwgZXhhY3QtcmVwbGF5IG93bmVyIGFuZCBpdHMgcXVldWVkIGpvYiBpbiB0aGUgY2FsbGVyJ3NcbiAgICogcHJvZHVjZXItdmFsaWRhdGlvbiB0cmFuc2FjdGlvbi5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBUcmFuc2FjdGlvbiBpbnB1dC5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9kYXRhYmFzZS9kcml2ZXJzL2Jhc2UuanNcIikuZGVmYXVsdH0gYXJncy5kYiAtIFRyYW5zYWN0aW9uIGNvbm5lY3Rpb24uXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi90eXBlcy5qc1wiKS5CYWNrZ3JvdW5kSm9iT3B0aW9uc30gYXJncy5vcHRpb25zIC0gRW5xdWV1ZSBvcHRpb25zLlxuICAgKiBAcGFyYW0ge1ByZXBhcmVkQmFja2dyb3VuZEpvYn0gYXJncy5wcmVwYXJlZEpvYiAtIE5vcm1hbGl6ZWQgam9iLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gYXJncy5wcm9kdWNlckludm9jYXRpb25JZCAtIFN0YWJsZSBpZGVudGl0eSBmb3Igb25lIG93bmVkIGVucXVldWUgaW52b2NhdGlvbi5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL3R5cGVzLmpzXCIpLkJhY2tncm91bmRKb2JQcm9kdWNlclByb29mfSBhcmdzLnByb2R1Y2VyUHJvb2YgLSBFeGFjdCBwcm9kdWNlciBsZWFzZS5cbiAgICogQHJldHVybnMge1Byb21pc2U8c3RyaW5nPn0gLSBTdGFibGUgcmVwbGF5IGpvYiBpZC5cbiAgICovXG4gIGFzeW5jIF9lbnF1ZXVlT3duZWRSZXBsYXlJblRyYW5zYWN0aW9uKHtkYiwgb3B0aW9ucywgcHJlcGFyZWRKb2IsIHByb2R1Y2VySW52b2NhdGlvbklkLCBwcm9kdWNlclByb29mfSkge1xuICAgIGNvbnN0IHJlcXVlc3REaWdlc3QgPSB0aGlzLl9vd25lZEVucXVldWVSZXF1ZXN0RGlnZXN0KHtvcHRpb25zLCBwcmVwYXJlZEpvYn0pXG4gICAgY29uc3Qgc2NvcGVEaWdlc3QgPSB0aGlzLl9vd25lZEVucXVldWVTY29wZURpZ2VzdCh7cHJlcGFyZWRKb2IsIHByb2R1Y2VySW52b2NhdGlvbklkLCBwcm9kdWNlclByb29mLCByZXF1ZXN0RGlnZXN0fSlcbiAgICBjb25zdCBpZGVtcG90ZW5jeUtleSA9IGBvd25lZC1oYW5kb2ZmOiR7c2NvcGVEaWdlc3R9YFxuICAgIGNvbnN0IGV4aXN0aW5nID0gYXdhaXQgdGhpcy5faWRlbXBvdGVuY3lPd25lcnNoaXAoZGIsIHNjb3BlRGlnZXN0KVxuICAgIGNvbnN0IGJhc2VPd25lcnNoaXAgPSB7XG4gICAgICBjcmVhdGVkX2F0X21zOiBwcmVwYXJlZEpvYi5jcmVhdGVkQXRNcyxcbiAgICAgIGlkZW1wb3RlbmN5X2tleTogaWRlbXBvdGVuY3lLZXksXG4gICAgICBqb2JfbmFtZTogcHJlcGFyZWRKb2Iuam9iTmFtZSxcbiAgICAgIHF1ZXVlOiBwcmVwYXJlZEpvYi5xdWV1ZSxcbiAgICAgIHJlcXVlc3RfZGlnZXN0OiByZXF1ZXN0RGlnZXN0LFxuICAgICAgc2NvcGVfZGlnZXN0OiBzY29wZURpZ2VzdFxuICAgIH1cblxuICAgIGlmIChleGlzdGluZykge1xuICAgICAgdGhpcy5fdmFsaWRhdGVJZGVtcG90ZW5jeU93bmVyc2hpcCh7ZXhpc3RpbmcsIG93bmVyc2hpcDogey4uLmJhc2VPd25lcnNoaXAsIGpvYl9pZDogU3RyaW5nKGV4aXN0aW5nLmpvYl9pZCl9fSlcbiAgICAgIHJldHVybiBTdHJpbmcoZXhpc3Rpbmcuam9iX2lkKVxuICAgIH1cblxuICAgIGNvbnN0IGR1cGxpY2F0ZUpvYklkID0gb3B0aW9ucy5kZWR1cGxpY2F0ZVdoaWxlUXVldWVkXG4gICAgICA/IGF3YWl0IHRoaXMuX2RlZHVwbGljYXRlZFF1ZXVlZEpvYklkKGRiLCBwcmVwYXJlZEpvYilcbiAgICAgIDogbnVsbFxuICAgIGNvbnN0IG93bmVyc2hpcCA9IHsuLi5iYXNlT3duZXJzaGlwLCBqb2JfaWQ6IGR1cGxpY2F0ZUpvYklkIHx8IHByZXBhcmVkSm9iLmpvYklkfVxuICAgIGNvbnN0IGNsYWltZWQgPSBhd2FpdCB0aGlzLl9jbGFpbUlkZW1wb3RlbmN5T3duZXJzaGlwKGRiLCBvd25lcnNoaXApXG5cbiAgICBpZiAoIWNsYWltZWQuY3JlYXRlZCkge1xuICAgICAgdGhpcy5fdmFsaWRhdGVJZGVtcG90ZW5jeU93bmVyc2hpcCh7ZXhpc3Rpbmc6IGNsYWltZWQucm93LCBvd25lcnNoaXB9KVxuICAgICAgcmV0dXJuIFN0cmluZyhjbGFpbWVkLnJvdy5qb2JfaWQpXG4gICAgfVxuICAgIGlmIChkdXBsaWNhdGVKb2JJZCkgcmV0dXJuIGR1cGxpY2F0ZUpvYklkXG5cbiAgICBhd2FpdCB0aGlzLl9pbnNlcnRQcmVwYXJlZEpvYihkYiwge3ByZXBhcmVkSm9iLCBzY2hlZHVsZUtleTogbnVsbH0pXG4gICAgYXdhaXQgdGhpcy5fcmVjb3JkQ291bnREZWx0YShkYiwge2FsbDogMSwgcXVldWVkOiAxfSlcblxuICAgIHJldHVybiBwcmVwYXJlZEpvYi5qb2JJZFxuICB9XG5cbiAgLyoqXG4gICAqIEF0b21pY2FsbHkgb3ducyBvbmUgZHVyYWJsZSBpZGVtcG90ZW5jeSBzY29wZSBhbmQgY3JlYXRlcyBpdHMgam9iIGV4YWN0bHkgb25jZS5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBFbnF1ZXVlIGlucHV0LlxuICAgKiBAcGFyYW0ge0FycmF5PFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gYXJncy5hcmdzIC0gSm9iIGFyZ3VtZW50cy5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL3R5cGVzLmpzXCIpLkJhY2tncm91bmRKb2JPcHRpb25zfSBhcmdzLm9wdGlvbnMgLSBKb2Igb3B0aW9ucy5cbiAgICogQHBhcmFtIHtQcmVwYXJlZEJhY2tncm91bmRKb2J9IGFyZ3MucHJlcGFyZWRKb2IgLSBOb3JtYWxpemVkIGpvYi5cbiAgICogQHJldHVybnMge1Byb21pc2U8c3RyaW5nPn0gLSBTdGFibGUgb3JpZ2luYWwgam9iIGlkLlxuICAgKi9cbiAgYXN5bmMgX2VucXVldWVJZGVtcG90ZW50bHkoe2FyZ3MsIG9wdGlvbnMsIHByZXBhcmVkSm9ifSkge1xuICAgIC8vIFJldXNlIG9yZGluYXJ5IGVucXVldWUgdHJhbnNhY3Rpb24gYWRtaXNzaW9uIGJlY2F1c2UgdGhpcyBwYXRoIGNoYW5nZXNcbiAgICAvLyB0aGUgc2FtZSBkdXJhYmxlIGNvdW50IHJldmlzaW9uLiBUaGUgc2NvcGUgcHJpbWFyeSBrZXkgcmVtYWlucyB0aGVcbiAgICAvLyBjcm9zcy1wcm9jZXNzIGNvbnZlcmdlbmNlIG93bmVyLlxuICAgIHJldHVybiBhd2FpdCB0aGlzLl9pZGVtcG90ZW50RW5xdWV1ZVRyYW5zYWN0aW9uKGFzeW5jIChkYikgPT4ge1xuICAgICAgcmV0dXJuIGF3YWl0IHRoaXMuX2VucXVldWVJZGVtcG90ZW50bHlJblRyYW5zYWN0aW9uKHthcmdzLCBkYiwgb3B0aW9ucywgcHJlcGFyZWRKb2J9KVxuICAgIH0pXG4gIH1cblxuICAvKipcbiAgICogT3ducyBvciByZXBsYXlzIG9uZSBwdWJsaWMgaWRlbXBvdGVuY3kga2V5IGluc2lkZSB0aGUgY2FsbGVyJ3MgdHJhbnNhY3Rpb24uXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gVHJhbnNhY3Rpb24gaW5wdXQuXG4gICAqIEBwYXJhbSB7QXJyYXk8UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSBhcmdzLmFyZ3MgLSBKb2IgYXJndW1lbnRzLlxuICAgKiBAcGFyYW0ge2Jvb2xlYW59IFthcmdzLmNvdW50UmV2aXNpb25Mb2NrZWRdIC0gV2hldGhlciB0aGUgY2FsbGVyIGFscmVhZHkgb3ducyBjb3VudCBzZXJpYWxpemF0aW9uLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL2RhdGFiYXNlL2RyaXZlcnMvYmFzZS5qc1wiKS5kZWZhdWx0fSBhcmdzLmRiIC0gVHJhbnNhY3Rpb24gY29ubmVjdGlvbi5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL3R5cGVzLmpzXCIpLkJhY2tncm91bmRKb2JPcHRpb25zfSBhcmdzLm9wdGlvbnMgLSBKb2Igb3B0aW9ucy5cbiAgICogQHBhcmFtIHtQcmVwYXJlZEJhY2tncm91bmRKb2J9IGFyZ3MucHJlcGFyZWRKb2IgLSBOb3JtYWxpemVkIGpvYi5cbiAgICogQHJldHVybnMge1Byb21pc2U8c3RyaW5nPn0gLSBTdGFibGUgb3JpZ2luYWwgam9iIGlkLlxuICAgKi9cbiAgYXN5bmMgX2VucXVldWVJZGVtcG90ZW50bHlJblRyYW5zYWN0aW9uKHthcmdzLCBjb3VudFJldmlzaW9uTG9ja2VkID0gZmFsc2UsIGRiLCBvcHRpb25zLCBwcmVwYXJlZEpvYn0pIHtcbiAgICBjb25zdCBpZGVtcG90ZW5jeUtleSA9IHRoaXMuX25vcm1hbGl6ZUlkZW1wb3RlbmN5S2V5KG9wdGlvbnMuaWRlbXBvdGVuY3lLZXkpXG4gICAgY29uc3Qgc2NvcGVEaWdlc3QgPSB0aGlzLl9pZGVtcG90ZW5jeVNjb3BlRGlnZXN0KHtpZGVtcG90ZW5jeUtleSwgam9iTmFtZTogcHJlcGFyZWRKb2Iuam9iTmFtZSwgcXVldWU6IHByZXBhcmVkSm9iLnF1ZXVlfSlcbiAgICBjb25zdCByZXF1ZXN0RGlnZXN0ID0gdGhpcy5faWRlbXBvdGVuY3lSZXF1ZXN0RGlnZXN0KHthcmdzLCBvcHRpb25zLCBwcmVwYXJlZEpvYn0pXG4gICAgY29uc3Qgb3duZXJzaGlwID0ge1xuICAgICAgY3JlYXRlZF9hdF9tczogcHJlcGFyZWRKb2IuY3JlYXRlZEF0TXMsXG4gICAgICBpZGVtcG90ZW5jeV9rZXk6IGlkZW1wb3RlbmN5S2V5LFxuICAgICAgam9iX2lkOiBwcmVwYXJlZEpvYi5qb2JJZCxcbiAgICAgIGpvYl9uYW1lOiBwcmVwYXJlZEpvYi5qb2JOYW1lLFxuICAgICAgcXVldWU6IHByZXBhcmVkSm9iLnF1ZXVlLFxuICAgICAgcmVxdWVzdF9kaWdlc3Q6IHJlcXVlc3REaWdlc3QsXG4gICAgICBzY29wZV9kaWdlc3Q6IHNjb3BlRGlnZXN0XG4gICAgfVxuICAgIGNvbnN0IG1haWxPcGVyYXRpb25JbnB1dCA9IG1haWxEZWxpdmVyeU9wZXJhdGlvbkZvckpvYihwcmVwYXJlZEpvYi5qb2JOYW1lLCBhcmdzKVxuXG4gICAgaWYgKG1haWxPcGVyYXRpb25JbnB1dCAmJiBtYWlsT3BlcmF0aW9uSW5wdXQub3BlcmF0aW9uLmlkICE9PSBpZGVtcG90ZW5jeUtleSkge1xuICAgICAgdGhyb3cgVmVsb2Npb3VzRXJyb3Iuc2FmZShcIk1haWwgZGVsaXZlcnkgb3BlcmF0aW9uIGlkIG11c3QgZXF1YWwgaXRzIGJhY2tncm91bmQgam9iIGlkZW1wb3RlbmN5IGtleS5cIiwge1xuICAgICAgICBjb2RlOiBcIm1haWwtZGVsaXZlcnktaWRlbXBvdGVuY3kta2V5LW1pc21hdGNoXCJcbiAgICAgIH0pXG4gICAgfVxuXG4gICAgY29uc3QgZXhpc3RpbmcgPSBhd2FpdCB0aGlzLl9pZGVtcG90ZW5jeU93bmVyc2hpcChkYiwgc2NvcGVEaWdlc3QpXG5cbiAgICBpZiAoZXhpc3RpbmcpIHtcbiAgICAgIHRoaXMuX3ZhbGlkYXRlSWRlbXBvdGVuY3lPd25lcnNoaXAoe2V4aXN0aW5nLCBvd25lcnNoaXB9KVxuICAgICAgYXdhaXQgdGhpcy5fdmFsaWRhdGVNYWlsRGVsaXZlcnlPcGVyYXRpb24oZGIsIHtqb2JJZDogU3RyaW5nKGV4aXN0aW5nLmpvYl9pZCksIG1haWxPcGVyYXRpb25JbnB1dH0pXG4gICAgICByZXR1cm4gU3RyaW5nKGV4aXN0aW5nLmpvYl9pZClcbiAgICB9XG5cbiAgICBjb25zdCBjbGFpbWVkID0gYXdhaXQgdGhpcy5fY2xhaW1JZGVtcG90ZW5jeU93bmVyc2hpcChkYiwgb3duZXJzaGlwKVxuXG4gICAgaWYgKCFjbGFpbWVkLmNyZWF0ZWQpIHtcbiAgICAgIHRoaXMuX3ZhbGlkYXRlSWRlbXBvdGVuY3lPd25lcnNoaXAoe2V4aXN0aW5nOiBjbGFpbWVkLnJvdywgb3duZXJzaGlwfSlcbiAgICAgIGF3YWl0IHRoaXMuX3ZhbGlkYXRlTWFpbERlbGl2ZXJ5T3BlcmF0aW9uKGRiLCB7am9iSWQ6IFN0cmluZyhjbGFpbWVkLnJvdy5qb2JfaWQpLCBtYWlsT3BlcmF0aW9uSW5wdXR9KVxuICAgICAgcmV0dXJuIFN0cmluZyhjbGFpbWVkLnJvdy5qb2JfaWQpXG4gICAgfVxuXG4gICAgaWYgKCFjb3VudFJldmlzaW9uTG9ja2VkKSBhd2FpdCB0aGlzLl9sb2NrQ291bnRSZXZpc2lvbihkYilcbiAgICBhd2FpdCB0aGlzLl9pbnNlcnRQcmVwYXJlZEpvYihkYiwge3ByZXBhcmVkSm9iLCBzY2hlZHVsZUtleTogbnVsbH0pXG4gICAgYXdhaXQgdGhpcy5fcGVyc2lzdE1haWxEZWxpdmVyeU9wZXJhdGlvbihkYiwge2pvYklkOiBwcmVwYXJlZEpvYi5qb2JJZCwgbWFpbE9wZXJhdGlvbklucHV0LCBjcmVhdGVkQXRNczogcHJlcGFyZWRKb2IuY3JlYXRlZEF0TXN9KVxuICAgIGF3YWl0IHRoaXMuX3JlY29yZENvdW50RGVsdGEoZGIsIHthbGw6IDEsIHF1ZXVlZDogMX0pXG5cbiAgICByZXR1cm4gcHJlcGFyZWRKb2Iuam9iSWRcbiAgfVxuXG4gIC8qKlxuICAgKiBTZXJpYWxpemVzIG9uZSBwaHlzaWNhbCBjb25uZWN0aW9uIGxvY2FsbHkgd2l0aG91dCB0YWtpbmcgb3duZXJzaGlwIGF3YXlcbiAgICogZnJvbSB0aGUgZGF0YWJhc2UgdW5pcXVlbmVzcyBjb25zdHJhaW50IHNoYXJlZCBieSBhbGwgcHJvY2Vzc2VzLlxuICAgKiBAdGVtcGxhdGUgVFxuICAgKiBAcGFyYW0geyhkYjogaW1wb3J0KFwiLi4vZGF0YWJhc2UvZHJpdmVycy9iYXNlLmpzXCIpLmRlZmF1bHQpID0+IFByb21pc2U8VD59IGNhbGxiYWNrIC0gVHJhbnNhY3Rpb24gd29yay5cbiAgICogQHJldHVybnMge1Byb21pc2U8VD59IC0gQ2FsbGJhY2sgcmVzdWx0LlxuICAgKi9cbiAgYXN5bmMgX2lkZW1wb3RlbnRFbnF1ZXVlVHJhbnNhY3Rpb24oY2FsbGJhY2spIHtcbiAgICByZXR1cm4gYXdhaXQgdGhpcy5fc2VyaWFsaXplZFRyYW5zYWN0aW9uTXV0YXRpb24oY2FsbGJhY2spXG4gIH1cblxuICAvKipcbiAgICogSW5zZXJ0cyBhbiBvd25lcnNoaXAgcm93LCByZXNvbHZpbmcgb25seSBhIGRhdGFiYXNlIHVuaXF1ZW5lc3MgcmFjZS5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9kYXRhYmFzZS9kcml2ZXJzL2Jhc2UuanNcIikuZGVmYXVsdH0gZGIgLSBUcmFuc2FjdGlvbiBjb25uZWN0aW9uLlxuICAgKiBAcGFyYW0ge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gb3duZXJzaGlwIC0gT3duZXJzaGlwIHJvdy5cbiAgICogQHJldHVybnMge1Byb21pc2U8e2NyZWF0ZWQ6IGJvb2xlYW4sIHJvdzogUmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fT59IC0gQ2xhaW0gcmVzdWx0LlxuICAgKi9cbiAgYXN5bmMgX2NsYWltSWRlbXBvdGVuY3lPd25lcnNoaXAoZGIsIG93bmVyc2hpcCkge1xuICAgIHRyeSB7XG4gICAgICAvLyBUaGUgc2F2ZXBvaW50IGtlZXBzIFBvc3RncmVTUUwncyBvdXRlciB0cmFuc2FjdGlvbiB1c2FibGUgYWZ0ZXIgYVxuICAgICAgLy8gY29uY3VycmVudCB1bmlxdWUta2V5IGxvc3MuIFRoZSB1bmlxdWUgcHJpbWFyeSBrZXksIG5vdCBhIHByb2Nlc3NcbiAgICAgIC8vIG11dGV4LCBpcyB0aGUgY3Jvc3MtcHJvY2VzcyBjb252ZXJnZW5jZSBhdXRob3JpdHkuXG4gICAgICBhd2FpdCBkYi50cmFuc2FjdGlvbihhc3luYyAoKSA9PiB7XG4gICAgICAgIGF3YWl0IGRiLmluc2VydCh7dGFibGVOYW1lOiBJREVNUE9URU5DWV9LRVlTX1RBQkxFLCBkYXRhOiBvd25lcnNoaXB9KVxuICAgICAgfSlcblxuICAgICAgcmV0dXJuIHtjcmVhdGVkOiB0cnVlLCByb3c6IG93bmVyc2hpcH1cbiAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgY29uc3QgcmFjZWQgPSBhd2FpdCB0aGlzLl9pZGVtcG90ZW5jeU93bmVyc2hpcChkYiwgU3RyaW5nKG93bmVyc2hpcC5zY29wZV9kaWdlc3QpKVxuXG4gICAgICBpZiAoIXJhY2VkKSB0aHJvdyBlcnJvclxuICAgICAgcmV0dXJuIHtjcmVhdGVkOiBmYWxzZSwgcm93OiByYWNlZH1cbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogTG9hZHMgb25lIGR1cmFibGUgZW5xdWV1ZSBvd25lci5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9kYXRhYmFzZS9kcml2ZXJzL2Jhc2UuanNcIikuZGVmYXVsdH0gZGIgLSBEYXRhYmFzZSBjb25uZWN0aW9uLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gc2NvcGVEaWdlc3QgLSBGaXhlZC1zaXplIHNjb3BlIGRpZ2VzdC5cbiAgICogQHJldHVybnMge1Byb21pc2U8UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+IHwgbnVsbD59IC0gUm93IG9yIG51bGwuXG4gICAqL1xuICBhc3luYyBfaWRlbXBvdGVuY3lPd25lcnNoaXAoZGIsIHNjb3BlRGlnZXN0KSB7XG4gICAgY29uc3Qgcm93cyA9IGF3YWl0IGRiLm5ld1F1ZXJ5KCkuZnJvbShJREVNUE9URU5DWV9LRVlTX1RBQkxFKS53aGVyZSh7c2NvcGVfZGlnZXN0OiBzY29wZURpZ2VzdH0pLmxpbWl0KDEpLnJlc3VsdHMoKVxuXG4gICAgcmV0dXJuIHJvd3NbMF0gPyAvKiogQHR5cGUge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gKi8gKHJvd3NbMF0pIDogbnVsbFxuICB9XG5cbiAgLyoqXG4gICAqIEZhaWxzIGNsb3NlZCB3aGVuIGEgZHVyYWJsZSBrZXkgaXMgcmV1c2VkIGZvciBhIGRpZmZlcmVudCBjYW5vbmljYWwgcmVxdWVzdC5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBWYWxpZGF0aW9uIGlucHV0LlxuICAgKiBAcGFyYW0ge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gYXJncy5leGlzdGluZyAtIFN0b3JlZCBvd25lci5cbiAgICogQHBhcmFtIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59IGFyZ3Mub3duZXJzaGlwIC0gUmVxdWVzdGVkIG93bmVyLlxuICAgKiBAcmV0dXJucyB7dm9pZH1cbiAgICovXG4gIF92YWxpZGF0ZUlkZW1wb3RlbmN5T3duZXJzaGlwKHtleGlzdGluZywgb3duZXJzaGlwfSkge1xuICAgIGNvbnN0IGV4YWN0U2NvcGUgPSBTdHJpbmcoZXhpc3Rpbmcuam9iX25hbWUpID09PSBvd25lcnNoaXAuam9iX25hbWVcbiAgICAgICYmIFN0cmluZyhleGlzdGluZy5xdWV1ZSkgPT09IG93bmVyc2hpcC5xdWV1ZVxuICAgICAgJiYgU3RyaW5nKGV4aXN0aW5nLmlkZW1wb3RlbmN5X2tleSkgPT09IG93bmVyc2hpcC5pZGVtcG90ZW5jeV9rZXlcblxuICAgIGlmICghZXhhY3RTY29wZSB8fCBTdHJpbmcoZXhpc3RpbmcucmVxdWVzdF9kaWdlc3QpICE9PSBvd25lcnNoaXAucmVxdWVzdF9kaWdlc3QpIHtcbiAgICAgIHRocm93IFZlbG9jaW91c0Vycm9yLnNhZmUoXCJUaGUgYmFja2dyb3VuZCBqb2IgaWRlbXBvdGVuY3kga2V5IHdhcyBhbHJlYWR5IHVzZWQgZm9yIGEgZGlmZmVyZW50IHJlcXVlc3QuXCIsIHtcbiAgICAgICAgY29kZTogXCJiYWNrZ3JvdW5kLWpvYi1pZGVtcG90ZW5jeS1jb25mbGljdFwiXG4gICAgICB9KVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBQZXJzaXN0cyB0aGUgYnVpbHQtaW4gbWFpbCBvcGVyYXRpb24gaW4gdGhlIHNhbWUgZmlyc3QtZW5xdWV1ZSB0cmFuc2FjdGlvbi5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9kYXRhYmFzZS9kcml2ZXJzL2Jhc2UuanNcIikuZGVmYXVsdH0gZGIgLSBUcmFuc2FjdGlvbiBjb25uZWN0aW9uLlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIE9wZXJhdGlvbiBpbnB1dC5cbiAgICogQHBhcmFtIHtudW1iZXJ9IGFyZ3MuY3JlYXRlZEF0TXMgLSBDcmVhdGlvbiB0aW1lc3RhbXAuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBhcmdzLmpvYklkIC0gTmF0aXZlIGpvYiBpZC5cbiAgICogQHBhcmFtIHt7b3BlcmF0aW9uOiBpbXBvcnQoXCIuLi9tYWlsZXIvaW5kZXguanNcIikuTWFpbGVyRGVsaXZlcnlPcGVyYXRpb24sIHBheWxvYWQ6IGltcG9ydChcIi4uL21haWxlci9pbmRleC5qc1wiKS5NYWlsZXJEZWxpdmVyeVBheWxvYWR9IHwgbnVsbH0gYXJncy5tYWlsT3BlcmF0aW9uSW5wdXQgLSBNYWlsIG9wZXJhdGlvbi5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgYWZ0ZXIgcGVyc2lzdGVuY2UuXG4gICAqL1xuICBhc3luYyBfcGVyc2lzdE1haWxEZWxpdmVyeU9wZXJhdGlvbihkYiwge2NyZWF0ZWRBdE1zLCBqb2JJZCwgbWFpbE9wZXJhdGlvbklucHV0fSkge1xuICAgIGlmICghbWFpbE9wZXJhdGlvbklucHV0KSByZXR1cm5cbiAgICBjb25zdCB7b3BlcmF0aW9ufSA9IG1haWxPcGVyYXRpb25JbnB1dFxuICAgIGNvbnN0IG9wZXJhdGlvbktleSA9IG1haWxEZWxpdmVyeU9wZXJhdGlvbktleShvcGVyYXRpb24uaWQpXG4gICAgY29uc3Qgcm93ID0ge1xuICAgICAgYmFja2dyb3VuZF9qb2JfaWQ6IGpvYklkLFxuICAgICAgY3JlYXRlZF9hdF9tczogY3JlYXRlZEF0TXMsXG4gICAgICBmaXJzdF9hdHRlbXB0X3N0YXJ0ZWRfYXRfbXM6IG51bGwsXG4gICAgICBvcGVyYXRpb25faWQ6IG9wZXJhdGlvbi5pZCxcbiAgICAgIG9wZXJhdGlvbl9rZXk6IG9wZXJhdGlvbktleSxcbiAgICAgIHBheWxvYWRfZGlnZXN0OiBvcGVyYXRpb24ucGF5bG9hZERpZ2VzdCxcbiAgICAgIHByb3ZpZGVyX2tpbmQ6IG9wZXJhdGlvbi5wcm92aWRlcktpbmQsXG4gICAgICBwcm92aWRlcl9yZXRlbnRpb25fbXM6IG9wZXJhdGlvbi5wcm92aWRlclJldGVudGlvbk1zXG4gICAgfVxuXG4gICAgdHJ5IHtcbiAgICAgIGF3YWl0IGRiLnRyYW5zYWN0aW9uKGFzeW5jICgpID0+IHtcbiAgICAgICAgYXdhaXQgZGIuaW5zZXJ0KHt0YWJsZU5hbWU6IE1BSUxfREVMSVZFUllfT1BFUkFUSU9OU19UQUJMRSwgZGF0YTogcm93fSlcbiAgICAgIH0pXG4gICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgIGNvbnN0IGV4aXN0aW5nID0gYXdhaXQgdGhpcy5fbWFpbERlbGl2ZXJ5T3BlcmF0aW9uKGRiLCBvcGVyYXRpb25LZXkpXG5cbiAgICAgIGlmICghZXhpc3RpbmcpIHRocm93IGVycm9yXG4gICAgICB0aGlzLl92YWxpZGF0ZU1haWxEZWxpdmVyeU9wZXJhdGlvblJvdyh7ZXhpc3RpbmcsIHJlcXVlc3RlZDogcm93fSlcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogVmFsaWRhdGVzIHRoZSBkdXJhYmxlIG1haWwgcm93IGR1cmluZyBhbiBleGFjdCBnZW5lcmljIGVucXVldWUgcmVwbGF5LlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL2RhdGFiYXNlL2RyaXZlcnMvYmFzZS5qc1wiKS5kZWZhdWx0fSBkYiAtIERhdGFiYXNlIGNvbm5lY3Rpb24uXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gVmFsaWRhdGlvbiBpbnB1dC5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGFyZ3Muam9iSWQgLSBPd25lZCBqb2IgaWQuXG4gICAqIEBwYXJhbSB7e29wZXJhdGlvbjogaW1wb3J0KFwiLi4vbWFpbGVyL2luZGV4LmpzXCIpLk1haWxlckRlbGl2ZXJ5T3BlcmF0aW9uLCBwYXlsb2FkOiBpbXBvcnQoXCIuLi9tYWlsZXIvaW5kZXguanNcIikuTWFpbGVyRGVsaXZlcnlQYXlsb2FkfSB8IG51bGx9IGFyZ3MubWFpbE9wZXJhdGlvbklucHV0IC0gTWFpbCBvcGVyYXRpb24uXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIHdoZW4gZXhhY3QuXG4gICAqL1xuICBhc3luYyBfdmFsaWRhdGVNYWlsRGVsaXZlcnlPcGVyYXRpb24oZGIsIHtqb2JJZCwgbWFpbE9wZXJhdGlvbklucHV0fSkge1xuICAgIGlmICghbWFpbE9wZXJhdGlvbklucHV0KSByZXR1cm5cbiAgICBjb25zdCB7b3BlcmF0aW9ufSA9IG1haWxPcGVyYXRpb25JbnB1dFxuICAgIGNvbnN0IGV4aXN0aW5nID0gYXdhaXQgdGhpcy5fbWFpbERlbGl2ZXJ5T3BlcmF0aW9uKGRiLCBtYWlsRGVsaXZlcnlPcGVyYXRpb25LZXkob3BlcmF0aW9uLmlkKSlcblxuICAgIGlmICghZXhpc3RpbmcpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihcIkJhY2tncm91bmQgam9iIGlkZW1wb3RlbmN5IG93bmVyc2hpcCBpcyBtaXNzaW5nIGl0cyBkdXJhYmxlIG1haWwgZGVsaXZlcnkgb3BlcmF0aW9uXCIpXG4gICAgfVxuXG4gICAgdGhpcy5fdmFsaWRhdGVNYWlsRGVsaXZlcnlPcGVyYXRpb25Sb3coe1xuICAgICAgZXhpc3RpbmcsXG4gICAgICByZXF1ZXN0ZWQ6IHtcbiAgICAgICAgYmFja2dyb3VuZF9qb2JfaWQ6IGpvYklkLFxuICAgICAgICBvcGVyYXRpb25faWQ6IG9wZXJhdGlvbi5pZCxcbiAgICAgICAgcGF5bG9hZF9kaWdlc3Q6IG9wZXJhdGlvbi5wYXlsb2FkRGlnZXN0LFxuICAgICAgICBwcm92aWRlcl9raW5kOiBvcGVyYXRpb24ucHJvdmlkZXJLaW5kLFxuICAgICAgICBwcm92aWRlcl9yZXRlbnRpb25fbXM6IG9wZXJhdGlvbi5wcm92aWRlclJldGVudGlvbk1zXG4gICAgICB9XG4gICAgfSlcbiAgfVxuXG4gIC8qKlxuICAgKiBMb2FkcyBhIGR1cmFibGUgbWFpbCBvcGVyYXRpb24uXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vZGF0YWJhc2UvZHJpdmVycy9iYXNlLmpzXCIpLmRlZmF1bHR9IGRiIC0gRGF0YWJhc2UgY29ubmVjdGlvbi5cbiAgICogQHBhcmFtIHtzdHJpbmd9IG9wZXJhdGlvbktleSAtIEZpeGVkLXNpemUgb3BlcmF0aW9uIGtleS5cbiAgICogQHJldHVybnMge1Byb21pc2U8UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+IHwgbnVsbD59IC0gUm93IG9yIG51bGwuXG4gICAqL1xuICBhc3luYyBfbWFpbERlbGl2ZXJ5T3BlcmF0aW9uKGRiLCBvcGVyYXRpb25LZXkpIHtcbiAgICBjb25zdCByb3dzID0gYXdhaXQgZGIubmV3UXVlcnkoKS5mcm9tKE1BSUxfREVMSVZFUllfT1BFUkFUSU9OU19UQUJMRSkud2hlcmUoe29wZXJhdGlvbl9rZXk6IG9wZXJhdGlvbktleX0pLmxpbWl0KDEpLnJlc3VsdHMoKVxuXG4gICAgcmV0dXJuIHJvd3NbMF0gPyAvKiogQHR5cGUge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gKi8gKHJvd3NbMF0pIDogbnVsbFxuICB9XG5cbiAgLyoqXG4gICAqIENvbXBhcmVzIHByb3ZpZGVyLXJlbGV2YW50IGR1cmFibGUgbWFpbCBvcGVyYXRpb24gZmllbGRzLlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIFZhbGlkYXRpb24gaW5wdXQuXG4gICAqIEBwYXJhbSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSBhcmdzLmV4aXN0aW5nIC0gU3RvcmVkIHJvdy5cbiAgICogQHBhcmFtIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59IGFyZ3MucmVxdWVzdGVkIC0gUmVxdWVzdGVkIHJvdy5cbiAgICogQHJldHVybnMge3ZvaWR9XG4gICAqL1xuICBfdmFsaWRhdGVNYWlsRGVsaXZlcnlPcGVyYXRpb25Sb3coe2V4aXN0aW5nLCByZXF1ZXN0ZWR9KSB7XG4gICAgY29uc3QgbWF0Y2hlcyA9IFN0cmluZyhleGlzdGluZy5vcGVyYXRpb25faWQpID09PSByZXF1ZXN0ZWQub3BlcmF0aW9uX2lkXG4gICAgICAmJiBTdHJpbmcoZXhpc3RpbmcucGF5bG9hZF9kaWdlc3QpID09PSByZXF1ZXN0ZWQucGF5bG9hZF9kaWdlc3RcbiAgICAgICYmIFN0cmluZyhleGlzdGluZy5iYWNrZ3JvdW5kX2pvYl9pZCkgPT09IHJlcXVlc3RlZC5iYWNrZ3JvdW5kX2pvYl9pZFxuICAgICAgJiYgU3RyaW5nKGV4aXN0aW5nLnByb3ZpZGVyX2tpbmQpID09PSByZXF1ZXN0ZWQucHJvdmlkZXJfa2luZFxuICAgICAgJiYgdGhpcy5fbm9ybWFsaXplTnVtYmVyKGV4aXN0aW5nLnByb3ZpZGVyX3JldGVudGlvbl9tcykgPT09IHJlcXVlc3RlZC5wcm92aWRlcl9yZXRlbnRpb25fbXNcblxuICAgIGlmICghbWF0Y2hlcykge1xuICAgICAgdGhyb3cgVmVsb2Npb3VzRXJyb3Iuc2FmZShcIlRoZSBtYWlsIGRlbGl2ZXJ5IG9wZXJhdGlvbiB3YXMgYWxyZWFkeSB1c2VkIGZvciBhIGRpZmZlcmVudCBwYXlsb2FkIG9yIHByb3ZpZGVyLlwiLCB7XG4gICAgICAgIGNvZGU6IFwibWFpbC1kZWxpdmVyeS1pZGVtcG90ZW5jeS1jb25mbGljdFwiXG4gICAgICB9KVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBDYW5vbmljYWwgcmVxdWVzdCBkaWdlc3QgZXhjbHVkaW5nIGdlbmVyYXRlZCBpZHMgYW5kIGltbWVkaWF0ZSBlbnF1ZXVlIHRpbWUuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gRGlnZXN0IGlucHV0LlxuICAgKiBAcGFyYW0ge0FycmF5PFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gYXJncy5hcmdzIC0gSm9iIGFyZ3VtZW50cy5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL3R5cGVzLmpzXCIpLkJhY2tncm91bmRKb2JPcHRpb25zfSBhcmdzLm9wdGlvbnMgLSBKb2Igb3B0aW9ucy5cbiAgICogQHBhcmFtIHtQcmVwYXJlZEJhY2tncm91bmRKb2J9IGFyZ3MucHJlcGFyZWRKb2IgLSBOb3JtYWxpemVkIGpvYi5cbiAgICogQHJldHVybnMge3N0cmluZ30gLSBTSEEtMjU2IGRpZ2VzdC5cbiAgICovXG4gIF9pZGVtcG90ZW5jeVJlcXVlc3REaWdlc3Qoe2FyZ3MsIG9wdGlvbnMsIHByZXBhcmVkSm9ifSkge1xuICAgIGNvbnN0IHNlcmlhbGl6ZWQgPSBzdGFibGVKc29uU3RyaW5naWZ5KHtcbiAgICAgIGFyZ3MsXG4gICAgICBjb25jdXJyZW5jeTogcHJlcGFyZWRKb2IuY29uY3VycmVuY3ksXG4gICAgICBleGVjdXRpb25Nb2RlOiBwcmVwYXJlZEpvYi5leGVjdXRpb25Nb2RlLFxuICAgICAgZm9ybWF0OiBcInZlbG9jaW91cy1iYWNrZ3JvdW5kLWpvYi1pZGVtcG90ZW5jeS12MVwiLFxuICAgICAgam9iTmFtZTogcHJlcGFyZWRKb2Iuam9iTmFtZSxcbiAgICAgIG1heFJldHJpZXM6IHByZXBhcmVkSm9iLm1heFJldHJpZXMsXG4gICAgICBxdWV1ZTogcHJlcGFyZWRKb2IucXVldWUsXG4gICAgICBzY2hlZHVsZWRBdE1zOiBvcHRpb25zLnNjaGVkdWxlZEF0TXMgPT09IHVuZGVmaW5lZCA/IG51bGwgOiBwcmVwYXJlZEpvYi5zY2hlZHVsZWRBdE1zLFxuICAgICAgc2NoZWR1bGluZzogb3B0aW9ucy5zY2hlZHVsZWRBdE1zID09PSB1bmRlZmluZWQgPyBcImltbWVkaWF0ZVwiIDogXCJzY2hlZHVsZWRcIixcbiAgICAgIC4uLihwcmVwYXJlZEpvYi50aW1lb3V0TXMgPT09IG51bGwgPyB7fSA6IHt0aW1lb3V0TXM6IHByZXBhcmVkSm9iLnRpbWVvdXRNc30pXG4gICAgfSlcblxuICAgIHJldHVybiBjcmVhdGVIYXNoKFwic2hhMjU2XCIpLnVwZGF0ZShzZXJpYWxpemVkKS5kaWdlc3QoXCJoZXhcIilcbiAgfVxuXG4gIC8qKlxuICAgKiBGaXhlZC1zaXplIGdsb2JhbGx5IGluZGV4ZWQgcmVwcmVzZW50YXRpb24gb2YgdGhlIGRvY3VtZW50ZWQgc2NvcGUgdHVwbGUuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gU2NvcGUgaW5wdXQuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBhcmdzLmlkZW1wb3RlbmN5S2V5IC0gQ2FsbGVyIGtleS5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGFyZ3Muam9iTmFtZSAtIEpvYiBjbGFzcyBuYW1lLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gYXJncy5xdWV1ZSAtIFF1ZXVlIG5hbWUuXG4gICAqIEByZXR1cm5zIHtzdHJpbmd9IC0gU0hBLTI1NiBzY29wZSBkaWdlc3QuXG4gICAqL1xuICBfaWRlbXBvdGVuY3lTY29wZURpZ2VzdCh7aWRlbXBvdGVuY3lLZXksIGpvYk5hbWUsIHF1ZXVlfSkge1xuICAgIHJldHVybiBjcmVhdGVIYXNoKFwic2hhMjU2XCIpXG4gICAgICAudXBkYXRlKHN0YWJsZUpzb25TdHJpbmdpZnkoe2Zvcm1hdDogXCJ2ZWxvY2lvdXMtYmFja2dyb3VuZC1qb2ItaWRlbXBvdGVuY3ktc2NvcGUtdjFcIiwgaWRlbXBvdGVuY3lLZXksIGpvYk5hbWUsIHF1ZXVlfSkpXG4gICAgICAuZGlnZXN0KFwiaGV4XCIpXG4gIH1cblxuICAvKipcbiAgICogVmFsaWRhdGVzIG9uZSBjYWxsZXIga2V5LlxuICAgKiBAcGFyYW0ge3N0cmluZyB8IHVuZGVmaW5lZH0gaWRlbXBvdGVuY3lLZXkgLSBDYWxsZXIga2V5LlxuICAgKiBAcmV0dXJucyB7c3RyaW5nfSAtIFZhbGlkIGtleS5cbiAgICovXG4gIF9ub3JtYWxpemVJZGVtcG90ZW5jeUtleShpZGVtcG90ZW5jeUtleSkge1xuICAgIGlmICh0eXBlb2YgaWRlbXBvdGVuY3lLZXkgIT09IFwic3RyaW5nXCIgfHwgaWRlbXBvdGVuY3lLZXkubGVuZ3RoID09PSAwKSB7XG4gICAgICB0aHJvdyBWZWxvY2lvdXNFcnJvci5zYWZlKFwiQmFja2dyb3VuZCBqb2IgaWRlbXBvdGVuY3lLZXkgbXVzdCBiZSBhIG5vbi1lbXB0eSBzdHJpbmcuXCIsIHtcbiAgICAgICAgY29kZTogXCJiYWNrZ3JvdW5kLWpvYi1pZGVtcG90ZW5jeS1rZXktaW52YWxpZFwiXG4gICAgICB9KVxuICAgIH1cblxuICAgIHJldHVybiBpZGVtcG90ZW5jeUtleVxuICB9XG5cbiAgLyoqXG4gICAqIENhbm9uaWNhbCByZXF1ZXN0IGlkZW50aXR5IGZvciBhbiBpbnRlcm5hbCBvd25lZC1oYW5kb2ZmIHJlcGxheS5cbiAgICogSW1tZWRpYXRlIGVucXVldWUgd2FsbCB0aW1lIGFuZCBnZW5lcmF0ZWQgam9iIGlkcyByZW1haW4gZXhjbHVkZWQuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gRGlnZXN0IGlucHV0LlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vdHlwZXMuanNcIikuQmFja2dyb3VuZEpvYk9wdGlvbnN9IGFyZ3Mub3B0aW9ucyAtIEVucXVldWUgb3B0aW9ucy5cbiAgICogQHBhcmFtIHtQcmVwYXJlZEJhY2tncm91bmRKb2J9IGFyZ3MucHJlcGFyZWRKb2IgLSBOb3JtYWxpemVkIGpvYi5cbiAgICogQHJldHVybnMge3N0cmluZ30gLSBTSEEtMjU2IGRpZ2VzdC5cbiAgICovXG4gIF9vd25lZEVucXVldWVSZXF1ZXN0RGlnZXN0KHtvcHRpb25zLCBwcmVwYXJlZEpvYn0pIHtcbiAgICBjb25zdCBzZXJpYWxpemVkID0gc3RhYmxlSnNvblN0cmluZ2lmeSh7XG4gICAgICBhcmdzSnNvbjogcHJlcGFyZWRKb2IuYXJnc0pzb24sXG4gICAgICBjb25jdXJyZW5jeTogcHJlcGFyZWRKb2IuY29uY3VycmVuY3ksXG4gICAgICBkZWR1cGxpY2F0ZVdoaWxlUXVldWVkOiBvcHRpb25zLmRlZHVwbGljYXRlV2hpbGVRdWV1ZWQgPT09IHRydWUsXG4gICAgICBleGVjdXRpb25Nb2RlOiBwcmVwYXJlZEpvYi5leGVjdXRpb25Nb2RlLFxuICAgICAgZm9ybWF0OiBcInZlbG9jaW91cy1iYWNrZ3JvdW5kLWpvYi1vd25lZC1lbnF1ZXVlLXYxXCIsXG4gICAgICBqb2JOYW1lOiBwcmVwYXJlZEpvYi5qb2JOYW1lLFxuICAgICAgbWF4UmV0cmllczogcHJlcGFyZWRKb2IubWF4UmV0cmllcyxcbiAgICAgIHF1ZXVlOiBwcmVwYXJlZEpvYi5xdWV1ZSxcbiAgICAgIHNjaGVkdWxlZEF0TXM6IG9wdGlvbnMuc2NoZWR1bGVkQXRNcyA9PT0gdW5kZWZpbmVkID8gbnVsbCA6IHByZXBhcmVkSm9iLnNjaGVkdWxlZEF0TXMsXG4gICAgICBzY2hlZHVsaW5nOiBvcHRpb25zLnNjaGVkdWxlZEF0TXMgPT09IHVuZGVmaW5lZCA/IFwiaW1tZWRpYXRlXCIgOiBcInNjaGVkdWxlZFwiLFxuICAgICAgLi4uKHByZXBhcmVkSm9iLnRpbWVvdXRNcyA9PT0gbnVsbCA/IHt9IDoge3RpbWVvdXRNczogcHJlcGFyZWRKb2IudGltZW91dE1zfSlcbiAgICB9KVxuXG4gICAgcmV0dXJuIGNyZWF0ZUhhc2goXCJzaGEyNTZcIikudXBkYXRlKHNlcmlhbGl6ZWQpLmRpZ2VzdChcImhleFwiKVxuICB9XG5cbiAgLyoqXG4gICAqIElzb2xhdGVzIGludGVybmFsIHByb2R1Y2VyIHJlcGxheSBvd25lcnNoaXAgZnJvbSBjYWxsZXIgaWRlbXBvdGVuY3kgc2NvcGVzLlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIFNjb3BlIGlucHV0LlxuICAgKiBAcGFyYW0ge1ByZXBhcmVkQmFja2dyb3VuZEpvYn0gYXJncy5wcmVwYXJlZEpvYiAtIE5vcm1hbGl6ZWQgam9iLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gYXJncy5wcm9kdWNlckludm9jYXRpb25JZCAtIFN0YWJsZSBpZGVudGl0eSBmb3Igb25lIG93bmVkIGVucXVldWUgaW52b2NhdGlvbi5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL3R5cGVzLmpzXCIpLkJhY2tncm91bmRKb2JQcm9kdWNlclByb29mfSBhcmdzLnByb2R1Y2VyUHJvb2YgLSBFeGFjdCBwcm9kdWNlciBsZWFzZS5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGFyZ3MucmVxdWVzdERpZ2VzdCAtIENhbm9uaWNhbCByZXF1ZXN0IGRpZ2VzdC5cbiAgICogQHJldHVybnMge3N0cmluZ30gLSBTSEEtMjU2IHNjb3BlIGRpZ2VzdC5cbiAgICovXG4gIF9vd25lZEVucXVldWVTY29wZURpZ2VzdCh7cHJlcGFyZWRKb2IsIHByb2R1Y2VySW52b2NhdGlvbklkLCBwcm9kdWNlclByb29mLCByZXF1ZXN0RGlnZXN0fSkge1xuICAgIHJldHVybiBjcmVhdGVIYXNoKFwic2hhMjU2XCIpXG4gICAgICAudXBkYXRlKHN0YWJsZUpzb25TdHJpbmdpZnkoe1xuICAgICAgICBmb3JtYXQ6IFwidmVsb2Npb3VzLWJhY2tncm91bmQtam9iLW93bmVkLWVucXVldWUtc2NvcGUtdjFcIixcbiAgICAgICAgam9iTmFtZTogcHJlcGFyZWRKb2Iuam9iTmFtZSxcbiAgICAgICAgcHJvZHVjZXJJbnZvY2F0aW9uSWQsXG4gICAgICAgIHByb2R1Y2VyUHJvb2YsXG4gICAgICAgIHF1ZXVlOiBwcmVwYXJlZEpvYi5xdWV1ZSxcbiAgICAgICAgcmVxdWVzdERpZ2VzdFxuICAgICAgfSkpXG4gICAgICAuZGlnZXN0KFwiaGV4XCIpXG4gIH1cblxuICAvKipcbiAgICogVmFsaWRhdGVzIHRoZSB1bnRydXN0ZWQgaWRlbnRpdHkgb2Ygb25lIHByb2R1Y2VyLW93bmVkIGVucXVldWUgaW52b2NhdGlvbi5cbiAgICogQHBhcmFtIHtzdHJpbmcgfCB1bmRlZmluZWR9IHByb2R1Y2VySW52b2NhdGlvbklkIC0gUHJvZHVjZXIgaW52b2NhdGlvbiBpZGVudGl0eS5cbiAgICogQHJldHVybnMge3N0cmluZ30gLSBWYWxpZGF0ZWQgaWRlbnRpdHkuXG4gICAqL1xuICBfbm9ybWFsaXplUHJvZHVjZXJJbnZvY2F0aW9uSWQocHJvZHVjZXJJbnZvY2F0aW9uSWQpIHtcbiAgICBpZiAodHlwZW9mIHByb2R1Y2VySW52b2NhdGlvbklkICE9PSBcInN0cmluZ1wiIHx8IHByb2R1Y2VySW52b2NhdGlvbklkLmxlbmd0aCA9PT0gMCkge1xuICAgICAgdGhyb3cgVmVsb2Npb3VzRXJyb3Iuc2FmZShcIkJhY2tncm91bmQgam9iIHByb2R1Y2VyIGludm9jYXRpb24gaWQgaXMgaW52YWxpZC5cIiwge1xuICAgICAgICBjb2RlOiBcImJhY2tncm91bmQtam9iLXByb2R1Y2VyLWludm9jYXRpb24taWQtaW52YWxpZFwiXG4gICAgICB9KVxuICAgIH1cblxuICAgIHJldHVybiBwcm9kdWNlckludm9jYXRpb25JZFxuICB9XG5cbiAgLyoqXG4gICAqIFZhbGlkYXRlcyB0aGUgdW50cnVzdGVkIHRyYW5zcG9ydCBzaGFwZSBiZWZvcmUgdHJhbnNhY3Rpb24gYWRtaXNzaW9uLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vdHlwZXMuanNcIikuQmFja2dyb3VuZEpvYlByb2R1Y2VyUHJvb2Z9IHByb2R1Y2VyUHJvb2YgLSBQcm9kdWNlciBwcm9vZi5cbiAgICogQHJldHVybnMge2ltcG9ydChcIi4vdHlwZXMuanNcIikuQmFja2dyb3VuZEpvYlByb2R1Y2VyUHJvb2Z9IC0gTm9ybWFsaXplZCBpbW11dGFibGUgcHJvb2YuXG4gICAqL1xuICBfbm9ybWFsaXplUHJvZHVjZXJQcm9vZihwcm9kdWNlclByb29mKSB7XG4gICAgY29uc3QgZXhhY3RLZXlzID0gW1wiaGFuZGVkT2ZmQXRNc1wiLCBcImhhbmRvZmZJZFwiLCBcImpvYklkXCIsIFwid29ya2VySWRcIl1cbiAgICBjb25zdCBrZXlzID0gcHJvZHVjZXJQcm9vZiAmJiB0eXBlb2YgcHJvZHVjZXJQcm9vZiA9PT0gXCJvYmplY3RcIiA/IE9iamVjdC5rZXlzKHByb2R1Y2VyUHJvb2YpIDogW11cbiAgICBjb25zdCB2YWxpZCA9IHByb2R1Y2VyUHJvb2ZcbiAgICAgICYmIHR5cGVvZiBwcm9kdWNlclByb29mID09PSBcIm9iamVjdFwiXG4gICAgICAmJiBrZXlzLmxlbmd0aCA9PT0gZXhhY3RLZXlzLmxlbmd0aFxuICAgICAgJiYga2V5cy5ldmVyeSgoa2V5KSA9PiBleGFjdEtleXMuaW5jbHVkZXMoa2V5KSlcbiAgICAgICYmIHR5cGVvZiBwcm9kdWNlclByb29mLmpvYklkID09PSBcInN0cmluZ1wiXG4gICAgICAmJiBwcm9kdWNlclByb29mLmpvYklkLmxlbmd0aCA+IDBcbiAgICAgICYmIHR5cGVvZiBwcm9kdWNlclByb29mLmhhbmRvZmZJZCA9PT0gXCJzdHJpbmdcIlxuICAgICAgJiYgcHJvZHVjZXJQcm9vZi5oYW5kb2ZmSWQubGVuZ3RoID4gMFxuICAgICAgJiYgdHlwZW9mIHByb2R1Y2VyUHJvb2Yud29ya2VySWQgPT09IFwic3RyaW5nXCJcbiAgICAgICYmIHByb2R1Y2VyUHJvb2Yud29ya2VySWQubGVuZ3RoID4gMFxuICAgICAgJiYgTnVtYmVyLmlzU2FmZUludGVnZXIocHJvZHVjZXJQcm9vZi5oYW5kZWRPZmZBdE1zKVxuICAgICAgJiYgcHJvZHVjZXJQcm9vZi5oYW5kZWRPZmZBdE1zID49IDBcblxuICAgIGlmICghdmFsaWQpIHtcbiAgICAgIHRocm93IFZlbG9jaW91c0Vycm9yLnNhZmUoXCJCYWNrZ3JvdW5kIGpvYiBwcm9kdWNlciBwcm9vZiBpcyBpbnZhbGlkLlwiLCB7XG4gICAgICAgIGNvZGU6IFwiYmFja2dyb3VuZC1qb2ItcHJvZHVjZXItcHJvb2YtaW52YWxpZFwiXG4gICAgICB9KVxuICAgIH1cblxuICAgIHJldHVybiBPYmplY3QuZnJlZXplKHtcbiAgICAgIGhhbmRlZE9mZkF0TXM6IHByb2R1Y2VyUHJvb2YuaGFuZGVkT2ZmQXRNcyxcbiAgICAgIGhhbmRvZmZJZDogcHJvZHVjZXJQcm9vZi5oYW5kb2ZmSWQsXG4gICAgICBqb2JJZDogcHJvZHVjZXJQcm9vZi5qb2JJZCxcbiAgICAgIHdvcmtlcklkOiBwcm9kdWNlclByb29mLndvcmtlcklkXG4gICAgfSlcbiAgfVxuXG4gIC8qKlxuICAgKiBDb25maXJtcyBleGFjdCBhY3RpdmUgb3duZXJzaGlwIHdoaWxlIHRoZSBlbnF1ZXVlIHRyYW5zYWN0aW9uIGhvbGRzIHRoZVxuICAgKiBzaGFyZWQgbXV0YXRpb24gZmVuY2UgdXNlZCBieSB0ZXJtaW5hbCBwcm9kdWNlciB0cmFuc2l0aW9ucy5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9kYXRhYmFzZS9kcml2ZXJzL2Jhc2UuanNcIikuZGVmYXVsdH0gZGIgLSBUcmFuc2FjdGlvbiBjb25uZWN0aW9uLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vdHlwZXMuanNcIikuQmFja2dyb3VuZEpvYlByb2R1Y2VyUHJvb2Z9IHByb2R1Y2VyUHJvb2YgLSBFeGFjdCBwcm9kdWNlciBsZWFzZS5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgd2hpbGUgb3duZXJzaGlwIHJlbWFpbnMgZXhhY3QuXG4gICAqL1xuICBhc3luYyBfdmFsaWRhdGVPd25lZFByb2R1Y2VyUHJvb2YoZGIsIHByb2R1Y2VyUHJvb2YpIHtcbiAgICBjb25zdCBwcm9kdWNlciA9IGF3YWl0IHRoaXMuX2dldEpvYlJvd0J5SWQoZGIsIHByb2R1Y2VyUHJvb2Yuam9iSWQpXG4gICAgY29uc3Qgb3duZWQgPSBwcm9kdWNlclxuICAgICAgJiYgcHJvZHVjZXIuc3RhdHVzID09PSBcImhhbmRlZF9vZmZcIlxuICAgICAgJiYgcHJvZHVjZXIuaGFuZG9mZklkID09PSBwcm9kdWNlclByb29mLmhhbmRvZmZJZFxuICAgICAgJiYgcHJvZHVjZXIud29ya2VySWQgPT09IHByb2R1Y2VyUHJvb2Yud29ya2VySWRcbiAgICAgICYmIHByb2R1Y2VyLmhhbmRlZE9mZkF0TXMgPT09IHByb2R1Y2VyUHJvb2YuaGFuZGVkT2ZmQXRNc1xuXG4gICAgaWYgKCFvd25lZCkge1xuICAgICAgdGhyb3cgVmVsb2Npb3VzRXJyb3Iuc2FmZShcIkJhY2tncm91bmQgam9iIHByb2R1Y2VyIGhhbmRvZmYgaXMgbm8gbG9uZ2VyIG93bmVkLlwiLCB7XG4gICAgICAgIGNvZGU6IFwiYmFja2dyb3VuZC1qb2ItcHJvZHVjZXItaGFuZG9mZi1ub3Qtb3duZWRcIlxuICAgICAgfSlcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogUmVwbGFjZXMgdGhlIHF1ZXVlZCBvd25lciBvZiBhIHN0YWJsZSBzY2hlZHVsZSBrZXkgd2l0aCBhIG5ldyBvbmUtb2ZmIGpvYi5cbiAgICogQSBoYW5kZWQtb2ZmIG93bmVyIGlzIGxlZnQgcnVubmluZyBhbmQgcmVwb3J0ZWQgdHJ1dGhmdWxseS5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBPcHRpb25zLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gYXJncy5zY2hlZHVsZUtleSAtIFN0YWJsZSBsb2dpY2FsIHNjaGVkdWxlIGtleS5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGFyZ3Muam9iTmFtZSAtIEpvYiBuYW1lLlxuICAgKiBAcGFyYW0ge0FycmF5PFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gYXJncy5hcmdzIC0gQXJndW1lbnRzLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vdHlwZXMuanNcIikuQmFja2dyb3VuZEpvYk9wdGlvbnN9IFthcmdzLm9wdGlvbnNdIC0gT3B0aW9ucy5cbiAgICogQHJldHVybnMge1Byb21pc2U8aW1wb3J0KFwiLi90eXBlcy5qc1wiKS5CYWNrZ3JvdW5kSm9iUmVwbGFjZW1lbnRSZXN1bHQ+fSAtIFJlcGxhY2VtZW50IHJlc3VsdC5cbiAgICovXG4gIGFzeW5jIHJlcGxhY2VTY2hlZHVsZWQoe3NjaGVkdWxlS2V5LCBqb2JOYW1lLCBhcmdzLCBvcHRpb25zfSkge1xuICAgIGF3YWl0IHRoaXMuZW5zdXJlUmVhZHkoKVxuXG4gICAgY29uc3Qgbm9ybWFsaXplZFNjaGVkdWxlS2V5ID0gdGhpcy5fbm9ybWFsaXplU2NoZWR1bGVLZXkoc2NoZWR1bGVLZXkpXG4gICAgY29uc3QgcHJlcGFyZWRKb2IgPSB0aGlzLl9wcmVwYXJlSm9iKHtqb2JOYW1lLCBhcmdzLCBvcHRpb25zfSlcblxuICAgIHJldHVybiBhd2FpdCB0aGlzLl9zZXJpYWxpemVkQ291bnRNdXRhdGlvbihhc3luYyAoZGIpID0+IHtcbiAgICAgIGNvbnN0IG93bmVyUm93cyA9IGF3YWl0IGRiXG4gICAgICAgIC5uZXdRdWVyeSgpXG4gICAgICAgIC5mcm9tKFNDSEVEVUxFX0tFWVNfVEFCTEUpXG4gICAgICAgIC53aGVyZSh7c2NoZWR1bGVfa2V5OiBub3JtYWxpemVkU2NoZWR1bGVLZXl9KVxuICAgICAgICAubGltaXQoMSlcbiAgICAgICAgLnJlc3VsdHMoKVxuICAgICAgY29uc3Qgb3duZXJKb2JJZCA9IG93bmVyUm93c1swXSA/IFN0cmluZygvKiogQHR5cGUge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gKi8gKG93bmVyUm93c1swXSkuam9iX2lkKSA6IG51bGxcbiAgICAgIGNvbnN0IG93bmVySm9iID0gb3duZXJKb2JJZCA/IGF3YWl0IHRoaXMuX2dldEpvYlJvd0J5SWQoZGIsIG93bmVySm9iSWQpIDogbnVsbFxuICAgICAgLyoqIEB0eXBlIHtpbXBvcnQoXCIuL3R5cGVzLmpzXCIpLkJhY2tncm91bmRKb2JSZXBsYWNlbWVudFByZXZpb3VzU3RhdHVzfSAqL1xuICAgICAgbGV0IHByZXZpb3VzU3RhdHVzID0gbnVsbFxuICAgICAgbGV0IHByZXZpb3VzSm9iSWQgPSBudWxsXG5cbiAgICAgIGlmIChvd25lckpvYj8uc3RhdHVzID09PSBcInF1ZXVlZFwiKSB7XG4gICAgICAgIGNvbnN0IGFmZmVjdGVkUm93cyA9IGF3YWl0IHRoaXMuX3VwZGF0ZUFmZmVjdGVkUm93cyhkYiwge1xuICAgICAgICAgIHRhYmxlTmFtZTogSk9CU19UQUJMRSxcbiAgICAgICAgICBkYXRhOiB7c3RhdHVzOiBcImNhbmNlbGxlZFwifSxcbiAgICAgICAgICBjb25kaXRpb25zOiB7aWQ6IG93bmVySm9iLmlkLCBzdGF0dXM6IFwicXVldWVkXCJ9XG4gICAgICAgIH0pXG5cbiAgICAgICAgaWYgKGFmZmVjdGVkUm93cyA9PT0gMSkge1xuICAgICAgICAgIHByZXZpb3VzSm9iSWQgPSBvd25lckpvYi5pZFxuICAgICAgICAgIHByZXZpb3VzU3RhdHVzID0gXCJxdWV1ZWRcIlxuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgIGNvbnN0IGN1cnJlbnRPd25lckpvYiA9IGF3YWl0IHRoaXMuX2dldEpvYlJvd0J5SWQoZGIsIG93bmVySm9iLmlkKVxuXG4gICAgICAgICAgaWYgKGN1cnJlbnRPd25lckpvYj8uc3RhdHVzID09PSBcImhhbmRlZF9vZmZcIikge1xuICAgICAgICAgICAgcHJldmlvdXNKb2JJZCA9IGN1cnJlbnRPd25lckpvYi5pZFxuICAgICAgICAgICAgcHJldmlvdXNTdGF0dXMgPSBcImhhbmRlZF9vZmZcIlxuICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgICAgfSBlbHNlIGlmIChvd25lckpvYj8uc3RhdHVzID09PSBcImhhbmRlZF9vZmZcIikge1xuICAgICAgICBwcmV2aW91c0pvYklkID0gb3duZXJKb2IuaWRcbiAgICAgICAgcHJldmlvdXNTdGF0dXMgPSBcImhhbmRlZF9vZmZcIlxuICAgICAgfVxuXG4gICAgICBjb25zdCBzY2hlZHVsZU9yZGVyID0gYXdhaXQgdGhpcy5fbmV4dFNjaGVkdWxlT3JkZXIoZGIsIG5vcm1hbGl6ZWRTY2hlZHVsZUtleSlcblxuICAgICAgYXdhaXQgdGhpcy5faW5zZXJ0UHJlcGFyZWRKb2IoZGIsIHtwcmVwYXJlZEpvYiwgc2NoZWR1bGVLZXk6IG5vcm1hbGl6ZWRTY2hlZHVsZUtleSwgc2NoZWR1bGVPcmRlcn0pXG4gICAgICBhd2FpdCBkYi51cHNlcnQoe1xuICAgICAgICB0YWJsZU5hbWU6IFNDSEVEVUxFX0tFWVNfVEFCTEUsXG4gICAgICAgIGRhdGE6IHtzY2hlZHVsZV9rZXk6IG5vcm1hbGl6ZWRTY2hlZHVsZUtleSwgam9iX2lkOiBwcmVwYXJlZEpvYi5qb2JJZH0sXG4gICAgICAgIGNvbmZsaWN0Q29sdW1uczogW1wic2NoZWR1bGVfa2V5XCJdLFxuICAgICAgICB1cGRhdGVDb2x1bW5zOiBbXCJqb2JfaWRcIl1cbiAgICAgIH0pXG5cbiAgICAgIGlmIChwcmV2aW91c1N0YXR1cyAhPT0gXCJxdWV1ZWRcIikgYXdhaXQgdGhpcy5fcmVjb3JkQ291bnREZWx0YShkYiwge2FsbDogMSwgcXVldWVkOiAxfSlcbiAgICAgIHJldHVybiB7am9iSWQ6IHByZXBhcmVkSm9iLmpvYklkLCBwcmV2aW91c0pvYklkLCBwcmV2aW91c1N0YXR1c31cbiAgICB9LCB7XG4gICAgICBhZHZpc29yeUxvY2s6IHtcbiAgICAgICAgZmFpbHVyZU1lc3NhZ2U6IFwiRmFpbGVkIHRvIGFjcXVpcmUgYmFja2dyb3VuZCBqb2Igc2NoZWR1bGUta2V5IGxvY2tcIixcbiAgICAgICAgbmFtZTogdGhpcy5fc2NoZWR1bGVLZXlMb2NrTmFtZShub3JtYWxpemVkU2NoZWR1bGVLZXkpXG4gICAgICB9XG4gICAgfSlcbiAgfVxuXG4gIC8qKlxuICAgKiBDYW5jZWxzIHRoZSBxdWV1ZWQgb3duZXIgb2YgYSBzdGFibGUgc2NoZWR1bGUga2V5LiBBIGhhbmRlZC1vZmYgb3duZXIgaXNcbiAgICogZGV0YWNoZWQgYnV0IG5vdCBtYXJrZWQgc3RvcHBlZCBiZWNhdXNlIGV4ZWN1dGlvbiBtYXkgYWxyZWFkeSBiZSBydW5uaW5nLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gc2NoZWR1bGVLZXkgLSBTdGFibGUgbG9naWNhbCBzY2hlZHVsZSBrZXkuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPGltcG9ydChcIi4vdHlwZXMuanNcIikuQmFja2dyb3VuZEpvYkNhbmNlbGxhdGlvblJlc3VsdD59IC0gQ2FuY2VsbGF0aW9uIHJlc3VsdC5cbiAgICovXG4gIGFzeW5jIGNhbmNlbFNjaGVkdWxlZChzY2hlZHVsZUtleSkge1xuICAgIGF3YWl0IHRoaXMuZW5zdXJlUmVhZHkoKVxuXG4gICAgY29uc3Qgbm9ybWFsaXplZFNjaGVkdWxlS2V5ID0gdGhpcy5fbm9ybWFsaXplU2NoZWR1bGVLZXkoc2NoZWR1bGVLZXkpXG5cbiAgICByZXR1cm4gYXdhaXQgdGhpcy5fc2VyaWFsaXplZENvdW50TXV0YXRpb24oYXN5bmMgKGRiKSA9PiB7XG4gICAgICBjb25zdCBvd25lclJvd3MgPSBhd2FpdCBkYlxuICAgICAgICAubmV3UXVlcnkoKVxuICAgICAgICAuZnJvbShTQ0hFRFVMRV9LRVlTX1RBQkxFKVxuICAgICAgICAud2hlcmUoe3NjaGVkdWxlX2tleTogbm9ybWFsaXplZFNjaGVkdWxlS2V5fSlcbiAgICAgICAgLmxpbWl0KDEpXG4gICAgICAgIC5yZXN1bHRzKClcblxuICAgICAgaWYgKCFvd25lclJvd3NbMF0pIHJldHVybiB7am9iSWQ6IG51bGwsIG91dGNvbWU6IFwibm90X2ZvdW5kXCJ9XG5cbiAgICAgIGNvbnN0IGpvYklkID0gU3RyaW5nKC8qKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSAqLyAob3duZXJSb3dzWzBdKS5qb2JfaWQpXG4gICAgICBjb25zdCBqb2IgPSBhd2FpdCB0aGlzLl9nZXRKb2JSb3dCeUlkKGRiLCBqb2JJZClcblxuICAgICAgaWYgKGpvYj8uc3RhdHVzID09PSBcInF1ZXVlZFwiKSB7XG4gICAgICAgIGNvbnN0IGFmZmVjdGVkUm93cyA9IGF3YWl0IHRoaXMuX3VwZGF0ZUFmZmVjdGVkUm93cyhkYiwge1xuICAgICAgICAgIHRhYmxlTmFtZTogSk9CU19UQUJMRSxcbiAgICAgICAgICBkYXRhOiB7c3RhdHVzOiBcImNhbmNlbGxlZFwifSxcbiAgICAgICAgICBjb25kaXRpb25zOiB7aWQ6IGpvYi5pZCwgc3RhdHVzOiBcInF1ZXVlZFwifVxuICAgICAgICB9KVxuXG4gICAgICAgIGlmIChhZmZlY3RlZFJvd3MgPT09IDEpIHtcbiAgICAgICAgICBhd2FpdCB0aGlzLl9yZWxlYXNlU2NoZWR1bGVPd25lcnNoaXAoZGIsIHtqb2JJZCwgc2NoZWR1bGVLZXk6IG5vcm1hbGl6ZWRTY2hlZHVsZUtleX0pXG4gICAgICAgICAgYXdhaXQgdGhpcy5fcmVjb3JkU3RhdHVzVHJhbnNpdGlvbihkYiwgXCJxdWV1ZWRcIiwgXCJjYW5jZWxsZWRcIilcblxuICAgICAgICAgIHJldHVybiB7am9iSWQsIG91dGNvbWU6IFwiY2FuY2VsbGVkXCJ9XG4gICAgICAgIH1cbiAgICAgIH1cblxuICAgICAgY29uc3QgY3VycmVudEpvYiA9IGF3YWl0IHRoaXMuX2dldEpvYlJvd0J5SWQoZGIsIGpvYklkKVxuXG4gICAgICBhd2FpdCB0aGlzLl9yZWxlYXNlU2NoZWR1bGVPd25lcnNoaXAoZGIsIHtqb2JJZCwgc2NoZWR1bGVLZXk6IG5vcm1hbGl6ZWRTY2hlZHVsZUtleX0pXG5cbiAgICAgIGlmIChjdXJyZW50Sm9iPy5zdGF0dXMgPT09IFwiaGFuZGVkX29mZlwiKSByZXR1cm4ge2pvYklkLCBvdXRjb21lOiBcImhhbmRlZF9vZmZcIn1cbiAgICAgIHJldHVybiB7am9iSWQ6IG51bGwsIG91dGNvbWU6IFwibm90X2ZvdW5kXCJ9XG4gICAgfSwge1xuICAgICAgYWR2aXNvcnlMb2NrOiB7XG4gICAgICAgIGZhaWx1cmVNZXNzYWdlOiBcIkZhaWxlZCB0byBhY3F1aXJlIGJhY2tncm91bmQgam9iIHNjaGVkdWxlLWtleSBsb2NrXCIsXG4gICAgICAgIG5hbWU6IHRoaXMuX3NjaGVkdWxlS2V5TG9ja05hbWUobm9ybWFsaXplZFNjaGVkdWxlS2V5KVxuICAgICAgfVxuICAgIH0pXG4gIH1cblxuICAvKipcbiAgICogUmVhZHMgc3RhYmxlIG93bmVyc2hpcCBhbmQgb3B0aW9uYWwgbGF0ZXN0IHRlcm1pbmFsIGhpc3RvcnkgaW4gb25lIGZlbmNlZCB0cmFuc2FjdGlvbi5cbiAgICogQHBhcmFtIHtzdHJpbmd9IHNjaGVkdWxlS2V5IC0gU3RhYmxlIGxvZ2ljYWwgc2NoZWR1bGUga2V5LlxuICAgKiBAcGFyYW0ge3tpbmNsdWRlTGF0ZXN0VGVybWluYWw/OiBib29sZWFufX0gW29wdGlvbnNdIC0gTG9va3VwIG9wdGlvbnMuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPGltcG9ydChcIi4vdHlwZXMuanNcIikuQmFja2dyb3VuZEpvYlNjaGVkdWxlZExvb2t1cFJlc3VsdD59IC0gTm9ybWFsaXplZCBwdWJsaWMgam9icy5cbiAgICovXG4gIGFzeW5jIGdldFNjaGVkdWxlZEpvYihzY2hlZHVsZUtleSwge2luY2x1ZGVMYXRlc3RUZXJtaW5hbCA9IGZhbHNlfSA9IHt9KSB7XG4gICAgYXdhaXQgdGhpcy5lbnN1cmVSZWFkeSgpXG5cbiAgICBjb25zdCBub3JtYWxpemVkU2NoZWR1bGVLZXkgPSB0aGlzLl9ub3JtYWxpemVTY2hlZHVsZUtleShzY2hlZHVsZUtleSlcblxuICAgIGlmICh0eXBlb2YgaW5jbHVkZUxhdGVzdFRlcm1pbmFsICE9PSBcImJvb2xlYW5cIikge1xuICAgICAgdGhyb3cgVmVsb2Npb3VzRXJyb3Iuc2FmZShcImJhY2tncm91bmQgam9iIGluY2x1ZGVMYXRlc3RUZXJtaW5hbCBtdXN0IGJlIGEgYm9vbGVhblwiKVxuICAgIH1cblxuICAgIHJldHVybiBhd2FpdCB0aGlzLl9zZXJpYWxpemVkQ291bnRNdXRhdGlvbihhc3luYyAoZGIpID0+IHtcbiAgICAgIHJldHVybiBhd2FpdCB0aGlzLl9zY2hlZHVsZWRKb2JMb29rdXAoZGIsIHtcbiAgICAgICAgaW5jbHVkZUxhdGVzdFRlcm1pbmFsLFxuICAgICAgICBzY2hlZHVsZUtleTogbm9ybWFsaXplZFNjaGVkdWxlS2V5XG4gICAgICB9KVxuICAgIH0sIHtcbiAgICAgIGFkdmlzb3J5TG9jazoge1xuICAgICAgICBmYWlsdXJlTWVzc2FnZTogXCJGYWlsZWQgdG8gYWNxdWlyZSBiYWNrZ3JvdW5kIGpvYiBzY2hlZHVsZS1rZXkgbG9ja1wiLFxuICAgICAgICBuYW1lOiB0aGlzLl9zY2hlZHVsZUtleUxvY2tOYW1lKG5vcm1hbGl6ZWRTY2hlZHVsZUtleSlcbiAgICAgIH1cbiAgICB9KVxuICB9XG5cbiAgLyoqXG4gICAqIE1vdmVzIG9ubHkgYSBmdXR1cmUgcXVldWVkIHN0YWJsZSBvd25lciB0byB0aGUgY3VycmVudCB0aW1lLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gc2NoZWR1bGVLZXkgLSBTdGFibGUgbG9naWNhbCBzY2hlZHVsZSBrZXkuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPGltcG9ydChcIi4vdHlwZXMuanNcIikuQmFja2dyb3VuZEpvYldha2VSZXN1bHQ+fSAtIEV4YWN0IHdha2Ugb3V0Y29tZS5cbiAgICovXG4gIGFzeW5jIHdha2VTY2hlZHVsZWQoc2NoZWR1bGVLZXkpIHtcbiAgICBhd2FpdCB0aGlzLmVuc3VyZVJlYWR5KClcblxuICAgIGNvbnN0IG5vcm1hbGl6ZWRTY2hlZHVsZUtleSA9IHRoaXMuX25vcm1hbGl6ZVNjaGVkdWxlS2V5KHNjaGVkdWxlS2V5KVxuXG4gICAgcmV0dXJuIGF3YWl0IHRoaXMuX3NlcmlhbGl6ZWRDb3VudE11dGF0aW9uKGFzeW5jIChkYikgPT4ge1xuICAgICAgY29uc3Qgam9iID0gYXdhaXQgdGhpcy5fc2NoZWR1bGVkT3duZXJKb2IoZGIsIG5vcm1hbGl6ZWRTY2hlZHVsZUtleSlcblxuICAgICAgaWYgKCFqb2IgfHwgKGpvYi5zdGF0dXMgIT09IFwicXVldWVkXCIgJiYgam9iLnN0YXR1cyAhPT0gXCJoYW5kZWRfb2ZmXCIpKSByZXR1cm4ge2pvYklkOiBudWxsLCBvdXRjb21lOiBcIm5vdF9mb3VuZFwifVxuICAgICAgaWYgKGpvYi5zdGF0dXMgPT09IFwiaGFuZGVkX29mZlwiKSByZXR1cm4ge2pvYklkOiBqb2IuaWQsIG91dGNvbWU6IFwiaGFuZGVkX29mZlwifVxuXG4gICAgICBjb25zdCBub3dNcyA9IHRoaXMuY2xvY2subm93KClcblxuICAgICAgaWYgKE51bWJlcihqb2Iuc2NoZWR1bGVkQXRNcykgPD0gbm93TXMpIHJldHVybiB7am9iSWQ6IGpvYi5pZCwgb3V0Y29tZTogXCJhbHJlYWR5X2R1ZVwifVxuXG4gICAgICBjb25zdCBhZmZlY3RlZFJvd3MgPSBhd2FpdCB0aGlzLl91cGRhdGVBZmZlY3RlZFJvd3MoZGIsIHtcbiAgICAgICAgdGFibGVOYW1lOiBKT0JTX1RBQkxFLFxuICAgICAgICBkYXRhOiB7c2NoZWR1bGVkX2F0X21zOiBub3dNc30sXG4gICAgICAgIGNvbmRpdGlvbnM6IHtpZDogam9iLmlkLCBzY2hlZHVsZWRfYXRfbXM6IGpvYi5zY2hlZHVsZWRBdE1zLCBzdGF0dXM6IFwicXVldWVkXCJ9XG4gICAgICB9KVxuXG4gICAgICBpZiAoYWZmZWN0ZWRSb3dzID09PSAxKSByZXR1cm4ge2pvYklkOiBqb2IuaWQsIG91dGNvbWU6IFwid29rZW5cIn1cblxuICAgICAgY29uc3QgY3VycmVudEpvYiA9IGF3YWl0IHRoaXMuX3NjaGVkdWxlZE93bmVySm9iKGRiLCBub3JtYWxpemVkU2NoZWR1bGVLZXkpXG5cbiAgICAgIGlmIChjdXJyZW50Sm9iPy5zdGF0dXMgPT09IFwiaGFuZGVkX29mZlwiKSByZXR1cm4ge2pvYklkOiBjdXJyZW50Sm9iLmlkLCBvdXRjb21lOiBcImhhbmRlZF9vZmZcIn1cbiAgICAgIGlmIChjdXJyZW50Sm9iPy5zdGF0dXMgPT09IFwicXVldWVkXCIgJiYgTnVtYmVyKGN1cnJlbnRKb2Iuc2NoZWR1bGVkQXRNcykgPD0gbm93TXMpIHtcbiAgICAgICAgcmV0dXJuIHtqb2JJZDogY3VycmVudEpvYi5pZCwgb3V0Y29tZTogXCJhbHJlYWR5X2R1ZVwifVxuICAgICAgfVxuXG4gICAgICByZXR1cm4ge2pvYklkOiBudWxsLCBvdXRjb21lOiBcIm5vdF9mb3VuZFwifVxuICAgIH0sIHtcbiAgICAgIGFkdmlzb3J5TG9jazoge1xuICAgICAgICBmYWlsdXJlTWVzc2FnZTogXCJGYWlsZWQgdG8gYWNxdWlyZSBiYWNrZ3JvdW5kIGpvYiBzY2hlZHVsZS1rZXkgbG9ja1wiLFxuICAgICAgICBuYW1lOiB0aGlzLl9zY2hlZHVsZUtleUxvY2tOYW1lKG5vcm1hbGl6ZWRTY2hlZHVsZUtleSlcbiAgICAgIH1cbiAgICB9KVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgbmV4dCBhdmFpbGFibGUgam9iLlxuICAgKiBAcGFyYW0ge29iamVjdH0gW2FyZ3NdIC0gT3B0aW9ucy5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL3R5cGVzLmpzXCIpLkJhY2tncm91bmRKb2JFeGVjdXRpb25Nb2RlIHwgaW1wb3J0KFwiLi90eXBlcy5qc1wiKS5CYWNrZ3JvdW5kSm9iRXhlY3V0aW9uTW9kZVtdfSBbYXJncy5leGVjdXRpb25Nb2RlXSAtIEV4ZWN1dGlvbiBtb2RlIG9yIG1vZGVzIHRvIG1hdGNoLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxpbXBvcnQoXCIuL3R5cGVzLmpzXCIpLkJhY2tncm91bmRKb2JSb3cgfCBudWxsPn0gLSBOZXh0IGpvYi5cbiAgICovXG4gIGFzeW5jIG5leHRBdmFpbGFibGVKb2IoYXJncyA9IHt9KSB7XG4gICAgYXdhaXQgdGhpcy5lbnN1cmVSZWFkeSgpXG5cbiAgICByZXR1cm4gYXdhaXQgdGhpcy5fd2l0aERiKGFzeW5jIChkYikgPT4ge1xuICAgICAgcmV0dXJuIGF3YWl0IHRoaXMuX25leHRRdWV1ZWRKb2Ioe1xuICAgICAgICBkYixcbiAgICAgICAgc2NoZWR1bGVkQXRPcGVyYXRvcjogXCI8PVwiLFxuICAgICAgICBleGVjdXRpb25Nb2RlOiBhcmdzLmV4ZWN1dGlvbk1vZGVcbiAgICAgIH0pXG4gICAgfSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSZXR1cm5zIHRoZSBzb29uZXN0IGZ1dHVyZS1zY2hlZHVsZWQgcXVldWVkIGpvYiAob25lIHdob3NlXG4gICAqIGBzY2hlZHVsZWRfYXRfbXNgIGlzIGluIHRoZSBmdXR1cmUpLCBvciBudWxsIHdoZW4gdGhlcmUgYXJlIG5vXG4gICAqIGZ1dHVyZS1zY2hlZHVsZWQgam9icy4gVXNlZCBieSB0aGUgZXZlbnQtZHJpdmVuIGRpc3BhdGNoZXIgdG8gYXJtIGFcbiAgICogYHNldFRpbWVvdXRgIGZvciB0aGUgZXhhY3QgbW9tZW50IHRoZSBuZXh0IHNjaGVkdWxlZCBqb2IgYmVjb21lc1xuICAgKiBlbGlnaWJsZSwgcmVwbGFjaW5nIHRoZSBsZWdhY3kgMS1zZWNvbmQgcG9sbGluZyBsb29wLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxpbXBvcnQoXCIuL3R5cGVzLmpzXCIpLkJhY2tncm91bmRKb2JSb3cgfCBudWxsPn0gLSBTb29uZXN0IGZ1dHVyZS1zY2hlZHVsZWQgam9iLCBvciBudWxsLlxuICAgKi9cbiAgYXN5bmMgbmV4dFNjaGVkdWxlZEpvYigpIHtcbiAgICBhd2FpdCB0aGlzLmVuc3VyZVJlYWR5KClcblxuICAgIHJldHVybiBhd2FpdCB0aGlzLl93aXRoRGIoYXN5bmMgKGRiKSA9PiB7XG4gICAgICByZXR1cm4gYXdhaXQgdGhpcy5fbmV4dFF1ZXVlZEpvYih7ZGIsIHNjaGVkdWxlZEF0T3BlcmF0b3I6IFwiPlwifSlcbiAgICB9KVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgbmV4dCBxdWV1ZWQgam9iLlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIE9wdGlvbnMuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vZGF0YWJhc2UvZHJpdmVycy9iYXNlLmpzXCIpLmRlZmF1bHR9IGFyZ3MuZGIgLSBEYXRhYmFzZSBjb25uZWN0aW9uLlxuICAgKiBAcGFyYW0ge1wiPD1cIiB8IFwiPlwifSBhcmdzLnNjaGVkdWxlZEF0T3BlcmF0b3IgLSBTY2hlZHVsZWQgdGltZXN0YW1wIG9wZXJhdG9yLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vdHlwZXMuanNcIikuQmFja2dyb3VuZEpvYkV4ZWN1dGlvbk1vZGUgfCBpbXBvcnQoXCIuL3R5cGVzLmpzXCIpLkJhY2tncm91bmRKb2JFeGVjdXRpb25Nb2RlW119IFthcmdzLmV4ZWN1dGlvbk1vZGVdIC0gRXhlY3V0aW9uIG1vZGUgb3IgbW9kZXMgdG8gbWF0Y2guXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPGltcG9ydChcIi4vdHlwZXMuanNcIikuQmFja2dyb3VuZEpvYlJvdyB8IG51bGw+fSAtIE5leHQgbWF0Y2hpbmcgcXVldWVkIGpvYi5cbiAgICovXG4gIGFzeW5jIF9uZXh0UXVldWVkSm9iKHtkYiwgc2NoZWR1bGVkQXRPcGVyYXRvciwgZXhlY3V0aW9uTW9kZX0pIHtcbiAgICBjb25zdCBub3cgPSB0aGlzLmNsb2NrLm5vdygpXG4gICAgbGV0IHF1ZXJ5ID0gZGJcbiAgICAgIC5uZXdRdWVyeSgpXG4gICAgICAuZnJvbShKT0JTX1RBQkxFKVxuICAgICAgLndoZXJlKHtzdGF0dXM6IFwicXVldWVkXCJ9KVxuICAgICAgLndoZXJlKGBzY2hlZHVsZWRfYXRfbXMgJHtzY2hlZHVsZWRBdE9wZXJhdG9yfSAke2RiLnF1b3RlKG5vdyl9YClcblxuICAgIGlmIChzY2hlZHVsZWRBdE9wZXJhdG9yID09PSBcIjw9XCIpIHtcbiAgICAgIGNvbnN0IGpvYnNUYWJsZSA9IGRiLnF1b3RlVGFibGUoSk9CU19UQUJMRSlcbiAgICAgIGNvbnN0IGNvbmN1cnJlbmN5VGFibGUgPSBkYi5xdW90ZVRhYmxlKENPTkNVUlJFTkNZX1RBQkxFKVxuICAgICAgcXVlcnkgPSBxdWVyeS53aGVyZShcbiAgICAgICAgYCgke2pvYnNUYWJsZX0uJHtkYi5xdW90ZUNvbHVtbihcImNvbmN1cnJlbmN5X2tleVwiKX0gSVMgTlVMTCBPUiBFWElTVFMgKGAgK1xuICAgICAgICBgU0VMRUNUIDEgRlJPTSAke2NvbmN1cnJlbmN5VGFibGV9IFdIRVJFIGAgK1xuICAgICAgICBgJHtjb25jdXJyZW5jeVRhYmxlfS4ke2RiLnF1b3RlQ29sdW1uKFwiY29uY3VycmVuY3lfa2V5XCIpfSA9ICR7am9ic1RhYmxlfS4ke2RiLnF1b3RlQ29sdW1uKFwiY29uY3VycmVuY3lfa2V5XCIpfSBBTkQgYCArXG4gICAgICAgIGAke2NvbmN1cnJlbmN5VGFibGV9LiR7ZGIucXVvdGVDb2x1bW4oXCJhY3RpdmVfY291bnRcIil9IDwgJHtjb25jdXJyZW5jeVRhYmxlfS4ke2RiLnF1b3RlQ29sdW1uKFwibWF4X2NvbmN1cnJlbmN5XCIpfSkpYFxuICAgICAgKVxuICAgIH1cblxuICAgIGlmIChleGVjdXRpb25Nb2RlKSBxdWVyeSA9IHRoaXMuX3doZXJlRXhlY3V0aW9uTW9kZSh7ZGIsIGV4ZWN1dGlvbk1vZGUsIHF1ZXJ5fSlcblxuICAgIGlmIChzY2hlZHVsZWRBdE9wZXJhdG9yID09PSBcIjw9XCIpIHtcbiAgICAgIGNvbnN0IHByaW9yaXR5T3JkZXIgPSB0aGlzLl9xdWV1ZVByaW9yaXR5T3JkZXJTcWwoZGIpXG5cbiAgICAgIGlmIChwcmlvcml0eU9yZGVyKSBxdWVyeSA9IHF1ZXJ5Lm9yZGVyKGAke3ByaW9yaXR5T3JkZXJ9IERFU0NgKVxuXG4gICAgICAvLyBKb2ItbGV2ZWwgcHJpb3JpdHkgYXBwbGllcyBpbnNpZGUgdGhlIHF1ZXVlIHJhbmtpbmcgYWJvdmUuIEEgcmV0cnkgaXNcbiAgICAgIC8vIHN0b3JlZCBhdCBSRVRSWV9CQUNLR1JPVU5EX0pPQl9QUklPUklUWSAoLTEpLCBzbyBpdCBzb3J0cyBiZWhpbmQgZXZlcnlcbiAgICAgIC8vIGZpcnN0IGF0dGVtcHQgd2l0aG91dCBkZWxheWluZyBpdHNlbGYgZnVydGhlciB0aGFuIHRoZSBiYWNrb2ZmIGFscmVhZHlcbiAgICAgIC8vIGRvZXMuIENPQUxFU0NFIGNvdmVycyByb3dzIHdyaXR0ZW4gYmVmb3JlIHRoZSBjb2x1bW4gZXhpc3RlZC5cbiAgICAgIHF1ZXJ5ID0gcXVlcnkub3JkZXIoYENPQUxFU0NFKCR7ZGIucXVvdGVDb2x1bW4oXCJwcmlvcml0eVwiKX0sICR7REVGQVVMVF9CQUNLR1JPVU5EX0pPQl9QUklPUklUWX0pIERFU0NgKVxuICAgIH1cblxuICAgIHF1ZXJ5ID0gcXVlcnlcbiAgICAgIC5vcmRlcihcInNjaGVkdWxlZF9hdF9tcyBBU0NcIilcbiAgICAgIC5vcmRlcihcImNyZWF0ZWRfYXRfbXMgQVNDXCIpXG4gICAgICAubGltaXQoMSlcblxuICAgIGNvbnN0IHJvd3MgPSBhd2FpdCBxdWVyeS5yZXN1bHRzKClcbiAgICBjb25zdCByb3cgPSByb3dzWzBdXG5cbiAgICBpZiAoIXJvdykgcmV0dXJuIG51bGxcblxuICAgIHJldHVybiB0aGlzLl9ub3JtYWxpemVKb2JSb3cocm93KVxuICB9XG5cbiAgLyoqXG4gICAqIEJ1aWxkcyBhIHJhdyBTUUwgT1JERVIgQlkgZXhwcmVzc2lvbiByYW5raW5nIHF1ZXVlZCBqb2JzIGJ5IHRoZWlyIHF1ZXVlJ3NcbiAgICogY29uZmlndXJlZCBwcmlvcml0eSAoYGJhY2tncm91bmRKb2JzLnF1ZXVlc1txdWV1ZV0ucHJpb3JpdHlgLCBkZWZhdWx0IGAwYCksXG4gICAqIHNvIHRoZSBkaXNwYXRjaGVyIHBpY2tzIGhpZ2hlci1wcmlvcml0eSBxdWV1ZXMgZmlyc3QgcmVnYXJkbGVzcyBvZiBlbnF1ZXVlXG4gICAqIG9yZGVyLiBPbmx5IGFwcGxpZWQgdG8gdGhlIGRpc3BhdGNoIHBhdGggKGBzY2hlZHVsZWRBdE9wZXJhdG9yID09PSBcIjw9XCJgKTtcbiAgICogdGhlIGZ1dHVyZS1zY2hlZHVsZWQgbG9va3VwIG11c3Qgc3RheSBzdHJpY3RseSB0aW1lLW9yZGVyZWQuIENvbXBvc2VzIHdpdGhcbiAgICogdGhlIGNvbmN1cnJlbmN5IEVYSVNUUyBmaWx0ZXI6IGEgaGlnaGVyLXByaW9yaXR5IHF1ZXVlIGFscmVhZHkgYXQgaXRzIGNhcCBpc1xuICAgKiBmaWx0ZXJlZCBvdXQsIHNvIGRpc3BhdGNoIGZhbGxzIHRocm91Z2ggdG8gdGhlIG5leHQgZWxpZ2libGUgbG93ZXItcHJpb3JpdHlcbiAgICogam9iLiBSZXR1cm5zIG51bGwgd2hlbiBubyBxdWV1ZSBjb25maWd1cmVzIGEgbm9uLXplcm8gcHJpb3JpdHkgc28gdGhlIHBsYWluXG4gICAqIEZJRk8gb3JkZXJpbmcgaXMgbGVmdCB1bnRvdWNoZWQgKGFuZCBubyBuZWVkbGVzcyBmaWxlc29ydCBpcyBpbnRyb2R1Y2VkKS5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9kYXRhYmFzZS9kcml2ZXJzL2Jhc2UuanNcIikuZGVmYXVsdH0gZGIgLSBEYXRhYmFzZSBjb25uZWN0aW9uLlxuICAgKiBAcmV0dXJucyB7c3RyaW5nIHwgbnVsbH0gLSBSYXcgU1FMIENBU0UgZXhwcmVzc2lvbiwgb3IgbnVsbCB3aGVuIG5vIHF1ZXVlIGlzIHByaW9yaXRpemVkLlxuICAgKi9cbiAgX3F1ZXVlUHJpb3JpdHlPcmRlclNxbChkYikge1xuICAgIGNvbnN0IHF1ZXVlcyA9IHRoaXMuY29uZmlndXJhdGlvbi5nZXRCYWNrZ3JvdW5kSm9ic0NvbmZpZygpLnF1ZXVlcyB8fCB7fVxuICAgIC8qKiBAdHlwZSB7QXJyYXk8W3N0cmluZywgbnVtYmVyXT59ICovXG4gICAgY29uc3QgcHJpb3JpdGl6ZWQgPSBbXVxuXG4gICAgZm9yIChjb25zdCBbcXVldWUsIHF1ZXVlQ29uZmlnXSBvZiBPYmplY3QuZW50cmllcyhxdWV1ZXMpKSB7XG4gICAgICBjb25zdCBwcmlvcml0eSA9IHF1ZXVlQ29uZmlnPy5wcmlvcml0eVxuXG4gICAgICBpZiAoTnVtYmVyLmlzRmluaXRlKHByaW9yaXR5KSAmJiBOdW1iZXIocHJpb3JpdHkpICE9PSAwKSBwcmlvcml0aXplZC5wdXNoKFtxdWV1ZSwgTnVtYmVyKHByaW9yaXR5KV0pXG4gICAgfVxuXG4gICAgaWYgKHByaW9yaXRpemVkLmxlbmd0aCA9PT0gMCkgcmV0dXJuIG51bGxcblxuICAgIGNvbnN0IHF1ZXVlQ29sdW1uID0gZGIucXVvdGVDb2x1bW4oXCJxdWV1ZVwiKVxuICAgIGNvbnN0IHdoZW5zID0gcHJpb3JpdGl6ZWRcbiAgICAgIC5tYXAoKFtxdWV1ZSwgcHJpb3JpdHldKSA9PiBgV0hFTiAke2RiLnF1b3RlKHF1ZXVlKX0gVEhFTiAke3ByaW9yaXR5fWApXG4gICAgICAuam9pbihcIiBcIilcblxuICAgIHJldHVybiBgQ0FTRSBDT0FMRVNDRSgke3F1ZXVlQ29sdW1ufSwgJHtkYi5xdW90ZShERUZBVUxUX0JBQ0tHUk9VTkRfSk9CX1FVRVVFKX0pICR7d2hlbnN9IEVMU0UgMCBFTkRgXG4gIH1cblxuICAvKipcbiAgICogUnVucyBnZXQgam9iLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gam9iSWQgLSBKb2IgaWQuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPGltcG9ydChcIi4vdHlwZXMuanNcIikuQmFja2dyb3VuZEpvYlJvdyB8IG51bGw+fSAtIEpvYiByb3cuXG4gICAqL1xuICBhc3luYyBnZXRKb2Ioam9iSWQpIHtcbiAgICBhd2FpdCB0aGlzLmVuc3VyZVJlYWR5KClcblxuICAgIHJldHVybiBhd2FpdCB0aGlzLl93aXRoRGIoYXN5bmMgKGRiKSA9PiB7XG4gICAgICBjb25zdCBxdWVyeSA9IGRiXG4gICAgICAgIC5uZXdRdWVyeSgpXG4gICAgICAgIC5mcm9tKEpPQlNfVEFCTEUpXG4gICAgICAgIC53aGVyZSh7aWQ6IGpvYklkfSlcbiAgICAgICAgLmxpbWl0KDEpXG5cbiAgICAgIGNvbnN0IHJvd3MgPSBhd2FpdCBxdWVyeS5yZXN1bHRzKClcbiAgICAgIGNvbnN0IHJvdyA9IHJvd3NbMF1cblxuICAgICAgaWYgKCFyb3cpIHJldHVybiBudWxsXG5cbiAgICAgIHJldHVybiB0aGlzLl9ub3JtYWxpemVKb2JSb3cocm93KVxuICAgIH0pXG4gIH1cblxuICAvKipcbiAgICogQ291bnRzIGpvYnMgZ3JvdXBlZCBieSBzdGF0dXMuIFVzZWQgYnkgdGhlIGRhc2hib2FyZCBvdmVydmlldy5cbiAgICogQHJldHVybnMge1Byb21pc2U8UmVjb3JkPHN0cmluZywgbnVtYmVyPj59IC0gQ291bnRzIGtleWVkIGJ5IHN0YXR1cy5cbiAgICovXG4gIGFzeW5jIGNvdW50c0J5U3RhdHVzKCkge1xuICAgIGF3YWl0IHRoaXMuZW5zdXJlUmVhZHkoKVxuXG4gICAgcmV0dXJuIGF3YWl0IHRoaXMuX3dpdGhEYihhc3luYyAoZGIpID0+IHtcbiAgICAgIGNvbnN0IHJvd3MgPSBhd2FpdCBkYlxuICAgICAgICAubmV3UXVlcnkoKVxuICAgICAgICAuZnJvbShKT0JTX1RBQkxFKVxuICAgICAgICAuc2VsZWN0KFwic3RhdHVzXCIpXG4gICAgICAgIC5zZWxlY3QoXCJDT1VOVCgqKSBBUyBjb3VudFwiKVxuICAgICAgICAuZ3JvdXAoXCJzdGF0dXNcIilcbiAgICAgICAgLnJlc3VsdHMoKVxuXG4gICAgICAvKipcbiAgICAgICAqIENvdW50cy5cbiAgICAgICAqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBudW1iZXI+fSAqL1xuICAgICAgY29uc3QgY291bnRzID0ge31cblxuICAgICAgZm9yIChjb25zdCByb3cgb2Ygcm93cykge1xuICAgICAgICBjb25zdCB0eXBlZFJvdyA9IC8qKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSAqLyAocm93KVxuXG4gICAgICAgIGNvdW50c1tTdHJpbmcodHlwZWRSb3cuc3RhdHVzKV0gPSB0aGlzLl9ub3JtYWxpemVOdW1iZXIodHlwZWRSb3cuY291bnQpIHx8IDBcbiAgICAgIH1cblxuICAgICAgcmV0dXJuIGNvdW50c1xuICAgIH0pXG4gIH1cblxuICAvKipcbiAgICogUmV0dXJucyB0aGUgYXV0aG9yaXRhdGl2ZSBkYXNoYm9hcmQgY291bnQgc25hcHNob3QgYW5kIGl0cyBtYXRjaGluZyBkdXJhYmxlXG4gICAqIHJldmlzaW9uLiBMb2NraW5nIHRoZSByZXZpc2lvbiByb3cgYmVmb3JlIGNvdW50aW5nIHByZXZlbnRzIGEgd3JpdGVyIGZyb21cbiAgICogY29tbWl0dGluZyBiZXR3ZWVuIHRoZSBjb3VudCBxdWVyeSBhbmQgcmV2aXNpb24gcmVhZC5cbiAgICogQHJldHVybnMge1Byb21pc2U8e2NvdW50czogUmVjb3JkPHN0cmluZywgbnVtYmVyPiwgcmV2aXNpb246IG51bWJlciwgdG90YWw6IG51bWJlcn0+fSBTbmFwc2hvdC5cbiAgICovXG4gIGFzeW5jIGNvdW50U25hcHNob3QoKSB7XG4gICAgYXdhaXQgdGhpcy5lbnN1cmVSZWFkeSgpXG5cbiAgICByZXR1cm4gYXdhaXQgdGhpcy5fc2VyaWFsaXplZENvdW50TXV0YXRpb24oYXN5bmMgKGRiKSA9PiB7XG4gICAgICByZXR1cm4gYXdhaXQgdGhpcy5fY291bnRTbmFwc2hvdE9uTG9ja2VkQ29ubmVjdGlvbihkYilcbiAgICB9KVxuICB9XG5cbiAgLyoqXG4gICAqIENvdW50cyBqb2JzIG1hdGNoaW5nIHRoZSBnaXZlbiBmaWx0ZXJzLlxuICAgKiBAcGFyYW0ge29iamVjdH0gW2FyZ3NdIC0gT3B0aW9ucy5cbiAgICogQHBhcmFtIHtzdHJpbmd9IFthcmdzLnN0YXR1c10gLSBGaWx0ZXIgYnkgc3RhdHVzLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gW2FyZ3Muam9iTmFtZV0gLSBGaWx0ZXIgYnkgam9iIG5hbWUuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPG51bWJlcj59IC0gTWF0Y2hpbmcgam9iIGNvdW50LlxuICAgKi9cbiAgYXN5bmMgY291bnRKb2JzKHtzdGF0dXMsIGpvYk5hbWV9ID0ge30pIHtcbiAgICBhd2FpdCB0aGlzLmVuc3VyZVJlYWR5KClcblxuICAgIHJldHVybiBhd2FpdCB0aGlzLl93aXRoRGIoYXN5bmMgKGRiKSA9PiB7XG4gICAgICBsZXQgcXVlcnkgPSBkYi5uZXdRdWVyeSgpLmZyb20oSk9CU19UQUJMRSkuc2VsZWN0KFwiQ09VTlQoKikgQVMgY291bnRcIilcblxuICAgICAgaWYgKHN0YXR1cykgcXVlcnkgPSBxdWVyeS53aGVyZSh7c3RhdHVzfSlcbiAgICAgIGlmIChqb2JOYW1lKSBxdWVyeSA9IHF1ZXJ5LndoZXJlKHtqb2JfbmFtZTogam9iTmFtZX0pXG5cbiAgICAgIGNvbnN0IHJvd3MgPSBhd2FpdCBxdWVyeS5yZXN1bHRzKClcbiAgICAgIGNvbnN0IGNvdW50Um93ID0gLyoqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59ICovIChyb3dzWzBdIHx8IHt9KVxuXG4gICAgICByZXR1cm4gdGhpcy5fbm9ybWFsaXplTnVtYmVyKGNvdW50Um93LmNvdW50KSB8fCAwXG4gICAgfSlcbiAgfVxuXG4gIC8qKlxuICAgKiBMaXN0cyBqb2JzIGZvciB0aGUgZGFzaGJvYXJkLCBmaWx0ZXJlZCwgc29ydGVkIGFuZCBwYWdpbmF0ZWQuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBbYXJnc10gLSBPcHRpb25zLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gW2FyZ3Muc3RhdHVzXSAtIEZpbHRlciBieSBzdGF0dXMuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBbYXJncy5qb2JOYW1lXSAtIEZpbHRlciBieSBqb2IgbmFtZS5cbiAgICogQHBhcmFtIHtudW1iZXJ9IFthcmdzLmxpbWl0XSAtIE1heGltdW0gcm93cyB0byByZXR1cm4uXG4gICAqIEBwYXJhbSB7bnVtYmVyfSBbYXJncy5vZmZzZXRdIC0gUm93cyB0byBza2lwLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gW2FyZ3Muc29ydENvbHVtbl0gLSBDYW1lbC1jYXNlZCBjb2x1bW4gdG8gc29ydCBieSAoc2VlIFNPUlRBQkxFX0NPTFVNTlMpLlxuICAgKiBAcGFyYW0ge1wiQVNDXCIgfCBcIkRFU0NcIn0gW2FyZ3Muc29ydERpcmVjdGlvbl0gLSBTb3J0IGRpcmVjdGlvbi5cbiAgICogQHJldHVybnMge1Byb21pc2U8aW1wb3J0KFwiLi90eXBlcy5qc1wiKS5CYWNrZ3JvdW5kSm9iUm93W10+fSAtIE5vcm1hbGl6ZWQgam9iIHJvd3MuXG4gICAqL1xuICBhc3luYyBsaXN0Sm9icyh7c3RhdHVzLCBqb2JOYW1lLCBsaW1pdCA9IDI1LCBvZmZzZXQgPSAwLCBzb3J0Q29sdW1uID0gXCJjcmVhdGVkQXRNc1wiLCBzb3J0RGlyZWN0aW9uID0gXCJERVNDXCJ9ID0ge30pIHtcbiAgICBhd2FpdCB0aGlzLmVuc3VyZVJlYWR5KClcblxuICAgIGNvbnN0IGNvbHVtbiA9IFNPUlRBQkxFX0NPTFVNTlNbc29ydENvbHVtbl0gfHwgU09SVEFCTEVfQ09MVU1OUy5jcmVhdGVkQXRNc1xuICAgIGNvbnN0IGRpcmVjdGlvbiA9IHNvcnREaXJlY3Rpb24gPT09IFwiQVNDXCIgPyBcIkFTQ1wiIDogXCJERVNDXCJcblxuICAgIHJldHVybiBhd2FpdCB0aGlzLl93aXRoRGIoYXN5bmMgKGRiKSA9PiB7XG4gICAgICBsZXQgcXVlcnkgPSBkYi5uZXdRdWVyeSgpLmZyb20oSk9CU19UQUJMRSlcblxuICAgICAgaWYgKHN0YXR1cykgcXVlcnkgPSBxdWVyeS53aGVyZSh7c3RhdHVzfSlcbiAgICAgIGlmIChqb2JOYW1lKSBxdWVyeSA9IHF1ZXJ5LndoZXJlKHtqb2JfbmFtZTogam9iTmFtZX0pXG5cbiAgICAgIHF1ZXJ5ID0gcXVlcnkub3JkZXIoe2NvbHVtbiwgZGlyZWN0aW9ufSlcbiAgICAgIGlmIChjb2x1bW4gIT09IFNPUlRBQkxFX0NPTFVNTlMuY3JlYXRlZEF0TXMpIHF1ZXJ5ID0gcXVlcnkub3JkZXIoe2NvbHVtbjogU09SVEFCTEVfQ09MVU1OUy5jcmVhdGVkQXRNcywgZGlyZWN0aW9uOiBcIkRFU0NcIn0pXG5cbiAgICAgIGNvbnN0IHJvd3MgPSBhd2FpdCBxdWVyeS5saW1pdChsaW1pdCkub2Zmc2V0KG9mZnNldCkucmVzdWx0cygpXG5cbiAgICAgIHJldHVybiByb3dzLm1hcCgocm93KSA9PiB0aGlzLl9ub3JtYWxpemVKb2JSb3cocm93KSlcbiAgICB9KVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgbWFyayBoYW5kZWQgb2ZmLlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIE9wdGlvbnMuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBhcmdzLmpvYklkIC0gSm9iIGlkLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gW2FyZ3MuaGFuZG9mZklkXSAtIENhbGxlci1zZWxlY3RlZCBleGFjdCBsZWFzZSBpZC4gR2VuZXJhdGVkIGZvciBsZWdhY3kgZGlyZWN0IGNhbGxlcnMgd2hlbiBvbWl0dGVkLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gW2FyZ3Mud29ya2VySWRdIC0gV29ya2VyIGlkLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxpbXBvcnQoXCIuL3R5cGVzLmpzXCIpLkJhY2tncm91bmRKb2JIYW5kb2ZmIHwgbnVsbD59IC0gQ2xhaW1lZCBoYW5kb2ZmIGxlYXNlLCBvciBudWxsIHdoZW4gbm8gbG9uZ2VyIHF1ZXVlZC5cbiAgICovXG4gIGFzeW5jIG1hcmtIYW5kZWRPZmYoe2pvYklkLCBoYW5kb2ZmSWQgPSByYW5kb21VVUlEKCksIHdvcmtlcklkfSkge1xuICAgIGF3YWl0IHRoaXMuZW5zdXJlUmVhZHkoKVxuXG4gICAgY29uc3QgaGFuZGVkT2ZmQXRNcyA9IHRoaXMuY2xvY2subm93KClcblxuICAgIHJldHVybiBhd2FpdCB0aGlzLl9zZXJpYWxpemVkQ291bnRNdXRhdGlvbihhc3luYyAoZGIpID0+IHtcbiAgICAgIGNvbnN0IHNlbGVjdGVkSm9iID0gYXdhaXQgdGhpcy5fZ2V0Sm9iUm93QnlJZChkYiwgam9iSWQpXG4gICAgICBpZiAoIXNlbGVjdGVkSm9iIHx8IHNlbGVjdGVkSm9iLnN0YXR1cyAhPT0gXCJxdWV1ZWRcIikgcmV0dXJuIG51bGxcbiAgICAgIGNvbnN0IHF1ZXVlZEpvYiA9IGF3YWl0IHRoaXMuX3JlY29uY2lsZVF1ZXVlZEpvYkNvbmN1cnJlbmN5KGRiLCBzZWxlY3RlZEpvYilcblxuICAgICAgaWYgKCFxdWV1ZWRKb2IpIHJldHVybiBudWxsXG4gICAgICBpZiAocXVldWVkSm9iLmNvbmN1cnJlbmN5S2V5ICYmICEoYXdhaXQgdGhpcy5fcmVzZXJ2ZUNvbmN1cnJlbmN5KGRiLCBxdWV1ZWRKb2IuY29uY3VycmVuY3lLZXkpKSkgcmV0dXJuIG51bGxcbiAgICAgIGNvbnN0IGFmZmVjdGVkUm93cyA9IGF3YWl0IHRoaXMuX3VwZGF0ZUFmZmVjdGVkUm93cyhkYiwge1xuICAgICAgICB0YWJsZU5hbWU6IEpPQlNfVEFCTEUsXG4gICAgICAgIGRhdGE6IHtcbiAgICAgICAgICBzdGF0dXM6IFwiaGFuZGVkX29mZlwiLFxuICAgICAgICAgIGhhbmRlZF9vZmZfYXRfbXM6IGhhbmRlZE9mZkF0TXMsXG4gICAgICAgICAgaGFuZG9mZl9pZDogaGFuZG9mZklkLFxuICAgICAgICAgIHdvcmtlcl9pZDogd29ya2VySWQgfHwgbnVsbCxcbiAgICAgICAgICAuLi50aGlzLl9jbGVhcmVkQ2hpbGRBY2NlcHRhbmNlRGF0YSgpXG4gICAgICAgIH0sXG4gICAgICAgIGNvbmRpdGlvbnM6IHtjb25jdXJyZW5jeV9rZXk6IHF1ZXVlZEpvYi5jb25jdXJyZW5jeUtleSwgaWQ6IGpvYklkLCBzdGF0dXM6IFwicXVldWVkXCJ9XG4gICAgICB9KVxuXG4gICAgICBpZiAoYWZmZWN0ZWRSb3dzICE9PSAxKSB7XG4gICAgICAgIGF3YWl0IHRoaXMuX3JlbGVhc2VDb25jdXJyZW5jeShkYiwgcXVldWVkSm9iLmNvbmN1cnJlbmN5S2V5KVxuICAgICAgICByZXR1cm4gbnVsbFxuICAgICAgfVxuXG4gICAgICBhd2FpdCB0aGlzLl9yZWNvcmRTdGF0dXNUcmFuc2l0aW9uKGRiLCBcInF1ZXVlZFwiLCBcImhhbmRlZF9vZmZcIilcbiAgICAgIC8qKiBAdHlwZSB7aW1wb3J0KFwiLi90eXBlcy5qc1wiKS5CYWNrZ3JvdW5kSm9iUm93fSAqL1xuICAgICAgY29uc3QgaGFuZGVkT2ZmSm9iID0ge1xuICAgICAgICAuLi5xdWV1ZWRKb2IsXG4gICAgICAgIC4uLnRoaXMuX2NsZWFyZWRDaGlsZEFjY2VwdGFuY2VSb3coKSxcbiAgICAgICAgaGFuZGVkT2ZmQXRNcyxcbiAgICAgICAgaGFuZG9mZklkLFxuICAgICAgICBzdGF0dXM6IFwiaGFuZGVkX29mZlwiLFxuICAgICAgICB3b3JrZXJJZDogd29ya2VySWQgfHwgbnVsbFxuICAgICAgfVxuXG4gICAgICByZXR1cm4ge2hhbmRlZE9mZkF0TXMsIGhhbmRvZmZJZCwgam9iOiBoYW5kZWRPZmZKb2J9XG4gICAgfSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIG1hcmsgY29tcGxldGVkLlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIE9wdGlvbnMuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBhcmdzLmpvYklkIC0gSm9iIGlkLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gW2FyZ3MuaGFuZG9mZklkXSAtIEhhbmRvZmYgbGVhc2UgaWQuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBbYXJncy53b3JrZXJJZF0gLSBXb3JrZXIgaWQuXG4gICAqIEBwYXJhbSB7bnVtYmVyfSBbYXJncy5oYW5kZWRPZmZBdE1zXSAtIEhhbmRlZCBvZmYgdGltZXN0YW1wLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxib29sZWFuPn0gLSBXaGV0aGVyIHRoZSBmZW5jZWQgcmVwb3J0IHdhcyBhY2NlcHRlZC5cbiAgICovXG4gIGFzeW5jIG1hcmtDb21wbGV0ZWQoe2pvYklkLCBoYW5kb2ZmSWQsIHdvcmtlcklkLCBoYW5kZWRPZmZBdE1zfSkge1xuICAgIGF3YWl0IHRoaXMuZW5zdXJlUmVhZHkoKVxuXG4gICAgcmV0dXJuIGF3YWl0IHRoaXMuX3NlcmlhbGl6ZWRDb3VudE11dGF0aW9uKGFzeW5jIChkYikgPT4ge1xuICAgICAgY29uc3Qgam9iID0gYXdhaXQgdGhpcy5fZ2V0Sm9iUm93QnlJZChkYiwgam9iSWQpXG5cbiAgICAgIGlmICgham9iKSByZXR1cm4gZmFsc2VcbiAgICAgIGlmICghdGhpcy5fc2hvdWxkQWNjZXB0UmVwb3J0KHtqb2IsIGhhbmRvZmZJZCwgd29ya2VySWQsIGhhbmRlZE9mZkF0TXN9KSkgcmV0dXJuIGZhbHNlXG5cbiAgICAgIGF3YWl0IHRoaXMuX2xvY2tDb25jdXJyZW5jeVJvdyhkYiwgam9iLmNvbmN1cnJlbmN5S2V5KVxuICAgICAgY29uc3QgYWZmZWN0ZWRSb3dzID0gYXdhaXQgdGhpcy5fdXBkYXRlQWZmZWN0ZWRSb3dzKGRiLCB7XG4gICAgICAgIHRhYmxlTmFtZTogSk9CU19UQUJMRSxcbiAgICAgICAgZGF0YToge1xuICAgICAgICAgIHN0YXR1czogXCJjb21wbGV0ZWRcIixcbiAgICAgICAgICBjb21wbGV0ZWRfYXRfbXM6IHRoaXMuY2xvY2subm93KClcbiAgICAgICAgfSxcbiAgICAgICAgY29uZGl0aW9uczogdGhpcy5fYWN0aXZlSGFuZG9mZkNvbmRpdGlvbnMoam9iKVxuICAgICAgfSlcblxuICAgICAgaWYgKGFmZmVjdGVkUm93cyAhPT0gMSkgcmV0dXJuIGZhbHNlXG4gICAgICBhd2FpdCB0aGlzLl9yZWxlYXNlU2NoZWR1bGVPd25lcnNoaXBGb3JKb2IoZGIsIGpvYilcbiAgICAgIGF3YWl0IHRoaXMuX3JlbGVhc2VDb25jdXJyZW5jeShkYiwgam9iLmNvbmN1cnJlbmN5S2V5KVxuICAgICAgYXdhaXQgdGhpcy5fcmVjb3JkU3RhdHVzVHJhbnNpdGlvbihkYiwgXCJoYW5kZWRfb2ZmXCIsIFwiY29tcGxldGVkXCIpXG4gICAgICByZXR1cm4gdHJ1ZVxuICAgIH0pXG4gIH1cblxuICAvKipcbiAgICogUmVjb3JkcyBwb29sZWQtY2hpbGQgYWNjZXB0YW5jZSBldmlkZW5jZSBmb3IgYW4gYWN0aXZlIGhhbmRvZmY6IHdoZW4gdGhlXG4gICAqIGV4ZWN1dGluZyBydW5uZXIgY2hpbGQgcmVjZWl2ZWQgYW5kL29yIHN0YXJ0ZWQgdGhlIGpvYiwgcGx1cyB0aGF0IGNoaWxkJ3NcbiAgICogc3RhYmxlIGlkZW50aXR5IGFuZCBwaWQuIE9ubHkgdGhlIGZpZWxkcyBzdXBwbGllZCBhcmUgd3JpdHRlbiwgc28gYVxuICAgKiByZWNlaXZlZC10aGVuLXN0YXJ0ZWQgb2JzZXJ2YXRpb24gbGFuZHMgYXMgdHdvIGZlbmNlZCBwYXJ0aWFsIHVwZGF0ZXMuIFRoZVxuICAgKiB1cGRhdGUgaXMgZmVuY2VkIGJ5IHRoZSBleGFjdCBhY3RpdmUgaGFuZG9mZiBsZWFzZSwgc28gYSByZXBvcnQgZm9yIGFcbiAgICogcmVjbGFpbWVkIG9yIHJlLWhhbmRlZC1vZmYgam9iIGlzIGRyb3BwZWQgaW5zdGVhZCBvZiBzdGFtcGluZyB0aGUgd3JvbmdcbiAgICogYXR0ZW1wdC5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBPcHRpb25zLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gYXJncy5qb2JJZCAtIEpvYiBpZC5cbiAgICogQHBhcmFtIHtzdHJpbmd9IFthcmdzLmhhbmRvZmZJZF0gLSBIYW5kb2ZmIGxlYXNlIGlkLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gW2FyZ3Mud29ya2VySWRdIC0gV29ya2VyIGlkLlxuICAgKiBAcGFyYW0ge251bWJlcn0gW2FyZ3MuaGFuZGVkT2ZmQXRNc10gLSBIYW5kZWQgb2ZmIHRpbWVzdGFtcC5cbiAgICogQHBhcmFtIHtudW1iZXJ9IFthcmdzLnJlY2VpdmVkQXRNc10gLSBFcG9jaCBtcyB0aGUgcnVubmVyIGNoaWxkIHJlY2VpdmVkIHRoZSBqb2IuXG4gICAqIEBwYXJhbSB7bnVtYmVyfSBbYXJncy5zdGFydGVkQXRNc10gLSBFcG9jaCBtcyB0aGUgam9iJ3MgcGVyZm9ybSBzdGFydGVkIGluIHRoZSBjaGlsZC5cbiAgICogQHBhcmFtIHtzdHJpbmd9IFthcmdzLmNoaWxkSW5zdGFuY2VJZF0gLSBTdGFibGUgcG9vbGVkIGNoaWxkIGlkZW50aXR5LlxuICAgKiBAcGFyYW0ge251bWJlcn0gW2FyZ3MuY2hpbGRQaWRdIC0gUG9vbGVkIGNoaWxkIE9TIHBpZC5cbiAgICogQHBhcmFtIHtzdHJpbmd9IFthcmdzLnJ1bm5lckhvc3RuYW1lXSAtIEhvc3RuYW1lIG9mIHRoZSBtYWNoaW5lIHJ1bm5pbmcgdGhlIHBvb2xlZCBjaGlsZC5cbiAgICogQHJldHVybnMge1Byb21pc2U8Ym9vbGVhbj59IC0gV2hldGhlciB0aGUgZmVuY2VkIHJlcG9ydCB3YXMgYWNjZXB0ZWQuXG4gICAqL1xuICBhc3luYyBtYXJrQ2hpbGRBY2NlcHRlZCh7am9iSWQsIGhhbmRvZmZJZCwgd29ya2VySWQsIGhhbmRlZE9mZkF0TXMsIHJlY2VpdmVkQXRNcywgc3RhcnRlZEF0TXMsIGNoaWxkSW5zdGFuY2VJZCwgY2hpbGRQaWQsIHJ1bm5lckhvc3RuYW1lfSkge1xuICAgIGF3YWl0IHRoaXMuZW5zdXJlUmVhZHkoKVxuXG4gICAgcmV0dXJuIGF3YWl0IHRoaXMuX3NlcmlhbGl6ZWRDb25uZWN0aW9uTXV0YXRpb24oYXN5bmMgKGRiKSA9PiB7XG4gICAgICBjb25zdCBqb2IgPSBhd2FpdCB0aGlzLl9nZXRKb2JSb3dCeUlkKGRiLCBqb2JJZClcblxuICAgICAgaWYgKCFqb2IpIHJldHVybiBmYWxzZVxuICAgICAgaWYgKCF0aGlzLl9zaG91bGRBY2NlcHRSZXBvcnQoe2pvYiwgaGFuZG9mZklkLCB3b3JrZXJJZCwgaGFuZGVkT2ZmQXRNc30pKSByZXR1cm4gZmFsc2VcblxuICAgICAgY29uc3QgZGF0YSA9IHt9XG4gICAgICBpZiAodHlwZW9mIHJlY2VpdmVkQXRNcyA9PT0gXCJudW1iZXJcIikgZGF0YS5jaGlsZF9yZWNlaXZlZF9hdF9tcyA9IHJlY2VpdmVkQXRNc1xuICAgICAgaWYgKHR5cGVvZiBzdGFydGVkQXRNcyA9PT0gXCJudW1iZXJcIikgZGF0YS5jaGlsZF9zdGFydGVkX2F0X21zID0gc3RhcnRlZEF0TXNcbiAgICAgIGlmICh0eXBlb2YgY2hpbGRJbnN0YW5jZUlkID09PSBcInN0cmluZ1wiKSBkYXRhLmNoaWxkX2luc3RhbmNlX2lkID0gY2hpbGRJbnN0YW5jZUlkXG4gICAgICBpZiAodHlwZW9mIGNoaWxkUGlkID09PSBcIm51bWJlclwiKSBkYXRhLmNoaWxkX3BpZCA9IGNoaWxkUGlkXG4gICAgICBpZiAodHlwZW9mIHJ1bm5lckhvc3RuYW1lID09PSBcInN0cmluZ1wiKSBkYXRhLnJ1bm5lcl9ob3N0bmFtZSA9IHJ1bm5lckhvc3RuYW1lXG4gICAgICBpZiAoT2JqZWN0LmtleXMoZGF0YSkubGVuZ3RoID09PSAwKSByZXR1cm4gZmFsc2VcblxuICAgICAgY29uc3QgYWZmZWN0ZWRSb3dzID0gYXdhaXQgdGhpcy5fdXBkYXRlQWZmZWN0ZWRSb3dzKGRiLCB7XG4gICAgICAgIHRhYmxlTmFtZTogSk9CU19UQUJMRSxcbiAgICAgICAgZGF0YSxcbiAgICAgICAgY29uZGl0aW9uczogdGhpcy5fYWN0aXZlSGFuZG9mZkNvbmRpdGlvbnMoam9iKVxuICAgICAgfSlcblxuICAgICAgcmV0dXJuIGFmZmVjdGVkUm93cyA9PT0gMVxuICAgIH0pXG4gIH1cblxuICAvKipcbiAgICogUmV0dXJucyB0aGUgZGF0YWJhc2UgZGF0YSB0aGF0IGNsZWFycyBwb29sZWQtY2hpbGQgYWNjZXB0YW5jZSBldmlkZW5jZS5cbiAgICogQHJldHVybnMge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gLSBDbGVhcmVkIGFjY2VwdGFuY2UgY29sdW1ucy5cbiAgICovXG4gIF9jbGVhcmVkQ2hpbGRBY2NlcHRhbmNlRGF0YSgpIHtcbiAgICByZXR1cm4ge2NoaWxkX2luc3RhbmNlX2lkOiBudWxsLCBjaGlsZF9waWQ6IG51bGwsIGNoaWxkX3JlY2VpdmVkX2F0X21zOiBudWxsLCBjaGlsZF9zdGFydGVkX2F0X21zOiBudWxsLCBydW5uZXJfaG9zdG5hbWU6IG51bGx9XG4gIH1cblxuICAvKipcbiAgICogUmV0dXJucyB0aGUgcm93LXNoYXBlIGNvdW50ZXJwYXJ0IG9mIHRoZSBjbGVhcmVkIGFjY2VwdGFuY2UgY29sdW1ucy5cbiAgICogQHJldHVybnMge1BpY2s8aW1wb3J0KFwiLi90eXBlcy5qc1wiKS5CYWNrZ3JvdW5kSm9iUm93LCBcImNoaWxkSW5zdGFuY2VJZFwiIHwgXCJjaGlsZFBpZFwiIHwgXCJjaGlsZFJlY2VpdmVkQXRNc1wiIHwgXCJjaGlsZFN0YXJ0ZWRBdE1zXCIgfCBcInJ1bm5lckhvc3RuYW1lXCI+fSAtIENsZWFyZWQgYWNjZXB0YW5jZSBmaWVsZHMuXG4gICAqL1xuICBfY2xlYXJlZENoaWxkQWNjZXB0YW5jZVJvdygpIHtcbiAgICByZXR1cm4ge2NoaWxkSW5zdGFuY2VJZDogbnVsbCwgY2hpbGRQaWQ6IG51bGwsIGNoaWxkUmVjZWl2ZWRBdE1zOiBudWxsLCBjaGlsZFN0YXJ0ZWRBdE1zOiBudWxsLCBydW5uZXJIb3N0bmFtZTogbnVsbH1cbiAgfVxuXG4gIC8qKlxuICAgKiBSZXR1cm5zIGFuIGFjdGl2ZSBoYW5kb2ZmIHRvIHRoZSBxdWV1ZSBhdCBhIGNhbGxlci1yZXF1ZXN0ZWQgZnV0dXJlIHRpbWUuXG4gICAqIFRoaXMgaXMgbm9ybWFsIGpvYiBjb250cm9sIGZsb3c6IGl0IHByZXNlcnZlcyBmYWlsdXJlIGF0dGVtcHRzIGFuZCBtZXRhZGF0YS5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBPcHRpb25zLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gYXJncy5qb2JJZCAtIEpvYiBpZC5cbiAgICogQHBhcmFtIHtudW1iZXJ9IGFyZ3MuZGVsYXlNcyAtIERlbGF5IGZyb20gcGVyc2lzdGVuY2UgdGltZSBpbiBtaWxsaXNlY29uZHMuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBbYXJncy5oYW5kb2ZmSWRdIC0gSGFuZG9mZiBsZWFzZSBpZC5cbiAgICogQHBhcmFtIHtzdHJpbmd9IFthcmdzLndvcmtlcklkXSAtIFdvcmtlciBpZC5cbiAgICogQHBhcmFtIHtudW1iZXJ9IFthcmdzLmhhbmRlZE9mZkF0TXNdIC0gSGFuZGVkIG9mZiB0aW1lc3RhbXAuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPGJvb2xlYW4+fSAtIFdoZXRoZXIgdGhlIGZlbmNlZCByZXBvcnQgd2FzIGFjY2VwdGVkLlxuICAgKi9cbiAgYXN5bmMgbWFya1Jlc2NoZWR1bGVkKHtqb2JJZCwgZGVsYXlNcywgaGFuZG9mZklkLCB3b3JrZXJJZCwgaGFuZGVkT2ZmQXRNc30pIHtcbiAgICBhd2FpdCB0aGlzLmVuc3VyZVJlYWR5KClcbiAgICB0aGlzLl92YWxpZGF0ZVJlc2NoZWR1bGVEZWxheU1zKGRlbGF5TXMpXG5cbiAgICByZXR1cm4gYXdhaXQgdGhpcy5fc2VyaWFsaXplZENvdW50TXV0YXRpb24oYXN5bmMgKGRiKSA9PiB7XG4gICAgICBjb25zdCBqb2IgPSBhd2FpdCB0aGlzLl9nZXRKb2JSb3dCeUlkKGRiLCBqb2JJZClcblxuICAgICAgaWYgKCFqb2IpIHJldHVybiBmYWxzZVxuICAgICAgaWYgKCF0aGlzLl9zaG91bGRBY2NlcHRSZXBvcnQoe2pvYiwgaGFuZG9mZklkLCB3b3JrZXJJZCwgaGFuZGVkT2ZmQXRNc30pKSByZXR1cm4gZmFsc2VcblxuICAgICAgYXdhaXQgdGhpcy5fbG9ja0NvbmN1cnJlbmN5Um93KGRiLCBqb2IuY29uY3VycmVuY3lLZXkpXG4gICAgICBjb25zdCBzY2hlZHVsZWRBdE1zID0gdGhpcy5fcmVzY2hlZHVsZWRBdE1zKGRlbGF5TXMpXG4gICAgICBjb25zdCBhZmZlY3RlZFJvd3MgPSBhd2FpdCB0aGlzLl91cGRhdGVBZmZlY3RlZFJvd3MoZGIsIHtcbiAgICAgICAgdGFibGVOYW1lOiBKT0JTX1RBQkxFLFxuICAgICAgICBkYXRhOiB7XG4gICAgICAgICAgc3RhdHVzOiBcInF1ZXVlZFwiLFxuICAgICAgICAgIHNjaGVkdWxlZF9hdF9tczogc2NoZWR1bGVkQXRNcyxcbiAgICAgICAgICBoYW5kZWRfb2ZmX2F0X21zOiBudWxsLFxuICAgICAgICAgIGhhbmRvZmZfaWQ6IG51bGwsXG4gICAgICAgICAgd29ya2VyX2lkOiBudWxsLFxuICAgICAgICAgIC4uLnRoaXMuX2NsZWFyZWRDaGlsZEFjY2VwdGFuY2VEYXRhKClcbiAgICAgICAgfSxcbiAgICAgICAgY29uZGl0aW9uczogdGhpcy5fYWN0aXZlSGFuZG9mZkNvbmRpdGlvbnMoam9iKVxuICAgICAgfSlcblxuICAgICAgaWYgKGFmZmVjdGVkUm93cyAhPT0gMSkgcmV0dXJuIGZhbHNlXG4gICAgICBhd2FpdCB0aGlzLl9yZWxlYXNlQ29uY3VycmVuY3koZGIsIGpvYi5jb25jdXJyZW5jeUtleSlcbiAgICAgIGF3YWl0IHRoaXMuX3JlY29yZFN0YXR1c1RyYW5zaXRpb24oZGIsIFwiaGFuZGVkX29mZlwiLCBcInF1ZXVlZFwiKVxuICAgICAgcmV0dXJuIHRydWVcbiAgICB9KVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgbWFyayByZXR1cm5lZCB0byBxdWV1ZS5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBPcHRpb25zLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gYXJncy5qb2JJZCAtIEpvYiBpZC5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGFyZ3MuaGFuZG9mZklkIC0gSGFuZG9mZiBsZWFzZSBpZC5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgd2hlbiB1cGRhdGVkLlxuICAgKi9cbiAgYXN5bmMgbWFya1JldHVybmVkVG9RdWV1ZSh7am9iSWQsIGhhbmRvZmZJZH0pIHtcbiAgICBhd2FpdCB0aGlzLmVuc3VyZVJlYWR5KClcblxuICAgIGF3YWl0IHRoaXMuX3NlcmlhbGl6ZWRDb3VudE11dGF0aW9uKGFzeW5jIChkYikgPT4ge1xuICAgICAgY29uc3Qgam9iID0gYXdhaXQgdGhpcy5fZ2V0Sm9iUm93QnlJZChkYiwgam9iSWQpXG4gICAgICBpZiAoIWpvYiB8fCBqb2IuaGFuZG9mZklkICE9PSBoYW5kb2ZmSWQgfHwgam9iLnN0YXR1cyAhPT0gXCJoYW5kZWRfb2ZmXCIpIHJldHVyblxuICAgICAgYXdhaXQgdGhpcy5fbG9ja0NvbmN1cnJlbmN5Um93KGRiLCBqb2IuY29uY3VycmVuY3lLZXkpXG4gICAgICBjb25zdCBhZmZlY3RlZFJvd3MgPSBhd2FpdCB0aGlzLl91cGRhdGVBZmZlY3RlZFJvd3MoZGIsIHtcbiAgICAgICAgdGFibGVOYW1lOiBKT0JTX1RBQkxFLFxuICAgICAgICBkYXRhOiB7XG4gICAgICAgICAgc3RhdHVzOiBcInF1ZXVlZFwiLFxuICAgICAgICAgIHNjaGVkdWxlZF9hdF9tczogdGhpcy5jbG9jay5ub3coKSxcbiAgICAgICAgICBoYW5kZWRfb2ZmX2F0X21zOiBudWxsLFxuICAgICAgICAgIGhhbmRvZmZfaWQ6IG51bGwsXG4gICAgICAgICAgd29ya2VyX2lkOiBudWxsLFxuICAgICAgICAgIC4uLnRoaXMuX2NsZWFyZWRDaGlsZEFjY2VwdGFuY2VEYXRhKClcbiAgICAgICAgfSxcbiAgICAgICAgY29uZGl0aW9uczoge2hhbmRvZmZfaWQ6IGhhbmRvZmZJZCwgaWQ6IGpvYklkLCBzdGF0dXM6IFwiaGFuZGVkX29mZlwifVxuICAgICAgfSlcbiAgICAgIGlmIChhZmZlY3RlZFJvd3MgPT09IDEpIHtcbiAgICAgICAgYXdhaXQgdGhpcy5fcmVsZWFzZUNvbmN1cnJlbmN5KGRiLCBqb2IuY29uY3VycmVuY3lLZXkpXG4gICAgICAgIGF3YWl0IHRoaXMuX3JlY29yZFN0YXR1c1RyYW5zaXRpb24oZGIsIFwiaGFuZGVkX29mZlwiLCBcInF1ZXVlZFwiKVxuICAgICAgfVxuICAgIH0pXG4gIH1cblxuICAvKipcbiAgICogUmV0dXJucyB0aGUgYWN0aXZlIGBoYW5kZWRfb2ZmYCBqb2JzIChqb2JJZCArIGhhbmRvZmZJZCkgaGVsZCB1bmRlciBhIHdvcmtlclxuICAgKiBpZC4gVXNlZCBvbiB3b3JrZXIgcmVjb25uZWN0OiBhZnRlciBhIG1haW4gcmVzdGFydCBhIHdvcmtlciByZWNvbm5lY3RzIHdpdGhcbiAgICogaXRzIHN0YWJsZSBpZCwgYW5kIHRoZSBmcmVzaCBtYWluIGFkb3B0cyB0aGVzZSBsZWFzZXMgc28gdGhleSBhcmUgdHJhY2tlZCDigJRcbiAgICogYW5kIHJlbGVhc2VkIGlmIHRoZSByZWNvbm5lY3RlZCB3b3JrZXIgbGF0ZXIgZGlzY29ubmVjdHMg4oCUIGluc3RlYWQgb2ZcbiAgICogc2l0dGluZyBzdHVjayB1bnRpbCB0aGUgYWdlLWJhc2VkIG9ycGhhbiBzd2VlcC4gVGhpcyBuZXZlciByZWNsYWltcywgc28gYVxuICAgKiBncmFjZWZ1bGx5LWRyYWluaW5nIHdvcmtlciB0aGF0IGtlZXBzIHJ1bm5pbmcgaXRzIGluLWZsaWdodCBqb2JzIGlzIGxlZnRcbiAgICogdW50b3VjaGVkLiBSb3dzIHdpdGggYSBudWxsIGhhbmRvZmYgaWQgKGxlZ2FjeSkgYXJlIHNraXBwZWQ7IHRoZSBvcnBoYW5cbiAgICogc3dlZXAgcmVjbGFpbXMgdGhvc2UgdmlhIGl0cyBgaGFuZGVkX29mZl9hdF9tc2AgZmVuY2UuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gT3B0aW9ucy5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGFyZ3Mud29ya2VySWQgLSBXb3JrZXIgaWQuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPEFycmF5PHtqb2JJZDogc3RyaW5nLCBoYW5kb2ZmSWQ6IHN0cmluZ30+Pn0gLSBBY3RpdmUgaGFuZG9mZnMuXG4gICAqL1xuICBhc3luYyBoYW5kZWRPZmZKb2JzRm9yV29ya2VyKHt3b3JrZXJJZH0pIHtcbiAgICBhd2FpdCB0aGlzLmVuc3VyZVJlYWR5KClcblxuICAgIGNvbnN0IHJvd3MgPSBhd2FpdCB0aGlzLl93aXRoRGIoYXN5bmMgKGRiKSA9PlxuICAgICAgYXdhaXQgZGIubmV3UXVlcnkoKS5mcm9tKEpPQlNfVEFCTEUpLndoZXJlKHtzdGF0dXM6IFwiaGFuZGVkX29mZlwiLCB3b3JrZXJfaWQ6IHdvcmtlcklkfSkucmVzdWx0cygpXG4gICAgKVxuXG4gICAgLyoqIEB0eXBlIHtBcnJheTx7am9iSWQ6IHN0cmluZywgaGFuZG9mZklkOiBzdHJpbmd9Pn0gKi9cbiAgICBjb25zdCBoYW5kb2ZmcyA9IFtdXG5cbiAgICBmb3IgKGNvbnN0IHJvdyBvZiByb3dzKSB7XG4gICAgICBjb25zdCBqb2IgPSB0aGlzLl9ub3JtYWxpemVKb2JSb3cocm93KVxuXG4gICAgICBpZiAoam9iLmhhbmRvZmZJZCkgaGFuZG9mZnMucHVzaCh7am9iSWQ6IGpvYi5pZCwgaGFuZG9mZklkOiBqb2IuaGFuZG9mZklkfSlcbiAgICB9XG5cbiAgICByZXR1cm4gaGFuZG9mZnNcbiAgfVxuXG4gIC8qKlxuICAgKiBTbmFwc2hvdHMgZXhhY3QsIGxlYXNlLWF3YXJlIGFjdGl2ZSBoYW5kb2ZmcyBiZWZvcmUgYSBuZXcgbWFpbiBnZW5lcmF0aW9uXG4gICAqIHN0YXJ0cyBhY2NlcHRpbmcgd29ya2VyIHJlY29ubmVjdHMuIExlZ2FjeSByb3dzIHdpdGhvdXQgYSBjb21wbGV0ZSB3b3JrZXIsXG4gICAqIGxlYXNlLCBhbmQgdGltZXN0YW1wIGlkZW50aXR5IHN0YXkgb3duZWQgYnkgdGhlIGFnZS1iYXNlZCBvcnBoYW4gc3dlZXAuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPGltcG9ydChcIi4vdHlwZXMuanNcIikuQmFja2dyb3VuZEpvYkhhbmRvZmZTbmFwc2hvdFtdPn0gLSBFeGFjdCBzdGFydHVwIGhhbmRvZmZzLlxuICAgKi9cbiAgYXN5bmMgc25hcHNob3RIYW5kZWRPZmZKb2JzKCkge1xuICAgIGF3YWl0IHRoaXMuZW5zdXJlUmVhZHkoKVxuXG4gICAgY29uc3Qgcm93cyA9IGF3YWl0IHRoaXMuX3dpdGhEYihhc3luYyAoZGIpID0+IGF3YWl0IGRiXG4gICAgICAubmV3UXVlcnkoKVxuICAgICAgLmZyb20oSk9CU19UQUJMRSlcbiAgICAgIC53aGVyZSh7c3RhdHVzOiBcImhhbmRlZF9vZmZcIn0pXG4gICAgICAub3JkZXIoXCJjcmVhdGVkX2F0X21zIEFTQ1wiKVxuICAgICAgLm9yZGVyKFwiaWQgQVNDXCIpXG4gICAgICAucmVzdWx0cygpKVxuICAgIC8qKiBAdHlwZSB7aW1wb3J0KFwiLi90eXBlcy5qc1wiKS5CYWNrZ3JvdW5kSm9iSGFuZG9mZlNuYXBzaG90W119ICovXG4gICAgY29uc3QgaGFuZG9mZnMgPSBbXVxuXG4gICAgZm9yIChjb25zdCByb3cgb2Ygcm93cykge1xuICAgICAgY29uc3Qgam9iID0gdGhpcy5fbm9ybWFsaXplSm9iUm93KHJvdylcblxuICAgICAgaWYgKCFqb2IuaGFuZG9mZklkIHx8ICFqb2Iud29ya2VySWQgfHwgdHlwZW9mIGpvYi5oYW5kZWRPZmZBdE1zICE9PSBcIm51bWJlclwiKSBjb250aW51ZVxuXG4gICAgICBoYW5kb2Zmcy5wdXNoKHtcbiAgICAgICAgaGFuZGVkT2ZmQXRNczogam9iLmhhbmRlZE9mZkF0TXMsXG4gICAgICAgIGhhbmRvZmZJZDogam9iLmhhbmRvZmZJZCxcbiAgICAgICAgam9iSWQ6IGpvYi5pZCxcbiAgICAgICAgd29ya2VySWQ6IGpvYi53b3JrZXJJZFxuICAgICAgfSlcbiAgICB9XG5cbiAgICByZXR1cm4gaGFuZG9mZnNcbiAgfVxuXG4gIC8qKlxuICAgKiBSZWNsYWltcyBvbmx5IHVuY2hhbmdlZCBleGFjdCBoYW5kb2ZmcyBzZWxlY3RlZCBieSBhIG1haW4tZ2VuZXJhdGlvbiBzdGFydHVwXG4gICAqIHNuYXBzaG90LiBUaGUgb3JkaW5hcnkgb3JwaGFuIGZhaWx1cmUgcGF0aCBvd25zIHJldHJpZXMsIHRlcm1pbmFsIHN0YXR1cyxcbiAgICogY291bnQgdHJhbnNpdGlvbnMsIHNjaGVkdWxlIG93bmVyc2hpcCwgYW5kIGNvbmN1cnJlbmN5IHJlbGVhc2UuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gT3B0aW9ucy5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL3R5cGVzLmpzXCIpLkJhY2tncm91bmRKb2JIYW5kb2ZmU25hcHNob3RbXX0gYXJncy5oYW5kb2ZmcyAtIEV4YWN0IHN0YXJ0dXAgc25hcHNob3RzLlxuICAgKiBAcGFyYW0ge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSBhcmdzLmVycm9yIC0gT3JwaGFuIHJlYXNvbi5cbiAgICogQHJldHVybnMge1Byb21pc2U8aW1wb3J0KFwiLi90eXBlcy5qc1wiKS5CYWNrZ3JvdW5kSm9iUm93W10+fSAtIEFjY2VwdGVkIHRyYW5zaXRpb25zLlxuICAgKi9cbiAgYXN5bmMgbWFya09ycGhhbmVkSGFuZG9mZnMoe2hhbmRvZmZzLCBlcnJvcn0pIHtcbiAgICBhd2FpdCB0aGlzLmVuc3VyZVJlYWR5KClcblxuICAgIHJldHVybiBhd2FpdCB0aGlzLl9zZXJpYWxpemVkQ291bnRNdXRhdGlvbihhc3luYyAoZGIpID0+IHtcbiAgICAgIC8qKiBAdHlwZSB7QmFja2dyb3VuZEpvYk9ycGhhblNlbGVjdGlvbltdfSAqL1xuICAgICAgY29uc3Qgc2VsZWN0aW9ucyA9IFtdXG5cbiAgICAgIGZvciAoY29uc3QgaGFuZG9mZiBvZiBoYW5kb2Zmcykge1xuICAgICAgICBjb25zdCBqb2IgPSBhd2FpdCB0aGlzLl9nZXRKb2JSb3dCeUlkKGRiLCBoYW5kb2ZmLmpvYklkKVxuXG4gICAgICAgIGlmICgham9iIHx8IGpvYi5zdGF0dXMgIT09IFwiaGFuZGVkX29mZlwiKSBjb250aW51ZVxuICAgICAgICBpZiAoam9iLmhhbmRvZmZJZCAhPT0gaGFuZG9mZi5oYW5kb2ZmSWQpIGNvbnRpbnVlXG4gICAgICAgIGlmIChqb2Iud29ya2VySWQgIT09IGhhbmRvZmYud29ya2VySWQpIGNvbnRpbnVlXG4gICAgICAgIGlmIChqb2IuaGFuZGVkT2ZmQXRNcyAhPT0gaGFuZG9mZi5oYW5kZWRPZmZBdE1zKSBjb250aW51ZVxuXG4gICAgICAgIHNlbGVjdGlvbnMucHVzaCh7XG4gICAgICAgICAgY29uZGl0aW9uczoge1xuICAgICAgICAgICAgaGFuZGVkX29mZl9hdF9tczogaGFuZG9mZi5oYW5kZWRPZmZBdE1zLFxuICAgICAgICAgICAgaGFuZG9mZl9pZDogaGFuZG9mZi5oYW5kb2ZmSWQsXG4gICAgICAgICAgICBpZDogaGFuZG9mZi5qb2JJZCxcbiAgICAgICAgICAgIHN0YXR1czogXCJoYW5kZWRfb2ZmXCIsXG4gICAgICAgICAgICB3b3JrZXJfaWQ6IGhhbmRvZmYud29ya2VySWRcbiAgICAgICAgICB9LFxuICAgICAgICAgIGpvYlxuICAgICAgICB9KVxuICAgICAgfVxuXG4gICAgICByZXR1cm4gYXdhaXQgdGhpcy5fbWFya09ycGhhblNlbGVjdGlvbnMoe2RiLCBlcnJvciwgc2VsZWN0aW9uc30pXG4gICAgfSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIG1hcmsgZmFpbGVkLlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIE9wdGlvbnMuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBhcmdzLmpvYklkIC0gSm9iIGlkLlxuICAgKiBAcGFyYW0ge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSBhcmdzLmVycm9yIC0gRXJyb3IuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBbYXJncy5oYW5kb2ZmSWRdIC0gSGFuZG9mZiBsZWFzZSBpZC5cbiAgICogQHBhcmFtIHtzdHJpbmd9IFthcmdzLndvcmtlcklkXSAtIFdvcmtlciBpZC5cbiAgICogQHBhcmFtIHtudW1iZXJ9IFthcmdzLmhhbmRlZE9mZkF0TXNdIC0gSGFuZGVkIG9mZiB0aW1lc3RhbXAuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPGltcG9ydChcIi4vdHlwZXMuanNcIikuQmFja2dyb3VuZEpvYlJvdyB8IG51bGw+fSAtIFVwZGF0ZWQgam9iIHJvdyB3aGVuIHRoZSByZXBvcnQgd2FzIGFjY2VwdGVkLlxuICAgKi9cbiAgYXN5bmMgbWFya0ZhaWxlZCh7am9iSWQsIGVycm9yLCBoYW5kb2ZmSWQsIHdvcmtlcklkLCBoYW5kZWRPZmZBdE1zfSkge1xuICAgIGF3YWl0IHRoaXMuZW5zdXJlUmVhZHkoKVxuXG4gICAgcmV0dXJuIGF3YWl0IHRoaXMuX3NlcmlhbGl6ZWRDb3VudE11dGF0aW9uKGFzeW5jIChkYikgPT4ge1xuICAgICAgY29uc3Qgam9iID0gYXdhaXQgdGhpcy5fZ2V0Sm9iUm93QnlJZChkYiwgam9iSWQpXG5cbiAgICAgIGlmICgham9iKSByZXR1cm4gbnVsbFxuICAgICAgaWYgKCF0aGlzLl9zaG91bGRBY2NlcHRSZXBvcnQoe2pvYiwgaGFuZG9mZklkLCB3b3JrZXJJZCwgaGFuZGVkT2ZmQXRNc30pKSByZXR1cm4gbnVsbFxuXG4gICAgICBjb25zdCB1cGRhdGVkSm9iID0gYXdhaXQgdGhpcy5fYXBwbHlGYWlsdXJlKHtkYiwgam9iLCBlcnJvciwgbWFya09ycGhhbmVkOiBmYWxzZX0pXG5cbiAgICAgIGlmICh1cGRhdGVkSm9iKSBhd2FpdCB0aGlzLl9yZWNvcmRTdGF0dXNUcmFuc2l0aW9uKGRiLCBqb2Iuc3RhdHVzLCB1cGRhdGVkSm9iLnN0YXR1cylcbiAgICAgIHJldHVybiB1cGRhdGVkSm9iXG4gICAgfSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIG1hcmsgb3JwaGFuZWQgam9icy5cbiAgICogQHBhcmFtIHtvYmplY3R9IFthcmdzXSAtIE9wdGlvbnMuXG4gICAqIEBwYXJhbSB7bnVtYmVyfSBbYXJncy5vcnBoYW5lZEFmdGVyTXNdIC0gTWFyayBqb2JzIG9ycGhhbmVkIGFmdGVyIHRoaXMgZHVyYXRpb24uXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPGltcG9ydChcIi4vdHlwZXMuanNcIikuQmFja2dyb3VuZEpvYlJvd1tdPn0gLSBUaGUgam9icyB0aGlzIHN3ZWVwIG1hcmtlZCBvcnBoYW5lZC5cbiAgICovXG4gIGFzeW5jIG1hcmtPcnBoYW5lZEpvYnMoe29ycGhhbmVkQWZ0ZXJNcyA9IE9SUEhBTkVEX0FGVEVSX01TfSA9IHt9KSB7XG4gICAgYXdhaXQgdGhpcy5lbnN1cmVSZWFkeSgpXG5cbiAgICByZXR1cm4gYXdhaXQgdGhpcy5fc2VyaWFsaXplZENvdW50TXV0YXRpb24oYXN5bmMgKGRiKSA9PiB7XG4gICAgICBjb25zdCBjdXRvZmYgPSB0aGlzLmNsb2NrLm5vdygpIC0gb3JwaGFuZWRBZnRlck1zXG4gICAgICBjb25zdCBxdWVyeSA9IGRiXG4gICAgICAgIC5uZXdRdWVyeSgpXG4gICAgICAgIC5mcm9tKEpPQlNfVEFCTEUpXG4gICAgICAgIC53aGVyZSh7c3RhdHVzOiBcImhhbmRlZF9vZmZcIn0pXG4gICAgICAgIC53aGVyZShgaGFuZGVkX29mZl9hdF9tcyA8PSAke2RiLnF1b3RlKGN1dG9mZil9YClcblxuICAgICAgY29uc3Qgcm93cyA9IGF3YWl0IHF1ZXJ5LnJlc3VsdHMoKVxuXG4gICAgICAvKiogQHR5cGUge0JhY2tncm91bmRKb2JPcnBoYW5TZWxlY3Rpb25bXX0gKi9cbiAgICAgIGNvbnN0IHNlbGVjdGlvbnMgPSBbXVxuXG4gICAgICBmb3IgKGNvbnN0IHJvdyBvZiByb3dzKSB7XG4gICAgICAgIGNvbnN0IGpvYiA9IHRoaXMuX25vcm1hbGl6ZUpvYlJvdyhyb3cpXG5cbiAgICAgICAgLy8gRmVuY2UgdGhlIHJlY2xhaW0gb24gdGhlIGV4YWN0IGhhbmRvZmYgdGhpcyBzd2VlcCBzZWxlY3RlZCwgdXNpbmcgaXRzXG4gICAgICAgIC8vIGBoYW5kZWRfb2ZmX2F0X21zYCByYXRoZXIgdGhhbiBpdHMgYGhhbmRvZmZfaWRgLiBUd28gcmVhc29uczpcbiAgICAgICAgLy8gICAxLiBOdWxsLXNhZmUuIFNvbWUgcm93cyBoYXZlIGEgbnVsbCBgaGFuZG9mZl9pZGAgKGhhbmRlZCBvZmYgYnkgYW5cbiAgICAgICAgLy8gICAgICBvbGRlciB2ZWxvY2lvdXMgYmVmb3JlIGhhbmRvZmYtaWQgZmVuY2luZykuIGB7aGFuZG9mZl9pZDogbnVsbH1gXG4gICAgICAgIC8vICAgICAgcmVuZGVycyBhcyBgaGFuZG9mZl9pZCA9IE5VTExgLCB3aGljaCBtYXRjaGVzIG5vdGhpbmcsIHNvIHRob3NlXG4gICAgICAgIC8vICAgICAgcm93cyB3b3VsZCBiZSBzdHJhbmRlZCBpbiBgaGFuZGVkX29mZmAgZm9yZXZlci5cbiAgICAgICAgLy8gICAyLiBSYWNlLXNhZmUuIElmIHRoZSByb3cgaXMgcmV0dXJuZWQgdG8gdGhlIHF1ZXVlIGFuZCByZS1oYW5kZWQtb2ZmXG4gICAgICAgIC8vICAgICAgYmV0d2VlbiB0aGUgU0VMRUNUIGFib3ZlIGFuZCB0aGlzIHVwZGF0ZSwgaXQgZ2V0cyBhIGZyZXNoXG4gICAgICAgIC8vICAgICAgYGhhbmRlZF9vZmZfYXRfbXNgIChhbHdheXMgXCJub3dcIiksIHNvIHRoaXMgc3RhbGUgY3V0b2ZmLWVyYVxuICAgICAgICAvLyAgICAgIHRpbWVzdGFtcCBubyBsb25nZXIgbWF0Y2hlcyBhbmQgd2Ugd29uJ3QgZmFpbC9vcnBoYW4g4oCUIG9yXG4gICAgICAgIC8vICAgICAgd3JvbmdseSByZWxlYXNlIHRoZSBjb25jdXJyZW5jeSByZXNlcnZhdGlvbiBvZiDigJQgdGhhdCBuZXcgbGVhc2UuXG4gICAgICAgIC8vIGBoYW5kZWRfb2ZmX2F0X21zYCBpcyBhbHdheXMgc2V0IG9uIGEgaGFuZGVkLW9mZiByb3cgKGFuZCB0aGUgU0VMRUNUXG4gICAgICAgIC8vIHJlcXVpcmVkIGl0IGA8PSBjdXRvZmZgKSwgc28gaXQgaXMgYSByZWxpYWJsZSBudWxsLXNhZmUgbGVhc2UgcGluLlxuICAgICAgICBzZWxlY3Rpb25zLnB1c2goe1xuICAgICAgICAgIGNvbmRpdGlvbnM6IHtpZDogam9iLmlkLCBzdGF0dXM6IFwiaGFuZGVkX29mZlwiLCBoYW5kZWRfb2ZmX2F0X21zOiBqb2IuaGFuZGVkT2ZmQXRNc30sXG4gICAgICAgICAgam9iXG4gICAgICAgIH0pXG4gICAgICB9XG5cbiAgICAgIHJldHVybiBhd2FpdCB0aGlzLl9tYXJrT3JwaGFuU2VsZWN0aW9ucyh7XG4gICAgICAgIGRiLFxuICAgICAgICBlcnJvcjogXCJKb2Igb3JwaGFuZWQgYWZ0ZXIgdGltZW91dFwiLFxuICAgICAgICBzZWxlY3Rpb25zXG4gICAgICB9KVxuICAgIH0pXG4gIH1cblxuICAvKipcbiAgICogQXBwbGllcyB0aGUgY29tbW9uIGZlbmNlZCBvcnBoYW4gdHJhbnNpdGlvbiBhbmQgcmVjb3JkcyBvbmUgYWdncmVnYXRlIGNvdW50XG4gICAqIGRlbHRhIGZvciB0aGUgYWNjZXB0ZWQgcm93cy5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBPcHRpb25zLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL2RhdGFiYXNlL2RyaXZlcnMvYmFzZS5qc1wiKS5kZWZhdWx0fSBhcmdzLmRiIC0gVHJhbnNhY3Rpb24gY29ubmVjdGlvbi5cbiAgICogQHBhcmFtIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gYXJncy5lcnJvciAtIE9ycGhhbiByZWFzb24uXG4gICAqIEBwYXJhbSB7QmFja2dyb3VuZEpvYk9ycGhhblNlbGVjdGlvbltdfSBhcmdzLnNlbGVjdGlvbnMgLSBTZWxlY3RlZCBoYW5kb2ZmcyBhbmQgZXhhY3QgZmVuY2VzLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxpbXBvcnQoXCIuL3R5cGVzLmpzXCIpLkJhY2tncm91bmRKb2JSb3dbXT59IC0gQWNjZXB0ZWQgdHJhbnNpdGlvbnMuXG4gICAqL1xuICBhc3luYyBfbWFya09ycGhhblNlbGVjdGlvbnMoe2RiLCBlcnJvciwgc2VsZWN0aW9uc30pIHtcbiAgICAvKiogQHR5cGUge2ltcG9ydChcIi4vdHlwZXMuanNcIikuQmFja2dyb3VuZEpvYlJvd1tdfSAqL1xuICAgIGNvbnN0IG9ycGhhbmVkSm9icyA9IFtdXG5cbiAgICBmb3IgKGNvbnN0IHtjb25kaXRpb25zLCBqb2J9IG9mIHNlbGVjdGlvbnMpIHtcbiAgICAgIGNvbnN0IG9ycGhhbmVkSm9iID0gYXdhaXQgdGhpcy5fYXBwbHlGYWlsdXJlKHtcbiAgICAgICAgY29uZGl0aW9ucyxcbiAgICAgICAgZGIsXG4gICAgICAgIGVycm9yLFxuICAgICAgICBqb2IsXG4gICAgICAgIG1hcmtPcnBoYW5lZDogdHJ1ZVxuICAgICAgfSlcblxuICAgICAgaWYgKG9ycGhhbmVkSm9iKSBvcnBoYW5lZEpvYnMucHVzaChvcnBoYW5lZEpvYilcbiAgICB9XG5cbiAgICBjb25zdCBzdGF0dXNDb3VudHMgPSB0aGlzLl9zdGF0dXNDb3VudHMob3JwaGFuZWRKb2JzKVxuICAgIGNvbnN0IGRlbHRhcyA9IHRoaXMuX2VtcHR5Q291bnRCdWNrZXRzKClcblxuICAgIGZvciAoY29uc3QgW3N0YXR1cywgY291bnRdIG9mIE9iamVjdC5lbnRyaWVzKHN0YXR1c0NvdW50cykpIHtcbiAgICAgIGRlbHRhcy5oYW5kZWRfb2ZmIC09IGNvdW50XG4gICAgICBkZWx0YXNbc3RhdHVzXSArPSBjb3VudFxuICAgIH1cbiAgICBhd2FpdCB0aGlzLl9yZWNvcmRDb3VudERlbHRhKGRiLCBkZWx0YXMpXG5cbiAgICByZXR1cm4gb3JwaGFuZWRKb2JzXG4gIH1cblxuICAvKipcbiAgICogRGVsZXRlcyB0ZXJtaW5hbCBqb2Igcm93cyBwYXN0IHRoZWlyIHJldGVudGlvbiB3aW5kb3cgc28gdGhlIGpvYnMgdGFibGVcbiAgICogZG9lcyBub3QgZ3JvdyB1bmJvdW5kZWQgKGNvbXBsZXRlZCByb3dzIGluIHBhcnRpY3VsYXIgYWNjdW11bGF0ZSBmb3JldmVyXG4gICAqIG90aGVyd2lzZSkuIEJhdGNoZWQgYnkgaWQg4oCUIFNFTEVDVCBhIHBhZ2Ugb2YgaWRzLCB0aGVuXG4gICAqIGBERUxFVEUgLi4uIFdIRVJFIGlkIElOICguLi4pYCDigJQgcmF0aGVyIHRoYW4gYERFTEVURSAuLi4gTElNSVRgLCB3aGljaCBub3RcbiAgICogZXZlcnkgZHJpdmVyIHN1cHBvcnRzOyBlYWNoIGJhdGNoIHJ1bnMgb24gaXRzIG93biBjb25uZWN0aW9uIHNvIHRoZSBzd2VlcFxuICAgKiB5aWVsZHMgYmV0d2VlbiBiYXRjaGVzIGluc3RlYWQgb2YgaG9sZGluZyBvbmUgbG9uZyB0cmFuc2FjdGlvbi5cbiAgICogQHBhcmFtIHtvYmplY3R9IFthcmdzXSAtIE9wdGlvbnMuXG4gICAqIEBwYXJhbSB7bnVtYmVyIHwgbnVsbH0gW2FyZ3MuY29tcGxldGVkVHRsTXNdIC0gRGVsZXRlIGBjb21wbGV0ZWRgIGpvYnMgd2hvc2UgYGNvbXBsZXRlZF9hdF9tc2AgaXMgb2xkZXIgdGhhbiB0aGlzIG1hbnkgbXMuIEZhbHN5IG9yIGA8PSAwYCBkaXNhYmxlcyBjb21wbGV0ZWQgcHJ1bmluZy5cbiAgICogQHBhcmFtIHtudW1iZXIgfCBudWxsfSBbYXJncy5mYWlsZWRUdGxNc10gLSBEZWxldGUgdGVybWluYWwgYGZhaWxlZGAvYG9ycGhhbmVkYCBqb2JzIG9sZGVyIHRoYW4gdGhpcyBtYW55IG1zIChieSBgZmFpbGVkX2F0X21zYC9gb3JwaGFuZWRfYXRfbXNgKS4gRmFsc3kgb3IgYDw9IDBgIGRpc2FibGVzLlxuICAgKiBAcGFyYW0ge251bWJlcn0gW2FyZ3MuYmF0Y2hTaXplXSAtIE1heCByb3dzIGRlbGV0ZWQgcGVyIGJhdGNoLiBEZWZhdWx0IGAxMDAwYC5cbiAgICogQHJldHVybnMge1Byb21pc2U8bnVtYmVyPn0gLSBUb3RhbCByb3dzIGRlbGV0ZWQuXG4gICAqL1xuICBhc3luYyBwcnVuZVRlcm1pbmFsSm9icyh7Y29tcGxldGVkVHRsTXMgPSBudWxsLCBmYWlsZWRUdGxNcyA9IG51bGwsIGJhdGNoU2l6ZSA9IDEwMDB9ID0ge30pIHtcbiAgICBhd2FpdCB0aGlzLmVuc3VyZVJlYWR5KClcblxuICAgIGNvbnN0IG5vdyA9IHRoaXMuY2xvY2subm93KClcbiAgICBjb25zdCBzaXplID0gYmF0Y2hTaXplID4gMCA/IGJhdGNoU2l6ZSA6IDEwMDBcbiAgICBsZXQgZGVsZXRlZCA9IDBcblxuICAgIGlmIChjb21wbGV0ZWRUdGxNcyAmJiBjb21wbGV0ZWRUdGxNcyA+IDApIHtcbiAgICAgIGRlbGV0ZWQgKz0gYXdhaXQgdGhpcy5fcHJ1bmVTdGF0dXNCYXRjaGVzKHtzdGF0dXM6IFwiY29tcGxldGVkXCIsIGNvbHVtbjogXCJjb21wbGV0ZWRfYXRfbXNcIiwgY3V0b2ZmOiBub3cgLSBjb21wbGV0ZWRUdGxNcywgYmF0Y2hTaXplOiBzaXplfSlcbiAgICB9XG5cbiAgICBpZiAoZmFpbGVkVHRsTXMgJiYgZmFpbGVkVHRsTXMgPiAwKSB7XG4gICAgICBkZWxldGVkICs9IGF3YWl0IHRoaXMuX3BydW5lU3RhdHVzQmF0Y2hlcyh7c3RhdHVzOiBcImZhaWxlZFwiLCBjb2x1bW46IFwiZmFpbGVkX2F0X21zXCIsIGN1dG9mZjogbm93IC0gZmFpbGVkVHRsTXMsIGJhdGNoU2l6ZTogc2l6ZX0pXG4gICAgICBkZWxldGVkICs9IGF3YWl0IHRoaXMuX3BydW5lU3RhdHVzQmF0Y2hlcyh7c3RhdHVzOiBcIm9ycGhhbmVkXCIsIGNvbHVtbjogXCJvcnBoYW5lZF9hdF9tc1wiLCBjdXRvZmY6IG5vdyAtIGZhaWxlZFR0bE1zLCBiYXRjaFNpemU6IHNpemV9KVxuICAgIH1cblxuICAgIHJldHVybiBkZWxldGVkXG4gIH1cblxuICAvKipcbiAgICogRGVsZXRlcyByb3dzIG9mIG9uZSB0ZXJtaW5hbCBzdGF0dXMgb2xkZXIgdGhhbiBhIGN1dG9mZiwgYmF0Y2ggYnkgYmF0Y2gsXG4gICAqIHVudGlsIGEgY2FuZGlkYXRlIHBhZ2UgcmV0dXJucyBmZXdlciB0aGFuIGBiYXRjaFNpemVgIHJvd3MuIENhbmRpZGF0ZVxuICAgKiBkaXNjb3ZlcnkgcnVucyBvbiBhIHBsYWluIGNvbm5lY3Rpb24g4oCUIG5ldmVyIGluc2lkZSB0aGUgc2VyaWFsaXplZCBjb3VudFxuICAgKiBtdXRhdGlvbiDigJQgc28gYSBsb25nIHNjYW4gY2Fubm90IGhvbGQgdGhlIGNvdW50LXJldmlzaW9uIGxvY2sgYW5kIHN0YXJ2ZVxuICAgKiBlbnF1ZXVlIGFja25vd2xlZGdlbWVudHM7IG9ubHkgdGhlIHNob3J0IGRlbGV0ZSB0cmFuc2FjdGlvbiBpcyBzZXJpYWxpemVkLlxuICAgKiBUaGUgZGVsZXRlIHJldmFsaWRhdGVzIHN0YXR1cyBhbmQgY3V0b2ZmIGZvciB0aGUgc2VsZWN0ZWQgaWRzLCBwdWJsaXNoZXNcbiAgICogdGhlIGRlbHRhIGZyb20gdGhlIGFjdHVhbCBhZmZlY3RlZC1yb3cgY291bnQsIGFuZCBhIHBhZ2Ugd2hvc2UgY2FuZGlkYXRlc1xuICAgKiB3ZXJlIGFscmVhZHkgcmVtb3ZlZCBieSBhIGNvbmN1cnJlbnQgcHJ1bmVyIHN0aWxsIGVuZHMgdGhlIHBhc3Mgb25seSB3aGVuXG4gICAqIHRoZSBwYWdlIGl0c2VsZiBpcyBzaG9ydC5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBPcHRpb25zLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gYXJncy5zdGF0dXMgLSBUZXJtaW5hbCBzdGF0dXMgdG8gcHJ1bmUuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBhcmdzLmNvbHVtbiAtIFRpbWVzdGFtcCBjb2x1bW4gY29tcGFyZWQgYWdhaW5zdCB0aGUgY3V0b2ZmLlxuICAgKiBAcGFyYW0ge251bWJlcn0gYXJncy5jdXRvZmYgLSBEZWxldGUgcm93cyB3aG9zZSBjb2x1bW4gdmFsdWUgaXMgYDw9IGN1dG9mZmAuXG4gICAqIEBwYXJhbSB7bnVtYmVyfSBhcmdzLmJhdGNoU2l6ZSAtIE1heCByb3dzIHBlciBiYXRjaC5cbiAgICogQHJldHVybnMge1Byb21pc2U8bnVtYmVyPn0gLSBSb3dzIGRlbGV0ZWQgZm9yIHRoaXMgc3RhdHVzLlxuICAgKi9cbiAgYXN5bmMgX3BydW5lU3RhdHVzQmF0Y2hlcyh7c3RhdHVzLCBjb2x1bW4sIGN1dG9mZiwgYmF0Y2hTaXplfSkge1xuICAgIGxldCBkZWxldGVkID0gMFxuXG4gICAgZm9yICg7Oykge1xuICAgICAgY29uc3QgY2FuZGlkYXRlcyA9IGF3YWl0IHRoaXMuX3dpdGhEYihhc3luYyAoZGIpID0+XG4gICAgICAgIGF3YWl0IGRiXG4gICAgICAgICAgLm5ld1F1ZXJ5KClcbiAgICAgICAgICAuZnJvbShKT0JTX1RBQkxFKVxuICAgICAgICAgIC5zZWxlY3QoXCJpZFwiKVxuICAgICAgICAgIC53aGVyZSh7c3RhdHVzfSlcbiAgICAgICAgICAud2hlcmUoYCR7ZGIucXVvdGVDb2x1bW4oY29sdW1uKX0gPD0gJHtkYi5xdW90ZShjdXRvZmYpfWApXG4gICAgICAgICAgLm9yZGVyKHtjb2x1bW4sIGRpcmVjdGlvbjogXCJBU0NcIn0pXG4gICAgICAgICAgLm9yZGVyKHtjb2x1bW46IFwiaWRcIiwgZGlyZWN0aW9uOiBcIkFTQ1wifSlcbiAgICAgICAgICAubGltaXQoYmF0Y2hTaXplKVxuICAgICAgICAgIC5yZXN1bHRzKClcbiAgICAgIClcblxuICAgICAgaWYgKGNhbmRpZGF0ZXMubGVuZ3RoID09PSAwKSBicmVha1xuXG4gICAgICBjb25zdCBjYW5kaWRhdGVJZHMgPSBPYmplY3QuZnJlZXplKGNhbmRpZGF0ZXMubWFwKCgvKiogQHR5cGUge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gKi8gcm93KSA9PiBTdHJpbmcocm93LmlkKSkpXG5cbiAgICAgIGlmICh0aGlzLmFmdGVyUHJ1bmVDYW5kaWRhdGVzU2VsZWN0ZWQpIHtcbiAgICAgICAgYXdhaXQgdGhpcy5hZnRlclBydW5lQ2FuZGlkYXRlc1NlbGVjdGVkKE9iamVjdC5mcmVlemUoe1xuICAgICAgICAgIGNhbmRpZGF0ZXM6IGNhbmRpZGF0ZUlkcyxcbiAgICAgICAgICBjb2x1bW4sXG4gICAgICAgICAgY3V0b2ZmLFxuICAgICAgICAgIHN0YXR1c1xuICAgICAgICB9KSlcbiAgICAgIH1cblxuICAgICAgY29uc3QgcmVtb3ZlZCA9IGF3YWl0IHRoaXMuX3NlcmlhbGl6ZWRDb3VudE11dGF0aW9uKGFzeW5jIChkYikgPT4ge1xuICAgICAgICBjb25zdCBpZHMgPSBjYW5kaWRhdGVJZHMubWFwKChpZCkgPT4gZGIucXVvdGUoaWQpKS5qb2luKFwiLCBcIilcblxuICAgICAgICBjb25zdCByZW1vdmVkID0gYXdhaXQgZGIuYWZmZWN0ZWRSb3dzKFxuICAgICAgICAgIGBERUxFVEUgRlJPTSAke2RiLnF1b3RlVGFibGUoSk9CU19UQUJMRSl9IFdIRVJFICR7ZGIucXVvdGVDb2x1bW4oXCJpZFwiKX0gSU4gKCR7aWRzfSkgQU5EICR7ZGIucXVvdGVDb2x1bW4oXCJzdGF0dXNcIil9ID0gJHtkYi5xdW90ZShzdGF0dXMpfSBBTkQgJHtkYi5xdW90ZUNvbHVtbihjb2x1bW4pfSA8PSAke2RiLnF1b3RlKGN1dG9mZil9YFxuICAgICAgICApXG5cbiAgICAgICAgYXdhaXQgdGhpcy5fcmVjb3JkQ291bnREZWx0YShkYiwge2FsbDogLXJlbW92ZWQsIFtzdGF0dXNdOiAtcmVtb3ZlZH0pXG5cbiAgICAgICAgcmV0dXJuIHJlbW92ZWRcbiAgICAgIH0pXG5cbiAgICAgIGRlbGV0ZWQgKz0gcmVtb3ZlZFxuICAgICAgaWYgKGNhbmRpZGF0ZXMubGVuZ3RoIDwgYmF0Y2hTaXplKSBicmVha1xuICAgIH1cblxuICAgIHJldHVybiBkZWxldGVkXG4gIH1cblxuICAvKipcbiAgICogUnVucyBjbGVhciBhbGwuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIHdoZW4gY2xlYXJlZC5cbiAgICovXG4gIGFzeW5jIGNsZWFyQWxsKCkge1xuICAgIGF3YWl0IHRoaXMuZW5zdXJlUmVhZHkoKVxuXG4gICAgYXdhaXQgdGhpcy5fc2VyaWFsaXplZENvdW50TXV0YXRpb24oYXN5bmMgKGRiKSA9PiB7XG4gICAgICBjb25zdCBzbmFwc2hvdCA9IGF3YWl0IHRoaXMuX2NvdW50U25hcHNob3RPbkxvY2tlZENvbm5lY3Rpb24oZGIpXG4gICAgICBpZiAoYXdhaXQgZGIudGFibGVFeGlzdHMoTUFJTF9ERUxJVkVSWV9PUEVSQVRJT05TX1RBQkxFKSkgYXdhaXQgZGIucXVlcnkoYERFTEVURSBGUk9NICR7ZGIucXVvdGVUYWJsZShNQUlMX0RFTElWRVJZX09QRVJBVElPTlNfVEFCTEUpfWApXG4gICAgICBpZiAoYXdhaXQgZGIudGFibGVFeGlzdHMoSURFTVBPVEVOQ1lfS0VZU19UQUJMRSkpIGF3YWl0IGRiLnF1ZXJ5KGBERUxFVEUgRlJPTSAke2RiLnF1b3RlVGFibGUoSURFTVBPVEVOQ1lfS0VZU19UQUJMRSl9YClcbiAgICAgIGlmIChhd2FpdCBkYi50YWJsZUV4aXN0cyhTQ0hFRFVMRV9LRVlTX1RBQkxFKSkgYXdhaXQgZGIucXVlcnkoYERFTEVURSBGUk9NICR7ZGIucXVvdGVUYWJsZShTQ0hFRFVMRV9LRVlTX1RBQkxFKX1gKVxuICAgICAgaWYgKGF3YWl0IGRiLnRhYmxlRXhpc3RzKFNDSEVEVUxFX09SREVSX1dBVEVSTUFSS1NfVEFCTEUpKSB7XG4gICAgICAgIGNvbnN0IHdhdGVybWFya1Jvd3MgPSBhd2FpdCBkYlxuICAgICAgICAgIC5uZXdRdWVyeSgpXG4gICAgICAgICAgLmZyb20oU0NIRURVTEVfT1JERVJfV0FURVJNQVJLU19UQUJMRSlcbiAgICAgICAgICAuc2VsZWN0KFwic2NoZWR1bGVfa2V5XCIpXG4gICAgICAgICAgLnJlc3VsdHMoKVxuXG4gICAgICAgIGZvciAoY29uc3Qgd2F0ZXJtYXJrUm93IG9mIHdhdGVybWFya1Jvd3MpIHtcbiAgICAgICAgICBhd2FpdCBkYi5kZWxldGUoe1xuICAgICAgICAgICAgdGFibGVOYW1lOiBTQ0hFRFVMRV9PUkRFUl9XQVRFUk1BUktTX1RBQkxFLFxuICAgICAgICAgICAgY29uZGl0aW9uczoge1xuICAgICAgICAgICAgICBzY2hlZHVsZV9rZXk6IFN0cmluZygvKiogQHR5cGUge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gKi8gKHdhdGVybWFya1Jvdykuc2NoZWR1bGVfa2V5KVxuICAgICAgICAgICAgfVxuICAgICAgICAgIH0pXG4gICAgICAgIH1cbiAgICAgIH1cbiAgICAgIGF3YWl0IGRiLnF1ZXJ5KGBERUxFVEUgRlJPTSAke2RiLnF1b3RlVGFibGUoSk9CU19UQUJMRSl9YClcbiAgICAgIGlmIChhd2FpdCBkYi50YWJsZUV4aXN0cyhDT05DVVJSRU5DWV9UQUJMRSkpIGF3YWl0IGRiLnF1ZXJ5KGBERUxFVEUgRlJPTSAke2RiLnF1b3RlVGFibGUoQ09OQ1VSUkVOQ1lfVEFCTEUpfWApXG4gICAgICBjb25zdCBkZWx0YXMgPSBPYmplY3QuZnJvbUVudHJpZXMoT2JqZWN0LmVudHJpZXMoc25hcHNob3QuY291bnRzKS5tYXAoKFtrZXksIHZhbHVlXSkgPT4gW2tleSwgLXZhbHVlXSkpXG4gICAgICBhd2FpdCB0aGlzLl9yZWNvcmRDb3VudERlbHRhKGRiLCBkZWx0YXMpXG4gICAgfSlcbiAgfVxuXG4gIC8qKlxuICAgKiBDYW5jZWxzIGEgcXVldWVkIG9yIGhhbmRlZC1vZmYgam9iIGFuZCByZWxlYXNlcyBhbnkgZHVyYWJsZSBjb25jdXJyZW5jeSByZXNlcnZhdGlvbi5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGpvYklkIC0gSm9iIGlkLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxib29sZWFuPn0gLSBXaGV0aGVyIHRoZSBqb2Igd2FzIGNhbmNlbGxlZC5cbiAgICovXG4gIGFzeW5jIGNhbmNlbChqb2JJZCkge1xuICAgIGF3YWl0IHRoaXMuZW5zdXJlUmVhZHkoKVxuICAgIHJldHVybiBhd2FpdCB0aGlzLl9zZXJpYWxpemVkQ291bnRNdXRhdGlvbihhc3luYyAoZGIpID0+IHtcbiAgICAgIGNvbnN0IGpvYiA9IGF3YWl0IHRoaXMuX2dldEpvYlJvd0J5SWQoZGIsIGpvYklkKVxuICAgICAgaWYgKCFqb2IgfHwgKGpvYi5zdGF0dXMgIT09IFwicXVldWVkXCIgJiYgam9iLnN0YXR1cyAhPT0gXCJoYW5kZWRfb2ZmXCIpKSByZXR1cm4gZmFsc2VcbiAgICAgIC8vIE9ubHkgYSBoYW5kZWRfb2ZmIGpvYiBob2xkcyBhIGNvbmN1cnJlbmN5IHJlc2VydmF0aW9uLCBzbyBvbmx5IHRoYXQgY2FzZSB0b3VjaGVzIHRoZVxuICAgICAgLy8gc2hhcmVkIGNvdW50ZXIgcm93IGFuZCBuZWVkcyB0aGUgY29uY3VycmVuY3ktdGhlbi1qb2IgbG9jayBvcmRlcmluZy5cbiAgICAgIGlmIChqb2Iuc3RhdHVzID09PSBcImhhbmRlZF9vZmZcIikgYXdhaXQgdGhpcy5fbG9ja0NvbmN1cnJlbmN5Um93KGRiLCBqb2IuY29uY3VycmVuY3lLZXkpXG4gICAgICBjb25zdCBhZmZlY3RlZFJvd3MgPSBhd2FpdCB0aGlzLl91cGRhdGVBZmZlY3RlZFJvd3MoZGIsIHt0YWJsZU5hbWU6IEpPQlNfVEFCTEUsIGRhdGE6IHtzdGF0dXM6IFwiY2FuY2VsbGVkXCJ9LCBjb25kaXRpb25zOiB7aWQ6IGpvYi5pZCwgc3RhdHVzOiBqb2Iuc3RhdHVzfX0pXG4gICAgICBpZiAoYWZmZWN0ZWRSb3dzICE9PSAxKSByZXR1cm4gZmFsc2VcbiAgICAgIGF3YWl0IHRoaXMuX3JlbGVhc2VTY2hlZHVsZU93bmVyc2hpcEZvckpvYihkYiwgam9iKVxuICAgICAgaWYgKGpvYi5zdGF0dXMgPT09IFwiaGFuZGVkX29mZlwiKSBhd2FpdCB0aGlzLl9yZWxlYXNlQ29uY3VycmVuY3koZGIsIGpvYi5jb25jdXJyZW5jeUtleSlcbiAgICAgIGF3YWl0IHRoaXMuX3JlY29yZFN0YXR1c1RyYW5zaXRpb24oZGIsIGpvYi5zdGF0dXMsIFwiY2FuY2VsbGVkXCIpXG4gICAgICByZXR1cm4gdHJ1ZVxuICAgIH0pXG4gIH1cblxuICAvKipcbiAgICogUnVucyBnZXQgcmV0cnkgZGVsYXkgbXMuXG4gICAqIEBwYXJhbSB7bnVtYmVyfSByZXRyeUNvdW50IC0gUmV0cnkgYXR0ZW1wdCBjb3VudCAoMS1iYXNlZCkuXG4gICAqIEByZXR1cm5zIHtudW1iZXJ9IC0gRGVsYXkgaW4gbWlsbGlzZWNvbmRzLlxuICAgKi9cbiAgZ2V0UmV0cnlEZWxheU1zKHJldHJ5Q291bnQpIHtcbiAgICByZXR1cm4gcmV0cnlEZWxheU1zKHJldHJ5Q291bnQpXG4gIH1cblxuICAvKipcbiAgICogTm9ybWFsaXplcyBvbmUgbmV3IGpvYiBiZWZvcmUgZW50ZXJpbmcgaXRzIHBlcnNpc3RlbmNlIHRyYW5zYWN0aW9uLlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIEpvYiBpbnB1dC5cbiAgICogQHBhcmFtIHtBcnJheTxSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59IGFyZ3MuYXJncyAtIEpvYiBhcmd1bWVudHMuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBhcmdzLmpvYk5hbWUgLSBKb2IgbmFtZS5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL3R5cGVzLmpzXCIpLkJhY2tncm91bmRKb2JPcHRpb25zfSBbYXJncy5vcHRpb25zXSAtIEpvYiBvcHRpb25zLlxuICAgKiBAcmV0dXJucyB7UHJlcGFyZWRCYWNrZ3JvdW5kSm9ifSAtIFByZXBhcmVkIGpvYi5cbiAgICovXG4gIF9wcmVwYXJlSm9iKHthcmdzLCBqb2JOYW1lLCBvcHRpb25zfSkge1xuICAgIGNvbnN0IGNyZWF0ZWRBdE1zID0gdGhpcy5jbG9jay5ub3coKVxuICAgIGNvbnN0IHF1ZXVlID0gdGhpcy5fbm9ybWFsaXplUXVldWUob3B0aW9ucylcblxuICAgIHJldHVybiB7XG4gICAgICBhcmdzSnNvbjogSlNPTi5zdHJpbmdpZnkoYXJncyB8fCBbXSksXG4gICAgICBjb25jdXJyZW5jeTogdGhpcy5fcmVzb2x2ZUNvbmN1cnJlbmN5KG9wdGlvbnMsIHF1ZXVlKSxcbiAgICAgIGNyZWF0ZWRBdE1zLFxuICAgICAgZXhlY3V0aW9uTW9kZTogdGhpcy5fbm9ybWFsaXplRXhlY3V0aW9uTW9kZShvcHRpb25zKSxcbiAgICAgIGpvYklkOiByYW5kb21VVUlEKCksXG4gICAgICBqb2JOYW1lLFxuICAgICAgbWF4UmV0cmllczogdGhpcy5fbm9ybWFsaXplTWF4UmV0cmllcyhvcHRpb25zPy5tYXhSZXRyaWVzKSxcbiAgICAgIHByaW9yaXR5OiB0aGlzLl9ub3JtYWxpemVKb2JQcmlvcml0eShvcHRpb25zKSxcbiAgICAgIHF1ZXVlLFxuICAgICAgc2NoZWR1bGVkQXRNczogdGhpcy5fbm9ybWFsaXplU2NoZWR1bGVkQXRNcyhvcHRpb25zPy5zY2hlZHVsZWRBdE1zLCBjcmVhdGVkQXRNcyksXG4gICAgICB0aW1lb3V0TXM6IHRoaXMuX25vcm1hbGl6ZUpvYlRpbWVvdXRNcyhvcHRpb25zKVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBOb3JtYWxpemVzIGEgcmVxdWVzdGVkIGRpc3BhdGNoIHByaW9yaXR5LiBQcmlvcml0aWVzIG9yZGVyIGpvYnMgd2l0aGluIHRoZWlyXG4gICAqIHF1ZXVlIG9uIHRoZSBkaXNwYXRjaCBwYXRoIG9ubHk6IGhpZ2hlciBnb2VzIGZpcnN0LCBhbmQgdGhlIGRlZmF1bHQga2VlcHNcbiAgICogRklGTyBvcmRlci4gTmVnYXRpdmUgcHJpb3JpdGllcyBhcmUgcmVqZWN0ZWQgYmVjYXVzZSB0aGUgc3RvcmUgcmVzZXJ2ZXMgdGhlbVxuICAgKiBmb3Ige0BsaW5rIFJFVFJZX0JBQ0tHUk9VTkRfSk9CX1BSSU9SSVRZfSwgd2hpY2ggbXVzdCBzdGF5IHRoZSBsb3dlc3QuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi90eXBlcy5qc1wiKS5CYWNrZ3JvdW5kSm9iT3B0aW9ucyB8IHVuZGVmaW5lZH0gb3B0aW9ucyAtIEpvYiBvcHRpb25zLlxuICAgKiBAcmV0dXJucyB7bnVtYmVyfSAtIFByaW9yaXR5LlxuICAgKi9cbiAgX25vcm1hbGl6ZUpvYlByaW9yaXR5KG9wdGlvbnMpIHtcbiAgICBjb25zdCBwcmlvcml0eSA9IG9wdGlvbnM/LnByaW9yaXR5XG5cbiAgICBpZiAocHJpb3JpdHkgPT09IHVuZGVmaW5lZCkgcmV0dXJuIERFRkFVTFRfQkFDS0dST1VORF9KT0JfUFJJT1JJVFlcblxuICAgIGlmICh0eXBlb2YgcHJpb3JpdHkgIT09IFwibnVtYmVyXCIgfHwgIU51bWJlci5pc0ludGVnZXIocHJpb3JpdHkpIHx8IHByaW9yaXR5IDwgMCkge1xuICAgICAgdGhyb3cgVmVsb2Npb3VzRXJyb3Iuc2FmZShCQUNLR1JPVU5EX0pPQl9QUklPUklUWV9WQUxJREFUSU9OX01FU1NBR0UpXG4gICAgfVxuXG4gICAgcmV0dXJuIHByaW9yaXR5XG4gIH1cblxuICAvKipcbiAgICogTm9ybWFsaXplcyBhIHBlci1qb2IgdGltZW91dCB3aGlsZSBwcmVzZXJ2aW5nIG9taXR0ZWQgKHdvcmtlciBmYWxsYmFjaylcbiAgICogc2VwYXJhdGVseSBmcm9tIGV4cGxpY2l0bHkgZGlzYWJsZWQuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi90eXBlcy5qc1wiKS5CYWNrZ3JvdW5kSm9iT3B0aW9ucyB8IHVuZGVmaW5lZH0gb3B0aW9ucyAtIEpvYiBvcHRpb25zLlxuICAgKiBAcmV0dXJucyB7bnVtYmVyIHwgbnVsbH0gLSBQb3NpdGl2ZSB0aW1lb3V0LCB6ZXJvIGZvciBkaXNhYmxlZCwgb3IgbnVsbCB3aGVuIG9taXR0ZWQuXG4gICAqL1xuICBfbm9ybWFsaXplSm9iVGltZW91dE1zKG9wdGlvbnMpIHtcbiAgICBpZiAob3B0aW9ucz8udGltZW91dE1zID09PSB1bmRlZmluZWQpIHJldHVybiBudWxsXG5cbiAgICBjb25zdCB0aW1lb3V0TXMgPSBvcHRpb25zLnRpbWVvdXRNc1xuXG4gICAgaWYgKHR5cGVvZiB0aW1lb3V0TXMgIT09IFwibnVtYmVyXCIgfHwgIU51bWJlci5pc0Zpbml0ZSh0aW1lb3V0TXMpKSB7XG4gICAgICB0aHJvdyBWZWxvY2lvdXNFcnJvci5zYWZlKEpPQl9USU1FT1VUX1ZBTElEQVRJT05fTUVTU0FHRSlcbiAgICB9XG5cbiAgICBpZiAodGltZW91dE1zIDw9IDApIHJldHVybiAwXG5cbiAgICBpZiAoIU51bWJlci5pc0ludGVnZXIodGltZW91dE1zKSB8fCB0aW1lb3V0TXMgPiBNQVhfSk9CX1RJTUVPVVRfTVMpIHtcbiAgICAgIHRocm93IFZlbG9jaW91c0Vycm9yLnNhZmUoSk9CX1RJTUVPVVRfVkFMSURBVElPTl9NRVNTQUdFKVxuICAgIH1cblxuICAgIHJldHVybiB0aW1lb3V0TXNcbiAgfVxuXG4gIC8qKlxuICAgKiBJbnNlcnRzIG9uZSBwcmVwYXJlZCBxdWV1ZWQgam9iLCBpbmNsdWRpbmcgaXRzIGNvbmN1cnJlbmN5IHJlZ2lzdHJhdGlvbi5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9kYXRhYmFzZS9kcml2ZXJzL2Jhc2UuanNcIikuZGVmYXVsdH0gZGIgLSBEYXRhYmFzZSBjb25uZWN0aW9uLlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIEluc2VydCBpbnB1dC5cbiAgICogQHBhcmFtIHtQcmVwYXJlZEJhY2tncm91bmRKb2J9IGFyZ3MucHJlcGFyZWRKb2IgLSBQcmVwYXJlZCBqb2IuXG4gICAqIEBwYXJhbSB7c3RyaW5nIHwgbnVsbH0gYXJncy5zY2hlZHVsZUtleSAtIEhpc3RvcmljYWwgc3RhYmxlIGtleS5cbiAgICogQHBhcmFtIHtudW1iZXIgfCBudWxsfSBbYXJncy5zY2hlZHVsZU9yZGVyXSAtIE1vbm90b25pYyBzdGFibGUgb3duZXJzaGlwIG9yZGVyLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyBhZnRlciBpbnNlcnRpb24uXG4gICAqL1xuICBhc3luYyBfaW5zZXJ0UHJlcGFyZWRKb2IoZGIsIHtwcmVwYXJlZEpvYiwgc2NoZWR1bGVLZXksIHNjaGVkdWxlT3JkZXIgPSBudWxsfSkge1xuICAgIGNvbnN0IHtjb25jdXJyZW5jeX0gPSBwcmVwYXJlZEpvYlxuXG4gICAgaWYgKGNvbmN1cnJlbmN5KSB7XG4gICAgICBpZiAoY29uY3VycmVuY3kucXVldWVEZXJpdmVkKSB7XG4gICAgICAgIGF3YWl0IHRoaXMuX2Vuc3VyZVF1ZXVlQ29uY3VycmVuY3lLZXkoZGIsIGNvbmN1cnJlbmN5KVxuICAgICAgfSBlbHNlIHtcbiAgICAgICAgYXdhaXQgdGhpcy5fZW5zdXJlQ29uY3VycmVuY3lLZXkoZGIsIGNvbmN1cnJlbmN5KVxuICAgICAgfVxuICAgIH1cblxuICAgIGF3YWl0IGRiLmluc2VydCh7XG4gICAgICB0YWJsZU5hbWU6IEpPQlNfVEFCTEUsXG4gICAgICBkYXRhOiB7XG4gICAgICAgIGlkOiBwcmVwYXJlZEpvYi5qb2JJZCxcbiAgICAgICAgam9iX25hbWU6IHByZXBhcmVkSm9iLmpvYk5hbWUsXG4gICAgICAgIGFyZ3NfanNvbjogcHJlcGFyZWRKb2IuYXJnc0pzb24sXG4gICAgICAgIGV4ZWN1dGlvbl9tb2RlOiBwcmVwYXJlZEpvYi5leGVjdXRpb25Nb2RlLFxuICAgICAgICBxdWV1ZTogcHJlcGFyZWRKb2IucXVldWUsXG4gICAgICAgIG1heF9yZXRyaWVzOiBwcmVwYXJlZEpvYi5tYXhSZXRyaWVzLFxuICAgICAgICBwcmlvcml0eTogcHJlcGFyZWRKb2IucHJpb3JpdHksXG4gICAgICAgIGF0dGVtcHRzOiAwLFxuICAgICAgICBzdGF0dXM6IFwicXVldWVkXCIsXG4gICAgICAgIHNjaGVkdWxlZF9hdF9tczogcHJlcGFyZWRKb2Iuc2NoZWR1bGVkQXRNcyxcbiAgICAgICAgY3JlYXRlZF9hdF9tczogcHJlcGFyZWRKb2IuY3JlYXRlZEF0TXMsXG4gICAgICAgIHNjaGVkdWxlX2tleTogc2NoZWR1bGVLZXksXG4gICAgICAgIHNjaGVkdWxlX29yZGVyOiBzY2hlZHVsZU9yZGVyLFxuICAgICAgICBjb25jdXJyZW5jeV9rZXk6IGNvbmN1cnJlbmN5Py5jb25jdXJyZW5jeUtleSB8fCBudWxsLFxuICAgICAgICBtYXhfY29uY3VycmVuY3k6IGNvbmN1cnJlbmN5Py5tYXhDb25jdXJyZW5jeSB8fCBudWxsLFxuICAgICAgICB0aW1lb3V0X21zOiBwcmVwYXJlZEpvYi50aW1lb3V0TXMsXG4gICAgICAgIGhhbmRvZmZfaWQ6IG51bGxcbiAgICAgIH1cbiAgICB9KVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgbm9ybWFsaXplIG1heCByZXRyaWVzLlxuICAgKiBAcGFyYW0ge251bWJlciB8IG51bGwgfCB1bmRlZmluZWR9IG1heFJldHJpZXMgLSBJbnB1dC5cbiAgICogQHJldHVybnMge251bWJlcn0gLSBOb3JtYWxpemVkIG1heCByZXRyaWVzLlxuICAgKi9cbiAgX25vcm1hbGl6ZU1heFJldHJpZXMobWF4UmV0cmllcykge1xuICAgIHJldHVybiBub3JtYWxpemVCYWNrZ3JvdW5kSm9iTWF4UmV0cmllcyhtYXhSZXRyaWVzKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgbm9ybWFsaXplIHNjaGVkdWxlZCBhdCBtcy5cbiAgICogQHBhcmFtIHtudW1iZXIgfCB1bmRlZmluZWR9IHNjaGVkdWxlZEF0TXMgLSBSZXF1ZXN0ZWQgZGlzcGF0Y2ggdGltZXN0YW1wLlxuICAgKiBAcGFyYW0ge251bWJlcn0gZGVmYXVsdFNjaGVkdWxlZEF0TXMgLSBEZWZhdWx0IGRpc3BhdGNoIHRpbWVzdGFtcC5cbiAgICogQHJldHVybnMge251bWJlcn0gLSBEaXNwYXRjaCB0aW1lc3RhbXAuXG4gICAqL1xuICBfbm9ybWFsaXplU2NoZWR1bGVkQXRNcyhzY2hlZHVsZWRBdE1zLCBkZWZhdWx0U2NoZWR1bGVkQXRNcykge1xuICAgIHJldHVybiBub3JtYWxpemVCYWNrZ3JvdW5kSm9iU2NoZWR1bGVkQXRNcyhzY2hlZHVsZWRBdE1zLCBkZWZhdWx0U2NoZWR1bGVkQXRNcylcbiAgfVxuXG4gIC8qKlxuICAgKiBSZXNvbHZlcyBhIHJlc2NoZWR1bGUgZGVsYXkgYWdhaW5zdCBwZXJzaXN0ZW5jZSB0aW1lLlxuICAgKiBAcGFyYW0ge251bWJlcn0gZGVsYXlNcyAtIERlbGF5IGluIG1pbGxpc2Vjb25kcy5cbiAgICogQHJldHVybnMge251bWJlcn0gLSBGdXR1cmUgZWxpZ2liaWxpdHkgdGltZXN0YW1wLlxuICAgKi9cbiAgX3Jlc2NoZWR1bGVkQXRNcyhkZWxheU1zKSB7XG4gICAgcmV0dXJuIHJlc2NoZWR1bGVkQmFja2dyb3VuZEpvYkF0TXMoZGVsYXlNcywgdGhpcy5jbG9jay5ub3coKSlcbiAgfVxuXG4gIC8qKlxuICAgKiBWYWxpZGF0ZXMgYSBwdWJsaWMgcmVzY2hlZHVsZSBkZWxheSBiZWZvcmUgcGVyc2lzdGVuY2Ugd29yayBiZWdpbnMuXG4gICAqIEBwYXJhbSB7bnVtYmVyfSBkZWxheU1zIC0gRGVsYXkgaW4gbWlsbGlzZWNvbmRzLlxuICAgKiBAcmV0dXJucyB7dm9pZH1cbiAgICovXG4gIF92YWxpZGF0ZVJlc2NoZWR1bGVEZWxheU1zKGRlbGF5TXMpIHtcbiAgICByZXNjaGVkdWxlZEJhY2tncm91bmRKb2JBdE1zKGRlbGF5TXMsIDApXG4gIH1cblxuICAvKipcbiAgICogVmFsaWRhdGVzIGEgc3RhYmxlIHNjaGVkdWxlIGtleSBhdCB0aGUgcHVibGljIHN0b3JhZ2UgYm91bmRhcnkuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBzY2hlZHVsZUtleSAtIFN0YWJsZSBsb2dpY2FsIHNjaGVkdWxlIGtleS5cbiAgICogQHJldHVybnMge3N0cmluZ30gLSBWYWxpZGF0ZWQga2V5LlxuICAgKi9cbiAgX25vcm1hbGl6ZVNjaGVkdWxlS2V5KHNjaGVkdWxlS2V5KSB7XG4gICAgcmV0dXJuIG5vcm1hbGl6ZUJhY2tncm91bmRKb2JTY2hlZHVsZUtleShzY2hlZHVsZUtleSlcbiAgfVxuXG4gIC8qKlxuICAgKiBCdWlsZHMgYSBib3VuZGVkIGFkdmlzb3J5LWxvY2sgbmFtZSBmb3Igb25lIHN0YWJsZSBzY2hlZHVsZSBrZXkuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBzY2hlZHVsZUtleSAtIFZhbGlkYXRlZCBzdGFibGUgc2NoZWR1bGUga2V5LlxuICAgKiBAcmV0dXJucyB7c3RyaW5nfSAtIEFkdmlzb3J5LWxvY2sgbmFtZS5cbiAgICovXG4gIF9zY2hlZHVsZUtleUxvY2tOYW1lKHNjaGVkdWxlS2V5KSB7XG4gICAgY29uc3QgaGFzaCA9IGNyZWF0ZUhhc2goXCJzaGEyNTZcIikudXBkYXRlKHNjaGVkdWxlS2V5KS5kaWdlc3QoXCJoZXhcIikuc2xpY2UoMCwgMzIpXG5cbiAgICByZXR1cm4gYGJhY2tncm91bmQtam9iczpzY2hlZHVsZToke2hhc2h9YFxuICB9XG5cbiAgLyoqXG4gICAqIEVuc3VyZXMgdGhlIGJhY2tncm91bmQtam9icyBzY2hlbWEgZXhpc3RzLCByZXVzaW5nIGEgY2FsbGVyLWhlbGQgY29ubmVjdGlvbiB3aGVuXG4gICAqIG9uZSBpcyBnaXZlbiByYXRoZXIgdGhhbiBjaGVja2luZyBvdXQgaXRzIG93bi5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9kYXRhYmFzZS9kcml2ZXJzL2Jhc2UuanNcIikuZGVmYXVsdH0gW2V4aXN0aW5nRGJdIC0gUmV1c2UgYW5cbiAgICogICBhbHJlYWR5LWNoZWNrZWQtb3V0IGNvbm5lY3Rpb24gKGUuZy4gdGhlIG9uZSBgZGI6bWlncmF0ZWAgaG9sZHMpIGluc3RlYWQgb2ZcbiAgICogICBjaGVja2luZyBvdXQgYSBuZXN0ZWQgb25lIOKAlCB0aGUgbmVzdGVkIGNoZWNrb3V0IHdvdWxkIGRlYWRsb2NrIGEgZGF0YWJhc2VcbiAgICogICB3aG9zZSBwb29sIGlzIGNhcHBlZCBhdCBhIHNpbmdsZSBjb25uZWN0aW9uIGFscmVhZHkgaGVsZCBieSB0aGUgY2FsbGVyLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyB3aGVuIHRoZSBzY2hlbWEgaXMgcHJlc2VudC5cbiAgICovXG4gIGFzeW5jIF9lbnN1cmVTY2hlbWEoZXhpc3RpbmdEYikge1xuICAgIGF3YWl0IHRoaXMuX2FwcGx5U2NoZW1hKGV4aXN0aW5nRGIpXG4gIH1cblxuICAvKipcbiAgICogU2VyaWFsaXplcyBjcmVhdGlvbiBvciB1cGdyYWRlIG9mIHRoZSBiYWNrZ3JvdW5kLWpvYnMgc2NoZW1hLCBjaGVja2luZyBvdXQgYVxuICAgKiBjb25uZWN0aW9uIG9ubHkgYWZ0ZXIgZWFybGllciBzY2hlbWEgd29yayBoYXMgY29tcGxldGVkIHdoZW4gb25lIGlzIG5vdCBzdXBwbGllZC5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9kYXRhYmFzZS9kcml2ZXJzL2Jhc2UuanNcIikuZGVmYXVsdH0gW2V4aXN0aW5nRGJdIC0gQ2FsbGVyLW93bmVkXG4gICAqICAgZGF0YWJhc2UgY29ubmVjdGlvbi5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgd2hlbiB0aGUgc2NoZW1hIGlzIHByZXNlbnQuXG4gICAqL1xuICBhc3luYyBfYXBwbHlTY2hlbWEoZXhpc3RpbmdEYikge1xuICAgIC8vIFNlcmlhbGl6ZSBjb25jdXJyZW50IHNjaGVtYSBhcHBsaWVzIHdpdGhpbiB0aGlzIHByb2Nlc3MsIGtleWVkIGJ5IGRhdGFiYXNlXG4gICAgLy8gaWRlbnRpZmllciAoc2VlIGBzY2hlbWFBcHBseUNoYWluc2ApLiBUaGUgcGVyLXN0ZXAgbG9ja3MgaW5zaWRlIHRoZSBzdGVwcyB1c2VcbiAgICAvLyBESUZGRVJFTlQgbG9jayBuYW1lcywgc28gdHdvIGNvbmN1cnJlbnQgY2FsbGVycyBjb3VsZCBvdGhlcndpc2UgZWFjaCBob2xkIGFcbiAgICAvLyBkaWZmZXJlbnQgc3RlcCBsb2NrIHdoaWxlIGJvdGggcmVidWlsZCB0aGUgam9icyB0YWJsZSDigJQgYW5kIG9uIFNRTGl0ZS9NU1NRTCBhblxuICAgIC8vIGFkZC1jb2x1bW4gaXMgYSBjcmVhdGUtY29weS1kcm9wLXJlbmFtZSByZWJ1aWxkLCBzbyBvdmVybGFwcGluZyByZWJ1aWxkc1xuICAgIC8vIGNvcnJ1cHQgaXQuIFRoaXMgbXV0ZXggbWFrZXMgdGhlIHdob2xlIGFwcGx5IG11dHVhbGx5IGV4Y2x1c2l2ZSBwZXIgcHJvY2VzcztcbiAgICAvLyB0aGUgc2Vjb25kIGNhbGxlciB0aGVuIHJlLWNoZWNrcyBhbmQgZmluZHMgZXZlcnkgc3RlcCBhbHJlYWR5IGRvbmUuXG4gICAgY29uc3QgaWRlbnRpZmllciA9IHRoaXMuZ2V0RGF0YWJhc2VJZGVudGlmaWVyKCkgPz8gXCJkZWZhdWx0XCJcbiAgICBjb25zdCBwcmV2aW91cyA9IHNjaGVtYUFwcGx5Q2hhaW5zLmdldChpZGVudGlmaWVyKSA/PyBQcm9taXNlLnJlc29sdmUoKVxuICAgIGNvbnN0IGFwcGx5V2l0aENvbm5lY3Rpb24gPSBhc3luYyAoKSA9PiB7XG4gICAgICBpZiAoZXhpc3RpbmdEYikge1xuICAgICAgICBhd2FpdCB0aGlzLl9hcHBseVNjaGVtYVN0ZXBzKGV4aXN0aW5nRGIpXG5cbiAgICAgICAgcmV0dXJuXG4gICAgICB9XG5cbiAgICAgIGF3YWl0IHRoaXMuX3dpdGhEYigoZGIpID0+IHRoaXMuX2FwcGx5U2NoZW1hU3RlcHMoZGIpKVxuICAgIH1cbiAgICBjb25zdCBydW4gPSBwcmV2aW91cy50aGVuKGFwcGx5V2l0aENvbm5lY3Rpb24sIGFwcGx5V2l0aENvbm5lY3Rpb24pXG5cbiAgICAvLyBLZWVwIHRoZSBjaGFpbiBhbGl2ZSByZWdhcmRsZXNzIG9mIHRoaXMgcnVuJ3Mgb3V0Y29tZSBzbyBvbmUgZmFpbGVkIGFwcGx5IGRvZXNcbiAgICAvLyBub3Qgd2VkZ2UgbGF0ZXIgY2FsbGVyczsgdGhpcyBydW4gc3RpbGwgcHJvcGFnYXRlcyBpdHMgb3duIHJlc3VsdC9lcnJvci5cbiAgICBzY2hlbWFBcHBseUNoYWlucy5zZXQoaWRlbnRpZmllciwgcnVuLnRoZW4oKCkgPT4ge30sICgpID0+IHt9KSlcblxuICAgIHJldHVybiBhd2FpdCBydW5cbiAgfVxuXG4gIC8qKlxuICAgKiBDcmVhdGVzIG9yIHVwZ3JhZGVzIHRoZSBiYWNrZ3JvdW5kLWpvYnMgdGFibGVzLCBjb2x1bW5zIGFuZCBjb25jdXJyZW5jeSByb3dzIG9uXG4gICAqIHRoZSBnaXZlbiBjb25uZWN0aW9uLiBTZXJpYWxpemVkIHBlciBwcm9jZXNzIGJ5IHtAbGluayBCYWNrZ3JvdW5kSm9ic1N0b3JlI19hcHBseVNjaGVtYX0uXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vZGF0YWJhc2UvZHJpdmVycy9iYXNlLmpzXCIpLmRlZmF1bHR9IGRiIC0gRGF0YWJhc2UgY29ubmVjdGlvbi5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgd2hlbiB0aGUgc2NoZW1hIGlzIHByZXNlbnQuXG4gICAqL1xuICBhc3luYyBfYXBwbHlTY2hlbWFTdGVwcyhkYikge1xuICAgIGF3YWl0IHRoaXMuX2Vuc3VyZU1pZ3JhdGlvbnNUYWJsZShkYilcblxuICAgIGNvbnN0IGFscmVhZHlBcHBsaWVkID0gYXdhaXQgdGhpcy5faGFzTWlncmF0aW9uKGRiKVxuICAgIGNvbnN0IHNjaGVtYVJlY292ZXJ5UGVuZGluZyA9IGF3YWl0IHRoaXMuX2hhc01pZ3JhdGlvbihkYiwgU0NIRU1BX1JFQ09WRVJZX1BFTkRJTkdfVkVSU0lPTilcbiAgICBjb25zdCBqb2JzVGFibGVFeGlzdHMgPSBhd2FpdCBkYi50YWJsZUV4aXN0cyhKT0JTX1RBQkxFKVxuXG4gICAgLy8gRXZlbiB3aGVuIHRoZSBtaWdyYXRpb24gcm93IGlzIHByZXNlbnQsIHRoZSBqb2JzIHRhYmxlIGl0c2VsZiBjYW4gaGF2ZVxuICAgIC8vIGJlZW4gZHJvcHBlZCB1bmRlcm5lYXRoIHVzIGJ5IGEgdHJhbnNhY3Rpb24gcm9sbGJhY2sgaW4gYW5vdGhlciBjYWxsZXJcbiAgICAvLyAoRERMIGlzIHRyYW5zYWN0aW9uYWwgb24gU1FMaXRlL01TU1FMKS4gVmVyaWZ5IHRoZSB0YWJsZSBwaHlzaWNhbGx5XG4gICAgLy8gZXhpc3RzIGFuZCByZWNyZWF0ZSBpdCB3aGVuIG1pc3NpbmcgcmF0aGVyIHRoYW4gdHJ1c3RpbmcgdGhlIG1pZ3JhdGlvblxuICAgIC8vIHJvdyBhbG9uZSwgb3RoZXJ3aXNlIGxhdGVyIGNhbGxlcnMgZmFpbCB3aXRoIFwibm8gc3VjaCB0YWJsZVwiLlxuICAgIGlmIChhbHJlYWR5QXBwbGllZCAmJiBqb2JzVGFibGVFeGlzdHMgJiYgIXNjaGVtYVJlY292ZXJ5UGVuZGluZykge1xuICAgICAgYXdhaXQgdGhpcy5fZW5zdXJlSm9ic1RhYmxlQ29sdW1ucyhkYilcbiAgICAgIGF3YWl0IHRoaXMuX2Vuc3VyZUlkZW1wb3RlbmN5S2V5c1RhYmxlKGRiKVxuICAgICAgYXdhaXQgdGhpcy5fZW5zdXJlTWFpbERlbGl2ZXJ5T3BlcmF0aW9uc1RhYmxlKGRiKVxuICAgICAgYXdhaXQgdGhpcy5fZW5zdXJlU2NoZWR1bGVLZXlzVGFibGUoZGIpXG4gICAgICBhd2FpdCB0aGlzLl9lbnN1cmVDb25jdXJyZW5jeVRhYmxlKGRiKVxuICAgICAgYXdhaXQgdGhpcy5fZW5zdXJlQ291bnRSZXZpc2lvblRhYmxlKGRiKVxuICAgICAgYXdhaXQgdGhpcy5fZW5zdXJlUmV0ZW50aW9uSW5kZXhlc09uY2UoZGIpXG5cbiAgICAgIHJldHVyblxuICAgIH1cblxuICAgIGlmIChhbHJlYWR5QXBwbGllZCAmJiAhc2NoZW1hUmVjb3ZlcnlQZW5kaW5nKSB7XG4gICAgICBhd2FpdCB0aGlzLl9yZWNvcmRNaWdyYXRpb24oZGIsIFNDSEVNQV9SRUNPVkVSWV9QRU5ESU5HX1ZFUlNJT04pXG4gICAgfVxuXG4gICAgYXdhaXQgdGhpcy5fYXBwbHlNaWdyYXRpb25zKGRiKVxuICAgIGF3YWl0IHRoaXMuX2Vuc3VyZUpvYnNUYWJsZUNvbHVtbnMoZGIpXG4gICAgYXdhaXQgdGhpcy5fZW5zdXJlSWRlbXBvdGVuY3lLZXlzVGFibGUoZGIpXG4gICAgYXdhaXQgdGhpcy5fZW5zdXJlTWFpbERlbGl2ZXJ5T3BlcmF0aW9uc1RhYmxlKGRiKVxuICAgIGF3YWl0IHRoaXMuX2Vuc3VyZVNjaGVkdWxlS2V5c1RhYmxlKGRiKVxuICAgIGF3YWl0IHRoaXMuX2Vuc3VyZUNvbmN1cnJlbmN5VGFibGUoZGIpXG4gICAgYXdhaXQgdGhpcy5fZW5zdXJlQ291bnRSZXZpc2lvblRhYmxlKGRiKVxuXG4gICAgaWYgKGFscmVhZHlBcHBsaWVkKSB7XG4gICAgICAvLyBUaGUgcmVjcmVhdGVkIGpvYnMgdGFibGUgaXMgZW1wdHksIGJ1dCB0aGUgc3Vydml2aW5nIGNvbmN1cnJlbmN5IHRhYmxlXG4gICAgICAvLyBjYW4gc3RpbGwgY291bnQgaGFuZG9mZnMgdGhhdCBkaXNhcHBlYXJlZCB3aXRoIHRoZSBkcm9wcGVkIGpvYnMgdGFibGUuXG4gICAgICBhd2FpdCB0aGlzLl9yZWNvbmNpbGVDb25jdXJyZW5jeShkYilcbiAgICAgIGF3YWl0IGRiLmRlbGV0ZSh7XG4gICAgICAgIHRhYmxlTmFtZTogTUlHUkFUSU9OU19UQUJMRSxcbiAgICAgICAgY29uZGl0aW9uczoge2tleTogdGhpcy5fbWlncmF0aW9uS2V5KFNDSEVNQV9SRUNPVkVSWV9QRU5ESU5HX1ZFUlNJT04pfVxuICAgICAgfSlcblxuICAgICAgcmV0dXJuXG4gICAgfVxuXG4gICAgYXdhaXQgdGhpcy5fcmVjb3JkTWlncmF0aW9uKGRiLCBNSUdSQVRJT05fVkVSU0lPTilcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGVuc3VyZSBtaWdyYXRpb25zIHRhYmxlLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL2RhdGFiYXNlL2RyaXZlcnMvYmFzZS5qc1wiKS5kZWZhdWx0fSBkYiAtIERhdGFiYXNlIGNvbm5lY3Rpb24uXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIHdoZW4gY29tcGxldGUuXG4gICAqL1xuICBhc3luYyBfZW5zdXJlTWlncmF0aW9uc1RhYmxlKGRiKSB7XG4gICAgaWYgKGF3YWl0IGRiLnRhYmxlRXhpc3RzKE1JR1JBVElPTlNfVEFCTEUpKSByZXR1cm5cblxuICAgIGNvbnN0IHRhYmxlID0gbmV3IFRhYmxlRGF0YShNSUdSQVRJT05TX1RBQkxFLCB7aWZOb3RFeGlzdHM6IHRydWV9KVxuXG4gICAgdGFibGUuc3RyaW5nKFwia2V5XCIsIHtudWxsOiBmYWxzZSwgcHJpbWFyeUtleTogdHJ1ZX0pXG4gICAgdGFibGUuc3RyaW5nKFwic2NvcGVcIiwge251bGw6IGZhbHNlfSlcbiAgICB0YWJsZS5zdHJpbmcoXCJ2ZXJzaW9uXCIsIHtudWxsOiBmYWxzZX0pXG4gICAgdGFibGUuYmlnaW50KFwiYXBwbGllZF9hdF9tc1wiLCB7bnVsbDogZmFsc2V9KVxuXG4gICAgYXdhaXQgZGIuY3JlYXRlVGFibGUodGFibGUpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBoYXMgbWlncmF0aW9uLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL2RhdGFiYXNlL2RyaXZlcnMvYmFzZS5qc1wiKS5kZWZhdWx0fSBkYiAtIERhdGFiYXNlIGNvbm5lY3Rpb24uXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBbdmVyc2lvbl0gLSBNaWdyYXRpb24gdmVyc2lvbi5cbiAgICogQHJldHVybnMge1Byb21pc2U8Ym9vbGVhbj59IC0gV2hldGhlciBtaWdyYXRpb24gZXhpc3RzLlxuICAgKi9cbiAgYXN5bmMgX2hhc01pZ3JhdGlvbihkYiwgdmVyc2lvbiA9IE1JR1JBVElPTl9WRVJTSU9OKSB7XG4gICAgY29uc3QgcXVlcnkgPSBkYlxuICAgICAgLm5ld1F1ZXJ5KClcbiAgICAgIC5mcm9tKE1JR1JBVElPTlNfVEFCTEUpXG4gICAgICAud2hlcmUoe2tleTogdGhpcy5fbWlncmF0aW9uS2V5KHZlcnNpb24pfSlcbiAgICAgIC5saW1pdCgxKVxuXG4gICAgY29uc3Qgcm93cyA9IGF3YWl0IHF1ZXJ5LnJlc3VsdHMoKVxuXG4gICAgcmV0dXJuIHJvd3MubGVuZ3RoID4gMFxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgYXBwbHkgbWlncmF0aW9ucy5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9kYXRhYmFzZS9kcml2ZXJzL2Jhc2UuanNcIikuZGVmYXVsdH0gZGIgLSBEYXRhYmFzZSBjb25uZWN0aW9uLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyB3aGVuIGNvbXBsZXRlLlxuICAgKi9cbiAgYXN5bmMgX2FwcGx5TWlncmF0aW9ucyhkYikge1xuICAgIHRoaXMubG9nZ2VyLmluZm8oXCJBcHBseWluZyBiYWNrZ3JvdW5kIGpvYnMgc2NoZW1hXCIpXG5cbiAgICBpZiAoYXdhaXQgZGIudGFibGVFeGlzdHMoSk9CU19UQUJMRSkpIHtcbiAgICAgIHRoaXMubG9nZ2VyLmluZm8oXCJCYWNrZ3JvdW5kIGpvYnMgdGFibGUgYWxyZWFkeSBleGlzdHMgLSBza2lwcGluZyBjcmVhdGVcIilcbiAgICAgIHJldHVyblxuICAgIH1cblxuICAgIGNvbnN0IHRhYmxlID0gbmV3IFRhYmxlRGF0YShKT0JTX1RBQkxFLCB7aWZOb3RFeGlzdHM6IHRydWV9KVxuXG4gICAgdGFibGUuc3RyaW5nKFwiaWRcIiwge3ByaW1hcnlLZXk6IHRydWV9KVxuICAgIHRhYmxlLnN0cmluZyhcImpvYl9uYW1lXCIsIHtudWxsOiBmYWxzZSwgaW5kZXg6IHRydWV9KVxuICAgIHRhYmxlLnRleHQoXCJhcmdzX2pzb25cIiwge251bGw6IGZhbHNlfSlcbiAgICB0YWJsZS5zdHJpbmcoXCJleGVjdXRpb25fbW9kZVwiLCB7bnVsbDogZmFsc2V9KVxuICAgIHRhYmxlLnN0cmluZyhcInF1ZXVlXCIsIHtudWxsOiB0cnVlLCBpbmRleDogdHJ1ZX0pXG4gICAgdGFibGUuaW50ZWdlcihcIm1heF9yZXRyaWVzXCIsIHtudWxsOiBmYWxzZX0pXG4gICAgdGFibGUuaW50ZWdlcihcImF0dGVtcHRzXCIsIHtudWxsOiBmYWxzZX0pXG4gICAgdGFibGUuc3RyaW5nKFwic3RhdHVzXCIsIHtudWxsOiBmYWxzZSwgaW5kZXg6IHRydWV9KVxuICAgIHRhYmxlLmJpZ2ludChcInNjaGVkdWxlZF9hdF9tc1wiLCB7bnVsbDogZmFsc2UsIGluZGV4OiB0cnVlfSlcbiAgICB0YWJsZS5iaWdpbnQoXCJjcmVhdGVkX2F0X21zXCIsIHtudWxsOiBmYWxzZSwgaW5kZXg6IHRydWV9KVxuICAgIHRhYmxlLnN0cmluZyhcInNjaGVkdWxlX2tleVwiLCB7bnVsbDogdHJ1ZSwgaW5kZXg6IHRydWV9KVxuICAgIHRhYmxlLmJpZ2ludChcInNjaGVkdWxlX29yZGVyXCIsIHtudWxsOiB0cnVlfSlcbiAgICB0YWJsZS5iaWdpbnQoXCJoYW5kZWRfb2ZmX2F0X21zXCIsIHtudWxsOiB0cnVlLCBpbmRleDogdHJ1ZX0pXG4gICAgdGFibGUuc3RyaW5nKFwiaGFuZG9mZl9pZFwiLCB7bnVsbDogdHJ1ZX0pXG4gICAgdGFibGUuYmlnaW50KFwiY29tcGxldGVkX2F0X21zXCIsIHtudWxsOiB0cnVlfSlcbiAgICB0YWJsZS5iaWdpbnQoXCJmYWlsZWRfYXRfbXNcIiwge251bGw6IHRydWV9KVxuICAgIHRhYmxlLmJpZ2ludChcIm9ycGhhbmVkX2F0X21zXCIsIHtudWxsOiB0cnVlLCBpbmRleDogdHJ1ZX0pXG4gICAgdGFibGUuc3RyaW5nKFwid29ya2VyX2lkXCIsIHtudWxsOiB0cnVlfSlcbiAgICB0YWJsZS50ZXh0KFwibGFzdF9lcnJvclwiLCB7bnVsbDogdHJ1ZX0pXG4gICAgdGFibGUuc3RyaW5nKFwiY29uY3VycmVuY3lfa2V5XCIsIHtudWxsOiB0cnVlLCBpbmRleDogdHJ1ZX0pXG4gICAgdGFibGUuaW50ZWdlcihcIm1heF9jb25jdXJyZW5jeVwiLCB7bnVsbDogdHJ1ZX0pXG4gICAgdGFibGUuYmlnaW50KFwidGltZW91dF9tc1wiLCB7bnVsbDogdHJ1ZX0pXG4gICAgdGFibGUuYmlnaW50KFwiY2hpbGRfcmVjZWl2ZWRfYXRfbXNcIiwge251bGw6IHRydWV9KVxuICAgIHRhYmxlLmJpZ2ludChcImNoaWxkX3N0YXJ0ZWRfYXRfbXNcIiwge251bGw6IHRydWV9KVxuICAgIHRhYmxlLnN0cmluZyhcImNoaWxkX2luc3RhbmNlX2lkXCIsIHtudWxsOiB0cnVlfSlcbiAgICB0YWJsZS5pbnRlZ2VyKFwiY2hpbGRfcGlkXCIsIHtudWxsOiB0cnVlfSlcbiAgICB0YWJsZS5zdHJpbmcoXCJydW5uZXJfaG9zdG5hbWVcIiwge251bGw6IHRydWV9KVxuXG4gICAgYXdhaXQgZGIuY3JlYXRlVGFibGUodGFibGUpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBlbnN1cmUgam9icyB0YWJsZSBjb2x1bW5zLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL2RhdGFiYXNlL2RyaXZlcnMvYmFzZS5qc1wiKS5kZWZhdWx0fSBkYiAtIERhdGFiYXNlIGNvbm5lY3Rpb24uXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIHdoZW4gY29tcGxldGUuXG4gICAqL1xuICBhc3luYyBfZW5zdXJlSm9ic1RhYmxlQ29sdW1ucyhkYikge1xuICAgIGlmICghKGF3YWl0IGRiLnRhYmxlRXhpc3RzKEpPQlNfVEFCTEUpKSkgcmV0dXJuXG5cbiAgICBjb25zdCB0YWJsZSA9IGF3YWl0IGRiLmdldFRhYmxlQnlOYW1lT3JGYWlsKEpPQlNfVEFCTEUpXG4gICAgY29uc3QgZXhlY3V0aW9uTW9kZUNvbHVtbiA9IGF3YWl0IHRhYmxlLmdldENvbHVtbkJ5TmFtZShcImV4ZWN1dGlvbl9tb2RlXCIpXG5cbiAgICBpZiAoIWV4ZWN1dGlvbk1vZGVDb2x1bW4pIHtcbiAgICAgIGNvbnN0IHRhYmxlRGF0YSA9IG5ldyBUYWJsZURhdGEoSk9CU19UQUJMRSlcbiAgICAgIHRhYmxlRGF0YS5zdHJpbmcoXCJleGVjdXRpb25fbW9kZVwiLCB7bnVsbDogdHJ1ZX0pXG4gICAgICBjb25zdCBzcWxzID0gYXdhaXQgZGIuYWx0ZXJUYWJsZVNRTHModGFibGVEYXRhKVxuXG4gICAgICBmb3IgKGNvbnN0IHNxbCBvZiBzcWxzKSB7XG4gICAgICAgIGF3YWl0IGRiLnF1ZXJ5KHNxbClcbiAgICAgIH1cblxuICAgICAgZGIuY2xlYXJTY2hlbWFDYWNoZSgpXG4gICAgfVxuXG4gICAgY29uc3QgcmVmcmVzaGVkVGFibGUgPSBhd2FpdCBkYi5nZXRUYWJsZUJ5TmFtZU9yRmFpbChKT0JTX1RBQkxFKVxuICAgIGNvbnN0IGhhbmRvZmZJZENvbHVtbiA9IGF3YWl0IHJlZnJlc2hlZFRhYmxlLmdldENvbHVtbkJ5TmFtZShcImhhbmRvZmZfaWRcIilcblxuICAgIGlmICghaGFuZG9mZklkQ29sdW1uKSB7XG4gICAgICBjb25zdCBsb2NrTmFtZSA9IGAke01JR1JBVElPTl9TQ09QRX06aGFuZG9mZl9pZF9jb2x1bW5gXG4gICAgICBjb25zdCBhY3F1aXJlZCA9IGF3YWl0IGRiLmFjcXVpcmVBZHZpc29yeUxvY2sobG9ja05hbWUpXG5cbiAgICAgIGlmICghYWNxdWlyZWQpIHRocm93IG5ldyBFcnJvcihcIkZhaWxlZCB0byBhY3F1aXJlIGJhY2tncm91bmQgam9icyBoYW5kb2ZmIHNjaGVtYSBsb2NrXCIpXG5cbiAgICAgIHRyeSB7XG4gICAgICAgIGRiLmNsZWFyU2NoZW1hQ2FjaGUoKVxuICAgICAgICBjb25zdCBsb2NrZWRUYWJsZSA9IGF3YWl0IGRiLmdldFRhYmxlQnlOYW1lT3JGYWlsKEpPQlNfVEFCTEUpXG5cbiAgICAgICAgaWYgKCEoYXdhaXQgbG9ja2VkVGFibGUuZ2V0Q29sdW1uQnlOYW1lKFwiaGFuZG9mZl9pZFwiKSkpIHtcbiAgICAgICAgICBjb25zdCB0YWJsZURhdGEgPSBuZXcgVGFibGVEYXRhKEpPQlNfVEFCTEUpXG4gICAgICAgICAgdGFibGVEYXRhLnN0cmluZyhcImhhbmRvZmZfaWRcIiwge251bGw6IHRydWV9KVxuICAgICAgICAgIGNvbnN0IHNxbHMgPSBhd2FpdCBkYi5hbHRlclRhYmxlU1FMcyh0YWJsZURhdGEpXG5cbiAgICAgICAgICBmb3IgKGNvbnN0IHNxbCBvZiBzcWxzKSB7XG4gICAgICAgICAgICBhd2FpdCBkYi5xdWVyeShzcWwpXG4gICAgICAgICAgfVxuXG4gICAgICAgICAgZGIuY2xlYXJTY2hlbWFDYWNoZSgpXG4gICAgICAgIH1cbiAgICAgIH0gZmluYWxseSB7XG4gICAgICAgIGF3YWl0IGRiLnJlbGVhc2VBZHZpc29yeUxvY2sobG9ja05hbWUpXG4gICAgICB9XG4gICAgfVxuXG4gICAgY29uc3QgcHJpb3JpdHlMb2NrTmFtZSA9IGAke01JR1JBVElPTl9TQ09QRX06cHJpb3JpdHlfY29sdW1uYFxuICAgIGNvbnN0IHByaW9yaXR5TG9ja0FjcXVpcmVkID0gYXdhaXQgZGIuYWNxdWlyZUFkdmlzb3J5TG9jayhwcmlvcml0eUxvY2tOYW1lKVxuXG4gICAgaWYgKCFwcmlvcml0eUxvY2tBY3F1aXJlZCkgdGhyb3cgbmV3IEVycm9yKFwiRmFpbGVkIHRvIGFjcXVpcmUgYmFja2dyb3VuZCBqb2JzIHByaW9yaXR5IHNjaGVtYSBsb2NrXCIpXG5cbiAgICB0cnkge1xuICAgICAgZGIuY2xlYXJTY2hlbWFDYWNoZSgpXG4gICAgICBjb25zdCBwcmlvcml0eVRhYmxlID0gYXdhaXQgZGIuZ2V0VGFibGVCeU5hbWVPckZhaWwoSk9CU19UQUJMRSlcblxuICAgICAgaWYgKCEoYXdhaXQgcHJpb3JpdHlUYWJsZS5nZXRDb2x1bW5CeU5hbWUoXCJwcmlvcml0eVwiKSkpIHtcbiAgICAgICAgY29uc3QgdGFibGVEYXRhID0gbmV3IFRhYmxlRGF0YShKT0JTX1RBQkxFKVxuICAgICAgICB0YWJsZURhdGEuYmlnaW50KFwicHJpb3JpdHlcIiwge251bGw6IHRydWV9KVxuICAgICAgICBjb25zdCBzcWxzID0gYXdhaXQgZGIuYWx0ZXJUYWJsZVNRTHModGFibGVEYXRhKVxuXG4gICAgICAgIGZvciAoY29uc3Qgc3FsIG9mIHNxbHMpIHtcbiAgICAgICAgICBhd2FpdCBkYi5xdWVyeShzcWwpXG4gICAgICAgIH1cblxuICAgICAgICBkYi5jbGVhclNjaGVtYUNhY2hlKClcbiAgICAgIH1cbiAgICB9IGZpbmFsbHkge1xuICAgICAgYXdhaXQgZGIucmVsZWFzZUFkdmlzb3J5TG9jayhwcmlvcml0eUxvY2tOYW1lKVxuICAgIH1cblxuICAgIGF3YWl0IHRoaXMuX2JhY2tmaWxsRXhlY3V0aW9uTW9kZXNPbmNlKGRiKVxuICAgIGF3YWl0IHRoaXMuX2Ryb3BGb3JrZWRDb2x1bW5PbmNlKGRiKVxuXG4gICAgY29uc3QgbG9ja05hbWUgPSBgJHtNSUdSQVRJT05fU0NPUEV9OmNvbmN1cnJlbmN5X2NvbHVtbnNgXG4gICAgY29uc3QgYWNxdWlyZWQgPSBhd2FpdCBkYi5hY3F1aXJlQWR2aXNvcnlMb2NrKGxvY2tOYW1lKVxuXG4gICAgaWYgKCFhY3F1aXJlZCkgdGhyb3cgbmV3IEVycm9yKFwiRmFpbGVkIHRvIGFjcXVpcmUgYmFja2dyb3VuZCBqb2JzIGNvbmN1cnJlbmN5IHNjaGVtYSBsb2NrXCIpXG5cbiAgICB0cnkge1xuICAgICAgLy8gU1FMIFNlcnZlciBzY2hlbWEgcmVhZHMgY2FuIGRlYWRsb2NrIHdpdGggYSBjb25jdXJyZW50IEFMVEVSIFRBQkxFLCBzb1xuICAgICAgLy8gYWNxdWlyZSB0aGUgbG9jayBiZWZvcmUgaW5zcGVjdGluZyBlaXRoZXIgY29sdW1uIHJhdGhlciB0aGFuIG9ubHlcbiAgICAgIC8vIHByb3RlY3RpbmcgdGhlIG11dGF0aW9uLlxuICAgICAgZGIuY2xlYXJTY2hlbWFDYWNoZSgpXG4gICAgICBjb25zdCBsb2NrZWRUYWJsZSA9IGF3YWl0IGRiLmdldFRhYmxlQnlOYW1lT3JGYWlsKEpPQlNfVEFCTEUpXG4gICAgICBjb25zdCBjb25jdXJyZW5jeUNvbHVtbk5hbWVzID0gW1wiY29uY3VycmVuY3lfa2V5XCIsIFwibWF4X2NvbmN1cnJlbmN5XCJdXG5cbiAgICAgIGZvciAoY29uc3QgY29uY3VycmVuY3lDb2x1bW5OYW1lIG9mIGNvbmN1cnJlbmN5Q29sdW1uTmFtZXMpIHtcbiAgICAgICAgaWYgKGF3YWl0IGxvY2tlZFRhYmxlLmdldENvbHVtbkJ5TmFtZShjb25jdXJyZW5jeUNvbHVtbk5hbWUpKSBjb250aW51ZVxuXG4gICAgICAgIGNvbnN0IHRhYmxlRGF0YSA9IG5ldyBUYWJsZURhdGEoSk9CU19UQUJMRSlcbiAgICAgICAgaWYgKGNvbmN1cnJlbmN5Q29sdW1uTmFtZSA9PSBcImNvbmN1cnJlbmN5X2tleVwiKSB7XG4gICAgICAgICAgdGFibGVEYXRhLnN0cmluZyhcImNvbmN1cnJlbmN5X2tleVwiLCB7bnVsbDogdHJ1ZSwgaW5kZXg6IHRydWV9KVxuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgIHRhYmxlRGF0YS5pbnRlZ2VyKFwibWF4X2NvbmN1cnJlbmN5XCIsIHtudWxsOiB0cnVlfSlcbiAgICAgICAgfVxuXG4gICAgICAgIGZvciAoY29uc3Qgc3FsIG9mIGF3YWl0IGRiLmFsdGVyVGFibGVTUUxzKHRhYmxlRGF0YSkpIGF3YWl0IGRiLnF1ZXJ5KHNxbClcbiAgICAgIH1cblxuICAgICAgZGIuY2xlYXJTY2hlbWFDYWNoZSgpXG4gICAgfSBmaW5hbGx5IHtcbiAgICAgIGF3YWl0IGRiLnJlbGVhc2VBZHZpc29yeUxvY2sobG9ja05hbWUpXG4gICAgfVxuXG4gICAgYXdhaXQgdGhpcy5fZW5zdXJlUXVldWVDb2x1bW4oZGIpXG4gICAgYXdhaXQgdGhpcy5fZW5zdXJlU2NoZWR1bGVLZXlDb2x1bW4oZGIpXG4gICAgYXdhaXQgdGhpcy5fZW5zdXJlU2NoZWR1bGVPcmRlckNvbHVtbihkYilcbiAgICBhd2FpdCB0aGlzLl9lbnN1cmVTY2hlZHVsZU9yZGVyV2F0ZXJtYXJrc1RhYmxlKGRiKVxuICAgIGF3YWl0IHRoaXMuX2Vuc3VyZUpvYlRpbWVvdXRDb2x1bW4oZGIpXG4gICAgYXdhaXQgdGhpcy5fZW5zdXJlQ2hpbGRBY2NlcHRhbmNlQ29sdW1ucyhkYilcbiAgICBhd2FpdCB0aGlzLl9lbnN1cmVKb2JzVGFibGVJbmRleGVzT25jZShkYilcbiAgICBhd2FpdCB0aGlzLl9lbnN1cmVSZXRlbnRpb25JbmRleGVzT25jZShkYilcbiAgfVxuXG4gIC8qKlxuICAgKiBJZGVtcG90ZW50bHkgYWRkcyB0aGUgcG9vbGVkLWNoaWxkIGFjY2VwdGFuY2UgZXZpZGVuY2UgY29sdW1ucyB0byBleGlzdGluZ1xuICAgKiBqb2IgdGFibGVzLiBUaGV5IHJlY29yZCB3aGVuIHRoZSBleGVjdXRpbmcgcnVubmVyIGNoaWxkIHJlY2VpdmVkIGFuZFxuICAgKiBzdGFydGVkIGEgam9iIHBsdXMgdGhhdCBjaGlsZCdzIGlkZW50aXR5LCBzbyBhIGhhbmRlZC1vZmYgam9iIGNhbiBiZSB0b2xkXG4gICAqIGFwYXJ0IGZyb20gb25lIHdob3NlIHJ1bm5lciBuZXZlciBwaWNrZWQgaXQgdXAuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vZGF0YWJhc2UvZHJpdmVycy9iYXNlLmpzXCIpLmRlZmF1bHR9IGRiIC0gRGF0YWJhc2UgY29ubmVjdGlvbi5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgd2hlbiBlbnN1cmVkLlxuICAgKi9cbiAgYXN5bmMgX2Vuc3VyZUNoaWxkQWNjZXB0YW5jZUNvbHVtbnMoZGIpIHtcbiAgICBjb25zdCBsb2NrTmFtZSA9IGAke01JR1JBVElPTl9TQ09QRX06Y2hpbGRfYWNjZXB0YW5jZV9jb2x1bW5zYFxuICAgIGNvbnN0IGFjcXVpcmVkID0gYXdhaXQgZGIuYWNxdWlyZUFkdmlzb3J5TG9jayhsb2NrTmFtZSlcblxuICAgIGlmICghYWNxdWlyZWQpIHRocm93IG5ldyBFcnJvcihcIkZhaWxlZCB0byBhY3F1aXJlIGJhY2tncm91bmQgam9icyBjaGlsZC1hY2NlcHRhbmNlIHNjaGVtYSBsb2NrXCIpXG5cbiAgICB0cnkge1xuICAgICAgZGIuY2xlYXJTY2hlbWFDYWNoZSgpXG4gICAgICBjb25zdCB0YWJsZSA9IGF3YWl0IGRiLmdldFRhYmxlQnlOYW1lT3JGYWlsKEpPQlNfVEFCTEUpXG4gICAgICBjb25zdCB0YWJsZURhdGEgPSBuZXcgVGFibGVEYXRhKEpPQlNfVEFCTEUpXG4gICAgICBsZXQgYWRkZWQgPSBmYWxzZVxuXG4gICAgICBpZiAoIShhd2FpdCB0YWJsZS5nZXRDb2x1bW5CeU5hbWUoXCJjaGlsZF9yZWNlaXZlZF9hdF9tc1wiKSkpIHtcbiAgICAgICAgdGFibGVEYXRhLmJpZ2ludChcImNoaWxkX3JlY2VpdmVkX2F0X21zXCIsIHtudWxsOiB0cnVlfSlcbiAgICAgICAgYWRkZWQgPSB0cnVlXG4gICAgICB9XG4gICAgICBpZiAoIShhd2FpdCB0YWJsZS5nZXRDb2x1bW5CeU5hbWUoXCJjaGlsZF9zdGFydGVkX2F0X21zXCIpKSkge1xuICAgICAgICB0YWJsZURhdGEuYmlnaW50KFwiY2hpbGRfc3RhcnRlZF9hdF9tc1wiLCB7bnVsbDogdHJ1ZX0pXG4gICAgICAgIGFkZGVkID0gdHJ1ZVxuICAgICAgfVxuICAgICAgaWYgKCEoYXdhaXQgdGFibGUuZ2V0Q29sdW1uQnlOYW1lKFwiY2hpbGRfaW5zdGFuY2VfaWRcIikpKSB7XG4gICAgICAgIHRhYmxlRGF0YS5zdHJpbmcoXCJjaGlsZF9pbnN0YW5jZV9pZFwiLCB7bnVsbDogdHJ1ZX0pXG4gICAgICAgIGFkZGVkID0gdHJ1ZVxuICAgICAgfVxuICAgICAgaWYgKCEoYXdhaXQgdGFibGUuZ2V0Q29sdW1uQnlOYW1lKFwiY2hpbGRfcGlkXCIpKSkge1xuICAgICAgICB0YWJsZURhdGEuaW50ZWdlcihcImNoaWxkX3BpZFwiLCB7bnVsbDogdHJ1ZX0pXG4gICAgICAgIGFkZGVkID0gdHJ1ZVxuICAgICAgfVxuICAgICAgaWYgKCEoYXdhaXQgdGFibGUuZ2V0Q29sdW1uQnlOYW1lKFwicnVubmVyX2hvc3RuYW1lXCIpKSkge1xuICAgICAgICB0YWJsZURhdGEuc3RyaW5nKFwicnVubmVyX2hvc3RuYW1lXCIsIHtudWxsOiB0cnVlfSlcbiAgICAgICAgYWRkZWQgPSB0cnVlXG4gICAgICB9XG5cbiAgICAgIGlmIChhZGRlZCkge1xuICAgICAgICBmb3IgKGNvbnN0IHNxbCBvZiBhd2FpdCBkYi5hbHRlclRhYmxlU1FMcyh0YWJsZURhdGEpKSBhd2FpdCBkYi5xdWVyeShzcWwpXG4gICAgICAgIGRiLmNsZWFyU2NoZW1hQ2FjaGUoKVxuICAgICAgfVxuICAgIH0gZmluYWxseSB7XG4gICAgICBhd2FpdCBkYi5yZWxlYXNlQWR2aXNvcnlMb2NrKGxvY2tOYW1lKVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBSZXBhaXJzIHNlY29uZGFyeSBpbmRleGVzIHRoYXQgb2xkZXIgYWRkLWNvbHVtbiB1cGdyYWRlcyBkZWNsYXJlZCBidXQgZGlkXG4gICAqIG5vdCBjcmVhdGUgb24gZXZlcnkgU1FMIGRyaXZlci4gVGhlIG1pZ3JhdGlvbiBsZWRnZXIga2VlcHMgcm91dGluZSBzdG9yZVxuICAgKiByZWFkaW5lc3MgZnJvbSByZXBlYXRlZGx5IGludHJvc3BlY3RpbmcgdGhlIGZ1bGwgaW5kZXggc2V0LlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL2RhdGFiYXNlL2RyaXZlcnMvYmFzZS5qc1wiKS5kZWZhdWx0fSBkYiAtIERhdGFiYXNlIGNvbm5lY3Rpb24uXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIHdoZW4gYWxsIGV4cGVjdGVkIGluZGV4ZXMgZXhpc3QuXG4gICAqL1xuICBhc3luYyBfZW5zdXJlSm9ic1RhYmxlSW5kZXhlc09uY2UoZGIpIHtcbiAgICBjb25zdCBtaWdyYXRpb25WZXJzaW9uID0gSk9CU19JTkRFWF9SRVBBSVJfTUlHUkFUSU9OX1ZFUlNJT05cbiAgICBjb25zdCBtaWdyYXRpb25LZXkgPSB0aGlzLl9taWdyYXRpb25LZXkobWlncmF0aW9uVmVyc2lvbilcblxuICAgIGlmIChhd2FpdCB0aGlzLl9oYXNNaWdyYXRpb24oZGIsIG1pZ3JhdGlvblZlcnNpb24pKSByZXR1cm5cblxuICAgIGNvbnN0IGFjcXVpcmVkID0gYXdhaXQgZGIuYWNxdWlyZUFkdmlzb3J5TG9jayhtaWdyYXRpb25LZXkpXG5cbiAgICBpZiAoIWFjcXVpcmVkKSB0aHJvdyBuZXcgRXJyb3IoXCJGYWlsZWQgdG8gYWNxdWlyZSBiYWNrZ3JvdW5kIGpvYnMgaW5kZXggcmVwYWlyIGxvY2tcIilcblxuICAgIHRyeSB7XG4gICAgICBpZiAoYXdhaXQgdGhpcy5faGFzTWlncmF0aW9uKGRiLCBtaWdyYXRpb25WZXJzaW9uKSkgcmV0dXJuXG5cbiAgICAgIGRiLmNsZWFyU2NoZW1hQ2FjaGUoKVxuICAgICAgY29uc3QgdGFibGUgPSBhd2FpdCBkYi5nZXRUYWJsZUJ5TmFtZU9yRmFpbChKT0JTX1RBQkxFKVxuICAgICAgY29uc3QgaW5kZXhlZENvbHVtbk5hbWVzID0gbmV3IFNldChcbiAgICAgICAgKGF3YWl0IHRhYmxlLmdldEluZGV4ZXMoKSlcbiAgICAgICAgICAuZmlsdGVyKChpbmRleCkgPT4gIWluZGV4LmlzUHJpbWFyeUtleSgpICYmIGluZGV4LmdldENvbHVtbk5hbWVzKCkubGVuZ3RoID09PSAxKVxuICAgICAgICAgIC5tYXAoKGluZGV4KSA9PiBpbmRleC5nZXRDb2x1bW5OYW1lcygpWzBdKVxuICAgICAgKVxuXG4gICAgICBmb3IgKGNvbnN0IGNvbHVtbk5hbWUgb2YgSk9CU19JTkRFWF9DT0xVTU5fTkFNRVMpIHtcbiAgICAgICAgaWYgKGluZGV4ZWRDb2x1bW5OYW1lcy5oYXMoY29sdW1uTmFtZSkpIGNvbnRpbnVlXG5cbiAgICAgICAgZm9yIChjb25zdCBzcWwgb2YgYXdhaXQgZGIuY3JlYXRlSW5kZXhTUUxzKHtjb2x1bW5zOiBbY29sdW1uTmFtZV0sIGlmTm90RXhpc3RzOiBkYi5nZXRUeXBlKCkgPT09IFwic3FsaXRlXCIsIHRhYmxlTmFtZTogSk9CU19UQUJMRX0pKSB7XG4gICAgICAgICAgYXdhaXQgZGIucXVlcnkoc3FsKVxuICAgICAgICB9XG4gICAgICB9XG5cbiAgICAgIGRiLmNsZWFyU2NoZW1hQ2FjaGUoKVxuICAgICAgYXdhaXQgdGhpcy5fcmVjb3JkTWlncmF0aW9uKGRiLCBtaWdyYXRpb25WZXJzaW9uKVxuICAgIH0gZmluYWxseSB7XG4gICAgICBhd2FpdCBkYi5yZWxlYXNlQWR2aXNvcnlMb2NrKG1pZ3JhdGlvbktleSlcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogSWRlbXBvdGVudGx5IGNyZWF0ZXMgdGhlIG9yZGVyZWQgY29tcG9zaXRlIHJldGVudGlvbiBpbmRleGVzLiBBbiBpbmRleFxuICAgKiB3aXRoIHRoZSBleHBlY3RlZCBuYW1lIGJ1dCBhIGRpZmZlcmVudCBjb2x1bW4gb3JkZXIgaXMgYSBtYW51YWwtcmVwYWlyXG4gICAqIHNpdHVhdGlvbiBhbmQgZmFpbHMgcmVhZGluZXNzIGxvdWRseSBpbnN0ZWFkIG9mIGJlaW5nIHJlYnVpbHQgb3JcbiAgICogcmUtcmVjb3JkZWQ7IHRoZSBtaWdyYXRpb24gbGVkZ2VyIGlzIHdyaXR0ZW4gb25seSBvbmNlIGV2ZXJ5IGV4cGVjdGVkXG4gICAqIGluZGV4IGV4aXN0cyB3aXRoIGl0cyBleGFjdCBvcmRlcmVkIGNvbHVtbnMuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vZGF0YWJhc2UvZHJpdmVycy9iYXNlLmpzXCIpLmRlZmF1bHR9IGRiIC0gRGF0YWJhc2UgY29ubmVjdGlvbi5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgd2hlbiBhbGwgcmV0ZW50aW9uIGluZGV4ZXMgZXhpc3QuXG4gICAqL1xuICBhc3luYyBfZW5zdXJlUmV0ZW50aW9uSW5kZXhlc09uY2UoZGIpIHtcbiAgICBjb25zdCBtaWdyYXRpb25WZXJzaW9uID0gUkVURU5USU9OX0lOREVYX01JR1JBVElPTl9WRVJTSU9OXG4gICAgY29uc3QgbWlncmF0aW9uS2V5ID0gdGhpcy5fbWlncmF0aW9uS2V5KG1pZ3JhdGlvblZlcnNpb24pXG5cbiAgICBpZiAoYXdhaXQgdGhpcy5faGFzTWlncmF0aW9uKGRiLCBtaWdyYXRpb25WZXJzaW9uKSkgcmV0dXJuXG5cbiAgICBjb25zdCBhY3F1aXJlZCA9IGF3YWl0IGRiLmFjcXVpcmVBZHZpc29yeUxvY2sobWlncmF0aW9uS2V5KVxuXG4gICAgaWYgKCFhY3F1aXJlZCkgdGhyb3cgbmV3IEVycm9yKFwiRmFpbGVkIHRvIGFjcXVpcmUgYmFja2dyb3VuZCBqb2JzIHJldGVudGlvbiBpbmRleCBsb2NrXCIpXG5cbiAgICB0cnkge1xuICAgICAgaWYgKGF3YWl0IHRoaXMuX2hhc01pZ3JhdGlvbihkYiwgbWlncmF0aW9uVmVyc2lvbikpIHJldHVyblxuXG4gICAgICBkYi5jbGVhclNjaGVtYUNhY2hlKClcbiAgICAgIGNvbnN0IHRhYmxlID0gYXdhaXQgZGIuZ2V0VGFibGVCeU5hbWVPckZhaWwoSk9CU19UQUJMRSlcbiAgICAgIGNvbnN0IGV4aXN0aW5nSW5kZXhDb2x1bW5zID0gbmV3IE1hcChcbiAgICAgICAgKGF3YWl0IHRhYmxlLmdldEluZGV4ZXMoKSkubWFwKChpbmRleCkgPT4gW2luZGV4LmdldE5hbWUoKSwgaW5kZXguZ2V0Q29sdW1uTmFtZXMoKV0pXG4gICAgICApXG5cbiAgICAgIGZvciAoY29uc3Qge2NvbHVtbnMsIG5hbWV9IG9mIFJFVEVOVElPTl9JTkRFWF9ERUZJTklUSU9OUykge1xuICAgICAgICBjb25zdCBleGlzdGluZ0NvbHVtbnMgPSBleGlzdGluZ0luZGV4Q29sdW1ucy5nZXQobmFtZSlcblxuICAgICAgICBpZiAoZXhpc3RpbmdDb2x1bW5zKSB7XG4gICAgICAgICAgaWYgKGV4aXN0aW5nQ29sdW1ucy5qb2luKFwiLFwiKSA9PT0gY29sdW1ucy5qb2luKFwiLFwiKSkgY29udGludWVcbiAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoYEJhY2tncm91bmQgam9icyByZXRlbnRpb24gaW5kZXggJHtuYW1lfSBleGlzdHMgd2l0aCB1bmV4cGVjdGVkIGNvbHVtbnM6ICR7ZXhpc3RpbmdDb2x1bW5zLmpvaW4oXCIsXCIpfWApXG4gICAgICAgIH1cblxuICAgICAgICBmb3IgKGNvbnN0IHNxbCBvZiBhd2FpdCBkYi5jcmVhdGVJbmRleFNRTHMoe2NvbHVtbnMsIGlmTm90RXhpc3RzOiBkYi5nZXRUeXBlKCkgPT09IFwic3FsaXRlXCIsIG5hbWUsIHRhYmxlTmFtZTogSk9CU19UQUJMRX0pKSB7XG4gICAgICAgICAgYXdhaXQgZGIucXVlcnkoc3FsKVxuICAgICAgICB9XG4gICAgICB9XG5cbiAgICAgIGRiLmNsZWFyU2NoZW1hQ2FjaGUoKVxuICAgICAgYXdhaXQgdGhpcy5fcmVjb3JkTWlncmF0aW9uKGRiLCBtaWdyYXRpb25WZXJzaW9uKVxuICAgIH0gZmluYWxseSB7XG4gICAgICBhd2FpdCBkYi5yZWxlYXNlQWR2aXNvcnlMb2NrKG1pZ3JhdGlvbktleSlcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogSWRlbXBvdGVudGx5IGFkZHMgdGhlIHBlci1qb2Igd2FsbC1jbG9jayB0aW1lb3V0IHRvIGV4aXN0aW5nIGpvYiB0YWJsZXMuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vZGF0YWJhc2UvZHJpdmVycy9iYXNlLmpzXCIpLmRlZmF1bHR9IGRiIC0gRGF0YWJhc2UgY29ubmVjdGlvbi5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgd2hlbiBlbnN1cmVkLlxuICAgKi9cbiAgYXN5bmMgX2Vuc3VyZUpvYlRpbWVvdXRDb2x1bW4oZGIpIHtcbiAgICBjb25zdCBsb2NrTmFtZSA9IGAke01JR1JBVElPTl9TQ09QRX06dGltZW91dF9tc19jb2x1bW5gXG4gICAgY29uc3QgYWNxdWlyZWQgPSBhd2FpdCBkYi5hY3F1aXJlQWR2aXNvcnlMb2NrKGxvY2tOYW1lKVxuXG4gICAgaWYgKCFhY3F1aXJlZCkgdGhyb3cgbmV3IEVycm9yKFwiRmFpbGVkIHRvIGFjcXVpcmUgYmFja2dyb3VuZCBqb2JzIHRpbWVvdXQgc2NoZW1hIGxvY2tcIilcblxuICAgIHRyeSB7XG4gICAgICBkYi5jbGVhclNjaGVtYUNhY2hlKClcbiAgICAgIGNvbnN0IHRhYmxlID0gYXdhaXQgZGIuZ2V0VGFibGVCeU5hbWVPckZhaWwoSk9CU19UQUJMRSlcblxuICAgICAgaWYgKCEoYXdhaXQgdGFibGUuZ2V0Q29sdW1uQnlOYW1lKFwidGltZW91dF9tc1wiKSkpIHtcbiAgICAgICAgY29uc3QgdGFibGVEYXRhID0gbmV3IFRhYmxlRGF0YShKT0JTX1RBQkxFKVxuICAgICAgICB0YWJsZURhdGEuYmlnaW50KFwidGltZW91dF9tc1wiLCB7bnVsbDogdHJ1ZX0pXG5cbiAgICAgICAgZm9yIChjb25zdCBzcWwgb2YgYXdhaXQgZGIuYWx0ZXJUYWJsZVNRTHModGFibGVEYXRhKSkgYXdhaXQgZGIucXVlcnkoc3FsKVxuXG4gICAgICAgIGRiLmNsZWFyU2NoZW1hQ2FjaGUoKVxuICAgICAgfVxuICAgIH0gZmluYWxseSB7XG4gICAgICBhd2FpdCBkYi5yZWxlYXNlQWR2aXNvcnlMb2NrKGxvY2tOYW1lKVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBJZGVtcG90ZW50bHkgYWRkcyB0aGUgaGlzdG9yaWNhbCBzdGFibGUgc2NoZWR1bGUga2V5IHRvIGV4aXN0aW5nIGpvYnMuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vZGF0YWJhc2UvZHJpdmVycy9iYXNlLmpzXCIpLmRlZmF1bHR9IGRiIC0gRGF0YWJhc2UgY29ubmVjdGlvbi5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgd2hlbiBlbnN1cmVkLlxuICAgKi9cbiAgYXN5bmMgX2Vuc3VyZVNjaGVkdWxlS2V5Q29sdW1uKGRiKSB7XG4gICAgY29uc3QgbG9ja05hbWUgPSBgJHtNSUdSQVRJT05fU0NPUEV9OnNjaGVkdWxlX2tleV9jb2x1bW5gXG4gICAgY29uc3QgYWNxdWlyZWQgPSBhd2FpdCBkYi5hY3F1aXJlQWR2aXNvcnlMb2NrKGxvY2tOYW1lKVxuXG4gICAgaWYgKCFhY3F1aXJlZCkgdGhyb3cgbmV3IEVycm9yKFwiRmFpbGVkIHRvIGFjcXVpcmUgYmFja2dyb3VuZCBqb2JzIHNjaGVkdWxlLWtleSBzY2hlbWEgbG9ja1wiKVxuXG4gICAgdHJ5IHtcbiAgICAgIGRiLmNsZWFyU2NoZW1hQ2FjaGUoKVxuICAgICAgY29uc3QgbG9ja2VkVGFibGUgPSBhd2FpdCBkYi5nZXRUYWJsZUJ5TmFtZU9yRmFpbChKT0JTX1RBQkxFKVxuXG4gICAgICBpZiAoIShhd2FpdCBsb2NrZWRUYWJsZS5nZXRDb2x1bW5CeU5hbWUoXCJzY2hlZHVsZV9rZXlcIikpKSB7XG4gICAgICAgIGNvbnN0IHRhYmxlRGF0YSA9IG5ldyBUYWJsZURhdGEoSk9CU19UQUJMRSlcblxuICAgICAgICB0YWJsZURhdGEuc3RyaW5nKFwic2NoZWR1bGVfa2V5XCIsIHtudWxsOiB0cnVlLCBpbmRleDogdHJ1ZX0pXG5cbiAgICAgICAgZm9yIChjb25zdCBzcWwgb2YgYXdhaXQgZGIuYWx0ZXJUYWJsZVNRTHModGFibGVEYXRhKSkgYXdhaXQgZGIucXVlcnkoc3FsKVxuXG4gICAgICAgIGRiLmNsZWFyU2NoZW1hQ2FjaGUoKVxuICAgICAgfVxuICAgIH0gZmluYWxseSB7XG4gICAgICBhd2FpdCBkYi5yZWxlYXNlQWR2aXNvcnlMb2NrKGxvY2tOYW1lKVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBJZGVtcG90ZW50bHkgYWRkcyBtb25vdG9uaWMgc2NoZWR1bGUgb3duZXJzaGlwIGhpc3RvcnkgYW5kIGl0cyBsb29rdXAgaW5kZXguXG4gICAqIEV4aXN0aW5nIHJvd3MgcmVtYWluIG51bGwgYW5kIHVzZSB0aGUgZG9jdW1lbnRlZCBsZWdhY3kgZmFsbGJhY2sgb3JkZXJpbmcuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vZGF0YWJhc2UvZHJpdmVycy9iYXNlLmpzXCIpLmRlZmF1bHR9IGRiIC0gRGF0YWJhc2UgY29ubmVjdGlvbi5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgd2hlbiBlbnN1cmVkLlxuICAgKi9cbiAgYXN5bmMgX2Vuc3VyZVNjaGVkdWxlT3JkZXJDb2x1bW4oZGIpIHtcbiAgICBjb25zdCBsb2NrTmFtZSA9IGAke01JR1JBVElPTl9TQ09QRX06c2NoZWR1bGVfb3JkZXJfY29sdW1uYFxuICAgIGNvbnN0IGFjcXVpcmVkID0gYXdhaXQgZGIuYWNxdWlyZUFkdmlzb3J5TG9jayhsb2NrTmFtZSlcblxuICAgIGlmICghYWNxdWlyZWQpIHRocm93IG5ldyBFcnJvcihcIkZhaWxlZCB0byBhY3F1aXJlIGJhY2tncm91bmQgam9icyBzY2hlZHVsZS1vcmRlciBzY2hlbWEgbG9ja1wiKVxuXG4gICAgdHJ5IHtcbiAgICAgIGRiLmNsZWFyU2NoZW1hQ2FjaGUoKVxuICAgICAgbGV0IHRhYmxlID0gYXdhaXQgZGIuZ2V0VGFibGVCeU5hbWVPckZhaWwoSk9CU19UQUJMRSlcblxuICAgICAgaWYgKCEoYXdhaXQgdGFibGUuZ2V0Q29sdW1uQnlOYW1lKFwic2NoZWR1bGVfb3JkZXJcIikpKSB7XG4gICAgICAgIGNvbnN0IHRhYmxlRGF0YSA9IG5ldyBUYWJsZURhdGEoSk9CU19UQUJMRSlcblxuICAgICAgICB0YWJsZURhdGEuYmlnaW50KFwic2NoZWR1bGVfb3JkZXJcIiwge251bGw6IHRydWV9KVxuICAgICAgICBmb3IgKGNvbnN0IHNxbCBvZiBhd2FpdCBkYi5hbHRlclRhYmxlU1FMcyh0YWJsZURhdGEpKSBhd2FpdCBkYi5xdWVyeShzcWwpXG4gICAgICAgIGRiLmNsZWFyU2NoZW1hQ2FjaGUoKVxuICAgICAgICB0YWJsZSA9IGF3YWl0IGRiLmdldFRhYmxlQnlOYW1lT3JGYWlsKEpPQlNfVEFCTEUpXG4gICAgICB9XG5cbiAgICAgIGNvbnN0IGluZGV4TmFtZXMgPSBuZXcgU2V0KChhd2FpdCB0YWJsZS5nZXRJbmRleGVzKCkpLm1hcCgoaW5kZXgpID0+IGluZGV4LmdldE5hbWUoKSkpXG5cbiAgICAgIGlmICghaW5kZXhOYW1lcy5oYXMoU0NIRURVTEVfSElTVE9SWV9PUkRFUl9JTkRFWCkpIHtcbiAgICAgICAgY29uc3Qgc3FscyA9IGF3YWl0IGRiLmNyZWF0ZUluZGV4U1FMcyh7XG4gICAgICAgICAgY29sdW1uczogW1wic2NoZWR1bGVfa2V5XCIsIFwic2NoZWR1bGVfb3JkZXJcIiwgXCJjcmVhdGVkX2F0X21zXCIsIFwiaWRcIl0sXG4gICAgICAgICAgaWZOb3RFeGlzdHM6IGRiLmdldFR5cGUoKSA9PT0gXCJzcWxpdGVcIixcbiAgICAgICAgICBuYW1lOiBTQ0hFRFVMRV9ISVNUT1JZX09SREVSX0lOREVYLFxuICAgICAgICAgIHRhYmxlTmFtZTogSk9CU19UQUJMRVxuICAgICAgICB9KVxuXG4gICAgICAgIGZvciAoY29uc3Qgc3FsIG9mIHNxbHMpIGF3YWl0IGRiLnF1ZXJ5KHNxbClcbiAgICAgICAgZGIuY2xlYXJTY2hlbWFDYWNoZSgpXG4gICAgICB9XG4gICAgfSBmaW5hbGx5IHtcbiAgICAgIGF3YWl0IGRiLnJlbGVhc2VBZHZpc29yeUxvY2sobG9ja05hbWUpXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIENyZWF0ZXMgdGhlIHJldGVudGlvbi1pbmRlcGVuZGVudCBzY2hlZHVsZS1vcmRlciBoaWdoLXdhdGVyIHRhYmxlIGFuZFxuICAgKiBpbml0aWFsaXplcyBpdCBmcm9tIHRoZSBncmVhdGVzdCByZXRhaW5lZCBvcmRlcmVkIHJvdyBmb3IgZXZlcnkga2V5LlxuICAgKiBMZWdhY3kgcm93cyB3aG9zZSBvcmRlciBpcyBudWxsIGRlbGliZXJhdGVseSBkbyBub3QgZXN0YWJsaXNoIGEgd2F0ZXJtYXJrLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL2RhdGFiYXNlL2RyaXZlcnMvYmFzZS5qc1wiKS5kZWZhdWx0fSBkYiAtIERhdGFiYXNlIGNvbm5lY3Rpb24uXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIHdoZW4gZW5zdXJlZCBhbmQgYmFja2ZpbGxlZC5cbiAgICovXG4gIGFzeW5jIF9lbnN1cmVTY2hlZHVsZU9yZGVyV2F0ZXJtYXJrc1RhYmxlKGRiKSB7XG4gICAgY29uc3QgbWlncmF0aW9uVmVyc2lvbiA9IFNDSEVEVUxFX09SREVSX1dBVEVSTUFSS19NSUdSQVRJT05fVkVSU0lPTlxuICAgIGNvbnN0IG1pZ3JhdGlvbktleSA9IHRoaXMuX21pZ3JhdGlvbktleShtaWdyYXRpb25WZXJzaW9uKVxuICAgIGNvbnN0IHRhYmxlRXhpc3RzID0gYXdhaXQgZGIudGFibGVFeGlzdHMoU0NIRURVTEVfT1JERVJfV0FURVJNQVJLU19UQUJMRSlcblxuICAgIGlmICh0YWJsZUV4aXN0cyAmJiBhd2FpdCB0aGlzLl9oYXNNaWdyYXRpb24oZGIsIG1pZ3JhdGlvblZlcnNpb24pKSByZXR1cm5cblxuICAgIGNvbnN0IGFjcXVpcmVkID0gYXdhaXQgZGIuYWNxdWlyZUFkdmlzb3J5TG9jayhtaWdyYXRpb25LZXkpXG5cbiAgICBpZiAoIWFjcXVpcmVkKSB0aHJvdyBuZXcgRXJyb3IoXCJGYWlsZWQgdG8gYWNxdWlyZSBiYWNrZ3JvdW5kIGpvYnMgc2NoZWR1bGUtb3JkZXIgd2F0ZXJtYXJrIHNjaGVtYSBsb2NrXCIpXG5cbiAgICB0cnkge1xuICAgICAgZGIuY2xlYXJTY2hlbWFDYWNoZSgpXG4gICAgICBjb25zdCBsb2NrZWRUYWJsZUV4aXN0cyA9IGF3YWl0IGRiLnRhYmxlRXhpc3RzKFNDSEVEVUxFX09SREVSX1dBVEVSTUFSS1NfVEFCTEUpXG4gICAgICBjb25zdCBhbHJlYWR5QXBwbGllZCA9IGF3YWl0IHRoaXMuX2hhc01pZ3JhdGlvbihkYiwgbWlncmF0aW9uVmVyc2lvbilcblxuICAgICAgaWYgKCFsb2NrZWRUYWJsZUV4aXN0cykge1xuICAgICAgICBjb25zdCB0YWJsZSA9IG5ldyBUYWJsZURhdGEoU0NIRURVTEVfT1JERVJfV0FURVJNQVJLU19UQUJMRSwge2lmTm90RXhpc3RzOiB0cnVlfSlcblxuICAgICAgICB0YWJsZS5zdHJpbmcoXCJzY2hlZHVsZV9rZXlcIiwge3ByaW1hcnlLZXk6IHRydWV9KVxuICAgICAgICB0YWJsZS5iaWdpbnQoXCJoaWdoX3dhdGVyX21hcmtcIiwge251bGw6IGZhbHNlfSlcbiAgICAgICAgYXdhaXQgZGIuY3JlYXRlVGFibGUodGFibGUpXG4gICAgICAgIGRiLmNsZWFyU2NoZW1hQ2FjaGUoKVxuICAgICAgfVxuXG4gICAgICAvLyBSZWJ1aWxkIGEgbWlzc2luZyB0YWJsZSBldmVuIHdoZW4gaXRzIG1pZ3JhdGlvbiBsZWRnZXIgc3Vydml2ZWQuIFRoZVxuICAgICAgLy8gcmV0YWluZWQgam9iIHJvd3MgYXJlIHRoZSBvbmx5IGNvbXBhdGlibGUgc291cmNlIGZvciB0aGF0IHJlY292ZXJ5O1xuICAgICAgLy8gb25jZSByb3dzIGFyZSBwcnVuZWQsIG5vcm1hbCBzY2hlbWEgZHVyYWJpbGl0eSBwcm90ZWN0cyB0aGUgd2F0ZXJtYXJrLlxuICAgICAgaWYgKCFsb2NrZWRUYWJsZUV4aXN0cyB8fCAhYWxyZWFkeUFwcGxpZWQpIGF3YWl0IHRoaXMuX2JhY2tmaWxsU2NoZWR1bGVPcmRlcldhdGVybWFya3MoZGIpXG4gICAgICBpZiAoIWFscmVhZHlBcHBsaWVkKSBhd2FpdCB0aGlzLl9yZWNvcmRNaWdyYXRpb24oZGIsIG1pZ3JhdGlvblZlcnNpb24pXG4gICAgfSBmaW5hbGx5IHtcbiAgICAgIGF3YWl0IGRiLnJlbGVhc2VBZHZpc29yeUxvY2sobWlncmF0aW9uS2V5KVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBCYWNrZmlsbHMgZWFjaCBrZXkgZnJvbSBpdHMgZ3JlYXRlc3QgcmV0YWluZWQgbm9uLWxlZ2FjeSBvd25lcnNoaXAgb3JkZXIuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vZGF0YWJhc2UvZHJpdmVycy9iYXNlLmpzXCIpLmRlZmF1bHR9IGRiIC0gRGF0YWJhc2UgY29ubmVjdGlvbi5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgYWZ0ZXIgYWxsIHJldGFpbmVkIGtleXMgYXJlIHJlcHJlc2VudGVkLlxuICAgKi9cbiAgYXN5bmMgX2JhY2tmaWxsU2NoZWR1bGVPcmRlcldhdGVybWFya3MoZGIpIHtcbiAgICBjb25zdCBrZXlSb3dzID0gYXdhaXQgZGJcbiAgICAgIC5uZXdRdWVyeSgpXG4gICAgICAuZnJvbShKT0JTX1RBQkxFKVxuICAgICAgLnNlbGVjdChcInNjaGVkdWxlX2tleVwiKVxuICAgICAgLndoZXJlTm90KHtzY2hlZHVsZV9rZXk6IG51bGx9KVxuICAgICAgLndoZXJlTm90KHtzY2hlZHVsZV9vcmRlcjogbnVsbH0pXG4gICAgICAuZGlzdGluY3QoKVxuICAgICAgLnJlc3VsdHMoKVxuXG4gICAgZm9yIChjb25zdCBrZXlSb3cgb2Yga2V5Um93cykge1xuICAgICAgY29uc3Qgc2NoZWR1bGVLZXkgPSBTdHJpbmcoLyoqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59ICovIChrZXlSb3cpLnNjaGVkdWxlX2tleSlcbiAgICAgIGNvbnN0IHJldGFpbmVkT3JkZXIgPSBhd2FpdCB0aGlzLl9ncmVhdGVzdFJldGFpbmVkU2NoZWR1bGVPcmRlcihkYiwgc2NoZWR1bGVLZXkpXG4gICAgICBjb25zdCBjdXJyZW50V2F0ZXJtYXJrID0gYXdhaXQgdGhpcy5fc2NoZWR1bGVPcmRlcldhdGVybWFyayhkYiwgc2NoZWR1bGVLZXkpXG5cbiAgICAgIGlmIChyZXRhaW5lZE9yZGVyID09PSBudWxsKSBjb250aW51ZVxuICAgICAgaWYgKGN1cnJlbnRXYXRlcm1hcmsgIT09IG51bGwgJiYgY3VycmVudFdhdGVybWFyayA+PSByZXRhaW5lZE9yZGVyKSBjb250aW51ZVxuICAgICAgYXdhaXQgdGhpcy5fd3JpdGVTY2hlZHVsZU9yZGVyV2F0ZXJtYXJrKGRiLCB7c2NoZWR1bGVLZXksIHNjaGVkdWxlT3JkZXI6IHJldGFpbmVkT3JkZXJ9KVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBJZGVtcG90ZW50bHkgYWRkcyB0aGUgYHF1ZXVlYCBjb2x1bW4gdG8gYW4gZXhpc3Rpbmcgam9icyB0YWJsZS4gRXhpc3RpbmdcbiAgICogcm93cyByZWFkIGJhY2sgYXMgdGhlIGRlZmF1bHQgcXVldWUgKHNlZSB7QGxpbmsgX25vcm1hbGl6ZUpvYlJvd30pLCBzbyBub1xuICAgKiBkYXRhIGJhY2tmaWxsIGlzIHJlcXVpcmVkLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL2RhdGFiYXNlL2RyaXZlcnMvYmFzZS5qc1wiKS5kZWZhdWx0fSBkYiAtIERhdGFiYXNlIGNvbm5lY3Rpb24uXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIHdoZW4gZW5zdXJlZC5cbiAgICovXG4gIGFzeW5jIF9lbnN1cmVRdWV1ZUNvbHVtbihkYikge1xuICAgIGNvbnN0IGxvY2tOYW1lID0gYCR7TUlHUkFUSU9OX1NDT1BFfTpxdWV1ZV9jb2x1bW5gXG4gICAgY29uc3QgYWNxdWlyZWQgPSBhd2FpdCBkYi5hY3F1aXJlQWR2aXNvcnlMb2NrKGxvY2tOYW1lKVxuXG4gICAgaWYgKCFhY3F1aXJlZCkgdGhyb3cgbmV3IEVycm9yKFwiRmFpbGVkIHRvIGFjcXVpcmUgYmFja2dyb3VuZCBqb2JzIHF1ZXVlIHNjaGVtYSBsb2NrXCIpXG5cbiAgICB0cnkge1xuICAgICAgLy8gU1FMIFNlcnZlciBzY2hlbWEgcmVhZHMgY2FuIGRlYWRsb2NrIHdpdGggYSBjb25jdXJyZW50IEFMVEVSIFRBQkxFLCBzb1xuICAgICAgLy8gYWNxdWlyZSB0aGUgbG9jayBiZWZvcmUgaW5zcGVjdGluZyB0aGUgY29sdW1uIHJhdGhlciB0aGFuIG9ubHlcbiAgICAgIC8vIHByb3RlY3RpbmcgdGhlIG11dGF0aW9uIChtaXJyb3JzIHRoZSBjb25jdXJyZW5jeS1jb2x1bW4gbWlncmF0aW9uKS5cbiAgICAgIGRiLmNsZWFyU2NoZW1hQ2FjaGUoKVxuICAgICAgY29uc3QgbG9ja2VkVGFibGUgPSBhd2FpdCBkYi5nZXRUYWJsZUJ5TmFtZU9yRmFpbChKT0JTX1RBQkxFKVxuXG4gICAgICBpZiAoIShhd2FpdCBsb2NrZWRUYWJsZS5nZXRDb2x1bW5CeU5hbWUoXCJxdWV1ZVwiKSkpIHtcbiAgICAgICAgY29uc3QgdGFibGVEYXRhID0gbmV3IFRhYmxlRGF0YShKT0JTX1RBQkxFKVxuXG4gICAgICAgIHRhYmxlRGF0YS5zdHJpbmcoXCJxdWV1ZVwiLCB7bnVsbDogdHJ1ZSwgaW5kZXg6IHRydWV9KVxuXG4gICAgICAgIGZvciAoY29uc3Qgc3FsIG9mIGF3YWl0IGRiLmFsdGVyVGFibGVTUUxzKHRhYmxlRGF0YSkpIGF3YWl0IGRiLnF1ZXJ5KHNxbClcblxuICAgICAgICBkYi5jbGVhclNjaGVtYUNhY2hlKClcbiAgICAgIH1cbiAgICB9IGZpbmFsbHkge1xuICAgICAgYXdhaXQgZGIucmVsZWFzZUFkdmlzb3J5TG9jayhsb2NrTmFtZSlcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogUnVucyBiYWNrZmlsbCBleGVjdXRpb24gbW9kZXMgb25jZS5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9kYXRhYmFzZS9kcml2ZXJzL2Jhc2UuanNcIikuZGVmYXVsdH0gZGIgLSBEYXRhYmFzZSBjb25uZWN0aW9uLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyB3aGVuIGNvbXBsZXRlLlxuICAgKi9cbiAgYXN5bmMgX2JhY2tmaWxsRXhlY3V0aW9uTW9kZXNPbmNlKGRiKSB7XG4gICAgY29uc3QgbWlncmF0aW9uVmVyc2lvbiA9IEVYRUNVVElPTl9NT0RFX0JBQ0tGSUxMX01JR1JBVElPTl9WRVJTSU9OXG4gICAgY29uc3QgbWlncmF0aW9uS2V5ID0gdGhpcy5fbWlncmF0aW9uS2V5KG1pZ3JhdGlvblZlcnNpb24pXG5cbiAgICBpZiAoYXdhaXQgdGhpcy5faGFzTWlncmF0aW9uKGRiLCBtaWdyYXRpb25WZXJzaW9uKSkgcmV0dXJuXG5cbiAgICBhd2FpdCBkYi5hY3F1aXJlQWR2aXNvcnlMb2NrKG1pZ3JhdGlvbktleSlcblxuICAgIHRyeSB7XG4gICAgICBpZiAoYXdhaXQgdGhpcy5faGFzTWlncmF0aW9uKGRiLCBtaWdyYXRpb25WZXJzaW9uKSkgcmV0dXJuXG5cbiAgICAgIC8vIEEgdGFibGUgY3JlYXRlZCBhZnRlciB0aGUgYGZvcmtlZGAgY29sdW1uIHdhcyBkcm9wcGVkIGhhcyBub3RoaW5nIHRvXG4gICAgICAvLyBiYWNrZmlsbCBmcm9tOyByZWNvcmQgdGhlIG1pZ3JhdGlvbiBzbyBpdCBpcyBub3QgcmUtYXR0ZW1wdGVkLlxuICAgICAgZGIuY2xlYXJTY2hlbWFDYWNoZSgpXG4gICAgICBpZiAoIShhd2FpdCAoYXdhaXQgZGIuZ2V0VGFibGVCeU5hbWVPckZhaWwoSk9CU19UQUJMRSkpLmdldENvbHVtbkJ5TmFtZShcImZvcmtlZFwiKSkpIHtcbiAgICAgICAgYXdhaXQgdGhpcy5fcmVjb3JkTWlncmF0aW9uKGRiLCBtaWdyYXRpb25WZXJzaW9uKVxuICAgICAgICByZXR1cm5cbiAgICAgIH1cblxuICAgICAgY29uc3QgdGFibGVOYW1lU3FsID0gZGIucXVvdGVUYWJsZShKT0JTX1RBQkxFKVxuICAgICAgY29uc3QgZm9ya2VkQ29sdW1uU3FsID0gZGIucXVvdGVDb2x1bW4oXCJmb3JrZWRcIilcbiAgICAgIGNvbnN0IGV4ZWN1dGlvbk1vZGVDb2x1bW5TcWwgPSBkYi5xdW90ZUNvbHVtbihcImV4ZWN1dGlvbl9tb2RlXCIpXG5cbiAgICAgIGF3YWl0IGRiLnF1ZXJ5KFxuICAgICAgICBgVVBEQVRFICR7dGFibGVOYW1lU3FsfSBTRVQgJHtleGVjdXRpb25Nb2RlQ29sdW1uU3FsfSA9ICR7ZGIucXVvdGUoXCJmb3JrZWRcIil9IGAgK1xuICAgICAgICBgV0hFUkUgJHtmb3JrZWRDb2x1bW5TcWx9ID0gJHtkYi5xdW90ZSh0cnVlKX0gQU5EICR7ZXhlY3V0aW9uTW9kZUNvbHVtblNxbH0gSVMgTlVMTGBcbiAgICAgIClcbiAgICAgIGF3YWl0IGRiLnF1ZXJ5KFxuICAgICAgICBgVVBEQVRFICR7dGFibGVOYW1lU3FsfSBTRVQgJHtleGVjdXRpb25Nb2RlQ29sdW1uU3FsfSA9ICR7ZGIucXVvdGUoXCJpbmxpbmVcIil9IGAgK1xuICAgICAgICBgV0hFUkUgJHtmb3JrZWRDb2x1bW5TcWx9ID0gJHtkYi5xdW90ZShmYWxzZSl9IEFORCAke2V4ZWN1dGlvbk1vZGVDb2x1bW5TcWx9IElTIE5VTExgXG4gICAgICApXG5cbiAgICAgIGF3YWl0IHRoaXMuX3JlY29yZE1pZ3JhdGlvbihkYiwgbWlncmF0aW9uVmVyc2lvbilcbiAgICB9IGZpbmFsbHkge1xuICAgICAgYXdhaXQgZGIucmVsZWFzZUFkdmlzb3J5TG9jayhtaWdyYXRpb25LZXkpXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIFJld3JpdGVzIHByZS1leGlzdGluZyBwb29sZWQgcm93cyAocGVyc2lzdGVkIGFzIGBleGVjdXRpb25fbW9kZSA9IFwiZm9ya2VkXCJgXG4gICAqIHBsdXMgYSBgdmVsb2Npb3VzLXBvb2xlZDoqYCBoYW5kb2ZmIG1hcmtlcikgdG8gYGV4ZWN1dGlvbl9tb2RlID0gXCJwb29sZWRcImAsXG4gICAqIGNsZWFycyB0aGUgcXVldWVkIG1hcmtlciwgdGhlbiBkcm9wcyB0aGUgbm93LXJlZHVuZGFudCBgZm9ya2VkYCBjb2x1bW4gc29cbiAgICogYGV4ZWN1dGlvbl9tb2RlYCBpcyB0aGUgc2luZ2xlIHNvdXJjZSBvZiB0cnV0aC4gUnVucyBvbmNlLCBndWFyZGVkIGJ5IHRoZVxuICAgKiBtaWdyYXRpb24gbGVkZ2VyIGFuZCBhIHBlci1rZXkgYWR2aXNvcnkgbG9jazsgYSBmcmVzaCB0YWJsZSAoY3JlYXRlZCB3aXRob3V0XG4gICAqIHRoZSBjb2x1bW4pIHNob3J0LWNpcmN1aXRzLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL2RhdGFiYXNlL2RyaXZlcnMvYmFzZS5qc1wiKS5kZWZhdWx0fSBkYiAtIERhdGFiYXNlIGNvbm5lY3Rpb24uXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIHdoZW4gY29tcGxldGUuXG4gICAqL1xuICBhc3luYyBfZHJvcEZvcmtlZENvbHVtbk9uY2UoZGIpIHtcbiAgICBjb25zdCBtaWdyYXRpb25WZXJzaW9uID0gRFJPUF9GT1JLRURfQ09MVU1OX01JR1JBVElPTl9WRVJTSU9OXG4gICAgY29uc3QgbWlncmF0aW9uS2V5ID0gdGhpcy5fbWlncmF0aW9uS2V5KG1pZ3JhdGlvblZlcnNpb24pXG5cbiAgICBpZiAoYXdhaXQgdGhpcy5faGFzTWlncmF0aW9uKGRiLCBtaWdyYXRpb25WZXJzaW9uKSkgcmV0dXJuXG5cbiAgICBhd2FpdCBkYi5hY3F1aXJlQWR2aXNvcnlMb2NrKG1pZ3JhdGlvbktleSlcblxuICAgIHRyeSB7XG4gICAgICBpZiAoYXdhaXQgdGhpcy5faGFzTWlncmF0aW9uKGRiLCBtaWdyYXRpb25WZXJzaW9uKSkgcmV0dXJuXG5cbiAgICAgIGRiLmNsZWFyU2NoZW1hQ2FjaGUoKVxuXG4gICAgICBpZiAoYXdhaXQgKGF3YWl0IGRiLmdldFRhYmxlQnlOYW1lT3JGYWlsKEpPQlNfVEFCTEUpKS5nZXRDb2x1bW5CeU5hbWUoXCJmb3JrZWRcIikpIHtcbiAgICAgICAgY29uc3QgdGFibGVOYW1lU3FsID0gZGIucXVvdGVUYWJsZShKT0JTX1RBQkxFKVxuICAgICAgICBjb25zdCBleGVjdXRpb25Nb2RlQ29sdW1uU3FsID0gZGIucXVvdGVDb2x1bW4oXCJleGVjdXRpb25fbW9kZVwiKVxuICAgICAgICBjb25zdCBoYW5kb2ZmSWRDb2x1bW5TcWwgPSBkYi5xdW90ZUNvbHVtbihcImhhbmRvZmZfaWRcIilcblxuICAgICAgICAvLyBQb29sZWQgcm93cyB1c2VkIHRvIHBlcnNpc3QgYXMgZXhlY3V0aW9uX21vZGUgXCJmb3JrZWRcIiArIGEgcG9vbGVkIGhhbmRvZmZcbiAgICAgICAgLy8gbWFya2VyOyByZWNvdmVyIHRoZWlyIHJlYWwgbW9kZSBiZWZvcmUgdGhlIG1hcmtlciBpcyBjbGVhcmVkLlxuICAgICAgICBhd2FpdCBkYi5xdWVyeShcbiAgICAgICAgICBgVVBEQVRFICR7dGFibGVOYW1lU3FsfSBTRVQgJHtleGVjdXRpb25Nb2RlQ29sdW1uU3FsfSA9ICR7ZGIucXVvdGUoXCJwb29sZWRcIil9IGAgK1xuICAgICAgICAgIGBXSEVSRSAke2V4ZWN1dGlvbk1vZGVDb2x1bW5TcWx9ID0gJHtkYi5xdW90ZShcImZvcmtlZFwiKX0gYCArXG4gICAgICAgICAgYEFORCAke2hhbmRvZmZJZENvbHVtblNxbH0gTElLRSAke2RiLnF1b3RlKGAke0xFR0FDWV9QT09MRURfSEFORE9GRl9JRF9QUkVGSVh9JWApfWBcbiAgICAgICAgKVxuICAgICAgICAvLyBUaGUgcXVldWVkLXBvb2xlZCBtYXJrZXIgd2FzIGEgc2VudGluZWwsIG5vdCBhIHJlYWwgbGVhc2U7IGNsZWFyIGl0LlxuICAgICAgICBhd2FpdCBkYi5xdWVyeShcbiAgICAgICAgICBgVVBEQVRFICR7dGFibGVOYW1lU3FsfSBTRVQgJHtoYW5kb2ZmSWRDb2x1bW5TcWx9ID0gTlVMTCBgICtcbiAgICAgICAgICBgV0hFUkUgJHtoYW5kb2ZmSWRDb2x1bW5TcWx9ID0gJHtkYi5xdW90ZShMRUdBQ1lfUE9PTEVEX1FVRVVFRF9IQU5ET0ZGX0lEKX1gXG4gICAgICAgIClcblxuICAgICAgICBjb25zdCBkcm9wRm9ya2VkID0gbmV3IFRhYmxlRGF0YShKT0JTX1RBQkxFKVxuICAgICAgICBkcm9wRm9ya2VkLmFkZENvbHVtbihcImZvcmtlZFwiLCB7ZHJvcENvbHVtbjogdHJ1ZX0pXG4gICAgICAgIGZvciAoY29uc3Qgc3FsIG9mIGF3YWl0IGRiLmFsdGVyVGFibGVTUUxzKGRyb3BGb3JrZWQpKSBhd2FpdCBkYi5xdWVyeShzcWwpXG5cbiAgICAgICAgZGIuY2xlYXJTY2hlbWFDYWNoZSgpXG4gICAgICB9XG5cbiAgICAgIGF3YWl0IHRoaXMuX3JlY29yZE1pZ3JhdGlvbihkYiwgbWlncmF0aW9uVmVyc2lvbilcbiAgICB9IGZpbmFsbHkge1xuICAgICAgYXdhaXQgZGIucmVsZWFzZUFkdmlzb3J5TG9jayhtaWdyYXRpb25LZXkpXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgcmVjb3JkIG1pZ3JhdGlvbi5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9kYXRhYmFzZS9kcml2ZXJzL2Jhc2UuanNcIikuZGVmYXVsdH0gZGIgLSBEYXRhYmFzZSBjb25uZWN0aW9uLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gdmVyc2lvbiAtIE1pZ3JhdGlvbiB2ZXJzaW9uLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyB3aGVuIGNvbXBsZXRlLlxuICAgKi9cbiAgYXN5bmMgX3JlY29yZE1pZ3JhdGlvbihkYiwgdmVyc2lvbikge1xuICAgIGF3YWl0IGRiLnVwc2VydCh7XG4gICAgICB0YWJsZU5hbWU6IE1JR1JBVElPTlNfVEFCTEUsXG4gICAgICBkYXRhOiB7XG4gICAgICAgIGtleTogdGhpcy5fbWlncmF0aW9uS2V5KHZlcnNpb24pLFxuICAgICAgICBzY29wZTogTUlHUkFUSU9OX1NDT1BFLFxuICAgICAgICB2ZXJzaW9uLFxuICAgICAgICBhcHBsaWVkX2F0X21zOiBEYXRlLm5vdygpXG4gICAgICB9LFxuICAgICAgY29uZmxpY3RDb2x1bW5zOiBbXCJrZXlcIl0sXG4gICAgICB1cGRhdGVDb2x1bW5zOiBbXCJzY29wZVwiLCBcInZlcnNpb25cIiwgXCJhcHBsaWVkX2F0X21zXCJdXG4gICAgfSlcbiAgfVxuXG4gIGFzeW5jIF9pbml0aWFsaXplTW9kZWwoKSB7XG4gICAgaWYgKEJhY2tncm91bmRKb2JSZWNvcmQuaXNJbml0aWFsaXplZCgpKSByZXR1cm5cblxuICAgIEJhY2tncm91bmRKb2JSZWNvcmQuc2V0RGF0YWJhc2VJZGVudGlmaWVyKHRoaXMuZ2V0RGF0YWJhc2VJZGVudGlmaWVyKCkpXG4gICAgY29uc3QgcG9vbCA9IHRoaXMuY29uZmlndXJhdGlvbi5nZXREYXRhYmFzZVBvb2wodGhpcy5nZXREYXRhYmFzZUlkZW50aWZpZXIoKSlcblxuICAgIGF3YWl0IHBvb2wud2l0aENvbm5lY3Rpb24oe25hbWU6IFwiQmFja2dyb3VuZCBqb2JzIHN0b3JlIGluaXRpYWxpemUgbW9kZWxcIn0sIGFzeW5jICgpID0+IHtcbiAgICAgIGF3YWl0IEJhY2tncm91bmRKb2JSZWNvcmQuaW5pdGlhbGl6ZVJlY29yZCh7Y29uZmlndXJhdGlvbjogdGhpcy5jb25maWd1cmF0aW9ufSlcbiAgICB9KVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZ2V0IGpvYiByb3cgYnkgaWQuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vZGF0YWJhc2UvZHJpdmVycy9iYXNlLmpzXCIpLmRlZmF1bHR9IGRiIC0gRGF0YWJhc2UgY29ubmVjdGlvbi5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGpvYklkIC0gSm9iIGlkLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxpbXBvcnQoXCIuL3R5cGVzLmpzXCIpLkJhY2tncm91bmRKb2JSb3cgfCBudWxsPn0gLSBKb2Igcm93LlxuICAgKi9cbiAgYXN5bmMgX2dldEpvYlJvd0J5SWQoZGIsIGpvYklkKSB7XG4gICAgY29uc3QgcXVlcnkgPSBkYlxuICAgICAgLm5ld1F1ZXJ5KClcbiAgICAgIC5mcm9tKEpPQlNfVEFCTEUpXG4gICAgICAud2hlcmUoe2lkOiBqb2JJZH0pXG4gICAgICAubGltaXQoMSlcblxuICAgIGNvbnN0IHJvd3MgPSBhd2FpdCBxdWVyeS5yZXN1bHRzKClcblxuICAgIGlmICghcm93c1swXSkgcmV0dXJuIG51bGxcblxuICAgIHJldHVybiB0aGlzLl9ub3JtYWxpemVKb2JSb3cocm93c1swXSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSZWFkcyB0aGUgam9iIGN1cnJlbnRseSBuYW1lZCBieSBvbmUgc3RhYmxlIG93bmVyIHJvdy5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9kYXRhYmFzZS9kcml2ZXJzL2Jhc2UuanNcIikuZGVmYXVsdH0gZGIgLSBEYXRhYmFzZSBjb25uZWN0aW9uLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gc2NoZWR1bGVLZXkgLSBWYWxpZGF0ZWQgc3RhYmxlIHNjaGVkdWxlIGtleS5cbiAgICogQHJldHVybnMge1Byb21pc2U8aW1wb3J0KFwiLi90eXBlcy5qc1wiKS5CYWNrZ3JvdW5kSm9iUm93IHwgbnVsbD59IC0gTm9ybWFsaXplZCBvd25lciBqb2IuXG4gICAqL1xuICBhc3luYyBfc2NoZWR1bGVkT3duZXJKb2IoZGIsIHNjaGVkdWxlS2V5KSB7XG4gICAgY29uc3Qgb3duZXJSb3dzID0gYXdhaXQgZGJcbiAgICAgIC5uZXdRdWVyeSgpXG4gICAgICAuZnJvbShTQ0hFRFVMRV9LRVlTX1RBQkxFKVxuICAgICAgLndoZXJlKHtzY2hlZHVsZV9rZXk6IHNjaGVkdWxlS2V5fSlcbiAgICAgIC5saW1pdCgxKVxuICAgICAgLnJlc3VsdHMoKVxuICAgIGNvbnN0IG93bmVyUm93ID0gb3duZXJSb3dzWzBdXG5cbiAgICBpZiAoIW93bmVyUm93KSByZXR1cm4gbnVsbFxuXG4gICAgcmV0dXJuIGF3YWl0IHRoaXMuX2dldEpvYlJvd0J5SWQoZGIsIFN0cmluZyhvd25lclJvdy5qb2JfaWQpKVxuICB9XG5cbiAgLyoqXG4gICAqIEFzc2lnbnMgdGhlIG5leHQgb3duZXJzaGlwIG9yZGVyIHdoaWxlIHRoZSBjYWxsZXIgaG9sZHMgdGhlIHNjaGVkdWxlLWtleVxuICAgKiBhZHZpc29yeSBsb2NrIGFuZCBjb3VudC1yZXZpc2lvbiB0cmFuc2FjdGlvbiBmZW5jZS4gVGhlIGluZGVwZW5kZW50XG4gICAqIHdhdGVybWFyayBzdXJ2aXZlcyBib3RoIG93bmVyc2hpcCByZWxlYXNlIGFuZCB0ZXJtaW5hbC1oaXN0b3J5IHBydW5pbmcuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vZGF0YWJhc2UvZHJpdmVycy9iYXNlLmpzXCIpLmRlZmF1bHR9IGRiIC0gRGF0YWJhc2UgY29ubmVjdGlvbi5cbiAgICogQHBhcmFtIHtzdHJpbmd9IHNjaGVkdWxlS2V5IC0gVmFsaWRhdGVkIHN0YWJsZSBzY2hlZHVsZSBrZXkuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPG51bWJlcj59IC0gTmV4dCBtb25vdG9uaWMgb3duZXJzaGlwIG9yZGVyLlxuICAgKi9cbiAgYXN5bmMgX25leHRTY2hlZHVsZU9yZGVyKGRiLCBzY2hlZHVsZUtleSkge1xuICAgIGNvbnN0IGR1cmFibGVPcmRlciA9IGF3YWl0IHRoaXMuX3NjaGVkdWxlT3JkZXJXYXRlcm1hcmsoZGIsIHNjaGVkdWxlS2V5KVxuICAgIGNvbnN0IHJldGFpbmVkT3JkZXIgPSBhd2FpdCB0aGlzLl9ncmVhdGVzdFJldGFpbmVkU2NoZWR1bGVPcmRlcihkYiwgc2NoZWR1bGVLZXkpXG4gICAgbGV0IGN1cnJlbnRPcmRlciA9IGR1cmFibGVPcmRlclxuXG4gICAgaWYgKHJldGFpbmVkT3JkZXIgIT09IG51bGwgJiYgKGN1cnJlbnRPcmRlciA9PT0gbnVsbCB8fCByZXRhaW5lZE9yZGVyID4gY3VycmVudE9yZGVyKSkgY3VycmVudE9yZGVyID0gcmV0YWluZWRPcmRlclxuICAgIGNvbnN0IG5leHRPcmRlciA9IGN1cnJlbnRPcmRlciA9PT0gbnVsbCA/IDEgOiBjdXJyZW50T3JkZXIgKyAxXG5cbiAgICBpZiAoIU51bWJlci5pc1NhZmVJbnRlZ2VyKG5leHRPcmRlcikpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihgQmFja2dyb3VuZCBqb2Igc2NoZWR1bGUgb3duZXJzaGlwIG9yZGVyIGV4aGF1c3RlZCBmb3IgJHtzY2hlZHVsZUtleX1gKVxuICAgIH1cblxuICAgIGF3YWl0IHRoaXMuX3dyaXRlU2NoZWR1bGVPcmRlcldhdGVybWFyayhkYiwge3NjaGVkdWxlS2V5LCBzY2hlZHVsZU9yZGVyOiBuZXh0T3JkZXJ9KVxuXG4gICAgcmV0dXJuIG5leHRPcmRlclxuICB9XG5cbiAgLyoqXG4gICAqIEZpbmRzIHRoZSBncmVhdGVzdCByZXRhaW5lZCBub24tbGVnYWN5IG93bmVyc2hpcCBvcmRlciBmb3IgbWlncmF0aW9uIGFuZFxuICAgKiByb2xsaW5nLXVwZ3JhZGUgY29tcGF0aWJpbGl0eS4gSXQgaXMgbmV2ZXIgdGhlIHNvbGUgZHVyYWJpbGl0eSBib3VuZGFyeS5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9kYXRhYmFzZS9kcml2ZXJzL2Jhc2UuanNcIikuZGVmYXVsdH0gZGIgLSBEYXRhYmFzZSBjb25uZWN0aW9uLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gc2NoZWR1bGVLZXkgLSBWYWxpZGF0ZWQgc3RhYmxlIHNjaGVkdWxlIGtleS5cbiAgICogQHJldHVybnMge1Byb21pc2U8bnVtYmVyIHwgbnVsbD59IC0gR3JlYXRlc3QgcmV0YWluZWQgb3JkZXIsIG9yIG51bGwuXG4gICAqL1xuICBhc3luYyBfZ3JlYXRlc3RSZXRhaW5lZFNjaGVkdWxlT3JkZXIoZGIsIHNjaGVkdWxlS2V5KSB7XG4gICAgY29uc3Qgcm93cyA9IGF3YWl0IGRiXG4gICAgICAubmV3UXVlcnkoKVxuICAgICAgLmZyb20oSk9CU19UQUJMRSlcbiAgICAgIC5zZWxlY3QoXCJzY2hlZHVsZV9vcmRlclwiKVxuICAgICAgLndoZXJlKHtzY2hlZHVsZV9rZXk6IHNjaGVkdWxlS2V5fSlcbiAgICAgIC53aGVyZU5vdCh7c2NoZWR1bGVfb3JkZXI6IG51bGx9KVxuICAgICAgLm9yZGVyKFwic2NoZWR1bGVfb3JkZXIgREVTQ1wiKVxuICAgICAgLmxpbWl0KDEpXG4gICAgICAucmVzdWx0cygpXG4gICAgY29uc3Qgcm93ID0gcm93c1swXVxuXG4gICAgaWYgKCFyb3cpIHJldHVybiBudWxsXG5cbiAgICByZXR1cm4gdGhpcy5fdmFsaWRhdGVkU2NoZWR1bGVPcmRlcihcbiAgICAgIC8qKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSAqLyAocm93KS5zY2hlZHVsZV9vcmRlclxuICAgIClcbiAgfVxuXG4gIC8qKlxuICAgKiBSZWFkcyBhbmQgdmFsaWRhdGVzIG9uZSByZXRlbnRpb24taW5kZXBlbmRlbnQgc2NoZWR1bGUtb3JkZXIgd2F0ZXJtYXJrLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL2RhdGFiYXNlL2RyaXZlcnMvYmFzZS5qc1wiKS5kZWZhdWx0fSBkYiAtIERhdGFiYXNlIGNvbm5lY3Rpb24uXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBzY2hlZHVsZUtleSAtIFZhbGlkYXRlZCBzdGFibGUgc2NoZWR1bGUga2V5LlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxudW1iZXIgfCBudWxsPn0gLSBDdXJyZW50IHdhdGVybWFyaywgb3IgbnVsbCBiZWZvcmUgZmlyc3Qgb3duZXJzaGlwLlxuICAgKi9cbiAgYXN5bmMgX3NjaGVkdWxlT3JkZXJXYXRlcm1hcmsoZGIsIHNjaGVkdWxlS2V5KSB7XG4gICAgY29uc3Qgcm93cyA9IGF3YWl0IGRiXG4gICAgICAubmV3UXVlcnkoKVxuICAgICAgLmZyb20oU0NIRURVTEVfT1JERVJfV0FURVJNQVJLU19UQUJMRSlcbiAgICAgIC5zZWxlY3QoXCJoaWdoX3dhdGVyX21hcmtcIilcbiAgICAgIC53aGVyZSh7c2NoZWR1bGVfa2V5OiBzY2hlZHVsZUtleX0pXG4gICAgICAubGltaXQoMSlcbiAgICAgIC5yZXN1bHRzKClcbiAgICBjb25zdCByb3cgPSByb3dzWzBdXG5cbiAgICBpZiAoIXJvdykgcmV0dXJuIG51bGxcblxuICAgIHJldHVybiB0aGlzLl92YWxpZGF0ZWRTY2hlZHVsZU9yZGVyKFxuICAgICAgLyoqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59ICovIChyb3cpLmhpZ2hfd2F0ZXJfbWFya1xuICAgIClcbiAgfVxuXG4gIC8qKlxuICAgKiBQZXJzaXN0cyBvbmUgc2NoZWR1bGUtb3JkZXIgd2F0ZXJtYXJrIHdpdGhvdXQgZXhwb3NpbmcgaXQgYXMgYSBqb2Igcm93LlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL2RhdGFiYXNlL2RyaXZlcnMvYmFzZS5qc1wiKS5kZWZhdWx0fSBkYiAtIERhdGFiYXNlIGNvbm5lY3Rpb24uXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gV2F0ZXJtYXJrIGlkZW50aXR5IGFuZCB2YWx1ZS5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGFyZ3Muc2NoZWR1bGVLZXkgLSBWYWxpZGF0ZWQgc3RhYmxlIHNjaGVkdWxlIGtleS5cbiAgICogQHBhcmFtIHtudW1iZXJ9IGFyZ3Muc2NoZWR1bGVPcmRlciAtIFZhbGlkYXRlZCBtb25vdG9uaWMgb3JkZXIuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIGFmdGVyIHBlcnNpc3RlbmNlLlxuICAgKi9cbiAgYXN5bmMgX3dyaXRlU2NoZWR1bGVPcmRlcldhdGVybWFyayhkYiwge3NjaGVkdWxlS2V5LCBzY2hlZHVsZU9yZGVyfSkge1xuICAgIGF3YWl0IGRiLnVwc2VydCh7XG4gICAgICB0YWJsZU5hbWU6IFNDSEVEVUxFX09SREVSX1dBVEVSTUFSS1NfVEFCTEUsXG4gICAgICBkYXRhOiB7aGlnaF93YXRlcl9tYXJrOiBzY2hlZHVsZU9yZGVyLCBzY2hlZHVsZV9rZXk6IHNjaGVkdWxlS2V5fSxcbiAgICAgIGNvbmZsaWN0Q29sdW1uczogW1wic2NoZWR1bGVfa2V5XCJdLFxuICAgICAgdXBkYXRlQ29sdW1uczogW1wiaGlnaF93YXRlcl9tYXJrXCJdXG4gICAgfSlcbiAgfVxuXG4gIC8qKlxuICAgKiBWYWxpZGF0ZXMgYW4gb3duZXJzaGlwIG9yZGVyIGxvYWRlZCBmcm9tIGR1cmFibGUgc3RvcmFnZS5cbiAgICogQHBhcmFtIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gdmFsdWUgLSBTdG9yZWQgb3JkZXIuXG4gICAqIEByZXR1cm5zIHtudW1iZXJ9IC0gUG9zaXRpdmUgc2FmZSBpbnRlZ2VyIG93bmVyc2hpcCBvcmRlci5cbiAgICovXG4gIF92YWxpZGF0ZWRTY2hlZHVsZU9yZGVyKHZhbHVlKSB7XG4gICAgY29uc3Qgc2NoZWR1bGVPcmRlciA9IHRoaXMuX25vcm1hbGl6ZU51bWJlcih2YWx1ZSlcblxuICAgIGlmIChzY2hlZHVsZU9yZGVyID09PSBudWxsIHx8ICFOdW1iZXIuaXNTYWZlSW50ZWdlcihzY2hlZHVsZU9yZGVyKSB8fCBzY2hlZHVsZU9yZGVyIDwgMSkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKGBJbnZhbGlkIGJhY2tncm91bmQgam9iIHNjaGVkdWxlIG93bmVyc2hpcCBvcmRlcjogJHtzY2hlZHVsZU9yZGVyfWApXG4gICAgfVxuXG4gICAgcmV0dXJuIHNjaGVkdWxlT3JkZXJcbiAgfVxuXG4gIC8qKlxuICAgKiBCdWlsZHMgYSBzdGFibGUtc2NoZWR1bGUgbG9va3VwIGV4Y2x1c2l2ZWx5IGZyb20gbm9ybWFsaXplZCBqb2Igcm93cy5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9kYXRhYmFzZS9kcml2ZXJzL2Jhc2UuanNcIikuZGVmYXVsdH0gZGIgLSBEYXRhYmFzZSBjb25uZWN0aW9uLlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIExvb2t1cCBvcHRpb25zLlxuICAgKiBAcGFyYW0ge2Jvb2xlYW59IGFyZ3MuaW5jbHVkZUxhdGVzdFRlcm1pbmFsIC0gV2hldGhlciB0ZXJtaW5hbCBoaXN0b3J5IGlzIHJlcXVlc3RlZC5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGFyZ3Muc2NoZWR1bGVLZXkgLSBWYWxpZGF0ZWQgc3RhYmxlIHNjaGVkdWxlIGtleS5cbiAgICogQHJldHVybnMge1Byb21pc2U8aW1wb3J0KFwiLi90eXBlcy5qc1wiKS5CYWNrZ3JvdW5kSm9iU2NoZWR1bGVkTG9va3VwUmVzdWx0Pn0gLSBOb3JtYWxpemVkIHB1YmxpYyBqb2JzLlxuICAgKi9cbiAgYXN5bmMgX3NjaGVkdWxlZEpvYkxvb2t1cChkYiwge2luY2x1ZGVMYXRlc3RUZXJtaW5hbCwgc2NoZWR1bGVLZXl9KSB7XG4gICAgY29uc3Qgb3duZXJKb2IgPSBhd2FpdCB0aGlzLl9zY2hlZHVsZWRPd25lckpvYihkYiwgc2NoZWR1bGVLZXkpXG4gICAgY29uc3QgY3VycmVudEpvYiA9IG93bmVySm9iICYmIChvd25lckpvYi5zdGF0dXMgPT09IFwicXVldWVkXCIgfHwgb3duZXJKb2Iuc3RhdHVzID09PSBcImhhbmRlZF9vZmZcIikgPyBvd25lckpvYiA6IG51bGxcblxuICAgIGlmICghaW5jbHVkZUxhdGVzdFRlcm1pbmFsKSByZXR1cm4ge2N1cnJlbnRKb2IsIGxhdGVzdFRlcm1pbmFsSm9iOiBudWxsfVxuXG4gICAgY29uc3QgdGVybWluYWxTdGF0dXNlcyA9IEJBQ0tHUk9VTkRfSk9CX1RFUk1JTkFMX1NUQVRVU0VTLm1hcCgoc3RhdHVzKSA9PiBkYi5xdW90ZShzdGF0dXMpKS5qb2luKFwiLCBcIilcbiAgICBjb25zdCB0ZXJtaW5hbFJvd3MgPSBhd2FpdCBkYlxuICAgICAgLm5ld1F1ZXJ5KClcbiAgICAgIC5mcm9tKEpPQlNfVEFCTEUpXG4gICAgICAud2hlcmUoe3NjaGVkdWxlX2tleTogc2NoZWR1bGVLZXl9KVxuICAgICAgLndoZXJlKGAke2RiLnF1b3RlQ29sdW1uKFwic3RhdHVzXCIpfSBJTiAoJHt0ZXJtaW5hbFN0YXR1c2VzfSlgKVxuICAgICAgLm9yZGVyKGBDQVNFIFdIRU4gJHtkYi5xdW90ZUNvbHVtbihcInNjaGVkdWxlX29yZGVyXCIpfSBJUyBOVUxMIFRIRU4gMCBFTFNFIDEgRU5EIERFU0NgKVxuICAgICAgLm9yZGVyKFwic2NoZWR1bGVfb3JkZXIgREVTQ1wiKVxuICAgICAgLm9yZGVyKFwiY3JlYXRlZF9hdF9tcyBERVNDXCIpXG4gICAgICAub3JkZXIoXCJpZCBERVNDXCIpXG4gICAgICAubGltaXQoMSlcbiAgICAgIC5yZXN1bHRzKClcbiAgICBjb25zdCBsYXRlc3RUZXJtaW5hbEpvYiA9IHRlcm1pbmFsUm93c1swXSA/IHRoaXMuX25vcm1hbGl6ZUpvYlJvdyh0ZXJtaW5hbFJvd3NbMF0pIDogbnVsbFxuXG4gICAgcmV0dXJuIHtjdXJyZW50Sm9iLCBsYXRlc3RUZXJtaW5hbEpvYn1cbiAgfVxuXG4gIC8qKlxuICAgKiBSZWxlYXNlcyBvd25lcnNoaXAgb25seSB3aGVuIHRoZSBrZXkgc3RpbGwgcG9pbnRzIGF0IHRoZSBleHBlY3RlZCBqb2IuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vZGF0YWJhc2UvZHJpdmVycy9iYXNlLmpzXCIpLmRlZmF1bHR9IGRiIC0gRGF0YWJhc2UgY29ubmVjdGlvbi5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBPd25lcnNoaXAgaWRlbnRpdHkuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBhcmdzLmpvYklkIC0gRXhwZWN0ZWQgb3duZXIgam9iIGlkLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gYXJncy5zY2hlZHVsZUtleSAtIFN0YWJsZSBzY2hlZHVsZSBrZXkuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIHdoZW4gZGVsZXRlZCBvciBhbHJlYWR5IHN1cGVyc2VkZWQuXG4gICAqL1xuICBhc3luYyBfcmVsZWFzZVNjaGVkdWxlT3duZXJzaGlwKGRiLCB7am9iSWQsIHNjaGVkdWxlS2V5fSkge1xuICAgIGF3YWl0IGRiLmRlbGV0ZSh7XG4gICAgICB0YWJsZU5hbWU6IFNDSEVEVUxFX0tFWVNfVEFCTEUsXG4gICAgICBjb25kaXRpb25zOiB7am9iX2lkOiBqb2JJZCwgc2NoZWR1bGVfa2V5OiBzY2hlZHVsZUtleX1cbiAgICB9KVxuICB9XG5cbiAgLyoqXG4gICAqIFJlbGVhc2VzIGEgam9iJ3Mgb3duZXJzaGlwIHdoZW4gaXQgaGFzIGEgaGlzdG9yaWNhbCBzY2hlZHVsZSBrZXkuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vZGF0YWJhc2UvZHJpdmVycy9iYXNlLmpzXCIpLmRlZmF1bHR9IGRiIC0gRGF0YWJhc2UgY29ubmVjdGlvbi5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL3R5cGVzLmpzXCIpLkJhY2tncm91bmRKb2JSb3d9IGpvYiAtIFRlcm1pbmFsIGpvYi5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgd2hlbiBkZWxldGVkIG9yIG5vdCBhcHBsaWNhYmxlLlxuICAgKi9cbiAgYXN5bmMgX3JlbGVhc2VTY2hlZHVsZU93bmVyc2hpcEZvckpvYihkYiwgam9iKSB7XG4gICAgaWYgKCFqb2Iuc2NoZWR1bGVLZXkpIHJldHVyblxuXG4gICAgYXdhaXQgdGhpcy5fcmVsZWFzZVNjaGVkdWxlT3duZXJzaGlwKGRiLCB7am9iSWQ6IGpvYi5pZCwgc2NoZWR1bGVLZXk6IGpvYi5zY2hlZHVsZUtleX0pXG4gIH1cblxuICAvKipcbiAgICogUnVucyBhcHBseSBmYWlsdXJlLlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIE9wdGlvbnMuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vZGF0YWJhc2UvZHJpdmVycy9iYXNlLmpzXCIpLmRlZmF1bHR9IGFyZ3MuZGIgLSBEYXRhYmFzZSBjb25uZWN0aW9uLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vdHlwZXMuanNcIikuQmFja2dyb3VuZEpvYlJvd30gYXJncy5qb2IgLSBKb2Igcm93LlxuICAgKiBAcGFyYW0ge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSBhcmdzLmVycm9yIC0gRXJyb3IuXG4gICAqIEBwYXJhbSB7Ym9vbGVhbn0gYXJncy5tYXJrT3JwaGFuZWQgLSBXaGV0aGVyIG1hcmtpbmcgb3JwaGFuZWQuXG4gICAqIEBwYXJhbSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSBbYXJncy5jb25kaXRpb25zXSAtIFVwZGF0ZSBmZW5jaW5nIGNvbmRpdGlvbnMuIERlZmF1bHRzIHRvIHRoZSBhY3RpdmUtaGFuZG9mZiBsZWFzZSBtYXRjaDsgdGhlIHRpbWUtYmFzZWQgb3JwaGFuIHN3ZWVwIG92ZXJyaWRlcyB0aGlzIHdpdGggYW4gaWQvc3RhdHVzIG1hdGNoIHNvIGl0IGNhbiByZWNsYWltIHJvd3Mgd2hvc2UgYGhhbmRvZmZfaWRgIGlzIG51bGwgKGUuZy4gaGFuZGVkIG9mZiBieSBhbiBvbGRlciB2ZWxvY2lvdXMgYmVmb3JlIGhhbmRvZmYtaWQgZmVuY2luZyBleGlzdGVkKS5cbiAgICogQHJldHVybnMge1Byb21pc2U8aW1wb3J0KFwiLi90eXBlcy5qc1wiKS5CYWNrZ3JvdW5kSm9iUm93IHwgbnVsbD59IC0gVXBkYXRlZCBqb2Igcm93IHdoZW4gdGhlIGxlYXNlIHRyYW5zaXRpb24gd29uLlxuICAgKi9cbiAgYXN5bmMgX2FwcGx5RmFpbHVyZSh7ZGIsIGpvYiwgZXJyb3IsIG1hcmtPcnBoYW5lZCwgY29uZGl0aW9uc30pIHtcbiAgICBjb25zdCBub3cgPSB0aGlzLmNsb2NrLm5vdygpXG4gICAgY29uc3QgbmV4dEF0dGVtcHQgPSAoam9iLmF0dGVtcHRzIHx8IDApICsgMVxuICAgIGNvbnN0IG1heFJldHJpZXMgPSB0aGlzLl9ub3JtYWxpemVNYXhSZXRyaWVzKGpvYi5tYXhSZXRyaWVzKVxuICAgIGNvbnN0IHNob3VsZFJldHJ5ID0gbmV4dEF0dGVtcHQgPD0gbWF4UmV0cmllc1xuICAgIGNvbnN0IGZhaWx1cmVNZXNzYWdlID0gbm9ybWFsaXplQmFja2dyb3VuZEpvYkVycm9yKGVycm9yKVxuICAgIGNvbnN0IHNjaGVkdWxlZEF0ID0gc2hvdWxkUmV0cnkgPyBub3cgKyB0aGlzLmdldFJldHJ5RGVsYXlNcyhuZXh0QXR0ZW1wdCkgOiBqb2Iuc2NoZWR1bGVkQXRNc1xuICAgIGNvbnN0IHVwZGF0ZSA9IHRoaXMuX2ZhaWx1cmVVcGRhdGUoe1xuICAgICAgZmFpbHVyZU1lc3NhZ2UsXG4gICAgICBtYXJrT3JwaGFuZWQsXG4gICAgICBuZXh0QXR0ZW1wdCxcbiAgICAgIG5vdyxcbiAgICAgIHNjaGVkdWxlZEF0LFxuICAgICAgc2hvdWxkUmV0cnlcbiAgICB9KVxuXG4gICAgYXdhaXQgdGhpcy5fbG9ja0NvbmN1cnJlbmN5Um93KGRiLCBqb2IuY29uY3VycmVuY3lLZXkpXG4gICAgY29uc3QgYWZmZWN0ZWRSb3dzID0gYXdhaXQgdGhpcy5fdXBkYXRlQWZmZWN0ZWRSb3dzKGRiLCB7XG4gICAgICB0YWJsZU5hbWU6IEpPQlNfVEFCTEUsXG4gICAgICBkYXRhOiB1cGRhdGUsXG4gICAgICBjb25kaXRpb25zOiBjb25kaXRpb25zID8/IHRoaXMuX2FjdGl2ZUhhbmRvZmZDb25kaXRpb25zKGpvYilcbiAgICB9KVxuXG4gICAgaWYgKGFmZmVjdGVkUm93cyAhPT0gMSkgcmV0dXJuIG51bGxcbiAgICBpZiAoIXNob3VsZFJldHJ5KSBhd2FpdCB0aGlzLl9yZWxlYXNlU2NoZWR1bGVPd25lcnNoaXBGb3JKb2IoZGIsIGpvYilcbiAgICBhd2FpdCB0aGlzLl9yZWxlYXNlQ29uY3VycmVuY3koZGIsIGpvYi5jb25jdXJyZW5jeUtleSlcblxuICAgIC8vIFJldHVybiBhIHNuYXBzaG90IG9mIHRoZSB0cmFuc2l0aW9uIHRoaXMgdXBkYXRlIGp1c3QgYXBwbGllZCByYXRoZXIgdGhhbiByZS1yZWFkaW5nIHRoZSByb3cuXG4gICAgLy8gV2Ugd29uIHRoZSBjb25kaXRpb25hbCB1cGRhdGUgKGFmZmVjdGVkUm93cyA9PT0gMSksIHNvIHRoaXMgc3RhdGUgaXMgYXV0aG9yaXRhdGl2ZTsgcmUtcmVhZGluZ1xuICAgIC8vIGNvdWxkIGluc3RlYWQgb2JzZXJ2ZSBhIG5ld2VyIHN0YXRlIGlmIGFub3RoZXIgZGlzcGF0Y2hlciByZWNsYWltcyBhIHJlcXVldWVkIGpvYiBiZXR3ZWVuIHRoZVxuICAgIC8vIHVwZGF0ZSBhbmQgdGhlIHJlYWQgKG92ZXJsYXBwaW5nIG1haW5zIC8gcG9sbGluZyBkaXNwYXRjaCksIHdoaWNoIHdvdWxkIG1pc3JlcG9ydCB0aGVcbiAgICAvLyBzdGF0dXMvdGVybWluYWwvd2lsbFJldHJ5IG9mIHRoaXMgdHJhbnNpdGlvbiB0byBmYWlsdXJlL29ycGhhbiBldmVudCBsaXN0ZW5lcnMuXG4gICAgY29uc3Qgc3RhdHVzID0gc2hvdWxkUmV0cnkgPyBcInF1ZXVlZFwiIDogKG1hcmtPcnBoYW5lZCA/IFwib3JwaGFuZWRcIiA6IFwiZmFpbGVkXCIpXG4gICAgLyoqIEB0eXBlIHtpbXBvcnQoXCIuL3R5cGVzLmpzXCIpLkJhY2tncm91bmRKb2JSb3d9ICovXG4gICAgY29uc3QgdHJhbnNpdGlvbmVkSm9iID0ge1xuICAgICAgLi4uam9iLFxuICAgICAgLi4uKHNob3VsZFJldHJ5ID8gdGhpcy5fY2xlYXJlZENoaWxkQWNjZXB0YW5jZVJvdygpIDoge30pLFxuICAgICAgYXR0ZW1wdHM6IG5leHRBdHRlbXB0LFxuICAgICAgaGFuZGVkT2ZmQXRNczogbnVsbCxcbiAgICAgIGxhc3RFcnJvcjogZmFpbHVyZU1lc3NhZ2UsXG4gICAgICBzdGF0dXMsXG4gICAgICB3b3JrZXJJZDogbnVsbFxuICAgIH1cblxuICAgIGlmIChtYXJrT3JwaGFuZWQpIHRyYW5zaXRpb25lZEpvYi5vcnBoYW5lZEF0TXMgPSBub3dcbiAgICBpZiAoc2hvdWxkUmV0cnkpIHtcbiAgICAgIHRyYW5zaXRpb25lZEpvYi5wcmlvcml0eSA9IFJFVFJZX0JBQ0tHUk9VTkRfSk9CX1BSSU9SSVRZXG4gICAgICB0cmFuc2l0aW9uZWRKb2Iuc2NoZWR1bGVkQXRNcyA9IHNjaGVkdWxlZEF0XG4gICAgfSBlbHNlIGlmICghbWFya09ycGhhbmVkKSB7XG4gICAgICB0cmFuc2l0aW9uZWRKb2IuZmFpbGVkQXRNcyA9IG5vd1xuICAgIH1cblxuICAgIHJldHVybiB0cmFuc2l0aW9uZWRKb2JcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGZhaWx1cmUgdXBkYXRlLlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIE9wdGlvbnMuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBhcmdzLmZhaWx1cmVNZXNzYWdlIC0gTGFzdCBmYWlsdXJlIG1lc3NhZ2UuXG4gICAqIEBwYXJhbSB7Ym9vbGVhbn0gYXJncy5tYXJrT3JwaGFuZWQgLSBXaGV0aGVyIG1hcmtpbmcgb3JwaGFuZWQuXG4gICAqIEBwYXJhbSB7bnVtYmVyfSBhcmdzLm5leHRBdHRlbXB0IC0gTmV4dCBhdHRlbXB0IGNvdW50LlxuICAgKiBAcGFyYW0ge251bWJlcn0gYXJncy5ub3cgLSBDdXJyZW50IHRpbWVzdGFtcC5cbiAgICogQHBhcmFtIHtudW1iZXIgfCBudWxsfSBhcmdzLnNjaGVkdWxlZEF0IC0gTmV4dCBzY2hlZHVsZWQgdGltZXN0YW1wLlxuICAgKiBAcGFyYW0ge2Jvb2xlYW59IGFyZ3Muc2hvdWxkUmV0cnkgLSBXaGV0aGVyIHRoZSBqb2Igc2hvdWxkIHJldHJ5LlxuICAgKiBAcmV0dXJucyB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSAtIERhdGFiYXNlIHVwZGF0ZSBkYXRhLlxuICAgKi9cbiAgX2ZhaWx1cmVVcGRhdGUoe2ZhaWx1cmVNZXNzYWdlLCBtYXJrT3JwaGFuZWQsIG5leHRBdHRlbXB0LCBub3csIHNjaGVkdWxlZEF0LCBzaG91bGRSZXRyeX0pIHtcbiAgICAvKipcbiAgICAgKiBVcGRhdGUuXG4gICAgICogQHR5cGUge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gKi9cbiAgICBjb25zdCB1cGRhdGUgPSB7XG4gICAgICBhdHRlbXB0czogbmV4dEF0dGVtcHQsXG4gICAgICBoYW5kZWRfb2ZmX2F0X21zOiBudWxsLFxuICAgICAgd29ya2VyX2lkOiBudWxsLFxuICAgICAgbGFzdF9lcnJvcjogZmFpbHVyZU1lc3NhZ2VcbiAgICB9XG5cbiAgICAvLyBBIHJldHJ5IHN0YXJ0cyBhIGZyZXNoIGhhbmRvZmYgd2l0aCBhIHBvc3NpYmx5IGRpZmZlcmVudCBydW5uZXIsIHNvIHRoZVxuICAgIC8vIHByZXZpb3VzIGNoaWxkJ3MgYWNjZXB0YW5jZSBldmlkZW5jZSBtdXN0IG5vdCBsZWFrIGludG8gdGhlIG5leHQgYXR0ZW1wdC5cbiAgICAvLyBUZXJtaW5hbCBmYWlsdXJlcyBrZWVwIGl0IGFzIGhpc3RvcmljYWwgZXZpZGVuY2UgZm9yIHRoZSBsb3N0IGF0dGVtcHQuXG4gICAgaWYgKHNob3VsZFJldHJ5KSB7XG4gICAgICBPYmplY3QuYXNzaWduKHVwZGF0ZSwgdGhpcy5fY2xlYXJlZENoaWxkQWNjZXB0YW5jZURhdGEoKSlcblxuICAgICAgLy8gUmV0cmllZCB3b3JrIGdvZXMgdG8gdGhlIGJhY2sgb2YgdGhlIGRpc3BhdGNoIG9yZGVyLiBJdCBoYXMgYWxyZWFkeSBoYWRcbiAgICAgIC8vIGEgdHVybiwgYW5kIGxldHRpbmcgaXQgb3ZlcnRha2UgZmlyc3QgYXR0ZW1wdHMgaXMgaG93IGEgZmFpbGluZyBwcm9kdWNlclxuICAgICAgLy8gc3RhcnZlcyBoZWFsdGh5IGpvYnMgb2YgdGhlIHNhbWUgcXVldWUuXG4gICAgICB1cGRhdGUucHJpb3JpdHkgPSBSRVRSWV9CQUNLR1JPVU5EX0pPQl9QUklPUklUWVxuICAgIH1cblxuICAgIHRoaXMuX2FwcGx5T3JwaGFuZWRGYWlsdXJlVXBkYXRlKHttYXJrT3JwaGFuZWQsIG5vdywgdXBkYXRlfSlcbiAgICB0aGlzLl9hcHBseUZhaWx1cmVTdGF0dXNVcGRhdGUoe21hcmtPcnBoYW5lZCwgbm93LCBzY2hlZHVsZWRBdCwgc2hvdWxkUmV0cnksIHVwZGF0ZX0pXG5cbiAgICByZXR1cm4gdXBkYXRlXG4gIH1cblxuICAvKipcbiAgICogUnVucyBhcHBseSBvcnBoYW5lZCBmYWlsdXJlIHVwZGF0ZS5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBPcHRpb25zLlxuICAgKiBAcGFyYW0ge2Jvb2xlYW59IGFyZ3MubWFya09ycGhhbmVkIC0gV2hldGhlciBtYXJraW5nIG9ycGhhbmVkLlxuICAgKiBAcGFyYW0ge251bWJlcn0gYXJncy5ub3cgLSBDdXJyZW50IHRpbWVzdGFtcC5cbiAgICogQHBhcmFtIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59IGFyZ3MudXBkYXRlIC0gRGF0YWJhc2UgdXBkYXRlIGRhdGEuXG4gICAqIEByZXR1cm5zIHt2b2lkfVxuICAgKi9cbiAgX2FwcGx5T3JwaGFuZWRGYWlsdXJlVXBkYXRlKHttYXJrT3JwaGFuZWQsIG5vdywgdXBkYXRlfSkge1xuICAgIGlmIChtYXJrT3JwaGFuZWQpIHVwZGF0ZS5vcnBoYW5lZF9hdF9tcyA9IG5vd1xuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgYXBwbHkgZmFpbHVyZSBzdGF0dXMgdXBkYXRlLlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIE9wdGlvbnMuXG4gICAqIEBwYXJhbSB7Ym9vbGVhbn0gYXJncy5tYXJrT3JwaGFuZWQgLSBXaGV0aGVyIG1hcmtpbmcgb3JwaGFuZWQuXG4gICAqIEBwYXJhbSB7bnVtYmVyfSBhcmdzLm5vdyAtIEN1cnJlbnQgdGltZXN0YW1wLlxuICAgKiBAcGFyYW0ge251bWJlciB8IG51bGx9IGFyZ3Muc2NoZWR1bGVkQXQgLSBOZXh0IHNjaGVkdWxlZCB0aW1lc3RhbXAuXG4gICAqIEBwYXJhbSB7Ym9vbGVhbn0gYXJncy5zaG91bGRSZXRyeSAtIFdoZXRoZXIgdGhlIGpvYiBzaG91bGQgcmV0cnkuXG4gICAqIEBwYXJhbSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSBhcmdzLnVwZGF0ZSAtIERhdGFiYXNlIHVwZGF0ZSBkYXRhLlxuICAgKiBAcmV0dXJucyB7dm9pZH1cbiAgICovXG4gIF9hcHBseUZhaWx1cmVTdGF0dXNVcGRhdGUoe21hcmtPcnBoYW5lZCwgbm93LCBzY2hlZHVsZWRBdCwgc2hvdWxkUmV0cnksIHVwZGF0ZX0pIHtcbiAgICBpZiAoc2hvdWxkUmV0cnkpIHtcbiAgICAgIHVwZGF0ZS5zdGF0dXMgPSBcInF1ZXVlZFwiXG4gICAgICB1cGRhdGUuc2NoZWR1bGVkX2F0X21zID0gc2NoZWR1bGVkQXRcbiAgICAgIHJldHVyblxuICAgIH1cblxuICAgIGlmIChtYXJrT3JwaGFuZWQpIHtcbiAgICAgIHVwZGF0ZS5zdGF0dXMgPSBcIm9ycGhhbmVkXCJcbiAgICAgIHJldHVyblxuICAgIH1cblxuICAgIHVwZGF0ZS5zdGF0dXMgPSBcImZhaWxlZFwiXG4gICAgdXBkYXRlLmZhaWxlZF9hdF9tcyA9IG5vd1xuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgbm9ybWFsaXplIGpvYiByb3cuXG4gICAqIEBwYXJhbSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSByb3cgLSBSYXcgZGF0YWJhc2Ugcm93LlxuICAgKiBAcmV0dXJucyB7aW1wb3J0KFwiLi90eXBlcy5qc1wiKS5CYWNrZ3JvdW5kSm9iUm93fSAtIE5vcm1hbGl6ZWQgam9iIHJvdy5cbiAgICovXG4gIF9ub3JtYWxpemVKb2JSb3cocm93KSB7XG4gICAgY29uc3QgaGFuZG9mZklkID0gcm93LmhhbmRvZmZfaWQgPyBTdHJpbmcocm93LmhhbmRvZmZfaWQpIDogbnVsbFxuICAgIC8vIGBleGVjdXRpb25fbW9kZWAgaXMgdGhlIHNpbmdsZSBzb3VyY2Ugb2YgdHJ1dGggZm9yIGEgam9iJ3MgcnVudGltZSBhbmQgaXNcbiAgICAvLyB3cml0dGVuIG9uIGV2ZXJ5IGVucXVldWU7IHRoZSBkcm9wLWZvcmtlZCBtaWdyYXRpb24gYmFja2ZpbGxzIGFueSBwcmUtZXhpc3RpbmdcbiAgICAvLyByb3dzIGJlZm9yZSB0aGUgbGVnYWN5IGBmb3JrZWRgIGNvbHVtbiBpcyByZW1vdmVkLlxuICAgIGNvbnN0IGV4ZWN1dGlvbk1vZGUgPSByb3cuZXhlY3V0aW9uX21vZGUgPyB0aGlzLl9ub3JtYWxpemVFeGVjdXRpb25Nb2RlTmFtZShTdHJpbmcocm93LmV4ZWN1dGlvbl9tb2RlKSkgOiBERUZBVUxUX0JBQ0tHUk9VTkRfSk9CX0VYRUNVVElPTl9NT0RFXG5cbiAgICByZXR1cm4ge1xuICAgICAgaWQ6IFN0cmluZyhyb3cuaWQpLFxuICAgICAgam9iTmFtZTogU3RyaW5nKHJvdy5qb2JfbmFtZSksXG4gICAgICBhcmdzOiB0aGlzLl9wYXJzZUFyZ3Mocm93LmFyZ3NfanNvbiksXG4gICAgICBleGVjdXRpb25Nb2RlLFxuICAgICAgcXVldWU6IHJvdy5xdWV1ZSA/IFN0cmluZyhyb3cucXVldWUpIDogREVGQVVMVF9CQUNLR1JPVU5EX0pPQl9RVUVVRSxcbiAgICAgIHNjaGVkdWxlS2V5OiByb3cuc2NoZWR1bGVfa2V5ID8gU3RyaW5nKHJvdy5zY2hlZHVsZV9rZXkpIDogbnVsbCxcbiAgICAgIHNjaGVkdWxlT3JkZXI6IHRoaXMuX25vcm1hbGl6ZU51bWJlcihyb3cuc2NoZWR1bGVfb3JkZXIpLFxuICAgICAgc3RhdHVzOiBub3JtYWxpemVCYWNrZ3JvdW5kSm9iU3RhdHVzKHJvdy5zdGF0dXMgPyBTdHJpbmcocm93LnN0YXR1cykgOiBcInF1ZXVlZFwiKSxcbiAgICAgIGF0dGVtcHRzOiB0aGlzLl9ub3JtYWxpemVOdW1iZXIocm93LmF0dGVtcHRzKSxcbiAgICAgIG1heFJldHJpZXM6IHRoaXMuX25vcm1hbGl6ZU51bWJlcihyb3cubWF4X3JldHJpZXMpLFxuICAgICAgcHJpb3JpdHk6IHRoaXMuX25vcm1hbGl6ZU51bWJlcihyb3cucHJpb3JpdHkpID8/IERFRkFVTFRfQkFDS0dST1VORF9KT0JfUFJJT1JJVFksXG4gICAgICBzY2hlZHVsZWRBdE1zOiB0aGlzLl9ub3JtYWxpemVOdW1iZXIocm93LnNjaGVkdWxlZF9hdF9tcyksXG4gICAgICBjcmVhdGVkQXRNczogdGhpcy5fbm9ybWFsaXplTnVtYmVyKHJvdy5jcmVhdGVkX2F0X21zKSxcbiAgICAgIGhhbmRlZE9mZkF0TXM6IHRoaXMuX25vcm1hbGl6ZU51bWJlcihyb3cuaGFuZGVkX29mZl9hdF9tcyksXG4gICAgICBoYW5kb2ZmSWQsXG4gICAgICBjb21wbGV0ZWRBdE1zOiB0aGlzLl9ub3JtYWxpemVOdW1iZXIocm93LmNvbXBsZXRlZF9hdF9tcyksXG4gICAgICBmYWlsZWRBdE1zOiB0aGlzLl9ub3JtYWxpemVOdW1iZXIocm93LmZhaWxlZF9hdF9tcyksXG4gICAgICBvcnBoYW5lZEF0TXM6IHRoaXMuX25vcm1hbGl6ZU51bWJlcihyb3cub3JwaGFuZWRfYXRfbXMpLFxuICAgICAgd29ya2VySWQ6IHJvdy53b3JrZXJfaWQgPyBTdHJpbmcocm93Lndvcmtlcl9pZCkgOiBudWxsLFxuICAgICAgbGFzdEVycm9yOiByb3cubGFzdF9lcnJvciA/IFN0cmluZyhyb3cubGFzdF9lcnJvcikgOiBudWxsLFxuICAgICAgY29uY3VycmVuY3lLZXk6IHJvdy5jb25jdXJyZW5jeV9rZXkgPyBTdHJpbmcocm93LmNvbmN1cnJlbmN5X2tleSkgOiBudWxsLFxuICAgICAgbWF4Q29uY3VycmVuY3k6IHRoaXMuX25vcm1hbGl6ZU51bWJlcihyb3cubWF4X2NvbmN1cnJlbmN5KSxcbiAgICAgIHRpbWVvdXRNczogdGhpcy5fbm9ybWFsaXplTnVtYmVyKHJvdy50aW1lb3V0X21zKSxcbiAgICAgIGNoaWxkUmVjZWl2ZWRBdE1zOiB0aGlzLl9ub3JtYWxpemVOdW1iZXIocm93LmNoaWxkX3JlY2VpdmVkX2F0X21zKSxcbiAgICAgIGNoaWxkU3RhcnRlZEF0TXM6IHRoaXMuX25vcm1hbGl6ZU51bWJlcihyb3cuY2hpbGRfc3RhcnRlZF9hdF9tcyksXG4gICAgICBjaGlsZEluc3RhbmNlSWQ6IHJvdy5jaGlsZF9pbnN0YW5jZV9pZCA/IFN0cmluZyhyb3cuY2hpbGRfaW5zdGFuY2VfaWQpIDogbnVsbCxcbiAgICAgIGNoaWxkUGlkOiB0aGlzLl9ub3JtYWxpemVOdW1iZXIocm93LmNoaWxkX3BpZCksXG4gICAgICBydW5uZXJIb3N0bmFtZTogcm93LnJ1bm5lcl9ob3N0bmFtZSA/IFN0cmluZyhyb3cucnVubmVyX2hvc3RuYW1lKSA6IG51bGxcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogTm9ybWFsaXplcyBhIGpvYidzIHF1ZXVlIG5hbWUsIGRlZmF1bHRpbmcgdG8gXCJkZWZhdWx0XCIuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi90eXBlcy5qc1wiKS5CYWNrZ3JvdW5kSm9iT3B0aW9ucyB8IHVuZGVmaW5lZH0gb3B0aW9ucyAtIEpvYiBvcHRpb25zLlxuICAgKiBAcmV0dXJucyB7c3RyaW5nfSAtIFF1ZXVlIG5hbWUuXG4gICAqL1xuICBfbm9ybWFsaXplUXVldWUob3B0aW9ucykge1xuICAgIHJldHVybiBub3JtYWxpemVCYWNrZ3JvdW5kSm9iUXVldWUob3B0aW9ucylcbiAgfVxuXG4gIC8qKlxuICAgKiBSZXNvbHZlcyBhIGpvYidzIGR1cmFibGUgY29uY3VycmVuY3kuIEFuIGV4cGxpY2l0IGNvbmN1cnJlbmN5S2V5L21heENvbmN1cnJlbmN5XG4gICAqIHBhaXIgYWx3YXlzIHdpbnMuIE90aGVyd2lzZSwgd2hlbiB0aGUgam9iJ3MgcXVldWUgaGFzIGEgY29uZmlndXJlZCBjYXBcbiAgICogKGBiYWNrZ3JvdW5kSm9icy5xdWV1ZXNbcXVldWVdLm1heENvbmN1cnJlbnRgKSwgZGVyaXZlIGEgcXVldWUtc2NvcGVkXG4gICAqIGNvbmN1cnJlbmN5IGtleSBzbyB0aGUgcXVldWUgY2FwIGlzIGVuZm9yY2VkIGNsdXN0ZXItd2lkZSB0aHJvdWdoIHRoZVxuICAgKiBleGlzdGluZyBkdXJhYmxlIGNvbmN1cnJlbmN5IG1lY2hhbmlzbS5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL3R5cGVzLmpzXCIpLkJhY2tncm91bmRKb2JPcHRpb25zIHwgdW5kZWZpbmVkfSBvcHRpb25zIC0gSm9iIG9wdGlvbnMuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBxdWV1ZSAtIE5vcm1hbGl6ZWQgcXVldWUgbmFtZS5cbiAgICogQHJldHVybnMge3tjb25jdXJyZW5jeUtleTogc3RyaW5nLCBtYXhDb25jdXJyZW5jeTogbnVtYmVyLCBxdWV1ZURlcml2ZWQ6IGJvb2xlYW59IHwgbnVsbH0gLSBSZXNvbHZlZCBjb25jdXJyZW5jeS5cbiAgICovXG4gIF9yZXNvbHZlQ29uY3VycmVuY3kob3B0aW9ucywgcXVldWUpIHtcbiAgICByZXR1cm4gbm9ybWFsaXplQmFja2dyb3VuZEpvYkNvbmN1cnJlbmN5KHtcbiAgICAgIG9wdGlvbnM6IG9wdGlvbnMgfHwge30sXG4gICAgICBxdWV1ZSxcbiAgICAgIHF1ZXVlczogdGhpcy5jb25maWd1cmF0aW9uLmdldEJhY2tncm91bmRKb2JzQ29uZmlnKCkucXVldWVzXG4gICAgfSlcbiAgfVxuXG4gIC8qKlxuICAgKiBBcHBsaWVzIHRoZSBhY3RpdmUgZ2VuZXJhdGlvbidzIHF1ZXVlIHBvbGljeSBpbW1lZGlhdGVseSBiZWZvcmUgaGFuZG9mZi5cbiAgICogRXhwbGljaXQgY29uY3VycmVuY3kgcmVtYWlucyBvd25lZCBieSB0aGUgZW5xdWV1ZSByZXF1ZXN0LlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL2RhdGFiYXNlL2RyaXZlcnMvYmFzZS5qc1wiKS5kZWZhdWx0fSBkYiAtIERhdGFiYXNlIGNvbm5lY3Rpb24uXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi90eXBlcy5qc1wiKS5CYWNrZ3JvdW5kSm9iUm93fSBqb2IgLSBRdWV1ZWQgam9iIHNuYXBzaG90LlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxpbXBvcnQoXCIuL3R5cGVzLmpzXCIpLkJhY2tncm91bmRKb2JSb3cgfCBudWxsPn0gLSBSZWNvbmNpbGVkIGpvYiwgb3IgbnVsbCB3aGVuIGl0cyBxdWV1ZWQtc3RhdGUgZmVuY2UgbG9zdC5cbiAgICovXG4gIGFzeW5jIF9yZWNvbmNpbGVRdWV1ZWRKb2JDb25jdXJyZW5jeShkYiwgam9iKSB7XG4gICAgaWYgKGpvYi5jb25jdXJyZW5jeUtleSAmJiAham9iLmNvbmN1cnJlbmN5S2V5LnN0YXJ0c1dpdGgoUVVFVUVfQ09OQ1VSUkVOQ1lfS0VZX1BSRUZJWCkpIHtcbiAgICAgIHJldHVybiBqb2JcbiAgICB9XG5cbiAgICBjb25zdCBjb25jdXJyZW5jeSA9IHRoaXMuX3Jlc29sdmVDb25jdXJyZW5jeSh7fSwgam9iLnF1ZXVlKVxuICAgIC8qKiBAdHlwZSB7QmFja2dyb3VuZEpvYlF1ZXVlZENvbmN1cnJlbmN5fSAqL1xuICAgIGNvbnN0IGN1cnJlbnQgPSBjb25jdXJyZW5jeVxuICAgICAgPyB7Y29uY3VycmVuY3lLZXk6IGNvbmN1cnJlbmN5LmNvbmN1cnJlbmN5S2V5LCBtYXhDb25jdXJyZW5jeTogY29uY3VycmVuY3kubWF4Q29uY3VycmVuY3l9XG4gICAgICA6IHtjb25jdXJyZW5jeUtleTogbnVsbCwgbWF4Q29uY3VycmVuY3k6IG51bGx9XG5cbiAgICBpZiAoY29uY3VycmVuY3kpIGF3YWl0IHRoaXMuX2Vuc3VyZVF1ZXVlQ29uY3VycmVuY3lLZXkoZGIsIGNvbmN1cnJlbmN5KVxuICAgIGlmIChqb2IuY29uY3VycmVuY3lLZXkgPT09IGN1cnJlbnQuY29uY3VycmVuY3lLZXkgJiYgam9iLm1heENvbmN1cnJlbmN5ID09PSBjdXJyZW50Lm1heENvbmN1cnJlbmN5KSByZXR1cm4gam9iXG5cbiAgICBjb25zdCBhZmZlY3RlZFJvd3MgPSBhd2FpdCB0aGlzLl91cGRhdGVBZmZlY3RlZFJvd3MoZGIsIHtcbiAgICAgIHRhYmxlTmFtZTogSk9CU19UQUJMRSxcbiAgICAgIGRhdGE6IHtcbiAgICAgICAgY29uY3VycmVuY3lfa2V5OiBjdXJyZW50LmNvbmN1cnJlbmN5S2V5LFxuICAgICAgICBtYXhfY29uY3VycmVuY3k6IGN1cnJlbnQubWF4Q29uY3VycmVuY3lcbiAgICAgIH0sXG4gICAgICBjb25kaXRpb25zOiB7Y29uY3VycmVuY3lfa2V5OiBqb2IuY29uY3VycmVuY3lLZXksIGlkOiBqb2IuaWQsIHN0YXR1czogXCJxdWV1ZWRcIn1cbiAgICB9KVxuXG4gICAgaWYgKGFmZmVjdGVkUm93cyAhPT0gMSkgcmV0dXJuIG51bGxcblxuICAgIHJldHVybiB7Li4uam9iLCBjb25jdXJyZW5jeUtleTogY3VycmVudC5jb25jdXJyZW5jeUtleSwgbWF4Q29uY3VycmVuY3k6IGN1cnJlbnQubWF4Q29uY3VycmVuY3l9XG4gIH1cblxuICAvKipcbiAgICogUmVhZHMgdGhlIGNvbmZpZ3VyZWQgbWF4IGNvbmN1cnJlbmN5IGZvciBhIHF1ZXVlIGZyb20gdGhlIGJhY2tncm91bmQtam9icyBjb25maWcuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBxdWV1ZSAtIFF1ZXVlIG5hbWUuXG4gICAqIEByZXR1cm5zIHtudW1iZXIgfCBudWxsfSAtIFBvc2l0aXZlIGludGVnZXIgY2FwLCBvciBudWxsIHdoZW4gdGhlIHF1ZXVlIGhhcyBubyBjb25maWd1cmVkIGNhcC5cbiAgICovXG4gIF9xdWV1ZU1heENvbmN1cnJlbmN5KHF1ZXVlKSB7XG4gICAgY29uc3QgcXVldWVzID0gdGhpcy5jb25maWd1cmF0aW9uLmdldEJhY2tncm91bmRKb2JzQ29uZmlnKCkucXVldWVzXG4gICAgY29uc3QgY2FwID0gcXVldWVzPy5bcXVldWVdPy5tYXhDb25jdXJyZW50XG5cbiAgICBpZiAoTnVtYmVyLmlzSW50ZWdlcihjYXApICYmIE51bWJlcihjYXApID4gMCkgcmV0dXJuIE51bWJlcihjYXApXG5cbiAgICByZXR1cm4gbnVsbFxuICB9XG5cbiAgLyoqXG4gICAqIExpa2Uge0BsaW5rIF9lbnN1cmVDb25jdXJyZW5jeUtleX0sIGJ1dCBmb3IgcXVldWUtZGVyaXZlZCBrZXlzIHRoZSBjb25maWd1cmVkXG4gICAqIHF1ZXVlIGNhcCBpcyB0aGUgc291cmNlIG9mIHRydXRoOiBpZiBpdCBjaGFuZ2VkLCB1cGRhdGUgdGhlIHN0b3JlZCBjYXBcbiAgICogaW5zdGVhZCBvZiB0aHJvd2luZyBvbiBjb25mbGljdCAoY29uZmlnLWRyaXZlbiBjYXBzIG11c3QgYmUgdHVuYWJsZSkuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vZGF0YWJhc2UvZHJpdmVycy9iYXNlLmpzXCIpLmRlZmF1bHR9IGRiIC0gRGF0YWJhc2UgY29ubmVjdGlvbi5cbiAgICogQHBhcmFtIHt7Y29uY3VycmVuY3lLZXk6IHN0cmluZywgbWF4Q29uY3VycmVuY3k6IG51bWJlcn19IGNvbmN1cnJlbmN5IC0gQ29uY3VycmVuY3kgY29uZmlndXJhdGlvbi5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgd2hlbiBlbnN1cmVkLlxuICAgKi9cbiAgYXN5bmMgX2Vuc3VyZVF1ZXVlQ29uY3VycmVuY3lLZXkoZGIsIHtjb25jdXJyZW5jeUtleSwgbWF4Q29uY3VycmVuY3l9KSB7XG4gICAgY29uc3Qgcm93cyA9IGF3YWl0IGRiLm5ld1F1ZXJ5KCkuZnJvbShDT05DVVJSRU5DWV9UQUJMRSkud2hlcmUoe2NvbmN1cnJlbmN5X2tleTogY29uY3VycmVuY3lLZXl9KS5saW1pdCgxKS5yZXN1bHRzKClcblxuICAgIGlmICghcm93c1swXSkge1xuICAgICAgdHJ5IHtcbiAgICAgICAgYXdhaXQgZGIuaW5zZXJ0KHt0YWJsZU5hbWU6IENPTkNVUlJFTkNZX1RBQkxFLCBkYXRhOiB7YWN0aXZlX2NvdW50OiAwLCBjb25jdXJyZW5jeV9rZXk6IGNvbmN1cnJlbmN5S2V5LCBtYXhfY29uY3VycmVuY3k6IG1heENvbmN1cnJlbmN5fX0pXG5cbiAgICAgICAgcmV0dXJuXG4gICAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgICBjb25zdCByYWNlZFJvd3MgPSBhd2FpdCBkYi5uZXdRdWVyeSgpLmZyb20oQ09OQ1VSUkVOQ1lfVEFCTEUpLndoZXJlKHtjb25jdXJyZW5jeV9rZXk6IGNvbmN1cnJlbmN5S2V5fSkubGltaXQoMSkucmVzdWx0cygpXG5cbiAgICAgICAgaWYgKCFyYWNlZFJvd3NbMF0pIHRocm93IGVycm9yXG5cbiAgICAgICAgcm93c1swXSA9IHJhY2VkUm93c1swXVxuICAgICAgfVxuICAgIH1cblxuICAgIGNvbnN0IGNvbmZpZ3VyZWQgPSAvKiogQHR5cGUge3ttYXhfY29uY3VycmVuY3k/OiBudW1iZXIgfCBzdHJpbmd9fSAqLyAocm93c1swXSlcblxuICAgIGlmICh0aGlzLl9ub3JtYWxpemVOdW1iZXIoY29uZmlndXJlZC5tYXhfY29uY3VycmVuY3kpICE9PSBtYXhDb25jdXJyZW5jeSkge1xuICAgICAgY29uc3QgdGFibGUgPSBkYi5xdW90ZVRhYmxlKENPTkNVUlJFTkNZX1RBQkxFKVxuXG4gICAgICBhd2FpdCBkYi5xdWVyeShgVVBEQVRFICR7dGFibGV9IFNFVCAke2RiLnF1b3RlQ29sdW1uKFwibWF4X2NvbmN1cnJlbmN5XCIpfSA9ICR7TnVtYmVyKG1heENvbmN1cnJlbmN5KX0gV0hFUkUgJHtkYi5xdW90ZUNvbHVtbihcImNvbmN1cnJlbmN5X2tleVwiKX0gPSAke2RiLnF1b3RlKGNvbmN1cnJlbmN5S2V5KX1gKVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBFbnN1cmVzIHRoZSBjb25jdXJyZW5jeSBzdGF0ZSB0YWJsZSBleGlzdHMuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vZGF0YWJhc2UvZHJpdmVycy9iYXNlLmpzXCIpLmRlZmF1bHR9IGRiIC0gRGF0YWJhc2UgY29ubmVjdGlvbi5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgd2hlbiByZWFkeS5cbiAgICovXG4gIGFzeW5jIF9lbnN1cmVDb25jdXJyZW5jeVRhYmxlKGRiKSB7XG4gICAgaWYgKGF3YWl0IGRiLnRhYmxlRXhpc3RzKENPTkNVUlJFTkNZX1RBQkxFKSkgcmV0dXJuXG4gICAgY29uc3QgdGFibGUgPSBuZXcgVGFibGVEYXRhKENPTkNVUlJFTkNZX1RBQkxFLCB7aWZOb3RFeGlzdHM6IHRydWV9KVxuICAgIHRhYmxlLnN0cmluZyhcImNvbmN1cnJlbmN5X2tleVwiLCB7cHJpbWFyeUtleTogdHJ1ZX0pXG4gICAgdGFibGUuaW50ZWdlcihcIm1heF9jb25jdXJyZW5jeVwiLCB7bnVsbDogZmFsc2V9KVxuICAgIHRhYmxlLmludGVnZXIoXCJhY3RpdmVfY291bnRcIiwge251bGw6IGZhbHNlfSlcbiAgICBhd2FpdCBkYi5jcmVhdGVUYWJsZSh0YWJsZSlcbiAgfVxuXG4gIC8qKlxuICAgKiBFbnN1cmVzIHRoZSBzdGFibGUgc2NoZWR1bGUta2V5IG93bmVyc2hpcCB0YWJsZSBleGlzdHMuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vZGF0YWJhc2UvZHJpdmVycy9iYXNlLmpzXCIpLmRlZmF1bHR9IGRiIC0gRGF0YWJhc2UgY29ubmVjdGlvbi5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgd2hlbiByZWFkeS5cbiAgICovXG4gIGFzeW5jIF9lbnN1cmVTY2hlZHVsZUtleXNUYWJsZShkYikge1xuICAgIGlmIChhd2FpdCBkYi50YWJsZUV4aXN0cyhTQ0hFRFVMRV9LRVlTX1RBQkxFKSkgcmV0dXJuXG5cbiAgICBjb25zdCBsb2NrTmFtZSA9IGAke01JR1JBVElPTl9TQ09QRX06c2NoZWR1bGVfa2V5c190YWJsZWBcbiAgICBjb25zdCBhY3F1aXJlZCA9IGF3YWl0IGRiLmFjcXVpcmVBZHZpc29yeUxvY2sobG9ja05hbWUpXG5cbiAgICBpZiAoIWFjcXVpcmVkKSB0aHJvdyBuZXcgRXJyb3IoXCJGYWlsZWQgdG8gYWNxdWlyZSBiYWNrZ3JvdW5kIGpvYnMgc2NoZWR1bGUta2V5IHRhYmxlIHNjaGVtYSBsb2NrXCIpXG5cbiAgICB0cnkge1xuICAgICAgZGIuY2xlYXJTY2hlbWFDYWNoZSgpXG4gICAgICBpZiAoYXdhaXQgZGIudGFibGVFeGlzdHMoU0NIRURVTEVfS0VZU19UQUJMRSkpIHJldHVyblxuXG4gICAgICBjb25zdCB0YWJsZSA9IG5ldyBUYWJsZURhdGEoU0NIRURVTEVfS0VZU19UQUJMRSwge2lmTm90RXhpc3RzOiB0cnVlfSlcblxuICAgICAgdGFibGUuc3RyaW5nKFwic2NoZWR1bGVfa2V5XCIsIHtwcmltYXJ5S2V5OiB0cnVlfSlcbiAgICAgIHRhYmxlLnN0cmluZyhcImpvYl9pZFwiLCB7bnVsbDogZmFsc2UsIGluZGV4OiB0cnVlfSlcbiAgICAgIGF3YWl0IGRiLmNyZWF0ZVRhYmxlKHRhYmxlKVxuICAgICAgZGIuY2xlYXJTY2hlbWFDYWNoZSgpXG4gICAgfSBmaW5hbGx5IHtcbiAgICAgIGF3YWl0IGRiLnJlbGVhc2VBZHZpc29yeUxvY2sobG9ja05hbWUpXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIEVuc3VyZXMgZHVyYWJsZSBnZW5lcmljIGVucXVldWUgb3duZXJzaGlwIGV4aXN0cyBpbmRlcGVuZGVudGx5IG9mIGpvYiByb3dzLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL2RhdGFiYXNlL2RyaXZlcnMvYmFzZS5qc1wiKS5kZWZhdWx0fSBkYiAtIERhdGFiYXNlIGNvbm5lY3Rpb24uXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIHdoZW4gcmVhZHkuXG4gICAqL1xuICBhc3luYyBfZW5zdXJlSWRlbXBvdGVuY3lLZXlzVGFibGUoZGIpIHtcbiAgICBpZiAoYXdhaXQgZGIudGFibGVFeGlzdHMoSURFTVBPVEVOQ1lfS0VZU19UQUJMRSkpIHJldHVyblxuXG4gICAgY29uc3QgbG9ja05hbWUgPSBgJHtNSUdSQVRJT05fU0NPUEV9OmlkZW1wb3RlbmN5X2tleXNfdGFibGVgXG4gICAgY29uc3QgYWNxdWlyZWQgPSBhd2FpdCBkYi5hY3F1aXJlQWR2aXNvcnlMb2NrKGxvY2tOYW1lKVxuXG4gICAgaWYgKCFhY3F1aXJlZCkgdGhyb3cgbmV3IEVycm9yKFwiRmFpbGVkIHRvIGFjcXVpcmUgYmFja2dyb3VuZCBqb2IgaWRlbXBvdGVuY3kta2V5IHRhYmxlIHNjaGVtYSBsb2NrXCIpXG5cbiAgICB0cnkge1xuICAgICAgZGIuY2xlYXJTY2hlbWFDYWNoZSgpXG4gICAgICBpZiAoYXdhaXQgZGIudGFibGVFeGlzdHMoSURFTVBPVEVOQ1lfS0VZU19UQUJMRSkpIHJldHVyblxuXG4gICAgICBjb25zdCB0YWJsZSA9IG5ldyBUYWJsZURhdGEoSURFTVBPVEVOQ1lfS0VZU19UQUJMRSwge2lmTm90RXhpc3RzOiB0cnVlfSlcblxuICAgICAgdGFibGUuc3RyaW5nKFwic2NvcGVfZGlnZXN0XCIsIHtwcmltYXJ5S2V5OiB0cnVlfSlcbiAgICAgIHRhYmxlLnN0cmluZyhcImpvYl9uYW1lXCIsIHtudWxsOiBmYWxzZX0pXG4gICAgICB0YWJsZS5zdHJpbmcoXCJxdWV1ZVwiLCB7bnVsbDogZmFsc2V9KVxuICAgICAgdGFibGUudGV4dChcImlkZW1wb3RlbmN5X2tleVwiLCB7bnVsbDogZmFsc2V9KVxuICAgICAgdGFibGUuc3RyaW5nKFwiam9iX2lkXCIsIHtpbmRleDogdHJ1ZSwgbnVsbDogZmFsc2V9KVxuICAgICAgdGFibGUuc3RyaW5nKFwicmVxdWVzdF9kaWdlc3RcIiwge251bGw6IGZhbHNlfSlcbiAgICAgIHRhYmxlLmJpZ2ludChcImNyZWF0ZWRfYXRfbXNcIiwge251bGw6IGZhbHNlfSlcbiAgICAgIGF3YWl0IGRiLmNyZWF0ZVRhYmxlKHRhYmxlKVxuICAgICAgZGIuY2xlYXJTY2hlbWFDYWNoZSgpXG4gICAgfSBmaW5hbGx5IHtcbiAgICAgIGF3YWl0IGRiLnJlbGVhc2VBZHZpc29yeUxvY2sobG9ja05hbWUpXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIEVuc3VyZXMgZHVyYWJsZSBwcm92aWRlci1iYWNrZWQgbWFpbCBvcGVyYXRpb24gc3RhdGUgZXhpc3RzIGluZGVwZW5kZW50bHkgb2Ygam9icy5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9kYXRhYmFzZS9kcml2ZXJzL2Jhc2UuanNcIikuZGVmYXVsdH0gZGIgLSBEYXRhYmFzZSBjb25uZWN0aW9uLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyB3aGVuIHJlYWR5LlxuICAgKi9cbiAgYXN5bmMgX2Vuc3VyZU1haWxEZWxpdmVyeU9wZXJhdGlvbnNUYWJsZShkYikge1xuICAgIGlmIChhd2FpdCBkYi50YWJsZUV4aXN0cyhNQUlMX0RFTElWRVJZX09QRVJBVElPTlNfVEFCTEUpKSByZXR1cm5cblxuICAgIGNvbnN0IGxvY2tOYW1lID0gYCR7TUlHUkFUSU9OX1NDT1BFfTptYWlsX2RlbGl2ZXJ5X29wZXJhdGlvbnNfdGFibGVgXG4gICAgY29uc3QgYWNxdWlyZWQgPSBhd2FpdCBkYi5hY3F1aXJlQWR2aXNvcnlMb2NrKGxvY2tOYW1lKVxuXG4gICAgaWYgKCFhY3F1aXJlZCkgdGhyb3cgbmV3IEVycm9yKFwiRmFpbGVkIHRvIGFjcXVpcmUgbWFpbCBkZWxpdmVyeSBvcGVyYXRpb24gdGFibGUgc2NoZW1hIGxvY2tcIilcblxuICAgIHRyeSB7XG4gICAgICBkYi5jbGVhclNjaGVtYUNhY2hlKClcbiAgICAgIGlmIChhd2FpdCBkYi50YWJsZUV4aXN0cyhNQUlMX0RFTElWRVJZX09QRVJBVElPTlNfVEFCTEUpKSByZXR1cm5cblxuICAgICAgY29uc3QgdGFibGUgPSBuZXcgVGFibGVEYXRhKE1BSUxfREVMSVZFUllfT1BFUkFUSU9OU19UQUJMRSwge2lmTm90RXhpc3RzOiB0cnVlfSlcblxuICAgICAgdGFibGUuc3RyaW5nKFwib3BlcmF0aW9uX2tleVwiLCB7cHJpbWFyeUtleTogdHJ1ZX0pXG4gICAgICB0YWJsZS50ZXh0KFwib3BlcmF0aW9uX2lkXCIsIHtudWxsOiBmYWxzZX0pXG4gICAgICB0YWJsZS5zdHJpbmcoXCJwYXlsb2FkX2RpZ2VzdFwiLCB7bnVsbDogZmFsc2V9KVxuICAgICAgdGFibGUuc3RyaW5nKFwiYmFja2dyb3VuZF9qb2JfaWRcIiwge2luZGV4OiB0cnVlLCBudWxsOiBmYWxzZX0pXG4gICAgICB0YWJsZS5iaWdpbnQoXCJmaXJzdF9hdHRlbXB0X3N0YXJ0ZWRfYXRfbXNcIiwge251bGw6IHRydWV9KVxuICAgICAgdGFibGUuc3RyaW5nKFwicHJvdmlkZXJfa2luZFwiLCB7bnVsbDogZmFsc2V9KVxuICAgICAgdGFibGUuYmlnaW50KFwicHJvdmlkZXJfcmV0ZW50aW9uX21zXCIsIHtudWxsOiBmYWxzZX0pXG4gICAgICB0YWJsZS5iaWdpbnQoXCJjcmVhdGVkX2F0X21zXCIsIHtudWxsOiBmYWxzZX0pXG4gICAgICBhd2FpdCBkYi5jcmVhdGVUYWJsZSh0YWJsZSlcbiAgICAgIGRiLmNsZWFyU2NoZW1hQ2FjaGUoKVxuICAgIH0gZmluYWxseSB7XG4gICAgICBhd2FpdCBkYi5yZWxlYXNlQWR2aXNvcnlMb2NrKGxvY2tOYW1lKVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBFbnN1cmVzIHRoZSBzaW5nbGV0b24gZHVyYWJsZSBjb3VudC1yZXZpc2lvbiByb3cgZXhpc3RzLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL2RhdGFiYXNlL2RyaXZlcnMvYmFzZS5qc1wiKS5kZWZhdWx0fSBkYiAtIERhdGFiYXNlIGNvbm5lY3Rpb24uXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSBSZXNvbHZlcyB3aGVuIHJlYWR5LlxuICAgKi9cbiAgYXN5bmMgX2Vuc3VyZUNvdW50UmV2aXNpb25UYWJsZShkYikge1xuICAgIGlmICghKGF3YWl0IGRiLnRhYmxlRXhpc3RzKENPVU5UU19SRVZJU0lPTl9UQUJMRSkpKSB7XG4gICAgICBjb25zdCB0YWJsZSA9IG5ldyBUYWJsZURhdGEoQ09VTlRTX1JFVklTSU9OX1RBQkxFLCB7aWZOb3RFeGlzdHM6IHRydWV9KVxuXG4gICAgICB0YWJsZS5zdHJpbmcoXCJrZXlcIiwge3ByaW1hcnlLZXk6IHRydWV9KVxuICAgICAgdGFibGUuYmlnaW50KFwicmV2aXNpb25cIiwge251bGw6IGZhbHNlfSlcbiAgICAgIGF3YWl0IGRiLmNyZWF0ZVRhYmxlKHRhYmxlKVxuICAgIH1cblxuICAgIGNvbnN0IHJvd3MgPSBhd2FpdCBkYi5uZXdRdWVyeSgpLmZyb20oQ09VTlRTX1JFVklTSU9OX1RBQkxFKS53aGVyZSh7a2V5OiBDT1VOVFNfUkVWSVNJT05fS0VZfSkubGltaXQoMSkucmVzdWx0cygpXG5cbiAgICBpZiAocm93cy5sZW5ndGggPiAwKSByZXR1cm5cblxuICAgIHRyeSB7XG4gICAgICBhd2FpdCBkYi5pbnNlcnQoe3RhYmxlTmFtZTogQ09VTlRTX1JFVklTSU9OX1RBQkxFLCBkYXRhOiB7a2V5OiBDT1VOVFNfUkVWSVNJT05fS0VZLCByZXZpc2lvbjogMH19KVxuICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICBjb25zdCByYWNlZFJvd3MgPSBhd2FpdCBkYi5uZXdRdWVyeSgpLmZyb20oQ09VTlRTX1JFVklTSU9OX1RBQkxFKS53aGVyZSh7a2V5OiBDT1VOVFNfUkVWSVNJT05fS0VZfSkubGltaXQoMSkucmVzdWx0cygpXG5cbiAgICAgIGlmIChyYWNlZFJvd3MubGVuZ3RoID09PSAwKSB0aHJvdyBlcnJvclxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBSZWNvcmRzIG9uZSBsb2dpY2FsIGNvdW50IG11dGF0aW9uIGF0b21pY2FsbHkgYW5kIGJyb2FkY2FzdHMgaXQgYWZ0ZXIgY29tbWl0LlxuICAgKiBaZXJvIGVudHJpZXMgYXJlIG9taXR0ZWQ7IGEgd2hvbGx5IHplcm8tbmV0IG11dGF0aW9uIGRvZXMgbm90IGNvbnN1bWUgYSByZXZpc2lvbi5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9kYXRhYmFzZS9kcml2ZXJzL2Jhc2UuanNcIikuZGVmYXVsdH0gZGIgLSBUcmFuc2FjdGlvbiBjb25uZWN0aW9uLlxuICAgKiBAcGFyYW0ge1JlY29yZDxzdHJpbmcsIG51bWJlcj59IHJlcXVlc3RlZERlbHRhcyAtIFNpZ25lZCBidWNrZXQgY2hhbmdlcy5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IFJlc29sdmVzIHdoZW4gcmVjb3JkZWQuXG4gICAqL1xuICBhc3luYyBfcmVjb3JkQ291bnREZWx0YShkYiwgcmVxdWVzdGVkRGVsdGFzKSB7XG4gICAgLyoqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBudW1iZXI+fSAqL1xuICAgIGNvbnN0IGRlbHRhcyA9IHt9XG5cbiAgICBmb3IgKGNvbnN0IGJ1Y2tldCBvZiBCQUNLR1JPVU5EX0pPQl9DT1VOVF9CVUNLRVRTKSB7XG4gICAgICBjb25zdCBhbW91bnQgPSByZXF1ZXN0ZWREZWx0YXNbYnVja2V0XSB8fCAwXG5cbiAgICAgIGlmICghTnVtYmVyLmlzSW50ZWdlcihhbW91bnQpKSB0aHJvdyBuZXcgRXJyb3IoYEludmFsaWQgYmFja2dyb3VuZCBqb2IgY291bnQgZGVsdGEgZm9yICR7YnVja2V0fTogJHthbW91bnR9YClcbiAgICAgIGlmIChhbW91bnQgIT09IDApIGRlbHRhc1tidWNrZXRdID0gYW1vdW50XG4gICAgfVxuXG4gICAgaWYgKE9iamVjdC5rZXlzKGRlbHRhcykubGVuZ3RoID09PSAwKSByZXR1cm5cblxuICAgIGNvbnN0IHRhYmxlID0gZGIucXVvdGVUYWJsZShDT1VOVFNfUkVWSVNJT05fVEFCTEUpXG4gICAgY29uc3QgcmV2aXNpb25Db2x1bW4gPSBkYi5xdW90ZUNvbHVtbihcInJldmlzaW9uXCIpXG4gICAgY29uc3QgYWZmZWN0ZWRSb3dzID0gYXdhaXQgZGIuYWZmZWN0ZWRSb3dzKFxuICAgICAgYFVQREFURSAke3RhYmxlfSBTRVQgJHtyZXZpc2lvbkNvbHVtbn0gPSAke3JldmlzaW9uQ29sdW1ufSArIDEgV0hFUkUgJHtkYi5xdW90ZUNvbHVtbihcImtleVwiKX0gPSAke2RiLnF1b3RlKENPVU5UU19SRVZJU0lPTl9LRVkpfWBcbiAgICApXG5cbiAgICBpZiAoYWZmZWN0ZWRSb3dzICE9PSAxKSB0aHJvdyBuZXcgRXJyb3IoXCJCYWNrZ3JvdW5kIGpvYiBjb3VudCByZXZpc2lvbiByb3cgaXMgbWlzc2luZ1wiKVxuXG4gICAgY29uc3QgcmV2aXNpb24gPSBhd2FpdCB0aGlzLl9jb3VudFJldmlzaW9uKGRiKVxuICAgIGNvbnN0IGJvZHkgPSB7ZGVsdGFzLCByZXZpc2lvbiwgdHlwZTogXCJiYWNrZ3JvdW5kLWpvYi1jb3VudC1kZWx0YVwifVxuICAgIGNvbnN0IGRhdGFiYXNlSWRlbnRpZmllciA9IHRoaXMuZ2V0RGF0YWJhc2VJZGVudGlmaWVyKCkgfHwgXCJkZWZhdWx0XCJcblxuICAgIGF3YWl0IGRiLmFmdGVyQ29tbWl0KCgpID0+IHtcbiAgICAgIHRoaXMuY29uZmlndXJhdGlvbi5icm9hZGNhc3RUb0NoYW5uZWwoQkFDS0dST1VORF9KT0JfQ09VTlRTX0NIQU5ORUwsIHtkYXRhYmFzZUlkZW50aWZpZXJ9LCBib2R5KVxuICAgIH0pXG4gIH1cblxuICAvKipcbiAgICogUmVjb3JkcyBhIHRyYW5zaXRpb24gYmV0d2VlbiBwZXJzaXN0ZWQgc3RhdHVzZXMuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vZGF0YWJhc2UvZHJpdmVycy9iYXNlLmpzXCIpLmRlZmF1bHR9IGRiIC0gVHJhbnNhY3Rpb24gY29ubmVjdGlvbi5cbiAgICogQHBhcmFtIHtzdHJpbmd9IG9sZFN0YXR1cyAtIFByZXZpb3VzIHN0YXR1cy5cbiAgICogQHBhcmFtIHtzdHJpbmd9IG5ld1N0YXR1cyAtIE5ldyBzdGF0dXMuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSBSZXNvbHZlcyB3aGVuIHJlY29yZGVkLlxuICAgKi9cbiAgYXN5bmMgX3JlY29yZFN0YXR1c1RyYW5zaXRpb24oZGIsIG9sZFN0YXR1cywgbmV3U3RhdHVzKSB7XG4gICAgY29uc3Qgb2xkQ291bnRlZCA9IENPVU5URURfSk9CX1NUQVRVU0VTLmluY2x1ZGVzKG9sZFN0YXR1cylcbiAgICBjb25zdCBuZXdDb3VudGVkID0gQ09VTlRFRF9KT0JfU1RBVFVTRVMuaW5jbHVkZXMobmV3U3RhdHVzKVxuXG4gICAgaWYgKCFvbGRDb3VudGVkICYmIG9sZFN0YXR1cyAhPT0gXCJjYW5jZWxsZWRcIikgdGhyb3cgbmV3IEVycm9yKGBVbmtub3duIHByZXZpb3VzIGJhY2tncm91bmQgam9iIHN0YXR1czogJHtvbGRTdGF0dXN9YClcbiAgICBpZiAoIW5ld0NvdW50ZWQgJiYgbmV3U3RhdHVzICE9PSBcImNhbmNlbGxlZFwiKSB0aHJvdyBuZXcgRXJyb3IoYFVua25vd24gbmV4dCBiYWNrZ3JvdW5kIGpvYiBzdGF0dXM6ICR7bmV3U3RhdHVzfWApXG4gICAgaWYgKG9sZFN0YXR1cyA9PT0gbmV3U3RhdHVzKSByZXR1cm5cblxuICAgIC8qKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgbnVtYmVyPn0gKi9cbiAgICBjb25zdCBkZWx0YXMgPSB7fVxuXG4gICAgaWYgKG9sZENvdW50ZWQpIGRlbHRhc1tvbGRTdGF0dXNdID0gLTFcbiAgICBpZiAobmV3Q291bnRlZCkgZGVsdGFzW25ld1N0YXR1c10gPSAxXG4gICAgaWYgKG9sZENvdW50ZWQgIT09IG5ld0NvdW50ZWQpIGRlbHRhcy5hbGwgPSBuZXdDb3VudGVkID8gMSA6IC0xXG4gICAgYXdhaXQgdGhpcy5fcmVjb3JkQ291bnREZWx0YShkYiwgZGVsdGFzKVxuICB9XG5cbiAgLyoqXG4gICAqIFJlYWRzIHRoZSBsb2NrZWQgcmV2aXNpb24uXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vZGF0YWJhc2UvZHJpdmVycy9iYXNlLmpzXCIpLmRlZmF1bHR9IGRiIC0gRGF0YWJhc2UgY29ubmVjdGlvbi5cbiAgICogQHJldHVybnMge1Byb21pc2U8bnVtYmVyPn0gUmV2aXNpb24uXG4gICAqL1xuICBhc3luYyBfY291bnRSZXZpc2lvbihkYikge1xuICAgIGNvbnN0IHJvd3MgPSBhd2FpdCBkYi5uZXdRdWVyeSgpLmZyb20oQ09VTlRTX1JFVklTSU9OX1RBQkxFKS5zZWxlY3QoXCJyZXZpc2lvblwiKS53aGVyZSh7a2V5OiBDT1VOVFNfUkVWSVNJT05fS0VZfSkubGltaXQoMSkucmVzdWx0cygpXG4gICAgY29uc3QgcmV2aXNpb24gPSB0aGlzLl9ub3JtYWxpemVOdW1iZXIoLyoqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59ICovIChyb3dzWzBdIHx8IHt9KS5yZXZpc2lvbilcblxuICAgIGlmIChyZXZpc2lvbiA9PT0gbnVsbCB8fCAhTnVtYmVyLmlzU2FmZUludGVnZXIocmV2aXNpb24pIHx8IHJldmlzaW9uIDwgMCkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKGBJbnZhbGlkIGJhY2tncm91bmQgam9iIGNvdW50IHJldmlzaW9uOiAke3JldmlzaW9ufWApXG4gICAgfVxuXG4gICAgcmV0dXJuIHJldmlzaW9uXG4gIH1cblxuICAvKipcbiAgICogVGFrZXMgYSBwb3J0YWJsZSB3cml0ZSBsb2NrIG9uIHRoZSBzaW5nbGV0b24gcmV2aXNpb24gcm93LlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL2RhdGFiYXNlL2RyaXZlcnMvYmFzZS5qc1wiKS5kZWZhdWx0fSBkYiAtIERhdGFiYXNlIGNvbm5lY3Rpb24uXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSBSZXNvbHZlcyB3aGVuIGxvY2tlZC5cbiAgICovXG4gIGFzeW5jIF9sb2NrQ291bnRSZXZpc2lvbihkYikge1xuICAgIGNvbnN0IHRhYmxlID0gZGIucXVvdGVUYWJsZShDT1VOVFNfUkVWSVNJT05fVEFCTEUpXG4gICAgY29uc3QgcmV2aXNpb24gPSBkYi5xdW90ZUNvbHVtbihcInJldmlzaW9uXCIpXG5cbiAgICBhd2FpdCBkYi5xdWVyeShgVVBEQVRFICR7dGFibGV9IFNFVCAke3JldmlzaW9ufSA9ICR7cmV2aXNpb259IFdIRVJFICR7ZGIucXVvdGVDb2x1bW4oXCJrZXlcIil9ID0gJHtkYi5xdW90ZShDT1VOVFNfUkVWSVNJT05fS0VZKX1gKVxuICB9XG5cbiAgLyoqXG4gICAqIEJ1aWxkcyB6ZXJvZWQgY2Fub25pY2FsIGJ1Y2tldHMuXG4gICAqIEByZXR1cm5zIHtSZWNvcmQ8c3RyaW5nLCBudW1iZXI+fSBaZXJvZWQgY2Fub25pY2FsIGJ1Y2tldHMuXG4gICAqL1xuICBfZW1wdHlDb3VudEJ1Y2tldHMoKSB7XG4gICAgcmV0dXJuIE9iamVjdC5mcm9tRW50cmllcyhCQUNLR1JPVU5EX0pPQl9DT1VOVF9CVUNLRVRTLm1hcCgoYnVja2V0KSA9PiBbYnVja2V0LCAwXSkpXG4gIH1cblxuICAvKipcbiAgICogQ291bnRzIG5vcm1hbGl6ZWQgcm93cyBieSBjYW5vbmljYWwgc3RhdHVzLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vdHlwZXMuanNcIikuQmFja2dyb3VuZEpvYlJvd1tdfSBqb2JzIC0gSm9icy5cbiAgICogQHJldHVybnMge1JlY29yZDxzdHJpbmcsIG51bWJlcj59IENvdW50cy5cbiAgICovXG4gIF9zdGF0dXNDb3VudHMoam9icykge1xuICAgIC8qKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgbnVtYmVyPn0gKi9cbiAgICBjb25zdCBjb3VudHMgPSB7fVxuXG4gICAgZm9yIChjb25zdCBqb2Igb2Ygam9icykge1xuICAgICAgaWYgKCFDT1VOVEVEX0pPQl9TVEFUVVNFUy5pbmNsdWRlcyhqb2Iuc3RhdHVzKSkgdGhyb3cgbmV3IEVycm9yKGBVbmtub3duIGJhY2tncm91bmQgam9iIHN0YXR1czogJHtqb2Iuc3RhdHVzfWApXG4gICAgICBjb3VudHNbam9iLnN0YXR1c10gPSAoY291bnRzW2pvYi5zdGF0dXNdIHx8IDApICsgMVxuICAgIH1cblxuICAgIHJldHVybiBjb3VudHNcbiAgfVxuXG4gIC8qKlxuICAgKiBSZWFkcyBhIGNhbm9uaWNhbCBzbmFwc2hvdCBhZnRlciBsb2NraW5nIHRoZSByZXZpc2lvbiByb3cuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vZGF0YWJhc2UvZHJpdmVycy9iYXNlLmpzXCIpLmRlZmF1bHR9IGRiIC0gVHJhbnNhY3Rpb24gY29ubmVjdGlvbi5cbiAgICogQHJldHVybnMge1Byb21pc2U8e2NvdW50czogUmVjb3JkPHN0cmluZywgbnVtYmVyPiwgcmV2aXNpb246IG51bWJlciwgdG90YWw6IG51bWJlcn0+fSBTbmFwc2hvdC5cbiAgICovXG4gIGFzeW5jIF9jb3VudFNuYXBzaG90T25Mb2NrZWRDb25uZWN0aW9uKGRiKSB7XG4gICAgY29uc3Qgcm93cyA9IGF3YWl0IGRiLm5ld1F1ZXJ5KCkuZnJvbShKT0JTX1RBQkxFKS5zZWxlY3QoXCJzdGF0dXNcIikuc2VsZWN0KFwiQ09VTlQoKikgQVMgY291bnRcIikuZ3JvdXAoXCJzdGF0dXNcIikucmVzdWx0cygpXG4gICAgY29uc3QgY291bnRzID0gdGhpcy5fZW1wdHlDb3VudEJ1Y2tldHMoKVxuICAgIGxldCB0b3RhbCA9IDBcblxuICAgIGZvciAoY29uc3Qgcm93IG9mIHJvd3MpIHtcbiAgICAgIGNvbnN0IHR5cGVkUm93ID0gLyoqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59ICovIChyb3cpXG4gICAgICBjb25zdCBzdGF0dXMgPSBTdHJpbmcodHlwZWRSb3cuc3RhdHVzKVxuICAgICAgY29uc3QgY291bnQgPSB0aGlzLl9ub3JtYWxpemVOdW1iZXIodHlwZWRSb3cuY291bnQpIHx8IDBcblxuICAgICAgdG90YWwgKz0gY291bnRcblxuICAgICAgaWYgKCFDT1VOVEVEX0pPQl9TVEFUVVNFUy5pbmNsdWRlcyhzdGF0dXMpKSBjb250aW51ZVxuICAgICAgY291bnRzW3N0YXR1c10gPSBjb3VudFxuICAgICAgY291bnRzLmFsbCArPSBjb3VudHNbc3RhdHVzXVxuICAgIH1cblxuICAgIHJldHVybiB7Y291bnRzLCByZXZpc2lvbjogYXdhaXQgdGhpcy5fY291bnRSZXZpc2lvbihkYiksIHRvdGFsfVxuICB9XG5cbiAgLyoqXG4gICAqIFJlZ2lzdGVycyBvciB2ZXJpZmllcyBhIHN0YWJsZSBrZXkgY29uZmlndXJhdGlvbi5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9kYXRhYmFzZS9kcml2ZXJzL2Jhc2UuanNcIikuZGVmYXVsdH0gZGIgLSBEYXRhYmFzZSBjb25uZWN0aW9uLlxuICAgKiBAcGFyYW0ge29iamVjdH0gY29uY3VycmVuY3kgLSBDb25jdXJyZW5jeSBjb25maWd1cmF0aW9uLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gY29uY3VycmVuY3kuY29uY3VycmVuY3lLZXkgLSBDb25jdXJyZW5jeSBrZXkuXG4gICAqIEBwYXJhbSB7bnVtYmVyfSBjb25jdXJyZW5jeS5tYXhDb25jdXJyZW5jeSAtIFN0YWJsZSBjYXAuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIHdoZW4gdmVyaWZpZWQuXG4gICAqL1xuICBhc3luYyBfZW5zdXJlQ29uY3VycmVuY3lLZXkoZGIsIHtjb25jdXJyZW5jeUtleSwgbWF4Q29uY3VycmVuY3l9KSB7XG4gICAgY29uc3Qgcm93cyA9IGF3YWl0IGRiLm5ld1F1ZXJ5KCkuZnJvbShDT05DVVJSRU5DWV9UQUJMRSkud2hlcmUoe2NvbmN1cnJlbmN5X2tleTogY29uY3VycmVuY3lLZXl9KS5saW1pdCgxKS5yZXN1bHRzKClcbiAgICBpZiAoIXJvd3NbMF0pIHtcbiAgICAgIHRyeSB7XG4gICAgICAgIGF3YWl0IGRiLmluc2VydCh7dGFibGVOYW1lOiBDT05DVVJSRU5DWV9UQUJMRSwgZGF0YToge2FjdGl2ZV9jb3VudDogMCwgY29uY3VycmVuY3lfa2V5OiBjb25jdXJyZW5jeUtleSwgbWF4X2NvbmN1cnJlbmN5OiBtYXhDb25jdXJyZW5jeX19KVxuICAgICAgICByZXR1cm5cbiAgICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICAgIGNvbnN0IHJhY2VkUm93cyA9IGF3YWl0IGRiLm5ld1F1ZXJ5KCkuZnJvbShDT05DVVJSRU5DWV9UQUJMRSkud2hlcmUoe2NvbmN1cnJlbmN5X2tleTogY29uY3VycmVuY3lLZXl9KS5saW1pdCgxKS5yZXN1bHRzKClcbiAgICAgICAgaWYgKCFyYWNlZFJvd3NbMF0pIHRocm93IGVycm9yXG4gICAgICAgIHJvd3NbMF0gPSByYWNlZFJvd3NbMF1cbiAgICAgIH1cbiAgICB9XG4gICAgY29uc3QgY29uZmlndXJlZCA9IC8qKiBAdHlwZSB7e21heF9jb25jdXJyZW5jeT86IG51bWJlciB8IHN0cmluZ319ICovIChyb3dzWzBdKVxuICAgIGlmICh0aGlzLl9ub3JtYWxpemVOdW1iZXIoY29uZmlndXJlZC5tYXhfY29uY3VycmVuY3kpICE9PSBtYXhDb25jdXJyZW5jeSkgdGhyb3cgbmV3IEVycm9yKGBDb25mbGljdGluZyBtYXhDb25jdXJyZW5jeSBmb3IgYmFja2dyb3VuZCBqb2IgY29uY3VycmVuY3lLZXk6ICR7Y29uY3VycmVuY3lLZXl9YClcbiAgfVxuXG4gIC8qKlxuICAgKiBMb2NrcyB0aGUgY29uY3VycmVuY3kgY291bnRlciByb3cgc28gYSBqb2ItcmVsZWFzZSB0cmFuc2FjdGlvbiBhY3F1aXJlcyBpdCAqYmVmb3JlKiB0aGUgam9iXG4gICAqIHJvdy4ge0BsaW5rIG1hcmtIYW5kZWRPZmZ9IHJlc2VydmVzIGNhcGFjaXR5IChsb2NraW5nIHRoZSBjb3VudGVyIHJvdykgYmVmb3JlIGl0IHVwZGF0ZXMgdGhlXG4gICAqIGpvYiwgc28gaXQgbG9ja3MgY29uY3VycmVuY3ktdGhlbi1qb2I7IHRoZSByZWxlYXNlIHBhdGhzIHVwZGF0ZSB0aGUgam9iIGJlZm9yZSByZWxlYXNpbmdcbiAgICogY2FwYWNpdHksIHdoaWNoIGlzIGpvYi10aGVuLWNvbmN1cnJlbmN5LiBUaG9zZSBvcHBvc2l0ZSBvcmRlcnMgb24gdGhlIHNhbWUgc2hhcmVkIGNvdW50ZXIgcm93XG4gICAqIGFyZSB3aGF0IGRlYWRsb2NrIChBQi1CQSkgdW5kZXIgYSBkcmFpbmluZyB3b3JrZXIuIFRha2luZyB0aGlzIGxvY2sgZmlyc3QgZ2l2ZXMgZXZlcnlcbiAgICogdHJhbnNhY3Rpb24gYSBzaW5nbGUgY29uY3VycmVuY3ktdGhlbi1qb2Igb3JkZXIgYW5kIHJlbW92ZXMgdGhlIGN5Y2xlLlxuICAgKlxuICAgKiBVc2VzIGEgdmFsdWUtcHJlc2VydmluZyBgVVBEQVRFYCByYXRoZXIgdGhhbiBgU0VMRUNUIC4uLiBGT1IgVVBEQVRFYCBzbyBpdCBzdGF5cyBwb3J0YWJsZVxuICAgKiBhY3Jvc3MgZHJpdmVycyB3aXRob3V0IHJvdy1sZXZlbCBsb2NraW5nIHJlYWRzIChlLmcuIFNRTGl0ZSk7IG9uIHJvdy1sb2NraW5nIGVuZ2luZXMgdGhlXG4gICAqIG1hdGNoZWQgcm93IGlzIHdyaXRlLWxvY2tlZCBmb3IgdGhlIHJlc3Qgb2YgdGhlIHRyYW5zYWN0aW9uIGV2ZW4gdGhvdWdoIGl0cyB2YWx1ZSBpcyB1bmNoYW5nZWQuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vZGF0YWJhc2UvZHJpdmVycy9iYXNlLmpzXCIpLmRlZmF1bHR9IGRiIC0gRGF0YWJhc2UgY29ubmVjdGlvbi5cbiAgICogQHBhcmFtIHtzdHJpbmcgfCBudWxsfSBjb25jdXJyZW5jeUtleSAtIENvbmN1cnJlbmN5IGtleS5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgd2hlbiB0aGUgY291bnRlciByb3cgaXMgbG9ja2VkLlxuICAgKi9cbiAgYXN5bmMgX2xvY2tDb25jdXJyZW5jeVJvdyhkYiwgY29uY3VycmVuY3lLZXkpIHtcbiAgICBpZiAoIWNvbmN1cnJlbmN5S2V5KSByZXR1cm5cbiAgICBjb25zdCB0YWJsZSA9IGRiLnF1b3RlVGFibGUoQ09OQ1VSUkVOQ1lfVEFCTEUpXG4gICAgY29uc3QgY291bnQgPSBkYi5xdW90ZUNvbHVtbihcImFjdGl2ZV9jb3VudFwiKVxuICAgIGF3YWl0IGRiLnF1ZXJ5KGBVUERBVEUgJHt0YWJsZX0gU0VUICR7Y291bnR9ID0gJHtjb3VudH0gV0hFUkUgJHtkYi5xdW90ZUNvbHVtbihcImNvbmN1cnJlbmN5X2tleVwiKX0gPSAke2RiLnF1b3RlKGNvbmN1cnJlbmN5S2V5KX1gKVxuICB9XG5cbiAgLyoqXG4gICAqIEF0b21pY2FsbHkgcmVzZXJ2ZXMgY2FwYWNpdHkgZm9yIGEga2V5LlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL2RhdGFiYXNlL2RyaXZlcnMvYmFzZS5qc1wiKS5kZWZhdWx0fSBkYiAtIERhdGFiYXNlIGNvbm5lY3Rpb24uXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBjb25jdXJyZW5jeUtleSAtIENvbmN1cnJlbmN5IGtleS5cbiAgICogQHJldHVybnMge1Byb21pc2U8Ym9vbGVhbj59IC0gV2hldGhlciBjYXBhY2l0eSB3YXMgcmVzZXJ2ZWQuXG4gICAqL1xuICBhc3luYyBfcmVzZXJ2ZUNvbmN1cnJlbmN5KGRiLCBjb25jdXJyZW5jeUtleSkge1xuICAgIGNvbnN0IHRhYmxlID0gZGIucXVvdGVUYWJsZShDT05DVVJSRU5DWV9UQUJMRSlcbiAgICBjb25zdCBjb3VudCA9IGRiLnF1b3RlQ29sdW1uKFwiYWN0aXZlX2NvdW50XCIpXG4gICAgY29uc3QgYWZmZWN0ZWRSb3dzID0gYXdhaXQgZGIuYWZmZWN0ZWRSb3dzKGBVUERBVEUgJHt0YWJsZX0gU0VUICR7Y291bnR9ID0gJHtjb3VudH0gKyAxIFdIRVJFICR7ZGIucXVvdGVDb2x1bW4oXCJjb25jdXJyZW5jeV9rZXlcIil9ID0gJHtkYi5xdW90ZShjb25jdXJyZW5jeUtleSl9IEFORCAke2NvdW50fSA8ICR7ZGIucXVvdGVDb2x1bW4oXCJtYXhfY29uY3VycmVuY3lcIil9YClcbiAgICByZXR1cm4gYWZmZWN0ZWRSb3dzID09PSAxXG4gIH1cblxuICAvKipcbiAgICogUnVucyBhIHBvcnRhYmxlIHVwZGF0ZSBhbmQgcmV0dXJucyBpdHMgYWZmZWN0ZWQtcm93IGNvdW50LlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL2RhdGFiYXNlL2RyaXZlcnMvYmFzZS5qc1wiKS5kZWZhdWx0fSBkYiAtIERhdGFiYXNlIGNvbm5lY3Rpb24uXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vZGF0YWJhc2UvZHJpdmVycy9iYXNlLmpzXCIpLlVwZGF0ZVNxbEFyZ3NUeXBlfSBhcmdzIC0gVXBkYXRlIG9wdGlvbnMuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPG51bWJlcj59IC0gQWZmZWN0ZWQgcm93IGNvdW50LlxuICAgKi9cbiAgYXN5bmMgX3VwZGF0ZUFmZmVjdGVkUm93cyhkYiwgYXJncykge1xuICAgIHJldHVybiBhd2FpdCBkYi5hZmZlY3RlZFJvd3MoZGIudXBkYXRlU3FsKGFyZ3MpKVxuICB9XG5cbiAgLyoqXG4gICAqIFJlbGVhc2VzIGNhcGFjaXR5IGZvciBhIGtleS5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9kYXRhYmFzZS9kcml2ZXJzL2Jhc2UuanNcIikuZGVmYXVsdH0gZGIgLSBEYXRhYmFzZSBjb25uZWN0aW9uLlxuICAgKiBAcGFyYW0ge3N0cmluZyB8IG51bGx9IGNvbmN1cnJlbmN5S2V5IC0gQ29uY3VycmVuY3kga2V5LlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyB3aGVuIHJlbGVhc2VkLlxuICAgKi9cbiAgYXN5bmMgX3JlbGVhc2VDb25jdXJyZW5jeShkYiwgY29uY3VycmVuY3lLZXkpIHtcbiAgICBpZiAoIWNvbmN1cnJlbmN5S2V5KSByZXR1cm5cbiAgICBjb25zdCB0YWJsZSA9IGRiLnF1b3RlVGFibGUoQ09OQ1VSUkVOQ1lfVEFCTEUpXG4gICAgY29uc3QgY291bnQgPSBkYi5xdW90ZUNvbHVtbihcImFjdGl2ZV9jb3VudFwiKVxuICAgIGF3YWl0IGRiLnF1ZXJ5KGBVUERBVEUgJHt0YWJsZX0gU0VUICR7Y291bnR9ID0gJHtjb3VudH0gLSAxIFdIRVJFICR7ZGIucXVvdGVDb2x1bW4oXCJjb25jdXJyZW5jeV9rZXlcIil9ID0gJHtkYi5xdW90ZShjb25jdXJyZW5jeUtleSl9IEFORCAke2NvdW50fSA+IDBgKVxuICB9XG5cbiAgLyoqXG4gICAqIFJlYnVpbGRzIGR1cmFibGUgY291bnRzIGZyb20gYWN0aXZlIGhhbmRvZmZzLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL2RhdGFiYXNlL2RyaXZlcnMvYmFzZS5qc1wiKS5kZWZhdWx0fSBkYiAtIERhdGFiYXNlIGNvbm5lY3Rpb24uXG4gICAqIEBwYXJhbSB7e2luc2lkZVRyYW5zYWN0aW9uPzogYm9vbGVhbn19IFtvcHRpb25zXSAtIFJldXNlIGFuIGVuY2xvc2luZyB0cmFuc2FjdGlvbi5cbiAgICogQHJldHVybnMge1Byb21pc2U8aW1wb3J0KFwiLi90eXBlcy5qc1wiKS5CYWNrZ3JvdW5kSm9iQ29uY3VycmVuY3lSZWNvbmNpbGlhdGlvbj59IC0gUmVwYWlyIHN1bW1hcnkuXG4gICAqL1xuICBhc3luYyBfcmVjb25jaWxlQ29uY3VycmVuY3koZGIsIHtpbnNpZGVUcmFuc2FjdGlvbiA9IGZhbHNlfSA9IHt9KSB7XG4gICAgaWYgKCEoYXdhaXQgZGIudGFibGVFeGlzdHMoQ09OQ1VSUkVOQ1lfVEFCTEUpKSkge1xuICAgICAgcmV0dXJuIHtjYW5kaWRhdGVDb3VudDogMCwgY2hlY2tlZENvdW50OiAwLCByZXBhaXJlZENvdW50OiAwLCByZXBhaXJzOiBbXSwgcmVwYWlyc1RydW5jYXRlZENvdW50OiAwfVxuICAgIH1cblxuICAgIGNvbnN0IGFjdGl2ZVJvd3MgPSBhd2FpdCBkYlxuICAgICAgLm5ld1F1ZXJ5KClcbiAgICAgIC5mcm9tKEpPQlNfVEFCTEUpXG4gICAgICAuc2VsZWN0KFwiY29uY3VycmVuY3lfa2V5XCIpXG4gICAgICAuc2VsZWN0KFwiQ09VTlQoKikgQVMgYWN0aXZlX2NvdW50XCIpXG4gICAgICAud2hlcmUoe3N0YXR1czogXCJoYW5kZWRfb2ZmXCJ9KVxuICAgICAgLndoZXJlKGAke2RiLnF1b3RlQ29sdW1uKFwiY29uY3VycmVuY3lfa2V5XCIpfSBJUyBOT1QgTlVMTGApXG4gICAgICAuZ3JvdXAoXCJjb25jdXJyZW5jeV9rZXlcIilcbiAgICAgIC5yZXN1bHRzKClcbiAgICBjb25zdCBzdGFsZVJvd3MgPSBhd2FpdCBkYlxuICAgICAgLm5ld1F1ZXJ5KClcbiAgICAgIC5mcm9tKENPTkNVUlJFTkNZX1RBQkxFKVxuICAgICAgLnNlbGVjdChcImNvbmN1cnJlbmN5X2tleVwiKVxuICAgICAgLnNlbGVjdChcImFjdGl2ZV9jb3VudFwiKVxuICAgICAgLndoZXJlKGAke2RiLnF1b3RlQ29sdW1uKFwiYWN0aXZlX2NvdW50XCIpfSAhPSAwYClcbiAgICAgIC5yZXN1bHRzKClcbiAgICAvKiogQHR5cGUge01hcDxzdHJpbmcsIG51bWJlcj59ICovXG4gICAgY29uc3QgYWN0aXZlQ291bnRzID0gbmV3IE1hcCgpXG4gICAgLyoqIEB0eXBlIHtNYXA8c3RyaW5nLCBudW1iZXI+fSAqL1xuICAgIGNvbnN0IHBlcnNpc3RlZENvdW50cyA9IG5ldyBNYXAoKVxuXG4gICAgZm9yIChjb25zdCByYXdSb3cgb2YgYWN0aXZlUm93cykge1xuICAgICAgY29uc3Qgcm93ID0gLyoqIEB0eXBlIHtCYWNrZ3JvdW5kSm9iQ29uY3VycmVuY3lDb3VudFJvd30gKi8gKHJhd1JvdylcbiAgICAgIGFjdGl2ZUNvdW50cy5zZXQocm93LmNvbmN1cnJlbmN5X2tleSwgdGhpcy5fdmFsaWRhdGVkQ29uY3VycmVuY3lDb3VudChyb3cuYWN0aXZlX2NvdW50LCByb3cuY29uY3VycmVuY3lfa2V5KSlcbiAgICB9XG5cbiAgICBmb3IgKGNvbnN0IHJhd1JvdyBvZiBzdGFsZVJvd3MpIHtcbiAgICAgIGNvbnN0IHJvdyA9IC8qKiBAdHlwZSB7QmFja2dyb3VuZEpvYkNvbmN1cnJlbmN5Q291bnRSb3d9ICovIChyYXdSb3cpXG4gICAgICBwZXJzaXN0ZWRDb3VudHMuc2V0KHJvdy5jb25jdXJyZW5jeV9rZXksIHRoaXMuX3ZhbGlkYXRlZENvbmN1cnJlbmN5Q291bnQocm93LmFjdGl2ZV9jb3VudCwgcm93LmNvbmN1cnJlbmN5X2tleSkpXG4gICAgfVxuXG4gICAgY29uc3QgY29uY3VycmVuY3lLZXlzID0gWy4uLm5ldyBTZXQoWy4uLmFjdGl2ZUNvdW50cy5rZXlzKCksIC4uLnBlcnNpc3RlZENvdW50cy5rZXlzKCldKV0uc29ydCgpXG4gICAgY29uc3QgY2FuZGlkYXRlS2V5cyA9IGNvbmN1cnJlbmN5S2V5cy5maWx0ZXIoKGNvbmN1cnJlbmN5S2V5KSA9PiB7XG4gICAgICByZXR1cm4gKGFjdGl2ZUNvdW50cy5nZXQoY29uY3VycmVuY3lLZXkpIHx8IDApICE9PSAocGVyc2lzdGVkQ291bnRzLmdldChjb25jdXJyZW5jeUtleSkgfHwgMClcbiAgICB9KVxuICAgIC8qKiBAdHlwZSB7aW1wb3J0KFwiLi90eXBlcy5qc1wiKS5CYWNrZ3JvdW5kSm9iQ29uY3VycmVuY3lSZXBhaXJbXX0gKi9cbiAgICBjb25zdCByZXBhaXJzID0gW11cbiAgICBsZXQgcmVwYWlyZWRDb3VudCA9IDBcblxuICAgIGZvciAoY29uc3QgY29uY3VycmVuY3lLZXkgb2YgY2FuZGlkYXRlS2V5cykge1xuICAgICAgY29uc3QgcmVwYWlyID0gaW5zaWRlVHJhbnNhY3Rpb25cbiAgICAgICAgPyBhd2FpdCB0aGlzLl9yZWNvbmNpbGVDb25jdXJyZW5jeUtleShkYiwgY29uY3VycmVuY3lLZXkpXG4gICAgICAgIDogYXdhaXQgdGhpcy5fdHJhbnNhY3Rpb25SZXN1bHQoZGIsIGFzeW5jICgpID0+IGF3YWl0IHRoaXMuX3JlY29uY2lsZUNvbmN1cnJlbmN5S2V5KGRiLCBjb25jdXJyZW5jeUtleSkpXG5cbiAgICAgIGlmICghcmVwYWlyKSBjb250aW51ZVxuXG4gICAgICByZXBhaXJlZENvdW50KytcbiAgICAgIGlmIChyZXBhaXJzLmxlbmd0aCA8IENPTkNVUlJFTkNZX1JFUEFJUl9TQU1QTEVfTElNSVQpIHJlcGFpcnMucHVzaChyZXBhaXIpXG4gICAgfVxuXG4gICAgcmV0dXJuIHtcbiAgICAgIGNhbmRpZGF0ZUNvdW50OiBjYW5kaWRhdGVLZXlzLmxlbmd0aCxcbiAgICAgIGNoZWNrZWRDb3VudDogY29uY3VycmVuY3lLZXlzLmxlbmd0aCxcbiAgICAgIHJlcGFpcmVkQ291bnQsXG4gICAgICByZXBhaXJzLFxuICAgICAgcmVwYWlyc1RydW5jYXRlZENvdW50OiByZXBhaXJlZENvdW50IC0gcmVwYWlycy5sZW5ndGhcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogUmVidWlsZHMgb25lIGNvdW50ZXIgYWZ0ZXIgbG9ja2luZyBpdCBhaGVhZCBvZiB0aGUgam9iIHJvd3MsIG1hdGNoaW5nIHRoZVxuICAgKiBsb2NrIG9yZGVyIHVzZWQgYnkgaGFuZG9mZiBhbmQgY29tcGxldGlvbiB0cmFuc2l0aW9ucy5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9kYXRhYmFzZS9kcml2ZXJzL2Jhc2UuanNcIikuZGVmYXVsdH0gZGIgLSBEYXRhYmFzZSBjb25uZWN0aW9uLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gY29uY3VycmVuY3lLZXkgLSBDb3VudGVyIGtleS5cbiAgICogQHJldHVybnMge1Byb21pc2U8aW1wb3J0KFwiLi90eXBlcy5qc1wiKS5CYWNrZ3JvdW5kSm9iQ29uY3VycmVuY3lSZXBhaXIgfCBudWxsPn0gLSBBcHBsaWVkIHJlcGFpci5cbiAgICovXG4gIGFzeW5jIF9yZWNvbmNpbGVDb25jdXJyZW5jeUtleShkYiwgY29uY3VycmVuY3lLZXkpIHtcbiAgICBhd2FpdCB0aGlzLl9sb2NrQ29uY3VycmVuY3lSb3coZGIsIGNvbmN1cnJlbmN5S2V5KVxuICAgIGNvbnN0IHBlcnNpc3RlZFJvd3MgPSBhd2FpdCBkYlxuICAgICAgLm5ld1F1ZXJ5KClcbiAgICAgIC5mcm9tKENPTkNVUlJFTkNZX1RBQkxFKVxuICAgICAgLnNlbGVjdChcImFjdGl2ZV9jb3VudFwiKVxuICAgICAgLnNlbGVjdChcImNvbmN1cnJlbmN5X2tleVwiKVxuICAgICAgLndoZXJlKHtjb25jdXJyZW5jeV9rZXk6IGNvbmN1cnJlbmN5S2V5fSlcbiAgICAgIC5saW1pdCgxKVxuICAgICAgLnJlc3VsdHMoKVxuXG4gICAgaWYgKCFwZXJzaXN0ZWRSb3dzWzBdKSB0aHJvdyBuZXcgRXJyb3IoYE1pc3NpbmcgYmFja2dyb3VuZCBqb2IgY29uY3VycmVuY3kgY291bnRlciBmb3IgJHtjb25jdXJyZW5jeUtleX1gKVxuXG4gICAgY29uc3QgcGVyc2lzdGVkUm93ID0gLyoqIEB0eXBlIHtCYWNrZ3JvdW5kSm9iQ29uY3VycmVuY3lDb3VudFJvd30gKi8gKHBlcnNpc3RlZFJvd3NbMF0pXG4gICAgY29uc3QgcHJldmlvdXNBY3RpdmVDb3VudCA9IHRoaXMuX3ZhbGlkYXRlZENvbmN1cnJlbmN5Q291bnQocGVyc2lzdGVkUm93LmFjdGl2ZV9jb3VudCwgY29uY3VycmVuY3lLZXkpXG4gICAgY29uc3Qgcm93cyA9IGF3YWl0IGRiXG4gICAgICAubmV3UXVlcnkoKVxuICAgICAgLmZyb20oSk9CU19UQUJMRSlcbiAgICAgIC5zZWxlY3QoXCJDT1VOVCgqKSBBUyBhY3RpdmVfY291bnRcIilcbiAgICAgIC53aGVyZSh7Y29uY3VycmVuY3lfa2V5OiBjb25jdXJyZW5jeUtleSwgc3RhdHVzOiBcImhhbmRlZF9vZmZcIn0pXG4gICAgICAucmVzdWx0cygpXG4gICAgY29uc3QgY291bnRSb3cgPSAvKiogQHR5cGUge3thY3RpdmVfY291bnQ6IG51bWJlciB8IHN0cmluZ319ICovIChyb3dzWzBdKVxuICAgIGNvbnN0IGFjdGl2ZUNvdW50ID0gdGhpcy5fdmFsaWRhdGVkQ29uY3VycmVuY3lDb3VudChjb3VudFJvdy5hY3RpdmVfY291bnQsIGNvbmN1cnJlbmN5S2V5KVxuXG4gICAgaWYgKGFjdGl2ZUNvdW50ID09PSBwcmV2aW91c0FjdGl2ZUNvdW50KSByZXR1cm4gbnVsbFxuXG4gICAgYXdhaXQgZGIudXBkYXRlKHtcbiAgICAgIHRhYmxlTmFtZTogQ09OQ1VSUkVOQ1lfVEFCTEUsXG4gICAgICBkYXRhOiB7YWN0aXZlX2NvdW50OiBhY3RpdmVDb3VudH0sXG4gICAgICBjb25kaXRpb25zOiB7Y29uY3VycmVuY3lfa2V5OiBjb25jdXJyZW5jeUtleX1cbiAgICB9KVxuXG4gICAgcmV0dXJuIHthY3RpdmVDb3VudCwgY29uY3VycmVuY3lLZXksIHByZXZpb3VzQWN0aXZlQ291bnR9XG4gIH1cblxuICAvKipcbiAgICogVmFsaWRhdGVzIGEgZGF0YWJhc2UgY291bnQgYmVmb3JlIGl0IHBhcnRpY2lwYXRlcyBpbiByZWNvbmNpbGlhdGlvbi5cbiAgICogQHBhcmFtIHtudW1iZXIgfCBzdHJpbmd9IHZhbHVlIC0gUmF3IGNvdW50LlxuICAgKiBAcGFyYW0ge3N0cmluZ30gY29uY3VycmVuY3lLZXkgLSBDb3VudGVyIGtleSBmb3IgZGlhZ25vc3RpY3MuXG4gICAqIEByZXR1cm5zIHtudW1iZXJ9IC0gU2FmZSBub24tbmVnYXRpdmUgY291bnQuXG4gICAqL1xuICBfdmFsaWRhdGVkQ29uY3VycmVuY3lDb3VudCh2YWx1ZSwgY29uY3VycmVuY3lLZXkpIHtcbiAgICBjb25zdCBjb3VudCA9IHRoaXMuX25vcm1hbGl6ZU51bWJlcih2YWx1ZSlcblxuICAgIGlmIChjb3VudCA9PT0gbnVsbCB8fCAhTnVtYmVyLmlzU2FmZUludGVnZXIoY291bnQpIHx8IGNvdW50IDwgMCkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKGBJbnZhbGlkIHJlY29uY2lsZWQgYmFja2dyb3VuZCBqb2IgY29uY3VycmVuY3kgY291bnQgZm9yICR7Y29uY3VycmVuY3lLZXl9OiAke2NvdW50fWApXG4gICAgfVxuXG4gICAgcmV0dXJuIGNvdW50XG4gIH1cblxuICAvKipcbiAgICogUmVjb25jaWxlcyBxdWV1ZS1kZXJpdmVkIGNvbmN1cnJlbmN5IHdpdGggdGhlIGN1cnJlbnQgY29uZmlndXJhdGlvbi4gT25seVxuICAgKiBpbnZva2VkIHRocm91Z2gge0BsaW5rIHJlY29uY2lsZVF1ZXVlQ29uY3VycmVuY3l9IOKAlCB0aGUgZXhwbGljaXQgbGlmZWN5Y2xlXG4gICAqIHBhdGggcnVuIGF0IG1haW4tcHJvY2VzcyBzdGFydHVwIHVuZGVyIGEgY3Jvc3MtcHJvY2VzcyBhZHZpc29yeSBsb2NrIOKAlFxuICAgKiBuZXZlciBmcm9tIHNjaGVtYS90ZW5hbnQgY2hlY2tzIG9yIHJvdXRpbmUgY29ubmVjdGlvbiBpbml0aWFsaXphdGlvbixcbiAgICogd2hpY2ggc3RheSByZWFkLW9ubHkgcmVnYXJkaW5nIHF1ZXVlZCBqb2Igcm93cy4gVGhlIHBlci1wcm9jZXNzIG1lbW8gaXNcbiAgICogbGF0Y2hlZCBieSB7QGxpbmsgcmVjb25jaWxlUXVldWVDb25jdXJyZW5jeX0gb25seSBhZnRlciB0aGUgZm9sbG93aW5nXG4gICAqIGNvdW50IHJlYnVpbGQgYWxzbyBzdWNjZWVkcywgc28gYSBmYWlsZWQgcmVidWlsZCByZS1lbnRlcnMgaGVyZSBvbiByZXRyeVxuICAgKiAodGhlIGFkb3B0aW9uIFVQREFURXMgYmVsb3cgYXJlIGlkZW1wb3RlbnQpLiBFbnF1ZXVlIG9ubHkgY29uc3VsdHMgY29uZmlnIGZvciBuZXcgam9icywgc28gYSBjYXAgYWRkZWQsIHJlbW92ZWQsIG9yIGNoYW5nZWRcbiAgICogd2hpbGUgYSBiYWNrbG9nIGV4aXN0cyBvdGhlcndpc2UgbGVhdmVzIHBlcnNpc3RlZCByb3dzIHN0YWxlOiBwcmUtY2FwIGpvYnNcbiAgICoga2VlcCBhIG51bGwga2V5IGFuZCBieXBhc3MgdGhlIGNhcCwgcG9zdC1yZW1vdmFsIGpvYnMgc3RheSBjYXBwZWQgdW5kZXIgYVxuICAgKiBub3ctdW5jb25maWd1cmVkIGtleSwgYW5kIGEgY2hhbmdlZCBudW1lcmljIGNhcCBzdGF5cyBzdGFsZSB1bnRpbCB0aGUgbmV4dFxuICAgKiBlbnF1ZXVlLiBCcmluZyBxdWV1ZWQgZHVyYWJsZSBzdGF0ZSBpbiBsaW5lIHdpdGggY29uZmlnOiBzeW5jIGVhY2ggY29uZmlndXJlZFxuICAgKiBxdWV1ZSdzIHN0b3JlZCBjYXAsIGFkb3B0IG5vdC15ZXQta2V5ZWQgcXVldWVkIGpvYnMgb250byB0aGVpciBxdWV1ZSBrZXksXG4gICAqIGFuZCByZWxlYXNlIHF1ZXVlZCBqb2JzIGZyb20gcXVldWUga2V5cyB3aG9zZSBxdWV1ZSBpcyBubyBsb25nZXIgY2FwcGVkLlxuICAgKiBFeGlzdGluZyBoYW5kb2ZmcyByZXRhaW4gdGhlIHBvbGljeSBhbmQgcmVzZXJ2YXRpb24gdGhleSBzdGFydGVkIHdpdGgsIHNvXG4gICAqIHJlY29uY2lsaWF0aW9uIGNhbm5vdCByYWNlIHRoZWlyIGNvbXBsZXRpb24vcmV0cnkgdHJhbnNpdGlvbnMuIFJ1bnMgYmVmb3JlXG4gICAqIHtAbGluayBfcmVjb25jaWxlQ29uY3VycmVuY3l9IHNvIGFueSBwcmUtZXhpc3RpbmcgYWN0aXZlIGNvdW50cyBhcmUgZXhhY3QuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vZGF0YWJhc2UvZHJpdmVycy9iYXNlLmpzXCIpLmRlZmF1bHR9IGRiIC0gRGF0YWJhc2UgY29ubmVjdGlvbi5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgd2hlbiByZWNvbmNpbGVkLlxuICAgKi9cbiAgYXN5bmMgX3JlY29uY2lsZVF1ZXVlQ29uY3VycmVuY3koZGIpIHtcbiAgICBpZiAodGhpcy5fcXVldWVDb25jdXJyZW5jeVJlY29uY2lsZWQpIHJldHVyblxuICAgIGlmICghKGF3YWl0IGRiLnRhYmxlRXhpc3RzKENPTkNVUlJFTkNZX1RBQkxFKSkpIHJldHVyblxuXG4gICAgY29uc3QgcXVldWVzQ29uZmlnID0gdGhpcy5jb25maWd1cmF0aW9uLmdldEJhY2tncm91bmRKb2JzQ29uZmlnKCkucXVldWVzIHx8IHt9XG4gICAgY29uc3Qgam9ic1RhYmxlID0gZGIucXVvdGVUYWJsZShKT0JTX1RBQkxFKVxuICAgIGNvbnN0IGtleUNvbHVtbiA9IGRiLnF1b3RlQ29sdW1uKFwiY29uY3VycmVuY3lfa2V5XCIpXG4gICAgY29uc3QgY2FwQ29sdW1uID0gZGIucXVvdGVDb2x1bW4oXCJtYXhfY29uY3VycmVuY3lcIilcbiAgICBjb25zdCBxdWV1ZUNvbHVtbiA9IGRiLnF1b3RlQ29sdW1uKFwicXVldWVcIilcbiAgICBjb25zdCBxdWV1ZWQgPSBgJHtkYi5xdW90ZUNvbHVtbihcInN0YXR1c1wiKX0gPSAke2RiLnF1b3RlKFwicXVldWVkXCIpfWBcbiAgICAvKiogQHR5cGUge1NldDxzdHJpbmc+fSAqL1xuICAgIGNvbnN0IGNhcHBlZFF1ZXVlcyA9IG5ldyBTZXQoKVxuXG4gICAgZm9yIChjb25zdCBxdWV1ZSBvZiBPYmplY3Qua2V5cyhxdWV1ZXNDb25maWcpKSB7XG4gICAgICBjb25zdCBjYXAgPSB0aGlzLl9xdWV1ZU1heENvbmN1cnJlbmN5KHF1ZXVlKVxuXG4gICAgICBpZiAoY2FwID09PSBudWxsKSBjb250aW51ZVxuXG4gICAgICBjYXBwZWRRdWV1ZXMuYWRkKHF1ZXVlKVxuICAgICAgY29uc3QgY29uY3VycmVuY3lLZXkgPSBgJHtRVUVVRV9DT05DVVJSRU5DWV9LRVlfUFJFRklYfSR7cXVldWV9YFxuXG4gICAgICBhd2FpdCB0aGlzLl9lbnN1cmVRdWV1ZUNvbmN1cnJlbmN5S2V5KGRiLCB7Y29uY3VycmVuY3lLZXksIG1heENvbmN1cnJlbmN5OiBjYXB9KVxuICAgICAgYXdhaXQgZGIucXVlcnkoXG4gICAgICAgIGBVUERBVEUgJHtqb2JzVGFibGV9IFNFVCAke2tleUNvbHVtbn0gPSAke2RiLnF1b3RlKGNvbmN1cnJlbmN5S2V5KX0sICR7Y2FwQ29sdW1ufSA9ICR7TnVtYmVyKGNhcCl9IGAgK1xuICAgICAgICBgV0hFUkUgJHtxdWV1ZUNvbHVtbn0gPSAke2RiLnF1b3RlKHF1ZXVlKX0gQU5EICR7a2V5Q29sdW1ufSBJUyBOVUxMIEFORCAke3F1ZXVlZH1gXG4gICAgICApXG4gICAgfVxuXG4gICAgY29uc3QgY29uY3VycmVuY3lSb3dzID0gYXdhaXQgZGJcbiAgICAgIC5uZXdRdWVyeSgpXG4gICAgICAuZnJvbShDT05DVVJSRU5DWV9UQUJMRSlcbiAgICAgIC5zZWxlY3QoXCJjb25jdXJyZW5jeV9rZXlcIilcbiAgICAgIC53aGVyZShgJHtkYi5xdW90ZUNvbHVtbihcImNvbmN1cnJlbmN5X2tleVwiKX0gTElLRSAke2RiLnF1b3RlKGAke1FVRVVFX0NPTkNVUlJFTkNZX0tFWV9QUkVGSVh9JWApfWApXG4gICAgICAucmVzdWx0cygpXG5cbiAgICBmb3IgKGNvbnN0IHJvdyBvZiBjb25jdXJyZW5jeVJvd3MpIHtcbiAgICAgIGNvbnN0IGNvbmN1cnJlbmN5S2V5ID0gU3RyaW5nKC8qKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSAqLyAocm93KS5jb25jdXJyZW5jeV9rZXkpXG5cbiAgICAgIGlmICghY29uY3VycmVuY3lLZXkuc3RhcnRzV2l0aChRVUVVRV9DT05DVVJSRU5DWV9LRVlfUFJFRklYKSkgY29udGludWVcbiAgICAgIGlmIChjYXBwZWRRdWV1ZXMuaGFzKGNvbmN1cnJlbmN5S2V5LnNsaWNlKFFVRVVFX0NPTkNVUlJFTkNZX0tFWV9QUkVGSVgubGVuZ3RoKSkpIGNvbnRpbnVlXG5cbiAgICAgIGF3YWl0IGRiLnF1ZXJ5KFxuICAgICAgICBgVVBEQVRFICR7am9ic1RhYmxlfSBTRVQgJHtrZXlDb2x1bW59ID0gTlVMTCwgJHtjYXBDb2x1bW59ID0gTlVMTCBgICtcbiAgICAgICAgYFdIRVJFICR7a2V5Q29sdW1ufSA9ICR7ZGIucXVvdGUoY29uY3VycmVuY3lLZXkpfSBBTkQgJHtxdWV1ZWR9YFxuICAgICAgKVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIG5vcm1hbGl6ZSBudW1iZXIuXG4gICAqIEBwYXJhbSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59IHZhbHVlIC0gSW5wdXQgdmFsdWUuXG4gICAqIEByZXR1cm5zIHtudW1iZXIgfCBudWxsfSAtIE5vcm1hbGl6ZWQgbnVtYmVyLlxuICAgKi9cbiAgX25vcm1hbGl6ZU51bWJlcih2YWx1ZSkge1xuICAgIGlmICh2YWx1ZSA9PT0gbnVsbCB8fCB2YWx1ZSA9PT0gdW5kZWZpbmVkIHx8IHZhbHVlID09PSBcIlwiKSByZXR1cm4gbnVsbFxuXG4gICAgY29uc3QgbnVtZXJpYyA9IE51bWJlcih2YWx1ZSlcblxuICAgIGlmIChOdW1iZXIuaXNOYU4obnVtZXJpYykpIHJldHVybiBudWxsXG5cbiAgICByZXR1cm4gbnVtZXJpY1xuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgbm9ybWFsaXplIGV4ZWN1dGlvbiBtb2RlLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vdHlwZXMuanNcIikuQmFja2dyb3VuZEpvYk9wdGlvbnN9IFtvcHRpb25zXSAtIEpvYiBvcHRpb25zLlxuICAgKiBAcmV0dXJucyB7aW1wb3J0KFwiLi90eXBlcy5qc1wiKS5CYWNrZ3JvdW5kSm9iRXhlY3V0aW9uTW9kZX0gLSBOb3JtYWxpemVkIGV4ZWN1dGlvbiBtb2RlLlxuICAgKi9cbiAgX25vcm1hbGl6ZUV4ZWN1dGlvbk1vZGUob3B0aW9ucykge1xuICAgIHJldHVybiBub3JtYWxpemVCYWNrZ3JvdW5kSm9iRXhlY3V0aW9uTW9kZShvcHRpb25zIHx8IHt9LCBERUZBVUxUX0JBQ0tHUk9VTkRfSk9CX0VYRUNVVElPTl9NT0RFKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgbm9ybWFsaXplIGV4ZWN1dGlvbiBtb2RlIG5hbWUuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBleGVjdXRpb25Nb2RlIC0gRXhlY3V0aW9uIG1vZGUgbmFtZS5cbiAgICogQHJldHVybnMge2ltcG9ydChcIi4vdHlwZXMuanNcIikuQmFja2dyb3VuZEpvYkV4ZWN1dGlvbk1vZGV9IC0gTm9ybWFsaXplZCBleGVjdXRpb24gbW9kZS5cbiAgICovXG4gIF9ub3JtYWxpemVFeGVjdXRpb25Nb2RlTmFtZShleGVjdXRpb25Nb2RlKSB7XG4gICAgcmV0dXJuIG5vcm1hbGl6ZUJhY2tncm91bmRKb2JFeGVjdXRpb25Nb2RlKFxuICAgICAge2V4ZWN1dGlvbk1vZGU6IC8qKiBAdHlwZSB7aW1wb3J0KFwiLi90eXBlcy5qc1wiKS5CYWNrZ3JvdW5kSm9iRXhlY3V0aW9uTW9kZX0gKi8gKGV4ZWN1dGlvbk1vZGUpfSxcbiAgICAgIERFRkFVTFRfQkFDS0dST1VORF9KT0JfRVhFQ1VUSU9OX01PREUsXG4gICAgICBCQUNLR1JPVU5EX0pPQl9FWEVDVVRJT05fTU9ERVNcbiAgICApXG4gIH1cblxuICAvKipcbiAgICogRmlsdGVycyBxdWV1ZWQgam9icyBieSBvbmUgb3IgbW9yZSBleGVjdXRpb24gbW9kZXMgYWdhaW5zdCB0aGVcbiAgICogYGV4ZWN1dGlvbl9tb2RlYCBjb2x1bW4gKHRoZSBzaW5nbGUgc291cmNlIG9mIHRydXRoKS5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBPcHRpb25zLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL2RhdGFiYXNlL2RyaXZlcnMvYmFzZS5qc1wiKS5kZWZhdWx0fSBhcmdzLmRiIC0gRGF0YWJhc2UgY29ubmVjdGlvbi5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL3R5cGVzLmpzXCIpLkJhY2tncm91bmRKb2JFeGVjdXRpb25Nb2RlIHwgaW1wb3J0KFwiLi90eXBlcy5qc1wiKS5CYWNrZ3JvdW5kSm9iRXhlY3V0aW9uTW9kZVtdfSBhcmdzLmV4ZWN1dGlvbk1vZGUgLSBSdW50aW1lIG1vZGVzLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL2RhdGFiYXNlL3F1ZXJ5L2luZGV4LmpzXCIpLmRlZmF1bHR9IGFyZ3MucXVlcnkgLSBRdWVyeSB0byBmaWx0ZXIuXG4gICAqIEByZXR1cm5zIHtpbXBvcnQoXCIuLi9kYXRhYmFzZS9xdWVyeS9pbmRleC5qc1wiKS5kZWZhdWx0fSAtIEZpbHRlcmVkIHF1ZXJ5LlxuICAgKi9cbiAgX3doZXJlRXhlY3V0aW9uTW9kZSh7ZGIsIGV4ZWN1dGlvbk1vZGUsIHF1ZXJ5fSkge1xuICAgIGNvbnN0IGV4ZWN1dGlvbk1vZGVzID0gQXJyYXkuaXNBcnJheShleGVjdXRpb25Nb2RlKSA/IGV4ZWN1dGlvbk1vZGUgOiBbZXhlY3V0aW9uTW9kZV1cbiAgICBjb25zdCBleGVjdXRpb25Nb2RlQ29sdW1uID0gZGIucXVvdGVDb2x1bW4oXCJleGVjdXRpb25fbW9kZVwiKVxuICAgIGNvbnN0IGNvbmRpdGlvbnMgPSBleGVjdXRpb25Nb2Rlcy5tYXAoKG1vZGUpID0+IGAke2V4ZWN1dGlvbk1vZGVDb2x1bW59ID0gJHtkYi5xdW90ZShtb2RlKX1gKVxuXG4gICAgcmV0dXJuIHF1ZXJ5LndoZXJlKGAoJHtjb25kaXRpb25zLmpvaW4oXCIgT1IgXCIpfSlgKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgcGFyc2UgYXJncy5cbiAgICogQHBhcmFtIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gdmFsdWUgLSBJbnB1dCB2YWx1ZS5cbiAgICogQHJldHVybnMge0FycmF5PFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gLSBQYXJzZWQgYXJncy5cbiAgICovXG4gIF9wYXJzZUFyZ3ModmFsdWUpIHtcbiAgICBpZiAoIXZhbHVlKSByZXR1cm4gW11cblxuICAgIHRyeSB7XG4gICAgICBjb25zdCBwYXJzZWQgPSBKU09OLnBhcnNlKFN0cmluZyh2YWx1ZSkpXG5cbiAgICAgIGlmIChBcnJheS5pc0FycmF5KHBhcnNlZCkpIHJldHVybiBwYXJzZWRcbiAgICB9IGNhdGNoIHtcbiAgICAgIC8vIElnbm9yZSBwYXJzZSBlcnJvcnMuXG4gICAgfVxuXG4gICAgcmV0dXJuIFtdXG4gIH1cblxuICAvKipcbiAgICogUnVucyB3aXRoIGRiLlxuICAgKiBAdGVtcGxhdGUgVFxuICAgKiBAcGFyYW0geyhkYjogaW1wb3J0KFwiLi4vZGF0YWJhc2UvZHJpdmVycy9iYXNlLmpzXCIpLmRlZmF1bHQpID0+IFByb21pc2U8VD59IGNhbGxiYWNrIC0gQ2FsbGJhY2suXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPFQ+fSAtIENhbGxiYWNrIHJlc3VsdC5cbiAgICovXG4gIGFzeW5jIF93aXRoRGIoY2FsbGJhY2spIHtcbiAgICBjb25zdCBkYXRhYmFzZUlkZW50aWZpZXIgPSB0aGlzLmdldERhdGFiYXNlSWRlbnRpZmllcigpXG4gICAgY29uc3QgcG9vbCA9IHRoaXMuY29uZmlndXJhdGlvbi5nZXREYXRhYmFzZVBvb2woZGF0YWJhc2VJZGVudGlmaWVyKVxuXG4gICAgaWYgKCFwb29sLnRlc3RTaGFyZWRDb25uZWN0aW9uKCkpIHtcbiAgICAgIHJldHVybiBhd2FpdCBwb29sLndpdGhDb25uZWN0aW9uKHtuYW1lOiBcIkJhY2tncm91bmQgam9icyBzdG9yZVwifSwgY2FsbGJhY2spXG4gICAgfVxuXG4gICAgcmV0dXJuIGF3YWl0IHRoaXMuY29uZmlndXJhdGlvbi5ydW5XaXRoVGVzdFNoYXJlZENvbm5lY3Rpb25Db250ZXh0cyhhc3luYyAoKSA9PiB7XG4gICAgICByZXR1cm4gYXdhaXQgdGhpcy5jb25maWd1cmF0aW9uLmVuc3VyZUNvbm5lY3Rpb25zKHtkYXRhYmFzZUlkZW50aWZpZXJzOiBbZGF0YWJhc2VJZGVudGlmaWVyXSwgbmFtZTogXCJCYWNrZ3JvdW5kIGpvYnMgc3RvcmVcIn0sIGFzeW5jIChkYnMpID0+IHtcbiAgICAgICAgY29uc3QgY29ubmVjdGlvbiA9IGRic1tkYXRhYmFzZUlkZW50aWZpZXJdXG4gICAgICAgIHJldHVybiBhd2FpdCBjb29yZGluYXRlU2hhcmVkVHJhbnNhY3Rpb25Db25uZWN0aW9uKGNvbm5lY3Rpb24sIGFzeW5jICgpID0+IGF3YWl0IGNhbGxiYWNrKGNvbm5lY3Rpb24pKVxuICAgICAgfSlcbiAgICB9KVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgYSB2YWx1ZS1yZXR1cm5pbmcgY2FsbGJhY2sgaW5zaWRlIHRoZSBkcml2ZXIncyB2b2lkLXR5cGVkIHRyYW5zYWN0aW9uIEFQSS5cbiAgICogQHRlbXBsYXRlIFRcbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9kYXRhYmFzZS9kcml2ZXJzL2Jhc2UuanNcIikuZGVmYXVsdH0gZGIgLSBEYXRhYmFzZSBjb25uZWN0aW9uLlxuICAgKiBAcGFyYW0geygpID0+IFByb21pc2U8VD59IGNhbGxiYWNrIC0gVHJhbnNhY3Rpb24gY2FsbGJhY2suXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPFQ+fSAtIENhbGxiYWNrIHJlc3VsdC5cbiAgICovXG4gIGFzeW5jIF90cmFuc2FjdGlvblJlc3VsdChkYiwgY2FsbGJhY2spIHtcbiAgICBsZXQgY29tcGxldGVkID0gZmFsc2VcbiAgICAvKiogQHR5cGUge1QgfCB1bmRlZmluZWR9ICovXG4gICAgbGV0IHJlc3VsdFxuICAgIGF3YWl0IGRiLnRyYW5zYWN0aW9uKGFzeW5jICgpID0+IHtcbiAgICAgIHJlc3VsdCA9IGF3YWl0IGNhbGxiYWNrKClcbiAgICAgIGNvbXBsZXRlZCA9IHRydWVcbiAgICB9KVxuICAgIGlmICghY29tcGxldGVkKSB0aHJvdyBuZXcgRXJyb3IoXCJCYWNrZ3JvdW5kIGpvYnMgdHJhbnNhY3Rpb24gY2FsbGJhY2sgd2FzIG5vdCBpbnZva2VkXCIpXG4gICAgcmV0dXJuIC8qKiBAdHlwZSB7VH0gKi8gKHJlc3VsdClcbiAgfVxuXG4gIC8qKlxuICAgKiBTZXJpYWxpemVzIGNvdW50LWNoYW5naW5nIHRyYW5zYWN0aW9ucyBiZWZvcmUgY2hlY2tpbmcgb3V0IHRoZWlyIGNvbm5lY3Rpb24uXG4gICAqIERhdGFiYXNlIHJvdyBsb2NraW5nIHN0aWxsIHByb3ZpZGVzIGNyb3NzLXByb2Nlc3Mgb3JkZXJpbmc7IHRoaXMgZ3VhcmRcbiAgICogcHJldmVudHMgY29uY3VycmVudCBjYWxsZXJzIG9uIFNRTGl0ZSdzIHNoYXJlZCBjb25uZWN0aW9uIGZyb20gYXR0ZW1wdGluZ1xuICAgKiBvdmVybGFwcGluZyB0b3AtbGV2ZWwgdHJhbnNhY3Rpb25zLlxuICAgKiBAdGVtcGxhdGUgVFxuICAgKiBAcGFyYW0geyhkYjogaW1wb3J0KFwiLi4vZGF0YWJhc2UvZHJpdmVycy9iYXNlLmpzXCIpLmRlZmF1bHQpID0+IFByb21pc2U8VD59IGNhbGxiYWNrIC0gVHJhbnNhY3Rpb24gY2FsbGJhY2suXG4gICAqIEBwYXJhbSB7QmFja2dyb3VuZEpvYlRyYW5zYWN0aW9uU2VyaWFsaXphdGlvbk9wdGlvbnN9IFtvcHRpb25zXSAtIFNlcmlhbGl6YXRpb24gb3B0aW9ucy5cbiAgICogQHJldHVybnMge1Byb21pc2U8VD59IENhbGxiYWNrIHJlc3VsdC5cbiAgICovXG4gIGFzeW5jIF9zZXJpYWxpemVkQ291bnRNdXRhdGlvbihjYWxsYmFjaywgb3B0aW9ucyA9IHt9KSB7XG4gICAgcmV0dXJuIGF3YWl0IHRoaXMuX3NlcmlhbGl6ZWRUcmFuc2FjdGlvbk11dGF0aW9uKGFzeW5jIChkYikgPT4ge1xuICAgICAgYXdhaXQgdGhpcy5fbG9ja0NvdW50UmV2aXNpb24oZGIpXG5cbiAgICAgIHJldHVybiBhd2FpdCBjYWxsYmFjayhkYilcbiAgICB9LCBvcHRpb25zKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgYSBzZXJpYWxpemVkIGNhbGxiYWNrIGluc2lkZSBvbmUgdHJhbnNhY3Rpb24uXG4gICAqIEB0ZW1wbGF0ZSBUXG4gICAqIEBwYXJhbSB7KGRiOiBpbXBvcnQoXCIuLi9kYXRhYmFzZS9kcml2ZXJzL2Jhc2UuanNcIikuZGVmYXVsdCkgPT4gUHJvbWlzZTxUPn0gY2FsbGJhY2sgLSBUcmFuc2FjdGlvbiBjYWxsYmFjay5cbiAgICogQHBhcmFtIHtCYWNrZ3JvdW5kSm9iVHJhbnNhY3Rpb25TZXJpYWxpemF0aW9uT3B0aW9uc30gW29wdGlvbnNdIC0gU2VyaWFsaXphdGlvbiBvcHRpb25zLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxUPn0gQ2FsbGJhY2sgcmVzdWx0LlxuICAgKi9cbiAgYXN5bmMgX3NlcmlhbGl6ZWRUcmFuc2FjdGlvbk11dGF0aW9uKGNhbGxiYWNrLCBvcHRpb25zID0ge30pIHtcbiAgICByZXR1cm4gYXdhaXQgdGhpcy5fc2VyaWFsaXplZENvbm5lY3Rpb25NdXRhdGlvbihcbiAgICAgIGFzeW5jIChkYikgPT4gYXdhaXQgdGhpcy5fdHJhbnNhY3Rpb25SZXN1bHQoZGIsIGFzeW5jICgpID0+IGF3YWl0IGNhbGxiYWNrKGRiKSksXG4gICAgICBvcHRpb25zXG4gICAgKVxuICB9XG5cbiAgLyoqXG4gICAqIEFkbWl0cyBtdXRhdGlvbiBjYWxsYmFja3MgdG8gdGhlIHByb2Nlc3MtbG9jYWwgRklGTyBiZWZvcmUgdGhleSBjaGVjayBvdXQgYVxuICAgKiBjb25uZWN0aW9uLiBDcm9zcy1wcm9jZXNzIG9yZGVyaW5nIHJlbWFpbnMgdGhlIHJlc3BvbnNpYmlsaXR5IG9mIGR1cmFibGVcbiAgICogcm93L2Fkdmlzb3J5IGxvY2tzIGFuZCB1bmlxdWUgY29uc3RyYWludHMgYWNxdWlyZWQgYXJvdW5kIHRoZSBjYWxsYmFjay5cbiAgICogQHRlbXBsYXRlIFRcbiAgICogQHBhcmFtIHsoZGI6IGltcG9ydChcIi4uL2RhdGFiYXNlL2RyaXZlcnMvYmFzZS5qc1wiKS5kZWZhdWx0KSA9PiBQcm9taXNlPFQ+fSBjYWxsYmFjayAtIENvbm5lY3Rpb24gY2FsbGJhY2suXG4gICAqIEBwYXJhbSB7QmFja2dyb3VuZEpvYlRyYW5zYWN0aW9uU2VyaWFsaXphdGlvbk9wdGlvbnN9IFtvcHRpb25zXSAtIFNlcmlhbGl6YXRpb24gb3B0aW9ucy5cbiAgICogQHJldHVybnMge1Byb21pc2U8VD59IENhbGxiYWNrIHJlc3VsdC5cbiAgICovXG4gIGFzeW5jIF9zZXJpYWxpemVkQ29ubmVjdGlvbk11dGF0aW9uKGNhbGxiYWNrLCBvcHRpb25zID0ge30pIHtcbiAgICBjb25zdCBpZGVudGlmaWVyID0gdGhpcy5nZXREYXRhYmFzZUlkZW50aWZpZXIoKSB8fCBcImRlZmF1bHRcIlxuICAgIGNvbnN0IHByZXZpb3VzID0gdHJhbnNhY3Rpb25NdXRhdGlvbkNoYWlucy5nZXQoaWRlbnRpZmllcikgfHwgUHJvbWlzZS5yZXNvbHZlKClcbiAgICBsZXQgcmVzb2x2ZVJ1biA9ICgpID0+IHt9XG4gICAgLyoqIEB0eXBlIHtQcm9taXNlPHZvaWQ+fSAqL1xuICAgIGNvbnN0IHJ1biA9IG5ldyBQcm9taXNlKChyZXNvbHZlKSA9PiB7XG4gICAgICByZXNvbHZlUnVuID0gKCkgPT4gcmVzb2x2ZSh1bmRlZmluZWQpXG4gICAgfSlcbiAgICBjb25zdCBjaGFpbiA9IHByZXZpb3VzLnRoZW4oKCkgPT4gcnVuKVxuXG4gICAgdHJhbnNhY3Rpb25NdXRhdGlvbkNoYWlucy5zZXQoaWRlbnRpZmllciwgY2hhaW4pXG4gICAgYXdhaXQgcHJldmlvdXNcblxuICAgIHRyeSB7XG4gICAgICByZXR1cm4gYXdhaXQgdGhpcy5fd2l0aERiKGFzeW5jIChkYikgPT4ge1xuICAgICAgICBjb25zdCB7YWR2aXNvcnlMb2NrfSA9IG9wdGlvbnNcblxuICAgICAgICBpZiAoYWR2aXNvcnlMb2NrKSB7XG4gICAgICAgICAgY29uc3QgYWNxdWlyZWQgPSBhd2FpdCBkYi5hY3F1aXJlQWR2aXNvcnlMb2NrKGFkdmlzb3J5TG9jay5uYW1lKVxuXG4gICAgICAgICAgaWYgKCFhY3F1aXJlZCkgdGhyb3cgbmV3IEVycm9yKGFkdmlzb3J5TG9jay5mYWlsdXJlTWVzc2FnZSlcbiAgICAgICAgfVxuXG4gICAgICAgIHRyeSB7XG4gICAgICAgICAgcmV0dXJuIGF3YWl0IGNhbGxiYWNrKGRiKVxuICAgICAgICB9IGZpbmFsbHkge1xuICAgICAgICAgIGlmIChhZHZpc29yeUxvY2spIGF3YWl0IGRiLnJlbGVhc2VBZHZpc29yeUxvY2soYWR2aXNvcnlMb2NrLm5hbWUpXG4gICAgICAgIH1cbiAgICAgIH0pXG4gICAgfSBmaW5hbGx5IHtcbiAgICAgIHJlc29sdmVSdW4oKVxuICAgICAgaWYgKHRyYW5zYWN0aW9uTXV0YXRpb25DaGFpbnMuZ2V0KGlkZW50aWZpZXIpID09PSBjaGFpbikgdHJhbnNhY3Rpb25NdXRhdGlvbkNoYWlucy5kZWxldGUoaWRlbnRpZmllcilcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogUnVucyBzaG91bGQgYWNjZXB0IHJlcG9ydC5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBPcHRpb25zLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vdHlwZXMuanNcIikuQmFja2dyb3VuZEpvYlJvd30gYXJncy5qb2IgLSBKb2Igcm93LlxuICAgKiBAcGFyYW0ge3N0cmluZyB8IG51bGwgfCB1bmRlZmluZWR9IGFyZ3MuaGFuZG9mZklkIC0gSGFuZG9mZiBsZWFzZSBpZCBmcm9tIHJlcG9ydC5cbiAgICogQHBhcmFtIHtzdHJpbmcgfCBudWxsIHwgdW5kZWZpbmVkfSBhcmdzLndvcmtlcklkIC0gV29ya2VyIGlkIGZyb20gcmVwb3J0LlxuICAgKiBAcGFyYW0ge251bWJlciB8IG51bGwgfCB1bmRlZmluZWR9IGFyZ3MuaGFuZGVkT2ZmQXRNcyAtIEhhbmRlZCBvZmYgdGltZXN0YW1wIGZyb20gcmVwb3J0LlxuICAgKiBAcmV0dXJucyB7Ym9vbGVhbn0gLSBXaGV0aGVyIHRvIGFjY2VwdCB0aGUgcmVwb3J0LlxuICAgKi9cbiAgX3Nob3VsZEFjY2VwdFJlcG9ydCh7am9iLCBoYW5kb2ZmSWQsIHdvcmtlcklkLCBoYW5kZWRPZmZBdE1zfSkge1xuICAgIGlmIChqb2Iuc3RhdHVzICE9PSBcImhhbmRlZF9vZmZcIikgcmV0dXJuIGZhbHNlXG5cbiAgICByZXR1cm4gdGhpcy5faGFuZG9mZklkUmVwb3J0TWF0Y2hlcyh7aGFuZG9mZklkLCBqb2J9KVxuICAgICAgJiYgdGhpcy5fd29ya2VyUmVwb3J0TWF0Y2hlcyh7am9iLCB3b3JrZXJJZH0pXG4gICAgICAmJiB0aGlzLl9oYW5kb2ZmUmVwb3J0TWF0Y2hlcyh7aGFuZGVkT2ZmQXRNcywgam9ifSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGFjdGl2ZSBoYW5kb2ZmIGNvbmRpdGlvbnMuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi90eXBlcy5qc1wiKS5CYWNrZ3JvdW5kSm9iUm93fSBqb2IgLSBKb2Igcm93LlxuICAgKiBAcmV0dXJucyB7UmVjb3JkPHN0cmluZywgc3RyaW5nIHwgbnVsbD59IC0gQ29uZGl0aW9uYWwgdHJhbnNpdGlvbiBmZW5jZS5cbiAgICovXG4gIF9hY3RpdmVIYW5kb2ZmQ29uZGl0aW9ucyhqb2IpIHtcbiAgICByZXR1cm4ge2hhbmRvZmZfaWQ6IGpvYi5oYW5kb2ZmSWQsIGlkOiBqb2IuaWQsIHN0YXR1czogXCJoYW5kZWRfb2ZmXCJ9XG4gIH1cblxuICAvKipcbiAgICogUnVucyBoYW5kb2ZmIGlkIHJlcG9ydCBtYXRjaGVzLlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIE9wdGlvbnMuXG4gICAqIEBwYXJhbSB7c3RyaW5nIHwgbnVsbCB8IHVuZGVmaW5lZH0gYXJncy5oYW5kb2ZmSWQgLSBIYW5kb2ZmIGxlYXNlIGlkIGZyb20gcmVwb3J0LlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vdHlwZXMuanNcIikuQmFja2dyb3VuZEpvYlJvd30gYXJncy5qb2IgLSBKb2Igcm93LlxuICAgKiBAcmV0dXJucyB7Ym9vbGVhbn0gLSBXaGV0aGVyIHRoZSBoYW5kb2ZmIGxlYXNlIG1hdGNoZXMuXG4gICAqL1xuICBfaGFuZG9mZklkUmVwb3J0TWF0Y2hlcyh7aGFuZG9mZklkLCBqb2J9KSB7XG4gICAgaWYgKCFqb2IuaGFuZG9mZklkKSByZXR1cm4gdHJ1ZVxuXG4gICAgcmV0dXJuIGhhbmRvZmZJZCA9PT0gam9iLmhhbmRvZmZJZFxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgd29ya2VyIHJlcG9ydCBtYXRjaGVzLlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIE9wdGlvbnMuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi90eXBlcy5qc1wiKS5CYWNrZ3JvdW5kSm9iUm93fSBhcmdzLmpvYiAtIEpvYiByb3cuXG4gICAqIEBwYXJhbSB7c3RyaW5nIHwgbnVsbCB8IHVuZGVmaW5lZH0gYXJncy53b3JrZXJJZCAtIFdvcmtlciBpZCBmcm9tIHJlcG9ydC5cbiAgICogQHJldHVybnMge2Jvb2xlYW59IC0gV2hldGhlciB0aGUgd29ya2VyIHJlcG9ydCBtYXRjaGVzLlxuICAgKi9cbiAgX3dvcmtlclJlcG9ydE1hdGNoZXMoe2pvYiwgd29ya2VySWR9KSB7XG4gICAgaWYgKCF3b3JrZXJJZCkgcmV0dXJuIHRydWVcbiAgICBpZiAoIWpvYi53b3JrZXJJZCkgcmV0dXJuIHRydWVcblxuICAgIHJldHVybiB3b3JrZXJJZCA9PT0gam9iLndvcmtlcklkXG4gIH1cblxuICAvKipcbiAgICogUnVucyBoYW5kb2ZmIHJlcG9ydCBtYXRjaGVzLlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIE9wdGlvbnMuXG4gICAqIEBwYXJhbSB7bnVtYmVyIHwgbnVsbCB8IHVuZGVmaW5lZH0gYXJncy5oYW5kZWRPZmZBdE1zIC0gSGFuZGVkIG9mZiB0aW1lc3RhbXAgZnJvbSByZXBvcnQuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi90eXBlcy5qc1wiKS5CYWNrZ3JvdW5kSm9iUm93fSBhcmdzLmpvYiAtIEpvYiByb3cuXG4gICAqIEByZXR1cm5zIHtib29sZWFufSAtIFdoZXRoZXIgdGhlIGhhbmRvZmYgcmVwb3J0IG1hdGNoZXMuXG4gICAqL1xuICBfaGFuZG9mZlJlcG9ydE1hdGNoZXMoe2hhbmRlZE9mZkF0TXMsIGpvYn0pIHtcbiAgICBpZiAoIWhhbmRlZE9mZkF0TXMpIHJldHVybiB0cnVlXG4gICAgaWYgKCFqb2IuaGFuZGVkT2ZmQXRNcykgcmV0dXJuIHRydWVcblxuICAgIHJldHVybiBoYW5kZWRPZmZBdE1zID09PSBqb2IuaGFuZGVkT2ZmQXRNc1xuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgbWlncmF0aW9uIGtleS5cbiAgICogQHBhcmFtIHtzdHJpbmd9IFt2ZXJzaW9uXSAtIE1pZ3JhdGlvbiB2ZXJzaW9uLlxuICAgKiBAcmV0dXJucyB7c3RyaW5nfSAtIE1pZ3JhdGlvbiBrZXkuXG4gICAqL1xuICBfbWlncmF0aW9uS2V5KHZlcnNpb24gPSBNSUdSQVRJT05fVkVSU0lPTikge1xuICAgIHJldHVybiBgJHtNSUdSQVRJT05fU0NPUEV9OiR7dmVyc2lvbn1gXG4gIH1cbn1cbiJdfQ==