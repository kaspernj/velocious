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
// Legacy marker prefix used by rows written before this migration: pooled jobs
// used to persist as `execution_mode = "forked"` plus a `velocious-pooled:*`
// handoff id. Retained only to detect and convert those rows in the migration.
const LEGACY_POOLED_HANDOFF_ID_PREFIX = "velocious-pooled:";
const LEGACY_POOLED_QUEUED_HANDOFF_ID = `${LEGACY_POOLED_HANDOFF_ID_PREFIX}queued`;
const JOBS_TABLE = "background_jobs";
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
        const concurrencyTable = db.quoteTable(CONCURRENCY_TABLE);
        const jobsTable = db.quoteTable(JOBS_TABLE);
        await db.query(`UPDATE ${concurrencyTable} SET ${db.quoteColumn("active_count")} = (` +
            `SELECT COUNT(*) FROM ${jobsTable} WHERE ${jobsTable}.${db.quoteColumn("status")} = ${db.quote("handed_off")} AND ` +
            `${jobsTable}.${db.quoteColumn("concurrency_key")} = ${concurrencyTable}.${db.quoteColumn("concurrency_key")})`);
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
        const concurrencyRows = await db.newQuery().from(CONCURRENCY_TABLE).select("concurrency_key").results();
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoic3RvcmUuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi9zcmMvYmFja2dyb3VuZC1qb2JzL3N0b3JlLmpzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiJBQUFBLFlBQVk7QUFFWixPQUFPLEVBQUMsVUFBVSxFQUFFLFVBQVUsRUFBQyxNQUFNLFFBQVEsQ0FBQTtBQUM3QyxPQUFPLHFCQUFxQixNQUFNLGNBQWMsQ0FBQTtBQUNoRCxPQUFPLE1BQU0sTUFBTSxjQUFjLENBQUE7QUFDakMsT0FBTyxTQUFTLE1BQU0saUNBQWlDLENBQUE7QUFDdkQsT0FBTyxjQUFjLE1BQU0sdUJBQXVCLENBQUE7QUFDbEQsT0FBTyxtQkFBbUIsTUFBTSxpQkFBaUIsQ0FBQTtBQUNqRCxPQUFPLDJCQUEyQixNQUFNLHNCQUFzQixDQUFBO0FBQzlELE9BQU8sRUFBRSxxQ0FBcUMsRUFBRSxNQUFNLHlEQUF5RCxDQUFBO0FBQy9HLE9BQU8sbUJBQW1CLE1BQU0seUJBQXlCLENBQUE7QUFDekQsT0FBTyxFQUNMLDhCQUE4QixFQUM5QixxQ0FBcUMsRUFDckMsNEJBQTRCLEVBQzVCLDRCQUE0QixFQUM1QixpQ0FBaUMsRUFDakMsbUNBQW1DLEVBQ25DLGdDQUFnQyxFQUNoQywyQkFBMkIsRUFDM0IsbUNBQW1DLEVBQ25DLDRCQUE0QixFQUM1QixZQUFZLEVBQ2IsTUFBTSxvQkFBb0IsQ0FBQTtBQUMzQixPQUFPLEVBQ0wsOEJBQThCLEVBQzlCLDJCQUEyQixFQUMzQix3QkFBd0IsRUFDekIsTUFBTSxpQ0FBaUMsQ0FBQTtBQUV4Qzs7Ozs7Ozs7Ozs7OztHQWFHO0FBRUg7Ozs7O0dBS0c7QUFFSDs7OztHQUlHO0FBRUgsTUFBTSxnQkFBZ0IsR0FBRywrQkFBK0IsQ0FBQTtBQUN4RCxNQUFNLGVBQWUsR0FBRyxpQkFBaUIsQ0FBQTtBQUN6QyxNQUFNLGlCQUFpQixHQUFHLGdCQUFnQixDQUFBO0FBQzFDLE1BQU0sK0JBQStCLEdBQUcseUJBQXlCLENBQUE7QUFDakUs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QUE7UUFDM0QsS0FBSyxDQUFDLE1BQU0sQ0FBQyxlQUFlLEVBQUUsRUFBQyxJQUFJLEVBQUUsS0FBSyxFQUFFLEtBQUssRUFBRSxJQUFJLEVBQUMsQ0FBQyxDQUFBO1FBQ3pELEtBQUssQ0FBQyxNQUFNLENBQUMsY0FBYyxFQUFFLEVBQUMsSUFBSSxFQUFFLElBQUksRUFBRSxLQUFLLEVBQUUsSUFBSSxFQUFDLENBQUMsQ0FBQTtRQUN2RCxLQUFLLENBQUMsTUFBTSxDQUFDLGtCQUFrQixFQUFFLEVBQUMsSUFBSSxFQUFFLElBQUksRUFBRSxLQUFLLEVBQUUsSUFBSSxFQUFDLENBQUMsQ0FBQTtRQUMzRCxLQUFLLENBQUMsTUFBTSxDQUFDLFlBQVksRUFBRSxFQUFDLElBQUksRUFBRSxJQUFJLEVBQUMsQ0FBQyxDQUFBO1FBQ3hDLEtBQUssQ0FBQyxNQUFNLENBQUMsaUJBQWlCLEVBQUUsRUFBQyxJQUFJLEVBQUUsSUFBSSxFQUFDLENBQUMsQ0FBQTtRQUM3QyxLQUFLLENBQUMsTUFBTSxDQUFDLGNBQWMsRUFBRSxFQUFDLElBQUksRUFBRSxJQUFJLEVBQUMsQ0FBQyxDQUFBO1FBQzFDLEtBQUssQ0FBQyxNQUFNLENBQUMsZ0JBQWdCLEVBQUUsRUFBQyxJQUFJLEVBQUUsSUFBSSxFQUFFLEtBQUssRUFBRSxJQUFJLEVBQUMsQ0FBQyxDQUFBO1FBQ3pELEtBQUssQ0FBQyxNQUFNLENBQUMsV0FBVyxFQUFFLEVBQUMsSUFBSSxFQUFFLElBQUksRUFBQyxDQUFDLENBQUE7UUFDdkMsS0FBSyxDQUFDLElBQUksQ0FBQyxZQUFZLEVBQUUsRUFBQyxJQUFJLEVBQUUsSUFBSSxFQUFDLENBQUMsQ0FBQTtRQUN0QyxLQUFLLENBQUMsTUFBTSxDQUFDLGlCQUFpQixFQUFFLEVBQUMsSUFBSSxFQUFFLElBQUksRUFBRSxLQUFLLEVBQUUsSUFBSSxFQUFDLENBQUMsQ0FBQTtRQUMxRCxLQUFLLENBQUMsT0FBTyxDQUFDLGlCQUFpQixFQUFFLEVBQUMsSUFBSSxFQUFFLElBQUksRUFBQyxDQUFDLENBQUE7UUFDOUMs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LENBQUE7SUFDdEUsQ0FBQztJQUVEOzs7Ozs7T0FNRztJQUNILHVCQUF1QixDQUFDLEVBQUMsU0FBUyxFQUFFLEdBQUcsRUFBQztRQUN0QyxJQUFJLENBQUMsR0FBRyxDQUFDLFNBQVM7WUFBRSxPQUFPLElBQUksQ0FBQTtRQUUvQixPQUFPLFNBQVMsS0FBSyxHQUFHLENBQUMsU0FBUyxDQUFBO0lBQ3BDLENBQUM7SUFFRDs7Ozs7O09BTUc7SUFDSCxvQkFBb0IsQ0FBQyxFQUFDLEdBQUcsRUFBRSxRQUFRLEVBQUM7UUFDbEMsSUFBSSxDQUFDLFFBQVE7WUFBRSxPQUFPLElBQUksQ0FBQTtRQUMxQixJQUFJLENBQUMsR0FBRyxDQUFDLFFBQVE7WUFBRSxPQUFPLElBQUksQ0FBQTtRQUU5QixPQUFPLFFBQVEsS0FBSyxHQUFHLENBQUMsUUFBUSxDQUFBO0lBQ2xDLENBQUM7SUFFRDs7Ozs7O09BTUc7SUFDSCxxQkFBcUIsQ0FBQyxFQUFDLGFBQWEsRUFBRSxHQUFHLEVBQUM7UUFDeEMsSUFBSSxDQUFDLGFBQWE7WUFBRSxPQUFPLElBQUksQ0FBQTtRQUMvQixJQUFJLENBQUMsR0FBRyxDQUFDLGFBQWE7WUFBRSxPQUFPLElBQUksQ0FBQTtRQUVuQyxPQUFPLGFBQWEsS0FBSyxHQUFHLENBQUMsYUFBYSxDQUFBO0lBQzVDLENBQUM7SUFFRDs7OztPQUlHO0lBQ0gsYUFBYSxDQUFDLE9BQU8sR0FBRyxpQkFBaUI7UUFDdkMsT0FBTyxHQUFHLGVBQWUsSUFBSSxPQUFPLEVBQUUsQ0FBQTtJQUN4QyxDQUFDO0NBQ0YiLCJzb3VyY2VzQ29udGVudCI6WyIvLyBAdHMtY2hlY2tcblxuaW1wb3J0IHtjcmVhdGVIYXNoLCByYW5kb21VVUlEfSBmcm9tIFwiY3J5cHRvXCJcbmltcG9ydCBCYWNrZ3JvdW5kSm9ic0FkYXB0ZXIgZnJvbSBcIi4vYWRhcHRlci5qc1wiXG5pbXBvcnQgTG9nZ2VyIGZyb20gXCIuLi9sb2dnZXIuanNcIlxuaW1wb3J0IFRhYmxlRGF0YSBmcm9tIFwiLi4vZGF0YWJhc2UvdGFibGUtZGF0YS9pbmRleC5qc1wiXG5pbXBvcnQgVmVsb2Npb3VzRXJyb3IgZnJvbSBcIi4uL3ZlbG9jaW91cy1lcnJvci5qc1wiXG5pbXBvcnQgQmFja2dyb3VuZEpvYlJlY29yZCBmcm9tIFwiLi9qb2ItcmVjb3JkLmpzXCJcbmltcG9ydCBub3JtYWxpemVCYWNrZ3JvdW5kSm9iRXJyb3IgZnJvbSBcIi4vbm9ybWFsaXplLWVycm9yLmpzXCJcbmltcG9ydCB7IGNvb3JkaW5hdGVTaGFyZWRUcmFuc2FjdGlvbkNvbm5lY3Rpb24gfSBmcm9tIFwiLi4vdGVzdGluZy9zaGFyZWQtdHJhbnNhY3Rpb24tY29ubmVjdGlvbi1jb29yZGluYXRvci5qc1wiXG5pbXBvcnQgc3RhYmxlSnNvblN0cmluZ2lmeSBmcm9tIFwiLi4vdXRpbHMvc3RhYmxlLWpzb24uanNcIlxuaW1wb3J0IHtcbiAgQkFDS0dST1VORF9KT0JfRVhFQ1VUSU9OX01PREVTLFxuICBERUZBVUxUX0JBQ0tHUk9VTkRfSk9CX0VYRUNVVElPTl9NT0RFLFxuICBERUZBVUxUX0JBQ0tHUk9VTkRfSk9CX1FVRVVFLFxuICBRVUVVRV9DT05DVVJSRU5DWV9LRVlfUFJFRklYLFxuICBub3JtYWxpemVCYWNrZ3JvdW5kSm9iQ29uY3VycmVuY3ksXG4gIG5vcm1hbGl6ZUJhY2tncm91bmRKb2JFeGVjdXRpb25Nb2RlLFxuICBub3JtYWxpemVCYWNrZ3JvdW5kSm9iTWF4UmV0cmllcyxcbiAgbm9ybWFsaXplQmFja2dyb3VuZEpvYlF1ZXVlLFxuICBub3JtYWxpemVCYWNrZ3JvdW5kSm9iU2NoZWR1bGVkQXRNcyxcbiAgcmVzY2hlZHVsZWRCYWNrZ3JvdW5kSm9iQXRNcyxcbiAgcmV0cnlEZWxheU1zXG59IGZyb20gXCIuL2pvYi1zZW1hbnRpY3MuanNcIlxuaW1wb3J0IHtcbiAgTUFJTF9ERUxJVkVSWV9PUEVSQVRJT05TX1RBQkxFLFxuICBtYWlsRGVsaXZlcnlPcGVyYXRpb25Gb3JKb2IsXG4gIG1haWxEZWxpdmVyeU9wZXJhdGlvbktleVxufSBmcm9tIFwiLi4vbWFpbGVyL2RlbGl2ZXJ5LW9wZXJhdGlvbi5qc1wiXG5cbi8qKlxuICogUHJlcGFyZWRCYWNrZ3JvdW5kSm9iIHR5cGUuXG4gKiBAdHlwZWRlZiB7b2JqZWN0fSBQcmVwYXJlZEJhY2tncm91bmRKb2JcbiAqIEBwcm9wZXJ0eSB7c3RyaW5nfSBhcmdzSnNvbiAtIFNlcmlhbGl6ZWQgYXJndW1lbnRzLlxuICogQHByb3BlcnR5IHt7Y29uY3VycmVuY3lLZXk6IHN0cmluZywgbWF4Q29uY3VycmVuY3k6IG51bWJlciwgcXVldWVEZXJpdmVkOiBib29sZWFufSB8IG51bGx9IGNvbmN1cnJlbmN5IC0gUmVzb2x2ZWQgY29uY3VycmVuY3kuXG4gKiBAcHJvcGVydHkge251bWJlcn0gY3JlYXRlZEF0TXMgLSBDcmVhdGlvbiB0aW1lc3RhbXAuXG4gKiBAcHJvcGVydHkge2ltcG9ydChcIi4vdHlwZXMuanNcIikuQmFja2dyb3VuZEpvYkV4ZWN1dGlvbk1vZGV9IGV4ZWN1dGlvbk1vZGUgLSBFeGVjdXRpb24gbW9kZS5cbiAqIEBwcm9wZXJ0eSB7c3RyaW5nfSBqb2JJZCAtIE5ldyBqb2IgaWQuXG4gKiBAcHJvcGVydHkge3N0cmluZ30gam9iTmFtZSAtIEpvYiBuYW1lLlxuICogQHByb3BlcnR5IHtudW1iZXJ9IG1heFJldHJpZXMgLSBSZXRyeSBjYXAuXG4gKiBAcHJvcGVydHkge3N0cmluZ30gcXVldWUgLSBRdWV1ZSBuYW1lLlxuICogQHByb3BlcnR5IHtudW1iZXJ9IHNjaGVkdWxlZEF0TXMgLSBFbGlnaWJpbGl0eSB0aW1lc3RhbXAuXG4gKiBAcHJvcGVydHkge251bWJlciB8IG51bGx9IHRpbWVvdXRNcyAtIFBlci1qb2IgdGltZW91dCBvdmVycmlkZSwgb3IgbnVsbCB3aGVuIG9taXR0ZWQuXG4gKi9cblxuLyoqXG4gKiBCYWNrZ3JvdW5kSm9iT3JwaGFuU2VsZWN0aW9uIHR5cGUuXG4gKiBAdHlwZWRlZiB7b2JqZWN0fSBCYWNrZ3JvdW5kSm9iT3JwaGFuU2VsZWN0aW9uXG4gKiBAcHJvcGVydHkge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gY29uZGl0aW9ucyAtIEV4YWN0IHVwZGF0ZSBmZW5jZS5cbiAqIEBwcm9wZXJ0eSB7aW1wb3J0KFwiLi90eXBlcy5qc1wiKS5CYWNrZ3JvdW5kSm9iUm93fSBqb2IgLSBTZWxlY3RlZCBhY3RpdmUgaGFuZG9mZi5cbiAqL1xuXG4vKipcbiAqIEJhY2tncm91bmRKb2JUcmFuc2FjdGlvblNlcmlhbGl6YXRpb25PcHRpb25zIHR5cGUuXG4gKiBAdHlwZWRlZiB7b2JqZWN0fSBCYWNrZ3JvdW5kSm9iVHJhbnNhY3Rpb25TZXJpYWxpemF0aW9uT3B0aW9uc1xuICogQHByb3BlcnR5IHt7ZmFpbHVyZU1lc3NhZ2U6IHN0cmluZywgbmFtZTogc3RyaW5nfX0gW2Fkdmlzb3J5TG9ja10gLSBTZXNzaW9uIGxvY2sgaGVsZCBhcm91bmQgdGhlIHRyYW5zYWN0aW9uLlxuICovXG5cbmNvbnN0IE1JR1JBVElPTlNfVEFCTEUgPSBcInZlbG9jaW91c19pbnRlcm5hbF9taWdyYXRpb25zXCJcbmNvbnN0IE1JR1JBVElPTl9TQ09QRSA9IFwiYmFja2dyb3VuZF9qb2JzXCJcbmNvbnN0IE1JR1JBVElPTl9WRVJTSU9OID0gXCIyMDI1MDIxNTAwMDAwMFwiXG5jb25zdCBTQ0hFTUFfUkVDT1ZFUllfUEVORElOR19WRVJTSU9OID0gXCJzY2hlbWEtcmVjb3ZlcnktcGVuZGluZ1wiXG5jb25zdCBFWEVDVVRJT05fTU9ERV9CQUNLRklMTF9NSUdSQVRJT05fVkVSU0lPTiA9IFwiMjAyNjA2MDcxMzEwMTBcIlxuLy8gRHJvcHMgdGhlIHJlZHVuZGFudCBsZWdhY3kgYGZvcmtlZGAgYm9vbGVhbiBjb2x1bW4gYW5kIHJld3JpdGVzIHBvb2xlZCByb3dzIHRvXG4vLyBwZXJzaXN0IGBleGVjdXRpb25fbW9kZSA9IFwicG9vbGVkXCJgIGRpcmVjdGx5IChyZXRpcmluZyB0aGUgcG9vbGVkLWFzLWZvcmtlZFxuLy8gaGFuZG9mZi1tYXJrZXIgd29ya2Fyb3VuZCksIGxlYXZpbmcgYGV4ZWN1dGlvbl9tb2RlYCBhcyB0aGUgc2luZ2xlIHNvdXJjZSBvZlxuLy8gdHJ1dGggZm9yIGEgam9iJ3MgcnVudGltZS5cbmNvbnN0IERST1BfRk9SS0VEX0NPTFVNTl9NSUdSQVRJT05fVkVSU0lPTiA9IFwiMjAyNjA3MTkwMDAwMDBcIlxuLy8gTGVnYWN5IG1hcmtlciBwcmVmaXggdXNlZCBieSByb3dzIHdyaXR0ZW4gYmVmb3JlIHRoaXMgbWlncmF0aW9uOiBwb29sZWQgam9ic1xuLy8gdXNlZCB0byBwZXJzaXN0IGFzIGBleGVjdXRpb25fbW9kZSA9IFwiZm9ya2VkXCJgIHBsdXMgYSBgdmVsb2Npb3VzLXBvb2xlZDoqYFxuLy8gaGFuZG9mZiBpZC4gUmV0YWluZWQgb25seSB0byBkZXRlY3QgYW5kIGNvbnZlcnQgdGhvc2Ugcm93cyBpbiB0aGUgbWlncmF0aW9uLlxuY29uc3QgTEVHQUNZX1BPT0xFRF9IQU5ET0ZGX0lEX1BSRUZJWCA9IFwidmVsb2Npb3VzLXBvb2xlZDpcIlxuY29uc3QgTEVHQUNZX1BPT0xFRF9RVUVVRURfSEFORE9GRl9JRCA9IGAke0xFR0FDWV9QT09MRURfSEFORE9GRl9JRF9QUkVGSVh9cXVldWVkYFxuY29uc3QgSk9CU19UQUJMRSA9IFwiYmFja2dyb3VuZF9qb2JzXCJcbmNvbnN0IElERU1QT1RFTkNZX0tFWVNfVEFCTEUgPSBcImJhY2tncm91bmRfam9iX2lkZW1wb3RlbmN5X2tleXNcIlxuY29uc3QgU0NIRURVTEVfS0VZU19UQUJMRSA9IFwiYmFja2dyb3VuZF9qb2Jfc2NoZWR1bGVfa2V5c1wiXG5jb25zdCBDT05DVVJSRU5DWV9UQUJMRSA9IFwiYmFja2dyb3VuZF9qb2JfY29uY3VycmVuY3lcIlxuY29uc3QgQ09VTlRTX1JFVklTSU9OX1RBQkxFID0gXCJiYWNrZ3JvdW5kX2pvYl9jb3VudF9yZXZpc2lvbnNcIlxuY29uc3QgQ09VTlRTX1JFVklTSU9OX0tFWSA9IFwiY291bnRzXCJcbmV4cG9ydCBjb25zdCBCQUNLR1JPVU5EX0pPQl9DT1VOVFNfQ0hBTk5FTCA9IFwidmVsb2Npb3VzLWJhY2tncm91bmQtam9iLWNvdW50c1wiXG5leHBvcnQgY29uc3QgQkFDS0dST1VORF9KT0JfQ09VTlRfQlVDS0VUUyA9IFtcImFsbFwiLCBcInF1ZXVlZFwiLCBcImhhbmRlZF9vZmZcIiwgXCJjb21wbGV0ZWRcIiwgXCJmYWlsZWRcIiwgXCJvcnBoYW5lZFwiXVxuY29uc3QgQ09VTlRFRF9KT0JfU1RBVFVTRVMgPSBCQUNLR1JPVU5EX0pPQl9DT1VOVF9CVUNLRVRTLnNsaWNlKDEpXG5jb25zdCBNQVhfSk9CX1RJTUVPVVRfTVMgPSAyXzE0N180ODNfNjQ3XG5jb25zdCBKT0JfVElNRU9VVF9WQUxJREFUSU9OX01FU1NBR0UgPSBgYmFja2dyb3VuZCBqb2IgdGltZW91dE1zIG11c3QgYmUgYSBmaW5pdGUgbm9uLXBvc2l0aXZlIG51bWJlciBvciBhbiBpbnRlZ2VyIGJldHdlZW4gMSBhbmQgJHtNQVhfSk9CX1RJTUVPVVRfTVN9YFxuY29uc3QgT1JQSEFORURfQUZURVJfTVMgPSAyICogNjAgKiA2MCAqIDEwMDBcblxuLyoqXG4gKiBDb2x1bW5zIHRoZSBkYXNoYm9hcmQgaXMgYWxsb3dlZCB0byBzb3J0IGpvYiBsaXN0aW5ncyBieSwgbWFwcGVkIHRvIHRoZWlyXG4gKiBkYXRhYmFzZSBjb2x1bW4gbmFtZXMuIFJlc3RyaWN0aW5nIHRvIHRoaXMgc2V0IGtlZXBzIHRoZSBzb3J0IHBhcmFtZXRlclxuICogKHdoaWNoIG9yaWdpbmF0ZXMgZnJvbSB1bnRydXN0ZWQgcXVlcnkgc3RyaW5ncykgZnJvbSByZWFjaGluZyByYXcgU1FMLlxuICogQHR5cGUge1JlY29yZDxzdHJpbmcsIHN0cmluZz59XG4gKi9cbmNvbnN0IFNPUlRBQkxFX0NPTFVNTlMgPSB7XG4gIGF0dGVtcHRzOiBcImF0dGVtcHRzXCIsXG4gIGNvbXBsZXRlZEF0TXM6IFwiY29tcGxldGVkX2F0X21zXCIsXG4gIGNyZWF0ZWRBdE1zOiBcImNyZWF0ZWRfYXRfbXNcIixcbiAgZmFpbGVkQXRNczogXCJmYWlsZWRfYXRfbXNcIixcbiAgaGFuZGVkT2ZmQXRNczogXCJoYW5kZWRfb2ZmX2F0X21zXCIsXG4gIHNjaGVkdWxlZEF0TXM6IFwic2NoZWR1bGVkX2F0X21zXCJcbn1cblxuLyoqXG4gKiBTZXJpYWxpemVzIGNvbmN1cnJlbnQgYF9hcHBseVNjaGVtYWAgcnVucyB3aXRoaW4gVEhJUyBwcm9jZXNzLCBrZXllZCBieSBkYXRhYmFzZVxuICogaWRlbnRpZmllciwgYmVmb3JlIGNhbGxlcnMgd2l0aG91dCBhbiBleGlzdGluZyBjb25uZWN0aW9uIGNoZWNrIG9uZSBvdXQuIFR3b1xuICogc3RvcmVzIHRoYXQgc2hhcmUgb25lIGNvbm5lY3Rpb24gKFNpbmdsZU11bHRpVXNlIC8gU1FMaXRlKVxuICogb3RoZXJ3aXNlIGludGVybGVhdmUgdGhlIG11bHRpLXN0ZXAgdGFibGUgcmVidWlsZCBhbmQgY29ycnVwdCBpdCAodGhlIGpvYnMgdGFibGVcbiAqIGlzIGxlZnQgYXMgaXRzIGAqX3ZlbG9jaW91c19yZWJ1aWxkYCB0ZW1wKS4gQSBEQiBhZHZpc29yeSBsb2NrIGNhbid0IGZpeCB0aGF0OiBvblxuICogYSBzZXNzaW9uLXNjb3BlZCAvIHJlLWVudHJhbnQgZHJpdmVyIChNeVNRTCBgR0VUX0xPQ0tgKSBhIHNlY29uZCBhY3F1aXJlIG9uIHRoZVxuICogc2FtZSBzZXNzaW9uIHN1Y2NlZWRzIGltbWVkaWF0ZWx5IHNvIGJvdGggY2FsbGVycyBwcm9jZWVkLCBhbmQgdGFraW5nIGl0IG9uIGFcbiAqIHNlcGFyYXRlIGNvbm5lY3Rpb24gYmxvY2tzIGNyb3NzLXNlc3Npb24gZm9yZXZlci4gQW4gaW4tcHJvY2VzcyBwcm9taXNlLWNoYWluXG4gKiBtdXRleCBzZXJpYWxpemVzIHNhbWUtcHJvY2VzcyBjYWxsZXJzIHdpdGggbmVpdGhlciBoYXphcmQuIENyb3NzLXByb2Nlc3Mgc2NoZW1hXG4gKiByYWNlcyBzdGF5IGNvdmVyZWQgYnkgdGhlIHBlci1zdGVwIGFkdmlzb3J5IGxvY2tzICsgcmVjaGVja3MgaW5zaWRlIHRoZSBzdGVwcy5cbiAqIEB0eXBlIHtNYXA8c3RyaW5nLCBQcm9taXNlPHZvaWQ+Pn1cbiAqL1xuY29uc3Qgc2NoZW1hQXBwbHlDaGFpbnMgPSBuZXcgTWFwKClcbi8qKiBAdHlwZSB7TWFwPHN0cmluZywgUHJvbWlzZTx2b2lkPj59ICovXG5jb25zdCB0cmFuc2FjdGlvbk11dGF0aW9uQ2hhaW5zID0gbmV3IE1hcCgpXG5cbmV4cG9ydCBkZWZhdWx0IGNsYXNzIEJhY2tncm91bmRKb2JzU3RvcmUgZXh0ZW5kcyBCYWNrZ3JvdW5kSm9ic0FkYXB0ZXIge1xuICAvKipcbiAgICogUnVucyBjb25zdHJ1Y3Rvci5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBPcHRpb25zLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL2NvbmZpZ3VyYXRpb24uanNcIikuZGVmYXVsdH0gYXJncy5jb25maWd1cmF0aW9uIC0gQ29uZmlndXJhdGlvbi5cbiAgICogQHBhcmFtIHtzdHJpbmd9IFthcmdzLmRhdGFiYXNlSWRlbnRpZmllcl0gLSBEYXRhYmFzZSBpZGVudGlmaWVyLlxuICAgKi9cbiAgY29uc3RydWN0b3Ioe2NvbmZpZ3VyYXRpb24sIGRhdGFiYXNlSWRlbnRpZmllcn0pIHtcbiAgICBzdXBlcigpXG4gICAgdGhpcy5jb25maWd1cmF0aW9uID0gY29uZmlndXJhdGlvblxuICAgIHRoaXMuZGF0YWJhc2VJZGVudGlmaWVyID0gZGF0YWJhc2VJZGVudGlmaWVyXG4gICAgdGhpcy5sb2dnZXIgPSBuZXcgTG9nZ2VyKHRoaXMpXG4gICAgdGhpcy5fcmVhZHlQcm9taXNlID0gbnVsbFxuICAgIHRoaXMuX3F1ZXVlQ29uY3VycmVuY3lSZWNvbmNpbGVkID0gZmFsc2VcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGdldCBkYXRhYmFzZSBpZGVudGlmaWVyLlxuICAgKiBAcmV0dXJucyB7c3RyaW5nfSAtIERhdGFiYXNlIGlkZW50aWZpZXIuXG4gICAqL1xuICBnZXREYXRhYmFzZUlkZW50aWZpZXIoKSB7XG4gICAgaWYgKHRoaXMuZGF0YWJhc2VJZGVudGlmaWVyKSByZXR1cm4gdGhpcy5kYXRhYmFzZUlkZW50aWZpZXJcblxuICAgIHJldHVybiB0aGlzLmNvbmZpZ3VyYXRpb24uZ2V0QmFja2dyb3VuZEpvYnNDb25maWcoKS5kYXRhYmFzZUlkZW50aWZpZXJcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGVuc3VyZSByZWFkeS5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgd2hlbiByZWFkeS5cbiAgICovXG4gIGFzeW5jIGVuc3VyZVJlYWR5KCkge1xuICAgIGlmICh0aGlzLl9yZWFkeVByb21pc2UpIHJldHVybiBhd2FpdCB0aGlzLl9yZWFkeVByb21pc2VcblxuICAgIHRoaXMuX3JlYWR5UHJvbWlzZSA9IChhc3luYyAoKSA9PiB7XG4gICAgICB0aGlzLmNvbmZpZ3VyYXRpb24uc2V0Q3VycmVudCgpXG4gICAgICBhd2FpdCB0aGlzLl9lbnN1cmVTY2hlbWEoKVxuICAgICAgYXdhaXQgdGhpcy5faW5pdGlhbGl6ZU1vZGVsKClcbiAgICB9KSgpXG5cbiAgICB0cnkge1xuICAgICAgYXdhaXQgdGhpcy5fcmVhZHlQcm9taXNlXG4gICAgfSBmaW5hbGx5IHtcbiAgICAgIHRoaXMuX3JlYWR5UHJvbWlzZSA9IG51bGxcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogRW5zdXJlcyB0aGUgYmFja2dyb3VuZC1qb2JzIHNjaGVtYSAodGFibGVzICsgY29sdW1ucykgZXhpc3RzIG9uIHRoZSBjb25maWd1cmVkXG4gICAqIGRhdGFiYXNlLCB3aXRob3V0IGluaXRpYWxpemluZyB0aGUgcnVudGltZSBtb2RlbC4gTGV0cyBgZGI6bWlncmF0ZWAgY3JlYXRlIHRoZVxuICAgKiBmcmFtZXdvcmsncyBvd24gc2NoZW1hIGRldGVybWluaXN0aWNhbGx5IGFsb25nc2lkZSBhcHAgbWlncmF0aW9ucyDigJQgYW5kIGNhcHR1cmVcbiAgICogaXQgaW4gdGhlIGR1bXBlZCBzdHJ1Y3R1cmUgU1FMIOKAlCBpbnN0ZWFkIG9mIGl0IG9ubHkgYXBwZWFyaW5nIG9uY2UgYSBzdG9yZSBib290cy5cbiAgICogSWRlbXBvdGVudDogcmV1c2VzIHRoZSBzYW1lIGBfZW5zdXJlU2NoZW1hYCB0aGUgcnVudGltZSBzdG9yZSB1c2VzLCB3aGljaCBza2lwc1xuICAgKiB3b3JrIGFscmVhZHkgYXBwbGllZCAodHJhY2tlZCBpbiBgdmVsb2Npb3VzX2ludGVybmFsX21pZ3JhdGlvbnNgKS5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9kYXRhYmFzZS9kcml2ZXJzL2Jhc2UuanNcIikuZGVmYXVsdH0gW2RiXSAtIFJldXNlIGFuIGFscmVhZHlcbiAgICogICBjaGVja2VkLW91dCBjb25uZWN0aW9uIChlLmcuIHRoZSBvbmUgYGRiOm1pZ3JhdGVgIGhvbGRzKSByYXRoZXIgdGhhbiBvcGVuaW5nIGFcbiAgICogICBuZXN0ZWQgY2hlY2tvdXQgdGhhdCB3b3VsZCBkZWFkbG9jayBhIHNpbmdsZS1jb25uZWN0aW9uIHBvb2wuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIHdoZW4gdGhlIHNjaGVtYSBpcyBwcmVzZW50LlxuICAgKi9cbiAgYXN5bmMgZW5zdXJlU2NoZW1hKGRiKSB7XG4gICAgLy8gV2hlbiBhIGNvbm5lY3Rpb24gaXMgaGFuZGVkIGluICh0aGUgZGI6bWlncmF0ZSBwYXRoKSwgdGhlIGNhbGxlciBhbHJlYWR5IG93bnNcbiAgICAvLyB0aGUgYWN0aXZlIGNvbmZpZ3VyYXRpb24gKyBjb25uZWN0aW9uIGNvbnRleHQ7IGNhbGxpbmcgc2V0Q3VycmVudCgpIGhlcmUgd291bGRcbiAgICAvLyBjbG9iYmVyIGl0IChlLmcuIHRoZSBicm93c2VyIHRlc3QgcnVubmVyIGp1Z2dsZXMgbXVsdGlwbGUgY29uZmlndXJhdGlvbnMpLlxuICAgIGlmICghZGIpIHRoaXMuY29uZmlndXJhdGlvbi5zZXRDdXJyZW50KClcblxuICAgIGF3YWl0IHRoaXMuX2Vuc3VyZVNjaGVtYShkYilcbiAgfVxuXG4gIC8qKlxuICAgKiBSZWNvbmNpbGVzIHF1ZXVlLWRlcml2ZWQgY29uY3VycmVuY3kgd2l0aCB0aGUgY3VycmVudCBjb25maWd1cmF0aW9uOiB0aGVcbiAgICogZXhwbGljaXQgbGlmZWN5Y2xlIHBhdGggdGhhdCBhZG9wdHMvcmVsZWFzZXMgcGVyc2lzdGVkIHF1ZXVlZCBqb2JzIG9udG9cbiAgICogcXVldWUgY29uY3VycmVuY3kga2V5cyB3aGVuIGBxdWV1ZXNbbmFtZV0ubWF4Q29uY3VycmVudGAgaXMgYWRkZWQsIHJlbW92ZWQsXG4gICAqIG9yIGNoYW5nZWQuIENhbGxlZCBieSB0aGUgYmFja2dyb3VuZC1qb2JzIG1haW4gcHJvY2VzcyBvbiBzdGFydHVwIOKAlCB0aGVcbiAgICogZGVwbG95LXRpbWUgbW9tZW50IHF1ZXVlIGNvbmZpZ3VyYXRpb24gY2hhbmdlcyB0YWtlIGVmZmVjdC4gU2NoZW1hL3RlbmFudFxuICAgKiBjaGVja3MgYW5kIHJvdXRpbmUgY29ubmVjdGlvbiBpbml0aWFsaXphdGlvbiBkZWxpYmVyYXRlbHkgbmV2ZXIgcnVuIHRoaXM6XG4gICAqIHRoZXkgc3RheSByZWFkLW9ubHkgcmVnYXJkaW5nIHF1ZXVlZCBqb2Igcm93cywgYmVjYXVzZSB0aGUgYnJvYWRcbiAgICogYWRvcHRpb24vcmVsZWFzZSBVUERBVEVzIGRlYWRsb2NrIGFnYWluc3QgYWN0aXZlIGpvYiBwcm9jZXNzZXMgdW5kZXJcbiAgICogY29uY3VycmVudCB0ZW5hbnQgaW5pdGlhbGl6YXRpb24uIFNlcmlhbGl6ZWQgYWNyb3NzIHByb2Nlc3NlcyB3aXRoIGFcbiAgICogZGF0YWJhc2UgYWR2aXNvcnkgbG9jayBzbyBjb25jdXJyZW50bHkgc3RhcnRlZCBtYWlucyBjYW5ub3QgaW50ZXJsZWF2ZSB0aGVcbiAgICogVVBEQVRFczsgdGhlIHBlci1pbnN0YW5jZSBtZW1vIG9ubHkgc2tpcHMgcmVwZWF0IHdvcmsgd2l0aGluIHRoaXMgcHJvY2Vzcy5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgd2hlbiByZWNvbmNpbGVkLlxuICAgKi9cbiAgYXN5bmMgcmVjb25jaWxlUXVldWVDb25jdXJyZW5jeSgpIHtcbiAgICBpZiAodGhpcy5fcXVldWVDb25jdXJyZW5jeVJlY29uY2lsZWQpIHJldHVyblxuXG4gICAgY29uc3QgZGF0YWJhc2VJZGVudGlmaWVyID0gdGhpcy5nZXREYXRhYmFzZUlkZW50aWZpZXIoKVxuICAgIGNvbnN0IHN0YXJ0ZWRBdE1zID0gRGF0ZS5ub3coKVxuXG4gICAgYXdhaXQgdGhpcy5sb2dnZXIuaW5mbygoKSA9PiBbXG4gICAgICBcIlN0YXJ0aW5nIGJhY2tncm91bmQgam9icyBxdWV1ZS1jb25jdXJyZW5jeSBzdGFydHVwIHJlY29uY2lsaWF0aW9uXCIsXG4gICAgICB7ZGF0YWJhc2VJZGVudGlmaWVyfVxuICAgIF0pXG4gICAgYXdhaXQgdGhpcy5lbnN1cmVSZWFkeSgpXG5cbiAgICBhd2FpdCB0aGlzLl93aXRoRGIoYXN5bmMgKGRiKSA9PiB7XG4gICAgICBjb25zdCBsb2NrTmFtZSA9IFwiYmFja2dyb3VuZC1qb2JzOnF1ZXVlLWNvbmN1cnJlbmN5LXJlY29uY2lsZVwiXG4gICAgICBjb25zdCBhY3F1aXJlZCA9IGF3YWl0IGRiLmFjcXVpcmVBZHZpc29yeUxvY2sobG9ja05hbWUpXG5cbiAgICAgIGlmICghYWNxdWlyZWQpIHRocm93IG5ldyBFcnJvcihcIkZhaWxlZCB0byBhY3F1aXJlIGJhY2tncm91bmQgam9iIHF1ZXVlLWNvbmN1cnJlbmN5IHJlY29uY2lsZSBsb2NrXCIpXG5cbiAgICAgIHRyeSB7XG4gICAgICAgIGF3YWl0IHRoaXMuX3JlY29uY2lsZVF1ZXVlQ29uY3VycmVuY3koZGIpXG4gICAgICAgIGF3YWl0IHRoaXMuX3JlY29uY2lsZUNvbmN1cnJlbmN5KGRiKVxuXG4gICAgICAgIC8vIExhdGNoIHRoZSBtZW1vIG9ubHkgYWZ0ZXIgQk9USCBzdGVwcyBzdWNjZWVkOiBpZiB0aGUgY291bnQgcmVidWlsZFxuICAgICAgICAvLyBmYWlscyBhZnRlciBhZG9wdGlvbiwgYSByZXRyeSBvbiB0aGlzIHN0b3JlIG11c3QgcmUtZW50ZXIgYW5kIHJlcGFpclxuICAgICAgICAvLyB0aGUgY291bnRzIChhZG9wdGlvbiBpdHNlbGYgaXMgaWRlbXBvdGVudCkuXG4gICAgICAgIHRoaXMuX3F1ZXVlQ29uY3VycmVuY3lSZWNvbmNpbGVkID0gdHJ1ZVxuICAgICAgfSBmaW5hbGx5IHtcbiAgICAgICAgYXdhaXQgZGIucmVsZWFzZUFkdmlzb3J5TG9jayhsb2NrTmFtZSlcbiAgICAgIH1cbiAgICB9KVxuXG4gICAgYXdhaXQgdGhpcy5sb2dnZXIuaW5mbygoKSA9PiBbXG4gICAgICBcIkNvbXBsZXRlZCBiYWNrZ3JvdW5kIGpvYnMgcXVldWUtY29uY3VycmVuY3kgc3RhcnR1cCByZWNvbmNpbGlhdGlvblwiLFxuICAgICAge2RhdGFiYXNlSWRlbnRpZmllciwgZHVyYXRpb25NczogRGF0ZS5ub3coKSAtIHN0YXJ0ZWRBdE1zfVxuICAgIF0pXG4gIH1cblxuICAvKipcbiAgICogUnVucyBlbnF1ZXVlLlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIE9wdGlvbnMuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBhcmdzLmpvYk5hbWUgLSBKb2IgbmFtZS5cbiAgICogQHBhcmFtIHtBcnJheTxSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59IGFyZ3MuYXJncyAtIEFyZ3VtZW50cy5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL3R5cGVzLmpzXCIpLkJhY2tncm91bmRKb2JPcHRpb25zfSBbYXJncy5vcHRpb25zXSAtIE9wdGlvbnMuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHN0cmluZz59IC0gSm9iIGlkLlxuICAgKi9cbiAgYXN5bmMgZW5xdWV1ZSh7am9iTmFtZSwgYXJncywgb3B0aW9uc30pIHtcbiAgICBhd2FpdCB0aGlzLmVuc3VyZVJlYWR5KClcblxuICAgIGNvbnN0IHByZXBhcmVkSm9iID0gdGhpcy5fcHJlcGFyZUpvYih7am9iTmFtZSwgYXJncywgb3B0aW9uc30pXG5cbiAgICBpZiAob3B0aW9ucz8uaWRlbXBvdGVuY3lLZXkgIT09IHVuZGVmaW5lZCkge1xuICAgICAgcmV0dXJuIGF3YWl0IHRoaXMuX2VucXVldWVJZGVtcG90ZW50bHkoe2FyZ3M6IGFyZ3MgfHwgW10sIG9wdGlvbnMsIHByZXBhcmVkSm9ifSlcbiAgICB9XG5cbiAgICAvKiogQHR5cGUge3N0cmluZ30gKi9cbiAgICBsZXQgcmVzdWx0Sm9iSWQgPSBwcmVwYXJlZEpvYi5qb2JJZFxuXG4gICAgYXdhaXQgdGhpcy5fc2VyaWFsaXplZENvdW50TXV0YXRpb24oYXN5bmMgKGRiKSA9PiB7XG4gICAgICBpZiAob3B0aW9ucz8uZGVkdXBsaWNhdGVXaGlsZVF1ZXVlZCkge1xuICAgICAgICAvLyBEZWR1cGUgb24gdGhlIGpvYidzIGlkZW50aXR5IChuYW1lICsgYXJncyArIHF1ZXVlKSwgTk9UIGl0cyBjb25jdXJyZW5jeSBrZXksIHNvIGEgam9iXG4gICAgICAgIC8vIGtlZXBzIHdoYXRldmVyIGNvbmN1cnJlbmN5IGl0IHJlc29sdmVzIHRvLiBPbmx5IGFuIGV4aXN0aW5nIGpvYiBzY2hlZHVsZWQgbm8gbGF0ZXIgdGhhblxuICAgICAgICAvLyB0aGlzIGVucXVldWUgY2FuIGNvdmVyIGl0OyBhIHJldHJ5IGJhY2tlZCBvZmYgaW50byB0aGUgZnV0dXJlIG11c3Qgbm90IHN1cHByZXNzIGVhcmxpZXJcbiAgICAgICAgLy8gd29yay4gT3JkZXJpbmcgcmV0dXJucyB0aGUgZWFybGllc3QgY292ZXJpbmcgam9iIHdoZW4gc2V2ZXJhbCBxdWV1ZWQgcm93cyBhbHJlYWR5IGV4aXN0LlxuICAgICAgICBjb25zdCBleGlzdGluZyA9IGF3YWl0IGRiXG4gICAgICAgICAgLm5ld1F1ZXJ5KClcbiAgICAgICAgICAuZnJvbShKT0JTX1RBQkxFKVxuICAgICAgICAgIC5zZWxlY3QoXCJpZFwiKVxuICAgICAgICAgIC53aGVyZSh7c3RhdHVzOiBcInF1ZXVlZFwiLCBqb2JfbmFtZTogam9iTmFtZSwgYXJnc19qc29uOiBwcmVwYXJlZEpvYi5hcmdzSnNvbiwgcXVldWU6IHByZXBhcmVkSm9iLnF1ZXVlfSlcbiAgICAgICAgICAud2hlcmUoYHNjaGVkdWxlZF9hdF9tcyA8PSAke2RiLnF1b3RlKHByZXBhcmVkSm9iLnNjaGVkdWxlZEF0TXMpfWApXG4gICAgICAgICAgLm9yZGVyKFwic2NoZWR1bGVkX2F0X21zIEFTQ1wiKVxuICAgICAgICAgIC5saW1pdCgxKVxuICAgICAgICAgIC5yZXN1bHRzKClcblxuICAgICAgICBpZiAoZXhpc3RpbmdbMF0pIHtcbiAgICAgICAgICByZXN1bHRKb2JJZCA9IFN0cmluZygvKiogQHR5cGUge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gKi8gKGV4aXN0aW5nWzBdKS5pZClcblxuICAgICAgICAgIHJldHVyblxuICAgICAgICB9XG4gICAgICB9XG5cbiAgICAgIGF3YWl0IHRoaXMuX2luc2VydFByZXBhcmVkSm9iKGRiLCB7cHJlcGFyZWRKb2IsIHNjaGVkdWxlS2V5OiBudWxsfSlcbiAgICAgIGF3YWl0IHRoaXMuX3JlY29yZENvdW50RGVsdGEoZGIsIHthbGw6IDEsIHF1ZXVlZDogMX0pXG4gICAgfSlcblxuICAgIHJldHVybiByZXN1bHRKb2JJZFxuICB9XG5cbiAgLyoqXG4gICAqIEF0b21pY2FsbHkgb3ducyBvbmUgZHVyYWJsZSBpZGVtcG90ZW5jeSBzY29wZSBhbmQgY3JlYXRlcyBpdHMgam9iIGV4YWN0bHkgb25jZS5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBFbnF1ZXVlIGlucHV0LlxuICAgKiBAcGFyYW0ge0FycmF5PFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gYXJncy5hcmdzIC0gSm9iIGFyZ3VtZW50cy5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL3R5cGVzLmpzXCIpLkJhY2tncm91bmRKb2JPcHRpb25zfSBhcmdzLm9wdGlvbnMgLSBKb2Igb3B0aW9ucy5cbiAgICogQHBhcmFtIHtQcmVwYXJlZEJhY2tncm91bmRKb2J9IGFyZ3MucHJlcGFyZWRKb2IgLSBOb3JtYWxpemVkIGpvYi5cbiAgICogQHJldHVybnMge1Byb21pc2U8c3RyaW5nPn0gLSBTdGFibGUgb3JpZ2luYWwgam9iIGlkLlxuICAgKi9cbiAgYXN5bmMgX2VucXVldWVJZGVtcG90ZW50bHkoe2FyZ3MsIG9wdGlvbnMsIHByZXBhcmVkSm9ifSkge1xuICAgIGNvbnN0IGlkZW1wb3RlbmN5S2V5ID0gdGhpcy5fbm9ybWFsaXplSWRlbXBvdGVuY3lLZXkob3B0aW9ucy5pZGVtcG90ZW5jeUtleSlcbiAgICBjb25zdCBzY29wZURpZ2VzdCA9IHRoaXMuX2lkZW1wb3RlbmN5U2NvcGVEaWdlc3Qoe2lkZW1wb3RlbmN5S2V5LCBqb2JOYW1lOiBwcmVwYXJlZEpvYi5qb2JOYW1lLCBxdWV1ZTogcHJlcGFyZWRKb2IucXVldWV9KVxuICAgIGNvbnN0IHJlcXVlc3REaWdlc3QgPSB0aGlzLl9pZGVtcG90ZW5jeVJlcXVlc3REaWdlc3Qoe2FyZ3MsIG9wdGlvbnMsIHByZXBhcmVkSm9ifSlcbiAgICBjb25zdCBvd25lcnNoaXAgPSB7XG4gICAgICBjcmVhdGVkX2F0X21zOiBwcmVwYXJlZEpvYi5jcmVhdGVkQXRNcyxcbiAgICAgIGlkZW1wb3RlbmN5X2tleTogaWRlbXBvdGVuY3lLZXksXG4gICAgICBqb2JfaWQ6IHByZXBhcmVkSm9iLmpvYklkLFxuICAgICAgam9iX25hbWU6IHByZXBhcmVkSm9iLmpvYk5hbWUsXG4gICAgICBxdWV1ZTogcHJlcGFyZWRKb2IucXVldWUsXG4gICAgICByZXF1ZXN0X2RpZ2VzdDogcmVxdWVzdERpZ2VzdCxcbiAgICAgIHNjb3BlX2RpZ2VzdDogc2NvcGVEaWdlc3RcbiAgICB9XG4gICAgY29uc3QgbWFpbE9wZXJhdGlvbklucHV0ID0gbWFpbERlbGl2ZXJ5T3BlcmF0aW9uRm9ySm9iKHByZXBhcmVkSm9iLmpvYk5hbWUsIGFyZ3MpXG5cbiAgICBpZiAobWFpbE9wZXJhdGlvbklucHV0ICYmIG1haWxPcGVyYXRpb25JbnB1dC5vcGVyYXRpb24uaWQgIT09IGlkZW1wb3RlbmN5S2V5KSB7XG4gICAgICB0aHJvdyBWZWxvY2lvdXNFcnJvci5zYWZlKFwiTWFpbCBkZWxpdmVyeSBvcGVyYXRpb24gaWQgbXVzdCBlcXVhbCBpdHMgYmFja2dyb3VuZCBqb2IgaWRlbXBvdGVuY3kga2V5LlwiLCB7XG4gICAgICAgIGNvZGU6IFwibWFpbC1kZWxpdmVyeS1pZGVtcG90ZW5jeS1rZXktbWlzbWF0Y2hcIlxuICAgICAgfSlcbiAgICB9XG5cbiAgICAvLyBSZXVzZSBvcmRpbmFyeSBlbnF1ZXVlIHRyYW5zYWN0aW9uIGFkbWlzc2lvbiBiZWNhdXNlIHRoaXMgcGF0aCBjaGFuZ2VzXG4gICAgLy8gdGhlIHNhbWUgZHVyYWJsZSBjb3VudCByZXZpc2lvbi4gVGhlIHNjb3BlIHByaW1hcnkga2V5IHJlbWFpbnMgdGhlXG4gICAgLy8gY3Jvc3MtcHJvY2VzcyBjb252ZXJnZW5jZSBvd25lci5cbiAgICByZXR1cm4gYXdhaXQgdGhpcy5faWRlbXBvdGVudEVucXVldWVUcmFuc2FjdGlvbihhc3luYyAoZGIpID0+IHtcbiAgICAgIGNvbnN0IGV4aXN0aW5nID0gYXdhaXQgdGhpcy5faWRlbXBvdGVuY3lPd25lcnNoaXAoZGIsIHNjb3BlRGlnZXN0KVxuXG4gICAgICBpZiAoZXhpc3RpbmcpIHtcbiAgICAgICAgdGhpcy5fdmFsaWRhdGVJZGVtcG90ZW5jeU93bmVyc2hpcCh7ZXhpc3RpbmcsIG93bmVyc2hpcH0pXG4gICAgICAgIGF3YWl0IHRoaXMuX3ZhbGlkYXRlTWFpbERlbGl2ZXJ5T3BlcmF0aW9uKGRiLCB7am9iSWQ6IFN0cmluZyhleGlzdGluZy5qb2JfaWQpLCBtYWlsT3BlcmF0aW9uSW5wdXR9KVxuICAgICAgICByZXR1cm4gU3RyaW5nKGV4aXN0aW5nLmpvYl9pZClcbiAgICAgIH1cblxuICAgICAgY29uc3QgY2xhaW1lZCA9IGF3YWl0IHRoaXMuX2NsYWltSWRlbXBvdGVuY3lPd25lcnNoaXAoZGIsIG93bmVyc2hpcClcblxuICAgICAgaWYgKCFjbGFpbWVkLmNyZWF0ZWQpIHtcbiAgICAgICAgdGhpcy5fdmFsaWRhdGVJZGVtcG90ZW5jeU93bmVyc2hpcCh7ZXhpc3Rpbmc6IGNsYWltZWQucm93LCBvd25lcnNoaXB9KVxuICAgICAgICBhd2FpdCB0aGlzLl92YWxpZGF0ZU1haWxEZWxpdmVyeU9wZXJhdGlvbihkYiwge2pvYklkOiBTdHJpbmcoY2xhaW1lZC5yb3cuam9iX2lkKSwgbWFpbE9wZXJhdGlvbklucHV0fSlcbiAgICAgICAgcmV0dXJuIFN0cmluZyhjbGFpbWVkLnJvdy5qb2JfaWQpXG4gICAgICB9XG5cbiAgICAgIGF3YWl0IHRoaXMuX2xvY2tDb3VudFJldmlzaW9uKGRiKVxuICAgICAgYXdhaXQgdGhpcy5faW5zZXJ0UHJlcGFyZWRKb2IoZGIsIHtwcmVwYXJlZEpvYiwgc2NoZWR1bGVLZXk6IG51bGx9KVxuICAgICAgYXdhaXQgdGhpcy5fcGVyc2lzdE1haWxEZWxpdmVyeU9wZXJhdGlvbihkYiwge2pvYklkOiBwcmVwYXJlZEpvYi5qb2JJZCwgbWFpbE9wZXJhdGlvbklucHV0LCBjcmVhdGVkQXRNczogcHJlcGFyZWRKb2IuY3JlYXRlZEF0TXN9KVxuICAgICAgYXdhaXQgdGhpcy5fcmVjb3JkQ291bnREZWx0YShkYiwge2FsbDogMSwgcXVldWVkOiAxfSlcblxuICAgICAgcmV0dXJuIHByZXBhcmVkSm9iLmpvYklkXG4gICAgfSlcbiAgfVxuXG4gIC8qKlxuICAgKiBTZXJpYWxpemVzIG9uZSBwaHlzaWNhbCBjb25uZWN0aW9uIGxvY2FsbHkgd2l0aG91dCB0YWtpbmcgb3duZXJzaGlwIGF3YXlcbiAgICogZnJvbSB0aGUgZGF0YWJhc2UgdW5pcXVlbmVzcyBjb25zdHJhaW50IHNoYXJlZCBieSBhbGwgcHJvY2Vzc2VzLlxuICAgKiBAdGVtcGxhdGUgVFxuICAgKiBAcGFyYW0geyhkYjogaW1wb3J0KFwiLi4vZGF0YWJhc2UvZHJpdmVycy9iYXNlLmpzXCIpLmRlZmF1bHQpID0+IFByb21pc2U8VD59IGNhbGxiYWNrIC0gVHJhbnNhY3Rpb24gd29yay5cbiAgICogQHJldHVybnMge1Byb21pc2U8VD59IC0gQ2FsbGJhY2sgcmVzdWx0LlxuICAgKi9cbiAgYXN5bmMgX2lkZW1wb3RlbnRFbnF1ZXVlVHJhbnNhY3Rpb24oY2FsbGJhY2spIHtcbiAgICByZXR1cm4gYXdhaXQgdGhpcy5fc2VyaWFsaXplZFRyYW5zYWN0aW9uTXV0YXRpb24oY2FsbGJhY2spXG4gIH1cblxuICAvKipcbiAgICogSW5zZXJ0cyBhbiBvd25lcnNoaXAgcm93LCByZXNvbHZpbmcgb25seSBhIGRhdGFiYXNlIHVuaXF1ZW5lc3MgcmFjZS5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9kYXRhYmFzZS9kcml2ZXJzL2Jhc2UuanNcIikuZGVmYXVsdH0gZGIgLSBUcmFuc2FjdGlvbiBjb25uZWN0aW9uLlxuICAgKiBAcGFyYW0ge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gb3duZXJzaGlwIC0gT3duZXJzaGlwIHJvdy5cbiAgICogQHJldHVybnMge1Byb21pc2U8e2NyZWF0ZWQ6IGJvb2xlYW4sIHJvdzogUmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fT59IC0gQ2xhaW0gcmVzdWx0LlxuICAgKi9cbiAgYXN5bmMgX2NsYWltSWRlbXBvdGVuY3lPd25lcnNoaXAoZGIsIG93bmVyc2hpcCkge1xuICAgIHRyeSB7XG4gICAgICAvLyBUaGUgc2F2ZXBvaW50IGtlZXBzIFBvc3RncmVTUUwncyBvdXRlciB0cmFuc2FjdGlvbiB1c2FibGUgYWZ0ZXIgYVxuICAgICAgLy8gY29uY3VycmVudCB1bmlxdWUta2V5IGxvc3MuIFRoZSB1bmlxdWUgcHJpbWFyeSBrZXksIG5vdCBhIHByb2Nlc3NcbiAgICAgIC8vIG11dGV4LCBpcyB0aGUgY3Jvc3MtcHJvY2VzcyBjb252ZXJnZW5jZSBhdXRob3JpdHkuXG4gICAgICBhd2FpdCBkYi50cmFuc2FjdGlvbihhc3luYyAoKSA9PiB7XG4gICAgICAgIGF3YWl0IGRiLmluc2VydCh7dGFibGVOYW1lOiBJREVNUE9URU5DWV9LRVlTX1RBQkxFLCBkYXRhOiBvd25lcnNoaXB9KVxuICAgICAgfSlcblxuICAgICAgcmV0dXJuIHtjcmVhdGVkOiB0cnVlLCByb3c6IG93bmVyc2hpcH1cbiAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgY29uc3QgcmFjZWQgPSBhd2FpdCB0aGlzLl9pZGVtcG90ZW5jeU93bmVyc2hpcChkYiwgU3RyaW5nKG93bmVyc2hpcC5zY29wZV9kaWdlc3QpKVxuXG4gICAgICBpZiAoIXJhY2VkKSB0aHJvdyBlcnJvclxuICAgICAgcmV0dXJuIHtjcmVhdGVkOiBmYWxzZSwgcm93OiByYWNlZH1cbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogTG9hZHMgb25lIGR1cmFibGUgZW5xdWV1ZSBvd25lci5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9kYXRhYmFzZS9kcml2ZXJzL2Jhc2UuanNcIikuZGVmYXVsdH0gZGIgLSBEYXRhYmFzZSBjb25uZWN0aW9uLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gc2NvcGVEaWdlc3QgLSBGaXhlZC1zaXplIHNjb3BlIGRpZ2VzdC5cbiAgICogQHJldHVybnMge1Byb21pc2U8UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+IHwgbnVsbD59IC0gUm93IG9yIG51bGwuXG4gICAqL1xuICBhc3luYyBfaWRlbXBvdGVuY3lPd25lcnNoaXAoZGIsIHNjb3BlRGlnZXN0KSB7XG4gICAgY29uc3Qgcm93cyA9IGF3YWl0IGRiLm5ld1F1ZXJ5KCkuZnJvbShJREVNUE9URU5DWV9LRVlTX1RBQkxFKS53aGVyZSh7c2NvcGVfZGlnZXN0OiBzY29wZURpZ2VzdH0pLmxpbWl0KDEpLnJlc3VsdHMoKVxuXG4gICAgcmV0dXJuIHJvd3NbMF0gPyAvKiogQHR5cGUge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gKi8gKHJvd3NbMF0pIDogbnVsbFxuICB9XG5cbiAgLyoqXG4gICAqIEZhaWxzIGNsb3NlZCB3aGVuIGEgZHVyYWJsZSBrZXkgaXMgcmV1c2VkIGZvciBhIGRpZmZlcmVudCBjYW5vbmljYWwgcmVxdWVzdC5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBWYWxpZGF0aW9uIGlucHV0LlxuICAgKiBAcGFyYW0ge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gYXJncy5leGlzdGluZyAtIFN0b3JlZCBvd25lci5cbiAgICogQHBhcmFtIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59IGFyZ3Mub3duZXJzaGlwIC0gUmVxdWVzdGVkIG93bmVyLlxuICAgKiBAcmV0dXJucyB7dm9pZH1cbiAgICovXG4gIF92YWxpZGF0ZUlkZW1wb3RlbmN5T3duZXJzaGlwKHtleGlzdGluZywgb3duZXJzaGlwfSkge1xuICAgIGNvbnN0IGV4YWN0U2NvcGUgPSBTdHJpbmcoZXhpc3Rpbmcuam9iX25hbWUpID09PSBvd25lcnNoaXAuam9iX25hbWVcbiAgICAgICYmIFN0cmluZyhleGlzdGluZy5xdWV1ZSkgPT09IG93bmVyc2hpcC5xdWV1ZVxuICAgICAgJiYgU3RyaW5nKGV4aXN0aW5nLmlkZW1wb3RlbmN5X2tleSkgPT09IG93bmVyc2hpcC5pZGVtcG90ZW5jeV9rZXlcblxuICAgIGlmICghZXhhY3RTY29wZSB8fCBTdHJpbmcoZXhpc3RpbmcucmVxdWVzdF9kaWdlc3QpICE9PSBvd25lcnNoaXAucmVxdWVzdF9kaWdlc3QpIHtcbiAgICAgIHRocm93IFZlbG9jaW91c0Vycm9yLnNhZmUoXCJUaGUgYmFja2dyb3VuZCBqb2IgaWRlbXBvdGVuY3kga2V5IHdhcyBhbHJlYWR5IHVzZWQgZm9yIGEgZGlmZmVyZW50IHJlcXVlc3QuXCIsIHtcbiAgICAgICAgY29kZTogXCJiYWNrZ3JvdW5kLWpvYi1pZGVtcG90ZW5jeS1jb25mbGljdFwiXG4gICAgICB9KVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBQZXJzaXN0cyB0aGUgYnVpbHQtaW4gbWFpbCBvcGVyYXRpb24gaW4gdGhlIHNhbWUgZmlyc3QtZW5xdWV1ZSB0cmFuc2FjdGlvbi5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9kYXRhYmFzZS9kcml2ZXJzL2Jhc2UuanNcIikuZGVmYXVsdH0gZGIgLSBUcmFuc2FjdGlvbiBjb25uZWN0aW9uLlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIE9wZXJhdGlvbiBpbnB1dC5cbiAgICogQHBhcmFtIHtudW1iZXJ9IGFyZ3MuY3JlYXRlZEF0TXMgLSBDcmVhdGlvbiB0aW1lc3RhbXAuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBhcmdzLmpvYklkIC0gTmF0aXZlIGpvYiBpZC5cbiAgICogQHBhcmFtIHt7b3BlcmF0aW9uOiBpbXBvcnQoXCIuLi9tYWlsZXIvaW5kZXguanNcIikuTWFpbGVyRGVsaXZlcnlPcGVyYXRpb24sIHBheWxvYWQ6IGltcG9ydChcIi4uL21haWxlci9pbmRleC5qc1wiKS5NYWlsZXJEZWxpdmVyeVBheWxvYWR9IHwgbnVsbH0gYXJncy5tYWlsT3BlcmF0aW9uSW5wdXQgLSBNYWlsIG9wZXJhdGlvbi5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgYWZ0ZXIgcGVyc2lzdGVuY2UuXG4gICAqL1xuICBhc3luYyBfcGVyc2lzdE1haWxEZWxpdmVyeU9wZXJhdGlvbihkYiwge2NyZWF0ZWRBdE1zLCBqb2JJZCwgbWFpbE9wZXJhdGlvbklucHV0fSkge1xuICAgIGlmICghbWFpbE9wZXJhdGlvbklucHV0KSByZXR1cm5cbiAgICBjb25zdCB7b3BlcmF0aW9ufSA9IG1haWxPcGVyYXRpb25JbnB1dFxuICAgIGNvbnN0IG9wZXJhdGlvbktleSA9IG1haWxEZWxpdmVyeU9wZXJhdGlvbktleShvcGVyYXRpb24uaWQpXG4gICAgY29uc3Qgcm93ID0ge1xuICAgICAgYmFja2dyb3VuZF9qb2JfaWQ6IGpvYklkLFxuICAgICAgY3JlYXRlZF9hdF9tczogY3JlYXRlZEF0TXMsXG4gICAgICBmaXJzdF9hdHRlbXB0X3N0YXJ0ZWRfYXRfbXM6IG51bGwsXG4gICAgICBvcGVyYXRpb25faWQ6IG9wZXJhdGlvbi5pZCxcbiAgICAgIG9wZXJhdGlvbl9rZXk6IG9wZXJhdGlvbktleSxcbiAgICAgIHBheWxvYWRfZGlnZXN0OiBvcGVyYXRpb24ucGF5bG9hZERpZ2VzdCxcbiAgICAgIHByb3ZpZGVyX2tpbmQ6IG9wZXJhdGlvbi5wcm92aWRlcktpbmQsXG4gICAgICBwcm92aWRlcl9yZXRlbnRpb25fbXM6IG9wZXJhdGlvbi5wcm92aWRlclJldGVudGlvbk1zXG4gICAgfVxuXG4gICAgdHJ5IHtcbiAgICAgIGF3YWl0IGRiLnRyYW5zYWN0aW9uKGFzeW5jICgpID0+IHtcbiAgICAgICAgYXdhaXQgZGIuaW5zZXJ0KHt0YWJsZU5hbWU6IE1BSUxfREVMSVZFUllfT1BFUkFUSU9OU19UQUJMRSwgZGF0YTogcm93fSlcbiAgICAgIH0pXG4gICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgIGNvbnN0IGV4aXN0aW5nID0gYXdhaXQgdGhpcy5fbWFpbERlbGl2ZXJ5T3BlcmF0aW9uKGRiLCBvcGVyYXRpb25LZXkpXG5cbiAgICAgIGlmICghZXhpc3RpbmcpIHRocm93IGVycm9yXG4gICAgICB0aGlzLl92YWxpZGF0ZU1haWxEZWxpdmVyeU9wZXJhdGlvblJvdyh7ZXhpc3RpbmcsIHJlcXVlc3RlZDogcm93fSlcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogVmFsaWRhdGVzIHRoZSBkdXJhYmxlIG1haWwgcm93IGR1cmluZyBhbiBleGFjdCBnZW5lcmljIGVucXVldWUgcmVwbGF5LlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL2RhdGFiYXNlL2RyaXZlcnMvYmFzZS5qc1wiKS5kZWZhdWx0fSBkYiAtIERhdGFiYXNlIGNvbm5lY3Rpb24uXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gVmFsaWRhdGlvbiBpbnB1dC5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGFyZ3Muam9iSWQgLSBPd25lZCBqb2IgaWQuXG4gICAqIEBwYXJhbSB7e29wZXJhdGlvbjogaW1wb3J0KFwiLi4vbWFpbGVyL2luZGV4LmpzXCIpLk1haWxlckRlbGl2ZXJ5T3BlcmF0aW9uLCBwYXlsb2FkOiBpbXBvcnQoXCIuLi9tYWlsZXIvaW5kZXguanNcIikuTWFpbGVyRGVsaXZlcnlQYXlsb2FkfSB8IG51bGx9IGFyZ3MubWFpbE9wZXJhdGlvbklucHV0IC0gTWFpbCBvcGVyYXRpb24uXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIHdoZW4gZXhhY3QuXG4gICAqL1xuICBhc3luYyBfdmFsaWRhdGVNYWlsRGVsaXZlcnlPcGVyYXRpb24oZGIsIHtqb2JJZCwgbWFpbE9wZXJhdGlvbklucHV0fSkge1xuICAgIGlmICghbWFpbE9wZXJhdGlvbklucHV0KSByZXR1cm5cbiAgICBjb25zdCB7b3BlcmF0aW9ufSA9IG1haWxPcGVyYXRpb25JbnB1dFxuICAgIGNvbnN0IGV4aXN0aW5nID0gYXdhaXQgdGhpcy5fbWFpbERlbGl2ZXJ5T3BlcmF0aW9uKGRiLCBtYWlsRGVsaXZlcnlPcGVyYXRpb25LZXkob3BlcmF0aW9uLmlkKSlcblxuICAgIGlmICghZXhpc3RpbmcpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihcIkJhY2tncm91bmQgam9iIGlkZW1wb3RlbmN5IG93bmVyc2hpcCBpcyBtaXNzaW5nIGl0cyBkdXJhYmxlIG1haWwgZGVsaXZlcnkgb3BlcmF0aW9uXCIpXG4gICAgfVxuXG4gICAgdGhpcy5fdmFsaWRhdGVNYWlsRGVsaXZlcnlPcGVyYXRpb25Sb3coe1xuICAgICAgZXhpc3RpbmcsXG4gICAgICByZXF1ZXN0ZWQ6IHtcbiAgICAgICAgYmFja2dyb3VuZF9qb2JfaWQ6IGpvYklkLFxuICAgICAgICBvcGVyYXRpb25faWQ6IG9wZXJhdGlvbi5pZCxcbiAgICAgICAgcGF5bG9hZF9kaWdlc3Q6IG9wZXJhdGlvbi5wYXlsb2FkRGlnZXN0LFxuICAgICAgICBwcm92aWRlcl9raW5kOiBvcGVyYXRpb24ucHJvdmlkZXJLaW5kLFxuICAgICAgICBwcm92aWRlcl9yZXRlbnRpb25fbXM6IG9wZXJhdGlvbi5wcm92aWRlclJldGVudGlvbk1zXG4gICAgICB9XG4gICAgfSlcbiAgfVxuXG4gIC8qKlxuICAgKiBMb2FkcyBhIGR1cmFibGUgbWFpbCBvcGVyYXRpb24uXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vZGF0YWJhc2UvZHJpdmVycy9iYXNlLmpzXCIpLmRlZmF1bHR9IGRiIC0gRGF0YWJhc2UgY29ubmVjdGlvbi5cbiAgICogQHBhcmFtIHtzdHJpbmd9IG9wZXJhdGlvbktleSAtIEZpeGVkLXNpemUgb3BlcmF0aW9uIGtleS5cbiAgICogQHJldHVybnMge1Byb21pc2U8UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+IHwgbnVsbD59IC0gUm93IG9yIG51bGwuXG4gICAqL1xuICBhc3luYyBfbWFpbERlbGl2ZXJ5T3BlcmF0aW9uKGRiLCBvcGVyYXRpb25LZXkpIHtcbiAgICBjb25zdCByb3dzID0gYXdhaXQgZGIubmV3UXVlcnkoKS5mcm9tKE1BSUxfREVMSVZFUllfT1BFUkFUSU9OU19UQUJMRSkud2hlcmUoe29wZXJhdGlvbl9rZXk6IG9wZXJhdGlvbktleX0pLmxpbWl0KDEpLnJlc3VsdHMoKVxuXG4gICAgcmV0dXJuIHJvd3NbMF0gPyAvKiogQHR5cGUge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gKi8gKHJvd3NbMF0pIDogbnVsbFxuICB9XG5cbiAgLyoqXG4gICAqIENvbXBhcmVzIHByb3ZpZGVyLXJlbGV2YW50IGR1cmFibGUgbWFpbCBvcGVyYXRpb24gZmllbGRzLlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIFZhbGlkYXRpb24gaW5wdXQuXG4gICAqIEBwYXJhbSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSBhcmdzLmV4aXN0aW5nIC0gU3RvcmVkIHJvdy5cbiAgICogQHBhcmFtIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59IGFyZ3MucmVxdWVzdGVkIC0gUmVxdWVzdGVkIHJvdy5cbiAgICogQHJldHVybnMge3ZvaWR9XG4gICAqL1xuICBfdmFsaWRhdGVNYWlsRGVsaXZlcnlPcGVyYXRpb25Sb3coe2V4aXN0aW5nLCByZXF1ZXN0ZWR9KSB7XG4gICAgY29uc3QgbWF0Y2hlcyA9IFN0cmluZyhleGlzdGluZy5vcGVyYXRpb25faWQpID09PSByZXF1ZXN0ZWQub3BlcmF0aW9uX2lkXG4gICAgICAmJiBTdHJpbmcoZXhpc3RpbmcucGF5bG9hZF9kaWdlc3QpID09PSByZXF1ZXN0ZWQucGF5bG9hZF9kaWdlc3RcbiAgICAgICYmIFN0cmluZyhleGlzdGluZy5iYWNrZ3JvdW5kX2pvYl9pZCkgPT09IHJlcXVlc3RlZC5iYWNrZ3JvdW5kX2pvYl9pZFxuICAgICAgJiYgU3RyaW5nKGV4aXN0aW5nLnByb3ZpZGVyX2tpbmQpID09PSByZXF1ZXN0ZWQucHJvdmlkZXJfa2luZFxuICAgICAgJiYgdGhpcy5fbm9ybWFsaXplTnVtYmVyKGV4aXN0aW5nLnByb3ZpZGVyX3JldGVudGlvbl9tcykgPT09IHJlcXVlc3RlZC5wcm92aWRlcl9yZXRlbnRpb25fbXNcblxuICAgIGlmICghbWF0Y2hlcykge1xuICAgICAgdGhyb3cgVmVsb2Npb3VzRXJyb3Iuc2FmZShcIlRoZSBtYWlsIGRlbGl2ZXJ5IG9wZXJhdGlvbiB3YXMgYWxyZWFkeSB1c2VkIGZvciBhIGRpZmZlcmVudCBwYXlsb2FkIG9yIHByb3ZpZGVyLlwiLCB7XG4gICAgICAgIGNvZGU6IFwibWFpbC1kZWxpdmVyeS1pZGVtcG90ZW5jeS1jb25mbGljdFwiXG4gICAgICB9KVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBDYW5vbmljYWwgcmVxdWVzdCBkaWdlc3QgZXhjbHVkaW5nIGdlbmVyYXRlZCBpZHMgYW5kIGltbWVkaWF0ZSBlbnF1ZXVlIHRpbWUuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gRGlnZXN0IGlucHV0LlxuICAgKiBAcGFyYW0ge0FycmF5PFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gYXJncy5hcmdzIC0gSm9iIGFyZ3VtZW50cy5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL3R5cGVzLmpzXCIpLkJhY2tncm91bmRKb2JPcHRpb25zfSBhcmdzLm9wdGlvbnMgLSBKb2Igb3B0aW9ucy5cbiAgICogQHBhcmFtIHtQcmVwYXJlZEJhY2tncm91bmRKb2J9IGFyZ3MucHJlcGFyZWRKb2IgLSBOb3JtYWxpemVkIGpvYi5cbiAgICogQHJldHVybnMge3N0cmluZ30gLSBTSEEtMjU2IGRpZ2VzdC5cbiAgICovXG4gIF9pZGVtcG90ZW5jeVJlcXVlc3REaWdlc3Qoe2FyZ3MsIG9wdGlvbnMsIHByZXBhcmVkSm9ifSkge1xuICAgIGNvbnN0IHNlcmlhbGl6ZWQgPSBzdGFibGVKc29uU3RyaW5naWZ5KHtcbiAgICAgIGFyZ3MsXG4gICAgICBjb25jdXJyZW5jeTogcHJlcGFyZWRKb2IuY29uY3VycmVuY3ksXG4gICAgICBleGVjdXRpb25Nb2RlOiBwcmVwYXJlZEpvYi5leGVjdXRpb25Nb2RlLFxuICAgICAgZm9ybWF0OiBcInZlbG9jaW91cy1iYWNrZ3JvdW5kLWpvYi1pZGVtcG90ZW5jeS12MVwiLFxuICAgICAgam9iTmFtZTogcHJlcGFyZWRKb2Iuam9iTmFtZSxcbiAgICAgIG1heFJldHJpZXM6IHByZXBhcmVkSm9iLm1heFJldHJpZXMsXG4gICAgICBxdWV1ZTogcHJlcGFyZWRKb2IucXVldWUsXG4gICAgICBzY2hlZHVsZWRBdE1zOiBvcHRpb25zLnNjaGVkdWxlZEF0TXMgPT09IHVuZGVmaW5lZCA/IG51bGwgOiBwcmVwYXJlZEpvYi5zY2hlZHVsZWRBdE1zLFxuICAgICAgc2NoZWR1bGluZzogb3B0aW9ucy5zY2hlZHVsZWRBdE1zID09PSB1bmRlZmluZWQgPyBcImltbWVkaWF0ZVwiIDogXCJzY2hlZHVsZWRcIixcbiAgICAgIC4uLihwcmVwYXJlZEpvYi50aW1lb3V0TXMgPT09IG51bGwgPyB7fSA6IHt0aW1lb3V0TXM6IHByZXBhcmVkSm9iLnRpbWVvdXRNc30pXG4gICAgfSlcblxuICAgIHJldHVybiBjcmVhdGVIYXNoKFwic2hhMjU2XCIpLnVwZGF0ZShzZXJpYWxpemVkKS5kaWdlc3QoXCJoZXhcIilcbiAgfVxuXG4gIC8qKlxuICAgKiBGaXhlZC1zaXplIGdsb2JhbGx5IGluZGV4ZWQgcmVwcmVzZW50YXRpb24gb2YgdGhlIGRvY3VtZW50ZWQgc2NvcGUgdHVwbGUuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gU2NvcGUgaW5wdXQuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBhcmdzLmlkZW1wb3RlbmN5S2V5IC0gQ2FsbGVyIGtleS5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGFyZ3Muam9iTmFtZSAtIEpvYiBjbGFzcyBuYW1lLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gYXJncy5xdWV1ZSAtIFF1ZXVlIG5hbWUuXG4gICAqIEByZXR1cm5zIHtzdHJpbmd9IC0gU0hBLTI1NiBzY29wZSBkaWdlc3QuXG4gICAqL1xuICBfaWRlbXBvdGVuY3lTY29wZURpZ2VzdCh7aWRlbXBvdGVuY3lLZXksIGpvYk5hbWUsIHF1ZXVlfSkge1xuICAgIHJldHVybiBjcmVhdGVIYXNoKFwic2hhMjU2XCIpXG4gICAgICAudXBkYXRlKHN0YWJsZUpzb25TdHJpbmdpZnkoe2Zvcm1hdDogXCJ2ZWxvY2lvdXMtYmFja2dyb3VuZC1qb2ItaWRlbXBvdGVuY3ktc2NvcGUtdjFcIiwgaWRlbXBvdGVuY3lLZXksIGpvYk5hbWUsIHF1ZXVlfSkpXG4gICAgICAuZGlnZXN0KFwiaGV4XCIpXG4gIH1cblxuICAvKipcbiAgICogVmFsaWRhdGVzIG9uZSBjYWxsZXIga2V5LlxuICAgKiBAcGFyYW0ge3N0cmluZyB8IHVuZGVmaW5lZH0gaWRlbXBvdGVuY3lLZXkgLSBDYWxsZXIga2V5LlxuICAgKiBAcmV0dXJucyB7c3RyaW5nfSAtIFZhbGlkIGtleS5cbiAgICovXG4gIF9ub3JtYWxpemVJZGVtcG90ZW5jeUtleShpZGVtcG90ZW5jeUtleSkge1xuICAgIGlmICh0eXBlb2YgaWRlbXBvdGVuY3lLZXkgIT09IFwic3RyaW5nXCIgfHwgaWRlbXBvdGVuY3lLZXkubGVuZ3RoID09PSAwKSB7XG4gICAgICB0aHJvdyBWZWxvY2lvdXNFcnJvci5zYWZlKFwiQmFja2dyb3VuZCBqb2IgaWRlbXBvdGVuY3lLZXkgbXVzdCBiZSBhIG5vbi1lbXB0eSBzdHJpbmcuXCIsIHtcbiAgICAgICAgY29kZTogXCJiYWNrZ3JvdW5kLWpvYi1pZGVtcG90ZW5jeS1rZXktaW52YWxpZFwiXG4gICAgICB9KVxuICAgIH1cblxuICAgIHJldHVybiBpZGVtcG90ZW5jeUtleVxuICB9XG5cbiAgLyoqXG4gICAqIFJlcGxhY2VzIHRoZSBxdWV1ZWQgb3duZXIgb2YgYSBzdGFibGUgc2NoZWR1bGUga2V5IHdpdGggYSBuZXcgb25lLW9mZiBqb2IuXG4gICAqIEEgaGFuZGVkLW9mZiBvd25lciBpcyBsZWZ0IHJ1bm5pbmcgYW5kIHJlcG9ydGVkIHRydXRoZnVsbHkuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gT3B0aW9ucy5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGFyZ3Muc2NoZWR1bGVLZXkgLSBTdGFibGUgbG9naWNhbCBzY2hlZHVsZSBrZXkuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBhcmdzLmpvYk5hbWUgLSBKb2IgbmFtZS5cbiAgICogQHBhcmFtIHtBcnJheTxSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59IGFyZ3MuYXJncyAtIEFyZ3VtZW50cy5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL3R5cGVzLmpzXCIpLkJhY2tncm91bmRKb2JPcHRpb25zfSBbYXJncy5vcHRpb25zXSAtIE9wdGlvbnMuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPGltcG9ydChcIi4vdHlwZXMuanNcIikuQmFja2dyb3VuZEpvYlJlcGxhY2VtZW50UmVzdWx0Pn0gLSBSZXBsYWNlbWVudCByZXN1bHQuXG4gICAqL1xuICBhc3luYyByZXBsYWNlU2NoZWR1bGVkKHtzY2hlZHVsZUtleSwgam9iTmFtZSwgYXJncywgb3B0aW9uc30pIHtcbiAgICBhd2FpdCB0aGlzLmVuc3VyZVJlYWR5KClcblxuICAgIGNvbnN0IG5vcm1hbGl6ZWRTY2hlZHVsZUtleSA9IHRoaXMuX25vcm1hbGl6ZVNjaGVkdWxlS2V5KHNjaGVkdWxlS2V5KVxuICAgIGNvbnN0IHByZXBhcmVkSm9iID0gdGhpcy5fcHJlcGFyZUpvYih7am9iTmFtZSwgYXJncywgb3B0aW9uc30pXG5cbiAgICByZXR1cm4gYXdhaXQgdGhpcy5fc2VyaWFsaXplZENvdW50TXV0YXRpb24oYXN5bmMgKGRiKSA9PiB7XG4gICAgICBjb25zdCBvd25lclJvd3MgPSBhd2FpdCBkYlxuICAgICAgICAubmV3UXVlcnkoKVxuICAgICAgICAuZnJvbShTQ0hFRFVMRV9LRVlTX1RBQkxFKVxuICAgICAgICAud2hlcmUoe3NjaGVkdWxlX2tleTogbm9ybWFsaXplZFNjaGVkdWxlS2V5fSlcbiAgICAgICAgLmxpbWl0KDEpXG4gICAgICAgIC5yZXN1bHRzKClcbiAgICAgIGNvbnN0IG93bmVySm9iSWQgPSBvd25lclJvd3NbMF0gPyBTdHJpbmcoLyoqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59ICovIChvd25lclJvd3NbMF0pLmpvYl9pZCkgOiBudWxsXG4gICAgICBjb25zdCBvd25lckpvYiA9IG93bmVySm9iSWQgPyBhd2FpdCB0aGlzLl9nZXRKb2JSb3dCeUlkKGRiLCBvd25lckpvYklkKSA6IG51bGxcbiAgICAgIC8qKiBAdHlwZSB7aW1wb3J0KFwiLi90eXBlcy5qc1wiKS5CYWNrZ3JvdW5kSm9iUmVwbGFjZW1lbnRQcmV2aW91c1N0YXR1c30gKi9cbiAgICAgIGxldCBwcmV2aW91c1N0YXR1cyA9IG51bGxcbiAgICAgIGxldCBwcmV2aW91c0pvYklkID0gbnVsbFxuXG4gICAgICBpZiAob3duZXJKb2I/LnN0YXR1cyA9PT0gXCJxdWV1ZWRcIikge1xuICAgICAgICBjb25zdCBhZmZlY3RlZFJvd3MgPSBhd2FpdCB0aGlzLl91cGRhdGVBZmZlY3RlZFJvd3MoZGIsIHtcbiAgICAgICAgICB0YWJsZU5hbWU6IEpPQlNfVEFCTEUsXG4gICAgICAgICAgZGF0YToge3N0YXR1czogXCJjYW5jZWxsZWRcIn0sXG4gICAgICAgICAgY29uZGl0aW9uczoge2lkOiBvd25lckpvYi5pZCwgc3RhdHVzOiBcInF1ZXVlZFwifVxuICAgICAgICB9KVxuXG4gICAgICAgIGlmIChhZmZlY3RlZFJvd3MgPT09IDEpIHtcbiAgICAgICAgICBwcmV2aW91c0pvYklkID0gb3duZXJKb2IuaWRcbiAgICAgICAgICBwcmV2aW91c1N0YXR1cyA9IFwicXVldWVkXCJcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICBjb25zdCBjdXJyZW50T3duZXJKb2IgPSBhd2FpdCB0aGlzLl9nZXRKb2JSb3dCeUlkKGRiLCBvd25lckpvYi5pZClcblxuICAgICAgICAgIGlmIChjdXJyZW50T3duZXJKb2I/LnN0YXR1cyA9PT0gXCJoYW5kZWRfb2ZmXCIpIHtcbiAgICAgICAgICAgIHByZXZpb3VzSm9iSWQgPSBjdXJyZW50T3duZXJKb2IuaWRcbiAgICAgICAgICAgIHByZXZpb3VzU3RhdHVzID0gXCJoYW5kZWRfb2ZmXCJcbiAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICAgIH0gZWxzZSBpZiAob3duZXJKb2I/LnN0YXR1cyA9PT0gXCJoYW5kZWRfb2ZmXCIpIHtcbiAgICAgICAgcHJldmlvdXNKb2JJZCA9IG93bmVySm9iLmlkXG4gICAgICAgIHByZXZpb3VzU3RhdHVzID0gXCJoYW5kZWRfb2ZmXCJcbiAgICAgIH1cblxuICAgICAgYXdhaXQgdGhpcy5faW5zZXJ0UHJlcGFyZWRKb2IoZGIsIHtwcmVwYXJlZEpvYiwgc2NoZWR1bGVLZXk6IG5vcm1hbGl6ZWRTY2hlZHVsZUtleX0pXG4gICAgICBhd2FpdCBkYi51cHNlcnQoe1xuICAgICAgICB0YWJsZU5hbWU6IFNDSEVEVUxFX0tFWVNfVEFCTEUsXG4gICAgICAgIGRhdGE6IHtzY2hlZHVsZV9rZXk6IG5vcm1hbGl6ZWRTY2hlZHVsZUtleSwgam9iX2lkOiBwcmVwYXJlZEpvYi5qb2JJZH0sXG4gICAgICAgIGNvbmZsaWN0Q29sdW1uczogW1wic2NoZWR1bGVfa2V5XCJdLFxuICAgICAgICB1cGRhdGVDb2x1bW5zOiBbXCJqb2JfaWRcIl1cbiAgICAgIH0pXG5cbiAgICAgIGlmIChwcmV2aW91c1N0YXR1cyAhPT0gXCJxdWV1ZWRcIikgYXdhaXQgdGhpcy5fcmVjb3JkQ291bnREZWx0YShkYiwge2FsbDogMSwgcXVldWVkOiAxfSlcbiAgICAgIHJldHVybiB7am9iSWQ6IHByZXBhcmVkSm9iLmpvYklkLCBwcmV2aW91c0pvYklkLCBwcmV2aW91c1N0YXR1c31cbiAgICB9LCB7XG4gICAgICBhZHZpc29yeUxvY2s6IHtcbiAgICAgICAgZmFpbHVyZU1lc3NhZ2U6IFwiRmFpbGVkIHRvIGFjcXVpcmUgYmFja2dyb3VuZCBqb2Igc2NoZWR1bGUta2V5IGxvY2tcIixcbiAgICAgICAgbmFtZTogdGhpcy5fc2NoZWR1bGVLZXlMb2NrTmFtZShub3JtYWxpemVkU2NoZWR1bGVLZXkpXG4gICAgICB9XG4gICAgfSlcbiAgfVxuXG4gIC8qKlxuICAgKiBDYW5jZWxzIHRoZSBxdWV1ZWQgb3duZXIgb2YgYSBzdGFibGUgc2NoZWR1bGUga2V5LiBBIGhhbmRlZC1vZmYgb3duZXIgaXNcbiAgICogZGV0YWNoZWQgYnV0IG5vdCBtYXJrZWQgc3RvcHBlZCBiZWNhdXNlIGV4ZWN1dGlvbiBtYXkgYWxyZWFkeSBiZSBydW5uaW5nLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gc2NoZWR1bGVLZXkgLSBTdGFibGUgbG9naWNhbCBzY2hlZHVsZSBrZXkuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPGltcG9ydChcIi4vdHlwZXMuanNcIikuQmFja2dyb3VuZEpvYkNhbmNlbGxhdGlvblJlc3VsdD59IC0gQ2FuY2VsbGF0aW9uIHJlc3VsdC5cbiAgICovXG4gIGFzeW5jIGNhbmNlbFNjaGVkdWxlZChzY2hlZHVsZUtleSkge1xuICAgIGF3YWl0IHRoaXMuZW5zdXJlUmVhZHkoKVxuXG4gICAgY29uc3Qgbm9ybWFsaXplZFNjaGVkdWxlS2V5ID0gdGhpcy5fbm9ybWFsaXplU2NoZWR1bGVLZXkoc2NoZWR1bGVLZXkpXG5cbiAgICByZXR1cm4gYXdhaXQgdGhpcy5fc2VyaWFsaXplZENvdW50TXV0YXRpb24oYXN5bmMgKGRiKSA9PiB7XG4gICAgICBjb25zdCBvd25lclJvd3MgPSBhd2FpdCBkYlxuICAgICAgICAubmV3UXVlcnkoKVxuICAgICAgICAuZnJvbShTQ0hFRFVMRV9LRVlTX1RBQkxFKVxuICAgICAgICAud2hlcmUoe3NjaGVkdWxlX2tleTogbm9ybWFsaXplZFNjaGVkdWxlS2V5fSlcbiAgICAgICAgLmxpbWl0KDEpXG4gICAgICAgIC5yZXN1bHRzKClcblxuICAgICAgaWYgKCFvd25lclJvd3NbMF0pIHJldHVybiB7am9iSWQ6IG51bGwsIG91dGNvbWU6IFwibm90X2ZvdW5kXCJ9XG5cbiAgICAgIGNvbnN0IGpvYklkID0gU3RyaW5nKC8qKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSAqLyAob3duZXJSb3dzWzBdKS5qb2JfaWQpXG4gICAgICBjb25zdCBqb2IgPSBhd2FpdCB0aGlzLl9nZXRKb2JSb3dCeUlkKGRiLCBqb2JJZClcblxuICAgICAgaWYgKGpvYj8uc3RhdHVzID09PSBcInF1ZXVlZFwiKSB7XG4gICAgICAgIGNvbnN0IGFmZmVjdGVkUm93cyA9IGF3YWl0IHRoaXMuX3VwZGF0ZUFmZmVjdGVkUm93cyhkYiwge1xuICAgICAgICAgIHRhYmxlTmFtZTogSk9CU19UQUJMRSxcbiAgICAgICAgICBkYXRhOiB7c3RhdHVzOiBcImNhbmNlbGxlZFwifSxcbiAgICAgICAgICBjb25kaXRpb25zOiB7aWQ6IGpvYi5pZCwgc3RhdHVzOiBcInF1ZXVlZFwifVxuICAgICAgICB9KVxuXG4gICAgICAgIGlmIChhZmZlY3RlZFJvd3MgPT09IDEpIHtcbiAgICAgICAgICBhd2FpdCB0aGlzLl9yZWxlYXNlU2NoZWR1bGVPd25lcnNoaXAoZGIsIHtqb2JJZCwgc2NoZWR1bGVLZXk6IG5vcm1hbGl6ZWRTY2hlZHVsZUtleX0pXG4gICAgICAgICAgYXdhaXQgdGhpcy5fcmVjb3JkU3RhdHVzVHJhbnNpdGlvbihkYiwgXCJxdWV1ZWRcIiwgXCJjYW5jZWxsZWRcIilcblxuICAgICAgICAgIHJldHVybiB7am9iSWQsIG91dGNvbWU6IFwiY2FuY2VsbGVkXCJ9XG4gICAgICAgIH1cbiAgICAgIH1cblxuICAgICAgY29uc3QgY3VycmVudEpvYiA9IGF3YWl0IHRoaXMuX2dldEpvYlJvd0J5SWQoZGIsIGpvYklkKVxuXG4gICAgICBhd2FpdCB0aGlzLl9yZWxlYXNlU2NoZWR1bGVPd25lcnNoaXAoZGIsIHtqb2JJZCwgc2NoZWR1bGVLZXk6IG5vcm1hbGl6ZWRTY2hlZHVsZUtleX0pXG5cbiAgICAgIGlmIChjdXJyZW50Sm9iPy5zdGF0dXMgPT09IFwiaGFuZGVkX29mZlwiKSByZXR1cm4ge2pvYklkLCBvdXRjb21lOiBcImhhbmRlZF9vZmZcIn1cbiAgICAgIHJldHVybiB7am9iSWQ6IG51bGwsIG91dGNvbWU6IFwibm90X2ZvdW5kXCJ9XG4gICAgfSwge1xuICAgICAgYWR2aXNvcnlMb2NrOiB7XG4gICAgICAgIGZhaWx1cmVNZXNzYWdlOiBcIkZhaWxlZCB0byBhY3F1aXJlIGJhY2tncm91bmQgam9iIHNjaGVkdWxlLWtleSBsb2NrXCIsXG4gICAgICAgIG5hbWU6IHRoaXMuX3NjaGVkdWxlS2V5TG9ja05hbWUobm9ybWFsaXplZFNjaGVkdWxlS2V5KVxuICAgICAgfVxuICAgIH0pXG4gIH1cblxuICAvKipcbiAgICogUnVucyBuZXh0IGF2YWlsYWJsZSBqb2IuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBbYXJnc10gLSBPcHRpb25zLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vdHlwZXMuanNcIikuQmFja2dyb3VuZEpvYkV4ZWN1dGlvbk1vZGUgfCBpbXBvcnQoXCIuL3R5cGVzLmpzXCIpLkJhY2tncm91bmRKb2JFeGVjdXRpb25Nb2RlW119IFthcmdzLmV4ZWN1dGlvbk1vZGVdIC0gRXhlY3V0aW9uIG1vZGUgb3IgbW9kZXMgdG8gbWF0Y2guXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPGltcG9ydChcIi4vdHlwZXMuanNcIikuQmFja2dyb3VuZEpvYlJvdyB8IG51bGw+fSAtIE5leHQgam9iLlxuICAgKi9cbiAgYXN5bmMgbmV4dEF2YWlsYWJsZUpvYihhcmdzID0ge30pIHtcbiAgICBhd2FpdCB0aGlzLmVuc3VyZVJlYWR5KClcblxuICAgIHJldHVybiBhd2FpdCB0aGlzLl93aXRoRGIoYXN5bmMgKGRiKSA9PiB7XG4gICAgICByZXR1cm4gYXdhaXQgdGhpcy5fbmV4dFF1ZXVlZEpvYih7XG4gICAgICAgIGRiLFxuICAgICAgICBzY2hlZHVsZWRBdE9wZXJhdG9yOiBcIjw9XCIsXG4gICAgICAgIGV4ZWN1dGlvbk1vZGU6IGFyZ3MuZXhlY3V0aW9uTW9kZVxuICAgICAgfSlcbiAgICB9KVxuICB9XG5cbiAgLyoqXG4gICAqIFJldHVybnMgdGhlIHNvb25lc3QgZnV0dXJlLXNjaGVkdWxlZCBxdWV1ZWQgam9iIChvbmUgd2hvc2VcbiAgICogYHNjaGVkdWxlZF9hdF9tc2AgaXMgaW4gdGhlIGZ1dHVyZSksIG9yIG51bGwgd2hlbiB0aGVyZSBhcmUgbm9cbiAgICogZnV0dXJlLXNjaGVkdWxlZCBqb2JzLiBVc2VkIGJ5IHRoZSBldmVudC1kcml2ZW4gZGlzcGF0Y2hlciB0byBhcm0gYVxuICAgKiBgc2V0VGltZW91dGAgZm9yIHRoZSBleGFjdCBtb21lbnQgdGhlIG5leHQgc2NoZWR1bGVkIGpvYiBiZWNvbWVzXG4gICAqIGVsaWdpYmxlLCByZXBsYWNpbmcgdGhlIGxlZ2FjeSAxLXNlY29uZCBwb2xsaW5nIGxvb3AuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPGltcG9ydChcIi4vdHlwZXMuanNcIikuQmFja2dyb3VuZEpvYlJvdyB8IG51bGw+fSAtIFNvb25lc3QgZnV0dXJlLXNjaGVkdWxlZCBqb2IsIG9yIG51bGwuXG4gICAqL1xuICBhc3luYyBuZXh0U2NoZWR1bGVkSm9iKCkge1xuICAgIGF3YWl0IHRoaXMuZW5zdXJlUmVhZHkoKVxuXG4gICAgcmV0dXJuIGF3YWl0IHRoaXMuX3dpdGhEYihhc3luYyAoZGIpID0+IHtcbiAgICAgIHJldHVybiBhd2FpdCB0aGlzLl9uZXh0UXVldWVkSm9iKHtkYiwgc2NoZWR1bGVkQXRPcGVyYXRvcjogXCI+XCJ9KVxuICAgIH0pXG4gIH1cblxuICAvKipcbiAgICogUnVucyBuZXh0IHF1ZXVlZCBqb2IuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gT3B0aW9ucy5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9kYXRhYmFzZS9kcml2ZXJzL2Jhc2UuanNcIikuZGVmYXVsdH0gYXJncy5kYiAtIERhdGFiYXNlIGNvbm5lY3Rpb24uXG4gICAqIEBwYXJhbSB7XCI8PVwiIHwgXCI+XCJ9IGFyZ3Muc2NoZWR1bGVkQXRPcGVyYXRvciAtIFNjaGVkdWxlZCB0aW1lc3RhbXAgb3BlcmF0b3IuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi90eXBlcy5qc1wiKS5CYWNrZ3JvdW5kSm9iRXhlY3V0aW9uTW9kZSB8IGltcG9ydChcIi4vdHlwZXMuanNcIikuQmFja2dyb3VuZEpvYkV4ZWN1dGlvbk1vZGVbXX0gW2FyZ3MuZXhlY3V0aW9uTW9kZV0gLSBFeGVjdXRpb24gbW9kZSBvciBtb2RlcyB0byBtYXRjaC5cbiAgICogQHJldHVybnMge1Byb21pc2U8aW1wb3J0KFwiLi90eXBlcy5qc1wiKS5CYWNrZ3JvdW5kSm9iUm93IHwgbnVsbD59IC0gTmV4dCBtYXRjaGluZyBxdWV1ZWQgam9iLlxuICAgKi9cbiAgYXN5bmMgX25leHRRdWV1ZWRKb2Ioe2RiLCBzY2hlZHVsZWRBdE9wZXJhdG9yLCBleGVjdXRpb25Nb2RlfSkge1xuICAgIGNvbnN0IG5vdyA9IERhdGUubm93KClcbiAgICBsZXQgcXVlcnkgPSBkYlxuICAgICAgLm5ld1F1ZXJ5KClcbiAgICAgIC5mcm9tKEpPQlNfVEFCTEUpXG4gICAgICAud2hlcmUoe3N0YXR1czogXCJxdWV1ZWRcIn0pXG4gICAgICAud2hlcmUoYHNjaGVkdWxlZF9hdF9tcyAke3NjaGVkdWxlZEF0T3BlcmF0b3J9ICR7ZGIucXVvdGUobm93KX1gKVxuXG4gICAgaWYgKHNjaGVkdWxlZEF0T3BlcmF0b3IgPT09IFwiPD1cIikge1xuICAgICAgY29uc3Qgam9ic1RhYmxlID0gZGIucXVvdGVUYWJsZShKT0JTX1RBQkxFKVxuICAgICAgY29uc3QgY29uY3VycmVuY3lUYWJsZSA9IGRiLnF1b3RlVGFibGUoQ09OQ1VSUkVOQ1lfVEFCTEUpXG4gICAgICBxdWVyeSA9IHF1ZXJ5LndoZXJlKFxuICAgICAgICBgKCR7am9ic1RhYmxlfS4ke2RiLnF1b3RlQ29sdW1uKFwiY29uY3VycmVuY3lfa2V5XCIpfSBJUyBOVUxMIE9SIEVYSVNUUyAoYCArXG4gICAgICAgIGBTRUxFQ1QgMSBGUk9NICR7Y29uY3VycmVuY3lUYWJsZX0gV0hFUkUgYCArXG4gICAgICAgIGAke2NvbmN1cnJlbmN5VGFibGV9LiR7ZGIucXVvdGVDb2x1bW4oXCJjb25jdXJyZW5jeV9rZXlcIil9ID0gJHtqb2JzVGFibGV9LiR7ZGIucXVvdGVDb2x1bW4oXCJjb25jdXJyZW5jeV9rZXlcIil9IEFORCBgICtcbiAgICAgICAgYCR7Y29uY3VycmVuY3lUYWJsZX0uJHtkYi5xdW90ZUNvbHVtbihcImFjdGl2ZV9jb3VudFwiKX0gPCAke2NvbmN1cnJlbmN5VGFibGV9LiR7ZGIucXVvdGVDb2x1bW4oXCJtYXhfY29uY3VycmVuY3lcIil9KSlgXG4gICAgICApXG4gICAgfVxuXG4gICAgaWYgKGV4ZWN1dGlvbk1vZGUpIHF1ZXJ5ID0gdGhpcy5fd2hlcmVFeGVjdXRpb25Nb2RlKHtkYiwgZXhlY3V0aW9uTW9kZSwgcXVlcnl9KVxuXG4gICAgaWYgKHNjaGVkdWxlZEF0T3BlcmF0b3IgPT09IFwiPD1cIikge1xuICAgICAgY29uc3QgcHJpb3JpdHlPcmRlciA9IHRoaXMuX3F1ZXVlUHJpb3JpdHlPcmRlclNxbChkYilcblxuICAgICAgaWYgKHByaW9yaXR5T3JkZXIpIHF1ZXJ5ID0gcXVlcnkub3JkZXIoYCR7cHJpb3JpdHlPcmRlcn0gREVTQ2ApXG4gICAgfVxuXG4gICAgcXVlcnkgPSBxdWVyeVxuICAgICAgLm9yZGVyKFwic2NoZWR1bGVkX2F0X21zIEFTQ1wiKVxuICAgICAgLm9yZGVyKFwiY3JlYXRlZF9hdF9tcyBBU0NcIilcbiAgICAgIC5saW1pdCgxKVxuXG4gICAgY29uc3Qgcm93cyA9IGF3YWl0IHF1ZXJ5LnJlc3VsdHMoKVxuICAgIGNvbnN0IHJvdyA9IHJvd3NbMF1cblxuICAgIGlmICghcm93KSByZXR1cm4gbnVsbFxuXG4gICAgcmV0dXJuIHRoaXMuX25vcm1hbGl6ZUpvYlJvdyhyb3cpXG4gIH1cblxuICAvKipcbiAgICogQnVpbGRzIGEgcmF3IFNRTCBPUkRFUiBCWSBleHByZXNzaW9uIHJhbmtpbmcgcXVldWVkIGpvYnMgYnkgdGhlaXIgcXVldWUnc1xuICAgKiBjb25maWd1cmVkIHByaW9yaXR5IChgYmFja2dyb3VuZEpvYnMucXVldWVzW3F1ZXVlXS5wcmlvcml0eWAsIGRlZmF1bHQgYDBgKSxcbiAgICogc28gdGhlIGRpc3BhdGNoZXIgcGlja3MgaGlnaGVyLXByaW9yaXR5IHF1ZXVlcyBmaXJzdCByZWdhcmRsZXNzIG9mIGVucXVldWVcbiAgICogb3JkZXIuIE9ubHkgYXBwbGllZCB0byB0aGUgZGlzcGF0Y2ggcGF0aCAoYHNjaGVkdWxlZEF0T3BlcmF0b3IgPT09IFwiPD1cImApO1xuICAgKiB0aGUgZnV0dXJlLXNjaGVkdWxlZCBsb29rdXAgbXVzdCBzdGF5IHN0cmljdGx5IHRpbWUtb3JkZXJlZC4gQ29tcG9zZXMgd2l0aFxuICAgKiB0aGUgY29uY3VycmVuY3kgRVhJU1RTIGZpbHRlcjogYSBoaWdoZXItcHJpb3JpdHkgcXVldWUgYWxyZWFkeSBhdCBpdHMgY2FwIGlzXG4gICAqIGZpbHRlcmVkIG91dCwgc28gZGlzcGF0Y2ggZmFsbHMgdGhyb3VnaCB0byB0aGUgbmV4dCBlbGlnaWJsZSBsb3dlci1wcmlvcml0eVxuICAgKiBqb2IuIFJldHVybnMgbnVsbCB3aGVuIG5vIHF1ZXVlIGNvbmZpZ3VyZXMgYSBub24temVybyBwcmlvcml0eSBzbyB0aGUgcGxhaW5cbiAgICogRklGTyBvcmRlcmluZyBpcyBsZWZ0IHVudG91Y2hlZCAoYW5kIG5vIG5lZWRsZXNzIGZpbGVzb3J0IGlzIGludHJvZHVjZWQpLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL2RhdGFiYXNlL2RyaXZlcnMvYmFzZS5qc1wiKS5kZWZhdWx0fSBkYiAtIERhdGFiYXNlIGNvbm5lY3Rpb24uXG4gICAqIEByZXR1cm5zIHtzdHJpbmcgfCBudWxsfSAtIFJhdyBTUUwgQ0FTRSBleHByZXNzaW9uLCBvciBudWxsIHdoZW4gbm8gcXVldWUgaXMgcHJpb3JpdGl6ZWQuXG4gICAqL1xuICBfcXVldWVQcmlvcml0eU9yZGVyU3FsKGRiKSB7XG4gICAgY29uc3QgcXVldWVzID0gdGhpcy5jb25maWd1cmF0aW9uLmdldEJhY2tncm91bmRKb2JzQ29uZmlnKCkucXVldWVzIHx8IHt9XG4gICAgLyoqIEB0eXBlIHtBcnJheTxbc3RyaW5nLCBudW1iZXJdPn0gKi9cbiAgICBjb25zdCBwcmlvcml0aXplZCA9IFtdXG5cbiAgICBmb3IgKGNvbnN0IFtxdWV1ZSwgcXVldWVDb25maWddIG9mIE9iamVjdC5lbnRyaWVzKHF1ZXVlcykpIHtcbiAgICAgIGNvbnN0IHByaW9yaXR5ID0gcXVldWVDb25maWc/LnByaW9yaXR5XG5cbiAgICAgIGlmIChOdW1iZXIuaXNGaW5pdGUocHJpb3JpdHkpICYmIE51bWJlcihwcmlvcml0eSkgIT09IDApIHByaW9yaXRpemVkLnB1c2goW3F1ZXVlLCBOdW1iZXIocHJpb3JpdHkpXSlcbiAgICB9XG5cbiAgICBpZiAocHJpb3JpdGl6ZWQubGVuZ3RoID09PSAwKSByZXR1cm4gbnVsbFxuXG4gICAgY29uc3QgcXVldWVDb2x1bW4gPSBkYi5xdW90ZUNvbHVtbihcInF1ZXVlXCIpXG4gICAgY29uc3Qgd2hlbnMgPSBwcmlvcml0aXplZFxuICAgICAgLm1hcCgoW3F1ZXVlLCBwcmlvcml0eV0pID0+IGBXSEVOICR7ZGIucXVvdGUocXVldWUpfSBUSEVOICR7cHJpb3JpdHl9YClcbiAgICAgIC5qb2luKFwiIFwiKVxuXG4gICAgcmV0dXJuIGBDQVNFIENPQUxFU0NFKCR7cXVldWVDb2x1bW59LCAke2RiLnF1b3RlKERFRkFVTFRfQkFDS0dST1VORF9KT0JfUVVFVUUpfSkgJHt3aGVuc30gRUxTRSAwIEVORGBcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGdldCBqb2IuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBqb2JJZCAtIEpvYiBpZC5cbiAgICogQHJldHVybnMge1Byb21pc2U8aW1wb3J0KFwiLi90eXBlcy5qc1wiKS5CYWNrZ3JvdW5kSm9iUm93IHwgbnVsbD59IC0gSm9iIHJvdy5cbiAgICovXG4gIGFzeW5jIGdldEpvYihqb2JJZCkge1xuICAgIGF3YWl0IHRoaXMuZW5zdXJlUmVhZHkoKVxuXG4gICAgcmV0dXJuIGF3YWl0IHRoaXMuX3dpdGhEYihhc3luYyAoZGIpID0+IHtcbiAgICAgIGNvbnN0IHF1ZXJ5ID0gZGJcbiAgICAgICAgLm5ld1F1ZXJ5KClcbiAgICAgICAgLmZyb20oSk9CU19UQUJMRSlcbiAgICAgICAgLndoZXJlKHtpZDogam9iSWR9KVxuICAgICAgICAubGltaXQoMSlcblxuICAgICAgY29uc3Qgcm93cyA9IGF3YWl0IHF1ZXJ5LnJlc3VsdHMoKVxuICAgICAgY29uc3Qgcm93ID0gcm93c1swXVxuXG4gICAgICBpZiAoIXJvdykgcmV0dXJuIG51bGxcblxuICAgICAgcmV0dXJuIHRoaXMuX25vcm1hbGl6ZUpvYlJvdyhyb3cpXG4gICAgfSlcbiAgfVxuXG4gIC8qKlxuICAgKiBDb3VudHMgam9icyBncm91cGVkIGJ5IHN0YXR1cy4gVXNlZCBieSB0aGUgZGFzaGJvYXJkIG92ZXJ2aWV3LlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxSZWNvcmQ8c3RyaW5nLCBudW1iZXI+Pn0gLSBDb3VudHMga2V5ZWQgYnkgc3RhdHVzLlxuICAgKi9cbiAgYXN5bmMgY291bnRzQnlTdGF0dXMoKSB7XG4gICAgYXdhaXQgdGhpcy5lbnN1cmVSZWFkeSgpXG5cbiAgICByZXR1cm4gYXdhaXQgdGhpcy5fd2l0aERiKGFzeW5jIChkYikgPT4ge1xuICAgICAgY29uc3Qgcm93cyA9IGF3YWl0IGRiXG4gICAgICAgIC5uZXdRdWVyeSgpXG4gICAgICAgIC5mcm9tKEpPQlNfVEFCTEUpXG4gICAgICAgIC5zZWxlY3QoXCJzdGF0dXNcIilcbiAgICAgICAgLnNlbGVjdChcIkNPVU5UKCopIEFTIGNvdW50XCIpXG4gICAgICAgIC5ncm91cChcInN0YXR1c1wiKVxuICAgICAgICAucmVzdWx0cygpXG5cbiAgICAgIC8qKlxuICAgICAgICogQ291bnRzLlxuICAgICAgICogQHR5cGUge1JlY29yZDxzdHJpbmcsIG51bWJlcj59ICovXG4gICAgICBjb25zdCBjb3VudHMgPSB7fVxuXG4gICAgICBmb3IgKGNvbnN0IHJvdyBvZiByb3dzKSB7XG4gICAgICAgIGNvbnN0IHR5cGVkUm93ID0gLyoqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59ICovIChyb3cpXG5cbiAgICAgICAgY291bnRzW1N0cmluZyh0eXBlZFJvdy5zdGF0dXMpXSA9IHRoaXMuX25vcm1hbGl6ZU51bWJlcih0eXBlZFJvdy5jb3VudCkgfHwgMFxuICAgICAgfVxuXG4gICAgICByZXR1cm4gY291bnRzXG4gICAgfSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSZXR1cm5zIHRoZSBhdXRob3JpdGF0aXZlIGRhc2hib2FyZCBjb3VudCBzbmFwc2hvdCBhbmQgaXRzIG1hdGNoaW5nIGR1cmFibGVcbiAgICogcmV2aXNpb24uIExvY2tpbmcgdGhlIHJldmlzaW9uIHJvdyBiZWZvcmUgY291bnRpbmcgcHJldmVudHMgYSB3cml0ZXIgZnJvbVxuICAgKiBjb21taXR0aW5nIGJldHdlZW4gdGhlIGNvdW50IHF1ZXJ5IGFuZCByZXZpc2lvbiByZWFkLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx7Y291bnRzOiBSZWNvcmQ8c3RyaW5nLCBudW1iZXI+LCByZXZpc2lvbjogbnVtYmVyLCB0b3RhbDogbnVtYmVyfT59IFNuYXBzaG90LlxuICAgKi9cbiAgYXN5bmMgY291bnRTbmFwc2hvdCgpIHtcbiAgICBhd2FpdCB0aGlzLmVuc3VyZVJlYWR5KClcblxuICAgIHJldHVybiBhd2FpdCB0aGlzLl9zZXJpYWxpemVkQ291bnRNdXRhdGlvbihhc3luYyAoZGIpID0+IHtcbiAgICAgIHJldHVybiBhd2FpdCB0aGlzLl9jb3VudFNuYXBzaG90T25Mb2NrZWRDb25uZWN0aW9uKGRiKVxuICAgIH0pXG4gIH1cblxuICAvKipcbiAgICogQ291bnRzIGpvYnMgbWF0Y2hpbmcgdGhlIGdpdmVuIGZpbHRlcnMuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBbYXJnc10gLSBPcHRpb25zLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gW2FyZ3Muc3RhdHVzXSAtIEZpbHRlciBieSBzdGF0dXMuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBbYXJncy5qb2JOYW1lXSAtIEZpbHRlciBieSBqb2IgbmFtZS5cbiAgICogQHJldHVybnMge1Byb21pc2U8bnVtYmVyPn0gLSBNYXRjaGluZyBqb2IgY291bnQuXG4gICAqL1xuICBhc3luYyBjb3VudEpvYnMoe3N0YXR1cywgam9iTmFtZX0gPSB7fSkge1xuICAgIGF3YWl0IHRoaXMuZW5zdXJlUmVhZHkoKVxuXG4gICAgcmV0dXJuIGF3YWl0IHRoaXMuX3dpdGhEYihhc3luYyAoZGIpID0+IHtcbiAgICAgIGxldCBxdWVyeSA9IGRiLm5ld1F1ZXJ5KCkuZnJvbShKT0JTX1RBQkxFKS5zZWxlY3QoXCJDT1VOVCgqKSBBUyBjb3VudFwiKVxuXG4gICAgICBpZiAoc3RhdHVzKSBxdWVyeSA9IHF1ZXJ5LndoZXJlKHtzdGF0dXN9KVxuICAgICAgaWYgKGpvYk5hbWUpIHF1ZXJ5ID0gcXVlcnkud2hlcmUoe2pvYl9uYW1lOiBqb2JOYW1lfSlcblxuICAgICAgY29uc3Qgcm93cyA9IGF3YWl0IHF1ZXJ5LnJlc3VsdHMoKVxuICAgICAgY29uc3QgY291bnRSb3cgPSAvKiogQHR5cGUge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gKi8gKHJvd3NbMF0gfHwge30pXG5cbiAgICAgIHJldHVybiB0aGlzLl9ub3JtYWxpemVOdW1iZXIoY291bnRSb3cuY291bnQpIHx8IDBcbiAgICB9KVxuICB9XG5cbiAgLyoqXG4gICAqIExpc3RzIGpvYnMgZm9yIHRoZSBkYXNoYm9hcmQsIGZpbHRlcmVkLCBzb3J0ZWQgYW5kIHBhZ2luYXRlZC5cbiAgICogQHBhcmFtIHtvYmplY3R9IFthcmdzXSAtIE9wdGlvbnMuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBbYXJncy5zdGF0dXNdIC0gRmlsdGVyIGJ5IHN0YXR1cy5cbiAgICogQHBhcmFtIHtzdHJpbmd9IFthcmdzLmpvYk5hbWVdIC0gRmlsdGVyIGJ5IGpvYiBuYW1lLlxuICAgKiBAcGFyYW0ge251bWJlcn0gW2FyZ3MubGltaXRdIC0gTWF4aW11bSByb3dzIHRvIHJldHVybi5cbiAgICogQHBhcmFtIHtudW1iZXJ9IFthcmdzLm9mZnNldF0gLSBSb3dzIHRvIHNraXAuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBbYXJncy5zb3J0Q29sdW1uXSAtIENhbWVsLWNhc2VkIGNvbHVtbiB0byBzb3J0IGJ5IChzZWUgU09SVEFCTEVfQ09MVU1OUykuXG4gICAqIEBwYXJhbSB7XCJBU0NcIiB8IFwiREVTQ1wifSBbYXJncy5zb3J0RGlyZWN0aW9uXSAtIFNvcnQgZGlyZWN0aW9uLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxpbXBvcnQoXCIuL3R5cGVzLmpzXCIpLkJhY2tncm91bmRKb2JSb3dbXT59IC0gTm9ybWFsaXplZCBqb2Igcm93cy5cbiAgICovXG4gIGFzeW5jIGxpc3RKb2JzKHtzdGF0dXMsIGpvYk5hbWUsIGxpbWl0ID0gMjUsIG9mZnNldCA9IDAsIHNvcnRDb2x1bW4gPSBcImNyZWF0ZWRBdE1zXCIsIHNvcnREaXJlY3Rpb24gPSBcIkRFU0NcIn0gPSB7fSkge1xuICAgIGF3YWl0IHRoaXMuZW5zdXJlUmVhZHkoKVxuXG4gICAgY29uc3QgY29sdW1uID0gU09SVEFCTEVfQ09MVU1OU1tzb3J0Q29sdW1uXSB8fCBTT1JUQUJMRV9DT0xVTU5TLmNyZWF0ZWRBdE1zXG4gICAgY29uc3QgZGlyZWN0aW9uID0gc29ydERpcmVjdGlvbiA9PT0gXCJBU0NcIiA/IFwiQVNDXCIgOiBcIkRFU0NcIlxuXG4gICAgcmV0dXJuIGF3YWl0IHRoaXMuX3dpdGhEYihhc3luYyAoZGIpID0+IHtcbiAgICAgIGxldCBxdWVyeSA9IGRiLm5ld1F1ZXJ5KCkuZnJvbShKT0JTX1RBQkxFKVxuXG4gICAgICBpZiAoc3RhdHVzKSBxdWVyeSA9IHF1ZXJ5LndoZXJlKHtzdGF0dXN9KVxuICAgICAgaWYgKGpvYk5hbWUpIHF1ZXJ5ID0gcXVlcnkud2hlcmUoe2pvYl9uYW1lOiBqb2JOYW1lfSlcblxuICAgICAgcXVlcnkgPSBxdWVyeS5vcmRlcih7Y29sdW1uLCBkaXJlY3Rpb259KVxuICAgICAgaWYgKGNvbHVtbiAhPT0gU09SVEFCTEVfQ09MVU1OUy5jcmVhdGVkQXRNcykgcXVlcnkgPSBxdWVyeS5vcmRlcih7Y29sdW1uOiBTT1JUQUJMRV9DT0xVTU5TLmNyZWF0ZWRBdE1zLCBkaXJlY3Rpb246IFwiREVTQ1wifSlcblxuICAgICAgY29uc3Qgcm93cyA9IGF3YWl0IHF1ZXJ5LmxpbWl0KGxpbWl0KS5vZmZzZXQob2Zmc2V0KS5yZXN1bHRzKClcblxuICAgICAgcmV0dXJuIHJvd3MubWFwKChyb3cpID0+IHRoaXMuX25vcm1hbGl6ZUpvYlJvdyhyb3cpKVxuICAgIH0pXG4gIH1cblxuICAvKipcbiAgICogUnVucyBtYXJrIGhhbmRlZCBvZmYuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gT3B0aW9ucy5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGFyZ3Muam9iSWQgLSBKb2IgaWQuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBbYXJncy5oYW5kb2ZmSWRdIC0gQ2FsbGVyLXNlbGVjdGVkIGV4YWN0IGxlYXNlIGlkLiBHZW5lcmF0ZWQgZm9yIGxlZ2FjeSBkaXJlY3QgY2FsbGVycyB3aGVuIG9taXR0ZWQuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBbYXJncy53b3JrZXJJZF0gLSBXb3JrZXIgaWQuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPGltcG9ydChcIi4vdHlwZXMuanNcIikuQmFja2dyb3VuZEpvYkhhbmRvZmYgfCBudWxsPn0gLSBDbGFpbWVkIGhhbmRvZmYgbGVhc2UsIG9yIG51bGwgd2hlbiBubyBsb25nZXIgcXVldWVkLlxuICAgKi9cbiAgYXN5bmMgbWFya0hhbmRlZE9mZih7am9iSWQsIGhhbmRvZmZJZCA9IHJhbmRvbVVVSUQoKSwgd29ya2VySWR9KSB7XG4gICAgYXdhaXQgdGhpcy5lbnN1cmVSZWFkeSgpXG5cbiAgICBjb25zdCBoYW5kZWRPZmZBdE1zID0gRGF0ZS5ub3coKVxuXG4gICAgcmV0dXJuIGF3YWl0IHRoaXMuX3NlcmlhbGl6ZWRDb3VudE11dGF0aW9uKGFzeW5jIChkYikgPT4ge1xuICAgICAgY29uc3QgcXVldWVkSm9iID0gYXdhaXQgdGhpcy5fZ2V0Sm9iUm93QnlJZChkYiwgam9iSWQpXG4gICAgICBpZiAoIXF1ZXVlZEpvYiB8fCBxdWV1ZWRKb2Iuc3RhdHVzICE9PSBcInF1ZXVlZFwiKSByZXR1cm4gbnVsbFxuICAgICAgaWYgKHF1ZXVlZEpvYi5jb25jdXJyZW5jeUtleSAmJiAhKGF3YWl0IHRoaXMuX3Jlc2VydmVDb25jdXJyZW5jeShkYiwgcXVldWVkSm9iLmNvbmN1cnJlbmN5S2V5KSkpIHJldHVybiBudWxsXG4gICAgICBjb25zdCBhZmZlY3RlZFJvd3MgPSBhd2FpdCB0aGlzLl91cGRhdGVBZmZlY3RlZFJvd3MoZGIsIHtcbiAgICAgICAgdGFibGVOYW1lOiBKT0JTX1RBQkxFLFxuICAgICAgICBkYXRhOiB7XG4gICAgICAgICAgc3RhdHVzOiBcImhhbmRlZF9vZmZcIixcbiAgICAgICAgICBoYW5kZWRfb2ZmX2F0X21zOiBoYW5kZWRPZmZBdE1zLFxuICAgICAgICAgIGhhbmRvZmZfaWQ6IGhhbmRvZmZJZCxcbiAgICAgICAgICB3b3JrZXJfaWQ6IHdvcmtlcklkIHx8IG51bGxcbiAgICAgICAgfSxcbiAgICAgICAgY29uZGl0aW9uczoge2lkOiBqb2JJZCwgc3RhdHVzOiBcInF1ZXVlZFwifVxuICAgICAgfSlcblxuICAgICAgaWYgKGFmZmVjdGVkUm93cyAhPT0gMSkge1xuICAgICAgICBhd2FpdCB0aGlzLl9yZWxlYXNlQ29uY3VycmVuY3koZGIsIHF1ZXVlZEpvYi5jb25jdXJyZW5jeUtleSlcbiAgICAgICAgcmV0dXJuIG51bGxcbiAgICAgIH1cblxuICAgICAgYXdhaXQgdGhpcy5fcmVjb3JkU3RhdHVzVHJhbnNpdGlvbihkYiwgXCJxdWV1ZWRcIiwgXCJoYW5kZWRfb2ZmXCIpXG4gICAgICByZXR1cm4ge2hhbmRlZE9mZkF0TXMsIGhhbmRvZmZJZH1cbiAgICB9KVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgbWFyayBjb21wbGV0ZWQuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gT3B0aW9ucy5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGFyZ3Muam9iSWQgLSBKb2IgaWQuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBbYXJncy5oYW5kb2ZmSWRdIC0gSGFuZG9mZiBsZWFzZSBpZC5cbiAgICogQHBhcmFtIHtzdHJpbmd9IFthcmdzLndvcmtlcklkXSAtIFdvcmtlciBpZC5cbiAgICogQHBhcmFtIHtudW1iZXJ9IFthcmdzLmhhbmRlZE9mZkF0TXNdIC0gSGFuZGVkIG9mZiB0aW1lc3RhbXAuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPGJvb2xlYW4+fSAtIFdoZXRoZXIgdGhlIGZlbmNlZCByZXBvcnQgd2FzIGFjY2VwdGVkLlxuICAgKi9cbiAgYXN5bmMgbWFya0NvbXBsZXRlZCh7am9iSWQsIGhhbmRvZmZJZCwgd29ya2VySWQsIGhhbmRlZE9mZkF0TXN9KSB7XG4gICAgYXdhaXQgdGhpcy5lbnN1cmVSZWFkeSgpXG5cbiAgICByZXR1cm4gYXdhaXQgdGhpcy5fc2VyaWFsaXplZENvdW50TXV0YXRpb24oYXN5bmMgKGRiKSA9PiB7XG4gICAgICBjb25zdCBqb2IgPSBhd2FpdCB0aGlzLl9nZXRKb2JSb3dCeUlkKGRiLCBqb2JJZClcblxuICAgICAgaWYgKCFqb2IpIHJldHVybiBmYWxzZVxuICAgICAgaWYgKCF0aGlzLl9zaG91bGRBY2NlcHRSZXBvcnQoe2pvYiwgaGFuZG9mZklkLCB3b3JrZXJJZCwgaGFuZGVkT2ZmQXRNc30pKSByZXR1cm4gZmFsc2VcblxuICAgICAgYXdhaXQgdGhpcy5fbG9ja0NvbmN1cnJlbmN5Um93KGRiLCBqb2IuY29uY3VycmVuY3lLZXkpXG4gICAgICBjb25zdCBhZmZlY3RlZFJvd3MgPSBhd2FpdCB0aGlzLl91cGRhdGVBZmZlY3RlZFJvd3MoZGIsIHtcbiAgICAgICAgdGFibGVOYW1lOiBKT0JTX1RBQkxFLFxuICAgICAgICBkYXRhOiB7XG4gICAgICAgICAgc3RhdHVzOiBcImNvbXBsZXRlZFwiLFxuICAgICAgICAgIGNvbXBsZXRlZF9hdF9tczogRGF0ZS5ub3coKVxuICAgICAgICB9LFxuICAgICAgICBjb25kaXRpb25zOiB0aGlzLl9hY3RpdmVIYW5kb2ZmQ29uZGl0aW9ucyhqb2IpXG4gICAgICB9KVxuXG4gICAgICBpZiAoYWZmZWN0ZWRSb3dzICE9PSAxKSByZXR1cm4gZmFsc2VcbiAgICAgIGF3YWl0IHRoaXMuX3JlbGVhc2VTY2hlZHVsZU93bmVyc2hpcEZvckpvYihkYiwgam9iKVxuICAgICAgYXdhaXQgdGhpcy5fcmVsZWFzZUNvbmN1cnJlbmN5KGRiLCBqb2IuY29uY3VycmVuY3lLZXkpXG4gICAgICBhd2FpdCB0aGlzLl9yZWNvcmRTdGF0dXNUcmFuc2l0aW9uKGRiLCBcImhhbmRlZF9vZmZcIiwgXCJjb21wbGV0ZWRcIilcbiAgICAgIHJldHVybiB0cnVlXG4gICAgfSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSZXR1cm5zIGFuIGFjdGl2ZSBoYW5kb2ZmIHRvIHRoZSBxdWV1ZSBhdCBhIGNhbGxlci1yZXF1ZXN0ZWQgZnV0dXJlIHRpbWUuXG4gICAqIFRoaXMgaXMgbm9ybWFsIGpvYiBjb250cm9sIGZsb3c6IGl0IHByZXNlcnZlcyBmYWlsdXJlIGF0dGVtcHRzIGFuZCBtZXRhZGF0YS5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBPcHRpb25zLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gYXJncy5qb2JJZCAtIEpvYiBpZC5cbiAgICogQHBhcmFtIHtudW1iZXJ9IGFyZ3MuZGVsYXlNcyAtIERlbGF5IGZyb20gcGVyc2lzdGVuY2UgdGltZSBpbiBtaWxsaXNlY29uZHMuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBbYXJncy5oYW5kb2ZmSWRdIC0gSGFuZG9mZiBsZWFzZSBpZC5cbiAgICogQHBhcmFtIHtzdHJpbmd9IFthcmdzLndvcmtlcklkXSAtIFdvcmtlciBpZC5cbiAgICogQHBhcmFtIHtudW1iZXJ9IFthcmdzLmhhbmRlZE9mZkF0TXNdIC0gSGFuZGVkIG9mZiB0aW1lc3RhbXAuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPGJvb2xlYW4+fSAtIFdoZXRoZXIgdGhlIGZlbmNlZCByZXBvcnQgd2FzIGFjY2VwdGVkLlxuICAgKi9cbiAgYXN5bmMgbWFya1Jlc2NoZWR1bGVkKHtqb2JJZCwgZGVsYXlNcywgaGFuZG9mZklkLCB3b3JrZXJJZCwgaGFuZGVkT2ZmQXRNc30pIHtcbiAgICBhd2FpdCB0aGlzLmVuc3VyZVJlYWR5KClcbiAgICB0aGlzLl92YWxpZGF0ZVJlc2NoZWR1bGVEZWxheU1zKGRlbGF5TXMpXG5cbiAgICByZXR1cm4gYXdhaXQgdGhpcy5fc2VyaWFsaXplZENvdW50TXV0YXRpb24oYXN5bmMgKGRiKSA9PiB7XG4gICAgICBjb25zdCBqb2IgPSBhd2FpdCB0aGlzLl9nZXRKb2JSb3dCeUlkKGRiLCBqb2JJZClcblxuICAgICAgaWYgKCFqb2IpIHJldHVybiBmYWxzZVxuICAgICAgaWYgKCF0aGlzLl9zaG91bGRBY2NlcHRSZXBvcnQoe2pvYiwgaGFuZG9mZklkLCB3b3JrZXJJZCwgaGFuZGVkT2ZmQXRNc30pKSByZXR1cm4gZmFsc2VcblxuICAgICAgYXdhaXQgdGhpcy5fbG9ja0NvbmN1cnJlbmN5Um93KGRiLCBqb2IuY29uY3VycmVuY3lLZXkpXG4gICAgICBjb25zdCBzY2hlZHVsZWRBdE1zID0gdGhpcy5fcmVzY2hlZHVsZWRBdE1zKGRlbGF5TXMpXG4gICAgICBjb25zdCBhZmZlY3RlZFJvd3MgPSBhd2FpdCB0aGlzLl91cGRhdGVBZmZlY3RlZFJvd3MoZGIsIHtcbiAgICAgICAgdGFibGVOYW1lOiBKT0JTX1RBQkxFLFxuICAgICAgICBkYXRhOiB7XG4gICAgICAgICAgc3RhdHVzOiBcInF1ZXVlZFwiLFxuICAgICAgICAgIHNjaGVkdWxlZF9hdF9tczogc2NoZWR1bGVkQXRNcyxcbiAgICAgICAgICBoYW5kZWRfb2ZmX2F0X21zOiBudWxsLFxuICAgICAgICAgIGhhbmRvZmZfaWQ6IG51bGwsXG4gICAgICAgICAgd29ya2VyX2lkOiBudWxsXG4gICAgICAgIH0sXG4gICAgICAgIGNvbmRpdGlvbnM6IHRoaXMuX2FjdGl2ZUhhbmRvZmZDb25kaXRpb25zKGpvYilcbiAgICAgIH0pXG5cbiAgICAgIGlmIChhZmZlY3RlZFJvd3MgIT09IDEpIHJldHVybiBmYWxzZVxuICAgICAgYXdhaXQgdGhpcy5fcmVsZWFzZUNvbmN1cnJlbmN5KGRiLCBqb2IuY29uY3VycmVuY3lLZXkpXG4gICAgICBhd2FpdCB0aGlzLl9yZWNvcmRTdGF0dXNUcmFuc2l0aW9uKGRiLCBcImhhbmRlZF9vZmZcIiwgXCJxdWV1ZWRcIilcbiAgICAgIHJldHVybiB0cnVlXG4gICAgfSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIG1hcmsgcmV0dXJuZWQgdG8gcXVldWUuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gT3B0aW9ucy5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGFyZ3Muam9iSWQgLSBKb2IgaWQuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBhcmdzLmhhbmRvZmZJZCAtIEhhbmRvZmYgbGVhc2UgaWQuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIHdoZW4gdXBkYXRlZC5cbiAgICovXG4gIGFzeW5jIG1hcmtSZXR1cm5lZFRvUXVldWUoe2pvYklkLCBoYW5kb2ZmSWR9KSB7XG4gICAgYXdhaXQgdGhpcy5lbnN1cmVSZWFkeSgpXG5cbiAgICBhd2FpdCB0aGlzLl9zZXJpYWxpemVkQ291bnRNdXRhdGlvbihhc3luYyAoZGIpID0+IHtcbiAgICAgIGNvbnN0IGpvYiA9IGF3YWl0IHRoaXMuX2dldEpvYlJvd0J5SWQoZGIsIGpvYklkKVxuICAgICAgaWYgKCFqb2IgfHwgam9iLmhhbmRvZmZJZCAhPT0gaGFuZG9mZklkIHx8IGpvYi5zdGF0dXMgIT09IFwiaGFuZGVkX29mZlwiKSByZXR1cm5cbiAgICAgIGF3YWl0IHRoaXMuX2xvY2tDb25jdXJyZW5jeVJvdyhkYiwgam9iLmNvbmN1cnJlbmN5S2V5KVxuICAgICAgY29uc3QgYWZmZWN0ZWRSb3dzID0gYXdhaXQgdGhpcy5fdXBkYXRlQWZmZWN0ZWRSb3dzKGRiLCB7XG4gICAgICAgIHRhYmxlTmFtZTogSk9CU19UQUJMRSxcbiAgICAgICAgZGF0YToge1xuICAgICAgICAgIHN0YXR1czogXCJxdWV1ZWRcIixcbiAgICAgICAgICBzY2hlZHVsZWRfYXRfbXM6IERhdGUubm93KCksXG4gICAgICAgICAgaGFuZGVkX29mZl9hdF9tczogbnVsbCxcbiAgICAgICAgICBoYW5kb2ZmX2lkOiBudWxsLFxuICAgICAgICAgIHdvcmtlcl9pZDogbnVsbFxuICAgICAgICB9LFxuICAgICAgICBjb25kaXRpb25zOiB7aGFuZG9mZl9pZDogaGFuZG9mZklkLCBpZDogam9iSWQsIHN0YXR1czogXCJoYW5kZWRfb2ZmXCJ9XG4gICAgICB9KVxuICAgICAgaWYgKGFmZmVjdGVkUm93cyA9PT0gMSkge1xuICAgICAgICBhd2FpdCB0aGlzLl9yZWxlYXNlQ29uY3VycmVuY3koZGIsIGpvYi5jb25jdXJyZW5jeUtleSlcbiAgICAgICAgYXdhaXQgdGhpcy5fcmVjb3JkU3RhdHVzVHJhbnNpdGlvbihkYiwgXCJoYW5kZWRfb2ZmXCIsIFwicXVldWVkXCIpXG4gICAgICB9XG4gICAgfSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSZXR1cm5zIHRoZSBhY3RpdmUgYGhhbmRlZF9vZmZgIGpvYnMgKGpvYklkICsgaGFuZG9mZklkKSBoZWxkIHVuZGVyIGEgd29ya2VyXG4gICAqIGlkLiBVc2VkIG9uIHdvcmtlciByZWNvbm5lY3Q6IGFmdGVyIGEgbWFpbiByZXN0YXJ0IGEgd29ya2VyIHJlY29ubmVjdHMgd2l0aFxuICAgKiBpdHMgc3RhYmxlIGlkLCBhbmQgdGhlIGZyZXNoIG1haW4gYWRvcHRzIHRoZXNlIGxlYXNlcyBzbyB0aGV5IGFyZSB0cmFja2VkIOKAlFxuICAgKiBhbmQgcmVsZWFzZWQgaWYgdGhlIHJlY29ubmVjdGVkIHdvcmtlciBsYXRlciBkaXNjb25uZWN0cyDigJQgaW5zdGVhZCBvZlxuICAgKiBzaXR0aW5nIHN0dWNrIHVudGlsIHRoZSBhZ2UtYmFzZWQgb3JwaGFuIHN3ZWVwLiBUaGlzIG5ldmVyIHJlY2xhaW1zLCBzbyBhXG4gICAqIGdyYWNlZnVsbHktZHJhaW5pbmcgd29ya2VyIHRoYXQga2VlcHMgcnVubmluZyBpdHMgaW4tZmxpZ2h0IGpvYnMgaXMgbGVmdFxuICAgKiB1bnRvdWNoZWQuIFJvd3Mgd2l0aCBhIG51bGwgaGFuZG9mZiBpZCAobGVnYWN5KSBhcmUgc2tpcHBlZDsgdGhlIG9ycGhhblxuICAgKiBzd2VlcCByZWNsYWltcyB0aG9zZSB2aWEgaXRzIGBoYW5kZWRfb2ZmX2F0X21zYCBmZW5jZS5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBPcHRpb25zLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gYXJncy53b3JrZXJJZCAtIFdvcmtlciBpZC5cbiAgICogQHJldHVybnMge1Byb21pc2U8QXJyYXk8e2pvYklkOiBzdHJpbmcsIGhhbmRvZmZJZDogc3RyaW5nfT4+fSAtIEFjdGl2ZSBoYW5kb2Zmcy5cbiAgICovXG4gIGFzeW5jIGhhbmRlZE9mZkpvYnNGb3JXb3JrZXIoe3dvcmtlcklkfSkge1xuICAgIGF3YWl0IHRoaXMuZW5zdXJlUmVhZHkoKVxuXG4gICAgY29uc3Qgcm93cyA9IGF3YWl0IHRoaXMuX3dpdGhEYihhc3luYyAoZGIpID0+XG4gICAgICBhd2FpdCBkYi5uZXdRdWVyeSgpLmZyb20oSk9CU19UQUJMRSkud2hlcmUoe3N0YXR1czogXCJoYW5kZWRfb2ZmXCIsIHdvcmtlcl9pZDogd29ya2VySWR9KS5yZXN1bHRzKClcbiAgICApXG5cbiAgICAvKiogQHR5cGUge0FycmF5PHtqb2JJZDogc3RyaW5nLCBoYW5kb2ZmSWQ6IHN0cmluZ30+fSAqL1xuICAgIGNvbnN0IGhhbmRvZmZzID0gW11cblxuICAgIGZvciAoY29uc3Qgcm93IG9mIHJvd3MpIHtcbiAgICAgIGNvbnN0IGpvYiA9IHRoaXMuX25vcm1hbGl6ZUpvYlJvdyhyb3cpXG5cbiAgICAgIGlmIChqb2IuaGFuZG9mZklkKSBoYW5kb2Zmcy5wdXNoKHtqb2JJZDogam9iLmlkLCBoYW5kb2ZmSWQ6IGpvYi5oYW5kb2ZmSWR9KVxuICAgIH1cblxuICAgIHJldHVybiBoYW5kb2Zmc1xuICB9XG5cbiAgLyoqXG4gICAqIFNuYXBzaG90cyBleGFjdCwgbGVhc2UtYXdhcmUgYWN0aXZlIGhhbmRvZmZzIGJlZm9yZSBhIG5ldyBtYWluIGdlbmVyYXRpb25cbiAgICogc3RhcnRzIGFjY2VwdGluZyB3b3JrZXIgcmVjb25uZWN0cy4gTGVnYWN5IHJvd3Mgd2l0aG91dCBhIGNvbXBsZXRlIHdvcmtlcixcbiAgICogbGVhc2UsIGFuZCB0aW1lc3RhbXAgaWRlbnRpdHkgc3RheSBvd25lZCBieSB0aGUgYWdlLWJhc2VkIG9ycGhhbiBzd2VlcC5cbiAgICogQHJldHVybnMge1Byb21pc2U8aW1wb3J0KFwiLi90eXBlcy5qc1wiKS5CYWNrZ3JvdW5kSm9iSGFuZG9mZlNuYXBzaG90W10+fSAtIEV4YWN0IHN0YXJ0dXAgaGFuZG9mZnMuXG4gICAqL1xuICBhc3luYyBzbmFwc2hvdEhhbmRlZE9mZkpvYnMoKSB7XG4gICAgYXdhaXQgdGhpcy5lbnN1cmVSZWFkeSgpXG5cbiAgICBjb25zdCByb3dzID0gYXdhaXQgdGhpcy5fd2l0aERiKGFzeW5jIChkYikgPT4gYXdhaXQgZGJcbiAgICAgIC5uZXdRdWVyeSgpXG4gICAgICAuZnJvbShKT0JTX1RBQkxFKVxuICAgICAgLndoZXJlKHtzdGF0dXM6IFwiaGFuZGVkX29mZlwifSlcbiAgICAgIC5vcmRlcihcImNyZWF0ZWRfYXRfbXMgQVNDXCIpXG4gICAgICAub3JkZXIoXCJpZCBBU0NcIilcbiAgICAgIC5yZXN1bHRzKCkpXG4gICAgLyoqIEB0eXBlIHtpbXBvcnQoXCIuL3R5cGVzLmpzXCIpLkJhY2tncm91bmRKb2JIYW5kb2ZmU25hcHNob3RbXX0gKi9cbiAgICBjb25zdCBoYW5kb2ZmcyA9IFtdXG5cbiAgICBmb3IgKGNvbnN0IHJvdyBvZiByb3dzKSB7XG4gICAgICBjb25zdCBqb2IgPSB0aGlzLl9ub3JtYWxpemVKb2JSb3cocm93KVxuXG4gICAgICBpZiAoIWpvYi5oYW5kb2ZmSWQgfHwgIWpvYi53b3JrZXJJZCB8fCB0eXBlb2Ygam9iLmhhbmRlZE9mZkF0TXMgIT09IFwibnVtYmVyXCIpIGNvbnRpbnVlXG5cbiAgICAgIGhhbmRvZmZzLnB1c2goe1xuICAgICAgICBoYW5kZWRPZmZBdE1zOiBqb2IuaGFuZGVkT2ZmQXRNcyxcbiAgICAgICAgaGFuZG9mZklkOiBqb2IuaGFuZG9mZklkLFxuICAgICAgICBqb2JJZDogam9iLmlkLFxuICAgICAgICB3b3JrZXJJZDogam9iLndvcmtlcklkXG4gICAgICB9KVxuICAgIH1cblxuICAgIHJldHVybiBoYW5kb2Zmc1xuICB9XG5cbiAgLyoqXG4gICAqIFJlY2xhaW1zIG9ubHkgdW5jaGFuZ2VkIGV4YWN0IGhhbmRvZmZzIHNlbGVjdGVkIGJ5IGEgbWFpbi1nZW5lcmF0aW9uIHN0YXJ0dXBcbiAgICogc25hcHNob3QuIFRoZSBvcmRpbmFyeSBvcnBoYW4gZmFpbHVyZSBwYXRoIG93bnMgcmV0cmllcywgdGVybWluYWwgc3RhdHVzLFxuICAgKiBjb3VudCB0cmFuc2l0aW9ucywgc2NoZWR1bGUgb3duZXJzaGlwLCBhbmQgY29uY3VycmVuY3kgcmVsZWFzZS5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBPcHRpb25zLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vdHlwZXMuanNcIikuQmFja2dyb3VuZEpvYkhhbmRvZmZTbmFwc2hvdFtdfSBhcmdzLmhhbmRvZmZzIC0gRXhhY3Qgc3RhcnR1cCBzbmFwc2hvdHMuXG4gICAqIEBwYXJhbSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59IGFyZ3MuZXJyb3IgLSBPcnBoYW4gcmVhc29uLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxpbXBvcnQoXCIuL3R5cGVzLmpzXCIpLkJhY2tncm91bmRKb2JSb3dbXT59IC0gQWNjZXB0ZWQgdHJhbnNpdGlvbnMuXG4gICAqL1xuICBhc3luYyBtYXJrT3JwaGFuZWRIYW5kb2Zmcyh7aGFuZG9mZnMsIGVycm9yfSkge1xuICAgIGF3YWl0IHRoaXMuZW5zdXJlUmVhZHkoKVxuXG4gICAgcmV0dXJuIGF3YWl0IHRoaXMuX3NlcmlhbGl6ZWRDb3VudE11dGF0aW9uKGFzeW5jIChkYikgPT4ge1xuICAgICAgLyoqIEB0eXBlIHtCYWNrZ3JvdW5kSm9iT3JwaGFuU2VsZWN0aW9uW119ICovXG4gICAgICBjb25zdCBzZWxlY3Rpb25zID0gW11cblxuICAgICAgZm9yIChjb25zdCBoYW5kb2ZmIG9mIGhhbmRvZmZzKSB7XG4gICAgICAgIGNvbnN0IGpvYiA9IGF3YWl0IHRoaXMuX2dldEpvYlJvd0J5SWQoZGIsIGhhbmRvZmYuam9iSWQpXG5cbiAgICAgICAgaWYgKCFqb2IgfHwgam9iLnN0YXR1cyAhPT0gXCJoYW5kZWRfb2ZmXCIpIGNvbnRpbnVlXG4gICAgICAgIGlmIChqb2IuaGFuZG9mZklkICE9PSBoYW5kb2ZmLmhhbmRvZmZJZCkgY29udGludWVcbiAgICAgICAgaWYgKGpvYi53b3JrZXJJZCAhPT0gaGFuZG9mZi53b3JrZXJJZCkgY29udGludWVcbiAgICAgICAgaWYgKGpvYi5oYW5kZWRPZmZBdE1zICE9PSBoYW5kb2ZmLmhhbmRlZE9mZkF0TXMpIGNvbnRpbnVlXG5cbiAgICAgICAgc2VsZWN0aW9ucy5wdXNoKHtcbiAgICAgICAgICBjb25kaXRpb25zOiB7XG4gICAgICAgICAgICBoYW5kZWRfb2ZmX2F0X21zOiBoYW5kb2ZmLmhhbmRlZE9mZkF0TXMsXG4gICAgICAgICAgICBoYW5kb2ZmX2lkOiBoYW5kb2ZmLmhhbmRvZmZJZCxcbiAgICAgICAgICAgIGlkOiBoYW5kb2ZmLmpvYklkLFxuICAgICAgICAgICAgc3RhdHVzOiBcImhhbmRlZF9vZmZcIixcbiAgICAgICAgICAgIHdvcmtlcl9pZDogaGFuZG9mZi53b3JrZXJJZFxuICAgICAgICAgIH0sXG4gICAgICAgICAgam9iXG4gICAgICAgIH0pXG4gICAgICB9XG5cbiAgICAgIHJldHVybiBhd2FpdCB0aGlzLl9tYXJrT3JwaGFuU2VsZWN0aW9ucyh7ZGIsIGVycm9yLCBzZWxlY3Rpb25zfSlcbiAgICB9KVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgbWFyayBmYWlsZWQuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gT3B0aW9ucy5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGFyZ3Muam9iSWQgLSBKb2IgaWQuXG4gICAqIEBwYXJhbSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59IGFyZ3MuZXJyb3IgLSBFcnJvci5cbiAgICogQHBhcmFtIHtzdHJpbmd9IFthcmdzLmhhbmRvZmZJZF0gLSBIYW5kb2ZmIGxlYXNlIGlkLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gW2FyZ3Mud29ya2VySWRdIC0gV29ya2VyIGlkLlxuICAgKiBAcGFyYW0ge251bWJlcn0gW2FyZ3MuaGFuZGVkT2ZmQXRNc10gLSBIYW5kZWQgb2ZmIHRpbWVzdGFtcC5cbiAgICogQHJldHVybnMge1Byb21pc2U8aW1wb3J0KFwiLi90eXBlcy5qc1wiKS5CYWNrZ3JvdW5kSm9iUm93IHwgbnVsbD59IC0gVXBkYXRlZCBqb2Igcm93IHdoZW4gdGhlIHJlcG9ydCB3YXMgYWNjZXB0ZWQuXG4gICAqL1xuICBhc3luYyBtYXJrRmFpbGVkKHtqb2JJZCwgZXJyb3IsIGhhbmRvZmZJZCwgd29ya2VySWQsIGhhbmRlZE9mZkF0TXN9KSB7XG4gICAgYXdhaXQgdGhpcy5lbnN1cmVSZWFkeSgpXG5cbiAgICByZXR1cm4gYXdhaXQgdGhpcy5fc2VyaWFsaXplZENvdW50TXV0YXRpb24oYXN5bmMgKGRiKSA9PiB7XG4gICAgICBjb25zdCBqb2IgPSBhd2FpdCB0aGlzLl9nZXRKb2JSb3dCeUlkKGRiLCBqb2JJZClcblxuICAgICAgaWYgKCFqb2IpIHJldHVybiBudWxsXG4gICAgICBpZiAoIXRoaXMuX3Nob3VsZEFjY2VwdFJlcG9ydCh7am9iLCBoYW5kb2ZmSWQsIHdvcmtlcklkLCBoYW5kZWRPZmZBdE1zfSkpIHJldHVybiBudWxsXG5cbiAgICAgIGNvbnN0IHVwZGF0ZWRKb2IgPSBhd2FpdCB0aGlzLl9hcHBseUZhaWx1cmUoe2RiLCBqb2IsIGVycm9yLCBtYXJrT3JwaGFuZWQ6IGZhbHNlfSlcblxuICAgICAgaWYgKHVwZGF0ZWRKb2IpIGF3YWl0IHRoaXMuX3JlY29yZFN0YXR1c1RyYW5zaXRpb24oZGIsIGpvYi5zdGF0dXMsIHVwZGF0ZWRKb2Iuc3RhdHVzKVxuICAgICAgcmV0dXJuIHVwZGF0ZWRKb2JcbiAgICB9KVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgbWFyayBvcnBoYW5lZCBqb2JzLlxuICAgKiBAcGFyYW0ge29iamVjdH0gW2FyZ3NdIC0gT3B0aW9ucy5cbiAgICogQHBhcmFtIHtudW1iZXJ9IFthcmdzLm9ycGhhbmVkQWZ0ZXJNc10gLSBNYXJrIGpvYnMgb3JwaGFuZWQgYWZ0ZXIgdGhpcyBkdXJhdGlvbi5cbiAgICogQHJldHVybnMge1Byb21pc2U8aW1wb3J0KFwiLi90eXBlcy5qc1wiKS5CYWNrZ3JvdW5kSm9iUm93W10+fSAtIFRoZSBqb2JzIHRoaXMgc3dlZXAgbWFya2VkIG9ycGhhbmVkLlxuICAgKi9cbiAgYXN5bmMgbWFya09ycGhhbmVkSm9icyh7b3JwaGFuZWRBZnRlck1zID0gT1JQSEFORURfQUZURVJfTVN9ID0ge30pIHtcbiAgICBhd2FpdCB0aGlzLmVuc3VyZVJlYWR5KClcblxuICAgIHJldHVybiBhd2FpdCB0aGlzLl9zZXJpYWxpemVkQ291bnRNdXRhdGlvbihhc3luYyAoZGIpID0+IHtcbiAgICAgIGNvbnN0IGN1dG9mZiA9IERhdGUubm93KCkgLSBvcnBoYW5lZEFmdGVyTXNcbiAgICAgIGNvbnN0IHF1ZXJ5ID0gZGJcbiAgICAgICAgLm5ld1F1ZXJ5KClcbiAgICAgICAgLmZyb20oSk9CU19UQUJMRSlcbiAgICAgICAgLndoZXJlKHtzdGF0dXM6IFwiaGFuZGVkX29mZlwifSlcbiAgICAgICAgLndoZXJlKGBoYW5kZWRfb2ZmX2F0X21zIDw9ICR7ZGIucXVvdGUoY3V0b2ZmKX1gKVxuXG4gICAgICBjb25zdCByb3dzID0gYXdhaXQgcXVlcnkucmVzdWx0cygpXG5cbiAgICAgIC8qKiBAdHlwZSB7QmFja2dyb3VuZEpvYk9ycGhhblNlbGVjdGlvbltdfSAqL1xuICAgICAgY29uc3Qgc2VsZWN0aW9ucyA9IFtdXG5cbiAgICAgIGZvciAoY29uc3Qgcm93IG9mIHJvd3MpIHtcbiAgICAgICAgY29uc3Qgam9iID0gdGhpcy5fbm9ybWFsaXplSm9iUm93KHJvdylcblxuICAgICAgICAvLyBGZW5jZSB0aGUgcmVjbGFpbSBvbiB0aGUgZXhhY3QgaGFuZG9mZiB0aGlzIHN3ZWVwIHNlbGVjdGVkLCB1c2luZyBpdHNcbiAgICAgICAgLy8gYGhhbmRlZF9vZmZfYXRfbXNgIHJhdGhlciB0aGFuIGl0cyBgaGFuZG9mZl9pZGAuIFR3byByZWFzb25zOlxuICAgICAgICAvLyAgIDEuIE51bGwtc2FmZS4gU29tZSByb3dzIGhhdmUgYSBudWxsIGBoYW5kb2ZmX2lkYCAoaGFuZGVkIG9mZiBieSBhblxuICAgICAgICAvLyAgICAgIG9sZGVyIHZlbG9jaW91cyBiZWZvcmUgaGFuZG9mZi1pZCBmZW5jaW5nKS4gYHtoYW5kb2ZmX2lkOiBudWxsfWBcbiAgICAgICAgLy8gICAgICByZW5kZXJzIGFzIGBoYW5kb2ZmX2lkID0gTlVMTGAsIHdoaWNoIG1hdGNoZXMgbm90aGluZywgc28gdGhvc2VcbiAgICAgICAgLy8gICAgICByb3dzIHdvdWxkIGJlIHN0cmFuZGVkIGluIGBoYW5kZWRfb2ZmYCBmb3JldmVyLlxuICAgICAgICAvLyAgIDIuIFJhY2Utc2FmZS4gSWYgdGhlIHJvdyBpcyByZXR1cm5lZCB0byB0aGUgcXVldWUgYW5kIHJlLWhhbmRlZC1vZmZcbiAgICAgICAgLy8gICAgICBiZXR3ZWVuIHRoZSBTRUxFQ1QgYWJvdmUgYW5kIHRoaXMgdXBkYXRlLCBpdCBnZXRzIGEgZnJlc2hcbiAgICAgICAgLy8gICAgICBgaGFuZGVkX29mZl9hdF9tc2AgKGFsd2F5cyBcIm5vd1wiKSwgc28gdGhpcyBzdGFsZSBjdXRvZmYtZXJhXG4gICAgICAgIC8vICAgICAgdGltZXN0YW1wIG5vIGxvbmdlciBtYXRjaGVzIGFuZCB3ZSB3b24ndCBmYWlsL29ycGhhbiDigJQgb3JcbiAgICAgICAgLy8gICAgICB3cm9uZ2x5IHJlbGVhc2UgdGhlIGNvbmN1cnJlbmN5IHJlc2VydmF0aW9uIG9mIOKAlCB0aGF0IG5ldyBsZWFzZS5cbiAgICAgICAgLy8gYGhhbmRlZF9vZmZfYXRfbXNgIGlzIGFsd2F5cyBzZXQgb24gYSBoYW5kZWQtb2ZmIHJvdyAoYW5kIHRoZSBTRUxFQ1RcbiAgICAgICAgLy8gcmVxdWlyZWQgaXQgYDw9IGN1dG9mZmApLCBzbyBpdCBpcyBhIHJlbGlhYmxlIG51bGwtc2FmZSBsZWFzZSBwaW4uXG4gICAgICAgIHNlbGVjdGlvbnMucHVzaCh7XG4gICAgICAgICAgY29uZGl0aW9uczoge2lkOiBqb2IuaWQsIHN0YXR1czogXCJoYW5kZWRfb2ZmXCIsIGhhbmRlZF9vZmZfYXRfbXM6IGpvYi5oYW5kZWRPZmZBdE1zfSxcbiAgICAgICAgICBqb2JcbiAgICAgICAgfSlcbiAgICAgIH1cblxuICAgICAgcmV0dXJuIGF3YWl0IHRoaXMuX21hcmtPcnBoYW5TZWxlY3Rpb25zKHtcbiAgICAgICAgZGIsXG4gICAgICAgIGVycm9yOiBcIkpvYiBvcnBoYW5lZCBhZnRlciB0aW1lb3V0XCIsXG4gICAgICAgIHNlbGVjdGlvbnNcbiAgICAgIH0pXG4gICAgfSlcbiAgfVxuXG4gIC8qKlxuICAgKiBBcHBsaWVzIHRoZSBjb21tb24gZmVuY2VkIG9ycGhhbiB0cmFuc2l0aW9uIGFuZCByZWNvcmRzIG9uZSBhZ2dyZWdhdGUgY291bnRcbiAgICogZGVsdGEgZm9yIHRoZSBhY2NlcHRlZCByb3dzLlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIE9wdGlvbnMuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vZGF0YWJhc2UvZHJpdmVycy9iYXNlLmpzXCIpLmRlZmF1bHR9IGFyZ3MuZGIgLSBUcmFuc2FjdGlvbiBjb25uZWN0aW9uLlxuICAgKiBAcGFyYW0ge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSBhcmdzLmVycm9yIC0gT3JwaGFuIHJlYXNvbi5cbiAgICogQHBhcmFtIHtCYWNrZ3JvdW5kSm9iT3JwaGFuU2VsZWN0aW9uW119IGFyZ3Muc2VsZWN0aW9ucyAtIFNlbGVjdGVkIGhhbmRvZmZzIGFuZCBleGFjdCBmZW5jZXMuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPGltcG9ydChcIi4vdHlwZXMuanNcIikuQmFja2dyb3VuZEpvYlJvd1tdPn0gLSBBY2NlcHRlZCB0cmFuc2l0aW9ucy5cbiAgICovXG4gIGFzeW5jIF9tYXJrT3JwaGFuU2VsZWN0aW9ucyh7ZGIsIGVycm9yLCBzZWxlY3Rpb25zfSkge1xuICAgIC8qKiBAdHlwZSB7aW1wb3J0KFwiLi90eXBlcy5qc1wiKS5CYWNrZ3JvdW5kSm9iUm93W119ICovXG4gICAgY29uc3Qgb3JwaGFuZWRKb2JzID0gW11cblxuICAgIGZvciAoY29uc3Qge2NvbmRpdGlvbnMsIGpvYn0gb2Ygc2VsZWN0aW9ucykge1xuICAgICAgY29uc3Qgb3JwaGFuZWRKb2IgPSBhd2FpdCB0aGlzLl9hcHBseUZhaWx1cmUoe1xuICAgICAgICBjb25kaXRpb25zLFxuICAgICAgICBkYixcbiAgICAgICAgZXJyb3IsXG4gICAgICAgIGpvYixcbiAgICAgICAgbWFya09ycGhhbmVkOiB0cnVlXG4gICAgICB9KVxuXG4gICAgICBpZiAob3JwaGFuZWRKb2IpIG9ycGhhbmVkSm9icy5wdXNoKG9ycGhhbmVkSm9iKVxuICAgIH1cblxuICAgIGNvbnN0IHN0YXR1c0NvdW50cyA9IHRoaXMuX3N0YXR1c0NvdW50cyhvcnBoYW5lZEpvYnMpXG4gICAgY29uc3QgZGVsdGFzID0gdGhpcy5fZW1wdHlDb3VudEJ1Y2tldHMoKVxuXG4gICAgZm9yIChjb25zdCBbc3RhdHVzLCBjb3VudF0gb2YgT2JqZWN0LmVudHJpZXMoc3RhdHVzQ291bnRzKSkge1xuICAgICAgZGVsdGFzLmhhbmRlZF9vZmYgLT0gY291bnRcbiAgICAgIGRlbHRhc1tzdGF0dXNdICs9IGNvdW50XG4gICAgfVxuICAgIGF3YWl0IHRoaXMuX3JlY29yZENvdW50RGVsdGEoZGIsIGRlbHRhcylcblxuICAgIHJldHVybiBvcnBoYW5lZEpvYnNcbiAgfVxuXG4gIC8qKlxuICAgKiBEZWxldGVzIHRlcm1pbmFsIGpvYiByb3dzIHBhc3QgdGhlaXIgcmV0ZW50aW9uIHdpbmRvdyBzbyB0aGUgam9icyB0YWJsZVxuICAgKiBkb2VzIG5vdCBncm93IHVuYm91bmRlZCAoY29tcGxldGVkIHJvd3MgaW4gcGFydGljdWxhciBhY2N1bXVsYXRlIGZvcmV2ZXJcbiAgICogb3RoZXJ3aXNlKS4gQmF0Y2hlZCBieSBpZCDigJQgU0VMRUNUIGEgcGFnZSBvZiBpZHMsIHRoZW5cbiAgICogYERFTEVURSAuLi4gV0hFUkUgaWQgSU4gKC4uLilgIOKAlCByYXRoZXIgdGhhbiBgREVMRVRFIC4uLiBMSU1JVGAsIHdoaWNoIG5vdFxuICAgKiBldmVyeSBkcml2ZXIgc3VwcG9ydHM7IGVhY2ggYmF0Y2ggcnVucyBvbiBpdHMgb3duIGNvbm5lY3Rpb24gc28gdGhlIHN3ZWVwXG4gICAqIHlpZWxkcyBiZXR3ZWVuIGJhdGNoZXMgaW5zdGVhZCBvZiBob2xkaW5nIG9uZSBsb25nIHRyYW5zYWN0aW9uLlxuICAgKiBAcGFyYW0ge29iamVjdH0gW2FyZ3NdIC0gT3B0aW9ucy5cbiAgICogQHBhcmFtIHtudW1iZXIgfCBudWxsfSBbYXJncy5jb21wbGV0ZWRUdGxNc10gLSBEZWxldGUgYGNvbXBsZXRlZGAgam9icyB3aG9zZSBgY29tcGxldGVkX2F0X21zYCBpcyBvbGRlciB0aGFuIHRoaXMgbWFueSBtcy4gRmFsc3kgb3IgYDw9IDBgIGRpc2FibGVzIGNvbXBsZXRlZCBwcnVuaW5nLlxuICAgKiBAcGFyYW0ge251bWJlciB8IG51bGx9IFthcmdzLmZhaWxlZFR0bE1zXSAtIERlbGV0ZSB0ZXJtaW5hbCBgZmFpbGVkYC9gb3JwaGFuZWRgIGpvYnMgb2xkZXIgdGhhbiB0aGlzIG1hbnkgbXMgKGJ5IGBmYWlsZWRfYXRfbXNgL2BvcnBoYW5lZF9hdF9tc2ApLiBGYWxzeSBvciBgPD0gMGAgZGlzYWJsZXMuXG4gICAqIEBwYXJhbSB7bnVtYmVyfSBbYXJncy5iYXRjaFNpemVdIC0gTWF4IHJvd3MgZGVsZXRlZCBwZXIgYmF0Y2guIERlZmF1bHQgYDEwMDBgLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxudW1iZXI+fSAtIFRvdGFsIHJvd3MgZGVsZXRlZC5cbiAgICovXG4gIGFzeW5jIHBydW5lVGVybWluYWxKb2JzKHtjb21wbGV0ZWRUdGxNcyA9IG51bGwsIGZhaWxlZFR0bE1zID0gbnVsbCwgYmF0Y2hTaXplID0gMTAwMH0gPSB7fSkge1xuICAgIGF3YWl0IHRoaXMuZW5zdXJlUmVhZHkoKVxuXG4gICAgY29uc3Qgbm93ID0gRGF0ZS5ub3coKVxuICAgIGNvbnN0IHNpemUgPSBiYXRjaFNpemUgPiAwID8gYmF0Y2hTaXplIDogMTAwMFxuICAgIGxldCBkZWxldGVkID0gMFxuXG4gICAgaWYgKGNvbXBsZXRlZFR0bE1zICYmIGNvbXBsZXRlZFR0bE1zID4gMCkge1xuICAgICAgZGVsZXRlZCArPSBhd2FpdCB0aGlzLl9wcnVuZVN0YXR1c0JhdGNoZXMoe3N0YXR1czogXCJjb21wbGV0ZWRcIiwgY29sdW1uOiBcImNvbXBsZXRlZF9hdF9tc1wiLCBjdXRvZmY6IG5vdyAtIGNvbXBsZXRlZFR0bE1zLCBiYXRjaFNpemU6IHNpemV9KVxuICAgIH1cblxuICAgIGlmIChmYWlsZWRUdGxNcyAmJiBmYWlsZWRUdGxNcyA+IDApIHtcbiAgICAgIGRlbGV0ZWQgKz0gYXdhaXQgdGhpcy5fcHJ1bmVTdGF0dXNCYXRjaGVzKHtzdGF0dXM6IFwiZmFpbGVkXCIsIGNvbHVtbjogXCJmYWlsZWRfYXRfbXNcIiwgY3V0b2ZmOiBub3cgLSBmYWlsZWRUdGxNcywgYmF0Y2hTaXplOiBzaXplfSlcbiAgICAgIGRlbGV0ZWQgKz0gYXdhaXQgdGhpcy5fcHJ1bmVTdGF0dXNCYXRjaGVzKHtzdGF0dXM6IFwib3JwaGFuZWRcIiwgY29sdW1uOiBcIm9ycGhhbmVkX2F0X21zXCIsIGN1dG9mZjogbm93IC0gZmFpbGVkVHRsTXMsIGJhdGNoU2l6ZTogc2l6ZX0pXG4gICAgfVxuXG4gICAgcmV0dXJuIGRlbGV0ZWRcbiAgfVxuXG4gIC8qKlxuICAgKiBEZWxldGVzIHJvd3Mgb2Ygb25lIHRlcm1pbmFsIHN0YXR1cyBvbGRlciB0aGFuIGEgY3V0b2ZmLCBiYXRjaCBieSBiYXRjaCxcbiAgICogdW50aWwgYSBwYWdlIHJldHVybnMgZmV3ZXIgdGhhbiBgYmF0Y2hTaXplYCByb3dzLlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIE9wdGlvbnMuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBhcmdzLnN0YXR1cyAtIFRlcm1pbmFsIHN0YXR1cyB0byBwcnVuZS5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGFyZ3MuY29sdW1uIC0gVGltZXN0YW1wIGNvbHVtbiBjb21wYXJlZCBhZ2FpbnN0IHRoZSBjdXRvZmYuXG4gICAqIEBwYXJhbSB7bnVtYmVyfSBhcmdzLmN1dG9mZiAtIERlbGV0ZSByb3dzIHdob3NlIGNvbHVtbiB2YWx1ZSBpcyBgPD0gY3V0b2ZmYC5cbiAgICogQHBhcmFtIHtudW1iZXJ9IGFyZ3MuYmF0Y2hTaXplIC0gTWF4IHJvd3MgcGVyIGJhdGNoLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxudW1iZXI+fSAtIFJvd3MgZGVsZXRlZCBmb3IgdGhpcyBzdGF0dXMuXG4gICAqL1xuICBhc3luYyBfcHJ1bmVTdGF0dXNCYXRjaGVzKHtzdGF0dXMsIGNvbHVtbiwgY3V0b2ZmLCBiYXRjaFNpemV9KSB7XG4gICAgbGV0IGRlbGV0ZWQgPSAwXG5cbiAgICBmb3IgKDs7KSB7XG4gICAgICBjb25zdCByZW1vdmVkID0gYXdhaXQgdGhpcy5fc2VyaWFsaXplZENvdW50TXV0YXRpb24oYXN5bmMgKGRiKSA9PiB7XG4gICAgICAgIGNvbnN0IHJvd3MgPSBhd2FpdCBkYlxuICAgICAgICAgIC5uZXdRdWVyeSgpXG4gICAgICAgICAgLmZyb20oSk9CU19UQUJMRSlcbiAgICAgICAgICAuc2VsZWN0KFwiaWRcIilcbiAgICAgICAgICAud2hlcmUoe3N0YXR1c30pXG4gICAgICAgICAgLndoZXJlKGAke2RiLnF1b3RlQ29sdW1uKGNvbHVtbil9IDw9ICR7ZGIucXVvdGUoY3V0b2ZmKX1gKVxuICAgICAgICAgIC5saW1pdChiYXRjaFNpemUpXG4gICAgICAgICAgLnJlc3VsdHMoKVxuXG4gICAgICAgIGlmIChyb3dzLmxlbmd0aCA9PT0gMCkgcmV0dXJuIDBcblxuICAgICAgICBjb25zdCBpZHMgPSByb3dzLm1hcCgoLyoqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59ICovIHJvdykgPT4gZGIucXVvdGUoU3RyaW5nKHJvdy5pZCkpKS5qb2luKFwiLCBcIilcblxuICAgICAgICBjb25zdCByZW1vdmVkID0gYXdhaXQgZGIuYWZmZWN0ZWRSb3dzKFxuICAgICAgICAgIGBERUxFVEUgRlJPTSAke2RiLnF1b3RlVGFibGUoSk9CU19UQUJMRSl9IFdIRVJFICR7ZGIucXVvdGVDb2x1bW4oXCJpZFwiKX0gSU4gKCR7aWRzfSlgXG4gICAgICAgIClcblxuICAgICAgICBhd2FpdCB0aGlzLl9yZWNvcmRDb3VudERlbHRhKGRiLCB7YWxsOiAtcmVtb3ZlZCwgW3N0YXR1c106IC1yZW1vdmVkfSlcblxuICAgICAgICByZXR1cm4gcmVtb3ZlZFxuICAgICAgfSlcblxuICAgICAgZGVsZXRlZCArPSByZW1vdmVkXG4gICAgICBpZiAocmVtb3ZlZCA8IGJhdGNoU2l6ZSkgYnJlYWtcbiAgICB9XG5cbiAgICByZXR1cm4gZGVsZXRlZFxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgY2xlYXIgYWxsLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyB3aGVuIGNsZWFyZWQuXG4gICAqL1xuICBhc3luYyBjbGVhckFsbCgpIHtcbiAgICBhd2FpdCB0aGlzLmVuc3VyZVJlYWR5KClcblxuICAgIGF3YWl0IHRoaXMuX3NlcmlhbGl6ZWRDb3VudE11dGF0aW9uKGFzeW5jIChkYikgPT4ge1xuICAgICAgY29uc3Qgc25hcHNob3QgPSBhd2FpdCB0aGlzLl9jb3VudFNuYXBzaG90T25Mb2NrZWRDb25uZWN0aW9uKGRiKVxuICAgICAgaWYgKGF3YWl0IGRiLnRhYmxlRXhpc3RzKE1BSUxfREVMSVZFUllfT1BFUkFUSU9OU19UQUJMRSkpIGF3YWl0IGRiLnF1ZXJ5KGBERUxFVEUgRlJPTSAke2RiLnF1b3RlVGFibGUoTUFJTF9ERUxJVkVSWV9PUEVSQVRJT05TX1RBQkxFKX1gKVxuICAgICAgaWYgKGF3YWl0IGRiLnRhYmxlRXhpc3RzKElERU1QT1RFTkNZX0tFWVNfVEFCTEUpKSBhd2FpdCBkYi5xdWVyeShgREVMRVRFIEZST00gJHtkYi5xdW90ZVRhYmxlKElERU1QT1RFTkNZX0tFWVNfVEFCTEUpfWApXG4gICAgICBpZiAoYXdhaXQgZGIudGFibGVFeGlzdHMoU0NIRURVTEVfS0VZU19UQUJMRSkpIGF3YWl0IGRiLnF1ZXJ5KGBERUxFVEUgRlJPTSAke2RiLnF1b3RlVGFibGUoU0NIRURVTEVfS0VZU19UQUJMRSl9YClcbiAgICAgIGF3YWl0IGRiLnF1ZXJ5KGBERUxFVEUgRlJPTSAke2RiLnF1b3RlVGFibGUoSk9CU19UQUJMRSl9YClcbiAgICAgIGlmIChhd2FpdCBkYi50YWJsZUV4aXN0cyhDT05DVVJSRU5DWV9UQUJMRSkpIGF3YWl0IGRiLnF1ZXJ5KGBERUxFVEUgRlJPTSAke2RiLnF1b3RlVGFibGUoQ09OQ1VSUkVOQ1lfVEFCTEUpfWApXG4gICAgICBjb25zdCBkZWx0YXMgPSBPYmplY3QuZnJvbUVudHJpZXMoT2JqZWN0LmVudHJpZXMoc25hcHNob3QuY291bnRzKS5tYXAoKFtrZXksIHZhbHVlXSkgPT4gW2tleSwgLXZhbHVlXSkpXG4gICAgICBhd2FpdCB0aGlzLl9yZWNvcmRDb3VudERlbHRhKGRiLCBkZWx0YXMpXG4gICAgfSlcbiAgfVxuXG4gIC8qKlxuICAgKiBDYW5jZWxzIGEgcXVldWVkIG9yIGhhbmRlZC1vZmYgam9iIGFuZCByZWxlYXNlcyBhbnkgZHVyYWJsZSBjb25jdXJyZW5jeSByZXNlcnZhdGlvbi5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGpvYklkIC0gSm9iIGlkLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxib29sZWFuPn0gLSBXaGV0aGVyIHRoZSBqb2Igd2FzIGNhbmNlbGxlZC5cbiAgICovXG4gIGFzeW5jIGNhbmNlbChqb2JJZCkge1xuICAgIGF3YWl0IHRoaXMuZW5zdXJlUmVhZHkoKVxuICAgIHJldHVybiBhd2FpdCB0aGlzLl9zZXJpYWxpemVkQ291bnRNdXRhdGlvbihhc3luYyAoZGIpID0+IHtcbiAgICAgIGNvbnN0IGpvYiA9IGF3YWl0IHRoaXMuX2dldEpvYlJvd0J5SWQoZGIsIGpvYklkKVxuICAgICAgaWYgKCFqb2IgfHwgKGpvYi5zdGF0dXMgIT09IFwicXVldWVkXCIgJiYgam9iLnN0YXR1cyAhPT0gXCJoYW5kZWRfb2ZmXCIpKSByZXR1cm4gZmFsc2VcbiAgICAgIC8vIE9ubHkgYSBoYW5kZWRfb2ZmIGpvYiBob2xkcyBhIGNvbmN1cnJlbmN5IHJlc2VydmF0aW9uLCBzbyBvbmx5IHRoYXQgY2FzZSB0b3VjaGVzIHRoZVxuICAgICAgLy8gc2hhcmVkIGNvdW50ZXIgcm93IGFuZCBuZWVkcyB0aGUgY29uY3VycmVuY3ktdGhlbi1qb2IgbG9jayBvcmRlcmluZy5cbiAgICAgIGlmIChqb2Iuc3RhdHVzID09PSBcImhhbmRlZF9vZmZcIikgYXdhaXQgdGhpcy5fbG9ja0NvbmN1cnJlbmN5Um93KGRiLCBqb2IuY29uY3VycmVuY3lLZXkpXG4gICAgICBjb25zdCBhZmZlY3RlZFJvd3MgPSBhd2FpdCB0aGlzLl91cGRhdGVBZmZlY3RlZFJvd3MoZGIsIHt0YWJsZU5hbWU6IEpPQlNfVEFCTEUsIGRhdGE6IHtzdGF0dXM6IFwiY2FuY2VsbGVkXCJ9LCBjb25kaXRpb25zOiB7aWQ6IGpvYi5pZCwgc3RhdHVzOiBqb2Iuc3RhdHVzfX0pXG4gICAgICBpZiAoYWZmZWN0ZWRSb3dzICE9PSAxKSByZXR1cm4gZmFsc2VcbiAgICAgIGF3YWl0IHRoaXMuX3JlbGVhc2VTY2hlZHVsZU93bmVyc2hpcEZvckpvYihkYiwgam9iKVxuICAgICAgaWYgKGpvYi5zdGF0dXMgPT09IFwiaGFuZGVkX29mZlwiKSBhd2FpdCB0aGlzLl9yZWxlYXNlQ29uY3VycmVuY3koZGIsIGpvYi5jb25jdXJyZW5jeUtleSlcbiAgICAgIGF3YWl0IHRoaXMuX3JlY29yZFN0YXR1c1RyYW5zaXRpb24oZGIsIGpvYi5zdGF0dXMsIFwiY2FuY2VsbGVkXCIpXG4gICAgICByZXR1cm4gdHJ1ZVxuICAgIH0pXG4gIH1cblxuICAvKipcbiAgICogUnVucyBnZXQgcmV0cnkgZGVsYXkgbXMuXG4gICAqIEBwYXJhbSB7bnVtYmVyfSByZXRyeUNvdW50IC0gUmV0cnkgYXR0ZW1wdCBjb3VudCAoMS1iYXNlZCkuXG4gICAqIEByZXR1cm5zIHtudW1iZXJ9IC0gRGVsYXkgaW4gbWlsbGlzZWNvbmRzLlxuICAgKi9cbiAgZ2V0UmV0cnlEZWxheU1zKHJldHJ5Q291bnQpIHtcbiAgICByZXR1cm4gcmV0cnlEZWxheU1zKHJldHJ5Q291bnQpXG4gIH1cblxuICAvKipcbiAgICogTm9ybWFsaXplcyBvbmUgbmV3IGpvYiBiZWZvcmUgZW50ZXJpbmcgaXRzIHBlcnNpc3RlbmNlIHRyYW5zYWN0aW9uLlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIEpvYiBpbnB1dC5cbiAgICogQHBhcmFtIHtBcnJheTxSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59IGFyZ3MuYXJncyAtIEpvYiBhcmd1bWVudHMuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBhcmdzLmpvYk5hbWUgLSBKb2IgbmFtZS5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL3R5cGVzLmpzXCIpLkJhY2tncm91bmRKb2JPcHRpb25zfSBbYXJncy5vcHRpb25zXSAtIEpvYiBvcHRpb25zLlxuICAgKiBAcmV0dXJucyB7UHJlcGFyZWRCYWNrZ3JvdW5kSm9ifSAtIFByZXBhcmVkIGpvYi5cbiAgICovXG4gIF9wcmVwYXJlSm9iKHthcmdzLCBqb2JOYW1lLCBvcHRpb25zfSkge1xuICAgIGNvbnN0IGNyZWF0ZWRBdE1zID0gRGF0ZS5ub3coKVxuICAgIGNvbnN0IHF1ZXVlID0gdGhpcy5fbm9ybWFsaXplUXVldWUob3B0aW9ucylcblxuICAgIHJldHVybiB7XG4gICAgICBhcmdzSnNvbjogSlNPTi5zdHJpbmdpZnkoYXJncyB8fCBbXSksXG4gICAgICBjb25jdXJyZW5jeTogdGhpcy5fcmVzb2x2ZUNvbmN1cnJlbmN5KG9wdGlvbnMsIHF1ZXVlKSxcbiAgICAgIGNyZWF0ZWRBdE1zLFxuICAgICAgZXhlY3V0aW9uTW9kZTogdGhpcy5fbm9ybWFsaXplRXhlY3V0aW9uTW9kZShvcHRpb25zKSxcbiAgICAgIGpvYklkOiByYW5kb21VVUlEKCksXG4gICAgICBqb2JOYW1lLFxuICAgICAgbWF4UmV0cmllczogdGhpcy5fbm9ybWFsaXplTWF4UmV0cmllcyhvcHRpb25zPy5tYXhSZXRyaWVzKSxcbiAgICAgIHF1ZXVlLFxuICAgICAgc2NoZWR1bGVkQXRNczogdGhpcy5fbm9ybWFsaXplU2NoZWR1bGVkQXRNcyhvcHRpb25zPy5zY2hlZHVsZWRBdE1zLCBjcmVhdGVkQXRNcyksXG4gICAgICB0aW1lb3V0TXM6IHRoaXMuX25vcm1hbGl6ZUpvYlRpbWVvdXRNcyhvcHRpb25zKVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBOb3JtYWxpemVzIGEgcGVyLWpvYiB0aW1lb3V0IHdoaWxlIHByZXNlcnZpbmcgb21pdHRlZCAod29ya2VyIGZhbGxiYWNrKVxuICAgKiBzZXBhcmF0ZWx5IGZyb20gZXhwbGljaXRseSBkaXNhYmxlZC5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL3R5cGVzLmpzXCIpLkJhY2tncm91bmRKb2JPcHRpb25zIHwgdW5kZWZpbmVkfSBvcHRpb25zIC0gSm9iIG9wdGlvbnMuXG4gICAqIEByZXR1cm5zIHtudW1iZXIgfCBudWxsfSAtIFBvc2l0aXZlIHRpbWVvdXQsIHplcm8gZm9yIGRpc2FibGVkLCBvciBudWxsIHdoZW4gb21pdHRlZC5cbiAgICovXG4gIF9ub3JtYWxpemVKb2JUaW1lb3V0TXMob3B0aW9ucykge1xuICAgIGlmIChvcHRpb25zPy50aW1lb3V0TXMgPT09IHVuZGVmaW5lZCkgcmV0dXJuIG51bGxcblxuICAgIGNvbnN0IHRpbWVvdXRNcyA9IG9wdGlvbnMudGltZW91dE1zXG5cbiAgICBpZiAodHlwZW9mIHRpbWVvdXRNcyAhPT0gXCJudW1iZXJcIiB8fCAhTnVtYmVyLmlzRmluaXRlKHRpbWVvdXRNcykpIHtcbiAgICAgIHRocm93IFZlbG9jaW91c0Vycm9yLnNhZmUoSk9CX1RJTUVPVVRfVkFMSURBVElPTl9NRVNTQUdFKVxuICAgIH1cblxuICAgIGlmICh0aW1lb3V0TXMgPD0gMCkgcmV0dXJuIDBcblxuICAgIGlmICghTnVtYmVyLmlzSW50ZWdlcih0aW1lb3V0TXMpIHx8IHRpbWVvdXRNcyA+IE1BWF9KT0JfVElNRU9VVF9NUykge1xuICAgICAgdGhyb3cgVmVsb2Npb3VzRXJyb3Iuc2FmZShKT0JfVElNRU9VVF9WQUxJREFUSU9OX01FU1NBR0UpXG4gICAgfVxuXG4gICAgcmV0dXJuIHRpbWVvdXRNc1xuICB9XG5cbiAgLyoqXG4gICAqIEluc2VydHMgb25lIHByZXBhcmVkIHF1ZXVlZCBqb2IsIGluY2x1ZGluZyBpdHMgY29uY3VycmVuY3kgcmVnaXN0cmF0aW9uLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL2RhdGFiYXNlL2RyaXZlcnMvYmFzZS5qc1wiKS5kZWZhdWx0fSBkYiAtIERhdGFiYXNlIGNvbm5lY3Rpb24uXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gSW5zZXJ0IGlucHV0LlxuICAgKiBAcGFyYW0ge1ByZXBhcmVkQmFja2dyb3VuZEpvYn0gYXJncy5wcmVwYXJlZEpvYiAtIFByZXBhcmVkIGpvYi5cbiAgICogQHBhcmFtIHtzdHJpbmcgfCBudWxsfSBhcmdzLnNjaGVkdWxlS2V5IC0gSGlzdG9yaWNhbCBzdGFibGUga2V5LlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyBhZnRlciBpbnNlcnRpb24uXG4gICAqL1xuICBhc3luYyBfaW5zZXJ0UHJlcGFyZWRKb2IoZGIsIHtwcmVwYXJlZEpvYiwgc2NoZWR1bGVLZXl9KSB7XG4gICAgY29uc3Qge2NvbmN1cnJlbmN5fSA9IHByZXBhcmVkSm9iXG5cbiAgICBpZiAoY29uY3VycmVuY3kpIHtcbiAgICAgIGlmIChjb25jdXJyZW5jeS5xdWV1ZURlcml2ZWQpIHtcbiAgICAgICAgYXdhaXQgdGhpcy5fZW5zdXJlUXVldWVDb25jdXJyZW5jeUtleShkYiwgY29uY3VycmVuY3kpXG4gICAgICB9IGVsc2Uge1xuICAgICAgICBhd2FpdCB0aGlzLl9lbnN1cmVDb25jdXJyZW5jeUtleShkYiwgY29uY3VycmVuY3kpXG4gICAgICB9XG4gICAgfVxuXG4gICAgYXdhaXQgZGIuaW5zZXJ0KHtcbiAgICAgIHRhYmxlTmFtZTogSk9CU19UQUJMRSxcbiAgICAgIGRhdGE6IHtcbiAgICAgICAgaWQ6IHByZXBhcmVkSm9iLmpvYklkLFxuICAgICAgICBqb2JfbmFtZTogcHJlcGFyZWRKb2Iuam9iTmFtZSxcbiAgICAgICAgYXJnc19qc29uOiBwcmVwYXJlZEpvYi5hcmdzSnNvbixcbiAgICAgICAgZXhlY3V0aW9uX21vZGU6IHByZXBhcmVkSm9iLmV4ZWN1dGlvbk1vZGUsXG4gICAgICAgIHF1ZXVlOiBwcmVwYXJlZEpvYi5xdWV1ZSxcbiAgICAgICAgbWF4X3JldHJpZXM6IHByZXBhcmVkSm9iLm1heFJldHJpZXMsXG4gICAgICAgIGF0dGVtcHRzOiAwLFxuICAgICAgICBzdGF0dXM6IFwicXVldWVkXCIsXG4gICAgICAgIHNjaGVkdWxlZF9hdF9tczogcHJlcGFyZWRKb2Iuc2NoZWR1bGVkQXRNcyxcbiAgICAgICAgY3JlYXRlZF9hdF9tczogcHJlcGFyZWRKb2IuY3JlYXRlZEF0TXMsXG4gICAgICAgIHNjaGVkdWxlX2tleTogc2NoZWR1bGVLZXksXG4gICAgICAgIGNvbmN1cnJlbmN5X2tleTogY29uY3VycmVuY3k/LmNvbmN1cnJlbmN5S2V5IHx8IG51bGwsXG4gICAgICAgIG1heF9jb25jdXJyZW5jeTogY29uY3VycmVuY3k/Lm1heENvbmN1cnJlbmN5IHx8IG51bGwsXG4gICAgICAgIHRpbWVvdXRfbXM6IHByZXBhcmVkSm9iLnRpbWVvdXRNcyxcbiAgICAgICAgaGFuZG9mZl9pZDogbnVsbFxuICAgICAgfVxuICAgIH0pXG4gIH1cblxuICAvKipcbiAgICogUnVucyBub3JtYWxpemUgbWF4IHJldHJpZXMuXG4gICAqIEBwYXJhbSB7bnVtYmVyIHwgbnVsbCB8IHVuZGVmaW5lZH0gbWF4UmV0cmllcyAtIElucHV0LlxuICAgKiBAcmV0dXJucyB7bnVtYmVyfSAtIE5vcm1hbGl6ZWQgbWF4IHJldHJpZXMuXG4gICAqL1xuICBfbm9ybWFsaXplTWF4UmV0cmllcyhtYXhSZXRyaWVzKSB7XG4gICAgcmV0dXJuIG5vcm1hbGl6ZUJhY2tncm91bmRKb2JNYXhSZXRyaWVzKG1heFJldHJpZXMpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBub3JtYWxpemUgc2NoZWR1bGVkIGF0IG1zLlxuICAgKiBAcGFyYW0ge251bWJlciB8IHVuZGVmaW5lZH0gc2NoZWR1bGVkQXRNcyAtIFJlcXVlc3RlZCBkaXNwYXRjaCB0aW1lc3RhbXAuXG4gICAqIEBwYXJhbSB7bnVtYmVyfSBkZWZhdWx0U2NoZWR1bGVkQXRNcyAtIERlZmF1bHQgZGlzcGF0Y2ggdGltZXN0YW1wLlxuICAgKiBAcmV0dXJucyB7bnVtYmVyfSAtIERpc3BhdGNoIHRpbWVzdGFtcC5cbiAgICovXG4gIF9ub3JtYWxpemVTY2hlZHVsZWRBdE1zKHNjaGVkdWxlZEF0TXMsIGRlZmF1bHRTY2hlZHVsZWRBdE1zKSB7XG4gICAgcmV0dXJuIG5vcm1hbGl6ZUJhY2tncm91bmRKb2JTY2hlZHVsZWRBdE1zKHNjaGVkdWxlZEF0TXMsIGRlZmF1bHRTY2hlZHVsZWRBdE1zKVxuICB9XG5cbiAgLyoqXG4gICAqIFJlc29sdmVzIGEgcmVzY2hlZHVsZSBkZWxheSBhZ2FpbnN0IHBlcnNpc3RlbmNlIHRpbWUuXG4gICAqIEBwYXJhbSB7bnVtYmVyfSBkZWxheU1zIC0gRGVsYXkgaW4gbWlsbGlzZWNvbmRzLlxuICAgKiBAcmV0dXJucyB7bnVtYmVyfSAtIEZ1dHVyZSBlbGlnaWJpbGl0eSB0aW1lc3RhbXAuXG4gICAqL1xuICBfcmVzY2hlZHVsZWRBdE1zKGRlbGF5TXMpIHtcbiAgICByZXR1cm4gcmVzY2hlZHVsZWRCYWNrZ3JvdW5kSm9iQXRNcyhkZWxheU1zLCBEYXRlLm5vdygpKVxuICB9XG5cbiAgLyoqXG4gICAqIFZhbGlkYXRlcyBhIHB1YmxpYyByZXNjaGVkdWxlIGRlbGF5IGJlZm9yZSBwZXJzaXN0ZW5jZSB3b3JrIGJlZ2lucy5cbiAgICogQHBhcmFtIHtudW1iZXJ9IGRlbGF5TXMgLSBEZWxheSBpbiBtaWxsaXNlY29uZHMuXG4gICAqIEByZXR1cm5zIHt2b2lkfVxuICAgKi9cbiAgX3ZhbGlkYXRlUmVzY2hlZHVsZURlbGF5TXMoZGVsYXlNcykge1xuICAgIHJlc2NoZWR1bGVkQmFja2dyb3VuZEpvYkF0TXMoZGVsYXlNcywgMClcbiAgfVxuXG4gIC8qKlxuICAgKiBWYWxpZGF0ZXMgYSBzdGFibGUgc2NoZWR1bGUga2V5IGF0IHRoZSBwdWJsaWMgc3RvcmFnZSBib3VuZGFyeS5cbiAgICogQHBhcmFtIHtzdHJpbmd9IHNjaGVkdWxlS2V5IC0gU3RhYmxlIGxvZ2ljYWwgc2NoZWR1bGUga2V5LlxuICAgKiBAcmV0dXJucyB7c3RyaW5nfSAtIFZhbGlkYXRlZCBrZXkuXG4gICAqL1xuICBfbm9ybWFsaXplU2NoZWR1bGVLZXkoc2NoZWR1bGVLZXkpIHtcbiAgICBpZiAodHlwZW9mIHNjaGVkdWxlS2V5ID09PSBcInN0cmluZ1wiICYmIHNjaGVkdWxlS2V5Lmxlbmd0aCA+IDAgJiYgc2NoZWR1bGVLZXkubGVuZ3RoIDw9IDI1NSkgcmV0dXJuIHNjaGVkdWxlS2V5XG5cbiAgICB0aHJvdyBWZWxvY2lvdXNFcnJvci5zYWZlKFwiYmFja2dyb3VuZCBqb2Igc2NoZWR1bGVLZXkgbXVzdCBiZSBhIG5vbi1lbXB0eSBzdHJpbmcgb2YgYXQgbW9zdCAyNTUgY2hhcmFjdGVyc1wiKVxuICB9XG5cbiAgLyoqXG4gICAqIEJ1aWxkcyBhIGJvdW5kZWQgYWR2aXNvcnktbG9jayBuYW1lIGZvciBvbmUgc3RhYmxlIHNjaGVkdWxlIGtleS5cbiAgICogQHBhcmFtIHtzdHJpbmd9IHNjaGVkdWxlS2V5IC0gVmFsaWRhdGVkIHN0YWJsZSBzY2hlZHVsZSBrZXkuXG4gICAqIEByZXR1cm5zIHtzdHJpbmd9IC0gQWR2aXNvcnktbG9jayBuYW1lLlxuICAgKi9cbiAgX3NjaGVkdWxlS2V5TG9ja05hbWUoc2NoZWR1bGVLZXkpIHtcbiAgICBjb25zdCBoYXNoID0gY3JlYXRlSGFzaChcInNoYTI1NlwiKS51cGRhdGUoc2NoZWR1bGVLZXkpLmRpZ2VzdChcImhleFwiKS5zbGljZSgwLCAzMilcblxuICAgIHJldHVybiBgYmFja2dyb3VuZC1qb2JzOnNjaGVkdWxlOiR7aGFzaH1gXG4gIH1cblxuICAvKipcbiAgICogRW5zdXJlcyB0aGUgYmFja2dyb3VuZC1qb2JzIHNjaGVtYSBleGlzdHMsIHJldXNpbmcgYSBjYWxsZXItaGVsZCBjb25uZWN0aW9uIHdoZW5cbiAgICogb25lIGlzIGdpdmVuIHJhdGhlciB0aGFuIGNoZWNraW5nIG91dCBpdHMgb3duLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL2RhdGFiYXNlL2RyaXZlcnMvYmFzZS5qc1wiKS5kZWZhdWx0fSBbZXhpc3RpbmdEYl0gLSBSZXVzZSBhblxuICAgKiAgIGFscmVhZHktY2hlY2tlZC1vdXQgY29ubmVjdGlvbiAoZS5nLiB0aGUgb25lIGBkYjptaWdyYXRlYCBob2xkcykgaW5zdGVhZCBvZlxuICAgKiAgIGNoZWNraW5nIG91dCBhIG5lc3RlZCBvbmUg4oCUIHRoZSBuZXN0ZWQgY2hlY2tvdXQgd291bGQgZGVhZGxvY2sgYSBkYXRhYmFzZVxuICAgKiAgIHdob3NlIHBvb2wgaXMgY2FwcGVkIGF0IGEgc2luZ2xlIGNvbm5lY3Rpb24gYWxyZWFkeSBoZWxkIGJ5IHRoZSBjYWxsZXIuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIHdoZW4gdGhlIHNjaGVtYSBpcyBwcmVzZW50LlxuICAgKi9cbiAgYXN5bmMgX2Vuc3VyZVNjaGVtYShleGlzdGluZ0RiKSB7XG4gICAgYXdhaXQgdGhpcy5fYXBwbHlTY2hlbWEoZXhpc3RpbmdEYilcbiAgfVxuXG4gIC8qKlxuICAgKiBTZXJpYWxpemVzIGNyZWF0aW9uIG9yIHVwZ3JhZGUgb2YgdGhlIGJhY2tncm91bmQtam9icyBzY2hlbWEsIGNoZWNraW5nIG91dCBhXG4gICAqIGNvbm5lY3Rpb24gb25seSBhZnRlciBlYXJsaWVyIHNjaGVtYSB3b3JrIGhhcyBjb21wbGV0ZWQgd2hlbiBvbmUgaXMgbm90IHN1cHBsaWVkLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL2RhdGFiYXNlL2RyaXZlcnMvYmFzZS5qc1wiKS5kZWZhdWx0fSBbZXhpc3RpbmdEYl0gLSBDYWxsZXItb3duZWRcbiAgICogICBkYXRhYmFzZSBjb25uZWN0aW9uLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyB3aGVuIHRoZSBzY2hlbWEgaXMgcHJlc2VudC5cbiAgICovXG4gIGFzeW5jIF9hcHBseVNjaGVtYShleGlzdGluZ0RiKSB7XG4gICAgLy8gU2VyaWFsaXplIGNvbmN1cnJlbnQgc2NoZW1hIGFwcGxpZXMgd2l0aGluIHRoaXMgcHJvY2Vzcywga2V5ZWQgYnkgZGF0YWJhc2VcbiAgICAvLyBpZGVudGlmaWVyIChzZWUgYHNjaGVtYUFwcGx5Q2hhaW5zYCkuIFRoZSBwZXItc3RlcCBsb2NrcyBpbnNpZGUgdGhlIHN0ZXBzIHVzZVxuICAgIC8vIERJRkZFUkVOVCBsb2NrIG5hbWVzLCBzbyB0d28gY29uY3VycmVudCBjYWxsZXJzIGNvdWxkIG90aGVyd2lzZSBlYWNoIGhvbGQgYVxuICAgIC8vIGRpZmZlcmVudCBzdGVwIGxvY2sgd2hpbGUgYm90aCByZWJ1aWxkIHRoZSBqb2JzIHRhYmxlIOKAlCBhbmQgb24gU1FMaXRlL01TU1FMIGFuXG4gICAgLy8gYWRkLWNvbHVtbiBpcyBhIGNyZWF0ZS1jb3B5LWRyb3AtcmVuYW1lIHJlYnVpbGQsIHNvIG92ZXJsYXBwaW5nIHJlYnVpbGRzXG4gICAgLy8gY29ycnVwdCBpdC4gVGhpcyBtdXRleCBtYWtlcyB0aGUgd2hvbGUgYXBwbHkgbXV0dWFsbHkgZXhjbHVzaXZlIHBlciBwcm9jZXNzO1xuICAgIC8vIHRoZSBzZWNvbmQgY2FsbGVyIHRoZW4gcmUtY2hlY2tzIGFuZCBmaW5kcyBldmVyeSBzdGVwIGFscmVhZHkgZG9uZS5cbiAgICBjb25zdCBpZGVudGlmaWVyID0gdGhpcy5nZXREYXRhYmFzZUlkZW50aWZpZXIoKSA/PyBcImRlZmF1bHRcIlxuICAgIGNvbnN0IHByZXZpb3VzID0gc2NoZW1hQXBwbHlDaGFpbnMuZ2V0KGlkZW50aWZpZXIpID8/IFByb21pc2UucmVzb2x2ZSgpXG4gICAgY29uc3QgYXBwbHlXaXRoQ29ubmVjdGlvbiA9IGFzeW5jICgpID0+IHtcbiAgICAgIGlmIChleGlzdGluZ0RiKSB7XG4gICAgICAgIGF3YWl0IHRoaXMuX2FwcGx5U2NoZW1hU3RlcHMoZXhpc3RpbmdEYilcblxuICAgICAgICByZXR1cm5cbiAgICAgIH1cblxuICAgICAgYXdhaXQgdGhpcy5fd2l0aERiKChkYikgPT4gdGhpcy5fYXBwbHlTY2hlbWFTdGVwcyhkYikpXG4gICAgfVxuICAgIGNvbnN0IHJ1biA9IHByZXZpb3VzLnRoZW4oYXBwbHlXaXRoQ29ubmVjdGlvbiwgYXBwbHlXaXRoQ29ubmVjdGlvbilcblxuICAgIC8vIEtlZXAgdGhlIGNoYWluIGFsaXZlIHJlZ2FyZGxlc3Mgb2YgdGhpcyBydW4ncyBvdXRjb21lIHNvIG9uZSBmYWlsZWQgYXBwbHkgZG9lc1xuICAgIC8vIG5vdCB3ZWRnZSBsYXRlciBjYWxsZXJzOyB0aGlzIHJ1biBzdGlsbCBwcm9wYWdhdGVzIGl0cyBvd24gcmVzdWx0L2Vycm9yLlxuICAgIHNjaGVtYUFwcGx5Q2hhaW5zLnNldChpZGVudGlmaWVyLCBydW4udGhlbigoKSA9PiB7fSwgKCkgPT4ge30pKVxuXG4gICAgcmV0dXJuIGF3YWl0IHJ1blxuICB9XG5cbiAgLyoqXG4gICAqIENyZWF0ZXMgb3IgdXBncmFkZXMgdGhlIGJhY2tncm91bmQtam9icyB0YWJsZXMsIGNvbHVtbnMgYW5kIGNvbmN1cnJlbmN5IHJvd3Mgb25cbiAgICogdGhlIGdpdmVuIGNvbm5lY3Rpb24uIFNlcmlhbGl6ZWQgcGVyIHByb2Nlc3MgYnkge0BsaW5rIEJhY2tncm91bmRKb2JzU3RvcmUjX2FwcGx5U2NoZW1hfS5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9kYXRhYmFzZS9kcml2ZXJzL2Jhc2UuanNcIikuZGVmYXVsdH0gZGIgLSBEYXRhYmFzZSBjb25uZWN0aW9uLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyB3aGVuIHRoZSBzY2hlbWEgaXMgcHJlc2VudC5cbiAgICovXG4gIGFzeW5jIF9hcHBseVNjaGVtYVN0ZXBzKGRiKSB7XG4gICAgYXdhaXQgdGhpcy5fZW5zdXJlTWlncmF0aW9uc1RhYmxlKGRiKVxuXG4gICAgY29uc3QgYWxyZWFkeUFwcGxpZWQgPSBhd2FpdCB0aGlzLl9oYXNNaWdyYXRpb24oZGIpXG4gICAgY29uc3Qgc2NoZW1hUmVjb3ZlcnlQZW5kaW5nID0gYXdhaXQgdGhpcy5faGFzTWlncmF0aW9uKGRiLCBTQ0hFTUFfUkVDT1ZFUllfUEVORElOR19WRVJTSU9OKVxuICAgIGNvbnN0IGpvYnNUYWJsZUV4aXN0cyA9IGF3YWl0IGRiLnRhYmxlRXhpc3RzKEpPQlNfVEFCTEUpXG5cbiAgICAvLyBFdmVuIHdoZW4gdGhlIG1pZ3JhdGlvbiByb3cgaXMgcHJlc2VudCwgdGhlIGpvYnMgdGFibGUgaXRzZWxmIGNhbiBoYXZlXG4gICAgLy8gYmVlbiBkcm9wcGVkIHVuZGVybmVhdGggdXMgYnkgYSB0cmFuc2FjdGlvbiByb2xsYmFjayBpbiBhbm90aGVyIGNhbGxlclxuICAgIC8vIChEREwgaXMgdHJhbnNhY3Rpb25hbCBvbiBTUUxpdGUvTVNTUUwpLiBWZXJpZnkgdGhlIHRhYmxlIHBoeXNpY2FsbHlcbiAgICAvLyBleGlzdHMgYW5kIHJlY3JlYXRlIGl0IHdoZW4gbWlzc2luZyByYXRoZXIgdGhhbiB0cnVzdGluZyB0aGUgbWlncmF0aW9uXG4gICAgLy8gcm93IGFsb25lLCBvdGhlcndpc2UgbGF0ZXIgY2FsbGVycyBmYWlsIHdpdGggXCJubyBzdWNoIHRhYmxlXCIuXG4gICAgaWYgKGFscmVhZHlBcHBsaWVkICYmIGpvYnNUYWJsZUV4aXN0cyAmJiAhc2NoZW1hUmVjb3ZlcnlQZW5kaW5nKSB7XG4gICAgICBhd2FpdCB0aGlzLl9lbnN1cmVKb2JzVGFibGVDb2x1bW5zKGRiKVxuICAgICAgYXdhaXQgdGhpcy5fZW5zdXJlSWRlbXBvdGVuY3lLZXlzVGFibGUoZGIpXG4gICAgICBhd2FpdCB0aGlzLl9lbnN1cmVNYWlsRGVsaXZlcnlPcGVyYXRpb25zVGFibGUoZGIpXG4gICAgICBhd2FpdCB0aGlzLl9lbnN1cmVTY2hlZHVsZUtleXNUYWJsZShkYilcbiAgICAgIGF3YWl0IHRoaXMuX2Vuc3VyZUNvbmN1cnJlbmN5VGFibGUoZGIpXG4gICAgICBhd2FpdCB0aGlzLl9lbnN1cmVDb3VudFJldmlzaW9uVGFibGUoZGIpXG5cbiAgICAgIHJldHVyblxuICAgIH1cblxuICAgIGlmIChhbHJlYWR5QXBwbGllZCAmJiAhc2NoZW1hUmVjb3ZlcnlQZW5kaW5nKSB7XG4gICAgICBhd2FpdCB0aGlzLl9yZWNvcmRNaWdyYXRpb24oZGIsIFNDSEVNQV9SRUNPVkVSWV9QRU5ESU5HX1ZFUlNJT04pXG4gICAgfVxuXG4gICAgYXdhaXQgdGhpcy5fYXBwbHlNaWdyYXRpb25zKGRiKVxuICAgIGF3YWl0IHRoaXMuX2Vuc3VyZUpvYnNUYWJsZUNvbHVtbnMoZGIpXG4gICAgYXdhaXQgdGhpcy5fZW5zdXJlSWRlbXBvdGVuY3lLZXlzVGFibGUoZGIpXG4gICAgYXdhaXQgdGhpcy5fZW5zdXJlTWFpbERlbGl2ZXJ5T3BlcmF0aW9uc1RhYmxlKGRiKVxuICAgIGF3YWl0IHRoaXMuX2Vuc3VyZVNjaGVkdWxlS2V5c1RhYmxlKGRiKVxuICAgIGF3YWl0IHRoaXMuX2Vuc3VyZUNvbmN1cnJlbmN5VGFibGUoZGIpXG4gICAgYXdhaXQgdGhpcy5fZW5zdXJlQ291bnRSZXZpc2lvblRhYmxlKGRiKVxuXG4gICAgaWYgKGFscmVhZHlBcHBsaWVkKSB7XG4gICAgICAvLyBUaGUgcmVjcmVhdGVkIGpvYnMgdGFibGUgaXMgZW1wdHksIGJ1dCB0aGUgc3Vydml2aW5nIGNvbmN1cnJlbmN5IHRhYmxlXG4gICAgICAvLyBjYW4gc3RpbGwgY291bnQgaGFuZG9mZnMgdGhhdCBkaXNhcHBlYXJlZCB3aXRoIHRoZSBkcm9wcGVkIGpvYnMgdGFibGUuXG4gICAgICBhd2FpdCB0aGlzLl9yZWNvbmNpbGVDb25jdXJyZW5jeShkYilcbiAgICAgIGF3YWl0IGRiLmRlbGV0ZSh7XG4gICAgICAgIHRhYmxlTmFtZTogTUlHUkFUSU9OU19UQUJMRSxcbiAgICAgICAgY29uZGl0aW9uczoge2tleTogdGhpcy5fbWlncmF0aW9uS2V5KFNDSEVNQV9SRUNPVkVSWV9QRU5ESU5HX1ZFUlNJT04pfVxuICAgICAgfSlcblxuICAgICAgcmV0dXJuXG4gICAgfVxuXG4gICAgYXdhaXQgdGhpcy5fcmVjb3JkTWlncmF0aW9uKGRiLCBNSUdSQVRJT05fVkVSU0lPTilcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGVuc3VyZSBtaWdyYXRpb25zIHRhYmxlLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL2RhdGFiYXNlL2RyaXZlcnMvYmFzZS5qc1wiKS5kZWZhdWx0fSBkYiAtIERhdGFiYXNlIGNvbm5lY3Rpb24uXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIHdoZW4gY29tcGxldGUuXG4gICAqL1xuICBhc3luYyBfZW5zdXJlTWlncmF0aW9uc1RhYmxlKGRiKSB7XG4gICAgaWYgKGF3YWl0IGRiLnRhYmxlRXhpc3RzKE1JR1JBVElPTlNfVEFCTEUpKSByZXR1cm5cblxuICAgIGNvbnN0IHRhYmxlID0gbmV3IFRhYmxlRGF0YShNSUdSQVRJT05TX1RBQkxFLCB7aWZOb3RFeGlzdHM6IHRydWV9KVxuXG4gICAgdGFibGUuc3RyaW5nKFwia2V5XCIsIHtudWxsOiBmYWxzZSwgcHJpbWFyeUtleTogdHJ1ZX0pXG4gICAgdGFibGUuc3RyaW5nKFwic2NvcGVcIiwge251bGw6IGZhbHNlfSlcbiAgICB0YWJsZS5zdHJpbmcoXCJ2ZXJzaW9uXCIsIHtudWxsOiBmYWxzZX0pXG4gICAgdGFibGUuYmlnaW50KFwiYXBwbGllZF9hdF9tc1wiLCB7bnVsbDogZmFsc2V9KVxuXG4gICAgYXdhaXQgZGIuY3JlYXRlVGFibGUodGFibGUpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBoYXMgbWlncmF0aW9uLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL2RhdGFiYXNlL2RyaXZlcnMvYmFzZS5qc1wiKS5kZWZhdWx0fSBkYiAtIERhdGFiYXNlIGNvbm5lY3Rpb24uXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBbdmVyc2lvbl0gLSBNaWdyYXRpb24gdmVyc2lvbi5cbiAgICogQHJldHVybnMge1Byb21pc2U8Ym9vbGVhbj59IC0gV2hldGhlciBtaWdyYXRpb24gZXhpc3RzLlxuICAgKi9cbiAgYXN5bmMgX2hhc01pZ3JhdGlvbihkYiwgdmVyc2lvbiA9IE1JR1JBVElPTl9WRVJTSU9OKSB7XG4gICAgY29uc3QgcXVlcnkgPSBkYlxuICAgICAgLm5ld1F1ZXJ5KClcbiAgICAgIC5mcm9tKE1JR1JBVElPTlNfVEFCTEUpXG4gICAgICAud2hlcmUoe2tleTogdGhpcy5fbWlncmF0aW9uS2V5KHZlcnNpb24pfSlcbiAgICAgIC5saW1pdCgxKVxuXG4gICAgY29uc3Qgcm93cyA9IGF3YWl0IHF1ZXJ5LnJlc3VsdHMoKVxuXG4gICAgcmV0dXJuIHJvd3MubGVuZ3RoID4gMFxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgYXBwbHkgbWlncmF0aW9ucy5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9kYXRhYmFzZS9kcml2ZXJzL2Jhc2UuanNcIikuZGVmYXVsdH0gZGIgLSBEYXRhYmFzZSBjb25uZWN0aW9uLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyB3aGVuIGNvbXBsZXRlLlxuICAgKi9cbiAgYXN5bmMgX2FwcGx5TWlncmF0aW9ucyhkYikge1xuICAgIHRoaXMubG9nZ2VyLmluZm8oXCJBcHBseWluZyBiYWNrZ3JvdW5kIGpvYnMgc2NoZW1hXCIpXG5cbiAgICBpZiAoYXdhaXQgZGIudGFibGVFeGlzdHMoSk9CU19UQUJMRSkpIHtcbiAgICAgIHRoaXMubG9nZ2VyLmluZm8oXCJCYWNrZ3JvdW5kIGpvYnMgdGFibGUgYWxyZWFkeSBleGlzdHMgLSBza2lwcGluZyBjcmVhdGVcIilcbiAgICAgIHJldHVyblxuICAgIH1cblxuICAgIGNvbnN0IHRhYmxlID0gbmV3IFRhYmxlRGF0YShKT0JTX1RBQkxFLCB7aWZOb3RFeGlzdHM6IHRydWV9KVxuXG4gICAgdGFibGUuc3RyaW5nKFwiaWRcIiwge3ByaW1hcnlLZXk6IHRydWV9KVxuICAgIHRhYmxlLnN0cmluZyhcImpvYl9uYW1lXCIsIHtudWxsOiBmYWxzZSwgaW5kZXg6IHRydWV9KVxuICAgIHRhYmxlLnRleHQoXCJhcmdzX2pzb25cIiwge251bGw6IGZhbHNlfSlcbiAgICB0YWJsZS5zdHJpbmcoXCJleGVjdXRpb25fbW9kZVwiLCB7bnVsbDogZmFsc2V9KVxuICAgIHRhYmxlLnN0cmluZyhcInF1ZXVlXCIsIHtudWxsOiB0cnVlLCBpbmRleDogdHJ1ZX0pXG4gICAgdGFibGUuaW50ZWdlcihcIm1heF9yZXRyaWVzXCIsIHtudWxsOiBmYWxzZX0pXG4gICAgdGFibGUuaW50ZWdlcihcImF0dGVtcHRzXCIsIHtudWxsOiBmYWxzZX0pXG4gICAgdGFibGUuc3RyaW5nKFwic3RhdHVzXCIsIHtudWxsOiBmYWxzZSwgaW5kZXg6IHRydWV9KVxuICAgIHRhYmxlLmJpZ2ludChcInNjaGVkdWxlZF9hdF9tc1wiLCB7bnVsbDogZmFsc2UsIGluZGV4OiB0cnVlfSlcbiAgICB0YWJsZS5iaWdpbnQoXCJjcmVhdGVkX2F0X21zXCIsIHtudWxsOiBmYWxzZSwgaW5kZXg6IHRydWV9KVxuICAgIHRhYmxlLnN0cmluZyhcInNjaGVkdWxlX2tleVwiLCB7bnVsbDogdHJ1ZSwgaW5kZXg6IHRydWV9KVxuICAgIHRhYmxlLmJpZ2ludChcImhhbmRlZF9vZmZfYXRfbXNcIiwge251bGw6IHRydWUsIGluZGV4OiB0cnVlfSlcbiAgICB0YWJsZS5zdHJpbmcoXCJoYW5kb2ZmX2lkXCIsIHtudWxsOiB0cnVlfSlcbiAgICB0YWJsZS5iaWdpbnQoXCJjb21wbGV0ZWRfYXRfbXNcIiwge251bGw6IHRydWV9KVxuICAgIHRhYmxlLmJpZ2ludChcImZhaWxlZF9hdF9tc1wiLCB7bnVsbDogdHJ1ZX0pXG4gICAgdGFibGUuYmlnaW50KFwib3JwaGFuZWRfYXRfbXNcIiwge251bGw6IHRydWUsIGluZGV4OiB0cnVlfSlcbiAgICB0YWJsZS5zdHJpbmcoXCJ3b3JrZXJfaWRcIiwge251bGw6IHRydWV9KVxuICAgIHRhYmxlLnRleHQoXCJsYXN0X2Vycm9yXCIsIHtudWxsOiB0cnVlfSlcbiAgICB0YWJsZS5zdHJpbmcoXCJjb25jdXJyZW5jeV9rZXlcIiwge251bGw6IHRydWUsIGluZGV4OiB0cnVlfSlcbiAgICB0YWJsZS5pbnRlZ2VyKFwibWF4X2NvbmN1cnJlbmN5XCIsIHtudWxsOiB0cnVlfSlcbiAgICB0YWJsZS5iaWdpbnQoXCJ0aW1lb3V0X21zXCIsIHtudWxsOiB0cnVlfSlcblxuICAgIGF3YWl0IGRiLmNyZWF0ZVRhYmxlKHRhYmxlKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZW5zdXJlIGpvYnMgdGFibGUgY29sdW1ucy5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9kYXRhYmFzZS9kcml2ZXJzL2Jhc2UuanNcIikuZGVmYXVsdH0gZGIgLSBEYXRhYmFzZSBjb25uZWN0aW9uLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyB3aGVuIGNvbXBsZXRlLlxuICAgKi9cbiAgYXN5bmMgX2Vuc3VyZUpvYnNUYWJsZUNvbHVtbnMoZGIpIHtcbiAgICBpZiAoIShhd2FpdCBkYi50YWJsZUV4aXN0cyhKT0JTX1RBQkxFKSkpIHJldHVyblxuXG4gICAgY29uc3QgdGFibGUgPSBhd2FpdCBkYi5nZXRUYWJsZUJ5TmFtZU9yRmFpbChKT0JTX1RBQkxFKVxuICAgIGNvbnN0IGV4ZWN1dGlvbk1vZGVDb2x1bW4gPSBhd2FpdCB0YWJsZS5nZXRDb2x1bW5CeU5hbWUoXCJleGVjdXRpb25fbW9kZVwiKVxuXG4gICAgaWYgKCFleGVjdXRpb25Nb2RlQ29sdW1uKSB7XG4gICAgICBjb25zdCB0YWJsZURhdGEgPSBuZXcgVGFibGVEYXRhKEpPQlNfVEFCTEUpXG4gICAgICB0YWJsZURhdGEuc3RyaW5nKFwiZXhlY3V0aW9uX21vZGVcIiwge251bGw6IHRydWV9KVxuICAgICAgY29uc3Qgc3FscyA9IGF3YWl0IGRiLmFsdGVyVGFibGVTUUxzKHRhYmxlRGF0YSlcblxuICAgICAgZm9yIChjb25zdCBzcWwgb2Ygc3Fscykge1xuICAgICAgICBhd2FpdCBkYi5xdWVyeShzcWwpXG4gICAgICB9XG5cbiAgICAgIGRiLmNsZWFyU2NoZW1hQ2FjaGUoKVxuICAgIH1cblxuICAgIGNvbnN0IHJlZnJlc2hlZFRhYmxlID0gYXdhaXQgZGIuZ2V0VGFibGVCeU5hbWVPckZhaWwoSk9CU19UQUJMRSlcbiAgICBjb25zdCBoYW5kb2ZmSWRDb2x1bW4gPSBhd2FpdCByZWZyZXNoZWRUYWJsZS5nZXRDb2x1bW5CeU5hbWUoXCJoYW5kb2ZmX2lkXCIpXG5cbiAgICBpZiAoIWhhbmRvZmZJZENvbHVtbikge1xuICAgICAgY29uc3QgbG9ja05hbWUgPSBgJHtNSUdSQVRJT05fU0NPUEV9OmhhbmRvZmZfaWRfY29sdW1uYFxuICAgICAgY29uc3QgYWNxdWlyZWQgPSBhd2FpdCBkYi5hY3F1aXJlQWR2aXNvcnlMb2NrKGxvY2tOYW1lKVxuXG4gICAgICBpZiAoIWFjcXVpcmVkKSB0aHJvdyBuZXcgRXJyb3IoXCJGYWlsZWQgdG8gYWNxdWlyZSBiYWNrZ3JvdW5kIGpvYnMgaGFuZG9mZiBzY2hlbWEgbG9ja1wiKVxuXG4gICAgICB0cnkge1xuICAgICAgICBkYi5jbGVhclNjaGVtYUNhY2hlKClcbiAgICAgICAgY29uc3QgbG9ja2VkVGFibGUgPSBhd2FpdCBkYi5nZXRUYWJsZUJ5TmFtZU9yRmFpbChKT0JTX1RBQkxFKVxuXG4gICAgICAgIGlmICghKGF3YWl0IGxvY2tlZFRhYmxlLmdldENvbHVtbkJ5TmFtZShcImhhbmRvZmZfaWRcIikpKSB7XG4gICAgICAgICAgY29uc3QgdGFibGVEYXRhID0gbmV3IFRhYmxlRGF0YShKT0JTX1RBQkxFKVxuICAgICAgICAgIHRhYmxlRGF0YS5zdHJpbmcoXCJoYW5kb2ZmX2lkXCIsIHtudWxsOiB0cnVlfSlcbiAgICAgICAgICBjb25zdCBzcWxzID0gYXdhaXQgZGIuYWx0ZXJUYWJsZVNRTHModGFibGVEYXRhKVxuXG4gICAgICAgICAgZm9yIChjb25zdCBzcWwgb2Ygc3Fscykge1xuICAgICAgICAgICAgYXdhaXQgZGIucXVlcnkoc3FsKVxuICAgICAgICAgIH1cblxuICAgICAgICAgIGRiLmNsZWFyU2NoZW1hQ2FjaGUoKVxuICAgICAgICB9XG4gICAgICB9IGZpbmFsbHkge1xuICAgICAgICBhd2FpdCBkYi5yZWxlYXNlQWR2aXNvcnlMb2NrKGxvY2tOYW1lKVxuICAgICAgfVxuICAgIH1cblxuICAgIGF3YWl0IHRoaXMuX2JhY2tmaWxsRXhlY3V0aW9uTW9kZXNPbmNlKGRiKVxuICAgIGF3YWl0IHRoaXMuX2Ryb3BGb3JrZWRDb2x1bW5PbmNlKGRiKVxuXG4gICAgY29uc3QgbG9ja05hbWUgPSBgJHtNSUdSQVRJT05fU0NPUEV9OmNvbmN1cnJlbmN5X2NvbHVtbnNgXG4gICAgY29uc3QgYWNxdWlyZWQgPSBhd2FpdCBkYi5hY3F1aXJlQWR2aXNvcnlMb2NrKGxvY2tOYW1lKVxuXG4gICAgaWYgKCFhY3F1aXJlZCkgdGhyb3cgbmV3IEVycm9yKFwiRmFpbGVkIHRvIGFjcXVpcmUgYmFja2dyb3VuZCBqb2JzIGNvbmN1cnJlbmN5IHNjaGVtYSBsb2NrXCIpXG5cbiAgICB0cnkge1xuICAgICAgLy8gU1FMIFNlcnZlciBzY2hlbWEgcmVhZHMgY2FuIGRlYWRsb2NrIHdpdGggYSBjb25jdXJyZW50IEFMVEVSIFRBQkxFLCBzb1xuICAgICAgLy8gYWNxdWlyZSB0aGUgbG9jayBiZWZvcmUgaW5zcGVjdGluZyBlaXRoZXIgY29sdW1uIHJhdGhlciB0aGFuIG9ubHlcbiAgICAgIC8vIHByb3RlY3RpbmcgdGhlIG11dGF0aW9uLlxuICAgICAgZGIuY2xlYXJTY2hlbWFDYWNoZSgpXG4gICAgICBjb25zdCBsb2NrZWRUYWJsZSA9IGF3YWl0IGRiLmdldFRhYmxlQnlOYW1lT3JGYWlsKEpPQlNfVEFCTEUpXG4gICAgICBjb25zdCBjb25jdXJyZW5jeUNvbHVtbk5hbWVzID0gW1wiY29uY3VycmVuY3lfa2V5XCIsIFwibWF4X2NvbmN1cnJlbmN5XCJdXG5cbiAgICAgIGZvciAoY29uc3QgY29uY3VycmVuY3lDb2x1bW5OYW1lIG9mIGNvbmN1cnJlbmN5Q29sdW1uTmFtZXMpIHtcbiAgICAgICAgaWYgKGF3YWl0IGxvY2tlZFRhYmxlLmdldENvbHVtbkJ5TmFtZShjb25jdXJyZW5jeUNvbHVtbk5hbWUpKSBjb250aW51ZVxuXG4gICAgICAgIGNvbnN0IHRhYmxlRGF0YSA9IG5ldyBUYWJsZURhdGEoSk9CU19UQUJMRSlcbiAgICAgICAgaWYgKGNvbmN1cnJlbmN5Q29sdW1uTmFtZSA9PSBcImNvbmN1cnJlbmN5X2tleVwiKSB7XG4gICAgICAgICAgdGFibGVEYXRhLnN0cmluZyhcImNvbmN1cnJlbmN5X2tleVwiLCB7bnVsbDogdHJ1ZSwgaW5kZXg6IHRydWV9KVxuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgIHRhYmxlRGF0YS5pbnRlZ2VyKFwibWF4X2NvbmN1cnJlbmN5XCIsIHtudWxsOiB0cnVlfSlcbiAgICAgICAgfVxuXG4gICAgICAgIGZvciAoY29uc3Qgc3FsIG9mIGF3YWl0IGRiLmFsdGVyVGFibGVTUUxzKHRhYmxlRGF0YSkpIGF3YWl0IGRiLnF1ZXJ5KHNxbClcbiAgICAgIH1cblxuICAgICAgZGIuY2xlYXJTY2hlbWFDYWNoZSgpXG4gICAgfSBmaW5hbGx5IHtcbiAgICAgIGF3YWl0IGRiLnJlbGVhc2VBZHZpc29yeUxvY2sobG9ja05hbWUpXG4gICAgfVxuXG4gICAgYXdhaXQgdGhpcy5fZW5zdXJlUXVldWVDb2x1bW4oZGIpXG4gICAgYXdhaXQgdGhpcy5fZW5zdXJlU2NoZWR1bGVLZXlDb2x1bW4oZGIpXG4gICAgYXdhaXQgdGhpcy5fZW5zdXJlSm9iVGltZW91dENvbHVtbihkYilcbiAgfVxuXG4gIC8qKlxuICAgKiBJZGVtcG90ZW50bHkgYWRkcyB0aGUgcGVyLWpvYiB3YWxsLWNsb2NrIHRpbWVvdXQgdG8gZXhpc3Rpbmcgam9iIHRhYmxlcy5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9kYXRhYmFzZS9kcml2ZXJzL2Jhc2UuanNcIikuZGVmYXVsdH0gZGIgLSBEYXRhYmFzZSBjb25uZWN0aW9uLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyB3aGVuIGVuc3VyZWQuXG4gICAqL1xuICBhc3luYyBfZW5zdXJlSm9iVGltZW91dENvbHVtbihkYikge1xuICAgIGNvbnN0IGxvY2tOYW1lID0gYCR7TUlHUkFUSU9OX1NDT1BFfTp0aW1lb3V0X21zX2NvbHVtbmBcbiAgICBjb25zdCBhY3F1aXJlZCA9IGF3YWl0IGRiLmFjcXVpcmVBZHZpc29yeUxvY2sobG9ja05hbWUpXG5cbiAgICBpZiAoIWFjcXVpcmVkKSB0aHJvdyBuZXcgRXJyb3IoXCJGYWlsZWQgdG8gYWNxdWlyZSBiYWNrZ3JvdW5kIGpvYnMgdGltZW91dCBzY2hlbWEgbG9ja1wiKVxuXG4gICAgdHJ5IHtcbiAgICAgIGRiLmNsZWFyU2NoZW1hQ2FjaGUoKVxuICAgICAgY29uc3QgdGFibGUgPSBhd2FpdCBkYi5nZXRUYWJsZUJ5TmFtZU9yRmFpbChKT0JTX1RBQkxFKVxuXG4gICAgICBpZiAoIShhd2FpdCB0YWJsZS5nZXRDb2x1bW5CeU5hbWUoXCJ0aW1lb3V0X21zXCIpKSkge1xuICAgICAgICBjb25zdCB0YWJsZURhdGEgPSBuZXcgVGFibGVEYXRhKEpPQlNfVEFCTEUpXG4gICAgICAgIHRhYmxlRGF0YS5iaWdpbnQoXCJ0aW1lb3V0X21zXCIsIHtudWxsOiB0cnVlfSlcblxuICAgICAgICBmb3IgKGNvbnN0IHNxbCBvZiBhd2FpdCBkYi5hbHRlclRhYmxlU1FMcyh0YWJsZURhdGEpKSBhd2FpdCBkYi5xdWVyeShzcWwpXG5cbiAgICAgICAgZGIuY2xlYXJTY2hlbWFDYWNoZSgpXG4gICAgICB9XG4gICAgfSBmaW5hbGx5IHtcbiAgICAgIGF3YWl0IGRiLnJlbGVhc2VBZHZpc29yeUxvY2sobG9ja05hbWUpXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIElkZW1wb3RlbnRseSBhZGRzIHRoZSBoaXN0b3JpY2FsIHN0YWJsZSBzY2hlZHVsZSBrZXkgdG8gZXhpc3Rpbmcgam9icy5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9kYXRhYmFzZS9kcml2ZXJzL2Jhc2UuanNcIikuZGVmYXVsdH0gZGIgLSBEYXRhYmFzZSBjb25uZWN0aW9uLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyB3aGVuIGVuc3VyZWQuXG4gICAqL1xuICBhc3luYyBfZW5zdXJlU2NoZWR1bGVLZXlDb2x1bW4oZGIpIHtcbiAgICBjb25zdCBsb2NrTmFtZSA9IGAke01JR1JBVElPTl9TQ09QRX06c2NoZWR1bGVfa2V5X2NvbHVtbmBcbiAgICBjb25zdCBhY3F1aXJlZCA9IGF3YWl0IGRiLmFjcXVpcmVBZHZpc29yeUxvY2sobG9ja05hbWUpXG5cbiAgICBpZiAoIWFjcXVpcmVkKSB0aHJvdyBuZXcgRXJyb3IoXCJGYWlsZWQgdG8gYWNxdWlyZSBiYWNrZ3JvdW5kIGpvYnMgc2NoZWR1bGUta2V5IHNjaGVtYSBsb2NrXCIpXG5cbiAgICB0cnkge1xuICAgICAgZGIuY2xlYXJTY2hlbWFDYWNoZSgpXG4gICAgICBjb25zdCBsb2NrZWRUYWJsZSA9IGF3YWl0IGRiLmdldFRhYmxlQnlOYW1lT3JGYWlsKEpPQlNfVEFCTEUpXG5cbiAgICAgIGlmICghKGF3YWl0IGxvY2tlZFRhYmxlLmdldENvbHVtbkJ5TmFtZShcInNjaGVkdWxlX2tleVwiKSkpIHtcbiAgICAgICAgY29uc3QgdGFibGVEYXRhID0gbmV3IFRhYmxlRGF0YShKT0JTX1RBQkxFKVxuXG4gICAgICAgIHRhYmxlRGF0YS5zdHJpbmcoXCJzY2hlZHVsZV9rZXlcIiwge251bGw6IHRydWUsIGluZGV4OiB0cnVlfSlcblxuICAgICAgICBmb3IgKGNvbnN0IHNxbCBvZiBhd2FpdCBkYi5hbHRlclRhYmxlU1FMcyh0YWJsZURhdGEpKSBhd2FpdCBkYi5xdWVyeShzcWwpXG5cbiAgICAgICAgZGIuY2xlYXJTY2hlbWFDYWNoZSgpXG4gICAgICB9XG4gICAgfSBmaW5hbGx5IHtcbiAgICAgIGF3YWl0IGRiLnJlbGVhc2VBZHZpc29yeUxvY2sobG9ja05hbWUpXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIElkZW1wb3RlbnRseSBhZGRzIHRoZSBgcXVldWVgIGNvbHVtbiB0byBhbiBleGlzdGluZyBqb2JzIHRhYmxlLiBFeGlzdGluZ1xuICAgKiByb3dzIHJlYWQgYmFjayBhcyB0aGUgZGVmYXVsdCBxdWV1ZSAoc2VlIHtAbGluayBfbm9ybWFsaXplSm9iUm93fSksIHNvIG5vXG4gICAqIGRhdGEgYmFja2ZpbGwgaXMgcmVxdWlyZWQuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vZGF0YWJhc2UvZHJpdmVycy9iYXNlLmpzXCIpLmRlZmF1bHR9IGRiIC0gRGF0YWJhc2UgY29ubmVjdGlvbi5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgd2hlbiBlbnN1cmVkLlxuICAgKi9cbiAgYXN5bmMgX2Vuc3VyZVF1ZXVlQ29sdW1uKGRiKSB7XG4gICAgY29uc3QgbG9ja05hbWUgPSBgJHtNSUdSQVRJT05fU0NPUEV9OnF1ZXVlX2NvbHVtbmBcbiAgICBjb25zdCBhY3F1aXJlZCA9IGF3YWl0IGRiLmFjcXVpcmVBZHZpc29yeUxvY2sobG9ja05hbWUpXG5cbiAgICBpZiAoIWFjcXVpcmVkKSB0aHJvdyBuZXcgRXJyb3IoXCJGYWlsZWQgdG8gYWNxdWlyZSBiYWNrZ3JvdW5kIGpvYnMgcXVldWUgc2NoZW1hIGxvY2tcIilcblxuICAgIHRyeSB7XG4gICAgICAvLyBTUUwgU2VydmVyIHNjaGVtYSByZWFkcyBjYW4gZGVhZGxvY2sgd2l0aCBhIGNvbmN1cnJlbnQgQUxURVIgVEFCTEUsIHNvXG4gICAgICAvLyBhY3F1aXJlIHRoZSBsb2NrIGJlZm9yZSBpbnNwZWN0aW5nIHRoZSBjb2x1bW4gcmF0aGVyIHRoYW4gb25seVxuICAgICAgLy8gcHJvdGVjdGluZyB0aGUgbXV0YXRpb24gKG1pcnJvcnMgdGhlIGNvbmN1cnJlbmN5LWNvbHVtbiBtaWdyYXRpb24pLlxuICAgICAgZGIuY2xlYXJTY2hlbWFDYWNoZSgpXG4gICAgICBjb25zdCBsb2NrZWRUYWJsZSA9IGF3YWl0IGRiLmdldFRhYmxlQnlOYW1lT3JGYWlsKEpPQlNfVEFCTEUpXG5cbiAgICAgIGlmICghKGF3YWl0IGxvY2tlZFRhYmxlLmdldENvbHVtbkJ5TmFtZShcInF1ZXVlXCIpKSkge1xuICAgICAgICBjb25zdCB0YWJsZURhdGEgPSBuZXcgVGFibGVEYXRhKEpPQlNfVEFCTEUpXG5cbiAgICAgICAgdGFibGVEYXRhLnN0cmluZyhcInF1ZXVlXCIsIHtudWxsOiB0cnVlLCBpbmRleDogdHJ1ZX0pXG5cbiAgICAgICAgZm9yIChjb25zdCBzcWwgb2YgYXdhaXQgZGIuYWx0ZXJUYWJsZVNRTHModGFibGVEYXRhKSkgYXdhaXQgZGIucXVlcnkoc3FsKVxuXG4gICAgICAgIGRiLmNsZWFyU2NoZW1hQ2FjaGUoKVxuICAgICAgfVxuICAgIH0gZmluYWxseSB7XG4gICAgICBhd2FpdCBkYi5yZWxlYXNlQWR2aXNvcnlMb2NrKGxvY2tOYW1lKVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGJhY2tmaWxsIGV4ZWN1dGlvbiBtb2RlcyBvbmNlLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL2RhdGFiYXNlL2RyaXZlcnMvYmFzZS5qc1wiKS5kZWZhdWx0fSBkYiAtIERhdGFiYXNlIGNvbm5lY3Rpb24uXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIHdoZW4gY29tcGxldGUuXG4gICAqL1xuICBhc3luYyBfYmFja2ZpbGxFeGVjdXRpb25Nb2Rlc09uY2UoZGIpIHtcbiAgICBjb25zdCBtaWdyYXRpb25WZXJzaW9uID0gRVhFQ1VUSU9OX01PREVfQkFDS0ZJTExfTUlHUkFUSU9OX1ZFUlNJT05cbiAgICBjb25zdCBtaWdyYXRpb25LZXkgPSB0aGlzLl9taWdyYXRpb25LZXkobWlncmF0aW9uVmVyc2lvbilcblxuICAgIGlmIChhd2FpdCB0aGlzLl9oYXNNaWdyYXRpb24oZGIsIG1pZ3JhdGlvblZlcnNpb24pKSByZXR1cm5cblxuICAgIGF3YWl0IGRiLmFjcXVpcmVBZHZpc29yeUxvY2sobWlncmF0aW9uS2V5KVxuXG4gICAgdHJ5IHtcbiAgICAgIGlmIChhd2FpdCB0aGlzLl9oYXNNaWdyYXRpb24oZGIsIG1pZ3JhdGlvblZlcnNpb24pKSByZXR1cm5cblxuICAgICAgLy8gQSB0YWJsZSBjcmVhdGVkIGFmdGVyIHRoZSBgZm9ya2VkYCBjb2x1bW4gd2FzIGRyb3BwZWQgaGFzIG5vdGhpbmcgdG9cbiAgICAgIC8vIGJhY2tmaWxsIGZyb207IHJlY29yZCB0aGUgbWlncmF0aW9uIHNvIGl0IGlzIG5vdCByZS1hdHRlbXB0ZWQuXG4gICAgICBkYi5jbGVhclNjaGVtYUNhY2hlKClcbiAgICAgIGlmICghKGF3YWl0IChhd2FpdCBkYi5nZXRUYWJsZUJ5TmFtZU9yRmFpbChKT0JTX1RBQkxFKSkuZ2V0Q29sdW1uQnlOYW1lKFwiZm9ya2VkXCIpKSkge1xuICAgICAgICBhd2FpdCB0aGlzLl9yZWNvcmRNaWdyYXRpb24oZGIsIG1pZ3JhdGlvblZlcnNpb24pXG4gICAgICAgIHJldHVyblxuICAgICAgfVxuXG4gICAgICBjb25zdCB0YWJsZU5hbWVTcWwgPSBkYi5xdW90ZVRhYmxlKEpPQlNfVEFCTEUpXG4gICAgICBjb25zdCBmb3JrZWRDb2x1bW5TcWwgPSBkYi5xdW90ZUNvbHVtbihcImZvcmtlZFwiKVxuICAgICAgY29uc3QgZXhlY3V0aW9uTW9kZUNvbHVtblNxbCA9IGRiLnF1b3RlQ29sdW1uKFwiZXhlY3V0aW9uX21vZGVcIilcblxuICAgICAgYXdhaXQgZGIucXVlcnkoXG4gICAgICAgIGBVUERBVEUgJHt0YWJsZU5hbWVTcWx9IFNFVCAke2V4ZWN1dGlvbk1vZGVDb2x1bW5TcWx9ID0gJHtkYi5xdW90ZShcImZvcmtlZFwiKX0gYCArXG4gICAgICAgIGBXSEVSRSAke2ZvcmtlZENvbHVtblNxbH0gPSAke2RiLnF1b3RlKHRydWUpfSBBTkQgJHtleGVjdXRpb25Nb2RlQ29sdW1uU3FsfSBJUyBOVUxMYFxuICAgICAgKVxuICAgICAgYXdhaXQgZGIucXVlcnkoXG4gICAgICAgIGBVUERBVEUgJHt0YWJsZU5hbWVTcWx9IFNFVCAke2V4ZWN1dGlvbk1vZGVDb2x1bW5TcWx9ID0gJHtkYi5xdW90ZShcImlubGluZVwiKX0gYCArXG4gICAgICAgIGBXSEVSRSAke2ZvcmtlZENvbHVtblNxbH0gPSAke2RiLnF1b3RlKGZhbHNlKX0gQU5EICR7ZXhlY3V0aW9uTW9kZUNvbHVtblNxbH0gSVMgTlVMTGBcbiAgICAgIClcblxuICAgICAgYXdhaXQgdGhpcy5fcmVjb3JkTWlncmF0aW9uKGRiLCBtaWdyYXRpb25WZXJzaW9uKVxuICAgIH0gZmluYWxseSB7XG4gICAgICBhd2FpdCBkYi5yZWxlYXNlQWR2aXNvcnlMb2NrKG1pZ3JhdGlvbktleSlcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogUmV3cml0ZXMgcHJlLWV4aXN0aW5nIHBvb2xlZCByb3dzIChwZXJzaXN0ZWQgYXMgYGV4ZWN1dGlvbl9tb2RlID0gXCJmb3JrZWRcImBcbiAgICogcGx1cyBhIGB2ZWxvY2lvdXMtcG9vbGVkOipgIGhhbmRvZmYgbWFya2VyKSB0byBgZXhlY3V0aW9uX21vZGUgPSBcInBvb2xlZFwiYCxcbiAgICogY2xlYXJzIHRoZSBxdWV1ZWQgbWFya2VyLCB0aGVuIGRyb3BzIHRoZSBub3ctcmVkdW5kYW50IGBmb3JrZWRgIGNvbHVtbiBzb1xuICAgKiBgZXhlY3V0aW9uX21vZGVgIGlzIHRoZSBzaW5nbGUgc291cmNlIG9mIHRydXRoLiBSdW5zIG9uY2UsIGd1YXJkZWQgYnkgdGhlXG4gICAqIG1pZ3JhdGlvbiBsZWRnZXIgYW5kIGEgcGVyLWtleSBhZHZpc29yeSBsb2NrOyBhIGZyZXNoIHRhYmxlIChjcmVhdGVkIHdpdGhvdXRcbiAgICogdGhlIGNvbHVtbikgc2hvcnQtY2lyY3VpdHMuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vZGF0YWJhc2UvZHJpdmVycy9iYXNlLmpzXCIpLmRlZmF1bHR9IGRiIC0gRGF0YWJhc2UgY29ubmVjdGlvbi5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgd2hlbiBjb21wbGV0ZS5cbiAgICovXG4gIGFzeW5jIF9kcm9wRm9ya2VkQ29sdW1uT25jZShkYikge1xuICAgIGNvbnN0IG1pZ3JhdGlvblZlcnNpb24gPSBEUk9QX0ZPUktFRF9DT0xVTU5fTUlHUkFUSU9OX1ZFUlNJT05cbiAgICBjb25zdCBtaWdyYXRpb25LZXkgPSB0aGlzLl9taWdyYXRpb25LZXkobWlncmF0aW9uVmVyc2lvbilcblxuICAgIGlmIChhd2FpdCB0aGlzLl9oYXNNaWdyYXRpb24oZGIsIG1pZ3JhdGlvblZlcnNpb24pKSByZXR1cm5cblxuICAgIGF3YWl0IGRiLmFjcXVpcmVBZHZpc29yeUxvY2sobWlncmF0aW9uS2V5KVxuXG4gICAgdHJ5IHtcbiAgICAgIGlmIChhd2FpdCB0aGlzLl9oYXNNaWdyYXRpb24oZGIsIG1pZ3JhdGlvblZlcnNpb24pKSByZXR1cm5cblxuICAgICAgZGIuY2xlYXJTY2hlbWFDYWNoZSgpXG5cbiAgICAgIGlmIChhd2FpdCAoYXdhaXQgZGIuZ2V0VGFibGVCeU5hbWVPckZhaWwoSk9CU19UQUJMRSkpLmdldENvbHVtbkJ5TmFtZShcImZvcmtlZFwiKSkge1xuICAgICAgICBjb25zdCB0YWJsZU5hbWVTcWwgPSBkYi5xdW90ZVRhYmxlKEpPQlNfVEFCTEUpXG4gICAgICAgIGNvbnN0IGV4ZWN1dGlvbk1vZGVDb2x1bW5TcWwgPSBkYi5xdW90ZUNvbHVtbihcImV4ZWN1dGlvbl9tb2RlXCIpXG4gICAgICAgIGNvbnN0IGhhbmRvZmZJZENvbHVtblNxbCA9IGRiLnF1b3RlQ29sdW1uKFwiaGFuZG9mZl9pZFwiKVxuXG4gICAgICAgIC8vIFBvb2xlZCByb3dzIHVzZWQgdG8gcGVyc2lzdCBhcyBleGVjdXRpb25fbW9kZSBcImZvcmtlZFwiICsgYSBwb29sZWQgaGFuZG9mZlxuICAgICAgICAvLyBtYXJrZXI7IHJlY292ZXIgdGhlaXIgcmVhbCBtb2RlIGJlZm9yZSB0aGUgbWFya2VyIGlzIGNsZWFyZWQuXG4gICAgICAgIGF3YWl0IGRiLnF1ZXJ5KFxuICAgICAgICAgIGBVUERBVEUgJHt0YWJsZU5hbWVTcWx9IFNFVCAke2V4ZWN1dGlvbk1vZGVDb2x1bW5TcWx9ID0gJHtkYi5xdW90ZShcInBvb2xlZFwiKX0gYCArXG4gICAgICAgICAgYFdIRVJFICR7ZXhlY3V0aW9uTW9kZUNvbHVtblNxbH0gPSAke2RiLnF1b3RlKFwiZm9ya2VkXCIpfSBgICtcbiAgICAgICAgICBgQU5EICR7aGFuZG9mZklkQ29sdW1uU3FsfSBMSUtFICR7ZGIucXVvdGUoYCR7TEVHQUNZX1BPT0xFRF9IQU5ET0ZGX0lEX1BSRUZJWH0lYCl9YFxuICAgICAgICApXG4gICAgICAgIC8vIFRoZSBxdWV1ZWQtcG9vbGVkIG1hcmtlciB3YXMgYSBzZW50aW5lbCwgbm90IGEgcmVhbCBsZWFzZTsgY2xlYXIgaXQuXG4gICAgICAgIGF3YWl0IGRiLnF1ZXJ5KFxuICAgICAgICAgIGBVUERBVEUgJHt0YWJsZU5hbWVTcWx9IFNFVCAke2hhbmRvZmZJZENvbHVtblNxbH0gPSBOVUxMIGAgK1xuICAgICAgICAgIGBXSEVSRSAke2hhbmRvZmZJZENvbHVtblNxbH0gPSAke2RiLnF1b3RlKExFR0FDWV9QT09MRURfUVVFVUVEX0hBTkRPRkZfSUQpfWBcbiAgICAgICAgKVxuXG4gICAgICAgIGNvbnN0IGRyb3BGb3JrZWQgPSBuZXcgVGFibGVEYXRhKEpPQlNfVEFCTEUpXG4gICAgICAgIGRyb3BGb3JrZWQuYWRkQ29sdW1uKFwiZm9ya2VkXCIsIHtkcm9wQ29sdW1uOiB0cnVlfSlcbiAgICAgICAgZm9yIChjb25zdCBzcWwgb2YgYXdhaXQgZGIuYWx0ZXJUYWJsZVNRTHMoZHJvcEZvcmtlZCkpIGF3YWl0IGRiLnF1ZXJ5KHNxbClcblxuICAgICAgICBkYi5jbGVhclNjaGVtYUNhY2hlKClcbiAgICAgIH1cblxuICAgICAgYXdhaXQgdGhpcy5fcmVjb3JkTWlncmF0aW9uKGRiLCBtaWdyYXRpb25WZXJzaW9uKVxuICAgIH0gZmluYWxseSB7XG4gICAgICBhd2FpdCBkYi5yZWxlYXNlQWR2aXNvcnlMb2NrKG1pZ3JhdGlvbktleSlcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogUnVucyByZWNvcmQgbWlncmF0aW9uLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL2RhdGFiYXNlL2RyaXZlcnMvYmFzZS5qc1wiKS5kZWZhdWx0fSBkYiAtIERhdGFiYXNlIGNvbm5lY3Rpb24uXG4gICAqIEBwYXJhbSB7c3RyaW5nfSB2ZXJzaW9uIC0gTWlncmF0aW9uIHZlcnNpb24uXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIHdoZW4gY29tcGxldGUuXG4gICAqL1xuICBhc3luYyBfcmVjb3JkTWlncmF0aW9uKGRiLCB2ZXJzaW9uKSB7XG4gICAgYXdhaXQgZGIudXBzZXJ0KHtcbiAgICAgIHRhYmxlTmFtZTogTUlHUkFUSU9OU19UQUJMRSxcbiAgICAgIGRhdGE6IHtcbiAgICAgICAga2V5OiB0aGlzLl9taWdyYXRpb25LZXkodmVyc2lvbiksXG4gICAgICAgIHNjb3BlOiBNSUdSQVRJT05fU0NPUEUsXG4gICAgICAgIHZlcnNpb24sXG4gICAgICAgIGFwcGxpZWRfYXRfbXM6IERhdGUubm93KClcbiAgICAgIH0sXG4gICAgICBjb25mbGljdENvbHVtbnM6IFtcImtleVwiXSxcbiAgICAgIHVwZGF0ZUNvbHVtbnM6IFtcInNjb3BlXCIsIFwidmVyc2lvblwiLCBcImFwcGxpZWRfYXRfbXNcIl1cbiAgICB9KVxuICB9XG5cbiAgYXN5bmMgX2luaXRpYWxpemVNb2RlbCgpIHtcbiAgICBpZiAoQmFja2dyb3VuZEpvYlJlY29yZC5pc0luaXRpYWxpemVkKCkpIHJldHVyblxuXG4gICAgQmFja2dyb3VuZEpvYlJlY29yZC5zZXREYXRhYmFzZUlkZW50aWZpZXIodGhpcy5nZXREYXRhYmFzZUlkZW50aWZpZXIoKSlcbiAgICBjb25zdCBwb29sID0gdGhpcy5jb25maWd1cmF0aW9uLmdldERhdGFiYXNlUG9vbCh0aGlzLmdldERhdGFiYXNlSWRlbnRpZmllcigpKVxuXG4gICAgYXdhaXQgcG9vbC53aXRoQ29ubmVjdGlvbih7bmFtZTogXCJCYWNrZ3JvdW5kIGpvYnMgc3RvcmUgaW5pdGlhbGl6ZSBtb2RlbFwifSwgYXN5bmMgKCkgPT4ge1xuICAgICAgYXdhaXQgQmFja2dyb3VuZEpvYlJlY29yZC5pbml0aWFsaXplUmVjb3JkKHtjb25maWd1cmF0aW9uOiB0aGlzLmNvbmZpZ3VyYXRpb259KVxuICAgIH0pXG4gIH1cblxuICAvKipcbiAgICogUnVucyBnZXQgam9iIHJvdyBieSBpZC5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9kYXRhYmFzZS9kcml2ZXJzL2Jhc2UuanNcIikuZGVmYXVsdH0gZGIgLSBEYXRhYmFzZSBjb25uZWN0aW9uLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gam9iSWQgLSBKb2IgaWQuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPGltcG9ydChcIi4vdHlwZXMuanNcIikuQmFja2dyb3VuZEpvYlJvdyB8IG51bGw+fSAtIEpvYiByb3cuXG4gICAqL1xuICBhc3luYyBfZ2V0Sm9iUm93QnlJZChkYiwgam9iSWQpIHtcbiAgICBjb25zdCBxdWVyeSA9IGRiXG4gICAgICAubmV3UXVlcnkoKVxuICAgICAgLmZyb20oSk9CU19UQUJMRSlcbiAgICAgIC53aGVyZSh7aWQ6IGpvYklkfSlcbiAgICAgIC5saW1pdCgxKVxuXG4gICAgY29uc3Qgcm93cyA9IGF3YWl0IHF1ZXJ5LnJlc3VsdHMoKVxuXG4gICAgaWYgKCFyb3dzWzBdKSByZXR1cm4gbnVsbFxuXG4gICAgcmV0dXJuIHRoaXMuX25vcm1hbGl6ZUpvYlJvdyhyb3dzWzBdKVxuICB9XG5cbiAgLyoqXG4gICAqIFJlbGVhc2VzIG93bmVyc2hpcCBvbmx5IHdoZW4gdGhlIGtleSBzdGlsbCBwb2ludHMgYXQgdGhlIGV4cGVjdGVkIGpvYi5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9kYXRhYmFzZS9kcml2ZXJzL2Jhc2UuanNcIikuZGVmYXVsdH0gZGIgLSBEYXRhYmFzZSBjb25uZWN0aW9uLlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIE93bmVyc2hpcCBpZGVudGl0eS5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGFyZ3Muam9iSWQgLSBFeHBlY3RlZCBvd25lciBqb2IgaWQuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBhcmdzLnNjaGVkdWxlS2V5IC0gU3RhYmxlIHNjaGVkdWxlIGtleS5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgd2hlbiBkZWxldGVkIG9yIGFscmVhZHkgc3VwZXJzZWRlZC5cbiAgICovXG4gIGFzeW5jIF9yZWxlYXNlU2NoZWR1bGVPd25lcnNoaXAoZGIsIHtqb2JJZCwgc2NoZWR1bGVLZXl9KSB7XG4gICAgYXdhaXQgZGIuZGVsZXRlKHtcbiAgICAgIHRhYmxlTmFtZTogU0NIRURVTEVfS0VZU19UQUJMRSxcbiAgICAgIGNvbmRpdGlvbnM6IHtqb2JfaWQ6IGpvYklkLCBzY2hlZHVsZV9rZXk6IHNjaGVkdWxlS2V5fVxuICAgIH0pXG4gIH1cblxuICAvKipcbiAgICogUmVsZWFzZXMgYSBqb2IncyBvd25lcnNoaXAgd2hlbiBpdCBoYXMgYSBoaXN0b3JpY2FsIHNjaGVkdWxlIGtleS5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9kYXRhYmFzZS9kcml2ZXJzL2Jhc2UuanNcIikuZGVmYXVsdH0gZGIgLSBEYXRhYmFzZSBjb25uZWN0aW9uLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vdHlwZXMuanNcIikuQmFja2dyb3VuZEpvYlJvd30gam9iIC0gVGVybWluYWwgam9iLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyB3aGVuIGRlbGV0ZWQgb3Igbm90IGFwcGxpY2FibGUuXG4gICAqL1xuICBhc3luYyBfcmVsZWFzZVNjaGVkdWxlT3duZXJzaGlwRm9ySm9iKGRiLCBqb2IpIHtcbiAgICBpZiAoIWpvYi5zY2hlZHVsZUtleSkgcmV0dXJuXG5cbiAgICBhd2FpdCB0aGlzLl9yZWxlYXNlU2NoZWR1bGVPd25lcnNoaXAoZGIsIHtqb2JJZDogam9iLmlkLCBzY2hlZHVsZUtleTogam9iLnNjaGVkdWxlS2V5fSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGFwcGx5IGZhaWx1cmUuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gT3B0aW9ucy5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9kYXRhYmFzZS9kcml2ZXJzL2Jhc2UuanNcIikuZGVmYXVsdH0gYXJncy5kYiAtIERhdGFiYXNlIGNvbm5lY3Rpb24uXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi90eXBlcy5qc1wiKS5CYWNrZ3JvdW5kSm9iUm93fSBhcmdzLmpvYiAtIEpvYiByb3cuXG4gICAqIEBwYXJhbSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59IGFyZ3MuZXJyb3IgLSBFcnJvci5cbiAgICogQHBhcmFtIHtib29sZWFufSBhcmdzLm1hcmtPcnBoYW5lZCAtIFdoZXRoZXIgbWFya2luZyBvcnBoYW5lZC5cbiAgICogQHBhcmFtIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59IFthcmdzLmNvbmRpdGlvbnNdIC0gVXBkYXRlIGZlbmNpbmcgY29uZGl0aW9ucy4gRGVmYXVsdHMgdG8gdGhlIGFjdGl2ZS1oYW5kb2ZmIGxlYXNlIG1hdGNoOyB0aGUgdGltZS1iYXNlZCBvcnBoYW4gc3dlZXAgb3ZlcnJpZGVzIHRoaXMgd2l0aCBhbiBpZC9zdGF0dXMgbWF0Y2ggc28gaXQgY2FuIHJlY2xhaW0gcm93cyB3aG9zZSBgaGFuZG9mZl9pZGAgaXMgbnVsbCAoZS5nLiBoYW5kZWQgb2ZmIGJ5IGFuIG9sZGVyIHZlbG9jaW91cyBiZWZvcmUgaGFuZG9mZi1pZCBmZW5jaW5nIGV4aXN0ZWQpLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxpbXBvcnQoXCIuL3R5cGVzLmpzXCIpLkJhY2tncm91bmRKb2JSb3cgfCBudWxsPn0gLSBVcGRhdGVkIGpvYiByb3cgd2hlbiB0aGUgbGVhc2UgdHJhbnNpdGlvbiB3b24uXG4gICAqL1xuICBhc3luYyBfYXBwbHlGYWlsdXJlKHtkYiwgam9iLCBlcnJvciwgbWFya09ycGhhbmVkLCBjb25kaXRpb25zfSkge1xuICAgIGNvbnN0IG5vdyA9IERhdGUubm93KClcbiAgICBjb25zdCBuZXh0QXR0ZW1wdCA9IChqb2IuYXR0ZW1wdHMgfHwgMCkgKyAxXG4gICAgY29uc3QgbWF4UmV0cmllcyA9IHRoaXMuX25vcm1hbGl6ZU1heFJldHJpZXMoam9iLm1heFJldHJpZXMpXG4gICAgY29uc3Qgc2hvdWxkUmV0cnkgPSBuZXh0QXR0ZW1wdCA8PSBtYXhSZXRyaWVzXG4gICAgY29uc3QgZmFpbHVyZU1lc3NhZ2UgPSBub3JtYWxpemVCYWNrZ3JvdW5kSm9iRXJyb3IoZXJyb3IpXG4gICAgY29uc3Qgc2NoZWR1bGVkQXQgPSBzaG91bGRSZXRyeSA/IG5vdyArIHRoaXMuZ2V0UmV0cnlEZWxheU1zKG5leHRBdHRlbXB0KSA6IGpvYi5zY2hlZHVsZWRBdE1zXG4gICAgY29uc3QgdXBkYXRlID0gdGhpcy5fZmFpbHVyZVVwZGF0ZSh7XG4gICAgICBmYWlsdXJlTWVzc2FnZSxcbiAgICAgIG1hcmtPcnBoYW5lZCxcbiAgICAgIG5leHRBdHRlbXB0LFxuICAgICAgbm93LFxuICAgICAgc2NoZWR1bGVkQXQsXG4gICAgICBzaG91bGRSZXRyeVxuICAgIH0pXG5cbiAgICBhd2FpdCB0aGlzLl9sb2NrQ29uY3VycmVuY3lSb3coZGIsIGpvYi5jb25jdXJyZW5jeUtleSlcbiAgICBjb25zdCBhZmZlY3RlZFJvd3MgPSBhd2FpdCB0aGlzLl91cGRhdGVBZmZlY3RlZFJvd3MoZGIsIHtcbiAgICAgIHRhYmxlTmFtZTogSk9CU19UQUJMRSxcbiAgICAgIGRhdGE6IHVwZGF0ZSxcbiAgICAgIGNvbmRpdGlvbnM6IGNvbmRpdGlvbnMgPz8gdGhpcy5fYWN0aXZlSGFuZG9mZkNvbmRpdGlvbnMoam9iKVxuICAgIH0pXG5cbiAgICBpZiAoYWZmZWN0ZWRSb3dzICE9PSAxKSByZXR1cm4gbnVsbFxuICAgIGlmICghc2hvdWxkUmV0cnkpIGF3YWl0IHRoaXMuX3JlbGVhc2VTY2hlZHVsZU93bmVyc2hpcEZvckpvYihkYiwgam9iKVxuICAgIGF3YWl0IHRoaXMuX3JlbGVhc2VDb25jdXJyZW5jeShkYiwgam9iLmNvbmN1cnJlbmN5S2V5KVxuXG4gICAgLy8gUmV0dXJuIGEgc25hcHNob3Qgb2YgdGhlIHRyYW5zaXRpb24gdGhpcyB1cGRhdGUganVzdCBhcHBsaWVkIHJhdGhlciB0aGFuIHJlLXJlYWRpbmcgdGhlIHJvdy5cbiAgICAvLyBXZSB3b24gdGhlIGNvbmRpdGlvbmFsIHVwZGF0ZSAoYWZmZWN0ZWRSb3dzID09PSAxKSwgc28gdGhpcyBzdGF0ZSBpcyBhdXRob3JpdGF0aXZlOyByZS1yZWFkaW5nXG4gICAgLy8gY291bGQgaW5zdGVhZCBvYnNlcnZlIGEgbmV3ZXIgc3RhdGUgaWYgYW5vdGhlciBkaXNwYXRjaGVyIHJlY2xhaW1zIGEgcmVxdWV1ZWQgam9iIGJldHdlZW4gdGhlXG4gICAgLy8gdXBkYXRlIGFuZCB0aGUgcmVhZCAob3ZlcmxhcHBpbmcgbWFpbnMgLyBwb2xsaW5nIGRpc3BhdGNoKSwgd2hpY2ggd291bGQgbWlzcmVwb3J0IHRoZVxuICAgIC8vIHN0YXR1cy90ZXJtaW5hbC93aWxsUmV0cnkgb2YgdGhpcyB0cmFuc2l0aW9uIHRvIGZhaWx1cmUvb3JwaGFuIGV2ZW50IGxpc3RlbmVycy5cbiAgICBjb25zdCBzdGF0dXMgPSBzaG91bGRSZXRyeSA/IFwicXVldWVkXCIgOiAobWFya09ycGhhbmVkID8gXCJvcnBoYW5lZFwiIDogXCJmYWlsZWRcIilcbiAgICAvKiogQHR5cGUge2ltcG9ydChcIi4vdHlwZXMuanNcIikuQmFja2dyb3VuZEpvYlJvd30gKi9cbiAgICBjb25zdCB0cmFuc2l0aW9uZWRKb2IgPSB7XG4gICAgICAuLi5qb2IsXG4gICAgICBhdHRlbXB0czogbmV4dEF0dGVtcHQsXG4gICAgICBoYW5kZWRPZmZBdE1zOiBudWxsLFxuICAgICAgbGFzdEVycm9yOiBmYWlsdXJlTWVzc2FnZSxcbiAgICAgIHN0YXR1cyxcbiAgICAgIHdvcmtlcklkOiBudWxsXG4gICAgfVxuXG4gICAgaWYgKG1hcmtPcnBoYW5lZCkgdHJhbnNpdGlvbmVkSm9iLm9ycGhhbmVkQXRNcyA9IG5vd1xuICAgIGlmIChzaG91bGRSZXRyeSkge1xuICAgICAgdHJhbnNpdGlvbmVkSm9iLnNjaGVkdWxlZEF0TXMgPSBzY2hlZHVsZWRBdFxuICAgIH0gZWxzZSBpZiAoIW1hcmtPcnBoYW5lZCkge1xuICAgICAgdHJhbnNpdGlvbmVkSm9iLmZhaWxlZEF0TXMgPSBub3dcbiAgICB9XG5cbiAgICByZXR1cm4gdHJhbnNpdGlvbmVkSm9iXG4gIH1cblxuICAvKipcbiAgICogUnVucyBmYWlsdXJlIHVwZGF0ZS5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBPcHRpb25zLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gYXJncy5mYWlsdXJlTWVzc2FnZSAtIExhc3QgZmFpbHVyZSBtZXNzYWdlLlxuICAgKiBAcGFyYW0ge2Jvb2xlYW59IGFyZ3MubWFya09ycGhhbmVkIC0gV2hldGhlciBtYXJraW5nIG9ycGhhbmVkLlxuICAgKiBAcGFyYW0ge251bWJlcn0gYXJncy5uZXh0QXR0ZW1wdCAtIE5leHQgYXR0ZW1wdCBjb3VudC5cbiAgICogQHBhcmFtIHtudW1iZXJ9IGFyZ3Mubm93IC0gQ3VycmVudCB0aW1lc3RhbXAuXG4gICAqIEBwYXJhbSB7bnVtYmVyIHwgbnVsbH0gYXJncy5zY2hlZHVsZWRBdCAtIE5leHQgc2NoZWR1bGVkIHRpbWVzdGFtcC5cbiAgICogQHBhcmFtIHtib29sZWFufSBhcmdzLnNob3VsZFJldHJ5IC0gV2hldGhlciB0aGUgam9iIHNob3VsZCByZXRyeS5cbiAgICogQHJldHVybnMge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gLSBEYXRhYmFzZSB1cGRhdGUgZGF0YS5cbiAgICovXG4gIF9mYWlsdXJlVXBkYXRlKHtmYWlsdXJlTWVzc2FnZSwgbWFya09ycGhhbmVkLCBuZXh0QXR0ZW1wdCwgbm93LCBzY2hlZHVsZWRBdCwgc2hvdWxkUmV0cnl9KSB7XG4gICAgLyoqXG4gICAgICogVXBkYXRlLlxuICAgICAqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59ICovXG4gICAgY29uc3QgdXBkYXRlID0ge1xuICAgICAgYXR0ZW1wdHM6IG5leHRBdHRlbXB0LFxuICAgICAgaGFuZGVkX29mZl9hdF9tczogbnVsbCxcbiAgICAgIHdvcmtlcl9pZDogbnVsbCxcbiAgICAgIGxhc3RfZXJyb3I6IGZhaWx1cmVNZXNzYWdlXG4gICAgfVxuXG4gICAgdGhpcy5fYXBwbHlPcnBoYW5lZEZhaWx1cmVVcGRhdGUoe21hcmtPcnBoYW5lZCwgbm93LCB1cGRhdGV9KVxuICAgIHRoaXMuX2FwcGx5RmFpbHVyZVN0YXR1c1VwZGF0ZSh7bWFya09ycGhhbmVkLCBub3csIHNjaGVkdWxlZEF0LCBzaG91bGRSZXRyeSwgdXBkYXRlfSlcblxuICAgIHJldHVybiB1cGRhdGVcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGFwcGx5IG9ycGhhbmVkIGZhaWx1cmUgdXBkYXRlLlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIE9wdGlvbnMuXG4gICAqIEBwYXJhbSB7Ym9vbGVhbn0gYXJncy5tYXJrT3JwaGFuZWQgLSBXaGV0aGVyIG1hcmtpbmcgb3JwaGFuZWQuXG4gICAqIEBwYXJhbSB7bnVtYmVyfSBhcmdzLm5vdyAtIEN1cnJlbnQgdGltZXN0YW1wLlxuICAgKiBAcGFyYW0ge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gYXJncy51cGRhdGUgLSBEYXRhYmFzZSB1cGRhdGUgZGF0YS5cbiAgICogQHJldHVybnMge3ZvaWR9XG4gICAqL1xuICBfYXBwbHlPcnBoYW5lZEZhaWx1cmVVcGRhdGUoe21hcmtPcnBoYW5lZCwgbm93LCB1cGRhdGV9KSB7XG4gICAgaWYgKG1hcmtPcnBoYW5lZCkgdXBkYXRlLm9ycGhhbmVkX2F0X21zID0gbm93XG4gIH1cblxuICAvKipcbiAgICogUnVucyBhcHBseSBmYWlsdXJlIHN0YXR1cyB1cGRhdGUuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gT3B0aW9ucy5cbiAgICogQHBhcmFtIHtib29sZWFufSBhcmdzLm1hcmtPcnBoYW5lZCAtIFdoZXRoZXIgbWFya2luZyBvcnBoYW5lZC5cbiAgICogQHBhcmFtIHtudW1iZXJ9IGFyZ3Mubm93IC0gQ3VycmVudCB0aW1lc3RhbXAuXG4gICAqIEBwYXJhbSB7bnVtYmVyIHwgbnVsbH0gYXJncy5zY2hlZHVsZWRBdCAtIE5leHQgc2NoZWR1bGVkIHRpbWVzdGFtcC5cbiAgICogQHBhcmFtIHtib29sZWFufSBhcmdzLnNob3VsZFJldHJ5IC0gV2hldGhlciB0aGUgam9iIHNob3VsZCByZXRyeS5cbiAgICogQHBhcmFtIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59IGFyZ3MudXBkYXRlIC0gRGF0YWJhc2UgdXBkYXRlIGRhdGEuXG4gICAqIEByZXR1cm5zIHt2b2lkfVxuICAgKi9cbiAgX2FwcGx5RmFpbHVyZVN0YXR1c1VwZGF0ZSh7bWFya09ycGhhbmVkLCBub3csIHNjaGVkdWxlZEF0LCBzaG91bGRSZXRyeSwgdXBkYXRlfSkge1xuICAgIGlmIChzaG91bGRSZXRyeSkge1xuICAgICAgdXBkYXRlLnN0YXR1cyA9IFwicXVldWVkXCJcbiAgICAgIHVwZGF0ZS5zY2hlZHVsZWRfYXRfbXMgPSBzY2hlZHVsZWRBdFxuICAgICAgcmV0dXJuXG4gICAgfVxuXG4gICAgaWYgKG1hcmtPcnBoYW5lZCkge1xuICAgICAgdXBkYXRlLnN0YXR1cyA9IFwib3JwaGFuZWRcIlxuICAgICAgcmV0dXJuXG4gICAgfVxuXG4gICAgdXBkYXRlLnN0YXR1cyA9IFwiZmFpbGVkXCJcbiAgICB1cGRhdGUuZmFpbGVkX2F0X21zID0gbm93XG4gIH1cblxuICAvKipcbiAgICogUnVucyBub3JtYWxpemUgam9iIHJvdy5cbiAgICogQHBhcmFtIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59IHJvdyAtIFJhdyBkYXRhYmFzZSByb3cuXG4gICAqIEByZXR1cm5zIHtpbXBvcnQoXCIuL3R5cGVzLmpzXCIpLkJhY2tncm91bmRKb2JSb3d9IC0gTm9ybWFsaXplZCBqb2Igcm93LlxuICAgKi9cbiAgX25vcm1hbGl6ZUpvYlJvdyhyb3cpIHtcbiAgICBjb25zdCBoYW5kb2ZmSWQgPSByb3cuaGFuZG9mZl9pZCA/IFN0cmluZyhyb3cuaGFuZG9mZl9pZCkgOiBudWxsXG4gICAgLy8gYGV4ZWN1dGlvbl9tb2RlYCBpcyB0aGUgc2luZ2xlIHNvdXJjZSBvZiB0cnV0aCBmb3IgYSBqb2IncyBydW50aW1lIGFuZCBpc1xuICAgIC8vIHdyaXR0ZW4gb24gZXZlcnkgZW5xdWV1ZTsgdGhlIGRyb3AtZm9ya2VkIG1pZ3JhdGlvbiBiYWNrZmlsbHMgYW55IHByZS1leGlzdGluZ1xuICAgIC8vIHJvd3MgYmVmb3JlIHRoZSBsZWdhY3kgYGZvcmtlZGAgY29sdW1uIGlzIHJlbW92ZWQuXG4gICAgY29uc3QgZXhlY3V0aW9uTW9kZSA9IHJvdy5leGVjdXRpb25fbW9kZSA/IHRoaXMuX25vcm1hbGl6ZUV4ZWN1dGlvbk1vZGVOYW1lKFN0cmluZyhyb3cuZXhlY3V0aW9uX21vZGUpKSA6IERFRkFVTFRfQkFDS0dST1VORF9KT0JfRVhFQ1VUSU9OX01PREVcblxuICAgIHJldHVybiB7XG4gICAgICBpZDogU3RyaW5nKHJvdy5pZCksXG4gICAgICBqb2JOYW1lOiBTdHJpbmcocm93LmpvYl9uYW1lKSxcbiAgICAgIGFyZ3M6IHRoaXMuX3BhcnNlQXJncyhyb3cuYXJnc19qc29uKSxcbiAgICAgIGV4ZWN1dGlvbk1vZGUsXG4gICAgICBxdWV1ZTogcm93LnF1ZXVlID8gU3RyaW5nKHJvdy5xdWV1ZSkgOiBERUZBVUxUX0JBQ0tHUk9VTkRfSk9CX1FVRVVFLFxuICAgICAgc2NoZWR1bGVLZXk6IHJvdy5zY2hlZHVsZV9rZXkgPyBTdHJpbmcocm93LnNjaGVkdWxlX2tleSkgOiBudWxsLFxuICAgICAgc3RhdHVzOiByb3cuc3RhdHVzID8gU3RyaW5nKHJvdy5zdGF0dXMpIDogXCJxdWV1ZWRcIixcbiAgICAgIGF0dGVtcHRzOiB0aGlzLl9ub3JtYWxpemVOdW1iZXIocm93LmF0dGVtcHRzKSxcbiAgICAgIG1heFJldHJpZXM6IHRoaXMuX25vcm1hbGl6ZU51bWJlcihyb3cubWF4X3JldHJpZXMpLFxuICAgICAgc2NoZWR1bGVkQXRNczogdGhpcy5fbm9ybWFsaXplTnVtYmVyKHJvdy5zY2hlZHVsZWRfYXRfbXMpLFxuICAgICAgY3JlYXRlZEF0TXM6IHRoaXMuX25vcm1hbGl6ZU51bWJlcihyb3cuY3JlYXRlZF9hdF9tcyksXG4gICAgICBoYW5kZWRPZmZBdE1zOiB0aGlzLl9ub3JtYWxpemVOdW1iZXIocm93LmhhbmRlZF9vZmZfYXRfbXMpLFxuICAgICAgaGFuZG9mZklkLFxuICAgICAgY29tcGxldGVkQXRNczogdGhpcy5fbm9ybWFsaXplTnVtYmVyKHJvdy5jb21wbGV0ZWRfYXRfbXMpLFxuICAgICAgZmFpbGVkQXRNczogdGhpcy5fbm9ybWFsaXplTnVtYmVyKHJvdy5mYWlsZWRfYXRfbXMpLFxuICAgICAgb3JwaGFuZWRBdE1zOiB0aGlzLl9ub3JtYWxpemVOdW1iZXIocm93Lm9ycGhhbmVkX2F0X21zKSxcbiAgICAgIHdvcmtlcklkOiByb3cud29ya2VyX2lkID8gU3RyaW5nKHJvdy53b3JrZXJfaWQpIDogbnVsbCxcbiAgICAgIGxhc3RFcnJvcjogcm93Lmxhc3RfZXJyb3IgPyBTdHJpbmcocm93Lmxhc3RfZXJyb3IpIDogbnVsbCxcbiAgICAgIGNvbmN1cnJlbmN5S2V5OiByb3cuY29uY3VycmVuY3lfa2V5ID8gU3RyaW5nKHJvdy5jb25jdXJyZW5jeV9rZXkpIDogbnVsbCxcbiAgICAgIG1heENvbmN1cnJlbmN5OiB0aGlzLl9ub3JtYWxpemVOdW1iZXIocm93Lm1heF9jb25jdXJyZW5jeSksXG4gICAgICB0aW1lb3V0TXM6IHRoaXMuX25vcm1hbGl6ZU51bWJlcihyb3cudGltZW91dF9tcylcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogTm9ybWFsaXplcyBhIGpvYidzIHF1ZXVlIG5hbWUsIGRlZmF1bHRpbmcgdG8gXCJkZWZhdWx0XCIuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi90eXBlcy5qc1wiKS5CYWNrZ3JvdW5kSm9iT3B0aW9ucyB8IHVuZGVmaW5lZH0gb3B0aW9ucyAtIEpvYiBvcHRpb25zLlxuICAgKiBAcmV0dXJucyB7c3RyaW5nfSAtIFF1ZXVlIG5hbWUuXG4gICAqL1xuICBfbm9ybWFsaXplUXVldWUob3B0aW9ucykge1xuICAgIHJldHVybiBub3JtYWxpemVCYWNrZ3JvdW5kSm9iUXVldWUob3B0aW9ucylcbiAgfVxuXG4gIC8qKlxuICAgKiBSZXNvbHZlcyBhIGpvYidzIGR1cmFibGUgY29uY3VycmVuY3kuIEFuIGV4cGxpY2l0IGNvbmN1cnJlbmN5S2V5L21heENvbmN1cnJlbmN5XG4gICAqIHBhaXIgYWx3YXlzIHdpbnMuIE90aGVyd2lzZSwgd2hlbiB0aGUgam9iJ3MgcXVldWUgaGFzIGEgY29uZmlndXJlZCBjYXBcbiAgICogKGBiYWNrZ3JvdW5kSm9icy5xdWV1ZXNbcXVldWVdLm1heENvbmN1cnJlbnRgKSwgZGVyaXZlIGEgcXVldWUtc2NvcGVkXG4gICAqIGNvbmN1cnJlbmN5IGtleSBzbyB0aGUgcXVldWUgY2FwIGlzIGVuZm9yY2VkIGNsdXN0ZXItd2lkZSB0aHJvdWdoIHRoZVxuICAgKiBleGlzdGluZyBkdXJhYmxlIGNvbmN1cnJlbmN5IG1lY2hhbmlzbS5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL3R5cGVzLmpzXCIpLkJhY2tncm91bmRKb2JPcHRpb25zIHwgdW5kZWZpbmVkfSBvcHRpb25zIC0gSm9iIG9wdGlvbnMuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBxdWV1ZSAtIE5vcm1hbGl6ZWQgcXVldWUgbmFtZS5cbiAgICogQHJldHVybnMge3tjb25jdXJyZW5jeUtleTogc3RyaW5nLCBtYXhDb25jdXJyZW5jeTogbnVtYmVyLCBxdWV1ZURlcml2ZWQ6IGJvb2xlYW59IHwgbnVsbH0gLSBSZXNvbHZlZCBjb25jdXJyZW5jeS5cbiAgICovXG4gIF9yZXNvbHZlQ29uY3VycmVuY3kob3B0aW9ucywgcXVldWUpIHtcbiAgICByZXR1cm4gbm9ybWFsaXplQmFja2dyb3VuZEpvYkNvbmN1cnJlbmN5KHtcbiAgICAgIG9wdGlvbnM6IG9wdGlvbnMgfHwge30sXG4gICAgICBxdWV1ZSxcbiAgICAgIHF1ZXVlczogdGhpcy5jb25maWd1cmF0aW9uLmdldEJhY2tncm91bmRKb2JzQ29uZmlnKCkucXVldWVzXG4gICAgfSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSZWFkcyB0aGUgY29uZmlndXJlZCBtYXggY29uY3VycmVuY3kgZm9yIGEgcXVldWUgZnJvbSB0aGUgYmFja2dyb3VuZC1qb2JzIGNvbmZpZy5cbiAgICogQHBhcmFtIHtzdHJpbmd9IHF1ZXVlIC0gUXVldWUgbmFtZS5cbiAgICogQHJldHVybnMge251bWJlciB8IG51bGx9IC0gUG9zaXRpdmUgaW50ZWdlciBjYXAsIG9yIG51bGwgd2hlbiB0aGUgcXVldWUgaGFzIG5vIGNvbmZpZ3VyZWQgY2FwLlxuICAgKi9cbiAgX3F1ZXVlTWF4Q29uY3VycmVuY3kocXVldWUpIHtcbiAgICBjb25zdCBxdWV1ZXMgPSB0aGlzLmNvbmZpZ3VyYXRpb24uZ2V0QmFja2dyb3VuZEpvYnNDb25maWcoKS5xdWV1ZXNcbiAgICBjb25zdCBjYXAgPSBxdWV1ZXM/LltxdWV1ZV0/Lm1heENvbmN1cnJlbnRcblxuICAgIGlmIChOdW1iZXIuaXNJbnRlZ2VyKGNhcCkgJiYgTnVtYmVyKGNhcCkgPiAwKSByZXR1cm4gTnVtYmVyKGNhcClcblxuICAgIHJldHVybiBudWxsXG4gIH1cblxuICAvKipcbiAgICogTGlrZSB7QGxpbmsgX2Vuc3VyZUNvbmN1cnJlbmN5S2V5fSwgYnV0IGZvciBxdWV1ZS1kZXJpdmVkIGtleXMgdGhlIGNvbmZpZ3VyZWRcbiAgICogcXVldWUgY2FwIGlzIHRoZSBzb3VyY2Ugb2YgdHJ1dGg6IGlmIGl0IGNoYW5nZWQsIHVwZGF0ZSB0aGUgc3RvcmVkIGNhcFxuICAgKiBpbnN0ZWFkIG9mIHRocm93aW5nIG9uIGNvbmZsaWN0IChjb25maWctZHJpdmVuIGNhcHMgbXVzdCBiZSB0dW5hYmxlKS5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9kYXRhYmFzZS9kcml2ZXJzL2Jhc2UuanNcIikuZGVmYXVsdH0gZGIgLSBEYXRhYmFzZSBjb25uZWN0aW9uLlxuICAgKiBAcGFyYW0ge3tjb25jdXJyZW5jeUtleTogc3RyaW5nLCBtYXhDb25jdXJyZW5jeTogbnVtYmVyfX0gY29uY3VycmVuY3kgLSBDb25jdXJyZW5jeSBjb25maWd1cmF0aW9uLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyB3aGVuIGVuc3VyZWQuXG4gICAqL1xuICBhc3luYyBfZW5zdXJlUXVldWVDb25jdXJyZW5jeUtleShkYiwge2NvbmN1cnJlbmN5S2V5LCBtYXhDb25jdXJyZW5jeX0pIHtcbiAgICBjb25zdCByb3dzID0gYXdhaXQgZGIubmV3UXVlcnkoKS5mcm9tKENPTkNVUlJFTkNZX1RBQkxFKS53aGVyZSh7Y29uY3VycmVuY3lfa2V5OiBjb25jdXJyZW5jeUtleX0pLmxpbWl0KDEpLnJlc3VsdHMoKVxuXG4gICAgaWYgKCFyb3dzWzBdKSB7XG4gICAgICB0cnkge1xuICAgICAgICBhd2FpdCBkYi5pbnNlcnQoe3RhYmxlTmFtZTogQ09OQ1VSUkVOQ1lfVEFCTEUsIGRhdGE6IHthY3RpdmVfY291bnQ6IDAsIGNvbmN1cnJlbmN5X2tleTogY29uY3VycmVuY3lLZXksIG1heF9jb25jdXJyZW5jeTogbWF4Q29uY3VycmVuY3l9fSlcblxuICAgICAgICByZXR1cm5cbiAgICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICAgIGNvbnN0IHJhY2VkUm93cyA9IGF3YWl0IGRiLm5ld1F1ZXJ5KCkuZnJvbShDT05DVVJSRU5DWV9UQUJMRSkud2hlcmUoe2NvbmN1cnJlbmN5X2tleTogY29uY3VycmVuY3lLZXl9KS5saW1pdCgxKS5yZXN1bHRzKClcblxuICAgICAgICBpZiAoIXJhY2VkUm93c1swXSkgdGhyb3cgZXJyb3JcblxuICAgICAgICByb3dzWzBdID0gcmFjZWRSb3dzWzBdXG4gICAgICB9XG4gICAgfVxuXG4gICAgY29uc3QgY29uZmlndXJlZCA9IC8qKiBAdHlwZSB7e21heF9jb25jdXJyZW5jeT86IG51bWJlciB8IHN0cmluZ319ICovIChyb3dzWzBdKVxuXG4gICAgaWYgKHRoaXMuX25vcm1hbGl6ZU51bWJlcihjb25maWd1cmVkLm1heF9jb25jdXJyZW5jeSkgIT09IG1heENvbmN1cnJlbmN5KSB7XG4gICAgICBjb25zdCB0YWJsZSA9IGRiLnF1b3RlVGFibGUoQ09OQ1VSUkVOQ1lfVEFCTEUpXG5cbiAgICAgIGF3YWl0IGRiLnF1ZXJ5KGBVUERBVEUgJHt0YWJsZX0gU0VUICR7ZGIucXVvdGVDb2x1bW4oXCJtYXhfY29uY3VycmVuY3lcIil9ID0gJHtOdW1iZXIobWF4Q29uY3VycmVuY3kpfSBXSEVSRSAke2RiLnF1b3RlQ29sdW1uKFwiY29uY3VycmVuY3lfa2V5XCIpfSA9ICR7ZGIucXVvdGUoY29uY3VycmVuY3lLZXkpfWApXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIEVuc3VyZXMgdGhlIGNvbmN1cnJlbmN5IHN0YXRlIHRhYmxlIGV4aXN0cy5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9kYXRhYmFzZS9kcml2ZXJzL2Jhc2UuanNcIikuZGVmYXVsdH0gZGIgLSBEYXRhYmFzZSBjb25uZWN0aW9uLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyB3aGVuIHJlYWR5LlxuICAgKi9cbiAgYXN5bmMgX2Vuc3VyZUNvbmN1cnJlbmN5VGFibGUoZGIpIHtcbiAgICBpZiAoYXdhaXQgZGIudGFibGVFeGlzdHMoQ09OQ1VSUkVOQ1lfVEFCTEUpKSByZXR1cm5cbiAgICBjb25zdCB0YWJsZSA9IG5ldyBUYWJsZURhdGEoQ09OQ1VSUkVOQ1lfVEFCTEUsIHtpZk5vdEV4aXN0czogdHJ1ZX0pXG4gICAgdGFibGUuc3RyaW5nKFwiY29uY3VycmVuY3lfa2V5XCIsIHtwcmltYXJ5S2V5OiB0cnVlfSlcbiAgICB0YWJsZS5pbnRlZ2VyKFwibWF4X2NvbmN1cnJlbmN5XCIsIHtudWxsOiBmYWxzZX0pXG4gICAgdGFibGUuaW50ZWdlcihcImFjdGl2ZV9jb3VudFwiLCB7bnVsbDogZmFsc2V9KVxuICAgIGF3YWl0IGRiLmNyZWF0ZVRhYmxlKHRhYmxlKVxuICB9XG5cbiAgLyoqXG4gICAqIEVuc3VyZXMgdGhlIHN0YWJsZSBzY2hlZHVsZS1rZXkgb3duZXJzaGlwIHRhYmxlIGV4aXN0cy5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9kYXRhYmFzZS9kcml2ZXJzL2Jhc2UuanNcIikuZGVmYXVsdH0gZGIgLSBEYXRhYmFzZSBjb25uZWN0aW9uLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyB3aGVuIHJlYWR5LlxuICAgKi9cbiAgYXN5bmMgX2Vuc3VyZVNjaGVkdWxlS2V5c1RhYmxlKGRiKSB7XG4gICAgaWYgKGF3YWl0IGRiLnRhYmxlRXhpc3RzKFNDSEVEVUxFX0tFWVNfVEFCTEUpKSByZXR1cm5cblxuICAgIGNvbnN0IGxvY2tOYW1lID0gYCR7TUlHUkFUSU9OX1NDT1BFfTpzY2hlZHVsZV9rZXlzX3RhYmxlYFxuICAgIGNvbnN0IGFjcXVpcmVkID0gYXdhaXQgZGIuYWNxdWlyZUFkdmlzb3J5TG9jayhsb2NrTmFtZSlcblxuICAgIGlmICghYWNxdWlyZWQpIHRocm93IG5ldyBFcnJvcihcIkZhaWxlZCB0byBhY3F1aXJlIGJhY2tncm91bmQgam9icyBzY2hlZHVsZS1rZXkgdGFibGUgc2NoZW1hIGxvY2tcIilcblxuICAgIHRyeSB7XG4gICAgICBkYi5jbGVhclNjaGVtYUNhY2hlKClcbiAgICAgIGlmIChhd2FpdCBkYi50YWJsZUV4aXN0cyhTQ0hFRFVMRV9LRVlTX1RBQkxFKSkgcmV0dXJuXG5cbiAgICAgIGNvbnN0IHRhYmxlID0gbmV3IFRhYmxlRGF0YShTQ0hFRFVMRV9LRVlTX1RBQkxFLCB7aWZOb3RFeGlzdHM6IHRydWV9KVxuXG4gICAgICB0YWJsZS5zdHJpbmcoXCJzY2hlZHVsZV9rZXlcIiwge3ByaW1hcnlLZXk6IHRydWV9KVxuICAgICAgdGFibGUuc3RyaW5nKFwiam9iX2lkXCIsIHtudWxsOiBmYWxzZSwgaW5kZXg6IHRydWV9KVxuICAgICAgYXdhaXQgZGIuY3JlYXRlVGFibGUodGFibGUpXG4gICAgICBkYi5jbGVhclNjaGVtYUNhY2hlKClcbiAgICB9IGZpbmFsbHkge1xuICAgICAgYXdhaXQgZGIucmVsZWFzZUFkdmlzb3J5TG9jayhsb2NrTmFtZSlcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogRW5zdXJlcyBkdXJhYmxlIGdlbmVyaWMgZW5xdWV1ZSBvd25lcnNoaXAgZXhpc3RzIGluZGVwZW5kZW50bHkgb2Ygam9iIHJvd3MuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vZGF0YWJhc2UvZHJpdmVycy9iYXNlLmpzXCIpLmRlZmF1bHR9IGRiIC0gRGF0YWJhc2UgY29ubmVjdGlvbi5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgd2hlbiByZWFkeS5cbiAgICovXG4gIGFzeW5jIF9lbnN1cmVJZGVtcG90ZW5jeUtleXNUYWJsZShkYikge1xuICAgIGlmIChhd2FpdCBkYi50YWJsZUV4aXN0cyhJREVNUE9URU5DWV9LRVlTX1RBQkxFKSkgcmV0dXJuXG5cbiAgICBjb25zdCBsb2NrTmFtZSA9IGAke01JR1JBVElPTl9TQ09QRX06aWRlbXBvdGVuY3lfa2V5c190YWJsZWBcbiAgICBjb25zdCBhY3F1aXJlZCA9IGF3YWl0IGRiLmFjcXVpcmVBZHZpc29yeUxvY2sobG9ja05hbWUpXG5cbiAgICBpZiAoIWFjcXVpcmVkKSB0aHJvdyBuZXcgRXJyb3IoXCJGYWlsZWQgdG8gYWNxdWlyZSBiYWNrZ3JvdW5kIGpvYiBpZGVtcG90ZW5jeS1rZXkgdGFibGUgc2NoZW1hIGxvY2tcIilcblxuICAgIHRyeSB7XG4gICAgICBkYi5jbGVhclNjaGVtYUNhY2hlKClcbiAgICAgIGlmIChhd2FpdCBkYi50YWJsZUV4aXN0cyhJREVNUE9URU5DWV9LRVlTX1RBQkxFKSkgcmV0dXJuXG5cbiAgICAgIGNvbnN0IHRhYmxlID0gbmV3IFRhYmxlRGF0YShJREVNUE9URU5DWV9LRVlTX1RBQkxFLCB7aWZOb3RFeGlzdHM6IHRydWV9KVxuXG4gICAgICB0YWJsZS5zdHJpbmcoXCJzY29wZV9kaWdlc3RcIiwge3ByaW1hcnlLZXk6IHRydWV9KVxuICAgICAgdGFibGUuc3RyaW5nKFwiam9iX25hbWVcIiwge251bGw6IGZhbHNlfSlcbiAgICAgIHRhYmxlLnN0cmluZyhcInF1ZXVlXCIsIHtudWxsOiBmYWxzZX0pXG4gICAgICB0YWJsZS50ZXh0KFwiaWRlbXBvdGVuY3lfa2V5XCIsIHtudWxsOiBmYWxzZX0pXG4gICAgICB0YWJsZS5zdHJpbmcoXCJqb2JfaWRcIiwge2luZGV4OiB0cnVlLCBudWxsOiBmYWxzZX0pXG4gICAgICB0YWJsZS5zdHJpbmcoXCJyZXF1ZXN0X2RpZ2VzdFwiLCB7bnVsbDogZmFsc2V9KVxuICAgICAgdGFibGUuYmlnaW50KFwiY3JlYXRlZF9hdF9tc1wiLCB7bnVsbDogZmFsc2V9KVxuICAgICAgYXdhaXQgZGIuY3JlYXRlVGFibGUodGFibGUpXG4gICAgICBkYi5jbGVhclNjaGVtYUNhY2hlKClcbiAgICB9IGZpbmFsbHkge1xuICAgICAgYXdhaXQgZGIucmVsZWFzZUFkdmlzb3J5TG9jayhsb2NrTmFtZSlcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogRW5zdXJlcyBkdXJhYmxlIHByb3ZpZGVyLWJhY2tlZCBtYWlsIG9wZXJhdGlvbiBzdGF0ZSBleGlzdHMgaW5kZXBlbmRlbnRseSBvZiBqb2JzLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL2RhdGFiYXNlL2RyaXZlcnMvYmFzZS5qc1wiKS5kZWZhdWx0fSBkYiAtIERhdGFiYXNlIGNvbm5lY3Rpb24uXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIHdoZW4gcmVhZHkuXG4gICAqL1xuICBhc3luYyBfZW5zdXJlTWFpbERlbGl2ZXJ5T3BlcmF0aW9uc1RhYmxlKGRiKSB7XG4gICAgaWYgKGF3YWl0IGRiLnRhYmxlRXhpc3RzKE1BSUxfREVMSVZFUllfT1BFUkFUSU9OU19UQUJMRSkpIHJldHVyblxuXG4gICAgY29uc3QgbG9ja05hbWUgPSBgJHtNSUdSQVRJT05fU0NPUEV9Om1haWxfZGVsaXZlcnlfb3BlcmF0aW9uc190YWJsZWBcbiAgICBjb25zdCBhY3F1aXJlZCA9IGF3YWl0IGRiLmFjcXVpcmVBZHZpc29yeUxvY2sobG9ja05hbWUpXG5cbiAgICBpZiAoIWFjcXVpcmVkKSB0aHJvdyBuZXcgRXJyb3IoXCJGYWlsZWQgdG8gYWNxdWlyZSBtYWlsIGRlbGl2ZXJ5IG9wZXJhdGlvbiB0YWJsZSBzY2hlbWEgbG9ja1wiKVxuXG4gICAgdHJ5IHtcbiAgICAgIGRiLmNsZWFyU2NoZW1hQ2FjaGUoKVxuICAgICAgaWYgKGF3YWl0IGRiLnRhYmxlRXhpc3RzKE1BSUxfREVMSVZFUllfT1BFUkFUSU9OU19UQUJMRSkpIHJldHVyblxuXG4gICAgICBjb25zdCB0YWJsZSA9IG5ldyBUYWJsZURhdGEoTUFJTF9ERUxJVkVSWV9PUEVSQVRJT05TX1RBQkxFLCB7aWZOb3RFeGlzdHM6IHRydWV9KVxuXG4gICAgICB0YWJsZS5zdHJpbmcoXCJvcGVyYXRpb25fa2V5XCIsIHtwcmltYXJ5S2V5OiB0cnVlfSlcbiAgICAgIHRhYmxlLnRleHQoXCJvcGVyYXRpb25faWRcIiwge251bGw6IGZhbHNlfSlcbiAgICAgIHRhYmxlLnN0cmluZyhcInBheWxvYWRfZGlnZXN0XCIsIHtudWxsOiBmYWxzZX0pXG4gICAgICB0YWJsZS5zdHJpbmcoXCJiYWNrZ3JvdW5kX2pvYl9pZFwiLCB7aW5kZXg6IHRydWUsIG51bGw6IGZhbHNlfSlcbiAgICAgIHRhYmxlLmJpZ2ludChcImZpcnN0X2F0dGVtcHRfc3RhcnRlZF9hdF9tc1wiLCB7bnVsbDogdHJ1ZX0pXG4gICAgICB0YWJsZS5zdHJpbmcoXCJwcm92aWRlcl9raW5kXCIsIHtudWxsOiBmYWxzZX0pXG4gICAgICB0YWJsZS5iaWdpbnQoXCJwcm92aWRlcl9yZXRlbnRpb25fbXNcIiwge251bGw6IGZhbHNlfSlcbiAgICAgIHRhYmxlLmJpZ2ludChcImNyZWF0ZWRfYXRfbXNcIiwge251bGw6IGZhbHNlfSlcbiAgICAgIGF3YWl0IGRiLmNyZWF0ZVRhYmxlKHRhYmxlKVxuICAgICAgZGIuY2xlYXJTY2hlbWFDYWNoZSgpXG4gICAgfSBmaW5hbGx5IHtcbiAgICAgIGF3YWl0IGRiLnJlbGVhc2VBZHZpc29yeUxvY2sobG9ja05hbWUpXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIEVuc3VyZXMgdGhlIHNpbmdsZXRvbiBkdXJhYmxlIGNvdW50LXJldmlzaW9uIHJvdyBleGlzdHMuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vZGF0YWJhc2UvZHJpdmVycy9iYXNlLmpzXCIpLmRlZmF1bHR9IGRiIC0gRGF0YWJhc2UgY29ubmVjdGlvbi5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IFJlc29sdmVzIHdoZW4gcmVhZHkuXG4gICAqL1xuICBhc3luYyBfZW5zdXJlQ291bnRSZXZpc2lvblRhYmxlKGRiKSB7XG4gICAgaWYgKCEoYXdhaXQgZGIudGFibGVFeGlzdHMoQ09VTlRTX1JFVklTSU9OX1RBQkxFKSkpIHtcbiAgICAgIGNvbnN0IHRhYmxlID0gbmV3IFRhYmxlRGF0YShDT1VOVFNfUkVWSVNJT05fVEFCTEUsIHtpZk5vdEV4aXN0czogdHJ1ZX0pXG5cbiAgICAgIHRhYmxlLnN0cmluZyhcImtleVwiLCB7cHJpbWFyeUtleTogdHJ1ZX0pXG4gICAgICB0YWJsZS5iaWdpbnQoXCJyZXZpc2lvblwiLCB7bnVsbDogZmFsc2V9KVxuICAgICAgYXdhaXQgZGIuY3JlYXRlVGFibGUodGFibGUpXG4gICAgfVxuXG4gICAgY29uc3Qgcm93cyA9IGF3YWl0IGRiLm5ld1F1ZXJ5KCkuZnJvbShDT1VOVFNfUkVWSVNJT05fVEFCTEUpLndoZXJlKHtrZXk6IENPVU5UU19SRVZJU0lPTl9LRVl9KS5saW1pdCgxKS5yZXN1bHRzKClcblxuICAgIGlmIChyb3dzLmxlbmd0aCA+IDApIHJldHVyblxuXG4gICAgdHJ5IHtcbiAgICAgIGF3YWl0IGRiLmluc2VydCh7dGFibGVOYW1lOiBDT1VOVFNfUkVWSVNJT05fVEFCTEUsIGRhdGE6IHtrZXk6IENPVU5UU19SRVZJU0lPTl9LRVksIHJldmlzaW9uOiAwfX0pXG4gICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgIGNvbnN0IHJhY2VkUm93cyA9IGF3YWl0IGRiLm5ld1F1ZXJ5KCkuZnJvbShDT1VOVFNfUkVWSVNJT05fVEFCTEUpLndoZXJlKHtrZXk6IENPVU5UU19SRVZJU0lPTl9LRVl9KS5saW1pdCgxKS5yZXN1bHRzKClcblxuICAgICAgaWYgKHJhY2VkUm93cy5sZW5ndGggPT09IDApIHRocm93IGVycm9yXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIFJlY29yZHMgb25lIGxvZ2ljYWwgY291bnQgbXV0YXRpb24gYXRvbWljYWxseSBhbmQgYnJvYWRjYXN0cyBpdCBhZnRlciBjb21taXQuXG4gICAqIFplcm8gZW50cmllcyBhcmUgb21pdHRlZDsgYSB3aG9sbHkgemVyby1uZXQgbXV0YXRpb24gZG9lcyBub3QgY29uc3VtZSBhIHJldmlzaW9uLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL2RhdGFiYXNlL2RyaXZlcnMvYmFzZS5qc1wiKS5kZWZhdWx0fSBkYiAtIFRyYW5zYWN0aW9uIGNvbm5lY3Rpb24uXG4gICAqIEBwYXJhbSB7UmVjb3JkPHN0cmluZywgbnVtYmVyPn0gcmVxdWVzdGVkRGVsdGFzIC0gU2lnbmVkIGJ1Y2tldCBjaGFuZ2VzLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gUmVzb2x2ZXMgd2hlbiByZWNvcmRlZC5cbiAgICovXG4gIGFzeW5jIF9yZWNvcmRDb3VudERlbHRhKGRiLCByZXF1ZXN0ZWREZWx0YXMpIHtcbiAgICAvKiogQHR5cGUge1JlY29yZDxzdHJpbmcsIG51bWJlcj59ICovXG4gICAgY29uc3QgZGVsdGFzID0ge31cblxuICAgIGZvciAoY29uc3QgYnVja2V0IG9mIEJBQ0tHUk9VTkRfSk9CX0NPVU5UX0JVQ0tFVFMpIHtcbiAgICAgIGNvbnN0IGFtb3VudCA9IHJlcXVlc3RlZERlbHRhc1tidWNrZXRdIHx8IDBcblxuICAgICAgaWYgKCFOdW1iZXIuaXNJbnRlZ2VyKGFtb3VudCkpIHRocm93IG5ldyBFcnJvcihgSW52YWxpZCBiYWNrZ3JvdW5kIGpvYiBjb3VudCBkZWx0YSBmb3IgJHtidWNrZXR9OiAke2Ftb3VudH1gKVxuICAgICAgaWYgKGFtb3VudCAhPT0gMCkgZGVsdGFzW2J1Y2tldF0gPSBhbW91bnRcbiAgICB9XG5cbiAgICBpZiAoT2JqZWN0LmtleXMoZGVsdGFzKS5sZW5ndGggPT09IDApIHJldHVyblxuXG4gICAgY29uc3QgdGFibGUgPSBkYi5xdW90ZVRhYmxlKENPVU5UU19SRVZJU0lPTl9UQUJMRSlcbiAgICBjb25zdCByZXZpc2lvbkNvbHVtbiA9IGRiLnF1b3RlQ29sdW1uKFwicmV2aXNpb25cIilcbiAgICBjb25zdCBhZmZlY3RlZFJvd3MgPSBhd2FpdCBkYi5hZmZlY3RlZFJvd3MoXG4gICAgICBgVVBEQVRFICR7dGFibGV9IFNFVCAke3JldmlzaW9uQ29sdW1ufSA9ICR7cmV2aXNpb25Db2x1bW59ICsgMSBXSEVSRSAke2RiLnF1b3RlQ29sdW1uKFwia2V5XCIpfSA9ICR7ZGIucXVvdGUoQ09VTlRTX1JFVklTSU9OX0tFWSl9YFxuICAgIClcblxuICAgIGlmIChhZmZlY3RlZFJvd3MgIT09IDEpIHRocm93IG5ldyBFcnJvcihcIkJhY2tncm91bmQgam9iIGNvdW50IHJldmlzaW9uIHJvdyBpcyBtaXNzaW5nXCIpXG5cbiAgICBjb25zdCByZXZpc2lvbiA9IGF3YWl0IHRoaXMuX2NvdW50UmV2aXNpb24oZGIpXG4gICAgY29uc3QgYm9keSA9IHtkZWx0YXMsIHJldmlzaW9uLCB0eXBlOiBcImJhY2tncm91bmQtam9iLWNvdW50LWRlbHRhXCJ9XG4gICAgY29uc3QgZGF0YWJhc2VJZGVudGlmaWVyID0gdGhpcy5nZXREYXRhYmFzZUlkZW50aWZpZXIoKSB8fCBcImRlZmF1bHRcIlxuXG4gICAgYXdhaXQgZGIuYWZ0ZXJDb21taXQoKCkgPT4ge1xuICAgICAgdGhpcy5jb25maWd1cmF0aW9uLmJyb2FkY2FzdFRvQ2hhbm5lbChCQUNLR1JPVU5EX0pPQl9DT1VOVFNfQ0hBTk5FTCwge2RhdGFiYXNlSWRlbnRpZmllcn0sIGJvZHkpXG4gICAgfSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSZWNvcmRzIGEgdHJhbnNpdGlvbiBiZXR3ZWVuIHBlcnNpc3RlZCBzdGF0dXNlcy5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9kYXRhYmFzZS9kcml2ZXJzL2Jhc2UuanNcIikuZGVmYXVsdH0gZGIgLSBUcmFuc2FjdGlvbiBjb25uZWN0aW9uLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gb2xkU3RhdHVzIC0gUHJldmlvdXMgc3RhdHVzLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gbmV3U3RhdHVzIC0gTmV3IHN0YXR1cy5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IFJlc29sdmVzIHdoZW4gcmVjb3JkZWQuXG4gICAqL1xuICBhc3luYyBfcmVjb3JkU3RhdHVzVHJhbnNpdGlvbihkYiwgb2xkU3RhdHVzLCBuZXdTdGF0dXMpIHtcbiAgICBjb25zdCBvbGRDb3VudGVkID0gQ09VTlRFRF9KT0JfU1RBVFVTRVMuaW5jbHVkZXMob2xkU3RhdHVzKVxuICAgIGNvbnN0IG5ld0NvdW50ZWQgPSBDT1VOVEVEX0pPQl9TVEFUVVNFUy5pbmNsdWRlcyhuZXdTdGF0dXMpXG5cbiAgICBpZiAoIW9sZENvdW50ZWQgJiYgb2xkU3RhdHVzICE9PSBcImNhbmNlbGxlZFwiKSB0aHJvdyBuZXcgRXJyb3IoYFVua25vd24gcHJldmlvdXMgYmFja2dyb3VuZCBqb2Igc3RhdHVzOiAke29sZFN0YXR1c31gKVxuICAgIGlmICghbmV3Q291bnRlZCAmJiBuZXdTdGF0dXMgIT09IFwiY2FuY2VsbGVkXCIpIHRocm93IG5ldyBFcnJvcihgVW5rbm93biBuZXh0IGJhY2tncm91bmQgam9iIHN0YXR1czogJHtuZXdTdGF0dXN9YClcbiAgICBpZiAob2xkU3RhdHVzID09PSBuZXdTdGF0dXMpIHJldHVyblxuXG4gICAgLyoqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBudW1iZXI+fSAqL1xuICAgIGNvbnN0IGRlbHRhcyA9IHt9XG5cbiAgICBpZiAob2xkQ291bnRlZCkgZGVsdGFzW29sZFN0YXR1c10gPSAtMVxuICAgIGlmIChuZXdDb3VudGVkKSBkZWx0YXNbbmV3U3RhdHVzXSA9IDFcbiAgICBpZiAob2xkQ291bnRlZCAhPT0gbmV3Q291bnRlZCkgZGVsdGFzLmFsbCA9IG5ld0NvdW50ZWQgPyAxIDogLTFcbiAgICBhd2FpdCB0aGlzLl9yZWNvcmRDb3VudERlbHRhKGRiLCBkZWx0YXMpXG4gIH1cblxuICAvKipcbiAgICogUmVhZHMgdGhlIGxvY2tlZCByZXZpc2lvbi5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9kYXRhYmFzZS9kcml2ZXJzL2Jhc2UuanNcIikuZGVmYXVsdH0gZGIgLSBEYXRhYmFzZSBjb25uZWN0aW9uLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxudW1iZXI+fSBSZXZpc2lvbi5cbiAgICovXG4gIGFzeW5jIF9jb3VudFJldmlzaW9uKGRiKSB7XG4gICAgY29uc3Qgcm93cyA9IGF3YWl0IGRiLm5ld1F1ZXJ5KCkuZnJvbShDT1VOVFNfUkVWSVNJT05fVEFCTEUpLnNlbGVjdChcInJldmlzaW9uXCIpLndoZXJlKHtrZXk6IENPVU5UU19SRVZJU0lPTl9LRVl9KS5saW1pdCgxKS5yZXN1bHRzKClcbiAgICBjb25zdCByZXZpc2lvbiA9IHRoaXMuX25vcm1hbGl6ZU51bWJlcigvKiogQHR5cGUge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gKi8gKHJvd3NbMF0gfHwge30pLnJldmlzaW9uKVxuXG4gICAgaWYgKHJldmlzaW9uID09PSBudWxsIHx8ICFOdW1iZXIuaXNTYWZlSW50ZWdlcihyZXZpc2lvbikgfHwgcmV2aXNpb24gPCAwKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoYEludmFsaWQgYmFja2dyb3VuZCBqb2IgY291bnQgcmV2aXNpb246ICR7cmV2aXNpb259YClcbiAgICB9XG5cbiAgICByZXR1cm4gcmV2aXNpb25cbiAgfVxuXG4gIC8qKlxuICAgKiBUYWtlcyBhIHBvcnRhYmxlIHdyaXRlIGxvY2sgb24gdGhlIHNpbmdsZXRvbiByZXZpc2lvbiByb3cuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vZGF0YWJhc2UvZHJpdmVycy9iYXNlLmpzXCIpLmRlZmF1bHR9IGRiIC0gRGF0YWJhc2UgY29ubmVjdGlvbi5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IFJlc29sdmVzIHdoZW4gbG9ja2VkLlxuICAgKi9cbiAgYXN5bmMgX2xvY2tDb3VudFJldmlzaW9uKGRiKSB7XG4gICAgY29uc3QgdGFibGUgPSBkYi5xdW90ZVRhYmxlKENPVU5UU19SRVZJU0lPTl9UQUJMRSlcbiAgICBjb25zdCByZXZpc2lvbiA9IGRiLnF1b3RlQ29sdW1uKFwicmV2aXNpb25cIilcblxuICAgIGF3YWl0IGRiLnF1ZXJ5KGBVUERBVEUgJHt0YWJsZX0gU0VUICR7cmV2aXNpb259ID0gJHtyZXZpc2lvbn0gV0hFUkUgJHtkYi5xdW90ZUNvbHVtbihcImtleVwiKX0gPSAke2RiLnF1b3RlKENPVU5UU19SRVZJU0lPTl9LRVkpfWApXG4gIH1cblxuICAvKipcbiAgICogQnVpbGRzIHplcm9lZCBjYW5vbmljYWwgYnVja2V0cy5cbiAgICogQHJldHVybnMge1JlY29yZDxzdHJpbmcsIG51bWJlcj59IFplcm9lZCBjYW5vbmljYWwgYnVja2V0cy5cbiAgICovXG4gIF9lbXB0eUNvdW50QnVja2V0cygpIHtcbiAgICByZXR1cm4gT2JqZWN0LmZyb21FbnRyaWVzKEJBQ0tHUk9VTkRfSk9CX0NPVU5UX0JVQ0tFVFMubWFwKChidWNrZXQpID0+IFtidWNrZXQsIDBdKSlcbiAgfVxuXG4gIC8qKlxuICAgKiBDb3VudHMgbm9ybWFsaXplZCByb3dzIGJ5IGNhbm9uaWNhbCBzdGF0dXMuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi90eXBlcy5qc1wiKS5CYWNrZ3JvdW5kSm9iUm93W119IGpvYnMgLSBKb2JzLlxuICAgKiBAcmV0dXJucyB7UmVjb3JkPHN0cmluZywgbnVtYmVyPn0gQ291bnRzLlxuICAgKi9cbiAgX3N0YXR1c0NvdW50cyhqb2JzKSB7XG4gICAgLyoqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBudW1iZXI+fSAqL1xuICAgIGNvbnN0IGNvdW50cyA9IHt9XG5cbiAgICBmb3IgKGNvbnN0IGpvYiBvZiBqb2JzKSB7XG4gICAgICBpZiAoIUNPVU5URURfSk9CX1NUQVRVU0VTLmluY2x1ZGVzKGpvYi5zdGF0dXMpKSB0aHJvdyBuZXcgRXJyb3IoYFVua25vd24gYmFja2dyb3VuZCBqb2Igc3RhdHVzOiAke2pvYi5zdGF0dXN9YClcbiAgICAgIGNvdW50c1tqb2Iuc3RhdHVzXSA9IChjb3VudHNbam9iLnN0YXR1c10gfHwgMCkgKyAxXG4gICAgfVxuXG4gICAgcmV0dXJuIGNvdW50c1xuICB9XG5cbiAgLyoqXG4gICAqIFJlYWRzIGEgY2Fub25pY2FsIHNuYXBzaG90IGFmdGVyIGxvY2tpbmcgdGhlIHJldmlzaW9uIHJvdy5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9kYXRhYmFzZS9kcml2ZXJzL2Jhc2UuanNcIikuZGVmYXVsdH0gZGIgLSBUcmFuc2FjdGlvbiBjb25uZWN0aW9uLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx7Y291bnRzOiBSZWNvcmQ8c3RyaW5nLCBudW1iZXI+LCByZXZpc2lvbjogbnVtYmVyLCB0b3RhbDogbnVtYmVyfT59IFNuYXBzaG90LlxuICAgKi9cbiAgYXN5bmMgX2NvdW50U25hcHNob3RPbkxvY2tlZENvbm5lY3Rpb24oZGIpIHtcbiAgICBjb25zdCByb3dzID0gYXdhaXQgZGIubmV3UXVlcnkoKS5mcm9tKEpPQlNfVEFCTEUpLnNlbGVjdChcInN0YXR1c1wiKS5zZWxlY3QoXCJDT1VOVCgqKSBBUyBjb3VudFwiKS5ncm91cChcInN0YXR1c1wiKS5yZXN1bHRzKClcbiAgICBjb25zdCBjb3VudHMgPSB0aGlzLl9lbXB0eUNvdW50QnVja2V0cygpXG4gICAgbGV0IHRvdGFsID0gMFxuXG4gICAgZm9yIChjb25zdCByb3cgb2Ygcm93cykge1xuICAgICAgY29uc3QgdHlwZWRSb3cgPSAvKiogQHR5cGUge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gKi8gKHJvdylcbiAgICAgIGNvbnN0IHN0YXR1cyA9IFN0cmluZyh0eXBlZFJvdy5zdGF0dXMpXG4gICAgICBjb25zdCBjb3VudCA9IHRoaXMuX25vcm1hbGl6ZU51bWJlcih0eXBlZFJvdy5jb3VudCkgfHwgMFxuXG4gICAgICB0b3RhbCArPSBjb3VudFxuXG4gICAgICBpZiAoIUNPVU5URURfSk9CX1NUQVRVU0VTLmluY2x1ZGVzKHN0YXR1cykpIGNvbnRpbnVlXG4gICAgICBjb3VudHNbc3RhdHVzXSA9IGNvdW50XG4gICAgICBjb3VudHMuYWxsICs9IGNvdW50c1tzdGF0dXNdXG4gICAgfVxuXG4gICAgcmV0dXJuIHtjb3VudHMsIHJldmlzaW9uOiBhd2FpdCB0aGlzLl9jb3VudFJldmlzaW9uKGRiKSwgdG90YWx9XG4gIH1cblxuICAvKipcbiAgICogUmVnaXN0ZXJzIG9yIHZlcmlmaWVzIGEgc3RhYmxlIGtleSBjb25maWd1cmF0aW9uLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL2RhdGFiYXNlL2RyaXZlcnMvYmFzZS5qc1wiKS5kZWZhdWx0fSBkYiAtIERhdGFiYXNlIGNvbm5lY3Rpb24uXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBjb25jdXJyZW5jeSAtIENvbmN1cnJlbmN5IGNvbmZpZ3VyYXRpb24uXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBjb25jdXJyZW5jeS5jb25jdXJyZW5jeUtleSAtIENvbmN1cnJlbmN5IGtleS5cbiAgICogQHBhcmFtIHtudW1iZXJ9IGNvbmN1cnJlbmN5Lm1heENvbmN1cnJlbmN5IC0gU3RhYmxlIGNhcC5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgd2hlbiB2ZXJpZmllZC5cbiAgICovXG4gIGFzeW5jIF9lbnN1cmVDb25jdXJyZW5jeUtleShkYiwge2NvbmN1cnJlbmN5S2V5LCBtYXhDb25jdXJyZW5jeX0pIHtcbiAgICBjb25zdCByb3dzID0gYXdhaXQgZGIubmV3UXVlcnkoKS5mcm9tKENPTkNVUlJFTkNZX1RBQkxFKS53aGVyZSh7Y29uY3VycmVuY3lfa2V5OiBjb25jdXJyZW5jeUtleX0pLmxpbWl0KDEpLnJlc3VsdHMoKVxuICAgIGlmICghcm93c1swXSkge1xuICAgICAgdHJ5IHtcbiAgICAgICAgYXdhaXQgZGIuaW5zZXJ0KHt0YWJsZU5hbWU6IENPTkNVUlJFTkNZX1RBQkxFLCBkYXRhOiB7YWN0aXZlX2NvdW50OiAwLCBjb25jdXJyZW5jeV9rZXk6IGNvbmN1cnJlbmN5S2V5LCBtYXhfY29uY3VycmVuY3k6IG1heENvbmN1cnJlbmN5fX0pXG4gICAgICAgIHJldHVyblxuICAgICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgICAgY29uc3QgcmFjZWRSb3dzID0gYXdhaXQgZGIubmV3UXVlcnkoKS5mcm9tKENPTkNVUlJFTkNZX1RBQkxFKS53aGVyZSh7Y29uY3VycmVuY3lfa2V5OiBjb25jdXJyZW5jeUtleX0pLmxpbWl0KDEpLnJlc3VsdHMoKVxuICAgICAgICBpZiAoIXJhY2VkUm93c1swXSkgdGhyb3cgZXJyb3JcbiAgICAgICAgcm93c1swXSA9IHJhY2VkUm93c1swXVxuICAgICAgfVxuICAgIH1cbiAgICBjb25zdCBjb25maWd1cmVkID0gLyoqIEB0eXBlIHt7bWF4X2NvbmN1cnJlbmN5PzogbnVtYmVyIHwgc3RyaW5nfX0gKi8gKHJvd3NbMF0pXG4gICAgaWYgKHRoaXMuX25vcm1hbGl6ZU51bWJlcihjb25maWd1cmVkLm1heF9jb25jdXJyZW5jeSkgIT09IG1heENvbmN1cnJlbmN5KSB0aHJvdyBuZXcgRXJyb3IoYENvbmZsaWN0aW5nIG1heENvbmN1cnJlbmN5IGZvciBiYWNrZ3JvdW5kIGpvYiBjb25jdXJyZW5jeUtleTogJHtjb25jdXJyZW5jeUtleX1gKVxuICB9XG5cbiAgLyoqXG4gICAqIExvY2tzIHRoZSBjb25jdXJyZW5jeSBjb3VudGVyIHJvdyBzbyBhIGpvYi1yZWxlYXNlIHRyYW5zYWN0aW9uIGFjcXVpcmVzIGl0ICpiZWZvcmUqIHRoZSBqb2JcbiAgICogcm93LiB7QGxpbmsgbWFya0hhbmRlZE9mZn0gcmVzZXJ2ZXMgY2FwYWNpdHkgKGxvY2tpbmcgdGhlIGNvdW50ZXIgcm93KSBiZWZvcmUgaXQgdXBkYXRlcyB0aGVcbiAgICogam9iLCBzbyBpdCBsb2NrcyBjb25jdXJyZW5jeS10aGVuLWpvYjsgdGhlIHJlbGVhc2UgcGF0aHMgdXBkYXRlIHRoZSBqb2IgYmVmb3JlIHJlbGVhc2luZ1xuICAgKiBjYXBhY2l0eSwgd2hpY2ggaXMgam9iLXRoZW4tY29uY3VycmVuY3kuIFRob3NlIG9wcG9zaXRlIG9yZGVycyBvbiB0aGUgc2FtZSBzaGFyZWQgY291bnRlciByb3dcbiAgICogYXJlIHdoYXQgZGVhZGxvY2sgKEFCLUJBKSB1bmRlciBhIGRyYWluaW5nIHdvcmtlci4gVGFraW5nIHRoaXMgbG9jayBmaXJzdCBnaXZlcyBldmVyeVxuICAgKiB0cmFuc2FjdGlvbiBhIHNpbmdsZSBjb25jdXJyZW5jeS10aGVuLWpvYiBvcmRlciBhbmQgcmVtb3ZlcyB0aGUgY3ljbGUuXG4gICAqXG4gICAqIFVzZXMgYSB2YWx1ZS1wcmVzZXJ2aW5nIGBVUERBVEVgIHJhdGhlciB0aGFuIGBTRUxFQ1QgLi4uIEZPUiBVUERBVEVgIHNvIGl0IHN0YXlzIHBvcnRhYmxlXG4gICAqIGFjcm9zcyBkcml2ZXJzIHdpdGhvdXQgcm93LWxldmVsIGxvY2tpbmcgcmVhZHMgKGUuZy4gU1FMaXRlKTsgb24gcm93LWxvY2tpbmcgZW5naW5lcyB0aGVcbiAgICogbWF0Y2hlZCByb3cgaXMgd3JpdGUtbG9ja2VkIGZvciB0aGUgcmVzdCBvZiB0aGUgdHJhbnNhY3Rpb24gZXZlbiB0aG91Z2ggaXRzIHZhbHVlIGlzIHVuY2hhbmdlZC5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9kYXRhYmFzZS9kcml2ZXJzL2Jhc2UuanNcIikuZGVmYXVsdH0gZGIgLSBEYXRhYmFzZSBjb25uZWN0aW9uLlxuICAgKiBAcGFyYW0ge3N0cmluZyB8IG51bGx9IGNvbmN1cnJlbmN5S2V5IC0gQ29uY3VycmVuY3kga2V5LlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyB3aGVuIHRoZSBjb3VudGVyIHJvdyBpcyBsb2NrZWQuXG4gICAqL1xuICBhc3luYyBfbG9ja0NvbmN1cnJlbmN5Um93KGRiLCBjb25jdXJyZW5jeUtleSkge1xuICAgIGlmICghY29uY3VycmVuY3lLZXkpIHJldHVyblxuICAgIGNvbnN0IHRhYmxlID0gZGIucXVvdGVUYWJsZShDT05DVVJSRU5DWV9UQUJMRSlcbiAgICBjb25zdCBjb3VudCA9IGRiLnF1b3RlQ29sdW1uKFwiYWN0aXZlX2NvdW50XCIpXG4gICAgYXdhaXQgZGIucXVlcnkoYFVQREFURSAke3RhYmxlfSBTRVQgJHtjb3VudH0gPSAke2NvdW50fSBXSEVSRSAke2RiLnF1b3RlQ29sdW1uKFwiY29uY3VycmVuY3lfa2V5XCIpfSA9ICR7ZGIucXVvdGUoY29uY3VycmVuY3lLZXkpfWApXG4gIH1cblxuICAvKipcbiAgICogQXRvbWljYWxseSByZXNlcnZlcyBjYXBhY2l0eSBmb3IgYSBrZXkuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vZGF0YWJhc2UvZHJpdmVycy9iYXNlLmpzXCIpLmRlZmF1bHR9IGRiIC0gRGF0YWJhc2UgY29ubmVjdGlvbi5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGNvbmN1cnJlbmN5S2V5IC0gQ29uY3VycmVuY3kga2V5LlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxib29sZWFuPn0gLSBXaGV0aGVyIGNhcGFjaXR5IHdhcyByZXNlcnZlZC5cbiAgICovXG4gIGFzeW5jIF9yZXNlcnZlQ29uY3VycmVuY3koZGIsIGNvbmN1cnJlbmN5S2V5KSB7XG4gICAgY29uc3QgdGFibGUgPSBkYi5xdW90ZVRhYmxlKENPTkNVUlJFTkNZX1RBQkxFKVxuICAgIGNvbnN0IGNvdW50ID0gZGIucXVvdGVDb2x1bW4oXCJhY3RpdmVfY291bnRcIilcbiAgICBjb25zdCBhZmZlY3RlZFJvd3MgPSBhd2FpdCBkYi5hZmZlY3RlZFJvd3MoYFVQREFURSAke3RhYmxlfSBTRVQgJHtjb3VudH0gPSAke2NvdW50fSArIDEgV0hFUkUgJHtkYi5xdW90ZUNvbHVtbihcImNvbmN1cnJlbmN5X2tleVwiKX0gPSAke2RiLnF1b3RlKGNvbmN1cnJlbmN5S2V5KX0gQU5EICR7Y291bnR9IDwgJHtkYi5xdW90ZUNvbHVtbihcIm1heF9jb25jdXJyZW5jeVwiKX1gKVxuICAgIHJldHVybiBhZmZlY3RlZFJvd3MgPT09IDFcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGEgcG9ydGFibGUgdXBkYXRlIGFuZCByZXR1cm5zIGl0cyBhZmZlY3RlZC1yb3cgY291bnQuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vZGF0YWJhc2UvZHJpdmVycy9iYXNlLmpzXCIpLmRlZmF1bHR9IGRiIC0gRGF0YWJhc2UgY29ubmVjdGlvbi5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9kYXRhYmFzZS9kcml2ZXJzL2Jhc2UuanNcIikuVXBkYXRlU3FsQXJnc1R5cGV9IGFyZ3MgLSBVcGRhdGUgb3B0aW9ucy5cbiAgICogQHJldHVybnMge1Byb21pc2U8bnVtYmVyPn0gLSBBZmZlY3RlZCByb3cgY291bnQuXG4gICAqL1xuICBhc3luYyBfdXBkYXRlQWZmZWN0ZWRSb3dzKGRiLCBhcmdzKSB7XG4gICAgcmV0dXJuIGF3YWl0IGRiLmFmZmVjdGVkUm93cyhkYi51cGRhdGVTcWwoYXJncykpXG4gIH1cblxuICAvKipcbiAgICogUmVsZWFzZXMgY2FwYWNpdHkgZm9yIGEga2V5LlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL2RhdGFiYXNlL2RyaXZlcnMvYmFzZS5qc1wiKS5kZWZhdWx0fSBkYiAtIERhdGFiYXNlIGNvbm5lY3Rpb24uXG4gICAqIEBwYXJhbSB7c3RyaW5nIHwgbnVsbH0gY29uY3VycmVuY3lLZXkgLSBDb25jdXJyZW5jeSBrZXkuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIHdoZW4gcmVsZWFzZWQuXG4gICAqL1xuICBhc3luYyBfcmVsZWFzZUNvbmN1cnJlbmN5KGRiLCBjb25jdXJyZW5jeUtleSkge1xuICAgIGlmICghY29uY3VycmVuY3lLZXkpIHJldHVyblxuICAgIGNvbnN0IHRhYmxlID0gZGIucXVvdGVUYWJsZShDT05DVVJSRU5DWV9UQUJMRSlcbiAgICBjb25zdCBjb3VudCA9IGRiLnF1b3RlQ29sdW1uKFwiYWN0aXZlX2NvdW50XCIpXG4gICAgYXdhaXQgZGIucXVlcnkoYFVQREFURSAke3RhYmxlfSBTRVQgJHtjb3VudH0gPSAke2NvdW50fSAtIDEgV0hFUkUgJHtkYi5xdW90ZUNvbHVtbihcImNvbmN1cnJlbmN5X2tleVwiKX0gPSAke2RiLnF1b3RlKGNvbmN1cnJlbmN5S2V5KX0gQU5EICR7Y291bnR9ID4gMGApXG4gIH1cblxuICAvKipcbiAgICogUmVidWlsZHMgZHVyYWJsZSBjb3VudHMgZnJvbSBhY3RpdmUgaGFuZG9mZnMuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vZGF0YWJhc2UvZHJpdmVycy9iYXNlLmpzXCIpLmRlZmF1bHR9IGRiIC0gRGF0YWJhc2UgY29ubmVjdGlvbi5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgd2hlbiByZWNvbmNpbGVkLlxuICAgKi9cbiAgYXN5bmMgX3JlY29uY2lsZUNvbmN1cnJlbmN5KGRiKSB7XG4gICAgaWYgKCEoYXdhaXQgZGIudGFibGVFeGlzdHMoQ09OQ1VSUkVOQ1lfVEFCTEUpKSkgcmV0dXJuXG4gICAgY29uc3QgY29uY3VycmVuY3lUYWJsZSA9IGRiLnF1b3RlVGFibGUoQ09OQ1VSUkVOQ1lfVEFCTEUpXG4gICAgY29uc3Qgam9ic1RhYmxlID0gZGIucXVvdGVUYWJsZShKT0JTX1RBQkxFKVxuICAgIGF3YWl0IGRiLnF1ZXJ5KFxuICAgICAgYFVQREFURSAke2NvbmN1cnJlbmN5VGFibGV9IFNFVCAke2RiLnF1b3RlQ29sdW1uKFwiYWN0aXZlX2NvdW50XCIpfSA9IChgICtcbiAgICAgIGBTRUxFQ1QgQ09VTlQoKikgRlJPTSAke2pvYnNUYWJsZX0gV0hFUkUgJHtqb2JzVGFibGV9LiR7ZGIucXVvdGVDb2x1bW4oXCJzdGF0dXNcIil9ID0gJHtkYi5xdW90ZShcImhhbmRlZF9vZmZcIil9IEFORCBgICtcbiAgICAgIGAke2pvYnNUYWJsZX0uJHtkYi5xdW90ZUNvbHVtbihcImNvbmN1cnJlbmN5X2tleVwiKX0gPSAke2NvbmN1cnJlbmN5VGFibGV9LiR7ZGIucXVvdGVDb2x1bW4oXCJjb25jdXJyZW5jeV9rZXlcIil9KWBcbiAgICApXG4gIH1cblxuICAvKipcbiAgICogUmVjb25jaWxlcyBxdWV1ZS1kZXJpdmVkIGNvbmN1cnJlbmN5IHdpdGggdGhlIGN1cnJlbnQgY29uZmlndXJhdGlvbi4gT25seVxuICAgKiBpbnZva2VkIHRocm91Z2gge0BsaW5rIHJlY29uY2lsZVF1ZXVlQ29uY3VycmVuY3l9IOKAlCB0aGUgZXhwbGljaXQgbGlmZWN5Y2xlXG4gICAqIHBhdGggcnVuIGF0IG1haW4tcHJvY2VzcyBzdGFydHVwIHVuZGVyIGEgY3Jvc3MtcHJvY2VzcyBhZHZpc29yeSBsb2NrIOKAlFxuICAgKiBuZXZlciBmcm9tIHNjaGVtYS90ZW5hbnQgY2hlY2tzIG9yIHJvdXRpbmUgY29ubmVjdGlvbiBpbml0aWFsaXphdGlvbixcbiAgICogd2hpY2ggc3RheSByZWFkLW9ubHkgcmVnYXJkaW5nIHF1ZXVlZCBqb2Igcm93cy4gVGhlIHBlci1wcm9jZXNzIG1lbW8gaXNcbiAgICogbGF0Y2hlZCBieSB7QGxpbmsgcmVjb25jaWxlUXVldWVDb25jdXJyZW5jeX0gb25seSBhZnRlciB0aGUgZm9sbG93aW5nXG4gICAqIGNvdW50IHJlYnVpbGQgYWxzbyBzdWNjZWVkcywgc28gYSBmYWlsZWQgcmVidWlsZCByZS1lbnRlcnMgaGVyZSBvbiByZXRyeVxuICAgKiAodGhlIGFkb3B0aW9uIFVQREFURXMgYmVsb3cgYXJlIGlkZW1wb3RlbnQpLiBFbnF1ZXVlIG9ubHkgY29uc3VsdHMgY29uZmlnIGZvciBuZXcgam9icywgc28gYSBjYXAgYWRkZWQsIHJlbW92ZWQsIG9yIGNoYW5nZWRcbiAgICogd2hpbGUgYSBiYWNrbG9nIGV4aXN0cyBvdGhlcndpc2UgbGVhdmVzIHBlcnNpc3RlZCByb3dzIHN0YWxlOiBwcmUtY2FwIGpvYnNcbiAgICoga2VlcCBhIG51bGwga2V5IGFuZCBieXBhc3MgdGhlIGNhcCwgcG9zdC1yZW1vdmFsIGpvYnMgc3RheSBjYXBwZWQgdW5kZXIgYVxuICAgKiBub3ctdW5jb25maWd1cmVkIGtleSwgYW5kIGEgY2hhbmdlZCBudW1lcmljIGNhcCBzdGF5cyBzdGFsZSB1bnRpbCB0aGUgbmV4dFxuICAgKiBlbnF1ZXVlLiBCcmluZyB0aGUgZHVyYWJsZSBzdGF0ZSBpbiBsaW5lIHdpdGggY29uZmlnOiBzeW5jIGVhY2ggY29uZmlndXJlZFxuICAgKiBxdWV1ZSdzIHN0b3JlZCBjYXAsIGFkb3B0IG5vdC15ZXQta2V5ZWQgbm9uLXRlcm1pbmFsIGpvYnMgb250byB0aGVpciBxdWV1ZVxuICAgKiBrZXksIGFuZCByZWxlYXNlIG5vbi10ZXJtaW5hbCBqb2JzIGZyb20gcXVldWUga2V5cyB3aG9zZSBxdWV1ZSBpcyBub1xuICAgKiBsb25nZXIgY2FwcGVkLiBSdW5zIGJlZm9yZSB7QGxpbmsgX3JlY29uY2lsZUNvbmN1cnJlbmN5fSBzbyB0aGUgcmVidWlsdFxuICAgKiBhY3RpdmUgY291bnRzIHJlZmxlY3QgdGhlIGFkb3B0ZWQvcmVsZWFzZWQga2V5cy5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9kYXRhYmFzZS9kcml2ZXJzL2Jhc2UuanNcIikuZGVmYXVsdH0gZGIgLSBEYXRhYmFzZSBjb25uZWN0aW9uLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyB3aGVuIHJlY29uY2lsZWQuXG4gICAqL1xuICBhc3luYyBfcmVjb25jaWxlUXVldWVDb25jdXJyZW5jeShkYikge1xuICAgIGlmICh0aGlzLl9xdWV1ZUNvbmN1cnJlbmN5UmVjb25jaWxlZCkgcmV0dXJuXG4gICAgaWYgKCEoYXdhaXQgZGIudGFibGVFeGlzdHMoQ09OQ1VSUkVOQ1lfVEFCTEUpKSkgcmV0dXJuXG5cbiAgICBjb25zdCBxdWV1ZXNDb25maWcgPSB0aGlzLmNvbmZpZ3VyYXRpb24uZ2V0QmFja2dyb3VuZEpvYnNDb25maWcoKS5xdWV1ZXMgfHwge31cbiAgICBjb25zdCBqb2JzVGFibGUgPSBkYi5xdW90ZVRhYmxlKEpPQlNfVEFCTEUpXG4gICAgY29uc3Qga2V5Q29sdW1uID0gZGIucXVvdGVDb2x1bW4oXCJjb25jdXJyZW5jeV9rZXlcIilcbiAgICBjb25zdCBjYXBDb2x1bW4gPSBkYi5xdW90ZUNvbHVtbihcIm1heF9jb25jdXJyZW5jeVwiKVxuICAgIGNvbnN0IHF1ZXVlQ29sdW1uID0gZGIucXVvdGVDb2x1bW4oXCJxdWV1ZVwiKVxuICAgIGNvbnN0IG5vblRlcm1pbmFsID0gYCR7ZGIucXVvdGVDb2x1bW4oXCJzdGF0dXNcIil9IElOICgke2RiLnF1b3RlKFwicXVldWVkXCIpfSwgJHtkYi5xdW90ZShcImhhbmRlZF9vZmZcIil9KWBcbiAgICAvKiogQHR5cGUge1NldDxzdHJpbmc+fSAqL1xuICAgIGNvbnN0IGNhcHBlZFF1ZXVlcyA9IG5ldyBTZXQoKVxuXG4gICAgZm9yIChjb25zdCBxdWV1ZSBvZiBPYmplY3Qua2V5cyhxdWV1ZXNDb25maWcpKSB7XG4gICAgICBjb25zdCBjYXAgPSB0aGlzLl9xdWV1ZU1heENvbmN1cnJlbmN5KHF1ZXVlKVxuXG4gICAgICBpZiAoY2FwID09PSBudWxsKSBjb250aW51ZVxuXG4gICAgICBjYXBwZWRRdWV1ZXMuYWRkKHF1ZXVlKVxuICAgICAgY29uc3QgY29uY3VycmVuY3lLZXkgPSBgJHtRVUVVRV9DT05DVVJSRU5DWV9LRVlfUFJFRklYfSR7cXVldWV9YFxuXG4gICAgICBhd2FpdCB0aGlzLl9lbnN1cmVRdWV1ZUNvbmN1cnJlbmN5S2V5KGRiLCB7Y29uY3VycmVuY3lLZXksIG1heENvbmN1cnJlbmN5OiBjYXB9KVxuICAgICAgYXdhaXQgZGIucXVlcnkoXG4gICAgICAgIGBVUERBVEUgJHtqb2JzVGFibGV9IFNFVCAke2tleUNvbHVtbn0gPSAke2RiLnF1b3RlKGNvbmN1cnJlbmN5S2V5KX0sICR7Y2FwQ29sdW1ufSA9ICR7TnVtYmVyKGNhcCl9IGAgK1xuICAgICAgICBgV0hFUkUgJHtxdWV1ZUNvbHVtbn0gPSAke2RiLnF1b3RlKHF1ZXVlKX0gQU5EICR7a2V5Q29sdW1ufSBJUyBOVUxMIEFORCAke25vblRlcm1pbmFsfWBcbiAgICAgIClcbiAgICB9XG5cbiAgICBjb25zdCBjb25jdXJyZW5jeVJvd3MgPSBhd2FpdCBkYi5uZXdRdWVyeSgpLmZyb20oQ09OQ1VSUkVOQ1lfVEFCTEUpLnNlbGVjdChcImNvbmN1cnJlbmN5X2tleVwiKS5yZXN1bHRzKClcblxuICAgIGZvciAoY29uc3Qgcm93IG9mIGNvbmN1cnJlbmN5Um93cykge1xuICAgICAgY29uc3QgY29uY3VycmVuY3lLZXkgPSBTdHJpbmcoLyoqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59ICovIChyb3cpLmNvbmN1cnJlbmN5X2tleSlcblxuICAgICAgaWYgKCFjb25jdXJyZW5jeUtleS5zdGFydHNXaXRoKFFVRVVFX0NPTkNVUlJFTkNZX0tFWV9QUkVGSVgpKSBjb250aW51ZVxuICAgICAgaWYgKGNhcHBlZFF1ZXVlcy5oYXMoY29uY3VycmVuY3lLZXkuc2xpY2UoUVVFVUVfQ09OQ1VSUkVOQ1lfS0VZX1BSRUZJWC5sZW5ndGgpKSkgY29udGludWVcblxuICAgICAgYXdhaXQgZGIucXVlcnkoXG4gICAgICAgIGBVUERBVEUgJHtqb2JzVGFibGV9IFNFVCAke2tleUNvbHVtbn0gPSBOVUxMLCAke2NhcENvbHVtbn0gPSBOVUxMIGAgK1xuICAgICAgICBgV0hFUkUgJHtrZXlDb2x1bW59ID0gJHtkYi5xdW90ZShjb25jdXJyZW5jeUtleSl9IEFORCAke25vblRlcm1pbmFsfWBcbiAgICAgIClcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogUnVucyBub3JtYWxpemUgbnVtYmVyLlxuICAgKiBAcGFyYW0ge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSB2YWx1ZSAtIElucHV0IHZhbHVlLlxuICAgKiBAcmV0dXJucyB7bnVtYmVyIHwgbnVsbH0gLSBOb3JtYWxpemVkIG51bWJlci5cbiAgICovXG4gIF9ub3JtYWxpemVOdW1iZXIodmFsdWUpIHtcbiAgICBpZiAodmFsdWUgPT09IG51bGwgfHwgdmFsdWUgPT09IHVuZGVmaW5lZCB8fCB2YWx1ZSA9PT0gXCJcIikgcmV0dXJuIG51bGxcblxuICAgIGNvbnN0IG51bWVyaWMgPSBOdW1iZXIodmFsdWUpXG5cbiAgICBpZiAoTnVtYmVyLmlzTmFOKG51bWVyaWMpKSByZXR1cm4gbnVsbFxuXG4gICAgcmV0dXJuIG51bWVyaWNcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIG5vcm1hbGl6ZSBleGVjdXRpb24gbW9kZS5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL3R5cGVzLmpzXCIpLkJhY2tncm91bmRKb2JPcHRpb25zfSBbb3B0aW9uc10gLSBKb2Igb3B0aW9ucy5cbiAgICogQHJldHVybnMge2ltcG9ydChcIi4vdHlwZXMuanNcIikuQmFja2dyb3VuZEpvYkV4ZWN1dGlvbk1vZGV9IC0gTm9ybWFsaXplZCBleGVjdXRpb24gbW9kZS5cbiAgICovXG4gIF9ub3JtYWxpemVFeGVjdXRpb25Nb2RlKG9wdGlvbnMpIHtcbiAgICByZXR1cm4gbm9ybWFsaXplQmFja2dyb3VuZEpvYkV4ZWN1dGlvbk1vZGUob3B0aW9ucyB8fCB7fSwgREVGQVVMVF9CQUNLR1JPVU5EX0pPQl9FWEVDVVRJT05fTU9ERSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIG5vcm1hbGl6ZSBleGVjdXRpb24gbW9kZSBuYW1lLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gZXhlY3V0aW9uTW9kZSAtIEV4ZWN1dGlvbiBtb2RlIG5hbWUuXG4gICAqIEByZXR1cm5zIHtpbXBvcnQoXCIuL3R5cGVzLmpzXCIpLkJhY2tncm91bmRKb2JFeGVjdXRpb25Nb2RlfSAtIE5vcm1hbGl6ZWQgZXhlY3V0aW9uIG1vZGUuXG4gICAqL1xuICBfbm9ybWFsaXplRXhlY3V0aW9uTW9kZU5hbWUoZXhlY3V0aW9uTW9kZSkge1xuICAgIHJldHVybiBub3JtYWxpemVCYWNrZ3JvdW5kSm9iRXhlY3V0aW9uTW9kZShcbiAgICAgIHtleGVjdXRpb25Nb2RlOiAvKiogQHR5cGUge2ltcG9ydChcIi4vdHlwZXMuanNcIikuQmFja2dyb3VuZEpvYkV4ZWN1dGlvbk1vZGV9ICovIChleGVjdXRpb25Nb2RlKX0sXG4gICAgICBERUZBVUxUX0JBQ0tHUk9VTkRfSk9CX0VYRUNVVElPTl9NT0RFLFxuICAgICAgQkFDS0dST1VORF9KT0JfRVhFQ1VUSU9OX01PREVTXG4gICAgKVxuICB9XG5cbiAgLyoqXG4gICAqIEZpbHRlcnMgcXVldWVkIGpvYnMgYnkgb25lIG9yIG1vcmUgZXhlY3V0aW9uIG1vZGVzIGFnYWluc3QgdGhlXG4gICAqIGBleGVjdXRpb25fbW9kZWAgY29sdW1uICh0aGUgc2luZ2xlIHNvdXJjZSBvZiB0cnV0aCkuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gT3B0aW9ucy5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9kYXRhYmFzZS9kcml2ZXJzL2Jhc2UuanNcIikuZGVmYXVsdH0gYXJncy5kYiAtIERhdGFiYXNlIGNvbm5lY3Rpb24uXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi90eXBlcy5qc1wiKS5CYWNrZ3JvdW5kSm9iRXhlY3V0aW9uTW9kZSB8IGltcG9ydChcIi4vdHlwZXMuanNcIikuQmFja2dyb3VuZEpvYkV4ZWN1dGlvbk1vZGVbXX0gYXJncy5leGVjdXRpb25Nb2RlIC0gUnVudGltZSBtb2Rlcy5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9kYXRhYmFzZS9xdWVyeS9pbmRleC5qc1wiKS5kZWZhdWx0fSBhcmdzLnF1ZXJ5IC0gUXVlcnkgdG8gZmlsdGVyLlxuICAgKiBAcmV0dXJucyB7aW1wb3J0KFwiLi4vZGF0YWJhc2UvcXVlcnkvaW5kZXguanNcIikuZGVmYXVsdH0gLSBGaWx0ZXJlZCBxdWVyeS5cbiAgICovXG4gIF93aGVyZUV4ZWN1dGlvbk1vZGUoe2RiLCBleGVjdXRpb25Nb2RlLCBxdWVyeX0pIHtcbiAgICBjb25zdCBleGVjdXRpb25Nb2RlcyA9IEFycmF5LmlzQXJyYXkoZXhlY3V0aW9uTW9kZSkgPyBleGVjdXRpb25Nb2RlIDogW2V4ZWN1dGlvbk1vZGVdXG4gICAgY29uc3QgZXhlY3V0aW9uTW9kZUNvbHVtbiA9IGRiLnF1b3RlQ29sdW1uKFwiZXhlY3V0aW9uX21vZGVcIilcbiAgICBjb25zdCBjb25kaXRpb25zID0gZXhlY3V0aW9uTW9kZXMubWFwKChtb2RlKSA9PiBgJHtleGVjdXRpb25Nb2RlQ29sdW1ufSA9ICR7ZGIucXVvdGUobW9kZSl9YClcblxuICAgIHJldHVybiBxdWVyeS53aGVyZShgKCR7Y29uZGl0aW9ucy5qb2luKFwiIE9SIFwiKX0pYClcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHBhcnNlIGFyZ3MuXG4gICAqIEBwYXJhbSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59IHZhbHVlIC0gSW5wdXQgdmFsdWUuXG4gICAqIEByZXR1cm5zIHtBcnJheTxSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59IC0gUGFyc2VkIGFyZ3MuXG4gICAqL1xuICBfcGFyc2VBcmdzKHZhbHVlKSB7XG4gICAgaWYgKCF2YWx1ZSkgcmV0dXJuIFtdXG5cbiAgICB0cnkge1xuICAgICAgY29uc3QgcGFyc2VkID0gSlNPTi5wYXJzZShTdHJpbmcodmFsdWUpKVxuXG4gICAgICBpZiAoQXJyYXkuaXNBcnJheShwYXJzZWQpKSByZXR1cm4gcGFyc2VkXG4gICAgfSBjYXRjaCB7XG4gICAgICAvLyBJZ25vcmUgcGFyc2UgZXJyb3JzLlxuICAgIH1cblxuICAgIHJldHVybiBbXVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgd2l0aCBkYi5cbiAgICogQHRlbXBsYXRlIFRcbiAgICogQHBhcmFtIHsoZGI6IGltcG9ydChcIi4uL2RhdGFiYXNlL2RyaXZlcnMvYmFzZS5qc1wiKS5kZWZhdWx0KSA9PiBQcm9taXNlPFQ+fSBjYWxsYmFjayAtIENhbGxiYWNrLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxUPn0gLSBDYWxsYmFjayByZXN1bHQuXG4gICAqL1xuICBhc3luYyBfd2l0aERiKGNhbGxiYWNrKSB7XG4gICAgY29uc3QgZGF0YWJhc2VJZGVudGlmaWVyID0gdGhpcy5nZXREYXRhYmFzZUlkZW50aWZpZXIoKVxuICAgIGNvbnN0IHBvb2wgPSB0aGlzLmNvbmZpZ3VyYXRpb24uZ2V0RGF0YWJhc2VQb29sKGRhdGFiYXNlSWRlbnRpZmllcilcblxuICAgIGlmICghcG9vbC50ZXN0U2hhcmVkQ29ubmVjdGlvbigpKSB7XG4gICAgICByZXR1cm4gYXdhaXQgcG9vbC53aXRoQ29ubmVjdGlvbih7bmFtZTogXCJCYWNrZ3JvdW5kIGpvYnMgc3RvcmVcIn0sIGNhbGxiYWNrKVxuICAgIH1cblxuICAgIHJldHVybiBhd2FpdCB0aGlzLmNvbmZpZ3VyYXRpb24ucnVuV2l0aFRlc3RTaGFyZWRDb25uZWN0aW9uQ29udGV4dHMoYXN5bmMgKCkgPT4ge1xuICAgICAgcmV0dXJuIGF3YWl0IHRoaXMuY29uZmlndXJhdGlvbi5lbnN1cmVDb25uZWN0aW9ucyh7ZGF0YWJhc2VJZGVudGlmaWVyczogW2RhdGFiYXNlSWRlbnRpZmllcl0sIG5hbWU6IFwiQmFja2dyb3VuZCBqb2JzIHN0b3JlXCJ9LCBhc3luYyAoZGJzKSA9PiB7XG4gICAgICAgIGNvbnN0IGNvbm5lY3Rpb24gPSBkYnNbZGF0YWJhc2VJZGVudGlmaWVyXVxuICAgICAgICByZXR1cm4gYXdhaXQgY29vcmRpbmF0ZVNoYXJlZFRyYW5zYWN0aW9uQ29ubmVjdGlvbihjb25uZWN0aW9uLCBhc3luYyAoKSA9PiBhd2FpdCBjYWxsYmFjayhjb25uZWN0aW9uKSlcbiAgICAgIH0pXG4gICAgfSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGEgdmFsdWUtcmV0dXJuaW5nIGNhbGxiYWNrIGluc2lkZSB0aGUgZHJpdmVyJ3Mgdm9pZC10eXBlZCB0cmFuc2FjdGlvbiBBUEkuXG4gICAqIEB0ZW1wbGF0ZSBUXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vZGF0YWJhc2UvZHJpdmVycy9iYXNlLmpzXCIpLmRlZmF1bHR9IGRiIC0gRGF0YWJhc2UgY29ubmVjdGlvbi5cbiAgICogQHBhcmFtIHsoKSA9PiBQcm9taXNlPFQ+fSBjYWxsYmFjayAtIFRyYW5zYWN0aW9uIGNhbGxiYWNrLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxUPn0gLSBDYWxsYmFjayByZXN1bHQuXG4gICAqL1xuICBhc3luYyBfdHJhbnNhY3Rpb25SZXN1bHQoZGIsIGNhbGxiYWNrKSB7XG4gICAgbGV0IGNvbXBsZXRlZCA9IGZhbHNlXG4gICAgLyoqIEB0eXBlIHtUIHwgdW5kZWZpbmVkfSAqL1xuICAgIGxldCByZXN1bHRcbiAgICBhd2FpdCBkYi50cmFuc2FjdGlvbihhc3luYyAoKSA9PiB7XG4gICAgICByZXN1bHQgPSBhd2FpdCBjYWxsYmFjaygpXG4gICAgICBjb21wbGV0ZWQgPSB0cnVlXG4gICAgfSlcbiAgICBpZiAoIWNvbXBsZXRlZCkgdGhyb3cgbmV3IEVycm9yKFwiQmFja2dyb3VuZCBqb2JzIHRyYW5zYWN0aW9uIGNhbGxiYWNrIHdhcyBub3QgaW52b2tlZFwiKVxuICAgIHJldHVybiAvKiogQHR5cGUge1R9ICovIChyZXN1bHQpXG4gIH1cblxuICAvKipcbiAgICogU2VyaWFsaXplcyBjb3VudC1jaGFuZ2luZyB0cmFuc2FjdGlvbnMgYmVmb3JlIGNoZWNraW5nIG91dCB0aGVpciBjb25uZWN0aW9uLlxuICAgKiBEYXRhYmFzZSByb3cgbG9ja2luZyBzdGlsbCBwcm92aWRlcyBjcm9zcy1wcm9jZXNzIG9yZGVyaW5nOyB0aGlzIGd1YXJkXG4gICAqIHByZXZlbnRzIGNvbmN1cnJlbnQgY2FsbGVycyBvbiBTUUxpdGUncyBzaGFyZWQgY29ubmVjdGlvbiBmcm9tIGF0dGVtcHRpbmdcbiAgICogb3ZlcmxhcHBpbmcgdG9wLWxldmVsIHRyYW5zYWN0aW9ucy5cbiAgICogQHRlbXBsYXRlIFRcbiAgICogQHBhcmFtIHsoZGI6IGltcG9ydChcIi4uL2RhdGFiYXNlL2RyaXZlcnMvYmFzZS5qc1wiKS5kZWZhdWx0KSA9PiBQcm9taXNlPFQ+fSBjYWxsYmFjayAtIFRyYW5zYWN0aW9uIGNhbGxiYWNrLlxuICAgKiBAcGFyYW0ge0JhY2tncm91bmRKb2JUcmFuc2FjdGlvblNlcmlhbGl6YXRpb25PcHRpb25zfSBbb3B0aW9uc10gLSBTZXJpYWxpemF0aW9uIG9wdGlvbnMuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPFQ+fSBDYWxsYmFjayByZXN1bHQuXG4gICAqL1xuICBhc3luYyBfc2VyaWFsaXplZENvdW50TXV0YXRpb24oY2FsbGJhY2ssIG9wdGlvbnMgPSB7fSkge1xuICAgIHJldHVybiBhd2FpdCB0aGlzLl9zZXJpYWxpemVkVHJhbnNhY3Rpb25NdXRhdGlvbihhc3luYyAoZGIpID0+IHtcbiAgICAgIGF3YWl0IHRoaXMuX2xvY2tDb3VudFJldmlzaW9uKGRiKVxuXG4gICAgICByZXR1cm4gYXdhaXQgY2FsbGJhY2soZGIpXG4gICAgfSwgb3B0aW9ucylcbiAgfVxuXG4gIC8qKlxuICAgKiBBZG1pdHMgdHJhbnNhY3Rpb25zIHRvIHRoZSBwcm9jZXNzLWxvY2FsIEZJRk8gYmVmb3JlIHRoZXkgY2hlY2sgb3V0IGFcbiAgICogY29ubmVjdGlvbi4gQ3Jvc3MtcHJvY2VzcyBvcmRlcmluZyByZW1haW5zIHRoZSByZXNwb25zaWJpbGl0eSBvZiBkdXJhYmxlXG4gICAqIHJvdy9hZHZpc29yeSBsb2NrcyBhbmQgdW5pcXVlIGNvbnN0cmFpbnRzIGFjcXVpcmVkIGFyb3VuZCB0aGUgY2FsbGJhY2suXG4gICAqIEB0ZW1wbGF0ZSBUXG4gICAqIEBwYXJhbSB7KGRiOiBpbXBvcnQoXCIuLi9kYXRhYmFzZS9kcml2ZXJzL2Jhc2UuanNcIikuZGVmYXVsdCkgPT4gUHJvbWlzZTxUPn0gY2FsbGJhY2sgLSBUcmFuc2FjdGlvbiBjYWxsYmFjay5cbiAgICogQHBhcmFtIHtCYWNrZ3JvdW5kSm9iVHJhbnNhY3Rpb25TZXJpYWxpemF0aW9uT3B0aW9uc30gW29wdGlvbnNdIC0gU2VyaWFsaXphdGlvbiBvcHRpb25zLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxUPn0gQ2FsbGJhY2sgcmVzdWx0LlxuICAgKi9cbiAgYXN5bmMgX3NlcmlhbGl6ZWRUcmFuc2FjdGlvbk11dGF0aW9uKGNhbGxiYWNrLCBvcHRpb25zID0ge30pIHtcbiAgICBjb25zdCBpZGVudGlmaWVyID0gdGhpcy5nZXREYXRhYmFzZUlkZW50aWZpZXIoKSB8fCBcImRlZmF1bHRcIlxuICAgIGNvbnN0IHByZXZpb3VzID0gdHJhbnNhY3Rpb25NdXRhdGlvbkNoYWlucy5nZXQoaWRlbnRpZmllcikgfHwgUHJvbWlzZS5yZXNvbHZlKClcbiAgICBsZXQgcmVzb2x2ZVJ1biA9ICgpID0+IHt9XG4gICAgLyoqIEB0eXBlIHtQcm9taXNlPHZvaWQ+fSAqL1xuICAgIGNvbnN0IHJ1biA9IG5ldyBQcm9taXNlKChyZXNvbHZlKSA9PiB7XG4gICAgICByZXNvbHZlUnVuID0gKCkgPT4gcmVzb2x2ZSh1bmRlZmluZWQpXG4gICAgfSlcbiAgICBjb25zdCBjaGFpbiA9IHByZXZpb3VzLnRoZW4oKCkgPT4gcnVuKVxuXG4gICAgdHJhbnNhY3Rpb25NdXRhdGlvbkNoYWlucy5zZXQoaWRlbnRpZmllciwgY2hhaW4pXG4gICAgYXdhaXQgcHJldmlvdXNcblxuICAgIHRyeSB7XG4gICAgICByZXR1cm4gYXdhaXQgdGhpcy5fd2l0aERiKGFzeW5jIChkYikgPT4ge1xuICAgICAgICBjb25zdCB7YWR2aXNvcnlMb2NrfSA9IG9wdGlvbnNcblxuICAgICAgICBpZiAoYWR2aXNvcnlMb2NrKSB7XG4gICAgICAgICAgY29uc3QgYWNxdWlyZWQgPSBhd2FpdCBkYi5hY3F1aXJlQWR2aXNvcnlMb2NrKGFkdmlzb3J5TG9jay5uYW1lKVxuXG4gICAgICAgICAgaWYgKCFhY3F1aXJlZCkgdGhyb3cgbmV3IEVycm9yKGFkdmlzb3J5TG9jay5mYWlsdXJlTWVzc2FnZSlcbiAgICAgICAgfVxuXG4gICAgICAgIHRyeSB7XG4gICAgICAgICAgcmV0dXJuIGF3YWl0IHRoaXMuX3RyYW5zYWN0aW9uUmVzdWx0KGRiLCBhc3luYyAoKSA9PiBhd2FpdCBjYWxsYmFjayhkYikpXG4gICAgICAgIH0gZmluYWxseSB7XG4gICAgICAgICAgaWYgKGFkdmlzb3J5TG9jaykgYXdhaXQgZGIucmVsZWFzZUFkdmlzb3J5TG9jayhhZHZpc29yeUxvY2submFtZSlcbiAgICAgICAgfVxuICAgICAgfSlcbiAgICB9IGZpbmFsbHkge1xuICAgICAgcmVzb2x2ZVJ1bigpXG4gICAgICBpZiAodHJhbnNhY3Rpb25NdXRhdGlvbkNoYWlucy5nZXQoaWRlbnRpZmllcikgPT09IGNoYWluKSB0cmFuc2FjdGlvbk11dGF0aW9uQ2hhaW5zLmRlbGV0ZShpZGVudGlmaWVyKVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHNob3VsZCBhY2NlcHQgcmVwb3J0LlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIE9wdGlvbnMuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi90eXBlcy5qc1wiKS5CYWNrZ3JvdW5kSm9iUm93fSBhcmdzLmpvYiAtIEpvYiByb3cuXG4gICAqIEBwYXJhbSB7c3RyaW5nIHwgbnVsbCB8IHVuZGVmaW5lZH0gYXJncy5oYW5kb2ZmSWQgLSBIYW5kb2ZmIGxlYXNlIGlkIGZyb20gcmVwb3J0LlxuICAgKiBAcGFyYW0ge3N0cmluZyB8IG51bGwgfCB1bmRlZmluZWR9IGFyZ3Mud29ya2VySWQgLSBXb3JrZXIgaWQgZnJvbSByZXBvcnQuXG4gICAqIEBwYXJhbSB7bnVtYmVyIHwgbnVsbCB8IHVuZGVmaW5lZH0gYXJncy5oYW5kZWRPZmZBdE1zIC0gSGFuZGVkIG9mZiB0aW1lc3RhbXAgZnJvbSByZXBvcnQuXG4gICAqIEByZXR1cm5zIHtib29sZWFufSAtIFdoZXRoZXIgdG8gYWNjZXB0IHRoZSByZXBvcnQuXG4gICAqL1xuICBfc2hvdWxkQWNjZXB0UmVwb3J0KHtqb2IsIGhhbmRvZmZJZCwgd29ya2VySWQsIGhhbmRlZE9mZkF0TXN9KSB7XG4gICAgaWYgKGpvYi5zdGF0dXMgIT09IFwiaGFuZGVkX29mZlwiKSByZXR1cm4gZmFsc2VcblxuICAgIHJldHVybiB0aGlzLl9oYW5kb2ZmSWRSZXBvcnRNYXRjaGVzKHtoYW5kb2ZmSWQsIGpvYn0pXG4gICAgICAmJiB0aGlzLl93b3JrZXJSZXBvcnRNYXRjaGVzKHtqb2IsIHdvcmtlcklkfSlcbiAgICAgICYmIHRoaXMuX2hhbmRvZmZSZXBvcnRNYXRjaGVzKHtoYW5kZWRPZmZBdE1zLCBqb2J9KVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgYWN0aXZlIGhhbmRvZmYgY29uZGl0aW9ucy5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL3R5cGVzLmpzXCIpLkJhY2tncm91bmRKb2JSb3d9IGpvYiAtIEpvYiByb3cuXG4gICAqIEByZXR1cm5zIHtSZWNvcmQ8c3RyaW5nLCBzdHJpbmcgfCBudWxsPn0gLSBDb25kaXRpb25hbCB0cmFuc2l0aW9uIGZlbmNlLlxuICAgKi9cbiAgX2FjdGl2ZUhhbmRvZmZDb25kaXRpb25zKGpvYikge1xuICAgIHJldHVybiB7aGFuZG9mZl9pZDogam9iLmhhbmRvZmZJZCwgaWQ6IGpvYi5pZCwgc3RhdHVzOiBcImhhbmRlZF9vZmZcIn1cbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGhhbmRvZmYgaWQgcmVwb3J0IG1hdGNoZXMuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gT3B0aW9ucy5cbiAgICogQHBhcmFtIHtzdHJpbmcgfCBudWxsIHwgdW5kZWZpbmVkfSBhcmdzLmhhbmRvZmZJZCAtIEhhbmRvZmYgbGVhc2UgaWQgZnJvbSByZXBvcnQuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi90eXBlcy5qc1wiKS5CYWNrZ3JvdW5kSm9iUm93fSBhcmdzLmpvYiAtIEpvYiByb3cuXG4gICAqIEByZXR1cm5zIHtib29sZWFufSAtIFdoZXRoZXIgdGhlIGhhbmRvZmYgbGVhc2UgbWF0Y2hlcy5cbiAgICovXG4gIF9oYW5kb2ZmSWRSZXBvcnRNYXRjaGVzKHtoYW5kb2ZmSWQsIGpvYn0pIHtcbiAgICBpZiAoIWpvYi5oYW5kb2ZmSWQpIHJldHVybiB0cnVlXG5cbiAgICByZXR1cm4gaGFuZG9mZklkID09PSBqb2IuaGFuZG9mZklkXG4gIH1cblxuICAvKipcbiAgICogUnVucyB3b3JrZXIgcmVwb3J0IG1hdGNoZXMuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gT3B0aW9ucy5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL3R5cGVzLmpzXCIpLkJhY2tncm91bmRKb2JSb3d9IGFyZ3Muam9iIC0gSm9iIHJvdy5cbiAgICogQHBhcmFtIHtzdHJpbmcgfCBudWxsIHwgdW5kZWZpbmVkfSBhcmdzLndvcmtlcklkIC0gV29ya2VyIGlkIGZyb20gcmVwb3J0LlxuICAgKiBAcmV0dXJucyB7Ym9vbGVhbn0gLSBXaGV0aGVyIHRoZSB3b3JrZXIgcmVwb3J0IG1hdGNoZXMuXG4gICAqL1xuICBfd29ya2VyUmVwb3J0TWF0Y2hlcyh7am9iLCB3b3JrZXJJZH0pIHtcbiAgICBpZiAoIXdvcmtlcklkKSByZXR1cm4gdHJ1ZVxuICAgIGlmICgham9iLndvcmtlcklkKSByZXR1cm4gdHJ1ZVxuXG4gICAgcmV0dXJuIHdvcmtlcklkID09PSBqb2Iud29ya2VySWRcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGhhbmRvZmYgcmVwb3J0IG1hdGNoZXMuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gT3B0aW9ucy5cbiAgICogQHBhcmFtIHtudW1iZXIgfCBudWxsIHwgdW5kZWZpbmVkfSBhcmdzLmhhbmRlZE9mZkF0TXMgLSBIYW5kZWQgb2ZmIHRpbWVzdGFtcCBmcm9tIHJlcG9ydC5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL3R5cGVzLmpzXCIpLkJhY2tncm91bmRKb2JSb3d9IGFyZ3Muam9iIC0gSm9iIHJvdy5cbiAgICogQHJldHVybnMge2Jvb2xlYW59IC0gV2hldGhlciB0aGUgaGFuZG9mZiByZXBvcnQgbWF0Y2hlcy5cbiAgICovXG4gIF9oYW5kb2ZmUmVwb3J0TWF0Y2hlcyh7aGFuZGVkT2ZmQXRNcywgam9ifSkge1xuICAgIGlmICghaGFuZGVkT2ZmQXRNcykgcmV0dXJuIHRydWVcbiAgICBpZiAoIWpvYi5oYW5kZWRPZmZBdE1zKSByZXR1cm4gdHJ1ZVxuXG4gICAgcmV0dXJuIGhhbmRlZE9mZkF0TXMgPT09IGpvYi5oYW5kZWRPZmZBdE1zXG4gIH1cblxuICAvKipcbiAgICogUnVucyBtaWdyYXRpb24ga2V5LlxuICAgKiBAcGFyYW0ge3N0cmluZ30gW3ZlcnNpb25dIC0gTWlncmF0aW9uIHZlcnNpb24uXG4gICAqIEByZXR1cm5zIHtzdHJpbmd9IC0gTWlncmF0aW9uIGtleS5cbiAgICovXG4gIF9taWdyYXRpb25LZXkodmVyc2lvbiA9IE1JR1JBVElPTl9WRVJTSU9OKSB7XG4gICAgcmV0dXJuIGAke01JR1JBVElPTl9TQ09QRX06JHt2ZXJzaW9ufWBcbiAgfVxufVxuIl19