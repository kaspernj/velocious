// @ts-check
import UUID from "pure-uuid";
import TableData from "../database/table-data/index.js";
import TableIndex from "../database/table-data/table-index.js";
import sha256Hex from "../utils/sha256-hex.js";
import normalizeBackgroundJobError from "./normalize-error.js";
import { DEFAULT_BACKGROUND_JOB_QUEUE, QUEUE_CONCURRENCY_KEY_PREFIX, normalizeBackgroundJobConcurrency, normalizeBackgroundJobExecutionMode, normalizeBackgroundJobMaxRetries, normalizeBackgroundJobQueue, normalizeBackgroundJobScheduledAtMs, rescheduledBackgroundJobAtMs, retryDelayMs } from "./job-semantics.js";
export const LOCAL_BACKGROUND_JOBS_TABLE = "velocious_local_background_jobs";
export const LOCAL_BACKGROUND_JOB_CONCURRENCY_TABLE = "velocious_local_background_job_concurrency";
const MIGRATIONS_TABLE = "velocious_internal_migrations";
const MIGRATION_SCOPE = "local_background_jobs";
const MIGRATION_VERSION = "1";
const LOCAL_EXECUTION_MODES = [/** @type {const} */ ("inline")];
export const LOCAL_BACKGROUND_JOBS_INDEX_NAMES = [
    "index_velocious_local_background_jobs_due",
    "index_velocious_local_background_jobs_queue_status",
    "index_velocious_local_background_jobs_deduplication",
    "index_velocious_local_background_jobs_concurrency"
];
const EXPECTED_JOB_COLUMNS = [
    "id",
    "job_name",
    "args_json",
    "args_digest",
    "execution_mode",
    "queue",
    "max_retries",
    "attempts",
    "status",
    "scheduled_at_ms",
    "created_at_ms",
    "handed_off_at_ms",
    "handoff_id",
    "worker_id",
    "completed_at_ms",
    "failed_at_ms",
    "last_error",
    "concurrency_key",
    "max_concurrency"
];
const EXPECTED_CONCURRENCY_COLUMNS = ["concurrency_key", "max_concurrency", "active_count"];
/** @type {WeakMap<import("../configuration.js").default, Map<string, Promise<void>>>} */
const deduplicatedEnqueueChains = new WeakMap();
/**
 * Creates the production clock used by local dispatch.
 * @returns {import("./types.js").LocalBackgroundJobsClock} - Production clock.
 */
export function localBackgroundJobsClock() {
    return {
        clearTimeout: (timerId) => globalThis.clearTimeout(timerId),
        now: () => Date.now(),
        setTimeout: (callback, delayMs) => globalThis.setTimeout(callback, delayMs)
    };
}
/** Namespaced portable SQLite persistence for local background jobs. */
export default class LocalBackgroundJobsStore {
    /**
     * Creates a store for one configuration and local database.
     * @param {object} args - Store options.
     * @param {import("../configuration.js").default} args.configuration - Owning configuration.
     * @param {import("./types.js").LocalBackgroundJobsClock} [args.clock] - Persistence clock.
     * @param {string} [args.databaseIdentifier] - Configured local database identifier.
     * @param {() => void} [args.onCommittedEnqueue] - Commit-aware dispatcher wake.
     */
    constructor({ configuration, clock = localBackgroundJobsClock(), databaseIdentifier, onCommittedEnqueue }) {
        this.clock = clock;
        this.configuration = configuration;
        this.databaseIdentifier = databaseIdentifier;
        this.onCommittedEnqueue = onCommittedEnqueue;
        this._isReady = false;
        /** @type {Promise<void> | null} */
        this._readyPromise = null;
        /** @type {WeakMap<import("../database/drivers/base.js").default, {completion: Promise<void>, promise: Promise<void>}>} */
        this._transactionReadyPromises = new WeakMap();
    }
    /**
     * Resolves the configured local database identifier.
     * @returns {string} - Database identifier.
     */
    getDatabaseIdentifier() {
        return this.databaseIdentifier || this.configuration.getBackgroundJobsConfig().databaseIdentifier;
    }
    /**
     * Ensures the versioned physical schema exists.
     * @returns {Promise<void>} - Resolves when ready.
     */
    async ensureReady() {
        if (this._isReady)
            return;
        await this._withDb(async (db) => await this._ensureReadyWithDb(db));
    }
    /**
     * Clears the per-instance readiness latch for a deliberate adapter reopen.
     * @returns {void} - No return value.
     */
    resetReadiness() {
        this._isReady = false;
        this._readyPromise = null;
        this._transactionReadyPromises = new WeakMap();
    }
    /**
     * Coordinates physical and transaction-local schema readiness.
     * @param {import("../database/drivers/base.js").default} db - Local SQLite connection.
     * @returns {Promise<void>} - Resolves when this caller can use the schema.
     */
    async _ensureReadyWithDb(db) {
        if (this._isReady)
            return;
        const transactionCompletion = db.insideTransaction() ? db.transactionCompletion() : null;
        const transactionReady = this._transactionReadyPromises.get(db);
        if (transactionCompletion && transactionReady?.completion === transactionCompletion) {
            await transactionReady.promise;
            return;
        }
        if (this._readyPromise) {
            const readyPromise = this._readyPromise;
            await readyPromise;
            if (this._readyPromise === readyPromise)
                this._readyPromise = null;
            if (this._isReady)
                return;
            await this.ensureReady();
            return;
        }
        if (transactionCompletion) {
            const schemaReadyPromise = this._applySchema(db);
            const transactionReadyPromise = schemaReadyPromise.then(() => undefined);
            const transactionReady = { completion: transactionCompletion, promise: transactionReadyPromise };
            const durableReadyPromise = schemaReadyPromise.then(async (changed) => {
                if (!changed) {
                    this._isReady = true;
                    return;
                }
                await transactionCompletion;
            }, () => {
                // The transaction-local caller below owns and rethrows this same schema error.
                // This branch only settles the shared durability barrier so it cannot become
                // an independent unhandled rejection while failed ownership is cleared.
            });
            this._transactionReadyPromises.set(db, transactionReady);
            this._readyPromise = durableReadyPromise;
            try {
                await transactionReadyPromise;
            }
            catch (error) {
                if (this._transactionReadyPromises.get(db) === transactionReady)
                    this._transactionReadyPromises.delete(db);
                if (this._readyPromise === durableReadyPromise)
                    this._readyPromise = null;
                throw error;
            }
            return;
        }
        this._readyPromise = this._transactionResult(db, async () => await this._applySchema(db)).then(() => {
            this._isReady = true;
        });
        try {
            await this._readyPromise;
        }
        finally {
            if (!this._isReady)
                this._readyPromise = null;
        }
    }
    /**
     * Creates or repairs version-one tables and indexes.
     * @param {import("../database/drivers/base.js").default} db - Local SQLite connection.
     * @returns {Promise<boolean>} - Whether schema state changed.
     */
    async _applySchema(db) {
        let changed = false;
        if (!(await db.tableExists(MIGRATIONS_TABLE))) {
            await db.createTable(this._migrationsTableData());
            changed = true;
        }
        if (!(await db.tableExists(LOCAL_BACKGROUND_JOBS_TABLE))) {
            await db.createTable(this._jobsTableData());
            changed = true;
        }
        else {
            await this._assertColumns(db, LOCAL_BACKGROUND_JOBS_TABLE, EXPECTED_JOB_COLUMNS);
        }
        if (!(await db.tableExists(LOCAL_BACKGROUND_JOB_CONCURRENCY_TABLE))) {
            await db.createTable(this._concurrencyTableData());
            changed = true;
        }
        else {
            await this._assertColumns(db, LOCAL_BACKGROUND_JOB_CONCURRENCY_TABLE, EXPECTED_CONCURRENCY_COLUMNS);
        }
        if (await this._ensureIndexes(db))
            changed = true;
        if (!(await this._hasMigration(db))) {
            await db.upsert({
                tableName: MIGRATIONS_TABLE,
                data: {
                    applied_at_ms: this.clock.now(),
                    key: this._migrationKey(),
                    scope: MIGRATION_SCOPE,
                    version: MIGRATION_VERSION
                },
                conflictColumns: ["key"],
                updateColumns: ["scope", "version", "applied_at_ms"]
            });
            changed = true;
        }
        return changed;
    }
    /**
     * Builds the migration ledger table definition.
     * @returns {TableData} - Migration ledger table.
     */
    _migrationsTableData() {
        const table = new TableData(MIGRATIONS_TABLE, { ifNotExists: true });
        table.string("key", { null: false, primaryKey: true });
        table.string("scope", { null: false });
        table.string("version", { null: false });
        table.bigint("applied_at_ms", { null: false });
        return table;
    }
    /**
     * Builds the local jobs table definition.
     * @returns {TableData} - Local jobs table definition.
     */
    _jobsTableData() {
        const table = new TableData(LOCAL_BACKGROUND_JOBS_TABLE, { ifNotExists: true });
        table.string("id", { null: false, primaryKey: true });
        table.string("job_name", { null: false });
        table.text("args_json", { null: false });
        table.string("args_digest", { maxLength: 64, null: false });
        table.string("execution_mode", { null: false });
        table.string("queue", { null: false });
        table.integer("max_retries", { null: false });
        table.integer("attempts", { null: false });
        table.string("status", { null: false });
        table.bigint("scheduled_at_ms", { null: false });
        table.bigint("created_at_ms", { null: false });
        table.bigint("handed_off_at_ms", { null: true });
        table.string("handoff_id", { null: true });
        table.string("worker_id", { null: true });
        table.bigint("completed_at_ms", { null: true });
        table.bigint("failed_at_ms", { null: true });
        table.text("last_error", { null: true });
        table.string("concurrency_key", { null: true });
        table.integer("max_concurrency", { null: true });
        table.addIndex(new TableIndex(["status", "scheduled_at_ms", "created_at_ms", "id"], { name: LOCAL_BACKGROUND_JOBS_INDEX_NAMES[0] }));
        table.addIndex(new TableIndex(["queue", "status", "created_at_ms"], { name: LOCAL_BACKGROUND_JOBS_INDEX_NAMES[1] }));
        table.addIndex(new TableIndex(["args_digest"], { name: LOCAL_BACKGROUND_JOBS_INDEX_NAMES[2] }));
        table.addIndex(new TableIndex(["status", "concurrency_key", "scheduled_at_ms"], { name: LOCAL_BACKGROUND_JOBS_INDEX_NAMES[3] }));
        return table;
    }
    /**
     * Builds the local concurrency counter table definition.
     * @returns {TableData} - Concurrency counter table definition.
     */
    _concurrencyTableData() {
        const table = new TableData(LOCAL_BACKGROUND_JOB_CONCURRENCY_TABLE, { ifNotExists: true });
        table.string("concurrency_key", { null: false, primaryKey: true });
        table.integer("max_concurrency", { null: false });
        table.integer("active_count", { null: false });
        return table;
    }
    /**
     * Rejects an incompatible current-version table rather than rebuilding data.
     * @param {import("../database/drivers/base.js").default} db - Local SQLite connection.
     * @param {string} tableName - Table name.
     * @param {string[]} expectedColumns - Required columns.
     * @returns {Promise<void>} - Resolves when compatible.
     */
    async _assertColumns(db, tableName, expectedColumns) {
        const table = await db.getTableByNameOrFail(tableName);
        const columns = await table.getColumns();
        const names = new Set(columns.map((column) => column.getName()));
        const missing = expectedColumns.filter((columnName) => !names.has(columnName));
        if (missing.length === 0)
            return;
        const error = new Error(`Incompatible local background-jobs schema for ${tableName}; missing columns: ${missing.join(", ")}`);
        this._reportFrameworkError({ error, stage: "local-background-jobs-schema" });
        throw error;
    }
    /**
     * Recreates missing indexes declared by the current schema.
     * @param {import("../database/drivers/base.js").default} db - Local SQLite connection.
     * @returns {Promise<boolean>} - Whether an index was created.
     */
    async _ensureIndexes(db) {
        db.clearSchemaCache();
        const jobsTable = await db.getTableByNameOrFail(LOCAL_BACKGROUND_JOBS_TABLE);
        const existingNames = new Set((await jobsTable.getIndexes()).map((index) => index.getName()));
        let changed = false;
        for (const index of this._jobsTableData().getIndexes()) {
            const indexName = index.getName();
            if (!indexName || existingNames.has(indexName))
                continue;
            const sqls = await db.createIndexSQLs({
                columns: index.getColumns(),
                ifNotExists: true,
                name: indexName,
                tableName: LOCAL_BACKGROUND_JOBS_TABLE,
                unique: index.getUnique()
            });
            for (const sql of sqls)
                await db.query(sql);
            changed = true;
        }
        if (changed)
            db.clearSchemaCache();
        return changed;
    }
    /**
     * Checks whether the current local schema version is recorded.
     * @param {import("../database/drivers/base.js").default} db - Connection.
     * @returns {Promise<boolean>} - Whether version one is recorded.
     */
    async _hasMigration(db) {
        const rows = await db
            .newQuery()
            .from(MIGRATIONS_TABLE)
            .where({ key: this._migrationKey() })
            .limit(1)
            .results();
        return rows.length > 0;
    }
    /**
     * Builds the scoped migration key.
     * @returns {string} - Scoped migration key.
     */
    _migrationKey() { return `${MIGRATION_SCOPE}:${MIGRATION_VERSION}`; }
    /**
     * Enqueues a local job in the caller's active transaction when present.
     * @param {object} args - Enqueue request.
     * @param {string} args.jobName - Registered job name.
     * @param {Array<ReturnType<typeof JSON.parse>>} args.args - Serialized job arguments.
     * @param {import("./types.js").BackgroundJobOptions} [args.options] - Job options.
     * @returns {Promise<string>} - Durable job id.
     */
    async enqueue({ jobName, args, options = {} }) {
        await this.ensureReady();
        const preparedJob = this._prepareJob({ args, jobName, options });
        const mutate = async (holdUntil = (/** @type {Promise<void>} */ _completion) => { }) => await this._withDb(async (connection) => {
            if (connection.insideTransaction())
                holdUntil(connection.transactionCompletion());
            return await this._mutate(connection, async (db) => {
                let jobId = preparedJob.jobId;
                if (preparedJob.concurrency)
                    await this._ensureConcurrency(db, preparedJob.concurrency);
                if (options.deduplicateWhileQueued) {
                    const existing = await db
                        .newQuery()
                        .from(LOCAL_BACKGROUND_JOBS_TABLE)
                        .select("id")
                        .where({
                        args_digest: preparedJob.argsDigest,
                        args_json: preparedJob.argsJson,
                        job_name: preparedJob.jobName,
                        queue: preparedJob.queue,
                        status: "queued"
                    })
                        .where(`scheduled_at_ms <= ${db.quote(preparedJob.scheduledAtMs)}`)
                        .order("scheduled_at_ms ASC")
                        .order("created_at_ms ASC")
                        .limit(1)
                        .results();
                    const existingRow = /** @type {{id: string | number} | undefined} */ (existing[0]);
                    if (existingRow)
                        jobId = String(existingRow.id);
                }
                if (jobId === preparedJob.jobId)
                    await this._insertPreparedJob(db, preparedJob);
                if (this.onCommittedEnqueue)
                    await db.afterCommit(this.onCommittedEnqueue);
                return jobId;
            });
        });
        if (options.deduplicateWhileQueued)
            return await this._serializeDeduplicatedEnqueue(preparedJob, mutate);
        return await mutate();
    }
    /**
     * Serializes matching in-process deduplication checks through commit while
     * leaving unrelated job identities independent.
     * @template T
     * @param {import("./types.js").PreparedLocalBackgroundJob} preparedJob - Prepared job identity.
     * @param {(holdUntil: (completion: Promise<void>) => void) => Promise<T>} callback - Deduplication mutation.
     * @returns {Promise<T>} - Mutation result.
     */
    async _serializeDeduplicatedEnqueue(preparedJob, callback) {
        let chains = deduplicatedEnqueueChains.get(this.configuration);
        if (!chains) {
            chains = new Map();
            deduplicatedEnqueueChains.set(this.configuration, chains);
        }
        const key = sha256Hex(JSON.stringify([
            this.getDatabaseIdentifier(),
            preparedJob.jobName,
            preparedJob.argsDigest,
            preparedJob.queue
        ]));
        const previous = chains.get(key) || Promise.resolve();
        let release = () => { };
        const running = new Promise((resolve) => { release = () => resolve(undefined); });
        const chain = previous.then(() => running);
        /** @type {Promise<void> | undefined} */
        let completion;
        const finish = () => {
            release();
            if (chains.get(key) === chain)
                chains.delete(key);
            if (chains.size === 0)
                deduplicatedEnqueueChains.delete(this.configuration);
        };
        chains.set(key, chain);
        await previous;
        try {
            const result = await callback((transactionCompletion) => { completion = transactionCompletion; });
            if (completion) {
                completion.then(finish, finish);
            }
            else {
                finish();
            }
            return result;
        }
        catch (error) {
            finish();
            throw error;
        }
    }
    /**
     * Prepares validated local job data for insertion.
     * @param {{args: Array<ReturnType<typeof JSON.parse>>, jobName: string, options: import("./types.js").BackgroundJobOptions}} args - Job request.
     * @returns {import("./types.js").PreparedLocalBackgroundJob} - Prepared row data.
     */
    _prepareJob({ args, jobName, options }) {
        if (options.idempotencyKey !== undefined) {
            throw new Error("idempotencyKey is not supported by the local background-jobs adapter");
        }
        const createdAtMs = this.clock.now();
        const queue = normalizeBackgroundJobQueue(options);
        const queues = this.configuration.getBackgroundJobsConfig().queues;
        const argsJson = JSON.stringify(args || []);
        const executionMode = normalizeBackgroundJobExecutionMode(options, "inline", LOCAL_EXECUTION_MODES);
        if (typeof argsJson !== "string")
            throw new TypeError("Local background job arguments must be JSON serializable");
        if (executionMode !== "inline")
            throw new Error("Local background job execution mode invariant was violated");
        return {
            argsDigest: sha256Hex(argsJson),
            argsJson,
            concurrency: normalizeBackgroundJobConcurrency({ options, queue, queues }),
            createdAtMs,
            executionMode,
            jobId: new UUID(4).format(),
            jobName,
            maxRetries: normalizeBackgroundJobMaxRetries(options.maxRetries),
            queue,
            scheduledAtMs: normalizeBackgroundJobScheduledAtMs(options.scheduledAtMs, createdAtMs)
        };
    }
    /**
     * Inserts one prepared local job row and its concurrency metadata.
     * @param {import("../database/drivers/base.js").default} db - Local SQLite connection.
     * @param {import("./types.js").PreparedLocalBackgroundJob} preparedJob - Prepared row data.
     * @returns {Promise<void>} - Resolves after insertion.
     */
    async _insertPreparedJob(db, preparedJob) {
        await db.insert({
            tableName: LOCAL_BACKGROUND_JOBS_TABLE,
            data: {
                args_digest: preparedJob.argsDigest,
                args_json: preparedJob.argsJson,
                attempts: 0,
                completed_at_ms: null,
                concurrency_key: preparedJob.concurrency?.concurrencyKey || null,
                created_at_ms: preparedJob.createdAtMs,
                execution_mode: preparedJob.executionMode,
                failed_at_ms: null,
                handed_off_at_ms: null,
                handoff_id: null,
                id: preparedJob.jobId,
                job_name: preparedJob.jobName,
                last_error: null,
                max_concurrency: preparedJob.concurrency?.maxConcurrency || null,
                max_retries: preparedJob.maxRetries,
                queue: preparedJob.queue,
                scheduled_at_ms: preparedJob.scheduledAtMs,
                status: "queued",
                worker_id: null
            }
        });
    }
    /**
     * Reconciles configured queue-derived caps and durable counters.
     * @returns {Promise<void>} - Resolves after reconciliation.
     */
    async reconcileQueueConcurrency() {
        await this.ensureReady();
        await this._withDb(async (connection) => await this._mutate(connection, async (db) => {
            const queues = this.configuration.getBackgroundJobsConfig().queues;
            const rows = await db.newQuery().from(LOCAL_BACKGROUND_JOBS_TABLE).where({ status: "queued" }).results();
            for (const rawRow of rows) {
                await this._reconcileQueuedJobConcurrency(db, this._normalizeRow(rawRow), queues);
            }
            await this._rebuildConcurrencyCounts(db);
        }));
    }
    /**
     * Applies current queue-derived concurrency policy to one queued row.
     * Explicit concurrency keys remain owned by the enqueue contract.
     * @param {import("../database/drivers/base.js").default} db - Local SQLite connection.
     * @param {import("./types.js").BackgroundJobRow} job - Queued job snapshot.
     * @param {Record<string, {maxConcurrent?: number, priority?: number}>} queues - Current queue policy snapshot.
     * @returns {Promise<import("./types.js").BackgroundJobRow>} - Reconciled snapshot.
     */
    async _reconcileQueuedJobConcurrency(db, job, queues) {
        const currentIsQueueDerived = Boolean(job.concurrencyKey?.startsWith(QUEUE_CONCURRENCY_KEY_PREFIX));
        if (job.concurrencyKey && !currentIsQueueDerived)
            return job;
        const concurrency = normalizeBackgroundJobConcurrency({
            options: {},
            queue: job.queue,
            queues
        });
        if (!concurrency) {
            if (currentIsQueueDerived) {
                await db.update({
                    conditions: { id: job.id, status: "queued" },
                    data: { concurrency_key: null, max_concurrency: null },
                    tableName: LOCAL_BACKGROUND_JOBS_TABLE
                });
            }
            return { ...job, concurrencyKey: null, maxConcurrency: null };
        }
        await this._ensureConcurrency(db, concurrency);
        if (job.concurrencyKey !== concurrency.concurrencyKey || job.maxConcurrency !== concurrency.maxConcurrency) {
            await db.update({
                conditions: { id: job.id, status: "queued" },
                data: { concurrency_key: concurrency.concurrencyKey, max_concurrency: concurrency.maxConcurrency },
                tableName: LOCAL_BACKGROUND_JOBS_TABLE
            });
        }
        return { ...job, concurrencyKey: concurrency.concurrencyKey, maxConcurrency: concurrency.maxConcurrency };
    }
    /**
     * Finds the next eligible local job.
     * @returns {Promise<import("./types.js").BackgroundJobRow | null>} - Next eligible local job.
     */
    async nextAvailableJob() {
        await this.ensureReady();
        return await this._withDb(async (db) => {
            const jobsTable = db.quoteTable(LOCAL_BACKGROUND_JOBS_TABLE);
            const concurrencyTable = db.quoteTable(LOCAL_BACKGROUND_JOB_CONCURRENCY_TABLE);
            const priorityOrder = this._queuePriorityOrderSql(db);
            let query = db
                .newQuery()
                .from(LOCAL_BACKGROUND_JOBS_TABLE)
                .where({ status: "queued" })
                .where(`scheduled_at_ms <= ${db.quote(this.clock.now())}`)
                .where(`(${jobsTable}.${db.quoteColumn("concurrency_key")} IS NULL OR EXISTS (` +
                `SELECT 1 FROM ${concurrencyTable} WHERE ` +
                `${concurrencyTable}.${db.quoteColumn("concurrency_key")} = ${jobsTable}.${db.quoteColumn("concurrency_key")} AND ` +
                `${concurrencyTable}.${db.quoteColumn("active_count")} < ${concurrencyTable}.${db.quoteColumn("max_concurrency")}))`);
            if (priorityOrder)
                query = query.order(`${priorityOrder} DESC`);
            const rows = await query
                .order("scheduled_at_ms ASC")
                .order("created_at_ms ASC")
                .order("id ASC")
                .limit(1)
                .results();
            return rows[0] ? this._normalizeRow(rows[0]) : null;
        });
    }
    /**
     * Finds the soonest future queued job.
     * @returns {Promise<import("./types.js").BackgroundJobRow | null>} - Soonest future queued job.
     */
    async nextScheduledJob() {
        await this.ensureReady();
        return await this._withDb(async (db) => {
            const rows = await db
                .newQuery()
                .from(LOCAL_BACKGROUND_JOBS_TABLE)
                .where({ status: "queued" })
                .where(`scheduled_at_ms > ${db.quote(this.clock.now())}`)
                .order("scheduled_at_ms ASC")
                .order("created_at_ms ASC")
                .order("id ASC")
                .limit(1)
                .results();
            return rows[0] ? this._normalizeRow(rows[0]) : null;
        });
    }
    /**
     * Finds a persisted local job by id.
     * @param {string} jobId - Job id.
     * @returns {Promise<import("./types.js").BackgroundJobRow | null>} - Persisted job.
     */
    async getJob(jobId) {
        await this.ensureReady();
        return await this._withDb(async (db) => await this._getJob(db, jobId));
    }
    /**
     * Lists local jobs in creation order.
     * @returns {Promise<import("./types.js").BackgroundJobRow[]>} - All local jobs in creation order.
     */
    async listJobs() {
        await this.ensureReady();
        return await this._withDb(async (db) => {
            const rows = await db
                .newQuery()
                .from(LOCAL_BACKGROUND_JOBS_TABLE)
                .order("created_at_ms ASC")
                .order("id ASC")
                .results();
            return rows.map((row) => this._normalizeRow(row));
        });
    }
    /**
     * Atomically reserves concurrency and claims one queued job.
     * @param {import("./types.js").BackgroundJobHandoffRequest} args - Claim request. A supplied handoff id is persisted exactly.
     * @returns {Promise<import("./types.js").BackgroundJobHandoff | null>} - Fenced claim.
     */
    async markHandedOff({ jobId, handoffId = new UUID(4).format(), workerId }) {
        await this.ensureReady();
        return await this._withDb(async (connection) => await this._mutate(connection, async (db) => {
            const job = await this._getJob(db, jobId);
            if (!job || job.status !== "queued" || Number(job.scheduledAtMs) > this.clock.now())
                return null;
            if (job.concurrencyKey && !(await this._reserveConcurrency(db, job.concurrencyKey)))
                return null;
            const handedOffAtMs = this.clock.now();
            const affectedRows = await this._updateAffectedRows(db, {
                conditions: { id: jobId, status: "queued" },
                data: { handed_off_at_ms: handedOffAtMs, handoff_id: handoffId, status: "handed_off", worker_id: workerId || "local" },
                tableName: LOCAL_BACKGROUND_JOBS_TABLE
            });
            if (affectedRows !== 1) {
                await this._releaseConcurrency(db, job.concurrencyKey);
                return null;
            }
            return { handedOffAtMs, handoffId };
        }));
    }
    /**
     * Finds active local handoffs owned by one worker.
     * @param {{workerId: string}} args - Worker identity.
     * @returns {Promise<Array<{jobId: string, handoffId: string}>>} - Active worker handoffs.
     */
    async handedOffJobsForWorker({ workerId }) {
        await this.ensureReady();
        const rows = await this._withDb(async (db) => await db
            .newQuery()
            .from(LOCAL_BACKGROUND_JOBS_TABLE)
            .where({ status: "handed_off", worker_id: workerId })
            .results());
        /** @type {Array<{jobId: string, handoffId: string}>} */
        const handoffs = [];
        for (const rawRow of rows) {
            const job = this._normalizeRow(rawRow);
            if (job.handoffId)
                handoffs.push({ jobId: job.id, handoffId: job.handoffId });
        }
        return handoffs;
    }
    /**
     * Returns an exact active handoff to the queue.
     * @param {{jobId: string, handoffId: string}} args - Handoff release.
     * @returns {Promise<void>} - Resolves after the fenced release.
     */
    async markReturnedToQueue({ jobId, handoffId }) {
        await this.ensureReady();
        await this._withDb(async (connection) => await this._mutate(connection, async (db) => {
            const job = await this._getJob(db, jobId);
            if (!this._acceptsHandoff(job, handoffId))
                return;
            await this._lockConcurrencyRow(db, job.concurrencyKey);
            const affectedRows = await this._updateAffectedRows(db, {
                conditions: { handoff_id: handoffId, id: jobId, status: "handed_off" },
                data: {
                    handed_off_at_ms: null,
                    handoff_id: null,
                    scheduled_at_ms: this.clock.now(),
                    status: "queued",
                    worker_id: null
                },
                tableName: LOCAL_BACKGROUND_JOBS_TABLE
            });
            if (affectedRows === 1)
                await this._releaseConcurrency(db, job.concurrencyKey);
        }));
    }
    /**
     * Applies a fenced successful acknowledgement.
     * @param {{jobId: string, handoffId?: string}} args - Completion report.
     * @returns {Promise<boolean>} - Whether the lease won.
     */
    async markCompleted({ jobId, handoffId }) {
        await this.ensureReady();
        return await this._withDb(async (connection) => await this._mutate(connection, async (db) => {
            const job = await this._getJob(db, jobId);
            if (!this._acceptsHandoff(job, handoffId))
                return false;
            await this._lockConcurrencyRow(db, job.concurrencyKey);
            const affectedRows = await this._updateAffectedRows(db, {
                conditions: { handoff_id: handoffId, id: jobId, status: "handed_off" },
                data: { completed_at_ms: this.clock.now(), status: "completed" },
                tableName: LOCAL_BACKGROUND_JOBS_TABLE
            });
            if (affectedRows !== 1)
                return false;
            await this._releaseConcurrency(db, job.concurrencyKey);
            return true;
        }));
    }
    /**
     * Applies a fenced reschedule without consuming an attempt.
     * @param {{jobId: string, handoffId?: string, delayMs: number}} args - Reschedule report.
     * @returns {Promise<boolean>} - Whether the lease won.
     */
    async markRescheduled({ jobId, handoffId, delayMs }) {
        await this.ensureReady();
        return await this._withDb(async (connection) => await this._mutate(connection, async (db) => {
            const job = await this._getJob(db, jobId);
            if (!this._acceptsHandoff(job, handoffId))
                return false;
            await this._lockConcurrencyRow(db, job.concurrencyKey);
            const affectedRows = await this._updateAffectedRows(db, {
                conditions: { handoff_id: handoffId, id: jobId, status: "handed_off" },
                data: {
                    handed_off_at_ms: null,
                    handoff_id: null,
                    scheduled_at_ms: rescheduledBackgroundJobAtMs(delayMs, this.clock.now()),
                    status: "queued",
                    worker_id: null
                },
                tableName: LOCAL_BACKGROUND_JOBS_TABLE
            });
            if (affectedRows !== 1)
                return false;
            await this._releaseConcurrency(db, job.concurrencyKey);
            return true;
        }));
    }
    /**
     * Applies a fenced failure, retry, or terminal transition.
     * @param {{jobId: string, handoffId?: string, error: ReturnType<typeof JSON.parse>}} args - Failure report.
     * @returns {Promise<import("./types.js").BackgroundJobRow | null>} - Accepted transition snapshot.
     */
    async markFailed({ jobId, handoffId, error }) {
        await this.ensureReady();
        return await this._withDb(async (connection) => await this._mutate(connection, async (db) => {
            const job = await this._getJob(db, jobId);
            if (!this._acceptsHandoff(job, handoffId))
                return null;
            return await this._applyFailure(db, job, error);
        }));
    }
    /**
     * Turns every abandoned local handoff into the normal failure/retry path.
     * @returns {Promise<import("./types.js").BackgroundJobRow[]>} - Recovered transitions.
     */
    async recoverHandedOffJobs() {
        await this.ensureReady();
        return await this._withDb(async (connection) => await this._mutate(connection, async (db) => {
            const queues = this.configuration.getBackgroundJobsConfig().queues;
            const rows = await db.newQuery().from(LOCAL_BACKGROUND_JOBS_TABLE).where({ status: "handed_off" }).results();
            /** @type {import("./types.js").BackgroundJobRow[]} */
            const recovered = [];
            for (const rawRow of rows) {
                const job = this._normalizeRow(rawRow);
                const updated = await this._applyFailure(db, job, new Error("Local background job recovered after an interrupted dispatcher"));
                if (!updated)
                    continue;
                const reconciled = updated.status === "queued"
                    ? await this._reconcileQueuedJobConcurrency(db, updated, queues)
                    : updated;
                recovered.push(reconciled);
            }
            await this._rebuildConcurrencyCounts(db);
            return recovered;
        }));
    }
    /**
     * Deletes local queue state for focused tests.
     * @returns {Promise<void>} - Resolves after deletion.
     */
    async clearAll() {
        await this.ensureReady();
        await this._withDb(async (connection) => await this._mutate(connection, async (db) => {
            await db.query(`DELETE FROM ${db.quoteTable(LOCAL_BACKGROUND_JOBS_TABLE)}`);
            await db.query(`DELETE FROM ${db.quoteTable(LOCAL_BACKGROUND_JOB_CONCURRENCY_TABLE)}`);
        }));
    }
    /**
     * Applies the common retry or exhausted failure transition.
     * @param {import("../database/drivers/base.js").default} db - Local SQLite connection.
     * @param {import("./types.js").BackgroundJobRow} job - Active handoff.
     * @param {ReturnType<typeof JSON.parse>} error - Performance error.
     * @returns {Promise<import("./types.js").BackgroundJobRow | null>} - Transition snapshot.
     */
    async _applyFailure(db, job, error) {
        const attempts = (job.attempts || 0) + 1;
        const maxRetries = normalizeBackgroundJobMaxRetries(job.maxRetries);
        const willRetry = attempts <= maxRetries;
        const nowMs = this.clock.now();
        /** @type {Record<string, ReturnType<typeof JSON.parse>>} */
        const data = {
            attempts,
            handed_off_at_ms: null,
            handoff_id: null,
            last_error: normalizeBackgroundJobError(error),
            status: willRetry ? "queued" : "failed",
            worker_id: null
        };
        if (willRetry) {
            Object.assign(data, { scheduled_at_ms: nowMs + retryDelayMs(attempts) });
        }
        else {
            Object.assign(data, { failed_at_ms: nowMs });
        }
        await this._lockConcurrencyRow(db, job.concurrencyKey);
        const affectedRows = await this._updateAffectedRows(db, {
            conditions: { handoff_id: job.handoffId, id: job.id, status: "handed_off" },
            data,
            tableName: LOCAL_BACKGROUND_JOBS_TABLE
        });
        if (affectedRows !== 1)
            return null;
        await this._releaseConcurrency(db, job.concurrencyKey);
        return {
            ...job,
            attempts,
            failedAtMs: willRetry ? job.failedAtMs : nowMs,
            handedOffAtMs: null,
            handoffId: null,
            lastError: data.last_error,
            scheduledAtMs: willRetry ? Number(data.scheduled_at_ms) : job.scheduledAtMs,
            status: data.status,
            workerId: null
        };
    }
    /**
     * Ensures that a durable concurrency counter exists with the required cap.
     * @param {import("../database/drivers/base.js").default} db - Local SQLite connection.
     * @param {import("./types.js").ResolvedBackgroundJobConcurrency} concurrency - Desired counter.
     * @returns {Promise<void>} - Resolves when ensured.
     */
    async _ensureConcurrency(db, concurrency) {
        await db.upsert({
            conflictColumns: ["concurrency_key"],
            data: { active_count: 0, concurrency_key: concurrency.concurrencyKey, max_concurrency: concurrency.maxConcurrency },
            tableName: LOCAL_BACKGROUND_JOB_CONCURRENCY_TABLE,
            updateColumns: ["concurrency_key"]
        });
        const rows = await db
            .newQuery()
            .from(LOCAL_BACKGROUND_JOB_CONCURRENCY_TABLE)
            .where({ concurrency_key: concurrency.concurrencyKey })
            .limit(1)
            .results();
        const existingRow = /** @type {{max_concurrency: number | string}} */ (rows[0]);
        const existingCap = Number(existingRow.max_concurrency);
        if (existingCap === concurrency.maxConcurrency)
            return;
        if (!concurrency.queueDerived)
            throw new Error(`Conflicting maxConcurrency for background job concurrencyKey: ${concurrency.concurrencyKey}`);
        await db.update({
            conditions: { concurrency_key: concurrency.concurrencyKey },
            data: { max_concurrency: concurrency.maxConcurrency },
            tableName: LOCAL_BACKGROUND_JOB_CONCURRENCY_TABLE
        });
    }
    /**
     * Atomically reserves one slot for a concurrency key.
     * @param {import("../database/drivers/base.js").default} db - Connection.
     * @param {string} concurrencyKey - Concurrency key.
     * @returns {Promise<boolean>} - Whether a slot was reserved.
     */
    async _reserveConcurrency(db, concurrencyKey) {
        const table = db.quoteTable(LOCAL_BACKGROUND_JOB_CONCURRENCY_TABLE);
        const count = db.quoteColumn("active_count");
        const affectedRows = await db.affectedRows(`UPDATE ${table} SET ${count} = ${count} + 1 ` +
            `WHERE ${db.quoteColumn("concurrency_key")} = ${db.quote(concurrencyKey)} ` +
            `AND ${count} < ${db.quoteColumn("max_concurrency")}`);
        return affectedRows === 1;
    }
    /**
     * Releases one slot for a concurrency key.
     * @param {import("../database/drivers/base.js").default} db - Connection.
     * @param {string | null} concurrencyKey - Concurrency key.
     * @returns {Promise<void>} - Resolves after release.
     */
    async _releaseConcurrency(db, concurrencyKey) {
        if (!concurrencyKey)
            return;
        const table = db.quoteTable(LOCAL_BACKGROUND_JOB_CONCURRENCY_TABLE);
        const count = db.quoteColumn("active_count");
        await db.affectedRows(`UPDATE ${table} SET ${count} = ${count} - 1 ` +
            `WHERE ${db.quoteColumn("concurrency_key")} = ${db.quote(concurrencyKey)} AND ${count} > 0`);
    }
    /**
     * Acquires the transaction's write lock for a concurrency counter row.
     * @param {import("../database/drivers/base.js").default} db - Connection.
     * @param {string | null} concurrencyKey - Concurrency key.
     * @returns {Promise<void>} - Resolves after locking.
     */
    async _lockConcurrencyRow(db, concurrencyKey) {
        if (!concurrencyKey)
            return;
        const table = db.quoteTable(LOCAL_BACKGROUND_JOB_CONCURRENCY_TABLE);
        const count = db.quoteColumn("active_count");
        await db.query(`UPDATE ${table} SET ${count} = ${count} ` +
            `WHERE ${db.quoteColumn("concurrency_key")} = ${db.quote(concurrencyKey)}`);
    }
    /**
     * Rebuilds active counters from durable handed-off jobs.
     * @param {import("../database/drivers/base.js").default} db - Connection.
     * @returns {Promise<void>} - Resolves after counter rebuild.
     */
    async _rebuildConcurrencyCounts(db) {
        const concurrencyTable = db.quoteTable(LOCAL_BACKGROUND_JOB_CONCURRENCY_TABLE);
        const jobsTable = db.quoteTable(LOCAL_BACKGROUND_JOBS_TABLE);
        await db.query(`UPDATE ${concurrencyTable} SET ${db.quoteColumn("active_count")} = (` +
            `SELECT COUNT(*) FROM ${jobsTable} WHERE ${jobsTable}.${db.quoteColumn("status")} = ${db.quote("handed_off")} AND ` +
            `${jobsTable}.${db.quoteColumn("concurrency_key")} = ${concurrencyTable}.${db.quoteColumn("concurrency_key")})`);
    }
    /**
     * Builds the configured queue-priority ordering expression.
     * @param {import("../database/drivers/base.js").default} db - Connection.
     * @returns {string | null} - Queue priority expression.
     */
    _queuePriorityOrderSql(db) {
        const queues = this.configuration.getBackgroundJobsConfig().queues;
        const prioritized = Object.entries(queues)
            .filter(([, queue]) => Number.isFinite(queue?.priority) && Number(queue.priority) !== 0)
            .map(([queueName, queue]) => [queueName, Number(queue.priority)]);
        if (prioritized.length === 0)
            return null;
        const whens = prioritized
            .map(([queue, priority]) => `WHEN ${db.quote(queue)} THEN ${priority}`)
            .join(" ");
        return `CASE COALESCE(${db.quoteColumn("queue")}, ${db.quote(DEFAULT_BACKGROUND_JOB_QUEUE)}) ${whens} ELSE 0 END`;
    }
    /**
     * Checks whether a persisted handoff owns the supplied acknowledgement fence.
     * @param {import("./types.js").BackgroundJobRow | null} job - Persisted job.
     * @param {string | undefined} handoffId - Handoff fence.
     * @returns {job is import("./types.js").BackgroundJobRow} - Whether accepted.
     */
    _acceptsHandoff(job, handoffId) {
        return Boolean(job && job.status === "handed_off" && job.handoffId && job.handoffId === handoffId);
    }
    /**
     * Finds a persisted local job using the current connection.
     * @param {import("../database/drivers/base.js").default} db - Connection.
     * @param {string} jobId - Job id.
     * @returns {Promise<import("./types.js").BackgroundJobRow | null>} - Persisted row.
     */
    async _getJob(db, jobId) {
        const rows = await db.newQuery().from(LOCAL_BACKGROUND_JOBS_TABLE).where({ id: jobId }).limit(1).results();
        return rows[0] ? this._normalizeRow(rows[0]) : null;
    }
    /**
     * Normalizes one raw local database row.
     * @param {Record<string, ReturnType<typeof JSON.parse>>} row - Raw row.
     * @returns {import("./types.js").BackgroundJobRow} - Normalized row.
     */
    _normalizeRow(row) {
        const parsedArgs = JSON.parse(String(row.args_json));
        const executionMode = normalizeBackgroundJobExecutionMode({ executionMode: String(row.execution_mode) }, "inline", LOCAL_EXECUTION_MODES);
        if (!Array.isArray(parsedArgs))
            throw new Error(`Invalid local background job args_json for job: ${String(row.id)}`);
        if (executionMode !== "inline")
            throw new Error("Local background job execution mode invariant was violated");
        return {
            args: parsedArgs,
            attempts: this._numberOrNull(row.attempts),
            completedAtMs: this._numberOrNull(row.completed_at_ms),
            concurrencyKey: row.concurrency_key === null || row.concurrency_key === undefined ? null : String(row.concurrency_key),
            createdAtMs: this._numberOrNull(row.created_at_ms),
            executionMode,
            failedAtMs: this._numberOrNull(row.failed_at_ms),
            handedOffAtMs: this._numberOrNull(row.handed_off_at_ms),
            handoffId: row.handoff_id === null || row.handoff_id === undefined ? null : String(row.handoff_id),
            id: String(row.id),
            jobName: String(row.job_name),
            lastError: row.last_error === null || row.last_error === undefined ? null : String(row.last_error),
            maxConcurrency: this._numberOrNull(row.max_concurrency),
            maxRetries: this._numberOrNull(row.max_retries),
            orphanedAtMs: null,
            queue: row.queue ? String(row.queue) : DEFAULT_BACKGROUND_JOB_QUEUE,
            scheduleKey: null,
            scheduledAtMs: this._numberOrNull(row.scheduled_at_ms),
            status: row.status ? String(row.status) : "queued",
            timeoutMs: null,
            workerId: row.worker_id === null || row.worker_id === undefined ? null : String(row.worker_id)
        };
    }
    /**
     * Normalizes one nullable database number.
     * @param {ReturnType<typeof JSON.parse>} value - Database number.
     * @returns {number | null} - Normalized number.
     */
    _numberOrNull(value) {
        if (value === null || value === undefined || value === "")
            return null;
        const number = Number(value);
        return Number.isNaN(number) ? null : number;
    }
    /**
     * Executes a structured update and reports its affected-row count.
     * @param {import("../database/drivers/base.js").default} db - Connection.
     * @param {import("../database/drivers/base.js").UpdateSqlArgsType} args - Update arguments.
     * @returns {Promise<number>} - Affected rows.
     */
    async _updateAffectedRows(db, args) { return await db.affectedRows(db.updateSql(args)); }
    /**
     * Joins an ambient app transaction or uses the database's scoped operation lease.
     * @template T
     * @param {import("../database/drivers/base.js").default} db - Connection.
     * @param {(db: import("../database/drivers/base.js").default) => Promise<T>} callback - Mutation.
     * @returns {Promise<T>} - Mutation result.
     */
    async _mutate(db, callback) {
        if (db.insideTransaction())
            return await this._transactionResult(db, async () => await callback(db));
        return await this.configuration.withTransaction({
            databaseIdentifier: this.getDatabaseIdentifier(),
            name: "Local background jobs mutation"
        }, async (operation) => await callback(operation.connection()));
    }
    /**
     * Runs a callback in a transaction and returns its captured result.
     * @template T
     * @param {import("../database/drivers/base.js").default} db - Connection.
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
            throw new Error("Local background jobs transaction callback was not invoked");
        return /** @type {T} */ (result);
    }
    /**
     * Runs a callback with the configured local database connection.
     * @template T
     * @param {(db: import("../database/drivers/base.js").default) => Promise<T>} callback - Connection callback.
     * @returns {Promise<T>} - Callback result.
     */
    async _withDb(callback) {
        const databaseIdentifier = this.getDatabaseIdentifier();
        return await this.configuration.ensureConnections({ databaseIdentifiers: [databaseIdentifier], name: "Local background jobs store" }, async (dbs) => {
            const db = dbs[databaseIdentifier];
            if (!db)
                throw new Error(`No local background-jobs database connection available for identifier: ${databaseIdentifier}`);
            return await callback(db);
        });
    }
    /**
     * Reports an unexpected local-store failure through framework channels.
     * @param {{error: Error, stage: string}} args - Error report.
     * @returns {void} - No return value.
     */
    _reportFrameworkError({ error, stage }) {
        const payload = { context: { stage }, error };
        const errorEvents = this.configuration.getErrorEvents();
        errorEvents.emit("framework-error", payload);
        errorEvents.emit("all-error", { ...payload, errorType: "framework-error" });
    }
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoibG9jYWwtc3RvcmUuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi9zcmMvYmFja2dyb3VuZC1qb2JzL2xvY2FsLXN0b3JlLmpzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiJBQUFBLFlBQVk7QUFFWixPQUFPLElBQUksTUFBTSxXQUFXLENBQUE7QUFFNUIsT0FBTyxTQUFTLE1BQU0saUNBQWlDLENBQUE7QUFDdkQsT0FBTyxVQUFVLE1BQU0sdUNBQXVDLENBQUE7QUFDOUQsT0FBTyxTQUFTLE1BQU0sd0JBQXdCLENBQUE7QUFDOUMsT0FBTywyQkFBMkIsTUFBTSxzQkFBc0IsQ0FBQTtBQUM5RCxPQUFPLEVBQ0wsNEJBQTRCLEVBQzVCLDRCQUE0QixFQUM1QixpQ0FBaUMsRUFDakMsbUNBQW1DLEVBQ25DLGdDQUFnQyxFQUNoQywyQkFBMkIsRUFDM0IsbUNBQW1DLEVBQ25DLDRCQUE0QixFQUM1QixZQUFZLEVBQ2IsTUFBTSxvQkFBb0IsQ0FBQTtBQUUzQixNQUFNLENBQUMsTUFBTSwyQkFBMkIsR0FBRyxpQ0FBaUMsQ0FBQTtBQUM1RSxNQUFNLENBQUMsTUFBTSxzQ0FBc0MsR0FBRyw0Q0FBNEMsQ0FBQTtBQUNsRyxNQUFNLGdCQUFnQixHQUFHLCtCQUErQixDQUFBO0FBQ3hELE1BQU0sZUFBZSxHQUFHLHVCQUF1QixDQUFBO0FBQy9DLE1BQU0saUJBQWlCLEdBQUcsR0FBRyxDQUFBO0FBQzdCLE1BQU0scUJBQXFCLEdBQUcsQ0FBQyxvQkFBb0IsQ0FBQyxDQUFDLFFBQVEsQ0FBQyxDQUFDLENBQUE7QUFDL0QsTUFBTSxDQUFDLE1BQU0saUNBQWlDLEdBQUc7SUFDL0MsMkNBQTJDO0lBQzNDLG9EQUFvRDtJQUNwRCxxREFBcUQ7SUFDckQsbURBQW1EO0NBQ3BELENBQUE7QUFDRCxNQUFNLG9CQUFvQixHQUFHO0lBQzNCLElBQUk7SUFDSixVQUFVO0lBQ1YsV0FBVztJQUNYLGFBQWE7SUFDYixnQkFBZ0I7SUFDaEIsT0FBTztJQUNQLGFB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LENBQUMsT0FBTyxDQUFDLFFBQVE7UUFDcEIsTUFBTSxrQkFBa0IsR0FBRyxJQUFJLENBQUMscUJBQXFCLEVBQUUsQ0FBQTtRQUV2RCxPQUFPLE1BQU0sSUFBSSxDQUFDLGFBQWEsQ0FBQyxpQkFBaUIsQ0FBQyxFQUFDLG1CQUFtQixFQUFFLENBQUMsa0JBQWtCLENBQUMsRUFBRSxJQUFJLEVBQUUsNkJBQTZCLEVBQUMsRUFBRSxLQUFLLEVBQUUsR0FBRyxFQUFFLEVBQUU7WUFDaEosTUFBTSxFQUFFLEdBQUcsR0FBRyxDQUFDLGtCQUFrQixDQUFDLENBQUE7WUFFbEMsSUFBSSxDQUFDLEVBQUU7Z0JBQUUsTUFBTSxJQUFJLEtBQUssQ0FBQywwRUFBMEUsa0JBQWtCLEVBQUUsQ0FBQyxDQUFBO1lBRXhILE9BQU8sTUFBTSxRQUFRLENBQUMsRUFBRSxDQUFDLENBQUE7UUFDM0IsQ0FBQyxDQUFDLENBQUE7SUFDSixDQUFDO0lBRUQ7Ozs7T0FJRztJQUNILHFCQUFxQixDQUFDLEVBQUMsS0FBSyxFQUFFLEtBQUssRUFBQztRQUNsQyxNQUFNLE9BQU8sR0FBRyxFQUFDLE9BQU8sRUFBRSxFQUFDLEtBQUssRUFBQyxFQUFFLEtBQUssRUFBQyxDQUFBO1FBQ3pDLE1BQU0sV0FBVyxHQUFHLElBQUksQ0FBQyxhQUFhLENBQUMsY0FBYyxFQUFFLENBQUE7UUFFdkQsV0FBVyxDQUFDLElBQUksQ0FBQyxpQkFBaUIsRUFBRSxPQUFPLENBQUMsQ0FBQTtRQUM1QyxXQUFXLENBQUMsSUFBSSxDQUFDLFdBQVcsRUFBRSxFQUFDLEdBQUcsT0FBTyxFQUFFLFNBQVMsRUFBRSxpQkFBaUIsRUFBQyxDQUFDLENBQUE7SUFDM0UsQ0FBQztDQUNGIiwic291cmNlc0NvbnRlbnQiOlsiLy8gQHRzLWNoZWNrXG5cbmltcG9ydCBVVUlEIGZyb20gXCJwdXJlLXV1aWRcIlxuXG5pbXBvcnQgVGFibGVEYXRhIGZyb20gXCIuLi9kYXRhYmFzZS90YWJsZS1kYXRhL2luZGV4LmpzXCJcbmltcG9ydCBUYWJsZUluZGV4IGZyb20gXCIuLi9kYXRhYmFzZS90YWJsZS1kYXRhL3RhYmxlLWluZGV4LmpzXCJcbmltcG9ydCBzaGEyNTZIZXggZnJvbSBcIi4uL3V0aWxzL3NoYTI1Ni1oZXguanNcIlxuaW1wb3J0IG5vcm1hbGl6ZUJhY2tncm91bmRKb2JFcnJvciBmcm9tIFwiLi9ub3JtYWxpemUtZXJyb3IuanNcIlxuaW1wb3J0IHtcbiAgREVGQVVMVF9CQUNLR1JPVU5EX0pPQl9RVUVVRSxcbiAgUVVFVUVfQ09OQ1VSUkVOQ1lfS0VZX1BSRUZJWCxcbiAgbm9ybWFsaXplQmFja2dyb3VuZEpvYkNvbmN1cnJlbmN5LFxuICBub3JtYWxpemVCYWNrZ3JvdW5kSm9iRXhlY3V0aW9uTW9kZSxcbiAgbm9ybWFsaXplQmFja2dyb3VuZEpvYk1heFJldHJpZXMsXG4gIG5vcm1hbGl6ZUJhY2tncm91bmRKb2JRdWV1ZSxcbiAgbm9ybWFsaXplQmFja2dyb3VuZEpvYlNjaGVkdWxlZEF0TXMsXG4gIHJlc2NoZWR1bGVkQmFja2dyb3VuZEpvYkF0TXMsXG4gIHJldHJ5RGVsYXlNc1xufSBmcm9tIFwiLi9qb2Itc2VtYW50aWNzLmpzXCJcblxuZXhwb3J0IGNvbnN0IExPQ0FMX0JBQ0tHUk9VTkRfSk9CU19UQUJMRSA9IFwidmVsb2Npb3VzX2xvY2FsX2JhY2tncm91bmRfam9ic1wiXG5leHBvcnQgY29uc3QgTE9DQUxfQkFDS0dST1VORF9KT0JfQ09OQ1VSUkVOQ1lfVEFCTEUgPSBcInZlbG9jaW91c19sb2NhbF9iYWNrZ3JvdW5kX2pvYl9jb25jdXJyZW5jeVwiXG5jb25zdCBNSUdSQVRJT05TX1RBQkxFID0gXCJ2ZWxvY2lvdXNfaW50ZXJuYWxfbWlncmF0aW9uc1wiXG5jb25zdCBNSUdSQVRJT05fU0NPUEUgPSBcImxvY2FsX2JhY2tncm91bmRfam9ic1wiXG5jb25zdCBNSUdSQVRJT05fVkVSU0lPTiA9IFwiMVwiXG5jb25zdCBMT0NBTF9FWEVDVVRJT05fTU9ERVMgPSBbLyoqIEB0eXBlIHtjb25zdH0gKi8gKFwiaW5saW5lXCIpXVxuZXhwb3J0IGNvbnN0IExPQ0FMX0JBQ0tHUk9VTkRfSk9CU19JTkRFWF9OQU1FUyA9IFtcbiAgXCJpbmRleF92ZWxvY2lvdXNfbG9jYWxfYmFja2dyb3VuZF9qb2JzX2R1ZVwiLFxuICBcImluZGV4X3ZlbG9jaW91c19sb2NhbF9iYWNrZ3JvdW5kX2pvYnNfcXVldWVfc3RhdHVzXCIsXG4gIFwiaW5kZXhfdmVsb2Npb3VzX2xvY2FsX2JhY2tncm91bmRfam9ic19kZWR1cGxpY2F0aW9uXCIsXG4gIFwiaW5kZXhfdmVsb2Npb3VzX2xvY2FsX2JhY2tncm91bmRfam9ic19jb25jdXJyZW5jeVwiXG5dXG5jb25zdCBFWFBFQ1RFRF9KT0JfQ09MVU1OUyA9IFtcbiAgXCJpZFwiLFxuICBcImpvYl9uYW1lXCIsXG4gIFwiYXJnc19qc29uXCIsXG4gIFwiYXJnc19kaWdlc3RcIixcbiAgXCJleGVjdXRpb25fbW9kZVwiLFxuICBcInF1ZXVlXCIsXG4gIFwibWF4X3JldHJpZXNcIixcbiAgXCJhdHRlbXB0c1wiLFxuICBcInN0YXR1c1wiLFxuICBcInNjaGVkdWxlZF9hdF9tc1wiLFxuICBcImNyZWF0ZWRfYXRfbXNcIixcbiAgXCJoYW5kZWRfb2ZmX2F0X21zXCIsXG4gIFwiaGFuZG9mZl9pZFwiLFxuICBcIndvcmtlcl9pZFwiLFxuICBcImNvbXBsZXRlZF9hdF9tc1wiLFxuICBcImZhaWxlZF9hdF9tc1wiLFxuICBcImxhc3RfZXJyb3JcIixcbiAgXCJjb25jdXJyZW5jeV9rZXlcIixcbiAgXCJtYXhfY29uY3VycmVuY3lcIlxuXVxuY29uc3QgRVhQRUNURURfQ09OQ1VSUkVOQ1lfQ09MVU1OUyA9IFtcImNvbmN1cnJlbmN5X2tleVwiLCBcIm1heF9jb25jdXJyZW5jeVwiLCBcImFjdGl2ZV9jb3VudFwiXVxuLyoqIEB0eXBlIHtXZWFrTWFwPGltcG9ydChcIi4uL2NvbmZpZ3VyYXRpb24uanNcIikuZGVmYXVsdCwgTWFwPHN0cmluZywgUHJvbWlzZTx2b2lkPj4+fSAqL1xuY29uc3QgZGVkdXBsaWNhdGVkRW5xdWV1ZUNoYWlucyA9IG5ldyBXZWFrTWFwKClcblxuLyoqXG4gKiBDcmVhdGVzIHRoZSBwcm9kdWN0aW9uIGNsb2NrIHVzZWQgYnkgbG9jYWwgZGlzcGF0Y2guXG4gKiBAcmV0dXJucyB7aW1wb3J0KFwiLi90eXBlcy5qc1wiKS5Mb2NhbEJhY2tncm91bmRKb2JzQ2xvY2t9IC0gUHJvZHVjdGlvbiBjbG9jay5cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGxvY2FsQmFja2dyb3VuZEpvYnNDbG9jaygpIHtcbiAgcmV0dXJuIHtcbiAgICBjbGVhclRpbWVvdXQ6ICh0aW1lcklkKSA9PiBnbG9iYWxUaGlzLmNsZWFyVGltZW91dCh0aW1lcklkKSxcbiAgICBub3c6ICgpID0+IERhdGUubm93KCksXG4gICAgc2V0VGltZW91dDogKGNhbGxiYWNrLCBkZWxheU1zKSA9PiBnbG9iYWxUaGlzLnNldFRpbWVvdXQoY2FsbGJhY2ssIGRlbGF5TXMpXG4gIH1cbn1cblxuLyoqIE5hbWVzcGFjZWQgcG9ydGFibGUgU1FMaXRlIHBlcnNpc3RlbmNlIGZvciBsb2NhbCBiYWNrZ3JvdW5kIGpvYnMuICovXG5leHBvcnQgZGVmYXVsdCBjbGFzcyBMb2NhbEJhY2tncm91bmRKb2JzU3RvcmUge1xuICAvKipcbiAgICogQ3JlYXRlcyBhIHN0b3JlIGZvciBvbmUgY29uZmlndXJhdGlvbiBhbmQgbG9jYWwgZGF0YWJhc2UuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gU3RvcmUgb3B0aW9ucy5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9jb25maWd1cmF0aW9uLmpzXCIpLmRlZmF1bHR9IGFyZ3MuY29uZmlndXJhdGlvbiAtIE93bmluZyBjb25maWd1cmF0aW9uLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vdHlwZXMuanNcIikuTG9jYWxCYWNrZ3JvdW5kSm9ic0Nsb2NrfSBbYXJncy5jbG9ja10gLSBQZXJzaXN0ZW5jZSBjbG9jay5cbiAgICogQHBhcmFtIHtzdHJpbmd9IFthcmdzLmRhdGFiYXNlSWRlbnRpZmllcl0gLSBDb25maWd1cmVkIGxvY2FsIGRhdGFiYXNlIGlkZW50aWZpZXIuXG4gICAqIEBwYXJhbSB7KCkgPT4gdm9pZH0gW2FyZ3Mub25Db21taXR0ZWRFbnF1ZXVlXSAtIENvbW1pdC1hd2FyZSBkaXNwYXRjaGVyIHdha2UuXG4gICAqL1xuICBjb25zdHJ1Y3Rvcih7Y29uZmlndXJhdGlvbiwgY2xvY2sgPSBsb2NhbEJhY2tncm91bmRKb2JzQ2xvY2soKSwgZGF0YWJhc2VJZGVudGlmaWVyLCBvbkNvbW1pdHRlZEVucXVldWV9KSB7XG4gICAgdGhpcy5jbG9jayA9IGNsb2NrXG4gICAgdGhpcy5jb25maWd1cmF0aW9uID0gY29uZmlndXJhdGlvblxuICAgIHRoaXMuZGF0YWJhc2VJZGVudGlmaWVyID0gZGF0YWJhc2VJZGVudGlmaWVyXG4gICAgdGhpcy5vbkNvbW1pdHRlZEVucXVldWUgPSBvbkNvbW1pdHRlZEVucXVldWVcbiAgICB0aGlzLl9pc1JlYWR5ID0gZmFsc2VcbiAgICAvKiogQHR5cGUge1Byb21pc2U8dm9pZD4gfCBudWxsfSAqL1xuICAgIHRoaXMuX3JlYWR5UHJvbWlzZSA9IG51bGxcbiAgICAvKiogQHR5cGUge1dlYWtNYXA8aW1wb3J0KFwiLi4vZGF0YWJhc2UvZHJpdmVycy9iYXNlLmpzXCIpLmRlZmF1bHQsIHtjb21wbGV0aW9uOiBQcm9taXNlPHZvaWQ+LCBwcm9taXNlOiBQcm9taXNlPHZvaWQ+fT59ICovXG4gICAgdGhpcy5fdHJhbnNhY3Rpb25SZWFkeVByb21pc2VzID0gbmV3IFdlYWtNYXAoKVxuICB9XG5cbiAgLyoqXG4gICAqIFJlc29sdmVzIHRoZSBjb25maWd1cmVkIGxvY2FsIGRhdGFiYXNlIGlkZW50aWZpZXIuXG4gICAqIEByZXR1cm5zIHtzdHJpbmd9IC0gRGF0YWJhc2UgaWRlbnRpZmllci5cbiAgICovXG4gIGdldERhdGFiYXNlSWRlbnRpZmllcigpIHtcbiAgICByZXR1cm4gdGhpcy5kYXRhYmFzZUlkZW50aWZpZXIgfHwgdGhpcy5jb25maWd1cmF0aW9uLmdldEJhY2tncm91bmRKb2JzQ29uZmlnKCkuZGF0YWJhc2VJZGVudGlmaWVyXG4gIH1cblxuICAvKipcbiAgICogRW5zdXJlcyB0aGUgdmVyc2lvbmVkIHBoeXNpY2FsIHNjaGVtYSBleGlzdHMuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIHdoZW4gcmVhZHkuXG4gICAqL1xuICBhc3luYyBlbnN1cmVSZWFkeSgpIHtcbiAgICBpZiAodGhpcy5faXNSZWFkeSkgcmV0dXJuXG5cbiAgICBhd2FpdCB0aGlzLl93aXRoRGIoYXN5bmMgKGRiKSA9PiBhd2FpdCB0aGlzLl9lbnN1cmVSZWFkeVdpdGhEYihkYikpXG4gIH1cblxuICAvKipcbiAgICogQ2xlYXJzIHRoZSBwZXItaW5zdGFuY2UgcmVhZGluZXNzIGxhdGNoIGZvciBhIGRlbGliZXJhdGUgYWRhcHRlciByZW9wZW4uXG4gICAqIEByZXR1cm5zIHt2b2lkfSAtIE5vIHJldHVybiB2YWx1ZS5cbiAgICovXG4gIHJlc2V0UmVhZGluZXNzKCkge1xuICAgIHRoaXMuX2lzUmVhZHkgPSBmYWxzZVxuICAgIHRoaXMuX3JlYWR5UHJvbWlzZSA9IG51bGxcbiAgICB0aGlzLl90cmFuc2FjdGlvblJlYWR5UHJvbWlzZXMgPSBuZXcgV2Vha01hcCgpXG4gIH1cblxuICAvKipcbiAgICogQ29vcmRpbmF0ZXMgcGh5c2ljYWwgYW5kIHRyYW5zYWN0aW9uLWxvY2FsIHNjaGVtYSByZWFkaW5lc3MuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vZGF0YWJhc2UvZHJpdmVycy9iYXNlLmpzXCIpLmRlZmF1bHR9IGRiIC0gTG9jYWwgU1FMaXRlIGNvbm5lY3Rpb24uXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIHdoZW4gdGhpcyBjYWxsZXIgY2FuIHVzZSB0aGUgc2NoZW1hLlxuICAgKi9cbiAgYXN5bmMgX2Vuc3VyZVJlYWR5V2l0aERiKGRiKSB7XG4gICAgaWYgKHRoaXMuX2lzUmVhZHkpIHJldHVyblxuXG4gICAgY29uc3QgdHJhbnNhY3Rpb25Db21wbGV0aW9uID0gZGIuaW5zaWRlVHJhbnNhY3Rpb24oKSA/IGRiLnRyYW5zYWN0aW9uQ29tcGxldGlvbigpIDogbnVsbFxuICAgIGNvbnN0IHRyYW5zYWN0aW9uUmVhZHkgPSB0aGlzLl90cmFuc2FjdGlvblJlYWR5UHJvbWlzZXMuZ2V0KGRiKVxuXG4gICAgaWYgKHRyYW5zYWN0aW9uQ29tcGxldGlvbiAmJiB0cmFuc2FjdGlvblJlYWR5Py5jb21wbGV0aW9uID09PSB0cmFuc2FjdGlvbkNvbXBsZXRpb24pIHtcbiAgICAgIGF3YWl0IHRyYW5zYWN0aW9uUmVhZHkucHJvbWlzZVxuICAgICAgcmV0dXJuXG4gICAgfVxuXG4gICAgaWYgKHRoaXMuX3JlYWR5UHJvbWlzZSkge1xuICAgICAgY29uc3QgcmVhZHlQcm9taXNlID0gdGhpcy5fcmVhZHlQcm9taXNlXG5cbiAgICAgIGF3YWl0IHJlYWR5UHJvbWlzZVxuICAgICAgaWYgKHRoaXMuX3JlYWR5UHJvbWlzZSA9PT0gcmVhZHlQcm9taXNlKSB0aGlzLl9yZWFkeVByb21pc2UgPSBudWxsXG4gICAgICBpZiAodGhpcy5faXNSZWFkeSkgcmV0dXJuXG5cbiAgICAgIGF3YWl0IHRoaXMuZW5zdXJlUmVhZHkoKVxuICAgICAgcmV0dXJuXG4gICAgfVxuXG4gICAgaWYgKHRyYW5zYWN0aW9uQ29tcGxldGlvbikge1xuICAgICAgY29uc3Qgc2NoZW1hUmVhZHlQcm9taXNlID0gdGhpcy5fYXBwbHlTY2hlbWEoZGIpXG4gICAgICBjb25zdCB0cmFuc2FjdGlvblJlYWR5UHJvbWlzZSA9IHNjaGVtYVJlYWR5UHJvbWlzZS50aGVuKCgpID0+IHVuZGVmaW5lZClcbiAgICAgIGNvbnN0IHRyYW5zYWN0aW9uUmVhZHkgPSB7Y29tcGxldGlvbjogdHJhbnNhY3Rpb25Db21wbGV0aW9uLCBwcm9taXNlOiB0cmFuc2FjdGlvblJlYWR5UHJvbWlzZX1cbiAgICAgIGNvbnN0IGR1cmFibGVSZWFkeVByb21pc2UgPSBzY2hlbWFSZWFkeVByb21pc2UudGhlbihhc3luYyAoY2hhbmdlZCkgPT4ge1xuICAgICAgICBpZiAoIWNoYW5nZWQpIHtcbiAgICAgICAgICB0aGlzLl9pc1JlYWR5ID0gdHJ1ZVxuICAgICAgICAgIHJldHVyblxuICAgICAgICB9XG5cbiAgICAgICAgYXdhaXQgdHJhbnNhY3Rpb25Db21wbGV0aW9uXG4gICAgICB9LCAoKSA9PiB7XG4gICAgICAgIC8vIFRoZSB0cmFuc2FjdGlvbi1sb2NhbCBjYWxsZXIgYmVsb3cgb3ducyBhbmQgcmV0aHJvd3MgdGhpcyBzYW1lIHNjaGVtYSBlcnJvci5cbiAgICAgICAgLy8gVGhpcyBicmFuY2ggb25seSBzZXR0bGVzIHRoZSBzaGFyZWQgZHVyYWJpbGl0eSBiYXJyaWVyIHNvIGl0IGNhbm5vdCBiZWNvbWVcbiAgICAgICAgLy8gYW4gaW5kZXBlbmRlbnQgdW5oYW5kbGVkIHJlamVjdGlvbiB3aGlsZSBmYWlsZWQgb3duZXJzaGlwIGlzIGNsZWFyZWQuXG4gICAgICB9KVxuXG4gICAgICB0aGlzLl90cmFuc2FjdGlvblJlYWR5UHJvbWlzZXMuc2V0KGRiLCB0cmFuc2FjdGlvblJlYWR5KVxuICAgICAgdGhpcy5fcmVhZHlQcm9taXNlID0gZHVyYWJsZVJlYWR5UHJvbWlzZVxuXG4gICAgICB0cnkge1xuICAgICAgICBhd2FpdCB0cmFuc2FjdGlvblJlYWR5UHJvbWlzZVxuICAgICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgICAgaWYgKHRoaXMuX3RyYW5zYWN0aW9uUmVhZHlQcm9taXNlcy5nZXQoZGIpID09PSB0cmFuc2FjdGlvblJlYWR5KSB0aGlzLl90cmFuc2FjdGlvblJlYWR5UHJvbWlzZXMuZGVsZXRlKGRiKVxuICAgICAgICBpZiAodGhpcy5fcmVhZHlQcm9taXNlID09PSBkdXJhYmxlUmVhZHlQcm9taXNlKSB0aGlzLl9yZWFkeVByb21pc2UgPSBudWxsXG4gICAgICAgIHRocm93IGVycm9yXG4gICAgICB9XG4gICAgICByZXR1cm5cbiAgICB9XG5cbiAgICB0aGlzLl9yZWFkeVByb21pc2UgPSB0aGlzLl90cmFuc2FjdGlvblJlc3VsdChkYiwgYXN5bmMgKCkgPT4gYXdhaXQgdGhpcy5fYXBwbHlTY2hlbWEoZGIpKS50aGVuKCgpID0+IHtcbiAgICAgIHRoaXMuX2lzUmVhZHkgPSB0cnVlXG4gICAgfSlcblxuICAgIHRyeSB7XG4gICAgICBhd2FpdCB0aGlzLl9yZWFkeVByb21pc2VcbiAgICB9IGZpbmFsbHkge1xuICAgICAgaWYgKCF0aGlzLl9pc1JlYWR5KSB0aGlzLl9yZWFkeVByb21pc2UgPSBudWxsXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIENyZWF0ZXMgb3IgcmVwYWlycyB2ZXJzaW9uLW9uZSB0YWJsZXMgYW5kIGluZGV4ZXMuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vZGF0YWJhc2UvZHJpdmVycy9iYXNlLmpzXCIpLmRlZmF1bHR9IGRiIC0gTG9jYWwgU1FMaXRlIGNvbm5lY3Rpb24uXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPGJvb2xlYW4+fSAtIFdoZXRoZXIgc2NoZW1hIHN0YXRlIGNoYW5nZWQuXG4gICAqL1xuICBhc3luYyBfYXBwbHlTY2hlbWEoZGIpIHtcbiAgICBsZXQgY2hhbmdlZCA9IGZhbHNlXG5cbiAgICBpZiAoIShhd2FpdCBkYi50YWJsZUV4aXN0cyhNSUdSQVRJT05TX1RBQkxFKSkpIHtcbiAgICAgIGF3YWl0IGRiLmNyZWF0ZVRhYmxlKHRoaXMuX21pZ3JhdGlvbnNUYWJsZURhdGEoKSlcbiAgICAgIGNoYW5nZWQgPSB0cnVlXG4gICAgfVxuXG4gICAgaWYgKCEoYXdhaXQgZGIudGFibGVFeGlzdHMoTE9DQUxfQkFDS0dST1VORF9KT0JTX1RBQkxFKSkpIHtcbiAgICAgIGF3YWl0IGRiLmNyZWF0ZVRhYmxlKHRoaXMuX2pvYnNUYWJsZURhdGEoKSlcbiAgICAgIGNoYW5nZWQgPSB0cnVlXG4gICAgfSBlbHNlIHtcbiAgICAgIGF3YWl0IHRoaXMuX2Fzc2VydENvbHVtbnMoZGIsIExPQ0FMX0JBQ0tHUk9VTkRfSk9CU19UQUJMRSwgRVhQRUNURURfSk9CX0NPTFVNTlMpXG4gICAgfVxuXG4gICAgaWYgKCEoYXdhaXQgZGIudGFibGVFeGlzdHMoTE9DQUxfQkFDS0dST1VORF9KT0JfQ09OQ1VSUkVOQ1lfVEFCTEUpKSkge1xuICAgICAgYXdhaXQgZGIuY3JlYXRlVGFibGUodGhpcy5fY29uY3VycmVuY3lUYWJsZURhdGEoKSlcbiAgICAgIGNoYW5nZWQgPSB0cnVlXG4gICAgfSBlbHNlIHtcbiAgICAgIGF3YWl0IHRoaXMuX2Fzc2VydENvbHVtbnMoZGIsIExPQ0FMX0JBQ0tHUk9VTkRfSk9CX0NPTkNVUlJFTkNZX1RBQkxFLCBFWFBFQ1RFRF9DT05DVVJSRU5DWV9DT0xVTU5TKVxuICAgIH1cblxuICAgIGlmIChhd2FpdCB0aGlzLl9lbnN1cmVJbmRleGVzKGRiKSkgY2hhbmdlZCA9IHRydWVcblxuICAgIGlmICghKGF3YWl0IHRoaXMuX2hhc01pZ3JhdGlvbihkYikpKSB7XG4gICAgICBhd2FpdCBkYi51cHNlcnQoe1xuICAgICAgICB0YWJsZU5hbWU6IE1JR1JBVElPTlNfVEFCTEUsXG4gICAgICAgIGRhdGE6IHtcbiAgICAgICAgICBhcHBsaWVkX2F0X21zOiB0aGlzLmNsb2NrLm5vdygpLFxuICAgICAgICAgIGtleTogdGhpcy5fbWlncmF0aW9uS2V5KCksXG4gICAgICAgICAgc2NvcGU6IE1JR1JBVElPTl9TQ09QRSxcbiAgICAgICAgICB2ZXJzaW9uOiBNSUdSQVRJT05fVkVSU0lPTlxuICAgICAgICB9LFxuICAgICAgICBjb25mbGljdENvbHVtbnM6IFtcImtleVwiXSxcbiAgICAgICAgdXBkYXRlQ29sdW1uczogW1wic2NvcGVcIiwgXCJ2ZXJzaW9uXCIsIFwiYXBwbGllZF9hdF9tc1wiXVxuICAgICAgfSlcbiAgICAgIGNoYW5nZWQgPSB0cnVlXG4gICAgfVxuXG4gICAgcmV0dXJuIGNoYW5nZWRcbiAgfVxuXG4gIC8qKlxuICAgKiBCdWlsZHMgdGhlIG1pZ3JhdGlvbiBsZWRnZXIgdGFibGUgZGVmaW5pdGlvbi5cbiAgICogQHJldHVybnMge1RhYmxlRGF0YX0gLSBNaWdyYXRpb24gbGVkZ2VyIHRhYmxlLlxuICAgKi9cbiAgX21pZ3JhdGlvbnNUYWJsZURhdGEoKSB7XG4gICAgY29uc3QgdGFibGUgPSBuZXcgVGFibGVEYXRhKE1JR1JBVElPTlNfVEFCTEUsIHtpZk5vdEV4aXN0czogdHJ1ZX0pXG5cbiAgICB0YWJsZS5zdHJpbmcoXCJrZXlcIiwge251bGw6IGZhbHNlLCBwcmltYXJ5S2V5OiB0cnVlfSlcbiAgICB0YWJsZS5zdHJpbmcoXCJzY29wZVwiLCB7bnVsbDogZmFsc2V9KVxuICAgIHRhYmxlLnN0cmluZyhcInZlcnNpb25cIiwge251bGw6IGZhbHNlfSlcbiAgICB0YWJsZS5iaWdpbnQoXCJhcHBsaWVkX2F0X21zXCIsIHtudWxsOiBmYWxzZX0pXG4gICAgcmV0dXJuIHRhYmxlXG4gIH1cblxuICAvKipcbiAgICogQnVpbGRzIHRoZSBsb2NhbCBqb2JzIHRhYmxlIGRlZmluaXRpb24uXG4gICAqIEByZXR1cm5zIHtUYWJsZURhdGF9IC0gTG9jYWwgam9icyB0YWJsZSBkZWZpbml0aW9uLlxuICAgKi9cbiAgX2pvYnNUYWJsZURhdGEoKSB7XG4gICAgY29uc3QgdGFibGUgPSBuZXcgVGFibGVEYXRhKExPQ0FMX0JBQ0tHUk9VTkRfSk9CU19UQUJMRSwge2lmTm90RXhpc3RzOiB0cnVlfSlcblxuICAgIHRhYmxlLnN0cmluZyhcImlkXCIsIHtudWxsOiBmYWxzZSwgcHJpbWFyeUtleTogdHJ1ZX0pXG4gICAgdGFibGUuc3RyaW5nKFwiam9iX25hbWVcIiwge251bGw6IGZhbHNlfSlcbiAgICB0YWJsZS50ZXh0KFwiYXJnc19qc29uXCIsIHtudWxsOiBmYWxzZX0pXG4gICAgdGFibGUuc3RyaW5nKFwiYXJnc19kaWdlc3RcIiwge21heExlbmd0aDogNjQsIG51bGw6IGZhbHNlfSlcbiAgICB0YWJsZS5zdHJpbmcoXCJleGVjdXRpb25fbW9kZVwiLCB7bnVsbDogZmFsc2V9KVxuICAgIHRhYmxlLnN0cmluZyhcInF1ZXVlXCIsIHtudWxsOiBmYWxzZX0pXG4gICAgdGFibGUuaW50ZWdlcihcIm1heF9yZXRyaWVzXCIsIHtudWxsOiBmYWxzZX0pXG4gICAgdGFibGUuaW50ZWdlcihcImF0dGVtcHRzXCIsIHtudWxsOiBmYWxzZX0pXG4gICAgdGFibGUuc3RyaW5nKFwic3RhdHVzXCIsIHtudWxsOiBmYWxzZX0pXG4gICAgdGFibGUuYmlnaW50KFwic2NoZWR1bGVkX2F0X21zXCIsIHtudWxsOiBmYWxzZX0pXG4gICAgdGFibGUuYmlnaW50KFwiY3JlYXRlZF9hdF9tc1wiLCB7bnVsbDogZmFsc2V9KVxuICAgIHRhYmxlLmJpZ2ludChcImhhbmRlZF9vZmZfYXRfbXNcIiwge251bGw6IHRydWV9KVxuICAgIHRhYmxlLnN0cmluZyhcImhhbmRvZmZfaWRcIiwge251bGw6IHRydWV9KVxuICAgIHRhYmxlLnN0cmluZyhcIndvcmtlcl9pZFwiLCB7bnVsbDogdHJ1ZX0pXG4gICAgdGFibGUuYmlnaW50KFwiY29tcGxldGVkX2F0X21zXCIsIHtudWxsOiB0cnVlfSlcbiAgICB0YWJsZS5iaWdpbnQoXCJmYWlsZWRfYXRfbXNcIiwge251bGw6IHRydWV9KVxuICAgIHRhYmxlLnRleHQoXCJsYXN0X2Vycm9yXCIsIHtudWxsOiB0cnVlfSlcbiAgICB0YWJsZS5zdHJpbmcoXCJjb25jdXJyZW5jeV9rZXlcIiwge251bGw6IHRydWV9KVxuICAgIHRhYmxlLmludGVnZXIoXCJtYXhfY29uY3VycmVuY3lcIiwge251bGw6IHRydWV9KVxuICAgIHRhYmxlLmFkZEluZGV4KG5ldyBUYWJsZUluZGV4KFtcInN0YXR1c1wiLCBcInNjaGVkdWxlZF9hdF9tc1wiLCBcImNyZWF0ZWRfYXRfbXNcIiwgXCJpZFwiXSwge25hbWU6IExPQ0FMX0JBQ0tHUk9VTkRfSk9CU19JTkRFWF9OQU1FU1swXX0pKVxuICAgIHRhYmxlLmFkZEluZGV4KG5ldyBUYWJsZUluZGV4KFtcInF1ZXVlXCIsIFwic3RhdHVzXCIsIFwiY3JlYXRlZF9hdF9tc1wiXSwge25hbWU6IExPQ0FMX0JBQ0tHUk9VTkRfSk9CU19JTkRFWF9OQU1FU1sxXX0pKVxuICAgIHRhYmxlLmFkZEluZGV4KG5ldyBUYWJsZUluZGV4KFtcImFyZ3NfZGlnZXN0XCJdLCB7bmFtZTogTE9DQUxfQkFDS0dST1VORF9KT0JTX0lOREVYX05BTUVTWzJdfSkpXG4gICAgdGFibGUuYWRkSW5kZXgobmV3IFRhYmxlSW5kZXgoW1wic3RhdHVzXCIsIFwiY29uY3VycmVuY3lfa2V5XCIsIFwic2NoZWR1bGVkX2F0X21zXCJdLCB7bmFtZTogTE9DQUxfQkFDS0dST1VORF9KT0JTX0lOREVYX05BTUVTWzNdfSkpXG4gICAgcmV0dXJuIHRhYmxlXG4gIH1cblxuICAvKipcbiAgICogQnVpbGRzIHRoZSBsb2NhbCBjb25jdXJyZW5jeSBjb3VudGVyIHRhYmxlIGRlZmluaXRpb24uXG4gICAqIEByZXR1cm5zIHtUYWJsZURhdGF9IC0gQ29uY3VycmVuY3kgY291bnRlciB0YWJsZSBkZWZpbml0aW9uLlxuICAgKi9cbiAgX2NvbmN1cnJlbmN5VGFibGVEYXRhKCkge1xuICAgIGNvbnN0IHRhYmxlID0gbmV3IFRhYmxlRGF0YShMT0NBTF9CQUNLR1JPVU5EX0pPQl9DT05DVVJSRU5DWV9UQUJMRSwge2lmTm90RXhpc3RzOiB0cnVlfSlcblxuICAgIHRhYmxlLnN0cmluZyhcImNvbmN1cnJlbmN5X2tleVwiLCB7bnVsbDogZmFsc2UsIHByaW1hcnlLZXk6IHRydWV9KVxuICAgIHRhYmxlLmludGVnZXIoXCJtYXhfY29uY3VycmVuY3lcIiwge251bGw6IGZhbHNlfSlcbiAgICB0YWJsZS5pbnRlZ2VyKFwiYWN0aXZlX2NvdW50XCIsIHtudWxsOiBmYWxzZX0pXG4gICAgcmV0dXJuIHRhYmxlXG4gIH1cblxuICAvKipcbiAgICogUmVqZWN0cyBhbiBpbmNvbXBhdGlibGUgY3VycmVudC12ZXJzaW9uIHRhYmxlIHJhdGhlciB0aGFuIHJlYnVpbGRpbmcgZGF0YS5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9kYXRhYmFzZS9kcml2ZXJzL2Jhc2UuanNcIikuZGVmYXVsdH0gZGIgLSBMb2NhbCBTUUxpdGUgY29ubmVjdGlvbi5cbiAgICogQHBhcmFtIHtzdHJpbmd9IHRhYmxlTmFtZSAtIFRhYmxlIG5hbWUuXG4gICAqIEBwYXJhbSB7c3RyaW5nW119IGV4cGVjdGVkQ29sdW1ucyAtIFJlcXVpcmVkIGNvbHVtbnMuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIHdoZW4gY29tcGF0aWJsZS5cbiAgICovXG4gIGFzeW5jIF9hc3NlcnRDb2x1bW5zKGRiLCB0YWJsZU5hbWUsIGV4cGVjdGVkQ29sdW1ucykge1xuICAgIGNvbnN0IHRhYmxlID0gYXdhaXQgZGIuZ2V0VGFibGVCeU5hbWVPckZhaWwodGFibGVOYW1lKVxuICAgIGNvbnN0IGNvbHVtbnMgPSBhd2FpdCB0YWJsZS5nZXRDb2x1bW5zKClcbiAgICBjb25zdCBuYW1lcyA9IG5ldyBTZXQoY29sdW1ucy5tYXAoKGNvbHVtbikgPT4gY29sdW1uLmdldE5hbWUoKSkpXG4gICAgY29uc3QgbWlzc2luZyA9IGV4cGVjdGVkQ29sdW1ucy5maWx0ZXIoKGNvbHVtbk5hbWUpID0+ICFuYW1lcy5oYXMoY29sdW1uTmFtZSkpXG5cbiAgICBpZiAobWlzc2luZy5sZW5ndGggPT09IDApIHJldHVyblxuXG4gICAgY29uc3QgZXJyb3IgPSBuZXcgRXJyb3IoYEluY29tcGF0aWJsZSBsb2NhbCBiYWNrZ3JvdW5kLWpvYnMgc2NoZW1hIGZvciAke3RhYmxlTmFtZX07IG1pc3NpbmcgY29sdW1uczogJHttaXNzaW5nLmpvaW4oXCIsIFwiKX1gKVxuXG4gICAgdGhpcy5fcmVwb3J0RnJhbWV3b3JrRXJyb3Ioe2Vycm9yLCBzdGFnZTogXCJsb2NhbC1iYWNrZ3JvdW5kLWpvYnMtc2NoZW1hXCJ9KVxuICAgIHRocm93IGVycm9yXG4gIH1cblxuICAvKipcbiAgICogUmVjcmVhdGVzIG1pc3NpbmcgaW5kZXhlcyBkZWNsYXJlZCBieSB0aGUgY3VycmVudCBzY2hlbWEuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vZGF0YWJhc2UvZHJpdmVycy9iYXNlLmpzXCIpLmRlZmF1bHR9IGRiIC0gTG9jYWwgU1FMaXRlIGNvbm5lY3Rpb24uXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPGJvb2xlYW4+fSAtIFdoZXRoZXIgYW4gaW5kZXggd2FzIGNyZWF0ZWQuXG4gICAqL1xuICBhc3luYyBfZW5zdXJlSW5kZXhlcyhkYikge1xuICAgIGRiLmNsZWFyU2NoZW1hQ2FjaGUoKVxuICAgIGNvbnN0IGpvYnNUYWJsZSA9IGF3YWl0IGRiLmdldFRhYmxlQnlOYW1lT3JGYWlsKExPQ0FMX0JBQ0tHUk9VTkRfSk9CU19UQUJMRSlcbiAgICBjb25zdCBleGlzdGluZ05hbWVzID0gbmV3IFNldCgoYXdhaXQgam9ic1RhYmxlLmdldEluZGV4ZXMoKSkubWFwKChpbmRleCkgPT4gaW5kZXguZ2V0TmFtZSgpKSlcbiAgICBsZXQgY2hhbmdlZCA9IGZhbHNlXG5cbiAgICBmb3IgKGNvbnN0IGluZGV4IG9mIHRoaXMuX2pvYnNUYWJsZURhdGEoKS5nZXRJbmRleGVzKCkpIHtcbiAgICAgIGNvbnN0IGluZGV4TmFtZSA9IGluZGV4LmdldE5hbWUoKVxuXG4gICAgICBpZiAoIWluZGV4TmFtZSB8fCBleGlzdGluZ05hbWVzLmhhcyhpbmRleE5hbWUpKSBjb250aW51ZVxuXG4gICAgICBjb25zdCBzcWxzID0gYXdhaXQgZGIuY3JlYXRlSW5kZXhTUUxzKHtcbiAgICAgICAgY29sdW1uczogaW5kZXguZ2V0Q29sdW1ucygpLFxuICAgICAgICBpZk5vdEV4aXN0czogdHJ1ZSxcbiAgICAgICAgbmFtZTogaW5kZXhOYW1lLFxuICAgICAgICB0YWJsZU5hbWU6IExPQ0FMX0JBQ0tHUk9VTkRfSk9CU19UQUJMRSxcbiAgICAgICAgdW5pcXVlOiBpbmRleC5nZXRVbmlxdWUoKVxuICAgICAgfSlcblxuICAgICAgZm9yIChjb25zdCBzcWwgb2Ygc3FscykgYXdhaXQgZGIucXVlcnkoc3FsKVxuICAgICAgY2hhbmdlZCA9IHRydWVcbiAgICB9XG5cbiAgICBpZiAoY2hhbmdlZCkgZGIuY2xlYXJTY2hlbWFDYWNoZSgpXG4gICAgcmV0dXJuIGNoYW5nZWRcbiAgfVxuXG4gIC8qKlxuICAgKiBDaGVja3Mgd2hldGhlciB0aGUgY3VycmVudCBsb2NhbCBzY2hlbWEgdmVyc2lvbiBpcyByZWNvcmRlZC5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9kYXRhYmFzZS9kcml2ZXJzL2Jhc2UuanNcIikuZGVmYXVsdH0gZGIgLSBDb25uZWN0aW9uLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxib29sZWFuPn0gLSBXaGV0aGVyIHZlcnNpb24gb25lIGlzIHJlY29yZGVkLlxuICAgKi9cbiAgYXN5bmMgX2hhc01pZ3JhdGlvbihkYikge1xuICAgIGNvbnN0IHJvd3MgPSBhd2FpdCBkYlxuICAgICAgLm5ld1F1ZXJ5KClcbiAgICAgIC5mcm9tKE1JR1JBVElPTlNfVEFCTEUpXG4gICAgICAud2hlcmUoe2tleTogdGhpcy5fbWlncmF0aW9uS2V5KCl9KVxuICAgICAgLmxpbWl0KDEpXG4gICAgICAucmVzdWx0cygpXG5cbiAgICByZXR1cm4gcm93cy5sZW5ndGggPiAwXG4gIH1cblxuICAvKipcbiAgICogQnVpbGRzIHRoZSBzY29wZWQgbWlncmF0aW9uIGtleS5cbiAgICogQHJldHVybnMge3N0cmluZ30gLSBTY29wZWQgbWlncmF0aW9uIGtleS5cbiAgICovXG4gIF9taWdyYXRpb25LZXkoKSB7IHJldHVybiBgJHtNSUdSQVRJT05fU0NPUEV9OiR7TUlHUkFUSU9OX1ZFUlNJT059YCB9XG5cbiAgLyoqXG4gICAqIEVucXVldWVzIGEgbG9jYWwgam9iIGluIHRoZSBjYWxsZXIncyBhY3RpdmUgdHJhbnNhY3Rpb24gd2hlbiBwcmVzZW50LlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIEVucXVldWUgcmVxdWVzdC5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGFyZ3Muam9iTmFtZSAtIFJlZ2lzdGVyZWQgam9iIG5hbWUuXG4gICAqIEBwYXJhbSB7QXJyYXk8UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSBhcmdzLmFyZ3MgLSBTZXJpYWxpemVkIGpvYiBhcmd1bWVudHMuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi90eXBlcy5qc1wiKS5CYWNrZ3JvdW5kSm9iT3B0aW9uc30gW2FyZ3Mub3B0aW9uc10gLSBKb2Igb3B0aW9ucy5cbiAgICogQHJldHVybnMge1Byb21pc2U8c3RyaW5nPn0gLSBEdXJhYmxlIGpvYiBpZC5cbiAgICovXG4gIGFzeW5jIGVucXVldWUoe2pvYk5hbWUsIGFyZ3MsIG9wdGlvbnMgPSB7fX0pIHtcbiAgICBhd2FpdCB0aGlzLmVuc3VyZVJlYWR5KClcblxuICAgIGNvbnN0IHByZXBhcmVkSm9iID0gdGhpcy5fcHJlcGFyZUpvYih7YXJncywgam9iTmFtZSwgb3B0aW9uc30pXG4gICAgY29uc3QgbXV0YXRlID0gYXN5bmMgKGhvbGRVbnRpbCA9ICgvKiogQHR5cGUge1Byb21pc2U8dm9pZD59ICovIF9jb21wbGV0aW9uKSA9PiB7fSkgPT4gYXdhaXQgdGhpcy5fd2l0aERiKGFzeW5jIChjb25uZWN0aW9uKSA9PiB7XG4gICAgICBpZiAoY29ubmVjdGlvbi5pbnNpZGVUcmFuc2FjdGlvbigpKSBob2xkVW50aWwoY29ubmVjdGlvbi50cmFuc2FjdGlvbkNvbXBsZXRpb24oKSlcblxuICAgICAgcmV0dXJuIGF3YWl0IHRoaXMuX211dGF0ZShjb25uZWN0aW9uLCBhc3luYyAoZGIpID0+IHtcbiAgICAgICAgbGV0IGpvYklkID0gcHJlcGFyZWRKb2Iuam9iSWRcblxuICAgICAgICBpZiAocHJlcGFyZWRKb2IuY29uY3VycmVuY3kpIGF3YWl0IHRoaXMuX2Vuc3VyZUNvbmN1cnJlbmN5KGRiLCBwcmVwYXJlZEpvYi5jb25jdXJyZW5jeSlcblxuICAgICAgICBpZiAob3B0aW9ucy5kZWR1cGxpY2F0ZVdoaWxlUXVldWVkKSB7XG4gICAgICAgICAgY29uc3QgZXhpc3RpbmcgPSBhd2FpdCBkYlxuICAgICAgICAgICAgLm5ld1F1ZXJ5KClcbiAgICAgICAgICAgIC5mcm9tKExPQ0FMX0JBQ0tHUk9VTkRfSk9CU19UQUJMRSlcbiAgICAgICAgICAgIC5zZWxlY3QoXCJpZFwiKVxuICAgICAgICAgICAgLndoZXJlKHtcbiAgICAgICAgICAgICAgYXJnc19kaWdlc3Q6IHByZXBhcmVkSm9iLmFyZ3NEaWdlc3QsXG4gICAgICAgICAgICAgIGFyZ3NfanNvbjogcHJlcGFyZWRKb2IuYXJnc0pzb24sXG4gICAgICAgICAgICAgIGpvYl9uYW1lOiBwcmVwYXJlZEpvYi5qb2JOYW1lLFxuICAgICAgICAgICAgICBxdWV1ZTogcHJlcGFyZWRKb2IucXVldWUsXG4gICAgICAgICAgICAgIHN0YXR1czogXCJxdWV1ZWRcIlxuICAgICAgICAgICAgfSlcbiAgICAgICAgICAgIC53aGVyZShgc2NoZWR1bGVkX2F0X21zIDw9ICR7ZGIucXVvdGUocHJlcGFyZWRKb2Iuc2NoZWR1bGVkQXRNcyl9YClcbiAgICAgICAgICAgIC5vcmRlcihcInNjaGVkdWxlZF9hdF9tcyBBU0NcIilcbiAgICAgICAgICAgIC5vcmRlcihcImNyZWF0ZWRfYXRfbXMgQVNDXCIpXG4gICAgICAgICAgICAubGltaXQoMSlcbiAgICAgICAgICAgIC5yZXN1bHRzKClcblxuICAgICAgICAgIGNvbnN0IGV4aXN0aW5nUm93ID0gLyoqIEB0eXBlIHt7aWQ6IHN0cmluZyB8IG51bWJlcn0gfCB1bmRlZmluZWR9ICovIChleGlzdGluZ1swXSlcblxuICAgICAgICAgIGlmIChleGlzdGluZ1Jvdykgam9iSWQgPSBTdHJpbmcoZXhpc3RpbmdSb3cuaWQpXG4gICAgICAgIH1cblxuICAgICAgICBpZiAoam9iSWQgPT09IHByZXBhcmVkSm9iLmpvYklkKSBhd2FpdCB0aGlzLl9pbnNlcnRQcmVwYXJlZEpvYihkYiwgcHJlcGFyZWRKb2IpXG4gICAgICAgIGlmICh0aGlzLm9uQ29tbWl0dGVkRW5xdWV1ZSkgYXdhaXQgZGIuYWZ0ZXJDb21taXQodGhpcy5vbkNvbW1pdHRlZEVucXVldWUpXG5cbiAgICAgICAgcmV0dXJuIGpvYklkXG4gICAgICB9KVxuICAgIH0pXG5cbiAgICBpZiAob3B0aW9ucy5kZWR1cGxpY2F0ZVdoaWxlUXVldWVkKSByZXR1cm4gYXdhaXQgdGhpcy5fc2VyaWFsaXplRGVkdXBsaWNhdGVkRW5xdWV1ZShwcmVwYXJlZEpvYiwgbXV0YXRlKVxuICAgIHJldHVybiBhd2FpdCBtdXRhdGUoKVxuICB9XG5cbiAgLyoqXG4gICAqIFNlcmlhbGl6ZXMgbWF0Y2hpbmcgaW4tcHJvY2VzcyBkZWR1cGxpY2F0aW9uIGNoZWNrcyB0aHJvdWdoIGNvbW1pdCB3aGlsZVxuICAgKiBsZWF2aW5nIHVucmVsYXRlZCBqb2IgaWRlbnRpdGllcyBpbmRlcGVuZGVudC5cbiAgICogQHRlbXBsYXRlIFRcbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL3R5cGVzLmpzXCIpLlByZXBhcmVkTG9jYWxCYWNrZ3JvdW5kSm9ifSBwcmVwYXJlZEpvYiAtIFByZXBhcmVkIGpvYiBpZGVudGl0eS5cbiAgICogQHBhcmFtIHsoaG9sZFVudGlsOiAoY29tcGxldGlvbjogUHJvbWlzZTx2b2lkPikgPT4gdm9pZCkgPT4gUHJvbWlzZTxUPn0gY2FsbGJhY2sgLSBEZWR1cGxpY2F0aW9uIG11dGF0aW9uLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxUPn0gLSBNdXRhdGlvbiByZXN1bHQuXG4gICAqL1xuICBhc3luYyBfc2VyaWFsaXplRGVkdXBsaWNhdGVkRW5xdWV1ZShwcmVwYXJlZEpvYiwgY2FsbGJhY2spIHtcbiAgICBsZXQgY2hhaW5zID0gZGVkdXBsaWNhdGVkRW5xdWV1ZUNoYWlucy5nZXQodGhpcy5jb25maWd1cmF0aW9uKVxuXG4gICAgaWYgKCFjaGFpbnMpIHtcbiAgICAgIGNoYWlucyA9IG5ldyBNYXAoKVxuICAgICAgZGVkdXBsaWNhdGVkRW5xdWV1ZUNoYWlucy5zZXQodGhpcy5jb25maWd1cmF0aW9uLCBjaGFpbnMpXG4gICAgfVxuXG4gICAgY29uc3Qga2V5ID0gc2hhMjU2SGV4KEpTT04uc3RyaW5naWZ5KFtcbiAgICAgIHRoaXMuZ2V0RGF0YWJhc2VJZGVudGlmaWVyKCksXG4gICAgICBwcmVwYXJlZEpvYi5qb2JOYW1lLFxuICAgICAgcHJlcGFyZWRKb2IuYXJnc0RpZ2VzdCxcbiAgICAgIHByZXBhcmVkSm9iLnF1ZXVlXG4gICAgXSkpXG4gICAgY29uc3QgcHJldmlvdXMgPSBjaGFpbnMuZ2V0KGtleSkgfHwgUHJvbWlzZS5yZXNvbHZlKClcbiAgICBsZXQgcmVsZWFzZSA9ICgpID0+IHt9XG4gICAgY29uc3QgcnVubmluZyA9IG5ldyBQcm9taXNlKChyZXNvbHZlKSA9PiB7IHJlbGVhc2UgPSAoKSA9PiByZXNvbHZlKHVuZGVmaW5lZCkgfSlcbiAgICBjb25zdCBjaGFpbiA9IHByZXZpb3VzLnRoZW4oKCkgPT4gcnVubmluZylcbiAgICAvKiogQHR5cGUge1Byb21pc2U8dm9pZD4gfCB1bmRlZmluZWR9ICovXG4gICAgbGV0IGNvbXBsZXRpb25cbiAgICBjb25zdCBmaW5pc2ggPSAoKSA9PiB7XG4gICAgICByZWxlYXNlKClcbiAgICAgIGlmIChjaGFpbnMuZ2V0KGtleSkgPT09IGNoYWluKSBjaGFpbnMuZGVsZXRlKGtleSlcbiAgICAgIGlmIChjaGFpbnMuc2l6ZSA9PT0gMCkgZGVkdXBsaWNhdGVkRW5xdWV1ZUNoYWlucy5kZWxldGUodGhpcy5jb25maWd1cmF0aW9uKVxuICAgIH1cblxuICAgIGNoYWlucy5zZXQoa2V5LCBjaGFpbilcbiAgICBhd2FpdCBwcmV2aW91c1xuXG4gICAgdHJ5IHtcbiAgICAgIGNvbnN0IHJlc3VsdCA9IGF3YWl0IGNhbGxiYWNrKCh0cmFuc2FjdGlvbkNvbXBsZXRpb24pID0+IHsgY29tcGxldGlvbiA9IHRyYW5zYWN0aW9uQ29tcGxldGlvbiB9KVxuXG4gICAgICBpZiAoY29tcGxldGlvbikge1xuICAgICAgICBjb21wbGV0aW9uLnRoZW4oZmluaXNoLCBmaW5pc2gpXG4gICAgICB9IGVsc2Uge1xuICAgICAgICBmaW5pc2goKVxuICAgICAgfVxuXG4gICAgICByZXR1cm4gcmVzdWx0XG4gICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgIGZpbmlzaCgpXG4gICAgICB0aHJvdyBlcnJvclxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBQcmVwYXJlcyB2YWxpZGF0ZWQgbG9jYWwgam9iIGRhdGEgZm9yIGluc2VydGlvbi5cbiAgICogQHBhcmFtIHt7YXJnczogQXJyYXk8UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+LCBqb2JOYW1lOiBzdHJpbmcsIG9wdGlvbnM6IGltcG9ydChcIi4vdHlwZXMuanNcIikuQmFja2dyb3VuZEpvYk9wdGlvbnN9fSBhcmdzIC0gSm9iIHJlcXVlc3QuXG4gICAqIEByZXR1cm5zIHtpbXBvcnQoXCIuL3R5cGVzLmpzXCIpLlByZXBhcmVkTG9jYWxCYWNrZ3JvdW5kSm9ifSAtIFByZXBhcmVkIHJvdyBkYXRhLlxuICAgKi9cbiAgX3ByZXBhcmVKb2Ioe2FyZ3MsIGpvYk5hbWUsIG9wdGlvbnN9KSB7XG4gICAgaWYgKG9wdGlvbnMuaWRlbXBvdGVuY3lLZXkgIT09IHVuZGVmaW5lZCkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKFwiaWRlbXBvdGVuY3lLZXkgaXMgbm90IHN1cHBvcnRlZCBieSB0aGUgbG9jYWwgYmFja2dyb3VuZC1qb2JzIGFkYXB0ZXJcIilcbiAgICB9XG5cbiAgICBjb25zdCBjcmVhdGVkQXRNcyA9IHRoaXMuY2xvY2subm93KClcbiAgICBjb25zdCBxdWV1ZSA9IG5vcm1hbGl6ZUJhY2tncm91bmRKb2JRdWV1ZShvcHRpb25zKVxuICAgIGNvbnN0IHF1ZXVlcyA9IHRoaXMuY29uZmlndXJhdGlvbi5nZXRCYWNrZ3JvdW5kSm9ic0NvbmZpZygpLnF1ZXVlc1xuICAgIGNvbnN0IGFyZ3NKc29uID0gSlNPTi5zdHJpbmdpZnkoYXJncyB8fCBbXSlcbiAgICBjb25zdCBleGVjdXRpb25Nb2RlID0gbm9ybWFsaXplQmFja2dyb3VuZEpvYkV4ZWN1dGlvbk1vZGUob3B0aW9ucywgXCJpbmxpbmVcIiwgTE9DQUxfRVhFQ1VUSU9OX01PREVTKVxuXG4gICAgaWYgKHR5cGVvZiBhcmdzSnNvbiAhPT0gXCJzdHJpbmdcIikgdGhyb3cgbmV3IFR5cGVFcnJvcihcIkxvY2FsIGJhY2tncm91bmQgam9iIGFyZ3VtZW50cyBtdXN0IGJlIEpTT04gc2VyaWFsaXphYmxlXCIpXG4gICAgaWYgKGV4ZWN1dGlvbk1vZGUgIT09IFwiaW5saW5lXCIpIHRocm93IG5ldyBFcnJvcihcIkxvY2FsIGJhY2tncm91bmQgam9iIGV4ZWN1dGlvbiBtb2RlIGludmFyaWFudCB3YXMgdmlvbGF0ZWRcIilcblxuICAgIHJldHVybiB7XG4gICAgICBhcmdzRGlnZXN0OiBzaGEyNTZIZXgoYXJnc0pzb24pLFxuICAgICAgYXJnc0pzb24sXG4gICAgICBjb25jdXJyZW5jeTogbm9ybWFsaXplQmFja2dyb3VuZEpvYkNvbmN1cnJlbmN5KHtvcHRpb25zLCBxdWV1ZSwgcXVldWVzfSksXG4gICAgICBjcmVhdGVkQXRNcyxcbiAgICAgIGV4ZWN1dGlvbk1vZGUsXG4gICAgICBqb2JJZDogbmV3IFVVSUQoNCkuZm9ybWF0KCksXG4gICAgICBqb2JOYW1lLFxuICAgICAgbWF4UmV0cmllczogbm9ybWFsaXplQmFja2dyb3VuZEpvYk1heFJldHJpZXMob3B0aW9ucy5tYXhSZXRyaWVzKSxcbiAgICAgIHF1ZXVlLFxuICAgICAgc2NoZWR1bGVkQXRNczogbm9ybWFsaXplQmFja2dyb3VuZEpvYlNjaGVkdWxlZEF0TXMob3B0aW9ucy5zY2hlZHVsZWRBdE1zLCBjcmVhdGVkQXRNcylcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogSW5zZXJ0cyBvbmUgcHJlcGFyZWQgbG9jYWwgam9iIHJvdyBhbmQgaXRzIGNvbmN1cnJlbmN5IG1ldGFkYXRhLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL2RhdGFiYXNlL2RyaXZlcnMvYmFzZS5qc1wiKS5kZWZhdWx0fSBkYiAtIExvY2FsIFNRTGl0ZSBjb25uZWN0aW9uLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vdHlwZXMuanNcIikuUHJlcGFyZWRMb2NhbEJhY2tncm91bmRKb2J9IHByZXBhcmVkSm9iIC0gUHJlcGFyZWQgcm93IGRhdGEuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIGFmdGVyIGluc2VydGlvbi5cbiAgICovXG4gIGFzeW5jIF9pbnNlcnRQcmVwYXJlZEpvYihkYiwgcHJlcGFyZWRKb2IpIHtcbiAgICBhd2FpdCBkYi5pbnNlcnQoe1xuICAgICAgdGFibGVOYW1lOiBMT0NBTF9CQUNLR1JPVU5EX0pPQlNfVEFCTEUsXG4gICAgICBkYXRhOiB7XG4gICAgICAgIGFyZ3NfZGlnZXN0OiBwcmVwYXJlZEpvYi5hcmdzRGlnZXN0LFxuICAgICAgICBhcmdzX2pzb246IHByZXBhcmVkSm9iLmFyZ3NKc29uLFxuICAgICAgICBhdHRlbXB0czogMCxcbiAgICAgICAgY29tcGxldGVkX2F0X21zOiBudWxsLFxuICAgICAgICBjb25jdXJyZW5jeV9rZXk6IHByZXBhcmVkSm9iLmNvbmN1cnJlbmN5Py5jb25jdXJyZW5jeUtleSB8fCBudWxsLFxuICAgICAgICBjcmVhdGVkX2F0X21zOiBwcmVwYXJlZEpvYi5jcmVhdGVkQXRNcyxcbiAgICAgICAgZXhlY3V0aW9uX21vZGU6IHByZXBhcmVkSm9iLmV4ZWN1dGlvbk1vZGUsXG4gICAgICAgIGZhaWxlZF9hdF9tczogbnVsbCxcbiAgICAgICAgaGFuZGVkX29mZl9hdF9tczogbnVsbCxcbiAgICAgICAgaGFuZG9mZl9pZDogbnVsbCxcbiAgICAgICAgaWQ6IHByZXBhcmVkSm9iLmpvYklkLFxuICAgICAgICBqb2JfbmFtZTogcHJlcGFyZWRKb2Iuam9iTmFtZSxcbiAgICAgICAgbGFzdF9lcnJvcjogbnVsbCxcbiAgICAgICAgbWF4X2NvbmN1cnJlbmN5OiBwcmVwYXJlZEpvYi5jb25jdXJyZW5jeT8ubWF4Q29uY3VycmVuY3kgfHwgbnVsbCxcbiAgICAgICAgbWF4X3JldHJpZXM6IHByZXBhcmVkSm9iLm1heFJldHJpZXMsXG4gICAgICAgIHF1ZXVlOiBwcmVwYXJlZEpvYi5xdWV1ZSxcbiAgICAgICAgc2NoZWR1bGVkX2F0X21zOiBwcmVwYXJlZEpvYi5zY2hlZHVsZWRBdE1zLFxuICAgICAgICBzdGF0dXM6IFwicXVldWVkXCIsXG4gICAgICAgIHdvcmtlcl9pZDogbnVsbFxuICAgICAgfVxuICAgIH0pXG4gIH1cblxuICAvKipcbiAgICogUmVjb25jaWxlcyBjb25maWd1cmVkIHF1ZXVlLWRlcml2ZWQgY2FwcyBhbmQgZHVyYWJsZSBjb3VudGVycy5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgYWZ0ZXIgcmVjb25jaWxpYXRpb24uXG4gICAqL1xuICBhc3luYyByZWNvbmNpbGVRdWV1ZUNvbmN1cnJlbmN5KCkge1xuICAgIGF3YWl0IHRoaXMuZW5zdXJlUmVhZHkoKVxuXG4gICAgYXdhaXQgdGhpcy5fd2l0aERiKGFzeW5jIChjb25uZWN0aW9uKSA9PiBhd2FpdCB0aGlzLl9tdXRhdGUoY29ubmVjdGlvbiwgYXN5bmMgKGRiKSA9PiB7XG4gICAgICBjb25zdCBxdWV1ZXMgPSB0aGlzLmNvbmZpZ3VyYXRpb24uZ2V0QmFja2dyb3VuZEpvYnNDb25maWcoKS5xdWV1ZXNcbiAgICAgIGNvbnN0IHJvd3MgPSBhd2FpdCBkYi5uZXdRdWVyeSgpLmZyb20oTE9DQUxfQkFDS0dST1VORF9KT0JTX1RBQkxFKS53aGVyZSh7c3RhdHVzOiBcInF1ZXVlZFwifSkucmVzdWx0cygpXG5cbiAgICAgIGZvciAoY29uc3QgcmF3Um93IG9mIHJvd3MpIHtcbiAgICAgICAgYXdhaXQgdGhpcy5fcmVjb25jaWxlUXVldWVkSm9iQ29uY3VycmVuY3koZGIsIHRoaXMuX25vcm1hbGl6ZVJvdyhyYXdSb3cpLCBxdWV1ZXMpXG4gICAgICB9XG5cbiAgICAgIGF3YWl0IHRoaXMuX3JlYnVpbGRDb25jdXJyZW5jeUNvdW50cyhkYilcbiAgICB9KSlcbiAgfVxuXG4gIC8qKlxuICAgKiBBcHBsaWVzIGN1cnJlbnQgcXVldWUtZGVyaXZlZCBjb25jdXJyZW5jeSBwb2xpY3kgdG8gb25lIHF1ZXVlZCByb3cuXG4gICAqIEV4cGxpY2l0IGNvbmN1cnJlbmN5IGtleXMgcmVtYWluIG93bmVkIGJ5IHRoZSBlbnF1ZXVlIGNvbnRyYWN0LlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL2RhdGFiYXNlL2RyaXZlcnMvYmFzZS5qc1wiKS5kZWZhdWx0fSBkYiAtIExvY2FsIFNRTGl0ZSBjb25uZWN0aW9uLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vdHlwZXMuanNcIikuQmFja2dyb3VuZEpvYlJvd30gam9iIC0gUXVldWVkIGpvYiBzbmFwc2hvdC5cbiAgICogQHBhcmFtIHtSZWNvcmQ8c3RyaW5nLCB7bWF4Q29uY3VycmVudD86IG51bWJlciwgcHJpb3JpdHk/OiBudW1iZXJ9Pn0gcXVldWVzIC0gQ3VycmVudCBxdWV1ZSBwb2xpY3kgc25hcHNob3QuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPGltcG9ydChcIi4vdHlwZXMuanNcIikuQmFja2dyb3VuZEpvYlJvdz59IC0gUmVjb25jaWxlZCBzbmFwc2hvdC5cbiAgICovXG4gIGFzeW5jIF9yZWNvbmNpbGVRdWV1ZWRKb2JDb25jdXJyZW5jeShkYiwgam9iLCBxdWV1ZXMpIHtcbiAgICBjb25zdCBjdXJyZW50SXNRdWV1ZURlcml2ZWQgPSBCb29sZWFuKGpvYi5jb25jdXJyZW5jeUtleT8uc3RhcnRzV2l0aChRVUVVRV9DT05DVVJSRU5DWV9LRVlfUFJFRklYKSlcblxuICAgIGlmIChqb2IuY29uY3VycmVuY3lLZXkgJiYgIWN1cnJlbnRJc1F1ZXVlRGVyaXZlZCkgcmV0dXJuIGpvYlxuXG4gICAgY29uc3QgY29uY3VycmVuY3kgPSBub3JtYWxpemVCYWNrZ3JvdW5kSm9iQ29uY3VycmVuY3koe1xuICAgICAgb3B0aW9uczoge30sXG4gICAgICBxdWV1ZTogam9iLnF1ZXVlLFxuICAgICAgcXVldWVzXG4gICAgfSlcblxuICAgIGlmICghY29uY3VycmVuY3kpIHtcbiAgICAgIGlmIChjdXJyZW50SXNRdWV1ZURlcml2ZWQpIHtcbiAgICAgICAgYXdhaXQgZGIudXBkYXRlKHtcbiAgICAgICAgICBjb25kaXRpb25zOiB7aWQ6IGpvYi5pZCwgc3RhdHVzOiBcInF1ZXVlZFwifSxcbiAgICAgICAgICBkYXRhOiB7Y29uY3VycmVuY3lfa2V5OiBudWxsLCBtYXhfY29uY3VycmVuY3k6IG51bGx9LFxuICAgICAgICAgIHRhYmxlTmFtZTogTE9DQUxfQkFDS0dST1VORF9KT0JTX1RBQkxFXG4gICAgICAgIH0pXG4gICAgICB9XG5cbiAgICAgIHJldHVybiB7Li4uam9iLCBjb25jdXJyZW5jeUtleTogbnVsbCwgbWF4Q29uY3VycmVuY3k6IG51bGx9XG4gICAgfVxuXG4gICAgYXdhaXQgdGhpcy5fZW5zdXJlQ29uY3VycmVuY3koZGIsIGNvbmN1cnJlbmN5KVxuICAgIGlmIChqb2IuY29uY3VycmVuY3lLZXkgIT09IGNvbmN1cnJlbmN5LmNvbmN1cnJlbmN5S2V5IHx8IGpvYi5tYXhDb25jdXJyZW5jeSAhPT0gY29uY3VycmVuY3kubWF4Q29uY3VycmVuY3kpIHtcbiAgICAgIGF3YWl0IGRiLnVwZGF0ZSh7XG4gICAgICAgIGNvbmRpdGlvbnM6IHtpZDogam9iLmlkLCBzdGF0dXM6IFwicXVldWVkXCJ9LFxuICAgICAgICBkYXRhOiB7Y29uY3VycmVuY3lfa2V5OiBjb25jdXJyZW5jeS5jb25jdXJyZW5jeUtleSwgbWF4X2NvbmN1cnJlbmN5OiBjb25jdXJyZW5jeS5tYXhDb25jdXJyZW5jeX0sXG4gICAgICAgIHRhYmxlTmFtZTogTE9DQUxfQkFDS0dST1VORF9KT0JTX1RBQkxFXG4gICAgICB9KVxuICAgIH1cblxuICAgIHJldHVybiB7Li4uam9iLCBjb25jdXJyZW5jeUtleTogY29uY3VycmVuY3kuY29uY3VycmVuY3lLZXksIG1heENvbmN1cnJlbmN5OiBjb25jdXJyZW5jeS5tYXhDb25jdXJyZW5jeX1cbiAgfVxuXG4gIC8qKlxuICAgKiBGaW5kcyB0aGUgbmV4dCBlbGlnaWJsZSBsb2NhbCBqb2IuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPGltcG9ydChcIi4vdHlwZXMuanNcIikuQmFja2dyb3VuZEpvYlJvdyB8IG51bGw+fSAtIE5leHQgZWxpZ2libGUgbG9jYWwgam9iLlxuICAgKi9cbiAgYXN5bmMgbmV4dEF2YWlsYWJsZUpvYigpIHtcbiAgICBhd2FpdCB0aGlzLmVuc3VyZVJlYWR5KClcblxuICAgIHJldHVybiBhd2FpdCB0aGlzLl93aXRoRGIoYXN5bmMgKGRiKSA9PiB7XG4gICAgICBjb25zdCBqb2JzVGFibGUgPSBkYi5xdW90ZVRhYmxlKExPQ0FMX0JBQ0tHUk9VTkRfSk9CU19UQUJMRSlcbiAgICAgIGNvbnN0IGNvbmN1cnJlbmN5VGFibGUgPSBkYi5xdW90ZVRhYmxlKExPQ0FMX0JBQ0tHUk9VTkRfSk9CX0NPTkNVUlJFTkNZX1RBQkxFKVxuICAgICAgY29uc3QgcHJpb3JpdHlPcmRlciA9IHRoaXMuX3F1ZXVlUHJpb3JpdHlPcmRlclNxbChkYilcbiAgICAgIGxldCBxdWVyeSA9IGRiXG4gICAgICAgIC5uZXdRdWVyeSgpXG4gICAgICAgIC5mcm9tKExPQ0FMX0JBQ0tHUk9VTkRfSk9CU19UQUJMRSlcbiAgICAgICAgLndoZXJlKHtzdGF0dXM6IFwicXVldWVkXCJ9KVxuICAgICAgICAud2hlcmUoYHNjaGVkdWxlZF9hdF9tcyA8PSAke2RiLnF1b3RlKHRoaXMuY2xvY2subm93KCkpfWApXG4gICAgICAgIC53aGVyZShcbiAgICAgICAgICBgKCR7am9ic1RhYmxlfS4ke2RiLnF1b3RlQ29sdW1uKFwiY29uY3VycmVuY3lfa2V5XCIpfSBJUyBOVUxMIE9SIEVYSVNUUyAoYCArXG4gICAgICAgICAgYFNFTEVDVCAxIEZST00gJHtjb25jdXJyZW5jeVRhYmxlfSBXSEVSRSBgICtcbiAgICAgICAgICBgJHtjb25jdXJyZW5jeVRhYmxlfS4ke2RiLnF1b3RlQ29sdW1uKFwiY29uY3VycmVuY3lfa2V5XCIpfSA9ICR7am9ic1RhYmxlfS4ke2RiLnF1b3RlQ29sdW1uKFwiY29uY3VycmVuY3lfa2V5XCIpfSBBTkQgYCArXG4gICAgICAgICAgYCR7Y29uY3VycmVuY3lUYWJsZX0uJHtkYi5xdW90ZUNvbHVtbihcImFjdGl2ZV9jb3VudFwiKX0gPCAke2NvbmN1cnJlbmN5VGFibGV9LiR7ZGIucXVvdGVDb2x1bW4oXCJtYXhfY29uY3VycmVuY3lcIil9KSlgXG4gICAgICAgIClcblxuICAgICAgaWYgKHByaW9yaXR5T3JkZXIpIHF1ZXJ5ID0gcXVlcnkub3JkZXIoYCR7cHJpb3JpdHlPcmRlcn0gREVTQ2ApXG5cbiAgICAgIGNvbnN0IHJvd3MgPSBhd2FpdCBxdWVyeVxuICAgICAgICAub3JkZXIoXCJzY2hlZHVsZWRfYXRfbXMgQVNDXCIpXG4gICAgICAgIC5vcmRlcihcImNyZWF0ZWRfYXRfbXMgQVNDXCIpXG4gICAgICAgIC5vcmRlcihcImlkIEFTQ1wiKVxuICAgICAgICAubGltaXQoMSlcbiAgICAgICAgLnJlc3VsdHMoKVxuXG4gICAgICByZXR1cm4gcm93c1swXSA/IHRoaXMuX25vcm1hbGl6ZVJvdyhyb3dzWzBdKSA6IG51bGxcbiAgICB9KVxuICB9XG5cbiAgLyoqXG4gICAqIEZpbmRzIHRoZSBzb29uZXN0IGZ1dHVyZSBxdWV1ZWQgam9iLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxpbXBvcnQoXCIuL3R5cGVzLmpzXCIpLkJhY2tncm91bmRKb2JSb3cgfCBudWxsPn0gLSBTb29uZXN0IGZ1dHVyZSBxdWV1ZWQgam9iLlxuICAgKi9cbiAgYXN5bmMgbmV4dFNjaGVkdWxlZEpvYigpIHtcbiAgICBhd2FpdCB0aGlzLmVuc3VyZVJlYWR5KClcblxuICAgIHJldHVybiBhd2FpdCB0aGlzLl93aXRoRGIoYXN5bmMgKGRiKSA9PiB7XG4gICAgICBjb25zdCByb3dzID0gYXdhaXQgZGJcbiAgICAgICAgLm5ld1F1ZXJ5KClcbiAgICAgICAgLmZyb20oTE9DQUxfQkFDS0dST1VORF9KT0JTX1RBQkxFKVxuICAgICAgICAud2hlcmUoe3N0YXR1czogXCJxdWV1ZWRcIn0pXG4gICAgICAgIC53aGVyZShgc2NoZWR1bGVkX2F0X21zID4gJHtkYi5xdW90ZSh0aGlzLmNsb2NrLm5vdygpKX1gKVxuICAgICAgICAub3JkZXIoXCJzY2hlZHVsZWRfYXRfbXMgQVNDXCIpXG4gICAgICAgIC5vcmRlcihcImNyZWF0ZWRfYXRfbXMgQVNDXCIpXG4gICAgICAgIC5vcmRlcihcImlkIEFTQ1wiKVxuICAgICAgICAubGltaXQoMSlcbiAgICAgICAgLnJlc3VsdHMoKVxuXG4gICAgICByZXR1cm4gcm93c1swXSA/IHRoaXMuX25vcm1hbGl6ZVJvdyhyb3dzWzBdKSA6IG51bGxcbiAgICB9KVxuICB9XG5cbiAgLyoqXG4gICAqIEZpbmRzIGEgcGVyc2lzdGVkIGxvY2FsIGpvYiBieSBpZC5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGpvYklkIC0gSm9iIGlkLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxpbXBvcnQoXCIuL3R5cGVzLmpzXCIpLkJhY2tncm91bmRKb2JSb3cgfCBudWxsPn0gLSBQZXJzaXN0ZWQgam9iLlxuICAgKi9cbiAgYXN5bmMgZ2V0Sm9iKGpvYklkKSB7XG4gICAgYXdhaXQgdGhpcy5lbnN1cmVSZWFkeSgpXG5cbiAgICByZXR1cm4gYXdhaXQgdGhpcy5fd2l0aERiKGFzeW5jIChkYikgPT4gYXdhaXQgdGhpcy5fZ2V0Sm9iKGRiLCBqb2JJZCkpXG4gIH1cblxuICAvKipcbiAgICogTGlzdHMgbG9jYWwgam9icyBpbiBjcmVhdGlvbiBvcmRlci5cbiAgICogQHJldHVybnMge1Byb21pc2U8aW1wb3J0KFwiLi90eXBlcy5qc1wiKS5CYWNrZ3JvdW5kSm9iUm93W10+fSAtIEFsbCBsb2NhbCBqb2JzIGluIGNyZWF0aW9uIG9yZGVyLlxuICAgKi9cbiAgYXN5bmMgbGlzdEpvYnMoKSB7XG4gICAgYXdhaXQgdGhpcy5lbnN1cmVSZWFkeSgpXG5cbiAgICByZXR1cm4gYXdhaXQgdGhpcy5fd2l0aERiKGFzeW5jIChkYikgPT4ge1xuICAgICAgY29uc3Qgcm93cyA9IGF3YWl0IGRiXG4gICAgICAgIC5uZXdRdWVyeSgpXG4gICAgICAgIC5mcm9tKExPQ0FMX0JBQ0tHUk9VTkRfSk9CU19UQUJMRSlcbiAgICAgICAgLm9yZGVyKFwiY3JlYXRlZF9hdF9tcyBBU0NcIilcbiAgICAgICAgLm9yZGVyKFwiaWQgQVNDXCIpXG4gICAgICAgIC5yZXN1bHRzKClcblxuICAgICAgcmV0dXJuIHJvd3MubWFwKChyb3cpID0+IHRoaXMuX25vcm1hbGl6ZVJvdyhyb3cpKVxuICAgIH0pXG4gIH1cblxuICAvKipcbiAgICogQXRvbWljYWxseSByZXNlcnZlcyBjb25jdXJyZW5jeSBhbmQgY2xhaW1zIG9uZSBxdWV1ZWQgam9iLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vdHlwZXMuanNcIikuQmFja2dyb3VuZEpvYkhhbmRvZmZSZXF1ZXN0fSBhcmdzIC0gQ2xhaW0gcmVxdWVzdC4gQSBzdXBwbGllZCBoYW5kb2ZmIGlkIGlzIHBlcnNpc3RlZCBleGFjdGx5LlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxpbXBvcnQoXCIuL3R5cGVzLmpzXCIpLkJhY2tncm91bmRKb2JIYW5kb2ZmIHwgbnVsbD59IC0gRmVuY2VkIGNsYWltLlxuICAgKi9cbiAgYXN5bmMgbWFya0hhbmRlZE9mZih7am9iSWQsIGhhbmRvZmZJZCA9IG5ldyBVVUlEKDQpLmZvcm1hdCgpLCB3b3JrZXJJZH0pIHtcbiAgICBhd2FpdCB0aGlzLmVuc3VyZVJlYWR5KClcblxuICAgIHJldHVybiBhd2FpdCB0aGlzLl93aXRoRGIoYXN5bmMgKGNvbm5lY3Rpb24pID0+IGF3YWl0IHRoaXMuX211dGF0ZShjb25uZWN0aW9uLCBhc3luYyAoZGIpID0+IHtcbiAgICAgIGNvbnN0IGpvYiA9IGF3YWl0IHRoaXMuX2dldEpvYihkYiwgam9iSWQpXG5cbiAgICAgIGlmICgham9iIHx8IGpvYi5zdGF0dXMgIT09IFwicXVldWVkXCIgfHwgTnVtYmVyKGpvYi5zY2hlZHVsZWRBdE1zKSA+IHRoaXMuY2xvY2subm93KCkpIHJldHVybiBudWxsXG4gICAgICBpZiAoam9iLmNvbmN1cnJlbmN5S2V5ICYmICEoYXdhaXQgdGhpcy5fcmVzZXJ2ZUNvbmN1cnJlbmN5KGRiLCBqb2IuY29uY3VycmVuY3lLZXkpKSkgcmV0dXJuIG51bGxcblxuICAgICAgY29uc3QgaGFuZGVkT2ZmQXRNcyA9IHRoaXMuY2xvY2subm93KClcbiAgICAgIGNvbnN0IGFmZmVjdGVkUm93cyA9IGF3YWl0IHRoaXMuX3VwZGF0ZUFmZmVjdGVkUm93cyhkYiwge1xuICAgICAgICBjb25kaXRpb25zOiB7aWQ6IGpvYklkLCBzdGF0dXM6IFwicXVldWVkXCJ9LFxuICAgICAgICBkYXRhOiB7aGFuZGVkX29mZl9hdF9tczogaGFuZGVkT2ZmQXRNcywgaGFuZG9mZl9pZDogaGFuZG9mZklkLCBzdGF0dXM6IFwiaGFuZGVkX29mZlwiLCB3b3JrZXJfaWQ6IHdvcmtlcklkIHx8IFwibG9jYWxcIn0sXG4gICAgICAgIHRhYmxlTmFtZTogTE9DQUxfQkFDS0dST1VORF9KT0JTX1RBQkxFXG4gICAgICB9KVxuXG4gICAgICBpZiAoYWZmZWN0ZWRSb3dzICE9PSAxKSB7XG4gICAgICAgIGF3YWl0IHRoaXMuX3JlbGVhc2VDb25jdXJyZW5jeShkYiwgam9iLmNvbmN1cnJlbmN5S2V5KVxuICAgICAgICByZXR1cm4gbnVsbFxuICAgICAgfVxuXG4gICAgICByZXR1cm4ge2hhbmRlZE9mZkF0TXMsIGhhbmRvZmZJZH1cbiAgICB9KSlcbiAgfVxuXG4gIC8qKlxuICAgKiBGaW5kcyBhY3RpdmUgbG9jYWwgaGFuZG9mZnMgb3duZWQgYnkgb25lIHdvcmtlci5cbiAgICogQHBhcmFtIHt7d29ya2VySWQ6IHN0cmluZ319IGFyZ3MgLSBXb3JrZXIgaWRlbnRpdHkuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPEFycmF5PHtqb2JJZDogc3RyaW5nLCBoYW5kb2ZmSWQ6IHN0cmluZ30+Pn0gLSBBY3RpdmUgd29ya2VyIGhhbmRvZmZzLlxuICAgKi9cbiAgYXN5bmMgaGFuZGVkT2ZmSm9ic0Zvcldvcmtlcih7d29ya2VySWR9KSB7XG4gICAgYXdhaXQgdGhpcy5lbnN1cmVSZWFkeSgpXG5cbiAgICBjb25zdCByb3dzID0gYXdhaXQgdGhpcy5fd2l0aERiKGFzeW5jIChkYikgPT4gYXdhaXQgZGJcbiAgICAgIC5uZXdRdWVyeSgpXG4gICAgICAuZnJvbShMT0NBTF9CQUNLR1JPVU5EX0pPQlNfVEFCTEUpXG4gICAgICAud2hlcmUoe3N0YXR1czogXCJoYW5kZWRfb2ZmXCIsIHdvcmtlcl9pZDogd29ya2VySWR9KVxuICAgICAgLnJlc3VsdHMoKSlcbiAgICAvKiogQHR5cGUge0FycmF5PHtqb2JJZDogc3RyaW5nLCBoYW5kb2ZmSWQ6IHN0cmluZ30+fSAqL1xuICAgIGNvbnN0IGhhbmRvZmZzID0gW11cblxuICAgIGZvciAoY29uc3QgcmF3Um93IG9mIHJvd3MpIHtcbiAgICAgIGNvbnN0IGpvYiA9IHRoaXMuX25vcm1hbGl6ZVJvdyhyYXdSb3cpXG5cbiAgICAgIGlmIChqb2IuaGFuZG9mZklkKSBoYW5kb2Zmcy5wdXNoKHtqb2JJZDogam9iLmlkLCBoYW5kb2ZmSWQ6IGpvYi5oYW5kb2ZmSWR9KVxuICAgIH1cblxuICAgIHJldHVybiBoYW5kb2Zmc1xuICB9XG5cbiAgLyoqXG4gICAqIFJldHVybnMgYW4gZXhhY3QgYWN0aXZlIGhhbmRvZmYgdG8gdGhlIHF1ZXVlLlxuICAgKiBAcGFyYW0ge3tqb2JJZDogc3RyaW5nLCBoYW5kb2ZmSWQ6IHN0cmluZ319IGFyZ3MgLSBIYW5kb2ZmIHJlbGVhc2UuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIGFmdGVyIHRoZSBmZW5jZWQgcmVsZWFzZS5cbiAgICovXG4gIGFzeW5jIG1hcmtSZXR1cm5lZFRvUXVldWUoe2pvYklkLCBoYW5kb2ZmSWR9KSB7XG4gICAgYXdhaXQgdGhpcy5lbnN1cmVSZWFkeSgpXG5cbiAgICBhd2FpdCB0aGlzLl93aXRoRGIoYXN5bmMgKGNvbm5lY3Rpb24pID0+IGF3YWl0IHRoaXMuX211dGF0ZShjb25uZWN0aW9uLCBhc3luYyAoZGIpID0+IHtcbiAgICAgIGNvbnN0IGpvYiA9IGF3YWl0IHRoaXMuX2dldEpvYihkYiwgam9iSWQpXG5cbiAgICAgIGlmICghdGhpcy5fYWNjZXB0c0hhbmRvZmYoam9iLCBoYW5kb2ZmSWQpKSByZXR1cm5cbiAgICAgIGF3YWl0IHRoaXMuX2xvY2tDb25jdXJyZW5jeVJvdyhkYiwgam9iLmNvbmN1cnJlbmN5S2V5KVxuXG4gICAgICBjb25zdCBhZmZlY3RlZFJvd3MgPSBhd2FpdCB0aGlzLl91cGRhdGVBZmZlY3RlZFJvd3MoZGIsIHtcbiAgICAgICAgY29uZGl0aW9uczoge2hhbmRvZmZfaWQ6IGhhbmRvZmZJZCwgaWQ6IGpvYklkLCBzdGF0dXM6IFwiaGFuZGVkX29mZlwifSxcbiAgICAgICAgZGF0YToge1xuICAgICAgICAgIGhhbmRlZF9vZmZfYXRfbXM6IG51bGwsXG4gICAgICAgICAgaGFuZG9mZl9pZDogbnVsbCxcbiAgICAgICAgICBzY2hlZHVsZWRfYXRfbXM6IHRoaXMuY2xvY2subm93KCksXG4gICAgICAgICAgc3RhdHVzOiBcInF1ZXVlZFwiLFxuICAgICAgICAgIHdvcmtlcl9pZDogbnVsbFxuICAgICAgICB9LFxuICAgICAgICB0YWJsZU5hbWU6IExPQ0FMX0JBQ0tHUk9VTkRfSk9CU19UQUJMRVxuICAgICAgfSlcblxuICAgICAgaWYgKGFmZmVjdGVkUm93cyA9PT0gMSkgYXdhaXQgdGhpcy5fcmVsZWFzZUNvbmN1cnJlbmN5KGRiLCBqb2IuY29uY3VycmVuY3lLZXkpXG4gICAgfSkpXG4gIH1cblxuICAvKipcbiAgICogQXBwbGllcyBhIGZlbmNlZCBzdWNjZXNzZnVsIGFja25vd2xlZGdlbWVudC5cbiAgICogQHBhcmFtIHt7am9iSWQ6IHN0cmluZywgaGFuZG9mZklkPzogc3RyaW5nfX0gYXJncyAtIENvbXBsZXRpb24gcmVwb3J0LlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxib29sZWFuPn0gLSBXaGV0aGVyIHRoZSBsZWFzZSB3b24uXG4gICAqL1xuICBhc3luYyBtYXJrQ29tcGxldGVkKHtqb2JJZCwgaGFuZG9mZklkfSkge1xuICAgIGF3YWl0IHRoaXMuZW5zdXJlUmVhZHkoKVxuXG4gICAgcmV0dXJuIGF3YWl0IHRoaXMuX3dpdGhEYihhc3luYyAoY29ubmVjdGlvbikgPT4gYXdhaXQgdGhpcy5fbXV0YXRlKGNvbm5lY3Rpb24sIGFzeW5jIChkYikgPT4ge1xuICAgICAgY29uc3Qgam9iID0gYXdhaXQgdGhpcy5fZ2V0Sm9iKGRiLCBqb2JJZClcblxuICAgICAgaWYgKCF0aGlzLl9hY2NlcHRzSGFuZG9mZihqb2IsIGhhbmRvZmZJZCkpIHJldHVybiBmYWxzZVxuICAgICAgYXdhaXQgdGhpcy5fbG9ja0NvbmN1cnJlbmN5Um93KGRiLCBqb2IuY29uY3VycmVuY3lLZXkpXG5cbiAgICAgIGNvbnN0IGFmZmVjdGVkUm93cyA9IGF3YWl0IHRoaXMuX3VwZGF0ZUFmZmVjdGVkUm93cyhkYiwge1xuICAgICAgICBjb25kaXRpb25zOiB7aGFuZG9mZl9pZDogaGFuZG9mZklkLCBpZDogam9iSWQsIHN0YXR1czogXCJoYW5kZWRfb2ZmXCJ9LFxuICAgICAgICBkYXRhOiB7Y29tcGxldGVkX2F0X21zOiB0aGlzLmNsb2NrLm5vdygpLCBzdGF0dXM6IFwiY29tcGxldGVkXCJ9LFxuICAgICAgICB0YWJsZU5hbWU6IExPQ0FMX0JBQ0tHUk9VTkRfSk9CU19UQUJMRVxuICAgICAgfSlcblxuICAgICAgaWYgKGFmZmVjdGVkUm93cyAhPT0gMSkgcmV0dXJuIGZhbHNlXG4gICAgICBhd2FpdCB0aGlzLl9yZWxlYXNlQ29uY3VycmVuY3koZGIsIGpvYi5jb25jdXJyZW5jeUtleSlcbiAgICAgIHJldHVybiB0cnVlXG4gICAgfSkpXG4gIH1cblxuICAvKipcbiAgICogQXBwbGllcyBhIGZlbmNlZCByZXNjaGVkdWxlIHdpdGhvdXQgY29uc3VtaW5nIGFuIGF0dGVtcHQuXG4gICAqIEBwYXJhbSB7e2pvYklkOiBzdHJpbmcsIGhhbmRvZmZJZD86IHN0cmluZywgZGVsYXlNczogbnVtYmVyfX0gYXJncyAtIFJlc2NoZWR1bGUgcmVwb3J0LlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxib29sZWFuPn0gLSBXaGV0aGVyIHRoZSBsZWFzZSB3b24uXG4gICAqL1xuICBhc3luYyBtYXJrUmVzY2hlZHVsZWQoe2pvYklkLCBoYW5kb2ZmSWQsIGRlbGF5TXN9KSB7XG4gICAgYXdhaXQgdGhpcy5lbnN1cmVSZWFkeSgpXG5cbiAgICByZXR1cm4gYXdhaXQgdGhpcy5fd2l0aERiKGFzeW5jIChjb25uZWN0aW9uKSA9PiBhd2FpdCB0aGlzLl9tdXRhdGUoY29ubmVjdGlvbiwgYXN5bmMgKGRiKSA9PiB7XG4gICAgICBjb25zdCBqb2IgPSBhd2FpdCB0aGlzLl9nZXRKb2IoZGIsIGpvYklkKVxuXG4gICAgICBpZiAoIXRoaXMuX2FjY2VwdHNIYW5kb2ZmKGpvYiwgaGFuZG9mZklkKSkgcmV0dXJuIGZhbHNlXG4gICAgICBhd2FpdCB0aGlzLl9sb2NrQ29uY3VycmVuY3lSb3coZGIsIGpvYi5jb25jdXJyZW5jeUtleSlcblxuICAgICAgY29uc3QgYWZmZWN0ZWRSb3dzID0gYXdhaXQgdGhpcy5fdXBkYXRlQWZmZWN0ZWRSb3dzKGRiLCB7XG4gICAgICAgIGNvbmRpdGlvbnM6IHtoYW5kb2ZmX2lkOiBoYW5kb2ZmSWQsIGlkOiBqb2JJZCwgc3RhdHVzOiBcImhhbmRlZF9vZmZcIn0sXG4gICAgICAgIGRhdGE6IHtcbiAgICAgICAgICBoYW5kZWRfb2ZmX2F0X21zOiBudWxsLFxuICAgICAgICAgIGhhbmRvZmZfaWQ6IG51bGwsXG4gICAgICAgICAgc2NoZWR1bGVkX2F0X21zOiByZXNjaGVkdWxlZEJhY2tncm91bmRKb2JBdE1zKGRlbGF5TXMsIHRoaXMuY2xvY2subm93KCkpLFxuICAgICAgICAgIHN0YXR1czogXCJxdWV1ZWRcIixcbiAgICAgICAgICB3b3JrZXJfaWQ6IG51bGxcbiAgICAgICAgfSxcbiAgICAgICAgdGFibGVOYW1lOiBMT0NBTF9CQUNLR1JPVU5EX0pPQlNfVEFCTEVcbiAgICAgIH0pXG5cbiAgICAgIGlmIChhZmZlY3RlZFJvd3MgIT09IDEpIHJldHVybiBmYWxzZVxuICAgICAgYXdhaXQgdGhpcy5fcmVsZWFzZUNvbmN1cnJlbmN5KGRiLCBqb2IuY29uY3VycmVuY3lLZXkpXG4gICAgICByZXR1cm4gdHJ1ZVxuICAgIH0pKVxuICB9XG5cbiAgLyoqXG4gICAqIEFwcGxpZXMgYSBmZW5jZWQgZmFpbHVyZSwgcmV0cnksIG9yIHRlcm1pbmFsIHRyYW5zaXRpb24uXG4gICAqIEBwYXJhbSB7e2pvYklkOiBzdHJpbmcsIGhhbmRvZmZJZD86IHN0cmluZywgZXJyb3I6IFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fX0gYXJncyAtIEZhaWx1cmUgcmVwb3J0LlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxpbXBvcnQoXCIuL3R5cGVzLmpzXCIpLkJhY2tncm91bmRKb2JSb3cgfCBudWxsPn0gLSBBY2NlcHRlZCB0cmFuc2l0aW9uIHNuYXBzaG90LlxuICAgKi9cbiAgYXN5bmMgbWFya0ZhaWxlZCh7am9iSWQsIGhhbmRvZmZJZCwgZXJyb3J9KSB7XG4gICAgYXdhaXQgdGhpcy5lbnN1cmVSZWFkeSgpXG5cbiAgICByZXR1cm4gYXdhaXQgdGhpcy5fd2l0aERiKGFzeW5jIChjb25uZWN0aW9uKSA9PiBhd2FpdCB0aGlzLl9tdXRhdGUoY29ubmVjdGlvbiwgYXN5bmMgKGRiKSA9PiB7XG4gICAgICBjb25zdCBqb2IgPSBhd2FpdCB0aGlzLl9nZXRKb2IoZGIsIGpvYklkKVxuXG4gICAgICBpZiAoIXRoaXMuX2FjY2VwdHNIYW5kb2ZmKGpvYiwgaGFuZG9mZklkKSkgcmV0dXJuIG51bGxcblxuICAgICAgcmV0dXJuIGF3YWl0IHRoaXMuX2FwcGx5RmFpbHVyZShkYiwgam9iLCBlcnJvcilcbiAgICB9KSlcbiAgfVxuXG4gIC8qKlxuICAgKiBUdXJucyBldmVyeSBhYmFuZG9uZWQgbG9jYWwgaGFuZG9mZiBpbnRvIHRoZSBub3JtYWwgZmFpbHVyZS9yZXRyeSBwYXRoLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxpbXBvcnQoXCIuL3R5cGVzLmpzXCIpLkJhY2tncm91bmRKb2JSb3dbXT59IC0gUmVjb3ZlcmVkIHRyYW5zaXRpb25zLlxuICAgKi9cbiAgYXN5bmMgcmVjb3ZlckhhbmRlZE9mZkpvYnMoKSB7XG4gICAgYXdhaXQgdGhpcy5lbnN1cmVSZWFkeSgpXG5cbiAgICByZXR1cm4gYXdhaXQgdGhpcy5fd2l0aERiKGFzeW5jIChjb25uZWN0aW9uKSA9PiBhd2FpdCB0aGlzLl9tdXRhdGUoY29ubmVjdGlvbiwgYXN5bmMgKGRiKSA9PiB7XG4gICAgICBjb25zdCBxdWV1ZXMgPSB0aGlzLmNvbmZpZ3VyYXRpb24uZ2V0QmFja2dyb3VuZEpvYnNDb25maWcoKS5xdWV1ZXNcbiAgICAgIGNvbnN0IHJvd3MgPSBhd2FpdCBkYi5uZXdRdWVyeSgpLmZyb20oTE9DQUxfQkFDS0dST1VORF9KT0JTX1RBQkxFKS53aGVyZSh7c3RhdHVzOiBcImhhbmRlZF9vZmZcIn0pLnJlc3VsdHMoKVxuICAgICAgLyoqIEB0eXBlIHtpbXBvcnQoXCIuL3R5cGVzLmpzXCIpLkJhY2tncm91bmRKb2JSb3dbXX0gKi9cbiAgICAgIGNvbnN0IHJlY292ZXJlZCA9IFtdXG5cbiAgICAgIGZvciAoY29uc3QgcmF3Um93IG9mIHJvd3MpIHtcbiAgICAgICAgY29uc3Qgam9iID0gdGhpcy5fbm9ybWFsaXplUm93KHJhd1JvdylcbiAgICAgICAgY29uc3QgdXBkYXRlZCA9IGF3YWl0IHRoaXMuX2FwcGx5RmFpbHVyZShkYiwgam9iLCBuZXcgRXJyb3IoXCJMb2NhbCBiYWNrZ3JvdW5kIGpvYiByZWNvdmVyZWQgYWZ0ZXIgYW4gaW50ZXJydXB0ZWQgZGlzcGF0Y2hlclwiKSlcblxuICAgICAgICBpZiAoIXVwZGF0ZWQpIGNvbnRpbnVlXG5cbiAgICAgICAgY29uc3QgcmVjb25jaWxlZCA9IHVwZGF0ZWQuc3RhdHVzID09PSBcInF1ZXVlZFwiXG4gICAgICAgICAgPyBhd2FpdCB0aGlzLl9yZWNvbmNpbGVRdWV1ZWRKb2JDb25jdXJyZW5jeShkYiwgdXBkYXRlZCwgcXVldWVzKVxuICAgICAgICAgIDogdXBkYXRlZFxuXG4gICAgICAgIHJlY292ZXJlZC5wdXNoKHJlY29uY2lsZWQpXG4gICAgICB9XG5cbiAgICAgIGF3YWl0IHRoaXMuX3JlYnVpbGRDb25jdXJyZW5jeUNvdW50cyhkYilcbiAgICAgIHJldHVybiByZWNvdmVyZWRcbiAgICB9KSlcbiAgfVxuXG4gIC8qKlxuICAgKiBEZWxldGVzIGxvY2FsIHF1ZXVlIHN0YXRlIGZvciBmb2N1c2VkIHRlc3RzLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyBhZnRlciBkZWxldGlvbi5cbiAgICovXG4gIGFzeW5jIGNsZWFyQWxsKCkge1xuICAgIGF3YWl0IHRoaXMuZW5zdXJlUmVhZHkoKVxuICAgIGF3YWl0IHRoaXMuX3dpdGhEYihhc3luYyAoY29ubmVjdGlvbikgPT4gYXdhaXQgdGhpcy5fbXV0YXRlKGNvbm5lY3Rpb24sIGFzeW5jIChkYikgPT4ge1xuICAgICAgYXdhaXQgZGIucXVlcnkoYERFTEVURSBGUk9NICR7ZGIucXVvdGVUYWJsZShMT0NBTF9CQUNLR1JPVU5EX0pPQlNfVEFCTEUpfWApXG4gICAgICBhd2FpdCBkYi5xdWVyeShgREVMRVRFIEZST00gJHtkYi5xdW90ZVRhYmxlKExPQ0FMX0JBQ0tHUk9VTkRfSk9CX0NPTkNVUlJFTkNZX1RBQkxFKX1gKVxuICAgIH0pKVxuICB9XG5cbiAgLyoqXG4gICAqIEFwcGxpZXMgdGhlIGNvbW1vbiByZXRyeSBvciBleGhhdXN0ZWQgZmFpbHVyZSB0cmFuc2l0aW9uLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL2RhdGFiYXNlL2RyaXZlcnMvYmFzZS5qc1wiKS5kZWZhdWx0fSBkYiAtIExvY2FsIFNRTGl0ZSBjb25uZWN0aW9uLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vdHlwZXMuanNcIikuQmFja2dyb3VuZEpvYlJvd30gam9iIC0gQWN0aXZlIGhhbmRvZmYuXG4gICAqIEBwYXJhbSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59IGVycm9yIC0gUGVyZm9ybWFuY2UgZXJyb3IuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPGltcG9ydChcIi4vdHlwZXMuanNcIikuQmFja2dyb3VuZEpvYlJvdyB8IG51bGw+fSAtIFRyYW5zaXRpb24gc25hcHNob3QuXG4gICAqL1xuICBhc3luYyBfYXBwbHlGYWlsdXJlKGRiLCBqb2IsIGVycm9yKSB7XG4gICAgY29uc3QgYXR0ZW1wdHMgPSAoam9iLmF0dGVtcHRzIHx8IDApICsgMVxuICAgIGNvbnN0IG1heFJldHJpZXMgPSBub3JtYWxpemVCYWNrZ3JvdW5kSm9iTWF4UmV0cmllcyhqb2IubWF4UmV0cmllcylcbiAgICBjb25zdCB3aWxsUmV0cnkgPSBhdHRlbXB0cyA8PSBtYXhSZXRyaWVzXG4gICAgY29uc3Qgbm93TXMgPSB0aGlzLmNsb2NrLm5vdygpXG4gICAgLyoqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59ICovXG4gICAgY29uc3QgZGF0YSA9IHtcbiAgICAgIGF0dGVtcHRzLFxuICAgICAgaGFuZGVkX29mZl9hdF9tczogbnVsbCxcbiAgICAgIGhhbmRvZmZfaWQ6IG51bGwsXG4gICAgICBsYXN0X2Vycm9yOiBub3JtYWxpemVCYWNrZ3JvdW5kSm9iRXJyb3IoZXJyb3IpLFxuICAgICAgc3RhdHVzOiB3aWxsUmV0cnkgPyBcInF1ZXVlZFwiIDogXCJmYWlsZWRcIixcbiAgICAgIHdvcmtlcl9pZDogbnVsbFxuICAgIH1cblxuICAgIGlmICh3aWxsUmV0cnkpIHtcbiAgICAgIE9iamVjdC5hc3NpZ24oZGF0YSwge3NjaGVkdWxlZF9hdF9tczogbm93TXMgKyByZXRyeURlbGF5TXMoYXR0ZW1wdHMpfSlcbiAgICB9IGVsc2Uge1xuICAgICAgT2JqZWN0LmFzc2lnbihkYXRhLCB7ZmFpbGVkX2F0X21zOiBub3dNc30pXG4gICAgfVxuXG4gICAgYXdhaXQgdGhpcy5fbG9ja0NvbmN1cnJlbmN5Um93KGRiLCBqb2IuY29uY3VycmVuY3lLZXkpXG4gICAgY29uc3QgYWZmZWN0ZWRSb3dzID0gYXdhaXQgdGhpcy5fdXBkYXRlQWZmZWN0ZWRSb3dzKGRiLCB7XG4gICAgICBjb25kaXRpb25zOiB7aGFuZG9mZl9pZDogam9iLmhhbmRvZmZJZCwgaWQ6IGpvYi5pZCwgc3RhdHVzOiBcImhhbmRlZF9vZmZcIn0sXG4gICAgICBkYXRhLFxuICAgICAgdGFibGVOYW1lOiBMT0NBTF9CQUNLR1JPVU5EX0pPQlNfVEFCTEVcbiAgICB9KVxuXG4gICAgaWYgKGFmZmVjdGVkUm93cyAhPT0gMSkgcmV0dXJuIG51bGxcbiAgICBhd2FpdCB0aGlzLl9yZWxlYXNlQ29uY3VycmVuY3koZGIsIGpvYi5jb25jdXJyZW5jeUtleSlcblxuICAgIHJldHVybiB7XG4gICAgICAuLi5qb2IsXG4gICAgICBhdHRlbXB0cyxcbiAgICAgIGZhaWxlZEF0TXM6IHdpbGxSZXRyeSA/IGpvYi5mYWlsZWRBdE1zIDogbm93TXMsXG4gICAgICBoYW5kZWRPZmZBdE1zOiBudWxsLFxuICAgICAgaGFuZG9mZklkOiBudWxsLFxuICAgICAgbGFzdEVycm9yOiBkYXRhLmxhc3RfZXJyb3IsXG4gICAgICBzY2hlZHVsZWRBdE1zOiB3aWxsUmV0cnkgPyBOdW1iZXIoZGF0YS5zY2hlZHVsZWRfYXRfbXMpIDogam9iLnNjaGVkdWxlZEF0TXMsXG4gICAgICBzdGF0dXM6IGRhdGEuc3RhdHVzLFxuICAgICAgd29ya2VySWQ6IG51bGxcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogRW5zdXJlcyB0aGF0IGEgZHVyYWJsZSBjb25jdXJyZW5jeSBjb3VudGVyIGV4aXN0cyB3aXRoIHRoZSByZXF1aXJlZCBjYXAuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vZGF0YWJhc2UvZHJpdmVycy9iYXNlLmpzXCIpLmRlZmF1bHR9IGRiIC0gTG9jYWwgU1FMaXRlIGNvbm5lY3Rpb24uXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi90eXBlcy5qc1wiKS5SZXNvbHZlZEJhY2tncm91bmRKb2JDb25jdXJyZW5jeX0gY29uY3VycmVuY3kgLSBEZXNpcmVkIGNvdW50ZXIuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIHdoZW4gZW5zdXJlZC5cbiAgICovXG4gIGFzeW5jIF9lbnN1cmVDb25jdXJyZW5jeShkYiwgY29uY3VycmVuY3kpIHtcbiAgICBhd2FpdCBkYi51cHNlcnQoe1xuICAgICAgY29uZmxpY3RDb2x1bW5zOiBbXCJjb25jdXJyZW5jeV9rZXlcIl0sXG4gICAgICBkYXRhOiB7YWN0aXZlX2NvdW50OiAwLCBjb25jdXJyZW5jeV9rZXk6IGNvbmN1cnJlbmN5LmNvbmN1cnJlbmN5S2V5LCBtYXhfY29uY3VycmVuY3k6IGNvbmN1cnJlbmN5Lm1heENvbmN1cnJlbmN5fSxcbiAgICAgIHRhYmxlTmFtZTogTE9DQUxfQkFDS0dST1VORF9KT0JfQ09OQ1VSUkVOQ1lfVEFCTEUsXG4gICAgICB1cGRhdGVDb2x1bW5zOiBbXCJjb25jdXJyZW5jeV9rZXlcIl1cbiAgICB9KVxuXG4gICAgY29uc3Qgcm93cyA9IGF3YWl0IGRiXG4gICAgICAubmV3UXVlcnkoKVxuICAgICAgLmZyb20oTE9DQUxfQkFDS0dST1VORF9KT0JfQ09OQ1VSUkVOQ1lfVEFCTEUpXG4gICAgICAud2hlcmUoe2NvbmN1cnJlbmN5X2tleTogY29uY3VycmVuY3kuY29uY3VycmVuY3lLZXl9KVxuICAgICAgLmxpbWl0KDEpXG4gICAgICAucmVzdWx0cygpXG5cbiAgICBjb25zdCBleGlzdGluZ1JvdyA9IC8qKiBAdHlwZSB7e21heF9jb25jdXJyZW5jeTogbnVtYmVyIHwgc3RyaW5nfX0gKi8gKHJvd3NbMF0pXG4gICAgY29uc3QgZXhpc3RpbmdDYXAgPSBOdW1iZXIoZXhpc3RpbmdSb3cubWF4X2NvbmN1cnJlbmN5KVxuXG4gICAgaWYgKGV4aXN0aW5nQ2FwID09PSBjb25jdXJyZW5jeS5tYXhDb25jdXJyZW5jeSkgcmV0dXJuXG4gICAgaWYgKCFjb25jdXJyZW5jeS5xdWV1ZURlcml2ZWQpIHRocm93IG5ldyBFcnJvcihgQ29uZmxpY3RpbmcgbWF4Q29uY3VycmVuY3kgZm9yIGJhY2tncm91bmQgam9iIGNvbmN1cnJlbmN5S2V5OiAke2NvbmN1cnJlbmN5LmNvbmN1cnJlbmN5S2V5fWApXG5cbiAgICBhd2FpdCBkYi51cGRhdGUoe1xuICAgICAgY29uZGl0aW9uczoge2NvbmN1cnJlbmN5X2tleTogY29uY3VycmVuY3kuY29uY3VycmVuY3lLZXl9LFxuICAgICAgZGF0YToge21heF9jb25jdXJyZW5jeTogY29uY3VycmVuY3kubWF4Q29uY3VycmVuY3l9LFxuICAgICAgdGFibGVOYW1lOiBMT0NBTF9CQUNLR1JPVU5EX0pPQl9DT05DVVJSRU5DWV9UQUJMRVxuICAgIH0pXG4gIH1cblxuICAvKipcbiAgICogQXRvbWljYWxseSByZXNlcnZlcyBvbmUgc2xvdCBmb3IgYSBjb25jdXJyZW5jeSBrZXkuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vZGF0YWJhc2UvZHJpdmVycy9iYXNlLmpzXCIpLmRlZmF1bHR9IGRiIC0gQ29ubmVjdGlvbi5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGNvbmN1cnJlbmN5S2V5IC0gQ29uY3VycmVuY3kga2V5LlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxib29sZWFuPn0gLSBXaGV0aGVyIGEgc2xvdCB3YXMgcmVzZXJ2ZWQuXG4gICAqL1xuICBhc3luYyBfcmVzZXJ2ZUNvbmN1cnJlbmN5KGRiLCBjb25jdXJyZW5jeUtleSkge1xuICAgIGNvbnN0IHRhYmxlID0gZGIucXVvdGVUYWJsZShMT0NBTF9CQUNLR1JPVU5EX0pPQl9DT05DVVJSRU5DWV9UQUJMRSlcbiAgICBjb25zdCBjb3VudCA9IGRiLnF1b3RlQ29sdW1uKFwiYWN0aXZlX2NvdW50XCIpXG4gICAgY29uc3QgYWZmZWN0ZWRSb3dzID0gYXdhaXQgZGIuYWZmZWN0ZWRSb3dzKFxuICAgICAgYFVQREFURSAke3RhYmxlfSBTRVQgJHtjb3VudH0gPSAke2NvdW50fSArIDEgYCArXG4gICAgICBgV0hFUkUgJHtkYi5xdW90ZUNvbHVtbihcImNvbmN1cnJlbmN5X2tleVwiKX0gPSAke2RiLnF1b3RlKGNvbmN1cnJlbmN5S2V5KX0gYCArXG4gICAgICBgQU5EICR7Y291bnR9IDwgJHtkYi5xdW90ZUNvbHVtbihcIm1heF9jb25jdXJyZW5jeVwiKX1gXG4gICAgKVxuXG4gICAgcmV0dXJuIGFmZmVjdGVkUm93cyA9PT0gMVxuICB9XG5cbiAgLyoqXG4gICAqIFJlbGVhc2VzIG9uZSBzbG90IGZvciBhIGNvbmN1cnJlbmN5IGtleS5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9kYXRhYmFzZS9kcml2ZXJzL2Jhc2UuanNcIikuZGVmYXVsdH0gZGIgLSBDb25uZWN0aW9uLlxuICAgKiBAcGFyYW0ge3N0cmluZyB8IG51bGx9IGNvbmN1cnJlbmN5S2V5IC0gQ29uY3VycmVuY3kga2V5LlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyBhZnRlciByZWxlYXNlLlxuICAgKi9cbiAgYXN5bmMgX3JlbGVhc2VDb25jdXJyZW5jeShkYiwgY29uY3VycmVuY3lLZXkpIHtcbiAgICBpZiAoIWNvbmN1cnJlbmN5S2V5KSByZXR1cm5cblxuICAgIGNvbnN0IHRhYmxlID0gZGIucXVvdGVUYWJsZShMT0NBTF9CQUNLR1JPVU5EX0pPQl9DT05DVVJSRU5DWV9UQUJMRSlcbiAgICBjb25zdCBjb3VudCA9IGRiLnF1b3RlQ29sdW1uKFwiYWN0aXZlX2NvdW50XCIpXG5cbiAgICBhd2FpdCBkYi5hZmZlY3RlZFJvd3MoXG4gICAgICBgVVBEQVRFICR7dGFibGV9IFNFVCAke2NvdW50fSA9ICR7Y291bnR9IC0gMSBgICtcbiAgICAgIGBXSEVSRSAke2RiLnF1b3RlQ29sdW1uKFwiY29uY3VycmVuY3lfa2V5XCIpfSA9ICR7ZGIucXVvdGUoY29uY3VycmVuY3lLZXkpfSBBTkQgJHtjb3VudH0gPiAwYFxuICAgIClcbiAgfVxuXG4gIC8qKlxuICAgKiBBY3F1aXJlcyB0aGUgdHJhbnNhY3Rpb24ncyB3cml0ZSBsb2NrIGZvciBhIGNvbmN1cnJlbmN5IGNvdW50ZXIgcm93LlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL2RhdGFiYXNlL2RyaXZlcnMvYmFzZS5qc1wiKS5kZWZhdWx0fSBkYiAtIENvbm5lY3Rpb24uXG4gICAqIEBwYXJhbSB7c3RyaW5nIHwgbnVsbH0gY29uY3VycmVuY3lLZXkgLSBDb25jdXJyZW5jeSBrZXkuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIGFmdGVyIGxvY2tpbmcuXG4gICAqL1xuICBhc3luYyBfbG9ja0NvbmN1cnJlbmN5Um93KGRiLCBjb25jdXJyZW5jeUtleSkge1xuICAgIGlmICghY29uY3VycmVuY3lLZXkpIHJldHVyblxuXG4gICAgY29uc3QgdGFibGUgPSBkYi5xdW90ZVRhYmxlKExPQ0FMX0JBQ0tHUk9VTkRfSk9CX0NPTkNVUlJFTkNZX1RBQkxFKVxuICAgIGNvbnN0IGNvdW50ID0gZGIucXVvdGVDb2x1bW4oXCJhY3RpdmVfY291bnRcIilcblxuICAgIGF3YWl0IGRiLnF1ZXJ5KFxuICAgICAgYFVQREFURSAke3RhYmxlfSBTRVQgJHtjb3VudH0gPSAke2NvdW50fSBgICtcbiAgICAgIGBXSEVSRSAke2RiLnF1b3RlQ29sdW1uKFwiY29uY3VycmVuY3lfa2V5XCIpfSA9ICR7ZGIucXVvdGUoY29uY3VycmVuY3lLZXkpfWBcbiAgICApXG4gIH1cblxuICAvKipcbiAgICogUmVidWlsZHMgYWN0aXZlIGNvdW50ZXJzIGZyb20gZHVyYWJsZSBoYW5kZWQtb2ZmIGpvYnMuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vZGF0YWJhc2UvZHJpdmVycy9iYXNlLmpzXCIpLmRlZmF1bHR9IGRiIC0gQ29ubmVjdGlvbi5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgYWZ0ZXIgY291bnRlciByZWJ1aWxkLlxuICAgKi9cbiAgYXN5bmMgX3JlYnVpbGRDb25jdXJyZW5jeUNvdW50cyhkYikge1xuICAgIGNvbnN0IGNvbmN1cnJlbmN5VGFibGUgPSBkYi5xdW90ZVRhYmxlKExPQ0FMX0JBQ0tHUk9VTkRfSk9CX0NPTkNVUlJFTkNZX1RBQkxFKVxuICAgIGNvbnN0IGpvYnNUYWJsZSA9IGRiLnF1b3RlVGFibGUoTE9DQUxfQkFDS0dST1VORF9KT0JTX1RBQkxFKVxuXG4gICAgYXdhaXQgZGIucXVlcnkoXG4gICAgICBgVVBEQVRFICR7Y29uY3VycmVuY3lUYWJsZX0gU0VUICR7ZGIucXVvdGVDb2x1bW4oXCJhY3RpdmVfY291bnRcIil9ID0gKGAgK1xuICAgICAgYFNFTEVDVCBDT1VOVCgqKSBGUk9NICR7am9ic1RhYmxlfSBXSEVSRSAke2pvYnNUYWJsZX0uJHtkYi5xdW90ZUNvbHVtbihcInN0YXR1c1wiKX0gPSAke2RiLnF1b3RlKFwiaGFuZGVkX29mZlwiKX0gQU5EIGAgK1xuICAgICAgYCR7am9ic1RhYmxlfS4ke2RiLnF1b3RlQ29sdW1uKFwiY29uY3VycmVuY3lfa2V5XCIpfSA9ICR7Y29uY3VycmVuY3lUYWJsZX0uJHtkYi5xdW90ZUNvbHVtbihcImNvbmN1cnJlbmN5X2tleVwiKX0pYFxuICAgIClcbiAgfVxuXG4gIC8qKlxuICAgKiBCdWlsZHMgdGhlIGNvbmZpZ3VyZWQgcXVldWUtcHJpb3JpdHkgb3JkZXJpbmcgZXhwcmVzc2lvbi5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9kYXRhYmFzZS9kcml2ZXJzL2Jhc2UuanNcIikuZGVmYXVsdH0gZGIgLSBDb25uZWN0aW9uLlxuICAgKiBAcmV0dXJucyB7c3RyaW5nIHwgbnVsbH0gLSBRdWV1ZSBwcmlvcml0eSBleHByZXNzaW9uLlxuICAgKi9cbiAgX3F1ZXVlUHJpb3JpdHlPcmRlclNxbChkYikge1xuICAgIGNvbnN0IHF1ZXVlcyA9IHRoaXMuY29uZmlndXJhdGlvbi5nZXRCYWNrZ3JvdW5kSm9ic0NvbmZpZygpLnF1ZXVlc1xuICAgIGNvbnN0IHByaW9yaXRpemVkID0gT2JqZWN0LmVudHJpZXMocXVldWVzKVxuICAgICAgLmZpbHRlcigoWywgcXVldWVdKSA9PiBOdW1iZXIuaXNGaW5pdGUocXVldWU/LnByaW9yaXR5KSAmJiBOdW1iZXIocXVldWUucHJpb3JpdHkpICE9PSAwKVxuICAgICAgLm1hcCgoW3F1ZXVlTmFtZSwgcXVldWVdKSA9PiBbcXVldWVOYW1lLCBOdW1iZXIocXVldWUucHJpb3JpdHkpXSlcblxuICAgIGlmIChwcmlvcml0aXplZC5sZW5ndGggPT09IDApIHJldHVybiBudWxsXG5cbiAgICBjb25zdCB3aGVucyA9IHByaW9yaXRpemVkXG4gICAgICAubWFwKChbcXVldWUsIHByaW9yaXR5XSkgPT4gYFdIRU4gJHtkYi5xdW90ZShxdWV1ZSl9IFRIRU4gJHtwcmlvcml0eX1gKVxuICAgICAgLmpvaW4oXCIgXCIpXG5cbiAgICByZXR1cm4gYENBU0UgQ09BTEVTQ0UoJHtkYi5xdW90ZUNvbHVtbihcInF1ZXVlXCIpfSwgJHtkYi5xdW90ZShERUZBVUxUX0JBQ0tHUk9VTkRfSk9CX1FVRVVFKX0pICR7d2hlbnN9IEVMU0UgMCBFTkRgXG4gIH1cblxuICAvKipcbiAgICogQ2hlY2tzIHdoZXRoZXIgYSBwZXJzaXN0ZWQgaGFuZG9mZiBvd25zIHRoZSBzdXBwbGllZCBhY2tub3dsZWRnZW1lbnQgZmVuY2UuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi90eXBlcy5qc1wiKS5CYWNrZ3JvdW5kSm9iUm93IHwgbnVsbH0gam9iIC0gUGVyc2lzdGVkIGpvYi5cbiAgICogQHBhcmFtIHtzdHJpbmcgfCB1bmRlZmluZWR9IGhhbmRvZmZJZCAtIEhhbmRvZmYgZmVuY2UuXG4gICAqIEByZXR1cm5zIHtqb2IgaXMgaW1wb3J0KFwiLi90eXBlcy5qc1wiKS5CYWNrZ3JvdW5kSm9iUm93fSAtIFdoZXRoZXIgYWNjZXB0ZWQuXG4gICAqL1xuICBfYWNjZXB0c0hhbmRvZmYoam9iLCBoYW5kb2ZmSWQpIHtcbiAgICByZXR1cm4gQm9vbGVhbihqb2IgJiYgam9iLnN0YXR1cyA9PT0gXCJoYW5kZWRfb2ZmXCIgJiYgam9iLmhhbmRvZmZJZCAmJiBqb2IuaGFuZG9mZklkID09PSBoYW5kb2ZmSWQpXG4gIH1cblxuICAvKipcbiAgICogRmluZHMgYSBwZXJzaXN0ZWQgbG9jYWwgam9iIHVzaW5nIHRoZSBjdXJyZW50IGNvbm5lY3Rpb24uXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vZGF0YWJhc2UvZHJpdmVycy9iYXNlLmpzXCIpLmRlZmF1bHR9IGRiIC0gQ29ubmVjdGlvbi5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGpvYklkIC0gSm9iIGlkLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxpbXBvcnQoXCIuL3R5cGVzLmpzXCIpLkJhY2tncm91bmRKb2JSb3cgfCBudWxsPn0gLSBQZXJzaXN0ZWQgcm93LlxuICAgKi9cbiAgYXN5bmMgX2dldEpvYihkYiwgam9iSWQpIHtcbiAgICBjb25zdCByb3dzID0gYXdhaXQgZGIubmV3UXVlcnkoKS5mcm9tKExPQ0FMX0JBQ0tHUk9VTkRfSk9CU19UQUJMRSkud2hlcmUoe2lkOiBqb2JJZH0pLmxpbWl0KDEpLnJlc3VsdHMoKVxuXG4gICAgcmV0dXJuIHJvd3NbMF0gPyB0aGlzLl9ub3JtYWxpemVSb3cocm93c1swXSkgOiBudWxsXG4gIH1cblxuICAvKipcbiAgICogTm9ybWFsaXplcyBvbmUgcmF3IGxvY2FsIGRhdGFiYXNlIHJvdy5cbiAgICogQHBhcmFtIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59IHJvdyAtIFJhdyByb3cuXG4gICAqIEByZXR1cm5zIHtpbXBvcnQoXCIuL3R5cGVzLmpzXCIpLkJhY2tncm91bmRKb2JSb3d9IC0gTm9ybWFsaXplZCByb3cuXG4gICAqL1xuICBfbm9ybWFsaXplUm93KHJvdykge1xuICAgIGNvbnN0IHBhcnNlZEFyZ3MgPSBKU09OLnBhcnNlKFN0cmluZyhyb3cuYXJnc19qc29uKSlcbiAgICBjb25zdCBleGVjdXRpb25Nb2RlID0gbm9ybWFsaXplQmFja2dyb3VuZEpvYkV4ZWN1dGlvbk1vZGUoe2V4ZWN1dGlvbk1vZGU6IFN0cmluZyhyb3cuZXhlY3V0aW9uX21vZGUpfSwgXCJpbmxpbmVcIiwgTE9DQUxfRVhFQ1VUSU9OX01PREVTKVxuXG4gICAgaWYgKCFBcnJheS5pc0FycmF5KHBhcnNlZEFyZ3MpKSB0aHJvdyBuZXcgRXJyb3IoYEludmFsaWQgbG9jYWwgYmFja2dyb3VuZCBqb2IgYXJnc19qc29uIGZvciBqb2I6ICR7U3RyaW5nKHJvdy5pZCl9YClcbiAgICBpZiAoZXhlY3V0aW9uTW9kZSAhPT0gXCJpbmxpbmVcIikgdGhyb3cgbmV3IEVycm9yKFwiTG9jYWwgYmFja2dyb3VuZCBqb2IgZXhlY3V0aW9uIG1vZGUgaW52YXJpYW50IHdhcyB2aW9sYXRlZFwiKVxuXG4gICAgcmV0dXJuIHtcbiAgICAgIGFyZ3M6IHBhcnNlZEFyZ3MsXG4gICAgICBhdHRlbXB0czogdGhpcy5fbnVtYmVyT3JOdWxsKHJvdy5hdHRlbXB0cyksXG4gICAgICBjb21wbGV0ZWRBdE1zOiB0aGlzLl9udW1iZXJPck51bGwocm93LmNvbXBsZXRlZF9hdF9tcyksXG4gICAgICBjb25jdXJyZW5jeUtleTogcm93LmNvbmN1cnJlbmN5X2tleSA9PT0gbnVsbCB8fCByb3cuY29uY3VycmVuY3lfa2V5ID09PSB1bmRlZmluZWQgPyBudWxsIDogU3RyaW5nKHJvdy5jb25jdXJyZW5jeV9rZXkpLFxuICAgICAgY3JlYXRlZEF0TXM6IHRoaXMuX251bWJlck9yTnVsbChyb3cuY3JlYXRlZF9hdF9tcyksXG4gICAgICBleGVjdXRpb25Nb2RlLFxuICAgICAgZmFpbGVkQXRNczogdGhpcy5fbnVtYmVyT3JOdWxsKHJvdy5mYWlsZWRfYXRfbXMpLFxuICAgICAgaGFuZGVkT2ZmQXRNczogdGhpcy5fbnVtYmVyT3JOdWxsKHJvdy5oYW5kZWRfb2ZmX2F0X21zKSxcbiAgICAgIGhhbmRvZmZJZDogcm93LmhhbmRvZmZfaWQgPT09IG51bGwgfHwgcm93LmhhbmRvZmZfaWQgPT09IHVuZGVmaW5lZCA/IG51bGwgOiBTdHJpbmcocm93LmhhbmRvZmZfaWQpLFxuICAgICAgaWQ6IFN0cmluZyhyb3cuaWQpLFxuICAgICAgam9iTmFtZTogU3RyaW5nKHJvdy5qb2JfbmFtZSksXG4gICAgICBsYXN0RXJyb3I6IHJvdy5sYXN0X2Vycm9yID09PSBudWxsIHx8IHJvdy5sYXN0X2Vycm9yID09PSB1bmRlZmluZWQgPyBudWxsIDogU3RyaW5nKHJvdy5sYXN0X2Vycm9yKSxcbiAgICAgIG1heENvbmN1cnJlbmN5OiB0aGlzLl9udW1iZXJPck51bGwocm93Lm1heF9jb25jdXJyZW5jeSksXG4gICAgICBtYXhSZXRyaWVzOiB0aGlzLl9udW1iZXJPck51bGwocm93Lm1heF9yZXRyaWVzKSxcbiAgICAgIG9ycGhhbmVkQXRNczogbnVsbCxcbiAgICAgIHF1ZXVlOiByb3cucXVldWUgPyBTdHJpbmcocm93LnF1ZXVlKSA6IERFRkFVTFRfQkFDS0dST1VORF9KT0JfUVVFVUUsXG4gICAgICBzY2hlZHVsZUtleTogbnVsbCxcbiAgICAgIHNjaGVkdWxlZEF0TXM6IHRoaXMuX251bWJlck9yTnVsbChyb3cuc2NoZWR1bGVkX2F0X21zKSxcbiAgICAgIHN0YXR1czogcm93LnN0YXR1cyA/IFN0cmluZyhyb3cuc3RhdHVzKSA6IFwicXVldWVkXCIsXG4gICAgICB0aW1lb3V0TXM6IG51bGwsXG4gICAgICB3b3JrZXJJZDogcm93Lndvcmtlcl9pZCA9PT0gbnVsbCB8fCByb3cud29ya2VyX2lkID09PSB1bmRlZmluZWQgPyBudWxsIDogU3RyaW5nKHJvdy53b3JrZXJfaWQpXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIE5vcm1hbGl6ZXMgb25lIG51bGxhYmxlIGRhdGFiYXNlIG51bWJlci5cbiAgICogQHBhcmFtIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gdmFsdWUgLSBEYXRhYmFzZSBudW1iZXIuXG4gICAqIEByZXR1cm5zIHtudW1iZXIgfCBudWxsfSAtIE5vcm1hbGl6ZWQgbnVtYmVyLlxuICAgKi9cbiAgX251bWJlck9yTnVsbCh2YWx1ZSkge1xuICAgIGlmICh2YWx1ZSA9PT0gbnVsbCB8fCB2YWx1ZSA9PT0gdW5kZWZpbmVkIHx8IHZhbHVlID09PSBcIlwiKSByZXR1cm4gbnVsbFxuXG4gICAgY29uc3QgbnVtYmVyID0gTnVtYmVyKHZhbHVlKVxuXG4gICAgcmV0dXJuIE51bWJlci5pc05hTihudW1iZXIpID8gbnVsbCA6IG51bWJlclxuICB9XG5cbiAgLyoqXG4gICAqIEV4ZWN1dGVzIGEgc3RydWN0dXJlZCB1cGRhdGUgYW5kIHJlcG9ydHMgaXRzIGFmZmVjdGVkLXJvdyBjb3VudC5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9kYXRhYmFzZS9kcml2ZXJzL2Jhc2UuanNcIikuZGVmYXVsdH0gZGIgLSBDb25uZWN0aW9uLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL2RhdGFiYXNlL2RyaXZlcnMvYmFzZS5qc1wiKS5VcGRhdGVTcWxBcmdzVHlwZX0gYXJncyAtIFVwZGF0ZSBhcmd1bWVudHMuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPG51bWJlcj59IC0gQWZmZWN0ZWQgcm93cy5cbiAgICovXG4gIGFzeW5jIF91cGRhdGVBZmZlY3RlZFJvd3MoZGIsIGFyZ3MpIHsgcmV0dXJuIGF3YWl0IGRiLmFmZmVjdGVkUm93cyhkYi51cGRhdGVTcWwoYXJncykpIH1cblxuICAvKipcbiAgICogSm9pbnMgYW4gYW1iaWVudCBhcHAgdHJhbnNhY3Rpb24gb3IgdXNlcyB0aGUgZGF0YWJhc2UncyBzY29wZWQgb3BlcmF0aW9uIGxlYXNlLlxuICAgKiBAdGVtcGxhdGUgVFxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL2RhdGFiYXNlL2RyaXZlcnMvYmFzZS5qc1wiKS5kZWZhdWx0fSBkYiAtIENvbm5lY3Rpb24uXG4gICAqIEBwYXJhbSB7KGRiOiBpbXBvcnQoXCIuLi9kYXRhYmFzZS9kcml2ZXJzL2Jhc2UuanNcIikuZGVmYXVsdCkgPT4gUHJvbWlzZTxUPn0gY2FsbGJhY2sgLSBNdXRhdGlvbi5cbiAgICogQHJldHVybnMge1Byb21pc2U8VD59IC0gTXV0YXRpb24gcmVzdWx0LlxuICAgKi9cbiAgYXN5bmMgX211dGF0ZShkYiwgY2FsbGJhY2spIHtcbiAgICBpZiAoZGIuaW5zaWRlVHJhbnNhY3Rpb24oKSkgcmV0dXJuIGF3YWl0IHRoaXMuX3RyYW5zYWN0aW9uUmVzdWx0KGRiLCBhc3luYyAoKSA9PiBhd2FpdCBjYWxsYmFjayhkYikpXG5cbiAgICByZXR1cm4gYXdhaXQgdGhpcy5jb25maWd1cmF0aW9uLndpdGhUcmFuc2FjdGlvbih7XG4gICAgICBkYXRhYmFzZUlkZW50aWZpZXI6IHRoaXMuZ2V0RGF0YWJhc2VJZGVudGlmaWVyKCksXG4gICAgICBuYW1lOiBcIkxvY2FsIGJhY2tncm91bmQgam9icyBtdXRhdGlvblwiXG4gICAgfSwgYXN5bmMgKG9wZXJhdGlvbikgPT4gYXdhaXQgY2FsbGJhY2sob3BlcmF0aW9uLmNvbm5lY3Rpb24oKSkpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBhIGNhbGxiYWNrIGluIGEgdHJhbnNhY3Rpb24gYW5kIHJldHVybnMgaXRzIGNhcHR1cmVkIHJlc3VsdC5cbiAgICogQHRlbXBsYXRlIFRcbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9kYXRhYmFzZS9kcml2ZXJzL2Jhc2UuanNcIikuZGVmYXVsdH0gZGIgLSBDb25uZWN0aW9uLlxuICAgKiBAcGFyYW0geygpID0+IFByb21pc2U8VD59IGNhbGxiYWNrIC0gVHJhbnNhY3Rpb24gY2FsbGJhY2suXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPFQ+fSAtIENhbGxiYWNrIHJlc3VsdC5cbiAgICovXG4gIGFzeW5jIF90cmFuc2FjdGlvblJlc3VsdChkYiwgY2FsbGJhY2spIHtcbiAgICBsZXQgY29tcGxldGVkID0gZmFsc2VcbiAgICAvKiogQHR5cGUge1QgfCB1bmRlZmluZWR9ICovXG4gICAgbGV0IHJlc3VsdFxuXG4gICAgYXdhaXQgZGIudHJhbnNhY3Rpb24oYXN5bmMgKCkgPT4ge1xuICAgICAgcmVzdWx0ID0gYXdhaXQgY2FsbGJhY2soKVxuICAgICAgY29tcGxldGVkID0gdHJ1ZVxuICAgIH0pXG5cbiAgICBpZiAoIWNvbXBsZXRlZCkgdGhyb3cgbmV3IEVycm9yKFwiTG9jYWwgYmFja2dyb3VuZCBqb2JzIHRyYW5zYWN0aW9uIGNhbGxiYWNrIHdhcyBub3QgaW52b2tlZFwiKVxuICAgIHJldHVybiAvKiogQHR5cGUge1R9ICovIChyZXN1bHQpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBhIGNhbGxiYWNrIHdpdGggdGhlIGNvbmZpZ3VyZWQgbG9jYWwgZGF0YWJhc2UgY29ubmVjdGlvbi5cbiAgICogQHRlbXBsYXRlIFRcbiAgICogQHBhcmFtIHsoZGI6IGltcG9ydChcIi4uL2RhdGFiYXNlL2RyaXZlcnMvYmFzZS5qc1wiKS5kZWZhdWx0KSA9PiBQcm9taXNlPFQ+fSBjYWxsYmFjayAtIENvbm5lY3Rpb24gY2FsbGJhY2suXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPFQ+fSAtIENhbGxiYWNrIHJlc3VsdC5cbiAgICovXG4gIGFzeW5jIF93aXRoRGIoY2FsbGJhY2spIHtcbiAgICBjb25zdCBkYXRhYmFzZUlkZW50aWZpZXIgPSB0aGlzLmdldERhdGFiYXNlSWRlbnRpZmllcigpXG5cbiAgICByZXR1cm4gYXdhaXQgdGhpcy5jb25maWd1cmF0aW9uLmVuc3VyZUNvbm5lY3Rpb25zKHtkYXRhYmFzZUlkZW50aWZpZXJzOiBbZGF0YWJhc2VJZGVudGlmaWVyXSwgbmFtZTogXCJMb2NhbCBiYWNrZ3JvdW5kIGpvYnMgc3RvcmVcIn0sIGFzeW5jIChkYnMpID0+IHtcbiAgICAgIGNvbnN0IGRiID0gZGJzW2RhdGFiYXNlSWRlbnRpZmllcl1cblxuICAgICAgaWYgKCFkYikgdGhyb3cgbmV3IEVycm9yKGBObyBsb2NhbCBiYWNrZ3JvdW5kLWpvYnMgZGF0YWJhc2UgY29ubmVjdGlvbiBhdmFpbGFibGUgZm9yIGlkZW50aWZpZXI6ICR7ZGF0YWJhc2VJZGVudGlmaWVyfWApXG5cbiAgICAgIHJldHVybiBhd2FpdCBjYWxsYmFjayhkYilcbiAgICB9KVxuICB9XG5cbiAgLyoqXG4gICAqIFJlcG9ydHMgYW4gdW5leHBlY3RlZCBsb2NhbC1zdG9yZSBmYWlsdXJlIHRocm91Z2ggZnJhbWV3b3JrIGNoYW5uZWxzLlxuICAgKiBAcGFyYW0ge3tlcnJvcjogRXJyb3IsIHN0YWdlOiBzdHJpbmd9fSBhcmdzIC0gRXJyb3IgcmVwb3J0LlxuICAgKiBAcmV0dXJucyB7dm9pZH0gLSBObyByZXR1cm4gdmFsdWUuXG4gICAqL1xuICBfcmVwb3J0RnJhbWV3b3JrRXJyb3Ioe2Vycm9yLCBzdGFnZX0pIHtcbiAgICBjb25zdCBwYXlsb2FkID0ge2NvbnRleHQ6IHtzdGFnZX0sIGVycm9yfVxuICAgIGNvbnN0IGVycm9yRXZlbnRzID0gdGhpcy5jb25maWd1cmF0aW9uLmdldEVycm9yRXZlbnRzKClcblxuICAgIGVycm9yRXZlbnRzLmVtaXQoXCJmcmFtZXdvcmstZXJyb3JcIiwgcGF5bG9hZClcbiAgICBlcnJvckV2ZW50cy5lbWl0KFwiYWxsLWVycm9yXCIsIHsuLi5wYXlsb2FkLCBlcnJvclR5cGU6IFwiZnJhbWV3b3JrLWVycm9yXCJ9KVxuICB9XG59XG4iXX0=