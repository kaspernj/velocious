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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoic3RvcmUuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi9zcmMvYmFja2dyb3VuZC1qb2JzL3N0b3JlLmpzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiJBQUFBLFlBQVk7QUFFWixPQUFPLEVBQUMsVUFBVSxFQUFFLFVBQVUsRUFBQyxNQUFNLFFBQVEsQ0FBQTtBQUM3QyxPQUFPLHFCQUFxQixNQUFNLGNBQWMsQ0FBQTtBQUNoRCxPQUFPLE1BQU0sTUFBTSxjQUFjLENBQUE7QUFDakMsT0FBTyxTQUFTLE1BQU0saUNBQWlDLENBQUE7QUFDdkQsT0FBTyxjQUFjLE1BQU0sdUJBQXVCLENBQUE7QUFDbEQsT0FBTyxtQkFBbUIsTUFBTSxpQkFBaUIsQ0FBQTtBQUNqRCxPQUFPLDJCQUEyQixNQUFNLHNCQUFzQixDQUFBO0FBQzlELE9BQU8sRUFBRSxxQ0FBcUMsRUFBRSxNQUFNLHlEQUF5RCxDQUFBO0FBQy9HLE9BQU8sbUJBQW1CLE1BQU0seUJBQXlCLENBQUE7QUFDekQsT0FBTyxFQUNMLDhCQUE4QixFQUM5QixxQ0FBcUMsRUFDckMsNEJBQTRCLEVBQzVCLDRCQUE0QixFQUM1QixpQ0FBaUMsRUFDakMsbUNBQW1DLEVBQ25DLGdDQUFnQyxFQUNoQywyQkFBMkIsRUFDM0IsbUNBQW1DLEVBQ25DLDRCQUE0QixFQUM1QixZQUFZLEVBQ2IsTUFBTSxvQkFBb0IsQ0FBQTtBQUMzQixPQUFPLEVBQ0wsOEJBQThCLEVBQzlCLDJCQUEyQixFQUMzQix3QkFBd0IsRUFDekIsTUFBTSxpQ0FBaUMsQ0FBQTtBQUV4Qzs7Ozs7Ozs7Ozs7OztHQWFHO0FBRUg7Ozs7O0dBS0c7QUFFSDs7OztHQUlHO0FBRUg7Ozs7O0dBS0c7QUFFSDs7Ozs7R0FLRztBQUVILE1BQU0sZ0JBQWdCLEdBQUcsK0JBQStCLENBQUE7QUFDeEQsTUFBTSxlQUFlLEdBQUcsaUJBQWlCLENBQUE7QUFDekMsTUFBTSxpQkFBaUIsR0FBRyxnQkFBZ0IsQ0FBQTtBQUMxQyxNQUFNLCtC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SSxDQUFBO1FBQzFCLElBQUksQ0FBQyxHQUFHLENBQUMsUUFBUTtZQUFFLE9BQU8sSUFBSSxDQUFBO1FBRTlCLE9BQU8sUUFBUSxLQUFLLEdBQUcsQ0FBQyxRQUFRLENBQUE7SUFDbEMsQ0FBQztJQUVEOzs7Ozs7T0FNRztJQUNILHFCQUFxQixDQUFDLEVBQUMsYUFBYSxFQUFFLEdBQUcsRUFBQztRQUN4QyxJQUFJLENBQUMsYUFBYTtZQUFFLE9BQU8sSUFBSSxDQUFBO1FBQy9CLElBQUksQ0FBQyxHQUFHLENBQUMsYUFBYTtZQUFFLE9BQU8sSUFBSSxDQUFBO1FBRW5DLE9BQU8sYUFBYSxLQUFLLEdBQUcsQ0FBQyxhQUFhLENBQUE7SUFDNUMsQ0FBQztJQUVEOzs7O09BSUc7SUFDSCxhQUFhLENBQUMsT0FBTyxHQUFHLGlCQUFpQjtRQUN2QyxPQUFPLEdBQUcsZUFBZSxJQUFJLE9BQU8sRUFBRSxDQUFBO0lBQ3hDLENBQUM7Q0FDRiIsInNvdXJjZXNDb250ZW50IjpbIi8vIEB0cy1jaGVja1xuXG5pbXBvcnQge2NyZWF0ZUhhc2gsIHJhbmRvbVVVSUR9IGZyb20gXCJjcnlwdG9cIlxuaW1wb3J0IEJhY2tncm91bmRKb2JzQWRhcHRlciBmcm9tIFwiLi9hZGFwdGVyLmpzXCJcbmltcG9ydCBMb2dnZXIgZnJvbSBcIi4uL2xvZ2dlci5qc1wiXG5pbXBvcnQgVGFibGVEYXRhIGZyb20gXCIuLi9kYXRhYmFzZS90YWJsZS1kYXRhL2luZGV4LmpzXCJcbmltcG9ydCBWZWxvY2lvdXNFcnJvciBmcm9tIFwiLi4vdmVsb2Npb3VzLWVycm9yLmpzXCJcbmltcG9ydCBCYWNrZ3JvdW5kSm9iUmVjb3JkIGZyb20gXCIuL2pvYi1yZWNvcmQuanNcIlxuaW1wb3J0IG5vcm1hbGl6ZUJhY2tncm91bmRKb2JFcnJvciBmcm9tIFwiLi9ub3JtYWxpemUtZXJyb3IuanNcIlxuaW1wb3J0IHsgY29vcmRpbmF0ZVNoYXJlZFRyYW5zYWN0aW9uQ29ubmVjdGlvbiB9IGZyb20gXCIuLi90ZXN0aW5nL3NoYXJlZC10cmFuc2FjdGlvbi1jb25uZWN0aW9uLWNvb3JkaW5hdG9yLmpzXCJcbmltcG9ydCBzdGFibGVKc29uU3RyaW5naWZ5IGZyb20gXCIuLi91dGlscy9zdGFibGUtanNvbi5qc1wiXG5pbXBvcnQge1xuICBCQUNLR1JPVU5EX0pPQl9FWEVDVVRJT05fTU9ERVMsXG4gIERFRkFVTFRfQkFDS0dST1VORF9KT0JfRVhFQ1VUSU9OX01PREUsXG4gIERFRkFVTFRfQkFDS0dST1VORF9KT0JfUVVFVUUsXG4gIFFVRVVFX0NPTkNVUlJFTkNZX0tFWV9QUkVGSVgsXG4gIG5vcm1hbGl6ZUJhY2tncm91bmRKb2JDb25jdXJyZW5jeSxcbiAgbm9ybWFsaXplQmFja2dyb3VuZEpvYkV4ZWN1dGlvbk1vZGUsXG4gIG5vcm1hbGl6ZUJhY2tncm91bmRKb2JNYXhSZXRyaWVzLFxuICBub3JtYWxpemVCYWNrZ3JvdW5kSm9iUXVldWUsXG4gIG5vcm1hbGl6ZUJhY2tncm91bmRKb2JTY2hlZHVsZWRBdE1zLFxuICByZXNjaGVkdWxlZEJhY2tncm91bmRKb2JBdE1zLFxuICByZXRyeURlbGF5TXNcbn0gZnJvbSBcIi4vam9iLXNlbWFudGljcy5qc1wiXG5pbXBvcnQge1xuICBNQUlMX0RFTElWRVJZX09QRVJBVElPTlNfVEFCTEUsXG4gIG1haWxEZWxpdmVyeU9wZXJhdGlvbkZvckpvYixcbiAgbWFpbERlbGl2ZXJ5T3BlcmF0aW9uS2V5XG59IGZyb20gXCIuLi9tYWlsZXIvZGVsaXZlcnktb3BlcmF0aW9uLmpzXCJcblxuLyoqXG4gKiBQcmVwYXJlZEJhY2tncm91bmRKb2IgdHlwZS5cbiAqIEB0eXBlZGVmIHtvYmplY3R9IFByZXBhcmVkQmFja2dyb3VuZEpvYlxuICogQHByb3BlcnR5IHtzdHJpbmd9IGFyZ3NKc29uIC0gU2VyaWFsaXplZCBhcmd1bWVudHMuXG4gKiBAcHJvcGVydHkge3tjb25jdXJyZW5jeUtleTogc3RyaW5nLCBtYXhDb25jdXJyZW5jeTogbnVtYmVyLCBxdWV1ZURlcml2ZWQ6IGJvb2xlYW59IHwgbnVsbH0gY29uY3VycmVuY3kgLSBSZXNvbHZlZCBjb25jdXJyZW5jeS5cbiAqIEBwcm9wZXJ0eSB7bnVtYmVyfSBjcmVhdGVkQXRNcyAtIENyZWF0aW9uIHRpbWVzdGFtcC5cbiAqIEBwcm9wZXJ0eSB7aW1wb3J0KFwiLi90eXBlcy5qc1wiKS5CYWNrZ3JvdW5kSm9iRXhlY3V0aW9uTW9kZX0gZXhlY3V0aW9uTW9kZSAtIEV4ZWN1dGlvbiBtb2RlLlxuICogQHByb3BlcnR5IHtzdHJpbmd9IGpvYklkIC0gTmV3IGpvYiBpZC5cbiAqIEBwcm9wZXJ0eSB7c3RyaW5nfSBqb2JOYW1lIC0gSm9iIG5hbWUuXG4gKiBAcHJvcGVydHkge251bWJlcn0gbWF4UmV0cmllcyAtIFJldHJ5IGNhcC5cbiAqIEBwcm9wZXJ0eSB7c3RyaW5nfSBxdWV1ZSAtIFF1ZXVlIG5hbWUuXG4gKiBAcHJvcGVydHkge251bWJlcn0gc2NoZWR1bGVkQXRNcyAtIEVsaWdpYmlsaXR5IHRpbWVzdGFtcC5cbiAqIEBwcm9wZXJ0eSB7bnVtYmVyIHwgbnVsbH0gdGltZW91dE1zIC0gUGVyLWpvYiB0aW1lb3V0IG92ZXJyaWRlLCBvciBudWxsIHdoZW4gb21pdHRlZC5cbiAqL1xuXG4vKipcbiAqIEJhY2tncm91bmRKb2JPcnBoYW5TZWxlY3Rpb24gdHlwZS5cbiAqIEB0eXBlZGVmIHtvYmplY3R9IEJhY2tncm91bmRKb2JPcnBoYW5TZWxlY3Rpb25cbiAqIEBwcm9wZXJ0eSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSBjb25kaXRpb25zIC0gRXhhY3QgdXBkYXRlIGZlbmNlLlxuICogQHByb3BlcnR5IHtpbXBvcnQoXCIuL3R5cGVzLmpzXCIpLkJhY2tncm91bmRKb2JSb3d9IGpvYiAtIFNlbGVjdGVkIGFjdGl2ZSBoYW5kb2ZmLlxuICovXG5cbi8qKlxuICogQmFja2dyb3VuZEpvYlRyYW5zYWN0aW9uU2VyaWFsaXphdGlvbk9wdGlvbnMgdHlwZS5cbiAqIEB0eXBlZGVmIHtvYmplY3R9IEJhY2tncm91bmRKb2JUcmFuc2FjdGlvblNlcmlhbGl6YXRpb25PcHRpb25zXG4gKiBAcHJvcGVydHkge3tmYWlsdXJlTWVzc2FnZTogc3RyaW5nLCBuYW1lOiBzdHJpbmd9fSBbYWR2aXNvcnlMb2NrXSAtIFNlc3Npb24gbG9jayBoZWxkIGFyb3VuZCB0aGUgdHJhbnNhY3Rpb24uXG4gKi9cblxuLyoqXG4gKiBCYWNrZ3JvdW5kSm9iQ29uY3VycmVuY3lDb3VudFJvdyB0eXBlLlxuICogQHR5cGVkZWYge29iamVjdH0gQmFja2dyb3VuZEpvYkNvbmN1cnJlbmN5Q291bnRSb3dcbiAqIEBwcm9wZXJ0eSB7bnVtYmVyIHwgc3RyaW5nfSBhY3RpdmVfY291bnQgLSBQZXJzaXN0ZWQgb3IgYWdncmVnYXRlZCBhY3RpdmUgY291bnQuXG4gKiBAcHJvcGVydHkge3N0cmluZ30gY29uY3VycmVuY3lfa2V5IC0gRHVyYWJsZSBjYXAgaWRlbnRpdHkuXG4gKi9cblxuLyoqXG4gKiBCYWNrZ3JvdW5kSm9iUXVldWVkQ29uY3VycmVuY3kgdHlwZS5cbiAqIEB0eXBlZGVmIHtvYmplY3R9IEJhY2tncm91bmRKb2JRdWV1ZWRDb25jdXJyZW5jeVxuICogQHByb3BlcnR5IHtzdHJpbmcgfCBudWxsfSBjb25jdXJyZW5jeUtleSAtIEN1cnJlbnQgY29uY3VycmVuY3kga2V5IGZvciBxdWV1ZWQgd29yay5cbiAqIEBwcm9wZXJ0eSB7bnVtYmVyIHwgbnVsbH0gbWF4Q29uY3VycmVuY3kgLSBDdXJyZW50IGNvbmN1cnJlbmN5IGNhcCBmb3IgcXVldWVkIHdvcmsuXG4gKi9cblxuY29uc3QgTUlHUkFUSU9OU19UQUJMRSA9IFwidmVsb2Npb3VzX2ludGVybmFsX21pZ3JhdGlvbnNcIlxuY29uc3QgTUlHUkFUSU9OX1NDT1BFID0gXCJiYWNrZ3JvdW5kX2pvYnNcIlxuY29uc3QgTUlHUkFUSU9OX1ZFUlNJT04gPSBcIjIwMjUwMjE1MDAwMDAwXCJcbmNvbnN0IFNDSEVNQV9SRUNPVkVSWV9QRU5ESU5HX1ZFUlNJT04gPSBcInNjaGVtYS1yZWNvdmVyeS1wZW5kaW5nXCJcbmNvbnN0IEVYRUNVVElPTl9NT0RFX0JBQ0tGSUxMX01JR1JBVElPTl9WRVJTSU9OID0gXCIyMDI2MDYwNzEzMTAxMFwiXG4vLyBEcm9wcyB0aGUgcmVkdW5kYW50IGxlZ2FjeSBgZm9ya2VkYCBib29sZWFuIGNvbHVtbiBhbmQgcmV3cml0ZXMgcG9vbGVkIHJvd3MgdG9cbi8vIHBlcnNpc3QgYGV4ZWN1dGlvbl9tb2RlID0gXCJwb29sZWRcImAgZGlyZWN0bHkgKHJldGlyaW5nIHRoZSBwb29sZWQtYXMtZm9ya2VkXG4vLyBoYW5kb2ZmLW1hcmtlciB3b3JrYXJvdW5kKSwgbGVhdmluZyBgZXhlY3V0aW9uX21vZGVgIGFzIHRoZSBzaW5nbGUgc291cmNlIG9mXG4vLyB0cnV0aCBmb3IgYSBqb2IncyBydW50aW1lLlxuY29uc3QgRFJPUF9GT1JLRURfQ09MVU1OX01JR1JBVElPTl9WRVJTSU9OID0gXCIyMDI2MDcxOTAwMDAwMFwiXG5jb25zdCBKT0JTX0lOREVYX1JFUEFJUl9NSUdSQVRJT05fVkVSU0lPTiA9IFwiMjAyNjA5MDMxMjAwMDBcIlxuLy8gTGVnYWN5IG1hcmtlciBwcmVmaXggdXNlZCBieSByb3dzIHdyaXR0ZW4gYmVmb3JlIHRoaXMgbWlncmF0aW9uOiBwb29sZWQgam9ic1xuLy8gdXNlZCB0byBwZXJzaXN0IGFzIGBleGVjdXRpb25fbW9kZSA9IFwiZm9ya2VkXCJgIHBsdXMgYSBgdmVsb2Npb3VzLXBvb2xlZDoqYFxuLy8gaGFuZG9mZiBpZC4gUmV0YWluZWQgb25seSB0byBkZXRlY3QgYW5kIGNvbnZlcnQgdGhvc2Ugcm93cyBpbiB0aGUgbWlncmF0aW9uLlxuY29uc3QgTEVHQUNZX1BPT0xFRF9IQU5ET0ZGX0lEX1BSRUZJWCA9IFwidmVsb2Npb3VzLXBvb2xlZDpcIlxuY29uc3QgTEVHQUNZX1BPT0xFRF9RVUVVRURfSEFORE9GRl9JRCA9IGAke0xFR0FDWV9QT09MRURfSEFORE9GRl9JRF9QUkVGSVh9cXVldWVkYFxuY29uc3QgSk9CU19UQUJMRSA9IFwiYmFja2dyb3VuZF9qb2JzXCJcbmNvbnN0IEpPQlNfSU5ERVhfQ09MVU1OX05BTUVTID0gW1xuICBcImpvYl9uYW1lXCIsXG4gIFwicXVldWVcIixcbiAgXCJzdGF0dXNcIixcbiAgXCJzY2hlZHVsZWRfYXRfbXNcIixcbiAgXCJjcmVhdGVkX2F0X21zXCIsXG4gIFwic2NoZWR1bGVfa2V5XCIsXG4gIFwiaGFuZGVkX29mZl9hdF9tc1wiLFxuICBcIm9ycGhhbmVkX2F0X21zXCIsXG4gIFwiY29uY3VycmVuY3lfa2V5XCJcbl1cbmNvbnN0IElERU1QT1RFTkNZX0tFWVNfVEFCTEUgPSBcImJhY2tncm91bmRfam9iX2lkZW1wb3RlbmN5X2tleXNcIlxuY29uc3QgU0NIRURVTEVfS0VZU19UQUJMRSA9IFwiYmFja2dyb3VuZF9qb2Jfc2NoZWR1bGVfa2V5c1wiXG5jb25zdCBDT05DVVJSRU5DWV9UQUJMRSA9IFwiYmFja2dyb3VuZF9qb2JfY29uY3VycmVuY3lcIlxuY29uc3QgQ09VTlRTX1JFVklTSU9OX1RBQkxFID0gXCJiYWNrZ3JvdW5kX2pvYl9jb3VudF9yZXZpc2lvbnNcIlxuY29uc3QgQ09VTlRTX1JFVklTSU9OX0tFWSA9IFwiY291bnRzXCJcbmNvbnN0IENPTkNVUlJFTkNZX1JFQ09OQ0lMSUFUSU9OX0xPQ0sgPSBcImJhY2tncm91bmQtam9iczpxdWV1ZS1jb25jdXJyZW5jeS1yZWNvbmNpbGVcIlxuY29uc3QgQ09OQ1VSUkVOQ1lfUkVQQUlSX1NBTVBMRV9MSU1JVCA9IDEwXG5leHBvcnQgY29uc3QgQkFDS0dST1VORF9KT0JfQ09VTlRTX0NIQU5ORUwgPSBcInZlbG9jaW91cy1iYWNrZ3JvdW5kLWpvYi1jb3VudHNcIlxuZXhwb3J0IGNvbnN0IEJBQ0tHUk9VTkRfSk9CX0NPVU5UX0JVQ0tFVFMgPSBbXCJhbGxcIiwgXCJxdWV1ZWRcIiwgXCJoYW5kZWRfb2ZmXCIsIFwiY29tcGxldGVkXCIsIFwiZmFpbGVkXCIsIFwib3JwaGFuZWRcIl1cbmNvbnN0IENPVU5URURfSk9CX1NUQVRVU0VTID0gQkFDS0dST1VORF9KT0JfQ09VTlRfQlVDS0VUUy5zbGljZSgxKVxuY29uc3QgTUFYX0pPQl9USU1FT1VUX01TID0gMl8xNDdfNDgzXzY0N1xuY29uc3QgSk9CX1RJTUVPVVRfVkFMSURBVElPTl9NRVNTQUdFID0gYGJhY2tncm91bmQgam9iIHRpbWVvdXRNcyBtdXN0IGJlIGEgZmluaXRlIG5vbi1wb3NpdGl2ZSBudW1iZXIgb3IgYW4gaW50ZWdlciBiZXR3ZWVuIDEgYW5kICR7TUFYX0pPQl9USU1FT1VUX01TfWBcbmNvbnN0IE9SUEhBTkVEX0FGVEVSX01TID0gMiAqIDYwICogNjAgKiAxMDAwXG5cbi8qKlxuICogQ29sdW1ucyB0aGUgZGFzaGJvYXJkIGlzIGFsbG93ZWQgdG8gc29ydCBqb2IgbGlzdGluZ3MgYnksIG1hcHBlZCB0byB0aGVpclxuICogZGF0YWJhc2UgY29sdW1uIG5hbWVzLiBSZXN0cmljdGluZyB0byB0aGlzIHNldCBrZWVwcyB0aGUgc29ydCBwYXJhbWV0ZXJcbiAqICh3aGljaCBvcmlnaW5hdGVzIGZyb20gdW50cnVzdGVkIHF1ZXJ5IHN0cmluZ3MpIGZyb20gcmVhY2hpbmcgcmF3IFNRTC5cbiAqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBzdHJpbmc+fVxuICovXG5jb25zdCBTT1JUQUJMRV9DT0xVTU5TID0ge1xuICBhdHRlbXB0czogXCJhdHRlbXB0c1wiLFxuICBjb21wbGV0ZWRBdE1zOiBcImNvbXBsZXRlZF9hdF9tc1wiLFxuICBjcmVhdGVkQXRNczogXCJjcmVhdGVkX2F0X21zXCIsXG4gIGZhaWxlZEF0TXM6IFwiZmFpbGVkX2F0X21zXCIsXG4gIGhhbmRlZE9mZkF0TXM6IFwiaGFuZGVkX29mZl9hdF9tc1wiLFxuICBzY2hlZHVsZWRBdE1zOiBcInNjaGVkdWxlZF9hdF9tc1wiXG59XG5cbi8qKlxuICogU2VyaWFsaXplcyBjb25jdXJyZW50IGBfYXBwbHlTY2hlbWFgIHJ1bnMgd2l0aGluIFRISVMgcHJvY2Vzcywga2V5ZWQgYnkgZGF0YWJhc2VcbiAqIGlkZW50aWZpZXIsIGJlZm9yZSBjYWxsZXJzIHdpdGhvdXQgYW4gZXhpc3RpbmcgY29ubmVjdGlvbiBjaGVjayBvbmUgb3V0LiBUd29cbiAqIHN0b3JlcyB0aGF0IHNoYXJlIG9uZSBjb25uZWN0aW9uIChTaW5nbGVNdWx0aVVzZSAvIFNRTGl0ZSlcbiAqIG90aGVyd2lzZSBpbnRlcmxlYXZlIHRoZSBtdWx0aS1zdGVwIHRhYmxlIHJlYnVpbGQgYW5kIGNvcnJ1cHQgaXQgKHRoZSBqb2JzIHRhYmxlXG4gKiBpcyBsZWZ0IGFzIGl0cyBgKl92ZWxvY2lvdXNfcmVidWlsZGAgdGVtcCkuIEEgREIgYWR2aXNvcnkgbG9jayBjYW4ndCBmaXggdGhhdDogb25cbiAqIGEgc2Vzc2lvbi1zY29wZWQgLyByZS1lbnRyYW50IGRyaXZlciAoTXlTUUwgYEdFVF9MT0NLYCkgYSBzZWNvbmQgYWNxdWlyZSBvbiB0aGVcbiAqIHNhbWUgc2Vzc2lvbiBzdWNjZWVkcyBpbW1lZGlhdGVseSBzbyBib3RoIGNhbGxlcnMgcHJvY2VlZCwgYW5kIHRha2luZyBpdCBvbiBhXG4gKiBzZXBhcmF0ZSBjb25uZWN0aW9uIGJsb2NrcyBjcm9zcy1zZXNzaW9uIGZvcmV2ZXIuIEFuIGluLXByb2Nlc3MgcHJvbWlzZS1jaGFpblxuICogbXV0ZXggc2VyaWFsaXplcyBzYW1lLXByb2Nlc3MgY2FsbGVycyB3aXRoIG5laXRoZXIgaGF6YXJkLiBDcm9zcy1wcm9jZXNzIHNjaGVtYVxuICogcmFjZXMgc3RheSBjb3ZlcmVkIGJ5IHRoZSBwZXItc3RlcCBhZHZpc29yeSBsb2NrcyArIHJlY2hlY2tzIGluc2lkZSB0aGUgc3RlcHMuXG4gKiBAdHlwZSB7TWFwPHN0cmluZywgUHJvbWlzZTx2b2lkPj59XG4gKi9cbmNvbnN0IHNjaGVtYUFwcGx5Q2hhaW5zID0gbmV3IE1hcCgpXG4vKiogQHR5cGUge01hcDxzdHJpbmcsIFByb21pc2U8dm9pZD4+fSAqL1xuY29uc3QgdHJhbnNhY3Rpb25NdXRhdGlvbkNoYWlucyA9IG5ldyBNYXAoKVxuXG5leHBvcnQgZGVmYXVsdCBjbGFzcyBCYWNrZ3JvdW5kSm9ic1N0b3JlIGV4dGVuZHMgQmFja2dyb3VuZEpvYnNBZGFwdGVyIHtcbiAgLyoqXG4gICAqIFJ1bnMgY29uc3RydWN0b3IuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gT3B0aW9ucy5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9jb25maWd1cmF0aW9uLmpzXCIpLmRlZmF1bHR9IGFyZ3MuY29uZmlndXJhdGlvbiAtIENvbmZpZ3VyYXRpb24uXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBbYXJncy5kYXRhYmFzZUlkZW50aWZpZXJdIC0gRGF0YWJhc2UgaWRlbnRpZmllci5cbiAgICogQHBhcmFtIHt7bm93OiAoKSA9PiBudW1iZXJ9fSBbYXJncy5jbG9ja10gLSBJbmplY3RhYmxlIHBlcnNpc3RlbmNlIGNsb2NrLlxuICAgKiBAcGFyYW0geyhwcm9kdWNlclByb29mOiBpbXBvcnQoXCIuL3R5cGVzLmpzXCIpLkJhY2tncm91bmRKb2JQcm9kdWNlclByb29mKSA9PiB2b2lkIHwgUHJvbWlzZTx2b2lkPn0gW2FyZ3MuYWZ0ZXJPd25lZFByb2R1Y2VyVmFsaWRhdGlvbl0gLSBFeGFjdCBvd25lZC1lbnF1ZXVlIHZhbGlkYXRpb24gaG9vay5cbiAgICovXG4gIGNvbnN0cnVjdG9yKHtjb25maWd1cmF0aW9uLCBkYXRhYmFzZUlkZW50aWZpZXIsIGNsb2NrLCBhZnRlck93bmVkUHJvZHVjZXJWYWxpZGF0aW9ufSkge1xuICAgIHN1cGVyKClcbiAgICB0aGlzLmNvbmZpZ3VyYXRpb24gPSBjb25maWd1cmF0aW9uXG4gICAgdGhpcy5kYXRhYmFzZUlkZW50aWZpZXIgPSBkYXRhYmFzZUlkZW50aWZpZXJcbiAgICB0aGlzLmNsb2NrID0gY2xvY2sgfHwge25vdzogKCkgPT4gRGF0ZS5ub3coKX1cbiAgICB0aGlzLmFmdGVyT3duZWRQcm9kdWNlclZhbGlkYXRpb24gPSBhZnRlck93bmVkUHJvZHVjZXJWYWxpZGF0aW9uXG4gICAgdGhpcy5sb2dnZXIgPSBuZXcgTG9nZ2VyKHRoaXMpXG4gICAgdGhpcy5fcmVhZHlQcm9taXNlID0gbnVsbFxuICAgIHRoaXMuX3F1ZXVlQ29uY3VycmVuY3lSZWNvbmNpbGVkID0gZmFsc2VcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGdldCBkYXRhYmFzZSBpZGVudGlmaWVyLlxuICAgKiBAcmV0dXJucyB7c3RyaW5nfSAtIERhdGFiYXNlIGlkZW50aWZpZXIuXG4gICAqL1xuICBnZXREYXRhYmFzZUlkZW50aWZpZXIoKSB7XG4gICAgaWYgKHRoaXMuZGF0YWJhc2VJZGVudGlmaWVyKSByZXR1cm4gdGhpcy5kYXRhYmFzZUlkZW50aWZpZXJcblxuICAgIHJldHVybiB0aGlzLmNvbmZpZ3VyYXRpb24uZ2V0QmFja2dyb3VuZEpvYnNDb25maWcoKS5kYXRhYmFzZUlkZW50aWZpZXJcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGVuc3VyZSByZWFkeS5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgd2hlbiByZWFkeS5cbiAgICovXG4gIGFzeW5jIGVuc3VyZVJlYWR5KCkge1xuICAgIGlmICh0aGlzLl9yZWFkeVByb21pc2UpIHJldHVybiBhd2FpdCB0aGlzLl9yZWFkeVByb21pc2VcblxuICAgIHRoaXMuX3JlYWR5UHJvbWlzZSA9IChhc3luYyAoKSA9PiB7XG4gICAgICB0aGlzLmNvbmZpZ3VyYXRpb24uc2V0Q3VycmVudCgpXG4gICAgICBhd2FpdCB0aGlzLl9lbnN1cmVTY2hlbWEoKVxuICAgICAgYXdhaXQgdGhpcy5faW5pdGlhbGl6ZU1vZGVsKClcbiAgICB9KSgpXG5cbiAgICB0cnkge1xuICAgICAgYXdhaXQgdGhpcy5fcmVhZHlQcm9taXNlXG4gICAgfSBmaW5hbGx5IHtcbiAgICAgIHRoaXMuX3JlYWR5UHJvbWlzZSA9IG51bGxcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogRW5zdXJlcyB0aGUgYmFja2dyb3VuZC1qb2JzIHNjaGVtYSAodGFibGVzICsgY29sdW1ucykgZXhpc3RzIG9uIHRoZSBjb25maWd1cmVkXG4gICAqIGRhdGFiYXNlLCB3aXRob3V0IGluaXRpYWxpemluZyB0aGUgcnVudGltZSBtb2RlbC4gTGV0cyBgZGI6bWlncmF0ZWAgY3JlYXRlIHRoZVxuICAgKiBmcmFtZXdvcmsncyBvd24gc2NoZW1hIGRldGVybWluaXN0aWNhbGx5IGFsb25nc2lkZSBhcHAgbWlncmF0aW9ucyDigJQgYW5kIGNhcHR1cmVcbiAgICogaXQgaW4gdGhlIGR1bXBlZCBzdHJ1Y3R1cmUgU1FMIOKAlCBpbnN0ZWFkIG9mIGl0IG9ubHkgYXBwZWFyaW5nIG9uY2UgYSBzdG9yZSBib290cy5cbiAgICogSWRlbXBvdGVudDogcmV1c2VzIHRoZSBzYW1lIGBfZW5zdXJlU2NoZW1hYCB0aGUgcnVudGltZSBzdG9yZSB1c2VzLCB3aGljaCBza2lwc1xuICAgKiB3b3JrIGFscmVhZHkgYXBwbGllZCAodHJhY2tlZCBpbiBgdmVsb2Npb3VzX2ludGVybmFsX21pZ3JhdGlvbnNgKS5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9kYXRhYmFzZS9kcml2ZXJzL2Jhc2UuanNcIikuZGVmYXVsdH0gW2RiXSAtIFJldXNlIGFuIGFscmVhZHlcbiAgICogICBjaGVja2VkLW91dCBjb25uZWN0aW9uIChlLmcuIHRoZSBvbmUgYGRiOm1pZ3JhdGVgIGhvbGRzKSByYXRoZXIgdGhhbiBvcGVuaW5nIGFcbiAgICogICBuZXN0ZWQgY2hlY2tvdXQgdGhhdCB3b3VsZCBkZWFkbG9jayBhIHNpbmdsZS1jb25uZWN0aW9uIHBvb2wuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIHdoZW4gdGhlIHNjaGVtYSBpcyBwcmVzZW50LlxuICAgKi9cbiAgYXN5bmMgZW5zdXJlU2NoZW1hKGRiKSB7XG4gICAgLy8gV2hlbiBhIGNvbm5lY3Rpb24gaXMgaGFuZGVkIGluICh0aGUgZGI6bWlncmF0ZSBwYXRoKSwgdGhlIGNhbGxlciBhbHJlYWR5IG93bnNcbiAgICAvLyB0aGUgYWN0aXZlIGNvbmZpZ3VyYXRpb24gKyBjb25uZWN0aW9uIGNvbnRleHQ7IGNhbGxpbmcgc2V0Q3VycmVudCgpIGhlcmUgd291bGRcbiAgICAvLyBjbG9iYmVyIGl0IChlLmcuIHRoZSBicm93c2VyIHRlc3QgcnVubmVyIGp1Z2dsZXMgbXVsdGlwbGUgY29uZmlndXJhdGlvbnMpLlxuICAgIGlmICghZGIpIHRoaXMuY29uZmlndXJhdGlvbi5zZXRDdXJyZW50KClcblxuICAgIGF3YWl0IHRoaXMuX2Vuc3VyZVNjaGVtYShkYilcbiAgfVxuXG4gIC8qKlxuICAgKiBSZWNvbmNpbGVzIHF1ZXVlLWRlcml2ZWQgY29uY3VycmVuY3kgd2l0aCB0aGUgY3VycmVudCBjb25maWd1cmF0aW9uOiB0aGVcbiAgICogZXhwbGljaXQgbGlmZWN5Y2xlIHBhdGggdGhhdCBhZG9wdHMvcmVsZWFzZXMgcGVyc2lzdGVkIHF1ZXVlZCBqb2JzIG9udG9cbiAgICogcXVldWUgY29uY3VycmVuY3kga2V5cyB3aGVuIGBxdWV1ZXNbbmFtZV0ubWF4Q29uY3VycmVudGAgaXMgYWRkZWQsIHJlbW92ZWQsXG4gICAqIG9yIGNoYW5nZWQuIENhbGxlZCBieSB0aGUgYmFja2dyb3VuZC1qb2JzIG1haW4gcHJvY2VzcyBvbiBzdGFydHVwIOKAlCB0aGVcbiAgICogZGVwbG95LXRpbWUgbW9tZW50IHF1ZXVlIGNvbmZpZ3VyYXRpb24gY2hhbmdlcyB0YWtlIGVmZmVjdC4gU2NoZW1hL3RlbmFudFxuICAgKiBjaGVja3MgYW5kIHJvdXRpbmUgY29ubmVjdGlvbiBpbml0aWFsaXphdGlvbiBkZWxpYmVyYXRlbHkgbmV2ZXIgcnVuIHRoaXM6XG4gICAqIHRoZXkgc3RheSByZWFkLW9ubHkgcmVnYXJkaW5nIHF1ZXVlZCBqb2Igcm93cywgYmVjYXVzZSB0aGUgYnJvYWRcbiAgICogYWRvcHRpb24vcmVsZWFzZSBVUERBVEVzIGRlYWRsb2NrIGFnYWluc3QgYWN0aXZlIGpvYiBwcm9jZXNzZXMgdW5kZXJcbiAgICogY29uY3VycmVudCB0ZW5hbnQgaW5pdGlhbGl6YXRpb24uIFNlcmlhbGl6ZWQgYWNyb3NzIHByb2Nlc3NlcyB3aXRoIGFcbiAgICogZGF0YWJhc2UgYWR2aXNvcnkgbG9jayBzbyBjb25jdXJyZW50bHkgc3RhcnRlZCBtYWlucyBjYW5ub3QgaW50ZXJsZWF2ZSB0aGVcbiAgICogVVBEQVRFczsgdGhlIHBlci1pbnN0YW5jZSBtZW1vIG9ubHkgc2tpcHMgcmVwZWF0IHdvcmsgd2l0aGluIHRoaXMgcHJvY2Vzcy5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgd2hlbiByZWNvbmNpbGVkLlxuICAgKi9cbiAgYXN5bmMgcmVjb25jaWxlUXVldWVDb25jdXJyZW5jeSgpIHtcbiAgICBpZiAodGhpcy5fcXVldWVDb25jdXJyZW5jeVJlY29uY2lsZWQpIHJldHVyblxuXG4gICAgY29uc3QgZGF0YWJhc2VJZGVudGlmaWVyID0gdGhpcy5nZXREYXRhYmFzZUlkZW50aWZpZXIoKVxuICAgIGNvbnN0IHN0YXJ0ZWRBdE1zID0gRGF0ZS5ub3coKVxuXG4gICAgYXdhaXQgdGhpcy5sb2dnZXIuaW5mbygoKSA9PiBbXG4gICAgICBcIlN0YXJ0aW5nIGJhY2tncm91bmQgam9icyBxdWV1ZS1jb25jdXJyZW5jeSBzdGFydHVwIHJlY29uY2lsaWF0aW9uXCIsXG4gICAgICB7ZGF0YWJhc2VJZGVudGlmaWVyfVxuICAgIF0pXG4gICAgYXdhaXQgdGhpcy5lbnN1cmVSZWFkeSgpXG5cbiAgICBhd2FpdCB0aGlzLl93aXRoRGIoYXN5bmMgKGRiKSA9PiB7XG4gICAgICBjb25zdCBhY3F1aXJlZCA9IGF3YWl0IGRiLmFjcXVpcmVBZHZpc29yeUxvY2soQ09OQ1VSUkVOQ1lfUkVDT05DSUxJQVRJT05fTE9DSylcblxuICAgICAgaWYgKCFhY3F1aXJlZCkgdGhyb3cgbmV3IEVycm9yKFwiRmFpbGVkIHRvIGFjcXVpcmUgYmFja2dyb3VuZCBqb2IgcXVldWUtY29uY3VycmVuY3kgcmVjb25jaWxlIGxvY2tcIilcblxuICAgICAgdHJ5IHtcbiAgICAgICAgYXdhaXQgdGhpcy5fcmVjb25jaWxlUXVldWVDb25jdXJyZW5jeShkYilcbiAgICAgICAgYXdhaXQgdGhpcy5fcmVjb25jaWxlQ29uY3VycmVuY3koZGIpXG5cbiAgICAgICAgLy8gTGF0Y2ggdGhlIG1lbW8gb25seSBhZnRlciBCT1RIIHN0ZXBzIHN1Y2NlZWQ6IGlmIHRoZSBjb3VudCByZWJ1aWxkXG4gICAgICAgIC8vIGZhaWxzIGFmdGVyIGFkb3B0aW9uLCBhIHJldHJ5IG9uIHRoaXMgc3RvcmUgbXVzdCByZS1lbnRlciBhbmQgcmVwYWlyXG4gICAgICAgIC8vIHRoZSBjb3VudHMgKGFkb3B0aW9uIGl0c2VsZiBpcyBpZGVtcG90ZW50KS5cbiAgICAgICAgdGhpcy5fcXVldWVDb25jdXJyZW5jeVJlY29uY2lsZWQgPSB0cnVlXG4gICAgICB9IGZpbmFsbHkge1xuICAgICAgICBhd2FpdCBkYi5yZWxlYXNlQWR2aXNvcnlMb2NrKENPTkNVUlJFTkNZX1JFQ09OQ0lMSUFUSU9OX0xPQ0spXG4gICAgICB9XG4gICAgfSlcblxuICAgIGF3YWl0IHRoaXMubG9nZ2VyLmluZm8oKCkgPT4gW1xuICAgICAgXCJDb21wbGV0ZWQgYmFja2dyb3VuZCBqb2JzIHF1ZXVlLWNvbmN1cnJlbmN5IHN0YXJ0dXAgcmVjb25jaWxpYXRpb25cIixcbiAgICAgIHtkYXRhYmFzZUlkZW50aWZpZXIsIGR1cmF0aW9uTXM6IERhdGUubm93KCkgLSBzdGFydGVkQXRNc31cbiAgICBdKVxuICB9XG5cbiAgLyoqXG4gICAqIFJlcGFpcnMgZHVyYWJsZSBhY3RpdmUtY291bnQgZHJpZnQgd2hpbGUgYSBtYWluIHByb2Nlc3MgcmVtYWlucyBsaXZlLiBUaGVcbiAgICogaW5pdGlhbCBzbmFwc2hvdCBpcyByZWFkLW9ubHk7IG9ubHkgc3VzcGVjdGVkIG1pc21hdGNoZXMgdGFrZSB0aGVpclxuICAgKiBjb3VudGVyIGxvY2sgYW5kIHJlLWNvdW50IGluc2lkZSB0aGUgc2VyaWFsaXplZCB0cmFuc2FjdGlvbiBwYXRoLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxpbXBvcnQoXCIuL3R5cGVzLmpzXCIpLkJhY2tncm91bmRKb2JDb25jdXJyZW5jeVJlY29uY2lsaWF0aW9uPn0gLSBSZXBhaXIgc3VtbWFyeS5cbiAgICovXG4gIGFzeW5jIHJlY29uY2lsZUFjdGl2ZUNvbmN1cnJlbmN5KCkge1xuICAgIGNvbnN0IGRhdGFiYXNlSWRlbnRpZmllciA9IHRoaXMuZ2V0RGF0YWJhc2VJZGVudGlmaWVyKClcbiAgICBjb25zdCBzdGFydGVkQXRNcyA9IERhdGUubm93KClcblxuICAgIGF3YWl0IHRoaXMuZW5zdXJlUmVhZHkoKVxuXG4gICAgY29uc3QgcmVzdWx0ID0gYXdhaXQgdGhpcy5fc2VyaWFsaXplZENvbm5lY3Rpb25NdXRhdGlvbihcbiAgICAgIGFzeW5jIChkYikgPT4gYXdhaXQgdGhpcy5fcmVjb25jaWxlQ29uY3VycmVuY3koZGIpLFxuICAgICAge1xuICAgICAgICBhZHZpc29yeUxvY2s6IHtcbiAgICAgICAgICBmYWlsdXJlTWVzc2FnZTogXCJGYWlsZWQgdG8gYWNxdWlyZSBiYWNrZ3JvdW5kIGpvYiBhY3RpdmUtY29uY3VycmVuY3kgcmVjb25jaWxlIGxvY2tcIixcbiAgICAgICAgICBuYW1lOiBDT05DVVJSRU5DWV9SRUNPTkNJTElBVElPTl9MT0NLXG4gICAgICAgIH1cbiAgICAgIH1cbiAgICApXG5cbiAgICBpZiAocmVzdWx0LnJlcGFpcmVkQ291bnQgPiAwKSB7XG4gICAgICBhd2FpdCB0aGlzLmxvZ2dlci53YXJuKCgpID0+IFtcbiAgICAgICAgXCJSZXBhaXJlZCBiYWNrZ3JvdW5kIGpvYnMgYWN0aXZlLWNvbmN1cnJlbmN5IGNvdW50IGRyaWZ0XCIsXG4gICAgICAgIHtcbiAgICAgICAgICBkYXRhYmFzZUlkZW50aWZpZXIsXG4gICAgICAgICAgZHVyYXRpb25NczogRGF0ZS5ub3coKSAtIHN0YXJ0ZWRBdE1zLFxuICAgICAgICAgIHJlcGFpcmVkQ291bnQ6IHJlc3VsdC5yZXBhaXJlZENvdW50LFxuICAgICAgICAgIHJlcGFpcnM6IHJlc3VsdC5yZXBhaXJzLFxuICAgICAgICAgIHJlcGFpcnNUcnVuY2F0ZWRDb3VudDogcmVzdWx0LnJlcGFpcnNUcnVuY2F0ZWRDb3VudFxuICAgICAgICB9XG4gICAgICBdKVxuICAgIH1cblxuICAgIHJldHVybiByZXN1bHRcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGVucXVldWUuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gT3B0aW9ucy5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGFyZ3Muam9iTmFtZSAtIEpvYiBuYW1lLlxuICAgKiBAcGFyYW0ge0FycmF5PFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gYXJncy5hcmdzIC0gQXJndW1lbnRzLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vdHlwZXMuanNcIikuQmFja2dyb3VuZEpvYk9wdGlvbnN9IFthcmdzLm9wdGlvbnNdIC0gT3B0aW9ucy5cbiAgICogQHJldHVybnMge1Byb21pc2U8c3RyaW5nPn0gLSBKb2IgaWQuXG4gICAqL1xuICBhc3luYyBlbnF1ZXVlKHtqb2JOYW1lLCBhcmdzLCBvcHRpb25zfSkge1xuICAgIGF3YWl0IHRoaXMuZW5zdXJlUmVhZHkoKVxuXG4gICAgY29uc3QgcHJlcGFyZWRKb2IgPSB0aGlzLl9wcmVwYXJlSm9iKHtqb2JOYW1lLCBhcmdzLCBvcHRpb25zfSlcblxuICAgIGlmIChvcHRpb25zPy5pZGVtcG90ZW5jeUtleSAhPT0gdW5kZWZpbmVkKSB7XG4gICAgICByZXR1cm4gYXdhaXQgdGhpcy5fZW5xdWV1ZUlkZW1wb3RlbnRseSh7YXJnczogYXJncyB8fCBbXSwgb3B0aW9ucywgcHJlcGFyZWRKb2J9KVxuICAgIH1cblxuICAgIC8qKiBAdHlwZSB7c3RyaW5nfSAqL1xuICAgIGxldCByZXN1bHRKb2JJZCA9IHByZXBhcmVkSm9iLmpvYklkXG5cbiAgICBhd2FpdCB0aGlzLl9zZXJpYWxpemVkQ291bnRNdXRhdGlvbihhc3luYyAoZGIpID0+IHtcbiAgICAgIGlmIChvcHRpb25zPy5kZWR1cGxpY2F0ZVdoaWxlUXVldWVkKSB7XG4gICAgICAgIGNvbnN0IGR1cGxpY2F0ZUpvYklkID0gYXdhaXQgdGhpcy5fZGVkdXBsaWNhdGVkUXVldWVkSm9iSWQoZGIsIHByZXBhcmVkSm9iKVxuXG4gICAgICAgIGlmIChkdXBsaWNhdGVKb2JJZCkge1xuICAgICAgICAgIHJlc3VsdEpvYklkID0gZHVwbGljYXRlSm9iSWRcbiAgICAgICAgICByZXR1cm5cbiAgICAgICAgfVxuICAgICAgfVxuXG4gICAgICBhd2FpdCB0aGlzLl9pbnNlcnRQcmVwYXJlZEpvYihkYiwge3ByZXBhcmVkSm9iLCBzY2hlZHVsZUtleTogbnVsbH0pXG4gICAgICBhd2FpdCB0aGlzLl9yZWNvcmRDb3VudERlbHRhKGRiLCB7YWxsOiAxLCBxdWV1ZWQ6IDF9KVxuICAgIH0pXG5cbiAgICByZXR1cm4gcmVzdWx0Sm9iSWRcbiAgfVxuXG4gIC8qKlxuICAgKiBBdG9taWNhbGx5IHZhbGlkYXRlcyBhbiBleGFjdCBwcm9kdWNpbmcgaGFuZG9mZiBhbmQgZW5xdWV1ZXMgaXRzIGZvbGxvdy11cC5cbiAgICogRXZlcnkgZXhhY3QgcmVxdWVzdCBvd25zIGFuIGludGVybmFsIGR1cmFibGUgcmVwbGF5IGlkZW50aXR5LCB3aGlsZSBxdWV1ZWRcbiAgICogZGVkdXBsaWNhdGlvbiBjYW4gcG9pbnQgc2V2ZXJhbCBkaXN0aW5jdCBwcm9kdWNlciBldmVudHMgYXQgb25lIGNvdmVyaW5nIHJvdy5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBPd25lZCBlbnF1ZXVlIHJlcXVlc3QuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBhcmdzLmpvYk5hbWUgLSBKb2IgbmFtZS5cbiAgICogQHBhcmFtIHtBcnJheTxSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59IGFyZ3MuYXJncyAtIEFyZ3VtZW50cy5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL3R5cGVzLmpzXCIpLkJhY2tncm91bmRKb2JPcHRpb25zfSBbYXJncy5vcHRpb25zXSAtIE9wdGlvbnMuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBbYXJncy5wcm9kdWNlckludm9jYXRpb25JZF0gLSBTdGFibGUgaWRlbnRpdHkgZm9yIG9uZSBvd25lZCBlbnF1ZXVlIGludm9jYXRpb24uXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi90eXBlcy5qc1wiKS5CYWNrZ3JvdW5kSm9iUHJvZHVjZXJQcm9vZn0gYXJncy5wcm9kdWNlclByb29mIC0gRXhhY3QgcHJvZHVjZXIgbGVhc2UuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHN0cmluZz59IC0gRHVyYWJsZSBmb2xsb3ctdXAgaWQuXG4gICAqL1xuICBhc3luYyBlbnF1ZXVlRnJvbU93bmVkSGFuZG9mZih7am9iTmFtZSwgYXJncywgb3B0aW9ucywgcHJvZHVjZXJJbnZvY2F0aW9uSWQsIHByb2R1Y2VyUHJvb2Z9KSB7XG4gICAgYXdhaXQgdGhpcy5lbnN1cmVSZWFkeSgpXG5cbiAgICBjb25zdCBub3JtYWxpemVkUHJvZHVjZXJQcm9vZiA9IHRoaXMuX25vcm1hbGl6ZVByb2R1Y2VyUHJvb2YocHJvZHVjZXJQcm9vZilcbiAgICBjb25zdCBub3JtYWxpemVkUHJvZHVjZXJJbnZvY2F0aW9uSWQgPSB0aGlzLl9ub3JtYWxpemVQcm9kdWNlckludm9jYXRpb25JZChwcm9kdWNlckludm9jYXRpb25JZClcbiAgICBjb25zdCBwcmVwYXJlZEpvYiA9IHRoaXMuX3ByZXBhcmVKb2Ioe2pvYk5hbWUsIGFyZ3MsIG9wdGlvbnN9KVxuXG4gICAgcmV0dXJuIGF3YWl0IHRoaXMuX3NlcmlhbGl6ZWRDb3VudE11dGF0aW9uKGFzeW5jIChkYikgPT4ge1xuICAgICAgYXdhaXQgdGhpcy5fdmFsaWRhdGVPd25lZFByb2R1Y2VyUHJvb2YoZGIsIG5vcm1hbGl6ZWRQcm9kdWNlclByb29mKVxuICAgICAgaWYgKHRoaXMuYWZ0ZXJPd25lZFByb2R1Y2VyVmFsaWRhdGlvbikgYXdhaXQgdGhpcy5hZnRlck93bmVkUHJvZHVjZXJWYWxpZGF0aW9uKG5vcm1hbGl6ZWRQcm9kdWNlclByb29mKVxuXG4gICAgICBpZiAob3B0aW9ucz8uaWRlbXBvdGVuY3lLZXkgIT09IHVuZGVmaW5lZCkge1xuICAgICAgICByZXR1cm4gYXdhaXQgdGhpcy5fZW5xdWV1ZUlkZW1wb3RlbnRseUluVHJhbnNhY3Rpb24oe1xuICAgICAgICAgIGFyZ3M6IGFyZ3MgfHwgW10sXG4gICAgICAgICAgY291bnRSZXZpc2lvbkxvY2tlZDogdHJ1ZSxcbiAgICAgICAgICBkYixcbiAgICAgICAgICBvcHRpb25zLFxuICAgICAgICAgIHByZXBhcmVkSm9iXG4gICAgICAgIH0pXG4gICAgICB9XG5cbiAgICAgIHJldHVybiBhd2FpdCB0aGlzLl9lbnF1ZXVlT3duZWRSZXBsYXlJblRyYW5zYWN0aW9uKHtcbiAgICAgICAgZGIsXG4gICAgICAgIG9wdGlvbnM6IG9wdGlvbnMgfHwge30sXG4gICAgICAgIHByZXBhcmVkSm9iLFxuICAgICAgICBwcm9kdWNlckludm9jYXRpb25JZDogbm9ybWFsaXplZFByb2R1Y2VySW52b2NhdGlvbklkLFxuICAgICAgICBwcm9kdWNlclByb29mOiBub3JtYWxpemVkUHJvZHVjZXJQcm9vZlxuICAgICAgfSlcbiAgICB9KVxuICB9XG5cbiAgLyoqXG4gICAqIEZpbmRzIHRoZSBlYXJsaWVzdCBxdWV1ZWQgam9iIHRoYXQgY292ZXJzIHRoaXMgZW5xdWV1ZSdzIGlkZW50aXR5IGFuZCB0aW1lLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL2RhdGFiYXNlL2RyaXZlcnMvYmFzZS5qc1wiKS5kZWZhdWx0fSBkYiAtIFRyYW5zYWN0aW9uIGNvbm5lY3Rpb24uXG4gICAqIEBwYXJhbSB7UHJlcGFyZWRCYWNrZ3JvdW5kSm9ifSBwcmVwYXJlZEpvYiAtIE5vcm1hbGl6ZWQgam9iLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxzdHJpbmcgfCBudWxsPn0gLSBDb3ZlcmluZyBqb2IgaWQuXG4gICAqL1xuICBhc3luYyBfZGVkdXBsaWNhdGVkUXVldWVkSm9iSWQoZGIsIHByZXBhcmVkSm9iKSB7XG4gICAgLy8gRGVkdXBlIG9uIHRoZSBqb2IncyBpZGVudGl0eSAobmFtZSArIGFyZ3MgKyBxdWV1ZSksIE5PVCBpdHMgY29uY3VycmVuY3kga2V5LCBzbyBhIGpvYlxuICAgIC8vIGtlZXBzIHdoYXRldmVyIGNvbmN1cnJlbmN5IGl0IHJlc29sdmVzIHRvLiBPbmx5IGFuIGV4aXN0aW5nIGpvYiBzY2hlZHVsZWQgbm8gbGF0ZXIgdGhhblxuICAgIC8vIHRoaXMgZW5xdWV1ZSBjYW4gY292ZXIgaXQ7IGEgcmV0cnkgYmFja2VkIG9mZiBpbnRvIHRoZSBmdXR1cmUgbXVzdCBub3Qgc3VwcHJlc3MgZWFybGllclxuICAgIC8vIHdvcmsuIE9yZGVyaW5nIHJldHVybnMgdGhlIGVhcmxpZXN0IGNvdmVyaW5nIGpvYiB3aGVuIHNldmVyYWwgcXVldWVkIHJvd3MgYWxyZWFkeSBleGlzdC5cbiAgICBjb25zdCBleGlzdGluZyA9IGF3YWl0IGRiXG4gICAgICAubmV3UXVlcnkoKVxuICAgICAgLmZyb20oSk9CU19UQUJMRSlcbiAgICAgIC5zZWxlY3QoXCJpZFwiKVxuICAgICAgLndoZXJlKHtzdGF0dXM6IFwicXVldWVkXCIsIGpvYl9uYW1lOiBwcmVwYXJlZEpvYi5qb2JOYW1lLCBhcmdzX2pzb246IHByZXBhcmVkSm9iLmFyZ3NKc29uLCBxdWV1ZTogcHJlcGFyZWRKb2IucXVldWV9KVxuICAgICAgLndoZXJlKGBzY2hlZHVsZWRfYXRfbXMgPD0gJHtkYi5xdW90ZShwcmVwYXJlZEpvYi5zY2hlZHVsZWRBdE1zKX1gKVxuICAgICAgLm9yZGVyKFwic2NoZWR1bGVkX2F0X21zIEFTQ1wiKVxuICAgICAgLmxpbWl0KDEpXG4gICAgICAucmVzdWx0cygpXG4gICAgY29uc3Qgcm93ID0gZXhpc3RpbmdbMF1cblxuICAgIHJldHVybiByb3cgPyBTdHJpbmcoLyoqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59ICovIChyb3cpLmlkKSA6IG51bGxcbiAgfVxuXG4gIC8qKlxuICAgKiBQZXJzaXN0cyBvbmUgaW50ZXJuYWwgZXhhY3QtcmVwbGF5IG93bmVyIGFuZCBpdHMgcXVldWVkIGpvYiBpbiB0aGUgY2FsbGVyJ3NcbiAgICogcHJvZHVjZXItdmFsaWRhdGlvbiB0cmFuc2FjdGlvbi5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBUcmFuc2FjdGlvbiBpbnB1dC5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9kYXRhYmFzZS9kcml2ZXJzL2Jhc2UuanNcIikuZGVmYXVsdH0gYXJncy5kYiAtIFRyYW5zYWN0aW9uIGNvbm5lY3Rpb24uXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi90eXBlcy5qc1wiKS5CYWNrZ3JvdW5kSm9iT3B0aW9uc30gYXJncy5vcHRpb25zIC0gRW5xdWV1ZSBvcHRpb25zLlxuICAgKiBAcGFyYW0ge1ByZXBhcmVkQmFja2dyb3VuZEpvYn0gYXJncy5wcmVwYXJlZEpvYiAtIE5vcm1hbGl6ZWQgam9iLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gYXJncy5wcm9kdWNlckludm9jYXRpb25JZCAtIFN0YWJsZSBpZGVudGl0eSBmb3Igb25lIG93bmVkIGVucXVldWUgaW52b2NhdGlvbi5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL3R5cGVzLmpzXCIpLkJhY2tncm91bmRKb2JQcm9kdWNlclByb29mfSBhcmdzLnByb2R1Y2VyUHJvb2YgLSBFeGFjdCBwcm9kdWNlciBsZWFzZS5cbiAgICogQHJldHVybnMge1Byb21pc2U8c3RyaW5nPn0gLSBTdGFibGUgcmVwbGF5IGpvYiBpZC5cbiAgICovXG4gIGFzeW5jIF9lbnF1ZXVlT3duZWRSZXBsYXlJblRyYW5zYWN0aW9uKHtkYiwgb3B0aW9ucywgcHJlcGFyZWRKb2IsIHByb2R1Y2VySW52b2NhdGlvbklkLCBwcm9kdWNlclByb29mfSkge1xuICAgIGNvbnN0IHJlcXVlc3REaWdlc3QgPSB0aGlzLl9vd25lZEVucXVldWVSZXF1ZXN0RGlnZXN0KHtvcHRpb25zLCBwcmVwYXJlZEpvYn0pXG4gICAgY29uc3Qgc2NvcGVEaWdlc3QgPSB0aGlzLl9vd25lZEVucXVldWVTY29wZURpZ2VzdCh7cHJlcGFyZWRKb2IsIHByb2R1Y2VySW52b2NhdGlvbklkLCBwcm9kdWNlclByb29mLCByZXF1ZXN0RGlnZXN0fSlcbiAgICBjb25zdCBpZGVtcG90ZW5jeUtleSA9IGBvd25lZC1oYW5kb2ZmOiR7c2NvcGVEaWdlc3R9YFxuICAgIGNvbnN0IGV4aXN0aW5nID0gYXdhaXQgdGhpcy5faWRlbXBvdGVuY3lPd25lcnNoaXAoZGIsIHNjb3BlRGlnZXN0KVxuICAgIGNvbnN0IGJhc2VPd25lcnNoaXAgPSB7XG4gICAgICBjcmVhdGVkX2F0X21zOiBwcmVwYXJlZEpvYi5jcmVhdGVkQXRNcyxcbiAgICAgIGlkZW1wb3RlbmN5X2tleTogaWRlbXBvdGVuY3lLZXksXG4gICAgICBqb2JfbmFtZTogcHJlcGFyZWRKb2Iuam9iTmFtZSxcbiAgICAgIHF1ZXVlOiBwcmVwYXJlZEpvYi5xdWV1ZSxcbiAgICAgIHJlcXVlc3RfZGlnZXN0OiByZXF1ZXN0RGlnZXN0LFxuICAgICAgc2NvcGVfZGlnZXN0OiBzY29wZURpZ2VzdFxuICAgIH1cblxuICAgIGlmIChleGlzdGluZykge1xuICAgICAgdGhpcy5fdmFsaWRhdGVJZGVtcG90ZW5jeU93bmVyc2hpcCh7ZXhpc3RpbmcsIG93bmVyc2hpcDogey4uLmJhc2VPd25lcnNoaXAsIGpvYl9pZDogU3RyaW5nKGV4aXN0aW5nLmpvYl9pZCl9fSlcbiAgICAgIHJldHVybiBTdHJpbmcoZXhpc3Rpbmcuam9iX2lkKVxuICAgIH1cblxuICAgIGNvbnN0IGR1cGxpY2F0ZUpvYklkID0gb3B0aW9ucy5kZWR1cGxpY2F0ZVdoaWxlUXVldWVkXG4gICAgICA/IGF3YWl0IHRoaXMuX2RlZHVwbGljYXRlZFF1ZXVlZEpvYklkKGRiLCBwcmVwYXJlZEpvYilcbiAgICAgIDogbnVsbFxuICAgIGNvbnN0IG93bmVyc2hpcCA9IHsuLi5iYXNlT3duZXJzaGlwLCBqb2JfaWQ6IGR1cGxpY2F0ZUpvYklkIHx8IHByZXBhcmVkSm9iLmpvYklkfVxuICAgIGNvbnN0IGNsYWltZWQgPSBhd2FpdCB0aGlzLl9jbGFpbUlkZW1wb3RlbmN5T3duZXJzaGlwKGRiLCBvd25lcnNoaXApXG5cbiAgICBpZiAoIWNsYWltZWQuY3JlYXRlZCkge1xuICAgICAgdGhpcy5fdmFsaWRhdGVJZGVtcG90ZW5jeU93bmVyc2hpcCh7ZXhpc3Rpbmc6IGNsYWltZWQucm93LCBvd25lcnNoaXB9KVxuICAgICAgcmV0dXJuIFN0cmluZyhjbGFpbWVkLnJvdy5qb2JfaWQpXG4gICAgfVxuICAgIGlmIChkdXBsaWNhdGVKb2JJZCkgcmV0dXJuIGR1cGxpY2F0ZUpvYklkXG5cbiAgICBhd2FpdCB0aGlzLl9pbnNlcnRQcmVwYXJlZEpvYihkYiwge3ByZXBhcmVkSm9iLCBzY2hlZHVsZUtleTogbnVsbH0pXG4gICAgYXdhaXQgdGhpcy5fcmVjb3JkQ291bnREZWx0YShkYiwge2FsbDogMSwgcXVldWVkOiAxfSlcblxuICAgIHJldHVybiBwcmVwYXJlZEpvYi5qb2JJZFxuICB9XG5cbiAgLyoqXG4gICAqIEF0b21pY2FsbHkgb3ducyBvbmUgZHVyYWJsZSBpZGVtcG90ZW5jeSBzY29wZSBhbmQgY3JlYXRlcyBpdHMgam9iIGV4YWN0bHkgb25jZS5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBFbnF1ZXVlIGlucHV0LlxuICAgKiBAcGFyYW0ge0FycmF5PFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gYXJncy5hcmdzIC0gSm9iIGFyZ3VtZW50cy5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL3R5cGVzLmpzXCIpLkJhY2tncm91bmRKb2JPcHRpb25zfSBhcmdzLm9wdGlvbnMgLSBKb2Igb3B0aW9ucy5cbiAgICogQHBhcmFtIHtQcmVwYXJlZEJhY2tncm91bmRKb2J9IGFyZ3MucHJlcGFyZWRKb2IgLSBOb3JtYWxpemVkIGpvYi5cbiAgICogQHJldHVybnMge1Byb21pc2U8c3RyaW5nPn0gLSBTdGFibGUgb3JpZ2luYWwgam9iIGlkLlxuICAgKi9cbiAgYXN5bmMgX2VucXVldWVJZGVtcG90ZW50bHkoe2FyZ3MsIG9wdGlvbnMsIHByZXBhcmVkSm9ifSkge1xuICAgIC8vIFJldXNlIG9yZGluYXJ5IGVucXVldWUgdHJhbnNhY3Rpb24gYWRtaXNzaW9uIGJlY2F1c2UgdGhpcyBwYXRoIGNoYW5nZXNcbiAgICAvLyB0aGUgc2FtZSBkdXJhYmxlIGNvdW50IHJldmlzaW9uLiBUaGUgc2NvcGUgcHJpbWFyeSBrZXkgcmVtYWlucyB0aGVcbiAgICAvLyBjcm9zcy1wcm9jZXNzIGNvbnZlcmdlbmNlIG93bmVyLlxuICAgIHJldHVybiBhd2FpdCB0aGlzLl9pZGVtcG90ZW50RW5xdWV1ZVRyYW5zYWN0aW9uKGFzeW5jIChkYikgPT4ge1xuICAgICAgcmV0dXJuIGF3YWl0IHRoaXMuX2VucXVldWVJZGVtcG90ZW50bHlJblRyYW5zYWN0aW9uKHthcmdzLCBkYiwgb3B0aW9ucywgcHJlcGFyZWRKb2J9KVxuICAgIH0pXG4gIH1cblxuICAvKipcbiAgICogT3ducyBvciByZXBsYXlzIG9uZSBwdWJsaWMgaWRlbXBvdGVuY3kga2V5IGluc2lkZSB0aGUgY2FsbGVyJ3MgdHJhbnNhY3Rpb24uXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gVHJhbnNhY3Rpb24gaW5wdXQuXG4gICAqIEBwYXJhbSB7QXJyYXk8UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSBhcmdzLmFyZ3MgLSBKb2IgYXJndW1lbnRzLlxuICAgKiBAcGFyYW0ge2Jvb2xlYW59IFthcmdzLmNvdW50UmV2aXNpb25Mb2NrZWRdIC0gV2hldGhlciB0aGUgY2FsbGVyIGFscmVhZHkgb3ducyBjb3VudCBzZXJpYWxpemF0aW9uLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL2RhdGFiYXNlL2RyaXZlcnMvYmFzZS5qc1wiKS5kZWZhdWx0fSBhcmdzLmRiIC0gVHJhbnNhY3Rpb24gY29ubmVjdGlvbi5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL3R5cGVzLmpzXCIpLkJhY2tncm91bmRKb2JPcHRpb25zfSBhcmdzLm9wdGlvbnMgLSBKb2Igb3B0aW9ucy5cbiAgICogQHBhcmFtIHtQcmVwYXJlZEJhY2tncm91bmRKb2J9IGFyZ3MucHJlcGFyZWRKb2IgLSBOb3JtYWxpemVkIGpvYi5cbiAgICogQHJldHVybnMge1Byb21pc2U8c3RyaW5nPn0gLSBTdGFibGUgb3JpZ2luYWwgam9iIGlkLlxuICAgKi9cbiAgYXN5bmMgX2VucXVldWVJZGVtcG90ZW50bHlJblRyYW5zYWN0aW9uKHthcmdzLCBjb3VudFJldmlzaW9uTG9ja2VkID0gZmFsc2UsIGRiLCBvcHRpb25zLCBwcmVwYXJlZEpvYn0pIHtcbiAgICBjb25zdCBpZGVtcG90ZW5jeUtleSA9IHRoaXMuX25vcm1hbGl6ZUlkZW1wb3RlbmN5S2V5KG9wdGlvbnMuaWRlbXBvdGVuY3lLZXkpXG4gICAgY29uc3Qgc2NvcGVEaWdlc3QgPSB0aGlzLl9pZGVtcG90ZW5jeVNjb3BlRGlnZXN0KHtpZGVtcG90ZW5jeUtleSwgam9iTmFtZTogcHJlcGFyZWRKb2Iuam9iTmFtZSwgcXVldWU6IHByZXBhcmVkSm9iLnF1ZXVlfSlcbiAgICBjb25zdCByZXF1ZXN0RGlnZXN0ID0gdGhpcy5faWRlbXBvdGVuY3lSZXF1ZXN0RGlnZXN0KHthcmdzLCBvcHRpb25zLCBwcmVwYXJlZEpvYn0pXG4gICAgY29uc3Qgb3duZXJzaGlwID0ge1xuICAgICAgY3JlYXRlZF9hdF9tczogcHJlcGFyZWRKb2IuY3JlYXRlZEF0TXMsXG4gICAgICBpZGVtcG90ZW5jeV9rZXk6IGlkZW1wb3RlbmN5S2V5LFxuICAgICAgam9iX2lkOiBwcmVwYXJlZEpvYi5qb2JJZCxcbiAgICAgIGpvYl9uYW1lOiBwcmVwYXJlZEpvYi5qb2JOYW1lLFxuICAgICAgcXVldWU6IHByZXBhcmVkSm9iLnF1ZXVlLFxuICAgICAgcmVxdWVzdF9kaWdlc3Q6IHJlcXVlc3REaWdlc3QsXG4gICAgICBzY29wZV9kaWdlc3Q6IHNjb3BlRGlnZXN0XG4gICAgfVxuICAgIGNvbnN0IG1haWxPcGVyYXRpb25JbnB1dCA9IG1haWxEZWxpdmVyeU9wZXJhdGlvbkZvckpvYihwcmVwYXJlZEpvYi5qb2JOYW1lLCBhcmdzKVxuXG4gICAgaWYgKG1haWxPcGVyYXRpb25JbnB1dCAmJiBtYWlsT3BlcmF0aW9uSW5wdXQub3BlcmF0aW9uLmlkICE9PSBpZGVtcG90ZW5jeUtleSkge1xuICAgICAgdGhyb3cgVmVsb2Npb3VzRXJyb3Iuc2FmZShcIk1haWwgZGVsaXZlcnkgb3BlcmF0aW9uIGlkIG11c3QgZXF1YWwgaXRzIGJhY2tncm91bmQgam9iIGlkZW1wb3RlbmN5IGtleS5cIiwge1xuICAgICAgICBjb2RlOiBcIm1haWwtZGVsaXZlcnktaWRlbXBvdGVuY3kta2V5LW1pc21hdGNoXCJcbiAgICAgIH0pXG4gICAgfVxuXG4gICAgY29uc3QgZXhpc3RpbmcgPSBhd2FpdCB0aGlzLl9pZGVtcG90ZW5jeU93bmVyc2hpcChkYiwgc2NvcGVEaWdlc3QpXG5cbiAgICBpZiAoZXhpc3RpbmcpIHtcbiAgICAgIHRoaXMuX3ZhbGlkYXRlSWRlbXBvdGVuY3lPd25lcnNoaXAoe2V4aXN0aW5nLCBvd25lcnNoaXB9KVxuICAgICAgYXdhaXQgdGhpcy5fdmFsaWRhdGVNYWlsRGVsaXZlcnlPcGVyYXRpb24oZGIsIHtqb2JJZDogU3RyaW5nKGV4aXN0aW5nLmpvYl9pZCksIG1haWxPcGVyYXRpb25JbnB1dH0pXG4gICAgICByZXR1cm4gU3RyaW5nKGV4aXN0aW5nLmpvYl9pZClcbiAgICB9XG5cbiAgICBjb25zdCBjbGFpbWVkID0gYXdhaXQgdGhpcy5fY2xhaW1JZGVtcG90ZW5jeU93bmVyc2hpcChkYiwgb3duZXJzaGlwKVxuXG4gICAgaWYgKCFjbGFpbWVkLmNyZWF0ZWQpIHtcbiAgICAgIHRoaXMuX3ZhbGlkYXRlSWRlbXBvdGVuY3lPd25lcnNoaXAoe2V4aXN0aW5nOiBjbGFpbWVkLnJvdywgb3duZXJzaGlwfSlcbiAgICAgIGF3YWl0IHRoaXMuX3ZhbGlkYXRlTWFpbERlbGl2ZXJ5T3BlcmF0aW9uKGRiLCB7am9iSWQ6IFN0cmluZyhjbGFpbWVkLnJvdy5qb2JfaWQpLCBtYWlsT3BlcmF0aW9uSW5wdXR9KVxuICAgICAgcmV0dXJuIFN0cmluZyhjbGFpbWVkLnJvdy5qb2JfaWQpXG4gICAgfVxuXG4gICAgaWYgKCFjb3VudFJldmlzaW9uTG9ja2VkKSBhd2FpdCB0aGlzLl9sb2NrQ291bnRSZXZpc2lvbihkYilcbiAgICBhd2FpdCB0aGlzLl9pbnNlcnRQcmVwYXJlZEpvYihkYiwge3ByZXBhcmVkSm9iLCBzY2hlZHVsZUtleTogbnVsbH0pXG4gICAgYXdhaXQgdGhpcy5fcGVyc2lzdE1haWxEZWxpdmVyeU9wZXJhdGlvbihkYiwge2pvYklkOiBwcmVwYXJlZEpvYi5qb2JJZCwgbWFpbE9wZXJhdGlvbklucHV0LCBjcmVhdGVkQXRNczogcHJlcGFyZWRKb2IuY3JlYXRlZEF0TXN9KVxuICAgIGF3YWl0IHRoaXMuX3JlY29yZENvdW50RGVsdGEoZGIsIHthbGw6IDEsIHF1ZXVlZDogMX0pXG5cbiAgICByZXR1cm4gcHJlcGFyZWRKb2Iuam9iSWRcbiAgfVxuXG4gIC8qKlxuICAgKiBTZXJpYWxpemVzIG9uZSBwaHlzaWNhbCBjb25uZWN0aW9uIGxvY2FsbHkgd2l0aG91dCB0YWtpbmcgb3duZXJzaGlwIGF3YXlcbiAgICogZnJvbSB0aGUgZGF0YWJhc2UgdW5pcXVlbmVzcyBjb25zdHJhaW50IHNoYXJlZCBieSBhbGwgcHJvY2Vzc2VzLlxuICAgKiBAdGVtcGxhdGUgVFxuICAgKiBAcGFyYW0geyhkYjogaW1wb3J0KFwiLi4vZGF0YWJhc2UvZHJpdmVycy9iYXNlLmpzXCIpLmRlZmF1bHQpID0+IFByb21pc2U8VD59IGNhbGxiYWNrIC0gVHJhbnNhY3Rpb24gd29yay5cbiAgICogQHJldHVybnMge1Byb21pc2U8VD59IC0gQ2FsbGJhY2sgcmVzdWx0LlxuICAgKi9cbiAgYXN5bmMgX2lkZW1wb3RlbnRFbnF1ZXVlVHJhbnNhY3Rpb24oY2FsbGJhY2spIHtcbiAgICByZXR1cm4gYXdhaXQgdGhpcy5fc2VyaWFsaXplZFRyYW5zYWN0aW9uTXV0YXRpb24oY2FsbGJhY2spXG4gIH1cblxuICAvKipcbiAgICogSW5zZXJ0cyBhbiBvd25lcnNoaXAgcm93LCByZXNvbHZpbmcgb25seSBhIGRhdGFiYXNlIHVuaXF1ZW5lc3MgcmFjZS5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9kYXRhYmFzZS9kcml2ZXJzL2Jhc2UuanNcIikuZGVmYXVsdH0gZGIgLSBUcmFuc2FjdGlvbiBjb25uZWN0aW9uLlxuICAgKiBAcGFyYW0ge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gb3duZXJzaGlwIC0gT3duZXJzaGlwIHJvdy5cbiAgICogQHJldHVybnMge1Byb21pc2U8e2NyZWF0ZWQ6IGJvb2xlYW4sIHJvdzogUmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fT59IC0gQ2xhaW0gcmVzdWx0LlxuICAgKi9cbiAgYXN5bmMgX2NsYWltSWRlbXBvdGVuY3lPd25lcnNoaXAoZGIsIG93bmVyc2hpcCkge1xuICAgIHRyeSB7XG4gICAgICAvLyBUaGUgc2F2ZXBvaW50IGtlZXBzIFBvc3RncmVTUUwncyBvdXRlciB0cmFuc2FjdGlvbiB1c2FibGUgYWZ0ZXIgYVxuICAgICAgLy8gY29uY3VycmVudCB1bmlxdWUta2V5IGxvc3MuIFRoZSB1bmlxdWUgcHJpbWFyeSBrZXksIG5vdCBhIHByb2Nlc3NcbiAgICAgIC8vIG11dGV4LCBpcyB0aGUgY3Jvc3MtcHJvY2VzcyBjb252ZXJnZW5jZSBhdXRob3JpdHkuXG4gICAgICBhd2FpdCBkYi50cmFuc2FjdGlvbihhc3luYyAoKSA9PiB7XG4gICAgICAgIGF3YWl0IGRiLmluc2VydCh7dGFibGVOYW1lOiBJREVNUE9URU5DWV9LRVlTX1RBQkxFLCBkYXRhOiBvd25lcnNoaXB9KVxuICAgICAgfSlcblxuICAgICAgcmV0dXJuIHtjcmVhdGVkOiB0cnVlLCByb3c6IG93bmVyc2hpcH1cbiAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgY29uc3QgcmFjZWQgPSBhd2FpdCB0aGlzLl9pZGVtcG90ZW5jeU93bmVyc2hpcChkYiwgU3RyaW5nKG93bmVyc2hpcC5zY29wZV9kaWdlc3QpKVxuXG4gICAgICBpZiAoIXJhY2VkKSB0aHJvdyBlcnJvclxuICAgICAgcmV0dXJuIHtjcmVhdGVkOiBmYWxzZSwgcm93OiByYWNlZH1cbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogTG9hZHMgb25lIGR1cmFibGUgZW5xdWV1ZSBvd25lci5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9kYXRhYmFzZS9kcml2ZXJzL2Jhc2UuanNcIikuZGVmYXVsdH0gZGIgLSBEYXRhYmFzZSBjb25uZWN0aW9uLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gc2NvcGVEaWdlc3QgLSBGaXhlZC1zaXplIHNjb3BlIGRpZ2VzdC5cbiAgICogQHJldHVybnMge1Byb21pc2U8UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+IHwgbnVsbD59IC0gUm93IG9yIG51bGwuXG4gICAqL1xuICBhc3luYyBfaWRlbXBvdGVuY3lPd25lcnNoaXAoZGIsIHNjb3BlRGlnZXN0KSB7XG4gICAgY29uc3Qgcm93cyA9IGF3YWl0IGRiLm5ld1F1ZXJ5KCkuZnJvbShJREVNUE9URU5DWV9LRVlTX1RBQkxFKS53aGVyZSh7c2NvcGVfZGlnZXN0OiBzY29wZURpZ2VzdH0pLmxpbWl0KDEpLnJlc3VsdHMoKVxuXG4gICAgcmV0dXJuIHJvd3NbMF0gPyAvKiogQHR5cGUge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gKi8gKHJvd3NbMF0pIDogbnVsbFxuICB9XG5cbiAgLyoqXG4gICAqIEZhaWxzIGNsb3NlZCB3aGVuIGEgZHVyYWJsZSBrZXkgaXMgcmV1c2VkIGZvciBhIGRpZmZlcmVudCBjYW5vbmljYWwgcmVxdWVzdC5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBWYWxpZGF0aW9uIGlucHV0LlxuICAgKiBAcGFyYW0ge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gYXJncy5leGlzdGluZyAtIFN0b3JlZCBvd25lci5cbiAgICogQHBhcmFtIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59IGFyZ3Mub3duZXJzaGlwIC0gUmVxdWVzdGVkIG93bmVyLlxuICAgKiBAcmV0dXJucyB7dm9pZH1cbiAgICovXG4gIF92YWxpZGF0ZUlkZW1wb3RlbmN5T3duZXJzaGlwKHtleGlzdGluZywgb3duZXJzaGlwfSkge1xuICAgIGNvbnN0IGV4YWN0U2NvcGUgPSBTdHJpbmcoZXhpc3Rpbmcuam9iX25hbWUpID09PSBvd25lcnNoaXAuam9iX25hbWVcbiAgICAgICYmIFN0cmluZyhleGlzdGluZy5xdWV1ZSkgPT09IG93bmVyc2hpcC5xdWV1ZVxuICAgICAgJiYgU3RyaW5nKGV4aXN0aW5nLmlkZW1wb3RlbmN5X2tleSkgPT09IG93bmVyc2hpcC5pZGVtcG90ZW5jeV9rZXlcblxuICAgIGlmICghZXhhY3RTY29wZSB8fCBTdHJpbmcoZXhpc3RpbmcucmVxdWVzdF9kaWdlc3QpICE9PSBvd25lcnNoaXAucmVxdWVzdF9kaWdlc3QpIHtcbiAgICAgIHRocm93IFZlbG9jaW91c0Vycm9yLnNhZmUoXCJUaGUgYmFja2dyb3VuZCBqb2IgaWRlbXBvdGVuY3kga2V5IHdhcyBhbHJlYWR5IHVzZWQgZm9yIGEgZGlmZmVyZW50IHJlcXVlc3QuXCIsIHtcbiAgICAgICAgY29kZTogXCJiYWNrZ3JvdW5kLWpvYi1pZGVtcG90ZW5jeS1jb25mbGljdFwiXG4gICAgICB9KVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBQZXJzaXN0cyB0aGUgYnVpbHQtaW4gbWFpbCBvcGVyYXRpb24gaW4gdGhlIHNhbWUgZmlyc3QtZW5xdWV1ZSB0cmFuc2FjdGlvbi5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9kYXRhYmFzZS9kcml2ZXJzL2Jhc2UuanNcIikuZGVmYXVsdH0gZGIgLSBUcmFuc2FjdGlvbiBjb25uZWN0aW9uLlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIE9wZXJhdGlvbiBpbnB1dC5cbiAgICogQHBhcmFtIHtudW1iZXJ9IGFyZ3MuY3JlYXRlZEF0TXMgLSBDcmVhdGlvbiB0aW1lc3RhbXAuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBhcmdzLmpvYklkIC0gTmF0aXZlIGpvYiBpZC5cbiAgICogQHBhcmFtIHt7b3BlcmF0aW9uOiBpbXBvcnQoXCIuLi9tYWlsZXIvaW5kZXguanNcIikuTWFpbGVyRGVsaXZlcnlPcGVyYXRpb24sIHBheWxvYWQ6IGltcG9ydChcIi4uL21haWxlci9pbmRleC5qc1wiKS5NYWlsZXJEZWxpdmVyeVBheWxvYWR9IHwgbnVsbH0gYXJncy5tYWlsT3BlcmF0aW9uSW5wdXQgLSBNYWlsIG9wZXJhdGlvbi5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgYWZ0ZXIgcGVyc2lzdGVuY2UuXG4gICAqL1xuICBhc3luYyBfcGVyc2lzdE1haWxEZWxpdmVyeU9wZXJhdGlvbihkYiwge2NyZWF0ZWRBdE1zLCBqb2JJZCwgbWFpbE9wZXJhdGlvbklucHV0fSkge1xuICAgIGlmICghbWFpbE9wZXJhdGlvbklucHV0KSByZXR1cm5cbiAgICBjb25zdCB7b3BlcmF0aW9ufSA9IG1haWxPcGVyYXRpb25JbnB1dFxuICAgIGNvbnN0IG9wZXJhdGlvbktleSA9IG1haWxEZWxpdmVyeU9wZXJhdGlvbktleShvcGVyYXRpb24uaWQpXG4gICAgY29uc3Qgcm93ID0ge1xuICAgICAgYmFja2dyb3VuZF9qb2JfaWQ6IGpvYklkLFxuICAgICAgY3JlYXRlZF9hdF9tczogY3JlYXRlZEF0TXMsXG4gICAgICBmaXJzdF9hdHRlbXB0X3N0YXJ0ZWRfYXRfbXM6IG51bGwsXG4gICAgICBvcGVyYXRpb25faWQ6IG9wZXJhdGlvbi5pZCxcbiAgICAgIG9wZXJhdGlvbl9rZXk6IG9wZXJhdGlvbktleSxcbiAgICAgIHBheWxvYWRfZGlnZXN0OiBvcGVyYXRpb24ucGF5bG9hZERpZ2VzdCxcbiAgICAgIHByb3ZpZGVyX2tpbmQ6IG9wZXJhdGlvbi5wcm92aWRlcktpbmQsXG4gICAgICBwcm92aWRlcl9yZXRlbnRpb25fbXM6IG9wZXJhdGlvbi5wcm92aWRlclJldGVudGlvbk1zXG4gICAgfVxuXG4gICAgdHJ5IHtcbiAgICAgIGF3YWl0IGRiLnRyYW5zYWN0aW9uKGFzeW5jICgpID0+IHtcbiAgICAgICAgYXdhaXQgZGIuaW5zZXJ0KHt0YWJsZU5hbWU6IE1BSUxfREVMSVZFUllfT1BFUkFUSU9OU19UQUJMRSwgZGF0YTogcm93fSlcbiAgICAgIH0pXG4gICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgIGNvbnN0IGV4aXN0aW5nID0gYXdhaXQgdGhpcy5fbWFpbERlbGl2ZXJ5T3BlcmF0aW9uKGRiLCBvcGVyYXRpb25LZXkpXG5cbiAgICAgIGlmICghZXhpc3RpbmcpIHRocm93IGVycm9yXG4gICAgICB0aGlzLl92YWxpZGF0ZU1haWxEZWxpdmVyeU9wZXJhdGlvblJvdyh7ZXhpc3RpbmcsIHJlcXVlc3RlZDogcm93fSlcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogVmFsaWRhdGVzIHRoZSBkdXJhYmxlIG1haWwgcm93IGR1cmluZyBhbiBleGFjdCBnZW5lcmljIGVucXVldWUgcmVwbGF5LlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL2RhdGFiYXNlL2RyaXZlcnMvYmFzZS5qc1wiKS5kZWZhdWx0fSBkYiAtIERhdGFiYXNlIGNvbm5lY3Rpb24uXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gVmFsaWRhdGlvbiBpbnB1dC5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGFyZ3Muam9iSWQgLSBPd25lZCBqb2IgaWQuXG4gICAqIEBwYXJhbSB7e29wZXJhdGlvbjogaW1wb3J0KFwiLi4vbWFpbGVyL2luZGV4LmpzXCIpLk1haWxlckRlbGl2ZXJ5T3BlcmF0aW9uLCBwYXlsb2FkOiBpbXBvcnQoXCIuLi9tYWlsZXIvaW5kZXguanNcIikuTWFpbGVyRGVsaXZlcnlQYXlsb2FkfSB8IG51bGx9IGFyZ3MubWFpbE9wZXJhdGlvbklucHV0IC0gTWFpbCBvcGVyYXRpb24uXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIHdoZW4gZXhhY3QuXG4gICAqL1xuICBhc3luYyBfdmFsaWRhdGVNYWlsRGVsaXZlcnlPcGVyYXRpb24oZGIsIHtqb2JJZCwgbWFpbE9wZXJhdGlvbklucHV0fSkge1xuICAgIGlmICghbWFpbE9wZXJhdGlvbklucHV0KSByZXR1cm5cbiAgICBjb25zdCB7b3BlcmF0aW9ufSA9IG1haWxPcGVyYXRpb25JbnB1dFxuICAgIGNvbnN0IGV4aXN0aW5nID0gYXdhaXQgdGhpcy5fbWFpbERlbGl2ZXJ5T3BlcmF0aW9uKGRiLCBtYWlsRGVsaXZlcnlPcGVyYXRpb25LZXkob3BlcmF0aW9uLmlkKSlcblxuICAgIGlmICghZXhpc3RpbmcpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihcIkJhY2tncm91bmQgam9iIGlkZW1wb3RlbmN5IG93bmVyc2hpcCBpcyBtaXNzaW5nIGl0cyBkdXJhYmxlIG1haWwgZGVsaXZlcnkgb3BlcmF0aW9uXCIpXG4gICAgfVxuXG4gICAgdGhpcy5fdmFsaWRhdGVNYWlsRGVsaXZlcnlPcGVyYXRpb25Sb3coe1xuICAgICAgZXhpc3RpbmcsXG4gICAgICByZXF1ZXN0ZWQ6IHtcbiAgICAgICAgYmFja2dyb3VuZF9qb2JfaWQ6IGpvYklkLFxuICAgICAgICBvcGVyYXRpb25faWQ6IG9wZXJhdGlvbi5pZCxcbiAgICAgICAgcGF5bG9hZF9kaWdlc3Q6IG9wZXJhdGlvbi5wYXlsb2FkRGlnZXN0LFxuICAgICAgICBwcm92aWRlcl9raW5kOiBvcGVyYXRpb24ucHJvdmlkZXJLaW5kLFxuICAgICAgICBwcm92aWRlcl9yZXRlbnRpb25fbXM6IG9wZXJhdGlvbi5wcm92aWRlclJldGVudGlvbk1zXG4gICAgICB9XG4gICAgfSlcbiAgfVxuXG4gIC8qKlxuICAgKiBMb2FkcyBhIGR1cmFibGUgbWFpbCBvcGVyYXRpb24uXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vZGF0YWJhc2UvZHJpdmVycy9iYXNlLmpzXCIpLmRlZmF1bHR9IGRiIC0gRGF0YWJhc2UgY29ubmVjdGlvbi5cbiAgICogQHBhcmFtIHtzdHJpbmd9IG9wZXJhdGlvbktleSAtIEZpeGVkLXNpemUgb3BlcmF0aW9uIGtleS5cbiAgICogQHJldHVybnMge1Byb21pc2U8UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+IHwgbnVsbD59IC0gUm93IG9yIG51bGwuXG4gICAqL1xuICBhc3luYyBfbWFpbERlbGl2ZXJ5T3BlcmF0aW9uKGRiLCBvcGVyYXRpb25LZXkpIHtcbiAgICBjb25zdCByb3dzID0gYXdhaXQgZGIubmV3UXVlcnkoKS5mcm9tKE1BSUxfREVMSVZFUllfT1BFUkFUSU9OU19UQUJMRSkud2hlcmUoe29wZXJhdGlvbl9rZXk6IG9wZXJhdGlvbktleX0pLmxpbWl0KDEpLnJlc3VsdHMoKVxuXG4gICAgcmV0dXJuIHJvd3NbMF0gPyAvKiogQHR5cGUge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gKi8gKHJvd3NbMF0pIDogbnVsbFxuICB9XG5cbiAgLyoqXG4gICAqIENvbXBhcmVzIHByb3ZpZGVyLXJlbGV2YW50IGR1cmFibGUgbWFpbCBvcGVyYXRpb24gZmllbGRzLlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIFZhbGlkYXRpb24gaW5wdXQuXG4gICAqIEBwYXJhbSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSBhcmdzLmV4aXN0aW5nIC0gU3RvcmVkIHJvdy5cbiAgICogQHBhcmFtIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59IGFyZ3MucmVxdWVzdGVkIC0gUmVxdWVzdGVkIHJvdy5cbiAgICogQHJldHVybnMge3ZvaWR9XG4gICAqL1xuICBfdmFsaWRhdGVNYWlsRGVsaXZlcnlPcGVyYXRpb25Sb3coe2V4aXN0aW5nLCByZXF1ZXN0ZWR9KSB7XG4gICAgY29uc3QgbWF0Y2hlcyA9IFN0cmluZyhleGlzdGluZy5vcGVyYXRpb25faWQpID09PSByZXF1ZXN0ZWQub3BlcmF0aW9uX2lkXG4gICAgICAmJiBTdHJpbmcoZXhpc3RpbmcucGF5bG9hZF9kaWdlc3QpID09PSByZXF1ZXN0ZWQucGF5bG9hZF9kaWdlc3RcbiAgICAgICYmIFN0cmluZyhleGlzdGluZy5iYWNrZ3JvdW5kX2pvYl9pZCkgPT09IHJlcXVlc3RlZC5iYWNrZ3JvdW5kX2pvYl9pZFxuICAgICAgJiYgU3RyaW5nKGV4aXN0aW5nLnByb3ZpZGVyX2tpbmQpID09PSByZXF1ZXN0ZWQucHJvdmlkZXJfa2luZFxuICAgICAgJiYgdGhpcy5fbm9ybWFsaXplTnVtYmVyKGV4aXN0aW5nLnByb3ZpZGVyX3JldGVudGlvbl9tcykgPT09IHJlcXVlc3RlZC5wcm92aWRlcl9yZXRlbnRpb25fbXNcblxuICAgIGlmICghbWF0Y2hlcykge1xuICAgICAgdGhyb3cgVmVsb2Npb3VzRXJyb3Iuc2FmZShcIlRoZSBtYWlsIGRlbGl2ZXJ5IG9wZXJhdGlvbiB3YXMgYWxyZWFkeSB1c2VkIGZvciBhIGRpZmZlcmVudCBwYXlsb2FkIG9yIHByb3ZpZGVyLlwiLCB7XG4gICAgICAgIGNvZGU6IFwibWFpbC1kZWxpdmVyeS1pZGVtcG90ZW5jeS1jb25mbGljdFwiXG4gICAgICB9KVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBDYW5vbmljYWwgcmVxdWVzdCBkaWdlc3QgZXhjbHVkaW5nIGdlbmVyYXRlZCBpZHMgYW5kIGltbWVkaWF0ZSBlbnF1ZXVlIHRpbWUuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gRGlnZXN0IGlucHV0LlxuICAgKiBAcGFyYW0ge0FycmF5PFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gYXJncy5hcmdzIC0gSm9iIGFyZ3VtZW50cy5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL3R5cGVzLmpzXCIpLkJhY2tncm91bmRKb2JPcHRpb25zfSBhcmdzLm9wdGlvbnMgLSBKb2Igb3B0aW9ucy5cbiAgICogQHBhcmFtIHtQcmVwYXJlZEJhY2tncm91bmRKb2J9IGFyZ3MucHJlcGFyZWRKb2IgLSBOb3JtYWxpemVkIGpvYi5cbiAgICogQHJldHVybnMge3N0cmluZ30gLSBTSEEtMjU2IGRpZ2VzdC5cbiAgICovXG4gIF9pZGVtcG90ZW5jeVJlcXVlc3REaWdlc3Qoe2FyZ3MsIG9wdGlvbnMsIHByZXBhcmVkSm9ifSkge1xuICAgIGNvbnN0IHNlcmlhbGl6ZWQgPSBzdGFibGVKc29uU3RyaW5naWZ5KHtcbiAgICAgIGFyZ3MsXG4gICAgICBjb25jdXJyZW5jeTogcHJlcGFyZWRKb2IuY29uY3VycmVuY3ksXG4gICAgICBleGVjdXRpb25Nb2RlOiBwcmVwYXJlZEpvYi5leGVjdXRpb25Nb2RlLFxuICAgICAgZm9ybWF0OiBcInZlbG9jaW91cy1iYWNrZ3JvdW5kLWpvYi1pZGVtcG90ZW5jeS12MVwiLFxuICAgICAgam9iTmFtZTogcHJlcGFyZWRKb2Iuam9iTmFtZSxcbiAgICAgIG1heFJldHJpZXM6IHByZXBhcmVkSm9iLm1heFJldHJpZXMsXG4gICAgICBxdWV1ZTogcHJlcGFyZWRKb2IucXVldWUsXG4gICAgICBzY2hlZHVsZWRBdE1zOiBvcHRpb25zLnNjaGVkdWxlZEF0TXMgPT09IHVuZGVmaW5lZCA/IG51bGwgOiBwcmVwYXJlZEpvYi5zY2hlZHVsZWRBdE1zLFxuICAgICAgc2NoZWR1bGluZzogb3B0aW9ucy5zY2hlZHVsZWRBdE1zID09PSB1bmRlZmluZWQgPyBcImltbWVkaWF0ZVwiIDogXCJzY2hlZHVsZWRcIixcbiAgICAgIC4uLihwcmVwYXJlZEpvYi50aW1lb3V0TXMgPT09IG51bGwgPyB7fSA6IHt0aW1lb3V0TXM6IHByZXBhcmVkSm9iLnRpbWVvdXRNc30pXG4gICAgfSlcblxuICAgIHJldHVybiBjcmVhdGVIYXNoKFwic2hhMjU2XCIpLnVwZGF0ZShzZXJpYWxpemVkKS5kaWdlc3QoXCJoZXhcIilcbiAgfVxuXG4gIC8qKlxuICAgKiBGaXhlZC1zaXplIGdsb2JhbGx5IGluZGV4ZWQgcmVwcmVzZW50YXRpb24gb2YgdGhlIGRvY3VtZW50ZWQgc2NvcGUgdHVwbGUuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gU2NvcGUgaW5wdXQuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBhcmdzLmlkZW1wb3RlbmN5S2V5IC0gQ2FsbGVyIGtleS5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGFyZ3Muam9iTmFtZSAtIEpvYiBjbGFzcyBuYW1lLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gYXJncy5xdWV1ZSAtIFF1ZXVlIG5hbWUuXG4gICAqIEByZXR1cm5zIHtzdHJpbmd9IC0gU0hBLTI1NiBzY29wZSBkaWdlc3QuXG4gICAqL1xuICBfaWRlbXBvdGVuY3lTY29wZURpZ2VzdCh7aWRlbXBvdGVuY3lLZXksIGpvYk5hbWUsIHF1ZXVlfSkge1xuICAgIHJldHVybiBjcmVhdGVIYXNoKFwic2hhMjU2XCIpXG4gICAgICAudXBkYXRlKHN0YWJsZUpzb25TdHJpbmdpZnkoe2Zvcm1hdDogXCJ2ZWxvY2lvdXMtYmFja2dyb3VuZC1qb2ItaWRlbXBvdGVuY3ktc2NvcGUtdjFcIiwgaWRlbXBvdGVuY3lLZXksIGpvYk5hbWUsIHF1ZXVlfSkpXG4gICAgICAuZGlnZXN0KFwiaGV4XCIpXG4gIH1cblxuICAvKipcbiAgICogVmFsaWRhdGVzIG9uZSBjYWxsZXIga2V5LlxuICAgKiBAcGFyYW0ge3N0cmluZyB8IHVuZGVmaW5lZH0gaWRlbXBvdGVuY3lLZXkgLSBDYWxsZXIga2V5LlxuICAgKiBAcmV0dXJucyB7c3RyaW5nfSAtIFZhbGlkIGtleS5cbiAgICovXG4gIF9ub3JtYWxpemVJZGVtcG90ZW5jeUtleShpZGVtcG90ZW5jeUtleSkge1xuICAgIGlmICh0eXBlb2YgaWRlbXBvdGVuY3lLZXkgIT09IFwic3RyaW5nXCIgfHwgaWRlbXBvdGVuY3lLZXkubGVuZ3RoID09PSAwKSB7XG4gICAgICB0aHJvdyBWZWxvY2lvdXNFcnJvci5zYWZlKFwiQmFja2dyb3VuZCBqb2IgaWRlbXBvdGVuY3lLZXkgbXVzdCBiZSBhIG5vbi1lbXB0eSBzdHJpbmcuXCIsIHtcbiAgICAgICAgY29kZTogXCJiYWNrZ3JvdW5kLWpvYi1pZGVtcG90ZW5jeS1rZXktaW52YWxpZFwiXG4gICAgICB9KVxuICAgIH1cblxuICAgIHJldHVybiBpZGVtcG90ZW5jeUtleVxuICB9XG5cbiAgLyoqXG4gICAqIENhbm9uaWNhbCByZXF1ZXN0IGlkZW50aXR5IGZvciBhbiBpbnRlcm5hbCBvd25lZC1oYW5kb2ZmIHJlcGxheS5cbiAgICogSW1tZWRpYXRlIGVucXVldWUgd2FsbCB0aW1lIGFuZCBnZW5lcmF0ZWQgam9iIGlkcyByZW1haW4gZXhjbHVkZWQuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gRGlnZXN0IGlucHV0LlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vdHlwZXMuanNcIikuQmFja2dyb3VuZEpvYk9wdGlvbnN9IGFyZ3Mub3B0aW9ucyAtIEVucXVldWUgb3B0aW9ucy5cbiAgICogQHBhcmFtIHtQcmVwYXJlZEJhY2tncm91bmRKb2J9IGFyZ3MucHJlcGFyZWRKb2IgLSBOb3JtYWxpemVkIGpvYi5cbiAgICogQHJldHVybnMge3N0cmluZ30gLSBTSEEtMjU2IGRpZ2VzdC5cbiAgICovXG4gIF9vd25lZEVucXVldWVSZXF1ZXN0RGlnZXN0KHtvcHRpb25zLCBwcmVwYXJlZEpvYn0pIHtcbiAgICBjb25zdCBzZXJpYWxpemVkID0gc3RhYmxlSnNvblN0cmluZ2lmeSh7XG4gICAgICBhcmdzSnNvbjogcHJlcGFyZWRKb2IuYXJnc0pzb24sXG4gICAgICBjb25jdXJyZW5jeTogcHJlcGFyZWRKb2IuY29uY3VycmVuY3ksXG4gICAgICBkZWR1cGxpY2F0ZVdoaWxlUXVldWVkOiBvcHRpb25zLmRlZHVwbGljYXRlV2hpbGVRdWV1ZWQgPT09IHRydWUsXG4gICAgICBleGVjdXRpb25Nb2RlOiBwcmVwYXJlZEpvYi5leGVjdXRpb25Nb2RlLFxuICAgICAgZm9ybWF0OiBcInZlbG9jaW91cy1iYWNrZ3JvdW5kLWpvYi1vd25lZC1lbnF1ZXVlLXYxXCIsXG4gICAgICBqb2JOYW1lOiBwcmVwYXJlZEpvYi5qb2JOYW1lLFxuICAgICAgbWF4UmV0cmllczogcHJlcGFyZWRKb2IubWF4UmV0cmllcyxcbiAgICAgIHF1ZXVlOiBwcmVwYXJlZEpvYi5xdWV1ZSxcbiAgICAgIHNjaGVkdWxlZEF0TXM6IG9wdGlvbnMuc2NoZWR1bGVkQXRNcyA9PT0gdW5kZWZpbmVkID8gbnVsbCA6IHByZXBhcmVkSm9iLnNjaGVkdWxlZEF0TXMsXG4gICAgICBzY2hlZHVsaW5nOiBvcHRpb25zLnNjaGVkdWxlZEF0TXMgPT09IHVuZGVmaW5lZCA/IFwiaW1tZWRpYXRlXCIgOiBcInNjaGVkdWxlZFwiLFxuICAgICAgLi4uKHByZXBhcmVkSm9iLnRpbWVvdXRNcyA9PT0gbnVsbCA/IHt9IDoge3RpbWVvdXRNczogcHJlcGFyZWRKb2IudGltZW91dE1zfSlcbiAgICB9KVxuXG4gICAgcmV0dXJuIGNyZWF0ZUhhc2goXCJzaGEyNTZcIikudXBkYXRlKHNlcmlhbGl6ZWQpLmRpZ2VzdChcImhleFwiKVxuICB9XG5cbiAgLyoqXG4gICAqIElzb2xhdGVzIGludGVybmFsIHByb2R1Y2VyIHJlcGxheSBvd25lcnNoaXAgZnJvbSBjYWxsZXIgaWRlbXBvdGVuY3kgc2NvcGVzLlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIFNjb3BlIGlucHV0LlxuICAgKiBAcGFyYW0ge1ByZXBhcmVkQmFja2dyb3VuZEpvYn0gYXJncy5wcmVwYXJlZEpvYiAtIE5vcm1hbGl6ZWQgam9iLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gYXJncy5wcm9kdWNlckludm9jYXRpb25JZCAtIFN0YWJsZSBpZGVudGl0eSBmb3Igb25lIG93bmVkIGVucXVldWUgaW52b2NhdGlvbi5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL3R5cGVzLmpzXCIpLkJhY2tncm91bmRKb2JQcm9kdWNlclByb29mfSBhcmdzLnByb2R1Y2VyUHJvb2YgLSBFeGFjdCBwcm9kdWNlciBsZWFzZS5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGFyZ3MucmVxdWVzdERpZ2VzdCAtIENhbm9uaWNhbCByZXF1ZXN0IGRpZ2VzdC5cbiAgICogQHJldHVybnMge3N0cmluZ30gLSBTSEEtMjU2IHNjb3BlIGRpZ2VzdC5cbiAgICovXG4gIF9vd25lZEVucXVldWVTY29wZURpZ2VzdCh7cHJlcGFyZWRKb2IsIHByb2R1Y2VySW52b2NhdGlvbklkLCBwcm9kdWNlclByb29mLCByZXF1ZXN0RGlnZXN0fSkge1xuICAgIHJldHVybiBjcmVhdGVIYXNoKFwic2hhMjU2XCIpXG4gICAgICAudXBkYXRlKHN0YWJsZUpzb25TdHJpbmdpZnkoe1xuICAgICAgICBmb3JtYXQ6IFwidmVsb2Npb3VzLWJhY2tncm91bmQtam9iLW93bmVkLWVucXVldWUtc2NvcGUtdjFcIixcbiAgICAgICAgam9iTmFtZTogcHJlcGFyZWRKb2Iuam9iTmFtZSxcbiAgICAgICAgcHJvZHVjZXJJbnZvY2F0aW9uSWQsXG4gICAgICAgIHByb2R1Y2VyUHJvb2YsXG4gICAgICAgIHF1ZXVlOiBwcmVwYXJlZEpvYi5xdWV1ZSxcbiAgICAgICAgcmVxdWVzdERpZ2VzdFxuICAgICAgfSkpXG4gICAgICAuZGlnZXN0KFwiaGV4XCIpXG4gIH1cblxuICAvKipcbiAgICogVmFsaWRhdGVzIHRoZSB1bnRydXN0ZWQgaWRlbnRpdHkgb2Ygb25lIHByb2R1Y2VyLW93bmVkIGVucXVldWUgaW52b2NhdGlvbi5cbiAgICogQHBhcmFtIHtzdHJpbmcgfCB1bmRlZmluZWR9IHByb2R1Y2VySW52b2NhdGlvbklkIC0gUHJvZHVjZXIgaW52b2NhdGlvbiBpZGVudGl0eS5cbiAgICogQHJldHVybnMge3N0cmluZ30gLSBWYWxpZGF0ZWQgaWRlbnRpdHkuXG4gICAqL1xuICBfbm9ybWFsaXplUHJvZHVjZXJJbnZvY2F0aW9uSWQocHJvZHVjZXJJbnZvY2F0aW9uSWQpIHtcbiAgICBpZiAodHlwZW9mIHByb2R1Y2VySW52b2NhdGlvbklkICE9PSBcInN0cmluZ1wiIHx8IHByb2R1Y2VySW52b2NhdGlvbklkLmxlbmd0aCA9PT0gMCkge1xuICAgICAgdGhyb3cgVmVsb2Npb3VzRXJyb3Iuc2FmZShcIkJhY2tncm91bmQgam9iIHByb2R1Y2VyIGludm9jYXRpb24gaWQgaXMgaW52YWxpZC5cIiwge1xuICAgICAgICBjb2RlOiBcImJhY2tncm91bmQtam9iLXByb2R1Y2VyLWludm9jYXRpb24taWQtaW52YWxpZFwiXG4gICAgICB9KVxuICAgIH1cblxuICAgIHJldHVybiBwcm9kdWNlckludm9jYXRpb25JZFxuICB9XG5cbiAgLyoqXG4gICAqIFZhbGlkYXRlcyB0aGUgdW50cnVzdGVkIHRyYW5zcG9ydCBzaGFwZSBiZWZvcmUgdHJhbnNhY3Rpb24gYWRtaXNzaW9uLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vdHlwZXMuanNcIikuQmFja2dyb3VuZEpvYlByb2R1Y2VyUHJvb2Z9IHByb2R1Y2VyUHJvb2YgLSBQcm9kdWNlciBwcm9vZi5cbiAgICogQHJldHVybnMge2ltcG9ydChcIi4vdHlwZXMuanNcIikuQmFja2dyb3VuZEpvYlByb2R1Y2VyUHJvb2Z9IC0gTm9ybWFsaXplZCBpbW11dGFibGUgcHJvb2YuXG4gICAqL1xuICBfbm9ybWFsaXplUHJvZHVjZXJQcm9vZihwcm9kdWNlclByb29mKSB7XG4gICAgY29uc3QgZXhhY3RLZXlzID0gW1wiaGFuZGVkT2ZmQXRNc1wiLCBcImhhbmRvZmZJZFwiLCBcImpvYklkXCIsIFwid29ya2VySWRcIl1cbiAgICBjb25zdCBrZXlzID0gcHJvZHVjZXJQcm9vZiAmJiB0eXBlb2YgcHJvZHVjZXJQcm9vZiA9PT0gXCJvYmplY3RcIiA/IE9iamVjdC5rZXlzKHByb2R1Y2VyUHJvb2YpIDogW11cbiAgICBjb25zdCB2YWxpZCA9IHByb2R1Y2VyUHJvb2ZcbiAgICAgICYmIHR5cGVvZiBwcm9kdWNlclByb29mID09PSBcIm9iamVjdFwiXG4gICAgICAmJiBrZXlzLmxlbmd0aCA9PT0gZXhhY3RLZXlzLmxlbmd0aFxuICAgICAgJiYga2V5cy5ldmVyeSgoa2V5KSA9PiBleGFjdEtleXMuaW5jbHVkZXMoa2V5KSlcbiAgICAgICYmIHR5cGVvZiBwcm9kdWNlclByb29mLmpvYklkID09PSBcInN0cmluZ1wiXG4gICAgICAmJiBwcm9kdWNlclByb29mLmpvYklkLmxlbmd0aCA+IDBcbiAgICAgICYmIHR5cGVvZiBwcm9kdWNlclByb29mLmhhbmRvZmZJZCA9PT0gXCJzdHJpbmdcIlxuICAgICAgJiYgcHJvZHVjZXJQcm9vZi5oYW5kb2ZmSWQubGVuZ3RoID4gMFxuICAgICAgJiYgdHlwZW9mIHByb2R1Y2VyUHJvb2Yud29ya2VySWQgPT09IFwic3RyaW5nXCJcbiAgICAgICYmIHByb2R1Y2VyUHJvb2Yud29ya2VySWQubGVuZ3RoID4gMFxuICAgICAgJiYgTnVtYmVyLmlzU2FmZUludGVnZXIocHJvZHVjZXJQcm9vZi5oYW5kZWRPZmZBdE1zKVxuICAgICAgJiYgcHJvZHVjZXJQcm9vZi5oYW5kZWRPZmZBdE1zID49IDBcblxuICAgIGlmICghdmFsaWQpIHtcbiAgICAgIHRocm93IFZlbG9jaW91c0Vycm9yLnNhZmUoXCJCYWNrZ3JvdW5kIGpvYiBwcm9kdWNlciBwcm9vZiBpcyBpbnZhbGlkLlwiLCB7XG4gICAgICAgIGNvZGU6IFwiYmFja2dyb3VuZC1qb2ItcHJvZHVjZXItcHJvb2YtaW52YWxpZFwiXG4gICAgICB9KVxuICAgIH1cblxuICAgIHJldHVybiBPYmplY3QuZnJlZXplKHtcbiAgICAgIGhhbmRlZE9mZkF0TXM6IHByb2R1Y2VyUHJvb2YuaGFuZGVkT2ZmQXRNcyxcbiAgICAgIGhhbmRvZmZJZDogcHJvZHVjZXJQcm9vZi5oYW5kb2ZmSWQsXG4gICAgICBqb2JJZDogcHJvZHVjZXJQcm9vZi5qb2JJZCxcbiAgICAgIHdvcmtlcklkOiBwcm9kdWNlclByb29mLndvcmtlcklkXG4gICAgfSlcbiAgfVxuXG4gIC8qKlxuICAgKiBDb25maXJtcyBleGFjdCBhY3RpdmUgb3duZXJzaGlwIHdoaWxlIHRoZSBlbnF1ZXVlIHRyYW5zYWN0aW9uIGhvbGRzIHRoZVxuICAgKiBzaGFyZWQgbXV0YXRpb24gZmVuY2UgdXNlZCBieSB0ZXJtaW5hbCBwcm9kdWNlciB0cmFuc2l0aW9ucy5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9kYXRhYmFzZS9kcml2ZXJzL2Jhc2UuanNcIikuZGVmYXVsdH0gZGIgLSBUcmFuc2FjdGlvbiBjb25uZWN0aW9uLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vdHlwZXMuanNcIikuQmFja2dyb3VuZEpvYlByb2R1Y2VyUHJvb2Z9IHByb2R1Y2VyUHJvb2YgLSBFeGFjdCBwcm9kdWNlciBsZWFzZS5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgd2hpbGUgb3duZXJzaGlwIHJlbWFpbnMgZXhhY3QuXG4gICAqL1xuICBhc3luYyBfdmFsaWRhdGVPd25lZFByb2R1Y2VyUHJvb2YoZGIsIHByb2R1Y2VyUHJvb2YpIHtcbiAgICBjb25zdCBwcm9kdWNlciA9IGF3YWl0IHRoaXMuX2dldEpvYlJvd0J5SWQoZGIsIHByb2R1Y2VyUHJvb2Yuam9iSWQpXG4gICAgY29uc3Qgb3duZWQgPSBwcm9kdWNlclxuICAgICAgJiYgcHJvZHVjZXIuc3RhdHVzID09PSBcImhhbmRlZF9vZmZcIlxuICAgICAgJiYgcHJvZHVjZXIuaGFuZG9mZklkID09PSBwcm9kdWNlclByb29mLmhhbmRvZmZJZFxuICAgICAgJiYgcHJvZHVjZXIud29ya2VySWQgPT09IHByb2R1Y2VyUHJvb2Yud29ya2VySWRcbiAgICAgICYmIHByb2R1Y2VyLmhhbmRlZE9mZkF0TXMgPT09IHByb2R1Y2VyUHJvb2YuaGFuZGVkT2ZmQXRNc1xuXG4gICAgaWYgKCFvd25lZCkge1xuICAgICAgdGhyb3cgVmVsb2Npb3VzRXJyb3Iuc2FmZShcIkJhY2tncm91bmQgam9iIHByb2R1Y2VyIGhhbmRvZmYgaXMgbm8gbG9uZ2VyIG93bmVkLlwiLCB7XG4gICAgICAgIGNvZGU6IFwiYmFja2dyb3VuZC1qb2ItcHJvZHVjZXItaGFuZG9mZi1ub3Qtb3duZWRcIlxuICAgICAgfSlcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogUmVwbGFjZXMgdGhlIHF1ZXVlZCBvd25lciBvZiBhIHN0YWJsZSBzY2hlZHVsZSBrZXkgd2l0aCBhIG5ldyBvbmUtb2ZmIGpvYi5cbiAgICogQSBoYW5kZWQtb2ZmIG93bmVyIGlzIGxlZnQgcnVubmluZyBhbmQgcmVwb3J0ZWQgdHJ1dGhmdWxseS5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBPcHRpb25zLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gYXJncy5zY2hlZHVsZUtleSAtIFN0YWJsZSBsb2dpY2FsIHNjaGVkdWxlIGtleS5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGFyZ3Muam9iTmFtZSAtIEpvYiBuYW1lLlxuICAgKiBAcGFyYW0ge0FycmF5PFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gYXJncy5hcmdzIC0gQXJndW1lbnRzLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vdHlwZXMuanNcIikuQmFja2dyb3VuZEpvYk9wdGlvbnN9IFthcmdzLm9wdGlvbnNdIC0gT3B0aW9ucy5cbiAgICogQHJldHVybnMge1Byb21pc2U8aW1wb3J0KFwiLi90eXBlcy5qc1wiKS5CYWNrZ3JvdW5kSm9iUmVwbGFjZW1lbnRSZXN1bHQ+fSAtIFJlcGxhY2VtZW50IHJlc3VsdC5cbiAgICovXG4gIGFzeW5jIHJlcGxhY2VTY2hlZHVsZWQoe3NjaGVkdWxlS2V5LCBqb2JOYW1lLCBhcmdzLCBvcHRpb25zfSkge1xuICAgIGF3YWl0IHRoaXMuZW5zdXJlUmVhZHkoKVxuXG4gICAgY29uc3Qgbm9ybWFsaXplZFNjaGVkdWxlS2V5ID0gdGhpcy5fbm9ybWFsaXplU2NoZWR1bGVLZXkoc2NoZWR1bGVLZXkpXG4gICAgY29uc3QgcHJlcGFyZWRKb2IgPSB0aGlzLl9wcmVwYXJlSm9iKHtqb2JOYW1lLCBhcmdzLCBvcHRpb25zfSlcblxuICAgIHJldHVybiBhd2FpdCB0aGlzLl9zZXJpYWxpemVkQ291bnRNdXRhdGlvbihhc3luYyAoZGIpID0+IHtcbiAgICAgIGNvbnN0IG93bmVyUm93cyA9IGF3YWl0IGRiXG4gICAgICAgIC5uZXdRdWVyeSgpXG4gICAgICAgIC5mcm9tKFNDSEVEVUxFX0tFWVNfVEFCTEUpXG4gICAgICAgIC53aGVyZSh7c2NoZWR1bGVfa2V5OiBub3JtYWxpemVkU2NoZWR1bGVLZXl9KVxuICAgICAgICAubGltaXQoMSlcbiAgICAgICAgLnJlc3VsdHMoKVxuICAgICAgY29uc3Qgb3duZXJKb2JJZCA9IG93bmVyUm93c1swXSA/IFN0cmluZygvKiogQHR5cGUge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gKi8gKG93bmVyUm93c1swXSkuam9iX2lkKSA6IG51bGxcbiAgICAgIGNvbnN0IG93bmVySm9iID0gb3duZXJKb2JJZCA/IGF3YWl0IHRoaXMuX2dldEpvYlJvd0J5SWQoZGIsIG93bmVySm9iSWQpIDogbnVsbFxuICAgICAgLyoqIEB0eXBlIHtpbXBvcnQoXCIuL3R5cGVzLmpzXCIpLkJhY2tncm91bmRKb2JSZXBsYWNlbWVudFByZXZpb3VzU3RhdHVzfSAqL1xuICAgICAgbGV0IHByZXZpb3VzU3RhdHVzID0gbnVsbFxuICAgICAgbGV0IHByZXZpb3VzSm9iSWQgPSBudWxsXG5cbiAgICAgIGlmIChvd25lckpvYj8uc3RhdHVzID09PSBcInF1ZXVlZFwiKSB7XG4gICAgICAgIGNvbnN0IGFmZmVjdGVkUm93cyA9IGF3YWl0IHRoaXMuX3VwZGF0ZUFmZmVjdGVkUm93cyhkYiwge1xuICAgICAgICAgIHRhYmxlTmFtZTogSk9CU19UQUJMRSxcbiAgICAgICAgICBkYXRhOiB7c3RhdHVzOiBcImNhbmNlbGxlZFwifSxcbiAgICAgICAgICBjb25kaXRpb25zOiB7aWQ6IG93bmVySm9iLmlkLCBzdGF0dXM6IFwicXVldWVkXCJ9XG4gICAgICAgIH0pXG5cbiAgICAgICAgaWYgKGFmZmVjdGVkUm93cyA9PT0gMSkge1xuICAgICAgICAgIHByZXZpb3VzSm9iSWQgPSBvd25lckpvYi5pZFxuICAgICAgICAgIHByZXZpb3VzU3RhdHVzID0gXCJxdWV1ZWRcIlxuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgIGNvbnN0IGN1cnJlbnRPd25lckpvYiA9IGF3YWl0IHRoaXMuX2dldEpvYlJvd0J5SWQoZGIsIG93bmVySm9iLmlkKVxuXG4gICAgICAgICAgaWYgKGN1cnJlbnRPd25lckpvYj8uc3RhdHVzID09PSBcImhhbmRlZF9vZmZcIikge1xuICAgICAgICAgICAgcHJldmlvdXNKb2JJZCA9IGN1cnJlbnRPd25lckpvYi5pZFxuICAgICAgICAgICAgcHJldmlvdXNTdGF0dXMgPSBcImhhbmRlZF9vZmZcIlxuICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgICAgfSBlbHNlIGlmIChvd25lckpvYj8uc3RhdHVzID09PSBcImhhbmRlZF9vZmZcIikge1xuICAgICAgICBwcmV2aW91c0pvYklkID0gb3duZXJKb2IuaWRcbiAgICAgICAgcHJldmlvdXNTdGF0dXMgPSBcImhhbmRlZF9vZmZcIlxuICAgICAgfVxuXG4gICAgICBhd2FpdCB0aGlzLl9pbnNlcnRQcmVwYXJlZEpvYihkYiwge3ByZXBhcmVkSm9iLCBzY2hlZHVsZUtleTogbm9ybWFsaXplZFNjaGVkdWxlS2V5fSlcbiAgICAgIGF3YWl0IGRiLnVwc2VydCh7XG4gICAgICAgIHRhYmxlTmFtZTogU0NIRURVTEVfS0VZU19UQUJMRSxcbiAgICAgICAgZGF0YToge3NjaGVkdWxlX2tleTogbm9ybWFsaXplZFNjaGVkdWxlS2V5LCBqb2JfaWQ6IHByZXBhcmVkSm9iLmpvYklkfSxcbiAgICAgICAgY29uZmxpY3RDb2x1bW5zOiBbXCJzY2hlZHVsZV9rZXlcIl0sXG4gICAgICAgIHVwZGF0ZUNvbHVtbnM6IFtcImpvYl9pZFwiXVxuICAgICAgfSlcblxuICAgICAgaWYgKHByZXZpb3VzU3RhdHVzICE9PSBcInF1ZXVlZFwiKSBhd2FpdCB0aGlzLl9yZWNvcmRDb3VudERlbHRhKGRiLCB7YWxsOiAxLCBxdWV1ZWQ6IDF9KVxuICAgICAgcmV0dXJuIHtqb2JJZDogcHJlcGFyZWRKb2Iuam9iSWQsIHByZXZpb3VzSm9iSWQsIHByZXZpb3VzU3RhdHVzfVxuICAgIH0sIHtcbiAgICAgIGFkdmlzb3J5TG9jazoge1xuICAgICAgICBmYWlsdXJlTWVzc2FnZTogXCJGYWlsZWQgdG8gYWNxdWlyZSBiYWNrZ3JvdW5kIGpvYiBzY2hlZHVsZS1rZXkgbG9ja1wiLFxuICAgICAgICBuYW1lOiB0aGlzLl9zY2hlZHVsZUtleUxvY2tOYW1lKG5vcm1hbGl6ZWRTY2hlZHVsZUtleSlcbiAgICAgIH1cbiAgICB9KVxuICB9XG5cbiAgLyoqXG4gICAqIENhbmNlbHMgdGhlIHF1ZXVlZCBvd25lciBvZiBhIHN0YWJsZSBzY2hlZHVsZSBrZXkuIEEgaGFuZGVkLW9mZiBvd25lciBpc1xuICAgKiBkZXRhY2hlZCBidXQgbm90IG1hcmtlZCBzdG9wcGVkIGJlY2F1c2UgZXhlY3V0aW9uIG1heSBhbHJlYWR5IGJlIHJ1bm5pbmcuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBzY2hlZHVsZUtleSAtIFN0YWJsZSBsb2dpY2FsIHNjaGVkdWxlIGtleS5cbiAgICogQHJldHVybnMge1Byb21pc2U8aW1wb3J0KFwiLi90eXBlcy5qc1wiKS5CYWNrZ3JvdW5kSm9iQ2FuY2VsbGF0aW9uUmVzdWx0Pn0gLSBDYW5jZWxsYXRpb24gcmVzdWx0LlxuICAgKi9cbiAgYXN5bmMgY2FuY2VsU2NoZWR1bGVkKHNjaGVkdWxlS2V5KSB7XG4gICAgYXdhaXQgdGhpcy5lbnN1cmVSZWFkeSgpXG5cbiAgICBjb25zdCBub3JtYWxpemVkU2NoZWR1bGVLZXkgPSB0aGlzLl9ub3JtYWxpemVTY2hlZHVsZUtleShzY2hlZHVsZUtleSlcblxuICAgIHJldHVybiBhd2FpdCB0aGlzLl9zZXJpYWxpemVkQ291bnRNdXRhdGlvbihhc3luYyAoZGIpID0+IHtcbiAgICAgIGNvbnN0IG93bmVyUm93cyA9IGF3YWl0IGRiXG4gICAgICAgIC5uZXdRdWVyeSgpXG4gICAgICAgIC5mcm9tKFNDSEVEVUxFX0tFWVNfVEFCTEUpXG4gICAgICAgIC53aGVyZSh7c2NoZWR1bGVfa2V5OiBub3JtYWxpemVkU2NoZWR1bGVLZXl9KVxuICAgICAgICAubGltaXQoMSlcbiAgICAgICAgLnJlc3VsdHMoKVxuXG4gICAgICBpZiAoIW93bmVyUm93c1swXSkgcmV0dXJuIHtqb2JJZDogbnVsbCwgb3V0Y29tZTogXCJub3RfZm91bmRcIn1cblxuICAgICAgY29uc3Qgam9iSWQgPSBTdHJpbmcoLyoqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59ICovIChvd25lclJvd3NbMF0pLmpvYl9pZClcbiAgICAgIGNvbnN0IGpvYiA9IGF3YWl0IHRoaXMuX2dldEpvYlJvd0J5SWQoZGIsIGpvYklkKVxuXG4gICAgICBpZiAoam9iPy5zdGF0dXMgPT09IFwicXVldWVkXCIpIHtcbiAgICAgICAgY29uc3QgYWZmZWN0ZWRSb3dzID0gYXdhaXQgdGhpcy5fdXBkYXRlQWZmZWN0ZWRSb3dzKGRiLCB7XG4gICAgICAgICAgdGFibGVOYW1lOiBKT0JTX1RBQkxFLFxuICAgICAgICAgIGRhdGE6IHtzdGF0dXM6IFwiY2FuY2VsbGVkXCJ9LFxuICAgICAgICAgIGNvbmRpdGlvbnM6IHtpZDogam9iLmlkLCBzdGF0dXM6IFwicXVldWVkXCJ9XG4gICAgICAgIH0pXG5cbiAgICAgICAgaWYgKGFmZmVjdGVkUm93cyA9PT0gMSkge1xuICAgICAgICAgIGF3YWl0IHRoaXMuX3JlbGVhc2VTY2hlZHVsZU93bmVyc2hpcChkYiwge2pvYklkLCBzY2hlZHVsZUtleTogbm9ybWFsaXplZFNjaGVkdWxlS2V5fSlcbiAgICAgICAgICBhd2FpdCB0aGlzLl9yZWNvcmRTdGF0dXNUcmFuc2l0aW9uKGRiLCBcInF1ZXVlZFwiLCBcImNhbmNlbGxlZFwiKVxuXG4gICAgICAgICAgcmV0dXJuIHtqb2JJZCwgb3V0Y29tZTogXCJjYW5jZWxsZWRcIn1cbiAgICAgICAgfVxuICAgICAgfVxuXG4gICAgICBjb25zdCBjdXJyZW50Sm9iID0gYXdhaXQgdGhpcy5fZ2V0Sm9iUm93QnlJZChkYiwgam9iSWQpXG5cbiAgICAgIGF3YWl0IHRoaXMuX3JlbGVhc2VTY2hlZHVsZU93bmVyc2hpcChkYiwge2pvYklkLCBzY2hlZHVsZUtleTogbm9ybWFsaXplZFNjaGVkdWxlS2V5fSlcblxuICAgICAgaWYgKGN1cnJlbnRKb2I/LnN0YXR1cyA9PT0gXCJoYW5kZWRfb2ZmXCIpIHJldHVybiB7am9iSWQsIG91dGNvbWU6IFwiaGFuZGVkX29mZlwifVxuICAgICAgcmV0dXJuIHtqb2JJZDogbnVsbCwgb3V0Y29tZTogXCJub3RfZm91bmRcIn1cbiAgICB9LCB7XG4gICAgICBhZHZpc29yeUxvY2s6IHtcbiAgICAgICAgZmFpbHVyZU1lc3NhZ2U6IFwiRmFpbGVkIHRvIGFjcXVpcmUgYmFja2dyb3VuZCBqb2Igc2NoZWR1bGUta2V5IGxvY2tcIixcbiAgICAgICAgbmFtZTogdGhpcy5fc2NoZWR1bGVLZXlMb2NrTmFtZShub3JtYWxpemVkU2NoZWR1bGVLZXkpXG4gICAgICB9XG4gICAgfSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIG5leHQgYXZhaWxhYmxlIGpvYi5cbiAgICogQHBhcmFtIHtvYmplY3R9IFthcmdzXSAtIE9wdGlvbnMuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi90eXBlcy5qc1wiKS5CYWNrZ3JvdW5kSm9iRXhlY3V0aW9uTW9kZSB8IGltcG9ydChcIi4vdHlwZXMuanNcIikuQmFja2dyb3VuZEpvYkV4ZWN1dGlvbk1vZGVbXX0gW2FyZ3MuZXhlY3V0aW9uTW9kZV0gLSBFeGVjdXRpb24gbW9kZSBvciBtb2RlcyB0byBtYXRjaC5cbiAgICogQHJldHVybnMge1Byb21pc2U8aW1wb3J0KFwiLi90eXBlcy5qc1wiKS5CYWNrZ3JvdW5kSm9iUm93IHwgbnVsbD59IC0gTmV4dCBqb2IuXG4gICAqL1xuICBhc3luYyBuZXh0QXZhaWxhYmxlSm9iKGFyZ3MgPSB7fSkge1xuICAgIGF3YWl0IHRoaXMuZW5zdXJlUmVhZHkoKVxuXG4gICAgcmV0dXJuIGF3YWl0IHRoaXMuX3dpdGhEYihhc3luYyAoZGIpID0+IHtcbiAgICAgIHJldHVybiBhd2FpdCB0aGlzLl9uZXh0UXVldWVkSm9iKHtcbiAgICAgICAgZGIsXG4gICAgICAgIHNjaGVkdWxlZEF0T3BlcmF0b3I6IFwiPD1cIixcbiAgICAgICAgZXhlY3V0aW9uTW9kZTogYXJncy5leGVjdXRpb25Nb2RlXG4gICAgICB9KVxuICAgIH0pXG4gIH1cblxuICAvKipcbiAgICogUmV0dXJucyB0aGUgc29vbmVzdCBmdXR1cmUtc2NoZWR1bGVkIHF1ZXVlZCBqb2IgKG9uZSB3aG9zZVxuICAgKiBgc2NoZWR1bGVkX2F0X21zYCBpcyBpbiB0aGUgZnV0dXJlKSwgb3IgbnVsbCB3aGVuIHRoZXJlIGFyZSBub1xuICAgKiBmdXR1cmUtc2NoZWR1bGVkIGpvYnMuIFVzZWQgYnkgdGhlIGV2ZW50LWRyaXZlbiBkaXNwYXRjaGVyIHRvIGFybSBhXG4gICAqIGBzZXRUaW1lb3V0YCBmb3IgdGhlIGV4YWN0IG1vbWVudCB0aGUgbmV4dCBzY2hlZHVsZWQgam9iIGJlY29tZXNcbiAgICogZWxpZ2libGUsIHJlcGxhY2luZyB0aGUgbGVnYWN5IDEtc2Vjb25kIHBvbGxpbmcgbG9vcC5cbiAgICogQHJldHVybnMge1Byb21pc2U8aW1wb3J0KFwiLi90eXBlcy5qc1wiKS5CYWNrZ3JvdW5kSm9iUm93IHwgbnVsbD59IC0gU29vbmVzdCBmdXR1cmUtc2NoZWR1bGVkIGpvYiwgb3IgbnVsbC5cbiAgICovXG4gIGFzeW5jIG5leHRTY2hlZHVsZWRKb2IoKSB7XG4gICAgYXdhaXQgdGhpcy5lbnN1cmVSZWFkeSgpXG5cbiAgICByZXR1cm4gYXdhaXQgdGhpcy5fd2l0aERiKGFzeW5jIChkYikgPT4ge1xuICAgICAgcmV0dXJuIGF3YWl0IHRoaXMuX25leHRRdWV1ZWRKb2Ioe2RiLCBzY2hlZHVsZWRBdE9wZXJhdG9yOiBcIj5cIn0pXG4gICAgfSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIG5leHQgcXVldWVkIGpvYi5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBPcHRpb25zLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL2RhdGFiYXNlL2RyaXZlcnMvYmFzZS5qc1wiKS5kZWZhdWx0fSBhcmdzLmRiIC0gRGF0YWJhc2UgY29ubmVjdGlvbi5cbiAgICogQHBhcmFtIHtcIjw9XCIgfCBcIj5cIn0gYXJncy5zY2hlZHVsZWRBdE9wZXJhdG9yIC0gU2NoZWR1bGVkIHRpbWVzdGFtcCBvcGVyYXRvci5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL3R5cGVzLmpzXCIpLkJhY2tncm91bmRKb2JFeGVjdXRpb25Nb2RlIHwgaW1wb3J0KFwiLi90eXBlcy5qc1wiKS5CYWNrZ3JvdW5kSm9iRXhlY3V0aW9uTW9kZVtdfSBbYXJncy5leGVjdXRpb25Nb2RlXSAtIEV4ZWN1dGlvbiBtb2RlIG9yIG1vZGVzIHRvIG1hdGNoLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxpbXBvcnQoXCIuL3R5cGVzLmpzXCIpLkJhY2tncm91bmRKb2JSb3cgfCBudWxsPn0gLSBOZXh0IG1hdGNoaW5nIHF1ZXVlZCBqb2IuXG4gICAqL1xuICBhc3luYyBfbmV4dFF1ZXVlZEpvYih7ZGIsIHNjaGVkdWxlZEF0T3BlcmF0b3IsIGV4ZWN1dGlvbk1vZGV9KSB7XG4gICAgY29uc3Qgbm93ID0gdGhpcy5jbG9jay5ub3coKVxuICAgIGxldCBxdWVyeSA9IGRiXG4gICAgICAubmV3UXVlcnkoKVxuICAgICAgLmZyb20oSk9CU19UQUJMRSlcbiAgICAgIC53aGVyZSh7c3RhdHVzOiBcInF1ZXVlZFwifSlcbiAgICAgIC53aGVyZShgc2NoZWR1bGVkX2F0X21zICR7c2NoZWR1bGVkQXRPcGVyYXRvcn0gJHtkYi5xdW90ZShub3cpfWApXG5cbiAgICBpZiAoc2NoZWR1bGVkQXRPcGVyYXRvciA9PT0gXCI8PVwiKSB7XG4gICAgICBjb25zdCBqb2JzVGFibGUgPSBkYi5xdW90ZVRhYmxlKEpPQlNfVEFCTEUpXG4gICAgICBjb25zdCBjb25jdXJyZW5jeVRhYmxlID0gZGIucXVvdGVUYWJsZShDT05DVVJSRU5DWV9UQUJMRSlcbiAgICAgIHF1ZXJ5ID0gcXVlcnkud2hlcmUoXG4gICAgICAgIGAoJHtqb2JzVGFibGV9LiR7ZGIucXVvdGVDb2x1bW4oXCJjb25jdXJyZW5jeV9rZXlcIil9IElTIE5VTEwgT1IgRVhJU1RTIChgICtcbiAgICAgICAgYFNFTEVDVCAxIEZST00gJHtjb25jdXJyZW5jeVRhYmxlfSBXSEVSRSBgICtcbiAgICAgICAgYCR7Y29uY3VycmVuY3lUYWJsZX0uJHtkYi5xdW90ZUNvbHVtbihcImNvbmN1cnJlbmN5X2tleVwiKX0gPSAke2pvYnNUYWJsZX0uJHtkYi5xdW90ZUNvbHVtbihcImNvbmN1cnJlbmN5X2tleVwiKX0gQU5EIGAgK1xuICAgICAgICBgJHtjb25jdXJyZW5jeVRhYmxlfS4ke2RiLnF1b3RlQ29sdW1uKFwiYWN0aXZlX2NvdW50XCIpfSA8ICR7Y29uY3VycmVuY3lUYWJsZX0uJHtkYi5xdW90ZUNvbHVtbihcIm1heF9jb25jdXJyZW5jeVwiKX0pKWBcbiAgICAgIClcbiAgICB9XG5cbiAgICBpZiAoZXhlY3V0aW9uTW9kZSkgcXVlcnkgPSB0aGlzLl93aGVyZUV4ZWN1dGlvbk1vZGUoe2RiLCBleGVjdXRpb25Nb2RlLCBxdWVyeX0pXG5cbiAgICBpZiAoc2NoZWR1bGVkQXRPcGVyYXRvciA9PT0gXCI8PVwiKSB7XG4gICAgICBjb25zdCBwcmlvcml0eU9yZGVyID0gdGhpcy5fcXVldWVQcmlvcml0eU9yZGVyU3FsKGRiKVxuXG4gICAgICBpZiAocHJpb3JpdHlPcmRlcikgcXVlcnkgPSBxdWVyeS5vcmRlcihgJHtwcmlvcml0eU9yZGVyfSBERVNDYClcbiAgICB9XG5cbiAgICBxdWVyeSA9IHF1ZXJ5XG4gICAgICAub3JkZXIoXCJzY2hlZHVsZWRfYXRfbXMgQVNDXCIpXG4gICAgICAub3JkZXIoXCJjcmVhdGVkX2F0X21zIEFTQ1wiKVxuICAgICAgLmxpbWl0KDEpXG5cbiAgICBjb25zdCByb3dzID0gYXdhaXQgcXVlcnkucmVzdWx0cygpXG4gICAgY29uc3Qgcm93ID0gcm93c1swXVxuXG4gICAgaWYgKCFyb3cpIHJldHVybiBudWxsXG5cbiAgICByZXR1cm4gdGhpcy5fbm9ybWFsaXplSm9iUm93KHJvdylcbiAgfVxuXG4gIC8qKlxuICAgKiBCdWlsZHMgYSByYXcgU1FMIE9SREVSIEJZIGV4cHJlc3Npb24gcmFua2luZyBxdWV1ZWQgam9icyBieSB0aGVpciBxdWV1ZSdzXG4gICAqIGNvbmZpZ3VyZWQgcHJpb3JpdHkgKGBiYWNrZ3JvdW5kSm9icy5xdWV1ZXNbcXVldWVdLnByaW9yaXR5YCwgZGVmYXVsdCBgMGApLFxuICAgKiBzbyB0aGUgZGlzcGF0Y2hlciBwaWNrcyBoaWdoZXItcHJpb3JpdHkgcXVldWVzIGZpcnN0IHJlZ2FyZGxlc3Mgb2YgZW5xdWV1ZVxuICAgKiBvcmRlci4gT25seSBhcHBsaWVkIHRvIHRoZSBkaXNwYXRjaCBwYXRoIChgc2NoZWR1bGVkQXRPcGVyYXRvciA9PT0gXCI8PVwiYCk7XG4gICAqIHRoZSBmdXR1cmUtc2NoZWR1bGVkIGxvb2t1cCBtdXN0IHN0YXkgc3RyaWN0bHkgdGltZS1vcmRlcmVkLiBDb21wb3NlcyB3aXRoXG4gICAqIHRoZSBjb25jdXJyZW5jeSBFWElTVFMgZmlsdGVyOiBhIGhpZ2hlci1wcmlvcml0eSBxdWV1ZSBhbHJlYWR5IGF0IGl0cyBjYXAgaXNcbiAgICogZmlsdGVyZWQgb3V0LCBzbyBkaXNwYXRjaCBmYWxscyB0aHJvdWdoIHRvIHRoZSBuZXh0IGVsaWdpYmxlIGxvd2VyLXByaW9yaXR5XG4gICAqIGpvYi4gUmV0dXJucyBudWxsIHdoZW4gbm8gcXVldWUgY29uZmlndXJlcyBhIG5vbi16ZXJvIHByaW9yaXR5IHNvIHRoZSBwbGFpblxuICAgKiBGSUZPIG9yZGVyaW5nIGlzIGxlZnQgdW50b3VjaGVkIChhbmQgbm8gbmVlZGxlc3MgZmlsZXNvcnQgaXMgaW50cm9kdWNlZCkuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vZGF0YWJhc2UvZHJpdmVycy9iYXNlLmpzXCIpLmRlZmF1bHR9IGRiIC0gRGF0YWJhc2UgY29ubmVjdGlvbi5cbiAgICogQHJldHVybnMge3N0cmluZyB8IG51bGx9IC0gUmF3IFNRTCBDQVNFIGV4cHJlc3Npb24sIG9yIG51bGwgd2hlbiBubyBxdWV1ZSBpcyBwcmlvcml0aXplZC5cbiAgICovXG4gIF9xdWV1ZVByaW9yaXR5T3JkZXJTcWwoZGIpIHtcbiAgICBjb25zdCBxdWV1ZXMgPSB0aGlzLmNvbmZpZ3VyYXRpb24uZ2V0QmFja2dyb3VuZEpvYnNDb25maWcoKS5xdWV1ZXMgfHwge31cbiAgICAvKiogQHR5cGUge0FycmF5PFtzdHJpbmcsIG51bWJlcl0+fSAqL1xuICAgIGNvbnN0IHByaW9yaXRpemVkID0gW11cblxuICAgIGZvciAoY29uc3QgW3F1ZXVlLCBxdWV1ZUNvbmZpZ10gb2YgT2JqZWN0LmVudHJpZXMocXVldWVzKSkge1xuICAgICAgY29uc3QgcHJpb3JpdHkgPSBxdWV1ZUNvbmZpZz8ucHJpb3JpdHlcblxuICAgICAgaWYgKE51bWJlci5pc0Zpbml0ZShwcmlvcml0eSkgJiYgTnVtYmVyKHByaW9yaXR5KSAhPT0gMCkgcHJpb3JpdGl6ZWQucHVzaChbcXVldWUsIE51bWJlcihwcmlvcml0eSldKVxuICAgIH1cblxuICAgIGlmIChwcmlvcml0aXplZC5sZW5ndGggPT09IDApIHJldHVybiBudWxsXG5cbiAgICBjb25zdCBxdWV1ZUNvbHVtbiA9IGRiLnF1b3RlQ29sdW1uKFwicXVldWVcIilcbiAgICBjb25zdCB3aGVucyA9IHByaW9yaXRpemVkXG4gICAgICAubWFwKChbcXVldWUsIHByaW9yaXR5XSkgPT4gYFdIRU4gJHtkYi5xdW90ZShxdWV1ZSl9IFRIRU4gJHtwcmlvcml0eX1gKVxuICAgICAgLmpvaW4oXCIgXCIpXG5cbiAgICByZXR1cm4gYENBU0UgQ09BTEVTQ0UoJHtxdWV1ZUNvbHVtbn0sICR7ZGIucXVvdGUoREVGQVVMVF9CQUNLR1JPVU5EX0pPQl9RVUVVRSl9KSAke3doZW5zfSBFTFNFIDAgRU5EYFxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZ2V0IGpvYi5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGpvYklkIC0gSm9iIGlkLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxpbXBvcnQoXCIuL3R5cGVzLmpzXCIpLkJhY2tncm91bmRKb2JSb3cgfCBudWxsPn0gLSBKb2Igcm93LlxuICAgKi9cbiAgYXN5bmMgZ2V0Sm9iKGpvYklkKSB7XG4gICAgYXdhaXQgdGhpcy5lbnN1cmVSZWFkeSgpXG5cbiAgICByZXR1cm4gYXdhaXQgdGhpcy5fd2l0aERiKGFzeW5jIChkYikgPT4ge1xuICAgICAgY29uc3QgcXVlcnkgPSBkYlxuICAgICAgICAubmV3UXVlcnkoKVxuICAgICAgICAuZnJvbShKT0JTX1RBQkxFKVxuICAgICAgICAud2hlcmUoe2lkOiBqb2JJZH0pXG4gICAgICAgIC5saW1pdCgxKVxuXG4gICAgICBjb25zdCByb3dzID0gYXdhaXQgcXVlcnkucmVzdWx0cygpXG4gICAgICBjb25zdCByb3cgPSByb3dzWzBdXG5cbiAgICAgIGlmICghcm93KSByZXR1cm4gbnVsbFxuXG4gICAgICByZXR1cm4gdGhpcy5fbm9ybWFsaXplSm9iUm93KHJvdylcbiAgICB9KVxuICB9XG5cbiAgLyoqXG4gICAqIENvdW50cyBqb2JzIGdyb3VwZWQgYnkgc3RhdHVzLiBVc2VkIGJ5IHRoZSBkYXNoYm9hcmQgb3ZlcnZpZXcuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPFJlY29yZDxzdHJpbmcsIG51bWJlcj4+fSAtIENvdW50cyBrZXllZCBieSBzdGF0dXMuXG4gICAqL1xuICBhc3luYyBjb3VudHNCeVN0YXR1cygpIHtcbiAgICBhd2FpdCB0aGlzLmVuc3VyZVJlYWR5KClcblxuICAgIHJldHVybiBhd2FpdCB0aGlzLl93aXRoRGIoYXN5bmMgKGRiKSA9PiB7XG4gICAgICBjb25zdCByb3dzID0gYXdhaXQgZGJcbiAgICAgICAgLm5ld1F1ZXJ5KClcbiAgICAgICAgLmZyb20oSk9CU19UQUJMRSlcbiAgICAgICAgLnNlbGVjdChcInN0YXR1c1wiKVxuICAgICAgICAuc2VsZWN0KFwiQ09VTlQoKikgQVMgY291bnRcIilcbiAgICAgICAgLmdyb3VwKFwic3RhdHVzXCIpXG4gICAgICAgIC5yZXN1bHRzKClcblxuICAgICAgLyoqXG4gICAgICAgKiBDb3VudHMuXG4gICAgICAgKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgbnVtYmVyPn0gKi9cbiAgICAgIGNvbnN0IGNvdW50cyA9IHt9XG5cbiAgICAgIGZvciAoY29uc3Qgcm93IG9mIHJvd3MpIHtcbiAgICAgICAgY29uc3QgdHlwZWRSb3cgPSAvKiogQHR5cGUge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gKi8gKHJvdylcblxuICAgICAgICBjb3VudHNbU3RyaW5nKHR5cGVkUm93LnN0YXR1cyldID0gdGhpcy5fbm9ybWFsaXplTnVtYmVyKHR5cGVkUm93LmNvdW50KSB8fCAwXG4gICAgICB9XG5cbiAgICAgIHJldHVybiBjb3VudHNcbiAgICB9KVxuICB9XG5cbiAgLyoqXG4gICAqIFJldHVybnMgdGhlIGF1dGhvcml0YXRpdmUgZGFzaGJvYXJkIGNvdW50IHNuYXBzaG90IGFuZCBpdHMgbWF0Y2hpbmcgZHVyYWJsZVxuICAgKiByZXZpc2lvbi4gTG9ja2luZyB0aGUgcmV2aXNpb24gcm93IGJlZm9yZSBjb3VudGluZyBwcmV2ZW50cyBhIHdyaXRlciBmcm9tXG4gICAqIGNvbW1pdHRpbmcgYmV0d2VlbiB0aGUgY291bnQgcXVlcnkgYW5kIHJldmlzaW9uIHJlYWQuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHtjb3VudHM6IFJlY29yZDxzdHJpbmcsIG51bWJlcj4sIHJldmlzaW9uOiBudW1iZXIsIHRvdGFsOiBudW1iZXJ9Pn0gU25hcHNob3QuXG4gICAqL1xuICBhc3luYyBjb3VudFNuYXBzaG90KCkge1xuICAgIGF3YWl0IHRoaXMuZW5zdXJlUmVhZHkoKVxuXG4gICAgcmV0dXJuIGF3YWl0IHRoaXMuX3NlcmlhbGl6ZWRDb3VudE11dGF0aW9uKGFzeW5jIChkYikgPT4ge1xuICAgICAgcmV0dXJuIGF3YWl0IHRoaXMuX2NvdW50U25hcHNob3RPbkxvY2tlZENvbm5lY3Rpb24oZGIpXG4gICAgfSlcbiAgfVxuXG4gIC8qKlxuICAgKiBDb3VudHMgam9icyBtYXRjaGluZyB0aGUgZ2l2ZW4gZmlsdGVycy5cbiAgICogQHBhcmFtIHtvYmplY3R9IFthcmdzXSAtIE9wdGlvbnMuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBbYXJncy5zdGF0dXNdIC0gRmlsdGVyIGJ5IHN0YXR1cy5cbiAgICogQHBhcmFtIHtzdHJpbmd9IFthcmdzLmpvYk5hbWVdIC0gRmlsdGVyIGJ5IGpvYiBuYW1lLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxudW1iZXI+fSAtIE1hdGNoaW5nIGpvYiBjb3VudC5cbiAgICovXG4gIGFzeW5jIGNvdW50Sm9icyh7c3RhdHVzLCBqb2JOYW1lfSA9IHt9KSB7XG4gICAgYXdhaXQgdGhpcy5lbnN1cmVSZWFkeSgpXG5cbiAgICByZXR1cm4gYXdhaXQgdGhpcy5fd2l0aERiKGFzeW5jIChkYikgPT4ge1xuICAgICAgbGV0IHF1ZXJ5ID0gZGIubmV3UXVlcnkoKS5mcm9tKEpPQlNfVEFCTEUpLnNlbGVjdChcIkNPVU5UKCopIEFTIGNvdW50XCIpXG5cbiAgICAgIGlmIChzdGF0dXMpIHF1ZXJ5ID0gcXVlcnkud2hlcmUoe3N0YXR1c30pXG4gICAgICBpZiAoam9iTmFtZSkgcXVlcnkgPSBxdWVyeS53aGVyZSh7am9iX25hbWU6IGpvYk5hbWV9KVxuXG4gICAgICBjb25zdCByb3dzID0gYXdhaXQgcXVlcnkucmVzdWx0cygpXG4gICAgICBjb25zdCBjb3VudFJvdyA9IC8qKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSAqLyAocm93c1swXSB8fCB7fSlcblxuICAgICAgcmV0dXJuIHRoaXMuX25vcm1hbGl6ZU51bWJlcihjb3VudFJvdy5jb3VudCkgfHwgMFxuICAgIH0pXG4gIH1cblxuICAvKipcbiAgICogTGlzdHMgam9icyBmb3IgdGhlIGRhc2hib2FyZCwgZmlsdGVyZWQsIHNvcnRlZCBhbmQgcGFnaW5hdGVkLlxuICAgKiBAcGFyYW0ge29iamVjdH0gW2FyZ3NdIC0gT3B0aW9ucy5cbiAgICogQHBhcmFtIHtzdHJpbmd9IFthcmdzLnN0YXR1c10gLSBGaWx0ZXIgYnkgc3RhdHVzLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gW2FyZ3Muam9iTmFtZV0gLSBGaWx0ZXIgYnkgam9iIG5hbWUuXG4gICAqIEBwYXJhbSB7bnVtYmVyfSBbYXJncy5saW1pdF0gLSBNYXhpbXVtIHJvd3MgdG8gcmV0dXJuLlxuICAgKiBAcGFyYW0ge251bWJlcn0gW2FyZ3Mub2Zmc2V0XSAtIFJvd3MgdG8gc2tpcC5cbiAgICogQHBhcmFtIHtzdHJpbmd9IFthcmdzLnNvcnRDb2x1bW5dIC0gQ2FtZWwtY2FzZWQgY29sdW1uIHRvIHNvcnQgYnkgKHNlZSBTT1JUQUJMRV9DT0xVTU5TKS5cbiAgICogQHBhcmFtIHtcIkFTQ1wiIHwgXCJERVNDXCJ9IFthcmdzLnNvcnREaXJlY3Rpb25dIC0gU29ydCBkaXJlY3Rpb24uXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPGltcG9ydChcIi4vdHlwZXMuanNcIikuQmFja2dyb3VuZEpvYlJvd1tdPn0gLSBOb3JtYWxpemVkIGpvYiByb3dzLlxuICAgKi9cbiAgYXN5bmMgbGlzdEpvYnMoe3N0YXR1cywgam9iTmFtZSwgbGltaXQgPSAyNSwgb2Zmc2V0ID0gMCwgc29ydENvbHVtbiA9IFwiY3JlYXRlZEF0TXNcIiwgc29ydERpcmVjdGlvbiA9IFwiREVTQ1wifSA9IHt9KSB7XG4gICAgYXdhaXQgdGhpcy5lbnN1cmVSZWFkeSgpXG5cbiAgICBjb25zdCBjb2x1bW4gPSBTT1JUQUJMRV9DT0xVTU5TW3NvcnRDb2x1bW5dIHx8IFNPUlRBQkxFX0NPTFVNTlMuY3JlYXRlZEF0TXNcbiAgICBjb25zdCBkaXJlY3Rpb24gPSBzb3J0RGlyZWN0aW9uID09PSBcIkFTQ1wiID8gXCJBU0NcIiA6IFwiREVTQ1wiXG5cbiAgICByZXR1cm4gYXdhaXQgdGhpcy5fd2l0aERiKGFzeW5jIChkYikgPT4ge1xuICAgICAgbGV0IHF1ZXJ5ID0gZGIubmV3UXVlcnkoKS5mcm9tKEpPQlNfVEFCTEUpXG5cbiAgICAgIGlmIChzdGF0dXMpIHF1ZXJ5ID0gcXVlcnkud2hlcmUoe3N0YXR1c30pXG4gICAgICBpZiAoam9iTmFtZSkgcXVlcnkgPSBxdWVyeS53aGVyZSh7am9iX25hbWU6IGpvYk5hbWV9KVxuXG4gICAgICBxdWVyeSA9IHF1ZXJ5Lm9yZGVyKHtjb2x1bW4sIGRpcmVjdGlvbn0pXG4gICAgICBpZiAoY29sdW1uICE9PSBTT1JUQUJMRV9DT0xVTU5TLmNyZWF0ZWRBdE1zKSBxdWVyeSA9IHF1ZXJ5Lm9yZGVyKHtjb2x1bW46IFNPUlRBQkxFX0NPTFVNTlMuY3JlYXRlZEF0TXMsIGRpcmVjdGlvbjogXCJERVNDXCJ9KVxuXG4gICAgICBjb25zdCByb3dzID0gYXdhaXQgcXVlcnkubGltaXQobGltaXQpLm9mZnNldChvZmZzZXQpLnJlc3VsdHMoKVxuXG4gICAgICByZXR1cm4gcm93cy5tYXAoKHJvdykgPT4gdGhpcy5fbm9ybWFsaXplSm9iUm93KHJvdykpXG4gICAgfSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIG1hcmsgaGFuZGVkIG9mZi5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBPcHRpb25zLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gYXJncy5qb2JJZCAtIEpvYiBpZC5cbiAgICogQHBhcmFtIHtzdHJpbmd9IFthcmdzLmhhbmRvZmZJZF0gLSBDYWxsZXItc2VsZWN0ZWQgZXhhY3QgbGVhc2UgaWQuIEdlbmVyYXRlZCBmb3IgbGVnYWN5IGRpcmVjdCBjYWxsZXJzIHdoZW4gb21pdHRlZC5cbiAgICogQHBhcmFtIHtzdHJpbmd9IFthcmdzLndvcmtlcklkXSAtIFdvcmtlciBpZC5cbiAgICogQHJldHVybnMge1Byb21pc2U8aW1wb3J0KFwiLi90eXBlcy5qc1wiKS5CYWNrZ3JvdW5kSm9iSGFuZG9mZiB8IG51bGw+fSAtIENsYWltZWQgaGFuZG9mZiBsZWFzZSwgb3IgbnVsbCB3aGVuIG5vIGxvbmdlciBxdWV1ZWQuXG4gICAqL1xuICBhc3luYyBtYXJrSGFuZGVkT2ZmKHtqb2JJZCwgaGFuZG9mZklkID0gcmFuZG9tVVVJRCgpLCB3b3JrZXJJZH0pIHtcbiAgICBhd2FpdCB0aGlzLmVuc3VyZVJlYWR5KClcblxuICAgIGNvbnN0IGhhbmRlZE9mZkF0TXMgPSB0aGlzLmNsb2NrLm5vdygpXG5cbiAgICByZXR1cm4gYXdhaXQgdGhpcy5fc2VyaWFsaXplZENvdW50TXV0YXRpb24oYXN5bmMgKGRiKSA9PiB7XG4gICAgICBjb25zdCBzZWxlY3RlZEpvYiA9IGF3YWl0IHRoaXMuX2dldEpvYlJvd0J5SWQoZGIsIGpvYklkKVxuICAgICAgaWYgKCFzZWxlY3RlZEpvYiB8fCBzZWxlY3RlZEpvYi5zdGF0dXMgIT09IFwicXVldWVkXCIpIHJldHVybiBudWxsXG4gICAgICBjb25zdCBxdWV1ZWRKb2IgPSBhd2FpdCB0aGlzLl9yZWNvbmNpbGVRdWV1ZWRKb2JDb25jdXJyZW5jeShkYiwgc2VsZWN0ZWRKb2IpXG5cbiAgICAgIGlmICghcXVldWVkSm9iKSByZXR1cm4gbnVsbFxuICAgICAgaWYgKHF1ZXVlZEpvYi5jb25jdXJyZW5jeUtleSAmJiAhKGF3YWl0IHRoaXMuX3Jlc2VydmVDb25jdXJyZW5jeShkYiwgcXVldWVkSm9iLmNvbmN1cnJlbmN5S2V5KSkpIHJldHVybiBudWxsXG4gICAgICBjb25zdCBhZmZlY3RlZFJvd3MgPSBhd2FpdCB0aGlzLl91cGRhdGVBZmZlY3RlZFJvd3MoZGIsIHtcbiAgICAgICAgdGFibGVOYW1lOiBKT0JTX1RBQkxFLFxuICAgICAgICBkYXRhOiB7XG4gICAgICAgICAgc3RhdHVzOiBcImhhbmRlZF9vZmZcIixcbiAgICAgICAgICBoYW5kZWRfb2ZmX2F0X21zOiBoYW5kZWRPZmZBdE1zLFxuICAgICAgICAgIGhhbmRvZmZfaWQ6IGhhbmRvZmZJZCxcbiAgICAgICAgICB3b3JrZXJfaWQ6IHdvcmtlcklkIHx8IG51bGwsXG4gICAgICAgICAgLi4udGhpcy5fY2xlYXJlZENoaWxkQWNjZXB0YW5jZURhdGEoKVxuICAgICAgICB9LFxuICAgICAgICBjb25kaXRpb25zOiB7Y29uY3VycmVuY3lfa2V5OiBxdWV1ZWRKb2IuY29uY3VycmVuY3lLZXksIGlkOiBqb2JJZCwgc3RhdHVzOiBcInF1ZXVlZFwifVxuICAgICAgfSlcblxuICAgICAgaWYgKGFmZmVjdGVkUm93cyAhPT0gMSkge1xuICAgICAgICBhd2FpdCB0aGlzLl9yZWxlYXNlQ29uY3VycmVuY3koZGIsIHF1ZXVlZEpvYi5jb25jdXJyZW5jeUtleSlcbiAgICAgICAgcmV0dXJuIG51bGxcbiAgICAgIH1cblxuICAgICAgYXdhaXQgdGhpcy5fcmVjb3JkU3RhdHVzVHJhbnNpdGlvbihkYiwgXCJxdWV1ZWRcIiwgXCJoYW5kZWRfb2ZmXCIpXG4gICAgICAvKiogQHR5cGUge2ltcG9ydChcIi4vdHlwZXMuanNcIikuQmFja2dyb3VuZEpvYlJvd30gKi9cbiAgICAgIGNvbnN0IGhhbmRlZE9mZkpvYiA9IHtcbiAgICAgICAgLi4ucXVldWVkSm9iLFxuICAgICAgICAuLi50aGlzLl9jbGVhcmVkQ2hpbGRBY2NlcHRhbmNlUm93KCksXG4gICAgICAgIGhhbmRlZE9mZkF0TXMsXG4gICAgICAgIGhhbmRvZmZJZCxcbiAgICAgICAgc3RhdHVzOiBcImhhbmRlZF9vZmZcIixcbiAgICAgICAgd29ya2VySWQ6IHdvcmtlcklkIHx8IG51bGxcbiAgICAgIH1cblxuICAgICAgcmV0dXJuIHtoYW5kZWRPZmZBdE1zLCBoYW5kb2ZmSWQsIGpvYjogaGFuZGVkT2ZmSm9ifVxuICAgIH0pXG4gIH1cblxuICAvKipcbiAgICogUnVucyBtYXJrIGNvbXBsZXRlZC5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBPcHRpb25zLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gYXJncy5qb2JJZCAtIEpvYiBpZC5cbiAgICogQHBhcmFtIHtzdHJpbmd9IFthcmdzLmhhbmRvZmZJZF0gLSBIYW5kb2ZmIGxlYXNlIGlkLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gW2FyZ3Mud29ya2VySWRdIC0gV29ya2VyIGlkLlxuICAgKiBAcGFyYW0ge251bWJlcn0gW2FyZ3MuaGFuZGVkT2ZmQXRNc10gLSBIYW5kZWQgb2ZmIHRpbWVzdGFtcC5cbiAgICogQHJldHVybnMge1Byb21pc2U8Ym9vbGVhbj59IC0gV2hldGhlciB0aGUgZmVuY2VkIHJlcG9ydCB3YXMgYWNjZXB0ZWQuXG4gICAqL1xuICBhc3luYyBtYXJrQ29tcGxldGVkKHtqb2JJZCwgaGFuZG9mZklkLCB3b3JrZXJJZCwgaGFuZGVkT2ZmQXRNc30pIHtcbiAgICBhd2FpdCB0aGlzLmVuc3VyZVJlYWR5KClcblxuICAgIHJldHVybiBhd2FpdCB0aGlzLl9zZXJpYWxpemVkQ291bnRNdXRhdGlvbihhc3luYyAoZGIpID0+IHtcbiAgICAgIGNvbnN0IGpvYiA9IGF3YWl0IHRoaXMuX2dldEpvYlJvd0J5SWQoZGIsIGpvYklkKVxuXG4gICAgICBpZiAoIWpvYikgcmV0dXJuIGZhbHNlXG4gICAgICBpZiAoIXRoaXMuX3Nob3VsZEFjY2VwdFJlcG9ydCh7am9iLCBoYW5kb2ZmSWQsIHdvcmtlcklkLCBoYW5kZWRPZmZBdE1zfSkpIHJldHVybiBmYWxzZVxuXG4gICAgICBhd2FpdCB0aGlzLl9sb2NrQ29uY3VycmVuY3lSb3coZGIsIGpvYi5jb25jdXJyZW5jeUtleSlcbiAgICAgIGNvbnN0IGFmZmVjdGVkUm93cyA9IGF3YWl0IHRoaXMuX3VwZGF0ZUFmZmVjdGVkUm93cyhkYiwge1xuICAgICAgICB0YWJsZU5hbWU6IEpPQlNfVEFCTEUsXG4gICAgICAgIGRhdGE6IHtcbiAgICAgICAgICBzdGF0dXM6IFwiY29tcGxldGVkXCIsXG4gICAgICAgICAgY29tcGxldGVkX2F0X21zOiB0aGlzLmNsb2NrLm5vdygpXG4gICAgICAgIH0sXG4gICAgICAgIGNvbmRpdGlvbnM6IHRoaXMuX2FjdGl2ZUhhbmRvZmZDb25kaXRpb25zKGpvYilcbiAgICAgIH0pXG5cbiAgICAgIGlmIChhZmZlY3RlZFJvd3MgIT09IDEpIHJldHVybiBmYWxzZVxuICAgICAgYXdhaXQgdGhpcy5fcmVsZWFzZVNjaGVkdWxlT3duZXJzaGlwRm9ySm9iKGRiLCBqb2IpXG4gICAgICBhd2FpdCB0aGlzLl9yZWxlYXNlQ29uY3VycmVuY3koZGIsIGpvYi5jb25jdXJyZW5jeUtleSlcbiAgICAgIGF3YWl0IHRoaXMuX3JlY29yZFN0YXR1c1RyYW5zaXRpb24oZGIsIFwiaGFuZGVkX29mZlwiLCBcImNvbXBsZXRlZFwiKVxuICAgICAgcmV0dXJuIHRydWVcbiAgICB9KVxuICB9XG5cbiAgLyoqXG4gICAqIFJlY29yZHMgcG9vbGVkLWNoaWxkIGFjY2VwdGFuY2UgZXZpZGVuY2UgZm9yIGFuIGFjdGl2ZSBoYW5kb2ZmOiB3aGVuIHRoZVxuICAgKiBleGVjdXRpbmcgcnVubmVyIGNoaWxkIHJlY2VpdmVkIGFuZC9vciBzdGFydGVkIHRoZSBqb2IsIHBsdXMgdGhhdCBjaGlsZCdzXG4gICAqIHN0YWJsZSBpZGVudGl0eSBhbmQgcGlkLiBPbmx5IHRoZSBmaWVsZHMgc3VwcGxpZWQgYXJlIHdyaXR0ZW4sIHNvIGFcbiAgICogcmVjZWl2ZWQtdGhlbi1zdGFydGVkIG9ic2VydmF0aW9uIGxhbmRzIGFzIHR3byBmZW5jZWQgcGFydGlhbCB1cGRhdGVzLiBUaGVcbiAgICogdXBkYXRlIGlzIGZlbmNlZCBieSB0aGUgZXhhY3QgYWN0aXZlIGhhbmRvZmYgbGVhc2UsIHNvIGEgcmVwb3J0IGZvciBhXG4gICAqIHJlY2xhaW1lZCBvciByZS1oYW5kZWQtb2ZmIGpvYiBpcyBkcm9wcGVkIGluc3RlYWQgb2Ygc3RhbXBpbmcgdGhlIHdyb25nXG4gICAqIGF0dGVtcHQuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gT3B0aW9ucy5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGFyZ3Muam9iSWQgLSBKb2IgaWQuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBbYXJncy5oYW5kb2ZmSWRdIC0gSGFuZG9mZiBsZWFzZSBpZC5cbiAgICogQHBhcmFtIHtzdHJpbmd9IFthcmdzLndvcmtlcklkXSAtIFdvcmtlciBpZC5cbiAgICogQHBhcmFtIHtudW1iZXJ9IFthcmdzLmhhbmRlZE9mZkF0TXNdIC0gSGFuZGVkIG9mZiB0aW1lc3RhbXAuXG4gICAqIEBwYXJhbSB7bnVtYmVyfSBbYXJncy5yZWNlaXZlZEF0TXNdIC0gRXBvY2ggbXMgdGhlIHJ1bm5lciBjaGlsZCByZWNlaXZlZCB0aGUgam9iLlxuICAgKiBAcGFyYW0ge251bWJlcn0gW2FyZ3Muc3RhcnRlZEF0TXNdIC0gRXBvY2ggbXMgdGhlIGpvYidzIHBlcmZvcm0gc3RhcnRlZCBpbiB0aGUgY2hpbGQuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBbYXJncy5jaGlsZEluc3RhbmNlSWRdIC0gU3RhYmxlIHBvb2xlZCBjaGlsZCBpZGVudGl0eS5cbiAgICogQHBhcmFtIHtudW1iZXJ9IFthcmdzLmNoaWxkUGlkXSAtIFBvb2xlZCBjaGlsZCBPUyBwaWQuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPGJvb2xlYW4+fSAtIFdoZXRoZXIgdGhlIGZlbmNlZCByZXBvcnQgd2FzIGFjY2VwdGVkLlxuICAgKi9cbiAgYXN5bmMgbWFya0NoaWxkQWNjZXB0ZWQoe2pvYklkLCBoYW5kb2ZmSWQsIHdvcmtlcklkLCBoYW5kZWRPZmZBdE1zLCByZWNlaXZlZEF0TXMsIHN0YXJ0ZWRBdE1zLCBjaGlsZEluc3RhbmNlSWQsIGNoaWxkUGlkfSkge1xuICAgIGF3YWl0IHRoaXMuZW5zdXJlUmVhZHkoKVxuXG4gICAgcmV0dXJuIGF3YWl0IHRoaXMuX3NlcmlhbGl6ZWRDb25uZWN0aW9uTXV0YXRpb24oYXN5bmMgKGRiKSA9PiB7XG4gICAgICBjb25zdCBqb2IgPSBhd2FpdCB0aGlzLl9nZXRKb2JSb3dCeUlkKGRiLCBqb2JJZClcblxuICAgICAgaWYgKCFqb2IpIHJldHVybiBmYWxzZVxuICAgICAgaWYgKCF0aGlzLl9zaG91bGRBY2NlcHRSZXBvcnQoe2pvYiwgaGFuZG9mZklkLCB3b3JrZXJJZCwgaGFuZGVkT2ZmQXRNc30pKSByZXR1cm4gZmFsc2VcblxuICAgICAgY29uc3QgZGF0YSA9IHt9XG4gICAgICBpZiAodHlwZW9mIHJlY2VpdmVkQXRNcyA9PT0gXCJudW1iZXJcIikgZGF0YS5jaGlsZF9yZWNlaXZlZF9hdF9tcyA9IHJlY2VpdmVkQXRNc1xuICAgICAgaWYgKHR5cGVvZiBzdGFydGVkQXRNcyA9PT0gXCJudW1iZXJcIikgZGF0YS5jaGlsZF9zdGFydGVkX2F0X21zID0gc3RhcnRlZEF0TXNcbiAgICAgIGlmICh0eXBlb2YgY2hpbGRJbnN0YW5jZUlkID09PSBcInN0cmluZ1wiKSBkYXRhLmNoaWxkX2luc3RhbmNlX2lkID0gY2hpbGRJbnN0YW5jZUlkXG4gICAgICBpZiAodHlwZW9mIGNoaWxkUGlkID09PSBcIm51bWJlclwiKSBkYXRhLmNoaWxkX3BpZCA9IGNoaWxkUGlkXG4gICAgICBpZiAoT2JqZWN0LmtleXMoZGF0YSkubGVuZ3RoID09PSAwKSByZXR1cm4gZmFsc2VcblxuICAgICAgY29uc3QgYWZmZWN0ZWRSb3dzID0gYXdhaXQgdGhpcy5fdXBkYXRlQWZmZWN0ZWRSb3dzKGRiLCB7XG4gICAgICAgIHRhYmxlTmFtZTogSk9CU19UQUJMRSxcbiAgICAgICAgZGF0YSxcbiAgICAgICAgY29uZGl0aW9uczogdGhpcy5fYWN0aXZlSGFuZG9mZkNvbmRpdGlvbnMoam9iKVxuICAgICAgfSlcblxuICAgICAgcmV0dXJuIGFmZmVjdGVkUm93cyA9PT0gMVxuICAgIH0pXG4gIH1cblxuICAvKipcbiAgICogUmV0dXJucyB0aGUgZGF0YWJhc2UgZGF0YSB0aGF0IGNsZWFycyBwb29sZWQtY2hpbGQgYWNjZXB0YW5jZSBldmlkZW5jZS5cbiAgICogQHJldHVybnMge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gLSBDbGVhcmVkIGFjY2VwdGFuY2UgY29sdW1ucy5cbiAgICovXG4gIF9jbGVhcmVkQ2hpbGRBY2NlcHRhbmNlRGF0YSgpIHtcbiAgICByZXR1cm4ge2NoaWxkX2luc3RhbmNlX2lkOiBudWxsLCBjaGlsZF9waWQ6IG51bGwsIGNoaWxkX3JlY2VpdmVkX2F0X21zOiBudWxsLCBjaGlsZF9zdGFydGVkX2F0X21zOiBudWxsfVxuICB9XG5cbiAgLyoqXG4gICAqIFJldHVybnMgdGhlIHJvdy1zaGFwZSBjb3VudGVycGFydCBvZiB0aGUgY2xlYXJlZCBhY2NlcHRhbmNlIGNvbHVtbnMuXG4gICAqIEByZXR1cm5zIHtQaWNrPGltcG9ydChcIi4vdHlwZXMuanNcIikuQmFja2dyb3VuZEpvYlJvdywgXCJjaGlsZEluc3RhbmNlSWRcIiB8IFwiY2hpbGRQaWRcIiB8IFwiY2hpbGRSZWNlaXZlZEF0TXNcIiB8IFwiY2hpbGRTdGFydGVkQXRNc1wiPn0gLSBDbGVhcmVkIGFjY2VwdGFuY2UgZmllbGRzLlxuICAgKi9cbiAgX2NsZWFyZWRDaGlsZEFjY2VwdGFuY2VSb3coKSB7XG4gICAgcmV0dXJuIHtjaGlsZEluc3RhbmNlSWQ6IG51bGwsIGNoaWxkUGlkOiBudWxsLCBjaGlsZFJlY2VpdmVkQXRNczogbnVsbCwgY2hpbGRTdGFydGVkQXRNczogbnVsbH1cbiAgfVxuXG4gIC8qKlxuICAgKiBSZXR1cm5zIGFuIGFjdGl2ZSBoYW5kb2ZmIHRvIHRoZSBxdWV1ZSBhdCBhIGNhbGxlci1yZXF1ZXN0ZWQgZnV0dXJlIHRpbWUuXG4gICAqIFRoaXMgaXMgbm9ybWFsIGpvYiBjb250cm9sIGZsb3c6IGl0IHByZXNlcnZlcyBmYWlsdXJlIGF0dGVtcHRzIGFuZCBtZXRhZGF0YS5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBPcHRpb25zLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gYXJncy5qb2JJZCAtIEpvYiBpZC5cbiAgICogQHBhcmFtIHtudW1iZXJ9IGFyZ3MuZGVsYXlNcyAtIERlbGF5IGZyb20gcGVyc2lzdGVuY2UgdGltZSBpbiBtaWxsaXNlY29uZHMuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBbYXJncy5oYW5kb2ZmSWRdIC0gSGFuZG9mZiBsZWFzZSBpZC5cbiAgICogQHBhcmFtIHtzdHJpbmd9IFthcmdzLndvcmtlcklkXSAtIFdvcmtlciBpZC5cbiAgICogQHBhcmFtIHtudW1iZXJ9IFthcmdzLmhhbmRlZE9mZkF0TXNdIC0gSGFuZGVkIG9mZiB0aW1lc3RhbXAuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPGJvb2xlYW4+fSAtIFdoZXRoZXIgdGhlIGZlbmNlZCByZXBvcnQgd2FzIGFjY2VwdGVkLlxuICAgKi9cbiAgYXN5bmMgbWFya1Jlc2NoZWR1bGVkKHtqb2JJZCwgZGVsYXlNcywgaGFuZG9mZklkLCB3b3JrZXJJZCwgaGFuZGVkT2ZmQXRNc30pIHtcbiAgICBhd2FpdCB0aGlzLmVuc3VyZVJlYWR5KClcbiAgICB0aGlzLl92YWxpZGF0ZVJlc2NoZWR1bGVEZWxheU1zKGRlbGF5TXMpXG5cbiAgICByZXR1cm4gYXdhaXQgdGhpcy5fc2VyaWFsaXplZENvdW50TXV0YXRpb24oYXN5bmMgKGRiKSA9PiB7XG4gICAgICBjb25zdCBqb2IgPSBhd2FpdCB0aGlzLl9nZXRKb2JSb3dCeUlkKGRiLCBqb2JJZClcblxuICAgICAgaWYgKCFqb2IpIHJldHVybiBmYWxzZVxuICAgICAgaWYgKCF0aGlzLl9zaG91bGRBY2NlcHRSZXBvcnQoe2pvYiwgaGFuZG9mZklkLCB3b3JrZXJJZCwgaGFuZGVkT2ZmQXRNc30pKSByZXR1cm4gZmFsc2VcblxuICAgICAgYXdhaXQgdGhpcy5fbG9ja0NvbmN1cnJlbmN5Um93KGRiLCBqb2IuY29uY3VycmVuY3lLZXkpXG4gICAgICBjb25zdCBzY2hlZHVsZWRBdE1zID0gdGhpcy5fcmVzY2hlZHVsZWRBdE1zKGRlbGF5TXMpXG4gICAgICBjb25zdCBhZmZlY3RlZFJvd3MgPSBhd2FpdCB0aGlzLl91cGRhdGVBZmZlY3RlZFJvd3MoZGIsIHtcbiAgICAgICAgdGFibGVOYW1lOiBKT0JTX1RBQkxFLFxuICAgICAgICBkYXRhOiB7XG4gICAgICAgICAgc3RhdHVzOiBcInF1ZXVlZFwiLFxuICAgICAgICAgIHNjaGVkdWxlZF9hdF9tczogc2NoZWR1bGVkQXRNcyxcbiAgICAgICAgICBoYW5kZWRfb2ZmX2F0X21zOiBudWxsLFxuICAgICAgICAgIGhhbmRvZmZfaWQ6IG51bGwsXG4gICAgICAgICAgd29ya2VyX2lkOiBudWxsLFxuICAgICAgICAgIC4uLnRoaXMuX2NsZWFyZWRDaGlsZEFjY2VwdGFuY2VEYXRhKClcbiAgICAgICAgfSxcbiAgICAgICAgY29uZGl0aW9uczogdGhpcy5fYWN0aXZlSGFuZG9mZkNvbmRpdGlvbnMoam9iKVxuICAgICAgfSlcblxuICAgICAgaWYgKGFmZmVjdGVkUm93cyAhPT0gMSkgcmV0dXJuIGZhbHNlXG4gICAgICBhd2FpdCB0aGlzLl9yZWxlYXNlQ29uY3VycmVuY3koZGIsIGpvYi5jb25jdXJyZW5jeUtleSlcbiAgICAgIGF3YWl0IHRoaXMuX3JlY29yZFN0YXR1c1RyYW5zaXRpb24oZGIsIFwiaGFuZGVkX29mZlwiLCBcInF1ZXVlZFwiKVxuICAgICAgcmV0dXJuIHRydWVcbiAgICB9KVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgbWFyayByZXR1cm5lZCB0byBxdWV1ZS5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBPcHRpb25zLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gYXJncy5qb2JJZCAtIEpvYiBpZC5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGFyZ3MuaGFuZG9mZklkIC0gSGFuZG9mZiBsZWFzZSBpZC5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgd2hlbiB1cGRhdGVkLlxuICAgKi9cbiAgYXN5bmMgbWFya1JldHVybmVkVG9RdWV1ZSh7am9iSWQsIGhhbmRvZmZJZH0pIHtcbiAgICBhd2FpdCB0aGlzLmVuc3VyZVJlYWR5KClcblxuICAgIGF3YWl0IHRoaXMuX3NlcmlhbGl6ZWRDb3VudE11dGF0aW9uKGFzeW5jIChkYikgPT4ge1xuICAgICAgY29uc3Qgam9iID0gYXdhaXQgdGhpcy5fZ2V0Sm9iUm93QnlJZChkYiwgam9iSWQpXG4gICAgICBpZiAoIWpvYiB8fCBqb2IuaGFuZG9mZklkICE9PSBoYW5kb2ZmSWQgfHwgam9iLnN0YXR1cyAhPT0gXCJoYW5kZWRfb2ZmXCIpIHJldHVyblxuICAgICAgYXdhaXQgdGhpcy5fbG9ja0NvbmN1cnJlbmN5Um93KGRiLCBqb2IuY29uY3VycmVuY3lLZXkpXG4gICAgICBjb25zdCBhZmZlY3RlZFJvd3MgPSBhd2FpdCB0aGlzLl91cGRhdGVBZmZlY3RlZFJvd3MoZGIsIHtcbiAgICAgICAgdGFibGVOYW1lOiBKT0JTX1RBQkxFLFxuICAgICAgICBkYXRhOiB7XG4gICAgICAgICAgc3RhdHVzOiBcInF1ZXVlZFwiLFxuICAgICAgICAgIHNjaGVkdWxlZF9hdF9tczogdGhpcy5jbG9jay5ub3coKSxcbiAgICAgICAgICBoYW5kZWRfb2ZmX2F0X21zOiBudWxsLFxuICAgICAgICAgIGhhbmRvZmZfaWQ6IG51bGwsXG4gICAgICAgICAgd29ya2VyX2lkOiBudWxsLFxuICAgICAgICAgIC4uLnRoaXMuX2NsZWFyZWRDaGlsZEFjY2VwdGFuY2VEYXRhKClcbiAgICAgICAgfSxcbiAgICAgICAgY29uZGl0aW9uczoge2hhbmRvZmZfaWQ6IGhhbmRvZmZJZCwgaWQ6IGpvYklkLCBzdGF0dXM6IFwiaGFuZGVkX29mZlwifVxuICAgICAgfSlcbiAgICAgIGlmIChhZmZlY3RlZFJvd3MgPT09IDEpIHtcbiAgICAgICAgYXdhaXQgdGhpcy5fcmVsZWFzZUNvbmN1cnJlbmN5KGRiLCBqb2IuY29uY3VycmVuY3lLZXkpXG4gICAgICAgIGF3YWl0IHRoaXMuX3JlY29yZFN0YXR1c1RyYW5zaXRpb24oZGIsIFwiaGFuZGVkX29mZlwiLCBcInF1ZXVlZFwiKVxuICAgICAgfVxuICAgIH0pXG4gIH1cblxuICAvKipcbiAgICogUmV0dXJucyB0aGUgYWN0aXZlIGBoYW5kZWRfb2ZmYCBqb2JzIChqb2JJZCArIGhhbmRvZmZJZCkgaGVsZCB1bmRlciBhIHdvcmtlclxuICAgKiBpZC4gVXNlZCBvbiB3b3JrZXIgcmVjb25uZWN0OiBhZnRlciBhIG1haW4gcmVzdGFydCBhIHdvcmtlciByZWNvbm5lY3RzIHdpdGhcbiAgICogaXRzIHN0YWJsZSBpZCwgYW5kIHRoZSBmcmVzaCBtYWluIGFkb3B0cyB0aGVzZSBsZWFzZXMgc28gdGhleSBhcmUgdHJhY2tlZCDigJRcbiAgICogYW5kIHJlbGVhc2VkIGlmIHRoZSByZWNvbm5lY3RlZCB3b3JrZXIgbGF0ZXIgZGlzY29ubmVjdHMg4oCUIGluc3RlYWQgb2ZcbiAgICogc2l0dGluZyBzdHVjayB1bnRpbCB0aGUgYWdlLWJhc2VkIG9ycGhhbiBzd2VlcC4gVGhpcyBuZXZlciByZWNsYWltcywgc28gYVxuICAgKiBncmFjZWZ1bGx5LWRyYWluaW5nIHdvcmtlciB0aGF0IGtlZXBzIHJ1bm5pbmcgaXRzIGluLWZsaWdodCBqb2JzIGlzIGxlZnRcbiAgICogdW50b3VjaGVkLiBSb3dzIHdpdGggYSBudWxsIGhhbmRvZmYgaWQgKGxlZ2FjeSkgYXJlIHNraXBwZWQ7IHRoZSBvcnBoYW5cbiAgICogc3dlZXAgcmVjbGFpbXMgdGhvc2UgdmlhIGl0cyBgaGFuZGVkX29mZl9hdF9tc2AgZmVuY2UuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gT3B0aW9ucy5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGFyZ3Mud29ya2VySWQgLSBXb3JrZXIgaWQuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPEFycmF5PHtqb2JJZDogc3RyaW5nLCBoYW5kb2ZmSWQ6IHN0cmluZ30+Pn0gLSBBY3RpdmUgaGFuZG9mZnMuXG4gICAqL1xuICBhc3luYyBoYW5kZWRPZmZKb2JzRm9yV29ya2VyKHt3b3JrZXJJZH0pIHtcbiAgICBhd2FpdCB0aGlzLmVuc3VyZVJlYWR5KClcblxuICAgIGNvbnN0IHJvd3MgPSBhd2FpdCB0aGlzLl93aXRoRGIoYXN5bmMgKGRiKSA9PlxuICAgICAgYXdhaXQgZGIubmV3UXVlcnkoKS5mcm9tKEpPQlNfVEFCTEUpLndoZXJlKHtzdGF0dXM6IFwiaGFuZGVkX29mZlwiLCB3b3JrZXJfaWQ6IHdvcmtlcklkfSkucmVzdWx0cygpXG4gICAgKVxuXG4gICAgLyoqIEB0eXBlIHtBcnJheTx7am9iSWQ6IHN0cmluZywgaGFuZG9mZklkOiBzdHJpbmd9Pn0gKi9cbiAgICBjb25zdCBoYW5kb2ZmcyA9IFtdXG5cbiAgICBmb3IgKGNvbnN0IHJvdyBvZiByb3dzKSB7XG4gICAgICBjb25zdCBqb2IgPSB0aGlzLl9ub3JtYWxpemVKb2JSb3cocm93KVxuXG4gICAgICBpZiAoam9iLmhhbmRvZmZJZCkgaGFuZG9mZnMucHVzaCh7am9iSWQ6IGpvYi5pZCwgaGFuZG9mZklkOiBqb2IuaGFuZG9mZklkfSlcbiAgICB9XG5cbiAgICByZXR1cm4gaGFuZG9mZnNcbiAgfVxuXG4gIC8qKlxuICAgKiBTbmFwc2hvdHMgZXhhY3QsIGxlYXNlLWF3YXJlIGFjdGl2ZSBoYW5kb2ZmcyBiZWZvcmUgYSBuZXcgbWFpbiBnZW5lcmF0aW9uXG4gICAqIHN0YXJ0cyBhY2NlcHRpbmcgd29ya2VyIHJlY29ubmVjdHMuIExlZ2FjeSByb3dzIHdpdGhvdXQgYSBjb21wbGV0ZSB3b3JrZXIsXG4gICAqIGxlYXNlLCBhbmQgdGltZXN0YW1wIGlkZW50aXR5IHN0YXkgb3duZWQgYnkgdGhlIGFnZS1iYXNlZCBvcnBoYW4gc3dlZXAuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPGltcG9ydChcIi4vdHlwZXMuanNcIikuQmFja2dyb3VuZEpvYkhhbmRvZmZTbmFwc2hvdFtdPn0gLSBFeGFjdCBzdGFydHVwIGhhbmRvZmZzLlxuICAgKi9cbiAgYXN5bmMgc25hcHNob3RIYW5kZWRPZmZKb2JzKCkge1xuICAgIGF3YWl0IHRoaXMuZW5zdXJlUmVhZHkoKVxuXG4gICAgY29uc3Qgcm93cyA9IGF3YWl0IHRoaXMuX3dpdGhEYihhc3luYyAoZGIpID0+IGF3YWl0IGRiXG4gICAgICAubmV3UXVlcnkoKVxuICAgICAgLmZyb20oSk9CU19UQUJMRSlcbiAgICAgIC53aGVyZSh7c3RhdHVzOiBcImhhbmRlZF9vZmZcIn0pXG4gICAgICAub3JkZXIoXCJjcmVhdGVkX2F0X21zIEFTQ1wiKVxuICAgICAgLm9yZGVyKFwiaWQgQVNDXCIpXG4gICAgICAucmVzdWx0cygpKVxuICAgIC8qKiBAdHlwZSB7aW1wb3J0KFwiLi90eXBlcy5qc1wiKS5CYWNrZ3JvdW5kSm9iSGFuZG9mZlNuYXBzaG90W119ICovXG4gICAgY29uc3QgaGFuZG9mZnMgPSBbXVxuXG4gICAgZm9yIChjb25zdCByb3cgb2Ygcm93cykge1xuICAgICAgY29uc3Qgam9iID0gdGhpcy5fbm9ybWFsaXplSm9iUm93KHJvdylcblxuICAgICAgaWYgKCFqb2IuaGFuZG9mZklkIHx8ICFqb2Iud29ya2VySWQgfHwgdHlwZW9mIGpvYi5oYW5kZWRPZmZBdE1zICE9PSBcIm51bWJlclwiKSBjb250aW51ZVxuXG4gICAgICBoYW5kb2Zmcy5wdXNoKHtcbiAgICAgICAgaGFuZGVkT2ZmQXRNczogam9iLmhhbmRlZE9mZkF0TXMsXG4gICAgICAgIGhhbmRvZmZJZDogam9iLmhhbmRvZmZJZCxcbiAgICAgICAgam9iSWQ6IGpvYi5pZCxcbiAgICAgICAgd29ya2VySWQ6IGpvYi53b3JrZXJJZFxuICAgICAgfSlcbiAgICB9XG5cbiAgICByZXR1cm4gaGFuZG9mZnNcbiAgfVxuXG4gIC8qKlxuICAgKiBSZWNsYWltcyBvbmx5IHVuY2hhbmdlZCBleGFjdCBoYW5kb2ZmcyBzZWxlY3RlZCBieSBhIG1haW4tZ2VuZXJhdGlvbiBzdGFydHVwXG4gICAqIHNuYXBzaG90LiBUaGUgb3JkaW5hcnkgb3JwaGFuIGZhaWx1cmUgcGF0aCBvd25zIHJldHJpZXMsIHRlcm1pbmFsIHN0YXR1cyxcbiAgICogY291bnQgdHJhbnNpdGlvbnMsIHNjaGVkdWxlIG93bmVyc2hpcCwgYW5kIGNvbmN1cnJlbmN5IHJlbGVhc2UuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gT3B0aW9ucy5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL3R5cGVzLmpzXCIpLkJhY2tncm91bmRKb2JIYW5kb2ZmU25hcHNob3RbXX0gYXJncy5oYW5kb2ZmcyAtIEV4YWN0IHN0YXJ0dXAgc25hcHNob3RzLlxuICAgKiBAcGFyYW0ge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSBhcmdzLmVycm9yIC0gT3JwaGFuIHJlYXNvbi5cbiAgICogQHJldHVybnMge1Byb21pc2U8aW1wb3J0KFwiLi90eXBlcy5qc1wiKS5CYWNrZ3JvdW5kSm9iUm93W10+fSAtIEFjY2VwdGVkIHRyYW5zaXRpb25zLlxuICAgKi9cbiAgYXN5bmMgbWFya09ycGhhbmVkSGFuZG9mZnMoe2hhbmRvZmZzLCBlcnJvcn0pIHtcbiAgICBhd2FpdCB0aGlzLmVuc3VyZVJlYWR5KClcblxuICAgIHJldHVybiBhd2FpdCB0aGlzLl9zZXJpYWxpemVkQ291bnRNdXRhdGlvbihhc3luYyAoZGIpID0+IHtcbiAgICAgIC8qKiBAdHlwZSB7QmFja2dyb3VuZEpvYk9ycGhhblNlbGVjdGlvbltdfSAqL1xuICAgICAgY29uc3Qgc2VsZWN0aW9ucyA9IFtdXG5cbiAgICAgIGZvciAoY29uc3QgaGFuZG9mZiBvZiBoYW5kb2Zmcykge1xuICAgICAgICBjb25zdCBqb2IgPSBhd2FpdCB0aGlzLl9nZXRKb2JSb3dCeUlkKGRiLCBoYW5kb2ZmLmpvYklkKVxuXG4gICAgICAgIGlmICgham9iIHx8IGpvYi5zdGF0dXMgIT09IFwiaGFuZGVkX29mZlwiKSBjb250aW51ZVxuICAgICAgICBpZiAoam9iLmhhbmRvZmZJZCAhPT0gaGFuZG9mZi5oYW5kb2ZmSWQpIGNvbnRpbnVlXG4gICAgICAgIGlmIChqb2Iud29ya2VySWQgIT09IGhhbmRvZmYud29ya2VySWQpIGNvbnRpbnVlXG4gICAgICAgIGlmIChqb2IuaGFuZGVkT2ZmQXRNcyAhPT0gaGFuZG9mZi5oYW5kZWRPZmZBdE1zKSBjb250aW51ZVxuXG4gICAgICAgIHNlbGVjdGlvbnMucHVzaCh7XG4gICAgICAgICAgY29uZGl0aW9uczoge1xuICAgICAgICAgICAgaGFuZGVkX29mZl9hdF9tczogaGFuZG9mZi5oYW5kZWRPZmZBdE1zLFxuICAgICAgICAgICAgaGFuZG9mZl9pZDogaGFuZG9mZi5oYW5kb2ZmSWQsXG4gICAgICAgICAgICBpZDogaGFuZG9mZi5qb2JJZCxcbiAgICAgICAgICAgIHN0YXR1czogXCJoYW5kZWRfb2ZmXCIsXG4gICAgICAgICAgICB3b3JrZXJfaWQ6IGhhbmRvZmYud29ya2VySWRcbiAgICAgICAgICB9LFxuICAgICAgICAgIGpvYlxuICAgICAgICB9KVxuICAgICAgfVxuXG4gICAgICByZXR1cm4gYXdhaXQgdGhpcy5fbWFya09ycGhhblNlbGVjdGlvbnMoe2RiLCBlcnJvciwgc2VsZWN0aW9uc30pXG4gICAgfSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIG1hcmsgZmFpbGVkLlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIE9wdGlvbnMuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBhcmdzLmpvYklkIC0gSm9iIGlkLlxuICAgKiBAcGFyYW0ge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSBhcmdzLmVycm9yIC0gRXJyb3IuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBbYXJncy5oYW5kb2ZmSWRdIC0gSGFuZG9mZiBsZWFzZSBpZC5cbiAgICogQHBhcmFtIHtzdHJpbmd9IFthcmdzLndvcmtlcklkXSAtIFdvcmtlciBpZC5cbiAgICogQHBhcmFtIHtudW1iZXJ9IFthcmdzLmhhbmRlZE9mZkF0TXNdIC0gSGFuZGVkIG9mZiB0aW1lc3RhbXAuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPGltcG9ydChcIi4vdHlwZXMuanNcIikuQmFja2dyb3VuZEpvYlJvdyB8IG51bGw+fSAtIFVwZGF0ZWQgam9iIHJvdyB3aGVuIHRoZSByZXBvcnQgd2FzIGFjY2VwdGVkLlxuICAgKi9cbiAgYXN5bmMgbWFya0ZhaWxlZCh7am9iSWQsIGVycm9yLCBoYW5kb2ZmSWQsIHdvcmtlcklkLCBoYW5kZWRPZmZBdE1zfSkge1xuICAgIGF3YWl0IHRoaXMuZW5zdXJlUmVhZHkoKVxuXG4gICAgcmV0dXJuIGF3YWl0IHRoaXMuX3NlcmlhbGl6ZWRDb3VudE11dGF0aW9uKGFzeW5jIChkYikgPT4ge1xuICAgICAgY29uc3Qgam9iID0gYXdhaXQgdGhpcy5fZ2V0Sm9iUm93QnlJZChkYiwgam9iSWQpXG5cbiAgICAgIGlmICgham9iKSByZXR1cm4gbnVsbFxuICAgICAgaWYgKCF0aGlzLl9zaG91bGRBY2NlcHRSZXBvcnQoe2pvYiwgaGFuZG9mZklkLCB3b3JrZXJJZCwgaGFuZGVkT2ZmQXRNc30pKSByZXR1cm4gbnVsbFxuXG4gICAgICBjb25zdCB1cGRhdGVkSm9iID0gYXdhaXQgdGhpcy5fYXBwbHlGYWlsdXJlKHtkYiwgam9iLCBlcnJvciwgbWFya09ycGhhbmVkOiBmYWxzZX0pXG5cbiAgICAgIGlmICh1cGRhdGVkSm9iKSBhd2FpdCB0aGlzLl9yZWNvcmRTdGF0dXNUcmFuc2l0aW9uKGRiLCBqb2Iuc3RhdHVzLCB1cGRhdGVkSm9iLnN0YXR1cylcbiAgICAgIHJldHVybiB1cGRhdGVkSm9iXG4gICAgfSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIG1hcmsgb3JwaGFuZWQgam9icy5cbiAgICogQHBhcmFtIHtvYmplY3R9IFthcmdzXSAtIE9wdGlvbnMuXG4gICAqIEBwYXJhbSB7bnVtYmVyfSBbYXJncy5vcnBoYW5lZEFmdGVyTXNdIC0gTWFyayBqb2JzIG9ycGhhbmVkIGFmdGVyIHRoaXMgZHVyYXRpb24uXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPGltcG9ydChcIi4vdHlwZXMuanNcIikuQmFja2dyb3VuZEpvYlJvd1tdPn0gLSBUaGUgam9icyB0aGlzIHN3ZWVwIG1hcmtlZCBvcnBoYW5lZC5cbiAgICovXG4gIGFzeW5jIG1hcmtPcnBoYW5lZEpvYnMoe29ycGhhbmVkQWZ0ZXJNcyA9IE9SUEhBTkVEX0FGVEVSX01TfSA9IHt9KSB7XG4gICAgYXdhaXQgdGhpcy5lbnN1cmVSZWFkeSgpXG5cbiAgICByZXR1cm4gYXdhaXQgdGhpcy5fc2VyaWFsaXplZENvdW50TXV0YXRpb24oYXN5bmMgKGRiKSA9PiB7XG4gICAgICBjb25zdCBjdXRvZmYgPSB0aGlzLmNsb2NrLm5vdygpIC0gb3JwaGFuZWRBZnRlck1zXG4gICAgICBjb25zdCBxdWVyeSA9IGRiXG4gICAgICAgIC5uZXdRdWVyeSgpXG4gICAgICAgIC5mcm9tKEpPQlNfVEFCTEUpXG4gICAgICAgIC53aGVyZSh7c3RhdHVzOiBcImhhbmRlZF9vZmZcIn0pXG4gICAgICAgIC53aGVyZShgaGFuZGVkX29mZl9hdF9tcyA8PSAke2RiLnF1b3RlKGN1dG9mZil9YClcblxuICAgICAgY29uc3Qgcm93cyA9IGF3YWl0IHF1ZXJ5LnJlc3VsdHMoKVxuXG4gICAgICAvKiogQHR5cGUge0JhY2tncm91bmRKb2JPcnBoYW5TZWxlY3Rpb25bXX0gKi9cbiAgICAgIGNvbnN0IHNlbGVjdGlvbnMgPSBbXVxuXG4gICAgICBmb3IgKGNvbnN0IHJvdyBvZiByb3dzKSB7XG4gICAgICAgIGNvbnN0IGpvYiA9IHRoaXMuX25vcm1hbGl6ZUpvYlJvdyhyb3cpXG5cbiAgICAgICAgLy8gRmVuY2UgdGhlIHJlY2xhaW0gb24gdGhlIGV4YWN0IGhhbmRvZmYgdGhpcyBzd2VlcCBzZWxlY3RlZCwgdXNpbmcgaXRzXG4gICAgICAgIC8vIGBoYW5kZWRfb2ZmX2F0X21zYCByYXRoZXIgdGhhbiBpdHMgYGhhbmRvZmZfaWRgLiBUd28gcmVhc29uczpcbiAgICAgICAgLy8gICAxLiBOdWxsLXNhZmUuIFNvbWUgcm93cyBoYXZlIGEgbnVsbCBgaGFuZG9mZl9pZGAgKGhhbmRlZCBvZmYgYnkgYW5cbiAgICAgICAgLy8gICAgICBvbGRlciB2ZWxvY2lvdXMgYmVmb3JlIGhhbmRvZmYtaWQgZmVuY2luZykuIGB7aGFuZG9mZl9pZDogbnVsbH1gXG4gICAgICAgIC8vICAgICAgcmVuZGVycyBhcyBgaGFuZG9mZl9pZCA9IE5VTExgLCB3aGljaCBtYXRjaGVzIG5vdGhpbmcsIHNvIHRob3NlXG4gICAgICAgIC8vICAgICAgcm93cyB3b3VsZCBiZSBzdHJhbmRlZCBpbiBgaGFuZGVkX29mZmAgZm9yZXZlci5cbiAgICAgICAgLy8gICAyLiBSYWNlLXNhZmUuIElmIHRoZSByb3cgaXMgcmV0dXJuZWQgdG8gdGhlIHF1ZXVlIGFuZCByZS1oYW5kZWQtb2ZmXG4gICAgICAgIC8vICAgICAgYmV0d2VlbiB0aGUgU0VMRUNUIGFib3ZlIGFuZCB0aGlzIHVwZGF0ZSwgaXQgZ2V0cyBhIGZyZXNoXG4gICAgICAgIC8vICAgICAgYGhhbmRlZF9vZmZfYXRfbXNgIChhbHdheXMgXCJub3dcIiksIHNvIHRoaXMgc3RhbGUgY3V0b2ZmLWVyYVxuICAgICAgICAvLyAgICAgIHRpbWVzdGFtcCBubyBsb25nZXIgbWF0Y2hlcyBhbmQgd2Ugd29uJ3QgZmFpbC9vcnBoYW4g4oCUIG9yXG4gICAgICAgIC8vICAgICAgd3JvbmdseSByZWxlYXNlIHRoZSBjb25jdXJyZW5jeSByZXNlcnZhdGlvbiBvZiDigJQgdGhhdCBuZXcgbGVhc2UuXG4gICAgICAgIC8vIGBoYW5kZWRfb2ZmX2F0X21zYCBpcyBhbHdheXMgc2V0IG9uIGEgaGFuZGVkLW9mZiByb3cgKGFuZCB0aGUgU0VMRUNUXG4gICAgICAgIC8vIHJlcXVpcmVkIGl0IGA8PSBjdXRvZmZgKSwgc28gaXQgaXMgYSByZWxpYWJsZSBudWxsLXNhZmUgbGVhc2UgcGluLlxuICAgICAgICBzZWxlY3Rpb25zLnB1c2goe1xuICAgICAgICAgIGNvbmRpdGlvbnM6IHtpZDogam9iLmlkLCBzdGF0dXM6IFwiaGFuZGVkX29mZlwiLCBoYW5kZWRfb2ZmX2F0X21zOiBqb2IuaGFuZGVkT2ZmQXRNc30sXG4gICAgICAgICAgam9iXG4gICAgICAgIH0pXG4gICAgICB9XG5cbiAgICAgIHJldHVybiBhd2FpdCB0aGlzLl9tYXJrT3JwaGFuU2VsZWN0aW9ucyh7XG4gICAgICAgIGRiLFxuICAgICAgICBlcnJvcjogXCJKb2Igb3JwaGFuZWQgYWZ0ZXIgdGltZW91dFwiLFxuICAgICAgICBzZWxlY3Rpb25zXG4gICAgICB9KVxuICAgIH0pXG4gIH1cblxuICAvKipcbiAgICogQXBwbGllcyB0aGUgY29tbW9uIGZlbmNlZCBvcnBoYW4gdHJhbnNpdGlvbiBhbmQgcmVjb3JkcyBvbmUgYWdncmVnYXRlIGNvdW50XG4gICAqIGRlbHRhIGZvciB0aGUgYWNjZXB0ZWQgcm93cy5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBPcHRpb25zLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL2RhdGFiYXNlL2RyaXZlcnMvYmFzZS5qc1wiKS5kZWZhdWx0fSBhcmdzLmRiIC0gVHJhbnNhY3Rpb24gY29ubmVjdGlvbi5cbiAgICogQHBhcmFtIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gYXJncy5lcnJvciAtIE9ycGhhbiByZWFzb24uXG4gICAqIEBwYXJhbSB7QmFja2dyb3VuZEpvYk9ycGhhblNlbGVjdGlvbltdfSBhcmdzLnNlbGVjdGlvbnMgLSBTZWxlY3RlZCBoYW5kb2ZmcyBhbmQgZXhhY3QgZmVuY2VzLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxpbXBvcnQoXCIuL3R5cGVzLmpzXCIpLkJhY2tncm91bmRKb2JSb3dbXT59IC0gQWNjZXB0ZWQgdHJhbnNpdGlvbnMuXG4gICAqL1xuICBhc3luYyBfbWFya09ycGhhblNlbGVjdGlvbnMoe2RiLCBlcnJvciwgc2VsZWN0aW9uc30pIHtcbiAgICAvKiogQHR5cGUge2ltcG9ydChcIi4vdHlwZXMuanNcIikuQmFja2dyb3VuZEpvYlJvd1tdfSAqL1xuICAgIGNvbnN0IG9ycGhhbmVkSm9icyA9IFtdXG5cbiAgICBmb3IgKGNvbnN0IHtjb25kaXRpb25zLCBqb2J9IG9mIHNlbGVjdGlvbnMpIHtcbiAgICAgIGNvbnN0IG9ycGhhbmVkSm9iID0gYXdhaXQgdGhpcy5fYXBwbHlGYWlsdXJlKHtcbiAgICAgICAgY29uZGl0aW9ucyxcbiAgICAgICAgZGIsXG4gICAgICAgIGVycm9yLFxuICAgICAgICBqb2IsXG4gICAgICAgIG1hcmtPcnBoYW5lZDogdHJ1ZVxuICAgICAgfSlcblxuICAgICAgaWYgKG9ycGhhbmVkSm9iKSBvcnBoYW5lZEpvYnMucHVzaChvcnBoYW5lZEpvYilcbiAgICB9XG5cbiAgICBjb25zdCBzdGF0dXNDb3VudHMgPSB0aGlzLl9zdGF0dXNDb3VudHMob3JwaGFuZWRKb2JzKVxuICAgIGNvbnN0IGRlbHRhcyA9IHRoaXMuX2VtcHR5Q291bnRCdWNrZXRzKClcblxuICAgIGZvciAoY29uc3QgW3N0YXR1cywgY291bnRdIG9mIE9iamVjdC5lbnRyaWVzKHN0YXR1c0NvdW50cykpIHtcbiAgICAgIGRlbHRhcy5oYW5kZWRfb2ZmIC09IGNvdW50XG4gICAgICBkZWx0YXNbc3RhdHVzXSArPSBjb3VudFxuICAgIH1cbiAgICBhd2FpdCB0aGlzLl9yZWNvcmRDb3VudERlbHRhKGRiLCBkZWx0YXMpXG5cbiAgICByZXR1cm4gb3JwaGFuZWRKb2JzXG4gIH1cblxuICAvKipcbiAgICogRGVsZXRlcyB0ZXJtaW5hbCBqb2Igcm93cyBwYXN0IHRoZWlyIHJldGVudGlvbiB3aW5kb3cgc28gdGhlIGpvYnMgdGFibGVcbiAgICogZG9lcyBub3QgZ3JvdyB1bmJvdW5kZWQgKGNvbXBsZXRlZCByb3dzIGluIHBhcnRpY3VsYXIgYWNjdW11bGF0ZSBmb3JldmVyXG4gICAqIG90aGVyd2lzZSkuIEJhdGNoZWQgYnkgaWQg4oCUIFNFTEVDVCBhIHBhZ2Ugb2YgaWRzLCB0aGVuXG4gICAqIGBERUxFVEUgLi4uIFdIRVJFIGlkIElOICguLi4pYCDigJQgcmF0aGVyIHRoYW4gYERFTEVURSAuLi4gTElNSVRgLCB3aGljaCBub3RcbiAgICogZXZlcnkgZHJpdmVyIHN1cHBvcnRzOyBlYWNoIGJhdGNoIHJ1bnMgb24gaXRzIG93biBjb25uZWN0aW9uIHNvIHRoZSBzd2VlcFxuICAgKiB5aWVsZHMgYmV0d2VlbiBiYXRjaGVzIGluc3RlYWQgb2YgaG9sZGluZyBvbmUgbG9uZyB0cmFuc2FjdGlvbi5cbiAgICogQHBhcmFtIHtvYmplY3R9IFthcmdzXSAtIE9wdGlvbnMuXG4gICAqIEBwYXJhbSB7bnVtYmVyIHwgbnVsbH0gW2FyZ3MuY29tcGxldGVkVHRsTXNdIC0gRGVsZXRlIGBjb21wbGV0ZWRgIGpvYnMgd2hvc2UgYGNvbXBsZXRlZF9hdF9tc2AgaXMgb2xkZXIgdGhhbiB0aGlzIG1hbnkgbXMuIEZhbHN5IG9yIGA8PSAwYCBkaXNhYmxlcyBjb21wbGV0ZWQgcHJ1bmluZy5cbiAgICogQHBhcmFtIHtudW1iZXIgfCBudWxsfSBbYXJncy5mYWlsZWRUdGxNc10gLSBEZWxldGUgdGVybWluYWwgYGZhaWxlZGAvYG9ycGhhbmVkYCBqb2JzIG9sZGVyIHRoYW4gdGhpcyBtYW55IG1zIChieSBgZmFpbGVkX2F0X21zYC9gb3JwaGFuZWRfYXRfbXNgKS4gRmFsc3kgb3IgYDw9IDBgIGRpc2FibGVzLlxuICAgKiBAcGFyYW0ge251bWJlcn0gW2FyZ3MuYmF0Y2hTaXplXSAtIE1heCByb3dzIGRlbGV0ZWQgcGVyIGJhdGNoLiBEZWZhdWx0IGAxMDAwYC5cbiAgICogQHJldHVybnMge1Byb21pc2U8bnVtYmVyPn0gLSBUb3RhbCByb3dzIGRlbGV0ZWQuXG4gICAqL1xuICBhc3luYyBwcnVuZVRlcm1pbmFsSm9icyh7Y29tcGxldGVkVHRsTXMgPSBudWxsLCBmYWlsZWRUdGxNcyA9IG51bGwsIGJhdGNoU2l6ZSA9IDEwMDB9ID0ge30pIHtcbiAgICBhd2FpdCB0aGlzLmVuc3VyZVJlYWR5KClcblxuICAgIGNvbnN0IG5vdyA9IHRoaXMuY2xvY2subm93KClcbiAgICBjb25zdCBzaXplID0gYmF0Y2hTaXplID4gMCA/IGJhdGNoU2l6ZSA6IDEwMDBcbiAgICBsZXQgZGVsZXRlZCA9IDBcblxuICAgIGlmIChjb21wbGV0ZWRUdGxNcyAmJiBjb21wbGV0ZWRUdGxNcyA+IDApIHtcbiAgICAgIGRlbGV0ZWQgKz0gYXdhaXQgdGhpcy5fcHJ1bmVTdGF0dXNCYXRjaGVzKHtzdGF0dXM6IFwiY29tcGxldGVkXCIsIGNvbHVtbjogXCJjb21wbGV0ZWRfYXRfbXNcIiwgY3V0b2ZmOiBub3cgLSBjb21wbGV0ZWRUdGxNcywgYmF0Y2hTaXplOiBzaXplfSlcbiAgICB9XG5cbiAgICBpZiAoZmFpbGVkVHRsTXMgJiYgZmFpbGVkVHRsTXMgPiAwKSB7XG4gICAgICBkZWxldGVkICs9IGF3YWl0IHRoaXMuX3BydW5lU3RhdHVzQmF0Y2hlcyh7c3RhdHVzOiBcImZhaWxlZFwiLCBjb2x1bW46IFwiZmFpbGVkX2F0X21zXCIsIGN1dG9mZjogbm93IC0gZmFpbGVkVHRsTXMsIGJhdGNoU2l6ZTogc2l6ZX0pXG4gICAgICBkZWxldGVkICs9IGF3YWl0IHRoaXMuX3BydW5lU3RhdHVzQmF0Y2hlcyh7c3RhdHVzOiBcIm9ycGhhbmVkXCIsIGNvbHVtbjogXCJvcnBoYW5lZF9hdF9tc1wiLCBjdXRvZmY6IG5vdyAtIGZhaWxlZFR0bE1zLCBiYXRjaFNpemU6IHNpemV9KVxuICAgIH1cblxuICAgIHJldHVybiBkZWxldGVkXG4gIH1cblxuICAvKipcbiAgICogRGVsZXRlcyByb3dzIG9mIG9uZSB0ZXJtaW5hbCBzdGF0dXMgb2xkZXIgdGhhbiBhIGN1dG9mZiwgYmF0Y2ggYnkgYmF0Y2gsXG4gICAqIHVudGlsIGEgcGFnZSByZXR1cm5zIGZld2VyIHRoYW4gYGJhdGNoU2l6ZWAgcm93cy5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBPcHRpb25zLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gYXJncy5zdGF0dXMgLSBUZXJtaW5hbCBzdGF0dXMgdG8gcHJ1bmUuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBhcmdzLmNvbHVtbiAtIFRpbWVzdGFtcCBjb2x1bW4gY29tcGFyZWQgYWdhaW5zdCB0aGUgY3V0b2ZmLlxuICAgKiBAcGFyYW0ge251bWJlcn0gYXJncy5jdXRvZmYgLSBEZWxldGUgcm93cyB3aG9zZSBjb2x1bW4gdmFsdWUgaXMgYDw9IGN1dG9mZmAuXG4gICAqIEBwYXJhbSB7bnVtYmVyfSBhcmdzLmJhdGNoU2l6ZSAtIE1heCByb3dzIHBlciBiYXRjaC5cbiAgICogQHJldHVybnMge1Byb21pc2U8bnVtYmVyPn0gLSBSb3dzIGRlbGV0ZWQgZm9yIHRoaXMgc3RhdHVzLlxuICAgKi9cbiAgYXN5bmMgX3BydW5lU3RhdHVzQmF0Y2hlcyh7c3RhdHVzLCBjb2x1bW4sIGN1dG9mZiwgYmF0Y2hTaXplfSkge1xuICAgIGxldCBkZWxldGVkID0gMFxuXG4gICAgZm9yICg7Oykge1xuICAgICAgY29uc3QgcmVtb3ZlZCA9IGF3YWl0IHRoaXMuX3NlcmlhbGl6ZWRDb3VudE11dGF0aW9uKGFzeW5jIChkYikgPT4ge1xuICAgICAgICBjb25zdCByb3dzID0gYXdhaXQgZGJcbiAgICAgICAgICAubmV3UXVlcnkoKVxuICAgICAgICAgIC5mcm9tKEpPQlNfVEFCTEUpXG4gICAgICAgICAgLnNlbGVjdChcImlkXCIpXG4gICAgICAgICAgLndoZXJlKHtzdGF0dXN9KVxuICAgICAgICAgIC53aGVyZShgJHtkYi5xdW90ZUNvbHVtbihjb2x1bW4pfSA8PSAke2RiLnF1b3RlKGN1dG9mZil9YClcbiAgICAgICAgICAubGltaXQoYmF0Y2hTaXplKVxuICAgICAgICAgIC5yZXN1bHRzKClcblxuICAgICAgICBpZiAocm93cy5sZW5ndGggPT09IDApIHJldHVybiAwXG5cbiAgICAgICAgY29uc3QgaWRzID0gcm93cy5tYXAoKC8qKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSAqLyByb3cpID0+IGRiLnF1b3RlKFN0cmluZyhyb3cuaWQpKSkuam9pbihcIiwgXCIpXG5cbiAgICAgICAgY29uc3QgcmVtb3ZlZCA9IGF3YWl0IGRiLmFmZmVjdGVkUm93cyhcbiAgICAgICAgICBgREVMRVRFIEZST00gJHtkYi5xdW90ZVRhYmxlKEpPQlNfVEFCTEUpfSBXSEVSRSAke2RiLnF1b3RlQ29sdW1uKFwiaWRcIil9IElOICgke2lkc30pYFxuICAgICAgICApXG5cbiAgICAgICAgYXdhaXQgdGhpcy5fcmVjb3JkQ291bnREZWx0YShkYiwge2FsbDogLXJlbW92ZWQsIFtzdGF0dXNdOiAtcmVtb3ZlZH0pXG5cbiAgICAgICAgcmV0dXJuIHJlbW92ZWRcbiAgICAgIH0pXG5cbiAgICAgIGRlbGV0ZWQgKz0gcmVtb3ZlZFxuICAgICAgaWYgKHJlbW92ZWQgPCBiYXRjaFNpemUpIGJyZWFrXG4gICAgfVxuXG4gICAgcmV0dXJuIGRlbGV0ZWRcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGNsZWFyIGFsbC5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgd2hlbiBjbGVhcmVkLlxuICAgKi9cbiAgYXN5bmMgY2xlYXJBbGwoKSB7XG4gICAgYXdhaXQgdGhpcy5lbnN1cmVSZWFkeSgpXG5cbiAgICBhd2FpdCB0aGlzLl9zZXJpYWxpemVkQ291bnRNdXRhdGlvbihhc3luYyAoZGIpID0+IHtcbiAgICAgIGNvbnN0IHNuYXBzaG90ID0gYXdhaXQgdGhpcy5fY291bnRTbmFwc2hvdE9uTG9ja2VkQ29ubmVjdGlvbihkYilcbiAgICAgIGlmIChhd2FpdCBkYi50YWJsZUV4aXN0cyhNQUlMX0RFTElWRVJZX09QRVJBVElPTlNfVEFCTEUpKSBhd2FpdCBkYi5xdWVyeShgREVMRVRFIEZST00gJHtkYi5xdW90ZVRhYmxlKE1BSUxfREVMSVZFUllfT1BFUkFUSU9OU19UQUJMRSl9YClcbiAgICAgIGlmIChhd2FpdCBkYi50YWJsZUV4aXN0cyhJREVNUE9URU5DWV9LRVlTX1RBQkxFKSkgYXdhaXQgZGIucXVlcnkoYERFTEVURSBGUk9NICR7ZGIucXVvdGVUYWJsZShJREVNUE9URU5DWV9LRVlTX1RBQkxFKX1gKVxuICAgICAgaWYgKGF3YWl0IGRiLnRhYmxlRXhpc3RzKFNDSEVEVUxFX0tFWVNfVEFCTEUpKSBhd2FpdCBkYi5xdWVyeShgREVMRVRFIEZST00gJHtkYi5xdW90ZVRhYmxlKFNDSEVEVUxFX0tFWVNfVEFCTEUpfWApXG4gICAgICBhd2FpdCBkYi5xdWVyeShgREVMRVRFIEZST00gJHtkYi5xdW90ZVRhYmxlKEpPQlNfVEFCTEUpfWApXG4gICAgICBpZiAoYXdhaXQgZGIudGFibGVFeGlzdHMoQ09OQ1VSUkVOQ1lfVEFCTEUpKSBhd2FpdCBkYi5xdWVyeShgREVMRVRFIEZST00gJHtkYi5xdW90ZVRhYmxlKENPTkNVUlJFTkNZX1RBQkxFKX1gKVxuICAgICAgY29uc3QgZGVsdGFzID0gT2JqZWN0LmZyb21FbnRyaWVzKE9iamVjdC5lbnRyaWVzKHNuYXBzaG90LmNvdW50cykubWFwKChba2V5LCB2YWx1ZV0pID0+IFtrZXksIC12YWx1ZV0pKVxuICAgICAgYXdhaXQgdGhpcy5fcmVjb3JkQ291bnREZWx0YShkYiwgZGVsdGFzKVxuICAgIH0pXG4gIH1cblxuICAvKipcbiAgICogQ2FuY2VscyBhIHF1ZXVlZCBvciBoYW5kZWQtb2ZmIGpvYiBhbmQgcmVsZWFzZXMgYW55IGR1cmFibGUgY29uY3VycmVuY3kgcmVzZXJ2YXRpb24uXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBqb2JJZCAtIEpvYiBpZC5cbiAgICogQHJldHVybnMge1Byb21pc2U8Ym9vbGVhbj59IC0gV2hldGhlciB0aGUgam9iIHdhcyBjYW5jZWxsZWQuXG4gICAqL1xuICBhc3luYyBjYW5jZWwoam9iSWQpIHtcbiAgICBhd2FpdCB0aGlzLmVuc3VyZVJlYWR5KClcbiAgICByZXR1cm4gYXdhaXQgdGhpcy5fc2VyaWFsaXplZENvdW50TXV0YXRpb24oYXN5bmMgKGRiKSA9PiB7XG4gICAgICBjb25zdCBqb2IgPSBhd2FpdCB0aGlzLl9nZXRKb2JSb3dCeUlkKGRiLCBqb2JJZClcbiAgICAgIGlmICgham9iIHx8IChqb2Iuc3RhdHVzICE9PSBcInF1ZXVlZFwiICYmIGpvYi5zdGF0dXMgIT09IFwiaGFuZGVkX29mZlwiKSkgcmV0dXJuIGZhbHNlXG4gICAgICAvLyBPbmx5IGEgaGFuZGVkX29mZiBqb2IgaG9sZHMgYSBjb25jdXJyZW5jeSByZXNlcnZhdGlvbiwgc28gb25seSB0aGF0IGNhc2UgdG91Y2hlcyB0aGVcbiAgICAgIC8vIHNoYXJlZCBjb3VudGVyIHJvdyBhbmQgbmVlZHMgdGhlIGNvbmN1cnJlbmN5LXRoZW4tam9iIGxvY2sgb3JkZXJpbmcuXG4gICAgICBpZiAoam9iLnN0YXR1cyA9PT0gXCJoYW5kZWRfb2ZmXCIpIGF3YWl0IHRoaXMuX2xvY2tDb25jdXJyZW5jeVJvdyhkYiwgam9iLmNvbmN1cnJlbmN5S2V5KVxuICAgICAgY29uc3QgYWZmZWN0ZWRSb3dzID0gYXdhaXQgdGhpcy5fdXBkYXRlQWZmZWN0ZWRSb3dzKGRiLCB7dGFibGVOYW1lOiBKT0JTX1RBQkxFLCBkYXRhOiB7c3RhdHVzOiBcImNhbmNlbGxlZFwifSwgY29uZGl0aW9uczoge2lkOiBqb2IuaWQsIHN0YXR1czogam9iLnN0YXR1c319KVxuICAgICAgaWYgKGFmZmVjdGVkUm93cyAhPT0gMSkgcmV0dXJuIGZhbHNlXG4gICAgICBhd2FpdCB0aGlzLl9yZWxlYXNlU2NoZWR1bGVPd25lcnNoaXBGb3JKb2IoZGIsIGpvYilcbiAgICAgIGlmIChqb2Iuc3RhdHVzID09PSBcImhhbmRlZF9vZmZcIikgYXdhaXQgdGhpcy5fcmVsZWFzZUNvbmN1cnJlbmN5KGRiLCBqb2IuY29uY3VycmVuY3lLZXkpXG4gICAgICBhd2FpdCB0aGlzLl9yZWNvcmRTdGF0dXNUcmFuc2l0aW9uKGRiLCBqb2Iuc3RhdHVzLCBcImNhbmNlbGxlZFwiKVxuICAgICAgcmV0dXJuIHRydWVcbiAgICB9KVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZ2V0IHJldHJ5IGRlbGF5IG1zLlxuICAgKiBAcGFyYW0ge251bWJlcn0gcmV0cnlDb3VudCAtIFJldHJ5IGF0dGVtcHQgY291bnQgKDEtYmFzZWQpLlxuICAgKiBAcmV0dXJucyB7bnVtYmVyfSAtIERlbGF5IGluIG1pbGxpc2Vjb25kcy5cbiAgICovXG4gIGdldFJldHJ5RGVsYXlNcyhyZXRyeUNvdW50KSB7XG4gICAgcmV0dXJuIHJldHJ5RGVsYXlNcyhyZXRyeUNvdW50KVxuICB9XG5cbiAgLyoqXG4gICAqIE5vcm1hbGl6ZXMgb25lIG5ldyBqb2IgYmVmb3JlIGVudGVyaW5nIGl0cyBwZXJzaXN0ZW5jZSB0cmFuc2FjdGlvbi5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBKb2IgaW5wdXQuXG4gICAqIEBwYXJhbSB7QXJyYXk8UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSBhcmdzLmFyZ3MgLSBKb2IgYXJndW1lbnRzLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gYXJncy5qb2JOYW1lIC0gSm9iIG5hbWUuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi90eXBlcy5qc1wiKS5CYWNrZ3JvdW5kSm9iT3B0aW9uc30gW2FyZ3Mub3B0aW9uc10gLSBKb2Igb3B0aW9ucy5cbiAgICogQHJldHVybnMge1ByZXBhcmVkQmFja2dyb3VuZEpvYn0gLSBQcmVwYXJlZCBqb2IuXG4gICAqL1xuICBfcHJlcGFyZUpvYih7YXJncywgam9iTmFtZSwgb3B0aW9uc30pIHtcbiAgICBjb25zdCBjcmVhdGVkQXRNcyA9IHRoaXMuY2xvY2subm93KClcbiAgICBjb25zdCBxdWV1ZSA9IHRoaXMuX25vcm1hbGl6ZVF1ZXVlKG9wdGlvbnMpXG5cbiAgICByZXR1cm4ge1xuICAgICAgYXJnc0pzb246IEpTT04uc3RyaW5naWZ5KGFyZ3MgfHwgW10pLFxuICAgICAgY29uY3VycmVuY3k6IHRoaXMuX3Jlc29sdmVDb25jdXJyZW5jeShvcHRpb25zLCBxdWV1ZSksXG4gICAgICBjcmVhdGVkQXRNcyxcbiAgICAgIGV4ZWN1dGlvbk1vZGU6IHRoaXMuX25vcm1hbGl6ZUV4ZWN1dGlvbk1vZGUob3B0aW9ucyksXG4gICAgICBqb2JJZDogcmFuZG9tVVVJRCgpLFxuICAgICAgam9iTmFtZSxcbiAgICAgIG1heFJldHJpZXM6IHRoaXMuX25vcm1hbGl6ZU1heFJldHJpZXMob3B0aW9ucz8ubWF4UmV0cmllcyksXG4gICAgICBxdWV1ZSxcbiAgICAgIHNjaGVkdWxlZEF0TXM6IHRoaXMuX25vcm1hbGl6ZVNjaGVkdWxlZEF0TXMob3B0aW9ucz8uc2NoZWR1bGVkQXRNcywgY3JlYXRlZEF0TXMpLFxuICAgICAgdGltZW91dE1zOiB0aGlzLl9ub3JtYWxpemVKb2JUaW1lb3V0TXMob3B0aW9ucylcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogTm9ybWFsaXplcyBhIHBlci1qb2IgdGltZW91dCB3aGlsZSBwcmVzZXJ2aW5nIG9taXR0ZWQgKHdvcmtlciBmYWxsYmFjaylcbiAgICogc2VwYXJhdGVseSBmcm9tIGV4cGxpY2l0bHkgZGlzYWJsZWQuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi90eXBlcy5qc1wiKS5CYWNrZ3JvdW5kSm9iT3B0aW9ucyB8IHVuZGVmaW5lZH0gb3B0aW9ucyAtIEpvYiBvcHRpb25zLlxuICAgKiBAcmV0dXJucyB7bnVtYmVyIHwgbnVsbH0gLSBQb3NpdGl2ZSB0aW1lb3V0LCB6ZXJvIGZvciBkaXNhYmxlZCwgb3IgbnVsbCB3aGVuIG9taXR0ZWQuXG4gICAqL1xuICBfbm9ybWFsaXplSm9iVGltZW91dE1zKG9wdGlvbnMpIHtcbiAgICBpZiAob3B0aW9ucz8udGltZW91dE1zID09PSB1bmRlZmluZWQpIHJldHVybiBudWxsXG5cbiAgICBjb25zdCB0aW1lb3V0TXMgPSBvcHRpb25zLnRpbWVvdXRNc1xuXG4gICAgaWYgKHR5cGVvZiB0aW1lb3V0TXMgIT09IFwibnVtYmVyXCIgfHwgIU51bWJlci5pc0Zpbml0ZSh0aW1lb3V0TXMpKSB7XG4gICAgICB0aHJvdyBWZWxvY2lvdXNFcnJvci5zYWZlKEpPQl9USU1FT1VUX1ZBTElEQVRJT05fTUVTU0FHRSlcbiAgICB9XG5cbiAgICBpZiAodGltZW91dE1zIDw9IDApIHJldHVybiAwXG5cbiAgICBpZiAoIU51bWJlci5pc0ludGVnZXIodGltZW91dE1zKSB8fCB0aW1lb3V0TXMgPiBNQVhfSk9CX1RJTUVPVVRfTVMpIHtcbiAgICAgIHRocm93IFZlbG9jaW91c0Vycm9yLnNhZmUoSk9CX1RJTUVPVVRfVkFMSURBVElPTl9NRVNTQUdFKVxuICAgIH1cblxuICAgIHJldHVybiB0aW1lb3V0TXNcbiAgfVxuXG4gIC8qKlxuICAgKiBJbnNlcnRzIG9uZSBwcmVwYXJlZCBxdWV1ZWQgam9iLCBpbmNsdWRpbmcgaXRzIGNvbmN1cnJlbmN5IHJlZ2lzdHJhdGlvbi5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9kYXRhYmFzZS9kcml2ZXJzL2Jhc2UuanNcIikuZGVmYXVsdH0gZGIgLSBEYXRhYmFzZSBjb25uZWN0aW9uLlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIEluc2VydCBpbnB1dC5cbiAgICogQHBhcmFtIHtQcmVwYXJlZEJhY2tncm91bmRKb2J9IGFyZ3MucHJlcGFyZWRKb2IgLSBQcmVwYXJlZCBqb2IuXG4gICAqIEBwYXJhbSB7c3RyaW5nIHwgbnVsbH0gYXJncy5zY2hlZHVsZUtleSAtIEhpc3RvcmljYWwgc3RhYmxlIGtleS5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgYWZ0ZXIgaW5zZXJ0aW9uLlxuICAgKi9cbiAgYXN5bmMgX2luc2VydFByZXBhcmVkSm9iKGRiLCB7cHJlcGFyZWRKb2IsIHNjaGVkdWxlS2V5fSkge1xuICAgIGNvbnN0IHtjb25jdXJyZW5jeX0gPSBwcmVwYXJlZEpvYlxuXG4gICAgaWYgKGNvbmN1cnJlbmN5KSB7XG4gICAgICBpZiAoY29uY3VycmVuY3kucXVldWVEZXJpdmVkKSB7XG4gICAgICAgIGF3YWl0IHRoaXMuX2Vuc3VyZVF1ZXVlQ29uY3VycmVuY3lLZXkoZGIsIGNvbmN1cnJlbmN5KVxuICAgICAgfSBlbHNlIHtcbiAgICAgICAgYXdhaXQgdGhpcy5fZW5zdXJlQ29uY3VycmVuY3lLZXkoZGIsIGNvbmN1cnJlbmN5KVxuICAgICAgfVxuICAgIH1cblxuICAgIGF3YWl0IGRiLmluc2VydCh7XG4gICAgICB0YWJsZU5hbWU6IEpPQlNfVEFCTEUsXG4gICAgICBkYXRhOiB7XG4gICAgICAgIGlkOiBwcmVwYXJlZEpvYi5qb2JJZCxcbiAgICAgICAgam9iX25hbWU6IHByZXBhcmVkSm9iLmpvYk5hbWUsXG4gICAgICAgIGFyZ3NfanNvbjogcHJlcGFyZWRKb2IuYXJnc0pzb24sXG4gICAgICAgIGV4ZWN1dGlvbl9tb2RlOiBwcmVwYXJlZEpvYi5leGVjdXRpb25Nb2RlLFxuICAgICAgICBxdWV1ZTogcHJlcGFyZWRKb2IucXVldWUsXG4gICAgICAgIG1heF9yZXRyaWVzOiBwcmVwYXJlZEpvYi5tYXhSZXRyaWVzLFxuICAgICAgICBhdHRlbXB0czogMCxcbiAgICAgICAgc3RhdHVzOiBcInF1ZXVlZFwiLFxuICAgICAgICBzY2hlZHVsZWRfYXRfbXM6IHByZXBhcmVkSm9iLnNjaGVkdWxlZEF0TXMsXG4gICAgICAgIGNyZWF0ZWRfYXRfbXM6IHByZXBhcmVkSm9iLmNyZWF0ZWRBdE1zLFxuICAgICAgICBzY2hlZHVsZV9rZXk6IHNjaGVkdWxlS2V5LFxuICAgICAgICBjb25jdXJyZW5jeV9rZXk6IGNvbmN1cnJlbmN5Py5jb25jdXJyZW5jeUtleSB8fCBudWxsLFxuICAgICAgICBtYXhfY29uY3VycmVuY3k6IGNvbmN1cnJlbmN5Py5tYXhDb25jdXJyZW5jeSB8fCBudWxsLFxuICAgICAgICB0aW1lb3V0X21zOiBwcmVwYXJlZEpvYi50aW1lb3V0TXMsXG4gICAgICAgIGhhbmRvZmZfaWQ6IG51bGxcbiAgICAgIH1cbiAgICB9KVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgbm9ybWFsaXplIG1heCByZXRyaWVzLlxuICAgKiBAcGFyYW0ge251bWJlciB8IG51bGwgfCB1bmRlZmluZWR9IG1heFJldHJpZXMgLSBJbnB1dC5cbiAgICogQHJldHVybnMge251bWJlcn0gLSBOb3JtYWxpemVkIG1heCByZXRyaWVzLlxuICAgKi9cbiAgX25vcm1hbGl6ZU1heFJldHJpZXMobWF4UmV0cmllcykge1xuICAgIHJldHVybiBub3JtYWxpemVCYWNrZ3JvdW5kSm9iTWF4UmV0cmllcyhtYXhSZXRyaWVzKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgbm9ybWFsaXplIHNjaGVkdWxlZCBhdCBtcy5cbiAgICogQHBhcmFtIHtudW1iZXIgfCB1bmRlZmluZWR9IHNjaGVkdWxlZEF0TXMgLSBSZXF1ZXN0ZWQgZGlzcGF0Y2ggdGltZXN0YW1wLlxuICAgKiBAcGFyYW0ge251bWJlcn0gZGVmYXVsdFNjaGVkdWxlZEF0TXMgLSBEZWZhdWx0IGRpc3BhdGNoIHRpbWVzdGFtcC5cbiAgICogQHJldHVybnMge251bWJlcn0gLSBEaXNwYXRjaCB0aW1lc3RhbXAuXG4gICAqL1xuICBfbm9ybWFsaXplU2NoZWR1bGVkQXRNcyhzY2hlZHVsZWRBdE1zLCBkZWZhdWx0U2NoZWR1bGVkQXRNcykge1xuICAgIHJldHVybiBub3JtYWxpemVCYWNrZ3JvdW5kSm9iU2NoZWR1bGVkQXRNcyhzY2hlZHVsZWRBdE1zLCBkZWZhdWx0U2NoZWR1bGVkQXRNcylcbiAgfVxuXG4gIC8qKlxuICAgKiBSZXNvbHZlcyBhIHJlc2NoZWR1bGUgZGVsYXkgYWdhaW5zdCBwZXJzaXN0ZW5jZSB0aW1lLlxuICAgKiBAcGFyYW0ge251bWJlcn0gZGVsYXlNcyAtIERlbGF5IGluIG1pbGxpc2Vjb25kcy5cbiAgICogQHJldHVybnMge251bWJlcn0gLSBGdXR1cmUgZWxpZ2liaWxpdHkgdGltZXN0YW1wLlxuICAgKi9cbiAgX3Jlc2NoZWR1bGVkQXRNcyhkZWxheU1zKSB7XG4gICAgcmV0dXJuIHJlc2NoZWR1bGVkQmFja2dyb3VuZEpvYkF0TXMoZGVsYXlNcywgdGhpcy5jbG9jay5ub3coKSlcbiAgfVxuXG4gIC8qKlxuICAgKiBWYWxpZGF0ZXMgYSBwdWJsaWMgcmVzY2hlZHVsZSBkZWxheSBiZWZvcmUgcGVyc2lzdGVuY2Ugd29yayBiZWdpbnMuXG4gICAqIEBwYXJhbSB7bnVtYmVyfSBkZWxheU1zIC0gRGVsYXkgaW4gbWlsbGlzZWNvbmRzLlxuICAgKiBAcmV0dXJucyB7dm9pZH1cbiAgICovXG4gIF92YWxpZGF0ZVJlc2NoZWR1bGVEZWxheU1zKGRlbGF5TXMpIHtcbiAgICByZXNjaGVkdWxlZEJhY2tncm91bmRKb2JBdE1zKGRlbGF5TXMsIDApXG4gIH1cblxuICAvKipcbiAgICogVmFsaWRhdGVzIGEgc3RhYmxlIHNjaGVkdWxlIGtleSBhdCB0aGUgcHVibGljIHN0b3JhZ2UgYm91bmRhcnkuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBzY2hlZHVsZUtleSAtIFN0YWJsZSBsb2dpY2FsIHNjaGVkdWxlIGtleS5cbiAgICogQHJldHVybnMge3N0cmluZ30gLSBWYWxpZGF0ZWQga2V5LlxuICAgKi9cbiAgX25vcm1hbGl6ZVNjaGVkdWxlS2V5KHNjaGVkdWxlS2V5KSB7XG4gICAgaWYgKHR5cGVvZiBzY2hlZHVsZUtleSA9PT0gXCJzdHJpbmdcIiAmJiBzY2hlZHVsZUtleS5sZW5ndGggPiAwICYmIHNjaGVkdWxlS2V5Lmxlbmd0aCA8PSAyNTUpIHJldHVybiBzY2hlZHVsZUtleVxuXG4gICAgdGhyb3cgVmVsb2Npb3VzRXJyb3Iuc2FmZShcImJhY2tncm91bmQgam9iIHNjaGVkdWxlS2V5IG11c3QgYmUgYSBub24tZW1wdHkgc3RyaW5nIG9mIGF0IG1vc3QgMjU1IGNoYXJhY3RlcnNcIilcbiAgfVxuXG4gIC8qKlxuICAgKiBCdWlsZHMgYSBib3VuZGVkIGFkdmlzb3J5LWxvY2sgbmFtZSBmb3Igb25lIHN0YWJsZSBzY2hlZHVsZSBrZXkuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBzY2hlZHVsZUtleSAtIFZhbGlkYXRlZCBzdGFibGUgc2NoZWR1bGUga2V5LlxuICAgKiBAcmV0dXJucyB7c3RyaW5nfSAtIEFkdmlzb3J5LWxvY2sgbmFtZS5cbiAgICovXG4gIF9zY2hlZHVsZUtleUxvY2tOYW1lKHNjaGVkdWxlS2V5KSB7XG4gICAgY29uc3QgaGFzaCA9IGNyZWF0ZUhhc2goXCJzaGEyNTZcIikudXBkYXRlKHNjaGVkdWxlS2V5KS5kaWdlc3QoXCJoZXhcIikuc2xpY2UoMCwgMzIpXG5cbiAgICByZXR1cm4gYGJhY2tncm91bmQtam9iczpzY2hlZHVsZToke2hhc2h9YFxuICB9XG5cbiAgLyoqXG4gICAqIEVuc3VyZXMgdGhlIGJhY2tncm91bmQtam9icyBzY2hlbWEgZXhpc3RzLCByZXVzaW5nIGEgY2FsbGVyLWhlbGQgY29ubmVjdGlvbiB3aGVuXG4gICAqIG9uZSBpcyBnaXZlbiByYXRoZXIgdGhhbiBjaGVja2luZyBvdXQgaXRzIG93bi5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9kYXRhYmFzZS9kcml2ZXJzL2Jhc2UuanNcIikuZGVmYXVsdH0gW2V4aXN0aW5nRGJdIC0gUmV1c2UgYW5cbiAgICogICBhbHJlYWR5LWNoZWNrZWQtb3V0IGNvbm5lY3Rpb24gKGUuZy4gdGhlIG9uZSBgZGI6bWlncmF0ZWAgaG9sZHMpIGluc3RlYWQgb2ZcbiAgICogICBjaGVja2luZyBvdXQgYSBuZXN0ZWQgb25lIOKAlCB0aGUgbmVzdGVkIGNoZWNrb3V0IHdvdWxkIGRlYWRsb2NrIGEgZGF0YWJhc2VcbiAgICogICB3aG9zZSBwb29sIGlzIGNhcHBlZCBhdCBhIHNpbmdsZSBjb25uZWN0aW9uIGFscmVhZHkgaGVsZCBieSB0aGUgY2FsbGVyLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyB3aGVuIHRoZSBzY2hlbWEgaXMgcHJlc2VudC5cbiAgICovXG4gIGFzeW5jIF9lbnN1cmVTY2hlbWEoZXhpc3RpbmdEYikge1xuICAgIGF3YWl0IHRoaXMuX2FwcGx5U2NoZW1hKGV4aXN0aW5nRGIpXG4gIH1cblxuICAvKipcbiAgICogU2VyaWFsaXplcyBjcmVhdGlvbiBvciB1cGdyYWRlIG9mIHRoZSBiYWNrZ3JvdW5kLWpvYnMgc2NoZW1hLCBjaGVja2luZyBvdXQgYVxuICAgKiBjb25uZWN0aW9uIG9ubHkgYWZ0ZXIgZWFybGllciBzY2hlbWEgd29yayBoYXMgY29tcGxldGVkIHdoZW4gb25lIGlzIG5vdCBzdXBwbGllZC5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9kYXRhYmFzZS9kcml2ZXJzL2Jhc2UuanNcIikuZGVmYXVsdH0gW2V4aXN0aW5nRGJdIC0gQ2FsbGVyLW93bmVkXG4gICAqICAgZGF0YWJhc2UgY29ubmVjdGlvbi5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgd2hlbiB0aGUgc2NoZW1hIGlzIHByZXNlbnQuXG4gICAqL1xuICBhc3luYyBfYXBwbHlTY2hlbWEoZXhpc3RpbmdEYikge1xuICAgIC8vIFNlcmlhbGl6ZSBjb25jdXJyZW50IHNjaGVtYSBhcHBsaWVzIHdpdGhpbiB0aGlzIHByb2Nlc3MsIGtleWVkIGJ5IGRhdGFiYXNlXG4gICAgLy8gaWRlbnRpZmllciAoc2VlIGBzY2hlbWFBcHBseUNoYWluc2ApLiBUaGUgcGVyLXN0ZXAgbG9ja3MgaW5zaWRlIHRoZSBzdGVwcyB1c2VcbiAgICAvLyBESUZGRVJFTlQgbG9jayBuYW1lcywgc28gdHdvIGNvbmN1cnJlbnQgY2FsbGVycyBjb3VsZCBvdGhlcndpc2UgZWFjaCBob2xkIGFcbiAgICAvLyBkaWZmZXJlbnQgc3RlcCBsb2NrIHdoaWxlIGJvdGggcmVidWlsZCB0aGUgam9icyB0YWJsZSDigJQgYW5kIG9uIFNRTGl0ZS9NU1NRTCBhblxuICAgIC8vIGFkZC1jb2x1bW4gaXMgYSBjcmVhdGUtY29weS1kcm9wLXJlbmFtZSByZWJ1aWxkLCBzbyBvdmVybGFwcGluZyByZWJ1aWxkc1xuICAgIC8vIGNvcnJ1cHQgaXQuIFRoaXMgbXV0ZXggbWFrZXMgdGhlIHdob2xlIGFwcGx5IG11dHVhbGx5IGV4Y2x1c2l2ZSBwZXIgcHJvY2VzcztcbiAgICAvLyB0aGUgc2Vjb25kIGNhbGxlciB0aGVuIHJlLWNoZWNrcyBhbmQgZmluZHMgZXZlcnkgc3RlcCBhbHJlYWR5IGRvbmUuXG4gICAgY29uc3QgaWRlbnRpZmllciA9IHRoaXMuZ2V0RGF0YWJhc2VJZGVudGlmaWVyKCkgPz8gXCJkZWZhdWx0XCJcbiAgICBjb25zdCBwcmV2aW91cyA9IHNjaGVtYUFwcGx5Q2hhaW5zLmdldChpZGVudGlmaWVyKSA/PyBQcm9taXNlLnJlc29sdmUoKVxuICAgIGNvbnN0IGFwcGx5V2l0aENvbm5lY3Rpb24gPSBhc3luYyAoKSA9PiB7XG4gICAgICBpZiAoZXhpc3RpbmdEYikge1xuICAgICAgICBhd2FpdCB0aGlzLl9hcHBseVNjaGVtYVN0ZXBzKGV4aXN0aW5nRGIpXG5cbiAgICAgICAgcmV0dXJuXG4gICAgICB9XG5cbiAgICAgIGF3YWl0IHRoaXMuX3dpdGhEYigoZGIpID0+IHRoaXMuX2FwcGx5U2NoZW1hU3RlcHMoZGIpKVxuICAgIH1cbiAgICBjb25zdCBydW4gPSBwcmV2aW91cy50aGVuKGFwcGx5V2l0aENvbm5lY3Rpb24sIGFwcGx5V2l0aENvbm5lY3Rpb24pXG5cbiAgICAvLyBLZWVwIHRoZSBjaGFpbiBhbGl2ZSByZWdhcmRsZXNzIG9mIHRoaXMgcnVuJ3Mgb3V0Y29tZSBzbyBvbmUgZmFpbGVkIGFwcGx5IGRvZXNcbiAgICAvLyBub3Qgd2VkZ2UgbGF0ZXIgY2FsbGVyczsgdGhpcyBydW4gc3RpbGwgcHJvcGFnYXRlcyBpdHMgb3duIHJlc3VsdC9lcnJvci5cbiAgICBzY2hlbWFBcHBseUNoYWlucy5zZXQoaWRlbnRpZmllciwgcnVuLnRoZW4oKCkgPT4ge30sICgpID0+IHt9KSlcblxuICAgIHJldHVybiBhd2FpdCBydW5cbiAgfVxuXG4gIC8qKlxuICAgKiBDcmVhdGVzIG9yIHVwZ3JhZGVzIHRoZSBiYWNrZ3JvdW5kLWpvYnMgdGFibGVzLCBjb2x1bW5zIGFuZCBjb25jdXJyZW5jeSByb3dzIG9uXG4gICAqIHRoZSBnaXZlbiBjb25uZWN0aW9uLiBTZXJpYWxpemVkIHBlciBwcm9jZXNzIGJ5IHtAbGluayBCYWNrZ3JvdW5kSm9ic1N0b3JlI19hcHBseVNjaGVtYX0uXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vZGF0YWJhc2UvZHJpdmVycy9iYXNlLmpzXCIpLmRlZmF1bHR9IGRiIC0gRGF0YWJhc2UgY29ubmVjdGlvbi5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgd2hlbiB0aGUgc2NoZW1hIGlzIHByZXNlbnQuXG4gICAqL1xuICBhc3luYyBfYXBwbHlTY2hlbWFTdGVwcyhkYikge1xuICAgIGF3YWl0IHRoaXMuX2Vuc3VyZU1pZ3JhdGlvbnNUYWJsZShkYilcblxuICAgIGNvbnN0IGFscmVhZHlBcHBsaWVkID0gYXdhaXQgdGhpcy5faGFzTWlncmF0aW9uKGRiKVxuICAgIGNvbnN0IHNjaGVtYVJlY292ZXJ5UGVuZGluZyA9IGF3YWl0IHRoaXMuX2hhc01pZ3JhdGlvbihkYiwgU0NIRU1BX1JFQ09WRVJZX1BFTkRJTkdfVkVSU0lPTilcbiAgICBjb25zdCBqb2JzVGFibGVFeGlzdHMgPSBhd2FpdCBkYi50YWJsZUV4aXN0cyhKT0JTX1RBQkxFKVxuXG4gICAgLy8gRXZlbiB3aGVuIHRoZSBtaWdyYXRpb24gcm93IGlzIHByZXNlbnQsIHRoZSBqb2JzIHRhYmxlIGl0c2VsZiBjYW4gaGF2ZVxuICAgIC8vIGJlZW4gZHJvcHBlZCB1bmRlcm5lYXRoIHVzIGJ5IGEgdHJhbnNhY3Rpb24gcm9sbGJhY2sgaW4gYW5vdGhlciBjYWxsZXJcbiAgICAvLyAoRERMIGlzIHRyYW5zYWN0aW9uYWwgb24gU1FMaXRlL01TU1FMKS4gVmVyaWZ5IHRoZSB0YWJsZSBwaHlzaWNhbGx5XG4gICAgLy8gZXhpc3RzIGFuZCByZWNyZWF0ZSBpdCB3aGVuIG1pc3NpbmcgcmF0aGVyIHRoYW4gdHJ1c3RpbmcgdGhlIG1pZ3JhdGlvblxuICAgIC8vIHJvdyBhbG9uZSwgb3RoZXJ3aXNlIGxhdGVyIGNhbGxlcnMgZmFpbCB3aXRoIFwibm8gc3VjaCB0YWJsZVwiLlxuICAgIGlmIChhbHJlYWR5QXBwbGllZCAmJiBqb2JzVGFibGVFeGlzdHMgJiYgIXNjaGVtYVJlY292ZXJ5UGVuZGluZykge1xuICAgICAgYXdhaXQgdGhpcy5fZW5zdXJlSm9ic1RhYmxlQ29sdW1ucyhkYilcbiAgICAgIGF3YWl0IHRoaXMuX2Vuc3VyZUlkZW1wb3RlbmN5S2V5c1RhYmxlKGRiKVxuICAgICAgYXdhaXQgdGhpcy5fZW5zdXJlTWFpbERlbGl2ZXJ5T3BlcmF0aW9uc1RhYmxlKGRiKVxuICAgICAgYXdhaXQgdGhpcy5fZW5zdXJlU2NoZWR1bGVLZXlzVGFibGUoZGIpXG4gICAgICBhd2FpdCB0aGlzLl9lbnN1cmVDb25jdXJyZW5jeVRhYmxlKGRiKVxuICAgICAgYXdhaXQgdGhpcy5fZW5zdXJlQ291bnRSZXZpc2lvblRhYmxlKGRiKVxuXG4gICAgICByZXR1cm5cbiAgICB9XG5cbiAgICBpZiAoYWxyZWFkeUFwcGxpZWQgJiYgIXNjaGVtYVJlY292ZXJ5UGVuZGluZykge1xuICAgICAgYXdhaXQgdGhpcy5fcmVjb3JkTWlncmF0aW9uKGRiLCBTQ0hFTUFfUkVDT1ZFUllfUEVORElOR19WRVJTSU9OKVxuICAgIH1cblxuICAgIGF3YWl0IHRoaXMuX2FwcGx5TWlncmF0aW9ucyhkYilcbiAgICBhd2FpdCB0aGlzLl9lbnN1cmVKb2JzVGFibGVDb2x1bW5zKGRiKVxuICAgIGF3YWl0IHRoaXMuX2Vuc3VyZUlkZW1wb3RlbmN5S2V5c1RhYmxlKGRiKVxuICAgIGF3YWl0IHRoaXMuX2Vuc3VyZU1haWxEZWxpdmVyeU9wZXJhdGlvbnNUYWJsZShkYilcbiAgICBhd2FpdCB0aGlzLl9lbnN1cmVTY2hlZHVsZUtleXNUYWJsZShkYilcbiAgICBhd2FpdCB0aGlzLl9lbnN1cmVDb25jdXJyZW5jeVRhYmxlKGRiKVxuICAgIGF3YWl0IHRoaXMuX2Vuc3VyZUNvdW50UmV2aXNpb25UYWJsZShkYilcblxuICAgIGlmIChhbHJlYWR5QXBwbGllZCkge1xuICAgICAgLy8gVGhlIHJlY3JlYXRlZCBqb2JzIHRhYmxlIGlzIGVtcHR5LCBidXQgdGhlIHN1cnZpdmluZyBjb25jdXJyZW5jeSB0YWJsZVxuICAgICAgLy8gY2FuIHN0aWxsIGNvdW50IGhhbmRvZmZzIHRoYXQgZGlzYXBwZWFyZWQgd2l0aCB0aGUgZHJvcHBlZCBqb2JzIHRhYmxlLlxuICAgICAgYXdhaXQgdGhpcy5fcmVjb25jaWxlQ29uY3VycmVuY3koZGIpXG4gICAgICBhd2FpdCBkYi5kZWxldGUoe1xuICAgICAgICB0YWJsZU5hbWU6IE1JR1JBVElPTlNfVEFCTEUsXG4gICAgICAgIGNvbmRpdGlvbnM6IHtrZXk6IHRoaXMuX21pZ3JhdGlvbktleShTQ0hFTUFfUkVDT1ZFUllfUEVORElOR19WRVJTSU9OKX1cbiAgICAgIH0pXG5cbiAgICAgIHJldHVyblxuICAgIH1cblxuICAgIGF3YWl0IHRoaXMuX3JlY29yZE1pZ3JhdGlvbihkYiwgTUlHUkFUSU9OX1ZFUlNJT04pXG4gIH1cblxuICAvKipcbiAgICogUnVucyBlbnN1cmUgbWlncmF0aW9ucyB0YWJsZS5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9kYXRhYmFzZS9kcml2ZXJzL2Jhc2UuanNcIikuZGVmYXVsdH0gZGIgLSBEYXRhYmFzZSBjb25uZWN0aW9uLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyB3aGVuIGNvbXBsZXRlLlxuICAgKi9cbiAgYXN5bmMgX2Vuc3VyZU1pZ3JhdGlvbnNUYWJsZShkYikge1xuICAgIGlmIChhd2FpdCBkYi50YWJsZUV4aXN0cyhNSUdSQVRJT05TX1RBQkxFKSkgcmV0dXJuXG5cbiAgICBjb25zdCB0YWJsZSA9IG5ldyBUYWJsZURhdGEoTUlHUkFUSU9OU19UQUJMRSwge2lmTm90RXhpc3RzOiB0cnVlfSlcblxuICAgIHRhYmxlLnN0cmluZyhcImtleVwiLCB7bnVsbDogZmFsc2UsIHByaW1hcnlLZXk6IHRydWV9KVxuICAgIHRhYmxlLnN0cmluZyhcInNjb3BlXCIsIHtudWxsOiBmYWxzZX0pXG4gICAgdGFibGUuc3RyaW5nKFwidmVyc2lvblwiLCB7bnVsbDogZmFsc2V9KVxuICAgIHRhYmxlLmJpZ2ludChcImFwcGxpZWRfYXRfbXNcIiwge251bGw6IGZhbHNlfSlcblxuICAgIGF3YWl0IGRiLmNyZWF0ZVRhYmxlKHRhYmxlKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgaGFzIG1pZ3JhdGlvbi5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9kYXRhYmFzZS9kcml2ZXJzL2Jhc2UuanNcIikuZGVmYXVsdH0gZGIgLSBEYXRhYmFzZSBjb25uZWN0aW9uLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gW3ZlcnNpb25dIC0gTWlncmF0aW9uIHZlcnNpb24uXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPGJvb2xlYW4+fSAtIFdoZXRoZXIgbWlncmF0aW9uIGV4aXN0cy5cbiAgICovXG4gIGFzeW5jIF9oYXNNaWdyYXRpb24oZGIsIHZlcnNpb24gPSBNSUdSQVRJT05fVkVSU0lPTikge1xuICAgIGNvbnN0IHF1ZXJ5ID0gZGJcbiAgICAgIC5uZXdRdWVyeSgpXG4gICAgICAuZnJvbShNSUdSQVRJT05TX1RBQkxFKVxuICAgICAgLndoZXJlKHtrZXk6IHRoaXMuX21pZ3JhdGlvbktleSh2ZXJzaW9uKX0pXG4gICAgICAubGltaXQoMSlcblxuICAgIGNvbnN0IHJvd3MgPSBhd2FpdCBxdWVyeS5yZXN1bHRzKClcblxuICAgIHJldHVybiByb3dzLmxlbmd0aCA+IDBcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGFwcGx5IG1pZ3JhdGlvbnMuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vZGF0YWJhc2UvZHJpdmVycy9iYXNlLmpzXCIpLmRlZmF1bHR9IGRiIC0gRGF0YWJhc2UgY29ubmVjdGlvbi5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgd2hlbiBjb21wbGV0ZS5cbiAgICovXG4gIGFzeW5jIF9hcHBseU1pZ3JhdGlvbnMoZGIpIHtcbiAgICB0aGlzLmxvZ2dlci5pbmZvKFwiQXBwbHlpbmcgYmFja2dyb3VuZCBqb2JzIHNjaGVtYVwiKVxuXG4gICAgaWYgKGF3YWl0IGRiLnRhYmxlRXhpc3RzKEpPQlNfVEFCTEUpKSB7XG4gICAgICB0aGlzLmxvZ2dlci5pbmZvKFwiQmFja2dyb3VuZCBqb2JzIHRhYmxlIGFscmVhZHkgZXhpc3RzIC0gc2tpcHBpbmcgY3JlYXRlXCIpXG4gICAgICByZXR1cm5cbiAgICB9XG5cbiAgICBjb25zdCB0YWJsZSA9IG5ldyBUYWJsZURhdGEoSk9CU19UQUJMRSwge2lmTm90RXhpc3RzOiB0cnVlfSlcblxuICAgIHRhYmxlLnN0cmluZyhcImlkXCIsIHtwcmltYXJ5S2V5OiB0cnVlfSlcbiAgICB0YWJsZS5zdHJpbmcoXCJqb2JfbmFtZVwiLCB7bnVsbDogZmFsc2UsIGluZGV4OiB0cnVlfSlcbiAgICB0YWJsZS50ZXh0KFwiYXJnc19qc29uXCIsIHtudWxsOiBmYWxzZX0pXG4gICAgdGFibGUuc3RyaW5nKFwiZXhlY3V0aW9uX21vZGVcIiwge251bGw6IGZhbHNlfSlcbiAgICB0YWJsZS5zdHJpbmcoXCJxdWV1ZVwiLCB7bnVsbDogdHJ1ZSwgaW5kZXg6IHRydWV9KVxuICAgIHRhYmxlLmludGVnZXIoXCJtYXhfcmV0cmllc1wiLCB7bnVsbDogZmFsc2V9KVxuICAgIHRhYmxlLmludGVnZXIoXCJhdHRlbXB0c1wiLCB7bnVsbDogZmFsc2V9KVxuICAgIHRhYmxlLnN0cmluZyhcInN0YXR1c1wiLCB7bnVsbDogZmFsc2UsIGluZGV4OiB0cnVlfSlcbiAgICB0YWJsZS5iaWdpbnQoXCJzY2hlZHVsZWRfYXRfbXNcIiwge251bGw6IGZhbHNlLCBpbmRleDogdHJ1ZX0pXG4gICAgdGFibGUuYmlnaW50KFwiY3JlYXRlZF9hdF9tc1wiLCB7bnVsbDogZmFsc2UsIGluZGV4OiB0cnVlfSlcbiAgICB0YWJsZS5zdHJpbmcoXCJzY2hlZHVsZV9rZXlcIiwge251bGw6IHRydWUsIGluZGV4OiB0cnVlfSlcbiAgICB0YWJsZS5iaWdpbnQoXCJoYW5kZWRfb2ZmX2F0X21zXCIsIHtudWxsOiB0cnVlLCBpbmRleDogdHJ1ZX0pXG4gICAgdGFibGUuc3RyaW5nKFwiaGFuZG9mZl9pZFwiLCB7bnVsbDogdHJ1ZX0pXG4gICAgdGFibGUuYmlnaW50KFwiY29tcGxldGVkX2F0X21zXCIsIHtudWxsOiB0cnVlfSlcbiAgICB0YWJsZS5iaWdpbnQoXCJmYWlsZWRfYXRfbXNcIiwge251bGw6IHRydWV9KVxuICAgIHRhYmxlLmJpZ2ludChcIm9ycGhhbmVkX2F0X21zXCIsIHtudWxsOiB0cnVlLCBpbmRleDogdHJ1ZX0pXG4gICAgdGFibGUuc3RyaW5nKFwid29ya2VyX2lkXCIsIHtudWxsOiB0cnVlfSlcbiAgICB0YWJsZS50ZXh0KFwibGFzdF9lcnJvclwiLCB7bnVsbDogdHJ1ZX0pXG4gICAgdGFibGUuc3RyaW5nKFwiY29uY3VycmVuY3lfa2V5XCIsIHtudWxsOiB0cnVlLCBpbmRleDogdHJ1ZX0pXG4gICAgdGFibGUuaW50ZWdlcihcIm1heF9jb25jdXJyZW5jeVwiLCB7bnVsbDogdHJ1ZX0pXG4gICAgdGFibGUuYmlnaW50KFwidGltZW91dF9tc1wiLCB7bnVsbDogdHJ1ZX0pXG4gICAgdGFibGUuYmlnaW50KFwiY2hpbGRfcmVjZWl2ZWRfYXRfbXNcIiwge251bGw6IHRydWV9KVxuICAgIHRhYmxlLmJpZ2ludChcImNoaWxkX3N0YXJ0ZWRfYXRfbXNcIiwge251bGw6IHRydWV9KVxuICAgIHRhYmxlLnN0cmluZyhcImNoaWxkX2luc3RhbmNlX2lkXCIsIHtudWxsOiB0cnVlfSlcbiAgICB0YWJsZS5pbnRlZ2VyKFwiY2hpbGRfcGlkXCIsIHtudWxsOiB0cnVlfSlcblxuICAgIGF3YWl0IGRiLmNyZWF0ZVRhYmxlKHRhYmxlKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZW5zdXJlIGpvYnMgdGFibGUgY29sdW1ucy5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9kYXRhYmFzZS9kcml2ZXJzL2Jhc2UuanNcIikuZGVmYXVsdH0gZGIgLSBEYXRhYmFzZSBjb25uZWN0aW9uLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyB3aGVuIGNvbXBsZXRlLlxuICAgKi9cbiAgYXN5bmMgX2Vuc3VyZUpvYnNUYWJsZUNvbHVtbnMoZGIpIHtcbiAgICBpZiAoIShhd2FpdCBkYi50YWJsZUV4aXN0cyhKT0JTX1RBQkxFKSkpIHJldHVyblxuXG4gICAgY29uc3QgdGFibGUgPSBhd2FpdCBkYi5nZXRUYWJsZUJ5TmFtZU9yRmFpbChKT0JTX1RBQkxFKVxuICAgIGNvbnN0IGV4ZWN1dGlvbk1vZGVDb2x1bW4gPSBhd2FpdCB0YWJsZS5nZXRDb2x1bW5CeU5hbWUoXCJleGVjdXRpb25fbW9kZVwiKVxuXG4gICAgaWYgKCFleGVjdXRpb25Nb2RlQ29sdW1uKSB7XG4gICAgICBjb25zdCB0YWJsZURhdGEgPSBuZXcgVGFibGVEYXRhKEpPQlNfVEFCTEUpXG4gICAgICB0YWJsZURhdGEuc3RyaW5nKFwiZXhlY3V0aW9uX21vZGVcIiwge251bGw6IHRydWV9KVxuICAgICAgY29uc3Qgc3FscyA9IGF3YWl0IGRiLmFsdGVyVGFibGVTUUxzKHRhYmxlRGF0YSlcblxuICAgICAgZm9yIChjb25zdCBzcWwgb2Ygc3Fscykge1xuICAgICAgICBhd2FpdCBkYi5xdWVyeShzcWwpXG4gICAgICB9XG5cbiAgICAgIGRiLmNsZWFyU2NoZW1hQ2FjaGUoKVxuICAgIH1cblxuICAgIGNvbnN0IHJlZnJlc2hlZFRhYmxlID0gYXdhaXQgZGIuZ2V0VGFibGVCeU5hbWVPckZhaWwoSk9CU19UQUJMRSlcbiAgICBjb25zdCBoYW5kb2ZmSWRDb2x1bW4gPSBhd2FpdCByZWZyZXNoZWRUYWJsZS5nZXRDb2x1bW5CeU5hbWUoXCJoYW5kb2ZmX2lkXCIpXG5cbiAgICBpZiAoIWhhbmRvZmZJZENvbHVtbikge1xuICAgICAgY29uc3QgbG9ja05hbWUgPSBgJHtNSUdSQVRJT05fU0NPUEV9OmhhbmRvZmZfaWRfY29sdW1uYFxuICAgICAgY29uc3QgYWNxdWlyZWQgPSBhd2FpdCBkYi5hY3F1aXJlQWR2aXNvcnlMb2NrKGxvY2tOYW1lKVxuXG4gICAgICBpZiAoIWFjcXVpcmVkKSB0aHJvdyBuZXcgRXJyb3IoXCJGYWlsZWQgdG8gYWNxdWlyZSBiYWNrZ3JvdW5kIGpvYnMgaGFuZG9mZiBzY2hlbWEgbG9ja1wiKVxuXG4gICAgICB0cnkge1xuICAgICAgICBkYi5jbGVhclNjaGVtYUNhY2hlKClcbiAgICAgICAgY29uc3QgbG9ja2VkVGFibGUgPSBhd2FpdCBkYi5nZXRUYWJsZUJ5TmFtZU9yRmFpbChKT0JTX1RBQkxFKVxuXG4gICAgICAgIGlmICghKGF3YWl0IGxvY2tlZFRhYmxlLmdldENvbHVtbkJ5TmFtZShcImhhbmRvZmZfaWRcIikpKSB7XG4gICAgICAgICAgY29uc3QgdGFibGVEYXRhID0gbmV3IFRhYmxlRGF0YShKT0JTX1RBQkxFKVxuICAgICAgICAgIHRhYmxlRGF0YS5zdHJpbmcoXCJoYW5kb2ZmX2lkXCIsIHtudWxsOiB0cnVlfSlcbiAgICAgICAgICBjb25zdCBzcWxzID0gYXdhaXQgZGIuYWx0ZXJUYWJsZVNRTHModGFibGVEYXRhKVxuXG4gICAgICAgICAgZm9yIChjb25zdCBzcWwgb2Ygc3Fscykge1xuICAgICAgICAgICAgYXdhaXQgZGIucXVlcnkoc3FsKVxuICAgICAgICAgIH1cblxuICAgICAgICAgIGRiLmNsZWFyU2NoZW1hQ2FjaGUoKVxuICAgICAgICB9XG4gICAgICB9IGZpbmFsbHkge1xuICAgICAgICBhd2FpdCBkYi5yZWxlYXNlQWR2aXNvcnlMb2NrKGxvY2tOYW1lKVxuICAgICAgfVxuICAgIH1cblxuICAgIGF3YWl0IHRoaXMuX2JhY2tmaWxsRXhlY3V0aW9uTW9kZXNPbmNlKGRiKVxuICAgIGF3YWl0IHRoaXMuX2Ryb3BGb3JrZWRDb2x1bW5PbmNlKGRiKVxuXG4gICAgY29uc3QgbG9ja05hbWUgPSBgJHtNSUdSQVRJT05fU0NPUEV9OmNvbmN1cnJlbmN5X2NvbHVtbnNgXG4gICAgY29uc3QgYWNxdWlyZWQgPSBhd2FpdCBkYi5hY3F1aXJlQWR2aXNvcnlMb2NrKGxvY2tOYW1lKVxuXG4gICAgaWYgKCFhY3F1aXJlZCkgdGhyb3cgbmV3IEVycm9yKFwiRmFpbGVkIHRvIGFjcXVpcmUgYmFja2dyb3VuZCBqb2JzIGNvbmN1cnJlbmN5IHNjaGVtYSBsb2NrXCIpXG5cbiAgICB0cnkge1xuICAgICAgLy8gU1FMIFNlcnZlciBzY2hlbWEgcmVhZHMgY2FuIGRlYWRsb2NrIHdpdGggYSBjb25jdXJyZW50IEFMVEVSIFRBQkxFLCBzb1xuICAgICAgLy8gYWNxdWlyZSB0aGUgbG9jayBiZWZvcmUgaW5zcGVjdGluZyBlaXRoZXIgY29sdW1uIHJhdGhlciB0aGFuIG9ubHlcbiAgICAgIC8vIHByb3RlY3RpbmcgdGhlIG11dGF0aW9uLlxuICAgICAgZGIuY2xlYXJTY2hlbWFDYWNoZSgpXG4gICAgICBjb25zdCBsb2NrZWRUYWJsZSA9IGF3YWl0IGRiLmdldFRhYmxlQnlOYW1lT3JGYWlsKEpPQlNfVEFCTEUpXG4gICAgICBjb25zdCBjb25jdXJyZW5jeUNvbHVtbk5hbWVzID0gW1wiY29uY3VycmVuY3lfa2V5XCIsIFwibWF4X2NvbmN1cnJlbmN5XCJdXG5cbiAgICAgIGZvciAoY29uc3QgY29uY3VycmVuY3lDb2x1bW5OYW1lIG9mIGNvbmN1cnJlbmN5Q29sdW1uTmFtZXMpIHtcbiAgICAgICAgaWYgKGF3YWl0IGxvY2tlZFRhYmxlLmdldENvbHVtbkJ5TmFtZShjb25jdXJyZW5jeUNvbHVtbk5hbWUpKSBjb250aW51ZVxuXG4gICAgICAgIGNvbnN0IHRhYmxlRGF0YSA9IG5ldyBUYWJsZURhdGEoSk9CU19UQUJMRSlcbiAgICAgICAgaWYgKGNvbmN1cnJlbmN5Q29sdW1uTmFtZSA9PSBcImNvbmN1cnJlbmN5X2tleVwiKSB7XG4gICAgICAgICAgdGFibGVEYXRhLnN0cmluZyhcImNvbmN1cnJlbmN5X2tleVwiLCB7bnVsbDogdHJ1ZSwgaW5kZXg6IHRydWV9KVxuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgIHRhYmxlRGF0YS5pbnRlZ2VyKFwibWF4X2NvbmN1cnJlbmN5XCIsIHtudWxsOiB0cnVlfSlcbiAgICAgICAgfVxuXG4gICAgICAgIGZvciAoY29uc3Qgc3FsIG9mIGF3YWl0IGRiLmFsdGVyVGFibGVTUUxzKHRhYmxlRGF0YSkpIGF3YWl0IGRiLnF1ZXJ5KHNxbClcbiAgICAgIH1cblxuICAgICAgZGIuY2xlYXJTY2hlbWFDYWNoZSgpXG4gICAgfSBmaW5hbGx5IHtcbiAgICAgIGF3YWl0IGRiLnJlbGVhc2VBZHZpc29yeUxvY2sobG9ja05hbWUpXG4gICAgfVxuXG4gICAgYXdhaXQgdGhpcy5fZW5zdXJlUXVldWVDb2x1bW4oZGIpXG4gICAgYXdhaXQgdGhpcy5fZW5zdXJlU2NoZWR1bGVLZXlDb2x1bW4oZGIpXG4gICAgYXdhaXQgdGhpcy5fZW5zdXJlSm9iVGltZW91dENvbHVtbihkYilcbiAgICBhd2FpdCB0aGlzLl9lbnN1cmVDaGlsZEFjY2VwdGFuY2VDb2x1bW5zKGRiKVxuICAgIGF3YWl0IHRoaXMuX2Vuc3VyZUpvYnNUYWJsZUluZGV4ZXNPbmNlKGRiKVxuICB9XG5cbiAgLyoqXG4gICAqIElkZW1wb3RlbnRseSBhZGRzIHRoZSBwb29sZWQtY2hpbGQgYWNjZXB0YW5jZSBldmlkZW5jZSBjb2x1bW5zIHRvIGV4aXN0aW5nXG4gICAqIGpvYiB0YWJsZXMuIFRoZXkgcmVjb3JkIHdoZW4gdGhlIGV4ZWN1dGluZyBydW5uZXIgY2hpbGQgcmVjZWl2ZWQgYW5kXG4gICAqIHN0YXJ0ZWQgYSBqb2IgcGx1cyB0aGF0IGNoaWxkJ3MgaWRlbnRpdHksIHNvIGEgaGFuZGVkLW9mZiBqb2IgY2FuIGJlIHRvbGRcbiAgICogYXBhcnQgZnJvbSBvbmUgd2hvc2UgcnVubmVyIG5ldmVyIHBpY2tlZCBpdCB1cC5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9kYXRhYmFzZS9kcml2ZXJzL2Jhc2UuanNcIikuZGVmYXVsdH0gZGIgLSBEYXRhYmFzZSBjb25uZWN0aW9uLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyB3aGVuIGVuc3VyZWQuXG4gICAqL1xuICBhc3luYyBfZW5zdXJlQ2hpbGRBY2NlcHRhbmNlQ29sdW1ucyhkYikge1xuICAgIGNvbnN0IGxvY2tOYW1lID0gYCR7TUlHUkFUSU9OX1NDT1BFfTpjaGlsZF9hY2NlcHRhbmNlX2NvbHVtbnNgXG4gICAgY29uc3QgYWNxdWlyZWQgPSBhd2FpdCBkYi5hY3F1aXJlQWR2aXNvcnlMb2NrKGxvY2tOYW1lKVxuXG4gICAgaWYgKCFhY3F1aXJlZCkgdGhyb3cgbmV3IEVycm9yKFwiRmFpbGVkIHRvIGFjcXVpcmUgYmFja2dyb3VuZCBqb2JzIGNoaWxkLWFjY2VwdGFuY2Ugc2NoZW1hIGxvY2tcIilcblxuICAgIHRyeSB7XG4gICAgICBkYi5jbGVhclNjaGVtYUNhY2hlKClcbiAgICAgIGNvbnN0IHRhYmxlID0gYXdhaXQgZGIuZ2V0VGFibGVCeU5hbWVPckZhaWwoSk9CU19UQUJMRSlcbiAgICAgIGNvbnN0IHRhYmxlRGF0YSA9IG5ldyBUYWJsZURhdGEoSk9CU19UQUJMRSlcbiAgICAgIGxldCBhZGRlZCA9IGZhbHNlXG5cbiAgICAgIGlmICghKGF3YWl0IHRhYmxlLmdldENvbHVtbkJ5TmFtZShcImNoaWxkX3JlY2VpdmVkX2F0X21zXCIpKSkge1xuICAgICAgICB0YWJsZURhdGEuYmlnaW50KFwiY2hpbGRfcmVjZWl2ZWRfYXRfbXNcIiwge251bGw6IHRydWV9KVxuICAgICAgICBhZGRlZCA9IHRydWVcbiAgICAgIH1cbiAgICAgIGlmICghKGF3YWl0IHRhYmxlLmdldENvbHVtbkJ5TmFtZShcImNoaWxkX3N0YXJ0ZWRfYXRfbXNcIikpKSB7XG4gICAgICAgIHRhYmxlRGF0YS5iaWdpbnQoXCJjaGlsZF9zdGFydGVkX2F0X21zXCIsIHtudWxsOiB0cnVlfSlcbiAgICAgICAgYWRkZWQgPSB0cnVlXG4gICAgICB9XG4gICAgICBpZiAoIShhd2FpdCB0YWJsZS5nZXRDb2x1bW5CeU5hbWUoXCJjaGlsZF9pbnN0YW5jZV9pZFwiKSkpIHtcbiAgICAgICAgdGFibGVEYXRhLnN0cmluZyhcImNoaWxkX2luc3RhbmNlX2lkXCIsIHtudWxsOiB0cnVlfSlcbiAgICAgICAgYWRkZWQgPSB0cnVlXG4gICAgICB9XG4gICAgICBpZiAoIShhd2FpdCB0YWJsZS5nZXRDb2x1bW5CeU5hbWUoXCJjaGlsZF9waWRcIikpKSB7XG4gICAgICAgIHRhYmxlRGF0YS5pbnRlZ2VyKFwiY2hpbGRfcGlkXCIsIHtudWxsOiB0cnVlfSlcbiAgICAgICAgYWRkZWQgPSB0cnVlXG4gICAgICB9XG5cbiAgICAgIGlmIChhZGRlZCkge1xuICAgICAgICBmb3IgKGNvbnN0IHNxbCBvZiBhd2FpdCBkYi5hbHRlclRhYmxlU1FMcyh0YWJsZURhdGEpKSBhd2FpdCBkYi5xdWVyeShzcWwpXG4gICAgICAgIGRiLmNsZWFyU2NoZW1hQ2FjaGUoKVxuICAgICAgfVxuICAgIH0gZmluYWxseSB7XG4gICAgICBhd2FpdCBkYi5yZWxlYXNlQWR2aXNvcnlMb2NrKGxvY2tOYW1lKVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBSZXBhaXJzIHNlY29uZGFyeSBpbmRleGVzIHRoYXQgb2xkZXIgYWRkLWNvbHVtbiB1cGdyYWRlcyBkZWNsYXJlZCBidXQgZGlkXG4gICAqIG5vdCBjcmVhdGUgb24gZXZlcnkgU1FMIGRyaXZlci4gVGhlIG1pZ3JhdGlvbiBsZWRnZXIga2VlcHMgcm91dGluZSBzdG9yZVxuICAgKiByZWFkaW5lc3MgZnJvbSByZXBlYXRlZGx5IGludHJvc3BlY3RpbmcgdGhlIGZ1bGwgaW5kZXggc2V0LlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL2RhdGFiYXNlL2RyaXZlcnMvYmFzZS5qc1wiKS5kZWZhdWx0fSBkYiAtIERhdGFiYXNlIGNvbm5lY3Rpb24uXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIHdoZW4gYWxsIGV4cGVjdGVkIGluZGV4ZXMgZXhpc3QuXG4gICAqL1xuICBhc3luYyBfZW5zdXJlSm9ic1RhYmxlSW5kZXhlc09uY2UoZGIpIHtcbiAgICBjb25zdCBtaWdyYXRpb25WZXJzaW9uID0gSk9CU19JTkRFWF9SRVBBSVJfTUlHUkFUSU9OX1ZFUlNJT05cbiAgICBjb25zdCBtaWdyYXRpb25LZXkgPSB0aGlzLl9taWdyYXRpb25LZXkobWlncmF0aW9uVmVyc2lvbilcblxuICAgIGlmIChhd2FpdCB0aGlzLl9oYXNNaWdyYXRpb24oZGIsIG1pZ3JhdGlvblZlcnNpb24pKSByZXR1cm5cblxuICAgIGNvbnN0IGFjcXVpcmVkID0gYXdhaXQgZGIuYWNxdWlyZUFkdmlzb3J5TG9jayhtaWdyYXRpb25LZXkpXG5cbiAgICBpZiAoIWFjcXVpcmVkKSB0aHJvdyBuZXcgRXJyb3IoXCJGYWlsZWQgdG8gYWNxdWlyZSBiYWNrZ3JvdW5kIGpvYnMgaW5kZXggcmVwYWlyIGxvY2tcIilcblxuICAgIHRyeSB7XG4gICAgICBpZiAoYXdhaXQgdGhpcy5faGFzTWlncmF0aW9uKGRiLCBtaWdyYXRpb25WZXJzaW9uKSkgcmV0dXJuXG5cbiAgICAgIGRiLmNsZWFyU2NoZW1hQ2FjaGUoKVxuICAgICAgY29uc3QgdGFibGUgPSBhd2FpdCBkYi5nZXRUYWJsZUJ5TmFtZU9yRmFpbChKT0JTX1RBQkxFKVxuICAgICAgY29uc3QgaW5kZXhlZENvbHVtbk5hbWVzID0gbmV3IFNldChcbiAgICAgICAgKGF3YWl0IHRhYmxlLmdldEluZGV4ZXMoKSlcbiAgICAgICAgICAuZmlsdGVyKChpbmRleCkgPT4gIWluZGV4LmlzUHJpbWFyeUtleSgpICYmIGluZGV4LmdldENvbHVtbk5hbWVzKCkubGVuZ3RoID09PSAxKVxuICAgICAgICAgIC5tYXAoKGluZGV4KSA9PiBpbmRleC5nZXRDb2x1bW5OYW1lcygpWzBdKVxuICAgICAgKVxuXG4gICAgICBmb3IgKGNvbnN0IGNvbHVtbk5hbWUgb2YgSk9CU19JTkRFWF9DT0xVTU5fTkFNRVMpIHtcbiAgICAgICAgaWYgKGluZGV4ZWRDb2x1bW5OYW1lcy5oYXMoY29sdW1uTmFtZSkpIGNvbnRpbnVlXG5cbiAgICAgICAgZm9yIChjb25zdCBzcWwgb2YgYXdhaXQgZGIuY3JlYXRlSW5kZXhTUUxzKHtjb2x1bW5zOiBbY29sdW1uTmFtZV0sIGlmTm90RXhpc3RzOiBkYi5nZXRUeXBlKCkgPT09IFwic3FsaXRlXCIsIHRhYmxlTmFtZTogSk9CU19UQUJMRX0pKSB7XG4gICAgICAgICAgYXdhaXQgZGIucXVlcnkoc3FsKVxuICAgICAgICB9XG4gICAgICB9XG5cbiAgICAgIGRiLmNsZWFyU2NoZW1hQ2FjaGUoKVxuICAgICAgYXdhaXQgdGhpcy5fcmVjb3JkTWlncmF0aW9uKGRiLCBtaWdyYXRpb25WZXJzaW9uKVxuICAgIH0gZmluYWxseSB7XG4gICAgICBhd2FpdCBkYi5yZWxlYXNlQWR2aXNvcnlMb2NrKG1pZ3JhdGlvbktleSlcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogSWRlbXBvdGVudGx5IGFkZHMgdGhlIHBlci1qb2Igd2FsbC1jbG9jayB0aW1lb3V0IHRvIGV4aXN0aW5nIGpvYiB0YWJsZXMuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vZGF0YWJhc2UvZHJpdmVycy9iYXNlLmpzXCIpLmRlZmF1bHR9IGRiIC0gRGF0YWJhc2UgY29ubmVjdGlvbi5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgd2hlbiBlbnN1cmVkLlxuICAgKi9cbiAgYXN5bmMgX2Vuc3VyZUpvYlRpbWVvdXRDb2x1bW4oZGIpIHtcbiAgICBjb25zdCBsb2NrTmFtZSA9IGAke01JR1JBVElPTl9TQ09QRX06dGltZW91dF9tc19jb2x1bW5gXG4gICAgY29uc3QgYWNxdWlyZWQgPSBhd2FpdCBkYi5hY3F1aXJlQWR2aXNvcnlMb2NrKGxvY2tOYW1lKVxuXG4gICAgaWYgKCFhY3F1aXJlZCkgdGhyb3cgbmV3IEVycm9yKFwiRmFpbGVkIHRvIGFjcXVpcmUgYmFja2dyb3VuZCBqb2JzIHRpbWVvdXQgc2NoZW1hIGxvY2tcIilcblxuICAgIHRyeSB7XG4gICAgICBkYi5jbGVhclNjaGVtYUNhY2hlKClcbiAgICAgIGNvbnN0IHRhYmxlID0gYXdhaXQgZGIuZ2V0VGFibGVCeU5hbWVPckZhaWwoSk9CU19UQUJMRSlcblxuICAgICAgaWYgKCEoYXdhaXQgdGFibGUuZ2V0Q29sdW1uQnlOYW1lKFwidGltZW91dF9tc1wiKSkpIHtcbiAgICAgICAgY29uc3QgdGFibGVEYXRhID0gbmV3IFRhYmxlRGF0YShKT0JTX1RBQkxFKVxuICAgICAgICB0YWJsZURhdGEuYmlnaW50KFwidGltZW91dF9tc1wiLCB7bnVsbDogdHJ1ZX0pXG5cbiAgICAgICAgZm9yIChjb25zdCBzcWwgb2YgYXdhaXQgZGIuYWx0ZXJUYWJsZVNRTHModGFibGVEYXRhKSkgYXdhaXQgZGIucXVlcnkoc3FsKVxuXG4gICAgICAgIGRiLmNsZWFyU2NoZW1hQ2FjaGUoKVxuICAgICAgfVxuICAgIH0gZmluYWxseSB7XG4gICAgICBhd2FpdCBkYi5yZWxlYXNlQWR2aXNvcnlMb2NrKGxvY2tOYW1lKVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBJZGVtcG90ZW50bHkgYWRkcyB0aGUgaGlzdG9yaWNhbCBzdGFibGUgc2NoZWR1bGUga2V5IHRvIGV4aXN0aW5nIGpvYnMuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vZGF0YWJhc2UvZHJpdmVycy9iYXNlLmpzXCIpLmRlZmF1bHR9IGRiIC0gRGF0YWJhc2UgY29ubmVjdGlvbi5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgd2hlbiBlbnN1cmVkLlxuICAgKi9cbiAgYXN5bmMgX2Vuc3VyZVNjaGVkdWxlS2V5Q29sdW1uKGRiKSB7XG4gICAgY29uc3QgbG9ja05hbWUgPSBgJHtNSUdSQVRJT05fU0NPUEV9OnNjaGVkdWxlX2tleV9jb2x1bW5gXG4gICAgY29uc3QgYWNxdWlyZWQgPSBhd2FpdCBkYi5hY3F1aXJlQWR2aXNvcnlMb2NrKGxvY2tOYW1lKVxuXG4gICAgaWYgKCFhY3F1aXJlZCkgdGhyb3cgbmV3IEVycm9yKFwiRmFpbGVkIHRvIGFjcXVpcmUgYmFja2dyb3VuZCBqb2JzIHNjaGVkdWxlLWtleSBzY2hlbWEgbG9ja1wiKVxuXG4gICAgdHJ5IHtcbiAgICAgIGRiLmNsZWFyU2NoZW1hQ2FjaGUoKVxuICAgICAgY29uc3QgbG9ja2VkVGFibGUgPSBhd2FpdCBkYi5nZXRUYWJsZUJ5TmFtZU9yRmFpbChKT0JTX1RBQkxFKVxuXG4gICAgICBpZiAoIShhd2FpdCBsb2NrZWRUYWJsZS5nZXRDb2x1bW5CeU5hbWUoXCJzY2hlZHVsZV9rZXlcIikpKSB7XG4gICAgICAgIGNvbnN0IHRhYmxlRGF0YSA9IG5ldyBUYWJsZURhdGEoSk9CU19UQUJMRSlcblxuICAgICAgICB0YWJsZURhdGEuc3RyaW5nKFwic2NoZWR1bGVfa2V5XCIsIHtudWxsOiB0cnVlLCBpbmRleDogdHJ1ZX0pXG5cbiAgICAgICAgZm9yIChjb25zdCBzcWwgb2YgYXdhaXQgZGIuYWx0ZXJUYWJsZVNRTHModGFibGVEYXRhKSkgYXdhaXQgZGIucXVlcnkoc3FsKVxuXG4gICAgICAgIGRiLmNsZWFyU2NoZW1hQ2FjaGUoKVxuICAgICAgfVxuICAgIH0gZmluYWxseSB7XG4gICAgICBhd2FpdCBkYi5yZWxlYXNlQWR2aXNvcnlMb2NrKGxvY2tOYW1lKVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBJZGVtcG90ZW50bHkgYWRkcyB0aGUgYHF1ZXVlYCBjb2x1bW4gdG8gYW4gZXhpc3Rpbmcgam9icyB0YWJsZS4gRXhpc3RpbmdcbiAgICogcm93cyByZWFkIGJhY2sgYXMgdGhlIGRlZmF1bHQgcXVldWUgKHNlZSB7QGxpbmsgX25vcm1hbGl6ZUpvYlJvd30pLCBzbyBub1xuICAgKiBkYXRhIGJhY2tmaWxsIGlzIHJlcXVpcmVkLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL2RhdGFiYXNlL2RyaXZlcnMvYmFzZS5qc1wiKS5kZWZhdWx0fSBkYiAtIERhdGFiYXNlIGNvbm5lY3Rpb24uXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIHdoZW4gZW5zdXJlZC5cbiAgICovXG4gIGFzeW5jIF9lbnN1cmVRdWV1ZUNvbHVtbihkYikge1xuICAgIGNvbnN0IGxvY2tOYW1lID0gYCR7TUlHUkFUSU9OX1NDT1BFfTpxdWV1ZV9jb2x1bW5gXG4gICAgY29uc3QgYWNxdWlyZWQgPSBhd2FpdCBkYi5hY3F1aXJlQWR2aXNvcnlMb2NrKGxvY2tOYW1lKVxuXG4gICAgaWYgKCFhY3F1aXJlZCkgdGhyb3cgbmV3IEVycm9yKFwiRmFpbGVkIHRvIGFjcXVpcmUgYmFja2dyb3VuZCBqb2JzIHF1ZXVlIHNjaGVtYSBsb2NrXCIpXG5cbiAgICB0cnkge1xuICAgICAgLy8gU1FMIFNlcnZlciBzY2hlbWEgcmVhZHMgY2FuIGRlYWRsb2NrIHdpdGggYSBjb25jdXJyZW50IEFMVEVSIFRBQkxFLCBzb1xuICAgICAgLy8gYWNxdWlyZSB0aGUgbG9jayBiZWZvcmUgaW5zcGVjdGluZyB0aGUgY29sdW1uIHJhdGhlciB0aGFuIG9ubHlcbiAgICAgIC8vIHByb3RlY3RpbmcgdGhlIG11dGF0aW9uIChtaXJyb3JzIHRoZSBjb25jdXJyZW5jeS1jb2x1bW4gbWlncmF0aW9uKS5cbiAgICAgIGRiLmNsZWFyU2NoZW1hQ2FjaGUoKVxuICAgICAgY29uc3QgbG9ja2VkVGFibGUgPSBhd2FpdCBkYi5nZXRUYWJsZUJ5TmFtZU9yRmFpbChKT0JTX1RBQkxFKVxuXG4gICAgICBpZiAoIShhd2FpdCBsb2NrZWRUYWJsZS5nZXRDb2x1bW5CeU5hbWUoXCJxdWV1ZVwiKSkpIHtcbiAgICAgICAgY29uc3QgdGFibGVEYXRhID0gbmV3IFRhYmxlRGF0YShKT0JTX1RBQkxFKVxuXG4gICAgICAgIHRhYmxlRGF0YS5zdHJpbmcoXCJxdWV1ZVwiLCB7bnVsbDogdHJ1ZSwgaW5kZXg6IHRydWV9KVxuXG4gICAgICAgIGZvciAoY29uc3Qgc3FsIG9mIGF3YWl0IGRiLmFsdGVyVGFibGVTUUxzKHRhYmxlRGF0YSkpIGF3YWl0IGRiLnF1ZXJ5KHNxbClcblxuICAgICAgICBkYi5jbGVhclNjaGVtYUNhY2hlKClcbiAgICAgIH1cbiAgICB9IGZpbmFsbHkge1xuICAgICAgYXdhaXQgZGIucmVsZWFzZUFkdmlzb3J5TG9jayhsb2NrTmFtZSlcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogUnVucyBiYWNrZmlsbCBleGVjdXRpb24gbW9kZXMgb25jZS5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9kYXRhYmFzZS9kcml2ZXJzL2Jhc2UuanNcIikuZGVmYXVsdH0gZGIgLSBEYXRhYmFzZSBjb25uZWN0aW9uLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyB3aGVuIGNvbXBsZXRlLlxuICAgKi9cbiAgYXN5bmMgX2JhY2tmaWxsRXhlY3V0aW9uTW9kZXNPbmNlKGRiKSB7XG4gICAgY29uc3QgbWlncmF0aW9uVmVyc2lvbiA9IEVYRUNVVElPTl9NT0RFX0JBQ0tGSUxMX01JR1JBVElPTl9WRVJTSU9OXG4gICAgY29uc3QgbWlncmF0aW9uS2V5ID0gdGhpcy5fbWlncmF0aW9uS2V5KG1pZ3JhdGlvblZlcnNpb24pXG5cbiAgICBpZiAoYXdhaXQgdGhpcy5faGFzTWlncmF0aW9uKGRiLCBtaWdyYXRpb25WZXJzaW9uKSkgcmV0dXJuXG5cbiAgICBhd2FpdCBkYi5hY3F1aXJlQWR2aXNvcnlMb2NrKG1pZ3JhdGlvbktleSlcblxuICAgIHRyeSB7XG4gICAgICBpZiAoYXdhaXQgdGhpcy5faGFzTWlncmF0aW9uKGRiLCBtaWdyYXRpb25WZXJzaW9uKSkgcmV0dXJuXG5cbiAgICAgIC8vIEEgdGFibGUgY3JlYXRlZCBhZnRlciB0aGUgYGZvcmtlZGAgY29sdW1uIHdhcyBkcm9wcGVkIGhhcyBub3RoaW5nIHRvXG4gICAgICAvLyBiYWNrZmlsbCBmcm9tOyByZWNvcmQgdGhlIG1pZ3JhdGlvbiBzbyBpdCBpcyBub3QgcmUtYXR0ZW1wdGVkLlxuICAgICAgZGIuY2xlYXJTY2hlbWFDYWNoZSgpXG4gICAgICBpZiAoIShhd2FpdCAoYXdhaXQgZGIuZ2V0VGFibGVCeU5hbWVPckZhaWwoSk9CU19UQUJMRSkpLmdldENvbHVtbkJ5TmFtZShcImZvcmtlZFwiKSkpIHtcbiAgICAgICAgYXdhaXQgdGhpcy5fcmVjb3JkTWlncmF0aW9uKGRiLCBtaWdyYXRpb25WZXJzaW9uKVxuICAgICAgICByZXR1cm5cbiAgICAgIH1cblxuICAgICAgY29uc3QgdGFibGVOYW1lU3FsID0gZGIucXVvdGVUYWJsZShKT0JTX1RBQkxFKVxuICAgICAgY29uc3QgZm9ya2VkQ29sdW1uU3FsID0gZGIucXVvdGVDb2x1bW4oXCJmb3JrZWRcIilcbiAgICAgIGNvbnN0IGV4ZWN1dGlvbk1vZGVDb2x1bW5TcWwgPSBkYi5xdW90ZUNvbHVtbihcImV4ZWN1dGlvbl9tb2RlXCIpXG5cbiAgICAgIGF3YWl0IGRiLnF1ZXJ5KFxuICAgICAgICBgVVBEQVRFICR7dGFibGVOYW1lU3FsfSBTRVQgJHtleGVjdXRpb25Nb2RlQ29sdW1uU3FsfSA9ICR7ZGIucXVvdGUoXCJmb3JrZWRcIil9IGAgK1xuICAgICAgICBgV0hFUkUgJHtmb3JrZWRDb2x1bW5TcWx9ID0gJHtkYi5xdW90ZSh0cnVlKX0gQU5EICR7ZXhlY3V0aW9uTW9kZUNvbHVtblNxbH0gSVMgTlVMTGBcbiAgICAgIClcbiAgICAgIGF3YWl0IGRiLnF1ZXJ5KFxuICAgICAgICBgVVBEQVRFICR7dGFibGVOYW1lU3FsfSBTRVQgJHtleGVjdXRpb25Nb2RlQ29sdW1uU3FsfSA9ICR7ZGIucXVvdGUoXCJpbmxpbmVcIil9IGAgK1xuICAgICAgICBgV0hFUkUgJHtmb3JrZWRDb2x1bW5TcWx9ID0gJHtkYi5xdW90ZShmYWxzZSl9IEFORCAke2V4ZWN1dGlvbk1vZGVDb2x1bW5TcWx9IElTIE5VTExgXG4gICAgICApXG5cbiAgICAgIGF3YWl0IHRoaXMuX3JlY29yZE1pZ3JhdGlvbihkYiwgbWlncmF0aW9uVmVyc2lvbilcbiAgICB9IGZpbmFsbHkge1xuICAgICAgYXdhaXQgZGIucmVsZWFzZUFkdmlzb3J5TG9jayhtaWdyYXRpb25LZXkpXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIFJld3JpdGVzIHByZS1leGlzdGluZyBwb29sZWQgcm93cyAocGVyc2lzdGVkIGFzIGBleGVjdXRpb25fbW9kZSA9IFwiZm9ya2VkXCJgXG4gICAqIHBsdXMgYSBgdmVsb2Npb3VzLXBvb2xlZDoqYCBoYW5kb2ZmIG1hcmtlcikgdG8gYGV4ZWN1dGlvbl9tb2RlID0gXCJwb29sZWRcImAsXG4gICAqIGNsZWFycyB0aGUgcXVldWVkIG1hcmtlciwgdGhlbiBkcm9wcyB0aGUgbm93LXJlZHVuZGFudCBgZm9ya2VkYCBjb2x1bW4gc29cbiAgICogYGV4ZWN1dGlvbl9tb2RlYCBpcyB0aGUgc2luZ2xlIHNvdXJjZSBvZiB0cnV0aC4gUnVucyBvbmNlLCBndWFyZGVkIGJ5IHRoZVxuICAgKiBtaWdyYXRpb24gbGVkZ2VyIGFuZCBhIHBlci1rZXkgYWR2aXNvcnkgbG9jazsgYSBmcmVzaCB0YWJsZSAoY3JlYXRlZCB3aXRob3V0XG4gICAqIHRoZSBjb2x1bW4pIHNob3J0LWNpcmN1aXRzLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL2RhdGFiYXNlL2RyaXZlcnMvYmFzZS5qc1wiKS5kZWZhdWx0fSBkYiAtIERhdGFiYXNlIGNvbm5lY3Rpb24uXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIHdoZW4gY29tcGxldGUuXG4gICAqL1xuICBhc3luYyBfZHJvcEZvcmtlZENvbHVtbk9uY2UoZGIpIHtcbiAgICBjb25zdCBtaWdyYXRpb25WZXJzaW9uID0gRFJPUF9GT1JLRURfQ09MVU1OX01JR1JBVElPTl9WRVJTSU9OXG4gICAgY29uc3QgbWlncmF0aW9uS2V5ID0gdGhpcy5fbWlncmF0aW9uS2V5KG1pZ3JhdGlvblZlcnNpb24pXG5cbiAgICBpZiAoYXdhaXQgdGhpcy5faGFzTWlncmF0aW9uKGRiLCBtaWdyYXRpb25WZXJzaW9uKSkgcmV0dXJuXG5cbiAgICBhd2FpdCBkYi5hY3F1aXJlQWR2aXNvcnlMb2NrKG1pZ3JhdGlvbktleSlcblxuICAgIHRyeSB7XG4gICAgICBpZiAoYXdhaXQgdGhpcy5faGFzTWlncmF0aW9uKGRiLCBtaWdyYXRpb25WZXJzaW9uKSkgcmV0dXJuXG5cbiAgICAgIGRiLmNsZWFyU2NoZW1hQ2FjaGUoKVxuXG4gICAgICBpZiAoYXdhaXQgKGF3YWl0IGRiLmdldFRhYmxlQnlOYW1lT3JGYWlsKEpPQlNfVEFCTEUpKS5nZXRDb2x1bW5CeU5hbWUoXCJmb3JrZWRcIikpIHtcbiAgICAgICAgY29uc3QgdGFibGVOYW1lU3FsID0gZGIucXVvdGVUYWJsZShKT0JTX1RBQkxFKVxuICAgICAgICBjb25zdCBleGVjdXRpb25Nb2RlQ29sdW1uU3FsID0gZGIucXVvdGVDb2x1bW4oXCJleGVjdXRpb25fbW9kZVwiKVxuICAgICAgICBjb25zdCBoYW5kb2ZmSWRDb2x1bW5TcWwgPSBkYi5xdW90ZUNvbHVtbihcImhhbmRvZmZfaWRcIilcblxuICAgICAgICAvLyBQb29sZWQgcm93cyB1c2VkIHRvIHBlcnNpc3QgYXMgZXhlY3V0aW9uX21vZGUgXCJmb3JrZWRcIiArIGEgcG9vbGVkIGhhbmRvZmZcbiAgICAgICAgLy8gbWFya2VyOyByZWNvdmVyIHRoZWlyIHJlYWwgbW9kZSBiZWZvcmUgdGhlIG1hcmtlciBpcyBjbGVhcmVkLlxuICAgICAgICBhd2FpdCBkYi5xdWVyeShcbiAgICAgICAgICBgVVBEQVRFICR7dGFibGVOYW1lU3FsfSBTRVQgJHtleGVjdXRpb25Nb2RlQ29sdW1uU3FsfSA9ICR7ZGIucXVvdGUoXCJwb29sZWRcIil9IGAgK1xuICAgICAgICAgIGBXSEVSRSAke2V4ZWN1dGlvbk1vZGVDb2x1bW5TcWx9ID0gJHtkYi5xdW90ZShcImZvcmtlZFwiKX0gYCArXG4gICAgICAgICAgYEFORCAke2hhbmRvZmZJZENvbHVtblNxbH0gTElLRSAke2RiLnF1b3RlKGAke0xFR0FDWV9QT09MRURfSEFORE9GRl9JRF9QUkVGSVh9JWApfWBcbiAgICAgICAgKVxuICAgICAgICAvLyBUaGUgcXVldWVkLXBvb2xlZCBtYXJrZXIgd2FzIGEgc2VudGluZWwsIG5vdCBhIHJlYWwgbGVhc2U7IGNsZWFyIGl0LlxuICAgICAgICBhd2FpdCBkYi5xdWVyeShcbiAgICAgICAgICBgVVBEQVRFICR7dGFibGVOYW1lU3FsfSBTRVQgJHtoYW5kb2ZmSWRDb2x1bW5TcWx9ID0gTlVMTCBgICtcbiAgICAgICAgICBgV0hFUkUgJHtoYW5kb2ZmSWRDb2x1bW5TcWx9ID0gJHtkYi5xdW90ZShMRUdBQ1lfUE9PTEVEX1FVRVVFRF9IQU5ET0ZGX0lEKX1gXG4gICAgICAgIClcblxuICAgICAgICBjb25zdCBkcm9wRm9ya2VkID0gbmV3IFRhYmxlRGF0YShKT0JTX1RBQkxFKVxuICAgICAgICBkcm9wRm9ya2VkLmFkZENvbHVtbihcImZvcmtlZFwiLCB7ZHJvcENvbHVtbjogdHJ1ZX0pXG4gICAgICAgIGZvciAoY29uc3Qgc3FsIG9mIGF3YWl0IGRiLmFsdGVyVGFibGVTUUxzKGRyb3BGb3JrZWQpKSBhd2FpdCBkYi5xdWVyeShzcWwpXG5cbiAgICAgICAgZGIuY2xlYXJTY2hlbWFDYWNoZSgpXG4gICAgICB9XG5cbiAgICAgIGF3YWl0IHRoaXMuX3JlY29yZE1pZ3JhdGlvbihkYiwgbWlncmF0aW9uVmVyc2lvbilcbiAgICB9IGZpbmFsbHkge1xuICAgICAgYXdhaXQgZGIucmVsZWFzZUFkdmlzb3J5TG9jayhtaWdyYXRpb25LZXkpXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgcmVjb3JkIG1pZ3JhdGlvbi5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9kYXRhYmFzZS9kcml2ZXJzL2Jhc2UuanNcIikuZGVmYXVsdH0gZGIgLSBEYXRhYmFzZSBjb25uZWN0aW9uLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gdmVyc2lvbiAtIE1pZ3JhdGlvbiB2ZXJzaW9uLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyB3aGVuIGNvbXBsZXRlLlxuICAgKi9cbiAgYXN5bmMgX3JlY29yZE1pZ3JhdGlvbihkYiwgdmVyc2lvbikge1xuICAgIGF3YWl0IGRiLnVwc2VydCh7XG4gICAgICB0YWJsZU5hbWU6IE1JR1JBVElPTlNfVEFCTEUsXG4gICAgICBkYXRhOiB7XG4gICAgICAgIGtleTogdGhpcy5fbWlncmF0aW9uS2V5KHZlcnNpb24pLFxuICAgICAgICBzY29wZTogTUlHUkFUSU9OX1NDT1BFLFxuICAgICAgICB2ZXJzaW9uLFxuICAgICAgICBhcHBsaWVkX2F0X21zOiBEYXRlLm5vdygpXG4gICAgICB9LFxuICAgICAgY29uZmxpY3RDb2x1bW5zOiBbXCJrZXlcIl0sXG4gICAgICB1cGRhdGVDb2x1bW5zOiBbXCJzY29wZVwiLCBcInZlcnNpb25cIiwgXCJhcHBsaWVkX2F0X21zXCJdXG4gICAgfSlcbiAgfVxuXG4gIGFzeW5jIF9pbml0aWFsaXplTW9kZWwoKSB7XG4gICAgaWYgKEJhY2tncm91bmRKb2JSZWNvcmQuaXNJbml0aWFsaXplZCgpKSByZXR1cm5cblxuICAgIEJhY2tncm91bmRKb2JSZWNvcmQuc2V0RGF0YWJhc2VJZGVudGlmaWVyKHRoaXMuZ2V0RGF0YWJhc2VJZGVudGlmaWVyKCkpXG4gICAgY29uc3QgcG9vbCA9IHRoaXMuY29uZmlndXJhdGlvbi5nZXREYXRhYmFzZVBvb2wodGhpcy5nZXREYXRhYmFzZUlkZW50aWZpZXIoKSlcblxuICAgIGF3YWl0IHBvb2wud2l0aENvbm5lY3Rpb24oe25hbWU6IFwiQmFja2dyb3VuZCBqb2JzIHN0b3JlIGluaXRpYWxpemUgbW9kZWxcIn0sIGFzeW5jICgpID0+IHtcbiAgICAgIGF3YWl0IEJhY2tncm91bmRKb2JSZWNvcmQuaW5pdGlhbGl6ZVJlY29yZCh7Y29uZmlndXJhdGlvbjogdGhpcy5jb25maWd1cmF0aW9ufSlcbiAgICB9KVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZ2V0IGpvYiByb3cgYnkgaWQuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vZGF0YWJhc2UvZHJpdmVycy9iYXNlLmpzXCIpLmRlZmF1bHR9IGRiIC0gRGF0YWJhc2UgY29ubmVjdGlvbi5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGpvYklkIC0gSm9iIGlkLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxpbXBvcnQoXCIuL3R5cGVzLmpzXCIpLkJhY2tncm91bmRKb2JSb3cgfCBudWxsPn0gLSBKb2Igcm93LlxuICAgKi9cbiAgYXN5bmMgX2dldEpvYlJvd0J5SWQoZGIsIGpvYklkKSB7XG4gICAgY29uc3QgcXVlcnkgPSBkYlxuICAgICAgLm5ld1F1ZXJ5KClcbiAgICAgIC5mcm9tKEpPQlNfVEFCTEUpXG4gICAgICAud2hlcmUoe2lkOiBqb2JJZH0pXG4gICAgICAubGltaXQoMSlcblxuICAgIGNvbnN0IHJvd3MgPSBhd2FpdCBxdWVyeS5yZXN1bHRzKClcblxuICAgIGlmICghcm93c1swXSkgcmV0dXJuIG51bGxcblxuICAgIHJldHVybiB0aGlzLl9ub3JtYWxpemVKb2JSb3cocm93c1swXSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSZWxlYXNlcyBvd25lcnNoaXAgb25seSB3aGVuIHRoZSBrZXkgc3RpbGwgcG9pbnRzIGF0IHRoZSBleHBlY3RlZCBqb2IuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vZGF0YWJhc2UvZHJpdmVycy9iYXNlLmpzXCIpLmRlZmF1bHR9IGRiIC0gRGF0YWJhc2UgY29ubmVjdGlvbi5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBPd25lcnNoaXAgaWRlbnRpdHkuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBhcmdzLmpvYklkIC0gRXhwZWN0ZWQgb3duZXIgam9iIGlkLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gYXJncy5zY2hlZHVsZUtleSAtIFN0YWJsZSBzY2hlZHVsZSBrZXkuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIHdoZW4gZGVsZXRlZCBvciBhbHJlYWR5IHN1cGVyc2VkZWQuXG4gICAqL1xuICBhc3luYyBfcmVsZWFzZVNjaGVkdWxlT3duZXJzaGlwKGRiLCB7am9iSWQsIHNjaGVkdWxlS2V5fSkge1xuICAgIGF3YWl0IGRiLmRlbGV0ZSh7XG4gICAgICB0YWJsZU5hbWU6IFNDSEVEVUxFX0tFWVNfVEFCTEUsXG4gICAgICBjb25kaXRpb25zOiB7am9iX2lkOiBqb2JJZCwgc2NoZWR1bGVfa2V5OiBzY2hlZHVsZUtleX1cbiAgICB9KVxuICB9XG5cbiAgLyoqXG4gICAqIFJlbGVhc2VzIGEgam9iJ3Mgb3duZXJzaGlwIHdoZW4gaXQgaGFzIGEgaGlzdG9yaWNhbCBzY2hlZHVsZSBrZXkuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vZGF0YWJhc2UvZHJpdmVycy9iYXNlLmpzXCIpLmRlZmF1bHR9IGRiIC0gRGF0YWJhc2UgY29ubmVjdGlvbi5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL3R5cGVzLmpzXCIpLkJhY2tncm91bmRKb2JSb3d9IGpvYiAtIFRlcm1pbmFsIGpvYi5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgd2hlbiBkZWxldGVkIG9yIG5vdCBhcHBsaWNhYmxlLlxuICAgKi9cbiAgYXN5bmMgX3JlbGVhc2VTY2hlZHVsZU93bmVyc2hpcEZvckpvYihkYiwgam9iKSB7XG4gICAgaWYgKCFqb2Iuc2NoZWR1bGVLZXkpIHJldHVyblxuXG4gICAgYXdhaXQgdGhpcy5fcmVsZWFzZVNjaGVkdWxlT3duZXJzaGlwKGRiLCB7am9iSWQ6IGpvYi5pZCwgc2NoZWR1bGVLZXk6IGpvYi5zY2hlZHVsZUtleX0pXG4gIH1cblxuICAvKipcbiAgICogUnVucyBhcHBseSBmYWlsdXJlLlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIE9wdGlvbnMuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vZGF0YWJhc2UvZHJpdmVycy9iYXNlLmpzXCIpLmRlZmF1bHR9IGFyZ3MuZGIgLSBEYXRhYmFzZSBjb25uZWN0aW9uLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vdHlwZXMuanNcIikuQmFja2dyb3VuZEpvYlJvd30gYXJncy5qb2IgLSBKb2Igcm93LlxuICAgKiBAcGFyYW0ge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSBhcmdzLmVycm9yIC0gRXJyb3IuXG4gICAqIEBwYXJhbSB7Ym9vbGVhbn0gYXJncy5tYXJrT3JwaGFuZWQgLSBXaGV0aGVyIG1hcmtpbmcgb3JwaGFuZWQuXG4gICAqIEBwYXJhbSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSBbYXJncy5jb25kaXRpb25zXSAtIFVwZGF0ZSBmZW5jaW5nIGNvbmRpdGlvbnMuIERlZmF1bHRzIHRvIHRoZSBhY3RpdmUtaGFuZG9mZiBsZWFzZSBtYXRjaDsgdGhlIHRpbWUtYmFzZWQgb3JwaGFuIHN3ZWVwIG92ZXJyaWRlcyB0aGlzIHdpdGggYW4gaWQvc3RhdHVzIG1hdGNoIHNvIGl0IGNhbiByZWNsYWltIHJvd3Mgd2hvc2UgYGhhbmRvZmZfaWRgIGlzIG51bGwgKGUuZy4gaGFuZGVkIG9mZiBieSBhbiBvbGRlciB2ZWxvY2lvdXMgYmVmb3JlIGhhbmRvZmYtaWQgZmVuY2luZyBleGlzdGVkKS5cbiAgICogQHJldHVybnMge1Byb21pc2U8aW1wb3J0KFwiLi90eXBlcy5qc1wiKS5CYWNrZ3JvdW5kSm9iUm93IHwgbnVsbD59IC0gVXBkYXRlZCBqb2Igcm93IHdoZW4gdGhlIGxlYXNlIHRyYW5zaXRpb24gd29uLlxuICAgKi9cbiAgYXN5bmMgX2FwcGx5RmFpbHVyZSh7ZGIsIGpvYiwgZXJyb3IsIG1hcmtPcnBoYW5lZCwgY29uZGl0aW9uc30pIHtcbiAgICBjb25zdCBub3cgPSB0aGlzLmNsb2NrLm5vdygpXG4gICAgY29uc3QgbmV4dEF0dGVtcHQgPSAoam9iLmF0dGVtcHRzIHx8IDApICsgMVxuICAgIGNvbnN0IG1heFJldHJpZXMgPSB0aGlzLl9ub3JtYWxpemVNYXhSZXRyaWVzKGpvYi5tYXhSZXRyaWVzKVxuICAgIGNvbnN0IHNob3VsZFJldHJ5ID0gbmV4dEF0dGVtcHQgPD0gbWF4UmV0cmllc1xuICAgIGNvbnN0IGZhaWx1cmVNZXNzYWdlID0gbm9ybWFsaXplQmFja2dyb3VuZEpvYkVycm9yKGVycm9yKVxuICAgIGNvbnN0IHNjaGVkdWxlZEF0ID0gc2hvdWxkUmV0cnkgPyBub3cgKyB0aGlzLmdldFJldHJ5RGVsYXlNcyhuZXh0QXR0ZW1wdCkgOiBqb2Iuc2NoZWR1bGVkQXRNc1xuICAgIGNvbnN0IHVwZGF0ZSA9IHRoaXMuX2ZhaWx1cmVVcGRhdGUoe1xuICAgICAgZmFpbHVyZU1lc3NhZ2UsXG4gICAgICBtYXJrT3JwaGFuZWQsXG4gICAgICBuZXh0QXR0ZW1wdCxcbiAgICAgIG5vdyxcbiAgICAgIHNjaGVkdWxlZEF0LFxuICAgICAgc2hvdWxkUmV0cnlcbiAgICB9KVxuXG4gICAgYXdhaXQgdGhpcy5fbG9ja0NvbmN1cnJlbmN5Um93KGRiLCBqb2IuY29uY3VycmVuY3lLZXkpXG4gICAgY29uc3QgYWZmZWN0ZWRSb3dzID0gYXdhaXQgdGhpcy5fdXBkYXRlQWZmZWN0ZWRSb3dzKGRiLCB7XG4gICAgICB0YWJsZU5hbWU6IEpPQlNfVEFCTEUsXG4gICAgICBkYXRhOiB1cGRhdGUsXG4gICAgICBjb25kaXRpb25zOiBjb25kaXRpb25zID8/IHRoaXMuX2FjdGl2ZUhhbmRvZmZDb25kaXRpb25zKGpvYilcbiAgICB9KVxuXG4gICAgaWYgKGFmZmVjdGVkUm93cyAhPT0gMSkgcmV0dXJuIG51bGxcbiAgICBpZiAoIXNob3VsZFJldHJ5KSBhd2FpdCB0aGlzLl9yZWxlYXNlU2NoZWR1bGVPd25lcnNoaXBGb3JKb2IoZGIsIGpvYilcbiAgICBhd2FpdCB0aGlzLl9yZWxlYXNlQ29uY3VycmVuY3koZGIsIGpvYi5jb25jdXJyZW5jeUtleSlcblxuICAgIC8vIFJldHVybiBhIHNuYXBzaG90IG9mIHRoZSB0cmFuc2l0aW9uIHRoaXMgdXBkYXRlIGp1c3QgYXBwbGllZCByYXRoZXIgdGhhbiByZS1yZWFkaW5nIHRoZSByb3cuXG4gICAgLy8gV2Ugd29uIHRoZSBjb25kaXRpb25hbCB1cGRhdGUgKGFmZmVjdGVkUm93cyA9PT0gMSksIHNvIHRoaXMgc3RhdGUgaXMgYXV0aG9yaXRhdGl2ZTsgcmUtcmVhZGluZ1xuICAgIC8vIGNvdWxkIGluc3RlYWQgb2JzZXJ2ZSBhIG5ld2VyIHN0YXRlIGlmIGFub3RoZXIgZGlzcGF0Y2hlciByZWNsYWltcyBhIHJlcXVldWVkIGpvYiBiZXR3ZWVuIHRoZVxuICAgIC8vIHVwZGF0ZSBhbmQgdGhlIHJlYWQgKG92ZXJsYXBwaW5nIG1haW5zIC8gcG9sbGluZyBkaXNwYXRjaCksIHdoaWNoIHdvdWxkIG1pc3JlcG9ydCB0aGVcbiAgICAvLyBzdGF0dXMvdGVybWluYWwvd2lsbFJldHJ5IG9mIHRoaXMgdHJhbnNpdGlvbiB0byBmYWlsdXJlL29ycGhhbiBldmVudCBsaXN0ZW5lcnMuXG4gICAgY29uc3Qgc3RhdHVzID0gc2hvdWxkUmV0cnkgPyBcInF1ZXVlZFwiIDogKG1hcmtPcnBoYW5lZCA/IFwib3JwaGFuZWRcIiA6IFwiZmFpbGVkXCIpXG4gICAgLyoqIEB0eXBlIHtpbXBvcnQoXCIuL3R5cGVzLmpzXCIpLkJhY2tncm91bmRKb2JSb3d9ICovXG4gICAgY29uc3QgdHJhbnNpdGlvbmVkSm9iID0ge1xuICAgICAgLi4uam9iLFxuICAgICAgLi4uKHNob3VsZFJldHJ5ID8gdGhpcy5fY2xlYXJlZENoaWxkQWNjZXB0YW5jZVJvdygpIDoge30pLFxuICAgICAgYXR0ZW1wdHM6IG5leHRBdHRlbXB0LFxuICAgICAgaGFuZGVkT2ZmQXRNczogbnVsbCxcbiAgICAgIGxhc3RFcnJvcjogZmFpbHVyZU1lc3NhZ2UsXG4gICAgICBzdGF0dXMsXG4gICAgICB3b3JrZXJJZDogbnVsbFxuICAgIH1cblxuICAgIGlmIChtYXJrT3JwaGFuZWQpIHRyYW5zaXRpb25lZEpvYi5vcnBoYW5lZEF0TXMgPSBub3dcbiAgICBpZiAoc2hvdWxkUmV0cnkpIHtcbiAgICAgIHRyYW5zaXRpb25lZEpvYi5zY2hlZHVsZWRBdE1zID0gc2NoZWR1bGVkQXRcbiAgICB9IGVsc2UgaWYgKCFtYXJrT3JwaGFuZWQpIHtcbiAgICAgIHRyYW5zaXRpb25lZEpvYi5mYWlsZWRBdE1zID0gbm93XG4gICAgfVxuXG4gICAgcmV0dXJuIHRyYW5zaXRpb25lZEpvYlxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZmFpbHVyZSB1cGRhdGUuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gT3B0aW9ucy5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGFyZ3MuZmFpbHVyZU1lc3NhZ2UgLSBMYXN0IGZhaWx1cmUgbWVzc2FnZS5cbiAgICogQHBhcmFtIHtib29sZWFufSBhcmdzLm1hcmtPcnBoYW5lZCAtIFdoZXRoZXIgbWFya2luZyBvcnBoYW5lZC5cbiAgICogQHBhcmFtIHtudW1iZXJ9IGFyZ3MubmV4dEF0dGVtcHQgLSBOZXh0IGF0dGVtcHQgY291bnQuXG4gICAqIEBwYXJhbSB7bnVtYmVyfSBhcmdzLm5vdyAtIEN1cnJlbnQgdGltZXN0YW1wLlxuICAgKiBAcGFyYW0ge251bWJlciB8IG51bGx9IGFyZ3Muc2NoZWR1bGVkQXQgLSBOZXh0IHNjaGVkdWxlZCB0aW1lc3RhbXAuXG4gICAqIEBwYXJhbSB7Ym9vbGVhbn0gYXJncy5zaG91bGRSZXRyeSAtIFdoZXRoZXIgdGhlIGpvYiBzaG91bGQgcmV0cnkuXG4gICAqIEByZXR1cm5zIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59IC0gRGF0YWJhc2UgdXBkYXRlIGRhdGEuXG4gICAqL1xuICBfZmFpbHVyZVVwZGF0ZSh7ZmFpbHVyZU1lc3NhZ2UsIG1hcmtPcnBoYW5lZCwgbmV4dEF0dGVtcHQsIG5vdywgc2NoZWR1bGVkQXQsIHNob3VsZFJldHJ5fSkge1xuICAgIC8qKlxuICAgICAqIFVwZGF0ZS5cbiAgICAgKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSAqL1xuICAgIGNvbnN0IHVwZGF0ZSA9IHtcbiAgICAgIGF0dGVtcHRzOiBuZXh0QXR0ZW1wdCxcbiAgICAgIGhhbmRlZF9vZmZfYXRfbXM6IG51bGwsXG4gICAgICB3b3JrZXJfaWQ6IG51bGwsXG4gICAgICBsYXN0X2Vycm9yOiBmYWlsdXJlTWVzc2FnZVxuICAgIH1cblxuICAgIC8vIEEgcmV0cnkgc3RhcnRzIGEgZnJlc2ggaGFuZG9mZiB3aXRoIGEgcG9zc2libHkgZGlmZmVyZW50IHJ1bm5lciwgc28gdGhlXG4gICAgLy8gcHJldmlvdXMgY2hpbGQncyBhY2NlcHRhbmNlIGV2aWRlbmNlIG11c3Qgbm90IGxlYWsgaW50byB0aGUgbmV4dCBhdHRlbXB0LlxuICAgIC8vIFRlcm1pbmFsIGZhaWx1cmVzIGtlZXAgaXQgYXMgaGlzdG9yaWNhbCBldmlkZW5jZSBmb3IgdGhlIGxvc3QgYXR0ZW1wdC5cbiAgICBpZiAoc2hvdWxkUmV0cnkpIE9iamVjdC5hc3NpZ24odXBkYXRlLCB0aGlzLl9jbGVhcmVkQ2hpbGRBY2NlcHRhbmNlRGF0YSgpKVxuXG4gICAgdGhpcy5fYXBwbHlPcnBoYW5lZEZhaWx1cmVVcGRhdGUoe21hcmtPcnBoYW5lZCwgbm93LCB1cGRhdGV9KVxuICAgIHRoaXMuX2FwcGx5RmFpbHVyZVN0YXR1c1VwZGF0ZSh7bWFya09ycGhhbmVkLCBub3csIHNjaGVkdWxlZEF0LCBzaG91bGRSZXRyeSwgdXBkYXRlfSlcblxuICAgIHJldHVybiB1cGRhdGVcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGFwcGx5IG9ycGhhbmVkIGZhaWx1cmUgdXBkYXRlLlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIE9wdGlvbnMuXG4gICAqIEBwYXJhbSB7Ym9vbGVhbn0gYXJncy5tYXJrT3JwaGFuZWQgLSBXaGV0aGVyIG1hcmtpbmcgb3JwaGFuZWQuXG4gICAqIEBwYXJhbSB7bnVtYmVyfSBhcmdzLm5vdyAtIEN1cnJlbnQgdGltZXN0YW1wLlxuICAgKiBAcGFyYW0ge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gYXJncy51cGRhdGUgLSBEYXRhYmFzZSB1cGRhdGUgZGF0YS5cbiAgICogQHJldHVybnMge3ZvaWR9XG4gICAqL1xuICBfYXBwbHlPcnBoYW5lZEZhaWx1cmVVcGRhdGUoe21hcmtPcnBoYW5lZCwgbm93LCB1cGRhdGV9KSB7XG4gICAgaWYgKG1hcmtPcnBoYW5lZCkgdXBkYXRlLm9ycGhhbmVkX2F0X21zID0gbm93XG4gIH1cblxuICAvKipcbiAgICogUnVucyBhcHBseSBmYWlsdXJlIHN0YXR1cyB1cGRhdGUuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gT3B0aW9ucy5cbiAgICogQHBhcmFtIHtib29sZWFufSBhcmdzLm1hcmtPcnBoYW5lZCAtIFdoZXRoZXIgbWFya2luZyBvcnBoYW5lZC5cbiAgICogQHBhcmFtIHtudW1iZXJ9IGFyZ3Mubm93IC0gQ3VycmVudCB0aW1lc3RhbXAuXG4gICAqIEBwYXJhbSB7bnVtYmVyIHwgbnVsbH0gYXJncy5zY2hlZHVsZWRBdCAtIE5leHQgc2NoZWR1bGVkIHRpbWVzdGFtcC5cbiAgICogQHBhcmFtIHtib29sZWFufSBhcmdzLnNob3VsZFJldHJ5IC0gV2hldGhlciB0aGUgam9iIHNob3VsZCByZXRyeS5cbiAgICogQHBhcmFtIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59IGFyZ3MudXBkYXRlIC0gRGF0YWJhc2UgdXBkYXRlIGRhdGEuXG4gICAqIEByZXR1cm5zIHt2b2lkfVxuICAgKi9cbiAgX2FwcGx5RmFpbHVyZVN0YXR1c1VwZGF0ZSh7bWFya09ycGhhbmVkLCBub3csIHNjaGVkdWxlZEF0LCBzaG91bGRSZXRyeSwgdXBkYXRlfSkge1xuICAgIGlmIChzaG91bGRSZXRyeSkge1xuICAgICAgdXBkYXRlLnN0YXR1cyA9IFwicXVldWVkXCJcbiAgICAgIHVwZGF0ZS5zY2hlZHVsZWRfYXRfbXMgPSBzY2hlZHVsZWRBdFxuICAgICAgcmV0dXJuXG4gICAgfVxuXG4gICAgaWYgKG1hcmtPcnBoYW5lZCkge1xuICAgICAgdXBkYXRlLnN0YXR1cyA9IFwib3JwaGFuZWRcIlxuICAgICAgcmV0dXJuXG4gICAgfVxuXG4gICAgdXBkYXRlLnN0YXR1cyA9IFwiZmFpbGVkXCJcbiAgICB1cGRhdGUuZmFpbGVkX2F0X21zID0gbm93XG4gIH1cblxuICAvKipcbiAgICogUnVucyBub3JtYWxpemUgam9iIHJvdy5cbiAgICogQHBhcmFtIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59IHJvdyAtIFJhdyBkYXRhYmFzZSByb3cuXG4gICAqIEByZXR1cm5zIHtpbXBvcnQoXCIuL3R5cGVzLmpzXCIpLkJhY2tncm91bmRKb2JSb3d9IC0gTm9ybWFsaXplZCBqb2Igcm93LlxuICAgKi9cbiAgX25vcm1hbGl6ZUpvYlJvdyhyb3cpIHtcbiAgICBjb25zdCBoYW5kb2ZmSWQgPSByb3cuaGFuZG9mZl9pZCA/IFN0cmluZyhyb3cuaGFuZG9mZl9pZCkgOiBudWxsXG4gICAgLy8gYGV4ZWN1dGlvbl9tb2RlYCBpcyB0aGUgc2luZ2xlIHNvdXJjZSBvZiB0cnV0aCBmb3IgYSBqb2IncyBydW50aW1lIGFuZCBpc1xuICAgIC8vIHdyaXR0ZW4gb24gZXZlcnkgZW5xdWV1ZTsgdGhlIGRyb3AtZm9ya2VkIG1pZ3JhdGlvbiBiYWNrZmlsbHMgYW55IHByZS1leGlzdGluZ1xuICAgIC8vIHJvd3MgYmVmb3JlIHRoZSBsZWdhY3kgYGZvcmtlZGAgY29sdW1uIGlzIHJlbW92ZWQuXG4gICAgY29uc3QgZXhlY3V0aW9uTW9kZSA9IHJvdy5leGVjdXRpb25fbW9kZSA/IHRoaXMuX25vcm1hbGl6ZUV4ZWN1dGlvbk1vZGVOYW1lKFN0cmluZyhyb3cuZXhlY3V0aW9uX21vZGUpKSA6IERFRkFVTFRfQkFDS0dST1VORF9KT0JfRVhFQ1VUSU9OX01PREVcblxuICAgIHJldHVybiB7XG4gICAgICBpZDogU3RyaW5nKHJvdy5pZCksXG4gICAgICBqb2JOYW1lOiBTdHJpbmcocm93LmpvYl9uYW1lKSxcbiAgICAgIGFyZ3M6IHRoaXMuX3BhcnNlQXJncyhyb3cuYXJnc19qc29uKSxcbiAgICAgIGV4ZWN1dGlvbk1vZGUsXG4gICAgICBxdWV1ZTogcm93LnF1ZXVlID8gU3RyaW5nKHJvdy5xdWV1ZSkgOiBERUZBVUxUX0JBQ0tHUk9VTkRfSk9CX1FVRVVFLFxuICAgICAgc2NoZWR1bGVLZXk6IHJvdy5zY2hlZHVsZV9rZXkgPyBTdHJpbmcocm93LnNjaGVkdWxlX2tleSkgOiBudWxsLFxuICAgICAgc3RhdHVzOiByb3cuc3RhdHVzID8gU3RyaW5nKHJvdy5zdGF0dXMpIDogXCJxdWV1ZWRcIixcbiAgICAgIGF0dGVtcHRzOiB0aGlzLl9ub3JtYWxpemVOdW1iZXIocm93LmF0dGVtcHRzKSxcbiAgICAgIG1heFJldHJpZXM6IHRoaXMuX25vcm1hbGl6ZU51bWJlcihyb3cubWF4X3JldHJpZXMpLFxuICAgICAgc2NoZWR1bGVkQXRNczogdGhpcy5fbm9ybWFsaXplTnVtYmVyKHJvdy5zY2hlZHVsZWRfYXRfbXMpLFxuICAgICAgY3JlYXRlZEF0TXM6IHRoaXMuX25vcm1hbGl6ZU51bWJlcihyb3cuY3JlYXRlZF9hdF9tcyksXG4gICAgICBoYW5kZWRPZmZBdE1zOiB0aGlzLl9ub3JtYWxpemVOdW1iZXIocm93LmhhbmRlZF9vZmZfYXRfbXMpLFxuICAgICAgaGFuZG9mZklkLFxuICAgICAgY29tcGxldGVkQXRNczogdGhpcy5fbm9ybWFsaXplTnVtYmVyKHJvdy5jb21wbGV0ZWRfYXRfbXMpLFxuICAgICAgZmFpbGVkQXRNczogdGhpcy5fbm9ybWFsaXplTnVtYmVyKHJvdy5mYWlsZWRfYXRfbXMpLFxuICAgICAgb3JwaGFuZWRBdE1zOiB0aGlzLl9ub3JtYWxpemVOdW1iZXIocm93Lm9ycGhhbmVkX2F0X21zKSxcbiAgICAgIHdvcmtlcklkOiByb3cud29ya2VyX2lkID8gU3RyaW5nKHJvdy53b3JrZXJfaWQpIDogbnVsbCxcbiAgICAgIGxhc3RFcnJvcjogcm93Lmxhc3RfZXJyb3IgPyBTdHJpbmcocm93Lmxhc3RfZXJyb3IpIDogbnVsbCxcbiAgICAgIGNvbmN1cnJlbmN5S2V5OiByb3cuY29uY3VycmVuY3lfa2V5ID8gU3RyaW5nKHJvdy5jb25jdXJyZW5jeV9rZXkpIDogbnVsbCxcbiAgICAgIG1heENvbmN1cnJlbmN5OiB0aGlzLl9ub3JtYWxpemVOdW1iZXIocm93Lm1heF9jb25jdXJyZW5jeSksXG4gICAgICB0aW1lb3V0TXM6IHRoaXMuX25vcm1hbGl6ZU51bWJlcihyb3cudGltZW91dF9tcyksXG4gICAgICBjaGlsZFJlY2VpdmVkQXRNczogdGhpcy5fbm9ybWFsaXplTnVtYmVyKHJvdy5jaGlsZF9yZWNlaXZlZF9hdF9tcyksXG4gICAgICBjaGlsZFN0YXJ0ZWRBdE1zOiB0aGlzLl9ub3JtYWxpemVOdW1iZXIocm93LmNoaWxkX3N0YXJ0ZWRfYXRfbXMpLFxuICAgICAgY2hpbGRJbnN0YW5jZUlkOiByb3cuY2hpbGRfaW5zdGFuY2VfaWQgPyBTdHJpbmcocm93LmNoaWxkX2luc3RhbmNlX2lkKSA6IG51bGwsXG4gICAgICBjaGlsZFBpZDogdGhpcy5fbm9ybWFsaXplTnVtYmVyKHJvdy5jaGlsZF9waWQpXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIE5vcm1hbGl6ZXMgYSBqb2IncyBxdWV1ZSBuYW1lLCBkZWZhdWx0aW5nIHRvIFwiZGVmYXVsdFwiLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vdHlwZXMuanNcIikuQmFja2dyb3VuZEpvYk9wdGlvbnMgfCB1bmRlZmluZWR9IG9wdGlvbnMgLSBKb2Igb3B0aW9ucy5cbiAgICogQHJldHVybnMge3N0cmluZ30gLSBRdWV1ZSBuYW1lLlxuICAgKi9cbiAgX25vcm1hbGl6ZVF1ZXVlKG9wdGlvbnMpIHtcbiAgICByZXR1cm4gbm9ybWFsaXplQmFja2dyb3VuZEpvYlF1ZXVlKG9wdGlvbnMpXG4gIH1cblxuICAvKipcbiAgICogUmVzb2x2ZXMgYSBqb2IncyBkdXJhYmxlIGNvbmN1cnJlbmN5LiBBbiBleHBsaWNpdCBjb25jdXJyZW5jeUtleS9tYXhDb25jdXJyZW5jeVxuICAgKiBwYWlyIGFsd2F5cyB3aW5zLiBPdGhlcndpc2UsIHdoZW4gdGhlIGpvYidzIHF1ZXVlIGhhcyBhIGNvbmZpZ3VyZWQgY2FwXG4gICAqIChgYmFja2dyb3VuZEpvYnMucXVldWVzW3F1ZXVlXS5tYXhDb25jdXJyZW50YCksIGRlcml2ZSBhIHF1ZXVlLXNjb3BlZFxuICAgKiBjb25jdXJyZW5jeSBrZXkgc28gdGhlIHF1ZXVlIGNhcCBpcyBlbmZvcmNlZCBjbHVzdGVyLXdpZGUgdGhyb3VnaCB0aGVcbiAgICogZXhpc3RpbmcgZHVyYWJsZSBjb25jdXJyZW5jeSBtZWNoYW5pc20uXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi90eXBlcy5qc1wiKS5CYWNrZ3JvdW5kSm9iT3B0aW9ucyB8IHVuZGVmaW5lZH0gb3B0aW9ucyAtIEpvYiBvcHRpb25zLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gcXVldWUgLSBOb3JtYWxpemVkIHF1ZXVlIG5hbWUuXG4gICAqIEByZXR1cm5zIHt7Y29uY3VycmVuY3lLZXk6IHN0cmluZywgbWF4Q29uY3VycmVuY3k6IG51bWJlciwgcXVldWVEZXJpdmVkOiBib29sZWFufSB8IG51bGx9IC0gUmVzb2x2ZWQgY29uY3VycmVuY3kuXG4gICAqL1xuICBfcmVzb2x2ZUNvbmN1cnJlbmN5KG9wdGlvbnMsIHF1ZXVlKSB7XG4gICAgcmV0dXJuIG5vcm1hbGl6ZUJhY2tncm91bmRKb2JDb25jdXJyZW5jeSh7XG4gICAgICBvcHRpb25zOiBvcHRpb25zIHx8IHt9LFxuICAgICAgcXVldWUsXG4gICAgICBxdWV1ZXM6IHRoaXMuY29uZmlndXJhdGlvbi5nZXRCYWNrZ3JvdW5kSm9ic0NvbmZpZygpLnF1ZXVlc1xuICAgIH0pXG4gIH1cblxuICAvKipcbiAgICogQXBwbGllcyB0aGUgYWN0aXZlIGdlbmVyYXRpb24ncyBxdWV1ZSBwb2xpY3kgaW1tZWRpYXRlbHkgYmVmb3JlIGhhbmRvZmYuXG4gICAqIEV4cGxpY2l0IGNvbmN1cnJlbmN5IHJlbWFpbnMgb3duZWQgYnkgdGhlIGVucXVldWUgcmVxdWVzdC5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9kYXRhYmFzZS9kcml2ZXJzL2Jhc2UuanNcIikuZGVmYXVsdH0gZGIgLSBEYXRhYmFzZSBjb25uZWN0aW9uLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vdHlwZXMuanNcIikuQmFja2dyb3VuZEpvYlJvd30gam9iIC0gUXVldWVkIGpvYiBzbmFwc2hvdC5cbiAgICogQHJldHVybnMge1Byb21pc2U8aW1wb3J0KFwiLi90eXBlcy5qc1wiKS5CYWNrZ3JvdW5kSm9iUm93IHwgbnVsbD59IC0gUmVjb25jaWxlZCBqb2IsIG9yIG51bGwgd2hlbiBpdHMgcXVldWVkLXN0YXRlIGZlbmNlIGxvc3QuXG4gICAqL1xuICBhc3luYyBfcmVjb25jaWxlUXVldWVkSm9iQ29uY3VycmVuY3koZGIsIGpvYikge1xuICAgIGlmIChqb2IuY29uY3VycmVuY3lLZXkgJiYgIWpvYi5jb25jdXJyZW5jeUtleS5zdGFydHNXaXRoKFFVRVVFX0NPTkNVUlJFTkNZX0tFWV9QUkVGSVgpKSB7XG4gICAgICByZXR1cm4gam9iXG4gICAgfVxuXG4gICAgY29uc3QgY29uY3VycmVuY3kgPSB0aGlzLl9yZXNvbHZlQ29uY3VycmVuY3koe30sIGpvYi5xdWV1ZSlcbiAgICAvKiogQHR5cGUge0JhY2tncm91bmRKb2JRdWV1ZWRDb25jdXJyZW5jeX0gKi9cbiAgICBjb25zdCBjdXJyZW50ID0gY29uY3VycmVuY3lcbiAgICAgID8ge2NvbmN1cnJlbmN5S2V5OiBjb25jdXJyZW5jeS5jb25jdXJyZW5jeUtleSwgbWF4Q29uY3VycmVuY3k6IGNvbmN1cnJlbmN5Lm1heENvbmN1cnJlbmN5fVxuICAgICAgOiB7Y29uY3VycmVuY3lLZXk6IG51bGwsIG1heENvbmN1cnJlbmN5OiBudWxsfVxuXG4gICAgaWYgKGNvbmN1cnJlbmN5KSBhd2FpdCB0aGlzLl9lbnN1cmVRdWV1ZUNvbmN1cnJlbmN5S2V5KGRiLCBjb25jdXJyZW5jeSlcbiAgICBpZiAoam9iLmNvbmN1cnJlbmN5S2V5ID09PSBjdXJyZW50LmNvbmN1cnJlbmN5S2V5ICYmIGpvYi5tYXhDb25jdXJyZW5jeSA9PT0gY3VycmVudC5tYXhDb25jdXJyZW5jeSkgcmV0dXJuIGpvYlxuXG4gICAgY29uc3QgYWZmZWN0ZWRSb3dzID0gYXdhaXQgdGhpcy5fdXBkYXRlQWZmZWN0ZWRSb3dzKGRiLCB7XG4gICAgICB0YWJsZU5hbWU6IEpPQlNfVEFCTEUsXG4gICAgICBkYXRhOiB7XG4gICAgICAgIGNvbmN1cnJlbmN5X2tleTogY3VycmVudC5jb25jdXJyZW5jeUtleSxcbiAgICAgICAgbWF4X2NvbmN1cnJlbmN5OiBjdXJyZW50Lm1heENvbmN1cnJlbmN5XG4gICAgICB9LFxuICAgICAgY29uZGl0aW9uczoge2NvbmN1cnJlbmN5X2tleTogam9iLmNvbmN1cnJlbmN5S2V5LCBpZDogam9iLmlkLCBzdGF0dXM6IFwicXVldWVkXCJ9XG4gICAgfSlcblxuICAgIGlmIChhZmZlY3RlZFJvd3MgIT09IDEpIHJldHVybiBudWxsXG5cbiAgICByZXR1cm4gey4uLmpvYiwgY29uY3VycmVuY3lLZXk6IGN1cnJlbnQuY29uY3VycmVuY3lLZXksIG1heENvbmN1cnJlbmN5OiBjdXJyZW50Lm1heENvbmN1cnJlbmN5fVxuICB9XG5cbiAgLyoqXG4gICAqIFJlYWRzIHRoZSBjb25maWd1cmVkIG1heCBjb25jdXJyZW5jeSBmb3IgYSBxdWV1ZSBmcm9tIHRoZSBiYWNrZ3JvdW5kLWpvYnMgY29uZmlnLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gcXVldWUgLSBRdWV1ZSBuYW1lLlxuICAgKiBAcmV0dXJucyB7bnVtYmVyIHwgbnVsbH0gLSBQb3NpdGl2ZSBpbnRlZ2VyIGNhcCwgb3IgbnVsbCB3aGVuIHRoZSBxdWV1ZSBoYXMgbm8gY29uZmlndXJlZCBjYXAuXG4gICAqL1xuICBfcXVldWVNYXhDb25jdXJyZW5jeShxdWV1ZSkge1xuICAgIGNvbnN0IHF1ZXVlcyA9IHRoaXMuY29uZmlndXJhdGlvbi5nZXRCYWNrZ3JvdW5kSm9ic0NvbmZpZygpLnF1ZXVlc1xuICAgIGNvbnN0IGNhcCA9IHF1ZXVlcz8uW3F1ZXVlXT8ubWF4Q29uY3VycmVudFxuXG4gICAgaWYgKE51bWJlci5pc0ludGVnZXIoY2FwKSAmJiBOdW1iZXIoY2FwKSA+IDApIHJldHVybiBOdW1iZXIoY2FwKVxuXG4gICAgcmV0dXJuIG51bGxcbiAgfVxuXG4gIC8qKlxuICAgKiBMaWtlIHtAbGluayBfZW5zdXJlQ29uY3VycmVuY3lLZXl9LCBidXQgZm9yIHF1ZXVlLWRlcml2ZWQga2V5cyB0aGUgY29uZmlndXJlZFxuICAgKiBxdWV1ZSBjYXAgaXMgdGhlIHNvdXJjZSBvZiB0cnV0aDogaWYgaXQgY2hhbmdlZCwgdXBkYXRlIHRoZSBzdG9yZWQgY2FwXG4gICAqIGluc3RlYWQgb2YgdGhyb3dpbmcgb24gY29uZmxpY3QgKGNvbmZpZy1kcml2ZW4gY2FwcyBtdXN0IGJlIHR1bmFibGUpLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL2RhdGFiYXNlL2RyaXZlcnMvYmFzZS5qc1wiKS5kZWZhdWx0fSBkYiAtIERhdGFiYXNlIGNvbm5lY3Rpb24uXG4gICAqIEBwYXJhbSB7e2NvbmN1cnJlbmN5S2V5OiBzdHJpbmcsIG1heENvbmN1cnJlbmN5OiBudW1iZXJ9fSBjb25jdXJyZW5jeSAtIENvbmN1cnJlbmN5IGNvbmZpZ3VyYXRpb24uXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIHdoZW4gZW5zdXJlZC5cbiAgICovXG4gIGFzeW5jIF9lbnN1cmVRdWV1ZUNvbmN1cnJlbmN5S2V5KGRiLCB7Y29uY3VycmVuY3lLZXksIG1heENvbmN1cnJlbmN5fSkge1xuICAgIGNvbnN0IHJvd3MgPSBhd2FpdCBkYi5uZXdRdWVyeSgpLmZyb20oQ09OQ1VSUkVOQ1lfVEFCTEUpLndoZXJlKHtjb25jdXJyZW5jeV9rZXk6IGNvbmN1cnJlbmN5S2V5fSkubGltaXQoMSkucmVzdWx0cygpXG5cbiAgICBpZiAoIXJvd3NbMF0pIHtcbiAgICAgIHRyeSB7XG4gICAgICAgIGF3YWl0IGRiLmluc2VydCh7dGFibGVOYW1lOiBDT05DVVJSRU5DWV9UQUJMRSwgZGF0YToge2FjdGl2ZV9jb3VudDogMCwgY29uY3VycmVuY3lfa2V5OiBjb25jdXJyZW5jeUtleSwgbWF4X2NvbmN1cnJlbmN5OiBtYXhDb25jdXJyZW5jeX19KVxuXG4gICAgICAgIHJldHVyblxuICAgICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgICAgY29uc3QgcmFjZWRSb3dzID0gYXdhaXQgZGIubmV3UXVlcnkoKS5mcm9tKENPTkNVUlJFTkNZX1RBQkxFKS53aGVyZSh7Y29uY3VycmVuY3lfa2V5OiBjb25jdXJyZW5jeUtleX0pLmxpbWl0KDEpLnJlc3VsdHMoKVxuXG4gICAgICAgIGlmICghcmFjZWRSb3dzWzBdKSB0aHJvdyBlcnJvclxuXG4gICAgICAgIHJvd3NbMF0gPSByYWNlZFJvd3NbMF1cbiAgICAgIH1cbiAgICB9XG5cbiAgICBjb25zdCBjb25maWd1cmVkID0gLyoqIEB0eXBlIHt7bWF4X2NvbmN1cnJlbmN5PzogbnVtYmVyIHwgc3RyaW5nfX0gKi8gKHJvd3NbMF0pXG5cbiAgICBpZiAodGhpcy5fbm9ybWFsaXplTnVtYmVyKGNvbmZpZ3VyZWQubWF4X2NvbmN1cnJlbmN5KSAhPT0gbWF4Q29uY3VycmVuY3kpIHtcbiAgICAgIGNvbnN0IHRhYmxlID0gZGIucXVvdGVUYWJsZShDT05DVVJSRU5DWV9UQUJMRSlcblxuICAgICAgYXdhaXQgZGIucXVlcnkoYFVQREFURSAke3RhYmxlfSBTRVQgJHtkYi5xdW90ZUNvbHVtbihcIm1heF9jb25jdXJyZW5jeVwiKX0gPSAke051bWJlcihtYXhDb25jdXJyZW5jeSl9IFdIRVJFICR7ZGIucXVvdGVDb2x1bW4oXCJjb25jdXJyZW5jeV9rZXlcIil9ID0gJHtkYi5xdW90ZShjb25jdXJyZW5jeUtleSl9YClcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogRW5zdXJlcyB0aGUgY29uY3VycmVuY3kgc3RhdGUgdGFibGUgZXhpc3RzLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL2RhdGFiYXNlL2RyaXZlcnMvYmFzZS5qc1wiKS5kZWZhdWx0fSBkYiAtIERhdGFiYXNlIGNvbm5lY3Rpb24uXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIHdoZW4gcmVhZHkuXG4gICAqL1xuICBhc3luYyBfZW5zdXJlQ29uY3VycmVuY3lUYWJsZShkYikge1xuICAgIGlmIChhd2FpdCBkYi50YWJsZUV4aXN0cyhDT05DVVJSRU5DWV9UQUJMRSkpIHJldHVyblxuICAgIGNvbnN0IHRhYmxlID0gbmV3IFRhYmxlRGF0YShDT05DVVJSRU5DWV9UQUJMRSwge2lmTm90RXhpc3RzOiB0cnVlfSlcbiAgICB0YWJsZS5zdHJpbmcoXCJjb25jdXJyZW5jeV9rZXlcIiwge3ByaW1hcnlLZXk6IHRydWV9KVxuICAgIHRhYmxlLmludGVnZXIoXCJtYXhfY29uY3VycmVuY3lcIiwge251bGw6IGZhbHNlfSlcbiAgICB0YWJsZS5pbnRlZ2VyKFwiYWN0aXZlX2NvdW50XCIsIHtudWxsOiBmYWxzZX0pXG4gICAgYXdhaXQgZGIuY3JlYXRlVGFibGUodGFibGUpXG4gIH1cblxuICAvKipcbiAgICogRW5zdXJlcyB0aGUgc3RhYmxlIHNjaGVkdWxlLWtleSBvd25lcnNoaXAgdGFibGUgZXhpc3RzLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL2RhdGFiYXNlL2RyaXZlcnMvYmFzZS5qc1wiKS5kZWZhdWx0fSBkYiAtIERhdGFiYXNlIGNvbm5lY3Rpb24uXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIHdoZW4gcmVhZHkuXG4gICAqL1xuICBhc3luYyBfZW5zdXJlU2NoZWR1bGVLZXlzVGFibGUoZGIpIHtcbiAgICBpZiAoYXdhaXQgZGIudGFibGVFeGlzdHMoU0NIRURVTEVfS0VZU19UQUJMRSkpIHJldHVyblxuXG4gICAgY29uc3QgbG9ja05hbWUgPSBgJHtNSUdSQVRJT05fU0NPUEV9OnNjaGVkdWxlX2tleXNfdGFibGVgXG4gICAgY29uc3QgYWNxdWlyZWQgPSBhd2FpdCBkYi5hY3F1aXJlQWR2aXNvcnlMb2NrKGxvY2tOYW1lKVxuXG4gICAgaWYgKCFhY3F1aXJlZCkgdGhyb3cgbmV3IEVycm9yKFwiRmFpbGVkIHRvIGFjcXVpcmUgYmFja2dyb3VuZCBqb2JzIHNjaGVkdWxlLWtleSB0YWJsZSBzY2hlbWEgbG9ja1wiKVxuXG4gICAgdHJ5IHtcbiAgICAgIGRiLmNsZWFyU2NoZW1hQ2FjaGUoKVxuICAgICAgaWYgKGF3YWl0IGRiLnRhYmxlRXhpc3RzKFNDSEVEVUxFX0tFWVNfVEFCTEUpKSByZXR1cm5cblxuICAgICAgY29uc3QgdGFibGUgPSBuZXcgVGFibGVEYXRhKFNDSEVEVUxFX0tFWVNfVEFCTEUsIHtpZk5vdEV4aXN0czogdHJ1ZX0pXG5cbiAgICAgIHRhYmxlLnN0cmluZyhcInNjaGVkdWxlX2tleVwiLCB7cHJpbWFyeUtleTogdHJ1ZX0pXG4gICAgICB0YWJsZS5zdHJpbmcoXCJqb2JfaWRcIiwge251bGw6IGZhbHNlLCBpbmRleDogdHJ1ZX0pXG4gICAgICBhd2FpdCBkYi5jcmVhdGVUYWJsZSh0YWJsZSlcbiAgICAgIGRiLmNsZWFyU2NoZW1hQ2FjaGUoKVxuICAgIH0gZmluYWxseSB7XG4gICAgICBhd2FpdCBkYi5yZWxlYXNlQWR2aXNvcnlMb2NrKGxvY2tOYW1lKVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBFbnN1cmVzIGR1cmFibGUgZ2VuZXJpYyBlbnF1ZXVlIG93bmVyc2hpcCBleGlzdHMgaW5kZXBlbmRlbnRseSBvZiBqb2Igcm93cy5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9kYXRhYmFzZS9kcml2ZXJzL2Jhc2UuanNcIikuZGVmYXVsdH0gZGIgLSBEYXRhYmFzZSBjb25uZWN0aW9uLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyB3aGVuIHJlYWR5LlxuICAgKi9cbiAgYXN5bmMgX2Vuc3VyZUlkZW1wb3RlbmN5S2V5c1RhYmxlKGRiKSB7XG4gICAgaWYgKGF3YWl0IGRiLnRhYmxlRXhpc3RzKElERU1QT1RFTkNZX0tFWVNfVEFCTEUpKSByZXR1cm5cblxuICAgIGNvbnN0IGxvY2tOYW1lID0gYCR7TUlHUkFUSU9OX1NDT1BFfTppZGVtcG90ZW5jeV9rZXlzX3RhYmxlYFxuICAgIGNvbnN0IGFjcXVpcmVkID0gYXdhaXQgZGIuYWNxdWlyZUFkdmlzb3J5TG9jayhsb2NrTmFtZSlcblxuICAgIGlmICghYWNxdWlyZWQpIHRocm93IG5ldyBFcnJvcihcIkZhaWxlZCB0byBhY3F1aXJlIGJhY2tncm91bmQgam9iIGlkZW1wb3RlbmN5LWtleSB0YWJsZSBzY2hlbWEgbG9ja1wiKVxuXG4gICAgdHJ5IHtcbiAgICAgIGRiLmNsZWFyU2NoZW1hQ2FjaGUoKVxuICAgICAgaWYgKGF3YWl0IGRiLnRhYmxlRXhpc3RzKElERU1QT1RFTkNZX0tFWVNfVEFCTEUpKSByZXR1cm5cblxuICAgICAgY29uc3QgdGFibGUgPSBuZXcgVGFibGVEYXRhKElERU1QT1RFTkNZX0tFWVNfVEFCTEUsIHtpZk5vdEV4aXN0czogdHJ1ZX0pXG5cbiAgICAgIHRhYmxlLnN0cmluZyhcInNjb3BlX2RpZ2VzdFwiLCB7cHJpbWFyeUtleTogdHJ1ZX0pXG4gICAgICB0YWJsZS5zdHJpbmcoXCJqb2JfbmFtZVwiLCB7bnVsbDogZmFsc2V9KVxuICAgICAgdGFibGUuc3RyaW5nKFwicXVldWVcIiwge251bGw6IGZhbHNlfSlcbiAgICAgIHRhYmxlLnRleHQoXCJpZGVtcG90ZW5jeV9rZXlcIiwge251bGw6IGZhbHNlfSlcbiAgICAgIHRhYmxlLnN0cmluZyhcImpvYl9pZFwiLCB7aW5kZXg6IHRydWUsIG51bGw6IGZhbHNlfSlcbiAgICAgIHRhYmxlLnN0cmluZyhcInJlcXVlc3RfZGlnZXN0XCIsIHtudWxsOiBmYWxzZX0pXG4gICAgICB0YWJsZS5iaWdpbnQoXCJjcmVhdGVkX2F0X21zXCIsIHtudWxsOiBmYWxzZX0pXG4gICAgICBhd2FpdCBkYi5jcmVhdGVUYWJsZSh0YWJsZSlcbiAgICAgIGRiLmNsZWFyU2NoZW1hQ2FjaGUoKVxuICAgIH0gZmluYWxseSB7XG4gICAgICBhd2FpdCBkYi5yZWxlYXNlQWR2aXNvcnlMb2NrKGxvY2tOYW1lKVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBFbnN1cmVzIGR1cmFibGUgcHJvdmlkZXItYmFja2VkIG1haWwgb3BlcmF0aW9uIHN0YXRlIGV4aXN0cyBpbmRlcGVuZGVudGx5IG9mIGpvYnMuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vZGF0YWJhc2UvZHJpdmVycy9iYXNlLmpzXCIpLmRlZmF1bHR9IGRiIC0gRGF0YWJhc2UgY29ubmVjdGlvbi5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgd2hlbiByZWFkeS5cbiAgICovXG4gIGFzeW5jIF9lbnN1cmVNYWlsRGVsaXZlcnlPcGVyYXRpb25zVGFibGUoZGIpIHtcbiAgICBpZiAoYXdhaXQgZGIudGFibGVFeGlzdHMoTUFJTF9ERUxJVkVSWV9PUEVSQVRJT05TX1RBQkxFKSkgcmV0dXJuXG5cbiAgICBjb25zdCBsb2NrTmFtZSA9IGAke01JR1JBVElPTl9TQ09QRX06bWFpbF9kZWxpdmVyeV9vcGVyYXRpb25zX3RhYmxlYFxuICAgIGNvbnN0IGFjcXVpcmVkID0gYXdhaXQgZGIuYWNxdWlyZUFkdmlzb3J5TG9jayhsb2NrTmFtZSlcblxuICAgIGlmICghYWNxdWlyZWQpIHRocm93IG5ldyBFcnJvcihcIkZhaWxlZCB0byBhY3F1aXJlIG1haWwgZGVsaXZlcnkgb3BlcmF0aW9uIHRhYmxlIHNjaGVtYSBsb2NrXCIpXG5cbiAgICB0cnkge1xuICAgICAgZGIuY2xlYXJTY2hlbWFDYWNoZSgpXG4gICAgICBpZiAoYXdhaXQgZGIudGFibGVFeGlzdHMoTUFJTF9ERUxJVkVSWV9PUEVSQVRJT05TX1RBQkxFKSkgcmV0dXJuXG5cbiAgICAgIGNvbnN0IHRhYmxlID0gbmV3IFRhYmxlRGF0YShNQUlMX0RFTElWRVJZX09QRVJBVElPTlNfVEFCTEUsIHtpZk5vdEV4aXN0czogdHJ1ZX0pXG5cbiAgICAgIHRhYmxlLnN0cmluZyhcIm9wZXJhdGlvbl9rZXlcIiwge3ByaW1hcnlLZXk6IHRydWV9KVxuICAgICAgdGFibGUudGV4dChcIm9wZXJhdGlvbl9pZFwiLCB7bnVsbDogZmFsc2V9KVxuICAgICAgdGFibGUuc3RyaW5nKFwicGF5bG9hZF9kaWdlc3RcIiwge251bGw6IGZhbHNlfSlcbiAgICAgIHRhYmxlLnN0cmluZyhcImJhY2tncm91bmRfam9iX2lkXCIsIHtpbmRleDogdHJ1ZSwgbnVsbDogZmFsc2V9KVxuICAgICAgdGFibGUuYmlnaW50KFwiZmlyc3RfYXR0ZW1wdF9zdGFydGVkX2F0X21zXCIsIHtudWxsOiB0cnVlfSlcbiAgICAgIHRhYmxlLnN0cmluZyhcInByb3ZpZGVyX2tpbmRcIiwge251bGw6IGZhbHNlfSlcbiAgICAgIHRhYmxlLmJpZ2ludChcInByb3ZpZGVyX3JldGVudGlvbl9tc1wiLCB7bnVsbDogZmFsc2V9KVxuICAgICAgdGFibGUuYmlnaW50KFwiY3JlYXRlZF9hdF9tc1wiLCB7bnVsbDogZmFsc2V9KVxuICAgICAgYXdhaXQgZGIuY3JlYXRlVGFibGUodGFibGUpXG4gICAgICBkYi5jbGVhclNjaGVtYUNhY2hlKClcbiAgICB9IGZpbmFsbHkge1xuICAgICAgYXdhaXQgZGIucmVsZWFzZUFkdmlzb3J5TG9jayhsb2NrTmFtZSlcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogRW5zdXJlcyB0aGUgc2luZ2xldG9uIGR1cmFibGUgY291bnQtcmV2aXNpb24gcm93IGV4aXN0cy5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9kYXRhYmFzZS9kcml2ZXJzL2Jhc2UuanNcIikuZGVmYXVsdH0gZGIgLSBEYXRhYmFzZSBjb25uZWN0aW9uLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gUmVzb2x2ZXMgd2hlbiByZWFkeS5cbiAgICovXG4gIGFzeW5jIF9lbnN1cmVDb3VudFJldmlzaW9uVGFibGUoZGIpIHtcbiAgICBpZiAoIShhd2FpdCBkYi50YWJsZUV4aXN0cyhDT1VOVFNfUkVWSVNJT05fVEFCTEUpKSkge1xuICAgICAgY29uc3QgdGFibGUgPSBuZXcgVGFibGVEYXRhKENPVU5UU19SRVZJU0lPTl9UQUJMRSwge2lmTm90RXhpc3RzOiB0cnVlfSlcblxuICAgICAgdGFibGUuc3RyaW5nKFwia2V5XCIsIHtwcmltYXJ5S2V5OiB0cnVlfSlcbiAgICAgIHRhYmxlLmJpZ2ludChcInJldmlzaW9uXCIsIHtudWxsOiBmYWxzZX0pXG4gICAgICBhd2FpdCBkYi5jcmVhdGVUYWJsZSh0YWJsZSlcbiAgICB9XG5cbiAgICBjb25zdCByb3dzID0gYXdhaXQgZGIubmV3UXVlcnkoKS5mcm9tKENPVU5UU19SRVZJU0lPTl9UQUJMRSkud2hlcmUoe2tleTogQ09VTlRTX1JFVklTSU9OX0tFWX0pLmxpbWl0KDEpLnJlc3VsdHMoKVxuXG4gICAgaWYgKHJvd3MubGVuZ3RoID4gMCkgcmV0dXJuXG5cbiAgICB0cnkge1xuICAgICAgYXdhaXQgZGIuaW5zZXJ0KHt0YWJsZU5hbWU6IENPVU5UU19SRVZJU0lPTl9UQUJMRSwgZGF0YToge2tleTogQ09VTlRTX1JFVklTSU9OX0tFWSwgcmV2aXNpb246IDB9fSlcbiAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgY29uc3QgcmFjZWRSb3dzID0gYXdhaXQgZGIubmV3UXVlcnkoKS5mcm9tKENPVU5UU19SRVZJU0lPTl9UQUJMRSkud2hlcmUoe2tleTogQ09VTlRTX1JFVklTSU9OX0tFWX0pLmxpbWl0KDEpLnJlc3VsdHMoKVxuXG4gICAgICBpZiAocmFjZWRSb3dzLmxlbmd0aCA9PT0gMCkgdGhyb3cgZXJyb3JcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogUmVjb3JkcyBvbmUgbG9naWNhbCBjb3VudCBtdXRhdGlvbiBhdG9taWNhbGx5IGFuZCBicm9hZGNhc3RzIGl0IGFmdGVyIGNvbW1pdC5cbiAgICogWmVybyBlbnRyaWVzIGFyZSBvbWl0dGVkOyBhIHdob2xseSB6ZXJvLW5ldCBtdXRhdGlvbiBkb2VzIG5vdCBjb25zdW1lIGEgcmV2aXNpb24uXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vZGF0YWJhc2UvZHJpdmVycy9iYXNlLmpzXCIpLmRlZmF1bHR9IGRiIC0gVHJhbnNhY3Rpb24gY29ubmVjdGlvbi5cbiAgICogQHBhcmFtIHtSZWNvcmQ8c3RyaW5nLCBudW1iZXI+fSByZXF1ZXN0ZWREZWx0YXMgLSBTaWduZWQgYnVja2V0IGNoYW5nZXMuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSBSZXNvbHZlcyB3aGVuIHJlY29yZGVkLlxuICAgKi9cbiAgYXN5bmMgX3JlY29yZENvdW50RGVsdGEoZGIsIHJlcXVlc3RlZERlbHRhcykge1xuICAgIC8qKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgbnVtYmVyPn0gKi9cbiAgICBjb25zdCBkZWx0YXMgPSB7fVxuXG4gICAgZm9yIChjb25zdCBidWNrZXQgb2YgQkFDS0dST1VORF9KT0JfQ09VTlRfQlVDS0VUUykge1xuICAgICAgY29uc3QgYW1vdW50ID0gcmVxdWVzdGVkRGVsdGFzW2J1Y2tldF0gfHwgMFxuXG4gICAgICBpZiAoIU51bWJlci5pc0ludGVnZXIoYW1vdW50KSkgdGhyb3cgbmV3IEVycm9yKGBJbnZhbGlkIGJhY2tncm91bmQgam9iIGNvdW50IGRlbHRhIGZvciAke2J1Y2tldH06ICR7YW1vdW50fWApXG4gICAgICBpZiAoYW1vdW50ICE9PSAwKSBkZWx0YXNbYnVja2V0XSA9IGFtb3VudFxuICAgIH1cblxuICAgIGlmIChPYmplY3Qua2V5cyhkZWx0YXMpLmxlbmd0aCA9PT0gMCkgcmV0dXJuXG5cbiAgICBjb25zdCB0YWJsZSA9IGRiLnF1b3RlVGFibGUoQ09VTlRTX1JFVklTSU9OX1RBQkxFKVxuICAgIGNvbnN0IHJldmlzaW9uQ29sdW1uID0gZGIucXVvdGVDb2x1bW4oXCJyZXZpc2lvblwiKVxuICAgIGNvbnN0IGFmZmVjdGVkUm93cyA9IGF3YWl0IGRiLmFmZmVjdGVkUm93cyhcbiAgICAgIGBVUERBVEUgJHt0YWJsZX0gU0VUICR7cmV2aXNpb25Db2x1bW59ID0gJHtyZXZpc2lvbkNvbHVtbn0gKyAxIFdIRVJFICR7ZGIucXVvdGVDb2x1bW4oXCJrZXlcIil9ID0gJHtkYi5xdW90ZShDT1VOVFNfUkVWSVNJT05fS0VZKX1gXG4gICAgKVxuXG4gICAgaWYgKGFmZmVjdGVkUm93cyAhPT0gMSkgdGhyb3cgbmV3IEVycm9yKFwiQmFja2dyb3VuZCBqb2IgY291bnQgcmV2aXNpb24gcm93IGlzIG1pc3NpbmdcIilcblxuICAgIGNvbnN0IHJldmlzaW9uID0gYXdhaXQgdGhpcy5fY291bnRSZXZpc2lvbihkYilcbiAgICBjb25zdCBib2R5ID0ge2RlbHRhcywgcmV2aXNpb24sIHR5cGU6IFwiYmFja2dyb3VuZC1qb2ItY291bnQtZGVsdGFcIn1cbiAgICBjb25zdCBkYXRhYmFzZUlkZW50aWZpZXIgPSB0aGlzLmdldERhdGFiYXNlSWRlbnRpZmllcigpIHx8IFwiZGVmYXVsdFwiXG5cbiAgICBhd2FpdCBkYi5hZnRlckNvbW1pdCgoKSA9PiB7XG4gICAgICB0aGlzLmNvbmZpZ3VyYXRpb24uYnJvYWRjYXN0VG9DaGFubmVsKEJBQ0tHUk9VTkRfSk9CX0NPVU5UU19DSEFOTkVMLCB7ZGF0YWJhc2VJZGVudGlmaWVyfSwgYm9keSlcbiAgICB9KVxuICB9XG5cbiAgLyoqXG4gICAqIFJlY29yZHMgYSB0cmFuc2l0aW9uIGJldHdlZW4gcGVyc2lzdGVkIHN0YXR1c2VzLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL2RhdGFiYXNlL2RyaXZlcnMvYmFzZS5qc1wiKS5kZWZhdWx0fSBkYiAtIFRyYW5zYWN0aW9uIGNvbm5lY3Rpb24uXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBvbGRTdGF0dXMgLSBQcmV2aW91cyBzdGF0dXMuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBuZXdTdGF0dXMgLSBOZXcgc3RhdHVzLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gUmVzb2x2ZXMgd2hlbiByZWNvcmRlZC5cbiAgICovXG4gIGFzeW5jIF9yZWNvcmRTdGF0dXNUcmFuc2l0aW9uKGRiLCBvbGRTdGF0dXMsIG5ld1N0YXR1cykge1xuICAgIGNvbnN0IG9sZENvdW50ZWQgPSBDT1VOVEVEX0pPQl9TVEFUVVNFUy5pbmNsdWRlcyhvbGRTdGF0dXMpXG4gICAgY29uc3QgbmV3Q291bnRlZCA9IENPVU5URURfSk9CX1NUQVRVU0VTLmluY2x1ZGVzKG5ld1N0YXR1cylcblxuICAgIGlmICghb2xkQ291bnRlZCAmJiBvbGRTdGF0dXMgIT09IFwiY2FuY2VsbGVkXCIpIHRocm93IG5ldyBFcnJvcihgVW5rbm93biBwcmV2aW91cyBiYWNrZ3JvdW5kIGpvYiBzdGF0dXM6ICR7b2xkU3RhdHVzfWApXG4gICAgaWYgKCFuZXdDb3VudGVkICYmIG5ld1N0YXR1cyAhPT0gXCJjYW5jZWxsZWRcIikgdGhyb3cgbmV3IEVycm9yKGBVbmtub3duIG5leHQgYmFja2dyb3VuZCBqb2Igc3RhdHVzOiAke25ld1N0YXR1c31gKVxuICAgIGlmIChvbGRTdGF0dXMgPT09IG5ld1N0YXR1cykgcmV0dXJuXG5cbiAgICAvKiogQHR5cGUge1JlY29yZDxzdHJpbmcsIG51bWJlcj59ICovXG4gICAgY29uc3QgZGVsdGFzID0ge31cblxuICAgIGlmIChvbGRDb3VudGVkKSBkZWx0YXNbb2xkU3RhdHVzXSA9IC0xXG4gICAgaWYgKG5ld0NvdW50ZWQpIGRlbHRhc1tuZXdTdGF0dXNdID0gMVxuICAgIGlmIChvbGRDb3VudGVkICE9PSBuZXdDb3VudGVkKSBkZWx0YXMuYWxsID0gbmV3Q291bnRlZCA/IDEgOiAtMVxuICAgIGF3YWl0IHRoaXMuX3JlY29yZENvdW50RGVsdGEoZGIsIGRlbHRhcylcbiAgfVxuXG4gIC8qKlxuICAgKiBSZWFkcyB0aGUgbG9ja2VkIHJldmlzaW9uLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL2RhdGFiYXNlL2RyaXZlcnMvYmFzZS5qc1wiKS5kZWZhdWx0fSBkYiAtIERhdGFiYXNlIGNvbm5lY3Rpb24uXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPG51bWJlcj59IFJldmlzaW9uLlxuICAgKi9cbiAgYXN5bmMgX2NvdW50UmV2aXNpb24oZGIpIHtcbiAgICBjb25zdCByb3dzID0gYXdhaXQgZGIubmV3UXVlcnkoKS5mcm9tKENPVU5UU19SRVZJU0lPTl9UQUJMRSkuc2VsZWN0KFwicmV2aXNpb25cIikud2hlcmUoe2tleTogQ09VTlRTX1JFVklTSU9OX0tFWX0pLmxpbWl0KDEpLnJlc3VsdHMoKVxuICAgIGNvbnN0IHJldmlzaW9uID0gdGhpcy5fbm9ybWFsaXplTnVtYmVyKC8qKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSAqLyAocm93c1swXSB8fCB7fSkucmV2aXNpb24pXG5cbiAgICBpZiAocmV2aXNpb24gPT09IG51bGwgfHwgIU51bWJlci5pc1NhZmVJbnRlZ2VyKHJldmlzaW9uKSB8fCByZXZpc2lvbiA8IDApIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihgSW52YWxpZCBiYWNrZ3JvdW5kIGpvYiBjb3VudCByZXZpc2lvbjogJHtyZXZpc2lvbn1gKVxuICAgIH1cblxuICAgIHJldHVybiByZXZpc2lvblxuICB9XG5cbiAgLyoqXG4gICAqIFRha2VzIGEgcG9ydGFibGUgd3JpdGUgbG9jayBvbiB0aGUgc2luZ2xldG9uIHJldmlzaW9uIHJvdy5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9kYXRhYmFzZS9kcml2ZXJzL2Jhc2UuanNcIikuZGVmYXVsdH0gZGIgLSBEYXRhYmFzZSBjb25uZWN0aW9uLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gUmVzb2x2ZXMgd2hlbiBsb2NrZWQuXG4gICAqL1xuICBhc3luYyBfbG9ja0NvdW50UmV2aXNpb24oZGIpIHtcbiAgICBjb25zdCB0YWJsZSA9IGRiLnF1b3RlVGFibGUoQ09VTlRTX1JFVklTSU9OX1RBQkxFKVxuICAgIGNvbnN0IHJldmlzaW9uID0gZGIucXVvdGVDb2x1bW4oXCJyZXZpc2lvblwiKVxuXG4gICAgYXdhaXQgZGIucXVlcnkoYFVQREFURSAke3RhYmxlfSBTRVQgJHtyZXZpc2lvbn0gPSAke3JldmlzaW9ufSBXSEVSRSAke2RiLnF1b3RlQ29sdW1uKFwia2V5XCIpfSA9ICR7ZGIucXVvdGUoQ09VTlRTX1JFVklTSU9OX0tFWSl9YClcbiAgfVxuXG4gIC8qKlxuICAgKiBCdWlsZHMgemVyb2VkIGNhbm9uaWNhbCBidWNrZXRzLlxuICAgKiBAcmV0dXJucyB7UmVjb3JkPHN0cmluZywgbnVtYmVyPn0gWmVyb2VkIGNhbm9uaWNhbCBidWNrZXRzLlxuICAgKi9cbiAgX2VtcHR5Q291bnRCdWNrZXRzKCkge1xuICAgIHJldHVybiBPYmplY3QuZnJvbUVudHJpZXMoQkFDS0dST1VORF9KT0JfQ09VTlRfQlVDS0VUUy5tYXAoKGJ1Y2tldCkgPT4gW2J1Y2tldCwgMF0pKVxuICB9XG5cbiAgLyoqXG4gICAqIENvdW50cyBub3JtYWxpemVkIHJvd3MgYnkgY2Fub25pY2FsIHN0YXR1cy5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL3R5cGVzLmpzXCIpLkJhY2tncm91bmRKb2JSb3dbXX0gam9icyAtIEpvYnMuXG4gICAqIEByZXR1cm5zIHtSZWNvcmQ8c3RyaW5nLCBudW1iZXI+fSBDb3VudHMuXG4gICAqL1xuICBfc3RhdHVzQ291bnRzKGpvYnMpIHtcbiAgICAvKiogQHR5cGUge1JlY29yZDxzdHJpbmcsIG51bWJlcj59ICovXG4gICAgY29uc3QgY291bnRzID0ge31cblxuICAgIGZvciAoY29uc3Qgam9iIG9mIGpvYnMpIHtcbiAgICAgIGlmICghQ09VTlRFRF9KT0JfU1RBVFVTRVMuaW5jbHVkZXMoam9iLnN0YXR1cykpIHRocm93IG5ldyBFcnJvcihgVW5rbm93biBiYWNrZ3JvdW5kIGpvYiBzdGF0dXM6ICR7am9iLnN0YXR1c31gKVxuICAgICAgY291bnRzW2pvYi5zdGF0dXNdID0gKGNvdW50c1tqb2Iuc3RhdHVzXSB8fCAwKSArIDFcbiAgICB9XG5cbiAgICByZXR1cm4gY291bnRzXG4gIH1cblxuICAvKipcbiAgICogUmVhZHMgYSBjYW5vbmljYWwgc25hcHNob3QgYWZ0ZXIgbG9ja2luZyB0aGUgcmV2aXNpb24gcm93LlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL2RhdGFiYXNlL2RyaXZlcnMvYmFzZS5qc1wiKS5kZWZhdWx0fSBkYiAtIFRyYW5zYWN0aW9uIGNvbm5lY3Rpb24uXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHtjb3VudHM6IFJlY29yZDxzdHJpbmcsIG51bWJlcj4sIHJldmlzaW9uOiBudW1iZXIsIHRvdGFsOiBudW1iZXJ9Pn0gU25hcHNob3QuXG4gICAqL1xuICBhc3luYyBfY291bnRTbmFwc2hvdE9uTG9ja2VkQ29ubmVjdGlvbihkYikge1xuICAgIGNvbnN0IHJvd3MgPSBhd2FpdCBkYi5uZXdRdWVyeSgpLmZyb20oSk9CU19UQUJMRSkuc2VsZWN0KFwic3RhdHVzXCIpLnNlbGVjdChcIkNPVU5UKCopIEFTIGNvdW50XCIpLmdyb3VwKFwic3RhdHVzXCIpLnJlc3VsdHMoKVxuICAgIGNvbnN0IGNvdW50cyA9IHRoaXMuX2VtcHR5Q291bnRCdWNrZXRzKClcbiAgICBsZXQgdG90YWwgPSAwXG5cbiAgICBmb3IgKGNvbnN0IHJvdyBvZiByb3dzKSB7XG4gICAgICBjb25zdCB0eXBlZFJvdyA9IC8qKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSAqLyAocm93KVxuICAgICAgY29uc3Qgc3RhdHVzID0gU3RyaW5nKHR5cGVkUm93LnN0YXR1cylcbiAgICAgIGNvbnN0IGNvdW50ID0gdGhpcy5fbm9ybWFsaXplTnVtYmVyKHR5cGVkUm93LmNvdW50KSB8fCAwXG5cbiAgICAgIHRvdGFsICs9IGNvdW50XG5cbiAgICAgIGlmICghQ09VTlRFRF9KT0JfU1RBVFVTRVMuaW5jbHVkZXMoc3RhdHVzKSkgY29udGludWVcbiAgICAgIGNvdW50c1tzdGF0dXNdID0gY291bnRcbiAgICAgIGNvdW50cy5hbGwgKz0gY291bnRzW3N0YXR1c11cbiAgICB9XG5cbiAgICByZXR1cm4ge2NvdW50cywgcmV2aXNpb246IGF3YWl0IHRoaXMuX2NvdW50UmV2aXNpb24oZGIpLCB0b3RhbH1cbiAgfVxuXG4gIC8qKlxuICAgKiBSZWdpc3RlcnMgb3IgdmVyaWZpZXMgYSBzdGFibGUga2V5IGNvbmZpZ3VyYXRpb24uXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vZGF0YWJhc2UvZHJpdmVycy9iYXNlLmpzXCIpLmRlZmF1bHR9IGRiIC0gRGF0YWJhc2UgY29ubmVjdGlvbi5cbiAgICogQHBhcmFtIHtvYmplY3R9IGNvbmN1cnJlbmN5IC0gQ29uY3VycmVuY3kgY29uZmlndXJhdGlvbi5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGNvbmN1cnJlbmN5LmNvbmN1cnJlbmN5S2V5IC0gQ29uY3VycmVuY3kga2V5LlxuICAgKiBAcGFyYW0ge251bWJlcn0gY29uY3VycmVuY3kubWF4Q29uY3VycmVuY3kgLSBTdGFibGUgY2FwLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyB3aGVuIHZlcmlmaWVkLlxuICAgKi9cbiAgYXN5bmMgX2Vuc3VyZUNvbmN1cnJlbmN5S2V5KGRiLCB7Y29uY3VycmVuY3lLZXksIG1heENvbmN1cnJlbmN5fSkge1xuICAgIGNvbnN0IHJvd3MgPSBhd2FpdCBkYi5uZXdRdWVyeSgpLmZyb20oQ09OQ1VSUkVOQ1lfVEFCTEUpLndoZXJlKHtjb25jdXJyZW5jeV9rZXk6IGNvbmN1cnJlbmN5S2V5fSkubGltaXQoMSkucmVzdWx0cygpXG4gICAgaWYgKCFyb3dzWzBdKSB7XG4gICAgICB0cnkge1xuICAgICAgICBhd2FpdCBkYi5pbnNlcnQoe3RhYmxlTmFtZTogQ09OQ1VSUkVOQ1lfVEFCTEUsIGRhdGE6IHthY3RpdmVfY291bnQ6IDAsIGNvbmN1cnJlbmN5X2tleTogY29uY3VycmVuY3lLZXksIG1heF9jb25jdXJyZW5jeTogbWF4Q29uY3VycmVuY3l9fSlcbiAgICAgICAgcmV0dXJuXG4gICAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgICBjb25zdCByYWNlZFJvd3MgPSBhd2FpdCBkYi5uZXdRdWVyeSgpLmZyb20oQ09OQ1VSUkVOQ1lfVEFCTEUpLndoZXJlKHtjb25jdXJyZW5jeV9rZXk6IGNvbmN1cnJlbmN5S2V5fSkubGltaXQoMSkucmVzdWx0cygpXG4gICAgICAgIGlmICghcmFjZWRSb3dzWzBdKSB0aHJvdyBlcnJvclxuICAgICAgICByb3dzWzBdID0gcmFjZWRSb3dzWzBdXG4gICAgICB9XG4gICAgfVxuICAgIGNvbnN0IGNvbmZpZ3VyZWQgPSAvKiogQHR5cGUge3ttYXhfY29uY3VycmVuY3k/OiBudW1iZXIgfCBzdHJpbmd9fSAqLyAocm93c1swXSlcbiAgICBpZiAodGhpcy5fbm9ybWFsaXplTnVtYmVyKGNvbmZpZ3VyZWQubWF4X2NvbmN1cnJlbmN5KSAhPT0gbWF4Q29uY3VycmVuY3kpIHRocm93IG5ldyBFcnJvcihgQ29uZmxpY3RpbmcgbWF4Q29uY3VycmVuY3kgZm9yIGJhY2tncm91bmQgam9iIGNvbmN1cnJlbmN5S2V5OiAke2NvbmN1cnJlbmN5S2V5fWApXG4gIH1cblxuICAvKipcbiAgICogTG9ja3MgdGhlIGNvbmN1cnJlbmN5IGNvdW50ZXIgcm93IHNvIGEgam9iLXJlbGVhc2UgdHJhbnNhY3Rpb24gYWNxdWlyZXMgaXQgKmJlZm9yZSogdGhlIGpvYlxuICAgKiByb3cuIHtAbGluayBtYXJrSGFuZGVkT2ZmfSByZXNlcnZlcyBjYXBhY2l0eSAobG9ja2luZyB0aGUgY291bnRlciByb3cpIGJlZm9yZSBpdCB1cGRhdGVzIHRoZVxuICAgKiBqb2IsIHNvIGl0IGxvY2tzIGNvbmN1cnJlbmN5LXRoZW4tam9iOyB0aGUgcmVsZWFzZSBwYXRocyB1cGRhdGUgdGhlIGpvYiBiZWZvcmUgcmVsZWFzaW5nXG4gICAqIGNhcGFjaXR5LCB3aGljaCBpcyBqb2ItdGhlbi1jb25jdXJyZW5jeS4gVGhvc2Ugb3Bwb3NpdGUgb3JkZXJzIG9uIHRoZSBzYW1lIHNoYXJlZCBjb3VudGVyIHJvd1xuICAgKiBhcmUgd2hhdCBkZWFkbG9jayAoQUItQkEpIHVuZGVyIGEgZHJhaW5pbmcgd29ya2VyLiBUYWtpbmcgdGhpcyBsb2NrIGZpcnN0IGdpdmVzIGV2ZXJ5XG4gICAqIHRyYW5zYWN0aW9uIGEgc2luZ2xlIGNvbmN1cnJlbmN5LXRoZW4tam9iIG9yZGVyIGFuZCByZW1vdmVzIHRoZSBjeWNsZS5cbiAgICpcbiAgICogVXNlcyBhIHZhbHVlLXByZXNlcnZpbmcgYFVQREFURWAgcmF0aGVyIHRoYW4gYFNFTEVDVCAuLi4gRk9SIFVQREFURWAgc28gaXQgc3RheXMgcG9ydGFibGVcbiAgICogYWNyb3NzIGRyaXZlcnMgd2l0aG91dCByb3ctbGV2ZWwgbG9ja2luZyByZWFkcyAoZS5nLiBTUUxpdGUpOyBvbiByb3ctbG9ja2luZyBlbmdpbmVzIHRoZVxuICAgKiBtYXRjaGVkIHJvdyBpcyB3cml0ZS1sb2NrZWQgZm9yIHRoZSByZXN0IG9mIHRoZSB0cmFuc2FjdGlvbiBldmVuIHRob3VnaCBpdHMgdmFsdWUgaXMgdW5jaGFuZ2VkLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL2RhdGFiYXNlL2RyaXZlcnMvYmFzZS5qc1wiKS5kZWZhdWx0fSBkYiAtIERhdGFiYXNlIGNvbm5lY3Rpb24uXG4gICAqIEBwYXJhbSB7c3RyaW5nIHwgbnVsbH0gY29uY3VycmVuY3lLZXkgLSBDb25jdXJyZW5jeSBrZXkuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIHdoZW4gdGhlIGNvdW50ZXIgcm93IGlzIGxvY2tlZC5cbiAgICovXG4gIGFzeW5jIF9sb2NrQ29uY3VycmVuY3lSb3coZGIsIGNvbmN1cnJlbmN5S2V5KSB7XG4gICAgaWYgKCFjb25jdXJyZW5jeUtleSkgcmV0dXJuXG4gICAgY29uc3QgdGFibGUgPSBkYi5xdW90ZVRhYmxlKENPTkNVUlJFTkNZX1RBQkxFKVxuICAgIGNvbnN0IGNvdW50ID0gZGIucXVvdGVDb2x1bW4oXCJhY3RpdmVfY291bnRcIilcbiAgICBhd2FpdCBkYi5xdWVyeShgVVBEQVRFICR7dGFibGV9IFNFVCAke2NvdW50fSA9ICR7Y291bnR9IFdIRVJFICR7ZGIucXVvdGVDb2x1bW4oXCJjb25jdXJyZW5jeV9rZXlcIil9ID0gJHtkYi5xdW90ZShjb25jdXJyZW5jeUtleSl9YClcbiAgfVxuXG4gIC8qKlxuICAgKiBBdG9taWNhbGx5IHJlc2VydmVzIGNhcGFjaXR5IGZvciBhIGtleS5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9kYXRhYmFzZS9kcml2ZXJzL2Jhc2UuanNcIikuZGVmYXVsdH0gZGIgLSBEYXRhYmFzZSBjb25uZWN0aW9uLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gY29uY3VycmVuY3lLZXkgLSBDb25jdXJyZW5jeSBrZXkuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPGJvb2xlYW4+fSAtIFdoZXRoZXIgY2FwYWNpdHkgd2FzIHJlc2VydmVkLlxuICAgKi9cbiAgYXN5bmMgX3Jlc2VydmVDb25jdXJyZW5jeShkYiwgY29uY3VycmVuY3lLZXkpIHtcbiAgICBjb25zdCB0YWJsZSA9IGRiLnF1b3RlVGFibGUoQ09OQ1VSUkVOQ1lfVEFCTEUpXG4gICAgY29uc3QgY291bnQgPSBkYi5xdW90ZUNvbHVtbihcImFjdGl2ZV9jb3VudFwiKVxuICAgIGNvbnN0IGFmZmVjdGVkUm93cyA9IGF3YWl0IGRiLmFmZmVjdGVkUm93cyhgVVBEQVRFICR7dGFibGV9IFNFVCAke2NvdW50fSA9ICR7Y291bnR9ICsgMSBXSEVSRSAke2RiLnF1b3RlQ29sdW1uKFwiY29uY3VycmVuY3lfa2V5XCIpfSA9ICR7ZGIucXVvdGUoY29uY3VycmVuY3lLZXkpfSBBTkQgJHtjb3VudH0gPCAke2RiLnF1b3RlQ29sdW1uKFwibWF4X2NvbmN1cnJlbmN5XCIpfWApXG4gICAgcmV0dXJuIGFmZmVjdGVkUm93cyA9PT0gMVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgYSBwb3J0YWJsZSB1cGRhdGUgYW5kIHJldHVybnMgaXRzIGFmZmVjdGVkLXJvdyBjb3VudC5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9kYXRhYmFzZS9kcml2ZXJzL2Jhc2UuanNcIikuZGVmYXVsdH0gZGIgLSBEYXRhYmFzZSBjb25uZWN0aW9uLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL2RhdGFiYXNlL2RyaXZlcnMvYmFzZS5qc1wiKS5VcGRhdGVTcWxBcmdzVHlwZX0gYXJncyAtIFVwZGF0ZSBvcHRpb25zLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxudW1iZXI+fSAtIEFmZmVjdGVkIHJvdyBjb3VudC5cbiAgICovXG4gIGFzeW5jIF91cGRhdGVBZmZlY3RlZFJvd3MoZGIsIGFyZ3MpIHtcbiAgICByZXR1cm4gYXdhaXQgZGIuYWZmZWN0ZWRSb3dzKGRiLnVwZGF0ZVNxbChhcmdzKSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSZWxlYXNlcyBjYXBhY2l0eSBmb3IgYSBrZXkuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vZGF0YWJhc2UvZHJpdmVycy9iYXNlLmpzXCIpLmRlZmF1bHR9IGRiIC0gRGF0YWJhc2UgY29ubmVjdGlvbi5cbiAgICogQHBhcmFtIHtzdHJpbmcgfCBudWxsfSBjb25jdXJyZW5jeUtleSAtIENvbmN1cnJlbmN5IGtleS5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgd2hlbiByZWxlYXNlZC5cbiAgICovXG4gIGFzeW5jIF9yZWxlYXNlQ29uY3VycmVuY3koZGIsIGNvbmN1cnJlbmN5S2V5KSB7XG4gICAgaWYgKCFjb25jdXJyZW5jeUtleSkgcmV0dXJuXG4gICAgY29uc3QgdGFibGUgPSBkYi5xdW90ZVRhYmxlKENPTkNVUlJFTkNZX1RBQkxFKVxuICAgIGNvbnN0IGNvdW50ID0gZGIucXVvdGVDb2x1bW4oXCJhY3RpdmVfY291bnRcIilcbiAgICBhd2FpdCBkYi5xdWVyeShgVVBEQVRFICR7dGFibGV9IFNFVCAke2NvdW50fSA9ICR7Y291bnR9IC0gMSBXSEVSRSAke2RiLnF1b3RlQ29sdW1uKFwiY29uY3VycmVuY3lfa2V5XCIpfSA9ICR7ZGIucXVvdGUoY29uY3VycmVuY3lLZXkpfSBBTkQgJHtjb3VudH0gPiAwYClcbiAgfVxuXG4gIC8qKlxuICAgKiBSZWJ1aWxkcyBkdXJhYmxlIGNvdW50cyBmcm9tIGFjdGl2ZSBoYW5kb2Zmcy5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9kYXRhYmFzZS9kcml2ZXJzL2Jhc2UuanNcIikuZGVmYXVsdH0gZGIgLSBEYXRhYmFzZSBjb25uZWN0aW9uLlxuICAgKiBAcGFyYW0ge3tpbnNpZGVUcmFuc2FjdGlvbj86IGJvb2xlYW59fSBbb3B0aW9uc10gLSBSZXVzZSBhbiBlbmNsb3NpbmcgdHJhbnNhY3Rpb24uXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPGltcG9ydChcIi4vdHlwZXMuanNcIikuQmFja2dyb3VuZEpvYkNvbmN1cnJlbmN5UmVjb25jaWxpYXRpb24+fSAtIFJlcGFpciBzdW1tYXJ5LlxuICAgKi9cbiAgYXN5bmMgX3JlY29uY2lsZUNvbmN1cnJlbmN5KGRiLCB7aW5zaWRlVHJhbnNhY3Rpb24gPSBmYWxzZX0gPSB7fSkge1xuICAgIGlmICghKGF3YWl0IGRiLnRhYmxlRXhpc3RzKENPTkNVUlJFTkNZX1RBQkxFKSkpIHtcbiAgICAgIHJldHVybiB7Y2FuZGlkYXRlQ291bnQ6IDAsIGNoZWNrZWRDb3VudDogMCwgcmVwYWlyZWRDb3VudDogMCwgcmVwYWlyczogW10sIHJlcGFpcnNUcnVuY2F0ZWRDb3VudDogMH1cbiAgICB9XG5cbiAgICBjb25zdCBhY3RpdmVSb3dzID0gYXdhaXQgZGJcbiAgICAgIC5uZXdRdWVyeSgpXG4gICAgICAuZnJvbShKT0JTX1RBQkxFKVxuICAgICAgLnNlbGVjdChcImNvbmN1cnJlbmN5X2tleVwiKVxuICAgICAgLnNlbGVjdChcIkNPVU5UKCopIEFTIGFjdGl2ZV9jb3VudFwiKVxuICAgICAgLndoZXJlKHtzdGF0dXM6IFwiaGFuZGVkX29mZlwifSlcbiAgICAgIC53aGVyZShgJHtkYi5xdW90ZUNvbHVtbihcImNvbmN1cnJlbmN5X2tleVwiKX0gSVMgTk9UIE5VTExgKVxuICAgICAgLmdyb3VwKFwiY29uY3VycmVuY3lfa2V5XCIpXG4gICAgICAucmVzdWx0cygpXG4gICAgY29uc3Qgc3RhbGVSb3dzID0gYXdhaXQgZGJcbiAgICAgIC5uZXdRdWVyeSgpXG4gICAgICAuZnJvbShDT05DVVJSRU5DWV9UQUJMRSlcbiAgICAgIC5zZWxlY3QoXCJjb25jdXJyZW5jeV9rZXlcIilcbiAgICAgIC5zZWxlY3QoXCJhY3RpdmVfY291bnRcIilcbiAgICAgIC53aGVyZShgJHtkYi5xdW90ZUNvbHVtbihcImFjdGl2ZV9jb3VudFwiKX0gIT0gMGApXG4gICAgICAucmVzdWx0cygpXG4gICAgLyoqIEB0eXBlIHtNYXA8c3RyaW5nLCBudW1iZXI+fSAqL1xuICAgIGNvbnN0IGFjdGl2ZUNvdW50cyA9IG5ldyBNYXAoKVxuICAgIC8qKiBAdHlwZSB7TWFwPHN0cmluZywgbnVtYmVyPn0gKi9cbiAgICBjb25zdCBwZXJzaXN0ZWRDb3VudHMgPSBuZXcgTWFwKClcblxuICAgIGZvciAoY29uc3QgcmF3Um93IG9mIGFjdGl2ZVJvd3MpIHtcbiAgICAgIGNvbnN0IHJvdyA9IC8qKiBAdHlwZSB7QmFja2dyb3VuZEpvYkNvbmN1cnJlbmN5Q291bnRSb3d9ICovIChyYXdSb3cpXG4gICAgICBhY3RpdmVDb3VudHMuc2V0KHJvdy5jb25jdXJyZW5jeV9rZXksIHRoaXMuX3ZhbGlkYXRlZENvbmN1cnJlbmN5Q291bnQocm93LmFjdGl2ZV9jb3VudCwgcm93LmNvbmN1cnJlbmN5X2tleSkpXG4gICAgfVxuXG4gICAgZm9yIChjb25zdCByYXdSb3cgb2Ygc3RhbGVSb3dzKSB7XG4gICAgICBjb25zdCByb3cgPSAvKiogQHR5cGUge0JhY2tncm91bmRKb2JDb25jdXJyZW5jeUNvdW50Um93fSAqLyAocmF3Um93KVxuICAgICAgcGVyc2lzdGVkQ291bnRzLnNldChyb3cuY29uY3VycmVuY3lfa2V5LCB0aGlzLl92YWxpZGF0ZWRDb25jdXJyZW5jeUNvdW50KHJvdy5hY3RpdmVfY291bnQsIHJvdy5jb25jdXJyZW5jeV9rZXkpKVxuICAgIH1cblxuICAgIGNvbnN0IGNvbmN1cnJlbmN5S2V5cyA9IFsuLi5uZXcgU2V0KFsuLi5hY3RpdmVDb3VudHMua2V5cygpLCAuLi5wZXJzaXN0ZWRDb3VudHMua2V5cygpXSldLnNvcnQoKVxuICAgIGNvbnN0IGNhbmRpZGF0ZUtleXMgPSBjb25jdXJyZW5jeUtleXMuZmlsdGVyKChjb25jdXJyZW5jeUtleSkgPT4ge1xuICAgICAgcmV0dXJuIChhY3RpdmVDb3VudHMuZ2V0KGNvbmN1cnJlbmN5S2V5KSB8fCAwKSAhPT0gKHBlcnNpc3RlZENvdW50cy5nZXQoY29uY3VycmVuY3lLZXkpIHx8IDApXG4gICAgfSlcbiAgICAvKiogQHR5cGUge2ltcG9ydChcIi4vdHlwZXMuanNcIikuQmFja2dyb3VuZEpvYkNvbmN1cnJlbmN5UmVwYWlyW119ICovXG4gICAgY29uc3QgcmVwYWlycyA9IFtdXG4gICAgbGV0IHJlcGFpcmVkQ291bnQgPSAwXG5cbiAgICBmb3IgKGNvbnN0IGNvbmN1cnJlbmN5S2V5IG9mIGNhbmRpZGF0ZUtleXMpIHtcbiAgICAgIGNvbnN0IHJlcGFpciA9IGluc2lkZVRyYW5zYWN0aW9uXG4gICAgICAgID8gYXdhaXQgdGhpcy5fcmVjb25jaWxlQ29uY3VycmVuY3lLZXkoZGIsIGNvbmN1cnJlbmN5S2V5KVxuICAgICAgICA6IGF3YWl0IHRoaXMuX3RyYW5zYWN0aW9uUmVzdWx0KGRiLCBhc3luYyAoKSA9PiBhd2FpdCB0aGlzLl9yZWNvbmNpbGVDb25jdXJyZW5jeUtleShkYiwgY29uY3VycmVuY3lLZXkpKVxuXG4gICAgICBpZiAoIXJlcGFpcikgY29udGludWVcblxuICAgICAgcmVwYWlyZWRDb3VudCsrXG4gICAgICBpZiAocmVwYWlycy5sZW5ndGggPCBDT05DVVJSRU5DWV9SRVBBSVJfU0FNUExFX0xJTUlUKSByZXBhaXJzLnB1c2gocmVwYWlyKVxuICAgIH1cblxuICAgIHJldHVybiB7XG4gICAgICBjYW5kaWRhdGVDb3VudDogY2FuZGlkYXRlS2V5cy5sZW5ndGgsXG4gICAgICBjaGVja2VkQ291bnQ6IGNvbmN1cnJlbmN5S2V5cy5sZW5ndGgsXG4gICAgICByZXBhaXJlZENvdW50LFxuICAgICAgcmVwYWlycyxcbiAgICAgIHJlcGFpcnNUcnVuY2F0ZWRDb3VudDogcmVwYWlyZWRDb3VudCAtIHJlcGFpcnMubGVuZ3RoXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIFJlYnVpbGRzIG9uZSBjb3VudGVyIGFmdGVyIGxvY2tpbmcgaXQgYWhlYWQgb2YgdGhlIGpvYiByb3dzLCBtYXRjaGluZyB0aGVcbiAgICogbG9jayBvcmRlciB1c2VkIGJ5IGhhbmRvZmYgYW5kIGNvbXBsZXRpb24gdHJhbnNpdGlvbnMuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vZGF0YWJhc2UvZHJpdmVycy9iYXNlLmpzXCIpLmRlZmF1bHR9IGRiIC0gRGF0YWJhc2UgY29ubmVjdGlvbi5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGNvbmN1cnJlbmN5S2V5IC0gQ291bnRlciBrZXkuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPGltcG9ydChcIi4vdHlwZXMuanNcIikuQmFja2dyb3VuZEpvYkNvbmN1cnJlbmN5UmVwYWlyIHwgbnVsbD59IC0gQXBwbGllZCByZXBhaXIuXG4gICAqL1xuICBhc3luYyBfcmVjb25jaWxlQ29uY3VycmVuY3lLZXkoZGIsIGNvbmN1cnJlbmN5S2V5KSB7XG4gICAgYXdhaXQgdGhpcy5fbG9ja0NvbmN1cnJlbmN5Um93KGRiLCBjb25jdXJyZW5jeUtleSlcbiAgICBjb25zdCBwZXJzaXN0ZWRSb3dzID0gYXdhaXQgZGJcbiAgICAgIC5uZXdRdWVyeSgpXG4gICAgICAuZnJvbShDT05DVVJSRU5DWV9UQUJMRSlcbiAgICAgIC5zZWxlY3QoXCJhY3RpdmVfY291bnRcIilcbiAgICAgIC5zZWxlY3QoXCJjb25jdXJyZW5jeV9rZXlcIilcbiAgICAgIC53aGVyZSh7Y29uY3VycmVuY3lfa2V5OiBjb25jdXJyZW5jeUtleX0pXG4gICAgICAubGltaXQoMSlcbiAgICAgIC5yZXN1bHRzKClcblxuICAgIGlmICghcGVyc2lzdGVkUm93c1swXSkgdGhyb3cgbmV3IEVycm9yKGBNaXNzaW5nIGJhY2tncm91bmQgam9iIGNvbmN1cnJlbmN5IGNvdW50ZXIgZm9yICR7Y29uY3VycmVuY3lLZXl9YClcblxuICAgIGNvbnN0IHBlcnNpc3RlZFJvdyA9IC8qKiBAdHlwZSB7QmFja2dyb3VuZEpvYkNvbmN1cnJlbmN5Q291bnRSb3d9ICovIChwZXJzaXN0ZWRSb3dzWzBdKVxuICAgIGNvbnN0IHByZXZpb3VzQWN0aXZlQ291bnQgPSB0aGlzLl92YWxpZGF0ZWRDb25jdXJyZW5jeUNvdW50KHBlcnNpc3RlZFJvdy5hY3RpdmVfY291bnQsIGNvbmN1cnJlbmN5S2V5KVxuICAgIGNvbnN0IHJvd3MgPSBhd2FpdCBkYlxuICAgICAgLm5ld1F1ZXJ5KClcbiAgICAgIC5mcm9tKEpPQlNfVEFCTEUpXG4gICAgICAuc2VsZWN0KFwiQ09VTlQoKikgQVMgYWN0aXZlX2NvdW50XCIpXG4gICAgICAud2hlcmUoe2NvbmN1cnJlbmN5X2tleTogY29uY3VycmVuY3lLZXksIHN0YXR1czogXCJoYW5kZWRfb2ZmXCJ9KVxuICAgICAgLnJlc3VsdHMoKVxuICAgIGNvbnN0IGNvdW50Um93ID0gLyoqIEB0eXBlIHt7YWN0aXZlX2NvdW50OiBudW1iZXIgfCBzdHJpbmd9fSAqLyAocm93c1swXSlcbiAgICBjb25zdCBhY3RpdmVDb3VudCA9IHRoaXMuX3ZhbGlkYXRlZENvbmN1cnJlbmN5Q291bnQoY291bnRSb3cuYWN0aXZlX2NvdW50LCBjb25jdXJyZW5jeUtleSlcblxuICAgIGlmIChhY3RpdmVDb3VudCA9PT0gcHJldmlvdXNBY3RpdmVDb3VudCkgcmV0dXJuIG51bGxcblxuICAgIGF3YWl0IGRiLnVwZGF0ZSh7XG4gICAgICB0YWJsZU5hbWU6IENPTkNVUlJFTkNZX1RBQkxFLFxuICAgICAgZGF0YToge2FjdGl2ZV9jb3VudDogYWN0aXZlQ291bnR9LFxuICAgICAgY29uZGl0aW9uczoge2NvbmN1cnJlbmN5X2tleTogY29uY3VycmVuY3lLZXl9XG4gICAgfSlcblxuICAgIHJldHVybiB7YWN0aXZlQ291bnQsIGNvbmN1cnJlbmN5S2V5LCBwcmV2aW91c0FjdGl2ZUNvdW50fVxuICB9XG5cbiAgLyoqXG4gICAqIFZhbGlkYXRlcyBhIGRhdGFiYXNlIGNvdW50IGJlZm9yZSBpdCBwYXJ0aWNpcGF0ZXMgaW4gcmVjb25jaWxpYXRpb24uXG4gICAqIEBwYXJhbSB7bnVtYmVyIHwgc3RyaW5nfSB2YWx1ZSAtIFJhdyBjb3VudC5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGNvbmN1cnJlbmN5S2V5IC0gQ291bnRlciBrZXkgZm9yIGRpYWdub3N0aWNzLlxuICAgKiBAcmV0dXJucyB7bnVtYmVyfSAtIFNhZmUgbm9uLW5lZ2F0aXZlIGNvdW50LlxuICAgKi9cbiAgX3ZhbGlkYXRlZENvbmN1cnJlbmN5Q291bnQodmFsdWUsIGNvbmN1cnJlbmN5S2V5KSB7XG4gICAgY29uc3QgY291bnQgPSB0aGlzLl9ub3JtYWxpemVOdW1iZXIodmFsdWUpXG5cbiAgICBpZiAoY291bnQgPT09IG51bGwgfHwgIU51bWJlci5pc1NhZmVJbnRlZ2VyKGNvdW50KSB8fCBjb3VudCA8IDApIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihgSW52YWxpZCByZWNvbmNpbGVkIGJhY2tncm91bmQgam9iIGNvbmN1cnJlbmN5IGNvdW50IGZvciAke2NvbmN1cnJlbmN5S2V5fTogJHtjb3VudH1gKVxuICAgIH1cblxuICAgIHJldHVybiBjb3VudFxuICB9XG5cbiAgLyoqXG4gICAqIFJlY29uY2lsZXMgcXVldWUtZGVyaXZlZCBjb25jdXJyZW5jeSB3aXRoIHRoZSBjdXJyZW50IGNvbmZpZ3VyYXRpb24uIE9ubHlcbiAgICogaW52b2tlZCB0aHJvdWdoIHtAbGluayByZWNvbmNpbGVRdWV1ZUNvbmN1cnJlbmN5fSDigJQgdGhlIGV4cGxpY2l0IGxpZmVjeWNsZVxuICAgKiBwYXRoIHJ1biBhdCBtYWluLXByb2Nlc3Mgc3RhcnR1cCB1bmRlciBhIGNyb3NzLXByb2Nlc3MgYWR2aXNvcnkgbG9jayDigJRcbiAgICogbmV2ZXIgZnJvbSBzY2hlbWEvdGVuYW50IGNoZWNrcyBvciByb3V0aW5lIGNvbm5lY3Rpb24gaW5pdGlhbGl6YXRpb24sXG4gICAqIHdoaWNoIHN0YXkgcmVhZC1vbmx5IHJlZ2FyZGluZyBxdWV1ZWQgam9iIHJvd3MuIFRoZSBwZXItcHJvY2VzcyBtZW1vIGlzXG4gICAqIGxhdGNoZWQgYnkge0BsaW5rIHJlY29uY2lsZVF1ZXVlQ29uY3VycmVuY3l9IG9ubHkgYWZ0ZXIgdGhlIGZvbGxvd2luZ1xuICAgKiBjb3VudCByZWJ1aWxkIGFsc28gc3VjY2VlZHMsIHNvIGEgZmFpbGVkIHJlYnVpbGQgcmUtZW50ZXJzIGhlcmUgb24gcmV0cnlcbiAgICogKHRoZSBhZG9wdGlvbiBVUERBVEVzIGJlbG93IGFyZSBpZGVtcG90ZW50KS4gRW5xdWV1ZSBvbmx5IGNvbnN1bHRzIGNvbmZpZyBmb3IgbmV3IGpvYnMsIHNvIGEgY2FwIGFkZGVkLCByZW1vdmVkLCBvciBjaGFuZ2VkXG4gICAqIHdoaWxlIGEgYmFja2xvZyBleGlzdHMgb3RoZXJ3aXNlIGxlYXZlcyBwZXJzaXN0ZWQgcm93cyBzdGFsZTogcHJlLWNhcCBqb2JzXG4gICAqIGtlZXAgYSBudWxsIGtleSBhbmQgYnlwYXNzIHRoZSBjYXAsIHBvc3QtcmVtb3ZhbCBqb2JzIHN0YXkgY2FwcGVkIHVuZGVyIGFcbiAgICogbm93LXVuY29uZmlndXJlZCBrZXksIGFuZCBhIGNoYW5nZWQgbnVtZXJpYyBjYXAgc3RheXMgc3RhbGUgdW50aWwgdGhlIG5leHRcbiAgICogZW5xdWV1ZS4gQnJpbmcgcXVldWVkIGR1cmFibGUgc3RhdGUgaW4gbGluZSB3aXRoIGNvbmZpZzogc3luYyBlYWNoIGNvbmZpZ3VyZWRcbiAgICogcXVldWUncyBzdG9yZWQgY2FwLCBhZG9wdCBub3QteWV0LWtleWVkIHF1ZXVlZCBqb2JzIG9udG8gdGhlaXIgcXVldWUga2V5LFxuICAgKiBhbmQgcmVsZWFzZSBxdWV1ZWQgam9icyBmcm9tIHF1ZXVlIGtleXMgd2hvc2UgcXVldWUgaXMgbm8gbG9uZ2VyIGNhcHBlZC5cbiAgICogRXhpc3RpbmcgaGFuZG9mZnMgcmV0YWluIHRoZSBwb2xpY3kgYW5kIHJlc2VydmF0aW9uIHRoZXkgc3RhcnRlZCB3aXRoLCBzb1xuICAgKiByZWNvbmNpbGlhdGlvbiBjYW5ub3QgcmFjZSB0aGVpciBjb21wbGV0aW9uL3JldHJ5IHRyYW5zaXRpb25zLiBSdW5zIGJlZm9yZVxuICAgKiB7QGxpbmsgX3JlY29uY2lsZUNvbmN1cnJlbmN5fSBzbyBhbnkgcHJlLWV4aXN0aW5nIGFjdGl2ZSBjb3VudHMgYXJlIGV4YWN0LlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL2RhdGFiYXNlL2RyaXZlcnMvYmFzZS5qc1wiKS5kZWZhdWx0fSBkYiAtIERhdGFiYXNlIGNvbm5lY3Rpb24uXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIHdoZW4gcmVjb25jaWxlZC5cbiAgICovXG4gIGFzeW5jIF9yZWNvbmNpbGVRdWV1ZUNvbmN1cnJlbmN5KGRiKSB7XG4gICAgaWYgKHRoaXMuX3F1ZXVlQ29uY3VycmVuY3lSZWNvbmNpbGVkKSByZXR1cm5cbiAgICBpZiAoIShhd2FpdCBkYi50YWJsZUV4aXN0cyhDT05DVVJSRU5DWV9UQUJMRSkpKSByZXR1cm5cblxuICAgIGNvbnN0IHF1ZXVlc0NvbmZpZyA9IHRoaXMuY29uZmlndXJhdGlvbi5nZXRCYWNrZ3JvdW5kSm9ic0NvbmZpZygpLnF1ZXVlcyB8fCB7fVxuICAgIGNvbnN0IGpvYnNUYWJsZSA9IGRiLnF1b3RlVGFibGUoSk9CU19UQUJMRSlcbiAgICBjb25zdCBrZXlDb2x1bW4gPSBkYi5xdW90ZUNvbHVtbihcImNvbmN1cnJlbmN5X2tleVwiKVxuICAgIGNvbnN0IGNhcENvbHVtbiA9IGRiLnF1b3RlQ29sdW1uKFwibWF4X2NvbmN1cnJlbmN5XCIpXG4gICAgY29uc3QgcXVldWVDb2x1bW4gPSBkYi5xdW90ZUNvbHVtbihcInF1ZXVlXCIpXG4gICAgY29uc3QgcXVldWVkID0gYCR7ZGIucXVvdGVDb2x1bW4oXCJzdGF0dXNcIil9ID0gJHtkYi5xdW90ZShcInF1ZXVlZFwiKX1gXG4gICAgLyoqIEB0eXBlIHtTZXQ8c3RyaW5nPn0gKi9cbiAgICBjb25zdCBjYXBwZWRRdWV1ZXMgPSBuZXcgU2V0KClcblxuICAgIGZvciAoY29uc3QgcXVldWUgb2YgT2JqZWN0LmtleXMocXVldWVzQ29uZmlnKSkge1xuICAgICAgY29uc3QgY2FwID0gdGhpcy5fcXVldWVNYXhDb25jdXJyZW5jeShxdWV1ZSlcblxuICAgICAgaWYgKGNhcCA9PT0gbnVsbCkgY29udGludWVcblxuICAgICAgY2FwcGVkUXVldWVzLmFkZChxdWV1ZSlcbiAgICAgIGNvbnN0IGNvbmN1cnJlbmN5S2V5ID0gYCR7UVVFVUVfQ09OQ1VSUkVOQ1lfS0VZX1BSRUZJWH0ke3F1ZXVlfWBcblxuICAgICAgYXdhaXQgdGhpcy5fZW5zdXJlUXVldWVDb25jdXJyZW5jeUtleShkYiwge2NvbmN1cnJlbmN5S2V5LCBtYXhDb25jdXJyZW5jeTogY2FwfSlcbiAgICAgIGF3YWl0IGRiLnF1ZXJ5KFxuICAgICAgICBgVVBEQVRFICR7am9ic1RhYmxlfSBTRVQgJHtrZXlDb2x1bW59ID0gJHtkYi5xdW90ZShjb25jdXJyZW5jeUtleSl9LCAke2NhcENvbHVtbn0gPSAke051bWJlcihjYXApfSBgICtcbiAgICAgICAgYFdIRVJFICR7cXVldWVDb2x1bW59ID0gJHtkYi5xdW90ZShxdWV1ZSl9IEFORCAke2tleUNvbHVtbn0gSVMgTlVMTCBBTkQgJHtxdWV1ZWR9YFxuICAgICAgKVxuICAgIH1cblxuICAgIGNvbnN0IGNvbmN1cnJlbmN5Um93cyA9IGF3YWl0IGRiXG4gICAgICAubmV3UXVlcnkoKVxuICAgICAgLmZyb20oQ09OQ1VSUkVOQ1lfVEFCTEUpXG4gICAgICAuc2VsZWN0KFwiY29uY3VycmVuY3lfa2V5XCIpXG4gICAgICAud2hlcmUoYCR7ZGIucXVvdGVDb2x1bW4oXCJjb25jdXJyZW5jeV9rZXlcIil9IExJS0UgJHtkYi5xdW90ZShgJHtRVUVVRV9DT05DVVJSRU5DWV9LRVlfUFJFRklYfSVgKX1gKVxuICAgICAgLnJlc3VsdHMoKVxuXG4gICAgZm9yIChjb25zdCByb3cgb2YgY29uY3VycmVuY3lSb3dzKSB7XG4gICAgICBjb25zdCBjb25jdXJyZW5jeUtleSA9IFN0cmluZygvKiogQHR5cGUge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gKi8gKHJvdykuY29uY3VycmVuY3lfa2V5KVxuXG4gICAgICBpZiAoIWNvbmN1cnJlbmN5S2V5LnN0YXJ0c1dpdGgoUVVFVUVfQ09OQ1VSUkVOQ1lfS0VZX1BSRUZJWCkpIGNvbnRpbnVlXG4gICAgICBpZiAoY2FwcGVkUXVldWVzLmhhcyhjb25jdXJyZW5jeUtleS5zbGljZShRVUVVRV9DT05DVVJSRU5DWV9LRVlfUFJFRklYLmxlbmd0aCkpKSBjb250aW51ZVxuXG4gICAgICBhd2FpdCBkYi5xdWVyeShcbiAgICAgICAgYFVQREFURSAke2pvYnNUYWJsZX0gU0VUICR7a2V5Q29sdW1ufSA9IE5VTEwsICR7Y2FwQ29sdW1ufSA9IE5VTEwgYCArXG4gICAgICAgIGBXSEVSRSAke2tleUNvbHVtbn0gPSAke2RiLnF1b3RlKGNvbmN1cnJlbmN5S2V5KX0gQU5EICR7cXVldWVkfWBcbiAgICAgIClcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogUnVucyBub3JtYWxpemUgbnVtYmVyLlxuICAgKiBAcGFyYW0ge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSB2YWx1ZSAtIElucHV0IHZhbHVlLlxuICAgKiBAcmV0dXJucyB7bnVtYmVyIHwgbnVsbH0gLSBOb3JtYWxpemVkIG51bWJlci5cbiAgICovXG4gIF9ub3JtYWxpemVOdW1iZXIodmFsdWUpIHtcbiAgICBpZiAodmFsdWUgPT09IG51bGwgfHwgdmFsdWUgPT09IHVuZGVmaW5lZCB8fCB2YWx1ZSA9PT0gXCJcIikgcmV0dXJuIG51bGxcblxuICAgIGNvbnN0IG51bWVyaWMgPSBOdW1iZXIodmFsdWUpXG5cbiAgICBpZiAoTnVtYmVyLmlzTmFOKG51bWVyaWMpKSByZXR1cm4gbnVsbFxuXG4gICAgcmV0dXJuIG51bWVyaWNcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIG5vcm1hbGl6ZSBleGVjdXRpb24gbW9kZS5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL3R5cGVzLmpzXCIpLkJhY2tncm91bmRKb2JPcHRpb25zfSBbb3B0aW9uc10gLSBKb2Igb3B0aW9ucy5cbiAgICogQHJldHVybnMge2ltcG9ydChcIi4vdHlwZXMuanNcIikuQmFja2dyb3VuZEpvYkV4ZWN1dGlvbk1vZGV9IC0gTm9ybWFsaXplZCBleGVjdXRpb24gbW9kZS5cbiAgICovXG4gIF9ub3JtYWxpemVFeGVjdXRpb25Nb2RlKG9wdGlvbnMpIHtcbiAgICByZXR1cm4gbm9ybWFsaXplQmFja2dyb3VuZEpvYkV4ZWN1dGlvbk1vZGUob3B0aW9ucyB8fCB7fSwgREVGQVVMVF9CQUNLR1JPVU5EX0pPQl9FWEVDVVRJT05fTU9ERSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIG5vcm1hbGl6ZSBleGVjdXRpb24gbW9kZSBuYW1lLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gZXhlY3V0aW9uTW9kZSAtIEV4ZWN1dGlvbiBtb2RlIG5hbWUuXG4gICAqIEByZXR1cm5zIHtpbXBvcnQoXCIuL3R5cGVzLmpzXCIpLkJhY2tncm91bmRKb2JFeGVjdXRpb25Nb2RlfSAtIE5vcm1hbGl6ZWQgZXhlY3V0aW9uIG1vZGUuXG4gICAqL1xuICBfbm9ybWFsaXplRXhlY3V0aW9uTW9kZU5hbWUoZXhlY3V0aW9uTW9kZSkge1xuICAgIHJldHVybiBub3JtYWxpemVCYWNrZ3JvdW5kSm9iRXhlY3V0aW9uTW9kZShcbiAgICAgIHtleGVjdXRpb25Nb2RlOiAvKiogQHR5cGUge2ltcG9ydChcIi4vdHlwZXMuanNcIikuQmFja2dyb3VuZEpvYkV4ZWN1dGlvbk1vZGV9ICovIChleGVjdXRpb25Nb2RlKX0sXG4gICAgICBERUZBVUxUX0JBQ0tHUk9VTkRfSk9CX0VYRUNVVElPTl9NT0RFLFxuICAgICAgQkFDS0dST1VORF9KT0JfRVhFQ1VUSU9OX01PREVTXG4gICAgKVxuICB9XG5cbiAgLyoqXG4gICAqIEZpbHRlcnMgcXVldWVkIGpvYnMgYnkgb25lIG9yIG1vcmUgZXhlY3V0aW9uIG1vZGVzIGFnYWluc3QgdGhlXG4gICAqIGBleGVjdXRpb25fbW9kZWAgY29sdW1uICh0aGUgc2luZ2xlIHNvdXJjZSBvZiB0cnV0aCkuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gT3B0aW9ucy5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9kYXRhYmFzZS9kcml2ZXJzL2Jhc2UuanNcIikuZGVmYXVsdH0gYXJncy5kYiAtIERhdGFiYXNlIGNvbm5lY3Rpb24uXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi90eXBlcy5qc1wiKS5CYWNrZ3JvdW5kSm9iRXhlY3V0aW9uTW9kZSB8IGltcG9ydChcIi4vdHlwZXMuanNcIikuQmFja2dyb3VuZEpvYkV4ZWN1dGlvbk1vZGVbXX0gYXJncy5leGVjdXRpb25Nb2RlIC0gUnVudGltZSBtb2Rlcy5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9kYXRhYmFzZS9xdWVyeS9pbmRleC5qc1wiKS5kZWZhdWx0fSBhcmdzLnF1ZXJ5IC0gUXVlcnkgdG8gZmlsdGVyLlxuICAgKiBAcmV0dXJucyB7aW1wb3J0KFwiLi4vZGF0YWJhc2UvcXVlcnkvaW5kZXguanNcIikuZGVmYXVsdH0gLSBGaWx0ZXJlZCBxdWVyeS5cbiAgICovXG4gIF93aGVyZUV4ZWN1dGlvbk1vZGUoe2RiLCBleGVjdXRpb25Nb2RlLCBxdWVyeX0pIHtcbiAgICBjb25zdCBleGVjdXRpb25Nb2RlcyA9IEFycmF5LmlzQXJyYXkoZXhlY3V0aW9uTW9kZSkgPyBleGVjdXRpb25Nb2RlIDogW2V4ZWN1dGlvbk1vZGVdXG4gICAgY29uc3QgZXhlY3V0aW9uTW9kZUNvbHVtbiA9IGRiLnF1b3RlQ29sdW1uKFwiZXhlY3V0aW9uX21vZGVcIilcbiAgICBjb25zdCBjb25kaXRpb25zID0gZXhlY3V0aW9uTW9kZXMubWFwKChtb2RlKSA9PiBgJHtleGVjdXRpb25Nb2RlQ29sdW1ufSA9ICR7ZGIucXVvdGUobW9kZSl9YClcblxuICAgIHJldHVybiBxdWVyeS53aGVyZShgKCR7Y29uZGl0aW9ucy5qb2luKFwiIE9SIFwiKX0pYClcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHBhcnNlIGFyZ3MuXG4gICAqIEBwYXJhbSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59IHZhbHVlIC0gSW5wdXQgdmFsdWUuXG4gICAqIEByZXR1cm5zIHtBcnJheTxSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59IC0gUGFyc2VkIGFyZ3MuXG4gICAqL1xuICBfcGFyc2VBcmdzKHZhbHVlKSB7XG4gICAgaWYgKCF2YWx1ZSkgcmV0dXJuIFtdXG5cbiAgICB0cnkge1xuICAgICAgY29uc3QgcGFyc2VkID0gSlNPTi5wYXJzZShTdHJpbmcodmFsdWUpKVxuXG4gICAgICBpZiAoQXJyYXkuaXNBcnJheShwYXJzZWQpKSByZXR1cm4gcGFyc2VkXG4gICAgfSBjYXRjaCB7XG4gICAgICAvLyBJZ25vcmUgcGFyc2UgZXJyb3JzLlxuICAgIH1cblxuICAgIHJldHVybiBbXVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgd2l0aCBkYi5cbiAgICogQHRlbXBsYXRlIFRcbiAgICogQHBhcmFtIHsoZGI6IGltcG9ydChcIi4uL2RhdGFiYXNlL2RyaXZlcnMvYmFzZS5qc1wiKS5kZWZhdWx0KSA9PiBQcm9taXNlPFQ+fSBjYWxsYmFjayAtIENhbGxiYWNrLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxUPn0gLSBDYWxsYmFjayByZXN1bHQuXG4gICAqL1xuICBhc3luYyBfd2l0aERiKGNhbGxiYWNrKSB7XG4gICAgY29uc3QgZGF0YWJhc2VJZGVudGlmaWVyID0gdGhpcy5nZXREYXRhYmFzZUlkZW50aWZpZXIoKVxuICAgIGNvbnN0IHBvb2wgPSB0aGlzLmNvbmZpZ3VyYXRpb24uZ2V0RGF0YWJhc2VQb29sKGRhdGFiYXNlSWRlbnRpZmllcilcblxuICAgIGlmICghcG9vbC50ZXN0U2hhcmVkQ29ubmVjdGlvbigpKSB7XG4gICAgICByZXR1cm4gYXdhaXQgcG9vbC53aXRoQ29ubmVjdGlvbih7bmFtZTogXCJCYWNrZ3JvdW5kIGpvYnMgc3RvcmVcIn0sIGNhbGxiYWNrKVxuICAgIH1cblxuICAgIHJldHVybiBhd2FpdCB0aGlzLmNvbmZpZ3VyYXRpb24ucnVuV2l0aFRlc3RTaGFyZWRDb25uZWN0aW9uQ29udGV4dHMoYXN5bmMgKCkgPT4ge1xuICAgICAgcmV0dXJuIGF3YWl0IHRoaXMuY29uZmlndXJhdGlvbi5lbnN1cmVDb25uZWN0aW9ucyh7ZGF0YWJhc2VJZGVudGlmaWVyczogW2RhdGFiYXNlSWRlbnRpZmllcl0sIG5hbWU6IFwiQmFja2dyb3VuZCBqb2JzIHN0b3JlXCJ9LCBhc3luYyAoZGJzKSA9PiB7XG4gICAgICAgIGNvbnN0IGNvbm5lY3Rpb24gPSBkYnNbZGF0YWJhc2VJZGVudGlmaWVyXVxuICAgICAgICByZXR1cm4gYXdhaXQgY29vcmRpbmF0ZVNoYXJlZFRyYW5zYWN0aW9uQ29ubmVjdGlvbihjb25uZWN0aW9uLCBhc3luYyAoKSA9PiBhd2FpdCBjYWxsYmFjayhjb25uZWN0aW9uKSlcbiAgICAgIH0pXG4gICAgfSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGEgdmFsdWUtcmV0dXJuaW5nIGNhbGxiYWNrIGluc2lkZSB0aGUgZHJpdmVyJ3Mgdm9pZC10eXBlZCB0cmFuc2FjdGlvbiBBUEkuXG4gICAqIEB0ZW1wbGF0ZSBUXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vZGF0YWJhc2UvZHJpdmVycy9iYXNlLmpzXCIpLmRlZmF1bHR9IGRiIC0gRGF0YWJhc2UgY29ubmVjdGlvbi5cbiAgICogQHBhcmFtIHsoKSA9PiBQcm9taXNlPFQ+fSBjYWxsYmFjayAtIFRyYW5zYWN0aW9uIGNhbGxiYWNrLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxUPn0gLSBDYWxsYmFjayByZXN1bHQuXG4gICAqL1xuICBhc3luYyBfdHJhbnNhY3Rpb25SZXN1bHQoZGIsIGNhbGxiYWNrKSB7XG4gICAgbGV0IGNvbXBsZXRlZCA9IGZhbHNlXG4gICAgLyoqIEB0eXBlIHtUIHwgdW5kZWZpbmVkfSAqL1xuICAgIGxldCByZXN1bHRcbiAgICBhd2FpdCBkYi50cmFuc2FjdGlvbihhc3luYyAoKSA9PiB7XG4gICAgICByZXN1bHQgPSBhd2FpdCBjYWxsYmFjaygpXG4gICAgICBjb21wbGV0ZWQgPSB0cnVlXG4gICAgfSlcbiAgICBpZiAoIWNvbXBsZXRlZCkgdGhyb3cgbmV3IEVycm9yKFwiQmFja2dyb3VuZCBqb2JzIHRyYW5zYWN0aW9uIGNhbGxiYWNrIHdhcyBub3QgaW52b2tlZFwiKVxuICAgIHJldHVybiAvKiogQHR5cGUge1R9ICovIChyZXN1bHQpXG4gIH1cblxuICAvKipcbiAgICogU2VyaWFsaXplcyBjb3VudC1jaGFuZ2luZyB0cmFuc2FjdGlvbnMgYmVmb3JlIGNoZWNraW5nIG91dCB0aGVpciBjb25uZWN0aW9uLlxuICAgKiBEYXRhYmFzZSByb3cgbG9ja2luZyBzdGlsbCBwcm92aWRlcyBjcm9zcy1wcm9jZXNzIG9yZGVyaW5nOyB0aGlzIGd1YXJkXG4gICAqIHByZXZlbnRzIGNvbmN1cnJlbnQgY2FsbGVycyBvbiBTUUxpdGUncyBzaGFyZWQgY29ubmVjdGlvbiBmcm9tIGF0dGVtcHRpbmdcbiAgICogb3ZlcmxhcHBpbmcgdG9wLWxldmVsIHRyYW5zYWN0aW9ucy5cbiAgICogQHRlbXBsYXRlIFRcbiAgICogQHBhcmFtIHsoZGI6IGltcG9ydChcIi4uL2RhdGFiYXNlL2RyaXZlcnMvYmFzZS5qc1wiKS5kZWZhdWx0KSA9PiBQcm9taXNlPFQ+fSBjYWxsYmFjayAtIFRyYW5zYWN0aW9uIGNhbGxiYWNrLlxuICAgKiBAcGFyYW0ge0JhY2tncm91bmRKb2JUcmFuc2FjdGlvblNlcmlhbGl6YXRpb25PcHRpb25zfSBbb3B0aW9uc10gLSBTZXJpYWxpemF0aW9uIG9wdGlvbnMuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPFQ+fSBDYWxsYmFjayByZXN1bHQuXG4gICAqL1xuICBhc3luYyBfc2VyaWFsaXplZENvdW50TXV0YXRpb24oY2FsbGJhY2ssIG9wdGlvbnMgPSB7fSkge1xuICAgIHJldHVybiBhd2FpdCB0aGlzLl9zZXJpYWxpemVkVHJhbnNhY3Rpb25NdXRhdGlvbihhc3luYyAoZGIpID0+IHtcbiAgICAgIGF3YWl0IHRoaXMuX2xvY2tDb3VudFJldmlzaW9uKGRiKVxuXG4gICAgICByZXR1cm4gYXdhaXQgY2FsbGJhY2soZGIpXG4gICAgfSwgb3B0aW9ucylcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGEgc2VyaWFsaXplZCBjYWxsYmFjayBpbnNpZGUgb25lIHRyYW5zYWN0aW9uLlxuICAgKiBAdGVtcGxhdGUgVFxuICAgKiBAcGFyYW0geyhkYjogaW1wb3J0KFwiLi4vZGF0YWJhc2UvZHJpdmVycy9iYXNlLmpzXCIpLmRlZmF1bHQpID0+IFByb21pc2U8VD59IGNhbGxiYWNrIC0gVHJhbnNhY3Rpb24gY2FsbGJhY2suXG4gICAqIEBwYXJhbSB7QmFja2dyb3VuZEpvYlRyYW5zYWN0aW9uU2VyaWFsaXphdGlvbk9wdGlvbnN9IFtvcHRpb25zXSAtIFNlcmlhbGl6YXRpb24gb3B0aW9ucy5cbiAgICogQHJldHVybnMge1Byb21pc2U8VD59IENhbGxiYWNrIHJlc3VsdC5cbiAgICovXG4gIGFzeW5jIF9zZXJpYWxpemVkVHJhbnNhY3Rpb25NdXRhdGlvbihjYWxsYmFjaywgb3B0aW9ucyA9IHt9KSB7XG4gICAgcmV0dXJuIGF3YWl0IHRoaXMuX3NlcmlhbGl6ZWRDb25uZWN0aW9uTXV0YXRpb24oXG4gICAgICBhc3luYyAoZGIpID0+IGF3YWl0IHRoaXMuX3RyYW5zYWN0aW9uUmVzdWx0KGRiLCBhc3luYyAoKSA9PiBhd2FpdCBjYWxsYmFjayhkYikpLFxuICAgICAgb3B0aW9uc1xuICAgIClcbiAgfVxuXG4gIC8qKlxuICAgKiBBZG1pdHMgbXV0YXRpb24gY2FsbGJhY2tzIHRvIHRoZSBwcm9jZXNzLWxvY2FsIEZJRk8gYmVmb3JlIHRoZXkgY2hlY2sgb3V0IGFcbiAgICogY29ubmVjdGlvbi4gQ3Jvc3MtcHJvY2VzcyBvcmRlcmluZyByZW1haW5zIHRoZSByZXNwb25zaWJpbGl0eSBvZiBkdXJhYmxlXG4gICAqIHJvdy9hZHZpc29yeSBsb2NrcyBhbmQgdW5pcXVlIGNvbnN0cmFpbnRzIGFjcXVpcmVkIGFyb3VuZCB0aGUgY2FsbGJhY2suXG4gICAqIEB0ZW1wbGF0ZSBUXG4gICAqIEBwYXJhbSB7KGRiOiBpbXBvcnQoXCIuLi9kYXRhYmFzZS9kcml2ZXJzL2Jhc2UuanNcIikuZGVmYXVsdCkgPT4gUHJvbWlzZTxUPn0gY2FsbGJhY2sgLSBDb25uZWN0aW9uIGNhbGxiYWNrLlxuICAgKiBAcGFyYW0ge0JhY2tncm91bmRKb2JUcmFuc2FjdGlvblNlcmlhbGl6YXRpb25PcHRpb25zfSBbb3B0aW9uc10gLSBTZXJpYWxpemF0aW9uIG9wdGlvbnMuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPFQ+fSBDYWxsYmFjayByZXN1bHQuXG4gICAqL1xuICBhc3luYyBfc2VyaWFsaXplZENvbm5lY3Rpb25NdXRhdGlvbihjYWxsYmFjaywgb3B0aW9ucyA9IHt9KSB7XG4gICAgY29uc3QgaWRlbnRpZmllciA9IHRoaXMuZ2V0RGF0YWJhc2VJZGVudGlmaWVyKCkgfHwgXCJkZWZhdWx0XCJcbiAgICBjb25zdCBwcmV2aW91cyA9IHRyYW5zYWN0aW9uTXV0YXRpb25DaGFpbnMuZ2V0KGlkZW50aWZpZXIpIHx8IFByb21pc2UucmVzb2x2ZSgpXG4gICAgbGV0IHJlc29sdmVSdW4gPSAoKSA9PiB7fVxuICAgIC8qKiBAdHlwZSB7UHJvbWlzZTx2b2lkPn0gKi9cbiAgICBjb25zdCBydW4gPSBuZXcgUHJvbWlzZSgocmVzb2x2ZSkgPT4ge1xuICAgICAgcmVzb2x2ZVJ1biA9ICgpID0+IHJlc29sdmUodW5kZWZpbmVkKVxuICAgIH0pXG4gICAgY29uc3QgY2hhaW4gPSBwcmV2aW91cy50aGVuKCgpID0+IHJ1bilcblxuICAgIHRyYW5zYWN0aW9uTXV0YXRpb25DaGFpbnMuc2V0KGlkZW50aWZpZXIsIGNoYWluKVxuICAgIGF3YWl0IHByZXZpb3VzXG5cbiAgICB0cnkge1xuICAgICAgcmV0dXJuIGF3YWl0IHRoaXMuX3dpdGhEYihhc3luYyAoZGIpID0+IHtcbiAgICAgICAgY29uc3Qge2Fkdmlzb3J5TG9ja30gPSBvcHRpb25zXG5cbiAgICAgICAgaWYgKGFkdmlzb3J5TG9jaykge1xuICAgICAgICAgIGNvbnN0IGFjcXVpcmVkID0gYXdhaXQgZGIuYWNxdWlyZUFkdmlzb3J5TG9jayhhZHZpc29yeUxvY2submFtZSlcblxuICAgICAgICAgIGlmICghYWNxdWlyZWQpIHRocm93IG5ldyBFcnJvcihhZHZpc29yeUxvY2suZmFpbHVyZU1lc3NhZ2UpXG4gICAgICAgIH1cblxuICAgICAgICB0cnkge1xuICAgICAgICAgIHJldHVybiBhd2FpdCBjYWxsYmFjayhkYilcbiAgICAgICAgfSBmaW5hbGx5IHtcbiAgICAgICAgICBpZiAoYWR2aXNvcnlMb2NrKSBhd2FpdCBkYi5yZWxlYXNlQWR2aXNvcnlMb2NrKGFkdmlzb3J5TG9jay5uYW1lKVxuICAgICAgICB9XG4gICAgICB9KVxuICAgIH0gZmluYWxseSB7XG4gICAgICByZXNvbHZlUnVuKClcbiAgICAgIGlmICh0cmFuc2FjdGlvbk11dGF0aW9uQ2hhaW5zLmdldChpZGVudGlmaWVyKSA9PT0gY2hhaW4pIHRyYW5zYWN0aW9uTXV0YXRpb25DaGFpbnMuZGVsZXRlKGlkZW50aWZpZXIpXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgc2hvdWxkIGFjY2VwdCByZXBvcnQuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gT3B0aW9ucy5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL3R5cGVzLmpzXCIpLkJhY2tncm91bmRKb2JSb3d9IGFyZ3Muam9iIC0gSm9iIHJvdy5cbiAgICogQHBhcmFtIHtzdHJpbmcgfCBudWxsIHwgdW5kZWZpbmVkfSBhcmdzLmhhbmRvZmZJZCAtIEhhbmRvZmYgbGVhc2UgaWQgZnJvbSByZXBvcnQuXG4gICAqIEBwYXJhbSB7c3RyaW5nIHwgbnVsbCB8IHVuZGVmaW5lZH0gYXJncy53b3JrZXJJZCAtIFdvcmtlciBpZCBmcm9tIHJlcG9ydC5cbiAgICogQHBhcmFtIHtudW1iZXIgfCBudWxsIHwgdW5kZWZpbmVkfSBhcmdzLmhhbmRlZE9mZkF0TXMgLSBIYW5kZWQgb2ZmIHRpbWVzdGFtcCBmcm9tIHJlcG9ydC5cbiAgICogQHJldHVybnMge2Jvb2xlYW59IC0gV2hldGhlciB0byBhY2NlcHQgdGhlIHJlcG9ydC5cbiAgICovXG4gIF9zaG91bGRBY2NlcHRSZXBvcnQoe2pvYiwgaGFuZG9mZklkLCB3b3JrZXJJZCwgaGFuZGVkT2ZmQXRNc30pIHtcbiAgICBpZiAoam9iLnN0YXR1cyAhPT0gXCJoYW5kZWRfb2ZmXCIpIHJldHVybiBmYWxzZVxuXG4gICAgcmV0dXJuIHRoaXMuX2hhbmRvZmZJZFJlcG9ydE1hdGNoZXMoe2hhbmRvZmZJZCwgam9ifSlcbiAgICAgICYmIHRoaXMuX3dvcmtlclJlcG9ydE1hdGNoZXMoe2pvYiwgd29ya2VySWR9KVxuICAgICAgJiYgdGhpcy5faGFuZG9mZlJlcG9ydE1hdGNoZXMoe2hhbmRlZE9mZkF0TXMsIGpvYn0pXG4gIH1cblxuICAvKipcbiAgICogUnVucyBhY3RpdmUgaGFuZG9mZiBjb25kaXRpb25zLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vdHlwZXMuanNcIikuQmFja2dyb3VuZEpvYlJvd30gam9iIC0gSm9iIHJvdy5cbiAgICogQHJldHVybnMge1JlY29yZDxzdHJpbmcsIHN0cmluZyB8IG51bGw+fSAtIENvbmRpdGlvbmFsIHRyYW5zaXRpb24gZmVuY2UuXG4gICAqL1xuICBfYWN0aXZlSGFuZG9mZkNvbmRpdGlvbnMoam9iKSB7XG4gICAgcmV0dXJuIHtoYW5kb2ZmX2lkOiBqb2IuaGFuZG9mZklkLCBpZDogam9iLmlkLCBzdGF0dXM6IFwiaGFuZGVkX29mZlwifVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgaGFuZG9mZiBpZCByZXBvcnQgbWF0Y2hlcy5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBPcHRpb25zLlxuICAgKiBAcGFyYW0ge3N0cmluZyB8IG51bGwgfCB1bmRlZmluZWR9IGFyZ3MuaGFuZG9mZklkIC0gSGFuZG9mZiBsZWFzZSBpZCBmcm9tIHJlcG9ydC5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL3R5cGVzLmpzXCIpLkJhY2tncm91bmRKb2JSb3d9IGFyZ3Muam9iIC0gSm9iIHJvdy5cbiAgICogQHJldHVybnMge2Jvb2xlYW59IC0gV2hldGhlciB0aGUgaGFuZG9mZiBsZWFzZSBtYXRjaGVzLlxuICAgKi9cbiAgX2hhbmRvZmZJZFJlcG9ydE1hdGNoZXMoe2hhbmRvZmZJZCwgam9ifSkge1xuICAgIGlmICgham9iLmhhbmRvZmZJZCkgcmV0dXJuIHRydWVcblxuICAgIHJldHVybiBoYW5kb2ZmSWQgPT09IGpvYi5oYW5kb2ZmSWRcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHdvcmtlciByZXBvcnQgbWF0Y2hlcy5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBPcHRpb25zLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vdHlwZXMuanNcIikuQmFja2dyb3VuZEpvYlJvd30gYXJncy5qb2IgLSBKb2Igcm93LlxuICAgKiBAcGFyYW0ge3N0cmluZyB8IG51bGwgfCB1bmRlZmluZWR9IGFyZ3Mud29ya2VySWQgLSBXb3JrZXIgaWQgZnJvbSByZXBvcnQuXG4gICAqIEByZXR1cm5zIHtib29sZWFufSAtIFdoZXRoZXIgdGhlIHdvcmtlciByZXBvcnQgbWF0Y2hlcy5cbiAgICovXG4gIF93b3JrZXJSZXBvcnRNYXRjaGVzKHtqb2IsIHdvcmtlcklkfSkge1xuICAgIGlmICghd29ya2VySWQpIHJldHVybiB0cnVlXG4gICAgaWYgKCFqb2Iud29ya2VySWQpIHJldHVybiB0cnVlXG5cbiAgICByZXR1cm4gd29ya2VySWQgPT09IGpvYi53b3JrZXJJZFxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgaGFuZG9mZiByZXBvcnQgbWF0Y2hlcy5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBPcHRpb25zLlxuICAgKiBAcGFyYW0ge251bWJlciB8IG51bGwgfCB1bmRlZmluZWR9IGFyZ3MuaGFuZGVkT2ZmQXRNcyAtIEhhbmRlZCBvZmYgdGltZXN0YW1wIGZyb20gcmVwb3J0LlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vdHlwZXMuanNcIikuQmFja2dyb3VuZEpvYlJvd30gYXJncy5qb2IgLSBKb2Igcm93LlxuICAgKiBAcmV0dXJucyB7Ym9vbGVhbn0gLSBXaGV0aGVyIHRoZSBoYW5kb2ZmIHJlcG9ydCBtYXRjaGVzLlxuICAgKi9cbiAgX2hhbmRvZmZSZXBvcnRNYXRjaGVzKHtoYW5kZWRPZmZBdE1zLCBqb2J9KSB7XG4gICAgaWYgKCFoYW5kZWRPZmZBdE1zKSByZXR1cm4gdHJ1ZVxuICAgIGlmICgham9iLmhhbmRlZE9mZkF0TXMpIHJldHVybiB0cnVlXG5cbiAgICByZXR1cm4gaGFuZGVkT2ZmQXRNcyA9PT0gam9iLmhhbmRlZE9mZkF0TXNcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIG1pZ3JhdGlvbiBrZXkuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBbdmVyc2lvbl0gLSBNaWdyYXRpb24gdmVyc2lvbi5cbiAgICogQHJldHVybnMge3N0cmluZ30gLSBNaWdyYXRpb24ga2V5LlxuICAgKi9cbiAgX21pZ3JhdGlvbktleSh2ZXJzaW9uID0gTUlHUkFUSU9OX1ZFUlNJT04pIHtcbiAgICByZXR1cm4gYCR7TUlHUkFUSU9OX1NDT1BFfToke3ZlcnNpb259YFxuICB9XG59XG4iXX0=