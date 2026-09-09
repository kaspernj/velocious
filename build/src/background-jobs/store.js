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
                    worker_id: workerId || null
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
                    scheduled_at_ms: this.clock.now(),
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoic3RvcmUuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi9zcmMvYmFja2dyb3VuZC1qb2JzL3N0b3JlLmpzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiJBQUFBLFlBQVk7QUFFWixPQUFPLEVBQUMsVUFBVSxFQUFFLFVBQVUsRUFBQyxNQUFNLFFBQVEsQ0FBQTtBQUM3QyxPQUFPLHFCQUFxQixNQUFNLGNBQWMsQ0FBQTtBQUNoRCxPQUFPLE1BQU0sTUFBTSxjQUFjLENBQUE7QUFDakMsT0FBTyxTQUFTLE1BQU0saUNBQWlDLENBQUE7QUFDdkQsT0FBTyxjQUFjLE1BQU0sdUJBQXVCLENBQUE7QUFDbEQsT0FBTyxtQkFBbUIsTUFBTSxpQkFBaUIsQ0FBQTtBQUNqRCxPQUFPLDJCQUEyQixNQUFNLHNCQUFzQixDQUFBO0FBQzlELE9BQU8sRUFBRSxxQ0FBcUMsRUFBRSxNQUFNLHlEQUF5RCxDQUFBO0FBQy9HLE9BQU8sbUJBQW1CLE1BQU0seUJBQXlCLENBQUE7QUFDekQsT0FBTyxFQUNMLDhCQUE4QixFQUM5QixxQ0FBcUMsRUFDckMsNEJBQTRCLEVBQzVCLDRCQUE0QixFQUM1QixpQ0FBaUMsRUFDakMsbUNBQW1DLEVBQ25DLGdDQUFnQyxFQUNoQywyQkFBMkIsRUFDM0IsbUNBQW1DLEVBQ25DLDRCQUE0QixFQUM1QixZQUFZLEVBQ2IsTUFBTSxvQkFBb0IsQ0FBQTtBQUMzQixPQUFPLEVBQ0wsOEJBQThCLEVBQzlCLDJCQUEyQixFQUMzQix3QkFBd0IsRUFDekIsTUFBTSxpQ0FBaUMsQ0FBQTtBQUV4Qzs7Ozs7Ozs7Ozs7OztHQWFHO0FBRUg7Ozs7O0dBS0c7QUFFSDs7OztHQUlHO0FBRUg7Ozs7O0dBS0c7QUFFSDs7Ozs7R0FLRztBQUVILE1BQU0sZ0JBQWdCLEdBQUcsK0JBQStCLENBQUE7QUFDeEQsTUFBTSxlQUFlLEdBQUcsaUJBQWlCLENBQUE7QUFDekMsTUFBTSxpQkFBaUIsR0FBRyxnQkFBZ0IsQ0FBQTtBQUMxQyxNQUFNLCtC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SUFFRDs7Ozs7O09BTUc7SUFDSCxxQkFBcUIsQ0FBQyxFQUFDLGFBQWEsRUFBRSxHQUFHLEVBQUM7UUFDeEMsSUFBSSxDQUFDLGFBQWE7WUFBRSxPQUFPLElBQUksQ0FBQTtRQUMvQixJQUFJLENBQUMsR0FBRyxDQUFDLGFBQWE7WUFBRSxPQUFPLElBQUksQ0FBQTtRQUVuQyxPQUFPLGFBQWEsS0FBSyxHQUFHLENBQUMsYUFBYSxDQUFBO0lBQzVDLENBQUM7SUFFRDs7OztPQUlHO0lBQ0gsYUFBYSxDQUFDLE9BQU8sR0FBRyxpQkFBaUI7UUFDdkMsT0FBTyxHQUFHLGVBQWUsSUFBSSxPQUFPLEVBQUUsQ0FBQTtJQUN4QyxDQUFDO0NBQ0YiLCJzb3VyY2VzQ29udGVudCI6WyIvLyBAdHMtY2hlY2tcblxuaW1wb3J0IHtjcmVhdGVIYXNoLCByYW5kb21VVUlEfSBmcm9tIFwiY3J5cHRvXCJcbmltcG9ydCBCYWNrZ3JvdW5kSm9ic0FkYXB0ZXIgZnJvbSBcIi4vYWRhcHRlci5qc1wiXG5pbXBvcnQgTG9nZ2VyIGZyb20gXCIuLi9sb2dnZXIuanNcIlxuaW1wb3J0IFRhYmxlRGF0YSBmcm9tIFwiLi4vZGF0YWJhc2UvdGFibGUtZGF0YS9pbmRleC5qc1wiXG5pbXBvcnQgVmVsb2Npb3VzRXJyb3IgZnJvbSBcIi4uL3ZlbG9jaW91cy1lcnJvci5qc1wiXG5pbXBvcnQgQmFja2dyb3VuZEpvYlJlY29yZCBmcm9tIFwiLi9qb2ItcmVjb3JkLmpzXCJcbmltcG9ydCBub3JtYWxpemVCYWNrZ3JvdW5kSm9iRXJyb3IgZnJvbSBcIi4vbm9ybWFsaXplLWVycm9yLmpzXCJcbmltcG9ydCB7IGNvb3JkaW5hdGVTaGFyZWRUcmFuc2FjdGlvbkNvbm5lY3Rpb24gfSBmcm9tIFwiLi4vdGVzdGluZy9zaGFyZWQtdHJhbnNhY3Rpb24tY29ubmVjdGlvbi1jb29yZGluYXRvci5qc1wiXG5pbXBvcnQgc3RhYmxlSnNvblN0cmluZ2lmeSBmcm9tIFwiLi4vdXRpbHMvc3RhYmxlLWpzb24uanNcIlxuaW1wb3J0IHtcbiAgQkFDS0dST1VORF9KT0JfRVhFQ1VUSU9OX01PREVTLFxuICBERUZBVUxUX0JBQ0tHUk9VTkRfSk9CX0VYRUNVVElPTl9NT0RFLFxuICBERUZBVUxUX0JBQ0tHUk9VTkRfSk9CX1FVRVVFLFxuICBRVUVVRV9DT05DVVJSRU5DWV9LRVlfUFJFRklYLFxuICBub3JtYWxpemVCYWNrZ3JvdW5kSm9iQ29uY3VycmVuY3ksXG4gIG5vcm1hbGl6ZUJhY2tncm91bmRKb2JFeGVjdXRpb25Nb2RlLFxuICBub3JtYWxpemVCYWNrZ3JvdW5kSm9iTWF4UmV0cmllcyxcbiAgbm9ybWFsaXplQmFja2dyb3VuZEpvYlF1ZXVlLFxuICBub3JtYWxpemVCYWNrZ3JvdW5kSm9iU2NoZWR1bGVkQXRNcyxcbiAgcmVzY2hlZHVsZWRCYWNrZ3JvdW5kSm9iQXRNcyxcbiAgcmV0cnlEZWxheU1zXG59IGZyb20gXCIuL2pvYi1zZW1hbnRpY3MuanNcIlxuaW1wb3J0IHtcbiAgTUFJTF9ERUxJVkVSWV9PUEVSQVRJT05TX1RBQkxFLFxuICBtYWlsRGVsaXZlcnlPcGVyYXRpb25Gb3JKb2IsXG4gIG1haWxEZWxpdmVyeU9wZXJhdGlvbktleVxufSBmcm9tIFwiLi4vbWFpbGVyL2RlbGl2ZXJ5LW9wZXJhdGlvbi5qc1wiXG5cbi8qKlxuICogUHJlcGFyZWRCYWNrZ3JvdW5kSm9iIHR5cGUuXG4gKiBAdHlwZWRlZiB7b2JqZWN0fSBQcmVwYXJlZEJhY2tncm91bmRKb2JcbiAqIEBwcm9wZXJ0eSB7c3RyaW5nfSBhcmdzSnNvbiAtIFNlcmlhbGl6ZWQgYXJndW1lbnRzLlxuICogQHByb3BlcnR5IHt7Y29uY3VycmVuY3lLZXk6IHN0cmluZywgbWF4Q29uY3VycmVuY3k6IG51bWJlciwgcXVldWVEZXJpdmVkOiBib29sZWFufSB8IG51bGx9IGNvbmN1cnJlbmN5IC0gUmVzb2x2ZWQgY29uY3VycmVuY3kuXG4gKiBAcHJvcGVydHkge251bWJlcn0gY3JlYXRlZEF0TXMgLSBDcmVhdGlvbiB0aW1lc3RhbXAuXG4gKiBAcHJvcGVydHkge2ltcG9ydChcIi4vdHlwZXMuanNcIikuQmFja2dyb3VuZEpvYkV4ZWN1dGlvbk1vZGV9IGV4ZWN1dGlvbk1vZGUgLSBFeGVjdXRpb24gbW9kZS5cbiAqIEBwcm9wZXJ0eSB7c3RyaW5nfSBqb2JJZCAtIE5ldyBqb2IgaWQuXG4gKiBAcHJvcGVydHkge3N0cmluZ30gam9iTmFtZSAtIEpvYiBuYW1lLlxuICogQHByb3BlcnR5IHtudW1iZXJ9IG1heFJldHJpZXMgLSBSZXRyeSBjYXAuXG4gKiBAcHJvcGVydHkge3N0cmluZ30gcXVldWUgLSBRdWV1ZSBuYW1lLlxuICogQHByb3BlcnR5IHtudW1iZXJ9IHNjaGVkdWxlZEF0TXMgLSBFbGlnaWJpbGl0eSB0aW1lc3RhbXAuXG4gKiBAcHJvcGVydHkge251bWJlciB8IG51bGx9IHRpbWVvdXRNcyAtIFBlci1qb2IgdGltZW91dCBvdmVycmlkZSwgb3IgbnVsbCB3aGVuIG9taXR0ZWQuXG4gKi9cblxuLyoqXG4gKiBCYWNrZ3JvdW5kSm9iT3JwaGFuU2VsZWN0aW9uIHR5cGUuXG4gKiBAdHlwZWRlZiB7b2JqZWN0fSBCYWNrZ3JvdW5kSm9iT3JwaGFuU2VsZWN0aW9uXG4gKiBAcHJvcGVydHkge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gY29uZGl0aW9ucyAtIEV4YWN0IHVwZGF0ZSBmZW5jZS5cbiAqIEBwcm9wZXJ0eSB7aW1wb3J0KFwiLi90eXBlcy5qc1wiKS5CYWNrZ3JvdW5kSm9iUm93fSBqb2IgLSBTZWxlY3RlZCBhY3RpdmUgaGFuZG9mZi5cbiAqL1xuXG4vKipcbiAqIEJhY2tncm91bmRKb2JUcmFuc2FjdGlvblNlcmlhbGl6YXRpb25PcHRpb25zIHR5cGUuXG4gKiBAdHlwZWRlZiB7b2JqZWN0fSBCYWNrZ3JvdW5kSm9iVHJhbnNhY3Rpb25TZXJpYWxpemF0aW9uT3B0aW9uc1xuICogQHByb3BlcnR5IHt7ZmFpbHVyZU1lc3NhZ2U6IHN0cmluZywgbmFtZTogc3RyaW5nfX0gW2Fkdmlzb3J5TG9ja10gLSBTZXNzaW9uIGxvY2sgaGVsZCBhcm91bmQgdGhlIHRyYW5zYWN0aW9uLlxuICovXG5cbi8qKlxuICogQmFja2dyb3VuZEpvYkNvbmN1cnJlbmN5Q291bnRSb3cgdHlwZS5cbiAqIEB0eXBlZGVmIHtvYmplY3R9IEJhY2tncm91bmRKb2JDb25jdXJyZW5jeUNvdW50Um93XG4gKiBAcHJvcGVydHkge251bWJlciB8IHN0cmluZ30gYWN0aXZlX2NvdW50IC0gUGVyc2lzdGVkIG9yIGFnZ3JlZ2F0ZWQgYWN0aXZlIGNvdW50LlxuICogQHByb3BlcnR5IHtzdHJpbmd9IGNvbmN1cnJlbmN5X2tleSAtIER1cmFibGUgY2FwIGlkZW50aXR5LlxuICovXG5cbi8qKlxuICogQmFja2dyb3VuZEpvYlF1ZXVlZENvbmN1cnJlbmN5IHR5cGUuXG4gKiBAdHlwZWRlZiB7b2JqZWN0fSBCYWNrZ3JvdW5kSm9iUXVldWVkQ29uY3VycmVuY3lcbiAqIEBwcm9wZXJ0eSB7c3RyaW5nIHwgbnVsbH0gY29uY3VycmVuY3lLZXkgLSBDdXJyZW50IGNvbmN1cnJlbmN5IGtleSBmb3IgcXVldWVkIHdvcmsuXG4gKiBAcHJvcGVydHkge251bWJlciB8IG51bGx9IG1heENvbmN1cnJlbmN5IC0gQ3VycmVudCBjb25jdXJyZW5jeSBjYXAgZm9yIHF1ZXVlZCB3b3JrLlxuICovXG5cbmNvbnN0IE1JR1JBVElPTlNfVEFCTEUgPSBcInZlbG9jaW91c19pbnRlcm5hbF9taWdyYXRpb25zXCJcbmNvbnN0IE1JR1JBVElPTl9TQ09QRSA9IFwiYmFja2dyb3VuZF9qb2JzXCJcbmNvbnN0IE1JR1JBVElPTl9WRVJTSU9OID0gXCIyMDI1MDIxNTAwMDAwMFwiXG5jb25zdCBTQ0hFTUFfUkVDT1ZFUllfUEVORElOR19WRVJTSU9OID0gXCJzY2hlbWEtcmVjb3ZlcnktcGVuZGluZ1wiXG5jb25zdCBFWEVDVVRJT05fTU9ERV9CQUNLRklMTF9NSUdSQVRJT05fVkVSU0lPTiA9IFwiMjAyNjA2MDcxMzEwMTBcIlxuLy8gRHJvcHMgdGhlIHJlZHVuZGFudCBsZWdhY3kgYGZvcmtlZGAgYm9vbGVhbiBjb2x1bW4gYW5kIHJld3JpdGVzIHBvb2xlZCByb3dzIHRvXG4vLyBwZXJzaXN0IGBleGVjdXRpb25fbW9kZSA9IFwicG9vbGVkXCJgIGRpcmVjdGx5IChyZXRpcmluZyB0aGUgcG9vbGVkLWFzLWZvcmtlZFxuLy8gaGFuZG9mZi1tYXJrZXIgd29ya2Fyb3VuZCksIGxlYXZpbmcgYGV4ZWN1dGlvbl9tb2RlYCBhcyB0aGUgc2luZ2xlIHNvdXJjZSBvZlxuLy8gdHJ1dGggZm9yIGEgam9iJ3MgcnVudGltZS5cbmNvbnN0IERST1BfRk9SS0VEX0NPTFVNTl9NSUdSQVRJT05fVkVSU0lPTiA9IFwiMjAyNjA3MTkwMDAwMDBcIlxuY29uc3QgSk9CU19JTkRFWF9SRVBBSVJfTUlHUkFUSU9OX1ZFUlNJT04gPSBcIjIwMjYwOTAzMTIwMDAwXCJcbi8vIExlZ2FjeSBtYXJrZXIgcHJlZml4IHVzZWQgYnkgcm93cyB3cml0dGVuIGJlZm9yZSB0aGlzIG1pZ3JhdGlvbjogcG9vbGVkIGpvYnNcbi8vIHVzZWQgdG8gcGVyc2lzdCBhcyBgZXhlY3V0aW9uX21vZGUgPSBcImZvcmtlZFwiYCBwbHVzIGEgYHZlbG9jaW91cy1wb29sZWQ6KmBcbi8vIGhhbmRvZmYgaWQuIFJldGFpbmVkIG9ubHkgdG8gZGV0ZWN0IGFuZCBjb252ZXJ0IHRob3NlIHJvd3MgaW4gdGhlIG1pZ3JhdGlvbi5cbmNvbnN0IExFR0FDWV9QT09MRURfSEFORE9GRl9JRF9QUkVGSVggPSBcInZlbG9jaW91cy1wb29sZWQ6XCJcbmNvbnN0IExFR0FDWV9QT09MRURfUVVFVUVEX0hBTkRPRkZfSUQgPSBgJHtMRUdBQ1lfUE9PTEVEX0hBTkRPRkZfSURfUFJFRklYfXF1ZXVlZGBcbmNvbnN0IEpPQlNfVEFCTEUgPSBcImJhY2tncm91bmRfam9ic1wiXG5jb25zdCBKT0JTX0lOREVYX0NPTFVNTl9OQU1FUyA9IFtcbiAgXCJqb2JfbmFtZVwiLFxuICBcInF1ZXVlXCIsXG4gIFwic3RhdHVzXCIsXG4gIFwic2NoZWR1bGVkX2F0X21zXCIsXG4gIFwiY3JlYXRlZF9hdF9tc1wiLFxuICBcInNjaGVkdWxlX2tleVwiLFxuICBcImhhbmRlZF9vZmZfYXRfbXNcIixcbiAgXCJvcnBoYW5lZF9hdF9tc1wiLFxuICBcImNvbmN1cnJlbmN5X2tleVwiXG5dXG5jb25zdCBJREVNUE9URU5DWV9LRVlTX1RBQkxFID0gXCJiYWNrZ3JvdW5kX2pvYl9pZGVtcG90ZW5jeV9rZXlzXCJcbmNvbnN0IFNDSEVEVUxFX0tFWVNfVEFCTEUgPSBcImJhY2tncm91bmRfam9iX3NjaGVkdWxlX2tleXNcIlxuY29uc3QgQ09OQ1VSUkVOQ1lfVEFCTEUgPSBcImJhY2tncm91bmRfam9iX2NvbmN1cnJlbmN5XCJcbmNvbnN0IENPVU5UU19SRVZJU0lPTl9UQUJMRSA9IFwiYmFja2dyb3VuZF9qb2JfY291bnRfcmV2aXNpb25zXCJcbmNvbnN0IENPVU5UU19SRVZJU0lPTl9LRVkgPSBcImNvdW50c1wiXG5jb25zdCBDT05DVVJSRU5DWV9SRUNPTkNJTElBVElPTl9MT0NLID0gXCJiYWNrZ3JvdW5kLWpvYnM6cXVldWUtY29uY3VycmVuY3ktcmVjb25jaWxlXCJcbmNvbnN0IENPTkNVUlJFTkNZX1JFUEFJUl9TQU1QTEVfTElNSVQgPSAxMFxuZXhwb3J0IGNvbnN0IEJBQ0tHUk9VTkRfSk9CX0NPVU5UU19DSEFOTkVMID0gXCJ2ZWxvY2lvdXMtYmFja2dyb3VuZC1qb2ItY291bnRzXCJcbmV4cG9ydCBjb25zdCBCQUNLR1JPVU5EX0pPQl9DT1VOVF9CVUNLRVRTID0gW1wiYWxsXCIsIFwicXVldWVkXCIsIFwiaGFuZGVkX29mZlwiLCBcImNvbXBsZXRlZFwiLCBcImZhaWxlZFwiLCBcIm9ycGhhbmVkXCJdXG5jb25zdCBDT1VOVEVEX0pPQl9TVEFUVVNFUyA9IEJBQ0tHUk9VTkRfSk9CX0NPVU5UX0JVQ0tFVFMuc2xpY2UoMSlcbmNvbnN0IE1BWF9KT0JfVElNRU9VVF9NUyA9IDJfMTQ3XzQ4M182NDdcbmNvbnN0IEpPQl9USU1FT1VUX1ZBTElEQVRJT05fTUVTU0FHRSA9IGBiYWNrZ3JvdW5kIGpvYiB0aW1lb3V0TXMgbXVzdCBiZSBhIGZpbml0ZSBub24tcG9zaXRpdmUgbnVtYmVyIG9yIGFuIGludGVnZXIgYmV0d2VlbiAxIGFuZCAke01BWF9KT0JfVElNRU9VVF9NU31gXG5jb25zdCBPUlBIQU5FRF9BRlRFUl9NUyA9IDIgKiA2MCAqIDYwICogMTAwMFxuXG4vKipcbiAqIENvbHVtbnMgdGhlIGRhc2hib2FyZCBpcyBhbGxvd2VkIHRvIHNvcnQgam9iIGxpc3RpbmdzIGJ5LCBtYXBwZWQgdG8gdGhlaXJcbiAqIGRhdGFiYXNlIGNvbHVtbiBuYW1lcy4gUmVzdHJpY3RpbmcgdG8gdGhpcyBzZXQga2VlcHMgdGhlIHNvcnQgcGFyYW1ldGVyXG4gKiAod2hpY2ggb3JpZ2luYXRlcyBmcm9tIHVudHJ1c3RlZCBxdWVyeSBzdHJpbmdzKSBmcm9tIHJlYWNoaW5nIHJhdyBTUUwuXG4gKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgc3RyaW5nPn1cbiAqL1xuY29uc3QgU09SVEFCTEVfQ09MVU1OUyA9IHtcbiAgYXR0ZW1wdHM6IFwiYXR0ZW1wdHNcIixcbiAgY29tcGxldGVkQXRNczogXCJjb21wbGV0ZWRfYXRfbXNcIixcbiAgY3JlYXRlZEF0TXM6IFwiY3JlYXRlZF9hdF9tc1wiLFxuICBmYWlsZWRBdE1zOiBcImZhaWxlZF9hdF9tc1wiLFxuICBoYW5kZWRPZmZBdE1zOiBcImhhbmRlZF9vZmZfYXRfbXNcIixcbiAgc2NoZWR1bGVkQXRNczogXCJzY2hlZHVsZWRfYXRfbXNcIlxufVxuXG4vKipcbiAqIFNlcmlhbGl6ZXMgY29uY3VycmVudCBgX2FwcGx5U2NoZW1hYCBydW5zIHdpdGhpbiBUSElTIHByb2Nlc3MsIGtleWVkIGJ5IGRhdGFiYXNlXG4gKiBpZGVudGlmaWVyLCBiZWZvcmUgY2FsbGVycyB3aXRob3V0IGFuIGV4aXN0aW5nIGNvbm5lY3Rpb24gY2hlY2sgb25lIG91dC4gVHdvXG4gKiBzdG9yZXMgdGhhdCBzaGFyZSBvbmUgY29ubmVjdGlvbiAoU2luZ2xlTXVsdGlVc2UgLyBTUUxpdGUpXG4gKiBvdGhlcndpc2UgaW50ZXJsZWF2ZSB0aGUgbXVsdGktc3RlcCB0YWJsZSByZWJ1aWxkIGFuZCBjb3JydXB0IGl0ICh0aGUgam9icyB0YWJsZVxuICogaXMgbGVmdCBhcyBpdHMgYCpfdmVsb2Npb3VzX3JlYnVpbGRgIHRlbXApLiBBIERCIGFkdmlzb3J5IGxvY2sgY2FuJ3QgZml4IHRoYXQ6IG9uXG4gKiBhIHNlc3Npb24tc2NvcGVkIC8gcmUtZW50cmFudCBkcml2ZXIgKE15U1FMIGBHRVRfTE9DS2ApIGEgc2Vjb25kIGFjcXVpcmUgb24gdGhlXG4gKiBzYW1lIHNlc3Npb24gc3VjY2VlZHMgaW1tZWRpYXRlbHkgc28gYm90aCBjYWxsZXJzIHByb2NlZWQsIGFuZCB0YWtpbmcgaXQgb24gYVxuICogc2VwYXJhdGUgY29ubmVjdGlvbiBibG9ja3MgY3Jvc3Mtc2Vzc2lvbiBmb3JldmVyLiBBbiBpbi1wcm9jZXNzIHByb21pc2UtY2hhaW5cbiAqIG11dGV4IHNlcmlhbGl6ZXMgc2FtZS1wcm9jZXNzIGNhbGxlcnMgd2l0aCBuZWl0aGVyIGhhemFyZC4gQ3Jvc3MtcHJvY2VzcyBzY2hlbWFcbiAqIHJhY2VzIHN0YXkgY292ZXJlZCBieSB0aGUgcGVyLXN0ZXAgYWR2aXNvcnkgbG9ja3MgKyByZWNoZWNrcyBpbnNpZGUgdGhlIHN0ZXBzLlxuICogQHR5cGUge01hcDxzdHJpbmcsIFByb21pc2U8dm9pZD4+fVxuICovXG5jb25zdCBzY2hlbWFBcHBseUNoYWlucyA9IG5ldyBNYXAoKVxuLyoqIEB0eXBlIHtNYXA8c3RyaW5nLCBQcm9taXNlPHZvaWQ+Pn0gKi9cbmNvbnN0IHRyYW5zYWN0aW9uTXV0YXRpb25DaGFpbnMgPSBuZXcgTWFwKClcblxuZXhwb3J0IGRlZmF1bHQgY2xhc3MgQmFja2dyb3VuZEpvYnNTdG9yZSBleHRlbmRzIEJhY2tncm91bmRKb2JzQWRhcHRlciB7XG4gIC8qKlxuICAgKiBSdW5zIGNvbnN0cnVjdG9yLlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIE9wdGlvbnMuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vY29uZmlndXJhdGlvbi5qc1wiKS5kZWZhdWx0fSBhcmdzLmNvbmZpZ3VyYXRpb24gLSBDb25maWd1cmF0aW9uLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gW2FyZ3MuZGF0YWJhc2VJZGVudGlmaWVyXSAtIERhdGFiYXNlIGlkZW50aWZpZXIuXG4gICAqIEBwYXJhbSB7e25vdzogKCkgPT4gbnVtYmVyfX0gW2FyZ3MuY2xvY2tdIC0gSW5qZWN0YWJsZSBwZXJzaXN0ZW5jZSBjbG9jay5cbiAgICogQHBhcmFtIHsocHJvZHVjZXJQcm9vZjogaW1wb3J0KFwiLi90eXBlcy5qc1wiKS5CYWNrZ3JvdW5kSm9iUHJvZHVjZXJQcm9vZikgPT4gdm9pZCB8IFByb21pc2U8dm9pZD59IFthcmdzLmFmdGVyT3duZWRQcm9kdWNlclZhbGlkYXRpb25dIC0gRXhhY3Qgb3duZWQtZW5xdWV1ZSB2YWxpZGF0aW9uIGhvb2suXG4gICAqL1xuICBjb25zdHJ1Y3Rvcih7Y29uZmlndXJhdGlvbiwgZGF0YWJhc2VJZGVudGlmaWVyLCBjbG9jaywgYWZ0ZXJPd25lZFByb2R1Y2VyVmFsaWRhdGlvbn0pIHtcbiAgICBzdXBlcigpXG4gICAgdGhpcy5jb25maWd1cmF0aW9uID0gY29uZmlndXJhdGlvblxuICAgIHRoaXMuZGF0YWJhc2VJZGVudGlmaWVyID0gZGF0YWJhc2VJZGVudGlmaWVyXG4gICAgdGhpcy5jbG9jayA9IGNsb2NrIHx8IHtub3c6ICgpID0+IERhdGUubm93KCl9XG4gICAgdGhpcy5hZnRlck93bmVkUHJvZHVjZXJWYWxpZGF0aW9uID0gYWZ0ZXJPd25lZFByb2R1Y2VyVmFsaWRhdGlvblxuICAgIHRoaXMubG9nZ2VyID0gbmV3IExvZ2dlcih0aGlzKVxuICAgIHRoaXMuX3JlYWR5UHJvbWlzZSA9IG51bGxcbiAgICB0aGlzLl9xdWV1ZUNvbmN1cnJlbmN5UmVjb25jaWxlZCA9IGZhbHNlXG4gIH1cblxuICAvKipcbiAgICogUnVucyBnZXQgZGF0YWJhc2UgaWRlbnRpZmllci5cbiAgICogQHJldHVybnMge3N0cmluZ30gLSBEYXRhYmFzZSBpZGVudGlmaWVyLlxuICAgKi9cbiAgZ2V0RGF0YWJhc2VJZGVudGlmaWVyKCkge1xuICAgIGlmICh0aGlzLmRhdGFiYXNlSWRlbnRpZmllcikgcmV0dXJuIHRoaXMuZGF0YWJhc2VJZGVudGlmaWVyXG5cbiAgICByZXR1cm4gdGhpcy5jb25maWd1cmF0aW9uLmdldEJhY2tncm91bmRKb2JzQ29uZmlnKCkuZGF0YWJhc2VJZGVudGlmaWVyXG4gIH1cblxuICAvKipcbiAgICogUnVucyBlbnN1cmUgcmVhZHkuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIHdoZW4gcmVhZHkuXG4gICAqL1xuICBhc3luYyBlbnN1cmVSZWFkeSgpIHtcbiAgICBpZiAodGhpcy5fcmVhZHlQcm9taXNlKSByZXR1cm4gYXdhaXQgdGhpcy5fcmVhZHlQcm9taXNlXG5cbiAgICB0aGlzLl9yZWFkeVByb21pc2UgPSAoYXN5bmMgKCkgPT4ge1xuICAgICAgdGhpcy5jb25maWd1cmF0aW9uLnNldEN1cnJlbnQoKVxuICAgICAgYXdhaXQgdGhpcy5fZW5zdXJlU2NoZW1hKClcbiAgICAgIGF3YWl0IHRoaXMuX2luaXRpYWxpemVNb2RlbCgpXG4gICAgfSkoKVxuXG4gICAgdHJ5IHtcbiAgICAgIGF3YWl0IHRoaXMuX3JlYWR5UHJvbWlzZVxuICAgIH0gZmluYWxseSB7XG4gICAgICB0aGlzLl9yZWFkeVByb21pc2UgPSBudWxsXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIEVuc3VyZXMgdGhlIGJhY2tncm91bmQtam9icyBzY2hlbWEgKHRhYmxlcyArIGNvbHVtbnMpIGV4aXN0cyBvbiB0aGUgY29uZmlndXJlZFxuICAgKiBkYXRhYmFzZSwgd2l0aG91dCBpbml0aWFsaXppbmcgdGhlIHJ1bnRpbWUgbW9kZWwuIExldHMgYGRiOm1pZ3JhdGVgIGNyZWF0ZSB0aGVcbiAgICogZnJhbWV3b3JrJ3Mgb3duIHNjaGVtYSBkZXRlcm1pbmlzdGljYWxseSBhbG9uZ3NpZGUgYXBwIG1pZ3JhdGlvbnMg4oCUIGFuZCBjYXB0dXJlXG4gICAqIGl0IGluIHRoZSBkdW1wZWQgc3RydWN0dXJlIFNRTCDigJQgaW5zdGVhZCBvZiBpdCBvbmx5IGFwcGVhcmluZyBvbmNlIGEgc3RvcmUgYm9vdHMuXG4gICAqIElkZW1wb3RlbnQ6IHJldXNlcyB0aGUgc2FtZSBgX2Vuc3VyZVNjaGVtYWAgdGhlIHJ1bnRpbWUgc3RvcmUgdXNlcywgd2hpY2ggc2tpcHNcbiAgICogd29yayBhbHJlYWR5IGFwcGxpZWQgKHRyYWNrZWQgaW4gYHZlbG9jaW91c19pbnRlcm5hbF9taWdyYXRpb25zYCkuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vZGF0YWJhc2UvZHJpdmVycy9iYXNlLmpzXCIpLmRlZmF1bHR9IFtkYl0gLSBSZXVzZSBhbiBhbHJlYWR5XG4gICAqICAgY2hlY2tlZC1vdXQgY29ubmVjdGlvbiAoZS5nLiB0aGUgb25lIGBkYjptaWdyYXRlYCBob2xkcykgcmF0aGVyIHRoYW4gb3BlbmluZyBhXG4gICAqICAgbmVzdGVkIGNoZWNrb3V0IHRoYXQgd291bGQgZGVhZGxvY2sgYSBzaW5nbGUtY29ubmVjdGlvbiBwb29sLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyB3aGVuIHRoZSBzY2hlbWEgaXMgcHJlc2VudC5cbiAgICovXG4gIGFzeW5jIGVuc3VyZVNjaGVtYShkYikge1xuICAgIC8vIFdoZW4gYSBjb25uZWN0aW9uIGlzIGhhbmRlZCBpbiAodGhlIGRiOm1pZ3JhdGUgcGF0aCksIHRoZSBjYWxsZXIgYWxyZWFkeSBvd25zXG4gICAgLy8gdGhlIGFjdGl2ZSBjb25maWd1cmF0aW9uICsgY29ubmVjdGlvbiBjb250ZXh0OyBjYWxsaW5nIHNldEN1cnJlbnQoKSBoZXJlIHdvdWxkXG4gICAgLy8gY2xvYmJlciBpdCAoZS5nLiB0aGUgYnJvd3NlciB0ZXN0IHJ1bm5lciBqdWdnbGVzIG11bHRpcGxlIGNvbmZpZ3VyYXRpb25zKS5cbiAgICBpZiAoIWRiKSB0aGlzLmNvbmZpZ3VyYXRpb24uc2V0Q3VycmVudCgpXG5cbiAgICBhd2FpdCB0aGlzLl9lbnN1cmVTY2hlbWEoZGIpXG4gIH1cblxuICAvKipcbiAgICogUmVjb25jaWxlcyBxdWV1ZS1kZXJpdmVkIGNvbmN1cnJlbmN5IHdpdGggdGhlIGN1cnJlbnQgY29uZmlndXJhdGlvbjogdGhlXG4gICAqIGV4cGxpY2l0IGxpZmVjeWNsZSBwYXRoIHRoYXQgYWRvcHRzL3JlbGVhc2VzIHBlcnNpc3RlZCBxdWV1ZWQgam9icyBvbnRvXG4gICAqIHF1ZXVlIGNvbmN1cnJlbmN5IGtleXMgd2hlbiBgcXVldWVzW25hbWVdLm1heENvbmN1cnJlbnRgIGlzIGFkZGVkLCByZW1vdmVkLFxuICAgKiBvciBjaGFuZ2VkLiBDYWxsZWQgYnkgdGhlIGJhY2tncm91bmQtam9icyBtYWluIHByb2Nlc3Mgb24gc3RhcnR1cCDigJQgdGhlXG4gICAqIGRlcGxveS10aW1lIG1vbWVudCBxdWV1ZSBjb25maWd1cmF0aW9uIGNoYW5nZXMgdGFrZSBlZmZlY3QuIFNjaGVtYS90ZW5hbnRcbiAgICogY2hlY2tzIGFuZCByb3V0aW5lIGNvbm5lY3Rpb24gaW5pdGlhbGl6YXRpb24gZGVsaWJlcmF0ZWx5IG5ldmVyIHJ1biB0aGlzOlxuICAgKiB0aGV5IHN0YXkgcmVhZC1vbmx5IHJlZ2FyZGluZyBxdWV1ZWQgam9iIHJvd3MsIGJlY2F1c2UgdGhlIGJyb2FkXG4gICAqIGFkb3B0aW9uL3JlbGVhc2UgVVBEQVRFcyBkZWFkbG9jayBhZ2FpbnN0IGFjdGl2ZSBqb2IgcHJvY2Vzc2VzIHVuZGVyXG4gICAqIGNvbmN1cnJlbnQgdGVuYW50IGluaXRpYWxpemF0aW9uLiBTZXJpYWxpemVkIGFjcm9zcyBwcm9jZXNzZXMgd2l0aCBhXG4gICAqIGRhdGFiYXNlIGFkdmlzb3J5IGxvY2sgc28gY29uY3VycmVudGx5IHN0YXJ0ZWQgbWFpbnMgY2Fubm90IGludGVybGVhdmUgdGhlXG4gICAqIFVQREFURXM7IHRoZSBwZXItaW5zdGFuY2UgbWVtbyBvbmx5IHNraXBzIHJlcGVhdCB3b3JrIHdpdGhpbiB0aGlzIHByb2Nlc3MuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIHdoZW4gcmVjb25jaWxlZC5cbiAgICovXG4gIGFzeW5jIHJlY29uY2lsZVF1ZXVlQ29uY3VycmVuY3koKSB7XG4gICAgaWYgKHRoaXMuX3F1ZXVlQ29uY3VycmVuY3lSZWNvbmNpbGVkKSByZXR1cm5cblxuICAgIGNvbnN0IGRhdGFiYXNlSWRlbnRpZmllciA9IHRoaXMuZ2V0RGF0YWJhc2VJZGVudGlmaWVyKClcbiAgICBjb25zdCBzdGFydGVkQXRNcyA9IERhdGUubm93KClcblxuICAgIGF3YWl0IHRoaXMubG9nZ2VyLmluZm8oKCkgPT4gW1xuICAgICAgXCJTdGFydGluZyBiYWNrZ3JvdW5kIGpvYnMgcXVldWUtY29uY3VycmVuY3kgc3RhcnR1cCByZWNvbmNpbGlhdGlvblwiLFxuICAgICAge2RhdGFiYXNlSWRlbnRpZmllcn1cbiAgICBdKVxuICAgIGF3YWl0IHRoaXMuZW5zdXJlUmVhZHkoKVxuXG4gICAgYXdhaXQgdGhpcy5fd2l0aERiKGFzeW5jIChkYikgPT4ge1xuICAgICAgY29uc3QgYWNxdWlyZWQgPSBhd2FpdCBkYi5hY3F1aXJlQWR2aXNvcnlMb2NrKENPTkNVUlJFTkNZX1JFQ09OQ0lMSUFUSU9OX0xPQ0spXG5cbiAgICAgIGlmICghYWNxdWlyZWQpIHRocm93IG5ldyBFcnJvcihcIkZhaWxlZCB0byBhY3F1aXJlIGJhY2tncm91bmQgam9iIHF1ZXVlLWNvbmN1cnJlbmN5IHJlY29uY2lsZSBsb2NrXCIpXG5cbiAgICAgIHRyeSB7XG4gICAgICAgIGF3YWl0IHRoaXMuX3JlY29uY2lsZVF1ZXVlQ29uY3VycmVuY3koZGIpXG4gICAgICAgIGF3YWl0IHRoaXMuX3JlY29uY2lsZUNvbmN1cnJlbmN5KGRiKVxuXG4gICAgICAgIC8vIExhdGNoIHRoZSBtZW1vIG9ubHkgYWZ0ZXIgQk9USCBzdGVwcyBzdWNjZWVkOiBpZiB0aGUgY291bnQgcmVidWlsZFxuICAgICAgICAvLyBmYWlscyBhZnRlciBhZG9wdGlvbiwgYSByZXRyeSBvbiB0aGlzIHN0b3JlIG11c3QgcmUtZW50ZXIgYW5kIHJlcGFpclxuICAgICAgICAvLyB0aGUgY291bnRzIChhZG9wdGlvbiBpdHNlbGYgaXMgaWRlbXBvdGVudCkuXG4gICAgICAgIHRoaXMuX3F1ZXVlQ29uY3VycmVuY3lSZWNvbmNpbGVkID0gdHJ1ZVxuICAgICAgfSBmaW5hbGx5IHtcbiAgICAgICAgYXdhaXQgZGIucmVsZWFzZUFkdmlzb3J5TG9jayhDT05DVVJSRU5DWV9SRUNPTkNJTElBVElPTl9MT0NLKVxuICAgICAgfVxuICAgIH0pXG5cbiAgICBhd2FpdCB0aGlzLmxvZ2dlci5pbmZvKCgpID0+IFtcbiAgICAgIFwiQ29tcGxldGVkIGJhY2tncm91bmQgam9icyBxdWV1ZS1jb25jdXJyZW5jeSBzdGFydHVwIHJlY29uY2lsaWF0aW9uXCIsXG4gICAgICB7ZGF0YWJhc2VJZGVudGlmaWVyLCBkdXJhdGlvbk1zOiBEYXRlLm5vdygpIC0gc3RhcnRlZEF0TXN9XG4gICAgXSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSZXBhaXJzIGR1cmFibGUgYWN0aXZlLWNvdW50IGRyaWZ0IHdoaWxlIGEgbWFpbiBwcm9jZXNzIHJlbWFpbnMgbGl2ZS4gVGhlXG4gICAqIGluaXRpYWwgc25hcHNob3QgaXMgcmVhZC1vbmx5OyBvbmx5IHN1c3BlY3RlZCBtaXNtYXRjaGVzIHRha2UgdGhlaXJcbiAgICogY291bnRlciBsb2NrIGFuZCByZS1jb3VudCBpbnNpZGUgdGhlIHNlcmlhbGl6ZWQgdHJhbnNhY3Rpb24gcGF0aC5cbiAgICogQHJldHVybnMge1Byb21pc2U8aW1wb3J0KFwiLi90eXBlcy5qc1wiKS5CYWNrZ3JvdW5kSm9iQ29uY3VycmVuY3lSZWNvbmNpbGlhdGlvbj59IC0gUmVwYWlyIHN1bW1hcnkuXG4gICAqL1xuICBhc3luYyByZWNvbmNpbGVBY3RpdmVDb25jdXJyZW5jeSgpIHtcbiAgICBjb25zdCBkYXRhYmFzZUlkZW50aWZpZXIgPSB0aGlzLmdldERhdGFiYXNlSWRlbnRpZmllcigpXG4gICAgY29uc3Qgc3RhcnRlZEF0TXMgPSBEYXRlLm5vdygpXG5cbiAgICBhd2FpdCB0aGlzLmVuc3VyZVJlYWR5KClcblxuICAgIGNvbnN0IHJlc3VsdCA9IGF3YWl0IHRoaXMuX3NlcmlhbGl6ZWRDb25uZWN0aW9uTXV0YXRpb24oXG4gICAgICBhc3luYyAoZGIpID0+IGF3YWl0IHRoaXMuX3JlY29uY2lsZUNvbmN1cnJlbmN5KGRiKSxcbiAgICAgIHtcbiAgICAgICAgYWR2aXNvcnlMb2NrOiB7XG4gICAgICAgICAgZmFpbHVyZU1lc3NhZ2U6IFwiRmFpbGVkIHRvIGFjcXVpcmUgYmFja2dyb3VuZCBqb2IgYWN0aXZlLWNvbmN1cnJlbmN5IHJlY29uY2lsZSBsb2NrXCIsXG4gICAgICAgICAgbmFtZTogQ09OQ1VSUkVOQ1lfUkVDT05DSUxJQVRJT05fTE9DS1xuICAgICAgICB9XG4gICAgICB9XG4gICAgKVxuXG4gICAgaWYgKHJlc3VsdC5yZXBhaXJlZENvdW50ID4gMCkge1xuICAgICAgYXdhaXQgdGhpcy5sb2dnZXIud2FybigoKSA9PiBbXG4gICAgICAgIFwiUmVwYWlyZWQgYmFja2dyb3VuZCBqb2JzIGFjdGl2ZS1jb25jdXJyZW5jeSBjb3VudCBkcmlmdFwiLFxuICAgICAgICB7XG4gICAgICAgICAgZGF0YWJhc2VJZGVudGlmaWVyLFxuICAgICAgICAgIGR1cmF0aW9uTXM6IERhdGUubm93KCkgLSBzdGFydGVkQXRNcyxcbiAgICAgICAgICByZXBhaXJlZENvdW50OiByZXN1bHQucmVwYWlyZWRDb3VudCxcbiAgICAgICAgICByZXBhaXJzOiByZXN1bHQucmVwYWlycyxcbiAgICAgICAgICByZXBhaXJzVHJ1bmNhdGVkQ291bnQ6IHJlc3VsdC5yZXBhaXJzVHJ1bmNhdGVkQ291bnRcbiAgICAgICAgfVxuICAgICAgXSlcbiAgICB9XG5cbiAgICByZXR1cm4gcmVzdWx0XG4gIH1cblxuICAvKipcbiAgICogUnVucyBlbnF1ZXVlLlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIE9wdGlvbnMuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBhcmdzLmpvYk5hbWUgLSBKb2IgbmFtZS5cbiAgICogQHBhcmFtIHtBcnJheTxSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59IGFyZ3MuYXJncyAtIEFyZ3VtZW50cy5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL3R5cGVzLmpzXCIpLkJhY2tncm91bmRKb2JPcHRpb25zfSBbYXJncy5vcHRpb25zXSAtIE9wdGlvbnMuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHN0cmluZz59IC0gSm9iIGlkLlxuICAgKi9cbiAgYXN5bmMgZW5xdWV1ZSh7am9iTmFtZSwgYXJncywgb3B0aW9uc30pIHtcbiAgICBhd2FpdCB0aGlzLmVuc3VyZVJlYWR5KClcblxuICAgIGNvbnN0IHByZXBhcmVkSm9iID0gdGhpcy5fcHJlcGFyZUpvYih7am9iTmFtZSwgYXJncywgb3B0aW9uc30pXG5cbiAgICBpZiAob3B0aW9ucz8uaWRlbXBvdGVuY3lLZXkgIT09IHVuZGVmaW5lZCkge1xuICAgICAgcmV0dXJuIGF3YWl0IHRoaXMuX2VucXVldWVJZGVtcG90ZW50bHkoe2FyZ3M6IGFyZ3MgfHwgW10sIG9wdGlvbnMsIHByZXBhcmVkSm9ifSlcbiAgICB9XG5cbiAgICAvKiogQHR5cGUge3N0cmluZ30gKi9cbiAgICBsZXQgcmVzdWx0Sm9iSWQgPSBwcmVwYXJlZEpvYi5qb2JJZFxuXG4gICAgYXdhaXQgdGhpcy5fc2VyaWFsaXplZENvdW50TXV0YXRpb24oYXN5bmMgKGRiKSA9PiB7XG4gICAgICBpZiAob3B0aW9ucz8uZGVkdXBsaWNhdGVXaGlsZVF1ZXVlZCkge1xuICAgICAgICBjb25zdCBkdXBsaWNhdGVKb2JJZCA9IGF3YWl0IHRoaXMuX2RlZHVwbGljYXRlZFF1ZXVlZEpvYklkKGRiLCBwcmVwYXJlZEpvYilcblxuICAgICAgICBpZiAoZHVwbGljYXRlSm9iSWQpIHtcbiAgICAgICAgICByZXN1bHRKb2JJZCA9IGR1cGxpY2F0ZUpvYklkXG4gICAgICAgICAgcmV0dXJuXG4gICAgICAgIH1cbiAgICAgIH1cblxuICAgICAgYXdhaXQgdGhpcy5faW5zZXJ0UHJlcGFyZWRKb2IoZGIsIHtwcmVwYXJlZEpvYiwgc2NoZWR1bGVLZXk6IG51bGx9KVxuICAgICAgYXdhaXQgdGhpcy5fcmVjb3JkQ291bnREZWx0YShkYiwge2FsbDogMSwgcXVldWVkOiAxfSlcbiAgICB9KVxuXG4gICAgcmV0dXJuIHJlc3VsdEpvYklkXG4gIH1cblxuICAvKipcbiAgICogQXRvbWljYWxseSB2YWxpZGF0ZXMgYW4gZXhhY3QgcHJvZHVjaW5nIGhhbmRvZmYgYW5kIGVucXVldWVzIGl0cyBmb2xsb3ctdXAuXG4gICAqIEV2ZXJ5IGV4YWN0IHJlcXVlc3Qgb3ducyBhbiBpbnRlcm5hbCBkdXJhYmxlIHJlcGxheSBpZGVudGl0eSwgd2hpbGUgcXVldWVkXG4gICAqIGRlZHVwbGljYXRpb24gY2FuIHBvaW50IHNldmVyYWwgZGlzdGluY3QgcHJvZHVjZXIgZXZlbnRzIGF0IG9uZSBjb3ZlcmluZyByb3cuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gT3duZWQgZW5xdWV1ZSByZXF1ZXN0LlxuICAgKiBAcGFyYW0ge3N0cmluZ30gYXJncy5qb2JOYW1lIC0gSm9iIG5hbWUuXG4gICAqIEBwYXJhbSB7QXJyYXk8UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSBhcmdzLmFyZ3MgLSBBcmd1bWVudHMuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi90eXBlcy5qc1wiKS5CYWNrZ3JvdW5kSm9iT3B0aW9uc30gW2FyZ3Mub3B0aW9uc10gLSBPcHRpb25zLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gW2FyZ3MucHJvZHVjZXJJbnZvY2F0aW9uSWRdIC0gU3RhYmxlIGlkZW50aXR5IGZvciBvbmUgb3duZWQgZW5xdWV1ZSBpbnZvY2F0aW9uLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vdHlwZXMuanNcIikuQmFja2dyb3VuZEpvYlByb2R1Y2VyUHJvb2Z9IGFyZ3MucHJvZHVjZXJQcm9vZiAtIEV4YWN0IHByb2R1Y2VyIGxlYXNlLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxzdHJpbmc+fSAtIER1cmFibGUgZm9sbG93LXVwIGlkLlxuICAgKi9cbiAgYXN5bmMgZW5xdWV1ZUZyb21Pd25lZEhhbmRvZmYoe2pvYk5hbWUsIGFyZ3MsIG9wdGlvbnMsIHByb2R1Y2VySW52b2NhdGlvbklkLCBwcm9kdWNlclByb29mfSkge1xuICAgIGF3YWl0IHRoaXMuZW5zdXJlUmVhZHkoKVxuXG4gICAgY29uc3Qgbm9ybWFsaXplZFByb2R1Y2VyUHJvb2YgPSB0aGlzLl9ub3JtYWxpemVQcm9kdWNlclByb29mKHByb2R1Y2VyUHJvb2YpXG4gICAgY29uc3Qgbm9ybWFsaXplZFByb2R1Y2VySW52b2NhdGlvbklkID0gdGhpcy5fbm9ybWFsaXplUHJvZHVjZXJJbnZvY2F0aW9uSWQocHJvZHVjZXJJbnZvY2F0aW9uSWQpXG4gICAgY29uc3QgcHJlcGFyZWRKb2IgPSB0aGlzLl9wcmVwYXJlSm9iKHtqb2JOYW1lLCBhcmdzLCBvcHRpb25zfSlcblxuICAgIHJldHVybiBhd2FpdCB0aGlzLl9zZXJpYWxpemVkQ291bnRNdXRhdGlvbihhc3luYyAoZGIpID0+IHtcbiAgICAgIGF3YWl0IHRoaXMuX3ZhbGlkYXRlT3duZWRQcm9kdWNlclByb29mKGRiLCBub3JtYWxpemVkUHJvZHVjZXJQcm9vZilcbiAgICAgIGlmICh0aGlzLmFmdGVyT3duZWRQcm9kdWNlclZhbGlkYXRpb24pIGF3YWl0IHRoaXMuYWZ0ZXJPd25lZFByb2R1Y2VyVmFsaWRhdGlvbihub3JtYWxpemVkUHJvZHVjZXJQcm9vZilcblxuICAgICAgaWYgKG9wdGlvbnM/LmlkZW1wb3RlbmN5S2V5ICE9PSB1bmRlZmluZWQpIHtcbiAgICAgICAgcmV0dXJuIGF3YWl0IHRoaXMuX2VucXVldWVJZGVtcG90ZW50bHlJblRyYW5zYWN0aW9uKHtcbiAgICAgICAgICBhcmdzOiBhcmdzIHx8IFtdLFxuICAgICAgICAgIGNvdW50UmV2aXNpb25Mb2NrZWQ6IHRydWUsXG4gICAgICAgICAgZGIsXG4gICAgICAgICAgb3B0aW9ucyxcbiAgICAgICAgICBwcmVwYXJlZEpvYlxuICAgICAgICB9KVxuICAgICAgfVxuXG4gICAgICByZXR1cm4gYXdhaXQgdGhpcy5fZW5xdWV1ZU93bmVkUmVwbGF5SW5UcmFuc2FjdGlvbih7XG4gICAgICAgIGRiLFxuICAgICAgICBvcHRpb25zOiBvcHRpb25zIHx8IHt9LFxuICAgICAgICBwcmVwYXJlZEpvYixcbiAgICAgICAgcHJvZHVjZXJJbnZvY2F0aW9uSWQ6IG5vcm1hbGl6ZWRQcm9kdWNlckludm9jYXRpb25JZCxcbiAgICAgICAgcHJvZHVjZXJQcm9vZjogbm9ybWFsaXplZFByb2R1Y2VyUHJvb2ZcbiAgICAgIH0pXG4gICAgfSlcbiAgfVxuXG4gIC8qKlxuICAgKiBGaW5kcyB0aGUgZWFybGllc3QgcXVldWVkIGpvYiB0aGF0IGNvdmVycyB0aGlzIGVucXVldWUncyBpZGVudGl0eSBhbmQgdGltZS5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9kYXRhYmFzZS9kcml2ZXJzL2Jhc2UuanNcIikuZGVmYXVsdH0gZGIgLSBUcmFuc2FjdGlvbiBjb25uZWN0aW9uLlxuICAgKiBAcGFyYW0ge1ByZXBhcmVkQmFja2dyb3VuZEpvYn0gcHJlcGFyZWRKb2IgLSBOb3JtYWxpemVkIGpvYi5cbiAgICogQHJldHVybnMge1Byb21pc2U8c3RyaW5nIHwgbnVsbD59IC0gQ292ZXJpbmcgam9iIGlkLlxuICAgKi9cbiAgYXN5bmMgX2RlZHVwbGljYXRlZFF1ZXVlZEpvYklkKGRiLCBwcmVwYXJlZEpvYikge1xuICAgIC8vIERlZHVwZSBvbiB0aGUgam9iJ3MgaWRlbnRpdHkgKG5hbWUgKyBhcmdzICsgcXVldWUpLCBOT1QgaXRzIGNvbmN1cnJlbmN5IGtleSwgc28gYSBqb2JcbiAgICAvLyBrZWVwcyB3aGF0ZXZlciBjb25jdXJyZW5jeSBpdCByZXNvbHZlcyB0by4gT25seSBhbiBleGlzdGluZyBqb2Igc2NoZWR1bGVkIG5vIGxhdGVyIHRoYW5cbiAgICAvLyB0aGlzIGVucXVldWUgY2FuIGNvdmVyIGl0OyBhIHJldHJ5IGJhY2tlZCBvZmYgaW50byB0aGUgZnV0dXJlIG11c3Qgbm90IHN1cHByZXNzIGVhcmxpZXJcbiAgICAvLyB3b3JrLiBPcmRlcmluZyByZXR1cm5zIHRoZSBlYXJsaWVzdCBjb3ZlcmluZyBqb2Igd2hlbiBzZXZlcmFsIHF1ZXVlZCByb3dzIGFscmVhZHkgZXhpc3QuXG4gICAgY29uc3QgZXhpc3RpbmcgPSBhd2FpdCBkYlxuICAgICAgLm5ld1F1ZXJ5KClcbiAgICAgIC5mcm9tKEpPQlNfVEFCTEUpXG4gICAgICAuc2VsZWN0KFwiaWRcIilcbiAgICAgIC53aGVyZSh7c3RhdHVzOiBcInF1ZXVlZFwiLCBqb2JfbmFtZTogcHJlcGFyZWRKb2Iuam9iTmFtZSwgYXJnc19qc29uOiBwcmVwYXJlZEpvYi5hcmdzSnNvbiwgcXVldWU6IHByZXBhcmVkSm9iLnF1ZXVlfSlcbiAgICAgIC53aGVyZShgc2NoZWR1bGVkX2F0X21zIDw9ICR7ZGIucXVvdGUocHJlcGFyZWRKb2Iuc2NoZWR1bGVkQXRNcyl9YClcbiAgICAgIC5vcmRlcihcInNjaGVkdWxlZF9hdF9tcyBBU0NcIilcbiAgICAgIC5saW1pdCgxKVxuICAgICAgLnJlc3VsdHMoKVxuICAgIGNvbnN0IHJvdyA9IGV4aXN0aW5nWzBdXG5cbiAgICByZXR1cm4gcm93ID8gU3RyaW5nKC8qKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSAqLyAocm93KS5pZCkgOiBudWxsXG4gIH1cblxuICAvKipcbiAgICogUGVyc2lzdHMgb25lIGludGVybmFsIGV4YWN0LXJlcGxheSBvd25lciBhbmQgaXRzIHF1ZXVlZCBqb2IgaW4gdGhlIGNhbGxlcidzXG4gICAqIHByb2R1Y2VyLXZhbGlkYXRpb24gdHJhbnNhY3Rpb24uXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gVHJhbnNhY3Rpb24gaW5wdXQuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vZGF0YWJhc2UvZHJpdmVycy9iYXNlLmpzXCIpLmRlZmF1bHR9IGFyZ3MuZGIgLSBUcmFuc2FjdGlvbiBjb25uZWN0aW9uLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vdHlwZXMuanNcIikuQmFja2dyb3VuZEpvYk9wdGlvbnN9IGFyZ3Mub3B0aW9ucyAtIEVucXVldWUgb3B0aW9ucy5cbiAgICogQHBhcmFtIHtQcmVwYXJlZEJhY2tncm91bmRKb2J9IGFyZ3MucHJlcGFyZWRKb2IgLSBOb3JtYWxpemVkIGpvYi5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGFyZ3MucHJvZHVjZXJJbnZvY2F0aW9uSWQgLSBTdGFibGUgaWRlbnRpdHkgZm9yIG9uZSBvd25lZCBlbnF1ZXVlIGludm9jYXRpb24uXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi90eXBlcy5qc1wiKS5CYWNrZ3JvdW5kSm9iUHJvZHVjZXJQcm9vZn0gYXJncy5wcm9kdWNlclByb29mIC0gRXhhY3QgcHJvZHVjZXIgbGVhc2UuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHN0cmluZz59IC0gU3RhYmxlIHJlcGxheSBqb2IgaWQuXG4gICAqL1xuICBhc3luYyBfZW5xdWV1ZU93bmVkUmVwbGF5SW5UcmFuc2FjdGlvbih7ZGIsIG9wdGlvbnMsIHByZXBhcmVkSm9iLCBwcm9kdWNlckludm9jYXRpb25JZCwgcHJvZHVjZXJQcm9vZn0pIHtcbiAgICBjb25zdCByZXF1ZXN0RGlnZXN0ID0gdGhpcy5fb3duZWRFbnF1ZXVlUmVxdWVzdERpZ2VzdCh7b3B0aW9ucywgcHJlcGFyZWRKb2J9KVxuICAgIGNvbnN0IHNjb3BlRGlnZXN0ID0gdGhpcy5fb3duZWRFbnF1ZXVlU2NvcGVEaWdlc3Qoe3ByZXBhcmVkSm9iLCBwcm9kdWNlckludm9jYXRpb25JZCwgcHJvZHVjZXJQcm9vZiwgcmVxdWVzdERpZ2VzdH0pXG4gICAgY29uc3QgaWRlbXBvdGVuY3lLZXkgPSBgb3duZWQtaGFuZG9mZjoke3Njb3BlRGlnZXN0fWBcbiAgICBjb25zdCBleGlzdGluZyA9IGF3YWl0IHRoaXMuX2lkZW1wb3RlbmN5T3duZXJzaGlwKGRiLCBzY29wZURpZ2VzdClcbiAgICBjb25zdCBiYXNlT3duZXJzaGlwID0ge1xuICAgICAgY3JlYXRlZF9hdF9tczogcHJlcGFyZWRKb2IuY3JlYXRlZEF0TXMsXG4gICAgICBpZGVtcG90ZW5jeV9rZXk6IGlkZW1wb3RlbmN5S2V5LFxuICAgICAgam9iX25hbWU6IHByZXBhcmVkSm9iLmpvYk5hbWUsXG4gICAgICBxdWV1ZTogcHJlcGFyZWRKb2IucXVldWUsXG4gICAgICByZXF1ZXN0X2RpZ2VzdDogcmVxdWVzdERpZ2VzdCxcbiAgICAgIHNjb3BlX2RpZ2VzdDogc2NvcGVEaWdlc3RcbiAgICB9XG5cbiAgICBpZiAoZXhpc3RpbmcpIHtcbiAgICAgIHRoaXMuX3ZhbGlkYXRlSWRlbXBvdGVuY3lPd25lcnNoaXAoe2V4aXN0aW5nLCBvd25lcnNoaXA6IHsuLi5iYXNlT3duZXJzaGlwLCBqb2JfaWQ6IFN0cmluZyhleGlzdGluZy5qb2JfaWQpfX0pXG4gICAgICByZXR1cm4gU3RyaW5nKGV4aXN0aW5nLmpvYl9pZClcbiAgICB9XG5cbiAgICBjb25zdCBkdXBsaWNhdGVKb2JJZCA9IG9wdGlvbnMuZGVkdXBsaWNhdGVXaGlsZVF1ZXVlZFxuICAgICAgPyBhd2FpdCB0aGlzLl9kZWR1cGxpY2F0ZWRRdWV1ZWRKb2JJZChkYiwgcHJlcGFyZWRKb2IpXG4gICAgICA6IG51bGxcbiAgICBjb25zdCBvd25lcnNoaXAgPSB7Li4uYmFzZU93bmVyc2hpcCwgam9iX2lkOiBkdXBsaWNhdGVKb2JJZCB8fCBwcmVwYXJlZEpvYi5qb2JJZH1cbiAgICBjb25zdCBjbGFpbWVkID0gYXdhaXQgdGhpcy5fY2xhaW1JZGVtcG90ZW5jeU93bmVyc2hpcChkYiwgb3duZXJzaGlwKVxuXG4gICAgaWYgKCFjbGFpbWVkLmNyZWF0ZWQpIHtcbiAgICAgIHRoaXMuX3ZhbGlkYXRlSWRlbXBvdGVuY3lPd25lcnNoaXAoe2V4aXN0aW5nOiBjbGFpbWVkLnJvdywgb3duZXJzaGlwfSlcbiAgICAgIHJldHVybiBTdHJpbmcoY2xhaW1lZC5yb3cuam9iX2lkKVxuICAgIH1cbiAgICBpZiAoZHVwbGljYXRlSm9iSWQpIHJldHVybiBkdXBsaWNhdGVKb2JJZFxuXG4gICAgYXdhaXQgdGhpcy5faW5zZXJ0UHJlcGFyZWRKb2IoZGIsIHtwcmVwYXJlZEpvYiwgc2NoZWR1bGVLZXk6IG51bGx9KVxuICAgIGF3YWl0IHRoaXMuX3JlY29yZENvdW50RGVsdGEoZGIsIHthbGw6IDEsIHF1ZXVlZDogMX0pXG5cbiAgICByZXR1cm4gcHJlcGFyZWRKb2Iuam9iSWRcbiAgfVxuXG4gIC8qKlxuICAgKiBBdG9taWNhbGx5IG93bnMgb25lIGR1cmFibGUgaWRlbXBvdGVuY3kgc2NvcGUgYW5kIGNyZWF0ZXMgaXRzIGpvYiBleGFjdGx5IG9uY2UuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gRW5xdWV1ZSBpbnB1dC5cbiAgICogQHBhcmFtIHtBcnJheTxSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59IGFyZ3MuYXJncyAtIEpvYiBhcmd1bWVudHMuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi90eXBlcy5qc1wiKS5CYWNrZ3JvdW5kSm9iT3B0aW9uc30gYXJncy5vcHRpb25zIC0gSm9iIG9wdGlvbnMuXG4gICAqIEBwYXJhbSB7UHJlcGFyZWRCYWNrZ3JvdW5kSm9ifSBhcmdzLnByZXBhcmVkSm9iIC0gTm9ybWFsaXplZCBqb2IuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHN0cmluZz59IC0gU3RhYmxlIG9yaWdpbmFsIGpvYiBpZC5cbiAgICovXG4gIGFzeW5jIF9lbnF1ZXVlSWRlbXBvdGVudGx5KHthcmdzLCBvcHRpb25zLCBwcmVwYXJlZEpvYn0pIHtcbiAgICAvLyBSZXVzZSBvcmRpbmFyeSBlbnF1ZXVlIHRyYW5zYWN0aW9uIGFkbWlzc2lvbiBiZWNhdXNlIHRoaXMgcGF0aCBjaGFuZ2VzXG4gICAgLy8gdGhlIHNhbWUgZHVyYWJsZSBjb3VudCByZXZpc2lvbi4gVGhlIHNjb3BlIHByaW1hcnkga2V5IHJlbWFpbnMgdGhlXG4gICAgLy8gY3Jvc3MtcHJvY2VzcyBjb252ZXJnZW5jZSBvd25lci5cbiAgICByZXR1cm4gYXdhaXQgdGhpcy5faWRlbXBvdGVudEVucXVldWVUcmFuc2FjdGlvbihhc3luYyAoZGIpID0+IHtcbiAgICAgIHJldHVybiBhd2FpdCB0aGlzLl9lbnF1ZXVlSWRlbXBvdGVudGx5SW5UcmFuc2FjdGlvbih7YXJncywgZGIsIG9wdGlvbnMsIHByZXBhcmVkSm9ifSlcbiAgICB9KVxuICB9XG5cbiAgLyoqXG4gICAqIE93bnMgb3IgcmVwbGF5cyBvbmUgcHVibGljIGlkZW1wb3RlbmN5IGtleSBpbnNpZGUgdGhlIGNhbGxlcidzIHRyYW5zYWN0aW9uLlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIFRyYW5zYWN0aW9uIGlucHV0LlxuICAgKiBAcGFyYW0ge0FycmF5PFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gYXJncy5hcmdzIC0gSm9iIGFyZ3VtZW50cy5cbiAgICogQHBhcmFtIHtib29sZWFufSBbYXJncy5jb3VudFJldmlzaW9uTG9ja2VkXSAtIFdoZXRoZXIgdGhlIGNhbGxlciBhbHJlYWR5IG93bnMgY291bnQgc2VyaWFsaXphdGlvbi5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9kYXRhYmFzZS9kcml2ZXJzL2Jhc2UuanNcIikuZGVmYXVsdH0gYXJncy5kYiAtIFRyYW5zYWN0aW9uIGNvbm5lY3Rpb24uXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi90eXBlcy5qc1wiKS5CYWNrZ3JvdW5kSm9iT3B0aW9uc30gYXJncy5vcHRpb25zIC0gSm9iIG9wdGlvbnMuXG4gICAqIEBwYXJhbSB7UHJlcGFyZWRCYWNrZ3JvdW5kSm9ifSBhcmdzLnByZXBhcmVkSm9iIC0gTm9ybWFsaXplZCBqb2IuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHN0cmluZz59IC0gU3RhYmxlIG9yaWdpbmFsIGpvYiBpZC5cbiAgICovXG4gIGFzeW5jIF9lbnF1ZXVlSWRlbXBvdGVudGx5SW5UcmFuc2FjdGlvbih7YXJncywgY291bnRSZXZpc2lvbkxvY2tlZCA9IGZhbHNlLCBkYiwgb3B0aW9ucywgcHJlcGFyZWRKb2J9KSB7XG4gICAgY29uc3QgaWRlbXBvdGVuY3lLZXkgPSB0aGlzLl9ub3JtYWxpemVJZGVtcG90ZW5jeUtleShvcHRpb25zLmlkZW1wb3RlbmN5S2V5KVxuICAgIGNvbnN0IHNjb3BlRGlnZXN0ID0gdGhpcy5faWRlbXBvdGVuY3lTY29wZURpZ2VzdCh7aWRlbXBvdGVuY3lLZXksIGpvYk5hbWU6IHByZXBhcmVkSm9iLmpvYk5hbWUsIHF1ZXVlOiBwcmVwYXJlZEpvYi5xdWV1ZX0pXG4gICAgY29uc3QgcmVxdWVzdERpZ2VzdCA9IHRoaXMuX2lkZW1wb3RlbmN5UmVxdWVzdERpZ2VzdCh7YXJncywgb3B0aW9ucywgcHJlcGFyZWRKb2J9KVxuICAgIGNvbnN0IG93bmVyc2hpcCA9IHtcbiAgICAgIGNyZWF0ZWRfYXRfbXM6IHByZXBhcmVkSm9iLmNyZWF0ZWRBdE1zLFxuICAgICAgaWRlbXBvdGVuY3lfa2V5OiBpZGVtcG90ZW5jeUtleSxcbiAgICAgIGpvYl9pZDogcHJlcGFyZWRKb2Iuam9iSWQsXG4gICAgICBqb2JfbmFtZTogcHJlcGFyZWRKb2Iuam9iTmFtZSxcbiAgICAgIHF1ZXVlOiBwcmVwYXJlZEpvYi5xdWV1ZSxcbiAgICAgIHJlcXVlc3RfZGlnZXN0OiByZXF1ZXN0RGlnZXN0LFxuICAgICAgc2NvcGVfZGlnZXN0OiBzY29wZURpZ2VzdFxuICAgIH1cbiAgICBjb25zdCBtYWlsT3BlcmF0aW9uSW5wdXQgPSBtYWlsRGVsaXZlcnlPcGVyYXRpb25Gb3JKb2IocHJlcGFyZWRKb2Iuam9iTmFtZSwgYXJncylcblxuICAgIGlmIChtYWlsT3BlcmF0aW9uSW5wdXQgJiYgbWFpbE9wZXJhdGlvbklucHV0Lm9wZXJhdGlvbi5pZCAhPT0gaWRlbXBvdGVuY3lLZXkpIHtcbiAgICAgIHRocm93IFZlbG9jaW91c0Vycm9yLnNhZmUoXCJNYWlsIGRlbGl2ZXJ5IG9wZXJhdGlvbiBpZCBtdXN0IGVxdWFsIGl0cyBiYWNrZ3JvdW5kIGpvYiBpZGVtcG90ZW5jeSBrZXkuXCIsIHtcbiAgICAgICAgY29kZTogXCJtYWlsLWRlbGl2ZXJ5LWlkZW1wb3RlbmN5LWtleS1taXNtYXRjaFwiXG4gICAgICB9KVxuICAgIH1cblxuICAgIGNvbnN0IGV4aXN0aW5nID0gYXdhaXQgdGhpcy5faWRlbXBvdGVuY3lPd25lcnNoaXAoZGIsIHNjb3BlRGlnZXN0KVxuXG4gICAgaWYgKGV4aXN0aW5nKSB7XG4gICAgICB0aGlzLl92YWxpZGF0ZUlkZW1wb3RlbmN5T3duZXJzaGlwKHtleGlzdGluZywgb3duZXJzaGlwfSlcbiAgICAgIGF3YWl0IHRoaXMuX3ZhbGlkYXRlTWFpbERlbGl2ZXJ5T3BlcmF0aW9uKGRiLCB7am9iSWQ6IFN0cmluZyhleGlzdGluZy5qb2JfaWQpLCBtYWlsT3BlcmF0aW9uSW5wdXR9KVxuICAgICAgcmV0dXJuIFN0cmluZyhleGlzdGluZy5qb2JfaWQpXG4gICAgfVxuXG4gICAgY29uc3QgY2xhaW1lZCA9IGF3YWl0IHRoaXMuX2NsYWltSWRlbXBvdGVuY3lPd25lcnNoaXAoZGIsIG93bmVyc2hpcClcblxuICAgIGlmICghY2xhaW1lZC5jcmVhdGVkKSB7XG4gICAgICB0aGlzLl92YWxpZGF0ZUlkZW1wb3RlbmN5T3duZXJzaGlwKHtleGlzdGluZzogY2xhaW1lZC5yb3csIG93bmVyc2hpcH0pXG4gICAgICBhd2FpdCB0aGlzLl92YWxpZGF0ZU1haWxEZWxpdmVyeU9wZXJhdGlvbihkYiwge2pvYklkOiBTdHJpbmcoY2xhaW1lZC5yb3cuam9iX2lkKSwgbWFpbE9wZXJhdGlvbklucHV0fSlcbiAgICAgIHJldHVybiBTdHJpbmcoY2xhaW1lZC5yb3cuam9iX2lkKVxuICAgIH1cblxuICAgIGlmICghY291bnRSZXZpc2lvbkxvY2tlZCkgYXdhaXQgdGhpcy5fbG9ja0NvdW50UmV2aXNpb24oZGIpXG4gICAgYXdhaXQgdGhpcy5faW5zZXJ0UHJlcGFyZWRKb2IoZGIsIHtwcmVwYXJlZEpvYiwgc2NoZWR1bGVLZXk6IG51bGx9KVxuICAgIGF3YWl0IHRoaXMuX3BlcnNpc3RNYWlsRGVsaXZlcnlPcGVyYXRpb24oZGIsIHtqb2JJZDogcHJlcGFyZWRKb2Iuam9iSWQsIG1haWxPcGVyYXRpb25JbnB1dCwgY3JlYXRlZEF0TXM6IHByZXBhcmVkSm9iLmNyZWF0ZWRBdE1zfSlcbiAgICBhd2FpdCB0aGlzLl9yZWNvcmRDb3VudERlbHRhKGRiLCB7YWxsOiAxLCBxdWV1ZWQ6IDF9KVxuXG4gICAgcmV0dXJuIHByZXBhcmVkSm9iLmpvYklkXG4gIH1cblxuICAvKipcbiAgICogU2VyaWFsaXplcyBvbmUgcGh5c2ljYWwgY29ubmVjdGlvbiBsb2NhbGx5IHdpdGhvdXQgdGFraW5nIG93bmVyc2hpcCBhd2F5XG4gICAqIGZyb20gdGhlIGRhdGFiYXNlIHVuaXF1ZW5lc3MgY29uc3RyYWludCBzaGFyZWQgYnkgYWxsIHByb2Nlc3Nlcy5cbiAgICogQHRlbXBsYXRlIFRcbiAgICogQHBhcmFtIHsoZGI6IGltcG9ydChcIi4uL2RhdGFiYXNlL2RyaXZlcnMvYmFzZS5qc1wiKS5kZWZhdWx0KSA9PiBQcm9taXNlPFQ+fSBjYWxsYmFjayAtIFRyYW5zYWN0aW9uIHdvcmsuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPFQ+fSAtIENhbGxiYWNrIHJlc3VsdC5cbiAgICovXG4gIGFzeW5jIF9pZGVtcG90ZW50RW5xdWV1ZVRyYW5zYWN0aW9uKGNhbGxiYWNrKSB7XG4gICAgcmV0dXJuIGF3YWl0IHRoaXMuX3NlcmlhbGl6ZWRUcmFuc2FjdGlvbk11dGF0aW9uKGNhbGxiYWNrKVxuICB9XG5cbiAgLyoqXG4gICAqIEluc2VydHMgYW4gb3duZXJzaGlwIHJvdywgcmVzb2x2aW5nIG9ubHkgYSBkYXRhYmFzZSB1bmlxdWVuZXNzIHJhY2UuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vZGF0YWJhc2UvZHJpdmVycy9iYXNlLmpzXCIpLmRlZmF1bHR9IGRiIC0gVHJhbnNhY3Rpb24gY29ubmVjdGlvbi5cbiAgICogQHBhcmFtIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59IG93bmVyc2hpcCAtIE93bmVyc2hpcCByb3cuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHtjcmVhdGVkOiBib29sZWFuLCByb3c6IFJlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0+fSAtIENsYWltIHJlc3VsdC5cbiAgICovXG4gIGFzeW5jIF9jbGFpbUlkZW1wb3RlbmN5T3duZXJzaGlwKGRiLCBvd25lcnNoaXApIHtcbiAgICB0cnkge1xuICAgICAgLy8gVGhlIHNhdmVwb2ludCBrZWVwcyBQb3N0Z3JlU1FMJ3Mgb3V0ZXIgdHJhbnNhY3Rpb24gdXNhYmxlIGFmdGVyIGFcbiAgICAgIC8vIGNvbmN1cnJlbnQgdW5pcXVlLWtleSBsb3NzLiBUaGUgdW5pcXVlIHByaW1hcnkga2V5LCBub3QgYSBwcm9jZXNzXG4gICAgICAvLyBtdXRleCwgaXMgdGhlIGNyb3NzLXByb2Nlc3MgY29udmVyZ2VuY2UgYXV0aG9yaXR5LlxuICAgICAgYXdhaXQgZGIudHJhbnNhY3Rpb24oYXN5bmMgKCkgPT4ge1xuICAgICAgICBhd2FpdCBkYi5pbnNlcnQoe3RhYmxlTmFtZTogSURFTVBPVEVOQ1lfS0VZU19UQUJMRSwgZGF0YTogb3duZXJzaGlwfSlcbiAgICAgIH0pXG5cbiAgICAgIHJldHVybiB7Y3JlYXRlZDogdHJ1ZSwgcm93OiBvd25lcnNoaXB9XG4gICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgIGNvbnN0IHJhY2VkID0gYXdhaXQgdGhpcy5faWRlbXBvdGVuY3lPd25lcnNoaXAoZGIsIFN0cmluZyhvd25lcnNoaXAuc2NvcGVfZGlnZXN0KSlcblxuICAgICAgaWYgKCFyYWNlZCkgdGhyb3cgZXJyb3JcbiAgICAgIHJldHVybiB7Y3JlYXRlZDogZmFsc2UsIHJvdzogcmFjZWR9XG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIExvYWRzIG9uZSBkdXJhYmxlIGVucXVldWUgb3duZXIuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vZGF0YWJhc2UvZHJpdmVycy9iYXNlLmpzXCIpLmRlZmF1bHR9IGRiIC0gRGF0YWJhc2UgY29ubmVjdGlvbi5cbiAgICogQHBhcmFtIHtzdHJpbmd9IHNjb3BlRGlnZXN0IC0gRml4ZWQtc2l6ZSBzY29wZSBkaWdlc3QuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPFJlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+PiB8IG51bGw+fSAtIFJvdyBvciBudWxsLlxuICAgKi9cbiAgYXN5bmMgX2lkZW1wb3RlbmN5T3duZXJzaGlwKGRiLCBzY29wZURpZ2VzdCkge1xuICAgIGNvbnN0IHJvd3MgPSBhd2FpdCBkYi5uZXdRdWVyeSgpLmZyb20oSURFTVBPVEVOQ1lfS0VZU19UQUJMRSkud2hlcmUoe3Njb3BlX2RpZ2VzdDogc2NvcGVEaWdlc3R9KS5saW1pdCgxKS5yZXN1bHRzKClcblxuICAgIHJldHVybiByb3dzWzBdID8gLyoqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59ICovIChyb3dzWzBdKSA6IG51bGxcbiAgfVxuXG4gIC8qKlxuICAgKiBGYWlscyBjbG9zZWQgd2hlbiBhIGR1cmFibGUga2V5IGlzIHJldXNlZCBmb3IgYSBkaWZmZXJlbnQgY2Fub25pY2FsIHJlcXVlc3QuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gVmFsaWRhdGlvbiBpbnB1dC5cbiAgICogQHBhcmFtIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59IGFyZ3MuZXhpc3RpbmcgLSBTdG9yZWQgb3duZXIuXG4gICAqIEBwYXJhbSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSBhcmdzLm93bmVyc2hpcCAtIFJlcXVlc3RlZCBvd25lci5cbiAgICogQHJldHVybnMge3ZvaWR9XG4gICAqL1xuICBfdmFsaWRhdGVJZGVtcG90ZW5jeU93bmVyc2hpcCh7ZXhpc3RpbmcsIG93bmVyc2hpcH0pIHtcbiAgICBjb25zdCBleGFjdFNjb3BlID0gU3RyaW5nKGV4aXN0aW5nLmpvYl9uYW1lKSA9PT0gb3duZXJzaGlwLmpvYl9uYW1lXG4gICAgICAmJiBTdHJpbmcoZXhpc3RpbmcucXVldWUpID09PSBvd25lcnNoaXAucXVldWVcbiAgICAgICYmIFN0cmluZyhleGlzdGluZy5pZGVtcG90ZW5jeV9rZXkpID09PSBvd25lcnNoaXAuaWRlbXBvdGVuY3lfa2V5XG5cbiAgICBpZiAoIWV4YWN0U2NvcGUgfHwgU3RyaW5nKGV4aXN0aW5nLnJlcXVlc3RfZGlnZXN0KSAhPT0gb3duZXJzaGlwLnJlcXVlc3RfZGlnZXN0KSB7XG4gICAgICB0aHJvdyBWZWxvY2lvdXNFcnJvci5zYWZlKFwiVGhlIGJhY2tncm91bmQgam9iIGlkZW1wb3RlbmN5IGtleSB3YXMgYWxyZWFkeSB1c2VkIGZvciBhIGRpZmZlcmVudCByZXF1ZXN0LlwiLCB7XG4gICAgICAgIGNvZGU6IFwiYmFja2dyb3VuZC1qb2ItaWRlbXBvdGVuY3ktY29uZmxpY3RcIlxuICAgICAgfSlcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogUGVyc2lzdHMgdGhlIGJ1aWx0LWluIG1haWwgb3BlcmF0aW9uIGluIHRoZSBzYW1lIGZpcnN0LWVucXVldWUgdHJhbnNhY3Rpb24uXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vZGF0YWJhc2UvZHJpdmVycy9iYXNlLmpzXCIpLmRlZmF1bHR9IGRiIC0gVHJhbnNhY3Rpb24gY29ubmVjdGlvbi5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBPcGVyYXRpb24gaW5wdXQuXG4gICAqIEBwYXJhbSB7bnVtYmVyfSBhcmdzLmNyZWF0ZWRBdE1zIC0gQ3JlYXRpb24gdGltZXN0YW1wLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gYXJncy5qb2JJZCAtIE5hdGl2ZSBqb2IgaWQuXG4gICAqIEBwYXJhbSB7e29wZXJhdGlvbjogaW1wb3J0KFwiLi4vbWFpbGVyL2luZGV4LmpzXCIpLk1haWxlckRlbGl2ZXJ5T3BlcmF0aW9uLCBwYXlsb2FkOiBpbXBvcnQoXCIuLi9tYWlsZXIvaW5kZXguanNcIikuTWFpbGVyRGVsaXZlcnlQYXlsb2FkfSB8IG51bGx9IGFyZ3MubWFpbE9wZXJhdGlvbklucHV0IC0gTWFpbCBvcGVyYXRpb24uXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIGFmdGVyIHBlcnNpc3RlbmNlLlxuICAgKi9cbiAgYXN5bmMgX3BlcnNpc3RNYWlsRGVsaXZlcnlPcGVyYXRpb24oZGIsIHtjcmVhdGVkQXRNcywgam9iSWQsIG1haWxPcGVyYXRpb25JbnB1dH0pIHtcbiAgICBpZiAoIW1haWxPcGVyYXRpb25JbnB1dCkgcmV0dXJuXG4gICAgY29uc3Qge29wZXJhdGlvbn0gPSBtYWlsT3BlcmF0aW9uSW5wdXRcbiAgICBjb25zdCBvcGVyYXRpb25LZXkgPSBtYWlsRGVsaXZlcnlPcGVyYXRpb25LZXkob3BlcmF0aW9uLmlkKVxuICAgIGNvbnN0IHJvdyA9IHtcbiAgICAgIGJhY2tncm91bmRfam9iX2lkOiBqb2JJZCxcbiAgICAgIGNyZWF0ZWRfYXRfbXM6IGNyZWF0ZWRBdE1zLFxuICAgICAgZmlyc3RfYXR0ZW1wdF9zdGFydGVkX2F0X21zOiBudWxsLFxuICAgICAgb3BlcmF0aW9uX2lkOiBvcGVyYXRpb24uaWQsXG4gICAgICBvcGVyYXRpb25fa2V5OiBvcGVyYXRpb25LZXksXG4gICAgICBwYXlsb2FkX2RpZ2VzdDogb3BlcmF0aW9uLnBheWxvYWREaWdlc3QsXG4gICAgICBwcm92aWRlcl9raW5kOiBvcGVyYXRpb24ucHJvdmlkZXJLaW5kLFxuICAgICAgcHJvdmlkZXJfcmV0ZW50aW9uX21zOiBvcGVyYXRpb24ucHJvdmlkZXJSZXRlbnRpb25Nc1xuICAgIH1cblxuICAgIHRyeSB7XG4gICAgICBhd2FpdCBkYi50cmFuc2FjdGlvbihhc3luYyAoKSA9PiB7XG4gICAgICAgIGF3YWl0IGRiLmluc2VydCh7dGFibGVOYW1lOiBNQUlMX0RFTElWRVJZX09QRVJBVElPTlNfVEFCTEUsIGRhdGE6IHJvd30pXG4gICAgICB9KVxuICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICBjb25zdCBleGlzdGluZyA9IGF3YWl0IHRoaXMuX21haWxEZWxpdmVyeU9wZXJhdGlvbihkYiwgb3BlcmF0aW9uS2V5KVxuXG4gICAgICBpZiAoIWV4aXN0aW5nKSB0aHJvdyBlcnJvclxuICAgICAgdGhpcy5fdmFsaWRhdGVNYWlsRGVsaXZlcnlPcGVyYXRpb25Sb3coe2V4aXN0aW5nLCByZXF1ZXN0ZWQ6IHJvd30pXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIFZhbGlkYXRlcyB0aGUgZHVyYWJsZSBtYWlsIHJvdyBkdXJpbmcgYW4gZXhhY3QgZ2VuZXJpYyBlbnF1ZXVlIHJlcGxheS5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9kYXRhYmFzZS9kcml2ZXJzL2Jhc2UuanNcIikuZGVmYXVsdH0gZGIgLSBEYXRhYmFzZSBjb25uZWN0aW9uLlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIFZhbGlkYXRpb24gaW5wdXQuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBhcmdzLmpvYklkIC0gT3duZWQgam9iIGlkLlxuICAgKiBAcGFyYW0ge3tvcGVyYXRpb246IGltcG9ydChcIi4uL21haWxlci9pbmRleC5qc1wiKS5NYWlsZXJEZWxpdmVyeU9wZXJhdGlvbiwgcGF5bG9hZDogaW1wb3J0KFwiLi4vbWFpbGVyL2luZGV4LmpzXCIpLk1haWxlckRlbGl2ZXJ5UGF5bG9hZH0gfCBudWxsfSBhcmdzLm1haWxPcGVyYXRpb25JbnB1dCAtIE1haWwgb3BlcmF0aW9uLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyB3aGVuIGV4YWN0LlxuICAgKi9cbiAgYXN5bmMgX3ZhbGlkYXRlTWFpbERlbGl2ZXJ5T3BlcmF0aW9uKGRiLCB7am9iSWQsIG1haWxPcGVyYXRpb25JbnB1dH0pIHtcbiAgICBpZiAoIW1haWxPcGVyYXRpb25JbnB1dCkgcmV0dXJuXG4gICAgY29uc3Qge29wZXJhdGlvbn0gPSBtYWlsT3BlcmF0aW9uSW5wdXRcbiAgICBjb25zdCBleGlzdGluZyA9IGF3YWl0IHRoaXMuX21haWxEZWxpdmVyeU9wZXJhdGlvbihkYiwgbWFpbERlbGl2ZXJ5T3BlcmF0aW9uS2V5KG9wZXJhdGlvbi5pZCkpXG5cbiAgICBpZiAoIWV4aXN0aW5nKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoXCJCYWNrZ3JvdW5kIGpvYiBpZGVtcG90ZW5jeSBvd25lcnNoaXAgaXMgbWlzc2luZyBpdHMgZHVyYWJsZSBtYWlsIGRlbGl2ZXJ5IG9wZXJhdGlvblwiKVxuICAgIH1cblxuICAgIHRoaXMuX3ZhbGlkYXRlTWFpbERlbGl2ZXJ5T3BlcmF0aW9uUm93KHtcbiAgICAgIGV4aXN0aW5nLFxuICAgICAgcmVxdWVzdGVkOiB7XG4gICAgICAgIGJhY2tncm91bmRfam9iX2lkOiBqb2JJZCxcbiAgICAgICAgb3BlcmF0aW9uX2lkOiBvcGVyYXRpb24uaWQsXG4gICAgICAgIHBheWxvYWRfZGlnZXN0OiBvcGVyYXRpb24ucGF5bG9hZERpZ2VzdCxcbiAgICAgICAgcHJvdmlkZXJfa2luZDogb3BlcmF0aW9uLnByb3ZpZGVyS2luZCxcbiAgICAgICAgcHJvdmlkZXJfcmV0ZW50aW9uX21zOiBvcGVyYXRpb24ucHJvdmlkZXJSZXRlbnRpb25Nc1xuICAgICAgfVxuICAgIH0pXG4gIH1cblxuICAvKipcbiAgICogTG9hZHMgYSBkdXJhYmxlIG1haWwgb3BlcmF0aW9uLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL2RhdGFiYXNlL2RyaXZlcnMvYmFzZS5qc1wiKS5kZWZhdWx0fSBkYiAtIERhdGFiYXNlIGNvbm5lY3Rpb24uXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBvcGVyYXRpb25LZXkgLSBGaXhlZC1zaXplIG9wZXJhdGlvbiBrZXkuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPFJlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+PiB8IG51bGw+fSAtIFJvdyBvciBudWxsLlxuICAgKi9cbiAgYXN5bmMgX21haWxEZWxpdmVyeU9wZXJhdGlvbihkYiwgb3BlcmF0aW9uS2V5KSB7XG4gICAgY29uc3Qgcm93cyA9IGF3YWl0IGRiLm5ld1F1ZXJ5KCkuZnJvbShNQUlMX0RFTElWRVJZX09QRVJBVElPTlNfVEFCTEUpLndoZXJlKHtvcGVyYXRpb25fa2V5OiBvcGVyYXRpb25LZXl9KS5saW1pdCgxKS5yZXN1bHRzKClcblxuICAgIHJldHVybiByb3dzWzBdID8gLyoqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59ICovIChyb3dzWzBdKSA6IG51bGxcbiAgfVxuXG4gIC8qKlxuICAgKiBDb21wYXJlcyBwcm92aWRlci1yZWxldmFudCBkdXJhYmxlIG1haWwgb3BlcmF0aW9uIGZpZWxkcy5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBWYWxpZGF0aW9uIGlucHV0LlxuICAgKiBAcGFyYW0ge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gYXJncy5leGlzdGluZyAtIFN0b3JlZCByb3cuXG4gICAqIEBwYXJhbSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSBhcmdzLnJlcXVlc3RlZCAtIFJlcXVlc3RlZCByb3cuXG4gICAqIEByZXR1cm5zIHt2b2lkfVxuICAgKi9cbiAgX3ZhbGlkYXRlTWFpbERlbGl2ZXJ5T3BlcmF0aW9uUm93KHtleGlzdGluZywgcmVxdWVzdGVkfSkge1xuICAgIGNvbnN0IG1hdGNoZXMgPSBTdHJpbmcoZXhpc3Rpbmcub3BlcmF0aW9uX2lkKSA9PT0gcmVxdWVzdGVkLm9wZXJhdGlvbl9pZFxuICAgICAgJiYgU3RyaW5nKGV4aXN0aW5nLnBheWxvYWRfZGlnZXN0KSA9PT0gcmVxdWVzdGVkLnBheWxvYWRfZGlnZXN0XG4gICAgICAmJiBTdHJpbmcoZXhpc3RpbmcuYmFja2dyb3VuZF9qb2JfaWQpID09PSByZXF1ZXN0ZWQuYmFja2dyb3VuZF9qb2JfaWRcbiAgICAgICYmIFN0cmluZyhleGlzdGluZy5wcm92aWRlcl9raW5kKSA9PT0gcmVxdWVzdGVkLnByb3ZpZGVyX2tpbmRcbiAgICAgICYmIHRoaXMuX25vcm1hbGl6ZU51bWJlcihleGlzdGluZy5wcm92aWRlcl9yZXRlbnRpb25fbXMpID09PSByZXF1ZXN0ZWQucHJvdmlkZXJfcmV0ZW50aW9uX21zXG5cbiAgICBpZiAoIW1hdGNoZXMpIHtcbiAgICAgIHRocm93IFZlbG9jaW91c0Vycm9yLnNhZmUoXCJUaGUgbWFpbCBkZWxpdmVyeSBvcGVyYXRpb24gd2FzIGFscmVhZHkgdXNlZCBmb3IgYSBkaWZmZXJlbnQgcGF5bG9hZCBvciBwcm92aWRlci5cIiwge1xuICAgICAgICBjb2RlOiBcIm1haWwtZGVsaXZlcnktaWRlbXBvdGVuY3ktY29uZmxpY3RcIlxuICAgICAgfSlcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogQ2Fub25pY2FsIHJlcXVlc3QgZGlnZXN0IGV4Y2x1ZGluZyBnZW5lcmF0ZWQgaWRzIGFuZCBpbW1lZGlhdGUgZW5xdWV1ZSB0aW1lLlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIERpZ2VzdCBpbnB1dC5cbiAgICogQHBhcmFtIHtBcnJheTxSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59IGFyZ3MuYXJncyAtIEpvYiBhcmd1bWVudHMuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi90eXBlcy5qc1wiKS5CYWNrZ3JvdW5kSm9iT3B0aW9uc30gYXJncy5vcHRpb25zIC0gSm9iIG9wdGlvbnMuXG4gICAqIEBwYXJhbSB7UHJlcGFyZWRCYWNrZ3JvdW5kSm9ifSBhcmdzLnByZXBhcmVkSm9iIC0gTm9ybWFsaXplZCBqb2IuXG4gICAqIEByZXR1cm5zIHtzdHJpbmd9IC0gU0hBLTI1NiBkaWdlc3QuXG4gICAqL1xuICBfaWRlbXBvdGVuY3lSZXF1ZXN0RGlnZXN0KHthcmdzLCBvcHRpb25zLCBwcmVwYXJlZEpvYn0pIHtcbiAgICBjb25zdCBzZXJpYWxpemVkID0gc3RhYmxlSnNvblN0cmluZ2lmeSh7XG4gICAgICBhcmdzLFxuICAgICAgY29uY3VycmVuY3k6IHByZXBhcmVkSm9iLmNvbmN1cnJlbmN5LFxuICAgICAgZXhlY3V0aW9uTW9kZTogcHJlcGFyZWRKb2IuZXhlY3V0aW9uTW9kZSxcbiAgICAgIGZvcm1hdDogXCJ2ZWxvY2lvdXMtYmFja2dyb3VuZC1qb2ItaWRlbXBvdGVuY3ktdjFcIixcbiAgICAgIGpvYk5hbWU6IHByZXBhcmVkSm9iLmpvYk5hbWUsXG4gICAgICBtYXhSZXRyaWVzOiBwcmVwYXJlZEpvYi5tYXhSZXRyaWVzLFxuICAgICAgcXVldWU6IHByZXBhcmVkSm9iLnF1ZXVlLFxuICAgICAgc2NoZWR1bGVkQXRNczogb3B0aW9ucy5zY2hlZHVsZWRBdE1zID09PSB1bmRlZmluZWQgPyBudWxsIDogcHJlcGFyZWRKb2Iuc2NoZWR1bGVkQXRNcyxcbiAgICAgIHNjaGVkdWxpbmc6IG9wdGlvbnMuc2NoZWR1bGVkQXRNcyA9PT0gdW5kZWZpbmVkID8gXCJpbW1lZGlhdGVcIiA6IFwic2NoZWR1bGVkXCIsXG4gICAgICAuLi4ocHJlcGFyZWRKb2IudGltZW91dE1zID09PSBudWxsID8ge30gOiB7dGltZW91dE1zOiBwcmVwYXJlZEpvYi50aW1lb3V0TXN9KVxuICAgIH0pXG5cbiAgICByZXR1cm4gY3JlYXRlSGFzaChcInNoYTI1NlwiKS51cGRhdGUoc2VyaWFsaXplZCkuZGlnZXN0KFwiaGV4XCIpXG4gIH1cblxuICAvKipcbiAgICogRml4ZWQtc2l6ZSBnbG9iYWxseSBpbmRleGVkIHJlcHJlc2VudGF0aW9uIG9mIHRoZSBkb2N1bWVudGVkIHNjb3BlIHR1cGxlLlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIFNjb3BlIGlucHV0LlxuICAgKiBAcGFyYW0ge3N0cmluZ30gYXJncy5pZGVtcG90ZW5jeUtleSAtIENhbGxlciBrZXkuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBhcmdzLmpvYk5hbWUgLSBKb2IgY2xhc3MgbmFtZS5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGFyZ3MucXVldWUgLSBRdWV1ZSBuYW1lLlxuICAgKiBAcmV0dXJucyB7c3RyaW5nfSAtIFNIQS0yNTYgc2NvcGUgZGlnZXN0LlxuICAgKi9cbiAgX2lkZW1wb3RlbmN5U2NvcGVEaWdlc3Qoe2lkZW1wb3RlbmN5S2V5LCBqb2JOYW1lLCBxdWV1ZX0pIHtcbiAgICByZXR1cm4gY3JlYXRlSGFzaChcInNoYTI1NlwiKVxuICAgICAgLnVwZGF0ZShzdGFibGVKc29uU3RyaW5naWZ5KHtmb3JtYXQ6IFwidmVsb2Npb3VzLWJhY2tncm91bmQtam9iLWlkZW1wb3RlbmN5LXNjb3BlLXYxXCIsIGlkZW1wb3RlbmN5S2V5LCBqb2JOYW1lLCBxdWV1ZX0pKVxuICAgICAgLmRpZ2VzdChcImhleFwiKVxuICB9XG5cbiAgLyoqXG4gICAqIFZhbGlkYXRlcyBvbmUgY2FsbGVyIGtleS5cbiAgICogQHBhcmFtIHtzdHJpbmcgfCB1bmRlZmluZWR9IGlkZW1wb3RlbmN5S2V5IC0gQ2FsbGVyIGtleS5cbiAgICogQHJldHVybnMge3N0cmluZ30gLSBWYWxpZCBrZXkuXG4gICAqL1xuICBfbm9ybWFsaXplSWRlbXBvdGVuY3lLZXkoaWRlbXBvdGVuY3lLZXkpIHtcbiAgICBpZiAodHlwZW9mIGlkZW1wb3RlbmN5S2V5ICE9PSBcInN0cmluZ1wiIHx8IGlkZW1wb3RlbmN5S2V5Lmxlbmd0aCA9PT0gMCkge1xuICAgICAgdGhyb3cgVmVsb2Npb3VzRXJyb3Iuc2FmZShcIkJhY2tncm91bmQgam9iIGlkZW1wb3RlbmN5S2V5IG11c3QgYmUgYSBub24tZW1wdHkgc3RyaW5nLlwiLCB7XG4gICAgICAgIGNvZGU6IFwiYmFja2dyb3VuZC1qb2ItaWRlbXBvdGVuY3kta2V5LWludmFsaWRcIlxuICAgICAgfSlcbiAgICB9XG5cbiAgICByZXR1cm4gaWRlbXBvdGVuY3lLZXlcbiAgfVxuXG4gIC8qKlxuICAgKiBDYW5vbmljYWwgcmVxdWVzdCBpZGVudGl0eSBmb3IgYW4gaW50ZXJuYWwgb3duZWQtaGFuZG9mZiByZXBsYXkuXG4gICAqIEltbWVkaWF0ZSBlbnF1ZXVlIHdhbGwgdGltZSBhbmQgZ2VuZXJhdGVkIGpvYiBpZHMgcmVtYWluIGV4Y2x1ZGVkLlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIERpZ2VzdCBpbnB1dC5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL3R5cGVzLmpzXCIpLkJhY2tncm91bmRKb2JPcHRpb25zfSBhcmdzLm9wdGlvbnMgLSBFbnF1ZXVlIG9wdGlvbnMuXG4gICAqIEBwYXJhbSB7UHJlcGFyZWRCYWNrZ3JvdW5kSm9ifSBhcmdzLnByZXBhcmVkSm9iIC0gTm9ybWFsaXplZCBqb2IuXG4gICAqIEByZXR1cm5zIHtzdHJpbmd9IC0gU0hBLTI1NiBkaWdlc3QuXG4gICAqL1xuICBfb3duZWRFbnF1ZXVlUmVxdWVzdERpZ2VzdCh7b3B0aW9ucywgcHJlcGFyZWRKb2J9KSB7XG4gICAgY29uc3Qgc2VyaWFsaXplZCA9IHN0YWJsZUpzb25TdHJpbmdpZnkoe1xuICAgICAgYXJnc0pzb246IHByZXBhcmVkSm9iLmFyZ3NKc29uLFxuICAgICAgY29uY3VycmVuY3k6IHByZXBhcmVkSm9iLmNvbmN1cnJlbmN5LFxuICAgICAgZGVkdXBsaWNhdGVXaGlsZVF1ZXVlZDogb3B0aW9ucy5kZWR1cGxpY2F0ZVdoaWxlUXVldWVkID09PSB0cnVlLFxuICAgICAgZXhlY3V0aW9uTW9kZTogcHJlcGFyZWRKb2IuZXhlY3V0aW9uTW9kZSxcbiAgICAgIGZvcm1hdDogXCJ2ZWxvY2lvdXMtYmFja2dyb3VuZC1qb2Itb3duZWQtZW5xdWV1ZS12MVwiLFxuICAgICAgam9iTmFtZTogcHJlcGFyZWRKb2Iuam9iTmFtZSxcbiAgICAgIG1heFJldHJpZXM6IHByZXBhcmVkSm9iLm1heFJldHJpZXMsXG4gICAgICBxdWV1ZTogcHJlcGFyZWRKb2IucXVldWUsXG4gICAgICBzY2hlZHVsZWRBdE1zOiBvcHRpb25zLnNjaGVkdWxlZEF0TXMgPT09IHVuZGVmaW5lZCA/IG51bGwgOiBwcmVwYXJlZEpvYi5zY2hlZHVsZWRBdE1zLFxuICAgICAgc2NoZWR1bGluZzogb3B0aW9ucy5zY2hlZHVsZWRBdE1zID09PSB1bmRlZmluZWQgPyBcImltbWVkaWF0ZVwiIDogXCJzY2hlZHVsZWRcIixcbiAgICAgIC4uLihwcmVwYXJlZEpvYi50aW1lb3V0TXMgPT09IG51bGwgPyB7fSA6IHt0aW1lb3V0TXM6IHByZXBhcmVkSm9iLnRpbWVvdXRNc30pXG4gICAgfSlcblxuICAgIHJldHVybiBjcmVhdGVIYXNoKFwic2hhMjU2XCIpLnVwZGF0ZShzZXJpYWxpemVkKS5kaWdlc3QoXCJoZXhcIilcbiAgfVxuXG4gIC8qKlxuICAgKiBJc29sYXRlcyBpbnRlcm5hbCBwcm9kdWNlciByZXBsYXkgb3duZXJzaGlwIGZyb20gY2FsbGVyIGlkZW1wb3RlbmN5IHNjb3Blcy5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBTY29wZSBpbnB1dC5cbiAgICogQHBhcmFtIHtQcmVwYXJlZEJhY2tncm91bmRKb2J9IGFyZ3MucHJlcGFyZWRKb2IgLSBOb3JtYWxpemVkIGpvYi5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGFyZ3MucHJvZHVjZXJJbnZvY2F0aW9uSWQgLSBTdGFibGUgaWRlbnRpdHkgZm9yIG9uZSBvd25lZCBlbnF1ZXVlIGludm9jYXRpb24uXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi90eXBlcy5qc1wiKS5CYWNrZ3JvdW5kSm9iUHJvZHVjZXJQcm9vZn0gYXJncy5wcm9kdWNlclByb29mIC0gRXhhY3QgcHJvZHVjZXIgbGVhc2UuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBhcmdzLnJlcXVlc3REaWdlc3QgLSBDYW5vbmljYWwgcmVxdWVzdCBkaWdlc3QuXG4gICAqIEByZXR1cm5zIHtzdHJpbmd9IC0gU0hBLTI1NiBzY29wZSBkaWdlc3QuXG4gICAqL1xuICBfb3duZWRFbnF1ZXVlU2NvcGVEaWdlc3Qoe3ByZXBhcmVkSm9iLCBwcm9kdWNlckludm9jYXRpb25JZCwgcHJvZHVjZXJQcm9vZiwgcmVxdWVzdERpZ2VzdH0pIHtcbiAgICByZXR1cm4gY3JlYXRlSGFzaChcInNoYTI1NlwiKVxuICAgICAgLnVwZGF0ZShzdGFibGVKc29uU3RyaW5naWZ5KHtcbiAgICAgICAgZm9ybWF0OiBcInZlbG9jaW91cy1iYWNrZ3JvdW5kLWpvYi1vd25lZC1lbnF1ZXVlLXNjb3BlLXYxXCIsXG4gICAgICAgIGpvYk5hbWU6IHByZXBhcmVkSm9iLmpvYk5hbWUsXG4gICAgICAgIHByb2R1Y2VySW52b2NhdGlvbklkLFxuICAgICAgICBwcm9kdWNlclByb29mLFxuICAgICAgICBxdWV1ZTogcHJlcGFyZWRKb2IucXVldWUsXG4gICAgICAgIHJlcXVlc3REaWdlc3RcbiAgICAgIH0pKVxuICAgICAgLmRpZ2VzdChcImhleFwiKVxuICB9XG5cbiAgLyoqXG4gICAqIFZhbGlkYXRlcyB0aGUgdW50cnVzdGVkIGlkZW50aXR5IG9mIG9uZSBwcm9kdWNlci1vd25lZCBlbnF1ZXVlIGludm9jYXRpb24uXG4gICAqIEBwYXJhbSB7c3RyaW5nIHwgdW5kZWZpbmVkfSBwcm9kdWNlckludm9jYXRpb25JZCAtIFByb2R1Y2VyIGludm9jYXRpb24gaWRlbnRpdHkuXG4gICAqIEByZXR1cm5zIHtzdHJpbmd9IC0gVmFsaWRhdGVkIGlkZW50aXR5LlxuICAgKi9cbiAgX25vcm1hbGl6ZVByb2R1Y2VySW52b2NhdGlvbklkKHByb2R1Y2VySW52b2NhdGlvbklkKSB7XG4gICAgaWYgKHR5cGVvZiBwcm9kdWNlckludm9jYXRpb25JZCAhPT0gXCJzdHJpbmdcIiB8fCBwcm9kdWNlckludm9jYXRpb25JZC5sZW5ndGggPT09IDApIHtcbiAgICAgIHRocm93IFZlbG9jaW91c0Vycm9yLnNhZmUoXCJCYWNrZ3JvdW5kIGpvYiBwcm9kdWNlciBpbnZvY2F0aW9uIGlkIGlzIGludmFsaWQuXCIsIHtcbiAgICAgICAgY29kZTogXCJiYWNrZ3JvdW5kLWpvYi1wcm9kdWNlci1pbnZvY2F0aW9uLWlkLWludmFsaWRcIlxuICAgICAgfSlcbiAgICB9XG5cbiAgICByZXR1cm4gcHJvZHVjZXJJbnZvY2F0aW9uSWRcbiAgfVxuXG4gIC8qKlxuICAgKiBWYWxpZGF0ZXMgdGhlIHVudHJ1c3RlZCB0cmFuc3BvcnQgc2hhcGUgYmVmb3JlIHRyYW5zYWN0aW9uIGFkbWlzc2lvbi5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL3R5cGVzLmpzXCIpLkJhY2tncm91bmRKb2JQcm9kdWNlclByb29mfSBwcm9kdWNlclByb29mIC0gUHJvZHVjZXIgcHJvb2YuXG4gICAqIEByZXR1cm5zIHtpbXBvcnQoXCIuL3R5cGVzLmpzXCIpLkJhY2tncm91bmRKb2JQcm9kdWNlclByb29mfSAtIE5vcm1hbGl6ZWQgaW1tdXRhYmxlIHByb29mLlxuICAgKi9cbiAgX25vcm1hbGl6ZVByb2R1Y2VyUHJvb2YocHJvZHVjZXJQcm9vZikge1xuICAgIGNvbnN0IGV4YWN0S2V5cyA9IFtcImhhbmRlZE9mZkF0TXNcIiwgXCJoYW5kb2ZmSWRcIiwgXCJqb2JJZFwiLCBcIndvcmtlcklkXCJdXG4gICAgY29uc3Qga2V5cyA9IHByb2R1Y2VyUHJvb2YgJiYgdHlwZW9mIHByb2R1Y2VyUHJvb2YgPT09IFwib2JqZWN0XCIgPyBPYmplY3Qua2V5cyhwcm9kdWNlclByb29mKSA6IFtdXG4gICAgY29uc3QgdmFsaWQgPSBwcm9kdWNlclByb29mXG4gICAgICAmJiB0eXBlb2YgcHJvZHVjZXJQcm9vZiA9PT0gXCJvYmplY3RcIlxuICAgICAgJiYga2V5cy5sZW5ndGggPT09IGV4YWN0S2V5cy5sZW5ndGhcbiAgICAgICYmIGtleXMuZXZlcnkoKGtleSkgPT4gZXhhY3RLZXlzLmluY2x1ZGVzKGtleSkpXG4gICAgICAmJiB0eXBlb2YgcHJvZHVjZXJQcm9vZi5qb2JJZCA9PT0gXCJzdHJpbmdcIlxuICAgICAgJiYgcHJvZHVjZXJQcm9vZi5qb2JJZC5sZW5ndGggPiAwXG4gICAgICAmJiB0eXBlb2YgcHJvZHVjZXJQcm9vZi5oYW5kb2ZmSWQgPT09IFwic3RyaW5nXCJcbiAgICAgICYmIHByb2R1Y2VyUHJvb2YuaGFuZG9mZklkLmxlbmd0aCA+IDBcbiAgICAgICYmIHR5cGVvZiBwcm9kdWNlclByb29mLndvcmtlcklkID09PSBcInN0cmluZ1wiXG4gICAgICAmJiBwcm9kdWNlclByb29mLndvcmtlcklkLmxlbmd0aCA+IDBcbiAgICAgICYmIE51bWJlci5pc1NhZmVJbnRlZ2VyKHByb2R1Y2VyUHJvb2YuaGFuZGVkT2ZmQXRNcylcbiAgICAgICYmIHByb2R1Y2VyUHJvb2YuaGFuZGVkT2ZmQXRNcyA+PSAwXG5cbiAgICBpZiAoIXZhbGlkKSB7XG4gICAgICB0aHJvdyBWZWxvY2lvdXNFcnJvci5zYWZlKFwiQmFja2dyb3VuZCBqb2IgcHJvZHVjZXIgcHJvb2YgaXMgaW52YWxpZC5cIiwge1xuICAgICAgICBjb2RlOiBcImJhY2tncm91bmQtam9iLXByb2R1Y2VyLXByb29mLWludmFsaWRcIlxuICAgICAgfSlcbiAgICB9XG5cbiAgICByZXR1cm4gT2JqZWN0LmZyZWV6ZSh7XG4gICAgICBoYW5kZWRPZmZBdE1zOiBwcm9kdWNlclByb29mLmhhbmRlZE9mZkF0TXMsXG4gICAgICBoYW5kb2ZmSWQ6IHByb2R1Y2VyUHJvb2YuaGFuZG9mZklkLFxuICAgICAgam9iSWQ6IHByb2R1Y2VyUHJvb2Yuam9iSWQsXG4gICAgICB3b3JrZXJJZDogcHJvZHVjZXJQcm9vZi53b3JrZXJJZFxuICAgIH0pXG4gIH1cblxuICAvKipcbiAgICogQ29uZmlybXMgZXhhY3QgYWN0aXZlIG93bmVyc2hpcCB3aGlsZSB0aGUgZW5xdWV1ZSB0cmFuc2FjdGlvbiBob2xkcyB0aGVcbiAgICogc2hhcmVkIG11dGF0aW9uIGZlbmNlIHVzZWQgYnkgdGVybWluYWwgcHJvZHVjZXIgdHJhbnNpdGlvbnMuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vZGF0YWJhc2UvZHJpdmVycy9iYXNlLmpzXCIpLmRlZmF1bHR9IGRiIC0gVHJhbnNhY3Rpb24gY29ubmVjdGlvbi5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL3R5cGVzLmpzXCIpLkJhY2tncm91bmRKb2JQcm9kdWNlclByb29mfSBwcm9kdWNlclByb29mIC0gRXhhY3QgcHJvZHVjZXIgbGVhc2UuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIHdoaWxlIG93bmVyc2hpcCByZW1haW5zIGV4YWN0LlxuICAgKi9cbiAgYXN5bmMgX3ZhbGlkYXRlT3duZWRQcm9kdWNlclByb29mKGRiLCBwcm9kdWNlclByb29mKSB7XG4gICAgY29uc3QgcHJvZHVjZXIgPSBhd2FpdCB0aGlzLl9nZXRKb2JSb3dCeUlkKGRiLCBwcm9kdWNlclByb29mLmpvYklkKVxuICAgIGNvbnN0IG93bmVkID0gcHJvZHVjZXJcbiAgICAgICYmIHByb2R1Y2VyLnN0YXR1cyA9PT0gXCJoYW5kZWRfb2ZmXCJcbiAgICAgICYmIHByb2R1Y2VyLmhhbmRvZmZJZCA9PT0gcHJvZHVjZXJQcm9vZi5oYW5kb2ZmSWRcbiAgICAgICYmIHByb2R1Y2VyLndvcmtlcklkID09PSBwcm9kdWNlclByb29mLndvcmtlcklkXG4gICAgICAmJiBwcm9kdWNlci5oYW5kZWRPZmZBdE1zID09PSBwcm9kdWNlclByb29mLmhhbmRlZE9mZkF0TXNcblxuICAgIGlmICghb3duZWQpIHtcbiAgICAgIHRocm93IFZlbG9jaW91c0Vycm9yLnNhZmUoXCJCYWNrZ3JvdW5kIGpvYiBwcm9kdWNlciBoYW5kb2ZmIGlzIG5vIGxvbmdlciBvd25lZC5cIiwge1xuICAgICAgICBjb2RlOiBcImJhY2tncm91bmQtam9iLXByb2R1Y2VyLWhhbmRvZmYtbm90LW93bmVkXCJcbiAgICAgIH0pXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIFJlcGxhY2VzIHRoZSBxdWV1ZWQgb3duZXIgb2YgYSBzdGFibGUgc2NoZWR1bGUga2V5IHdpdGggYSBuZXcgb25lLW9mZiBqb2IuXG4gICAqIEEgaGFuZGVkLW9mZiBvd25lciBpcyBsZWZ0IHJ1bm5pbmcgYW5kIHJlcG9ydGVkIHRydXRoZnVsbHkuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gT3B0aW9ucy5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGFyZ3Muc2NoZWR1bGVLZXkgLSBTdGFibGUgbG9naWNhbCBzY2hlZHVsZSBrZXkuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBhcmdzLmpvYk5hbWUgLSBKb2IgbmFtZS5cbiAgICogQHBhcmFtIHtBcnJheTxSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59IGFyZ3MuYXJncyAtIEFyZ3VtZW50cy5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL3R5cGVzLmpzXCIpLkJhY2tncm91bmRKb2JPcHRpb25zfSBbYXJncy5vcHRpb25zXSAtIE9wdGlvbnMuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPGltcG9ydChcIi4vdHlwZXMuanNcIikuQmFja2dyb3VuZEpvYlJlcGxhY2VtZW50UmVzdWx0Pn0gLSBSZXBsYWNlbWVudCByZXN1bHQuXG4gICAqL1xuICBhc3luYyByZXBsYWNlU2NoZWR1bGVkKHtzY2hlZHVsZUtleSwgam9iTmFtZSwgYXJncywgb3B0aW9uc30pIHtcbiAgICBhd2FpdCB0aGlzLmVuc3VyZVJlYWR5KClcblxuICAgIGNvbnN0IG5vcm1hbGl6ZWRTY2hlZHVsZUtleSA9IHRoaXMuX25vcm1hbGl6ZVNjaGVkdWxlS2V5KHNjaGVkdWxlS2V5KVxuICAgIGNvbnN0IHByZXBhcmVkSm9iID0gdGhpcy5fcHJlcGFyZUpvYih7am9iTmFtZSwgYXJncywgb3B0aW9uc30pXG5cbiAgICByZXR1cm4gYXdhaXQgdGhpcy5fc2VyaWFsaXplZENvdW50TXV0YXRpb24oYXN5bmMgKGRiKSA9PiB7XG4gICAgICBjb25zdCBvd25lclJvd3MgPSBhd2FpdCBkYlxuICAgICAgICAubmV3UXVlcnkoKVxuICAgICAgICAuZnJvbShTQ0hFRFVMRV9LRVlTX1RBQkxFKVxuICAgICAgICAud2hlcmUoe3NjaGVkdWxlX2tleTogbm9ybWFsaXplZFNjaGVkdWxlS2V5fSlcbiAgICAgICAgLmxpbWl0KDEpXG4gICAgICAgIC5yZXN1bHRzKClcbiAgICAgIGNvbnN0IG93bmVySm9iSWQgPSBvd25lclJvd3NbMF0gPyBTdHJpbmcoLyoqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59ICovIChvd25lclJvd3NbMF0pLmpvYl9pZCkgOiBudWxsXG4gICAgICBjb25zdCBvd25lckpvYiA9IG93bmVySm9iSWQgPyBhd2FpdCB0aGlzLl9nZXRKb2JSb3dCeUlkKGRiLCBvd25lckpvYklkKSA6IG51bGxcbiAgICAgIC8qKiBAdHlwZSB7aW1wb3J0KFwiLi90eXBlcy5qc1wiKS5CYWNrZ3JvdW5kSm9iUmVwbGFjZW1lbnRQcmV2aW91c1N0YXR1c30gKi9cbiAgICAgIGxldCBwcmV2aW91c1N0YXR1cyA9IG51bGxcbiAgICAgIGxldCBwcmV2aW91c0pvYklkID0gbnVsbFxuXG4gICAgICBpZiAob3duZXJKb2I/LnN0YXR1cyA9PT0gXCJxdWV1ZWRcIikge1xuICAgICAgICBjb25zdCBhZmZlY3RlZFJvd3MgPSBhd2FpdCB0aGlzLl91cGRhdGVBZmZlY3RlZFJvd3MoZGIsIHtcbiAgICAgICAgICB0YWJsZU5hbWU6IEpPQlNfVEFCTEUsXG4gICAgICAgICAgZGF0YToge3N0YXR1czogXCJjYW5jZWxsZWRcIn0sXG4gICAgICAgICAgY29uZGl0aW9uczoge2lkOiBvd25lckpvYi5pZCwgc3RhdHVzOiBcInF1ZXVlZFwifVxuICAgICAgICB9KVxuXG4gICAgICAgIGlmIChhZmZlY3RlZFJvd3MgPT09IDEpIHtcbiAgICAgICAgICBwcmV2aW91c0pvYklkID0gb3duZXJKb2IuaWRcbiAgICAgICAgICBwcmV2aW91c1N0YXR1cyA9IFwicXVldWVkXCJcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICBjb25zdCBjdXJyZW50T3duZXJKb2IgPSBhd2FpdCB0aGlzLl9nZXRKb2JSb3dCeUlkKGRiLCBvd25lckpvYi5pZClcblxuICAgICAgICAgIGlmIChjdXJyZW50T3duZXJKb2I/LnN0YXR1cyA9PT0gXCJoYW5kZWRfb2ZmXCIpIHtcbiAgICAgICAgICAgIHByZXZpb3VzSm9iSWQgPSBjdXJyZW50T3duZXJKb2IuaWRcbiAgICAgICAgICAgIHByZXZpb3VzU3RhdHVzID0gXCJoYW5kZWRfb2ZmXCJcbiAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICAgIH0gZWxzZSBpZiAob3duZXJKb2I/LnN0YXR1cyA9PT0gXCJoYW5kZWRfb2ZmXCIpIHtcbiAgICAgICAgcHJldmlvdXNKb2JJZCA9IG93bmVySm9iLmlkXG4gICAgICAgIHByZXZpb3VzU3RhdHVzID0gXCJoYW5kZWRfb2ZmXCJcbiAgICAgIH1cblxuICAgICAgYXdhaXQgdGhpcy5faW5zZXJ0UHJlcGFyZWRKb2IoZGIsIHtwcmVwYXJlZEpvYiwgc2NoZWR1bGVLZXk6IG5vcm1hbGl6ZWRTY2hlZHVsZUtleX0pXG4gICAgICBhd2FpdCBkYi51cHNlcnQoe1xuICAgICAgICB0YWJsZU5hbWU6IFNDSEVEVUxFX0tFWVNfVEFCTEUsXG4gICAgICAgIGRhdGE6IHtzY2hlZHVsZV9rZXk6IG5vcm1hbGl6ZWRTY2hlZHVsZUtleSwgam9iX2lkOiBwcmVwYXJlZEpvYi5qb2JJZH0sXG4gICAgICAgIGNvbmZsaWN0Q29sdW1uczogW1wic2NoZWR1bGVfa2V5XCJdLFxuICAgICAgICB1cGRhdGVDb2x1bW5zOiBbXCJqb2JfaWRcIl1cbiAgICAgIH0pXG5cbiAgICAgIGlmIChwcmV2aW91c1N0YXR1cyAhPT0gXCJxdWV1ZWRcIikgYXdhaXQgdGhpcy5fcmVjb3JkQ291bnREZWx0YShkYiwge2FsbDogMSwgcXVldWVkOiAxfSlcbiAgICAgIHJldHVybiB7am9iSWQ6IHByZXBhcmVkSm9iLmpvYklkLCBwcmV2aW91c0pvYklkLCBwcmV2aW91c1N0YXR1c31cbiAgICB9LCB7XG4gICAgICBhZHZpc29yeUxvY2s6IHtcbiAgICAgICAgZmFpbHVyZU1lc3NhZ2U6IFwiRmFpbGVkIHRvIGFjcXVpcmUgYmFja2dyb3VuZCBqb2Igc2NoZWR1bGUta2V5IGxvY2tcIixcbiAgICAgICAgbmFtZTogdGhpcy5fc2NoZWR1bGVLZXlMb2NrTmFtZShub3JtYWxpemVkU2NoZWR1bGVLZXkpXG4gICAgICB9XG4gICAgfSlcbiAgfVxuXG4gIC8qKlxuICAgKiBDYW5jZWxzIHRoZSBxdWV1ZWQgb3duZXIgb2YgYSBzdGFibGUgc2NoZWR1bGUga2V5LiBBIGhhbmRlZC1vZmYgb3duZXIgaXNcbiAgICogZGV0YWNoZWQgYnV0IG5vdCBtYXJrZWQgc3RvcHBlZCBiZWNhdXNlIGV4ZWN1dGlvbiBtYXkgYWxyZWFkeSBiZSBydW5uaW5nLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gc2NoZWR1bGVLZXkgLSBTdGFibGUgbG9naWNhbCBzY2hlZHVsZSBrZXkuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPGltcG9ydChcIi4vdHlwZXMuanNcIikuQmFja2dyb3VuZEpvYkNhbmNlbGxhdGlvblJlc3VsdD59IC0gQ2FuY2VsbGF0aW9uIHJlc3VsdC5cbiAgICovXG4gIGFzeW5jIGNhbmNlbFNjaGVkdWxlZChzY2hlZHVsZUtleSkge1xuICAgIGF3YWl0IHRoaXMuZW5zdXJlUmVhZHkoKVxuXG4gICAgY29uc3Qgbm9ybWFsaXplZFNjaGVkdWxlS2V5ID0gdGhpcy5fbm9ybWFsaXplU2NoZWR1bGVLZXkoc2NoZWR1bGVLZXkpXG5cbiAgICByZXR1cm4gYXdhaXQgdGhpcy5fc2VyaWFsaXplZENvdW50TXV0YXRpb24oYXN5bmMgKGRiKSA9PiB7XG4gICAgICBjb25zdCBvd25lclJvd3MgPSBhd2FpdCBkYlxuICAgICAgICAubmV3UXVlcnkoKVxuICAgICAgICAuZnJvbShTQ0hFRFVMRV9LRVlTX1RBQkxFKVxuICAgICAgICAud2hlcmUoe3NjaGVkdWxlX2tleTogbm9ybWFsaXplZFNjaGVkdWxlS2V5fSlcbiAgICAgICAgLmxpbWl0KDEpXG4gICAgICAgIC5yZXN1bHRzKClcblxuICAgICAgaWYgKCFvd25lclJvd3NbMF0pIHJldHVybiB7am9iSWQ6IG51bGwsIG91dGNvbWU6IFwibm90X2ZvdW5kXCJ9XG5cbiAgICAgIGNvbnN0IGpvYklkID0gU3RyaW5nKC8qKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSAqLyAob3duZXJSb3dzWzBdKS5qb2JfaWQpXG4gICAgICBjb25zdCBqb2IgPSBhd2FpdCB0aGlzLl9nZXRKb2JSb3dCeUlkKGRiLCBqb2JJZClcblxuICAgICAgaWYgKGpvYj8uc3RhdHVzID09PSBcInF1ZXVlZFwiKSB7XG4gICAgICAgIGNvbnN0IGFmZmVjdGVkUm93cyA9IGF3YWl0IHRoaXMuX3VwZGF0ZUFmZmVjdGVkUm93cyhkYiwge1xuICAgICAgICAgIHRhYmxlTmFtZTogSk9CU19UQUJMRSxcbiAgICAgICAgICBkYXRhOiB7c3RhdHVzOiBcImNhbmNlbGxlZFwifSxcbiAgICAgICAgICBjb25kaXRpb25zOiB7aWQ6IGpvYi5pZCwgc3RhdHVzOiBcInF1ZXVlZFwifVxuICAgICAgICB9KVxuXG4gICAgICAgIGlmIChhZmZlY3RlZFJvd3MgPT09IDEpIHtcbiAgICAgICAgICBhd2FpdCB0aGlzLl9yZWxlYXNlU2NoZWR1bGVPd25lcnNoaXAoZGIsIHtqb2JJZCwgc2NoZWR1bGVLZXk6IG5vcm1hbGl6ZWRTY2hlZHVsZUtleX0pXG4gICAgICAgICAgYXdhaXQgdGhpcy5fcmVjb3JkU3RhdHVzVHJhbnNpdGlvbihkYiwgXCJxdWV1ZWRcIiwgXCJjYW5jZWxsZWRcIilcblxuICAgICAgICAgIHJldHVybiB7am9iSWQsIG91dGNvbWU6IFwiY2FuY2VsbGVkXCJ9XG4gICAgICAgIH1cbiAgICAgIH1cblxuICAgICAgY29uc3QgY3VycmVudEpvYiA9IGF3YWl0IHRoaXMuX2dldEpvYlJvd0J5SWQoZGIsIGpvYklkKVxuXG4gICAgICBhd2FpdCB0aGlzLl9yZWxlYXNlU2NoZWR1bGVPd25lcnNoaXAoZGIsIHtqb2JJZCwgc2NoZWR1bGVLZXk6IG5vcm1hbGl6ZWRTY2hlZHVsZUtleX0pXG5cbiAgICAgIGlmIChjdXJyZW50Sm9iPy5zdGF0dXMgPT09IFwiaGFuZGVkX29mZlwiKSByZXR1cm4ge2pvYklkLCBvdXRjb21lOiBcImhhbmRlZF9vZmZcIn1cbiAgICAgIHJldHVybiB7am9iSWQ6IG51bGwsIG91dGNvbWU6IFwibm90X2ZvdW5kXCJ9XG4gICAgfSwge1xuICAgICAgYWR2aXNvcnlMb2NrOiB7XG4gICAgICAgIGZhaWx1cmVNZXNzYWdlOiBcIkZhaWxlZCB0byBhY3F1aXJlIGJhY2tncm91bmQgam9iIHNjaGVkdWxlLWtleSBsb2NrXCIsXG4gICAgICAgIG5hbWU6IHRoaXMuX3NjaGVkdWxlS2V5TG9ja05hbWUobm9ybWFsaXplZFNjaGVkdWxlS2V5KVxuICAgICAgfVxuICAgIH0pXG4gIH1cblxuICAvKipcbiAgICogUnVucyBuZXh0IGF2YWlsYWJsZSBqb2IuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBbYXJnc10gLSBPcHRpb25zLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vdHlwZXMuanNcIikuQmFja2dyb3VuZEpvYkV4ZWN1dGlvbk1vZGUgfCBpbXBvcnQoXCIuL3R5cGVzLmpzXCIpLkJhY2tncm91bmRKb2JFeGVjdXRpb25Nb2RlW119IFthcmdzLmV4ZWN1dGlvbk1vZGVdIC0gRXhlY3V0aW9uIG1vZGUgb3IgbW9kZXMgdG8gbWF0Y2guXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPGltcG9ydChcIi4vdHlwZXMuanNcIikuQmFja2dyb3VuZEpvYlJvdyB8IG51bGw+fSAtIE5leHQgam9iLlxuICAgKi9cbiAgYXN5bmMgbmV4dEF2YWlsYWJsZUpvYihhcmdzID0ge30pIHtcbiAgICBhd2FpdCB0aGlzLmVuc3VyZVJlYWR5KClcblxuICAgIHJldHVybiBhd2FpdCB0aGlzLl93aXRoRGIoYXN5bmMgKGRiKSA9PiB7XG4gICAgICByZXR1cm4gYXdhaXQgdGhpcy5fbmV4dFF1ZXVlZEpvYih7XG4gICAgICAgIGRiLFxuICAgICAgICBzY2hlZHVsZWRBdE9wZXJhdG9yOiBcIjw9XCIsXG4gICAgICAgIGV4ZWN1dGlvbk1vZGU6IGFyZ3MuZXhlY3V0aW9uTW9kZVxuICAgICAgfSlcbiAgICB9KVxuICB9XG5cbiAgLyoqXG4gICAqIFJldHVybnMgdGhlIHNvb25lc3QgZnV0dXJlLXNjaGVkdWxlZCBxdWV1ZWQgam9iIChvbmUgd2hvc2VcbiAgICogYHNjaGVkdWxlZF9hdF9tc2AgaXMgaW4gdGhlIGZ1dHVyZSksIG9yIG51bGwgd2hlbiB0aGVyZSBhcmUgbm9cbiAgICogZnV0dXJlLXNjaGVkdWxlZCBqb2JzLiBVc2VkIGJ5IHRoZSBldmVudC1kcml2ZW4gZGlzcGF0Y2hlciB0byBhcm0gYVxuICAgKiBgc2V0VGltZW91dGAgZm9yIHRoZSBleGFjdCBtb21lbnQgdGhlIG5leHQgc2NoZWR1bGVkIGpvYiBiZWNvbWVzXG4gICAqIGVsaWdpYmxlLCByZXBsYWNpbmcgdGhlIGxlZ2FjeSAxLXNlY29uZCBwb2xsaW5nIGxvb3AuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPGltcG9ydChcIi4vdHlwZXMuanNcIikuQmFja2dyb3VuZEpvYlJvdyB8IG51bGw+fSAtIFNvb25lc3QgZnV0dXJlLXNjaGVkdWxlZCBqb2IsIG9yIG51bGwuXG4gICAqL1xuICBhc3luYyBuZXh0U2NoZWR1bGVkSm9iKCkge1xuICAgIGF3YWl0IHRoaXMuZW5zdXJlUmVhZHkoKVxuXG4gICAgcmV0dXJuIGF3YWl0IHRoaXMuX3dpdGhEYihhc3luYyAoZGIpID0+IHtcbiAgICAgIHJldHVybiBhd2FpdCB0aGlzLl9uZXh0UXVldWVkSm9iKHtkYiwgc2NoZWR1bGVkQXRPcGVyYXRvcjogXCI+XCJ9KVxuICAgIH0pXG4gIH1cblxuICAvKipcbiAgICogUnVucyBuZXh0IHF1ZXVlZCBqb2IuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gT3B0aW9ucy5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9kYXRhYmFzZS9kcml2ZXJzL2Jhc2UuanNcIikuZGVmYXVsdH0gYXJncy5kYiAtIERhdGFiYXNlIGNvbm5lY3Rpb24uXG4gICAqIEBwYXJhbSB7XCI8PVwiIHwgXCI+XCJ9IGFyZ3Muc2NoZWR1bGVkQXRPcGVyYXRvciAtIFNjaGVkdWxlZCB0aW1lc3RhbXAgb3BlcmF0b3IuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi90eXBlcy5qc1wiKS5CYWNrZ3JvdW5kSm9iRXhlY3V0aW9uTW9kZSB8IGltcG9ydChcIi4vdHlwZXMuanNcIikuQmFja2dyb3VuZEpvYkV4ZWN1dGlvbk1vZGVbXX0gW2FyZ3MuZXhlY3V0aW9uTW9kZV0gLSBFeGVjdXRpb24gbW9kZSBvciBtb2RlcyB0byBtYXRjaC5cbiAgICogQHJldHVybnMge1Byb21pc2U8aW1wb3J0KFwiLi90eXBlcy5qc1wiKS5CYWNrZ3JvdW5kSm9iUm93IHwgbnVsbD59IC0gTmV4dCBtYXRjaGluZyBxdWV1ZWQgam9iLlxuICAgKi9cbiAgYXN5bmMgX25leHRRdWV1ZWRKb2Ioe2RiLCBzY2hlZHVsZWRBdE9wZXJhdG9yLCBleGVjdXRpb25Nb2RlfSkge1xuICAgIGNvbnN0IG5vdyA9IHRoaXMuY2xvY2subm93KClcbiAgICBsZXQgcXVlcnkgPSBkYlxuICAgICAgLm5ld1F1ZXJ5KClcbiAgICAgIC5mcm9tKEpPQlNfVEFCTEUpXG4gICAgICAud2hlcmUoe3N0YXR1czogXCJxdWV1ZWRcIn0pXG4gICAgICAud2hlcmUoYHNjaGVkdWxlZF9hdF9tcyAke3NjaGVkdWxlZEF0T3BlcmF0b3J9ICR7ZGIucXVvdGUobm93KX1gKVxuXG4gICAgaWYgKHNjaGVkdWxlZEF0T3BlcmF0b3IgPT09IFwiPD1cIikge1xuICAgICAgY29uc3Qgam9ic1RhYmxlID0gZGIucXVvdGVUYWJsZShKT0JTX1RBQkxFKVxuICAgICAgY29uc3QgY29uY3VycmVuY3lUYWJsZSA9IGRiLnF1b3RlVGFibGUoQ09OQ1VSUkVOQ1lfVEFCTEUpXG4gICAgICBxdWVyeSA9IHF1ZXJ5LndoZXJlKFxuICAgICAgICBgKCR7am9ic1RhYmxlfS4ke2RiLnF1b3RlQ29sdW1uKFwiY29uY3VycmVuY3lfa2V5XCIpfSBJUyBOVUxMIE9SIEVYSVNUUyAoYCArXG4gICAgICAgIGBTRUxFQ1QgMSBGUk9NICR7Y29uY3VycmVuY3lUYWJsZX0gV0hFUkUgYCArXG4gICAgICAgIGAke2NvbmN1cnJlbmN5VGFibGV9LiR7ZGIucXVvdGVDb2x1bW4oXCJjb25jdXJyZW5jeV9rZXlcIil9ID0gJHtqb2JzVGFibGV9LiR7ZGIucXVvdGVDb2x1bW4oXCJjb25jdXJyZW5jeV9rZXlcIil9IEFORCBgICtcbiAgICAgICAgYCR7Y29uY3VycmVuY3lUYWJsZX0uJHtkYi5xdW90ZUNvbHVtbihcImFjdGl2ZV9jb3VudFwiKX0gPCAke2NvbmN1cnJlbmN5VGFibGV9LiR7ZGIucXVvdGVDb2x1bW4oXCJtYXhfY29uY3VycmVuY3lcIil9KSlgXG4gICAgICApXG4gICAgfVxuXG4gICAgaWYgKGV4ZWN1dGlvbk1vZGUpIHF1ZXJ5ID0gdGhpcy5fd2hlcmVFeGVjdXRpb25Nb2RlKHtkYiwgZXhlY3V0aW9uTW9kZSwgcXVlcnl9KVxuXG4gICAgaWYgKHNjaGVkdWxlZEF0T3BlcmF0b3IgPT09IFwiPD1cIikge1xuICAgICAgY29uc3QgcHJpb3JpdHlPcmRlciA9IHRoaXMuX3F1ZXVlUHJpb3JpdHlPcmRlclNxbChkYilcblxuICAgICAgaWYgKHByaW9yaXR5T3JkZXIpIHF1ZXJ5ID0gcXVlcnkub3JkZXIoYCR7cHJpb3JpdHlPcmRlcn0gREVTQ2ApXG4gICAgfVxuXG4gICAgcXVlcnkgPSBxdWVyeVxuICAgICAgLm9yZGVyKFwic2NoZWR1bGVkX2F0X21zIEFTQ1wiKVxuICAgICAgLm9yZGVyKFwiY3JlYXRlZF9hdF9tcyBBU0NcIilcbiAgICAgIC5saW1pdCgxKVxuXG4gICAgY29uc3Qgcm93cyA9IGF3YWl0IHF1ZXJ5LnJlc3VsdHMoKVxuICAgIGNvbnN0IHJvdyA9IHJvd3NbMF1cblxuICAgIGlmICghcm93KSByZXR1cm4gbnVsbFxuXG4gICAgcmV0dXJuIHRoaXMuX25vcm1hbGl6ZUpvYlJvdyhyb3cpXG4gIH1cblxuICAvKipcbiAgICogQnVpbGRzIGEgcmF3IFNRTCBPUkRFUiBCWSBleHByZXNzaW9uIHJhbmtpbmcgcXVldWVkIGpvYnMgYnkgdGhlaXIgcXVldWUnc1xuICAgKiBjb25maWd1cmVkIHByaW9yaXR5IChgYmFja2dyb3VuZEpvYnMucXVldWVzW3F1ZXVlXS5wcmlvcml0eWAsIGRlZmF1bHQgYDBgKSxcbiAgICogc28gdGhlIGRpc3BhdGNoZXIgcGlja3MgaGlnaGVyLXByaW9yaXR5IHF1ZXVlcyBmaXJzdCByZWdhcmRsZXNzIG9mIGVucXVldWVcbiAgICogb3JkZXIuIE9ubHkgYXBwbGllZCB0byB0aGUgZGlzcGF0Y2ggcGF0aCAoYHNjaGVkdWxlZEF0T3BlcmF0b3IgPT09IFwiPD1cImApO1xuICAgKiB0aGUgZnV0dXJlLXNjaGVkdWxlZCBsb29rdXAgbXVzdCBzdGF5IHN0cmljdGx5IHRpbWUtb3JkZXJlZC4gQ29tcG9zZXMgd2l0aFxuICAgKiB0aGUgY29uY3VycmVuY3kgRVhJU1RTIGZpbHRlcjogYSBoaWdoZXItcHJpb3JpdHkgcXVldWUgYWxyZWFkeSBhdCBpdHMgY2FwIGlzXG4gICAqIGZpbHRlcmVkIG91dCwgc28gZGlzcGF0Y2ggZmFsbHMgdGhyb3VnaCB0byB0aGUgbmV4dCBlbGlnaWJsZSBsb3dlci1wcmlvcml0eVxuICAgKiBqb2IuIFJldHVybnMgbnVsbCB3aGVuIG5vIHF1ZXVlIGNvbmZpZ3VyZXMgYSBub24temVybyBwcmlvcml0eSBzbyB0aGUgcGxhaW5cbiAgICogRklGTyBvcmRlcmluZyBpcyBsZWZ0IHVudG91Y2hlZCAoYW5kIG5vIG5lZWRsZXNzIGZpbGVzb3J0IGlzIGludHJvZHVjZWQpLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL2RhdGFiYXNlL2RyaXZlcnMvYmFzZS5qc1wiKS5kZWZhdWx0fSBkYiAtIERhdGFiYXNlIGNvbm5lY3Rpb24uXG4gICAqIEByZXR1cm5zIHtzdHJpbmcgfCBudWxsfSAtIFJhdyBTUUwgQ0FTRSBleHByZXNzaW9uLCBvciBudWxsIHdoZW4gbm8gcXVldWUgaXMgcHJpb3JpdGl6ZWQuXG4gICAqL1xuICBfcXVldWVQcmlvcml0eU9yZGVyU3FsKGRiKSB7XG4gICAgY29uc3QgcXVldWVzID0gdGhpcy5jb25maWd1cmF0aW9uLmdldEJhY2tncm91bmRKb2JzQ29uZmlnKCkucXVldWVzIHx8IHt9XG4gICAgLyoqIEB0eXBlIHtBcnJheTxbc3RyaW5nLCBudW1iZXJdPn0gKi9cbiAgICBjb25zdCBwcmlvcml0aXplZCA9IFtdXG5cbiAgICBmb3IgKGNvbnN0IFtxdWV1ZSwgcXVldWVDb25maWddIG9mIE9iamVjdC5lbnRyaWVzKHF1ZXVlcykpIHtcbiAgICAgIGNvbnN0IHByaW9yaXR5ID0gcXVldWVDb25maWc/LnByaW9yaXR5XG5cbiAgICAgIGlmIChOdW1iZXIuaXNGaW5pdGUocHJpb3JpdHkpICYmIE51bWJlcihwcmlvcml0eSkgIT09IDApIHByaW9yaXRpemVkLnB1c2goW3F1ZXVlLCBOdW1iZXIocHJpb3JpdHkpXSlcbiAgICB9XG5cbiAgICBpZiAocHJpb3JpdGl6ZWQubGVuZ3RoID09PSAwKSByZXR1cm4gbnVsbFxuXG4gICAgY29uc3QgcXVldWVDb2x1bW4gPSBkYi5xdW90ZUNvbHVtbihcInF1ZXVlXCIpXG4gICAgY29uc3Qgd2hlbnMgPSBwcmlvcml0aXplZFxuICAgICAgLm1hcCgoW3F1ZXVlLCBwcmlvcml0eV0pID0+IGBXSEVOICR7ZGIucXVvdGUocXVldWUpfSBUSEVOICR7cHJpb3JpdHl9YClcbiAgICAgIC5qb2luKFwiIFwiKVxuXG4gICAgcmV0dXJuIGBDQVNFIENPQUxFU0NFKCR7cXVldWVDb2x1bW59LCAke2RiLnF1b3RlKERFRkFVTFRfQkFDS0dST1VORF9KT0JfUVVFVUUpfSkgJHt3aGVuc30gRUxTRSAwIEVORGBcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGdldCBqb2IuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBqb2JJZCAtIEpvYiBpZC5cbiAgICogQHJldHVybnMge1Byb21pc2U8aW1wb3J0KFwiLi90eXBlcy5qc1wiKS5CYWNrZ3JvdW5kSm9iUm93IHwgbnVsbD59IC0gSm9iIHJvdy5cbiAgICovXG4gIGFzeW5jIGdldEpvYihqb2JJZCkge1xuICAgIGF3YWl0IHRoaXMuZW5zdXJlUmVhZHkoKVxuXG4gICAgcmV0dXJuIGF3YWl0IHRoaXMuX3dpdGhEYihhc3luYyAoZGIpID0+IHtcbiAgICAgIGNvbnN0IHF1ZXJ5ID0gZGJcbiAgICAgICAgLm5ld1F1ZXJ5KClcbiAgICAgICAgLmZyb20oSk9CU19UQUJMRSlcbiAgICAgICAgLndoZXJlKHtpZDogam9iSWR9KVxuICAgICAgICAubGltaXQoMSlcblxuICAgICAgY29uc3Qgcm93cyA9IGF3YWl0IHF1ZXJ5LnJlc3VsdHMoKVxuICAgICAgY29uc3Qgcm93ID0gcm93c1swXVxuXG4gICAgICBpZiAoIXJvdykgcmV0dXJuIG51bGxcblxuICAgICAgcmV0dXJuIHRoaXMuX25vcm1hbGl6ZUpvYlJvdyhyb3cpXG4gICAgfSlcbiAgfVxuXG4gIC8qKlxuICAgKiBDb3VudHMgam9icyBncm91cGVkIGJ5IHN0YXR1cy4gVXNlZCBieSB0aGUgZGFzaGJvYXJkIG92ZXJ2aWV3LlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxSZWNvcmQ8c3RyaW5nLCBudW1iZXI+Pn0gLSBDb3VudHMga2V5ZWQgYnkgc3RhdHVzLlxuICAgKi9cbiAgYXN5bmMgY291bnRzQnlTdGF0dXMoKSB7XG4gICAgYXdhaXQgdGhpcy5lbnN1cmVSZWFkeSgpXG5cbiAgICByZXR1cm4gYXdhaXQgdGhpcy5fd2l0aERiKGFzeW5jIChkYikgPT4ge1xuICAgICAgY29uc3Qgcm93cyA9IGF3YWl0IGRiXG4gICAgICAgIC5uZXdRdWVyeSgpXG4gICAgICAgIC5mcm9tKEpPQlNfVEFCTEUpXG4gICAgICAgIC5zZWxlY3QoXCJzdGF0dXNcIilcbiAgICAgICAgLnNlbGVjdChcIkNPVU5UKCopIEFTIGNvdW50XCIpXG4gICAgICAgIC5ncm91cChcInN0YXR1c1wiKVxuICAgICAgICAucmVzdWx0cygpXG5cbiAgICAgIC8qKlxuICAgICAgICogQ291bnRzLlxuICAgICAgICogQHR5cGUge1JlY29yZDxzdHJpbmcsIG51bWJlcj59ICovXG4gICAgICBjb25zdCBjb3VudHMgPSB7fVxuXG4gICAgICBmb3IgKGNvbnN0IHJvdyBvZiByb3dzKSB7XG4gICAgICAgIGNvbnN0IHR5cGVkUm93ID0gLyoqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59ICovIChyb3cpXG5cbiAgICAgICAgY291bnRzW1N0cmluZyh0eXBlZFJvdy5zdGF0dXMpXSA9IHRoaXMuX25vcm1hbGl6ZU51bWJlcih0eXBlZFJvdy5jb3VudCkgfHwgMFxuICAgICAgfVxuXG4gICAgICByZXR1cm4gY291bnRzXG4gICAgfSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSZXR1cm5zIHRoZSBhdXRob3JpdGF0aXZlIGRhc2hib2FyZCBjb3VudCBzbmFwc2hvdCBhbmQgaXRzIG1hdGNoaW5nIGR1cmFibGVcbiAgICogcmV2aXNpb24uIExvY2tpbmcgdGhlIHJldmlzaW9uIHJvdyBiZWZvcmUgY291bnRpbmcgcHJldmVudHMgYSB3cml0ZXIgZnJvbVxuICAgKiBjb21taXR0aW5nIGJldHdlZW4gdGhlIGNvdW50IHF1ZXJ5IGFuZCByZXZpc2lvbiByZWFkLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx7Y291bnRzOiBSZWNvcmQ8c3RyaW5nLCBudW1iZXI+LCByZXZpc2lvbjogbnVtYmVyLCB0b3RhbDogbnVtYmVyfT59IFNuYXBzaG90LlxuICAgKi9cbiAgYXN5bmMgY291bnRTbmFwc2hvdCgpIHtcbiAgICBhd2FpdCB0aGlzLmVuc3VyZVJlYWR5KClcblxuICAgIHJldHVybiBhd2FpdCB0aGlzLl9zZXJpYWxpemVkQ291bnRNdXRhdGlvbihhc3luYyAoZGIpID0+IHtcbiAgICAgIHJldHVybiBhd2FpdCB0aGlzLl9jb3VudFNuYXBzaG90T25Mb2NrZWRDb25uZWN0aW9uKGRiKVxuICAgIH0pXG4gIH1cblxuICAvKipcbiAgICogQ291bnRzIGpvYnMgbWF0Y2hpbmcgdGhlIGdpdmVuIGZpbHRlcnMuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBbYXJnc10gLSBPcHRpb25zLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gW2FyZ3Muc3RhdHVzXSAtIEZpbHRlciBieSBzdGF0dXMuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBbYXJncy5qb2JOYW1lXSAtIEZpbHRlciBieSBqb2IgbmFtZS5cbiAgICogQHJldHVybnMge1Byb21pc2U8bnVtYmVyPn0gLSBNYXRjaGluZyBqb2IgY291bnQuXG4gICAqL1xuICBhc3luYyBjb3VudEpvYnMoe3N0YXR1cywgam9iTmFtZX0gPSB7fSkge1xuICAgIGF3YWl0IHRoaXMuZW5zdXJlUmVhZHkoKVxuXG4gICAgcmV0dXJuIGF3YWl0IHRoaXMuX3dpdGhEYihhc3luYyAoZGIpID0+IHtcbiAgICAgIGxldCBxdWVyeSA9IGRiLm5ld1F1ZXJ5KCkuZnJvbShKT0JTX1RBQkxFKS5zZWxlY3QoXCJDT1VOVCgqKSBBUyBjb3VudFwiKVxuXG4gICAgICBpZiAoc3RhdHVzKSBxdWVyeSA9IHF1ZXJ5LndoZXJlKHtzdGF0dXN9KVxuICAgICAgaWYgKGpvYk5hbWUpIHF1ZXJ5ID0gcXVlcnkud2hlcmUoe2pvYl9uYW1lOiBqb2JOYW1lfSlcblxuICAgICAgY29uc3Qgcm93cyA9IGF3YWl0IHF1ZXJ5LnJlc3VsdHMoKVxuICAgICAgY29uc3QgY291bnRSb3cgPSAvKiogQHR5cGUge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gKi8gKHJvd3NbMF0gfHwge30pXG5cbiAgICAgIHJldHVybiB0aGlzLl9ub3JtYWxpemVOdW1iZXIoY291bnRSb3cuY291bnQpIHx8IDBcbiAgICB9KVxuICB9XG5cbiAgLyoqXG4gICAqIExpc3RzIGpvYnMgZm9yIHRoZSBkYXNoYm9hcmQsIGZpbHRlcmVkLCBzb3J0ZWQgYW5kIHBhZ2luYXRlZC5cbiAgICogQHBhcmFtIHtvYmplY3R9IFthcmdzXSAtIE9wdGlvbnMuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBbYXJncy5zdGF0dXNdIC0gRmlsdGVyIGJ5IHN0YXR1cy5cbiAgICogQHBhcmFtIHtzdHJpbmd9IFthcmdzLmpvYk5hbWVdIC0gRmlsdGVyIGJ5IGpvYiBuYW1lLlxuICAgKiBAcGFyYW0ge251bWJlcn0gW2FyZ3MubGltaXRdIC0gTWF4aW11bSByb3dzIHRvIHJldHVybi5cbiAgICogQHBhcmFtIHtudW1iZXJ9IFthcmdzLm9mZnNldF0gLSBSb3dzIHRvIHNraXAuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBbYXJncy5zb3J0Q29sdW1uXSAtIENhbWVsLWNhc2VkIGNvbHVtbiB0byBzb3J0IGJ5IChzZWUgU09SVEFCTEVfQ09MVU1OUykuXG4gICAqIEBwYXJhbSB7XCJBU0NcIiB8IFwiREVTQ1wifSBbYXJncy5zb3J0RGlyZWN0aW9uXSAtIFNvcnQgZGlyZWN0aW9uLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxpbXBvcnQoXCIuL3R5cGVzLmpzXCIpLkJhY2tncm91bmRKb2JSb3dbXT59IC0gTm9ybWFsaXplZCBqb2Igcm93cy5cbiAgICovXG4gIGFzeW5jIGxpc3RKb2JzKHtzdGF0dXMsIGpvYk5hbWUsIGxpbWl0ID0gMjUsIG9mZnNldCA9IDAsIHNvcnRDb2x1bW4gPSBcImNyZWF0ZWRBdE1zXCIsIHNvcnREaXJlY3Rpb24gPSBcIkRFU0NcIn0gPSB7fSkge1xuICAgIGF3YWl0IHRoaXMuZW5zdXJlUmVhZHkoKVxuXG4gICAgY29uc3QgY29sdW1uID0gU09SVEFCTEVfQ09MVU1OU1tzb3J0Q29sdW1uXSB8fCBTT1JUQUJMRV9DT0xVTU5TLmNyZWF0ZWRBdE1zXG4gICAgY29uc3QgZGlyZWN0aW9uID0gc29ydERpcmVjdGlvbiA9PT0gXCJBU0NcIiA/IFwiQVNDXCIgOiBcIkRFU0NcIlxuXG4gICAgcmV0dXJuIGF3YWl0IHRoaXMuX3dpdGhEYihhc3luYyAoZGIpID0+IHtcbiAgICAgIGxldCBxdWVyeSA9IGRiLm5ld1F1ZXJ5KCkuZnJvbShKT0JTX1RBQkxFKVxuXG4gICAgICBpZiAoc3RhdHVzKSBxdWVyeSA9IHF1ZXJ5LndoZXJlKHtzdGF0dXN9KVxuICAgICAgaWYgKGpvYk5hbWUpIHF1ZXJ5ID0gcXVlcnkud2hlcmUoe2pvYl9uYW1lOiBqb2JOYW1lfSlcblxuICAgICAgcXVlcnkgPSBxdWVyeS5vcmRlcih7Y29sdW1uLCBkaXJlY3Rpb259KVxuICAgICAgaWYgKGNvbHVtbiAhPT0gU09SVEFCTEVfQ09MVU1OUy5jcmVhdGVkQXRNcykgcXVlcnkgPSBxdWVyeS5vcmRlcih7Y29sdW1uOiBTT1JUQUJMRV9DT0xVTU5TLmNyZWF0ZWRBdE1zLCBkaXJlY3Rpb246IFwiREVTQ1wifSlcblxuICAgICAgY29uc3Qgcm93cyA9IGF3YWl0IHF1ZXJ5LmxpbWl0KGxpbWl0KS5vZmZzZXQob2Zmc2V0KS5yZXN1bHRzKClcblxuICAgICAgcmV0dXJuIHJvd3MubWFwKChyb3cpID0+IHRoaXMuX25vcm1hbGl6ZUpvYlJvdyhyb3cpKVxuICAgIH0pXG4gIH1cblxuICAvKipcbiAgICogUnVucyBtYXJrIGhhbmRlZCBvZmYuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gT3B0aW9ucy5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGFyZ3Muam9iSWQgLSBKb2IgaWQuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBbYXJncy5oYW5kb2ZmSWRdIC0gQ2FsbGVyLXNlbGVjdGVkIGV4YWN0IGxlYXNlIGlkLiBHZW5lcmF0ZWQgZm9yIGxlZ2FjeSBkaXJlY3QgY2FsbGVycyB3aGVuIG9taXR0ZWQuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBbYXJncy53b3JrZXJJZF0gLSBXb3JrZXIgaWQuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPGltcG9ydChcIi4vdHlwZXMuanNcIikuQmFja2dyb3VuZEpvYkhhbmRvZmYgfCBudWxsPn0gLSBDbGFpbWVkIGhhbmRvZmYgbGVhc2UsIG9yIG51bGwgd2hlbiBubyBsb25nZXIgcXVldWVkLlxuICAgKi9cbiAgYXN5bmMgbWFya0hhbmRlZE9mZih7am9iSWQsIGhhbmRvZmZJZCA9IHJhbmRvbVVVSUQoKSwgd29ya2VySWR9KSB7XG4gICAgYXdhaXQgdGhpcy5lbnN1cmVSZWFkeSgpXG5cbiAgICBjb25zdCBoYW5kZWRPZmZBdE1zID0gdGhpcy5jbG9jay5ub3coKVxuXG4gICAgcmV0dXJuIGF3YWl0IHRoaXMuX3NlcmlhbGl6ZWRDb3VudE11dGF0aW9uKGFzeW5jIChkYikgPT4ge1xuICAgICAgY29uc3Qgc2VsZWN0ZWRKb2IgPSBhd2FpdCB0aGlzLl9nZXRKb2JSb3dCeUlkKGRiLCBqb2JJZClcbiAgICAgIGlmICghc2VsZWN0ZWRKb2IgfHwgc2VsZWN0ZWRKb2Iuc3RhdHVzICE9PSBcInF1ZXVlZFwiKSByZXR1cm4gbnVsbFxuICAgICAgY29uc3QgcXVldWVkSm9iID0gYXdhaXQgdGhpcy5fcmVjb25jaWxlUXVldWVkSm9iQ29uY3VycmVuY3koZGIsIHNlbGVjdGVkSm9iKVxuXG4gICAgICBpZiAoIXF1ZXVlZEpvYikgcmV0dXJuIG51bGxcbiAgICAgIGlmIChxdWV1ZWRKb2IuY29uY3VycmVuY3lLZXkgJiYgIShhd2FpdCB0aGlzLl9yZXNlcnZlQ29uY3VycmVuY3koZGIsIHF1ZXVlZEpvYi5jb25jdXJyZW5jeUtleSkpKSByZXR1cm4gbnVsbFxuICAgICAgY29uc3QgYWZmZWN0ZWRSb3dzID0gYXdhaXQgdGhpcy5fdXBkYXRlQWZmZWN0ZWRSb3dzKGRiLCB7XG4gICAgICAgIHRhYmxlTmFtZTogSk9CU19UQUJMRSxcbiAgICAgICAgZGF0YToge1xuICAgICAgICAgIHN0YXR1czogXCJoYW5kZWRfb2ZmXCIsXG4gICAgICAgICAgaGFuZGVkX29mZl9hdF9tczogaGFuZGVkT2ZmQXRNcyxcbiAgICAgICAgICBoYW5kb2ZmX2lkOiBoYW5kb2ZmSWQsXG4gICAgICAgICAgd29ya2VyX2lkOiB3b3JrZXJJZCB8fCBudWxsXG4gICAgICAgIH0sXG4gICAgICAgIGNvbmRpdGlvbnM6IHtjb25jdXJyZW5jeV9rZXk6IHF1ZXVlZEpvYi5jb25jdXJyZW5jeUtleSwgaWQ6IGpvYklkLCBzdGF0dXM6IFwicXVldWVkXCJ9XG4gICAgICB9KVxuXG4gICAgICBpZiAoYWZmZWN0ZWRSb3dzICE9PSAxKSB7XG4gICAgICAgIGF3YWl0IHRoaXMuX3JlbGVhc2VDb25jdXJyZW5jeShkYiwgcXVldWVkSm9iLmNvbmN1cnJlbmN5S2V5KVxuICAgICAgICByZXR1cm4gbnVsbFxuICAgICAgfVxuXG4gICAgICBhd2FpdCB0aGlzLl9yZWNvcmRTdGF0dXNUcmFuc2l0aW9uKGRiLCBcInF1ZXVlZFwiLCBcImhhbmRlZF9vZmZcIilcbiAgICAgIC8qKiBAdHlwZSB7aW1wb3J0KFwiLi90eXBlcy5qc1wiKS5CYWNrZ3JvdW5kSm9iUm93fSAqL1xuICAgICAgY29uc3QgaGFuZGVkT2ZmSm9iID0ge1xuICAgICAgICAuLi5xdWV1ZWRKb2IsXG4gICAgICAgIGhhbmRlZE9mZkF0TXMsXG4gICAgICAgIGhhbmRvZmZJZCxcbiAgICAgICAgc3RhdHVzOiBcImhhbmRlZF9vZmZcIixcbiAgICAgICAgd29ya2VySWQ6IHdvcmtlcklkIHx8IG51bGxcbiAgICAgIH1cblxuICAgICAgcmV0dXJuIHtoYW5kZWRPZmZBdE1zLCBoYW5kb2ZmSWQsIGpvYjogaGFuZGVkT2ZmSm9ifVxuICAgIH0pXG4gIH1cblxuICAvKipcbiAgICogUnVucyBtYXJrIGNvbXBsZXRlZC5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBPcHRpb25zLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gYXJncy5qb2JJZCAtIEpvYiBpZC5cbiAgICogQHBhcmFtIHtzdHJpbmd9IFthcmdzLmhhbmRvZmZJZF0gLSBIYW5kb2ZmIGxlYXNlIGlkLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gW2FyZ3Mud29ya2VySWRdIC0gV29ya2VyIGlkLlxuICAgKiBAcGFyYW0ge251bWJlcn0gW2FyZ3MuaGFuZGVkT2ZmQXRNc10gLSBIYW5kZWQgb2ZmIHRpbWVzdGFtcC5cbiAgICogQHJldHVybnMge1Byb21pc2U8Ym9vbGVhbj59IC0gV2hldGhlciB0aGUgZmVuY2VkIHJlcG9ydCB3YXMgYWNjZXB0ZWQuXG4gICAqL1xuICBhc3luYyBtYXJrQ29tcGxldGVkKHtqb2JJZCwgaGFuZG9mZklkLCB3b3JrZXJJZCwgaGFuZGVkT2ZmQXRNc30pIHtcbiAgICBhd2FpdCB0aGlzLmVuc3VyZVJlYWR5KClcblxuICAgIHJldHVybiBhd2FpdCB0aGlzLl9zZXJpYWxpemVkQ291bnRNdXRhdGlvbihhc3luYyAoZGIpID0+IHtcbiAgICAgIGNvbnN0IGpvYiA9IGF3YWl0IHRoaXMuX2dldEpvYlJvd0J5SWQoZGIsIGpvYklkKVxuXG4gICAgICBpZiAoIWpvYikgcmV0dXJuIGZhbHNlXG4gICAgICBpZiAoIXRoaXMuX3Nob3VsZEFjY2VwdFJlcG9ydCh7am9iLCBoYW5kb2ZmSWQsIHdvcmtlcklkLCBoYW5kZWRPZmZBdE1zfSkpIHJldHVybiBmYWxzZVxuXG4gICAgICBhd2FpdCB0aGlzLl9sb2NrQ29uY3VycmVuY3lSb3coZGIsIGpvYi5jb25jdXJyZW5jeUtleSlcbiAgICAgIGNvbnN0IGFmZmVjdGVkUm93cyA9IGF3YWl0IHRoaXMuX3VwZGF0ZUFmZmVjdGVkUm93cyhkYiwge1xuICAgICAgICB0YWJsZU5hbWU6IEpPQlNfVEFCTEUsXG4gICAgICAgIGRhdGE6IHtcbiAgICAgICAgICBzdGF0dXM6IFwiY29tcGxldGVkXCIsXG4gICAgICAgICAgY29tcGxldGVkX2F0X21zOiB0aGlzLmNsb2NrLm5vdygpXG4gICAgICAgIH0sXG4gICAgICAgIGNvbmRpdGlvbnM6IHRoaXMuX2FjdGl2ZUhhbmRvZmZDb25kaXRpb25zKGpvYilcbiAgICAgIH0pXG5cbiAgICAgIGlmIChhZmZlY3RlZFJvd3MgIT09IDEpIHJldHVybiBmYWxzZVxuICAgICAgYXdhaXQgdGhpcy5fcmVsZWFzZVNjaGVkdWxlT3duZXJzaGlwRm9ySm9iKGRiLCBqb2IpXG4gICAgICBhd2FpdCB0aGlzLl9yZWxlYXNlQ29uY3VycmVuY3koZGIsIGpvYi5jb25jdXJyZW5jeUtleSlcbiAgICAgIGF3YWl0IHRoaXMuX3JlY29yZFN0YXR1c1RyYW5zaXRpb24oZGIsIFwiaGFuZGVkX29mZlwiLCBcImNvbXBsZXRlZFwiKVxuICAgICAgcmV0dXJuIHRydWVcbiAgICB9KVxuICB9XG5cbiAgLyoqXG4gICAqIFJldHVybnMgYW4gYWN0aXZlIGhhbmRvZmYgdG8gdGhlIHF1ZXVlIGF0IGEgY2FsbGVyLXJlcXVlc3RlZCBmdXR1cmUgdGltZS5cbiAgICogVGhpcyBpcyBub3JtYWwgam9iIGNvbnRyb2wgZmxvdzogaXQgcHJlc2VydmVzIGZhaWx1cmUgYXR0ZW1wdHMgYW5kIG1ldGFkYXRhLlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIE9wdGlvbnMuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBhcmdzLmpvYklkIC0gSm9iIGlkLlxuICAgKiBAcGFyYW0ge251bWJlcn0gYXJncy5kZWxheU1zIC0gRGVsYXkgZnJvbSBwZXJzaXN0ZW5jZSB0aW1lIGluIG1pbGxpc2Vjb25kcy5cbiAgICogQHBhcmFtIHtzdHJpbmd9IFthcmdzLmhhbmRvZmZJZF0gLSBIYW5kb2ZmIGxlYXNlIGlkLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gW2FyZ3Mud29ya2VySWRdIC0gV29ya2VyIGlkLlxuICAgKiBAcGFyYW0ge251bWJlcn0gW2FyZ3MuaGFuZGVkT2ZmQXRNc10gLSBIYW5kZWQgb2ZmIHRpbWVzdGFtcC5cbiAgICogQHJldHVybnMge1Byb21pc2U8Ym9vbGVhbj59IC0gV2hldGhlciB0aGUgZmVuY2VkIHJlcG9ydCB3YXMgYWNjZXB0ZWQuXG4gICAqL1xuICBhc3luYyBtYXJrUmVzY2hlZHVsZWQoe2pvYklkLCBkZWxheU1zLCBoYW5kb2ZmSWQsIHdvcmtlcklkLCBoYW5kZWRPZmZBdE1zfSkge1xuICAgIGF3YWl0IHRoaXMuZW5zdXJlUmVhZHkoKVxuICAgIHRoaXMuX3ZhbGlkYXRlUmVzY2hlZHVsZURlbGF5TXMoZGVsYXlNcylcblxuICAgIHJldHVybiBhd2FpdCB0aGlzLl9zZXJpYWxpemVkQ291bnRNdXRhdGlvbihhc3luYyAoZGIpID0+IHtcbiAgICAgIGNvbnN0IGpvYiA9IGF3YWl0IHRoaXMuX2dldEpvYlJvd0J5SWQoZGIsIGpvYklkKVxuXG4gICAgICBpZiAoIWpvYikgcmV0dXJuIGZhbHNlXG4gICAgICBpZiAoIXRoaXMuX3Nob3VsZEFjY2VwdFJlcG9ydCh7am9iLCBoYW5kb2ZmSWQsIHdvcmtlcklkLCBoYW5kZWRPZmZBdE1zfSkpIHJldHVybiBmYWxzZVxuXG4gICAgICBhd2FpdCB0aGlzLl9sb2NrQ29uY3VycmVuY3lSb3coZGIsIGpvYi5jb25jdXJyZW5jeUtleSlcbiAgICAgIGNvbnN0IHNjaGVkdWxlZEF0TXMgPSB0aGlzLl9yZXNjaGVkdWxlZEF0TXMoZGVsYXlNcylcbiAgICAgIGNvbnN0IGFmZmVjdGVkUm93cyA9IGF3YWl0IHRoaXMuX3VwZGF0ZUFmZmVjdGVkUm93cyhkYiwge1xuICAgICAgICB0YWJsZU5hbWU6IEpPQlNfVEFCTEUsXG4gICAgICAgIGRhdGE6IHtcbiAgICAgICAgICBzdGF0dXM6IFwicXVldWVkXCIsXG4gICAgICAgICAgc2NoZWR1bGVkX2F0X21zOiBzY2hlZHVsZWRBdE1zLFxuICAgICAgICAgIGhhbmRlZF9vZmZfYXRfbXM6IG51bGwsXG4gICAgICAgICAgaGFuZG9mZl9pZDogbnVsbCxcbiAgICAgICAgICB3b3JrZXJfaWQ6IG51bGxcbiAgICAgICAgfSxcbiAgICAgICAgY29uZGl0aW9uczogdGhpcy5fYWN0aXZlSGFuZG9mZkNvbmRpdGlvbnMoam9iKVxuICAgICAgfSlcblxuICAgICAgaWYgKGFmZmVjdGVkUm93cyAhPT0gMSkgcmV0dXJuIGZhbHNlXG4gICAgICBhd2FpdCB0aGlzLl9yZWxlYXNlQ29uY3VycmVuY3koZGIsIGpvYi5jb25jdXJyZW5jeUtleSlcbiAgICAgIGF3YWl0IHRoaXMuX3JlY29yZFN0YXR1c1RyYW5zaXRpb24oZGIsIFwiaGFuZGVkX29mZlwiLCBcInF1ZXVlZFwiKVxuICAgICAgcmV0dXJuIHRydWVcbiAgICB9KVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgbWFyayByZXR1cm5lZCB0byBxdWV1ZS5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBPcHRpb25zLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gYXJncy5qb2JJZCAtIEpvYiBpZC5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGFyZ3MuaGFuZG9mZklkIC0gSGFuZG9mZiBsZWFzZSBpZC5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgd2hlbiB1cGRhdGVkLlxuICAgKi9cbiAgYXN5bmMgbWFya1JldHVybmVkVG9RdWV1ZSh7am9iSWQsIGhhbmRvZmZJZH0pIHtcbiAgICBhd2FpdCB0aGlzLmVuc3VyZVJlYWR5KClcblxuICAgIGF3YWl0IHRoaXMuX3NlcmlhbGl6ZWRDb3VudE11dGF0aW9uKGFzeW5jIChkYikgPT4ge1xuICAgICAgY29uc3Qgam9iID0gYXdhaXQgdGhpcy5fZ2V0Sm9iUm93QnlJZChkYiwgam9iSWQpXG4gICAgICBpZiAoIWpvYiB8fCBqb2IuaGFuZG9mZklkICE9PSBoYW5kb2ZmSWQgfHwgam9iLnN0YXR1cyAhPT0gXCJoYW5kZWRfb2ZmXCIpIHJldHVyblxuICAgICAgYXdhaXQgdGhpcy5fbG9ja0NvbmN1cnJlbmN5Um93KGRiLCBqb2IuY29uY3VycmVuY3lLZXkpXG4gICAgICBjb25zdCBhZmZlY3RlZFJvd3MgPSBhd2FpdCB0aGlzLl91cGRhdGVBZmZlY3RlZFJvd3MoZGIsIHtcbiAgICAgICAgdGFibGVOYW1lOiBKT0JTX1RBQkxFLFxuICAgICAgICBkYXRhOiB7XG4gICAgICAgICAgc3RhdHVzOiBcInF1ZXVlZFwiLFxuICAgICAgICAgIHNjaGVkdWxlZF9hdF9tczogdGhpcy5jbG9jay5ub3coKSxcbiAgICAgICAgICBoYW5kZWRfb2ZmX2F0X21zOiBudWxsLFxuICAgICAgICAgIGhhbmRvZmZfaWQ6IG51bGwsXG4gICAgICAgICAgd29ya2VyX2lkOiBudWxsXG4gICAgICAgIH0sXG4gICAgICAgIGNvbmRpdGlvbnM6IHtoYW5kb2ZmX2lkOiBoYW5kb2ZmSWQsIGlkOiBqb2JJZCwgc3RhdHVzOiBcImhhbmRlZF9vZmZcIn1cbiAgICAgIH0pXG4gICAgICBpZiAoYWZmZWN0ZWRSb3dzID09PSAxKSB7XG4gICAgICAgIGF3YWl0IHRoaXMuX3JlbGVhc2VDb25jdXJyZW5jeShkYiwgam9iLmNvbmN1cnJlbmN5S2V5KVxuICAgICAgICBhd2FpdCB0aGlzLl9yZWNvcmRTdGF0dXNUcmFuc2l0aW9uKGRiLCBcImhhbmRlZF9vZmZcIiwgXCJxdWV1ZWRcIilcbiAgICAgIH1cbiAgICB9KVxuICB9XG5cbiAgLyoqXG4gICAqIFJldHVybnMgdGhlIGFjdGl2ZSBgaGFuZGVkX29mZmAgam9icyAoam9iSWQgKyBoYW5kb2ZmSWQpIGhlbGQgdW5kZXIgYSB3b3JrZXJcbiAgICogaWQuIFVzZWQgb24gd29ya2VyIHJlY29ubmVjdDogYWZ0ZXIgYSBtYWluIHJlc3RhcnQgYSB3b3JrZXIgcmVjb25uZWN0cyB3aXRoXG4gICAqIGl0cyBzdGFibGUgaWQsIGFuZCB0aGUgZnJlc2ggbWFpbiBhZG9wdHMgdGhlc2UgbGVhc2VzIHNvIHRoZXkgYXJlIHRyYWNrZWQg4oCUXG4gICAqIGFuZCByZWxlYXNlZCBpZiB0aGUgcmVjb25uZWN0ZWQgd29ya2VyIGxhdGVyIGRpc2Nvbm5lY3RzIOKAlCBpbnN0ZWFkIG9mXG4gICAqIHNpdHRpbmcgc3R1Y2sgdW50aWwgdGhlIGFnZS1iYXNlZCBvcnBoYW4gc3dlZXAuIFRoaXMgbmV2ZXIgcmVjbGFpbXMsIHNvIGFcbiAgICogZ3JhY2VmdWxseS1kcmFpbmluZyB3b3JrZXIgdGhhdCBrZWVwcyBydW5uaW5nIGl0cyBpbi1mbGlnaHQgam9icyBpcyBsZWZ0XG4gICAqIHVudG91Y2hlZC4gUm93cyB3aXRoIGEgbnVsbCBoYW5kb2ZmIGlkIChsZWdhY3kpIGFyZSBza2lwcGVkOyB0aGUgb3JwaGFuXG4gICAqIHN3ZWVwIHJlY2xhaW1zIHRob3NlIHZpYSBpdHMgYGhhbmRlZF9vZmZfYXRfbXNgIGZlbmNlLlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIE9wdGlvbnMuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBhcmdzLndvcmtlcklkIC0gV29ya2VyIGlkLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxBcnJheTx7am9iSWQ6IHN0cmluZywgaGFuZG9mZklkOiBzdHJpbmd9Pj59IC0gQWN0aXZlIGhhbmRvZmZzLlxuICAgKi9cbiAgYXN5bmMgaGFuZGVkT2ZmSm9ic0Zvcldvcmtlcih7d29ya2VySWR9KSB7XG4gICAgYXdhaXQgdGhpcy5lbnN1cmVSZWFkeSgpXG5cbiAgICBjb25zdCByb3dzID0gYXdhaXQgdGhpcy5fd2l0aERiKGFzeW5jIChkYikgPT5cbiAgICAgIGF3YWl0IGRiLm5ld1F1ZXJ5KCkuZnJvbShKT0JTX1RBQkxFKS53aGVyZSh7c3RhdHVzOiBcImhhbmRlZF9vZmZcIiwgd29ya2VyX2lkOiB3b3JrZXJJZH0pLnJlc3VsdHMoKVxuICAgIClcblxuICAgIC8qKiBAdHlwZSB7QXJyYXk8e2pvYklkOiBzdHJpbmcsIGhhbmRvZmZJZDogc3RyaW5nfT59ICovXG4gICAgY29uc3QgaGFuZG9mZnMgPSBbXVxuXG4gICAgZm9yIChjb25zdCByb3cgb2Ygcm93cykge1xuICAgICAgY29uc3Qgam9iID0gdGhpcy5fbm9ybWFsaXplSm9iUm93KHJvdylcblxuICAgICAgaWYgKGpvYi5oYW5kb2ZmSWQpIGhhbmRvZmZzLnB1c2goe2pvYklkOiBqb2IuaWQsIGhhbmRvZmZJZDogam9iLmhhbmRvZmZJZH0pXG4gICAgfVxuXG4gICAgcmV0dXJuIGhhbmRvZmZzXG4gIH1cblxuICAvKipcbiAgICogU25hcHNob3RzIGV4YWN0LCBsZWFzZS1hd2FyZSBhY3RpdmUgaGFuZG9mZnMgYmVmb3JlIGEgbmV3IG1haW4gZ2VuZXJhdGlvblxuICAgKiBzdGFydHMgYWNjZXB0aW5nIHdvcmtlciByZWNvbm5lY3RzLiBMZWdhY3kgcm93cyB3aXRob3V0IGEgY29tcGxldGUgd29ya2VyLFxuICAgKiBsZWFzZSwgYW5kIHRpbWVzdGFtcCBpZGVudGl0eSBzdGF5IG93bmVkIGJ5IHRoZSBhZ2UtYmFzZWQgb3JwaGFuIHN3ZWVwLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxpbXBvcnQoXCIuL3R5cGVzLmpzXCIpLkJhY2tncm91bmRKb2JIYW5kb2ZmU25hcHNob3RbXT59IC0gRXhhY3Qgc3RhcnR1cCBoYW5kb2Zmcy5cbiAgICovXG4gIGFzeW5jIHNuYXBzaG90SGFuZGVkT2ZmSm9icygpIHtcbiAgICBhd2FpdCB0aGlzLmVuc3VyZVJlYWR5KClcblxuICAgIGNvbnN0IHJvd3MgPSBhd2FpdCB0aGlzLl93aXRoRGIoYXN5bmMgKGRiKSA9PiBhd2FpdCBkYlxuICAgICAgLm5ld1F1ZXJ5KClcbiAgICAgIC5mcm9tKEpPQlNfVEFCTEUpXG4gICAgICAud2hlcmUoe3N0YXR1czogXCJoYW5kZWRfb2ZmXCJ9KVxuICAgICAgLm9yZGVyKFwiY3JlYXRlZF9hdF9tcyBBU0NcIilcbiAgICAgIC5vcmRlcihcImlkIEFTQ1wiKVxuICAgICAgLnJlc3VsdHMoKSlcbiAgICAvKiogQHR5cGUge2ltcG9ydChcIi4vdHlwZXMuanNcIikuQmFja2dyb3VuZEpvYkhhbmRvZmZTbmFwc2hvdFtdfSAqL1xuICAgIGNvbnN0IGhhbmRvZmZzID0gW11cblxuICAgIGZvciAoY29uc3Qgcm93IG9mIHJvd3MpIHtcbiAgICAgIGNvbnN0IGpvYiA9IHRoaXMuX25vcm1hbGl6ZUpvYlJvdyhyb3cpXG5cbiAgICAgIGlmICgham9iLmhhbmRvZmZJZCB8fCAham9iLndvcmtlcklkIHx8IHR5cGVvZiBqb2IuaGFuZGVkT2ZmQXRNcyAhPT0gXCJudW1iZXJcIikgY29udGludWVcblxuICAgICAgaGFuZG9mZnMucHVzaCh7XG4gICAgICAgIGhhbmRlZE9mZkF0TXM6IGpvYi5oYW5kZWRPZmZBdE1zLFxuICAgICAgICBoYW5kb2ZmSWQ6IGpvYi5oYW5kb2ZmSWQsXG4gICAgICAgIGpvYklkOiBqb2IuaWQsXG4gICAgICAgIHdvcmtlcklkOiBqb2Iud29ya2VySWRcbiAgICAgIH0pXG4gICAgfVxuXG4gICAgcmV0dXJuIGhhbmRvZmZzXG4gIH1cblxuICAvKipcbiAgICogUmVjbGFpbXMgb25seSB1bmNoYW5nZWQgZXhhY3QgaGFuZG9mZnMgc2VsZWN0ZWQgYnkgYSBtYWluLWdlbmVyYXRpb24gc3RhcnR1cFxuICAgKiBzbmFwc2hvdC4gVGhlIG9yZGluYXJ5IG9ycGhhbiBmYWlsdXJlIHBhdGggb3ducyByZXRyaWVzLCB0ZXJtaW5hbCBzdGF0dXMsXG4gICAqIGNvdW50IHRyYW5zaXRpb25zLCBzY2hlZHVsZSBvd25lcnNoaXAsIGFuZCBjb25jdXJyZW5jeSByZWxlYXNlLlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIE9wdGlvbnMuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi90eXBlcy5qc1wiKS5CYWNrZ3JvdW5kSm9iSGFuZG9mZlNuYXBzaG90W119IGFyZ3MuaGFuZG9mZnMgLSBFeGFjdCBzdGFydHVwIHNuYXBzaG90cy5cbiAgICogQHBhcmFtIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gYXJncy5lcnJvciAtIE9ycGhhbiByZWFzb24uXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPGltcG9ydChcIi4vdHlwZXMuanNcIikuQmFja2dyb3VuZEpvYlJvd1tdPn0gLSBBY2NlcHRlZCB0cmFuc2l0aW9ucy5cbiAgICovXG4gIGFzeW5jIG1hcmtPcnBoYW5lZEhhbmRvZmZzKHtoYW5kb2ZmcywgZXJyb3J9KSB7XG4gICAgYXdhaXQgdGhpcy5lbnN1cmVSZWFkeSgpXG5cbiAgICByZXR1cm4gYXdhaXQgdGhpcy5fc2VyaWFsaXplZENvdW50TXV0YXRpb24oYXN5bmMgKGRiKSA9PiB7XG4gICAgICAvKiogQHR5cGUge0JhY2tncm91bmRKb2JPcnBoYW5TZWxlY3Rpb25bXX0gKi9cbiAgICAgIGNvbnN0IHNlbGVjdGlvbnMgPSBbXVxuXG4gICAgICBmb3IgKGNvbnN0IGhhbmRvZmYgb2YgaGFuZG9mZnMpIHtcbiAgICAgICAgY29uc3Qgam9iID0gYXdhaXQgdGhpcy5fZ2V0Sm9iUm93QnlJZChkYiwgaGFuZG9mZi5qb2JJZClcblxuICAgICAgICBpZiAoIWpvYiB8fCBqb2Iuc3RhdHVzICE9PSBcImhhbmRlZF9vZmZcIikgY29udGludWVcbiAgICAgICAgaWYgKGpvYi5oYW5kb2ZmSWQgIT09IGhhbmRvZmYuaGFuZG9mZklkKSBjb250aW51ZVxuICAgICAgICBpZiAoam9iLndvcmtlcklkICE9PSBoYW5kb2ZmLndvcmtlcklkKSBjb250aW51ZVxuICAgICAgICBpZiAoam9iLmhhbmRlZE9mZkF0TXMgIT09IGhhbmRvZmYuaGFuZGVkT2ZmQXRNcykgY29udGludWVcblxuICAgICAgICBzZWxlY3Rpb25zLnB1c2goe1xuICAgICAgICAgIGNvbmRpdGlvbnM6IHtcbiAgICAgICAgICAgIGhhbmRlZF9vZmZfYXRfbXM6IGhhbmRvZmYuaGFuZGVkT2ZmQXRNcyxcbiAgICAgICAgICAgIGhhbmRvZmZfaWQ6IGhhbmRvZmYuaGFuZG9mZklkLFxuICAgICAgICAgICAgaWQ6IGhhbmRvZmYuam9iSWQsXG4gICAgICAgICAgICBzdGF0dXM6IFwiaGFuZGVkX29mZlwiLFxuICAgICAgICAgICAgd29ya2VyX2lkOiBoYW5kb2ZmLndvcmtlcklkXG4gICAgICAgICAgfSxcbiAgICAgICAgICBqb2JcbiAgICAgICAgfSlcbiAgICAgIH1cblxuICAgICAgcmV0dXJuIGF3YWl0IHRoaXMuX21hcmtPcnBoYW5TZWxlY3Rpb25zKHtkYiwgZXJyb3IsIHNlbGVjdGlvbnN9KVxuICAgIH0pXG4gIH1cblxuICAvKipcbiAgICogUnVucyBtYXJrIGZhaWxlZC5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBPcHRpb25zLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gYXJncy5qb2JJZCAtIEpvYiBpZC5cbiAgICogQHBhcmFtIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gYXJncy5lcnJvciAtIEVycm9yLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gW2FyZ3MuaGFuZG9mZklkXSAtIEhhbmRvZmYgbGVhc2UgaWQuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBbYXJncy53b3JrZXJJZF0gLSBXb3JrZXIgaWQuXG4gICAqIEBwYXJhbSB7bnVtYmVyfSBbYXJncy5oYW5kZWRPZmZBdE1zXSAtIEhhbmRlZCBvZmYgdGltZXN0YW1wLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxpbXBvcnQoXCIuL3R5cGVzLmpzXCIpLkJhY2tncm91bmRKb2JSb3cgfCBudWxsPn0gLSBVcGRhdGVkIGpvYiByb3cgd2hlbiB0aGUgcmVwb3J0IHdhcyBhY2NlcHRlZC5cbiAgICovXG4gIGFzeW5jIG1hcmtGYWlsZWQoe2pvYklkLCBlcnJvciwgaGFuZG9mZklkLCB3b3JrZXJJZCwgaGFuZGVkT2ZmQXRNc30pIHtcbiAgICBhd2FpdCB0aGlzLmVuc3VyZVJlYWR5KClcblxuICAgIHJldHVybiBhd2FpdCB0aGlzLl9zZXJpYWxpemVkQ291bnRNdXRhdGlvbihhc3luYyAoZGIpID0+IHtcbiAgICAgIGNvbnN0IGpvYiA9IGF3YWl0IHRoaXMuX2dldEpvYlJvd0J5SWQoZGIsIGpvYklkKVxuXG4gICAgICBpZiAoIWpvYikgcmV0dXJuIG51bGxcbiAgICAgIGlmICghdGhpcy5fc2hvdWxkQWNjZXB0UmVwb3J0KHtqb2IsIGhhbmRvZmZJZCwgd29ya2VySWQsIGhhbmRlZE9mZkF0TXN9KSkgcmV0dXJuIG51bGxcblxuICAgICAgY29uc3QgdXBkYXRlZEpvYiA9IGF3YWl0IHRoaXMuX2FwcGx5RmFpbHVyZSh7ZGIsIGpvYiwgZXJyb3IsIG1hcmtPcnBoYW5lZDogZmFsc2V9KVxuXG4gICAgICBpZiAodXBkYXRlZEpvYikgYXdhaXQgdGhpcy5fcmVjb3JkU3RhdHVzVHJhbnNpdGlvbihkYiwgam9iLnN0YXR1cywgdXBkYXRlZEpvYi5zdGF0dXMpXG4gICAgICByZXR1cm4gdXBkYXRlZEpvYlxuICAgIH0pXG4gIH1cblxuICAvKipcbiAgICogUnVucyBtYXJrIG9ycGhhbmVkIGpvYnMuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBbYXJnc10gLSBPcHRpb25zLlxuICAgKiBAcGFyYW0ge251bWJlcn0gW2FyZ3Mub3JwaGFuZWRBZnRlck1zXSAtIE1hcmsgam9icyBvcnBoYW5lZCBhZnRlciB0aGlzIGR1cmF0aW9uLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxpbXBvcnQoXCIuL3R5cGVzLmpzXCIpLkJhY2tncm91bmRKb2JSb3dbXT59IC0gVGhlIGpvYnMgdGhpcyBzd2VlcCBtYXJrZWQgb3JwaGFuZWQuXG4gICAqL1xuICBhc3luYyBtYXJrT3JwaGFuZWRKb2JzKHtvcnBoYW5lZEFmdGVyTXMgPSBPUlBIQU5FRF9BRlRFUl9NU30gPSB7fSkge1xuICAgIGF3YWl0IHRoaXMuZW5zdXJlUmVhZHkoKVxuXG4gICAgcmV0dXJuIGF3YWl0IHRoaXMuX3NlcmlhbGl6ZWRDb3VudE11dGF0aW9uKGFzeW5jIChkYikgPT4ge1xuICAgICAgY29uc3QgY3V0b2ZmID0gdGhpcy5jbG9jay5ub3coKSAtIG9ycGhhbmVkQWZ0ZXJNc1xuICAgICAgY29uc3QgcXVlcnkgPSBkYlxuICAgICAgICAubmV3UXVlcnkoKVxuICAgICAgICAuZnJvbShKT0JTX1RBQkxFKVxuICAgICAgICAud2hlcmUoe3N0YXR1czogXCJoYW5kZWRfb2ZmXCJ9KVxuICAgICAgICAud2hlcmUoYGhhbmRlZF9vZmZfYXRfbXMgPD0gJHtkYi5xdW90ZShjdXRvZmYpfWApXG5cbiAgICAgIGNvbnN0IHJvd3MgPSBhd2FpdCBxdWVyeS5yZXN1bHRzKClcblxuICAgICAgLyoqIEB0eXBlIHtCYWNrZ3JvdW5kSm9iT3JwaGFuU2VsZWN0aW9uW119ICovXG4gICAgICBjb25zdCBzZWxlY3Rpb25zID0gW11cblxuICAgICAgZm9yIChjb25zdCByb3cgb2Ygcm93cykge1xuICAgICAgICBjb25zdCBqb2IgPSB0aGlzLl9ub3JtYWxpemVKb2JSb3cocm93KVxuXG4gICAgICAgIC8vIEZlbmNlIHRoZSByZWNsYWltIG9uIHRoZSBleGFjdCBoYW5kb2ZmIHRoaXMgc3dlZXAgc2VsZWN0ZWQsIHVzaW5nIGl0c1xuICAgICAgICAvLyBgaGFuZGVkX29mZl9hdF9tc2AgcmF0aGVyIHRoYW4gaXRzIGBoYW5kb2ZmX2lkYC4gVHdvIHJlYXNvbnM6XG4gICAgICAgIC8vICAgMS4gTnVsbC1zYWZlLiBTb21lIHJvd3MgaGF2ZSBhIG51bGwgYGhhbmRvZmZfaWRgIChoYW5kZWQgb2ZmIGJ5IGFuXG4gICAgICAgIC8vICAgICAgb2xkZXIgdmVsb2Npb3VzIGJlZm9yZSBoYW5kb2ZmLWlkIGZlbmNpbmcpLiBge2hhbmRvZmZfaWQ6IG51bGx9YFxuICAgICAgICAvLyAgICAgIHJlbmRlcnMgYXMgYGhhbmRvZmZfaWQgPSBOVUxMYCwgd2hpY2ggbWF0Y2hlcyBub3RoaW5nLCBzbyB0aG9zZVxuICAgICAgICAvLyAgICAgIHJvd3Mgd291bGQgYmUgc3RyYW5kZWQgaW4gYGhhbmRlZF9vZmZgIGZvcmV2ZXIuXG4gICAgICAgIC8vICAgMi4gUmFjZS1zYWZlLiBJZiB0aGUgcm93IGlzIHJldHVybmVkIHRvIHRoZSBxdWV1ZSBhbmQgcmUtaGFuZGVkLW9mZlxuICAgICAgICAvLyAgICAgIGJldHdlZW4gdGhlIFNFTEVDVCBhYm92ZSBhbmQgdGhpcyB1cGRhdGUsIGl0IGdldHMgYSBmcmVzaFxuICAgICAgICAvLyAgICAgIGBoYW5kZWRfb2ZmX2F0X21zYCAoYWx3YXlzIFwibm93XCIpLCBzbyB0aGlzIHN0YWxlIGN1dG9mZi1lcmFcbiAgICAgICAgLy8gICAgICB0aW1lc3RhbXAgbm8gbG9uZ2VyIG1hdGNoZXMgYW5kIHdlIHdvbid0IGZhaWwvb3JwaGFuIOKAlCBvclxuICAgICAgICAvLyAgICAgIHdyb25nbHkgcmVsZWFzZSB0aGUgY29uY3VycmVuY3kgcmVzZXJ2YXRpb24gb2Yg4oCUIHRoYXQgbmV3IGxlYXNlLlxuICAgICAgICAvLyBgaGFuZGVkX29mZl9hdF9tc2AgaXMgYWx3YXlzIHNldCBvbiBhIGhhbmRlZC1vZmYgcm93IChhbmQgdGhlIFNFTEVDVFxuICAgICAgICAvLyByZXF1aXJlZCBpdCBgPD0gY3V0b2ZmYCksIHNvIGl0IGlzIGEgcmVsaWFibGUgbnVsbC1zYWZlIGxlYXNlIHBpbi5cbiAgICAgICAgc2VsZWN0aW9ucy5wdXNoKHtcbiAgICAgICAgICBjb25kaXRpb25zOiB7aWQ6IGpvYi5pZCwgc3RhdHVzOiBcImhhbmRlZF9vZmZcIiwgaGFuZGVkX29mZl9hdF9tczogam9iLmhhbmRlZE9mZkF0TXN9LFxuICAgICAgICAgIGpvYlxuICAgICAgICB9KVxuICAgICAgfVxuXG4gICAgICByZXR1cm4gYXdhaXQgdGhpcy5fbWFya09ycGhhblNlbGVjdGlvbnMoe1xuICAgICAgICBkYixcbiAgICAgICAgZXJyb3I6IFwiSm9iIG9ycGhhbmVkIGFmdGVyIHRpbWVvdXRcIixcbiAgICAgICAgc2VsZWN0aW9uc1xuICAgICAgfSlcbiAgICB9KVxuICB9XG5cbiAgLyoqXG4gICAqIEFwcGxpZXMgdGhlIGNvbW1vbiBmZW5jZWQgb3JwaGFuIHRyYW5zaXRpb24gYW5kIHJlY29yZHMgb25lIGFnZ3JlZ2F0ZSBjb3VudFxuICAgKiBkZWx0YSBmb3IgdGhlIGFjY2VwdGVkIHJvd3MuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gT3B0aW9ucy5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9kYXRhYmFzZS9kcml2ZXJzL2Jhc2UuanNcIikuZGVmYXVsdH0gYXJncy5kYiAtIFRyYW5zYWN0aW9uIGNvbm5lY3Rpb24uXG4gICAqIEBwYXJhbSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59IGFyZ3MuZXJyb3IgLSBPcnBoYW4gcmVhc29uLlxuICAgKiBAcGFyYW0ge0JhY2tncm91bmRKb2JPcnBoYW5TZWxlY3Rpb25bXX0gYXJncy5zZWxlY3Rpb25zIC0gU2VsZWN0ZWQgaGFuZG9mZnMgYW5kIGV4YWN0IGZlbmNlcy5cbiAgICogQHJldHVybnMge1Byb21pc2U8aW1wb3J0KFwiLi90eXBlcy5qc1wiKS5CYWNrZ3JvdW5kSm9iUm93W10+fSAtIEFjY2VwdGVkIHRyYW5zaXRpb25zLlxuICAgKi9cbiAgYXN5bmMgX21hcmtPcnBoYW5TZWxlY3Rpb25zKHtkYiwgZXJyb3IsIHNlbGVjdGlvbnN9KSB7XG4gICAgLyoqIEB0eXBlIHtpbXBvcnQoXCIuL3R5cGVzLmpzXCIpLkJhY2tncm91bmRKb2JSb3dbXX0gKi9cbiAgICBjb25zdCBvcnBoYW5lZEpvYnMgPSBbXVxuXG4gICAgZm9yIChjb25zdCB7Y29uZGl0aW9ucywgam9ifSBvZiBzZWxlY3Rpb25zKSB7XG4gICAgICBjb25zdCBvcnBoYW5lZEpvYiA9IGF3YWl0IHRoaXMuX2FwcGx5RmFpbHVyZSh7XG4gICAgICAgIGNvbmRpdGlvbnMsXG4gICAgICAgIGRiLFxuICAgICAgICBlcnJvcixcbiAgICAgICAgam9iLFxuICAgICAgICBtYXJrT3JwaGFuZWQ6IHRydWVcbiAgICAgIH0pXG5cbiAgICAgIGlmIChvcnBoYW5lZEpvYikgb3JwaGFuZWRKb2JzLnB1c2gob3JwaGFuZWRKb2IpXG4gICAgfVxuXG4gICAgY29uc3Qgc3RhdHVzQ291bnRzID0gdGhpcy5fc3RhdHVzQ291bnRzKG9ycGhhbmVkSm9icylcbiAgICBjb25zdCBkZWx0YXMgPSB0aGlzLl9lbXB0eUNvdW50QnVja2V0cygpXG5cbiAgICBmb3IgKGNvbnN0IFtzdGF0dXMsIGNvdW50XSBvZiBPYmplY3QuZW50cmllcyhzdGF0dXNDb3VudHMpKSB7XG4gICAgICBkZWx0YXMuaGFuZGVkX29mZiAtPSBjb3VudFxuICAgICAgZGVsdGFzW3N0YXR1c10gKz0gY291bnRcbiAgICB9XG4gICAgYXdhaXQgdGhpcy5fcmVjb3JkQ291bnREZWx0YShkYiwgZGVsdGFzKVxuXG4gICAgcmV0dXJuIG9ycGhhbmVkSm9ic1xuICB9XG5cbiAgLyoqXG4gICAqIERlbGV0ZXMgdGVybWluYWwgam9iIHJvd3MgcGFzdCB0aGVpciByZXRlbnRpb24gd2luZG93IHNvIHRoZSBqb2JzIHRhYmxlXG4gICAqIGRvZXMgbm90IGdyb3cgdW5ib3VuZGVkIChjb21wbGV0ZWQgcm93cyBpbiBwYXJ0aWN1bGFyIGFjY3VtdWxhdGUgZm9yZXZlclxuICAgKiBvdGhlcndpc2UpLiBCYXRjaGVkIGJ5IGlkIOKAlCBTRUxFQ1QgYSBwYWdlIG9mIGlkcywgdGhlblxuICAgKiBgREVMRVRFIC4uLiBXSEVSRSBpZCBJTiAoLi4uKWAg4oCUIHJhdGhlciB0aGFuIGBERUxFVEUgLi4uIExJTUlUYCwgd2hpY2ggbm90XG4gICAqIGV2ZXJ5IGRyaXZlciBzdXBwb3J0czsgZWFjaCBiYXRjaCBydW5zIG9uIGl0cyBvd24gY29ubmVjdGlvbiBzbyB0aGUgc3dlZXBcbiAgICogeWllbGRzIGJldHdlZW4gYmF0Y2hlcyBpbnN0ZWFkIG9mIGhvbGRpbmcgb25lIGxvbmcgdHJhbnNhY3Rpb24uXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBbYXJnc10gLSBPcHRpb25zLlxuICAgKiBAcGFyYW0ge251bWJlciB8IG51bGx9IFthcmdzLmNvbXBsZXRlZFR0bE1zXSAtIERlbGV0ZSBgY29tcGxldGVkYCBqb2JzIHdob3NlIGBjb21wbGV0ZWRfYXRfbXNgIGlzIG9sZGVyIHRoYW4gdGhpcyBtYW55IG1zLiBGYWxzeSBvciBgPD0gMGAgZGlzYWJsZXMgY29tcGxldGVkIHBydW5pbmcuXG4gICAqIEBwYXJhbSB7bnVtYmVyIHwgbnVsbH0gW2FyZ3MuZmFpbGVkVHRsTXNdIC0gRGVsZXRlIHRlcm1pbmFsIGBmYWlsZWRgL2BvcnBoYW5lZGAgam9icyBvbGRlciB0aGFuIHRoaXMgbWFueSBtcyAoYnkgYGZhaWxlZF9hdF9tc2AvYG9ycGhhbmVkX2F0X21zYCkuIEZhbHN5IG9yIGA8PSAwYCBkaXNhYmxlcy5cbiAgICogQHBhcmFtIHtudW1iZXJ9IFthcmdzLmJhdGNoU2l6ZV0gLSBNYXggcm93cyBkZWxldGVkIHBlciBiYXRjaC4gRGVmYXVsdCBgMTAwMGAuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPG51bWJlcj59IC0gVG90YWwgcm93cyBkZWxldGVkLlxuICAgKi9cbiAgYXN5bmMgcHJ1bmVUZXJtaW5hbEpvYnMoe2NvbXBsZXRlZFR0bE1zID0gbnVsbCwgZmFpbGVkVHRsTXMgPSBudWxsLCBiYXRjaFNpemUgPSAxMDAwfSA9IHt9KSB7XG4gICAgYXdhaXQgdGhpcy5lbnN1cmVSZWFkeSgpXG5cbiAgICBjb25zdCBub3cgPSB0aGlzLmNsb2NrLm5vdygpXG4gICAgY29uc3Qgc2l6ZSA9IGJhdGNoU2l6ZSA+IDAgPyBiYXRjaFNpemUgOiAxMDAwXG4gICAgbGV0IGRlbGV0ZWQgPSAwXG5cbiAgICBpZiAoY29tcGxldGVkVHRsTXMgJiYgY29tcGxldGVkVHRsTXMgPiAwKSB7XG4gICAgICBkZWxldGVkICs9IGF3YWl0IHRoaXMuX3BydW5lU3RhdHVzQmF0Y2hlcyh7c3RhdHVzOiBcImNvbXBsZXRlZFwiLCBjb2x1bW46IFwiY29tcGxldGVkX2F0X21zXCIsIGN1dG9mZjogbm93IC0gY29tcGxldGVkVHRsTXMsIGJhdGNoU2l6ZTogc2l6ZX0pXG4gICAgfVxuXG4gICAgaWYgKGZhaWxlZFR0bE1zICYmIGZhaWxlZFR0bE1zID4gMCkge1xuICAgICAgZGVsZXRlZCArPSBhd2FpdCB0aGlzLl9wcnVuZVN0YXR1c0JhdGNoZXMoe3N0YXR1czogXCJmYWlsZWRcIiwgY29sdW1uOiBcImZhaWxlZF9hdF9tc1wiLCBjdXRvZmY6IG5vdyAtIGZhaWxlZFR0bE1zLCBiYXRjaFNpemU6IHNpemV9KVxuICAgICAgZGVsZXRlZCArPSBhd2FpdCB0aGlzLl9wcnVuZVN0YXR1c0JhdGNoZXMoe3N0YXR1czogXCJvcnBoYW5lZFwiLCBjb2x1bW46IFwib3JwaGFuZWRfYXRfbXNcIiwgY3V0b2ZmOiBub3cgLSBmYWlsZWRUdGxNcywgYmF0Y2hTaXplOiBzaXplfSlcbiAgICB9XG5cbiAgICByZXR1cm4gZGVsZXRlZFxuICB9XG5cbiAgLyoqXG4gICAqIERlbGV0ZXMgcm93cyBvZiBvbmUgdGVybWluYWwgc3RhdHVzIG9sZGVyIHRoYW4gYSBjdXRvZmYsIGJhdGNoIGJ5IGJhdGNoLFxuICAgKiB1bnRpbCBhIHBhZ2UgcmV0dXJucyBmZXdlciB0aGFuIGBiYXRjaFNpemVgIHJvd3MuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gT3B0aW9ucy5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGFyZ3Muc3RhdHVzIC0gVGVybWluYWwgc3RhdHVzIHRvIHBydW5lLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gYXJncy5jb2x1bW4gLSBUaW1lc3RhbXAgY29sdW1uIGNvbXBhcmVkIGFnYWluc3QgdGhlIGN1dG9mZi5cbiAgICogQHBhcmFtIHtudW1iZXJ9IGFyZ3MuY3V0b2ZmIC0gRGVsZXRlIHJvd3Mgd2hvc2UgY29sdW1uIHZhbHVlIGlzIGA8PSBjdXRvZmZgLlxuICAgKiBAcGFyYW0ge251bWJlcn0gYXJncy5iYXRjaFNpemUgLSBNYXggcm93cyBwZXIgYmF0Y2guXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPG51bWJlcj59IC0gUm93cyBkZWxldGVkIGZvciB0aGlzIHN0YXR1cy5cbiAgICovXG4gIGFzeW5jIF9wcnVuZVN0YXR1c0JhdGNoZXMoe3N0YXR1cywgY29sdW1uLCBjdXRvZmYsIGJhdGNoU2l6ZX0pIHtcbiAgICBsZXQgZGVsZXRlZCA9IDBcblxuICAgIGZvciAoOzspIHtcbiAgICAgIGNvbnN0IHJlbW92ZWQgPSBhd2FpdCB0aGlzLl9zZXJpYWxpemVkQ291bnRNdXRhdGlvbihhc3luYyAoZGIpID0+IHtcbiAgICAgICAgY29uc3Qgcm93cyA9IGF3YWl0IGRiXG4gICAgICAgICAgLm5ld1F1ZXJ5KClcbiAgICAgICAgICAuZnJvbShKT0JTX1RBQkxFKVxuICAgICAgICAgIC5zZWxlY3QoXCJpZFwiKVxuICAgICAgICAgIC53aGVyZSh7c3RhdHVzfSlcbiAgICAgICAgICAud2hlcmUoYCR7ZGIucXVvdGVDb2x1bW4oY29sdW1uKX0gPD0gJHtkYi5xdW90ZShjdXRvZmYpfWApXG4gICAgICAgICAgLmxpbWl0KGJhdGNoU2l6ZSlcbiAgICAgICAgICAucmVzdWx0cygpXG5cbiAgICAgICAgaWYgKHJvd3MubGVuZ3RoID09PSAwKSByZXR1cm4gMFxuXG4gICAgICAgIGNvbnN0IGlkcyA9IHJvd3MubWFwKCgvKiogQHR5cGUge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gKi8gcm93KSA9PiBkYi5xdW90ZShTdHJpbmcocm93LmlkKSkpLmpvaW4oXCIsIFwiKVxuXG4gICAgICAgIGNvbnN0IHJlbW92ZWQgPSBhd2FpdCBkYi5hZmZlY3RlZFJvd3MoXG4gICAgICAgICAgYERFTEVURSBGUk9NICR7ZGIucXVvdGVUYWJsZShKT0JTX1RBQkxFKX0gV0hFUkUgJHtkYi5xdW90ZUNvbHVtbihcImlkXCIpfSBJTiAoJHtpZHN9KWBcbiAgICAgICAgKVxuXG4gICAgICAgIGF3YWl0IHRoaXMuX3JlY29yZENvdW50RGVsdGEoZGIsIHthbGw6IC1yZW1vdmVkLCBbc3RhdHVzXTogLXJlbW92ZWR9KVxuXG4gICAgICAgIHJldHVybiByZW1vdmVkXG4gICAgICB9KVxuXG4gICAgICBkZWxldGVkICs9IHJlbW92ZWRcbiAgICAgIGlmIChyZW1vdmVkIDwgYmF0Y2hTaXplKSBicmVha1xuICAgIH1cblxuICAgIHJldHVybiBkZWxldGVkXG4gIH1cblxuICAvKipcbiAgICogUnVucyBjbGVhciBhbGwuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIHdoZW4gY2xlYXJlZC5cbiAgICovXG4gIGFzeW5jIGNsZWFyQWxsKCkge1xuICAgIGF3YWl0IHRoaXMuZW5zdXJlUmVhZHkoKVxuXG4gICAgYXdhaXQgdGhpcy5fc2VyaWFsaXplZENvdW50TXV0YXRpb24oYXN5bmMgKGRiKSA9PiB7XG4gICAgICBjb25zdCBzbmFwc2hvdCA9IGF3YWl0IHRoaXMuX2NvdW50U25hcHNob3RPbkxvY2tlZENvbm5lY3Rpb24oZGIpXG4gICAgICBpZiAoYXdhaXQgZGIudGFibGVFeGlzdHMoTUFJTF9ERUxJVkVSWV9PUEVSQVRJT05TX1RBQkxFKSkgYXdhaXQgZGIucXVlcnkoYERFTEVURSBGUk9NICR7ZGIucXVvdGVUYWJsZShNQUlMX0RFTElWRVJZX09QRVJBVElPTlNfVEFCTEUpfWApXG4gICAgICBpZiAoYXdhaXQgZGIudGFibGVFeGlzdHMoSURFTVBPVEVOQ1lfS0VZU19UQUJMRSkpIGF3YWl0IGRiLnF1ZXJ5KGBERUxFVEUgRlJPTSAke2RiLnF1b3RlVGFibGUoSURFTVBPVEVOQ1lfS0VZU19UQUJMRSl9YClcbiAgICAgIGlmIChhd2FpdCBkYi50YWJsZUV4aXN0cyhTQ0hFRFVMRV9LRVlTX1RBQkxFKSkgYXdhaXQgZGIucXVlcnkoYERFTEVURSBGUk9NICR7ZGIucXVvdGVUYWJsZShTQ0hFRFVMRV9LRVlTX1RBQkxFKX1gKVxuICAgICAgYXdhaXQgZGIucXVlcnkoYERFTEVURSBGUk9NICR7ZGIucXVvdGVUYWJsZShKT0JTX1RBQkxFKX1gKVxuICAgICAgaWYgKGF3YWl0IGRiLnRhYmxlRXhpc3RzKENPTkNVUlJFTkNZX1RBQkxFKSkgYXdhaXQgZGIucXVlcnkoYERFTEVURSBGUk9NICR7ZGIucXVvdGVUYWJsZShDT05DVVJSRU5DWV9UQUJMRSl9YClcbiAgICAgIGNvbnN0IGRlbHRhcyA9IE9iamVjdC5mcm9tRW50cmllcyhPYmplY3QuZW50cmllcyhzbmFwc2hvdC5jb3VudHMpLm1hcCgoW2tleSwgdmFsdWVdKSA9PiBba2V5LCAtdmFsdWVdKSlcbiAgICAgIGF3YWl0IHRoaXMuX3JlY29yZENvdW50RGVsdGEoZGIsIGRlbHRhcylcbiAgICB9KVxuICB9XG5cbiAgLyoqXG4gICAqIENhbmNlbHMgYSBxdWV1ZWQgb3IgaGFuZGVkLW9mZiBqb2IgYW5kIHJlbGVhc2VzIGFueSBkdXJhYmxlIGNvbmN1cnJlbmN5IHJlc2VydmF0aW9uLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gam9iSWQgLSBKb2IgaWQuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPGJvb2xlYW4+fSAtIFdoZXRoZXIgdGhlIGpvYiB3YXMgY2FuY2VsbGVkLlxuICAgKi9cbiAgYXN5bmMgY2FuY2VsKGpvYklkKSB7XG4gICAgYXdhaXQgdGhpcy5lbnN1cmVSZWFkeSgpXG4gICAgcmV0dXJuIGF3YWl0IHRoaXMuX3NlcmlhbGl6ZWRDb3VudE11dGF0aW9uKGFzeW5jIChkYikgPT4ge1xuICAgICAgY29uc3Qgam9iID0gYXdhaXQgdGhpcy5fZ2V0Sm9iUm93QnlJZChkYiwgam9iSWQpXG4gICAgICBpZiAoIWpvYiB8fCAoam9iLnN0YXR1cyAhPT0gXCJxdWV1ZWRcIiAmJiBqb2Iuc3RhdHVzICE9PSBcImhhbmRlZF9vZmZcIikpIHJldHVybiBmYWxzZVxuICAgICAgLy8gT25seSBhIGhhbmRlZF9vZmYgam9iIGhvbGRzIGEgY29uY3VycmVuY3kgcmVzZXJ2YXRpb24sIHNvIG9ubHkgdGhhdCBjYXNlIHRvdWNoZXMgdGhlXG4gICAgICAvLyBzaGFyZWQgY291bnRlciByb3cgYW5kIG5lZWRzIHRoZSBjb25jdXJyZW5jeS10aGVuLWpvYiBsb2NrIG9yZGVyaW5nLlxuICAgICAgaWYgKGpvYi5zdGF0dXMgPT09IFwiaGFuZGVkX29mZlwiKSBhd2FpdCB0aGlzLl9sb2NrQ29uY3VycmVuY3lSb3coZGIsIGpvYi5jb25jdXJyZW5jeUtleSlcbiAgICAgIGNvbnN0IGFmZmVjdGVkUm93cyA9IGF3YWl0IHRoaXMuX3VwZGF0ZUFmZmVjdGVkUm93cyhkYiwge3RhYmxlTmFtZTogSk9CU19UQUJMRSwgZGF0YToge3N0YXR1czogXCJjYW5jZWxsZWRcIn0sIGNvbmRpdGlvbnM6IHtpZDogam9iLmlkLCBzdGF0dXM6IGpvYi5zdGF0dXN9fSlcbiAgICAgIGlmIChhZmZlY3RlZFJvd3MgIT09IDEpIHJldHVybiBmYWxzZVxuICAgICAgYXdhaXQgdGhpcy5fcmVsZWFzZVNjaGVkdWxlT3duZXJzaGlwRm9ySm9iKGRiLCBqb2IpXG4gICAgICBpZiAoam9iLnN0YXR1cyA9PT0gXCJoYW5kZWRfb2ZmXCIpIGF3YWl0IHRoaXMuX3JlbGVhc2VDb25jdXJyZW5jeShkYiwgam9iLmNvbmN1cnJlbmN5S2V5KVxuICAgICAgYXdhaXQgdGhpcy5fcmVjb3JkU3RhdHVzVHJhbnNpdGlvbihkYiwgam9iLnN0YXR1cywgXCJjYW5jZWxsZWRcIilcbiAgICAgIHJldHVybiB0cnVlXG4gICAgfSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGdldCByZXRyeSBkZWxheSBtcy5cbiAgICogQHBhcmFtIHtudW1iZXJ9IHJldHJ5Q291bnQgLSBSZXRyeSBhdHRlbXB0IGNvdW50ICgxLWJhc2VkKS5cbiAgICogQHJldHVybnMge251bWJlcn0gLSBEZWxheSBpbiBtaWxsaXNlY29uZHMuXG4gICAqL1xuICBnZXRSZXRyeURlbGF5TXMocmV0cnlDb3VudCkge1xuICAgIHJldHVybiByZXRyeURlbGF5TXMocmV0cnlDb3VudClcbiAgfVxuXG4gIC8qKlxuICAgKiBOb3JtYWxpemVzIG9uZSBuZXcgam9iIGJlZm9yZSBlbnRlcmluZyBpdHMgcGVyc2lzdGVuY2UgdHJhbnNhY3Rpb24uXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gSm9iIGlucHV0LlxuICAgKiBAcGFyYW0ge0FycmF5PFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gYXJncy5hcmdzIC0gSm9iIGFyZ3VtZW50cy5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGFyZ3Muam9iTmFtZSAtIEpvYiBuYW1lLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vdHlwZXMuanNcIikuQmFja2dyb3VuZEpvYk9wdGlvbnN9IFthcmdzLm9wdGlvbnNdIC0gSm9iIG9wdGlvbnMuXG4gICAqIEByZXR1cm5zIHtQcmVwYXJlZEJhY2tncm91bmRKb2J9IC0gUHJlcGFyZWQgam9iLlxuICAgKi9cbiAgX3ByZXBhcmVKb2Ioe2FyZ3MsIGpvYk5hbWUsIG9wdGlvbnN9KSB7XG4gICAgY29uc3QgY3JlYXRlZEF0TXMgPSB0aGlzLmNsb2NrLm5vdygpXG4gICAgY29uc3QgcXVldWUgPSB0aGlzLl9ub3JtYWxpemVRdWV1ZShvcHRpb25zKVxuXG4gICAgcmV0dXJuIHtcbiAgICAgIGFyZ3NKc29uOiBKU09OLnN0cmluZ2lmeShhcmdzIHx8IFtdKSxcbiAgICAgIGNvbmN1cnJlbmN5OiB0aGlzLl9yZXNvbHZlQ29uY3VycmVuY3kob3B0aW9ucywgcXVldWUpLFxuICAgICAgY3JlYXRlZEF0TXMsXG4gICAgICBleGVjdXRpb25Nb2RlOiB0aGlzLl9ub3JtYWxpemVFeGVjdXRpb25Nb2RlKG9wdGlvbnMpLFxuICAgICAgam9iSWQ6IHJhbmRvbVVVSUQoKSxcbiAgICAgIGpvYk5hbWUsXG4gICAgICBtYXhSZXRyaWVzOiB0aGlzLl9ub3JtYWxpemVNYXhSZXRyaWVzKG9wdGlvbnM/Lm1heFJldHJpZXMpLFxuICAgICAgcXVldWUsXG4gICAgICBzY2hlZHVsZWRBdE1zOiB0aGlzLl9ub3JtYWxpemVTY2hlZHVsZWRBdE1zKG9wdGlvbnM/LnNjaGVkdWxlZEF0TXMsIGNyZWF0ZWRBdE1zKSxcbiAgICAgIHRpbWVvdXRNczogdGhpcy5fbm9ybWFsaXplSm9iVGltZW91dE1zKG9wdGlvbnMpXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIE5vcm1hbGl6ZXMgYSBwZXItam9iIHRpbWVvdXQgd2hpbGUgcHJlc2VydmluZyBvbWl0dGVkICh3b3JrZXIgZmFsbGJhY2spXG4gICAqIHNlcGFyYXRlbHkgZnJvbSBleHBsaWNpdGx5IGRpc2FibGVkLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vdHlwZXMuanNcIikuQmFja2dyb3VuZEpvYk9wdGlvbnMgfCB1bmRlZmluZWR9IG9wdGlvbnMgLSBKb2Igb3B0aW9ucy5cbiAgICogQHJldHVybnMge251bWJlciB8IG51bGx9IC0gUG9zaXRpdmUgdGltZW91dCwgemVybyBmb3IgZGlzYWJsZWQsIG9yIG51bGwgd2hlbiBvbWl0dGVkLlxuICAgKi9cbiAgX25vcm1hbGl6ZUpvYlRpbWVvdXRNcyhvcHRpb25zKSB7XG4gICAgaWYgKG9wdGlvbnM/LnRpbWVvdXRNcyA9PT0gdW5kZWZpbmVkKSByZXR1cm4gbnVsbFxuXG4gICAgY29uc3QgdGltZW91dE1zID0gb3B0aW9ucy50aW1lb3V0TXNcblxuICAgIGlmICh0eXBlb2YgdGltZW91dE1zICE9PSBcIm51bWJlclwiIHx8ICFOdW1iZXIuaXNGaW5pdGUodGltZW91dE1zKSkge1xuICAgICAgdGhyb3cgVmVsb2Npb3VzRXJyb3Iuc2FmZShKT0JfVElNRU9VVF9WQUxJREFUSU9OX01FU1NBR0UpXG4gICAgfVxuXG4gICAgaWYgKHRpbWVvdXRNcyA8PSAwKSByZXR1cm4gMFxuXG4gICAgaWYgKCFOdW1iZXIuaXNJbnRlZ2VyKHRpbWVvdXRNcykgfHwgdGltZW91dE1zID4gTUFYX0pPQl9USU1FT1VUX01TKSB7XG4gICAgICB0aHJvdyBWZWxvY2lvdXNFcnJvci5zYWZlKEpPQl9USU1FT1VUX1ZBTElEQVRJT05fTUVTU0FHRSlcbiAgICB9XG5cbiAgICByZXR1cm4gdGltZW91dE1zXG4gIH1cblxuICAvKipcbiAgICogSW5zZXJ0cyBvbmUgcHJlcGFyZWQgcXVldWVkIGpvYiwgaW5jbHVkaW5nIGl0cyBjb25jdXJyZW5jeSByZWdpc3RyYXRpb24uXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vZGF0YWJhc2UvZHJpdmVycy9iYXNlLmpzXCIpLmRlZmF1bHR9IGRiIC0gRGF0YWJhc2UgY29ubmVjdGlvbi5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBJbnNlcnQgaW5wdXQuXG4gICAqIEBwYXJhbSB7UHJlcGFyZWRCYWNrZ3JvdW5kSm9ifSBhcmdzLnByZXBhcmVkSm9iIC0gUHJlcGFyZWQgam9iLlxuICAgKiBAcGFyYW0ge3N0cmluZyB8IG51bGx9IGFyZ3Muc2NoZWR1bGVLZXkgLSBIaXN0b3JpY2FsIHN0YWJsZSBrZXkuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIGFmdGVyIGluc2VydGlvbi5cbiAgICovXG4gIGFzeW5jIF9pbnNlcnRQcmVwYXJlZEpvYihkYiwge3ByZXBhcmVkSm9iLCBzY2hlZHVsZUtleX0pIHtcbiAgICBjb25zdCB7Y29uY3VycmVuY3l9ID0gcHJlcGFyZWRKb2JcblxuICAgIGlmIChjb25jdXJyZW5jeSkge1xuICAgICAgaWYgKGNvbmN1cnJlbmN5LnF1ZXVlRGVyaXZlZCkge1xuICAgICAgICBhd2FpdCB0aGlzLl9lbnN1cmVRdWV1ZUNvbmN1cnJlbmN5S2V5KGRiLCBjb25jdXJyZW5jeSlcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIGF3YWl0IHRoaXMuX2Vuc3VyZUNvbmN1cnJlbmN5S2V5KGRiLCBjb25jdXJyZW5jeSlcbiAgICAgIH1cbiAgICB9XG5cbiAgICBhd2FpdCBkYi5pbnNlcnQoe1xuICAgICAgdGFibGVOYW1lOiBKT0JTX1RBQkxFLFxuICAgICAgZGF0YToge1xuICAgICAgICBpZDogcHJlcGFyZWRKb2Iuam9iSWQsXG4gICAgICAgIGpvYl9uYW1lOiBwcmVwYXJlZEpvYi5qb2JOYW1lLFxuICAgICAgICBhcmdzX2pzb246IHByZXBhcmVkSm9iLmFyZ3NKc29uLFxuICAgICAgICBleGVjdXRpb25fbW9kZTogcHJlcGFyZWRKb2IuZXhlY3V0aW9uTW9kZSxcbiAgICAgICAgcXVldWU6IHByZXBhcmVkSm9iLnF1ZXVlLFxuICAgICAgICBtYXhfcmV0cmllczogcHJlcGFyZWRKb2IubWF4UmV0cmllcyxcbiAgICAgICAgYXR0ZW1wdHM6IDAsXG4gICAgICAgIHN0YXR1czogXCJxdWV1ZWRcIixcbiAgICAgICAgc2NoZWR1bGVkX2F0X21zOiBwcmVwYXJlZEpvYi5zY2hlZHVsZWRBdE1zLFxuICAgICAgICBjcmVhdGVkX2F0X21zOiBwcmVwYXJlZEpvYi5jcmVhdGVkQXRNcyxcbiAgICAgICAgc2NoZWR1bGVfa2V5OiBzY2hlZHVsZUtleSxcbiAgICAgICAgY29uY3VycmVuY3lfa2V5OiBjb25jdXJyZW5jeT8uY29uY3VycmVuY3lLZXkgfHwgbnVsbCxcbiAgICAgICAgbWF4X2NvbmN1cnJlbmN5OiBjb25jdXJyZW5jeT8ubWF4Q29uY3VycmVuY3kgfHwgbnVsbCxcbiAgICAgICAgdGltZW91dF9tczogcHJlcGFyZWRKb2IudGltZW91dE1zLFxuICAgICAgICBoYW5kb2ZmX2lkOiBudWxsXG4gICAgICB9XG4gICAgfSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIG5vcm1hbGl6ZSBtYXggcmV0cmllcy5cbiAgICogQHBhcmFtIHtudW1iZXIgfCBudWxsIHwgdW5kZWZpbmVkfSBtYXhSZXRyaWVzIC0gSW5wdXQuXG4gICAqIEByZXR1cm5zIHtudW1iZXJ9IC0gTm9ybWFsaXplZCBtYXggcmV0cmllcy5cbiAgICovXG4gIF9ub3JtYWxpemVNYXhSZXRyaWVzKG1heFJldHJpZXMpIHtcbiAgICByZXR1cm4gbm9ybWFsaXplQmFja2dyb3VuZEpvYk1heFJldHJpZXMobWF4UmV0cmllcylcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIG5vcm1hbGl6ZSBzY2hlZHVsZWQgYXQgbXMuXG4gICAqIEBwYXJhbSB7bnVtYmVyIHwgdW5kZWZpbmVkfSBzY2hlZHVsZWRBdE1zIC0gUmVxdWVzdGVkIGRpc3BhdGNoIHRpbWVzdGFtcC5cbiAgICogQHBhcmFtIHtudW1iZXJ9IGRlZmF1bHRTY2hlZHVsZWRBdE1zIC0gRGVmYXVsdCBkaXNwYXRjaCB0aW1lc3RhbXAuXG4gICAqIEByZXR1cm5zIHtudW1iZXJ9IC0gRGlzcGF0Y2ggdGltZXN0YW1wLlxuICAgKi9cbiAgX25vcm1hbGl6ZVNjaGVkdWxlZEF0TXMoc2NoZWR1bGVkQXRNcywgZGVmYXVsdFNjaGVkdWxlZEF0TXMpIHtcbiAgICByZXR1cm4gbm9ybWFsaXplQmFja2dyb3VuZEpvYlNjaGVkdWxlZEF0TXMoc2NoZWR1bGVkQXRNcywgZGVmYXVsdFNjaGVkdWxlZEF0TXMpXG4gIH1cblxuICAvKipcbiAgICogUmVzb2x2ZXMgYSByZXNjaGVkdWxlIGRlbGF5IGFnYWluc3QgcGVyc2lzdGVuY2UgdGltZS5cbiAgICogQHBhcmFtIHtudW1iZXJ9IGRlbGF5TXMgLSBEZWxheSBpbiBtaWxsaXNlY29uZHMuXG4gICAqIEByZXR1cm5zIHtudW1iZXJ9IC0gRnV0dXJlIGVsaWdpYmlsaXR5IHRpbWVzdGFtcC5cbiAgICovXG4gIF9yZXNjaGVkdWxlZEF0TXMoZGVsYXlNcykge1xuICAgIHJldHVybiByZXNjaGVkdWxlZEJhY2tncm91bmRKb2JBdE1zKGRlbGF5TXMsIHRoaXMuY2xvY2subm93KCkpXG4gIH1cblxuICAvKipcbiAgICogVmFsaWRhdGVzIGEgcHVibGljIHJlc2NoZWR1bGUgZGVsYXkgYmVmb3JlIHBlcnNpc3RlbmNlIHdvcmsgYmVnaW5zLlxuICAgKiBAcGFyYW0ge251bWJlcn0gZGVsYXlNcyAtIERlbGF5IGluIG1pbGxpc2Vjb25kcy5cbiAgICogQHJldHVybnMge3ZvaWR9XG4gICAqL1xuICBfdmFsaWRhdGVSZXNjaGVkdWxlRGVsYXlNcyhkZWxheU1zKSB7XG4gICAgcmVzY2hlZHVsZWRCYWNrZ3JvdW5kSm9iQXRNcyhkZWxheU1zLCAwKVxuICB9XG5cbiAgLyoqXG4gICAqIFZhbGlkYXRlcyBhIHN0YWJsZSBzY2hlZHVsZSBrZXkgYXQgdGhlIHB1YmxpYyBzdG9yYWdlIGJvdW5kYXJ5LlxuICAgKiBAcGFyYW0ge3N0cmluZ30gc2NoZWR1bGVLZXkgLSBTdGFibGUgbG9naWNhbCBzY2hlZHVsZSBrZXkuXG4gICAqIEByZXR1cm5zIHtzdHJpbmd9IC0gVmFsaWRhdGVkIGtleS5cbiAgICovXG4gIF9ub3JtYWxpemVTY2hlZHVsZUtleShzY2hlZHVsZUtleSkge1xuICAgIGlmICh0eXBlb2Ygc2NoZWR1bGVLZXkgPT09IFwic3RyaW5nXCIgJiYgc2NoZWR1bGVLZXkubGVuZ3RoID4gMCAmJiBzY2hlZHVsZUtleS5sZW5ndGggPD0gMjU1KSByZXR1cm4gc2NoZWR1bGVLZXlcblxuICAgIHRocm93IFZlbG9jaW91c0Vycm9yLnNhZmUoXCJiYWNrZ3JvdW5kIGpvYiBzY2hlZHVsZUtleSBtdXN0IGJlIGEgbm9uLWVtcHR5IHN0cmluZyBvZiBhdCBtb3N0IDI1NSBjaGFyYWN0ZXJzXCIpXG4gIH1cblxuICAvKipcbiAgICogQnVpbGRzIGEgYm91bmRlZCBhZHZpc29yeS1sb2NrIG5hbWUgZm9yIG9uZSBzdGFibGUgc2NoZWR1bGUga2V5LlxuICAgKiBAcGFyYW0ge3N0cmluZ30gc2NoZWR1bGVLZXkgLSBWYWxpZGF0ZWQgc3RhYmxlIHNjaGVkdWxlIGtleS5cbiAgICogQHJldHVybnMge3N0cmluZ30gLSBBZHZpc29yeS1sb2NrIG5hbWUuXG4gICAqL1xuICBfc2NoZWR1bGVLZXlMb2NrTmFtZShzY2hlZHVsZUtleSkge1xuICAgIGNvbnN0IGhhc2ggPSBjcmVhdGVIYXNoKFwic2hhMjU2XCIpLnVwZGF0ZShzY2hlZHVsZUtleSkuZGlnZXN0KFwiaGV4XCIpLnNsaWNlKDAsIDMyKVxuXG4gICAgcmV0dXJuIGBiYWNrZ3JvdW5kLWpvYnM6c2NoZWR1bGU6JHtoYXNofWBcbiAgfVxuXG4gIC8qKlxuICAgKiBFbnN1cmVzIHRoZSBiYWNrZ3JvdW5kLWpvYnMgc2NoZW1hIGV4aXN0cywgcmV1c2luZyBhIGNhbGxlci1oZWxkIGNvbm5lY3Rpb24gd2hlblxuICAgKiBvbmUgaXMgZ2l2ZW4gcmF0aGVyIHRoYW4gY2hlY2tpbmcgb3V0IGl0cyBvd24uXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vZGF0YWJhc2UvZHJpdmVycy9iYXNlLmpzXCIpLmRlZmF1bHR9IFtleGlzdGluZ0RiXSAtIFJldXNlIGFuXG4gICAqICAgYWxyZWFkeS1jaGVja2VkLW91dCBjb25uZWN0aW9uIChlLmcuIHRoZSBvbmUgYGRiOm1pZ3JhdGVgIGhvbGRzKSBpbnN0ZWFkIG9mXG4gICAqICAgY2hlY2tpbmcgb3V0IGEgbmVzdGVkIG9uZSDigJQgdGhlIG5lc3RlZCBjaGVja291dCB3b3VsZCBkZWFkbG9jayBhIGRhdGFiYXNlXG4gICAqICAgd2hvc2UgcG9vbCBpcyBjYXBwZWQgYXQgYSBzaW5nbGUgY29ubmVjdGlvbiBhbHJlYWR5IGhlbGQgYnkgdGhlIGNhbGxlci5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgd2hlbiB0aGUgc2NoZW1hIGlzIHByZXNlbnQuXG4gICAqL1xuICBhc3luYyBfZW5zdXJlU2NoZW1hKGV4aXN0aW5nRGIpIHtcbiAgICBhd2FpdCB0aGlzLl9hcHBseVNjaGVtYShleGlzdGluZ0RiKVxuICB9XG5cbiAgLyoqXG4gICAqIFNlcmlhbGl6ZXMgY3JlYXRpb24gb3IgdXBncmFkZSBvZiB0aGUgYmFja2dyb3VuZC1qb2JzIHNjaGVtYSwgY2hlY2tpbmcgb3V0IGFcbiAgICogY29ubmVjdGlvbiBvbmx5IGFmdGVyIGVhcmxpZXIgc2NoZW1hIHdvcmsgaGFzIGNvbXBsZXRlZCB3aGVuIG9uZSBpcyBub3Qgc3VwcGxpZWQuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vZGF0YWJhc2UvZHJpdmVycy9iYXNlLmpzXCIpLmRlZmF1bHR9IFtleGlzdGluZ0RiXSAtIENhbGxlci1vd25lZFxuICAgKiAgIGRhdGFiYXNlIGNvbm5lY3Rpb24uXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIHdoZW4gdGhlIHNjaGVtYSBpcyBwcmVzZW50LlxuICAgKi9cbiAgYXN5bmMgX2FwcGx5U2NoZW1hKGV4aXN0aW5nRGIpIHtcbiAgICAvLyBTZXJpYWxpemUgY29uY3VycmVudCBzY2hlbWEgYXBwbGllcyB3aXRoaW4gdGhpcyBwcm9jZXNzLCBrZXllZCBieSBkYXRhYmFzZVxuICAgIC8vIGlkZW50aWZpZXIgKHNlZSBgc2NoZW1hQXBwbHlDaGFpbnNgKS4gVGhlIHBlci1zdGVwIGxvY2tzIGluc2lkZSB0aGUgc3RlcHMgdXNlXG4gICAgLy8gRElGRkVSRU5UIGxvY2sgbmFtZXMsIHNvIHR3byBjb25jdXJyZW50IGNhbGxlcnMgY291bGQgb3RoZXJ3aXNlIGVhY2ggaG9sZCBhXG4gICAgLy8gZGlmZmVyZW50IHN0ZXAgbG9jayB3aGlsZSBib3RoIHJlYnVpbGQgdGhlIGpvYnMgdGFibGUg4oCUIGFuZCBvbiBTUUxpdGUvTVNTUUwgYW5cbiAgICAvLyBhZGQtY29sdW1uIGlzIGEgY3JlYXRlLWNvcHktZHJvcC1yZW5hbWUgcmVidWlsZCwgc28gb3ZlcmxhcHBpbmcgcmVidWlsZHNcbiAgICAvLyBjb3JydXB0IGl0LiBUaGlzIG11dGV4IG1ha2VzIHRoZSB3aG9sZSBhcHBseSBtdXR1YWxseSBleGNsdXNpdmUgcGVyIHByb2Nlc3M7XG4gICAgLy8gdGhlIHNlY29uZCBjYWxsZXIgdGhlbiByZS1jaGVja3MgYW5kIGZpbmRzIGV2ZXJ5IHN0ZXAgYWxyZWFkeSBkb25lLlxuICAgIGNvbnN0IGlkZW50aWZpZXIgPSB0aGlzLmdldERhdGFiYXNlSWRlbnRpZmllcigpID8/IFwiZGVmYXVsdFwiXG4gICAgY29uc3QgcHJldmlvdXMgPSBzY2hlbWFBcHBseUNoYWlucy5nZXQoaWRlbnRpZmllcikgPz8gUHJvbWlzZS5yZXNvbHZlKClcbiAgICBjb25zdCBhcHBseVdpdGhDb25uZWN0aW9uID0gYXN5bmMgKCkgPT4ge1xuICAgICAgaWYgKGV4aXN0aW5nRGIpIHtcbiAgICAgICAgYXdhaXQgdGhpcy5fYXBwbHlTY2hlbWFTdGVwcyhleGlzdGluZ0RiKVxuXG4gICAgICAgIHJldHVyblxuICAgICAgfVxuXG4gICAgICBhd2FpdCB0aGlzLl93aXRoRGIoKGRiKSA9PiB0aGlzLl9hcHBseVNjaGVtYVN0ZXBzKGRiKSlcbiAgICB9XG4gICAgY29uc3QgcnVuID0gcHJldmlvdXMudGhlbihhcHBseVdpdGhDb25uZWN0aW9uLCBhcHBseVdpdGhDb25uZWN0aW9uKVxuXG4gICAgLy8gS2VlcCB0aGUgY2hhaW4gYWxpdmUgcmVnYXJkbGVzcyBvZiB0aGlzIHJ1bidzIG91dGNvbWUgc28gb25lIGZhaWxlZCBhcHBseSBkb2VzXG4gICAgLy8gbm90IHdlZGdlIGxhdGVyIGNhbGxlcnM7IHRoaXMgcnVuIHN0aWxsIHByb3BhZ2F0ZXMgaXRzIG93biByZXN1bHQvZXJyb3IuXG4gICAgc2NoZW1hQXBwbHlDaGFpbnMuc2V0KGlkZW50aWZpZXIsIHJ1bi50aGVuKCgpID0+IHt9LCAoKSA9PiB7fSkpXG5cbiAgICByZXR1cm4gYXdhaXQgcnVuXG4gIH1cblxuICAvKipcbiAgICogQ3JlYXRlcyBvciB1cGdyYWRlcyB0aGUgYmFja2dyb3VuZC1qb2JzIHRhYmxlcywgY29sdW1ucyBhbmQgY29uY3VycmVuY3kgcm93cyBvblxuICAgKiB0aGUgZ2l2ZW4gY29ubmVjdGlvbi4gU2VyaWFsaXplZCBwZXIgcHJvY2VzcyBieSB7QGxpbmsgQmFja2dyb3VuZEpvYnNTdG9yZSNfYXBwbHlTY2hlbWF9LlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL2RhdGFiYXNlL2RyaXZlcnMvYmFzZS5qc1wiKS5kZWZhdWx0fSBkYiAtIERhdGFiYXNlIGNvbm5lY3Rpb24uXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIHdoZW4gdGhlIHNjaGVtYSBpcyBwcmVzZW50LlxuICAgKi9cbiAgYXN5bmMgX2FwcGx5U2NoZW1hU3RlcHMoZGIpIHtcbiAgICBhd2FpdCB0aGlzLl9lbnN1cmVNaWdyYXRpb25zVGFibGUoZGIpXG5cbiAgICBjb25zdCBhbHJlYWR5QXBwbGllZCA9IGF3YWl0IHRoaXMuX2hhc01pZ3JhdGlvbihkYilcbiAgICBjb25zdCBzY2hlbWFSZWNvdmVyeVBlbmRpbmcgPSBhd2FpdCB0aGlzLl9oYXNNaWdyYXRpb24oZGIsIFNDSEVNQV9SRUNPVkVSWV9QRU5ESU5HX1ZFUlNJT04pXG4gICAgY29uc3Qgam9ic1RhYmxlRXhpc3RzID0gYXdhaXQgZGIudGFibGVFeGlzdHMoSk9CU19UQUJMRSlcblxuICAgIC8vIEV2ZW4gd2hlbiB0aGUgbWlncmF0aW9uIHJvdyBpcyBwcmVzZW50LCB0aGUgam9icyB0YWJsZSBpdHNlbGYgY2FuIGhhdmVcbiAgICAvLyBiZWVuIGRyb3BwZWQgdW5kZXJuZWF0aCB1cyBieSBhIHRyYW5zYWN0aW9uIHJvbGxiYWNrIGluIGFub3RoZXIgY2FsbGVyXG4gICAgLy8gKERETCBpcyB0cmFuc2FjdGlvbmFsIG9uIFNRTGl0ZS9NU1NRTCkuIFZlcmlmeSB0aGUgdGFibGUgcGh5c2ljYWxseVxuICAgIC8vIGV4aXN0cyBhbmQgcmVjcmVhdGUgaXQgd2hlbiBtaXNzaW5nIHJhdGhlciB0aGFuIHRydXN0aW5nIHRoZSBtaWdyYXRpb25cbiAgICAvLyByb3cgYWxvbmUsIG90aGVyd2lzZSBsYXRlciBjYWxsZXJzIGZhaWwgd2l0aCBcIm5vIHN1Y2ggdGFibGVcIi5cbiAgICBpZiAoYWxyZWFkeUFwcGxpZWQgJiYgam9ic1RhYmxlRXhpc3RzICYmICFzY2hlbWFSZWNvdmVyeVBlbmRpbmcpIHtcbiAgICAgIGF3YWl0IHRoaXMuX2Vuc3VyZUpvYnNUYWJsZUNvbHVtbnMoZGIpXG4gICAgICBhd2FpdCB0aGlzLl9lbnN1cmVJZGVtcG90ZW5jeUtleXNUYWJsZShkYilcbiAgICAgIGF3YWl0IHRoaXMuX2Vuc3VyZU1haWxEZWxpdmVyeU9wZXJhdGlvbnNUYWJsZShkYilcbiAgICAgIGF3YWl0IHRoaXMuX2Vuc3VyZVNjaGVkdWxlS2V5c1RhYmxlKGRiKVxuICAgICAgYXdhaXQgdGhpcy5fZW5zdXJlQ29uY3VycmVuY3lUYWJsZShkYilcbiAgICAgIGF3YWl0IHRoaXMuX2Vuc3VyZUNvdW50UmV2aXNpb25UYWJsZShkYilcblxuICAgICAgcmV0dXJuXG4gICAgfVxuXG4gICAgaWYgKGFscmVhZHlBcHBsaWVkICYmICFzY2hlbWFSZWNvdmVyeVBlbmRpbmcpIHtcbiAgICAgIGF3YWl0IHRoaXMuX3JlY29yZE1pZ3JhdGlvbihkYiwgU0NIRU1BX1JFQ09WRVJZX1BFTkRJTkdfVkVSU0lPTilcbiAgICB9XG5cbiAgICBhd2FpdCB0aGlzLl9hcHBseU1pZ3JhdGlvbnMoZGIpXG4gICAgYXdhaXQgdGhpcy5fZW5zdXJlSm9ic1RhYmxlQ29sdW1ucyhkYilcbiAgICBhd2FpdCB0aGlzLl9lbnN1cmVJZGVtcG90ZW5jeUtleXNUYWJsZShkYilcbiAgICBhd2FpdCB0aGlzLl9lbnN1cmVNYWlsRGVsaXZlcnlPcGVyYXRpb25zVGFibGUoZGIpXG4gICAgYXdhaXQgdGhpcy5fZW5zdXJlU2NoZWR1bGVLZXlzVGFibGUoZGIpXG4gICAgYXdhaXQgdGhpcy5fZW5zdXJlQ29uY3VycmVuY3lUYWJsZShkYilcbiAgICBhd2FpdCB0aGlzLl9lbnN1cmVDb3VudFJldmlzaW9uVGFibGUoZGIpXG5cbiAgICBpZiAoYWxyZWFkeUFwcGxpZWQpIHtcbiAgICAgIC8vIFRoZSByZWNyZWF0ZWQgam9icyB0YWJsZSBpcyBlbXB0eSwgYnV0IHRoZSBzdXJ2aXZpbmcgY29uY3VycmVuY3kgdGFibGVcbiAgICAgIC8vIGNhbiBzdGlsbCBjb3VudCBoYW5kb2ZmcyB0aGF0IGRpc2FwcGVhcmVkIHdpdGggdGhlIGRyb3BwZWQgam9icyB0YWJsZS5cbiAgICAgIGF3YWl0IHRoaXMuX3JlY29uY2lsZUNvbmN1cnJlbmN5KGRiKVxuICAgICAgYXdhaXQgZGIuZGVsZXRlKHtcbiAgICAgICAgdGFibGVOYW1lOiBNSUdSQVRJT05TX1RBQkxFLFxuICAgICAgICBjb25kaXRpb25zOiB7a2V5OiB0aGlzLl9taWdyYXRpb25LZXkoU0NIRU1BX1JFQ09WRVJZX1BFTkRJTkdfVkVSU0lPTil9XG4gICAgICB9KVxuXG4gICAgICByZXR1cm5cbiAgICB9XG5cbiAgICBhd2FpdCB0aGlzLl9yZWNvcmRNaWdyYXRpb24oZGIsIE1JR1JBVElPTl9WRVJTSU9OKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZW5zdXJlIG1pZ3JhdGlvbnMgdGFibGUuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vZGF0YWJhc2UvZHJpdmVycy9iYXNlLmpzXCIpLmRlZmF1bHR9IGRiIC0gRGF0YWJhc2UgY29ubmVjdGlvbi5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgd2hlbiBjb21wbGV0ZS5cbiAgICovXG4gIGFzeW5jIF9lbnN1cmVNaWdyYXRpb25zVGFibGUoZGIpIHtcbiAgICBpZiAoYXdhaXQgZGIudGFibGVFeGlzdHMoTUlHUkFUSU9OU19UQUJMRSkpIHJldHVyblxuXG4gICAgY29uc3QgdGFibGUgPSBuZXcgVGFibGVEYXRhKE1JR1JBVElPTlNfVEFCTEUsIHtpZk5vdEV4aXN0czogdHJ1ZX0pXG5cbiAgICB0YWJsZS5zdHJpbmcoXCJrZXlcIiwge251bGw6IGZhbHNlLCBwcmltYXJ5S2V5OiB0cnVlfSlcbiAgICB0YWJsZS5zdHJpbmcoXCJzY29wZVwiLCB7bnVsbDogZmFsc2V9KVxuICAgIHRhYmxlLnN0cmluZyhcInZlcnNpb25cIiwge251bGw6IGZhbHNlfSlcbiAgICB0YWJsZS5iaWdpbnQoXCJhcHBsaWVkX2F0X21zXCIsIHtudWxsOiBmYWxzZX0pXG5cbiAgICBhd2FpdCBkYi5jcmVhdGVUYWJsZSh0YWJsZSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGhhcyBtaWdyYXRpb24uXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vZGF0YWJhc2UvZHJpdmVycy9iYXNlLmpzXCIpLmRlZmF1bHR9IGRiIC0gRGF0YWJhc2UgY29ubmVjdGlvbi5cbiAgICogQHBhcmFtIHtzdHJpbmd9IFt2ZXJzaW9uXSAtIE1pZ3JhdGlvbiB2ZXJzaW9uLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxib29sZWFuPn0gLSBXaGV0aGVyIG1pZ3JhdGlvbiBleGlzdHMuXG4gICAqL1xuICBhc3luYyBfaGFzTWlncmF0aW9uKGRiLCB2ZXJzaW9uID0gTUlHUkFUSU9OX1ZFUlNJT04pIHtcbiAgICBjb25zdCBxdWVyeSA9IGRiXG4gICAgICAubmV3UXVlcnkoKVxuICAgICAgLmZyb20oTUlHUkFUSU9OU19UQUJMRSlcbiAgICAgIC53aGVyZSh7a2V5OiB0aGlzLl9taWdyYXRpb25LZXkodmVyc2lvbil9KVxuICAgICAgLmxpbWl0KDEpXG5cbiAgICBjb25zdCByb3dzID0gYXdhaXQgcXVlcnkucmVzdWx0cygpXG5cbiAgICByZXR1cm4gcm93cy5sZW5ndGggPiAwXG4gIH1cblxuICAvKipcbiAgICogUnVucyBhcHBseSBtaWdyYXRpb25zLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL2RhdGFiYXNlL2RyaXZlcnMvYmFzZS5qc1wiKS5kZWZhdWx0fSBkYiAtIERhdGFiYXNlIGNvbm5lY3Rpb24uXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIHdoZW4gY29tcGxldGUuXG4gICAqL1xuICBhc3luYyBfYXBwbHlNaWdyYXRpb25zKGRiKSB7XG4gICAgdGhpcy5sb2dnZXIuaW5mbyhcIkFwcGx5aW5nIGJhY2tncm91bmQgam9icyBzY2hlbWFcIilcblxuICAgIGlmIChhd2FpdCBkYi50YWJsZUV4aXN0cyhKT0JTX1RBQkxFKSkge1xuICAgICAgdGhpcy5sb2dnZXIuaW5mbyhcIkJhY2tncm91bmQgam9icyB0YWJsZSBhbHJlYWR5IGV4aXN0cyAtIHNraXBwaW5nIGNyZWF0ZVwiKVxuICAgICAgcmV0dXJuXG4gICAgfVxuXG4gICAgY29uc3QgdGFibGUgPSBuZXcgVGFibGVEYXRhKEpPQlNfVEFCTEUsIHtpZk5vdEV4aXN0czogdHJ1ZX0pXG5cbiAgICB0YWJsZS5zdHJpbmcoXCJpZFwiLCB7cHJpbWFyeUtleTogdHJ1ZX0pXG4gICAgdGFibGUuc3RyaW5nKFwiam9iX25hbWVcIiwge251bGw6IGZhbHNlLCBpbmRleDogdHJ1ZX0pXG4gICAgdGFibGUudGV4dChcImFyZ3NfanNvblwiLCB7bnVsbDogZmFsc2V9KVxuICAgIHRhYmxlLnN0cmluZyhcImV4ZWN1dGlvbl9tb2RlXCIsIHtudWxsOiBmYWxzZX0pXG4gICAgdGFibGUuc3RyaW5nKFwicXVldWVcIiwge251bGw6IHRydWUsIGluZGV4OiB0cnVlfSlcbiAgICB0YWJsZS5pbnRlZ2VyKFwibWF4X3JldHJpZXNcIiwge251bGw6IGZhbHNlfSlcbiAgICB0YWJsZS5pbnRlZ2VyKFwiYXR0ZW1wdHNcIiwge251bGw6IGZhbHNlfSlcbiAgICB0YWJsZS5zdHJpbmcoXCJzdGF0dXNcIiwge251bGw6IGZhbHNlLCBpbmRleDogdHJ1ZX0pXG4gICAgdGFibGUuYmlnaW50KFwic2NoZWR1bGVkX2F0X21zXCIsIHtudWxsOiBmYWxzZSwgaW5kZXg6IHRydWV9KVxuICAgIHRhYmxlLmJpZ2ludChcImNyZWF0ZWRfYXRfbXNcIiwge251bGw6IGZhbHNlLCBpbmRleDogdHJ1ZX0pXG4gICAgdGFibGUuc3RyaW5nKFwic2NoZWR1bGVfa2V5XCIsIHtudWxsOiB0cnVlLCBpbmRleDogdHJ1ZX0pXG4gICAgdGFibGUuYmlnaW50KFwiaGFuZGVkX29mZl9hdF9tc1wiLCB7bnVsbDogdHJ1ZSwgaW5kZXg6IHRydWV9KVxuICAgIHRhYmxlLnN0cmluZyhcImhhbmRvZmZfaWRcIiwge251bGw6IHRydWV9KVxuICAgIHRhYmxlLmJpZ2ludChcImNvbXBsZXRlZF9hdF9tc1wiLCB7bnVsbDogdHJ1ZX0pXG4gICAgdGFibGUuYmlnaW50KFwiZmFpbGVkX2F0X21zXCIsIHtudWxsOiB0cnVlfSlcbiAgICB0YWJsZS5iaWdpbnQoXCJvcnBoYW5lZF9hdF9tc1wiLCB7bnVsbDogdHJ1ZSwgaW5kZXg6IHRydWV9KVxuICAgIHRhYmxlLnN0cmluZyhcIndvcmtlcl9pZFwiLCB7bnVsbDogdHJ1ZX0pXG4gICAgdGFibGUudGV4dChcImxhc3RfZXJyb3JcIiwge251bGw6IHRydWV9KVxuICAgIHRhYmxlLnN0cmluZyhcImNvbmN1cnJlbmN5X2tleVwiLCB7bnVsbDogdHJ1ZSwgaW5kZXg6IHRydWV9KVxuICAgIHRhYmxlLmludGVnZXIoXCJtYXhfY29uY3VycmVuY3lcIiwge251bGw6IHRydWV9KVxuICAgIHRhYmxlLmJpZ2ludChcInRpbWVvdXRfbXNcIiwge251bGw6IHRydWV9KVxuXG4gICAgYXdhaXQgZGIuY3JlYXRlVGFibGUodGFibGUpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBlbnN1cmUgam9icyB0YWJsZSBjb2x1bW5zLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL2RhdGFiYXNlL2RyaXZlcnMvYmFzZS5qc1wiKS5kZWZhdWx0fSBkYiAtIERhdGFiYXNlIGNvbm5lY3Rpb24uXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIHdoZW4gY29tcGxldGUuXG4gICAqL1xuICBhc3luYyBfZW5zdXJlSm9ic1RhYmxlQ29sdW1ucyhkYikge1xuICAgIGlmICghKGF3YWl0IGRiLnRhYmxlRXhpc3RzKEpPQlNfVEFCTEUpKSkgcmV0dXJuXG5cbiAgICBjb25zdCB0YWJsZSA9IGF3YWl0IGRiLmdldFRhYmxlQnlOYW1lT3JGYWlsKEpPQlNfVEFCTEUpXG4gICAgY29uc3QgZXhlY3V0aW9uTW9kZUNvbHVtbiA9IGF3YWl0IHRhYmxlLmdldENvbHVtbkJ5TmFtZShcImV4ZWN1dGlvbl9tb2RlXCIpXG5cbiAgICBpZiAoIWV4ZWN1dGlvbk1vZGVDb2x1bW4pIHtcbiAgICAgIGNvbnN0IHRhYmxlRGF0YSA9IG5ldyBUYWJsZURhdGEoSk9CU19UQUJMRSlcbiAgICAgIHRhYmxlRGF0YS5zdHJpbmcoXCJleGVjdXRpb25fbW9kZVwiLCB7bnVsbDogdHJ1ZX0pXG4gICAgICBjb25zdCBzcWxzID0gYXdhaXQgZGIuYWx0ZXJUYWJsZVNRTHModGFibGVEYXRhKVxuXG4gICAgICBmb3IgKGNvbnN0IHNxbCBvZiBzcWxzKSB7XG4gICAgICAgIGF3YWl0IGRiLnF1ZXJ5KHNxbClcbiAgICAgIH1cblxuICAgICAgZGIuY2xlYXJTY2hlbWFDYWNoZSgpXG4gICAgfVxuXG4gICAgY29uc3QgcmVmcmVzaGVkVGFibGUgPSBhd2FpdCBkYi5nZXRUYWJsZUJ5TmFtZU9yRmFpbChKT0JTX1RBQkxFKVxuICAgIGNvbnN0IGhhbmRvZmZJZENvbHVtbiA9IGF3YWl0IHJlZnJlc2hlZFRhYmxlLmdldENvbHVtbkJ5TmFtZShcImhhbmRvZmZfaWRcIilcblxuICAgIGlmICghaGFuZG9mZklkQ29sdW1uKSB7XG4gICAgICBjb25zdCBsb2NrTmFtZSA9IGAke01JR1JBVElPTl9TQ09QRX06aGFuZG9mZl9pZF9jb2x1bW5gXG4gICAgICBjb25zdCBhY3F1aXJlZCA9IGF3YWl0IGRiLmFjcXVpcmVBZHZpc29yeUxvY2sobG9ja05hbWUpXG5cbiAgICAgIGlmICghYWNxdWlyZWQpIHRocm93IG5ldyBFcnJvcihcIkZhaWxlZCB0byBhY3F1aXJlIGJhY2tncm91bmQgam9icyBoYW5kb2ZmIHNjaGVtYSBsb2NrXCIpXG5cbiAgICAgIHRyeSB7XG4gICAgICAgIGRiLmNsZWFyU2NoZW1hQ2FjaGUoKVxuICAgICAgICBjb25zdCBsb2NrZWRUYWJsZSA9IGF3YWl0IGRiLmdldFRhYmxlQnlOYW1lT3JGYWlsKEpPQlNfVEFCTEUpXG5cbiAgICAgICAgaWYgKCEoYXdhaXQgbG9ja2VkVGFibGUuZ2V0Q29sdW1uQnlOYW1lKFwiaGFuZG9mZl9pZFwiKSkpIHtcbiAgICAgICAgICBjb25zdCB0YWJsZURhdGEgPSBuZXcgVGFibGVEYXRhKEpPQlNfVEFCTEUpXG4gICAgICAgICAgdGFibGVEYXRhLnN0cmluZyhcImhhbmRvZmZfaWRcIiwge251bGw6IHRydWV9KVxuICAgICAgICAgIGNvbnN0IHNxbHMgPSBhd2FpdCBkYi5hbHRlclRhYmxlU1FMcyh0YWJsZURhdGEpXG5cbiAgICAgICAgICBmb3IgKGNvbnN0IHNxbCBvZiBzcWxzKSB7XG4gICAgICAgICAgICBhd2FpdCBkYi5xdWVyeShzcWwpXG4gICAgICAgICAgfVxuXG4gICAgICAgICAgZGIuY2xlYXJTY2hlbWFDYWNoZSgpXG4gICAgICAgIH1cbiAgICAgIH0gZmluYWxseSB7XG4gICAgICAgIGF3YWl0IGRiLnJlbGVhc2VBZHZpc29yeUxvY2sobG9ja05hbWUpXG4gICAgICB9XG4gICAgfVxuXG4gICAgYXdhaXQgdGhpcy5fYmFja2ZpbGxFeGVjdXRpb25Nb2Rlc09uY2UoZGIpXG4gICAgYXdhaXQgdGhpcy5fZHJvcEZvcmtlZENvbHVtbk9uY2UoZGIpXG5cbiAgICBjb25zdCBsb2NrTmFtZSA9IGAke01JR1JBVElPTl9TQ09QRX06Y29uY3VycmVuY3lfY29sdW1uc2BcbiAgICBjb25zdCBhY3F1aXJlZCA9IGF3YWl0IGRiLmFjcXVpcmVBZHZpc29yeUxvY2sobG9ja05hbWUpXG5cbiAgICBpZiAoIWFjcXVpcmVkKSB0aHJvdyBuZXcgRXJyb3IoXCJGYWlsZWQgdG8gYWNxdWlyZSBiYWNrZ3JvdW5kIGpvYnMgY29uY3VycmVuY3kgc2NoZW1hIGxvY2tcIilcblxuICAgIHRyeSB7XG4gICAgICAvLyBTUUwgU2VydmVyIHNjaGVtYSByZWFkcyBjYW4gZGVhZGxvY2sgd2l0aCBhIGNvbmN1cnJlbnQgQUxURVIgVEFCTEUsIHNvXG4gICAgICAvLyBhY3F1aXJlIHRoZSBsb2NrIGJlZm9yZSBpbnNwZWN0aW5nIGVpdGhlciBjb2x1bW4gcmF0aGVyIHRoYW4gb25seVxuICAgICAgLy8gcHJvdGVjdGluZyB0aGUgbXV0YXRpb24uXG4gICAgICBkYi5jbGVhclNjaGVtYUNhY2hlKClcbiAgICAgIGNvbnN0IGxvY2tlZFRhYmxlID0gYXdhaXQgZGIuZ2V0VGFibGVCeU5hbWVPckZhaWwoSk9CU19UQUJMRSlcbiAgICAgIGNvbnN0IGNvbmN1cnJlbmN5Q29sdW1uTmFtZXMgPSBbXCJjb25jdXJyZW5jeV9rZXlcIiwgXCJtYXhfY29uY3VycmVuY3lcIl1cblxuICAgICAgZm9yIChjb25zdCBjb25jdXJyZW5jeUNvbHVtbk5hbWUgb2YgY29uY3VycmVuY3lDb2x1bW5OYW1lcykge1xuICAgICAgICBpZiAoYXdhaXQgbG9ja2VkVGFibGUuZ2V0Q29sdW1uQnlOYW1lKGNvbmN1cnJlbmN5Q29sdW1uTmFtZSkpIGNvbnRpbnVlXG5cbiAgICAgICAgY29uc3QgdGFibGVEYXRhID0gbmV3IFRhYmxlRGF0YShKT0JTX1RBQkxFKVxuICAgICAgICBpZiAoY29uY3VycmVuY3lDb2x1bW5OYW1lID09IFwiY29uY3VycmVuY3lfa2V5XCIpIHtcbiAgICAgICAgICB0YWJsZURhdGEuc3RyaW5nKFwiY29uY3VycmVuY3lfa2V5XCIsIHtudWxsOiB0cnVlLCBpbmRleDogdHJ1ZX0pXG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgdGFibGVEYXRhLmludGVnZXIoXCJtYXhfY29uY3VycmVuY3lcIiwge251bGw6IHRydWV9KVxuICAgICAgICB9XG5cbiAgICAgICAgZm9yIChjb25zdCBzcWwgb2YgYXdhaXQgZGIuYWx0ZXJUYWJsZVNRTHModGFibGVEYXRhKSkgYXdhaXQgZGIucXVlcnkoc3FsKVxuICAgICAgfVxuXG4gICAgICBkYi5jbGVhclNjaGVtYUNhY2hlKClcbiAgICB9IGZpbmFsbHkge1xuICAgICAgYXdhaXQgZGIucmVsZWFzZUFkdmlzb3J5TG9jayhsb2NrTmFtZSlcbiAgICB9XG5cbiAgICBhd2FpdCB0aGlzLl9lbnN1cmVRdWV1ZUNvbHVtbihkYilcbiAgICBhd2FpdCB0aGlzLl9lbnN1cmVTY2hlZHVsZUtleUNvbHVtbihkYilcbiAgICBhd2FpdCB0aGlzLl9lbnN1cmVKb2JUaW1lb3V0Q29sdW1uKGRiKVxuICAgIGF3YWl0IHRoaXMuX2Vuc3VyZUpvYnNUYWJsZUluZGV4ZXNPbmNlKGRiKVxuICB9XG5cbiAgLyoqXG4gICAqIFJlcGFpcnMgc2Vjb25kYXJ5IGluZGV4ZXMgdGhhdCBvbGRlciBhZGQtY29sdW1uIHVwZ3JhZGVzIGRlY2xhcmVkIGJ1dCBkaWRcbiAgICogbm90IGNyZWF0ZSBvbiBldmVyeSBTUUwgZHJpdmVyLiBUaGUgbWlncmF0aW9uIGxlZGdlciBrZWVwcyByb3V0aW5lIHN0b3JlXG4gICAqIHJlYWRpbmVzcyBmcm9tIHJlcGVhdGVkbHkgaW50cm9zcGVjdGluZyB0aGUgZnVsbCBpbmRleCBzZXQuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vZGF0YWJhc2UvZHJpdmVycy9iYXNlLmpzXCIpLmRlZmF1bHR9IGRiIC0gRGF0YWJhc2UgY29ubmVjdGlvbi5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgd2hlbiBhbGwgZXhwZWN0ZWQgaW5kZXhlcyBleGlzdC5cbiAgICovXG4gIGFzeW5jIF9lbnN1cmVKb2JzVGFibGVJbmRleGVzT25jZShkYikge1xuICAgIGNvbnN0IG1pZ3JhdGlvblZlcnNpb24gPSBKT0JTX0lOREVYX1JFUEFJUl9NSUdSQVRJT05fVkVSU0lPTlxuICAgIGNvbnN0IG1pZ3JhdGlvbktleSA9IHRoaXMuX21pZ3JhdGlvbktleShtaWdyYXRpb25WZXJzaW9uKVxuXG4gICAgaWYgKGF3YWl0IHRoaXMuX2hhc01pZ3JhdGlvbihkYiwgbWlncmF0aW9uVmVyc2lvbikpIHJldHVyblxuXG4gICAgY29uc3QgYWNxdWlyZWQgPSBhd2FpdCBkYi5hY3F1aXJlQWR2aXNvcnlMb2NrKG1pZ3JhdGlvbktleSlcblxuICAgIGlmICghYWNxdWlyZWQpIHRocm93IG5ldyBFcnJvcihcIkZhaWxlZCB0byBhY3F1aXJlIGJhY2tncm91bmQgam9icyBpbmRleCByZXBhaXIgbG9ja1wiKVxuXG4gICAgdHJ5IHtcbiAgICAgIGlmIChhd2FpdCB0aGlzLl9oYXNNaWdyYXRpb24oZGIsIG1pZ3JhdGlvblZlcnNpb24pKSByZXR1cm5cblxuICAgICAgZGIuY2xlYXJTY2hlbWFDYWNoZSgpXG4gICAgICBjb25zdCB0YWJsZSA9IGF3YWl0IGRiLmdldFRhYmxlQnlOYW1lT3JGYWlsKEpPQlNfVEFCTEUpXG4gICAgICBjb25zdCBpbmRleGVkQ29sdW1uTmFtZXMgPSBuZXcgU2V0KFxuICAgICAgICAoYXdhaXQgdGFibGUuZ2V0SW5kZXhlcygpKVxuICAgICAgICAgIC5maWx0ZXIoKGluZGV4KSA9PiAhaW5kZXguaXNQcmltYXJ5S2V5KCkgJiYgaW5kZXguZ2V0Q29sdW1uTmFtZXMoKS5sZW5ndGggPT09IDEpXG4gICAgICAgICAgLm1hcCgoaW5kZXgpID0+IGluZGV4LmdldENvbHVtbk5hbWVzKClbMF0pXG4gICAgICApXG5cbiAgICAgIGZvciAoY29uc3QgY29sdW1uTmFtZSBvZiBKT0JTX0lOREVYX0NPTFVNTl9OQU1FUykge1xuICAgICAgICBpZiAoaW5kZXhlZENvbHVtbk5hbWVzLmhhcyhjb2x1bW5OYW1lKSkgY29udGludWVcblxuICAgICAgICBmb3IgKGNvbnN0IHNxbCBvZiBhd2FpdCBkYi5jcmVhdGVJbmRleFNRTHMoe2NvbHVtbnM6IFtjb2x1bW5OYW1lXSwgaWZOb3RFeGlzdHM6IGRiLmdldFR5cGUoKSA9PT0gXCJzcWxpdGVcIiwgdGFibGVOYW1lOiBKT0JTX1RBQkxFfSkpIHtcbiAgICAgICAgICBhd2FpdCBkYi5xdWVyeShzcWwpXG4gICAgICAgIH1cbiAgICAgIH1cblxuICAgICAgZGIuY2xlYXJTY2hlbWFDYWNoZSgpXG4gICAgICBhd2FpdCB0aGlzLl9yZWNvcmRNaWdyYXRpb24oZGIsIG1pZ3JhdGlvblZlcnNpb24pXG4gICAgfSBmaW5hbGx5IHtcbiAgICAgIGF3YWl0IGRiLnJlbGVhc2VBZHZpc29yeUxvY2sobWlncmF0aW9uS2V5KVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBJZGVtcG90ZW50bHkgYWRkcyB0aGUgcGVyLWpvYiB3YWxsLWNsb2NrIHRpbWVvdXQgdG8gZXhpc3Rpbmcgam9iIHRhYmxlcy5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9kYXRhYmFzZS9kcml2ZXJzL2Jhc2UuanNcIikuZGVmYXVsdH0gZGIgLSBEYXRhYmFzZSBjb25uZWN0aW9uLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyB3aGVuIGVuc3VyZWQuXG4gICAqL1xuICBhc3luYyBfZW5zdXJlSm9iVGltZW91dENvbHVtbihkYikge1xuICAgIGNvbnN0IGxvY2tOYW1lID0gYCR7TUlHUkFUSU9OX1NDT1BFfTp0aW1lb3V0X21zX2NvbHVtbmBcbiAgICBjb25zdCBhY3F1aXJlZCA9IGF3YWl0IGRiLmFjcXVpcmVBZHZpc29yeUxvY2sobG9ja05hbWUpXG5cbiAgICBpZiAoIWFjcXVpcmVkKSB0aHJvdyBuZXcgRXJyb3IoXCJGYWlsZWQgdG8gYWNxdWlyZSBiYWNrZ3JvdW5kIGpvYnMgdGltZW91dCBzY2hlbWEgbG9ja1wiKVxuXG4gICAgdHJ5IHtcbiAgICAgIGRiLmNsZWFyU2NoZW1hQ2FjaGUoKVxuICAgICAgY29uc3QgdGFibGUgPSBhd2FpdCBkYi5nZXRUYWJsZUJ5TmFtZU9yRmFpbChKT0JTX1RBQkxFKVxuXG4gICAgICBpZiAoIShhd2FpdCB0YWJsZS5nZXRDb2x1bW5CeU5hbWUoXCJ0aW1lb3V0X21zXCIpKSkge1xuICAgICAgICBjb25zdCB0YWJsZURhdGEgPSBuZXcgVGFibGVEYXRhKEpPQlNfVEFCTEUpXG4gICAgICAgIHRhYmxlRGF0YS5iaWdpbnQoXCJ0aW1lb3V0X21zXCIsIHtudWxsOiB0cnVlfSlcblxuICAgICAgICBmb3IgKGNvbnN0IHNxbCBvZiBhd2FpdCBkYi5hbHRlclRhYmxlU1FMcyh0YWJsZURhdGEpKSBhd2FpdCBkYi5xdWVyeShzcWwpXG5cbiAgICAgICAgZGIuY2xlYXJTY2hlbWFDYWNoZSgpXG4gICAgICB9XG4gICAgfSBmaW5hbGx5IHtcbiAgICAgIGF3YWl0IGRiLnJlbGVhc2VBZHZpc29yeUxvY2sobG9ja05hbWUpXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIElkZW1wb3RlbnRseSBhZGRzIHRoZSBoaXN0b3JpY2FsIHN0YWJsZSBzY2hlZHVsZSBrZXkgdG8gZXhpc3Rpbmcgam9icy5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9kYXRhYmFzZS9kcml2ZXJzL2Jhc2UuanNcIikuZGVmYXVsdH0gZGIgLSBEYXRhYmFzZSBjb25uZWN0aW9uLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyB3aGVuIGVuc3VyZWQuXG4gICAqL1xuICBhc3luYyBfZW5zdXJlU2NoZWR1bGVLZXlDb2x1bW4oZGIpIHtcbiAgICBjb25zdCBsb2NrTmFtZSA9IGAke01JR1JBVElPTl9TQ09QRX06c2NoZWR1bGVfa2V5X2NvbHVtbmBcbiAgICBjb25zdCBhY3F1aXJlZCA9IGF3YWl0IGRiLmFjcXVpcmVBZHZpc29yeUxvY2sobG9ja05hbWUpXG5cbiAgICBpZiAoIWFjcXVpcmVkKSB0aHJvdyBuZXcgRXJyb3IoXCJGYWlsZWQgdG8gYWNxdWlyZSBiYWNrZ3JvdW5kIGpvYnMgc2NoZWR1bGUta2V5IHNjaGVtYSBsb2NrXCIpXG5cbiAgICB0cnkge1xuICAgICAgZGIuY2xlYXJTY2hlbWFDYWNoZSgpXG4gICAgICBjb25zdCBsb2NrZWRUYWJsZSA9IGF3YWl0IGRiLmdldFRhYmxlQnlOYW1lT3JGYWlsKEpPQlNfVEFCTEUpXG5cbiAgICAgIGlmICghKGF3YWl0IGxvY2tlZFRhYmxlLmdldENvbHVtbkJ5TmFtZShcInNjaGVkdWxlX2tleVwiKSkpIHtcbiAgICAgICAgY29uc3QgdGFibGVEYXRhID0gbmV3IFRhYmxlRGF0YShKT0JTX1RBQkxFKVxuXG4gICAgICAgIHRhYmxlRGF0YS5zdHJpbmcoXCJzY2hlZHVsZV9rZXlcIiwge251bGw6IHRydWUsIGluZGV4OiB0cnVlfSlcblxuICAgICAgICBmb3IgKGNvbnN0IHNxbCBvZiBhd2FpdCBkYi5hbHRlclRhYmxlU1FMcyh0YWJsZURhdGEpKSBhd2FpdCBkYi5xdWVyeShzcWwpXG5cbiAgICAgICAgZGIuY2xlYXJTY2hlbWFDYWNoZSgpXG4gICAgICB9XG4gICAgfSBmaW5hbGx5IHtcbiAgICAgIGF3YWl0IGRiLnJlbGVhc2VBZHZpc29yeUxvY2sobG9ja05hbWUpXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIElkZW1wb3RlbnRseSBhZGRzIHRoZSBgcXVldWVgIGNvbHVtbiB0byBhbiBleGlzdGluZyBqb2JzIHRhYmxlLiBFeGlzdGluZ1xuICAgKiByb3dzIHJlYWQgYmFjayBhcyB0aGUgZGVmYXVsdCBxdWV1ZSAoc2VlIHtAbGluayBfbm9ybWFsaXplSm9iUm93fSksIHNvIG5vXG4gICAqIGRhdGEgYmFja2ZpbGwgaXMgcmVxdWlyZWQuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vZGF0YWJhc2UvZHJpdmVycy9iYXNlLmpzXCIpLmRlZmF1bHR9IGRiIC0gRGF0YWJhc2UgY29ubmVjdGlvbi5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgd2hlbiBlbnN1cmVkLlxuICAgKi9cbiAgYXN5bmMgX2Vuc3VyZVF1ZXVlQ29sdW1uKGRiKSB7XG4gICAgY29uc3QgbG9ja05hbWUgPSBgJHtNSUdSQVRJT05fU0NPUEV9OnF1ZXVlX2NvbHVtbmBcbiAgICBjb25zdCBhY3F1aXJlZCA9IGF3YWl0IGRiLmFjcXVpcmVBZHZpc29yeUxvY2sobG9ja05hbWUpXG5cbiAgICBpZiAoIWFjcXVpcmVkKSB0aHJvdyBuZXcgRXJyb3IoXCJGYWlsZWQgdG8gYWNxdWlyZSBiYWNrZ3JvdW5kIGpvYnMgcXVldWUgc2NoZW1hIGxvY2tcIilcblxuICAgIHRyeSB7XG4gICAgICAvLyBTUUwgU2VydmVyIHNjaGVtYSByZWFkcyBjYW4gZGVhZGxvY2sgd2l0aCBhIGNvbmN1cnJlbnQgQUxURVIgVEFCTEUsIHNvXG4gICAgICAvLyBhY3F1aXJlIHRoZSBsb2NrIGJlZm9yZSBpbnNwZWN0aW5nIHRoZSBjb2x1bW4gcmF0aGVyIHRoYW4gb25seVxuICAgICAgLy8gcHJvdGVjdGluZyB0aGUgbXV0YXRpb24gKG1pcnJvcnMgdGhlIGNvbmN1cnJlbmN5LWNvbHVtbiBtaWdyYXRpb24pLlxuICAgICAgZGIuY2xlYXJTY2hlbWFDYWNoZSgpXG4gICAgICBjb25zdCBsb2NrZWRUYWJsZSA9IGF3YWl0IGRiLmdldFRhYmxlQnlOYW1lT3JGYWlsKEpPQlNfVEFCTEUpXG5cbiAgICAgIGlmICghKGF3YWl0IGxvY2tlZFRhYmxlLmdldENvbHVtbkJ5TmFtZShcInF1ZXVlXCIpKSkge1xuICAgICAgICBjb25zdCB0YWJsZURhdGEgPSBuZXcgVGFibGVEYXRhKEpPQlNfVEFCTEUpXG5cbiAgICAgICAgdGFibGVEYXRhLnN0cmluZyhcInF1ZXVlXCIsIHtudWxsOiB0cnVlLCBpbmRleDogdHJ1ZX0pXG5cbiAgICAgICAgZm9yIChjb25zdCBzcWwgb2YgYXdhaXQgZGIuYWx0ZXJUYWJsZVNRTHModGFibGVEYXRhKSkgYXdhaXQgZGIucXVlcnkoc3FsKVxuXG4gICAgICAgIGRiLmNsZWFyU2NoZW1hQ2FjaGUoKVxuICAgICAgfVxuICAgIH0gZmluYWxseSB7XG4gICAgICBhd2FpdCBkYi5yZWxlYXNlQWR2aXNvcnlMb2NrKGxvY2tOYW1lKVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGJhY2tmaWxsIGV4ZWN1dGlvbiBtb2RlcyBvbmNlLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL2RhdGFiYXNlL2RyaXZlcnMvYmFzZS5qc1wiKS5kZWZhdWx0fSBkYiAtIERhdGFiYXNlIGNvbm5lY3Rpb24uXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIHdoZW4gY29tcGxldGUuXG4gICAqL1xuICBhc3luYyBfYmFja2ZpbGxFeGVjdXRpb25Nb2Rlc09uY2UoZGIpIHtcbiAgICBjb25zdCBtaWdyYXRpb25WZXJzaW9uID0gRVhFQ1VUSU9OX01PREVfQkFDS0ZJTExfTUlHUkFUSU9OX1ZFUlNJT05cbiAgICBjb25zdCBtaWdyYXRpb25LZXkgPSB0aGlzLl9taWdyYXRpb25LZXkobWlncmF0aW9uVmVyc2lvbilcblxuICAgIGlmIChhd2FpdCB0aGlzLl9oYXNNaWdyYXRpb24oZGIsIG1pZ3JhdGlvblZlcnNpb24pKSByZXR1cm5cblxuICAgIGF3YWl0IGRiLmFjcXVpcmVBZHZpc29yeUxvY2sobWlncmF0aW9uS2V5KVxuXG4gICAgdHJ5IHtcbiAgICAgIGlmIChhd2FpdCB0aGlzLl9oYXNNaWdyYXRpb24oZGIsIG1pZ3JhdGlvblZlcnNpb24pKSByZXR1cm5cblxuICAgICAgLy8gQSB0YWJsZSBjcmVhdGVkIGFmdGVyIHRoZSBgZm9ya2VkYCBjb2x1bW4gd2FzIGRyb3BwZWQgaGFzIG5vdGhpbmcgdG9cbiAgICAgIC8vIGJhY2tmaWxsIGZyb207IHJlY29yZCB0aGUgbWlncmF0aW9uIHNvIGl0IGlzIG5vdCByZS1hdHRlbXB0ZWQuXG4gICAgICBkYi5jbGVhclNjaGVtYUNhY2hlKClcbiAgICAgIGlmICghKGF3YWl0IChhd2FpdCBkYi5nZXRUYWJsZUJ5TmFtZU9yRmFpbChKT0JTX1RBQkxFKSkuZ2V0Q29sdW1uQnlOYW1lKFwiZm9ya2VkXCIpKSkge1xuICAgICAgICBhd2FpdCB0aGlzLl9yZWNvcmRNaWdyYXRpb24oZGIsIG1pZ3JhdGlvblZlcnNpb24pXG4gICAgICAgIHJldHVyblxuICAgICAgfVxuXG4gICAgICBjb25zdCB0YWJsZU5hbWVTcWwgPSBkYi5xdW90ZVRhYmxlKEpPQlNfVEFCTEUpXG4gICAgICBjb25zdCBmb3JrZWRDb2x1bW5TcWwgPSBkYi5xdW90ZUNvbHVtbihcImZvcmtlZFwiKVxuICAgICAgY29uc3QgZXhlY3V0aW9uTW9kZUNvbHVtblNxbCA9IGRiLnF1b3RlQ29sdW1uKFwiZXhlY3V0aW9uX21vZGVcIilcblxuICAgICAgYXdhaXQgZGIucXVlcnkoXG4gICAgICAgIGBVUERBVEUgJHt0YWJsZU5hbWVTcWx9IFNFVCAke2V4ZWN1dGlvbk1vZGVDb2x1bW5TcWx9ID0gJHtkYi5xdW90ZShcImZvcmtlZFwiKX0gYCArXG4gICAgICAgIGBXSEVSRSAke2ZvcmtlZENvbHVtblNxbH0gPSAke2RiLnF1b3RlKHRydWUpfSBBTkQgJHtleGVjdXRpb25Nb2RlQ29sdW1uU3FsfSBJUyBOVUxMYFxuICAgICAgKVxuICAgICAgYXdhaXQgZGIucXVlcnkoXG4gICAgICAgIGBVUERBVEUgJHt0YWJsZU5hbWVTcWx9IFNFVCAke2V4ZWN1dGlvbk1vZGVDb2x1bW5TcWx9ID0gJHtkYi5xdW90ZShcImlubGluZVwiKX0gYCArXG4gICAgICAgIGBXSEVSRSAke2ZvcmtlZENvbHVtblNxbH0gPSAke2RiLnF1b3RlKGZhbHNlKX0gQU5EICR7ZXhlY3V0aW9uTW9kZUNvbHVtblNxbH0gSVMgTlVMTGBcbiAgICAgIClcblxuICAgICAgYXdhaXQgdGhpcy5fcmVjb3JkTWlncmF0aW9uKGRiLCBtaWdyYXRpb25WZXJzaW9uKVxuICAgIH0gZmluYWxseSB7XG4gICAgICBhd2FpdCBkYi5yZWxlYXNlQWR2aXNvcnlMb2NrKG1pZ3JhdGlvbktleSlcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogUmV3cml0ZXMgcHJlLWV4aXN0aW5nIHBvb2xlZCByb3dzIChwZXJzaXN0ZWQgYXMgYGV4ZWN1dGlvbl9tb2RlID0gXCJmb3JrZWRcImBcbiAgICogcGx1cyBhIGB2ZWxvY2lvdXMtcG9vbGVkOipgIGhhbmRvZmYgbWFya2VyKSB0byBgZXhlY3V0aW9uX21vZGUgPSBcInBvb2xlZFwiYCxcbiAgICogY2xlYXJzIHRoZSBxdWV1ZWQgbWFya2VyLCB0aGVuIGRyb3BzIHRoZSBub3ctcmVkdW5kYW50IGBmb3JrZWRgIGNvbHVtbiBzb1xuICAgKiBgZXhlY3V0aW9uX21vZGVgIGlzIHRoZSBzaW5nbGUgc291cmNlIG9mIHRydXRoLiBSdW5zIG9uY2UsIGd1YXJkZWQgYnkgdGhlXG4gICAqIG1pZ3JhdGlvbiBsZWRnZXIgYW5kIGEgcGVyLWtleSBhZHZpc29yeSBsb2NrOyBhIGZyZXNoIHRhYmxlIChjcmVhdGVkIHdpdGhvdXRcbiAgICogdGhlIGNvbHVtbikgc2hvcnQtY2lyY3VpdHMuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vZGF0YWJhc2UvZHJpdmVycy9iYXNlLmpzXCIpLmRlZmF1bHR9IGRiIC0gRGF0YWJhc2UgY29ubmVjdGlvbi5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgd2hlbiBjb21wbGV0ZS5cbiAgICovXG4gIGFzeW5jIF9kcm9wRm9ya2VkQ29sdW1uT25jZShkYikge1xuICAgIGNvbnN0IG1pZ3JhdGlvblZlcnNpb24gPSBEUk9QX0ZPUktFRF9DT0xVTU5fTUlHUkFUSU9OX1ZFUlNJT05cbiAgICBjb25zdCBtaWdyYXRpb25LZXkgPSB0aGlzLl9taWdyYXRpb25LZXkobWlncmF0aW9uVmVyc2lvbilcblxuICAgIGlmIChhd2FpdCB0aGlzLl9oYXNNaWdyYXRpb24oZGIsIG1pZ3JhdGlvblZlcnNpb24pKSByZXR1cm5cblxuICAgIGF3YWl0IGRiLmFjcXVpcmVBZHZpc29yeUxvY2sobWlncmF0aW9uS2V5KVxuXG4gICAgdHJ5IHtcbiAgICAgIGlmIChhd2FpdCB0aGlzLl9oYXNNaWdyYXRpb24oZGIsIG1pZ3JhdGlvblZlcnNpb24pKSByZXR1cm5cblxuICAgICAgZGIuY2xlYXJTY2hlbWFDYWNoZSgpXG5cbiAgICAgIGlmIChhd2FpdCAoYXdhaXQgZGIuZ2V0VGFibGVCeU5hbWVPckZhaWwoSk9CU19UQUJMRSkpLmdldENvbHVtbkJ5TmFtZShcImZvcmtlZFwiKSkge1xuICAgICAgICBjb25zdCB0YWJsZU5hbWVTcWwgPSBkYi5xdW90ZVRhYmxlKEpPQlNfVEFCTEUpXG4gICAgICAgIGNvbnN0IGV4ZWN1dGlvbk1vZGVDb2x1bW5TcWwgPSBkYi5xdW90ZUNvbHVtbihcImV4ZWN1dGlvbl9tb2RlXCIpXG4gICAgICAgIGNvbnN0IGhhbmRvZmZJZENvbHVtblNxbCA9IGRiLnF1b3RlQ29sdW1uKFwiaGFuZG9mZl9pZFwiKVxuXG4gICAgICAgIC8vIFBvb2xlZCByb3dzIHVzZWQgdG8gcGVyc2lzdCBhcyBleGVjdXRpb25fbW9kZSBcImZvcmtlZFwiICsgYSBwb29sZWQgaGFuZG9mZlxuICAgICAgICAvLyBtYXJrZXI7IHJlY292ZXIgdGhlaXIgcmVhbCBtb2RlIGJlZm9yZSB0aGUgbWFya2VyIGlzIGNsZWFyZWQuXG4gICAgICAgIGF3YWl0IGRiLnF1ZXJ5KFxuICAgICAgICAgIGBVUERBVEUgJHt0YWJsZU5hbWVTcWx9IFNFVCAke2V4ZWN1dGlvbk1vZGVDb2x1bW5TcWx9ID0gJHtkYi5xdW90ZShcInBvb2xlZFwiKX0gYCArXG4gICAgICAgICAgYFdIRVJFICR7ZXhlY3V0aW9uTW9kZUNvbHVtblNxbH0gPSAke2RiLnF1b3RlKFwiZm9ya2VkXCIpfSBgICtcbiAgICAgICAgICBgQU5EICR7aGFuZG9mZklkQ29sdW1uU3FsfSBMSUtFICR7ZGIucXVvdGUoYCR7TEVHQUNZX1BPT0xFRF9IQU5ET0ZGX0lEX1BSRUZJWH0lYCl9YFxuICAgICAgICApXG4gICAgICAgIC8vIFRoZSBxdWV1ZWQtcG9vbGVkIG1hcmtlciB3YXMgYSBzZW50aW5lbCwgbm90IGEgcmVhbCBsZWFzZTsgY2xlYXIgaXQuXG4gICAgICAgIGF3YWl0IGRiLnF1ZXJ5KFxuICAgICAgICAgIGBVUERBVEUgJHt0YWJsZU5hbWVTcWx9IFNFVCAke2hhbmRvZmZJZENvbHVtblNxbH0gPSBOVUxMIGAgK1xuICAgICAgICAgIGBXSEVSRSAke2hhbmRvZmZJZENvbHVtblNxbH0gPSAke2RiLnF1b3RlKExFR0FDWV9QT09MRURfUVVFVUVEX0hBTkRPRkZfSUQpfWBcbiAgICAgICAgKVxuXG4gICAgICAgIGNvbnN0IGRyb3BGb3JrZWQgPSBuZXcgVGFibGVEYXRhKEpPQlNfVEFCTEUpXG4gICAgICAgIGRyb3BGb3JrZWQuYWRkQ29sdW1uKFwiZm9ya2VkXCIsIHtkcm9wQ29sdW1uOiB0cnVlfSlcbiAgICAgICAgZm9yIChjb25zdCBzcWwgb2YgYXdhaXQgZGIuYWx0ZXJUYWJsZVNRTHMoZHJvcEZvcmtlZCkpIGF3YWl0IGRiLnF1ZXJ5KHNxbClcblxuICAgICAgICBkYi5jbGVhclNjaGVtYUNhY2hlKClcbiAgICAgIH1cblxuICAgICAgYXdhaXQgdGhpcy5fcmVjb3JkTWlncmF0aW9uKGRiLCBtaWdyYXRpb25WZXJzaW9uKVxuICAgIH0gZmluYWxseSB7XG4gICAgICBhd2FpdCBkYi5yZWxlYXNlQWR2aXNvcnlMb2NrKG1pZ3JhdGlvbktleSlcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogUnVucyByZWNvcmQgbWlncmF0aW9uLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL2RhdGFiYXNlL2RyaXZlcnMvYmFzZS5qc1wiKS5kZWZhdWx0fSBkYiAtIERhdGFiYXNlIGNvbm5lY3Rpb24uXG4gICAqIEBwYXJhbSB7c3RyaW5nfSB2ZXJzaW9uIC0gTWlncmF0aW9uIHZlcnNpb24uXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIHdoZW4gY29tcGxldGUuXG4gICAqL1xuICBhc3luYyBfcmVjb3JkTWlncmF0aW9uKGRiLCB2ZXJzaW9uKSB7XG4gICAgYXdhaXQgZGIudXBzZXJ0KHtcbiAgICAgIHRhYmxlTmFtZTogTUlHUkFUSU9OU19UQUJMRSxcbiAgICAgIGRhdGE6IHtcbiAgICAgICAga2V5OiB0aGlzLl9taWdyYXRpb25LZXkodmVyc2lvbiksXG4gICAgICAgIHNjb3BlOiBNSUdSQVRJT05fU0NPUEUsXG4gICAgICAgIHZlcnNpb24sXG4gICAgICAgIGFwcGxpZWRfYXRfbXM6IERhdGUubm93KClcbiAgICAgIH0sXG4gICAgICBjb25mbGljdENvbHVtbnM6IFtcImtleVwiXSxcbiAgICAgIHVwZGF0ZUNvbHVtbnM6IFtcInNjb3BlXCIsIFwidmVyc2lvblwiLCBcImFwcGxpZWRfYXRfbXNcIl1cbiAgICB9KVxuICB9XG5cbiAgYXN5bmMgX2luaXRpYWxpemVNb2RlbCgpIHtcbiAgICBpZiAoQmFja2dyb3VuZEpvYlJlY29yZC5pc0luaXRpYWxpemVkKCkpIHJldHVyblxuXG4gICAgQmFja2dyb3VuZEpvYlJlY29yZC5zZXREYXRhYmFzZUlkZW50aWZpZXIodGhpcy5nZXREYXRhYmFzZUlkZW50aWZpZXIoKSlcbiAgICBjb25zdCBwb29sID0gdGhpcy5jb25maWd1cmF0aW9uLmdldERhdGFiYXNlUG9vbCh0aGlzLmdldERhdGFiYXNlSWRlbnRpZmllcigpKVxuXG4gICAgYXdhaXQgcG9vbC53aXRoQ29ubmVjdGlvbih7bmFtZTogXCJCYWNrZ3JvdW5kIGpvYnMgc3RvcmUgaW5pdGlhbGl6ZSBtb2RlbFwifSwgYXN5bmMgKCkgPT4ge1xuICAgICAgYXdhaXQgQmFja2dyb3VuZEpvYlJlY29yZC5pbml0aWFsaXplUmVjb3JkKHtjb25maWd1cmF0aW9uOiB0aGlzLmNvbmZpZ3VyYXRpb259KVxuICAgIH0pXG4gIH1cblxuICAvKipcbiAgICogUnVucyBnZXQgam9iIHJvdyBieSBpZC5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9kYXRhYmFzZS9kcml2ZXJzL2Jhc2UuanNcIikuZGVmYXVsdH0gZGIgLSBEYXRhYmFzZSBjb25uZWN0aW9uLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gam9iSWQgLSBKb2IgaWQuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPGltcG9ydChcIi4vdHlwZXMuanNcIikuQmFja2dyb3VuZEpvYlJvdyB8IG51bGw+fSAtIEpvYiByb3cuXG4gICAqL1xuICBhc3luYyBfZ2V0Sm9iUm93QnlJZChkYiwgam9iSWQpIHtcbiAgICBjb25zdCBxdWVyeSA9IGRiXG4gICAgICAubmV3UXVlcnkoKVxuICAgICAgLmZyb20oSk9CU19UQUJMRSlcbiAgICAgIC53aGVyZSh7aWQ6IGpvYklkfSlcbiAgICAgIC5saW1pdCgxKVxuXG4gICAgY29uc3Qgcm93cyA9IGF3YWl0IHF1ZXJ5LnJlc3VsdHMoKVxuXG4gICAgaWYgKCFyb3dzWzBdKSByZXR1cm4gbnVsbFxuXG4gICAgcmV0dXJuIHRoaXMuX25vcm1hbGl6ZUpvYlJvdyhyb3dzWzBdKVxuICB9XG5cbiAgLyoqXG4gICAqIFJlbGVhc2VzIG93bmVyc2hpcCBvbmx5IHdoZW4gdGhlIGtleSBzdGlsbCBwb2ludHMgYXQgdGhlIGV4cGVjdGVkIGpvYi5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9kYXRhYmFzZS9kcml2ZXJzL2Jhc2UuanNcIikuZGVmYXVsdH0gZGIgLSBEYXRhYmFzZSBjb25uZWN0aW9uLlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIE93bmVyc2hpcCBpZGVudGl0eS5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGFyZ3Muam9iSWQgLSBFeHBlY3RlZCBvd25lciBqb2IgaWQuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBhcmdzLnNjaGVkdWxlS2V5IC0gU3RhYmxlIHNjaGVkdWxlIGtleS5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgd2hlbiBkZWxldGVkIG9yIGFscmVhZHkgc3VwZXJzZWRlZC5cbiAgICovXG4gIGFzeW5jIF9yZWxlYXNlU2NoZWR1bGVPd25lcnNoaXAoZGIsIHtqb2JJZCwgc2NoZWR1bGVLZXl9KSB7XG4gICAgYXdhaXQgZGIuZGVsZXRlKHtcbiAgICAgIHRhYmxlTmFtZTogU0NIRURVTEVfS0VZU19UQUJMRSxcbiAgICAgIGNvbmRpdGlvbnM6IHtqb2JfaWQ6IGpvYklkLCBzY2hlZHVsZV9rZXk6IHNjaGVkdWxlS2V5fVxuICAgIH0pXG4gIH1cblxuICAvKipcbiAgICogUmVsZWFzZXMgYSBqb2IncyBvd25lcnNoaXAgd2hlbiBpdCBoYXMgYSBoaXN0b3JpY2FsIHNjaGVkdWxlIGtleS5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9kYXRhYmFzZS9kcml2ZXJzL2Jhc2UuanNcIikuZGVmYXVsdH0gZGIgLSBEYXRhYmFzZSBjb25uZWN0aW9uLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vdHlwZXMuanNcIikuQmFja2dyb3VuZEpvYlJvd30gam9iIC0gVGVybWluYWwgam9iLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyB3aGVuIGRlbGV0ZWQgb3Igbm90IGFwcGxpY2FibGUuXG4gICAqL1xuICBhc3luYyBfcmVsZWFzZVNjaGVkdWxlT3duZXJzaGlwRm9ySm9iKGRiLCBqb2IpIHtcbiAgICBpZiAoIWpvYi5zY2hlZHVsZUtleSkgcmV0dXJuXG5cbiAgICBhd2FpdCB0aGlzLl9yZWxlYXNlU2NoZWR1bGVPd25lcnNoaXAoZGIsIHtqb2JJZDogam9iLmlkLCBzY2hlZHVsZUtleTogam9iLnNjaGVkdWxlS2V5fSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGFwcGx5IGZhaWx1cmUuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gT3B0aW9ucy5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9kYXRhYmFzZS9kcml2ZXJzL2Jhc2UuanNcIikuZGVmYXVsdH0gYXJncy5kYiAtIERhdGFiYXNlIGNvbm5lY3Rpb24uXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi90eXBlcy5qc1wiKS5CYWNrZ3JvdW5kSm9iUm93fSBhcmdzLmpvYiAtIEpvYiByb3cuXG4gICAqIEBwYXJhbSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59IGFyZ3MuZXJyb3IgLSBFcnJvci5cbiAgICogQHBhcmFtIHtib29sZWFufSBhcmdzLm1hcmtPcnBoYW5lZCAtIFdoZXRoZXIgbWFya2luZyBvcnBoYW5lZC5cbiAgICogQHBhcmFtIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59IFthcmdzLmNvbmRpdGlvbnNdIC0gVXBkYXRlIGZlbmNpbmcgY29uZGl0aW9ucy4gRGVmYXVsdHMgdG8gdGhlIGFjdGl2ZS1oYW5kb2ZmIGxlYXNlIG1hdGNoOyB0aGUgdGltZS1iYXNlZCBvcnBoYW4gc3dlZXAgb3ZlcnJpZGVzIHRoaXMgd2l0aCBhbiBpZC9zdGF0dXMgbWF0Y2ggc28gaXQgY2FuIHJlY2xhaW0gcm93cyB3aG9zZSBgaGFuZG9mZl9pZGAgaXMgbnVsbCAoZS5nLiBoYW5kZWQgb2ZmIGJ5IGFuIG9sZGVyIHZlbG9jaW91cyBiZWZvcmUgaGFuZG9mZi1pZCBmZW5jaW5nIGV4aXN0ZWQpLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxpbXBvcnQoXCIuL3R5cGVzLmpzXCIpLkJhY2tncm91bmRKb2JSb3cgfCBudWxsPn0gLSBVcGRhdGVkIGpvYiByb3cgd2hlbiB0aGUgbGVhc2UgdHJhbnNpdGlvbiB3b24uXG4gICAqL1xuICBhc3luYyBfYXBwbHlGYWlsdXJlKHtkYiwgam9iLCBlcnJvciwgbWFya09ycGhhbmVkLCBjb25kaXRpb25zfSkge1xuICAgIGNvbnN0IG5vdyA9IHRoaXMuY2xvY2subm93KClcbiAgICBjb25zdCBuZXh0QXR0ZW1wdCA9IChqb2IuYXR0ZW1wdHMgfHwgMCkgKyAxXG4gICAgY29uc3QgbWF4UmV0cmllcyA9IHRoaXMuX25vcm1hbGl6ZU1heFJldHJpZXMoam9iLm1heFJldHJpZXMpXG4gICAgY29uc3Qgc2hvdWxkUmV0cnkgPSBuZXh0QXR0ZW1wdCA8PSBtYXhSZXRyaWVzXG4gICAgY29uc3QgZmFpbHVyZU1lc3NhZ2UgPSBub3JtYWxpemVCYWNrZ3JvdW5kSm9iRXJyb3IoZXJyb3IpXG4gICAgY29uc3Qgc2NoZWR1bGVkQXQgPSBzaG91bGRSZXRyeSA/IG5vdyArIHRoaXMuZ2V0UmV0cnlEZWxheU1zKG5leHRBdHRlbXB0KSA6IGpvYi5zY2hlZHVsZWRBdE1zXG4gICAgY29uc3QgdXBkYXRlID0gdGhpcy5fZmFpbHVyZVVwZGF0ZSh7XG4gICAgICBmYWlsdXJlTWVzc2FnZSxcbiAgICAgIG1hcmtPcnBoYW5lZCxcbiAgICAgIG5leHRBdHRlbXB0LFxuICAgICAgbm93LFxuICAgICAgc2NoZWR1bGVkQXQsXG4gICAgICBzaG91bGRSZXRyeVxuICAgIH0pXG5cbiAgICBhd2FpdCB0aGlzLl9sb2NrQ29uY3VycmVuY3lSb3coZGIsIGpvYi5jb25jdXJyZW5jeUtleSlcbiAgICBjb25zdCBhZmZlY3RlZFJvd3MgPSBhd2FpdCB0aGlzLl91cGRhdGVBZmZlY3RlZFJvd3MoZGIsIHtcbiAgICAgIHRhYmxlTmFtZTogSk9CU19UQUJMRSxcbiAgICAgIGRhdGE6IHVwZGF0ZSxcbiAgICAgIGNvbmRpdGlvbnM6IGNvbmRpdGlvbnMgPz8gdGhpcy5fYWN0aXZlSGFuZG9mZkNvbmRpdGlvbnMoam9iKVxuICAgIH0pXG5cbiAgICBpZiAoYWZmZWN0ZWRSb3dzICE9PSAxKSByZXR1cm4gbnVsbFxuICAgIGlmICghc2hvdWxkUmV0cnkpIGF3YWl0IHRoaXMuX3JlbGVhc2VTY2hlZHVsZU93bmVyc2hpcEZvckpvYihkYiwgam9iKVxuICAgIGF3YWl0IHRoaXMuX3JlbGVhc2VDb25jdXJyZW5jeShkYiwgam9iLmNvbmN1cnJlbmN5S2V5KVxuXG4gICAgLy8gUmV0dXJuIGEgc25hcHNob3Qgb2YgdGhlIHRyYW5zaXRpb24gdGhpcyB1cGRhdGUganVzdCBhcHBsaWVkIHJhdGhlciB0aGFuIHJlLXJlYWRpbmcgdGhlIHJvdy5cbiAgICAvLyBXZSB3b24gdGhlIGNvbmRpdGlvbmFsIHVwZGF0ZSAoYWZmZWN0ZWRSb3dzID09PSAxKSwgc28gdGhpcyBzdGF0ZSBpcyBhdXRob3JpdGF0aXZlOyByZS1yZWFkaW5nXG4gICAgLy8gY291bGQgaW5zdGVhZCBvYnNlcnZlIGEgbmV3ZXIgc3RhdGUgaWYgYW5vdGhlciBkaXNwYXRjaGVyIHJlY2xhaW1zIGEgcmVxdWV1ZWQgam9iIGJldHdlZW4gdGhlXG4gICAgLy8gdXBkYXRlIGFuZCB0aGUgcmVhZCAob3ZlcmxhcHBpbmcgbWFpbnMgLyBwb2xsaW5nIGRpc3BhdGNoKSwgd2hpY2ggd291bGQgbWlzcmVwb3J0IHRoZVxuICAgIC8vIHN0YXR1cy90ZXJtaW5hbC93aWxsUmV0cnkgb2YgdGhpcyB0cmFuc2l0aW9uIHRvIGZhaWx1cmUvb3JwaGFuIGV2ZW50IGxpc3RlbmVycy5cbiAgICBjb25zdCBzdGF0dXMgPSBzaG91bGRSZXRyeSA/IFwicXVldWVkXCIgOiAobWFya09ycGhhbmVkID8gXCJvcnBoYW5lZFwiIDogXCJmYWlsZWRcIilcbiAgICAvKiogQHR5cGUge2ltcG9ydChcIi4vdHlwZXMuanNcIikuQmFja2dyb3VuZEpvYlJvd30gKi9cbiAgICBjb25zdCB0cmFuc2l0aW9uZWRKb2IgPSB7XG4gICAgICAuLi5qb2IsXG4gICAgICBhdHRlbXB0czogbmV4dEF0dGVtcHQsXG4gICAgICBoYW5kZWRPZmZBdE1zOiBudWxsLFxuICAgICAgbGFzdEVycm9yOiBmYWlsdXJlTWVzc2FnZSxcbiAgICAgIHN0YXR1cyxcbiAgICAgIHdvcmtlcklkOiBudWxsXG4gICAgfVxuXG4gICAgaWYgKG1hcmtPcnBoYW5lZCkgdHJhbnNpdGlvbmVkSm9iLm9ycGhhbmVkQXRNcyA9IG5vd1xuICAgIGlmIChzaG91bGRSZXRyeSkge1xuICAgICAgdHJhbnNpdGlvbmVkSm9iLnNjaGVkdWxlZEF0TXMgPSBzY2hlZHVsZWRBdFxuICAgIH0gZWxzZSBpZiAoIW1hcmtPcnBoYW5lZCkge1xuICAgICAgdHJhbnNpdGlvbmVkSm9iLmZhaWxlZEF0TXMgPSBub3dcbiAgICB9XG5cbiAgICByZXR1cm4gdHJhbnNpdGlvbmVkSm9iXG4gIH1cblxuICAvKipcbiAgICogUnVucyBmYWlsdXJlIHVwZGF0ZS5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBPcHRpb25zLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gYXJncy5mYWlsdXJlTWVzc2FnZSAtIExhc3QgZmFpbHVyZSBtZXNzYWdlLlxuICAgKiBAcGFyYW0ge2Jvb2xlYW59IGFyZ3MubWFya09ycGhhbmVkIC0gV2hldGhlciBtYXJraW5nIG9ycGhhbmVkLlxuICAgKiBAcGFyYW0ge251bWJlcn0gYXJncy5uZXh0QXR0ZW1wdCAtIE5leHQgYXR0ZW1wdCBjb3VudC5cbiAgICogQHBhcmFtIHtudW1iZXJ9IGFyZ3Mubm93IC0gQ3VycmVudCB0aW1lc3RhbXAuXG4gICAqIEBwYXJhbSB7bnVtYmVyIHwgbnVsbH0gYXJncy5zY2hlZHVsZWRBdCAtIE5leHQgc2NoZWR1bGVkIHRpbWVzdGFtcC5cbiAgICogQHBhcmFtIHtib29sZWFufSBhcmdzLnNob3VsZFJldHJ5IC0gV2hldGhlciB0aGUgam9iIHNob3VsZCByZXRyeS5cbiAgICogQHJldHVybnMge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gLSBEYXRhYmFzZSB1cGRhdGUgZGF0YS5cbiAgICovXG4gIF9mYWlsdXJlVXBkYXRlKHtmYWlsdXJlTWVzc2FnZSwgbWFya09ycGhhbmVkLCBuZXh0QXR0ZW1wdCwgbm93LCBzY2hlZHVsZWRBdCwgc2hvdWxkUmV0cnl9KSB7XG4gICAgLyoqXG4gICAgICogVXBkYXRlLlxuICAgICAqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59ICovXG4gICAgY29uc3QgdXBkYXRlID0ge1xuICAgICAgYXR0ZW1wdHM6IG5leHRBdHRlbXB0LFxuICAgICAgaGFuZGVkX29mZl9hdF9tczogbnVsbCxcbiAgICAgIHdvcmtlcl9pZDogbnVsbCxcbiAgICAgIGxhc3RfZXJyb3I6IGZhaWx1cmVNZXNzYWdlXG4gICAgfVxuXG4gICAgdGhpcy5fYXBwbHlPcnBoYW5lZEZhaWx1cmVVcGRhdGUoe21hcmtPcnBoYW5lZCwgbm93LCB1cGRhdGV9KVxuICAgIHRoaXMuX2FwcGx5RmFpbHVyZVN0YXR1c1VwZGF0ZSh7bWFya09ycGhhbmVkLCBub3csIHNjaGVkdWxlZEF0LCBzaG91bGRSZXRyeSwgdXBkYXRlfSlcblxuICAgIHJldHVybiB1cGRhdGVcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGFwcGx5IG9ycGhhbmVkIGZhaWx1cmUgdXBkYXRlLlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIE9wdGlvbnMuXG4gICAqIEBwYXJhbSB7Ym9vbGVhbn0gYXJncy5tYXJrT3JwaGFuZWQgLSBXaGV0aGVyIG1hcmtpbmcgb3JwaGFuZWQuXG4gICAqIEBwYXJhbSB7bnVtYmVyfSBhcmdzLm5vdyAtIEN1cnJlbnQgdGltZXN0YW1wLlxuICAgKiBAcGFyYW0ge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gYXJncy51cGRhdGUgLSBEYXRhYmFzZSB1cGRhdGUgZGF0YS5cbiAgICogQHJldHVybnMge3ZvaWR9XG4gICAqL1xuICBfYXBwbHlPcnBoYW5lZEZhaWx1cmVVcGRhdGUoe21hcmtPcnBoYW5lZCwgbm93LCB1cGRhdGV9KSB7XG4gICAgaWYgKG1hcmtPcnBoYW5lZCkgdXBkYXRlLm9ycGhhbmVkX2F0X21zID0gbm93XG4gIH1cblxuICAvKipcbiAgICogUnVucyBhcHBseSBmYWlsdXJlIHN0YXR1cyB1cGRhdGUuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gT3B0aW9ucy5cbiAgICogQHBhcmFtIHtib29sZWFufSBhcmdzLm1hcmtPcnBoYW5lZCAtIFdoZXRoZXIgbWFya2luZyBvcnBoYW5lZC5cbiAgICogQHBhcmFtIHtudW1iZXJ9IGFyZ3Mubm93IC0gQ3VycmVudCB0aW1lc3RhbXAuXG4gICAqIEBwYXJhbSB7bnVtYmVyIHwgbnVsbH0gYXJncy5zY2hlZHVsZWRBdCAtIE5leHQgc2NoZWR1bGVkIHRpbWVzdGFtcC5cbiAgICogQHBhcmFtIHtib29sZWFufSBhcmdzLnNob3VsZFJldHJ5IC0gV2hldGhlciB0aGUgam9iIHNob3VsZCByZXRyeS5cbiAgICogQHBhcmFtIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59IGFyZ3MudXBkYXRlIC0gRGF0YWJhc2UgdXBkYXRlIGRhdGEuXG4gICAqIEByZXR1cm5zIHt2b2lkfVxuICAgKi9cbiAgX2FwcGx5RmFpbHVyZVN0YXR1c1VwZGF0ZSh7bWFya09ycGhhbmVkLCBub3csIHNjaGVkdWxlZEF0LCBzaG91bGRSZXRyeSwgdXBkYXRlfSkge1xuICAgIGlmIChzaG91bGRSZXRyeSkge1xuICAgICAgdXBkYXRlLnN0YXR1cyA9IFwicXVldWVkXCJcbiAgICAgIHVwZGF0ZS5zY2hlZHVsZWRfYXRfbXMgPSBzY2hlZHVsZWRBdFxuICAgICAgcmV0dXJuXG4gICAgfVxuXG4gICAgaWYgKG1hcmtPcnBoYW5lZCkge1xuICAgICAgdXBkYXRlLnN0YXR1cyA9IFwib3JwaGFuZWRcIlxuICAgICAgcmV0dXJuXG4gICAgfVxuXG4gICAgdXBkYXRlLnN0YXR1cyA9IFwiZmFpbGVkXCJcbiAgICB1cGRhdGUuZmFpbGVkX2F0X21zID0gbm93XG4gIH1cblxuICAvKipcbiAgICogUnVucyBub3JtYWxpemUgam9iIHJvdy5cbiAgICogQHBhcmFtIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59IHJvdyAtIFJhdyBkYXRhYmFzZSByb3cuXG4gICAqIEByZXR1cm5zIHtpbXBvcnQoXCIuL3R5cGVzLmpzXCIpLkJhY2tncm91bmRKb2JSb3d9IC0gTm9ybWFsaXplZCBqb2Igcm93LlxuICAgKi9cbiAgX25vcm1hbGl6ZUpvYlJvdyhyb3cpIHtcbiAgICBjb25zdCBoYW5kb2ZmSWQgPSByb3cuaGFuZG9mZl9pZCA/IFN0cmluZyhyb3cuaGFuZG9mZl9pZCkgOiBudWxsXG4gICAgLy8gYGV4ZWN1dGlvbl9tb2RlYCBpcyB0aGUgc2luZ2xlIHNvdXJjZSBvZiB0cnV0aCBmb3IgYSBqb2IncyBydW50aW1lIGFuZCBpc1xuICAgIC8vIHdyaXR0ZW4gb24gZXZlcnkgZW5xdWV1ZTsgdGhlIGRyb3AtZm9ya2VkIG1pZ3JhdGlvbiBiYWNrZmlsbHMgYW55IHByZS1leGlzdGluZ1xuICAgIC8vIHJvd3MgYmVmb3JlIHRoZSBsZWdhY3kgYGZvcmtlZGAgY29sdW1uIGlzIHJlbW92ZWQuXG4gICAgY29uc3QgZXhlY3V0aW9uTW9kZSA9IHJvdy5leGVjdXRpb25fbW9kZSA/IHRoaXMuX25vcm1hbGl6ZUV4ZWN1dGlvbk1vZGVOYW1lKFN0cmluZyhyb3cuZXhlY3V0aW9uX21vZGUpKSA6IERFRkFVTFRfQkFDS0dST1VORF9KT0JfRVhFQ1VUSU9OX01PREVcblxuICAgIHJldHVybiB7XG4gICAgICBpZDogU3RyaW5nKHJvdy5pZCksXG4gICAgICBqb2JOYW1lOiBTdHJpbmcocm93LmpvYl9uYW1lKSxcbiAgICAgIGFyZ3M6IHRoaXMuX3BhcnNlQXJncyhyb3cuYXJnc19qc29uKSxcbiAgICAgIGV4ZWN1dGlvbk1vZGUsXG4gICAgICBxdWV1ZTogcm93LnF1ZXVlID8gU3RyaW5nKHJvdy5xdWV1ZSkgOiBERUZBVUxUX0JBQ0tHUk9VTkRfSk9CX1FVRVVFLFxuICAgICAgc2NoZWR1bGVLZXk6IHJvdy5zY2hlZHVsZV9rZXkgPyBTdHJpbmcocm93LnNjaGVkdWxlX2tleSkgOiBudWxsLFxuICAgICAgc3RhdHVzOiByb3cuc3RhdHVzID8gU3RyaW5nKHJvdy5zdGF0dXMpIDogXCJxdWV1ZWRcIixcbiAgICAgIGF0dGVtcHRzOiB0aGlzLl9ub3JtYWxpemVOdW1iZXIocm93LmF0dGVtcHRzKSxcbiAgICAgIG1heFJldHJpZXM6IHRoaXMuX25vcm1hbGl6ZU51bWJlcihyb3cubWF4X3JldHJpZXMpLFxuICAgICAgc2NoZWR1bGVkQXRNczogdGhpcy5fbm9ybWFsaXplTnVtYmVyKHJvdy5zY2hlZHVsZWRfYXRfbXMpLFxuICAgICAgY3JlYXRlZEF0TXM6IHRoaXMuX25vcm1hbGl6ZU51bWJlcihyb3cuY3JlYXRlZF9hdF9tcyksXG4gICAgICBoYW5kZWRPZmZBdE1zOiB0aGlzLl9ub3JtYWxpemVOdW1iZXIocm93LmhhbmRlZF9vZmZfYXRfbXMpLFxuICAgICAgaGFuZG9mZklkLFxuICAgICAgY29tcGxldGVkQXRNczogdGhpcy5fbm9ybWFsaXplTnVtYmVyKHJvdy5jb21wbGV0ZWRfYXRfbXMpLFxuICAgICAgZmFpbGVkQXRNczogdGhpcy5fbm9ybWFsaXplTnVtYmVyKHJvdy5mYWlsZWRfYXRfbXMpLFxuICAgICAgb3JwaGFuZWRBdE1zOiB0aGlzLl9ub3JtYWxpemVOdW1iZXIocm93Lm9ycGhhbmVkX2F0X21zKSxcbiAgICAgIHdvcmtlcklkOiByb3cud29ya2VyX2lkID8gU3RyaW5nKHJvdy53b3JrZXJfaWQpIDogbnVsbCxcbiAgICAgIGxhc3RFcnJvcjogcm93Lmxhc3RfZXJyb3IgPyBTdHJpbmcocm93Lmxhc3RfZXJyb3IpIDogbnVsbCxcbiAgICAgIGNvbmN1cnJlbmN5S2V5OiByb3cuY29uY3VycmVuY3lfa2V5ID8gU3RyaW5nKHJvdy5jb25jdXJyZW5jeV9rZXkpIDogbnVsbCxcbiAgICAgIG1heENvbmN1cnJlbmN5OiB0aGlzLl9ub3JtYWxpemVOdW1iZXIocm93Lm1heF9jb25jdXJyZW5jeSksXG4gICAgICB0aW1lb3V0TXM6IHRoaXMuX25vcm1hbGl6ZU51bWJlcihyb3cudGltZW91dF9tcylcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogTm9ybWFsaXplcyBhIGpvYidzIHF1ZXVlIG5hbWUsIGRlZmF1bHRpbmcgdG8gXCJkZWZhdWx0XCIuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi90eXBlcy5qc1wiKS5CYWNrZ3JvdW5kSm9iT3B0aW9ucyB8IHVuZGVmaW5lZH0gb3B0aW9ucyAtIEpvYiBvcHRpb25zLlxuICAgKiBAcmV0dXJucyB7c3RyaW5nfSAtIFF1ZXVlIG5hbWUuXG4gICAqL1xuICBfbm9ybWFsaXplUXVldWUob3B0aW9ucykge1xuICAgIHJldHVybiBub3JtYWxpemVCYWNrZ3JvdW5kSm9iUXVldWUob3B0aW9ucylcbiAgfVxuXG4gIC8qKlxuICAgKiBSZXNvbHZlcyBhIGpvYidzIGR1cmFibGUgY29uY3VycmVuY3kuIEFuIGV4cGxpY2l0IGNvbmN1cnJlbmN5S2V5L21heENvbmN1cnJlbmN5XG4gICAqIHBhaXIgYWx3YXlzIHdpbnMuIE90aGVyd2lzZSwgd2hlbiB0aGUgam9iJ3MgcXVldWUgaGFzIGEgY29uZmlndXJlZCBjYXBcbiAgICogKGBiYWNrZ3JvdW5kSm9icy5xdWV1ZXNbcXVldWVdLm1heENvbmN1cnJlbnRgKSwgZGVyaXZlIGEgcXVldWUtc2NvcGVkXG4gICAqIGNvbmN1cnJlbmN5IGtleSBzbyB0aGUgcXVldWUgY2FwIGlzIGVuZm9yY2VkIGNsdXN0ZXItd2lkZSB0aHJvdWdoIHRoZVxuICAgKiBleGlzdGluZyBkdXJhYmxlIGNvbmN1cnJlbmN5IG1lY2hhbmlzbS5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL3R5cGVzLmpzXCIpLkJhY2tncm91bmRKb2JPcHRpb25zIHwgdW5kZWZpbmVkfSBvcHRpb25zIC0gSm9iIG9wdGlvbnMuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBxdWV1ZSAtIE5vcm1hbGl6ZWQgcXVldWUgbmFtZS5cbiAgICogQHJldHVybnMge3tjb25jdXJyZW5jeUtleTogc3RyaW5nLCBtYXhDb25jdXJyZW5jeTogbnVtYmVyLCBxdWV1ZURlcml2ZWQ6IGJvb2xlYW59IHwgbnVsbH0gLSBSZXNvbHZlZCBjb25jdXJyZW5jeS5cbiAgICovXG4gIF9yZXNvbHZlQ29uY3VycmVuY3kob3B0aW9ucywgcXVldWUpIHtcbiAgICByZXR1cm4gbm9ybWFsaXplQmFja2dyb3VuZEpvYkNvbmN1cnJlbmN5KHtcbiAgICAgIG9wdGlvbnM6IG9wdGlvbnMgfHwge30sXG4gICAgICBxdWV1ZSxcbiAgICAgIHF1ZXVlczogdGhpcy5jb25maWd1cmF0aW9uLmdldEJhY2tncm91bmRKb2JzQ29uZmlnKCkucXVldWVzXG4gICAgfSlcbiAgfVxuXG4gIC8qKlxuICAgKiBBcHBsaWVzIHRoZSBhY3RpdmUgZ2VuZXJhdGlvbidzIHF1ZXVlIHBvbGljeSBpbW1lZGlhdGVseSBiZWZvcmUgaGFuZG9mZi5cbiAgICogRXhwbGljaXQgY29uY3VycmVuY3kgcmVtYWlucyBvd25lZCBieSB0aGUgZW5xdWV1ZSByZXF1ZXN0LlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL2RhdGFiYXNlL2RyaXZlcnMvYmFzZS5qc1wiKS5kZWZhdWx0fSBkYiAtIERhdGFiYXNlIGNvbm5lY3Rpb24uXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi90eXBlcy5qc1wiKS5CYWNrZ3JvdW5kSm9iUm93fSBqb2IgLSBRdWV1ZWQgam9iIHNuYXBzaG90LlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxpbXBvcnQoXCIuL3R5cGVzLmpzXCIpLkJhY2tncm91bmRKb2JSb3cgfCBudWxsPn0gLSBSZWNvbmNpbGVkIGpvYiwgb3IgbnVsbCB3aGVuIGl0cyBxdWV1ZWQtc3RhdGUgZmVuY2UgbG9zdC5cbiAgICovXG4gIGFzeW5jIF9yZWNvbmNpbGVRdWV1ZWRKb2JDb25jdXJyZW5jeShkYiwgam9iKSB7XG4gICAgaWYgKGpvYi5jb25jdXJyZW5jeUtleSAmJiAham9iLmNvbmN1cnJlbmN5S2V5LnN0YXJ0c1dpdGgoUVVFVUVfQ09OQ1VSUkVOQ1lfS0VZX1BSRUZJWCkpIHtcbiAgICAgIHJldHVybiBqb2JcbiAgICB9XG5cbiAgICBjb25zdCBjb25jdXJyZW5jeSA9IHRoaXMuX3Jlc29sdmVDb25jdXJyZW5jeSh7fSwgam9iLnF1ZXVlKVxuICAgIC8qKiBAdHlwZSB7QmFja2dyb3VuZEpvYlF1ZXVlZENvbmN1cnJlbmN5fSAqL1xuICAgIGNvbnN0IGN1cnJlbnQgPSBjb25jdXJyZW5jeVxuICAgICAgPyB7Y29uY3VycmVuY3lLZXk6IGNvbmN1cnJlbmN5LmNvbmN1cnJlbmN5S2V5LCBtYXhDb25jdXJyZW5jeTogY29uY3VycmVuY3kubWF4Q29uY3VycmVuY3l9XG4gICAgICA6IHtjb25jdXJyZW5jeUtleTogbnVsbCwgbWF4Q29uY3VycmVuY3k6IG51bGx9XG5cbiAgICBpZiAoY29uY3VycmVuY3kpIGF3YWl0IHRoaXMuX2Vuc3VyZVF1ZXVlQ29uY3VycmVuY3lLZXkoZGIsIGNvbmN1cnJlbmN5KVxuICAgIGlmIChqb2IuY29uY3VycmVuY3lLZXkgPT09IGN1cnJlbnQuY29uY3VycmVuY3lLZXkgJiYgam9iLm1heENvbmN1cnJlbmN5ID09PSBjdXJyZW50Lm1heENvbmN1cnJlbmN5KSByZXR1cm4gam9iXG5cbiAgICBjb25zdCBhZmZlY3RlZFJvd3MgPSBhd2FpdCB0aGlzLl91cGRhdGVBZmZlY3RlZFJvd3MoZGIsIHtcbiAgICAgIHRhYmxlTmFtZTogSk9CU19UQUJMRSxcbiAgICAgIGRhdGE6IHtcbiAgICAgICAgY29uY3VycmVuY3lfa2V5OiBjdXJyZW50LmNvbmN1cnJlbmN5S2V5LFxuICAgICAgICBtYXhfY29uY3VycmVuY3k6IGN1cnJlbnQubWF4Q29uY3VycmVuY3lcbiAgICAgIH0sXG4gICAgICBjb25kaXRpb25zOiB7Y29uY3VycmVuY3lfa2V5OiBqb2IuY29uY3VycmVuY3lLZXksIGlkOiBqb2IuaWQsIHN0YXR1czogXCJxdWV1ZWRcIn1cbiAgICB9KVxuXG4gICAgaWYgKGFmZmVjdGVkUm93cyAhPT0gMSkgcmV0dXJuIG51bGxcblxuICAgIHJldHVybiB7Li4uam9iLCBjb25jdXJyZW5jeUtleTogY3VycmVudC5jb25jdXJyZW5jeUtleSwgbWF4Q29uY3VycmVuY3k6IGN1cnJlbnQubWF4Q29uY3VycmVuY3l9XG4gIH1cblxuICAvKipcbiAgICogUmVhZHMgdGhlIGNvbmZpZ3VyZWQgbWF4IGNvbmN1cnJlbmN5IGZvciBhIHF1ZXVlIGZyb20gdGhlIGJhY2tncm91bmQtam9icyBjb25maWcuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBxdWV1ZSAtIFF1ZXVlIG5hbWUuXG4gICAqIEByZXR1cm5zIHtudW1iZXIgfCBudWxsfSAtIFBvc2l0aXZlIGludGVnZXIgY2FwLCBvciBudWxsIHdoZW4gdGhlIHF1ZXVlIGhhcyBubyBjb25maWd1cmVkIGNhcC5cbiAgICovXG4gIF9xdWV1ZU1heENvbmN1cnJlbmN5KHF1ZXVlKSB7XG4gICAgY29uc3QgcXVldWVzID0gdGhpcy5jb25maWd1cmF0aW9uLmdldEJhY2tncm91bmRKb2JzQ29uZmlnKCkucXVldWVzXG4gICAgY29uc3QgY2FwID0gcXVldWVzPy5bcXVldWVdPy5tYXhDb25jdXJyZW50XG5cbiAgICBpZiAoTnVtYmVyLmlzSW50ZWdlcihjYXApICYmIE51bWJlcihjYXApID4gMCkgcmV0dXJuIE51bWJlcihjYXApXG5cbiAgICByZXR1cm4gbnVsbFxuICB9XG5cbiAgLyoqXG4gICAqIExpa2Uge0BsaW5rIF9lbnN1cmVDb25jdXJyZW5jeUtleX0sIGJ1dCBmb3IgcXVldWUtZGVyaXZlZCBrZXlzIHRoZSBjb25maWd1cmVkXG4gICAqIHF1ZXVlIGNhcCBpcyB0aGUgc291cmNlIG9mIHRydXRoOiBpZiBpdCBjaGFuZ2VkLCB1cGRhdGUgdGhlIHN0b3JlZCBjYXBcbiAgICogaW5zdGVhZCBvZiB0aHJvd2luZyBvbiBjb25mbGljdCAoY29uZmlnLWRyaXZlbiBjYXBzIG11c3QgYmUgdHVuYWJsZSkuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vZGF0YWJhc2UvZHJpdmVycy9iYXNlLmpzXCIpLmRlZmF1bHR9IGRiIC0gRGF0YWJhc2UgY29ubmVjdGlvbi5cbiAgICogQHBhcmFtIHt7Y29uY3VycmVuY3lLZXk6IHN0cmluZywgbWF4Q29uY3VycmVuY3k6IG51bWJlcn19IGNvbmN1cnJlbmN5IC0gQ29uY3VycmVuY3kgY29uZmlndXJhdGlvbi5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgd2hlbiBlbnN1cmVkLlxuICAgKi9cbiAgYXN5bmMgX2Vuc3VyZVF1ZXVlQ29uY3VycmVuY3lLZXkoZGIsIHtjb25jdXJyZW5jeUtleSwgbWF4Q29uY3VycmVuY3l9KSB7XG4gICAgY29uc3Qgcm93cyA9IGF3YWl0IGRiLm5ld1F1ZXJ5KCkuZnJvbShDT05DVVJSRU5DWV9UQUJMRSkud2hlcmUoe2NvbmN1cnJlbmN5X2tleTogY29uY3VycmVuY3lLZXl9KS5saW1pdCgxKS5yZXN1bHRzKClcblxuICAgIGlmICghcm93c1swXSkge1xuICAgICAgdHJ5IHtcbiAgICAgICAgYXdhaXQgZGIuaW5zZXJ0KHt0YWJsZU5hbWU6IENPTkNVUlJFTkNZX1RBQkxFLCBkYXRhOiB7YWN0aXZlX2NvdW50OiAwLCBjb25jdXJyZW5jeV9rZXk6IGNvbmN1cnJlbmN5S2V5LCBtYXhfY29uY3VycmVuY3k6IG1heENvbmN1cnJlbmN5fX0pXG5cbiAgICAgICAgcmV0dXJuXG4gICAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgICBjb25zdCByYWNlZFJvd3MgPSBhd2FpdCBkYi5uZXdRdWVyeSgpLmZyb20oQ09OQ1VSUkVOQ1lfVEFCTEUpLndoZXJlKHtjb25jdXJyZW5jeV9rZXk6IGNvbmN1cnJlbmN5S2V5fSkubGltaXQoMSkucmVzdWx0cygpXG5cbiAgICAgICAgaWYgKCFyYWNlZFJvd3NbMF0pIHRocm93IGVycm9yXG5cbiAgICAgICAgcm93c1swXSA9IHJhY2VkUm93c1swXVxuICAgICAgfVxuICAgIH1cblxuICAgIGNvbnN0IGNvbmZpZ3VyZWQgPSAvKiogQHR5cGUge3ttYXhfY29uY3VycmVuY3k/OiBudW1iZXIgfCBzdHJpbmd9fSAqLyAocm93c1swXSlcblxuICAgIGlmICh0aGlzLl9ub3JtYWxpemVOdW1iZXIoY29uZmlndXJlZC5tYXhfY29uY3VycmVuY3kpICE9PSBtYXhDb25jdXJyZW5jeSkge1xuICAgICAgY29uc3QgdGFibGUgPSBkYi5xdW90ZVRhYmxlKENPTkNVUlJFTkNZX1RBQkxFKVxuXG4gICAgICBhd2FpdCBkYi5xdWVyeShgVVBEQVRFICR7dGFibGV9IFNFVCAke2RiLnF1b3RlQ29sdW1uKFwibWF4X2NvbmN1cnJlbmN5XCIpfSA9ICR7TnVtYmVyKG1heENvbmN1cnJlbmN5KX0gV0hFUkUgJHtkYi5xdW90ZUNvbHVtbihcImNvbmN1cnJlbmN5X2tleVwiKX0gPSAke2RiLnF1b3RlKGNvbmN1cnJlbmN5S2V5KX1gKVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBFbnN1cmVzIHRoZSBjb25jdXJyZW5jeSBzdGF0ZSB0YWJsZSBleGlzdHMuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vZGF0YWJhc2UvZHJpdmVycy9iYXNlLmpzXCIpLmRlZmF1bHR9IGRiIC0gRGF0YWJhc2UgY29ubmVjdGlvbi5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgd2hlbiByZWFkeS5cbiAgICovXG4gIGFzeW5jIF9lbnN1cmVDb25jdXJyZW5jeVRhYmxlKGRiKSB7XG4gICAgaWYgKGF3YWl0IGRiLnRhYmxlRXhpc3RzKENPTkNVUlJFTkNZX1RBQkxFKSkgcmV0dXJuXG4gICAgY29uc3QgdGFibGUgPSBuZXcgVGFibGVEYXRhKENPTkNVUlJFTkNZX1RBQkxFLCB7aWZOb3RFeGlzdHM6IHRydWV9KVxuICAgIHRhYmxlLnN0cmluZyhcImNvbmN1cnJlbmN5X2tleVwiLCB7cHJpbWFyeUtleTogdHJ1ZX0pXG4gICAgdGFibGUuaW50ZWdlcihcIm1heF9jb25jdXJyZW5jeVwiLCB7bnVsbDogZmFsc2V9KVxuICAgIHRhYmxlLmludGVnZXIoXCJhY3RpdmVfY291bnRcIiwge251bGw6IGZhbHNlfSlcbiAgICBhd2FpdCBkYi5jcmVhdGVUYWJsZSh0YWJsZSlcbiAgfVxuXG4gIC8qKlxuICAgKiBFbnN1cmVzIHRoZSBzdGFibGUgc2NoZWR1bGUta2V5IG93bmVyc2hpcCB0YWJsZSBleGlzdHMuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vZGF0YWJhc2UvZHJpdmVycy9iYXNlLmpzXCIpLmRlZmF1bHR9IGRiIC0gRGF0YWJhc2UgY29ubmVjdGlvbi5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgd2hlbiByZWFkeS5cbiAgICovXG4gIGFzeW5jIF9lbnN1cmVTY2hlZHVsZUtleXNUYWJsZShkYikge1xuICAgIGlmIChhd2FpdCBkYi50YWJsZUV4aXN0cyhTQ0hFRFVMRV9LRVlTX1RBQkxFKSkgcmV0dXJuXG5cbiAgICBjb25zdCBsb2NrTmFtZSA9IGAke01JR1JBVElPTl9TQ09QRX06c2NoZWR1bGVfa2V5c190YWJsZWBcbiAgICBjb25zdCBhY3F1aXJlZCA9IGF3YWl0IGRiLmFjcXVpcmVBZHZpc29yeUxvY2sobG9ja05hbWUpXG5cbiAgICBpZiAoIWFjcXVpcmVkKSB0aHJvdyBuZXcgRXJyb3IoXCJGYWlsZWQgdG8gYWNxdWlyZSBiYWNrZ3JvdW5kIGpvYnMgc2NoZWR1bGUta2V5IHRhYmxlIHNjaGVtYSBsb2NrXCIpXG5cbiAgICB0cnkge1xuICAgICAgZGIuY2xlYXJTY2hlbWFDYWNoZSgpXG4gICAgICBpZiAoYXdhaXQgZGIudGFibGVFeGlzdHMoU0NIRURVTEVfS0VZU19UQUJMRSkpIHJldHVyblxuXG4gICAgICBjb25zdCB0YWJsZSA9IG5ldyBUYWJsZURhdGEoU0NIRURVTEVfS0VZU19UQUJMRSwge2lmTm90RXhpc3RzOiB0cnVlfSlcblxuICAgICAgdGFibGUuc3RyaW5nKFwic2NoZWR1bGVfa2V5XCIsIHtwcmltYXJ5S2V5OiB0cnVlfSlcbiAgICAgIHRhYmxlLnN0cmluZyhcImpvYl9pZFwiLCB7bnVsbDogZmFsc2UsIGluZGV4OiB0cnVlfSlcbiAgICAgIGF3YWl0IGRiLmNyZWF0ZVRhYmxlKHRhYmxlKVxuICAgICAgZGIuY2xlYXJTY2hlbWFDYWNoZSgpXG4gICAgfSBmaW5hbGx5IHtcbiAgICAgIGF3YWl0IGRiLnJlbGVhc2VBZHZpc29yeUxvY2sobG9ja05hbWUpXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIEVuc3VyZXMgZHVyYWJsZSBnZW5lcmljIGVucXVldWUgb3duZXJzaGlwIGV4aXN0cyBpbmRlcGVuZGVudGx5IG9mIGpvYiByb3dzLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL2RhdGFiYXNlL2RyaXZlcnMvYmFzZS5qc1wiKS5kZWZhdWx0fSBkYiAtIERhdGFiYXNlIGNvbm5lY3Rpb24uXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIHdoZW4gcmVhZHkuXG4gICAqL1xuICBhc3luYyBfZW5zdXJlSWRlbXBvdGVuY3lLZXlzVGFibGUoZGIpIHtcbiAgICBpZiAoYXdhaXQgZGIudGFibGVFeGlzdHMoSURFTVBPVEVOQ1lfS0VZU19UQUJMRSkpIHJldHVyblxuXG4gICAgY29uc3QgbG9ja05hbWUgPSBgJHtNSUdSQVRJT05fU0NPUEV9OmlkZW1wb3RlbmN5X2tleXNfdGFibGVgXG4gICAgY29uc3QgYWNxdWlyZWQgPSBhd2FpdCBkYi5hY3F1aXJlQWR2aXNvcnlMb2NrKGxvY2tOYW1lKVxuXG4gICAgaWYgKCFhY3F1aXJlZCkgdGhyb3cgbmV3IEVycm9yKFwiRmFpbGVkIHRvIGFjcXVpcmUgYmFja2dyb3VuZCBqb2IgaWRlbXBvdGVuY3kta2V5IHRhYmxlIHNjaGVtYSBsb2NrXCIpXG5cbiAgICB0cnkge1xuICAgICAgZGIuY2xlYXJTY2hlbWFDYWNoZSgpXG4gICAgICBpZiAoYXdhaXQgZGIudGFibGVFeGlzdHMoSURFTVBPVEVOQ1lfS0VZU19UQUJMRSkpIHJldHVyblxuXG4gICAgICBjb25zdCB0YWJsZSA9IG5ldyBUYWJsZURhdGEoSURFTVBPVEVOQ1lfS0VZU19UQUJMRSwge2lmTm90RXhpc3RzOiB0cnVlfSlcblxuICAgICAgdGFibGUuc3RyaW5nKFwic2NvcGVfZGlnZXN0XCIsIHtwcmltYXJ5S2V5OiB0cnVlfSlcbiAgICAgIHRhYmxlLnN0cmluZyhcImpvYl9uYW1lXCIsIHtudWxsOiBmYWxzZX0pXG4gICAgICB0YWJsZS5zdHJpbmcoXCJxdWV1ZVwiLCB7bnVsbDogZmFsc2V9KVxuICAgICAgdGFibGUudGV4dChcImlkZW1wb3RlbmN5X2tleVwiLCB7bnVsbDogZmFsc2V9KVxuICAgICAgdGFibGUuc3RyaW5nKFwiam9iX2lkXCIsIHtpbmRleDogdHJ1ZSwgbnVsbDogZmFsc2V9KVxuICAgICAgdGFibGUuc3RyaW5nKFwicmVxdWVzdF9kaWdlc3RcIiwge251bGw6IGZhbHNlfSlcbiAgICAgIHRhYmxlLmJpZ2ludChcImNyZWF0ZWRfYXRfbXNcIiwge251bGw6IGZhbHNlfSlcbiAgICAgIGF3YWl0IGRiLmNyZWF0ZVRhYmxlKHRhYmxlKVxuICAgICAgZGIuY2xlYXJTY2hlbWFDYWNoZSgpXG4gICAgfSBmaW5hbGx5IHtcbiAgICAgIGF3YWl0IGRiLnJlbGVhc2VBZHZpc29yeUxvY2sobG9ja05hbWUpXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIEVuc3VyZXMgZHVyYWJsZSBwcm92aWRlci1iYWNrZWQgbWFpbCBvcGVyYXRpb24gc3RhdGUgZXhpc3RzIGluZGVwZW5kZW50bHkgb2Ygam9icy5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9kYXRhYmFzZS9kcml2ZXJzL2Jhc2UuanNcIikuZGVmYXVsdH0gZGIgLSBEYXRhYmFzZSBjb25uZWN0aW9uLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyB3aGVuIHJlYWR5LlxuICAgKi9cbiAgYXN5bmMgX2Vuc3VyZU1haWxEZWxpdmVyeU9wZXJhdGlvbnNUYWJsZShkYikge1xuICAgIGlmIChhd2FpdCBkYi50YWJsZUV4aXN0cyhNQUlMX0RFTElWRVJZX09QRVJBVElPTlNfVEFCTEUpKSByZXR1cm5cblxuICAgIGNvbnN0IGxvY2tOYW1lID0gYCR7TUlHUkFUSU9OX1NDT1BFfTptYWlsX2RlbGl2ZXJ5X29wZXJhdGlvbnNfdGFibGVgXG4gICAgY29uc3QgYWNxdWlyZWQgPSBhd2FpdCBkYi5hY3F1aXJlQWR2aXNvcnlMb2NrKGxvY2tOYW1lKVxuXG4gICAgaWYgKCFhY3F1aXJlZCkgdGhyb3cgbmV3IEVycm9yKFwiRmFpbGVkIHRvIGFjcXVpcmUgbWFpbCBkZWxpdmVyeSBvcGVyYXRpb24gdGFibGUgc2NoZW1hIGxvY2tcIilcblxuICAgIHRyeSB7XG4gICAgICBkYi5jbGVhclNjaGVtYUNhY2hlKClcbiAgICAgIGlmIChhd2FpdCBkYi50YWJsZUV4aXN0cyhNQUlMX0RFTElWRVJZX09QRVJBVElPTlNfVEFCTEUpKSByZXR1cm5cblxuICAgICAgY29uc3QgdGFibGUgPSBuZXcgVGFibGVEYXRhKE1BSUxfREVMSVZFUllfT1BFUkFUSU9OU19UQUJMRSwge2lmTm90RXhpc3RzOiB0cnVlfSlcblxuICAgICAgdGFibGUuc3RyaW5nKFwib3BlcmF0aW9uX2tleVwiLCB7cHJpbWFyeUtleTogdHJ1ZX0pXG4gICAgICB0YWJsZS50ZXh0KFwib3BlcmF0aW9uX2lkXCIsIHtudWxsOiBmYWxzZX0pXG4gICAgICB0YWJsZS5zdHJpbmcoXCJwYXlsb2FkX2RpZ2VzdFwiLCB7bnVsbDogZmFsc2V9KVxuICAgICAgdGFibGUuc3RyaW5nKFwiYmFja2dyb3VuZF9qb2JfaWRcIiwge2luZGV4OiB0cnVlLCBudWxsOiBmYWxzZX0pXG4gICAgICB0YWJsZS5iaWdpbnQoXCJmaXJzdF9hdHRlbXB0X3N0YXJ0ZWRfYXRfbXNcIiwge251bGw6IHRydWV9KVxuICAgICAgdGFibGUuc3RyaW5nKFwicHJvdmlkZXJfa2luZFwiLCB7bnVsbDogZmFsc2V9KVxuICAgICAgdGFibGUuYmlnaW50KFwicHJvdmlkZXJfcmV0ZW50aW9uX21zXCIsIHtudWxsOiBmYWxzZX0pXG4gICAgICB0YWJsZS5iaWdpbnQoXCJjcmVhdGVkX2F0X21zXCIsIHtudWxsOiBmYWxzZX0pXG4gICAgICBhd2FpdCBkYi5jcmVhdGVUYWJsZSh0YWJsZSlcbiAgICAgIGRiLmNsZWFyU2NoZW1hQ2FjaGUoKVxuICAgIH0gZmluYWxseSB7XG4gICAgICBhd2FpdCBkYi5yZWxlYXNlQWR2aXNvcnlMb2NrKGxvY2tOYW1lKVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBFbnN1cmVzIHRoZSBzaW5nbGV0b24gZHVyYWJsZSBjb3VudC1yZXZpc2lvbiByb3cgZXhpc3RzLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL2RhdGFiYXNlL2RyaXZlcnMvYmFzZS5qc1wiKS5kZWZhdWx0fSBkYiAtIERhdGFiYXNlIGNvbm5lY3Rpb24uXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSBSZXNvbHZlcyB3aGVuIHJlYWR5LlxuICAgKi9cbiAgYXN5bmMgX2Vuc3VyZUNvdW50UmV2aXNpb25UYWJsZShkYikge1xuICAgIGlmICghKGF3YWl0IGRiLnRhYmxlRXhpc3RzKENPVU5UU19SRVZJU0lPTl9UQUJMRSkpKSB7XG4gICAgICBjb25zdCB0YWJsZSA9IG5ldyBUYWJsZURhdGEoQ09VTlRTX1JFVklTSU9OX1RBQkxFLCB7aWZOb3RFeGlzdHM6IHRydWV9KVxuXG4gICAgICB0YWJsZS5zdHJpbmcoXCJrZXlcIiwge3ByaW1hcnlLZXk6IHRydWV9KVxuICAgICAgdGFibGUuYmlnaW50KFwicmV2aXNpb25cIiwge251bGw6IGZhbHNlfSlcbiAgICAgIGF3YWl0IGRiLmNyZWF0ZVRhYmxlKHRhYmxlKVxuICAgIH1cblxuICAgIGNvbnN0IHJvd3MgPSBhd2FpdCBkYi5uZXdRdWVyeSgpLmZyb20oQ09VTlRTX1JFVklTSU9OX1RBQkxFKS53aGVyZSh7a2V5OiBDT1VOVFNfUkVWSVNJT05fS0VZfSkubGltaXQoMSkucmVzdWx0cygpXG5cbiAgICBpZiAocm93cy5sZW5ndGggPiAwKSByZXR1cm5cblxuICAgIHRyeSB7XG4gICAgICBhd2FpdCBkYi5pbnNlcnQoe3RhYmxlTmFtZTogQ09VTlRTX1JFVklTSU9OX1RBQkxFLCBkYXRhOiB7a2V5OiBDT1VOVFNfUkVWSVNJT05fS0VZLCByZXZpc2lvbjogMH19KVxuICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICBjb25zdCByYWNlZFJvd3MgPSBhd2FpdCBkYi5uZXdRdWVyeSgpLmZyb20oQ09VTlRTX1JFVklTSU9OX1RBQkxFKS53aGVyZSh7a2V5OiBDT1VOVFNfUkVWSVNJT05fS0VZfSkubGltaXQoMSkucmVzdWx0cygpXG5cbiAgICAgIGlmIChyYWNlZFJvd3MubGVuZ3RoID09PSAwKSB0aHJvdyBlcnJvclxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBSZWNvcmRzIG9uZSBsb2dpY2FsIGNvdW50IG11dGF0aW9uIGF0b21pY2FsbHkgYW5kIGJyb2FkY2FzdHMgaXQgYWZ0ZXIgY29tbWl0LlxuICAgKiBaZXJvIGVudHJpZXMgYXJlIG9taXR0ZWQ7IGEgd2hvbGx5IHplcm8tbmV0IG11dGF0aW9uIGRvZXMgbm90IGNvbnN1bWUgYSByZXZpc2lvbi5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9kYXRhYmFzZS9kcml2ZXJzL2Jhc2UuanNcIikuZGVmYXVsdH0gZGIgLSBUcmFuc2FjdGlvbiBjb25uZWN0aW9uLlxuICAgKiBAcGFyYW0ge1JlY29yZDxzdHJpbmcsIG51bWJlcj59IHJlcXVlc3RlZERlbHRhcyAtIFNpZ25lZCBidWNrZXQgY2hhbmdlcy5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IFJlc29sdmVzIHdoZW4gcmVjb3JkZWQuXG4gICAqL1xuICBhc3luYyBfcmVjb3JkQ291bnREZWx0YShkYiwgcmVxdWVzdGVkRGVsdGFzKSB7XG4gICAgLyoqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBudW1iZXI+fSAqL1xuICAgIGNvbnN0IGRlbHRhcyA9IHt9XG5cbiAgICBmb3IgKGNvbnN0IGJ1Y2tldCBvZiBCQUNLR1JPVU5EX0pPQl9DT1VOVF9CVUNLRVRTKSB7XG4gICAgICBjb25zdCBhbW91bnQgPSByZXF1ZXN0ZWREZWx0YXNbYnVja2V0XSB8fCAwXG5cbiAgICAgIGlmICghTnVtYmVyLmlzSW50ZWdlcihhbW91bnQpKSB0aHJvdyBuZXcgRXJyb3IoYEludmFsaWQgYmFja2dyb3VuZCBqb2IgY291bnQgZGVsdGEgZm9yICR7YnVja2V0fTogJHthbW91bnR9YClcbiAgICAgIGlmIChhbW91bnQgIT09IDApIGRlbHRhc1tidWNrZXRdID0gYW1vdW50XG4gICAgfVxuXG4gICAgaWYgKE9iamVjdC5rZXlzKGRlbHRhcykubGVuZ3RoID09PSAwKSByZXR1cm5cblxuICAgIGNvbnN0IHRhYmxlID0gZGIucXVvdGVUYWJsZShDT1VOVFNfUkVWSVNJT05fVEFCTEUpXG4gICAgY29uc3QgcmV2aXNpb25Db2x1bW4gPSBkYi5xdW90ZUNvbHVtbihcInJldmlzaW9uXCIpXG4gICAgY29uc3QgYWZmZWN0ZWRSb3dzID0gYXdhaXQgZGIuYWZmZWN0ZWRSb3dzKFxuICAgICAgYFVQREFURSAke3RhYmxlfSBTRVQgJHtyZXZpc2lvbkNvbHVtbn0gPSAke3JldmlzaW9uQ29sdW1ufSArIDEgV0hFUkUgJHtkYi5xdW90ZUNvbHVtbihcImtleVwiKX0gPSAke2RiLnF1b3RlKENPVU5UU19SRVZJU0lPTl9LRVkpfWBcbiAgICApXG5cbiAgICBpZiAoYWZmZWN0ZWRSb3dzICE9PSAxKSB0aHJvdyBuZXcgRXJyb3IoXCJCYWNrZ3JvdW5kIGpvYiBjb3VudCByZXZpc2lvbiByb3cgaXMgbWlzc2luZ1wiKVxuXG4gICAgY29uc3QgcmV2aXNpb24gPSBhd2FpdCB0aGlzLl9jb3VudFJldmlzaW9uKGRiKVxuICAgIGNvbnN0IGJvZHkgPSB7ZGVsdGFzLCByZXZpc2lvbiwgdHlwZTogXCJiYWNrZ3JvdW5kLWpvYi1jb3VudC1kZWx0YVwifVxuICAgIGNvbnN0IGRhdGFiYXNlSWRlbnRpZmllciA9IHRoaXMuZ2V0RGF0YWJhc2VJZGVudGlmaWVyKCkgfHwgXCJkZWZhdWx0XCJcblxuICAgIGF3YWl0IGRiLmFmdGVyQ29tbWl0KCgpID0+IHtcbiAgICAgIHRoaXMuY29uZmlndXJhdGlvbi5icm9hZGNhc3RUb0NoYW5uZWwoQkFDS0dST1VORF9KT0JfQ09VTlRTX0NIQU5ORUwsIHtkYXRhYmFzZUlkZW50aWZpZXJ9LCBib2R5KVxuICAgIH0pXG4gIH1cblxuICAvKipcbiAgICogUmVjb3JkcyBhIHRyYW5zaXRpb24gYmV0d2VlbiBwZXJzaXN0ZWQgc3RhdHVzZXMuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vZGF0YWJhc2UvZHJpdmVycy9iYXNlLmpzXCIpLmRlZmF1bHR9IGRiIC0gVHJhbnNhY3Rpb24gY29ubmVjdGlvbi5cbiAgICogQHBhcmFtIHtzdHJpbmd9IG9sZFN0YXR1cyAtIFByZXZpb3VzIHN0YXR1cy5cbiAgICogQHBhcmFtIHtzdHJpbmd9IG5ld1N0YXR1cyAtIE5ldyBzdGF0dXMuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSBSZXNvbHZlcyB3aGVuIHJlY29yZGVkLlxuICAgKi9cbiAgYXN5bmMgX3JlY29yZFN0YXR1c1RyYW5zaXRpb24oZGIsIG9sZFN0YXR1cywgbmV3U3RhdHVzKSB7XG4gICAgY29uc3Qgb2xkQ291bnRlZCA9IENPVU5URURfSk9CX1NUQVRVU0VTLmluY2x1ZGVzKG9sZFN0YXR1cylcbiAgICBjb25zdCBuZXdDb3VudGVkID0gQ09VTlRFRF9KT0JfU1RBVFVTRVMuaW5jbHVkZXMobmV3U3RhdHVzKVxuXG4gICAgaWYgKCFvbGRDb3VudGVkICYmIG9sZFN0YXR1cyAhPT0gXCJjYW5jZWxsZWRcIikgdGhyb3cgbmV3IEVycm9yKGBVbmtub3duIHByZXZpb3VzIGJhY2tncm91bmQgam9iIHN0YXR1czogJHtvbGRTdGF0dXN9YClcbiAgICBpZiAoIW5ld0NvdW50ZWQgJiYgbmV3U3RhdHVzICE9PSBcImNhbmNlbGxlZFwiKSB0aHJvdyBuZXcgRXJyb3IoYFVua25vd24gbmV4dCBiYWNrZ3JvdW5kIGpvYiBzdGF0dXM6ICR7bmV3U3RhdHVzfWApXG4gICAgaWYgKG9sZFN0YXR1cyA9PT0gbmV3U3RhdHVzKSByZXR1cm5cblxuICAgIC8qKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgbnVtYmVyPn0gKi9cbiAgICBjb25zdCBkZWx0YXMgPSB7fVxuXG4gICAgaWYgKG9sZENvdW50ZWQpIGRlbHRhc1tvbGRTdGF0dXNdID0gLTFcbiAgICBpZiAobmV3Q291bnRlZCkgZGVsdGFzW25ld1N0YXR1c10gPSAxXG4gICAgaWYgKG9sZENvdW50ZWQgIT09IG5ld0NvdW50ZWQpIGRlbHRhcy5hbGwgPSBuZXdDb3VudGVkID8gMSA6IC0xXG4gICAgYXdhaXQgdGhpcy5fcmVjb3JkQ291bnREZWx0YShkYiwgZGVsdGFzKVxuICB9XG5cbiAgLyoqXG4gICAqIFJlYWRzIHRoZSBsb2NrZWQgcmV2aXNpb24uXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vZGF0YWJhc2UvZHJpdmVycy9iYXNlLmpzXCIpLmRlZmF1bHR9IGRiIC0gRGF0YWJhc2UgY29ubmVjdGlvbi5cbiAgICogQHJldHVybnMge1Byb21pc2U8bnVtYmVyPn0gUmV2aXNpb24uXG4gICAqL1xuICBhc3luYyBfY291bnRSZXZpc2lvbihkYikge1xuICAgIGNvbnN0IHJvd3MgPSBhd2FpdCBkYi5uZXdRdWVyeSgpLmZyb20oQ09VTlRTX1JFVklTSU9OX1RBQkxFKS5zZWxlY3QoXCJyZXZpc2lvblwiKS53aGVyZSh7a2V5OiBDT1VOVFNfUkVWSVNJT05fS0VZfSkubGltaXQoMSkucmVzdWx0cygpXG4gICAgY29uc3QgcmV2aXNpb24gPSB0aGlzLl9ub3JtYWxpemVOdW1iZXIoLyoqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59ICovIChyb3dzWzBdIHx8IHt9KS5yZXZpc2lvbilcblxuICAgIGlmIChyZXZpc2lvbiA9PT0gbnVsbCB8fCAhTnVtYmVyLmlzU2FmZUludGVnZXIocmV2aXNpb24pIHx8IHJldmlzaW9uIDwgMCkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKGBJbnZhbGlkIGJhY2tncm91bmQgam9iIGNvdW50IHJldmlzaW9uOiAke3JldmlzaW9ufWApXG4gICAgfVxuXG4gICAgcmV0dXJuIHJldmlzaW9uXG4gIH1cblxuICAvKipcbiAgICogVGFrZXMgYSBwb3J0YWJsZSB3cml0ZSBsb2NrIG9uIHRoZSBzaW5nbGV0b24gcmV2aXNpb24gcm93LlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL2RhdGFiYXNlL2RyaXZlcnMvYmFzZS5qc1wiKS5kZWZhdWx0fSBkYiAtIERhdGFiYXNlIGNvbm5lY3Rpb24uXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSBSZXNvbHZlcyB3aGVuIGxvY2tlZC5cbiAgICovXG4gIGFzeW5jIF9sb2NrQ291bnRSZXZpc2lvbihkYikge1xuICAgIGNvbnN0IHRhYmxlID0gZGIucXVvdGVUYWJsZShDT1VOVFNfUkVWSVNJT05fVEFCTEUpXG4gICAgY29uc3QgcmV2aXNpb24gPSBkYi5xdW90ZUNvbHVtbihcInJldmlzaW9uXCIpXG5cbiAgICBhd2FpdCBkYi5xdWVyeShgVVBEQVRFICR7dGFibGV9IFNFVCAke3JldmlzaW9ufSA9ICR7cmV2aXNpb259IFdIRVJFICR7ZGIucXVvdGVDb2x1bW4oXCJrZXlcIil9ID0gJHtkYi5xdW90ZShDT1VOVFNfUkVWSVNJT05fS0VZKX1gKVxuICB9XG5cbiAgLyoqXG4gICAqIEJ1aWxkcyB6ZXJvZWQgY2Fub25pY2FsIGJ1Y2tldHMuXG4gICAqIEByZXR1cm5zIHtSZWNvcmQ8c3RyaW5nLCBudW1iZXI+fSBaZXJvZWQgY2Fub25pY2FsIGJ1Y2tldHMuXG4gICAqL1xuICBfZW1wdHlDb3VudEJ1Y2tldHMoKSB7XG4gICAgcmV0dXJuIE9iamVjdC5mcm9tRW50cmllcyhCQUNLR1JPVU5EX0pPQl9DT1VOVF9CVUNLRVRTLm1hcCgoYnVja2V0KSA9PiBbYnVja2V0LCAwXSkpXG4gIH1cblxuICAvKipcbiAgICogQ291bnRzIG5vcm1hbGl6ZWQgcm93cyBieSBjYW5vbmljYWwgc3RhdHVzLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vdHlwZXMuanNcIikuQmFja2dyb3VuZEpvYlJvd1tdfSBqb2JzIC0gSm9icy5cbiAgICogQHJldHVybnMge1JlY29yZDxzdHJpbmcsIG51bWJlcj59IENvdW50cy5cbiAgICovXG4gIF9zdGF0dXNDb3VudHMoam9icykge1xuICAgIC8qKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgbnVtYmVyPn0gKi9cbiAgICBjb25zdCBjb3VudHMgPSB7fVxuXG4gICAgZm9yIChjb25zdCBqb2Igb2Ygam9icykge1xuICAgICAgaWYgKCFDT1VOVEVEX0pPQl9TVEFUVVNFUy5pbmNsdWRlcyhqb2Iuc3RhdHVzKSkgdGhyb3cgbmV3IEVycm9yKGBVbmtub3duIGJhY2tncm91bmQgam9iIHN0YXR1czogJHtqb2Iuc3RhdHVzfWApXG4gICAgICBjb3VudHNbam9iLnN0YXR1c10gPSAoY291bnRzW2pvYi5zdGF0dXNdIHx8IDApICsgMVxuICAgIH1cblxuICAgIHJldHVybiBjb3VudHNcbiAgfVxuXG4gIC8qKlxuICAgKiBSZWFkcyBhIGNhbm9uaWNhbCBzbmFwc2hvdCBhZnRlciBsb2NraW5nIHRoZSByZXZpc2lvbiByb3cuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vZGF0YWJhc2UvZHJpdmVycy9iYXNlLmpzXCIpLmRlZmF1bHR9IGRiIC0gVHJhbnNhY3Rpb24gY29ubmVjdGlvbi5cbiAgICogQHJldHVybnMge1Byb21pc2U8e2NvdW50czogUmVjb3JkPHN0cmluZywgbnVtYmVyPiwgcmV2aXNpb246IG51bWJlciwgdG90YWw6IG51bWJlcn0+fSBTbmFwc2hvdC5cbiAgICovXG4gIGFzeW5jIF9jb3VudFNuYXBzaG90T25Mb2NrZWRDb25uZWN0aW9uKGRiKSB7XG4gICAgY29uc3Qgcm93cyA9IGF3YWl0IGRiLm5ld1F1ZXJ5KCkuZnJvbShKT0JTX1RBQkxFKS5zZWxlY3QoXCJzdGF0dXNcIikuc2VsZWN0KFwiQ09VTlQoKikgQVMgY291bnRcIikuZ3JvdXAoXCJzdGF0dXNcIikucmVzdWx0cygpXG4gICAgY29uc3QgY291bnRzID0gdGhpcy5fZW1wdHlDb3VudEJ1Y2tldHMoKVxuICAgIGxldCB0b3RhbCA9IDBcblxuICAgIGZvciAoY29uc3Qgcm93IG9mIHJvd3MpIHtcbiAgICAgIGNvbnN0IHR5cGVkUm93ID0gLyoqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59ICovIChyb3cpXG4gICAgICBjb25zdCBzdGF0dXMgPSBTdHJpbmcodHlwZWRSb3cuc3RhdHVzKVxuICAgICAgY29uc3QgY291bnQgPSB0aGlzLl9ub3JtYWxpemVOdW1iZXIodHlwZWRSb3cuY291bnQpIHx8IDBcblxuICAgICAgdG90YWwgKz0gY291bnRcblxuICAgICAgaWYgKCFDT1VOVEVEX0pPQl9TVEFUVVNFUy5pbmNsdWRlcyhzdGF0dXMpKSBjb250aW51ZVxuICAgICAgY291bnRzW3N0YXR1c10gPSBjb3VudFxuICAgICAgY291bnRzLmFsbCArPSBjb3VudHNbc3RhdHVzXVxuICAgIH1cblxuICAgIHJldHVybiB7Y291bnRzLCByZXZpc2lvbjogYXdhaXQgdGhpcy5fY291bnRSZXZpc2lvbihkYiksIHRvdGFsfVxuICB9XG5cbiAgLyoqXG4gICAqIFJlZ2lzdGVycyBvciB2ZXJpZmllcyBhIHN0YWJsZSBrZXkgY29uZmlndXJhdGlvbi5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9kYXRhYmFzZS9kcml2ZXJzL2Jhc2UuanNcIikuZGVmYXVsdH0gZGIgLSBEYXRhYmFzZSBjb25uZWN0aW9uLlxuICAgKiBAcGFyYW0ge29iamVjdH0gY29uY3VycmVuY3kgLSBDb25jdXJyZW5jeSBjb25maWd1cmF0aW9uLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gY29uY3VycmVuY3kuY29uY3VycmVuY3lLZXkgLSBDb25jdXJyZW5jeSBrZXkuXG4gICAqIEBwYXJhbSB7bnVtYmVyfSBjb25jdXJyZW5jeS5tYXhDb25jdXJyZW5jeSAtIFN0YWJsZSBjYXAuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIHdoZW4gdmVyaWZpZWQuXG4gICAqL1xuICBhc3luYyBfZW5zdXJlQ29uY3VycmVuY3lLZXkoZGIsIHtjb25jdXJyZW5jeUtleSwgbWF4Q29uY3VycmVuY3l9KSB7XG4gICAgY29uc3Qgcm93cyA9IGF3YWl0IGRiLm5ld1F1ZXJ5KCkuZnJvbShDT05DVVJSRU5DWV9UQUJMRSkud2hlcmUoe2NvbmN1cnJlbmN5X2tleTogY29uY3VycmVuY3lLZXl9KS5saW1pdCgxKS5yZXN1bHRzKClcbiAgICBpZiAoIXJvd3NbMF0pIHtcbiAgICAgIHRyeSB7XG4gICAgICAgIGF3YWl0IGRiLmluc2VydCh7dGFibGVOYW1lOiBDT05DVVJSRU5DWV9UQUJMRSwgZGF0YToge2FjdGl2ZV9jb3VudDogMCwgY29uY3VycmVuY3lfa2V5OiBjb25jdXJyZW5jeUtleSwgbWF4X2NvbmN1cnJlbmN5OiBtYXhDb25jdXJyZW5jeX19KVxuICAgICAgICByZXR1cm5cbiAgICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICAgIGNvbnN0IHJhY2VkUm93cyA9IGF3YWl0IGRiLm5ld1F1ZXJ5KCkuZnJvbShDT05DVVJSRU5DWV9UQUJMRSkud2hlcmUoe2NvbmN1cnJlbmN5X2tleTogY29uY3VycmVuY3lLZXl9KS5saW1pdCgxKS5yZXN1bHRzKClcbiAgICAgICAgaWYgKCFyYWNlZFJvd3NbMF0pIHRocm93IGVycm9yXG4gICAgICAgIHJvd3NbMF0gPSByYWNlZFJvd3NbMF1cbiAgICAgIH1cbiAgICB9XG4gICAgY29uc3QgY29uZmlndXJlZCA9IC8qKiBAdHlwZSB7e21heF9jb25jdXJyZW5jeT86IG51bWJlciB8IHN0cmluZ319ICovIChyb3dzWzBdKVxuICAgIGlmICh0aGlzLl9ub3JtYWxpemVOdW1iZXIoY29uZmlndXJlZC5tYXhfY29uY3VycmVuY3kpICE9PSBtYXhDb25jdXJyZW5jeSkgdGhyb3cgbmV3IEVycm9yKGBDb25mbGljdGluZyBtYXhDb25jdXJyZW5jeSBmb3IgYmFja2dyb3VuZCBqb2IgY29uY3VycmVuY3lLZXk6ICR7Y29uY3VycmVuY3lLZXl9YClcbiAgfVxuXG4gIC8qKlxuICAgKiBMb2NrcyB0aGUgY29uY3VycmVuY3kgY291bnRlciByb3cgc28gYSBqb2ItcmVsZWFzZSB0cmFuc2FjdGlvbiBhY3F1aXJlcyBpdCAqYmVmb3JlKiB0aGUgam9iXG4gICAqIHJvdy4ge0BsaW5rIG1hcmtIYW5kZWRPZmZ9IHJlc2VydmVzIGNhcGFjaXR5IChsb2NraW5nIHRoZSBjb3VudGVyIHJvdykgYmVmb3JlIGl0IHVwZGF0ZXMgdGhlXG4gICAqIGpvYiwgc28gaXQgbG9ja3MgY29uY3VycmVuY3ktdGhlbi1qb2I7IHRoZSByZWxlYXNlIHBhdGhzIHVwZGF0ZSB0aGUgam9iIGJlZm9yZSByZWxlYXNpbmdcbiAgICogY2FwYWNpdHksIHdoaWNoIGlzIGpvYi10aGVuLWNvbmN1cnJlbmN5LiBUaG9zZSBvcHBvc2l0ZSBvcmRlcnMgb24gdGhlIHNhbWUgc2hhcmVkIGNvdW50ZXIgcm93XG4gICAqIGFyZSB3aGF0IGRlYWRsb2NrIChBQi1CQSkgdW5kZXIgYSBkcmFpbmluZyB3b3JrZXIuIFRha2luZyB0aGlzIGxvY2sgZmlyc3QgZ2l2ZXMgZXZlcnlcbiAgICogdHJhbnNhY3Rpb24gYSBzaW5nbGUgY29uY3VycmVuY3ktdGhlbi1qb2Igb3JkZXIgYW5kIHJlbW92ZXMgdGhlIGN5Y2xlLlxuICAgKlxuICAgKiBVc2VzIGEgdmFsdWUtcHJlc2VydmluZyBgVVBEQVRFYCByYXRoZXIgdGhhbiBgU0VMRUNUIC4uLiBGT1IgVVBEQVRFYCBzbyBpdCBzdGF5cyBwb3J0YWJsZVxuICAgKiBhY3Jvc3MgZHJpdmVycyB3aXRob3V0IHJvdy1sZXZlbCBsb2NraW5nIHJlYWRzIChlLmcuIFNRTGl0ZSk7IG9uIHJvdy1sb2NraW5nIGVuZ2luZXMgdGhlXG4gICAqIG1hdGNoZWQgcm93IGlzIHdyaXRlLWxvY2tlZCBmb3IgdGhlIHJlc3Qgb2YgdGhlIHRyYW5zYWN0aW9uIGV2ZW4gdGhvdWdoIGl0cyB2YWx1ZSBpcyB1bmNoYW5nZWQuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vZGF0YWJhc2UvZHJpdmVycy9iYXNlLmpzXCIpLmRlZmF1bHR9IGRiIC0gRGF0YWJhc2UgY29ubmVjdGlvbi5cbiAgICogQHBhcmFtIHtzdHJpbmcgfCBudWxsfSBjb25jdXJyZW5jeUtleSAtIENvbmN1cnJlbmN5IGtleS5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgd2hlbiB0aGUgY291bnRlciByb3cgaXMgbG9ja2VkLlxuICAgKi9cbiAgYXN5bmMgX2xvY2tDb25jdXJyZW5jeVJvdyhkYiwgY29uY3VycmVuY3lLZXkpIHtcbiAgICBpZiAoIWNvbmN1cnJlbmN5S2V5KSByZXR1cm5cbiAgICBjb25zdCB0YWJsZSA9IGRiLnF1b3RlVGFibGUoQ09OQ1VSUkVOQ1lfVEFCTEUpXG4gICAgY29uc3QgY291bnQgPSBkYi5xdW90ZUNvbHVtbihcImFjdGl2ZV9jb3VudFwiKVxuICAgIGF3YWl0IGRiLnF1ZXJ5KGBVUERBVEUgJHt0YWJsZX0gU0VUICR7Y291bnR9ID0gJHtjb3VudH0gV0hFUkUgJHtkYi5xdW90ZUNvbHVtbihcImNvbmN1cnJlbmN5X2tleVwiKX0gPSAke2RiLnF1b3RlKGNvbmN1cnJlbmN5S2V5KX1gKVxuICB9XG5cbiAgLyoqXG4gICAqIEF0b21pY2FsbHkgcmVzZXJ2ZXMgY2FwYWNpdHkgZm9yIGEga2V5LlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL2RhdGFiYXNlL2RyaXZlcnMvYmFzZS5qc1wiKS5kZWZhdWx0fSBkYiAtIERhdGFiYXNlIGNvbm5lY3Rpb24uXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBjb25jdXJyZW5jeUtleSAtIENvbmN1cnJlbmN5IGtleS5cbiAgICogQHJldHVybnMge1Byb21pc2U8Ym9vbGVhbj59IC0gV2hldGhlciBjYXBhY2l0eSB3YXMgcmVzZXJ2ZWQuXG4gICAqL1xuICBhc3luYyBfcmVzZXJ2ZUNvbmN1cnJlbmN5KGRiLCBjb25jdXJyZW5jeUtleSkge1xuICAgIGNvbnN0IHRhYmxlID0gZGIucXVvdGVUYWJsZShDT05DVVJSRU5DWV9UQUJMRSlcbiAgICBjb25zdCBjb3VudCA9IGRiLnF1b3RlQ29sdW1uKFwiYWN0aXZlX2NvdW50XCIpXG4gICAgY29uc3QgYWZmZWN0ZWRSb3dzID0gYXdhaXQgZGIuYWZmZWN0ZWRSb3dzKGBVUERBVEUgJHt0YWJsZX0gU0VUICR7Y291bnR9ID0gJHtjb3VudH0gKyAxIFdIRVJFICR7ZGIucXVvdGVDb2x1bW4oXCJjb25jdXJyZW5jeV9rZXlcIil9ID0gJHtkYi5xdW90ZShjb25jdXJyZW5jeUtleSl9IEFORCAke2NvdW50fSA8ICR7ZGIucXVvdGVDb2x1bW4oXCJtYXhfY29uY3VycmVuY3lcIil9YClcbiAgICByZXR1cm4gYWZmZWN0ZWRSb3dzID09PSAxXG4gIH1cblxuICAvKipcbiAgICogUnVucyBhIHBvcnRhYmxlIHVwZGF0ZSBhbmQgcmV0dXJucyBpdHMgYWZmZWN0ZWQtcm93IGNvdW50LlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL2RhdGFiYXNlL2RyaXZlcnMvYmFzZS5qc1wiKS5kZWZhdWx0fSBkYiAtIERhdGFiYXNlIGNvbm5lY3Rpb24uXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vZGF0YWJhc2UvZHJpdmVycy9iYXNlLmpzXCIpLlVwZGF0ZVNxbEFyZ3NUeXBlfSBhcmdzIC0gVXBkYXRlIG9wdGlvbnMuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPG51bWJlcj59IC0gQWZmZWN0ZWQgcm93IGNvdW50LlxuICAgKi9cbiAgYXN5bmMgX3VwZGF0ZUFmZmVjdGVkUm93cyhkYiwgYXJncykge1xuICAgIHJldHVybiBhd2FpdCBkYi5hZmZlY3RlZFJvd3MoZGIudXBkYXRlU3FsKGFyZ3MpKVxuICB9XG5cbiAgLyoqXG4gICAqIFJlbGVhc2VzIGNhcGFjaXR5IGZvciBhIGtleS5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9kYXRhYmFzZS9kcml2ZXJzL2Jhc2UuanNcIikuZGVmYXVsdH0gZGIgLSBEYXRhYmFzZSBjb25uZWN0aW9uLlxuICAgKiBAcGFyYW0ge3N0cmluZyB8IG51bGx9IGNvbmN1cnJlbmN5S2V5IC0gQ29uY3VycmVuY3kga2V5LlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyB3aGVuIHJlbGVhc2VkLlxuICAgKi9cbiAgYXN5bmMgX3JlbGVhc2VDb25jdXJyZW5jeShkYiwgY29uY3VycmVuY3lLZXkpIHtcbiAgICBpZiAoIWNvbmN1cnJlbmN5S2V5KSByZXR1cm5cbiAgICBjb25zdCB0YWJsZSA9IGRiLnF1b3RlVGFibGUoQ09OQ1VSUkVOQ1lfVEFCTEUpXG4gICAgY29uc3QgY291bnQgPSBkYi5xdW90ZUNvbHVtbihcImFjdGl2ZV9jb3VudFwiKVxuICAgIGF3YWl0IGRiLnF1ZXJ5KGBVUERBVEUgJHt0YWJsZX0gU0VUICR7Y291bnR9ID0gJHtjb3VudH0gLSAxIFdIRVJFICR7ZGIucXVvdGVDb2x1bW4oXCJjb25jdXJyZW5jeV9rZXlcIil9ID0gJHtkYi5xdW90ZShjb25jdXJyZW5jeUtleSl9IEFORCAke2NvdW50fSA+IDBgKVxuICB9XG5cbiAgLyoqXG4gICAqIFJlYnVpbGRzIGR1cmFibGUgY291bnRzIGZyb20gYWN0aXZlIGhhbmRvZmZzLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL2RhdGFiYXNlL2RyaXZlcnMvYmFzZS5qc1wiKS5kZWZhdWx0fSBkYiAtIERhdGFiYXNlIGNvbm5lY3Rpb24uXG4gICAqIEBwYXJhbSB7e2luc2lkZVRyYW5zYWN0aW9uPzogYm9vbGVhbn19IFtvcHRpb25zXSAtIFJldXNlIGFuIGVuY2xvc2luZyB0cmFuc2FjdGlvbi5cbiAgICogQHJldHVybnMge1Byb21pc2U8aW1wb3J0KFwiLi90eXBlcy5qc1wiKS5CYWNrZ3JvdW5kSm9iQ29uY3VycmVuY3lSZWNvbmNpbGlhdGlvbj59IC0gUmVwYWlyIHN1bW1hcnkuXG4gICAqL1xuICBhc3luYyBfcmVjb25jaWxlQ29uY3VycmVuY3koZGIsIHtpbnNpZGVUcmFuc2FjdGlvbiA9IGZhbHNlfSA9IHt9KSB7XG4gICAgaWYgKCEoYXdhaXQgZGIudGFibGVFeGlzdHMoQ09OQ1VSUkVOQ1lfVEFCTEUpKSkge1xuICAgICAgcmV0dXJuIHtjYW5kaWRhdGVDb3VudDogMCwgY2hlY2tlZENvdW50OiAwLCByZXBhaXJlZENvdW50OiAwLCByZXBhaXJzOiBbXSwgcmVwYWlyc1RydW5jYXRlZENvdW50OiAwfVxuICAgIH1cblxuICAgIGNvbnN0IGFjdGl2ZVJvd3MgPSBhd2FpdCBkYlxuICAgICAgLm5ld1F1ZXJ5KClcbiAgICAgIC5mcm9tKEpPQlNfVEFCTEUpXG4gICAgICAuc2VsZWN0KFwiY29uY3VycmVuY3lfa2V5XCIpXG4gICAgICAuc2VsZWN0KFwiQ09VTlQoKikgQVMgYWN0aXZlX2NvdW50XCIpXG4gICAgICAud2hlcmUoe3N0YXR1czogXCJoYW5kZWRfb2ZmXCJ9KVxuICAgICAgLndoZXJlKGAke2RiLnF1b3RlQ29sdW1uKFwiY29uY3VycmVuY3lfa2V5XCIpfSBJUyBOT1QgTlVMTGApXG4gICAgICAuZ3JvdXAoXCJjb25jdXJyZW5jeV9rZXlcIilcbiAgICAgIC5yZXN1bHRzKClcbiAgICBjb25zdCBzdGFsZVJvd3MgPSBhd2FpdCBkYlxuICAgICAgLm5ld1F1ZXJ5KClcbiAgICAgIC5mcm9tKENPTkNVUlJFTkNZX1RBQkxFKVxuICAgICAgLnNlbGVjdChcImNvbmN1cnJlbmN5X2tleVwiKVxuICAgICAgLnNlbGVjdChcImFjdGl2ZV9jb3VudFwiKVxuICAgICAgLndoZXJlKGAke2RiLnF1b3RlQ29sdW1uKFwiYWN0aXZlX2NvdW50XCIpfSAhPSAwYClcbiAgICAgIC5yZXN1bHRzKClcbiAgICAvKiogQHR5cGUge01hcDxzdHJpbmcsIG51bWJlcj59ICovXG4gICAgY29uc3QgYWN0aXZlQ291bnRzID0gbmV3IE1hcCgpXG4gICAgLyoqIEB0eXBlIHtNYXA8c3RyaW5nLCBudW1iZXI+fSAqL1xuICAgIGNvbnN0IHBlcnNpc3RlZENvdW50cyA9IG5ldyBNYXAoKVxuXG4gICAgZm9yIChjb25zdCByYXdSb3cgb2YgYWN0aXZlUm93cykge1xuICAgICAgY29uc3Qgcm93ID0gLyoqIEB0eXBlIHtCYWNrZ3JvdW5kSm9iQ29uY3VycmVuY3lDb3VudFJvd30gKi8gKHJhd1JvdylcbiAgICAgIGFjdGl2ZUNvdW50cy5zZXQocm93LmNvbmN1cnJlbmN5X2tleSwgdGhpcy5fdmFsaWRhdGVkQ29uY3VycmVuY3lDb3VudChyb3cuYWN0aXZlX2NvdW50LCByb3cuY29uY3VycmVuY3lfa2V5KSlcbiAgICB9XG5cbiAgICBmb3IgKGNvbnN0IHJhd1JvdyBvZiBzdGFsZVJvd3MpIHtcbiAgICAgIGNvbnN0IHJvdyA9IC8qKiBAdHlwZSB7QmFja2dyb3VuZEpvYkNvbmN1cnJlbmN5Q291bnRSb3d9ICovIChyYXdSb3cpXG4gICAgICBwZXJzaXN0ZWRDb3VudHMuc2V0KHJvdy5jb25jdXJyZW5jeV9rZXksIHRoaXMuX3ZhbGlkYXRlZENvbmN1cnJlbmN5Q291bnQocm93LmFjdGl2ZV9jb3VudCwgcm93LmNvbmN1cnJlbmN5X2tleSkpXG4gICAgfVxuXG4gICAgY29uc3QgY29uY3VycmVuY3lLZXlzID0gWy4uLm5ldyBTZXQoWy4uLmFjdGl2ZUNvdW50cy5rZXlzKCksIC4uLnBlcnNpc3RlZENvdW50cy5rZXlzKCldKV0uc29ydCgpXG4gICAgY29uc3QgY2FuZGlkYXRlS2V5cyA9IGNvbmN1cnJlbmN5S2V5cy5maWx0ZXIoKGNvbmN1cnJlbmN5S2V5KSA9PiB7XG4gICAgICByZXR1cm4gKGFjdGl2ZUNvdW50cy5nZXQoY29uY3VycmVuY3lLZXkpIHx8IDApICE9PSAocGVyc2lzdGVkQ291bnRzLmdldChjb25jdXJyZW5jeUtleSkgfHwgMClcbiAgICB9KVxuICAgIC8qKiBAdHlwZSB7aW1wb3J0KFwiLi90eXBlcy5qc1wiKS5CYWNrZ3JvdW5kSm9iQ29uY3VycmVuY3lSZXBhaXJbXX0gKi9cbiAgICBjb25zdCByZXBhaXJzID0gW11cbiAgICBsZXQgcmVwYWlyZWRDb3VudCA9IDBcblxuICAgIGZvciAoY29uc3QgY29uY3VycmVuY3lLZXkgb2YgY2FuZGlkYXRlS2V5cykge1xuICAgICAgY29uc3QgcmVwYWlyID0gaW5zaWRlVHJhbnNhY3Rpb25cbiAgICAgICAgPyBhd2FpdCB0aGlzLl9yZWNvbmNpbGVDb25jdXJyZW5jeUtleShkYiwgY29uY3VycmVuY3lLZXkpXG4gICAgICAgIDogYXdhaXQgdGhpcy5fdHJhbnNhY3Rpb25SZXN1bHQoZGIsIGFzeW5jICgpID0+IGF3YWl0IHRoaXMuX3JlY29uY2lsZUNvbmN1cnJlbmN5S2V5KGRiLCBjb25jdXJyZW5jeUtleSkpXG5cbiAgICAgIGlmICghcmVwYWlyKSBjb250aW51ZVxuXG4gICAgICByZXBhaXJlZENvdW50KytcbiAgICAgIGlmIChyZXBhaXJzLmxlbmd0aCA8IENPTkNVUlJFTkNZX1JFUEFJUl9TQU1QTEVfTElNSVQpIHJlcGFpcnMucHVzaChyZXBhaXIpXG4gICAgfVxuXG4gICAgcmV0dXJuIHtcbiAgICAgIGNhbmRpZGF0ZUNvdW50OiBjYW5kaWRhdGVLZXlzLmxlbmd0aCxcbiAgICAgIGNoZWNrZWRDb3VudDogY29uY3VycmVuY3lLZXlzLmxlbmd0aCxcbiAgICAgIHJlcGFpcmVkQ291bnQsXG4gICAgICByZXBhaXJzLFxuICAgICAgcmVwYWlyc1RydW5jYXRlZENvdW50OiByZXBhaXJlZENvdW50IC0gcmVwYWlycy5sZW5ndGhcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogUmVidWlsZHMgb25lIGNvdW50ZXIgYWZ0ZXIgbG9ja2luZyBpdCBhaGVhZCBvZiB0aGUgam9iIHJvd3MsIG1hdGNoaW5nIHRoZVxuICAgKiBsb2NrIG9yZGVyIHVzZWQgYnkgaGFuZG9mZiBhbmQgY29tcGxldGlvbiB0cmFuc2l0aW9ucy5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9kYXRhYmFzZS9kcml2ZXJzL2Jhc2UuanNcIikuZGVmYXVsdH0gZGIgLSBEYXRhYmFzZSBjb25uZWN0aW9uLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gY29uY3VycmVuY3lLZXkgLSBDb3VudGVyIGtleS5cbiAgICogQHJldHVybnMge1Byb21pc2U8aW1wb3J0KFwiLi90eXBlcy5qc1wiKS5CYWNrZ3JvdW5kSm9iQ29uY3VycmVuY3lSZXBhaXIgfCBudWxsPn0gLSBBcHBsaWVkIHJlcGFpci5cbiAgICovXG4gIGFzeW5jIF9yZWNvbmNpbGVDb25jdXJyZW5jeUtleShkYiwgY29uY3VycmVuY3lLZXkpIHtcbiAgICBhd2FpdCB0aGlzLl9sb2NrQ29uY3VycmVuY3lSb3coZGIsIGNvbmN1cnJlbmN5S2V5KVxuICAgIGNvbnN0IHBlcnNpc3RlZFJvd3MgPSBhd2FpdCBkYlxuICAgICAgLm5ld1F1ZXJ5KClcbiAgICAgIC5mcm9tKENPTkNVUlJFTkNZX1RBQkxFKVxuICAgICAgLnNlbGVjdChcImFjdGl2ZV9jb3VudFwiKVxuICAgICAgLnNlbGVjdChcImNvbmN1cnJlbmN5X2tleVwiKVxuICAgICAgLndoZXJlKHtjb25jdXJyZW5jeV9rZXk6IGNvbmN1cnJlbmN5S2V5fSlcbiAgICAgIC5saW1pdCgxKVxuICAgICAgLnJlc3VsdHMoKVxuXG4gICAgaWYgKCFwZXJzaXN0ZWRSb3dzWzBdKSB0aHJvdyBuZXcgRXJyb3IoYE1pc3NpbmcgYmFja2dyb3VuZCBqb2IgY29uY3VycmVuY3kgY291bnRlciBmb3IgJHtjb25jdXJyZW5jeUtleX1gKVxuXG4gICAgY29uc3QgcGVyc2lzdGVkUm93ID0gLyoqIEB0eXBlIHtCYWNrZ3JvdW5kSm9iQ29uY3VycmVuY3lDb3VudFJvd30gKi8gKHBlcnNpc3RlZFJvd3NbMF0pXG4gICAgY29uc3QgcHJldmlvdXNBY3RpdmVDb3VudCA9IHRoaXMuX3ZhbGlkYXRlZENvbmN1cnJlbmN5Q291bnQocGVyc2lzdGVkUm93LmFjdGl2ZV9jb3VudCwgY29uY3VycmVuY3lLZXkpXG4gICAgY29uc3Qgcm93cyA9IGF3YWl0IGRiXG4gICAgICAubmV3UXVlcnkoKVxuICAgICAgLmZyb20oSk9CU19UQUJMRSlcbiAgICAgIC5zZWxlY3QoXCJDT1VOVCgqKSBBUyBhY3RpdmVfY291bnRcIilcbiAgICAgIC53aGVyZSh7Y29uY3VycmVuY3lfa2V5OiBjb25jdXJyZW5jeUtleSwgc3RhdHVzOiBcImhhbmRlZF9vZmZcIn0pXG4gICAgICAucmVzdWx0cygpXG4gICAgY29uc3QgY291bnRSb3cgPSAvKiogQHR5cGUge3thY3RpdmVfY291bnQ6IG51bWJlciB8IHN0cmluZ319ICovIChyb3dzWzBdKVxuICAgIGNvbnN0IGFjdGl2ZUNvdW50ID0gdGhpcy5fdmFsaWRhdGVkQ29uY3VycmVuY3lDb3VudChjb3VudFJvdy5hY3RpdmVfY291bnQsIGNvbmN1cnJlbmN5S2V5KVxuXG4gICAgaWYgKGFjdGl2ZUNvdW50ID09PSBwcmV2aW91c0FjdGl2ZUNvdW50KSByZXR1cm4gbnVsbFxuXG4gICAgYXdhaXQgZGIudXBkYXRlKHtcbiAgICAgIHRhYmxlTmFtZTogQ09OQ1VSUkVOQ1lfVEFCTEUsXG4gICAgICBkYXRhOiB7YWN0aXZlX2NvdW50OiBhY3RpdmVDb3VudH0sXG4gICAgICBjb25kaXRpb25zOiB7Y29uY3VycmVuY3lfa2V5OiBjb25jdXJyZW5jeUtleX1cbiAgICB9KVxuXG4gICAgcmV0dXJuIHthY3RpdmVDb3VudCwgY29uY3VycmVuY3lLZXksIHByZXZpb3VzQWN0aXZlQ291bnR9XG4gIH1cblxuICAvKipcbiAgICogVmFsaWRhdGVzIGEgZGF0YWJhc2UgY291bnQgYmVmb3JlIGl0IHBhcnRpY2lwYXRlcyBpbiByZWNvbmNpbGlhdGlvbi5cbiAgICogQHBhcmFtIHtudW1iZXIgfCBzdHJpbmd9IHZhbHVlIC0gUmF3IGNvdW50LlxuICAgKiBAcGFyYW0ge3N0cmluZ30gY29uY3VycmVuY3lLZXkgLSBDb3VudGVyIGtleSBmb3IgZGlhZ25vc3RpY3MuXG4gICAqIEByZXR1cm5zIHtudW1iZXJ9IC0gU2FmZSBub24tbmVnYXRpdmUgY291bnQuXG4gICAqL1xuICBfdmFsaWRhdGVkQ29uY3VycmVuY3lDb3VudCh2YWx1ZSwgY29uY3VycmVuY3lLZXkpIHtcbiAgICBjb25zdCBjb3VudCA9IHRoaXMuX25vcm1hbGl6ZU51bWJlcih2YWx1ZSlcblxuICAgIGlmIChjb3VudCA9PT0gbnVsbCB8fCAhTnVtYmVyLmlzU2FmZUludGVnZXIoY291bnQpIHx8IGNvdW50IDwgMCkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKGBJbnZhbGlkIHJlY29uY2lsZWQgYmFja2dyb3VuZCBqb2IgY29uY3VycmVuY3kgY291bnQgZm9yICR7Y29uY3VycmVuY3lLZXl9OiAke2NvdW50fWApXG4gICAgfVxuXG4gICAgcmV0dXJuIGNvdW50XG4gIH1cblxuICAvKipcbiAgICogUmVjb25jaWxlcyBxdWV1ZS1kZXJpdmVkIGNvbmN1cnJlbmN5IHdpdGggdGhlIGN1cnJlbnQgY29uZmlndXJhdGlvbi4gT25seVxuICAgKiBpbnZva2VkIHRocm91Z2gge0BsaW5rIHJlY29uY2lsZVF1ZXVlQ29uY3VycmVuY3l9IOKAlCB0aGUgZXhwbGljaXQgbGlmZWN5Y2xlXG4gICAqIHBhdGggcnVuIGF0IG1haW4tcHJvY2VzcyBzdGFydHVwIHVuZGVyIGEgY3Jvc3MtcHJvY2VzcyBhZHZpc29yeSBsb2NrIOKAlFxuICAgKiBuZXZlciBmcm9tIHNjaGVtYS90ZW5hbnQgY2hlY2tzIG9yIHJvdXRpbmUgY29ubmVjdGlvbiBpbml0aWFsaXphdGlvbixcbiAgICogd2hpY2ggc3RheSByZWFkLW9ubHkgcmVnYXJkaW5nIHF1ZXVlZCBqb2Igcm93cy4gVGhlIHBlci1wcm9jZXNzIG1lbW8gaXNcbiAgICogbGF0Y2hlZCBieSB7QGxpbmsgcmVjb25jaWxlUXVldWVDb25jdXJyZW5jeX0gb25seSBhZnRlciB0aGUgZm9sbG93aW5nXG4gICAqIGNvdW50IHJlYnVpbGQgYWxzbyBzdWNjZWVkcywgc28gYSBmYWlsZWQgcmVidWlsZCByZS1lbnRlcnMgaGVyZSBvbiByZXRyeVxuICAgKiAodGhlIGFkb3B0aW9uIFVQREFURXMgYmVsb3cgYXJlIGlkZW1wb3RlbnQpLiBFbnF1ZXVlIG9ubHkgY29uc3VsdHMgY29uZmlnIGZvciBuZXcgam9icywgc28gYSBjYXAgYWRkZWQsIHJlbW92ZWQsIG9yIGNoYW5nZWRcbiAgICogd2hpbGUgYSBiYWNrbG9nIGV4aXN0cyBvdGhlcndpc2UgbGVhdmVzIHBlcnNpc3RlZCByb3dzIHN0YWxlOiBwcmUtY2FwIGpvYnNcbiAgICoga2VlcCBhIG51bGwga2V5IGFuZCBieXBhc3MgdGhlIGNhcCwgcG9zdC1yZW1vdmFsIGpvYnMgc3RheSBjYXBwZWQgdW5kZXIgYVxuICAgKiBub3ctdW5jb25maWd1cmVkIGtleSwgYW5kIGEgY2hhbmdlZCBudW1lcmljIGNhcCBzdGF5cyBzdGFsZSB1bnRpbCB0aGUgbmV4dFxuICAgKiBlbnF1ZXVlLiBCcmluZyBxdWV1ZWQgZHVyYWJsZSBzdGF0ZSBpbiBsaW5lIHdpdGggY29uZmlnOiBzeW5jIGVhY2ggY29uZmlndXJlZFxuICAgKiBxdWV1ZSdzIHN0b3JlZCBjYXAsIGFkb3B0IG5vdC15ZXQta2V5ZWQgcXVldWVkIGpvYnMgb250byB0aGVpciBxdWV1ZSBrZXksXG4gICAqIGFuZCByZWxlYXNlIHF1ZXVlZCBqb2JzIGZyb20gcXVldWUga2V5cyB3aG9zZSBxdWV1ZSBpcyBubyBsb25nZXIgY2FwcGVkLlxuICAgKiBFeGlzdGluZyBoYW5kb2ZmcyByZXRhaW4gdGhlIHBvbGljeSBhbmQgcmVzZXJ2YXRpb24gdGhleSBzdGFydGVkIHdpdGgsIHNvXG4gICAqIHJlY29uY2lsaWF0aW9uIGNhbm5vdCByYWNlIHRoZWlyIGNvbXBsZXRpb24vcmV0cnkgdHJhbnNpdGlvbnMuIFJ1bnMgYmVmb3JlXG4gICAqIHtAbGluayBfcmVjb25jaWxlQ29uY3VycmVuY3l9IHNvIGFueSBwcmUtZXhpc3RpbmcgYWN0aXZlIGNvdW50cyBhcmUgZXhhY3QuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vZGF0YWJhc2UvZHJpdmVycy9iYXNlLmpzXCIpLmRlZmF1bHR9IGRiIC0gRGF0YWJhc2UgY29ubmVjdGlvbi5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgd2hlbiByZWNvbmNpbGVkLlxuICAgKi9cbiAgYXN5bmMgX3JlY29uY2lsZVF1ZXVlQ29uY3VycmVuY3koZGIpIHtcbiAgICBpZiAodGhpcy5fcXVldWVDb25jdXJyZW5jeVJlY29uY2lsZWQpIHJldHVyblxuICAgIGlmICghKGF3YWl0IGRiLnRhYmxlRXhpc3RzKENPTkNVUlJFTkNZX1RBQkxFKSkpIHJldHVyblxuXG4gICAgY29uc3QgcXVldWVzQ29uZmlnID0gdGhpcy5jb25maWd1cmF0aW9uLmdldEJhY2tncm91bmRKb2JzQ29uZmlnKCkucXVldWVzIHx8IHt9XG4gICAgY29uc3Qgam9ic1RhYmxlID0gZGIucXVvdGVUYWJsZShKT0JTX1RBQkxFKVxuICAgIGNvbnN0IGtleUNvbHVtbiA9IGRiLnF1b3RlQ29sdW1uKFwiY29uY3VycmVuY3lfa2V5XCIpXG4gICAgY29uc3QgY2FwQ29sdW1uID0gZGIucXVvdGVDb2x1bW4oXCJtYXhfY29uY3VycmVuY3lcIilcbiAgICBjb25zdCBxdWV1ZUNvbHVtbiA9IGRiLnF1b3RlQ29sdW1uKFwicXVldWVcIilcbiAgICBjb25zdCBxdWV1ZWQgPSBgJHtkYi5xdW90ZUNvbHVtbihcInN0YXR1c1wiKX0gPSAke2RiLnF1b3RlKFwicXVldWVkXCIpfWBcbiAgICAvKiogQHR5cGUge1NldDxzdHJpbmc+fSAqL1xuICAgIGNvbnN0IGNhcHBlZFF1ZXVlcyA9IG5ldyBTZXQoKVxuXG4gICAgZm9yIChjb25zdCBxdWV1ZSBvZiBPYmplY3Qua2V5cyhxdWV1ZXNDb25maWcpKSB7XG4gICAgICBjb25zdCBjYXAgPSB0aGlzLl9xdWV1ZU1heENvbmN1cnJlbmN5KHF1ZXVlKVxuXG4gICAgICBpZiAoY2FwID09PSBudWxsKSBjb250aW51ZVxuXG4gICAgICBjYXBwZWRRdWV1ZXMuYWRkKHF1ZXVlKVxuICAgICAgY29uc3QgY29uY3VycmVuY3lLZXkgPSBgJHtRVUVVRV9DT05DVVJSRU5DWV9LRVlfUFJFRklYfSR7cXVldWV9YFxuXG4gICAgICBhd2FpdCB0aGlzLl9lbnN1cmVRdWV1ZUNvbmN1cnJlbmN5S2V5KGRiLCB7Y29uY3VycmVuY3lLZXksIG1heENvbmN1cnJlbmN5OiBjYXB9KVxuICAgICAgYXdhaXQgZGIucXVlcnkoXG4gICAgICAgIGBVUERBVEUgJHtqb2JzVGFibGV9IFNFVCAke2tleUNvbHVtbn0gPSAke2RiLnF1b3RlKGNvbmN1cnJlbmN5S2V5KX0sICR7Y2FwQ29sdW1ufSA9ICR7TnVtYmVyKGNhcCl9IGAgK1xuICAgICAgICBgV0hFUkUgJHtxdWV1ZUNvbHVtbn0gPSAke2RiLnF1b3RlKHF1ZXVlKX0gQU5EICR7a2V5Q29sdW1ufSBJUyBOVUxMIEFORCAke3F1ZXVlZH1gXG4gICAgICApXG4gICAgfVxuXG4gICAgY29uc3QgY29uY3VycmVuY3lSb3dzID0gYXdhaXQgZGJcbiAgICAgIC5uZXdRdWVyeSgpXG4gICAgICAuZnJvbShDT05DVVJSRU5DWV9UQUJMRSlcbiAgICAgIC5zZWxlY3QoXCJjb25jdXJyZW5jeV9rZXlcIilcbiAgICAgIC53aGVyZShgJHtkYi5xdW90ZUNvbHVtbihcImNvbmN1cnJlbmN5X2tleVwiKX0gTElLRSAke2RiLnF1b3RlKGAke1FVRVVFX0NPTkNVUlJFTkNZX0tFWV9QUkVGSVh9JWApfWApXG4gICAgICAucmVzdWx0cygpXG5cbiAgICBmb3IgKGNvbnN0IHJvdyBvZiBjb25jdXJyZW5jeVJvd3MpIHtcbiAgICAgIGNvbnN0IGNvbmN1cnJlbmN5S2V5ID0gU3RyaW5nKC8qKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSAqLyAocm93KS5jb25jdXJyZW5jeV9rZXkpXG5cbiAgICAgIGlmICghY29uY3VycmVuY3lLZXkuc3RhcnRzV2l0aChRVUVVRV9DT05DVVJSRU5DWV9LRVlfUFJFRklYKSkgY29udGludWVcbiAgICAgIGlmIChjYXBwZWRRdWV1ZXMuaGFzKGNvbmN1cnJlbmN5S2V5LnNsaWNlKFFVRVVFX0NPTkNVUlJFTkNZX0tFWV9QUkVGSVgubGVuZ3RoKSkpIGNvbnRpbnVlXG5cbiAgICAgIGF3YWl0IGRiLnF1ZXJ5KFxuICAgICAgICBgVVBEQVRFICR7am9ic1RhYmxlfSBTRVQgJHtrZXlDb2x1bW59ID0gTlVMTCwgJHtjYXBDb2x1bW59ID0gTlVMTCBgICtcbiAgICAgICAgYFdIRVJFICR7a2V5Q29sdW1ufSA9ICR7ZGIucXVvdGUoY29uY3VycmVuY3lLZXkpfSBBTkQgJHtxdWV1ZWR9YFxuICAgICAgKVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIG5vcm1hbGl6ZSBudW1iZXIuXG4gICAqIEBwYXJhbSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59IHZhbHVlIC0gSW5wdXQgdmFsdWUuXG4gICAqIEByZXR1cm5zIHtudW1iZXIgfCBudWxsfSAtIE5vcm1hbGl6ZWQgbnVtYmVyLlxuICAgKi9cbiAgX25vcm1hbGl6ZU51bWJlcih2YWx1ZSkge1xuICAgIGlmICh2YWx1ZSA9PT0gbnVsbCB8fCB2YWx1ZSA9PT0gdW5kZWZpbmVkIHx8IHZhbHVlID09PSBcIlwiKSByZXR1cm4gbnVsbFxuXG4gICAgY29uc3QgbnVtZXJpYyA9IE51bWJlcih2YWx1ZSlcblxuICAgIGlmIChOdW1iZXIuaXNOYU4obnVtZXJpYykpIHJldHVybiBudWxsXG5cbiAgICByZXR1cm4gbnVtZXJpY1xuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgbm9ybWFsaXplIGV4ZWN1dGlvbiBtb2RlLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vdHlwZXMuanNcIikuQmFja2dyb3VuZEpvYk9wdGlvbnN9IFtvcHRpb25zXSAtIEpvYiBvcHRpb25zLlxuICAgKiBAcmV0dXJucyB7aW1wb3J0KFwiLi90eXBlcy5qc1wiKS5CYWNrZ3JvdW5kSm9iRXhlY3V0aW9uTW9kZX0gLSBOb3JtYWxpemVkIGV4ZWN1dGlvbiBtb2RlLlxuICAgKi9cbiAgX25vcm1hbGl6ZUV4ZWN1dGlvbk1vZGUob3B0aW9ucykge1xuICAgIHJldHVybiBub3JtYWxpemVCYWNrZ3JvdW5kSm9iRXhlY3V0aW9uTW9kZShvcHRpb25zIHx8IHt9LCBERUZBVUxUX0JBQ0tHUk9VTkRfSk9CX0VYRUNVVElPTl9NT0RFKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgbm9ybWFsaXplIGV4ZWN1dGlvbiBtb2RlIG5hbWUuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBleGVjdXRpb25Nb2RlIC0gRXhlY3V0aW9uIG1vZGUgbmFtZS5cbiAgICogQHJldHVybnMge2ltcG9ydChcIi4vdHlwZXMuanNcIikuQmFja2dyb3VuZEpvYkV4ZWN1dGlvbk1vZGV9IC0gTm9ybWFsaXplZCBleGVjdXRpb24gbW9kZS5cbiAgICovXG4gIF9ub3JtYWxpemVFeGVjdXRpb25Nb2RlTmFtZShleGVjdXRpb25Nb2RlKSB7XG4gICAgcmV0dXJuIG5vcm1hbGl6ZUJhY2tncm91bmRKb2JFeGVjdXRpb25Nb2RlKFxuICAgICAge2V4ZWN1dGlvbk1vZGU6IC8qKiBAdHlwZSB7aW1wb3J0KFwiLi90eXBlcy5qc1wiKS5CYWNrZ3JvdW5kSm9iRXhlY3V0aW9uTW9kZX0gKi8gKGV4ZWN1dGlvbk1vZGUpfSxcbiAgICAgIERFRkFVTFRfQkFDS0dST1VORF9KT0JfRVhFQ1VUSU9OX01PREUsXG4gICAgICBCQUNLR1JPVU5EX0pPQl9FWEVDVVRJT05fTU9ERVNcbiAgICApXG4gIH1cblxuICAvKipcbiAgICogRmlsdGVycyBxdWV1ZWQgam9icyBieSBvbmUgb3IgbW9yZSBleGVjdXRpb24gbW9kZXMgYWdhaW5zdCB0aGVcbiAgICogYGV4ZWN1dGlvbl9tb2RlYCBjb2x1bW4gKHRoZSBzaW5nbGUgc291cmNlIG9mIHRydXRoKS5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBPcHRpb25zLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL2RhdGFiYXNlL2RyaXZlcnMvYmFzZS5qc1wiKS5kZWZhdWx0fSBhcmdzLmRiIC0gRGF0YWJhc2UgY29ubmVjdGlvbi5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL3R5cGVzLmpzXCIpLkJhY2tncm91bmRKb2JFeGVjdXRpb25Nb2RlIHwgaW1wb3J0KFwiLi90eXBlcy5qc1wiKS5CYWNrZ3JvdW5kSm9iRXhlY3V0aW9uTW9kZVtdfSBhcmdzLmV4ZWN1dGlvbk1vZGUgLSBSdW50aW1lIG1vZGVzLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL2RhdGFiYXNlL3F1ZXJ5L2luZGV4LmpzXCIpLmRlZmF1bHR9IGFyZ3MucXVlcnkgLSBRdWVyeSB0byBmaWx0ZXIuXG4gICAqIEByZXR1cm5zIHtpbXBvcnQoXCIuLi9kYXRhYmFzZS9xdWVyeS9pbmRleC5qc1wiKS5kZWZhdWx0fSAtIEZpbHRlcmVkIHF1ZXJ5LlxuICAgKi9cbiAgX3doZXJlRXhlY3V0aW9uTW9kZSh7ZGIsIGV4ZWN1dGlvbk1vZGUsIHF1ZXJ5fSkge1xuICAgIGNvbnN0IGV4ZWN1dGlvbk1vZGVzID0gQXJyYXkuaXNBcnJheShleGVjdXRpb25Nb2RlKSA/IGV4ZWN1dGlvbk1vZGUgOiBbZXhlY3V0aW9uTW9kZV1cbiAgICBjb25zdCBleGVjdXRpb25Nb2RlQ29sdW1uID0gZGIucXVvdGVDb2x1bW4oXCJleGVjdXRpb25fbW9kZVwiKVxuICAgIGNvbnN0IGNvbmRpdGlvbnMgPSBleGVjdXRpb25Nb2Rlcy5tYXAoKG1vZGUpID0+IGAke2V4ZWN1dGlvbk1vZGVDb2x1bW59ID0gJHtkYi5xdW90ZShtb2RlKX1gKVxuXG4gICAgcmV0dXJuIHF1ZXJ5LndoZXJlKGAoJHtjb25kaXRpb25zLmpvaW4oXCIgT1IgXCIpfSlgKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgcGFyc2UgYXJncy5cbiAgICogQHBhcmFtIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gdmFsdWUgLSBJbnB1dCB2YWx1ZS5cbiAgICogQHJldHVybnMge0FycmF5PFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gLSBQYXJzZWQgYXJncy5cbiAgICovXG4gIF9wYXJzZUFyZ3ModmFsdWUpIHtcbiAgICBpZiAoIXZhbHVlKSByZXR1cm4gW11cblxuICAgIHRyeSB7XG4gICAgICBjb25zdCBwYXJzZWQgPSBKU09OLnBhcnNlKFN0cmluZyh2YWx1ZSkpXG5cbiAgICAgIGlmIChBcnJheS5pc0FycmF5KHBhcnNlZCkpIHJldHVybiBwYXJzZWRcbiAgICB9IGNhdGNoIHtcbiAgICAgIC8vIElnbm9yZSBwYXJzZSBlcnJvcnMuXG4gICAgfVxuXG4gICAgcmV0dXJuIFtdXG4gIH1cblxuICAvKipcbiAgICogUnVucyB3aXRoIGRiLlxuICAgKiBAdGVtcGxhdGUgVFxuICAgKiBAcGFyYW0geyhkYjogaW1wb3J0KFwiLi4vZGF0YWJhc2UvZHJpdmVycy9iYXNlLmpzXCIpLmRlZmF1bHQpID0+IFByb21pc2U8VD59IGNhbGxiYWNrIC0gQ2FsbGJhY2suXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPFQ+fSAtIENhbGxiYWNrIHJlc3VsdC5cbiAgICovXG4gIGFzeW5jIF93aXRoRGIoY2FsbGJhY2spIHtcbiAgICBjb25zdCBkYXRhYmFzZUlkZW50aWZpZXIgPSB0aGlzLmdldERhdGFiYXNlSWRlbnRpZmllcigpXG4gICAgY29uc3QgcG9vbCA9IHRoaXMuY29uZmlndXJhdGlvbi5nZXREYXRhYmFzZVBvb2woZGF0YWJhc2VJZGVudGlmaWVyKVxuXG4gICAgaWYgKCFwb29sLnRlc3RTaGFyZWRDb25uZWN0aW9uKCkpIHtcbiAgICAgIHJldHVybiBhd2FpdCBwb29sLndpdGhDb25uZWN0aW9uKHtuYW1lOiBcIkJhY2tncm91bmQgam9icyBzdG9yZVwifSwgY2FsbGJhY2spXG4gICAgfVxuXG4gICAgcmV0dXJuIGF3YWl0IHRoaXMuY29uZmlndXJhdGlvbi5ydW5XaXRoVGVzdFNoYXJlZENvbm5lY3Rpb25Db250ZXh0cyhhc3luYyAoKSA9PiB7XG4gICAgICByZXR1cm4gYXdhaXQgdGhpcy5jb25maWd1cmF0aW9uLmVuc3VyZUNvbm5lY3Rpb25zKHtkYXRhYmFzZUlkZW50aWZpZXJzOiBbZGF0YWJhc2VJZGVudGlmaWVyXSwgbmFtZTogXCJCYWNrZ3JvdW5kIGpvYnMgc3RvcmVcIn0sIGFzeW5jIChkYnMpID0+IHtcbiAgICAgICAgY29uc3QgY29ubmVjdGlvbiA9IGRic1tkYXRhYmFzZUlkZW50aWZpZXJdXG4gICAgICAgIHJldHVybiBhd2FpdCBjb29yZGluYXRlU2hhcmVkVHJhbnNhY3Rpb25Db25uZWN0aW9uKGNvbm5lY3Rpb24sIGFzeW5jICgpID0+IGF3YWl0IGNhbGxiYWNrKGNvbm5lY3Rpb24pKVxuICAgICAgfSlcbiAgICB9KVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgYSB2YWx1ZS1yZXR1cm5pbmcgY2FsbGJhY2sgaW5zaWRlIHRoZSBkcml2ZXIncyB2b2lkLXR5cGVkIHRyYW5zYWN0aW9uIEFQSS5cbiAgICogQHRlbXBsYXRlIFRcbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9kYXRhYmFzZS9kcml2ZXJzL2Jhc2UuanNcIikuZGVmYXVsdH0gZGIgLSBEYXRhYmFzZSBjb25uZWN0aW9uLlxuICAgKiBAcGFyYW0geygpID0+IFByb21pc2U8VD59IGNhbGxiYWNrIC0gVHJhbnNhY3Rpb24gY2FsbGJhY2suXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPFQ+fSAtIENhbGxiYWNrIHJlc3VsdC5cbiAgICovXG4gIGFzeW5jIF90cmFuc2FjdGlvblJlc3VsdChkYiwgY2FsbGJhY2spIHtcbiAgICBsZXQgY29tcGxldGVkID0gZmFsc2VcbiAgICAvKiogQHR5cGUge1QgfCB1bmRlZmluZWR9ICovXG4gICAgbGV0IHJlc3VsdFxuICAgIGF3YWl0IGRiLnRyYW5zYWN0aW9uKGFzeW5jICgpID0+IHtcbiAgICAgIHJlc3VsdCA9IGF3YWl0IGNhbGxiYWNrKClcbiAgICAgIGNvbXBsZXRlZCA9IHRydWVcbiAgICB9KVxuICAgIGlmICghY29tcGxldGVkKSB0aHJvdyBuZXcgRXJyb3IoXCJCYWNrZ3JvdW5kIGpvYnMgdHJhbnNhY3Rpb24gY2FsbGJhY2sgd2FzIG5vdCBpbnZva2VkXCIpXG4gICAgcmV0dXJuIC8qKiBAdHlwZSB7VH0gKi8gKHJlc3VsdClcbiAgfVxuXG4gIC8qKlxuICAgKiBTZXJpYWxpemVzIGNvdW50LWNoYW5naW5nIHRyYW5zYWN0aW9ucyBiZWZvcmUgY2hlY2tpbmcgb3V0IHRoZWlyIGNvbm5lY3Rpb24uXG4gICAqIERhdGFiYXNlIHJvdyBsb2NraW5nIHN0aWxsIHByb3ZpZGVzIGNyb3NzLXByb2Nlc3Mgb3JkZXJpbmc7IHRoaXMgZ3VhcmRcbiAgICogcHJldmVudHMgY29uY3VycmVudCBjYWxsZXJzIG9uIFNRTGl0ZSdzIHNoYXJlZCBjb25uZWN0aW9uIGZyb20gYXR0ZW1wdGluZ1xuICAgKiBvdmVybGFwcGluZyB0b3AtbGV2ZWwgdHJhbnNhY3Rpb25zLlxuICAgKiBAdGVtcGxhdGUgVFxuICAgKiBAcGFyYW0geyhkYjogaW1wb3J0KFwiLi4vZGF0YWJhc2UvZHJpdmVycy9iYXNlLmpzXCIpLmRlZmF1bHQpID0+IFByb21pc2U8VD59IGNhbGxiYWNrIC0gVHJhbnNhY3Rpb24gY2FsbGJhY2suXG4gICAqIEBwYXJhbSB7QmFja2dyb3VuZEpvYlRyYW5zYWN0aW9uU2VyaWFsaXphdGlvbk9wdGlvbnN9IFtvcHRpb25zXSAtIFNlcmlhbGl6YXRpb24gb3B0aW9ucy5cbiAgICogQHJldHVybnMge1Byb21pc2U8VD59IENhbGxiYWNrIHJlc3VsdC5cbiAgICovXG4gIGFzeW5jIF9zZXJpYWxpemVkQ291bnRNdXRhdGlvbihjYWxsYmFjaywgb3B0aW9ucyA9IHt9KSB7XG4gICAgcmV0dXJuIGF3YWl0IHRoaXMuX3NlcmlhbGl6ZWRUcmFuc2FjdGlvbk11dGF0aW9uKGFzeW5jIChkYikgPT4ge1xuICAgICAgYXdhaXQgdGhpcy5fbG9ja0NvdW50UmV2aXNpb24oZGIpXG5cbiAgICAgIHJldHVybiBhd2FpdCBjYWxsYmFjayhkYilcbiAgICB9LCBvcHRpb25zKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgYSBzZXJpYWxpemVkIGNhbGxiYWNrIGluc2lkZSBvbmUgdHJhbnNhY3Rpb24uXG4gICAqIEB0ZW1wbGF0ZSBUXG4gICAqIEBwYXJhbSB7KGRiOiBpbXBvcnQoXCIuLi9kYXRhYmFzZS9kcml2ZXJzL2Jhc2UuanNcIikuZGVmYXVsdCkgPT4gUHJvbWlzZTxUPn0gY2FsbGJhY2sgLSBUcmFuc2FjdGlvbiBjYWxsYmFjay5cbiAgICogQHBhcmFtIHtCYWNrZ3JvdW5kSm9iVHJhbnNhY3Rpb25TZXJpYWxpemF0aW9uT3B0aW9uc30gW29wdGlvbnNdIC0gU2VyaWFsaXphdGlvbiBvcHRpb25zLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxUPn0gQ2FsbGJhY2sgcmVzdWx0LlxuICAgKi9cbiAgYXN5bmMgX3NlcmlhbGl6ZWRUcmFuc2FjdGlvbk11dGF0aW9uKGNhbGxiYWNrLCBvcHRpb25zID0ge30pIHtcbiAgICByZXR1cm4gYXdhaXQgdGhpcy5fc2VyaWFsaXplZENvbm5lY3Rpb25NdXRhdGlvbihcbiAgICAgIGFzeW5jIChkYikgPT4gYXdhaXQgdGhpcy5fdHJhbnNhY3Rpb25SZXN1bHQoZGIsIGFzeW5jICgpID0+IGF3YWl0IGNhbGxiYWNrKGRiKSksXG4gICAgICBvcHRpb25zXG4gICAgKVxuICB9XG5cbiAgLyoqXG4gICAqIEFkbWl0cyBtdXRhdGlvbiBjYWxsYmFja3MgdG8gdGhlIHByb2Nlc3MtbG9jYWwgRklGTyBiZWZvcmUgdGhleSBjaGVjayBvdXQgYVxuICAgKiBjb25uZWN0aW9uLiBDcm9zcy1wcm9jZXNzIG9yZGVyaW5nIHJlbWFpbnMgdGhlIHJlc3BvbnNpYmlsaXR5IG9mIGR1cmFibGVcbiAgICogcm93L2Fkdmlzb3J5IGxvY2tzIGFuZCB1bmlxdWUgY29uc3RyYWludHMgYWNxdWlyZWQgYXJvdW5kIHRoZSBjYWxsYmFjay5cbiAgICogQHRlbXBsYXRlIFRcbiAgICogQHBhcmFtIHsoZGI6IGltcG9ydChcIi4uL2RhdGFiYXNlL2RyaXZlcnMvYmFzZS5qc1wiKS5kZWZhdWx0KSA9PiBQcm9taXNlPFQ+fSBjYWxsYmFjayAtIENvbm5lY3Rpb24gY2FsbGJhY2suXG4gICAqIEBwYXJhbSB7QmFja2dyb3VuZEpvYlRyYW5zYWN0aW9uU2VyaWFsaXphdGlvbk9wdGlvbnN9IFtvcHRpb25zXSAtIFNlcmlhbGl6YXRpb24gb3B0aW9ucy5cbiAgICogQHJldHVybnMge1Byb21pc2U8VD59IENhbGxiYWNrIHJlc3VsdC5cbiAgICovXG4gIGFzeW5jIF9zZXJpYWxpemVkQ29ubmVjdGlvbk11dGF0aW9uKGNhbGxiYWNrLCBvcHRpb25zID0ge30pIHtcbiAgICBjb25zdCBpZGVudGlmaWVyID0gdGhpcy5nZXREYXRhYmFzZUlkZW50aWZpZXIoKSB8fCBcImRlZmF1bHRcIlxuICAgIGNvbnN0IHByZXZpb3VzID0gdHJhbnNhY3Rpb25NdXRhdGlvbkNoYWlucy5nZXQoaWRlbnRpZmllcikgfHwgUHJvbWlzZS5yZXNvbHZlKClcbiAgICBsZXQgcmVzb2x2ZVJ1biA9ICgpID0+IHt9XG4gICAgLyoqIEB0eXBlIHtQcm9taXNlPHZvaWQ+fSAqL1xuICAgIGNvbnN0IHJ1biA9IG5ldyBQcm9taXNlKChyZXNvbHZlKSA9PiB7XG4gICAgICByZXNvbHZlUnVuID0gKCkgPT4gcmVzb2x2ZSh1bmRlZmluZWQpXG4gICAgfSlcbiAgICBjb25zdCBjaGFpbiA9IHByZXZpb3VzLnRoZW4oKCkgPT4gcnVuKVxuXG4gICAgdHJhbnNhY3Rpb25NdXRhdGlvbkNoYWlucy5zZXQoaWRlbnRpZmllciwgY2hhaW4pXG4gICAgYXdhaXQgcHJldmlvdXNcblxuICAgIHRyeSB7XG4gICAgICByZXR1cm4gYXdhaXQgdGhpcy5fd2l0aERiKGFzeW5jIChkYikgPT4ge1xuICAgICAgICBjb25zdCB7YWR2aXNvcnlMb2NrfSA9IG9wdGlvbnNcblxuICAgICAgICBpZiAoYWR2aXNvcnlMb2NrKSB7XG4gICAgICAgICAgY29uc3QgYWNxdWlyZWQgPSBhd2FpdCBkYi5hY3F1aXJlQWR2aXNvcnlMb2NrKGFkdmlzb3J5TG9jay5uYW1lKVxuXG4gICAgICAgICAgaWYgKCFhY3F1aXJlZCkgdGhyb3cgbmV3IEVycm9yKGFkdmlzb3J5TG9jay5mYWlsdXJlTWVzc2FnZSlcbiAgICAgICAgfVxuXG4gICAgICAgIHRyeSB7XG4gICAgICAgICAgcmV0dXJuIGF3YWl0IGNhbGxiYWNrKGRiKVxuICAgICAgICB9IGZpbmFsbHkge1xuICAgICAgICAgIGlmIChhZHZpc29yeUxvY2spIGF3YWl0IGRiLnJlbGVhc2VBZHZpc29yeUxvY2soYWR2aXNvcnlMb2NrLm5hbWUpXG4gICAgICAgIH1cbiAgICAgIH0pXG4gICAgfSBmaW5hbGx5IHtcbiAgICAgIHJlc29sdmVSdW4oKVxuICAgICAgaWYgKHRyYW5zYWN0aW9uTXV0YXRpb25DaGFpbnMuZ2V0KGlkZW50aWZpZXIpID09PSBjaGFpbikgdHJhbnNhY3Rpb25NdXRhdGlvbkNoYWlucy5kZWxldGUoaWRlbnRpZmllcilcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogUnVucyBzaG91bGQgYWNjZXB0IHJlcG9ydC5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBPcHRpb25zLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vdHlwZXMuanNcIikuQmFja2dyb3VuZEpvYlJvd30gYXJncy5qb2IgLSBKb2Igcm93LlxuICAgKiBAcGFyYW0ge3N0cmluZyB8IG51bGwgfCB1bmRlZmluZWR9IGFyZ3MuaGFuZG9mZklkIC0gSGFuZG9mZiBsZWFzZSBpZCBmcm9tIHJlcG9ydC5cbiAgICogQHBhcmFtIHtzdHJpbmcgfCBudWxsIHwgdW5kZWZpbmVkfSBhcmdzLndvcmtlcklkIC0gV29ya2VyIGlkIGZyb20gcmVwb3J0LlxuICAgKiBAcGFyYW0ge251bWJlciB8IG51bGwgfCB1bmRlZmluZWR9IGFyZ3MuaGFuZGVkT2ZmQXRNcyAtIEhhbmRlZCBvZmYgdGltZXN0YW1wIGZyb20gcmVwb3J0LlxuICAgKiBAcmV0dXJucyB7Ym9vbGVhbn0gLSBXaGV0aGVyIHRvIGFjY2VwdCB0aGUgcmVwb3J0LlxuICAgKi9cbiAgX3Nob3VsZEFjY2VwdFJlcG9ydCh7am9iLCBoYW5kb2ZmSWQsIHdvcmtlcklkLCBoYW5kZWRPZmZBdE1zfSkge1xuICAgIGlmIChqb2Iuc3RhdHVzICE9PSBcImhhbmRlZF9vZmZcIikgcmV0dXJuIGZhbHNlXG5cbiAgICByZXR1cm4gdGhpcy5faGFuZG9mZklkUmVwb3J0TWF0Y2hlcyh7aGFuZG9mZklkLCBqb2J9KVxuICAgICAgJiYgdGhpcy5fd29ya2VyUmVwb3J0TWF0Y2hlcyh7am9iLCB3b3JrZXJJZH0pXG4gICAgICAmJiB0aGlzLl9oYW5kb2ZmUmVwb3J0TWF0Y2hlcyh7aGFuZGVkT2ZmQXRNcywgam9ifSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGFjdGl2ZSBoYW5kb2ZmIGNvbmRpdGlvbnMuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi90eXBlcy5qc1wiKS5CYWNrZ3JvdW5kSm9iUm93fSBqb2IgLSBKb2Igcm93LlxuICAgKiBAcmV0dXJucyB7UmVjb3JkPHN0cmluZywgc3RyaW5nIHwgbnVsbD59IC0gQ29uZGl0aW9uYWwgdHJhbnNpdGlvbiBmZW5jZS5cbiAgICovXG4gIF9hY3RpdmVIYW5kb2ZmQ29uZGl0aW9ucyhqb2IpIHtcbiAgICByZXR1cm4ge2hhbmRvZmZfaWQ6IGpvYi5oYW5kb2ZmSWQsIGlkOiBqb2IuaWQsIHN0YXR1czogXCJoYW5kZWRfb2ZmXCJ9XG4gIH1cblxuICAvKipcbiAgICogUnVucyBoYW5kb2ZmIGlkIHJlcG9ydCBtYXRjaGVzLlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIE9wdGlvbnMuXG4gICAqIEBwYXJhbSB7c3RyaW5nIHwgbnVsbCB8IHVuZGVmaW5lZH0gYXJncy5oYW5kb2ZmSWQgLSBIYW5kb2ZmIGxlYXNlIGlkIGZyb20gcmVwb3J0LlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vdHlwZXMuanNcIikuQmFja2dyb3VuZEpvYlJvd30gYXJncy5qb2IgLSBKb2Igcm93LlxuICAgKiBAcmV0dXJucyB7Ym9vbGVhbn0gLSBXaGV0aGVyIHRoZSBoYW5kb2ZmIGxlYXNlIG1hdGNoZXMuXG4gICAqL1xuICBfaGFuZG9mZklkUmVwb3J0TWF0Y2hlcyh7aGFuZG9mZklkLCBqb2J9KSB7XG4gICAgaWYgKCFqb2IuaGFuZG9mZklkKSByZXR1cm4gdHJ1ZVxuXG4gICAgcmV0dXJuIGhhbmRvZmZJZCA9PT0gam9iLmhhbmRvZmZJZFxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgd29ya2VyIHJlcG9ydCBtYXRjaGVzLlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIE9wdGlvbnMuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi90eXBlcy5qc1wiKS5CYWNrZ3JvdW5kSm9iUm93fSBhcmdzLmpvYiAtIEpvYiByb3cuXG4gICAqIEBwYXJhbSB7c3RyaW5nIHwgbnVsbCB8IHVuZGVmaW5lZH0gYXJncy53b3JrZXJJZCAtIFdvcmtlciBpZCBmcm9tIHJlcG9ydC5cbiAgICogQHJldHVybnMge2Jvb2xlYW59IC0gV2hldGhlciB0aGUgd29ya2VyIHJlcG9ydCBtYXRjaGVzLlxuICAgKi9cbiAgX3dvcmtlclJlcG9ydE1hdGNoZXMoe2pvYiwgd29ya2VySWR9KSB7XG4gICAgaWYgKCF3b3JrZXJJZCkgcmV0dXJuIHRydWVcbiAgICBpZiAoIWpvYi53b3JrZXJJZCkgcmV0dXJuIHRydWVcblxuICAgIHJldHVybiB3b3JrZXJJZCA9PT0gam9iLndvcmtlcklkXG4gIH1cblxuICAvKipcbiAgICogUnVucyBoYW5kb2ZmIHJlcG9ydCBtYXRjaGVzLlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIE9wdGlvbnMuXG4gICAqIEBwYXJhbSB7bnVtYmVyIHwgbnVsbCB8IHVuZGVmaW5lZH0gYXJncy5oYW5kZWRPZmZBdE1zIC0gSGFuZGVkIG9mZiB0aW1lc3RhbXAgZnJvbSByZXBvcnQuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi90eXBlcy5qc1wiKS5CYWNrZ3JvdW5kSm9iUm93fSBhcmdzLmpvYiAtIEpvYiByb3cuXG4gICAqIEByZXR1cm5zIHtib29sZWFufSAtIFdoZXRoZXIgdGhlIGhhbmRvZmYgcmVwb3J0IG1hdGNoZXMuXG4gICAqL1xuICBfaGFuZG9mZlJlcG9ydE1hdGNoZXMoe2hhbmRlZE9mZkF0TXMsIGpvYn0pIHtcbiAgICBpZiAoIWhhbmRlZE9mZkF0TXMpIHJldHVybiB0cnVlXG4gICAgaWYgKCFqb2IuaGFuZGVkT2ZmQXRNcykgcmV0dXJuIHRydWVcblxuICAgIHJldHVybiBoYW5kZWRPZmZBdE1zID09PSBqb2IuaGFuZGVkT2ZmQXRNc1xuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgbWlncmF0aW9uIGtleS5cbiAgICogQHBhcmFtIHtzdHJpbmd9IFt2ZXJzaW9uXSAtIE1pZ3JhdGlvbiB2ZXJzaW9uLlxuICAgKiBAcmV0dXJucyB7c3RyaW5nfSAtIE1pZ3JhdGlvbiBrZXkuXG4gICAqL1xuICBfbWlncmF0aW9uS2V5KHZlcnNpb24gPSBNSUdSQVRJT05fVkVSU0lPTikge1xuICAgIHJldHVybiBgJHtNSUdSQVRJT05fU0NPUEV9OiR7dmVyc2lvbn1gXG4gIH1cbn1cbiJdfQ==