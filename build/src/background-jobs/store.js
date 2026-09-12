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
     */
    constructor({ configuration, databaseIdentifier, clock, afterOwnedProducerValidation }) {
        super();
        this.configuration = configuration;
        this.databaseIdentifier = databaseIdentifier;
        this.clock = clock || { now: () => Date.now() };
        this.afterOwnedProducerValidation = afterOwnedProducerValidation;
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoic3RvcmUuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi9zcmMvYmFja2dyb3VuZC1qb2JzL3N0b3JlLmpzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiJBQUFBLFlBQVk7QUFFWixPQUFPLEVBQUMsVUFBVSxFQUFFLFVBQVUsRUFBQyxNQUFNLFFBQVEsQ0FBQTtBQUM3QyxPQUFPLHFCQUFxQixNQUFNLGNBQWMsQ0FBQTtBQUNoRCxPQUFPLE1BQU0sTUFBTSxjQUFjLENBQUE7QUFDakMsT0FBTyxTQUFTLE1BQU0saUNBQWlDLENBQUE7QUFDdkQsT0FBTyxjQUFjLE1BQU0sdUJBQXVCLENBQUE7QUFDbEQsT0FBTyxtQkFBbUIsTUFBTSxpQkFBaUIsQ0FBQTtBQUNqRCxPQUFPLDJCQUEyQixNQUFNLHNCQUFzQixDQUFBO0FBQzlELE9BQU8sRUFBRSxxQ0FBcUMsRUFBRSxNQUFNLHlEQUF5RCxDQUFBO0FBQy9HLE9BQU8sbUJBQW1CLE1BQU0seUJBQXlCLENBQUE7QUFDekQsT0FBTyxFQUNMLGdDQUFnQyxFQUNoQyw4QkFBOEIsRUFDOUIscUNBQXFDLEVBQ3JDLDRCQUE0QixFQUM1Qiw0QkFBNEIsRUFDNUIsaUNBQWlDLEVBQ2pDLG1DQUFtQyxFQUNuQyxnQ0FBZ0MsRUFDaEMsMkJBQTJCLEVBQzNCLGlDQUFpQyxFQUNqQyxtQ0FBbUMsRUFDbkMsNEJBQTRCLEVBQzVCLDRCQUE0QixFQUM1QixZQUFZLEVBQ2IsTUFBTSxvQkFBb0IsQ0FBQTtBQUMzQixPQUFPLEVBQ0wsOEJBQThCLEVBQzlCLDJCQUEyQixFQUMzQix3QkFBd0IsRUFDekIsTUFBTSxpQ0FBaUMsQ0FBQTtBQUV4Qzs7Ozs7Ozs7Ozs7OztHQWFHO0FBRUg7Ozs7O0dBS0c7QUFFSDs7OztHQUlHO0FBRUg7Ozs7O0dBS0c7QUFFSDs7Ozs7R0FLRztBQUVILE1BQU0sZ0JBQWdCLEdBQUcsK0JBQStCLENBQUE7QUFDeEQsTUFBTSxlQUFlLEdBQUcsaUJBQWlCLENBQUE7QUFDekMsTUFB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QUUsRUFBQyxJQUFJLEVBQUUsS0FBSyxFQUFFLEtBQUssRUFBRSxJQUFJLEVBQUMsQ0FBQyxDQUFBO1FBQ3BELEtBQUssQ0FBQyxJQUFJLENBQUMsV0FBVyxFQUFFLEVBQUMsSUFBSSxFQUFFLEtBQUssRUFBQyxDQUFDLENBQUE7UUFDdEMsS0FBSyxDQUFDLE1BQU0sQ0FBQyxnQkFBZ0IsRUFBRSxFQUFDLElBQUksRUFBRSxLQUFLLEVBQUMsQ0FBQyxDQUFBO1FBQzdDLEtBQUssQ0FBQyxNQUFNLENBQUMsT0FBTyxFQUFFLEVBQUMsSUFBSSxFQUFFLElBQUksRUFBRSxLQUFLLEVBQUUsSUFBSSxFQUFDLENBQUMsQ0FBQTtRQUNoRCxLQUFLLENBQUMsT0FBTyxDQUFDLGFBQWEsRUFBRSxFQUFDLElBQUksRUFBRSxLQUFLLEVBQUMsQ0FBQyxDQUFBO1FBQzNDLEtBQUssQ0FBQyxPQUFPLENBQUMsVUFBVSxFQUFFLEVBQUMsSUFBSSxFQUFFLEtBQUssRUFBQyxDQUFDLENBQUE7UUFDeEMsS0FBSyxDQUFDLE1BQU0sQ0FBQyxRQUFRLEVBQUUsRUFBQyxJQUFJLEVBQUUsS0FBSyxFQUFFLEtBQUssRUFBRSxJQUFJLEVBQUMsQ0FBQyxDQUFBO1FBQ2xELEtBQUssQ0FBQyxNQUFNLENBQUMsaUJBQWlCLEVBQUUsRUFBQyxJQUFJLEVBQUUsS0FBSyxFQUFFLEtBQUssRUFBRSxJQUFJLEVBQUMsQ0FBQyxDQUFBO1FBQzNELEtBQUssQ0FBQyxNQUFNLENBQUMsZUFBZSxFQUFFLEVBQUMsSUFBSSxFQUFFLEtBQUssRUFBRSxLQUFLLEVBQUUsSUFBSSxFQUFDLENBQUMsQ0FBQTtRQUN6RCxLQUFLLENBQUMsTUFBTSxDQUFDLGNBQWMsRUFBRSxFQUFDLElBQUksRUFBRSxJQUFJLEVBQUUsS0FBSyxFQUFFLElBQUksRUFBQyxDQUFDLENBQUE7UUFDdkQsS0FBSyxDQUFDLE1BQU0sQ0FBQyxnQkFBZ0IsRUFBRSxFQUFDLElBQUksRUFBRSxJQUFJLEVBQUMsQ0FBQyxDQUFBO1FBQzVDLEtBQUssQ0FBQyxNQUFNLENBQUMs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Ozs7T0FNRztJQUNILG9CQUFvQixDQUFDLEVBQUMsR0FBRyxFQUFFLFFBQVEsRUFBQztRQUNsQyxJQUFJLENBQUMsUUFBUTtZQUFFLE9BQU8sSUFBSSxDQUFBO1FBQzFCLElBQUksQ0FBQyxHQUFHLENBQUMsUUFBUTtZQUFFLE9BQU8sSUFBSSxDQUFBO1FBRTlCLE9BQU8sUUFBUSxLQUFLLEdBQUcsQ0FBQyxRQUFRLENBQUE7SUFDbEMsQ0FBQztJQUVEOzs7Ozs7T0FNRztJQUNILHFCQUFxQixDQUFDLEVBQUMsYUFBYSxFQUFFLEdBQUcsRUFBQztRQUN4QyxJQUFJLENBQUMsYUFBYTtZQUFFLE9BQU8sSUFBSSxDQUFBO1FBQy9CLElBQUksQ0FBQyxHQUFHLENBQUMsYUFBYTtZQUFFLE9BQU8sSUFBSSxDQUFBO1FBRW5DLE9BQU8sYUFBYSxLQUFLLEdBQUcsQ0FBQyxhQUFhLENBQUE7SUFDNUMsQ0FBQztJQUVEOzs7O09BSUc7SUFDSCxhQUFhLENBQUMsT0FBTyxHQUFHLGlCQUFpQjtRQUN2QyxPQUFPLEdBQUcsZUFBZSxJQUFJLE9BQU8sRUFBRSxDQUFBO0lBQ3hDLENBQUM7Q0FDRiIsInNvdXJjZXNDb250ZW50IjpbIi8vIEB0cy1jaGVja1xuXG5pbXBvcnQge2NyZWF0ZUhhc2gsIHJhbmRvbVVVSUR9IGZyb20gXCJjcnlwdG9cIlxuaW1wb3J0IEJhY2tncm91bmRKb2JzQWRhcHRlciBmcm9tIFwiLi9hZGFwdGVyLmpzXCJcbmltcG9ydCBMb2dnZXIgZnJvbSBcIi4uL2xvZ2dlci5qc1wiXG5pbXBvcnQgVGFibGVEYXRhIGZyb20gXCIuLi9kYXRhYmFzZS90YWJsZS1kYXRhL2luZGV4LmpzXCJcbmltcG9ydCBWZWxvY2lvdXNFcnJvciBmcm9tIFwiLi4vdmVsb2Npb3VzLWVycm9yLmpzXCJcbmltcG9ydCBCYWNrZ3JvdW5kSm9iUmVjb3JkIGZyb20gXCIuL2pvYi1yZWNvcmQuanNcIlxuaW1wb3J0IG5vcm1hbGl6ZUJhY2tncm91bmRKb2JFcnJvciBmcm9tIFwiLi9ub3JtYWxpemUtZXJyb3IuanNcIlxuaW1wb3J0IHsgY29vcmRpbmF0ZVNoYXJlZFRyYW5zYWN0aW9uQ29ubmVjdGlvbiB9IGZyb20gXCIuLi90ZXN0aW5nL3NoYXJlZC10cmFuc2FjdGlvbi1jb25uZWN0aW9uLWNvb3JkaW5hdG9yLmpzXCJcbmltcG9ydCBzdGFibGVKc29uU3RyaW5naWZ5IGZyb20gXCIuLi91dGlscy9zdGFibGUtanNvbi5qc1wiXG5pbXBvcnQge1xuICBCQUNLR1JPVU5EX0pPQl9URVJNSU5BTF9TVEFUVVNFUyxcbiAgQkFDS0dST1VORF9KT0JfRVhFQ1VUSU9OX01PREVTLFxuICBERUZBVUxUX0JBQ0tHUk9VTkRfSk9CX0VYRUNVVElPTl9NT0RFLFxuICBERUZBVUxUX0JBQ0tHUk9VTkRfSk9CX1FVRVVFLFxuICBRVUVVRV9DT05DVVJSRU5DWV9LRVlfUFJFRklYLFxuICBub3JtYWxpemVCYWNrZ3JvdW5kSm9iQ29uY3VycmVuY3ksXG4gIG5vcm1hbGl6ZUJhY2tncm91bmRKb2JFeGVjdXRpb25Nb2RlLFxuICBub3JtYWxpemVCYWNrZ3JvdW5kSm9iTWF4UmV0cmllcyxcbiAgbm9ybWFsaXplQmFja2dyb3VuZEpvYlF1ZXVlLFxuICBub3JtYWxpemVCYWNrZ3JvdW5kSm9iU2NoZWR1bGVLZXksXG4gIG5vcm1hbGl6ZUJhY2tncm91bmRKb2JTY2hlZHVsZWRBdE1zLFxuICBub3JtYWxpemVCYWNrZ3JvdW5kSm9iU3RhdHVzLFxuICByZXNjaGVkdWxlZEJhY2tncm91bmRKb2JBdE1zLFxuICByZXRyeURlbGF5TXNcbn0gZnJvbSBcIi4vam9iLXNlbWFudGljcy5qc1wiXG5pbXBvcnQge1xuICBNQUlMX0RFTElWRVJZX09QRVJBVElPTlNfVEFCTEUsXG4gIG1haWxEZWxpdmVyeU9wZXJhdGlvbkZvckpvYixcbiAgbWFpbERlbGl2ZXJ5T3BlcmF0aW9uS2V5XG59IGZyb20gXCIuLi9tYWlsZXIvZGVsaXZlcnktb3BlcmF0aW9uLmpzXCJcblxuLyoqXG4gKiBQcmVwYXJlZEJhY2tncm91bmRKb2IgdHlwZS5cbiAqIEB0eXBlZGVmIHtvYmplY3R9IFByZXBhcmVkQmFja2dyb3VuZEpvYlxuICogQHByb3BlcnR5IHtzdHJpbmd9IGFyZ3NKc29uIC0gU2VyaWFsaXplZCBhcmd1bWVudHMuXG4gKiBAcHJvcGVydHkge3tjb25jdXJyZW5jeUtleTogc3RyaW5nLCBtYXhDb25jdXJyZW5jeTogbnVtYmVyLCBxdWV1ZURlcml2ZWQ6IGJvb2xlYW59IHwgbnVsbH0gY29uY3VycmVuY3kgLSBSZXNvbHZlZCBjb25jdXJyZW5jeS5cbiAqIEBwcm9wZXJ0eSB7bnVtYmVyfSBjcmVhdGVkQXRNcyAtIENyZWF0aW9uIHRpbWVzdGFtcC5cbiAqIEBwcm9wZXJ0eSB7aW1wb3J0KFwiLi90eXBlcy5qc1wiKS5CYWNrZ3JvdW5kSm9iRXhlY3V0aW9uTW9kZX0gZXhlY3V0aW9uTW9kZSAtIEV4ZWN1dGlvbiBtb2RlLlxuICogQHByb3BlcnR5IHtzdHJpbmd9IGpvYklkIC0gTmV3IGpvYiBpZC5cbiAqIEBwcm9wZXJ0eSB7c3RyaW5nfSBqb2JOYW1lIC0gSm9iIG5hbWUuXG4gKiBAcHJvcGVydHkge251bWJlcn0gbWF4UmV0cmllcyAtIFJldHJ5IGNhcC5cbiAqIEBwcm9wZXJ0eSB7c3RyaW5nfSBxdWV1ZSAtIFF1ZXVlIG5hbWUuXG4gKiBAcHJvcGVydHkge251bWJlcn0gc2NoZWR1bGVkQXRNcyAtIEVsaWdpYmlsaXR5IHRpbWVzdGFtcC5cbiAqIEBwcm9wZXJ0eSB7bnVtYmVyIHwgbnVsbH0gdGltZW91dE1zIC0gUGVyLWpvYiB0aW1lb3V0IG92ZXJyaWRlLCBvciBudWxsIHdoZW4gb21pdHRlZC5cbiAqL1xuXG4vKipcbiAqIEJhY2tncm91bmRKb2JPcnBoYW5TZWxlY3Rpb24gdHlwZS5cbiAqIEB0eXBlZGVmIHtvYmplY3R9IEJhY2tncm91bmRKb2JPcnBoYW5TZWxlY3Rpb25cbiAqIEBwcm9wZXJ0eSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSBjb25kaXRpb25zIC0gRXhhY3QgdXBkYXRlIGZlbmNlLlxuICogQHByb3BlcnR5IHtpbXBvcnQoXCIuL3R5cGVzLmpzXCIpLkJhY2tncm91bmRKb2JSb3d9IGpvYiAtIFNlbGVjdGVkIGFjdGl2ZSBoYW5kb2ZmLlxuICovXG5cbi8qKlxuICogQmFja2dyb3VuZEpvYlRyYW5zYWN0aW9uU2VyaWFsaXphdGlvbk9wdGlvbnMgdHlwZS5cbiAqIEB0eXBlZGVmIHtvYmplY3R9IEJhY2tncm91bmRKb2JUcmFuc2FjdGlvblNlcmlhbGl6YXRpb25PcHRpb25zXG4gKiBAcHJvcGVydHkge3tmYWlsdXJlTWVzc2FnZTogc3RyaW5nLCBuYW1lOiBzdHJpbmd9fSBbYWR2aXNvcnlMb2NrXSAtIFNlc3Npb24gbG9jayBoZWxkIGFyb3VuZCB0aGUgdHJhbnNhY3Rpb24uXG4gKi9cblxuLyoqXG4gKiBCYWNrZ3JvdW5kSm9iQ29uY3VycmVuY3lDb3VudFJvdyB0eXBlLlxuICogQHR5cGVkZWYge29iamVjdH0gQmFja2dyb3VuZEpvYkNvbmN1cnJlbmN5Q291bnRSb3dcbiAqIEBwcm9wZXJ0eSB7bnVtYmVyIHwgc3RyaW5nfSBhY3RpdmVfY291bnQgLSBQZXJzaXN0ZWQgb3IgYWdncmVnYXRlZCBhY3RpdmUgY291bnQuXG4gKiBAcHJvcGVydHkge3N0cmluZ30gY29uY3VycmVuY3lfa2V5IC0gRHVyYWJsZSBjYXAgaWRlbnRpdHkuXG4gKi9cblxuLyoqXG4gKiBCYWNrZ3JvdW5kSm9iUXVldWVkQ29uY3VycmVuY3kgdHlwZS5cbiAqIEB0eXBlZGVmIHtvYmplY3R9IEJhY2tncm91bmRKb2JRdWV1ZWRDb25jdXJyZW5jeVxuICogQHByb3BlcnR5IHtzdHJpbmcgfCBudWxsfSBjb25jdXJyZW5jeUtleSAtIEN1cnJlbnQgY29uY3VycmVuY3kga2V5IGZvciBxdWV1ZWQgd29yay5cbiAqIEBwcm9wZXJ0eSB7bnVtYmVyIHwgbnVsbH0gbWF4Q29uY3VycmVuY3kgLSBDdXJyZW50IGNvbmN1cnJlbmN5IGNhcCBmb3IgcXVldWVkIHdvcmsuXG4gKi9cblxuY29uc3QgTUlHUkFUSU9OU19UQUJMRSA9IFwidmVsb2Npb3VzX2ludGVybmFsX21pZ3JhdGlvbnNcIlxuY29uc3QgTUlHUkFUSU9OX1NDT1BFID0gXCJiYWNrZ3JvdW5kX2pvYnNcIlxuY29uc3QgTUlHUkFUSU9OX1ZFUlNJT04gPSBcIjIwMjUwMjE1MDAwMDAwXCJcbmNvbnN0IFNDSEVNQV9SRUNPVkVSWV9QRU5ESU5HX1ZFUlNJT04gPSBcInNjaGVtYS1yZWNvdmVyeS1wZW5kaW5nXCJcbmNvbnN0IEVYRUNVVElPTl9NT0RFX0JBQ0tGSUxMX01JR1JBVElPTl9WRVJTSU9OID0gXCIyMDI2MDYwNzEzMTAxMFwiXG4vLyBEcm9wcyB0aGUgcmVkdW5kYW50IGxlZ2FjeSBgZm9ya2VkYCBib29sZWFuIGNvbHVtbiBhbmQgcmV3cml0ZXMgcG9vbGVkIHJvd3MgdG9cbi8vIHBlcnNpc3QgYGV4ZWN1dGlvbl9tb2RlID0gXCJwb29sZWRcImAgZGlyZWN0bHkgKHJldGlyaW5nIHRoZSBwb29sZWQtYXMtZm9ya2VkXG4vLyBoYW5kb2ZmLW1hcmtlciB3b3JrYXJvdW5kKSwgbGVhdmluZyBgZXhlY3V0aW9uX21vZGVgIGFzIHRoZSBzaW5nbGUgc291cmNlIG9mXG4vLyB0cnV0aCBmb3IgYSBqb2IncyBydW50aW1lLlxuY29uc3QgRFJPUF9GT1JLRURfQ09MVU1OX01JR1JBVElPTl9WRVJTSU9OID0gXCIyMDI2MDcxOTAwMDAwMFwiXG5jb25zdCBKT0JTX0lOREVYX1JFUEFJUl9NSUdSQVRJT05fVkVSU0lPTiA9IFwiMjAyNjA5MDMxMjAwMDBcIlxuLy8gTGVnYWN5IG1hcmtlciBwcmVmaXggdXNlZCBieSByb3dzIHdyaXR0ZW4gYmVmb3JlIHRoaXMgbWlncmF0aW9uOiBwb29sZWQgam9ic1xuLy8gdXNlZCB0byBwZXJzaXN0IGFzIGBleGVjdXRpb25fbW9kZSA9IFwiZm9ya2VkXCJgIHBsdXMgYSBgdmVsb2Npb3VzLXBvb2xlZDoqYFxuLy8gaGFuZG9mZiBpZC4gUmV0YWluZWQgb25seSB0byBkZXRlY3QgYW5kIGNvbnZlcnQgdGhvc2Ugcm93cyBpbiB0aGUgbWlncmF0aW9uLlxuY29uc3QgTEVHQUNZX1BPT0xFRF9IQU5ET0ZGX0lEX1BSRUZJWCA9IFwidmVsb2Npb3VzLXBvb2xlZDpcIlxuY29uc3QgTEVHQUNZX1BPT0xFRF9RVUVVRURfSEFORE9GRl9JRCA9IGAke0xFR0FDWV9QT09MRURfSEFORE9GRl9JRF9QUkVGSVh9cXVldWVkYFxuY29uc3QgSk9CU19UQUJMRSA9IFwiYmFja2dyb3VuZF9qb2JzXCJcbmNvbnN0IEpPQlNfSU5ERVhfQ09MVU1OX05BTUVTID0gW1xuICBcImpvYl9uYW1lXCIsXG4gIFwicXVldWVcIixcbiAgXCJzdGF0dXNcIixcbiAgXCJzY2hlZHVsZWRfYXRfbXNcIixcbiAgXCJjcmVhdGVkX2F0X21zXCIsXG4gIFwic2NoZWR1bGVfa2V5XCIsXG4gIFwiaGFuZGVkX29mZl9hdF9tc1wiLFxuICBcIm9ycGhhbmVkX2F0X21zXCIsXG4gIFwiY29uY3VycmVuY3lfa2V5XCJcbl1cbmNvbnN0IElERU1QT1RFTkNZX0tFWVNfVEFCTEUgPSBcImJhY2tncm91bmRfam9iX2lkZW1wb3RlbmN5X2tleXNcIlxuY29uc3QgU0NIRURVTEVfS0VZU19UQUJMRSA9IFwiYmFja2dyb3VuZF9qb2Jfc2NoZWR1bGVfa2V5c1wiXG5jb25zdCBTQ0hFRFVMRV9PUkRFUl9XQVRFUk1BUktTX1RBQkxFID0gXCJiYWNrZ3JvdW5kX2pvYl9zY2hlZHVsZV9vcmRlcl93YXRlcm1hcmtzXCJcbmNvbnN0IFNDSEVEVUxFX09SREVSX1dBVEVSTUFSS19NSUdSQVRJT05fVkVSU0lPTiA9IFwiMjAyNjA5MTExMjAwMDBcIlxuY29uc3QgU0NIRURVTEVfSElTVE9SWV9PUkRFUl9JTkRFWCA9IFwiaW5kZXhfYmFja2dyb3VuZF9qb2JzX3NjaGVkdWxlX2hpc3Rvcnlfb3JkZXJcIlxuY29uc3QgQ09OQ1VSUkVOQ1lfVEFCTEUgPSBcImJhY2tncm91bmRfam9iX2NvbmN1cnJlbmN5XCJcbmNvbnN0IENPVU5UU19SRVZJU0lPTl9UQUJMRSA9IFwiYmFja2dyb3VuZF9qb2JfY291bnRfcmV2aXNpb25zXCJcbmNvbnN0IENPVU5UU19SRVZJU0lPTl9LRVkgPSBcImNvdW50c1wiXG5jb25zdCBDT05DVVJSRU5DWV9SRUNPTkNJTElBVElPTl9MT0NLID0gXCJiYWNrZ3JvdW5kLWpvYnM6cXVldWUtY29uY3VycmVuY3ktcmVjb25jaWxlXCJcbmNvbnN0IENPTkNVUlJFTkNZX1JFUEFJUl9TQU1QTEVfTElNSVQgPSAxMFxuZXhwb3J0IGNvbnN0IEJBQ0tHUk9VTkRfSk9CX0NPVU5UU19DSEFOTkVMID0gXCJ2ZWxvY2lvdXMtYmFja2dyb3VuZC1qb2ItY291bnRzXCJcbmV4cG9ydCBjb25zdCBCQUNLR1JPVU5EX0pPQl9DT1VOVF9CVUNLRVRTID0gW1wiYWxsXCIsIFwicXVldWVkXCIsIFwiaGFuZGVkX29mZlwiLCBcImNvbXBsZXRlZFwiLCBcImZhaWxlZFwiLCBcIm9ycGhhbmVkXCJdXG5jb25zdCBDT1VOVEVEX0pPQl9TVEFUVVNFUyA9IEJBQ0tHUk9VTkRfSk9CX0NPVU5UX0JVQ0tFVFMuc2xpY2UoMSlcbmNvbnN0IE1BWF9KT0JfVElNRU9VVF9NUyA9IDJfMTQ3XzQ4M182NDdcbmNvbnN0IEpPQl9USU1FT1VUX1ZBTElEQVRJT05fTUVTU0FHRSA9IGBiYWNrZ3JvdW5kIGpvYiB0aW1lb3V0TXMgbXVzdCBiZSBhIGZpbml0ZSBub24tcG9zaXRpdmUgbnVtYmVyIG9yIGFuIGludGVnZXIgYmV0d2VlbiAxIGFuZCAke01BWF9KT0JfVElNRU9VVF9NU31gXG5jb25zdCBPUlBIQU5FRF9BRlRFUl9NUyA9IDIgKiA2MCAqIDYwICogMTAwMFxuXG4vKipcbiAqIENvbHVtbnMgdGhlIGRhc2hib2FyZCBpcyBhbGxvd2VkIHRvIHNvcnQgam9iIGxpc3RpbmdzIGJ5LCBtYXBwZWQgdG8gdGhlaXJcbiAqIGRhdGFiYXNlIGNvbHVtbiBuYW1lcy4gUmVzdHJpY3RpbmcgdG8gdGhpcyBzZXQga2VlcHMgdGhlIHNvcnQgcGFyYW1ldGVyXG4gKiAod2hpY2ggb3JpZ2luYXRlcyBmcm9tIHVudHJ1c3RlZCBxdWVyeSBzdHJpbmdzKSBmcm9tIHJlYWNoaW5nIHJhdyBTUUwuXG4gKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgc3RyaW5nPn1cbiAqL1xuY29uc3QgU09SVEFCTEVfQ09MVU1OUyA9IHtcbiAgYXR0ZW1wdHM6IFwiYXR0ZW1wdHNcIixcbiAgY29tcGxldGVkQXRNczogXCJjb21wbGV0ZWRfYXRfbXNcIixcbiAgY3JlYXRlZEF0TXM6IFwiY3JlYXRlZF9hdF9tc1wiLFxuICBmYWlsZWRBdE1zOiBcImZhaWxlZF9hdF9tc1wiLFxuICBoYW5kZWRPZmZBdE1zOiBcImhhbmRlZF9vZmZfYXRfbXNcIixcbiAgc2NoZWR1bGVkQXRNczogXCJzY2hlZHVsZWRfYXRfbXNcIlxufVxuXG4vKipcbiAqIFNlcmlhbGl6ZXMgY29uY3VycmVudCBgX2FwcGx5U2NoZW1hYCBydW5zIHdpdGhpbiBUSElTIHByb2Nlc3MsIGtleWVkIGJ5IGRhdGFiYXNlXG4gKiBpZGVudGlmaWVyLCBiZWZvcmUgY2FsbGVycyB3aXRob3V0IGFuIGV4aXN0aW5nIGNvbm5lY3Rpb24gY2hlY2sgb25lIG91dC4gVHdvXG4gKiBzdG9yZXMgdGhhdCBzaGFyZSBvbmUgY29ubmVjdGlvbiAoU2luZ2xlTXVsdGlVc2UgLyBTUUxpdGUpXG4gKiBvdGhlcndpc2UgaW50ZXJsZWF2ZSB0aGUgbXVsdGktc3RlcCB0YWJsZSByZWJ1aWxkIGFuZCBjb3JydXB0IGl0ICh0aGUgam9icyB0YWJsZVxuICogaXMgbGVmdCBhcyBpdHMgYCpfdmVsb2Npb3VzX3JlYnVpbGRgIHRlbXApLiBBIERCIGFkdmlzb3J5IGxvY2sgY2FuJ3QgZml4IHRoYXQ6IG9uXG4gKiBhIHNlc3Npb24tc2NvcGVkIC8gcmUtZW50cmFudCBkcml2ZXIgKE15U1FMIGBHRVRfTE9DS2ApIGEgc2Vjb25kIGFjcXVpcmUgb24gdGhlXG4gKiBzYW1lIHNlc3Npb24gc3VjY2VlZHMgaW1tZWRpYXRlbHkgc28gYm90aCBjYWxsZXJzIHByb2NlZWQsIGFuZCB0YWtpbmcgaXQgb24gYVxuICogc2VwYXJhdGUgY29ubmVjdGlvbiBibG9ja3MgY3Jvc3Mtc2Vzc2lvbiBmb3JldmVyLiBBbiBpbi1wcm9jZXNzIHByb21pc2UtY2hhaW5cbiAqIG11dGV4IHNlcmlhbGl6ZXMgc2FtZS1wcm9jZXNzIGNhbGxlcnMgd2l0aCBuZWl0aGVyIGhhemFyZC4gQ3Jvc3MtcHJvY2VzcyBzY2hlbWFcbiAqIHJhY2VzIHN0YXkgY292ZXJlZCBieSB0aGUgcGVyLXN0ZXAgYWR2aXNvcnkgbG9ja3MgKyByZWNoZWNrcyBpbnNpZGUgdGhlIHN0ZXBzLlxuICogQHR5cGUge01hcDxzdHJpbmcsIFByb21pc2U8dm9pZD4+fVxuICovXG5jb25zdCBzY2hlbWFBcHBseUNoYWlucyA9IG5ldyBNYXAoKVxuLyoqIEB0eXBlIHtNYXA8c3RyaW5nLCBQcm9taXNlPHZvaWQ+Pn0gKi9cbmNvbnN0IHRyYW5zYWN0aW9uTXV0YXRpb25DaGFpbnMgPSBuZXcgTWFwKClcblxuZXhwb3J0IGRlZmF1bHQgY2xhc3MgQmFja2dyb3VuZEpvYnNTdG9yZSBleHRlbmRzIEJhY2tncm91bmRKb2JzQWRhcHRlciB7XG4gIC8qKlxuICAgKiBSdW5zIGNvbnN0cnVjdG9yLlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIE9wdGlvbnMuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vY29uZmlndXJhdGlvbi5qc1wiKS5kZWZhdWx0fSBhcmdzLmNvbmZpZ3VyYXRpb24gLSBDb25maWd1cmF0aW9uLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gW2FyZ3MuZGF0YWJhc2VJZGVudGlmaWVyXSAtIERhdGFiYXNlIGlkZW50aWZpZXIuXG4gICAqIEBwYXJhbSB7e25vdzogKCkgPT4gbnVtYmVyfX0gW2FyZ3MuY2xvY2tdIC0gSW5qZWN0YWJsZSBwZXJzaXN0ZW5jZSBjbG9jay5cbiAgICogQHBhcmFtIHsocHJvZHVjZXJQcm9vZjogaW1wb3J0KFwiLi90eXBlcy5qc1wiKS5CYWNrZ3JvdW5kSm9iUHJvZHVjZXJQcm9vZikgPT4gdm9pZCB8IFByb21pc2U8dm9pZD59IFthcmdzLmFmdGVyT3duZWRQcm9kdWNlclZhbGlkYXRpb25dIC0gRXhhY3Qgb3duZWQtZW5xdWV1ZSB2YWxpZGF0aW9uIGhvb2suXG4gICAqL1xuICBjb25zdHJ1Y3Rvcih7Y29uZmlndXJhdGlvbiwgZGF0YWJhc2VJZGVudGlmaWVyLCBjbG9jaywgYWZ0ZXJPd25lZFByb2R1Y2VyVmFsaWRhdGlvbn0pIHtcbiAgICBzdXBlcigpXG4gICAgdGhpcy5jb25maWd1cmF0aW9uID0gY29uZmlndXJhdGlvblxuICAgIHRoaXMuZGF0YWJhc2VJZGVudGlmaWVyID0gZGF0YWJhc2VJZGVudGlmaWVyXG4gICAgdGhpcy5jbG9jayA9IGNsb2NrIHx8IHtub3c6ICgpID0+IERhdGUubm93KCl9XG4gICAgdGhpcy5hZnRlck93bmVkUHJvZHVjZXJWYWxpZGF0aW9uID0gYWZ0ZXJPd25lZFByb2R1Y2VyVmFsaWRhdGlvblxuICAgIHRoaXMubG9nZ2VyID0gbmV3IExvZ2dlcih0aGlzKVxuICAgIHRoaXMuX3JlYWR5UHJvbWlzZSA9IG51bGxcbiAgICB0aGlzLl9xdWV1ZUNvbmN1cnJlbmN5UmVjb25jaWxlZCA9IGZhbHNlXG4gIH1cblxuICAvKipcbiAgICogUnVucyBnZXQgZGF0YWJhc2UgaWRlbnRpZmllci5cbiAgICogQHJldHVybnMge3N0cmluZ30gLSBEYXRhYmFzZSBpZGVudGlmaWVyLlxuICAgKi9cbiAgZ2V0RGF0YWJhc2VJZGVudGlmaWVyKCkge1xuICAgIGlmICh0aGlzLmRhdGFiYXNlSWRlbnRpZmllcikgcmV0dXJuIHRoaXMuZGF0YWJhc2VJZGVudGlmaWVyXG5cbiAgICByZXR1cm4gdGhpcy5jb25maWd1cmF0aW9uLmdldEJhY2tncm91bmRKb2JzQ29uZmlnKCkuZGF0YWJhc2VJZGVudGlmaWVyXG4gIH1cblxuICAvKipcbiAgICogUnVucyBlbnN1cmUgcmVhZHkuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIHdoZW4gcmVhZHkuXG4gICAqL1xuICBhc3luYyBlbnN1cmVSZWFkeSgpIHtcbiAgICBpZiAodGhpcy5fcmVhZHlQcm9taXNlKSByZXR1cm4gYXdhaXQgdGhpcy5fcmVhZHlQcm9taXNlXG5cbiAgICB0aGlzLl9yZWFkeVByb21pc2UgPSAoYXN5bmMgKCkgPT4ge1xuICAgICAgdGhpcy5jb25maWd1cmF0aW9uLnNldEN1cnJlbnQoKVxuICAgICAgYXdhaXQgdGhpcy5fZW5zdXJlU2NoZW1hKClcbiAgICAgIGF3YWl0IHRoaXMuX2luaXRpYWxpemVNb2RlbCgpXG4gICAgfSkoKVxuXG4gICAgdHJ5IHtcbiAgICAgIGF3YWl0IHRoaXMuX3JlYWR5UHJvbWlzZVxuICAgIH0gZmluYWxseSB7XG4gICAgICB0aGlzLl9yZWFkeVByb21pc2UgPSBudWxsXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIEVuc3VyZXMgdGhlIGJhY2tncm91bmQtam9icyBzY2hlbWEgKHRhYmxlcyArIGNvbHVtbnMpIGV4aXN0cyBvbiB0aGUgY29uZmlndXJlZFxuICAgKiBkYXRhYmFzZSwgd2l0aG91dCBpbml0aWFsaXppbmcgdGhlIHJ1bnRpbWUgbW9kZWwuIExldHMgYGRiOm1pZ3JhdGVgIGNyZWF0ZSB0aGVcbiAgICogZnJhbWV3b3JrJ3Mgb3duIHNjaGVtYSBkZXRlcm1pbmlzdGljYWxseSBhbG9uZ3NpZGUgYXBwIG1pZ3JhdGlvbnMg4oCUIGFuZCBjYXB0dXJlXG4gICAqIGl0IGluIHRoZSBkdW1wZWQgc3RydWN0dXJlIFNRTCDigJQgaW5zdGVhZCBvZiBpdCBvbmx5IGFwcGVhcmluZyBvbmNlIGEgc3RvcmUgYm9vdHMuXG4gICAqIElkZW1wb3RlbnQ6IHJldXNlcyB0aGUgc2FtZSBgX2Vuc3VyZVNjaGVtYWAgdGhlIHJ1bnRpbWUgc3RvcmUgdXNlcywgd2hpY2ggc2tpcHNcbiAgICogd29yayBhbHJlYWR5IGFwcGxpZWQgKHRyYWNrZWQgaW4gYHZlbG9jaW91c19pbnRlcm5hbF9taWdyYXRpb25zYCkuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vZGF0YWJhc2UvZHJpdmVycy9iYXNlLmpzXCIpLmRlZmF1bHR9IFtkYl0gLSBSZXVzZSBhbiBhbHJlYWR5XG4gICAqICAgY2hlY2tlZC1vdXQgY29ubmVjdGlvbiAoZS5nLiB0aGUgb25lIGBkYjptaWdyYXRlYCBob2xkcykgcmF0aGVyIHRoYW4gb3BlbmluZyBhXG4gICAqICAgbmVzdGVkIGNoZWNrb3V0IHRoYXQgd291bGQgZGVhZGxvY2sgYSBzaW5nbGUtY29ubmVjdGlvbiBwb29sLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyB3aGVuIHRoZSBzY2hlbWEgaXMgcHJlc2VudC5cbiAgICovXG4gIGFzeW5jIGVuc3VyZVNjaGVtYShkYikge1xuICAgIC8vIFdoZW4gYSBjb25uZWN0aW9uIGlzIGhhbmRlZCBpbiAodGhlIGRiOm1pZ3JhdGUgcGF0aCksIHRoZSBjYWxsZXIgYWxyZWFkeSBvd25zXG4gICAgLy8gdGhlIGFjdGl2ZSBjb25maWd1cmF0aW9uICsgY29ubmVjdGlvbiBjb250ZXh0OyBjYWxsaW5nIHNldEN1cnJlbnQoKSBoZXJlIHdvdWxkXG4gICAgLy8gY2xvYmJlciBpdCAoZS5nLiB0aGUgYnJvd3NlciB0ZXN0IHJ1bm5lciBqdWdnbGVzIG11bHRpcGxlIGNvbmZpZ3VyYXRpb25zKS5cbiAgICBpZiAoIWRiKSB0aGlzLmNvbmZpZ3VyYXRpb24uc2V0Q3VycmVudCgpXG5cbiAgICBhd2FpdCB0aGlzLl9lbnN1cmVTY2hlbWEoZGIpXG4gIH1cblxuICAvKipcbiAgICogUmVjb25jaWxlcyBxdWV1ZS1kZXJpdmVkIGNvbmN1cnJlbmN5IHdpdGggdGhlIGN1cnJlbnQgY29uZmlndXJhdGlvbjogdGhlXG4gICAqIGV4cGxpY2l0IGxpZmVjeWNsZSBwYXRoIHRoYXQgYWRvcHRzL3JlbGVhc2VzIHBlcnNpc3RlZCBxdWV1ZWQgam9icyBvbnRvXG4gICAqIHF1ZXVlIGNvbmN1cnJlbmN5IGtleXMgd2hlbiBgcXVldWVzW25hbWVdLm1heENvbmN1cnJlbnRgIGlzIGFkZGVkLCByZW1vdmVkLFxuICAgKiBvciBjaGFuZ2VkLiBDYWxsZWQgYnkgdGhlIGJhY2tncm91bmQtam9icyBtYWluIHByb2Nlc3Mgb24gc3RhcnR1cCDigJQgdGhlXG4gICAqIGRlcGxveS10aW1lIG1vbWVudCBxdWV1ZSBjb25maWd1cmF0aW9uIGNoYW5nZXMgdGFrZSBlZmZlY3QuIFNjaGVtYS90ZW5hbnRcbiAgICogY2hlY2tzIGFuZCByb3V0aW5lIGNvbm5lY3Rpb24gaW5pdGlhbGl6YXRpb24gZGVsaWJlcmF0ZWx5IG5ldmVyIHJ1biB0aGlzOlxuICAgKiB0aGV5IHN0YXkgcmVhZC1vbmx5IHJlZ2FyZGluZyBxdWV1ZWQgam9iIHJvd3MsIGJlY2F1c2UgdGhlIGJyb2FkXG4gICAqIGFkb3B0aW9uL3JlbGVhc2UgVVBEQVRFcyBkZWFkbG9jayBhZ2FpbnN0IGFjdGl2ZSBqb2IgcHJvY2Vzc2VzIHVuZGVyXG4gICAqIGNvbmN1cnJlbnQgdGVuYW50IGluaXRpYWxpemF0aW9uLiBTZXJpYWxpemVkIGFjcm9zcyBwcm9jZXNzZXMgd2l0aCBhXG4gICAqIGRhdGFiYXNlIGFkdmlzb3J5IGxvY2sgc28gY29uY3VycmVudGx5IHN0YXJ0ZWQgbWFpbnMgY2Fubm90IGludGVybGVhdmUgdGhlXG4gICAqIFVQREFURXM7IHRoZSBwZXItaW5zdGFuY2UgbWVtbyBvbmx5IHNraXBzIHJlcGVhdCB3b3JrIHdpdGhpbiB0aGlzIHByb2Nlc3MuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIHdoZW4gcmVjb25jaWxlZC5cbiAgICovXG4gIGFzeW5jIHJlY29uY2lsZVF1ZXVlQ29uY3VycmVuY3koKSB7XG4gICAgaWYgKHRoaXMuX3F1ZXVlQ29uY3VycmVuY3lSZWNvbmNpbGVkKSByZXR1cm5cblxuICAgIGNvbnN0IGRhdGFiYXNlSWRlbnRpZmllciA9IHRoaXMuZ2V0RGF0YWJhc2VJZGVudGlmaWVyKClcbiAgICBjb25zdCBzdGFydGVkQXRNcyA9IERhdGUubm93KClcblxuICAgIGF3YWl0IHRoaXMubG9nZ2VyLmluZm8oKCkgPT4gW1xuICAgICAgXCJTdGFydGluZyBiYWNrZ3JvdW5kIGpvYnMgcXVldWUtY29uY3VycmVuY3kgc3RhcnR1cCByZWNvbmNpbGlhdGlvblwiLFxuICAgICAge2RhdGFiYXNlSWRlbnRpZmllcn1cbiAgICBdKVxuICAgIGF3YWl0IHRoaXMuZW5zdXJlUmVhZHkoKVxuXG4gICAgYXdhaXQgdGhpcy5fd2l0aERiKGFzeW5jIChkYikgPT4ge1xuICAgICAgY29uc3QgYWNxdWlyZWQgPSBhd2FpdCBkYi5hY3F1aXJlQWR2aXNvcnlMb2NrKENPTkNVUlJFTkNZX1JFQ09OQ0lMSUFUSU9OX0xPQ0spXG5cbiAgICAgIGlmICghYWNxdWlyZWQpIHRocm93IG5ldyBFcnJvcihcIkZhaWxlZCB0byBhY3F1aXJlIGJhY2tncm91bmQgam9iIHF1ZXVlLWNvbmN1cnJlbmN5IHJlY29uY2lsZSBsb2NrXCIpXG5cbiAgICAgIHRyeSB7XG4gICAgICAgIGF3YWl0IHRoaXMuX3JlY29uY2lsZVF1ZXVlQ29uY3VycmVuY3koZGIpXG4gICAgICAgIGF3YWl0IHRoaXMuX3JlY29uY2lsZUNvbmN1cnJlbmN5KGRiKVxuXG4gICAgICAgIC8vIExhdGNoIHRoZSBtZW1vIG9ubHkgYWZ0ZXIgQk9USCBzdGVwcyBzdWNjZWVkOiBpZiB0aGUgY291bnQgcmVidWlsZFxuICAgICAgICAvLyBmYWlscyBhZnRlciBhZG9wdGlvbiwgYSByZXRyeSBvbiB0aGlzIHN0b3JlIG11c3QgcmUtZW50ZXIgYW5kIHJlcGFpclxuICAgICAgICAvLyB0aGUgY291bnRzIChhZG9wdGlvbiBpdHNlbGYgaXMgaWRlbXBvdGVudCkuXG4gICAgICAgIHRoaXMuX3F1ZXVlQ29uY3VycmVuY3lSZWNvbmNpbGVkID0gdHJ1ZVxuICAgICAgfSBmaW5hbGx5IHtcbiAgICAgICAgYXdhaXQgZGIucmVsZWFzZUFkdmlzb3J5TG9jayhDT05DVVJSRU5DWV9SRUNPTkNJTElBVElPTl9MT0NLKVxuICAgICAgfVxuICAgIH0pXG5cbiAgICBhd2FpdCB0aGlzLmxvZ2dlci5pbmZvKCgpID0+IFtcbiAgICAgIFwiQ29tcGxldGVkIGJhY2tncm91bmQgam9icyBxdWV1ZS1jb25jdXJyZW5jeSBzdGFydHVwIHJlY29uY2lsaWF0aW9uXCIsXG4gICAgICB7ZGF0YWJhc2VJZGVudGlmaWVyLCBkdXJhdGlvbk1zOiBEYXRlLm5vdygpIC0gc3RhcnRlZEF0TXN9XG4gICAgXSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSZXBhaXJzIGR1cmFibGUgYWN0aXZlLWNvdW50IGRyaWZ0IHdoaWxlIGEgbWFpbiBwcm9jZXNzIHJlbWFpbnMgbGl2ZS4gVGhlXG4gICAqIGluaXRpYWwgc25hcHNob3QgaXMgcmVhZC1vbmx5OyBvbmx5IHN1c3BlY3RlZCBtaXNtYXRjaGVzIHRha2UgdGhlaXJcbiAgICogY291bnRlciBsb2NrIGFuZCByZS1jb3VudCBpbnNpZGUgdGhlIHNlcmlhbGl6ZWQgdHJhbnNhY3Rpb24gcGF0aC5cbiAgICogQHJldHVybnMge1Byb21pc2U8aW1wb3J0KFwiLi90eXBlcy5qc1wiKS5CYWNrZ3JvdW5kSm9iQ29uY3VycmVuY3lSZWNvbmNpbGlhdGlvbj59IC0gUmVwYWlyIHN1bW1hcnkuXG4gICAqL1xuICBhc3luYyByZWNvbmNpbGVBY3RpdmVDb25jdXJyZW5jeSgpIHtcbiAgICBjb25zdCBkYXRhYmFzZUlkZW50aWZpZXIgPSB0aGlzLmdldERhdGFiYXNlSWRlbnRpZmllcigpXG4gICAgY29uc3Qgc3RhcnRlZEF0TXMgPSBEYXRlLm5vdygpXG5cbiAgICBhd2FpdCB0aGlzLmVuc3VyZVJlYWR5KClcblxuICAgIGNvbnN0IHJlc3VsdCA9IGF3YWl0IHRoaXMuX3NlcmlhbGl6ZWRDb25uZWN0aW9uTXV0YXRpb24oXG4gICAgICBhc3luYyAoZGIpID0+IGF3YWl0IHRoaXMuX3JlY29uY2lsZUNvbmN1cnJlbmN5KGRiKSxcbiAgICAgIHtcbiAgICAgICAgYWR2aXNvcnlMb2NrOiB7XG4gICAgICAgICAgZmFpbHVyZU1lc3NhZ2U6IFwiRmFpbGVkIHRvIGFjcXVpcmUgYmFja2dyb3VuZCBqb2IgYWN0aXZlLWNvbmN1cnJlbmN5IHJlY29uY2lsZSBsb2NrXCIsXG4gICAgICAgICAgbmFtZTogQ09OQ1VSUkVOQ1lfUkVDT05DSUxJQVRJT05fTE9DS1xuICAgICAgICB9XG4gICAgICB9XG4gICAgKVxuXG4gICAgaWYgKHJlc3VsdC5yZXBhaXJlZENvdW50ID4gMCkge1xuICAgICAgYXdhaXQgdGhpcy5sb2dnZXIud2FybigoKSA9PiBbXG4gICAgICAgIFwiUmVwYWlyZWQgYmFja2dyb3VuZCBqb2JzIGFjdGl2ZS1jb25jdXJyZW5jeSBjb3VudCBkcmlmdFwiLFxuICAgICAgICB7XG4gICAgICAgICAgZGF0YWJhc2VJZGVudGlmaWVyLFxuICAgICAgICAgIGR1cmF0aW9uTXM6IERhdGUubm93KCkgLSBzdGFydGVkQXRNcyxcbiAgICAgICAgICByZXBhaXJlZENvdW50OiByZXN1bHQucmVwYWlyZWRDb3VudCxcbiAgICAgICAgICByZXBhaXJzOiByZXN1bHQucmVwYWlycyxcbiAgICAgICAgICByZXBhaXJzVHJ1bmNhdGVkQ291bnQ6IHJlc3VsdC5yZXBhaXJzVHJ1bmNhdGVkQ291bnRcbiAgICAgICAgfVxuICAgICAgXSlcbiAgICB9XG5cbiAgICByZXR1cm4gcmVzdWx0XG4gIH1cblxuICAvKipcbiAgICogUnVucyBlbnF1ZXVlLlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIE9wdGlvbnMuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBhcmdzLmpvYk5hbWUgLSBKb2IgbmFtZS5cbiAgICogQHBhcmFtIHtBcnJheTxSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59IGFyZ3MuYXJncyAtIEFyZ3VtZW50cy5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL3R5cGVzLmpzXCIpLkJhY2tncm91bmRKb2JPcHRpb25zfSBbYXJncy5vcHRpb25zXSAtIE9wdGlvbnMuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHN0cmluZz59IC0gSm9iIGlkLlxuICAgKi9cbiAgYXN5bmMgZW5xdWV1ZSh7am9iTmFtZSwgYXJncywgb3B0aW9uc30pIHtcbiAgICBhd2FpdCB0aGlzLmVuc3VyZVJlYWR5KClcblxuICAgIGNvbnN0IHByZXBhcmVkSm9iID0gdGhpcy5fcHJlcGFyZUpvYih7am9iTmFtZSwgYXJncywgb3B0aW9uc30pXG5cbiAgICBpZiAob3B0aW9ucz8uaWRlbXBvdGVuY3lLZXkgIT09IHVuZGVmaW5lZCkge1xuICAgICAgcmV0dXJuIGF3YWl0IHRoaXMuX2VucXVldWVJZGVtcG90ZW50bHkoe2FyZ3M6IGFyZ3MgfHwgW10sIG9wdGlvbnMsIHByZXBhcmVkSm9ifSlcbiAgICB9XG5cbiAgICAvKiogQHR5cGUge3N0cmluZ30gKi9cbiAgICBsZXQgcmVzdWx0Sm9iSWQgPSBwcmVwYXJlZEpvYi5qb2JJZFxuXG4gICAgYXdhaXQgdGhpcy5fc2VyaWFsaXplZENvdW50TXV0YXRpb24oYXN5bmMgKGRiKSA9PiB7XG4gICAgICBpZiAob3B0aW9ucz8uZGVkdXBsaWNhdGVXaGlsZVF1ZXVlZCkge1xuICAgICAgICBjb25zdCBkdXBsaWNhdGVKb2JJZCA9IGF3YWl0IHRoaXMuX2RlZHVwbGljYXRlZFF1ZXVlZEpvYklkKGRiLCBwcmVwYXJlZEpvYilcblxuICAgICAgICBpZiAoZHVwbGljYXRlSm9iSWQpIHtcbiAgICAgICAgICByZXN1bHRKb2JJZCA9IGR1cGxpY2F0ZUpvYklkXG4gICAgICAgICAgcmV0dXJuXG4gICAgICAgIH1cbiAgICAgIH1cblxuICAgICAgYXdhaXQgdGhpcy5faW5zZXJ0UHJlcGFyZWRKb2IoZGIsIHtwcmVwYXJlZEpvYiwgc2NoZWR1bGVLZXk6IG51bGx9KVxuICAgICAgYXdhaXQgdGhpcy5fcmVjb3JkQ291bnREZWx0YShkYiwge2FsbDogMSwgcXVldWVkOiAxfSlcbiAgICB9KVxuXG4gICAgcmV0dXJuIHJlc3VsdEpvYklkXG4gIH1cblxuICAvKipcbiAgICogQXRvbWljYWxseSB2YWxpZGF0ZXMgYW4gZXhhY3QgcHJvZHVjaW5nIGhhbmRvZmYgYW5kIGVucXVldWVzIGl0cyBmb2xsb3ctdXAuXG4gICAqIEV2ZXJ5IGV4YWN0IHJlcXVlc3Qgb3ducyBhbiBpbnRlcm5hbCBkdXJhYmxlIHJlcGxheSBpZGVudGl0eSwgd2hpbGUgcXVldWVkXG4gICAqIGRlZHVwbGljYXRpb24gY2FuIHBvaW50IHNldmVyYWwgZGlzdGluY3QgcHJvZHVjZXIgZXZlbnRzIGF0IG9uZSBjb3ZlcmluZyByb3cuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gT3duZWQgZW5xdWV1ZSByZXF1ZXN0LlxuICAgKiBAcGFyYW0ge3N0cmluZ30gYXJncy5qb2JOYW1lIC0gSm9iIG5hbWUuXG4gICAqIEBwYXJhbSB7QXJyYXk8UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSBhcmdzLmFyZ3MgLSBBcmd1bWVudHMuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi90eXBlcy5qc1wiKS5CYWNrZ3JvdW5kSm9iT3B0aW9uc30gW2FyZ3Mub3B0aW9uc10gLSBPcHRpb25zLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gW2FyZ3MucHJvZHVjZXJJbnZvY2F0aW9uSWRdIC0gU3RhYmxlIGlkZW50aXR5IGZvciBvbmUgb3duZWQgZW5xdWV1ZSBpbnZvY2F0aW9uLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vdHlwZXMuanNcIikuQmFja2dyb3VuZEpvYlByb2R1Y2VyUHJvb2Z9IGFyZ3MucHJvZHVjZXJQcm9vZiAtIEV4YWN0IHByb2R1Y2VyIGxlYXNlLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxzdHJpbmc+fSAtIER1cmFibGUgZm9sbG93LXVwIGlkLlxuICAgKi9cbiAgYXN5bmMgZW5xdWV1ZUZyb21Pd25lZEhhbmRvZmYoe2pvYk5hbWUsIGFyZ3MsIG9wdGlvbnMsIHByb2R1Y2VySW52b2NhdGlvbklkLCBwcm9kdWNlclByb29mfSkge1xuICAgIGF3YWl0IHRoaXMuZW5zdXJlUmVhZHkoKVxuXG4gICAgY29uc3Qgbm9ybWFsaXplZFByb2R1Y2VyUHJvb2YgPSB0aGlzLl9ub3JtYWxpemVQcm9kdWNlclByb29mKHByb2R1Y2VyUHJvb2YpXG4gICAgY29uc3Qgbm9ybWFsaXplZFByb2R1Y2VySW52b2NhdGlvbklkID0gdGhpcy5fbm9ybWFsaXplUHJvZHVjZXJJbnZvY2F0aW9uSWQocHJvZHVjZXJJbnZvY2F0aW9uSWQpXG4gICAgY29uc3QgcHJlcGFyZWRKb2IgPSB0aGlzLl9wcmVwYXJlSm9iKHtqb2JOYW1lLCBhcmdzLCBvcHRpb25zfSlcblxuICAgIHJldHVybiBhd2FpdCB0aGlzLl9zZXJpYWxpemVkQ291bnRNdXRhdGlvbihhc3luYyAoZGIpID0+IHtcbiAgICAgIGF3YWl0IHRoaXMuX3ZhbGlkYXRlT3duZWRQcm9kdWNlclByb29mKGRiLCBub3JtYWxpemVkUHJvZHVjZXJQcm9vZilcbiAgICAgIGlmICh0aGlzLmFmdGVyT3duZWRQcm9kdWNlclZhbGlkYXRpb24pIGF3YWl0IHRoaXMuYWZ0ZXJPd25lZFByb2R1Y2VyVmFsaWRhdGlvbihub3JtYWxpemVkUHJvZHVjZXJQcm9vZilcblxuICAgICAgaWYgKG9wdGlvbnM/LmlkZW1wb3RlbmN5S2V5ICE9PSB1bmRlZmluZWQpIHtcbiAgICAgICAgcmV0dXJuIGF3YWl0IHRoaXMuX2VucXVldWVJZGVtcG90ZW50bHlJblRyYW5zYWN0aW9uKHtcbiAgICAgICAgICBhcmdzOiBhcmdzIHx8IFtdLFxuICAgICAgICAgIGNvdW50UmV2aXNpb25Mb2NrZWQ6IHRydWUsXG4gICAgICAgICAgZGIsXG4gICAgICAgICAgb3B0aW9ucyxcbiAgICAgICAgICBwcmVwYXJlZEpvYlxuICAgICAgICB9KVxuICAgICAgfVxuXG4gICAgICByZXR1cm4gYXdhaXQgdGhpcy5fZW5xdWV1ZU93bmVkUmVwbGF5SW5UcmFuc2FjdGlvbih7XG4gICAgICAgIGRiLFxuICAgICAgICBvcHRpb25zOiBvcHRpb25zIHx8IHt9LFxuICAgICAgICBwcmVwYXJlZEpvYixcbiAgICAgICAgcHJvZHVjZXJJbnZvY2F0aW9uSWQ6IG5vcm1hbGl6ZWRQcm9kdWNlckludm9jYXRpb25JZCxcbiAgICAgICAgcHJvZHVjZXJQcm9vZjogbm9ybWFsaXplZFByb2R1Y2VyUHJvb2ZcbiAgICAgIH0pXG4gICAgfSlcbiAgfVxuXG4gIC8qKlxuICAgKiBGaW5kcyB0aGUgZWFybGllc3QgcXVldWVkIGpvYiB0aGF0IGNvdmVycyB0aGlzIGVucXVldWUncyBpZGVudGl0eSBhbmQgdGltZS5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9kYXRhYmFzZS9kcml2ZXJzL2Jhc2UuanNcIikuZGVmYXVsdH0gZGIgLSBUcmFuc2FjdGlvbiBjb25uZWN0aW9uLlxuICAgKiBAcGFyYW0ge1ByZXBhcmVkQmFja2dyb3VuZEpvYn0gcHJlcGFyZWRKb2IgLSBOb3JtYWxpemVkIGpvYi5cbiAgICogQHJldHVybnMge1Byb21pc2U8c3RyaW5nIHwgbnVsbD59IC0gQ292ZXJpbmcgam9iIGlkLlxuICAgKi9cbiAgYXN5bmMgX2RlZHVwbGljYXRlZFF1ZXVlZEpvYklkKGRiLCBwcmVwYXJlZEpvYikge1xuICAgIC8vIERlZHVwZSBvbiB0aGUgam9iJ3MgaWRlbnRpdHkgKG5hbWUgKyBhcmdzICsgcXVldWUpLCBOT1QgaXRzIGNvbmN1cnJlbmN5IGtleSwgc28gYSBqb2JcbiAgICAvLyBrZWVwcyB3aGF0ZXZlciBjb25jdXJyZW5jeSBpdCByZXNvbHZlcyB0by4gT25seSBhbiBleGlzdGluZyBqb2Igc2NoZWR1bGVkIG5vIGxhdGVyIHRoYW5cbiAgICAvLyB0aGlzIGVucXVldWUgY2FuIGNvdmVyIGl0OyBhIHJldHJ5IGJhY2tlZCBvZmYgaW50byB0aGUgZnV0dXJlIG11c3Qgbm90IHN1cHByZXNzIGVhcmxpZXJcbiAgICAvLyB3b3JrLiBPcmRlcmluZyByZXR1cm5zIHRoZSBlYXJsaWVzdCBjb3ZlcmluZyBqb2Igd2hlbiBzZXZlcmFsIHF1ZXVlZCByb3dzIGFscmVhZHkgZXhpc3QuXG4gICAgY29uc3QgZXhpc3RpbmcgPSBhd2FpdCBkYlxuICAgICAgLm5ld1F1ZXJ5KClcbiAgICAgIC5mcm9tKEpPQlNfVEFCTEUpXG4gICAgICAuc2VsZWN0KFwiaWRcIilcbiAgICAgIC53aGVyZSh7c3RhdHVzOiBcInF1ZXVlZFwiLCBqb2JfbmFtZTogcHJlcGFyZWRKb2Iuam9iTmFtZSwgYXJnc19qc29uOiBwcmVwYXJlZEpvYi5hcmdzSnNvbiwgcXVldWU6IHByZXBhcmVkSm9iLnF1ZXVlfSlcbiAgICAgIC53aGVyZShgc2NoZWR1bGVkX2F0X21zIDw9ICR7ZGIucXVvdGUocHJlcGFyZWRKb2Iuc2NoZWR1bGVkQXRNcyl9YClcbiAgICAgIC5vcmRlcihcInNjaGVkdWxlZF9hdF9tcyBBU0NcIilcbiAgICAgIC5saW1pdCgxKVxuICAgICAgLnJlc3VsdHMoKVxuICAgIGNvbnN0IHJvdyA9IGV4aXN0aW5nWzBdXG5cbiAgICByZXR1cm4gcm93ID8gU3RyaW5nKC8qKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSAqLyAocm93KS5pZCkgOiBudWxsXG4gIH1cblxuICAvKipcbiAgICogUGVyc2lzdHMgb25lIGludGVybmFsIGV4YWN0LXJlcGxheSBvd25lciBhbmQgaXRzIHF1ZXVlZCBqb2IgaW4gdGhlIGNhbGxlcidzXG4gICAqIHByb2R1Y2VyLXZhbGlkYXRpb24gdHJhbnNhY3Rpb24uXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gVHJhbnNhY3Rpb24gaW5wdXQuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vZGF0YWJhc2UvZHJpdmVycy9iYXNlLmpzXCIpLmRlZmF1bHR9IGFyZ3MuZGIgLSBUcmFuc2FjdGlvbiBjb25uZWN0aW9uLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vdHlwZXMuanNcIikuQmFja2dyb3VuZEpvYk9wdGlvbnN9IGFyZ3Mub3B0aW9ucyAtIEVucXVldWUgb3B0aW9ucy5cbiAgICogQHBhcmFtIHtQcmVwYXJlZEJhY2tncm91bmRKb2J9IGFyZ3MucHJlcGFyZWRKb2IgLSBOb3JtYWxpemVkIGpvYi5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGFyZ3MucHJvZHVjZXJJbnZvY2F0aW9uSWQgLSBTdGFibGUgaWRlbnRpdHkgZm9yIG9uZSBvd25lZCBlbnF1ZXVlIGludm9jYXRpb24uXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi90eXBlcy5qc1wiKS5CYWNrZ3JvdW5kSm9iUHJvZHVjZXJQcm9vZn0gYXJncy5wcm9kdWNlclByb29mIC0gRXhhY3QgcHJvZHVjZXIgbGVhc2UuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHN0cmluZz59IC0gU3RhYmxlIHJlcGxheSBqb2IgaWQuXG4gICAqL1xuICBhc3luYyBfZW5xdWV1ZU93bmVkUmVwbGF5SW5UcmFuc2FjdGlvbih7ZGIsIG9wdGlvbnMsIHByZXBhcmVkSm9iLCBwcm9kdWNlckludm9jYXRpb25JZCwgcHJvZHVjZXJQcm9vZn0pIHtcbiAgICBjb25zdCByZXF1ZXN0RGlnZXN0ID0gdGhpcy5fb3duZWRFbnF1ZXVlUmVxdWVzdERpZ2VzdCh7b3B0aW9ucywgcHJlcGFyZWRKb2J9KVxuICAgIGNvbnN0IHNjb3BlRGlnZXN0ID0gdGhpcy5fb3duZWRFbnF1ZXVlU2NvcGVEaWdlc3Qoe3ByZXBhcmVkSm9iLCBwcm9kdWNlckludm9jYXRpb25JZCwgcHJvZHVjZXJQcm9vZiwgcmVxdWVzdERpZ2VzdH0pXG4gICAgY29uc3QgaWRlbXBvdGVuY3lLZXkgPSBgb3duZWQtaGFuZG9mZjoke3Njb3BlRGlnZXN0fWBcbiAgICBjb25zdCBleGlzdGluZyA9IGF3YWl0IHRoaXMuX2lkZW1wb3RlbmN5T3duZXJzaGlwKGRiLCBzY29wZURpZ2VzdClcbiAgICBjb25zdCBiYXNlT3duZXJzaGlwID0ge1xuICAgICAgY3JlYXRlZF9hdF9tczogcHJlcGFyZWRKb2IuY3JlYXRlZEF0TXMsXG4gICAgICBpZGVtcG90ZW5jeV9rZXk6IGlkZW1wb3RlbmN5S2V5LFxuICAgICAgam9iX25hbWU6IHByZXBhcmVkSm9iLmpvYk5hbWUsXG4gICAgICBxdWV1ZTogcHJlcGFyZWRKb2IucXVldWUsXG4gICAgICByZXF1ZXN0X2RpZ2VzdDogcmVxdWVzdERpZ2VzdCxcbiAgICAgIHNjb3BlX2RpZ2VzdDogc2NvcGVEaWdlc3RcbiAgICB9XG5cbiAgICBpZiAoZXhpc3RpbmcpIHtcbiAgICAgIHRoaXMuX3ZhbGlkYXRlSWRlbXBvdGVuY3lPd25lcnNoaXAoe2V4aXN0aW5nLCBvd25lcnNoaXA6IHsuLi5iYXNlT3duZXJzaGlwLCBqb2JfaWQ6IFN0cmluZyhleGlzdGluZy5qb2JfaWQpfX0pXG4gICAgICByZXR1cm4gU3RyaW5nKGV4aXN0aW5nLmpvYl9pZClcbiAgICB9XG5cbiAgICBjb25zdCBkdXBsaWNhdGVKb2JJZCA9IG9wdGlvbnMuZGVkdXBsaWNhdGVXaGlsZVF1ZXVlZFxuICAgICAgPyBhd2FpdCB0aGlzLl9kZWR1cGxpY2F0ZWRRdWV1ZWRKb2JJZChkYiwgcHJlcGFyZWRKb2IpXG4gICAgICA6IG51bGxcbiAgICBjb25zdCBvd25lcnNoaXAgPSB7Li4uYmFzZU93bmVyc2hpcCwgam9iX2lkOiBkdXBsaWNhdGVKb2JJZCB8fCBwcmVwYXJlZEpvYi5qb2JJZH1cbiAgICBjb25zdCBjbGFpbWVkID0gYXdhaXQgdGhpcy5fY2xhaW1JZGVtcG90ZW5jeU93bmVyc2hpcChkYiwgb3duZXJzaGlwKVxuXG4gICAgaWYgKCFjbGFpbWVkLmNyZWF0ZWQpIHtcbiAgICAgIHRoaXMuX3ZhbGlkYXRlSWRlbXBvdGVuY3lPd25lcnNoaXAoe2V4aXN0aW5nOiBjbGFpbWVkLnJvdywgb3duZXJzaGlwfSlcbiAgICAgIHJldHVybiBTdHJpbmcoY2xhaW1lZC5yb3cuam9iX2lkKVxuICAgIH1cbiAgICBpZiAoZHVwbGljYXRlSm9iSWQpIHJldHVybiBkdXBsaWNhdGVKb2JJZFxuXG4gICAgYXdhaXQgdGhpcy5faW5zZXJ0UHJlcGFyZWRKb2IoZGIsIHtwcmVwYXJlZEpvYiwgc2NoZWR1bGVLZXk6IG51bGx9KVxuICAgIGF3YWl0IHRoaXMuX3JlY29yZENvdW50RGVsdGEoZGIsIHthbGw6IDEsIHF1ZXVlZDogMX0pXG5cbiAgICByZXR1cm4gcHJlcGFyZWRKb2Iuam9iSWRcbiAgfVxuXG4gIC8qKlxuICAgKiBBdG9taWNhbGx5IG93bnMgb25lIGR1cmFibGUgaWRlbXBvdGVuY3kgc2NvcGUgYW5kIGNyZWF0ZXMgaXRzIGpvYiBleGFjdGx5IG9uY2UuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gRW5xdWV1ZSBpbnB1dC5cbiAgICogQHBhcmFtIHtBcnJheTxSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59IGFyZ3MuYXJncyAtIEpvYiBhcmd1bWVudHMuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi90eXBlcy5qc1wiKS5CYWNrZ3JvdW5kSm9iT3B0aW9uc30gYXJncy5vcHRpb25zIC0gSm9iIG9wdGlvbnMuXG4gICAqIEBwYXJhbSB7UHJlcGFyZWRCYWNrZ3JvdW5kSm9ifSBhcmdzLnByZXBhcmVkSm9iIC0gTm9ybWFsaXplZCBqb2IuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHN0cmluZz59IC0gU3RhYmxlIG9yaWdpbmFsIGpvYiBpZC5cbiAgICovXG4gIGFzeW5jIF9lbnF1ZXVlSWRlbXBvdGVudGx5KHthcmdzLCBvcHRpb25zLCBwcmVwYXJlZEpvYn0pIHtcbiAgICAvLyBSZXVzZSBvcmRpbmFyeSBlbnF1ZXVlIHRyYW5zYWN0aW9uIGFkbWlzc2lvbiBiZWNhdXNlIHRoaXMgcGF0aCBjaGFuZ2VzXG4gICAgLy8gdGhlIHNhbWUgZHVyYWJsZSBjb3VudCByZXZpc2lvbi4gVGhlIHNjb3BlIHByaW1hcnkga2V5IHJlbWFpbnMgdGhlXG4gICAgLy8gY3Jvc3MtcHJvY2VzcyBjb252ZXJnZW5jZSBvd25lci5cbiAgICByZXR1cm4gYXdhaXQgdGhpcy5faWRlbXBvdGVudEVucXVldWVUcmFuc2FjdGlvbihhc3luYyAoZGIpID0+IHtcbiAgICAgIHJldHVybiBhd2FpdCB0aGlzLl9lbnF1ZXVlSWRlbXBvdGVudGx5SW5UcmFuc2FjdGlvbih7YXJncywgZGIsIG9wdGlvbnMsIHByZXBhcmVkSm9ifSlcbiAgICB9KVxuICB9XG5cbiAgLyoqXG4gICAqIE93bnMgb3IgcmVwbGF5cyBvbmUgcHVibGljIGlkZW1wb3RlbmN5IGtleSBpbnNpZGUgdGhlIGNhbGxlcidzIHRyYW5zYWN0aW9uLlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIFRyYW5zYWN0aW9uIGlucHV0LlxuICAgKiBAcGFyYW0ge0FycmF5PFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gYXJncy5hcmdzIC0gSm9iIGFyZ3VtZW50cy5cbiAgICogQHBhcmFtIHtib29sZWFufSBbYXJncy5jb3VudFJldmlzaW9uTG9ja2VkXSAtIFdoZXRoZXIgdGhlIGNhbGxlciBhbHJlYWR5IG93bnMgY291bnQgc2VyaWFsaXphdGlvbi5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9kYXRhYmFzZS9kcml2ZXJzL2Jhc2UuanNcIikuZGVmYXVsdH0gYXJncy5kYiAtIFRyYW5zYWN0aW9uIGNvbm5lY3Rpb24uXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi90eXBlcy5qc1wiKS5CYWNrZ3JvdW5kSm9iT3B0aW9uc30gYXJncy5vcHRpb25zIC0gSm9iIG9wdGlvbnMuXG4gICAqIEBwYXJhbSB7UHJlcGFyZWRCYWNrZ3JvdW5kSm9ifSBhcmdzLnByZXBhcmVkSm9iIC0gTm9ybWFsaXplZCBqb2IuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHN0cmluZz59IC0gU3RhYmxlIG9yaWdpbmFsIGpvYiBpZC5cbiAgICovXG4gIGFzeW5jIF9lbnF1ZXVlSWRlbXBvdGVudGx5SW5UcmFuc2FjdGlvbih7YXJncywgY291bnRSZXZpc2lvbkxvY2tlZCA9IGZhbHNlLCBkYiwgb3B0aW9ucywgcHJlcGFyZWRKb2J9KSB7XG4gICAgY29uc3QgaWRlbXBvdGVuY3lLZXkgPSB0aGlzLl9ub3JtYWxpemVJZGVtcG90ZW5jeUtleShvcHRpb25zLmlkZW1wb3RlbmN5S2V5KVxuICAgIGNvbnN0IHNjb3BlRGlnZXN0ID0gdGhpcy5faWRlbXBvdGVuY3lTY29wZURpZ2VzdCh7aWRlbXBvdGVuY3lLZXksIGpvYk5hbWU6IHByZXBhcmVkSm9iLmpvYk5hbWUsIHF1ZXVlOiBwcmVwYXJlZEpvYi5xdWV1ZX0pXG4gICAgY29uc3QgcmVxdWVzdERpZ2VzdCA9IHRoaXMuX2lkZW1wb3RlbmN5UmVxdWVzdERpZ2VzdCh7YXJncywgb3B0aW9ucywgcHJlcGFyZWRKb2J9KVxuICAgIGNvbnN0IG93bmVyc2hpcCA9IHtcbiAgICAgIGNyZWF0ZWRfYXRfbXM6IHByZXBhcmVkSm9iLmNyZWF0ZWRBdE1zLFxuICAgICAgaWRlbXBvdGVuY3lfa2V5OiBpZGVtcG90ZW5jeUtleSxcbiAgICAgIGpvYl9pZDogcHJlcGFyZWRKb2Iuam9iSWQsXG4gICAgICBqb2JfbmFtZTogcHJlcGFyZWRKb2Iuam9iTmFtZSxcbiAgICAgIHF1ZXVlOiBwcmVwYXJlZEpvYi5xdWV1ZSxcbiAgICAgIHJlcXVlc3RfZGlnZXN0OiByZXF1ZXN0RGlnZXN0LFxuICAgICAgc2NvcGVfZGlnZXN0OiBzY29wZURpZ2VzdFxuICAgIH1cbiAgICBjb25zdCBtYWlsT3BlcmF0aW9uSW5wdXQgPSBtYWlsRGVsaXZlcnlPcGVyYXRpb25Gb3JKb2IocHJlcGFyZWRKb2Iuam9iTmFtZSwgYXJncylcblxuICAgIGlmIChtYWlsT3BlcmF0aW9uSW5wdXQgJiYgbWFpbE9wZXJhdGlvbklucHV0Lm9wZXJhdGlvbi5pZCAhPT0gaWRlbXBvdGVuY3lLZXkpIHtcbiAgICAgIHRocm93IFZlbG9jaW91c0Vycm9yLnNhZmUoXCJNYWlsIGRlbGl2ZXJ5IG9wZXJhdGlvbiBpZCBtdXN0IGVxdWFsIGl0cyBiYWNrZ3JvdW5kIGpvYiBpZGVtcG90ZW5jeSBrZXkuXCIsIHtcbiAgICAgICAgY29kZTogXCJtYWlsLWRlbGl2ZXJ5LWlkZW1wb3RlbmN5LWtleS1taXNtYXRjaFwiXG4gICAgICB9KVxuICAgIH1cblxuICAgIGNvbnN0IGV4aXN0aW5nID0gYXdhaXQgdGhpcy5faWRlbXBvdGVuY3lPd25lcnNoaXAoZGIsIHNjb3BlRGlnZXN0KVxuXG4gICAgaWYgKGV4aXN0aW5nKSB7XG4gICAgICB0aGlzLl92YWxpZGF0ZUlkZW1wb3RlbmN5T3duZXJzaGlwKHtleGlzdGluZywgb3duZXJzaGlwfSlcbiAgICAgIGF3YWl0IHRoaXMuX3ZhbGlkYXRlTWFpbERlbGl2ZXJ5T3BlcmF0aW9uKGRiLCB7am9iSWQ6IFN0cmluZyhleGlzdGluZy5qb2JfaWQpLCBtYWlsT3BlcmF0aW9uSW5wdXR9KVxuICAgICAgcmV0dXJuIFN0cmluZyhleGlzdGluZy5qb2JfaWQpXG4gICAgfVxuXG4gICAgY29uc3QgY2xhaW1lZCA9IGF3YWl0IHRoaXMuX2NsYWltSWRlbXBvdGVuY3lPd25lcnNoaXAoZGIsIG93bmVyc2hpcClcblxuICAgIGlmICghY2xhaW1lZC5jcmVhdGVkKSB7XG4gICAgICB0aGlzLl92YWxpZGF0ZUlkZW1wb3RlbmN5T3duZXJzaGlwKHtleGlzdGluZzogY2xhaW1lZC5yb3csIG93bmVyc2hpcH0pXG4gICAgICBhd2FpdCB0aGlzLl92YWxpZGF0ZU1haWxEZWxpdmVyeU9wZXJhdGlvbihkYiwge2pvYklkOiBTdHJpbmcoY2xhaW1lZC5yb3cuam9iX2lkKSwgbWFpbE9wZXJhdGlvbklucHV0fSlcbiAgICAgIHJldHVybiBTdHJpbmcoY2xhaW1lZC5yb3cuam9iX2lkKVxuICAgIH1cblxuICAgIGlmICghY291bnRSZXZpc2lvbkxvY2tlZCkgYXdhaXQgdGhpcy5fbG9ja0NvdW50UmV2aXNpb24oZGIpXG4gICAgYXdhaXQgdGhpcy5faW5zZXJ0UHJlcGFyZWRKb2IoZGIsIHtwcmVwYXJlZEpvYiwgc2NoZWR1bGVLZXk6IG51bGx9KVxuICAgIGF3YWl0IHRoaXMuX3BlcnNpc3RNYWlsRGVsaXZlcnlPcGVyYXRpb24oZGIsIHtqb2JJZDogcHJlcGFyZWRKb2Iuam9iSWQsIG1haWxPcGVyYXRpb25JbnB1dCwgY3JlYXRlZEF0TXM6IHByZXBhcmVkSm9iLmNyZWF0ZWRBdE1zfSlcbiAgICBhd2FpdCB0aGlzLl9yZWNvcmRDb3VudERlbHRhKGRiLCB7YWxsOiAxLCBxdWV1ZWQ6IDF9KVxuXG4gICAgcmV0dXJuIHByZXBhcmVkSm9iLmpvYklkXG4gIH1cblxuICAvKipcbiAgICogU2VyaWFsaXplcyBvbmUgcGh5c2ljYWwgY29ubmVjdGlvbiBsb2NhbGx5IHdpdGhvdXQgdGFraW5nIG93bmVyc2hpcCBhd2F5XG4gICAqIGZyb20gdGhlIGRhdGFiYXNlIHVuaXF1ZW5lc3MgY29uc3RyYWludCBzaGFyZWQgYnkgYWxsIHByb2Nlc3Nlcy5cbiAgICogQHRlbXBsYXRlIFRcbiAgICogQHBhcmFtIHsoZGI6IGltcG9ydChcIi4uL2RhdGFiYXNlL2RyaXZlcnMvYmFzZS5qc1wiKS5kZWZhdWx0KSA9PiBQcm9taXNlPFQ+fSBjYWxsYmFjayAtIFRyYW5zYWN0aW9uIHdvcmsuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPFQ+fSAtIENhbGxiYWNrIHJlc3VsdC5cbiAgICovXG4gIGFzeW5jIF9pZGVtcG90ZW50RW5xdWV1ZVRyYW5zYWN0aW9uKGNhbGxiYWNrKSB7XG4gICAgcmV0dXJuIGF3YWl0IHRoaXMuX3NlcmlhbGl6ZWRUcmFuc2FjdGlvbk11dGF0aW9uKGNhbGxiYWNrKVxuICB9XG5cbiAgLyoqXG4gICAqIEluc2VydHMgYW4gb3duZXJzaGlwIHJvdywgcmVzb2x2aW5nIG9ubHkgYSBkYXRhYmFzZSB1bmlxdWVuZXNzIHJhY2UuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vZGF0YWJhc2UvZHJpdmVycy9iYXNlLmpzXCIpLmRlZmF1bHR9IGRiIC0gVHJhbnNhY3Rpb24gY29ubmVjdGlvbi5cbiAgICogQHBhcmFtIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59IG93bmVyc2hpcCAtIE93bmVyc2hpcCByb3cuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHtjcmVhdGVkOiBib29sZWFuLCByb3c6IFJlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0+fSAtIENsYWltIHJlc3VsdC5cbiAgICovXG4gIGFzeW5jIF9jbGFpbUlkZW1wb3RlbmN5T3duZXJzaGlwKGRiLCBvd25lcnNoaXApIHtcbiAgICB0cnkge1xuICAgICAgLy8gVGhlIHNhdmVwb2ludCBrZWVwcyBQb3N0Z3JlU1FMJ3Mgb3V0ZXIgdHJhbnNhY3Rpb24gdXNhYmxlIGFmdGVyIGFcbiAgICAgIC8vIGNvbmN1cnJlbnQgdW5pcXVlLWtleSBsb3NzLiBUaGUgdW5pcXVlIHByaW1hcnkga2V5LCBub3QgYSBwcm9jZXNzXG4gICAgICAvLyBtdXRleCwgaXMgdGhlIGNyb3NzLXByb2Nlc3MgY29udmVyZ2VuY2UgYXV0aG9yaXR5LlxuICAgICAgYXdhaXQgZGIudHJhbnNhY3Rpb24oYXN5bmMgKCkgPT4ge1xuICAgICAgICBhd2FpdCBkYi5pbnNlcnQoe3RhYmxlTmFtZTogSURFTVBPVEVOQ1lfS0VZU19UQUJMRSwgZGF0YTogb3duZXJzaGlwfSlcbiAgICAgIH0pXG5cbiAgICAgIHJldHVybiB7Y3JlYXRlZDogdHJ1ZSwgcm93OiBvd25lcnNoaXB9XG4gICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgIGNvbnN0IHJhY2VkID0gYXdhaXQgdGhpcy5faWRlbXBvdGVuY3lPd25lcnNoaXAoZGIsIFN0cmluZyhvd25lcnNoaXAuc2NvcGVfZGlnZXN0KSlcblxuICAgICAgaWYgKCFyYWNlZCkgdGhyb3cgZXJyb3JcbiAgICAgIHJldHVybiB7Y3JlYXRlZDogZmFsc2UsIHJvdzogcmFjZWR9XG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIExvYWRzIG9uZSBkdXJhYmxlIGVucXVldWUgb3duZXIuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vZGF0YWJhc2UvZHJpdmVycy9iYXNlLmpzXCIpLmRlZmF1bHR9IGRiIC0gRGF0YWJhc2UgY29ubmVjdGlvbi5cbiAgICogQHBhcmFtIHtzdHJpbmd9IHNjb3BlRGlnZXN0IC0gRml4ZWQtc2l6ZSBzY29wZSBkaWdlc3QuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPFJlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+PiB8IG51bGw+fSAtIFJvdyBvciBudWxsLlxuICAgKi9cbiAgYXN5bmMgX2lkZW1wb3RlbmN5T3duZXJzaGlwKGRiLCBzY29wZURpZ2VzdCkge1xuICAgIGNvbnN0IHJvd3MgPSBhd2FpdCBkYi5uZXdRdWVyeSgpLmZyb20oSURFTVBPVEVOQ1lfS0VZU19UQUJMRSkud2hlcmUoe3Njb3BlX2RpZ2VzdDogc2NvcGVEaWdlc3R9KS5saW1pdCgxKS5yZXN1bHRzKClcblxuICAgIHJldHVybiByb3dzWzBdID8gLyoqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59ICovIChyb3dzWzBdKSA6IG51bGxcbiAgfVxuXG4gIC8qKlxuICAgKiBGYWlscyBjbG9zZWQgd2hlbiBhIGR1cmFibGUga2V5IGlzIHJldXNlZCBmb3IgYSBkaWZmZXJlbnQgY2Fub25pY2FsIHJlcXVlc3QuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gVmFsaWRhdGlvbiBpbnB1dC5cbiAgICogQHBhcmFtIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59IGFyZ3MuZXhpc3RpbmcgLSBTdG9yZWQgb3duZXIuXG4gICAqIEBwYXJhbSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSBhcmdzLm93bmVyc2hpcCAtIFJlcXVlc3RlZCBvd25lci5cbiAgICogQHJldHVybnMge3ZvaWR9XG4gICAqL1xuICBfdmFsaWRhdGVJZGVtcG90ZW5jeU93bmVyc2hpcCh7ZXhpc3RpbmcsIG93bmVyc2hpcH0pIHtcbiAgICBjb25zdCBleGFjdFNjb3BlID0gU3RyaW5nKGV4aXN0aW5nLmpvYl9uYW1lKSA9PT0gb3duZXJzaGlwLmpvYl9uYW1lXG4gICAgICAmJiBTdHJpbmcoZXhpc3RpbmcucXVldWUpID09PSBvd25lcnNoaXAucXVldWVcbiAgICAgICYmIFN0cmluZyhleGlzdGluZy5pZGVtcG90ZW5jeV9rZXkpID09PSBvd25lcnNoaXAuaWRlbXBvdGVuY3lfa2V5XG5cbiAgICBpZiAoIWV4YWN0U2NvcGUgfHwgU3RyaW5nKGV4aXN0aW5nLnJlcXVlc3RfZGlnZXN0KSAhPT0gb3duZXJzaGlwLnJlcXVlc3RfZGlnZXN0KSB7XG4gICAgICB0aHJvdyBWZWxvY2lvdXNFcnJvci5zYWZlKFwiVGhlIGJhY2tncm91bmQgam9iIGlkZW1wb3RlbmN5IGtleSB3YXMgYWxyZWFkeSB1c2VkIGZvciBhIGRpZmZlcmVudCByZXF1ZXN0LlwiLCB7XG4gICAgICAgIGNvZGU6IFwiYmFja2dyb3VuZC1qb2ItaWRlbXBvdGVuY3ktY29uZmxpY3RcIlxuICAgICAgfSlcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogUGVyc2lzdHMgdGhlIGJ1aWx0LWluIG1haWwgb3BlcmF0aW9uIGluIHRoZSBzYW1lIGZpcnN0LWVucXVldWUgdHJhbnNhY3Rpb24uXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vZGF0YWJhc2UvZHJpdmVycy9iYXNlLmpzXCIpLmRlZmF1bHR9IGRiIC0gVHJhbnNhY3Rpb24gY29ubmVjdGlvbi5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBPcGVyYXRpb24gaW5wdXQuXG4gICAqIEBwYXJhbSB7bnVtYmVyfSBhcmdzLmNyZWF0ZWRBdE1zIC0gQ3JlYXRpb24gdGltZXN0YW1wLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gYXJncy5qb2JJZCAtIE5hdGl2ZSBqb2IgaWQuXG4gICAqIEBwYXJhbSB7e29wZXJhdGlvbjogaW1wb3J0KFwiLi4vbWFpbGVyL2luZGV4LmpzXCIpLk1haWxlckRlbGl2ZXJ5T3BlcmF0aW9uLCBwYXlsb2FkOiBpbXBvcnQoXCIuLi9tYWlsZXIvaW5kZXguanNcIikuTWFpbGVyRGVsaXZlcnlQYXlsb2FkfSB8IG51bGx9IGFyZ3MubWFpbE9wZXJhdGlvbklucHV0IC0gTWFpbCBvcGVyYXRpb24uXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIGFmdGVyIHBlcnNpc3RlbmNlLlxuICAgKi9cbiAgYXN5bmMgX3BlcnNpc3RNYWlsRGVsaXZlcnlPcGVyYXRpb24oZGIsIHtjcmVhdGVkQXRNcywgam9iSWQsIG1haWxPcGVyYXRpb25JbnB1dH0pIHtcbiAgICBpZiAoIW1haWxPcGVyYXRpb25JbnB1dCkgcmV0dXJuXG4gICAgY29uc3Qge29wZXJhdGlvbn0gPSBtYWlsT3BlcmF0aW9uSW5wdXRcbiAgICBjb25zdCBvcGVyYXRpb25LZXkgPSBtYWlsRGVsaXZlcnlPcGVyYXRpb25LZXkob3BlcmF0aW9uLmlkKVxuICAgIGNvbnN0IHJvdyA9IHtcbiAgICAgIGJhY2tncm91bmRfam9iX2lkOiBqb2JJZCxcbiAgICAgIGNyZWF0ZWRfYXRfbXM6IGNyZWF0ZWRBdE1zLFxuICAgICAgZmlyc3RfYXR0ZW1wdF9zdGFydGVkX2F0X21zOiBudWxsLFxuICAgICAgb3BlcmF0aW9uX2lkOiBvcGVyYXRpb24uaWQsXG4gICAgICBvcGVyYXRpb25fa2V5OiBvcGVyYXRpb25LZXksXG4gICAgICBwYXlsb2FkX2RpZ2VzdDogb3BlcmF0aW9uLnBheWxvYWREaWdlc3QsXG4gICAgICBwcm92aWRlcl9raW5kOiBvcGVyYXRpb24ucHJvdmlkZXJLaW5kLFxuICAgICAgcHJvdmlkZXJfcmV0ZW50aW9uX21zOiBvcGVyYXRpb24ucHJvdmlkZXJSZXRlbnRpb25Nc1xuICAgIH1cblxuICAgIHRyeSB7XG4gICAgICBhd2FpdCBkYi50cmFuc2FjdGlvbihhc3luYyAoKSA9PiB7XG4gICAgICAgIGF3YWl0IGRiLmluc2VydCh7dGFibGVOYW1lOiBNQUlMX0RFTElWRVJZX09QRVJBVElPTlNfVEFCTEUsIGRhdGE6IHJvd30pXG4gICAgICB9KVxuICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICBjb25zdCBleGlzdGluZyA9IGF3YWl0IHRoaXMuX21haWxEZWxpdmVyeU9wZXJhdGlvbihkYiwgb3BlcmF0aW9uS2V5KVxuXG4gICAgICBpZiAoIWV4aXN0aW5nKSB0aHJvdyBlcnJvclxuICAgICAgdGhpcy5fdmFsaWRhdGVNYWlsRGVsaXZlcnlPcGVyYXRpb25Sb3coe2V4aXN0aW5nLCByZXF1ZXN0ZWQ6IHJvd30pXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIFZhbGlkYXRlcyB0aGUgZHVyYWJsZSBtYWlsIHJvdyBkdXJpbmcgYW4gZXhhY3QgZ2VuZXJpYyBlbnF1ZXVlIHJlcGxheS5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9kYXRhYmFzZS9kcml2ZXJzL2Jhc2UuanNcIikuZGVmYXVsdH0gZGIgLSBEYXRhYmFzZSBjb25uZWN0aW9uLlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIFZhbGlkYXRpb24gaW5wdXQuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBhcmdzLmpvYklkIC0gT3duZWQgam9iIGlkLlxuICAgKiBAcGFyYW0ge3tvcGVyYXRpb246IGltcG9ydChcIi4uL21haWxlci9pbmRleC5qc1wiKS5NYWlsZXJEZWxpdmVyeU9wZXJhdGlvbiwgcGF5bG9hZDogaW1wb3J0KFwiLi4vbWFpbGVyL2luZGV4LmpzXCIpLk1haWxlckRlbGl2ZXJ5UGF5bG9hZH0gfCBudWxsfSBhcmdzLm1haWxPcGVyYXRpb25JbnB1dCAtIE1haWwgb3BlcmF0aW9uLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyB3aGVuIGV4YWN0LlxuICAgKi9cbiAgYXN5bmMgX3ZhbGlkYXRlTWFpbERlbGl2ZXJ5T3BlcmF0aW9uKGRiLCB7am9iSWQsIG1haWxPcGVyYXRpb25JbnB1dH0pIHtcbiAgICBpZiAoIW1haWxPcGVyYXRpb25JbnB1dCkgcmV0dXJuXG4gICAgY29uc3Qge29wZXJhdGlvbn0gPSBtYWlsT3BlcmF0aW9uSW5wdXRcbiAgICBjb25zdCBleGlzdGluZyA9IGF3YWl0IHRoaXMuX21haWxEZWxpdmVyeU9wZXJhdGlvbihkYiwgbWFpbERlbGl2ZXJ5T3BlcmF0aW9uS2V5KG9wZXJhdGlvbi5pZCkpXG5cbiAgICBpZiAoIWV4aXN0aW5nKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoXCJCYWNrZ3JvdW5kIGpvYiBpZGVtcG90ZW5jeSBvd25lcnNoaXAgaXMgbWlzc2luZyBpdHMgZHVyYWJsZSBtYWlsIGRlbGl2ZXJ5IG9wZXJhdGlvblwiKVxuICAgIH1cblxuICAgIHRoaXMuX3ZhbGlkYXRlTWFpbERlbGl2ZXJ5T3BlcmF0aW9uUm93KHtcbiAgICAgIGV4aXN0aW5nLFxuICAgICAgcmVxdWVzdGVkOiB7XG4gICAgICAgIGJhY2tncm91bmRfam9iX2lkOiBqb2JJZCxcbiAgICAgICAgb3BlcmF0aW9uX2lkOiBvcGVyYXRpb24uaWQsXG4gICAgICAgIHBheWxvYWRfZGlnZXN0OiBvcGVyYXRpb24ucGF5bG9hZERpZ2VzdCxcbiAgICAgICAgcHJvdmlkZXJfa2luZDogb3BlcmF0aW9uLnByb3ZpZGVyS2luZCxcbiAgICAgICAgcHJvdmlkZXJfcmV0ZW50aW9uX21zOiBvcGVyYXRpb24ucHJvdmlkZXJSZXRlbnRpb25Nc1xuICAgICAgfVxuICAgIH0pXG4gIH1cblxuICAvKipcbiAgICogTG9hZHMgYSBkdXJhYmxlIG1haWwgb3BlcmF0aW9uLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL2RhdGFiYXNlL2RyaXZlcnMvYmFzZS5qc1wiKS5kZWZhdWx0fSBkYiAtIERhdGFiYXNlIGNvbm5lY3Rpb24uXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBvcGVyYXRpb25LZXkgLSBGaXhlZC1zaXplIG9wZXJhdGlvbiBrZXkuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPFJlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+PiB8IG51bGw+fSAtIFJvdyBvciBudWxsLlxuICAgKi9cbiAgYXN5bmMgX21haWxEZWxpdmVyeU9wZXJhdGlvbihkYiwgb3BlcmF0aW9uS2V5KSB7XG4gICAgY29uc3Qgcm93cyA9IGF3YWl0IGRiLm5ld1F1ZXJ5KCkuZnJvbShNQUlMX0RFTElWRVJZX09QRVJBVElPTlNfVEFCTEUpLndoZXJlKHtvcGVyYXRpb25fa2V5OiBvcGVyYXRpb25LZXl9KS5saW1pdCgxKS5yZXN1bHRzKClcblxuICAgIHJldHVybiByb3dzWzBdID8gLyoqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59ICovIChyb3dzWzBdKSA6IG51bGxcbiAgfVxuXG4gIC8qKlxuICAgKiBDb21wYXJlcyBwcm92aWRlci1yZWxldmFudCBkdXJhYmxlIG1haWwgb3BlcmF0aW9uIGZpZWxkcy5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBWYWxpZGF0aW9uIGlucHV0LlxuICAgKiBAcGFyYW0ge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gYXJncy5leGlzdGluZyAtIFN0b3JlZCByb3cuXG4gICAqIEBwYXJhbSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSBhcmdzLnJlcXVlc3RlZCAtIFJlcXVlc3RlZCByb3cuXG4gICAqIEByZXR1cm5zIHt2b2lkfVxuICAgKi9cbiAgX3ZhbGlkYXRlTWFpbERlbGl2ZXJ5T3BlcmF0aW9uUm93KHtleGlzdGluZywgcmVxdWVzdGVkfSkge1xuICAgIGNvbnN0IG1hdGNoZXMgPSBTdHJpbmcoZXhpc3Rpbmcub3BlcmF0aW9uX2lkKSA9PT0gcmVxdWVzdGVkLm9wZXJhdGlvbl9pZFxuICAgICAgJiYgU3RyaW5nKGV4aXN0aW5nLnBheWxvYWRfZGlnZXN0KSA9PT0gcmVxdWVzdGVkLnBheWxvYWRfZGlnZXN0XG4gICAgICAmJiBTdHJpbmcoZXhpc3RpbmcuYmFja2dyb3VuZF9qb2JfaWQpID09PSByZXF1ZXN0ZWQuYmFja2dyb3VuZF9qb2JfaWRcbiAgICAgICYmIFN0cmluZyhleGlzdGluZy5wcm92aWRlcl9raW5kKSA9PT0gcmVxdWVzdGVkLnByb3ZpZGVyX2tpbmRcbiAgICAgICYmIHRoaXMuX25vcm1hbGl6ZU51bWJlcihleGlzdGluZy5wcm92aWRlcl9yZXRlbnRpb25fbXMpID09PSByZXF1ZXN0ZWQucHJvdmlkZXJfcmV0ZW50aW9uX21zXG5cbiAgICBpZiAoIW1hdGNoZXMpIHtcbiAgICAgIHRocm93IFZlbG9jaW91c0Vycm9yLnNhZmUoXCJUaGUgbWFpbCBkZWxpdmVyeSBvcGVyYXRpb24gd2FzIGFscmVhZHkgdXNlZCBmb3IgYSBkaWZmZXJlbnQgcGF5bG9hZCBvciBwcm92aWRlci5cIiwge1xuICAgICAgICBjb2RlOiBcIm1haWwtZGVsaXZlcnktaWRlbXBvdGVuY3ktY29uZmxpY3RcIlxuICAgICAgfSlcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogQ2Fub25pY2FsIHJlcXVlc3QgZGlnZXN0IGV4Y2x1ZGluZyBnZW5lcmF0ZWQgaWRzIGFuZCBpbW1lZGlhdGUgZW5xdWV1ZSB0aW1lLlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIERpZ2VzdCBpbnB1dC5cbiAgICogQHBhcmFtIHtBcnJheTxSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59IGFyZ3MuYXJncyAtIEpvYiBhcmd1bWVudHMuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi90eXBlcy5qc1wiKS5CYWNrZ3JvdW5kSm9iT3B0aW9uc30gYXJncy5vcHRpb25zIC0gSm9iIG9wdGlvbnMuXG4gICAqIEBwYXJhbSB7UHJlcGFyZWRCYWNrZ3JvdW5kSm9ifSBhcmdzLnByZXBhcmVkSm9iIC0gTm9ybWFsaXplZCBqb2IuXG4gICAqIEByZXR1cm5zIHtzdHJpbmd9IC0gU0hBLTI1NiBkaWdlc3QuXG4gICAqL1xuICBfaWRlbXBvdGVuY3lSZXF1ZXN0RGlnZXN0KHthcmdzLCBvcHRpb25zLCBwcmVwYXJlZEpvYn0pIHtcbiAgICBjb25zdCBzZXJpYWxpemVkID0gc3RhYmxlSnNvblN0cmluZ2lmeSh7XG4gICAgICBhcmdzLFxuICAgICAgY29uY3VycmVuY3k6IHByZXBhcmVkSm9iLmNvbmN1cnJlbmN5LFxuICAgICAgZXhlY3V0aW9uTW9kZTogcHJlcGFyZWRKb2IuZXhlY3V0aW9uTW9kZSxcbiAgICAgIGZvcm1hdDogXCJ2ZWxvY2lvdXMtYmFja2dyb3VuZC1qb2ItaWRlbXBvdGVuY3ktdjFcIixcbiAgICAgIGpvYk5hbWU6IHByZXBhcmVkSm9iLmpvYk5hbWUsXG4gICAgICBtYXhSZXRyaWVzOiBwcmVwYXJlZEpvYi5tYXhSZXRyaWVzLFxuICAgICAgcXVldWU6IHByZXBhcmVkSm9iLnF1ZXVlLFxuICAgICAgc2NoZWR1bGVkQXRNczogb3B0aW9ucy5zY2hlZHVsZWRBdE1zID09PSB1bmRlZmluZWQgPyBudWxsIDogcHJlcGFyZWRKb2Iuc2NoZWR1bGVkQXRNcyxcbiAgICAgIHNjaGVkdWxpbmc6IG9wdGlvbnMuc2NoZWR1bGVkQXRNcyA9PT0gdW5kZWZpbmVkID8gXCJpbW1lZGlhdGVcIiA6IFwic2NoZWR1bGVkXCIsXG4gICAgICAuLi4ocHJlcGFyZWRKb2IudGltZW91dE1zID09PSBudWxsID8ge30gOiB7dGltZW91dE1zOiBwcmVwYXJlZEpvYi50aW1lb3V0TXN9KVxuICAgIH0pXG5cbiAgICByZXR1cm4gY3JlYXRlSGFzaChcInNoYTI1NlwiKS51cGRhdGUoc2VyaWFsaXplZCkuZGlnZXN0KFwiaGV4XCIpXG4gIH1cblxuICAvKipcbiAgICogRml4ZWQtc2l6ZSBnbG9iYWxseSBpbmRleGVkIHJlcHJlc2VudGF0aW9uIG9mIHRoZSBkb2N1bWVudGVkIHNjb3BlIHR1cGxlLlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIFNjb3BlIGlucHV0LlxuICAgKiBAcGFyYW0ge3N0cmluZ30gYXJncy5pZGVtcG90ZW5jeUtleSAtIENhbGxlciBrZXkuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBhcmdzLmpvYk5hbWUgLSBKb2IgY2xhc3MgbmFtZS5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGFyZ3MucXVldWUgLSBRdWV1ZSBuYW1lLlxuICAgKiBAcmV0dXJucyB7c3RyaW5nfSAtIFNIQS0yNTYgc2NvcGUgZGlnZXN0LlxuICAgKi9cbiAgX2lkZW1wb3RlbmN5U2NvcGVEaWdlc3Qoe2lkZW1wb3RlbmN5S2V5LCBqb2JOYW1lLCBxdWV1ZX0pIHtcbiAgICByZXR1cm4gY3JlYXRlSGFzaChcInNoYTI1NlwiKVxuICAgICAgLnVwZGF0ZShzdGFibGVKc29uU3RyaW5naWZ5KHtmb3JtYXQ6IFwidmVsb2Npb3VzLWJhY2tncm91bmQtam9iLWlkZW1wb3RlbmN5LXNjb3BlLXYxXCIsIGlkZW1wb3RlbmN5S2V5LCBqb2JOYW1lLCBxdWV1ZX0pKVxuICAgICAgLmRpZ2VzdChcImhleFwiKVxuICB9XG5cbiAgLyoqXG4gICAqIFZhbGlkYXRlcyBvbmUgY2FsbGVyIGtleS5cbiAgICogQHBhcmFtIHtzdHJpbmcgfCB1bmRlZmluZWR9IGlkZW1wb3RlbmN5S2V5IC0gQ2FsbGVyIGtleS5cbiAgICogQHJldHVybnMge3N0cmluZ30gLSBWYWxpZCBrZXkuXG4gICAqL1xuICBfbm9ybWFsaXplSWRlbXBvdGVuY3lLZXkoaWRlbXBvdGVuY3lLZXkpIHtcbiAgICBpZiAodHlwZW9mIGlkZW1wb3RlbmN5S2V5ICE9PSBcInN0cmluZ1wiIHx8IGlkZW1wb3RlbmN5S2V5Lmxlbmd0aCA9PT0gMCkge1xuICAgICAgdGhyb3cgVmVsb2Npb3VzRXJyb3Iuc2FmZShcIkJhY2tncm91bmQgam9iIGlkZW1wb3RlbmN5S2V5IG11c3QgYmUgYSBub24tZW1wdHkgc3RyaW5nLlwiLCB7XG4gICAgICAgIGNvZGU6IFwiYmFja2dyb3VuZC1qb2ItaWRlbXBvdGVuY3kta2V5LWludmFsaWRcIlxuICAgICAgfSlcbiAgICB9XG5cbiAgICByZXR1cm4gaWRlbXBvdGVuY3lLZXlcbiAgfVxuXG4gIC8qKlxuICAgKiBDYW5vbmljYWwgcmVxdWVzdCBpZGVudGl0eSBmb3IgYW4gaW50ZXJuYWwgb3duZWQtaGFuZG9mZiByZXBsYXkuXG4gICAqIEltbWVkaWF0ZSBlbnF1ZXVlIHdhbGwgdGltZSBhbmQgZ2VuZXJhdGVkIGpvYiBpZHMgcmVtYWluIGV4Y2x1ZGVkLlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIERpZ2VzdCBpbnB1dC5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL3R5cGVzLmpzXCIpLkJhY2tncm91bmRKb2JPcHRpb25zfSBhcmdzLm9wdGlvbnMgLSBFbnF1ZXVlIG9wdGlvbnMuXG4gICAqIEBwYXJhbSB7UHJlcGFyZWRCYWNrZ3JvdW5kSm9ifSBhcmdzLnByZXBhcmVkSm9iIC0gTm9ybWFsaXplZCBqb2IuXG4gICAqIEByZXR1cm5zIHtzdHJpbmd9IC0gU0hBLTI1NiBkaWdlc3QuXG4gICAqL1xuICBfb3duZWRFbnF1ZXVlUmVxdWVzdERpZ2VzdCh7b3B0aW9ucywgcHJlcGFyZWRKb2J9KSB7XG4gICAgY29uc3Qgc2VyaWFsaXplZCA9IHN0YWJsZUpzb25TdHJpbmdpZnkoe1xuICAgICAgYXJnc0pzb246IHByZXBhcmVkSm9iLmFyZ3NKc29uLFxuICAgICAgY29uY3VycmVuY3k6IHByZXBhcmVkSm9iLmNvbmN1cnJlbmN5LFxuICAgICAgZGVkdXBsaWNhdGVXaGlsZVF1ZXVlZDogb3B0aW9ucy5kZWR1cGxpY2F0ZVdoaWxlUXVldWVkID09PSB0cnVlLFxuICAgICAgZXhlY3V0aW9uTW9kZTogcHJlcGFyZWRKb2IuZXhlY3V0aW9uTW9kZSxcbiAgICAgIGZvcm1hdDogXCJ2ZWxvY2lvdXMtYmFja2dyb3VuZC1qb2Itb3duZWQtZW5xdWV1ZS12MVwiLFxuICAgICAgam9iTmFtZTogcHJlcGFyZWRKb2Iuam9iTmFtZSxcbiAgICAgIG1heFJldHJpZXM6IHByZXBhcmVkSm9iLm1heFJldHJpZXMsXG4gICAgICBxdWV1ZTogcHJlcGFyZWRKb2IucXVldWUsXG4gICAgICBzY2hlZHVsZWRBdE1zOiBvcHRpb25zLnNjaGVkdWxlZEF0TXMgPT09IHVuZGVmaW5lZCA/IG51bGwgOiBwcmVwYXJlZEpvYi5zY2hlZHVsZWRBdE1zLFxuICAgICAgc2NoZWR1bGluZzogb3B0aW9ucy5zY2hlZHVsZWRBdE1zID09PSB1bmRlZmluZWQgPyBcImltbWVkaWF0ZVwiIDogXCJzY2hlZHVsZWRcIixcbiAgICAgIC4uLihwcmVwYXJlZEpvYi50aW1lb3V0TXMgPT09IG51bGwgPyB7fSA6IHt0aW1lb3V0TXM6IHByZXBhcmVkSm9iLnRpbWVvdXRNc30pXG4gICAgfSlcblxuICAgIHJldHVybiBjcmVhdGVIYXNoKFwic2hhMjU2XCIpLnVwZGF0ZShzZXJpYWxpemVkKS5kaWdlc3QoXCJoZXhcIilcbiAgfVxuXG4gIC8qKlxuICAgKiBJc29sYXRlcyBpbnRlcm5hbCBwcm9kdWNlciByZXBsYXkgb3duZXJzaGlwIGZyb20gY2FsbGVyIGlkZW1wb3RlbmN5IHNjb3Blcy5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBTY29wZSBpbnB1dC5cbiAgICogQHBhcmFtIHtQcmVwYXJlZEJhY2tncm91bmRKb2J9IGFyZ3MucHJlcGFyZWRKb2IgLSBOb3JtYWxpemVkIGpvYi5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGFyZ3MucHJvZHVjZXJJbnZvY2F0aW9uSWQgLSBTdGFibGUgaWRlbnRpdHkgZm9yIG9uZSBvd25lZCBlbnF1ZXVlIGludm9jYXRpb24uXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi90eXBlcy5qc1wiKS5CYWNrZ3JvdW5kSm9iUHJvZHVjZXJQcm9vZn0gYXJncy5wcm9kdWNlclByb29mIC0gRXhhY3QgcHJvZHVjZXIgbGVhc2UuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBhcmdzLnJlcXVlc3REaWdlc3QgLSBDYW5vbmljYWwgcmVxdWVzdCBkaWdlc3QuXG4gICAqIEByZXR1cm5zIHtzdHJpbmd9IC0gU0hBLTI1NiBzY29wZSBkaWdlc3QuXG4gICAqL1xuICBfb3duZWRFbnF1ZXVlU2NvcGVEaWdlc3Qoe3ByZXBhcmVkSm9iLCBwcm9kdWNlckludm9jYXRpb25JZCwgcHJvZHVjZXJQcm9vZiwgcmVxdWVzdERpZ2VzdH0pIHtcbiAgICByZXR1cm4gY3JlYXRlSGFzaChcInNoYTI1NlwiKVxuICAgICAgLnVwZGF0ZShzdGFibGVKc29uU3RyaW5naWZ5KHtcbiAgICAgICAgZm9ybWF0OiBcInZlbG9jaW91cy1iYWNrZ3JvdW5kLWpvYi1vd25lZC1lbnF1ZXVlLXNjb3BlLXYxXCIsXG4gICAgICAgIGpvYk5hbWU6IHByZXBhcmVkSm9iLmpvYk5hbWUsXG4gICAgICAgIHByb2R1Y2VySW52b2NhdGlvbklkLFxuICAgICAgICBwcm9kdWNlclByb29mLFxuICAgICAgICBxdWV1ZTogcHJlcGFyZWRKb2IucXVldWUsXG4gICAgICAgIHJlcXVlc3REaWdlc3RcbiAgICAgIH0pKVxuICAgICAgLmRpZ2VzdChcImhleFwiKVxuICB9XG5cbiAgLyoqXG4gICAqIFZhbGlkYXRlcyB0aGUgdW50cnVzdGVkIGlkZW50aXR5IG9mIG9uZSBwcm9kdWNlci1vd25lZCBlbnF1ZXVlIGludm9jYXRpb24uXG4gICAqIEBwYXJhbSB7c3RyaW5nIHwgdW5kZWZpbmVkfSBwcm9kdWNlckludm9jYXRpb25JZCAtIFByb2R1Y2VyIGludm9jYXRpb24gaWRlbnRpdHkuXG4gICAqIEByZXR1cm5zIHtzdHJpbmd9IC0gVmFsaWRhdGVkIGlkZW50aXR5LlxuICAgKi9cbiAgX25vcm1hbGl6ZVByb2R1Y2VySW52b2NhdGlvbklkKHByb2R1Y2VySW52b2NhdGlvbklkKSB7XG4gICAgaWYgKHR5cGVvZiBwcm9kdWNlckludm9jYXRpb25JZCAhPT0gXCJzdHJpbmdcIiB8fCBwcm9kdWNlckludm9jYXRpb25JZC5sZW5ndGggPT09IDApIHtcbiAgICAgIHRocm93IFZlbG9jaW91c0Vycm9yLnNhZmUoXCJCYWNrZ3JvdW5kIGpvYiBwcm9kdWNlciBpbnZvY2F0aW9uIGlkIGlzIGludmFsaWQuXCIsIHtcbiAgICAgICAgY29kZTogXCJiYWNrZ3JvdW5kLWpvYi1wcm9kdWNlci1pbnZvY2F0aW9uLWlkLWludmFsaWRcIlxuICAgICAgfSlcbiAgICB9XG5cbiAgICByZXR1cm4gcHJvZHVjZXJJbnZvY2F0aW9uSWRcbiAgfVxuXG4gIC8qKlxuICAgKiBWYWxpZGF0ZXMgdGhlIHVudHJ1c3RlZCB0cmFuc3BvcnQgc2hhcGUgYmVmb3JlIHRyYW5zYWN0aW9uIGFkbWlzc2lvbi5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL3R5cGVzLmpzXCIpLkJhY2tncm91bmRKb2JQcm9kdWNlclByb29mfSBwcm9kdWNlclByb29mIC0gUHJvZHVjZXIgcHJvb2YuXG4gICAqIEByZXR1cm5zIHtpbXBvcnQoXCIuL3R5cGVzLmpzXCIpLkJhY2tncm91bmRKb2JQcm9kdWNlclByb29mfSAtIE5vcm1hbGl6ZWQgaW1tdXRhYmxlIHByb29mLlxuICAgKi9cbiAgX25vcm1hbGl6ZVByb2R1Y2VyUHJvb2YocHJvZHVjZXJQcm9vZikge1xuICAgIGNvbnN0IGV4YWN0S2V5cyA9IFtcImhhbmRlZE9mZkF0TXNcIiwgXCJoYW5kb2ZmSWRcIiwgXCJqb2JJZFwiLCBcIndvcmtlcklkXCJdXG4gICAgY29uc3Qga2V5cyA9IHByb2R1Y2VyUHJvb2YgJiYgdHlwZW9mIHByb2R1Y2VyUHJvb2YgPT09IFwib2JqZWN0XCIgPyBPYmplY3Qua2V5cyhwcm9kdWNlclByb29mKSA6IFtdXG4gICAgY29uc3QgdmFsaWQgPSBwcm9kdWNlclByb29mXG4gICAgICAmJiB0eXBlb2YgcHJvZHVjZXJQcm9vZiA9PT0gXCJvYmplY3RcIlxuICAgICAgJiYga2V5cy5sZW5ndGggPT09IGV4YWN0S2V5cy5sZW5ndGhcbiAgICAgICYmIGtleXMuZXZlcnkoKGtleSkgPT4gZXhhY3RLZXlzLmluY2x1ZGVzKGtleSkpXG4gICAgICAmJiB0eXBlb2YgcHJvZHVjZXJQcm9vZi5qb2JJZCA9PT0gXCJzdHJpbmdcIlxuICAgICAgJiYgcHJvZHVjZXJQcm9vZi5qb2JJZC5sZW5ndGggPiAwXG4gICAgICAmJiB0eXBlb2YgcHJvZHVjZXJQcm9vZi5oYW5kb2ZmSWQgPT09IFwic3RyaW5nXCJcbiAgICAgICYmIHByb2R1Y2VyUHJvb2YuaGFuZG9mZklkLmxlbmd0aCA+IDBcbiAgICAgICYmIHR5cGVvZiBwcm9kdWNlclByb29mLndvcmtlcklkID09PSBcInN0cmluZ1wiXG4gICAgICAmJiBwcm9kdWNlclByb29mLndvcmtlcklkLmxlbmd0aCA+IDBcbiAgICAgICYmIE51bWJlci5pc1NhZmVJbnRlZ2VyKHByb2R1Y2VyUHJvb2YuaGFuZGVkT2ZmQXRNcylcbiAgICAgICYmIHByb2R1Y2VyUHJvb2YuaGFuZGVkT2ZmQXRNcyA+PSAwXG5cbiAgICBpZiAoIXZhbGlkKSB7XG4gICAgICB0aHJvdyBWZWxvY2lvdXNFcnJvci5zYWZlKFwiQmFja2dyb3VuZCBqb2IgcHJvZHVjZXIgcHJvb2YgaXMgaW52YWxpZC5cIiwge1xuICAgICAgICBjb2RlOiBcImJhY2tncm91bmQtam9iLXByb2R1Y2VyLXByb29mLWludmFsaWRcIlxuICAgICAgfSlcbiAgICB9XG5cbiAgICByZXR1cm4gT2JqZWN0LmZyZWV6ZSh7XG4gICAgICBoYW5kZWRPZmZBdE1zOiBwcm9kdWNlclByb29mLmhhbmRlZE9mZkF0TXMsXG4gICAgICBoYW5kb2ZmSWQ6IHByb2R1Y2VyUHJvb2YuaGFuZG9mZklkLFxuICAgICAgam9iSWQ6IHByb2R1Y2VyUHJvb2Yuam9iSWQsXG4gICAgICB3b3JrZXJJZDogcHJvZHVjZXJQcm9vZi53b3JrZXJJZFxuICAgIH0pXG4gIH1cblxuICAvKipcbiAgICogQ29uZmlybXMgZXhhY3QgYWN0aXZlIG93bmVyc2hpcCB3aGlsZSB0aGUgZW5xdWV1ZSB0cmFuc2FjdGlvbiBob2xkcyB0aGVcbiAgICogc2hhcmVkIG11dGF0aW9uIGZlbmNlIHVzZWQgYnkgdGVybWluYWwgcHJvZHVjZXIgdHJhbnNpdGlvbnMuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vZGF0YWJhc2UvZHJpdmVycy9iYXNlLmpzXCIpLmRlZmF1bHR9IGRiIC0gVHJhbnNhY3Rpb24gY29ubmVjdGlvbi5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL3R5cGVzLmpzXCIpLkJhY2tncm91bmRKb2JQcm9kdWNlclByb29mfSBwcm9kdWNlclByb29mIC0gRXhhY3QgcHJvZHVjZXIgbGVhc2UuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIHdoaWxlIG93bmVyc2hpcCByZW1haW5zIGV4YWN0LlxuICAgKi9cbiAgYXN5bmMgX3ZhbGlkYXRlT3duZWRQcm9kdWNlclByb29mKGRiLCBwcm9kdWNlclByb29mKSB7XG4gICAgY29uc3QgcHJvZHVjZXIgPSBhd2FpdCB0aGlzLl9nZXRKb2JSb3dCeUlkKGRiLCBwcm9kdWNlclByb29mLmpvYklkKVxuICAgIGNvbnN0IG93bmVkID0gcHJvZHVjZXJcbiAgICAgICYmIHByb2R1Y2VyLnN0YXR1cyA9PT0gXCJoYW5kZWRfb2ZmXCJcbiAgICAgICYmIHByb2R1Y2VyLmhhbmRvZmZJZCA9PT0gcHJvZHVjZXJQcm9vZi5oYW5kb2ZmSWRcbiAgICAgICYmIHByb2R1Y2VyLndvcmtlcklkID09PSBwcm9kdWNlclByb29mLndvcmtlcklkXG4gICAgICAmJiBwcm9kdWNlci5oYW5kZWRPZmZBdE1zID09PSBwcm9kdWNlclByb29mLmhhbmRlZE9mZkF0TXNcblxuICAgIGlmICghb3duZWQpIHtcbiAgICAgIHRocm93IFZlbG9jaW91c0Vycm9yLnNhZmUoXCJCYWNrZ3JvdW5kIGpvYiBwcm9kdWNlciBoYW5kb2ZmIGlzIG5vIGxvbmdlciBvd25lZC5cIiwge1xuICAgICAgICBjb2RlOiBcImJhY2tncm91bmQtam9iLXByb2R1Y2VyLWhhbmRvZmYtbm90LW93bmVkXCJcbiAgICAgIH0pXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIFJlcGxhY2VzIHRoZSBxdWV1ZWQgb3duZXIgb2YgYSBzdGFibGUgc2NoZWR1bGUga2V5IHdpdGggYSBuZXcgb25lLW9mZiBqb2IuXG4gICAqIEEgaGFuZGVkLW9mZiBvd25lciBpcyBsZWZ0IHJ1bm5pbmcgYW5kIHJlcG9ydGVkIHRydXRoZnVsbHkuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gT3B0aW9ucy5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGFyZ3Muc2NoZWR1bGVLZXkgLSBTdGFibGUgbG9naWNhbCBzY2hlZHVsZSBrZXkuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBhcmdzLmpvYk5hbWUgLSBKb2IgbmFtZS5cbiAgICogQHBhcmFtIHtBcnJheTxSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59IGFyZ3MuYXJncyAtIEFyZ3VtZW50cy5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL3R5cGVzLmpzXCIpLkJhY2tncm91bmRKb2JPcHRpb25zfSBbYXJncy5vcHRpb25zXSAtIE9wdGlvbnMuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPGltcG9ydChcIi4vdHlwZXMuanNcIikuQmFja2dyb3VuZEpvYlJlcGxhY2VtZW50UmVzdWx0Pn0gLSBSZXBsYWNlbWVudCByZXN1bHQuXG4gICAqL1xuICBhc3luYyByZXBsYWNlU2NoZWR1bGVkKHtzY2hlZHVsZUtleSwgam9iTmFtZSwgYXJncywgb3B0aW9uc30pIHtcbiAgICBhd2FpdCB0aGlzLmVuc3VyZVJlYWR5KClcblxuICAgIGNvbnN0IG5vcm1hbGl6ZWRTY2hlZHVsZUtleSA9IHRoaXMuX25vcm1hbGl6ZVNjaGVkdWxlS2V5KHNjaGVkdWxlS2V5KVxuICAgIGNvbnN0IHByZXBhcmVkSm9iID0gdGhpcy5fcHJlcGFyZUpvYih7am9iTmFtZSwgYXJncywgb3B0aW9uc30pXG5cbiAgICByZXR1cm4gYXdhaXQgdGhpcy5fc2VyaWFsaXplZENvdW50TXV0YXRpb24oYXN5bmMgKGRiKSA9PiB7XG4gICAgICBjb25zdCBvd25lclJvd3MgPSBhd2FpdCBkYlxuICAgICAgICAubmV3UXVlcnkoKVxuICAgICAgICAuZnJvbShTQ0hFRFVMRV9LRVlTX1RBQkxFKVxuICAgICAgICAud2hlcmUoe3NjaGVkdWxlX2tleTogbm9ybWFsaXplZFNjaGVkdWxlS2V5fSlcbiAgICAgICAgLmxpbWl0KDEpXG4gICAgICAgIC5yZXN1bHRzKClcbiAgICAgIGNvbnN0IG93bmVySm9iSWQgPSBvd25lclJvd3NbMF0gPyBTdHJpbmcoLyoqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59ICovIChvd25lclJvd3NbMF0pLmpvYl9pZCkgOiBudWxsXG4gICAgICBjb25zdCBvd25lckpvYiA9IG93bmVySm9iSWQgPyBhd2FpdCB0aGlzLl9nZXRKb2JSb3dCeUlkKGRiLCBvd25lckpvYklkKSA6IG51bGxcbiAgICAgIC8qKiBAdHlwZSB7aW1wb3J0KFwiLi90eXBlcy5qc1wiKS5CYWNrZ3JvdW5kSm9iUmVwbGFjZW1lbnRQcmV2aW91c1N0YXR1c30gKi9cbiAgICAgIGxldCBwcmV2aW91c1N0YXR1cyA9IG51bGxcbiAgICAgIGxldCBwcmV2aW91c0pvYklkID0gbnVsbFxuXG4gICAgICBpZiAob3duZXJKb2I/LnN0YXR1cyA9PT0gXCJxdWV1ZWRcIikge1xuICAgICAgICBjb25zdCBhZmZlY3RlZFJvd3MgPSBhd2FpdCB0aGlzLl91cGRhdGVBZmZlY3RlZFJvd3MoZGIsIHtcbiAgICAgICAgICB0YWJsZU5hbWU6IEpPQlNfVEFCTEUsXG4gICAgICAgICAgZGF0YToge3N0YXR1czogXCJjYW5jZWxsZWRcIn0sXG4gICAgICAgICAgY29uZGl0aW9uczoge2lkOiBvd25lckpvYi5pZCwgc3RhdHVzOiBcInF1ZXVlZFwifVxuICAgICAgICB9KVxuXG4gICAgICAgIGlmIChhZmZlY3RlZFJvd3MgPT09IDEpIHtcbiAgICAgICAgICBwcmV2aW91c0pvYklkID0gb3duZXJKb2IuaWRcbiAgICAgICAgICBwcmV2aW91c1N0YXR1cyA9IFwicXVldWVkXCJcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICBjb25zdCBjdXJyZW50T3duZXJKb2IgPSBhd2FpdCB0aGlzLl9nZXRKb2JSb3dCeUlkKGRiLCBvd25lckpvYi5pZClcblxuICAgICAgICAgIGlmIChjdXJyZW50T3duZXJKb2I/LnN0YXR1cyA9PT0gXCJoYW5kZWRfb2ZmXCIpIHtcbiAgICAgICAgICAgIHByZXZpb3VzSm9iSWQgPSBjdXJyZW50T3duZXJKb2IuaWRcbiAgICAgICAgICAgIHByZXZpb3VzU3RhdHVzID0gXCJoYW5kZWRfb2ZmXCJcbiAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICAgIH0gZWxzZSBpZiAob3duZXJKb2I/LnN0YXR1cyA9PT0gXCJoYW5kZWRfb2ZmXCIpIHtcbiAgICAgICAgcHJldmlvdXNKb2JJZCA9IG93bmVySm9iLmlkXG4gICAgICAgIHByZXZpb3VzU3RhdHVzID0gXCJoYW5kZWRfb2ZmXCJcbiAgICAgIH1cblxuICAgICAgY29uc3Qgc2NoZWR1bGVPcmRlciA9IGF3YWl0IHRoaXMuX25leHRTY2hlZHVsZU9yZGVyKGRiLCBub3JtYWxpemVkU2NoZWR1bGVLZXkpXG5cbiAgICAgIGF3YWl0IHRoaXMuX2luc2VydFByZXBhcmVkSm9iKGRiLCB7cHJlcGFyZWRKb2IsIHNjaGVkdWxlS2V5OiBub3JtYWxpemVkU2NoZWR1bGVLZXksIHNjaGVkdWxlT3JkZXJ9KVxuICAgICAgYXdhaXQgZGIudXBzZXJ0KHtcbiAgICAgICAgdGFibGVOYW1lOiBTQ0hFRFVMRV9LRVlTX1RBQkxFLFxuICAgICAgICBkYXRhOiB7c2NoZWR1bGVfa2V5OiBub3JtYWxpemVkU2NoZWR1bGVLZXksIGpvYl9pZDogcHJlcGFyZWRKb2Iuam9iSWR9LFxuICAgICAgICBjb25mbGljdENvbHVtbnM6IFtcInNjaGVkdWxlX2tleVwiXSxcbiAgICAgICAgdXBkYXRlQ29sdW1uczogW1wiam9iX2lkXCJdXG4gICAgICB9KVxuXG4gICAgICBpZiAocHJldmlvdXNTdGF0dXMgIT09IFwicXVldWVkXCIpIGF3YWl0IHRoaXMuX3JlY29yZENvdW50RGVsdGEoZGIsIHthbGw6IDEsIHF1ZXVlZDogMX0pXG4gICAgICByZXR1cm4ge2pvYklkOiBwcmVwYXJlZEpvYi5qb2JJZCwgcHJldmlvdXNKb2JJZCwgcHJldmlvdXNTdGF0dXN9XG4gICAgfSwge1xuICAgICAgYWR2aXNvcnlMb2NrOiB7XG4gICAgICAgIGZhaWx1cmVNZXNzYWdlOiBcIkZhaWxlZCB0byBhY3F1aXJlIGJhY2tncm91bmQgam9iIHNjaGVkdWxlLWtleSBsb2NrXCIsXG4gICAgICAgIG5hbWU6IHRoaXMuX3NjaGVkdWxlS2V5TG9ja05hbWUobm9ybWFsaXplZFNjaGVkdWxlS2V5KVxuICAgICAgfVxuICAgIH0pXG4gIH1cblxuICAvKipcbiAgICogQ2FuY2VscyB0aGUgcXVldWVkIG93bmVyIG9mIGEgc3RhYmxlIHNjaGVkdWxlIGtleS4gQSBoYW5kZWQtb2ZmIG93bmVyIGlzXG4gICAqIGRldGFjaGVkIGJ1dCBub3QgbWFya2VkIHN0b3BwZWQgYmVjYXVzZSBleGVjdXRpb24gbWF5IGFscmVhZHkgYmUgcnVubmluZy5cbiAgICogQHBhcmFtIHtzdHJpbmd9IHNjaGVkdWxlS2V5IC0gU3RhYmxlIGxvZ2ljYWwgc2NoZWR1bGUga2V5LlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxpbXBvcnQoXCIuL3R5cGVzLmpzXCIpLkJhY2tncm91bmRKb2JDYW5jZWxsYXRpb25SZXN1bHQ+fSAtIENhbmNlbGxhdGlvbiByZXN1bHQuXG4gICAqL1xuICBhc3luYyBjYW5jZWxTY2hlZHVsZWQoc2NoZWR1bGVLZXkpIHtcbiAgICBhd2FpdCB0aGlzLmVuc3VyZVJlYWR5KClcblxuICAgIGNvbnN0IG5vcm1hbGl6ZWRTY2hlZHVsZUtleSA9IHRoaXMuX25vcm1hbGl6ZVNjaGVkdWxlS2V5KHNjaGVkdWxlS2V5KVxuXG4gICAgcmV0dXJuIGF3YWl0IHRoaXMuX3NlcmlhbGl6ZWRDb3VudE11dGF0aW9uKGFzeW5jIChkYikgPT4ge1xuICAgICAgY29uc3Qgb3duZXJSb3dzID0gYXdhaXQgZGJcbiAgICAgICAgLm5ld1F1ZXJ5KClcbiAgICAgICAgLmZyb20oU0NIRURVTEVfS0VZU19UQUJMRSlcbiAgICAgICAgLndoZXJlKHtzY2hlZHVsZV9rZXk6IG5vcm1hbGl6ZWRTY2hlZHVsZUtleX0pXG4gICAgICAgIC5saW1pdCgxKVxuICAgICAgICAucmVzdWx0cygpXG5cbiAgICAgIGlmICghb3duZXJSb3dzWzBdKSByZXR1cm4ge2pvYklkOiBudWxsLCBvdXRjb21lOiBcIm5vdF9mb3VuZFwifVxuXG4gICAgICBjb25zdCBqb2JJZCA9IFN0cmluZygvKiogQHR5cGUge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gKi8gKG93bmVyUm93c1swXSkuam9iX2lkKVxuICAgICAgY29uc3Qgam9iID0gYXdhaXQgdGhpcy5fZ2V0Sm9iUm93QnlJZChkYiwgam9iSWQpXG5cbiAgICAgIGlmIChqb2I/LnN0YXR1cyA9PT0gXCJxdWV1ZWRcIikge1xuICAgICAgICBjb25zdCBhZmZlY3RlZFJvd3MgPSBhd2FpdCB0aGlzLl91cGRhdGVBZmZlY3RlZFJvd3MoZGIsIHtcbiAgICAgICAgICB0YWJsZU5hbWU6IEpPQlNfVEFCTEUsXG4gICAgICAgICAgZGF0YToge3N0YXR1czogXCJjYW5jZWxsZWRcIn0sXG4gICAgICAgICAgY29uZGl0aW9uczoge2lkOiBqb2IuaWQsIHN0YXR1czogXCJxdWV1ZWRcIn1cbiAgICAgICAgfSlcblxuICAgICAgICBpZiAoYWZmZWN0ZWRSb3dzID09PSAxKSB7XG4gICAgICAgICAgYXdhaXQgdGhpcy5fcmVsZWFzZVNjaGVkdWxlT3duZXJzaGlwKGRiLCB7am9iSWQsIHNjaGVkdWxlS2V5OiBub3JtYWxpemVkU2NoZWR1bGVLZXl9KVxuICAgICAgICAgIGF3YWl0IHRoaXMuX3JlY29yZFN0YXR1c1RyYW5zaXRpb24oZGIsIFwicXVldWVkXCIsIFwiY2FuY2VsbGVkXCIpXG5cbiAgICAgICAgICByZXR1cm4ge2pvYklkLCBvdXRjb21lOiBcImNhbmNlbGxlZFwifVxuICAgICAgICB9XG4gICAgICB9XG5cbiAgICAgIGNvbnN0IGN1cnJlbnRKb2IgPSBhd2FpdCB0aGlzLl9nZXRKb2JSb3dCeUlkKGRiLCBqb2JJZClcblxuICAgICAgYXdhaXQgdGhpcy5fcmVsZWFzZVNjaGVkdWxlT3duZXJzaGlwKGRiLCB7am9iSWQsIHNjaGVkdWxlS2V5OiBub3JtYWxpemVkU2NoZWR1bGVLZXl9KVxuXG4gICAgICBpZiAoY3VycmVudEpvYj8uc3RhdHVzID09PSBcImhhbmRlZF9vZmZcIikgcmV0dXJuIHtqb2JJZCwgb3V0Y29tZTogXCJoYW5kZWRfb2ZmXCJ9XG4gICAgICByZXR1cm4ge2pvYklkOiBudWxsLCBvdXRjb21lOiBcIm5vdF9mb3VuZFwifVxuICAgIH0sIHtcbiAgICAgIGFkdmlzb3J5TG9jazoge1xuICAgICAgICBmYWlsdXJlTWVzc2FnZTogXCJGYWlsZWQgdG8gYWNxdWlyZSBiYWNrZ3JvdW5kIGpvYiBzY2hlZHVsZS1rZXkgbG9ja1wiLFxuICAgICAgICBuYW1lOiB0aGlzLl9zY2hlZHVsZUtleUxvY2tOYW1lKG5vcm1hbGl6ZWRTY2hlZHVsZUtleSlcbiAgICAgIH1cbiAgICB9KVxuICB9XG5cbiAgLyoqXG4gICAqIFJlYWRzIHN0YWJsZSBvd25lcnNoaXAgYW5kIG9wdGlvbmFsIGxhdGVzdCB0ZXJtaW5hbCBoaXN0b3J5IGluIG9uZSBmZW5jZWQgdHJhbnNhY3Rpb24uXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBzY2hlZHVsZUtleSAtIFN0YWJsZSBsb2dpY2FsIHNjaGVkdWxlIGtleS5cbiAgICogQHBhcmFtIHt7aW5jbHVkZUxhdGVzdFRlcm1pbmFsPzogYm9vbGVhbn19IFtvcHRpb25zXSAtIExvb2t1cCBvcHRpb25zLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxpbXBvcnQoXCIuL3R5cGVzLmpzXCIpLkJhY2tncm91bmRKb2JTY2hlZHVsZWRMb29rdXBSZXN1bHQ+fSAtIE5vcm1hbGl6ZWQgcHVibGljIGpvYnMuXG4gICAqL1xuICBhc3luYyBnZXRTY2hlZHVsZWRKb2Ioc2NoZWR1bGVLZXksIHtpbmNsdWRlTGF0ZXN0VGVybWluYWwgPSBmYWxzZX0gPSB7fSkge1xuICAgIGF3YWl0IHRoaXMuZW5zdXJlUmVhZHkoKVxuXG4gICAgY29uc3Qgbm9ybWFsaXplZFNjaGVkdWxlS2V5ID0gdGhpcy5fbm9ybWFsaXplU2NoZWR1bGVLZXkoc2NoZWR1bGVLZXkpXG5cbiAgICBpZiAodHlwZW9mIGluY2x1ZGVMYXRlc3RUZXJtaW5hbCAhPT0gXCJib29sZWFuXCIpIHtcbiAgICAgIHRocm93IFZlbG9jaW91c0Vycm9yLnNhZmUoXCJiYWNrZ3JvdW5kIGpvYiBpbmNsdWRlTGF0ZXN0VGVybWluYWwgbXVzdCBiZSBhIGJvb2xlYW5cIilcbiAgICB9XG5cbiAgICByZXR1cm4gYXdhaXQgdGhpcy5fc2VyaWFsaXplZENvdW50TXV0YXRpb24oYXN5bmMgKGRiKSA9PiB7XG4gICAgICByZXR1cm4gYXdhaXQgdGhpcy5fc2NoZWR1bGVkSm9iTG9va3VwKGRiLCB7XG4gICAgICAgIGluY2x1ZGVMYXRlc3RUZXJtaW5hbCxcbiAgICAgICAgc2NoZWR1bGVLZXk6IG5vcm1hbGl6ZWRTY2hlZHVsZUtleVxuICAgICAgfSlcbiAgICB9LCB7XG4gICAgICBhZHZpc29yeUxvY2s6IHtcbiAgICAgICAgZmFpbHVyZU1lc3NhZ2U6IFwiRmFpbGVkIHRvIGFjcXVpcmUgYmFja2dyb3VuZCBqb2Igc2NoZWR1bGUta2V5IGxvY2tcIixcbiAgICAgICAgbmFtZTogdGhpcy5fc2NoZWR1bGVLZXlMb2NrTmFtZShub3JtYWxpemVkU2NoZWR1bGVLZXkpXG4gICAgICB9XG4gICAgfSlcbiAgfVxuXG4gIC8qKlxuICAgKiBNb3ZlcyBvbmx5IGEgZnV0dXJlIHF1ZXVlZCBzdGFibGUgb3duZXIgdG8gdGhlIGN1cnJlbnQgdGltZS5cbiAgICogQHBhcmFtIHtzdHJpbmd9IHNjaGVkdWxlS2V5IC0gU3RhYmxlIGxvZ2ljYWwgc2NoZWR1bGUga2V5LlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxpbXBvcnQoXCIuL3R5cGVzLmpzXCIpLkJhY2tncm91bmRKb2JXYWtlUmVzdWx0Pn0gLSBFeGFjdCB3YWtlIG91dGNvbWUuXG4gICAqL1xuICBhc3luYyB3YWtlU2NoZWR1bGVkKHNjaGVkdWxlS2V5KSB7XG4gICAgYXdhaXQgdGhpcy5lbnN1cmVSZWFkeSgpXG5cbiAgICBjb25zdCBub3JtYWxpemVkU2NoZWR1bGVLZXkgPSB0aGlzLl9ub3JtYWxpemVTY2hlZHVsZUtleShzY2hlZHVsZUtleSlcblxuICAgIHJldHVybiBhd2FpdCB0aGlzLl9zZXJpYWxpemVkQ291bnRNdXRhdGlvbihhc3luYyAoZGIpID0+IHtcbiAgICAgIGNvbnN0IGpvYiA9IGF3YWl0IHRoaXMuX3NjaGVkdWxlZE93bmVySm9iKGRiLCBub3JtYWxpemVkU2NoZWR1bGVLZXkpXG5cbiAgICAgIGlmICgham9iIHx8IChqb2Iuc3RhdHVzICE9PSBcInF1ZXVlZFwiICYmIGpvYi5zdGF0dXMgIT09IFwiaGFuZGVkX29mZlwiKSkgcmV0dXJuIHtqb2JJZDogbnVsbCwgb3V0Y29tZTogXCJub3RfZm91bmRcIn1cbiAgICAgIGlmIChqb2Iuc3RhdHVzID09PSBcImhhbmRlZF9vZmZcIikgcmV0dXJuIHtqb2JJZDogam9iLmlkLCBvdXRjb21lOiBcImhhbmRlZF9vZmZcIn1cblxuICAgICAgY29uc3Qgbm93TXMgPSB0aGlzLmNsb2NrLm5vdygpXG5cbiAgICAgIGlmIChOdW1iZXIoam9iLnNjaGVkdWxlZEF0TXMpIDw9IG5vd01zKSByZXR1cm4ge2pvYklkOiBqb2IuaWQsIG91dGNvbWU6IFwiYWxyZWFkeV9kdWVcIn1cblxuICAgICAgY29uc3QgYWZmZWN0ZWRSb3dzID0gYXdhaXQgdGhpcy5fdXBkYXRlQWZmZWN0ZWRSb3dzKGRiLCB7XG4gICAgICAgIHRhYmxlTmFtZTogSk9CU19UQUJMRSxcbiAgICAgICAgZGF0YToge3NjaGVkdWxlZF9hdF9tczogbm93TXN9LFxuICAgICAgICBjb25kaXRpb25zOiB7aWQ6IGpvYi5pZCwgc2NoZWR1bGVkX2F0X21zOiBqb2Iuc2NoZWR1bGVkQXRNcywgc3RhdHVzOiBcInF1ZXVlZFwifVxuICAgICAgfSlcblxuICAgICAgaWYgKGFmZmVjdGVkUm93cyA9PT0gMSkgcmV0dXJuIHtqb2JJZDogam9iLmlkLCBvdXRjb21lOiBcIndva2VuXCJ9XG5cbiAgICAgIGNvbnN0IGN1cnJlbnRKb2IgPSBhd2FpdCB0aGlzLl9zY2hlZHVsZWRPd25lckpvYihkYiwgbm9ybWFsaXplZFNjaGVkdWxlS2V5KVxuXG4gICAgICBpZiAoY3VycmVudEpvYj8uc3RhdHVzID09PSBcImhhbmRlZF9vZmZcIikgcmV0dXJuIHtqb2JJZDogY3VycmVudEpvYi5pZCwgb3V0Y29tZTogXCJoYW5kZWRfb2ZmXCJ9XG4gICAgICBpZiAoY3VycmVudEpvYj8uc3RhdHVzID09PSBcInF1ZXVlZFwiICYmIE51bWJlcihjdXJyZW50Sm9iLnNjaGVkdWxlZEF0TXMpIDw9IG5vd01zKSB7XG4gICAgICAgIHJldHVybiB7am9iSWQ6IGN1cnJlbnRKb2IuaWQsIG91dGNvbWU6IFwiYWxyZWFkeV9kdWVcIn1cbiAgICAgIH1cblxuICAgICAgcmV0dXJuIHtqb2JJZDogbnVsbCwgb3V0Y29tZTogXCJub3RfZm91bmRcIn1cbiAgICB9LCB7XG4gICAgICBhZHZpc29yeUxvY2s6IHtcbiAgICAgICAgZmFpbHVyZU1lc3NhZ2U6IFwiRmFpbGVkIHRvIGFjcXVpcmUgYmFja2dyb3VuZCBqb2Igc2NoZWR1bGUta2V5IGxvY2tcIixcbiAgICAgICAgbmFtZTogdGhpcy5fc2NoZWR1bGVLZXlMb2NrTmFtZShub3JtYWxpemVkU2NoZWR1bGVLZXkpXG4gICAgICB9XG4gICAgfSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIG5leHQgYXZhaWxhYmxlIGpvYi5cbiAgICogQHBhcmFtIHtvYmplY3R9IFthcmdzXSAtIE9wdGlvbnMuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi90eXBlcy5qc1wiKS5CYWNrZ3JvdW5kSm9iRXhlY3V0aW9uTW9kZSB8IGltcG9ydChcIi4vdHlwZXMuanNcIikuQmFja2dyb3VuZEpvYkV4ZWN1dGlvbk1vZGVbXX0gW2FyZ3MuZXhlY3V0aW9uTW9kZV0gLSBFeGVjdXRpb24gbW9kZSBvciBtb2RlcyB0byBtYXRjaC5cbiAgICogQHJldHVybnMge1Byb21pc2U8aW1wb3J0KFwiLi90eXBlcy5qc1wiKS5CYWNrZ3JvdW5kSm9iUm93IHwgbnVsbD59IC0gTmV4dCBqb2IuXG4gICAqL1xuICBhc3luYyBuZXh0QXZhaWxhYmxlSm9iKGFyZ3MgPSB7fSkge1xuICAgIGF3YWl0IHRoaXMuZW5zdXJlUmVhZHkoKVxuXG4gICAgcmV0dXJuIGF3YWl0IHRoaXMuX3dpdGhEYihhc3luYyAoZGIpID0+IHtcbiAgICAgIHJldHVybiBhd2FpdCB0aGlzLl9uZXh0UXVldWVkSm9iKHtcbiAgICAgICAgZGIsXG4gICAgICAgIHNjaGVkdWxlZEF0T3BlcmF0b3I6IFwiPD1cIixcbiAgICAgICAgZXhlY3V0aW9uTW9kZTogYXJncy5leGVjdXRpb25Nb2RlXG4gICAgICB9KVxuICAgIH0pXG4gIH1cblxuICAvKipcbiAgICogUmV0dXJucyB0aGUgc29vbmVzdCBmdXR1cmUtc2NoZWR1bGVkIHF1ZXVlZCBqb2IgKG9uZSB3aG9zZVxuICAgKiBgc2NoZWR1bGVkX2F0X21zYCBpcyBpbiB0aGUgZnV0dXJlKSwgb3IgbnVsbCB3aGVuIHRoZXJlIGFyZSBub1xuICAgKiBmdXR1cmUtc2NoZWR1bGVkIGpvYnMuIFVzZWQgYnkgdGhlIGV2ZW50LWRyaXZlbiBkaXNwYXRjaGVyIHRvIGFybSBhXG4gICAqIGBzZXRUaW1lb3V0YCBmb3IgdGhlIGV4YWN0IG1vbWVudCB0aGUgbmV4dCBzY2hlZHVsZWQgam9iIGJlY29tZXNcbiAgICogZWxpZ2libGUsIHJlcGxhY2luZyB0aGUgbGVnYWN5IDEtc2Vjb25kIHBvbGxpbmcgbG9vcC5cbiAgICogQHJldHVybnMge1Byb21pc2U8aW1wb3J0KFwiLi90eXBlcy5qc1wiKS5CYWNrZ3JvdW5kSm9iUm93IHwgbnVsbD59IC0gU29vbmVzdCBmdXR1cmUtc2NoZWR1bGVkIGpvYiwgb3IgbnVsbC5cbiAgICovXG4gIGFzeW5jIG5leHRTY2hlZHVsZWRKb2IoKSB7XG4gICAgYXdhaXQgdGhpcy5lbnN1cmVSZWFkeSgpXG5cbiAgICByZXR1cm4gYXdhaXQgdGhpcy5fd2l0aERiKGFzeW5jIChkYikgPT4ge1xuICAgICAgcmV0dXJuIGF3YWl0IHRoaXMuX25leHRRdWV1ZWRKb2Ioe2RiLCBzY2hlZHVsZWRBdE9wZXJhdG9yOiBcIj5cIn0pXG4gICAgfSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIG5leHQgcXVldWVkIGpvYi5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBPcHRpb25zLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL2RhdGFiYXNlL2RyaXZlcnMvYmFzZS5qc1wiKS5kZWZhdWx0fSBhcmdzLmRiIC0gRGF0YWJhc2UgY29ubmVjdGlvbi5cbiAgICogQHBhcmFtIHtcIjw9XCIgfCBcIj5cIn0gYXJncy5zY2hlZHVsZWRBdE9wZXJhdG9yIC0gU2NoZWR1bGVkIHRpbWVzdGFtcCBvcGVyYXRvci5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL3R5cGVzLmpzXCIpLkJhY2tncm91bmRKb2JFeGVjdXRpb25Nb2RlIHwgaW1wb3J0KFwiLi90eXBlcy5qc1wiKS5CYWNrZ3JvdW5kSm9iRXhlY3V0aW9uTW9kZVtdfSBbYXJncy5leGVjdXRpb25Nb2RlXSAtIEV4ZWN1dGlvbiBtb2RlIG9yIG1vZGVzIHRvIG1hdGNoLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxpbXBvcnQoXCIuL3R5cGVzLmpzXCIpLkJhY2tncm91bmRKb2JSb3cgfCBudWxsPn0gLSBOZXh0IG1hdGNoaW5nIHF1ZXVlZCBqb2IuXG4gICAqL1xuICBhc3luYyBfbmV4dFF1ZXVlZEpvYih7ZGIsIHNjaGVkdWxlZEF0T3BlcmF0b3IsIGV4ZWN1dGlvbk1vZGV9KSB7XG4gICAgY29uc3Qgbm93ID0gdGhpcy5jbG9jay5ub3coKVxuICAgIGxldCBxdWVyeSA9IGRiXG4gICAgICAubmV3UXVlcnkoKVxuICAgICAgLmZyb20oSk9CU19UQUJMRSlcbiAgICAgIC53aGVyZSh7c3RhdHVzOiBcInF1ZXVlZFwifSlcbiAgICAgIC53aGVyZShgc2NoZWR1bGVkX2F0X21zICR7c2NoZWR1bGVkQXRPcGVyYXRvcn0gJHtkYi5xdW90ZShub3cpfWApXG5cbiAgICBpZiAoc2NoZWR1bGVkQXRPcGVyYXRvciA9PT0gXCI8PVwiKSB7XG4gICAgICBjb25zdCBqb2JzVGFibGUgPSBkYi5xdW90ZVRhYmxlKEpPQlNfVEFCTEUpXG4gICAgICBjb25zdCBjb25jdXJyZW5jeVRhYmxlID0gZGIucXVvdGVUYWJsZShDT05DVVJSRU5DWV9UQUJMRSlcbiAgICAgIHF1ZXJ5ID0gcXVlcnkud2hlcmUoXG4gICAgICAgIGAoJHtqb2JzVGFibGV9LiR7ZGIucXVvdGVDb2x1bW4oXCJjb25jdXJyZW5jeV9rZXlcIil9IElTIE5VTEwgT1IgRVhJU1RTIChgICtcbiAgICAgICAgYFNFTEVDVCAxIEZST00gJHtjb25jdXJyZW5jeVRhYmxlfSBXSEVSRSBgICtcbiAgICAgICAgYCR7Y29uY3VycmVuY3lUYWJsZX0uJHtkYi5xdW90ZUNvbHVtbihcImNvbmN1cnJlbmN5X2tleVwiKX0gPSAke2pvYnNUYWJsZX0uJHtkYi5xdW90ZUNvbHVtbihcImNvbmN1cnJlbmN5X2tleVwiKX0gQU5EIGAgK1xuICAgICAgICBgJHtjb25jdXJyZW5jeVRhYmxlfS4ke2RiLnF1b3RlQ29sdW1uKFwiYWN0aXZlX2NvdW50XCIpfSA8ICR7Y29uY3VycmVuY3lUYWJsZX0uJHtkYi5xdW90ZUNvbHVtbihcIm1heF9jb25jdXJyZW5jeVwiKX0pKWBcbiAgICAgIClcbiAgICB9XG5cbiAgICBpZiAoZXhlY3V0aW9uTW9kZSkgcXVlcnkgPSB0aGlzLl93aGVyZUV4ZWN1dGlvbk1vZGUoe2RiLCBleGVjdXRpb25Nb2RlLCBxdWVyeX0pXG5cbiAgICBpZiAoc2NoZWR1bGVkQXRPcGVyYXRvciA9PT0gXCI8PVwiKSB7XG4gICAgICBjb25zdCBwcmlvcml0eU9yZGVyID0gdGhpcy5fcXVldWVQcmlvcml0eU9yZGVyU3FsKGRiKVxuXG4gICAgICBpZiAocHJpb3JpdHlPcmRlcikgcXVlcnkgPSBxdWVyeS5vcmRlcihgJHtwcmlvcml0eU9yZGVyfSBERVNDYClcbiAgICB9XG5cbiAgICBxdWVyeSA9IHF1ZXJ5XG4gICAgICAub3JkZXIoXCJzY2hlZHVsZWRfYXRfbXMgQVNDXCIpXG4gICAgICAub3JkZXIoXCJjcmVhdGVkX2F0X21zIEFTQ1wiKVxuICAgICAgLmxpbWl0KDEpXG5cbiAgICBjb25zdCByb3dzID0gYXdhaXQgcXVlcnkucmVzdWx0cygpXG4gICAgY29uc3Qgcm93ID0gcm93c1swXVxuXG4gICAgaWYgKCFyb3cpIHJldHVybiBudWxsXG5cbiAgICByZXR1cm4gdGhpcy5fbm9ybWFsaXplSm9iUm93KHJvdylcbiAgfVxuXG4gIC8qKlxuICAgKiBCdWlsZHMgYSByYXcgU1FMIE9SREVSIEJZIGV4cHJlc3Npb24gcmFua2luZyBxdWV1ZWQgam9icyBieSB0aGVpciBxdWV1ZSdzXG4gICAqIGNvbmZpZ3VyZWQgcHJpb3JpdHkgKGBiYWNrZ3JvdW5kSm9icy5xdWV1ZXNbcXVldWVdLnByaW9yaXR5YCwgZGVmYXVsdCBgMGApLFxuICAgKiBzbyB0aGUgZGlzcGF0Y2hlciBwaWNrcyBoaWdoZXItcHJpb3JpdHkgcXVldWVzIGZpcnN0IHJlZ2FyZGxlc3Mgb2YgZW5xdWV1ZVxuICAgKiBvcmRlci4gT25seSBhcHBsaWVkIHRvIHRoZSBkaXNwYXRjaCBwYXRoIChgc2NoZWR1bGVkQXRPcGVyYXRvciA9PT0gXCI8PVwiYCk7XG4gICAqIHRoZSBmdXR1cmUtc2NoZWR1bGVkIGxvb2t1cCBtdXN0IHN0YXkgc3RyaWN0bHkgdGltZS1vcmRlcmVkLiBDb21wb3NlcyB3aXRoXG4gICAqIHRoZSBjb25jdXJyZW5jeSBFWElTVFMgZmlsdGVyOiBhIGhpZ2hlci1wcmlvcml0eSBxdWV1ZSBhbHJlYWR5IGF0IGl0cyBjYXAgaXNcbiAgICogZmlsdGVyZWQgb3V0LCBzbyBkaXNwYXRjaCBmYWxscyB0aHJvdWdoIHRvIHRoZSBuZXh0IGVsaWdpYmxlIGxvd2VyLXByaW9yaXR5XG4gICAqIGpvYi4gUmV0dXJucyBudWxsIHdoZW4gbm8gcXVldWUgY29uZmlndXJlcyBhIG5vbi16ZXJvIHByaW9yaXR5IHNvIHRoZSBwbGFpblxuICAgKiBGSUZPIG9yZGVyaW5nIGlzIGxlZnQgdW50b3VjaGVkIChhbmQgbm8gbmVlZGxlc3MgZmlsZXNvcnQgaXMgaW50cm9kdWNlZCkuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vZGF0YWJhc2UvZHJpdmVycy9iYXNlLmpzXCIpLmRlZmF1bHR9IGRiIC0gRGF0YWJhc2UgY29ubmVjdGlvbi5cbiAgICogQHJldHVybnMge3N0cmluZyB8IG51bGx9IC0gUmF3IFNRTCBDQVNFIGV4cHJlc3Npb24sIG9yIG51bGwgd2hlbiBubyBxdWV1ZSBpcyBwcmlvcml0aXplZC5cbiAgICovXG4gIF9xdWV1ZVByaW9yaXR5T3JkZXJTcWwoZGIpIHtcbiAgICBjb25zdCBxdWV1ZXMgPSB0aGlzLmNvbmZpZ3VyYXRpb24uZ2V0QmFja2dyb3VuZEpvYnNDb25maWcoKS5xdWV1ZXMgfHwge31cbiAgICAvKiogQHR5cGUge0FycmF5PFtzdHJpbmcsIG51bWJlcl0+fSAqL1xuICAgIGNvbnN0IHByaW9yaXRpemVkID0gW11cblxuICAgIGZvciAoY29uc3QgW3F1ZXVlLCBxdWV1ZUNvbmZpZ10gb2YgT2JqZWN0LmVudHJpZXMocXVldWVzKSkge1xuICAgICAgY29uc3QgcHJpb3JpdHkgPSBxdWV1ZUNvbmZpZz8ucHJpb3JpdHlcblxuICAgICAgaWYgKE51bWJlci5pc0Zpbml0ZShwcmlvcml0eSkgJiYgTnVtYmVyKHByaW9yaXR5KSAhPT0gMCkgcHJpb3JpdGl6ZWQucHVzaChbcXVldWUsIE51bWJlcihwcmlvcml0eSldKVxuICAgIH1cblxuICAgIGlmIChwcmlvcml0aXplZC5sZW5ndGggPT09IDApIHJldHVybiBudWxsXG5cbiAgICBjb25zdCBxdWV1ZUNvbHVtbiA9IGRiLnF1b3RlQ29sdW1uKFwicXVldWVcIilcbiAgICBjb25zdCB3aGVucyA9IHByaW9yaXRpemVkXG4gICAgICAubWFwKChbcXVldWUsIHByaW9yaXR5XSkgPT4gYFdIRU4gJHtkYi5xdW90ZShxdWV1ZSl9IFRIRU4gJHtwcmlvcml0eX1gKVxuICAgICAgLmpvaW4oXCIgXCIpXG5cbiAgICByZXR1cm4gYENBU0UgQ09BTEVTQ0UoJHtxdWV1ZUNvbHVtbn0sICR7ZGIucXVvdGUoREVGQVVMVF9CQUNLR1JPVU5EX0pPQl9RVUVVRSl9KSAke3doZW5zfSBFTFNFIDAgRU5EYFxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZ2V0IGpvYi5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGpvYklkIC0gSm9iIGlkLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxpbXBvcnQoXCIuL3R5cGVzLmpzXCIpLkJhY2tncm91bmRKb2JSb3cgfCBudWxsPn0gLSBKb2Igcm93LlxuICAgKi9cbiAgYXN5bmMgZ2V0Sm9iKGpvYklkKSB7XG4gICAgYXdhaXQgdGhpcy5lbnN1cmVSZWFkeSgpXG5cbiAgICByZXR1cm4gYXdhaXQgdGhpcy5fd2l0aERiKGFzeW5jIChkYikgPT4ge1xuICAgICAgY29uc3QgcXVlcnkgPSBkYlxuICAgICAgICAubmV3UXVlcnkoKVxuICAgICAgICAuZnJvbShKT0JTX1RBQkxFKVxuICAgICAgICAud2hlcmUoe2lkOiBqb2JJZH0pXG4gICAgICAgIC5saW1pdCgxKVxuXG4gICAgICBjb25zdCByb3dzID0gYXdhaXQgcXVlcnkucmVzdWx0cygpXG4gICAgICBjb25zdCByb3cgPSByb3dzWzBdXG5cbiAgICAgIGlmICghcm93KSByZXR1cm4gbnVsbFxuXG4gICAgICByZXR1cm4gdGhpcy5fbm9ybWFsaXplSm9iUm93KHJvdylcbiAgICB9KVxuICB9XG5cbiAgLyoqXG4gICAqIENvdW50cyBqb2JzIGdyb3VwZWQgYnkgc3RhdHVzLiBVc2VkIGJ5IHRoZSBkYXNoYm9hcmQgb3ZlcnZpZXcuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPFJlY29yZDxzdHJpbmcsIG51bWJlcj4+fSAtIENvdW50cyBrZXllZCBieSBzdGF0dXMuXG4gICAqL1xuICBhc3luYyBjb3VudHNCeVN0YXR1cygpIHtcbiAgICBhd2FpdCB0aGlzLmVuc3VyZVJlYWR5KClcblxuICAgIHJldHVybiBhd2FpdCB0aGlzLl93aXRoRGIoYXN5bmMgKGRiKSA9PiB7XG4gICAgICBjb25zdCByb3dzID0gYXdhaXQgZGJcbiAgICAgICAgLm5ld1F1ZXJ5KClcbiAgICAgICAgLmZyb20oSk9CU19UQUJMRSlcbiAgICAgICAgLnNlbGVjdChcInN0YXR1c1wiKVxuICAgICAgICAuc2VsZWN0KFwiQ09VTlQoKikgQVMgY291bnRcIilcbiAgICAgICAgLmdyb3VwKFwic3RhdHVzXCIpXG4gICAgICAgIC5yZXN1bHRzKClcblxuICAgICAgLyoqXG4gICAgICAgKiBDb3VudHMuXG4gICAgICAgKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgbnVtYmVyPn0gKi9cbiAgICAgIGNvbnN0IGNvdW50cyA9IHt9XG5cbiAgICAgIGZvciAoY29uc3Qgcm93IG9mIHJvd3MpIHtcbiAgICAgICAgY29uc3QgdHlwZWRSb3cgPSAvKiogQHR5cGUge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gKi8gKHJvdylcblxuICAgICAgICBjb3VudHNbU3RyaW5nKHR5cGVkUm93LnN0YXR1cyldID0gdGhpcy5fbm9ybWFsaXplTnVtYmVyKHR5cGVkUm93LmNvdW50KSB8fCAwXG4gICAgICB9XG5cbiAgICAgIHJldHVybiBjb3VudHNcbiAgICB9KVxuICB9XG5cbiAgLyoqXG4gICAqIFJldHVybnMgdGhlIGF1dGhvcml0YXRpdmUgZGFzaGJvYXJkIGNvdW50IHNuYXBzaG90IGFuZCBpdHMgbWF0Y2hpbmcgZHVyYWJsZVxuICAgKiByZXZpc2lvbi4gTG9ja2luZyB0aGUgcmV2aXNpb24gcm93IGJlZm9yZSBjb3VudGluZyBwcmV2ZW50cyBhIHdyaXRlciBmcm9tXG4gICAqIGNvbW1pdHRpbmcgYmV0d2VlbiB0aGUgY291bnQgcXVlcnkgYW5kIHJldmlzaW9uIHJlYWQuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHtjb3VudHM6IFJlY29yZDxzdHJpbmcsIG51bWJlcj4sIHJldmlzaW9uOiBudW1iZXIsIHRvdGFsOiBudW1iZXJ9Pn0gU25hcHNob3QuXG4gICAqL1xuICBhc3luYyBjb3VudFNuYXBzaG90KCkge1xuICAgIGF3YWl0IHRoaXMuZW5zdXJlUmVhZHkoKVxuXG4gICAgcmV0dXJuIGF3YWl0IHRoaXMuX3NlcmlhbGl6ZWRDb3VudE11dGF0aW9uKGFzeW5jIChkYikgPT4ge1xuICAgICAgcmV0dXJuIGF3YWl0IHRoaXMuX2NvdW50U25hcHNob3RPbkxvY2tlZENvbm5lY3Rpb24oZGIpXG4gICAgfSlcbiAgfVxuXG4gIC8qKlxuICAgKiBDb3VudHMgam9icyBtYXRjaGluZyB0aGUgZ2l2ZW4gZmlsdGVycy5cbiAgICogQHBhcmFtIHtvYmplY3R9IFthcmdzXSAtIE9wdGlvbnMuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBbYXJncy5zdGF0dXNdIC0gRmlsdGVyIGJ5IHN0YXR1cy5cbiAgICogQHBhcmFtIHtzdHJpbmd9IFthcmdzLmpvYk5hbWVdIC0gRmlsdGVyIGJ5IGpvYiBuYW1lLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxudW1iZXI+fSAtIE1hdGNoaW5nIGpvYiBjb3VudC5cbiAgICovXG4gIGFzeW5jIGNvdW50Sm9icyh7c3RhdHVzLCBqb2JOYW1lfSA9IHt9KSB7XG4gICAgYXdhaXQgdGhpcy5lbnN1cmVSZWFkeSgpXG5cbiAgICByZXR1cm4gYXdhaXQgdGhpcy5fd2l0aERiKGFzeW5jIChkYikgPT4ge1xuICAgICAgbGV0IHF1ZXJ5ID0gZGIubmV3UXVlcnkoKS5mcm9tKEpPQlNfVEFCTEUpLnNlbGVjdChcIkNPVU5UKCopIEFTIGNvdW50XCIpXG5cbiAgICAgIGlmIChzdGF0dXMpIHF1ZXJ5ID0gcXVlcnkud2hlcmUoe3N0YXR1c30pXG4gICAgICBpZiAoam9iTmFtZSkgcXVlcnkgPSBxdWVyeS53aGVyZSh7am9iX25hbWU6IGpvYk5hbWV9KVxuXG4gICAgICBjb25zdCByb3dzID0gYXdhaXQgcXVlcnkucmVzdWx0cygpXG4gICAgICBjb25zdCBjb3VudFJvdyA9IC8qKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSAqLyAocm93c1swXSB8fCB7fSlcblxuICAgICAgcmV0dXJuIHRoaXMuX25vcm1hbGl6ZU51bWJlcihjb3VudFJvdy5jb3VudCkgfHwgMFxuICAgIH0pXG4gIH1cblxuICAvKipcbiAgICogTGlzdHMgam9icyBmb3IgdGhlIGRhc2hib2FyZCwgZmlsdGVyZWQsIHNvcnRlZCBhbmQgcGFnaW5hdGVkLlxuICAgKiBAcGFyYW0ge29iamVjdH0gW2FyZ3NdIC0gT3B0aW9ucy5cbiAgICogQHBhcmFtIHtzdHJpbmd9IFthcmdzLnN0YXR1c10gLSBGaWx0ZXIgYnkgc3RhdHVzLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gW2FyZ3Muam9iTmFtZV0gLSBGaWx0ZXIgYnkgam9iIG5hbWUuXG4gICAqIEBwYXJhbSB7bnVtYmVyfSBbYXJncy5saW1pdF0gLSBNYXhpbXVtIHJvd3MgdG8gcmV0dXJuLlxuICAgKiBAcGFyYW0ge251bWJlcn0gW2FyZ3Mub2Zmc2V0XSAtIFJvd3MgdG8gc2tpcC5cbiAgICogQHBhcmFtIHtzdHJpbmd9IFthcmdzLnNvcnRDb2x1bW5dIC0gQ2FtZWwtY2FzZWQgY29sdW1uIHRvIHNvcnQgYnkgKHNlZSBTT1JUQUJMRV9DT0xVTU5TKS5cbiAgICogQHBhcmFtIHtcIkFTQ1wiIHwgXCJERVNDXCJ9IFthcmdzLnNvcnREaXJlY3Rpb25dIC0gU29ydCBkaXJlY3Rpb24uXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPGltcG9ydChcIi4vdHlwZXMuanNcIikuQmFja2dyb3VuZEpvYlJvd1tdPn0gLSBOb3JtYWxpemVkIGpvYiByb3dzLlxuICAgKi9cbiAgYXN5bmMgbGlzdEpvYnMoe3N0YXR1cywgam9iTmFtZSwgbGltaXQgPSAyNSwgb2Zmc2V0ID0gMCwgc29ydENvbHVtbiA9IFwiY3JlYXRlZEF0TXNcIiwgc29ydERpcmVjdGlvbiA9IFwiREVTQ1wifSA9IHt9KSB7XG4gICAgYXdhaXQgdGhpcy5lbnN1cmVSZWFkeSgpXG5cbiAgICBjb25zdCBjb2x1bW4gPSBTT1JUQUJMRV9DT0xVTU5TW3NvcnRDb2x1bW5dIHx8IFNPUlRBQkxFX0NPTFVNTlMuY3JlYXRlZEF0TXNcbiAgICBjb25zdCBkaXJlY3Rpb24gPSBzb3J0RGlyZWN0aW9uID09PSBcIkFTQ1wiID8gXCJBU0NcIiA6IFwiREVTQ1wiXG5cbiAgICByZXR1cm4gYXdhaXQgdGhpcy5fd2l0aERiKGFzeW5jIChkYikgPT4ge1xuICAgICAgbGV0IHF1ZXJ5ID0gZGIubmV3UXVlcnkoKS5mcm9tKEpPQlNfVEFCTEUpXG5cbiAgICAgIGlmIChzdGF0dXMpIHF1ZXJ5ID0gcXVlcnkud2hlcmUoe3N0YXR1c30pXG4gICAgICBpZiAoam9iTmFtZSkgcXVlcnkgPSBxdWVyeS53aGVyZSh7am9iX25hbWU6IGpvYk5hbWV9KVxuXG4gICAgICBxdWVyeSA9IHF1ZXJ5Lm9yZGVyKHtjb2x1bW4sIGRpcmVjdGlvbn0pXG4gICAgICBpZiAoY29sdW1uICE9PSBTT1JUQUJMRV9DT0xVTU5TLmNyZWF0ZWRBdE1zKSBxdWVyeSA9IHF1ZXJ5Lm9yZGVyKHtjb2x1bW46IFNPUlRBQkxFX0NPTFVNTlMuY3JlYXRlZEF0TXMsIGRpcmVjdGlvbjogXCJERVNDXCJ9KVxuXG4gICAgICBjb25zdCByb3dzID0gYXdhaXQgcXVlcnkubGltaXQobGltaXQpLm9mZnNldChvZmZzZXQpLnJlc3VsdHMoKVxuXG4gICAgICByZXR1cm4gcm93cy5tYXAoKHJvdykgPT4gdGhpcy5fbm9ybWFsaXplSm9iUm93KHJvdykpXG4gICAgfSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIG1hcmsgaGFuZGVkIG9mZi5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBPcHRpb25zLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gYXJncy5qb2JJZCAtIEpvYiBpZC5cbiAgICogQHBhcmFtIHtzdHJpbmd9IFthcmdzLmhhbmRvZmZJZF0gLSBDYWxsZXItc2VsZWN0ZWQgZXhhY3QgbGVhc2UgaWQuIEdlbmVyYXRlZCBmb3IgbGVnYWN5IGRpcmVjdCBjYWxsZXJzIHdoZW4gb21pdHRlZC5cbiAgICogQHBhcmFtIHtzdHJpbmd9IFthcmdzLndvcmtlcklkXSAtIFdvcmtlciBpZC5cbiAgICogQHJldHVybnMge1Byb21pc2U8aW1wb3J0KFwiLi90eXBlcy5qc1wiKS5CYWNrZ3JvdW5kSm9iSGFuZG9mZiB8IG51bGw+fSAtIENsYWltZWQgaGFuZG9mZiBsZWFzZSwgb3IgbnVsbCB3aGVuIG5vIGxvbmdlciBxdWV1ZWQuXG4gICAqL1xuICBhc3luYyBtYXJrSGFuZGVkT2ZmKHtqb2JJZCwgaGFuZG9mZklkID0gcmFuZG9tVVVJRCgpLCB3b3JrZXJJZH0pIHtcbiAgICBhd2FpdCB0aGlzLmVuc3VyZVJlYWR5KClcblxuICAgIGNvbnN0IGhhbmRlZE9mZkF0TXMgPSB0aGlzLmNsb2NrLm5vdygpXG5cbiAgICByZXR1cm4gYXdhaXQgdGhpcy5fc2VyaWFsaXplZENvdW50TXV0YXRpb24oYXN5bmMgKGRiKSA9PiB7XG4gICAgICBjb25zdCBzZWxlY3RlZEpvYiA9IGF3YWl0IHRoaXMuX2dldEpvYlJvd0J5SWQoZGIsIGpvYklkKVxuICAgICAgaWYgKCFzZWxlY3RlZEpvYiB8fCBzZWxlY3RlZEpvYi5zdGF0dXMgIT09IFwicXVldWVkXCIpIHJldHVybiBudWxsXG4gICAgICBjb25zdCBxdWV1ZWRKb2IgPSBhd2FpdCB0aGlzLl9yZWNvbmNpbGVRdWV1ZWRKb2JDb25jdXJyZW5jeShkYiwgc2VsZWN0ZWRKb2IpXG5cbiAgICAgIGlmICghcXVldWVkSm9iKSByZXR1cm4gbnVsbFxuICAgICAgaWYgKHF1ZXVlZEpvYi5jb25jdXJyZW5jeUtleSAmJiAhKGF3YWl0IHRoaXMuX3Jlc2VydmVDb25jdXJyZW5jeShkYiwgcXVldWVkSm9iLmNvbmN1cnJlbmN5S2V5KSkpIHJldHVybiBudWxsXG4gICAgICBjb25zdCBhZmZlY3RlZFJvd3MgPSBhd2FpdCB0aGlzLl91cGRhdGVBZmZlY3RlZFJvd3MoZGIsIHtcbiAgICAgICAgdGFibGVOYW1lOiBKT0JTX1RBQkxFLFxuICAgICAgICBkYXRhOiB7XG4gICAgICAgICAgc3RhdHVzOiBcImhhbmRlZF9vZmZcIixcbiAgICAgICAgICBoYW5kZWRfb2ZmX2F0X21zOiBoYW5kZWRPZmZBdE1zLFxuICAgICAgICAgIGhhbmRvZmZfaWQ6IGhhbmRvZmZJZCxcbiAgICAgICAgICB3b3JrZXJfaWQ6IHdvcmtlcklkIHx8IG51bGwsXG4gICAgICAgICAgLi4udGhpcy5fY2xlYXJlZENoaWxkQWNjZXB0YW5jZURhdGEoKVxuICAgICAgICB9LFxuICAgICAgICBjb25kaXRpb25zOiB7Y29uY3VycmVuY3lfa2V5OiBxdWV1ZWRKb2IuY29uY3VycmVuY3lLZXksIGlkOiBqb2JJZCwgc3RhdHVzOiBcInF1ZXVlZFwifVxuICAgICAgfSlcblxuICAgICAgaWYgKGFmZmVjdGVkUm93cyAhPT0gMSkge1xuICAgICAgICBhd2FpdCB0aGlzLl9yZWxlYXNlQ29uY3VycmVuY3koZGIsIHF1ZXVlZEpvYi5jb25jdXJyZW5jeUtleSlcbiAgICAgICAgcmV0dXJuIG51bGxcbiAgICAgIH1cblxuICAgICAgYXdhaXQgdGhpcy5fcmVjb3JkU3RhdHVzVHJhbnNpdGlvbihkYiwgXCJxdWV1ZWRcIiwgXCJoYW5kZWRfb2ZmXCIpXG4gICAgICAvKiogQHR5cGUge2ltcG9ydChcIi4vdHlwZXMuanNcIikuQmFja2dyb3VuZEpvYlJvd30gKi9cbiAgICAgIGNvbnN0IGhhbmRlZE9mZkpvYiA9IHtcbiAgICAgICAgLi4ucXVldWVkSm9iLFxuICAgICAgICAuLi50aGlzLl9jbGVhcmVkQ2hpbGRBY2NlcHRhbmNlUm93KCksXG4gICAgICAgIGhhbmRlZE9mZkF0TXMsXG4gICAgICAgIGhhbmRvZmZJZCxcbiAgICAgICAgc3RhdHVzOiBcImhhbmRlZF9vZmZcIixcbiAgICAgICAgd29ya2VySWQ6IHdvcmtlcklkIHx8IG51bGxcbiAgICAgIH1cblxuICAgICAgcmV0dXJuIHtoYW5kZWRPZmZBdE1zLCBoYW5kb2ZmSWQsIGpvYjogaGFuZGVkT2ZmSm9ifVxuICAgIH0pXG4gIH1cblxuICAvKipcbiAgICogUnVucyBtYXJrIGNvbXBsZXRlZC5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBPcHRpb25zLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gYXJncy5qb2JJZCAtIEpvYiBpZC5cbiAgICogQHBhcmFtIHtzdHJpbmd9IFthcmdzLmhhbmRvZmZJZF0gLSBIYW5kb2ZmIGxlYXNlIGlkLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gW2FyZ3Mud29ya2VySWRdIC0gV29ya2VyIGlkLlxuICAgKiBAcGFyYW0ge251bWJlcn0gW2FyZ3MuaGFuZGVkT2ZmQXRNc10gLSBIYW5kZWQgb2ZmIHRpbWVzdGFtcC5cbiAgICogQHJldHVybnMge1Byb21pc2U8Ym9vbGVhbj59IC0gV2hldGhlciB0aGUgZmVuY2VkIHJlcG9ydCB3YXMgYWNjZXB0ZWQuXG4gICAqL1xuICBhc3luYyBtYXJrQ29tcGxldGVkKHtqb2JJZCwgaGFuZG9mZklkLCB3b3JrZXJJZCwgaGFuZGVkT2ZmQXRNc30pIHtcbiAgICBhd2FpdCB0aGlzLmVuc3VyZVJlYWR5KClcblxuICAgIHJldHVybiBhd2FpdCB0aGlzLl9zZXJpYWxpemVkQ291bnRNdXRhdGlvbihhc3luYyAoZGIpID0+IHtcbiAgICAgIGNvbnN0IGpvYiA9IGF3YWl0IHRoaXMuX2dldEpvYlJvd0J5SWQoZGIsIGpvYklkKVxuXG4gICAgICBpZiAoIWpvYikgcmV0dXJuIGZhbHNlXG4gICAgICBpZiAoIXRoaXMuX3Nob3VsZEFjY2VwdFJlcG9ydCh7am9iLCBoYW5kb2ZmSWQsIHdvcmtlcklkLCBoYW5kZWRPZmZBdE1zfSkpIHJldHVybiBmYWxzZVxuXG4gICAgICBhd2FpdCB0aGlzLl9sb2NrQ29uY3VycmVuY3lSb3coZGIsIGpvYi5jb25jdXJyZW5jeUtleSlcbiAgICAgIGNvbnN0IGFmZmVjdGVkUm93cyA9IGF3YWl0IHRoaXMuX3VwZGF0ZUFmZmVjdGVkUm93cyhkYiwge1xuICAgICAgICB0YWJsZU5hbWU6IEpPQlNfVEFCTEUsXG4gICAgICAgIGRhdGE6IHtcbiAgICAgICAgICBzdGF0dXM6IFwiY29tcGxldGVkXCIsXG4gICAgICAgICAgY29tcGxldGVkX2F0X21zOiB0aGlzLmNsb2NrLm5vdygpXG4gICAgICAgIH0sXG4gICAgICAgIGNvbmRpdGlvbnM6IHRoaXMuX2FjdGl2ZUhhbmRvZmZDb25kaXRpb25zKGpvYilcbiAgICAgIH0pXG5cbiAgICAgIGlmIChhZmZlY3RlZFJvd3MgIT09IDEpIHJldHVybiBmYWxzZVxuICAgICAgYXdhaXQgdGhpcy5fcmVsZWFzZVNjaGVkdWxlT3duZXJzaGlwRm9ySm9iKGRiLCBqb2IpXG4gICAgICBhd2FpdCB0aGlzLl9yZWxlYXNlQ29uY3VycmVuY3koZGIsIGpvYi5jb25jdXJyZW5jeUtleSlcbiAgICAgIGF3YWl0IHRoaXMuX3JlY29yZFN0YXR1c1RyYW5zaXRpb24oZGIsIFwiaGFuZGVkX29mZlwiLCBcImNvbXBsZXRlZFwiKVxuICAgICAgcmV0dXJuIHRydWVcbiAgICB9KVxuICB9XG5cbiAgLyoqXG4gICAqIFJlY29yZHMgcG9vbGVkLWNoaWxkIGFjY2VwdGFuY2UgZXZpZGVuY2UgZm9yIGFuIGFjdGl2ZSBoYW5kb2ZmOiB3aGVuIHRoZVxuICAgKiBleGVjdXRpbmcgcnVubmVyIGNoaWxkIHJlY2VpdmVkIGFuZC9vciBzdGFydGVkIHRoZSBqb2IsIHBsdXMgdGhhdCBjaGlsZCdzXG4gICAqIHN0YWJsZSBpZGVudGl0eSBhbmQgcGlkLiBPbmx5IHRoZSBmaWVsZHMgc3VwcGxpZWQgYXJlIHdyaXR0ZW4sIHNvIGFcbiAgICogcmVjZWl2ZWQtdGhlbi1zdGFydGVkIG9ic2VydmF0aW9uIGxhbmRzIGFzIHR3byBmZW5jZWQgcGFydGlhbCB1cGRhdGVzLiBUaGVcbiAgICogdXBkYXRlIGlzIGZlbmNlZCBieSB0aGUgZXhhY3QgYWN0aXZlIGhhbmRvZmYgbGVhc2UsIHNvIGEgcmVwb3J0IGZvciBhXG4gICAqIHJlY2xhaW1lZCBvciByZS1oYW5kZWQtb2ZmIGpvYiBpcyBkcm9wcGVkIGluc3RlYWQgb2Ygc3RhbXBpbmcgdGhlIHdyb25nXG4gICAqIGF0dGVtcHQuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gT3B0aW9ucy5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGFyZ3Muam9iSWQgLSBKb2IgaWQuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBbYXJncy5oYW5kb2ZmSWRdIC0gSGFuZG9mZiBsZWFzZSBpZC5cbiAgICogQHBhcmFtIHtzdHJpbmd9IFthcmdzLndvcmtlcklkXSAtIFdvcmtlciBpZC5cbiAgICogQHBhcmFtIHtudW1iZXJ9IFthcmdzLmhhbmRlZE9mZkF0TXNdIC0gSGFuZGVkIG9mZiB0aW1lc3RhbXAuXG4gICAqIEBwYXJhbSB7bnVtYmVyfSBbYXJncy5yZWNlaXZlZEF0TXNdIC0gRXBvY2ggbXMgdGhlIHJ1bm5lciBjaGlsZCByZWNlaXZlZCB0aGUgam9iLlxuICAgKiBAcGFyYW0ge251bWJlcn0gW2FyZ3Muc3RhcnRlZEF0TXNdIC0gRXBvY2ggbXMgdGhlIGpvYidzIHBlcmZvcm0gc3RhcnRlZCBpbiB0aGUgY2hpbGQuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBbYXJncy5jaGlsZEluc3RhbmNlSWRdIC0gU3RhYmxlIHBvb2xlZCBjaGlsZCBpZGVudGl0eS5cbiAgICogQHBhcmFtIHtudW1iZXJ9IFthcmdzLmNoaWxkUGlkXSAtIFBvb2xlZCBjaGlsZCBPUyBwaWQuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPGJvb2xlYW4+fSAtIFdoZXRoZXIgdGhlIGZlbmNlZCByZXBvcnQgd2FzIGFjY2VwdGVkLlxuICAgKi9cbiAgYXN5bmMgbWFya0NoaWxkQWNjZXB0ZWQoe2pvYklkLCBoYW5kb2ZmSWQsIHdvcmtlcklkLCBoYW5kZWRPZmZBdE1zLCByZWNlaXZlZEF0TXMsIHN0YXJ0ZWRBdE1zLCBjaGlsZEluc3RhbmNlSWQsIGNoaWxkUGlkfSkge1xuICAgIGF3YWl0IHRoaXMuZW5zdXJlUmVhZHkoKVxuXG4gICAgcmV0dXJuIGF3YWl0IHRoaXMuX3NlcmlhbGl6ZWRDb25uZWN0aW9uTXV0YXRpb24oYXN5bmMgKGRiKSA9PiB7XG4gICAgICBjb25zdCBqb2IgPSBhd2FpdCB0aGlzLl9nZXRKb2JSb3dCeUlkKGRiLCBqb2JJZClcblxuICAgICAgaWYgKCFqb2IpIHJldHVybiBmYWxzZVxuICAgICAgaWYgKCF0aGlzLl9zaG91bGRBY2NlcHRSZXBvcnQoe2pvYiwgaGFuZG9mZklkLCB3b3JrZXJJZCwgaGFuZGVkT2ZmQXRNc30pKSByZXR1cm4gZmFsc2VcblxuICAgICAgY29uc3QgZGF0YSA9IHt9XG4gICAgICBpZiAodHlwZW9mIHJlY2VpdmVkQXRNcyA9PT0gXCJudW1iZXJcIikgZGF0YS5jaGlsZF9yZWNlaXZlZF9hdF9tcyA9IHJlY2VpdmVkQXRNc1xuICAgICAgaWYgKHR5cGVvZiBzdGFydGVkQXRNcyA9PT0gXCJudW1iZXJcIikgZGF0YS5jaGlsZF9zdGFydGVkX2F0X21zID0gc3RhcnRlZEF0TXNcbiAgICAgIGlmICh0eXBlb2YgY2hpbGRJbnN0YW5jZUlkID09PSBcInN0cmluZ1wiKSBkYXRhLmNoaWxkX2luc3RhbmNlX2lkID0gY2hpbGRJbnN0YW5jZUlkXG4gICAgICBpZiAodHlwZW9mIGNoaWxkUGlkID09PSBcIm51bWJlclwiKSBkYXRhLmNoaWxkX3BpZCA9IGNoaWxkUGlkXG4gICAgICBpZiAoT2JqZWN0LmtleXMoZGF0YSkubGVuZ3RoID09PSAwKSByZXR1cm4gZmFsc2VcblxuICAgICAgY29uc3QgYWZmZWN0ZWRSb3dzID0gYXdhaXQgdGhpcy5fdXBkYXRlQWZmZWN0ZWRSb3dzKGRiLCB7XG4gICAgICAgIHRhYmxlTmFtZTogSk9CU19UQUJMRSxcbiAgICAgICAgZGF0YSxcbiAgICAgICAgY29uZGl0aW9uczogdGhpcy5fYWN0aXZlSGFuZG9mZkNvbmRpdGlvbnMoam9iKVxuICAgICAgfSlcblxuICAgICAgcmV0dXJuIGFmZmVjdGVkUm93cyA9PT0gMVxuICAgIH0pXG4gIH1cblxuICAvKipcbiAgICogUmV0dXJucyB0aGUgZGF0YWJhc2UgZGF0YSB0aGF0IGNsZWFycyBwb29sZWQtY2hpbGQgYWNjZXB0YW5jZSBldmlkZW5jZS5cbiAgICogQHJldHVybnMge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gLSBDbGVhcmVkIGFjY2VwdGFuY2UgY29sdW1ucy5cbiAgICovXG4gIF9jbGVhcmVkQ2hpbGRBY2NlcHRhbmNlRGF0YSgpIHtcbiAgICByZXR1cm4ge2NoaWxkX2luc3RhbmNlX2lkOiBudWxsLCBjaGlsZF9waWQ6IG51bGwsIGNoaWxkX3JlY2VpdmVkX2F0X21zOiBudWxsLCBjaGlsZF9zdGFydGVkX2F0X21zOiBudWxsfVxuICB9XG5cbiAgLyoqXG4gICAqIFJldHVybnMgdGhlIHJvdy1zaGFwZSBjb3VudGVycGFydCBvZiB0aGUgY2xlYXJlZCBhY2NlcHRhbmNlIGNvbHVtbnMuXG4gICAqIEByZXR1cm5zIHtQaWNrPGltcG9ydChcIi4vdHlwZXMuanNcIikuQmFja2dyb3VuZEpvYlJvdywgXCJjaGlsZEluc3RhbmNlSWRcIiB8IFwiY2hpbGRQaWRcIiB8IFwiY2hpbGRSZWNlaXZlZEF0TXNcIiB8IFwiY2hpbGRTdGFydGVkQXRNc1wiPn0gLSBDbGVhcmVkIGFjY2VwdGFuY2UgZmllbGRzLlxuICAgKi9cbiAgX2NsZWFyZWRDaGlsZEFjY2VwdGFuY2VSb3coKSB7XG4gICAgcmV0dXJuIHtjaGlsZEluc3RhbmNlSWQ6IG51bGwsIGNoaWxkUGlkOiBudWxsLCBjaGlsZFJlY2VpdmVkQXRNczogbnVsbCwgY2hpbGRTdGFydGVkQXRNczogbnVsbH1cbiAgfVxuXG4gIC8qKlxuICAgKiBSZXR1cm5zIGFuIGFjdGl2ZSBoYW5kb2ZmIHRvIHRoZSBxdWV1ZSBhdCBhIGNhbGxlci1yZXF1ZXN0ZWQgZnV0dXJlIHRpbWUuXG4gICAqIFRoaXMgaXMgbm9ybWFsIGpvYiBjb250cm9sIGZsb3c6IGl0IHByZXNlcnZlcyBmYWlsdXJlIGF0dGVtcHRzIGFuZCBtZXRhZGF0YS5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBPcHRpb25zLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gYXJncy5qb2JJZCAtIEpvYiBpZC5cbiAgICogQHBhcmFtIHtudW1iZXJ9IGFyZ3MuZGVsYXlNcyAtIERlbGF5IGZyb20gcGVyc2lzdGVuY2UgdGltZSBpbiBtaWxsaXNlY29uZHMuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBbYXJncy5oYW5kb2ZmSWRdIC0gSGFuZG9mZiBsZWFzZSBpZC5cbiAgICogQHBhcmFtIHtzdHJpbmd9IFthcmdzLndvcmtlcklkXSAtIFdvcmtlciBpZC5cbiAgICogQHBhcmFtIHtudW1iZXJ9IFthcmdzLmhhbmRlZE9mZkF0TXNdIC0gSGFuZGVkIG9mZiB0aW1lc3RhbXAuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPGJvb2xlYW4+fSAtIFdoZXRoZXIgdGhlIGZlbmNlZCByZXBvcnQgd2FzIGFjY2VwdGVkLlxuICAgKi9cbiAgYXN5bmMgbWFya1Jlc2NoZWR1bGVkKHtqb2JJZCwgZGVsYXlNcywgaGFuZG9mZklkLCB3b3JrZXJJZCwgaGFuZGVkT2ZmQXRNc30pIHtcbiAgICBhd2FpdCB0aGlzLmVuc3VyZVJlYWR5KClcbiAgICB0aGlzLl92YWxpZGF0ZVJlc2NoZWR1bGVEZWxheU1zKGRlbGF5TXMpXG5cbiAgICByZXR1cm4gYXdhaXQgdGhpcy5fc2VyaWFsaXplZENvdW50TXV0YXRpb24oYXN5bmMgKGRiKSA9PiB7XG4gICAgICBjb25zdCBqb2IgPSBhd2FpdCB0aGlzLl9nZXRKb2JSb3dCeUlkKGRiLCBqb2JJZClcblxuICAgICAgaWYgKCFqb2IpIHJldHVybiBmYWxzZVxuICAgICAgaWYgKCF0aGlzLl9zaG91bGRBY2NlcHRSZXBvcnQoe2pvYiwgaGFuZG9mZklkLCB3b3JrZXJJZCwgaGFuZGVkT2ZmQXRNc30pKSByZXR1cm4gZmFsc2VcblxuICAgICAgYXdhaXQgdGhpcy5fbG9ja0NvbmN1cnJlbmN5Um93KGRiLCBqb2IuY29uY3VycmVuY3lLZXkpXG4gICAgICBjb25zdCBzY2hlZHVsZWRBdE1zID0gdGhpcy5fcmVzY2hlZHVsZWRBdE1zKGRlbGF5TXMpXG4gICAgICBjb25zdCBhZmZlY3RlZFJvd3MgPSBhd2FpdCB0aGlzLl91cGRhdGVBZmZlY3RlZFJvd3MoZGIsIHtcbiAgICAgICAgdGFibGVOYW1lOiBKT0JTX1RBQkxFLFxuICAgICAgICBkYXRhOiB7XG4gICAgICAgICAgc3RhdHVzOiBcInF1ZXVlZFwiLFxuICAgICAgICAgIHNjaGVkdWxlZF9hdF9tczogc2NoZWR1bGVkQXRNcyxcbiAgICAgICAgICBoYW5kZWRfb2ZmX2F0X21zOiBudWxsLFxuICAgICAgICAgIGhhbmRvZmZfaWQ6IG51bGwsXG4gICAgICAgICAgd29ya2VyX2lkOiBudWxsLFxuICAgICAgICAgIC4uLnRoaXMuX2NsZWFyZWRDaGlsZEFjY2VwdGFuY2VEYXRhKClcbiAgICAgICAgfSxcbiAgICAgICAgY29uZGl0aW9uczogdGhpcy5fYWN0aXZlSGFuZG9mZkNvbmRpdGlvbnMoam9iKVxuICAgICAgfSlcblxuICAgICAgaWYgKGFmZmVjdGVkUm93cyAhPT0gMSkgcmV0dXJuIGZhbHNlXG4gICAgICBhd2FpdCB0aGlzLl9yZWxlYXNlQ29uY3VycmVuY3koZGIsIGpvYi5jb25jdXJyZW5jeUtleSlcbiAgICAgIGF3YWl0IHRoaXMuX3JlY29yZFN0YXR1c1RyYW5zaXRpb24oZGIsIFwiaGFuZGVkX29mZlwiLCBcInF1ZXVlZFwiKVxuICAgICAgcmV0dXJuIHRydWVcbiAgICB9KVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgbWFyayByZXR1cm5lZCB0byBxdWV1ZS5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBPcHRpb25zLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gYXJncy5qb2JJZCAtIEpvYiBpZC5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGFyZ3MuaGFuZG9mZklkIC0gSGFuZG9mZiBsZWFzZSBpZC5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgd2hlbiB1cGRhdGVkLlxuICAgKi9cbiAgYXN5bmMgbWFya1JldHVybmVkVG9RdWV1ZSh7am9iSWQsIGhhbmRvZmZJZH0pIHtcbiAgICBhd2FpdCB0aGlzLmVuc3VyZVJlYWR5KClcblxuICAgIGF3YWl0IHRoaXMuX3NlcmlhbGl6ZWRDb3VudE11dGF0aW9uKGFzeW5jIChkYikgPT4ge1xuICAgICAgY29uc3Qgam9iID0gYXdhaXQgdGhpcy5fZ2V0Sm9iUm93QnlJZChkYiwgam9iSWQpXG4gICAgICBpZiAoIWpvYiB8fCBqb2IuaGFuZG9mZklkICE9PSBoYW5kb2ZmSWQgfHwgam9iLnN0YXR1cyAhPT0gXCJoYW5kZWRfb2ZmXCIpIHJldHVyblxuICAgICAgYXdhaXQgdGhpcy5fbG9ja0NvbmN1cnJlbmN5Um93KGRiLCBqb2IuY29uY3VycmVuY3lLZXkpXG4gICAgICBjb25zdCBhZmZlY3RlZFJvd3MgPSBhd2FpdCB0aGlzLl91cGRhdGVBZmZlY3RlZFJvd3MoZGIsIHtcbiAgICAgICAgdGFibGVOYW1lOiBKT0JTX1RBQkxFLFxuICAgICAgICBkYXRhOiB7XG4gICAgICAgICAgc3RhdHVzOiBcInF1ZXVlZFwiLFxuICAgICAgICAgIHNjaGVkdWxlZF9hdF9tczogdGhpcy5jbG9jay5ub3coKSxcbiAgICAgICAgICBoYW5kZWRfb2ZmX2F0X21zOiBudWxsLFxuICAgICAgICAgIGhhbmRvZmZfaWQ6IG51bGwsXG4gICAgICAgICAgd29ya2VyX2lkOiBudWxsLFxuICAgICAgICAgIC4uLnRoaXMuX2NsZWFyZWRDaGlsZEFjY2VwdGFuY2VEYXRhKClcbiAgICAgICAgfSxcbiAgICAgICAgY29uZGl0aW9uczoge2hhbmRvZmZfaWQ6IGhhbmRvZmZJZCwgaWQ6IGpvYklkLCBzdGF0dXM6IFwiaGFuZGVkX29mZlwifVxuICAgICAgfSlcbiAgICAgIGlmIChhZmZlY3RlZFJvd3MgPT09IDEpIHtcbiAgICAgICAgYXdhaXQgdGhpcy5fcmVsZWFzZUNvbmN1cnJlbmN5KGRiLCBqb2IuY29uY3VycmVuY3lLZXkpXG4gICAgICAgIGF3YWl0IHRoaXMuX3JlY29yZFN0YXR1c1RyYW5zaXRpb24oZGIsIFwiaGFuZGVkX29mZlwiLCBcInF1ZXVlZFwiKVxuICAgICAgfVxuICAgIH0pXG4gIH1cblxuICAvKipcbiAgICogUmV0dXJucyB0aGUgYWN0aXZlIGBoYW5kZWRfb2ZmYCBqb2JzIChqb2JJZCArIGhhbmRvZmZJZCkgaGVsZCB1bmRlciBhIHdvcmtlclxuICAgKiBpZC4gVXNlZCBvbiB3b3JrZXIgcmVjb25uZWN0OiBhZnRlciBhIG1haW4gcmVzdGFydCBhIHdvcmtlciByZWNvbm5lY3RzIHdpdGhcbiAgICogaXRzIHN0YWJsZSBpZCwgYW5kIHRoZSBmcmVzaCBtYWluIGFkb3B0cyB0aGVzZSBsZWFzZXMgc28gdGhleSBhcmUgdHJhY2tlZCDigJRcbiAgICogYW5kIHJlbGVhc2VkIGlmIHRoZSByZWNvbm5lY3RlZCB3b3JrZXIgbGF0ZXIgZGlzY29ubmVjdHMg4oCUIGluc3RlYWQgb2ZcbiAgICogc2l0dGluZyBzdHVjayB1bnRpbCB0aGUgYWdlLWJhc2VkIG9ycGhhbiBzd2VlcC4gVGhpcyBuZXZlciByZWNsYWltcywgc28gYVxuICAgKiBncmFjZWZ1bGx5LWRyYWluaW5nIHdvcmtlciB0aGF0IGtlZXBzIHJ1bm5pbmcgaXRzIGluLWZsaWdodCBqb2JzIGlzIGxlZnRcbiAgICogdW50b3VjaGVkLiBSb3dzIHdpdGggYSBudWxsIGhhbmRvZmYgaWQgKGxlZ2FjeSkgYXJlIHNraXBwZWQ7IHRoZSBvcnBoYW5cbiAgICogc3dlZXAgcmVjbGFpbXMgdGhvc2UgdmlhIGl0cyBgaGFuZGVkX29mZl9hdF9tc2AgZmVuY2UuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gT3B0aW9ucy5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGFyZ3Mud29ya2VySWQgLSBXb3JrZXIgaWQuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPEFycmF5PHtqb2JJZDogc3RyaW5nLCBoYW5kb2ZmSWQ6IHN0cmluZ30+Pn0gLSBBY3RpdmUgaGFuZG9mZnMuXG4gICAqL1xuICBhc3luYyBoYW5kZWRPZmZKb2JzRm9yV29ya2VyKHt3b3JrZXJJZH0pIHtcbiAgICBhd2FpdCB0aGlzLmVuc3VyZVJlYWR5KClcblxuICAgIGNvbnN0IHJvd3MgPSBhd2FpdCB0aGlzLl93aXRoRGIoYXN5bmMgKGRiKSA9PlxuICAgICAgYXdhaXQgZGIubmV3UXVlcnkoKS5mcm9tKEpPQlNfVEFCTEUpLndoZXJlKHtzdGF0dXM6IFwiaGFuZGVkX29mZlwiLCB3b3JrZXJfaWQ6IHdvcmtlcklkfSkucmVzdWx0cygpXG4gICAgKVxuXG4gICAgLyoqIEB0eXBlIHtBcnJheTx7am9iSWQ6IHN0cmluZywgaGFuZG9mZklkOiBzdHJpbmd9Pn0gKi9cbiAgICBjb25zdCBoYW5kb2ZmcyA9IFtdXG5cbiAgICBmb3IgKGNvbnN0IHJvdyBvZiByb3dzKSB7XG4gICAgICBjb25zdCBqb2IgPSB0aGlzLl9ub3JtYWxpemVKb2JSb3cocm93KVxuXG4gICAgICBpZiAoam9iLmhhbmRvZmZJZCkgaGFuZG9mZnMucHVzaCh7am9iSWQ6IGpvYi5pZCwgaGFuZG9mZklkOiBqb2IuaGFuZG9mZklkfSlcbiAgICB9XG5cbiAgICByZXR1cm4gaGFuZG9mZnNcbiAgfVxuXG4gIC8qKlxuICAgKiBTbmFwc2hvdHMgZXhhY3QsIGxlYXNlLWF3YXJlIGFjdGl2ZSBoYW5kb2ZmcyBiZWZvcmUgYSBuZXcgbWFpbiBnZW5lcmF0aW9uXG4gICAqIHN0YXJ0cyBhY2NlcHRpbmcgd29ya2VyIHJlY29ubmVjdHMuIExlZ2FjeSByb3dzIHdpdGhvdXQgYSBjb21wbGV0ZSB3b3JrZXIsXG4gICAqIGxlYXNlLCBhbmQgdGltZXN0YW1wIGlkZW50aXR5IHN0YXkgb3duZWQgYnkgdGhlIGFnZS1iYXNlZCBvcnBoYW4gc3dlZXAuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPGltcG9ydChcIi4vdHlwZXMuanNcIikuQmFja2dyb3VuZEpvYkhhbmRvZmZTbmFwc2hvdFtdPn0gLSBFeGFjdCBzdGFydHVwIGhhbmRvZmZzLlxuICAgKi9cbiAgYXN5bmMgc25hcHNob3RIYW5kZWRPZmZKb2JzKCkge1xuICAgIGF3YWl0IHRoaXMuZW5zdXJlUmVhZHkoKVxuXG4gICAgY29uc3Qgcm93cyA9IGF3YWl0IHRoaXMuX3dpdGhEYihhc3luYyAoZGIpID0+IGF3YWl0IGRiXG4gICAgICAubmV3UXVlcnkoKVxuICAgICAgLmZyb20oSk9CU19UQUJMRSlcbiAgICAgIC53aGVyZSh7c3RhdHVzOiBcImhhbmRlZF9vZmZcIn0pXG4gICAgICAub3JkZXIoXCJjcmVhdGVkX2F0X21zIEFTQ1wiKVxuICAgICAgLm9yZGVyKFwiaWQgQVNDXCIpXG4gICAgICAucmVzdWx0cygpKVxuICAgIC8qKiBAdHlwZSB7aW1wb3J0KFwiLi90eXBlcy5qc1wiKS5CYWNrZ3JvdW5kSm9iSGFuZG9mZlNuYXBzaG90W119ICovXG4gICAgY29uc3QgaGFuZG9mZnMgPSBbXVxuXG4gICAgZm9yIChjb25zdCByb3cgb2Ygcm93cykge1xuICAgICAgY29uc3Qgam9iID0gdGhpcy5fbm9ybWFsaXplSm9iUm93KHJvdylcblxuICAgICAgaWYgKCFqb2IuaGFuZG9mZklkIHx8ICFqb2Iud29ya2VySWQgfHwgdHlwZW9mIGpvYi5oYW5kZWRPZmZBdE1zICE9PSBcIm51bWJlclwiKSBjb250aW51ZVxuXG4gICAgICBoYW5kb2Zmcy5wdXNoKHtcbiAgICAgICAgaGFuZGVkT2ZmQXRNczogam9iLmhhbmRlZE9mZkF0TXMsXG4gICAgICAgIGhhbmRvZmZJZDogam9iLmhhbmRvZmZJZCxcbiAgICAgICAgam9iSWQ6IGpvYi5pZCxcbiAgICAgICAgd29ya2VySWQ6IGpvYi53b3JrZXJJZFxuICAgICAgfSlcbiAgICB9XG5cbiAgICByZXR1cm4gaGFuZG9mZnNcbiAgfVxuXG4gIC8qKlxuICAgKiBSZWNsYWltcyBvbmx5IHVuY2hhbmdlZCBleGFjdCBoYW5kb2ZmcyBzZWxlY3RlZCBieSBhIG1haW4tZ2VuZXJhdGlvbiBzdGFydHVwXG4gICAqIHNuYXBzaG90LiBUaGUgb3JkaW5hcnkgb3JwaGFuIGZhaWx1cmUgcGF0aCBvd25zIHJldHJpZXMsIHRlcm1pbmFsIHN0YXR1cyxcbiAgICogY291bnQgdHJhbnNpdGlvbnMsIHNjaGVkdWxlIG93bmVyc2hpcCwgYW5kIGNvbmN1cnJlbmN5IHJlbGVhc2UuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gT3B0aW9ucy5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL3R5cGVzLmpzXCIpLkJhY2tncm91bmRKb2JIYW5kb2ZmU25hcHNob3RbXX0gYXJncy5oYW5kb2ZmcyAtIEV4YWN0IHN0YXJ0dXAgc25hcHNob3RzLlxuICAgKiBAcGFyYW0ge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSBhcmdzLmVycm9yIC0gT3JwaGFuIHJlYXNvbi5cbiAgICogQHJldHVybnMge1Byb21pc2U8aW1wb3J0KFwiLi90eXBlcy5qc1wiKS5CYWNrZ3JvdW5kSm9iUm93W10+fSAtIEFjY2VwdGVkIHRyYW5zaXRpb25zLlxuICAgKi9cbiAgYXN5bmMgbWFya09ycGhhbmVkSGFuZG9mZnMoe2hhbmRvZmZzLCBlcnJvcn0pIHtcbiAgICBhd2FpdCB0aGlzLmVuc3VyZVJlYWR5KClcblxuICAgIHJldHVybiBhd2FpdCB0aGlzLl9zZXJpYWxpemVkQ291bnRNdXRhdGlvbihhc3luYyAoZGIpID0+IHtcbiAgICAgIC8qKiBAdHlwZSB7QmFja2dyb3VuZEpvYk9ycGhhblNlbGVjdGlvbltdfSAqL1xuICAgICAgY29uc3Qgc2VsZWN0aW9ucyA9IFtdXG5cbiAgICAgIGZvciAoY29uc3QgaGFuZG9mZiBvZiBoYW5kb2Zmcykge1xuICAgICAgICBjb25zdCBqb2IgPSBhd2FpdCB0aGlzLl9nZXRKb2JSb3dCeUlkKGRiLCBoYW5kb2ZmLmpvYklkKVxuXG4gICAgICAgIGlmICgham9iIHx8IGpvYi5zdGF0dXMgIT09IFwiaGFuZGVkX29mZlwiKSBjb250aW51ZVxuICAgICAgICBpZiAoam9iLmhhbmRvZmZJZCAhPT0gaGFuZG9mZi5oYW5kb2ZmSWQpIGNvbnRpbnVlXG4gICAgICAgIGlmIChqb2Iud29ya2VySWQgIT09IGhhbmRvZmYud29ya2VySWQpIGNvbnRpbnVlXG4gICAgICAgIGlmIChqb2IuaGFuZGVkT2ZmQXRNcyAhPT0gaGFuZG9mZi5oYW5kZWRPZmZBdE1zKSBjb250aW51ZVxuXG4gICAgICAgIHNlbGVjdGlvbnMucHVzaCh7XG4gICAgICAgICAgY29uZGl0aW9uczoge1xuICAgICAgICAgICAgaGFuZGVkX29mZl9hdF9tczogaGFuZG9mZi5oYW5kZWRPZmZBdE1zLFxuICAgICAgICAgICAgaGFuZG9mZl9pZDogaGFuZG9mZi5oYW5kb2ZmSWQsXG4gICAgICAgICAgICBpZDogaGFuZG9mZi5qb2JJZCxcbiAgICAgICAgICAgIHN0YXR1czogXCJoYW5kZWRfb2ZmXCIsXG4gICAgICAgICAgICB3b3JrZXJfaWQ6IGhhbmRvZmYud29ya2VySWRcbiAgICAgICAgICB9LFxuICAgICAgICAgIGpvYlxuICAgICAgICB9KVxuICAgICAgfVxuXG4gICAgICByZXR1cm4gYXdhaXQgdGhpcy5fbWFya09ycGhhblNlbGVjdGlvbnMoe2RiLCBlcnJvciwgc2VsZWN0aW9uc30pXG4gICAgfSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIG1hcmsgZmFpbGVkLlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIE9wdGlvbnMuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBhcmdzLmpvYklkIC0gSm9iIGlkLlxuICAgKiBAcGFyYW0ge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSBhcmdzLmVycm9yIC0gRXJyb3IuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBbYXJncy5oYW5kb2ZmSWRdIC0gSGFuZG9mZiBsZWFzZSBpZC5cbiAgICogQHBhcmFtIHtzdHJpbmd9IFthcmdzLndvcmtlcklkXSAtIFdvcmtlciBpZC5cbiAgICogQHBhcmFtIHtudW1iZXJ9IFthcmdzLmhhbmRlZE9mZkF0TXNdIC0gSGFuZGVkIG9mZiB0aW1lc3RhbXAuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPGltcG9ydChcIi4vdHlwZXMuanNcIikuQmFja2dyb3VuZEpvYlJvdyB8IG51bGw+fSAtIFVwZGF0ZWQgam9iIHJvdyB3aGVuIHRoZSByZXBvcnQgd2FzIGFjY2VwdGVkLlxuICAgKi9cbiAgYXN5bmMgbWFya0ZhaWxlZCh7am9iSWQsIGVycm9yLCBoYW5kb2ZmSWQsIHdvcmtlcklkLCBoYW5kZWRPZmZBdE1zfSkge1xuICAgIGF3YWl0IHRoaXMuZW5zdXJlUmVhZHkoKVxuXG4gICAgcmV0dXJuIGF3YWl0IHRoaXMuX3NlcmlhbGl6ZWRDb3VudE11dGF0aW9uKGFzeW5jIChkYikgPT4ge1xuICAgICAgY29uc3Qgam9iID0gYXdhaXQgdGhpcy5fZ2V0Sm9iUm93QnlJZChkYiwgam9iSWQpXG5cbiAgICAgIGlmICgham9iKSByZXR1cm4gbnVsbFxuICAgICAgaWYgKCF0aGlzLl9zaG91bGRBY2NlcHRSZXBvcnQoe2pvYiwgaGFuZG9mZklkLCB3b3JrZXJJZCwgaGFuZGVkT2ZmQXRNc30pKSByZXR1cm4gbnVsbFxuXG4gICAgICBjb25zdCB1cGRhdGVkSm9iID0gYXdhaXQgdGhpcy5fYXBwbHlGYWlsdXJlKHtkYiwgam9iLCBlcnJvciwgbWFya09ycGhhbmVkOiBmYWxzZX0pXG5cbiAgICAgIGlmICh1cGRhdGVkSm9iKSBhd2FpdCB0aGlzLl9yZWNvcmRTdGF0dXNUcmFuc2l0aW9uKGRiLCBqb2Iuc3RhdHVzLCB1cGRhdGVkSm9iLnN0YXR1cylcbiAgICAgIHJldHVybiB1cGRhdGVkSm9iXG4gICAgfSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIG1hcmsgb3JwaGFuZWQgam9icy5cbiAgICogQHBhcmFtIHtvYmplY3R9IFthcmdzXSAtIE9wdGlvbnMuXG4gICAqIEBwYXJhbSB7bnVtYmVyfSBbYXJncy5vcnBoYW5lZEFmdGVyTXNdIC0gTWFyayBqb2JzIG9ycGhhbmVkIGFmdGVyIHRoaXMgZHVyYXRpb24uXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPGltcG9ydChcIi4vdHlwZXMuanNcIikuQmFja2dyb3VuZEpvYlJvd1tdPn0gLSBUaGUgam9icyB0aGlzIHN3ZWVwIG1hcmtlZCBvcnBoYW5lZC5cbiAgICovXG4gIGFzeW5jIG1hcmtPcnBoYW5lZEpvYnMoe29ycGhhbmVkQWZ0ZXJNcyA9IE9SUEhBTkVEX0FGVEVSX01TfSA9IHt9KSB7XG4gICAgYXdhaXQgdGhpcy5lbnN1cmVSZWFkeSgpXG5cbiAgICByZXR1cm4gYXdhaXQgdGhpcy5fc2VyaWFsaXplZENvdW50TXV0YXRpb24oYXN5bmMgKGRiKSA9PiB7XG4gICAgICBjb25zdCBjdXRvZmYgPSB0aGlzLmNsb2NrLm5vdygpIC0gb3JwaGFuZWRBZnRlck1zXG4gICAgICBjb25zdCBxdWVyeSA9IGRiXG4gICAgICAgIC5uZXdRdWVyeSgpXG4gICAgICAgIC5mcm9tKEpPQlNfVEFCTEUpXG4gICAgICAgIC53aGVyZSh7c3RhdHVzOiBcImhhbmRlZF9vZmZcIn0pXG4gICAgICAgIC53aGVyZShgaGFuZGVkX29mZl9hdF9tcyA8PSAke2RiLnF1b3RlKGN1dG9mZil9YClcblxuICAgICAgY29uc3Qgcm93cyA9IGF3YWl0IHF1ZXJ5LnJlc3VsdHMoKVxuXG4gICAgICAvKiogQHR5cGUge0JhY2tncm91bmRKb2JPcnBoYW5TZWxlY3Rpb25bXX0gKi9cbiAgICAgIGNvbnN0IHNlbGVjdGlvbnMgPSBbXVxuXG4gICAgICBmb3IgKGNvbnN0IHJvdyBvZiByb3dzKSB7XG4gICAgICAgIGNvbnN0IGpvYiA9IHRoaXMuX25vcm1hbGl6ZUpvYlJvdyhyb3cpXG5cbiAgICAgICAgLy8gRmVuY2UgdGhlIHJlY2xhaW0gb24gdGhlIGV4YWN0IGhhbmRvZmYgdGhpcyBzd2VlcCBzZWxlY3RlZCwgdXNpbmcgaXRzXG4gICAgICAgIC8vIGBoYW5kZWRfb2ZmX2F0X21zYCByYXRoZXIgdGhhbiBpdHMgYGhhbmRvZmZfaWRgLiBUd28gcmVhc29uczpcbiAgICAgICAgLy8gICAxLiBOdWxsLXNhZmUuIFNvbWUgcm93cyBoYXZlIGEgbnVsbCBgaGFuZG9mZl9pZGAgKGhhbmRlZCBvZmYgYnkgYW5cbiAgICAgICAgLy8gICAgICBvbGRlciB2ZWxvY2lvdXMgYmVmb3JlIGhhbmRvZmYtaWQgZmVuY2luZykuIGB7aGFuZG9mZl9pZDogbnVsbH1gXG4gICAgICAgIC8vICAgICAgcmVuZGVycyBhcyBgaGFuZG9mZl9pZCA9IE5VTExgLCB3aGljaCBtYXRjaGVzIG5vdGhpbmcsIHNvIHRob3NlXG4gICAgICAgIC8vICAgICAgcm93cyB3b3VsZCBiZSBzdHJhbmRlZCBpbiBgaGFuZGVkX29mZmAgZm9yZXZlci5cbiAgICAgICAgLy8gICAyLiBSYWNlLXNhZmUuIElmIHRoZSByb3cgaXMgcmV0dXJuZWQgdG8gdGhlIHF1ZXVlIGFuZCByZS1oYW5kZWQtb2ZmXG4gICAgICAgIC8vICAgICAgYmV0d2VlbiB0aGUgU0VMRUNUIGFib3ZlIGFuZCB0aGlzIHVwZGF0ZSwgaXQgZ2V0cyBhIGZyZXNoXG4gICAgICAgIC8vICAgICAgYGhhbmRlZF9vZmZfYXRfbXNgIChhbHdheXMgXCJub3dcIiksIHNvIHRoaXMgc3RhbGUgY3V0b2ZmLWVyYVxuICAgICAgICAvLyAgICAgIHRpbWVzdGFtcCBubyBsb25nZXIgbWF0Y2hlcyBhbmQgd2Ugd29uJ3QgZmFpbC9vcnBoYW4g4oCUIG9yXG4gICAgICAgIC8vICAgICAgd3JvbmdseSByZWxlYXNlIHRoZSBjb25jdXJyZW5jeSByZXNlcnZhdGlvbiBvZiDigJQgdGhhdCBuZXcgbGVhc2UuXG4gICAgICAgIC8vIGBoYW5kZWRfb2ZmX2F0X21zYCBpcyBhbHdheXMgc2V0IG9uIGEgaGFuZGVkLW9mZiByb3cgKGFuZCB0aGUgU0VMRUNUXG4gICAgICAgIC8vIHJlcXVpcmVkIGl0IGA8PSBjdXRvZmZgKSwgc28gaXQgaXMgYSByZWxpYWJsZSBudWxsLXNhZmUgbGVhc2UgcGluLlxuICAgICAgICBzZWxlY3Rpb25zLnB1c2goe1xuICAgICAgICAgIGNvbmRpdGlvbnM6IHtpZDogam9iLmlkLCBzdGF0dXM6IFwiaGFuZGVkX29mZlwiLCBoYW5kZWRfb2ZmX2F0X21zOiBqb2IuaGFuZGVkT2ZmQXRNc30sXG4gICAgICAgICAgam9iXG4gICAgICAgIH0pXG4gICAgICB9XG5cbiAgICAgIHJldHVybiBhd2FpdCB0aGlzLl9tYXJrT3JwaGFuU2VsZWN0aW9ucyh7XG4gICAgICAgIGRiLFxuICAgICAgICBlcnJvcjogXCJKb2Igb3JwaGFuZWQgYWZ0ZXIgdGltZW91dFwiLFxuICAgICAgICBzZWxlY3Rpb25zXG4gICAgICB9KVxuICAgIH0pXG4gIH1cblxuICAvKipcbiAgICogQXBwbGllcyB0aGUgY29tbW9uIGZlbmNlZCBvcnBoYW4gdHJhbnNpdGlvbiBhbmQgcmVjb3JkcyBvbmUgYWdncmVnYXRlIGNvdW50XG4gICAqIGRlbHRhIGZvciB0aGUgYWNjZXB0ZWQgcm93cy5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBPcHRpb25zLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL2RhdGFiYXNlL2RyaXZlcnMvYmFzZS5qc1wiKS5kZWZhdWx0fSBhcmdzLmRiIC0gVHJhbnNhY3Rpb24gY29ubmVjdGlvbi5cbiAgICogQHBhcmFtIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gYXJncy5lcnJvciAtIE9ycGhhbiByZWFzb24uXG4gICAqIEBwYXJhbSB7QmFja2dyb3VuZEpvYk9ycGhhblNlbGVjdGlvbltdfSBhcmdzLnNlbGVjdGlvbnMgLSBTZWxlY3RlZCBoYW5kb2ZmcyBhbmQgZXhhY3QgZmVuY2VzLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxpbXBvcnQoXCIuL3R5cGVzLmpzXCIpLkJhY2tncm91bmRKb2JSb3dbXT59IC0gQWNjZXB0ZWQgdHJhbnNpdGlvbnMuXG4gICAqL1xuICBhc3luYyBfbWFya09ycGhhblNlbGVjdGlvbnMoe2RiLCBlcnJvciwgc2VsZWN0aW9uc30pIHtcbiAgICAvKiogQHR5cGUge2ltcG9ydChcIi4vdHlwZXMuanNcIikuQmFja2dyb3VuZEpvYlJvd1tdfSAqL1xuICAgIGNvbnN0IG9ycGhhbmVkSm9icyA9IFtdXG5cbiAgICBmb3IgKGNvbnN0IHtjb25kaXRpb25zLCBqb2J9IG9mIHNlbGVjdGlvbnMpIHtcbiAgICAgIGNvbnN0IG9ycGhhbmVkSm9iID0gYXdhaXQgdGhpcy5fYXBwbHlGYWlsdXJlKHtcbiAgICAgICAgY29uZGl0aW9ucyxcbiAgICAgICAgZGIsXG4gICAgICAgIGVycm9yLFxuICAgICAgICBqb2IsXG4gICAgICAgIG1hcmtPcnBoYW5lZDogdHJ1ZVxuICAgICAgfSlcblxuICAgICAgaWYgKG9ycGhhbmVkSm9iKSBvcnBoYW5lZEpvYnMucHVzaChvcnBoYW5lZEpvYilcbiAgICB9XG5cbiAgICBjb25zdCBzdGF0dXNDb3VudHMgPSB0aGlzLl9zdGF0dXNDb3VudHMob3JwaGFuZWRKb2JzKVxuICAgIGNvbnN0IGRlbHRhcyA9IHRoaXMuX2VtcHR5Q291bnRCdWNrZXRzKClcblxuICAgIGZvciAoY29uc3QgW3N0YXR1cywgY291bnRdIG9mIE9iamVjdC5lbnRyaWVzKHN0YXR1c0NvdW50cykpIHtcbiAgICAgIGRlbHRhcy5oYW5kZWRfb2ZmIC09IGNvdW50XG4gICAgICBkZWx0YXNbc3RhdHVzXSArPSBjb3VudFxuICAgIH1cbiAgICBhd2FpdCB0aGlzLl9yZWNvcmRDb3VudERlbHRhKGRiLCBkZWx0YXMpXG5cbiAgICByZXR1cm4gb3JwaGFuZWRKb2JzXG4gIH1cblxuICAvKipcbiAgICogRGVsZXRlcyB0ZXJtaW5hbCBqb2Igcm93cyBwYXN0IHRoZWlyIHJldGVudGlvbiB3aW5kb3cgc28gdGhlIGpvYnMgdGFibGVcbiAgICogZG9lcyBub3QgZ3JvdyB1bmJvdW5kZWQgKGNvbXBsZXRlZCByb3dzIGluIHBhcnRpY3VsYXIgYWNjdW11bGF0ZSBmb3JldmVyXG4gICAqIG90aGVyd2lzZSkuIEJhdGNoZWQgYnkgaWQg4oCUIFNFTEVDVCBhIHBhZ2Ugb2YgaWRzLCB0aGVuXG4gICAqIGBERUxFVEUgLi4uIFdIRVJFIGlkIElOICguLi4pYCDigJQgcmF0aGVyIHRoYW4gYERFTEVURSAuLi4gTElNSVRgLCB3aGljaCBub3RcbiAgICogZXZlcnkgZHJpdmVyIHN1cHBvcnRzOyBlYWNoIGJhdGNoIHJ1bnMgb24gaXRzIG93biBjb25uZWN0aW9uIHNvIHRoZSBzd2VlcFxuICAgKiB5aWVsZHMgYmV0d2VlbiBiYXRjaGVzIGluc3RlYWQgb2YgaG9sZGluZyBvbmUgbG9uZyB0cmFuc2FjdGlvbi5cbiAgICogQHBhcmFtIHtvYmplY3R9IFthcmdzXSAtIE9wdGlvbnMuXG4gICAqIEBwYXJhbSB7bnVtYmVyIHwgbnVsbH0gW2FyZ3MuY29tcGxldGVkVHRsTXNdIC0gRGVsZXRlIGBjb21wbGV0ZWRgIGpvYnMgd2hvc2UgYGNvbXBsZXRlZF9hdF9tc2AgaXMgb2xkZXIgdGhhbiB0aGlzIG1hbnkgbXMuIEZhbHN5IG9yIGA8PSAwYCBkaXNhYmxlcyBjb21wbGV0ZWQgcHJ1bmluZy5cbiAgICogQHBhcmFtIHtudW1iZXIgfCBudWxsfSBbYXJncy5mYWlsZWRUdGxNc10gLSBEZWxldGUgdGVybWluYWwgYGZhaWxlZGAvYG9ycGhhbmVkYCBqb2JzIG9sZGVyIHRoYW4gdGhpcyBtYW55IG1zIChieSBgZmFpbGVkX2F0X21zYC9gb3JwaGFuZWRfYXRfbXNgKS4gRmFsc3kgb3IgYDw9IDBgIGRpc2FibGVzLlxuICAgKiBAcGFyYW0ge251bWJlcn0gW2FyZ3MuYmF0Y2hTaXplXSAtIE1heCByb3dzIGRlbGV0ZWQgcGVyIGJhdGNoLiBEZWZhdWx0IGAxMDAwYC5cbiAgICogQHJldHVybnMge1Byb21pc2U8bnVtYmVyPn0gLSBUb3RhbCByb3dzIGRlbGV0ZWQuXG4gICAqL1xuICBhc3luYyBwcnVuZVRlcm1pbmFsSm9icyh7Y29tcGxldGVkVHRsTXMgPSBudWxsLCBmYWlsZWRUdGxNcyA9IG51bGwsIGJhdGNoU2l6ZSA9IDEwMDB9ID0ge30pIHtcbiAgICBhd2FpdCB0aGlzLmVuc3VyZVJlYWR5KClcblxuICAgIGNvbnN0IG5vdyA9IHRoaXMuY2xvY2subm93KClcbiAgICBjb25zdCBzaXplID0gYmF0Y2hTaXplID4gMCA/IGJhdGNoU2l6ZSA6IDEwMDBcbiAgICBsZXQgZGVsZXRlZCA9IDBcblxuICAgIGlmIChjb21wbGV0ZWRUdGxNcyAmJiBjb21wbGV0ZWRUdGxNcyA+IDApIHtcbiAgICAgIGRlbGV0ZWQgKz0gYXdhaXQgdGhpcy5fcHJ1bmVTdGF0dXNCYXRjaGVzKHtzdGF0dXM6IFwiY29tcGxldGVkXCIsIGNvbHVtbjogXCJjb21wbGV0ZWRfYXRfbXNcIiwgY3V0b2ZmOiBub3cgLSBjb21wbGV0ZWRUdGxNcywgYmF0Y2hTaXplOiBzaXplfSlcbiAgICB9XG5cbiAgICBpZiAoZmFpbGVkVHRsTXMgJiYgZmFpbGVkVHRsTXMgPiAwKSB7XG4gICAgICBkZWxldGVkICs9IGF3YWl0IHRoaXMuX3BydW5lU3RhdHVzQmF0Y2hlcyh7c3RhdHVzOiBcImZhaWxlZFwiLCBjb2x1bW46IFwiZmFpbGVkX2F0X21zXCIsIGN1dG9mZjogbm93IC0gZmFpbGVkVHRsTXMsIGJhdGNoU2l6ZTogc2l6ZX0pXG4gICAgICBkZWxldGVkICs9IGF3YWl0IHRoaXMuX3BydW5lU3RhdHVzQmF0Y2hlcyh7c3RhdHVzOiBcIm9ycGhhbmVkXCIsIGNvbHVtbjogXCJvcnBoYW5lZF9hdF9tc1wiLCBjdXRvZmY6IG5vdyAtIGZhaWxlZFR0bE1zLCBiYXRjaFNpemU6IHNpemV9KVxuICAgIH1cblxuICAgIHJldHVybiBkZWxldGVkXG4gIH1cblxuICAvKipcbiAgICogRGVsZXRlcyByb3dzIG9mIG9uZSB0ZXJtaW5hbCBzdGF0dXMgb2xkZXIgdGhhbiBhIGN1dG9mZiwgYmF0Y2ggYnkgYmF0Y2gsXG4gICAqIHVudGlsIGEgcGFnZSByZXR1cm5zIGZld2VyIHRoYW4gYGJhdGNoU2l6ZWAgcm93cy5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBPcHRpb25zLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gYXJncy5zdGF0dXMgLSBUZXJtaW5hbCBzdGF0dXMgdG8gcHJ1bmUuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBhcmdzLmNvbHVtbiAtIFRpbWVzdGFtcCBjb2x1bW4gY29tcGFyZWQgYWdhaW5zdCB0aGUgY3V0b2ZmLlxuICAgKiBAcGFyYW0ge251bWJlcn0gYXJncy5jdXRvZmYgLSBEZWxldGUgcm93cyB3aG9zZSBjb2x1bW4gdmFsdWUgaXMgYDw9IGN1dG9mZmAuXG4gICAqIEBwYXJhbSB7bnVtYmVyfSBhcmdzLmJhdGNoU2l6ZSAtIE1heCByb3dzIHBlciBiYXRjaC5cbiAgICogQHJldHVybnMge1Byb21pc2U8bnVtYmVyPn0gLSBSb3dzIGRlbGV0ZWQgZm9yIHRoaXMgc3RhdHVzLlxuICAgKi9cbiAgYXN5bmMgX3BydW5lU3RhdHVzQmF0Y2hlcyh7c3RhdHVzLCBjb2x1bW4sIGN1dG9mZiwgYmF0Y2hTaXplfSkge1xuICAgIGxldCBkZWxldGVkID0gMFxuXG4gICAgZm9yICg7Oykge1xuICAgICAgY29uc3QgcmVtb3ZlZCA9IGF3YWl0IHRoaXMuX3NlcmlhbGl6ZWRDb3VudE11dGF0aW9uKGFzeW5jIChkYikgPT4ge1xuICAgICAgICBjb25zdCByb3dzID0gYXdhaXQgZGJcbiAgICAgICAgICAubmV3UXVlcnkoKVxuICAgICAgICAgIC5mcm9tKEpPQlNfVEFCTEUpXG4gICAgICAgICAgLnNlbGVjdChcImlkXCIpXG4gICAgICAgICAgLndoZXJlKHtzdGF0dXN9KVxuICAgICAgICAgIC53aGVyZShgJHtkYi5xdW90ZUNvbHVtbihjb2x1bW4pfSA8PSAke2RiLnF1b3RlKGN1dG9mZil9YClcbiAgICAgICAgICAubGltaXQoYmF0Y2hTaXplKVxuICAgICAgICAgIC5yZXN1bHRzKClcblxuICAgICAgICBpZiAocm93cy5sZW5ndGggPT09IDApIHJldHVybiAwXG5cbiAgICAgICAgY29uc3QgaWRzID0gcm93cy5tYXAoKC8qKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSAqLyByb3cpID0+IGRiLnF1b3RlKFN0cmluZyhyb3cuaWQpKSkuam9pbihcIiwgXCIpXG5cbiAgICAgICAgY29uc3QgcmVtb3ZlZCA9IGF3YWl0IGRiLmFmZmVjdGVkUm93cyhcbiAgICAgICAgICBgREVMRVRFIEZST00gJHtkYi5xdW90ZVRhYmxlKEpPQlNfVEFCTEUpfSBXSEVSRSAke2RiLnF1b3RlQ29sdW1uKFwiaWRcIil9IElOICgke2lkc30pYFxuICAgICAgICApXG5cbiAgICAgICAgYXdhaXQgdGhpcy5fcmVjb3JkQ291bnREZWx0YShkYiwge2FsbDogLXJlbW92ZWQsIFtzdGF0dXNdOiAtcmVtb3ZlZH0pXG5cbiAgICAgICAgcmV0dXJuIHJlbW92ZWRcbiAgICAgIH0pXG5cbiAgICAgIGRlbGV0ZWQgKz0gcmVtb3ZlZFxuICAgICAgaWYgKHJlbW92ZWQgPCBiYXRjaFNpemUpIGJyZWFrXG4gICAgfVxuXG4gICAgcmV0dXJuIGRlbGV0ZWRcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGNsZWFyIGFsbC5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgd2hlbiBjbGVhcmVkLlxuICAgKi9cbiAgYXN5bmMgY2xlYXJBbGwoKSB7XG4gICAgYXdhaXQgdGhpcy5lbnN1cmVSZWFkeSgpXG5cbiAgICBhd2FpdCB0aGlzLl9zZXJpYWxpemVkQ291bnRNdXRhdGlvbihhc3luYyAoZGIpID0+IHtcbiAgICAgIGNvbnN0IHNuYXBzaG90ID0gYXdhaXQgdGhpcy5fY291bnRTbmFwc2hvdE9uTG9ja2VkQ29ubmVjdGlvbihkYilcbiAgICAgIGlmIChhd2FpdCBkYi50YWJsZUV4aXN0cyhNQUlMX0RFTElWRVJZX09QRVJBVElPTlNfVEFCTEUpKSBhd2FpdCBkYi5xdWVyeShgREVMRVRFIEZST00gJHtkYi5xdW90ZVRhYmxlKE1BSUxfREVMSVZFUllfT1BFUkFUSU9OU19UQUJMRSl9YClcbiAgICAgIGlmIChhd2FpdCBkYi50YWJsZUV4aXN0cyhJREVNUE9URU5DWV9LRVlTX1RBQkxFKSkgYXdhaXQgZGIucXVlcnkoYERFTEVURSBGUk9NICR7ZGIucXVvdGVUYWJsZShJREVNUE9URU5DWV9LRVlTX1RBQkxFKX1gKVxuICAgICAgaWYgKGF3YWl0IGRiLnRhYmxlRXhpc3RzKFNDSEVEVUxFX0tFWVNfVEFCTEUpKSBhd2FpdCBkYi5xdWVyeShgREVMRVRFIEZST00gJHtkYi5xdW90ZVRhYmxlKFNDSEVEVUxFX0tFWVNfVEFCTEUpfWApXG4gICAgICBpZiAoYXdhaXQgZGIudGFibGVFeGlzdHMoU0NIRURVTEVfT1JERVJfV0FURVJNQVJLU19UQUJMRSkpIHtcbiAgICAgICAgY29uc3Qgd2F0ZXJtYXJrUm93cyA9IGF3YWl0IGRiXG4gICAgICAgICAgLm5ld1F1ZXJ5KClcbiAgICAgICAgICAuZnJvbShTQ0hFRFVMRV9PUkRFUl9XQVRFUk1BUktTX1RBQkxFKVxuICAgICAgICAgIC5zZWxlY3QoXCJzY2hlZHVsZV9rZXlcIilcbiAgICAgICAgICAucmVzdWx0cygpXG5cbiAgICAgICAgZm9yIChjb25zdCB3YXRlcm1hcmtSb3cgb2Ygd2F0ZXJtYXJrUm93cykge1xuICAgICAgICAgIGF3YWl0IGRiLmRlbGV0ZSh7XG4gICAgICAgICAgICB0YWJsZU5hbWU6IFNDSEVEVUxFX09SREVSX1dBVEVSTUFSS1NfVEFCTEUsXG4gICAgICAgICAgICBjb25kaXRpb25zOiB7XG4gICAgICAgICAgICAgIHNjaGVkdWxlX2tleTogU3RyaW5nKC8qKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSAqLyAod2F0ZXJtYXJrUm93KS5zY2hlZHVsZV9rZXkpXG4gICAgICAgICAgICB9XG4gICAgICAgICAgfSlcbiAgICAgICAgfVxuICAgICAgfVxuICAgICAgYXdhaXQgZGIucXVlcnkoYERFTEVURSBGUk9NICR7ZGIucXVvdGVUYWJsZShKT0JTX1RBQkxFKX1gKVxuICAgICAgaWYgKGF3YWl0IGRiLnRhYmxlRXhpc3RzKENPTkNVUlJFTkNZX1RBQkxFKSkgYXdhaXQgZGIucXVlcnkoYERFTEVURSBGUk9NICR7ZGIucXVvdGVUYWJsZShDT05DVVJSRU5DWV9UQUJMRSl9YClcbiAgICAgIGNvbnN0IGRlbHRhcyA9IE9iamVjdC5mcm9tRW50cmllcyhPYmplY3QuZW50cmllcyhzbmFwc2hvdC5jb3VudHMpLm1hcCgoW2tleSwgdmFsdWVdKSA9PiBba2V5LCAtdmFsdWVdKSlcbiAgICAgIGF3YWl0IHRoaXMuX3JlY29yZENvdW50RGVsdGEoZGIsIGRlbHRhcylcbiAgICB9KVxuICB9XG5cbiAgLyoqXG4gICAqIENhbmNlbHMgYSBxdWV1ZWQgb3IgaGFuZGVkLW9mZiBqb2IgYW5kIHJlbGVhc2VzIGFueSBkdXJhYmxlIGNvbmN1cnJlbmN5IHJlc2VydmF0aW9uLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gam9iSWQgLSBKb2IgaWQuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPGJvb2xlYW4+fSAtIFdoZXRoZXIgdGhlIGpvYiB3YXMgY2FuY2VsbGVkLlxuICAgKi9cbiAgYXN5bmMgY2FuY2VsKGpvYklkKSB7XG4gICAgYXdhaXQgdGhpcy5lbnN1cmVSZWFkeSgpXG4gICAgcmV0dXJuIGF3YWl0IHRoaXMuX3NlcmlhbGl6ZWRDb3VudE11dGF0aW9uKGFzeW5jIChkYikgPT4ge1xuICAgICAgY29uc3Qgam9iID0gYXdhaXQgdGhpcy5fZ2V0Sm9iUm93QnlJZChkYiwgam9iSWQpXG4gICAgICBpZiAoIWpvYiB8fCAoam9iLnN0YXR1cyAhPT0gXCJxdWV1ZWRcIiAmJiBqb2Iuc3RhdHVzICE9PSBcImhhbmRlZF9vZmZcIikpIHJldHVybiBmYWxzZVxuICAgICAgLy8gT25seSBhIGhhbmRlZF9vZmYgam9iIGhvbGRzIGEgY29uY3VycmVuY3kgcmVzZXJ2YXRpb24sIHNvIG9ubHkgdGhhdCBjYXNlIHRvdWNoZXMgdGhlXG4gICAgICAvLyBzaGFyZWQgY291bnRlciByb3cgYW5kIG5lZWRzIHRoZSBjb25jdXJyZW5jeS10aGVuLWpvYiBsb2NrIG9yZGVyaW5nLlxuICAgICAgaWYgKGpvYi5zdGF0dXMgPT09IFwiaGFuZGVkX29mZlwiKSBhd2FpdCB0aGlzLl9sb2NrQ29uY3VycmVuY3lSb3coZGIsIGpvYi5jb25jdXJyZW5jeUtleSlcbiAgICAgIGNvbnN0IGFmZmVjdGVkUm93cyA9IGF3YWl0IHRoaXMuX3VwZGF0ZUFmZmVjdGVkUm93cyhkYiwge3RhYmxlTmFtZTogSk9CU19UQUJMRSwgZGF0YToge3N0YXR1czogXCJjYW5jZWxsZWRcIn0sIGNvbmRpdGlvbnM6IHtpZDogam9iLmlkLCBzdGF0dXM6IGpvYi5zdGF0dXN9fSlcbiAgICAgIGlmIChhZmZlY3RlZFJvd3MgIT09IDEpIHJldHVybiBmYWxzZVxuICAgICAgYXdhaXQgdGhpcy5fcmVsZWFzZVNjaGVkdWxlT3duZXJzaGlwRm9ySm9iKGRiLCBqb2IpXG4gICAgICBpZiAoam9iLnN0YXR1cyA9PT0gXCJoYW5kZWRfb2ZmXCIpIGF3YWl0IHRoaXMuX3JlbGVhc2VDb25jdXJyZW5jeShkYiwgam9iLmNvbmN1cnJlbmN5S2V5KVxuICAgICAgYXdhaXQgdGhpcy5fcmVjb3JkU3RhdHVzVHJhbnNpdGlvbihkYiwgam9iLnN0YXR1cywgXCJjYW5jZWxsZWRcIilcbiAgICAgIHJldHVybiB0cnVlXG4gICAgfSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGdldCByZXRyeSBkZWxheSBtcy5cbiAgICogQHBhcmFtIHtudW1iZXJ9IHJldHJ5Q291bnQgLSBSZXRyeSBhdHRlbXB0IGNvdW50ICgxLWJhc2VkKS5cbiAgICogQHJldHVybnMge251bWJlcn0gLSBEZWxheSBpbiBtaWxsaXNlY29uZHMuXG4gICAqL1xuICBnZXRSZXRyeURlbGF5TXMocmV0cnlDb3VudCkge1xuICAgIHJldHVybiByZXRyeURlbGF5TXMocmV0cnlDb3VudClcbiAgfVxuXG4gIC8qKlxuICAgKiBOb3JtYWxpemVzIG9uZSBuZXcgam9iIGJlZm9yZSBlbnRlcmluZyBpdHMgcGVyc2lzdGVuY2UgdHJhbnNhY3Rpb24uXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gSm9iIGlucHV0LlxuICAgKiBAcGFyYW0ge0FycmF5PFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gYXJncy5hcmdzIC0gSm9iIGFyZ3VtZW50cy5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGFyZ3Muam9iTmFtZSAtIEpvYiBuYW1lLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vdHlwZXMuanNcIikuQmFja2dyb3VuZEpvYk9wdGlvbnN9IFthcmdzLm9wdGlvbnNdIC0gSm9iIG9wdGlvbnMuXG4gICAqIEByZXR1cm5zIHtQcmVwYXJlZEJhY2tncm91bmRKb2J9IC0gUHJlcGFyZWQgam9iLlxuICAgKi9cbiAgX3ByZXBhcmVKb2Ioe2FyZ3MsIGpvYk5hbWUsIG9wdGlvbnN9KSB7XG4gICAgY29uc3QgY3JlYXRlZEF0TXMgPSB0aGlzLmNsb2NrLm5vdygpXG4gICAgY29uc3QgcXVldWUgPSB0aGlzLl9ub3JtYWxpemVRdWV1ZShvcHRpb25zKVxuXG4gICAgcmV0dXJuIHtcbiAgICAgIGFyZ3NKc29uOiBKU09OLnN0cmluZ2lmeShhcmdzIHx8IFtdKSxcbiAgICAgIGNvbmN1cnJlbmN5OiB0aGlzLl9yZXNvbHZlQ29uY3VycmVuY3kob3B0aW9ucywgcXVldWUpLFxuICAgICAgY3JlYXRlZEF0TXMsXG4gICAgICBleGVjdXRpb25Nb2RlOiB0aGlzLl9ub3JtYWxpemVFeGVjdXRpb25Nb2RlKG9wdGlvbnMpLFxuICAgICAgam9iSWQ6IHJhbmRvbVVVSUQoKSxcbiAgICAgIGpvYk5hbWUsXG4gICAgICBtYXhSZXRyaWVzOiB0aGlzLl9ub3JtYWxpemVNYXhSZXRyaWVzKG9wdGlvbnM/Lm1heFJldHJpZXMpLFxuICAgICAgcXVldWUsXG4gICAgICBzY2hlZHVsZWRBdE1zOiB0aGlzLl9ub3JtYWxpemVTY2hlZHVsZWRBdE1zKG9wdGlvbnM/LnNjaGVkdWxlZEF0TXMsIGNyZWF0ZWRBdE1zKSxcbiAgICAgIHRpbWVvdXRNczogdGhpcy5fbm9ybWFsaXplSm9iVGltZW91dE1zKG9wdGlvbnMpXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIE5vcm1hbGl6ZXMgYSBwZXItam9iIHRpbWVvdXQgd2hpbGUgcHJlc2VydmluZyBvbWl0dGVkICh3b3JrZXIgZmFsbGJhY2spXG4gICAqIHNlcGFyYXRlbHkgZnJvbSBleHBsaWNpdGx5IGRpc2FibGVkLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vdHlwZXMuanNcIikuQmFja2dyb3VuZEpvYk9wdGlvbnMgfCB1bmRlZmluZWR9IG9wdGlvbnMgLSBKb2Igb3B0aW9ucy5cbiAgICogQHJldHVybnMge251bWJlciB8IG51bGx9IC0gUG9zaXRpdmUgdGltZW91dCwgemVybyBmb3IgZGlzYWJsZWQsIG9yIG51bGwgd2hlbiBvbWl0dGVkLlxuICAgKi9cbiAgX25vcm1hbGl6ZUpvYlRpbWVvdXRNcyhvcHRpb25zKSB7XG4gICAgaWYgKG9wdGlvbnM/LnRpbWVvdXRNcyA9PT0gdW5kZWZpbmVkKSByZXR1cm4gbnVsbFxuXG4gICAgY29uc3QgdGltZW91dE1zID0gb3B0aW9ucy50aW1lb3V0TXNcblxuICAgIGlmICh0eXBlb2YgdGltZW91dE1zICE9PSBcIm51bWJlclwiIHx8ICFOdW1iZXIuaXNGaW5pdGUodGltZW91dE1zKSkge1xuICAgICAgdGhyb3cgVmVsb2Npb3VzRXJyb3Iuc2FmZShKT0JfVElNRU9VVF9WQUxJREFUSU9OX01FU1NBR0UpXG4gICAgfVxuXG4gICAgaWYgKHRpbWVvdXRNcyA8PSAwKSByZXR1cm4gMFxuXG4gICAgaWYgKCFOdW1iZXIuaXNJbnRlZ2VyKHRpbWVvdXRNcykgfHwgdGltZW91dE1zID4gTUFYX0pPQl9USU1FT1VUX01TKSB7XG4gICAgICB0aHJvdyBWZWxvY2lvdXNFcnJvci5zYWZlKEpPQl9USU1FT1VUX1ZBTElEQVRJT05fTUVTU0FHRSlcbiAgICB9XG5cbiAgICByZXR1cm4gdGltZW91dE1zXG4gIH1cblxuICAvKipcbiAgICogSW5zZXJ0cyBvbmUgcHJlcGFyZWQgcXVldWVkIGpvYiwgaW5jbHVkaW5nIGl0cyBjb25jdXJyZW5jeSByZWdpc3RyYXRpb24uXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vZGF0YWJhc2UvZHJpdmVycy9iYXNlLmpzXCIpLmRlZmF1bHR9IGRiIC0gRGF0YWJhc2UgY29ubmVjdGlvbi5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBJbnNlcnQgaW5wdXQuXG4gICAqIEBwYXJhbSB7UHJlcGFyZWRCYWNrZ3JvdW5kSm9ifSBhcmdzLnByZXBhcmVkSm9iIC0gUHJlcGFyZWQgam9iLlxuICAgKiBAcGFyYW0ge3N0cmluZyB8IG51bGx9IGFyZ3Muc2NoZWR1bGVLZXkgLSBIaXN0b3JpY2FsIHN0YWJsZSBrZXkuXG4gICAqIEBwYXJhbSB7bnVtYmVyIHwgbnVsbH0gW2FyZ3Muc2NoZWR1bGVPcmRlcl0gLSBNb25vdG9uaWMgc3RhYmxlIG93bmVyc2hpcCBvcmRlci5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgYWZ0ZXIgaW5zZXJ0aW9uLlxuICAgKi9cbiAgYXN5bmMgX2luc2VydFByZXBhcmVkSm9iKGRiLCB7cHJlcGFyZWRKb2IsIHNjaGVkdWxlS2V5LCBzY2hlZHVsZU9yZGVyID0gbnVsbH0pIHtcbiAgICBjb25zdCB7Y29uY3VycmVuY3l9ID0gcHJlcGFyZWRKb2JcblxuICAgIGlmIChjb25jdXJyZW5jeSkge1xuICAgICAgaWYgKGNvbmN1cnJlbmN5LnF1ZXVlRGVyaXZlZCkge1xuICAgICAgICBhd2FpdCB0aGlzLl9lbnN1cmVRdWV1ZUNvbmN1cnJlbmN5S2V5KGRiLCBjb25jdXJyZW5jeSlcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIGF3YWl0IHRoaXMuX2Vuc3VyZUNvbmN1cnJlbmN5S2V5KGRiLCBjb25jdXJyZW5jeSlcbiAgICAgIH1cbiAgICB9XG5cbiAgICBhd2FpdCBkYi5pbnNlcnQoe1xuICAgICAgdGFibGVOYW1lOiBKT0JTX1RBQkxFLFxuICAgICAgZGF0YToge1xuICAgICAgICBpZDogcHJlcGFyZWRKb2Iuam9iSWQsXG4gICAgICAgIGpvYl9uYW1lOiBwcmVwYXJlZEpvYi5qb2JOYW1lLFxuICAgICAgICBhcmdzX2pzb246IHByZXBhcmVkSm9iLmFyZ3NKc29uLFxuICAgICAgICBleGVjdXRpb25fbW9kZTogcHJlcGFyZWRKb2IuZXhlY3V0aW9uTW9kZSxcbiAgICAgICAgcXVldWU6IHByZXBhcmVkSm9iLnF1ZXVlLFxuICAgICAgICBtYXhfcmV0cmllczogcHJlcGFyZWRKb2IubWF4UmV0cmllcyxcbiAgICAgICAgYXR0ZW1wdHM6IDAsXG4gICAgICAgIHN0YXR1czogXCJxdWV1ZWRcIixcbiAgICAgICAgc2NoZWR1bGVkX2F0X21zOiBwcmVwYXJlZEpvYi5zY2hlZHVsZWRBdE1zLFxuICAgICAgICBjcmVhdGVkX2F0X21zOiBwcmVwYXJlZEpvYi5jcmVhdGVkQXRNcyxcbiAgICAgICAgc2NoZWR1bGVfa2V5OiBzY2hlZHVsZUtleSxcbiAgICAgICAgc2NoZWR1bGVfb3JkZXI6IHNjaGVkdWxlT3JkZXIsXG4gICAgICAgIGNvbmN1cnJlbmN5X2tleTogY29uY3VycmVuY3k/LmNvbmN1cnJlbmN5S2V5IHx8IG51bGwsXG4gICAgICAgIG1heF9jb25jdXJyZW5jeTogY29uY3VycmVuY3k/Lm1heENvbmN1cnJlbmN5IHx8IG51bGwsXG4gICAgICAgIHRpbWVvdXRfbXM6IHByZXBhcmVkSm9iLnRpbWVvdXRNcyxcbiAgICAgICAgaGFuZG9mZl9pZDogbnVsbFxuICAgICAgfVxuICAgIH0pXG4gIH1cblxuICAvKipcbiAgICogUnVucyBub3JtYWxpemUgbWF4IHJldHJpZXMuXG4gICAqIEBwYXJhbSB7bnVtYmVyIHwgbnVsbCB8IHVuZGVmaW5lZH0gbWF4UmV0cmllcyAtIElucHV0LlxuICAgKiBAcmV0dXJucyB7bnVtYmVyfSAtIE5vcm1hbGl6ZWQgbWF4IHJldHJpZXMuXG4gICAqL1xuICBfbm9ybWFsaXplTWF4UmV0cmllcyhtYXhSZXRyaWVzKSB7XG4gICAgcmV0dXJuIG5vcm1hbGl6ZUJhY2tncm91bmRKb2JNYXhSZXRyaWVzKG1heFJldHJpZXMpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBub3JtYWxpemUgc2NoZWR1bGVkIGF0IG1zLlxuICAgKiBAcGFyYW0ge251bWJlciB8IHVuZGVmaW5lZH0gc2NoZWR1bGVkQXRNcyAtIFJlcXVlc3RlZCBkaXNwYXRjaCB0aW1lc3RhbXAuXG4gICAqIEBwYXJhbSB7bnVtYmVyfSBkZWZhdWx0U2NoZWR1bGVkQXRNcyAtIERlZmF1bHQgZGlzcGF0Y2ggdGltZXN0YW1wLlxuICAgKiBAcmV0dXJucyB7bnVtYmVyfSAtIERpc3BhdGNoIHRpbWVzdGFtcC5cbiAgICovXG4gIF9ub3JtYWxpemVTY2hlZHVsZWRBdE1zKHNjaGVkdWxlZEF0TXMsIGRlZmF1bHRTY2hlZHVsZWRBdE1zKSB7XG4gICAgcmV0dXJuIG5vcm1hbGl6ZUJhY2tncm91bmRKb2JTY2hlZHVsZWRBdE1zKHNjaGVkdWxlZEF0TXMsIGRlZmF1bHRTY2hlZHVsZWRBdE1zKVxuICB9XG5cbiAgLyoqXG4gICAqIFJlc29sdmVzIGEgcmVzY2hlZHVsZSBkZWxheSBhZ2FpbnN0IHBlcnNpc3RlbmNlIHRpbWUuXG4gICAqIEBwYXJhbSB7bnVtYmVyfSBkZWxheU1zIC0gRGVsYXkgaW4gbWlsbGlzZWNvbmRzLlxuICAgKiBAcmV0dXJucyB7bnVtYmVyfSAtIEZ1dHVyZSBlbGlnaWJpbGl0eSB0aW1lc3RhbXAuXG4gICAqL1xuICBfcmVzY2hlZHVsZWRBdE1zKGRlbGF5TXMpIHtcbiAgICByZXR1cm4gcmVzY2hlZHVsZWRCYWNrZ3JvdW5kSm9iQXRNcyhkZWxheU1zLCB0aGlzLmNsb2NrLm5vdygpKVxuICB9XG5cbiAgLyoqXG4gICAqIFZhbGlkYXRlcyBhIHB1YmxpYyByZXNjaGVkdWxlIGRlbGF5IGJlZm9yZSBwZXJzaXN0ZW5jZSB3b3JrIGJlZ2lucy5cbiAgICogQHBhcmFtIHtudW1iZXJ9IGRlbGF5TXMgLSBEZWxheSBpbiBtaWxsaXNlY29uZHMuXG4gICAqIEByZXR1cm5zIHt2b2lkfVxuICAgKi9cbiAgX3ZhbGlkYXRlUmVzY2hlZHVsZURlbGF5TXMoZGVsYXlNcykge1xuICAgIHJlc2NoZWR1bGVkQmFja2dyb3VuZEpvYkF0TXMoZGVsYXlNcywgMClcbiAgfVxuXG4gIC8qKlxuICAgKiBWYWxpZGF0ZXMgYSBzdGFibGUgc2NoZWR1bGUga2V5IGF0IHRoZSBwdWJsaWMgc3RvcmFnZSBib3VuZGFyeS5cbiAgICogQHBhcmFtIHtzdHJpbmd9IHNjaGVkdWxlS2V5IC0gU3RhYmxlIGxvZ2ljYWwgc2NoZWR1bGUga2V5LlxuICAgKiBAcmV0dXJucyB7c3RyaW5nfSAtIFZhbGlkYXRlZCBrZXkuXG4gICAqL1xuICBfbm9ybWFsaXplU2NoZWR1bGVLZXkoc2NoZWR1bGVLZXkpIHtcbiAgICByZXR1cm4gbm9ybWFsaXplQmFja2dyb3VuZEpvYlNjaGVkdWxlS2V5KHNjaGVkdWxlS2V5KVxuICB9XG5cbiAgLyoqXG4gICAqIEJ1aWxkcyBhIGJvdW5kZWQgYWR2aXNvcnktbG9jayBuYW1lIGZvciBvbmUgc3RhYmxlIHNjaGVkdWxlIGtleS5cbiAgICogQHBhcmFtIHtzdHJpbmd9IHNjaGVkdWxlS2V5IC0gVmFsaWRhdGVkIHN0YWJsZSBzY2hlZHVsZSBrZXkuXG4gICAqIEByZXR1cm5zIHtzdHJpbmd9IC0gQWR2aXNvcnktbG9jayBuYW1lLlxuICAgKi9cbiAgX3NjaGVkdWxlS2V5TG9ja05hbWUoc2NoZWR1bGVLZXkpIHtcbiAgICBjb25zdCBoYXNoID0gY3JlYXRlSGFzaChcInNoYTI1NlwiKS51cGRhdGUoc2NoZWR1bGVLZXkpLmRpZ2VzdChcImhleFwiKS5zbGljZSgwLCAzMilcblxuICAgIHJldHVybiBgYmFja2dyb3VuZC1qb2JzOnNjaGVkdWxlOiR7aGFzaH1gXG4gIH1cblxuICAvKipcbiAgICogRW5zdXJlcyB0aGUgYmFja2dyb3VuZC1qb2JzIHNjaGVtYSBleGlzdHMsIHJldXNpbmcgYSBjYWxsZXItaGVsZCBjb25uZWN0aW9uIHdoZW5cbiAgICogb25lIGlzIGdpdmVuIHJhdGhlciB0aGFuIGNoZWNraW5nIG91dCBpdHMgb3duLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL2RhdGFiYXNlL2RyaXZlcnMvYmFzZS5qc1wiKS5kZWZhdWx0fSBbZXhpc3RpbmdEYl0gLSBSZXVzZSBhblxuICAgKiAgIGFscmVhZHktY2hlY2tlZC1vdXQgY29ubmVjdGlvbiAoZS5nLiB0aGUgb25lIGBkYjptaWdyYXRlYCBob2xkcykgaW5zdGVhZCBvZlxuICAgKiAgIGNoZWNraW5nIG91dCBhIG5lc3RlZCBvbmUg4oCUIHRoZSBuZXN0ZWQgY2hlY2tvdXQgd291bGQgZGVhZGxvY2sgYSBkYXRhYmFzZVxuICAgKiAgIHdob3NlIHBvb2wgaXMgY2FwcGVkIGF0IGEgc2luZ2xlIGNvbm5lY3Rpb24gYWxyZWFkeSBoZWxkIGJ5IHRoZSBjYWxsZXIuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIHdoZW4gdGhlIHNjaGVtYSBpcyBwcmVzZW50LlxuICAgKi9cbiAgYXN5bmMgX2Vuc3VyZVNjaGVtYShleGlzdGluZ0RiKSB7XG4gICAgYXdhaXQgdGhpcy5fYXBwbHlTY2hlbWEoZXhpc3RpbmdEYilcbiAgfVxuXG4gIC8qKlxuICAgKiBTZXJpYWxpemVzIGNyZWF0aW9uIG9yIHVwZ3JhZGUgb2YgdGhlIGJhY2tncm91bmQtam9icyBzY2hlbWEsIGNoZWNraW5nIG91dCBhXG4gICAqIGNvbm5lY3Rpb24gb25seSBhZnRlciBlYXJsaWVyIHNjaGVtYSB3b3JrIGhhcyBjb21wbGV0ZWQgd2hlbiBvbmUgaXMgbm90IHN1cHBsaWVkLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL2RhdGFiYXNlL2RyaXZlcnMvYmFzZS5qc1wiKS5kZWZhdWx0fSBbZXhpc3RpbmdEYl0gLSBDYWxsZXItb3duZWRcbiAgICogICBkYXRhYmFzZSBjb25uZWN0aW9uLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyB3aGVuIHRoZSBzY2hlbWEgaXMgcHJlc2VudC5cbiAgICovXG4gIGFzeW5jIF9hcHBseVNjaGVtYShleGlzdGluZ0RiKSB7XG4gICAgLy8gU2VyaWFsaXplIGNvbmN1cnJlbnQgc2NoZW1hIGFwcGxpZXMgd2l0aGluIHRoaXMgcHJvY2Vzcywga2V5ZWQgYnkgZGF0YWJhc2VcbiAgICAvLyBpZGVudGlmaWVyIChzZWUgYHNjaGVtYUFwcGx5Q2hhaW5zYCkuIFRoZSBwZXItc3RlcCBsb2NrcyBpbnNpZGUgdGhlIHN0ZXBzIHVzZVxuICAgIC8vIERJRkZFUkVOVCBsb2NrIG5hbWVzLCBzbyB0d28gY29uY3VycmVudCBjYWxsZXJzIGNvdWxkIG90aGVyd2lzZSBlYWNoIGhvbGQgYVxuICAgIC8vIGRpZmZlcmVudCBzdGVwIGxvY2sgd2hpbGUgYm90aCByZWJ1aWxkIHRoZSBqb2JzIHRhYmxlIOKAlCBhbmQgb24gU1FMaXRlL01TU1FMIGFuXG4gICAgLy8gYWRkLWNvbHVtbiBpcyBhIGNyZWF0ZS1jb3B5LWRyb3AtcmVuYW1lIHJlYnVpbGQsIHNvIG92ZXJsYXBwaW5nIHJlYnVpbGRzXG4gICAgLy8gY29ycnVwdCBpdC4gVGhpcyBtdXRleCBtYWtlcyB0aGUgd2hvbGUgYXBwbHkgbXV0dWFsbHkgZXhjbHVzaXZlIHBlciBwcm9jZXNzO1xuICAgIC8vIHRoZSBzZWNvbmQgY2FsbGVyIHRoZW4gcmUtY2hlY2tzIGFuZCBmaW5kcyBldmVyeSBzdGVwIGFscmVhZHkgZG9uZS5cbiAgICBjb25zdCBpZGVudGlmaWVyID0gdGhpcy5nZXREYXRhYmFzZUlkZW50aWZpZXIoKSA/PyBcImRlZmF1bHRcIlxuICAgIGNvbnN0IHByZXZpb3VzID0gc2NoZW1hQXBwbHlDaGFpbnMuZ2V0KGlkZW50aWZpZXIpID8/IFByb21pc2UucmVzb2x2ZSgpXG4gICAgY29uc3QgYXBwbHlXaXRoQ29ubmVjdGlvbiA9IGFzeW5jICgpID0+IHtcbiAgICAgIGlmIChleGlzdGluZ0RiKSB7XG4gICAgICAgIGF3YWl0IHRoaXMuX2FwcGx5U2NoZW1hU3RlcHMoZXhpc3RpbmdEYilcblxuICAgICAgICByZXR1cm5cbiAgICAgIH1cblxuICAgICAgYXdhaXQgdGhpcy5fd2l0aERiKChkYikgPT4gdGhpcy5fYXBwbHlTY2hlbWFTdGVwcyhkYikpXG4gICAgfVxuICAgIGNvbnN0IHJ1biA9IHByZXZpb3VzLnRoZW4oYXBwbHlXaXRoQ29ubmVjdGlvbiwgYXBwbHlXaXRoQ29ubmVjdGlvbilcblxuICAgIC8vIEtlZXAgdGhlIGNoYWluIGFsaXZlIHJlZ2FyZGxlc3Mgb2YgdGhpcyBydW4ncyBvdXRjb21lIHNvIG9uZSBmYWlsZWQgYXBwbHkgZG9lc1xuICAgIC8vIG5vdCB3ZWRnZSBsYXRlciBjYWxsZXJzOyB0aGlzIHJ1biBzdGlsbCBwcm9wYWdhdGVzIGl0cyBvd24gcmVzdWx0L2Vycm9yLlxuICAgIHNjaGVtYUFwcGx5Q2hhaW5zLnNldChpZGVudGlmaWVyLCBydW4udGhlbigoKSA9PiB7fSwgKCkgPT4ge30pKVxuXG4gICAgcmV0dXJuIGF3YWl0IHJ1blxuICB9XG5cbiAgLyoqXG4gICAqIENyZWF0ZXMgb3IgdXBncmFkZXMgdGhlIGJhY2tncm91bmQtam9icyB0YWJsZXMsIGNvbHVtbnMgYW5kIGNvbmN1cnJlbmN5IHJvd3Mgb25cbiAgICogdGhlIGdpdmVuIGNvbm5lY3Rpb24uIFNlcmlhbGl6ZWQgcGVyIHByb2Nlc3MgYnkge0BsaW5rIEJhY2tncm91bmRKb2JzU3RvcmUjX2FwcGx5U2NoZW1hfS5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9kYXRhYmFzZS9kcml2ZXJzL2Jhc2UuanNcIikuZGVmYXVsdH0gZGIgLSBEYXRhYmFzZSBjb25uZWN0aW9uLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyB3aGVuIHRoZSBzY2hlbWEgaXMgcHJlc2VudC5cbiAgICovXG4gIGFzeW5jIF9hcHBseVNjaGVtYVN0ZXBzKGRiKSB7XG4gICAgYXdhaXQgdGhpcy5fZW5zdXJlTWlncmF0aW9uc1RhYmxlKGRiKVxuXG4gICAgY29uc3QgYWxyZWFkeUFwcGxpZWQgPSBhd2FpdCB0aGlzLl9oYXNNaWdyYXRpb24oZGIpXG4gICAgY29uc3Qgc2NoZW1hUmVjb3ZlcnlQZW5kaW5nID0gYXdhaXQgdGhpcy5faGFzTWlncmF0aW9uKGRiLCBTQ0hFTUFfUkVDT1ZFUllfUEVORElOR19WRVJTSU9OKVxuICAgIGNvbnN0IGpvYnNUYWJsZUV4aXN0cyA9IGF3YWl0IGRiLnRhYmxlRXhpc3RzKEpPQlNfVEFCTEUpXG5cbiAgICAvLyBFdmVuIHdoZW4gdGhlIG1pZ3JhdGlvbiByb3cgaXMgcHJlc2VudCwgdGhlIGpvYnMgdGFibGUgaXRzZWxmIGNhbiBoYXZlXG4gICAgLy8gYmVlbiBkcm9wcGVkIHVuZGVybmVhdGggdXMgYnkgYSB0cmFuc2FjdGlvbiByb2xsYmFjayBpbiBhbm90aGVyIGNhbGxlclxuICAgIC8vIChEREwgaXMgdHJhbnNhY3Rpb25hbCBvbiBTUUxpdGUvTVNTUUwpLiBWZXJpZnkgdGhlIHRhYmxlIHBoeXNpY2FsbHlcbiAgICAvLyBleGlzdHMgYW5kIHJlY3JlYXRlIGl0IHdoZW4gbWlzc2luZyByYXRoZXIgdGhhbiB0cnVzdGluZyB0aGUgbWlncmF0aW9uXG4gICAgLy8gcm93IGFsb25lLCBvdGhlcndpc2UgbGF0ZXIgY2FsbGVycyBmYWlsIHdpdGggXCJubyBzdWNoIHRhYmxlXCIuXG4gICAgaWYgKGFscmVhZHlBcHBsaWVkICYmIGpvYnNUYWJsZUV4aXN0cyAmJiAhc2NoZW1hUmVjb3ZlcnlQZW5kaW5nKSB7XG4gICAgICBhd2FpdCB0aGlzLl9lbnN1cmVKb2JzVGFibGVDb2x1bW5zKGRiKVxuICAgICAgYXdhaXQgdGhpcy5fZW5zdXJlSWRlbXBvdGVuY3lLZXlzVGFibGUoZGIpXG4gICAgICBhd2FpdCB0aGlzLl9lbnN1cmVNYWlsRGVsaXZlcnlPcGVyYXRpb25zVGFibGUoZGIpXG4gICAgICBhd2FpdCB0aGlzLl9lbnN1cmVTY2hlZHVsZUtleXNUYWJsZShkYilcbiAgICAgIGF3YWl0IHRoaXMuX2Vuc3VyZUNvbmN1cnJlbmN5VGFibGUoZGIpXG4gICAgICBhd2FpdCB0aGlzLl9lbnN1cmVDb3VudFJldmlzaW9uVGFibGUoZGIpXG5cbiAgICAgIHJldHVyblxuICAgIH1cblxuICAgIGlmIChhbHJlYWR5QXBwbGllZCAmJiAhc2NoZW1hUmVjb3ZlcnlQZW5kaW5nKSB7XG4gICAgICBhd2FpdCB0aGlzLl9yZWNvcmRNaWdyYXRpb24oZGIsIFNDSEVNQV9SRUNPVkVSWV9QRU5ESU5HX1ZFUlNJT04pXG4gICAgfVxuXG4gICAgYXdhaXQgdGhpcy5fYXBwbHlNaWdyYXRpb25zKGRiKVxuICAgIGF3YWl0IHRoaXMuX2Vuc3VyZUpvYnNUYWJsZUNvbHVtbnMoZGIpXG4gICAgYXdhaXQgdGhpcy5fZW5zdXJlSWRlbXBvdGVuY3lLZXlzVGFibGUoZGIpXG4gICAgYXdhaXQgdGhpcy5fZW5zdXJlTWFpbERlbGl2ZXJ5T3BlcmF0aW9uc1RhYmxlKGRiKVxuICAgIGF3YWl0IHRoaXMuX2Vuc3VyZVNjaGVkdWxlS2V5c1RhYmxlKGRiKVxuICAgIGF3YWl0IHRoaXMuX2Vuc3VyZUNvbmN1cnJlbmN5VGFibGUoZGIpXG4gICAgYXdhaXQgdGhpcy5fZW5zdXJlQ291bnRSZXZpc2lvblRhYmxlKGRiKVxuXG4gICAgaWYgKGFscmVhZHlBcHBsaWVkKSB7XG4gICAgICAvLyBUaGUgcmVjcmVhdGVkIGpvYnMgdGFibGUgaXMgZW1wdHksIGJ1dCB0aGUgc3Vydml2aW5nIGNvbmN1cnJlbmN5IHRhYmxlXG4gICAgICAvLyBjYW4gc3RpbGwgY291bnQgaGFuZG9mZnMgdGhhdCBkaXNhcHBlYXJlZCB3aXRoIHRoZSBkcm9wcGVkIGpvYnMgdGFibGUuXG4gICAgICBhd2FpdCB0aGlzLl9yZWNvbmNpbGVDb25jdXJyZW5jeShkYilcbiAgICAgIGF3YWl0IGRiLmRlbGV0ZSh7XG4gICAgICAgIHRhYmxlTmFtZTogTUlHUkFUSU9OU19UQUJMRSxcbiAgICAgICAgY29uZGl0aW9uczoge2tleTogdGhpcy5fbWlncmF0aW9uS2V5KFNDSEVNQV9SRUNPVkVSWV9QRU5ESU5HX1ZFUlNJT04pfVxuICAgICAgfSlcblxuICAgICAgcmV0dXJuXG4gICAgfVxuXG4gICAgYXdhaXQgdGhpcy5fcmVjb3JkTWlncmF0aW9uKGRiLCBNSUdSQVRJT05fVkVSU0lPTilcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGVuc3VyZSBtaWdyYXRpb25zIHRhYmxlLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL2RhdGFiYXNlL2RyaXZlcnMvYmFzZS5qc1wiKS5kZWZhdWx0fSBkYiAtIERhdGFiYXNlIGNvbm5lY3Rpb24uXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIHdoZW4gY29tcGxldGUuXG4gICAqL1xuICBhc3luYyBfZW5zdXJlTWlncmF0aW9uc1RhYmxlKGRiKSB7XG4gICAgaWYgKGF3YWl0IGRiLnRhYmxlRXhpc3RzKE1JR1JBVElPTlNfVEFCTEUpKSByZXR1cm5cblxuICAgIGNvbnN0IHRhYmxlID0gbmV3IFRhYmxlRGF0YShNSUdSQVRJT05TX1RBQkxFLCB7aWZOb3RFeGlzdHM6IHRydWV9KVxuXG4gICAgdGFibGUuc3RyaW5nKFwia2V5XCIsIHtudWxsOiBmYWxzZSwgcHJpbWFyeUtleTogdHJ1ZX0pXG4gICAgdGFibGUuc3RyaW5nKFwic2NvcGVcIiwge251bGw6IGZhbHNlfSlcbiAgICB0YWJsZS5zdHJpbmcoXCJ2ZXJzaW9uXCIsIHtudWxsOiBmYWxzZX0pXG4gICAgdGFibGUuYmlnaW50KFwiYXBwbGllZF9hdF9tc1wiLCB7bnVsbDogZmFsc2V9KVxuXG4gICAgYXdhaXQgZGIuY3JlYXRlVGFibGUodGFibGUpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBoYXMgbWlncmF0aW9uLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL2RhdGFiYXNlL2RyaXZlcnMvYmFzZS5qc1wiKS5kZWZhdWx0fSBkYiAtIERhdGFiYXNlIGNvbm5lY3Rpb24uXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBbdmVyc2lvbl0gLSBNaWdyYXRpb24gdmVyc2lvbi5cbiAgICogQHJldHVybnMge1Byb21pc2U8Ym9vbGVhbj59IC0gV2hldGhlciBtaWdyYXRpb24gZXhpc3RzLlxuICAgKi9cbiAgYXN5bmMgX2hhc01pZ3JhdGlvbihkYiwgdmVyc2lvbiA9IE1JR1JBVElPTl9WRVJTSU9OKSB7XG4gICAgY29uc3QgcXVlcnkgPSBkYlxuICAgICAgLm5ld1F1ZXJ5KClcbiAgICAgIC5mcm9tKE1JR1JBVElPTlNfVEFCTEUpXG4gICAgICAud2hlcmUoe2tleTogdGhpcy5fbWlncmF0aW9uS2V5KHZlcnNpb24pfSlcbiAgICAgIC5saW1pdCgxKVxuXG4gICAgY29uc3Qgcm93cyA9IGF3YWl0IHF1ZXJ5LnJlc3VsdHMoKVxuXG4gICAgcmV0dXJuIHJvd3MubGVuZ3RoID4gMFxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgYXBwbHkgbWlncmF0aW9ucy5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9kYXRhYmFzZS9kcml2ZXJzL2Jhc2UuanNcIikuZGVmYXVsdH0gZGIgLSBEYXRhYmFzZSBjb25uZWN0aW9uLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyB3aGVuIGNvbXBsZXRlLlxuICAgKi9cbiAgYXN5bmMgX2FwcGx5TWlncmF0aW9ucyhkYikge1xuICAgIHRoaXMubG9nZ2VyLmluZm8oXCJBcHBseWluZyBiYWNrZ3JvdW5kIGpvYnMgc2NoZW1hXCIpXG5cbiAgICBpZiAoYXdhaXQgZGIudGFibGVFeGlzdHMoSk9CU19UQUJMRSkpIHtcbiAgICAgIHRoaXMubG9nZ2VyLmluZm8oXCJCYWNrZ3JvdW5kIGpvYnMgdGFibGUgYWxyZWFkeSBleGlzdHMgLSBza2lwcGluZyBjcmVhdGVcIilcbiAgICAgIHJldHVyblxuICAgIH1cblxuICAgIGNvbnN0IHRhYmxlID0gbmV3IFRhYmxlRGF0YShKT0JTX1RBQkxFLCB7aWZOb3RFeGlzdHM6IHRydWV9KVxuXG4gICAgdGFibGUuc3RyaW5nKFwiaWRcIiwge3ByaW1hcnlLZXk6IHRydWV9KVxuICAgIHRhYmxlLnN0cmluZyhcImpvYl9uYW1lXCIsIHtudWxsOiBmYWxzZSwgaW5kZXg6IHRydWV9KVxuICAgIHRhYmxlLnRleHQoXCJhcmdzX2pzb25cIiwge251bGw6IGZhbHNlfSlcbiAgICB0YWJsZS5zdHJpbmcoXCJleGVjdXRpb25fbW9kZVwiLCB7bnVsbDogZmFsc2V9KVxuICAgIHRhYmxlLnN0cmluZyhcInF1ZXVlXCIsIHtudWxsOiB0cnVlLCBpbmRleDogdHJ1ZX0pXG4gICAgdGFibGUuaW50ZWdlcihcIm1heF9yZXRyaWVzXCIsIHtudWxsOiBmYWxzZX0pXG4gICAgdGFibGUuaW50ZWdlcihcImF0dGVtcHRzXCIsIHtudWxsOiBmYWxzZX0pXG4gICAgdGFibGUuc3RyaW5nKFwic3RhdHVzXCIsIHtudWxsOiBmYWxzZSwgaW5kZXg6IHRydWV9KVxuICAgIHRhYmxlLmJpZ2ludChcInNjaGVkdWxlZF9hdF9tc1wiLCB7bnVsbDogZmFsc2UsIGluZGV4OiB0cnVlfSlcbiAgICB0YWJsZS5iaWdpbnQoXCJjcmVhdGVkX2F0X21zXCIsIHtudWxsOiBmYWxzZSwgaW5kZXg6IHRydWV9KVxuICAgIHRhYmxlLnN0cmluZyhcInNjaGVkdWxlX2tleVwiLCB7bnVsbDogdHJ1ZSwgaW5kZXg6IHRydWV9KVxuICAgIHRhYmxlLmJpZ2ludChcInNjaGVkdWxlX29yZGVyXCIsIHtudWxsOiB0cnVlfSlcbiAgICB0YWJsZS5iaWdpbnQoXCJoYW5kZWRfb2ZmX2F0X21zXCIsIHtudWxsOiB0cnVlLCBpbmRleDogdHJ1ZX0pXG4gICAgdGFibGUuc3RyaW5nKFwiaGFuZG9mZl9pZFwiLCB7bnVsbDogdHJ1ZX0pXG4gICAgdGFibGUuYmlnaW50KFwiY29tcGxldGVkX2F0X21zXCIsIHtudWxsOiB0cnVlfSlcbiAgICB0YWJsZS5iaWdpbnQoXCJmYWlsZWRfYXRfbXNcIiwge251bGw6IHRydWV9KVxuICAgIHRhYmxlLmJpZ2ludChcIm9ycGhhbmVkX2F0X21zXCIsIHtudWxsOiB0cnVlLCBpbmRleDogdHJ1ZX0pXG4gICAgdGFibGUuc3RyaW5nKFwid29ya2VyX2lkXCIsIHtudWxsOiB0cnVlfSlcbiAgICB0YWJsZS50ZXh0KFwibGFzdF9lcnJvclwiLCB7bnVsbDogdHJ1ZX0pXG4gICAgdGFibGUuc3RyaW5nKFwiY29uY3VycmVuY3lfa2V5XCIsIHtudWxsOiB0cnVlLCBpbmRleDogdHJ1ZX0pXG4gICAgdGFibGUuaW50ZWdlcihcIm1heF9jb25jdXJyZW5jeVwiLCB7bnVsbDogdHJ1ZX0pXG4gICAgdGFibGUuYmlnaW50KFwidGltZW91dF9tc1wiLCB7bnVsbDogdHJ1ZX0pXG4gICAgdGFibGUuYmlnaW50KFwiY2hpbGRfcmVjZWl2ZWRfYXRfbXNcIiwge251bGw6IHRydWV9KVxuICAgIHRhYmxlLmJpZ2ludChcImNoaWxkX3N0YXJ0ZWRfYXRfbXNcIiwge251bGw6IHRydWV9KVxuICAgIHRhYmxlLnN0cmluZyhcImNoaWxkX2luc3RhbmNlX2lkXCIsIHtudWxsOiB0cnVlfSlcbiAgICB0YWJsZS5pbnRlZ2VyKFwiY2hpbGRfcGlkXCIsIHtudWxsOiB0cnVlfSlcblxuICAgIGF3YWl0IGRiLmNyZWF0ZVRhYmxlKHRhYmxlKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZW5zdXJlIGpvYnMgdGFibGUgY29sdW1ucy5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9kYXRhYmFzZS9kcml2ZXJzL2Jhc2UuanNcIikuZGVmYXVsdH0gZGIgLSBEYXRhYmFzZSBjb25uZWN0aW9uLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyB3aGVuIGNvbXBsZXRlLlxuICAgKi9cbiAgYXN5bmMgX2Vuc3VyZUpvYnNUYWJsZUNvbHVtbnMoZGIpIHtcbiAgICBpZiAoIShhd2FpdCBkYi50YWJsZUV4aXN0cyhKT0JTX1RBQkxFKSkpIHJldHVyblxuXG4gICAgY29uc3QgdGFibGUgPSBhd2FpdCBkYi5nZXRUYWJsZUJ5TmFtZU9yRmFpbChKT0JTX1RBQkxFKVxuICAgIGNvbnN0IGV4ZWN1dGlvbk1vZGVDb2x1bW4gPSBhd2FpdCB0YWJsZS5nZXRDb2x1bW5CeU5hbWUoXCJleGVjdXRpb25fbW9kZVwiKVxuXG4gICAgaWYgKCFleGVjdXRpb25Nb2RlQ29sdW1uKSB7XG4gICAgICBjb25zdCB0YWJsZURhdGEgPSBuZXcgVGFibGVEYXRhKEpPQlNfVEFCTEUpXG4gICAgICB0YWJsZURhdGEuc3RyaW5nKFwiZXhlY3V0aW9uX21vZGVcIiwge251bGw6IHRydWV9KVxuICAgICAgY29uc3Qgc3FscyA9IGF3YWl0IGRiLmFsdGVyVGFibGVTUUxzKHRhYmxlRGF0YSlcblxuICAgICAgZm9yIChjb25zdCBzcWwgb2Ygc3Fscykge1xuICAgICAgICBhd2FpdCBkYi5xdWVyeShzcWwpXG4gICAgICB9XG5cbiAgICAgIGRiLmNsZWFyU2NoZW1hQ2FjaGUoKVxuICAgIH1cblxuICAgIGNvbnN0IHJlZnJlc2hlZFRhYmxlID0gYXdhaXQgZGIuZ2V0VGFibGVCeU5hbWVPckZhaWwoSk9CU19UQUJMRSlcbiAgICBjb25zdCBoYW5kb2ZmSWRDb2x1bW4gPSBhd2FpdCByZWZyZXNoZWRUYWJsZS5nZXRDb2x1bW5CeU5hbWUoXCJoYW5kb2ZmX2lkXCIpXG5cbiAgICBpZiAoIWhhbmRvZmZJZENvbHVtbikge1xuICAgICAgY29uc3QgbG9ja05hbWUgPSBgJHtNSUdSQVRJT05fU0NPUEV9OmhhbmRvZmZfaWRfY29sdW1uYFxuICAgICAgY29uc3QgYWNxdWlyZWQgPSBhd2FpdCBkYi5hY3F1aXJlQWR2aXNvcnlMb2NrKGxvY2tOYW1lKVxuXG4gICAgICBpZiAoIWFjcXVpcmVkKSB0aHJvdyBuZXcgRXJyb3IoXCJGYWlsZWQgdG8gYWNxdWlyZSBiYWNrZ3JvdW5kIGpvYnMgaGFuZG9mZiBzY2hlbWEgbG9ja1wiKVxuXG4gICAgICB0cnkge1xuICAgICAgICBkYi5jbGVhclNjaGVtYUNhY2hlKClcbiAgICAgICAgY29uc3QgbG9ja2VkVGFibGUgPSBhd2FpdCBkYi5nZXRUYWJsZUJ5TmFtZU9yRmFpbChKT0JTX1RBQkxFKVxuXG4gICAgICAgIGlmICghKGF3YWl0IGxvY2tlZFRhYmxlLmdldENvbHVtbkJ5TmFtZShcImhhbmRvZmZfaWRcIikpKSB7XG4gICAgICAgICAgY29uc3QgdGFibGVEYXRhID0gbmV3IFRhYmxlRGF0YShKT0JTX1RBQkxFKVxuICAgICAgICAgIHRhYmxlRGF0YS5zdHJpbmcoXCJoYW5kb2ZmX2lkXCIsIHtudWxsOiB0cnVlfSlcbiAgICAgICAgICBjb25zdCBzcWxzID0gYXdhaXQgZGIuYWx0ZXJUYWJsZVNRTHModGFibGVEYXRhKVxuXG4gICAgICAgICAgZm9yIChjb25zdCBzcWwgb2Ygc3Fscykge1xuICAgICAgICAgICAgYXdhaXQgZGIucXVlcnkoc3FsKVxuICAgICAgICAgIH1cblxuICAgICAgICAgIGRiLmNsZWFyU2NoZW1hQ2FjaGUoKVxuICAgICAgICB9XG4gICAgICB9IGZpbmFsbHkge1xuICAgICAgICBhd2FpdCBkYi5yZWxlYXNlQWR2aXNvcnlMb2NrKGxvY2tOYW1lKVxuICAgICAgfVxuICAgIH1cblxuICAgIGF3YWl0IHRoaXMuX2JhY2tmaWxsRXhlY3V0aW9uTW9kZXNPbmNlKGRiKVxuICAgIGF3YWl0IHRoaXMuX2Ryb3BGb3JrZWRDb2x1bW5PbmNlKGRiKVxuXG4gICAgY29uc3QgbG9ja05hbWUgPSBgJHtNSUdSQVRJT05fU0NPUEV9OmNvbmN1cnJlbmN5X2NvbHVtbnNgXG4gICAgY29uc3QgYWNxdWlyZWQgPSBhd2FpdCBkYi5hY3F1aXJlQWR2aXNvcnlMb2NrKGxvY2tOYW1lKVxuXG4gICAgaWYgKCFhY3F1aXJlZCkgdGhyb3cgbmV3IEVycm9yKFwiRmFpbGVkIHRvIGFjcXVpcmUgYmFja2dyb3VuZCBqb2JzIGNvbmN1cnJlbmN5IHNjaGVtYSBsb2NrXCIpXG5cbiAgICB0cnkge1xuICAgICAgLy8gU1FMIFNlcnZlciBzY2hlbWEgcmVhZHMgY2FuIGRlYWRsb2NrIHdpdGggYSBjb25jdXJyZW50IEFMVEVSIFRBQkxFLCBzb1xuICAgICAgLy8gYWNxdWlyZSB0aGUgbG9jayBiZWZvcmUgaW5zcGVjdGluZyBlaXRoZXIgY29sdW1uIHJhdGhlciB0aGFuIG9ubHlcbiAgICAgIC8vIHByb3RlY3RpbmcgdGhlIG11dGF0aW9uLlxuICAgICAgZGIuY2xlYXJTY2hlbWFDYWNoZSgpXG4gICAgICBjb25zdCBsb2NrZWRUYWJsZSA9IGF3YWl0IGRiLmdldFRhYmxlQnlOYW1lT3JGYWlsKEpPQlNfVEFCTEUpXG4gICAgICBjb25zdCBjb25jdXJyZW5jeUNvbHVtbk5hbWVzID0gW1wiY29uY3VycmVuY3lfa2V5XCIsIFwibWF4X2NvbmN1cnJlbmN5XCJdXG5cbiAgICAgIGZvciAoY29uc3QgY29uY3VycmVuY3lDb2x1bW5OYW1lIG9mIGNvbmN1cnJlbmN5Q29sdW1uTmFtZXMpIHtcbiAgICAgICAgaWYgKGF3YWl0IGxvY2tlZFRhYmxlLmdldENvbHVtbkJ5TmFtZShjb25jdXJyZW5jeUNvbHVtbk5hbWUpKSBjb250aW51ZVxuXG4gICAgICAgIGNvbnN0IHRhYmxlRGF0YSA9IG5ldyBUYWJsZURhdGEoSk9CU19UQUJMRSlcbiAgICAgICAgaWYgKGNvbmN1cnJlbmN5Q29sdW1uTmFtZSA9PSBcImNvbmN1cnJlbmN5X2tleVwiKSB7XG4gICAgICAgICAgdGFibGVEYXRhLnN0cmluZyhcImNvbmN1cnJlbmN5X2tleVwiLCB7bnVsbDogdHJ1ZSwgaW5kZXg6IHRydWV9KVxuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgIHRhYmxlRGF0YS5pbnRlZ2VyKFwibWF4X2NvbmN1cnJlbmN5XCIsIHtudWxsOiB0cnVlfSlcbiAgICAgICAgfVxuXG4gICAgICAgIGZvciAoY29uc3Qgc3FsIG9mIGF3YWl0IGRiLmFsdGVyVGFibGVTUUxzKHRhYmxlRGF0YSkpIGF3YWl0IGRiLnF1ZXJ5KHNxbClcbiAgICAgIH1cblxuICAgICAgZGIuY2xlYXJTY2hlbWFDYWNoZSgpXG4gICAgfSBmaW5hbGx5IHtcbiAgICAgIGF3YWl0IGRiLnJlbGVhc2VBZHZpc29yeUxvY2sobG9ja05hbWUpXG4gICAgfVxuXG4gICAgYXdhaXQgdGhpcy5fZW5zdXJlUXVldWVDb2x1bW4oZGIpXG4gICAgYXdhaXQgdGhpcy5fZW5zdXJlU2NoZWR1bGVLZXlDb2x1bW4oZGIpXG4gICAgYXdhaXQgdGhpcy5fZW5zdXJlU2NoZWR1bGVPcmRlckNvbHVtbihkYilcbiAgICBhd2FpdCB0aGlzLl9lbnN1cmVTY2hlZHVsZU9yZGVyV2F0ZXJtYXJrc1RhYmxlKGRiKVxuICAgIGF3YWl0IHRoaXMuX2Vuc3VyZUpvYlRpbWVvdXRDb2x1bW4oZGIpXG4gICAgYXdhaXQgdGhpcy5fZW5zdXJlQ2hpbGRBY2NlcHRhbmNlQ29sdW1ucyhkYilcbiAgICBhd2FpdCB0aGlzLl9lbnN1cmVKb2JzVGFibGVJbmRleGVzT25jZShkYilcbiAgfVxuXG4gIC8qKlxuICAgKiBJZGVtcG90ZW50bHkgYWRkcyB0aGUgcG9vbGVkLWNoaWxkIGFjY2VwdGFuY2UgZXZpZGVuY2UgY29sdW1ucyB0byBleGlzdGluZ1xuICAgKiBqb2IgdGFibGVzLiBUaGV5IHJlY29yZCB3aGVuIHRoZSBleGVjdXRpbmcgcnVubmVyIGNoaWxkIHJlY2VpdmVkIGFuZFxuICAgKiBzdGFydGVkIGEgam9iIHBsdXMgdGhhdCBjaGlsZCdzIGlkZW50aXR5LCBzbyBhIGhhbmRlZC1vZmYgam9iIGNhbiBiZSB0b2xkXG4gICAqIGFwYXJ0IGZyb20gb25lIHdob3NlIHJ1bm5lciBuZXZlciBwaWNrZWQgaXQgdXAuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vZGF0YWJhc2UvZHJpdmVycy9iYXNlLmpzXCIpLmRlZmF1bHR9IGRiIC0gRGF0YWJhc2UgY29ubmVjdGlvbi5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgd2hlbiBlbnN1cmVkLlxuICAgKi9cbiAgYXN5bmMgX2Vuc3VyZUNoaWxkQWNjZXB0YW5jZUNvbHVtbnMoZGIpIHtcbiAgICBjb25zdCBsb2NrTmFtZSA9IGAke01JR1JBVElPTl9TQ09QRX06Y2hpbGRfYWNjZXB0YW5jZV9jb2x1bW5zYFxuICAgIGNvbnN0IGFjcXVpcmVkID0gYXdhaXQgZGIuYWNxdWlyZUFkdmlzb3J5TG9jayhsb2NrTmFtZSlcblxuICAgIGlmICghYWNxdWlyZWQpIHRocm93IG5ldyBFcnJvcihcIkZhaWxlZCB0byBhY3F1aXJlIGJhY2tncm91bmQgam9icyBjaGlsZC1hY2NlcHRhbmNlIHNjaGVtYSBsb2NrXCIpXG5cbiAgICB0cnkge1xuICAgICAgZGIuY2xlYXJTY2hlbWFDYWNoZSgpXG4gICAgICBjb25zdCB0YWJsZSA9IGF3YWl0IGRiLmdldFRhYmxlQnlOYW1lT3JGYWlsKEpPQlNfVEFCTEUpXG4gICAgICBjb25zdCB0YWJsZURhdGEgPSBuZXcgVGFibGVEYXRhKEpPQlNfVEFCTEUpXG4gICAgICBsZXQgYWRkZWQgPSBmYWxzZVxuXG4gICAgICBpZiAoIShhd2FpdCB0YWJsZS5nZXRDb2x1bW5CeU5hbWUoXCJjaGlsZF9yZWNlaXZlZF9hdF9tc1wiKSkpIHtcbiAgICAgICAgdGFibGVEYXRhLmJpZ2ludChcImNoaWxkX3JlY2VpdmVkX2F0X21zXCIsIHtudWxsOiB0cnVlfSlcbiAgICAgICAgYWRkZWQgPSB0cnVlXG4gICAgICB9XG4gICAgICBpZiAoIShhd2FpdCB0YWJsZS5nZXRDb2x1bW5CeU5hbWUoXCJjaGlsZF9zdGFydGVkX2F0X21zXCIpKSkge1xuICAgICAgICB0YWJsZURhdGEuYmlnaW50KFwiY2hpbGRfc3RhcnRlZF9hdF9tc1wiLCB7bnVsbDogdHJ1ZX0pXG4gICAgICAgIGFkZGVkID0gdHJ1ZVxuICAgICAgfVxuICAgICAgaWYgKCEoYXdhaXQgdGFibGUuZ2V0Q29sdW1uQnlOYW1lKFwiY2hpbGRfaW5zdGFuY2VfaWRcIikpKSB7XG4gICAgICAgIHRhYmxlRGF0YS5zdHJpbmcoXCJjaGlsZF9pbnN0YW5jZV9pZFwiLCB7bnVsbDogdHJ1ZX0pXG4gICAgICAgIGFkZGVkID0gdHJ1ZVxuICAgICAgfVxuICAgICAgaWYgKCEoYXdhaXQgdGFibGUuZ2V0Q29sdW1uQnlOYW1lKFwiY2hpbGRfcGlkXCIpKSkge1xuICAgICAgICB0YWJsZURhdGEuaW50ZWdlcihcImNoaWxkX3BpZFwiLCB7bnVsbDogdHJ1ZX0pXG4gICAgICAgIGFkZGVkID0gdHJ1ZVxuICAgICAgfVxuXG4gICAgICBpZiAoYWRkZWQpIHtcbiAgICAgICAgZm9yIChjb25zdCBzcWwgb2YgYXdhaXQgZGIuYWx0ZXJUYWJsZVNRTHModGFibGVEYXRhKSkgYXdhaXQgZGIucXVlcnkoc3FsKVxuICAgICAgICBkYi5jbGVhclNjaGVtYUNhY2hlKClcbiAgICAgIH1cbiAgICB9IGZpbmFsbHkge1xuICAgICAgYXdhaXQgZGIucmVsZWFzZUFkdmlzb3J5TG9jayhsb2NrTmFtZSlcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogUmVwYWlycyBzZWNvbmRhcnkgaW5kZXhlcyB0aGF0IG9sZGVyIGFkZC1jb2x1bW4gdXBncmFkZXMgZGVjbGFyZWQgYnV0IGRpZFxuICAgKiBub3QgY3JlYXRlIG9uIGV2ZXJ5IFNRTCBkcml2ZXIuIFRoZSBtaWdyYXRpb24gbGVkZ2VyIGtlZXBzIHJvdXRpbmUgc3RvcmVcbiAgICogcmVhZGluZXNzIGZyb20gcmVwZWF0ZWRseSBpbnRyb3NwZWN0aW5nIHRoZSBmdWxsIGluZGV4IHNldC5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9kYXRhYmFzZS9kcml2ZXJzL2Jhc2UuanNcIikuZGVmYXVsdH0gZGIgLSBEYXRhYmFzZSBjb25uZWN0aW9uLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyB3aGVuIGFsbCBleHBlY3RlZCBpbmRleGVzIGV4aXN0LlxuICAgKi9cbiAgYXN5bmMgX2Vuc3VyZUpvYnNUYWJsZUluZGV4ZXNPbmNlKGRiKSB7XG4gICAgY29uc3QgbWlncmF0aW9uVmVyc2lvbiA9IEpPQlNfSU5ERVhfUkVQQUlSX01JR1JBVElPTl9WRVJTSU9OXG4gICAgY29uc3QgbWlncmF0aW9uS2V5ID0gdGhpcy5fbWlncmF0aW9uS2V5KG1pZ3JhdGlvblZlcnNpb24pXG5cbiAgICBpZiAoYXdhaXQgdGhpcy5faGFzTWlncmF0aW9uKGRiLCBtaWdyYXRpb25WZXJzaW9uKSkgcmV0dXJuXG5cbiAgICBjb25zdCBhY3F1aXJlZCA9IGF3YWl0IGRiLmFjcXVpcmVBZHZpc29yeUxvY2sobWlncmF0aW9uS2V5KVxuXG4gICAgaWYgKCFhY3F1aXJlZCkgdGhyb3cgbmV3IEVycm9yKFwiRmFpbGVkIHRvIGFjcXVpcmUgYmFja2dyb3VuZCBqb2JzIGluZGV4IHJlcGFpciBsb2NrXCIpXG5cbiAgICB0cnkge1xuICAgICAgaWYgKGF3YWl0IHRoaXMuX2hhc01pZ3JhdGlvbihkYiwgbWlncmF0aW9uVmVyc2lvbikpIHJldHVyblxuXG4gICAgICBkYi5jbGVhclNjaGVtYUNhY2hlKClcbiAgICAgIGNvbnN0IHRhYmxlID0gYXdhaXQgZGIuZ2V0VGFibGVCeU5hbWVPckZhaWwoSk9CU19UQUJMRSlcbiAgICAgIGNvbnN0IGluZGV4ZWRDb2x1bW5OYW1lcyA9IG5ldyBTZXQoXG4gICAgICAgIChhd2FpdCB0YWJsZS5nZXRJbmRleGVzKCkpXG4gICAgICAgICAgLmZpbHRlcigoaW5kZXgpID0+ICFpbmRleC5pc1ByaW1hcnlLZXkoKSAmJiBpbmRleC5nZXRDb2x1bW5OYW1lcygpLmxlbmd0aCA9PT0gMSlcbiAgICAgICAgICAubWFwKChpbmRleCkgPT4gaW5kZXguZ2V0Q29sdW1uTmFtZXMoKVswXSlcbiAgICAgIClcblxuICAgICAgZm9yIChjb25zdCBjb2x1bW5OYW1lIG9mIEpPQlNfSU5ERVhfQ09MVU1OX05BTUVTKSB7XG4gICAgICAgIGlmIChpbmRleGVkQ29sdW1uTmFtZXMuaGFzKGNvbHVtbk5hbWUpKSBjb250aW51ZVxuXG4gICAgICAgIGZvciAoY29uc3Qgc3FsIG9mIGF3YWl0IGRiLmNyZWF0ZUluZGV4U1FMcyh7Y29sdW1uczogW2NvbHVtbk5hbWVdLCBpZk5vdEV4aXN0czogZGIuZ2V0VHlwZSgpID09PSBcInNxbGl0ZVwiLCB0YWJsZU5hbWU6IEpPQlNfVEFCTEV9KSkge1xuICAgICAgICAgIGF3YWl0IGRiLnF1ZXJ5KHNxbClcbiAgICAgICAgfVxuICAgICAgfVxuXG4gICAgICBkYi5jbGVhclNjaGVtYUNhY2hlKClcbiAgICAgIGF3YWl0IHRoaXMuX3JlY29yZE1pZ3JhdGlvbihkYiwgbWlncmF0aW9uVmVyc2lvbilcbiAgICB9IGZpbmFsbHkge1xuICAgICAgYXdhaXQgZGIucmVsZWFzZUFkdmlzb3J5TG9jayhtaWdyYXRpb25LZXkpXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIElkZW1wb3RlbnRseSBhZGRzIHRoZSBwZXItam9iIHdhbGwtY2xvY2sgdGltZW91dCB0byBleGlzdGluZyBqb2IgdGFibGVzLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL2RhdGFiYXNlL2RyaXZlcnMvYmFzZS5qc1wiKS5kZWZhdWx0fSBkYiAtIERhdGFiYXNlIGNvbm5lY3Rpb24uXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIHdoZW4gZW5zdXJlZC5cbiAgICovXG4gIGFzeW5jIF9lbnN1cmVKb2JUaW1lb3V0Q29sdW1uKGRiKSB7XG4gICAgY29uc3QgbG9ja05hbWUgPSBgJHtNSUdSQVRJT05fU0NPUEV9OnRpbWVvdXRfbXNfY29sdW1uYFxuICAgIGNvbnN0IGFjcXVpcmVkID0gYXdhaXQgZGIuYWNxdWlyZUFkdmlzb3J5TG9jayhsb2NrTmFtZSlcblxuICAgIGlmICghYWNxdWlyZWQpIHRocm93IG5ldyBFcnJvcihcIkZhaWxlZCB0byBhY3F1aXJlIGJhY2tncm91bmQgam9icyB0aW1lb3V0IHNjaGVtYSBsb2NrXCIpXG5cbiAgICB0cnkge1xuICAgICAgZGIuY2xlYXJTY2hlbWFDYWNoZSgpXG4gICAgICBjb25zdCB0YWJsZSA9IGF3YWl0IGRiLmdldFRhYmxlQnlOYW1lT3JGYWlsKEpPQlNfVEFCTEUpXG5cbiAgICAgIGlmICghKGF3YWl0IHRhYmxlLmdldENvbHVtbkJ5TmFtZShcInRpbWVvdXRfbXNcIikpKSB7XG4gICAgICAgIGNvbnN0IHRhYmxlRGF0YSA9IG5ldyBUYWJsZURhdGEoSk9CU19UQUJMRSlcbiAgICAgICAgdGFibGVEYXRhLmJpZ2ludChcInRpbWVvdXRfbXNcIiwge251bGw6IHRydWV9KVxuXG4gICAgICAgIGZvciAoY29uc3Qgc3FsIG9mIGF3YWl0IGRiLmFsdGVyVGFibGVTUUxzKHRhYmxlRGF0YSkpIGF3YWl0IGRiLnF1ZXJ5KHNxbClcblxuICAgICAgICBkYi5jbGVhclNjaGVtYUNhY2hlKClcbiAgICAgIH1cbiAgICB9IGZpbmFsbHkge1xuICAgICAgYXdhaXQgZGIucmVsZWFzZUFkdmlzb3J5TG9jayhsb2NrTmFtZSlcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogSWRlbXBvdGVudGx5IGFkZHMgdGhlIGhpc3RvcmljYWwgc3RhYmxlIHNjaGVkdWxlIGtleSB0byBleGlzdGluZyBqb2JzLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL2RhdGFiYXNlL2RyaXZlcnMvYmFzZS5qc1wiKS5kZWZhdWx0fSBkYiAtIERhdGFiYXNlIGNvbm5lY3Rpb24uXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIHdoZW4gZW5zdXJlZC5cbiAgICovXG4gIGFzeW5jIF9lbnN1cmVTY2hlZHVsZUtleUNvbHVtbihkYikge1xuICAgIGNvbnN0IGxvY2tOYW1lID0gYCR7TUlHUkFUSU9OX1NDT1BFfTpzY2hlZHVsZV9rZXlfY29sdW1uYFxuICAgIGNvbnN0IGFjcXVpcmVkID0gYXdhaXQgZGIuYWNxdWlyZUFkdmlzb3J5TG9jayhsb2NrTmFtZSlcblxuICAgIGlmICghYWNxdWlyZWQpIHRocm93IG5ldyBFcnJvcihcIkZhaWxlZCB0byBhY3F1aXJlIGJhY2tncm91bmQgam9icyBzY2hlZHVsZS1rZXkgc2NoZW1hIGxvY2tcIilcblxuICAgIHRyeSB7XG4gICAgICBkYi5jbGVhclNjaGVtYUNhY2hlKClcbiAgICAgIGNvbnN0IGxvY2tlZFRhYmxlID0gYXdhaXQgZGIuZ2V0VGFibGVCeU5hbWVPckZhaWwoSk9CU19UQUJMRSlcblxuICAgICAgaWYgKCEoYXdhaXQgbG9ja2VkVGFibGUuZ2V0Q29sdW1uQnlOYW1lKFwic2NoZWR1bGVfa2V5XCIpKSkge1xuICAgICAgICBjb25zdCB0YWJsZURhdGEgPSBuZXcgVGFibGVEYXRhKEpPQlNfVEFCTEUpXG5cbiAgICAgICAgdGFibGVEYXRhLnN0cmluZyhcInNjaGVkdWxlX2tleVwiLCB7bnVsbDogdHJ1ZSwgaW5kZXg6IHRydWV9KVxuXG4gICAgICAgIGZvciAoY29uc3Qgc3FsIG9mIGF3YWl0IGRiLmFsdGVyVGFibGVTUUxzKHRhYmxlRGF0YSkpIGF3YWl0IGRiLnF1ZXJ5KHNxbClcblxuICAgICAgICBkYi5jbGVhclNjaGVtYUNhY2hlKClcbiAgICAgIH1cbiAgICB9IGZpbmFsbHkge1xuICAgICAgYXdhaXQgZGIucmVsZWFzZUFkdmlzb3J5TG9jayhsb2NrTmFtZSlcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogSWRlbXBvdGVudGx5IGFkZHMgbW9ub3RvbmljIHNjaGVkdWxlIG93bmVyc2hpcCBoaXN0b3J5IGFuZCBpdHMgbG9va3VwIGluZGV4LlxuICAgKiBFeGlzdGluZyByb3dzIHJlbWFpbiBudWxsIGFuZCB1c2UgdGhlIGRvY3VtZW50ZWQgbGVnYWN5IGZhbGxiYWNrIG9yZGVyaW5nLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL2RhdGFiYXNlL2RyaXZlcnMvYmFzZS5qc1wiKS5kZWZhdWx0fSBkYiAtIERhdGFiYXNlIGNvbm5lY3Rpb24uXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIHdoZW4gZW5zdXJlZC5cbiAgICovXG4gIGFzeW5jIF9lbnN1cmVTY2hlZHVsZU9yZGVyQ29sdW1uKGRiKSB7XG4gICAgY29uc3QgbG9ja05hbWUgPSBgJHtNSUdSQVRJT05fU0NPUEV9OnNjaGVkdWxlX29yZGVyX2NvbHVtbmBcbiAgICBjb25zdCBhY3F1aXJlZCA9IGF3YWl0IGRiLmFjcXVpcmVBZHZpc29yeUxvY2sobG9ja05hbWUpXG5cbiAgICBpZiAoIWFjcXVpcmVkKSB0aHJvdyBuZXcgRXJyb3IoXCJGYWlsZWQgdG8gYWNxdWlyZSBiYWNrZ3JvdW5kIGpvYnMgc2NoZWR1bGUtb3JkZXIgc2NoZW1hIGxvY2tcIilcblxuICAgIHRyeSB7XG4gICAgICBkYi5jbGVhclNjaGVtYUNhY2hlKClcbiAgICAgIGxldCB0YWJsZSA9IGF3YWl0IGRiLmdldFRhYmxlQnlOYW1lT3JGYWlsKEpPQlNfVEFCTEUpXG5cbiAgICAgIGlmICghKGF3YWl0IHRhYmxlLmdldENvbHVtbkJ5TmFtZShcInNjaGVkdWxlX29yZGVyXCIpKSkge1xuICAgICAgICBjb25zdCB0YWJsZURhdGEgPSBuZXcgVGFibGVEYXRhKEpPQlNfVEFCTEUpXG5cbiAgICAgICAgdGFibGVEYXRhLmJpZ2ludChcInNjaGVkdWxlX29yZGVyXCIsIHtudWxsOiB0cnVlfSlcbiAgICAgICAgZm9yIChjb25zdCBzcWwgb2YgYXdhaXQgZGIuYWx0ZXJUYWJsZVNRTHModGFibGVEYXRhKSkgYXdhaXQgZGIucXVlcnkoc3FsKVxuICAgICAgICBkYi5jbGVhclNjaGVtYUNhY2hlKClcbiAgICAgICAgdGFibGUgPSBhd2FpdCBkYi5nZXRUYWJsZUJ5TmFtZU9yRmFpbChKT0JTX1RBQkxFKVxuICAgICAgfVxuXG4gICAgICBjb25zdCBpbmRleE5hbWVzID0gbmV3IFNldCgoYXdhaXQgdGFibGUuZ2V0SW5kZXhlcygpKS5tYXAoKGluZGV4KSA9PiBpbmRleC5nZXROYW1lKCkpKVxuXG4gICAgICBpZiAoIWluZGV4TmFtZXMuaGFzKFNDSEVEVUxFX0hJU1RPUllfT1JERVJfSU5ERVgpKSB7XG4gICAgICAgIGNvbnN0IHNxbHMgPSBhd2FpdCBkYi5jcmVhdGVJbmRleFNRTHMoe1xuICAgICAgICAgIGNvbHVtbnM6IFtcInNjaGVkdWxlX2tleVwiLCBcInNjaGVkdWxlX29yZGVyXCIsIFwiY3JlYXRlZF9hdF9tc1wiLCBcImlkXCJdLFxuICAgICAgICAgIGlmTm90RXhpc3RzOiBkYi5nZXRUeXBlKCkgPT09IFwic3FsaXRlXCIsXG4gICAgICAgICAgbmFtZTogU0NIRURVTEVfSElTVE9SWV9PUkRFUl9JTkRFWCxcbiAgICAgICAgICB0YWJsZU5hbWU6IEpPQlNfVEFCTEVcbiAgICAgICAgfSlcblxuICAgICAgICBmb3IgKGNvbnN0IHNxbCBvZiBzcWxzKSBhd2FpdCBkYi5xdWVyeShzcWwpXG4gICAgICAgIGRiLmNsZWFyU2NoZW1hQ2FjaGUoKVxuICAgICAgfVxuICAgIH0gZmluYWxseSB7XG4gICAgICBhd2FpdCBkYi5yZWxlYXNlQWR2aXNvcnlMb2NrKGxvY2tOYW1lKVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBDcmVhdGVzIHRoZSByZXRlbnRpb24taW5kZXBlbmRlbnQgc2NoZWR1bGUtb3JkZXIgaGlnaC13YXRlciB0YWJsZSBhbmRcbiAgICogaW5pdGlhbGl6ZXMgaXQgZnJvbSB0aGUgZ3JlYXRlc3QgcmV0YWluZWQgb3JkZXJlZCByb3cgZm9yIGV2ZXJ5IGtleS5cbiAgICogTGVnYWN5IHJvd3Mgd2hvc2Ugb3JkZXIgaXMgbnVsbCBkZWxpYmVyYXRlbHkgZG8gbm90IGVzdGFibGlzaCBhIHdhdGVybWFyay5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9kYXRhYmFzZS9kcml2ZXJzL2Jhc2UuanNcIikuZGVmYXVsdH0gZGIgLSBEYXRhYmFzZSBjb25uZWN0aW9uLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyB3aGVuIGVuc3VyZWQgYW5kIGJhY2tmaWxsZWQuXG4gICAqL1xuICBhc3luYyBfZW5zdXJlU2NoZWR1bGVPcmRlcldhdGVybWFya3NUYWJsZShkYikge1xuICAgIGNvbnN0IG1pZ3JhdGlvblZlcnNpb24gPSBTQ0hFRFVMRV9PUkRFUl9XQVRFUk1BUktfTUlHUkFUSU9OX1ZFUlNJT05cbiAgICBjb25zdCBtaWdyYXRpb25LZXkgPSB0aGlzLl9taWdyYXRpb25LZXkobWlncmF0aW9uVmVyc2lvbilcbiAgICBjb25zdCB0YWJsZUV4aXN0cyA9IGF3YWl0IGRiLnRhYmxlRXhpc3RzKFNDSEVEVUxFX09SREVSX1dBVEVSTUFSS1NfVEFCTEUpXG5cbiAgICBpZiAodGFibGVFeGlzdHMgJiYgYXdhaXQgdGhpcy5faGFzTWlncmF0aW9uKGRiLCBtaWdyYXRpb25WZXJzaW9uKSkgcmV0dXJuXG5cbiAgICBjb25zdCBhY3F1aXJlZCA9IGF3YWl0IGRiLmFjcXVpcmVBZHZpc29yeUxvY2sobWlncmF0aW9uS2V5KVxuXG4gICAgaWYgKCFhY3F1aXJlZCkgdGhyb3cgbmV3IEVycm9yKFwiRmFpbGVkIHRvIGFjcXVpcmUgYmFja2dyb3VuZCBqb2JzIHNjaGVkdWxlLW9yZGVyIHdhdGVybWFyayBzY2hlbWEgbG9ja1wiKVxuXG4gICAgdHJ5IHtcbiAgICAgIGRiLmNsZWFyU2NoZW1hQ2FjaGUoKVxuICAgICAgY29uc3QgbG9ja2VkVGFibGVFeGlzdHMgPSBhd2FpdCBkYi50YWJsZUV4aXN0cyhTQ0hFRFVMRV9PUkRFUl9XQVRFUk1BUktTX1RBQkxFKVxuICAgICAgY29uc3QgYWxyZWFkeUFwcGxpZWQgPSBhd2FpdCB0aGlzLl9oYXNNaWdyYXRpb24oZGIsIG1pZ3JhdGlvblZlcnNpb24pXG5cbiAgICAgIGlmICghbG9ja2VkVGFibGVFeGlzdHMpIHtcbiAgICAgICAgY29uc3QgdGFibGUgPSBuZXcgVGFibGVEYXRhKFNDSEVEVUxFX09SREVSX1dBVEVSTUFSS1NfVEFCTEUsIHtpZk5vdEV4aXN0czogdHJ1ZX0pXG5cbiAgICAgICAgdGFibGUuc3RyaW5nKFwic2NoZWR1bGVfa2V5XCIsIHtwcmltYXJ5S2V5OiB0cnVlfSlcbiAgICAgICAgdGFibGUuYmlnaW50KFwiaGlnaF93YXRlcl9tYXJrXCIsIHtudWxsOiBmYWxzZX0pXG4gICAgICAgIGF3YWl0IGRiLmNyZWF0ZVRhYmxlKHRhYmxlKVxuICAgICAgICBkYi5jbGVhclNjaGVtYUNhY2hlKClcbiAgICAgIH1cblxuICAgICAgLy8gUmVidWlsZCBhIG1pc3NpbmcgdGFibGUgZXZlbiB3aGVuIGl0cyBtaWdyYXRpb24gbGVkZ2VyIHN1cnZpdmVkLiBUaGVcbiAgICAgIC8vIHJldGFpbmVkIGpvYiByb3dzIGFyZSB0aGUgb25seSBjb21wYXRpYmxlIHNvdXJjZSBmb3IgdGhhdCByZWNvdmVyeTtcbiAgICAgIC8vIG9uY2Ugcm93cyBhcmUgcHJ1bmVkLCBub3JtYWwgc2NoZW1hIGR1cmFiaWxpdHkgcHJvdGVjdHMgdGhlIHdhdGVybWFyay5cbiAgICAgIGlmICghbG9ja2VkVGFibGVFeGlzdHMgfHwgIWFscmVhZHlBcHBsaWVkKSBhd2FpdCB0aGlzLl9iYWNrZmlsbFNjaGVkdWxlT3JkZXJXYXRlcm1hcmtzKGRiKVxuICAgICAgaWYgKCFhbHJlYWR5QXBwbGllZCkgYXdhaXQgdGhpcy5fcmVjb3JkTWlncmF0aW9uKGRiLCBtaWdyYXRpb25WZXJzaW9uKVxuICAgIH0gZmluYWxseSB7XG4gICAgICBhd2FpdCBkYi5yZWxlYXNlQWR2aXNvcnlMb2NrKG1pZ3JhdGlvbktleSlcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogQmFja2ZpbGxzIGVhY2gga2V5IGZyb20gaXRzIGdyZWF0ZXN0IHJldGFpbmVkIG5vbi1sZWdhY3kgb3duZXJzaGlwIG9yZGVyLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL2RhdGFiYXNlL2RyaXZlcnMvYmFzZS5qc1wiKS5kZWZhdWx0fSBkYiAtIERhdGFiYXNlIGNvbm5lY3Rpb24uXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIGFmdGVyIGFsbCByZXRhaW5lZCBrZXlzIGFyZSByZXByZXNlbnRlZC5cbiAgICovXG4gIGFzeW5jIF9iYWNrZmlsbFNjaGVkdWxlT3JkZXJXYXRlcm1hcmtzKGRiKSB7XG4gICAgY29uc3Qga2V5Um93cyA9IGF3YWl0IGRiXG4gICAgICAubmV3UXVlcnkoKVxuICAgICAgLmZyb20oSk9CU19UQUJMRSlcbiAgICAgIC5zZWxlY3QoXCJzY2hlZHVsZV9rZXlcIilcbiAgICAgIC53aGVyZU5vdCh7c2NoZWR1bGVfa2V5OiBudWxsfSlcbiAgICAgIC53aGVyZU5vdCh7c2NoZWR1bGVfb3JkZXI6IG51bGx9KVxuICAgICAgLmRpc3RpbmN0KClcbiAgICAgIC5yZXN1bHRzKClcblxuICAgIGZvciAoY29uc3Qga2V5Um93IG9mIGtleVJvd3MpIHtcbiAgICAgIGNvbnN0IHNjaGVkdWxlS2V5ID0gU3RyaW5nKC8qKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSAqLyAoa2V5Um93KS5zY2hlZHVsZV9rZXkpXG4gICAgICBjb25zdCByZXRhaW5lZE9yZGVyID0gYXdhaXQgdGhpcy5fZ3JlYXRlc3RSZXRhaW5lZFNjaGVkdWxlT3JkZXIoZGIsIHNjaGVkdWxlS2V5KVxuICAgICAgY29uc3QgY3VycmVudFdhdGVybWFyayA9IGF3YWl0IHRoaXMuX3NjaGVkdWxlT3JkZXJXYXRlcm1hcmsoZGIsIHNjaGVkdWxlS2V5KVxuXG4gICAgICBpZiAocmV0YWluZWRPcmRlciA9PT0gbnVsbCkgY29udGludWVcbiAgICAgIGlmIChjdXJyZW50V2F0ZXJtYXJrICE9PSBudWxsICYmIGN1cnJlbnRXYXRlcm1hcmsgPj0gcmV0YWluZWRPcmRlcikgY29udGludWVcbiAgICAgIGF3YWl0IHRoaXMuX3dyaXRlU2NoZWR1bGVPcmRlcldhdGVybWFyayhkYiwge3NjaGVkdWxlS2V5LCBzY2hlZHVsZU9yZGVyOiByZXRhaW5lZE9yZGVyfSlcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogSWRlbXBvdGVudGx5IGFkZHMgdGhlIGBxdWV1ZWAgY29sdW1uIHRvIGFuIGV4aXN0aW5nIGpvYnMgdGFibGUuIEV4aXN0aW5nXG4gICAqIHJvd3MgcmVhZCBiYWNrIGFzIHRoZSBkZWZhdWx0IHF1ZXVlIChzZWUge0BsaW5rIF9ub3JtYWxpemVKb2JSb3d9KSwgc28gbm9cbiAgICogZGF0YSBiYWNrZmlsbCBpcyByZXF1aXJlZC5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9kYXRhYmFzZS9kcml2ZXJzL2Jhc2UuanNcIikuZGVmYXVsdH0gZGIgLSBEYXRhYmFzZSBjb25uZWN0aW9uLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyB3aGVuIGVuc3VyZWQuXG4gICAqL1xuICBhc3luYyBfZW5zdXJlUXVldWVDb2x1bW4oZGIpIHtcbiAgICBjb25zdCBsb2NrTmFtZSA9IGAke01JR1JBVElPTl9TQ09QRX06cXVldWVfY29sdW1uYFxuICAgIGNvbnN0IGFjcXVpcmVkID0gYXdhaXQgZGIuYWNxdWlyZUFkdmlzb3J5TG9jayhsb2NrTmFtZSlcblxuICAgIGlmICghYWNxdWlyZWQpIHRocm93IG5ldyBFcnJvcihcIkZhaWxlZCB0byBhY3F1aXJlIGJhY2tncm91bmQgam9icyBxdWV1ZSBzY2hlbWEgbG9ja1wiKVxuXG4gICAgdHJ5IHtcbiAgICAgIC8vIFNRTCBTZXJ2ZXIgc2NoZW1hIHJlYWRzIGNhbiBkZWFkbG9jayB3aXRoIGEgY29uY3VycmVudCBBTFRFUiBUQUJMRSwgc29cbiAgICAgIC8vIGFjcXVpcmUgdGhlIGxvY2sgYmVmb3JlIGluc3BlY3RpbmcgdGhlIGNvbHVtbiByYXRoZXIgdGhhbiBvbmx5XG4gICAgICAvLyBwcm90ZWN0aW5nIHRoZSBtdXRhdGlvbiAobWlycm9ycyB0aGUgY29uY3VycmVuY3ktY29sdW1uIG1pZ3JhdGlvbikuXG4gICAgICBkYi5jbGVhclNjaGVtYUNhY2hlKClcbiAgICAgIGNvbnN0IGxvY2tlZFRhYmxlID0gYXdhaXQgZGIuZ2V0VGFibGVCeU5hbWVPckZhaWwoSk9CU19UQUJMRSlcblxuICAgICAgaWYgKCEoYXdhaXQgbG9ja2VkVGFibGUuZ2V0Q29sdW1uQnlOYW1lKFwicXVldWVcIikpKSB7XG4gICAgICAgIGNvbnN0IHRhYmxlRGF0YSA9IG5ldyBUYWJsZURhdGEoSk9CU19UQUJMRSlcblxuICAgICAgICB0YWJsZURhdGEuc3RyaW5nKFwicXVldWVcIiwge251bGw6IHRydWUsIGluZGV4OiB0cnVlfSlcblxuICAgICAgICBmb3IgKGNvbnN0IHNxbCBvZiBhd2FpdCBkYi5hbHRlclRhYmxlU1FMcyh0YWJsZURhdGEpKSBhd2FpdCBkYi5xdWVyeShzcWwpXG5cbiAgICAgICAgZGIuY2xlYXJTY2hlbWFDYWNoZSgpXG4gICAgICB9XG4gICAgfSBmaW5hbGx5IHtcbiAgICAgIGF3YWl0IGRiLnJlbGVhc2VBZHZpc29yeUxvY2sobG9ja05hbWUpXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgYmFja2ZpbGwgZXhlY3V0aW9uIG1vZGVzIG9uY2UuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vZGF0YWJhc2UvZHJpdmVycy9iYXNlLmpzXCIpLmRlZmF1bHR9IGRiIC0gRGF0YWJhc2UgY29ubmVjdGlvbi5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgd2hlbiBjb21wbGV0ZS5cbiAgICovXG4gIGFzeW5jIF9iYWNrZmlsbEV4ZWN1dGlvbk1vZGVzT25jZShkYikge1xuICAgIGNvbnN0IG1pZ3JhdGlvblZlcnNpb24gPSBFWEVDVVRJT05fTU9ERV9CQUNLRklMTF9NSUdSQVRJT05fVkVSU0lPTlxuICAgIGNvbnN0IG1pZ3JhdGlvbktleSA9IHRoaXMuX21pZ3JhdGlvbktleShtaWdyYXRpb25WZXJzaW9uKVxuXG4gICAgaWYgKGF3YWl0IHRoaXMuX2hhc01pZ3JhdGlvbihkYiwgbWlncmF0aW9uVmVyc2lvbikpIHJldHVyblxuXG4gICAgYXdhaXQgZGIuYWNxdWlyZUFkdmlzb3J5TG9jayhtaWdyYXRpb25LZXkpXG5cbiAgICB0cnkge1xuICAgICAgaWYgKGF3YWl0IHRoaXMuX2hhc01pZ3JhdGlvbihkYiwgbWlncmF0aW9uVmVyc2lvbikpIHJldHVyblxuXG4gICAgICAvLyBBIHRhYmxlIGNyZWF0ZWQgYWZ0ZXIgdGhlIGBmb3JrZWRgIGNvbHVtbiB3YXMgZHJvcHBlZCBoYXMgbm90aGluZyB0b1xuICAgICAgLy8gYmFja2ZpbGwgZnJvbTsgcmVjb3JkIHRoZSBtaWdyYXRpb24gc28gaXQgaXMgbm90IHJlLWF0dGVtcHRlZC5cbiAgICAgIGRiLmNsZWFyU2NoZW1hQ2FjaGUoKVxuICAgICAgaWYgKCEoYXdhaXQgKGF3YWl0IGRiLmdldFRhYmxlQnlOYW1lT3JGYWlsKEpPQlNfVEFCTEUpKS5nZXRDb2x1bW5CeU5hbWUoXCJmb3JrZWRcIikpKSB7XG4gICAgICAgIGF3YWl0IHRoaXMuX3JlY29yZE1pZ3JhdGlvbihkYiwgbWlncmF0aW9uVmVyc2lvbilcbiAgICAgICAgcmV0dXJuXG4gICAgICB9XG5cbiAgICAgIGNvbnN0IHRhYmxlTmFtZVNxbCA9IGRiLnF1b3RlVGFibGUoSk9CU19UQUJMRSlcbiAgICAgIGNvbnN0IGZvcmtlZENvbHVtblNxbCA9IGRiLnF1b3RlQ29sdW1uKFwiZm9ya2VkXCIpXG4gICAgICBjb25zdCBleGVjdXRpb25Nb2RlQ29sdW1uU3FsID0gZGIucXVvdGVDb2x1bW4oXCJleGVjdXRpb25fbW9kZVwiKVxuXG4gICAgICBhd2FpdCBkYi5xdWVyeShcbiAgICAgICAgYFVQREFURSAke3RhYmxlTmFtZVNxbH0gU0VUICR7ZXhlY3V0aW9uTW9kZUNvbHVtblNxbH0gPSAke2RiLnF1b3RlKFwiZm9ya2VkXCIpfSBgICtcbiAgICAgICAgYFdIRVJFICR7Zm9ya2VkQ29sdW1uU3FsfSA9ICR7ZGIucXVvdGUodHJ1ZSl9IEFORCAke2V4ZWN1dGlvbk1vZGVDb2x1bW5TcWx9IElTIE5VTExgXG4gICAgICApXG4gICAgICBhd2FpdCBkYi5xdWVyeShcbiAgICAgICAgYFVQREFURSAke3RhYmxlTmFtZVNxbH0gU0VUICR7ZXhlY3V0aW9uTW9kZUNvbHVtblNxbH0gPSAke2RiLnF1b3RlKFwiaW5saW5lXCIpfSBgICtcbiAgICAgICAgYFdIRVJFICR7Zm9ya2VkQ29sdW1uU3FsfSA9ICR7ZGIucXVvdGUoZmFsc2UpfSBBTkQgJHtleGVjdXRpb25Nb2RlQ29sdW1uU3FsfSBJUyBOVUxMYFxuICAgICAgKVxuXG4gICAgICBhd2FpdCB0aGlzLl9yZWNvcmRNaWdyYXRpb24oZGIsIG1pZ3JhdGlvblZlcnNpb24pXG4gICAgfSBmaW5hbGx5IHtcbiAgICAgIGF3YWl0IGRiLnJlbGVhc2VBZHZpc29yeUxvY2sobWlncmF0aW9uS2V5KVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBSZXdyaXRlcyBwcmUtZXhpc3RpbmcgcG9vbGVkIHJvd3MgKHBlcnNpc3RlZCBhcyBgZXhlY3V0aW9uX21vZGUgPSBcImZvcmtlZFwiYFxuICAgKiBwbHVzIGEgYHZlbG9jaW91cy1wb29sZWQ6KmAgaGFuZG9mZiBtYXJrZXIpIHRvIGBleGVjdXRpb25fbW9kZSA9IFwicG9vbGVkXCJgLFxuICAgKiBjbGVhcnMgdGhlIHF1ZXVlZCBtYXJrZXIsIHRoZW4gZHJvcHMgdGhlIG5vdy1yZWR1bmRhbnQgYGZvcmtlZGAgY29sdW1uIHNvXG4gICAqIGBleGVjdXRpb25fbW9kZWAgaXMgdGhlIHNpbmdsZSBzb3VyY2Ugb2YgdHJ1dGguIFJ1bnMgb25jZSwgZ3VhcmRlZCBieSB0aGVcbiAgICogbWlncmF0aW9uIGxlZGdlciBhbmQgYSBwZXIta2V5IGFkdmlzb3J5IGxvY2s7IGEgZnJlc2ggdGFibGUgKGNyZWF0ZWQgd2l0aG91dFxuICAgKiB0aGUgY29sdW1uKSBzaG9ydC1jaXJjdWl0cy5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9kYXRhYmFzZS9kcml2ZXJzL2Jhc2UuanNcIikuZGVmYXVsdH0gZGIgLSBEYXRhYmFzZSBjb25uZWN0aW9uLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyB3aGVuIGNvbXBsZXRlLlxuICAgKi9cbiAgYXN5bmMgX2Ryb3BGb3JrZWRDb2x1bW5PbmNlKGRiKSB7XG4gICAgY29uc3QgbWlncmF0aW9uVmVyc2lvbiA9IERST1BfRk9SS0VEX0NPTFVNTl9NSUdSQVRJT05fVkVSU0lPTlxuICAgIGNvbnN0IG1pZ3JhdGlvbktleSA9IHRoaXMuX21pZ3JhdGlvbktleShtaWdyYXRpb25WZXJzaW9uKVxuXG4gICAgaWYgKGF3YWl0IHRoaXMuX2hhc01pZ3JhdGlvbihkYiwgbWlncmF0aW9uVmVyc2lvbikpIHJldHVyblxuXG4gICAgYXdhaXQgZGIuYWNxdWlyZUFkdmlzb3J5TG9jayhtaWdyYXRpb25LZXkpXG5cbiAgICB0cnkge1xuICAgICAgaWYgKGF3YWl0IHRoaXMuX2hhc01pZ3JhdGlvbihkYiwgbWlncmF0aW9uVmVyc2lvbikpIHJldHVyblxuXG4gICAgICBkYi5jbGVhclNjaGVtYUNhY2hlKClcblxuICAgICAgaWYgKGF3YWl0IChhd2FpdCBkYi5nZXRUYWJsZUJ5TmFtZU9yRmFpbChKT0JTX1RBQkxFKSkuZ2V0Q29sdW1uQnlOYW1lKFwiZm9ya2VkXCIpKSB7XG4gICAgICAgIGNvbnN0IHRhYmxlTmFtZVNxbCA9IGRiLnF1b3RlVGFibGUoSk9CU19UQUJMRSlcbiAgICAgICAgY29uc3QgZXhlY3V0aW9uTW9kZUNvbHVtblNxbCA9IGRiLnF1b3RlQ29sdW1uKFwiZXhlY3V0aW9uX21vZGVcIilcbiAgICAgICAgY29uc3QgaGFuZG9mZklkQ29sdW1uU3FsID0gZGIucXVvdGVDb2x1bW4oXCJoYW5kb2ZmX2lkXCIpXG5cbiAgICAgICAgLy8gUG9vbGVkIHJvd3MgdXNlZCB0byBwZXJzaXN0IGFzIGV4ZWN1dGlvbl9tb2RlIFwiZm9ya2VkXCIgKyBhIHBvb2xlZCBoYW5kb2ZmXG4gICAgICAgIC8vIG1hcmtlcjsgcmVjb3ZlciB0aGVpciByZWFsIG1vZGUgYmVmb3JlIHRoZSBtYXJrZXIgaXMgY2xlYXJlZC5cbiAgICAgICAgYXdhaXQgZGIucXVlcnkoXG4gICAgICAgICAgYFVQREFURSAke3RhYmxlTmFtZVNxbH0gU0VUICR7ZXhlY3V0aW9uTW9kZUNvbHVtblNxbH0gPSAke2RiLnF1b3RlKFwicG9vbGVkXCIpfSBgICtcbiAgICAgICAgICBgV0hFUkUgJHtleGVjdXRpb25Nb2RlQ29sdW1uU3FsfSA9ICR7ZGIucXVvdGUoXCJmb3JrZWRcIil9IGAgK1xuICAgICAgICAgIGBBTkQgJHtoYW5kb2ZmSWRDb2x1bW5TcWx9IExJS0UgJHtkYi5xdW90ZShgJHtMRUdBQ1lfUE9PTEVEX0hBTkRPRkZfSURfUFJFRklYfSVgKX1gXG4gICAgICAgIClcbiAgICAgICAgLy8gVGhlIHF1ZXVlZC1wb29sZWQgbWFya2VyIHdhcyBhIHNlbnRpbmVsLCBub3QgYSByZWFsIGxlYXNlOyBjbGVhciBpdC5cbiAgICAgICAgYXdhaXQgZGIucXVlcnkoXG4gICAgICAgICAgYFVQREFURSAke3RhYmxlTmFtZVNxbH0gU0VUICR7aGFuZG9mZklkQ29sdW1uU3FsfSA9IE5VTEwgYCArXG4gICAgICAgICAgYFdIRVJFICR7aGFuZG9mZklkQ29sdW1uU3FsfSA9ICR7ZGIucXVvdGUoTEVHQUNZX1BPT0xFRF9RVUVVRURfSEFORE9GRl9JRCl9YFxuICAgICAgICApXG5cbiAgICAgICAgY29uc3QgZHJvcEZvcmtlZCA9IG5ldyBUYWJsZURhdGEoSk9CU19UQUJMRSlcbiAgICAgICAgZHJvcEZvcmtlZC5hZGRDb2x1bW4oXCJmb3JrZWRcIiwge2Ryb3BDb2x1bW46IHRydWV9KVxuICAgICAgICBmb3IgKGNvbnN0IHNxbCBvZiBhd2FpdCBkYi5hbHRlclRhYmxlU1FMcyhkcm9wRm9ya2VkKSkgYXdhaXQgZGIucXVlcnkoc3FsKVxuXG4gICAgICAgIGRiLmNsZWFyU2NoZW1hQ2FjaGUoKVxuICAgICAgfVxuXG4gICAgICBhd2FpdCB0aGlzLl9yZWNvcmRNaWdyYXRpb24oZGIsIG1pZ3JhdGlvblZlcnNpb24pXG4gICAgfSBmaW5hbGx5IHtcbiAgICAgIGF3YWl0IGRiLnJlbGVhc2VBZHZpc29yeUxvY2sobWlncmF0aW9uS2V5KVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHJlY29yZCBtaWdyYXRpb24uXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vZGF0YWJhc2UvZHJpdmVycy9iYXNlLmpzXCIpLmRlZmF1bHR9IGRiIC0gRGF0YWJhc2UgY29ubmVjdGlvbi5cbiAgICogQHBhcmFtIHtzdHJpbmd9IHZlcnNpb24gLSBNaWdyYXRpb24gdmVyc2lvbi5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgd2hlbiBjb21wbGV0ZS5cbiAgICovXG4gIGFzeW5jIF9yZWNvcmRNaWdyYXRpb24oZGIsIHZlcnNpb24pIHtcbiAgICBhd2FpdCBkYi51cHNlcnQoe1xuICAgICAgdGFibGVOYW1lOiBNSUdSQVRJT05TX1RBQkxFLFxuICAgICAgZGF0YToge1xuICAgICAgICBrZXk6IHRoaXMuX21pZ3JhdGlvbktleSh2ZXJzaW9uKSxcbiAgICAgICAgc2NvcGU6IE1JR1JBVElPTl9TQ09QRSxcbiAgICAgICAgdmVyc2lvbixcbiAgICAgICAgYXBwbGllZF9hdF9tczogRGF0ZS5ub3coKVxuICAgICAgfSxcbiAgICAgIGNvbmZsaWN0Q29sdW1uczogW1wia2V5XCJdLFxuICAgICAgdXBkYXRlQ29sdW1uczogW1wic2NvcGVcIiwgXCJ2ZXJzaW9uXCIsIFwiYXBwbGllZF9hdF9tc1wiXVxuICAgIH0pXG4gIH1cblxuICBhc3luYyBfaW5pdGlhbGl6ZU1vZGVsKCkge1xuICAgIGlmIChCYWNrZ3JvdW5kSm9iUmVjb3JkLmlzSW5pdGlhbGl6ZWQoKSkgcmV0dXJuXG5cbiAgICBCYWNrZ3JvdW5kSm9iUmVjb3JkLnNldERhdGFiYXNlSWRlbnRpZmllcih0aGlzLmdldERhdGFiYXNlSWRlbnRpZmllcigpKVxuICAgIGNvbnN0IHBvb2wgPSB0aGlzLmNvbmZpZ3VyYXRpb24uZ2V0RGF0YWJhc2VQb29sKHRoaXMuZ2V0RGF0YWJhc2VJZGVudGlmaWVyKCkpXG5cbiAgICBhd2FpdCBwb29sLndpdGhDb25uZWN0aW9uKHtuYW1lOiBcIkJhY2tncm91bmQgam9icyBzdG9yZSBpbml0aWFsaXplIG1vZGVsXCJ9LCBhc3luYyAoKSA9PiB7XG4gICAgICBhd2FpdCBCYWNrZ3JvdW5kSm9iUmVjb3JkLmluaXRpYWxpemVSZWNvcmQoe2NvbmZpZ3VyYXRpb246IHRoaXMuY29uZmlndXJhdGlvbn0pXG4gICAgfSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGdldCBqb2Igcm93IGJ5IGlkLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL2RhdGFiYXNlL2RyaXZlcnMvYmFzZS5qc1wiKS5kZWZhdWx0fSBkYiAtIERhdGFiYXNlIGNvbm5lY3Rpb24uXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBqb2JJZCAtIEpvYiBpZC5cbiAgICogQHJldHVybnMge1Byb21pc2U8aW1wb3J0KFwiLi90eXBlcy5qc1wiKS5CYWNrZ3JvdW5kSm9iUm93IHwgbnVsbD59IC0gSm9iIHJvdy5cbiAgICovXG4gIGFzeW5jIF9nZXRKb2JSb3dCeUlkKGRiLCBqb2JJZCkge1xuICAgIGNvbnN0IHF1ZXJ5ID0gZGJcbiAgICAgIC5uZXdRdWVyeSgpXG4gICAgICAuZnJvbShKT0JTX1RBQkxFKVxuICAgICAgLndoZXJlKHtpZDogam9iSWR9KVxuICAgICAgLmxpbWl0KDEpXG5cbiAgICBjb25zdCByb3dzID0gYXdhaXQgcXVlcnkucmVzdWx0cygpXG5cbiAgICBpZiAoIXJvd3NbMF0pIHJldHVybiBudWxsXG5cbiAgICByZXR1cm4gdGhpcy5fbm9ybWFsaXplSm9iUm93KHJvd3NbMF0pXG4gIH1cblxuICAvKipcbiAgICogUmVhZHMgdGhlIGpvYiBjdXJyZW50bHkgbmFtZWQgYnkgb25lIHN0YWJsZSBvd25lciByb3cuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vZGF0YWJhc2UvZHJpdmVycy9iYXNlLmpzXCIpLmRlZmF1bHR9IGRiIC0gRGF0YWJhc2UgY29ubmVjdGlvbi5cbiAgICogQHBhcmFtIHtzdHJpbmd9IHNjaGVkdWxlS2V5IC0gVmFsaWRhdGVkIHN0YWJsZSBzY2hlZHVsZSBrZXkuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPGltcG9ydChcIi4vdHlwZXMuanNcIikuQmFja2dyb3VuZEpvYlJvdyB8IG51bGw+fSAtIE5vcm1hbGl6ZWQgb3duZXIgam9iLlxuICAgKi9cbiAgYXN5bmMgX3NjaGVkdWxlZE93bmVySm9iKGRiLCBzY2hlZHVsZUtleSkge1xuICAgIGNvbnN0IG93bmVyUm93cyA9IGF3YWl0IGRiXG4gICAgICAubmV3UXVlcnkoKVxuICAgICAgLmZyb20oU0NIRURVTEVfS0VZU19UQUJMRSlcbiAgICAgIC53aGVyZSh7c2NoZWR1bGVfa2V5OiBzY2hlZHVsZUtleX0pXG4gICAgICAubGltaXQoMSlcbiAgICAgIC5yZXN1bHRzKClcbiAgICBjb25zdCBvd25lclJvdyA9IG93bmVyUm93c1swXVxuXG4gICAgaWYgKCFvd25lclJvdykgcmV0dXJuIG51bGxcblxuICAgIHJldHVybiBhd2FpdCB0aGlzLl9nZXRKb2JSb3dCeUlkKGRiLCBTdHJpbmcob3duZXJSb3cuam9iX2lkKSlcbiAgfVxuXG4gIC8qKlxuICAgKiBBc3NpZ25zIHRoZSBuZXh0IG93bmVyc2hpcCBvcmRlciB3aGlsZSB0aGUgY2FsbGVyIGhvbGRzIHRoZSBzY2hlZHVsZS1rZXlcbiAgICogYWR2aXNvcnkgbG9jayBhbmQgY291bnQtcmV2aXNpb24gdHJhbnNhY3Rpb24gZmVuY2UuIFRoZSBpbmRlcGVuZGVudFxuICAgKiB3YXRlcm1hcmsgc3Vydml2ZXMgYm90aCBvd25lcnNoaXAgcmVsZWFzZSBhbmQgdGVybWluYWwtaGlzdG9yeSBwcnVuaW5nLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL2RhdGFiYXNlL2RyaXZlcnMvYmFzZS5qc1wiKS5kZWZhdWx0fSBkYiAtIERhdGFiYXNlIGNvbm5lY3Rpb24uXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBzY2hlZHVsZUtleSAtIFZhbGlkYXRlZCBzdGFibGUgc2NoZWR1bGUga2V5LlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxudW1iZXI+fSAtIE5leHQgbW9ub3RvbmljIG93bmVyc2hpcCBvcmRlci5cbiAgICovXG4gIGFzeW5jIF9uZXh0U2NoZWR1bGVPcmRlcihkYiwgc2NoZWR1bGVLZXkpIHtcbiAgICBjb25zdCBkdXJhYmxlT3JkZXIgPSBhd2FpdCB0aGlzLl9zY2hlZHVsZU9yZGVyV2F0ZXJtYXJrKGRiLCBzY2hlZHVsZUtleSlcbiAgICBjb25zdCByZXRhaW5lZE9yZGVyID0gYXdhaXQgdGhpcy5fZ3JlYXRlc3RSZXRhaW5lZFNjaGVkdWxlT3JkZXIoZGIsIHNjaGVkdWxlS2V5KVxuICAgIGxldCBjdXJyZW50T3JkZXIgPSBkdXJhYmxlT3JkZXJcblxuICAgIGlmIChyZXRhaW5lZE9yZGVyICE9PSBudWxsICYmIChjdXJyZW50T3JkZXIgPT09IG51bGwgfHwgcmV0YWluZWRPcmRlciA+IGN1cnJlbnRPcmRlcikpIGN1cnJlbnRPcmRlciA9IHJldGFpbmVkT3JkZXJcbiAgICBjb25zdCBuZXh0T3JkZXIgPSBjdXJyZW50T3JkZXIgPT09IG51bGwgPyAxIDogY3VycmVudE9yZGVyICsgMVxuXG4gICAgaWYgKCFOdW1iZXIuaXNTYWZlSW50ZWdlcihuZXh0T3JkZXIpKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoYEJhY2tncm91bmQgam9iIHNjaGVkdWxlIG93bmVyc2hpcCBvcmRlciBleGhhdXN0ZWQgZm9yICR7c2NoZWR1bGVLZXl9YClcbiAgICB9XG5cbiAgICBhd2FpdCB0aGlzLl93cml0ZVNjaGVkdWxlT3JkZXJXYXRlcm1hcmsoZGIsIHtzY2hlZHVsZUtleSwgc2NoZWR1bGVPcmRlcjogbmV4dE9yZGVyfSlcblxuICAgIHJldHVybiBuZXh0T3JkZXJcbiAgfVxuXG4gIC8qKlxuICAgKiBGaW5kcyB0aGUgZ3JlYXRlc3QgcmV0YWluZWQgbm9uLWxlZ2FjeSBvd25lcnNoaXAgb3JkZXIgZm9yIG1pZ3JhdGlvbiBhbmRcbiAgICogcm9sbGluZy11cGdyYWRlIGNvbXBhdGliaWxpdHkuIEl0IGlzIG5ldmVyIHRoZSBzb2xlIGR1cmFiaWxpdHkgYm91bmRhcnkuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vZGF0YWJhc2UvZHJpdmVycy9iYXNlLmpzXCIpLmRlZmF1bHR9IGRiIC0gRGF0YWJhc2UgY29ubmVjdGlvbi5cbiAgICogQHBhcmFtIHtzdHJpbmd9IHNjaGVkdWxlS2V5IC0gVmFsaWRhdGVkIHN0YWJsZSBzY2hlZHVsZSBrZXkuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPG51bWJlciB8IG51bGw+fSAtIEdyZWF0ZXN0IHJldGFpbmVkIG9yZGVyLCBvciBudWxsLlxuICAgKi9cbiAgYXN5bmMgX2dyZWF0ZXN0UmV0YWluZWRTY2hlZHVsZU9yZGVyKGRiLCBzY2hlZHVsZUtleSkge1xuICAgIGNvbnN0IHJvd3MgPSBhd2FpdCBkYlxuICAgICAgLm5ld1F1ZXJ5KClcbiAgICAgIC5mcm9tKEpPQlNfVEFCTEUpXG4gICAgICAuc2VsZWN0KFwic2NoZWR1bGVfb3JkZXJcIilcbiAgICAgIC53aGVyZSh7c2NoZWR1bGVfa2V5OiBzY2hlZHVsZUtleX0pXG4gICAgICAud2hlcmVOb3Qoe3NjaGVkdWxlX29yZGVyOiBudWxsfSlcbiAgICAgIC5vcmRlcihcInNjaGVkdWxlX29yZGVyIERFU0NcIilcbiAgICAgIC5saW1pdCgxKVxuICAgICAgLnJlc3VsdHMoKVxuICAgIGNvbnN0IHJvdyA9IHJvd3NbMF1cblxuICAgIGlmICghcm93KSByZXR1cm4gbnVsbFxuXG4gICAgcmV0dXJuIHRoaXMuX3ZhbGlkYXRlZFNjaGVkdWxlT3JkZXIoXG4gICAgICAvKiogQHR5cGUge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gKi8gKHJvdykuc2NoZWR1bGVfb3JkZXJcbiAgICApXG4gIH1cblxuICAvKipcbiAgICogUmVhZHMgYW5kIHZhbGlkYXRlcyBvbmUgcmV0ZW50aW9uLWluZGVwZW5kZW50IHNjaGVkdWxlLW9yZGVyIHdhdGVybWFyay5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9kYXRhYmFzZS9kcml2ZXJzL2Jhc2UuanNcIikuZGVmYXVsdH0gZGIgLSBEYXRhYmFzZSBjb25uZWN0aW9uLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gc2NoZWR1bGVLZXkgLSBWYWxpZGF0ZWQgc3RhYmxlIHNjaGVkdWxlIGtleS5cbiAgICogQHJldHVybnMge1Byb21pc2U8bnVtYmVyIHwgbnVsbD59IC0gQ3VycmVudCB3YXRlcm1hcmssIG9yIG51bGwgYmVmb3JlIGZpcnN0IG93bmVyc2hpcC5cbiAgICovXG4gIGFzeW5jIF9zY2hlZHVsZU9yZGVyV2F0ZXJtYXJrKGRiLCBzY2hlZHVsZUtleSkge1xuICAgIGNvbnN0IHJvd3MgPSBhd2FpdCBkYlxuICAgICAgLm5ld1F1ZXJ5KClcbiAgICAgIC5mcm9tKFNDSEVEVUxFX09SREVSX1dBVEVSTUFSS1NfVEFCTEUpXG4gICAgICAuc2VsZWN0KFwiaGlnaF93YXRlcl9tYXJrXCIpXG4gICAgICAud2hlcmUoe3NjaGVkdWxlX2tleTogc2NoZWR1bGVLZXl9KVxuICAgICAgLmxpbWl0KDEpXG4gICAgICAucmVzdWx0cygpXG4gICAgY29uc3Qgcm93ID0gcm93c1swXVxuXG4gICAgaWYgKCFyb3cpIHJldHVybiBudWxsXG5cbiAgICByZXR1cm4gdGhpcy5fdmFsaWRhdGVkU2NoZWR1bGVPcmRlcihcbiAgICAgIC8qKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSAqLyAocm93KS5oaWdoX3dhdGVyX21hcmtcbiAgICApXG4gIH1cblxuICAvKipcbiAgICogUGVyc2lzdHMgb25lIHNjaGVkdWxlLW9yZGVyIHdhdGVybWFyayB3aXRob3V0IGV4cG9zaW5nIGl0IGFzIGEgam9iIHJvdy5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9kYXRhYmFzZS9kcml2ZXJzL2Jhc2UuanNcIikuZGVmYXVsdH0gZGIgLSBEYXRhYmFzZSBjb25uZWN0aW9uLlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIFdhdGVybWFyayBpZGVudGl0eSBhbmQgdmFsdWUuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBhcmdzLnNjaGVkdWxlS2V5IC0gVmFsaWRhdGVkIHN0YWJsZSBzY2hlZHVsZSBrZXkuXG4gICAqIEBwYXJhbSB7bnVtYmVyfSBhcmdzLnNjaGVkdWxlT3JkZXIgLSBWYWxpZGF0ZWQgbW9ub3RvbmljIG9yZGVyLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyBhZnRlciBwZXJzaXN0ZW5jZS5cbiAgICovXG4gIGFzeW5jIF93cml0ZVNjaGVkdWxlT3JkZXJXYXRlcm1hcmsoZGIsIHtzY2hlZHVsZUtleSwgc2NoZWR1bGVPcmRlcn0pIHtcbiAgICBhd2FpdCBkYi51cHNlcnQoe1xuICAgICAgdGFibGVOYW1lOiBTQ0hFRFVMRV9PUkRFUl9XQVRFUk1BUktTX1RBQkxFLFxuICAgICAgZGF0YToge2hpZ2hfd2F0ZXJfbWFyazogc2NoZWR1bGVPcmRlciwgc2NoZWR1bGVfa2V5OiBzY2hlZHVsZUtleX0sXG4gICAgICBjb25mbGljdENvbHVtbnM6IFtcInNjaGVkdWxlX2tleVwiXSxcbiAgICAgIHVwZGF0ZUNvbHVtbnM6IFtcImhpZ2hfd2F0ZXJfbWFya1wiXVxuICAgIH0pXG4gIH1cblxuICAvKipcbiAgICogVmFsaWRhdGVzIGFuIG93bmVyc2hpcCBvcmRlciBsb2FkZWQgZnJvbSBkdXJhYmxlIHN0b3JhZ2UuXG4gICAqIEBwYXJhbSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59IHZhbHVlIC0gU3RvcmVkIG9yZGVyLlxuICAgKiBAcmV0dXJucyB7bnVtYmVyfSAtIFBvc2l0aXZlIHNhZmUgaW50ZWdlciBvd25lcnNoaXAgb3JkZXIuXG4gICAqL1xuICBfdmFsaWRhdGVkU2NoZWR1bGVPcmRlcih2YWx1ZSkge1xuICAgIGNvbnN0IHNjaGVkdWxlT3JkZXIgPSB0aGlzLl9ub3JtYWxpemVOdW1iZXIodmFsdWUpXG5cbiAgICBpZiAoc2NoZWR1bGVPcmRlciA9PT0gbnVsbCB8fCAhTnVtYmVyLmlzU2FmZUludGVnZXIoc2NoZWR1bGVPcmRlcikgfHwgc2NoZWR1bGVPcmRlciA8IDEpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihgSW52YWxpZCBiYWNrZ3JvdW5kIGpvYiBzY2hlZHVsZSBvd25lcnNoaXAgb3JkZXI6ICR7c2NoZWR1bGVPcmRlcn1gKVxuICAgIH1cblxuICAgIHJldHVybiBzY2hlZHVsZU9yZGVyXG4gIH1cblxuICAvKipcbiAgICogQnVpbGRzIGEgc3RhYmxlLXNjaGVkdWxlIGxvb2t1cCBleGNsdXNpdmVseSBmcm9tIG5vcm1hbGl6ZWQgam9iIHJvd3MuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vZGF0YWJhc2UvZHJpdmVycy9iYXNlLmpzXCIpLmRlZmF1bHR9IGRiIC0gRGF0YWJhc2UgY29ubmVjdGlvbi5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBMb29rdXAgb3B0aW9ucy5cbiAgICogQHBhcmFtIHtib29sZWFufSBhcmdzLmluY2x1ZGVMYXRlc3RUZXJtaW5hbCAtIFdoZXRoZXIgdGVybWluYWwgaGlzdG9yeSBpcyByZXF1ZXN0ZWQuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBhcmdzLnNjaGVkdWxlS2V5IC0gVmFsaWRhdGVkIHN0YWJsZSBzY2hlZHVsZSBrZXkuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPGltcG9ydChcIi4vdHlwZXMuanNcIikuQmFja2dyb3VuZEpvYlNjaGVkdWxlZExvb2t1cFJlc3VsdD59IC0gTm9ybWFsaXplZCBwdWJsaWMgam9icy5cbiAgICovXG4gIGFzeW5jIF9zY2hlZHVsZWRKb2JMb29rdXAoZGIsIHtpbmNsdWRlTGF0ZXN0VGVybWluYWwsIHNjaGVkdWxlS2V5fSkge1xuICAgIGNvbnN0IG93bmVySm9iID0gYXdhaXQgdGhpcy5fc2NoZWR1bGVkT3duZXJKb2IoZGIsIHNjaGVkdWxlS2V5KVxuICAgIGNvbnN0IGN1cnJlbnRKb2IgPSBvd25lckpvYiAmJiAob3duZXJKb2Iuc3RhdHVzID09PSBcInF1ZXVlZFwiIHx8IG93bmVySm9iLnN0YXR1cyA9PT0gXCJoYW5kZWRfb2ZmXCIpID8gb3duZXJKb2IgOiBudWxsXG5cbiAgICBpZiAoIWluY2x1ZGVMYXRlc3RUZXJtaW5hbCkgcmV0dXJuIHtjdXJyZW50Sm9iLCBsYXRlc3RUZXJtaW5hbEpvYjogbnVsbH1cblxuICAgIGNvbnN0IHRlcm1pbmFsU3RhdHVzZXMgPSBCQUNLR1JPVU5EX0pPQl9URVJNSU5BTF9TVEFUVVNFUy5tYXAoKHN0YXR1cykgPT4gZGIucXVvdGUoc3RhdHVzKSkuam9pbihcIiwgXCIpXG4gICAgY29uc3QgdGVybWluYWxSb3dzID0gYXdhaXQgZGJcbiAgICAgIC5uZXdRdWVyeSgpXG4gICAgICAuZnJvbShKT0JTX1RBQkxFKVxuICAgICAgLndoZXJlKHtzY2hlZHVsZV9rZXk6IHNjaGVkdWxlS2V5fSlcbiAgICAgIC53aGVyZShgJHtkYi5xdW90ZUNvbHVtbihcInN0YXR1c1wiKX0gSU4gKCR7dGVybWluYWxTdGF0dXNlc30pYClcbiAgICAgIC5vcmRlcihgQ0FTRSBXSEVOICR7ZGIucXVvdGVDb2x1bW4oXCJzY2hlZHVsZV9vcmRlclwiKX0gSVMgTlVMTCBUSEVOIDAgRUxTRSAxIEVORCBERVNDYClcbiAgICAgIC5vcmRlcihcInNjaGVkdWxlX29yZGVyIERFU0NcIilcbiAgICAgIC5vcmRlcihcImNyZWF0ZWRfYXRfbXMgREVTQ1wiKVxuICAgICAgLm9yZGVyKFwiaWQgREVTQ1wiKVxuICAgICAgLmxpbWl0KDEpXG4gICAgICAucmVzdWx0cygpXG4gICAgY29uc3QgbGF0ZXN0VGVybWluYWxKb2IgPSB0ZXJtaW5hbFJvd3NbMF0gPyB0aGlzLl9ub3JtYWxpemVKb2JSb3codGVybWluYWxSb3dzWzBdKSA6IG51bGxcblxuICAgIHJldHVybiB7Y3VycmVudEpvYiwgbGF0ZXN0VGVybWluYWxKb2J9XG4gIH1cblxuICAvKipcbiAgICogUmVsZWFzZXMgb3duZXJzaGlwIG9ubHkgd2hlbiB0aGUga2V5IHN0aWxsIHBvaW50cyBhdCB0aGUgZXhwZWN0ZWQgam9iLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL2RhdGFiYXNlL2RyaXZlcnMvYmFzZS5qc1wiKS5kZWZhdWx0fSBkYiAtIERhdGFiYXNlIGNvbm5lY3Rpb24uXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gT3duZXJzaGlwIGlkZW50aXR5LlxuICAgKiBAcGFyYW0ge3N0cmluZ30gYXJncy5qb2JJZCAtIEV4cGVjdGVkIG93bmVyIGpvYiBpZC5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGFyZ3Muc2NoZWR1bGVLZXkgLSBTdGFibGUgc2NoZWR1bGUga2V5LlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyB3aGVuIGRlbGV0ZWQgb3IgYWxyZWFkeSBzdXBlcnNlZGVkLlxuICAgKi9cbiAgYXN5bmMgX3JlbGVhc2VTY2hlZHVsZU93bmVyc2hpcChkYiwge2pvYklkLCBzY2hlZHVsZUtleX0pIHtcbiAgICBhd2FpdCBkYi5kZWxldGUoe1xuICAgICAgdGFibGVOYW1lOiBTQ0hFRFVMRV9LRVlTX1RBQkxFLFxuICAgICAgY29uZGl0aW9uczoge2pvYl9pZDogam9iSWQsIHNjaGVkdWxlX2tleTogc2NoZWR1bGVLZXl9XG4gICAgfSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSZWxlYXNlcyBhIGpvYidzIG93bmVyc2hpcCB3aGVuIGl0IGhhcyBhIGhpc3RvcmljYWwgc2NoZWR1bGUga2V5LlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL2RhdGFiYXNlL2RyaXZlcnMvYmFzZS5qc1wiKS5kZWZhdWx0fSBkYiAtIERhdGFiYXNlIGNvbm5lY3Rpb24uXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi90eXBlcy5qc1wiKS5CYWNrZ3JvdW5kSm9iUm93fSBqb2IgLSBUZXJtaW5hbCBqb2IuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIHdoZW4gZGVsZXRlZCBvciBub3QgYXBwbGljYWJsZS5cbiAgICovXG4gIGFzeW5jIF9yZWxlYXNlU2NoZWR1bGVPd25lcnNoaXBGb3JKb2IoZGIsIGpvYikge1xuICAgIGlmICgham9iLnNjaGVkdWxlS2V5KSByZXR1cm5cblxuICAgIGF3YWl0IHRoaXMuX3JlbGVhc2VTY2hlZHVsZU93bmVyc2hpcChkYiwge2pvYklkOiBqb2IuaWQsIHNjaGVkdWxlS2V5OiBqb2Iuc2NoZWR1bGVLZXl9KVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgYXBwbHkgZmFpbHVyZS5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBPcHRpb25zLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL2RhdGFiYXNlL2RyaXZlcnMvYmFzZS5qc1wiKS5kZWZhdWx0fSBhcmdzLmRiIC0gRGF0YWJhc2UgY29ubmVjdGlvbi5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL3R5cGVzLmpzXCIpLkJhY2tncm91bmRKb2JSb3d9IGFyZ3Muam9iIC0gSm9iIHJvdy5cbiAgICogQHBhcmFtIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gYXJncy5lcnJvciAtIEVycm9yLlxuICAgKiBAcGFyYW0ge2Jvb2xlYW59IGFyZ3MubWFya09ycGhhbmVkIC0gV2hldGhlciBtYXJraW5nIG9ycGhhbmVkLlxuICAgKiBAcGFyYW0ge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gW2FyZ3MuY29uZGl0aW9uc10gLSBVcGRhdGUgZmVuY2luZyBjb25kaXRpb25zLiBEZWZhdWx0cyB0byB0aGUgYWN0aXZlLWhhbmRvZmYgbGVhc2UgbWF0Y2g7IHRoZSB0aW1lLWJhc2VkIG9ycGhhbiBzd2VlcCBvdmVycmlkZXMgdGhpcyB3aXRoIGFuIGlkL3N0YXR1cyBtYXRjaCBzbyBpdCBjYW4gcmVjbGFpbSByb3dzIHdob3NlIGBoYW5kb2ZmX2lkYCBpcyBudWxsIChlLmcuIGhhbmRlZCBvZmYgYnkgYW4gb2xkZXIgdmVsb2Npb3VzIGJlZm9yZSBoYW5kb2ZmLWlkIGZlbmNpbmcgZXhpc3RlZCkuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPGltcG9ydChcIi4vdHlwZXMuanNcIikuQmFja2dyb3VuZEpvYlJvdyB8IG51bGw+fSAtIFVwZGF0ZWQgam9iIHJvdyB3aGVuIHRoZSBsZWFzZSB0cmFuc2l0aW9uIHdvbi5cbiAgICovXG4gIGFzeW5jIF9hcHBseUZhaWx1cmUoe2RiLCBqb2IsIGVycm9yLCBtYXJrT3JwaGFuZWQsIGNvbmRpdGlvbnN9KSB7XG4gICAgY29uc3Qgbm93ID0gdGhpcy5jbG9jay5ub3coKVxuICAgIGNvbnN0IG5leHRBdHRlbXB0ID0gKGpvYi5hdHRlbXB0cyB8fCAwKSArIDFcbiAgICBjb25zdCBtYXhSZXRyaWVzID0gdGhpcy5fbm9ybWFsaXplTWF4UmV0cmllcyhqb2IubWF4UmV0cmllcylcbiAgICBjb25zdCBzaG91bGRSZXRyeSA9IG5leHRBdHRlbXB0IDw9IG1heFJldHJpZXNcbiAgICBjb25zdCBmYWlsdXJlTWVzc2FnZSA9IG5vcm1hbGl6ZUJhY2tncm91bmRKb2JFcnJvcihlcnJvcilcbiAgICBjb25zdCBzY2hlZHVsZWRBdCA9IHNob3VsZFJldHJ5ID8gbm93ICsgdGhpcy5nZXRSZXRyeURlbGF5TXMobmV4dEF0dGVtcHQpIDogam9iLnNjaGVkdWxlZEF0TXNcbiAgICBjb25zdCB1cGRhdGUgPSB0aGlzLl9mYWlsdXJlVXBkYXRlKHtcbiAgICAgIGZhaWx1cmVNZXNzYWdlLFxuICAgICAgbWFya09ycGhhbmVkLFxuICAgICAgbmV4dEF0dGVtcHQsXG4gICAgICBub3csXG4gICAgICBzY2hlZHVsZWRBdCxcbiAgICAgIHNob3VsZFJldHJ5XG4gICAgfSlcblxuICAgIGF3YWl0IHRoaXMuX2xvY2tDb25jdXJyZW5jeVJvdyhkYiwgam9iLmNvbmN1cnJlbmN5S2V5KVxuICAgIGNvbnN0IGFmZmVjdGVkUm93cyA9IGF3YWl0IHRoaXMuX3VwZGF0ZUFmZmVjdGVkUm93cyhkYiwge1xuICAgICAgdGFibGVOYW1lOiBKT0JTX1RBQkxFLFxuICAgICAgZGF0YTogdXBkYXRlLFxuICAgICAgY29uZGl0aW9uczogY29uZGl0aW9ucyA/PyB0aGlzLl9hY3RpdmVIYW5kb2ZmQ29uZGl0aW9ucyhqb2IpXG4gICAgfSlcblxuICAgIGlmIChhZmZlY3RlZFJvd3MgIT09IDEpIHJldHVybiBudWxsXG4gICAgaWYgKCFzaG91bGRSZXRyeSkgYXdhaXQgdGhpcy5fcmVsZWFzZVNjaGVkdWxlT3duZXJzaGlwRm9ySm9iKGRiLCBqb2IpXG4gICAgYXdhaXQgdGhpcy5fcmVsZWFzZUNvbmN1cnJlbmN5KGRiLCBqb2IuY29uY3VycmVuY3lLZXkpXG5cbiAgICAvLyBSZXR1cm4gYSBzbmFwc2hvdCBvZiB0aGUgdHJhbnNpdGlvbiB0aGlzIHVwZGF0ZSBqdXN0IGFwcGxpZWQgcmF0aGVyIHRoYW4gcmUtcmVhZGluZyB0aGUgcm93LlxuICAgIC8vIFdlIHdvbiB0aGUgY29uZGl0aW9uYWwgdXBkYXRlIChhZmZlY3RlZFJvd3MgPT09IDEpLCBzbyB0aGlzIHN0YXRlIGlzIGF1dGhvcml0YXRpdmU7IHJlLXJlYWRpbmdcbiAgICAvLyBjb3VsZCBpbnN0ZWFkIG9ic2VydmUgYSBuZXdlciBzdGF0ZSBpZiBhbm90aGVyIGRpc3BhdGNoZXIgcmVjbGFpbXMgYSByZXF1ZXVlZCBqb2IgYmV0d2VlbiB0aGVcbiAgICAvLyB1cGRhdGUgYW5kIHRoZSByZWFkIChvdmVybGFwcGluZyBtYWlucyAvIHBvbGxpbmcgZGlzcGF0Y2gpLCB3aGljaCB3b3VsZCBtaXNyZXBvcnQgdGhlXG4gICAgLy8gc3RhdHVzL3Rlcm1pbmFsL3dpbGxSZXRyeSBvZiB0aGlzIHRyYW5zaXRpb24gdG8gZmFpbHVyZS9vcnBoYW4gZXZlbnQgbGlzdGVuZXJzLlxuICAgIGNvbnN0IHN0YXR1cyA9IHNob3VsZFJldHJ5ID8gXCJxdWV1ZWRcIiA6IChtYXJrT3JwaGFuZWQgPyBcIm9ycGhhbmVkXCIgOiBcImZhaWxlZFwiKVxuICAgIC8qKiBAdHlwZSB7aW1wb3J0KFwiLi90eXBlcy5qc1wiKS5CYWNrZ3JvdW5kSm9iUm93fSAqL1xuICAgIGNvbnN0IHRyYW5zaXRpb25lZEpvYiA9IHtcbiAgICAgIC4uLmpvYixcbiAgICAgIC4uLihzaG91bGRSZXRyeSA/IHRoaXMuX2NsZWFyZWRDaGlsZEFjY2VwdGFuY2VSb3coKSA6IHt9KSxcbiAgICAgIGF0dGVtcHRzOiBuZXh0QXR0ZW1wdCxcbiAgICAgIGhhbmRlZE9mZkF0TXM6IG51bGwsXG4gICAgICBsYXN0RXJyb3I6IGZhaWx1cmVNZXNzYWdlLFxuICAgICAgc3RhdHVzLFxuICAgICAgd29ya2VySWQ6IG51bGxcbiAgICB9XG5cbiAgICBpZiAobWFya09ycGhhbmVkKSB0cmFuc2l0aW9uZWRKb2Iub3JwaGFuZWRBdE1zID0gbm93XG4gICAgaWYgKHNob3VsZFJldHJ5KSB7XG4gICAgICB0cmFuc2l0aW9uZWRKb2Iuc2NoZWR1bGVkQXRNcyA9IHNjaGVkdWxlZEF0XG4gICAgfSBlbHNlIGlmICghbWFya09ycGhhbmVkKSB7XG4gICAgICB0cmFuc2l0aW9uZWRKb2IuZmFpbGVkQXRNcyA9IG5vd1xuICAgIH1cblxuICAgIHJldHVybiB0cmFuc2l0aW9uZWRKb2JcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGZhaWx1cmUgdXBkYXRlLlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIE9wdGlvbnMuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBhcmdzLmZhaWx1cmVNZXNzYWdlIC0gTGFzdCBmYWlsdXJlIG1lc3NhZ2UuXG4gICAqIEBwYXJhbSB7Ym9vbGVhbn0gYXJncy5tYXJrT3JwaGFuZWQgLSBXaGV0aGVyIG1hcmtpbmcgb3JwaGFuZWQuXG4gICAqIEBwYXJhbSB7bnVtYmVyfSBhcmdzLm5leHRBdHRlbXB0IC0gTmV4dCBhdHRlbXB0IGNvdW50LlxuICAgKiBAcGFyYW0ge251bWJlcn0gYXJncy5ub3cgLSBDdXJyZW50IHRpbWVzdGFtcC5cbiAgICogQHBhcmFtIHtudW1iZXIgfCBudWxsfSBhcmdzLnNjaGVkdWxlZEF0IC0gTmV4dCBzY2hlZHVsZWQgdGltZXN0YW1wLlxuICAgKiBAcGFyYW0ge2Jvb2xlYW59IGFyZ3Muc2hvdWxkUmV0cnkgLSBXaGV0aGVyIHRoZSBqb2Igc2hvdWxkIHJldHJ5LlxuICAgKiBAcmV0dXJucyB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSAtIERhdGFiYXNlIHVwZGF0ZSBkYXRhLlxuICAgKi9cbiAgX2ZhaWx1cmVVcGRhdGUoe2ZhaWx1cmVNZXNzYWdlLCBtYXJrT3JwaGFuZWQsIG5leHRBdHRlbXB0LCBub3csIHNjaGVkdWxlZEF0LCBzaG91bGRSZXRyeX0pIHtcbiAgICAvKipcbiAgICAgKiBVcGRhdGUuXG4gICAgICogQHR5cGUge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gKi9cbiAgICBjb25zdCB1cGRhdGUgPSB7XG4gICAgICBhdHRlbXB0czogbmV4dEF0dGVtcHQsXG4gICAgICBoYW5kZWRfb2ZmX2F0X21zOiBudWxsLFxuICAgICAgd29ya2VyX2lkOiBudWxsLFxuICAgICAgbGFzdF9lcnJvcjogZmFpbHVyZU1lc3NhZ2VcbiAgICB9XG5cbiAgICAvLyBBIHJldHJ5IHN0YXJ0cyBhIGZyZXNoIGhhbmRvZmYgd2l0aCBhIHBvc3NpYmx5IGRpZmZlcmVudCBydW5uZXIsIHNvIHRoZVxuICAgIC8vIHByZXZpb3VzIGNoaWxkJ3MgYWNjZXB0YW5jZSBldmlkZW5jZSBtdXN0IG5vdCBsZWFrIGludG8gdGhlIG5leHQgYXR0ZW1wdC5cbiAgICAvLyBUZXJtaW5hbCBmYWlsdXJlcyBrZWVwIGl0IGFzIGhpc3RvcmljYWwgZXZpZGVuY2UgZm9yIHRoZSBsb3N0IGF0dGVtcHQuXG4gICAgaWYgKHNob3VsZFJldHJ5KSBPYmplY3QuYXNzaWduKHVwZGF0ZSwgdGhpcy5fY2xlYXJlZENoaWxkQWNjZXB0YW5jZURhdGEoKSlcblxuICAgIHRoaXMuX2FwcGx5T3JwaGFuZWRGYWlsdXJlVXBkYXRlKHttYXJrT3JwaGFuZWQsIG5vdywgdXBkYXRlfSlcbiAgICB0aGlzLl9hcHBseUZhaWx1cmVTdGF0dXNVcGRhdGUoe21hcmtPcnBoYW5lZCwgbm93LCBzY2hlZHVsZWRBdCwgc2hvdWxkUmV0cnksIHVwZGF0ZX0pXG5cbiAgICByZXR1cm4gdXBkYXRlXG4gIH1cblxuICAvKipcbiAgICogUnVucyBhcHBseSBvcnBoYW5lZCBmYWlsdXJlIHVwZGF0ZS5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBPcHRpb25zLlxuICAgKiBAcGFyYW0ge2Jvb2xlYW59IGFyZ3MubWFya09ycGhhbmVkIC0gV2hldGhlciBtYXJraW5nIG9ycGhhbmVkLlxuICAgKiBAcGFyYW0ge251bWJlcn0gYXJncy5ub3cgLSBDdXJyZW50IHRpbWVzdGFtcC5cbiAgICogQHBhcmFtIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59IGFyZ3MudXBkYXRlIC0gRGF0YWJhc2UgdXBkYXRlIGRhdGEuXG4gICAqIEByZXR1cm5zIHt2b2lkfVxuICAgKi9cbiAgX2FwcGx5T3JwaGFuZWRGYWlsdXJlVXBkYXRlKHttYXJrT3JwaGFuZWQsIG5vdywgdXBkYXRlfSkge1xuICAgIGlmIChtYXJrT3JwaGFuZWQpIHVwZGF0ZS5vcnBoYW5lZF9hdF9tcyA9IG5vd1xuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgYXBwbHkgZmFpbHVyZSBzdGF0dXMgdXBkYXRlLlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIE9wdGlvbnMuXG4gICAqIEBwYXJhbSB7Ym9vbGVhbn0gYXJncy5tYXJrT3JwaGFuZWQgLSBXaGV0aGVyIG1hcmtpbmcgb3JwaGFuZWQuXG4gICAqIEBwYXJhbSB7bnVtYmVyfSBhcmdzLm5vdyAtIEN1cnJlbnQgdGltZXN0YW1wLlxuICAgKiBAcGFyYW0ge251bWJlciB8IG51bGx9IGFyZ3Muc2NoZWR1bGVkQXQgLSBOZXh0IHNjaGVkdWxlZCB0aW1lc3RhbXAuXG4gICAqIEBwYXJhbSB7Ym9vbGVhbn0gYXJncy5zaG91bGRSZXRyeSAtIFdoZXRoZXIgdGhlIGpvYiBzaG91bGQgcmV0cnkuXG4gICAqIEBwYXJhbSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSBhcmdzLnVwZGF0ZSAtIERhdGFiYXNlIHVwZGF0ZSBkYXRhLlxuICAgKiBAcmV0dXJucyB7dm9pZH1cbiAgICovXG4gIF9hcHBseUZhaWx1cmVTdGF0dXNVcGRhdGUoe21hcmtPcnBoYW5lZCwgbm93LCBzY2hlZHVsZWRBdCwgc2hvdWxkUmV0cnksIHVwZGF0ZX0pIHtcbiAgICBpZiAoc2hvdWxkUmV0cnkpIHtcbiAgICAgIHVwZGF0ZS5zdGF0dXMgPSBcInF1ZXVlZFwiXG4gICAgICB1cGRhdGUuc2NoZWR1bGVkX2F0X21zID0gc2NoZWR1bGVkQXRcbiAgICAgIHJldHVyblxuICAgIH1cblxuICAgIGlmIChtYXJrT3JwaGFuZWQpIHtcbiAgICAgIHVwZGF0ZS5zdGF0dXMgPSBcIm9ycGhhbmVkXCJcbiAgICAgIHJldHVyblxuICAgIH1cblxuICAgIHVwZGF0ZS5zdGF0dXMgPSBcImZhaWxlZFwiXG4gICAgdXBkYXRlLmZhaWxlZF9hdF9tcyA9IG5vd1xuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgbm9ybWFsaXplIGpvYiByb3cuXG4gICAqIEBwYXJhbSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSByb3cgLSBSYXcgZGF0YWJhc2Ugcm93LlxuICAgKiBAcmV0dXJucyB7aW1wb3J0KFwiLi90eXBlcy5qc1wiKS5CYWNrZ3JvdW5kSm9iUm93fSAtIE5vcm1hbGl6ZWQgam9iIHJvdy5cbiAgICovXG4gIF9ub3JtYWxpemVKb2JSb3cocm93KSB7XG4gICAgY29uc3QgaGFuZG9mZklkID0gcm93LmhhbmRvZmZfaWQgPyBTdHJpbmcocm93LmhhbmRvZmZfaWQpIDogbnVsbFxuICAgIC8vIGBleGVjdXRpb25fbW9kZWAgaXMgdGhlIHNpbmdsZSBzb3VyY2Ugb2YgdHJ1dGggZm9yIGEgam9iJ3MgcnVudGltZSBhbmQgaXNcbiAgICAvLyB3cml0dGVuIG9uIGV2ZXJ5IGVucXVldWU7IHRoZSBkcm9wLWZvcmtlZCBtaWdyYXRpb24gYmFja2ZpbGxzIGFueSBwcmUtZXhpc3RpbmdcbiAgICAvLyByb3dzIGJlZm9yZSB0aGUgbGVnYWN5IGBmb3JrZWRgIGNvbHVtbiBpcyByZW1vdmVkLlxuICAgIGNvbnN0IGV4ZWN1dGlvbk1vZGUgPSByb3cuZXhlY3V0aW9uX21vZGUgPyB0aGlzLl9ub3JtYWxpemVFeGVjdXRpb25Nb2RlTmFtZShTdHJpbmcocm93LmV4ZWN1dGlvbl9tb2RlKSkgOiBERUZBVUxUX0JBQ0tHUk9VTkRfSk9CX0VYRUNVVElPTl9NT0RFXG5cbiAgICByZXR1cm4ge1xuICAgICAgaWQ6IFN0cmluZyhyb3cuaWQpLFxuICAgICAgam9iTmFtZTogU3RyaW5nKHJvdy5qb2JfbmFtZSksXG4gICAgICBhcmdzOiB0aGlzLl9wYXJzZUFyZ3Mocm93LmFyZ3NfanNvbiksXG4gICAgICBleGVjdXRpb25Nb2RlLFxuICAgICAgcXVldWU6IHJvdy5xdWV1ZSA/IFN0cmluZyhyb3cucXVldWUpIDogREVGQVVMVF9CQUNLR1JPVU5EX0pPQl9RVUVVRSxcbiAgICAgIHNjaGVkdWxlS2V5OiByb3cuc2NoZWR1bGVfa2V5ID8gU3RyaW5nKHJvdy5zY2hlZHVsZV9rZXkpIDogbnVsbCxcbiAgICAgIHNjaGVkdWxlT3JkZXI6IHRoaXMuX25vcm1hbGl6ZU51bWJlcihyb3cuc2NoZWR1bGVfb3JkZXIpLFxuICAgICAgc3RhdHVzOiBub3JtYWxpemVCYWNrZ3JvdW5kSm9iU3RhdHVzKHJvdy5zdGF0dXMgPyBTdHJpbmcocm93LnN0YXR1cykgOiBcInF1ZXVlZFwiKSxcbiAgICAgIGF0dGVtcHRzOiB0aGlzLl9ub3JtYWxpemVOdW1iZXIocm93LmF0dGVtcHRzKSxcbiAgICAgIG1heFJldHJpZXM6IHRoaXMuX25vcm1hbGl6ZU51bWJlcihyb3cubWF4X3JldHJpZXMpLFxuICAgICAgc2NoZWR1bGVkQXRNczogdGhpcy5fbm9ybWFsaXplTnVtYmVyKHJvdy5zY2hlZHVsZWRfYXRfbXMpLFxuICAgICAgY3JlYXRlZEF0TXM6IHRoaXMuX25vcm1hbGl6ZU51bWJlcihyb3cuY3JlYXRlZF9hdF9tcyksXG4gICAgICBoYW5kZWRPZmZBdE1zOiB0aGlzLl9ub3JtYWxpemVOdW1iZXIocm93LmhhbmRlZF9vZmZfYXRfbXMpLFxuICAgICAgaGFuZG9mZklkLFxuICAgICAgY29tcGxldGVkQXRNczogdGhpcy5fbm9ybWFsaXplTnVtYmVyKHJvdy5jb21wbGV0ZWRfYXRfbXMpLFxuICAgICAgZmFpbGVkQXRNczogdGhpcy5fbm9ybWFsaXplTnVtYmVyKHJvdy5mYWlsZWRfYXRfbXMpLFxuICAgICAgb3JwaGFuZWRBdE1zOiB0aGlzLl9ub3JtYWxpemVOdW1iZXIocm93Lm9ycGhhbmVkX2F0X21zKSxcbiAgICAgIHdvcmtlcklkOiByb3cud29ya2VyX2lkID8gU3RyaW5nKHJvdy53b3JrZXJfaWQpIDogbnVsbCxcbiAgICAgIGxhc3RFcnJvcjogcm93Lmxhc3RfZXJyb3IgPyBTdHJpbmcocm93Lmxhc3RfZXJyb3IpIDogbnVsbCxcbiAgICAgIGNvbmN1cnJlbmN5S2V5OiByb3cuY29uY3VycmVuY3lfa2V5ID8gU3RyaW5nKHJvdy5jb25jdXJyZW5jeV9rZXkpIDogbnVsbCxcbiAgICAgIG1heENvbmN1cnJlbmN5OiB0aGlzLl9ub3JtYWxpemVOdW1iZXIocm93Lm1heF9jb25jdXJyZW5jeSksXG4gICAgICB0aW1lb3V0TXM6IHRoaXMuX25vcm1hbGl6ZU51bWJlcihyb3cudGltZW91dF9tcyksXG4gICAgICBjaGlsZFJlY2VpdmVkQXRNczogdGhpcy5fbm9ybWFsaXplTnVtYmVyKHJvdy5jaGlsZF9yZWNlaXZlZF9hdF9tcyksXG4gICAgICBjaGlsZFN0YXJ0ZWRBdE1zOiB0aGlzLl9ub3JtYWxpemVOdW1iZXIocm93LmNoaWxkX3N0YXJ0ZWRfYXRfbXMpLFxuICAgICAgY2hpbGRJbnN0YW5jZUlkOiByb3cuY2hpbGRfaW5zdGFuY2VfaWQgPyBTdHJpbmcocm93LmNoaWxkX2luc3RhbmNlX2lkKSA6IG51bGwsXG4gICAgICBjaGlsZFBpZDogdGhpcy5fbm9ybWFsaXplTnVtYmVyKHJvdy5jaGlsZF9waWQpXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIE5vcm1hbGl6ZXMgYSBqb2IncyBxdWV1ZSBuYW1lLCBkZWZhdWx0aW5nIHRvIFwiZGVmYXVsdFwiLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vdHlwZXMuanNcIikuQmFja2dyb3VuZEpvYk9wdGlvbnMgfCB1bmRlZmluZWR9IG9wdGlvbnMgLSBKb2Igb3B0aW9ucy5cbiAgICogQHJldHVybnMge3N0cmluZ30gLSBRdWV1ZSBuYW1lLlxuICAgKi9cbiAgX25vcm1hbGl6ZVF1ZXVlKG9wdGlvbnMpIHtcbiAgICByZXR1cm4gbm9ybWFsaXplQmFja2dyb3VuZEpvYlF1ZXVlKG9wdGlvbnMpXG4gIH1cblxuICAvKipcbiAgICogUmVzb2x2ZXMgYSBqb2IncyBkdXJhYmxlIGNvbmN1cnJlbmN5LiBBbiBleHBsaWNpdCBjb25jdXJyZW5jeUtleS9tYXhDb25jdXJyZW5jeVxuICAgKiBwYWlyIGFsd2F5cyB3aW5zLiBPdGhlcndpc2UsIHdoZW4gdGhlIGpvYidzIHF1ZXVlIGhhcyBhIGNvbmZpZ3VyZWQgY2FwXG4gICAqIChgYmFja2dyb3VuZEpvYnMucXVldWVzW3F1ZXVlXS5tYXhDb25jdXJyZW50YCksIGRlcml2ZSBhIHF1ZXVlLXNjb3BlZFxuICAgKiBjb25jdXJyZW5jeSBrZXkgc28gdGhlIHF1ZXVlIGNhcCBpcyBlbmZvcmNlZCBjbHVzdGVyLXdpZGUgdGhyb3VnaCB0aGVcbiAgICogZXhpc3RpbmcgZHVyYWJsZSBjb25jdXJyZW5jeSBtZWNoYW5pc20uXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi90eXBlcy5qc1wiKS5CYWNrZ3JvdW5kSm9iT3B0aW9ucyB8IHVuZGVmaW5lZH0gb3B0aW9ucyAtIEpvYiBvcHRpb25zLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gcXVldWUgLSBOb3JtYWxpemVkIHF1ZXVlIG5hbWUuXG4gICAqIEByZXR1cm5zIHt7Y29uY3VycmVuY3lLZXk6IHN0cmluZywgbWF4Q29uY3VycmVuY3k6IG51bWJlciwgcXVldWVEZXJpdmVkOiBib29sZWFufSB8IG51bGx9IC0gUmVzb2x2ZWQgY29uY3VycmVuY3kuXG4gICAqL1xuICBfcmVzb2x2ZUNvbmN1cnJlbmN5KG9wdGlvbnMsIHF1ZXVlKSB7XG4gICAgcmV0dXJuIG5vcm1hbGl6ZUJhY2tncm91bmRKb2JDb25jdXJyZW5jeSh7XG4gICAgICBvcHRpb25zOiBvcHRpb25zIHx8IHt9LFxuICAgICAgcXVldWUsXG4gICAgICBxdWV1ZXM6IHRoaXMuY29uZmlndXJhdGlvbi5nZXRCYWNrZ3JvdW5kSm9ic0NvbmZpZygpLnF1ZXVlc1xuICAgIH0pXG4gIH1cblxuICAvKipcbiAgICogQXBwbGllcyB0aGUgYWN0aXZlIGdlbmVyYXRpb24ncyBxdWV1ZSBwb2xpY3kgaW1tZWRpYXRlbHkgYmVmb3JlIGhhbmRvZmYuXG4gICAqIEV4cGxpY2l0IGNvbmN1cnJlbmN5IHJlbWFpbnMgb3duZWQgYnkgdGhlIGVucXVldWUgcmVxdWVzdC5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9kYXRhYmFzZS9kcml2ZXJzL2Jhc2UuanNcIikuZGVmYXVsdH0gZGIgLSBEYXRhYmFzZSBjb25uZWN0aW9uLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vdHlwZXMuanNcIikuQmFja2dyb3VuZEpvYlJvd30gam9iIC0gUXVldWVkIGpvYiBzbmFwc2hvdC5cbiAgICogQHJldHVybnMge1Byb21pc2U8aW1wb3J0KFwiLi90eXBlcy5qc1wiKS5CYWNrZ3JvdW5kSm9iUm93IHwgbnVsbD59IC0gUmVjb25jaWxlZCBqb2IsIG9yIG51bGwgd2hlbiBpdHMgcXVldWVkLXN0YXRlIGZlbmNlIGxvc3QuXG4gICAqL1xuICBhc3luYyBfcmVjb25jaWxlUXVldWVkSm9iQ29uY3VycmVuY3koZGIsIGpvYikge1xuICAgIGlmIChqb2IuY29uY3VycmVuY3lLZXkgJiYgIWpvYi5jb25jdXJyZW5jeUtleS5zdGFydHNXaXRoKFFVRVVFX0NPTkNVUlJFTkNZX0tFWV9QUkVGSVgpKSB7XG4gICAgICByZXR1cm4gam9iXG4gICAgfVxuXG4gICAgY29uc3QgY29uY3VycmVuY3kgPSB0aGlzLl9yZXNvbHZlQ29uY3VycmVuY3koe30sIGpvYi5xdWV1ZSlcbiAgICAvKiogQHR5cGUge0JhY2tncm91bmRKb2JRdWV1ZWRDb25jdXJyZW5jeX0gKi9cbiAgICBjb25zdCBjdXJyZW50ID0gY29uY3VycmVuY3lcbiAgICAgID8ge2NvbmN1cnJlbmN5S2V5OiBjb25jdXJyZW5jeS5jb25jdXJyZW5jeUtleSwgbWF4Q29uY3VycmVuY3k6IGNvbmN1cnJlbmN5Lm1heENvbmN1cnJlbmN5fVxuICAgICAgOiB7Y29uY3VycmVuY3lLZXk6IG51bGwsIG1heENvbmN1cnJlbmN5OiBudWxsfVxuXG4gICAgaWYgKGNvbmN1cnJlbmN5KSBhd2FpdCB0aGlzLl9lbnN1cmVRdWV1ZUNvbmN1cnJlbmN5S2V5KGRiLCBjb25jdXJyZW5jeSlcbiAgICBpZiAoam9iLmNvbmN1cnJlbmN5S2V5ID09PSBjdXJyZW50LmNvbmN1cnJlbmN5S2V5ICYmIGpvYi5tYXhDb25jdXJyZW5jeSA9PT0gY3VycmVudC5tYXhDb25jdXJyZW5jeSkgcmV0dXJuIGpvYlxuXG4gICAgY29uc3QgYWZmZWN0ZWRSb3dzID0gYXdhaXQgdGhpcy5fdXBkYXRlQWZmZWN0ZWRSb3dzKGRiLCB7XG4gICAgICB0YWJsZU5hbWU6IEpPQlNfVEFCTEUsXG4gICAgICBkYXRhOiB7XG4gICAgICAgIGNvbmN1cnJlbmN5X2tleTogY3VycmVudC5jb25jdXJyZW5jeUtleSxcbiAgICAgICAgbWF4X2NvbmN1cnJlbmN5OiBjdXJyZW50Lm1heENvbmN1cnJlbmN5XG4gICAgICB9LFxuICAgICAgY29uZGl0aW9uczoge2NvbmN1cnJlbmN5X2tleTogam9iLmNvbmN1cnJlbmN5S2V5LCBpZDogam9iLmlkLCBzdGF0dXM6IFwicXVldWVkXCJ9XG4gICAgfSlcblxuICAgIGlmIChhZmZlY3RlZFJvd3MgIT09IDEpIHJldHVybiBudWxsXG5cbiAgICByZXR1cm4gey4uLmpvYiwgY29uY3VycmVuY3lLZXk6IGN1cnJlbnQuY29uY3VycmVuY3lLZXksIG1heENvbmN1cnJlbmN5OiBjdXJyZW50Lm1heENvbmN1cnJlbmN5fVxuICB9XG5cbiAgLyoqXG4gICAqIFJlYWRzIHRoZSBjb25maWd1cmVkIG1heCBjb25jdXJyZW5jeSBmb3IgYSBxdWV1ZSBmcm9tIHRoZSBiYWNrZ3JvdW5kLWpvYnMgY29uZmlnLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gcXVldWUgLSBRdWV1ZSBuYW1lLlxuICAgKiBAcmV0dXJucyB7bnVtYmVyIHwgbnVsbH0gLSBQb3NpdGl2ZSBpbnRlZ2VyIGNhcCwgb3IgbnVsbCB3aGVuIHRoZSBxdWV1ZSBoYXMgbm8gY29uZmlndXJlZCBjYXAuXG4gICAqL1xuICBfcXVldWVNYXhDb25jdXJyZW5jeShxdWV1ZSkge1xuICAgIGNvbnN0IHF1ZXVlcyA9IHRoaXMuY29uZmlndXJhdGlvbi5nZXRCYWNrZ3JvdW5kSm9ic0NvbmZpZygpLnF1ZXVlc1xuICAgIGNvbnN0IGNhcCA9IHF1ZXVlcz8uW3F1ZXVlXT8ubWF4Q29uY3VycmVudFxuXG4gICAgaWYgKE51bWJlci5pc0ludGVnZXIoY2FwKSAmJiBOdW1iZXIoY2FwKSA+IDApIHJldHVybiBOdW1iZXIoY2FwKVxuXG4gICAgcmV0dXJuIG51bGxcbiAgfVxuXG4gIC8qKlxuICAgKiBMaWtlIHtAbGluayBfZW5zdXJlQ29uY3VycmVuY3lLZXl9LCBidXQgZm9yIHF1ZXVlLWRlcml2ZWQga2V5cyB0aGUgY29uZmlndXJlZFxuICAgKiBxdWV1ZSBjYXAgaXMgdGhlIHNvdXJjZSBvZiB0cnV0aDogaWYgaXQgY2hhbmdlZCwgdXBkYXRlIHRoZSBzdG9yZWQgY2FwXG4gICAqIGluc3RlYWQgb2YgdGhyb3dpbmcgb24gY29uZmxpY3QgKGNvbmZpZy1kcml2ZW4gY2FwcyBtdXN0IGJlIHR1bmFibGUpLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL2RhdGFiYXNlL2RyaXZlcnMvYmFzZS5qc1wiKS5kZWZhdWx0fSBkYiAtIERhdGFiYXNlIGNvbm5lY3Rpb24uXG4gICAqIEBwYXJhbSB7e2NvbmN1cnJlbmN5S2V5OiBzdHJpbmcsIG1heENvbmN1cnJlbmN5OiBudW1iZXJ9fSBjb25jdXJyZW5jeSAtIENvbmN1cnJlbmN5IGNvbmZpZ3VyYXRpb24uXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIHdoZW4gZW5zdXJlZC5cbiAgICovXG4gIGFzeW5jIF9lbnN1cmVRdWV1ZUNvbmN1cnJlbmN5S2V5KGRiLCB7Y29uY3VycmVuY3lLZXksIG1heENvbmN1cnJlbmN5fSkge1xuICAgIGNvbnN0IHJvd3MgPSBhd2FpdCBkYi5uZXdRdWVyeSgpLmZyb20oQ09OQ1VSUkVOQ1lfVEFCTEUpLndoZXJlKHtjb25jdXJyZW5jeV9rZXk6IGNvbmN1cnJlbmN5S2V5fSkubGltaXQoMSkucmVzdWx0cygpXG5cbiAgICBpZiAoIXJvd3NbMF0pIHtcbiAgICAgIHRyeSB7XG4gICAgICAgIGF3YWl0IGRiLmluc2VydCh7dGFibGVOYW1lOiBDT05DVVJSRU5DWV9UQUJMRSwgZGF0YToge2FjdGl2ZV9jb3VudDogMCwgY29uY3VycmVuY3lfa2V5OiBjb25jdXJyZW5jeUtleSwgbWF4X2NvbmN1cnJlbmN5OiBtYXhDb25jdXJyZW5jeX19KVxuXG4gICAgICAgIHJldHVyblxuICAgICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgICAgY29uc3QgcmFjZWRSb3dzID0gYXdhaXQgZGIubmV3UXVlcnkoKS5mcm9tKENPTkNVUlJFTkNZX1RBQkxFKS53aGVyZSh7Y29uY3VycmVuY3lfa2V5OiBjb25jdXJyZW5jeUtleX0pLmxpbWl0KDEpLnJlc3VsdHMoKVxuXG4gICAgICAgIGlmICghcmFjZWRSb3dzWzBdKSB0aHJvdyBlcnJvclxuXG4gICAgICAgIHJvd3NbMF0gPSByYWNlZFJvd3NbMF1cbiAgICAgIH1cbiAgICB9XG5cbiAgICBjb25zdCBjb25maWd1cmVkID0gLyoqIEB0eXBlIHt7bWF4X2NvbmN1cnJlbmN5PzogbnVtYmVyIHwgc3RyaW5nfX0gKi8gKHJvd3NbMF0pXG5cbiAgICBpZiAodGhpcy5fbm9ybWFsaXplTnVtYmVyKGNvbmZpZ3VyZWQubWF4X2NvbmN1cnJlbmN5KSAhPT0gbWF4Q29uY3VycmVuY3kpIHtcbiAgICAgIGNvbnN0IHRhYmxlID0gZGIucXVvdGVUYWJsZShDT05DVVJSRU5DWV9UQUJMRSlcblxuICAgICAgYXdhaXQgZGIucXVlcnkoYFVQREFURSAke3RhYmxlfSBTRVQgJHtkYi5xdW90ZUNvbHVtbihcIm1heF9jb25jdXJyZW5jeVwiKX0gPSAke051bWJlcihtYXhDb25jdXJyZW5jeSl9IFdIRVJFICR7ZGIucXVvdGVDb2x1bW4oXCJjb25jdXJyZW5jeV9rZXlcIil9ID0gJHtkYi5xdW90ZShjb25jdXJyZW5jeUtleSl9YClcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogRW5zdXJlcyB0aGUgY29uY3VycmVuY3kgc3RhdGUgdGFibGUgZXhpc3RzLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL2RhdGFiYXNlL2RyaXZlcnMvYmFzZS5qc1wiKS5kZWZhdWx0fSBkYiAtIERhdGFiYXNlIGNvbm5lY3Rpb24uXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIHdoZW4gcmVhZHkuXG4gICAqL1xuICBhc3luYyBfZW5zdXJlQ29uY3VycmVuY3lUYWJsZShkYikge1xuICAgIGlmIChhd2FpdCBkYi50YWJsZUV4aXN0cyhDT05DVVJSRU5DWV9UQUJMRSkpIHJldHVyblxuICAgIGNvbnN0IHRhYmxlID0gbmV3IFRhYmxlRGF0YShDT05DVVJSRU5DWV9UQUJMRSwge2lmTm90RXhpc3RzOiB0cnVlfSlcbiAgICB0YWJsZS5zdHJpbmcoXCJjb25jdXJyZW5jeV9rZXlcIiwge3ByaW1hcnlLZXk6IHRydWV9KVxuICAgIHRhYmxlLmludGVnZXIoXCJtYXhfY29uY3VycmVuY3lcIiwge251bGw6IGZhbHNlfSlcbiAgICB0YWJsZS5pbnRlZ2VyKFwiYWN0aXZlX2NvdW50XCIsIHtudWxsOiBmYWxzZX0pXG4gICAgYXdhaXQgZGIuY3JlYXRlVGFibGUodGFibGUpXG4gIH1cblxuICAvKipcbiAgICogRW5zdXJlcyB0aGUgc3RhYmxlIHNjaGVkdWxlLWtleSBvd25lcnNoaXAgdGFibGUgZXhpc3RzLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL2RhdGFiYXNlL2RyaXZlcnMvYmFzZS5qc1wiKS5kZWZhdWx0fSBkYiAtIERhdGFiYXNlIGNvbm5lY3Rpb24uXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIHdoZW4gcmVhZHkuXG4gICAqL1xuICBhc3luYyBfZW5zdXJlU2NoZWR1bGVLZXlzVGFibGUoZGIpIHtcbiAgICBpZiAoYXdhaXQgZGIudGFibGVFeGlzdHMoU0NIRURVTEVfS0VZU19UQUJMRSkpIHJldHVyblxuXG4gICAgY29uc3QgbG9ja05hbWUgPSBgJHtNSUdSQVRJT05fU0NPUEV9OnNjaGVkdWxlX2tleXNfdGFibGVgXG4gICAgY29uc3QgYWNxdWlyZWQgPSBhd2FpdCBkYi5hY3F1aXJlQWR2aXNvcnlMb2NrKGxvY2tOYW1lKVxuXG4gICAgaWYgKCFhY3F1aXJlZCkgdGhyb3cgbmV3IEVycm9yKFwiRmFpbGVkIHRvIGFjcXVpcmUgYmFja2dyb3VuZCBqb2JzIHNjaGVkdWxlLWtleSB0YWJsZSBzY2hlbWEgbG9ja1wiKVxuXG4gICAgdHJ5IHtcbiAgICAgIGRiLmNsZWFyU2NoZW1hQ2FjaGUoKVxuICAgICAgaWYgKGF3YWl0IGRiLnRhYmxlRXhpc3RzKFNDSEVEVUxFX0tFWVNfVEFCTEUpKSByZXR1cm5cblxuICAgICAgY29uc3QgdGFibGUgPSBuZXcgVGFibGVEYXRhKFNDSEVEVUxFX0tFWVNfVEFCTEUsIHtpZk5vdEV4aXN0czogdHJ1ZX0pXG5cbiAgICAgIHRhYmxlLnN0cmluZyhcInNjaGVkdWxlX2tleVwiLCB7cHJpbWFyeUtleTogdHJ1ZX0pXG4gICAgICB0YWJsZS5zdHJpbmcoXCJqb2JfaWRcIiwge251bGw6IGZhbHNlLCBpbmRleDogdHJ1ZX0pXG4gICAgICBhd2FpdCBkYi5jcmVhdGVUYWJsZSh0YWJsZSlcbiAgICAgIGRiLmNsZWFyU2NoZW1hQ2FjaGUoKVxuICAgIH0gZmluYWxseSB7XG4gICAgICBhd2FpdCBkYi5yZWxlYXNlQWR2aXNvcnlMb2NrKGxvY2tOYW1lKVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBFbnN1cmVzIGR1cmFibGUgZ2VuZXJpYyBlbnF1ZXVlIG93bmVyc2hpcCBleGlzdHMgaW5kZXBlbmRlbnRseSBvZiBqb2Igcm93cy5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9kYXRhYmFzZS9kcml2ZXJzL2Jhc2UuanNcIikuZGVmYXVsdH0gZGIgLSBEYXRhYmFzZSBjb25uZWN0aW9uLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyB3aGVuIHJlYWR5LlxuICAgKi9cbiAgYXN5bmMgX2Vuc3VyZUlkZW1wb3RlbmN5S2V5c1RhYmxlKGRiKSB7XG4gICAgaWYgKGF3YWl0IGRiLnRhYmxlRXhpc3RzKElERU1QT1RFTkNZX0tFWVNfVEFCTEUpKSByZXR1cm5cblxuICAgIGNvbnN0IGxvY2tOYW1lID0gYCR7TUlHUkFUSU9OX1NDT1BFfTppZGVtcG90ZW5jeV9rZXlzX3RhYmxlYFxuICAgIGNvbnN0IGFjcXVpcmVkID0gYXdhaXQgZGIuYWNxdWlyZUFkdmlzb3J5TG9jayhsb2NrTmFtZSlcblxuICAgIGlmICghYWNxdWlyZWQpIHRocm93IG5ldyBFcnJvcihcIkZhaWxlZCB0byBhY3F1aXJlIGJhY2tncm91bmQgam9iIGlkZW1wb3RlbmN5LWtleSB0YWJsZSBzY2hlbWEgbG9ja1wiKVxuXG4gICAgdHJ5IHtcbiAgICAgIGRiLmNsZWFyU2NoZW1hQ2FjaGUoKVxuICAgICAgaWYgKGF3YWl0IGRiLnRhYmxlRXhpc3RzKElERU1QT1RFTkNZX0tFWVNfVEFCTEUpKSByZXR1cm5cblxuICAgICAgY29uc3QgdGFibGUgPSBuZXcgVGFibGVEYXRhKElERU1QT1RFTkNZX0tFWVNfVEFCTEUsIHtpZk5vdEV4aXN0czogdHJ1ZX0pXG5cbiAgICAgIHRhYmxlLnN0cmluZyhcInNjb3BlX2RpZ2VzdFwiLCB7cHJpbWFyeUtleTogdHJ1ZX0pXG4gICAgICB0YWJsZS5zdHJpbmcoXCJqb2JfbmFtZVwiLCB7bnVsbDogZmFsc2V9KVxuICAgICAgdGFibGUuc3RyaW5nKFwicXVldWVcIiwge251bGw6IGZhbHNlfSlcbiAgICAgIHRhYmxlLnRleHQoXCJpZGVtcG90ZW5jeV9rZXlcIiwge251bGw6IGZhbHNlfSlcbiAgICAgIHRhYmxlLnN0cmluZyhcImpvYl9pZFwiLCB7aW5kZXg6IHRydWUsIG51bGw6IGZhbHNlfSlcbiAgICAgIHRhYmxlLnN0cmluZyhcInJlcXVlc3RfZGlnZXN0XCIsIHtudWxsOiBmYWxzZX0pXG4gICAgICB0YWJsZS5iaWdpbnQoXCJjcmVhdGVkX2F0X21zXCIsIHtudWxsOiBmYWxzZX0pXG4gICAgICBhd2FpdCBkYi5jcmVhdGVUYWJsZSh0YWJsZSlcbiAgICAgIGRiLmNsZWFyU2NoZW1hQ2FjaGUoKVxuICAgIH0gZmluYWxseSB7XG4gICAgICBhd2FpdCBkYi5yZWxlYXNlQWR2aXNvcnlMb2NrKGxvY2tOYW1lKVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBFbnN1cmVzIGR1cmFibGUgcHJvdmlkZXItYmFja2VkIG1haWwgb3BlcmF0aW9uIHN0YXRlIGV4aXN0cyBpbmRlcGVuZGVudGx5IG9mIGpvYnMuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vZGF0YWJhc2UvZHJpdmVycy9iYXNlLmpzXCIpLmRlZmF1bHR9IGRiIC0gRGF0YWJhc2UgY29ubmVjdGlvbi5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgd2hlbiByZWFkeS5cbiAgICovXG4gIGFzeW5jIF9lbnN1cmVNYWlsRGVsaXZlcnlPcGVyYXRpb25zVGFibGUoZGIpIHtcbiAgICBpZiAoYXdhaXQgZGIudGFibGVFeGlzdHMoTUFJTF9ERUxJVkVSWV9PUEVSQVRJT05TX1RBQkxFKSkgcmV0dXJuXG5cbiAgICBjb25zdCBsb2NrTmFtZSA9IGAke01JR1JBVElPTl9TQ09QRX06bWFpbF9kZWxpdmVyeV9vcGVyYXRpb25zX3RhYmxlYFxuICAgIGNvbnN0IGFjcXVpcmVkID0gYXdhaXQgZGIuYWNxdWlyZUFkdmlzb3J5TG9jayhsb2NrTmFtZSlcblxuICAgIGlmICghYWNxdWlyZWQpIHRocm93IG5ldyBFcnJvcihcIkZhaWxlZCB0byBhY3F1aXJlIG1haWwgZGVsaXZlcnkgb3BlcmF0aW9uIHRhYmxlIHNjaGVtYSBsb2NrXCIpXG5cbiAgICB0cnkge1xuICAgICAgZGIuY2xlYXJTY2hlbWFDYWNoZSgpXG4gICAgICBpZiAoYXdhaXQgZGIudGFibGVFeGlzdHMoTUFJTF9ERUxJVkVSWV9PUEVSQVRJT05TX1RBQkxFKSkgcmV0dXJuXG5cbiAgICAgIGNvbnN0IHRhYmxlID0gbmV3IFRhYmxlRGF0YShNQUlMX0RFTElWRVJZX09QRVJBVElPTlNfVEFCTEUsIHtpZk5vdEV4aXN0czogdHJ1ZX0pXG5cbiAgICAgIHRhYmxlLnN0cmluZyhcIm9wZXJhdGlvbl9rZXlcIiwge3ByaW1hcnlLZXk6IHRydWV9KVxuICAgICAgdGFibGUudGV4dChcIm9wZXJhdGlvbl9pZFwiLCB7bnVsbDogZmFsc2V9KVxuICAgICAgdGFibGUuc3RyaW5nKFwicGF5bG9hZF9kaWdlc3RcIiwge251bGw6IGZhbHNlfSlcbiAgICAgIHRhYmxlLnN0cmluZyhcImJhY2tncm91bmRfam9iX2lkXCIsIHtpbmRleDogdHJ1ZSwgbnVsbDogZmFsc2V9KVxuICAgICAgdGFibGUuYmlnaW50KFwiZmlyc3RfYXR0ZW1wdF9zdGFydGVkX2F0X21zXCIsIHtudWxsOiB0cnVlfSlcbiAgICAgIHRhYmxlLnN0cmluZyhcInByb3ZpZGVyX2tpbmRcIiwge251bGw6IGZhbHNlfSlcbiAgICAgIHRhYmxlLmJpZ2ludChcInByb3ZpZGVyX3JldGVudGlvbl9tc1wiLCB7bnVsbDogZmFsc2V9KVxuICAgICAgdGFibGUuYmlnaW50KFwiY3JlYXRlZF9hdF9tc1wiLCB7bnVsbDogZmFsc2V9KVxuICAgICAgYXdhaXQgZGIuY3JlYXRlVGFibGUodGFibGUpXG4gICAgICBkYi5jbGVhclNjaGVtYUNhY2hlKClcbiAgICB9IGZpbmFsbHkge1xuICAgICAgYXdhaXQgZGIucmVsZWFzZUFkdmlzb3J5TG9jayhsb2NrTmFtZSlcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogRW5zdXJlcyB0aGUgc2luZ2xldG9uIGR1cmFibGUgY291bnQtcmV2aXNpb24gcm93IGV4aXN0cy5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9kYXRhYmFzZS9kcml2ZXJzL2Jhc2UuanNcIikuZGVmYXVsdH0gZGIgLSBEYXRhYmFzZSBjb25uZWN0aW9uLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gUmVzb2x2ZXMgd2hlbiByZWFkeS5cbiAgICovXG4gIGFzeW5jIF9lbnN1cmVDb3VudFJldmlzaW9uVGFibGUoZGIpIHtcbiAgICBpZiAoIShhd2FpdCBkYi50YWJsZUV4aXN0cyhDT1VOVFNfUkVWSVNJT05fVEFCTEUpKSkge1xuICAgICAgY29uc3QgdGFibGUgPSBuZXcgVGFibGVEYXRhKENPVU5UU19SRVZJU0lPTl9UQUJMRSwge2lmTm90RXhpc3RzOiB0cnVlfSlcblxuICAgICAgdGFibGUuc3RyaW5nKFwia2V5XCIsIHtwcmltYXJ5S2V5OiB0cnVlfSlcbiAgICAgIHRhYmxlLmJpZ2ludChcInJldmlzaW9uXCIsIHtudWxsOiBmYWxzZX0pXG4gICAgICBhd2FpdCBkYi5jcmVhdGVUYWJsZSh0YWJsZSlcbiAgICB9XG5cbiAgICBjb25zdCByb3dzID0gYXdhaXQgZGIubmV3UXVlcnkoKS5mcm9tKENPVU5UU19SRVZJU0lPTl9UQUJMRSkud2hlcmUoe2tleTogQ09VTlRTX1JFVklTSU9OX0tFWX0pLmxpbWl0KDEpLnJlc3VsdHMoKVxuXG4gICAgaWYgKHJvd3MubGVuZ3RoID4gMCkgcmV0dXJuXG5cbiAgICB0cnkge1xuICAgICAgYXdhaXQgZGIuaW5zZXJ0KHt0YWJsZU5hbWU6IENPVU5UU19SRVZJU0lPTl9UQUJMRSwgZGF0YToge2tleTogQ09VTlRTX1JFVklTSU9OX0tFWSwgcmV2aXNpb246IDB9fSlcbiAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgY29uc3QgcmFjZWRSb3dzID0gYXdhaXQgZGIubmV3UXVlcnkoKS5mcm9tKENPVU5UU19SRVZJU0lPTl9UQUJMRSkud2hlcmUoe2tleTogQ09VTlRTX1JFVklTSU9OX0tFWX0pLmxpbWl0KDEpLnJlc3VsdHMoKVxuXG4gICAgICBpZiAocmFjZWRSb3dzLmxlbmd0aCA9PT0gMCkgdGhyb3cgZXJyb3JcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogUmVjb3JkcyBvbmUgbG9naWNhbCBjb3VudCBtdXRhdGlvbiBhdG9taWNhbGx5IGFuZCBicm9hZGNhc3RzIGl0IGFmdGVyIGNvbW1pdC5cbiAgICogWmVybyBlbnRyaWVzIGFyZSBvbWl0dGVkOyBhIHdob2xseSB6ZXJvLW5ldCBtdXRhdGlvbiBkb2VzIG5vdCBjb25zdW1lIGEgcmV2aXNpb24uXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vZGF0YWJhc2UvZHJpdmVycy9iYXNlLmpzXCIpLmRlZmF1bHR9IGRiIC0gVHJhbnNhY3Rpb24gY29ubmVjdGlvbi5cbiAgICogQHBhcmFtIHtSZWNvcmQ8c3RyaW5nLCBudW1iZXI+fSByZXF1ZXN0ZWREZWx0YXMgLSBTaWduZWQgYnVja2V0IGNoYW5nZXMuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSBSZXNvbHZlcyB3aGVuIHJlY29yZGVkLlxuICAgKi9cbiAgYXN5bmMgX3JlY29yZENvdW50RGVsdGEoZGIsIHJlcXVlc3RlZERlbHRhcykge1xuICAgIC8qKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgbnVtYmVyPn0gKi9cbiAgICBjb25zdCBkZWx0YXMgPSB7fVxuXG4gICAgZm9yIChjb25zdCBidWNrZXQgb2YgQkFDS0dST1VORF9KT0JfQ09VTlRfQlVDS0VUUykge1xuICAgICAgY29uc3QgYW1vdW50ID0gcmVxdWVzdGVkRGVsdGFzW2J1Y2tldF0gfHwgMFxuXG4gICAgICBpZiAoIU51bWJlci5pc0ludGVnZXIoYW1vdW50KSkgdGhyb3cgbmV3IEVycm9yKGBJbnZhbGlkIGJhY2tncm91bmQgam9iIGNvdW50IGRlbHRhIGZvciAke2J1Y2tldH06ICR7YW1vdW50fWApXG4gICAgICBpZiAoYW1vdW50ICE9PSAwKSBkZWx0YXNbYnVja2V0XSA9IGFtb3VudFxuICAgIH1cblxuICAgIGlmIChPYmplY3Qua2V5cyhkZWx0YXMpLmxlbmd0aCA9PT0gMCkgcmV0dXJuXG5cbiAgICBjb25zdCB0YWJsZSA9IGRiLnF1b3RlVGFibGUoQ09VTlRTX1JFVklTSU9OX1RBQkxFKVxuICAgIGNvbnN0IHJldmlzaW9uQ29sdW1uID0gZGIucXVvdGVDb2x1bW4oXCJyZXZpc2lvblwiKVxuICAgIGNvbnN0IGFmZmVjdGVkUm93cyA9IGF3YWl0IGRiLmFmZmVjdGVkUm93cyhcbiAgICAgIGBVUERBVEUgJHt0YWJsZX0gU0VUICR7cmV2aXNpb25Db2x1bW59ID0gJHtyZXZpc2lvbkNvbHVtbn0gKyAxIFdIRVJFICR7ZGIucXVvdGVDb2x1bW4oXCJrZXlcIil9ID0gJHtkYi5xdW90ZShDT1VOVFNfUkVWSVNJT05fS0VZKX1gXG4gICAgKVxuXG4gICAgaWYgKGFmZmVjdGVkUm93cyAhPT0gMSkgdGhyb3cgbmV3IEVycm9yKFwiQmFja2dyb3VuZCBqb2IgY291bnQgcmV2aXNpb24gcm93IGlzIG1pc3NpbmdcIilcblxuICAgIGNvbnN0IHJldmlzaW9uID0gYXdhaXQgdGhpcy5fY291bnRSZXZpc2lvbihkYilcbiAgICBjb25zdCBib2R5ID0ge2RlbHRhcywgcmV2aXNpb24sIHR5cGU6IFwiYmFja2dyb3VuZC1qb2ItY291bnQtZGVsdGFcIn1cbiAgICBjb25zdCBkYXRhYmFzZUlkZW50aWZpZXIgPSB0aGlzLmdldERhdGFiYXNlSWRlbnRpZmllcigpIHx8IFwiZGVmYXVsdFwiXG5cbiAgICBhd2FpdCBkYi5hZnRlckNvbW1pdCgoKSA9PiB7XG4gICAgICB0aGlzLmNvbmZpZ3VyYXRpb24uYnJvYWRjYXN0VG9DaGFubmVsKEJBQ0tHUk9VTkRfSk9CX0NPVU5UU19DSEFOTkVMLCB7ZGF0YWJhc2VJZGVudGlmaWVyfSwgYm9keSlcbiAgICB9KVxuICB9XG5cbiAgLyoqXG4gICAqIFJlY29yZHMgYSB0cmFuc2l0aW9uIGJldHdlZW4gcGVyc2lzdGVkIHN0YXR1c2VzLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL2RhdGFiYXNlL2RyaXZlcnMvYmFzZS5qc1wiKS5kZWZhdWx0fSBkYiAtIFRyYW5zYWN0aW9uIGNvbm5lY3Rpb24uXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBvbGRTdGF0dXMgLSBQcmV2aW91cyBzdGF0dXMuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBuZXdTdGF0dXMgLSBOZXcgc3RhdHVzLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gUmVzb2x2ZXMgd2hlbiByZWNvcmRlZC5cbiAgICovXG4gIGFzeW5jIF9yZWNvcmRTdGF0dXNUcmFuc2l0aW9uKGRiLCBvbGRTdGF0dXMsIG5ld1N0YXR1cykge1xuICAgIGNvbnN0IG9sZENvdW50ZWQgPSBDT1VOVEVEX0pPQl9TVEFUVVNFUy5pbmNsdWRlcyhvbGRTdGF0dXMpXG4gICAgY29uc3QgbmV3Q291bnRlZCA9IENPVU5URURfSk9CX1NUQVRVU0VTLmluY2x1ZGVzKG5ld1N0YXR1cylcblxuICAgIGlmICghb2xkQ291bnRlZCAmJiBvbGRTdGF0dXMgIT09IFwiY2FuY2VsbGVkXCIpIHRocm93IG5ldyBFcnJvcihgVW5rbm93biBwcmV2aW91cyBiYWNrZ3JvdW5kIGpvYiBzdGF0dXM6ICR7b2xkU3RhdHVzfWApXG4gICAgaWYgKCFuZXdDb3VudGVkICYmIG5ld1N0YXR1cyAhPT0gXCJjYW5jZWxsZWRcIikgdGhyb3cgbmV3IEVycm9yKGBVbmtub3duIG5leHQgYmFja2dyb3VuZCBqb2Igc3RhdHVzOiAke25ld1N0YXR1c31gKVxuICAgIGlmIChvbGRTdGF0dXMgPT09IG5ld1N0YXR1cykgcmV0dXJuXG5cbiAgICAvKiogQHR5cGUge1JlY29yZDxzdHJpbmcsIG51bWJlcj59ICovXG4gICAgY29uc3QgZGVsdGFzID0ge31cblxuICAgIGlmIChvbGRDb3VudGVkKSBkZWx0YXNbb2xkU3RhdHVzXSA9IC0xXG4gICAgaWYgKG5ld0NvdW50ZWQpIGRlbHRhc1tuZXdTdGF0dXNdID0gMVxuICAgIGlmIChvbGRDb3VudGVkICE9PSBuZXdDb3VudGVkKSBkZWx0YXMuYWxsID0gbmV3Q291bnRlZCA/IDEgOiAtMVxuICAgIGF3YWl0IHRoaXMuX3JlY29yZENvdW50RGVsdGEoZGIsIGRlbHRhcylcbiAgfVxuXG4gIC8qKlxuICAgKiBSZWFkcyB0aGUgbG9ja2VkIHJldmlzaW9uLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL2RhdGFiYXNlL2RyaXZlcnMvYmFzZS5qc1wiKS5kZWZhdWx0fSBkYiAtIERhdGFiYXNlIGNvbm5lY3Rpb24uXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPG51bWJlcj59IFJldmlzaW9uLlxuICAgKi9cbiAgYXN5bmMgX2NvdW50UmV2aXNpb24oZGIpIHtcbiAgICBjb25zdCByb3dzID0gYXdhaXQgZGIubmV3UXVlcnkoKS5mcm9tKENPVU5UU19SRVZJU0lPTl9UQUJMRSkuc2VsZWN0KFwicmV2aXNpb25cIikud2hlcmUoe2tleTogQ09VTlRTX1JFVklTSU9OX0tFWX0pLmxpbWl0KDEpLnJlc3VsdHMoKVxuICAgIGNvbnN0IHJldmlzaW9uID0gdGhpcy5fbm9ybWFsaXplTnVtYmVyKC8qKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSAqLyAocm93c1swXSB8fCB7fSkucmV2aXNpb24pXG5cbiAgICBpZiAocmV2aXNpb24gPT09IG51bGwgfHwgIU51bWJlci5pc1NhZmVJbnRlZ2VyKHJldmlzaW9uKSB8fCByZXZpc2lvbiA8IDApIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihgSW52YWxpZCBiYWNrZ3JvdW5kIGpvYiBjb3VudCByZXZpc2lvbjogJHtyZXZpc2lvbn1gKVxuICAgIH1cblxuICAgIHJldHVybiByZXZpc2lvblxuICB9XG5cbiAgLyoqXG4gICAqIFRha2VzIGEgcG9ydGFibGUgd3JpdGUgbG9jayBvbiB0aGUgc2luZ2xldG9uIHJldmlzaW9uIHJvdy5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9kYXRhYmFzZS9kcml2ZXJzL2Jhc2UuanNcIikuZGVmYXVsdH0gZGIgLSBEYXRhYmFzZSBjb25uZWN0aW9uLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gUmVzb2x2ZXMgd2hlbiBsb2NrZWQuXG4gICAqL1xuICBhc3luYyBfbG9ja0NvdW50UmV2aXNpb24oZGIpIHtcbiAgICBjb25zdCB0YWJsZSA9IGRiLnF1b3RlVGFibGUoQ09VTlRTX1JFVklTSU9OX1RBQkxFKVxuICAgIGNvbnN0IHJldmlzaW9uID0gZGIucXVvdGVDb2x1bW4oXCJyZXZpc2lvblwiKVxuXG4gICAgYXdhaXQgZGIucXVlcnkoYFVQREFURSAke3RhYmxlfSBTRVQgJHtyZXZpc2lvbn0gPSAke3JldmlzaW9ufSBXSEVSRSAke2RiLnF1b3RlQ29sdW1uKFwia2V5XCIpfSA9ICR7ZGIucXVvdGUoQ09VTlRTX1JFVklTSU9OX0tFWSl9YClcbiAgfVxuXG4gIC8qKlxuICAgKiBCdWlsZHMgemVyb2VkIGNhbm9uaWNhbCBidWNrZXRzLlxuICAgKiBAcmV0dXJucyB7UmVjb3JkPHN0cmluZywgbnVtYmVyPn0gWmVyb2VkIGNhbm9uaWNhbCBidWNrZXRzLlxuICAgKi9cbiAgX2VtcHR5Q291bnRCdWNrZXRzKCkge1xuICAgIHJldHVybiBPYmplY3QuZnJvbUVudHJpZXMoQkFDS0dST1VORF9KT0JfQ09VTlRfQlVDS0VUUy5tYXAoKGJ1Y2tldCkgPT4gW2J1Y2tldCwgMF0pKVxuICB9XG5cbiAgLyoqXG4gICAqIENvdW50cyBub3JtYWxpemVkIHJvd3MgYnkgY2Fub25pY2FsIHN0YXR1cy5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL3R5cGVzLmpzXCIpLkJhY2tncm91bmRKb2JSb3dbXX0gam9icyAtIEpvYnMuXG4gICAqIEByZXR1cm5zIHtSZWNvcmQ8c3RyaW5nLCBudW1iZXI+fSBDb3VudHMuXG4gICAqL1xuICBfc3RhdHVzQ291bnRzKGpvYnMpIHtcbiAgICAvKiogQHR5cGUge1JlY29yZDxzdHJpbmcsIG51bWJlcj59ICovXG4gICAgY29uc3QgY291bnRzID0ge31cblxuICAgIGZvciAoY29uc3Qgam9iIG9mIGpvYnMpIHtcbiAgICAgIGlmICghQ09VTlRFRF9KT0JfU1RBVFVTRVMuaW5jbHVkZXMoam9iLnN0YXR1cykpIHRocm93IG5ldyBFcnJvcihgVW5rbm93biBiYWNrZ3JvdW5kIGpvYiBzdGF0dXM6ICR7am9iLnN0YXR1c31gKVxuICAgICAgY291bnRzW2pvYi5zdGF0dXNdID0gKGNvdW50c1tqb2Iuc3RhdHVzXSB8fCAwKSArIDFcbiAgICB9XG5cbiAgICByZXR1cm4gY291bnRzXG4gIH1cblxuICAvKipcbiAgICogUmVhZHMgYSBjYW5vbmljYWwgc25hcHNob3QgYWZ0ZXIgbG9ja2luZyB0aGUgcmV2aXNpb24gcm93LlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL2RhdGFiYXNlL2RyaXZlcnMvYmFzZS5qc1wiKS5kZWZhdWx0fSBkYiAtIFRyYW5zYWN0aW9uIGNvbm5lY3Rpb24uXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHtjb3VudHM6IFJlY29yZDxzdHJpbmcsIG51bWJlcj4sIHJldmlzaW9uOiBudW1iZXIsIHRvdGFsOiBudW1iZXJ9Pn0gU25hcHNob3QuXG4gICAqL1xuICBhc3luYyBfY291bnRTbmFwc2hvdE9uTG9ja2VkQ29ubmVjdGlvbihkYikge1xuICAgIGNvbnN0IHJvd3MgPSBhd2FpdCBkYi5uZXdRdWVyeSgpLmZyb20oSk9CU19UQUJMRSkuc2VsZWN0KFwic3RhdHVzXCIpLnNlbGVjdChcIkNPVU5UKCopIEFTIGNvdW50XCIpLmdyb3VwKFwic3RhdHVzXCIpLnJlc3VsdHMoKVxuICAgIGNvbnN0IGNvdW50cyA9IHRoaXMuX2VtcHR5Q291bnRCdWNrZXRzKClcbiAgICBsZXQgdG90YWwgPSAwXG5cbiAgICBmb3IgKGNvbnN0IHJvdyBvZiByb3dzKSB7XG4gICAgICBjb25zdCB0eXBlZFJvdyA9IC8qKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSAqLyAocm93KVxuICAgICAgY29uc3Qgc3RhdHVzID0gU3RyaW5nKHR5cGVkUm93LnN0YXR1cylcbiAgICAgIGNvbnN0IGNvdW50ID0gdGhpcy5fbm9ybWFsaXplTnVtYmVyKHR5cGVkUm93LmNvdW50KSB8fCAwXG5cbiAgICAgIHRvdGFsICs9IGNvdW50XG5cbiAgICAgIGlmICghQ09VTlRFRF9KT0JfU1RBVFVTRVMuaW5jbHVkZXMoc3RhdHVzKSkgY29udGludWVcbiAgICAgIGNvdW50c1tzdGF0dXNdID0gY291bnRcbiAgICAgIGNvdW50cy5hbGwgKz0gY291bnRzW3N0YXR1c11cbiAgICB9XG5cbiAgICByZXR1cm4ge2NvdW50cywgcmV2aXNpb246IGF3YWl0IHRoaXMuX2NvdW50UmV2aXNpb24oZGIpLCB0b3RhbH1cbiAgfVxuXG4gIC8qKlxuICAgKiBSZWdpc3RlcnMgb3IgdmVyaWZpZXMgYSBzdGFibGUga2V5IGNvbmZpZ3VyYXRpb24uXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vZGF0YWJhc2UvZHJpdmVycy9iYXNlLmpzXCIpLmRlZmF1bHR9IGRiIC0gRGF0YWJhc2UgY29ubmVjdGlvbi5cbiAgICogQHBhcmFtIHtvYmplY3R9IGNvbmN1cnJlbmN5IC0gQ29uY3VycmVuY3kgY29uZmlndXJhdGlvbi5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGNvbmN1cnJlbmN5LmNvbmN1cnJlbmN5S2V5IC0gQ29uY3VycmVuY3kga2V5LlxuICAgKiBAcGFyYW0ge251bWJlcn0gY29uY3VycmVuY3kubWF4Q29uY3VycmVuY3kgLSBTdGFibGUgY2FwLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyB3aGVuIHZlcmlmaWVkLlxuICAgKi9cbiAgYXN5bmMgX2Vuc3VyZUNvbmN1cnJlbmN5S2V5KGRiLCB7Y29uY3VycmVuY3lLZXksIG1heENvbmN1cnJlbmN5fSkge1xuICAgIGNvbnN0IHJvd3MgPSBhd2FpdCBkYi5uZXdRdWVyeSgpLmZyb20oQ09OQ1VSUkVOQ1lfVEFCTEUpLndoZXJlKHtjb25jdXJyZW5jeV9rZXk6IGNvbmN1cnJlbmN5S2V5fSkubGltaXQoMSkucmVzdWx0cygpXG4gICAgaWYgKCFyb3dzWzBdKSB7XG4gICAgICB0cnkge1xuICAgICAgICBhd2FpdCBkYi5pbnNlcnQoe3RhYmxlTmFtZTogQ09OQ1VSUkVOQ1lfVEFCTEUsIGRhdGE6IHthY3RpdmVfY291bnQ6IDAsIGNvbmN1cnJlbmN5X2tleTogY29uY3VycmVuY3lLZXksIG1heF9jb25jdXJyZW5jeTogbWF4Q29uY3VycmVuY3l9fSlcbiAgICAgICAgcmV0dXJuXG4gICAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgICBjb25zdCByYWNlZFJvd3MgPSBhd2FpdCBkYi5uZXdRdWVyeSgpLmZyb20oQ09OQ1VSUkVOQ1lfVEFCTEUpLndoZXJlKHtjb25jdXJyZW5jeV9rZXk6IGNvbmN1cnJlbmN5S2V5fSkubGltaXQoMSkucmVzdWx0cygpXG4gICAgICAgIGlmICghcmFjZWRSb3dzWzBdKSB0aHJvdyBlcnJvclxuICAgICAgICByb3dzWzBdID0gcmFjZWRSb3dzWzBdXG4gICAgICB9XG4gICAgfVxuICAgIGNvbnN0IGNvbmZpZ3VyZWQgPSAvKiogQHR5cGUge3ttYXhfY29uY3VycmVuY3k/OiBudW1iZXIgfCBzdHJpbmd9fSAqLyAocm93c1swXSlcbiAgICBpZiAodGhpcy5fbm9ybWFsaXplTnVtYmVyKGNvbmZpZ3VyZWQubWF4X2NvbmN1cnJlbmN5KSAhPT0gbWF4Q29uY3VycmVuY3kpIHRocm93IG5ldyBFcnJvcihgQ29uZmxpY3RpbmcgbWF4Q29uY3VycmVuY3kgZm9yIGJhY2tncm91bmQgam9iIGNvbmN1cnJlbmN5S2V5OiAke2NvbmN1cnJlbmN5S2V5fWApXG4gIH1cblxuICAvKipcbiAgICogTG9ja3MgdGhlIGNvbmN1cnJlbmN5IGNvdW50ZXIgcm93IHNvIGEgam9iLXJlbGVhc2UgdHJhbnNhY3Rpb24gYWNxdWlyZXMgaXQgKmJlZm9yZSogdGhlIGpvYlxuICAgKiByb3cuIHtAbGluayBtYXJrSGFuZGVkT2ZmfSByZXNlcnZlcyBjYXBhY2l0eSAobG9ja2luZyB0aGUgY291bnRlciByb3cpIGJlZm9yZSBpdCB1cGRhdGVzIHRoZVxuICAgKiBqb2IsIHNvIGl0IGxvY2tzIGNvbmN1cnJlbmN5LXRoZW4tam9iOyB0aGUgcmVsZWFzZSBwYXRocyB1cGRhdGUgdGhlIGpvYiBiZWZvcmUgcmVsZWFzaW5nXG4gICAqIGNhcGFjaXR5LCB3aGljaCBpcyBqb2ItdGhlbi1jb25jdXJyZW5jeS4gVGhvc2Ugb3Bwb3NpdGUgb3JkZXJzIG9uIHRoZSBzYW1lIHNoYXJlZCBjb3VudGVyIHJvd1xuICAgKiBhcmUgd2hhdCBkZWFkbG9jayAoQUItQkEpIHVuZGVyIGEgZHJhaW5pbmcgd29ya2VyLiBUYWtpbmcgdGhpcyBsb2NrIGZpcnN0IGdpdmVzIGV2ZXJ5XG4gICAqIHRyYW5zYWN0aW9uIGEgc2luZ2xlIGNvbmN1cnJlbmN5LXRoZW4tam9iIG9yZGVyIGFuZCByZW1vdmVzIHRoZSBjeWNsZS5cbiAgICpcbiAgICogVXNlcyBhIHZhbHVlLXByZXNlcnZpbmcgYFVQREFURWAgcmF0aGVyIHRoYW4gYFNFTEVDVCAuLi4gRk9SIFVQREFURWAgc28gaXQgc3RheXMgcG9ydGFibGVcbiAgICogYWNyb3NzIGRyaXZlcnMgd2l0aG91dCByb3ctbGV2ZWwgbG9ja2luZyByZWFkcyAoZS5nLiBTUUxpdGUpOyBvbiByb3ctbG9ja2luZyBlbmdpbmVzIHRoZVxuICAgKiBtYXRjaGVkIHJvdyBpcyB3cml0ZS1sb2NrZWQgZm9yIHRoZSByZXN0IG9mIHRoZSB0cmFuc2FjdGlvbiBldmVuIHRob3VnaCBpdHMgdmFsdWUgaXMgdW5jaGFuZ2VkLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL2RhdGFiYXNlL2RyaXZlcnMvYmFzZS5qc1wiKS5kZWZhdWx0fSBkYiAtIERhdGFiYXNlIGNvbm5lY3Rpb24uXG4gICAqIEBwYXJhbSB7c3RyaW5nIHwgbnVsbH0gY29uY3VycmVuY3lLZXkgLSBDb25jdXJyZW5jeSBrZXkuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIHdoZW4gdGhlIGNvdW50ZXIgcm93IGlzIGxvY2tlZC5cbiAgICovXG4gIGFzeW5jIF9sb2NrQ29uY3VycmVuY3lSb3coZGIsIGNvbmN1cnJlbmN5S2V5KSB7XG4gICAgaWYgKCFjb25jdXJyZW5jeUtleSkgcmV0dXJuXG4gICAgY29uc3QgdGFibGUgPSBkYi5xdW90ZVRhYmxlKENPTkNVUlJFTkNZX1RBQkxFKVxuICAgIGNvbnN0IGNvdW50ID0gZGIucXVvdGVDb2x1bW4oXCJhY3RpdmVfY291bnRcIilcbiAgICBhd2FpdCBkYi5xdWVyeShgVVBEQVRFICR7dGFibGV9IFNFVCAke2NvdW50fSA9ICR7Y291bnR9IFdIRVJFICR7ZGIucXVvdGVDb2x1bW4oXCJjb25jdXJyZW5jeV9rZXlcIil9ID0gJHtkYi5xdW90ZShjb25jdXJyZW5jeUtleSl9YClcbiAgfVxuXG4gIC8qKlxuICAgKiBBdG9taWNhbGx5IHJlc2VydmVzIGNhcGFjaXR5IGZvciBhIGtleS5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9kYXRhYmFzZS9kcml2ZXJzL2Jhc2UuanNcIikuZGVmYXVsdH0gZGIgLSBEYXRhYmFzZSBjb25uZWN0aW9uLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gY29uY3VycmVuY3lLZXkgLSBDb25jdXJyZW5jeSBrZXkuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPGJvb2xlYW4+fSAtIFdoZXRoZXIgY2FwYWNpdHkgd2FzIHJlc2VydmVkLlxuICAgKi9cbiAgYXN5bmMgX3Jlc2VydmVDb25jdXJyZW5jeShkYiwgY29uY3VycmVuY3lLZXkpIHtcbiAgICBjb25zdCB0YWJsZSA9IGRiLnF1b3RlVGFibGUoQ09OQ1VSUkVOQ1lfVEFCTEUpXG4gICAgY29uc3QgY291bnQgPSBkYi5xdW90ZUNvbHVtbihcImFjdGl2ZV9jb3VudFwiKVxuICAgIGNvbnN0IGFmZmVjdGVkUm93cyA9IGF3YWl0IGRiLmFmZmVjdGVkUm93cyhgVVBEQVRFICR7dGFibGV9IFNFVCAke2NvdW50fSA9ICR7Y291bnR9ICsgMSBXSEVSRSAke2RiLnF1b3RlQ29sdW1uKFwiY29uY3VycmVuY3lfa2V5XCIpfSA9ICR7ZGIucXVvdGUoY29uY3VycmVuY3lLZXkpfSBBTkQgJHtjb3VudH0gPCAke2RiLnF1b3RlQ29sdW1uKFwibWF4X2NvbmN1cnJlbmN5XCIpfWApXG4gICAgcmV0dXJuIGFmZmVjdGVkUm93cyA9PT0gMVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgYSBwb3J0YWJsZSB1cGRhdGUgYW5kIHJldHVybnMgaXRzIGFmZmVjdGVkLXJvdyBjb3VudC5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9kYXRhYmFzZS9kcml2ZXJzL2Jhc2UuanNcIikuZGVmYXVsdH0gZGIgLSBEYXRhYmFzZSBjb25uZWN0aW9uLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL2RhdGFiYXNlL2RyaXZlcnMvYmFzZS5qc1wiKS5VcGRhdGVTcWxBcmdzVHlwZX0gYXJncyAtIFVwZGF0ZSBvcHRpb25zLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxudW1iZXI+fSAtIEFmZmVjdGVkIHJvdyBjb3VudC5cbiAgICovXG4gIGFzeW5jIF91cGRhdGVBZmZlY3RlZFJvd3MoZGIsIGFyZ3MpIHtcbiAgICByZXR1cm4gYXdhaXQgZGIuYWZmZWN0ZWRSb3dzKGRiLnVwZGF0ZVNxbChhcmdzKSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSZWxlYXNlcyBjYXBhY2l0eSBmb3IgYSBrZXkuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vZGF0YWJhc2UvZHJpdmVycy9iYXNlLmpzXCIpLmRlZmF1bHR9IGRiIC0gRGF0YWJhc2UgY29ubmVjdGlvbi5cbiAgICogQHBhcmFtIHtzdHJpbmcgfCBudWxsfSBjb25jdXJyZW5jeUtleSAtIENvbmN1cnJlbmN5IGtleS5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgd2hlbiByZWxlYXNlZC5cbiAgICovXG4gIGFzeW5jIF9yZWxlYXNlQ29uY3VycmVuY3koZGIsIGNvbmN1cnJlbmN5S2V5KSB7XG4gICAgaWYgKCFjb25jdXJyZW5jeUtleSkgcmV0dXJuXG4gICAgY29uc3QgdGFibGUgPSBkYi5xdW90ZVRhYmxlKENPTkNVUlJFTkNZX1RBQkxFKVxuICAgIGNvbnN0IGNvdW50ID0gZGIucXVvdGVDb2x1bW4oXCJhY3RpdmVfY291bnRcIilcbiAgICBhd2FpdCBkYi5xdWVyeShgVVBEQVRFICR7dGFibGV9IFNFVCAke2NvdW50fSA9ICR7Y291bnR9IC0gMSBXSEVSRSAke2RiLnF1b3RlQ29sdW1uKFwiY29uY3VycmVuY3lfa2V5XCIpfSA9ICR7ZGIucXVvdGUoY29uY3VycmVuY3lLZXkpfSBBTkQgJHtjb3VudH0gPiAwYClcbiAgfVxuXG4gIC8qKlxuICAgKiBSZWJ1aWxkcyBkdXJhYmxlIGNvdW50cyBmcm9tIGFjdGl2ZSBoYW5kb2Zmcy5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9kYXRhYmFzZS9kcml2ZXJzL2Jhc2UuanNcIikuZGVmYXVsdH0gZGIgLSBEYXRhYmFzZSBjb25uZWN0aW9uLlxuICAgKiBAcGFyYW0ge3tpbnNpZGVUcmFuc2FjdGlvbj86IGJvb2xlYW59fSBbb3B0aW9uc10gLSBSZXVzZSBhbiBlbmNsb3NpbmcgdHJhbnNhY3Rpb24uXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPGltcG9ydChcIi4vdHlwZXMuanNcIikuQmFja2dyb3VuZEpvYkNvbmN1cnJlbmN5UmVjb25jaWxpYXRpb24+fSAtIFJlcGFpciBzdW1tYXJ5LlxuICAgKi9cbiAgYXN5bmMgX3JlY29uY2lsZUNvbmN1cnJlbmN5KGRiLCB7aW5zaWRlVHJhbnNhY3Rpb24gPSBmYWxzZX0gPSB7fSkge1xuICAgIGlmICghKGF3YWl0IGRiLnRhYmxlRXhpc3RzKENPTkNVUlJFTkNZX1RBQkxFKSkpIHtcbiAgICAgIHJldHVybiB7Y2FuZGlkYXRlQ291bnQ6IDAsIGNoZWNrZWRDb3VudDogMCwgcmVwYWlyZWRDb3VudDogMCwgcmVwYWlyczogW10sIHJlcGFpcnNUcnVuY2F0ZWRDb3VudDogMH1cbiAgICB9XG5cbiAgICBjb25zdCBhY3RpdmVSb3dzID0gYXdhaXQgZGJcbiAgICAgIC5uZXdRdWVyeSgpXG4gICAgICAuZnJvbShKT0JTX1RBQkxFKVxuICAgICAgLnNlbGVjdChcImNvbmN1cnJlbmN5X2tleVwiKVxuICAgICAgLnNlbGVjdChcIkNPVU5UKCopIEFTIGFjdGl2ZV9jb3VudFwiKVxuICAgICAgLndoZXJlKHtzdGF0dXM6IFwiaGFuZGVkX29mZlwifSlcbiAgICAgIC53aGVyZShgJHtkYi5xdW90ZUNvbHVtbihcImNvbmN1cnJlbmN5X2tleVwiKX0gSVMgTk9UIE5VTExgKVxuICAgICAgLmdyb3VwKFwiY29uY3VycmVuY3lfa2V5XCIpXG4gICAgICAucmVzdWx0cygpXG4gICAgY29uc3Qgc3RhbGVSb3dzID0gYXdhaXQgZGJcbiAgICAgIC5uZXdRdWVyeSgpXG4gICAgICAuZnJvbShDT05DVVJSRU5DWV9UQUJMRSlcbiAgICAgIC5zZWxlY3QoXCJjb25jdXJyZW5jeV9rZXlcIilcbiAgICAgIC5zZWxlY3QoXCJhY3RpdmVfY291bnRcIilcbiAgICAgIC53aGVyZShgJHtkYi5xdW90ZUNvbHVtbihcImFjdGl2ZV9jb3VudFwiKX0gIT0gMGApXG4gICAgICAucmVzdWx0cygpXG4gICAgLyoqIEB0eXBlIHtNYXA8c3RyaW5nLCBudW1iZXI+fSAqL1xuICAgIGNvbnN0IGFjdGl2ZUNvdW50cyA9IG5ldyBNYXAoKVxuICAgIC8qKiBAdHlwZSB7TWFwPHN0cmluZywgbnVtYmVyPn0gKi9cbiAgICBjb25zdCBwZXJzaXN0ZWRDb3VudHMgPSBuZXcgTWFwKClcblxuICAgIGZvciAoY29uc3QgcmF3Um93IG9mIGFjdGl2ZVJvd3MpIHtcbiAgICAgIGNvbnN0IHJvdyA9IC8qKiBAdHlwZSB7QmFja2dyb3VuZEpvYkNvbmN1cnJlbmN5Q291bnRSb3d9ICovIChyYXdSb3cpXG4gICAgICBhY3RpdmVDb3VudHMuc2V0KHJvdy5jb25jdXJyZW5jeV9rZXksIHRoaXMuX3ZhbGlkYXRlZENvbmN1cnJlbmN5Q291bnQocm93LmFjdGl2ZV9jb3VudCwgcm93LmNvbmN1cnJlbmN5X2tleSkpXG4gICAgfVxuXG4gICAgZm9yIChjb25zdCByYXdSb3cgb2Ygc3RhbGVSb3dzKSB7XG4gICAgICBjb25zdCByb3cgPSAvKiogQHR5cGUge0JhY2tncm91bmRKb2JDb25jdXJyZW5jeUNvdW50Um93fSAqLyAocmF3Um93KVxuICAgICAgcGVyc2lzdGVkQ291bnRzLnNldChyb3cuY29uY3VycmVuY3lfa2V5LCB0aGlzLl92YWxpZGF0ZWRDb25jdXJyZW5jeUNvdW50KHJvdy5hY3RpdmVfY291bnQsIHJvdy5jb25jdXJyZW5jeV9rZXkpKVxuICAgIH1cblxuICAgIGNvbnN0IGNvbmN1cnJlbmN5S2V5cyA9IFsuLi5uZXcgU2V0KFsuLi5hY3RpdmVDb3VudHMua2V5cygpLCAuLi5wZXJzaXN0ZWRDb3VudHMua2V5cygpXSldLnNvcnQoKVxuICAgIGNvbnN0IGNhbmRpZGF0ZUtleXMgPSBjb25jdXJyZW5jeUtleXMuZmlsdGVyKChjb25jdXJyZW5jeUtleSkgPT4ge1xuICAgICAgcmV0dXJuIChhY3RpdmVDb3VudHMuZ2V0KGNvbmN1cnJlbmN5S2V5KSB8fCAwKSAhPT0gKHBlcnNpc3RlZENvdW50cy5nZXQoY29uY3VycmVuY3lLZXkpIHx8IDApXG4gICAgfSlcbiAgICAvKiogQHR5cGUge2ltcG9ydChcIi4vdHlwZXMuanNcIikuQmFja2dyb3VuZEpvYkNvbmN1cnJlbmN5UmVwYWlyW119ICovXG4gICAgY29uc3QgcmVwYWlycyA9IFtdXG4gICAgbGV0IHJlcGFpcmVkQ291bnQgPSAwXG5cbiAgICBmb3IgKGNvbnN0IGNvbmN1cnJlbmN5S2V5IG9mIGNhbmRpZGF0ZUtleXMpIHtcbiAgICAgIGNvbnN0IHJlcGFpciA9IGluc2lkZVRyYW5zYWN0aW9uXG4gICAgICAgID8gYXdhaXQgdGhpcy5fcmVjb25jaWxlQ29uY3VycmVuY3lLZXkoZGIsIGNvbmN1cnJlbmN5S2V5KVxuICAgICAgICA6IGF3YWl0IHRoaXMuX3RyYW5zYWN0aW9uUmVzdWx0KGRiLCBhc3luYyAoKSA9PiBhd2FpdCB0aGlzLl9yZWNvbmNpbGVDb25jdXJyZW5jeUtleShkYiwgY29uY3VycmVuY3lLZXkpKVxuXG4gICAgICBpZiAoIXJlcGFpcikgY29udGludWVcblxuICAgICAgcmVwYWlyZWRDb3VudCsrXG4gICAgICBpZiAocmVwYWlycy5sZW5ndGggPCBDT05DVVJSRU5DWV9SRVBBSVJfU0FNUExFX0xJTUlUKSByZXBhaXJzLnB1c2gocmVwYWlyKVxuICAgIH1cblxuICAgIHJldHVybiB7XG4gICAgICBjYW5kaWRhdGVDb3VudDogY2FuZGlkYXRlS2V5cy5sZW5ndGgsXG4gICAgICBjaGVja2VkQ291bnQ6IGNvbmN1cnJlbmN5S2V5cy5sZW5ndGgsXG4gICAgICByZXBhaXJlZENvdW50LFxuICAgICAgcmVwYWlycyxcbiAgICAgIHJlcGFpcnNUcnVuY2F0ZWRDb3VudDogcmVwYWlyZWRDb3VudCAtIHJlcGFpcnMubGVuZ3RoXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIFJlYnVpbGRzIG9uZSBjb3VudGVyIGFmdGVyIGxvY2tpbmcgaXQgYWhlYWQgb2YgdGhlIGpvYiByb3dzLCBtYXRjaGluZyB0aGVcbiAgICogbG9jayBvcmRlciB1c2VkIGJ5IGhhbmRvZmYgYW5kIGNvbXBsZXRpb24gdHJhbnNpdGlvbnMuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vZGF0YWJhc2UvZHJpdmVycy9iYXNlLmpzXCIpLmRlZmF1bHR9IGRiIC0gRGF0YWJhc2UgY29ubmVjdGlvbi5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGNvbmN1cnJlbmN5S2V5IC0gQ291bnRlciBrZXkuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPGltcG9ydChcIi4vdHlwZXMuanNcIikuQmFja2dyb3VuZEpvYkNvbmN1cnJlbmN5UmVwYWlyIHwgbnVsbD59IC0gQXBwbGllZCByZXBhaXIuXG4gICAqL1xuICBhc3luYyBfcmVjb25jaWxlQ29uY3VycmVuY3lLZXkoZGIsIGNvbmN1cnJlbmN5S2V5KSB7XG4gICAgYXdhaXQgdGhpcy5fbG9ja0NvbmN1cnJlbmN5Um93KGRiLCBjb25jdXJyZW5jeUtleSlcbiAgICBjb25zdCBwZXJzaXN0ZWRSb3dzID0gYXdhaXQgZGJcbiAgICAgIC5uZXdRdWVyeSgpXG4gICAgICAuZnJvbShDT05DVVJSRU5DWV9UQUJMRSlcbiAgICAgIC5zZWxlY3QoXCJhY3RpdmVfY291bnRcIilcbiAgICAgIC5zZWxlY3QoXCJjb25jdXJyZW5jeV9rZXlcIilcbiAgICAgIC53aGVyZSh7Y29uY3VycmVuY3lfa2V5OiBjb25jdXJyZW5jeUtleX0pXG4gICAgICAubGltaXQoMSlcbiAgICAgIC5yZXN1bHRzKClcblxuICAgIGlmICghcGVyc2lzdGVkUm93c1swXSkgdGhyb3cgbmV3IEVycm9yKGBNaXNzaW5nIGJhY2tncm91bmQgam9iIGNvbmN1cnJlbmN5IGNvdW50ZXIgZm9yICR7Y29uY3VycmVuY3lLZXl9YClcblxuICAgIGNvbnN0IHBlcnNpc3RlZFJvdyA9IC8qKiBAdHlwZSB7QmFja2dyb3VuZEpvYkNvbmN1cnJlbmN5Q291bnRSb3d9ICovIChwZXJzaXN0ZWRSb3dzWzBdKVxuICAgIGNvbnN0IHByZXZpb3VzQWN0aXZlQ291bnQgPSB0aGlzLl92YWxpZGF0ZWRDb25jdXJyZW5jeUNvdW50KHBlcnNpc3RlZFJvdy5hY3RpdmVfY291bnQsIGNvbmN1cnJlbmN5S2V5KVxuICAgIGNvbnN0IHJvd3MgPSBhd2FpdCBkYlxuICAgICAgLm5ld1F1ZXJ5KClcbiAgICAgIC5mcm9tKEpPQlNfVEFCTEUpXG4gICAgICAuc2VsZWN0KFwiQ09VTlQoKikgQVMgYWN0aXZlX2NvdW50XCIpXG4gICAgICAud2hlcmUoe2NvbmN1cnJlbmN5X2tleTogY29uY3VycmVuY3lLZXksIHN0YXR1czogXCJoYW5kZWRfb2ZmXCJ9KVxuICAgICAgLnJlc3VsdHMoKVxuICAgIGNvbnN0IGNvdW50Um93ID0gLyoqIEB0eXBlIHt7YWN0aXZlX2NvdW50OiBudW1iZXIgfCBzdHJpbmd9fSAqLyAocm93c1swXSlcbiAgICBjb25zdCBhY3RpdmVDb3VudCA9IHRoaXMuX3ZhbGlkYXRlZENvbmN1cnJlbmN5Q291bnQoY291bnRSb3cuYWN0aXZlX2NvdW50LCBjb25jdXJyZW5jeUtleSlcblxuICAgIGlmIChhY3RpdmVDb3VudCA9PT0gcHJldmlvdXNBY3RpdmVDb3VudCkgcmV0dXJuIG51bGxcblxuICAgIGF3YWl0IGRiLnVwZGF0ZSh7XG4gICAgICB0YWJsZU5hbWU6IENPTkNVUlJFTkNZX1RBQkxFLFxuICAgICAgZGF0YToge2FjdGl2ZV9jb3VudDogYWN0aXZlQ291bnR9LFxuICAgICAgY29uZGl0aW9uczoge2NvbmN1cnJlbmN5X2tleTogY29uY3VycmVuY3lLZXl9XG4gICAgfSlcblxuICAgIHJldHVybiB7YWN0aXZlQ291bnQsIGNvbmN1cnJlbmN5S2V5LCBwcmV2aW91c0FjdGl2ZUNvdW50fVxuICB9XG5cbiAgLyoqXG4gICAqIFZhbGlkYXRlcyBhIGRhdGFiYXNlIGNvdW50IGJlZm9yZSBpdCBwYXJ0aWNpcGF0ZXMgaW4gcmVjb25jaWxpYXRpb24uXG4gICAqIEBwYXJhbSB7bnVtYmVyIHwgc3RyaW5nfSB2YWx1ZSAtIFJhdyBjb3VudC5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGNvbmN1cnJlbmN5S2V5IC0gQ291bnRlciBrZXkgZm9yIGRpYWdub3N0aWNzLlxuICAgKiBAcmV0dXJucyB7bnVtYmVyfSAtIFNhZmUgbm9uLW5lZ2F0aXZlIGNvdW50LlxuICAgKi9cbiAgX3ZhbGlkYXRlZENvbmN1cnJlbmN5Q291bnQodmFsdWUsIGNvbmN1cnJlbmN5S2V5KSB7XG4gICAgY29uc3QgY291bnQgPSB0aGlzLl9ub3JtYWxpemVOdW1iZXIodmFsdWUpXG5cbiAgICBpZiAoY291bnQgPT09IG51bGwgfHwgIU51bWJlci5pc1NhZmVJbnRlZ2VyKGNvdW50KSB8fCBjb3VudCA8IDApIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihgSW52YWxpZCByZWNvbmNpbGVkIGJhY2tncm91bmQgam9iIGNvbmN1cnJlbmN5IGNvdW50IGZvciAke2NvbmN1cnJlbmN5S2V5fTogJHtjb3VudH1gKVxuICAgIH1cblxuICAgIHJldHVybiBjb3VudFxuICB9XG5cbiAgLyoqXG4gICAqIFJlY29uY2lsZXMgcXVldWUtZGVyaXZlZCBjb25jdXJyZW5jeSB3aXRoIHRoZSBjdXJyZW50IGNvbmZpZ3VyYXRpb24uIE9ubHlcbiAgICogaW52b2tlZCB0aHJvdWdoIHtAbGluayByZWNvbmNpbGVRdWV1ZUNvbmN1cnJlbmN5fSDigJQgdGhlIGV4cGxpY2l0IGxpZmVjeWNsZVxuICAgKiBwYXRoIHJ1biBhdCBtYWluLXByb2Nlc3Mgc3RhcnR1cCB1bmRlciBhIGNyb3NzLXByb2Nlc3MgYWR2aXNvcnkgbG9jayDigJRcbiAgICogbmV2ZXIgZnJvbSBzY2hlbWEvdGVuYW50IGNoZWNrcyBvciByb3V0aW5lIGNvbm5lY3Rpb24gaW5pdGlhbGl6YXRpb24sXG4gICAqIHdoaWNoIHN0YXkgcmVhZC1vbmx5IHJlZ2FyZGluZyBxdWV1ZWQgam9iIHJvd3MuIFRoZSBwZXItcHJvY2VzcyBtZW1vIGlzXG4gICAqIGxhdGNoZWQgYnkge0BsaW5rIHJlY29uY2lsZVF1ZXVlQ29uY3VycmVuY3l9IG9ubHkgYWZ0ZXIgdGhlIGZvbGxvd2luZ1xuICAgKiBjb3VudCByZWJ1aWxkIGFsc28gc3VjY2VlZHMsIHNvIGEgZmFpbGVkIHJlYnVpbGQgcmUtZW50ZXJzIGhlcmUgb24gcmV0cnlcbiAgICogKHRoZSBhZG9wdGlvbiBVUERBVEVzIGJlbG93IGFyZSBpZGVtcG90ZW50KS4gRW5xdWV1ZSBvbmx5IGNvbnN1bHRzIGNvbmZpZyBmb3IgbmV3IGpvYnMsIHNvIGEgY2FwIGFkZGVkLCByZW1vdmVkLCBvciBjaGFuZ2VkXG4gICAqIHdoaWxlIGEgYmFja2xvZyBleGlzdHMgb3RoZXJ3aXNlIGxlYXZlcyBwZXJzaXN0ZWQgcm93cyBzdGFsZTogcHJlLWNhcCBqb2JzXG4gICAqIGtlZXAgYSBudWxsIGtleSBhbmQgYnlwYXNzIHRoZSBjYXAsIHBvc3QtcmVtb3ZhbCBqb2JzIHN0YXkgY2FwcGVkIHVuZGVyIGFcbiAgICogbm93LXVuY29uZmlndXJlZCBrZXksIGFuZCBhIGNoYW5nZWQgbnVtZXJpYyBjYXAgc3RheXMgc3RhbGUgdW50aWwgdGhlIG5leHRcbiAgICogZW5xdWV1ZS4gQnJpbmcgcXVldWVkIGR1cmFibGUgc3RhdGUgaW4gbGluZSB3aXRoIGNvbmZpZzogc3luYyBlYWNoIGNvbmZpZ3VyZWRcbiAgICogcXVldWUncyBzdG9yZWQgY2FwLCBhZG9wdCBub3QteWV0LWtleWVkIHF1ZXVlZCBqb2JzIG9udG8gdGhlaXIgcXVldWUga2V5LFxuICAgKiBhbmQgcmVsZWFzZSBxdWV1ZWQgam9icyBmcm9tIHF1ZXVlIGtleXMgd2hvc2UgcXVldWUgaXMgbm8gbG9uZ2VyIGNhcHBlZC5cbiAgICogRXhpc3RpbmcgaGFuZG9mZnMgcmV0YWluIHRoZSBwb2xpY3kgYW5kIHJlc2VydmF0aW9uIHRoZXkgc3RhcnRlZCB3aXRoLCBzb1xuICAgKiByZWNvbmNpbGlhdGlvbiBjYW5ub3QgcmFjZSB0aGVpciBjb21wbGV0aW9uL3JldHJ5IHRyYW5zaXRpb25zLiBSdW5zIGJlZm9yZVxuICAgKiB7QGxpbmsgX3JlY29uY2lsZUNvbmN1cnJlbmN5fSBzbyBhbnkgcHJlLWV4aXN0aW5nIGFjdGl2ZSBjb3VudHMgYXJlIGV4YWN0LlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL2RhdGFiYXNlL2RyaXZlcnMvYmFzZS5qc1wiKS5kZWZhdWx0fSBkYiAtIERhdGFiYXNlIGNvbm5lY3Rpb24uXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIHdoZW4gcmVjb25jaWxlZC5cbiAgICovXG4gIGFzeW5jIF9yZWNvbmNpbGVRdWV1ZUNvbmN1cnJlbmN5KGRiKSB7XG4gICAgaWYgKHRoaXMuX3F1ZXVlQ29uY3VycmVuY3lSZWNvbmNpbGVkKSByZXR1cm5cbiAgICBpZiAoIShhd2FpdCBkYi50YWJsZUV4aXN0cyhDT05DVVJSRU5DWV9UQUJMRSkpKSByZXR1cm5cblxuICAgIGNvbnN0IHF1ZXVlc0NvbmZpZyA9IHRoaXMuY29uZmlndXJhdGlvbi5nZXRCYWNrZ3JvdW5kSm9ic0NvbmZpZygpLnF1ZXVlcyB8fCB7fVxuICAgIGNvbnN0IGpvYnNUYWJsZSA9IGRiLnF1b3RlVGFibGUoSk9CU19UQUJMRSlcbiAgICBjb25zdCBrZXlDb2x1bW4gPSBkYi5xdW90ZUNvbHVtbihcImNvbmN1cnJlbmN5X2tleVwiKVxuICAgIGNvbnN0IGNhcENvbHVtbiA9IGRiLnF1b3RlQ29sdW1uKFwibWF4X2NvbmN1cnJlbmN5XCIpXG4gICAgY29uc3QgcXVldWVDb2x1bW4gPSBkYi5xdW90ZUNvbHVtbihcInF1ZXVlXCIpXG4gICAgY29uc3QgcXVldWVkID0gYCR7ZGIucXVvdGVDb2x1bW4oXCJzdGF0dXNcIil9ID0gJHtkYi5xdW90ZShcInF1ZXVlZFwiKX1gXG4gICAgLyoqIEB0eXBlIHtTZXQ8c3RyaW5nPn0gKi9cbiAgICBjb25zdCBjYXBwZWRRdWV1ZXMgPSBuZXcgU2V0KClcblxuICAgIGZvciAoY29uc3QgcXVldWUgb2YgT2JqZWN0LmtleXMocXVldWVzQ29uZmlnKSkge1xuICAgICAgY29uc3QgY2FwID0gdGhpcy5fcXVldWVNYXhDb25jdXJyZW5jeShxdWV1ZSlcblxuICAgICAgaWYgKGNhcCA9PT0gbnVsbCkgY29udGludWVcblxuICAgICAgY2FwcGVkUXVldWVzLmFkZChxdWV1ZSlcbiAgICAgIGNvbnN0IGNvbmN1cnJlbmN5S2V5ID0gYCR7UVVFVUVfQ09OQ1VSUkVOQ1lfS0VZX1BSRUZJWH0ke3F1ZXVlfWBcblxuICAgICAgYXdhaXQgdGhpcy5fZW5zdXJlUXVldWVDb25jdXJyZW5jeUtleShkYiwge2NvbmN1cnJlbmN5S2V5LCBtYXhDb25jdXJyZW5jeTogY2FwfSlcbiAgICAgIGF3YWl0IGRiLnF1ZXJ5KFxuICAgICAgICBgVVBEQVRFICR7am9ic1RhYmxlfSBTRVQgJHtrZXlDb2x1bW59ID0gJHtkYi5xdW90ZShjb25jdXJyZW5jeUtleSl9LCAke2NhcENvbHVtbn0gPSAke051bWJlcihjYXApfSBgICtcbiAgICAgICAgYFdIRVJFICR7cXVldWVDb2x1bW59ID0gJHtkYi5xdW90ZShxdWV1ZSl9IEFORCAke2tleUNvbHVtbn0gSVMgTlVMTCBBTkQgJHtxdWV1ZWR9YFxuICAgICAgKVxuICAgIH1cblxuICAgIGNvbnN0IGNvbmN1cnJlbmN5Um93cyA9IGF3YWl0IGRiXG4gICAgICAubmV3UXVlcnkoKVxuICAgICAgLmZyb20oQ09OQ1VSUkVOQ1lfVEFCTEUpXG4gICAgICAuc2VsZWN0KFwiY29uY3VycmVuY3lfa2V5XCIpXG4gICAgICAud2hlcmUoYCR7ZGIucXVvdGVDb2x1bW4oXCJjb25jdXJyZW5jeV9rZXlcIil9IExJS0UgJHtkYi5xdW90ZShgJHtRVUVVRV9DT05DVVJSRU5DWV9LRVlfUFJFRklYfSVgKX1gKVxuICAgICAgLnJlc3VsdHMoKVxuXG4gICAgZm9yIChjb25zdCByb3cgb2YgY29uY3VycmVuY3lSb3dzKSB7XG4gICAgICBjb25zdCBjb25jdXJyZW5jeUtleSA9IFN0cmluZygvKiogQHR5cGUge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gKi8gKHJvdykuY29uY3VycmVuY3lfa2V5KVxuXG4gICAgICBpZiAoIWNvbmN1cnJlbmN5S2V5LnN0YXJ0c1dpdGgoUVVFVUVfQ09OQ1VSUkVOQ1lfS0VZX1BSRUZJWCkpIGNvbnRpbnVlXG4gICAgICBpZiAoY2FwcGVkUXVldWVzLmhhcyhjb25jdXJyZW5jeUtleS5zbGljZShRVUVVRV9DT05DVVJSRU5DWV9LRVlfUFJFRklYLmxlbmd0aCkpKSBjb250aW51ZVxuXG4gICAgICBhd2FpdCBkYi5xdWVyeShcbiAgICAgICAgYFVQREFURSAke2pvYnNUYWJsZX0gU0VUICR7a2V5Q29sdW1ufSA9IE5VTEwsICR7Y2FwQ29sdW1ufSA9IE5VTEwgYCArXG4gICAgICAgIGBXSEVSRSAke2tleUNvbHVtbn0gPSAke2RiLnF1b3RlKGNvbmN1cnJlbmN5S2V5KX0gQU5EICR7cXVldWVkfWBcbiAgICAgIClcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogUnVucyBub3JtYWxpemUgbnVtYmVyLlxuICAgKiBAcGFyYW0ge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSB2YWx1ZSAtIElucHV0IHZhbHVlLlxuICAgKiBAcmV0dXJucyB7bnVtYmVyIHwgbnVsbH0gLSBOb3JtYWxpemVkIG51bWJlci5cbiAgICovXG4gIF9ub3JtYWxpemVOdW1iZXIodmFsdWUpIHtcbiAgICBpZiAodmFsdWUgPT09IG51bGwgfHwgdmFsdWUgPT09IHVuZGVmaW5lZCB8fCB2YWx1ZSA9PT0gXCJcIikgcmV0dXJuIG51bGxcblxuICAgIGNvbnN0IG51bWVyaWMgPSBOdW1iZXIodmFsdWUpXG5cbiAgICBpZiAoTnVtYmVyLmlzTmFOKG51bWVyaWMpKSByZXR1cm4gbnVsbFxuXG4gICAgcmV0dXJuIG51bWVyaWNcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIG5vcm1hbGl6ZSBleGVjdXRpb24gbW9kZS5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL3R5cGVzLmpzXCIpLkJhY2tncm91bmRKb2JPcHRpb25zfSBbb3B0aW9uc10gLSBKb2Igb3B0aW9ucy5cbiAgICogQHJldHVybnMge2ltcG9ydChcIi4vdHlwZXMuanNcIikuQmFja2dyb3VuZEpvYkV4ZWN1dGlvbk1vZGV9IC0gTm9ybWFsaXplZCBleGVjdXRpb24gbW9kZS5cbiAgICovXG4gIF9ub3JtYWxpemVFeGVjdXRpb25Nb2RlKG9wdGlvbnMpIHtcbiAgICByZXR1cm4gbm9ybWFsaXplQmFja2dyb3VuZEpvYkV4ZWN1dGlvbk1vZGUob3B0aW9ucyB8fCB7fSwgREVGQVVMVF9CQUNLR1JPVU5EX0pPQl9FWEVDVVRJT05fTU9ERSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIG5vcm1hbGl6ZSBleGVjdXRpb24gbW9kZSBuYW1lLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gZXhlY3V0aW9uTW9kZSAtIEV4ZWN1dGlvbiBtb2RlIG5hbWUuXG4gICAqIEByZXR1cm5zIHtpbXBvcnQoXCIuL3R5cGVzLmpzXCIpLkJhY2tncm91bmRKb2JFeGVjdXRpb25Nb2RlfSAtIE5vcm1hbGl6ZWQgZXhlY3V0aW9uIG1vZGUuXG4gICAqL1xuICBfbm9ybWFsaXplRXhlY3V0aW9uTW9kZU5hbWUoZXhlY3V0aW9uTW9kZSkge1xuICAgIHJldHVybiBub3JtYWxpemVCYWNrZ3JvdW5kSm9iRXhlY3V0aW9uTW9kZShcbiAgICAgIHtleGVjdXRpb25Nb2RlOiAvKiogQHR5cGUge2ltcG9ydChcIi4vdHlwZXMuanNcIikuQmFja2dyb3VuZEpvYkV4ZWN1dGlvbk1vZGV9ICovIChleGVjdXRpb25Nb2RlKX0sXG4gICAgICBERUZBVUxUX0JBQ0tHUk9VTkRfSk9CX0VYRUNVVElPTl9NT0RFLFxuICAgICAgQkFDS0dST1VORF9KT0JfRVhFQ1VUSU9OX01PREVTXG4gICAgKVxuICB9XG5cbiAgLyoqXG4gICAqIEZpbHRlcnMgcXVldWVkIGpvYnMgYnkgb25lIG9yIG1vcmUgZXhlY3V0aW9uIG1vZGVzIGFnYWluc3QgdGhlXG4gICAqIGBleGVjdXRpb25fbW9kZWAgY29sdW1uICh0aGUgc2luZ2xlIHNvdXJjZSBvZiB0cnV0aCkuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gT3B0aW9ucy5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9kYXRhYmFzZS9kcml2ZXJzL2Jhc2UuanNcIikuZGVmYXVsdH0gYXJncy5kYiAtIERhdGFiYXNlIGNvbm5lY3Rpb24uXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi90eXBlcy5qc1wiKS5CYWNrZ3JvdW5kSm9iRXhlY3V0aW9uTW9kZSB8IGltcG9ydChcIi4vdHlwZXMuanNcIikuQmFja2dyb3VuZEpvYkV4ZWN1dGlvbk1vZGVbXX0gYXJncy5leGVjdXRpb25Nb2RlIC0gUnVudGltZSBtb2Rlcy5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9kYXRhYmFzZS9xdWVyeS9pbmRleC5qc1wiKS5kZWZhdWx0fSBhcmdzLnF1ZXJ5IC0gUXVlcnkgdG8gZmlsdGVyLlxuICAgKiBAcmV0dXJucyB7aW1wb3J0KFwiLi4vZGF0YWJhc2UvcXVlcnkvaW5kZXguanNcIikuZGVmYXVsdH0gLSBGaWx0ZXJlZCBxdWVyeS5cbiAgICovXG4gIF93aGVyZUV4ZWN1dGlvbk1vZGUoe2RiLCBleGVjdXRpb25Nb2RlLCBxdWVyeX0pIHtcbiAgICBjb25zdCBleGVjdXRpb25Nb2RlcyA9IEFycmF5LmlzQXJyYXkoZXhlY3V0aW9uTW9kZSkgPyBleGVjdXRpb25Nb2RlIDogW2V4ZWN1dGlvbk1vZGVdXG4gICAgY29uc3QgZXhlY3V0aW9uTW9kZUNvbHVtbiA9IGRiLnF1b3RlQ29sdW1uKFwiZXhlY3V0aW9uX21vZGVcIilcbiAgICBjb25zdCBjb25kaXRpb25zID0gZXhlY3V0aW9uTW9kZXMubWFwKChtb2RlKSA9PiBgJHtleGVjdXRpb25Nb2RlQ29sdW1ufSA9ICR7ZGIucXVvdGUobW9kZSl9YClcblxuICAgIHJldHVybiBxdWVyeS53aGVyZShgKCR7Y29uZGl0aW9ucy5qb2luKFwiIE9SIFwiKX0pYClcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHBhcnNlIGFyZ3MuXG4gICAqIEBwYXJhbSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59IHZhbHVlIC0gSW5wdXQgdmFsdWUuXG4gICAqIEByZXR1cm5zIHtBcnJheTxSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59IC0gUGFyc2VkIGFyZ3MuXG4gICAqL1xuICBfcGFyc2VBcmdzKHZhbHVlKSB7XG4gICAgaWYgKCF2YWx1ZSkgcmV0dXJuIFtdXG5cbiAgICB0cnkge1xuICAgICAgY29uc3QgcGFyc2VkID0gSlNPTi5wYXJzZShTdHJpbmcodmFsdWUpKVxuXG4gICAgICBpZiAoQXJyYXkuaXNBcnJheShwYXJzZWQpKSByZXR1cm4gcGFyc2VkXG4gICAgfSBjYXRjaCB7XG4gICAgICAvLyBJZ25vcmUgcGFyc2UgZXJyb3JzLlxuICAgIH1cblxuICAgIHJldHVybiBbXVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgd2l0aCBkYi5cbiAgICogQHRlbXBsYXRlIFRcbiAgICogQHBhcmFtIHsoZGI6IGltcG9ydChcIi4uL2RhdGFiYXNlL2RyaXZlcnMvYmFzZS5qc1wiKS5kZWZhdWx0KSA9PiBQcm9taXNlPFQ+fSBjYWxsYmFjayAtIENhbGxiYWNrLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxUPn0gLSBDYWxsYmFjayByZXN1bHQuXG4gICAqL1xuICBhc3luYyBfd2l0aERiKGNhbGxiYWNrKSB7XG4gICAgY29uc3QgZGF0YWJhc2VJZGVudGlmaWVyID0gdGhpcy5nZXREYXRhYmFzZUlkZW50aWZpZXIoKVxuICAgIGNvbnN0IHBvb2wgPSB0aGlzLmNvbmZpZ3VyYXRpb24uZ2V0RGF0YWJhc2VQb29sKGRhdGFiYXNlSWRlbnRpZmllcilcblxuICAgIGlmICghcG9vbC50ZXN0U2hhcmVkQ29ubmVjdGlvbigpKSB7XG4gICAgICByZXR1cm4gYXdhaXQgcG9vbC53aXRoQ29ubmVjdGlvbih7bmFtZTogXCJCYWNrZ3JvdW5kIGpvYnMgc3RvcmVcIn0sIGNhbGxiYWNrKVxuICAgIH1cblxuICAgIHJldHVybiBhd2FpdCB0aGlzLmNvbmZpZ3VyYXRpb24ucnVuV2l0aFRlc3RTaGFyZWRDb25uZWN0aW9uQ29udGV4dHMoYXN5bmMgKCkgPT4ge1xuICAgICAgcmV0dXJuIGF3YWl0IHRoaXMuY29uZmlndXJhdGlvbi5lbnN1cmVDb25uZWN0aW9ucyh7ZGF0YWJhc2VJZGVudGlmaWVyczogW2RhdGFiYXNlSWRlbnRpZmllcl0sIG5hbWU6IFwiQmFja2dyb3VuZCBqb2JzIHN0b3JlXCJ9LCBhc3luYyAoZGJzKSA9PiB7XG4gICAgICAgIGNvbnN0IGNvbm5lY3Rpb24gPSBkYnNbZGF0YWJhc2VJZGVudGlmaWVyXVxuICAgICAgICByZXR1cm4gYXdhaXQgY29vcmRpbmF0ZVNoYXJlZFRyYW5zYWN0aW9uQ29ubmVjdGlvbihjb25uZWN0aW9uLCBhc3luYyAoKSA9PiBhd2FpdCBjYWxsYmFjayhjb25uZWN0aW9uKSlcbiAgICAgIH0pXG4gICAgfSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGEgdmFsdWUtcmV0dXJuaW5nIGNhbGxiYWNrIGluc2lkZSB0aGUgZHJpdmVyJ3Mgdm9pZC10eXBlZCB0cmFuc2FjdGlvbiBBUEkuXG4gICAqIEB0ZW1wbGF0ZSBUXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vZGF0YWJhc2UvZHJpdmVycy9iYXNlLmpzXCIpLmRlZmF1bHR9IGRiIC0gRGF0YWJhc2UgY29ubmVjdGlvbi5cbiAgICogQHBhcmFtIHsoKSA9PiBQcm9taXNlPFQ+fSBjYWxsYmFjayAtIFRyYW5zYWN0aW9uIGNhbGxiYWNrLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxUPn0gLSBDYWxsYmFjayByZXN1bHQuXG4gICAqL1xuICBhc3luYyBfdHJhbnNhY3Rpb25SZXN1bHQoZGIsIGNhbGxiYWNrKSB7XG4gICAgbGV0IGNvbXBsZXRlZCA9IGZhbHNlXG4gICAgLyoqIEB0eXBlIHtUIHwgdW5kZWZpbmVkfSAqL1xuICAgIGxldCByZXN1bHRcbiAgICBhd2FpdCBkYi50cmFuc2FjdGlvbihhc3luYyAoKSA9PiB7XG4gICAgICByZXN1bHQgPSBhd2FpdCBjYWxsYmFjaygpXG4gICAgICBjb21wbGV0ZWQgPSB0cnVlXG4gICAgfSlcbiAgICBpZiAoIWNvbXBsZXRlZCkgdGhyb3cgbmV3IEVycm9yKFwiQmFja2dyb3VuZCBqb2JzIHRyYW5zYWN0aW9uIGNhbGxiYWNrIHdhcyBub3QgaW52b2tlZFwiKVxuICAgIHJldHVybiAvKiogQHR5cGUge1R9ICovIChyZXN1bHQpXG4gIH1cblxuICAvKipcbiAgICogU2VyaWFsaXplcyBjb3VudC1jaGFuZ2luZyB0cmFuc2FjdGlvbnMgYmVmb3JlIGNoZWNraW5nIG91dCB0aGVpciBjb25uZWN0aW9uLlxuICAgKiBEYXRhYmFzZSByb3cgbG9ja2luZyBzdGlsbCBwcm92aWRlcyBjcm9zcy1wcm9jZXNzIG9yZGVyaW5nOyB0aGlzIGd1YXJkXG4gICAqIHByZXZlbnRzIGNvbmN1cnJlbnQgY2FsbGVycyBvbiBTUUxpdGUncyBzaGFyZWQgY29ubmVjdGlvbiBmcm9tIGF0dGVtcHRpbmdcbiAgICogb3ZlcmxhcHBpbmcgdG9wLWxldmVsIHRyYW5zYWN0aW9ucy5cbiAgICogQHRlbXBsYXRlIFRcbiAgICogQHBhcmFtIHsoZGI6IGltcG9ydChcIi4uL2RhdGFiYXNlL2RyaXZlcnMvYmFzZS5qc1wiKS5kZWZhdWx0KSA9PiBQcm9taXNlPFQ+fSBjYWxsYmFjayAtIFRyYW5zYWN0aW9uIGNhbGxiYWNrLlxuICAgKiBAcGFyYW0ge0JhY2tncm91bmRKb2JUcmFuc2FjdGlvblNlcmlhbGl6YXRpb25PcHRpb25zfSBbb3B0aW9uc10gLSBTZXJpYWxpemF0aW9uIG9wdGlvbnMuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPFQ+fSBDYWxsYmFjayByZXN1bHQuXG4gICAqL1xuICBhc3luYyBfc2VyaWFsaXplZENvdW50TXV0YXRpb24oY2FsbGJhY2ssIG9wdGlvbnMgPSB7fSkge1xuICAgIHJldHVybiBhd2FpdCB0aGlzLl9zZXJpYWxpemVkVHJhbnNhY3Rpb25NdXRhdGlvbihhc3luYyAoZGIpID0+IHtcbiAgICAgIGF3YWl0IHRoaXMuX2xvY2tDb3VudFJldmlzaW9uKGRiKVxuXG4gICAgICByZXR1cm4gYXdhaXQgY2FsbGJhY2soZGIpXG4gICAgfSwgb3B0aW9ucylcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGEgc2VyaWFsaXplZCBjYWxsYmFjayBpbnNpZGUgb25lIHRyYW5zYWN0aW9uLlxuICAgKiBAdGVtcGxhdGUgVFxuICAgKiBAcGFyYW0geyhkYjogaW1wb3J0KFwiLi4vZGF0YWJhc2UvZHJpdmVycy9iYXNlLmpzXCIpLmRlZmF1bHQpID0+IFByb21pc2U8VD59IGNhbGxiYWNrIC0gVHJhbnNhY3Rpb24gY2FsbGJhY2suXG4gICAqIEBwYXJhbSB7QmFja2dyb3VuZEpvYlRyYW5zYWN0aW9uU2VyaWFsaXphdGlvbk9wdGlvbnN9IFtvcHRpb25zXSAtIFNlcmlhbGl6YXRpb24gb3B0aW9ucy5cbiAgICogQHJldHVybnMge1Byb21pc2U8VD59IENhbGxiYWNrIHJlc3VsdC5cbiAgICovXG4gIGFzeW5jIF9zZXJpYWxpemVkVHJhbnNhY3Rpb25NdXRhdGlvbihjYWxsYmFjaywgb3B0aW9ucyA9IHt9KSB7XG4gICAgcmV0dXJuIGF3YWl0IHRoaXMuX3NlcmlhbGl6ZWRDb25uZWN0aW9uTXV0YXRpb24oXG4gICAgICBhc3luYyAoZGIpID0+IGF3YWl0IHRoaXMuX3RyYW5zYWN0aW9uUmVzdWx0KGRiLCBhc3luYyAoKSA9PiBhd2FpdCBjYWxsYmFjayhkYikpLFxuICAgICAgb3B0aW9uc1xuICAgIClcbiAgfVxuXG4gIC8qKlxuICAgKiBBZG1pdHMgbXV0YXRpb24gY2FsbGJhY2tzIHRvIHRoZSBwcm9jZXNzLWxvY2FsIEZJRk8gYmVmb3JlIHRoZXkgY2hlY2sgb3V0IGFcbiAgICogY29ubmVjdGlvbi4gQ3Jvc3MtcHJvY2VzcyBvcmRlcmluZyByZW1haW5zIHRoZSByZXNwb25zaWJpbGl0eSBvZiBkdXJhYmxlXG4gICAqIHJvdy9hZHZpc29yeSBsb2NrcyBhbmQgdW5pcXVlIGNvbnN0cmFpbnRzIGFjcXVpcmVkIGFyb3VuZCB0aGUgY2FsbGJhY2suXG4gICAqIEB0ZW1wbGF0ZSBUXG4gICAqIEBwYXJhbSB7KGRiOiBpbXBvcnQoXCIuLi9kYXRhYmFzZS9kcml2ZXJzL2Jhc2UuanNcIikuZGVmYXVsdCkgPT4gUHJvbWlzZTxUPn0gY2FsbGJhY2sgLSBDb25uZWN0aW9uIGNhbGxiYWNrLlxuICAgKiBAcGFyYW0ge0JhY2tncm91bmRKb2JUcmFuc2FjdGlvblNlcmlhbGl6YXRpb25PcHRpb25zfSBbb3B0aW9uc10gLSBTZXJpYWxpemF0aW9uIG9wdGlvbnMuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPFQ+fSBDYWxsYmFjayByZXN1bHQuXG4gICAqL1xuICBhc3luYyBfc2VyaWFsaXplZENvbm5lY3Rpb25NdXRhdGlvbihjYWxsYmFjaywgb3B0aW9ucyA9IHt9KSB7XG4gICAgY29uc3QgaWRlbnRpZmllciA9IHRoaXMuZ2V0RGF0YWJhc2VJZGVudGlmaWVyKCkgfHwgXCJkZWZhdWx0XCJcbiAgICBjb25zdCBwcmV2aW91cyA9IHRyYW5zYWN0aW9uTXV0YXRpb25DaGFpbnMuZ2V0KGlkZW50aWZpZXIpIHx8IFByb21pc2UucmVzb2x2ZSgpXG4gICAgbGV0IHJlc29sdmVSdW4gPSAoKSA9PiB7fVxuICAgIC8qKiBAdHlwZSB7UHJvbWlzZTx2b2lkPn0gKi9cbiAgICBjb25zdCBydW4gPSBuZXcgUHJvbWlzZSgocmVzb2x2ZSkgPT4ge1xuICAgICAgcmVzb2x2ZVJ1biA9ICgpID0+IHJlc29sdmUodW5kZWZpbmVkKVxuICAgIH0pXG4gICAgY29uc3QgY2hhaW4gPSBwcmV2aW91cy50aGVuKCgpID0+IHJ1bilcblxuICAgIHRyYW5zYWN0aW9uTXV0YXRpb25DaGFpbnMuc2V0KGlkZW50aWZpZXIsIGNoYWluKVxuICAgIGF3YWl0IHByZXZpb3VzXG5cbiAgICB0cnkge1xuICAgICAgcmV0dXJuIGF3YWl0IHRoaXMuX3dpdGhEYihhc3luYyAoZGIpID0+IHtcbiAgICAgICAgY29uc3Qge2Fkdmlzb3J5TG9ja30gPSBvcHRpb25zXG5cbiAgICAgICAgaWYgKGFkdmlzb3J5TG9jaykge1xuICAgICAgICAgIGNvbnN0IGFjcXVpcmVkID0gYXdhaXQgZGIuYWNxdWlyZUFkdmlzb3J5TG9jayhhZHZpc29yeUxvY2submFtZSlcblxuICAgICAgICAgIGlmICghYWNxdWlyZWQpIHRocm93IG5ldyBFcnJvcihhZHZpc29yeUxvY2suZmFpbHVyZU1lc3NhZ2UpXG4gICAgICAgIH1cblxuICAgICAgICB0cnkge1xuICAgICAgICAgIHJldHVybiBhd2FpdCBjYWxsYmFjayhkYilcbiAgICAgICAgfSBmaW5hbGx5IHtcbiAgICAgICAgICBpZiAoYWR2aXNvcnlMb2NrKSBhd2FpdCBkYi5yZWxlYXNlQWR2aXNvcnlMb2NrKGFkdmlzb3J5TG9jay5uYW1lKVxuICAgICAgICB9XG4gICAgICB9KVxuICAgIH0gZmluYWxseSB7XG4gICAgICByZXNvbHZlUnVuKClcbiAgICAgIGlmICh0cmFuc2FjdGlvbk11dGF0aW9uQ2hhaW5zLmdldChpZGVudGlmaWVyKSA9PT0gY2hhaW4pIHRyYW5zYWN0aW9uTXV0YXRpb25DaGFpbnMuZGVsZXRlKGlkZW50aWZpZXIpXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgc2hvdWxkIGFjY2VwdCByZXBvcnQuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gT3B0aW9ucy5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL3R5cGVzLmpzXCIpLkJhY2tncm91bmRKb2JSb3d9IGFyZ3Muam9iIC0gSm9iIHJvdy5cbiAgICogQHBhcmFtIHtzdHJpbmcgfCBudWxsIHwgdW5kZWZpbmVkfSBhcmdzLmhhbmRvZmZJZCAtIEhhbmRvZmYgbGVhc2UgaWQgZnJvbSByZXBvcnQuXG4gICAqIEBwYXJhbSB7c3RyaW5nIHwgbnVsbCB8IHVuZGVmaW5lZH0gYXJncy53b3JrZXJJZCAtIFdvcmtlciBpZCBmcm9tIHJlcG9ydC5cbiAgICogQHBhcmFtIHtudW1iZXIgfCBudWxsIHwgdW5kZWZpbmVkfSBhcmdzLmhhbmRlZE9mZkF0TXMgLSBIYW5kZWQgb2ZmIHRpbWVzdGFtcCBmcm9tIHJlcG9ydC5cbiAgICogQHJldHVybnMge2Jvb2xlYW59IC0gV2hldGhlciB0byBhY2NlcHQgdGhlIHJlcG9ydC5cbiAgICovXG4gIF9zaG91bGRBY2NlcHRSZXBvcnQoe2pvYiwgaGFuZG9mZklkLCB3b3JrZXJJZCwgaGFuZGVkT2ZmQXRNc30pIHtcbiAgICBpZiAoam9iLnN0YXR1cyAhPT0gXCJoYW5kZWRfb2ZmXCIpIHJldHVybiBmYWxzZVxuXG4gICAgcmV0dXJuIHRoaXMuX2hhbmRvZmZJZFJlcG9ydE1hdGNoZXMoe2hhbmRvZmZJZCwgam9ifSlcbiAgICAgICYmIHRoaXMuX3dvcmtlclJlcG9ydE1hdGNoZXMoe2pvYiwgd29ya2VySWR9KVxuICAgICAgJiYgdGhpcy5faGFuZG9mZlJlcG9ydE1hdGNoZXMoe2hhbmRlZE9mZkF0TXMsIGpvYn0pXG4gIH1cblxuICAvKipcbiAgICogUnVucyBhY3RpdmUgaGFuZG9mZiBjb25kaXRpb25zLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vdHlwZXMuanNcIikuQmFja2dyb3VuZEpvYlJvd30gam9iIC0gSm9iIHJvdy5cbiAgICogQHJldHVybnMge1JlY29yZDxzdHJpbmcsIHN0cmluZyB8IG51bGw+fSAtIENvbmRpdGlvbmFsIHRyYW5zaXRpb24gZmVuY2UuXG4gICAqL1xuICBfYWN0aXZlSGFuZG9mZkNvbmRpdGlvbnMoam9iKSB7XG4gICAgcmV0dXJuIHtoYW5kb2ZmX2lkOiBqb2IuaGFuZG9mZklkLCBpZDogam9iLmlkLCBzdGF0dXM6IFwiaGFuZGVkX29mZlwifVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgaGFuZG9mZiBpZCByZXBvcnQgbWF0Y2hlcy5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBPcHRpb25zLlxuICAgKiBAcGFyYW0ge3N0cmluZyB8IG51bGwgfCB1bmRlZmluZWR9IGFyZ3MuaGFuZG9mZklkIC0gSGFuZG9mZiBsZWFzZSBpZCBmcm9tIHJlcG9ydC5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL3R5cGVzLmpzXCIpLkJhY2tncm91bmRKb2JSb3d9IGFyZ3Muam9iIC0gSm9iIHJvdy5cbiAgICogQHJldHVybnMge2Jvb2xlYW59IC0gV2hldGhlciB0aGUgaGFuZG9mZiBsZWFzZSBtYXRjaGVzLlxuICAgKi9cbiAgX2hhbmRvZmZJZFJlcG9ydE1hdGNoZXMoe2hhbmRvZmZJZCwgam9ifSkge1xuICAgIGlmICgham9iLmhhbmRvZmZJZCkgcmV0dXJuIHRydWVcblxuICAgIHJldHVybiBoYW5kb2ZmSWQgPT09IGpvYi5oYW5kb2ZmSWRcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHdvcmtlciByZXBvcnQgbWF0Y2hlcy5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBPcHRpb25zLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vdHlwZXMuanNcIikuQmFja2dyb3VuZEpvYlJvd30gYXJncy5qb2IgLSBKb2Igcm93LlxuICAgKiBAcGFyYW0ge3N0cmluZyB8IG51bGwgfCB1bmRlZmluZWR9IGFyZ3Mud29ya2VySWQgLSBXb3JrZXIgaWQgZnJvbSByZXBvcnQuXG4gICAqIEByZXR1cm5zIHtib29sZWFufSAtIFdoZXRoZXIgdGhlIHdvcmtlciByZXBvcnQgbWF0Y2hlcy5cbiAgICovXG4gIF93b3JrZXJSZXBvcnRNYXRjaGVzKHtqb2IsIHdvcmtlcklkfSkge1xuICAgIGlmICghd29ya2VySWQpIHJldHVybiB0cnVlXG4gICAgaWYgKCFqb2Iud29ya2VySWQpIHJldHVybiB0cnVlXG5cbiAgICByZXR1cm4gd29ya2VySWQgPT09IGpvYi53b3JrZXJJZFxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgaGFuZG9mZiByZXBvcnQgbWF0Y2hlcy5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBPcHRpb25zLlxuICAgKiBAcGFyYW0ge251bWJlciB8IG51bGwgfCB1bmRlZmluZWR9IGFyZ3MuaGFuZGVkT2ZmQXRNcyAtIEhhbmRlZCBvZmYgdGltZXN0YW1wIGZyb20gcmVwb3J0LlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vdHlwZXMuanNcIikuQmFja2dyb3VuZEpvYlJvd30gYXJncy5qb2IgLSBKb2Igcm93LlxuICAgKiBAcmV0dXJucyB7Ym9vbGVhbn0gLSBXaGV0aGVyIHRoZSBoYW5kb2ZmIHJlcG9ydCBtYXRjaGVzLlxuICAgKi9cbiAgX2hhbmRvZmZSZXBvcnRNYXRjaGVzKHtoYW5kZWRPZmZBdE1zLCBqb2J9KSB7XG4gICAgaWYgKCFoYW5kZWRPZmZBdE1zKSByZXR1cm4gdHJ1ZVxuICAgIGlmICgham9iLmhhbmRlZE9mZkF0TXMpIHJldHVybiB0cnVlXG5cbiAgICByZXR1cm4gaGFuZGVkT2ZmQXRNcyA9PT0gam9iLmhhbmRlZE9mZkF0TXNcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIG1pZ3JhdGlvbiBrZXkuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBbdmVyc2lvbl0gLSBNaWdyYXRpb24gdmVyc2lvbi5cbiAgICogQHJldHVybnMge3N0cmluZ30gLSBNaWdyYXRpb24ga2V5LlxuICAgKi9cbiAgX21pZ3JhdGlvbktleSh2ZXJzaW9uID0gTUlHUkFUSU9OX1ZFUlNJT04pIHtcbiAgICByZXR1cm4gYCR7TUlHUkFUSU9OX1NDT1BFfToke3ZlcnNpb259YFxuICB9XG59XG4iXX0=