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
     * @returns {Promise<boolean>} - Whether the fenced report was accepted.
     */
    async markChildAccepted({ jobId, handoffId, workerId, handedOffAtMs, receivedAtMs, startedAtMs, childInstanceId, childPid }) {
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
        return { child_instance_id: null, child_pid: null, child_received_at_ms: null, child_started_at_ms: null };
    }
    /**
     * Returns the row-shape counterpart of the cleared acceptance columns.
     * @returns {Pick<import("./types.js").BackgroundJobRow, "childInstanceId" | "childPid" | "childReceivedAtMs" | "childStartedAtMs">} - Cleared acceptance fields.
     */
    _clearedChildAcceptanceRow() {
        return { childInstanceId: null, childPid: null, childReceivedAtMs: null, childStartedAtMs: null };
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
            childPid: this._normalizeNumber(row.child_pid)
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoic3RvcmUuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi9zcmMvYmFja2dyb3VuZC1qb2JzL3N0b3JlLmpzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiJBQUFBLFlBQVk7QUFFWixPQUFPLEVBQUMsVUFBVSxFQUFFLFVBQVUsRUFBQyxNQUFNLFFBQVEsQ0FBQTtBQUM3QyxPQUFPLHFCQUFxQixNQUFNLGNBQWMsQ0FBQTtBQUNoRCxPQUFPLE1BQU0sTUFBTSxjQUFjLENBQUE7QUFDakMsT0FBTyxTQUFTLE1BQU0saUNBQWlDLENBQUE7QUFDdkQsT0FBTyxjQUFjLE1BQU0sdUJBQXVCLENBQUE7QUFDbEQsT0FBTyxtQkFBbUIsTUFBTSxpQkFBaUIsQ0FBQTtBQUNqRCxPQUFPLDJCQUEyQixNQUFNLHNCQUFzQixDQUFBO0FBQzlELE9BQU8sRUFBRSxxQ0FBcUMsRUFBRSxNQUFNLHlEQUF5RCxDQUFBO0FBQy9HLE9BQU8sbUJBQW1CLE1BQU0seUJBQXlCLENBQUE7QUFDekQsT0FBTyxFQUNMLGdDQUFnQyxFQUNoQyw4QkFBOEIsRUFDOUIscUNBQXFDLEVBQ3JDLDRCQUE0QixFQUM1Qiw0QkFBNEIsRUFDNUIsaUNBQWlDLEVBQ2pDLG1DQUFtQyxFQUNuQyxnQ0FBZ0MsRUFDaEMsMkJBQTJCLEVBQzNCLGlDQUFpQyxFQUNqQyxtQ0FBbUMsRUFDbkMsNEJBQTRCLEVBQzVCLDRCQUE0QixFQUM1QixZQUFZLEVBQ2IsTUFBTSxvQkFBb0IsQ0FBQTtBQUMzQixPQUFPLEVBQ0wsOEJBQThCLEVBQzlCLDJCQUEyQixFQUMzQix3QkFBd0IsRUFDekIsTUFBTSxpQ0FBaUMsQ0FBQTtBQUV4Qzs7Ozs7Ozs7Ozs7OztHQWFHO0FBRUg7Ozs7O0dBS0c7QUFFSDs7OztHQUlHO0FBRUg7Ozs7Ozs7O0dBUUc7QUFFSDs7Ozs7R0FLRztBQUVIOzs7OztHQUtHO0FBRUgsTUFBTSxnQkFBZ0IsR0FBRywrQkFBK0IsQ0FBQTtBQUN4RCxNQUFNLGVBQWUsR0FBRyxpQkFB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QyxNQUFNLENBQUMsT0FBTyxFQUFFLEVBQUMsSUFBSSxFQUFFLElBQUksRUFBRSxLQUFLLEVBQUUsSUFBSSxFQUFDLENBQUMsQ0FBQTtRQUNoRCxLQUFLLENBQUMsT0FBTyxDQUFDLGFBQWEsRUFBRSxFQUFDLElBQUksRUFBRSxLQUFLLEVBQUMsQ0FBQyxDQUFBO1FBQzNDLEtBQUssQ0FBQyxPQUFPLENBQUMsVUFBVSxFQUFFLEVBQUMsSUFBSSxFQUFFLEtBQUssRUFBQyxDQUFDLENBQUE7UUFDeEMsS0FBSyxDQUFDLE1BQU0sQ0FBQyxRQUFRLEVBQUUsRUFBQyxJQUFJLEVBQUUsS0FBSyxFQUFFLEtBQUssRUFBRSxJQUFJLEVBQUMsQ0FBQyxDQUFBO1FBQ2xELEtBQUssQ0FBQyxNQUFNLENBQUMsaUJBQWlCLEVBQUUsRUFBQyxJQUFJLEVBQUUsS0FBSyxFQUFFLEtBQUssRUFBRSxJQUFJLEVBQUMsQ0FBQyxDQUFBO1FBQzNELEtBQUssQ0FBQyxNQUFNLENBQUMsZUFBZSxFQUFFLEVBQUMsSUFBSSxFQUFFLEtBQUssRUFBRSxLQUFLLEVBQUUsSUFBSSxFQUFDLENBQUMsQ0FBQTtRQUN6RCxLQUFLLENBQUMsTUFBTSxDQUFDLGNBQWMsRUFBRSxFQUFDLElBQUksRUFBRSxJQUFJLEVBQUUsS0FBSyxFQUFFLElBQUksRUFBQyxDQUFDLENBQUE7UUFDdkQsS0FBSyxDQUFDLE1BQU0sQ0FBQyxnQkFBZ0IsRUFBRSxFQUFDLElBQUksRUFBRSxJQUFJLEVBQUMsQ0FBQyxDQUFBO1FBQzVDLEtBQUssQ0FBQyxNQUFNLENBQUMsa0JBQWtCLEVBQUUsRUFBQyxJQUFJLEVBQUUsSUFBSSxFQUFFLEtBQUssRUFBRSxJQUFJLEVBQUMsQ0FBQyxDQUFBO1FBQzNELEtBQUssQ0FBQyxNQUFNLENBQUMsWUFBWSxFQUFFLEVBQUMsSUFBSSxFQUFFLElBQUksRUFBQyxDQUFDLENBQUE7UUFDeEMsS0FBSyxDQUFDLE1BQU0sQ0FBQyxpQkFBaUIsRUFBRSxFQUFDLElBQUksRUFBRSxJQUFJLEVBQUMsQ0FBQyxDQUFBO1FBQzdD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QUFxQixDQUFDLEVBQUMsYUFBYSxFQUFFLEdBQUcsRUFBQztRQUN4QyxJQUFJLENBQUMsYUFBYTtZQUFFLE9BQU8sSUFBSSxDQUFBO1FBQy9CLElBQUksQ0FBQyxHQUFHLENBQUMsYUFBYTtZQUFFLE9BQU8sSUFBSSxDQUFBO1FBRW5DLE9BQU8sYUFBYSxLQUFLLEdBQUcsQ0FBQyxhQUFhLENBQUE7SUFDNUMsQ0FBQztJQUVEOzs7O09BSUc7SUFDSCxhQUFhLENBQUMsT0FBTyxHQUFHLGlCQUFpQjtRQUN2QyxPQUFPLEdBQUcsZUFBZSxJQUFJLE9BQU8sRUFBRSxDQUFBO0lBQ3hDLENBQUM7Q0FDRiIsInNvdXJjZXNDb250ZW50IjpbIi8vIEB0cy1jaGVja1xuXG5pbXBvcnQge2NyZWF0ZUhhc2gsIHJhbmRvbVVVSUR9IGZyb20gXCJjcnlwdG9cIlxuaW1wb3J0IEJhY2tncm91bmRKb2JzQWRhcHRlciBmcm9tIFwiLi9hZGFwdGVyLmpzXCJcbmltcG9ydCBMb2dnZXIgZnJvbSBcIi4uL2xvZ2dlci5qc1wiXG5pbXBvcnQgVGFibGVEYXRhIGZyb20gXCIuLi9kYXRhYmFzZS90YWJsZS1kYXRhL2luZGV4LmpzXCJcbmltcG9ydCBWZWxvY2lvdXNFcnJvciBmcm9tIFwiLi4vdmVsb2Npb3VzLWVycm9yLmpzXCJcbmltcG9ydCBCYWNrZ3JvdW5kSm9iUmVjb3JkIGZyb20gXCIuL2pvYi1yZWNvcmQuanNcIlxuaW1wb3J0IG5vcm1hbGl6ZUJhY2tncm91bmRKb2JFcnJvciBmcm9tIFwiLi9ub3JtYWxpemUtZXJyb3IuanNcIlxuaW1wb3J0IHsgY29vcmRpbmF0ZVNoYXJlZFRyYW5zYWN0aW9uQ29ubmVjdGlvbiB9IGZyb20gXCIuLi90ZXN0aW5nL3NoYXJlZC10cmFuc2FjdGlvbi1jb25uZWN0aW9uLWNvb3JkaW5hdG9yLmpzXCJcbmltcG9ydCBzdGFibGVKc29uU3RyaW5naWZ5IGZyb20gXCIuLi91dGlscy9zdGFibGUtanNvbi5qc1wiXG5pbXBvcnQge1xuICBCQUNLR1JPVU5EX0pPQl9URVJNSU5BTF9TVEFUVVNFUyxcbiAgQkFDS0dST1VORF9KT0JfRVhFQ1VUSU9OX01PREVTLFxuICBERUZBVUxUX0JBQ0tHUk9VTkRfSk9CX0VYRUNVVElPTl9NT0RFLFxuICBERUZBVUxUX0JBQ0tHUk9VTkRfSk9CX1FVRVVFLFxuICBRVUVVRV9DT05DVVJSRU5DWV9LRVlfUFJFRklYLFxuICBub3JtYWxpemVCYWNrZ3JvdW5kSm9iQ29uY3VycmVuY3ksXG4gIG5vcm1hbGl6ZUJhY2tncm91bmRKb2JFeGVjdXRpb25Nb2RlLFxuICBub3JtYWxpemVCYWNrZ3JvdW5kSm9iTWF4UmV0cmllcyxcbiAgbm9ybWFsaXplQmFja2dyb3VuZEpvYlF1ZXVlLFxuICBub3JtYWxpemVCYWNrZ3JvdW5kSm9iU2NoZWR1bGVLZXksXG4gIG5vcm1hbGl6ZUJhY2tncm91bmRKb2JTY2hlZHVsZWRBdE1zLFxuICBub3JtYWxpemVCYWNrZ3JvdW5kSm9iU3RhdHVzLFxuICByZXNjaGVkdWxlZEJhY2tncm91bmRKb2JBdE1zLFxuICByZXRyeURlbGF5TXNcbn0gZnJvbSBcIi4vam9iLXNlbWFudGljcy5qc1wiXG5pbXBvcnQge1xuICBNQUlMX0RFTElWRVJZX09QRVJBVElPTlNfVEFCTEUsXG4gIG1haWxEZWxpdmVyeU9wZXJhdGlvbkZvckpvYixcbiAgbWFpbERlbGl2ZXJ5T3BlcmF0aW9uS2V5XG59IGZyb20gXCIuLi9tYWlsZXIvZGVsaXZlcnktb3BlcmF0aW9uLmpzXCJcblxuLyoqXG4gKiBQcmVwYXJlZEJhY2tncm91bmRKb2IgdHlwZS5cbiAqIEB0eXBlZGVmIHtvYmplY3R9IFByZXBhcmVkQmFja2dyb3VuZEpvYlxuICogQHByb3BlcnR5IHtzdHJpbmd9IGFyZ3NKc29uIC0gU2VyaWFsaXplZCBhcmd1bWVudHMuXG4gKiBAcHJvcGVydHkge3tjb25jdXJyZW5jeUtleTogc3RyaW5nLCBtYXhDb25jdXJyZW5jeTogbnVtYmVyLCBxdWV1ZURlcml2ZWQ6IGJvb2xlYW59IHwgbnVsbH0gY29uY3VycmVuY3kgLSBSZXNvbHZlZCBjb25jdXJyZW5jeS5cbiAqIEBwcm9wZXJ0eSB7bnVtYmVyfSBjcmVhdGVkQXRNcyAtIENyZWF0aW9uIHRpbWVzdGFtcC5cbiAqIEBwcm9wZXJ0eSB7aW1wb3J0KFwiLi90eXBlcy5qc1wiKS5CYWNrZ3JvdW5kSm9iRXhlY3V0aW9uTW9kZX0gZXhlY3V0aW9uTW9kZSAtIEV4ZWN1dGlvbiBtb2RlLlxuICogQHByb3BlcnR5IHtzdHJpbmd9IGpvYklkIC0gTmV3IGpvYiBpZC5cbiAqIEBwcm9wZXJ0eSB7c3RyaW5nfSBqb2JOYW1lIC0gSm9iIG5hbWUuXG4gKiBAcHJvcGVydHkge251bWJlcn0gbWF4UmV0cmllcyAtIFJldHJ5IGNhcC5cbiAqIEBwcm9wZXJ0eSB7c3RyaW5nfSBxdWV1ZSAtIFF1ZXVlIG5hbWUuXG4gKiBAcHJvcGVydHkge251bWJlcn0gc2NoZWR1bGVkQXRNcyAtIEVsaWdpYmlsaXR5IHRpbWVzdGFtcC5cbiAqIEBwcm9wZXJ0eSB7bnVtYmVyIHwgbnVsbH0gdGltZW91dE1zIC0gUGVyLWpvYiB0aW1lb3V0IG92ZXJyaWRlLCBvciBudWxsIHdoZW4gb21pdHRlZC5cbiAqL1xuXG4vKipcbiAqIEJhY2tncm91bmRKb2JPcnBoYW5TZWxlY3Rpb24gdHlwZS5cbiAqIEB0eXBlZGVmIHtvYmplY3R9IEJhY2tncm91bmRKb2JPcnBoYW5TZWxlY3Rpb25cbiAqIEBwcm9wZXJ0eSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSBjb25kaXRpb25zIC0gRXhhY3QgdXBkYXRlIGZlbmNlLlxuICogQHByb3BlcnR5IHtpbXBvcnQoXCIuL3R5cGVzLmpzXCIpLkJhY2tncm91bmRKb2JSb3d9IGpvYiAtIFNlbGVjdGVkIGFjdGl2ZSBoYW5kb2ZmLlxuICovXG5cbi8qKlxuICogQmFja2dyb3VuZEpvYlRyYW5zYWN0aW9uU2VyaWFsaXphdGlvbk9wdGlvbnMgdHlwZS5cbiAqIEB0eXBlZGVmIHtvYmplY3R9IEJhY2tncm91bmRKb2JUcmFuc2FjdGlvblNlcmlhbGl6YXRpb25PcHRpb25zXG4gKiBAcHJvcGVydHkge3tmYWlsdXJlTWVzc2FnZTogc3RyaW5nLCBuYW1lOiBzdHJpbmd9fSBbYWR2aXNvcnlMb2NrXSAtIFNlc3Npb24gbG9jayBoZWxkIGFyb3VuZCB0aGUgdHJhbnNhY3Rpb24uXG4gKi9cblxuLyoqXG4gKiBCYWNrZ3JvdW5kSm9iUHJ1bmVDYW5kaWRhdGVNZXRhZGF0YSB0eXBlLiBJbW11dGFibGUgbWV0YWRhdGEgZm9yIG9uZSBzZWxlY3RlZFxuICogcmV0ZW50aW9uIGNhbmRpZGF0ZSBiYXRjaCwgZXhwb3NlZCB0byB0aGUgb3B0aW9uYWwgcHJ1bmUgYmFycmllciBob29rLlxuICogQHR5cGVkZWYge29iamVjdH0gQmFja2dyb3VuZEpvYlBydW5lQ2FuZGlkYXRlTWV0YWRhdGFcbiAqIEBwcm9wZXJ0eSB7UmVhZG9ubHk8QXJyYXk8c3RyaW5nPj59IGNhbmRpZGF0ZXMgLSBKb2IgaWRzIHNlbGVjdGVkIGZvciB0aGlzIGJhdGNoLlxuICogQHByb3BlcnR5IHtzdHJpbmd9IHN0YXR1cyAtIFRlcm1pbmFsIHN0YXR1cyB0aGUgY2FuZGlkYXRlcyB3ZXJlIHNlbGVjdGVkIGJ5LlxuICogQHByb3BlcnR5IHtzdHJpbmd9IGNvbHVtbiAtIFRlcm1pbmFsIHRpbWVzdGFtcCBjb2x1bW4gY29tcGFyZWQgYWdhaW5zdCB0aGUgY3V0b2ZmLlxuICogQHByb3BlcnR5IHtudW1iZXJ9IGN1dG9mZiAtIEN1dG9mZiB0aW1lc3RhbXAgdGhlIGNhbmRpZGF0ZXMgd2VyZSBzZWxlY3RlZCBhZ2FpbnN0LlxuICovXG5cbi8qKlxuICogQmFja2dyb3VuZEpvYkNvbmN1cnJlbmN5Q291bnRSb3cgdHlwZS5cbiAqIEB0eXBlZGVmIHtvYmplY3R9IEJhY2tncm91bmRKb2JDb25jdXJyZW5jeUNvdW50Um93XG4gKiBAcHJvcGVydHkge251bWJlciB8IHN0cmluZ30gYWN0aXZlX2NvdW50IC0gUGVyc2lzdGVkIG9yIGFnZ3JlZ2F0ZWQgYWN0aXZlIGNvdW50LlxuICogQHByb3BlcnR5IHtzdHJpbmd9IGNvbmN1cnJlbmN5X2tleSAtIER1cmFibGUgY2FwIGlkZW50aXR5LlxuICovXG5cbi8qKlxuICogQmFja2dyb3VuZEpvYlF1ZXVlZENvbmN1cnJlbmN5IHR5cGUuXG4gKiBAdHlwZWRlZiB7b2JqZWN0fSBCYWNrZ3JvdW5kSm9iUXVldWVkQ29uY3VycmVuY3lcbiAqIEBwcm9wZXJ0eSB7c3RyaW5nIHwgbnVsbH0gY29uY3VycmVuY3lLZXkgLSBDdXJyZW50IGNvbmN1cnJlbmN5IGtleSBmb3IgcXVldWVkIHdvcmsuXG4gKiBAcHJvcGVydHkge251bWJlciB8IG51bGx9IG1heENvbmN1cnJlbmN5IC0gQ3VycmVudCBjb25jdXJyZW5jeSBjYXAgZm9yIHF1ZXVlZCB3b3JrLlxuICovXG5cbmNvbnN0IE1JR1JBVElPTlNfVEFCTEUgPSBcInZlbG9jaW91c19pbnRlcm5hbF9taWdyYXRpb25zXCJcbmNvbnN0IE1JR1JBVElPTl9TQ09QRSA9IFwiYmFja2dyb3VuZF9qb2JzXCJcbmNvbnN0IE1JR1JBVElPTl9WRVJTSU9OID0gXCIyMDI1MDIxNTAwMDAwMFwiXG5jb25zdCBTQ0hFTUFfUkVDT1ZFUllfUEVORElOR19WRVJTSU9OID0gXCJzY2hlbWEtcmVjb3ZlcnktcGVuZGluZ1wiXG5jb25zdCBFWEVDVVRJT05fTU9ERV9CQUNLRklMTF9NSUdSQVRJT05fVkVSU0lPTiA9IFwiMjAyNjA2MDcxMzEwMTBcIlxuLy8gRHJvcHMgdGhlIHJlZHVuZGFudCBsZWdhY3kgYGZvcmtlZGAgYm9vbGVhbiBjb2x1bW4gYW5kIHJld3JpdGVzIHBvb2xlZCByb3dzIHRvXG4vLyBwZXJzaXN0IGBleGVjdXRpb25fbW9kZSA9IFwicG9vbGVkXCJgIGRpcmVjdGx5IChyZXRpcmluZyB0aGUgcG9vbGVkLWFzLWZvcmtlZFxuLy8gaGFuZG9mZi1tYXJrZXIgd29ya2Fyb3VuZCksIGxlYXZpbmcgYGV4ZWN1dGlvbl9tb2RlYCBhcyB0aGUgc2luZ2xlIHNvdXJjZSBvZlxuLy8gdHJ1dGggZm9yIGEgam9iJ3MgcnVudGltZS5cbmNvbnN0IERST1BfRk9SS0VEX0NPTFVNTl9NSUdSQVRJT05fVkVSU0lPTiA9IFwiMjAyNjA3MTkwMDAwMDBcIlxuY29uc3QgSk9CU19JTkRFWF9SRVBBSVJfTUlHUkFUSU9OX1ZFUlNJT04gPSBcIjIwMjYwOTAzMTIwMDAwXCJcbi8vIExlZ2FjeSBtYXJrZXIgcHJlZml4IHVzZWQgYnkgcm93cyB3cml0dGVuIGJlZm9yZSB0aGlzIG1pZ3JhdGlvbjogcG9vbGVkIGpvYnNcbi8vIHVzZWQgdG8gcGVyc2lzdCBhcyBgZXhlY3V0aW9uX21vZGUgPSBcImZvcmtlZFwiYCBwbHVzIGEgYHZlbG9jaW91cy1wb29sZWQ6KmBcbi8vIGhhbmRvZmYgaWQuIFJldGFpbmVkIG9ubHkgdG8gZGV0ZWN0IGFuZCBjb252ZXJ0IHRob3NlIHJvd3MgaW4gdGhlIG1pZ3JhdGlvbi5cbmNvbnN0IExFR0FDWV9QT09MRURfSEFORE9GRl9JRF9QUkVGSVggPSBcInZlbG9jaW91cy1wb29sZWQ6XCJcbmNvbnN0IExFR0FDWV9QT09MRURfUVVFVUVEX0hBTkRPRkZfSUQgPSBgJHtMRUdBQ1lfUE9PTEVEX0hBTkRPRkZfSURfUFJFRklYfXF1ZXVlZGBcbmNvbnN0IEpPQlNfVEFCTEUgPSBcImJhY2tncm91bmRfam9ic1wiXG5jb25zdCBKT0JTX0lOREVYX0NPTFVNTl9OQU1FUyA9IFtcbiAgXCJqb2JfbmFtZVwiLFxuICBcInF1ZXVlXCIsXG4gIFwic3RhdHVzXCIsXG4gIFwic2NoZWR1bGVkX2F0X21zXCIsXG4gIFwiY3JlYXRlZF9hdF9tc1wiLFxuICBcInNjaGVkdWxlX2tleVwiLFxuICBcImhhbmRlZF9vZmZfYXRfbXNcIixcbiAgXCJvcnBoYW5lZF9hdF9tc1wiLFxuICBcImNvbmN1cnJlbmN5X2tleVwiXG5dXG5jb25zdCBJREVNUE9URU5DWV9LRVlTX1RBQkxFID0gXCJiYWNrZ3JvdW5kX2pvYl9pZGVtcG90ZW5jeV9rZXlzXCJcbmNvbnN0IFNDSEVEVUxFX0tFWVNfVEFCTEUgPSBcImJhY2tncm91bmRfam9iX3NjaGVkdWxlX2tleXNcIlxuY29uc3QgU0NIRURVTEVfT1JERVJfV0FURVJNQVJLU19UQUJMRSA9IFwiYmFja2dyb3VuZF9qb2Jfc2NoZWR1bGVfb3JkZXJfd2F0ZXJtYXJrc1wiXG5jb25zdCBTQ0hFRFVMRV9PUkRFUl9XQVRFUk1BUktfTUlHUkFUSU9OX1ZFUlNJT04gPSBcIjIwMjYwOTExMTIwMDAwXCJcbmNvbnN0IFNDSEVEVUxFX0hJU1RPUllfT1JERVJfSU5ERVggPSBcImluZGV4X2JhY2tncm91bmRfam9ic19zY2hlZHVsZV9oaXN0b3J5X29yZGVyXCJcbmNvbnN0IENPTkNVUlJFTkNZX1RBQkxFID0gXCJiYWNrZ3JvdW5kX2pvYl9jb25jdXJyZW5jeVwiXG5jb25zdCBDT1VOVFNfUkVWSVNJT05fVEFCTEUgPSBcImJhY2tncm91bmRfam9iX2NvdW50X3JldmlzaW9uc1wiXG5jb25zdCBDT1VOVFNfUkVWSVNJT05fS0VZID0gXCJjb3VudHNcIlxuY29uc3QgQ09OQ1VSUkVOQ1lfUkVDT05DSUxJQVRJT05fTE9DSyA9IFwiYmFja2dyb3VuZC1qb2JzOnF1ZXVlLWNvbmN1cnJlbmN5LXJlY29uY2lsZVwiXG5jb25zdCBDT05DVVJSRU5DWV9SRVBBSVJfU0FNUExFX0xJTUlUID0gMTBcbmV4cG9ydCBjb25zdCBCQUNLR1JPVU5EX0pPQl9DT1VOVFNfQ0hBTk5FTCA9IFwidmVsb2Npb3VzLWJhY2tncm91bmQtam9iLWNvdW50c1wiXG5leHBvcnQgY29uc3QgQkFDS0dST1VORF9KT0JfQ09VTlRfQlVDS0VUUyA9IFtcImFsbFwiLCBcInF1ZXVlZFwiLCBcImhhbmRlZF9vZmZcIiwgXCJjb21wbGV0ZWRcIiwgXCJmYWlsZWRcIiwgXCJvcnBoYW5lZFwiXVxuY29uc3QgQ09VTlRFRF9KT0JfU1RBVFVTRVMgPSBCQUNLR1JPVU5EX0pPQl9DT1VOVF9CVUNLRVRTLnNsaWNlKDEpXG5jb25zdCBNQVhfSk9CX1RJTUVPVVRfTVMgPSAyXzE0N180ODNfNjQ3XG5jb25zdCBKT0JfVElNRU9VVF9WQUxJREFUSU9OX01FU1NBR0UgPSBgYmFja2dyb3VuZCBqb2IgdGltZW91dE1zIG11c3QgYmUgYSBmaW5pdGUgbm9uLXBvc2l0aXZlIG51bWJlciBvciBhbiBpbnRlZ2VyIGJldHdlZW4gMSBhbmQgJHtNQVhfSk9CX1RJTUVPVVRfTVN9YFxuY29uc3QgT1JQSEFORURfQUZURVJfTVMgPSAyICogNjAgKiA2MCAqIDEwMDBcblxuLyoqXG4gKiBDb2x1bW5zIHRoZSBkYXNoYm9hcmQgaXMgYWxsb3dlZCB0byBzb3J0IGpvYiBsaXN0aW5ncyBieSwgbWFwcGVkIHRvIHRoZWlyXG4gKiBkYXRhYmFzZSBjb2x1bW4gbmFtZXMuIFJlc3RyaWN0aW5nIHRvIHRoaXMgc2V0IGtlZXBzIHRoZSBzb3J0IHBhcmFtZXRlclxuICogKHdoaWNoIG9yaWdpbmF0ZXMgZnJvbSB1bnRydXN0ZWQgcXVlcnkgc3RyaW5ncykgZnJvbSByZWFjaGluZyByYXcgU1FMLlxuICogQHR5cGUge1JlY29yZDxzdHJpbmcsIHN0cmluZz59XG4gKi9cbmNvbnN0IFNPUlRBQkxFX0NPTFVNTlMgPSB7XG4gIGF0dGVtcHRzOiBcImF0dGVtcHRzXCIsXG4gIGNvbXBsZXRlZEF0TXM6IFwiY29tcGxldGVkX2F0X21zXCIsXG4gIGNyZWF0ZWRBdE1zOiBcImNyZWF0ZWRfYXRfbXNcIixcbiAgZmFpbGVkQXRNczogXCJmYWlsZWRfYXRfbXNcIixcbiAgaGFuZGVkT2ZmQXRNczogXCJoYW5kZWRfb2ZmX2F0X21zXCIsXG4gIHNjaGVkdWxlZEF0TXM6IFwic2NoZWR1bGVkX2F0X21zXCJcbn1cblxuLyoqXG4gKiBTZXJpYWxpemVzIGNvbmN1cnJlbnQgYF9hcHBseVNjaGVtYWAgcnVucyB3aXRoaW4gVEhJUyBwcm9jZXNzLCBrZXllZCBieSBkYXRhYmFzZVxuICogaWRlbnRpZmllciwgYmVmb3JlIGNhbGxlcnMgd2l0aG91dCBhbiBleGlzdGluZyBjb25uZWN0aW9uIGNoZWNrIG9uZSBvdXQuIFR3b1xuICogc3RvcmVzIHRoYXQgc2hhcmUgb25lIGNvbm5lY3Rpb24gKFNpbmdsZU11bHRpVXNlIC8gU1FMaXRlKVxuICogb3RoZXJ3aXNlIGludGVybGVhdmUgdGhlIG11bHRpLXN0ZXAgdGFibGUgcmVidWlsZCBhbmQgY29ycnVwdCBpdCAodGhlIGpvYnMgdGFibGVcbiAqIGlzIGxlZnQgYXMgaXRzIGAqX3ZlbG9jaW91c19yZWJ1aWxkYCB0ZW1wKS4gQSBEQiBhZHZpc29yeSBsb2NrIGNhbid0IGZpeCB0aGF0OiBvblxuICogYSBzZXNzaW9uLXNjb3BlZCAvIHJlLWVudHJhbnQgZHJpdmVyIChNeVNRTCBgR0VUX0xPQ0tgKSBhIHNlY29uZCBhY3F1aXJlIG9uIHRoZVxuICogc2FtZSBzZXNzaW9uIHN1Y2NlZWRzIGltbWVkaWF0ZWx5IHNvIGJvdGggY2FsbGVycyBwcm9jZWVkLCBhbmQgdGFraW5nIGl0IG9uIGFcbiAqIHNlcGFyYXRlIGNvbm5lY3Rpb24gYmxvY2tzIGNyb3NzLXNlc3Npb24gZm9yZXZlci4gQW4gaW4tcHJvY2VzcyBwcm9taXNlLWNoYWluXG4gKiBtdXRleCBzZXJpYWxpemVzIHNhbWUtcHJvY2VzcyBjYWxsZXJzIHdpdGggbmVpdGhlciBoYXphcmQuIENyb3NzLXByb2Nlc3Mgc2NoZW1hXG4gKiByYWNlcyBzdGF5IGNvdmVyZWQgYnkgdGhlIHBlci1zdGVwIGFkdmlzb3J5IGxvY2tzICsgcmVjaGVja3MgaW5zaWRlIHRoZSBzdGVwcy5cbiAqIEB0eXBlIHtNYXA8c3RyaW5nLCBQcm9taXNlPHZvaWQ+Pn1cbiAqL1xuY29uc3Qgc2NoZW1hQXBwbHlDaGFpbnMgPSBuZXcgTWFwKClcbi8qKiBAdHlwZSB7TWFwPHN0cmluZywgUHJvbWlzZTx2b2lkPj59ICovXG5jb25zdCB0cmFuc2FjdGlvbk11dGF0aW9uQ2hhaW5zID0gbmV3IE1hcCgpXG5cbmV4cG9ydCBkZWZhdWx0IGNsYXNzIEJhY2tncm91bmRKb2JzU3RvcmUgZXh0ZW5kcyBCYWNrZ3JvdW5kSm9ic0FkYXB0ZXIge1xuICAvKipcbiAgICogUnVucyBjb25zdHJ1Y3Rvci5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBPcHRpb25zLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL2NvbmZpZ3VyYXRpb24uanNcIikuZGVmYXVsdH0gYXJncy5jb25maWd1cmF0aW9uIC0gQ29uZmlndXJhdGlvbi5cbiAgICogQHBhcmFtIHtzdHJpbmd9IFthcmdzLmRhdGFiYXNlSWRlbnRpZmllcl0gLSBEYXRhYmFzZSBpZGVudGlmaWVyLlxuICAgKiBAcGFyYW0ge3tub3c6ICgpID0+IG51bWJlcn19IFthcmdzLmNsb2NrXSAtIEluamVjdGFibGUgcGVyc2lzdGVuY2UgY2xvY2suXG4gICAqIEBwYXJhbSB7KHByb2R1Y2VyUHJvb2Y6IGltcG9ydChcIi4vdHlwZXMuanNcIikuQmFja2dyb3VuZEpvYlByb2R1Y2VyUHJvb2YpID0+IHZvaWQgfCBQcm9taXNlPHZvaWQ+fSBbYXJncy5hZnRlck93bmVkUHJvZHVjZXJWYWxpZGF0aW9uXSAtIEV4YWN0IG93bmVkLWVucXVldWUgdmFsaWRhdGlvbiBob29rLlxuICAgKiBAcGFyYW0geyhtZXRhZGF0YTogQmFja2dyb3VuZEpvYlBydW5lQ2FuZGlkYXRlTWV0YWRhdGEpID0+IHZvaWQgfCBQcm9taXNlPHZvaWQ+fSBbYXJncy5hZnRlclBydW5lQ2FuZGlkYXRlc1NlbGVjdGVkXSAtIE9wdGlvbmFsIGJhcnJpZXIgaW52b2tlZCBhZnRlciBvbmUgcmV0ZW50aW9uIGJhdGNoJ3MgY2FuZGlkYXRlIGRpc2NvdmVyeSBhbmQgYmVmb3JlIGl0cyBzZXJpYWxpemVkIGRlbGV0ZSB0cmFuc2FjdGlvbi5cbiAgICovXG4gIGNvbnN0cnVjdG9yKHtjb25maWd1cmF0aW9uLCBkYXRhYmFzZUlkZW50aWZpZXIsIGNsb2NrLCBhZnRlck93bmVkUHJvZHVjZXJWYWxpZGF0aW9uLCBhZnRlclBydW5lQ2FuZGlkYXRlc1NlbGVjdGVkfSkge1xuICAgIHN1cGVyKClcbiAgICB0aGlzLmNvbmZpZ3VyYXRpb24gPSBjb25maWd1cmF0aW9uXG4gICAgdGhpcy5kYXRhYmFzZUlkZW50aWZpZXIgPSBkYXRhYmFzZUlkZW50aWZpZXJcbiAgICB0aGlzLmNsb2NrID0gY2xvY2sgfHwge25vdzogKCkgPT4gRGF0ZS5ub3coKX1cbiAgICB0aGlzLmFmdGVyT3duZWRQcm9kdWNlclZhbGlkYXRpb24gPSBhZnRlck93bmVkUHJvZHVjZXJWYWxpZGF0aW9uXG4gICAgdGhpcy5hZnRlclBydW5lQ2FuZGlkYXRlc1NlbGVjdGVkID0gYWZ0ZXJQcnVuZUNhbmRpZGF0ZXNTZWxlY3RlZFxuICAgIHRoaXMubG9nZ2VyID0gbmV3IExvZ2dlcih0aGlzKVxuICAgIHRoaXMuX3JlYWR5UHJvbWlzZSA9IG51bGxcbiAgICB0aGlzLl9xdWV1ZUNvbmN1cnJlbmN5UmVjb25jaWxlZCA9IGZhbHNlXG4gIH1cblxuICAvKipcbiAgICogUnVucyBnZXQgZGF0YWJhc2UgaWRlbnRpZmllci5cbiAgICogQHJldHVybnMge3N0cmluZ30gLSBEYXRhYmFzZSBpZGVudGlmaWVyLlxuICAgKi9cbiAgZ2V0RGF0YWJhc2VJZGVudGlmaWVyKCkge1xuICAgIGlmICh0aGlzLmRhdGFiYXNlSWRlbnRpZmllcikgcmV0dXJuIHRoaXMuZGF0YWJhc2VJZGVudGlmaWVyXG5cbiAgICByZXR1cm4gdGhpcy5jb25maWd1cmF0aW9uLmdldEJhY2tncm91bmRKb2JzQ29uZmlnKCkuZGF0YWJhc2VJZGVudGlmaWVyXG4gIH1cblxuICAvKipcbiAgICogUnVucyBlbnN1cmUgcmVhZHkuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIHdoZW4gcmVhZHkuXG4gICAqL1xuICBhc3luYyBlbnN1cmVSZWFkeSgpIHtcbiAgICBpZiAodGhpcy5fcmVhZHlQcm9taXNlKSByZXR1cm4gYXdhaXQgdGhpcy5fcmVhZHlQcm9taXNlXG5cbiAgICB0aGlzLl9yZWFkeVByb21pc2UgPSAoYXN5bmMgKCkgPT4ge1xuICAgICAgdGhpcy5jb25maWd1cmF0aW9uLnNldEN1cnJlbnQoKVxuICAgICAgYXdhaXQgdGhpcy5fZW5zdXJlU2NoZW1hKClcbiAgICAgIGF3YWl0IHRoaXMuX2luaXRpYWxpemVNb2RlbCgpXG4gICAgfSkoKVxuXG4gICAgdHJ5IHtcbiAgICAgIGF3YWl0IHRoaXMuX3JlYWR5UHJvbWlzZVxuICAgIH0gZmluYWxseSB7XG4gICAgICB0aGlzLl9yZWFkeVByb21pc2UgPSBudWxsXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIEVuc3VyZXMgdGhlIGJhY2tncm91bmQtam9icyBzY2hlbWEgKHRhYmxlcyArIGNvbHVtbnMpIGV4aXN0cyBvbiB0aGUgY29uZmlndXJlZFxuICAgKiBkYXRhYmFzZSwgd2l0aG91dCBpbml0aWFsaXppbmcgdGhlIHJ1bnRpbWUgbW9kZWwuIExldHMgYGRiOm1pZ3JhdGVgIGNyZWF0ZSB0aGVcbiAgICogZnJhbWV3b3JrJ3Mgb3duIHNjaGVtYSBkZXRlcm1pbmlzdGljYWxseSBhbG9uZ3NpZGUgYXBwIG1pZ3JhdGlvbnMg4oCUIGFuZCBjYXB0dXJlXG4gICAqIGl0IGluIHRoZSBkdW1wZWQgc3RydWN0dXJlIFNRTCDigJQgaW5zdGVhZCBvZiBpdCBvbmx5IGFwcGVhcmluZyBvbmNlIGEgc3RvcmUgYm9vdHMuXG4gICAqIElkZW1wb3RlbnQ6IHJldXNlcyB0aGUgc2FtZSBgX2Vuc3VyZVNjaGVtYWAgdGhlIHJ1bnRpbWUgc3RvcmUgdXNlcywgd2hpY2ggc2tpcHNcbiAgICogd29yayBhbHJlYWR5IGFwcGxpZWQgKHRyYWNrZWQgaW4gYHZlbG9jaW91c19pbnRlcm5hbF9taWdyYXRpb25zYCkuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vZGF0YWJhc2UvZHJpdmVycy9iYXNlLmpzXCIpLmRlZmF1bHR9IFtkYl0gLSBSZXVzZSBhbiBhbHJlYWR5XG4gICAqICAgY2hlY2tlZC1vdXQgY29ubmVjdGlvbiAoZS5nLiB0aGUgb25lIGBkYjptaWdyYXRlYCBob2xkcykgcmF0aGVyIHRoYW4gb3BlbmluZyBhXG4gICAqICAgbmVzdGVkIGNoZWNrb3V0IHRoYXQgd291bGQgZGVhZGxvY2sgYSBzaW5nbGUtY29ubmVjdGlvbiBwb29sLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyB3aGVuIHRoZSBzY2hlbWEgaXMgcHJlc2VudC5cbiAgICovXG4gIGFzeW5jIGVuc3VyZVNjaGVtYShkYikge1xuICAgIC8vIFdoZW4gYSBjb25uZWN0aW9uIGlzIGhhbmRlZCBpbiAodGhlIGRiOm1pZ3JhdGUgcGF0aCksIHRoZSBjYWxsZXIgYWxyZWFkeSBvd25zXG4gICAgLy8gdGhlIGFjdGl2ZSBjb25maWd1cmF0aW9uICsgY29ubmVjdGlvbiBjb250ZXh0OyBjYWxsaW5nIHNldEN1cnJlbnQoKSBoZXJlIHdvdWxkXG4gICAgLy8gY2xvYmJlciBpdCAoZS5nLiB0aGUgYnJvd3NlciB0ZXN0IHJ1bm5lciBqdWdnbGVzIG11bHRpcGxlIGNvbmZpZ3VyYXRpb25zKS5cbiAgICBpZiAoIWRiKSB0aGlzLmNvbmZpZ3VyYXRpb24uc2V0Q3VycmVudCgpXG5cbiAgICBhd2FpdCB0aGlzLl9lbnN1cmVTY2hlbWEoZGIpXG4gIH1cblxuICAvKipcbiAgICogUmVjb25jaWxlcyBxdWV1ZS1kZXJpdmVkIGNvbmN1cnJlbmN5IHdpdGggdGhlIGN1cnJlbnQgY29uZmlndXJhdGlvbjogdGhlXG4gICAqIGV4cGxpY2l0IGxpZmVjeWNsZSBwYXRoIHRoYXQgYWRvcHRzL3JlbGVhc2VzIHBlcnNpc3RlZCBxdWV1ZWQgam9icyBvbnRvXG4gICAqIHF1ZXVlIGNvbmN1cnJlbmN5IGtleXMgd2hlbiBgcXVldWVzW25hbWVdLm1heENvbmN1cnJlbnRgIGlzIGFkZGVkLCByZW1vdmVkLFxuICAgKiBvciBjaGFuZ2VkLiBDYWxsZWQgYnkgdGhlIGJhY2tncm91bmQtam9icyBtYWluIHByb2Nlc3Mgb24gc3RhcnR1cCDigJQgdGhlXG4gICAqIGRlcGxveS10aW1lIG1vbWVudCBxdWV1ZSBjb25maWd1cmF0aW9uIGNoYW5nZXMgdGFrZSBlZmZlY3QuIFNjaGVtYS90ZW5hbnRcbiAgICogY2hlY2tzIGFuZCByb3V0aW5lIGNvbm5lY3Rpb24gaW5pdGlhbGl6YXRpb24gZGVsaWJlcmF0ZWx5IG5ldmVyIHJ1biB0aGlzOlxuICAgKiB0aGV5IHN0YXkgcmVhZC1vbmx5IHJlZ2FyZGluZyBxdWV1ZWQgam9iIHJvd3MsIGJlY2F1c2UgdGhlIGJyb2FkXG4gICAqIGFkb3B0aW9uL3JlbGVhc2UgVVBEQVRFcyBkZWFkbG9jayBhZ2FpbnN0IGFjdGl2ZSBqb2IgcHJvY2Vzc2VzIHVuZGVyXG4gICAqIGNvbmN1cnJlbnQgdGVuYW50IGluaXRpYWxpemF0aW9uLiBTZXJpYWxpemVkIGFjcm9zcyBwcm9jZXNzZXMgd2l0aCBhXG4gICAqIGRhdGFiYXNlIGFkdmlzb3J5IGxvY2sgc28gY29uY3VycmVudGx5IHN0YXJ0ZWQgbWFpbnMgY2Fubm90IGludGVybGVhdmUgdGhlXG4gICAqIFVQREFURXM7IHRoZSBwZXItaW5zdGFuY2UgbWVtbyBvbmx5IHNraXBzIHJlcGVhdCB3b3JrIHdpdGhpbiB0aGlzIHByb2Nlc3MuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIHdoZW4gcmVjb25jaWxlZC5cbiAgICovXG4gIGFzeW5jIHJlY29uY2lsZVF1ZXVlQ29uY3VycmVuY3koKSB7XG4gICAgaWYgKHRoaXMuX3F1ZXVlQ29uY3VycmVuY3lSZWNvbmNpbGVkKSByZXR1cm5cblxuICAgIGNvbnN0IGRhdGFiYXNlSWRlbnRpZmllciA9IHRoaXMuZ2V0RGF0YWJhc2VJZGVudGlmaWVyKClcbiAgICBjb25zdCBzdGFydGVkQXRNcyA9IERhdGUubm93KClcblxuICAgIGF3YWl0IHRoaXMubG9nZ2VyLmluZm8oKCkgPT4gW1xuICAgICAgXCJTdGFydGluZyBiYWNrZ3JvdW5kIGpvYnMgcXVldWUtY29uY3VycmVuY3kgc3RhcnR1cCByZWNvbmNpbGlhdGlvblwiLFxuICAgICAge2RhdGFiYXNlSWRlbnRpZmllcn1cbiAgICBdKVxuICAgIGF3YWl0IHRoaXMuZW5zdXJlUmVhZHkoKVxuXG4gICAgYXdhaXQgdGhpcy5fd2l0aERiKGFzeW5jIChkYikgPT4ge1xuICAgICAgY29uc3QgYWNxdWlyZWQgPSBhd2FpdCBkYi5hY3F1aXJlQWR2aXNvcnlMb2NrKENPTkNVUlJFTkNZX1JFQ09OQ0lMSUFUSU9OX0xPQ0spXG5cbiAgICAgIGlmICghYWNxdWlyZWQpIHRocm93IG5ldyBFcnJvcihcIkZhaWxlZCB0byBhY3F1aXJlIGJhY2tncm91bmQgam9iIHF1ZXVlLWNvbmN1cnJlbmN5IHJlY29uY2lsZSBsb2NrXCIpXG5cbiAgICAgIHRyeSB7XG4gICAgICAgIGF3YWl0IHRoaXMuX3JlY29uY2lsZVF1ZXVlQ29uY3VycmVuY3koZGIpXG4gICAgICAgIGF3YWl0IHRoaXMuX3JlY29uY2lsZUNvbmN1cnJlbmN5KGRiKVxuXG4gICAgICAgIC8vIExhdGNoIHRoZSBtZW1vIG9ubHkgYWZ0ZXIgQk9USCBzdGVwcyBzdWNjZWVkOiBpZiB0aGUgY291bnQgcmVidWlsZFxuICAgICAgICAvLyBmYWlscyBhZnRlciBhZG9wdGlvbiwgYSByZXRyeSBvbiB0aGlzIHN0b3JlIG11c3QgcmUtZW50ZXIgYW5kIHJlcGFpclxuICAgICAgICAvLyB0aGUgY291bnRzIChhZG9wdGlvbiBpdHNlbGYgaXMgaWRlbXBvdGVudCkuXG4gICAgICAgIHRoaXMuX3F1ZXVlQ29uY3VycmVuY3lSZWNvbmNpbGVkID0gdHJ1ZVxuICAgICAgfSBmaW5hbGx5IHtcbiAgICAgICAgYXdhaXQgZGIucmVsZWFzZUFkdmlzb3J5TG9jayhDT05DVVJSRU5DWV9SRUNPTkNJTElBVElPTl9MT0NLKVxuICAgICAgfVxuICAgIH0pXG5cbiAgICBhd2FpdCB0aGlzLmxvZ2dlci5pbmZvKCgpID0+IFtcbiAgICAgIFwiQ29tcGxldGVkIGJhY2tncm91bmQgam9icyBxdWV1ZS1jb25jdXJyZW5jeSBzdGFydHVwIHJlY29uY2lsaWF0aW9uXCIsXG4gICAgICB7ZGF0YWJhc2VJZGVudGlmaWVyLCBkdXJhdGlvbk1zOiBEYXRlLm5vdygpIC0gc3RhcnRlZEF0TXN9XG4gICAgXSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSZXBhaXJzIGR1cmFibGUgYWN0aXZlLWNvdW50IGRyaWZ0IHdoaWxlIGEgbWFpbiBwcm9jZXNzIHJlbWFpbnMgbGl2ZS4gVGhlXG4gICAqIGluaXRpYWwgc25hcHNob3QgaXMgcmVhZC1vbmx5OyBvbmx5IHN1c3BlY3RlZCBtaXNtYXRjaGVzIHRha2UgdGhlaXJcbiAgICogY291bnRlciBsb2NrIGFuZCByZS1jb3VudCBpbnNpZGUgdGhlIHNlcmlhbGl6ZWQgdHJhbnNhY3Rpb24gcGF0aC5cbiAgICogQHJldHVybnMge1Byb21pc2U8aW1wb3J0KFwiLi90eXBlcy5qc1wiKS5CYWNrZ3JvdW5kSm9iQ29uY3VycmVuY3lSZWNvbmNpbGlhdGlvbj59IC0gUmVwYWlyIHN1bW1hcnkuXG4gICAqL1xuICBhc3luYyByZWNvbmNpbGVBY3RpdmVDb25jdXJyZW5jeSgpIHtcbiAgICBjb25zdCBkYXRhYmFzZUlkZW50aWZpZXIgPSB0aGlzLmdldERhdGFiYXNlSWRlbnRpZmllcigpXG4gICAgY29uc3Qgc3RhcnRlZEF0TXMgPSBEYXRlLm5vdygpXG5cbiAgICBhd2FpdCB0aGlzLmVuc3VyZVJlYWR5KClcblxuICAgIGNvbnN0IHJlc3VsdCA9IGF3YWl0IHRoaXMuX3NlcmlhbGl6ZWRDb25uZWN0aW9uTXV0YXRpb24oXG4gICAgICBhc3luYyAoZGIpID0+IGF3YWl0IHRoaXMuX3JlY29uY2lsZUNvbmN1cnJlbmN5KGRiKSxcbiAgICAgIHtcbiAgICAgICAgYWR2aXNvcnlMb2NrOiB7XG4gICAgICAgICAgZmFpbHVyZU1lc3NhZ2U6IFwiRmFpbGVkIHRvIGFjcXVpcmUgYmFja2dyb3VuZCBqb2IgYWN0aXZlLWNvbmN1cnJlbmN5IHJlY29uY2lsZSBsb2NrXCIsXG4gICAgICAgICAgbmFtZTogQ09OQ1VSUkVOQ1lfUkVDT05DSUxJQVRJT05fTE9DS1xuICAgICAgICB9XG4gICAgICB9XG4gICAgKVxuXG4gICAgaWYgKHJlc3VsdC5yZXBhaXJlZENvdW50ID4gMCkge1xuICAgICAgYXdhaXQgdGhpcy5sb2dnZXIud2FybigoKSA9PiBbXG4gICAgICAgIFwiUmVwYWlyZWQgYmFja2dyb3VuZCBqb2JzIGFjdGl2ZS1jb25jdXJyZW5jeSBjb3VudCBkcmlmdFwiLFxuICAgICAgICB7XG4gICAgICAgICAgZGF0YWJhc2VJZGVudGlmaWVyLFxuICAgICAgICAgIGR1cmF0aW9uTXM6IERhdGUubm93KCkgLSBzdGFydGVkQXRNcyxcbiAgICAgICAgICByZXBhaXJlZENvdW50OiByZXN1bHQucmVwYWlyZWRDb3VudCxcbiAgICAgICAgICByZXBhaXJzOiByZXN1bHQucmVwYWlycyxcbiAgICAgICAgICByZXBhaXJzVHJ1bmNhdGVkQ291bnQ6IHJlc3VsdC5yZXBhaXJzVHJ1bmNhdGVkQ291bnRcbiAgICAgICAgfVxuICAgICAgXSlcbiAgICB9XG5cbiAgICByZXR1cm4gcmVzdWx0XG4gIH1cblxuICAvKipcbiAgICogUnVucyBlbnF1ZXVlLlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIE9wdGlvbnMuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBhcmdzLmpvYk5hbWUgLSBKb2IgbmFtZS5cbiAgICogQHBhcmFtIHtBcnJheTxSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59IGFyZ3MuYXJncyAtIEFyZ3VtZW50cy5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL3R5cGVzLmpzXCIpLkJhY2tncm91bmRKb2JPcHRpb25zfSBbYXJncy5vcHRpb25zXSAtIE9wdGlvbnMuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHN0cmluZz59IC0gSm9iIGlkLlxuICAgKi9cbiAgYXN5bmMgZW5xdWV1ZSh7am9iTmFtZSwgYXJncywgb3B0aW9uc30pIHtcbiAgICBhd2FpdCB0aGlzLmVuc3VyZVJlYWR5KClcblxuICAgIGNvbnN0IHByZXBhcmVkSm9iID0gdGhpcy5fcHJlcGFyZUpvYih7am9iTmFtZSwgYXJncywgb3B0aW9uc30pXG5cbiAgICBpZiAob3B0aW9ucz8uaWRlbXBvdGVuY3lLZXkgIT09IHVuZGVmaW5lZCkge1xuICAgICAgcmV0dXJuIGF3YWl0IHRoaXMuX2VucXVldWVJZGVtcG90ZW50bHkoe2FyZ3M6IGFyZ3MgfHwgW10sIG9wdGlvbnMsIHByZXBhcmVkSm9ifSlcbiAgICB9XG5cbiAgICAvKiogQHR5cGUge3N0cmluZ30gKi9cbiAgICBsZXQgcmVzdWx0Sm9iSWQgPSBwcmVwYXJlZEpvYi5qb2JJZFxuXG4gICAgYXdhaXQgdGhpcy5fc2VyaWFsaXplZENvdW50TXV0YXRpb24oYXN5bmMgKGRiKSA9PiB7XG4gICAgICBpZiAob3B0aW9ucz8uZGVkdXBsaWNhdGVXaGlsZVF1ZXVlZCkge1xuICAgICAgICBjb25zdCBkdXBsaWNhdGVKb2JJZCA9IGF3YWl0IHRoaXMuX2RlZHVwbGljYXRlZFF1ZXVlZEpvYklkKGRiLCBwcmVwYXJlZEpvYilcblxuICAgICAgICBpZiAoZHVwbGljYXRlSm9iSWQpIHtcbiAgICAgICAgICByZXN1bHRKb2JJZCA9IGR1cGxpY2F0ZUpvYklkXG4gICAgICAgICAgcmV0dXJuXG4gICAgICAgIH1cbiAgICAgIH1cblxuICAgICAgYXdhaXQgdGhpcy5faW5zZXJ0UHJlcGFyZWRKb2IoZGIsIHtwcmVwYXJlZEpvYiwgc2NoZWR1bGVLZXk6IG51bGx9KVxuICAgICAgYXdhaXQgdGhpcy5fcmVjb3JkQ291bnREZWx0YShkYiwge2FsbDogMSwgcXVldWVkOiAxfSlcbiAgICB9KVxuXG4gICAgcmV0dXJuIHJlc3VsdEpvYklkXG4gIH1cblxuICAvKipcbiAgICogQXRvbWljYWxseSB2YWxpZGF0ZXMgYW4gZXhhY3QgcHJvZHVjaW5nIGhhbmRvZmYgYW5kIGVucXVldWVzIGl0cyBmb2xsb3ctdXAuXG4gICAqIEV2ZXJ5IGV4YWN0IHJlcXVlc3Qgb3ducyBhbiBpbnRlcm5hbCBkdXJhYmxlIHJlcGxheSBpZGVudGl0eSwgd2hpbGUgcXVldWVkXG4gICAqIGRlZHVwbGljYXRpb24gY2FuIHBvaW50IHNldmVyYWwgZGlzdGluY3QgcHJvZHVjZXIgZXZlbnRzIGF0IG9uZSBjb3ZlcmluZyByb3cuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gT3duZWQgZW5xdWV1ZSByZXF1ZXN0LlxuICAgKiBAcGFyYW0ge3N0cmluZ30gYXJncy5qb2JOYW1lIC0gSm9iIG5hbWUuXG4gICAqIEBwYXJhbSB7QXJyYXk8UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSBhcmdzLmFyZ3MgLSBBcmd1bWVudHMuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi90eXBlcy5qc1wiKS5CYWNrZ3JvdW5kSm9iT3B0aW9uc30gW2FyZ3Mub3B0aW9uc10gLSBPcHRpb25zLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gW2FyZ3MucHJvZHVjZXJJbnZvY2F0aW9uSWRdIC0gU3RhYmxlIGlkZW50aXR5IGZvciBvbmUgb3duZWQgZW5xdWV1ZSBpbnZvY2F0aW9uLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vdHlwZXMuanNcIikuQmFja2dyb3VuZEpvYlByb2R1Y2VyUHJvb2Z9IGFyZ3MucHJvZHVjZXJQcm9vZiAtIEV4YWN0IHByb2R1Y2VyIGxlYXNlLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxzdHJpbmc+fSAtIER1cmFibGUgZm9sbG93LXVwIGlkLlxuICAgKi9cbiAgYXN5bmMgZW5xdWV1ZUZyb21Pd25lZEhhbmRvZmYoe2pvYk5hbWUsIGFyZ3MsIG9wdGlvbnMsIHByb2R1Y2VySW52b2NhdGlvbklkLCBwcm9kdWNlclByb29mfSkge1xuICAgIGF3YWl0IHRoaXMuZW5zdXJlUmVhZHkoKVxuXG4gICAgY29uc3Qgbm9ybWFsaXplZFByb2R1Y2VyUHJvb2YgPSB0aGlzLl9ub3JtYWxpemVQcm9kdWNlclByb29mKHByb2R1Y2VyUHJvb2YpXG4gICAgY29uc3Qgbm9ybWFsaXplZFByb2R1Y2VySW52b2NhdGlvbklkID0gdGhpcy5fbm9ybWFsaXplUHJvZHVjZXJJbnZvY2F0aW9uSWQocHJvZHVjZXJJbnZvY2F0aW9uSWQpXG4gICAgY29uc3QgcHJlcGFyZWRKb2IgPSB0aGlzLl9wcmVwYXJlSm9iKHtqb2JOYW1lLCBhcmdzLCBvcHRpb25zfSlcblxuICAgIHJldHVybiBhd2FpdCB0aGlzLl9zZXJpYWxpemVkQ291bnRNdXRhdGlvbihhc3luYyAoZGIpID0+IHtcbiAgICAgIGF3YWl0IHRoaXMuX3ZhbGlkYXRlT3duZWRQcm9kdWNlclByb29mKGRiLCBub3JtYWxpemVkUHJvZHVjZXJQcm9vZilcbiAgICAgIGlmICh0aGlzLmFmdGVyT3duZWRQcm9kdWNlclZhbGlkYXRpb24pIGF3YWl0IHRoaXMuYWZ0ZXJPd25lZFByb2R1Y2VyVmFsaWRhdGlvbihub3JtYWxpemVkUHJvZHVjZXJQcm9vZilcblxuICAgICAgaWYgKG9wdGlvbnM/LmlkZW1wb3RlbmN5S2V5ICE9PSB1bmRlZmluZWQpIHtcbiAgICAgICAgcmV0dXJuIGF3YWl0IHRoaXMuX2VucXVldWVJZGVtcG90ZW50bHlJblRyYW5zYWN0aW9uKHtcbiAgICAgICAgICBhcmdzOiBhcmdzIHx8IFtdLFxuICAgICAgICAgIGNvdW50UmV2aXNpb25Mb2NrZWQ6IHRydWUsXG4gICAgICAgICAgZGIsXG4gICAgICAgICAgb3B0aW9ucyxcbiAgICAgICAgICBwcmVwYXJlZEpvYlxuICAgICAgICB9KVxuICAgICAgfVxuXG4gICAgICByZXR1cm4gYXdhaXQgdGhpcy5fZW5xdWV1ZU93bmVkUmVwbGF5SW5UcmFuc2FjdGlvbih7XG4gICAgICAgIGRiLFxuICAgICAgICBvcHRpb25zOiBvcHRpb25zIHx8IHt9LFxuICAgICAgICBwcmVwYXJlZEpvYixcbiAgICAgICAgcHJvZHVjZXJJbnZvY2F0aW9uSWQ6IG5vcm1hbGl6ZWRQcm9kdWNlckludm9jYXRpb25JZCxcbiAgICAgICAgcHJvZHVjZXJQcm9vZjogbm9ybWFsaXplZFByb2R1Y2VyUHJvb2ZcbiAgICAgIH0pXG4gICAgfSlcbiAgfVxuXG4gIC8qKlxuICAgKiBGaW5kcyB0aGUgZWFybGllc3QgcXVldWVkIGpvYiB0aGF0IGNvdmVycyB0aGlzIGVucXVldWUncyBpZGVudGl0eSBhbmQgdGltZS5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9kYXRhYmFzZS9kcml2ZXJzL2Jhc2UuanNcIikuZGVmYXVsdH0gZGIgLSBUcmFuc2FjdGlvbiBjb25uZWN0aW9uLlxuICAgKiBAcGFyYW0ge1ByZXBhcmVkQmFja2dyb3VuZEpvYn0gcHJlcGFyZWRKb2IgLSBOb3JtYWxpemVkIGpvYi5cbiAgICogQHJldHVybnMge1Byb21pc2U8c3RyaW5nIHwgbnVsbD59IC0gQ292ZXJpbmcgam9iIGlkLlxuICAgKi9cbiAgYXN5bmMgX2RlZHVwbGljYXRlZFF1ZXVlZEpvYklkKGRiLCBwcmVwYXJlZEpvYikge1xuICAgIC8vIERlZHVwZSBvbiB0aGUgam9iJ3MgaWRlbnRpdHkgKG5hbWUgKyBhcmdzICsgcXVldWUpLCBOT1QgaXRzIGNvbmN1cnJlbmN5IGtleSwgc28gYSBqb2JcbiAgICAvLyBrZWVwcyB3aGF0ZXZlciBjb25jdXJyZW5jeSBpdCByZXNvbHZlcyB0by4gT25seSBhbiBleGlzdGluZyBqb2Igc2NoZWR1bGVkIG5vIGxhdGVyIHRoYW5cbiAgICAvLyB0aGlzIGVucXVldWUgY2FuIGNvdmVyIGl0OyBhIHJldHJ5IGJhY2tlZCBvZmYgaW50byB0aGUgZnV0dXJlIG11c3Qgbm90IHN1cHByZXNzIGVhcmxpZXJcbiAgICAvLyB3b3JrLiBPcmRlcmluZyByZXR1cm5zIHRoZSBlYXJsaWVzdCBjb3ZlcmluZyBqb2Igd2hlbiBzZXZlcmFsIHF1ZXVlZCByb3dzIGFscmVhZHkgZXhpc3QuXG4gICAgY29uc3QgZXhpc3RpbmcgPSBhd2FpdCBkYlxuICAgICAgLm5ld1F1ZXJ5KClcbiAgICAgIC5mcm9tKEpPQlNfVEFCTEUpXG4gICAgICAuc2VsZWN0KFwiaWRcIilcbiAgICAgIC53aGVyZSh7c3RhdHVzOiBcInF1ZXVlZFwiLCBqb2JfbmFtZTogcHJlcGFyZWRKb2Iuam9iTmFtZSwgYXJnc19qc29uOiBwcmVwYXJlZEpvYi5hcmdzSnNvbiwgcXVldWU6IHByZXBhcmVkSm9iLnF1ZXVlfSlcbiAgICAgIC53aGVyZShgc2NoZWR1bGVkX2F0X21zIDw9ICR7ZGIucXVvdGUocHJlcGFyZWRKb2Iuc2NoZWR1bGVkQXRNcyl9YClcbiAgICAgIC5vcmRlcihcInNjaGVkdWxlZF9hdF9tcyBBU0NcIilcbiAgICAgIC5saW1pdCgxKVxuICAgICAgLnJlc3VsdHMoKVxuICAgIGNvbnN0IHJvdyA9IGV4aXN0aW5nWzBdXG5cbiAgICByZXR1cm4gcm93ID8gU3RyaW5nKC8qKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSAqLyAocm93KS5pZCkgOiBudWxsXG4gIH1cblxuICAvKipcbiAgICogUGVyc2lzdHMgb25lIGludGVybmFsIGV4YWN0LXJlcGxheSBvd25lciBhbmQgaXRzIHF1ZXVlZCBqb2IgaW4gdGhlIGNhbGxlcidzXG4gICAqIHByb2R1Y2VyLXZhbGlkYXRpb24gdHJhbnNhY3Rpb24uXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gVHJhbnNhY3Rpb24gaW5wdXQuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vZGF0YWJhc2UvZHJpdmVycy9iYXNlLmpzXCIpLmRlZmF1bHR9IGFyZ3MuZGIgLSBUcmFuc2FjdGlvbiBjb25uZWN0aW9uLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vdHlwZXMuanNcIikuQmFja2dyb3VuZEpvYk9wdGlvbnN9IGFyZ3Mub3B0aW9ucyAtIEVucXVldWUgb3B0aW9ucy5cbiAgICogQHBhcmFtIHtQcmVwYXJlZEJhY2tncm91bmRKb2J9IGFyZ3MucHJlcGFyZWRKb2IgLSBOb3JtYWxpemVkIGpvYi5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGFyZ3MucHJvZHVjZXJJbnZvY2F0aW9uSWQgLSBTdGFibGUgaWRlbnRpdHkgZm9yIG9uZSBvd25lZCBlbnF1ZXVlIGludm9jYXRpb24uXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi90eXBlcy5qc1wiKS5CYWNrZ3JvdW5kSm9iUHJvZHVjZXJQcm9vZn0gYXJncy5wcm9kdWNlclByb29mIC0gRXhhY3QgcHJvZHVjZXIgbGVhc2UuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHN0cmluZz59IC0gU3RhYmxlIHJlcGxheSBqb2IgaWQuXG4gICAqL1xuICBhc3luYyBfZW5xdWV1ZU93bmVkUmVwbGF5SW5UcmFuc2FjdGlvbih7ZGIsIG9wdGlvbnMsIHByZXBhcmVkSm9iLCBwcm9kdWNlckludm9jYXRpb25JZCwgcHJvZHVjZXJQcm9vZn0pIHtcbiAgICBjb25zdCByZXF1ZXN0RGlnZXN0ID0gdGhpcy5fb3duZWRFbnF1ZXVlUmVxdWVzdERpZ2VzdCh7b3B0aW9ucywgcHJlcGFyZWRKb2J9KVxuICAgIGNvbnN0IHNjb3BlRGlnZXN0ID0gdGhpcy5fb3duZWRFbnF1ZXVlU2NvcGVEaWdlc3Qoe3ByZXBhcmVkSm9iLCBwcm9kdWNlckludm9jYXRpb25JZCwgcHJvZHVjZXJQcm9vZiwgcmVxdWVzdERpZ2VzdH0pXG4gICAgY29uc3QgaWRlbXBvdGVuY3lLZXkgPSBgb3duZWQtaGFuZG9mZjoke3Njb3BlRGlnZXN0fWBcbiAgICBjb25zdCBleGlzdGluZyA9IGF3YWl0IHRoaXMuX2lkZW1wb3RlbmN5T3duZXJzaGlwKGRiLCBzY29wZURpZ2VzdClcbiAgICBjb25zdCBiYXNlT3duZXJzaGlwID0ge1xuICAgICAgY3JlYXRlZF9hdF9tczogcHJlcGFyZWRKb2IuY3JlYXRlZEF0TXMsXG4gICAgICBpZGVtcG90ZW5jeV9rZXk6IGlkZW1wb3RlbmN5S2V5LFxuICAgICAgam9iX25hbWU6IHByZXBhcmVkSm9iLmpvYk5hbWUsXG4gICAgICBxdWV1ZTogcHJlcGFyZWRKb2IucXVldWUsXG4gICAgICByZXF1ZXN0X2RpZ2VzdDogcmVxdWVzdERpZ2VzdCxcbiAgICAgIHNjb3BlX2RpZ2VzdDogc2NvcGVEaWdlc3RcbiAgICB9XG5cbiAgICBpZiAoZXhpc3RpbmcpIHtcbiAgICAgIHRoaXMuX3ZhbGlkYXRlSWRlbXBvdGVuY3lPd25lcnNoaXAoe2V4aXN0aW5nLCBvd25lcnNoaXA6IHsuLi5iYXNlT3duZXJzaGlwLCBqb2JfaWQ6IFN0cmluZyhleGlzdGluZy5qb2JfaWQpfX0pXG4gICAgICByZXR1cm4gU3RyaW5nKGV4aXN0aW5nLmpvYl9pZClcbiAgICB9XG5cbiAgICBjb25zdCBkdXBsaWNhdGVKb2JJZCA9IG9wdGlvbnMuZGVkdXBsaWNhdGVXaGlsZVF1ZXVlZFxuICAgICAgPyBhd2FpdCB0aGlzLl9kZWR1cGxpY2F0ZWRRdWV1ZWRKb2JJZChkYiwgcHJlcGFyZWRKb2IpXG4gICAgICA6IG51bGxcbiAgICBjb25zdCBvd25lcnNoaXAgPSB7Li4uYmFzZU93bmVyc2hpcCwgam9iX2lkOiBkdXBsaWNhdGVKb2JJZCB8fCBwcmVwYXJlZEpvYi5qb2JJZH1cbiAgICBjb25zdCBjbGFpbWVkID0gYXdhaXQgdGhpcy5fY2xhaW1JZGVtcG90ZW5jeU93bmVyc2hpcChkYiwgb3duZXJzaGlwKVxuXG4gICAgaWYgKCFjbGFpbWVkLmNyZWF0ZWQpIHtcbiAgICAgIHRoaXMuX3ZhbGlkYXRlSWRlbXBvdGVuY3lPd25lcnNoaXAoe2V4aXN0aW5nOiBjbGFpbWVkLnJvdywgb3duZXJzaGlwfSlcbiAgICAgIHJldHVybiBTdHJpbmcoY2xhaW1lZC5yb3cuam9iX2lkKVxuICAgIH1cbiAgICBpZiAoZHVwbGljYXRlSm9iSWQpIHJldHVybiBkdXBsaWNhdGVKb2JJZFxuXG4gICAgYXdhaXQgdGhpcy5faW5zZXJ0UHJlcGFyZWRKb2IoZGIsIHtwcmVwYXJlZEpvYiwgc2NoZWR1bGVLZXk6IG51bGx9KVxuICAgIGF3YWl0IHRoaXMuX3JlY29yZENvdW50RGVsdGEoZGIsIHthbGw6IDEsIHF1ZXVlZDogMX0pXG5cbiAgICByZXR1cm4gcHJlcGFyZWRKb2Iuam9iSWRcbiAgfVxuXG4gIC8qKlxuICAgKiBBdG9taWNhbGx5IG93bnMgb25lIGR1cmFibGUgaWRlbXBvdGVuY3kgc2NvcGUgYW5kIGNyZWF0ZXMgaXRzIGpvYiBleGFjdGx5IG9uY2UuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gRW5xdWV1ZSBpbnB1dC5cbiAgICogQHBhcmFtIHtBcnJheTxSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59IGFyZ3MuYXJncyAtIEpvYiBhcmd1bWVudHMuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi90eXBlcy5qc1wiKS5CYWNrZ3JvdW5kSm9iT3B0aW9uc30gYXJncy5vcHRpb25zIC0gSm9iIG9wdGlvbnMuXG4gICAqIEBwYXJhbSB7UHJlcGFyZWRCYWNrZ3JvdW5kSm9ifSBhcmdzLnByZXBhcmVkSm9iIC0gTm9ybWFsaXplZCBqb2IuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHN0cmluZz59IC0gU3RhYmxlIG9yaWdpbmFsIGpvYiBpZC5cbiAgICovXG4gIGFzeW5jIF9lbnF1ZXVlSWRlbXBvdGVudGx5KHthcmdzLCBvcHRpb25zLCBwcmVwYXJlZEpvYn0pIHtcbiAgICAvLyBSZXVzZSBvcmRpbmFyeSBlbnF1ZXVlIHRyYW5zYWN0aW9uIGFkbWlzc2lvbiBiZWNhdXNlIHRoaXMgcGF0aCBjaGFuZ2VzXG4gICAgLy8gdGhlIHNhbWUgZHVyYWJsZSBjb3VudCByZXZpc2lvbi4gVGhlIHNjb3BlIHByaW1hcnkga2V5IHJlbWFpbnMgdGhlXG4gICAgLy8gY3Jvc3MtcHJvY2VzcyBjb252ZXJnZW5jZSBvd25lci5cbiAgICByZXR1cm4gYXdhaXQgdGhpcy5faWRlbXBvdGVudEVucXVldWVUcmFuc2FjdGlvbihhc3luYyAoZGIpID0+IHtcbiAgICAgIHJldHVybiBhd2FpdCB0aGlzLl9lbnF1ZXVlSWRlbXBvdGVudGx5SW5UcmFuc2FjdGlvbih7YXJncywgZGIsIG9wdGlvbnMsIHByZXBhcmVkSm9ifSlcbiAgICB9KVxuICB9XG5cbiAgLyoqXG4gICAqIE93bnMgb3IgcmVwbGF5cyBvbmUgcHVibGljIGlkZW1wb3RlbmN5IGtleSBpbnNpZGUgdGhlIGNhbGxlcidzIHRyYW5zYWN0aW9uLlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIFRyYW5zYWN0aW9uIGlucHV0LlxuICAgKiBAcGFyYW0ge0FycmF5PFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gYXJncy5hcmdzIC0gSm9iIGFyZ3VtZW50cy5cbiAgICogQHBhcmFtIHtib29sZWFufSBbYXJncy5jb3VudFJldmlzaW9uTG9ja2VkXSAtIFdoZXRoZXIgdGhlIGNhbGxlciBhbHJlYWR5IG93bnMgY291bnQgc2VyaWFsaXphdGlvbi5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9kYXRhYmFzZS9kcml2ZXJzL2Jhc2UuanNcIikuZGVmYXVsdH0gYXJncy5kYiAtIFRyYW5zYWN0aW9uIGNvbm5lY3Rpb24uXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi90eXBlcy5qc1wiKS5CYWNrZ3JvdW5kSm9iT3B0aW9uc30gYXJncy5vcHRpb25zIC0gSm9iIG9wdGlvbnMuXG4gICAqIEBwYXJhbSB7UHJlcGFyZWRCYWNrZ3JvdW5kSm9ifSBhcmdzLnByZXBhcmVkSm9iIC0gTm9ybWFsaXplZCBqb2IuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHN0cmluZz59IC0gU3RhYmxlIG9yaWdpbmFsIGpvYiBpZC5cbiAgICovXG4gIGFzeW5jIF9lbnF1ZXVlSWRlbXBvdGVudGx5SW5UcmFuc2FjdGlvbih7YXJncywgY291bnRSZXZpc2lvbkxvY2tlZCA9IGZhbHNlLCBkYiwgb3B0aW9ucywgcHJlcGFyZWRKb2J9KSB7XG4gICAgY29uc3QgaWRlbXBvdGVuY3lLZXkgPSB0aGlzLl9ub3JtYWxpemVJZGVtcG90ZW5jeUtleShvcHRpb25zLmlkZW1wb3RlbmN5S2V5KVxuICAgIGNvbnN0IHNjb3BlRGlnZXN0ID0gdGhpcy5faWRlbXBvdGVuY3lTY29wZURpZ2VzdCh7aWRlbXBvdGVuY3lLZXksIGpvYk5hbWU6IHByZXBhcmVkSm9iLmpvYk5hbWUsIHF1ZXVlOiBwcmVwYXJlZEpvYi5xdWV1ZX0pXG4gICAgY29uc3QgcmVxdWVzdERpZ2VzdCA9IHRoaXMuX2lkZW1wb3RlbmN5UmVxdWVzdERpZ2VzdCh7YXJncywgb3B0aW9ucywgcHJlcGFyZWRKb2J9KVxuICAgIGNvbnN0IG93bmVyc2hpcCA9IHtcbiAgICAgIGNyZWF0ZWRfYXRfbXM6IHByZXBhcmVkSm9iLmNyZWF0ZWRBdE1zLFxuICAgICAgaWRlbXBvdGVuY3lfa2V5OiBpZGVtcG90ZW5jeUtleSxcbiAgICAgIGpvYl9pZDogcHJlcGFyZWRKb2Iuam9iSWQsXG4gICAgICBqb2JfbmFtZTogcHJlcGFyZWRKb2Iuam9iTmFtZSxcbiAgICAgIHF1ZXVlOiBwcmVwYXJlZEpvYi5xdWV1ZSxcbiAgICAgIHJlcXVlc3RfZGlnZXN0OiByZXF1ZXN0RGlnZXN0LFxuICAgICAgc2NvcGVfZGlnZXN0OiBzY29wZURpZ2VzdFxuICAgIH1cbiAgICBjb25zdCBtYWlsT3BlcmF0aW9uSW5wdXQgPSBtYWlsRGVsaXZlcnlPcGVyYXRpb25Gb3JKb2IocHJlcGFyZWRKb2Iuam9iTmFtZSwgYXJncylcblxuICAgIGlmIChtYWlsT3BlcmF0aW9uSW5wdXQgJiYgbWFpbE9wZXJhdGlvbklucHV0Lm9wZXJhdGlvbi5pZCAhPT0gaWRlbXBvdGVuY3lLZXkpIHtcbiAgICAgIHRocm93IFZlbG9jaW91c0Vycm9yLnNhZmUoXCJNYWlsIGRlbGl2ZXJ5IG9wZXJhdGlvbiBpZCBtdXN0IGVxdWFsIGl0cyBiYWNrZ3JvdW5kIGpvYiBpZGVtcG90ZW5jeSBrZXkuXCIsIHtcbiAgICAgICAgY29kZTogXCJtYWlsLWRlbGl2ZXJ5LWlkZW1wb3RlbmN5LWtleS1taXNtYXRjaFwiXG4gICAgICB9KVxuICAgIH1cblxuICAgIGNvbnN0IGV4aXN0aW5nID0gYXdhaXQgdGhpcy5faWRlbXBvdGVuY3lPd25lcnNoaXAoZGIsIHNjb3BlRGlnZXN0KVxuXG4gICAgaWYgKGV4aXN0aW5nKSB7XG4gICAgICB0aGlzLl92YWxpZGF0ZUlkZW1wb3RlbmN5T3duZXJzaGlwKHtleGlzdGluZywgb3duZXJzaGlwfSlcbiAgICAgIGF3YWl0IHRoaXMuX3ZhbGlkYXRlTWFpbERlbGl2ZXJ5T3BlcmF0aW9uKGRiLCB7am9iSWQ6IFN0cmluZyhleGlzdGluZy5qb2JfaWQpLCBtYWlsT3BlcmF0aW9uSW5wdXR9KVxuICAgICAgcmV0dXJuIFN0cmluZyhleGlzdGluZy5qb2JfaWQpXG4gICAgfVxuXG4gICAgY29uc3QgY2xhaW1lZCA9IGF3YWl0IHRoaXMuX2NsYWltSWRlbXBvdGVuY3lPd25lcnNoaXAoZGIsIG93bmVyc2hpcClcblxuICAgIGlmICghY2xhaW1lZC5jcmVhdGVkKSB7XG4gICAgICB0aGlzLl92YWxpZGF0ZUlkZW1wb3RlbmN5T3duZXJzaGlwKHtleGlzdGluZzogY2xhaW1lZC5yb3csIG93bmVyc2hpcH0pXG4gICAgICBhd2FpdCB0aGlzLl92YWxpZGF0ZU1haWxEZWxpdmVyeU9wZXJhdGlvbihkYiwge2pvYklkOiBTdHJpbmcoY2xhaW1lZC5yb3cuam9iX2lkKSwgbWFpbE9wZXJhdGlvbklucHV0fSlcbiAgICAgIHJldHVybiBTdHJpbmcoY2xhaW1lZC5yb3cuam9iX2lkKVxuICAgIH1cblxuICAgIGlmICghY291bnRSZXZpc2lvbkxvY2tlZCkgYXdhaXQgdGhpcy5fbG9ja0NvdW50UmV2aXNpb24oZGIpXG4gICAgYXdhaXQgdGhpcy5faW5zZXJ0UHJlcGFyZWRKb2IoZGIsIHtwcmVwYXJlZEpvYiwgc2NoZWR1bGVLZXk6IG51bGx9KVxuICAgIGF3YWl0IHRoaXMuX3BlcnNpc3RNYWlsRGVsaXZlcnlPcGVyYXRpb24oZGIsIHtqb2JJZDogcHJlcGFyZWRKb2Iuam9iSWQsIG1haWxPcGVyYXRpb25JbnB1dCwgY3JlYXRlZEF0TXM6IHByZXBhcmVkSm9iLmNyZWF0ZWRBdE1zfSlcbiAgICBhd2FpdCB0aGlzLl9yZWNvcmRDb3VudERlbHRhKGRiLCB7YWxsOiAxLCBxdWV1ZWQ6IDF9KVxuXG4gICAgcmV0dXJuIHByZXBhcmVkSm9iLmpvYklkXG4gIH1cblxuICAvKipcbiAgICogU2VyaWFsaXplcyBvbmUgcGh5c2ljYWwgY29ubmVjdGlvbiBsb2NhbGx5IHdpdGhvdXQgdGFraW5nIG93bmVyc2hpcCBhd2F5XG4gICAqIGZyb20gdGhlIGRhdGFiYXNlIHVuaXF1ZW5lc3MgY29uc3RyYWludCBzaGFyZWQgYnkgYWxsIHByb2Nlc3Nlcy5cbiAgICogQHRlbXBsYXRlIFRcbiAgICogQHBhcmFtIHsoZGI6IGltcG9ydChcIi4uL2RhdGFiYXNlL2RyaXZlcnMvYmFzZS5qc1wiKS5kZWZhdWx0KSA9PiBQcm9taXNlPFQ+fSBjYWxsYmFjayAtIFRyYW5zYWN0aW9uIHdvcmsuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPFQ+fSAtIENhbGxiYWNrIHJlc3VsdC5cbiAgICovXG4gIGFzeW5jIF9pZGVtcG90ZW50RW5xdWV1ZVRyYW5zYWN0aW9uKGNhbGxiYWNrKSB7XG4gICAgcmV0dXJuIGF3YWl0IHRoaXMuX3NlcmlhbGl6ZWRUcmFuc2FjdGlvbk11dGF0aW9uKGNhbGxiYWNrKVxuICB9XG5cbiAgLyoqXG4gICAqIEluc2VydHMgYW4gb3duZXJzaGlwIHJvdywgcmVzb2x2aW5nIG9ubHkgYSBkYXRhYmFzZSB1bmlxdWVuZXNzIHJhY2UuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vZGF0YWJhc2UvZHJpdmVycy9iYXNlLmpzXCIpLmRlZmF1bHR9IGRiIC0gVHJhbnNhY3Rpb24gY29ubmVjdGlvbi5cbiAgICogQHBhcmFtIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59IG93bmVyc2hpcCAtIE93bmVyc2hpcCByb3cuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHtjcmVhdGVkOiBib29sZWFuLCByb3c6IFJlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0+fSAtIENsYWltIHJlc3VsdC5cbiAgICovXG4gIGFzeW5jIF9jbGFpbUlkZW1wb3RlbmN5T3duZXJzaGlwKGRiLCBvd25lcnNoaXApIHtcbiAgICB0cnkge1xuICAgICAgLy8gVGhlIHNhdmVwb2ludCBrZWVwcyBQb3N0Z3JlU1FMJ3Mgb3V0ZXIgdHJhbnNhY3Rpb24gdXNhYmxlIGFmdGVyIGFcbiAgICAgIC8vIGNvbmN1cnJlbnQgdW5pcXVlLWtleSBsb3NzLiBUaGUgdW5pcXVlIHByaW1hcnkga2V5LCBub3QgYSBwcm9jZXNzXG4gICAgICAvLyBtdXRleCwgaXMgdGhlIGNyb3NzLXByb2Nlc3MgY29udmVyZ2VuY2UgYXV0aG9yaXR5LlxuICAgICAgYXdhaXQgZGIudHJhbnNhY3Rpb24oYXN5bmMgKCkgPT4ge1xuICAgICAgICBhd2FpdCBkYi5pbnNlcnQoe3RhYmxlTmFtZTogSURFTVBPVEVOQ1lfS0VZU19UQUJMRSwgZGF0YTogb3duZXJzaGlwfSlcbiAgICAgIH0pXG5cbiAgICAgIHJldHVybiB7Y3JlYXRlZDogdHJ1ZSwgcm93OiBvd25lcnNoaXB9XG4gICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgIGNvbnN0IHJhY2VkID0gYXdhaXQgdGhpcy5faWRlbXBvdGVuY3lPd25lcnNoaXAoZGIsIFN0cmluZyhvd25lcnNoaXAuc2NvcGVfZGlnZXN0KSlcblxuICAgICAgaWYgKCFyYWNlZCkgdGhyb3cgZXJyb3JcbiAgICAgIHJldHVybiB7Y3JlYXRlZDogZmFsc2UsIHJvdzogcmFjZWR9XG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIExvYWRzIG9uZSBkdXJhYmxlIGVucXVldWUgb3duZXIuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vZGF0YWJhc2UvZHJpdmVycy9iYXNlLmpzXCIpLmRlZmF1bHR9IGRiIC0gRGF0YWJhc2UgY29ubmVjdGlvbi5cbiAgICogQHBhcmFtIHtzdHJpbmd9IHNjb3BlRGlnZXN0IC0gRml4ZWQtc2l6ZSBzY29wZSBkaWdlc3QuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPFJlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+PiB8IG51bGw+fSAtIFJvdyBvciBudWxsLlxuICAgKi9cbiAgYXN5bmMgX2lkZW1wb3RlbmN5T3duZXJzaGlwKGRiLCBzY29wZURpZ2VzdCkge1xuICAgIGNvbnN0IHJvd3MgPSBhd2FpdCBkYi5uZXdRdWVyeSgpLmZyb20oSURFTVBPVEVOQ1lfS0VZU19UQUJMRSkud2hlcmUoe3Njb3BlX2RpZ2VzdDogc2NvcGVEaWdlc3R9KS5saW1pdCgxKS5yZXN1bHRzKClcblxuICAgIHJldHVybiByb3dzWzBdID8gLyoqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59ICovIChyb3dzWzBdKSA6IG51bGxcbiAgfVxuXG4gIC8qKlxuICAgKiBGYWlscyBjbG9zZWQgd2hlbiBhIGR1cmFibGUga2V5IGlzIHJldXNlZCBmb3IgYSBkaWZmZXJlbnQgY2Fub25pY2FsIHJlcXVlc3QuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gVmFsaWRhdGlvbiBpbnB1dC5cbiAgICogQHBhcmFtIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59IGFyZ3MuZXhpc3RpbmcgLSBTdG9yZWQgb3duZXIuXG4gICAqIEBwYXJhbSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSBhcmdzLm93bmVyc2hpcCAtIFJlcXVlc3RlZCBvd25lci5cbiAgICogQHJldHVybnMge3ZvaWR9XG4gICAqL1xuICBfdmFsaWRhdGVJZGVtcG90ZW5jeU93bmVyc2hpcCh7ZXhpc3RpbmcsIG93bmVyc2hpcH0pIHtcbiAgICBjb25zdCBleGFjdFNjb3BlID0gU3RyaW5nKGV4aXN0aW5nLmpvYl9uYW1lKSA9PT0gb3duZXJzaGlwLmpvYl9uYW1lXG4gICAgICAmJiBTdHJpbmcoZXhpc3RpbmcucXVldWUpID09PSBvd25lcnNoaXAucXVldWVcbiAgICAgICYmIFN0cmluZyhleGlzdGluZy5pZGVtcG90ZW5jeV9rZXkpID09PSBvd25lcnNoaXAuaWRlbXBvdGVuY3lfa2V5XG5cbiAgICBpZiAoIWV4YWN0U2NvcGUgfHwgU3RyaW5nKGV4aXN0aW5nLnJlcXVlc3RfZGlnZXN0KSAhPT0gb3duZXJzaGlwLnJlcXVlc3RfZGlnZXN0KSB7XG4gICAgICB0aHJvdyBWZWxvY2lvdXNFcnJvci5zYWZlKFwiVGhlIGJhY2tncm91bmQgam9iIGlkZW1wb3RlbmN5IGtleSB3YXMgYWxyZWFkeSB1c2VkIGZvciBhIGRpZmZlcmVudCByZXF1ZXN0LlwiLCB7XG4gICAgICAgIGNvZGU6IFwiYmFja2dyb3VuZC1qb2ItaWRlbXBvdGVuY3ktY29uZmxpY3RcIlxuICAgICAgfSlcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogUGVyc2lzdHMgdGhlIGJ1aWx0LWluIG1haWwgb3BlcmF0aW9uIGluIHRoZSBzYW1lIGZpcnN0LWVucXVldWUgdHJhbnNhY3Rpb24uXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vZGF0YWJhc2UvZHJpdmVycy9iYXNlLmpzXCIpLmRlZmF1bHR9IGRiIC0gVHJhbnNhY3Rpb24gY29ubmVjdGlvbi5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBPcGVyYXRpb24gaW5wdXQuXG4gICAqIEBwYXJhbSB7bnVtYmVyfSBhcmdzLmNyZWF0ZWRBdE1zIC0gQ3JlYXRpb24gdGltZXN0YW1wLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gYXJncy5qb2JJZCAtIE5hdGl2ZSBqb2IgaWQuXG4gICAqIEBwYXJhbSB7e29wZXJhdGlvbjogaW1wb3J0KFwiLi4vbWFpbGVyL2luZGV4LmpzXCIpLk1haWxlckRlbGl2ZXJ5T3BlcmF0aW9uLCBwYXlsb2FkOiBpbXBvcnQoXCIuLi9tYWlsZXIvaW5kZXguanNcIikuTWFpbGVyRGVsaXZlcnlQYXlsb2FkfSB8IG51bGx9IGFyZ3MubWFpbE9wZXJhdGlvbklucHV0IC0gTWFpbCBvcGVyYXRpb24uXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIGFmdGVyIHBlcnNpc3RlbmNlLlxuICAgKi9cbiAgYXN5bmMgX3BlcnNpc3RNYWlsRGVsaXZlcnlPcGVyYXRpb24oZGIsIHtjcmVhdGVkQXRNcywgam9iSWQsIG1haWxPcGVyYXRpb25JbnB1dH0pIHtcbiAgICBpZiAoIW1haWxPcGVyYXRpb25JbnB1dCkgcmV0dXJuXG4gICAgY29uc3Qge29wZXJhdGlvbn0gPSBtYWlsT3BlcmF0aW9uSW5wdXRcbiAgICBjb25zdCBvcGVyYXRpb25LZXkgPSBtYWlsRGVsaXZlcnlPcGVyYXRpb25LZXkob3BlcmF0aW9uLmlkKVxuICAgIGNvbnN0IHJvdyA9IHtcbiAgICAgIGJhY2tncm91bmRfam9iX2lkOiBqb2JJZCxcbiAgICAgIGNyZWF0ZWRfYXRfbXM6IGNyZWF0ZWRBdE1zLFxuICAgICAgZmlyc3RfYXR0ZW1wdF9zdGFydGVkX2F0X21zOiBudWxsLFxuICAgICAgb3BlcmF0aW9uX2lkOiBvcGVyYXRpb24uaWQsXG4gICAgICBvcGVyYXRpb25fa2V5OiBvcGVyYXRpb25LZXksXG4gICAgICBwYXlsb2FkX2RpZ2VzdDogb3BlcmF0aW9uLnBheWxvYWREaWdlc3QsXG4gICAgICBwcm92aWRlcl9raW5kOiBvcGVyYXRpb24ucHJvdmlkZXJLaW5kLFxuICAgICAgcHJvdmlkZXJfcmV0ZW50aW9uX21zOiBvcGVyYXRpb24ucHJvdmlkZXJSZXRlbnRpb25Nc1xuICAgIH1cblxuICAgIHRyeSB7XG4gICAgICBhd2FpdCBkYi50cmFuc2FjdGlvbihhc3luYyAoKSA9PiB7XG4gICAgICAgIGF3YWl0IGRiLmluc2VydCh7dGFibGVOYW1lOiBNQUlMX0RFTElWRVJZX09QRVJBVElPTlNfVEFCTEUsIGRhdGE6IHJvd30pXG4gICAgICB9KVxuICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICBjb25zdCBleGlzdGluZyA9IGF3YWl0IHRoaXMuX21haWxEZWxpdmVyeU9wZXJhdGlvbihkYiwgb3BlcmF0aW9uS2V5KVxuXG4gICAgICBpZiAoIWV4aXN0aW5nKSB0aHJvdyBlcnJvclxuICAgICAgdGhpcy5fdmFsaWRhdGVNYWlsRGVsaXZlcnlPcGVyYXRpb25Sb3coe2V4aXN0aW5nLCByZXF1ZXN0ZWQ6IHJvd30pXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIFZhbGlkYXRlcyB0aGUgZHVyYWJsZSBtYWlsIHJvdyBkdXJpbmcgYW4gZXhhY3QgZ2VuZXJpYyBlbnF1ZXVlIHJlcGxheS5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9kYXRhYmFzZS9kcml2ZXJzL2Jhc2UuanNcIikuZGVmYXVsdH0gZGIgLSBEYXRhYmFzZSBjb25uZWN0aW9uLlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIFZhbGlkYXRpb24gaW5wdXQuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBhcmdzLmpvYklkIC0gT3duZWQgam9iIGlkLlxuICAgKiBAcGFyYW0ge3tvcGVyYXRpb246IGltcG9ydChcIi4uL21haWxlci9pbmRleC5qc1wiKS5NYWlsZXJEZWxpdmVyeU9wZXJhdGlvbiwgcGF5bG9hZDogaW1wb3J0KFwiLi4vbWFpbGVyL2luZGV4LmpzXCIpLk1haWxlckRlbGl2ZXJ5UGF5bG9hZH0gfCBudWxsfSBhcmdzLm1haWxPcGVyYXRpb25JbnB1dCAtIE1haWwgb3BlcmF0aW9uLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyB3aGVuIGV4YWN0LlxuICAgKi9cbiAgYXN5bmMgX3ZhbGlkYXRlTWFpbERlbGl2ZXJ5T3BlcmF0aW9uKGRiLCB7am9iSWQsIG1haWxPcGVyYXRpb25JbnB1dH0pIHtcbiAgICBpZiAoIW1haWxPcGVyYXRpb25JbnB1dCkgcmV0dXJuXG4gICAgY29uc3Qge29wZXJhdGlvbn0gPSBtYWlsT3BlcmF0aW9uSW5wdXRcbiAgICBjb25zdCBleGlzdGluZyA9IGF3YWl0IHRoaXMuX21haWxEZWxpdmVyeU9wZXJhdGlvbihkYiwgbWFpbERlbGl2ZXJ5T3BlcmF0aW9uS2V5KG9wZXJhdGlvbi5pZCkpXG5cbiAgICBpZiAoIWV4aXN0aW5nKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoXCJCYWNrZ3JvdW5kIGpvYiBpZGVtcG90ZW5jeSBvd25lcnNoaXAgaXMgbWlzc2luZyBpdHMgZHVyYWJsZSBtYWlsIGRlbGl2ZXJ5IG9wZXJhdGlvblwiKVxuICAgIH1cblxuICAgIHRoaXMuX3ZhbGlkYXRlTWFpbERlbGl2ZXJ5T3BlcmF0aW9uUm93KHtcbiAgICAgIGV4aXN0aW5nLFxuICAgICAgcmVxdWVzdGVkOiB7XG4gICAgICAgIGJhY2tncm91bmRfam9iX2lkOiBqb2JJZCxcbiAgICAgICAgb3BlcmF0aW9uX2lkOiBvcGVyYXRpb24uaWQsXG4gICAgICAgIHBheWxvYWRfZGlnZXN0OiBvcGVyYXRpb24ucGF5bG9hZERpZ2VzdCxcbiAgICAgICAgcHJvdmlkZXJfa2luZDogb3BlcmF0aW9uLnByb3ZpZGVyS2luZCxcbiAgICAgICAgcHJvdmlkZXJfcmV0ZW50aW9uX21zOiBvcGVyYXRpb24ucHJvdmlkZXJSZXRlbnRpb25Nc1xuICAgICAgfVxuICAgIH0pXG4gIH1cblxuICAvKipcbiAgICogTG9hZHMgYSBkdXJhYmxlIG1haWwgb3BlcmF0aW9uLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL2RhdGFiYXNlL2RyaXZlcnMvYmFzZS5qc1wiKS5kZWZhdWx0fSBkYiAtIERhdGFiYXNlIGNvbm5lY3Rpb24uXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBvcGVyYXRpb25LZXkgLSBGaXhlZC1zaXplIG9wZXJhdGlvbiBrZXkuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPFJlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+PiB8IG51bGw+fSAtIFJvdyBvciBudWxsLlxuICAgKi9cbiAgYXN5bmMgX21haWxEZWxpdmVyeU9wZXJhdGlvbihkYiwgb3BlcmF0aW9uS2V5KSB7XG4gICAgY29uc3Qgcm93cyA9IGF3YWl0IGRiLm5ld1F1ZXJ5KCkuZnJvbShNQUlMX0RFTElWRVJZX09QRVJBVElPTlNfVEFCTEUpLndoZXJlKHtvcGVyYXRpb25fa2V5OiBvcGVyYXRpb25LZXl9KS5saW1pdCgxKS5yZXN1bHRzKClcblxuICAgIHJldHVybiByb3dzWzBdID8gLyoqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59ICovIChyb3dzWzBdKSA6IG51bGxcbiAgfVxuXG4gIC8qKlxuICAgKiBDb21wYXJlcyBwcm92aWRlci1yZWxldmFudCBkdXJhYmxlIG1haWwgb3BlcmF0aW9uIGZpZWxkcy5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBWYWxpZGF0aW9uIGlucHV0LlxuICAgKiBAcGFyYW0ge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gYXJncy5leGlzdGluZyAtIFN0b3JlZCByb3cuXG4gICAqIEBwYXJhbSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSBhcmdzLnJlcXVlc3RlZCAtIFJlcXVlc3RlZCByb3cuXG4gICAqIEByZXR1cm5zIHt2b2lkfVxuICAgKi9cbiAgX3ZhbGlkYXRlTWFpbERlbGl2ZXJ5T3BlcmF0aW9uUm93KHtleGlzdGluZywgcmVxdWVzdGVkfSkge1xuICAgIGNvbnN0IG1hdGNoZXMgPSBTdHJpbmcoZXhpc3Rpbmcub3BlcmF0aW9uX2lkKSA9PT0gcmVxdWVzdGVkLm9wZXJhdGlvbl9pZFxuICAgICAgJiYgU3RyaW5nKGV4aXN0aW5nLnBheWxvYWRfZGlnZXN0KSA9PT0gcmVxdWVzdGVkLnBheWxvYWRfZGlnZXN0XG4gICAgICAmJiBTdHJpbmcoZXhpc3RpbmcuYmFja2dyb3VuZF9qb2JfaWQpID09PSByZXF1ZXN0ZWQuYmFja2dyb3VuZF9qb2JfaWRcbiAgICAgICYmIFN0cmluZyhleGlzdGluZy5wcm92aWRlcl9raW5kKSA9PT0gcmVxdWVzdGVkLnByb3ZpZGVyX2tpbmRcbiAgICAgICYmIHRoaXMuX25vcm1hbGl6ZU51bWJlcihleGlzdGluZy5wcm92aWRlcl9yZXRlbnRpb25fbXMpID09PSByZXF1ZXN0ZWQucHJvdmlkZXJfcmV0ZW50aW9uX21zXG5cbiAgICBpZiAoIW1hdGNoZXMpIHtcbiAgICAgIHRocm93IFZlbG9jaW91c0Vycm9yLnNhZmUoXCJUaGUgbWFpbCBkZWxpdmVyeSBvcGVyYXRpb24gd2FzIGFscmVhZHkgdXNlZCBmb3IgYSBkaWZmZXJlbnQgcGF5bG9hZCBvciBwcm92aWRlci5cIiwge1xuICAgICAgICBjb2RlOiBcIm1haWwtZGVsaXZlcnktaWRlbXBvdGVuY3ktY29uZmxpY3RcIlxuICAgICAgfSlcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogQ2Fub25pY2FsIHJlcXVlc3QgZGlnZXN0IGV4Y2x1ZGluZyBnZW5lcmF0ZWQgaWRzIGFuZCBpbW1lZGlhdGUgZW5xdWV1ZSB0aW1lLlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIERpZ2VzdCBpbnB1dC5cbiAgICogQHBhcmFtIHtBcnJheTxSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59IGFyZ3MuYXJncyAtIEpvYiBhcmd1bWVudHMuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi90eXBlcy5qc1wiKS5CYWNrZ3JvdW5kSm9iT3B0aW9uc30gYXJncy5vcHRpb25zIC0gSm9iIG9wdGlvbnMuXG4gICAqIEBwYXJhbSB7UHJlcGFyZWRCYWNrZ3JvdW5kSm9ifSBhcmdzLnByZXBhcmVkSm9iIC0gTm9ybWFsaXplZCBqb2IuXG4gICAqIEByZXR1cm5zIHtzdHJpbmd9IC0gU0hBLTI1NiBkaWdlc3QuXG4gICAqL1xuICBfaWRlbXBvdGVuY3lSZXF1ZXN0RGlnZXN0KHthcmdzLCBvcHRpb25zLCBwcmVwYXJlZEpvYn0pIHtcbiAgICBjb25zdCBzZXJpYWxpemVkID0gc3RhYmxlSnNvblN0cmluZ2lmeSh7XG4gICAgICBhcmdzLFxuICAgICAgY29uY3VycmVuY3k6IHByZXBhcmVkSm9iLmNvbmN1cnJlbmN5LFxuICAgICAgZXhlY3V0aW9uTW9kZTogcHJlcGFyZWRKb2IuZXhlY3V0aW9uTW9kZSxcbiAgICAgIGZvcm1hdDogXCJ2ZWxvY2lvdXMtYmFja2dyb3VuZC1qb2ItaWRlbXBvdGVuY3ktdjFcIixcbiAgICAgIGpvYk5hbWU6IHByZXBhcmVkSm9iLmpvYk5hbWUsXG4gICAgICBtYXhSZXRyaWVzOiBwcmVwYXJlZEpvYi5tYXhSZXRyaWVzLFxuICAgICAgcXVldWU6IHByZXBhcmVkSm9iLnF1ZXVlLFxuICAgICAgc2NoZWR1bGVkQXRNczogb3B0aW9ucy5zY2hlZHVsZWRBdE1zID09PSB1bmRlZmluZWQgPyBudWxsIDogcHJlcGFyZWRKb2Iuc2NoZWR1bGVkQXRNcyxcbiAgICAgIHNjaGVkdWxpbmc6IG9wdGlvbnMuc2NoZWR1bGVkQXRNcyA9PT0gdW5kZWZpbmVkID8gXCJpbW1lZGlhdGVcIiA6IFwic2NoZWR1bGVkXCIsXG4gICAgICAuLi4ocHJlcGFyZWRKb2IudGltZW91dE1zID09PSBudWxsID8ge30gOiB7dGltZW91dE1zOiBwcmVwYXJlZEpvYi50aW1lb3V0TXN9KVxuICAgIH0pXG5cbiAgICByZXR1cm4gY3JlYXRlSGFzaChcInNoYTI1NlwiKS51cGRhdGUoc2VyaWFsaXplZCkuZGlnZXN0KFwiaGV4XCIpXG4gIH1cblxuICAvKipcbiAgICogRml4ZWQtc2l6ZSBnbG9iYWxseSBpbmRleGVkIHJlcHJlc2VudGF0aW9uIG9mIHRoZSBkb2N1bWVudGVkIHNjb3BlIHR1cGxlLlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIFNjb3BlIGlucHV0LlxuICAgKiBAcGFyYW0ge3N0cmluZ30gYXJncy5pZGVtcG90ZW5jeUtleSAtIENhbGxlciBrZXkuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBhcmdzLmpvYk5hbWUgLSBKb2IgY2xhc3MgbmFtZS5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGFyZ3MucXVldWUgLSBRdWV1ZSBuYW1lLlxuICAgKiBAcmV0dXJucyB7c3RyaW5nfSAtIFNIQS0yNTYgc2NvcGUgZGlnZXN0LlxuICAgKi9cbiAgX2lkZW1wb3RlbmN5U2NvcGVEaWdlc3Qoe2lkZW1wb3RlbmN5S2V5LCBqb2JOYW1lLCBxdWV1ZX0pIHtcbiAgICByZXR1cm4gY3JlYXRlSGFzaChcInNoYTI1NlwiKVxuICAgICAgLnVwZGF0ZShzdGFibGVKc29uU3RyaW5naWZ5KHtmb3JtYXQ6IFwidmVsb2Npb3VzLWJhY2tncm91bmQtam9iLWlkZW1wb3RlbmN5LXNjb3BlLXYxXCIsIGlkZW1wb3RlbmN5S2V5LCBqb2JOYW1lLCBxdWV1ZX0pKVxuICAgICAgLmRpZ2VzdChcImhleFwiKVxuICB9XG5cbiAgLyoqXG4gICAqIFZhbGlkYXRlcyBvbmUgY2FsbGVyIGtleS5cbiAgICogQHBhcmFtIHtzdHJpbmcgfCB1bmRlZmluZWR9IGlkZW1wb3RlbmN5S2V5IC0gQ2FsbGVyIGtleS5cbiAgICogQHJldHVybnMge3N0cmluZ30gLSBWYWxpZCBrZXkuXG4gICAqL1xuICBfbm9ybWFsaXplSWRlbXBvdGVuY3lLZXkoaWRlbXBvdGVuY3lLZXkpIHtcbiAgICBpZiAodHlwZW9mIGlkZW1wb3RlbmN5S2V5ICE9PSBcInN0cmluZ1wiIHx8IGlkZW1wb3RlbmN5S2V5Lmxlbmd0aCA9PT0gMCkge1xuICAgICAgdGhyb3cgVmVsb2Npb3VzRXJyb3Iuc2FmZShcIkJhY2tncm91bmQgam9iIGlkZW1wb3RlbmN5S2V5IG11c3QgYmUgYSBub24tZW1wdHkgc3RyaW5nLlwiLCB7XG4gICAgICAgIGNvZGU6IFwiYmFja2dyb3VuZC1qb2ItaWRlbXBvdGVuY3kta2V5LWludmFsaWRcIlxuICAgICAgfSlcbiAgICB9XG5cbiAgICByZXR1cm4gaWRlbXBvdGVuY3lLZXlcbiAgfVxuXG4gIC8qKlxuICAgKiBDYW5vbmljYWwgcmVxdWVzdCBpZGVudGl0eSBmb3IgYW4gaW50ZXJuYWwgb3duZWQtaGFuZG9mZiByZXBsYXkuXG4gICAqIEltbWVkaWF0ZSBlbnF1ZXVlIHdhbGwgdGltZSBhbmQgZ2VuZXJhdGVkIGpvYiBpZHMgcmVtYWluIGV4Y2x1ZGVkLlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIERpZ2VzdCBpbnB1dC5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL3R5cGVzLmpzXCIpLkJhY2tncm91bmRKb2JPcHRpb25zfSBhcmdzLm9wdGlvbnMgLSBFbnF1ZXVlIG9wdGlvbnMuXG4gICAqIEBwYXJhbSB7UHJlcGFyZWRCYWNrZ3JvdW5kSm9ifSBhcmdzLnByZXBhcmVkSm9iIC0gTm9ybWFsaXplZCBqb2IuXG4gICAqIEByZXR1cm5zIHtzdHJpbmd9IC0gU0hBLTI1NiBkaWdlc3QuXG4gICAqL1xuICBfb3duZWRFbnF1ZXVlUmVxdWVzdERpZ2VzdCh7b3B0aW9ucywgcHJlcGFyZWRKb2J9KSB7XG4gICAgY29uc3Qgc2VyaWFsaXplZCA9IHN0YWJsZUpzb25TdHJpbmdpZnkoe1xuICAgICAgYXJnc0pzb246IHByZXBhcmVkSm9iLmFyZ3NKc29uLFxuICAgICAgY29uY3VycmVuY3k6IHByZXBhcmVkSm9iLmNvbmN1cnJlbmN5LFxuICAgICAgZGVkdXBsaWNhdGVXaGlsZVF1ZXVlZDogb3B0aW9ucy5kZWR1cGxpY2F0ZVdoaWxlUXVldWVkID09PSB0cnVlLFxuICAgICAgZXhlY3V0aW9uTW9kZTogcHJlcGFyZWRKb2IuZXhlY3V0aW9uTW9kZSxcbiAgICAgIGZvcm1hdDogXCJ2ZWxvY2lvdXMtYmFja2dyb3VuZC1qb2Itb3duZWQtZW5xdWV1ZS12MVwiLFxuICAgICAgam9iTmFtZTogcHJlcGFyZWRKb2Iuam9iTmFtZSxcbiAgICAgIG1heFJldHJpZXM6IHByZXBhcmVkSm9iLm1heFJldHJpZXMsXG4gICAgICBxdWV1ZTogcHJlcGFyZWRKb2IucXVldWUsXG4gICAgICBzY2hlZHVsZWRBdE1zOiBvcHRpb25zLnNjaGVkdWxlZEF0TXMgPT09IHVuZGVmaW5lZCA/IG51bGwgOiBwcmVwYXJlZEpvYi5zY2hlZHVsZWRBdE1zLFxuICAgICAgc2NoZWR1bGluZzogb3B0aW9ucy5zY2hlZHVsZWRBdE1zID09PSB1bmRlZmluZWQgPyBcImltbWVkaWF0ZVwiIDogXCJzY2hlZHVsZWRcIixcbiAgICAgIC4uLihwcmVwYXJlZEpvYi50aW1lb3V0TXMgPT09IG51bGwgPyB7fSA6IHt0aW1lb3V0TXM6IHByZXBhcmVkSm9iLnRpbWVvdXRNc30pXG4gICAgfSlcblxuICAgIHJldHVybiBjcmVhdGVIYXNoKFwic2hhMjU2XCIpLnVwZGF0ZShzZXJpYWxpemVkKS5kaWdlc3QoXCJoZXhcIilcbiAgfVxuXG4gIC8qKlxuICAgKiBJc29sYXRlcyBpbnRlcm5hbCBwcm9kdWNlciByZXBsYXkgb3duZXJzaGlwIGZyb20gY2FsbGVyIGlkZW1wb3RlbmN5IHNjb3Blcy5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBTY29wZSBpbnB1dC5cbiAgICogQHBhcmFtIHtQcmVwYXJlZEJhY2tncm91bmRKb2J9IGFyZ3MucHJlcGFyZWRKb2IgLSBOb3JtYWxpemVkIGpvYi5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGFyZ3MucHJvZHVjZXJJbnZvY2F0aW9uSWQgLSBTdGFibGUgaWRlbnRpdHkgZm9yIG9uZSBvd25lZCBlbnF1ZXVlIGludm9jYXRpb24uXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi90eXBlcy5qc1wiKS5CYWNrZ3JvdW5kSm9iUHJvZHVjZXJQcm9vZn0gYXJncy5wcm9kdWNlclByb29mIC0gRXhhY3QgcHJvZHVjZXIgbGVhc2UuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBhcmdzLnJlcXVlc3REaWdlc3QgLSBDYW5vbmljYWwgcmVxdWVzdCBkaWdlc3QuXG4gICAqIEByZXR1cm5zIHtzdHJpbmd9IC0gU0hBLTI1NiBzY29wZSBkaWdlc3QuXG4gICAqL1xuICBfb3duZWRFbnF1ZXVlU2NvcGVEaWdlc3Qoe3ByZXBhcmVkSm9iLCBwcm9kdWNlckludm9jYXRpb25JZCwgcHJvZHVjZXJQcm9vZiwgcmVxdWVzdERpZ2VzdH0pIHtcbiAgICByZXR1cm4gY3JlYXRlSGFzaChcInNoYTI1NlwiKVxuICAgICAgLnVwZGF0ZShzdGFibGVKc29uU3RyaW5naWZ5KHtcbiAgICAgICAgZm9ybWF0OiBcInZlbG9jaW91cy1iYWNrZ3JvdW5kLWpvYi1vd25lZC1lbnF1ZXVlLXNjb3BlLXYxXCIsXG4gICAgICAgIGpvYk5hbWU6IHByZXBhcmVkSm9iLmpvYk5hbWUsXG4gICAgICAgIHByb2R1Y2VySW52b2NhdGlvbklkLFxuICAgICAgICBwcm9kdWNlclByb29mLFxuICAgICAgICBxdWV1ZTogcHJlcGFyZWRKb2IucXVldWUsXG4gICAgICAgIHJlcXVlc3REaWdlc3RcbiAgICAgIH0pKVxuICAgICAgLmRpZ2VzdChcImhleFwiKVxuICB9XG5cbiAgLyoqXG4gICAqIFZhbGlkYXRlcyB0aGUgdW50cnVzdGVkIGlkZW50aXR5IG9mIG9uZSBwcm9kdWNlci1vd25lZCBlbnF1ZXVlIGludm9jYXRpb24uXG4gICAqIEBwYXJhbSB7c3RyaW5nIHwgdW5kZWZpbmVkfSBwcm9kdWNlckludm9jYXRpb25JZCAtIFByb2R1Y2VyIGludm9jYXRpb24gaWRlbnRpdHkuXG4gICAqIEByZXR1cm5zIHtzdHJpbmd9IC0gVmFsaWRhdGVkIGlkZW50aXR5LlxuICAgKi9cbiAgX25vcm1hbGl6ZVByb2R1Y2VySW52b2NhdGlvbklkKHByb2R1Y2VySW52b2NhdGlvbklkKSB7XG4gICAgaWYgKHR5cGVvZiBwcm9kdWNlckludm9jYXRpb25JZCAhPT0gXCJzdHJpbmdcIiB8fCBwcm9kdWNlckludm9jYXRpb25JZC5sZW5ndGggPT09IDApIHtcbiAgICAgIHRocm93IFZlbG9jaW91c0Vycm9yLnNhZmUoXCJCYWNrZ3JvdW5kIGpvYiBwcm9kdWNlciBpbnZvY2F0aW9uIGlkIGlzIGludmFsaWQuXCIsIHtcbiAgICAgICAgY29kZTogXCJiYWNrZ3JvdW5kLWpvYi1wcm9kdWNlci1pbnZvY2F0aW9uLWlkLWludmFsaWRcIlxuICAgICAgfSlcbiAgICB9XG5cbiAgICByZXR1cm4gcHJvZHVjZXJJbnZvY2F0aW9uSWRcbiAgfVxuXG4gIC8qKlxuICAgKiBWYWxpZGF0ZXMgdGhlIHVudHJ1c3RlZCB0cmFuc3BvcnQgc2hhcGUgYmVmb3JlIHRyYW5zYWN0aW9uIGFkbWlzc2lvbi5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL3R5cGVzLmpzXCIpLkJhY2tncm91bmRKb2JQcm9kdWNlclByb29mfSBwcm9kdWNlclByb29mIC0gUHJvZHVjZXIgcHJvb2YuXG4gICAqIEByZXR1cm5zIHtpbXBvcnQoXCIuL3R5cGVzLmpzXCIpLkJhY2tncm91bmRKb2JQcm9kdWNlclByb29mfSAtIE5vcm1hbGl6ZWQgaW1tdXRhYmxlIHByb29mLlxuICAgKi9cbiAgX25vcm1hbGl6ZVByb2R1Y2VyUHJvb2YocHJvZHVjZXJQcm9vZikge1xuICAgIGNvbnN0IGV4YWN0S2V5cyA9IFtcImhhbmRlZE9mZkF0TXNcIiwgXCJoYW5kb2ZmSWRcIiwgXCJqb2JJZFwiLCBcIndvcmtlcklkXCJdXG4gICAgY29uc3Qga2V5cyA9IHByb2R1Y2VyUHJvb2YgJiYgdHlwZW9mIHByb2R1Y2VyUHJvb2YgPT09IFwib2JqZWN0XCIgPyBPYmplY3Qua2V5cyhwcm9kdWNlclByb29mKSA6IFtdXG4gICAgY29uc3QgdmFsaWQgPSBwcm9kdWNlclByb29mXG4gICAgICAmJiB0eXBlb2YgcHJvZHVjZXJQcm9vZiA9PT0gXCJvYmplY3RcIlxuICAgICAgJiYga2V5cy5sZW5ndGggPT09IGV4YWN0S2V5cy5sZW5ndGhcbiAgICAgICYmIGtleXMuZXZlcnkoKGtleSkgPT4gZXhhY3RLZXlzLmluY2x1ZGVzKGtleSkpXG4gICAgICAmJiB0eXBlb2YgcHJvZHVjZXJQcm9vZi5qb2JJZCA9PT0gXCJzdHJpbmdcIlxuICAgICAgJiYgcHJvZHVjZXJQcm9vZi5qb2JJZC5sZW5ndGggPiAwXG4gICAgICAmJiB0eXBlb2YgcHJvZHVjZXJQcm9vZi5oYW5kb2ZmSWQgPT09IFwic3RyaW5nXCJcbiAgICAgICYmIHByb2R1Y2VyUHJvb2YuaGFuZG9mZklkLmxlbmd0aCA+IDBcbiAgICAgICYmIHR5cGVvZiBwcm9kdWNlclByb29mLndvcmtlcklkID09PSBcInN0cmluZ1wiXG4gICAgICAmJiBwcm9kdWNlclByb29mLndvcmtlcklkLmxlbmd0aCA+IDBcbiAgICAgICYmIE51bWJlci5pc1NhZmVJbnRlZ2VyKHByb2R1Y2VyUHJvb2YuaGFuZGVkT2ZmQXRNcylcbiAgICAgICYmIHByb2R1Y2VyUHJvb2YuaGFuZGVkT2ZmQXRNcyA+PSAwXG5cbiAgICBpZiAoIXZhbGlkKSB7XG4gICAgICB0aHJvdyBWZWxvY2lvdXNFcnJvci5zYWZlKFwiQmFja2dyb3VuZCBqb2IgcHJvZHVjZXIgcHJvb2YgaXMgaW52YWxpZC5cIiwge1xuICAgICAgICBjb2RlOiBcImJhY2tncm91bmQtam9iLXByb2R1Y2VyLXByb29mLWludmFsaWRcIlxuICAgICAgfSlcbiAgICB9XG5cbiAgICByZXR1cm4gT2JqZWN0LmZyZWV6ZSh7XG4gICAgICBoYW5kZWRPZmZBdE1zOiBwcm9kdWNlclByb29mLmhhbmRlZE9mZkF0TXMsXG4gICAgICBoYW5kb2ZmSWQ6IHByb2R1Y2VyUHJvb2YuaGFuZG9mZklkLFxuICAgICAgam9iSWQ6IHByb2R1Y2VyUHJvb2Yuam9iSWQsXG4gICAgICB3b3JrZXJJZDogcHJvZHVjZXJQcm9vZi53b3JrZXJJZFxuICAgIH0pXG4gIH1cblxuICAvKipcbiAgICogQ29uZmlybXMgZXhhY3QgYWN0aXZlIG93bmVyc2hpcCB3aGlsZSB0aGUgZW5xdWV1ZSB0cmFuc2FjdGlvbiBob2xkcyB0aGVcbiAgICogc2hhcmVkIG11dGF0aW9uIGZlbmNlIHVzZWQgYnkgdGVybWluYWwgcHJvZHVjZXIgdHJhbnNpdGlvbnMuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vZGF0YWJhc2UvZHJpdmVycy9iYXNlLmpzXCIpLmRlZmF1bHR9IGRiIC0gVHJhbnNhY3Rpb24gY29ubmVjdGlvbi5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL3R5cGVzLmpzXCIpLkJhY2tncm91bmRKb2JQcm9kdWNlclByb29mfSBwcm9kdWNlclByb29mIC0gRXhhY3QgcHJvZHVjZXIgbGVhc2UuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIHdoaWxlIG93bmVyc2hpcCByZW1haW5zIGV4YWN0LlxuICAgKi9cbiAgYXN5bmMgX3ZhbGlkYXRlT3duZWRQcm9kdWNlclByb29mKGRiLCBwcm9kdWNlclByb29mKSB7XG4gICAgY29uc3QgcHJvZHVjZXIgPSBhd2FpdCB0aGlzLl9nZXRKb2JSb3dCeUlkKGRiLCBwcm9kdWNlclByb29mLmpvYklkKVxuICAgIGNvbnN0IG93bmVkID0gcHJvZHVjZXJcbiAgICAgICYmIHByb2R1Y2VyLnN0YXR1cyA9PT0gXCJoYW5kZWRfb2ZmXCJcbiAgICAgICYmIHByb2R1Y2VyLmhhbmRvZmZJZCA9PT0gcHJvZHVjZXJQcm9vZi5oYW5kb2ZmSWRcbiAgICAgICYmIHByb2R1Y2VyLndvcmtlcklkID09PSBwcm9kdWNlclByb29mLndvcmtlcklkXG4gICAgICAmJiBwcm9kdWNlci5oYW5kZWRPZmZBdE1zID09PSBwcm9kdWNlclByb29mLmhhbmRlZE9mZkF0TXNcblxuICAgIGlmICghb3duZWQpIHtcbiAgICAgIHRocm93IFZlbG9jaW91c0Vycm9yLnNhZmUoXCJCYWNrZ3JvdW5kIGpvYiBwcm9kdWNlciBoYW5kb2ZmIGlzIG5vIGxvbmdlciBvd25lZC5cIiwge1xuICAgICAgICBjb2RlOiBcImJhY2tncm91bmQtam9iLXByb2R1Y2VyLWhhbmRvZmYtbm90LW93bmVkXCJcbiAgICAgIH0pXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIFJlcGxhY2VzIHRoZSBxdWV1ZWQgb3duZXIgb2YgYSBzdGFibGUgc2NoZWR1bGUga2V5IHdpdGggYSBuZXcgb25lLW9mZiBqb2IuXG4gICAqIEEgaGFuZGVkLW9mZiBvd25lciBpcyBsZWZ0IHJ1bm5pbmcgYW5kIHJlcG9ydGVkIHRydXRoZnVsbHkuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gT3B0aW9ucy5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGFyZ3Muc2NoZWR1bGVLZXkgLSBTdGFibGUgbG9naWNhbCBzY2hlZHVsZSBrZXkuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBhcmdzLmpvYk5hbWUgLSBKb2IgbmFtZS5cbiAgICogQHBhcmFtIHtBcnJheTxSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59IGFyZ3MuYXJncyAtIEFyZ3VtZW50cy5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL3R5cGVzLmpzXCIpLkJhY2tncm91bmRKb2JPcHRpb25zfSBbYXJncy5vcHRpb25zXSAtIE9wdGlvbnMuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPGltcG9ydChcIi4vdHlwZXMuanNcIikuQmFja2dyb3VuZEpvYlJlcGxhY2VtZW50UmVzdWx0Pn0gLSBSZXBsYWNlbWVudCByZXN1bHQuXG4gICAqL1xuICBhc3luYyByZXBsYWNlU2NoZWR1bGVkKHtzY2hlZHVsZUtleSwgam9iTmFtZSwgYXJncywgb3B0aW9uc30pIHtcbiAgICBhd2FpdCB0aGlzLmVuc3VyZVJlYWR5KClcblxuICAgIGNvbnN0IG5vcm1hbGl6ZWRTY2hlZHVsZUtleSA9IHRoaXMuX25vcm1hbGl6ZVNjaGVkdWxlS2V5KHNjaGVkdWxlS2V5KVxuICAgIGNvbnN0IHByZXBhcmVkSm9iID0gdGhpcy5fcHJlcGFyZUpvYih7am9iTmFtZSwgYXJncywgb3B0aW9uc30pXG5cbiAgICByZXR1cm4gYXdhaXQgdGhpcy5fc2VyaWFsaXplZENvdW50TXV0YXRpb24oYXN5bmMgKGRiKSA9PiB7XG4gICAgICBjb25zdCBvd25lclJvd3MgPSBhd2FpdCBkYlxuICAgICAgICAubmV3UXVlcnkoKVxuICAgICAgICAuZnJvbShTQ0hFRFVMRV9LRVlTX1RBQkxFKVxuICAgICAgICAud2hlcmUoe3NjaGVkdWxlX2tleTogbm9ybWFsaXplZFNjaGVkdWxlS2V5fSlcbiAgICAgICAgLmxpbWl0KDEpXG4gICAgICAgIC5yZXN1bHRzKClcbiAgICAgIGNvbnN0IG93bmVySm9iSWQgPSBvd25lclJvd3NbMF0gPyBTdHJpbmcoLyoqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59ICovIChvd25lclJvd3NbMF0pLmpvYl9pZCkgOiBudWxsXG4gICAgICBjb25zdCBvd25lckpvYiA9IG93bmVySm9iSWQgPyBhd2FpdCB0aGlzLl9nZXRKb2JSb3dCeUlkKGRiLCBvd25lckpvYklkKSA6IG51bGxcbiAgICAgIC8qKiBAdHlwZSB7aW1wb3J0KFwiLi90eXBlcy5qc1wiKS5CYWNrZ3JvdW5kSm9iUmVwbGFjZW1lbnRQcmV2aW91c1N0YXR1c30gKi9cbiAgICAgIGxldCBwcmV2aW91c1N0YXR1cyA9IG51bGxcbiAgICAgIGxldCBwcmV2aW91c0pvYklkID0gbnVsbFxuXG4gICAgICBpZiAob3duZXJKb2I/LnN0YXR1cyA9PT0gXCJxdWV1ZWRcIikge1xuICAgICAgICBjb25zdCBhZmZlY3RlZFJvd3MgPSBhd2FpdCB0aGlzLl91cGRhdGVBZmZlY3RlZFJvd3MoZGIsIHtcbiAgICAgICAgICB0YWJsZU5hbWU6IEpPQlNfVEFCTEUsXG4gICAgICAgICAgZGF0YToge3N0YXR1czogXCJjYW5jZWxsZWRcIn0sXG4gICAgICAgICAgY29uZGl0aW9uczoge2lkOiBvd25lckpvYi5pZCwgc3RhdHVzOiBcInF1ZXVlZFwifVxuICAgICAgICB9KVxuXG4gICAgICAgIGlmIChhZmZlY3RlZFJvd3MgPT09IDEpIHtcbiAgICAgICAgICBwcmV2aW91c0pvYklkID0gb3duZXJKb2IuaWRcbiAgICAgICAgICBwcmV2aW91c1N0YXR1cyA9IFwicXVldWVkXCJcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICBjb25zdCBjdXJyZW50T3duZXJKb2IgPSBhd2FpdCB0aGlzLl9nZXRKb2JSb3dCeUlkKGRiLCBvd25lckpvYi5pZClcblxuICAgICAgICAgIGlmIChjdXJyZW50T3duZXJKb2I/LnN0YXR1cyA9PT0gXCJoYW5kZWRfb2ZmXCIpIHtcbiAgICAgICAgICAgIHByZXZpb3VzSm9iSWQgPSBjdXJyZW50T3duZXJKb2IuaWRcbiAgICAgICAgICAgIHByZXZpb3VzU3RhdHVzID0gXCJoYW5kZWRfb2ZmXCJcbiAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICAgIH0gZWxzZSBpZiAob3duZXJKb2I/LnN0YXR1cyA9PT0gXCJoYW5kZWRfb2ZmXCIpIHtcbiAgICAgICAgcHJldmlvdXNKb2JJZCA9IG93bmVySm9iLmlkXG4gICAgICAgIHByZXZpb3VzU3RhdHVzID0gXCJoYW5kZWRfb2ZmXCJcbiAgICAgIH1cblxuICAgICAgY29uc3Qgc2NoZWR1bGVPcmRlciA9IGF3YWl0IHRoaXMuX25leHRTY2hlZHVsZU9yZGVyKGRiLCBub3JtYWxpemVkU2NoZWR1bGVLZXkpXG5cbiAgICAgIGF3YWl0IHRoaXMuX2luc2VydFByZXBhcmVkSm9iKGRiLCB7cHJlcGFyZWRKb2IsIHNjaGVkdWxlS2V5OiBub3JtYWxpemVkU2NoZWR1bGVLZXksIHNjaGVkdWxlT3JkZXJ9KVxuICAgICAgYXdhaXQgZGIudXBzZXJ0KHtcbiAgICAgICAgdGFibGVOYW1lOiBTQ0hFRFVMRV9LRVlTX1RBQkxFLFxuICAgICAgICBkYXRhOiB7c2NoZWR1bGVfa2V5OiBub3JtYWxpemVkU2NoZWR1bGVLZXksIGpvYl9pZDogcHJlcGFyZWRKb2Iuam9iSWR9LFxuICAgICAgICBjb25mbGljdENvbHVtbnM6IFtcInNjaGVkdWxlX2tleVwiXSxcbiAgICAgICAgdXBkYXRlQ29sdW1uczogW1wiam9iX2lkXCJdXG4gICAgICB9KVxuXG4gICAgICBpZiAocHJldmlvdXNTdGF0dXMgIT09IFwicXVldWVkXCIpIGF3YWl0IHRoaXMuX3JlY29yZENvdW50RGVsdGEoZGIsIHthbGw6IDEsIHF1ZXVlZDogMX0pXG4gICAgICByZXR1cm4ge2pvYklkOiBwcmVwYXJlZEpvYi5qb2JJZCwgcHJldmlvdXNKb2JJZCwgcHJldmlvdXNTdGF0dXN9XG4gICAgfSwge1xuICAgICAgYWR2aXNvcnlMb2NrOiB7XG4gICAgICAgIGZhaWx1cmVNZXNzYWdlOiBcIkZhaWxlZCB0byBhY3F1aXJlIGJhY2tncm91bmQgam9iIHNjaGVkdWxlLWtleSBsb2NrXCIsXG4gICAgICAgIG5hbWU6IHRoaXMuX3NjaGVkdWxlS2V5TG9ja05hbWUobm9ybWFsaXplZFNjaGVkdWxlS2V5KVxuICAgICAgfVxuICAgIH0pXG4gIH1cblxuICAvKipcbiAgICogQ2FuY2VscyB0aGUgcXVldWVkIG93bmVyIG9mIGEgc3RhYmxlIHNjaGVkdWxlIGtleS4gQSBoYW5kZWQtb2ZmIG93bmVyIGlzXG4gICAqIGRldGFjaGVkIGJ1dCBub3QgbWFya2VkIHN0b3BwZWQgYmVjYXVzZSBleGVjdXRpb24gbWF5IGFscmVhZHkgYmUgcnVubmluZy5cbiAgICogQHBhcmFtIHtzdHJpbmd9IHNjaGVkdWxlS2V5IC0gU3RhYmxlIGxvZ2ljYWwgc2NoZWR1bGUga2V5LlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxpbXBvcnQoXCIuL3R5cGVzLmpzXCIpLkJhY2tncm91bmRKb2JDYW5jZWxsYXRpb25SZXN1bHQ+fSAtIENhbmNlbGxhdGlvbiByZXN1bHQuXG4gICAqL1xuICBhc3luYyBjYW5jZWxTY2hlZHVsZWQoc2NoZWR1bGVLZXkpIHtcbiAgICBhd2FpdCB0aGlzLmVuc3VyZVJlYWR5KClcblxuICAgIGNvbnN0IG5vcm1hbGl6ZWRTY2hlZHVsZUtleSA9IHRoaXMuX25vcm1hbGl6ZVNjaGVkdWxlS2V5KHNjaGVkdWxlS2V5KVxuXG4gICAgcmV0dXJuIGF3YWl0IHRoaXMuX3NlcmlhbGl6ZWRDb3VudE11dGF0aW9uKGFzeW5jIChkYikgPT4ge1xuICAgICAgY29uc3Qgb3duZXJSb3dzID0gYXdhaXQgZGJcbiAgICAgICAgLm5ld1F1ZXJ5KClcbiAgICAgICAgLmZyb20oU0NIRURVTEVfS0VZU19UQUJMRSlcbiAgICAgICAgLndoZXJlKHtzY2hlZHVsZV9rZXk6IG5vcm1hbGl6ZWRTY2hlZHVsZUtleX0pXG4gICAgICAgIC5saW1pdCgxKVxuICAgICAgICAucmVzdWx0cygpXG5cbiAgICAgIGlmICghb3duZXJSb3dzWzBdKSByZXR1cm4ge2pvYklkOiBudWxsLCBvdXRjb21lOiBcIm5vdF9mb3VuZFwifVxuXG4gICAgICBjb25zdCBqb2JJZCA9IFN0cmluZygvKiogQHR5cGUge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gKi8gKG93bmVyUm93c1swXSkuam9iX2lkKVxuICAgICAgY29uc3Qgam9iID0gYXdhaXQgdGhpcy5fZ2V0Sm9iUm93QnlJZChkYiwgam9iSWQpXG5cbiAgICAgIGlmIChqb2I/LnN0YXR1cyA9PT0gXCJxdWV1ZWRcIikge1xuICAgICAgICBjb25zdCBhZmZlY3RlZFJvd3MgPSBhd2FpdCB0aGlzLl91cGRhdGVBZmZlY3RlZFJvd3MoZGIsIHtcbiAgICAgICAgICB0YWJsZU5hbWU6IEpPQlNfVEFCTEUsXG4gICAgICAgICAgZGF0YToge3N0YXR1czogXCJjYW5jZWxsZWRcIn0sXG4gICAgICAgICAgY29uZGl0aW9uczoge2lkOiBqb2IuaWQsIHN0YXR1czogXCJxdWV1ZWRcIn1cbiAgICAgICAgfSlcblxuICAgICAgICBpZiAoYWZmZWN0ZWRSb3dzID09PSAxKSB7XG4gICAgICAgICAgYXdhaXQgdGhpcy5fcmVsZWFzZVNjaGVkdWxlT3duZXJzaGlwKGRiLCB7am9iSWQsIHNjaGVkdWxlS2V5OiBub3JtYWxpemVkU2NoZWR1bGVLZXl9KVxuICAgICAgICAgIGF3YWl0IHRoaXMuX3JlY29yZFN0YXR1c1RyYW5zaXRpb24oZGIsIFwicXVldWVkXCIsIFwiY2FuY2VsbGVkXCIpXG5cbiAgICAgICAgICByZXR1cm4ge2pvYklkLCBvdXRjb21lOiBcImNhbmNlbGxlZFwifVxuICAgICAgICB9XG4gICAgICB9XG5cbiAgICAgIGNvbnN0IGN1cnJlbnRKb2IgPSBhd2FpdCB0aGlzLl9nZXRKb2JSb3dCeUlkKGRiLCBqb2JJZClcblxuICAgICAgYXdhaXQgdGhpcy5fcmVsZWFzZVNjaGVkdWxlT3duZXJzaGlwKGRiLCB7am9iSWQsIHNjaGVkdWxlS2V5OiBub3JtYWxpemVkU2NoZWR1bGVLZXl9KVxuXG4gICAgICBpZiAoY3VycmVudEpvYj8uc3RhdHVzID09PSBcImhhbmRlZF9vZmZcIikgcmV0dXJuIHtqb2JJZCwgb3V0Y29tZTogXCJoYW5kZWRfb2ZmXCJ9XG4gICAgICByZXR1cm4ge2pvYklkOiBudWxsLCBvdXRjb21lOiBcIm5vdF9mb3VuZFwifVxuICAgIH0sIHtcbiAgICAgIGFkdmlzb3J5TG9jazoge1xuICAgICAgICBmYWlsdXJlTWVzc2FnZTogXCJGYWlsZWQgdG8gYWNxdWlyZSBiYWNrZ3JvdW5kIGpvYiBzY2hlZHVsZS1rZXkgbG9ja1wiLFxuICAgICAgICBuYW1lOiB0aGlzLl9zY2hlZHVsZUtleUxvY2tOYW1lKG5vcm1hbGl6ZWRTY2hlZHVsZUtleSlcbiAgICAgIH1cbiAgICB9KVxuICB9XG5cbiAgLyoqXG4gICAqIFJlYWRzIHN0YWJsZSBvd25lcnNoaXAgYW5kIG9wdGlvbmFsIGxhdGVzdCB0ZXJtaW5hbCBoaXN0b3J5IGluIG9uZSBmZW5jZWQgdHJhbnNhY3Rpb24uXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBzY2hlZHVsZUtleSAtIFN0YWJsZSBsb2dpY2FsIHNjaGVkdWxlIGtleS5cbiAgICogQHBhcmFtIHt7aW5jbHVkZUxhdGVzdFRlcm1pbmFsPzogYm9vbGVhbn19IFtvcHRpb25zXSAtIExvb2t1cCBvcHRpb25zLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxpbXBvcnQoXCIuL3R5cGVzLmpzXCIpLkJhY2tncm91bmRKb2JTY2hlZHVsZWRMb29rdXBSZXN1bHQ+fSAtIE5vcm1hbGl6ZWQgcHVibGljIGpvYnMuXG4gICAqL1xuICBhc3luYyBnZXRTY2hlZHVsZWRKb2Ioc2NoZWR1bGVLZXksIHtpbmNsdWRlTGF0ZXN0VGVybWluYWwgPSBmYWxzZX0gPSB7fSkge1xuICAgIGF3YWl0IHRoaXMuZW5zdXJlUmVhZHkoKVxuXG4gICAgY29uc3Qgbm9ybWFsaXplZFNjaGVkdWxlS2V5ID0gdGhpcy5fbm9ybWFsaXplU2NoZWR1bGVLZXkoc2NoZWR1bGVLZXkpXG5cbiAgICBpZiAodHlwZW9mIGluY2x1ZGVMYXRlc3RUZXJtaW5hbCAhPT0gXCJib29sZWFuXCIpIHtcbiAgICAgIHRocm93IFZlbG9jaW91c0Vycm9yLnNhZmUoXCJiYWNrZ3JvdW5kIGpvYiBpbmNsdWRlTGF0ZXN0VGVybWluYWwgbXVzdCBiZSBhIGJvb2xlYW5cIilcbiAgICB9XG5cbiAgICByZXR1cm4gYXdhaXQgdGhpcy5fc2VyaWFsaXplZENvdW50TXV0YXRpb24oYXN5bmMgKGRiKSA9PiB7XG4gICAgICByZXR1cm4gYXdhaXQgdGhpcy5fc2NoZWR1bGVkSm9iTG9va3VwKGRiLCB7XG4gICAgICAgIGluY2x1ZGVMYXRlc3RUZXJtaW5hbCxcbiAgICAgICAgc2NoZWR1bGVLZXk6IG5vcm1hbGl6ZWRTY2hlZHVsZUtleVxuICAgICAgfSlcbiAgICB9LCB7XG4gICAgICBhZHZpc29yeUxvY2s6IHtcbiAgICAgICAgZmFpbHVyZU1lc3NhZ2U6IFwiRmFpbGVkIHRvIGFjcXVpcmUgYmFja2dyb3VuZCBqb2Igc2NoZWR1bGUta2V5IGxvY2tcIixcbiAgICAgICAgbmFtZTogdGhpcy5fc2NoZWR1bGVLZXlMb2NrTmFtZShub3JtYWxpemVkU2NoZWR1bGVLZXkpXG4gICAgICB9XG4gICAgfSlcbiAgfVxuXG4gIC8qKlxuICAgKiBNb3ZlcyBvbmx5IGEgZnV0dXJlIHF1ZXVlZCBzdGFibGUgb3duZXIgdG8gdGhlIGN1cnJlbnQgdGltZS5cbiAgICogQHBhcmFtIHtzdHJpbmd9IHNjaGVkdWxlS2V5IC0gU3RhYmxlIGxvZ2ljYWwgc2NoZWR1bGUga2V5LlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxpbXBvcnQoXCIuL3R5cGVzLmpzXCIpLkJhY2tncm91bmRKb2JXYWtlUmVzdWx0Pn0gLSBFeGFjdCB3YWtlIG91dGNvbWUuXG4gICAqL1xuICBhc3luYyB3YWtlU2NoZWR1bGVkKHNjaGVkdWxlS2V5KSB7XG4gICAgYXdhaXQgdGhpcy5lbnN1cmVSZWFkeSgpXG5cbiAgICBjb25zdCBub3JtYWxpemVkU2NoZWR1bGVLZXkgPSB0aGlzLl9ub3JtYWxpemVTY2hlZHVsZUtleShzY2hlZHVsZUtleSlcblxuICAgIHJldHVybiBhd2FpdCB0aGlzLl9zZXJpYWxpemVkQ291bnRNdXRhdGlvbihhc3luYyAoZGIpID0+IHtcbiAgICAgIGNvbnN0IGpvYiA9IGF3YWl0IHRoaXMuX3NjaGVkdWxlZE93bmVySm9iKGRiLCBub3JtYWxpemVkU2NoZWR1bGVLZXkpXG5cbiAgICAgIGlmICgham9iIHx8IChqb2Iuc3RhdHVzICE9PSBcInF1ZXVlZFwiICYmIGpvYi5zdGF0dXMgIT09IFwiaGFuZGVkX29mZlwiKSkgcmV0dXJuIHtqb2JJZDogbnVsbCwgb3V0Y29tZTogXCJub3RfZm91bmRcIn1cbiAgICAgIGlmIChqb2Iuc3RhdHVzID09PSBcImhhbmRlZF9vZmZcIikgcmV0dXJuIHtqb2JJZDogam9iLmlkLCBvdXRjb21lOiBcImhhbmRlZF9vZmZcIn1cblxuICAgICAgY29uc3Qgbm93TXMgPSB0aGlzLmNsb2NrLm5vdygpXG5cbiAgICAgIGlmIChOdW1iZXIoam9iLnNjaGVkdWxlZEF0TXMpIDw9IG5vd01zKSByZXR1cm4ge2pvYklkOiBqb2IuaWQsIG91dGNvbWU6IFwiYWxyZWFkeV9kdWVcIn1cblxuICAgICAgY29uc3QgYWZmZWN0ZWRSb3dzID0gYXdhaXQgdGhpcy5fdXBkYXRlQWZmZWN0ZWRSb3dzKGRiLCB7XG4gICAgICAgIHRhYmxlTmFtZTogSk9CU19UQUJMRSxcbiAgICAgICAgZGF0YToge3NjaGVkdWxlZF9hdF9tczogbm93TXN9LFxuICAgICAgICBjb25kaXRpb25zOiB7aWQ6IGpvYi5pZCwgc2NoZWR1bGVkX2F0X21zOiBqb2Iuc2NoZWR1bGVkQXRNcywgc3RhdHVzOiBcInF1ZXVlZFwifVxuICAgICAgfSlcblxuICAgICAgaWYgKGFmZmVjdGVkUm93cyA9PT0gMSkgcmV0dXJuIHtqb2JJZDogam9iLmlkLCBvdXRjb21lOiBcIndva2VuXCJ9XG5cbiAgICAgIGNvbnN0IGN1cnJlbnRKb2IgPSBhd2FpdCB0aGlzLl9zY2hlZHVsZWRPd25lckpvYihkYiwgbm9ybWFsaXplZFNjaGVkdWxlS2V5KVxuXG4gICAgICBpZiAoY3VycmVudEpvYj8uc3RhdHVzID09PSBcImhhbmRlZF9vZmZcIikgcmV0dXJuIHtqb2JJZDogY3VycmVudEpvYi5pZCwgb3V0Y29tZTogXCJoYW5kZWRfb2ZmXCJ9XG4gICAgICBpZiAoY3VycmVudEpvYj8uc3RhdHVzID09PSBcInF1ZXVlZFwiICYmIE51bWJlcihjdXJyZW50Sm9iLnNjaGVkdWxlZEF0TXMpIDw9IG5vd01zKSB7XG4gICAgICAgIHJldHVybiB7am9iSWQ6IGN1cnJlbnRKb2IuaWQsIG91dGNvbWU6IFwiYWxyZWFkeV9kdWVcIn1cbiAgICAgIH1cblxuICAgICAgcmV0dXJuIHtqb2JJZDogbnVsbCwgb3V0Y29tZTogXCJub3RfZm91bmRcIn1cbiAgICB9LCB7XG4gICAgICBhZHZpc29yeUxvY2s6IHtcbiAgICAgICAgZmFpbHVyZU1lc3NhZ2U6IFwiRmFpbGVkIHRvIGFjcXVpcmUgYmFja2dyb3VuZCBqb2Igc2NoZWR1bGUta2V5IGxvY2tcIixcbiAgICAgICAgbmFtZTogdGhpcy5fc2NoZWR1bGVLZXlMb2NrTmFtZShub3JtYWxpemVkU2NoZWR1bGVLZXkpXG4gICAgICB9XG4gICAgfSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIG5leHQgYXZhaWxhYmxlIGpvYi5cbiAgICogQHBhcmFtIHtvYmplY3R9IFthcmdzXSAtIE9wdGlvbnMuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi90eXBlcy5qc1wiKS5CYWNrZ3JvdW5kSm9iRXhlY3V0aW9uTW9kZSB8IGltcG9ydChcIi4vdHlwZXMuanNcIikuQmFja2dyb3VuZEpvYkV4ZWN1dGlvbk1vZGVbXX0gW2FyZ3MuZXhlY3V0aW9uTW9kZV0gLSBFeGVjdXRpb24gbW9kZSBvciBtb2RlcyB0byBtYXRjaC5cbiAgICogQHJldHVybnMge1Byb21pc2U8aW1wb3J0KFwiLi90eXBlcy5qc1wiKS5CYWNrZ3JvdW5kSm9iUm93IHwgbnVsbD59IC0gTmV4dCBqb2IuXG4gICAqL1xuICBhc3luYyBuZXh0QXZhaWxhYmxlSm9iKGFyZ3MgPSB7fSkge1xuICAgIGF3YWl0IHRoaXMuZW5zdXJlUmVhZHkoKVxuXG4gICAgcmV0dXJuIGF3YWl0IHRoaXMuX3dpdGhEYihhc3luYyAoZGIpID0+IHtcbiAgICAgIHJldHVybiBhd2FpdCB0aGlzLl9uZXh0UXVldWVkSm9iKHtcbiAgICAgICAgZGIsXG4gICAgICAgIHNjaGVkdWxlZEF0T3BlcmF0b3I6IFwiPD1cIixcbiAgICAgICAgZXhlY3V0aW9uTW9kZTogYXJncy5leGVjdXRpb25Nb2RlXG4gICAgICB9KVxuICAgIH0pXG4gIH1cblxuICAvKipcbiAgICogUmV0dXJucyB0aGUgc29vbmVzdCBmdXR1cmUtc2NoZWR1bGVkIHF1ZXVlZCBqb2IgKG9uZSB3aG9zZVxuICAgKiBgc2NoZWR1bGVkX2F0X21zYCBpcyBpbiB0aGUgZnV0dXJlKSwgb3IgbnVsbCB3aGVuIHRoZXJlIGFyZSBub1xuICAgKiBmdXR1cmUtc2NoZWR1bGVkIGpvYnMuIFVzZWQgYnkgdGhlIGV2ZW50LWRyaXZlbiBkaXNwYXRjaGVyIHRvIGFybSBhXG4gICAqIGBzZXRUaW1lb3V0YCBmb3IgdGhlIGV4YWN0IG1vbWVudCB0aGUgbmV4dCBzY2hlZHVsZWQgam9iIGJlY29tZXNcbiAgICogZWxpZ2libGUsIHJlcGxhY2luZyB0aGUgbGVnYWN5IDEtc2Vjb25kIHBvbGxpbmcgbG9vcC5cbiAgICogQHJldHVybnMge1Byb21pc2U8aW1wb3J0KFwiLi90eXBlcy5qc1wiKS5CYWNrZ3JvdW5kSm9iUm93IHwgbnVsbD59IC0gU29vbmVzdCBmdXR1cmUtc2NoZWR1bGVkIGpvYiwgb3IgbnVsbC5cbiAgICovXG4gIGFzeW5jIG5leHRTY2hlZHVsZWRKb2IoKSB7XG4gICAgYXdhaXQgdGhpcy5lbnN1cmVSZWFkeSgpXG5cbiAgICByZXR1cm4gYXdhaXQgdGhpcy5fd2l0aERiKGFzeW5jIChkYikgPT4ge1xuICAgICAgcmV0dXJuIGF3YWl0IHRoaXMuX25leHRRdWV1ZWRKb2Ioe2RiLCBzY2hlZHVsZWRBdE9wZXJhdG9yOiBcIj5cIn0pXG4gICAgfSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIG5leHQgcXVldWVkIGpvYi5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBPcHRpb25zLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL2RhdGFiYXNlL2RyaXZlcnMvYmFzZS5qc1wiKS5kZWZhdWx0fSBhcmdzLmRiIC0gRGF0YWJhc2UgY29ubmVjdGlvbi5cbiAgICogQHBhcmFtIHtcIjw9XCIgfCBcIj5cIn0gYXJncy5zY2hlZHVsZWRBdE9wZXJhdG9yIC0gU2NoZWR1bGVkIHRpbWVzdGFtcCBvcGVyYXRvci5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL3R5cGVzLmpzXCIpLkJhY2tncm91bmRKb2JFeGVjdXRpb25Nb2RlIHwgaW1wb3J0KFwiLi90eXBlcy5qc1wiKS5CYWNrZ3JvdW5kSm9iRXhlY3V0aW9uTW9kZVtdfSBbYXJncy5leGVjdXRpb25Nb2RlXSAtIEV4ZWN1dGlvbiBtb2RlIG9yIG1vZGVzIHRvIG1hdGNoLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxpbXBvcnQoXCIuL3R5cGVzLmpzXCIpLkJhY2tncm91bmRKb2JSb3cgfCBudWxsPn0gLSBOZXh0IG1hdGNoaW5nIHF1ZXVlZCBqb2IuXG4gICAqL1xuICBhc3luYyBfbmV4dFF1ZXVlZEpvYih7ZGIsIHNjaGVkdWxlZEF0T3BlcmF0b3IsIGV4ZWN1dGlvbk1vZGV9KSB7XG4gICAgY29uc3Qgbm93ID0gdGhpcy5jbG9jay5ub3coKVxuICAgIGxldCBxdWVyeSA9IGRiXG4gICAgICAubmV3UXVlcnkoKVxuICAgICAgLmZyb20oSk9CU19UQUJMRSlcbiAgICAgIC53aGVyZSh7c3RhdHVzOiBcInF1ZXVlZFwifSlcbiAgICAgIC53aGVyZShgc2NoZWR1bGVkX2F0X21zICR7c2NoZWR1bGVkQXRPcGVyYXRvcn0gJHtkYi5xdW90ZShub3cpfWApXG5cbiAgICBpZiAoc2NoZWR1bGVkQXRPcGVyYXRvciA9PT0gXCI8PVwiKSB7XG4gICAgICBjb25zdCBqb2JzVGFibGUgPSBkYi5xdW90ZVRhYmxlKEpPQlNfVEFCTEUpXG4gICAgICBjb25zdCBjb25jdXJyZW5jeVRhYmxlID0gZGIucXVvdGVUYWJsZShDT05DVVJSRU5DWV9UQUJMRSlcbiAgICAgIHF1ZXJ5ID0gcXVlcnkud2hlcmUoXG4gICAgICAgIGAoJHtqb2JzVGFibGV9LiR7ZGIucXVvdGVDb2x1bW4oXCJjb25jdXJyZW5jeV9rZXlcIil9IElTIE5VTEwgT1IgRVhJU1RTIChgICtcbiAgICAgICAgYFNFTEVDVCAxIEZST00gJHtjb25jdXJyZW5jeVRhYmxlfSBXSEVSRSBgICtcbiAgICAgICAgYCR7Y29uY3VycmVuY3lUYWJsZX0uJHtkYi5xdW90ZUNvbHVtbihcImNvbmN1cnJlbmN5X2tleVwiKX0gPSAke2pvYnNUYWJsZX0uJHtkYi5xdW90ZUNvbHVtbihcImNvbmN1cnJlbmN5X2tleVwiKX0gQU5EIGAgK1xuICAgICAgICBgJHtjb25jdXJyZW5jeVRhYmxlfS4ke2RiLnF1b3RlQ29sdW1uKFwiYWN0aXZlX2NvdW50XCIpfSA8ICR7Y29uY3VycmVuY3lUYWJsZX0uJHtkYi5xdW90ZUNvbHVtbihcIm1heF9jb25jdXJyZW5jeVwiKX0pKWBcbiAgICAgIClcbiAgICB9XG5cbiAgICBpZiAoZXhlY3V0aW9uTW9kZSkgcXVlcnkgPSB0aGlzLl93aGVyZUV4ZWN1dGlvbk1vZGUoe2RiLCBleGVjdXRpb25Nb2RlLCBxdWVyeX0pXG5cbiAgICBpZiAoc2NoZWR1bGVkQXRPcGVyYXRvciA9PT0gXCI8PVwiKSB7XG4gICAgICBjb25zdCBwcmlvcml0eU9yZGVyID0gdGhpcy5fcXVldWVQcmlvcml0eU9yZGVyU3FsKGRiKVxuXG4gICAgICBpZiAocHJpb3JpdHlPcmRlcikgcXVlcnkgPSBxdWVyeS5vcmRlcihgJHtwcmlvcml0eU9yZGVyfSBERVNDYClcbiAgICB9XG5cbiAgICBxdWVyeSA9IHF1ZXJ5XG4gICAgICAub3JkZXIoXCJzY2hlZHVsZWRfYXRfbXMgQVNDXCIpXG4gICAgICAub3JkZXIoXCJjcmVhdGVkX2F0X21zIEFTQ1wiKVxuICAgICAgLmxpbWl0KDEpXG5cbiAgICBjb25zdCByb3dzID0gYXdhaXQgcXVlcnkucmVzdWx0cygpXG4gICAgY29uc3Qgcm93ID0gcm93c1swXVxuXG4gICAgaWYgKCFyb3cpIHJldHVybiBudWxsXG5cbiAgICByZXR1cm4gdGhpcy5fbm9ybWFsaXplSm9iUm93KHJvdylcbiAgfVxuXG4gIC8qKlxuICAgKiBCdWlsZHMgYSByYXcgU1FMIE9SREVSIEJZIGV4cHJlc3Npb24gcmFua2luZyBxdWV1ZWQgam9icyBieSB0aGVpciBxdWV1ZSdzXG4gICAqIGNvbmZpZ3VyZWQgcHJpb3JpdHkgKGBiYWNrZ3JvdW5kSm9icy5xdWV1ZXNbcXVldWVdLnByaW9yaXR5YCwgZGVmYXVsdCBgMGApLFxuICAgKiBzbyB0aGUgZGlzcGF0Y2hlciBwaWNrcyBoaWdoZXItcHJpb3JpdHkgcXVldWVzIGZpcnN0IHJlZ2FyZGxlc3Mgb2YgZW5xdWV1ZVxuICAgKiBvcmRlci4gT25seSBhcHBsaWVkIHRvIHRoZSBkaXNwYXRjaCBwYXRoIChgc2NoZWR1bGVkQXRPcGVyYXRvciA9PT0gXCI8PVwiYCk7XG4gICAqIHRoZSBmdXR1cmUtc2NoZWR1bGVkIGxvb2t1cCBtdXN0IHN0YXkgc3RyaWN0bHkgdGltZS1vcmRlcmVkLiBDb21wb3NlcyB3aXRoXG4gICAqIHRoZSBjb25jdXJyZW5jeSBFWElTVFMgZmlsdGVyOiBhIGhpZ2hlci1wcmlvcml0eSBxdWV1ZSBhbHJlYWR5IGF0IGl0cyBjYXAgaXNcbiAgICogZmlsdGVyZWQgb3V0LCBzbyBkaXNwYXRjaCBmYWxscyB0aHJvdWdoIHRvIHRoZSBuZXh0IGVsaWdpYmxlIGxvd2VyLXByaW9yaXR5XG4gICAqIGpvYi4gUmV0dXJucyBudWxsIHdoZW4gbm8gcXVldWUgY29uZmlndXJlcyBhIG5vbi16ZXJvIHByaW9yaXR5IHNvIHRoZSBwbGFpblxuICAgKiBGSUZPIG9yZGVyaW5nIGlzIGxlZnQgdW50b3VjaGVkIChhbmQgbm8gbmVlZGxlc3MgZmlsZXNvcnQgaXMgaW50cm9kdWNlZCkuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vZGF0YWJhc2UvZHJpdmVycy9iYXNlLmpzXCIpLmRlZmF1bHR9IGRiIC0gRGF0YWJhc2UgY29ubmVjdGlvbi5cbiAgICogQHJldHVybnMge3N0cmluZyB8IG51bGx9IC0gUmF3IFNRTCBDQVNFIGV4cHJlc3Npb24sIG9yIG51bGwgd2hlbiBubyBxdWV1ZSBpcyBwcmlvcml0aXplZC5cbiAgICovXG4gIF9xdWV1ZVByaW9yaXR5T3JkZXJTcWwoZGIpIHtcbiAgICBjb25zdCBxdWV1ZXMgPSB0aGlzLmNvbmZpZ3VyYXRpb24uZ2V0QmFja2dyb3VuZEpvYnNDb25maWcoKS5xdWV1ZXMgfHwge31cbiAgICAvKiogQHR5cGUge0FycmF5PFtzdHJpbmcsIG51bWJlcl0+fSAqL1xuICAgIGNvbnN0IHByaW9yaXRpemVkID0gW11cblxuICAgIGZvciAoY29uc3QgW3F1ZXVlLCBxdWV1ZUNvbmZpZ10gb2YgT2JqZWN0LmVudHJpZXMocXVldWVzKSkge1xuICAgICAgY29uc3QgcHJpb3JpdHkgPSBxdWV1ZUNvbmZpZz8ucHJpb3JpdHlcblxuICAgICAgaWYgKE51bWJlci5pc0Zpbml0ZShwcmlvcml0eSkgJiYgTnVtYmVyKHByaW9yaXR5KSAhPT0gMCkgcHJpb3JpdGl6ZWQucHVzaChbcXVldWUsIE51bWJlcihwcmlvcml0eSldKVxuICAgIH1cblxuICAgIGlmIChwcmlvcml0aXplZC5sZW5ndGggPT09IDApIHJldHVybiBudWxsXG5cbiAgICBjb25zdCBxdWV1ZUNvbHVtbiA9IGRiLnF1b3RlQ29sdW1uKFwicXVldWVcIilcbiAgICBjb25zdCB3aGVucyA9IHByaW9yaXRpemVkXG4gICAgICAubWFwKChbcXVldWUsIHByaW9yaXR5XSkgPT4gYFdIRU4gJHtkYi5xdW90ZShxdWV1ZSl9IFRIRU4gJHtwcmlvcml0eX1gKVxuICAgICAgLmpvaW4oXCIgXCIpXG5cbiAgICByZXR1cm4gYENBU0UgQ09BTEVTQ0UoJHtxdWV1ZUNvbHVtbn0sICR7ZGIucXVvdGUoREVGQVVMVF9CQUNLR1JPVU5EX0pPQl9RVUVVRSl9KSAke3doZW5zfSBFTFNFIDAgRU5EYFxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZ2V0IGpvYi5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGpvYklkIC0gSm9iIGlkLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxpbXBvcnQoXCIuL3R5cGVzLmpzXCIpLkJhY2tncm91bmRKb2JSb3cgfCBudWxsPn0gLSBKb2Igcm93LlxuICAgKi9cbiAgYXN5bmMgZ2V0Sm9iKGpvYklkKSB7XG4gICAgYXdhaXQgdGhpcy5lbnN1cmVSZWFkeSgpXG5cbiAgICByZXR1cm4gYXdhaXQgdGhpcy5fd2l0aERiKGFzeW5jIChkYikgPT4ge1xuICAgICAgY29uc3QgcXVlcnkgPSBkYlxuICAgICAgICAubmV3UXVlcnkoKVxuICAgICAgICAuZnJvbShKT0JTX1RBQkxFKVxuICAgICAgICAud2hlcmUoe2lkOiBqb2JJZH0pXG4gICAgICAgIC5saW1pdCgxKVxuXG4gICAgICBjb25zdCByb3dzID0gYXdhaXQgcXVlcnkucmVzdWx0cygpXG4gICAgICBjb25zdCByb3cgPSByb3dzWzBdXG5cbiAgICAgIGlmICghcm93KSByZXR1cm4gbnVsbFxuXG4gICAgICByZXR1cm4gdGhpcy5fbm9ybWFsaXplSm9iUm93KHJvdylcbiAgICB9KVxuICB9XG5cbiAgLyoqXG4gICAqIENvdW50cyBqb2JzIGdyb3VwZWQgYnkgc3RhdHVzLiBVc2VkIGJ5IHRoZSBkYXNoYm9hcmQgb3ZlcnZpZXcuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPFJlY29yZDxzdHJpbmcsIG51bWJlcj4+fSAtIENvdW50cyBrZXllZCBieSBzdGF0dXMuXG4gICAqL1xuICBhc3luYyBjb3VudHNCeVN0YXR1cygpIHtcbiAgICBhd2FpdCB0aGlzLmVuc3VyZVJlYWR5KClcblxuICAgIHJldHVybiBhd2FpdCB0aGlzLl93aXRoRGIoYXN5bmMgKGRiKSA9PiB7XG4gICAgICBjb25zdCByb3dzID0gYXdhaXQgZGJcbiAgICAgICAgLm5ld1F1ZXJ5KClcbiAgICAgICAgLmZyb20oSk9CU19UQUJMRSlcbiAgICAgICAgLnNlbGVjdChcInN0YXR1c1wiKVxuICAgICAgICAuc2VsZWN0KFwiQ09VTlQoKikgQVMgY291bnRcIilcbiAgICAgICAgLmdyb3VwKFwic3RhdHVzXCIpXG4gICAgICAgIC5yZXN1bHRzKClcblxuICAgICAgLyoqXG4gICAgICAgKiBDb3VudHMuXG4gICAgICAgKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgbnVtYmVyPn0gKi9cbiAgICAgIGNvbnN0IGNvdW50cyA9IHt9XG5cbiAgICAgIGZvciAoY29uc3Qgcm93IG9mIHJvd3MpIHtcbiAgICAgICAgY29uc3QgdHlwZWRSb3cgPSAvKiogQHR5cGUge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gKi8gKHJvdylcblxuICAgICAgICBjb3VudHNbU3RyaW5nKHR5cGVkUm93LnN0YXR1cyldID0gdGhpcy5fbm9ybWFsaXplTnVtYmVyKHR5cGVkUm93LmNvdW50KSB8fCAwXG4gICAgICB9XG5cbiAgICAgIHJldHVybiBjb3VudHNcbiAgICB9KVxuICB9XG5cbiAgLyoqXG4gICAqIFJldHVybnMgdGhlIGF1dGhvcml0YXRpdmUgZGFzaGJvYXJkIGNvdW50IHNuYXBzaG90IGFuZCBpdHMgbWF0Y2hpbmcgZHVyYWJsZVxuICAgKiByZXZpc2lvbi4gTG9ja2luZyB0aGUgcmV2aXNpb24gcm93IGJlZm9yZSBjb3VudGluZyBwcmV2ZW50cyBhIHdyaXRlciBmcm9tXG4gICAqIGNvbW1pdHRpbmcgYmV0d2VlbiB0aGUgY291bnQgcXVlcnkgYW5kIHJldmlzaW9uIHJlYWQuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHtjb3VudHM6IFJlY29yZDxzdHJpbmcsIG51bWJlcj4sIHJldmlzaW9uOiBudW1iZXIsIHRvdGFsOiBudW1iZXJ9Pn0gU25hcHNob3QuXG4gICAqL1xuICBhc3luYyBjb3VudFNuYXBzaG90KCkge1xuICAgIGF3YWl0IHRoaXMuZW5zdXJlUmVhZHkoKVxuXG4gICAgcmV0dXJuIGF3YWl0IHRoaXMuX3NlcmlhbGl6ZWRDb3VudE11dGF0aW9uKGFzeW5jIChkYikgPT4ge1xuICAgICAgcmV0dXJuIGF3YWl0IHRoaXMuX2NvdW50U25hcHNob3RPbkxvY2tlZENvbm5lY3Rpb24oZGIpXG4gICAgfSlcbiAgfVxuXG4gIC8qKlxuICAgKiBDb3VudHMgam9icyBtYXRjaGluZyB0aGUgZ2l2ZW4gZmlsdGVycy5cbiAgICogQHBhcmFtIHtvYmplY3R9IFthcmdzXSAtIE9wdGlvbnMuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBbYXJncy5zdGF0dXNdIC0gRmlsdGVyIGJ5IHN0YXR1cy5cbiAgICogQHBhcmFtIHtzdHJpbmd9IFthcmdzLmpvYk5hbWVdIC0gRmlsdGVyIGJ5IGpvYiBuYW1lLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxudW1iZXI+fSAtIE1hdGNoaW5nIGpvYiBjb3VudC5cbiAgICovXG4gIGFzeW5jIGNvdW50Sm9icyh7c3RhdHVzLCBqb2JOYW1lfSA9IHt9KSB7XG4gICAgYXdhaXQgdGhpcy5lbnN1cmVSZWFkeSgpXG5cbiAgICByZXR1cm4gYXdhaXQgdGhpcy5fd2l0aERiKGFzeW5jIChkYikgPT4ge1xuICAgICAgbGV0IHF1ZXJ5ID0gZGIubmV3UXVlcnkoKS5mcm9tKEpPQlNfVEFCTEUpLnNlbGVjdChcIkNPVU5UKCopIEFTIGNvdW50XCIpXG5cbiAgICAgIGlmIChzdGF0dXMpIHF1ZXJ5ID0gcXVlcnkud2hlcmUoe3N0YXR1c30pXG4gICAgICBpZiAoam9iTmFtZSkgcXVlcnkgPSBxdWVyeS53aGVyZSh7am9iX25hbWU6IGpvYk5hbWV9KVxuXG4gICAgICBjb25zdCByb3dzID0gYXdhaXQgcXVlcnkucmVzdWx0cygpXG4gICAgICBjb25zdCBjb3VudFJvdyA9IC8qKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSAqLyAocm93c1swXSB8fCB7fSlcblxuICAgICAgcmV0dXJuIHRoaXMuX25vcm1hbGl6ZU51bWJlcihjb3VudFJvdy5jb3VudCkgfHwgMFxuICAgIH0pXG4gIH1cblxuICAvKipcbiAgICogTGlzdHMgam9icyBmb3IgdGhlIGRhc2hib2FyZCwgZmlsdGVyZWQsIHNvcnRlZCBhbmQgcGFnaW5hdGVkLlxuICAgKiBAcGFyYW0ge29iamVjdH0gW2FyZ3NdIC0gT3B0aW9ucy5cbiAgICogQHBhcmFtIHtzdHJpbmd9IFthcmdzLnN0YXR1c10gLSBGaWx0ZXIgYnkgc3RhdHVzLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gW2FyZ3Muam9iTmFtZV0gLSBGaWx0ZXIgYnkgam9iIG5hbWUuXG4gICAqIEBwYXJhbSB7bnVtYmVyfSBbYXJncy5saW1pdF0gLSBNYXhpbXVtIHJvd3MgdG8gcmV0dXJuLlxuICAgKiBAcGFyYW0ge251bWJlcn0gW2FyZ3Mub2Zmc2V0XSAtIFJvd3MgdG8gc2tpcC5cbiAgICogQHBhcmFtIHtzdHJpbmd9IFthcmdzLnNvcnRDb2x1bW5dIC0gQ2FtZWwtY2FzZWQgY29sdW1uIHRvIHNvcnQgYnkgKHNlZSBTT1JUQUJMRV9DT0xVTU5TKS5cbiAgICogQHBhcmFtIHtcIkFTQ1wiIHwgXCJERVNDXCJ9IFthcmdzLnNvcnREaXJlY3Rpb25dIC0gU29ydCBkaXJlY3Rpb24uXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPGltcG9ydChcIi4vdHlwZXMuanNcIikuQmFja2dyb3VuZEpvYlJvd1tdPn0gLSBOb3JtYWxpemVkIGpvYiByb3dzLlxuICAgKi9cbiAgYXN5bmMgbGlzdEpvYnMoe3N0YXR1cywgam9iTmFtZSwgbGltaXQgPSAyNSwgb2Zmc2V0ID0gMCwgc29ydENvbHVtbiA9IFwiY3JlYXRlZEF0TXNcIiwgc29ydERpcmVjdGlvbiA9IFwiREVTQ1wifSA9IHt9KSB7XG4gICAgYXdhaXQgdGhpcy5lbnN1cmVSZWFkeSgpXG5cbiAgICBjb25zdCBjb2x1bW4gPSBTT1JUQUJMRV9DT0xVTU5TW3NvcnRDb2x1bW5dIHx8IFNPUlRBQkxFX0NPTFVNTlMuY3JlYXRlZEF0TXNcbiAgICBjb25zdCBkaXJlY3Rpb24gPSBzb3J0RGlyZWN0aW9uID09PSBcIkFTQ1wiID8gXCJBU0NcIiA6IFwiREVTQ1wiXG5cbiAgICByZXR1cm4gYXdhaXQgdGhpcy5fd2l0aERiKGFzeW5jIChkYikgPT4ge1xuICAgICAgbGV0IHF1ZXJ5ID0gZGIubmV3UXVlcnkoKS5mcm9tKEpPQlNfVEFCTEUpXG5cbiAgICAgIGlmIChzdGF0dXMpIHF1ZXJ5ID0gcXVlcnkud2hlcmUoe3N0YXR1c30pXG4gICAgICBpZiAoam9iTmFtZSkgcXVlcnkgPSBxdWVyeS53aGVyZSh7am9iX25hbWU6IGpvYk5hbWV9KVxuXG4gICAgICBxdWVyeSA9IHF1ZXJ5Lm9yZGVyKHtjb2x1bW4sIGRpcmVjdGlvbn0pXG4gICAgICBpZiAoY29sdW1uICE9PSBTT1JUQUJMRV9DT0xVTU5TLmNyZWF0ZWRBdE1zKSBxdWVyeSA9IHF1ZXJ5Lm9yZGVyKHtjb2x1bW46IFNPUlRBQkxFX0NPTFVNTlMuY3JlYXRlZEF0TXMsIGRpcmVjdGlvbjogXCJERVNDXCJ9KVxuXG4gICAgICBjb25zdCByb3dzID0gYXdhaXQgcXVlcnkubGltaXQobGltaXQpLm9mZnNldChvZmZzZXQpLnJlc3VsdHMoKVxuXG4gICAgICByZXR1cm4gcm93cy5tYXAoKHJvdykgPT4gdGhpcy5fbm9ybWFsaXplSm9iUm93KHJvdykpXG4gICAgfSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIG1hcmsgaGFuZGVkIG9mZi5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBPcHRpb25zLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gYXJncy5qb2JJZCAtIEpvYiBpZC5cbiAgICogQHBhcmFtIHtzdHJpbmd9IFthcmdzLmhhbmRvZmZJZF0gLSBDYWxsZXItc2VsZWN0ZWQgZXhhY3QgbGVhc2UgaWQuIEdlbmVyYXRlZCBmb3IgbGVnYWN5IGRpcmVjdCBjYWxsZXJzIHdoZW4gb21pdHRlZC5cbiAgICogQHBhcmFtIHtzdHJpbmd9IFthcmdzLndvcmtlcklkXSAtIFdvcmtlciBpZC5cbiAgICogQHJldHVybnMge1Byb21pc2U8aW1wb3J0KFwiLi90eXBlcy5qc1wiKS5CYWNrZ3JvdW5kSm9iSGFuZG9mZiB8IG51bGw+fSAtIENsYWltZWQgaGFuZG9mZiBsZWFzZSwgb3IgbnVsbCB3aGVuIG5vIGxvbmdlciBxdWV1ZWQuXG4gICAqL1xuICBhc3luYyBtYXJrSGFuZGVkT2ZmKHtqb2JJZCwgaGFuZG9mZklkID0gcmFuZG9tVVVJRCgpLCB3b3JrZXJJZH0pIHtcbiAgICBhd2FpdCB0aGlzLmVuc3VyZVJlYWR5KClcblxuICAgIGNvbnN0IGhhbmRlZE9mZkF0TXMgPSB0aGlzLmNsb2NrLm5vdygpXG5cbiAgICByZXR1cm4gYXdhaXQgdGhpcy5fc2VyaWFsaXplZENvdW50TXV0YXRpb24oYXN5bmMgKGRiKSA9PiB7XG4gICAgICBjb25zdCBzZWxlY3RlZEpvYiA9IGF3YWl0IHRoaXMuX2dldEpvYlJvd0J5SWQoZGIsIGpvYklkKVxuICAgICAgaWYgKCFzZWxlY3RlZEpvYiB8fCBzZWxlY3RlZEpvYi5zdGF0dXMgIT09IFwicXVldWVkXCIpIHJldHVybiBudWxsXG4gICAgICBjb25zdCBxdWV1ZWRKb2IgPSBhd2FpdCB0aGlzLl9yZWNvbmNpbGVRdWV1ZWRKb2JDb25jdXJyZW5jeShkYiwgc2VsZWN0ZWRKb2IpXG5cbiAgICAgIGlmICghcXVldWVkSm9iKSByZXR1cm4gbnVsbFxuICAgICAgaWYgKHF1ZXVlZEpvYi5jb25jdXJyZW5jeUtleSAmJiAhKGF3YWl0IHRoaXMuX3Jlc2VydmVDb25jdXJyZW5jeShkYiwgcXVldWVkSm9iLmNvbmN1cnJlbmN5S2V5KSkpIHJldHVybiBudWxsXG4gICAgICBjb25zdCBhZmZlY3RlZFJvd3MgPSBhd2FpdCB0aGlzLl91cGRhdGVBZmZlY3RlZFJvd3MoZGIsIHtcbiAgICAgICAgdGFibGVOYW1lOiBKT0JTX1RBQkxFLFxuICAgICAgICBkYXRhOiB7XG4gICAgICAgICAgc3RhdHVzOiBcImhhbmRlZF9vZmZcIixcbiAgICAgICAgICBoYW5kZWRfb2ZmX2F0X21zOiBoYW5kZWRPZmZBdE1zLFxuICAgICAgICAgIGhhbmRvZmZfaWQ6IGhhbmRvZmZJZCxcbiAgICAgICAgICB3b3JrZXJfaWQ6IHdvcmtlcklkIHx8IG51bGwsXG4gICAgICAgICAgLi4udGhpcy5fY2xlYXJlZENoaWxkQWNjZXB0YW5jZURhdGEoKVxuICAgICAgICB9LFxuICAgICAgICBjb25kaXRpb25zOiB7Y29uY3VycmVuY3lfa2V5OiBxdWV1ZWRKb2IuY29uY3VycmVuY3lLZXksIGlkOiBqb2JJZCwgc3RhdHVzOiBcInF1ZXVlZFwifVxuICAgICAgfSlcblxuICAgICAgaWYgKGFmZmVjdGVkUm93cyAhPT0gMSkge1xuICAgICAgICBhd2FpdCB0aGlzLl9yZWxlYXNlQ29uY3VycmVuY3koZGIsIHF1ZXVlZEpvYi5jb25jdXJyZW5jeUtleSlcbiAgICAgICAgcmV0dXJuIG51bGxcbiAgICAgIH1cblxuICAgICAgYXdhaXQgdGhpcy5fcmVjb3JkU3RhdHVzVHJhbnNpdGlvbihkYiwgXCJxdWV1ZWRcIiwgXCJoYW5kZWRfb2ZmXCIpXG4gICAgICAvKiogQHR5cGUge2ltcG9ydChcIi4vdHlwZXMuanNcIikuQmFja2dyb3VuZEpvYlJvd30gKi9cbiAgICAgIGNvbnN0IGhhbmRlZE9mZkpvYiA9IHtcbiAgICAgICAgLi4ucXVldWVkSm9iLFxuICAgICAgICAuLi50aGlzLl9jbGVhcmVkQ2hpbGRBY2NlcHRhbmNlUm93KCksXG4gICAgICAgIGhhbmRlZE9mZkF0TXMsXG4gICAgICAgIGhhbmRvZmZJZCxcbiAgICAgICAgc3RhdHVzOiBcImhhbmRlZF9vZmZcIixcbiAgICAgICAgd29ya2VySWQ6IHdvcmtlcklkIHx8IG51bGxcbiAgICAgIH1cblxuICAgICAgcmV0dXJuIHtoYW5kZWRPZmZBdE1zLCBoYW5kb2ZmSWQsIGpvYjogaGFuZGVkT2ZmSm9ifVxuICAgIH0pXG4gIH1cblxuICAvKipcbiAgICogUnVucyBtYXJrIGNvbXBsZXRlZC5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBPcHRpb25zLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gYXJncy5qb2JJZCAtIEpvYiBpZC5cbiAgICogQHBhcmFtIHtzdHJpbmd9IFthcmdzLmhhbmRvZmZJZF0gLSBIYW5kb2ZmIGxlYXNlIGlkLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gW2FyZ3Mud29ya2VySWRdIC0gV29ya2VyIGlkLlxuICAgKiBAcGFyYW0ge251bWJlcn0gW2FyZ3MuaGFuZGVkT2ZmQXRNc10gLSBIYW5kZWQgb2ZmIHRpbWVzdGFtcC5cbiAgICogQHJldHVybnMge1Byb21pc2U8Ym9vbGVhbj59IC0gV2hldGhlciB0aGUgZmVuY2VkIHJlcG9ydCB3YXMgYWNjZXB0ZWQuXG4gICAqL1xuICBhc3luYyBtYXJrQ29tcGxldGVkKHtqb2JJZCwgaGFuZG9mZklkLCB3b3JrZXJJZCwgaGFuZGVkT2ZmQXRNc30pIHtcbiAgICBhd2FpdCB0aGlzLmVuc3VyZVJlYWR5KClcblxuICAgIHJldHVybiBhd2FpdCB0aGlzLl9zZXJpYWxpemVkQ291bnRNdXRhdGlvbihhc3luYyAoZGIpID0+IHtcbiAgICAgIGNvbnN0IGpvYiA9IGF3YWl0IHRoaXMuX2dldEpvYlJvd0J5SWQoZGIsIGpvYklkKVxuXG4gICAgICBpZiAoIWpvYikgcmV0dXJuIGZhbHNlXG4gICAgICBpZiAoIXRoaXMuX3Nob3VsZEFjY2VwdFJlcG9ydCh7am9iLCBoYW5kb2ZmSWQsIHdvcmtlcklkLCBoYW5kZWRPZmZBdE1zfSkpIHJldHVybiBmYWxzZVxuXG4gICAgICBhd2FpdCB0aGlzLl9sb2NrQ29uY3VycmVuY3lSb3coZGIsIGpvYi5jb25jdXJyZW5jeUtleSlcbiAgICAgIGNvbnN0IGFmZmVjdGVkUm93cyA9IGF3YWl0IHRoaXMuX3VwZGF0ZUFmZmVjdGVkUm93cyhkYiwge1xuICAgICAgICB0YWJsZU5hbWU6IEpPQlNfVEFCTEUsXG4gICAgICAgIGRhdGE6IHtcbiAgICAgICAgICBzdGF0dXM6IFwiY29tcGxldGVkXCIsXG4gICAgICAgICAgY29tcGxldGVkX2F0X21zOiB0aGlzLmNsb2NrLm5vdygpXG4gICAgICAgIH0sXG4gICAgICAgIGNvbmRpdGlvbnM6IHRoaXMuX2FjdGl2ZUhhbmRvZmZDb25kaXRpb25zKGpvYilcbiAgICAgIH0pXG5cbiAgICAgIGlmIChhZmZlY3RlZFJvd3MgIT09IDEpIHJldHVybiBmYWxzZVxuICAgICAgYXdhaXQgdGhpcy5fcmVsZWFzZVNjaGVkdWxlT3duZXJzaGlwRm9ySm9iKGRiLCBqb2IpXG4gICAgICBhd2FpdCB0aGlzLl9yZWxlYXNlQ29uY3VycmVuY3koZGIsIGpvYi5jb25jdXJyZW5jeUtleSlcbiAgICAgIGF3YWl0IHRoaXMuX3JlY29yZFN0YXR1c1RyYW5zaXRpb24oZGIsIFwiaGFuZGVkX29mZlwiLCBcImNvbXBsZXRlZFwiKVxuICAgICAgcmV0dXJuIHRydWVcbiAgICB9KVxuICB9XG5cbiAgLyoqXG4gICAqIFJlY29yZHMgcG9vbGVkLWNoaWxkIGFjY2VwdGFuY2UgZXZpZGVuY2UgZm9yIGFuIGFjdGl2ZSBoYW5kb2ZmOiB3aGVuIHRoZVxuICAgKiBleGVjdXRpbmcgcnVubmVyIGNoaWxkIHJlY2VpdmVkIGFuZC9vciBzdGFydGVkIHRoZSBqb2IsIHBsdXMgdGhhdCBjaGlsZCdzXG4gICAqIHN0YWJsZSBpZGVudGl0eSBhbmQgcGlkLiBPbmx5IHRoZSBmaWVsZHMgc3VwcGxpZWQgYXJlIHdyaXR0ZW4sIHNvIGFcbiAgICogcmVjZWl2ZWQtdGhlbi1zdGFydGVkIG9ic2VydmF0aW9uIGxhbmRzIGFzIHR3byBmZW5jZWQgcGFydGlhbCB1cGRhdGVzLiBUaGVcbiAgICogdXBkYXRlIGlzIGZlbmNlZCBieSB0aGUgZXhhY3QgYWN0aXZlIGhhbmRvZmYgbGVhc2UsIHNvIGEgcmVwb3J0IGZvciBhXG4gICAqIHJlY2xhaW1lZCBvciByZS1oYW5kZWQtb2ZmIGpvYiBpcyBkcm9wcGVkIGluc3RlYWQgb2Ygc3RhbXBpbmcgdGhlIHdyb25nXG4gICAqIGF0dGVtcHQuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gT3B0aW9ucy5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGFyZ3Muam9iSWQgLSBKb2IgaWQuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBbYXJncy5oYW5kb2ZmSWRdIC0gSGFuZG9mZiBsZWFzZSBpZC5cbiAgICogQHBhcmFtIHtzdHJpbmd9IFthcmdzLndvcmtlcklkXSAtIFdvcmtlciBpZC5cbiAgICogQHBhcmFtIHtudW1iZXJ9IFthcmdzLmhhbmRlZE9mZkF0TXNdIC0gSGFuZGVkIG9mZiB0aW1lc3RhbXAuXG4gICAqIEBwYXJhbSB7bnVtYmVyfSBbYXJncy5yZWNlaXZlZEF0TXNdIC0gRXBvY2ggbXMgdGhlIHJ1bm5lciBjaGlsZCByZWNlaXZlZCB0aGUgam9iLlxuICAgKiBAcGFyYW0ge251bWJlcn0gW2FyZ3Muc3RhcnRlZEF0TXNdIC0gRXBvY2ggbXMgdGhlIGpvYidzIHBlcmZvcm0gc3RhcnRlZCBpbiB0aGUgY2hpbGQuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBbYXJncy5jaGlsZEluc3RhbmNlSWRdIC0gU3RhYmxlIHBvb2xlZCBjaGlsZCBpZGVudGl0eS5cbiAgICogQHBhcmFtIHtudW1iZXJ9IFthcmdzLmNoaWxkUGlkXSAtIFBvb2xlZCBjaGlsZCBPUyBwaWQuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPGJvb2xlYW4+fSAtIFdoZXRoZXIgdGhlIGZlbmNlZCByZXBvcnQgd2FzIGFjY2VwdGVkLlxuICAgKi9cbiAgYXN5bmMgbWFya0NoaWxkQWNjZXB0ZWQoe2pvYklkLCBoYW5kb2ZmSWQsIHdvcmtlcklkLCBoYW5kZWRPZmZBdE1zLCByZWNlaXZlZEF0TXMsIHN0YXJ0ZWRBdE1zLCBjaGlsZEluc3RhbmNlSWQsIGNoaWxkUGlkfSkge1xuICAgIGF3YWl0IHRoaXMuZW5zdXJlUmVhZHkoKVxuXG4gICAgcmV0dXJuIGF3YWl0IHRoaXMuX3NlcmlhbGl6ZWRDb25uZWN0aW9uTXV0YXRpb24oYXN5bmMgKGRiKSA9PiB7XG4gICAgICBjb25zdCBqb2IgPSBhd2FpdCB0aGlzLl9nZXRKb2JSb3dCeUlkKGRiLCBqb2JJZClcblxuICAgICAgaWYgKCFqb2IpIHJldHVybiBmYWxzZVxuICAgICAgaWYgKCF0aGlzLl9zaG91bGRBY2NlcHRSZXBvcnQoe2pvYiwgaGFuZG9mZklkLCB3b3JrZXJJZCwgaGFuZGVkT2ZmQXRNc30pKSByZXR1cm4gZmFsc2VcblxuICAgICAgY29uc3QgZGF0YSA9IHt9XG4gICAgICBpZiAodHlwZW9mIHJlY2VpdmVkQXRNcyA9PT0gXCJudW1iZXJcIikgZGF0YS5jaGlsZF9yZWNlaXZlZF9hdF9tcyA9IHJlY2VpdmVkQXRNc1xuICAgICAgaWYgKHR5cGVvZiBzdGFydGVkQXRNcyA9PT0gXCJudW1iZXJcIikgZGF0YS5jaGlsZF9zdGFydGVkX2F0X21zID0gc3RhcnRlZEF0TXNcbiAgICAgIGlmICh0eXBlb2YgY2hpbGRJbnN0YW5jZUlkID09PSBcInN0cmluZ1wiKSBkYXRhLmNoaWxkX2luc3RhbmNlX2lkID0gY2hpbGRJbnN0YW5jZUlkXG4gICAgICBpZiAodHlwZW9mIGNoaWxkUGlkID09PSBcIm51bWJlclwiKSBkYXRhLmNoaWxkX3BpZCA9IGNoaWxkUGlkXG4gICAgICBpZiAoT2JqZWN0LmtleXMoZGF0YSkubGVuZ3RoID09PSAwKSByZXR1cm4gZmFsc2VcblxuICAgICAgY29uc3QgYWZmZWN0ZWRSb3dzID0gYXdhaXQgdGhpcy5fdXBkYXRlQWZmZWN0ZWRSb3dzKGRiLCB7XG4gICAgICAgIHRhYmxlTmFtZTogSk9CU19UQUJMRSxcbiAgICAgICAgZGF0YSxcbiAgICAgICAgY29uZGl0aW9uczogdGhpcy5fYWN0aXZlSGFuZG9mZkNvbmRpdGlvbnMoam9iKVxuICAgICAgfSlcblxuICAgICAgcmV0dXJuIGFmZmVjdGVkUm93cyA9PT0gMVxuICAgIH0pXG4gIH1cblxuICAvKipcbiAgICogUmV0dXJucyB0aGUgZGF0YWJhc2UgZGF0YSB0aGF0IGNsZWFycyBwb29sZWQtY2hpbGQgYWNjZXB0YW5jZSBldmlkZW5jZS5cbiAgICogQHJldHVybnMge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gLSBDbGVhcmVkIGFjY2VwdGFuY2UgY29sdW1ucy5cbiAgICovXG4gIF9jbGVhcmVkQ2hpbGRBY2NlcHRhbmNlRGF0YSgpIHtcbiAgICByZXR1cm4ge2NoaWxkX2luc3RhbmNlX2lkOiBudWxsLCBjaGlsZF9waWQ6IG51bGwsIGNoaWxkX3JlY2VpdmVkX2F0X21zOiBudWxsLCBjaGlsZF9zdGFydGVkX2F0X21zOiBudWxsfVxuICB9XG5cbiAgLyoqXG4gICAqIFJldHVybnMgdGhlIHJvdy1zaGFwZSBjb3VudGVycGFydCBvZiB0aGUgY2xlYXJlZCBhY2NlcHRhbmNlIGNvbHVtbnMuXG4gICAqIEByZXR1cm5zIHtQaWNrPGltcG9ydChcIi4vdHlwZXMuanNcIikuQmFja2dyb3VuZEpvYlJvdywgXCJjaGlsZEluc3RhbmNlSWRcIiB8IFwiY2hpbGRQaWRcIiB8IFwiY2hpbGRSZWNlaXZlZEF0TXNcIiB8IFwiY2hpbGRTdGFydGVkQXRNc1wiPn0gLSBDbGVhcmVkIGFjY2VwdGFuY2UgZmllbGRzLlxuICAgKi9cbiAgX2NsZWFyZWRDaGlsZEFjY2VwdGFuY2VSb3coKSB7XG4gICAgcmV0dXJuIHtjaGlsZEluc3RhbmNlSWQ6IG51bGwsIGNoaWxkUGlkOiBudWxsLCBjaGlsZFJlY2VpdmVkQXRNczogbnVsbCwgY2hpbGRTdGFydGVkQXRNczogbnVsbH1cbiAgfVxuXG4gIC8qKlxuICAgKiBSZXR1cm5zIGFuIGFjdGl2ZSBoYW5kb2ZmIHRvIHRoZSBxdWV1ZSBhdCBhIGNhbGxlci1yZXF1ZXN0ZWQgZnV0dXJlIHRpbWUuXG4gICAqIFRoaXMgaXMgbm9ybWFsIGpvYiBjb250cm9sIGZsb3c6IGl0IHByZXNlcnZlcyBmYWlsdXJlIGF0dGVtcHRzIGFuZCBtZXRhZGF0YS5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBPcHRpb25zLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gYXJncy5qb2JJZCAtIEpvYiBpZC5cbiAgICogQHBhcmFtIHtudW1iZXJ9IGFyZ3MuZGVsYXlNcyAtIERlbGF5IGZyb20gcGVyc2lzdGVuY2UgdGltZSBpbiBtaWxsaXNlY29uZHMuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBbYXJncy5oYW5kb2ZmSWRdIC0gSGFuZG9mZiBsZWFzZSBpZC5cbiAgICogQHBhcmFtIHtzdHJpbmd9IFthcmdzLndvcmtlcklkXSAtIFdvcmtlciBpZC5cbiAgICogQHBhcmFtIHtudW1iZXJ9IFthcmdzLmhhbmRlZE9mZkF0TXNdIC0gSGFuZGVkIG9mZiB0aW1lc3RhbXAuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPGJvb2xlYW4+fSAtIFdoZXRoZXIgdGhlIGZlbmNlZCByZXBvcnQgd2FzIGFjY2VwdGVkLlxuICAgKi9cbiAgYXN5bmMgbWFya1Jlc2NoZWR1bGVkKHtqb2JJZCwgZGVsYXlNcywgaGFuZG9mZklkLCB3b3JrZXJJZCwgaGFuZGVkT2ZmQXRNc30pIHtcbiAgICBhd2FpdCB0aGlzLmVuc3VyZVJlYWR5KClcbiAgICB0aGlzLl92YWxpZGF0ZVJlc2NoZWR1bGVEZWxheU1zKGRlbGF5TXMpXG5cbiAgICByZXR1cm4gYXdhaXQgdGhpcy5fc2VyaWFsaXplZENvdW50TXV0YXRpb24oYXN5bmMgKGRiKSA9PiB7XG4gICAgICBjb25zdCBqb2IgPSBhd2FpdCB0aGlzLl9nZXRKb2JSb3dCeUlkKGRiLCBqb2JJZClcblxuICAgICAgaWYgKCFqb2IpIHJldHVybiBmYWxzZVxuICAgICAgaWYgKCF0aGlzLl9zaG91bGRBY2NlcHRSZXBvcnQoe2pvYiwgaGFuZG9mZklkLCB3b3JrZXJJZCwgaGFuZGVkT2ZmQXRNc30pKSByZXR1cm4gZmFsc2VcblxuICAgICAgYXdhaXQgdGhpcy5fbG9ja0NvbmN1cnJlbmN5Um93KGRiLCBqb2IuY29uY3VycmVuY3lLZXkpXG4gICAgICBjb25zdCBzY2hlZHVsZWRBdE1zID0gdGhpcy5fcmVzY2hlZHVsZWRBdE1zKGRlbGF5TXMpXG4gICAgICBjb25zdCBhZmZlY3RlZFJvd3MgPSBhd2FpdCB0aGlzLl91cGRhdGVBZmZlY3RlZFJvd3MoZGIsIHtcbiAgICAgICAgdGFibGVOYW1lOiBKT0JTX1RBQkxFLFxuICAgICAgICBkYXRhOiB7XG4gICAgICAgICAgc3RhdHVzOiBcInF1ZXVlZFwiLFxuICAgICAgICAgIHNjaGVkdWxlZF9hdF9tczogc2NoZWR1bGVkQXRNcyxcbiAgICAgICAgICBoYW5kZWRfb2ZmX2F0X21zOiBudWxsLFxuICAgICAgICAgIGhhbmRvZmZfaWQ6IG51bGwsXG4gICAgICAgICAgd29ya2VyX2lkOiBudWxsLFxuICAgICAgICAgIC4uLnRoaXMuX2NsZWFyZWRDaGlsZEFjY2VwdGFuY2VEYXRhKClcbiAgICAgICAgfSxcbiAgICAgICAgY29uZGl0aW9uczogdGhpcy5fYWN0aXZlSGFuZG9mZkNvbmRpdGlvbnMoam9iKVxuICAgICAgfSlcblxuICAgICAgaWYgKGFmZmVjdGVkUm93cyAhPT0gMSkgcmV0dXJuIGZhbHNlXG4gICAgICBhd2FpdCB0aGlzLl9yZWxlYXNlQ29uY3VycmVuY3koZGIsIGpvYi5jb25jdXJyZW5jeUtleSlcbiAgICAgIGF3YWl0IHRoaXMuX3JlY29yZFN0YXR1c1RyYW5zaXRpb24oZGIsIFwiaGFuZGVkX29mZlwiLCBcInF1ZXVlZFwiKVxuICAgICAgcmV0dXJuIHRydWVcbiAgICB9KVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgbWFyayByZXR1cm5lZCB0byBxdWV1ZS5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBPcHRpb25zLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gYXJncy5qb2JJZCAtIEpvYiBpZC5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGFyZ3MuaGFuZG9mZklkIC0gSGFuZG9mZiBsZWFzZSBpZC5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgd2hlbiB1cGRhdGVkLlxuICAgKi9cbiAgYXN5bmMgbWFya1JldHVybmVkVG9RdWV1ZSh7am9iSWQsIGhhbmRvZmZJZH0pIHtcbiAgICBhd2FpdCB0aGlzLmVuc3VyZVJlYWR5KClcblxuICAgIGF3YWl0IHRoaXMuX3NlcmlhbGl6ZWRDb3VudE11dGF0aW9uKGFzeW5jIChkYikgPT4ge1xuICAgICAgY29uc3Qgam9iID0gYXdhaXQgdGhpcy5fZ2V0Sm9iUm93QnlJZChkYiwgam9iSWQpXG4gICAgICBpZiAoIWpvYiB8fCBqb2IuaGFuZG9mZklkICE9PSBoYW5kb2ZmSWQgfHwgam9iLnN0YXR1cyAhPT0gXCJoYW5kZWRfb2ZmXCIpIHJldHVyblxuICAgICAgYXdhaXQgdGhpcy5fbG9ja0NvbmN1cnJlbmN5Um93KGRiLCBqb2IuY29uY3VycmVuY3lLZXkpXG4gICAgICBjb25zdCBhZmZlY3RlZFJvd3MgPSBhd2FpdCB0aGlzLl91cGRhdGVBZmZlY3RlZFJvd3MoZGIsIHtcbiAgICAgICAgdGFibGVOYW1lOiBKT0JTX1RBQkxFLFxuICAgICAgICBkYXRhOiB7XG4gICAgICAgICAgc3RhdHVzOiBcInF1ZXVlZFwiLFxuICAgICAgICAgIHNjaGVkdWxlZF9hdF9tczogdGhpcy5jbG9jay5ub3coKSxcbiAgICAgICAgICBoYW5kZWRfb2ZmX2F0X21zOiBudWxsLFxuICAgICAgICAgIGhhbmRvZmZfaWQ6IG51bGwsXG4gICAgICAgICAgd29ya2VyX2lkOiBudWxsLFxuICAgICAgICAgIC4uLnRoaXMuX2NsZWFyZWRDaGlsZEFjY2VwdGFuY2VEYXRhKClcbiAgICAgICAgfSxcbiAgICAgICAgY29uZGl0aW9uczoge2hhbmRvZmZfaWQ6IGhhbmRvZmZJZCwgaWQ6IGpvYklkLCBzdGF0dXM6IFwiaGFuZGVkX29mZlwifVxuICAgICAgfSlcbiAgICAgIGlmIChhZmZlY3RlZFJvd3MgPT09IDEpIHtcbiAgICAgICAgYXdhaXQgdGhpcy5fcmVsZWFzZUNvbmN1cnJlbmN5KGRiLCBqb2IuY29uY3VycmVuY3lLZXkpXG4gICAgICAgIGF3YWl0IHRoaXMuX3JlY29yZFN0YXR1c1RyYW5zaXRpb24oZGIsIFwiaGFuZGVkX29mZlwiLCBcInF1ZXVlZFwiKVxuICAgICAgfVxuICAgIH0pXG4gIH1cblxuICAvKipcbiAgICogUmV0dXJucyB0aGUgYWN0aXZlIGBoYW5kZWRfb2ZmYCBqb2JzIChqb2JJZCArIGhhbmRvZmZJZCkgaGVsZCB1bmRlciBhIHdvcmtlclxuICAgKiBpZC4gVXNlZCBvbiB3b3JrZXIgcmVjb25uZWN0OiBhZnRlciBhIG1haW4gcmVzdGFydCBhIHdvcmtlciByZWNvbm5lY3RzIHdpdGhcbiAgICogaXRzIHN0YWJsZSBpZCwgYW5kIHRoZSBmcmVzaCBtYWluIGFkb3B0cyB0aGVzZSBsZWFzZXMgc28gdGhleSBhcmUgdHJhY2tlZCDigJRcbiAgICogYW5kIHJlbGVhc2VkIGlmIHRoZSByZWNvbm5lY3RlZCB3b3JrZXIgbGF0ZXIgZGlzY29ubmVjdHMg4oCUIGluc3RlYWQgb2ZcbiAgICogc2l0dGluZyBzdHVjayB1bnRpbCB0aGUgYWdlLWJhc2VkIG9ycGhhbiBzd2VlcC4gVGhpcyBuZXZlciByZWNsYWltcywgc28gYVxuICAgKiBncmFjZWZ1bGx5LWRyYWluaW5nIHdvcmtlciB0aGF0IGtlZXBzIHJ1bm5pbmcgaXRzIGluLWZsaWdodCBqb2JzIGlzIGxlZnRcbiAgICogdW50b3VjaGVkLiBSb3dzIHdpdGggYSBudWxsIGhhbmRvZmYgaWQgKGxlZ2FjeSkgYXJlIHNraXBwZWQ7IHRoZSBvcnBoYW5cbiAgICogc3dlZXAgcmVjbGFpbXMgdGhvc2UgdmlhIGl0cyBgaGFuZGVkX29mZl9hdF9tc2AgZmVuY2UuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gT3B0aW9ucy5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGFyZ3Mud29ya2VySWQgLSBXb3JrZXIgaWQuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPEFycmF5PHtqb2JJZDogc3RyaW5nLCBoYW5kb2ZmSWQ6IHN0cmluZ30+Pn0gLSBBY3RpdmUgaGFuZG9mZnMuXG4gICAqL1xuICBhc3luYyBoYW5kZWRPZmZKb2JzRm9yV29ya2VyKHt3b3JrZXJJZH0pIHtcbiAgICBhd2FpdCB0aGlzLmVuc3VyZVJlYWR5KClcblxuICAgIGNvbnN0IHJvd3MgPSBhd2FpdCB0aGlzLl93aXRoRGIoYXN5bmMgKGRiKSA9PlxuICAgICAgYXdhaXQgZGIubmV3UXVlcnkoKS5mcm9tKEpPQlNfVEFCTEUpLndoZXJlKHtzdGF0dXM6IFwiaGFuZGVkX29mZlwiLCB3b3JrZXJfaWQ6IHdvcmtlcklkfSkucmVzdWx0cygpXG4gICAgKVxuXG4gICAgLyoqIEB0eXBlIHtBcnJheTx7am9iSWQ6IHN0cmluZywgaGFuZG9mZklkOiBzdHJpbmd9Pn0gKi9cbiAgICBjb25zdCBoYW5kb2ZmcyA9IFtdXG5cbiAgICBmb3IgKGNvbnN0IHJvdyBvZiByb3dzKSB7XG4gICAgICBjb25zdCBqb2IgPSB0aGlzLl9ub3JtYWxpemVKb2JSb3cocm93KVxuXG4gICAgICBpZiAoam9iLmhhbmRvZmZJZCkgaGFuZG9mZnMucHVzaCh7am9iSWQ6IGpvYi5pZCwgaGFuZG9mZklkOiBqb2IuaGFuZG9mZklkfSlcbiAgICB9XG5cbiAgICByZXR1cm4gaGFuZG9mZnNcbiAgfVxuXG4gIC8qKlxuICAgKiBTbmFwc2hvdHMgZXhhY3QsIGxlYXNlLWF3YXJlIGFjdGl2ZSBoYW5kb2ZmcyBiZWZvcmUgYSBuZXcgbWFpbiBnZW5lcmF0aW9uXG4gICAqIHN0YXJ0cyBhY2NlcHRpbmcgd29ya2VyIHJlY29ubmVjdHMuIExlZ2FjeSByb3dzIHdpdGhvdXQgYSBjb21wbGV0ZSB3b3JrZXIsXG4gICAqIGxlYXNlLCBhbmQgdGltZXN0YW1wIGlkZW50aXR5IHN0YXkgb3duZWQgYnkgdGhlIGFnZS1iYXNlZCBvcnBoYW4gc3dlZXAuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPGltcG9ydChcIi4vdHlwZXMuanNcIikuQmFja2dyb3VuZEpvYkhhbmRvZmZTbmFwc2hvdFtdPn0gLSBFeGFjdCBzdGFydHVwIGhhbmRvZmZzLlxuICAgKi9cbiAgYXN5bmMgc25hcHNob3RIYW5kZWRPZmZKb2JzKCkge1xuICAgIGF3YWl0IHRoaXMuZW5zdXJlUmVhZHkoKVxuXG4gICAgY29uc3Qgcm93cyA9IGF3YWl0IHRoaXMuX3dpdGhEYihhc3luYyAoZGIpID0+IGF3YWl0IGRiXG4gICAgICAubmV3UXVlcnkoKVxuICAgICAgLmZyb20oSk9CU19UQUJMRSlcbiAgICAgIC53aGVyZSh7c3RhdHVzOiBcImhhbmRlZF9vZmZcIn0pXG4gICAgICAub3JkZXIoXCJjcmVhdGVkX2F0X21zIEFTQ1wiKVxuICAgICAgLm9yZGVyKFwiaWQgQVNDXCIpXG4gICAgICAucmVzdWx0cygpKVxuICAgIC8qKiBAdHlwZSB7aW1wb3J0KFwiLi90eXBlcy5qc1wiKS5CYWNrZ3JvdW5kSm9iSGFuZG9mZlNuYXBzaG90W119ICovXG4gICAgY29uc3QgaGFuZG9mZnMgPSBbXVxuXG4gICAgZm9yIChjb25zdCByb3cgb2Ygcm93cykge1xuICAgICAgY29uc3Qgam9iID0gdGhpcy5fbm9ybWFsaXplSm9iUm93KHJvdylcblxuICAgICAgaWYgKCFqb2IuaGFuZG9mZklkIHx8ICFqb2Iud29ya2VySWQgfHwgdHlwZW9mIGpvYi5oYW5kZWRPZmZBdE1zICE9PSBcIm51bWJlclwiKSBjb250aW51ZVxuXG4gICAgICBoYW5kb2Zmcy5wdXNoKHtcbiAgICAgICAgaGFuZGVkT2ZmQXRNczogam9iLmhhbmRlZE9mZkF0TXMsXG4gICAgICAgIGhhbmRvZmZJZDogam9iLmhhbmRvZmZJZCxcbiAgICAgICAgam9iSWQ6IGpvYi5pZCxcbiAgICAgICAgd29ya2VySWQ6IGpvYi53b3JrZXJJZFxuICAgICAgfSlcbiAgICB9XG5cbiAgICByZXR1cm4gaGFuZG9mZnNcbiAgfVxuXG4gIC8qKlxuICAgKiBSZWNsYWltcyBvbmx5IHVuY2hhbmdlZCBleGFjdCBoYW5kb2ZmcyBzZWxlY3RlZCBieSBhIG1haW4tZ2VuZXJhdGlvbiBzdGFydHVwXG4gICAqIHNuYXBzaG90LiBUaGUgb3JkaW5hcnkgb3JwaGFuIGZhaWx1cmUgcGF0aCBvd25zIHJldHJpZXMsIHRlcm1pbmFsIHN0YXR1cyxcbiAgICogY291bnQgdHJhbnNpdGlvbnMsIHNjaGVkdWxlIG93bmVyc2hpcCwgYW5kIGNvbmN1cnJlbmN5IHJlbGVhc2UuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gT3B0aW9ucy5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL3R5cGVzLmpzXCIpLkJhY2tncm91bmRKb2JIYW5kb2ZmU25hcHNob3RbXX0gYXJncy5oYW5kb2ZmcyAtIEV4YWN0IHN0YXJ0dXAgc25hcHNob3RzLlxuICAgKiBAcGFyYW0ge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSBhcmdzLmVycm9yIC0gT3JwaGFuIHJlYXNvbi5cbiAgICogQHJldHVybnMge1Byb21pc2U8aW1wb3J0KFwiLi90eXBlcy5qc1wiKS5CYWNrZ3JvdW5kSm9iUm93W10+fSAtIEFjY2VwdGVkIHRyYW5zaXRpb25zLlxuICAgKi9cbiAgYXN5bmMgbWFya09ycGhhbmVkSGFuZG9mZnMoe2hhbmRvZmZzLCBlcnJvcn0pIHtcbiAgICBhd2FpdCB0aGlzLmVuc3VyZVJlYWR5KClcblxuICAgIHJldHVybiBhd2FpdCB0aGlzLl9zZXJpYWxpemVkQ291bnRNdXRhdGlvbihhc3luYyAoZGIpID0+IHtcbiAgICAgIC8qKiBAdHlwZSB7QmFja2dyb3VuZEpvYk9ycGhhblNlbGVjdGlvbltdfSAqL1xuICAgICAgY29uc3Qgc2VsZWN0aW9ucyA9IFtdXG5cbiAgICAgIGZvciAoY29uc3QgaGFuZG9mZiBvZiBoYW5kb2Zmcykge1xuICAgICAgICBjb25zdCBqb2IgPSBhd2FpdCB0aGlzLl9nZXRKb2JSb3dCeUlkKGRiLCBoYW5kb2ZmLmpvYklkKVxuXG4gICAgICAgIGlmICgham9iIHx8IGpvYi5zdGF0dXMgIT09IFwiaGFuZGVkX29mZlwiKSBjb250aW51ZVxuICAgICAgICBpZiAoam9iLmhhbmRvZmZJZCAhPT0gaGFuZG9mZi5oYW5kb2ZmSWQpIGNvbnRpbnVlXG4gICAgICAgIGlmIChqb2Iud29ya2VySWQgIT09IGhhbmRvZmYud29ya2VySWQpIGNvbnRpbnVlXG4gICAgICAgIGlmIChqb2IuaGFuZGVkT2ZmQXRNcyAhPT0gaGFuZG9mZi5oYW5kZWRPZmZBdE1zKSBjb250aW51ZVxuXG4gICAgICAgIHNlbGVjdGlvbnMucHVzaCh7XG4gICAgICAgICAgY29uZGl0aW9uczoge1xuICAgICAgICAgICAgaGFuZGVkX29mZl9hdF9tczogaGFuZG9mZi5oYW5kZWRPZmZBdE1zLFxuICAgICAgICAgICAgaGFuZG9mZl9pZDogaGFuZG9mZi5oYW5kb2ZmSWQsXG4gICAgICAgICAgICBpZDogaGFuZG9mZi5qb2JJZCxcbiAgICAgICAgICAgIHN0YXR1czogXCJoYW5kZWRfb2ZmXCIsXG4gICAgICAgICAgICB3b3JrZXJfaWQ6IGhhbmRvZmYud29ya2VySWRcbiAgICAgICAgICB9LFxuICAgICAgICAgIGpvYlxuICAgICAgICB9KVxuICAgICAgfVxuXG4gICAgICByZXR1cm4gYXdhaXQgdGhpcy5fbWFya09ycGhhblNlbGVjdGlvbnMoe2RiLCBlcnJvciwgc2VsZWN0aW9uc30pXG4gICAgfSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIG1hcmsgZmFpbGVkLlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIE9wdGlvbnMuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBhcmdzLmpvYklkIC0gSm9iIGlkLlxuICAgKiBAcGFyYW0ge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSBhcmdzLmVycm9yIC0gRXJyb3IuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBbYXJncy5oYW5kb2ZmSWRdIC0gSGFuZG9mZiBsZWFzZSBpZC5cbiAgICogQHBhcmFtIHtzdHJpbmd9IFthcmdzLndvcmtlcklkXSAtIFdvcmtlciBpZC5cbiAgICogQHBhcmFtIHtudW1iZXJ9IFthcmdzLmhhbmRlZE9mZkF0TXNdIC0gSGFuZGVkIG9mZiB0aW1lc3RhbXAuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPGltcG9ydChcIi4vdHlwZXMuanNcIikuQmFja2dyb3VuZEpvYlJvdyB8IG51bGw+fSAtIFVwZGF0ZWQgam9iIHJvdyB3aGVuIHRoZSByZXBvcnQgd2FzIGFjY2VwdGVkLlxuICAgKi9cbiAgYXN5bmMgbWFya0ZhaWxlZCh7am9iSWQsIGVycm9yLCBoYW5kb2ZmSWQsIHdvcmtlcklkLCBoYW5kZWRPZmZBdE1zfSkge1xuICAgIGF3YWl0IHRoaXMuZW5zdXJlUmVhZHkoKVxuXG4gICAgcmV0dXJuIGF3YWl0IHRoaXMuX3NlcmlhbGl6ZWRDb3VudE11dGF0aW9uKGFzeW5jIChkYikgPT4ge1xuICAgICAgY29uc3Qgam9iID0gYXdhaXQgdGhpcy5fZ2V0Sm9iUm93QnlJZChkYiwgam9iSWQpXG5cbiAgICAgIGlmICgham9iKSByZXR1cm4gbnVsbFxuICAgICAgaWYgKCF0aGlzLl9zaG91bGRBY2NlcHRSZXBvcnQoe2pvYiwgaGFuZG9mZklkLCB3b3JrZXJJZCwgaGFuZGVkT2ZmQXRNc30pKSByZXR1cm4gbnVsbFxuXG4gICAgICBjb25zdCB1cGRhdGVkSm9iID0gYXdhaXQgdGhpcy5fYXBwbHlGYWlsdXJlKHtkYiwgam9iLCBlcnJvciwgbWFya09ycGhhbmVkOiBmYWxzZX0pXG5cbiAgICAgIGlmICh1cGRhdGVkSm9iKSBhd2FpdCB0aGlzLl9yZWNvcmRTdGF0dXNUcmFuc2l0aW9uKGRiLCBqb2Iuc3RhdHVzLCB1cGRhdGVkSm9iLnN0YXR1cylcbiAgICAgIHJldHVybiB1cGRhdGVkSm9iXG4gICAgfSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIG1hcmsgb3JwaGFuZWQgam9icy5cbiAgICogQHBhcmFtIHtvYmplY3R9IFthcmdzXSAtIE9wdGlvbnMuXG4gICAqIEBwYXJhbSB7bnVtYmVyfSBbYXJncy5vcnBoYW5lZEFmdGVyTXNdIC0gTWFyayBqb2JzIG9ycGhhbmVkIGFmdGVyIHRoaXMgZHVyYXRpb24uXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPGltcG9ydChcIi4vdHlwZXMuanNcIikuQmFja2dyb3VuZEpvYlJvd1tdPn0gLSBUaGUgam9icyB0aGlzIHN3ZWVwIG1hcmtlZCBvcnBoYW5lZC5cbiAgICovXG4gIGFzeW5jIG1hcmtPcnBoYW5lZEpvYnMoe29ycGhhbmVkQWZ0ZXJNcyA9IE9SUEhBTkVEX0FGVEVSX01TfSA9IHt9KSB7XG4gICAgYXdhaXQgdGhpcy5lbnN1cmVSZWFkeSgpXG5cbiAgICByZXR1cm4gYXdhaXQgdGhpcy5fc2VyaWFsaXplZENvdW50TXV0YXRpb24oYXN5bmMgKGRiKSA9PiB7XG4gICAgICBjb25zdCBjdXRvZmYgPSB0aGlzLmNsb2NrLm5vdygpIC0gb3JwaGFuZWRBZnRlck1zXG4gICAgICBjb25zdCBxdWVyeSA9IGRiXG4gICAgICAgIC5uZXdRdWVyeSgpXG4gICAgICAgIC5mcm9tKEpPQlNfVEFCTEUpXG4gICAgICAgIC53aGVyZSh7c3RhdHVzOiBcImhhbmRlZF9vZmZcIn0pXG4gICAgICAgIC53aGVyZShgaGFuZGVkX29mZl9hdF9tcyA8PSAke2RiLnF1b3RlKGN1dG9mZil9YClcblxuICAgICAgY29uc3Qgcm93cyA9IGF3YWl0IHF1ZXJ5LnJlc3VsdHMoKVxuXG4gICAgICAvKiogQHR5cGUge0JhY2tncm91bmRKb2JPcnBoYW5TZWxlY3Rpb25bXX0gKi9cbiAgICAgIGNvbnN0IHNlbGVjdGlvbnMgPSBbXVxuXG4gICAgICBmb3IgKGNvbnN0IHJvdyBvZiByb3dzKSB7XG4gICAgICAgIGNvbnN0IGpvYiA9IHRoaXMuX25vcm1hbGl6ZUpvYlJvdyhyb3cpXG5cbiAgICAgICAgLy8gRmVuY2UgdGhlIHJlY2xhaW0gb24gdGhlIGV4YWN0IGhhbmRvZmYgdGhpcyBzd2VlcCBzZWxlY3RlZCwgdXNpbmcgaXRzXG4gICAgICAgIC8vIGBoYW5kZWRfb2ZmX2F0X21zYCByYXRoZXIgdGhhbiBpdHMgYGhhbmRvZmZfaWRgLiBUd28gcmVhc29uczpcbiAgICAgICAgLy8gICAxLiBOdWxsLXNhZmUuIFNvbWUgcm93cyBoYXZlIGEgbnVsbCBgaGFuZG9mZl9pZGAgKGhhbmRlZCBvZmYgYnkgYW5cbiAgICAgICAgLy8gICAgICBvbGRlciB2ZWxvY2lvdXMgYmVmb3JlIGhhbmRvZmYtaWQgZmVuY2luZykuIGB7aGFuZG9mZl9pZDogbnVsbH1gXG4gICAgICAgIC8vICAgICAgcmVuZGVycyBhcyBgaGFuZG9mZl9pZCA9IE5VTExgLCB3aGljaCBtYXRjaGVzIG5vdGhpbmcsIHNvIHRob3NlXG4gICAgICAgIC8vICAgICAgcm93cyB3b3VsZCBiZSBzdHJhbmRlZCBpbiBgaGFuZGVkX29mZmAgZm9yZXZlci5cbiAgICAgICAgLy8gICAyLiBSYWNlLXNhZmUuIElmIHRoZSByb3cgaXMgcmV0dXJuZWQgdG8gdGhlIHF1ZXVlIGFuZCByZS1oYW5kZWQtb2ZmXG4gICAgICAgIC8vICAgICAgYmV0d2VlbiB0aGUgU0VMRUNUIGFib3ZlIGFuZCB0aGlzIHVwZGF0ZSwgaXQgZ2V0cyBhIGZyZXNoXG4gICAgICAgIC8vICAgICAgYGhhbmRlZF9vZmZfYXRfbXNgIChhbHdheXMgXCJub3dcIiksIHNvIHRoaXMgc3RhbGUgY3V0b2ZmLWVyYVxuICAgICAgICAvLyAgICAgIHRpbWVzdGFtcCBubyBsb25nZXIgbWF0Y2hlcyBhbmQgd2Ugd29uJ3QgZmFpbC9vcnBoYW4g4oCUIG9yXG4gICAgICAgIC8vICAgICAgd3JvbmdseSByZWxlYXNlIHRoZSBjb25jdXJyZW5jeSByZXNlcnZhdGlvbiBvZiDigJQgdGhhdCBuZXcgbGVhc2UuXG4gICAgICAgIC8vIGBoYW5kZWRfb2ZmX2F0X21zYCBpcyBhbHdheXMgc2V0IG9uIGEgaGFuZGVkLW9mZiByb3cgKGFuZCB0aGUgU0VMRUNUXG4gICAgICAgIC8vIHJlcXVpcmVkIGl0IGA8PSBjdXRvZmZgKSwgc28gaXQgaXMgYSByZWxpYWJsZSBudWxsLXNhZmUgbGVhc2UgcGluLlxuICAgICAgICBzZWxlY3Rpb25zLnB1c2goe1xuICAgICAgICAgIGNvbmRpdGlvbnM6IHtpZDogam9iLmlkLCBzdGF0dXM6IFwiaGFuZGVkX29mZlwiLCBoYW5kZWRfb2ZmX2F0X21zOiBqb2IuaGFuZGVkT2ZmQXRNc30sXG4gICAgICAgICAgam9iXG4gICAgICAgIH0pXG4gICAgICB9XG5cbiAgICAgIHJldHVybiBhd2FpdCB0aGlzLl9tYXJrT3JwaGFuU2VsZWN0aW9ucyh7XG4gICAgICAgIGRiLFxuICAgICAgICBlcnJvcjogXCJKb2Igb3JwaGFuZWQgYWZ0ZXIgdGltZW91dFwiLFxuICAgICAgICBzZWxlY3Rpb25zXG4gICAgICB9KVxuICAgIH0pXG4gIH1cblxuICAvKipcbiAgICogQXBwbGllcyB0aGUgY29tbW9uIGZlbmNlZCBvcnBoYW4gdHJhbnNpdGlvbiBhbmQgcmVjb3JkcyBvbmUgYWdncmVnYXRlIGNvdW50XG4gICAqIGRlbHRhIGZvciB0aGUgYWNjZXB0ZWQgcm93cy5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBPcHRpb25zLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL2RhdGFiYXNlL2RyaXZlcnMvYmFzZS5qc1wiKS5kZWZhdWx0fSBhcmdzLmRiIC0gVHJhbnNhY3Rpb24gY29ubmVjdGlvbi5cbiAgICogQHBhcmFtIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gYXJncy5lcnJvciAtIE9ycGhhbiByZWFzb24uXG4gICAqIEBwYXJhbSB7QmFja2dyb3VuZEpvYk9ycGhhblNlbGVjdGlvbltdfSBhcmdzLnNlbGVjdGlvbnMgLSBTZWxlY3RlZCBoYW5kb2ZmcyBhbmQgZXhhY3QgZmVuY2VzLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxpbXBvcnQoXCIuL3R5cGVzLmpzXCIpLkJhY2tncm91bmRKb2JSb3dbXT59IC0gQWNjZXB0ZWQgdHJhbnNpdGlvbnMuXG4gICAqL1xuICBhc3luYyBfbWFya09ycGhhblNlbGVjdGlvbnMoe2RiLCBlcnJvciwgc2VsZWN0aW9uc30pIHtcbiAgICAvKiogQHR5cGUge2ltcG9ydChcIi4vdHlwZXMuanNcIikuQmFja2dyb3VuZEpvYlJvd1tdfSAqL1xuICAgIGNvbnN0IG9ycGhhbmVkSm9icyA9IFtdXG5cbiAgICBmb3IgKGNvbnN0IHtjb25kaXRpb25zLCBqb2J9IG9mIHNlbGVjdGlvbnMpIHtcbiAgICAgIGNvbnN0IG9ycGhhbmVkSm9iID0gYXdhaXQgdGhpcy5fYXBwbHlGYWlsdXJlKHtcbiAgICAgICAgY29uZGl0aW9ucyxcbiAgICAgICAgZGIsXG4gICAgICAgIGVycm9yLFxuICAgICAgICBqb2IsXG4gICAgICAgIG1hcmtPcnBoYW5lZDogdHJ1ZVxuICAgICAgfSlcblxuICAgICAgaWYgKG9ycGhhbmVkSm9iKSBvcnBoYW5lZEpvYnMucHVzaChvcnBoYW5lZEpvYilcbiAgICB9XG5cbiAgICBjb25zdCBzdGF0dXNDb3VudHMgPSB0aGlzLl9zdGF0dXNDb3VudHMob3JwaGFuZWRKb2JzKVxuICAgIGNvbnN0IGRlbHRhcyA9IHRoaXMuX2VtcHR5Q291bnRCdWNrZXRzKClcblxuICAgIGZvciAoY29uc3QgW3N0YXR1cywgY291bnRdIG9mIE9iamVjdC5lbnRyaWVzKHN0YXR1c0NvdW50cykpIHtcbiAgICAgIGRlbHRhcy5oYW5kZWRfb2ZmIC09IGNvdW50XG4gICAgICBkZWx0YXNbc3RhdHVzXSArPSBjb3VudFxuICAgIH1cbiAgICBhd2FpdCB0aGlzLl9yZWNvcmRDb3VudERlbHRhKGRiLCBkZWx0YXMpXG5cbiAgICByZXR1cm4gb3JwaGFuZWRKb2JzXG4gIH1cblxuICAvKipcbiAgICogRGVsZXRlcyB0ZXJtaW5hbCBqb2Igcm93cyBwYXN0IHRoZWlyIHJldGVudGlvbiB3aW5kb3cgc28gdGhlIGpvYnMgdGFibGVcbiAgICogZG9lcyBub3QgZ3JvdyB1bmJvdW5kZWQgKGNvbXBsZXRlZCByb3dzIGluIHBhcnRpY3VsYXIgYWNjdW11bGF0ZSBmb3JldmVyXG4gICAqIG90aGVyd2lzZSkuIEJhdGNoZWQgYnkgaWQg4oCUIFNFTEVDVCBhIHBhZ2Ugb2YgaWRzLCB0aGVuXG4gICAqIGBERUxFVEUgLi4uIFdIRVJFIGlkIElOICguLi4pYCDigJQgcmF0aGVyIHRoYW4gYERFTEVURSAuLi4gTElNSVRgLCB3aGljaCBub3RcbiAgICogZXZlcnkgZHJpdmVyIHN1cHBvcnRzOyBlYWNoIGJhdGNoIHJ1bnMgb24gaXRzIG93biBjb25uZWN0aW9uIHNvIHRoZSBzd2VlcFxuICAgKiB5aWVsZHMgYmV0d2VlbiBiYXRjaGVzIGluc3RlYWQgb2YgaG9sZGluZyBvbmUgbG9uZyB0cmFuc2FjdGlvbi5cbiAgICogQHBhcmFtIHtvYmplY3R9IFthcmdzXSAtIE9wdGlvbnMuXG4gICAqIEBwYXJhbSB7bnVtYmVyIHwgbnVsbH0gW2FyZ3MuY29tcGxldGVkVHRsTXNdIC0gRGVsZXRlIGBjb21wbGV0ZWRgIGpvYnMgd2hvc2UgYGNvbXBsZXRlZF9hdF9tc2AgaXMgb2xkZXIgdGhhbiB0aGlzIG1hbnkgbXMuIEZhbHN5IG9yIGA8PSAwYCBkaXNhYmxlcyBjb21wbGV0ZWQgcHJ1bmluZy5cbiAgICogQHBhcmFtIHtudW1iZXIgfCBudWxsfSBbYXJncy5mYWlsZWRUdGxNc10gLSBEZWxldGUgdGVybWluYWwgYGZhaWxlZGAvYG9ycGhhbmVkYCBqb2JzIG9sZGVyIHRoYW4gdGhpcyBtYW55IG1zIChieSBgZmFpbGVkX2F0X21zYC9gb3JwaGFuZWRfYXRfbXNgKS4gRmFsc3kgb3IgYDw9IDBgIGRpc2FibGVzLlxuICAgKiBAcGFyYW0ge251bWJlcn0gW2FyZ3MuYmF0Y2hTaXplXSAtIE1heCByb3dzIGRlbGV0ZWQgcGVyIGJhdGNoLiBEZWZhdWx0IGAxMDAwYC5cbiAgICogQHJldHVybnMge1Byb21pc2U8bnVtYmVyPn0gLSBUb3RhbCByb3dzIGRlbGV0ZWQuXG4gICAqL1xuICBhc3luYyBwcnVuZVRlcm1pbmFsSm9icyh7Y29tcGxldGVkVHRsTXMgPSBudWxsLCBmYWlsZWRUdGxNcyA9IG51bGwsIGJhdGNoU2l6ZSA9IDEwMDB9ID0ge30pIHtcbiAgICBhd2FpdCB0aGlzLmVuc3VyZVJlYWR5KClcblxuICAgIGNvbnN0IG5vdyA9IHRoaXMuY2xvY2subm93KClcbiAgICBjb25zdCBzaXplID0gYmF0Y2hTaXplID4gMCA/IGJhdGNoU2l6ZSA6IDEwMDBcbiAgICBsZXQgZGVsZXRlZCA9IDBcblxuICAgIGlmIChjb21wbGV0ZWRUdGxNcyAmJiBjb21wbGV0ZWRUdGxNcyA+IDApIHtcbiAgICAgIGRlbGV0ZWQgKz0gYXdhaXQgdGhpcy5fcHJ1bmVTdGF0dXNCYXRjaGVzKHtzdGF0dXM6IFwiY29tcGxldGVkXCIsIGNvbHVtbjogXCJjb21wbGV0ZWRfYXRfbXNcIiwgY3V0b2ZmOiBub3cgLSBjb21wbGV0ZWRUdGxNcywgYmF0Y2hTaXplOiBzaXplfSlcbiAgICB9XG5cbiAgICBpZiAoZmFpbGVkVHRsTXMgJiYgZmFpbGVkVHRsTXMgPiAwKSB7XG4gICAgICBkZWxldGVkICs9IGF3YWl0IHRoaXMuX3BydW5lU3RhdHVzQmF0Y2hlcyh7c3RhdHVzOiBcImZhaWxlZFwiLCBjb2x1bW46IFwiZmFpbGVkX2F0X21zXCIsIGN1dG9mZjogbm93IC0gZmFpbGVkVHRsTXMsIGJhdGNoU2l6ZTogc2l6ZX0pXG4gICAgICBkZWxldGVkICs9IGF3YWl0IHRoaXMuX3BydW5lU3RhdHVzQmF0Y2hlcyh7c3RhdHVzOiBcIm9ycGhhbmVkXCIsIGNvbHVtbjogXCJvcnBoYW5lZF9hdF9tc1wiLCBjdXRvZmY6IG5vdyAtIGZhaWxlZFR0bE1zLCBiYXRjaFNpemU6IHNpemV9KVxuICAgIH1cblxuICAgIHJldHVybiBkZWxldGVkXG4gIH1cblxuICAvKipcbiAgICogRGVsZXRlcyByb3dzIG9mIG9uZSB0ZXJtaW5hbCBzdGF0dXMgb2xkZXIgdGhhbiBhIGN1dG9mZiwgYmF0Y2ggYnkgYmF0Y2gsXG4gICAqIHVudGlsIGEgY2FuZGlkYXRlIHBhZ2UgcmV0dXJucyBmZXdlciB0aGFuIGBiYXRjaFNpemVgIHJvd3MuIENhbmRpZGF0ZVxuICAgKiBkaXNjb3ZlcnkgcnVucyBvbiBhIHBsYWluIGNvbm5lY3Rpb24g4oCUIG5ldmVyIGluc2lkZSB0aGUgc2VyaWFsaXplZCBjb3VudFxuICAgKiBtdXRhdGlvbiDigJQgc28gYSBsb25nIHNjYW4gY2Fubm90IGhvbGQgdGhlIGNvdW50LXJldmlzaW9uIGxvY2sgYW5kIHN0YXJ2ZVxuICAgKiBlbnF1ZXVlIGFja25vd2xlZGdlbWVudHM7IG9ubHkgdGhlIHNob3J0IGRlbGV0ZSB0cmFuc2FjdGlvbiBpcyBzZXJpYWxpemVkLlxuICAgKiBUaGUgZGVsZXRlIHJldmFsaWRhdGVzIHN0YXR1cyBhbmQgY3V0b2ZmIGZvciB0aGUgc2VsZWN0ZWQgaWRzLCBwdWJsaXNoZXNcbiAgICogdGhlIGRlbHRhIGZyb20gdGhlIGFjdHVhbCBhZmZlY3RlZC1yb3cgY291bnQsIGFuZCBhIHBhZ2Ugd2hvc2UgY2FuZGlkYXRlc1xuICAgKiB3ZXJlIGFscmVhZHkgcmVtb3ZlZCBieSBhIGNvbmN1cnJlbnQgcHJ1bmVyIHN0aWxsIGVuZHMgdGhlIHBhc3Mgb25seSB3aGVuXG4gICAqIHRoZSBwYWdlIGl0c2VsZiBpcyBzaG9ydC5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBPcHRpb25zLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gYXJncy5zdGF0dXMgLSBUZXJtaW5hbCBzdGF0dXMgdG8gcHJ1bmUuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBhcmdzLmNvbHVtbiAtIFRpbWVzdGFtcCBjb2x1bW4gY29tcGFyZWQgYWdhaW5zdCB0aGUgY3V0b2ZmLlxuICAgKiBAcGFyYW0ge251bWJlcn0gYXJncy5jdXRvZmYgLSBEZWxldGUgcm93cyB3aG9zZSBjb2x1bW4gdmFsdWUgaXMgYDw9IGN1dG9mZmAuXG4gICAqIEBwYXJhbSB7bnVtYmVyfSBhcmdzLmJhdGNoU2l6ZSAtIE1heCByb3dzIHBlciBiYXRjaC5cbiAgICogQHJldHVybnMge1Byb21pc2U8bnVtYmVyPn0gLSBSb3dzIGRlbGV0ZWQgZm9yIHRoaXMgc3RhdHVzLlxuICAgKi9cbiAgYXN5bmMgX3BydW5lU3RhdHVzQmF0Y2hlcyh7c3RhdHVzLCBjb2x1bW4sIGN1dG9mZiwgYmF0Y2hTaXplfSkge1xuICAgIGxldCBkZWxldGVkID0gMFxuXG4gICAgZm9yICg7Oykge1xuICAgICAgY29uc3QgY2FuZGlkYXRlcyA9IGF3YWl0IHRoaXMuX3dpdGhEYihhc3luYyAoZGIpID0+XG4gICAgICAgIGF3YWl0IGRiXG4gICAgICAgICAgLm5ld1F1ZXJ5KClcbiAgICAgICAgICAuZnJvbShKT0JTX1RBQkxFKVxuICAgICAgICAgIC5zZWxlY3QoXCJpZFwiKVxuICAgICAgICAgIC53aGVyZSh7c3RhdHVzfSlcbiAgICAgICAgICAud2hlcmUoYCR7ZGIucXVvdGVDb2x1bW4oY29sdW1uKX0gPD0gJHtkYi5xdW90ZShjdXRvZmYpfWApXG4gICAgICAgICAgLm9yZGVyKHtjb2x1bW4sIGRpcmVjdGlvbjogXCJBU0NcIn0pXG4gICAgICAgICAgLm9yZGVyKHtjb2x1bW46IFwiaWRcIiwgZGlyZWN0aW9uOiBcIkFTQ1wifSlcbiAgICAgICAgICAubGltaXQoYmF0Y2hTaXplKVxuICAgICAgICAgIC5yZXN1bHRzKClcbiAgICAgIClcblxuICAgICAgaWYgKGNhbmRpZGF0ZXMubGVuZ3RoID09PSAwKSBicmVha1xuXG4gICAgICBjb25zdCBjYW5kaWRhdGVJZHMgPSBPYmplY3QuZnJlZXplKGNhbmRpZGF0ZXMubWFwKCgvKiogQHR5cGUge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gKi8gcm93KSA9PiBTdHJpbmcocm93LmlkKSkpXG5cbiAgICAgIGlmICh0aGlzLmFmdGVyUHJ1bmVDYW5kaWRhdGVzU2VsZWN0ZWQpIHtcbiAgICAgICAgYXdhaXQgdGhpcy5hZnRlclBydW5lQ2FuZGlkYXRlc1NlbGVjdGVkKE9iamVjdC5mcmVlemUoe1xuICAgICAgICAgIGNhbmRpZGF0ZXM6IGNhbmRpZGF0ZUlkcyxcbiAgICAgICAgICBjb2x1bW4sXG4gICAgICAgICAgY3V0b2ZmLFxuICAgICAgICAgIHN0YXR1c1xuICAgICAgICB9KSlcbiAgICAgIH1cblxuICAgICAgY29uc3QgcmVtb3ZlZCA9IGF3YWl0IHRoaXMuX3NlcmlhbGl6ZWRDb3VudE11dGF0aW9uKGFzeW5jIChkYikgPT4ge1xuICAgICAgICBjb25zdCBpZHMgPSBjYW5kaWRhdGVJZHMubWFwKChpZCkgPT4gZGIucXVvdGUoaWQpKS5qb2luKFwiLCBcIilcblxuICAgICAgICBjb25zdCByZW1vdmVkID0gYXdhaXQgZGIuYWZmZWN0ZWRSb3dzKFxuICAgICAgICAgIGBERUxFVEUgRlJPTSAke2RiLnF1b3RlVGFibGUoSk9CU19UQUJMRSl9IFdIRVJFICR7ZGIucXVvdGVDb2x1bW4oXCJpZFwiKX0gSU4gKCR7aWRzfSkgQU5EICR7ZGIucXVvdGVDb2x1bW4oXCJzdGF0dXNcIil9ID0gJHtkYi5xdW90ZShzdGF0dXMpfSBBTkQgJHtkYi5xdW90ZUNvbHVtbihjb2x1bW4pfSA8PSAke2RiLnF1b3RlKGN1dG9mZil9YFxuICAgICAgICApXG5cbiAgICAgICAgYXdhaXQgdGhpcy5fcmVjb3JkQ291bnREZWx0YShkYiwge2FsbDogLXJlbW92ZWQsIFtzdGF0dXNdOiAtcmVtb3ZlZH0pXG5cbiAgICAgICAgcmV0dXJuIHJlbW92ZWRcbiAgICAgIH0pXG5cbiAgICAgIGRlbGV0ZWQgKz0gcmVtb3ZlZFxuICAgICAgaWYgKGNhbmRpZGF0ZXMubGVuZ3RoIDwgYmF0Y2hTaXplKSBicmVha1xuICAgIH1cblxuICAgIHJldHVybiBkZWxldGVkXG4gIH1cblxuICAvKipcbiAgICogUnVucyBjbGVhciBhbGwuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIHdoZW4gY2xlYXJlZC5cbiAgICovXG4gIGFzeW5jIGNsZWFyQWxsKCkge1xuICAgIGF3YWl0IHRoaXMuZW5zdXJlUmVhZHkoKVxuXG4gICAgYXdhaXQgdGhpcy5fc2VyaWFsaXplZENvdW50TXV0YXRpb24oYXN5bmMgKGRiKSA9PiB7XG4gICAgICBjb25zdCBzbmFwc2hvdCA9IGF3YWl0IHRoaXMuX2NvdW50U25hcHNob3RPbkxvY2tlZENvbm5lY3Rpb24oZGIpXG4gICAgICBpZiAoYXdhaXQgZGIudGFibGVFeGlzdHMoTUFJTF9ERUxJVkVSWV9PUEVSQVRJT05TX1RBQkxFKSkgYXdhaXQgZGIucXVlcnkoYERFTEVURSBGUk9NICR7ZGIucXVvdGVUYWJsZShNQUlMX0RFTElWRVJZX09QRVJBVElPTlNfVEFCTEUpfWApXG4gICAgICBpZiAoYXdhaXQgZGIudGFibGVFeGlzdHMoSURFTVBPVEVOQ1lfS0VZU19UQUJMRSkpIGF3YWl0IGRiLnF1ZXJ5KGBERUxFVEUgRlJPTSAke2RiLnF1b3RlVGFibGUoSURFTVBPVEVOQ1lfS0VZU19UQUJMRSl9YClcbiAgICAgIGlmIChhd2FpdCBkYi50YWJsZUV4aXN0cyhTQ0hFRFVMRV9LRVlTX1RBQkxFKSkgYXdhaXQgZGIucXVlcnkoYERFTEVURSBGUk9NICR7ZGIucXVvdGVUYWJsZShTQ0hFRFVMRV9LRVlTX1RBQkxFKX1gKVxuICAgICAgaWYgKGF3YWl0IGRiLnRhYmxlRXhpc3RzKFNDSEVEVUxFX09SREVSX1dBVEVSTUFSS1NfVEFCTEUpKSB7XG4gICAgICAgIGNvbnN0IHdhdGVybWFya1Jvd3MgPSBhd2FpdCBkYlxuICAgICAgICAgIC5uZXdRdWVyeSgpXG4gICAgICAgICAgLmZyb20oU0NIRURVTEVfT1JERVJfV0FURVJNQVJLU19UQUJMRSlcbiAgICAgICAgICAuc2VsZWN0KFwic2NoZWR1bGVfa2V5XCIpXG4gICAgICAgICAgLnJlc3VsdHMoKVxuXG4gICAgICAgIGZvciAoY29uc3Qgd2F0ZXJtYXJrUm93IG9mIHdhdGVybWFya1Jvd3MpIHtcbiAgICAgICAgICBhd2FpdCBkYi5kZWxldGUoe1xuICAgICAgICAgICAgdGFibGVOYW1lOiBTQ0hFRFVMRV9PUkRFUl9XQVRFUk1BUktTX1RBQkxFLFxuICAgICAgICAgICAgY29uZGl0aW9uczoge1xuICAgICAgICAgICAgICBzY2hlZHVsZV9rZXk6IFN0cmluZygvKiogQHR5cGUge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gKi8gKHdhdGVybWFya1Jvdykuc2NoZWR1bGVfa2V5KVxuICAgICAgICAgICAgfVxuICAgICAgICAgIH0pXG4gICAgICAgIH1cbiAgICAgIH1cbiAgICAgIGF3YWl0IGRiLnF1ZXJ5KGBERUxFVEUgRlJPTSAke2RiLnF1b3RlVGFibGUoSk9CU19UQUJMRSl9YClcbiAgICAgIGlmIChhd2FpdCBkYi50YWJsZUV4aXN0cyhDT05DVVJSRU5DWV9UQUJMRSkpIGF3YWl0IGRiLnF1ZXJ5KGBERUxFVEUgRlJPTSAke2RiLnF1b3RlVGFibGUoQ09OQ1VSUkVOQ1lfVEFCTEUpfWApXG4gICAgICBjb25zdCBkZWx0YXMgPSBPYmplY3QuZnJvbUVudHJpZXMoT2JqZWN0LmVudHJpZXMoc25hcHNob3QuY291bnRzKS5tYXAoKFtrZXksIHZhbHVlXSkgPT4gW2tleSwgLXZhbHVlXSkpXG4gICAgICBhd2FpdCB0aGlzLl9yZWNvcmRDb3VudERlbHRhKGRiLCBkZWx0YXMpXG4gICAgfSlcbiAgfVxuXG4gIC8qKlxuICAgKiBDYW5jZWxzIGEgcXVldWVkIG9yIGhhbmRlZC1vZmYgam9iIGFuZCByZWxlYXNlcyBhbnkgZHVyYWJsZSBjb25jdXJyZW5jeSByZXNlcnZhdGlvbi5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGpvYklkIC0gSm9iIGlkLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxib29sZWFuPn0gLSBXaGV0aGVyIHRoZSBqb2Igd2FzIGNhbmNlbGxlZC5cbiAgICovXG4gIGFzeW5jIGNhbmNlbChqb2JJZCkge1xuICAgIGF3YWl0IHRoaXMuZW5zdXJlUmVhZHkoKVxuICAgIHJldHVybiBhd2FpdCB0aGlzLl9zZXJpYWxpemVkQ291bnRNdXRhdGlvbihhc3luYyAoZGIpID0+IHtcbiAgICAgIGNvbnN0IGpvYiA9IGF3YWl0IHRoaXMuX2dldEpvYlJvd0J5SWQoZGIsIGpvYklkKVxuICAgICAgaWYgKCFqb2IgfHwgKGpvYi5zdGF0dXMgIT09IFwicXVldWVkXCIgJiYgam9iLnN0YXR1cyAhPT0gXCJoYW5kZWRfb2ZmXCIpKSByZXR1cm4gZmFsc2VcbiAgICAgIC8vIE9ubHkgYSBoYW5kZWRfb2ZmIGpvYiBob2xkcyBhIGNvbmN1cnJlbmN5IHJlc2VydmF0aW9uLCBzbyBvbmx5IHRoYXQgY2FzZSB0b3VjaGVzIHRoZVxuICAgICAgLy8gc2hhcmVkIGNvdW50ZXIgcm93IGFuZCBuZWVkcyB0aGUgY29uY3VycmVuY3ktdGhlbi1qb2IgbG9jayBvcmRlcmluZy5cbiAgICAgIGlmIChqb2Iuc3RhdHVzID09PSBcImhhbmRlZF9vZmZcIikgYXdhaXQgdGhpcy5fbG9ja0NvbmN1cnJlbmN5Um93KGRiLCBqb2IuY29uY3VycmVuY3lLZXkpXG4gICAgICBjb25zdCBhZmZlY3RlZFJvd3MgPSBhd2FpdCB0aGlzLl91cGRhdGVBZmZlY3RlZFJvd3MoZGIsIHt0YWJsZU5hbWU6IEpPQlNfVEFCTEUsIGRhdGE6IHtzdGF0dXM6IFwiY2FuY2VsbGVkXCJ9LCBjb25kaXRpb25zOiB7aWQ6IGpvYi5pZCwgc3RhdHVzOiBqb2Iuc3RhdHVzfX0pXG4gICAgICBpZiAoYWZmZWN0ZWRSb3dzICE9PSAxKSByZXR1cm4gZmFsc2VcbiAgICAgIGF3YWl0IHRoaXMuX3JlbGVhc2VTY2hlZHVsZU93bmVyc2hpcEZvckpvYihkYiwgam9iKVxuICAgICAgaWYgKGpvYi5zdGF0dXMgPT09IFwiaGFuZGVkX29mZlwiKSBhd2FpdCB0aGlzLl9yZWxlYXNlQ29uY3VycmVuY3koZGIsIGpvYi5jb25jdXJyZW5jeUtleSlcbiAgICAgIGF3YWl0IHRoaXMuX3JlY29yZFN0YXR1c1RyYW5zaXRpb24oZGIsIGpvYi5zdGF0dXMsIFwiY2FuY2VsbGVkXCIpXG4gICAgICByZXR1cm4gdHJ1ZVxuICAgIH0pXG4gIH1cblxuICAvKipcbiAgICogUnVucyBnZXQgcmV0cnkgZGVsYXkgbXMuXG4gICAqIEBwYXJhbSB7bnVtYmVyfSByZXRyeUNvdW50IC0gUmV0cnkgYXR0ZW1wdCBjb3VudCAoMS1iYXNlZCkuXG4gICAqIEByZXR1cm5zIHtudW1iZXJ9IC0gRGVsYXkgaW4gbWlsbGlzZWNvbmRzLlxuICAgKi9cbiAgZ2V0UmV0cnlEZWxheU1zKHJldHJ5Q291bnQpIHtcbiAgICByZXR1cm4gcmV0cnlEZWxheU1zKHJldHJ5Q291bnQpXG4gIH1cblxuICAvKipcbiAgICogTm9ybWFsaXplcyBvbmUgbmV3IGpvYiBiZWZvcmUgZW50ZXJpbmcgaXRzIHBlcnNpc3RlbmNlIHRyYW5zYWN0aW9uLlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIEpvYiBpbnB1dC5cbiAgICogQHBhcmFtIHtBcnJheTxSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59IGFyZ3MuYXJncyAtIEpvYiBhcmd1bWVudHMuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBhcmdzLmpvYk5hbWUgLSBKb2IgbmFtZS5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL3R5cGVzLmpzXCIpLkJhY2tncm91bmRKb2JPcHRpb25zfSBbYXJncy5vcHRpb25zXSAtIEpvYiBvcHRpb25zLlxuICAgKiBAcmV0dXJucyB7UHJlcGFyZWRCYWNrZ3JvdW5kSm9ifSAtIFByZXBhcmVkIGpvYi5cbiAgICovXG4gIF9wcmVwYXJlSm9iKHthcmdzLCBqb2JOYW1lLCBvcHRpb25zfSkge1xuICAgIGNvbnN0IGNyZWF0ZWRBdE1zID0gdGhpcy5jbG9jay5ub3coKVxuICAgIGNvbnN0IHF1ZXVlID0gdGhpcy5fbm9ybWFsaXplUXVldWUob3B0aW9ucylcblxuICAgIHJldHVybiB7XG4gICAgICBhcmdzSnNvbjogSlNPTi5zdHJpbmdpZnkoYXJncyB8fCBbXSksXG4gICAgICBjb25jdXJyZW5jeTogdGhpcy5fcmVzb2x2ZUNvbmN1cnJlbmN5KG9wdGlvbnMsIHF1ZXVlKSxcbiAgICAgIGNyZWF0ZWRBdE1zLFxuICAgICAgZXhlY3V0aW9uTW9kZTogdGhpcy5fbm9ybWFsaXplRXhlY3V0aW9uTW9kZShvcHRpb25zKSxcbiAgICAgIGpvYklkOiByYW5kb21VVUlEKCksXG4gICAgICBqb2JOYW1lLFxuICAgICAgbWF4UmV0cmllczogdGhpcy5fbm9ybWFsaXplTWF4UmV0cmllcyhvcHRpb25zPy5tYXhSZXRyaWVzKSxcbiAgICAgIHF1ZXVlLFxuICAgICAgc2NoZWR1bGVkQXRNczogdGhpcy5fbm9ybWFsaXplU2NoZWR1bGVkQXRNcyhvcHRpb25zPy5zY2hlZHVsZWRBdE1zLCBjcmVhdGVkQXRNcyksXG4gICAgICB0aW1lb3V0TXM6IHRoaXMuX25vcm1hbGl6ZUpvYlRpbWVvdXRNcyhvcHRpb25zKVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBOb3JtYWxpemVzIGEgcGVyLWpvYiB0aW1lb3V0IHdoaWxlIHByZXNlcnZpbmcgb21pdHRlZCAod29ya2VyIGZhbGxiYWNrKVxuICAgKiBzZXBhcmF0ZWx5IGZyb20gZXhwbGljaXRseSBkaXNhYmxlZC5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL3R5cGVzLmpzXCIpLkJhY2tncm91bmRKb2JPcHRpb25zIHwgdW5kZWZpbmVkfSBvcHRpb25zIC0gSm9iIG9wdGlvbnMuXG4gICAqIEByZXR1cm5zIHtudW1iZXIgfCBudWxsfSAtIFBvc2l0aXZlIHRpbWVvdXQsIHplcm8gZm9yIGRpc2FibGVkLCBvciBudWxsIHdoZW4gb21pdHRlZC5cbiAgICovXG4gIF9ub3JtYWxpemVKb2JUaW1lb3V0TXMob3B0aW9ucykge1xuICAgIGlmIChvcHRpb25zPy50aW1lb3V0TXMgPT09IHVuZGVmaW5lZCkgcmV0dXJuIG51bGxcblxuICAgIGNvbnN0IHRpbWVvdXRNcyA9IG9wdGlvbnMudGltZW91dE1zXG5cbiAgICBpZiAodHlwZW9mIHRpbWVvdXRNcyAhPT0gXCJudW1iZXJcIiB8fCAhTnVtYmVyLmlzRmluaXRlKHRpbWVvdXRNcykpIHtcbiAgICAgIHRocm93IFZlbG9jaW91c0Vycm9yLnNhZmUoSk9CX1RJTUVPVVRfVkFMSURBVElPTl9NRVNTQUdFKVxuICAgIH1cblxuICAgIGlmICh0aW1lb3V0TXMgPD0gMCkgcmV0dXJuIDBcblxuICAgIGlmICghTnVtYmVyLmlzSW50ZWdlcih0aW1lb3V0TXMpIHx8IHRpbWVvdXRNcyA+IE1BWF9KT0JfVElNRU9VVF9NUykge1xuICAgICAgdGhyb3cgVmVsb2Npb3VzRXJyb3Iuc2FmZShKT0JfVElNRU9VVF9WQUxJREFUSU9OX01FU1NBR0UpXG4gICAgfVxuXG4gICAgcmV0dXJuIHRpbWVvdXRNc1xuICB9XG5cbiAgLyoqXG4gICAqIEluc2VydHMgb25lIHByZXBhcmVkIHF1ZXVlZCBqb2IsIGluY2x1ZGluZyBpdHMgY29uY3VycmVuY3kgcmVnaXN0cmF0aW9uLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL2RhdGFiYXNlL2RyaXZlcnMvYmFzZS5qc1wiKS5kZWZhdWx0fSBkYiAtIERhdGFiYXNlIGNvbm5lY3Rpb24uXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gSW5zZXJ0IGlucHV0LlxuICAgKiBAcGFyYW0ge1ByZXBhcmVkQmFja2dyb3VuZEpvYn0gYXJncy5wcmVwYXJlZEpvYiAtIFByZXBhcmVkIGpvYi5cbiAgICogQHBhcmFtIHtzdHJpbmcgfCBudWxsfSBhcmdzLnNjaGVkdWxlS2V5IC0gSGlzdG9yaWNhbCBzdGFibGUga2V5LlxuICAgKiBAcGFyYW0ge251bWJlciB8IG51bGx9IFthcmdzLnNjaGVkdWxlT3JkZXJdIC0gTW9ub3RvbmljIHN0YWJsZSBvd25lcnNoaXAgb3JkZXIuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIGFmdGVyIGluc2VydGlvbi5cbiAgICovXG4gIGFzeW5jIF9pbnNlcnRQcmVwYXJlZEpvYihkYiwge3ByZXBhcmVkSm9iLCBzY2hlZHVsZUtleSwgc2NoZWR1bGVPcmRlciA9IG51bGx9KSB7XG4gICAgY29uc3Qge2NvbmN1cnJlbmN5fSA9IHByZXBhcmVkSm9iXG5cbiAgICBpZiAoY29uY3VycmVuY3kpIHtcbiAgICAgIGlmIChjb25jdXJyZW5jeS5xdWV1ZURlcml2ZWQpIHtcbiAgICAgICAgYXdhaXQgdGhpcy5fZW5zdXJlUXVldWVDb25jdXJyZW5jeUtleShkYiwgY29uY3VycmVuY3kpXG4gICAgICB9IGVsc2Uge1xuICAgICAgICBhd2FpdCB0aGlzLl9lbnN1cmVDb25jdXJyZW5jeUtleShkYiwgY29uY3VycmVuY3kpXG4gICAgICB9XG4gICAgfVxuXG4gICAgYXdhaXQgZGIuaW5zZXJ0KHtcbiAgICAgIHRhYmxlTmFtZTogSk9CU19UQUJMRSxcbiAgICAgIGRhdGE6IHtcbiAgICAgICAgaWQ6IHByZXBhcmVkSm9iLmpvYklkLFxuICAgICAgICBqb2JfbmFtZTogcHJlcGFyZWRKb2Iuam9iTmFtZSxcbiAgICAgICAgYXJnc19qc29uOiBwcmVwYXJlZEpvYi5hcmdzSnNvbixcbiAgICAgICAgZXhlY3V0aW9uX21vZGU6IHByZXBhcmVkSm9iLmV4ZWN1dGlvbk1vZGUsXG4gICAgICAgIHF1ZXVlOiBwcmVwYXJlZEpvYi5xdWV1ZSxcbiAgICAgICAgbWF4X3JldHJpZXM6IHByZXBhcmVkSm9iLm1heFJldHJpZXMsXG4gICAgICAgIGF0dGVtcHRzOiAwLFxuICAgICAgICBzdGF0dXM6IFwicXVldWVkXCIsXG4gICAgICAgIHNjaGVkdWxlZF9hdF9tczogcHJlcGFyZWRKb2Iuc2NoZWR1bGVkQXRNcyxcbiAgICAgICAgY3JlYXRlZF9hdF9tczogcHJlcGFyZWRKb2IuY3JlYXRlZEF0TXMsXG4gICAgICAgIHNjaGVkdWxlX2tleTogc2NoZWR1bGVLZXksXG4gICAgICAgIHNjaGVkdWxlX29yZGVyOiBzY2hlZHVsZU9yZGVyLFxuICAgICAgICBjb25jdXJyZW5jeV9rZXk6IGNvbmN1cnJlbmN5Py5jb25jdXJyZW5jeUtleSB8fCBudWxsLFxuICAgICAgICBtYXhfY29uY3VycmVuY3k6IGNvbmN1cnJlbmN5Py5tYXhDb25jdXJyZW5jeSB8fCBudWxsLFxuICAgICAgICB0aW1lb3V0X21zOiBwcmVwYXJlZEpvYi50aW1lb3V0TXMsXG4gICAgICAgIGhhbmRvZmZfaWQ6IG51bGxcbiAgICAgIH1cbiAgICB9KVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgbm9ybWFsaXplIG1heCByZXRyaWVzLlxuICAgKiBAcGFyYW0ge251bWJlciB8IG51bGwgfCB1bmRlZmluZWR9IG1heFJldHJpZXMgLSBJbnB1dC5cbiAgICogQHJldHVybnMge251bWJlcn0gLSBOb3JtYWxpemVkIG1heCByZXRyaWVzLlxuICAgKi9cbiAgX25vcm1hbGl6ZU1heFJldHJpZXMobWF4UmV0cmllcykge1xuICAgIHJldHVybiBub3JtYWxpemVCYWNrZ3JvdW5kSm9iTWF4UmV0cmllcyhtYXhSZXRyaWVzKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgbm9ybWFsaXplIHNjaGVkdWxlZCBhdCBtcy5cbiAgICogQHBhcmFtIHtudW1iZXIgfCB1bmRlZmluZWR9IHNjaGVkdWxlZEF0TXMgLSBSZXF1ZXN0ZWQgZGlzcGF0Y2ggdGltZXN0YW1wLlxuICAgKiBAcGFyYW0ge251bWJlcn0gZGVmYXVsdFNjaGVkdWxlZEF0TXMgLSBEZWZhdWx0IGRpc3BhdGNoIHRpbWVzdGFtcC5cbiAgICogQHJldHVybnMge251bWJlcn0gLSBEaXNwYXRjaCB0aW1lc3RhbXAuXG4gICAqL1xuICBfbm9ybWFsaXplU2NoZWR1bGVkQXRNcyhzY2hlZHVsZWRBdE1zLCBkZWZhdWx0U2NoZWR1bGVkQXRNcykge1xuICAgIHJldHVybiBub3JtYWxpemVCYWNrZ3JvdW5kSm9iU2NoZWR1bGVkQXRNcyhzY2hlZHVsZWRBdE1zLCBkZWZhdWx0U2NoZWR1bGVkQXRNcylcbiAgfVxuXG4gIC8qKlxuICAgKiBSZXNvbHZlcyBhIHJlc2NoZWR1bGUgZGVsYXkgYWdhaW5zdCBwZXJzaXN0ZW5jZSB0aW1lLlxuICAgKiBAcGFyYW0ge251bWJlcn0gZGVsYXlNcyAtIERlbGF5IGluIG1pbGxpc2Vjb25kcy5cbiAgICogQHJldHVybnMge251bWJlcn0gLSBGdXR1cmUgZWxpZ2liaWxpdHkgdGltZXN0YW1wLlxuICAgKi9cbiAgX3Jlc2NoZWR1bGVkQXRNcyhkZWxheU1zKSB7XG4gICAgcmV0dXJuIHJlc2NoZWR1bGVkQmFja2dyb3VuZEpvYkF0TXMoZGVsYXlNcywgdGhpcy5jbG9jay5ub3coKSlcbiAgfVxuXG4gIC8qKlxuICAgKiBWYWxpZGF0ZXMgYSBwdWJsaWMgcmVzY2hlZHVsZSBkZWxheSBiZWZvcmUgcGVyc2lzdGVuY2Ugd29yayBiZWdpbnMuXG4gICAqIEBwYXJhbSB7bnVtYmVyfSBkZWxheU1zIC0gRGVsYXkgaW4gbWlsbGlzZWNvbmRzLlxuICAgKiBAcmV0dXJucyB7dm9pZH1cbiAgICovXG4gIF92YWxpZGF0ZVJlc2NoZWR1bGVEZWxheU1zKGRlbGF5TXMpIHtcbiAgICByZXNjaGVkdWxlZEJhY2tncm91bmRKb2JBdE1zKGRlbGF5TXMsIDApXG4gIH1cblxuICAvKipcbiAgICogVmFsaWRhdGVzIGEgc3RhYmxlIHNjaGVkdWxlIGtleSBhdCB0aGUgcHVibGljIHN0b3JhZ2UgYm91bmRhcnkuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBzY2hlZHVsZUtleSAtIFN0YWJsZSBsb2dpY2FsIHNjaGVkdWxlIGtleS5cbiAgICogQHJldHVybnMge3N0cmluZ30gLSBWYWxpZGF0ZWQga2V5LlxuICAgKi9cbiAgX25vcm1hbGl6ZVNjaGVkdWxlS2V5KHNjaGVkdWxlS2V5KSB7XG4gICAgcmV0dXJuIG5vcm1hbGl6ZUJhY2tncm91bmRKb2JTY2hlZHVsZUtleShzY2hlZHVsZUtleSlcbiAgfVxuXG4gIC8qKlxuICAgKiBCdWlsZHMgYSBib3VuZGVkIGFkdmlzb3J5LWxvY2sgbmFtZSBmb3Igb25lIHN0YWJsZSBzY2hlZHVsZSBrZXkuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBzY2hlZHVsZUtleSAtIFZhbGlkYXRlZCBzdGFibGUgc2NoZWR1bGUga2V5LlxuICAgKiBAcmV0dXJucyB7c3RyaW5nfSAtIEFkdmlzb3J5LWxvY2sgbmFtZS5cbiAgICovXG4gIF9zY2hlZHVsZUtleUxvY2tOYW1lKHNjaGVkdWxlS2V5KSB7XG4gICAgY29uc3QgaGFzaCA9IGNyZWF0ZUhhc2goXCJzaGEyNTZcIikudXBkYXRlKHNjaGVkdWxlS2V5KS5kaWdlc3QoXCJoZXhcIikuc2xpY2UoMCwgMzIpXG5cbiAgICByZXR1cm4gYGJhY2tncm91bmQtam9iczpzY2hlZHVsZToke2hhc2h9YFxuICB9XG5cbiAgLyoqXG4gICAqIEVuc3VyZXMgdGhlIGJhY2tncm91bmQtam9icyBzY2hlbWEgZXhpc3RzLCByZXVzaW5nIGEgY2FsbGVyLWhlbGQgY29ubmVjdGlvbiB3aGVuXG4gICAqIG9uZSBpcyBnaXZlbiByYXRoZXIgdGhhbiBjaGVja2luZyBvdXQgaXRzIG93bi5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9kYXRhYmFzZS9kcml2ZXJzL2Jhc2UuanNcIikuZGVmYXVsdH0gW2V4aXN0aW5nRGJdIC0gUmV1c2UgYW5cbiAgICogICBhbHJlYWR5LWNoZWNrZWQtb3V0IGNvbm5lY3Rpb24gKGUuZy4gdGhlIG9uZSBgZGI6bWlncmF0ZWAgaG9sZHMpIGluc3RlYWQgb2ZcbiAgICogICBjaGVja2luZyBvdXQgYSBuZXN0ZWQgb25lIOKAlCB0aGUgbmVzdGVkIGNoZWNrb3V0IHdvdWxkIGRlYWRsb2NrIGEgZGF0YWJhc2VcbiAgICogICB3aG9zZSBwb29sIGlzIGNhcHBlZCBhdCBhIHNpbmdsZSBjb25uZWN0aW9uIGFscmVhZHkgaGVsZCBieSB0aGUgY2FsbGVyLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyB3aGVuIHRoZSBzY2hlbWEgaXMgcHJlc2VudC5cbiAgICovXG4gIGFzeW5jIF9lbnN1cmVTY2hlbWEoZXhpc3RpbmdEYikge1xuICAgIGF3YWl0IHRoaXMuX2FwcGx5U2NoZW1hKGV4aXN0aW5nRGIpXG4gIH1cblxuICAvKipcbiAgICogU2VyaWFsaXplcyBjcmVhdGlvbiBvciB1cGdyYWRlIG9mIHRoZSBiYWNrZ3JvdW5kLWpvYnMgc2NoZW1hLCBjaGVja2luZyBvdXQgYVxuICAgKiBjb25uZWN0aW9uIG9ubHkgYWZ0ZXIgZWFybGllciBzY2hlbWEgd29yayBoYXMgY29tcGxldGVkIHdoZW4gb25lIGlzIG5vdCBzdXBwbGllZC5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9kYXRhYmFzZS9kcml2ZXJzL2Jhc2UuanNcIikuZGVmYXVsdH0gW2V4aXN0aW5nRGJdIC0gQ2FsbGVyLW93bmVkXG4gICAqICAgZGF0YWJhc2UgY29ubmVjdGlvbi5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgd2hlbiB0aGUgc2NoZW1hIGlzIHByZXNlbnQuXG4gICAqL1xuICBhc3luYyBfYXBwbHlTY2hlbWEoZXhpc3RpbmdEYikge1xuICAgIC8vIFNlcmlhbGl6ZSBjb25jdXJyZW50IHNjaGVtYSBhcHBsaWVzIHdpdGhpbiB0aGlzIHByb2Nlc3MsIGtleWVkIGJ5IGRhdGFiYXNlXG4gICAgLy8gaWRlbnRpZmllciAoc2VlIGBzY2hlbWFBcHBseUNoYWluc2ApLiBUaGUgcGVyLXN0ZXAgbG9ja3MgaW5zaWRlIHRoZSBzdGVwcyB1c2VcbiAgICAvLyBESUZGRVJFTlQgbG9jayBuYW1lcywgc28gdHdvIGNvbmN1cnJlbnQgY2FsbGVycyBjb3VsZCBvdGhlcndpc2UgZWFjaCBob2xkIGFcbiAgICAvLyBkaWZmZXJlbnQgc3RlcCBsb2NrIHdoaWxlIGJvdGggcmVidWlsZCB0aGUgam9icyB0YWJsZSDigJQgYW5kIG9uIFNRTGl0ZS9NU1NRTCBhblxuICAgIC8vIGFkZC1jb2x1bW4gaXMgYSBjcmVhdGUtY29weS1kcm9wLXJlbmFtZSByZWJ1aWxkLCBzbyBvdmVybGFwcGluZyByZWJ1aWxkc1xuICAgIC8vIGNvcnJ1cHQgaXQuIFRoaXMgbXV0ZXggbWFrZXMgdGhlIHdob2xlIGFwcGx5IG11dHVhbGx5IGV4Y2x1c2l2ZSBwZXIgcHJvY2VzcztcbiAgICAvLyB0aGUgc2Vjb25kIGNhbGxlciB0aGVuIHJlLWNoZWNrcyBhbmQgZmluZHMgZXZlcnkgc3RlcCBhbHJlYWR5IGRvbmUuXG4gICAgY29uc3QgaWRlbnRpZmllciA9IHRoaXMuZ2V0RGF0YWJhc2VJZGVudGlmaWVyKCkgPz8gXCJkZWZhdWx0XCJcbiAgICBjb25zdCBwcmV2aW91cyA9IHNjaGVtYUFwcGx5Q2hhaW5zLmdldChpZGVudGlmaWVyKSA/PyBQcm9taXNlLnJlc29sdmUoKVxuICAgIGNvbnN0IGFwcGx5V2l0aENvbm5lY3Rpb24gPSBhc3luYyAoKSA9PiB7XG4gICAgICBpZiAoZXhpc3RpbmdEYikge1xuICAgICAgICBhd2FpdCB0aGlzLl9hcHBseVNjaGVtYVN0ZXBzKGV4aXN0aW5nRGIpXG5cbiAgICAgICAgcmV0dXJuXG4gICAgICB9XG5cbiAgICAgIGF3YWl0IHRoaXMuX3dpdGhEYigoZGIpID0+IHRoaXMuX2FwcGx5U2NoZW1hU3RlcHMoZGIpKVxuICAgIH1cbiAgICBjb25zdCBydW4gPSBwcmV2aW91cy50aGVuKGFwcGx5V2l0aENvbm5lY3Rpb24sIGFwcGx5V2l0aENvbm5lY3Rpb24pXG5cbiAgICAvLyBLZWVwIHRoZSBjaGFpbiBhbGl2ZSByZWdhcmRsZXNzIG9mIHRoaXMgcnVuJ3Mgb3V0Y29tZSBzbyBvbmUgZmFpbGVkIGFwcGx5IGRvZXNcbiAgICAvLyBub3Qgd2VkZ2UgbGF0ZXIgY2FsbGVyczsgdGhpcyBydW4gc3RpbGwgcHJvcGFnYXRlcyBpdHMgb3duIHJlc3VsdC9lcnJvci5cbiAgICBzY2hlbWFBcHBseUNoYWlucy5zZXQoaWRlbnRpZmllciwgcnVuLnRoZW4oKCkgPT4ge30sICgpID0+IHt9KSlcblxuICAgIHJldHVybiBhd2FpdCBydW5cbiAgfVxuXG4gIC8qKlxuICAgKiBDcmVhdGVzIG9yIHVwZ3JhZGVzIHRoZSBiYWNrZ3JvdW5kLWpvYnMgdGFibGVzLCBjb2x1bW5zIGFuZCBjb25jdXJyZW5jeSByb3dzIG9uXG4gICAqIHRoZSBnaXZlbiBjb25uZWN0aW9uLiBTZXJpYWxpemVkIHBlciBwcm9jZXNzIGJ5IHtAbGluayBCYWNrZ3JvdW5kSm9ic1N0b3JlI19hcHBseVNjaGVtYX0uXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vZGF0YWJhc2UvZHJpdmVycy9iYXNlLmpzXCIpLmRlZmF1bHR9IGRiIC0gRGF0YWJhc2UgY29ubmVjdGlvbi5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgd2hlbiB0aGUgc2NoZW1hIGlzIHByZXNlbnQuXG4gICAqL1xuICBhc3luYyBfYXBwbHlTY2hlbWFTdGVwcyhkYikge1xuICAgIGF3YWl0IHRoaXMuX2Vuc3VyZU1pZ3JhdGlvbnNUYWJsZShkYilcblxuICAgIGNvbnN0IGFscmVhZHlBcHBsaWVkID0gYXdhaXQgdGhpcy5faGFzTWlncmF0aW9uKGRiKVxuICAgIGNvbnN0IHNjaGVtYVJlY292ZXJ5UGVuZGluZyA9IGF3YWl0IHRoaXMuX2hhc01pZ3JhdGlvbihkYiwgU0NIRU1BX1JFQ09WRVJZX1BFTkRJTkdfVkVSU0lPTilcbiAgICBjb25zdCBqb2JzVGFibGVFeGlzdHMgPSBhd2FpdCBkYi50YWJsZUV4aXN0cyhKT0JTX1RBQkxFKVxuXG4gICAgLy8gRXZlbiB3aGVuIHRoZSBtaWdyYXRpb24gcm93IGlzIHByZXNlbnQsIHRoZSBqb2JzIHRhYmxlIGl0c2VsZiBjYW4gaGF2ZVxuICAgIC8vIGJlZW4gZHJvcHBlZCB1bmRlcm5lYXRoIHVzIGJ5IGEgdHJhbnNhY3Rpb24gcm9sbGJhY2sgaW4gYW5vdGhlciBjYWxsZXJcbiAgICAvLyAoRERMIGlzIHRyYW5zYWN0aW9uYWwgb24gU1FMaXRlL01TU1FMKS4gVmVyaWZ5IHRoZSB0YWJsZSBwaHlzaWNhbGx5XG4gICAgLy8gZXhpc3RzIGFuZCByZWNyZWF0ZSBpdCB3aGVuIG1pc3NpbmcgcmF0aGVyIHRoYW4gdHJ1c3RpbmcgdGhlIG1pZ3JhdGlvblxuICAgIC8vIHJvdyBhbG9uZSwgb3RoZXJ3aXNlIGxhdGVyIGNhbGxlcnMgZmFpbCB3aXRoIFwibm8gc3VjaCB0YWJsZVwiLlxuICAgIGlmIChhbHJlYWR5QXBwbGllZCAmJiBqb2JzVGFibGVFeGlzdHMgJiYgIXNjaGVtYVJlY292ZXJ5UGVuZGluZykge1xuICAgICAgYXdhaXQgdGhpcy5fZW5zdXJlSm9ic1RhYmxlQ29sdW1ucyhkYilcbiAgICAgIGF3YWl0IHRoaXMuX2Vuc3VyZUlkZW1wb3RlbmN5S2V5c1RhYmxlKGRiKVxuICAgICAgYXdhaXQgdGhpcy5fZW5zdXJlTWFpbERlbGl2ZXJ5T3BlcmF0aW9uc1RhYmxlKGRiKVxuICAgICAgYXdhaXQgdGhpcy5fZW5zdXJlU2NoZWR1bGVLZXlzVGFibGUoZGIpXG4gICAgICBhd2FpdCB0aGlzLl9lbnN1cmVDb25jdXJyZW5jeVRhYmxlKGRiKVxuICAgICAgYXdhaXQgdGhpcy5fZW5zdXJlQ291bnRSZXZpc2lvblRhYmxlKGRiKVxuXG4gICAgICByZXR1cm5cbiAgICB9XG5cbiAgICBpZiAoYWxyZWFkeUFwcGxpZWQgJiYgIXNjaGVtYVJlY292ZXJ5UGVuZGluZykge1xuICAgICAgYXdhaXQgdGhpcy5fcmVjb3JkTWlncmF0aW9uKGRiLCBTQ0hFTUFfUkVDT1ZFUllfUEVORElOR19WRVJTSU9OKVxuICAgIH1cblxuICAgIGF3YWl0IHRoaXMuX2FwcGx5TWlncmF0aW9ucyhkYilcbiAgICBhd2FpdCB0aGlzLl9lbnN1cmVKb2JzVGFibGVDb2x1bW5zKGRiKVxuICAgIGF3YWl0IHRoaXMuX2Vuc3VyZUlkZW1wb3RlbmN5S2V5c1RhYmxlKGRiKVxuICAgIGF3YWl0IHRoaXMuX2Vuc3VyZU1haWxEZWxpdmVyeU9wZXJhdGlvbnNUYWJsZShkYilcbiAgICBhd2FpdCB0aGlzLl9lbnN1cmVTY2hlZHVsZUtleXNUYWJsZShkYilcbiAgICBhd2FpdCB0aGlzLl9lbnN1cmVDb25jdXJyZW5jeVRhYmxlKGRiKVxuICAgIGF3YWl0IHRoaXMuX2Vuc3VyZUNvdW50UmV2aXNpb25UYWJsZShkYilcblxuICAgIGlmIChhbHJlYWR5QXBwbGllZCkge1xuICAgICAgLy8gVGhlIHJlY3JlYXRlZCBqb2JzIHRhYmxlIGlzIGVtcHR5LCBidXQgdGhlIHN1cnZpdmluZyBjb25jdXJyZW5jeSB0YWJsZVxuICAgICAgLy8gY2FuIHN0aWxsIGNvdW50IGhhbmRvZmZzIHRoYXQgZGlzYXBwZWFyZWQgd2l0aCB0aGUgZHJvcHBlZCBqb2JzIHRhYmxlLlxuICAgICAgYXdhaXQgdGhpcy5fcmVjb25jaWxlQ29uY3VycmVuY3koZGIpXG4gICAgICBhd2FpdCBkYi5kZWxldGUoe1xuICAgICAgICB0YWJsZU5hbWU6IE1JR1JBVElPTlNfVEFCTEUsXG4gICAgICAgIGNvbmRpdGlvbnM6IHtrZXk6IHRoaXMuX21pZ3JhdGlvbktleShTQ0hFTUFfUkVDT1ZFUllfUEVORElOR19WRVJTSU9OKX1cbiAgICAgIH0pXG5cbiAgICAgIHJldHVyblxuICAgIH1cblxuICAgIGF3YWl0IHRoaXMuX3JlY29yZE1pZ3JhdGlvbihkYiwgTUlHUkFUSU9OX1ZFUlNJT04pXG4gIH1cblxuICAvKipcbiAgICogUnVucyBlbnN1cmUgbWlncmF0aW9ucyB0YWJsZS5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9kYXRhYmFzZS9kcml2ZXJzL2Jhc2UuanNcIikuZGVmYXVsdH0gZGIgLSBEYXRhYmFzZSBjb25uZWN0aW9uLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyB3aGVuIGNvbXBsZXRlLlxuICAgKi9cbiAgYXN5bmMgX2Vuc3VyZU1pZ3JhdGlvbnNUYWJsZShkYikge1xuICAgIGlmIChhd2FpdCBkYi50YWJsZUV4aXN0cyhNSUdSQVRJT05TX1RBQkxFKSkgcmV0dXJuXG5cbiAgICBjb25zdCB0YWJsZSA9IG5ldyBUYWJsZURhdGEoTUlHUkFUSU9OU19UQUJMRSwge2lmTm90RXhpc3RzOiB0cnVlfSlcblxuICAgIHRhYmxlLnN0cmluZyhcImtleVwiLCB7bnVsbDogZmFsc2UsIHByaW1hcnlLZXk6IHRydWV9KVxuICAgIHRhYmxlLnN0cmluZyhcInNjb3BlXCIsIHtudWxsOiBmYWxzZX0pXG4gICAgdGFibGUuc3RyaW5nKFwidmVyc2lvblwiLCB7bnVsbDogZmFsc2V9KVxuICAgIHRhYmxlLmJpZ2ludChcImFwcGxpZWRfYXRfbXNcIiwge251bGw6IGZhbHNlfSlcblxuICAgIGF3YWl0IGRiLmNyZWF0ZVRhYmxlKHRhYmxlKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgaGFzIG1pZ3JhdGlvbi5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9kYXRhYmFzZS9kcml2ZXJzL2Jhc2UuanNcIikuZGVmYXVsdH0gZGIgLSBEYXRhYmFzZSBjb25uZWN0aW9uLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gW3ZlcnNpb25dIC0gTWlncmF0aW9uIHZlcnNpb24uXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPGJvb2xlYW4+fSAtIFdoZXRoZXIgbWlncmF0aW9uIGV4aXN0cy5cbiAgICovXG4gIGFzeW5jIF9oYXNNaWdyYXRpb24oZGIsIHZlcnNpb24gPSBNSUdSQVRJT05fVkVSU0lPTikge1xuICAgIGNvbnN0IHF1ZXJ5ID0gZGJcbiAgICAgIC5uZXdRdWVyeSgpXG4gICAgICAuZnJvbShNSUdSQVRJT05TX1RBQkxFKVxuICAgICAgLndoZXJlKHtrZXk6IHRoaXMuX21pZ3JhdGlvbktleSh2ZXJzaW9uKX0pXG4gICAgICAubGltaXQoMSlcblxuICAgIGNvbnN0IHJvd3MgPSBhd2FpdCBxdWVyeS5yZXN1bHRzKClcblxuICAgIHJldHVybiByb3dzLmxlbmd0aCA+IDBcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGFwcGx5IG1pZ3JhdGlvbnMuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vZGF0YWJhc2UvZHJpdmVycy9iYXNlLmpzXCIpLmRlZmF1bHR9IGRiIC0gRGF0YWJhc2UgY29ubmVjdGlvbi5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgd2hlbiBjb21wbGV0ZS5cbiAgICovXG4gIGFzeW5jIF9hcHBseU1pZ3JhdGlvbnMoZGIpIHtcbiAgICB0aGlzLmxvZ2dlci5pbmZvKFwiQXBwbHlpbmcgYmFja2dyb3VuZCBqb2JzIHNjaGVtYVwiKVxuXG4gICAgaWYgKGF3YWl0IGRiLnRhYmxlRXhpc3RzKEpPQlNfVEFCTEUpKSB7XG4gICAgICB0aGlzLmxvZ2dlci5pbmZvKFwiQmFja2dyb3VuZCBqb2JzIHRhYmxlIGFscmVhZHkgZXhpc3RzIC0gc2tpcHBpbmcgY3JlYXRlXCIpXG4gICAgICByZXR1cm5cbiAgICB9XG5cbiAgICBjb25zdCB0YWJsZSA9IG5ldyBUYWJsZURhdGEoSk9CU19UQUJMRSwge2lmTm90RXhpc3RzOiB0cnVlfSlcblxuICAgIHRhYmxlLnN0cmluZyhcImlkXCIsIHtwcmltYXJ5S2V5OiB0cnVlfSlcbiAgICB0YWJsZS5zdHJpbmcoXCJqb2JfbmFtZVwiLCB7bnVsbDogZmFsc2UsIGluZGV4OiB0cnVlfSlcbiAgICB0YWJsZS50ZXh0KFwiYXJnc19qc29uXCIsIHtudWxsOiBmYWxzZX0pXG4gICAgdGFibGUuc3RyaW5nKFwiZXhlY3V0aW9uX21vZGVcIiwge251bGw6IGZhbHNlfSlcbiAgICB0YWJsZS5zdHJpbmcoXCJxdWV1ZVwiLCB7bnVsbDogdHJ1ZSwgaW5kZXg6IHRydWV9KVxuICAgIHRhYmxlLmludGVnZXIoXCJtYXhfcmV0cmllc1wiLCB7bnVsbDogZmFsc2V9KVxuICAgIHRhYmxlLmludGVnZXIoXCJhdHRlbXB0c1wiLCB7bnVsbDogZmFsc2V9KVxuICAgIHRhYmxlLnN0cmluZyhcInN0YXR1c1wiLCB7bnVsbDogZmFsc2UsIGluZGV4OiB0cnVlfSlcbiAgICB0YWJsZS5iaWdpbnQoXCJzY2hlZHVsZWRfYXRfbXNcIiwge251bGw6IGZhbHNlLCBpbmRleDogdHJ1ZX0pXG4gICAgdGFibGUuYmlnaW50KFwiY3JlYXRlZF9hdF9tc1wiLCB7bnVsbDogZmFsc2UsIGluZGV4OiB0cnVlfSlcbiAgICB0YWJsZS5zdHJpbmcoXCJzY2hlZHVsZV9rZXlcIiwge251bGw6IHRydWUsIGluZGV4OiB0cnVlfSlcbiAgICB0YWJsZS5iaWdpbnQoXCJzY2hlZHVsZV9vcmRlclwiLCB7bnVsbDogdHJ1ZX0pXG4gICAgdGFibGUuYmlnaW50KFwiaGFuZGVkX29mZl9hdF9tc1wiLCB7bnVsbDogdHJ1ZSwgaW5kZXg6IHRydWV9KVxuICAgIHRhYmxlLnN0cmluZyhcImhhbmRvZmZfaWRcIiwge251bGw6IHRydWV9KVxuICAgIHRhYmxlLmJpZ2ludChcImNvbXBsZXRlZF9hdF9tc1wiLCB7bnVsbDogdHJ1ZX0pXG4gICAgdGFibGUuYmlnaW50KFwiZmFpbGVkX2F0X21zXCIsIHtudWxsOiB0cnVlfSlcbiAgICB0YWJsZS5iaWdpbnQoXCJvcnBoYW5lZF9hdF9tc1wiLCB7bnVsbDogdHJ1ZSwgaW5kZXg6IHRydWV9KVxuICAgIHRhYmxlLnN0cmluZyhcIndvcmtlcl9pZFwiLCB7bnVsbDogdHJ1ZX0pXG4gICAgdGFibGUudGV4dChcImxhc3RfZXJyb3JcIiwge251bGw6IHRydWV9KVxuICAgIHRhYmxlLnN0cmluZyhcImNvbmN1cnJlbmN5X2tleVwiLCB7bnVsbDogdHJ1ZSwgaW5kZXg6IHRydWV9KVxuICAgIHRhYmxlLmludGVnZXIoXCJtYXhfY29uY3VycmVuY3lcIiwge251bGw6IHRydWV9KVxuICAgIHRhYmxlLmJpZ2ludChcInRpbWVvdXRfbXNcIiwge251bGw6IHRydWV9KVxuICAgIHRhYmxlLmJpZ2ludChcImNoaWxkX3JlY2VpdmVkX2F0X21zXCIsIHtudWxsOiB0cnVlfSlcbiAgICB0YWJsZS5iaWdpbnQoXCJjaGlsZF9zdGFydGVkX2F0X21zXCIsIHtudWxsOiB0cnVlfSlcbiAgICB0YWJsZS5zdHJpbmcoXCJjaGlsZF9pbnN0YW5jZV9pZFwiLCB7bnVsbDogdHJ1ZX0pXG4gICAgdGFibGUuaW50ZWdlcihcImNoaWxkX3BpZFwiLCB7bnVsbDogdHJ1ZX0pXG5cbiAgICBhd2FpdCBkYi5jcmVhdGVUYWJsZSh0YWJsZSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGVuc3VyZSBqb2JzIHRhYmxlIGNvbHVtbnMuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vZGF0YWJhc2UvZHJpdmVycy9iYXNlLmpzXCIpLmRlZmF1bHR9IGRiIC0gRGF0YWJhc2UgY29ubmVjdGlvbi5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgd2hlbiBjb21wbGV0ZS5cbiAgICovXG4gIGFzeW5jIF9lbnN1cmVKb2JzVGFibGVDb2x1bW5zKGRiKSB7XG4gICAgaWYgKCEoYXdhaXQgZGIudGFibGVFeGlzdHMoSk9CU19UQUJMRSkpKSByZXR1cm5cblxuICAgIGNvbnN0IHRhYmxlID0gYXdhaXQgZGIuZ2V0VGFibGVCeU5hbWVPckZhaWwoSk9CU19UQUJMRSlcbiAgICBjb25zdCBleGVjdXRpb25Nb2RlQ29sdW1uID0gYXdhaXQgdGFibGUuZ2V0Q29sdW1uQnlOYW1lKFwiZXhlY3V0aW9uX21vZGVcIilcblxuICAgIGlmICghZXhlY3V0aW9uTW9kZUNvbHVtbikge1xuICAgICAgY29uc3QgdGFibGVEYXRhID0gbmV3IFRhYmxlRGF0YShKT0JTX1RBQkxFKVxuICAgICAgdGFibGVEYXRhLnN0cmluZyhcImV4ZWN1dGlvbl9tb2RlXCIsIHtudWxsOiB0cnVlfSlcbiAgICAgIGNvbnN0IHNxbHMgPSBhd2FpdCBkYi5hbHRlclRhYmxlU1FMcyh0YWJsZURhdGEpXG5cbiAgICAgIGZvciAoY29uc3Qgc3FsIG9mIHNxbHMpIHtcbiAgICAgICAgYXdhaXQgZGIucXVlcnkoc3FsKVxuICAgICAgfVxuXG4gICAgICBkYi5jbGVhclNjaGVtYUNhY2hlKClcbiAgICB9XG5cbiAgICBjb25zdCByZWZyZXNoZWRUYWJsZSA9IGF3YWl0IGRiLmdldFRhYmxlQnlOYW1lT3JGYWlsKEpPQlNfVEFCTEUpXG4gICAgY29uc3QgaGFuZG9mZklkQ29sdW1uID0gYXdhaXQgcmVmcmVzaGVkVGFibGUuZ2V0Q29sdW1uQnlOYW1lKFwiaGFuZG9mZl9pZFwiKVxuXG4gICAgaWYgKCFoYW5kb2ZmSWRDb2x1bW4pIHtcbiAgICAgIGNvbnN0IGxvY2tOYW1lID0gYCR7TUlHUkFUSU9OX1NDT1BFfTpoYW5kb2ZmX2lkX2NvbHVtbmBcbiAgICAgIGNvbnN0IGFjcXVpcmVkID0gYXdhaXQgZGIuYWNxdWlyZUFkdmlzb3J5TG9jayhsb2NrTmFtZSlcblxuICAgICAgaWYgKCFhY3F1aXJlZCkgdGhyb3cgbmV3IEVycm9yKFwiRmFpbGVkIHRvIGFjcXVpcmUgYmFja2dyb3VuZCBqb2JzIGhhbmRvZmYgc2NoZW1hIGxvY2tcIilcblxuICAgICAgdHJ5IHtcbiAgICAgICAgZGIuY2xlYXJTY2hlbWFDYWNoZSgpXG4gICAgICAgIGNvbnN0IGxvY2tlZFRhYmxlID0gYXdhaXQgZGIuZ2V0VGFibGVCeU5hbWVPckZhaWwoSk9CU19UQUJMRSlcblxuICAgICAgICBpZiAoIShhd2FpdCBsb2NrZWRUYWJsZS5nZXRDb2x1bW5CeU5hbWUoXCJoYW5kb2ZmX2lkXCIpKSkge1xuICAgICAgICAgIGNvbnN0IHRhYmxlRGF0YSA9IG5ldyBUYWJsZURhdGEoSk9CU19UQUJMRSlcbiAgICAgICAgICB0YWJsZURhdGEuc3RyaW5nKFwiaGFuZG9mZl9pZFwiLCB7bnVsbDogdHJ1ZX0pXG4gICAgICAgICAgY29uc3Qgc3FscyA9IGF3YWl0IGRiLmFsdGVyVGFibGVTUUxzKHRhYmxlRGF0YSlcblxuICAgICAgICAgIGZvciAoY29uc3Qgc3FsIG9mIHNxbHMpIHtcbiAgICAgICAgICAgIGF3YWl0IGRiLnF1ZXJ5KHNxbClcbiAgICAgICAgICB9XG5cbiAgICAgICAgICBkYi5jbGVhclNjaGVtYUNhY2hlKClcbiAgICAgICAgfVxuICAgICAgfSBmaW5hbGx5IHtcbiAgICAgICAgYXdhaXQgZGIucmVsZWFzZUFkdmlzb3J5TG9jayhsb2NrTmFtZSlcbiAgICAgIH1cbiAgICB9XG5cbiAgICBhd2FpdCB0aGlzLl9iYWNrZmlsbEV4ZWN1dGlvbk1vZGVzT25jZShkYilcbiAgICBhd2FpdCB0aGlzLl9kcm9wRm9ya2VkQ29sdW1uT25jZShkYilcblxuICAgIGNvbnN0IGxvY2tOYW1lID0gYCR7TUlHUkFUSU9OX1NDT1BFfTpjb25jdXJyZW5jeV9jb2x1bW5zYFxuICAgIGNvbnN0IGFjcXVpcmVkID0gYXdhaXQgZGIuYWNxdWlyZUFkdmlzb3J5TG9jayhsb2NrTmFtZSlcblxuICAgIGlmICghYWNxdWlyZWQpIHRocm93IG5ldyBFcnJvcihcIkZhaWxlZCB0byBhY3F1aXJlIGJhY2tncm91bmQgam9icyBjb25jdXJyZW5jeSBzY2hlbWEgbG9ja1wiKVxuXG4gICAgdHJ5IHtcbiAgICAgIC8vIFNRTCBTZXJ2ZXIgc2NoZW1hIHJlYWRzIGNhbiBkZWFkbG9jayB3aXRoIGEgY29uY3VycmVudCBBTFRFUiBUQUJMRSwgc29cbiAgICAgIC8vIGFjcXVpcmUgdGhlIGxvY2sgYmVmb3JlIGluc3BlY3RpbmcgZWl0aGVyIGNvbHVtbiByYXRoZXIgdGhhbiBvbmx5XG4gICAgICAvLyBwcm90ZWN0aW5nIHRoZSBtdXRhdGlvbi5cbiAgICAgIGRiLmNsZWFyU2NoZW1hQ2FjaGUoKVxuICAgICAgY29uc3QgbG9ja2VkVGFibGUgPSBhd2FpdCBkYi5nZXRUYWJsZUJ5TmFtZU9yRmFpbChKT0JTX1RBQkxFKVxuICAgICAgY29uc3QgY29uY3VycmVuY3lDb2x1bW5OYW1lcyA9IFtcImNvbmN1cnJlbmN5X2tleVwiLCBcIm1heF9jb25jdXJyZW5jeVwiXVxuXG4gICAgICBmb3IgKGNvbnN0IGNvbmN1cnJlbmN5Q29sdW1uTmFtZSBvZiBjb25jdXJyZW5jeUNvbHVtbk5hbWVzKSB7XG4gICAgICAgIGlmIChhd2FpdCBsb2NrZWRUYWJsZS5nZXRDb2x1bW5CeU5hbWUoY29uY3VycmVuY3lDb2x1bW5OYW1lKSkgY29udGludWVcblxuICAgICAgICBjb25zdCB0YWJsZURhdGEgPSBuZXcgVGFibGVEYXRhKEpPQlNfVEFCTEUpXG4gICAgICAgIGlmIChjb25jdXJyZW5jeUNvbHVtbk5hbWUgPT0gXCJjb25jdXJyZW5jeV9rZXlcIikge1xuICAgICAgICAgIHRhYmxlRGF0YS5zdHJpbmcoXCJjb25jdXJyZW5jeV9rZXlcIiwge251bGw6IHRydWUsIGluZGV4OiB0cnVlfSlcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICB0YWJsZURhdGEuaW50ZWdlcihcIm1heF9jb25jdXJyZW5jeVwiLCB7bnVsbDogdHJ1ZX0pXG4gICAgICAgIH1cblxuICAgICAgICBmb3IgKGNvbnN0IHNxbCBvZiBhd2FpdCBkYi5hbHRlclRhYmxlU1FMcyh0YWJsZURhdGEpKSBhd2FpdCBkYi5xdWVyeShzcWwpXG4gICAgICB9XG5cbiAgICAgIGRiLmNsZWFyU2NoZW1hQ2FjaGUoKVxuICAgIH0gZmluYWxseSB7XG4gICAgICBhd2FpdCBkYi5yZWxlYXNlQWR2aXNvcnlMb2NrKGxvY2tOYW1lKVxuICAgIH1cblxuICAgIGF3YWl0IHRoaXMuX2Vuc3VyZVF1ZXVlQ29sdW1uKGRiKVxuICAgIGF3YWl0IHRoaXMuX2Vuc3VyZVNjaGVkdWxlS2V5Q29sdW1uKGRiKVxuICAgIGF3YWl0IHRoaXMuX2Vuc3VyZVNjaGVkdWxlT3JkZXJDb2x1bW4oZGIpXG4gICAgYXdhaXQgdGhpcy5fZW5zdXJlU2NoZWR1bGVPcmRlcldhdGVybWFya3NUYWJsZShkYilcbiAgICBhd2FpdCB0aGlzLl9lbnN1cmVKb2JUaW1lb3V0Q29sdW1uKGRiKVxuICAgIGF3YWl0IHRoaXMuX2Vuc3VyZUNoaWxkQWNjZXB0YW5jZUNvbHVtbnMoZGIpXG4gICAgYXdhaXQgdGhpcy5fZW5zdXJlSm9ic1RhYmxlSW5kZXhlc09uY2UoZGIpXG4gIH1cblxuICAvKipcbiAgICogSWRlbXBvdGVudGx5IGFkZHMgdGhlIHBvb2xlZC1jaGlsZCBhY2NlcHRhbmNlIGV2aWRlbmNlIGNvbHVtbnMgdG8gZXhpc3RpbmdcbiAgICogam9iIHRhYmxlcy4gVGhleSByZWNvcmQgd2hlbiB0aGUgZXhlY3V0aW5nIHJ1bm5lciBjaGlsZCByZWNlaXZlZCBhbmRcbiAgICogc3RhcnRlZCBhIGpvYiBwbHVzIHRoYXQgY2hpbGQncyBpZGVudGl0eSwgc28gYSBoYW5kZWQtb2ZmIGpvYiBjYW4gYmUgdG9sZFxuICAgKiBhcGFydCBmcm9tIG9uZSB3aG9zZSBydW5uZXIgbmV2ZXIgcGlja2VkIGl0IHVwLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL2RhdGFiYXNlL2RyaXZlcnMvYmFzZS5qc1wiKS5kZWZhdWx0fSBkYiAtIERhdGFiYXNlIGNvbm5lY3Rpb24uXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIHdoZW4gZW5zdXJlZC5cbiAgICovXG4gIGFzeW5jIF9lbnN1cmVDaGlsZEFjY2VwdGFuY2VDb2x1bW5zKGRiKSB7XG4gICAgY29uc3QgbG9ja05hbWUgPSBgJHtNSUdSQVRJT05fU0NPUEV9OmNoaWxkX2FjY2VwdGFuY2VfY29sdW1uc2BcbiAgICBjb25zdCBhY3F1aXJlZCA9IGF3YWl0IGRiLmFjcXVpcmVBZHZpc29yeUxvY2sobG9ja05hbWUpXG5cbiAgICBpZiAoIWFjcXVpcmVkKSB0aHJvdyBuZXcgRXJyb3IoXCJGYWlsZWQgdG8gYWNxdWlyZSBiYWNrZ3JvdW5kIGpvYnMgY2hpbGQtYWNjZXB0YW5jZSBzY2hlbWEgbG9ja1wiKVxuXG4gICAgdHJ5IHtcbiAgICAgIGRiLmNsZWFyU2NoZW1hQ2FjaGUoKVxuICAgICAgY29uc3QgdGFibGUgPSBhd2FpdCBkYi5nZXRUYWJsZUJ5TmFtZU9yRmFpbChKT0JTX1RBQkxFKVxuICAgICAgY29uc3QgdGFibGVEYXRhID0gbmV3IFRhYmxlRGF0YShKT0JTX1RBQkxFKVxuICAgICAgbGV0IGFkZGVkID0gZmFsc2VcblxuICAgICAgaWYgKCEoYXdhaXQgdGFibGUuZ2V0Q29sdW1uQnlOYW1lKFwiY2hpbGRfcmVjZWl2ZWRfYXRfbXNcIikpKSB7XG4gICAgICAgIHRhYmxlRGF0YS5iaWdpbnQoXCJjaGlsZF9yZWNlaXZlZF9hdF9tc1wiLCB7bnVsbDogdHJ1ZX0pXG4gICAgICAgIGFkZGVkID0gdHJ1ZVxuICAgICAgfVxuICAgICAgaWYgKCEoYXdhaXQgdGFibGUuZ2V0Q29sdW1uQnlOYW1lKFwiY2hpbGRfc3RhcnRlZF9hdF9tc1wiKSkpIHtcbiAgICAgICAgdGFibGVEYXRhLmJpZ2ludChcImNoaWxkX3N0YXJ0ZWRfYXRfbXNcIiwge251bGw6IHRydWV9KVxuICAgICAgICBhZGRlZCA9IHRydWVcbiAgICAgIH1cbiAgICAgIGlmICghKGF3YWl0IHRhYmxlLmdldENvbHVtbkJ5TmFtZShcImNoaWxkX2luc3RhbmNlX2lkXCIpKSkge1xuICAgICAgICB0YWJsZURhdGEuc3RyaW5nKFwiY2hpbGRfaW5zdGFuY2VfaWRcIiwge251bGw6IHRydWV9KVxuICAgICAgICBhZGRlZCA9IHRydWVcbiAgICAgIH1cbiAgICAgIGlmICghKGF3YWl0IHRhYmxlLmdldENvbHVtbkJ5TmFtZShcImNoaWxkX3BpZFwiKSkpIHtcbiAgICAgICAgdGFibGVEYXRhLmludGVnZXIoXCJjaGlsZF9waWRcIiwge251bGw6IHRydWV9KVxuICAgICAgICBhZGRlZCA9IHRydWVcbiAgICAgIH1cblxuICAgICAgaWYgKGFkZGVkKSB7XG4gICAgICAgIGZvciAoY29uc3Qgc3FsIG9mIGF3YWl0IGRiLmFsdGVyVGFibGVTUUxzKHRhYmxlRGF0YSkpIGF3YWl0IGRiLnF1ZXJ5KHNxbClcbiAgICAgICAgZGIuY2xlYXJTY2hlbWFDYWNoZSgpXG4gICAgICB9XG4gICAgfSBmaW5hbGx5IHtcbiAgICAgIGF3YWl0IGRiLnJlbGVhc2VBZHZpc29yeUxvY2sobG9ja05hbWUpXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIFJlcGFpcnMgc2Vjb25kYXJ5IGluZGV4ZXMgdGhhdCBvbGRlciBhZGQtY29sdW1uIHVwZ3JhZGVzIGRlY2xhcmVkIGJ1dCBkaWRcbiAgICogbm90IGNyZWF0ZSBvbiBldmVyeSBTUUwgZHJpdmVyLiBUaGUgbWlncmF0aW9uIGxlZGdlciBrZWVwcyByb3V0aW5lIHN0b3JlXG4gICAqIHJlYWRpbmVzcyBmcm9tIHJlcGVhdGVkbHkgaW50cm9zcGVjdGluZyB0aGUgZnVsbCBpbmRleCBzZXQuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vZGF0YWJhc2UvZHJpdmVycy9iYXNlLmpzXCIpLmRlZmF1bHR9IGRiIC0gRGF0YWJhc2UgY29ubmVjdGlvbi5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgd2hlbiBhbGwgZXhwZWN0ZWQgaW5kZXhlcyBleGlzdC5cbiAgICovXG4gIGFzeW5jIF9lbnN1cmVKb2JzVGFibGVJbmRleGVzT25jZShkYikge1xuICAgIGNvbnN0IG1pZ3JhdGlvblZlcnNpb24gPSBKT0JTX0lOREVYX1JFUEFJUl9NSUdSQVRJT05fVkVSU0lPTlxuICAgIGNvbnN0IG1pZ3JhdGlvbktleSA9IHRoaXMuX21pZ3JhdGlvbktleShtaWdyYXRpb25WZXJzaW9uKVxuXG4gICAgaWYgKGF3YWl0IHRoaXMuX2hhc01pZ3JhdGlvbihkYiwgbWlncmF0aW9uVmVyc2lvbikpIHJldHVyblxuXG4gICAgY29uc3QgYWNxdWlyZWQgPSBhd2FpdCBkYi5hY3F1aXJlQWR2aXNvcnlMb2NrKG1pZ3JhdGlvbktleSlcblxuICAgIGlmICghYWNxdWlyZWQpIHRocm93IG5ldyBFcnJvcihcIkZhaWxlZCB0byBhY3F1aXJlIGJhY2tncm91bmQgam9icyBpbmRleCByZXBhaXIgbG9ja1wiKVxuXG4gICAgdHJ5IHtcbiAgICAgIGlmIChhd2FpdCB0aGlzLl9oYXNNaWdyYXRpb24oZGIsIG1pZ3JhdGlvblZlcnNpb24pKSByZXR1cm5cblxuICAgICAgZGIuY2xlYXJTY2hlbWFDYWNoZSgpXG4gICAgICBjb25zdCB0YWJsZSA9IGF3YWl0IGRiLmdldFRhYmxlQnlOYW1lT3JGYWlsKEpPQlNfVEFCTEUpXG4gICAgICBjb25zdCBpbmRleGVkQ29sdW1uTmFtZXMgPSBuZXcgU2V0KFxuICAgICAgICAoYXdhaXQgdGFibGUuZ2V0SW5kZXhlcygpKVxuICAgICAgICAgIC5maWx0ZXIoKGluZGV4KSA9PiAhaW5kZXguaXNQcmltYXJ5S2V5KCkgJiYgaW5kZXguZ2V0Q29sdW1uTmFtZXMoKS5sZW5ndGggPT09IDEpXG4gICAgICAgICAgLm1hcCgoaW5kZXgpID0+IGluZGV4LmdldENvbHVtbk5hbWVzKClbMF0pXG4gICAgICApXG5cbiAgICAgIGZvciAoY29uc3QgY29sdW1uTmFtZSBvZiBKT0JTX0lOREVYX0NPTFVNTl9OQU1FUykge1xuICAgICAgICBpZiAoaW5kZXhlZENvbHVtbk5hbWVzLmhhcyhjb2x1bW5OYW1lKSkgY29udGludWVcblxuICAgICAgICBmb3IgKGNvbnN0IHNxbCBvZiBhd2FpdCBkYi5jcmVhdGVJbmRleFNRTHMoe2NvbHVtbnM6IFtjb2x1bW5OYW1lXSwgaWZOb3RFeGlzdHM6IGRiLmdldFR5cGUoKSA9PT0gXCJzcWxpdGVcIiwgdGFibGVOYW1lOiBKT0JTX1RBQkxFfSkpIHtcbiAgICAgICAgICBhd2FpdCBkYi5xdWVyeShzcWwpXG4gICAgICAgIH1cbiAgICAgIH1cblxuICAgICAgZGIuY2xlYXJTY2hlbWFDYWNoZSgpXG4gICAgICBhd2FpdCB0aGlzLl9yZWNvcmRNaWdyYXRpb24oZGIsIG1pZ3JhdGlvblZlcnNpb24pXG4gICAgfSBmaW5hbGx5IHtcbiAgICAgIGF3YWl0IGRiLnJlbGVhc2VBZHZpc29yeUxvY2sobWlncmF0aW9uS2V5KVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBJZGVtcG90ZW50bHkgYWRkcyB0aGUgcGVyLWpvYiB3YWxsLWNsb2NrIHRpbWVvdXQgdG8gZXhpc3Rpbmcgam9iIHRhYmxlcy5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9kYXRhYmFzZS9kcml2ZXJzL2Jhc2UuanNcIikuZGVmYXVsdH0gZGIgLSBEYXRhYmFzZSBjb25uZWN0aW9uLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyB3aGVuIGVuc3VyZWQuXG4gICAqL1xuICBhc3luYyBfZW5zdXJlSm9iVGltZW91dENvbHVtbihkYikge1xuICAgIGNvbnN0IGxvY2tOYW1lID0gYCR7TUlHUkFUSU9OX1NDT1BFfTp0aW1lb3V0X21zX2NvbHVtbmBcbiAgICBjb25zdCBhY3F1aXJlZCA9IGF3YWl0IGRiLmFjcXVpcmVBZHZpc29yeUxvY2sobG9ja05hbWUpXG5cbiAgICBpZiAoIWFjcXVpcmVkKSB0aHJvdyBuZXcgRXJyb3IoXCJGYWlsZWQgdG8gYWNxdWlyZSBiYWNrZ3JvdW5kIGpvYnMgdGltZW91dCBzY2hlbWEgbG9ja1wiKVxuXG4gICAgdHJ5IHtcbiAgICAgIGRiLmNsZWFyU2NoZW1hQ2FjaGUoKVxuICAgICAgY29uc3QgdGFibGUgPSBhd2FpdCBkYi5nZXRUYWJsZUJ5TmFtZU9yRmFpbChKT0JTX1RBQkxFKVxuXG4gICAgICBpZiAoIShhd2FpdCB0YWJsZS5nZXRDb2x1bW5CeU5hbWUoXCJ0aW1lb3V0X21zXCIpKSkge1xuICAgICAgICBjb25zdCB0YWJsZURhdGEgPSBuZXcgVGFibGVEYXRhKEpPQlNfVEFCTEUpXG4gICAgICAgIHRhYmxlRGF0YS5iaWdpbnQoXCJ0aW1lb3V0X21zXCIsIHtudWxsOiB0cnVlfSlcblxuICAgICAgICBmb3IgKGNvbnN0IHNxbCBvZiBhd2FpdCBkYi5hbHRlclRhYmxlU1FMcyh0YWJsZURhdGEpKSBhd2FpdCBkYi5xdWVyeShzcWwpXG5cbiAgICAgICAgZGIuY2xlYXJTY2hlbWFDYWNoZSgpXG4gICAgICB9XG4gICAgfSBmaW5hbGx5IHtcbiAgICAgIGF3YWl0IGRiLnJlbGVhc2VBZHZpc29yeUxvY2sobG9ja05hbWUpXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIElkZW1wb3RlbnRseSBhZGRzIHRoZSBoaXN0b3JpY2FsIHN0YWJsZSBzY2hlZHVsZSBrZXkgdG8gZXhpc3Rpbmcgam9icy5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9kYXRhYmFzZS9kcml2ZXJzL2Jhc2UuanNcIikuZGVmYXVsdH0gZGIgLSBEYXRhYmFzZSBjb25uZWN0aW9uLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyB3aGVuIGVuc3VyZWQuXG4gICAqL1xuICBhc3luYyBfZW5zdXJlU2NoZWR1bGVLZXlDb2x1bW4oZGIpIHtcbiAgICBjb25zdCBsb2NrTmFtZSA9IGAke01JR1JBVElPTl9TQ09QRX06c2NoZWR1bGVfa2V5X2NvbHVtbmBcbiAgICBjb25zdCBhY3F1aXJlZCA9IGF3YWl0IGRiLmFjcXVpcmVBZHZpc29yeUxvY2sobG9ja05hbWUpXG5cbiAgICBpZiAoIWFjcXVpcmVkKSB0aHJvdyBuZXcgRXJyb3IoXCJGYWlsZWQgdG8gYWNxdWlyZSBiYWNrZ3JvdW5kIGpvYnMgc2NoZWR1bGUta2V5IHNjaGVtYSBsb2NrXCIpXG5cbiAgICB0cnkge1xuICAgICAgZGIuY2xlYXJTY2hlbWFDYWNoZSgpXG4gICAgICBjb25zdCBsb2NrZWRUYWJsZSA9IGF3YWl0IGRiLmdldFRhYmxlQnlOYW1lT3JGYWlsKEpPQlNfVEFCTEUpXG5cbiAgICAgIGlmICghKGF3YWl0IGxvY2tlZFRhYmxlLmdldENvbHVtbkJ5TmFtZShcInNjaGVkdWxlX2tleVwiKSkpIHtcbiAgICAgICAgY29uc3QgdGFibGVEYXRhID0gbmV3IFRhYmxlRGF0YShKT0JTX1RBQkxFKVxuXG4gICAgICAgIHRhYmxlRGF0YS5zdHJpbmcoXCJzY2hlZHVsZV9rZXlcIiwge251bGw6IHRydWUsIGluZGV4OiB0cnVlfSlcblxuICAgICAgICBmb3IgKGNvbnN0IHNxbCBvZiBhd2FpdCBkYi5hbHRlclRhYmxlU1FMcyh0YWJsZURhdGEpKSBhd2FpdCBkYi5xdWVyeShzcWwpXG5cbiAgICAgICAgZGIuY2xlYXJTY2hlbWFDYWNoZSgpXG4gICAgICB9XG4gICAgfSBmaW5hbGx5IHtcbiAgICAgIGF3YWl0IGRiLnJlbGVhc2VBZHZpc29yeUxvY2sobG9ja05hbWUpXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIElkZW1wb3RlbnRseSBhZGRzIG1vbm90b25pYyBzY2hlZHVsZSBvd25lcnNoaXAgaGlzdG9yeSBhbmQgaXRzIGxvb2t1cCBpbmRleC5cbiAgICogRXhpc3Rpbmcgcm93cyByZW1haW4gbnVsbCBhbmQgdXNlIHRoZSBkb2N1bWVudGVkIGxlZ2FjeSBmYWxsYmFjayBvcmRlcmluZy5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9kYXRhYmFzZS9kcml2ZXJzL2Jhc2UuanNcIikuZGVmYXVsdH0gZGIgLSBEYXRhYmFzZSBjb25uZWN0aW9uLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyB3aGVuIGVuc3VyZWQuXG4gICAqL1xuICBhc3luYyBfZW5zdXJlU2NoZWR1bGVPcmRlckNvbHVtbihkYikge1xuICAgIGNvbnN0IGxvY2tOYW1lID0gYCR7TUlHUkFUSU9OX1NDT1BFfTpzY2hlZHVsZV9vcmRlcl9jb2x1bW5gXG4gICAgY29uc3QgYWNxdWlyZWQgPSBhd2FpdCBkYi5hY3F1aXJlQWR2aXNvcnlMb2NrKGxvY2tOYW1lKVxuXG4gICAgaWYgKCFhY3F1aXJlZCkgdGhyb3cgbmV3IEVycm9yKFwiRmFpbGVkIHRvIGFjcXVpcmUgYmFja2dyb3VuZCBqb2JzIHNjaGVkdWxlLW9yZGVyIHNjaGVtYSBsb2NrXCIpXG5cbiAgICB0cnkge1xuICAgICAgZGIuY2xlYXJTY2hlbWFDYWNoZSgpXG4gICAgICBsZXQgdGFibGUgPSBhd2FpdCBkYi5nZXRUYWJsZUJ5TmFtZU9yRmFpbChKT0JTX1RBQkxFKVxuXG4gICAgICBpZiAoIShhd2FpdCB0YWJsZS5nZXRDb2x1bW5CeU5hbWUoXCJzY2hlZHVsZV9vcmRlclwiKSkpIHtcbiAgICAgICAgY29uc3QgdGFibGVEYXRhID0gbmV3IFRhYmxlRGF0YShKT0JTX1RBQkxFKVxuXG4gICAgICAgIHRhYmxlRGF0YS5iaWdpbnQoXCJzY2hlZHVsZV9vcmRlclwiLCB7bnVsbDogdHJ1ZX0pXG4gICAgICAgIGZvciAoY29uc3Qgc3FsIG9mIGF3YWl0IGRiLmFsdGVyVGFibGVTUUxzKHRhYmxlRGF0YSkpIGF3YWl0IGRiLnF1ZXJ5KHNxbClcbiAgICAgICAgZGIuY2xlYXJTY2hlbWFDYWNoZSgpXG4gICAgICAgIHRhYmxlID0gYXdhaXQgZGIuZ2V0VGFibGVCeU5hbWVPckZhaWwoSk9CU19UQUJMRSlcbiAgICAgIH1cblxuICAgICAgY29uc3QgaW5kZXhOYW1lcyA9IG5ldyBTZXQoKGF3YWl0IHRhYmxlLmdldEluZGV4ZXMoKSkubWFwKChpbmRleCkgPT4gaW5kZXguZ2V0TmFtZSgpKSlcblxuICAgICAgaWYgKCFpbmRleE5hbWVzLmhhcyhTQ0hFRFVMRV9ISVNUT1JZX09SREVSX0lOREVYKSkge1xuICAgICAgICBjb25zdCBzcWxzID0gYXdhaXQgZGIuY3JlYXRlSW5kZXhTUUxzKHtcbiAgICAgICAgICBjb2x1bW5zOiBbXCJzY2hlZHVsZV9rZXlcIiwgXCJzY2hlZHVsZV9vcmRlclwiLCBcImNyZWF0ZWRfYXRfbXNcIiwgXCJpZFwiXSxcbiAgICAgICAgICBpZk5vdEV4aXN0czogZGIuZ2V0VHlwZSgpID09PSBcInNxbGl0ZVwiLFxuICAgICAgICAgIG5hbWU6IFNDSEVEVUxFX0hJU1RPUllfT1JERVJfSU5ERVgsXG4gICAgICAgICAgdGFibGVOYW1lOiBKT0JTX1RBQkxFXG4gICAgICAgIH0pXG5cbiAgICAgICAgZm9yIChjb25zdCBzcWwgb2Ygc3FscykgYXdhaXQgZGIucXVlcnkoc3FsKVxuICAgICAgICBkYi5jbGVhclNjaGVtYUNhY2hlKClcbiAgICAgIH1cbiAgICB9IGZpbmFsbHkge1xuICAgICAgYXdhaXQgZGIucmVsZWFzZUFkdmlzb3J5TG9jayhsb2NrTmFtZSlcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogQ3JlYXRlcyB0aGUgcmV0ZW50aW9uLWluZGVwZW5kZW50IHNjaGVkdWxlLW9yZGVyIGhpZ2gtd2F0ZXIgdGFibGUgYW5kXG4gICAqIGluaXRpYWxpemVzIGl0IGZyb20gdGhlIGdyZWF0ZXN0IHJldGFpbmVkIG9yZGVyZWQgcm93IGZvciBldmVyeSBrZXkuXG4gICAqIExlZ2FjeSByb3dzIHdob3NlIG9yZGVyIGlzIG51bGwgZGVsaWJlcmF0ZWx5IGRvIG5vdCBlc3RhYmxpc2ggYSB3YXRlcm1hcmsuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vZGF0YWJhc2UvZHJpdmVycy9iYXNlLmpzXCIpLmRlZmF1bHR9IGRiIC0gRGF0YWJhc2UgY29ubmVjdGlvbi5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgd2hlbiBlbnN1cmVkIGFuZCBiYWNrZmlsbGVkLlxuICAgKi9cbiAgYXN5bmMgX2Vuc3VyZVNjaGVkdWxlT3JkZXJXYXRlcm1hcmtzVGFibGUoZGIpIHtcbiAgICBjb25zdCBtaWdyYXRpb25WZXJzaW9uID0gU0NIRURVTEVfT1JERVJfV0FURVJNQVJLX01JR1JBVElPTl9WRVJTSU9OXG4gICAgY29uc3QgbWlncmF0aW9uS2V5ID0gdGhpcy5fbWlncmF0aW9uS2V5KG1pZ3JhdGlvblZlcnNpb24pXG4gICAgY29uc3QgdGFibGVFeGlzdHMgPSBhd2FpdCBkYi50YWJsZUV4aXN0cyhTQ0hFRFVMRV9PUkRFUl9XQVRFUk1BUktTX1RBQkxFKVxuXG4gICAgaWYgKHRhYmxlRXhpc3RzICYmIGF3YWl0IHRoaXMuX2hhc01pZ3JhdGlvbihkYiwgbWlncmF0aW9uVmVyc2lvbikpIHJldHVyblxuXG4gICAgY29uc3QgYWNxdWlyZWQgPSBhd2FpdCBkYi5hY3F1aXJlQWR2aXNvcnlMb2NrKG1pZ3JhdGlvbktleSlcblxuICAgIGlmICghYWNxdWlyZWQpIHRocm93IG5ldyBFcnJvcihcIkZhaWxlZCB0byBhY3F1aXJlIGJhY2tncm91bmQgam9icyBzY2hlZHVsZS1vcmRlciB3YXRlcm1hcmsgc2NoZW1hIGxvY2tcIilcblxuICAgIHRyeSB7XG4gICAgICBkYi5jbGVhclNjaGVtYUNhY2hlKClcbiAgICAgIGNvbnN0IGxvY2tlZFRhYmxlRXhpc3RzID0gYXdhaXQgZGIudGFibGVFeGlzdHMoU0NIRURVTEVfT1JERVJfV0FURVJNQVJLU19UQUJMRSlcbiAgICAgIGNvbnN0IGFscmVhZHlBcHBsaWVkID0gYXdhaXQgdGhpcy5faGFzTWlncmF0aW9uKGRiLCBtaWdyYXRpb25WZXJzaW9uKVxuXG4gICAgICBpZiAoIWxvY2tlZFRhYmxlRXhpc3RzKSB7XG4gICAgICAgIGNvbnN0IHRhYmxlID0gbmV3IFRhYmxlRGF0YShTQ0hFRFVMRV9PUkRFUl9XQVRFUk1BUktTX1RBQkxFLCB7aWZOb3RFeGlzdHM6IHRydWV9KVxuXG4gICAgICAgIHRhYmxlLnN0cmluZyhcInNjaGVkdWxlX2tleVwiLCB7cHJpbWFyeUtleTogdHJ1ZX0pXG4gICAgICAgIHRhYmxlLmJpZ2ludChcImhpZ2hfd2F0ZXJfbWFya1wiLCB7bnVsbDogZmFsc2V9KVxuICAgICAgICBhd2FpdCBkYi5jcmVhdGVUYWJsZSh0YWJsZSlcbiAgICAgICAgZGIuY2xlYXJTY2hlbWFDYWNoZSgpXG4gICAgICB9XG5cbiAgICAgIC8vIFJlYnVpbGQgYSBtaXNzaW5nIHRhYmxlIGV2ZW4gd2hlbiBpdHMgbWlncmF0aW9uIGxlZGdlciBzdXJ2aXZlZC4gVGhlXG4gICAgICAvLyByZXRhaW5lZCBqb2Igcm93cyBhcmUgdGhlIG9ubHkgY29tcGF0aWJsZSBzb3VyY2UgZm9yIHRoYXQgcmVjb3Zlcnk7XG4gICAgICAvLyBvbmNlIHJvd3MgYXJlIHBydW5lZCwgbm9ybWFsIHNjaGVtYSBkdXJhYmlsaXR5IHByb3RlY3RzIHRoZSB3YXRlcm1hcmsuXG4gICAgICBpZiAoIWxvY2tlZFRhYmxlRXhpc3RzIHx8ICFhbHJlYWR5QXBwbGllZCkgYXdhaXQgdGhpcy5fYmFja2ZpbGxTY2hlZHVsZU9yZGVyV2F0ZXJtYXJrcyhkYilcbiAgICAgIGlmICghYWxyZWFkeUFwcGxpZWQpIGF3YWl0IHRoaXMuX3JlY29yZE1pZ3JhdGlvbihkYiwgbWlncmF0aW9uVmVyc2lvbilcbiAgICB9IGZpbmFsbHkge1xuICAgICAgYXdhaXQgZGIucmVsZWFzZUFkdmlzb3J5TG9jayhtaWdyYXRpb25LZXkpXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIEJhY2tmaWxscyBlYWNoIGtleSBmcm9tIGl0cyBncmVhdGVzdCByZXRhaW5lZCBub24tbGVnYWN5IG93bmVyc2hpcCBvcmRlci5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9kYXRhYmFzZS9kcml2ZXJzL2Jhc2UuanNcIikuZGVmYXVsdH0gZGIgLSBEYXRhYmFzZSBjb25uZWN0aW9uLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyBhZnRlciBhbGwgcmV0YWluZWQga2V5cyBhcmUgcmVwcmVzZW50ZWQuXG4gICAqL1xuICBhc3luYyBfYmFja2ZpbGxTY2hlZHVsZU9yZGVyV2F0ZXJtYXJrcyhkYikge1xuICAgIGNvbnN0IGtleVJvd3MgPSBhd2FpdCBkYlxuICAgICAgLm5ld1F1ZXJ5KClcbiAgICAgIC5mcm9tKEpPQlNfVEFCTEUpXG4gICAgICAuc2VsZWN0KFwic2NoZWR1bGVfa2V5XCIpXG4gICAgICAud2hlcmVOb3Qoe3NjaGVkdWxlX2tleTogbnVsbH0pXG4gICAgICAud2hlcmVOb3Qoe3NjaGVkdWxlX29yZGVyOiBudWxsfSlcbiAgICAgIC5kaXN0aW5jdCgpXG4gICAgICAucmVzdWx0cygpXG5cbiAgICBmb3IgKGNvbnN0IGtleVJvdyBvZiBrZXlSb3dzKSB7XG4gICAgICBjb25zdCBzY2hlZHVsZUtleSA9IFN0cmluZygvKiogQHR5cGUge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gKi8gKGtleVJvdykuc2NoZWR1bGVfa2V5KVxuICAgICAgY29uc3QgcmV0YWluZWRPcmRlciA9IGF3YWl0IHRoaXMuX2dyZWF0ZXN0UmV0YWluZWRTY2hlZHVsZU9yZGVyKGRiLCBzY2hlZHVsZUtleSlcbiAgICAgIGNvbnN0IGN1cnJlbnRXYXRlcm1hcmsgPSBhd2FpdCB0aGlzLl9zY2hlZHVsZU9yZGVyV2F0ZXJtYXJrKGRiLCBzY2hlZHVsZUtleSlcblxuICAgICAgaWYgKHJldGFpbmVkT3JkZXIgPT09IG51bGwpIGNvbnRpbnVlXG4gICAgICBpZiAoY3VycmVudFdhdGVybWFyayAhPT0gbnVsbCAmJiBjdXJyZW50V2F0ZXJtYXJrID49IHJldGFpbmVkT3JkZXIpIGNvbnRpbnVlXG4gICAgICBhd2FpdCB0aGlzLl93cml0ZVNjaGVkdWxlT3JkZXJXYXRlcm1hcmsoZGIsIHtzY2hlZHVsZUtleSwgc2NoZWR1bGVPcmRlcjogcmV0YWluZWRPcmRlcn0pXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIElkZW1wb3RlbnRseSBhZGRzIHRoZSBgcXVldWVgIGNvbHVtbiB0byBhbiBleGlzdGluZyBqb2JzIHRhYmxlLiBFeGlzdGluZ1xuICAgKiByb3dzIHJlYWQgYmFjayBhcyB0aGUgZGVmYXVsdCBxdWV1ZSAoc2VlIHtAbGluayBfbm9ybWFsaXplSm9iUm93fSksIHNvIG5vXG4gICAqIGRhdGEgYmFja2ZpbGwgaXMgcmVxdWlyZWQuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vZGF0YWJhc2UvZHJpdmVycy9iYXNlLmpzXCIpLmRlZmF1bHR9IGRiIC0gRGF0YWJhc2UgY29ubmVjdGlvbi5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgd2hlbiBlbnN1cmVkLlxuICAgKi9cbiAgYXN5bmMgX2Vuc3VyZVF1ZXVlQ29sdW1uKGRiKSB7XG4gICAgY29uc3QgbG9ja05hbWUgPSBgJHtNSUdSQVRJT05fU0NPUEV9OnF1ZXVlX2NvbHVtbmBcbiAgICBjb25zdCBhY3F1aXJlZCA9IGF3YWl0IGRiLmFjcXVpcmVBZHZpc29yeUxvY2sobG9ja05hbWUpXG5cbiAgICBpZiAoIWFjcXVpcmVkKSB0aHJvdyBuZXcgRXJyb3IoXCJGYWlsZWQgdG8gYWNxdWlyZSBiYWNrZ3JvdW5kIGpvYnMgcXVldWUgc2NoZW1hIGxvY2tcIilcblxuICAgIHRyeSB7XG4gICAgICAvLyBTUUwgU2VydmVyIHNjaGVtYSByZWFkcyBjYW4gZGVhZGxvY2sgd2l0aCBhIGNvbmN1cnJlbnQgQUxURVIgVEFCTEUsIHNvXG4gICAgICAvLyBhY3F1aXJlIHRoZSBsb2NrIGJlZm9yZSBpbnNwZWN0aW5nIHRoZSBjb2x1bW4gcmF0aGVyIHRoYW4gb25seVxuICAgICAgLy8gcHJvdGVjdGluZyB0aGUgbXV0YXRpb24gKG1pcnJvcnMgdGhlIGNvbmN1cnJlbmN5LWNvbHVtbiBtaWdyYXRpb24pLlxuICAgICAgZGIuY2xlYXJTY2hlbWFDYWNoZSgpXG4gICAgICBjb25zdCBsb2NrZWRUYWJsZSA9IGF3YWl0IGRiLmdldFRhYmxlQnlOYW1lT3JGYWlsKEpPQlNfVEFCTEUpXG5cbiAgICAgIGlmICghKGF3YWl0IGxvY2tlZFRhYmxlLmdldENvbHVtbkJ5TmFtZShcInF1ZXVlXCIpKSkge1xuICAgICAgICBjb25zdCB0YWJsZURhdGEgPSBuZXcgVGFibGVEYXRhKEpPQlNfVEFCTEUpXG5cbiAgICAgICAgdGFibGVEYXRhLnN0cmluZyhcInF1ZXVlXCIsIHtudWxsOiB0cnVlLCBpbmRleDogdHJ1ZX0pXG5cbiAgICAgICAgZm9yIChjb25zdCBzcWwgb2YgYXdhaXQgZGIuYWx0ZXJUYWJsZVNRTHModGFibGVEYXRhKSkgYXdhaXQgZGIucXVlcnkoc3FsKVxuXG4gICAgICAgIGRiLmNsZWFyU2NoZW1hQ2FjaGUoKVxuICAgICAgfVxuICAgIH0gZmluYWxseSB7XG4gICAgICBhd2FpdCBkYi5yZWxlYXNlQWR2aXNvcnlMb2NrKGxvY2tOYW1lKVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGJhY2tmaWxsIGV4ZWN1dGlvbiBtb2RlcyBvbmNlLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL2RhdGFiYXNlL2RyaXZlcnMvYmFzZS5qc1wiKS5kZWZhdWx0fSBkYiAtIERhdGFiYXNlIGNvbm5lY3Rpb24uXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIHdoZW4gY29tcGxldGUuXG4gICAqL1xuICBhc3luYyBfYmFja2ZpbGxFeGVjdXRpb25Nb2Rlc09uY2UoZGIpIHtcbiAgICBjb25zdCBtaWdyYXRpb25WZXJzaW9uID0gRVhFQ1VUSU9OX01PREVfQkFDS0ZJTExfTUlHUkFUSU9OX1ZFUlNJT05cbiAgICBjb25zdCBtaWdyYXRpb25LZXkgPSB0aGlzLl9taWdyYXRpb25LZXkobWlncmF0aW9uVmVyc2lvbilcblxuICAgIGlmIChhd2FpdCB0aGlzLl9oYXNNaWdyYXRpb24oZGIsIG1pZ3JhdGlvblZlcnNpb24pKSByZXR1cm5cblxuICAgIGF3YWl0IGRiLmFjcXVpcmVBZHZpc29yeUxvY2sobWlncmF0aW9uS2V5KVxuXG4gICAgdHJ5IHtcbiAgICAgIGlmIChhd2FpdCB0aGlzLl9oYXNNaWdyYXRpb24oZGIsIG1pZ3JhdGlvblZlcnNpb24pKSByZXR1cm5cblxuICAgICAgLy8gQSB0YWJsZSBjcmVhdGVkIGFmdGVyIHRoZSBgZm9ya2VkYCBjb2x1bW4gd2FzIGRyb3BwZWQgaGFzIG5vdGhpbmcgdG9cbiAgICAgIC8vIGJhY2tmaWxsIGZyb207IHJlY29yZCB0aGUgbWlncmF0aW9uIHNvIGl0IGlzIG5vdCByZS1hdHRlbXB0ZWQuXG4gICAgICBkYi5jbGVhclNjaGVtYUNhY2hlKClcbiAgICAgIGlmICghKGF3YWl0IChhd2FpdCBkYi5nZXRUYWJsZUJ5TmFtZU9yRmFpbChKT0JTX1RBQkxFKSkuZ2V0Q29sdW1uQnlOYW1lKFwiZm9ya2VkXCIpKSkge1xuICAgICAgICBhd2FpdCB0aGlzLl9yZWNvcmRNaWdyYXRpb24oZGIsIG1pZ3JhdGlvblZlcnNpb24pXG4gICAgICAgIHJldHVyblxuICAgICAgfVxuXG4gICAgICBjb25zdCB0YWJsZU5hbWVTcWwgPSBkYi5xdW90ZVRhYmxlKEpPQlNfVEFCTEUpXG4gICAgICBjb25zdCBmb3JrZWRDb2x1bW5TcWwgPSBkYi5xdW90ZUNvbHVtbihcImZvcmtlZFwiKVxuICAgICAgY29uc3QgZXhlY3V0aW9uTW9kZUNvbHVtblNxbCA9IGRiLnF1b3RlQ29sdW1uKFwiZXhlY3V0aW9uX21vZGVcIilcblxuICAgICAgYXdhaXQgZGIucXVlcnkoXG4gICAgICAgIGBVUERBVEUgJHt0YWJsZU5hbWVTcWx9IFNFVCAke2V4ZWN1dGlvbk1vZGVDb2x1bW5TcWx9ID0gJHtkYi5xdW90ZShcImZvcmtlZFwiKX0gYCArXG4gICAgICAgIGBXSEVSRSAke2ZvcmtlZENvbHVtblNxbH0gPSAke2RiLnF1b3RlKHRydWUpfSBBTkQgJHtleGVjdXRpb25Nb2RlQ29sdW1uU3FsfSBJUyBOVUxMYFxuICAgICAgKVxuICAgICAgYXdhaXQgZGIucXVlcnkoXG4gICAgICAgIGBVUERBVEUgJHt0YWJsZU5hbWVTcWx9IFNFVCAke2V4ZWN1dGlvbk1vZGVDb2x1bW5TcWx9ID0gJHtkYi5xdW90ZShcImlubGluZVwiKX0gYCArXG4gICAgICAgIGBXSEVSRSAke2ZvcmtlZENvbHVtblNxbH0gPSAke2RiLnF1b3RlKGZhbHNlKX0gQU5EICR7ZXhlY3V0aW9uTW9kZUNvbHVtblNxbH0gSVMgTlVMTGBcbiAgICAgIClcblxuICAgICAgYXdhaXQgdGhpcy5fcmVjb3JkTWlncmF0aW9uKGRiLCBtaWdyYXRpb25WZXJzaW9uKVxuICAgIH0gZmluYWxseSB7XG4gICAgICBhd2FpdCBkYi5yZWxlYXNlQWR2aXNvcnlMb2NrKG1pZ3JhdGlvbktleSlcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogUmV3cml0ZXMgcHJlLWV4aXN0aW5nIHBvb2xlZCByb3dzIChwZXJzaXN0ZWQgYXMgYGV4ZWN1dGlvbl9tb2RlID0gXCJmb3JrZWRcImBcbiAgICogcGx1cyBhIGB2ZWxvY2lvdXMtcG9vbGVkOipgIGhhbmRvZmYgbWFya2VyKSB0byBgZXhlY3V0aW9uX21vZGUgPSBcInBvb2xlZFwiYCxcbiAgICogY2xlYXJzIHRoZSBxdWV1ZWQgbWFya2VyLCB0aGVuIGRyb3BzIHRoZSBub3ctcmVkdW5kYW50IGBmb3JrZWRgIGNvbHVtbiBzb1xuICAgKiBgZXhlY3V0aW9uX21vZGVgIGlzIHRoZSBzaW5nbGUgc291cmNlIG9mIHRydXRoLiBSdW5zIG9uY2UsIGd1YXJkZWQgYnkgdGhlXG4gICAqIG1pZ3JhdGlvbiBsZWRnZXIgYW5kIGEgcGVyLWtleSBhZHZpc29yeSBsb2NrOyBhIGZyZXNoIHRhYmxlIChjcmVhdGVkIHdpdGhvdXRcbiAgICogdGhlIGNvbHVtbikgc2hvcnQtY2lyY3VpdHMuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vZGF0YWJhc2UvZHJpdmVycy9iYXNlLmpzXCIpLmRlZmF1bHR9IGRiIC0gRGF0YWJhc2UgY29ubmVjdGlvbi5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgd2hlbiBjb21wbGV0ZS5cbiAgICovXG4gIGFzeW5jIF9kcm9wRm9ya2VkQ29sdW1uT25jZShkYikge1xuICAgIGNvbnN0IG1pZ3JhdGlvblZlcnNpb24gPSBEUk9QX0ZPUktFRF9DT0xVTU5fTUlHUkFUSU9OX1ZFUlNJT05cbiAgICBjb25zdCBtaWdyYXRpb25LZXkgPSB0aGlzLl9taWdyYXRpb25LZXkobWlncmF0aW9uVmVyc2lvbilcblxuICAgIGlmIChhd2FpdCB0aGlzLl9oYXNNaWdyYXRpb24oZGIsIG1pZ3JhdGlvblZlcnNpb24pKSByZXR1cm5cblxuICAgIGF3YWl0IGRiLmFjcXVpcmVBZHZpc29yeUxvY2sobWlncmF0aW9uS2V5KVxuXG4gICAgdHJ5IHtcbiAgICAgIGlmIChhd2FpdCB0aGlzLl9oYXNNaWdyYXRpb24oZGIsIG1pZ3JhdGlvblZlcnNpb24pKSByZXR1cm5cblxuICAgICAgZGIuY2xlYXJTY2hlbWFDYWNoZSgpXG5cbiAgICAgIGlmIChhd2FpdCAoYXdhaXQgZGIuZ2V0VGFibGVCeU5hbWVPckZhaWwoSk9CU19UQUJMRSkpLmdldENvbHVtbkJ5TmFtZShcImZvcmtlZFwiKSkge1xuICAgICAgICBjb25zdCB0YWJsZU5hbWVTcWwgPSBkYi5xdW90ZVRhYmxlKEpPQlNfVEFCTEUpXG4gICAgICAgIGNvbnN0IGV4ZWN1dGlvbk1vZGVDb2x1bW5TcWwgPSBkYi5xdW90ZUNvbHVtbihcImV4ZWN1dGlvbl9tb2RlXCIpXG4gICAgICAgIGNvbnN0IGhhbmRvZmZJZENvbHVtblNxbCA9IGRiLnF1b3RlQ29sdW1uKFwiaGFuZG9mZl9pZFwiKVxuXG4gICAgICAgIC8vIFBvb2xlZCByb3dzIHVzZWQgdG8gcGVyc2lzdCBhcyBleGVjdXRpb25fbW9kZSBcImZvcmtlZFwiICsgYSBwb29sZWQgaGFuZG9mZlxuICAgICAgICAvLyBtYXJrZXI7IHJlY292ZXIgdGhlaXIgcmVhbCBtb2RlIGJlZm9yZSB0aGUgbWFya2VyIGlzIGNsZWFyZWQuXG4gICAgICAgIGF3YWl0IGRiLnF1ZXJ5KFxuICAgICAgICAgIGBVUERBVEUgJHt0YWJsZU5hbWVTcWx9IFNFVCAke2V4ZWN1dGlvbk1vZGVDb2x1bW5TcWx9ID0gJHtkYi5xdW90ZShcInBvb2xlZFwiKX0gYCArXG4gICAgICAgICAgYFdIRVJFICR7ZXhlY3V0aW9uTW9kZUNvbHVtblNxbH0gPSAke2RiLnF1b3RlKFwiZm9ya2VkXCIpfSBgICtcbiAgICAgICAgICBgQU5EICR7aGFuZG9mZklkQ29sdW1uU3FsfSBMSUtFICR7ZGIucXVvdGUoYCR7TEVHQUNZX1BPT0xFRF9IQU5ET0ZGX0lEX1BSRUZJWH0lYCl9YFxuICAgICAgICApXG4gICAgICAgIC8vIFRoZSBxdWV1ZWQtcG9vbGVkIG1hcmtlciB3YXMgYSBzZW50aW5lbCwgbm90IGEgcmVhbCBsZWFzZTsgY2xlYXIgaXQuXG4gICAgICAgIGF3YWl0IGRiLnF1ZXJ5KFxuICAgICAgICAgIGBVUERBVEUgJHt0YWJsZU5hbWVTcWx9IFNFVCAke2hhbmRvZmZJZENvbHVtblNxbH0gPSBOVUxMIGAgK1xuICAgICAgICAgIGBXSEVSRSAke2hhbmRvZmZJZENvbHVtblNxbH0gPSAke2RiLnF1b3RlKExFR0FDWV9QT09MRURfUVVFVUVEX0hBTkRPRkZfSUQpfWBcbiAgICAgICAgKVxuXG4gICAgICAgIGNvbnN0IGRyb3BGb3JrZWQgPSBuZXcgVGFibGVEYXRhKEpPQlNfVEFCTEUpXG4gICAgICAgIGRyb3BGb3JrZWQuYWRkQ29sdW1uKFwiZm9ya2VkXCIsIHtkcm9wQ29sdW1uOiB0cnVlfSlcbiAgICAgICAgZm9yIChjb25zdCBzcWwgb2YgYXdhaXQgZGIuYWx0ZXJUYWJsZVNRTHMoZHJvcEZvcmtlZCkpIGF3YWl0IGRiLnF1ZXJ5KHNxbClcblxuICAgICAgICBkYi5jbGVhclNjaGVtYUNhY2hlKClcbiAgICAgIH1cblxuICAgICAgYXdhaXQgdGhpcy5fcmVjb3JkTWlncmF0aW9uKGRiLCBtaWdyYXRpb25WZXJzaW9uKVxuICAgIH0gZmluYWxseSB7XG4gICAgICBhd2FpdCBkYi5yZWxlYXNlQWR2aXNvcnlMb2NrKG1pZ3JhdGlvbktleSlcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogUnVucyByZWNvcmQgbWlncmF0aW9uLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL2RhdGFiYXNlL2RyaXZlcnMvYmFzZS5qc1wiKS5kZWZhdWx0fSBkYiAtIERhdGFiYXNlIGNvbm5lY3Rpb24uXG4gICAqIEBwYXJhbSB7c3RyaW5nfSB2ZXJzaW9uIC0gTWlncmF0aW9uIHZlcnNpb24uXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIHdoZW4gY29tcGxldGUuXG4gICAqL1xuICBhc3luYyBfcmVjb3JkTWlncmF0aW9uKGRiLCB2ZXJzaW9uKSB7XG4gICAgYXdhaXQgZGIudXBzZXJ0KHtcbiAgICAgIHRhYmxlTmFtZTogTUlHUkFUSU9OU19UQUJMRSxcbiAgICAgIGRhdGE6IHtcbiAgICAgICAga2V5OiB0aGlzLl9taWdyYXRpb25LZXkodmVyc2lvbiksXG4gICAgICAgIHNjb3BlOiBNSUdSQVRJT05fU0NPUEUsXG4gICAgICAgIHZlcnNpb24sXG4gICAgICAgIGFwcGxpZWRfYXRfbXM6IERhdGUubm93KClcbiAgICAgIH0sXG4gICAgICBjb25mbGljdENvbHVtbnM6IFtcImtleVwiXSxcbiAgICAgIHVwZGF0ZUNvbHVtbnM6IFtcInNjb3BlXCIsIFwidmVyc2lvblwiLCBcImFwcGxpZWRfYXRfbXNcIl1cbiAgICB9KVxuICB9XG5cbiAgYXN5bmMgX2luaXRpYWxpemVNb2RlbCgpIHtcbiAgICBpZiAoQmFja2dyb3VuZEpvYlJlY29yZC5pc0luaXRpYWxpemVkKCkpIHJldHVyblxuXG4gICAgQmFja2dyb3VuZEpvYlJlY29yZC5zZXREYXRhYmFzZUlkZW50aWZpZXIodGhpcy5nZXREYXRhYmFzZUlkZW50aWZpZXIoKSlcbiAgICBjb25zdCBwb29sID0gdGhpcy5jb25maWd1cmF0aW9uLmdldERhdGFiYXNlUG9vbCh0aGlzLmdldERhdGFiYXNlSWRlbnRpZmllcigpKVxuXG4gICAgYXdhaXQgcG9vbC53aXRoQ29ubmVjdGlvbih7bmFtZTogXCJCYWNrZ3JvdW5kIGpvYnMgc3RvcmUgaW5pdGlhbGl6ZSBtb2RlbFwifSwgYXN5bmMgKCkgPT4ge1xuICAgICAgYXdhaXQgQmFja2dyb3VuZEpvYlJlY29yZC5pbml0aWFsaXplUmVjb3JkKHtjb25maWd1cmF0aW9uOiB0aGlzLmNvbmZpZ3VyYXRpb259KVxuICAgIH0pXG4gIH1cblxuICAvKipcbiAgICogUnVucyBnZXQgam9iIHJvdyBieSBpZC5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9kYXRhYmFzZS9kcml2ZXJzL2Jhc2UuanNcIikuZGVmYXVsdH0gZGIgLSBEYXRhYmFzZSBjb25uZWN0aW9uLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gam9iSWQgLSBKb2IgaWQuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPGltcG9ydChcIi4vdHlwZXMuanNcIikuQmFja2dyb3VuZEpvYlJvdyB8IG51bGw+fSAtIEpvYiByb3cuXG4gICAqL1xuICBhc3luYyBfZ2V0Sm9iUm93QnlJZChkYiwgam9iSWQpIHtcbiAgICBjb25zdCBxdWVyeSA9IGRiXG4gICAgICAubmV3UXVlcnkoKVxuICAgICAgLmZyb20oSk9CU19UQUJMRSlcbiAgICAgIC53aGVyZSh7aWQ6IGpvYklkfSlcbiAgICAgIC5saW1pdCgxKVxuXG4gICAgY29uc3Qgcm93cyA9IGF3YWl0IHF1ZXJ5LnJlc3VsdHMoKVxuXG4gICAgaWYgKCFyb3dzWzBdKSByZXR1cm4gbnVsbFxuXG4gICAgcmV0dXJuIHRoaXMuX25vcm1hbGl6ZUpvYlJvdyhyb3dzWzBdKVxuICB9XG5cbiAgLyoqXG4gICAqIFJlYWRzIHRoZSBqb2IgY3VycmVudGx5IG5hbWVkIGJ5IG9uZSBzdGFibGUgb3duZXIgcm93LlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL2RhdGFiYXNlL2RyaXZlcnMvYmFzZS5qc1wiKS5kZWZhdWx0fSBkYiAtIERhdGFiYXNlIGNvbm5lY3Rpb24uXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBzY2hlZHVsZUtleSAtIFZhbGlkYXRlZCBzdGFibGUgc2NoZWR1bGUga2V5LlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxpbXBvcnQoXCIuL3R5cGVzLmpzXCIpLkJhY2tncm91bmRKb2JSb3cgfCBudWxsPn0gLSBOb3JtYWxpemVkIG93bmVyIGpvYi5cbiAgICovXG4gIGFzeW5jIF9zY2hlZHVsZWRPd25lckpvYihkYiwgc2NoZWR1bGVLZXkpIHtcbiAgICBjb25zdCBvd25lclJvd3MgPSBhd2FpdCBkYlxuICAgICAgLm5ld1F1ZXJ5KClcbiAgICAgIC5mcm9tKFNDSEVEVUxFX0tFWVNfVEFCTEUpXG4gICAgICAud2hlcmUoe3NjaGVkdWxlX2tleTogc2NoZWR1bGVLZXl9KVxuICAgICAgLmxpbWl0KDEpXG4gICAgICAucmVzdWx0cygpXG4gICAgY29uc3Qgb3duZXJSb3cgPSBvd25lclJvd3NbMF1cblxuICAgIGlmICghb3duZXJSb3cpIHJldHVybiBudWxsXG5cbiAgICByZXR1cm4gYXdhaXQgdGhpcy5fZ2V0Sm9iUm93QnlJZChkYiwgU3RyaW5nKG93bmVyUm93LmpvYl9pZCkpXG4gIH1cblxuICAvKipcbiAgICogQXNzaWducyB0aGUgbmV4dCBvd25lcnNoaXAgb3JkZXIgd2hpbGUgdGhlIGNhbGxlciBob2xkcyB0aGUgc2NoZWR1bGUta2V5XG4gICAqIGFkdmlzb3J5IGxvY2sgYW5kIGNvdW50LXJldmlzaW9uIHRyYW5zYWN0aW9uIGZlbmNlLiBUaGUgaW5kZXBlbmRlbnRcbiAgICogd2F0ZXJtYXJrIHN1cnZpdmVzIGJvdGggb3duZXJzaGlwIHJlbGVhc2UgYW5kIHRlcm1pbmFsLWhpc3RvcnkgcHJ1bmluZy5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9kYXRhYmFzZS9kcml2ZXJzL2Jhc2UuanNcIikuZGVmYXVsdH0gZGIgLSBEYXRhYmFzZSBjb25uZWN0aW9uLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gc2NoZWR1bGVLZXkgLSBWYWxpZGF0ZWQgc3RhYmxlIHNjaGVkdWxlIGtleS5cbiAgICogQHJldHVybnMge1Byb21pc2U8bnVtYmVyPn0gLSBOZXh0IG1vbm90b25pYyBvd25lcnNoaXAgb3JkZXIuXG4gICAqL1xuICBhc3luYyBfbmV4dFNjaGVkdWxlT3JkZXIoZGIsIHNjaGVkdWxlS2V5KSB7XG4gICAgY29uc3QgZHVyYWJsZU9yZGVyID0gYXdhaXQgdGhpcy5fc2NoZWR1bGVPcmRlcldhdGVybWFyayhkYiwgc2NoZWR1bGVLZXkpXG4gICAgY29uc3QgcmV0YWluZWRPcmRlciA9IGF3YWl0IHRoaXMuX2dyZWF0ZXN0UmV0YWluZWRTY2hlZHVsZU9yZGVyKGRiLCBzY2hlZHVsZUtleSlcbiAgICBsZXQgY3VycmVudE9yZGVyID0gZHVyYWJsZU9yZGVyXG5cbiAgICBpZiAocmV0YWluZWRPcmRlciAhPT0gbnVsbCAmJiAoY3VycmVudE9yZGVyID09PSBudWxsIHx8IHJldGFpbmVkT3JkZXIgPiBjdXJyZW50T3JkZXIpKSBjdXJyZW50T3JkZXIgPSByZXRhaW5lZE9yZGVyXG4gICAgY29uc3QgbmV4dE9yZGVyID0gY3VycmVudE9yZGVyID09PSBudWxsID8gMSA6IGN1cnJlbnRPcmRlciArIDFcblxuICAgIGlmICghTnVtYmVyLmlzU2FmZUludGVnZXIobmV4dE9yZGVyKSkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKGBCYWNrZ3JvdW5kIGpvYiBzY2hlZHVsZSBvd25lcnNoaXAgb3JkZXIgZXhoYXVzdGVkIGZvciAke3NjaGVkdWxlS2V5fWApXG4gICAgfVxuXG4gICAgYXdhaXQgdGhpcy5fd3JpdGVTY2hlZHVsZU9yZGVyV2F0ZXJtYXJrKGRiLCB7c2NoZWR1bGVLZXksIHNjaGVkdWxlT3JkZXI6IG5leHRPcmRlcn0pXG5cbiAgICByZXR1cm4gbmV4dE9yZGVyXG4gIH1cblxuICAvKipcbiAgICogRmluZHMgdGhlIGdyZWF0ZXN0IHJldGFpbmVkIG5vbi1sZWdhY3kgb3duZXJzaGlwIG9yZGVyIGZvciBtaWdyYXRpb24gYW5kXG4gICAqIHJvbGxpbmctdXBncmFkZSBjb21wYXRpYmlsaXR5LiBJdCBpcyBuZXZlciB0aGUgc29sZSBkdXJhYmlsaXR5IGJvdW5kYXJ5LlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL2RhdGFiYXNlL2RyaXZlcnMvYmFzZS5qc1wiKS5kZWZhdWx0fSBkYiAtIERhdGFiYXNlIGNvbm5lY3Rpb24uXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBzY2hlZHVsZUtleSAtIFZhbGlkYXRlZCBzdGFibGUgc2NoZWR1bGUga2V5LlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxudW1iZXIgfCBudWxsPn0gLSBHcmVhdGVzdCByZXRhaW5lZCBvcmRlciwgb3IgbnVsbC5cbiAgICovXG4gIGFzeW5jIF9ncmVhdGVzdFJldGFpbmVkU2NoZWR1bGVPcmRlcihkYiwgc2NoZWR1bGVLZXkpIHtcbiAgICBjb25zdCByb3dzID0gYXdhaXQgZGJcbiAgICAgIC5uZXdRdWVyeSgpXG4gICAgICAuZnJvbShKT0JTX1RBQkxFKVxuICAgICAgLnNlbGVjdChcInNjaGVkdWxlX29yZGVyXCIpXG4gICAgICAud2hlcmUoe3NjaGVkdWxlX2tleTogc2NoZWR1bGVLZXl9KVxuICAgICAgLndoZXJlTm90KHtzY2hlZHVsZV9vcmRlcjogbnVsbH0pXG4gICAgICAub3JkZXIoXCJzY2hlZHVsZV9vcmRlciBERVNDXCIpXG4gICAgICAubGltaXQoMSlcbiAgICAgIC5yZXN1bHRzKClcbiAgICBjb25zdCByb3cgPSByb3dzWzBdXG5cbiAgICBpZiAoIXJvdykgcmV0dXJuIG51bGxcblxuICAgIHJldHVybiB0aGlzLl92YWxpZGF0ZWRTY2hlZHVsZU9yZGVyKFxuICAgICAgLyoqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59ICovIChyb3cpLnNjaGVkdWxlX29yZGVyXG4gICAgKVxuICB9XG5cbiAgLyoqXG4gICAqIFJlYWRzIGFuZCB2YWxpZGF0ZXMgb25lIHJldGVudGlvbi1pbmRlcGVuZGVudCBzY2hlZHVsZS1vcmRlciB3YXRlcm1hcmsuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vZGF0YWJhc2UvZHJpdmVycy9iYXNlLmpzXCIpLmRlZmF1bHR9IGRiIC0gRGF0YWJhc2UgY29ubmVjdGlvbi5cbiAgICogQHBhcmFtIHtzdHJpbmd9IHNjaGVkdWxlS2V5IC0gVmFsaWRhdGVkIHN0YWJsZSBzY2hlZHVsZSBrZXkuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPG51bWJlciB8IG51bGw+fSAtIEN1cnJlbnQgd2F0ZXJtYXJrLCBvciBudWxsIGJlZm9yZSBmaXJzdCBvd25lcnNoaXAuXG4gICAqL1xuICBhc3luYyBfc2NoZWR1bGVPcmRlcldhdGVybWFyayhkYiwgc2NoZWR1bGVLZXkpIHtcbiAgICBjb25zdCByb3dzID0gYXdhaXQgZGJcbiAgICAgIC5uZXdRdWVyeSgpXG4gICAgICAuZnJvbShTQ0hFRFVMRV9PUkRFUl9XQVRFUk1BUktTX1RBQkxFKVxuICAgICAgLnNlbGVjdChcImhpZ2hfd2F0ZXJfbWFya1wiKVxuICAgICAgLndoZXJlKHtzY2hlZHVsZV9rZXk6IHNjaGVkdWxlS2V5fSlcbiAgICAgIC5saW1pdCgxKVxuICAgICAgLnJlc3VsdHMoKVxuICAgIGNvbnN0IHJvdyA9IHJvd3NbMF1cblxuICAgIGlmICghcm93KSByZXR1cm4gbnVsbFxuXG4gICAgcmV0dXJuIHRoaXMuX3ZhbGlkYXRlZFNjaGVkdWxlT3JkZXIoXG4gICAgICAvKiogQHR5cGUge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gKi8gKHJvdykuaGlnaF93YXRlcl9tYXJrXG4gICAgKVxuICB9XG5cbiAgLyoqXG4gICAqIFBlcnNpc3RzIG9uZSBzY2hlZHVsZS1vcmRlciB3YXRlcm1hcmsgd2l0aG91dCBleHBvc2luZyBpdCBhcyBhIGpvYiByb3cuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vZGF0YWJhc2UvZHJpdmVycy9iYXNlLmpzXCIpLmRlZmF1bHR9IGRiIC0gRGF0YWJhc2UgY29ubmVjdGlvbi5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBXYXRlcm1hcmsgaWRlbnRpdHkgYW5kIHZhbHVlLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gYXJncy5zY2hlZHVsZUtleSAtIFZhbGlkYXRlZCBzdGFibGUgc2NoZWR1bGUga2V5LlxuICAgKiBAcGFyYW0ge251bWJlcn0gYXJncy5zY2hlZHVsZU9yZGVyIC0gVmFsaWRhdGVkIG1vbm90b25pYyBvcmRlci5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgYWZ0ZXIgcGVyc2lzdGVuY2UuXG4gICAqL1xuICBhc3luYyBfd3JpdGVTY2hlZHVsZU9yZGVyV2F0ZXJtYXJrKGRiLCB7c2NoZWR1bGVLZXksIHNjaGVkdWxlT3JkZXJ9KSB7XG4gICAgYXdhaXQgZGIudXBzZXJ0KHtcbiAgICAgIHRhYmxlTmFtZTogU0NIRURVTEVfT1JERVJfV0FURVJNQVJLU19UQUJMRSxcbiAgICAgIGRhdGE6IHtoaWdoX3dhdGVyX21hcms6IHNjaGVkdWxlT3JkZXIsIHNjaGVkdWxlX2tleTogc2NoZWR1bGVLZXl9LFxuICAgICAgY29uZmxpY3RDb2x1bW5zOiBbXCJzY2hlZHVsZV9rZXlcIl0sXG4gICAgICB1cGRhdGVDb2x1bW5zOiBbXCJoaWdoX3dhdGVyX21hcmtcIl1cbiAgICB9KVxuICB9XG5cbiAgLyoqXG4gICAqIFZhbGlkYXRlcyBhbiBvd25lcnNoaXAgb3JkZXIgbG9hZGVkIGZyb20gZHVyYWJsZSBzdG9yYWdlLlxuICAgKiBAcGFyYW0ge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSB2YWx1ZSAtIFN0b3JlZCBvcmRlci5cbiAgICogQHJldHVybnMge251bWJlcn0gLSBQb3NpdGl2ZSBzYWZlIGludGVnZXIgb3duZXJzaGlwIG9yZGVyLlxuICAgKi9cbiAgX3ZhbGlkYXRlZFNjaGVkdWxlT3JkZXIodmFsdWUpIHtcbiAgICBjb25zdCBzY2hlZHVsZU9yZGVyID0gdGhpcy5fbm9ybWFsaXplTnVtYmVyKHZhbHVlKVxuXG4gICAgaWYgKHNjaGVkdWxlT3JkZXIgPT09IG51bGwgfHwgIU51bWJlci5pc1NhZmVJbnRlZ2VyKHNjaGVkdWxlT3JkZXIpIHx8IHNjaGVkdWxlT3JkZXIgPCAxKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoYEludmFsaWQgYmFja2dyb3VuZCBqb2Igc2NoZWR1bGUgb3duZXJzaGlwIG9yZGVyOiAke3NjaGVkdWxlT3JkZXJ9YClcbiAgICB9XG5cbiAgICByZXR1cm4gc2NoZWR1bGVPcmRlclxuICB9XG5cbiAgLyoqXG4gICAqIEJ1aWxkcyBhIHN0YWJsZS1zY2hlZHVsZSBsb29rdXAgZXhjbHVzaXZlbHkgZnJvbSBub3JtYWxpemVkIGpvYiByb3dzLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL2RhdGFiYXNlL2RyaXZlcnMvYmFzZS5qc1wiKS5kZWZhdWx0fSBkYiAtIERhdGFiYXNlIGNvbm5lY3Rpb24uXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gTG9va3VwIG9wdGlvbnMuXG4gICAqIEBwYXJhbSB7Ym9vbGVhbn0gYXJncy5pbmNsdWRlTGF0ZXN0VGVybWluYWwgLSBXaGV0aGVyIHRlcm1pbmFsIGhpc3RvcnkgaXMgcmVxdWVzdGVkLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gYXJncy5zY2hlZHVsZUtleSAtIFZhbGlkYXRlZCBzdGFibGUgc2NoZWR1bGUga2V5LlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxpbXBvcnQoXCIuL3R5cGVzLmpzXCIpLkJhY2tncm91bmRKb2JTY2hlZHVsZWRMb29rdXBSZXN1bHQ+fSAtIE5vcm1hbGl6ZWQgcHVibGljIGpvYnMuXG4gICAqL1xuICBhc3luYyBfc2NoZWR1bGVkSm9iTG9va3VwKGRiLCB7aW5jbHVkZUxhdGVzdFRlcm1pbmFsLCBzY2hlZHVsZUtleX0pIHtcbiAgICBjb25zdCBvd25lckpvYiA9IGF3YWl0IHRoaXMuX3NjaGVkdWxlZE93bmVySm9iKGRiLCBzY2hlZHVsZUtleSlcbiAgICBjb25zdCBjdXJyZW50Sm9iID0gb3duZXJKb2IgJiYgKG93bmVySm9iLnN0YXR1cyA9PT0gXCJxdWV1ZWRcIiB8fCBvd25lckpvYi5zdGF0dXMgPT09IFwiaGFuZGVkX29mZlwiKSA/IG93bmVySm9iIDogbnVsbFxuXG4gICAgaWYgKCFpbmNsdWRlTGF0ZXN0VGVybWluYWwpIHJldHVybiB7Y3VycmVudEpvYiwgbGF0ZXN0VGVybWluYWxKb2I6IG51bGx9XG5cbiAgICBjb25zdCB0ZXJtaW5hbFN0YXR1c2VzID0gQkFDS0dST1VORF9KT0JfVEVSTUlOQUxfU1RBVFVTRVMubWFwKChzdGF0dXMpID0+IGRiLnF1b3RlKHN0YXR1cykpLmpvaW4oXCIsIFwiKVxuICAgIGNvbnN0IHRlcm1pbmFsUm93cyA9IGF3YWl0IGRiXG4gICAgICAubmV3UXVlcnkoKVxuICAgICAgLmZyb20oSk9CU19UQUJMRSlcbiAgICAgIC53aGVyZSh7c2NoZWR1bGVfa2V5OiBzY2hlZHVsZUtleX0pXG4gICAgICAud2hlcmUoYCR7ZGIucXVvdGVDb2x1bW4oXCJzdGF0dXNcIil9IElOICgke3Rlcm1pbmFsU3RhdHVzZXN9KWApXG4gICAgICAub3JkZXIoYENBU0UgV0hFTiAke2RiLnF1b3RlQ29sdW1uKFwic2NoZWR1bGVfb3JkZXJcIil9IElTIE5VTEwgVEhFTiAwIEVMU0UgMSBFTkQgREVTQ2ApXG4gICAgICAub3JkZXIoXCJzY2hlZHVsZV9vcmRlciBERVNDXCIpXG4gICAgICAub3JkZXIoXCJjcmVhdGVkX2F0X21zIERFU0NcIilcbiAgICAgIC5vcmRlcihcImlkIERFU0NcIilcbiAgICAgIC5saW1pdCgxKVxuICAgICAgLnJlc3VsdHMoKVxuICAgIGNvbnN0IGxhdGVzdFRlcm1pbmFsSm9iID0gdGVybWluYWxSb3dzWzBdID8gdGhpcy5fbm9ybWFsaXplSm9iUm93KHRlcm1pbmFsUm93c1swXSkgOiBudWxsXG5cbiAgICByZXR1cm4ge2N1cnJlbnRKb2IsIGxhdGVzdFRlcm1pbmFsSm9ifVxuICB9XG5cbiAgLyoqXG4gICAqIFJlbGVhc2VzIG93bmVyc2hpcCBvbmx5IHdoZW4gdGhlIGtleSBzdGlsbCBwb2ludHMgYXQgdGhlIGV4cGVjdGVkIGpvYi5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9kYXRhYmFzZS9kcml2ZXJzL2Jhc2UuanNcIikuZGVmYXVsdH0gZGIgLSBEYXRhYmFzZSBjb25uZWN0aW9uLlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIE93bmVyc2hpcCBpZGVudGl0eS5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGFyZ3Muam9iSWQgLSBFeHBlY3RlZCBvd25lciBqb2IgaWQuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBhcmdzLnNjaGVkdWxlS2V5IC0gU3RhYmxlIHNjaGVkdWxlIGtleS5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgd2hlbiBkZWxldGVkIG9yIGFscmVhZHkgc3VwZXJzZWRlZC5cbiAgICovXG4gIGFzeW5jIF9yZWxlYXNlU2NoZWR1bGVPd25lcnNoaXAoZGIsIHtqb2JJZCwgc2NoZWR1bGVLZXl9KSB7XG4gICAgYXdhaXQgZGIuZGVsZXRlKHtcbiAgICAgIHRhYmxlTmFtZTogU0NIRURVTEVfS0VZU19UQUJMRSxcbiAgICAgIGNvbmRpdGlvbnM6IHtqb2JfaWQ6IGpvYklkLCBzY2hlZHVsZV9rZXk6IHNjaGVkdWxlS2V5fVxuICAgIH0pXG4gIH1cblxuICAvKipcbiAgICogUmVsZWFzZXMgYSBqb2IncyBvd25lcnNoaXAgd2hlbiBpdCBoYXMgYSBoaXN0b3JpY2FsIHNjaGVkdWxlIGtleS5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9kYXRhYmFzZS9kcml2ZXJzL2Jhc2UuanNcIikuZGVmYXVsdH0gZGIgLSBEYXRhYmFzZSBjb25uZWN0aW9uLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vdHlwZXMuanNcIikuQmFja2dyb3VuZEpvYlJvd30gam9iIC0gVGVybWluYWwgam9iLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyB3aGVuIGRlbGV0ZWQgb3Igbm90IGFwcGxpY2FibGUuXG4gICAqL1xuICBhc3luYyBfcmVsZWFzZVNjaGVkdWxlT3duZXJzaGlwRm9ySm9iKGRiLCBqb2IpIHtcbiAgICBpZiAoIWpvYi5zY2hlZHVsZUtleSkgcmV0dXJuXG5cbiAgICBhd2FpdCB0aGlzLl9yZWxlYXNlU2NoZWR1bGVPd25lcnNoaXAoZGIsIHtqb2JJZDogam9iLmlkLCBzY2hlZHVsZUtleTogam9iLnNjaGVkdWxlS2V5fSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGFwcGx5IGZhaWx1cmUuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gT3B0aW9ucy5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9kYXRhYmFzZS9kcml2ZXJzL2Jhc2UuanNcIikuZGVmYXVsdH0gYXJncy5kYiAtIERhdGFiYXNlIGNvbm5lY3Rpb24uXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi90eXBlcy5qc1wiKS5CYWNrZ3JvdW5kSm9iUm93fSBhcmdzLmpvYiAtIEpvYiByb3cuXG4gICAqIEBwYXJhbSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59IGFyZ3MuZXJyb3IgLSBFcnJvci5cbiAgICogQHBhcmFtIHtib29sZWFufSBhcmdzLm1hcmtPcnBoYW5lZCAtIFdoZXRoZXIgbWFya2luZyBvcnBoYW5lZC5cbiAgICogQHBhcmFtIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59IFthcmdzLmNvbmRpdGlvbnNdIC0gVXBkYXRlIGZlbmNpbmcgY29uZGl0aW9ucy4gRGVmYXVsdHMgdG8gdGhlIGFjdGl2ZS1oYW5kb2ZmIGxlYXNlIG1hdGNoOyB0aGUgdGltZS1iYXNlZCBvcnBoYW4gc3dlZXAgb3ZlcnJpZGVzIHRoaXMgd2l0aCBhbiBpZC9zdGF0dXMgbWF0Y2ggc28gaXQgY2FuIHJlY2xhaW0gcm93cyB3aG9zZSBgaGFuZG9mZl9pZGAgaXMgbnVsbCAoZS5nLiBoYW5kZWQgb2ZmIGJ5IGFuIG9sZGVyIHZlbG9jaW91cyBiZWZvcmUgaGFuZG9mZi1pZCBmZW5jaW5nIGV4aXN0ZWQpLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxpbXBvcnQoXCIuL3R5cGVzLmpzXCIpLkJhY2tncm91bmRKb2JSb3cgfCBudWxsPn0gLSBVcGRhdGVkIGpvYiByb3cgd2hlbiB0aGUgbGVhc2UgdHJhbnNpdGlvbiB3b24uXG4gICAqL1xuICBhc3luYyBfYXBwbHlGYWlsdXJlKHtkYiwgam9iLCBlcnJvciwgbWFya09ycGhhbmVkLCBjb25kaXRpb25zfSkge1xuICAgIGNvbnN0IG5vdyA9IHRoaXMuY2xvY2subm93KClcbiAgICBjb25zdCBuZXh0QXR0ZW1wdCA9IChqb2IuYXR0ZW1wdHMgfHwgMCkgKyAxXG4gICAgY29uc3QgbWF4UmV0cmllcyA9IHRoaXMuX25vcm1hbGl6ZU1heFJldHJpZXMoam9iLm1heFJldHJpZXMpXG4gICAgY29uc3Qgc2hvdWxkUmV0cnkgPSBuZXh0QXR0ZW1wdCA8PSBtYXhSZXRyaWVzXG4gICAgY29uc3QgZmFpbHVyZU1lc3NhZ2UgPSBub3JtYWxpemVCYWNrZ3JvdW5kSm9iRXJyb3IoZXJyb3IpXG4gICAgY29uc3Qgc2NoZWR1bGVkQXQgPSBzaG91bGRSZXRyeSA/IG5vdyArIHRoaXMuZ2V0UmV0cnlEZWxheU1zKG5leHRBdHRlbXB0KSA6IGpvYi5zY2hlZHVsZWRBdE1zXG4gICAgY29uc3QgdXBkYXRlID0gdGhpcy5fZmFpbHVyZVVwZGF0ZSh7XG4gICAgICBmYWlsdXJlTWVzc2FnZSxcbiAgICAgIG1hcmtPcnBoYW5lZCxcbiAgICAgIG5leHRBdHRlbXB0LFxuICAgICAgbm93LFxuICAgICAgc2NoZWR1bGVkQXQsXG4gICAgICBzaG91bGRSZXRyeVxuICAgIH0pXG5cbiAgICBhd2FpdCB0aGlzLl9sb2NrQ29uY3VycmVuY3lSb3coZGIsIGpvYi5jb25jdXJyZW5jeUtleSlcbiAgICBjb25zdCBhZmZlY3RlZFJvd3MgPSBhd2FpdCB0aGlzLl91cGRhdGVBZmZlY3RlZFJvd3MoZGIsIHtcbiAgICAgIHRhYmxlTmFtZTogSk9CU19UQUJMRSxcbiAgICAgIGRhdGE6IHVwZGF0ZSxcbiAgICAgIGNvbmRpdGlvbnM6IGNvbmRpdGlvbnMgPz8gdGhpcy5fYWN0aXZlSGFuZG9mZkNvbmRpdGlvbnMoam9iKVxuICAgIH0pXG5cbiAgICBpZiAoYWZmZWN0ZWRSb3dzICE9PSAxKSByZXR1cm4gbnVsbFxuICAgIGlmICghc2hvdWxkUmV0cnkpIGF3YWl0IHRoaXMuX3JlbGVhc2VTY2hlZHVsZU93bmVyc2hpcEZvckpvYihkYiwgam9iKVxuICAgIGF3YWl0IHRoaXMuX3JlbGVhc2VDb25jdXJyZW5jeShkYiwgam9iLmNvbmN1cnJlbmN5S2V5KVxuXG4gICAgLy8gUmV0dXJuIGEgc25hcHNob3Qgb2YgdGhlIHRyYW5zaXRpb24gdGhpcyB1cGRhdGUganVzdCBhcHBsaWVkIHJhdGhlciB0aGFuIHJlLXJlYWRpbmcgdGhlIHJvdy5cbiAgICAvLyBXZSB3b24gdGhlIGNvbmRpdGlvbmFsIHVwZGF0ZSAoYWZmZWN0ZWRSb3dzID09PSAxKSwgc28gdGhpcyBzdGF0ZSBpcyBhdXRob3JpdGF0aXZlOyByZS1yZWFkaW5nXG4gICAgLy8gY291bGQgaW5zdGVhZCBvYnNlcnZlIGEgbmV3ZXIgc3RhdGUgaWYgYW5vdGhlciBkaXNwYXRjaGVyIHJlY2xhaW1zIGEgcmVxdWV1ZWQgam9iIGJldHdlZW4gdGhlXG4gICAgLy8gdXBkYXRlIGFuZCB0aGUgcmVhZCAob3ZlcmxhcHBpbmcgbWFpbnMgLyBwb2xsaW5nIGRpc3BhdGNoKSwgd2hpY2ggd291bGQgbWlzcmVwb3J0IHRoZVxuICAgIC8vIHN0YXR1cy90ZXJtaW5hbC93aWxsUmV0cnkgb2YgdGhpcyB0cmFuc2l0aW9uIHRvIGZhaWx1cmUvb3JwaGFuIGV2ZW50IGxpc3RlbmVycy5cbiAgICBjb25zdCBzdGF0dXMgPSBzaG91bGRSZXRyeSA/IFwicXVldWVkXCIgOiAobWFya09ycGhhbmVkID8gXCJvcnBoYW5lZFwiIDogXCJmYWlsZWRcIilcbiAgICAvKiogQHR5cGUge2ltcG9ydChcIi4vdHlwZXMuanNcIikuQmFja2dyb3VuZEpvYlJvd30gKi9cbiAgICBjb25zdCB0cmFuc2l0aW9uZWRKb2IgPSB7XG4gICAgICAuLi5qb2IsXG4gICAgICAuLi4oc2hvdWxkUmV0cnkgPyB0aGlzLl9jbGVhcmVkQ2hpbGRBY2NlcHRhbmNlUm93KCkgOiB7fSksXG4gICAgICBhdHRlbXB0czogbmV4dEF0dGVtcHQsXG4gICAgICBoYW5kZWRPZmZBdE1zOiBudWxsLFxuICAgICAgbGFzdEVycm9yOiBmYWlsdXJlTWVzc2FnZSxcbiAgICAgIHN0YXR1cyxcbiAgICAgIHdvcmtlcklkOiBudWxsXG4gICAgfVxuXG4gICAgaWYgKG1hcmtPcnBoYW5lZCkgdHJhbnNpdGlvbmVkSm9iLm9ycGhhbmVkQXRNcyA9IG5vd1xuICAgIGlmIChzaG91bGRSZXRyeSkge1xuICAgICAgdHJhbnNpdGlvbmVkSm9iLnNjaGVkdWxlZEF0TXMgPSBzY2hlZHVsZWRBdFxuICAgIH0gZWxzZSBpZiAoIW1hcmtPcnBoYW5lZCkge1xuICAgICAgdHJhbnNpdGlvbmVkSm9iLmZhaWxlZEF0TXMgPSBub3dcbiAgICB9XG5cbiAgICByZXR1cm4gdHJhbnNpdGlvbmVkSm9iXG4gIH1cblxuICAvKipcbiAgICogUnVucyBmYWlsdXJlIHVwZGF0ZS5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBPcHRpb25zLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gYXJncy5mYWlsdXJlTWVzc2FnZSAtIExhc3QgZmFpbHVyZSBtZXNzYWdlLlxuICAgKiBAcGFyYW0ge2Jvb2xlYW59IGFyZ3MubWFya09ycGhhbmVkIC0gV2hldGhlciBtYXJraW5nIG9ycGhhbmVkLlxuICAgKiBAcGFyYW0ge251bWJlcn0gYXJncy5uZXh0QXR0ZW1wdCAtIE5leHQgYXR0ZW1wdCBjb3VudC5cbiAgICogQHBhcmFtIHtudW1iZXJ9IGFyZ3Mubm93IC0gQ3VycmVudCB0aW1lc3RhbXAuXG4gICAqIEBwYXJhbSB7bnVtYmVyIHwgbnVsbH0gYXJncy5zY2hlZHVsZWRBdCAtIE5leHQgc2NoZWR1bGVkIHRpbWVzdGFtcC5cbiAgICogQHBhcmFtIHtib29sZWFufSBhcmdzLnNob3VsZFJldHJ5IC0gV2hldGhlciB0aGUgam9iIHNob3VsZCByZXRyeS5cbiAgICogQHJldHVybnMge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gLSBEYXRhYmFzZSB1cGRhdGUgZGF0YS5cbiAgICovXG4gIF9mYWlsdXJlVXBkYXRlKHtmYWlsdXJlTWVzc2FnZSwgbWFya09ycGhhbmVkLCBuZXh0QXR0ZW1wdCwgbm93LCBzY2hlZHVsZWRBdCwgc2hvdWxkUmV0cnl9KSB7XG4gICAgLyoqXG4gICAgICogVXBkYXRlLlxuICAgICAqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59ICovXG4gICAgY29uc3QgdXBkYXRlID0ge1xuICAgICAgYXR0ZW1wdHM6IG5leHRBdHRlbXB0LFxuICAgICAgaGFuZGVkX29mZl9hdF9tczogbnVsbCxcbiAgICAgIHdvcmtlcl9pZDogbnVsbCxcbiAgICAgIGxhc3RfZXJyb3I6IGZhaWx1cmVNZXNzYWdlXG4gICAgfVxuXG4gICAgLy8gQSByZXRyeSBzdGFydHMgYSBmcmVzaCBoYW5kb2ZmIHdpdGggYSBwb3NzaWJseSBkaWZmZXJlbnQgcnVubmVyLCBzbyB0aGVcbiAgICAvLyBwcmV2aW91cyBjaGlsZCdzIGFjY2VwdGFuY2UgZXZpZGVuY2UgbXVzdCBub3QgbGVhayBpbnRvIHRoZSBuZXh0IGF0dGVtcHQuXG4gICAgLy8gVGVybWluYWwgZmFpbHVyZXMga2VlcCBpdCBhcyBoaXN0b3JpY2FsIGV2aWRlbmNlIGZvciB0aGUgbG9zdCBhdHRlbXB0LlxuICAgIGlmIChzaG91bGRSZXRyeSkgT2JqZWN0LmFzc2lnbih1cGRhdGUsIHRoaXMuX2NsZWFyZWRDaGlsZEFjY2VwdGFuY2VEYXRhKCkpXG5cbiAgICB0aGlzLl9hcHBseU9ycGhhbmVkRmFpbHVyZVVwZGF0ZSh7bWFya09ycGhhbmVkLCBub3csIHVwZGF0ZX0pXG4gICAgdGhpcy5fYXBwbHlGYWlsdXJlU3RhdHVzVXBkYXRlKHttYXJrT3JwaGFuZWQsIG5vdywgc2NoZWR1bGVkQXQsIHNob3VsZFJldHJ5LCB1cGRhdGV9KVxuXG4gICAgcmV0dXJuIHVwZGF0ZVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgYXBwbHkgb3JwaGFuZWQgZmFpbHVyZSB1cGRhdGUuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gT3B0aW9ucy5cbiAgICogQHBhcmFtIHtib29sZWFufSBhcmdzLm1hcmtPcnBoYW5lZCAtIFdoZXRoZXIgbWFya2luZyBvcnBoYW5lZC5cbiAgICogQHBhcmFtIHtudW1iZXJ9IGFyZ3Mubm93IC0gQ3VycmVudCB0aW1lc3RhbXAuXG4gICAqIEBwYXJhbSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSBhcmdzLnVwZGF0ZSAtIERhdGFiYXNlIHVwZGF0ZSBkYXRhLlxuICAgKiBAcmV0dXJucyB7dm9pZH1cbiAgICovXG4gIF9hcHBseU9ycGhhbmVkRmFpbHVyZVVwZGF0ZSh7bWFya09ycGhhbmVkLCBub3csIHVwZGF0ZX0pIHtcbiAgICBpZiAobWFya09ycGhhbmVkKSB1cGRhdGUub3JwaGFuZWRfYXRfbXMgPSBub3dcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGFwcGx5IGZhaWx1cmUgc3RhdHVzIHVwZGF0ZS5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBPcHRpb25zLlxuICAgKiBAcGFyYW0ge2Jvb2xlYW59IGFyZ3MubWFya09ycGhhbmVkIC0gV2hldGhlciBtYXJraW5nIG9ycGhhbmVkLlxuICAgKiBAcGFyYW0ge251bWJlcn0gYXJncy5ub3cgLSBDdXJyZW50IHRpbWVzdGFtcC5cbiAgICogQHBhcmFtIHtudW1iZXIgfCBudWxsfSBhcmdzLnNjaGVkdWxlZEF0IC0gTmV4dCBzY2hlZHVsZWQgdGltZXN0YW1wLlxuICAgKiBAcGFyYW0ge2Jvb2xlYW59IGFyZ3Muc2hvdWxkUmV0cnkgLSBXaGV0aGVyIHRoZSBqb2Igc2hvdWxkIHJldHJ5LlxuICAgKiBAcGFyYW0ge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gYXJncy51cGRhdGUgLSBEYXRhYmFzZSB1cGRhdGUgZGF0YS5cbiAgICogQHJldHVybnMge3ZvaWR9XG4gICAqL1xuICBfYXBwbHlGYWlsdXJlU3RhdHVzVXBkYXRlKHttYXJrT3JwaGFuZWQsIG5vdywgc2NoZWR1bGVkQXQsIHNob3VsZFJldHJ5LCB1cGRhdGV9KSB7XG4gICAgaWYgKHNob3VsZFJldHJ5KSB7XG4gICAgICB1cGRhdGUuc3RhdHVzID0gXCJxdWV1ZWRcIlxuICAgICAgdXBkYXRlLnNjaGVkdWxlZF9hdF9tcyA9IHNjaGVkdWxlZEF0XG4gICAgICByZXR1cm5cbiAgICB9XG5cbiAgICBpZiAobWFya09ycGhhbmVkKSB7XG4gICAgICB1cGRhdGUuc3RhdHVzID0gXCJvcnBoYW5lZFwiXG4gICAgICByZXR1cm5cbiAgICB9XG5cbiAgICB1cGRhdGUuc3RhdHVzID0gXCJmYWlsZWRcIlxuICAgIHVwZGF0ZS5mYWlsZWRfYXRfbXMgPSBub3dcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIG5vcm1hbGl6ZSBqb2Igcm93LlxuICAgKiBAcGFyYW0ge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gcm93IC0gUmF3IGRhdGFiYXNlIHJvdy5cbiAgICogQHJldHVybnMge2ltcG9ydChcIi4vdHlwZXMuanNcIikuQmFja2dyb3VuZEpvYlJvd30gLSBOb3JtYWxpemVkIGpvYiByb3cuXG4gICAqL1xuICBfbm9ybWFsaXplSm9iUm93KHJvdykge1xuICAgIGNvbnN0IGhhbmRvZmZJZCA9IHJvdy5oYW5kb2ZmX2lkID8gU3RyaW5nKHJvdy5oYW5kb2ZmX2lkKSA6IG51bGxcbiAgICAvLyBgZXhlY3V0aW9uX21vZGVgIGlzIHRoZSBzaW5nbGUgc291cmNlIG9mIHRydXRoIGZvciBhIGpvYidzIHJ1bnRpbWUgYW5kIGlzXG4gICAgLy8gd3JpdHRlbiBvbiBldmVyeSBlbnF1ZXVlOyB0aGUgZHJvcC1mb3JrZWQgbWlncmF0aW9uIGJhY2tmaWxscyBhbnkgcHJlLWV4aXN0aW5nXG4gICAgLy8gcm93cyBiZWZvcmUgdGhlIGxlZ2FjeSBgZm9ya2VkYCBjb2x1bW4gaXMgcmVtb3ZlZC5cbiAgICBjb25zdCBleGVjdXRpb25Nb2RlID0gcm93LmV4ZWN1dGlvbl9tb2RlID8gdGhpcy5fbm9ybWFsaXplRXhlY3V0aW9uTW9kZU5hbWUoU3RyaW5nKHJvdy5leGVjdXRpb25fbW9kZSkpIDogREVGQVVMVF9CQUNLR1JPVU5EX0pPQl9FWEVDVVRJT05fTU9ERVxuXG4gICAgcmV0dXJuIHtcbiAgICAgIGlkOiBTdHJpbmcocm93LmlkKSxcbiAgICAgIGpvYk5hbWU6IFN0cmluZyhyb3cuam9iX25hbWUpLFxuICAgICAgYXJnczogdGhpcy5fcGFyc2VBcmdzKHJvdy5hcmdzX2pzb24pLFxuICAgICAgZXhlY3V0aW9uTW9kZSxcbiAgICAgIHF1ZXVlOiByb3cucXVldWUgPyBTdHJpbmcocm93LnF1ZXVlKSA6IERFRkFVTFRfQkFDS0dST1VORF9KT0JfUVVFVUUsXG4gICAgICBzY2hlZHVsZUtleTogcm93LnNjaGVkdWxlX2tleSA/IFN0cmluZyhyb3cuc2NoZWR1bGVfa2V5KSA6IG51bGwsXG4gICAgICBzY2hlZHVsZU9yZGVyOiB0aGlzLl9ub3JtYWxpemVOdW1iZXIocm93LnNjaGVkdWxlX29yZGVyKSxcbiAgICAgIHN0YXR1czogbm9ybWFsaXplQmFja2dyb3VuZEpvYlN0YXR1cyhyb3cuc3RhdHVzID8gU3RyaW5nKHJvdy5zdGF0dXMpIDogXCJxdWV1ZWRcIiksXG4gICAgICBhdHRlbXB0czogdGhpcy5fbm9ybWFsaXplTnVtYmVyKHJvdy5hdHRlbXB0cyksXG4gICAgICBtYXhSZXRyaWVzOiB0aGlzLl9ub3JtYWxpemVOdW1iZXIocm93Lm1heF9yZXRyaWVzKSxcbiAgICAgIHNjaGVkdWxlZEF0TXM6IHRoaXMuX25vcm1hbGl6ZU51bWJlcihyb3cuc2NoZWR1bGVkX2F0X21zKSxcbiAgICAgIGNyZWF0ZWRBdE1zOiB0aGlzLl9ub3JtYWxpemVOdW1iZXIocm93LmNyZWF0ZWRfYXRfbXMpLFxuICAgICAgaGFuZGVkT2ZmQXRNczogdGhpcy5fbm9ybWFsaXplTnVtYmVyKHJvdy5oYW5kZWRfb2ZmX2F0X21zKSxcbiAgICAgIGhhbmRvZmZJZCxcbiAgICAgIGNvbXBsZXRlZEF0TXM6IHRoaXMuX25vcm1hbGl6ZU51bWJlcihyb3cuY29tcGxldGVkX2F0X21zKSxcbiAgICAgIGZhaWxlZEF0TXM6IHRoaXMuX25vcm1hbGl6ZU51bWJlcihyb3cuZmFpbGVkX2F0X21zKSxcbiAgICAgIG9ycGhhbmVkQXRNczogdGhpcy5fbm9ybWFsaXplTnVtYmVyKHJvdy5vcnBoYW5lZF9hdF9tcyksXG4gICAgICB3b3JrZXJJZDogcm93Lndvcmtlcl9pZCA/IFN0cmluZyhyb3cud29ya2VyX2lkKSA6IG51bGwsXG4gICAgICBsYXN0RXJyb3I6IHJvdy5sYXN0X2Vycm9yID8gU3RyaW5nKHJvdy5sYXN0X2Vycm9yKSA6IG51bGwsXG4gICAgICBjb25jdXJyZW5jeUtleTogcm93LmNvbmN1cnJlbmN5X2tleSA/IFN0cmluZyhyb3cuY29uY3VycmVuY3lfa2V5KSA6IG51bGwsXG4gICAgICBtYXhDb25jdXJyZW5jeTogdGhpcy5fbm9ybWFsaXplTnVtYmVyKHJvdy5tYXhfY29uY3VycmVuY3kpLFxuICAgICAgdGltZW91dE1zOiB0aGlzLl9ub3JtYWxpemVOdW1iZXIocm93LnRpbWVvdXRfbXMpLFxuICAgICAgY2hpbGRSZWNlaXZlZEF0TXM6IHRoaXMuX25vcm1hbGl6ZU51bWJlcihyb3cuY2hpbGRfcmVjZWl2ZWRfYXRfbXMpLFxuICAgICAgY2hpbGRTdGFydGVkQXRNczogdGhpcy5fbm9ybWFsaXplTnVtYmVyKHJvdy5jaGlsZF9zdGFydGVkX2F0X21zKSxcbiAgICAgIGNoaWxkSW5zdGFuY2VJZDogcm93LmNoaWxkX2luc3RhbmNlX2lkID8gU3RyaW5nKHJvdy5jaGlsZF9pbnN0YW5jZV9pZCkgOiBudWxsLFxuICAgICAgY2hpbGRQaWQ6IHRoaXMuX25vcm1hbGl6ZU51bWJlcihyb3cuY2hpbGRfcGlkKVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBOb3JtYWxpemVzIGEgam9iJ3MgcXVldWUgbmFtZSwgZGVmYXVsdGluZyB0byBcImRlZmF1bHRcIi5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL3R5cGVzLmpzXCIpLkJhY2tncm91bmRKb2JPcHRpb25zIHwgdW5kZWZpbmVkfSBvcHRpb25zIC0gSm9iIG9wdGlvbnMuXG4gICAqIEByZXR1cm5zIHtzdHJpbmd9IC0gUXVldWUgbmFtZS5cbiAgICovXG4gIF9ub3JtYWxpemVRdWV1ZShvcHRpb25zKSB7XG4gICAgcmV0dXJuIG5vcm1hbGl6ZUJhY2tncm91bmRKb2JRdWV1ZShvcHRpb25zKVxuICB9XG5cbiAgLyoqXG4gICAqIFJlc29sdmVzIGEgam9iJ3MgZHVyYWJsZSBjb25jdXJyZW5jeS4gQW4gZXhwbGljaXQgY29uY3VycmVuY3lLZXkvbWF4Q29uY3VycmVuY3lcbiAgICogcGFpciBhbHdheXMgd2lucy4gT3RoZXJ3aXNlLCB3aGVuIHRoZSBqb2IncyBxdWV1ZSBoYXMgYSBjb25maWd1cmVkIGNhcFxuICAgKiAoYGJhY2tncm91bmRKb2JzLnF1ZXVlc1txdWV1ZV0ubWF4Q29uY3VycmVudGApLCBkZXJpdmUgYSBxdWV1ZS1zY29wZWRcbiAgICogY29uY3VycmVuY3kga2V5IHNvIHRoZSBxdWV1ZSBjYXAgaXMgZW5mb3JjZWQgY2x1c3Rlci13aWRlIHRocm91Z2ggdGhlXG4gICAqIGV4aXN0aW5nIGR1cmFibGUgY29uY3VycmVuY3kgbWVjaGFuaXNtLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vdHlwZXMuanNcIikuQmFja2dyb3VuZEpvYk9wdGlvbnMgfCB1bmRlZmluZWR9IG9wdGlvbnMgLSBKb2Igb3B0aW9ucy5cbiAgICogQHBhcmFtIHtzdHJpbmd9IHF1ZXVlIC0gTm9ybWFsaXplZCBxdWV1ZSBuYW1lLlxuICAgKiBAcmV0dXJucyB7e2NvbmN1cnJlbmN5S2V5OiBzdHJpbmcsIG1heENvbmN1cnJlbmN5OiBudW1iZXIsIHF1ZXVlRGVyaXZlZDogYm9vbGVhbn0gfCBudWxsfSAtIFJlc29sdmVkIGNvbmN1cnJlbmN5LlxuICAgKi9cbiAgX3Jlc29sdmVDb25jdXJyZW5jeShvcHRpb25zLCBxdWV1ZSkge1xuICAgIHJldHVybiBub3JtYWxpemVCYWNrZ3JvdW5kSm9iQ29uY3VycmVuY3koe1xuICAgICAgb3B0aW9uczogb3B0aW9ucyB8fCB7fSxcbiAgICAgIHF1ZXVlLFxuICAgICAgcXVldWVzOiB0aGlzLmNvbmZpZ3VyYXRpb24uZ2V0QmFja2dyb3VuZEpvYnNDb25maWcoKS5xdWV1ZXNcbiAgICB9KVxuICB9XG5cbiAgLyoqXG4gICAqIEFwcGxpZXMgdGhlIGFjdGl2ZSBnZW5lcmF0aW9uJ3MgcXVldWUgcG9saWN5IGltbWVkaWF0ZWx5IGJlZm9yZSBoYW5kb2ZmLlxuICAgKiBFeHBsaWNpdCBjb25jdXJyZW5jeSByZW1haW5zIG93bmVkIGJ5IHRoZSBlbnF1ZXVlIHJlcXVlc3QuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vZGF0YWJhc2UvZHJpdmVycy9iYXNlLmpzXCIpLmRlZmF1bHR9IGRiIC0gRGF0YWJhc2UgY29ubmVjdGlvbi5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL3R5cGVzLmpzXCIpLkJhY2tncm91bmRKb2JSb3d9IGpvYiAtIFF1ZXVlZCBqb2Igc25hcHNob3QuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPGltcG9ydChcIi4vdHlwZXMuanNcIikuQmFja2dyb3VuZEpvYlJvdyB8IG51bGw+fSAtIFJlY29uY2lsZWQgam9iLCBvciBudWxsIHdoZW4gaXRzIHF1ZXVlZC1zdGF0ZSBmZW5jZSBsb3N0LlxuICAgKi9cbiAgYXN5bmMgX3JlY29uY2lsZVF1ZXVlZEpvYkNvbmN1cnJlbmN5KGRiLCBqb2IpIHtcbiAgICBpZiAoam9iLmNvbmN1cnJlbmN5S2V5ICYmICFqb2IuY29uY3VycmVuY3lLZXkuc3RhcnRzV2l0aChRVUVVRV9DT05DVVJSRU5DWV9LRVlfUFJFRklYKSkge1xuICAgICAgcmV0dXJuIGpvYlxuICAgIH1cblxuICAgIGNvbnN0IGNvbmN1cnJlbmN5ID0gdGhpcy5fcmVzb2x2ZUNvbmN1cnJlbmN5KHt9LCBqb2IucXVldWUpXG4gICAgLyoqIEB0eXBlIHtCYWNrZ3JvdW5kSm9iUXVldWVkQ29uY3VycmVuY3l9ICovXG4gICAgY29uc3QgY3VycmVudCA9IGNvbmN1cnJlbmN5XG4gICAgICA/IHtjb25jdXJyZW5jeUtleTogY29uY3VycmVuY3kuY29uY3VycmVuY3lLZXksIG1heENvbmN1cnJlbmN5OiBjb25jdXJyZW5jeS5tYXhDb25jdXJyZW5jeX1cbiAgICAgIDoge2NvbmN1cnJlbmN5S2V5OiBudWxsLCBtYXhDb25jdXJyZW5jeTogbnVsbH1cblxuICAgIGlmIChjb25jdXJyZW5jeSkgYXdhaXQgdGhpcy5fZW5zdXJlUXVldWVDb25jdXJyZW5jeUtleShkYiwgY29uY3VycmVuY3kpXG4gICAgaWYgKGpvYi5jb25jdXJyZW5jeUtleSA9PT0gY3VycmVudC5jb25jdXJyZW5jeUtleSAmJiBqb2IubWF4Q29uY3VycmVuY3kgPT09IGN1cnJlbnQubWF4Q29uY3VycmVuY3kpIHJldHVybiBqb2JcblxuICAgIGNvbnN0IGFmZmVjdGVkUm93cyA9IGF3YWl0IHRoaXMuX3VwZGF0ZUFmZmVjdGVkUm93cyhkYiwge1xuICAgICAgdGFibGVOYW1lOiBKT0JTX1RBQkxFLFxuICAgICAgZGF0YToge1xuICAgICAgICBjb25jdXJyZW5jeV9rZXk6IGN1cnJlbnQuY29uY3VycmVuY3lLZXksXG4gICAgICAgIG1heF9jb25jdXJyZW5jeTogY3VycmVudC5tYXhDb25jdXJyZW5jeVxuICAgICAgfSxcbiAgICAgIGNvbmRpdGlvbnM6IHtjb25jdXJyZW5jeV9rZXk6IGpvYi5jb25jdXJyZW5jeUtleSwgaWQ6IGpvYi5pZCwgc3RhdHVzOiBcInF1ZXVlZFwifVxuICAgIH0pXG5cbiAgICBpZiAoYWZmZWN0ZWRSb3dzICE9PSAxKSByZXR1cm4gbnVsbFxuXG4gICAgcmV0dXJuIHsuLi5qb2IsIGNvbmN1cnJlbmN5S2V5OiBjdXJyZW50LmNvbmN1cnJlbmN5S2V5LCBtYXhDb25jdXJyZW5jeTogY3VycmVudC5tYXhDb25jdXJyZW5jeX1cbiAgfVxuXG4gIC8qKlxuICAgKiBSZWFkcyB0aGUgY29uZmlndXJlZCBtYXggY29uY3VycmVuY3kgZm9yIGEgcXVldWUgZnJvbSB0aGUgYmFja2dyb3VuZC1qb2JzIGNvbmZpZy5cbiAgICogQHBhcmFtIHtzdHJpbmd9IHF1ZXVlIC0gUXVldWUgbmFtZS5cbiAgICogQHJldHVybnMge251bWJlciB8IG51bGx9IC0gUG9zaXRpdmUgaW50ZWdlciBjYXAsIG9yIG51bGwgd2hlbiB0aGUgcXVldWUgaGFzIG5vIGNvbmZpZ3VyZWQgY2FwLlxuICAgKi9cbiAgX3F1ZXVlTWF4Q29uY3VycmVuY3kocXVldWUpIHtcbiAgICBjb25zdCBxdWV1ZXMgPSB0aGlzLmNvbmZpZ3VyYXRpb24uZ2V0QmFja2dyb3VuZEpvYnNDb25maWcoKS5xdWV1ZXNcbiAgICBjb25zdCBjYXAgPSBxdWV1ZXM/LltxdWV1ZV0/Lm1heENvbmN1cnJlbnRcblxuICAgIGlmIChOdW1iZXIuaXNJbnRlZ2VyKGNhcCkgJiYgTnVtYmVyKGNhcCkgPiAwKSByZXR1cm4gTnVtYmVyKGNhcClcblxuICAgIHJldHVybiBudWxsXG4gIH1cblxuICAvKipcbiAgICogTGlrZSB7QGxpbmsgX2Vuc3VyZUNvbmN1cnJlbmN5S2V5fSwgYnV0IGZvciBxdWV1ZS1kZXJpdmVkIGtleXMgdGhlIGNvbmZpZ3VyZWRcbiAgICogcXVldWUgY2FwIGlzIHRoZSBzb3VyY2Ugb2YgdHJ1dGg6IGlmIGl0IGNoYW5nZWQsIHVwZGF0ZSB0aGUgc3RvcmVkIGNhcFxuICAgKiBpbnN0ZWFkIG9mIHRocm93aW5nIG9uIGNvbmZsaWN0IChjb25maWctZHJpdmVuIGNhcHMgbXVzdCBiZSB0dW5hYmxlKS5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9kYXRhYmFzZS9kcml2ZXJzL2Jhc2UuanNcIikuZGVmYXVsdH0gZGIgLSBEYXRhYmFzZSBjb25uZWN0aW9uLlxuICAgKiBAcGFyYW0ge3tjb25jdXJyZW5jeUtleTogc3RyaW5nLCBtYXhDb25jdXJyZW5jeTogbnVtYmVyfX0gY29uY3VycmVuY3kgLSBDb25jdXJyZW5jeSBjb25maWd1cmF0aW9uLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyB3aGVuIGVuc3VyZWQuXG4gICAqL1xuICBhc3luYyBfZW5zdXJlUXVldWVDb25jdXJyZW5jeUtleShkYiwge2NvbmN1cnJlbmN5S2V5LCBtYXhDb25jdXJyZW5jeX0pIHtcbiAgICBjb25zdCByb3dzID0gYXdhaXQgZGIubmV3UXVlcnkoKS5mcm9tKENPTkNVUlJFTkNZX1RBQkxFKS53aGVyZSh7Y29uY3VycmVuY3lfa2V5OiBjb25jdXJyZW5jeUtleX0pLmxpbWl0KDEpLnJlc3VsdHMoKVxuXG4gICAgaWYgKCFyb3dzWzBdKSB7XG4gICAgICB0cnkge1xuICAgICAgICBhd2FpdCBkYi5pbnNlcnQoe3RhYmxlTmFtZTogQ09OQ1VSUkVOQ1lfVEFCTEUsIGRhdGE6IHthY3RpdmVfY291bnQ6IDAsIGNvbmN1cnJlbmN5X2tleTogY29uY3VycmVuY3lLZXksIG1heF9jb25jdXJyZW5jeTogbWF4Q29uY3VycmVuY3l9fSlcblxuICAgICAgICByZXR1cm5cbiAgICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICAgIGNvbnN0IHJhY2VkUm93cyA9IGF3YWl0IGRiLm5ld1F1ZXJ5KCkuZnJvbShDT05DVVJSRU5DWV9UQUJMRSkud2hlcmUoe2NvbmN1cnJlbmN5X2tleTogY29uY3VycmVuY3lLZXl9KS5saW1pdCgxKS5yZXN1bHRzKClcblxuICAgICAgICBpZiAoIXJhY2VkUm93c1swXSkgdGhyb3cgZXJyb3JcblxuICAgICAgICByb3dzWzBdID0gcmFjZWRSb3dzWzBdXG4gICAgICB9XG4gICAgfVxuXG4gICAgY29uc3QgY29uZmlndXJlZCA9IC8qKiBAdHlwZSB7e21heF9jb25jdXJyZW5jeT86IG51bWJlciB8IHN0cmluZ319ICovIChyb3dzWzBdKVxuXG4gICAgaWYgKHRoaXMuX25vcm1hbGl6ZU51bWJlcihjb25maWd1cmVkLm1heF9jb25jdXJyZW5jeSkgIT09IG1heENvbmN1cnJlbmN5KSB7XG4gICAgICBjb25zdCB0YWJsZSA9IGRiLnF1b3RlVGFibGUoQ09OQ1VSUkVOQ1lfVEFCTEUpXG5cbiAgICAgIGF3YWl0IGRiLnF1ZXJ5KGBVUERBVEUgJHt0YWJsZX0gU0VUICR7ZGIucXVvdGVDb2x1bW4oXCJtYXhfY29uY3VycmVuY3lcIil9ID0gJHtOdW1iZXIobWF4Q29uY3VycmVuY3kpfSBXSEVSRSAke2RiLnF1b3RlQ29sdW1uKFwiY29uY3VycmVuY3lfa2V5XCIpfSA9ICR7ZGIucXVvdGUoY29uY3VycmVuY3lLZXkpfWApXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIEVuc3VyZXMgdGhlIGNvbmN1cnJlbmN5IHN0YXRlIHRhYmxlIGV4aXN0cy5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9kYXRhYmFzZS9kcml2ZXJzL2Jhc2UuanNcIikuZGVmYXVsdH0gZGIgLSBEYXRhYmFzZSBjb25uZWN0aW9uLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyB3aGVuIHJlYWR5LlxuICAgKi9cbiAgYXN5bmMgX2Vuc3VyZUNvbmN1cnJlbmN5VGFibGUoZGIpIHtcbiAgICBpZiAoYXdhaXQgZGIudGFibGVFeGlzdHMoQ09OQ1VSUkVOQ1lfVEFCTEUpKSByZXR1cm5cbiAgICBjb25zdCB0YWJsZSA9IG5ldyBUYWJsZURhdGEoQ09OQ1VSUkVOQ1lfVEFCTEUsIHtpZk5vdEV4aXN0czogdHJ1ZX0pXG4gICAgdGFibGUuc3RyaW5nKFwiY29uY3VycmVuY3lfa2V5XCIsIHtwcmltYXJ5S2V5OiB0cnVlfSlcbiAgICB0YWJsZS5pbnRlZ2VyKFwibWF4X2NvbmN1cnJlbmN5XCIsIHtudWxsOiBmYWxzZX0pXG4gICAgdGFibGUuaW50ZWdlcihcImFjdGl2ZV9jb3VudFwiLCB7bnVsbDogZmFsc2V9KVxuICAgIGF3YWl0IGRiLmNyZWF0ZVRhYmxlKHRhYmxlKVxuICB9XG5cbiAgLyoqXG4gICAqIEVuc3VyZXMgdGhlIHN0YWJsZSBzY2hlZHVsZS1rZXkgb3duZXJzaGlwIHRhYmxlIGV4aXN0cy5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9kYXRhYmFzZS9kcml2ZXJzL2Jhc2UuanNcIikuZGVmYXVsdH0gZGIgLSBEYXRhYmFzZSBjb25uZWN0aW9uLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyB3aGVuIHJlYWR5LlxuICAgKi9cbiAgYXN5bmMgX2Vuc3VyZVNjaGVkdWxlS2V5c1RhYmxlKGRiKSB7XG4gICAgaWYgKGF3YWl0IGRiLnRhYmxlRXhpc3RzKFNDSEVEVUxFX0tFWVNfVEFCTEUpKSByZXR1cm5cblxuICAgIGNvbnN0IGxvY2tOYW1lID0gYCR7TUlHUkFUSU9OX1NDT1BFfTpzY2hlZHVsZV9rZXlzX3RhYmxlYFxuICAgIGNvbnN0IGFjcXVpcmVkID0gYXdhaXQgZGIuYWNxdWlyZUFkdmlzb3J5TG9jayhsb2NrTmFtZSlcblxuICAgIGlmICghYWNxdWlyZWQpIHRocm93IG5ldyBFcnJvcihcIkZhaWxlZCB0byBhY3F1aXJlIGJhY2tncm91bmQgam9icyBzY2hlZHVsZS1rZXkgdGFibGUgc2NoZW1hIGxvY2tcIilcblxuICAgIHRyeSB7XG4gICAgICBkYi5jbGVhclNjaGVtYUNhY2hlKClcbiAgICAgIGlmIChhd2FpdCBkYi50YWJsZUV4aXN0cyhTQ0hFRFVMRV9LRVlTX1RBQkxFKSkgcmV0dXJuXG5cbiAgICAgIGNvbnN0IHRhYmxlID0gbmV3IFRhYmxlRGF0YShTQ0hFRFVMRV9LRVlTX1RBQkxFLCB7aWZOb3RFeGlzdHM6IHRydWV9KVxuXG4gICAgICB0YWJsZS5zdHJpbmcoXCJzY2hlZHVsZV9rZXlcIiwge3ByaW1hcnlLZXk6IHRydWV9KVxuICAgICAgdGFibGUuc3RyaW5nKFwiam9iX2lkXCIsIHtudWxsOiBmYWxzZSwgaW5kZXg6IHRydWV9KVxuICAgICAgYXdhaXQgZGIuY3JlYXRlVGFibGUodGFibGUpXG4gICAgICBkYi5jbGVhclNjaGVtYUNhY2hlKClcbiAgICB9IGZpbmFsbHkge1xuICAgICAgYXdhaXQgZGIucmVsZWFzZUFkdmlzb3J5TG9jayhsb2NrTmFtZSlcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogRW5zdXJlcyBkdXJhYmxlIGdlbmVyaWMgZW5xdWV1ZSBvd25lcnNoaXAgZXhpc3RzIGluZGVwZW5kZW50bHkgb2Ygam9iIHJvd3MuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vZGF0YWJhc2UvZHJpdmVycy9iYXNlLmpzXCIpLmRlZmF1bHR9IGRiIC0gRGF0YWJhc2UgY29ubmVjdGlvbi5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgd2hlbiByZWFkeS5cbiAgICovXG4gIGFzeW5jIF9lbnN1cmVJZGVtcG90ZW5jeUtleXNUYWJsZShkYikge1xuICAgIGlmIChhd2FpdCBkYi50YWJsZUV4aXN0cyhJREVNUE9URU5DWV9LRVlTX1RBQkxFKSkgcmV0dXJuXG5cbiAgICBjb25zdCBsb2NrTmFtZSA9IGAke01JR1JBVElPTl9TQ09QRX06aWRlbXBvdGVuY3lfa2V5c190YWJsZWBcbiAgICBjb25zdCBhY3F1aXJlZCA9IGF3YWl0IGRiLmFjcXVpcmVBZHZpc29yeUxvY2sobG9ja05hbWUpXG5cbiAgICBpZiAoIWFjcXVpcmVkKSB0aHJvdyBuZXcgRXJyb3IoXCJGYWlsZWQgdG8gYWNxdWlyZSBiYWNrZ3JvdW5kIGpvYiBpZGVtcG90ZW5jeS1rZXkgdGFibGUgc2NoZW1hIGxvY2tcIilcblxuICAgIHRyeSB7XG4gICAgICBkYi5jbGVhclNjaGVtYUNhY2hlKClcbiAgICAgIGlmIChhd2FpdCBkYi50YWJsZUV4aXN0cyhJREVNUE9URU5DWV9LRVlTX1RBQkxFKSkgcmV0dXJuXG5cbiAgICAgIGNvbnN0IHRhYmxlID0gbmV3IFRhYmxlRGF0YShJREVNUE9URU5DWV9LRVlTX1RBQkxFLCB7aWZOb3RFeGlzdHM6IHRydWV9KVxuXG4gICAgICB0YWJsZS5zdHJpbmcoXCJzY29wZV9kaWdlc3RcIiwge3ByaW1hcnlLZXk6IHRydWV9KVxuICAgICAgdGFibGUuc3RyaW5nKFwiam9iX25hbWVcIiwge251bGw6IGZhbHNlfSlcbiAgICAgIHRhYmxlLnN0cmluZyhcInF1ZXVlXCIsIHtudWxsOiBmYWxzZX0pXG4gICAgICB0YWJsZS50ZXh0KFwiaWRlbXBvdGVuY3lfa2V5XCIsIHtudWxsOiBmYWxzZX0pXG4gICAgICB0YWJsZS5zdHJpbmcoXCJqb2JfaWRcIiwge2luZGV4OiB0cnVlLCBudWxsOiBmYWxzZX0pXG4gICAgICB0YWJsZS5zdHJpbmcoXCJyZXF1ZXN0X2RpZ2VzdFwiLCB7bnVsbDogZmFsc2V9KVxuICAgICAgdGFibGUuYmlnaW50KFwiY3JlYXRlZF9hdF9tc1wiLCB7bnVsbDogZmFsc2V9KVxuICAgICAgYXdhaXQgZGIuY3JlYXRlVGFibGUodGFibGUpXG4gICAgICBkYi5jbGVhclNjaGVtYUNhY2hlKClcbiAgICB9IGZpbmFsbHkge1xuICAgICAgYXdhaXQgZGIucmVsZWFzZUFkdmlzb3J5TG9jayhsb2NrTmFtZSlcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogRW5zdXJlcyBkdXJhYmxlIHByb3ZpZGVyLWJhY2tlZCBtYWlsIG9wZXJhdGlvbiBzdGF0ZSBleGlzdHMgaW5kZXBlbmRlbnRseSBvZiBqb2JzLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL2RhdGFiYXNlL2RyaXZlcnMvYmFzZS5qc1wiKS5kZWZhdWx0fSBkYiAtIERhdGFiYXNlIGNvbm5lY3Rpb24uXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIHdoZW4gcmVhZHkuXG4gICAqL1xuICBhc3luYyBfZW5zdXJlTWFpbERlbGl2ZXJ5T3BlcmF0aW9uc1RhYmxlKGRiKSB7XG4gICAgaWYgKGF3YWl0IGRiLnRhYmxlRXhpc3RzKE1BSUxfREVMSVZFUllfT1BFUkFUSU9OU19UQUJMRSkpIHJldHVyblxuXG4gICAgY29uc3QgbG9ja05hbWUgPSBgJHtNSUdSQVRJT05fU0NPUEV9Om1haWxfZGVsaXZlcnlfb3BlcmF0aW9uc190YWJsZWBcbiAgICBjb25zdCBhY3F1aXJlZCA9IGF3YWl0IGRiLmFjcXVpcmVBZHZpc29yeUxvY2sobG9ja05hbWUpXG5cbiAgICBpZiAoIWFjcXVpcmVkKSB0aHJvdyBuZXcgRXJyb3IoXCJGYWlsZWQgdG8gYWNxdWlyZSBtYWlsIGRlbGl2ZXJ5IG9wZXJhdGlvbiB0YWJsZSBzY2hlbWEgbG9ja1wiKVxuXG4gICAgdHJ5IHtcbiAgICAgIGRiLmNsZWFyU2NoZW1hQ2FjaGUoKVxuICAgICAgaWYgKGF3YWl0IGRiLnRhYmxlRXhpc3RzKE1BSUxfREVMSVZFUllfT1BFUkFUSU9OU19UQUJMRSkpIHJldHVyblxuXG4gICAgICBjb25zdCB0YWJsZSA9IG5ldyBUYWJsZURhdGEoTUFJTF9ERUxJVkVSWV9PUEVSQVRJT05TX1RBQkxFLCB7aWZOb3RFeGlzdHM6IHRydWV9KVxuXG4gICAgICB0YWJsZS5zdHJpbmcoXCJvcGVyYXRpb25fa2V5XCIsIHtwcmltYXJ5S2V5OiB0cnVlfSlcbiAgICAgIHRhYmxlLnRleHQoXCJvcGVyYXRpb25faWRcIiwge251bGw6IGZhbHNlfSlcbiAgICAgIHRhYmxlLnN0cmluZyhcInBheWxvYWRfZGlnZXN0XCIsIHtudWxsOiBmYWxzZX0pXG4gICAgICB0YWJsZS5zdHJpbmcoXCJiYWNrZ3JvdW5kX2pvYl9pZFwiLCB7aW5kZXg6IHRydWUsIG51bGw6IGZhbHNlfSlcbiAgICAgIHRhYmxlLmJpZ2ludChcImZpcnN0X2F0dGVtcHRfc3RhcnRlZF9hdF9tc1wiLCB7bnVsbDogdHJ1ZX0pXG4gICAgICB0YWJsZS5zdHJpbmcoXCJwcm92aWRlcl9raW5kXCIsIHtudWxsOiBmYWxzZX0pXG4gICAgICB0YWJsZS5iaWdpbnQoXCJwcm92aWRlcl9yZXRlbnRpb25fbXNcIiwge251bGw6IGZhbHNlfSlcbiAgICAgIHRhYmxlLmJpZ2ludChcImNyZWF0ZWRfYXRfbXNcIiwge251bGw6IGZhbHNlfSlcbiAgICAgIGF3YWl0IGRiLmNyZWF0ZVRhYmxlKHRhYmxlKVxuICAgICAgZGIuY2xlYXJTY2hlbWFDYWNoZSgpXG4gICAgfSBmaW5hbGx5IHtcbiAgICAgIGF3YWl0IGRiLnJlbGVhc2VBZHZpc29yeUxvY2sobG9ja05hbWUpXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIEVuc3VyZXMgdGhlIHNpbmdsZXRvbiBkdXJhYmxlIGNvdW50LXJldmlzaW9uIHJvdyBleGlzdHMuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vZGF0YWJhc2UvZHJpdmVycy9iYXNlLmpzXCIpLmRlZmF1bHR9IGRiIC0gRGF0YWJhc2UgY29ubmVjdGlvbi5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IFJlc29sdmVzIHdoZW4gcmVhZHkuXG4gICAqL1xuICBhc3luYyBfZW5zdXJlQ291bnRSZXZpc2lvblRhYmxlKGRiKSB7XG4gICAgaWYgKCEoYXdhaXQgZGIudGFibGVFeGlzdHMoQ09VTlRTX1JFVklTSU9OX1RBQkxFKSkpIHtcbiAgICAgIGNvbnN0IHRhYmxlID0gbmV3IFRhYmxlRGF0YShDT1VOVFNfUkVWSVNJT05fVEFCTEUsIHtpZk5vdEV4aXN0czogdHJ1ZX0pXG5cbiAgICAgIHRhYmxlLnN0cmluZyhcImtleVwiLCB7cHJpbWFyeUtleTogdHJ1ZX0pXG4gICAgICB0YWJsZS5iaWdpbnQoXCJyZXZpc2lvblwiLCB7bnVsbDogZmFsc2V9KVxuICAgICAgYXdhaXQgZGIuY3JlYXRlVGFibGUodGFibGUpXG4gICAgfVxuXG4gICAgY29uc3Qgcm93cyA9IGF3YWl0IGRiLm5ld1F1ZXJ5KCkuZnJvbShDT1VOVFNfUkVWSVNJT05fVEFCTEUpLndoZXJlKHtrZXk6IENPVU5UU19SRVZJU0lPTl9LRVl9KS5saW1pdCgxKS5yZXN1bHRzKClcblxuICAgIGlmIChyb3dzLmxlbmd0aCA+IDApIHJldHVyblxuXG4gICAgdHJ5IHtcbiAgICAgIGF3YWl0IGRiLmluc2VydCh7dGFibGVOYW1lOiBDT1VOVFNfUkVWSVNJT05fVEFCTEUsIGRhdGE6IHtrZXk6IENPVU5UU19SRVZJU0lPTl9LRVksIHJldmlzaW9uOiAwfX0pXG4gICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgIGNvbnN0IHJhY2VkUm93cyA9IGF3YWl0IGRiLm5ld1F1ZXJ5KCkuZnJvbShDT1VOVFNfUkVWSVNJT05fVEFCTEUpLndoZXJlKHtrZXk6IENPVU5UU19SRVZJU0lPTl9LRVl9KS5saW1pdCgxKS5yZXN1bHRzKClcblxuICAgICAgaWYgKHJhY2VkUm93cy5sZW5ndGggPT09IDApIHRocm93IGVycm9yXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIFJlY29yZHMgb25lIGxvZ2ljYWwgY291bnQgbXV0YXRpb24gYXRvbWljYWxseSBhbmQgYnJvYWRjYXN0cyBpdCBhZnRlciBjb21taXQuXG4gICAqIFplcm8gZW50cmllcyBhcmUgb21pdHRlZDsgYSB3aG9sbHkgemVyby1uZXQgbXV0YXRpb24gZG9lcyBub3QgY29uc3VtZSBhIHJldmlzaW9uLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL2RhdGFiYXNlL2RyaXZlcnMvYmFzZS5qc1wiKS5kZWZhdWx0fSBkYiAtIFRyYW5zYWN0aW9uIGNvbm5lY3Rpb24uXG4gICAqIEBwYXJhbSB7UmVjb3JkPHN0cmluZywgbnVtYmVyPn0gcmVxdWVzdGVkRGVsdGFzIC0gU2lnbmVkIGJ1Y2tldCBjaGFuZ2VzLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gUmVzb2x2ZXMgd2hlbiByZWNvcmRlZC5cbiAgICovXG4gIGFzeW5jIF9yZWNvcmRDb3VudERlbHRhKGRiLCByZXF1ZXN0ZWREZWx0YXMpIHtcbiAgICAvKiogQHR5cGUge1JlY29yZDxzdHJpbmcsIG51bWJlcj59ICovXG4gICAgY29uc3QgZGVsdGFzID0ge31cblxuICAgIGZvciAoY29uc3QgYnVja2V0IG9mIEJBQ0tHUk9VTkRfSk9CX0NPVU5UX0JVQ0tFVFMpIHtcbiAgICAgIGNvbnN0IGFtb3VudCA9IHJlcXVlc3RlZERlbHRhc1tidWNrZXRdIHx8IDBcblxuICAgICAgaWYgKCFOdW1iZXIuaXNJbnRlZ2VyKGFtb3VudCkpIHRocm93IG5ldyBFcnJvcihgSW52YWxpZCBiYWNrZ3JvdW5kIGpvYiBjb3VudCBkZWx0YSBmb3IgJHtidWNrZXR9OiAke2Ftb3VudH1gKVxuICAgICAgaWYgKGFtb3VudCAhPT0gMCkgZGVsdGFzW2J1Y2tldF0gPSBhbW91bnRcbiAgICB9XG5cbiAgICBpZiAoT2JqZWN0LmtleXMoZGVsdGFzKS5sZW5ndGggPT09IDApIHJldHVyblxuXG4gICAgY29uc3QgdGFibGUgPSBkYi5xdW90ZVRhYmxlKENPVU5UU19SRVZJU0lPTl9UQUJMRSlcbiAgICBjb25zdCByZXZpc2lvbkNvbHVtbiA9IGRiLnF1b3RlQ29sdW1uKFwicmV2aXNpb25cIilcbiAgICBjb25zdCBhZmZlY3RlZFJvd3MgPSBhd2FpdCBkYi5hZmZlY3RlZFJvd3MoXG4gICAgICBgVVBEQVRFICR7dGFibGV9IFNFVCAke3JldmlzaW9uQ29sdW1ufSA9ICR7cmV2aXNpb25Db2x1bW59ICsgMSBXSEVSRSAke2RiLnF1b3RlQ29sdW1uKFwia2V5XCIpfSA9ICR7ZGIucXVvdGUoQ09VTlRTX1JFVklTSU9OX0tFWSl9YFxuICAgIClcblxuICAgIGlmIChhZmZlY3RlZFJvd3MgIT09IDEpIHRocm93IG5ldyBFcnJvcihcIkJhY2tncm91bmQgam9iIGNvdW50IHJldmlzaW9uIHJvdyBpcyBtaXNzaW5nXCIpXG5cbiAgICBjb25zdCByZXZpc2lvbiA9IGF3YWl0IHRoaXMuX2NvdW50UmV2aXNpb24oZGIpXG4gICAgY29uc3QgYm9keSA9IHtkZWx0YXMsIHJldmlzaW9uLCB0eXBlOiBcImJhY2tncm91bmQtam9iLWNvdW50LWRlbHRhXCJ9XG4gICAgY29uc3QgZGF0YWJhc2VJZGVudGlmaWVyID0gdGhpcy5nZXREYXRhYmFzZUlkZW50aWZpZXIoKSB8fCBcImRlZmF1bHRcIlxuXG4gICAgYXdhaXQgZGIuYWZ0ZXJDb21taXQoKCkgPT4ge1xuICAgICAgdGhpcy5jb25maWd1cmF0aW9uLmJyb2FkY2FzdFRvQ2hhbm5lbChCQUNLR1JPVU5EX0pPQl9DT1VOVFNfQ0hBTk5FTCwge2RhdGFiYXNlSWRlbnRpZmllcn0sIGJvZHkpXG4gICAgfSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSZWNvcmRzIGEgdHJhbnNpdGlvbiBiZXR3ZWVuIHBlcnNpc3RlZCBzdGF0dXNlcy5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9kYXRhYmFzZS9kcml2ZXJzL2Jhc2UuanNcIikuZGVmYXVsdH0gZGIgLSBUcmFuc2FjdGlvbiBjb25uZWN0aW9uLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gb2xkU3RhdHVzIC0gUHJldmlvdXMgc3RhdHVzLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gbmV3U3RhdHVzIC0gTmV3IHN0YXR1cy5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IFJlc29sdmVzIHdoZW4gcmVjb3JkZWQuXG4gICAqL1xuICBhc3luYyBfcmVjb3JkU3RhdHVzVHJhbnNpdGlvbihkYiwgb2xkU3RhdHVzLCBuZXdTdGF0dXMpIHtcbiAgICBjb25zdCBvbGRDb3VudGVkID0gQ09VTlRFRF9KT0JfU1RBVFVTRVMuaW5jbHVkZXMob2xkU3RhdHVzKVxuICAgIGNvbnN0IG5ld0NvdW50ZWQgPSBDT1VOVEVEX0pPQl9TVEFUVVNFUy5pbmNsdWRlcyhuZXdTdGF0dXMpXG5cbiAgICBpZiAoIW9sZENvdW50ZWQgJiYgb2xkU3RhdHVzICE9PSBcImNhbmNlbGxlZFwiKSB0aHJvdyBuZXcgRXJyb3IoYFVua25vd24gcHJldmlvdXMgYmFja2dyb3VuZCBqb2Igc3RhdHVzOiAke29sZFN0YXR1c31gKVxuICAgIGlmICghbmV3Q291bnRlZCAmJiBuZXdTdGF0dXMgIT09IFwiY2FuY2VsbGVkXCIpIHRocm93IG5ldyBFcnJvcihgVW5rbm93biBuZXh0IGJhY2tncm91bmQgam9iIHN0YXR1czogJHtuZXdTdGF0dXN9YClcbiAgICBpZiAob2xkU3RhdHVzID09PSBuZXdTdGF0dXMpIHJldHVyblxuXG4gICAgLyoqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBudW1iZXI+fSAqL1xuICAgIGNvbnN0IGRlbHRhcyA9IHt9XG5cbiAgICBpZiAob2xkQ291bnRlZCkgZGVsdGFzW29sZFN0YXR1c10gPSAtMVxuICAgIGlmIChuZXdDb3VudGVkKSBkZWx0YXNbbmV3U3RhdHVzXSA9IDFcbiAgICBpZiAob2xkQ291bnRlZCAhPT0gbmV3Q291bnRlZCkgZGVsdGFzLmFsbCA9IG5ld0NvdW50ZWQgPyAxIDogLTFcbiAgICBhd2FpdCB0aGlzLl9yZWNvcmRDb3VudERlbHRhKGRiLCBkZWx0YXMpXG4gIH1cblxuICAvKipcbiAgICogUmVhZHMgdGhlIGxvY2tlZCByZXZpc2lvbi5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9kYXRhYmFzZS9kcml2ZXJzL2Jhc2UuanNcIikuZGVmYXVsdH0gZGIgLSBEYXRhYmFzZSBjb25uZWN0aW9uLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxudW1iZXI+fSBSZXZpc2lvbi5cbiAgICovXG4gIGFzeW5jIF9jb3VudFJldmlzaW9uKGRiKSB7XG4gICAgY29uc3Qgcm93cyA9IGF3YWl0IGRiLm5ld1F1ZXJ5KCkuZnJvbShDT1VOVFNfUkVWSVNJT05fVEFCTEUpLnNlbGVjdChcInJldmlzaW9uXCIpLndoZXJlKHtrZXk6IENPVU5UU19SRVZJU0lPTl9LRVl9KS5saW1pdCgxKS5yZXN1bHRzKClcbiAgICBjb25zdCByZXZpc2lvbiA9IHRoaXMuX25vcm1hbGl6ZU51bWJlcigvKiogQHR5cGUge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gKi8gKHJvd3NbMF0gfHwge30pLnJldmlzaW9uKVxuXG4gICAgaWYgKHJldmlzaW9uID09PSBudWxsIHx8ICFOdW1iZXIuaXNTYWZlSW50ZWdlcihyZXZpc2lvbikgfHwgcmV2aXNpb24gPCAwKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoYEludmFsaWQgYmFja2dyb3VuZCBqb2IgY291bnQgcmV2aXNpb246ICR7cmV2aXNpb259YClcbiAgICB9XG5cbiAgICByZXR1cm4gcmV2aXNpb25cbiAgfVxuXG4gIC8qKlxuICAgKiBUYWtlcyBhIHBvcnRhYmxlIHdyaXRlIGxvY2sgb24gdGhlIHNpbmdsZXRvbiByZXZpc2lvbiByb3cuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vZGF0YWJhc2UvZHJpdmVycy9iYXNlLmpzXCIpLmRlZmF1bHR9IGRiIC0gRGF0YWJhc2UgY29ubmVjdGlvbi5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IFJlc29sdmVzIHdoZW4gbG9ja2VkLlxuICAgKi9cbiAgYXN5bmMgX2xvY2tDb3VudFJldmlzaW9uKGRiKSB7XG4gICAgY29uc3QgdGFibGUgPSBkYi5xdW90ZVRhYmxlKENPVU5UU19SRVZJU0lPTl9UQUJMRSlcbiAgICBjb25zdCByZXZpc2lvbiA9IGRiLnF1b3RlQ29sdW1uKFwicmV2aXNpb25cIilcblxuICAgIGF3YWl0IGRiLnF1ZXJ5KGBVUERBVEUgJHt0YWJsZX0gU0VUICR7cmV2aXNpb259ID0gJHtyZXZpc2lvbn0gV0hFUkUgJHtkYi5xdW90ZUNvbHVtbihcImtleVwiKX0gPSAke2RiLnF1b3RlKENPVU5UU19SRVZJU0lPTl9LRVkpfWApXG4gIH1cblxuICAvKipcbiAgICogQnVpbGRzIHplcm9lZCBjYW5vbmljYWwgYnVja2V0cy5cbiAgICogQHJldHVybnMge1JlY29yZDxzdHJpbmcsIG51bWJlcj59IFplcm9lZCBjYW5vbmljYWwgYnVja2V0cy5cbiAgICovXG4gIF9lbXB0eUNvdW50QnVja2V0cygpIHtcbiAgICByZXR1cm4gT2JqZWN0LmZyb21FbnRyaWVzKEJBQ0tHUk9VTkRfSk9CX0NPVU5UX0JVQ0tFVFMubWFwKChidWNrZXQpID0+IFtidWNrZXQsIDBdKSlcbiAgfVxuXG4gIC8qKlxuICAgKiBDb3VudHMgbm9ybWFsaXplZCByb3dzIGJ5IGNhbm9uaWNhbCBzdGF0dXMuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi90eXBlcy5qc1wiKS5CYWNrZ3JvdW5kSm9iUm93W119IGpvYnMgLSBKb2JzLlxuICAgKiBAcmV0dXJucyB7UmVjb3JkPHN0cmluZywgbnVtYmVyPn0gQ291bnRzLlxuICAgKi9cbiAgX3N0YXR1c0NvdW50cyhqb2JzKSB7XG4gICAgLyoqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBudW1iZXI+fSAqL1xuICAgIGNvbnN0IGNvdW50cyA9IHt9XG5cbiAgICBmb3IgKGNvbnN0IGpvYiBvZiBqb2JzKSB7XG4gICAgICBpZiAoIUNPVU5URURfSk9CX1NUQVRVU0VTLmluY2x1ZGVzKGpvYi5zdGF0dXMpKSB0aHJvdyBuZXcgRXJyb3IoYFVua25vd24gYmFja2dyb3VuZCBqb2Igc3RhdHVzOiAke2pvYi5zdGF0dXN9YClcbiAgICAgIGNvdW50c1tqb2Iuc3RhdHVzXSA9IChjb3VudHNbam9iLnN0YXR1c10gfHwgMCkgKyAxXG4gICAgfVxuXG4gICAgcmV0dXJuIGNvdW50c1xuICB9XG5cbiAgLyoqXG4gICAqIFJlYWRzIGEgY2Fub25pY2FsIHNuYXBzaG90IGFmdGVyIGxvY2tpbmcgdGhlIHJldmlzaW9uIHJvdy5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9kYXRhYmFzZS9kcml2ZXJzL2Jhc2UuanNcIikuZGVmYXVsdH0gZGIgLSBUcmFuc2FjdGlvbiBjb25uZWN0aW9uLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx7Y291bnRzOiBSZWNvcmQ8c3RyaW5nLCBudW1iZXI+LCByZXZpc2lvbjogbnVtYmVyLCB0b3RhbDogbnVtYmVyfT59IFNuYXBzaG90LlxuICAgKi9cbiAgYXN5bmMgX2NvdW50U25hcHNob3RPbkxvY2tlZENvbm5lY3Rpb24oZGIpIHtcbiAgICBjb25zdCByb3dzID0gYXdhaXQgZGIubmV3UXVlcnkoKS5mcm9tKEpPQlNfVEFCTEUpLnNlbGVjdChcInN0YXR1c1wiKS5zZWxlY3QoXCJDT1VOVCgqKSBBUyBjb3VudFwiKS5ncm91cChcInN0YXR1c1wiKS5yZXN1bHRzKClcbiAgICBjb25zdCBjb3VudHMgPSB0aGlzLl9lbXB0eUNvdW50QnVja2V0cygpXG4gICAgbGV0IHRvdGFsID0gMFxuXG4gICAgZm9yIChjb25zdCByb3cgb2Ygcm93cykge1xuICAgICAgY29uc3QgdHlwZWRSb3cgPSAvKiogQHR5cGUge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gKi8gKHJvdylcbiAgICAgIGNvbnN0IHN0YXR1cyA9IFN0cmluZyh0eXBlZFJvdy5zdGF0dXMpXG4gICAgICBjb25zdCBjb3VudCA9IHRoaXMuX25vcm1hbGl6ZU51bWJlcih0eXBlZFJvdy5jb3VudCkgfHwgMFxuXG4gICAgICB0b3RhbCArPSBjb3VudFxuXG4gICAgICBpZiAoIUNPVU5URURfSk9CX1NUQVRVU0VTLmluY2x1ZGVzKHN0YXR1cykpIGNvbnRpbnVlXG4gICAgICBjb3VudHNbc3RhdHVzXSA9IGNvdW50XG4gICAgICBjb3VudHMuYWxsICs9IGNvdW50c1tzdGF0dXNdXG4gICAgfVxuXG4gICAgcmV0dXJuIHtjb3VudHMsIHJldmlzaW9uOiBhd2FpdCB0aGlzLl9jb3VudFJldmlzaW9uKGRiKSwgdG90YWx9XG4gIH1cblxuICAvKipcbiAgICogUmVnaXN0ZXJzIG9yIHZlcmlmaWVzIGEgc3RhYmxlIGtleSBjb25maWd1cmF0aW9uLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL2RhdGFiYXNlL2RyaXZlcnMvYmFzZS5qc1wiKS5kZWZhdWx0fSBkYiAtIERhdGFiYXNlIGNvbm5lY3Rpb24uXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBjb25jdXJyZW5jeSAtIENvbmN1cnJlbmN5IGNvbmZpZ3VyYXRpb24uXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBjb25jdXJyZW5jeS5jb25jdXJyZW5jeUtleSAtIENvbmN1cnJlbmN5IGtleS5cbiAgICogQHBhcmFtIHtudW1iZXJ9IGNvbmN1cnJlbmN5Lm1heENvbmN1cnJlbmN5IC0gU3RhYmxlIGNhcC5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgd2hlbiB2ZXJpZmllZC5cbiAgICovXG4gIGFzeW5jIF9lbnN1cmVDb25jdXJyZW5jeUtleShkYiwge2NvbmN1cnJlbmN5S2V5LCBtYXhDb25jdXJyZW5jeX0pIHtcbiAgICBjb25zdCByb3dzID0gYXdhaXQgZGIubmV3UXVlcnkoKS5mcm9tKENPTkNVUlJFTkNZX1RBQkxFKS53aGVyZSh7Y29uY3VycmVuY3lfa2V5OiBjb25jdXJyZW5jeUtleX0pLmxpbWl0KDEpLnJlc3VsdHMoKVxuICAgIGlmICghcm93c1swXSkge1xuICAgICAgdHJ5IHtcbiAgICAgICAgYXdhaXQgZGIuaW5zZXJ0KHt0YWJsZU5hbWU6IENPTkNVUlJFTkNZX1RBQkxFLCBkYXRhOiB7YWN0aXZlX2NvdW50OiAwLCBjb25jdXJyZW5jeV9rZXk6IGNvbmN1cnJlbmN5S2V5LCBtYXhfY29uY3VycmVuY3k6IG1heENvbmN1cnJlbmN5fX0pXG4gICAgICAgIHJldHVyblxuICAgICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgICAgY29uc3QgcmFjZWRSb3dzID0gYXdhaXQgZGIubmV3UXVlcnkoKS5mcm9tKENPTkNVUlJFTkNZX1RBQkxFKS53aGVyZSh7Y29uY3VycmVuY3lfa2V5OiBjb25jdXJyZW5jeUtleX0pLmxpbWl0KDEpLnJlc3VsdHMoKVxuICAgICAgICBpZiAoIXJhY2VkUm93c1swXSkgdGhyb3cgZXJyb3JcbiAgICAgICAgcm93c1swXSA9IHJhY2VkUm93c1swXVxuICAgICAgfVxuICAgIH1cbiAgICBjb25zdCBjb25maWd1cmVkID0gLyoqIEB0eXBlIHt7bWF4X2NvbmN1cnJlbmN5PzogbnVtYmVyIHwgc3RyaW5nfX0gKi8gKHJvd3NbMF0pXG4gICAgaWYgKHRoaXMuX25vcm1hbGl6ZU51bWJlcihjb25maWd1cmVkLm1heF9jb25jdXJyZW5jeSkgIT09IG1heENvbmN1cnJlbmN5KSB0aHJvdyBuZXcgRXJyb3IoYENvbmZsaWN0aW5nIG1heENvbmN1cnJlbmN5IGZvciBiYWNrZ3JvdW5kIGpvYiBjb25jdXJyZW5jeUtleTogJHtjb25jdXJyZW5jeUtleX1gKVxuICB9XG5cbiAgLyoqXG4gICAqIExvY2tzIHRoZSBjb25jdXJyZW5jeSBjb3VudGVyIHJvdyBzbyBhIGpvYi1yZWxlYXNlIHRyYW5zYWN0aW9uIGFjcXVpcmVzIGl0ICpiZWZvcmUqIHRoZSBqb2JcbiAgICogcm93LiB7QGxpbmsgbWFya0hhbmRlZE9mZn0gcmVzZXJ2ZXMgY2FwYWNpdHkgKGxvY2tpbmcgdGhlIGNvdW50ZXIgcm93KSBiZWZvcmUgaXQgdXBkYXRlcyB0aGVcbiAgICogam9iLCBzbyBpdCBsb2NrcyBjb25jdXJyZW5jeS10aGVuLWpvYjsgdGhlIHJlbGVhc2UgcGF0aHMgdXBkYXRlIHRoZSBqb2IgYmVmb3JlIHJlbGVhc2luZ1xuICAgKiBjYXBhY2l0eSwgd2hpY2ggaXMgam9iLXRoZW4tY29uY3VycmVuY3kuIFRob3NlIG9wcG9zaXRlIG9yZGVycyBvbiB0aGUgc2FtZSBzaGFyZWQgY291bnRlciByb3dcbiAgICogYXJlIHdoYXQgZGVhZGxvY2sgKEFCLUJBKSB1bmRlciBhIGRyYWluaW5nIHdvcmtlci4gVGFraW5nIHRoaXMgbG9jayBmaXJzdCBnaXZlcyBldmVyeVxuICAgKiB0cmFuc2FjdGlvbiBhIHNpbmdsZSBjb25jdXJyZW5jeS10aGVuLWpvYiBvcmRlciBhbmQgcmVtb3ZlcyB0aGUgY3ljbGUuXG4gICAqXG4gICAqIFVzZXMgYSB2YWx1ZS1wcmVzZXJ2aW5nIGBVUERBVEVgIHJhdGhlciB0aGFuIGBTRUxFQ1QgLi4uIEZPUiBVUERBVEVgIHNvIGl0IHN0YXlzIHBvcnRhYmxlXG4gICAqIGFjcm9zcyBkcml2ZXJzIHdpdGhvdXQgcm93LWxldmVsIGxvY2tpbmcgcmVhZHMgKGUuZy4gU1FMaXRlKTsgb24gcm93LWxvY2tpbmcgZW5naW5lcyB0aGVcbiAgICogbWF0Y2hlZCByb3cgaXMgd3JpdGUtbG9ja2VkIGZvciB0aGUgcmVzdCBvZiB0aGUgdHJhbnNhY3Rpb24gZXZlbiB0aG91Z2ggaXRzIHZhbHVlIGlzIHVuY2hhbmdlZC5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9kYXRhYmFzZS9kcml2ZXJzL2Jhc2UuanNcIikuZGVmYXVsdH0gZGIgLSBEYXRhYmFzZSBjb25uZWN0aW9uLlxuICAgKiBAcGFyYW0ge3N0cmluZyB8IG51bGx9IGNvbmN1cnJlbmN5S2V5IC0gQ29uY3VycmVuY3kga2V5LlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyB3aGVuIHRoZSBjb3VudGVyIHJvdyBpcyBsb2NrZWQuXG4gICAqL1xuICBhc3luYyBfbG9ja0NvbmN1cnJlbmN5Um93KGRiLCBjb25jdXJyZW5jeUtleSkge1xuICAgIGlmICghY29uY3VycmVuY3lLZXkpIHJldHVyblxuICAgIGNvbnN0IHRhYmxlID0gZGIucXVvdGVUYWJsZShDT05DVVJSRU5DWV9UQUJMRSlcbiAgICBjb25zdCBjb3VudCA9IGRiLnF1b3RlQ29sdW1uKFwiYWN0aXZlX2NvdW50XCIpXG4gICAgYXdhaXQgZGIucXVlcnkoYFVQREFURSAke3RhYmxlfSBTRVQgJHtjb3VudH0gPSAke2NvdW50fSBXSEVSRSAke2RiLnF1b3RlQ29sdW1uKFwiY29uY3VycmVuY3lfa2V5XCIpfSA9ICR7ZGIucXVvdGUoY29uY3VycmVuY3lLZXkpfWApXG4gIH1cblxuICAvKipcbiAgICogQXRvbWljYWxseSByZXNlcnZlcyBjYXBhY2l0eSBmb3IgYSBrZXkuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vZGF0YWJhc2UvZHJpdmVycy9iYXNlLmpzXCIpLmRlZmF1bHR9IGRiIC0gRGF0YWJhc2UgY29ubmVjdGlvbi5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGNvbmN1cnJlbmN5S2V5IC0gQ29uY3VycmVuY3kga2V5LlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxib29sZWFuPn0gLSBXaGV0aGVyIGNhcGFjaXR5IHdhcyByZXNlcnZlZC5cbiAgICovXG4gIGFzeW5jIF9yZXNlcnZlQ29uY3VycmVuY3koZGIsIGNvbmN1cnJlbmN5S2V5KSB7XG4gICAgY29uc3QgdGFibGUgPSBkYi5xdW90ZVRhYmxlKENPTkNVUlJFTkNZX1RBQkxFKVxuICAgIGNvbnN0IGNvdW50ID0gZGIucXVvdGVDb2x1bW4oXCJhY3RpdmVfY291bnRcIilcbiAgICBjb25zdCBhZmZlY3RlZFJvd3MgPSBhd2FpdCBkYi5hZmZlY3RlZFJvd3MoYFVQREFURSAke3RhYmxlfSBTRVQgJHtjb3VudH0gPSAke2NvdW50fSArIDEgV0hFUkUgJHtkYi5xdW90ZUNvbHVtbihcImNvbmN1cnJlbmN5X2tleVwiKX0gPSAke2RiLnF1b3RlKGNvbmN1cnJlbmN5S2V5KX0gQU5EICR7Y291bnR9IDwgJHtkYi5xdW90ZUNvbHVtbihcIm1heF9jb25jdXJyZW5jeVwiKX1gKVxuICAgIHJldHVybiBhZmZlY3RlZFJvd3MgPT09IDFcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGEgcG9ydGFibGUgdXBkYXRlIGFuZCByZXR1cm5zIGl0cyBhZmZlY3RlZC1yb3cgY291bnQuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vZGF0YWJhc2UvZHJpdmVycy9iYXNlLmpzXCIpLmRlZmF1bHR9IGRiIC0gRGF0YWJhc2UgY29ubmVjdGlvbi5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9kYXRhYmFzZS9kcml2ZXJzL2Jhc2UuanNcIikuVXBkYXRlU3FsQXJnc1R5cGV9IGFyZ3MgLSBVcGRhdGUgb3B0aW9ucy5cbiAgICogQHJldHVybnMge1Byb21pc2U8bnVtYmVyPn0gLSBBZmZlY3RlZCByb3cgY291bnQuXG4gICAqL1xuICBhc3luYyBfdXBkYXRlQWZmZWN0ZWRSb3dzKGRiLCBhcmdzKSB7XG4gICAgcmV0dXJuIGF3YWl0IGRiLmFmZmVjdGVkUm93cyhkYi51cGRhdGVTcWwoYXJncykpXG4gIH1cblxuICAvKipcbiAgICogUmVsZWFzZXMgY2FwYWNpdHkgZm9yIGEga2V5LlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL2RhdGFiYXNlL2RyaXZlcnMvYmFzZS5qc1wiKS5kZWZhdWx0fSBkYiAtIERhdGFiYXNlIGNvbm5lY3Rpb24uXG4gICAqIEBwYXJhbSB7c3RyaW5nIHwgbnVsbH0gY29uY3VycmVuY3lLZXkgLSBDb25jdXJyZW5jeSBrZXkuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIHdoZW4gcmVsZWFzZWQuXG4gICAqL1xuICBhc3luYyBfcmVsZWFzZUNvbmN1cnJlbmN5KGRiLCBjb25jdXJyZW5jeUtleSkge1xuICAgIGlmICghY29uY3VycmVuY3lLZXkpIHJldHVyblxuICAgIGNvbnN0IHRhYmxlID0gZGIucXVvdGVUYWJsZShDT05DVVJSRU5DWV9UQUJMRSlcbiAgICBjb25zdCBjb3VudCA9IGRiLnF1b3RlQ29sdW1uKFwiYWN0aXZlX2NvdW50XCIpXG4gICAgYXdhaXQgZGIucXVlcnkoYFVQREFURSAke3RhYmxlfSBTRVQgJHtjb3VudH0gPSAke2NvdW50fSAtIDEgV0hFUkUgJHtkYi5xdW90ZUNvbHVtbihcImNvbmN1cnJlbmN5X2tleVwiKX0gPSAke2RiLnF1b3RlKGNvbmN1cnJlbmN5S2V5KX0gQU5EICR7Y291bnR9ID4gMGApXG4gIH1cblxuICAvKipcbiAgICogUmVidWlsZHMgZHVyYWJsZSBjb3VudHMgZnJvbSBhY3RpdmUgaGFuZG9mZnMuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vZGF0YWJhc2UvZHJpdmVycy9iYXNlLmpzXCIpLmRlZmF1bHR9IGRiIC0gRGF0YWJhc2UgY29ubmVjdGlvbi5cbiAgICogQHBhcmFtIHt7aW5zaWRlVHJhbnNhY3Rpb24/OiBib29sZWFufX0gW29wdGlvbnNdIC0gUmV1c2UgYW4gZW5jbG9zaW5nIHRyYW5zYWN0aW9uLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxpbXBvcnQoXCIuL3R5cGVzLmpzXCIpLkJhY2tncm91bmRKb2JDb25jdXJyZW5jeVJlY29uY2lsaWF0aW9uPn0gLSBSZXBhaXIgc3VtbWFyeS5cbiAgICovXG4gIGFzeW5jIF9yZWNvbmNpbGVDb25jdXJyZW5jeShkYiwge2luc2lkZVRyYW5zYWN0aW9uID0gZmFsc2V9ID0ge30pIHtcbiAgICBpZiAoIShhd2FpdCBkYi50YWJsZUV4aXN0cyhDT05DVVJSRU5DWV9UQUJMRSkpKSB7XG4gICAgICByZXR1cm4ge2NhbmRpZGF0ZUNvdW50OiAwLCBjaGVja2VkQ291bnQ6IDAsIHJlcGFpcmVkQ291bnQ6IDAsIHJlcGFpcnM6IFtdLCByZXBhaXJzVHJ1bmNhdGVkQ291bnQ6IDB9XG4gICAgfVxuXG4gICAgY29uc3QgYWN0aXZlUm93cyA9IGF3YWl0IGRiXG4gICAgICAubmV3UXVlcnkoKVxuICAgICAgLmZyb20oSk9CU19UQUJMRSlcbiAgICAgIC5zZWxlY3QoXCJjb25jdXJyZW5jeV9rZXlcIilcbiAgICAgIC5zZWxlY3QoXCJDT1VOVCgqKSBBUyBhY3RpdmVfY291bnRcIilcbiAgICAgIC53aGVyZSh7c3RhdHVzOiBcImhhbmRlZF9vZmZcIn0pXG4gICAgICAud2hlcmUoYCR7ZGIucXVvdGVDb2x1bW4oXCJjb25jdXJyZW5jeV9rZXlcIil9IElTIE5PVCBOVUxMYClcbiAgICAgIC5ncm91cChcImNvbmN1cnJlbmN5X2tleVwiKVxuICAgICAgLnJlc3VsdHMoKVxuICAgIGNvbnN0IHN0YWxlUm93cyA9IGF3YWl0IGRiXG4gICAgICAubmV3UXVlcnkoKVxuICAgICAgLmZyb20oQ09OQ1VSUkVOQ1lfVEFCTEUpXG4gICAgICAuc2VsZWN0KFwiY29uY3VycmVuY3lfa2V5XCIpXG4gICAgICAuc2VsZWN0KFwiYWN0aXZlX2NvdW50XCIpXG4gICAgICAud2hlcmUoYCR7ZGIucXVvdGVDb2x1bW4oXCJhY3RpdmVfY291bnRcIil9ICE9IDBgKVxuICAgICAgLnJlc3VsdHMoKVxuICAgIC8qKiBAdHlwZSB7TWFwPHN0cmluZywgbnVtYmVyPn0gKi9cbiAgICBjb25zdCBhY3RpdmVDb3VudHMgPSBuZXcgTWFwKClcbiAgICAvKiogQHR5cGUge01hcDxzdHJpbmcsIG51bWJlcj59ICovXG4gICAgY29uc3QgcGVyc2lzdGVkQ291bnRzID0gbmV3IE1hcCgpXG5cbiAgICBmb3IgKGNvbnN0IHJhd1JvdyBvZiBhY3RpdmVSb3dzKSB7XG4gICAgICBjb25zdCByb3cgPSAvKiogQHR5cGUge0JhY2tncm91bmRKb2JDb25jdXJyZW5jeUNvdW50Um93fSAqLyAocmF3Um93KVxuICAgICAgYWN0aXZlQ291bnRzLnNldChyb3cuY29uY3VycmVuY3lfa2V5LCB0aGlzLl92YWxpZGF0ZWRDb25jdXJyZW5jeUNvdW50KHJvdy5hY3RpdmVfY291bnQsIHJvdy5jb25jdXJyZW5jeV9rZXkpKVxuICAgIH1cblxuICAgIGZvciAoY29uc3QgcmF3Um93IG9mIHN0YWxlUm93cykge1xuICAgICAgY29uc3Qgcm93ID0gLyoqIEB0eXBlIHtCYWNrZ3JvdW5kSm9iQ29uY3VycmVuY3lDb3VudFJvd30gKi8gKHJhd1JvdylcbiAgICAgIHBlcnNpc3RlZENvdW50cy5zZXQocm93LmNvbmN1cnJlbmN5X2tleSwgdGhpcy5fdmFsaWRhdGVkQ29uY3VycmVuY3lDb3VudChyb3cuYWN0aXZlX2NvdW50LCByb3cuY29uY3VycmVuY3lfa2V5KSlcbiAgICB9XG5cbiAgICBjb25zdCBjb25jdXJyZW5jeUtleXMgPSBbLi4ubmV3IFNldChbLi4uYWN0aXZlQ291bnRzLmtleXMoKSwgLi4ucGVyc2lzdGVkQ291bnRzLmtleXMoKV0pXS5zb3J0KClcbiAgICBjb25zdCBjYW5kaWRhdGVLZXlzID0gY29uY3VycmVuY3lLZXlzLmZpbHRlcigoY29uY3VycmVuY3lLZXkpID0+IHtcbiAgICAgIHJldHVybiAoYWN0aXZlQ291bnRzLmdldChjb25jdXJyZW5jeUtleSkgfHwgMCkgIT09IChwZXJzaXN0ZWRDb3VudHMuZ2V0KGNvbmN1cnJlbmN5S2V5KSB8fCAwKVxuICAgIH0pXG4gICAgLyoqIEB0eXBlIHtpbXBvcnQoXCIuL3R5cGVzLmpzXCIpLkJhY2tncm91bmRKb2JDb25jdXJyZW5jeVJlcGFpcltdfSAqL1xuICAgIGNvbnN0IHJlcGFpcnMgPSBbXVxuICAgIGxldCByZXBhaXJlZENvdW50ID0gMFxuXG4gICAgZm9yIChjb25zdCBjb25jdXJyZW5jeUtleSBvZiBjYW5kaWRhdGVLZXlzKSB7XG4gICAgICBjb25zdCByZXBhaXIgPSBpbnNpZGVUcmFuc2FjdGlvblxuICAgICAgICA/IGF3YWl0IHRoaXMuX3JlY29uY2lsZUNvbmN1cnJlbmN5S2V5KGRiLCBjb25jdXJyZW5jeUtleSlcbiAgICAgICAgOiBhd2FpdCB0aGlzLl90cmFuc2FjdGlvblJlc3VsdChkYiwgYXN5bmMgKCkgPT4gYXdhaXQgdGhpcy5fcmVjb25jaWxlQ29uY3VycmVuY3lLZXkoZGIsIGNvbmN1cnJlbmN5S2V5KSlcblxuICAgICAgaWYgKCFyZXBhaXIpIGNvbnRpbnVlXG5cbiAgICAgIHJlcGFpcmVkQ291bnQrK1xuICAgICAgaWYgKHJlcGFpcnMubGVuZ3RoIDwgQ09OQ1VSUkVOQ1lfUkVQQUlSX1NBTVBMRV9MSU1JVCkgcmVwYWlycy5wdXNoKHJlcGFpcilcbiAgICB9XG5cbiAgICByZXR1cm4ge1xuICAgICAgY2FuZGlkYXRlQ291bnQ6IGNhbmRpZGF0ZUtleXMubGVuZ3RoLFxuICAgICAgY2hlY2tlZENvdW50OiBjb25jdXJyZW5jeUtleXMubGVuZ3RoLFxuICAgICAgcmVwYWlyZWRDb3VudCxcbiAgICAgIHJlcGFpcnMsXG4gICAgICByZXBhaXJzVHJ1bmNhdGVkQ291bnQ6IHJlcGFpcmVkQ291bnQgLSByZXBhaXJzLmxlbmd0aFxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBSZWJ1aWxkcyBvbmUgY291bnRlciBhZnRlciBsb2NraW5nIGl0IGFoZWFkIG9mIHRoZSBqb2Igcm93cywgbWF0Y2hpbmcgdGhlXG4gICAqIGxvY2sgb3JkZXIgdXNlZCBieSBoYW5kb2ZmIGFuZCBjb21wbGV0aW9uIHRyYW5zaXRpb25zLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL2RhdGFiYXNlL2RyaXZlcnMvYmFzZS5qc1wiKS5kZWZhdWx0fSBkYiAtIERhdGFiYXNlIGNvbm5lY3Rpb24uXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBjb25jdXJyZW5jeUtleSAtIENvdW50ZXIga2V5LlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxpbXBvcnQoXCIuL3R5cGVzLmpzXCIpLkJhY2tncm91bmRKb2JDb25jdXJyZW5jeVJlcGFpciB8IG51bGw+fSAtIEFwcGxpZWQgcmVwYWlyLlxuICAgKi9cbiAgYXN5bmMgX3JlY29uY2lsZUNvbmN1cnJlbmN5S2V5KGRiLCBjb25jdXJyZW5jeUtleSkge1xuICAgIGF3YWl0IHRoaXMuX2xvY2tDb25jdXJyZW5jeVJvdyhkYiwgY29uY3VycmVuY3lLZXkpXG4gICAgY29uc3QgcGVyc2lzdGVkUm93cyA9IGF3YWl0IGRiXG4gICAgICAubmV3UXVlcnkoKVxuICAgICAgLmZyb20oQ09OQ1VSUkVOQ1lfVEFCTEUpXG4gICAgICAuc2VsZWN0KFwiYWN0aXZlX2NvdW50XCIpXG4gICAgICAuc2VsZWN0KFwiY29uY3VycmVuY3lfa2V5XCIpXG4gICAgICAud2hlcmUoe2NvbmN1cnJlbmN5X2tleTogY29uY3VycmVuY3lLZXl9KVxuICAgICAgLmxpbWl0KDEpXG4gICAgICAucmVzdWx0cygpXG5cbiAgICBpZiAoIXBlcnNpc3RlZFJvd3NbMF0pIHRocm93IG5ldyBFcnJvcihgTWlzc2luZyBiYWNrZ3JvdW5kIGpvYiBjb25jdXJyZW5jeSBjb3VudGVyIGZvciAke2NvbmN1cnJlbmN5S2V5fWApXG5cbiAgICBjb25zdCBwZXJzaXN0ZWRSb3cgPSAvKiogQHR5cGUge0JhY2tncm91bmRKb2JDb25jdXJyZW5jeUNvdW50Um93fSAqLyAocGVyc2lzdGVkUm93c1swXSlcbiAgICBjb25zdCBwcmV2aW91c0FjdGl2ZUNvdW50ID0gdGhpcy5fdmFsaWRhdGVkQ29uY3VycmVuY3lDb3VudChwZXJzaXN0ZWRSb3cuYWN0aXZlX2NvdW50LCBjb25jdXJyZW5jeUtleSlcbiAgICBjb25zdCByb3dzID0gYXdhaXQgZGJcbiAgICAgIC5uZXdRdWVyeSgpXG4gICAgICAuZnJvbShKT0JTX1RBQkxFKVxuICAgICAgLnNlbGVjdChcIkNPVU5UKCopIEFTIGFjdGl2ZV9jb3VudFwiKVxuICAgICAgLndoZXJlKHtjb25jdXJyZW5jeV9rZXk6IGNvbmN1cnJlbmN5S2V5LCBzdGF0dXM6IFwiaGFuZGVkX29mZlwifSlcbiAgICAgIC5yZXN1bHRzKClcbiAgICBjb25zdCBjb3VudFJvdyA9IC8qKiBAdHlwZSB7e2FjdGl2ZV9jb3VudDogbnVtYmVyIHwgc3RyaW5nfX0gKi8gKHJvd3NbMF0pXG4gICAgY29uc3QgYWN0aXZlQ291bnQgPSB0aGlzLl92YWxpZGF0ZWRDb25jdXJyZW5jeUNvdW50KGNvdW50Um93LmFjdGl2ZV9jb3VudCwgY29uY3VycmVuY3lLZXkpXG5cbiAgICBpZiAoYWN0aXZlQ291bnQgPT09IHByZXZpb3VzQWN0aXZlQ291bnQpIHJldHVybiBudWxsXG5cbiAgICBhd2FpdCBkYi51cGRhdGUoe1xuICAgICAgdGFibGVOYW1lOiBDT05DVVJSRU5DWV9UQUJMRSxcbiAgICAgIGRhdGE6IHthY3RpdmVfY291bnQ6IGFjdGl2ZUNvdW50fSxcbiAgICAgIGNvbmRpdGlvbnM6IHtjb25jdXJyZW5jeV9rZXk6IGNvbmN1cnJlbmN5S2V5fVxuICAgIH0pXG5cbiAgICByZXR1cm4ge2FjdGl2ZUNvdW50LCBjb25jdXJyZW5jeUtleSwgcHJldmlvdXNBY3RpdmVDb3VudH1cbiAgfVxuXG4gIC8qKlxuICAgKiBWYWxpZGF0ZXMgYSBkYXRhYmFzZSBjb3VudCBiZWZvcmUgaXQgcGFydGljaXBhdGVzIGluIHJlY29uY2lsaWF0aW9uLlxuICAgKiBAcGFyYW0ge251bWJlciB8IHN0cmluZ30gdmFsdWUgLSBSYXcgY291bnQuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBjb25jdXJyZW5jeUtleSAtIENvdW50ZXIga2V5IGZvciBkaWFnbm9zdGljcy5cbiAgICogQHJldHVybnMge251bWJlcn0gLSBTYWZlIG5vbi1uZWdhdGl2ZSBjb3VudC5cbiAgICovXG4gIF92YWxpZGF0ZWRDb25jdXJyZW5jeUNvdW50KHZhbHVlLCBjb25jdXJyZW5jeUtleSkge1xuICAgIGNvbnN0IGNvdW50ID0gdGhpcy5fbm9ybWFsaXplTnVtYmVyKHZhbHVlKVxuXG4gICAgaWYgKGNvdW50ID09PSBudWxsIHx8ICFOdW1iZXIuaXNTYWZlSW50ZWdlcihjb3VudCkgfHwgY291bnQgPCAwKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoYEludmFsaWQgcmVjb25jaWxlZCBiYWNrZ3JvdW5kIGpvYiBjb25jdXJyZW5jeSBjb3VudCBmb3IgJHtjb25jdXJyZW5jeUtleX06ICR7Y291bnR9YClcbiAgICB9XG5cbiAgICByZXR1cm4gY291bnRcbiAgfVxuXG4gIC8qKlxuICAgKiBSZWNvbmNpbGVzIHF1ZXVlLWRlcml2ZWQgY29uY3VycmVuY3kgd2l0aCB0aGUgY3VycmVudCBjb25maWd1cmF0aW9uLiBPbmx5XG4gICAqIGludm9rZWQgdGhyb3VnaCB7QGxpbmsgcmVjb25jaWxlUXVldWVDb25jdXJyZW5jeX0g4oCUIHRoZSBleHBsaWNpdCBsaWZlY3ljbGVcbiAgICogcGF0aCBydW4gYXQgbWFpbi1wcm9jZXNzIHN0YXJ0dXAgdW5kZXIgYSBjcm9zcy1wcm9jZXNzIGFkdmlzb3J5IGxvY2sg4oCUXG4gICAqIG5ldmVyIGZyb20gc2NoZW1hL3RlbmFudCBjaGVja3Mgb3Igcm91dGluZSBjb25uZWN0aW9uIGluaXRpYWxpemF0aW9uLFxuICAgKiB3aGljaCBzdGF5IHJlYWQtb25seSByZWdhcmRpbmcgcXVldWVkIGpvYiByb3dzLiBUaGUgcGVyLXByb2Nlc3MgbWVtbyBpc1xuICAgKiBsYXRjaGVkIGJ5IHtAbGluayByZWNvbmNpbGVRdWV1ZUNvbmN1cnJlbmN5fSBvbmx5IGFmdGVyIHRoZSBmb2xsb3dpbmdcbiAgICogY291bnQgcmVidWlsZCBhbHNvIHN1Y2NlZWRzLCBzbyBhIGZhaWxlZCByZWJ1aWxkIHJlLWVudGVycyBoZXJlIG9uIHJldHJ5XG4gICAqICh0aGUgYWRvcHRpb24gVVBEQVRFcyBiZWxvdyBhcmUgaWRlbXBvdGVudCkuIEVucXVldWUgb25seSBjb25zdWx0cyBjb25maWcgZm9yIG5ldyBqb2JzLCBzbyBhIGNhcCBhZGRlZCwgcmVtb3ZlZCwgb3IgY2hhbmdlZFxuICAgKiB3aGlsZSBhIGJhY2tsb2cgZXhpc3RzIG90aGVyd2lzZSBsZWF2ZXMgcGVyc2lzdGVkIHJvd3Mgc3RhbGU6IHByZS1jYXAgam9ic1xuICAgKiBrZWVwIGEgbnVsbCBrZXkgYW5kIGJ5cGFzcyB0aGUgY2FwLCBwb3N0LXJlbW92YWwgam9icyBzdGF5IGNhcHBlZCB1bmRlciBhXG4gICAqIG5vdy11bmNvbmZpZ3VyZWQga2V5LCBhbmQgYSBjaGFuZ2VkIG51bWVyaWMgY2FwIHN0YXlzIHN0YWxlIHVudGlsIHRoZSBuZXh0XG4gICAqIGVucXVldWUuIEJyaW5nIHF1ZXVlZCBkdXJhYmxlIHN0YXRlIGluIGxpbmUgd2l0aCBjb25maWc6IHN5bmMgZWFjaCBjb25maWd1cmVkXG4gICAqIHF1ZXVlJ3Mgc3RvcmVkIGNhcCwgYWRvcHQgbm90LXlldC1rZXllZCBxdWV1ZWQgam9icyBvbnRvIHRoZWlyIHF1ZXVlIGtleSxcbiAgICogYW5kIHJlbGVhc2UgcXVldWVkIGpvYnMgZnJvbSBxdWV1ZSBrZXlzIHdob3NlIHF1ZXVlIGlzIG5vIGxvbmdlciBjYXBwZWQuXG4gICAqIEV4aXN0aW5nIGhhbmRvZmZzIHJldGFpbiB0aGUgcG9saWN5IGFuZCByZXNlcnZhdGlvbiB0aGV5IHN0YXJ0ZWQgd2l0aCwgc29cbiAgICogcmVjb25jaWxpYXRpb24gY2Fubm90IHJhY2UgdGhlaXIgY29tcGxldGlvbi9yZXRyeSB0cmFuc2l0aW9ucy4gUnVucyBiZWZvcmVcbiAgICoge0BsaW5rIF9yZWNvbmNpbGVDb25jdXJyZW5jeX0gc28gYW55IHByZS1leGlzdGluZyBhY3RpdmUgY291bnRzIGFyZSBleGFjdC5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9kYXRhYmFzZS9kcml2ZXJzL2Jhc2UuanNcIikuZGVmYXVsdH0gZGIgLSBEYXRhYmFzZSBjb25uZWN0aW9uLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyB3aGVuIHJlY29uY2lsZWQuXG4gICAqL1xuICBhc3luYyBfcmVjb25jaWxlUXVldWVDb25jdXJyZW5jeShkYikge1xuICAgIGlmICh0aGlzLl9xdWV1ZUNvbmN1cnJlbmN5UmVjb25jaWxlZCkgcmV0dXJuXG4gICAgaWYgKCEoYXdhaXQgZGIudGFibGVFeGlzdHMoQ09OQ1VSUkVOQ1lfVEFCTEUpKSkgcmV0dXJuXG5cbiAgICBjb25zdCBxdWV1ZXNDb25maWcgPSB0aGlzLmNvbmZpZ3VyYXRpb24uZ2V0QmFja2dyb3VuZEpvYnNDb25maWcoKS5xdWV1ZXMgfHwge31cbiAgICBjb25zdCBqb2JzVGFibGUgPSBkYi5xdW90ZVRhYmxlKEpPQlNfVEFCTEUpXG4gICAgY29uc3Qga2V5Q29sdW1uID0gZGIucXVvdGVDb2x1bW4oXCJjb25jdXJyZW5jeV9rZXlcIilcbiAgICBjb25zdCBjYXBDb2x1bW4gPSBkYi5xdW90ZUNvbHVtbihcIm1heF9jb25jdXJyZW5jeVwiKVxuICAgIGNvbnN0IHF1ZXVlQ29sdW1uID0gZGIucXVvdGVDb2x1bW4oXCJxdWV1ZVwiKVxuICAgIGNvbnN0IHF1ZXVlZCA9IGAke2RiLnF1b3RlQ29sdW1uKFwic3RhdHVzXCIpfSA9ICR7ZGIucXVvdGUoXCJxdWV1ZWRcIil9YFxuICAgIC8qKiBAdHlwZSB7U2V0PHN0cmluZz59ICovXG4gICAgY29uc3QgY2FwcGVkUXVldWVzID0gbmV3IFNldCgpXG5cbiAgICBmb3IgKGNvbnN0IHF1ZXVlIG9mIE9iamVjdC5rZXlzKHF1ZXVlc0NvbmZpZykpIHtcbiAgICAgIGNvbnN0IGNhcCA9IHRoaXMuX3F1ZXVlTWF4Q29uY3VycmVuY3kocXVldWUpXG5cbiAgICAgIGlmIChjYXAgPT09IG51bGwpIGNvbnRpbnVlXG5cbiAgICAgIGNhcHBlZFF1ZXVlcy5hZGQocXVldWUpXG4gICAgICBjb25zdCBjb25jdXJyZW5jeUtleSA9IGAke1FVRVVFX0NPTkNVUlJFTkNZX0tFWV9QUkVGSVh9JHtxdWV1ZX1gXG5cbiAgICAgIGF3YWl0IHRoaXMuX2Vuc3VyZVF1ZXVlQ29uY3VycmVuY3lLZXkoZGIsIHtjb25jdXJyZW5jeUtleSwgbWF4Q29uY3VycmVuY3k6IGNhcH0pXG4gICAgICBhd2FpdCBkYi5xdWVyeShcbiAgICAgICAgYFVQREFURSAke2pvYnNUYWJsZX0gU0VUICR7a2V5Q29sdW1ufSA9ICR7ZGIucXVvdGUoY29uY3VycmVuY3lLZXkpfSwgJHtjYXBDb2x1bW59ID0gJHtOdW1iZXIoY2FwKX0gYCArXG4gICAgICAgIGBXSEVSRSAke3F1ZXVlQ29sdW1ufSA9ICR7ZGIucXVvdGUocXVldWUpfSBBTkQgJHtrZXlDb2x1bW59IElTIE5VTEwgQU5EICR7cXVldWVkfWBcbiAgICAgIClcbiAgICB9XG5cbiAgICBjb25zdCBjb25jdXJyZW5jeVJvd3MgPSBhd2FpdCBkYlxuICAgICAgLm5ld1F1ZXJ5KClcbiAgICAgIC5mcm9tKENPTkNVUlJFTkNZX1RBQkxFKVxuICAgICAgLnNlbGVjdChcImNvbmN1cnJlbmN5X2tleVwiKVxuICAgICAgLndoZXJlKGAke2RiLnF1b3RlQ29sdW1uKFwiY29uY3VycmVuY3lfa2V5XCIpfSBMSUtFICR7ZGIucXVvdGUoYCR7UVVFVUVfQ09OQ1VSUkVOQ1lfS0VZX1BSRUZJWH0lYCl9YClcbiAgICAgIC5yZXN1bHRzKClcblxuICAgIGZvciAoY29uc3Qgcm93IG9mIGNvbmN1cnJlbmN5Um93cykge1xuICAgICAgY29uc3QgY29uY3VycmVuY3lLZXkgPSBTdHJpbmcoLyoqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59ICovIChyb3cpLmNvbmN1cnJlbmN5X2tleSlcblxuICAgICAgaWYgKCFjb25jdXJyZW5jeUtleS5zdGFydHNXaXRoKFFVRVVFX0NPTkNVUlJFTkNZX0tFWV9QUkVGSVgpKSBjb250aW51ZVxuICAgICAgaWYgKGNhcHBlZFF1ZXVlcy5oYXMoY29uY3VycmVuY3lLZXkuc2xpY2UoUVVFVUVfQ09OQ1VSUkVOQ1lfS0VZX1BSRUZJWC5sZW5ndGgpKSkgY29udGludWVcblxuICAgICAgYXdhaXQgZGIucXVlcnkoXG4gICAgICAgIGBVUERBVEUgJHtqb2JzVGFibGV9IFNFVCAke2tleUNvbHVtbn0gPSBOVUxMLCAke2NhcENvbHVtbn0gPSBOVUxMIGAgK1xuICAgICAgICBgV0hFUkUgJHtrZXlDb2x1bW59ID0gJHtkYi5xdW90ZShjb25jdXJyZW5jeUtleSl9IEFORCAke3F1ZXVlZH1gXG4gICAgICApXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgbm9ybWFsaXplIG51bWJlci5cbiAgICogQHBhcmFtIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gdmFsdWUgLSBJbnB1dCB2YWx1ZS5cbiAgICogQHJldHVybnMge251bWJlciB8IG51bGx9IC0gTm9ybWFsaXplZCBudW1iZXIuXG4gICAqL1xuICBfbm9ybWFsaXplTnVtYmVyKHZhbHVlKSB7XG4gICAgaWYgKHZhbHVlID09PSBudWxsIHx8IHZhbHVlID09PSB1bmRlZmluZWQgfHwgdmFsdWUgPT09IFwiXCIpIHJldHVybiBudWxsXG5cbiAgICBjb25zdCBudW1lcmljID0gTnVtYmVyKHZhbHVlKVxuXG4gICAgaWYgKE51bWJlci5pc05hTihudW1lcmljKSkgcmV0dXJuIG51bGxcblxuICAgIHJldHVybiBudW1lcmljXG4gIH1cblxuICAvKipcbiAgICogUnVucyBub3JtYWxpemUgZXhlY3V0aW9uIG1vZGUuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi90eXBlcy5qc1wiKS5CYWNrZ3JvdW5kSm9iT3B0aW9uc30gW29wdGlvbnNdIC0gSm9iIG9wdGlvbnMuXG4gICAqIEByZXR1cm5zIHtpbXBvcnQoXCIuL3R5cGVzLmpzXCIpLkJhY2tncm91bmRKb2JFeGVjdXRpb25Nb2RlfSAtIE5vcm1hbGl6ZWQgZXhlY3V0aW9uIG1vZGUuXG4gICAqL1xuICBfbm9ybWFsaXplRXhlY3V0aW9uTW9kZShvcHRpb25zKSB7XG4gICAgcmV0dXJuIG5vcm1hbGl6ZUJhY2tncm91bmRKb2JFeGVjdXRpb25Nb2RlKG9wdGlvbnMgfHwge30sIERFRkFVTFRfQkFDS0dST1VORF9KT0JfRVhFQ1VUSU9OX01PREUpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBub3JtYWxpemUgZXhlY3V0aW9uIG1vZGUgbmFtZS5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGV4ZWN1dGlvbk1vZGUgLSBFeGVjdXRpb24gbW9kZSBuYW1lLlxuICAgKiBAcmV0dXJucyB7aW1wb3J0KFwiLi90eXBlcy5qc1wiKS5CYWNrZ3JvdW5kSm9iRXhlY3V0aW9uTW9kZX0gLSBOb3JtYWxpemVkIGV4ZWN1dGlvbiBtb2RlLlxuICAgKi9cbiAgX25vcm1hbGl6ZUV4ZWN1dGlvbk1vZGVOYW1lKGV4ZWN1dGlvbk1vZGUpIHtcbiAgICByZXR1cm4gbm9ybWFsaXplQmFja2dyb3VuZEpvYkV4ZWN1dGlvbk1vZGUoXG4gICAgICB7ZXhlY3V0aW9uTW9kZTogLyoqIEB0eXBlIHtpbXBvcnQoXCIuL3R5cGVzLmpzXCIpLkJhY2tncm91bmRKb2JFeGVjdXRpb25Nb2RlfSAqLyAoZXhlY3V0aW9uTW9kZSl9LFxuICAgICAgREVGQVVMVF9CQUNLR1JPVU5EX0pPQl9FWEVDVVRJT05fTU9ERSxcbiAgICAgIEJBQ0tHUk9VTkRfSk9CX0VYRUNVVElPTl9NT0RFU1xuICAgIClcbiAgfVxuXG4gIC8qKlxuICAgKiBGaWx0ZXJzIHF1ZXVlZCBqb2JzIGJ5IG9uZSBvciBtb3JlIGV4ZWN1dGlvbiBtb2RlcyBhZ2FpbnN0IHRoZVxuICAgKiBgZXhlY3V0aW9uX21vZGVgIGNvbHVtbiAodGhlIHNpbmdsZSBzb3VyY2Ugb2YgdHJ1dGgpLlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIE9wdGlvbnMuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vZGF0YWJhc2UvZHJpdmVycy9iYXNlLmpzXCIpLmRlZmF1bHR9IGFyZ3MuZGIgLSBEYXRhYmFzZSBjb25uZWN0aW9uLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vdHlwZXMuanNcIikuQmFja2dyb3VuZEpvYkV4ZWN1dGlvbk1vZGUgfCBpbXBvcnQoXCIuL3R5cGVzLmpzXCIpLkJhY2tncm91bmRKb2JFeGVjdXRpb25Nb2RlW119IGFyZ3MuZXhlY3V0aW9uTW9kZSAtIFJ1bnRpbWUgbW9kZXMuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vZGF0YWJhc2UvcXVlcnkvaW5kZXguanNcIikuZGVmYXVsdH0gYXJncy5xdWVyeSAtIFF1ZXJ5IHRvIGZpbHRlci5cbiAgICogQHJldHVybnMge2ltcG9ydChcIi4uL2RhdGFiYXNlL3F1ZXJ5L2luZGV4LmpzXCIpLmRlZmF1bHR9IC0gRmlsdGVyZWQgcXVlcnkuXG4gICAqL1xuICBfd2hlcmVFeGVjdXRpb25Nb2RlKHtkYiwgZXhlY3V0aW9uTW9kZSwgcXVlcnl9KSB7XG4gICAgY29uc3QgZXhlY3V0aW9uTW9kZXMgPSBBcnJheS5pc0FycmF5KGV4ZWN1dGlvbk1vZGUpID8gZXhlY3V0aW9uTW9kZSA6IFtleGVjdXRpb25Nb2RlXVxuICAgIGNvbnN0IGV4ZWN1dGlvbk1vZGVDb2x1bW4gPSBkYi5xdW90ZUNvbHVtbihcImV4ZWN1dGlvbl9tb2RlXCIpXG4gICAgY29uc3QgY29uZGl0aW9ucyA9IGV4ZWN1dGlvbk1vZGVzLm1hcCgobW9kZSkgPT4gYCR7ZXhlY3V0aW9uTW9kZUNvbHVtbn0gPSAke2RiLnF1b3RlKG1vZGUpfWApXG5cbiAgICByZXR1cm4gcXVlcnkud2hlcmUoYCgke2NvbmRpdGlvbnMuam9pbihcIiBPUiBcIil9KWApXG4gIH1cblxuICAvKipcbiAgICogUnVucyBwYXJzZSBhcmdzLlxuICAgKiBAcGFyYW0ge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSB2YWx1ZSAtIElucHV0IHZhbHVlLlxuICAgKiBAcmV0dXJucyB7QXJyYXk8UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSAtIFBhcnNlZCBhcmdzLlxuICAgKi9cbiAgX3BhcnNlQXJncyh2YWx1ZSkge1xuICAgIGlmICghdmFsdWUpIHJldHVybiBbXVxuXG4gICAgdHJ5IHtcbiAgICAgIGNvbnN0IHBhcnNlZCA9IEpTT04ucGFyc2UoU3RyaW5nKHZhbHVlKSlcblxuICAgICAgaWYgKEFycmF5LmlzQXJyYXkocGFyc2VkKSkgcmV0dXJuIHBhcnNlZFxuICAgIH0gY2F0Y2gge1xuICAgICAgLy8gSWdub3JlIHBhcnNlIGVycm9ycy5cbiAgICB9XG5cbiAgICByZXR1cm4gW11cbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHdpdGggZGIuXG4gICAqIEB0ZW1wbGF0ZSBUXG4gICAqIEBwYXJhbSB7KGRiOiBpbXBvcnQoXCIuLi9kYXRhYmFzZS9kcml2ZXJzL2Jhc2UuanNcIikuZGVmYXVsdCkgPT4gUHJvbWlzZTxUPn0gY2FsbGJhY2sgLSBDYWxsYmFjay5cbiAgICogQHJldHVybnMge1Byb21pc2U8VD59IC0gQ2FsbGJhY2sgcmVzdWx0LlxuICAgKi9cbiAgYXN5bmMgX3dpdGhEYihjYWxsYmFjaykge1xuICAgIGNvbnN0IGRhdGFiYXNlSWRlbnRpZmllciA9IHRoaXMuZ2V0RGF0YWJhc2VJZGVudGlmaWVyKClcbiAgICBjb25zdCBwb29sID0gdGhpcy5jb25maWd1cmF0aW9uLmdldERhdGFiYXNlUG9vbChkYXRhYmFzZUlkZW50aWZpZXIpXG5cbiAgICBpZiAoIXBvb2wudGVzdFNoYXJlZENvbm5lY3Rpb24oKSkge1xuICAgICAgcmV0dXJuIGF3YWl0IHBvb2wud2l0aENvbm5lY3Rpb24oe25hbWU6IFwiQmFja2dyb3VuZCBqb2JzIHN0b3JlXCJ9LCBjYWxsYmFjaylcbiAgICB9XG5cbiAgICByZXR1cm4gYXdhaXQgdGhpcy5jb25maWd1cmF0aW9uLnJ1bldpdGhUZXN0U2hhcmVkQ29ubmVjdGlvbkNvbnRleHRzKGFzeW5jICgpID0+IHtcbiAgICAgIHJldHVybiBhd2FpdCB0aGlzLmNvbmZpZ3VyYXRpb24uZW5zdXJlQ29ubmVjdGlvbnMoe2RhdGFiYXNlSWRlbnRpZmllcnM6IFtkYXRhYmFzZUlkZW50aWZpZXJdLCBuYW1lOiBcIkJhY2tncm91bmQgam9icyBzdG9yZVwifSwgYXN5bmMgKGRicykgPT4ge1xuICAgICAgICBjb25zdCBjb25uZWN0aW9uID0gZGJzW2RhdGFiYXNlSWRlbnRpZmllcl1cbiAgICAgICAgcmV0dXJuIGF3YWl0IGNvb3JkaW5hdGVTaGFyZWRUcmFuc2FjdGlvbkNvbm5lY3Rpb24oY29ubmVjdGlvbiwgYXN5bmMgKCkgPT4gYXdhaXQgY2FsbGJhY2soY29ubmVjdGlvbikpXG4gICAgICB9KVxuICAgIH0pXG4gIH1cblxuICAvKipcbiAgICogUnVucyBhIHZhbHVlLXJldHVybmluZyBjYWxsYmFjayBpbnNpZGUgdGhlIGRyaXZlcidzIHZvaWQtdHlwZWQgdHJhbnNhY3Rpb24gQVBJLlxuICAgKiBAdGVtcGxhdGUgVFxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL2RhdGFiYXNlL2RyaXZlcnMvYmFzZS5qc1wiKS5kZWZhdWx0fSBkYiAtIERhdGFiYXNlIGNvbm5lY3Rpb24uXG4gICAqIEBwYXJhbSB7KCkgPT4gUHJvbWlzZTxUPn0gY2FsbGJhY2sgLSBUcmFuc2FjdGlvbiBjYWxsYmFjay5cbiAgICogQHJldHVybnMge1Byb21pc2U8VD59IC0gQ2FsbGJhY2sgcmVzdWx0LlxuICAgKi9cbiAgYXN5bmMgX3RyYW5zYWN0aW9uUmVzdWx0KGRiLCBjYWxsYmFjaykge1xuICAgIGxldCBjb21wbGV0ZWQgPSBmYWxzZVxuICAgIC8qKiBAdHlwZSB7VCB8IHVuZGVmaW5lZH0gKi9cbiAgICBsZXQgcmVzdWx0XG4gICAgYXdhaXQgZGIudHJhbnNhY3Rpb24oYXN5bmMgKCkgPT4ge1xuICAgICAgcmVzdWx0ID0gYXdhaXQgY2FsbGJhY2soKVxuICAgICAgY29tcGxldGVkID0gdHJ1ZVxuICAgIH0pXG4gICAgaWYgKCFjb21wbGV0ZWQpIHRocm93IG5ldyBFcnJvcihcIkJhY2tncm91bmQgam9icyB0cmFuc2FjdGlvbiBjYWxsYmFjayB3YXMgbm90IGludm9rZWRcIilcbiAgICByZXR1cm4gLyoqIEB0eXBlIHtUfSAqLyAocmVzdWx0KVxuICB9XG5cbiAgLyoqXG4gICAqIFNlcmlhbGl6ZXMgY291bnQtY2hhbmdpbmcgdHJhbnNhY3Rpb25zIGJlZm9yZSBjaGVja2luZyBvdXQgdGhlaXIgY29ubmVjdGlvbi5cbiAgICogRGF0YWJhc2Ugcm93IGxvY2tpbmcgc3RpbGwgcHJvdmlkZXMgY3Jvc3MtcHJvY2VzcyBvcmRlcmluZzsgdGhpcyBndWFyZFxuICAgKiBwcmV2ZW50cyBjb25jdXJyZW50IGNhbGxlcnMgb24gU1FMaXRlJ3Mgc2hhcmVkIGNvbm5lY3Rpb24gZnJvbSBhdHRlbXB0aW5nXG4gICAqIG92ZXJsYXBwaW5nIHRvcC1sZXZlbCB0cmFuc2FjdGlvbnMuXG4gICAqIEB0ZW1wbGF0ZSBUXG4gICAqIEBwYXJhbSB7KGRiOiBpbXBvcnQoXCIuLi9kYXRhYmFzZS9kcml2ZXJzL2Jhc2UuanNcIikuZGVmYXVsdCkgPT4gUHJvbWlzZTxUPn0gY2FsbGJhY2sgLSBUcmFuc2FjdGlvbiBjYWxsYmFjay5cbiAgICogQHBhcmFtIHtCYWNrZ3JvdW5kSm9iVHJhbnNhY3Rpb25TZXJpYWxpemF0aW9uT3B0aW9uc30gW29wdGlvbnNdIC0gU2VyaWFsaXphdGlvbiBvcHRpb25zLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxUPn0gQ2FsbGJhY2sgcmVzdWx0LlxuICAgKi9cbiAgYXN5bmMgX3NlcmlhbGl6ZWRDb3VudE11dGF0aW9uKGNhbGxiYWNrLCBvcHRpb25zID0ge30pIHtcbiAgICByZXR1cm4gYXdhaXQgdGhpcy5fc2VyaWFsaXplZFRyYW5zYWN0aW9uTXV0YXRpb24oYXN5bmMgKGRiKSA9PiB7XG4gICAgICBhd2FpdCB0aGlzLl9sb2NrQ291bnRSZXZpc2lvbihkYilcblxuICAgICAgcmV0dXJuIGF3YWl0IGNhbGxiYWNrKGRiKVxuICAgIH0sIG9wdGlvbnMpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBhIHNlcmlhbGl6ZWQgY2FsbGJhY2sgaW5zaWRlIG9uZSB0cmFuc2FjdGlvbi5cbiAgICogQHRlbXBsYXRlIFRcbiAgICogQHBhcmFtIHsoZGI6IGltcG9ydChcIi4uL2RhdGFiYXNlL2RyaXZlcnMvYmFzZS5qc1wiKS5kZWZhdWx0KSA9PiBQcm9taXNlPFQ+fSBjYWxsYmFjayAtIFRyYW5zYWN0aW9uIGNhbGxiYWNrLlxuICAgKiBAcGFyYW0ge0JhY2tncm91bmRKb2JUcmFuc2FjdGlvblNlcmlhbGl6YXRpb25PcHRpb25zfSBbb3B0aW9uc10gLSBTZXJpYWxpemF0aW9uIG9wdGlvbnMuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPFQ+fSBDYWxsYmFjayByZXN1bHQuXG4gICAqL1xuICBhc3luYyBfc2VyaWFsaXplZFRyYW5zYWN0aW9uTXV0YXRpb24oY2FsbGJhY2ssIG9wdGlvbnMgPSB7fSkge1xuICAgIHJldHVybiBhd2FpdCB0aGlzLl9zZXJpYWxpemVkQ29ubmVjdGlvbk11dGF0aW9uKFxuICAgICAgYXN5bmMgKGRiKSA9PiBhd2FpdCB0aGlzLl90cmFuc2FjdGlvblJlc3VsdChkYiwgYXN5bmMgKCkgPT4gYXdhaXQgY2FsbGJhY2soZGIpKSxcbiAgICAgIG9wdGlvbnNcbiAgICApXG4gIH1cblxuICAvKipcbiAgICogQWRtaXRzIG11dGF0aW9uIGNhbGxiYWNrcyB0byB0aGUgcHJvY2Vzcy1sb2NhbCBGSUZPIGJlZm9yZSB0aGV5IGNoZWNrIG91dCBhXG4gICAqIGNvbm5lY3Rpb24uIENyb3NzLXByb2Nlc3Mgb3JkZXJpbmcgcmVtYWlucyB0aGUgcmVzcG9uc2liaWxpdHkgb2YgZHVyYWJsZVxuICAgKiByb3cvYWR2aXNvcnkgbG9ja3MgYW5kIHVuaXF1ZSBjb25zdHJhaW50cyBhY3F1aXJlZCBhcm91bmQgdGhlIGNhbGxiYWNrLlxuICAgKiBAdGVtcGxhdGUgVFxuICAgKiBAcGFyYW0geyhkYjogaW1wb3J0KFwiLi4vZGF0YWJhc2UvZHJpdmVycy9iYXNlLmpzXCIpLmRlZmF1bHQpID0+IFByb21pc2U8VD59IGNhbGxiYWNrIC0gQ29ubmVjdGlvbiBjYWxsYmFjay5cbiAgICogQHBhcmFtIHtCYWNrZ3JvdW5kSm9iVHJhbnNhY3Rpb25TZXJpYWxpemF0aW9uT3B0aW9uc30gW29wdGlvbnNdIC0gU2VyaWFsaXphdGlvbiBvcHRpb25zLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxUPn0gQ2FsbGJhY2sgcmVzdWx0LlxuICAgKi9cbiAgYXN5bmMgX3NlcmlhbGl6ZWRDb25uZWN0aW9uTXV0YXRpb24oY2FsbGJhY2ssIG9wdGlvbnMgPSB7fSkge1xuICAgIGNvbnN0IGlkZW50aWZpZXIgPSB0aGlzLmdldERhdGFiYXNlSWRlbnRpZmllcigpIHx8IFwiZGVmYXVsdFwiXG4gICAgY29uc3QgcHJldmlvdXMgPSB0cmFuc2FjdGlvbk11dGF0aW9uQ2hhaW5zLmdldChpZGVudGlmaWVyKSB8fCBQcm9taXNlLnJlc29sdmUoKVxuICAgIGxldCByZXNvbHZlUnVuID0gKCkgPT4ge31cbiAgICAvKiogQHR5cGUge1Byb21pc2U8dm9pZD59ICovXG4gICAgY29uc3QgcnVuID0gbmV3IFByb21pc2UoKHJlc29sdmUpID0+IHtcbiAgICAgIHJlc29sdmVSdW4gPSAoKSA9PiByZXNvbHZlKHVuZGVmaW5lZClcbiAgICB9KVxuICAgIGNvbnN0IGNoYWluID0gcHJldmlvdXMudGhlbigoKSA9PiBydW4pXG5cbiAgICB0cmFuc2FjdGlvbk11dGF0aW9uQ2hhaW5zLnNldChpZGVudGlmaWVyLCBjaGFpbilcbiAgICBhd2FpdCBwcmV2aW91c1xuXG4gICAgdHJ5IHtcbiAgICAgIHJldHVybiBhd2FpdCB0aGlzLl93aXRoRGIoYXN5bmMgKGRiKSA9PiB7XG4gICAgICAgIGNvbnN0IHthZHZpc29yeUxvY2t9ID0gb3B0aW9uc1xuXG4gICAgICAgIGlmIChhZHZpc29yeUxvY2spIHtcbiAgICAgICAgICBjb25zdCBhY3F1aXJlZCA9IGF3YWl0IGRiLmFjcXVpcmVBZHZpc29yeUxvY2soYWR2aXNvcnlMb2NrLm5hbWUpXG5cbiAgICAgICAgICBpZiAoIWFjcXVpcmVkKSB0aHJvdyBuZXcgRXJyb3IoYWR2aXNvcnlMb2NrLmZhaWx1cmVNZXNzYWdlKVxuICAgICAgICB9XG5cbiAgICAgICAgdHJ5IHtcbiAgICAgICAgICByZXR1cm4gYXdhaXQgY2FsbGJhY2soZGIpXG4gICAgICAgIH0gZmluYWxseSB7XG4gICAgICAgICAgaWYgKGFkdmlzb3J5TG9jaykgYXdhaXQgZGIucmVsZWFzZUFkdmlzb3J5TG9jayhhZHZpc29yeUxvY2submFtZSlcbiAgICAgICAgfVxuICAgICAgfSlcbiAgICB9IGZpbmFsbHkge1xuICAgICAgcmVzb2x2ZVJ1bigpXG4gICAgICBpZiAodHJhbnNhY3Rpb25NdXRhdGlvbkNoYWlucy5nZXQoaWRlbnRpZmllcikgPT09IGNoYWluKSB0cmFuc2FjdGlvbk11dGF0aW9uQ2hhaW5zLmRlbGV0ZShpZGVudGlmaWVyKVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHNob3VsZCBhY2NlcHQgcmVwb3J0LlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIE9wdGlvbnMuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi90eXBlcy5qc1wiKS5CYWNrZ3JvdW5kSm9iUm93fSBhcmdzLmpvYiAtIEpvYiByb3cuXG4gICAqIEBwYXJhbSB7c3RyaW5nIHwgbnVsbCB8IHVuZGVmaW5lZH0gYXJncy5oYW5kb2ZmSWQgLSBIYW5kb2ZmIGxlYXNlIGlkIGZyb20gcmVwb3J0LlxuICAgKiBAcGFyYW0ge3N0cmluZyB8IG51bGwgfCB1bmRlZmluZWR9IGFyZ3Mud29ya2VySWQgLSBXb3JrZXIgaWQgZnJvbSByZXBvcnQuXG4gICAqIEBwYXJhbSB7bnVtYmVyIHwgbnVsbCB8IHVuZGVmaW5lZH0gYXJncy5oYW5kZWRPZmZBdE1zIC0gSGFuZGVkIG9mZiB0aW1lc3RhbXAgZnJvbSByZXBvcnQuXG4gICAqIEByZXR1cm5zIHtib29sZWFufSAtIFdoZXRoZXIgdG8gYWNjZXB0IHRoZSByZXBvcnQuXG4gICAqL1xuICBfc2hvdWxkQWNjZXB0UmVwb3J0KHtqb2IsIGhhbmRvZmZJZCwgd29ya2VySWQsIGhhbmRlZE9mZkF0TXN9KSB7XG4gICAgaWYgKGpvYi5zdGF0dXMgIT09IFwiaGFuZGVkX29mZlwiKSByZXR1cm4gZmFsc2VcblxuICAgIHJldHVybiB0aGlzLl9oYW5kb2ZmSWRSZXBvcnRNYXRjaGVzKHtoYW5kb2ZmSWQsIGpvYn0pXG4gICAgICAmJiB0aGlzLl93b3JrZXJSZXBvcnRNYXRjaGVzKHtqb2IsIHdvcmtlcklkfSlcbiAgICAgICYmIHRoaXMuX2hhbmRvZmZSZXBvcnRNYXRjaGVzKHtoYW5kZWRPZmZBdE1zLCBqb2J9KVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgYWN0aXZlIGhhbmRvZmYgY29uZGl0aW9ucy5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL3R5cGVzLmpzXCIpLkJhY2tncm91bmRKb2JSb3d9IGpvYiAtIEpvYiByb3cuXG4gICAqIEByZXR1cm5zIHtSZWNvcmQ8c3RyaW5nLCBzdHJpbmcgfCBudWxsPn0gLSBDb25kaXRpb25hbCB0cmFuc2l0aW9uIGZlbmNlLlxuICAgKi9cbiAgX2FjdGl2ZUhhbmRvZmZDb25kaXRpb25zKGpvYikge1xuICAgIHJldHVybiB7aGFuZG9mZl9pZDogam9iLmhhbmRvZmZJZCwgaWQ6IGpvYi5pZCwgc3RhdHVzOiBcImhhbmRlZF9vZmZcIn1cbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGhhbmRvZmYgaWQgcmVwb3J0IG1hdGNoZXMuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gT3B0aW9ucy5cbiAgICogQHBhcmFtIHtzdHJpbmcgfCBudWxsIHwgdW5kZWZpbmVkfSBhcmdzLmhhbmRvZmZJZCAtIEhhbmRvZmYgbGVhc2UgaWQgZnJvbSByZXBvcnQuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi90eXBlcy5qc1wiKS5CYWNrZ3JvdW5kSm9iUm93fSBhcmdzLmpvYiAtIEpvYiByb3cuXG4gICAqIEByZXR1cm5zIHtib29sZWFufSAtIFdoZXRoZXIgdGhlIGhhbmRvZmYgbGVhc2UgbWF0Y2hlcy5cbiAgICovXG4gIF9oYW5kb2ZmSWRSZXBvcnRNYXRjaGVzKHtoYW5kb2ZmSWQsIGpvYn0pIHtcbiAgICBpZiAoIWpvYi5oYW5kb2ZmSWQpIHJldHVybiB0cnVlXG5cbiAgICByZXR1cm4gaGFuZG9mZklkID09PSBqb2IuaGFuZG9mZklkXG4gIH1cblxuICAvKipcbiAgICogUnVucyB3b3JrZXIgcmVwb3J0IG1hdGNoZXMuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gT3B0aW9ucy5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL3R5cGVzLmpzXCIpLkJhY2tncm91bmRKb2JSb3d9IGFyZ3Muam9iIC0gSm9iIHJvdy5cbiAgICogQHBhcmFtIHtzdHJpbmcgfCBudWxsIHwgdW5kZWZpbmVkfSBhcmdzLndvcmtlcklkIC0gV29ya2VyIGlkIGZyb20gcmVwb3J0LlxuICAgKiBAcmV0dXJucyB7Ym9vbGVhbn0gLSBXaGV0aGVyIHRoZSB3b3JrZXIgcmVwb3J0IG1hdGNoZXMuXG4gICAqL1xuICBfd29ya2VyUmVwb3J0TWF0Y2hlcyh7am9iLCB3b3JrZXJJZH0pIHtcbiAgICBpZiAoIXdvcmtlcklkKSByZXR1cm4gdHJ1ZVxuICAgIGlmICgham9iLndvcmtlcklkKSByZXR1cm4gdHJ1ZVxuXG4gICAgcmV0dXJuIHdvcmtlcklkID09PSBqb2Iud29ya2VySWRcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGhhbmRvZmYgcmVwb3J0IG1hdGNoZXMuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gT3B0aW9ucy5cbiAgICogQHBhcmFtIHtudW1iZXIgfCBudWxsIHwgdW5kZWZpbmVkfSBhcmdzLmhhbmRlZE9mZkF0TXMgLSBIYW5kZWQgb2ZmIHRpbWVzdGFtcCBmcm9tIHJlcG9ydC5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL3R5cGVzLmpzXCIpLkJhY2tncm91bmRKb2JSb3d9IGFyZ3Muam9iIC0gSm9iIHJvdy5cbiAgICogQHJldHVybnMge2Jvb2xlYW59IC0gV2hldGhlciB0aGUgaGFuZG9mZiByZXBvcnQgbWF0Y2hlcy5cbiAgICovXG4gIF9oYW5kb2ZmUmVwb3J0TWF0Y2hlcyh7aGFuZGVkT2ZmQXRNcywgam9ifSkge1xuICAgIGlmICghaGFuZGVkT2ZmQXRNcykgcmV0dXJuIHRydWVcbiAgICBpZiAoIWpvYi5oYW5kZWRPZmZBdE1zKSByZXR1cm4gdHJ1ZVxuXG4gICAgcmV0dXJuIGhhbmRlZE9mZkF0TXMgPT09IGpvYi5oYW5kZWRPZmZBdE1zXG4gIH1cblxuICAvKipcbiAgICogUnVucyBtaWdyYXRpb24ga2V5LlxuICAgKiBAcGFyYW0ge3N0cmluZ30gW3ZlcnNpb25dIC0gTWlncmF0aW9uIHZlcnNpb24uXG4gICAqIEByZXR1cm5zIHtzdHJpbmd9IC0gTWlncmF0aW9uIGtleS5cbiAgICovXG4gIF9taWdyYXRpb25LZXkodmVyc2lvbiA9IE1JR1JBVElPTl9WRVJTSU9OKSB7XG4gICAgcmV0dXJuIGAke01JR1JBVElPTl9TQ09QRX06JHt2ZXJzaW9ufWBcbiAgfVxufVxuIl19