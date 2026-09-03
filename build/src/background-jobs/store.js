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
            const lockName = "background-jobs:queue-concurrency-reconcile";
            const acquired = await db.acquireAdvisoryLock(lockName);
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
                await db.releaseAdvisoryLock(lockName);
            }
        });
        await this.logger.info(() => [
            "Completed background jobs queue-concurrency startup reconciliation",
            { databaseIdentifier, durationMs: Date.now() - startedAtMs }
        ]);
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
                conditions: { id: jobId, status: "queued" }
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
     * @returns {Promise<void>} - Resolves when reconciled.
     */
    async _reconcileConcurrency(db) {
        if (!(await db.tableExists(CONCURRENCY_TABLE)))
            return;
        const activeRows = await db
            .newQuery()
            .from(JOBS_TABLE)
            .select("concurrency_key")
            .where({ status: "handed_off" })
            .where(`${db.quoteColumn("concurrency_key")} IS NOT NULL`)
            .group("concurrency_key")
            .results();
        const staleRows = await db
            .newQuery()
            .from(CONCURRENCY_TABLE)
            .select("concurrency_key")
            .where(`${db.quoteColumn("active_count")} != 0`)
            .results();
        const concurrencyKeys = new Set([...activeRows, ...staleRows].map((row) => String(/** @type {Record<string, ReturnType<typeof JSON.parse>>} */ (row).concurrency_key)));
        for (const concurrencyKey of [...concurrencyKeys].sort()) {
            await this._transactionResult(db, async () => {
                await this._reconcileConcurrencyKey(db, concurrencyKey);
            });
        }
    }
    /**
     * Rebuilds one counter after locking it ahead of the job rows, matching the
     * lock order used by handoff and completion transitions.
     * @param {import("../database/drivers/base.js").default} db - Database connection.
     * @param {string} concurrencyKey - Counter key.
     * @returns {Promise<void>} - Resolves when reconciled.
     */
    async _reconcileConcurrencyKey(db, concurrencyKey) {
        await this._lockConcurrencyRow(db, concurrencyKey);
        const rows = await db
            .newQuery()
            .from(JOBS_TABLE)
            .select("COUNT(*) AS active_count")
            .where({ concurrency_key: concurrencyKey, status: "handed_off" })
            .results();
        const activeCount = this._normalizeNumber(
        /** @type {Record<string, ReturnType<typeof JSON.parse>>} */ (rows[0] || {}).active_count);
        if (activeCount === null || !Number.isSafeInteger(activeCount) || activeCount < 0) {
            throw new Error(`Invalid reconciled background job concurrency count for ${concurrencyKey}: ${activeCount}`);
        }
        await db.update({
            tableName: CONCURRENCY_TABLE,
            data: { active_count: activeCount },
            conditions: { concurrency_key: concurrencyKey }
        });
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
     * enqueue. Bring the durable state in line with config: sync each configured
     * queue's stored cap, adopt not-yet-keyed non-terminal jobs onto their queue
     * key, and release non-terminal jobs from queue keys whose queue is no
     * longer capped. Runs before {@link _reconcileConcurrency} so the rebuilt
     * active counts reflect the adopted/released keys.
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
        const nonTerminal = `${db.quoteColumn("status")} IN (${db.quote("queued")}, ${db.quote("handed_off")})`;
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
                `WHERE ${queueColumn} = ${db.quote(queue)} AND ${keyColumn} IS NULL AND ${nonTerminal}`);
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
                `WHERE ${keyColumn} = ${db.quote(concurrencyKey)} AND ${nonTerminal}`);
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoic3RvcmUuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi9zcmMvYmFja2dyb3VuZC1qb2JzL3N0b3JlLmpzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiJBQUFBLFlBQVk7QUFFWixPQUFPLEVBQUMsVUFBVSxFQUFFLFVBQVUsRUFBQyxNQUFNLFFBQVEsQ0FBQTtBQUM3QyxPQUFPLHFCQUFxQixNQUFNLGNBQWMsQ0FBQTtBQUNoRCxPQUFPLE1BQU0sTUFBTSxjQUFjLENBQUE7QUFDakMsT0FBTyxTQUFTLE1BQU0saUNBQWlDLENBQUE7QUFDdkQsT0FBTyxjQUFjLE1BQU0sdUJBQXVCLENBQUE7QUFDbEQsT0FBTyxtQkFBbUIsTUFBTSxpQkFBaUIsQ0FBQTtBQUNqRCxPQUFPLDJCQUEyQixNQUFNLHNCQUFzQixDQUFBO0FBQzlELE9BQU8sRUFBRSxxQ0FBcUMsRUFBRSxNQUFNLHlEQUF5RCxDQUFBO0FBQy9HLE9BQU8sbUJBQW1CLE1BQU0seUJBQXlCLENBQUE7QUFDekQsT0FBTyxFQUNMLDhCQUE4QixFQUM5QixxQ0FBcUMsRUFDckMsNEJBQTRCLEVBQzVCLDRCQUE0QixFQUM1QixpQ0FBaUMsRUFDakMsbUNBQW1DLEVBQ25DLGdDQUFnQyxFQUNoQywyQkFBMkIsRUFDM0IsbUNBQW1DLEVBQ25DLDRCQUE0QixFQUM1QixZQUFZLEVBQ2IsTUFBTSxvQkFBb0IsQ0FBQTtBQUMzQixPQUFPLEVBQ0wsOEJBQThCLEVBQzlCLDJCQUEyQixFQUMzQix3QkFBd0IsRUFDekIsTUFBTSxpQ0FBaUMsQ0FBQTtBQUV4Qzs7Ozs7Ozs7Ozs7OztHQWFHO0FBRUg7Ozs7O0dBS0c7QUFFSDs7OztHQUlHO0FBRUgsTUFBTSxnQkFBZ0IsR0FBRywrQkFBK0IsQ0FBQTtBQUN4RCxNQUFNLGVBQWUsR0FBRyxpQkFBaUIsQ0FBQTtBQUN6QyxNQUFNLGlCQUFpQixHQUFHLGdCQUFnQixDQUFBO0FBQzFDLE1BQU0sK0JBQStCLEdBQUcseUJBQXlCLENBQUE7QUFDakUs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QXdCLENBQUMsR0FBRztRQUMxQixPQUFPLEVBQUMsVUFBVSxFQUFFLEdBQUcsQ0FBQyxTQUFTLEVBQUUsRUFBRSxFQUFFLEdBQUcsQ0FBQyxFQUFFLEVBQUUsTUFBTSxFQUFFLFlBQVksRUFBQyxDQUFBO0lBQ3RFLENBQUM7SUFFRDs7Ozs7O09BTUc7SUFDSCx1QkFBdUIsQ0FBQyxFQUFDLFNBQVMsRUFBRSxHQUFHLEVBQUM7UUFDdEMsSUFBSSxDQUFDLEdBQUcsQ0FBQyxTQUFTO1lBQUUsT0FBTyxJQUFJLENBQUE7UUFFL0IsT0FBTyxTQUFTLEtBQUssR0FBRyxDQUFDLFNBQVMsQ0FBQTtJQUNwQyxDQUFDO0lBRUQ7Ozs7OztPQU1HO0lBQ0gsb0JBQW9CLENBQUMsRUFBQyxHQUFHLEVBQUUsUUFBUSxFQUFDO1FBQ2xDLElBQUksQ0FBQyxRQUFRO1lBQUUsT0FBTyxJQUFJLENBQUE7UUFDMUIsSUFBSSxDQUFDLEdBQUcsQ0FBQyxRQUFRO1lBQUUsT0FBTyxJQUFJLENBQUE7UUFFOUIsT0FBTyxRQUFRLEtBQUssR0FBRyxDQUFDLFFBQVEsQ0FBQTtJQUNsQyxDQUFDO0lBRUQ7Ozs7OztPQU1HO0lBQ0gscUJBQXFCLENBQUMsRUFBQyxhQUFhLEVBQUUsR0FBRyxFQUFDO1FBQ3hDLElBQUksQ0FBQyxhQUFhO1lBQUUsT0FBTyxJQUFJLENBQUE7UUFDL0IsSUFBSSxDQUFDLEdBQUcsQ0FBQyxhQUFhO1lBQUUsT0FBTyxJQUFJLENBQUE7UUFFbkMsT0FBTyxhQUFhLEtBQUssR0FBRyxDQUFDLGFBQWEsQ0FBQTtJQUM1QyxDQUFDO0lBRUQ7Ozs7T0FJRztJQUNILGFBQWEsQ0FBQyxPQUFPLEdBQUcsaUJBQWlCO1FBQ3ZDLE9BQU8sR0FBRyxlQUFlLElBQUksT0FBTyxFQUFFLENBQUE7SUFDeEMsQ0FBQztDQUNGIiwic291cmNlc0NvbnRlbnQiOlsiLy8gQHRzLWNoZWNrXG5cbmltcG9ydCB7Y3JlYXRlSGFzaCwgcmFuZG9tVVVJRH0gZnJvbSBcImNyeXB0b1wiXG5pbXBvcnQgQmFja2dyb3VuZEpvYnNBZGFwdGVyIGZyb20gXCIuL2FkYXB0ZXIuanNcIlxuaW1wb3J0IExvZ2dlciBmcm9tIFwiLi4vbG9nZ2VyLmpzXCJcbmltcG9ydCBUYWJsZURhdGEgZnJvbSBcIi4uL2RhdGFiYXNlL3RhYmxlLWRhdGEvaW5kZXguanNcIlxuaW1wb3J0IFZlbG9jaW91c0Vycm9yIGZyb20gXCIuLi92ZWxvY2lvdXMtZXJyb3IuanNcIlxuaW1wb3J0IEJhY2tncm91bmRKb2JSZWNvcmQgZnJvbSBcIi4vam9iLXJlY29yZC5qc1wiXG5pbXBvcnQgbm9ybWFsaXplQmFja2dyb3VuZEpvYkVycm9yIGZyb20gXCIuL25vcm1hbGl6ZS1lcnJvci5qc1wiXG5pbXBvcnQgeyBjb29yZGluYXRlU2hhcmVkVHJhbnNhY3Rpb25Db25uZWN0aW9uIH0gZnJvbSBcIi4uL3Rlc3Rpbmcvc2hhcmVkLXRyYW5zYWN0aW9uLWNvbm5lY3Rpb24tY29vcmRpbmF0b3IuanNcIlxuaW1wb3J0IHN0YWJsZUpzb25TdHJpbmdpZnkgZnJvbSBcIi4uL3V0aWxzL3N0YWJsZS1qc29uLmpzXCJcbmltcG9ydCB7XG4gIEJBQ0tHUk9VTkRfSk9CX0VYRUNVVElPTl9NT0RFUyxcbiAgREVGQVVMVF9CQUNLR1JPVU5EX0pPQl9FWEVDVVRJT05fTU9ERSxcbiAgREVGQVVMVF9CQUNLR1JPVU5EX0pPQl9RVUVVRSxcbiAgUVVFVUVfQ09OQ1VSUkVOQ1lfS0VZX1BSRUZJWCxcbiAgbm9ybWFsaXplQmFja2dyb3VuZEpvYkNvbmN1cnJlbmN5LFxuICBub3JtYWxpemVCYWNrZ3JvdW5kSm9iRXhlY3V0aW9uTW9kZSxcbiAgbm9ybWFsaXplQmFja2dyb3VuZEpvYk1heFJldHJpZXMsXG4gIG5vcm1hbGl6ZUJhY2tncm91bmRKb2JRdWV1ZSxcbiAgbm9ybWFsaXplQmFja2dyb3VuZEpvYlNjaGVkdWxlZEF0TXMsXG4gIHJlc2NoZWR1bGVkQmFja2dyb3VuZEpvYkF0TXMsXG4gIHJldHJ5RGVsYXlNc1xufSBmcm9tIFwiLi9qb2Itc2VtYW50aWNzLmpzXCJcbmltcG9ydCB7XG4gIE1BSUxfREVMSVZFUllfT1BFUkFUSU9OU19UQUJMRSxcbiAgbWFpbERlbGl2ZXJ5T3BlcmF0aW9uRm9ySm9iLFxuICBtYWlsRGVsaXZlcnlPcGVyYXRpb25LZXlcbn0gZnJvbSBcIi4uL21haWxlci9kZWxpdmVyeS1vcGVyYXRpb24uanNcIlxuXG4vKipcbiAqIFByZXBhcmVkQmFja2dyb3VuZEpvYiB0eXBlLlxuICogQHR5cGVkZWYge29iamVjdH0gUHJlcGFyZWRCYWNrZ3JvdW5kSm9iXG4gKiBAcHJvcGVydHkge3N0cmluZ30gYXJnc0pzb24gLSBTZXJpYWxpemVkIGFyZ3VtZW50cy5cbiAqIEBwcm9wZXJ0eSB7e2NvbmN1cnJlbmN5S2V5OiBzdHJpbmcsIG1heENvbmN1cnJlbmN5OiBudW1iZXIsIHF1ZXVlRGVyaXZlZDogYm9vbGVhbn0gfCBudWxsfSBjb25jdXJyZW5jeSAtIFJlc29sdmVkIGNvbmN1cnJlbmN5LlxuICogQHByb3BlcnR5IHtudW1iZXJ9IGNyZWF0ZWRBdE1zIC0gQ3JlYXRpb24gdGltZXN0YW1wLlxuICogQHByb3BlcnR5IHtpbXBvcnQoXCIuL3R5cGVzLmpzXCIpLkJhY2tncm91bmRKb2JFeGVjdXRpb25Nb2RlfSBleGVjdXRpb25Nb2RlIC0gRXhlY3V0aW9uIG1vZGUuXG4gKiBAcHJvcGVydHkge3N0cmluZ30gam9iSWQgLSBOZXcgam9iIGlkLlxuICogQHByb3BlcnR5IHtzdHJpbmd9IGpvYk5hbWUgLSBKb2IgbmFtZS5cbiAqIEBwcm9wZXJ0eSB7bnVtYmVyfSBtYXhSZXRyaWVzIC0gUmV0cnkgY2FwLlxuICogQHByb3BlcnR5IHtzdHJpbmd9IHF1ZXVlIC0gUXVldWUgbmFtZS5cbiAqIEBwcm9wZXJ0eSB7bnVtYmVyfSBzY2hlZHVsZWRBdE1zIC0gRWxpZ2liaWxpdHkgdGltZXN0YW1wLlxuICogQHByb3BlcnR5IHtudW1iZXIgfCBudWxsfSB0aW1lb3V0TXMgLSBQZXItam9iIHRpbWVvdXQgb3ZlcnJpZGUsIG9yIG51bGwgd2hlbiBvbWl0dGVkLlxuICovXG5cbi8qKlxuICogQmFja2dyb3VuZEpvYk9ycGhhblNlbGVjdGlvbiB0eXBlLlxuICogQHR5cGVkZWYge29iamVjdH0gQmFja2dyb3VuZEpvYk9ycGhhblNlbGVjdGlvblxuICogQHByb3BlcnR5IHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59IGNvbmRpdGlvbnMgLSBFeGFjdCB1cGRhdGUgZmVuY2UuXG4gKiBAcHJvcGVydHkge2ltcG9ydChcIi4vdHlwZXMuanNcIikuQmFja2dyb3VuZEpvYlJvd30gam9iIC0gU2VsZWN0ZWQgYWN0aXZlIGhhbmRvZmYuXG4gKi9cblxuLyoqXG4gKiBCYWNrZ3JvdW5kSm9iVHJhbnNhY3Rpb25TZXJpYWxpemF0aW9uT3B0aW9ucyB0eXBlLlxuICogQHR5cGVkZWYge29iamVjdH0gQmFja2dyb3VuZEpvYlRyYW5zYWN0aW9uU2VyaWFsaXphdGlvbk9wdGlvbnNcbiAqIEBwcm9wZXJ0eSB7e2ZhaWx1cmVNZXNzYWdlOiBzdHJpbmcsIG5hbWU6IHN0cmluZ319IFthZHZpc29yeUxvY2tdIC0gU2Vzc2lvbiBsb2NrIGhlbGQgYXJvdW5kIHRoZSB0cmFuc2FjdGlvbi5cbiAqL1xuXG5jb25zdCBNSUdSQVRJT05TX1RBQkxFID0gXCJ2ZWxvY2lvdXNfaW50ZXJuYWxfbWlncmF0aW9uc1wiXG5jb25zdCBNSUdSQVRJT05fU0NPUEUgPSBcImJhY2tncm91bmRfam9ic1wiXG5jb25zdCBNSUdSQVRJT05fVkVSU0lPTiA9IFwiMjAyNTAyMTUwMDAwMDBcIlxuY29uc3QgU0NIRU1BX1JFQ09WRVJZX1BFTkRJTkdfVkVSU0lPTiA9IFwic2NoZW1hLXJlY292ZXJ5LXBlbmRpbmdcIlxuY29uc3QgRVhFQ1VUSU9OX01PREVfQkFDS0ZJTExfTUlHUkFUSU9OX1ZFUlNJT04gPSBcIjIwMjYwNjA3MTMxMDEwXCJcbi8vIERyb3BzIHRoZSByZWR1bmRhbnQgbGVnYWN5IGBmb3JrZWRgIGJvb2xlYW4gY29sdW1uIGFuZCByZXdyaXRlcyBwb29sZWQgcm93cyB0b1xuLy8gcGVyc2lzdCBgZXhlY3V0aW9uX21vZGUgPSBcInBvb2xlZFwiYCBkaXJlY3RseSAocmV0aXJpbmcgdGhlIHBvb2xlZC1hcy1mb3JrZWRcbi8vIGhhbmRvZmYtbWFya2VyIHdvcmthcm91bmQpLCBsZWF2aW5nIGBleGVjdXRpb25fbW9kZWAgYXMgdGhlIHNpbmdsZSBzb3VyY2Ugb2Zcbi8vIHRydXRoIGZvciBhIGpvYidzIHJ1bnRpbWUuXG5jb25zdCBEUk9QX0ZPUktFRF9DT0xVTU5fTUlHUkFUSU9OX1ZFUlNJT04gPSBcIjIwMjYwNzE5MDAwMDAwXCJcbmNvbnN0IEpPQlNfSU5ERVhfUkVQQUlSX01JR1JBVElPTl9WRVJTSU9OID0gXCIyMDI2MDkwMzEyMDAwMFwiXG4vLyBMZWdhY3kgbWFya2VyIHByZWZpeCB1c2VkIGJ5IHJvd3Mgd3JpdHRlbiBiZWZvcmUgdGhpcyBtaWdyYXRpb246IHBvb2xlZCBqb2JzXG4vLyB1c2VkIHRvIHBlcnNpc3QgYXMgYGV4ZWN1dGlvbl9tb2RlID0gXCJmb3JrZWRcImAgcGx1cyBhIGB2ZWxvY2lvdXMtcG9vbGVkOipgXG4vLyBoYW5kb2ZmIGlkLiBSZXRhaW5lZCBvbmx5IHRvIGRldGVjdCBhbmQgY29udmVydCB0aG9zZSByb3dzIGluIHRoZSBtaWdyYXRpb24uXG5jb25zdCBMRUdBQ1lfUE9PTEVEX0hBTkRPRkZfSURfUFJFRklYID0gXCJ2ZWxvY2lvdXMtcG9vbGVkOlwiXG5jb25zdCBMRUdBQ1lfUE9PTEVEX1FVRVVFRF9IQU5ET0ZGX0lEID0gYCR7TEVHQUNZX1BPT0xFRF9IQU5ET0ZGX0lEX1BSRUZJWH1xdWV1ZWRgXG5jb25zdCBKT0JTX1RBQkxFID0gXCJiYWNrZ3JvdW5kX2pvYnNcIlxuY29uc3QgSk9CU19JTkRFWF9DT0xVTU5fTkFNRVMgPSBbXG4gIFwiam9iX25hbWVcIixcbiAgXCJxdWV1ZVwiLFxuICBcInN0YXR1c1wiLFxuICBcInNjaGVkdWxlZF9hdF9tc1wiLFxuICBcImNyZWF0ZWRfYXRfbXNcIixcbiAgXCJzY2hlZHVsZV9rZXlcIixcbiAgXCJoYW5kZWRfb2ZmX2F0X21zXCIsXG4gIFwib3JwaGFuZWRfYXRfbXNcIixcbiAgXCJjb25jdXJyZW5jeV9rZXlcIlxuXVxuY29uc3QgSURFTVBPVEVOQ1lfS0VZU19UQUJMRSA9IFwiYmFja2dyb3VuZF9qb2JfaWRlbXBvdGVuY3lfa2V5c1wiXG5jb25zdCBTQ0hFRFVMRV9LRVlTX1RBQkxFID0gXCJiYWNrZ3JvdW5kX2pvYl9zY2hlZHVsZV9rZXlzXCJcbmNvbnN0IENPTkNVUlJFTkNZX1RBQkxFID0gXCJiYWNrZ3JvdW5kX2pvYl9jb25jdXJyZW5jeVwiXG5jb25zdCBDT1VOVFNfUkVWSVNJT05fVEFCTEUgPSBcImJhY2tncm91bmRfam9iX2NvdW50X3JldmlzaW9uc1wiXG5jb25zdCBDT1VOVFNfUkVWSVNJT05fS0VZID0gXCJjb3VudHNcIlxuZXhwb3J0IGNvbnN0IEJBQ0tHUk9VTkRfSk9CX0NPVU5UU19DSEFOTkVMID0gXCJ2ZWxvY2lvdXMtYmFja2dyb3VuZC1qb2ItY291bnRzXCJcbmV4cG9ydCBjb25zdCBCQUNLR1JPVU5EX0pPQl9DT1VOVF9CVUNLRVRTID0gW1wiYWxsXCIsIFwicXVldWVkXCIsIFwiaGFuZGVkX29mZlwiLCBcImNvbXBsZXRlZFwiLCBcImZhaWxlZFwiLCBcIm9ycGhhbmVkXCJdXG5jb25zdCBDT1VOVEVEX0pPQl9TVEFUVVNFUyA9IEJBQ0tHUk9VTkRfSk9CX0NPVU5UX0JVQ0tFVFMuc2xpY2UoMSlcbmNvbnN0IE1BWF9KT0JfVElNRU9VVF9NUyA9IDJfMTQ3XzQ4M182NDdcbmNvbnN0IEpPQl9USU1FT1VUX1ZBTElEQVRJT05fTUVTU0FHRSA9IGBiYWNrZ3JvdW5kIGpvYiB0aW1lb3V0TXMgbXVzdCBiZSBhIGZpbml0ZSBub24tcG9zaXRpdmUgbnVtYmVyIG9yIGFuIGludGVnZXIgYmV0d2VlbiAxIGFuZCAke01BWF9KT0JfVElNRU9VVF9NU31gXG5jb25zdCBPUlBIQU5FRF9BRlRFUl9NUyA9IDIgKiA2MCAqIDYwICogMTAwMFxuXG4vKipcbiAqIENvbHVtbnMgdGhlIGRhc2hib2FyZCBpcyBhbGxvd2VkIHRvIHNvcnQgam9iIGxpc3RpbmdzIGJ5LCBtYXBwZWQgdG8gdGhlaXJcbiAqIGRhdGFiYXNlIGNvbHVtbiBuYW1lcy4gUmVzdHJpY3RpbmcgdG8gdGhpcyBzZXQga2VlcHMgdGhlIHNvcnQgcGFyYW1ldGVyXG4gKiAod2hpY2ggb3JpZ2luYXRlcyBmcm9tIHVudHJ1c3RlZCBxdWVyeSBzdHJpbmdzKSBmcm9tIHJlYWNoaW5nIHJhdyBTUUwuXG4gKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgc3RyaW5nPn1cbiAqL1xuY29uc3QgU09SVEFCTEVfQ09MVU1OUyA9IHtcbiAgYXR0ZW1wdHM6IFwiYXR0ZW1wdHNcIixcbiAgY29tcGxldGVkQXRNczogXCJjb21wbGV0ZWRfYXRfbXNcIixcbiAgY3JlYXRlZEF0TXM6IFwiY3JlYXRlZF9hdF9tc1wiLFxuICBmYWlsZWRBdE1zOiBcImZhaWxlZF9hdF9tc1wiLFxuICBoYW5kZWRPZmZBdE1zOiBcImhhbmRlZF9vZmZfYXRfbXNcIixcbiAgc2NoZWR1bGVkQXRNczogXCJzY2hlZHVsZWRfYXRfbXNcIlxufVxuXG4vKipcbiAqIFNlcmlhbGl6ZXMgY29uY3VycmVudCBgX2FwcGx5U2NoZW1hYCBydW5zIHdpdGhpbiBUSElTIHByb2Nlc3MsIGtleWVkIGJ5IGRhdGFiYXNlXG4gKiBpZGVudGlmaWVyLCBiZWZvcmUgY2FsbGVycyB3aXRob3V0IGFuIGV4aXN0aW5nIGNvbm5lY3Rpb24gY2hlY2sgb25lIG91dC4gVHdvXG4gKiBzdG9yZXMgdGhhdCBzaGFyZSBvbmUgY29ubmVjdGlvbiAoU2luZ2xlTXVsdGlVc2UgLyBTUUxpdGUpXG4gKiBvdGhlcndpc2UgaW50ZXJsZWF2ZSB0aGUgbXVsdGktc3RlcCB0YWJsZSByZWJ1aWxkIGFuZCBjb3JydXB0IGl0ICh0aGUgam9icyB0YWJsZVxuICogaXMgbGVmdCBhcyBpdHMgYCpfdmVsb2Npb3VzX3JlYnVpbGRgIHRlbXApLiBBIERCIGFkdmlzb3J5IGxvY2sgY2FuJ3QgZml4IHRoYXQ6IG9uXG4gKiBhIHNlc3Npb24tc2NvcGVkIC8gcmUtZW50cmFudCBkcml2ZXIgKE15U1FMIGBHRVRfTE9DS2ApIGEgc2Vjb25kIGFjcXVpcmUgb24gdGhlXG4gKiBzYW1lIHNlc3Npb24gc3VjY2VlZHMgaW1tZWRpYXRlbHkgc28gYm90aCBjYWxsZXJzIHByb2NlZWQsIGFuZCB0YWtpbmcgaXQgb24gYVxuICogc2VwYXJhdGUgY29ubmVjdGlvbiBibG9ja3MgY3Jvc3Mtc2Vzc2lvbiBmb3JldmVyLiBBbiBpbi1wcm9jZXNzIHByb21pc2UtY2hhaW5cbiAqIG11dGV4IHNlcmlhbGl6ZXMgc2FtZS1wcm9jZXNzIGNhbGxlcnMgd2l0aCBuZWl0aGVyIGhhemFyZC4gQ3Jvc3MtcHJvY2VzcyBzY2hlbWFcbiAqIHJhY2VzIHN0YXkgY292ZXJlZCBieSB0aGUgcGVyLXN0ZXAgYWR2aXNvcnkgbG9ja3MgKyByZWNoZWNrcyBpbnNpZGUgdGhlIHN0ZXBzLlxuICogQHR5cGUge01hcDxzdHJpbmcsIFByb21pc2U8dm9pZD4+fVxuICovXG5jb25zdCBzY2hlbWFBcHBseUNoYWlucyA9IG5ldyBNYXAoKVxuLyoqIEB0eXBlIHtNYXA8c3RyaW5nLCBQcm9taXNlPHZvaWQ+Pn0gKi9cbmNvbnN0IHRyYW5zYWN0aW9uTXV0YXRpb25DaGFpbnMgPSBuZXcgTWFwKClcblxuZXhwb3J0IGRlZmF1bHQgY2xhc3MgQmFja2dyb3VuZEpvYnNTdG9yZSBleHRlbmRzIEJhY2tncm91bmRKb2JzQWRhcHRlciB7XG4gIC8qKlxuICAgKiBSdW5zIGNvbnN0cnVjdG9yLlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIE9wdGlvbnMuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vY29uZmlndXJhdGlvbi5qc1wiKS5kZWZhdWx0fSBhcmdzLmNvbmZpZ3VyYXRpb24gLSBDb25maWd1cmF0aW9uLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gW2FyZ3MuZGF0YWJhc2VJZGVudGlmaWVyXSAtIERhdGFiYXNlIGlkZW50aWZpZXIuXG4gICAqL1xuICBjb25zdHJ1Y3Rvcih7Y29uZmlndXJhdGlvbiwgZGF0YWJhc2VJZGVudGlmaWVyfSkge1xuICAgIHN1cGVyKClcbiAgICB0aGlzLmNvbmZpZ3VyYXRpb24gPSBjb25maWd1cmF0aW9uXG4gICAgdGhpcy5kYXRhYmFzZUlkZW50aWZpZXIgPSBkYXRhYmFzZUlkZW50aWZpZXJcbiAgICB0aGlzLmxvZ2dlciA9IG5ldyBMb2dnZXIodGhpcylcbiAgICB0aGlzLl9yZWFkeVByb21pc2UgPSBudWxsXG4gICAgdGhpcy5fcXVldWVDb25jdXJyZW5jeVJlY29uY2lsZWQgPSBmYWxzZVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZ2V0IGRhdGFiYXNlIGlkZW50aWZpZXIuXG4gICAqIEByZXR1cm5zIHtzdHJpbmd9IC0gRGF0YWJhc2UgaWRlbnRpZmllci5cbiAgICovXG4gIGdldERhdGFiYXNlSWRlbnRpZmllcigpIHtcbiAgICBpZiAodGhpcy5kYXRhYmFzZUlkZW50aWZpZXIpIHJldHVybiB0aGlzLmRhdGFiYXNlSWRlbnRpZmllclxuXG4gICAgcmV0dXJuIHRoaXMuY29uZmlndXJhdGlvbi5nZXRCYWNrZ3JvdW5kSm9ic0NvbmZpZygpLmRhdGFiYXNlSWRlbnRpZmllclxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZW5zdXJlIHJlYWR5LlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyB3aGVuIHJlYWR5LlxuICAgKi9cbiAgYXN5bmMgZW5zdXJlUmVhZHkoKSB7XG4gICAgaWYgKHRoaXMuX3JlYWR5UHJvbWlzZSkgcmV0dXJuIGF3YWl0IHRoaXMuX3JlYWR5UHJvbWlzZVxuXG4gICAgdGhpcy5fcmVhZHlQcm9taXNlID0gKGFzeW5jICgpID0+IHtcbiAgICAgIHRoaXMuY29uZmlndXJhdGlvbi5zZXRDdXJyZW50KClcbiAgICAgIGF3YWl0IHRoaXMuX2Vuc3VyZVNjaGVtYSgpXG4gICAgICBhd2FpdCB0aGlzLl9pbml0aWFsaXplTW9kZWwoKVxuICAgIH0pKClcblxuICAgIHRyeSB7XG4gICAgICBhd2FpdCB0aGlzLl9yZWFkeVByb21pc2VcbiAgICB9IGZpbmFsbHkge1xuICAgICAgdGhpcy5fcmVhZHlQcm9taXNlID0gbnVsbFxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBFbnN1cmVzIHRoZSBiYWNrZ3JvdW5kLWpvYnMgc2NoZW1hICh0YWJsZXMgKyBjb2x1bW5zKSBleGlzdHMgb24gdGhlIGNvbmZpZ3VyZWRcbiAgICogZGF0YWJhc2UsIHdpdGhvdXQgaW5pdGlhbGl6aW5nIHRoZSBydW50aW1lIG1vZGVsLiBMZXRzIGBkYjptaWdyYXRlYCBjcmVhdGUgdGhlXG4gICAqIGZyYW1ld29yaydzIG93biBzY2hlbWEgZGV0ZXJtaW5pc3RpY2FsbHkgYWxvbmdzaWRlIGFwcCBtaWdyYXRpb25zIOKAlCBhbmQgY2FwdHVyZVxuICAgKiBpdCBpbiB0aGUgZHVtcGVkIHN0cnVjdHVyZSBTUUwg4oCUIGluc3RlYWQgb2YgaXQgb25seSBhcHBlYXJpbmcgb25jZSBhIHN0b3JlIGJvb3RzLlxuICAgKiBJZGVtcG90ZW50OiByZXVzZXMgdGhlIHNhbWUgYF9lbnN1cmVTY2hlbWFgIHRoZSBydW50aW1lIHN0b3JlIHVzZXMsIHdoaWNoIHNraXBzXG4gICAqIHdvcmsgYWxyZWFkeSBhcHBsaWVkICh0cmFja2VkIGluIGB2ZWxvY2lvdXNfaW50ZXJuYWxfbWlncmF0aW9uc2ApLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL2RhdGFiYXNlL2RyaXZlcnMvYmFzZS5qc1wiKS5kZWZhdWx0fSBbZGJdIC0gUmV1c2UgYW4gYWxyZWFkeVxuICAgKiAgIGNoZWNrZWQtb3V0IGNvbm5lY3Rpb24gKGUuZy4gdGhlIG9uZSBgZGI6bWlncmF0ZWAgaG9sZHMpIHJhdGhlciB0aGFuIG9wZW5pbmcgYVxuICAgKiAgIG5lc3RlZCBjaGVja291dCB0aGF0IHdvdWxkIGRlYWRsb2NrIGEgc2luZ2xlLWNvbm5lY3Rpb24gcG9vbC5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgd2hlbiB0aGUgc2NoZW1hIGlzIHByZXNlbnQuXG4gICAqL1xuICBhc3luYyBlbnN1cmVTY2hlbWEoZGIpIHtcbiAgICAvLyBXaGVuIGEgY29ubmVjdGlvbiBpcyBoYW5kZWQgaW4gKHRoZSBkYjptaWdyYXRlIHBhdGgpLCB0aGUgY2FsbGVyIGFscmVhZHkgb3duc1xuICAgIC8vIHRoZSBhY3RpdmUgY29uZmlndXJhdGlvbiArIGNvbm5lY3Rpb24gY29udGV4dDsgY2FsbGluZyBzZXRDdXJyZW50KCkgaGVyZSB3b3VsZFxuICAgIC8vIGNsb2JiZXIgaXQgKGUuZy4gdGhlIGJyb3dzZXIgdGVzdCBydW5uZXIganVnZ2xlcyBtdWx0aXBsZSBjb25maWd1cmF0aW9ucykuXG4gICAgaWYgKCFkYikgdGhpcy5jb25maWd1cmF0aW9uLnNldEN1cnJlbnQoKVxuXG4gICAgYXdhaXQgdGhpcy5fZW5zdXJlU2NoZW1hKGRiKVxuICB9XG5cbiAgLyoqXG4gICAqIFJlY29uY2lsZXMgcXVldWUtZGVyaXZlZCBjb25jdXJyZW5jeSB3aXRoIHRoZSBjdXJyZW50IGNvbmZpZ3VyYXRpb246IHRoZVxuICAgKiBleHBsaWNpdCBsaWZlY3ljbGUgcGF0aCB0aGF0IGFkb3B0cy9yZWxlYXNlcyBwZXJzaXN0ZWQgcXVldWVkIGpvYnMgb250b1xuICAgKiBxdWV1ZSBjb25jdXJyZW5jeSBrZXlzIHdoZW4gYHF1ZXVlc1tuYW1lXS5tYXhDb25jdXJyZW50YCBpcyBhZGRlZCwgcmVtb3ZlZCxcbiAgICogb3IgY2hhbmdlZC4gQ2FsbGVkIGJ5IHRoZSBiYWNrZ3JvdW5kLWpvYnMgbWFpbiBwcm9jZXNzIG9uIHN0YXJ0dXAg4oCUIHRoZVxuICAgKiBkZXBsb3ktdGltZSBtb21lbnQgcXVldWUgY29uZmlndXJhdGlvbiBjaGFuZ2VzIHRha2UgZWZmZWN0LiBTY2hlbWEvdGVuYW50XG4gICAqIGNoZWNrcyBhbmQgcm91dGluZSBjb25uZWN0aW9uIGluaXRpYWxpemF0aW9uIGRlbGliZXJhdGVseSBuZXZlciBydW4gdGhpczpcbiAgICogdGhleSBzdGF5IHJlYWQtb25seSByZWdhcmRpbmcgcXVldWVkIGpvYiByb3dzLCBiZWNhdXNlIHRoZSBicm9hZFxuICAgKiBhZG9wdGlvbi9yZWxlYXNlIFVQREFURXMgZGVhZGxvY2sgYWdhaW5zdCBhY3RpdmUgam9iIHByb2Nlc3NlcyB1bmRlclxuICAgKiBjb25jdXJyZW50IHRlbmFudCBpbml0aWFsaXphdGlvbi4gU2VyaWFsaXplZCBhY3Jvc3MgcHJvY2Vzc2VzIHdpdGggYVxuICAgKiBkYXRhYmFzZSBhZHZpc29yeSBsb2NrIHNvIGNvbmN1cnJlbnRseSBzdGFydGVkIG1haW5zIGNhbm5vdCBpbnRlcmxlYXZlIHRoZVxuICAgKiBVUERBVEVzOyB0aGUgcGVyLWluc3RhbmNlIG1lbW8gb25seSBza2lwcyByZXBlYXQgd29yayB3aXRoaW4gdGhpcyBwcm9jZXNzLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyB3aGVuIHJlY29uY2lsZWQuXG4gICAqL1xuICBhc3luYyByZWNvbmNpbGVRdWV1ZUNvbmN1cnJlbmN5KCkge1xuICAgIGlmICh0aGlzLl9xdWV1ZUNvbmN1cnJlbmN5UmVjb25jaWxlZCkgcmV0dXJuXG5cbiAgICBjb25zdCBkYXRhYmFzZUlkZW50aWZpZXIgPSB0aGlzLmdldERhdGFiYXNlSWRlbnRpZmllcigpXG4gICAgY29uc3Qgc3RhcnRlZEF0TXMgPSBEYXRlLm5vdygpXG5cbiAgICBhd2FpdCB0aGlzLmxvZ2dlci5pbmZvKCgpID0+IFtcbiAgICAgIFwiU3RhcnRpbmcgYmFja2dyb3VuZCBqb2JzIHF1ZXVlLWNvbmN1cnJlbmN5IHN0YXJ0dXAgcmVjb25jaWxpYXRpb25cIixcbiAgICAgIHtkYXRhYmFzZUlkZW50aWZpZXJ9XG4gICAgXSlcbiAgICBhd2FpdCB0aGlzLmVuc3VyZVJlYWR5KClcblxuICAgIGF3YWl0IHRoaXMuX3dpdGhEYihhc3luYyAoZGIpID0+IHtcbiAgICAgIGNvbnN0IGxvY2tOYW1lID0gXCJiYWNrZ3JvdW5kLWpvYnM6cXVldWUtY29uY3VycmVuY3ktcmVjb25jaWxlXCJcbiAgICAgIGNvbnN0IGFjcXVpcmVkID0gYXdhaXQgZGIuYWNxdWlyZUFkdmlzb3J5TG9jayhsb2NrTmFtZSlcblxuICAgICAgaWYgKCFhY3F1aXJlZCkgdGhyb3cgbmV3IEVycm9yKFwiRmFpbGVkIHRvIGFjcXVpcmUgYmFja2dyb3VuZCBqb2IgcXVldWUtY29uY3VycmVuY3kgcmVjb25jaWxlIGxvY2tcIilcblxuICAgICAgdHJ5IHtcbiAgICAgICAgYXdhaXQgdGhpcy5fcmVjb25jaWxlUXVldWVDb25jdXJyZW5jeShkYilcbiAgICAgICAgYXdhaXQgdGhpcy5fcmVjb25jaWxlQ29uY3VycmVuY3koZGIpXG5cbiAgICAgICAgLy8gTGF0Y2ggdGhlIG1lbW8gb25seSBhZnRlciBCT1RIIHN0ZXBzIHN1Y2NlZWQ6IGlmIHRoZSBjb3VudCByZWJ1aWxkXG4gICAgICAgIC8vIGZhaWxzIGFmdGVyIGFkb3B0aW9uLCBhIHJldHJ5IG9uIHRoaXMgc3RvcmUgbXVzdCByZS1lbnRlciBhbmQgcmVwYWlyXG4gICAgICAgIC8vIHRoZSBjb3VudHMgKGFkb3B0aW9uIGl0c2VsZiBpcyBpZGVtcG90ZW50KS5cbiAgICAgICAgdGhpcy5fcXVldWVDb25jdXJyZW5jeVJlY29uY2lsZWQgPSB0cnVlXG4gICAgICB9IGZpbmFsbHkge1xuICAgICAgICBhd2FpdCBkYi5yZWxlYXNlQWR2aXNvcnlMb2NrKGxvY2tOYW1lKVxuICAgICAgfVxuICAgIH0pXG5cbiAgICBhd2FpdCB0aGlzLmxvZ2dlci5pbmZvKCgpID0+IFtcbiAgICAgIFwiQ29tcGxldGVkIGJhY2tncm91bmQgam9icyBxdWV1ZS1jb25jdXJyZW5jeSBzdGFydHVwIHJlY29uY2lsaWF0aW9uXCIsXG4gICAgICB7ZGF0YWJhc2VJZGVudGlmaWVyLCBkdXJhdGlvbk1zOiBEYXRlLm5vdygpIC0gc3RhcnRlZEF0TXN9XG4gICAgXSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGVucXVldWUuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gT3B0aW9ucy5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGFyZ3Muam9iTmFtZSAtIEpvYiBuYW1lLlxuICAgKiBAcGFyYW0ge0FycmF5PFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gYXJncy5hcmdzIC0gQXJndW1lbnRzLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vdHlwZXMuanNcIikuQmFja2dyb3VuZEpvYk9wdGlvbnN9IFthcmdzLm9wdGlvbnNdIC0gT3B0aW9ucy5cbiAgICogQHJldHVybnMge1Byb21pc2U8c3RyaW5nPn0gLSBKb2IgaWQuXG4gICAqL1xuICBhc3luYyBlbnF1ZXVlKHtqb2JOYW1lLCBhcmdzLCBvcHRpb25zfSkge1xuICAgIGF3YWl0IHRoaXMuZW5zdXJlUmVhZHkoKVxuXG4gICAgY29uc3QgcHJlcGFyZWRKb2IgPSB0aGlzLl9wcmVwYXJlSm9iKHtqb2JOYW1lLCBhcmdzLCBvcHRpb25zfSlcblxuICAgIGlmIChvcHRpb25zPy5pZGVtcG90ZW5jeUtleSAhPT0gdW5kZWZpbmVkKSB7XG4gICAgICByZXR1cm4gYXdhaXQgdGhpcy5fZW5xdWV1ZUlkZW1wb3RlbnRseSh7YXJnczogYXJncyB8fCBbXSwgb3B0aW9ucywgcHJlcGFyZWRKb2J9KVxuICAgIH1cblxuICAgIC8qKiBAdHlwZSB7c3RyaW5nfSAqL1xuICAgIGxldCByZXN1bHRKb2JJZCA9IHByZXBhcmVkSm9iLmpvYklkXG5cbiAgICBhd2FpdCB0aGlzLl9zZXJpYWxpemVkQ291bnRNdXRhdGlvbihhc3luYyAoZGIpID0+IHtcbiAgICAgIGlmIChvcHRpb25zPy5kZWR1cGxpY2F0ZVdoaWxlUXVldWVkKSB7XG4gICAgICAgIC8vIERlZHVwZSBvbiB0aGUgam9iJ3MgaWRlbnRpdHkgKG5hbWUgKyBhcmdzICsgcXVldWUpLCBOT1QgaXRzIGNvbmN1cnJlbmN5IGtleSwgc28gYSBqb2JcbiAgICAgICAgLy8ga2VlcHMgd2hhdGV2ZXIgY29uY3VycmVuY3kgaXQgcmVzb2x2ZXMgdG8uIE9ubHkgYW4gZXhpc3Rpbmcgam9iIHNjaGVkdWxlZCBubyBsYXRlciB0aGFuXG4gICAgICAgIC8vIHRoaXMgZW5xdWV1ZSBjYW4gY292ZXIgaXQ7IGEgcmV0cnkgYmFja2VkIG9mZiBpbnRvIHRoZSBmdXR1cmUgbXVzdCBub3Qgc3VwcHJlc3MgZWFybGllclxuICAgICAgICAvLyB3b3JrLiBPcmRlcmluZyByZXR1cm5zIHRoZSBlYXJsaWVzdCBjb3ZlcmluZyBqb2Igd2hlbiBzZXZlcmFsIHF1ZXVlZCByb3dzIGFscmVhZHkgZXhpc3QuXG4gICAgICAgIGNvbnN0IGV4aXN0aW5nID0gYXdhaXQgZGJcbiAgICAgICAgICAubmV3UXVlcnkoKVxuICAgICAgICAgIC5mcm9tKEpPQlNfVEFCTEUpXG4gICAgICAgICAgLnNlbGVjdChcImlkXCIpXG4gICAgICAgICAgLndoZXJlKHtzdGF0dXM6IFwicXVldWVkXCIsIGpvYl9uYW1lOiBqb2JOYW1lLCBhcmdzX2pzb246IHByZXBhcmVkSm9iLmFyZ3NKc29uLCBxdWV1ZTogcHJlcGFyZWRKb2IucXVldWV9KVxuICAgICAgICAgIC53aGVyZShgc2NoZWR1bGVkX2F0X21zIDw9ICR7ZGIucXVvdGUocHJlcGFyZWRKb2Iuc2NoZWR1bGVkQXRNcyl9YClcbiAgICAgICAgICAub3JkZXIoXCJzY2hlZHVsZWRfYXRfbXMgQVNDXCIpXG4gICAgICAgICAgLmxpbWl0KDEpXG4gICAgICAgICAgLnJlc3VsdHMoKVxuXG4gICAgICAgIGlmIChleGlzdGluZ1swXSkge1xuICAgICAgICAgIHJlc3VsdEpvYklkID0gU3RyaW5nKC8qKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSAqLyAoZXhpc3RpbmdbMF0pLmlkKVxuXG4gICAgICAgICAgcmV0dXJuXG4gICAgICAgIH1cbiAgICAgIH1cblxuICAgICAgYXdhaXQgdGhpcy5faW5zZXJ0UHJlcGFyZWRKb2IoZGIsIHtwcmVwYXJlZEpvYiwgc2NoZWR1bGVLZXk6IG51bGx9KVxuICAgICAgYXdhaXQgdGhpcy5fcmVjb3JkQ291bnREZWx0YShkYiwge2FsbDogMSwgcXVldWVkOiAxfSlcbiAgICB9KVxuXG4gICAgcmV0dXJuIHJlc3VsdEpvYklkXG4gIH1cblxuICAvKipcbiAgICogQXRvbWljYWxseSBvd25zIG9uZSBkdXJhYmxlIGlkZW1wb3RlbmN5IHNjb3BlIGFuZCBjcmVhdGVzIGl0cyBqb2IgZXhhY3RseSBvbmNlLlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIEVucXVldWUgaW5wdXQuXG4gICAqIEBwYXJhbSB7QXJyYXk8UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSBhcmdzLmFyZ3MgLSBKb2IgYXJndW1lbnRzLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vdHlwZXMuanNcIikuQmFja2dyb3VuZEpvYk9wdGlvbnN9IGFyZ3Mub3B0aW9ucyAtIEpvYiBvcHRpb25zLlxuICAgKiBAcGFyYW0ge1ByZXBhcmVkQmFja2dyb3VuZEpvYn0gYXJncy5wcmVwYXJlZEpvYiAtIE5vcm1hbGl6ZWQgam9iLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxzdHJpbmc+fSAtIFN0YWJsZSBvcmlnaW5hbCBqb2IgaWQuXG4gICAqL1xuICBhc3luYyBfZW5xdWV1ZUlkZW1wb3RlbnRseSh7YXJncywgb3B0aW9ucywgcHJlcGFyZWRKb2J9KSB7XG4gICAgY29uc3QgaWRlbXBvdGVuY3lLZXkgPSB0aGlzLl9ub3JtYWxpemVJZGVtcG90ZW5jeUtleShvcHRpb25zLmlkZW1wb3RlbmN5S2V5KVxuICAgIGNvbnN0IHNjb3BlRGlnZXN0ID0gdGhpcy5faWRlbXBvdGVuY3lTY29wZURpZ2VzdCh7aWRlbXBvdGVuY3lLZXksIGpvYk5hbWU6IHByZXBhcmVkSm9iLmpvYk5hbWUsIHF1ZXVlOiBwcmVwYXJlZEpvYi5xdWV1ZX0pXG4gICAgY29uc3QgcmVxdWVzdERpZ2VzdCA9IHRoaXMuX2lkZW1wb3RlbmN5UmVxdWVzdERpZ2VzdCh7YXJncywgb3B0aW9ucywgcHJlcGFyZWRKb2J9KVxuICAgIGNvbnN0IG93bmVyc2hpcCA9IHtcbiAgICAgIGNyZWF0ZWRfYXRfbXM6IHByZXBhcmVkSm9iLmNyZWF0ZWRBdE1zLFxuICAgICAgaWRlbXBvdGVuY3lfa2V5OiBpZGVtcG90ZW5jeUtleSxcbiAgICAgIGpvYl9pZDogcHJlcGFyZWRKb2Iuam9iSWQsXG4gICAgICBqb2JfbmFtZTogcHJlcGFyZWRKb2Iuam9iTmFtZSxcbiAgICAgIHF1ZXVlOiBwcmVwYXJlZEpvYi5xdWV1ZSxcbiAgICAgIHJlcXVlc3RfZGlnZXN0OiByZXF1ZXN0RGlnZXN0LFxuICAgICAgc2NvcGVfZGlnZXN0OiBzY29wZURpZ2VzdFxuICAgIH1cbiAgICBjb25zdCBtYWlsT3BlcmF0aW9uSW5wdXQgPSBtYWlsRGVsaXZlcnlPcGVyYXRpb25Gb3JKb2IocHJlcGFyZWRKb2Iuam9iTmFtZSwgYXJncylcblxuICAgIGlmIChtYWlsT3BlcmF0aW9uSW5wdXQgJiYgbWFpbE9wZXJhdGlvbklucHV0Lm9wZXJhdGlvbi5pZCAhPT0gaWRlbXBvdGVuY3lLZXkpIHtcbiAgICAgIHRocm93IFZlbG9jaW91c0Vycm9yLnNhZmUoXCJNYWlsIGRlbGl2ZXJ5IG9wZXJhdGlvbiBpZCBtdXN0IGVxdWFsIGl0cyBiYWNrZ3JvdW5kIGpvYiBpZGVtcG90ZW5jeSBrZXkuXCIsIHtcbiAgICAgICAgY29kZTogXCJtYWlsLWRlbGl2ZXJ5LWlkZW1wb3RlbmN5LWtleS1taXNtYXRjaFwiXG4gICAgICB9KVxuICAgIH1cblxuICAgIC8vIFJldXNlIG9yZGluYXJ5IGVucXVldWUgdHJhbnNhY3Rpb24gYWRtaXNzaW9uIGJlY2F1c2UgdGhpcyBwYXRoIGNoYW5nZXNcbiAgICAvLyB0aGUgc2FtZSBkdXJhYmxlIGNvdW50IHJldmlzaW9uLiBUaGUgc2NvcGUgcHJpbWFyeSBrZXkgcmVtYWlucyB0aGVcbiAgICAvLyBjcm9zcy1wcm9jZXNzIGNvbnZlcmdlbmNlIG93bmVyLlxuICAgIHJldHVybiBhd2FpdCB0aGlzLl9pZGVtcG90ZW50RW5xdWV1ZVRyYW5zYWN0aW9uKGFzeW5jIChkYikgPT4ge1xuICAgICAgY29uc3QgZXhpc3RpbmcgPSBhd2FpdCB0aGlzLl9pZGVtcG90ZW5jeU93bmVyc2hpcChkYiwgc2NvcGVEaWdlc3QpXG5cbiAgICAgIGlmIChleGlzdGluZykge1xuICAgICAgICB0aGlzLl92YWxpZGF0ZUlkZW1wb3RlbmN5T3duZXJzaGlwKHtleGlzdGluZywgb3duZXJzaGlwfSlcbiAgICAgICAgYXdhaXQgdGhpcy5fdmFsaWRhdGVNYWlsRGVsaXZlcnlPcGVyYXRpb24oZGIsIHtqb2JJZDogU3RyaW5nKGV4aXN0aW5nLmpvYl9pZCksIG1haWxPcGVyYXRpb25JbnB1dH0pXG4gICAgICAgIHJldHVybiBTdHJpbmcoZXhpc3Rpbmcuam9iX2lkKVxuICAgICAgfVxuXG4gICAgICBjb25zdCBjbGFpbWVkID0gYXdhaXQgdGhpcy5fY2xhaW1JZGVtcG90ZW5jeU93bmVyc2hpcChkYiwgb3duZXJzaGlwKVxuXG4gICAgICBpZiAoIWNsYWltZWQuY3JlYXRlZCkge1xuICAgICAgICB0aGlzLl92YWxpZGF0ZUlkZW1wb3RlbmN5T3duZXJzaGlwKHtleGlzdGluZzogY2xhaW1lZC5yb3csIG93bmVyc2hpcH0pXG4gICAgICAgIGF3YWl0IHRoaXMuX3ZhbGlkYXRlTWFpbERlbGl2ZXJ5T3BlcmF0aW9uKGRiLCB7am9iSWQ6IFN0cmluZyhjbGFpbWVkLnJvdy5qb2JfaWQpLCBtYWlsT3BlcmF0aW9uSW5wdXR9KVxuICAgICAgICByZXR1cm4gU3RyaW5nKGNsYWltZWQucm93LmpvYl9pZClcbiAgICAgIH1cblxuICAgICAgYXdhaXQgdGhpcy5fbG9ja0NvdW50UmV2aXNpb24oZGIpXG4gICAgICBhd2FpdCB0aGlzLl9pbnNlcnRQcmVwYXJlZEpvYihkYiwge3ByZXBhcmVkSm9iLCBzY2hlZHVsZUtleTogbnVsbH0pXG4gICAgICBhd2FpdCB0aGlzLl9wZXJzaXN0TWFpbERlbGl2ZXJ5T3BlcmF0aW9uKGRiLCB7am9iSWQ6IHByZXBhcmVkSm9iLmpvYklkLCBtYWlsT3BlcmF0aW9uSW5wdXQsIGNyZWF0ZWRBdE1zOiBwcmVwYXJlZEpvYi5jcmVhdGVkQXRNc30pXG4gICAgICBhd2FpdCB0aGlzLl9yZWNvcmRDb3VudERlbHRhKGRiLCB7YWxsOiAxLCBxdWV1ZWQ6IDF9KVxuXG4gICAgICByZXR1cm4gcHJlcGFyZWRKb2Iuam9iSWRcbiAgICB9KVxuICB9XG5cbiAgLyoqXG4gICAqIFNlcmlhbGl6ZXMgb25lIHBoeXNpY2FsIGNvbm5lY3Rpb24gbG9jYWxseSB3aXRob3V0IHRha2luZyBvd25lcnNoaXAgYXdheVxuICAgKiBmcm9tIHRoZSBkYXRhYmFzZSB1bmlxdWVuZXNzIGNvbnN0cmFpbnQgc2hhcmVkIGJ5IGFsbCBwcm9jZXNzZXMuXG4gICAqIEB0ZW1wbGF0ZSBUXG4gICAqIEBwYXJhbSB7KGRiOiBpbXBvcnQoXCIuLi9kYXRhYmFzZS9kcml2ZXJzL2Jhc2UuanNcIikuZGVmYXVsdCkgPT4gUHJvbWlzZTxUPn0gY2FsbGJhY2sgLSBUcmFuc2FjdGlvbiB3b3JrLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxUPn0gLSBDYWxsYmFjayByZXN1bHQuXG4gICAqL1xuICBhc3luYyBfaWRlbXBvdGVudEVucXVldWVUcmFuc2FjdGlvbihjYWxsYmFjaykge1xuICAgIHJldHVybiBhd2FpdCB0aGlzLl9zZXJpYWxpemVkVHJhbnNhY3Rpb25NdXRhdGlvbihjYWxsYmFjaylcbiAgfVxuXG4gIC8qKlxuICAgKiBJbnNlcnRzIGFuIG93bmVyc2hpcCByb3csIHJlc29sdmluZyBvbmx5IGEgZGF0YWJhc2UgdW5pcXVlbmVzcyByYWNlLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL2RhdGFiYXNlL2RyaXZlcnMvYmFzZS5qc1wiKS5kZWZhdWx0fSBkYiAtIFRyYW5zYWN0aW9uIGNvbm5lY3Rpb24uXG4gICAqIEBwYXJhbSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSBvd25lcnNoaXAgLSBPd25lcnNoaXAgcm93LlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx7Y3JlYXRlZDogYm9vbGVhbiwgcm93OiBSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59Pn0gLSBDbGFpbSByZXN1bHQuXG4gICAqL1xuICBhc3luYyBfY2xhaW1JZGVtcG90ZW5jeU93bmVyc2hpcChkYiwgb3duZXJzaGlwKSB7XG4gICAgdHJ5IHtcbiAgICAgIC8vIFRoZSBzYXZlcG9pbnQga2VlcHMgUG9zdGdyZVNRTCdzIG91dGVyIHRyYW5zYWN0aW9uIHVzYWJsZSBhZnRlciBhXG4gICAgICAvLyBjb25jdXJyZW50IHVuaXF1ZS1rZXkgbG9zcy4gVGhlIHVuaXF1ZSBwcmltYXJ5IGtleSwgbm90IGEgcHJvY2Vzc1xuICAgICAgLy8gbXV0ZXgsIGlzIHRoZSBjcm9zcy1wcm9jZXNzIGNvbnZlcmdlbmNlIGF1dGhvcml0eS5cbiAgICAgIGF3YWl0IGRiLnRyYW5zYWN0aW9uKGFzeW5jICgpID0+IHtcbiAgICAgICAgYXdhaXQgZGIuaW5zZXJ0KHt0YWJsZU5hbWU6IElERU1QT1RFTkNZX0tFWVNfVEFCTEUsIGRhdGE6IG93bmVyc2hpcH0pXG4gICAgICB9KVxuXG4gICAgICByZXR1cm4ge2NyZWF0ZWQ6IHRydWUsIHJvdzogb3duZXJzaGlwfVxuICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICBjb25zdCByYWNlZCA9IGF3YWl0IHRoaXMuX2lkZW1wb3RlbmN5T3duZXJzaGlwKGRiLCBTdHJpbmcob3duZXJzaGlwLnNjb3BlX2RpZ2VzdCkpXG5cbiAgICAgIGlmICghcmFjZWQpIHRocm93IGVycm9yXG4gICAgICByZXR1cm4ge2NyZWF0ZWQ6IGZhbHNlLCByb3c6IHJhY2VkfVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBMb2FkcyBvbmUgZHVyYWJsZSBlbnF1ZXVlIG93bmVyLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL2RhdGFiYXNlL2RyaXZlcnMvYmFzZS5qc1wiKS5kZWZhdWx0fSBkYiAtIERhdGFiYXNlIGNvbm5lY3Rpb24uXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBzY29wZURpZ2VzdCAtIEZpeGVkLXNpemUgc2NvcGUgZGlnZXN0LlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj4gfCBudWxsPn0gLSBSb3cgb3IgbnVsbC5cbiAgICovXG4gIGFzeW5jIF9pZGVtcG90ZW5jeU93bmVyc2hpcChkYiwgc2NvcGVEaWdlc3QpIHtcbiAgICBjb25zdCByb3dzID0gYXdhaXQgZGIubmV3UXVlcnkoKS5mcm9tKElERU1QT1RFTkNZX0tFWVNfVEFCTEUpLndoZXJlKHtzY29wZV9kaWdlc3Q6IHNjb3BlRGlnZXN0fSkubGltaXQoMSkucmVzdWx0cygpXG5cbiAgICByZXR1cm4gcm93c1swXSA/IC8qKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSAqLyAocm93c1swXSkgOiBudWxsXG4gIH1cblxuICAvKipcbiAgICogRmFpbHMgY2xvc2VkIHdoZW4gYSBkdXJhYmxlIGtleSBpcyByZXVzZWQgZm9yIGEgZGlmZmVyZW50IGNhbm9uaWNhbCByZXF1ZXN0LlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIFZhbGlkYXRpb24gaW5wdXQuXG4gICAqIEBwYXJhbSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSBhcmdzLmV4aXN0aW5nIC0gU3RvcmVkIG93bmVyLlxuICAgKiBAcGFyYW0ge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gYXJncy5vd25lcnNoaXAgLSBSZXF1ZXN0ZWQgb3duZXIuXG4gICAqIEByZXR1cm5zIHt2b2lkfVxuICAgKi9cbiAgX3ZhbGlkYXRlSWRlbXBvdGVuY3lPd25lcnNoaXAoe2V4aXN0aW5nLCBvd25lcnNoaXB9KSB7XG4gICAgY29uc3QgZXhhY3RTY29wZSA9IFN0cmluZyhleGlzdGluZy5qb2JfbmFtZSkgPT09IG93bmVyc2hpcC5qb2JfbmFtZVxuICAgICAgJiYgU3RyaW5nKGV4aXN0aW5nLnF1ZXVlKSA9PT0gb3duZXJzaGlwLnF1ZXVlXG4gICAgICAmJiBTdHJpbmcoZXhpc3RpbmcuaWRlbXBvdGVuY3lfa2V5KSA9PT0gb3duZXJzaGlwLmlkZW1wb3RlbmN5X2tleVxuXG4gICAgaWYgKCFleGFjdFNjb3BlIHx8IFN0cmluZyhleGlzdGluZy5yZXF1ZXN0X2RpZ2VzdCkgIT09IG93bmVyc2hpcC5yZXF1ZXN0X2RpZ2VzdCkge1xuICAgICAgdGhyb3cgVmVsb2Npb3VzRXJyb3Iuc2FmZShcIlRoZSBiYWNrZ3JvdW5kIGpvYiBpZGVtcG90ZW5jeSBrZXkgd2FzIGFscmVhZHkgdXNlZCBmb3IgYSBkaWZmZXJlbnQgcmVxdWVzdC5cIiwge1xuICAgICAgICBjb2RlOiBcImJhY2tncm91bmQtam9iLWlkZW1wb3RlbmN5LWNvbmZsaWN0XCJcbiAgICAgIH0pXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIFBlcnNpc3RzIHRoZSBidWlsdC1pbiBtYWlsIG9wZXJhdGlvbiBpbiB0aGUgc2FtZSBmaXJzdC1lbnF1ZXVlIHRyYW5zYWN0aW9uLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL2RhdGFiYXNlL2RyaXZlcnMvYmFzZS5qc1wiKS5kZWZhdWx0fSBkYiAtIFRyYW5zYWN0aW9uIGNvbm5lY3Rpb24uXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gT3BlcmF0aW9uIGlucHV0LlxuICAgKiBAcGFyYW0ge251bWJlcn0gYXJncy5jcmVhdGVkQXRNcyAtIENyZWF0aW9uIHRpbWVzdGFtcC5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGFyZ3Muam9iSWQgLSBOYXRpdmUgam9iIGlkLlxuICAgKiBAcGFyYW0ge3tvcGVyYXRpb246IGltcG9ydChcIi4uL21haWxlci9pbmRleC5qc1wiKS5NYWlsZXJEZWxpdmVyeU9wZXJhdGlvbiwgcGF5bG9hZDogaW1wb3J0KFwiLi4vbWFpbGVyL2luZGV4LmpzXCIpLk1haWxlckRlbGl2ZXJ5UGF5bG9hZH0gfCBudWxsfSBhcmdzLm1haWxPcGVyYXRpb25JbnB1dCAtIE1haWwgb3BlcmF0aW9uLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyBhZnRlciBwZXJzaXN0ZW5jZS5cbiAgICovXG4gIGFzeW5jIF9wZXJzaXN0TWFpbERlbGl2ZXJ5T3BlcmF0aW9uKGRiLCB7Y3JlYXRlZEF0TXMsIGpvYklkLCBtYWlsT3BlcmF0aW9uSW5wdXR9KSB7XG4gICAgaWYgKCFtYWlsT3BlcmF0aW9uSW5wdXQpIHJldHVyblxuICAgIGNvbnN0IHtvcGVyYXRpb259ID0gbWFpbE9wZXJhdGlvbklucHV0XG4gICAgY29uc3Qgb3BlcmF0aW9uS2V5ID0gbWFpbERlbGl2ZXJ5T3BlcmF0aW9uS2V5KG9wZXJhdGlvbi5pZClcbiAgICBjb25zdCByb3cgPSB7XG4gICAgICBiYWNrZ3JvdW5kX2pvYl9pZDogam9iSWQsXG4gICAgICBjcmVhdGVkX2F0X21zOiBjcmVhdGVkQXRNcyxcbiAgICAgIGZpcnN0X2F0dGVtcHRfc3RhcnRlZF9hdF9tczogbnVsbCxcbiAgICAgIG9wZXJhdGlvbl9pZDogb3BlcmF0aW9uLmlkLFxuICAgICAgb3BlcmF0aW9uX2tleTogb3BlcmF0aW9uS2V5LFxuICAgICAgcGF5bG9hZF9kaWdlc3Q6IG9wZXJhdGlvbi5wYXlsb2FkRGlnZXN0LFxuICAgICAgcHJvdmlkZXJfa2luZDogb3BlcmF0aW9uLnByb3ZpZGVyS2luZCxcbiAgICAgIHByb3ZpZGVyX3JldGVudGlvbl9tczogb3BlcmF0aW9uLnByb3ZpZGVyUmV0ZW50aW9uTXNcbiAgICB9XG5cbiAgICB0cnkge1xuICAgICAgYXdhaXQgZGIudHJhbnNhY3Rpb24oYXN5bmMgKCkgPT4ge1xuICAgICAgICBhd2FpdCBkYi5pbnNlcnQoe3RhYmxlTmFtZTogTUFJTF9ERUxJVkVSWV9PUEVSQVRJT05TX1RBQkxFLCBkYXRhOiByb3d9KVxuICAgICAgfSlcbiAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgY29uc3QgZXhpc3RpbmcgPSBhd2FpdCB0aGlzLl9tYWlsRGVsaXZlcnlPcGVyYXRpb24oZGIsIG9wZXJhdGlvbktleSlcblxuICAgICAgaWYgKCFleGlzdGluZykgdGhyb3cgZXJyb3JcbiAgICAgIHRoaXMuX3ZhbGlkYXRlTWFpbERlbGl2ZXJ5T3BlcmF0aW9uUm93KHtleGlzdGluZywgcmVxdWVzdGVkOiByb3d9KVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBWYWxpZGF0ZXMgdGhlIGR1cmFibGUgbWFpbCByb3cgZHVyaW5nIGFuIGV4YWN0IGdlbmVyaWMgZW5xdWV1ZSByZXBsYXkuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vZGF0YWJhc2UvZHJpdmVycy9iYXNlLmpzXCIpLmRlZmF1bHR9IGRiIC0gRGF0YWJhc2UgY29ubmVjdGlvbi5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBWYWxpZGF0aW9uIGlucHV0LlxuICAgKiBAcGFyYW0ge3N0cmluZ30gYXJncy5qb2JJZCAtIE93bmVkIGpvYiBpZC5cbiAgICogQHBhcmFtIHt7b3BlcmF0aW9uOiBpbXBvcnQoXCIuLi9tYWlsZXIvaW5kZXguanNcIikuTWFpbGVyRGVsaXZlcnlPcGVyYXRpb24sIHBheWxvYWQ6IGltcG9ydChcIi4uL21haWxlci9pbmRleC5qc1wiKS5NYWlsZXJEZWxpdmVyeVBheWxvYWR9IHwgbnVsbH0gYXJncy5tYWlsT3BlcmF0aW9uSW5wdXQgLSBNYWlsIG9wZXJhdGlvbi5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgd2hlbiBleGFjdC5cbiAgICovXG4gIGFzeW5jIF92YWxpZGF0ZU1haWxEZWxpdmVyeU9wZXJhdGlvbihkYiwge2pvYklkLCBtYWlsT3BlcmF0aW9uSW5wdXR9KSB7XG4gICAgaWYgKCFtYWlsT3BlcmF0aW9uSW5wdXQpIHJldHVyblxuICAgIGNvbnN0IHtvcGVyYXRpb259ID0gbWFpbE9wZXJhdGlvbklucHV0XG4gICAgY29uc3QgZXhpc3RpbmcgPSBhd2FpdCB0aGlzLl9tYWlsRGVsaXZlcnlPcGVyYXRpb24oZGIsIG1haWxEZWxpdmVyeU9wZXJhdGlvbktleShvcGVyYXRpb24uaWQpKVxuXG4gICAgaWYgKCFleGlzdGluZykge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKFwiQmFja2dyb3VuZCBqb2IgaWRlbXBvdGVuY3kgb3duZXJzaGlwIGlzIG1pc3NpbmcgaXRzIGR1cmFibGUgbWFpbCBkZWxpdmVyeSBvcGVyYXRpb25cIilcbiAgICB9XG5cbiAgICB0aGlzLl92YWxpZGF0ZU1haWxEZWxpdmVyeU9wZXJhdGlvblJvdyh7XG4gICAgICBleGlzdGluZyxcbiAgICAgIHJlcXVlc3RlZDoge1xuICAgICAgICBiYWNrZ3JvdW5kX2pvYl9pZDogam9iSWQsXG4gICAgICAgIG9wZXJhdGlvbl9pZDogb3BlcmF0aW9uLmlkLFxuICAgICAgICBwYXlsb2FkX2RpZ2VzdDogb3BlcmF0aW9uLnBheWxvYWREaWdlc3QsXG4gICAgICAgIHByb3ZpZGVyX2tpbmQ6IG9wZXJhdGlvbi5wcm92aWRlcktpbmQsXG4gICAgICAgIHByb3ZpZGVyX3JldGVudGlvbl9tczogb3BlcmF0aW9uLnByb3ZpZGVyUmV0ZW50aW9uTXNcbiAgICAgIH1cbiAgICB9KVxuICB9XG5cbiAgLyoqXG4gICAqIExvYWRzIGEgZHVyYWJsZSBtYWlsIG9wZXJhdGlvbi5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9kYXRhYmFzZS9kcml2ZXJzL2Jhc2UuanNcIikuZGVmYXVsdH0gZGIgLSBEYXRhYmFzZSBjb25uZWN0aW9uLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gb3BlcmF0aW9uS2V5IC0gRml4ZWQtc2l6ZSBvcGVyYXRpb24ga2V5LlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj4gfCBudWxsPn0gLSBSb3cgb3IgbnVsbC5cbiAgICovXG4gIGFzeW5jIF9tYWlsRGVsaXZlcnlPcGVyYXRpb24oZGIsIG9wZXJhdGlvbktleSkge1xuICAgIGNvbnN0IHJvd3MgPSBhd2FpdCBkYi5uZXdRdWVyeSgpLmZyb20oTUFJTF9ERUxJVkVSWV9PUEVSQVRJT05TX1RBQkxFKS53aGVyZSh7b3BlcmF0aW9uX2tleTogb3BlcmF0aW9uS2V5fSkubGltaXQoMSkucmVzdWx0cygpXG5cbiAgICByZXR1cm4gcm93c1swXSA/IC8qKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSAqLyAocm93c1swXSkgOiBudWxsXG4gIH1cblxuICAvKipcbiAgICogQ29tcGFyZXMgcHJvdmlkZXItcmVsZXZhbnQgZHVyYWJsZSBtYWlsIG9wZXJhdGlvbiBmaWVsZHMuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gVmFsaWRhdGlvbiBpbnB1dC5cbiAgICogQHBhcmFtIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59IGFyZ3MuZXhpc3RpbmcgLSBTdG9yZWQgcm93LlxuICAgKiBAcGFyYW0ge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gYXJncy5yZXF1ZXN0ZWQgLSBSZXF1ZXN0ZWQgcm93LlxuICAgKiBAcmV0dXJucyB7dm9pZH1cbiAgICovXG4gIF92YWxpZGF0ZU1haWxEZWxpdmVyeU9wZXJhdGlvblJvdyh7ZXhpc3RpbmcsIHJlcXVlc3RlZH0pIHtcbiAgICBjb25zdCBtYXRjaGVzID0gU3RyaW5nKGV4aXN0aW5nLm9wZXJhdGlvbl9pZCkgPT09IHJlcXVlc3RlZC5vcGVyYXRpb25faWRcbiAgICAgICYmIFN0cmluZyhleGlzdGluZy5wYXlsb2FkX2RpZ2VzdCkgPT09IHJlcXVlc3RlZC5wYXlsb2FkX2RpZ2VzdFxuICAgICAgJiYgU3RyaW5nKGV4aXN0aW5nLmJhY2tncm91bmRfam9iX2lkKSA9PT0gcmVxdWVzdGVkLmJhY2tncm91bmRfam9iX2lkXG4gICAgICAmJiBTdHJpbmcoZXhpc3RpbmcucHJvdmlkZXJfa2luZCkgPT09IHJlcXVlc3RlZC5wcm92aWRlcl9raW5kXG4gICAgICAmJiB0aGlzLl9ub3JtYWxpemVOdW1iZXIoZXhpc3RpbmcucHJvdmlkZXJfcmV0ZW50aW9uX21zKSA9PT0gcmVxdWVzdGVkLnByb3ZpZGVyX3JldGVudGlvbl9tc1xuXG4gICAgaWYgKCFtYXRjaGVzKSB7XG4gICAgICB0aHJvdyBWZWxvY2lvdXNFcnJvci5zYWZlKFwiVGhlIG1haWwgZGVsaXZlcnkgb3BlcmF0aW9uIHdhcyBhbHJlYWR5IHVzZWQgZm9yIGEgZGlmZmVyZW50IHBheWxvYWQgb3IgcHJvdmlkZXIuXCIsIHtcbiAgICAgICAgY29kZTogXCJtYWlsLWRlbGl2ZXJ5LWlkZW1wb3RlbmN5LWNvbmZsaWN0XCJcbiAgICAgIH0pXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIENhbm9uaWNhbCByZXF1ZXN0IGRpZ2VzdCBleGNsdWRpbmcgZ2VuZXJhdGVkIGlkcyBhbmQgaW1tZWRpYXRlIGVucXVldWUgdGltZS5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBEaWdlc3QgaW5wdXQuXG4gICAqIEBwYXJhbSB7QXJyYXk8UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSBhcmdzLmFyZ3MgLSBKb2IgYXJndW1lbnRzLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vdHlwZXMuanNcIikuQmFja2dyb3VuZEpvYk9wdGlvbnN9IGFyZ3Mub3B0aW9ucyAtIEpvYiBvcHRpb25zLlxuICAgKiBAcGFyYW0ge1ByZXBhcmVkQmFja2dyb3VuZEpvYn0gYXJncy5wcmVwYXJlZEpvYiAtIE5vcm1hbGl6ZWQgam9iLlxuICAgKiBAcmV0dXJucyB7c3RyaW5nfSAtIFNIQS0yNTYgZGlnZXN0LlxuICAgKi9cbiAgX2lkZW1wb3RlbmN5UmVxdWVzdERpZ2VzdCh7YXJncywgb3B0aW9ucywgcHJlcGFyZWRKb2J9KSB7XG4gICAgY29uc3Qgc2VyaWFsaXplZCA9IHN0YWJsZUpzb25TdHJpbmdpZnkoe1xuICAgICAgYXJncyxcbiAgICAgIGNvbmN1cnJlbmN5OiBwcmVwYXJlZEpvYi5jb25jdXJyZW5jeSxcbiAgICAgIGV4ZWN1dGlvbk1vZGU6IHByZXBhcmVkSm9iLmV4ZWN1dGlvbk1vZGUsXG4gICAgICBmb3JtYXQ6IFwidmVsb2Npb3VzLWJhY2tncm91bmQtam9iLWlkZW1wb3RlbmN5LXYxXCIsXG4gICAgICBqb2JOYW1lOiBwcmVwYXJlZEpvYi5qb2JOYW1lLFxuICAgICAgbWF4UmV0cmllczogcHJlcGFyZWRKb2IubWF4UmV0cmllcyxcbiAgICAgIHF1ZXVlOiBwcmVwYXJlZEpvYi5xdWV1ZSxcbiAgICAgIHNjaGVkdWxlZEF0TXM6IG9wdGlvbnMuc2NoZWR1bGVkQXRNcyA9PT0gdW5kZWZpbmVkID8gbnVsbCA6IHByZXBhcmVkSm9iLnNjaGVkdWxlZEF0TXMsXG4gICAgICBzY2hlZHVsaW5nOiBvcHRpb25zLnNjaGVkdWxlZEF0TXMgPT09IHVuZGVmaW5lZCA/IFwiaW1tZWRpYXRlXCIgOiBcInNjaGVkdWxlZFwiLFxuICAgICAgLi4uKHByZXBhcmVkSm9iLnRpbWVvdXRNcyA9PT0gbnVsbCA/IHt9IDoge3RpbWVvdXRNczogcHJlcGFyZWRKb2IudGltZW91dE1zfSlcbiAgICB9KVxuXG4gICAgcmV0dXJuIGNyZWF0ZUhhc2goXCJzaGEyNTZcIikudXBkYXRlKHNlcmlhbGl6ZWQpLmRpZ2VzdChcImhleFwiKVxuICB9XG5cbiAgLyoqXG4gICAqIEZpeGVkLXNpemUgZ2xvYmFsbHkgaW5kZXhlZCByZXByZXNlbnRhdGlvbiBvZiB0aGUgZG9jdW1lbnRlZCBzY29wZSB0dXBsZS5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBTY29wZSBpbnB1dC5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGFyZ3MuaWRlbXBvdGVuY3lLZXkgLSBDYWxsZXIga2V5LlxuICAgKiBAcGFyYW0ge3N0cmluZ30gYXJncy5qb2JOYW1lIC0gSm9iIGNsYXNzIG5hbWUuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBhcmdzLnF1ZXVlIC0gUXVldWUgbmFtZS5cbiAgICogQHJldHVybnMge3N0cmluZ30gLSBTSEEtMjU2IHNjb3BlIGRpZ2VzdC5cbiAgICovXG4gIF9pZGVtcG90ZW5jeVNjb3BlRGlnZXN0KHtpZGVtcG90ZW5jeUtleSwgam9iTmFtZSwgcXVldWV9KSB7XG4gICAgcmV0dXJuIGNyZWF0ZUhhc2goXCJzaGEyNTZcIilcbiAgICAgIC51cGRhdGUoc3RhYmxlSnNvblN0cmluZ2lmeSh7Zm9ybWF0OiBcInZlbG9jaW91cy1iYWNrZ3JvdW5kLWpvYi1pZGVtcG90ZW5jeS1zY29wZS12MVwiLCBpZGVtcG90ZW5jeUtleSwgam9iTmFtZSwgcXVldWV9KSlcbiAgICAgIC5kaWdlc3QoXCJoZXhcIilcbiAgfVxuXG4gIC8qKlxuICAgKiBWYWxpZGF0ZXMgb25lIGNhbGxlciBrZXkuXG4gICAqIEBwYXJhbSB7c3RyaW5nIHwgdW5kZWZpbmVkfSBpZGVtcG90ZW5jeUtleSAtIENhbGxlciBrZXkuXG4gICAqIEByZXR1cm5zIHtzdHJpbmd9IC0gVmFsaWQga2V5LlxuICAgKi9cbiAgX25vcm1hbGl6ZUlkZW1wb3RlbmN5S2V5KGlkZW1wb3RlbmN5S2V5KSB7XG4gICAgaWYgKHR5cGVvZiBpZGVtcG90ZW5jeUtleSAhPT0gXCJzdHJpbmdcIiB8fCBpZGVtcG90ZW5jeUtleS5sZW5ndGggPT09IDApIHtcbiAgICAgIHRocm93IFZlbG9jaW91c0Vycm9yLnNhZmUoXCJCYWNrZ3JvdW5kIGpvYiBpZGVtcG90ZW5jeUtleSBtdXN0IGJlIGEgbm9uLWVtcHR5IHN0cmluZy5cIiwge1xuICAgICAgICBjb2RlOiBcImJhY2tncm91bmQtam9iLWlkZW1wb3RlbmN5LWtleS1pbnZhbGlkXCJcbiAgICAgIH0pXG4gICAgfVxuXG4gICAgcmV0dXJuIGlkZW1wb3RlbmN5S2V5XG4gIH1cblxuICAvKipcbiAgICogUmVwbGFjZXMgdGhlIHF1ZXVlZCBvd25lciBvZiBhIHN0YWJsZSBzY2hlZHVsZSBrZXkgd2l0aCBhIG5ldyBvbmUtb2ZmIGpvYi5cbiAgICogQSBoYW5kZWQtb2ZmIG93bmVyIGlzIGxlZnQgcnVubmluZyBhbmQgcmVwb3J0ZWQgdHJ1dGhmdWxseS5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBPcHRpb25zLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gYXJncy5zY2hlZHVsZUtleSAtIFN0YWJsZSBsb2dpY2FsIHNjaGVkdWxlIGtleS5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGFyZ3Muam9iTmFtZSAtIEpvYiBuYW1lLlxuICAgKiBAcGFyYW0ge0FycmF5PFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gYXJncy5hcmdzIC0gQXJndW1lbnRzLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vdHlwZXMuanNcIikuQmFja2dyb3VuZEpvYk9wdGlvbnN9IFthcmdzLm9wdGlvbnNdIC0gT3B0aW9ucy5cbiAgICogQHJldHVybnMge1Byb21pc2U8aW1wb3J0KFwiLi90eXBlcy5qc1wiKS5CYWNrZ3JvdW5kSm9iUmVwbGFjZW1lbnRSZXN1bHQ+fSAtIFJlcGxhY2VtZW50IHJlc3VsdC5cbiAgICovXG4gIGFzeW5jIHJlcGxhY2VTY2hlZHVsZWQoe3NjaGVkdWxlS2V5LCBqb2JOYW1lLCBhcmdzLCBvcHRpb25zfSkge1xuICAgIGF3YWl0IHRoaXMuZW5zdXJlUmVhZHkoKVxuXG4gICAgY29uc3Qgbm9ybWFsaXplZFNjaGVkdWxlS2V5ID0gdGhpcy5fbm9ybWFsaXplU2NoZWR1bGVLZXkoc2NoZWR1bGVLZXkpXG4gICAgY29uc3QgcHJlcGFyZWRKb2IgPSB0aGlzLl9wcmVwYXJlSm9iKHtqb2JOYW1lLCBhcmdzLCBvcHRpb25zfSlcblxuICAgIHJldHVybiBhd2FpdCB0aGlzLl9zZXJpYWxpemVkQ291bnRNdXRhdGlvbihhc3luYyAoZGIpID0+IHtcbiAgICAgIGNvbnN0IG93bmVyUm93cyA9IGF3YWl0IGRiXG4gICAgICAgIC5uZXdRdWVyeSgpXG4gICAgICAgIC5mcm9tKFNDSEVEVUxFX0tFWVNfVEFCTEUpXG4gICAgICAgIC53aGVyZSh7c2NoZWR1bGVfa2V5OiBub3JtYWxpemVkU2NoZWR1bGVLZXl9KVxuICAgICAgICAubGltaXQoMSlcbiAgICAgICAgLnJlc3VsdHMoKVxuICAgICAgY29uc3Qgb3duZXJKb2JJZCA9IG93bmVyUm93c1swXSA/IFN0cmluZygvKiogQHR5cGUge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gKi8gKG93bmVyUm93c1swXSkuam9iX2lkKSA6IG51bGxcbiAgICAgIGNvbnN0IG93bmVySm9iID0gb3duZXJKb2JJZCA/IGF3YWl0IHRoaXMuX2dldEpvYlJvd0J5SWQoZGIsIG93bmVySm9iSWQpIDogbnVsbFxuICAgICAgLyoqIEB0eXBlIHtpbXBvcnQoXCIuL3R5cGVzLmpzXCIpLkJhY2tncm91bmRKb2JSZXBsYWNlbWVudFByZXZpb3VzU3RhdHVzfSAqL1xuICAgICAgbGV0IHByZXZpb3VzU3RhdHVzID0gbnVsbFxuICAgICAgbGV0IHByZXZpb3VzSm9iSWQgPSBudWxsXG5cbiAgICAgIGlmIChvd25lckpvYj8uc3RhdHVzID09PSBcInF1ZXVlZFwiKSB7XG4gICAgICAgIGNvbnN0IGFmZmVjdGVkUm93cyA9IGF3YWl0IHRoaXMuX3VwZGF0ZUFmZmVjdGVkUm93cyhkYiwge1xuICAgICAgICAgIHRhYmxlTmFtZTogSk9CU19UQUJMRSxcbiAgICAgICAgICBkYXRhOiB7c3RhdHVzOiBcImNhbmNlbGxlZFwifSxcbiAgICAgICAgICBjb25kaXRpb25zOiB7aWQ6IG93bmVySm9iLmlkLCBzdGF0dXM6IFwicXVldWVkXCJ9XG4gICAgICAgIH0pXG5cbiAgICAgICAgaWYgKGFmZmVjdGVkUm93cyA9PT0gMSkge1xuICAgICAgICAgIHByZXZpb3VzSm9iSWQgPSBvd25lckpvYi5pZFxuICAgICAgICAgIHByZXZpb3VzU3RhdHVzID0gXCJxdWV1ZWRcIlxuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgIGNvbnN0IGN1cnJlbnRPd25lckpvYiA9IGF3YWl0IHRoaXMuX2dldEpvYlJvd0J5SWQoZGIsIG93bmVySm9iLmlkKVxuXG4gICAgICAgICAgaWYgKGN1cnJlbnRPd25lckpvYj8uc3RhdHVzID09PSBcImhhbmRlZF9vZmZcIikge1xuICAgICAgICAgICAgcHJldmlvdXNKb2JJZCA9IGN1cnJlbnRPd25lckpvYi5pZFxuICAgICAgICAgICAgcHJldmlvdXNTdGF0dXMgPSBcImhhbmRlZF9vZmZcIlxuICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgICAgfSBlbHNlIGlmIChvd25lckpvYj8uc3RhdHVzID09PSBcImhhbmRlZF9vZmZcIikge1xuICAgICAgICBwcmV2aW91c0pvYklkID0gb3duZXJKb2IuaWRcbiAgICAgICAgcHJldmlvdXNTdGF0dXMgPSBcImhhbmRlZF9vZmZcIlxuICAgICAgfVxuXG4gICAgICBhd2FpdCB0aGlzLl9pbnNlcnRQcmVwYXJlZEpvYihkYiwge3ByZXBhcmVkSm9iLCBzY2hlZHVsZUtleTogbm9ybWFsaXplZFNjaGVkdWxlS2V5fSlcbiAgICAgIGF3YWl0IGRiLnVwc2VydCh7XG4gICAgICAgIHRhYmxlTmFtZTogU0NIRURVTEVfS0VZU19UQUJMRSxcbiAgICAgICAgZGF0YToge3NjaGVkdWxlX2tleTogbm9ybWFsaXplZFNjaGVkdWxlS2V5LCBqb2JfaWQ6IHByZXBhcmVkSm9iLmpvYklkfSxcbiAgICAgICAgY29uZmxpY3RDb2x1bW5zOiBbXCJzY2hlZHVsZV9rZXlcIl0sXG4gICAgICAgIHVwZGF0ZUNvbHVtbnM6IFtcImpvYl9pZFwiXVxuICAgICAgfSlcblxuICAgICAgaWYgKHByZXZpb3VzU3RhdHVzICE9PSBcInF1ZXVlZFwiKSBhd2FpdCB0aGlzLl9yZWNvcmRDb3VudERlbHRhKGRiLCB7YWxsOiAxLCBxdWV1ZWQ6IDF9KVxuICAgICAgcmV0dXJuIHtqb2JJZDogcHJlcGFyZWRKb2Iuam9iSWQsIHByZXZpb3VzSm9iSWQsIHByZXZpb3VzU3RhdHVzfVxuICAgIH0sIHtcbiAgICAgIGFkdmlzb3J5TG9jazoge1xuICAgICAgICBmYWlsdXJlTWVzc2FnZTogXCJGYWlsZWQgdG8gYWNxdWlyZSBiYWNrZ3JvdW5kIGpvYiBzY2hlZHVsZS1rZXkgbG9ja1wiLFxuICAgICAgICBuYW1lOiB0aGlzLl9zY2hlZHVsZUtleUxvY2tOYW1lKG5vcm1hbGl6ZWRTY2hlZHVsZUtleSlcbiAgICAgIH1cbiAgICB9KVxuICB9XG5cbiAgLyoqXG4gICAqIENhbmNlbHMgdGhlIHF1ZXVlZCBvd25lciBvZiBhIHN0YWJsZSBzY2hlZHVsZSBrZXkuIEEgaGFuZGVkLW9mZiBvd25lciBpc1xuICAgKiBkZXRhY2hlZCBidXQgbm90IG1hcmtlZCBzdG9wcGVkIGJlY2F1c2UgZXhlY3V0aW9uIG1heSBhbHJlYWR5IGJlIHJ1bm5pbmcuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBzY2hlZHVsZUtleSAtIFN0YWJsZSBsb2dpY2FsIHNjaGVkdWxlIGtleS5cbiAgICogQHJldHVybnMge1Byb21pc2U8aW1wb3J0KFwiLi90eXBlcy5qc1wiKS5CYWNrZ3JvdW5kSm9iQ2FuY2VsbGF0aW9uUmVzdWx0Pn0gLSBDYW5jZWxsYXRpb24gcmVzdWx0LlxuICAgKi9cbiAgYXN5bmMgY2FuY2VsU2NoZWR1bGVkKHNjaGVkdWxlS2V5KSB7XG4gICAgYXdhaXQgdGhpcy5lbnN1cmVSZWFkeSgpXG5cbiAgICBjb25zdCBub3JtYWxpemVkU2NoZWR1bGVLZXkgPSB0aGlzLl9ub3JtYWxpemVTY2hlZHVsZUtleShzY2hlZHVsZUtleSlcblxuICAgIHJldHVybiBhd2FpdCB0aGlzLl9zZXJpYWxpemVkQ291bnRNdXRhdGlvbihhc3luYyAoZGIpID0+IHtcbiAgICAgIGNvbnN0IG93bmVyUm93cyA9IGF3YWl0IGRiXG4gICAgICAgIC5uZXdRdWVyeSgpXG4gICAgICAgIC5mcm9tKFNDSEVEVUxFX0tFWVNfVEFCTEUpXG4gICAgICAgIC53aGVyZSh7c2NoZWR1bGVfa2V5OiBub3JtYWxpemVkU2NoZWR1bGVLZXl9KVxuICAgICAgICAubGltaXQoMSlcbiAgICAgICAgLnJlc3VsdHMoKVxuXG4gICAgICBpZiAoIW93bmVyUm93c1swXSkgcmV0dXJuIHtqb2JJZDogbnVsbCwgb3V0Y29tZTogXCJub3RfZm91bmRcIn1cblxuICAgICAgY29uc3Qgam9iSWQgPSBTdHJpbmcoLyoqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59ICovIChvd25lclJvd3NbMF0pLmpvYl9pZClcbiAgICAgIGNvbnN0IGpvYiA9IGF3YWl0IHRoaXMuX2dldEpvYlJvd0J5SWQoZGIsIGpvYklkKVxuXG4gICAgICBpZiAoam9iPy5zdGF0dXMgPT09IFwicXVldWVkXCIpIHtcbiAgICAgICAgY29uc3QgYWZmZWN0ZWRSb3dzID0gYXdhaXQgdGhpcy5fdXBkYXRlQWZmZWN0ZWRSb3dzKGRiLCB7XG4gICAgICAgICAgdGFibGVOYW1lOiBKT0JTX1RBQkxFLFxuICAgICAgICAgIGRhdGE6IHtzdGF0dXM6IFwiY2FuY2VsbGVkXCJ9LFxuICAgICAgICAgIGNvbmRpdGlvbnM6IHtpZDogam9iLmlkLCBzdGF0dXM6IFwicXVldWVkXCJ9XG4gICAgICAgIH0pXG5cbiAgICAgICAgaWYgKGFmZmVjdGVkUm93cyA9PT0gMSkge1xuICAgICAgICAgIGF3YWl0IHRoaXMuX3JlbGVhc2VTY2hlZHVsZU93bmVyc2hpcChkYiwge2pvYklkLCBzY2hlZHVsZUtleTogbm9ybWFsaXplZFNjaGVkdWxlS2V5fSlcbiAgICAgICAgICBhd2FpdCB0aGlzLl9yZWNvcmRTdGF0dXNUcmFuc2l0aW9uKGRiLCBcInF1ZXVlZFwiLCBcImNhbmNlbGxlZFwiKVxuXG4gICAgICAgICAgcmV0dXJuIHtqb2JJZCwgb3V0Y29tZTogXCJjYW5jZWxsZWRcIn1cbiAgICAgICAgfVxuICAgICAgfVxuXG4gICAgICBjb25zdCBjdXJyZW50Sm9iID0gYXdhaXQgdGhpcy5fZ2V0Sm9iUm93QnlJZChkYiwgam9iSWQpXG5cbiAgICAgIGF3YWl0IHRoaXMuX3JlbGVhc2VTY2hlZHVsZU93bmVyc2hpcChkYiwge2pvYklkLCBzY2hlZHVsZUtleTogbm9ybWFsaXplZFNjaGVkdWxlS2V5fSlcblxuICAgICAgaWYgKGN1cnJlbnRKb2I/LnN0YXR1cyA9PT0gXCJoYW5kZWRfb2ZmXCIpIHJldHVybiB7am9iSWQsIG91dGNvbWU6IFwiaGFuZGVkX29mZlwifVxuICAgICAgcmV0dXJuIHtqb2JJZDogbnVsbCwgb3V0Y29tZTogXCJub3RfZm91bmRcIn1cbiAgICB9LCB7XG4gICAgICBhZHZpc29yeUxvY2s6IHtcbiAgICAgICAgZmFpbHVyZU1lc3NhZ2U6IFwiRmFpbGVkIHRvIGFjcXVpcmUgYmFja2dyb3VuZCBqb2Igc2NoZWR1bGUta2V5IGxvY2tcIixcbiAgICAgICAgbmFtZTogdGhpcy5fc2NoZWR1bGVLZXlMb2NrTmFtZShub3JtYWxpemVkU2NoZWR1bGVLZXkpXG4gICAgICB9XG4gICAgfSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIG5leHQgYXZhaWxhYmxlIGpvYi5cbiAgICogQHBhcmFtIHtvYmplY3R9IFthcmdzXSAtIE9wdGlvbnMuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi90eXBlcy5qc1wiKS5CYWNrZ3JvdW5kSm9iRXhlY3V0aW9uTW9kZSB8IGltcG9ydChcIi4vdHlwZXMuanNcIikuQmFja2dyb3VuZEpvYkV4ZWN1dGlvbk1vZGVbXX0gW2FyZ3MuZXhlY3V0aW9uTW9kZV0gLSBFeGVjdXRpb24gbW9kZSBvciBtb2RlcyB0byBtYXRjaC5cbiAgICogQHJldHVybnMge1Byb21pc2U8aW1wb3J0KFwiLi90eXBlcy5qc1wiKS5CYWNrZ3JvdW5kSm9iUm93IHwgbnVsbD59IC0gTmV4dCBqb2IuXG4gICAqL1xuICBhc3luYyBuZXh0QXZhaWxhYmxlSm9iKGFyZ3MgPSB7fSkge1xuICAgIGF3YWl0IHRoaXMuZW5zdXJlUmVhZHkoKVxuXG4gICAgcmV0dXJuIGF3YWl0IHRoaXMuX3dpdGhEYihhc3luYyAoZGIpID0+IHtcbiAgICAgIHJldHVybiBhd2FpdCB0aGlzLl9uZXh0UXVldWVkSm9iKHtcbiAgICAgICAgZGIsXG4gICAgICAgIHNjaGVkdWxlZEF0T3BlcmF0b3I6IFwiPD1cIixcbiAgICAgICAgZXhlY3V0aW9uTW9kZTogYXJncy5leGVjdXRpb25Nb2RlXG4gICAgICB9KVxuICAgIH0pXG4gIH1cblxuICAvKipcbiAgICogUmV0dXJucyB0aGUgc29vbmVzdCBmdXR1cmUtc2NoZWR1bGVkIHF1ZXVlZCBqb2IgKG9uZSB3aG9zZVxuICAgKiBgc2NoZWR1bGVkX2F0X21zYCBpcyBpbiB0aGUgZnV0dXJlKSwgb3IgbnVsbCB3aGVuIHRoZXJlIGFyZSBub1xuICAgKiBmdXR1cmUtc2NoZWR1bGVkIGpvYnMuIFVzZWQgYnkgdGhlIGV2ZW50LWRyaXZlbiBkaXNwYXRjaGVyIHRvIGFybSBhXG4gICAqIGBzZXRUaW1lb3V0YCBmb3IgdGhlIGV4YWN0IG1vbWVudCB0aGUgbmV4dCBzY2hlZHVsZWQgam9iIGJlY29tZXNcbiAgICogZWxpZ2libGUsIHJlcGxhY2luZyB0aGUgbGVnYWN5IDEtc2Vjb25kIHBvbGxpbmcgbG9vcC5cbiAgICogQHJldHVybnMge1Byb21pc2U8aW1wb3J0KFwiLi90eXBlcy5qc1wiKS5CYWNrZ3JvdW5kSm9iUm93IHwgbnVsbD59IC0gU29vbmVzdCBmdXR1cmUtc2NoZWR1bGVkIGpvYiwgb3IgbnVsbC5cbiAgICovXG4gIGFzeW5jIG5leHRTY2hlZHVsZWRKb2IoKSB7XG4gICAgYXdhaXQgdGhpcy5lbnN1cmVSZWFkeSgpXG5cbiAgICByZXR1cm4gYXdhaXQgdGhpcy5fd2l0aERiKGFzeW5jIChkYikgPT4ge1xuICAgICAgcmV0dXJuIGF3YWl0IHRoaXMuX25leHRRdWV1ZWRKb2Ioe2RiLCBzY2hlZHVsZWRBdE9wZXJhdG9yOiBcIj5cIn0pXG4gICAgfSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIG5leHQgcXVldWVkIGpvYi5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBPcHRpb25zLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL2RhdGFiYXNlL2RyaXZlcnMvYmFzZS5qc1wiKS5kZWZhdWx0fSBhcmdzLmRiIC0gRGF0YWJhc2UgY29ubmVjdGlvbi5cbiAgICogQHBhcmFtIHtcIjw9XCIgfCBcIj5cIn0gYXJncy5zY2hlZHVsZWRBdE9wZXJhdG9yIC0gU2NoZWR1bGVkIHRpbWVzdGFtcCBvcGVyYXRvci5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL3R5cGVzLmpzXCIpLkJhY2tncm91bmRKb2JFeGVjdXRpb25Nb2RlIHwgaW1wb3J0KFwiLi90eXBlcy5qc1wiKS5CYWNrZ3JvdW5kSm9iRXhlY3V0aW9uTW9kZVtdfSBbYXJncy5leGVjdXRpb25Nb2RlXSAtIEV4ZWN1dGlvbiBtb2RlIG9yIG1vZGVzIHRvIG1hdGNoLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxpbXBvcnQoXCIuL3R5cGVzLmpzXCIpLkJhY2tncm91bmRKb2JSb3cgfCBudWxsPn0gLSBOZXh0IG1hdGNoaW5nIHF1ZXVlZCBqb2IuXG4gICAqL1xuICBhc3luYyBfbmV4dFF1ZXVlZEpvYih7ZGIsIHNjaGVkdWxlZEF0T3BlcmF0b3IsIGV4ZWN1dGlvbk1vZGV9KSB7XG4gICAgY29uc3Qgbm93ID0gRGF0ZS5ub3coKVxuICAgIGxldCBxdWVyeSA9IGRiXG4gICAgICAubmV3UXVlcnkoKVxuICAgICAgLmZyb20oSk9CU19UQUJMRSlcbiAgICAgIC53aGVyZSh7c3RhdHVzOiBcInF1ZXVlZFwifSlcbiAgICAgIC53aGVyZShgc2NoZWR1bGVkX2F0X21zICR7c2NoZWR1bGVkQXRPcGVyYXRvcn0gJHtkYi5xdW90ZShub3cpfWApXG5cbiAgICBpZiAoc2NoZWR1bGVkQXRPcGVyYXRvciA9PT0gXCI8PVwiKSB7XG4gICAgICBjb25zdCBqb2JzVGFibGUgPSBkYi5xdW90ZVRhYmxlKEpPQlNfVEFCTEUpXG4gICAgICBjb25zdCBjb25jdXJyZW5jeVRhYmxlID0gZGIucXVvdGVUYWJsZShDT05DVVJSRU5DWV9UQUJMRSlcbiAgICAgIHF1ZXJ5ID0gcXVlcnkud2hlcmUoXG4gICAgICAgIGAoJHtqb2JzVGFibGV9LiR7ZGIucXVvdGVDb2x1bW4oXCJjb25jdXJyZW5jeV9rZXlcIil9IElTIE5VTEwgT1IgRVhJU1RTIChgICtcbiAgICAgICAgYFNFTEVDVCAxIEZST00gJHtjb25jdXJyZW5jeVRhYmxlfSBXSEVSRSBgICtcbiAgICAgICAgYCR7Y29uY3VycmVuY3lUYWJsZX0uJHtkYi5xdW90ZUNvbHVtbihcImNvbmN1cnJlbmN5X2tleVwiKX0gPSAke2pvYnNUYWJsZX0uJHtkYi5xdW90ZUNvbHVtbihcImNvbmN1cnJlbmN5X2tleVwiKX0gQU5EIGAgK1xuICAgICAgICBgJHtjb25jdXJyZW5jeVRhYmxlfS4ke2RiLnF1b3RlQ29sdW1uKFwiYWN0aXZlX2NvdW50XCIpfSA8ICR7Y29uY3VycmVuY3lUYWJsZX0uJHtkYi5xdW90ZUNvbHVtbihcIm1heF9jb25jdXJyZW5jeVwiKX0pKWBcbiAgICAgIClcbiAgICB9XG5cbiAgICBpZiAoZXhlY3V0aW9uTW9kZSkgcXVlcnkgPSB0aGlzLl93aGVyZUV4ZWN1dGlvbk1vZGUoe2RiLCBleGVjdXRpb25Nb2RlLCBxdWVyeX0pXG5cbiAgICBpZiAoc2NoZWR1bGVkQXRPcGVyYXRvciA9PT0gXCI8PVwiKSB7XG4gICAgICBjb25zdCBwcmlvcml0eU9yZGVyID0gdGhpcy5fcXVldWVQcmlvcml0eU9yZGVyU3FsKGRiKVxuXG4gICAgICBpZiAocHJpb3JpdHlPcmRlcikgcXVlcnkgPSBxdWVyeS5vcmRlcihgJHtwcmlvcml0eU9yZGVyfSBERVNDYClcbiAgICB9XG5cbiAgICBxdWVyeSA9IHF1ZXJ5XG4gICAgICAub3JkZXIoXCJzY2hlZHVsZWRfYXRfbXMgQVNDXCIpXG4gICAgICAub3JkZXIoXCJjcmVhdGVkX2F0X21zIEFTQ1wiKVxuICAgICAgLmxpbWl0KDEpXG5cbiAgICBjb25zdCByb3dzID0gYXdhaXQgcXVlcnkucmVzdWx0cygpXG4gICAgY29uc3Qgcm93ID0gcm93c1swXVxuXG4gICAgaWYgKCFyb3cpIHJldHVybiBudWxsXG5cbiAgICByZXR1cm4gdGhpcy5fbm9ybWFsaXplSm9iUm93KHJvdylcbiAgfVxuXG4gIC8qKlxuICAgKiBCdWlsZHMgYSByYXcgU1FMIE9SREVSIEJZIGV4cHJlc3Npb24gcmFua2luZyBxdWV1ZWQgam9icyBieSB0aGVpciBxdWV1ZSdzXG4gICAqIGNvbmZpZ3VyZWQgcHJpb3JpdHkgKGBiYWNrZ3JvdW5kSm9icy5xdWV1ZXNbcXVldWVdLnByaW9yaXR5YCwgZGVmYXVsdCBgMGApLFxuICAgKiBzbyB0aGUgZGlzcGF0Y2hlciBwaWNrcyBoaWdoZXItcHJpb3JpdHkgcXVldWVzIGZpcnN0IHJlZ2FyZGxlc3Mgb2YgZW5xdWV1ZVxuICAgKiBvcmRlci4gT25seSBhcHBsaWVkIHRvIHRoZSBkaXNwYXRjaCBwYXRoIChgc2NoZWR1bGVkQXRPcGVyYXRvciA9PT0gXCI8PVwiYCk7XG4gICAqIHRoZSBmdXR1cmUtc2NoZWR1bGVkIGxvb2t1cCBtdXN0IHN0YXkgc3RyaWN0bHkgdGltZS1vcmRlcmVkLiBDb21wb3NlcyB3aXRoXG4gICAqIHRoZSBjb25jdXJyZW5jeSBFWElTVFMgZmlsdGVyOiBhIGhpZ2hlci1wcmlvcml0eSBxdWV1ZSBhbHJlYWR5IGF0IGl0cyBjYXAgaXNcbiAgICogZmlsdGVyZWQgb3V0LCBzbyBkaXNwYXRjaCBmYWxscyB0aHJvdWdoIHRvIHRoZSBuZXh0IGVsaWdpYmxlIGxvd2VyLXByaW9yaXR5XG4gICAqIGpvYi4gUmV0dXJucyBudWxsIHdoZW4gbm8gcXVldWUgY29uZmlndXJlcyBhIG5vbi16ZXJvIHByaW9yaXR5IHNvIHRoZSBwbGFpblxuICAgKiBGSUZPIG9yZGVyaW5nIGlzIGxlZnQgdW50b3VjaGVkIChhbmQgbm8gbmVlZGxlc3MgZmlsZXNvcnQgaXMgaW50cm9kdWNlZCkuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vZGF0YWJhc2UvZHJpdmVycy9iYXNlLmpzXCIpLmRlZmF1bHR9IGRiIC0gRGF0YWJhc2UgY29ubmVjdGlvbi5cbiAgICogQHJldHVybnMge3N0cmluZyB8IG51bGx9IC0gUmF3IFNRTCBDQVNFIGV4cHJlc3Npb24sIG9yIG51bGwgd2hlbiBubyBxdWV1ZSBpcyBwcmlvcml0aXplZC5cbiAgICovXG4gIF9xdWV1ZVByaW9yaXR5T3JkZXJTcWwoZGIpIHtcbiAgICBjb25zdCBxdWV1ZXMgPSB0aGlzLmNvbmZpZ3VyYXRpb24uZ2V0QmFja2dyb3VuZEpvYnNDb25maWcoKS5xdWV1ZXMgfHwge31cbiAgICAvKiogQHR5cGUge0FycmF5PFtzdHJpbmcsIG51bWJlcl0+fSAqL1xuICAgIGNvbnN0IHByaW9yaXRpemVkID0gW11cblxuICAgIGZvciAoY29uc3QgW3F1ZXVlLCBxdWV1ZUNvbmZpZ10gb2YgT2JqZWN0LmVudHJpZXMocXVldWVzKSkge1xuICAgICAgY29uc3QgcHJpb3JpdHkgPSBxdWV1ZUNvbmZpZz8ucHJpb3JpdHlcblxuICAgICAgaWYgKE51bWJlci5pc0Zpbml0ZShwcmlvcml0eSkgJiYgTnVtYmVyKHByaW9yaXR5KSAhPT0gMCkgcHJpb3JpdGl6ZWQucHVzaChbcXVldWUsIE51bWJlcihwcmlvcml0eSldKVxuICAgIH1cblxuICAgIGlmIChwcmlvcml0aXplZC5sZW5ndGggPT09IDApIHJldHVybiBudWxsXG5cbiAgICBjb25zdCBxdWV1ZUNvbHVtbiA9IGRiLnF1b3RlQ29sdW1uKFwicXVldWVcIilcbiAgICBjb25zdCB3aGVucyA9IHByaW9yaXRpemVkXG4gICAgICAubWFwKChbcXVldWUsIHByaW9yaXR5XSkgPT4gYFdIRU4gJHtkYi5xdW90ZShxdWV1ZSl9IFRIRU4gJHtwcmlvcml0eX1gKVxuICAgICAgLmpvaW4oXCIgXCIpXG5cbiAgICByZXR1cm4gYENBU0UgQ09BTEVTQ0UoJHtxdWV1ZUNvbHVtbn0sICR7ZGIucXVvdGUoREVGQVVMVF9CQUNLR1JPVU5EX0pPQl9RVUVVRSl9KSAke3doZW5zfSBFTFNFIDAgRU5EYFxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZ2V0IGpvYi5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGpvYklkIC0gSm9iIGlkLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxpbXBvcnQoXCIuL3R5cGVzLmpzXCIpLkJhY2tncm91bmRKb2JSb3cgfCBudWxsPn0gLSBKb2Igcm93LlxuICAgKi9cbiAgYXN5bmMgZ2V0Sm9iKGpvYklkKSB7XG4gICAgYXdhaXQgdGhpcy5lbnN1cmVSZWFkeSgpXG5cbiAgICByZXR1cm4gYXdhaXQgdGhpcy5fd2l0aERiKGFzeW5jIChkYikgPT4ge1xuICAgICAgY29uc3QgcXVlcnkgPSBkYlxuICAgICAgICAubmV3UXVlcnkoKVxuICAgICAgICAuZnJvbShKT0JTX1RBQkxFKVxuICAgICAgICAud2hlcmUoe2lkOiBqb2JJZH0pXG4gICAgICAgIC5saW1pdCgxKVxuXG4gICAgICBjb25zdCByb3dzID0gYXdhaXQgcXVlcnkucmVzdWx0cygpXG4gICAgICBjb25zdCByb3cgPSByb3dzWzBdXG5cbiAgICAgIGlmICghcm93KSByZXR1cm4gbnVsbFxuXG4gICAgICByZXR1cm4gdGhpcy5fbm9ybWFsaXplSm9iUm93KHJvdylcbiAgICB9KVxuICB9XG5cbiAgLyoqXG4gICAqIENvdW50cyBqb2JzIGdyb3VwZWQgYnkgc3RhdHVzLiBVc2VkIGJ5IHRoZSBkYXNoYm9hcmQgb3ZlcnZpZXcuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPFJlY29yZDxzdHJpbmcsIG51bWJlcj4+fSAtIENvdW50cyBrZXllZCBieSBzdGF0dXMuXG4gICAqL1xuICBhc3luYyBjb3VudHNCeVN0YXR1cygpIHtcbiAgICBhd2FpdCB0aGlzLmVuc3VyZVJlYWR5KClcblxuICAgIHJldHVybiBhd2FpdCB0aGlzLl93aXRoRGIoYXN5bmMgKGRiKSA9PiB7XG4gICAgICBjb25zdCByb3dzID0gYXdhaXQgZGJcbiAgICAgICAgLm5ld1F1ZXJ5KClcbiAgICAgICAgLmZyb20oSk9CU19UQUJMRSlcbiAgICAgICAgLnNlbGVjdChcInN0YXR1c1wiKVxuICAgICAgICAuc2VsZWN0KFwiQ09VTlQoKikgQVMgY291bnRcIilcbiAgICAgICAgLmdyb3VwKFwic3RhdHVzXCIpXG4gICAgICAgIC5yZXN1bHRzKClcblxuICAgICAgLyoqXG4gICAgICAgKiBDb3VudHMuXG4gICAgICAgKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgbnVtYmVyPn0gKi9cbiAgICAgIGNvbnN0IGNvdW50cyA9IHt9XG5cbiAgICAgIGZvciAoY29uc3Qgcm93IG9mIHJvd3MpIHtcbiAgICAgICAgY29uc3QgdHlwZWRSb3cgPSAvKiogQHR5cGUge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gKi8gKHJvdylcblxuICAgICAgICBjb3VudHNbU3RyaW5nKHR5cGVkUm93LnN0YXR1cyldID0gdGhpcy5fbm9ybWFsaXplTnVtYmVyKHR5cGVkUm93LmNvdW50KSB8fCAwXG4gICAgICB9XG5cbiAgICAgIHJldHVybiBjb3VudHNcbiAgICB9KVxuICB9XG5cbiAgLyoqXG4gICAqIFJldHVybnMgdGhlIGF1dGhvcml0YXRpdmUgZGFzaGJvYXJkIGNvdW50IHNuYXBzaG90IGFuZCBpdHMgbWF0Y2hpbmcgZHVyYWJsZVxuICAgKiByZXZpc2lvbi4gTG9ja2luZyB0aGUgcmV2aXNpb24gcm93IGJlZm9yZSBjb3VudGluZyBwcmV2ZW50cyBhIHdyaXRlciBmcm9tXG4gICAqIGNvbW1pdHRpbmcgYmV0d2VlbiB0aGUgY291bnQgcXVlcnkgYW5kIHJldmlzaW9uIHJlYWQuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHtjb3VudHM6IFJlY29yZDxzdHJpbmcsIG51bWJlcj4sIHJldmlzaW9uOiBudW1iZXIsIHRvdGFsOiBudW1iZXJ9Pn0gU25hcHNob3QuXG4gICAqL1xuICBhc3luYyBjb3VudFNuYXBzaG90KCkge1xuICAgIGF3YWl0IHRoaXMuZW5zdXJlUmVhZHkoKVxuXG4gICAgcmV0dXJuIGF3YWl0IHRoaXMuX3NlcmlhbGl6ZWRDb3VudE11dGF0aW9uKGFzeW5jIChkYikgPT4ge1xuICAgICAgcmV0dXJuIGF3YWl0IHRoaXMuX2NvdW50U25hcHNob3RPbkxvY2tlZENvbm5lY3Rpb24oZGIpXG4gICAgfSlcbiAgfVxuXG4gIC8qKlxuICAgKiBDb3VudHMgam9icyBtYXRjaGluZyB0aGUgZ2l2ZW4gZmlsdGVycy5cbiAgICogQHBhcmFtIHtvYmplY3R9IFthcmdzXSAtIE9wdGlvbnMuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBbYXJncy5zdGF0dXNdIC0gRmlsdGVyIGJ5IHN0YXR1cy5cbiAgICogQHBhcmFtIHtzdHJpbmd9IFthcmdzLmpvYk5hbWVdIC0gRmlsdGVyIGJ5IGpvYiBuYW1lLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxudW1iZXI+fSAtIE1hdGNoaW5nIGpvYiBjb3VudC5cbiAgICovXG4gIGFzeW5jIGNvdW50Sm9icyh7c3RhdHVzLCBqb2JOYW1lfSA9IHt9KSB7XG4gICAgYXdhaXQgdGhpcy5lbnN1cmVSZWFkeSgpXG5cbiAgICByZXR1cm4gYXdhaXQgdGhpcy5fd2l0aERiKGFzeW5jIChkYikgPT4ge1xuICAgICAgbGV0IHF1ZXJ5ID0gZGIubmV3UXVlcnkoKS5mcm9tKEpPQlNfVEFCTEUpLnNlbGVjdChcIkNPVU5UKCopIEFTIGNvdW50XCIpXG5cbiAgICAgIGlmIChzdGF0dXMpIHF1ZXJ5ID0gcXVlcnkud2hlcmUoe3N0YXR1c30pXG4gICAgICBpZiAoam9iTmFtZSkgcXVlcnkgPSBxdWVyeS53aGVyZSh7am9iX25hbWU6IGpvYk5hbWV9KVxuXG4gICAgICBjb25zdCByb3dzID0gYXdhaXQgcXVlcnkucmVzdWx0cygpXG4gICAgICBjb25zdCBjb3VudFJvdyA9IC8qKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSAqLyAocm93c1swXSB8fCB7fSlcblxuICAgICAgcmV0dXJuIHRoaXMuX25vcm1hbGl6ZU51bWJlcihjb3VudFJvdy5jb3VudCkgfHwgMFxuICAgIH0pXG4gIH1cblxuICAvKipcbiAgICogTGlzdHMgam9icyBmb3IgdGhlIGRhc2hib2FyZCwgZmlsdGVyZWQsIHNvcnRlZCBhbmQgcGFnaW5hdGVkLlxuICAgKiBAcGFyYW0ge29iamVjdH0gW2FyZ3NdIC0gT3B0aW9ucy5cbiAgICogQHBhcmFtIHtzdHJpbmd9IFthcmdzLnN0YXR1c10gLSBGaWx0ZXIgYnkgc3RhdHVzLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gW2FyZ3Muam9iTmFtZV0gLSBGaWx0ZXIgYnkgam9iIG5hbWUuXG4gICAqIEBwYXJhbSB7bnVtYmVyfSBbYXJncy5saW1pdF0gLSBNYXhpbXVtIHJvd3MgdG8gcmV0dXJuLlxuICAgKiBAcGFyYW0ge251bWJlcn0gW2FyZ3Mub2Zmc2V0XSAtIFJvd3MgdG8gc2tpcC5cbiAgICogQHBhcmFtIHtzdHJpbmd9IFthcmdzLnNvcnRDb2x1bW5dIC0gQ2FtZWwtY2FzZWQgY29sdW1uIHRvIHNvcnQgYnkgKHNlZSBTT1JUQUJMRV9DT0xVTU5TKS5cbiAgICogQHBhcmFtIHtcIkFTQ1wiIHwgXCJERVNDXCJ9IFthcmdzLnNvcnREaXJlY3Rpb25dIC0gU29ydCBkaXJlY3Rpb24uXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPGltcG9ydChcIi4vdHlwZXMuanNcIikuQmFja2dyb3VuZEpvYlJvd1tdPn0gLSBOb3JtYWxpemVkIGpvYiByb3dzLlxuICAgKi9cbiAgYXN5bmMgbGlzdEpvYnMoe3N0YXR1cywgam9iTmFtZSwgbGltaXQgPSAyNSwgb2Zmc2V0ID0gMCwgc29ydENvbHVtbiA9IFwiY3JlYXRlZEF0TXNcIiwgc29ydERpcmVjdGlvbiA9IFwiREVTQ1wifSA9IHt9KSB7XG4gICAgYXdhaXQgdGhpcy5lbnN1cmVSZWFkeSgpXG5cbiAgICBjb25zdCBjb2x1bW4gPSBTT1JUQUJMRV9DT0xVTU5TW3NvcnRDb2x1bW5dIHx8IFNPUlRBQkxFX0NPTFVNTlMuY3JlYXRlZEF0TXNcbiAgICBjb25zdCBkaXJlY3Rpb24gPSBzb3J0RGlyZWN0aW9uID09PSBcIkFTQ1wiID8gXCJBU0NcIiA6IFwiREVTQ1wiXG5cbiAgICByZXR1cm4gYXdhaXQgdGhpcy5fd2l0aERiKGFzeW5jIChkYikgPT4ge1xuICAgICAgbGV0IHF1ZXJ5ID0gZGIubmV3UXVlcnkoKS5mcm9tKEpPQlNfVEFCTEUpXG5cbiAgICAgIGlmIChzdGF0dXMpIHF1ZXJ5ID0gcXVlcnkud2hlcmUoe3N0YXR1c30pXG4gICAgICBpZiAoam9iTmFtZSkgcXVlcnkgPSBxdWVyeS53aGVyZSh7am9iX25hbWU6IGpvYk5hbWV9KVxuXG4gICAgICBxdWVyeSA9IHF1ZXJ5Lm9yZGVyKHtjb2x1bW4sIGRpcmVjdGlvbn0pXG4gICAgICBpZiAoY29sdW1uICE9PSBTT1JUQUJMRV9DT0xVTU5TLmNyZWF0ZWRBdE1zKSBxdWVyeSA9IHF1ZXJ5Lm9yZGVyKHtjb2x1bW46IFNPUlRBQkxFX0NPTFVNTlMuY3JlYXRlZEF0TXMsIGRpcmVjdGlvbjogXCJERVNDXCJ9KVxuXG4gICAgICBjb25zdCByb3dzID0gYXdhaXQgcXVlcnkubGltaXQobGltaXQpLm9mZnNldChvZmZzZXQpLnJlc3VsdHMoKVxuXG4gICAgICByZXR1cm4gcm93cy5tYXAoKHJvdykgPT4gdGhpcy5fbm9ybWFsaXplSm9iUm93KHJvdykpXG4gICAgfSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIG1hcmsgaGFuZGVkIG9mZi5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBPcHRpb25zLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gYXJncy5qb2JJZCAtIEpvYiBpZC5cbiAgICogQHBhcmFtIHtzdHJpbmd9IFthcmdzLmhhbmRvZmZJZF0gLSBDYWxsZXItc2VsZWN0ZWQgZXhhY3QgbGVhc2UgaWQuIEdlbmVyYXRlZCBmb3IgbGVnYWN5IGRpcmVjdCBjYWxsZXJzIHdoZW4gb21pdHRlZC5cbiAgICogQHBhcmFtIHtzdHJpbmd9IFthcmdzLndvcmtlcklkXSAtIFdvcmtlciBpZC5cbiAgICogQHJldHVybnMge1Byb21pc2U8aW1wb3J0KFwiLi90eXBlcy5qc1wiKS5CYWNrZ3JvdW5kSm9iSGFuZG9mZiB8IG51bGw+fSAtIENsYWltZWQgaGFuZG9mZiBsZWFzZSwgb3IgbnVsbCB3aGVuIG5vIGxvbmdlciBxdWV1ZWQuXG4gICAqL1xuICBhc3luYyBtYXJrSGFuZGVkT2ZmKHtqb2JJZCwgaGFuZG9mZklkID0gcmFuZG9tVVVJRCgpLCB3b3JrZXJJZH0pIHtcbiAgICBhd2FpdCB0aGlzLmVuc3VyZVJlYWR5KClcblxuICAgIGNvbnN0IGhhbmRlZE9mZkF0TXMgPSBEYXRlLm5vdygpXG5cbiAgICByZXR1cm4gYXdhaXQgdGhpcy5fc2VyaWFsaXplZENvdW50TXV0YXRpb24oYXN5bmMgKGRiKSA9PiB7XG4gICAgICBjb25zdCBxdWV1ZWRKb2IgPSBhd2FpdCB0aGlzLl9nZXRKb2JSb3dCeUlkKGRiLCBqb2JJZClcbiAgICAgIGlmICghcXVldWVkSm9iIHx8IHF1ZXVlZEpvYi5zdGF0dXMgIT09IFwicXVldWVkXCIpIHJldHVybiBudWxsXG4gICAgICBpZiAocXVldWVkSm9iLmNvbmN1cnJlbmN5S2V5ICYmICEoYXdhaXQgdGhpcy5fcmVzZXJ2ZUNvbmN1cnJlbmN5KGRiLCBxdWV1ZWRKb2IuY29uY3VycmVuY3lLZXkpKSkgcmV0dXJuIG51bGxcbiAgICAgIGNvbnN0IGFmZmVjdGVkUm93cyA9IGF3YWl0IHRoaXMuX3VwZGF0ZUFmZmVjdGVkUm93cyhkYiwge1xuICAgICAgICB0YWJsZU5hbWU6IEpPQlNfVEFCTEUsXG4gICAgICAgIGRhdGE6IHtcbiAgICAgICAgICBzdGF0dXM6IFwiaGFuZGVkX29mZlwiLFxuICAgICAgICAgIGhhbmRlZF9vZmZfYXRfbXM6IGhhbmRlZE9mZkF0TXMsXG4gICAgICAgICAgaGFuZG9mZl9pZDogaGFuZG9mZklkLFxuICAgICAgICAgIHdvcmtlcl9pZDogd29ya2VySWQgfHwgbnVsbFxuICAgICAgICB9LFxuICAgICAgICBjb25kaXRpb25zOiB7aWQ6IGpvYklkLCBzdGF0dXM6IFwicXVldWVkXCJ9XG4gICAgICB9KVxuXG4gICAgICBpZiAoYWZmZWN0ZWRSb3dzICE9PSAxKSB7XG4gICAgICAgIGF3YWl0IHRoaXMuX3JlbGVhc2VDb25jdXJyZW5jeShkYiwgcXVldWVkSm9iLmNvbmN1cnJlbmN5S2V5KVxuICAgICAgICByZXR1cm4gbnVsbFxuICAgICAgfVxuXG4gICAgICBhd2FpdCB0aGlzLl9yZWNvcmRTdGF0dXNUcmFuc2l0aW9uKGRiLCBcInF1ZXVlZFwiLCBcImhhbmRlZF9vZmZcIilcbiAgICAgIHJldHVybiB7aGFuZGVkT2ZmQXRNcywgaGFuZG9mZklkfVxuICAgIH0pXG4gIH1cblxuICAvKipcbiAgICogUnVucyBtYXJrIGNvbXBsZXRlZC5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBPcHRpb25zLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gYXJncy5qb2JJZCAtIEpvYiBpZC5cbiAgICogQHBhcmFtIHtzdHJpbmd9IFthcmdzLmhhbmRvZmZJZF0gLSBIYW5kb2ZmIGxlYXNlIGlkLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gW2FyZ3Mud29ya2VySWRdIC0gV29ya2VyIGlkLlxuICAgKiBAcGFyYW0ge251bWJlcn0gW2FyZ3MuaGFuZGVkT2ZmQXRNc10gLSBIYW5kZWQgb2ZmIHRpbWVzdGFtcC5cbiAgICogQHJldHVybnMge1Byb21pc2U8Ym9vbGVhbj59IC0gV2hldGhlciB0aGUgZmVuY2VkIHJlcG9ydCB3YXMgYWNjZXB0ZWQuXG4gICAqL1xuICBhc3luYyBtYXJrQ29tcGxldGVkKHtqb2JJZCwgaGFuZG9mZklkLCB3b3JrZXJJZCwgaGFuZGVkT2ZmQXRNc30pIHtcbiAgICBhd2FpdCB0aGlzLmVuc3VyZVJlYWR5KClcblxuICAgIHJldHVybiBhd2FpdCB0aGlzLl9zZXJpYWxpemVkQ291bnRNdXRhdGlvbihhc3luYyAoZGIpID0+IHtcbiAgICAgIGNvbnN0IGpvYiA9IGF3YWl0IHRoaXMuX2dldEpvYlJvd0J5SWQoZGIsIGpvYklkKVxuXG4gICAgICBpZiAoIWpvYikgcmV0dXJuIGZhbHNlXG4gICAgICBpZiAoIXRoaXMuX3Nob3VsZEFjY2VwdFJlcG9ydCh7am9iLCBoYW5kb2ZmSWQsIHdvcmtlcklkLCBoYW5kZWRPZmZBdE1zfSkpIHJldHVybiBmYWxzZVxuXG4gICAgICBhd2FpdCB0aGlzLl9sb2NrQ29uY3VycmVuY3lSb3coZGIsIGpvYi5jb25jdXJyZW5jeUtleSlcbiAgICAgIGNvbnN0IGFmZmVjdGVkUm93cyA9IGF3YWl0IHRoaXMuX3VwZGF0ZUFmZmVjdGVkUm93cyhkYiwge1xuICAgICAgICB0YWJsZU5hbWU6IEpPQlNfVEFCTEUsXG4gICAgICAgIGRhdGE6IHtcbiAgICAgICAgICBzdGF0dXM6IFwiY29tcGxldGVkXCIsXG4gICAgICAgICAgY29tcGxldGVkX2F0X21zOiBEYXRlLm5vdygpXG4gICAgICAgIH0sXG4gICAgICAgIGNvbmRpdGlvbnM6IHRoaXMuX2FjdGl2ZUhhbmRvZmZDb25kaXRpb25zKGpvYilcbiAgICAgIH0pXG5cbiAgICAgIGlmIChhZmZlY3RlZFJvd3MgIT09IDEpIHJldHVybiBmYWxzZVxuICAgICAgYXdhaXQgdGhpcy5fcmVsZWFzZVNjaGVkdWxlT3duZXJzaGlwRm9ySm9iKGRiLCBqb2IpXG4gICAgICBhd2FpdCB0aGlzLl9yZWxlYXNlQ29uY3VycmVuY3koZGIsIGpvYi5jb25jdXJyZW5jeUtleSlcbiAgICAgIGF3YWl0IHRoaXMuX3JlY29yZFN0YXR1c1RyYW5zaXRpb24oZGIsIFwiaGFuZGVkX29mZlwiLCBcImNvbXBsZXRlZFwiKVxuICAgICAgcmV0dXJuIHRydWVcbiAgICB9KVxuICB9XG5cbiAgLyoqXG4gICAqIFJldHVybnMgYW4gYWN0aXZlIGhhbmRvZmYgdG8gdGhlIHF1ZXVlIGF0IGEgY2FsbGVyLXJlcXVlc3RlZCBmdXR1cmUgdGltZS5cbiAgICogVGhpcyBpcyBub3JtYWwgam9iIGNvbnRyb2wgZmxvdzogaXQgcHJlc2VydmVzIGZhaWx1cmUgYXR0ZW1wdHMgYW5kIG1ldGFkYXRhLlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIE9wdGlvbnMuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBhcmdzLmpvYklkIC0gSm9iIGlkLlxuICAgKiBAcGFyYW0ge251bWJlcn0gYXJncy5kZWxheU1zIC0gRGVsYXkgZnJvbSBwZXJzaXN0ZW5jZSB0aW1lIGluIG1pbGxpc2Vjb25kcy5cbiAgICogQHBhcmFtIHtzdHJpbmd9IFthcmdzLmhhbmRvZmZJZF0gLSBIYW5kb2ZmIGxlYXNlIGlkLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gW2FyZ3Mud29ya2VySWRdIC0gV29ya2VyIGlkLlxuICAgKiBAcGFyYW0ge251bWJlcn0gW2FyZ3MuaGFuZGVkT2ZmQXRNc10gLSBIYW5kZWQgb2ZmIHRpbWVzdGFtcC5cbiAgICogQHJldHVybnMge1Byb21pc2U8Ym9vbGVhbj59IC0gV2hldGhlciB0aGUgZmVuY2VkIHJlcG9ydCB3YXMgYWNjZXB0ZWQuXG4gICAqL1xuICBhc3luYyBtYXJrUmVzY2hlZHVsZWQoe2pvYklkLCBkZWxheU1zLCBoYW5kb2ZmSWQsIHdvcmtlcklkLCBoYW5kZWRPZmZBdE1zfSkge1xuICAgIGF3YWl0IHRoaXMuZW5zdXJlUmVhZHkoKVxuICAgIHRoaXMuX3ZhbGlkYXRlUmVzY2hlZHVsZURlbGF5TXMoZGVsYXlNcylcblxuICAgIHJldHVybiBhd2FpdCB0aGlzLl9zZXJpYWxpemVkQ291bnRNdXRhdGlvbihhc3luYyAoZGIpID0+IHtcbiAgICAgIGNvbnN0IGpvYiA9IGF3YWl0IHRoaXMuX2dldEpvYlJvd0J5SWQoZGIsIGpvYklkKVxuXG4gICAgICBpZiAoIWpvYikgcmV0dXJuIGZhbHNlXG4gICAgICBpZiAoIXRoaXMuX3Nob3VsZEFjY2VwdFJlcG9ydCh7am9iLCBoYW5kb2ZmSWQsIHdvcmtlcklkLCBoYW5kZWRPZmZBdE1zfSkpIHJldHVybiBmYWxzZVxuXG4gICAgICBhd2FpdCB0aGlzLl9sb2NrQ29uY3VycmVuY3lSb3coZGIsIGpvYi5jb25jdXJyZW5jeUtleSlcbiAgICAgIGNvbnN0IHNjaGVkdWxlZEF0TXMgPSB0aGlzLl9yZXNjaGVkdWxlZEF0TXMoZGVsYXlNcylcbiAgICAgIGNvbnN0IGFmZmVjdGVkUm93cyA9IGF3YWl0IHRoaXMuX3VwZGF0ZUFmZmVjdGVkUm93cyhkYiwge1xuICAgICAgICB0YWJsZU5hbWU6IEpPQlNfVEFCTEUsXG4gICAgICAgIGRhdGE6IHtcbiAgICAgICAgICBzdGF0dXM6IFwicXVldWVkXCIsXG4gICAgICAgICAgc2NoZWR1bGVkX2F0X21zOiBzY2hlZHVsZWRBdE1zLFxuICAgICAgICAgIGhhbmRlZF9vZmZfYXRfbXM6IG51bGwsXG4gICAgICAgICAgaGFuZG9mZl9pZDogbnVsbCxcbiAgICAgICAgICB3b3JrZXJfaWQ6IG51bGxcbiAgICAgICAgfSxcbiAgICAgICAgY29uZGl0aW9uczogdGhpcy5fYWN0aXZlSGFuZG9mZkNvbmRpdGlvbnMoam9iKVxuICAgICAgfSlcblxuICAgICAgaWYgKGFmZmVjdGVkUm93cyAhPT0gMSkgcmV0dXJuIGZhbHNlXG4gICAgICBhd2FpdCB0aGlzLl9yZWxlYXNlQ29uY3VycmVuY3koZGIsIGpvYi5jb25jdXJyZW5jeUtleSlcbiAgICAgIGF3YWl0IHRoaXMuX3JlY29yZFN0YXR1c1RyYW5zaXRpb24oZGIsIFwiaGFuZGVkX29mZlwiLCBcInF1ZXVlZFwiKVxuICAgICAgcmV0dXJuIHRydWVcbiAgICB9KVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgbWFyayByZXR1cm5lZCB0byBxdWV1ZS5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBPcHRpb25zLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gYXJncy5qb2JJZCAtIEpvYiBpZC5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGFyZ3MuaGFuZG9mZklkIC0gSGFuZG9mZiBsZWFzZSBpZC5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgd2hlbiB1cGRhdGVkLlxuICAgKi9cbiAgYXN5bmMgbWFya1JldHVybmVkVG9RdWV1ZSh7am9iSWQsIGhhbmRvZmZJZH0pIHtcbiAgICBhd2FpdCB0aGlzLmVuc3VyZVJlYWR5KClcblxuICAgIGF3YWl0IHRoaXMuX3NlcmlhbGl6ZWRDb3VudE11dGF0aW9uKGFzeW5jIChkYikgPT4ge1xuICAgICAgY29uc3Qgam9iID0gYXdhaXQgdGhpcy5fZ2V0Sm9iUm93QnlJZChkYiwgam9iSWQpXG4gICAgICBpZiAoIWpvYiB8fCBqb2IuaGFuZG9mZklkICE9PSBoYW5kb2ZmSWQgfHwgam9iLnN0YXR1cyAhPT0gXCJoYW5kZWRfb2ZmXCIpIHJldHVyblxuICAgICAgYXdhaXQgdGhpcy5fbG9ja0NvbmN1cnJlbmN5Um93KGRiLCBqb2IuY29uY3VycmVuY3lLZXkpXG4gICAgICBjb25zdCBhZmZlY3RlZFJvd3MgPSBhd2FpdCB0aGlzLl91cGRhdGVBZmZlY3RlZFJvd3MoZGIsIHtcbiAgICAgICAgdGFibGVOYW1lOiBKT0JTX1RBQkxFLFxuICAgICAgICBkYXRhOiB7XG4gICAgICAgICAgc3RhdHVzOiBcInF1ZXVlZFwiLFxuICAgICAgICAgIHNjaGVkdWxlZF9hdF9tczogRGF0ZS5ub3coKSxcbiAgICAgICAgICBoYW5kZWRfb2ZmX2F0X21zOiBudWxsLFxuICAgICAgICAgIGhhbmRvZmZfaWQ6IG51bGwsXG4gICAgICAgICAgd29ya2VyX2lkOiBudWxsXG4gICAgICAgIH0sXG4gICAgICAgIGNvbmRpdGlvbnM6IHtoYW5kb2ZmX2lkOiBoYW5kb2ZmSWQsIGlkOiBqb2JJZCwgc3RhdHVzOiBcImhhbmRlZF9vZmZcIn1cbiAgICAgIH0pXG4gICAgICBpZiAoYWZmZWN0ZWRSb3dzID09PSAxKSB7XG4gICAgICAgIGF3YWl0IHRoaXMuX3JlbGVhc2VDb25jdXJyZW5jeShkYiwgam9iLmNvbmN1cnJlbmN5S2V5KVxuICAgICAgICBhd2FpdCB0aGlzLl9yZWNvcmRTdGF0dXNUcmFuc2l0aW9uKGRiLCBcImhhbmRlZF9vZmZcIiwgXCJxdWV1ZWRcIilcbiAgICAgIH1cbiAgICB9KVxuICB9XG5cbiAgLyoqXG4gICAqIFJldHVybnMgdGhlIGFjdGl2ZSBgaGFuZGVkX29mZmAgam9icyAoam9iSWQgKyBoYW5kb2ZmSWQpIGhlbGQgdW5kZXIgYSB3b3JrZXJcbiAgICogaWQuIFVzZWQgb24gd29ya2VyIHJlY29ubmVjdDogYWZ0ZXIgYSBtYWluIHJlc3RhcnQgYSB3b3JrZXIgcmVjb25uZWN0cyB3aXRoXG4gICAqIGl0cyBzdGFibGUgaWQsIGFuZCB0aGUgZnJlc2ggbWFpbiBhZG9wdHMgdGhlc2UgbGVhc2VzIHNvIHRoZXkgYXJlIHRyYWNrZWQg4oCUXG4gICAqIGFuZCByZWxlYXNlZCBpZiB0aGUgcmVjb25uZWN0ZWQgd29ya2VyIGxhdGVyIGRpc2Nvbm5lY3RzIOKAlCBpbnN0ZWFkIG9mXG4gICAqIHNpdHRpbmcgc3R1Y2sgdW50aWwgdGhlIGFnZS1iYXNlZCBvcnBoYW4gc3dlZXAuIFRoaXMgbmV2ZXIgcmVjbGFpbXMsIHNvIGFcbiAgICogZ3JhY2VmdWxseS1kcmFpbmluZyB3b3JrZXIgdGhhdCBrZWVwcyBydW5uaW5nIGl0cyBpbi1mbGlnaHQgam9icyBpcyBsZWZ0XG4gICAqIHVudG91Y2hlZC4gUm93cyB3aXRoIGEgbnVsbCBoYW5kb2ZmIGlkIChsZWdhY3kpIGFyZSBza2lwcGVkOyB0aGUgb3JwaGFuXG4gICAqIHN3ZWVwIHJlY2xhaW1zIHRob3NlIHZpYSBpdHMgYGhhbmRlZF9vZmZfYXRfbXNgIGZlbmNlLlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIE9wdGlvbnMuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBhcmdzLndvcmtlcklkIC0gV29ya2VyIGlkLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxBcnJheTx7am9iSWQ6IHN0cmluZywgaGFuZG9mZklkOiBzdHJpbmd9Pj59IC0gQWN0aXZlIGhhbmRvZmZzLlxuICAgKi9cbiAgYXN5bmMgaGFuZGVkT2ZmSm9ic0Zvcldvcmtlcih7d29ya2VySWR9KSB7XG4gICAgYXdhaXQgdGhpcy5lbnN1cmVSZWFkeSgpXG5cbiAgICBjb25zdCByb3dzID0gYXdhaXQgdGhpcy5fd2l0aERiKGFzeW5jIChkYikgPT5cbiAgICAgIGF3YWl0IGRiLm5ld1F1ZXJ5KCkuZnJvbShKT0JTX1RBQkxFKS53aGVyZSh7c3RhdHVzOiBcImhhbmRlZF9vZmZcIiwgd29ya2VyX2lkOiB3b3JrZXJJZH0pLnJlc3VsdHMoKVxuICAgIClcblxuICAgIC8qKiBAdHlwZSB7QXJyYXk8e2pvYklkOiBzdHJpbmcsIGhhbmRvZmZJZDogc3RyaW5nfT59ICovXG4gICAgY29uc3QgaGFuZG9mZnMgPSBbXVxuXG4gICAgZm9yIChjb25zdCByb3cgb2Ygcm93cykge1xuICAgICAgY29uc3Qgam9iID0gdGhpcy5fbm9ybWFsaXplSm9iUm93KHJvdylcblxuICAgICAgaWYgKGpvYi5oYW5kb2ZmSWQpIGhhbmRvZmZzLnB1c2goe2pvYklkOiBqb2IuaWQsIGhhbmRvZmZJZDogam9iLmhhbmRvZmZJZH0pXG4gICAgfVxuXG4gICAgcmV0dXJuIGhhbmRvZmZzXG4gIH1cblxuICAvKipcbiAgICogU25hcHNob3RzIGV4YWN0LCBsZWFzZS1hd2FyZSBhY3RpdmUgaGFuZG9mZnMgYmVmb3JlIGEgbmV3IG1haW4gZ2VuZXJhdGlvblxuICAgKiBzdGFydHMgYWNjZXB0aW5nIHdvcmtlciByZWNvbm5lY3RzLiBMZWdhY3kgcm93cyB3aXRob3V0IGEgY29tcGxldGUgd29ya2VyLFxuICAgKiBsZWFzZSwgYW5kIHRpbWVzdGFtcCBpZGVudGl0eSBzdGF5IG93bmVkIGJ5IHRoZSBhZ2UtYmFzZWQgb3JwaGFuIHN3ZWVwLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxpbXBvcnQoXCIuL3R5cGVzLmpzXCIpLkJhY2tncm91bmRKb2JIYW5kb2ZmU25hcHNob3RbXT59IC0gRXhhY3Qgc3RhcnR1cCBoYW5kb2Zmcy5cbiAgICovXG4gIGFzeW5jIHNuYXBzaG90SGFuZGVkT2ZmSm9icygpIHtcbiAgICBhd2FpdCB0aGlzLmVuc3VyZVJlYWR5KClcblxuICAgIGNvbnN0IHJvd3MgPSBhd2FpdCB0aGlzLl93aXRoRGIoYXN5bmMgKGRiKSA9PiBhd2FpdCBkYlxuICAgICAgLm5ld1F1ZXJ5KClcbiAgICAgIC5mcm9tKEpPQlNfVEFCTEUpXG4gICAgICAud2hlcmUoe3N0YXR1czogXCJoYW5kZWRfb2ZmXCJ9KVxuICAgICAgLm9yZGVyKFwiY3JlYXRlZF9hdF9tcyBBU0NcIilcbiAgICAgIC5vcmRlcihcImlkIEFTQ1wiKVxuICAgICAgLnJlc3VsdHMoKSlcbiAgICAvKiogQHR5cGUge2ltcG9ydChcIi4vdHlwZXMuanNcIikuQmFja2dyb3VuZEpvYkhhbmRvZmZTbmFwc2hvdFtdfSAqL1xuICAgIGNvbnN0IGhhbmRvZmZzID0gW11cblxuICAgIGZvciAoY29uc3Qgcm93IG9mIHJvd3MpIHtcbiAgICAgIGNvbnN0IGpvYiA9IHRoaXMuX25vcm1hbGl6ZUpvYlJvdyhyb3cpXG5cbiAgICAgIGlmICgham9iLmhhbmRvZmZJZCB8fCAham9iLndvcmtlcklkIHx8IHR5cGVvZiBqb2IuaGFuZGVkT2ZmQXRNcyAhPT0gXCJudW1iZXJcIikgY29udGludWVcblxuICAgICAgaGFuZG9mZnMucHVzaCh7XG4gICAgICAgIGhhbmRlZE9mZkF0TXM6IGpvYi5oYW5kZWRPZmZBdE1zLFxuICAgICAgICBoYW5kb2ZmSWQ6IGpvYi5oYW5kb2ZmSWQsXG4gICAgICAgIGpvYklkOiBqb2IuaWQsXG4gICAgICAgIHdvcmtlcklkOiBqb2Iud29ya2VySWRcbiAgICAgIH0pXG4gICAgfVxuXG4gICAgcmV0dXJuIGhhbmRvZmZzXG4gIH1cblxuICAvKipcbiAgICogUmVjbGFpbXMgb25seSB1bmNoYW5nZWQgZXhhY3QgaGFuZG9mZnMgc2VsZWN0ZWQgYnkgYSBtYWluLWdlbmVyYXRpb24gc3RhcnR1cFxuICAgKiBzbmFwc2hvdC4gVGhlIG9yZGluYXJ5IG9ycGhhbiBmYWlsdXJlIHBhdGggb3ducyByZXRyaWVzLCB0ZXJtaW5hbCBzdGF0dXMsXG4gICAqIGNvdW50IHRyYW5zaXRpb25zLCBzY2hlZHVsZSBvd25lcnNoaXAsIGFuZCBjb25jdXJyZW5jeSByZWxlYXNlLlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIE9wdGlvbnMuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi90eXBlcy5qc1wiKS5CYWNrZ3JvdW5kSm9iSGFuZG9mZlNuYXBzaG90W119IGFyZ3MuaGFuZG9mZnMgLSBFeGFjdCBzdGFydHVwIHNuYXBzaG90cy5cbiAgICogQHBhcmFtIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gYXJncy5lcnJvciAtIE9ycGhhbiByZWFzb24uXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPGltcG9ydChcIi4vdHlwZXMuanNcIikuQmFja2dyb3VuZEpvYlJvd1tdPn0gLSBBY2NlcHRlZCB0cmFuc2l0aW9ucy5cbiAgICovXG4gIGFzeW5jIG1hcmtPcnBoYW5lZEhhbmRvZmZzKHtoYW5kb2ZmcywgZXJyb3J9KSB7XG4gICAgYXdhaXQgdGhpcy5lbnN1cmVSZWFkeSgpXG5cbiAgICByZXR1cm4gYXdhaXQgdGhpcy5fc2VyaWFsaXplZENvdW50TXV0YXRpb24oYXN5bmMgKGRiKSA9PiB7XG4gICAgICAvKiogQHR5cGUge0JhY2tncm91bmRKb2JPcnBoYW5TZWxlY3Rpb25bXX0gKi9cbiAgICAgIGNvbnN0IHNlbGVjdGlvbnMgPSBbXVxuXG4gICAgICBmb3IgKGNvbnN0IGhhbmRvZmYgb2YgaGFuZG9mZnMpIHtcbiAgICAgICAgY29uc3Qgam9iID0gYXdhaXQgdGhpcy5fZ2V0Sm9iUm93QnlJZChkYiwgaGFuZG9mZi5qb2JJZClcblxuICAgICAgICBpZiAoIWpvYiB8fCBqb2Iuc3RhdHVzICE9PSBcImhhbmRlZF9vZmZcIikgY29udGludWVcbiAgICAgICAgaWYgKGpvYi5oYW5kb2ZmSWQgIT09IGhhbmRvZmYuaGFuZG9mZklkKSBjb250aW51ZVxuICAgICAgICBpZiAoam9iLndvcmtlcklkICE9PSBoYW5kb2ZmLndvcmtlcklkKSBjb250aW51ZVxuICAgICAgICBpZiAoam9iLmhhbmRlZE9mZkF0TXMgIT09IGhhbmRvZmYuaGFuZGVkT2ZmQXRNcykgY29udGludWVcblxuICAgICAgICBzZWxlY3Rpb25zLnB1c2goe1xuICAgICAgICAgIGNvbmRpdGlvbnM6IHtcbiAgICAgICAgICAgIGhhbmRlZF9vZmZfYXRfbXM6IGhhbmRvZmYuaGFuZGVkT2ZmQXRNcyxcbiAgICAgICAgICAgIGhhbmRvZmZfaWQ6IGhhbmRvZmYuaGFuZG9mZklkLFxuICAgICAgICAgICAgaWQ6IGhhbmRvZmYuam9iSWQsXG4gICAgICAgICAgICBzdGF0dXM6IFwiaGFuZGVkX29mZlwiLFxuICAgICAgICAgICAgd29ya2VyX2lkOiBoYW5kb2ZmLndvcmtlcklkXG4gICAgICAgICAgfSxcbiAgICAgICAgICBqb2JcbiAgICAgICAgfSlcbiAgICAgIH1cblxuICAgICAgcmV0dXJuIGF3YWl0IHRoaXMuX21hcmtPcnBoYW5TZWxlY3Rpb25zKHtkYiwgZXJyb3IsIHNlbGVjdGlvbnN9KVxuICAgIH0pXG4gIH1cblxuICAvKipcbiAgICogUnVucyBtYXJrIGZhaWxlZC5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBPcHRpb25zLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gYXJncy5qb2JJZCAtIEpvYiBpZC5cbiAgICogQHBhcmFtIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gYXJncy5lcnJvciAtIEVycm9yLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gW2FyZ3MuaGFuZG9mZklkXSAtIEhhbmRvZmYgbGVhc2UgaWQuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBbYXJncy53b3JrZXJJZF0gLSBXb3JrZXIgaWQuXG4gICAqIEBwYXJhbSB7bnVtYmVyfSBbYXJncy5oYW5kZWRPZmZBdE1zXSAtIEhhbmRlZCBvZmYgdGltZXN0YW1wLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxpbXBvcnQoXCIuL3R5cGVzLmpzXCIpLkJhY2tncm91bmRKb2JSb3cgfCBudWxsPn0gLSBVcGRhdGVkIGpvYiByb3cgd2hlbiB0aGUgcmVwb3J0IHdhcyBhY2NlcHRlZC5cbiAgICovXG4gIGFzeW5jIG1hcmtGYWlsZWQoe2pvYklkLCBlcnJvciwgaGFuZG9mZklkLCB3b3JrZXJJZCwgaGFuZGVkT2ZmQXRNc30pIHtcbiAgICBhd2FpdCB0aGlzLmVuc3VyZVJlYWR5KClcblxuICAgIHJldHVybiBhd2FpdCB0aGlzLl9zZXJpYWxpemVkQ291bnRNdXRhdGlvbihhc3luYyAoZGIpID0+IHtcbiAgICAgIGNvbnN0IGpvYiA9IGF3YWl0IHRoaXMuX2dldEpvYlJvd0J5SWQoZGIsIGpvYklkKVxuXG4gICAgICBpZiAoIWpvYikgcmV0dXJuIG51bGxcbiAgICAgIGlmICghdGhpcy5fc2hvdWxkQWNjZXB0UmVwb3J0KHtqb2IsIGhhbmRvZmZJZCwgd29ya2VySWQsIGhhbmRlZE9mZkF0TXN9KSkgcmV0dXJuIG51bGxcblxuICAgICAgY29uc3QgdXBkYXRlZEpvYiA9IGF3YWl0IHRoaXMuX2FwcGx5RmFpbHVyZSh7ZGIsIGpvYiwgZXJyb3IsIG1hcmtPcnBoYW5lZDogZmFsc2V9KVxuXG4gICAgICBpZiAodXBkYXRlZEpvYikgYXdhaXQgdGhpcy5fcmVjb3JkU3RhdHVzVHJhbnNpdGlvbihkYiwgam9iLnN0YXR1cywgdXBkYXRlZEpvYi5zdGF0dXMpXG4gICAgICByZXR1cm4gdXBkYXRlZEpvYlxuICAgIH0pXG4gIH1cblxuICAvKipcbiAgICogUnVucyBtYXJrIG9ycGhhbmVkIGpvYnMuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBbYXJnc10gLSBPcHRpb25zLlxuICAgKiBAcGFyYW0ge251bWJlcn0gW2FyZ3Mub3JwaGFuZWRBZnRlck1zXSAtIE1hcmsgam9icyBvcnBoYW5lZCBhZnRlciB0aGlzIGR1cmF0aW9uLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxpbXBvcnQoXCIuL3R5cGVzLmpzXCIpLkJhY2tncm91bmRKb2JSb3dbXT59IC0gVGhlIGpvYnMgdGhpcyBzd2VlcCBtYXJrZWQgb3JwaGFuZWQuXG4gICAqL1xuICBhc3luYyBtYXJrT3JwaGFuZWRKb2JzKHtvcnBoYW5lZEFmdGVyTXMgPSBPUlBIQU5FRF9BRlRFUl9NU30gPSB7fSkge1xuICAgIGF3YWl0IHRoaXMuZW5zdXJlUmVhZHkoKVxuXG4gICAgcmV0dXJuIGF3YWl0IHRoaXMuX3NlcmlhbGl6ZWRDb3VudE11dGF0aW9uKGFzeW5jIChkYikgPT4ge1xuICAgICAgY29uc3QgY3V0b2ZmID0gRGF0ZS5ub3coKSAtIG9ycGhhbmVkQWZ0ZXJNc1xuICAgICAgY29uc3QgcXVlcnkgPSBkYlxuICAgICAgICAubmV3UXVlcnkoKVxuICAgICAgICAuZnJvbShKT0JTX1RBQkxFKVxuICAgICAgICAud2hlcmUoe3N0YXR1czogXCJoYW5kZWRfb2ZmXCJ9KVxuICAgICAgICAud2hlcmUoYGhhbmRlZF9vZmZfYXRfbXMgPD0gJHtkYi5xdW90ZShjdXRvZmYpfWApXG5cbiAgICAgIGNvbnN0IHJvd3MgPSBhd2FpdCBxdWVyeS5yZXN1bHRzKClcblxuICAgICAgLyoqIEB0eXBlIHtCYWNrZ3JvdW5kSm9iT3JwaGFuU2VsZWN0aW9uW119ICovXG4gICAgICBjb25zdCBzZWxlY3Rpb25zID0gW11cblxuICAgICAgZm9yIChjb25zdCByb3cgb2Ygcm93cykge1xuICAgICAgICBjb25zdCBqb2IgPSB0aGlzLl9ub3JtYWxpemVKb2JSb3cocm93KVxuXG4gICAgICAgIC8vIEZlbmNlIHRoZSByZWNsYWltIG9uIHRoZSBleGFjdCBoYW5kb2ZmIHRoaXMgc3dlZXAgc2VsZWN0ZWQsIHVzaW5nIGl0c1xuICAgICAgICAvLyBgaGFuZGVkX29mZl9hdF9tc2AgcmF0aGVyIHRoYW4gaXRzIGBoYW5kb2ZmX2lkYC4gVHdvIHJlYXNvbnM6XG4gICAgICAgIC8vICAgMS4gTnVsbC1zYWZlLiBTb21lIHJvd3MgaGF2ZSBhIG51bGwgYGhhbmRvZmZfaWRgIChoYW5kZWQgb2ZmIGJ5IGFuXG4gICAgICAgIC8vICAgICAgb2xkZXIgdmVsb2Npb3VzIGJlZm9yZSBoYW5kb2ZmLWlkIGZlbmNpbmcpLiBge2hhbmRvZmZfaWQ6IG51bGx9YFxuICAgICAgICAvLyAgICAgIHJlbmRlcnMgYXMgYGhhbmRvZmZfaWQgPSBOVUxMYCwgd2hpY2ggbWF0Y2hlcyBub3RoaW5nLCBzbyB0aG9zZVxuICAgICAgICAvLyAgICAgIHJvd3Mgd291bGQgYmUgc3RyYW5kZWQgaW4gYGhhbmRlZF9vZmZgIGZvcmV2ZXIuXG4gICAgICAgIC8vICAgMi4gUmFjZS1zYWZlLiBJZiB0aGUgcm93IGlzIHJldHVybmVkIHRvIHRoZSBxdWV1ZSBhbmQgcmUtaGFuZGVkLW9mZlxuICAgICAgICAvLyAgICAgIGJldHdlZW4gdGhlIFNFTEVDVCBhYm92ZSBhbmQgdGhpcyB1cGRhdGUsIGl0IGdldHMgYSBmcmVzaFxuICAgICAgICAvLyAgICAgIGBoYW5kZWRfb2ZmX2F0X21zYCAoYWx3YXlzIFwibm93XCIpLCBzbyB0aGlzIHN0YWxlIGN1dG9mZi1lcmFcbiAgICAgICAgLy8gICAgICB0aW1lc3RhbXAgbm8gbG9uZ2VyIG1hdGNoZXMgYW5kIHdlIHdvbid0IGZhaWwvb3JwaGFuIOKAlCBvclxuICAgICAgICAvLyAgICAgIHdyb25nbHkgcmVsZWFzZSB0aGUgY29uY3VycmVuY3kgcmVzZXJ2YXRpb24gb2Yg4oCUIHRoYXQgbmV3IGxlYXNlLlxuICAgICAgICAvLyBgaGFuZGVkX29mZl9hdF9tc2AgaXMgYWx3YXlzIHNldCBvbiBhIGhhbmRlZC1vZmYgcm93IChhbmQgdGhlIFNFTEVDVFxuICAgICAgICAvLyByZXF1aXJlZCBpdCBgPD0gY3V0b2ZmYCksIHNvIGl0IGlzIGEgcmVsaWFibGUgbnVsbC1zYWZlIGxlYXNlIHBpbi5cbiAgICAgICAgc2VsZWN0aW9ucy5wdXNoKHtcbiAgICAgICAgICBjb25kaXRpb25zOiB7aWQ6IGpvYi5pZCwgc3RhdHVzOiBcImhhbmRlZF9vZmZcIiwgaGFuZGVkX29mZl9hdF9tczogam9iLmhhbmRlZE9mZkF0TXN9LFxuICAgICAgICAgIGpvYlxuICAgICAgICB9KVxuICAgICAgfVxuXG4gICAgICByZXR1cm4gYXdhaXQgdGhpcy5fbWFya09ycGhhblNlbGVjdGlvbnMoe1xuICAgICAgICBkYixcbiAgICAgICAgZXJyb3I6IFwiSm9iIG9ycGhhbmVkIGFmdGVyIHRpbWVvdXRcIixcbiAgICAgICAgc2VsZWN0aW9uc1xuICAgICAgfSlcbiAgICB9KVxuICB9XG5cbiAgLyoqXG4gICAqIEFwcGxpZXMgdGhlIGNvbW1vbiBmZW5jZWQgb3JwaGFuIHRyYW5zaXRpb24gYW5kIHJlY29yZHMgb25lIGFnZ3JlZ2F0ZSBjb3VudFxuICAgKiBkZWx0YSBmb3IgdGhlIGFjY2VwdGVkIHJvd3MuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gT3B0aW9ucy5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9kYXRhYmFzZS9kcml2ZXJzL2Jhc2UuanNcIikuZGVmYXVsdH0gYXJncy5kYiAtIFRyYW5zYWN0aW9uIGNvbm5lY3Rpb24uXG4gICAqIEBwYXJhbSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59IGFyZ3MuZXJyb3IgLSBPcnBoYW4gcmVhc29uLlxuICAgKiBAcGFyYW0ge0JhY2tncm91bmRKb2JPcnBoYW5TZWxlY3Rpb25bXX0gYXJncy5zZWxlY3Rpb25zIC0gU2VsZWN0ZWQgaGFuZG9mZnMgYW5kIGV4YWN0IGZlbmNlcy5cbiAgICogQHJldHVybnMge1Byb21pc2U8aW1wb3J0KFwiLi90eXBlcy5qc1wiKS5CYWNrZ3JvdW5kSm9iUm93W10+fSAtIEFjY2VwdGVkIHRyYW5zaXRpb25zLlxuICAgKi9cbiAgYXN5bmMgX21hcmtPcnBoYW5TZWxlY3Rpb25zKHtkYiwgZXJyb3IsIHNlbGVjdGlvbnN9KSB7XG4gICAgLyoqIEB0eXBlIHtpbXBvcnQoXCIuL3R5cGVzLmpzXCIpLkJhY2tncm91bmRKb2JSb3dbXX0gKi9cbiAgICBjb25zdCBvcnBoYW5lZEpvYnMgPSBbXVxuXG4gICAgZm9yIChjb25zdCB7Y29uZGl0aW9ucywgam9ifSBvZiBzZWxlY3Rpb25zKSB7XG4gICAgICBjb25zdCBvcnBoYW5lZEpvYiA9IGF3YWl0IHRoaXMuX2FwcGx5RmFpbHVyZSh7XG4gICAgICAgIGNvbmRpdGlvbnMsXG4gICAgICAgIGRiLFxuICAgICAgICBlcnJvcixcbiAgICAgICAgam9iLFxuICAgICAgICBtYXJrT3JwaGFuZWQ6IHRydWVcbiAgICAgIH0pXG5cbiAgICAgIGlmIChvcnBoYW5lZEpvYikgb3JwaGFuZWRKb2JzLnB1c2gob3JwaGFuZWRKb2IpXG4gICAgfVxuXG4gICAgY29uc3Qgc3RhdHVzQ291bnRzID0gdGhpcy5fc3RhdHVzQ291bnRzKG9ycGhhbmVkSm9icylcbiAgICBjb25zdCBkZWx0YXMgPSB0aGlzLl9lbXB0eUNvdW50QnVja2V0cygpXG5cbiAgICBmb3IgKGNvbnN0IFtzdGF0dXMsIGNvdW50XSBvZiBPYmplY3QuZW50cmllcyhzdGF0dXNDb3VudHMpKSB7XG4gICAgICBkZWx0YXMuaGFuZGVkX29mZiAtPSBjb3VudFxuICAgICAgZGVsdGFzW3N0YXR1c10gKz0gY291bnRcbiAgICB9XG4gICAgYXdhaXQgdGhpcy5fcmVjb3JkQ291bnREZWx0YShkYiwgZGVsdGFzKVxuXG4gICAgcmV0dXJuIG9ycGhhbmVkSm9ic1xuICB9XG5cbiAgLyoqXG4gICAqIERlbGV0ZXMgdGVybWluYWwgam9iIHJvd3MgcGFzdCB0aGVpciByZXRlbnRpb24gd2luZG93IHNvIHRoZSBqb2JzIHRhYmxlXG4gICAqIGRvZXMgbm90IGdyb3cgdW5ib3VuZGVkIChjb21wbGV0ZWQgcm93cyBpbiBwYXJ0aWN1bGFyIGFjY3VtdWxhdGUgZm9yZXZlclxuICAgKiBvdGhlcndpc2UpLiBCYXRjaGVkIGJ5IGlkIOKAlCBTRUxFQ1QgYSBwYWdlIG9mIGlkcywgdGhlblxuICAgKiBgREVMRVRFIC4uLiBXSEVSRSBpZCBJTiAoLi4uKWAg4oCUIHJhdGhlciB0aGFuIGBERUxFVEUgLi4uIExJTUlUYCwgd2hpY2ggbm90XG4gICAqIGV2ZXJ5IGRyaXZlciBzdXBwb3J0czsgZWFjaCBiYXRjaCBydW5zIG9uIGl0cyBvd24gY29ubmVjdGlvbiBzbyB0aGUgc3dlZXBcbiAgICogeWllbGRzIGJldHdlZW4gYmF0Y2hlcyBpbnN0ZWFkIG9mIGhvbGRpbmcgb25lIGxvbmcgdHJhbnNhY3Rpb24uXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBbYXJnc10gLSBPcHRpb25zLlxuICAgKiBAcGFyYW0ge251bWJlciB8IG51bGx9IFthcmdzLmNvbXBsZXRlZFR0bE1zXSAtIERlbGV0ZSBgY29tcGxldGVkYCBqb2JzIHdob3NlIGBjb21wbGV0ZWRfYXRfbXNgIGlzIG9sZGVyIHRoYW4gdGhpcyBtYW55IG1zLiBGYWxzeSBvciBgPD0gMGAgZGlzYWJsZXMgY29tcGxldGVkIHBydW5pbmcuXG4gICAqIEBwYXJhbSB7bnVtYmVyIHwgbnVsbH0gW2FyZ3MuZmFpbGVkVHRsTXNdIC0gRGVsZXRlIHRlcm1pbmFsIGBmYWlsZWRgL2BvcnBoYW5lZGAgam9icyBvbGRlciB0aGFuIHRoaXMgbWFueSBtcyAoYnkgYGZhaWxlZF9hdF9tc2AvYG9ycGhhbmVkX2F0X21zYCkuIEZhbHN5IG9yIGA8PSAwYCBkaXNhYmxlcy5cbiAgICogQHBhcmFtIHtudW1iZXJ9IFthcmdzLmJhdGNoU2l6ZV0gLSBNYXggcm93cyBkZWxldGVkIHBlciBiYXRjaC4gRGVmYXVsdCBgMTAwMGAuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPG51bWJlcj59IC0gVG90YWwgcm93cyBkZWxldGVkLlxuICAgKi9cbiAgYXN5bmMgcHJ1bmVUZXJtaW5hbEpvYnMoe2NvbXBsZXRlZFR0bE1zID0gbnVsbCwgZmFpbGVkVHRsTXMgPSBudWxsLCBiYXRjaFNpemUgPSAxMDAwfSA9IHt9KSB7XG4gICAgYXdhaXQgdGhpcy5lbnN1cmVSZWFkeSgpXG5cbiAgICBjb25zdCBub3cgPSBEYXRlLm5vdygpXG4gICAgY29uc3Qgc2l6ZSA9IGJhdGNoU2l6ZSA+IDAgPyBiYXRjaFNpemUgOiAxMDAwXG4gICAgbGV0IGRlbGV0ZWQgPSAwXG5cbiAgICBpZiAoY29tcGxldGVkVHRsTXMgJiYgY29tcGxldGVkVHRsTXMgPiAwKSB7XG4gICAgICBkZWxldGVkICs9IGF3YWl0IHRoaXMuX3BydW5lU3RhdHVzQmF0Y2hlcyh7c3RhdHVzOiBcImNvbXBsZXRlZFwiLCBjb2x1bW46IFwiY29tcGxldGVkX2F0X21zXCIsIGN1dG9mZjogbm93IC0gY29tcGxldGVkVHRsTXMsIGJhdGNoU2l6ZTogc2l6ZX0pXG4gICAgfVxuXG4gICAgaWYgKGZhaWxlZFR0bE1zICYmIGZhaWxlZFR0bE1zID4gMCkge1xuICAgICAgZGVsZXRlZCArPSBhd2FpdCB0aGlzLl9wcnVuZVN0YXR1c0JhdGNoZXMoe3N0YXR1czogXCJmYWlsZWRcIiwgY29sdW1uOiBcImZhaWxlZF9hdF9tc1wiLCBjdXRvZmY6IG5vdyAtIGZhaWxlZFR0bE1zLCBiYXRjaFNpemU6IHNpemV9KVxuICAgICAgZGVsZXRlZCArPSBhd2FpdCB0aGlzLl9wcnVuZVN0YXR1c0JhdGNoZXMoe3N0YXR1czogXCJvcnBoYW5lZFwiLCBjb2x1bW46IFwib3JwaGFuZWRfYXRfbXNcIiwgY3V0b2ZmOiBub3cgLSBmYWlsZWRUdGxNcywgYmF0Y2hTaXplOiBzaXplfSlcbiAgICB9XG5cbiAgICByZXR1cm4gZGVsZXRlZFxuICB9XG5cbiAgLyoqXG4gICAqIERlbGV0ZXMgcm93cyBvZiBvbmUgdGVybWluYWwgc3RhdHVzIG9sZGVyIHRoYW4gYSBjdXRvZmYsIGJhdGNoIGJ5IGJhdGNoLFxuICAgKiB1bnRpbCBhIHBhZ2UgcmV0dXJucyBmZXdlciB0aGFuIGBiYXRjaFNpemVgIHJvd3MuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gT3B0aW9ucy5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGFyZ3Muc3RhdHVzIC0gVGVybWluYWwgc3RhdHVzIHRvIHBydW5lLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gYXJncy5jb2x1bW4gLSBUaW1lc3RhbXAgY29sdW1uIGNvbXBhcmVkIGFnYWluc3QgdGhlIGN1dG9mZi5cbiAgICogQHBhcmFtIHtudW1iZXJ9IGFyZ3MuY3V0b2ZmIC0gRGVsZXRlIHJvd3Mgd2hvc2UgY29sdW1uIHZhbHVlIGlzIGA8PSBjdXRvZmZgLlxuICAgKiBAcGFyYW0ge251bWJlcn0gYXJncy5iYXRjaFNpemUgLSBNYXggcm93cyBwZXIgYmF0Y2guXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPG51bWJlcj59IC0gUm93cyBkZWxldGVkIGZvciB0aGlzIHN0YXR1cy5cbiAgICovXG4gIGFzeW5jIF9wcnVuZVN0YXR1c0JhdGNoZXMoe3N0YXR1cywgY29sdW1uLCBjdXRvZmYsIGJhdGNoU2l6ZX0pIHtcbiAgICBsZXQgZGVsZXRlZCA9IDBcblxuICAgIGZvciAoOzspIHtcbiAgICAgIGNvbnN0IHJlbW92ZWQgPSBhd2FpdCB0aGlzLl9zZXJpYWxpemVkQ291bnRNdXRhdGlvbihhc3luYyAoZGIpID0+IHtcbiAgICAgICAgY29uc3Qgcm93cyA9IGF3YWl0IGRiXG4gICAgICAgICAgLm5ld1F1ZXJ5KClcbiAgICAgICAgICAuZnJvbShKT0JTX1RBQkxFKVxuICAgICAgICAgIC5zZWxlY3QoXCJpZFwiKVxuICAgICAgICAgIC53aGVyZSh7c3RhdHVzfSlcbiAgICAgICAgICAud2hlcmUoYCR7ZGIucXVvdGVDb2x1bW4oY29sdW1uKX0gPD0gJHtkYi5xdW90ZShjdXRvZmYpfWApXG4gICAgICAgICAgLmxpbWl0KGJhdGNoU2l6ZSlcbiAgICAgICAgICAucmVzdWx0cygpXG5cbiAgICAgICAgaWYgKHJvd3MubGVuZ3RoID09PSAwKSByZXR1cm4gMFxuXG4gICAgICAgIGNvbnN0IGlkcyA9IHJvd3MubWFwKCgvKiogQHR5cGUge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gKi8gcm93KSA9PiBkYi5xdW90ZShTdHJpbmcocm93LmlkKSkpLmpvaW4oXCIsIFwiKVxuXG4gICAgICAgIGNvbnN0IHJlbW92ZWQgPSBhd2FpdCBkYi5hZmZlY3RlZFJvd3MoXG4gICAgICAgICAgYERFTEVURSBGUk9NICR7ZGIucXVvdGVUYWJsZShKT0JTX1RBQkxFKX0gV0hFUkUgJHtkYi5xdW90ZUNvbHVtbihcImlkXCIpfSBJTiAoJHtpZHN9KWBcbiAgICAgICAgKVxuXG4gICAgICAgIGF3YWl0IHRoaXMuX3JlY29yZENvdW50RGVsdGEoZGIsIHthbGw6IC1yZW1vdmVkLCBbc3RhdHVzXTogLXJlbW92ZWR9KVxuXG4gICAgICAgIHJldHVybiByZW1vdmVkXG4gICAgICB9KVxuXG4gICAgICBkZWxldGVkICs9IHJlbW92ZWRcbiAgICAgIGlmIChyZW1vdmVkIDwgYmF0Y2hTaXplKSBicmVha1xuICAgIH1cblxuICAgIHJldHVybiBkZWxldGVkXG4gIH1cblxuICAvKipcbiAgICogUnVucyBjbGVhciBhbGwuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIHdoZW4gY2xlYXJlZC5cbiAgICovXG4gIGFzeW5jIGNsZWFyQWxsKCkge1xuICAgIGF3YWl0IHRoaXMuZW5zdXJlUmVhZHkoKVxuXG4gICAgYXdhaXQgdGhpcy5fc2VyaWFsaXplZENvdW50TXV0YXRpb24oYXN5bmMgKGRiKSA9PiB7XG4gICAgICBjb25zdCBzbmFwc2hvdCA9IGF3YWl0IHRoaXMuX2NvdW50U25hcHNob3RPbkxvY2tlZENvbm5lY3Rpb24oZGIpXG4gICAgICBpZiAoYXdhaXQgZGIudGFibGVFeGlzdHMoTUFJTF9ERUxJVkVSWV9PUEVSQVRJT05TX1RBQkxFKSkgYXdhaXQgZGIucXVlcnkoYERFTEVURSBGUk9NICR7ZGIucXVvdGVUYWJsZShNQUlMX0RFTElWRVJZX09QRVJBVElPTlNfVEFCTEUpfWApXG4gICAgICBpZiAoYXdhaXQgZGIudGFibGVFeGlzdHMoSURFTVBPVEVOQ1lfS0VZU19UQUJMRSkpIGF3YWl0IGRiLnF1ZXJ5KGBERUxFVEUgRlJPTSAke2RiLnF1b3RlVGFibGUoSURFTVBPVEVOQ1lfS0VZU19UQUJMRSl9YClcbiAgICAgIGlmIChhd2FpdCBkYi50YWJsZUV4aXN0cyhTQ0hFRFVMRV9LRVlTX1RBQkxFKSkgYXdhaXQgZGIucXVlcnkoYERFTEVURSBGUk9NICR7ZGIucXVvdGVUYWJsZShTQ0hFRFVMRV9LRVlTX1RBQkxFKX1gKVxuICAgICAgYXdhaXQgZGIucXVlcnkoYERFTEVURSBGUk9NICR7ZGIucXVvdGVUYWJsZShKT0JTX1RBQkxFKX1gKVxuICAgICAgaWYgKGF3YWl0IGRiLnRhYmxlRXhpc3RzKENPTkNVUlJFTkNZX1RBQkxFKSkgYXdhaXQgZGIucXVlcnkoYERFTEVURSBGUk9NICR7ZGIucXVvdGVUYWJsZShDT05DVVJSRU5DWV9UQUJMRSl9YClcbiAgICAgIGNvbnN0IGRlbHRhcyA9IE9iamVjdC5mcm9tRW50cmllcyhPYmplY3QuZW50cmllcyhzbmFwc2hvdC5jb3VudHMpLm1hcCgoW2tleSwgdmFsdWVdKSA9PiBba2V5LCAtdmFsdWVdKSlcbiAgICAgIGF3YWl0IHRoaXMuX3JlY29yZENvdW50RGVsdGEoZGIsIGRlbHRhcylcbiAgICB9KVxuICB9XG5cbiAgLyoqXG4gICAqIENhbmNlbHMgYSBxdWV1ZWQgb3IgaGFuZGVkLW9mZiBqb2IgYW5kIHJlbGVhc2VzIGFueSBkdXJhYmxlIGNvbmN1cnJlbmN5IHJlc2VydmF0aW9uLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gam9iSWQgLSBKb2IgaWQuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPGJvb2xlYW4+fSAtIFdoZXRoZXIgdGhlIGpvYiB3YXMgY2FuY2VsbGVkLlxuICAgKi9cbiAgYXN5bmMgY2FuY2VsKGpvYklkKSB7XG4gICAgYXdhaXQgdGhpcy5lbnN1cmVSZWFkeSgpXG4gICAgcmV0dXJuIGF3YWl0IHRoaXMuX3NlcmlhbGl6ZWRDb3VudE11dGF0aW9uKGFzeW5jIChkYikgPT4ge1xuICAgICAgY29uc3Qgam9iID0gYXdhaXQgdGhpcy5fZ2V0Sm9iUm93QnlJZChkYiwgam9iSWQpXG4gICAgICBpZiAoIWpvYiB8fCAoam9iLnN0YXR1cyAhPT0gXCJxdWV1ZWRcIiAmJiBqb2Iuc3RhdHVzICE9PSBcImhhbmRlZF9vZmZcIikpIHJldHVybiBmYWxzZVxuICAgICAgLy8gT25seSBhIGhhbmRlZF9vZmYgam9iIGhvbGRzIGEgY29uY3VycmVuY3kgcmVzZXJ2YXRpb24sIHNvIG9ubHkgdGhhdCBjYXNlIHRvdWNoZXMgdGhlXG4gICAgICAvLyBzaGFyZWQgY291bnRlciByb3cgYW5kIG5lZWRzIHRoZSBjb25jdXJyZW5jeS10aGVuLWpvYiBsb2NrIG9yZGVyaW5nLlxuICAgICAgaWYgKGpvYi5zdGF0dXMgPT09IFwiaGFuZGVkX29mZlwiKSBhd2FpdCB0aGlzLl9sb2NrQ29uY3VycmVuY3lSb3coZGIsIGpvYi5jb25jdXJyZW5jeUtleSlcbiAgICAgIGNvbnN0IGFmZmVjdGVkUm93cyA9IGF3YWl0IHRoaXMuX3VwZGF0ZUFmZmVjdGVkUm93cyhkYiwge3RhYmxlTmFtZTogSk9CU19UQUJMRSwgZGF0YToge3N0YXR1czogXCJjYW5jZWxsZWRcIn0sIGNvbmRpdGlvbnM6IHtpZDogam9iLmlkLCBzdGF0dXM6IGpvYi5zdGF0dXN9fSlcbiAgICAgIGlmIChhZmZlY3RlZFJvd3MgIT09IDEpIHJldHVybiBmYWxzZVxuICAgICAgYXdhaXQgdGhpcy5fcmVsZWFzZVNjaGVkdWxlT3duZXJzaGlwRm9ySm9iKGRiLCBqb2IpXG4gICAgICBpZiAoam9iLnN0YXR1cyA9PT0gXCJoYW5kZWRfb2ZmXCIpIGF3YWl0IHRoaXMuX3JlbGVhc2VDb25jdXJyZW5jeShkYiwgam9iLmNvbmN1cnJlbmN5S2V5KVxuICAgICAgYXdhaXQgdGhpcy5fcmVjb3JkU3RhdHVzVHJhbnNpdGlvbihkYiwgam9iLnN0YXR1cywgXCJjYW5jZWxsZWRcIilcbiAgICAgIHJldHVybiB0cnVlXG4gICAgfSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGdldCByZXRyeSBkZWxheSBtcy5cbiAgICogQHBhcmFtIHtudW1iZXJ9IHJldHJ5Q291bnQgLSBSZXRyeSBhdHRlbXB0IGNvdW50ICgxLWJhc2VkKS5cbiAgICogQHJldHVybnMge251bWJlcn0gLSBEZWxheSBpbiBtaWxsaXNlY29uZHMuXG4gICAqL1xuICBnZXRSZXRyeURlbGF5TXMocmV0cnlDb3VudCkge1xuICAgIHJldHVybiByZXRyeURlbGF5TXMocmV0cnlDb3VudClcbiAgfVxuXG4gIC8qKlxuICAgKiBOb3JtYWxpemVzIG9uZSBuZXcgam9iIGJlZm9yZSBlbnRlcmluZyBpdHMgcGVyc2lzdGVuY2UgdHJhbnNhY3Rpb24uXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gSm9iIGlucHV0LlxuICAgKiBAcGFyYW0ge0FycmF5PFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gYXJncy5hcmdzIC0gSm9iIGFyZ3VtZW50cy5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGFyZ3Muam9iTmFtZSAtIEpvYiBuYW1lLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vdHlwZXMuanNcIikuQmFja2dyb3VuZEpvYk9wdGlvbnN9IFthcmdzLm9wdGlvbnNdIC0gSm9iIG9wdGlvbnMuXG4gICAqIEByZXR1cm5zIHtQcmVwYXJlZEJhY2tncm91bmRKb2J9IC0gUHJlcGFyZWQgam9iLlxuICAgKi9cbiAgX3ByZXBhcmVKb2Ioe2FyZ3MsIGpvYk5hbWUsIG9wdGlvbnN9KSB7XG4gICAgY29uc3QgY3JlYXRlZEF0TXMgPSBEYXRlLm5vdygpXG4gICAgY29uc3QgcXVldWUgPSB0aGlzLl9ub3JtYWxpemVRdWV1ZShvcHRpb25zKVxuXG4gICAgcmV0dXJuIHtcbiAgICAgIGFyZ3NKc29uOiBKU09OLnN0cmluZ2lmeShhcmdzIHx8IFtdKSxcbiAgICAgIGNvbmN1cnJlbmN5OiB0aGlzLl9yZXNvbHZlQ29uY3VycmVuY3kob3B0aW9ucywgcXVldWUpLFxuICAgICAgY3JlYXRlZEF0TXMsXG4gICAgICBleGVjdXRpb25Nb2RlOiB0aGlzLl9ub3JtYWxpemVFeGVjdXRpb25Nb2RlKG9wdGlvbnMpLFxuICAgICAgam9iSWQ6IHJhbmRvbVVVSUQoKSxcbiAgICAgIGpvYk5hbWUsXG4gICAgICBtYXhSZXRyaWVzOiB0aGlzLl9ub3JtYWxpemVNYXhSZXRyaWVzKG9wdGlvbnM/Lm1heFJldHJpZXMpLFxuICAgICAgcXVldWUsXG4gICAgICBzY2hlZHVsZWRBdE1zOiB0aGlzLl9ub3JtYWxpemVTY2hlZHVsZWRBdE1zKG9wdGlvbnM/LnNjaGVkdWxlZEF0TXMsIGNyZWF0ZWRBdE1zKSxcbiAgICAgIHRpbWVvdXRNczogdGhpcy5fbm9ybWFsaXplSm9iVGltZW91dE1zKG9wdGlvbnMpXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIE5vcm1hbGl6ZXMgYSBwZXItam9iIHRpbWVvdXQgd2hpbGUgcHJlc2VydmluZyBvbWl0dGVkICh3b3JrZXIgZmFsbGJhY2spXG4gICAqIHNlcGFyYXRlbHkgZnJvbSBleHBsaWNpdGx5IGRpc2FibGVkLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vdHlwZXMuanNcIikuQmFja2dyb3VuZEpvYk9wdGlvbnMgfCB1bmRlZmluZWR9IG9wdGlvbnMgLSBKb2Igb3B0aW9ucy5cbiAgICogQHJldHVybnMge251bWJlciB8IG51bGx9IC0gUG9zaXRpdmUgdGltZW91dCwgemVybyBmb3IgZGlzYWJsZWQsIG9yIG51bGwgd2hlbiBvbWl0dGVkLlxuICAgKi9cbiAgX25vcm1hbGl6ZUpvYlRpbWVvdXRNcyhvcHRpb25zKSB7XG4gICAgaWYgKG9wdGlvbnM/LnRpbWVvdXRNcyA9PT0gdW5kZWZpbmVkKSByZXR1cm4gbnVsbFxuXG4gICAgY29uc3QgdGltZW91dE1zID0gb3B0aW9ucy50aW1lb3V0TXNcblxuICAgIGlmICh0eXBlb2YgdGltZW91dE1zICE9PSBcIm51bWJlclwiIHx8ICFOdW1iZXIuaXNGaW5pdGUodGltZW91dE1zKSkge1xuICAgICAgdGhyb3cgVmVsb2Npb3VzRXJyb3Iuc2FmZShKT0JfVElNRU9VVF9WQUxJREFUSU9OX01FU1NBR0UpXG4gICAgfVxuXG4gICAgaWYgKHRpbWVvdXRNcyA8PSAwKSByZXR1cm4gMFxuXG4gICAgaWYgKCFOdW1iZXIuaXNJbnRlZ2VyKHRpbWVvdXRNcykgfHwgdGltZW91dE1zID4gTUFYX0pPQl9USU1FT1VUX01TKSB7XG4gICAgICB0aHJvdyBWZWxvY2lvdXNFcnJvci5zYWZlKEpPQl9USU1FT1VUX1ZBTElEQVRJT05fTUVTU0FHRSlcbiAgICB9XG5cbiAgICByZXR1cm4gdGltZW91dE1zXG4gIH1cblxuICAvKipcbiAgICogSW5zZXJ0cyBvbmUgcHJlcGFyZWQgcXVldWVkIGpvYiwgaW5jbHVkaW5nIGl0cyBjb25jdXJyZW5jeSByZWdpc3RyYXRpb24uXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vZGF0YWJhc2UvZHJpdmVycy9iYXNlLmpzXCIpLmRlZmF1bHR9IGRiIC0gRGF0YWJhc2UgY29ubmVjdGlvbi5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBJbnNlcnQgaW5wdXQuXG4gICAqIEBwYXJhbSB7UHJlcGFyZWRCYWNrZ3JvdW5kSm9ifSBhcmdzLnByZXBhcmVkSm9iIC0gUHJlcGFyZWQgam9iLlxuICAgKiBAcGFyYW0ge3N0cmluZyB8IG51bGx9IGFyZ3Muc2NoZWR1bGVLZXkgLSBIaXN0b3JpY2FsIHN0YWJsZSBrZXkuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIGFmdGVyIGluc2VydGlvbi5cbiAgICovXG4gIGFzeW5jIF9pbnNlcnRQcmVwYXJlZEpvYihkYiwge3ByZXBhcmVkSm9iLCBzY2hlZHVsZUtleX0pIHtcbiAgICBjb25zdCB7Y29uY3VycmVuY3l9ID0gcHJlcGFyZWRKb2JcblxuICAgIGlmIChjb25jdXJyZW5jeSkge1xuICAgICAgaWYgKGNvbmN1cnJlbmN5LnF1ZXVlRGVyaXZlZCkge1xuICAgICAgICBhd2FpdCB0aGlzLl9lbnN1cmVRdWV1ZUNvbmN1cnJlbmN5S2V5KGRiLCBjb25jdXJyZW5jeSlcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIGF3YWl0IHRoaXMuX2Vuc3VyZUNvbmN1cnJlbmN5S2V5KGRiLCBjb25jdXJyZW5jeSlcbiAgICAgIH1cbiAgICB9XG5cbiAgICBhd2FpdCBkYi5pbnNlcnQoe1xuICAgICAgdGFibGVOYW1lOiBKT0JTX1RBQkxFLFxuICAgICAgZGF0YToge1xuICAgICAgICBpZDogcHJlcGFyZWRKb2Iuam9iSWQsXG4gICAgICAgIGpvYl9uYW1lOiBwcmVwYXJlZEpvYi5qb2JOYW1lLFxuICAgICAgICBhcmdzX2pzb246IHByZXBhcmVkSm9iLmFyZ3NKc29uLFxuICAgICAgICBleGVjdXRpb25fbW9kZTogcHJlcGFyZWRKb2IuZXhlY3V0aW9uTW9kZSxcbiAgICAgICAgcXVldWU6IHByZXBhcmVkSm9iLnF1ZXVlLFxuICAgICAgICBtYXhfcmV0cmllczogcHJlcGFyZWRKb2IubWF4UmV0cmllcyxcbiAgICAgICAgYXR0ZW1wdHM6IDAsXG4gICAgICAgIHN0YXR1czogXCJxdWV1ZWRcIixcbiAgICAgICAgc2NoZWR1bGVkX2F0X21zOiBwcmVwYXJlZEpvYi5zY2hlZHVsZWRBdE1zLFxuICAgICAgICBjcmVhdGVkX2F0X21zOiBwcmVwYXJlZEpvYi5jcmVhdGVkQXRNcyxcbiAgICAgICAgc2NoZWR1bGVfa2V5OiBzY2hlZHVsZUtleSxcbiAgICAgICAgY29uY3VycmVuY3lfa2V5OiBjb25jdXJyZW5jeT8uY29uY3VycmVuY3lLZXkgfHwgbnVsbCxcbiAgICAgICAgbWF4X2NvbmN1cnJlbmN5OiBjb25jdXJyZW5jeT8ubWF4Q29uY3VycmVuY3kgfHwgbnVsbCxcbiAgICAgICAgdGltZW91dF9tczogcHJlcGFyZWRKb2IudGltZW91dE1zLFxuICAgICAgICBoYW5kb2ZmX2lkOiBudWxsXG4gICAgICB9XG4gICAgfSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIG5vcm1hbGl6ZSBtYXggcmV0cmllcy5cbiAgICogQHBhcmFtIHtudW1iZXIgfCBudWxsIHwgdW5kZWZpbmVkfSBtYXhSZXRyaWVzIC0gSW5wdXQuXG4gICAqIEByZXR1cm5zIHtudW1iZXJ9IC0gTm9ybWFsaXplZCBtYXggcmV0cmllcy5cbiAgICovXG4gIF9ub3JtYWxpemVNYXhSZXRyaWVzKG1heFJldHJpZXMpIHtcbiAgICByZXR1cm4gbm9ybWFsaXplQmFja2dyb3VuZEpvYk1heFJldHJpZXMobWF4UmV0cmllcylcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIG5vcm1hbGl6ZSBzY2hlZHVsZWQgYXQgbXMuXG4gICAqIEBwYXJhbSB7bnVtYmVyIHwgdW5kZWZpbmVkfSBzY2hlZHVsZWRBdE1zIC0gUmVxdWVzdGVkIGRpc3BhdGNoIHRpbWVzdGFtcC5cbiAgICogQHBhcmFtIHtudW1iZXJ9IGRlZmF1bHRTY2hlZHVsZWRBdE1zIC0gRGVmYXVsdCBkaXNwYXRjaCB0aW1lc3RhbXAuXG4gICAqIEByZXR1cm5zIHtudW1iZXJ9IC0gRGlzcGF0Y2ggdGltZXN0YW1wLlxuICAgKi9cbiAgX25vcm1hbGl6ZVNjaGVkdWxlZEF0TXMoc2NoZWR1bGVkQXRNcywgZGVmYXVsdFNjaGVkdWxlZEF0TXMpIHtcbiAgICByZXR1cm4gbm9ybWFsaXplQmFja2dyb3VuZEpvYlNjaGVkdWxlZEF0TXMoc2NoZWR1bGVkQXRNcywgZGVmYXVsdFNjaGVkdWxlZEF0TXMpXG4gIH1cblxuICAvKipcbiAgICogUmVzb2x2ZXMgYSByZXNjaGVkdWxlIGRlbGF5IGFnYWluc3QgcGVyc2lzdGVuY2UgdGltZS5cbiAgICogQHBhcmFtIHtudW1iZXJ9IGRlbGF5TXMgLSBEZWxheSBpbiBtaWxsaXNlY29uZHMuXG4gICAqIEByZXR1cm5zIHtudW1iZXJ9IC0gRnV0dXJlIGVsaWdpYmlsaXR5IHRpbWVzdGFtcC5cbiAgICovXG4gIF9yZXNjaGVkdWxlZEF0TXMoZGVsYXlNcykge1xuICAgIHJldHVybiByZXNjaGVkdWxlZEJhY2tncm91bmRKb2JBdE1zKGRlbGF5TXMsIERhdGUubm93KCkpXG4gIH1cblxuICAvKipcbiAgICogVmFsaWRhdGVzIGEgcHVibGljIHJlc2NoZWR1bGUgZGVsYXkgYmVmb3JlIHBlcnNpc3RlbmNlIHdvcmsgYmVnaW5zLlxuICAgKiBAcGFyYW0ge251bWJlcn0gZGVsYXlNcyAtIERlbGF5IGluIG1pbGxpc2Vjb25kcy5cbiAgICogQHJldHVybnMge3ZvaWR9XG4gICAqL1xuICBfdmFsaWRhdGVSZXNjaGVkdWxlRGVsYXlNcyhkZWxheU1zKSB7XG4gICAgcmVzY2hlZHVsZWRCYWNrZ3JvdW5kSm9iQXRNcyhkZWxheU1zLCAwKVxuICB9XG5cbiAgLyoqXG4gICAqIFZhbGlkYXRlcyBhIHN0YWJsZSBzY2hlZHVsZSBrZXkgYXQgdGhlIHB1YmxpYyBzdG9yYWdlIGJvdW5kYXJ5LlxuICAgKiBAcGFyYW0ge3N0cmluZ30gc2NoZWR1bGVLZXkgLSBTdGFibGUgbG9naWNhbCBzY2hlZHVsZSBrZXkuXG4gICAqIEByZXR1cm5zIHtzdHJpbmd9IC0gVmFsaWRhdGVkIGtleS5cbiAgICovXG4gIF9ub3JtYWxpemVTY2hlZHVsZUtleShzY2hlZHVsZUtleSkge1xuICAgIGlmICh0eXBlb2Ygc2NoZWR1bGVLZXkgPT09IFwic3RyaW5nXCIgJiYgc2NoZWR1bGVLZXkubGVuZ3RoID4gMCAmJiBzY2hlZHVsZUtleS5sZW5ndGggPD0gMjU1KSByZXR1cm4gc2NoZWR1bGVLZXlcblxuICAgIHRocm93IFZlbG9jaW91c0Vycm9yLnNhZmUoXCJiYWNrZ3JvdW5kIGpvYiBzY2hlZHVsZUtleSBtdXN0IGJlIGEgbm9uLWVtcHR5IHN0cmluZyBvZiBhdCBtb3N0IDI1NSBjaGFyYWN0ZXJzXCIpXG4gIH1cblxuICAvKipcbiAgICogQnVpbGRzIGEgYm91bmRlZCBhZHZpc29yeS1sb2NrIG5hbWUgZm9yIG9uZSBzdGFibGUgc2NoZWR1bGUga2V5LlxuICAgKiBAcGFyYW0ge3N0cmluZ30gc2NoZWR1bGVLZXkgLSBWYWxpZGF0ZWQgc3RhYmxlIHNjaGVkdWxlIGtleS5cbiAgICogQHJldHVybnMge3N0cmluZ30gLSBBZHZpc29yeS1sb2NrIG5hbWUuXG4gICAqL1xuICBfc2NoZWR1bGVLZXlMb2NrTmFtZShzY2hlZHVsZUtleSkge1xuICAgIGNvbnN0IGhhc2ggPSBjcmVhdGVIYXNoKFwic2hhMjU2XCIpLnVwZGF0ZShzY2hlZHVsZUtleSkuZGlnZXN0KFwiaGV4XCIpLnNsaWNlKDAsIDMyKVxuXG4gICAgcmV0dXJuIGBiYWNrZ3JvdW5kLWpvYnM6c2NoZWR1bGU6JHtoYXNofWBcbiAgfVxuXG4gIC8qKlxuICAgKiBFbnN1cmVzIHRoZSBiYWNrZ3JvdW5kLWpvYnMgc2NoZW1hIGV4aXN0cywgcmV1c2luZyBhIGNhbGxlci1oZWxkIGNvbm5lY3Rpb24gd2hlblxuICAgKiBvbmUgaXMgZ2l2ZW4gcmF0aGVyIHRoYW4gY2hlY2tpbmcgb3V0IGl0cyBvd24uXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vZGF0YWJhc2UvZHJpdmVycy9iYXNlLmpzXCIpLmRlZmF1bHR9IFtleGlzdGluZ0RiXSAtIFJldXNlIGFuXG4gICAqICAgYWxyZWFkeS1jaGVja2VkLW91dCBjb25uZWN0aW9uIChlLmcuIHRoZSBvbmUgYGRiOm1pZ3JhdGVgIGhvbGRzKSBpbnN0ZWFkIG9mXG4gICAqICAgY2hlY2tpbmcgb3V0IGEgbmVzdGVkIG9uZSDigJQgdGhlIG5lc3RlZCBjaGVja291dCB3b3VsZCBkZWFkbG9jayBhIGRhdGFiYXNlXG4gICAqICAgd2hvc2UgcG9vbCBpcyBjYXBwZWQgYXQgYSBzaW5nbGUgY29ubmVjdGlvbiBhbHJlYWR5IGhlbGQgYnkgdGhlIGNhbGxlci5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgd2hlbiB0aGUgc2NoZW1hIGlzIHByZXNlbnQuXG4gICAqL1xuICBhc3luYyBfZW5zdXJlU2NoZW1hKGV4aXN0aW5nRGIpIHtcbiAgICBhd2FpdCB0aGlzLl9hcHBseVNjaGVtYShleGlzdGluZ0RiKVxuICB9XG5cbiAgLyoqXG4gICAqIFNlcmlhbGl6ZXMgY3JlYXRpb24gb3IgdXBncmFkZSBvZiB0aGUgYmFja2dyb3VuZC1qb2JzIHNjaGVtYSwgY2hlY2tpbmcgb3V0IGFcbiAgICogY29ubmVjdGlvbiBvbmx5IGFmdGVyIGVhcmxpZXIgc2NoZW1hIHdvcmsgaGFzIGNvbXBsZXRlZCB3aGVuIG9uZSBpcyBub3Qgc3VwcGxpZWQuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vZGF0YWJhc2UvZHJpdmVycy9iYXNlLmpzXCIpLmRlZmF1bHR9IFtleGlzdGluZ0RiXSAtIENhbGxlci1vd25lZFxuICAgKiAgIGRhdGFiYXNlIGNvbm5lY3Rpb24uXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIHdoZW4gdGhlIHNjaGVtYSBpcyBwcmVzZW50LlxuICAgKi9cbiAgYXN5bmMgX2FwcGx5U2NoZW1hKGV4aXN0aW5nRGIpIHtcbiAgICAvLyBTZXJpYWxpemUgY29uY3VycmVudCBzY2hlbWEgYXBwbGllcyB3aXRoaW4gdGhpcyBwcm9jZXNzLCBrZXllZCBieSBkYXRhYmFzZVxuICAgIC8vIGlkZW50aWZpZXIgKHNlZSBgc2NoZW1hQXBwbHlDaGFpbnNgKS4gVGhlIHBlci1zdGVwIGxvY2tzIGluc2lkZSB0aGUgc3RlcHMgdXNlXG4gICAgLy8gRElGRkVSRU5UIGxvY2sgbmFtZXMsIHNvIHR3byBjb25jdXJyZW50IGNhbGxlcnMgY291bGQgb3RoZXJ3aXNlIGVhY2ggaG9sZCBhXG4gICAgLy8gZGlmZmVyZW50IHN0ZXAgbG9jayB3aGlsZSBib3RoIHJlYnVpbGQgdGhlIGpvYnMgdGFibGUg4oCUIGFuZCBvbiBTUUxpdGUvTVNTUUwgYW5cbiAgICAvLyBhZGQtY29sdW1uIGlzIGEgY3JlYXRlLWNvcHktZHJvcC1yZW5hbWUgcmVidWlsZCwgc28gb3ZlcmxhcHBpbmcgcmVidWlsZHNcbiAgICAvLyBjb3JydXB0IGl0LiBUaGlzIG11dGV4IG1ha2VzIHRoZSB3aG9sZSBhcHBseSBtdXR1YWxseSBleGNsdXNpdmUgcGVyIHByb2Nlc3M7XG4gICAgLy8gdGhlIHNlY29uZCBjYWxsZXIgdGhlbiByZS1jaGVja3MgYW5kIGZpbmRzIGV2ZXJ5IHN0ZXAgYWxyZWFkeSBkb25lLlxuICAgIGNvbnN0IGlkZW50aWZpZXIgPSB0aGlzLmdldERhdGFiYXNlSWRlbnRpZmllcigpID8/IFwiZGVmYXVsdFwiXG4gICAgY29uc3QgcHJldmlvdXMgPSBzY2hlbWFBcHBseUNoYWlucy5nZXQoaWRlbnRpZmllcikgPz8gUHJvbWlzZS5yZXNvbHZlKClcbiAgICBjb25zdCBhcHBseVdpdGhDb25uZWN0aW9uID0gYXN5bmMgKCkgPT4ge1xuICAgICAgaWYgKGV4aXN0aW5nRGIpIHtcbiAgICAgICAgYXdhaXQgdGhpcy5fYXBwbHlTY2hlbWFTdGVwcyhleGlzdGluZ0RiKVxuXG4gICAgICAgIHJldHVyblxuICAgICAgfVxuXG4gICAgICBhd2FpdCB0aGlzLl93aXRoRGIoKGRiKSA9PiB0aGlzLl9hcHBseVNjaGVtYVN0ZXBzKGRiKSlcbiAgICB9XG4gICAgY29uc3QgcnVuID0gcHJldmlvdXMudGhlbihhcHBseVdpdGhDb25uZWN0aW9uLCBhcHBseVdpdGhDb25uZWN0aW9uKVxuXG4gICAgLy8gS2VlcCB0aGUgY2hhaW4gYWxpdmUgcmVnYXJkbGVzcyBvZiB0aGlzIHJ1bidzIG91dGNvbWUgc28gb25lIGZhaWxlZCBhcHBseSBkb2VzXG4gICAgLy8gbm90IHdlZGdlIGxhdGVyIGNhbGxlcnM7IHRoaXMgcnVuIHN0aWxsIHByb3BhZ2F0ZXMgaXRzIG93biByZXN1bHQvZXJyb3IuXG4gICAgc2NoZW1hQXBwbHlDaGFpbnMuc2V0KGlkZW50aWZpZXIsIHJ1bi50aGVuKCgpID0+IHt9LCAoKSA9PiB7fSkpXG5cbiAgICByZXR1cm4gYXdhaXQgcnVuXG4gIH1cblxuICAvKipcbiAgICogQ3JlYXRlcyBvciB1cGdyYWRlcyB0aGUgYmFja2dyb3VuZC1qb2JzIHRhYmxlcywgY29sdW1ucyBhbmQgY29uY3VycmVuY3kgcm93cyBvblxuICAgKiB0aGUgZ2l2ZW4gY29ubmVjdGlvbi4gU2VyaWFsaXplZCBwZXIgcHJvY2VzcyBieSB7QGxpbmsgQmFja2dyb3VuZEpvYnNTdG9yZSNfYXBwbHlTY2hlbWF9LlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL2RhdGFiYXNlL2RyaXZlcnMvYmFzZS5qc1wiKS5kZWZhdWx0fSBkYiAtIERhdGFiYXNlIGNvbm5lY3Rpb24uXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIHdoZW4gdGhlIHNjaGVtYSBpcyBwcmVzZW50LlxuICAgKi9cbiAgYXN5bmMgX2FwcGx5U2NoZW1hU3RlcHMoZGIpIHtcbiAgICBhd2FpdCB0aGlzLl9lbnN1cmVNaWdyYXRpb25zVGFibGUoZGIpXG5cbiAgICBjb25zdCBhbHJlYWR5QXBwbGllZCA9IGF3YWl0IHRoaXMuX2hhc01pZ3JhdGlvbihkYilcbiAgICBjb25zdCBzY2hlbWFSZWNvdmVyeVBlbmRpbmcgPSBhd2FpdCB0aGlzLl9oYXNNaWdyYXRpb24oZGIsIFNDSEVNQV9SRUNPVkVSWV9QRU5ESU5HX1ZFUlNJT04pXG4gICAgY29uc3Qgam9ic1RhYmxlRXhpc3RzID0gYXdhaXQgZGIudGFibGVFeGlzdHMoSk9CU19UQUJMRSlcblxuICAgIC8vIEV2ZW4gd2hlbiB0aGUgbWlncmF0aW9uIHJvdyBpcyBwcmVzZW50LCB0aGUgam9icyB0YWJsZSBpdHNlbGYgY2FuIGhhdmVcbiAgICAvLyBiZWVuIGRyb3BwZWQgdW5kZXJuZWF0aCB1cyBieSBhIHRyYW5zYWN0aW9uIHJvbGxiYWNrIGluIGFub3RoZXIgY2FsbGVyXG4gICAgLy8gKERETCBpcyB0cmFuc2FjdGlvbmFsIG9uIFNRTGl0ZS9NU1NRTCkuIFZlcmlmeSB0aGUgdGFibGUgcGh5c2ljYWxseVxuICAgIC8vIGV4aXN0cyBhbmQgcmVjcmVhdGUgaXQgd2hlbiBtaXNzaW5nIHJhdGhlciB0aGFuIHRydXN0aW5nIHRoZSBtaWdyYXRpb25cbiAgICAvLyByb3cgYWxvbmUsIG90aGVyd2lzZSBsYXRlciBjYWxsZXJzIGZhaWwgd2l0aCBcIm5vIHN1Y2ggdGFibGVcIi5cbiAgICBpZiAoYWxyZWFkeUFwcGxpZWQgJiYgam9ic1RhYmxlRXhpc3RzICYmICFzY2hlbWFSZWNvdmVyeVBlbmRpbmcpIHtcbiAgICAgIGF3YWl0IHRoaXMuX2Vuc3VyZUpvYnNUYWJsZUNvbHVtbnMoZGIpXG4gICAgICBhd2FpdCB0aGlzLl9lbnN1cmVJZGVtcG90ZW5jeUtleXNUYWJsZShkYilcbiAgICAgIGF3YWl0IHRoaXMuX2Vuc3VyZU1haWxEZWxpdmVyeU9wZXJhdGlvbnNUYWJsZShkYilcbiAgICAgIGF3YWl0IHRoaXMuX2Vuc3VyZVNjaGVkdWxlS2V5c1RhYmxlKGRiKVxuICAgICAgYXdhaXQgdGhpcy5fZW5zdXJlQ29uY3VycmVuY3lUYWJsZShkYilcbiAgICAgIGF3YWl0IHRoaXMuX2Vuc3VyZUNvdW50UmV2aXNpb25UYWJsZShkYilcblxuICAgICAgcmV0dXJuXG4gICAgfVxuXG4gICAgaWYgKGFscmVhZHlBcHBsaWVkICYmICFzY2hlbWFSZWNvdmVyeVBlbmRpbmcpIHtcbiAgICAgIGF3YWl0IHRoaXMuX3JlY29yZE1pZ3JhdGlvbihkYiwgU0NIRU1BX1JFQ09WRVJZX1BFTkRJTkdfVkVSU0lPTilcbiAgICB9XG5cbiAgICBhd2FpdCB0aGlzLl9hcHBseU1pZ3JhdGlvbnMoZGIpXG4gICAgYXdhaXQgdGhpcy5fZW5zdXJlSm9ic1RhYmxlQ29sdW1ucyhkYilcbiAgICBhd2FpdCB0aGlzLl9lbnN1cmVJZGVtcG90ZW5jeUtleXNUYWJsZShkYilcbiAgICBhd2FpdCB0aGlzLl9lbnN1cmVNYWlsRGVsaXZlcnlPcGVyYXRpb25zVGFibGUoZGIpXG4gICAgYXdhaXQgdGhpcy5fZW5zdXJlU2NoZWR1bGVLZXlzVGFibGUoZGIpXG4gICAgYXdhaXQgdGhpcy5fZW5zdXJlQ29uY3VycmVuY3lUYWJsZShkYilcbiAgICBhd2FpdCB0aGlzLl9lbnN1cmVDb3VudFJldmlzaW9uVGFibGUoZGIpXG5cbiAgICBpZiAoYWxyZWFkeUFwcGxpZWQpIHtcbiAgICAgIC8vIFRoZSByZWNyZWF0ZWQgam9icyB0YWJsZSBpcyBlbXB0eSwgYnV0IHRoZSBzdXJ2aXZpbmcgY29uY3VycmVuY3kgdGFibGVcbiAgICAgIC8vIGNhbiBzdGlsbCBjb3VudCBoYW5kb2ZmcyB0aGF0IGRpc2FwcGVhcmVkIHdpdGggdGhlIGRyb3BwZWQgam9icyB0YWJsZS5cbiAgICAgIGF3YWl0IHRoaXMuX3JlY29uY2lsZUNvbmN1cnJlbmN5KGRiKVxuICAgICAgYXdhaXQgZGIuZGVsZXRlKHtcbiAgICAgICAgdGFibGVOYW1lOiBNSUdSQVRJT05TX1RBQkxFLFxuICAgICAgICBjb25kaXRpb25zOiB7a2V5OiB0aGlzLl9taWdyYXRpb25LZXkoU0NIRU1BX1JFQ09WRVJZX1BFTkRJTkdfVkVSU0lPTil9XG4gICAgICB9KVxuXG4gICAgICByZXR1cm5cbiAgICB9XG5cbiAgICBhd2FpdCB0aGlzLl9yZWNvcmRNaWdyYXRpb24oZGIsIE1JR1JBVElPTl9WRVJTSU9OKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZW5zdXJlIG1pZ3JhdGlvbnMgdGFibGUuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vZGF0YWJhc2UvZHJpdmVycy9iYXNlLmpzXCIpLmRlZmF1bHR9IGRiIC0gRGF0YWJhc2UgY29ubmVjdGlvbi5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgd2hlbiBjb21wbGV0ZS5cbiAgICovXG4gIGFzeW5jIF9lbnN1cmVNaWdyYXRpb25zVGFibGUoZGIpIHtcbiAgICBpZiAoYXdhaXQgZGIudGFibGVFeGlzdHMoTUlHUkFUSU9OU19UQUJMRSkpIHJldHVyblxuXG4gICAgY29uc3QgdGFibGUgPSBuZXcgVGFibGVEYXRhKE1JR1JBVElPTlNfVEFCTEUsIHtpZk5vdEV4aXN0czogdHJ1ZX0pXG5cbiAgICB0YWJsZS5zdHJpbmcoXCJrZXlcIiwge251bGw6IGZhbHNlLCBwcmltYXJ5S2V5OiB0cnVlfSlcbiAgICB0YWJsZS5zdHJpbmcoXCJzY29wZVwiLCB7bnVsbDogZmFsc2V9KVxuICAgIHRhYmxlLnN0cmluZyhcInZlcnNpb25cIiwge251bGw6IGZhbHNlfSlcbiAgICB0YWJsZS5iaWdpbnQoXCJhcHBsaWVkX2F0X21zXCIsIHtudWxsOiBmYWxzZX0pXG5cbiAgICBhd2FpdCBkYi5jcmVhdGVUYWJsZSh0YWJsZSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGhhcyBtaWdyYXRpb24uXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vZGF0YWJhc2UvZHJpdmVycy9iYXNlLmpzXCIpLmRlZmF1bHR9IGRiIC0gRGF0YWJhc2UgY29ubmVjdGlvbi5cbiAgICogQHBhcmFtIHtzdHJpbmd9IFt2ZXJzaW9uXSAtIE1pZ3JhdGlvbiB2ZXJzaW9uLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxib29sZWFuPn0gLSBXaGV0aGVyIG1pZ3JhdGlvbiBleGlzdHMuXG4gICAqL1xuICBhc3luYyBfaGFzTWlncmF0aW9uKGRiLCB2ZXJzaW9uID0gTUlHUkFUSU9OX1ZFUlNJT04pIHtcbiAgICBjb25zdCBxdWVyeSA9IGRiXG4gICAgICAubmV3UXVlcnkoKVxuICAgICAgLmZyb20oTUlHUkFUSU9OU19UQUJMRSlcbiAgICAgIC53aGVyZSh7a2V5OiB0aGlzLl9taWdyYXRpb25LZXkodmVyc2lvbil9KVxuICAgICAgLmxpbWl0KDEpXG5cbiAgICBjb25zdCByb3dzID0gYXdhaXQgcXVlcnkucmVzdWx0cygpXG5cbiAgICByZXR1cm4gcm93cy5sZW5ndGggPiAwXG4gIH1cblxuICAvKipcbiAgICogUnVucyBhcHBseSBtaWdyYXRpb25zLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL2RhdGFiYXNlL2RyaXZlcnMvYmFzZS5qc1wiKS5kZWZhdWx0fSBkYiAtIERhdGFiYXNlIGNvbm5lY3Rpb24uXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIHdoZW4gY29tcGxldGUuXG4gICAqL1xuICBhc3luYyBfYXBwbHlNaWdyYXRpb25zKGRiKSB7XG4gICAgdGhpcy5sb2dnZXIuaW5mbyhcIkFwcGx5aW5nIGJhY2tncm91bmQgam9icyBzY2hlbWFcIilcblxuICAgIGlmIChhd2FpdCBkYi50YWJsZUV4aXN0cyhKT0JTX1RBQkxFKSkge1xuICAgICAgdGhpcy5sb2dnZXIuaW5mbyhcIkJhY2tncm91bmQgam9icyB0YWJsZSBhbHJlYWR5IGV4aXN0cyAtIHNraXBwaW5nIGNyZWF0ZVwiKVxuICAgICAgcmV0dXJuXG4gICAgfVxuXG4gICAgY29uc3QgdGFibGUgPSBuZXcgVGFibGVEYXRhKEpPQlNfVEFCTEUsIHtpZk5vdEV4aXN0czogdHJ1ZX0pXG5cbiAgICB0YWJsZS5zdHJpbmcoXCJpZFwiLCB7cHJpbWFyeUtleTogdHJ1ZX0pXG4gICAgdGFibGUuc3RyaW5nKFwiam9iX25hbWVcIiwge251bGw6IGZhbHNlLCBpbmRleDogdHJ1ZX0pXG4gICAgdGFibGUudGV4dChcImFyZ3NfanNvblwiLCB7bnVsbDogZmFsc2V9KVxuICAgIHRhYmxlLnN0cmluZyhcImV4ZWN1dGlvbl9tb2RlXCIsIHtudWxsOiBmYWxzZX0pXG4gICAgdGFibGUuc3RyaW5nKFwicXVldWVcIiwge251bGw6IHRydWUsIGluZGV4OiB0cnVlfSlcbiAgICB0YWJsZS5pbnRlZ2VyKFwibWF4X3JldHJpZXNcIiwge251bGw6IGZhbHNlfSlcbiAgICB0YWJsZS5pbnRlZ2VyKFwiYXR0ZW1wdHNcIiwge251bGw6IGZhbHNlfSlcbiAgICB0YWJsZS5zdHJpbmcoXCJzdGF0dXNcIiwge251bGw6IGZhbHNlLCBpbmRleDogdHJ1ZX0pXG4gICAgdGFibGUuYmlnaW50KFwic2NoZWR1bGVkX2F0X21zXCIsIHtudWxsOiBmYWxzZSwgaW5kZXg6IHRydWV9KVxuICAgIHRhYmxlLmJpZ2ludChcImNyZWF0ZWRfYXRfbXNcIiwge251bGw6IGZhbHNlLCBpbmRleDogdHJ1ZX0pXG4gICAgdGFibGUuc3RyaW5nKFwic2NoZWR1bGVfa2V5XCIsIHtudWxsOiB0cnVlLCBpbmRleDogdHJ1ZX0pXG4gICAgdGFibGUuYmlnaW50KFwiaGFuZGVkX29mZl9hdF9tc1wiLCB7bnVsbDogdHJ1ZSwgaW5kZXg6IHRydWV9KVxuICAgIHRhYmxlLnN0cmluZyhcImhhbmRvZmZfaWRcIiwge251bGw6IHRydWV9KVxuICAgIHRhYmxlLmJpZ2ludChcImNvbXBsZXRlZF9hdF9tc1wiLCB7bnVsbDogdHJ1ZX0pXG4gICAgdGFibGUuYmlnaW50KFwiZmFpbGVkX2F0X21zXCIsIHtudWxsOiB0cnVlfSlcbiAgICB0YWJsZS5iaWdpbnQoXCJvcnBoYW5lZF9hdF9tc1wiLCB7bnVsbDogdHJ1ZSwgaW5kZXg6IHRydWV9KVxuICAgIHRhYmxlLnN0cmluZyhcIndvcmtlcl9pZFwiLCB7bnVsbDogdHJ1ZX0pXG4gICAgdGFibGUudGV4dChcImxhc3RfZXJyb3JcIiwge251bGw6IHRydWV9KVxuICAgIHRhYmxlLnN0cmluZyhcImNvbmN1cnJlbmN5X2tleVwiLCB7bnVsbDogdHJ1ZSwgaW5kZXg6IHRydWV9KVxuICAgIHRhYmxlLmludGVnZXIoXCJtYXhfY29uY3VycmVuY3lcIiwge251bGw6IHRydWV9KVxuICAgIHRhYmxlLmJpZ2ludChcInRpbWVvdXRfbXNcIiwge251bGw6IHRydWV9KVxuXG4gICAgYXdhaXQgZGIuY3JlYXRlVGFibGUodGFibGUpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBlbnN1cmUgam9icyB0YWJsZSBjb2x1bW5zLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL2RhdGFiYXNlL2RyaXZlcnMvYmFzZS5qc1wiKS5kZWZhdWx0fSBkYiAtIERhdGFiYXNlIGNvbm5lY3Rpb24uXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIHdoZW4gY29tcGxldGUuXG4gICAqL1xuICBhc3luYyBfZW5zdXJlSm9ic1RhYmxlQ29sdW1ucyhkYikge1xuICAgIGlmICghKGF3YWl0IGRiLnRhYmxlRXhpc3RzKEpPQlNfVEFCTEUpKSkgcmV0dXJuXG5cbiAgICBjb25zdCB0YWJsZSA9IGF3YWl0IGRiLmdldFRhYmxlQnlOYW1lT3JGYWlsKEpPQlNfVEFCTEUpXG4gICAgY29uc3QgZXhlY3V0aW9uTW9kZUNvbHVtbiA9IGF3YWl0IHRhYmxlLmdldENvbHVtbkJ5TmFtZShcImV4ZWN1dGlvbl9tb2RlXCIpXG5cbiAgICBpZiAoIWV4ZWN1dGlvbk1vZGVDb2x1bW4pIHtcbiAgICAgIGNvbnN0IHRhYmxlRGF0YSA9IG5ldyBUYWJsZURhdGEoSk9CU19UQUJMRSlcbiAgICAgIHRhYmxlRGF0YS5zdHJpbmcoXCJleGVjdXRpb25fbW9kZVwiLCB7bnVsbDogdHJ1ZX0pXG4gICAgICBjb25zdCBzcWxzID0gYXdhaXQgZGIuYWx0ZXJUYWJsZVNRTHModGFibGVEYXRhKVxuXG4gICAgICBmb3IgKGNvbnN0IHNxbCBvZiBzcWxzKSB7XG4gICAgICAgIGF3YWl0IGRiLnF1ZXJ5KHNxbClcbiAgICAgIH1cblxuICAgICAgZGIuY2xlYXJTY2hlbWFDYWNoZSgpXG4gICAgfVxuXG4gICAgY29uc3QgcmVmcmVzaGVkVGFibGUgPSBhd2FpdCBkYi5nZXRUYWJsZUJ5TmFtZU9yRmFpbChKT0JTX1RBQkxFKVxuICAgIGNvbnN0IGhhbmRvZmZJZENvbHVtbiA9IGF3YWl0IHJlZnJlc2hlZFRhYmxlLmdldENvbHVtbkJ5TmFtZShcImhhbmRvZmZfaWRcIilcblxuICAgIGlmICghaGFuZG9mZklkQ29sdW1uKSB7XG4gICAgICBjb25zdCBsb2NrTmFtZSA9IGAke01JR1JBVElPTl9TQ09QRX06aGFuZG9mZl9pZF9jb2x1bW5gXG4gICAgICBjb25zdCBhY3F1aXJlZCA9IGF3YWl0IGRiLmFjcXVpcmVBZHZpc29yeUxvY2sobG9ja05hbWUpXG5cbiAgICAgIGlmICghYWNxdWlyZWQpIHRocm93IG5ldyBFcnJvcihcIkZhaWxlZCB0byBhY3F1aXJlIGJhY2tncm91bmQgam9icyBoYW5kb2ZmIHNjaGVtYSBsb2NrXCIpXG5cbiAgICAgIHRyeSB7XG4gICAgICAgIGRiLmNsZWFyU2NoZW1hQ2FjaGUoKVxuICAgICAgICBjb25zdCBsb2NrZWRUYWJsZSA9IGF3YWl0IGRiLmdldFRhYmxlQnlOYW1lT3JGYWlsKEpPQlNfVEFCTEUpXG5cbiAgICAgICAgaWYgKCEoYXdhaXQgbG9ja2VkVGFibGUuZ2V0Q29sdW1uQnlOYW1lKFwiaGFuZG9mZl9pZFwiKSkpIHtcbiAgICAgICAgICBjb25zdCB0YWJsZURhdGEgPSBuZXcgVGFibGVEYXRhKEpPQlNfVEFCTEUpXG4gICAgICAgICAgdGFibGVEYXRhLnN0cmluZyhcImhhbmRvZmZfaWRcIiwge251bGw6IHRydWV9KVxuICAgICAgICAgIGNvbnN0IHNxbHMgPSBhd2FpdCBkYi5hbHRlclRhYmxlU1FMcyh0YWJsZURhdGEpXG5cbiAgICAgICAgICBmb3IgKGNvbnN0IHNxbCBvZiBzcWxzKSB7XG4gICAgICAgICAgICBhd2FpdCBkYi5xdWVyeShzcWwpXG4gICAgICAgICAgfVxuXG4gICAgICAgICAgZGIuY2xlYXJTY2hlbWFDYWNoZSgpXG4gICAgICAgIH1cbiAgICAgIH0gZmluYWxseSB7XG4gICAgICAgIGF3YWl0IGRiLnJlbGVhc2VBZHZpc29yeUxvY2sobG9ja05hbWUpXG4gICAgICB9XG4gICAgfVxuXG4gICAgYXdhaXQgdGhpcy5fYmFja2ZpbGxFeGVjdXRpb25Nb2Rlc09uY2UoZGIpXG4gICAgYXdhaXQgdGhpcy5fZHJvcEZvcmtlZENvbHVtbk9uY2UoZGIpXG5cbiAgICBjb25zdCBsb2NrTmFtZSA9IGAke01JR1JBVElPTl9TQ09QRX06Y29uY3VycmVuY3lfY29sdW1uc2BcbiAgICBjb25zdCBhY3F1aXJlZCA9IGF3YWl0IGRiLmFjcXVpcmVBZHZpc29yeUxvY2sobG9ja05hbWUpXG5cbiAgICBpZiAoIWFjcXVpcmVkKSB0aHJvdyBuZXcgRXJyb3IoXCJGYWlsZWQgdG8gYWNxdWlyZSBiYWNrZ3JvdW5kIGpvYnMgY29uY3VycmVuY3kgc2NoZW1hIGxvY2tcIilcblxuICAgIHRyeSB7XG4gICAgICAvLyBTUUwgU2VydmVyIHNjaGVtYSByZWFkcyBjYW4gZGVhZGxvY2sgd2l0aCBhIGNvbmN1cnJlbnQgQUxURVIgVEFCTEUsIHNvXG4gICAgICAvLyBhY3F1aXJlIHRoZSBsb2NrIGJlZm9yZSBpbnNwZWN0aW5nIGVpdGhlciBjb2x1bW4gcmF0aGVyIHRoYW4gb25seVxuICAgICAgLy8gcHJvdGVjdGluZyB0aGUgbXV0YXRpb24uXG4gICAgICBkYi5jbGVhclNjaGVtYUNhY2hlKClcbiAgICAgIGNvbnN0IGxvY2tlZFRhYmxlID0gYXdhaXQgZGIuZ2V0VGFibGVCeU5hbWVPckZhaWwoSk9CU19UQUJMRSlcbiAgICAgIGNvbnN0IGNvbmN1cnJlbmN5Q29sdW1uTmFtZXMgPSBbXCJjb25jdXJyZW5jeV9rZXlcIiwgXCJtYXhfY29uY3VycmVuY3lcIl1cblxuICAgICAgZm9yIChjb25zdCBjb25jdXJyZW5jeUNvbHVtbk5hbWUgb2YgY29uY3VycmVuY3lDb2x1bW5OYW1lcykge1xuICAgICAgICBpZiAoYXdhaXQgbG9ja2VkVGFibGUuZ2V0Q29sdW1uQnlOYW1lKGNvbmN1cnJlbmN5Q29sdW1uTmFtZSkpIGNvbnRpbnVlXG5cbiAgICAgICAgY29uc3QgdGFibGVEYXRhID0gbmV3IFRhYmxlRGF0YShKT0JTX1RBQkxFKVxuICAgICAgICBpZiAoY29uY3VycmVuY3lDb2x1bW5OYW1lID09IFwiY29uY3VycmVuY3lfa2V5XCIpIHtcbiAgICAgICAgICB0YWJsZURhdGEuc3RyaW5nKFwiY29uY3VycmVuY3lfa2V5XCIsIHtudWxsOiB0cnVlLCBpbmRleDogdHJ1ZX0pXG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgdGFibGVEYXRhLmludGVnZXIoXCJtYXhfY29uY3VycmVuY3lcIiwge251bGw6IHRydWV9KVxuICAgICAgICB9XG5cbiAgICAgICAgZm9yIChjb25zdCBzcWwgb2YgYXdhaXQgZGIuYWx0ZXJUYWJsZVNRTHModGFibGVEYXRhKSkgYXdhaXQgZGIucXVlcnkoc3FsKVxuICAgICAgfVxuXG4gICAgICBkYi5jbGVhclNjaGVtYUNhY2hlKClcbiAgICB9IGZpbmFsbHkge1xuICAgICAgYXdhaXQgZGIucmVsZWFzZUFkdmlzb3J5TG9jayhsb2NrTmFtZSlcbiAgICB9XG5cbiAgICBhd2FpdCB0aGlzLl9lbnN1cmVRdWV1ZUNvbHVtbihkYilcbiAgICBhd2FpdCB0aGlzLl9lbnN1cmVTY2hlZHVsZUtleUNvbHVtbihkYilcbiAgICBhd2FpdCB0aGlzLl9lbnN1cmVKb2JUaW1lb3V0Q29sdW1uKGRiKVxuICAgIGF3YWl0IHRoaXMuX2Vuc3VyZUpvYnNUYWJsZUluZGV4ZXNPbmNlKGRiKVxuICB9XG5cbiAgLyoqXG4gICAqIFJlcGFpcnMgc2Vjb25kYXJ5IGluZGV4ZXMgdGhhdCBvbGRlciBhZGQtY29sdW1uIHVwZ3JhZGVzIGRlY2xhcmVkIGJ1dCBkaWRcbiAgICogbm90IGNyZWF0ZSBvbiBldmVyeSBTUUwgZHJpdmVyLiBUaGUgbWlncmF0aW9uIGxlZGdlciBrZWVwcyByb3V0aW5lIHN0b3JlXG4gICAqIHJlYWRpbmVzcyBmcm9tIHJlcGVhdGVkbHkgaW50cm9zcGVjdGluZyB0aGUgZnVsbCBpbmRleCBzZXQuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vZGF0YWJhc2UvZHJpdmVycy9iYXNlLmpzXCIpLmRlZmF1bHR9IGRiIC0gRGF0YWJhc2UgY29ubmVjdGlvbi5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgd2hlbiBhbGwgZXhwZWN0ZWQgaW5kZXhlcyBleGlzdC5cbiAgICovXG4gIGFzeW5jIF9lbnN1cmVKb2JzVGFibGVJbmRleGVzT25jZShkYikge1xuICAgIGNvbnN0IG1pZ3JhdGlvblZlcnNpb24gPSBKT0JTX0lOREVYX1JFUEFJUl9NSUdSQVRJT05fVkVSU0lPTlxuICAgIGNvbnN0IG1pZ3JhdGlvbktleSA9IHRoaXMuX21pZ3JhdGlvbktleShtaWdyYXRpb25WZXJzaW9uKVxuXG4gICAgaWYgKGF3YWl0IHRoaXMuX2hhc01pZ3JhdGlvbihkYiwgbWlncmF0aW9uVmVyc2lvbikpIHJldHVyblxuXG4gICAgY29uc3QgYWNxdWlyZWQgPSBhd2FpdCBkYi5hY3F1aXJlQWR2aXNvcnlMb2NrKG1pZ3JhdGlvbktleSlcblxuICAgIGlmICghYWNxdWlyZWQpIHRocm93IG5ldyBFcnJvcihcIkZhaWxlZCB0byBhY3F1aXJlIGJhY2tncm91bmQgam9icyBpbmRleCByZXBhaXIgbG9ja1wiKVxuXG4gICAgdHJ5IHtcbiAgICAgIGlmIChhd2FpdCB0aGlzLl9oYXNNaWdyYXRpb24oZGIsIG1pZ3JhdGlvblZlcnNpb24pKSByZXR1cm5cblxuICAgICAgZGIuY2xlYXJTY2hlbWFDYWNoZSgpXG4gICAgICBjb25zdCB0YWJsZSA9IGF3YWl0IGRiLmdldFRhYmxlQnlOYW1lT3JGYWlsKEpPQlNfVEFCTEUpXG4gICAgICBjb25zdCBpbmRleGVkQ29sdW1uTmFtZXMgPSBuZXcgU2V0KFxuICAgICAgICAoYXdhaXQgdGFibGUuZ2V0SW5kZXhlcygpKVxuICAgICAgICAgIC5maWx0ZXIoKGluZGV4KSA9PiAhaW5kZXguaXNQcmltYXJ5S2V5KCkgJiYgaW5kZXguZ2V0Q29sdW1uTmFtZXMoKS5sZW5ndGggPT09IDEpXG4gICAgICAgICAgLm1hcCgoaW5kZXgpID0+IGluZGV4LmdldENvbHVtbk5hbWVzKClbMF0pXG4gICAgICApXG5cbiAgICAgIGZvciAoY29uc3QgY29sdW1uTmFtZSBvZiBKT0JTX0lOREVYX0NPTFVNTl9OQU1FUykge1xuICAgICAgICBpZiAoaW5kZXhlZENvbHVtbk5hbWVzLmhhcyhjb2x1bW5OYW1lKSkgY29udGludWVcblxuICAgICAgICBmb3IgKGNvbnN0IHNxbCBvZiBhd2FpdCBkYi5jcmVhdGVJbmRleFNRTHMoe2NvbHVtbnM6IFtjb2x1bW5OYW1lXSwgaWZOb3RFeGlzdHM6IGRiLmdldFR5cGUoKSA9PT0gXCJzcWxpdGVcIiwgdGFibGVOYW1lOiBKT0JTX1RBQkxFfSkpIHtcbiAgICAgICAgICBhd2FpdCBkYi5xdWVyeShzcWwpXG4gICAgICAgIH1cbiAgICAgIH1cblxuICAgICAgZGIuY2xlYXJTY2hlbWFDYWNoZSgpXG4gICAgICBhd2FpdCB0aGlzLl9yZWNvcmRNaWdyYXRpb24oZGIsIG1pZ3JhdGlvblZlcnNpb24pXG4gICAgfSBmaW5hbGx5IHtcbiAgICAgIGF3YWl0IGRiLnJlbGVhc2VBZHZpc29yeUxvY2sobWlncmF0aW9uS2V5KVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBJZGVtcG90ZW50bHkgYWRkcyB0aGUgcGVyLWpvYiB3YWxsLWNsb2NrIHRpbWVvdXQgdG8gZXhpc3Rpbmcgam9iIHRhYmxlcy5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9kYXRhYmFzZS9kcml2ZXJzL2Jhc2UuanNcIikuZGVmYXVsdH0gZGIgLSBEYXRhYmFzZSBjb25uZWN0aW9uLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyB3aGVuIGVuc3VyZWQuXG4gICAqL1xuICBhc3luYyBfZW5zdXJlSm9iVGltZW91dENvbHVtbihkYikge1xuICAgIGNvbnN0IGxvY2tOYW1lID0gYCR7TUlHUkFUSU9OX1NDT1BFfTp0aW1lb3V0X21zX2NvbHVtbmBcbiAgICBjb25zdCBhY3F1aXJlZCA9IGF3YWl0IGRiLmFjcXVpcmVBZHZpc29yeUxvY2sobG9ja05hbWUpXG5cbiAgICBpZiAoIWFjcXVpcmVkKSB0aHJvdyBuZXcgRXJyb3IoXCJGYWlsZWQgdG8gYWNxdWlyZSBiYWNrZ3JvdW5kIGpvYnMgdGltZW91dCBzY2hlbWEgbG9ja1wiKVxuXG4gICAgdHJ5IHtcbiAgICAgIGRiLmNsZWFyU2NoZW1hQ2FjaGUoKVxuICAgICAgY29uc3QgdGFibGUgPSBhd2FpdCBkYi5nZXRUYWJsZUJ5TmFtZU9yRmFpbChKT0JTX1RBQkxFKVxuXG4gICAgICBpZiAoIShhd2FpdCB0YWJsZS5nZXRDb2x1bW5CeU5hbWUoXCJ0aW1lb3V0X21zXCIpKSkge1xuICAgICAgICBjb25zdCB0YWJsZURhdGEgPSBuZXcgVGFibGVEYXRhKEpPQlNfVEFCTEUpXG4gICAgICAgIHRhYmxlRGF0YS5iaWdpbnQoXCJ0aW1lb3V0X21zXCIsIHtudWxsOiB0cnVlfSlcblxuICAgICAgICBmb3IgKGNvbnN0IHNxbCBvZiBhd2FpdCBkYi5hbHRlclRhYmxlU1FMcyh0YWJsZURhdGEpKSBhd2FpdCBkYi5xdWVyeShzcWwpXG5cbiAgICAgICAgZGIuY2xlYXJTY2hlbWFDYWNoZSgpXG4gICAgICB9XG4gICAgfSBmaW5hbGx5IHtcbiAgICAgIGF3YWl0IGRiLnJlbGVhc2VBZHZpc29yeUxvY2sobG9ja05hbWUpXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIElkZW1wb3RlbnRseSBhZGRzIHRoZSBoaXN0b3JpY2FsIHN0YWJsZSBzY2hlZHVsZSBrZXkgdG8gZXhpc3Rpbmcgam9icy5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9kYXRhYmFzZS9kcml2ZXJzL2Jhc2UuanNcIikuZGVmYXVsdH0gZGIgLSBEYXRhYmFzZSBjb25uZWN0aW9uLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyB3aGVuIGVuc3VyZWQuXG4gICAqL1xuICBhc3luYyBfZW5zdXJlU2NoZWR1bGVLZXlDb2x1bW4oZGIpIHtcbiAgICBjb25zdCBsb2NrTmFtZSA9IGAke01JR1JBVElPTl9TQ09QRX06c2NoZWR1bGVfa2V5X2NvbHVtbmBcbiAgICBjb25zdCBhY3F1aXJlZCA9IGF3YWl0IGRiLmFjcXVpcmVBZHZpc29yeUxvY2sobG9ja05hbWUpXG5cbiAgICBpZiAoIWFjcXVpcmVkKSB0aHJvdyBuZXcgRXJyb3IoXCJGYWlsZWQgdG8gYWNxdWlyZSBiYWNrZ3JvdW5kIGpvYnMgc2NoZWR1bGUta2V5IHNjaGVtYSBsb2NrXCIpXG5cbiAgICB0cnkge1xuICAgICAgZGIuY2xlYXJTY2hlbWFDYWNoZSgpXG4gICAgICBjb25zdCBsb2NrZWRUYWJsZSA9IGF3YWl0IGRiLmdldFRhYmxlQnlOYW1lT3JGYWlsKEpPQlNfVEFCTEUpXG5cbiAgICAgIGlmICghKGF3YWl0IGxvY2tlZFRhYmxlLmdldENvbHVtbkJ5TmFtZShcInNjaGVkdWxlX2tleVwiKSkpIHtcbiAgICAgICAgY29uc3QgdGFibGVEYXRhID0gbmV3IFRhYmxlRGF0YShKT0JTX1RBQkxFKVxuXG4gICAgICAgIHRhYmxlRGF0YS5zdHJpbmcoXCJzY2hlZHVsZV9rZXlcIiwge251bGw6IHRydWUsIGluZGV4OiB0cnVlfSlcblxuICAgICAgICBmb3IgKGNvbnN0IHNxbCBvZiBhd2FpdCBkYi5hbHRlclRhYmxlU1FMcyh0YWJsZURhdGEpKSBhd2FpdCBkYi5xdWVyeShzcWwpXG5cbiAgICAgICAgZGIuY2xlYXJTY2hlbWFDYWNoZSgpXG4gICAgICB9XG4gICAgfSBmaW5hbGx5IHtcbiAgICAgIGF3YWl0IGRiLnJlbGVhc2VBZHZpc29yeUxvY2sobG9ja05hbWUpXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIElkZW1wb3RlbnRseSBhZGRzIHRoZSBgcXVldWVgIGNvbHVtbiB0byBhbiBleGlzdGluZyBqb2JzIHRhYmxlLiBFeGlzdGluZ1xuICAgKiByb3dzIHJlYWQgYmFjayBhcyB0aGUgZGVmYXVsdCBxdWV1ZSAoc2VlIHtAbGluayBfbm9ybWFsaXplSm9iUm93fSksIHNvIG5vXG4gICAqIGRhdGEgYmFja2ZpbGwgaXMgcmVxdWlyZWQuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vZGF0YWJhc2UvZHJpdmVycy9iYXNlLmpzXCIpLmRlZmF1bHR9IGRiIC0gRGF0YWJhc2UgY29ubmVjdGlvbi5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgd2hlbiBlbnN1cmVkLlxuICAgKi9cbiAgYXN5bmMgX2Vuc3VyZVF1ZXVlQ29sdW1uKGRiKSB7XG4gICAgY29uc3QgbG9ja05hbWUgPSBgJHtNSUdSQVRJT05fU0NPUEV9OnF1ZXVlX2NvbHVtbmBcbiAgICBjb25zdCBhY3F1aXJlZCA9IGF3YWl0IGRiLmFjcXVpcmVBZHZpc29yeUxvY2sobG9ja05hbWUpXG5cbiAgICBpZiAoIWFjcXVpcmVkKSB0aHJvdyBuZXcgRXJyb3IoXCJGYWlsZWQgdG8gYWNxdWlyZSBiYWNrZ3JvdW5kIGpvYnMgcXVldWUgc2NoZW1hIGxvY2tcIilcblxuICAgIHRyeSB7XG4gICAgICAvLyBTUUwgU2VydmVyIHNjaGVtYSByZWFkcyBjYW4gZGVhZGxvY2sgd2l0aCBhIGNvbmN1cnJlbnQgQUxURVIgVEFCTEUsIHNvXG4gICAgICAvLyBhY3F1aXJlIHRoZSBsb2NrIGJlZm9yZSBpbnNwZWN0aW5nIHRoZSBjb2x1bW4gcmF0aGVyIHRoYW4gb25seVxuICAgICAgLy8gcHJvdGVjdGluZyB0aGUgbXV0YXRpb24gKG1pcnJvcnMgdGhlIGNvbmN1cnJlbmN5LWNvbHVtbiBtaWdyYXRpb24pLlxuICAgICAgZGIuY2xlYXJTY2hlbWFDYWNoZSgpXG4gICAgICBjb25zdCBsb2NrZWRUYWJsZSA9IGF3YWl0IGRiLmdldFRhYmxlQnlOYW1lT3JGYWlsKEpPQlNfVEFCTEUpXG5cbiAgICAgIGlmICghKGF3YWl0IGxvY2tlZFRhYmxlLmdldENvbHVtbkJ5TmFtZShcInF1ZXVlXCIpKSkge1xuICAgICAgICBjb25zdCB0YWJsZURhdGEgPSBuZXcgVGFibGVEYXRhKEpPQlNfVEFCTEUpXG5cbiAgICAgICAgdGFibGVEYXRhLnN0cmluZyhcInF1ZXVlXCIsIHtudWxsOiB0cnVlLCBpbmRleDogdHJ1ZX0pXG5cbiAgICAgICAgZm9yIChjb25zdCBzcWwgb2YgYXdhaXQgZGIuYWx0ZXJUYWJsZVNRTHModGFibGVEYXRhKSkgYXdhaXQgZGIucXVlcnkoc3FsKVxuXG4gICAgICAgIGRiLmNsZWFyU2NoZW1hQ2FjaGUoKVxuICAgICAgfVxuICAgIH0gZmluYWxseSB7XG4gICAgICBhd2FpdCBkYi5yZWxlYXNlQWR2aXNvcnlMb2NrKGxvY2tOYW1lKVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGJhY2tmaWxsIGV4ZWN1dGlvbiBtb2RlcyBvbmNlLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL2RhdGFiYXNlL2RyaXZlcnMvYmFzZS5qc1wiKS5kZWZhdWx0fSBkYiAtIERhdGFiYXNlIGNvbm5lY3Rpb24uXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIHdoZW4gY29tcGxldGUuXG4gICAqL1xuICBhc3luYyBfYmFja2ZpbGxFeGVjdXRpb25Nb2Rlc09uY2UoZGIpIHtcbiAgICBjb25zdCBtaWdyYXRpb25WZXJzaW9uID0gRVhFQ1VUSU9OX01PREVfQkFDS0ZJTExfTUlHUkFUSU9OX1ZFUlNJT05cbiAgICBjb25zdCBtaWdyYXRpb25LZXkgPSB0aGlzLl9taWdyYXRpb25LZXkobWlncmF0aW9uVmVyc2lvbilcblxuICAgIGlmIChhd2FpdCB0aGlzLl9oYXNNaWdyYXRpb24oZGIsIG1pZ3JhdGlvblZlcnNpb24pKSByZXR1cm5cblxuICAgIGF3YWl0IGRiLmFjcXVpcmVBZHZpc29yeUxvY2sobWlncmF0aW9uS2V5KVxuXG4gICAgdHJ5IHtcbiAgICAgIGlmIChhd2FpdCB0aGlzLl9oYXNNaWdyYXRpb24oZGIsIG1pZ3JhdGlvblZlcnNpb24pKSByZXR1cm5cblxuICAgICAgLy8gQSB0YWJsZSBjcmVhdGVkIGFmdGVyIHRoZSBgZm9ya2VkYCBjb2x1bW4gd2FzIGRyb3BwZWQgaGFzIG5vdGhpbmcgdG9cbiAgICAgIC8vIGJhY2tmaWxsIGZyb207IHJlY29yZCB0aGUgbWlncmF0aW9uIHNvIGl0IGlzIG5vdCByZS1hdHRlbXB0ZWQuXG4gICAgICBkYi5jbGVhclNjaGVtYUNhY2hlKClcbiAgICAgIGlmICghKGF3YWl0IChhd2FpdCBkYi5nZXRUYWJsZUJ5TmFtZU9yRmFpbChKT0JTX1RBQkxFKSkuZ2V0Q29sdW1uQnlOYW1lKFwiZm9ya2VkXCIpKSkge1xuICAgICAgICBhd2FpdCB0aGlzLl9yZWNvcmRNaWdyYXRpb24oZGIsIG1pZ3JhdGlvblZlcnNpb24pXG4gICAgICAgIHJldHVyblxuICAgICAgfVxuXG4gICAgICBjb25zdCB0YWJsZU5hbWVTcWwgPSBkYi5xdW90ZVRhYmxlKEpPQlNfVEFCTEUpXG4gICAgICBjb25zdCBmb3JrZWRDb2x1bW5TcWwgPSBkYi5xdW90ZUNvbHVtbihcImZvcmtlZFwiKVxuICAgICAgY29uc3QgZXhlY3V0aW9uTW9kZUNvbHVtblNxbCA9IGRiLnF1b3RlQ29sdW1uKFwiZXhlY3V0aW9uX21vZGVcIilcblxuICAgICAgYXdhaXQgZGIucXVlcnkoXG4gICAgICAgIGBVUERBVEUgJHt0YWJsZU5hbWVTcWx9IFNFVCAke2V4ZWN1dGlvbk1vZGVDb2x1bW5TcWx9ID0gJHtkYi5xdW90ZShcImZvcmtlZFwiKX0gYCArXG4gICAgICAgIGBXSEVSRSAke2ZvcmtlZENvbHVtblNxbH0gPSAke2RiLnF1b3RlKHRydWUpfSBBTkQgJHtleGVjdXRpb25Nb2RlQ29sdW1uU3FsfSBJUyBOVUxMYFxuICAgICAgKVxuICAgICAgYXdhaXQgZGIucXVlcnkoXG4gICAgICAgIGBVUERBVEUgJHt0YWJsZU5hbWVTcWx9IFNFVCAke2V4ZWN1dGlvbk1vZGVDb2x1bW5TcWx9ID0gJHtkYi5xdW90ZShcImlubGluZVwiKX0gYCArXG4gICAgICAgIGBXSEVSRSAke2ZvcmtlZENvbHVtblNxbH0gPSAke2RiLnF1b3RlKGZhbHNlKX0gQU5EICR7ZXhlY3V0aW9uTW9kZUNvbHVtblNxbH0gSVMgTlVMTGBcbiAgICAgIClcblxuICAgICAgYXdhaXQgdGhpcy5fcmVjb3JkTWlncmF0aW9uKGRiLCBtaWdyYXRpb25WZXJzaW9uKVxuICAgIH0gZmluYWxseSB7XG4gICAgICBhd2FpdCBkYi5yZWxlYXNlQWR2aXNvcnlMb2NrKG1pZ3JhdGlvbktleSlcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogUmV3cml0ZXMgcHJlLWV4aXN0aW5nIHBvb2xlZCByb3dzIChwZXJzaXN0ZWQgYXMgYGV4ZWN1dGlvbl9tb2RlID0gXCJmb3JrZWRcImBcbiAgICogcGx1cyBhIGB2ZWxvY2lvdXMtcG9vbGVkOipgIGhhbmRvZmYgbWFya2VyKSB0byBgZXhlY3V0aW9uX21vZGUgPSBcInBvb2xlZFwiYCxcbiAgICogY2xlYXJzIHRoZSBxdWV1ZWQgbWFya2VyLCB0aGVuIGRyb3BzIHRoZSBub3ctcmVkdW5kYW50IGBmb3JrZWRgIGNvbHVtbiBzb1xuICAgKiBgZXhlY3V0aW9uX21vZGVgIGlzIHRoZSBzaW5nbGUgc291cmNlIG9mIHRydXRoLiBSdW5zIG9uY2UsIGd1YXJkZWQgYnkgdGhlXG4gICAqIG1pZ3JhdGlvbiBsZWRnZXIgYW5kIGEgcGVyLWtleSBhZHZpc29yeSBsb2NrOyBhIGZyZXNoIHRhYmxlIChjcmVhdGVkIHdpdGhvdXRcbiAgICogdGhlIGNvbHVtbikgc2hvcnQtY2lyY3VpdHMuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vZGF0YWJhc2UvZHJpdmVycy9iYXNlLmpzXCIpLmRlZmF1bHR9IGRiIC0gRGF0YWJhc2UgY29ubmVjdGlvbi5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgd2hlbiBjb21wbGV0ZS5cbiAgICovXG4gIGFzeW5jIF9kcm9wRm9ya2VkQ29sdW1uT25jZShkYikge1xuICAgIGNvbnN0IG1pZ3JhdGlvblZlcnNpb24gPSBEUk9QX0ZPUktFRF9DT0xVTU5fTUlHUkFUSU9OX1ZFUlNJT05cbiAgICBjb25zdCBtaWdyYXRpb25LZXkgPSB0aGlzLl9taWdyYXRpb25LZXkobWlncmF0aW9uVmVyc2lvbilcblxuICAgIGlmIChhd2FpdCB0aGlzLl9oYXNNaWdyYXRpb24oZGIsIG1pZ3JhdGlvblZlcnNpb24pKSByZXR1cm5cblxuICAgIGF3YWl0IGRiLmFjcXVpcmVBZHZpc29yeUxvY2sobWlncmF0aW9uS2V5KVxuXG4gICAgdHJ5IHtcbiAgICAgIGlmIChhd2FpdCB0aGlzLl9oYXNNaWdyYXRpb24oZGIsIG1pZ3JhdGlvblZlcnNpb24pKSByZXR1cm5cblxuICAgICAgZGIuY2xlYXJTY2hlbWFDYWNoZSgpXG5cbiAgICAgIGlmIChhd2FpdCAoYXdhaXQgZGIuZ2V0VGFibGVCeU5hbWVPckZhaWwoSk9CU19UQUJMRSkpLmdldENvbHVtbkJ5TmFtZShcImZvcmtlZFwiKSkge1xuICAgICAgICBjb25zdCB0YWJsZU5hbWVTcWwgPSBkYi5xdW90ZVRhYmxlKEpPQlNfVEFCTEUpXG4gICAgICAgIGNvbnN0IGV4ZWN1dGlvbk1vZGVDb2x1bW5TcWwgPSBkYi5xdW90ZUNvbHVtbihcImV4ZWN1dGlvbl9tb2RlXCIpXG4gICAgICAgIGNvbnN0IGhhbmRvZmZJZENvbHVtblNxbCA9IGRiLnF1b3RlQ29sdW1uKFwiaGFuZG9mZl9pZFwiKVxuXG4gICAgICAgIC8vIFBvb2xlZCByb3dzIHVzZWQgdG8gcGVyc2lzdCBhcyBleGVjdXRpb25fbW9kZSBcImZvcmtlZFwiICsgYSBwb29sZWQgaGFuZG9mZlxuICAgICAgICAvLyBtYXJrZXI7IHJlY292ZXIgdGhlaXIgcmVhbCBtb2RlIGJlZm9yZSB0aGUgbWFya2VyIGlzIGNsZWFyZWQuXG4gICAgICAgIGF3YWl0IGRiLnF1ZXJ5KFxuICAgICAgICAgIGBVUERBVEUgJHt0YWJsZU5hbWVTcWx9IFNFVCAke2V4ZWN1dGlvbk1vZGVDb2x1bW5TcWx9ID0gJHtkYi5xdW90ZShcInBvb2xlZFwiKX0gYCArXG4gICAgICAgICAgYFdIRVJFICR7ZXhlY3V0aW9uTW9kZUNvbHVtblNxbH0gPSAke2RiLnF1b3RlKFwiZm9ya2VkXCIpfSBgICtcbiAgICAgICAgICBgQU5EICR7aGFuZG9mZklkQ29sdW1uU3FsfSBMSUtFICR7ZGIucXVvdGUoYCR7TEVHQUNZX1BPT0xFRF9IQU5ET0ZGX0lEX1BSRUZJWH0lYCl9YFxuICAgICAgICApXG4gICAgICAgIC8vIFRoZSBxdWV1ZWQtcG9vbGVkIG1hcmtlciB3YXMgYSBzZW50aW5lbCwgbm90IGEgcmVhbCBsZWFzZTsgY2xlYXIgaXQuXG4gICAgICAgIGF3YWl0IGRiLnF1ZXJ5KFxuICAgICAgICAgIGBVUERBVEUgJHt0YWJsZU5hbWVTcWx9IFNFVCAke2hhbmRvZmZJZENvbHVtblNxbH0gPSBOVUxMIGAgK1xuICAgICAgICAgIGBXSEVSRSAke2hhbmRvZmZJZENvbHVtblNxbH0gPSAke2RiLnF1b3RlKExFR0FDWV9QT09MRURfUVVFVUVEX0hBTkRPRkZfSUQpfWBcbiAgICAgICAgKVxuXG4gICAgICAgIGNvbnN0IGRyb3BGb3JrZWQgPSBuZXcgVGFibGVEYXRhKEpPQlNfVEFCTEUpXG4gICAgICAgIGRyb3BGb3JrZWQuYWRkQ29sdW1uKFwiZm9ya2VkXCIsIHtkcm9wQ29sdW1uOiB0cnVlfSlcbiAgICAgICAgZm9yIChjb25zdCBzcWwgb2YgYXdhaXQgZGIuYWx0ZXJUYWJsZVNRTHMoZHJvcEZvcmtlZCkpIGF3YWl0IGRiLnF1ZXJ5KHNxbClcblxuICAgICAgICBkYi5jbGVhclNjaGVtYUNhY2hlKClcbiAgICAgIH1cblxuICAgICAgYXdhaXQgdGhpcy5fcmVjb3JkTWlncmF0aW9uKGRiLCBtaWdyYXRpb25WZXJzaW9uKVxuICAgIH0gZmluYWxseSB7XG4gICAgICBhd2FpdCBkYi5yZWxlYXNlQWR2aXNvcnlMb2NrKG1pZ3JhdGlvbktleSlcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogUnVucyByZWNvcmQgbWlncmF0aW9uLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL2RhdGFiYXNlL2RyaXZlcnMvYmFzZS5qc1wiKS5kZWZhdWx0fSBkYiAtIERhdGFiYXNlIGNvbm5lY3Rpb24uXG4gICAqIEBwYXJhbSB7c3RyaW5nfSB2ZXJzaW9uIC0gTWlncmF0aW9uIHZlcnNpb24uXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIHdoZW4gY29tcGxldGUuXG4gICAqL1xuICBhc3luYyBfcmVjb3JkTWlncmF0aW9uKGRiLCB2ZXJzaW9uKSB7XG4gICAgYXdhaXQgZGIudXBzZXJ0KHtcbiAgICAgIHRhYmxlTmFtZTogTUlHUkFUSU9OU19UQUJMRSxcbiAgICAgIGRhdGE6IHtcbiAgICAgICAga2V5OiB0aGlzLl9taWdyYXRpb25LZXkodmVyc2lvbiksXG4gICAgICAgIHNjb3BlOiBNSUdSQVRJT05fU0NPUEUsXG4gICAgICAgIHZlcnNpb24sXG4gICAgICAgIGFwcGxpZWRfYXRfbXM6IERhdGUubm93KClcbiAgICAgIH0sXG4gICAgICBjb25mbGljdENvbHVtbnM6IFtcImtleVwiXSxcbiAgICAgIHVwZGF0ZUNvbHVtbnM6IFtcInNjb3BlXCIsIFwidmVyc2lvblwiLCBcImFwcGxpZWRfYXRfbXNcIl1cbiAgICB9KVxuICB9XG5cbiAgYXN5bmMgX2luaXRpYWxpemVNb2RlbCgpIHtcbiAgICBpZiAoQmFja2dyb3VuZEpvYlJlY29yZC5pc0luaXRpYWxpemVkKCkpIHJldHVyblxuXG4gICAgQmFja2dyb3VuZEpvYlJlY29yZC5zZXREYXRhYmFzZUlkZW50aWZpZXIodGhpcy5nZXREYXRhYmFzZUlkZW50aWZpZXIoKSlcbiAgICBjb25zdCBwb29sID0gdGhpcy5jb25maWd1cmF0aW9uLmdldERhdGFiYXNlUG9vbCh0aGlzLmdldERhdGFiYXNlSWRlbnRpZmllcigpKVxuXG4gICAgYXdhaXQgcG9vbC53aXRoQ29ubmVjdGlvbih7bmFtZTogXCJCYWNrZ3JvdW5kIGpvYnMgc3RvcmUgaW5pdGlhbGl6ZSBtb2RlbFwifSwgYXN5bmMgKCkgPT4ge1xuICAgICAgYXdhaXQgQmFja2dyb3VuZEpvYlJlY29yZC5pbml0aWFsaXplUmVjb3JkKHtjb25maWd1cmF0aW9uOiB0aGlzLmNvbmZpZ3VyYXRpb259KVxuICAgIH0pXG4gIH1cblxuICAvKipcbiAgICogUnVucyBnZXQgam9iIHJvdyBieSBpZC5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9kYXRhYmFzZS9kcml2ZXJzL2Jhc2UuanNcIikuZGVmYXVsdH0gZGIgLSBEYXRhYmFzZSBjb25uZWN0aW9uLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gam9iSWQgLSBKb2IgaWQuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPGltcG9ydChcIi4vdHlwZXMuanNcIikuQmFja2dyb3VuZEpvYlJvdyB8IG51bGw+fSAtIEpvYiByb3cuXG4gICAqL1xuICBhc3luYyBfZ2V0Sm9iUm93QnlJZChkYiwgam9iSWQpIHtcbiAgICBjb25zdCBxdWVyeSA9IGRiXG4gICAgICAubmV3UXVlcnkoKVxuICAgICAgLmZyb20oSk9CU19UQUJMRSlcbiAgICAgIC53aGVyZSh7aWQ6IGpvYklkfSlcbiAgICAgIC5saW1pdCgxKVxuXG4gICAgY29uc3Qgcm93cyA9IGF3YWl0IHF1ZXJ5LnJlc3VsdHMoKVxuXG4gICAgaWYgKCFyb3dzWzBdKSByZXR1cm4gbnVsbFxuXG4gICAgcmV0dXJuIHRoaXMuX25vcm1hbGl6ZUpvYlJvdyhyb3dzWzBdKVxuICB9XG5cbiAgLyoqXG4gICAqIFJlbGVhc2VzIG93bmVyc2hpcCBvbmx5IHdoZW4gdGhlIGtleSBzdGlsbCBwb2ludHMgYXQgdGhlIGV4cGVjdGVkIGpvYi5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9kYXRhYmFzZS9kcml2ZXJzL2Jhc2UuanNcIikuZGVmYXVsdH0gZGIgLSBEYXRhYmFzZSBjb25uZWN0aW9uLlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIE93bmVyc2hpcCBpZGVudGl0eS5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGFyZ3Muam9iSWQgLSBFeHBlY3RlZCBvd25lciBqb2IgaWQuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBhcmdzLnNjaGVkdWxlS2V5IC0gU3RhYmxlIHNjaGVkdWxlIGtleS5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgd2hlbiBkZWxldGVkIG9yIGFscmVhZHkgc3VwZXJzZWRlZC5cbiAgICovXG4gIGFzeW5jIF9yZWxlYXNlU2NoZWR1bGVPd25lcnNoaXAoZGIsIHtqb2JJZCwgc2NoZWR1bGVLZXl9KSB7XG4gICAgYXdhaXQgZGIuZGVsZXRlKHtcbiAgICAgIHRhYmxlTmFtZTogU0NIRURVTEVfS0VZU19UQUJMRSxcbiAgICAgIGNvbmRpdGlvbnM6IHtqb2JfaWQ6IGpvYklkLCBzY2hlZHVsZV9rZXk6IHNjaGVkdWxlS2V5fVxuICAgIH0pXG4gIH1cblxuICAvKipcbiAgICogUmVsZWFzZXMgYSBqb2IncyBvd25lcnNoaXAgd2hlbiBpdCBoYXMgYSBoaXN0b3JpY2FsIHNjaGVkdWxlIGtleS5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9kYXRhYmFzZS9kcml2ZXJzL2Jhc2UuanNcIikuZGVmYXVsdH0gZGIgLSBEYXRhYmFzZSBjb25uZWN0aW9uLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vdHlwZXMuanNcIikuQmFja2dyb3VuZEpvYlJvd30gam9iIC0gVGVybWluYWwgam9iLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyB3aGVuIGRlbGV0ZWQgb3Igbm90IGFwcGxpY2FibGUuXG4gICAqL1xuICBhc3luYyBfcmVsZWFzZVNjaGVkdWxlT3duZXJzaGlwRm9ySm9iKGRiLCBqb2IpIHtcbiAgICBpZiAoIWpvYi5zY2hlZHVsZUtleSkgcmV0dXJuXG5cbiAgICBhd2FpdCB0aGlzLl9yZWxlYXNlU2NoZWR1bGVPd25lcnNoaXAoZGIsIHtqb2JJZDogam9iLmlkLCBzY2hlZHVsZUtleTogam9iLnNjaGVkdWxlS2V5fSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGFwcGx5IGZhaWx1cmUuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gT3B0aW9ucy5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9kYXRhYmFzZS9kcml2ZXJzL2Jhc2UuanNcIikuZGVmYXVsdH0gYXJncy5kYiAtIERhdGFiYXNlIGNvbm5lY3Rpb24uXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi90eXBlcy5qc1wiKS5CYWNrZ3JvdW5kSm9iUm93fSBhcmdzLmpvYiAtIEpvYiByb3cuXG4gICAqIEBwYXJhbSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59IGFyZ3MuZXJyb3IgLSBFcnJvci5cbiAgICogQHBhcmFtIHtib29sZWFufSBhcmdzLm1hcmtPcnBoYW5lZCAtIFdoZXRoZXIgbWFya2luZyBvcnBoYW5lZC5cbiAgICogQHBhcmFtIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59IFthcmdzLmNvbmRpdGlvbnNdIC0gVXBkYXRlIGZlbmNpbmcgY29uZGl0aW9ucy4gRGVmYXVsdHMgdG8gdGhlIGFjdGl2ZS1oYW5kb2ZmIGxlYXNlIG1hdGNoOyB0aGUgdGltZS1iYXNlZCBvcnBoYW4gc3dlZXAgb3ZlcnJpZGVzIHRoaXMgd2l0aCBhbiBpZC9zdGF0dXMgbWF0Y2ggc28gaXQgY2FuIHJlY2xhaW0gcm93cyB3aG9zZSBgaGFuZG9mZl9pZGAgaXMgbnVsbCAoZS5nLiBoYW5kZWQgb2ZmIGJ5IGFuIG9sZGVyIHZlbG9jaW91cyBiZWZvcmUgaGFuZG9mZi1pZCBmZW5jaW5nIGV4aXN0ZWQpLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxpbXBvcnQoXCIuL3R5cGVzLmpzXCIpLkJhY2tncm91bmRKb2JSb3cgfCBudWxsPn0gLSBVcGRhdGVkIGpvYiByb3cgd2hlbiB0aGUgbGVhc2UgdHJhbnNpdGlvbiB3b24uXG4gICAqL1xuICBhc3luYyBfYXBwbHlGYWlsdXJlKHtkYiwgam9iLCBlcnJvciwgbWFya09ycGhhbmVkLCBjb25kaXRpb25zfSkge1xuICAgIGNvbnN0IG5vdyA9IERhdGUubm93KClcbiAgICBjb25zdCBuZXh0QXR0ZW1wdCA9IChqb2IuYXR0ZW1wdHMgfHwgMCkgKyAxXG4gICAgY29uc3QgbWF4UmV0cmllcyA9IHRoaXMuX25vcm1hbGl6ZU1heFJldHJpZXMoam9iLm1heFJldHJpZXMpXG4gICAgY29uc3Qgc2hvdWxkUmV0cnkgPSBuZXh0QXR0ZW1wdCA8PSBtYXhSZXRyaWVzXG4gICAgY29uc3QgZmFpbHVyZU1lc3NhZ2UgPSBub3JtYWxpemVCYWNrZ3JvdW5kSm9iRXJyb3IoZXJyb3IpXG4gICAgY29uc3Qgc2NoZWR1bGVkQXQgPSBzaG91bGRSZXRyeSA/IG5vdyArIHRoaXMuZ2V0UmV0cnlEZWxheU1zKG5leHRBdHRlbXB0KSA6IGpvYi5zY2hlZHVsZWRBdE1zXG4gICAgY29uc3QgdXBkYXRlID0gdGhpcy5fZmFpbHVyZVVwZGF0ZSh7XG4gICAgICBmYWlsdXJlTWVzc2FnZSxcbiAgICAgIG1hcmtPcnBoYW5lZCxcbiAgICAgIG5leHRBdHRlbXB0LFxuICAgICAgbm93LFxuICAgICAgc2NoZWR1bGVkQXQsXG4gICAgICBzaG91bGRSZXRyeVxuICAgIH0pXG5cbiAgICBhd2FpdCB0aGlzLl9sb2NrQ29uY3VycmVuY3lSb3coZGIsIGpvYi5jb25jdXJyZW5jeUtleSlcbiAgICBjb25zdCBhZmZlY3RlZFJvd3MgPSBhd2FpdCB0aGlzLl91cGRhdGVBZmZlY3RlZFJvd3MoZGIsIHtcbiAgICAgIHRhYmxlTmFtZTogSk9CU19UQUJMRSxcbiAgICAgIGRhdGE6IHVwZGF0ZSxcbiAgICAgIGNvbmRpdGlvbnM6IGNvbmRpdGlvbnMgPz8gdGhpcy5fYWN0aXZlSGFuZG9mZkNvbmRpdGlvbnMoam9iKVxuICAgIH0pXG5cbiAgICBpZiAoYWZmZWN0ZWRSb3dzICE9PSAxKSByZXR1cm4gbnVsbFxuICAgIGlmICghc2hvdWxkUmV0cnkpIGF3YWl0IHRoaXMuX3JlbGVhc2VTY2hlZHVsZU93bmVyc2hpcEZvckpvYihkYiwgam9iKVxuICAgIGF3YWl0IHRoaXMuX3JlbGVhc2VDb25jdXJyZW5jeShkYiwgam9iLmNvbmN1cnJlbmN5S2V5KVxuXG4gICAgLy8gUmV0dXJuIGEgc25hcHNob3Qgb2YgdGhlIHRyYW5zaXRpb24gdGhpcyB1cGRhdGUganVzdCBhcHBsaWVkIHJhdGhlciB0aGFuIHJlLXJlYWRpbmcgdGhlIHJvdy5cbiAgICAvLyBXZSB3b24gdGhlIGNvbmRpdGlvbmFsIHVwZGF0ZSAoYWZmZWN0ZWRSb3dzID09PSAxKSwgc28gdGhpcyBzdGF0ZSBpcyBhdXRob3JpdGF0aXZlOyByZS1yZWFkaW5nXG4gICAgLy8gY291bGQgaW5zdGVhZCBvYnNlcnZlIGEgbmV3ZXIgc3RhdGUgaWYgYW5vdGhlciBkaXNwYXRjaGVyIHJlY2xhaW1zIGEgcmVxdWV1ZWQgam9iIGJldHdlZW4gdGhlXG4gICAgLy8gdXBkYXRlIGFuZCB0aGUgcmVhZCAob3ZlcmxhcHBpbmcgbWFpbnMgLyBwb2xsaW5nIGRpc3BhdGNoKSwgd2hpY2ggd291bGQgbWlzcmVwb3J0IHRoZVxuICAgIC8vIHN0YXR1cy90ZXJtaW5hbC93aWxsUmV0cnkgb2YgdGhpcyB0cmFuc2l0aW9uIHRvIGZhaWx1cmUvb3JwaGFuIGV2ZW50IGxpc3RlbmVycy5cbiAgICBjb25zdCBzdGF0dXMgPSBzaG91bGRSZXRyeSA/IFwicXVldWVkXCIgOiAobWFya09ycGhhbmVkID8gXCJvcnBoYW5lZFwiIDogXCJmYWlsZWRcIilcbiAgICAvKiogQHR5cGUge2ltcG9ydChcIi4vdHlwZXMuanNcIikuQmFja2dyb3VuZEpvYlJvd30gKi9cbiAgICBjb25zdCB0cmFuc2l0aW9uZWRKb2IgPSB7XG4gICAgICAuLi5qb2IsXG4gICAgICBhdHRlbXB0czogbmV4dEF0dGVtcHQsXG4gICAgICBoYW5kZWRPZmZBdE1zOiBudWxsLFxuICAgICAgbGFzdEVycm9yOiBmYWlsdXJlTWVzc2FnZSxcbiAgICAgIHN0YXR1cyxcbiAgICAgIHdvcmtlcklkOiBudWxsXG4gICAgfVxuXG4gICAgaWYgKG1hcmtPcnBoYW5lZCkgdHJhbnNpdGlvbmVkSm9iLm9ycGhhbmVkQXRNcyA9IG5vd1xuICAgIGlmIChzaG91bGRSZXRyeSkge1xuICAgICAgdHJhbnNpdGlvbmVkSm9iLnNjaGVkdWxlZEF0TXMgPSBzY2hlZHVsZWRBdFxuICAgIH0gZWxzZSBpZiAoIW1hcmtPcnBoYW5lZCkge1xuICAgICAgdHJhbnNpdGlvbmVkSm9iLmZhaWxlZEF0TXMgPSBub3dcbiAgICB9XG5cbiAgICByZXR1cm4gdHJhbnNpdGlvbmVkSm9iXG4gIH1cblxuICAvKipcbiAgICogUnVucyBmYWlsdXJlIHVwZGF0ZS5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBPcHRpb25zLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gYXJncy5mYWlsdXJlTWVzc2FnZSAtIExhc3QgZmFpbHVyZSBtZXNzYWdlLlxuICAgKiBAcGFyYW0ge2Jvb2xlYW59IGFyZ3MubWFya09ycGhhbmVkIC0gV2hldGhlciBtYXJraW5nIG9ycGhhbmVkLlxuICAgKiBAcGFyYW0ge251bWJlcn0gYXJncy5uZXh0QXR0ZW1wdCAtIE5leHQgYXR0ZW1wdCBjb3VudC5cbiAgICogQHBhcmFtIHtudW1iZXJ9IGFyZ3Mubm93IC0gQ3VycmVudCB0aW1lc3RhbXAuXG4gICAqIEBwYXJhbSB7bnVtYmVyIHwgbnVsbH0gYXJncy5zY2hlZHVsZWRBdCAtIE5leHQgc2NoZWR1bGVkIHRpbWVzdGFtcC5cbiAgICogQHBhcmFtIHtib29sZWFufSBhcmdzLnNob3VsZFJldHJ5IC0gV2hldGhlciB0aGUgam9iIHNob3VsZCByZXRyeS5cbiAgICogQHJldHVybnMge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gLSBEYXRhYmFzZSB1cGRhdGUgZGF0YS5cbiAgICovXG4gIF9mYWlsdXJlVXBkYXRlKHtmYWlsdXJlTWVzc2FnZSwgbWFya09ycGhhbmVkLCBuZXh0QXR0ZW1wdCwgbm93LCBzY2hlZHVsZWRBdCwgc2hvdWxkUmV0cnl9KSB7XG4gICAgLyoqXG4gICAgICogVXBkYXRlLlxuICAgICAqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59ICovXG4gICAgY29uc3QgdXBkYXRlID0ge1xuICAgICAgYXR0ZW1wdHM6IG5leHRBdHRlbXB0LFxuICAgICAgaGFuZGVkX29mZl9hdF9tczogbnVsbCxcbiAgICAgIHdvcmtlcl9pZDogbnVsbCxcbiAgICAgIGxhc3RfZXJyb3I6IGZhaWx1cmVNZXNzYWdlXG4gICAgfVxuXG4gICAgdGhpcy5fYXBwbHlPcnBoYW5lZEZhaWx1cmVVcGRhdGUoe21hcmtPcnBoYW5lZCwgbm93LCB1cGRhdGV9KVxuICAgIHRoaXMuX2FwcGx5RmFpbHVyZVN0YXR1c1VwZGF0ZSh7bWFya09ycGhhbmVkLCBub3csIHNjaGVkdWxlZEF0LCBzaG91bGRSZXRyeSwgdXBkYXRlfSlcblxuICAgIHJldHVybiB1cGRhdGVcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGFwcGx5IG9ycGhhbmVkIGZhaWx1cmUgdXBkYXRlLlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIE9wdGlvbnMuXG4gICAqIEBwYXJhbSB7Ym9vbGVhbn0gYXJncy5tYXJrT3JwaGFuZWQgLSBXaGV0aGVyIG1hcmtpbmcgb3JwaGFuZWQuXG4gICAqIEBwYXJhbSB7bnVtYmVyfSBhcmdzLm5vdyAtIEN1cnJlbnQgdGltZXN0YW1wLlxuICAgKiBAcGFyYW0ge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gYXJncy51cGRhdGUgLSBEYXRhYmFzZSB1cGRhdGUgZGF0YS5cbiAgICogQHJldHVybnMge3ZvaWR9XG4gICAqL1xuICBfYXBwbHlPcnBoYW5lZEZhaWx1cmVVcGRhdGUoe21hcmtPcnBoYW5lZCwgbm93LCB1cGRhdGV9KSB7XG4gICAgaWYgKG1hcmtPcnBoYW5lZCkgdXBkYXRlLm9ycGhhbmVkX2F0X21zID0gbm93XG4gIH1cblxuICAvKipcbiAgICogUnVucyBhcHBseSBmYWlsdXJlIHN0YXR1cyB1cGRhdGUuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gT3B0aW9ucy5cbiAgICogQHBhcmFtIHtib29sZWFufSBhcmdzLm1hcmtPcnBoYW5lZCAtIFdoZXRoZXIgbWFya2luZyBvcnBoYW5lZC5cbiAgICogQHBhcmFtIHtudW1iZXJ9IGFyZ3Mubm93IC0gQ3VycmVudCB0aW1lc3RhbXAuXG4gICAqIEBwYXJhbSB7bnVtYmVyIHwgbnVsbH0gYXJncy5zY2hlZHVsZWRBdCAtIE5leHQgc2NoZWR1bGVkIHRpbWVzdGFtcC5cbiAgICogQHBhcmFtIHtib29sZWFufSBhcmdzLnNob3VsZFJldHJ5IC0gV2hldGhlciB0aGUgam9iIHNob3VsZCByZXRyeS5cbiAgICogQHBhcmFtIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59IGFyZ3MudXBkYXRlIC0gRGF0YWJhc2UgdXBkYXRlIGRhdGEuXG4gICAqIEByZXR1cm5zIHt2b2lkfVxuICAgKi9cbiAgX2FwcGx5RmFpbHVyZVN0YXR1c1VwZGF0ZSh7bWFya09ycGhhbmVkLCBub3csIHNjaGVkdWxlZEF0LCBzaG91bGRSZXRyeSwgdXBkYXRlfSkge1xuICAgIGlmIChzaG91bGRSZXRyeSkge1xuICAgICAgdXBkYXRlLnN0YXR1cyA9IFwicXVldWVkXCJcbiAgICAgIHVwZGF0ZS5zY2hlZHVsZWRfYXRfbXMgPSBzY2hlZHVsZWRBdFxuICAgICAgcmV0dXJuXG4gICAgfVxuXG4gICAgaWYgKG1hcmtPcnBoYW5lZCkge1xuICAgICAgdXBkYXRlLnN0YXR1cyA9IFwib3JwaGFuZWRcIlxuICAgICAgcmV0dXJuXG4gICAgfVxuXG4gICAgdXBkYXRlLnN0YXR1cyA9IFwiZmFpbGVkXCJcbiAgICB1cGRhdGUuZmFpbGVkX2F0X21zID0gbm93XG4gIH1cblxuICAvKipcbiAgICogUnVucyBub3JtYWxpemUgam9iIHJvdy5cbiAgICogQHBhcmFtIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59IHJvdyAtIFJhdyBkYXRhYmFzZSByb3cuXG4gICAqIEByZXR1cm5zIHtpbXBvcnQoXCIuL3R5cGVzLmpzXCIpLkJhY2tncm91bmRKb2JSb3d9IC0gTm9ybWFsaXplZCBqb2Igcm93LlxuICAgKi9cbiAgX25vcm1hbGl6ZUpvYlJvdyhyb3cpIHtcbiAgICBjb25zdCBoYW5kb2ZmSWQgPSByb3cuaGFuZG9mZl9pZCA/IFN0cmluZyhyb3cuaGFuZG9mZl9pZCkgOiBudWxsXG4gICAgLy8gYGV4ZWN1dGlvbl9tb2RlYCBpcyB0aGUgc2luZ2xlIHNvdXJjZSBvZiB0cnV0aCBmb3IgYSBqb2IncyBydW50aW1lIGFuZCBpc1xuICAgIC8vIHdyaXR0ZW4gb24gZXZlcnkgZW5xdWV1ZTsgdGhlIGRyb3AtZm9ya2VkIG1pZ3JhdGlvbiBiYWNrZmlsbHMgYW55IHByZS1leGlzdGluZ1xuICAgIC8vIHJvd3MgYmVmb3JlIHRoZSBsZWdhY3kgYGZvcmtlZGAgY29sdW1uIGlzIHJlbW92ZWQuXG4gICAgY29uc3QgZXhlY3V0aW9uTW9kZSA9IHJvdy5leGVjdXRpb25fbW9kZSA/IHRoaXMuX25vcm1hbGl6ZUV4ZWN1dGlvbk1vZGVOYW1lKFN0cmluZyhyb3cuZXhlY3V0aW9uX21vZGUpKSA6IERFRkFVTFRfQkFDS0dST1VORF9KT0JfRVhFQ1VUSU9OX01PREVcblxuICAgIHJldHVybiB7XG4gICAgICBpZDogU3RyaW5nKHJvdy5pZCksXG4gICAgICBqb2JOYW1lOiBTdHJpbmcocm93LmpvYl9uYW1lKSxcbiAgICAgIGFyZ3M6IHRoaXMuX3BhcnNlQXJncyhyb3cuYXJnc19qc29uKSxcbiAgICAgIGV4ZWN1dGlvbk1vZGUsXG4gICAgICBxdWV1ZTogcm93LnF1ZXVlID8gU3RyaW5nKHJvdy5xdWV1ZSkgOiBERUZBVUxUX0JBQ0tHUk9VTkRfSk9CX1FVRVVFLFxuICAgICAgc2NoZWR1bGVLZXk6IHJvdy5zY2hlZHVsZV9rZXkgPyBTdHJpbmcocm93LnNjaGVkdWxlX2tleSkgOiBudWxsLFxuICAgICAgc3RhdHVzOiByb3cuc3RhdHVzID8gU3RyaW5nKHJvdy5zdGF0dXMpIDogXCJxdWV1ZWRcIixcbiAgICAgIGF0dGVtcHRzOiB0aGlzLl9ub3JtYWxpemVOdW1iZXIocm93LmF0dGVtcHRzKSxcbiAgICAgIG1heFJldHJpZXM6IHRoaXMuX25vcm1hbGl6ZU51bWJlcihyb3cubWF4X3JldHJpZXMpLFxuICAgICAgc2NoZWR1bGVkQXRNczogdGhpcy5fbm9ybWFsaXplTnVtYmVyKHJvdy5zY2hlZHVsZWRfYXRfbXMpLFxuICAgICAgY3JlYXRlZEF0TXM6IHRoaXMuX25vcm1hbGl6ZU51bWJlcihyb3cuY3JlYXRlZF9hdF9tcyksXG4gICAgICBoYW5kZWRPZmZBdE1zOiB0aGlzLl9ub3JtYWxpemVOdW1iZXIocm93LmhhbmRlZF9vZmZfYXRfbXMpLFxuICAgICAgaGFuZG9mZklkLFxuICAgICAgY29tcGxldGVkQXRNczogdGhpcy5fbm9ybWFsaXplTnVtYmVyKHJvdy5jb21wbGV0ZWRfYXRfbXMpLFxuICAgICAgZmFpbGVkQXRNczogdGhpcy5fbm9ybWFsaXplTnVtYmVyKHJvdy5mYWlsZWRfYXRfbXMpLFxuICAgICAgb3JwaGFuZWRBdE1zOiB0aGlzLl9ub3JtYWxpemVOdW1iZXIocm93Lm9ycGhhbmVkX2F0X21zKSxcbiAgICAgIHdvcmtlcklkOiByb3cud29ya2VyX2lkID8gU3RyaW5nKHJvdy53b3JrZXJfaWQpIDogbnVsbCxcbiAgICAgIGxhc3RFcnJvcjogcm93Lmxhc3RfZXJyb3IgPyBTdHJpbmcocm93Lmxhc3RfZXJyb3IpIDogbnVsbCxcbiAgICAgIGNvbmN1cnJlbmN5S2V5OiByb3cuY29uY3VycmVuY3lfa2V5ID8gU3RyaW5nKHJvdy5jb25jdXJyZW5jeV9rZXkpIDogbnVsbCxcbiAgICAgIG1heENvbmN1cnJlbmN5OiB0aGlzLl9ub3JtYWxpemVOdW1iZXIocm93Lm1heF9jb25jdXJyZW5jeSksXG4gICAgICB0aW1lb3V0TXM6IHRoaXMuX25vcm1hbGl6ZU51bWJlcihyb3cudGltZW91dF9tcylcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogTm9ybWFsaXplcyBhIGpvYidzIHF1ZXVlIG5hbWUsIGRlZmF1bHRpbmcgdG8gXCJkZWZhdWx0XCIuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi90eXBlcy5qc1wiKS5CYWNrZ3JvdW5kSm9iT3B0aW9ucyB8IHVuZGVmaW5lZH0gb3B0aW9ucyAtIEpvYiBvcHRpb25zLlxuICAgKiBAcmV0dXJucyB7c3RyaW5nfSAtIFF1ZXVlIG5hbWUuXG4gICAqL1xuICBfbm9ybWFsaXplUXVldWUob3B0aW9ucykge1xuICAgIHJldHVybiBub3JtYWxpemVCYWNrZ3JvdW5kSm9iUXVldWUob3B0aW9ucylcbiAgfVxuXG4gIC8qKlxuICAgKiBSZXNvbHZlcyBhIGpvYidzIGR1cmFibGUgY29uY3VycmVuY3kuIEFuIGV4cGxpY2l0IGNvbmN1cnJlbmN5S2V5L21heENvbmN1cnJlbmN5XG4gICAqIHBhaXIgYWx3YXlzIHdpbnMuIE90aGVyd2lzZSwgd2hlbiB0aGUgam9iJ3MgcXVldWUgaGFzIGEgY29uZmlndXJlZCBjYXBcbiAgICogKGBiYWNrZ3JvdW5kSm9icy5xdWV1ZXNbcXVldWVdLm1heENvbmN1cnJlbnRgKSwgZGVyaXZlIGEgcXVldWUtc2NvcGVkXG4gICAqIGNvbmN1cnJlbmN5IGtleSBzbyB0aGUgcXVldWUgY2FwIGlzIGVuZm9yY2VkIGNsdXN0ZXItd2lkZSB0aHJvdWdoIHRoZVxuICAgKiBleGlzdGluZyBkdXJhYmxlIGNvbmN1cnJlbmN5IG1lY2hhbmlzbS5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL3R5cGVzLmpzXCIpLkJhY2tncm91bmRKb2JPcHRpb25zIHwgdW5kZWZpbmVkfSBvcHRpb25zIC0gSm9iIG9wdGlvbnMuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBxdWV1ZSAtIE5vcm1hbGl6ZWQgcXVldWUgbmFtZS5cbiAgICogQHJldHVybnMge3tjb25jdXJyZW5jeUtleTogc3RyaW5nLCBtYXhDb25jdXJyZW5jeTogbnVtYmVyLCBxdWV1ZURlcml2ZWQ6IGJvb2xlYW59IHwgbnVsbH0gLSBSZXNvbHZlZCBjb25jdXJyZW5jeS5cbiAgICovXG4gIF9yZXNvbHZlQ29uY3VycmVuY3kob3B0aW9ucywgcXVldWUpIHtcbiAgICByZXR1cm4gbm9ybWFsaXplQmFja2dyb3VuZEpvYkNvbmN1cnJlbmN5KHtcbiAgICAgIG9wdGlvbnM6IG9wdGlvbnMgfHwge30sXG4gICAgICBxdWV1ZSxcbiAgICAgIHF1ZXVlczogdGhpcy5jb25maWd1cmF0aW9uLmdldEJhY2tncm91bmRKb2JzQ29uZmlnKCkucXVldWVzXG4gICAgfSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSZWFkcyB0aGUgY29uZmlndXJlZCBtYXggY29uY3VycmVuY3kgZm9yIGEgcXVldWUgZnJvbSB0aGUgYmFja2dyb3VuZC1qb2JzIGNvbmZpZy5cbiAgICogQHBhcmFtIHtzdHJpbmd9IHF1ZXVlIC0gUXVldWUgbmFtZS5cbiAgICogQHJldHVybnMge251bWJlciB8IG51bGx9IC0gUG9zaXRpdmUgaW50ZWdlciBjYXAsIG9yIG51bGwgd2hlbiB0aGUgcXVldWUgaGFzIG5vIGNvbmZpZ3VyZWQgY2FwLlxuICAgKi9cbiAgX3F1ZXVlTWF4Q29uY3VycmVuY3kocXVldWUpIHtcbiAgICBjb25zdCBxdWV1ZXMgPSB0aGlzLmNvbmZpZ3VyYXRpb24uZ2V0QmFja2dyb3VuZEpvYnNDb25maWcoKS5xdWV1ZXNcbiAgICBjb25zdCBjYXAgPSBxdWV1ZXM/LltxdWV1ZV0/Lm1heENvbmN1cnJlbnRcblxuICAgIGlmIChOdW1iZXIuaXNJbnRlZ2VyKGNhcCkgJiYgTnVtYmVyKGNhcCkgPiAwKSByZXR1cm4gTnVtYmVyKGNhcClcblxuICAgIHJldHVybiBudWxsXG4gIH1cblxuICAvKipcbiAgICogTGlrZSB7QGxpbmsgX2Vuc3VyZUNvbmN1cnJlbmN5S2V5fSwgYnV0IGZvciBxdWV1ZS1kZXJpdmVkIGtleXMgdGhlIGNvbmZpZ3VyZWRcbiAgICogcXVldWUgY2FwIGlzIHRoZSBzb3VyY2Ugb2YgdHJ1dGg6IGlmIGl0IGNoYW5nZWQsIHVwZGF0ZSB0aGUgc3RvcmVkIGNhcFxuICAgKiBpbnN0ZWFkIG9mIHRocm93aW5nIG9uIGNvbmZsaWN0IChjb25maWctZHJpdmVuIGNhcHMgbXVzdCBiZSB0dW5hYmxlKS5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9kYXRhYmFzZS9kcml2ZXJzL2Jhc2UuanNcIikuZGVmYXVsdH0gZGIgLSBEYXRhYmFzZSBjb25uZWN0aW9uLlxuICAgKiBAcGFyYW0ge3tjb25jdXJyZW5jeUtleTogc3RyaW5nLCBtYXhDb25jdXJyZW5jeTogbnVtYmVyfX0gY29uY3VycmVuY3kgLSBDb25jdXJyZW5jeSBjb25maWd1cmF0aW9uLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyB3aGVuIGVuc3VyZWQuXG4gICAqL1xuICBhc3luYyBfZW5zdXJlUXVldWVDb25jdXJyZW5jeUtleShkYiwge2NvbmN1cnJlbmN5S2V5LCBtYXhDb25jdXJyZW5jeX0pIHtcbiAgICBjb25zdCByb3dzID0gYXdhaXQgZGIubmV3UXVlcnkoKS5mcm9tKENPTkNVUlJFTkNZX1RBQkxFKS53aGVyZSh7Y29uY3VycmVuY3lfa2V5OiBjb25jdXJyZW5jeUtleX0pLmxpbWl0KDEpLnJlc3VsdHMoKVxuXG4gICAgaWYgKCFyb3dzWzBdKSB7XG4gICAgICB0cnkge1xuICAgICAgICBhd2FpdCBkYi5pbnNlcnQoe3RhYmxlTmFtZTogQ09OQ1VSUkVOQ1lfVEFCTEUsIGRhdGE6IHthY3RpdmVfY291bnQ6IDAsIGNvbmN1cnJlbmN5X2tleTogY29uY3VycmVuY3lLZXksIG1heF9jb25jdXJyZW5jeTogbWF4Q29uY3VycmVuY3l9fSlcblxuICAgICAgICByZXR1cm5cbiAgICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICAgIGNvbnN0IHJhY2VkUm93cyA9IGF3YWl0IGRiLm5ld1F1ZXJ5KCkuZnJvbShDT05DVVJSRU5DWV9UQUJMRSkud2hlcmUoe2NvbmN1cnJlbmN5X2tleTogY29uY3VycmVuY3lLZXl9KS5saW1pdCgxKS5yZXN1bHRzKClcblxuICAgICAgICBpZiAoIXJhY2VkUm93c1swXSkgdGhyb3cgZXJyb3JcblxuICAgICAgICByb3dzWzBdID0gcmFjZWRSb3dzWzBdXG4gICAgICB9XG4gICAgfVxuXG4gICAgY29uc3QgY29uZmlndXJlZCA9IC8qKiBAdHlwZSB7e21heF9jb25jdXJyZW5jeT86IG51bWJlciB8IHN0cmluZ319ICovIChyb3dzWzBdKVxuXG4gICAgaWYgKHRoaXMuX25vcm1hbGl6ZU51bWJlcihjb25maWd1cmVkLm1heF9jb25jdXJyZW5jeSkgIT09IG1heENvbmN1cnJlbmN5KSB7XG4gICAgICBjb25zdCB0YWJsZSA9IGRiLnF1b3RlVGFibGUoQ09OQ1VSUkVOQ1lfVEFCTEUpXG5cbiAgICAgIGF3YWl0IGRiLnF1ZXJ5KGBVUERBVEUgJHt0YWJsZX0gU0VUICR7ZGIucXVvdGVDb2x1bW4oXCJtYXhfY29uY3VycmVuY3lcIil9ID0gJHtOdW1iZXIobWF4Q29uY3VycmVuY3kpfSBXSEVSRSAke2RiLnF1b3RlQ29sdW1uKFwiY29uY3VycmVuY3lfa2V5XCIpfSA9ICR7ZGIucXVvdGUoY29uY3VycmVuY3lLZXkpfWApXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIEVuc3VyZXMgdGhlIGNvbmN1cnJlbmN5IHN0YXRlIHRhYmxlIGV4aXN0cy5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9kYXRhYmFzZS9kcml2ZXJzL2Jhc2UuanNcIikuZGVmYXVsdH0gZGIgLSBEYXRhYmFzZSBjb25uZWN0aW9uLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyB3aGVuIHJlYWR5LlxuICAgKi9cbiAgYXN5bmMgX2Vuc3VyZUNvbmN1cnJlbmN5VGFibGUoZGIpIHtcbiAgICBpZiAoYXdhaXQgZGIudGFibGVFeGlzdHMoQ09OQ1VSUkVOQ1lfVEFCTEUpKSByZXR1cm5cbiAgICBjb25zdCB0YWJsZSA9IG5ldyBUYWJsZURhdGEoQ09OQ1VSUkVOQ1lfVEFCTEUsIHtpZk5vdEV4aXN0czogdHJ1ZX0pXG4gICAgdGFibGUuc3RyaW5nKFwiY29uY3VycmVuY3lfa2V5XCIsIHtwcmltYXJ5S2V5OiB0cnVlfSlcbiAgICB0YWJsZS5pbnRlZ2VyKFwibWF4X2NvbmN1cnJlbmN5XCIsIHtudWxsOiBmYWxzZX0pXG4gICAgdGFibGUuaW50ZWdlcihcImFjdGl2ZV9jb3VudFwiLCB7bnVsbDogZmFsc2V9KVxuICAgIGF3YWl0IGRiLmNyZWF0ZVRhYmxlKHRhYmxlKVxuICB9XG5cbiAgLyoqXG4gICAqIEVuc3VyZXMgdGhlIHN0YWJsZSBzY2hlZHVsZS1rZXkgb3duZXJzaGlwIHRhYmxlIGV4aXN0cy5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9kYXRhYmFzZS9kcml2ZXJzL2Jhc2UuanNcIikuZGVmYXVsdH0gZGIgLSBEYXRhYmFzZSBjb25uZWN0aW9uLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyB3aGVuIHJlYWR5LlxuICAgKi9cbiAgYXN5bmMgX2Vuc3VyZVNjaGVkdWxlS2V5c1RhYmxlKGRiKSB7XG4gICAgaWYgKGF3YWl0IGRiLnRhYmxlRXhpc3RzKFNDSEVEVUxFX0tFWVNfVEFCTEUpKSByZXR1cm5cblxuICAgIGNvbnN0IGxvY2tOYW1lID0gYCR7TUlHUkFUSU9OX1NDT1BFfTpzY2hlZHVsZV9rZXlzX3RhYmxlYFxuICAgIGNvbnN0IGFjcXVpcmVkID0gYXdhaXQgZGIuYWNxdWlyZUFkdmlzb3J5TG9jayhsb2NrTmFtZSlcblxuICAgIGlmICghYWNxdWlyZWQpIHRocm93IG5ldyBFcnJvcihcIkZhaWxlZCB0byBhY3F1aXJlIGJhY2tncm91bmQgam9icyBzY2hlZHVsZS1rZXkgdGFibGUgc2NoZW1hIGxvY2tcIilcblxuICAgIHRyeSB7XG4gICAgICBkYi5jbGVhclNjaGVtYUNhY2hlKClcbiAgICAgIGlmIChhd2FpdCBkYi50YWJsZUV4aXN0cyhTQ0hFRFVMRV9LRVlTX1RBQkxFKSkgcmV0dXJuXG5cbiAgICAgIGNvbnN0IHRhYmxlID0gbmV3IFRhYmxlRGF0YShTQ0hFRFVMRV9LRVlTX1RBQkxFLCB7aWZOb3RFeGlzdHM6IHRydWV9KVxuXG4gICAgICB0YWJsZS5zdHJpbmcoXCJzY2hlZHVsZV9rZXlcIiwge3ByaW1hcnlLZXk6IHRydWV9KVxuICAgICAgdGFibGUuc3RyaW5nKFwiam9iX2lkXCIsIHtudWxsOiBmYWxzZSwgaW5kZXg6IHRydWV9KVxuICAgICAgYXdhaXQgZGIuY3JlYXRlVGFibGUodGFibGUpXG4gICAgICBkYi5jbGVhclNjaGVtYUNhY2hlKClcbiAgICB9IGZpbmFsbHkge1xuICAgICAgYXdhaXQgZGIucmVsZWFzZUFkdmlzb3J5TG9jayhsb2NrTmFtZSlcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogRW5zdXJlcyBkdXJhYmxlIGdlbmVyaWMgZW5xdWV1ZSBvd25lcnNoaXAgZXhpc3RzIGluZGVwZW5kZW50bHkgb2Ygam9iIHJvd3MuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vZGF0YWJhc2UvZHJpdmVycy9iYXNlLmpzXCIpLmRlZmF1bHR9IGRiIC0gRGF0YWJhc2UgY29ubmVjdGlvbi5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgd2hlbiByZWFkeS5cbiAgICovXG4gIGFzeW5jIF9lbnN1cmVJZGVtcG90ZW5jeUtleXNUYWJsZShkYikge1xuICAgIGlmIChhd2FpdCBkYi50YWJsZUV4aXN0cyhJREVNUE9URU5DWV9LRVlTX1RBQkxFKSkgcmV0dXJuXG5cbiAgICBjb25zdCBsb2NrTmFtZSA9IGAke01JR1JBVElPTl9TQ09QRX06aWRlbXBvdGVuY3lfa2V5c190YWJsZWBcbiAgICBjb25zdCBhY3F1aXJlZCA9IGF3YWl0IGRiLmFjcXVpcmVBZHZpc29yeUxvY2sobG9ja05hbWUpXG5cbiAgICBpZiAoIWFjcXVpcmVkKSB0aHJvdyBuZXcgRXJyb3IoXCJGYWlsZWQgdG8gYWNxdWlyZSBiYWNrZ3JvdW5kIGpvYiBpZGVtcG90ZW5jeS1rZXkgdGFibGUgc2NoZW1hIGxvY2tcIilcblxuICAgIHRyeSB7XG4gICAgICBkYi5jbGVhclNjaGVtYUNhY2hlKClcbiAgICAgIGlmIChhd2FpdCBkYi50YWJsZUV4aXN0cyhJREVNUE9URU5DWV9LRVlTX1RBQkxFKSkgcmV0dXJuXG5cbiAgICAgIGNvbnN0IHRhYmxlID0gbmV3IFRhYmxlRGF0YShJREVNUE9URU5DWV9LRVlTX1RBQkxFLCB7aWZOb3RFeGlzdHM6IHRydWV9KVxuXG4gICAgICB0YWJsZS5zdHJpbmcoXCJzY29wZV9kaWdlc3RcIiwge3ByaW1hcnlLZXk6IHRydWV9KVxuICAgICAgdGFibGUuc3RyaW5nKFwiam9iX25hbWVcIiwge251bGw6IGZhbHNlfSlcbiAgICAgIHRhYmxlLnN0cmluZyhcInF1ZXVlXCIsIHtudWxsOiBmYWxzZX0pXG4gICAgICB0YWJsZS50ZXh0KFwiaWRlbXBvdGVuY3lfa2V5XCIsIHtudWxsOiBmYWxzZX0pXG4gICAgICB0YWJsZS5zdHJpbmcoXCJqb2JfaWRcIiwge2luZGV4OiB0cnVlLCBudWxsOiBmYWxzZX0pXG4gICAgICB0YWJsZS5zdHJpbmcoXCJyZXF1ZXN0X2RpZ2VzdFwiLCB7bnVsbDogZmFsc2V9KVxuICAgICAgdGFibGUuYmlnaW50KFwiY3JlYXRlZF9hdF9tc1wiLCB7bnVsbDogZmFsc2V9KVxuICAgICAgYXdhaXQgZGIuY3JlYXRlVGFibGUodGFibGUpXG4gICAgICBkYi5jbGVhclNjaGVtYUNhY2hlKClcbiAgICB9IGZpbmFsbHkge1xuICAgICAgYXdhaXQgZGIucmVsZWFzZUFkdmlzb3J5TG9jayhsb2NrTmFtZSlcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogRW5zdXJlcyBkdXJhYmxlIHByb3ZpZGVyLWJhY2tlZCBtYWlsIG9wZXJhdGlvbiBzdGF0ZSBleGlzdHMgaW5kZXBlbmRlbnRseSBvZiBqb2JzLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL2RhdGFiYXNlL2RyaXZlcnMvYmFzZS5qc1wiKS5kZWZhdWx0fSBkYiAtIERhdGFiYXNlIGNvbm5lY3Rpb24uXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIHdoZW4gcmVhZHkuXG4gICAqL1xuICBhc3luYyBfZW5zdXJlTWFpbERlbGl2ZXJ5T3BlcmF0aW9uc1RhYmxlKGRiKSB7XG4gICAgaWYgKGF3YWl0IGRiLnRhYmxlRXhpc3RzKE1BSUxfREVMSVZFUllfT1BFUkFUSU9OU19UQUJMRSkpIHJldHVyblxuXG4gICAgY29uc3QgbG9ja05hbWUgPSBgJHtNSUdSQVRJT05fU0NPUEV9Om1haWxfZGVsaXZlcnlfb3BlcmF0aW9uc190YWJsZWBcbiAgICBjb25zdCBhY3F1aXJlZCA9IGF3YWl0IGRiLmFjcXVpcmVBZHZpc29yeUxvY2sobG9ja05hbWUpXG5cbiAgICBpZiAoIWFjcXVpcmVkKSB0aHJvdyBuZXcgRXJyb3IoXCJGYWlsZWQgdG8gYWNxdWlyZSBtYWlsIGRlbGl2ZXJ5IG9wZXJhdGlvbiB0YWJsZSBzY2hlbWEgbG9ja1wiKVxuXG4gICAgdHJ5IHtcbiAgICAgIGRiLmNsZWFyU2NoZW1hQ2FjaGUoKVxuICAgICAgaWYgKGF3YWl0IGRiLnRhYmxlRXhpc3RzKE1BSUxfREVMSVZFUllfT1BFUkFUSU9OU19UQUJMRSkpIHJldHVyblxuXG4gICAgICBjb25zdCB0YWJsZSA9IG5ldyBUYWJsZURhdGEoTUFJTF9ERUxJVkVSWV9PUEVSQVRJT05TX1RBQkxFLCB7aWZOb3RFeGlzdHM6IHRydWV9KVxuXG4gICAgICB0YWJsZS5zdHJpbmcoXCJvcGVyYXRpb25fa2V5XCIsIHtwcmltYXJ5S2V5OiB0cnVlfSlcbiAgICAgIHRhYmxlLnRleHQoXCJvcGVyYXRpb25faWRcIiwge251bGw6IGZhbHNlfSlcbiAgICAgIHRhYmxlLnN0cmluZyhcInBheWxvYWRfZGlnZXN0XCIsIHtudWxsOiBmYWxzZX0pXG4gICAgICB0YWJsZS5zdHJpbmcoXCJiYWNrZ3JvdW5kX2pvYl9pZFwiLCB7aW5kZXg6IHRydWUsIG51bGw6IGZhbHNlfSlcbiAgICAgIHRhYmxlLmJpZ2ludChcImZpcnN0X2F0dGVtcHRfc3RhcnRlZF9hdF9tc1wiLCB7bnVsbDogdHJ1ZX0pXG4gICAgICB0YWJsZS5zdHJpbmcoXCJwcm92aWRlcl9raW5kXCIsIHtudWxsOiBmYWxzZX0pXG4gICAgICB0YWJsZS5iaWdpbnQoXCJwcm92aWRlcl9yZXRlbnRpb25fbXNcIiwge251bGw6IGZhbHNlfSlcbiAgICAgIHRhYmxlLmJpZ2ludChcImNyZWF0ZWRfYXRfbXNcIiwge251bGw6IGZhbHNlfSlcbiAgICAgIGF3YWl0IGRiLmNyZWF0ZVRhYmxlKHRhYmxlKVxuICAgICAgZGIuY2xlYXJTY2hlbWFDYWNoZSgpXG4gICAgfSBmaW5hbGx5IHtcbiAgICAgIGF3YWl0IGRiLnJlbGVhc2VBZHZpc29yeUxvY2sobG9ja05hbWUpXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIEVuc3VyZXMgdGhlIHNpbmdsZXRvbiBkdXJhYmxlIGNvdW50LXJldmlzaW9uIHJvdyBleGlzdHMuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vZGF0YWJhc2UvZHJpdmVycy9iYXNlLmpzXCIpLmRlZmF1bHR9IGRiIC0gRGF0YWJhc2UgY29ubmVjdGlvbi5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IFJlc29sdmVzIHdoZW4gcmVhZHkuXG4gICAqL1xuICBhc3luYyBfZW5zdXJlQ291bnRSZXZpc2lvblRhYmxlKGRiKSB7XG4gICAgaWYgKCEoYXdhaXQgZGIudGFibGVFeGlzdHMoQ09VTlRTX1JFVklTSU9OX1RBQkxFKSkpIHtcbiAgICAgIGNvbnN0IHRhYmxlID0gbmV3IFRhYmxlRGF0YShDT1VOVFNfUkVWSVNJT05fVEFCTEUsIHtpZk5vdEV4aXN0czogdHJ1ZX0pXG5cbiAgICAgIHRhYmxlLnN0cmluZyhcImtleVwiLCB7cHJpbWFyeUtleTogdHJ1ZX0pXG4gICAgICB0YWJsZS5iaWdpbnQoXCJyZXZpc2lvblwiLCB7bnVsbDogZmFsc2V9KVxuICAgICAgYXdhaXQgZGIuY3JlYXRlVGFibGUodGFibGUpXG4gICAgfVxuXG4gICAgY29uc3Qgcm93cyA9IGF3YWl0IGRiLm5ld1F1ZXJ5KCkuZnJvbShDT1VOVFNfUkVWSVNJT05fVEFCTEUpLndoZXJlKHtrZXk6IENPVU5UU19SRVZJU0lPTl9LRVl9KS5saW1pdCgxKS5yZXN1bHRzKClcblxuICAgIGlmIChyb3dzLmxlbmd0aCA+IDApIHJldHVyblxuXG4gICAgdHJ5IHtcbiAgICAgIGF3YWl0IGRiLmluc2VydCh7dGFibGVOYW1lOiBDT1VOVFNfUkVWSVNJT05fVEFCTEUsIGRhdGE6IHtrZXk6IENPVU5UU19SRVZJU0lPTl9LRVksIHJldmlzaW9uOiAwfX0pXG4gICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgIGNvbnN0IHJhY2VkUm93cyA9IGF3YWl0IGRiLm5ld1F1ZXJ5KCkuZnJvbShDT1VOVFNfUkVWSVNJT05fVEFCTEUpLndoZXJlKHtrZXk6IENPVU5UU19SRVZJU0lPTl9LRVl9KS5saW1pdCgxKS5yZXN1bHRzKClcblxuICAgICAgaWYgKHJhY2VkUm93cy5sZW5ndGggPT09IDApIHRocm93IGVycm9yXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIFJlY29yZHMgb25lIGxvZ2ljYWwgY291bnQgbXV0YXRpb24gYXRvbWljYWxseSBhbmQgYnJvYWRjYXN0cyBpdCBhZnRlciBjb21taXQuXG4gICAqIFplcm8gZW50cmllcyBhcmUgb21pdHRlZDsgYSB3aG9sbHkgemVyby1uZXQgbXV0YXRpb24gZG9lcyBub3QgY29uc3VtZSBhIHJldmlzaW9uLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL2RhdGFiYXNlL2RyaXZlcnMvYmFzZS5qc1wiKS5kZWZhdWx0fSBkYiAtIFRyYW5zYWN0aW9uIGNvbm5lY3Rpb24uXG4gICAqIEBwYXJhbSB7UmVjb3JkPHN0cmluZywgbnVtYmVyPn0gcmVxdWVzdGVkRGVsdGFzIC0gU2lnbmVkIGJ1Y2tldCBjaGFuZ2VzLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gUmVzb2x2ZXMgd2hlbiByZWNvcmRlZC5cbiAgICovXG4gIGFzeW5jIF9yZWNvcmRDb3VudERlbHRhKGRiLCByZXF1ZXN0ZWREZWx0YXMpIHtcbiAgICAvKiogQHR5cGUge1JlY29yZDxzdHJpbmcsIG51bWJlcj59ICovXG4gICAgY29uc3QgZGVsdGFzID0ge31cblxuICAgIGZvciAoY29uc3QgYnVja2V0IG9mIEJBQ0tHUk9VTkRfSk9CX0NPVU5UX0JVQ0tFVFMpIHtcbiAgICAgIGNvbnN0IGFtb3VudCA9IHJlcXVlc3RlZERlbHRhc1tidWNrZXRdIHx8IDBcblxuICAgICAgaWYgKCFOdW1iZXIuaXNJbnRlZ2VyKGFtb3VudCkpIHRocm93IG5ldyBFcnJvcihgSW52YWxpZCBiYWNrZ3JvdW5kIGpvYiBjb3VudCBkZWx0YSBmb3IgJHtidWNrZXR9OiAke2Ftb3VudH1gKVxuICAgICAgaWYgKGFtb3VudCAhPT0gMCkgZGVsdGFzW2J1Y2tldF0gPSBhbW91bnRcbiAgICB9XG5cbiAgICBpZiAoT2JqZWN0LmtleXMoZGVsdGFzKS5sZW5ndGggPT09IDApIHJldHVyblxuXG4gICAgY29uc3QgdGFibGUgPSBkYi5xdW90ZVRhYmxlKENPVU5UU19SRVZJU0lPTl9UQUJMRSlcbiAgICBjb25zdCByZXZpc2lvbkNvbHVtbiA9IGRiLnF1b3RlQ29sdW1uKFwicmV2aXNpb25cIilcbiAgICBjb25zdCBhZmZlY3RlZFJvd3MgPSBhd2FpdCBkYi5hZmZlY3RlZFJvd3MoXG4gICAgICBgVVBEQVRFICR7dGFibGV9IFNFVCAke3JldmlzaW9uQ29sdW1ufSA9ICR7cmV2aXNpb25Db2x1bW59ICsgMSBXSEVSRSAke2RiLnF1b3RlQ29sdW1uKFwia2V5XCIpfSA9ICR7ZGIucXVvdGUoQ09VTlRTX1JFVklTSU9OX0tFWSl9YFxuICAgIClcblxuICAgIGlmIChhZmZlY3RlZFJvd3MgIT09IDEpIHRocm93IG5ldyBFcnJvcihcIkJhY2tncm91bmQgam9iIGNvdW50IHJldmlzaW9uIHJvdyBpcyBtaXNzaW5nXCIpXG5cbiAgICBjb25zdCByZXZpc2lvbiA9IGF3YWl0IHRoaXMuX2NvdW50UmV2aXNpb24oZGIpXG4gICAgY29uc3QgYm9keSA9IHtkZWx0YXMsIHJldmlzaW9uLCB0eXBlOiBcImJhY2tncm91bmQtam9iLWNvdW50LWRlbHRhXCJ9XG4gICAgY29uc3QgZGF0YWJhc2VJZGVudGlmaWVyID0gdGhpcy5nZXREYXRhYmFzZUlkZW50aWZpZXIoKSB8fCBcImRlZmF1bHRcIlxuXG4gICAgYXdhaXQgZGIuYWZ0ZXJDb21taXQoKCkgPT4ge1xuICAgICAgdGhpcy5jb25maWd1cmF0aW9uLmJyb2FkY2FzdFRvQ2hhbm5lbChCQUNLR1JPVU5EX0pPQl9DT1VOVFNfQ0hBTk5FTCwge2RhdGFiYXNlSWRlbnRpZmllcn0sIGJvZHkpXG4gICAgfSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSZWNvcmRzIGEgdHJhbnNpdGlvbiBiZXR3ZWVuIHBlcnNpc3RlZCBzdGF0dXNlcy5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9kYXRhYmFzZS9kcml2ZXJzL2Jhc2UuanNcIikuZGVmYXVsdH0gZGIgLSBUcmFuc2FjdGlvbiBjb25uZWN0aW9uLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gb2xkU3RhdHVzIC0gUHJldmlvdXMgc3RhdHVzLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gbmV3U3RhdHVzIC0gTmV3IHN0YXR1cy5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IFJlc29sdmVzIHdoZW4gcmVjb3JkZWQuXG4gICAqL1xuICBhc3luYyBfcmVjb3JkU3RhdHVzVHJhbnNpdGlvbihkYiwgb2xkU3RhdHVzLCBuZXdTdGF0dXMpIHtcbiAgICBjb25zdCBvbGRDb3VudGVkID0gQ09VTlRFRF9KT0JfU1RBVFVTRVMuaW5jbHVkZXMob2xkU3RhdHVzKVxuICAgIGNvbnN0IG5ld0NvdW50ZWQgPSBDT1VOVEVEX0pPQl9TVEFUVVNFUy5pbmNsdWRlcyhuZXdTdGF0dXMpXG5cbiAgICBpZiAoIW9sZENvdW50ZWQgJiYgb2xkU3RhdHVzICE9PSBcImNhbmNlbGxlZFwiKSB0aHJvdyBuZXcgRXJyb3IoYFVua25vd24gcHJldmlvdXMgYmFja2dyb3VuZCBqb2Igc3RhdHVzOiAke29sZFN0YXR1c31gKVxuICAgIGlmICghbmV3Q291bnRlZCAmJiBuZXdTdGF0dXMgIT09IFwiY2FuY2VsbGVkXCIpIHRocm93IG5ldyBFcnJvcihgVW5rbm93biBuZXh0IGJhY2tncm91bmQgam9iIHN0YXR1czogJHtuZXdTdGF0dXN9YClcbiAgICBpZiAob2xkU3RhdHVzID09PSBuZXdTdGF0dXMpIHJldHVyblxuXG4gICAgLyoqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBudW1iZXI+fSAqL1xuICAgIGNvbnN0IGRlbHRhcyA9IHt9XG5cbiAgICBpZiAob2xkQ291bnRlZCkgZGVsdGFzW29sZFN0YXR1c10gPSAtMVxuICAgIGlmIChuZXdDb3VudGVkKSBkZWx0YXNbbmV3U3RhdHVzXSA9IDFcbiAgICBpZiAob2xkQ291bnRlZCAhPT0gbmV3Q291bnRlZCkgZGVsdGFzLmFsbCA9IG5ld0NvdW50ZWQgPyAxIDogLTFcbiAgICBhd2FpdCB0aGlzLl9yZWNvcmRDb3VudERlbHRhKGRiLCBkZWx0YXMpXG4gIH1cblxuICAvKipcbiAgICogUmVhZHMgdGhlIGxvY2tlZCByZXZpc2lvbi5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9kYXRhYmFzZS9kcml2ZXJzL2Jhc2UuanNcIikuZGVmYXVsdH0gZGIgLSBEYXRhYmFzZSBjb25uZWN0aW9uLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxudW1iZXI+fSBSZXZpc2lvbi5cbiAgICovXG4gIGFzeW5jIF9jb3VudFJldmlzaW9uKGRiKSB7XG4gICAgY29uc3Qgcm93cyA9IGF3YWl0IGRiLm5ld1F1ZXJ5KCkuZnJvbShDT1VOVFNfUkVWSVNJT05fVEFCTEUpLnNlbGVjdChcInJldmlzaW9uXCIpLndoZXJlKHtrZXk6IENPVU5UU19SRVZJU0lPTl9LRVl9KS5saW1pdCgxKS5yZXN1bHRzKClcbiAgICBjb25zdCByZXZpc2lvbiA9IHRoaXMuX25vcm1hbGl6ZU51bWJlcigvKiogQHR5cGUge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gKi8gKHJvd3NbMF0gfHwge30pLnJldmlzaW9uKVxuXG4gICAgaWYgKHJldmlzaW9uID09PSBudWxsIHx8ICFOdW1iZXIuaXNTYWZlSW50ZWdlcihyZXZpc2lvbikgfHwgcmV2aXNpb24gPCAwKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoYEludmFsaWQgYmFja2dyb3VuZCBqb2IgY291bnQgcmV2aXNpb246ICR7cmV2aXNpb259YClcbiAgICB9XG5cbiAgICByZXR1cm4gcmV2aXNpb25cbiAgfVxuXG4gIC8qKlxuICAgKiBUYWtlcyBhIHBvcnRhYmxlIHdyaXRlIGxvY2sgb24gdGhlIHNpbmdsZXRvbiByZXZpc2lvbiByb3cuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vZGF0YWJhc2UvZHJpdmVycy9iYXNlLmpzXCIpLmRlZmF1bHR9IGRiIC0gRGF0YWJhc2UgY29ubmVjdGlvbi5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IFJlc29sdmVzIHdoZW4gbG9ja2VkLlxuICAgKi9cbiAgYXN5bmMgX2xvY2tDb3VudFJldmlzaW9uKGRiKSB7XG4gICAgY29uc3QgdGFibGUgPSBkYi5xdW90ZVRhYmxlKENPVU5UU19SRVZJU0lPTl9UQUJMRSlcbiAgICBjb25zdCByZXZpc2lvbiA9IGRiLnF1b3RlQ29sdW1uKFwicmV2aXNpb25cIilcblxuICAgIGF3YWl0IGRiLnF1ZXJ5KGBVUERBVEUgJHt0YWJsZX0gU0VUICR7cmV2aXNpb259ID0gJHtyZXZpc2lvbn0gV0hFUkUgJHtkYi5xdW90ZUNvbHVtbihcImtleVwiKX0gPSAke2RiLnF1b3RlKENPVU5UU19SRVZJU0lPTl9LRVkpfWApXG4gIH1cblxuICAvKipcbiAgICogQnVpbGRzIHplcm9lZCBjYW5vbmljYWwgYnVja2V0cy5cbiAgICogQHJldHVybnMge1JlY29yZDxzdHJpbmcsIG51bWJlcj59IFplcm9lZCBjYW5vbmljYWwgYnVja2V0cy5cbiAgICovXG4gIF9lbXB0eUNvdW50QnVja2V0cygpIHtcbiAgICByZXR1cm4gT2JqZWN0LmZyb21FbnRyaWVzKEJBQ0tHUk9VTkRfSk9CX0NPVU5UX0JVQ0tFVFMubWFwKChidWNrZXQpID0+IFtidWNrZXQsIDBdKSlcbiAgfVxuXG4gIC8qKlxuICAgKiBDb3VudHMgbm9ybWFsaXplZCByb3dzIGJ5IGNhbm9uaWNhbCBzdGF0dXMuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi90eXBlcy5qc1wiKS5CYWNrZ3JvdW5kSm9iUm93W119IGpvYnMgLSBKb2JzLlxuICAgKiBAcmV0dXJucyB7UmVjb3JkPHN0cmluZywgbnVtYmVyPn0gQ291bnRzLlxuICAgKi9cbiAgX3N0YXR1c0NvdW50cyhqb2JzKSB7XG4gICAgLyoqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBudW1iZXI+fSAqL1xuICAgIGNvbnN0IGNvdW50cyA9IHt9XG5cbiAgICBmb3IgKGNvbnN0IGpvYiBvZiBqb2JzKSB7XG4gICAgICBpZiAoIUNPVU5URURfSk9CX1NUQVRVU0VTLmluY2x1ZGVzKGpvYi5zdGF0dXMpKSB0aHJvdyBuZXcgRXJyb3IoYFVua25vd24gYmFja2dyb3VuZCBqb2Igc3RhdHVzOiAke2pvYi5zdGF0dXN9YClcbiAgICAgIGNvdW50c1tqb2Iuc3RhdHVzXSA9IChjb3VudHNbam9iLnN0YXR1c10gfHwgMCkgKyAxXG4gICAgfVxuXG4gICAgcmV0dXJuIGNvdW50c1xuICB9XG5cbiAgLyoqXG4gICAqIFJlYWRzIGEgY2Fub25pY2FsIHNuYXBzaG90IGFmdGVyIGxvY2tpbmcgdGhlIHJldmlzaW9uIHJvdy5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9kYXRhYmFzZS9kcml2ZXJzL2Jhc2UuanNcIikuZGVmYXVsdH0gZGIgLSBUcmFuc2FjdGlvbiBjb25uZWN0aW9uLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx7Y291bnRzOiBSZWNvcmQ8c3RyaW5nLCBudW1iZXI+LCByZXZpc2lvbjogbnVtYmVyLCB0b3RhbDogbnVtYmVyfT59IFNuYXBzaG90LlxuICAgKi9cbiAgYXN5bmMgX2NvdW50U25hcHNob3RPbkxvY2tlZENvbm5lY3Rpb24oZGIpIHtcbiAgICBjb25zdCByb3dzID0gYXdhaXQgZGIubmV3UXVlcnkoKS5mcm9tKEpPQlNfVEFCTEUpLnNlbGVjdChcInN0YXR1c1wiKS5zZWxlY3QoXCJDT1VOVCgqKSBBUyBjb3VudFwiKS5ncm91cChcInN0YXR1c1wiKS5yZXN1bHRzKClcbiAgICBjb25zdCBjb3VudHMgPSB0aGlzLl9lbXB0eUNvdW50QnVja2V0cygpXG4gICAgbGV0IHRvdGFsID0gMFxuXG4gICAgZm9yIChjb25zdCByb3cgb2Ygcm93cykge1xuICAgICAgY29uc3QgdHlwZWRSb3cgPSAvKiogQHR5cGUge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gKi8gKHJvdylcbiAgICAgIGNvbnN0IHN0YXR1cyA9IFN0cmluZyh0eXBlZFJvdy5zdGF0dXMpXG4gICAgICBjb25zdCBjb3VudCA9IHRoaXMuX25vcm1hbGl6ZU51bWJlcih0eXBlZFJvdy5jb3VudCkgfHwgMFxuXG4gICAgICB0b3RhbCArPSBjb3VudFxuXG4gICAgICBpZiAoIUNPVU5URURfSk9CX1NUQVRVU0VTLmluY2x1ZGVzKHN0YXR1cykpIGNvbnRpbnVlXG4gICAgICBjb3VudHNbc3RhdHVzXSA9IGNvdW50XG4gICAgICBjb3VudHMuYWxsICs9IGNvdW50c1tzdGF0dXNdXG4gICAgfVxuXG4gICAgcmV0dXJuIHtjb3VudHMsIHJldmlzaW9uOiBhd2FpdCB0aGlzLl9jb3VudFJldmlzaW9uKGRiKSwgdG90YWx9XG4gIH1cblxuICAvKipcbiAgICogUmVnaXN0ZXJzIG9yIHZlcmlmaWVzIGEgc3RhYmxlIGtleSBjb25maWd1cmF0aW9uLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL2RhdGFiYXNlL2RyaXZlcnMvYmFzZS5qc1wiKS5kZWZhdWx0fSBkYiAtIERhdGFiYXNlIGNvbm5lY3Rpb24uXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBjb25jdXJyZW5jeSAtIENvbmN1cnJlbmN5IGNvbmZpZ3VyYXRpb24uXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBjb25jdXJyZW5jeS5jb25jdXJyZW5jeUtleSAtIENvbmN1cnJlbmN5IGtleS5cbiAgICogQHBhcmFtIHtudW1iZXJ9IGNvbmN1cnJlbmN5Lm1heENvbmN1cnJlbmN5IC0gU3RhYmxlIGNhcC5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgd2hlbiB2ZXJpZmllZC5cbiAgICovXG4gIGFzeW5jIF9lbnN1cmVDb25jdXJyZW5jeUtleShkYiwge2NvbmN1cnJlbmN5S2V5LCBtYXhDb25jdXJyZW5jeX0pIHtcbiAgICBjb25zdCByb3dzID0gYXdhaXQgZGIubmV3UXVlcnkoKS5mcm9tKENPTkNVUlJFTkNZX1RBQkxFKS53aGVyZSh7Y29uY3VycmVuY3lfa2V5OiBjb25jdXJyZW5jeUtleX0pLmxpbWl0KDEpLnJlc3VsdHMoKVxuICAgIGlmICghcm93c1swXSkge1xuICAgICAgdHJ5IHtcbiAgICAgICAgYXdhaXQgZGIuaW5zZXJ0KHt0YWJsZU5hbWU6IENPTkNVUlJFTkNZX1RBQkxFLCBkYXRhOiB7YWN0aXZlX2NvdW50OiAwLCBjb25jdXJyZW5jeV9rZXk6IGNvbmN1cnJlbmN5S2V5LCBtYXhfY29uY3VycmVuY3k6IG1heENvbmN1cnJlbmN5fX0pXG4gICAgICAgIHJldHVyblxuICAgICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgICAgY29uc3QgcmFjZWRSb3dzID0gYXdhaXQgZGIubmV3UXVlcnkoKS5mcm9tKENPTkNVUlJFTkNZX1RBQkxFKS53aGVyZSh7Y29uY3VycmVuY3lfa2V5OiBjb25jdXJyZW5jeUtleX0pLmxpbWl0KDEpLnJlc3VsdHMoKVxuICAgICAgICBpZiAoIXJhY2VkUm93c1swXSkgdGhyb3cgZXJyb3JcbiAgICAgICAgcm93c1swXSA9IHJhY2VkUm93c1swXVxuICAgICAgfVxuICAgIH1cbiAgICBjb25zdCBjb25maWd1cmVkID0gLyoqIEB0eXBlIHt7bWF4X2NvbmN1cnJlbmN5PzogbnVtYmVyIHwgc3RyaW5nfX0gKi8gKHJvd3NbMF0pXG4gICAgaWYgKHRoaXMuX25vcm1hbGl6ZU51bWJlcihjb25maWd1cmVkLm1heF9jb25jdXJyZW5jeSkgIT09IG1heENvbmN1cnJlbmN5KSB0aHJvdyBuZXcgRXJyb3IoYENvbmZsaWN0aW5nIG1heENvbmN1cnJlbmN5IGZvciBiYWNrZ3JvdW5kIGpvYiBjb25jdXJyZW5jeUtleTogJHtjb25jdXJyZW5jeUtleX1gKVxuICB9XG5cbiAgLyoqXG4gICAqIExvY2tzIHRoZSBjb25jdXJyZW5jeSBjb3VudGVyIHJvdyBzbyBhIGpvYi1yZWxlYXNlIHRyYW5zYWN0aW9uIGFjcXVpcmVzIGl0ICpiZWZvcmUqIHRoZSBqb2JcbiAgICogcm93LiB7QGxpbmsgbWFya0hhbmRlZE9mZn0gcmVzZXJ2ZXMgY2FwYWNpdHkgKGxvY2tpbmcgdGhlIGNvdW50ZXIgcm93KSBiZWZvcmUgaXQgdXBkYXRlcyB0aGVcbiAgICogam9iLCBzbyBpdCBsb2NrcyBjb25jdXJyZW5jeS10aGVuLWpvYjsgdGhlIHJlbGVhc2UgcGF0aHMgdXBkYXRlIHRoZSBqb2IgYmVmb3JlIHJlbGVhc2luZ1xuICAgKiBjYXBhY2l0eSwgd2hpY2ggaXMgam9iLXRoZW4tY29uY3VycmVuY3kuIFRob3NlIG9wcG9zaXRlIG9yZGVycyBvbiB0aGUgc2FtZSBzaGFyZWQgY291bnRlciByb3dcbiAgICogYXJlIHdoYXQgZGVhZGxvY2sgKEFCLUJBKSB1bmRlciBhIGRyYWluaW5nIHdvcmtlci4gVGFraW5nIHRoaXMgbG9jayBmaXJzdCBnaXZlcyBldmVyeVxuICAgKiB0cmFuc2FjdGlvbiBhIHNpbmdsZSBjb25jdXJyZW5jeS10aGVuLWpvYiBvcmRlciBhbmQgcmVtb3ZlcyB0aGUgY3ljbGUuXG4gICAqXG4gICAqIFVzZXMgYSB2YWx1ZS1wcmVzZXJ2aW5nIGBVUERBVEVgIHJhdGhlciB0aGFuIGBTRUxFQ1QgLi4uIEZPUiBVUERBVEVgIHNvIGl0IHN0YXlzIHBvcnRhYmxlXG4gICAqIGFjcm9zcyBkcml2ZXJzIHdpdGhvdXQgcm93LWxldmVsIGxvY2tpbmcgcmVhZHMgKGUuZy4gU1FMaXRlKTsgb24gcm93LWxvY2tpbmcgZW5naW5lcyB0aGVcbiAgICogbWF0Y2hlZCByb3cgaXMgd3JpdGUtbG9ja2VkIGZvciB0aGUgcmVzdCBvZiB0aGUgdHJhbnNhY3Rpb24gZXZlbiB0aG91Z2ggaXRzIHZhbHVlIGlzIHVuY2hhbmdlZC5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9kYXRhYmFzZS9kcml2ZXJzL2Jhc2UuanNcIikuZGVmYXVsdH0gZGIgLSBEYXRhYmFzZSBjb25uZWN0aW9uLlxuICAgKiBAcGFyYW0ge3N0cmluZyB8IG51bGx9IGNvbmN1cnJlbmN5S2V5IC0gQ29uY3VycmVuY3kga2V5LlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyB3aGVuIHRoZSBjb3VudGVyIHJvdyBpcyBsb2NrZWQuXG4gICAqL1xuICBhc3luYyBfbG9ja0NvbmN1cnJlbmN5Um93KGRiLCBjb25jdXJyZW5jeUtleSkge1xuICAgIGlmICghY29uY3VycmVuY3lLZXkpIHJldHVyblxuICAgIGNvbnN0IHRhYmxlID0gZGIucXVvdGVUYWJsZShDT05DVVJSRU5DWV9UQUJMRSlcbiAgICBjb25zdCBjb3VudCA9IGRiLnF1b3RlQ29sdW1uKFwiYWN0aXZlX2NvdW50XCIpXG4gICAgYXdhaXQgZGIucXVlcnkoYFVQREFURSAke3RhYmxlfSBTRVQgJHtjb3VudH0gPSAke2NvdW50fSBXSEVSRSAke2RiLnF1b3RlQ29sdW1uKFwiY29uY3VycmVuY3lfa2V5XCIpfSA9ICR7ZGIucXVvdGUoY29uY3VycmVuY3lLZXkpfWApXG4gIH1cblxuICAvKipcbiAgICogQXRvbWljYWxseSByZXNlcnZlcyBjYXBhY2l0eSBmb3IgYSBrZXkuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vZGF0YWJhc2UvZHJpdmVycy9iYXNlLmpzXCIpLmRlZmF1bHR9IGRiIC0gRGF0YWJhc2UgY29ubmVjdGlvbi5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGNvbmN1cnJlbmN5S2V5IC0gQ29uY3VycmVuY3kga2V5LlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxib29sZWFuPn0gLSBXaGV0aGVyIGNhcGFjaXR5IHdhcyByZXNlcnZlZC5cbiAgICovXG4gIGFzeW5jIF9yZXNlcnZlQ29uY3VycmVuY3koZGIsIGNvbmN1cnJlbmN5S2V5KSB7XG4gICAgY29uc3QgdGFibGUgPSBkYi5xdW90ZVRhYmxlKENPTkNVUlJFTkNZX1RBQkxFKVxuICAgIGNvbnN0IGNvdW50ID0gZGIucXVvdGVDb2x1bW4oXCJhY3RpdmVfY291bnRcIilcbiAgICBjb25zdCBhZmZlY3RlZFJvd3MgPSBhd2FpdCBkYi5hZmZlY3RlZFJvd3MoYFVQREFURSAke3RhYmxlfSBTRVQgJHtjb3VudH0gPSAke2NvdW50fSArIDEgV0hFUkUgJHtkYi5xdW90ZUNvbHVtbihcImNvbmN1cnJlbmN5X2tleVwiKX0gPSAke2RiLnF1b3RlKGNvbmN1cnJlbmN5S2V5KX0gQU5EICR7Y291bnR9IDwgJHtkYi5xdW90ZUNvbHVtbihcIm1heF9jb25jdXJyZW5jeVwiKX1gKVxuICAgIHJldHVybiBhZmZlY3RlZFJvd3MgPT09IDFcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGEgcG9ydGFibGUgdXBkYXRlIGFuZCByZXR1cm5zIGl0cyBhZmZlY3RlZC1yb3cgY291bnQuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vZGF0YWJhc2UvZHJpdmVycy9iYXNlLmpzXCIpLmRlZmF1bHR9IGRiIC0gRGF0YWJhc2UgY29ubmVjdGlvbi5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9kYXRhYmFzZS9kcml2ZXJzL2Jhc2UuanNcIikuVXBkYXRlU3FsQXJnc1R5cGV9IGFyZ3MgLSBVcGRhdGUgb3B0aW9ucy5cbiAgICogQHJldHVybnMge1Byb21pc2U8bnVtYmVyPn0gLSBBZmZlY3RlZCByb3cgY291bnQuXG4gICAqL1xuICBhc3luYyBfdXBkYXRlQWZmZWN0ZWRSb3dzKGRiLCBhcmdzKSB7XG4gICAgcmV0dXJuIGF3YWl0IGRiLmFmZmVjdGVkUm93cyhkYi51cGRhdGVTcWwoYXJncykpXG4gIH1cblxuICAvKipcbiAgICogUmVsZWFzZXMgY2FwYWNpdHkgZm9yIGEga2V5LlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL2RhdGFiYXNlL2RyaXZlcnMvYmFzZS5qc1wiKS5kZWZhdWx0fSBkYiAtIERhdGFiYXNlIGNvbm5lY3Rpb24uXG4gICAqIEBwYXJhbSB7c3RyaW5nIHwgbnVsbH0gY29uY3VycmVuY3lLZXkgLSBDb25jdXJyZW5jeSBrZXkuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIHdoZW4gcmVsZWFzZWQuXG4gICAqL1xuICBhc3luYyBfcmVsZWFzZUNvbmN1cnJlbmN5KGRiLCBjb25jdXJyZW5jeUtleSkge1xuICAgIGlmICghY29uY3VycmVuY3lLZXkpIHJldHVyblxuICAgIGNvbnN0IHRhYmxlID0gZGIucXVvdGVUYWJsZShDT05DVVJSRU5DWV9UQUJMRSlcbiAgICBjb25zdCBjb3VudCA9IGRiLnF1b3RlQ29sdW1uKFwiYWN0aXZlX2NvdW50XCIpXG4gICAgYXdhaXQgZGIucXVlcnkoYFVQREFURSAke3RhYmxlfSBTRVQgJHtjb3VudH0gPSAke2NvdW50fSAtIDEgV0hFUkUgJHtkYi5xdW90ZUNvbHVtbihcImNvbmN1cnJlbmN5X2tleVwiKX0gPSAke2RiLnF1b3RlKGNvbmN1cnJlbmN5S2V5KX0gQU5EICR7Y291bnR9ID4gMGApXG4gIH1cblxuICAvKipcbiAgICogUmVidWlsZHMgZHVyYWJsZSBjb3VudHMgZnJvbSBhY3RpdmUgaGFuZG9mZnMuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vZGF0YWJhc2UvZHJpdmVycy9iYXNlLmpzXCIpLmRlZmF1bHR9IGRiIC0gRGF0YWJhc2UgY29ubmVjdGlvbi5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgd2hlbiByZWNvbmNpbGVkLlxuICAgKi9cbiAgYXN5bmMgX3JlY29uY2lsZUNvbmN1cnJlbmN5KGRiKSB7XG4gICAgaWYgKCEoYXdhaXQgZGIudGFibGVFeGlzdHMoQ09OQ1VSUkVOQ1lfVEFCTEUpKSkgcmV0dXJuXG4gICAgY29uc3QgYWN0aXZlUm93cyA9IGF3YWl0IGRiXG4gICAgICAubmV3UXVlcnkoKVxuICAgICAgLmZyb20oSk9CU19UQUJMRSlcbiAgICAgIC5zZWxlY3QoXCJjb25jdXJyZW5jeV9rZXlcIilcbiAgICAgIC53aGVyZSh7c3RhdHVzOiBcImhhbmRlZF9vZmZcIn0pXG4gICAgICAud2hlcmUoYCR7ZGIucXVvdGVDb2x1bW4oXCJjb25jdXJyZW5jeV9rZXlcIil9IElTIE5PVCBOVUxMYClcbiAgICAgIC5ncm91cChcImNvbmN1cnJlbmN5X2tleVwiKVxuICAgICAgLnJlc3VsdHMoKVxuICAgIGNvbnN0IHN0YWxlUm93cyA9IGF3YWl0IGRiXG4gICAgICAubmV3UXVlcnkoKVxuICAgICAgLmZyb20oQ09OQ1VSUkVOQ1lfVEFCTEUpXG4gICAgICAuc2VsZWN0KFwiY29uY3VycmVuY3lfa2V5XCIpXG4gICAgICAud2hlcmUoYCR7ZGIucXVvdGVDb2x1bW4oXCJhY3RpdmVfY291bnRcIil9ICE9IDBgKVxuICAgICAgLnJlc3VsdHMoKVxuICAgIGNvbnN0IGNvbmN1cnJlbmN5S2V5cyA9IG5ldyBTZXQoXG4gICAgICBbLi4uYWN0aXZlUm93cywgLi4uc3RhbGVSb3dzXS5tYXAoKHJvdykgPT5cbiAgICAgICAgU3RyaW5nKC8qKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSAqLyAocm93KS5jb25jdXJyZW5jeV9rZXkpXG4gICAgICApXG4gICAgKVxuXG4gICAgZm9yIChjb25zdCBjb25jdXJyZW5jeUtleSBvZiBbLi4uY29uY3VycmVuY3lLZXlzXS5zb3J0KCkpIHtcbiAgICAgIGF3YWl0IHRoaXMuX3RyYW5zYWN0aW9uUmVzdWx0KGRiLCBhc3luYyAoKSA9PiB7XG4gICAgICAgIGF3YWl0IHRoaXMuX3JlY29uY2lsZUNvbmN1cnJlbmN5S2V5KGRiLCBjb25jdXJyZW5jeUtleSlcbiAgICAgIH0pXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIFJlYnVpbGRzIG9uZSBjb3VudGVyIGFmdGVyIGxvY2tpbmcgaXQgYWhlYWQgb2YgdGhlIGpvYiByb3dzLCBtYXRjaGluZyB0aGVcbiAgICogbG9jayBvcmRlciB1c2VkIGJ5IGhhbmRvZmYgYW5kIGNvbXBsZXRpb24gdHJhbnNpdGlvbnMuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vZGF0YWJhc2UvZHJpdmVycy9iYXNlLmpzXCIpLmRlZmF1bHR9IGRiIC0gRGF0YWJhc2UgY29ubmVjdGlvbi5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGNvbmN1cnJlbmN5S2V5IC0gQ291bnRlciBrZXkuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIHdoZW4gcmVjb25jaWxlZC5cbiAgICovXG4gIGFzeW5jIF9yZWNvbmNpbGVDb25jdXJyZW5jeUtleShkYiwgY29uY3VycmVuY3lLZXkpIHtcbiAgICBhd2FpdCB0aGlzLl9sb2NrQ29uY3VycmVuY3lSb3coZGIsIGNvbmN1cnJlbmN5S2V5KVxuICAgIGNvbnN0IHJvd3MgPSBhd2FpdCBkYlxuICAgICAgLm5ld1F1ZXJ5KClcbiAgICAgIC5mcm9tKEpPQlNfVEFCTEUpXG4gICAgICAuc2VsZWN0KFwiQ09VTlQoKikgQVMgYWN0aXZlX2NvdW50XCIpXG4gICAgICAud2hlcmUoe2NvbmN1cnJlbmN5X2tleTogY29uY3VycmVuY3lLZXksIHN0YXR1czogXCJoYW5kZWRfb2ZmXCJ9KVxuICAgICAgLnJlc3VsdHMoKVxuICAgIGNvbnN0IGFjdGl2ZUNvdW50ID0gdGhpcy5fbm9ybWFsaXplTnVtYmVyKFxuICAgICAgLyoqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59ICovIChyb3dzWzBdIHx8IHt9KS5hY3RpdmVfY291bnRcbiAgICApXG5cbiAgICBpZiAoYWN0aXZlQ291bnQgPT09IG51bGwgfHwgIU51bWJlci5pc1NhZmVJbnRlZ2VyKGFjdGl2ZUNvdW50KSB8fCBhY3RpdmVDb3VudCA8IDApIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihgSW52YWxpZCByZWNvbmNpbGVkIGJhY2tncm91bmQgam9iIGNvbmN1cnJlbmN5IGNvdW50IGZvciAke2NvbmN1cnJlbmN5S2V5fTogJHthY3RpdmVDb3VudH1gKVxuICAgIH1cblxuICAgIGF3YWl0IGRiLnVwZGF0ZSh7XG4gICAgICB0YWJsZU5hbWU6IENPTkNVUlJFTkNZX1RBQkxFLFxuICAgICAgZGF0YToge2FjdGl2ZV9jb3VudDogYWN0aXZlQ291bnR9LFxuICAgICAgY29uZGl0aW9uczoge2NvbmN1cnJlbmN5X2tleTogY29uY3VycmVuY3lLZXl9XG4gICAgfSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSZWNvbmNpbGVzIHF1ZXVlLWRlcml2ZWQgY29uY3VycmVuY3kgd2l0aCB0aGUgY3VycmVudCBjb25maWd1cmF0aW9uLiBPbmx5XG4gICAqIGludm9rZWQgdGhyb3VnaCB7QGxpbmsgcmVjb25jaWxlUXVldWVDb25jdXJyZW5jeX0g4oCUIHRoZSBleHBsaWNpdCBsaWZlY3ljbGVcbiAgICogcGF0aCBydW4gYXQgbWFpbi1wcm9jZXNzIHN0YXJ0dXAgdW5kZXIgYSBjcm9zcy1wcm9jZXNzIGFkdmlzb3J5IGxvY2sg4oCUXG4gICAqIG5ldmVyIGZyb20gc2NoZW1hL3RlbmFudCBjaGVja3Mgb3Igcm91dGluZSBjb25uZWN0aW9uIGluaXRpYWxpemF0aW9uLFxuICAgKiB3aGljaCBzdGF5IHJlYWQtb25seSByZWdhcmRpbmcgcXVldWVkIGpvYiByb3dzLiBUaGUgcGVyLXByb2Nlc3MgbWVtbyBpc1xuICAgKiBsYXRjaGVkIGJ5IHtAbGluayByZWNvbmNpbGVRdWV1ZUNvbmN1cnJlbmN5fSBvbmx5IGFmdGVyIHRoZSBmb2xsb3dpbmdcbiAgICogY291bnQgcmVidWlsZCBhbHNvIHN1Y2NlZWRzLCBzbyBhIGZhaWxlZCByZWJ1aWxkIHJlLWVudGVycyBoZXJlIG9uIHJldHJ5XG4gICAqICh0aGUgYWRvcHRpb24gVVBEQVRFcyBiZWxvdyBhcmUgaWRlbXBvdGVudCkuIEVucXVldWUgb25seSBjb25zdWx0cyBjb25maWcgZm9yIG5ldyBqb2JzLCBzbyBhIGNhcCBhZGRlZCwgcmVtb3ZlZCwgb3IgY2hhbmdlZFxuICAgKiB3aGlsZSBhIGJhY2tsb2cgZXhpc3RzIG90aGVyd2lzZSBsZWF2ZXMgcGVyc2lzdGVkIHJvd3Mgc3RhbGU6IHByZS1jYXAgam9ic1xuICAgKiBrZWVwIGEgbnVsbCBrZXkgYW5kIGJ5cGFzcyB0aGUgY2FwLCBwb3N0LXJlbW92YWwgam9icyBzdGF5IGNhcHBlZCB1bmRlciBhXG4gICAqIG5vdy11bmNvbmZpZ3VyZWQga2V5LCBhbmQgYSBjaGFuZ2VkIG51bWVyaWMgY2FwIHN0YXlzIHN0YWxlIHVudGlsIHRoZSBuZXh0XG4gICAqIGVucXVldWUuIEJyaW5nIHRoZSBkdXJhYmxlIHN0YXRlIGluIGxpbmUgd2l0aCBjb25maWc6IHN5bmMgZWFjaCBjb25maWd1cmVkXG4gICAqIHF1ZXVlJ3Mgc3RvcmVkIGNhcCwgYWRvcHQgbm90LXlldC1rZXllZCBub24tdGVybWluYWwgam9icyBvbnRvIHRoZWlyIHF1ZXVlXG4gICAqIGtleSwgYW5kIHJlbGVhc2Ugbm9uLXRlcm1pbmFsIGpvYnMgZnJvbSBxdWV1ZSBrZXlzIHdob3NlIHF1ZXVlIGlzIG5vXG4gICAqIGxvbmdlciBjYXBwZWQuIFJ1bnMgYmVmb3JlIHtAbGluayBfcmVjb25jaWxlQ29uY3VycmVuY3l9IHNvIHRoZSByZWJ1aWx0XG4gICAqIGFjdGl2ZSBjb3VudHMgcmVmbGVjdCB0aGUgYWRvcHRlZC9yZWxlYXNlZCBrZXlzLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL2RhdGFiYXNlL2RyaXZlcnMvYmFzZS5qc1wiKS5kZWZhdWx0fSBkYiAtIERhdGFiYXNlIGNvbm5lY3Rpb24uXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIHdoZW4gcmVjb25jaWxlZC5cbiAgICovXG4gIGFzeW5jIF9yZWNvbmNpbGVRdWV1ZUNvbmN1cnJlbmN5KGRiKSB7XG4gICAgaWYgKHRoaXMuX3F1ZXVlQ29uY3VycmVuY3lSZWNvbmNpbGVkKSByZXR1cm5cbiAgICBpZiAoIShhd2FpdCBkYi50YWJsZUV4aXN0cyhDT05DVVJSRU5DWV9UQUJMRSkpKSByZXR1cm5cblxuICAgIGNvbnN0IHF1ZXVlc0NvbmZpZyA9IHRoaXMuY29uZmlndXJhdGlvbi5nZXRCYWNrZ3JvdW5kSm9ic0NvbmZpZygpLnF1ZXVlcyB8fCB7fVxuICAgIGNvbnN0IGpvYnNUYWJsZSA9IGRiLnF1b3RlVGFibGUoSk9CU19UQUJMRSlcbiAgICBjb25zdCBrZXlDb2x1bW4gPSBkYi5xdW90ZUNvbHVtbihcImNvbmN1cnJlbmN5X2tleVwiKVxuICAgIGNvbnN0IGNhcENvbHVtbiA9IGRiLnF1b3RlQ29sdW1uKFwibWF4X2NvbmN1cnJlbmN5XCIpXG4gICAgY29uc3QgcXVldWVDb2x1bW4gPSBkYi5xdW90ZUNvbHVtbihcInF1ZXVlXCIpXG4gICAgY29uc3Qgbm9uVGVybWluYWwgPSBgJHtkYi5xdW90ZUNvbHVtbihcInN0YXR1c1wiKX0gSU4gKCR7ZGIucXVvdGUoXCJxdWV1ZWRcIil9LCAke2RiLnF1b3RlKFwiaGFuZGVkX29mZlwiKX0pYFxuICAgIC8qKiBAdHlwZSB7U2V0PHN0cmluZz59ICovXG4gICAgY29uc3QgY2FwcGVkUXVldWVzID0gbmV3IFNldCgpXG5cbiAgICBmb3IgKGNvbnN0IHF1ZXVlIG9mIE9iamVjdC5rZXlzKHF1ZXVlc0NvbmZpZykpIHtcbiAgICAgIGNvbnN0IGNhcCA9IHRoaXMuX3F1ZXVlTWF4Q29uY3VycmVuY3kocXVldWUpXG5cbiAgICAgIGlmIChjYXAgPT09IG51bGwpIGNvbnRpbnVlXG5cbiAgICAgIGNhcHBlZFF1ZXVlcy5hZGQocXVldWUpXG4gICAgICBjb25zdCBjb25jdXJyZW5jeUtleSA9IGAke1FVRVVFX0NPTkNVUlJFTkNZX0tFWV9QUkVGSVh9JHtxdWV1ZX1gXG5cbiAgICAgIGF3YWl0IHRoaXMuX2Vuc3VyZVF1ZXVlQ29uY3VycmVuY3lLZXkoZGIsIHtjb25jdXJyZW5jeUtleSwgbWF4Q29uY3VycmVuY3k6IGNhcH0pXG4gICAgICBhd2FpdCBkYi5xdWVyeShcbiAgICAgICAgYFVQREFURSAke2pvYnNUYWJsZX0gU0VUICR7a2V5Q29sdW1ufSA9ICR7ZGIucXVvdGUoY29uY3VycmVuY3lLZXkpfSwgJHtjYXBDb2x1bW59ID0gJHtOdW1iZXIoY2FwKX0gYCArXG4gICAgICAgIGBXSEVSRSAke3F1ZXVlQ29sdW1ufSA9ICR7ZGIucXVvdGUocXVldWUpfSBBTkQgJHtrZXlDb2x1bW59IElTIE5VTEwgQU5EICR7bm9uVGVybWluYWx9YFxuICAgICAgKVxuICAgIH1cblxuICAgIGNvbnN0IGNvbmN1cnJlbmN5Um93cyA9IGF3YWl0IGRiXG4gICAgICAubmV3UXVlcnkoKVxuICAgICAgLmZyb20oQ09OQ1VSUkVOQ1lfVEFCTEUpXG4gICAgICAuc2VsZWN0KFwiY29uY3VycmVuY3lfa2V5XCIpXG4gICAgICAud2hlcmUoYCR7ZGIucXVvdGVDb2x1bW4oXCJjb25jdXJyZW5jeV9rZXlcIil9IExJS0UgJHtkYi5xdW90ZShgJHtRVUVVRV9DT05DVVJSRU5DWV9LRVlfUFJFRklYfSVgKX1gKVxuICAgICAgLnJlc3VsdHMoKVxuXG4gICAgZm9yIChjb25zdCByb3cgb2YgY29uY3VycmVuY3lSb3dzKSB7XG4gICAgICBjb25zdCBjb25jdXJyZW5jeUtleSA9IFN0cmluZygvKiogQHR5cGUge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gKi8gKHJvdykuY29uY3VycmVuY3lfa2V5KVxuXG4gICAgICBpZiAoIWNvbmN1cnJlbmN5S2V5LnN0YXJ0c1dpdGgoUVVFVUVfQ09OQ1VSUkVOQ1lfS0VZX1BSRUZJWCkpIGNvbnRpbnVlXG4gICAgICBpZiAoY2FwcGVkUXVldWVzLmhhcyhjb25jdXJyZW5jeUtleS5zbGljZShRVUVVRV9DT05DVVJSRU5DWV9LRVlfUFJFRklYLmxlbmd0aCkpKSBjb250aW51ZVxuXG4gICAgICBhd2FpdCBkYi5xdWVyeShcbiAgICAgICAgYFVQREFURSAke2pvYnNUYWJsZX0gU0VUICR7a2V5Q29sdW1ufSA9IE5VTEwsICR7Y2FwQ29sdW1ufSA9IE5VTEwgYCArXG4gICAgICAgIGBXSEVSRSAke2tleUNvbHVtbn0gPSAke2RiLnF1b3RlKGNvbmN1cnJlbmN5S2V5KX0gQU5EICR7bm9uVGVybWluYWx9YFxuICAgICAgKVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIG5vcm1hbGl6ZSBudW1iZXIuXG4gICAqIEBwYXJhbSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59IHZhbHVlIC0gSW5wdXQgdmFsdWUuXG4gICAqIEByZXR1cm5zIHtudW1iZXIgfCBudWxsfSAtIE5vcm1hbGl6ZWQgbnVtYmVyLlxuICAgKi9cbiAgX25vcm1hbGl6ZU51bWJlcih2YWx1ZSkge1xuICAgIGlmICh2YWx1ZSA9PT0gbnVsbCB8fCB2YWx1ZSA9PT0gdW5kZWZpbmVkIHx8IHZhbHVlID09PSBcIlwiKSByZXR1cm4gbnVsbFxuXG4gICAgY29uc3QgbnVtZXJpYyA9IE51bWJlcih2YWx1ZSlcblxuICAgIGlmIChOdW1iZXIuaXNOYU4obnVtZXJpYykpIHJldHVybiBudWxsXG5cbiAgICByZXR1cm4gbnVtZXJpY1xuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgbm9ybWFsaXplIGV4ZWN1dGlvbiBtb2RlLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vdHlwZXMuanNcIikuQmFja2dyb3VuZEpvYk9wdGlvbnN9IFtvcHRpb25zXSAtIEpvYiBvcHRpb25zLlxuICAgKiBAcmV0dXJucyB7aW1wb3J0KFwiLi90eXBlcy5qc1wiKS5CYWNrZ3JvdW5kSm9iRXhlY3V0aW9uTW9kZX0gLSBOb3JtYWxpemVkIGV4ZWN1dGlvbiBtb2RlLlxuICAgKi9cbiAgX25vcm1hbGl6ZUV4ZWN1dGlvbk1vZGUob3B0aW9ucykge1xuICAgIHJldHVybiBub3JtYWxpemVCYWNrZ3JvdW5kSm9iRXhlY3V0aW9uTW9kZShvcHRpb25zIHx8IHt9LCBERUZBVUxUX0JBQ0tHUk9VTkRfSk9CX0VYRUNVVElPTl9NT0RFKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgbm9ybWFsaXplIGV4ZWN1dGlvbiBtb2RlIG5hbWUuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBleGVjdXRpb25Nb2RlIC0gRXhlY3V0aW9uIG1vZGUgbmFtZS5cbiAgICogQHJldHVybnMge2ltcG9ydChcIi4vdHlwZXMuanNcIikuQmFja2dyb3VuZEpvYkV4ZWN1dGlvbk1vZGV9IC0gTm9ybWFsaXplZCBleGVjdXRpb24gbW9kZS5cbiAgICovXG4gIF9ub3JtYWxpemVFeGVjdXRpb25Nb2RlTmFtZShleGVjdXRpb25Nb2RlKSB7XG4gICAgcmV0dXJuIG5vcm1hbGl6ZUJhY2tncm91bmRKb2JFeGVjdXRpb25Nb2RlKFxuICAgICAge2V4ZWN1dGlvbk1vZGU6IC8qKiBAdHlwZSB7aW1wb3J0KFwiLi90eXBlcy5qc1wiKS5CYWNrZ3JvdW5kSm9iRXhlY3V0aW9uTW9kZX0gKi8gKGV4ZWN1dGlvbk1vZGUpfSxcbiAgICAgIERFRkFVTFRfQkFDS0dST1VORF9KT0JfRVhFQ1VUSU9OX01PREUsXG4gICAgICBCQUNLR1JPVU5EX0pPQl9FWEVDVVRJT05fTU9ERVNcbiAgICApXG4gIH1cblxuICAvKipcbiAgICogRmlsdGVycyBxdWV1ZWQgam9icyBieSBvbmUgb3IgbW9yZSBleGVjdXRpb24gbW9kZXMgYWdhaW5zdCB0aGVcbiAgICogYGV4ZWN1dGlvbl9tb2RlYCBjb2x1bW4gKHRoZSBzaW5nbGUgc291cmNlIG9mIHRydXRoKS5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBPcHRpb25zLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL2RhdGFiYXNlL2RyaXZlcnMvYmFzZS5qc1wiKS5kZWZhdWx0fSBhcmdzLmRiIC0gRGF0YWJhc2UgY29ubmVjdGlvbi5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL3R5cGVzLmpzXCIpLkJhY2tncm91bmRKb2JFeGVjdXRpb25Nb2RlIHwgaW1wb3J0KFwiLi90eXBlcy5qc1wiKS5CYWNrZ3JvdW5kSm9iRXhlY3V0aW9uTW9kZVtdfSBhcmdzLmV4ZWN1dGlvbk1vZGUgLSBSdW50aW1lIG1vZGVzLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL2RhdGFiYXNlL3F1ZXJ5L2luZGV4LmpzXCIpLmRlZmF1bHR9IGFyZ3MucXVlcnkgLSBRdWVyeSB0byBmaWx0ZXIuXG4gICAqIEByZXR1cm5zIHtpbXBvcnQoXCIuLi9kYXRhYmFzZS9xdWVyeS9pbmRleC5qc1wiKS5kZWZhdWx0fSAtIEZpbHRlcmVkIHF1ZXJ5LlxuICAgKi9cbiAgX3doZXJlRXhlY3V0aW9uTW9kZSh7ZGIsIGV4ZWN1dGlvbk1vZGUsIHF1ZXJ5fSkge1xuICAgIGNvbnN0IGV4ZWN1dGlvbk1vZGVzID0gQXJyYXkuaXNBcnJheShleGVjdXRpb25Nb2RlKSA/IGV4ZWN1dGlvbk1vZGUgOiBbZXhlY3V0aW9uTW9kZV1cbiAgICBjb25zdCBleGVjdXRpb25Nb2RlQ29sdW1uID0gZGIucXVvdGVDb2x1bW4oXCJleGVjdXRpb25fbW9kZVwiKVxuICAgIGNvbnN0IGNvbmRpdGlvbnMgPSBleGVjdXRpb25Nb2Rlcy5tYXAoKG1vZGUpID0+IGAke2V4ZWN1dGlvbk1vZGVDb2x1bW59ID0gJHtkYi5xdW90ZShtb2RlKX1gKVxuXG4gICAgcmV0dXJuIHF1ZXJ5LndoZXJlKGAoJHtjb25kaXRpb25zLmpvaW4oXCIgT1IgXCIpfSlgKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgcGFyc2UgYXJncy5cbiAgICogQHBhcmFtIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gdmFsdWUgLSBJbnB1dCB2YWx1ZS5cbiAgICogQHJldHVybnMge0FycmF5PFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gLSBQYXJzZWQgYXJncy5cbiAgICovXG4gIF9wYXJzZUFyZ3ModmFsdWUpIHtcbiAgICBpZiAoIXZhbHVlKSByZXR1cm4gW11cblxuICAgIHRyeSB7XG4gICAgICBjb25zdCBwYXJzZWQgPSBKU09OLnBhcnNlKFN0cmluZyh2YWx1ZSkpXG5cbiAgICAgIGlmIChBcnJheS5pc0FycmF5KHBhcnNlZCkpIHJldHVybiBwYXJzZWRcbiAgICB9IGNhdGNoIHtcbiAgICAgIC8vIElnbm9yZSBwYXJzZSBlcnJvcnMuXG4gICAgfVxuXG4gICAgcmV0dXJuIFtdXG4gIH1cblxuICAvKipcbiAgICogUnVucyB3aXRoIGRiLlxuICAgKiBAdGVtcGxhdGUgVFxuICAgKiBAcGFyYW0geyhkYjogaW1wb3J0KFwiLi4vZGF0YWJhc2UvZHJpdmVycy9iYXNlLmpzXCIpLmRlZmF1bHQpID0+IFByb21pc2U8VD59IGNhbGxiYWNrIC0gQ2FsbGJhY2suXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPFQ+fSAtIENhbGxiYWNrIHJlc3VsdC5cbiAgICovXG4gIGFzeW5jIF93aXRoRGIoY2FsbGJhY2spIHtcbiAgICBjb25zdCBkYXRhYmFzZUlkZW50aWZpZXIgPSB0aGlzLmdldERhdGFiYXNlSWRlbnRpZmllcigpXG4gICAgY29uc3QgcG9vbCA9IHRoaXMuY29uZmlndXJhdGlvbi5nZXREYXRhYmFzZVBvb2woZGF0YWJhc2VJZGVudGlmaWVyKVxuXG4gICAgaWYgKCFwb29sLnRlc3RTaGFyZWRDb25uZWN0aW9uKCkpIHtcbiAgICAgIHJldHVybiBhd2FpdCBwb29sLndpdGhDb25uZWN0aW9uKHtuYW1lOiBcIkJhY2tncm91bmQgam9icyBzdG9yZVwifSwgY2FsbGJhY2spXG4gICAgfVxuXG4gICAgcmV0dXJuIGF3YWl0IHRoaXMuY29uZmlndXJhdGlvbi5ydW5XaXRoVGVzdFNoYXJlZENvbm5lY3Rpb25Db250ZXh0cyhhc3luYyAoKSA9PiB7XG4gICAgICByZXR1cm4gYXdhaXQgdGhpcy5jb25maWd1cmF0aW9uLmVuc3VyZUNvbm5lY3Rpb25zKHtkYXRhYmFzZUlkZW50aWZpZXJzOiBbZGF0YWJhc2VJZGVudGlmaWVyXSwgbmFtZTogXCJCYWNrZ3JvdW5kIGpvYnMgc3RvcmVcIn0sIGFzeW5jIChkYnMpID0+IHtcbiAgICAgICAgY29uc3QgY29ubmVjdGlvbiA9IGRic1tkYXRhYmFzZUlkZW50aWZpZXJdXG4gICAgICAgIHJldHVybiBhd2FpdCBjb29yZGluYXRlU2hhcmVkVHJhbnNhY3Rpb25Db25uZWN0aW9uKGNvbm5lY3Rpb24sIGFzeW5jICgpID0+IGF3YWl0IGNhbGxiYWNrKGNvbm5lY3Rpb24pKVxuICAgICAgfSlcbiAgICB9KVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgYSB2YWx1ZS1yZXR1cm5pbmcgY2FsbGJhY2sgaW5zaWRlIHRoZSBkcml2ZXIncyB2b2lkLXR5cGVkIHRyYW5zYWN0aW9uIEFQSS5cbiAgICogQHRlbXBsYXRlIFRcbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9kYXRhYmFzZS9kcml2ZXJzL2Jhc2UuanNcIikuZGVmYXVsdH0gZGIgLSBEYXRhYmFzZSBjb25uZWN0aW9uLlxuICAgKiBAcGFyYW0geygpID0+IFByb21pc2U8VD59IGNhbGxiYWNrIC0gVHJhbnNhY3Rpb24gY2FsbGJhY2suXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPFQ+fSAtIENhbGxiYWNrIHJlc3VsdC5cbiAgICovXG4gIGFzeW5jIF90cmFuc2FjdGlvblJlc3VsdChkYiwgY2FsbGJhY2spIHtcbiAgICBsZXQgY29tcGxldGVkID0gZmFsc2VcbiAgICAvKiogQHR5cGUge1QgfCB1bmRlZmluZWR9ICovXG4gICAgbGV0IHJlc3VsdFxuICAgIGF3YWl0IGRiLnRyYW5zYWN0aW9uKGFzeW5jICgpID0+IHtcbiAgICAgIHJlc3VsdCA9IGF3YWl0IGNhbGxiYWNrKClcbiAgICAgIGNvbXBsZXRlZCA9IHRydWVcbiAgICB9KVxuICAgIGlmICghY29tcGxldGVkKSB0aHJvdyBuZXcgRXJyb3IoXCJCYWNrZ3JvdW5kIGpvYnMgdHJhbnNhY3Rpb24gY2FsbGJhY2sgd2FzIG5vdCBpbnZva2VkXCIpXG4gICAgcmV0dXJuIC8qKiBAdHlwZSB7VH0gKi8gKHJlc3VsdClcbiAgfVxuXG4gIC8qKlxuICAgKiBTZXJpYWxpemVzIGNvdW50LWNoYW5naW5nIHRyYW5zYWN0aW9ucyBiZWZvcmUgY2hlY2tpbmcgb3V0IHRoZWlyIGNvbm5lY3Rpb24uXG4gICAqIERhdGFiYXNlIHJvdyBsb2NraW5nIHN0aWxsIHByb3ZpZGVzIGNyb3NzLXByb2Nlc3Mgb3JkZXJpbmc7IHRoaXMgZ3VhcmRcbiAgICogcHJldmVudHMgY29uY3VycmVudCBjYWxsZXJzIG9uIFNRTGl0ZSdzIHNoYXJlZCBjb25uZWN0aW9uIGZyb20gYXR0ZW1wdGluZ1xuICAgKiBvdmVybGFwcGluZyB0b3AtbGV2ZWwgdHJhbnNhY3Rpb25zLlxuICAgKiBAdGVtcGxhdGUgVFxuICAgKiBAcGFyYW0geyhkYjogaW1wb3J0KFwiLi4vZGF0YWJhc2UvZHJpdmVycy9iYXNlLmpzXCIpLmRlZmF1bHQpID0+IFByb21pc2U8VD59IGNhbGxiYWNrIC0gVHJhbnNhY3Rpb24gY2FsbGJhY2suXG4gICAqIEBwYXJhbSB7QmFja2dyb3VuZEpvYlRyYW5zYWN0aW9uU2VyaWFsaXphdGlvbk9wdGlvbnN9IFtvcHRpb25zXSAtIFNlcmlhbGl6YXRpb24gb3B0aW9ucy5cbiAgICogQHJldHVybnMge1Byb21pc2U8VD59IENhbGxiYWNrIHJlc3VsdC5cbiAgICovXG4gIGFzeW5jIF9zZXJpYWxpemVkQ291bnRNdXRhdGlvbihjYWxsYmFjaywgb3B0aW9ucyA9IHt9KSB7XG4gICAgcmV0dXJuIGF3YWl0IHRoaXMuX3NlcmlhbGl6ZWRUcmFuc2FjdGlvbk11dGF0aW9uKGFzeW5jIChkYikgPT4ge1xuICAgICAgYXdhaXQgdGhpcy5fbG9ja0NvdW50UmV2aXNpb24oZGIpXG5cbiAgICAgIHJldHVybiBhd2FpdCBjYWxsYmFjayhkYilcbiAgICB9LCBvcHRpb25zKVxuICB9XG5cbiAgLyoqXG4gICAqIEFkbWl0cyB0cmFuc2FjdGlvbnMgdG8gdGhlIHByb2Nlc3MtbG9jYWwgRklGTyBiZWZvcmUgdGhleSBjaGVjayBvdXQgYVxuICAgKiBjb25uZWN0aW9uLiBDcm9zcy1wcm9jZXNzIG9yZGVyaW5nIHJlbWFpbnMgdGhlIHJlc3BvbnNpYmlsaXR5IG9mIGR1cmFibGVcbiAgICogcm93L2Fkdmlzb3J5IGxvY2tzIGFuZCB1bmlxdWUgY29uc3RyYWludHMgYWNxdWlyZWQgYXJvdW5kIHRoZSBjYWxsYmFjay5cbiAgICogQHRlbXBsYXRlIFRcbiAgICogQHBhcmFtIHsoZGI6IGltcG9ydChcIi4uL2RhdGFiYXNlL2RyaXZlcnMvYmFzZS5qc1wiKS5kZWZhdWx0KSA9PiBQcm9taXNlPFQ+fSBjYWxsYmFjayAtIFRyYW5zYWN0aW9uIGNhbGxiYWNrLlxuICAgKiBAcGFyYW0ge0JhY2tncm91bmRKb2JUcmFuc2FjdGlvblNlcmlhbGl6YXRpb25PcHRpb25zfSBbb3B0aW9uc10gLSBTZXJpYWxpemF0aW9uIG9wdGlvbnMuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPFQ+fSBDYWxsYmFjayByZXN1bHQuXG4gICAqL1xuICBhc3luYyBfc2VyaWFsaXplZFRyYW5zYWN0aW9uTXV0YXRpb24oY2FsbGJhY2ssIG9wdGlvbnMgPSB7fSkge1xuICAgIGNvbnN0IGlkZW50aWZpZXIgPSB0aGlzLmdldERhdGFiYXNlSWRlbnRpZmllcigpIHx8IFwiZGVmYXVsdFwiXG4gICAgY29uc3QgcHJldmlvdXMgPSB0cmFuc2FjdGlvbk11dGF0aW9uQ2hhaW5zLmdldChpZGVudGlmaWVyKSB8fCBQcm9taXNlLnJlc29sdmUoKVxuICAgIGxldCByZXNvbHZlUnVuID0gKCkgPT4ge31cbiAgICAvKiogQHR5cGUge1Byb21pc2U8dm9pZD59ICovXG4gICAgY29uc3QgcnVuID0gbmV3IFByb21pc2UoKHJlc29sdmUpID0+IHtcbiAgICAgIHJlc29sdmVSdW4gPSAoKSA9PiByZXNvbHZlKHVuZGVmaW5lZClcbiAgICB9KVxuICAgIGNvbnN0IGNoYWluID0gcHJldmlvdXMudGhlbigoKSA9PiBydW4pXG5cbiAgICB0cmFuc2FjdGlvbk11dGF0aW9uQ2hhaW5zLnNldChpZGVudGlmaWVyLCBjaGFpbilcbiAgICBhd2FpdCBwcmV2aW91c1xuXG4gICAgdHJ5IHtcbiAgICAgIHJldHVybiBhd2FpdCB0aGlzLl93aXRoRGIoYXN5bmMgKGRiKSA9PiB7XG4gICAgICAgIGNvbnN0IHthZHZpc29yeUxvY2t9ID0gb3B0aW9uc1xuXG4gICAgICAgIGlmIChhZHZpc29yeUxvY2spIHtcbiAgICAgICAgICBjb25zdCBhY3F1aXJlZCA9IGF3YWl0IGRiLmFjcXVpcmVBZHZpc29yeUxvY2soYWR2aXNvcnlMb2NrLm5hbWUpXG5cbiAgICAgICAgICBpZiAoIWFjcXVpcmVkKSB0aHJvdyBuZXcgRXJyb3IoYWR2aXNvcnlMb2NrLmZhaWx1cmVNZXNzYWdlKVxuICAgICAgICB9XG5cbiAgICAgICAgdHJ5IHtcbiAgICAgICAgICByZXR1cm4gYXdhaXQgdGhpcy5fdHJhbnNhY3Rpb25SZXN1bHQoZGIsIGFzeW5jICgpID0+IGF3YWl0IGNhbGxiYWNrKGRiKSlcbiAgICAgICAgfSBmaW5hbGx5IHtcbiAgICAgICAgICBpZiAoYWR2aXNvcnlMb2NrKSBhd2FpdCBkYi5yZWxlYXNlQWR2aXNvcnlMb2NrKGFkdmlzb3J5TG9jay5uYW1lKVxuICAgICAgICB9XG4gICAgICB9KVxuICAgIH0gZmluYWxseSB7XG4gICAgICByZXNvbHZlUnVuKClcbiAgICAgIGlmICh0cmFuc2FjdGlvbk11dGF0aW9uQ2hhaW5zLmdldChpZGVudGlmaWVyKSA9PT0gY2hhaW4pIHRyYW5zYWN0aW9uTXV0YXRpb25DaGFpbnMuZGVsZXRlKGlkZW50aWZpZXIpXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgc2hvdWxkIGFjY2VwdCByZXBvcnQuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gT3B0aW9ucy5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL3R5cGVzLmpzXCIpLkJhY2tncm91bmRKb2JSb3d9IGFyZ3Muam9iIC0gSm9iIHJvdy5cbiAgICogQHBhcmFtIHtzdHJpbmcgfCBudWxsIHwgdW5kZWZpbmVkfSBhcmdzLmhhbmRvZmZJZCAtIEhhbmRvZmYgbGVhc2UgaWQgZnJvbSByZXBvcnQuXG4gICAqIEBwYXJhbSB7c3RyaW5nIHwgbnVsbCB8IHVuZGVmaW5lZH0gYXJncy53b3JrZXJJZCAtIFdvcmtlciBpZCBmcm9tIHJlcG9ydC5cbiAgICogQHBhcmFtIHtudW1iZXIgfCBudWxsIHwgdW5kZWZpbmVkfSBhcmdzLmhhbmRlZE9mZkF0TXMgLSBIYW5kZWQgb2ZmIHRpbWVzdGFtcCBmcm9tIHJlcG9ydC5cbiAgICogQHJldHVybnMge2Jvb2xlYW59IC0gV2hldGhlciB0byBhY2NlcHQgdGhlIHJlcG9ydC5cbiAgICovXG4gIF9zaG91bGRBY2NlcHRSZXBvcnQoe2pvYiwgaGFuZG9mZklkLCB3b3JrZXJJZCwgaGFuZGVkT2ZmQXRNc30pIHtcbiAgICBpZiAoam9iLnN0YXR1cyAhPT0gXCJoYW5kZWRfb2ZmXCIpIHJldHVybiBmYWxzZVxuXG4gICAgcmV0dXJuIHRoaXMuX2hhbmRvZmZJZFJlcG9ydE1hdGNoZXMoe2hhbmRvZmZJZCwgam9ifSlcbiAgICAgICYmIHRoaXMuX3dvcmtlclJlcG9ydE1hdGNoZXMoe2pvYiwgd29ya2VySWR9KVxuICAgICAgJiYgdGhpcy5faGFuZG9mZlJlcG9ydE1hdGNoZXMoe2hhbmRlZE9mZkF0TXMsIGpvYn0pXG4gIH1cblxuICAvKipcbiAgICogUnVucyBhY3RpdmUgaGFuZG9mZiBjb25kaXRpb25zLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vdHlwZXMuanNcIikuQmFja2dyb3VuZEpvYlJvd30gam9iIC0gSm9iIHJvdy5cbiAgICogQHJldHVybnMge1JlY29yZDxzdHJpbmcsIHN0cmluZyB8IG51bGw+fSAtIENvbmRpdGlvbmFsIHRyYW5zaXRpb24gZmVuY2UuXG4gICAqL1xuICBfYWN0aXZlSGFuZG9mZkNvbmRpdGlvbnMoam9iKSB7XG4gICAgcmV0dXJuIHtoYW5kb2ZmX2lkOiBqb2IuaGFuZG9mZklkLCBpZDogam9iLmlkLCBzdGF0dXM6IFwiaGFuZGVkX29mZlwifVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgaGFuZG9mZiBpZCByZXBvcnQgbWF0Y2hlcy5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBPcHRpb25zLlxuICAgKiBAcGFyYW0ge3N0cmluZyB8IG51bGwgfCB1bmRlZmluZWR9IGFyZ3MuaGFuZG9mZklkIC0gSGFuZG9mZiBsZWFzZSBpZCBmcm9tIHJlcG9ydC5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL3R5cGVzLmpzXCIpLkJhY2tncm91bmRKb2JSb3d9IGFyZ3Muam9iIC0gSm9iIHJvdy5cbiAgICogQHJldHVybnMge2Jvb2xlYW59IC0gV2hldGhlciB0aGUgaGFuZG9mZiBsZWFzZSBtYXRjaGVzLlxuICAgKi9cbiAgX2hhbmRvZmZJZFJlcG9ydE1hdGNoZXMoe2hhbmRvZmZJZCwgam9ifSkge1xuICAgIGlmICgham9iLmhhbmRvZmZJZCkgcmV0dXJuIHRydWVcblxuICAgIHJldHVybiBoYW5kb2ZmSWQgPT09IGpvYi5oYW5kb2ZmSWRcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHdvcmtlciByZXBvcnQgbWF0Y2hlcy5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBPcHRpb25zLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vdHlwZXMuanNcIikuQmFja2dyb3VuZEpvYlJvd30gYXJncy5qb2IgLSBKb2Igcm93LlxuICAgKiBAcGFyYW0ge3N0cmluZyB8IG51bGwgfCB1bmRlZmluZWR9IGFyZ3Mud29ya2VySWQgLSBXb3JrZXIgaWQgZnJvbSByZXBvcnQuXG4gICAqIEByZXR1cm5zIHtib29sZWFufSAtIFdoZXRoZXIgdGhlIHdvcmtlciByZXBvcnQgbWF0Y2hlcy5cbiAgICovXG4gIF93b3JrZXJSZXBvcnRNYXRjaGVzKHtqb2IsIHdvcmtlcklkfSkge1xuICAgIGlmICghd29ya2VySWQpIHJldHVybiB0cnVlXG4gICAgaWYgKCFqb2Iud29ya2VySWQpIHJldHVybiB0cnVlXG5cbiAgICByZXR1cm4gd29ya2VySWQgPT09IGpvYi53b3JrZXJJZFxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgaGFuZG9mZiByZXBvcnQgbWF0Y2hlcy5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBPcHRpb25zLlxuICAgKiBAcGFyYW0ge251bWJlciB8IG51bGwgfCB1bmRlZmluZWR9IGFyZ3MuaGFuZGVkT2ZmQXRNcyAtIEhhbmRlZCBvZmYgdGltZXN0YW1wIGZyb20gcmVwb3J0LlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vdHlwZXMuanNcIikuQmFja2dyb3VuZEpvYlJvd30gYXJncy5qb2IgLSBKb2Igcm93LlxuICAgKiBAcmV0dXJucyB7Ym9vbGVhbn0gLSBXaGV0aGVyIHRoZSBoYW5kb2ZmIHJlcG9ydCBtYXRjaGVzLlxuICAgKi9cbiAgX2hhbmRvZmZSZXBvcnRNYXRjaGVzKHtoYW5kZWRPZmZBdE1zLCBqb2J9KSB7XG4gICAgaWYgKCFoYW5kZWRPZmZBdE1zKSByZXR1cm4gdHJ1ZVxuICAgIGlmICgham9iLmhhbmRlZE9mZkF0TXMpIHJldHVybiB0cnVlXG5cbiAgICByZXR1cm4gaGFuZGVkT2ZmQXRNcyA9PT0gam9iLmhhbmRlZE9mZkF0TXNcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIG1pZ3JhdGlvbiBrZXkuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBbdmVyc2lvbl0gLSBNaWdyYXRpb24gdmVyc2lvbi5cbiAgICogQHJldHVybnMge3N0cmluZ30gLSBNaWdyYXRpb24ga2V5LlxuICAgKi9cbiAgX21pZ3JhdGlvbktleSh2ZXJzaW9uID0gTUlHUkFUSU9OX1ZFUlNJT04pIHtcbiAgICByZXR1cm4gYCR7TUlHUkFUSU9OX1NDT1BFfToke3ZlcnNpb259YFxuICB9XG59XG4iXX0=