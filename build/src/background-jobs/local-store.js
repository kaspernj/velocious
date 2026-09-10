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
    "max_concurrency",
    "child_received_at_ms",
    "child_started_at_ms",
    "child_instance_id",
    "child_pid"
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
            if (await this._ensureJobColumns(db))
                changed = true;
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
     * Idempotently adds columns from the current jobs table definition that an
     * existing local table is missing, so an upgraded framework finds a
     * compatible schema instead of failing the column assertion.
     * @param {import("../database/drivers/base.js").default} db - Local SQLite connection.
     * @returns {Promise<boolean>} - Whether a column was added.
     */
    async _ensureJobColumns(db) {
        db.clearSchemaCache();
        const table = await db.getTableByNameOrFail(LOCAL_BACKGROUND_JOBS_TABLE);
        const tableData = new TableData(LOCAL_BACKGROUND_JOBS_TABLE);
        let added = false;
        for (const column of this._jobsTableData().getColumns()) {
            if (await table.getColumnByName(column.getName()))
                continue;
            if (column.getPrimaryKey())
                continue;
            const columnArgs = /** @type {{null: boolean, maxLength?: number}} */ ({ null: column.getNull() !== false });
            const maxLength = column.getMaxLength();
            if (typeof maxLength === "number")
                columnArgs.maxLength = maxLength;
            const type = column.getType();
            if (type === "string")
                tableData.string(column.getName(), columnArgs);
            else if (type === "text")
                tableData.text(column.getName(), columnArgs);
            else if (type === "bigint")
                tableData.bigint(column.getName(), columnArgs);
            else if (type === "integer")
                tableData.integer(column.getName(), columnArgs);
            else if (type === "boolean")
                tableData.boolean(column.getName(), columnArgs);
            else
                continue;
            added = true;
        }
        if (!added)
            return false;
        for (const sql of await db.alterTableSQLs(tableData))
            await db.query(sql);
        db.clearSchemaCache();
        return true;
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
        table.bigint("child_received_at_ms", { null: true });
        table.bigint("child_started_at_ms", { null: true });
        table.string("child_instance_id", { null: true });
        table.integer("child_pid", { null: true });
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
                data: { ...this._clearedChildAcceptanceData(), handed_off_at_ms: handedOffAtMs, handoff_id: handoffId, status: "handed_off", worker_id: workerId || "local" },
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
                    ...this._clearedChildAcceptanceData(),
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
     * Records pooled-child acceptance evidence for an active handoff. Only the
     * fields supplied are written, fenced by the exact active handoff lease.
     * @param {object} args - Acceptance report.
     * @param {string} args.jobId - Job id.
     * @param {string} [args.handoffId] - Handoff lease id.
     * @param {number} [args.receivedAtMs] - Epoch ms the runner child received the job.
     * @param {number} [args.startedAtMs] - Epoch ms the job's perform started in the child.
     * @param {string} [args.childInstanceId] - Stable pooled child identity.
     * @param {number} [args.childPid] - Pooled child OS pid.
     * @returns {Promise<boolean>} - Whether the lease won.
     */
    async markChildAccepted({ jobId, handoffId, receivedAtMs, startedAtMs, childInstanceId, childPid }) {
        await this.ensureReady();
        return await this._withDb(async (connection) => await this._mutate(connection, async (db) => {
            const job = await this._getJob(db, jobId);
            if (!this._acceptsHandoff(job, handoffId))
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
                conditions: { handoff_id: handoffId, id: jobId, status: "handed_off" },
                data,
                tableName: LOCAL_BACKGROUND_JOBS_TABLE
            });
            return affectedRows === 1;
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
                    ...this._clearedChildAcceptanceData(),
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
            // A retry starts a fresh handoff with a possibly different runner, so the
            // previous child's acceptance evidence must not leak into the next attempt.
            Object.assign(data, { scheduled_at_ms: nowMs + retryDelayMs(attempts), ...this._clearedChildAcceptanceData() });
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
            ...(willRetry ? this._clearedChildAcceptanceRow() : {}),
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
            childInstanceId: row.child_instance_id === null || row.child_instance_id === undefined ? null : String(row.child_instance_id),
            childPid: this._numberOrNull(row.child_pid),
            childReceivedAtMs: this._numberOrNull(row.child_received_at_ms),
            childStartedAtMs: this._numberOrNull(row.child_started_at_ms),
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoibG9jYWwtc3RvcmUuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi9zcmMvYmFja2dyb3VuZC1qb2JzL2xvY2FsLXN0b3JlLmpzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiJBQUFBLFlBQVk7QUFFWixPQUFPLElBQUksTUFBTSxXQUFXLENBQUE7QUFFNUIsT0FBTyxTQUFTLE1BQU0saUNBQWlDLENBQUE7QUFDdkQsT0FBTyxVQUFVLE1BQU0sdUNBQXVDLENBQUE7QUFDOUQsT0FBTyxTQUFTLE1BQU0sd0JBQXdCLENBQUE7QUFDOUMsT0FBTywyQkFBMkIsTUFBTSxzQkFBc0IsQ0FBQTtBQUM5RCxPQUFPLEVBQ0wsNEJBQTRCLEVBQzVCLDRCQUE0QixFQUM1QixpQ0FBaUMsRUFDakMsbUNBQW1DLEVBQ25DLGdDQUFnQyxFQUNoQywyQkFBMkIsRUFDM0IsbUNBQW1DLEVBQ25DLDRCQUE0QixFQUM1QixZQUFZLEVBQ2IsTUFBTSxvQkFBb0IsQ0FBQTtBQUUzQixNQUFNLENBQUMsTUFBTSwyQkFBMkIsR0FBRyxpQ0FBaUMsQ0FBQTtBQUM1RSxNQUFNLENBQUMsTUFBTSxzQ0FBc0MsR0FBRyw0Q0FBNEMsQ0FBQTtBQUNsRyxNQUFNLGdCQUFnQixHQUFHLCtCQUErQixDQUFBO0FBQ3hELE1BQU0sZUFBZSxHQUFHLHVCQUF1QixDQUFBO0FBQy9DLE1BQU0saUJBQWlCLEdBQUcsR0FBRyxDQUFBO0FBQzdCLE1BQU0scUJBQXFCLEdBQUcsQ0FBQyxvQkFBb0IsQ0FBQyxDQUFDLFFBQVEsQ0FBQyxDQUFDLENBQUE7QUFDL0QsTUFBTSxDQUFDLE1BQU0saUNBQWlDLEdBQUc7SUFDL0MsMkNBQTJDO0lBQzNDLG9EQUFvRDtJQUNwRCxxREFBcUQ7SUFDckQsbURBQW1EO0NBQ3BELENBQUE7QUFDRCxNQUFNLG9CQUFvQixHQUFHO0lBQzNCLElBQUk7SUFDSixVQUFVO0lBQ1YsV0FBVztJQUNYLGFBQWE7SUFDYixnQkFBZ0I7SUFDaEIsT0FBTztJQUNQLGFB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VVVJRCBmcm9tIFwicHVyZS11dWlkXCJcblxuaW1wb3J0IFRhYmxlRGF0YSBmcm9tIFwiLi4vZGF0YWJhc2UvdGFibGUtZGF0YS9pbmRleC5qc1wiXG5pbXBvcnQgVGFibGVJbmRleCBmcm9tIFwiLi4vZGF0YWJhc2UvdGFibGUtZGF0YS90YWJsZS1pbmRleC5qc1wiXG5pbXBvcnQgc2hhMjU2SGV4IGZyb20gXCIuLi91dGlscy9zaGEyNTYtaGV4LmpzXCJcbmltcG9ydCBub3JtYWxpemVCYWNrZ3JvdW5kSm9iRXJyb3IgZnJvbSBcIi4vbm9ybWFsaXplLWVycm9yLmpzXCJcbmltcG9ydCB7XG4gIERFRkFVTFRfQkFDS0dST1VORF9KT0JfUVVFVUUsXG4gIFFVRVVFX0NPTkNVUlJFTkNZX0tFWV9QUkVGSVgsXG4gIG5vcm1hbGl6ZUJhY2tncm91bmRKb2JDb25jdXJyZW5jeSxcbiAgbm9ybWFsaXplQmFja2dyb3VuZEpvYkV4ZWN1dGlvbk1vZGUsXG4gIG5vcm1hbGl6ZUJhY2tncm91bmRKb2JNYXhSZXRyaWVzLFxuICBub3JtYWxpemVCYWNrZ3JvdW5kSm9iUXVldWUsXG4gIG5vcm1hbGl6ZUJhY2tncm91bmRKb2JTY2hlZHVsZWRBdE1zLFxuICByZXNjaGVkdWxlZEJhY2tncm91bmRKb2JBdE1zLFxuICByZXRyeURlbGF5TXNcbn0gZnJvbSBcIi4vam9iLXNlbWFudGljcy5qc1wiXG5cbmV4cG9ydCBjb25zdCBMT0NBTF9CQUNLR1JPVU5EX0pPQlNfVEFCTEUgPSBcInZlbG9jaW91c19sb2NhbF9iYWNrZ3JvdW5kX2pvYnNcIlxuZXhwb3J0IGNvbnN0IExPQ0FMX0JBQ0tHUk9VTkRfSk9CX0NPTkNVUlJFTkNZX1RBQkxFID0gXCJ2ZWxvY2lvdXNfbG9jYWxfYmFja2dyb3VuZF9qb2JfY29uY3VycmVuY3lcIlxuY29uc3QgTUlHUkFUSU9OU19UQUJMRSA9IFwidmVsb2Npb3VzX2ludGVybmFsX21pZ3JhdGlvbnNcIlxuY29uc3QgTUlHUkFUSU9OX1NDT1BFID0gXCJsb2NhbF9iYWNrZ3JvdW5kX2pvYnNcIlxuY29uc3QgTUlHUkFUSU9OX1ZFUlNJT04gPSBcIjFcIlxuY29uc3QgTE9DQUxfRVhFQ1VUSU9OX01PREVTID0gWy8qKiBAdHlwZSB7Y29uc3R9ICovIChcImlubGluZVwiKV1cbmV4cG9ydCBjb25zdCBMT0NBTF9CQUNLR1JPVU5EX0pPQlNfSU5ERVhfTkFNRVMgPSBbXG4gIFwiaW5kZXhfdmVsb2Npb3VzX2xvY2FsX2JhY2tncm91bmRfam9ic19kdWVcIixcbiAgXCJpbmRleF92ZWxvY2lvdXNfbG9jYWxfYmFja2dyb3VuZF9qb2JzX3F1ZXVlX3N0YXR1c1wiLFxuICBcImluZGV4X3ZlbG9jaW91c19sb2NhbF9iYWNrZ3JvdW5kX2pvYnNfZGVkdXBsaWNhdGlvblwiLFxuICBcImluZGV4X3ZlbG9jaW91c19sb2NhbF9iYWNrZ3JvdW5kX2pvYnNfY29uY3VycmVuY3lcIlxuXVxuY29uc3QgRVhQRUNURURfSk9CX0NPTFVNTlMgPSBbXG4gIFwiaWRcIixcbiAgXCJqb2JfbmFtZVwiLFxuICBcImFyZ3NfanNvblwiLFxuICBcImFyZ3NfZGlnZXN0XCIsXG4gIFwiZXhlY3V0aW9uX21vZGVcIixcbiAgXCJxdWV1ZVwiLFxuICBcIm1heF9yZXRyaWVzXCIsXG4gIFwiYXR0ZW1wdHNcIixcbiAgXCJzdGF0dXNcIixcbiAgXCJzY2hlZHVsZWRfYXRfbXNcIixcbiAgXCJjcmVhdGVkX2F0X21zXCIsXG4gIFwiaGFuZGVkX29mZl9hdF9tc1wiLFxuICBcImhhbmRvZmZfaWRcIixcbiAgXCJ3b3JrZXJfaWRcIixcbiAgXCJjb21wbGV0ZWRfYXRfbXNcIixcbiAgXCJmYWlsZWRfYXRfbXNcIixcbiAgXCJsYXN0X2Vycm9yXCIsXG4gIFwiY29uY3VycmVuY3lfa2V5XCIsXG4gIFwibWF4X2NvbmN1cnJlbmN5XCIsXG4gIFwiY2hpbGRfcmVjZWl2ZWRfYXRfbXNcIixcbiAgXCJjaGlsZF9zdGFydGVkX2F0X21zXCIsXG4gIFwiY2hpbGRfaW5zdGFuY2VfaWRcIixcbiAgXCJjaGlsZF9waWRcIlxuXVxuY29uc3QgRVhQRUNURURfQ09OQ1VSUkVOQ1lfQ09MVU1OUyA9IFtcImNvbmN1cnJlbmN5X2tleVwiLCBcIm1heF9jb25jdXJyZW5jeVwiLCBcImFjdGl2ZV9jb3VudFwiXVxuLyoqIEB0eXBlIHtXZWFrTWFwPGltcG9ydChcIi4uL2NvbmZpZ3VyYXRpb24uanNcIikuZGVmYXVsdCwgTWFwPHN0cmluZywgUHJvbWlzZTx2b2lkPj4+fSAqL1xuY29uc3QgZGVkdXBsaWNhdGVkRW5xdWV1ZUNoYWlucyA9IG5ldyBXZWFrTWFwKClcblxuLyoqXG4gKiBDcmVhdGVzIHRoZSBwcm9kdWN0aW9uIGNsb2NrIHVzZWQgYnkgbG9jYWwgZGlzcGF0Y2guXG4gKiBAcmV0dXJucyB7aW1wb3J0KFwiLi90eXBlcy5qc1wiKS5Mb2NhbEJhY2tncm91bmRKb2JzQ2xvY2t9IC0gUHJvZHVjdGlvbiBjbG9jay5cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGxvY2FsQmFja2dyb3VuZEpvYnNDbG9jaygpIHtcbiAgcmV0dXJuIHtcbiAgICBjbGVhclRpbWVvdXQ6ICh0aW1lcklkKSA9PiBnbG9iYWxUaGlzLmNsZWFyVGltZW91dCh0aW1lcklkKSxcbiAgICBub3c6ICgpID0+IERhdGUubm93KCksXG4gICAgc2V0VGltZW91dDogKGNhbGxiYWNrLCBkZWxheU1zKSA9PiBnbG9iYWxUaGlzLnNldFRpbWVvdXQoY2FsbGJhY2ssIGRlbGF5TXMpXG4gIH1cbn1cblxuLyoqIE5hbWVzcGFjZWQgcG9ydGFibGUgU1FMaXRlIHBlcnNpc3RlbmNlIGZvciBsb2NhbCBiYWNrZ3JvdW5kIGpvYnMuICovXG5leHBvcnQgZGVmYXVsdCBjbGFzcyBMb2NhbEJhY2tncm91bmRKb2JzU3RvcmUge1xuICAvKipcbiAgICogQ3JlYXRlcyBhIHN0b3JlIGZvciBvbmUgY29uZmlndXJhdGlvbiBhbmQgbG9jYWwgZGF0YWJhc2UuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gU3RvcmUgb3B0aW9ucy5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9jb25maWd1cmF0aW9uLmpzXCIpLmRlZmF1bHR9IGFyZ3MuY29uZmlndXJhdGlvbiAtIE93bmluZyBjb25maWd1cmF0aW9uLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vdHlwZXMuanNcIikuTG9jYWxCYWNrZ3JvdW5kSm9ic0Nsb2NrfSBbYXJncy5jbG9ja10gLSBQZXJzaXN0ZW5jZSBjbG9jay5cbiAgICogQHBhcmFtIHtzdHJpbmd9IFthcmdzLmRhdGFiYXNlSWRlbnRpZmllcl0gLSBDb25maWd1cmVkIGxvY2FsIGRhdGFiYXNlIGlkZW50aWZpZXIuXG4gICAqIEBwYXJhbSB7KCkgPT4gdm9pZH0gW2FyZ3Mub25Db21taXR0ZWRFbnF1ZXVlXSAtIENvbW1pdC1hd2FyZSBkaXNwYXRjaGVyIHdha2UuXG4gICAqL1xuICBjb25zdHJ1Y3Rvcih7Y29uZmlndXJhdGlvbiwgY2xvY2sgPSBsb2NhbEJhY2tncm91bmRKb2JzQ2xvY2soKSwgZGF0YWJhc2VJZGVudGlmaWVyLCBvbkNvbW1pdHRlZEVucXVldWV9KSB7XG4gICAgdGhpcy5jbG9jayA9IGNsb2NrXG4gICAgdGhpcy5jb25maWd1cmF0aW9uID0gY29uZmlndXJhdGlvblxuICAgIHRoaXMuZGF0YWJhc2VJZGVudGlmaWVyID0gZGF0YWJhc2VJZGVudGlmaWVyXG4gICAgdGhpcy5vbkNvbW1pdHRlZEVucXVldWUgPSBvbkNvbW1pdHRlZEVucXVldWVcbiAgICB0aGlzLl9pc1JlYWR5ID0gZmFsc2VcbiAgICAvKiogQHR5cGUge1Byb21pc2U8dm9pZD4gfCBudWxsfSAqL1xuICAgIHRoaXMuX3JlYWR5UHJvbWlzZSA9IG51bGxcbiAgICAvKiogQHR5cGUge1dlYWtNYXA8aW1wb3J0KFwiLi4vZGF0YWJhc2UvZHJpdmVycy9iYXNlLmpzXCIpLmRlZmF1bHQsIHtjb21wbGV0aW9uOiBQcm9taXNlPHZvaWQ+LCBwcm9taXNlOiBQcm9taXNlPHZvaWQ+fT59ICovXG4gICAgdGhpcy5fdHJhbnNhY3Rpb25SZWFkeVByb21pc2VzID0gbmV3IFdlYWtNYXAoKVxuICB9XG5cbiAgLyoqXG4gICAqIFJlc29sdmVzIHRoZSBjb25maWd1cmVkIGxvY2FsIGRhdGFiYXNlIGlkZW50aWZpZXIuXG4gICAqIEByZXR1cm5zIHtzdHJpbmd9IC0gRGF0YWJhc2UgaWRlbnRpZmllci5cbiAgICovXG4gIGdldERhdGFiYXNlSWRlbnRpZmllcigpIHtcbiAgICByZXR1cm4gdGhpcy5kYXRhYmFzZUlkZW50aWZpZXIgfHwgdGhpcy5jb25maWd1cmF0aW9uLmdldEJhY2tncm91bmRKb2JzQ29uZmlnKCkuZGF0YWJhc2VJZGVudGlmaWVyXG4gIH1cblxuICAvKipcbiAgICogRW5zdXJlcyB0aGUgdmVyc2lvbmVkIHBoeXNpY2FsIHNjaGVtYSBleGlzdHMuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIHdoZW4gcmVhZHkuXG4gICAqL1xuICBhc3luYyBlbnN1cmVSZWFkeSgpIHtcbiAgICBpZiAodGhpcy5faXNSZWFkeSkgcmV0dXJuXG5cbiAgICBhd2FpdCB0aGlzLl93aXRoRGIoYXN5bmMgKGRiKSA9PiBhd2FpdCB0aGlzLl9lbnN1cmVSZWFkeVdpdGhEYihkYikpXG4gIH1cblxuICAvKipcbiAgICogQ2xlYXJzIHRoZSBwZXItaW5zdGFuY2UgcmVhZGluZXNzIGxhdGNoIGZvciBhIGRlbGliZXJhdGUgYWRhcHRlciByZW9wZW4uXG4gICAqIEByZXR1cm5zIHt2b2lkfSAtIE5vIHJldHVybiB2YWx1ZS5cbiAgICovXG4gIHJlc2V0UmVhZGluZXNzKCkge1xuICAgIHRoaXMuX2lzUmVhZHkgPSBmYWxzZVxuICAgIHRoaXMuX3JlYWR5UHJvbWlzZSA9IG51bGxcbiAgICB0aGlzLl90cmFuc2FjdGlvblJlYWR5UHJvbWlzZXMgPSBuZXcgV2Vha01hcCgpXG4gIH1cblxuICAvKipcbiAgICogQ29vcmRpbmF0ZXMgcGh5c2ljYWwgYW5kIHRyYW5zYWN0aW9uLWxvY2FsIHNjaGVtYSByZWFkaW5lc3MuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vZGF0YWJhc2UvZHJpdmVycy9iYXNlLmpzXCIpLmRlZmF1bHR9IGRiIC0gTG9jYWwgU1FMaXRlIGNvbm5lY3Rpb24uXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIHdoZW4gdGhpcyBjYWxsZXIgY2FuIHVzZSB0aGUgc2NoZW1hLlxuICAgKi9cbiAgYXN5bmMgX2Vuc3VyZVJlYWR5V2l0aERiKGRiKSB7XG4gICAgaWYgKHRoaXMuX2lzUmVhZHkpIHJldHVyblxuXG4gICAgY29uc3QgdHJhbnNhY3Rpb25Db21wbGV0aW9uID0gZGIuaW5zaWRlVHJhbnNhY3Rpb24oKSA/IGRiLnRyYW5zYWN0aW9uQ29tcGxldGlvbigpIDogbnVsbFxuICAgIGNvbnN0IHRyYW5zYWN0aW9uUmVhZHkgPSB0aGlzLl90cmFuc2FjdGlvblJlYWR5UHJvbWlzZXMuZ2V0KGRiKVxuXG4gICAgaWYgKHRyYW5zYWN0aW9uQ29tcGxldGlvbiAmJiB0cmFuc2FjdGlvblJlYWR5Py5jb21wbGV0aW9uID09PSB0cmFuc2FjdGlvbkNvbXBsZXRpb24pIHtcbiAgICAgIGF3YWl0IHRyYW5zYWN0aW9uUmVhZHkucHJvbWlzZVxuICAgICAgcmV0dXJuXG4gICAgfVxuXG4gICAgaWYgKHRoaXMuX3JlYWR5UHJvbWlzZSkge1xuICAgICAgY29uc3QgcmVhZHlQcm9taXNlID0gdGhpcy5fcmVhZHlQcm9taXNlXG5cbiAgICAgIGF3YWl0IHJlYWR5UHJvbWlzZVxuICAgICAgaWYgKHRoaXMuX3JlYWR5UHJvbWlzZSA9PT0gcmVhZHlQcm9taXNlKSB0aGlzLl9yZWFkeVByb21pc2UgPSBudWxsXG4gICAgICBpZiAodGhpcy5faXNSZWFkeSkgcmV0dXJuXG5cbiAgICAgIGF3YWl0IHRoaXMuZW5zdXJlUmVhZHkoKVxuICAgICAgcmV0dXJuXG4gICAgfVxuXG4gICAgaWYgKHRyYW5zYWN0aW9uQ29tcGxldGlvbikge1xuICAgICAgY29uc3Qgc2NoZW1hUmVhZHlQcm9taXNlID0gdGhpcy5fYXBwbHlTY2hlbWEoZGIpXG4gICAgICBjb25zdCB0cmFuc2FjdGlvblJlYWR5UHJvbWlzZSA9IHNjaGVtYVJlYWR5UHJvbWlzZS50aGVuKCgpID0+IHVuZGVmaW5lZClcbiAgICAgIGNvbnN0IHRyYW5zYWN0aW9uUmVhZHkgPSB7Y29tcGxldGlvbjogdHJhbnNhY3Rpb25Db21wbGV0aW9uLCBwcm9taXNlOiB0cmFuc2FjdGlvblJlYWR5UHJvbWlzZX1cbiAgICAgIGNvbnN0IGR1cmFibGVSZWFkeVByb21pc2UgPSBzY2hlbWFSZWFkeVByb21pc2UudGhlbihhc3luYyAoY2hhbmdlZCkgPT4ge1xuICAgICAgICBpZiAoIWNoYW5nZWQpIHtcbiAgICAgICAgICB0aGlzLl9pc1JlYWR5ID0gdHJ1ZVxuICAgICAgICAgIHJldHVyblxuICAgICAgICB9XG5cbiAgICAgICAgYXdhaXQgdHJhbnNhY3Rpb25Db21wbGV0aW9uXG4gICAgICB9LCAoKSA9PiB7XG4gICAgICAgIC8vIFRoZSB0cmFuc2FjdGlvbi1sb2NhbCBjYWxsZXIgYmVsb3cgb3ducyBhbmQgcmV0aHJvd3MgdGhpcyBzYW1lIHNjaGVtYSBlcnJvci5cbiAgICAgICAgLy8gVGhpcyBicmFuY2ggb25seSBzZXR0bGVzIHRoZSBzaGFyZWQgZHVyYWJpbGl0eSBiYXJyaWVyIHNvIGl0IGNhbm5vdCBiZWNvbWVcbiAgICAgICAgLy8gYW4gaW5kZXBlbmRlbnQgdW5oYW5kbGVkIHJlamVjdGlvbiB3aGlsZSBmYWlsZWQgb3duZXJzaGlwIGlzIGNsZWFyZWQuXG4gICAgICB9KVxuXG4gICAgICB0aGlzLl90cmFuc2FjdGlvblJlYWR5UHJvbWlzZXMuc2V0KGRiLCB0cmFuc2FjdGlvblJlYWR5KVxuICAgICAgdGhpcy5fcmVhZHlQcm9taXNlID0gZHVyYWJsZVJlYWR5UHJvbWlzZVxuXG4gICAgICB0cnkge1xuICAgICAgICBhd2FpdCB0cmFuc2FjdGlvblJlYWR5UHJvbWlzZVxuICAgICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgICAgaWYgKHRoaXMuX3RyYW5zYWN0aW9uUmVhZHlQcm9taXNlcy5nZXQoZGIpID09PSB0cmFuc2FjdGlvblJlYWR5KSB0aGlzLl90cmFuc2FjdGlvblJlYWR5UHJvbWlzZXMuZGVsZXRlKGRiKVxuICAgICAgICBpZiAodGhpcy5fcmVhZHlQcm9taXNlID09PSBkdXJhYmxlUmVhZHlQcm9taXNlKSB0aGlzLl9yZWFkeVByb21pc2UgPSBudWxsXG4gICAgICAgIHRocm93IGVycm9yXG4gICAgICB9XG4gICAgICByZXR1cm5cbiAgICB9XG5cbiAgICB0aGlzLl9yZWFkeVByb21pc2UgPSB0aGlzLl90cmFuc2FjdGlvblJlc3VsdChkYiwgYXN5bmMgKCkgPT4gYXdhaXQgdGhpcy5fYXBwbHlTY2hlbWEoZGIpKS50aGVuKCgpID0+IHtcbiAgICAgIHRoaXMuX2lzUmVhZHkgPSB0cnVlXG4gICAgfSlcblxuICAgIHRyeSB7XG4gICAgICBhd2FpdCB0aGlzLl9yZWFkeVByb21pc2VcbiAgICB9IGZpbmFsbHkge1xuICAgICAgaWYgKCF0aGlzLl9pc1JlYWR5KSB0aGlzLl9yZWFkeVByb21pc2UgPSBudWxsXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIENyZWF0ZXMgb3IgcmVwYWlycyB2ZXJzaW9uLW9uZSB0YWJsZXMgYW5kIGluZGV4ZXMuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vZGF0YWJhc2UvZHJpdmVycy9iYXNlLmpzXCIpLmRlZmF1bHR9IGRiIC0gTG9jYWwgU1FMaXRlIGNvbm5lY3Rpb24uXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPGJvb2xlYW4+fSAtIFdoZXRoZXIgc2NoZW1hIHN0YXRlIGNoYW5nZWQuXG4gICAqL1xuICBhc3luYyBfYXBwbHlTY2hlbWEoZGIpIHtcbiAgICBsZXQgY2hhbmdlZCA9IGZhbHNlXG5cbiAgICBpZiAoIShhd2FpdCBkYi50YWJsZUV4aXN0cyhNSUdSQVRJT05TX1RBQkxFKSkpIHtcbiAgICAgIGF3YWl0IGRiLmNyZWF0ZVRhYmxlKHRoaXMuX21pZ3JhdGlvbnNUYWJsZURhdGEoKSlcbiAgICAgIGNoYW5nZWQgPSB0cnVlXG4gICAgfVxuXG4gICAgaWYgKCEoYXdhaXQgZGIudGFibGVFeGlzdHMoTE9DQUxfQkFDS0dST1VORF9KT0JTX1RBQkxFKSkpIHtcbiAgICAgIGF3YWl0IGRiLmNyZWF0ZVRhYmxlKHRoaXMuX2pvYnNUYWJsZURhdGEoKSlcbiAgICAgIGNoYW5nZWQgPSB0cnVlXG4gICAgfSBlbHNlIHtcbiAgICAgIGlmIChhd2FpdCB0aGlzLl9lbnN1cmVKb2JDb2x1bW5zKGRiKSkgY2hhbmdlZCA9IHRydWVcbiAgICAgIGF3YWl0IHRoaXMuX2Fzc2VydENvbHVtbnMoZGIsIExPQ0FMX0JBQ0tHUk9VTkRfSk9CU19UQUJMRSwgRVhQRUNURURfSk9CX0NPTFVNTlMpXG4gICAgfVxuXG4gICAgaWYgKCEoYXdhaXQgZGIudGFibGVFeGlzdHMoTE9DQUxfQkFDS0dST1VORF9KT0JfQ09OQ1VSUkVOQ1lfVEFCTEUpKSkge1xuICAgICAgYXdhaXQgZGIuY3JlYXRlVGFibGUodGhpcy5fY29uY3VycmVuY3lUYWJsZURhdGEoKSlcbiAgICAgIGNoYW5nZWQgPSB0cnVlXG4gICAgfSBlbHNlIHtcbiAgICAgIGF3YWl0IHRoaXMuX2Fzc2VydENvbHVtbnMoZGIsIExPQ0FMX0JBQ0tHUk9VTkRfSk9CX0NPTkNVUlJFTkNZX1RBQkxFLCBFWFBFQ1RFRF9DT05DVVJSRU5DWV9DT0xVTU5TKVxuICAgIH1cblxuICAgIGlmIChhd2FpdCB0aGlzLl9lbnN1cmVJbmRleGVzKGRiKSkgY2hhbmdlZCA9IHRydWVcblxuICAgIGlmICghKGF3YWl0IHRoaXMuX2hhc01pZ3JhdGlvbihkYikpKSB7XG4gICAgICBhd2FpdCBkYi51cHNlcnQoe1xuICAgICAgICB0YWJsZU5hbWU6IE1JR1JBVElPTlNfVEFCTEUsXG4gICAgICAgIGRhdGE6IHtcbiAgICAgICAgICBhcHBsaWVkX2F0X21zOiB0aGlzLmNsb2NrLm5vdygpLFxuICAgICAgICAgIGtleTogdGhpcy5fbWlncmF0aW9uS2V5KCksXG4gICAgICAgICAgc2NvcGU6IE1JR1JBVElPTl9TQ09QRSxcbiAgICAgICAgICB2ZXJzaW9uOiBNSUdSQVRJT05fVkVSU0lPTlxuICAgICAgICB9LFxuICAgICAgICBjb25mbGljdENvbHVtbnM6IFtcImtleVwiXSxcbiAgICAgICAgdXBkYXRlQ29sdW1uczogW1wic2NvcGVcIiwgXCJ2ZXJzaW9uXCIsIFwiYXBwbGllZF9hdF9tc1wiXVxuICAgICAgfSlcbiAgICAgIGNoYW5nZWQgPSB0cnVlXG4gICAgfVxuXG4gICAgcmV0dXJuIGNoYW5nZWRcbiAgfVxuXG4gIC8qKlxuICAgKiBJZGVtcG90ZW50bHkgYWRkcyBjb2x1bW5zIGZyb20gdGhlIGN1cnJlbnQgam9icyB0YWJsZSBkZWZpbml0aW9uIHRoYXQgYW5cbiAgICogZXhpc3RpbmcgbG9jYWwgdGFibGUgaXMgbWlzc2luZywgc28gYW4gdXBncmFkZWQgZnJhbWV3b3JrIGZpbmRzIGFcbiAgICogY29tcGF0aWJsZSBzY2hlbWEgaW5zdGVhZCBvZiBmYWlsaW5nIHRoZSBjb2x1bW4gYXNzZXJ0aW9uLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL2RhdGFiYXNlL2RyaXZlcnMvYmFzZS5qc1wiKS5kZWZhdWx0fSBkYiAtIExvY2FsIFNRTGl0ZSBjb25uZWN0aW9uLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxib29sZWFuPn0gLSBXaGV0aGVyIGEgY29sdW1uIHdhcyBhZGRlZC5cbiAgICovXG4gIGFzeW5jIF9lbnN1cmVKb2JDb2x1bW5zKGRiKSB7XG4gICAgZGIuY2xlYXJTY2hlbWFDYWNoZSgpXG4gICAgY29uc3QgdGFibGUgPSBhd2FpdCBkYi5nZXRUYWJsZUJ5TmFtZU9yRmFpbChMT0NBTF9CQUNLR1JPVU5EX0pPQlNfVEFCTEUpXG4gICAgY29uc3QgdGFibGVEYXRhID0gbmV3IFRhYmxlRGF0YShMT0NBTF9CQUNLR1JPVU5EX0pPQlNfVEFCTEUpXG4gICAgbGV0IGFkZGVkID0gZmFsc2VcblxuICAgIGZvciAoY29uc3QgY29sdW1uIG9mIHRoaXMuX2pvYnNUYWJsZURhdGEoKS5nZXRDb2x1bW5zKCkpIHtcbiAgICAgIGlmIChhd2FpdCB0YWJsZS5nZXRDb2x1bW5CeU5hbWUoY29sdW1uLmdldE5hbWUoKSkpIGNvbnRpbnVlXG4gICAgICBpZiAoY29sdW1uLmdldFByaW1hcnlLZXkoKSkgY29udGludWVcblxuICAgICAgY29uc3QgY29sdW1uQXJncyA9IC8qKiBAdHlwZSB7e251bGw6IGJvb2xlYW4sIG1heExlbmd0aD86IG51bWJlcn19ICovICh7bnVsbDogY29sdW1uLmdldE51bGwoKSAhPT0gZmFsc2V9KVxuICAgICAgY29uc3QgbWF4TGVuZ3RoID0gY29sdW1uLmdldE1heExlbmd0aCgpXG5cbiAgICAgIGlmICh0eXBlb2YgbWF4TGVuZ3RoID09PSBcIm51bWJlclwiKSBjb2x1bW5BcmdzLm1heExlbmd0aCA9IG1heExlbmd0aFxuXG4gICAgICBjb25zdCB0eXBlID0gY29sdW1uLmdldFR5cGUoKVxuICAgICAgaWYgKHR5cGUgPT09IFwic3RyaW5nXCIpIHRhYmxlRGF0YS5zdHJpbmcoY29sdW1uLmdldE5hbWUoKSwgY29sdW1uQXJncylcbiAgICAgIGVsc2UgaWYgKHR5cGUgPT09IFwidGV4dFwiKSB0YWJsZURhdGEudGV4dChjb2x1bW4uZ2V0TmFtZSgpLCBjb2x1bW5BcmdzKVxuICAgICAgZWxzZSBpZiAodHlwZSA9PT0gXCJiaWdpbnRcIikgdGFibGVEYXRhLmJpZ2ludChjb2x1bW4uZ2V0TmFtZSgpLCBjb2x1bW5BcmdzKVxuICAgICAgZWxzZSBpZiAodHlwZSA9PT0gXCJpbnRlZ2VyXCIpIHRhYmxlRGF0YS5pbnRlZ2VyKGNvbHVtbi5nZXROYW1lKCksIGNvbHVtbkFyZ3MpXG4gICAgICBlbHNlIGlmICh0eXBlID09PSBcImJvb2xlYW5cIikgdGFibGVEYXRhLmJvb2xlYW4oY29sdW1uLmdldE5hbWUoKSwgY29sdW1uQXJncylcbiAgICAgIGVsc2UgY29udGludWVcbiAgICAgIGFkZGVkID0gdHJ1ZVxuICAgIH1cblxuICAgIGlmICghYWRkZWQpIHJldHVybiBmYWxzZVxuXG4gICAgZm9yIChjb25zdCBzcWwgb2YgYXdhaXQgZGIuYWx0ZXJUYWJsZVNRTHModGFibGVEYXRhKSkgYXdhaXQgZGIucXVlcnkoc3FsKVxuICAgIGRiLmNsZWFyU2NoZW1hQ2FjaGUoKVxuICAgIHJldHVybiB0cnVlXG4gIH1cblxuICAvKipcbiAgICogQnVpbGRzIHRoZSBtaWdyYXRpb24gbGVkZ2VyIHRhYmxlIGRlZmluaXRpb24uXG4gICAqIEByZXR1cm5zIHtUYWJsZURhdGF9IC0gTWlncmF0aW9uIGxlZGdlciB0YWJsZS5cbiAgICovXG4gIF9taWdyYXRpb25zVGFibGVEYXRhKCkge1xuICAgIGNvbnN0IHRhYmxlID0gbmV3IFRhYmxlRGF0YShNSUdSQVRJT05TX1RBQkxFLCB7aWZOb3RFeGlzdHM6IHRydWV9KVxuXG4gICAgdGFibGUuc3RyaW5nKFwia2V5XCIsIHtudWxsOiBmYWxzZSwgcHJpbWFyeUtleTogdHJ1ZX0pXG4gICAgdGFibGUuc3RyaW5nKFwic2NvcGVcIiwge251bGw6IGZhbHNlfSlcbiAgICB0YWJsZS5zdHJpbmcoXCJ2ZXJzaW9uXCIsIHtudWxsOiBmYWxzZX0pXG4gICAgdGFibGUuYmlnaW50KFwiYXBwbGllZF9hdF9tc1wiLCB7bnVsbDogZmFsc2V9KVxuICAgIHJldHVybiB0YWJsZVxuICB9XG5cbiAgLyoqXG4gICAqIEJ1aWxkcyB0aGUgbG9jYWwgam9icyB0YWJsZSBkZWZpbml0aW9uLlxuICAgKiBAcmV0dXJucyB7VGFibGVEYXRhfSAtIExvY2FsIGpvYnMgdGFibGUgZGVmaW5pdGlvbi5cbiAgICovXG4gIF9qb2JzVGFibGVEYXRhKCkge1xuICAgIGNvbnN0IHRhYmxlID0gbmV3IFRhYmxlRGF0YShMT0NBTF9CQUNLR1JPVU5EX0pPQlNfVEFCTEUsIHtpZk5vdEV4aXN0czogdHJ1ZX0pXG5cbiAgICB0YWJsZS5zdHJpbmcoXCJpZFwiLCB7bnVsbDogZmFsc2UsIHByaW1hcnlLZXk6IHRydWV9KVxuICAgIHRhYmxlLnN0cmluZyhcImpvYl9uYW1lXCIsIHtudWxsOiBmYWxzZX0pXG4gICAgdGFibGUudGV4dChcImFyZ3NfanNvblwiLCB7bnVsbDogZmFsc2V9KVxuICAgIHRhYmxlLnN0cmluZyhcImFyZ3NfZGlnZXN0XCIsIHttYXhMZW5ndGg6IDY0LCBudWxsOiBmYWxzZX0pXG4gICAgdGFibGUuc3RyaW5nKFwiZXhlY3V0aW9uX21vZGVcIiwge251bGw6IGZhbHNlfSlcbiAgICB0YWJsZS5zdHJpbmcoXCJxdWV1ZVwiLCB7bnVsbDogZmFsc2V9KVxuICAgIHRhYmxlLmludGVnZXIoXCJtYXhfcmV0cmllc1wiLCB7bnVsbDogZmFsc2V9KVxuICAgIHRhYmxlLmludGVnZXIoXCJhdHRlbXB0c1wiLCB7bnVsbDogZmFsc2V9KVxuICAgIHRhYmxlLnN0cmluZyhcInN0YXR1c1wiLCB7bnVsbDogZmFsc2V9KVxuICAgIHRhYmxlLmJpZ2ludChcInNjaGVkdWxlZF9hdF9tc1wiLCB7bnVsbDogZmFsc2V9KVxuICAgIHRhYmxlLmJpZ2ludChcImNyZWF0ZWRfYXRfbXNcIiwge251bGw6IGZhbHNlfSlcbiAgICB0YWJsZS5iaWdpbnQoXCJoYW5kZWRfb2ZmX2F0X21zXCIsIHtudWxsOiB0cnVlfSlcbiAgICB0YWJsZS5zdHJpbmcoXCJoYW5kb2ZmX2lkXCIsIHtudWxsOiB0cnVlfSlcbiAgICB0YWJsZS5zdHJpbmcoXCJ3b3JrZXJfaWRcIiwge251bGw6IHRydWV9KVxuICAgIHRhYmxlLmJpZ2ludChcImNvbXBsZXRlZF9hdF9tc1wiLCB7bnVsbDogdHJ1ZX0pXG4gICAgdGFibGUuYmlnaW50KFwiZmFpbGVkX2F0X21zXCIsIHtudWxsOiB0cnVlfSlcbiAgICB0YWJsZS50ZXh0KFwibGFzdF9lcnJvclwiLCB7bnVsbDogdHJ1ZX0pXG4gICAgdGFibGUuc3RyaW5nKFwiY29uY3VycmVuY3lfa2V5XCIsIHtudWxsOiB0cnVlfSlcbiAgICB0YWJsZS5pbnRlZ2VyKFwibWF4X2NvbmN1cnJlbmN5XCIsIHtudWxsOiB0cnVlfSlcbiAgICB0YWJsZS5iaWdpbnQoXCJjaGlsZF9yZWNlaXZlZF9hdF9tc1wiLCB7bnVsbDogdHJ1ZX0pXG4gICAgdGFibGUuYmlnaW50KFwiY2hpbGRfc3RhcnRlZF9hdF9tc1wiLCB7bnVsbDogdHJ1ZX0pXG4gICAgdGFibGUuc3RyaW5nKFwiY2hpbGRfaW5zdGFuY2VfaWRcIiwge251bGw6IHRydWV9KVxuICAgIHRhYmxlLmludGVnZXIoXCJjaGlsZF9waWRcIiwge251bGw6IHRydWV9KVxuICAgIHRhYmxlLmFkZEluZGV4KG5ldyBUYWJsZUluZGV4KFtcInN0YXR1c1wiLCBcInNjaGVkdWxlZF9hdF9tc1wiLCBcImNyZWF0ZWRfYXRfbXNcIiwgXCJpZFwiXSwge25hbWU6IExPQ0FMX0JBQ0tHUk9VTkRfSk9CU19JTkRFWF9OQU1FU1swXX0pKVxuICAgIHRhYmxlLmFkZEluZGV4KG5ldyBUYWJsZUluZGV4KFtcInF1ZXVlXCIsIFwic3RhdHVzXCIsIFwiY3JlYXRlZF9hdF9tc1wiXSwge25hbWU6IExPQ0FMX0JBQ0tHUk9VTkRfSk9CU19JTkRFWF9OQU1FU1sxXX0pKVxuICAgIHRhYmxlLmFkZEluZGV4KG5ldyBUYWJsZUluZGV4KFtcImFyZ3NfZGlnZXN0XCJdLCB7bmFtZTogTE9DQUxfQkFDS0dST1VORF9KT0JTX0lOREVYX05BTUVTWzJdfSkpXG4gICAgdGFibGUuYWRkSW5kZXgobmV3IFRhYmxlSW5kZXgoW1wic3RhdHVzXCIsIFwiY29uY3VycmVuY3lfa2V5XCIsIFwic2NoZWR1bGVkX2F0X21zXCJdLCB7bmFtZTogTE9DQUxfQkFDS0dST1VORF9KT0JTX0lOREVYX05BTUVTWzNdfSkpXG4gICAgcmV0dXJuIHRhYmxlXG4gIH1cblxuICAvKipcbiAgICogQnVpbGRzIHRoZSBsb2NhbCBjb25jdXJyZW5jeSBjb3VudGVyIHRhYmxlIGRlZmluaXRpb24uXG4gICAqIEByZXR1cm5zIHtUYWJsZURhdGF9IC0gQ29uY3VycmVuY3kgY291bnRlciB0YWJsZSBkZWZpbml0aW9uLlxuICAgKi9cbiAgX2NvbmN1cnJlbmN5VGFibGVEYXRhKCkge1xuICAgIGNvbnN0IHRhYmxlID0gbmV3IFRhYmxlRGF0YShMT0NBTF9CQUNLR1JPVU5EX0pPQl9DT05DVVJSRU5DWV9UQUJMRSwge2lmTm90RXhpc3RzOiB0cnVlfSlcblxuICAgIHRhYmxlLnN0cmluZyhcImNvbmN1cnJlbmN5X2tleVwiLCB7bnVsbDogZmFsc2UsIHByaW1hcnlLZXk6IHRydWV9KVxuICAgIHRhYmxlLmludGVnZXIoXCJtYXhfY29uY3VycmVuY3lcIiwge251bGw6IGZhbHNlfSlcbiAgICB0YWJsZS5pbnRlZ2VyKFwiYWN0aXZlX2NvdW50XCIsIHtudWxsOiBmYWxzZX0pXG4gICAgcmV0dXJuIHRhYmxlXG4gIH1cblxuICAvKipcbiAgICogUmVqZWN0cyBhbiBpbmNvbXBhdGlibGUgY3VycmVudC12ZXJzaW9uIHRhYmxlIHJhdGhlciB0aGFuIHJlYnVpbGRpbmcgZGF0YS5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9kYXRhYmFzZS9kcml2ZXJzL2Jhc2UuanNcIikuZGVmYXVsdH0gZGIgLSBMb2NhbCBTUUxpdGUgY29ubmVjdGlvbi5cbiAgICogQHBhcmFtIHtzdHJpbmd9IHRhYmxlTmFtZSAtIFRhYmxlIG5hbWUuXG4gICAqIEBwYXJhbSB7c3RyaW5nW119IGV4cGVjdGVkQ29sdW1ucyAtIFJlcXVpcmVkIGNvbHVtbnMuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIHdoZW4gY29tcGF0aWJsZS5cbiAgICovXG4gIGFzeW5jIF9hc3NlcnRDb2x1bW5zKGRiLCB0YWJsZU5hbWUsIGV4cGVjdGVkQ29sdW1ucykge1xuICAgIGNvbnN0IHRhYmxlID0gYXdhaXQgZGIuZ2V0VGFibGVCeU5hbWVPckZhaWwodGFibGVOYW1lKVxuICAgIGNvbnN0IGNvbHVtbnMgPSBhd2FpdCB0YWJsZS5nZXRDb2x1bW5zKClcbiAgICBjb25zdCBuYW1lcyA9IG5ldyBTZXQoY29sdW1ucy5tYXAoKGNvbHVtbikgPT4gY29sdW1uLmdldE5hbWUoKSkpXG4gICAgY29uc3QgbWlzc2luZyA9IGV4cGVjdGVkQ29sdW1ucy5maWx0ZXIoKGNvbHVtbk5hbWUpID0+ICFuYW1lcy5oYXMoY29sdW1uTmFtZSkpXG5cbiAgICBpZiAobWlzc2luZy5sZW5ndGggPT09IDApIHJldHVyblxuXG4gICAgY29uc3QgZXJyb3IgPSBuZXcgRXJyb3IoYEluY29tcGF0aWJsZSBsb2NhbCBiYWNrZ3JvdW5kLWpvYnMgc2NoZW1hIGZvciAke3RhYmxlTmFtZX07IG1pc3NpbmcgY29sdW1uczogJHttaXNzaW5nLmpvaW4oXCIsIFwiKX1gKVxuXG4gICAgdGhpcy5fcmVwb3J0RnJhbWV3b3JrRXJyb3Ioe2Vycm9yLCBzdGFnZTogXCJsb2NhbC1iYWNrZ3JvdW5kLWpvYnMtc2NoZW1hXCJ9KVxuICAgIHRocm93IGVycm9yXG4gIH1cblxuICAvKipcbiAgICogUmVjcmVhdGVzIG1pc3NpbmcgaW5kZXhlcyBkZWNsYXJlZCBieSB0aGUgY3VycmVudCBzY2hlbWEuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vZGF0YWJhc2UvZHJpdmVycy9iYXNlLmpzXCIpLmRlZmF1bHR9IGRiIC0gTG9jYWwgU1FMaXRlIGNvbm5lY3Rpb24uXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPGJvb2xlYW4+fSAtIFdoZXRoZXIgYW4gaW5kZXggd2FzIGNyZWF0ZWQuXG4gICAqL1xuICBhc3luYyBfZW5zdXJlSW5kZXhlcyhkYikge1xuICAgIGRiLmNsZWFyU2NoZW1hQ2FjaGUoKVxuICAgIGNvbnN0IGpvYnNUYWJsZSA9IGF3YWl0IGRiLmdldFRhYmxlQnlOYW1lT3JGYWlsKExPQ0FMX0JBQ0tHUk9VTkRfSk9CU19UQUJMRSlcbiAgICBjb25zdCBleGlzdGluZ05hbWVzID0gbmV3IFNldCgoYXdhaXQgam9ic1RhYmxlLmdldEluZGV4ZXMoKSkubWFwKChpbmRleCkgPT4gaW5kZXguZ2V0TmFtZSgpKSlcbiAgICBsZXQgY2hhbmdlZCA9IGZhbHNlXG5cbiAgICBmb3IgKGNvbnN0IGluZGV4IG9mIHRoaXMuX2pvYnNUYWJsZURhdGEoKS5nZXRJbmRleGVzKCkpIHtcbiAgICAgIGNvbnN0IGluZGV4TmFtZSA9IGluZGV4LmdldE5hbWUoKVxuXG4gICAgICBpZiAoIWluZGV4TmFtZSB8fCBleGlzdGluZ05hbWVzLmhhcyhpbmRleE5hbWUpKSBjb250aW51ZVxuXG4gICAgICBjb25zdCBzcWxzID0gYXdhaXQgZGIuY3JlYXRlSW5kZXhTUUxzKHtcbiAgICAgICAgY29sdW1uczogaW5kZXguZ2V0Q29sdW1ucygpLFxuICAgICAgICBpZk5vdEV4aXN0czogdHJ1ZSxcbiAgICAgICAgbmFtZTogaW5kZXhOYW1lLFxuICAgICAgICB0YWJsZU5hbWU6IExPQ0FMX0JBQ0tHUk9VTkRfSk9CU19UQUJMRSxcbiAgICAgICAgdW5pcXVlOiBpbmRleC5nZXRVbmlxdWUoKVxuICAgICAgfSlcblxuICAgICAgZm9yIChjb25zdCBzcWwgb2Ygc3FscykgYXdhaXQgZGIucXVlcnkoc3FsKVxuICAgICAgY2hhbmdlZCA9IHRydWVcbiAgICB9XG5cbiAgICBpZiAoY2hhbmdlZCkgZGIuY2xlYXJTY2hlbWFDYWNoZSgpXG4gICAgcmV0dXJuIGNoYW5nZWRcbiAgfVxuXG4gIC8qKlxuICAgKiBDaGVja3Mgd2hldGhlciB0aGUgY3VycmVudCBsb2NhbCBzY2hlbWEgdmVyc2lvbiBpcyByZWNvcmRlZC5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9kYXRhYmFzZS9kcml2ZXJzL2Jhc2UuanNcIikuZGVmYXVsdH0gZGIgLSBDb25uZWN0aW9uLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxib29sZWFuPn0gLSBXaGV0aGVyIHZlcnNpb24gb25lIGlzIHJlY29yZGVkLlxuICAgKi9cbiAgYXN5bmMgX2hhc01pZ3JhdGlvbihkYikge1xuICAgIGNvbnN0IHJvd3MgPSBhd2FpdCBkYlxuICAgICAgLm5ld1F1ZXJ5KClcbiAgICAgIC5mcm9tKE1JR1JBVElPTlNfVEFCTEUpXG4gICAgICAud2hlcmUoe2tleTogdGhpcy5fbWlncmF0aW9uS2V5KCl9KVxuICAgICAgLmxpbWl0KDEpXG4gICAgICAucmVzdWx0cygpXG5cbiAgICByZXR1cm4gcm93cy5sZW5ndGggPiAwXG4gIH1cblxuICAvKipcbiAgICogQnVpbGRzIHRoZSBzY29wZWQgbWlncmF0aW9uIGtleS5cbiAgICogQHJldHVybnMge3N0cmluZ30gLSBTY29wZWQgbWlncmF0aW9uIGtleS5cbiAgICovXG4gIF9taWdyYXRpb25LZXkoKSB7IHJldHVybiBgJHtNSUdSQVRJT05fU0NPUEV9OiR7TUlHUkFUSU9OX1ZFUlNJT059YCB9XG5cbiAgLyoqXG4gICAqIEVucXVldWVzIGEgbG9jYWwgam9iIGluIHRoZSBjYWxsZXIncyBhY3RpdmUgdHJhbnNhY3Rpb24gd2hlbiBwcmVzZW50LlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIEVucXVldWUgcmVxdWVzdC5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGFyZ3Muam9iTmFtZSAtIFJlZ2lzdGVyZWQgam9iIG5hbWUuXG4gICAqIEBwYXJhbSB7QXJyYXk8UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSBhcmdzLmFyZ3MgLSBTZXJpYWxpemVkIGpvYiBhcmd1bWVudHMuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi90eXBlcy5qc1wiKS5CYWNrZ3JvdW5kSm9iT3B0aW9uc30gW2FyZ3Mub3B0aW9uc10gLSBKb2Igb3B0aW9ucy5cbiAgICogQHJldHVybnMge1Byb21pc2U8c3RyaW5nPn0gLSBEdXJhYmxlIGpvYiBpZC5cbiAgICovXG4gIGFzeW5jIGVucXVldWUoe2pvYk5hbWUsIGFyZ3MsIG9wdGlvbnMgPSB7fX0pIHtcbiAgICBhd2FpdCB0aGlzLmVuc3VyZVJlYWR5KClcblxuICAgIGNvbnN0IHByZXBhcmVkSm9iID0gdGhpcy5fcHJlcGFyZUpvYih7YXJncywgam9iTmFtZSwgb3B0aW9uc30pXG4gICAgY29uc3QgbXV0YXRlID0gYXN5bmMgKGhvbGRVbnRpbCA9ICgvKiogQHR5cGUge1Byb21pc2U8dm9pZD59ICovIF9jb21wbGV0aW9uKSA9PiB7fSkgPT4gYXdhaXQgdGhpcy5fd2l0aERiKGFzeW5jIChjb25uZWN0aW9uKSA9PiB7XG4gICAgICBpZiAoY29ubmVjdGlvbi5pbnNpZGVUcmFuc2FjdGlvbigpKSBob2xkVW50aWwoY29ubmVjdGlvbi50cmFuc2FjdGlvbkNvbXBsZXRpb24oKSlcblxuICAgICAgcmV0dXJuIGF3YWl0IHRoaXMuX211dGF0ZShjb25uZWN0aW9uLCBhc3luYyAoZGIpID0+IHtcbiAgICAgICAgbGV0IGpvYklkID0gcHJlcGFyZWRKb2Iuam9iSWRcblxuICAgICAgICBpZiAocHJlcGFyZWRKb2IuY29uY3VycmVuY3kpIGF3YWl0IHRoaXMuX2Vuc3VyZUNvbmN1cnJlbmN5KGRiLCBwcmVwYXJlZEpvYi5jb25jdXJyZW5jeSlcblxuICAgICAgICBpZiAob3B0aW9ucy5kZWR1cGxpY2F0ZVdoaWxlUXVldWVkKSB7XG4gICAgICAgICAgY29uc3QgZXhpc3RpbmcgPSBhd2FpdCBkYlxuICAgICAgICAgICAgLm5ld1F1ZXJ5KClcbiAgICAgICAgICAgIC5mcm9tKExPQ0FMX0JBQ0tHUk9VTkRfSk9CU19UQUJMRSlcbiAgICAgICAgICAgIC5zZWxlY3QoXCJpZFwiKVxuICAgICAgICAgICAgLndoZXJlKHtcbiAgICAgICAgICAgICAgYXJnc19kaWdlc3Q6IHByZXBhcmVkSm9iLmFyZ3NEaWdlc3QsXG4gICAgICAgICAgICAgIGFyZ3NfanNvbjogcHJlcGFyZWRKb2IuYXJnc0pzb24sXG4gICAgICAgICAgICAgIGpvYl9uYW1lOiBwcmVwYXJlZEpvYi5qb2JOYW1lLFxuICAgICAgICAgICAgICBxdWV1ZTogcHJlcGFyZWRKb2IucXVldWUsXG4gICAgICAgICAgICAgIHN0YXR1czogXCJxdWV1ZWRcIlxuICAgICAgICAgICAgfSlcbiAgICAgICAgICAgIC53aGVyZShgc2NoZWR1bGVkX2F0X21zIDw9ICR7ZGIucXVvdGUocHJlcGFyZWRKb2Iuc2NoZWR1bGVkQXRNcyl9YClcbiAgICAgICAgICAgIC5vcmRlcihcInNjaGVkdWxlZF9hdF9tcyBBU0NcIilcbiAgICAgICAgICAgIC5vcmRlcihcImNyZWF0ZWRfYXRfbXMgQVNDXCIpXG4gICAgICAgICAgICAubGltaXQoMSlcbiAgICAgICAgICAgIC5yZXN1bHRzKClcblxuICAgICAgICAgIGNvbnN0IGV4aXN0aW5nUm93ID0gLyoqIEB0eXBlIHt7aWQ6IHN0cmluZyB8IG51bWJlcn0gfCB1bmRlZmluZWR9ICovIChleGlzdGluZ1swXSlcblxuICAgICAgICAgIGlmIChleGlzdGluZ1Jvdykgam9iSWQgPSBTdHJpbmcoZXhpc3RpbmdSb3cuaWQpXG4gICAgICAgIH1cblxuICAgICAgICBpZiAoam9iSWQgPT09IHByZXBhcmVkSm9iLmpvYklkKSBhd2FpdCB0aGlzLl9pbnNlcnRQcmVwYXJlZEpvYihkYiwgcHJlcGFyZWRKb2IpXG4gICAgICAgIGlmICh0aGlzLm9uQ29tbWl0dGVkRW5xdWV1ZSkgYXdhaXQgZGIuYWZ0ZXJDb21taXQodGhpcy5vbkNvbW1pdHRlZEVucXVldWUpXG5cbiAgICAgICAgcmV0dXJuIGpvYklkXG4gICAgICB9KVxuICAgIH0pXG5cbiAgICBpZiAob3B0aW9ucy5kZWR1cGxpY2F0ZVdoaWxlUXVldWVkKSByZXR1cm4gYXdhaXQgdGhpcy5fc2VyaWFsaXplRGVkdXBsaWNhdGVkRW5xdWV1ZShwcmVwYXJlZEpvYiwgbXV0YXRlKVxuICAgIHJldHVybiBhd2FpdCBtdXRhdGUoKVxuICB9XG5cbiAgLyoqXG4gICAqIFNlcmlhbGl6ZXMgbWF0Y2hpbmcgaW4tcHJvY2VzcyBkZWR1cGxpY2F0aW9uIGNoZWNrcyB0aHJvdWdoIGNvbW1pdCB3aGlsZVxuICAgKiBsZWF2aW5nIHVucmVsYXRlZCBqb2IgaWRlbnRpdGllcyBpbmRlcGVuZGVudC5cbiAgICogQHRlbXBsYXRlIFRcbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL3R5cGVzLmpzXCIpLlByZXBhcmVkTG9jYWxCYWNrZ3JvdW5kSm9ifSBwcmVwYXJlZEpvYiAtIFByZXBhcmVkIGpvYiBpZGVudGl0eS5cbiAgICogQHBhcmFtIHsoaG9sZFVudGlsOiAoY29tcGxldGlvbjogUHJvbWlzZTx2b2lkPikgPT4gdm9pZCkgPT4gUHJvbWlzZTxUPn0gY2FsbGJhY2sgLSBEZWR1cGxpY2F0aW9uIG11dGF0aW9uLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxUPn0gLSBNdXRhdGlvbiByZXN1bHQuXG4gICAqL1xuICBhc3luYyBfc2VyaWFsaXplRGVkdXBsaWNhdGVkRW5xdWV1ZShwcmVwYXJlZEpvYiwgY2FsbGJhY2spIHtcbiAgICBsZXQgY2hhaW5zID0gZGVkdXBsaWNhdGVkRW5xdWV1ZUNoYWlucy5nZXQodGhpcy5jb25maWd1cmF0aW9uKVxuXG4gICAgaWYgKCFjaGFpbnMpIHtcbiAgICAgIGNoYWlucyA9IG5ldyBNYXAoKVxuICAgICAgZGVkdXBsaWNhdGVkRW5xdWV1ZUNoYWlucy5zZXQodGhpcy5jb25maWd1cmF0aW9uLCBjaGFpbnMpXG4gICAgfVxuXG4gICAgY29uc3Qga2V5ID0gc2hhMjU2SGV4KEpTT04uc3RyaW5naWZ5KFtcbiAgICAgIHRoaXMuZ2V0RGF0YWJhc2VJZGVudGlmaWVyKCksXG4gICAgICBwcmVwYXJlZEpvYi5qb2JOYW1lLFxuICAgICAgcHJlcGFyZWRKb2IuYXJnc0RpZ2VzdCxcbiAgICAgIHByZXBhcmVkSm9iLnF1ZXVlXG4gICAgXSkpXG4gICAgY29uc3QgcHJldmlvdXMgPSBjaGFpbnMuZ2V0KGtleSkgfHwgUHJvbWlzZS5yZXNvbHZlKClcbiAgICBsZXQgcmVsZWFzZSA9ICgpID0+IHt9XG4gICAgY29uc3QgcnVubmluZyA9IG5ldyBQcm9taXNlKChyZXNvbHZlKSA9PiB7IHJlbGVhc2UgPSAoKSA9PiByZXNvbHZlKHVuZGVmaW5lZCkgfSlcbiAgICBjb25zdCBjaGFpbiA9IHByZXZpb3VzLnRoZW4oKCkgPT4gcnVubmluZylcbiAgICAvKiogQHR5cGUge1Byb21pc2U8dm9pZD4gfCB1bmRlZmluZWR9ICovXG4gICAgbGV0IGNvbXBsZXRpb25cbiAgICBjb25zdCBmaW5pc2ggPSAoKSA9PiB7XG4gICAgICByZWxlYXNlKClcbiAgICAgIGlmIChjaGFpbnMuZ2V0KGtleSkgPT09IGNoYWluKSBjaGFpbnMuZGVsZXRlKGtleSlcbiAgICAgIGlmIChjaGFpbnMuc2l6ZSA9PT0gMCkgZGVkdXBsaWNhdGVkRW5xdWV1ZUNoYWlucy5kZWxldGUodGhpcy5jb25maWd1cmF0aW9uKVxuICAgIH1cblxuICAgIGNoYWlucy5zZXQoa2V5LCBjaGFpbilcbiAgICBhd2FpdCBwcmV2aW91c1xuXG4gICAgdHJ5IHtcbiAgICAgIGNvbnN0IHJlc3VsdCA9IGF3YWl0IGNhbGxiYWNrKCh0cmFuc2FjdGlvbkNvbXBsZXRpb24pID0+IHsgY29tcGxldGlvbiA9IHRyYW5zYWN0aW9uQ29tcGxldGlvbiB9KVxuXG4gICAgICBpZiAoY29tcGxldGlvbikge1xuICAgICAgICBjb21wbGV0aW9uLnRoZW4oZmluaXNoLCBmaW5pc2gpXG4gICAgICB9IGVsc2Uge1xuICAgICAgICBmaW5pc2goKVxuICAgICAgfVxuXG4gICAgICByZXR1cm4gcmVzdWx0XG4gICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgIGZpbmlzaCgpXG4gICAgICB0aHJvdyBlcnJvclxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBQcmVwYXJlcyB2YWxpZGF0ZWQgbG9jYWwgam9iIGRhdGEgZm9yIGluc2VydGlvbi5cbiAgICogQHBhcmFtIHt7YXJnczogQXJyYXk8UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+LCBqb2JOYW1lOiBzdHJpbmcsIG9wdGlvbnM6IGltcG9ydChcIi4vdHlwZXMuanNcIikuQmFja2dyb3VuZEpvYk9wdGlvbnN9fSBhcmdzIC0gSm9iIHJlcXVlc3QuXG4gICAqIEByZXR1cm5zIHtpbXBvcnQoXCIuL3R5cGVzLmpzXCIpLlByZXBhcmVkTG9jYWxCYWNrZ3JvdW5kSm9ifSAtIFByZXBhcmVkIHJvdyBkYXRhLlxuICAgKi9cbiAgX3ByZXBhcmVKb2Ioe2FyZ3MsIGpvYk5hbWUsIG9wdGlvbnN9KSB7XG4gICAgaWYgKG9wdGlvbnMuaWRlbXBvdGVuY3lLZXkgIT09IHVuZGVmaW5lZCkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKFwiaWRlbXBvdGVuY3lLZXkgaXMgbm90IHN1cHBvcnRlZCBieSB0aGUgbG9jYWwgYmFja2dyb3VuZC1qb2JzIGFkYXB0ZXJcIilcbiAgICB9XG5cbiAgICBjb25zdCBjcmVhdGVkQXRNcyA9IHRoaXMuY2xvY2subm93KClcbiAgICBjb25zdCBxdWV1ZSA9IG5vcm1hbGl6ZUJhY2tncm91bmRKb2JRdWV1ZShvcHRpb25zKVxuICAgIGNvbnN0IHF1ZXVlcyA9IHRoaXMuY29uZmlndXJhdGlvbi5nZXRCYWNrZ3JvdW5kSm9ic0NvbmZpZygpLnF1ZXVlc1xuICAgIGNvbnN0IGFyZ3NKc29uID0gSlNPTi5zdHJpbmdpZnkoYXJncyB8fCBbXSlcbiAgICBjb25zdCBleGVjdXRpb25Nb2RlID0gbm9ybWFsaXplQmFja2dyb3VuZEpvYkV4ZWN1dGlvbk1vZGUob3B0aW9ucywgXCJpbmxpbmVcIiwgTE9DQUxfRVhFQ1VUSU9OX01PREVTKVxuXG4gICAgaWYgKHR5cGVvZiBhcmdzSnNvbiAhPT0gXCJzdHJpbmdcIikgdGhyb3cgbmV3IFR5cGVFcnJvcihcIkxvY2FsIGJhY2tncm91bmQgam9iIGFyZ3VtZW50cyBtdXN0IGJlIEpTT04gc2VyaWFsaXphYmxlXCIpXG4gICAgaWYgKGV4ZWN1dGlvbk1vZGUgIT09IFwiaW5saW5lXCIpIHRocm93IG5ldyBFcnJvcihcIkxvY2FsIGJhY2tncm91bmQgam9iIGV4ZWN1dGlvbiBtb2RlIGludmFyaWFudCB3YXMgdmlvbGF0ZWRcIilcblxuICAgIHJldHVybiB7XG4gICAgICBhcmdzRGlnZXN0OiBzaGEyNTZIZXgoYXJnc0pzb24pLFxuICAgICAgYXJnc0pzb24sXG4gICAgICBjb25jdXJyZW5jeTogbm9ybWFsaXplQmFja2dyb3VuZEpvYkNvbmN1cnJlbmN5KHtvcHRpb25zLCBxdWV1ZSwgcXVldWVzfSksXG4gICAgICBjcmVhdGVkQXRNcyxcbiAgICAgIGV4ZWN1dGlvbk1vZGUsXG4gICAgICBqb2JJZDogbmV3IFVVSUQoNCkuZm9ybWF0KCksXG4gICAgICBqb2JOYW1lLFxuICAgICAgbWF4UmV0cmllczogbm9ybWFsaXplQmFja2dyb3VuZEpvYk1heFJldHJpZXMob3B0aW9ucy5tYXhSZXRyaWVzKSxcbiAgICAgIHF1ZXVlLFxuICAgICAgc2NoZWR1bGVkQXRNczogbm9ybWFsaXplQmFja2dyb3VuZEpvYlNjaGVkdWxlZEF0TXMob3B0aW9ucy5zY2hlZHVsZWRBdE1zLCBjcmVhdGVkQXRNcylcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogSW5zZXJ0cyBvbmUgcHJlcGFyZWQgbG9jYWwgam9iIHJvdyBhbmQgaXRzIGNvbmN1cnJlbmN5IG1ldGFkYXRhLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL2RhdGFiYXNlL2RyaXZlcnMvYmFzZS5qc1wiKS5kZWZhdWx0fSBkYiAtIExvY2FsIFNRTGl0ZSBjb25uZWN0aW9uLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vdHlwZXMuanNcIikuUHJlcGFyZWRMb2NhbEJhY2tncm91bmRKb2J9IHByZXBhcmVkSm9iIC0gUHJlcGFyZWQgcm93IGRhdGEuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIGFmdGVyIGluc2VydGlvbi5cbiAgICovXG4gIGFzeW5jIF9pbnNlcnRQcmVwYXJlZEpvYihkYiwgcHJlcGFyZWRKb2IpIHtcbiAgICBhd2FpdCBkYi5pbnNlcnQoe1xuICAgICAgdGFibGVOYW1lOiBMT0NBTF9CQUNLR1JPVU5EX0pPQlNfVEFCTEUsXG4gICAgICBkYXRhOiB7XG4gICAgICAgIGFyZ3NfZGlnZXN0OiBwcmVwYXJlZEpvYi5hcmdzRGlnZXN0LFxuICAgICAgICBhcmdzX2pzb246IHByZXBhcmVkSm9iLmFyZ3NKc29uLFxuICAgICAgICBhdHRlbXB0czogMCxcbiAgICAgICAgY29tcGxldGVkX2F0X21zOiBudWxsLFxuICAgICAgICBjb25jdXJyZW5jeV9rZXk6IHByZXBhcmVkSm9iLmNvbmN1cnJlbmN5Py5jb25jdXJyZW5jeUtleSB8fCBudWxsLFxuICAgICAgICBjcmVhdGVkX2F0X21zOiBwcmVwYXJlZEpvYi5jcmVhdGVkQXRNcyxcbiAgICAgICAgZXhlY3V0aW9uX21vZGU6IHByZXBhcmVkSm9iLmV4ZWN1dGlvbk1vZGUsXG4gICAgICAgIGZhaWxlZF9hdF9tczogbnVsbCxcbiAgICAgICAgaGFuZGVkX29mZl9hdF9tczogbnVsbCxcbiAgICAgICAgaGFuZG9mZl9pZDogbnVsbCxcbiAgICAgICAgaWQ6IHByZXBhcmVkSm9iLmpvYklkLFxuICAgICAgICBqb2JfbmFtZTogcHJlcGFyZWRKb2Iuam9iTmFtZSxcbiAgICAgICAgbGFzdF9lcnJvcjogbnVsbCxcbiAgICAgICAgbWF4X2NvbmN1cnJlbmN5OiBwcmVwYXJlZEpvYi5jb25jdXJyZW5jeT8ubWF4Q29uY3VycmVuY3kgfHwgbnVsbCxcbiAgICAgICAgbWF4X3JldHJpZXM6IHByZXBhcmVkSm9iLm1heFJldHJpZXMsXG4gICAgICAgIHF1ZXVlOiBwcmVwYXJlZEpvYi5xdWV1ZSxcbiAgICAgICAgc2NoZWR1bGVkX2F0X21zOiBwcmVwYXJlZEpvYi5zY2hlZHVsZWRBdE1zLFxuICAgICAgICBzdGF0dXM6IFwicXVldWVkXCIsXG4gICAgICAgIHdvcmtlcl9pZDogbnVsbFxuICAgICAgfVxuICAgIH0pXG4gIH1cblxuICAvKipcbiAgICogUmVjb25jaWxlcyBjb25maWd1cmVkIHF1ZXVlLWRlcml2ZWQgY2FwcyBhbmQgZHVyYWJsZSBjb3VudGVycy5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgYWZ0ZXIgcmVjb25jaWxpYXRpb24uXG4gICAqL1xuICBhc3luYyByZWNvbmNpbGVRdWV1ZUNvbmN1cnJlbmN5KCkge1xuICAgIGF3YWl0IHRoaXMuZW5zdXJlUmVhZHkoKVxuXG4gICAgYXdhaXQgdGhpcy5fd2l0aERiKGFzeW5jIChjb25uZWN0aW9uKSA9PiBhd2FpdCB0aGlzLl9tdXRhdGUoY29ubmVjdGlvbiwgYXN5bmMgKGRiKSA9PiB7XG4gICAgICBjb25zdCBxdWV1ZXMgPSB0aGlzLmNvbmZpZ3VyYXRpb24uZ2V0QmFja2dyb3VuZEpvYnNDb25maWcoKS5xdWV1ZXNcbiAgICAgIGNvbnN0IHJvd3MgPSBhd2FpdCBkYi5uZXdRdWVyeSgpLmZyb20oTE9DQUxfQkFDS0dST1VORF9KT0JTX1RBQkxFKS53aGVyZSh7c3RhdHVzOiBcInF1ZXVlZFwifSkucmVzdWx0cygpXG5cbiAgICAgIGZvciAoY29uc3QgcmF3Um93IG9mIHJvd3MpIHtcbiAgICAgICAgYXdhaXQgdGhpcy5fcmVjb25jaWxlUXVldWVkSm9iQ29uY3VycmVuY3koZGIsIHRoaXMuX25vcm1hbGl6ZVJvdyhyYXdSb3cpLCBxdWV1ZXMpXG4gICAgICB9XG5cbiAgICAgIGF3YWl0IHRoaXMuX3JlYnVpbGRDb25jdXJyZW5jeUNvdW50cyhkYilcbiAgICB9KSlcbiAgfVxuXG4gIC8qKlxuICAgKiBBcHBsaWVzIGN1cnJlbnQgcXVldWUtZGVyaXZlZCBjb25jdXJyZW5jeSBwb2xpY3kgdG8gb25lIHF1ZXVlZCByb3cuXG4gICAqIEV4cGxpY2l0IGNvbmN1cnJlbmN5IGtleXMgcmVtYWluIG93bmVkIGJ5IHRoZSBlbnF1ZXVlIGNvbnRyYWN0LlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL2RhdGFiYXNlL2RyaXZlcnMvYmFzZS5qc1wiKS5kZWZhdWx0fSBkYiAtIExvY2FsIFNRTGl0ZSBjb25uZWN0aW9uLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vdHlwZXMuanNcIikuQmFja2dyb3VuZEpvYlJvd30gam9iIC0gUXVldWVkIGpvYiBzbmFwc2hvdC5cbiAgICogQHBhcmFtIHtSZWNvcmQ8c3RyaW5nLCB7bWF4Q29uY3VycmVudD86IG51bWJlciwgcHJpb3JpdHk/OiBudW1iZXJ9Pn0gcXVldWVzIC0gQ3VycmVudCBxdWV1ZSBwb2xpY3kgc25hcHNob3QuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPGltcG9ydChcIi4vdHlwZXMuanNcIikuQmFja2dyb3VuZEpvYlJvdz59IC0gUmVjb25jaWxlZCBzbmFwc2hvdC5cbiAgICovXG4gIGFzeW5jIF9yZWNvbmNpbGVRdWV1ZWRKb2JDb25jdXJyZW5jeShkYiwgam9iLCBxdWV1ZXMpIHtcbiAgICBjb25zdCBjdXJyZW50SXNRdWV1ZURlcml2ZWQgPSBCb29sZWFuKGpvYi5jb25jdXJyZW5jeUtleT8uc3RhcnRzV2l0aChRVUVVRV9DT05DVVJSRU5DWV9LRVlfUFJFRklYKSlcblxuICAgIGlmIChqb2IuY29uY3VycmVuY3lLZXkgJiYgIWN1cnJlbnRJc1F1ZXVlRGVyaXZlZCkgcmV0dXJuIGpvYlxuXG4gICAgY29uc3QgY29uY3VycmVuY3kgPSBub3JtYWxpemVCYWNrZ3JvdW5kSm9iQ29uY3VycmVuY3koe1xuICAgICAgb3B0aW9uczoge30sXG4gICAgICBxdWV1ZTogam9iLnF1ZXVlLFxuICAgICAgcXVldWVzXG4gICAgfSlcblxuICAgIGlmICghY29uY3VycmVuY3kpIHtcbiAgICAgIGlmIChjdXJyZW50SXNRdWV1ZURlcml2ZWQpIHtcbiAgICAgICAgYXdhaXQgZGIudXBkYXRlKHtcbiAgICAgICAgICBjb25kaXRpb25zOiB7aWQ6IGpvYi5pZCwgc3RhdHVzOiBcInF1ZXVlZFwifSxcbiAgICAgICAgICBkYXRhOiB7Y29uY3VycmVuY3lfa2V5OiBudWxsLCBtYXhfY29uY3VycmVuY3k6IG51bGx9LFxuICAgICAgICAgIHRhYmxlTmFtZTogTE9DQUxfQkFDS0dST1VORF9KT0JTX1RBQkxFXG4gICAgICAgIH0pXG4gICAgICB9XG5cbiAgICAgIHJldHVybiB7Li4uam9iLCBjb25jdXJyZW5jeUtleTogbnVsbCwgbWF4Q29uY3VycmVuY3k6IG51bGx9XG4gICAgfVxuXG4gICAgYXdhaXQgdGhpcy5fZW5zdXJlQ29uY3VycmVuY3koZGIsIGNvbmN1cnJlbmN5KVxuICAgIGlmIChqb2IuY29uY3VycmVuY3lLZXkgIT09IGNvbmN1cnJlbmN5LmNvbmN1cnJlbmN5S2V5IHx8IGpvYi5tYXhDb25jdXJyZW5jeSAhPT0gY29uY3VycmVuY3kubWF4Q29uY3VycmVuY3kpIHtcbiAgICAgIGF3YWl0IGRiLnVwZGF0ZSh7XG4gICAgICAgIGNvbmRpdGlvbnM6IHtpZDogam9iLmlkLCBzdGF0dXM6IFwicXVldWVkXCJ9LFxuICAgICAgICBkYXRhOiB7Y29uY3VycmVuY3lfa2V5OiBjb25jdXJyZW5jeS5jb25jdXJyZW5jeUtleSwgbWF4X2NvbmN1cnJlbmN5OiBjb25jdXJyZW5jeS5tYXhDb25jdXJyZW5jeX0sXG4gICAgICAgIHRhYmxlTmFtZTogTE9DQUxfQkFDS0dST1VORF9KT0JTX1RBQkxFXG4gICAgICB9KVxuICAgIH1cblxuICAgIHJldHVybiB7Li4uam9iLCBjb25jdXJyZW5jeUtleTogY29uY3VycmVuY3kuY29uY3VycmVuY3lLZXksIG1heENvbmN1cnJlbmN5OiBjb25jdXJyZW5jeS5tYXhDb25jdXJyZW5jeX1cbiAgfVxuXG4gIC8qKlxuICAgKiBGaW5kcyB0aGUgbmV4dCBlbGlnaWJsZSBsb2NhbCBqb2IuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPGltcG9ydChcIi4vdHlwZXMuanNcIikuQmFja2dyb3VuZEpvYlJvdyB8IG51bGw+fSAtIE5leHQgZWxpZ2libGUgbG9jYWwgam9iLlxuICAgKi9cbiAgYXN5bmMgbmV4dEF2YWlsYWJsZUpvYigpIHtcbiAgICBhd2FpdCB0aGlzLmVuc3VyZVJlYWR5KClcblxuICAgIHJldHVybiBhd2FpdCB0aGlzLl93aXRoRGIoYXN5bmMgKGRiKSA9PiB7XG4gICAgICBjb25zdCBqb2JzVGFibGUgPSBkYi5xdW90ZVRhYmxlKExPQ0FMX0JBQ0tHUk9VTkRfSk9CU19UQUJMRSlcbiAgICAgIGNvbnN0IGNvbmN1cnJlbmN5VGFibGUgPSBkYi5xdW90ZVRhYmxlKExPQ0FMX0JBQ0tHUk9VTkRfSk9CX0NPTkNVUlJFTkNZX1RBQkxFKVxuICAgICAgY29uc3QgcHJpb3JpdHlPcmRlciA9IHRoaXMuX3F1ZXVlUHJpb3JpdHlPcmRlclNxbChkYilcbiAgICAgIGxldCBxdWVyeSA9IGRiXG4gICAgICAgIC5uZXdRdWVyeSgpXG4gICAgICAgIC5mcm9tKExPQ0FMX0JBQ0tHUk9VTkRfSk9CU19UQUJMRSlcbiAgICAgICAgLndoZXJlKHtzdGF0dXM6IFwicXVldWVkXCJ9KVxuICAgICAgICAud2hlcmUoYHNjaGVkdWxlZF9hdF9tcyA8PSAke2RiLnF1b3RlKHRoaXMuY2xvY2subm93KCkpfWApXG4gICAgICAgIC53aGVyZShcbiAgICAgICAgICBgKCR7am9ic1RhYmxlfS4ke2RiLnF1b3RlQ29sdW1uKFwiY29uY3VycmVuY3lfa2V5XCIpfSBJUyBOVUxMIE9SIEVYSVNUUyAoYCArXG4gICAgICAgICAgYFNFTEVDVCAxIEZST00gJHtjb25jdXJyZW5jeVRhYmxlfSBXSEVSRSBgICtcbiAgICAgICAgICBgJHtjb25jdXJyZW5jeVRhYmxlfS4ke2RiLnF1b3RlQ29sdW1uKFwiY29uY3VycmVuY3lfa2V5XCIpfSA9ICR7am9ic1RhYmxlfS4ke2RiLnF1b3RlQ29sdW1uKFwiY29uY3VycmVuY3lfa2V5XCIpfSBBTkQgYCArXG4gICAgICAgICAgYCR7Y29uY3VycmVuY3lUYWJsZX0uJHtkYi5xdW90ZUNvbHVtbihcImFjdGl2ZV9jb3VudFwiKX0gPCAke2NvbmN1cnJlbmN5VGFibGV9LiR7ZGIucXVvdGVDb2x1bW4oXCJtYXhfY29uY3VycmVuY3lcIil9KSlgXG4gICAgICAgIClcblxuICAgICAgaWYgKHByaW9yaXR5T3JkZXIpIHF1ZXJ5ID0gcXVlcnkub3JkZXIoYCR7cHJpb3JpdHlPcmRlcn0gREVTQ2ApXG5cbiAgICAgIGNvbnN0IHJvd3MgPSBhd2FpdCBxdWVyeVxuICAgICAgICAub3JkZXIoXCJzY2hlZHVsZWRfYXRfbXMgQVNDXCIpXG4gICAgICAgIC5vcmRlcihcImNyZWF0ZWRfYXRfbXMgQVNDXCIpXG4gICAgICAgIC5vcmRlcihcImlkIEFTQ1wiKVxuICAgICAgICAubGltaXQoMSlcbiAgICAgICAgLnJlc3VsdHMoKVxuXG4gICAgICByZXR1cm4gcm93c1swXSA/IHRoaXMuX25vcm1hbGl6ZVJvdyhyb3dzWzBdKSA6IG51bGxcbiAgICB9KVxuICB9XG5cbiAgLyoqXG4gICAqIEZpbmRzIHRoZSBzb29uZXN0IGZ1dHVyZSBxdWV1ZWQgam9iLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxpbXBvcnQoXCIuL3R5cGVzLmpzXCIpLkJhY2tncm91bmRKb2JSb3cgfCBudWxsPn0gLSBTb29uZXN0IGZ1dHVyZSBxdWV1ZWQgam9iLlxuICAgKi9cbiAgYXN5bmMgbmV4dFNjaGVkdWxlZEpvYigpIHtcbiAgICBhd2FpdCB0aGlzLmVuc3VyZVJlYWR5KClcblxuICAgIHJldHVybiBhd2FpdCB0aGlzLl93aXRoRGIoYXN5bmMgKGRiKSA9PiB7XG4gICAgICBjb25zdCByb3dzID0gYXdhaXQgZGJcbiAgICAgICAgLm5ld1F1ZXJ5KClcbiAgICAgICAgLmZyb20oTE9DQUxfQkFDS0dST1VORF9KT0JTX1RBQkxFKVxuICAgICAgICAud2hlcmUoe3N0YXR1czogXCJxdWV1ZWRcIn0pXG4gICAgICAgIC53aGVyZShgc2NoZWR1bGVkX2F0X21zID4gJHtkYi5xdW90ZSh0aGlzLmNsb2NrLm5vdygpKX1gKVxuICAgICAgICAub3JkZXIoXCJzY2hlZHVsZWRfYXRfbXMgQVNDXCIpXG4gICAgICAgIC5vcmRlcihcImNyZWF0ZWRfYXRfbXMgQVNDXCIpXG4gICAgICAgIC5vcmRlcihcImlkIEFTQ1wiKVxuICAgICAgICAubGltaXQoMSlcbiAgICAgICAgLnJlc3VsdHMoKVxuXG4gICAgICByZXR1cm4gcm93c1swXSA/IHRoaXMuX25vcm1hbGl6ZVJvdyhyb3dzWzBdKSA6IG51bGxcbiAgICB9KVxuICB9XG5cbiAgLyoqXG4gICAqIEZpbmRzIGEgcGVyc2lzdGVkIGxvY2FsIGpvYiBieSBpZC5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGpvYklkIC0gSm9iIGlkLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxpbXBvcnQoXCIuL3R5cGVzLmpzXCIpLkJhY2tncm91bmRKb2JSb3cgfCBudWxsPn0gLSBQZXJzaXN0ZWQgam9iLlxuICAgKi9cbiAgYXN5bmMgZ2V0Sm9iKGpvYklkKSB7XG4gICAgYXdhaXQgdGhpcy5lbnN1cmVSZWFkeSgpXG5cbiAgICByZXR1cm4gYXdhaXQgdGhpcy5fd2l0aERiKGFzeW5jIChkYikgPT4gYXdhaXQgdGhpcy5fZ2V0Sm9iKGRiLCBqb2JJZCkpXG4gIH1cblxuICAvKipcbiAgICogTGlzdHMgbG9jYWwgam9icyBpbiBjcmVhdGlvbiBvcmRlci5cbiAgICogQHJldHVybnMge1Byb21pc2U8aW1wb3J0KFwiLi90eXBlcy5qc1wiKS5CYWNrZ3JvdW5kSm9iUm93W10+fSAtIEFsbCBsb2NhbCBqb2JzIGluIGNyZWF0aW9uIG9yZGVyLlxuICAgKi9cbiAgYXN5bmMgbGlzdEpvYnMoKSB7XG4gICAgYXdhaXQgdGhpcy5lbnN1cmVSZWFkeSgpXG5cbiAgICByZXR1cm4gYXdhaXQgdGhpcy5fd2l0aERiKGFzeW5jIChkYikgPT4ge1xuICAgICAgY29uc3Qgcm93cyA9IGF3YWl0IGRiXG4gICAgICAgIC5uZXdRdWVyeSgpXG4gICAgICAgIC5mcm9tKExPQ0FMX0JBQ0tHUk9VTkRfSk9CU19UQUJMRSlcbiAgICAgICAgLm9yZGVyKFwiY3JlYXRlZF9hdF9tcyBBU0NcIilcbiAgICAgICAgLm9yZGVyKFwiaWQgQVNDXCIpXG4gICAgICAgIC5yZXN1bHRzKClcblxuICAgICAgcmV0dXJuIHJvd3MubWFwKChyb3cpID0+IHRoaXMuX25vcm1hbGl6ZVJvdyhyb3cpKVxuICAgIH0pXG4gIH1cblxuICAvKipcbiAgICogQXRvbWljYWxseSByZXNlcnZlcyBjb25jdXJyZW5jeSBhbmQgY2xhaW1zIG9uZSBxdWV1ZWQgam9iLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vdHlwZXMuanNcIikuQmFja2dyb3VuZEpvYkhhbmRvZmZSZXF1ZXN0fSBhcmdzIC0gQ2xhaW0gcmVxdWVzdC4gQSBzdXBwbGllZCBoYW5kb2ZmIGlkIGlzIHBlcnNpc3RlZCBleGFjdGx5LlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxpbXBvcnQoXCIuL3R5cGVzLmpzXCIpLkJhY2tncm91bmRKb2JIYW5kb2ZmIHwgbnVsbD59IC0gRmVuY2VkIGNsYWltLlxuICAgKi9cbiAgYXN5bmMgbWFya0hhbmRlZE9mZih7am9iSWQsIGhhbmRvZmZJZCA9IG5ldyBVVUlEKDQpLmZvcm1hdCgpLCB3b3JrZXJJZH0pIHtcbiAgICBhd2FpdCB0aGlzLmVuc3VyZVJlYWR5KClcblxuICAgIHJldHVybiBhd2FpdCB0aGlzLl93aXRoRGIoYXN5bmMgKGNvbm5lY3Rpb24pID0+IGF3YWl0IHRoaXMuX211dGF0ZShjb25uZWN0aW9uLCBhc3luYyAoZGIpID0+IHtcbiAgICAgIGNvbnN0IGpvYiA9IGF3YWl0IHRoaXMuX2dldEpvYihkYiwgam9iSWQpXG5cbiAgICAgIGlmICgham9iIHx8IGpvYi5zdGF0dXMgIT09IFwicXVldWVkXCIgfHwgTnVtYmVyKGpvYi5zY2hlZHVsZWRBdE1zKSA+IHRoaXMuY2xvY2subm93KCkpIHJldHVybiBudWxsXG4gICAgICBpZiAoam9iLmNvbmN1cnJlbmN5S2V5ICYmICEoYXdhaXQgdGhpcy5fcmVzZXJ2ZUNvbmN1cnJlbmN5KGRiLCBqb2IuY29uY3VycmVuY3lLZXkpKSkgcmV0dXJuIG51bGxcblxuICAgICAgY29uc3QgaGFuZGVkT2ZmQXRNcyA9IHRoaXMuY2xvY2subm93KClcbiAgICAgIGNvbnN0IGFmZmVjdGVkUm93cyA9IGF3YWl0IHRoaXMuX3VwZGF0ZUFmZmVjdGVkUm93cyhkYiwge1xuICAgICAgICBjb25kaXRpb25zOiB7aWQ6IGpvYklkLCBzdGF0dXM6IFwicXVldWVkXCJ9LFxuICAgICAgICBkYXRhOiB7Li4udGhpcy5fY2xlYXJlZENoaWxkQWNjZXB0YW5jZURhdGEoKSwgaGFuZGVkX29mZl9hdF9tczogaGFuZGVkT2ZmQXRNcywgaGFuZG9mZl9pZDogaGFuZG9mZklkLCBzdGF0dXM6IFwiaGFuZGVkX29mZlwiLCB3b3JrZXJfaWQ6IHdvcmtlcklkIHx8IFwibG9jYWxcIn0sXG4gICAgICAgIHRhYmxlTmFtZTogTE9DQUxfQkFDS0dST1VORF9KT0JTX1RBQkxFXG4gICAgICB9KVxuXG4gICAgICBpZiAoYWZmZWN0ZWRSb3dzICE9PSAxKSB7XG4gICAgICAgIGF3YWl0IHRoaXMuX3JlbGVhc2VDb25jdXJyZW5jeShkYiwgam9iLmNvbmN1cnJlbmN5S2V5KVxuICAgICAgICByZXR1cm4gbnVsbFxuICAgICAgfVxuXG4gICAgICByZXR1cm4ge2hhbmRlZE9mZkF0TXMsIGhhbmRvZmZJZH1cbiAgICB9KSlcbiAgfVxuXG4gIC8qKlxuICAgKiBGaW5kcyBhY3RpdmUgbG9jYWwgaGFuZG9mZnMgb3duZWQgYnkgb25lIHdvcmtlci5cbiAgICogQHBhcmFtIHt7d29ya2VySWQ6IHN0cmluZ319IGFyZ3MgLSBXb3JrZXIgaWRlbnRpdHkuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPEFycmF5PHtqb2JJZDogc3RyaW5nLCBoYW5kb2ZmSWQ6IHN0cmluZ30+Pn0gLSBBY3RpdmUgd29ya2VyIGhhbmRvZmZzLlxuICAgKi9cbiAgYXN5bmMgaGFuZGVkT2ZmSm9ic0Zvcldvcmtlcih7d29ya2VySWR9KSB7XG4gICAgYXdhaXQgdGhpcy5lbnN1cmVSZWFkeSgpXG5cbiAgICBjb25zdCByb3dzID0gYXdhaXQgdGhpcy5fd2l0aERiKGFzeW5jIChkYikgPT4gYXdhaXQgZGJcbiAgICAgIC5uZXdRdWVyeSgpXG4gICAgICAuZnJvbShMT0NBTF9CQUNLR1JPVU5EX0pPQlNfVEFCTEUpXG4gICAgICAud2hlcmUoe3N0YXR1czogXCJoYW5kZWRfb2ZmXCIsIHdvcmtlcl9pZDogd29ya2VySWR9KVxuICAgICAgLnJlc3VsdHMoKSlcbiAgICAvKiogQHR5cGUge0FycmF5PHtqb2JJZDogc3RyaW5nLCBoYW5kb2ZmSWQ6IHN0cmluZ30+fSAqL1xuICAgIGNvbnN0IGhhbmRvZmZzID0gW11cblxuICAgIGZvciAoY29uc3QgcmF3Um93IG9mIHJvd3MpIHtcbiAgICAgIGNvbnN0IGpvYiA9IHRoaXMuX25vcm1hbGl6ZVJvdyhyYXdSb3cpXG5cbiAgICAgIGlmIChqb2IuaGFuZG9mZklkKSBoYW5kb2Zmcy5wdXNoKHtqb2JJZDogam9iLmlkLCBoYW5kb2ZmSWQ6IGpvYi5oYW5kb2ZmSWR9KVxuICAgIH1cblxuICAgIHJldHVybiBoYW5kb2Zmc1xuICB9XG5cbiAgLyoqXG4gICAqIFJldHVybnMgYW4gZXhhY3QgYWN0aXZlIGhhbmRvZmYgdG8gdGhlIHF1ZXVlLlxuICAgKiBAcGFyYW0ge3tqb2JJZDogc3RyaW5nLCBoYW5kb2ZmSWQ6IHN0cmluZ319IGFyZ3MgLSBIYW5kb2ZmIHJlbGVhc2UuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIGFmdGVyIHRoZSBmZW5jZWQgcmVsZWFzZS5cbiAgICovXG4gIGFzeW5jIG1hcmtSZXR1cm5lZFRvUXVldWUoe2pvYklkLCBoYW5kb2ZmSWR9KSB7XG4gICAgYXdhaXQgdGhpcy5lbnN1cmVSZWFkeSgpXG5cbiAgICBhd2FpdCB0aGlzLl93aXRoRGIoYXN5bmMgKGNvbm5lY3Rpb24pID0+IGF3YWl0IHRoaXMuX211dGF0ZShjb25uZWN0aW9uLCBhc3luYyAoZGIpID0+IHtcbiAgICAgIGNvbnN0IGpvYiA9IGF3YWl0IHRoaXMuX2dldEpvYihkYiwgam9iSWQpXG5cbiAgICAgIGlmICghdGhpcy5fYWNjZXB0c0hhbmRvZmYoam9iLCBoYW5kb2ZmSWQpKSByZXR1cm5cbiAgICAgIGF3YWl0IHRoaXMuX2xvY2tDb25jdXJyZW5jeVJvdyhkYiwgam9iLmNvbmN1cnJlbmN5S2V5KVxuXG4gICAgICBjb25zdCBhZmZlY3RlZFJvd3MgPSBhd2FpdCB0aGlzLl91cGRhdGVBZmZlY3RlZFJvd3MoZGIsIHtcbiAgICAgICAgY29uZGl0aW9uczoge2hhbmRvZmZfaWQ6IGhhbmRvZmZJZCwgaWQ6IGpvYklkLCBzdGF0dXM6IFwiaGFuZGVkX29mZlwifSxcbiAgICAgICAgZGF0YToge1xuICAgICAgICAgIC4uLnRoaXMuX2NsZWFyZWRDaGlsZEFjY2VwdGFuY2VEYXRhKCksXG4gICAgICAgICAgaGFuZGVkX29mZl9hdF9tczogbnVsbCxcbiAgICAgICAgICBoYW5kb2ZmX2lkOiBudWxsLFxuICAgICAgICAgIHNjaGVkdWxlZF9hdF9tczogdGhpcy5jbG9jay5ub3coKSxcbiAgICAgICAgICBzdGF0dXM6IFwicXVldWVkXCIsXG4gICAgICAgICAgd29ya2VyX2lkOiBudWxsXG4gICAgICAgIH0sXG4gICAgICAgIHRhYmxlTmFtZTogTE9DQUxfQkFDS0dST1VORF9KT0JTX1RBQkxFXG4gICAgICB9KVxuXG4gICAgICBpZiAoYWZmZWN0ZWRSb3dzID09PSAxKSBhd2FpdCB0aGlzLl9yZWxlYXNlQ29uY3VycmVuY3koZGIsIGpvYi5jb25jdXJyZW5jeUtleSlcbiAgICB9KSlcbiAgfVxuXG4gIC8qKlxuICAgKiBBcHBsaWVzIGEgZmVuY2VkIHN1Y2Nlc3NmdWwgYWNrbm93bGVkZ2VtZW50LlxuICAgKiBAcGFyYW0ge3tqb2JJZDogc3RyaW5nLCBoYW5kb2ZmSWQ/OiBzdHJpbmd9fSBhcmdzIC0gQ29tcGxldGlvbiByZXBvcnQuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPGJvb2xlYW4+fSAtIFdoZXRoZXIgdGhlIGxlYXNlIHdvbi5cbiAgICovXG4gIGFzeW5jIG1hcmtDb21wbGV0ZWQoe2pvYklkLCBoYW5kb2ZmSWR9KSB7XG4gICAgYXdhaXQgdGhpcy5lbnN1cmVSZWFkeSgpXG5cbiAgICByZXR1cm4gYXdhaXQgdGhpcy5fd2l0aERiKGFzeW5jIChjb25uZWN0aW9uKSA9PiBhd2FpdCB0aGlzLl9tdXRhdGUoY29ubmVjdGlvbiwgYXN5bmMgKGRiKSA9PiB7XG4gICAgICBjb25zdCBqb2IgPSBhd2FpdCB0aGlzLl9nZXRKb2IoZGIsIGpvYklkKVxuXG4gICAgICBpZiAoIXRoaXMuX2FjY2VwdHNIYW5kb2ZmKGpvYiwgaGFuZG9mZklkKSkgcmV0dXJuIGZhbHNlXG4gICAgICBhd2FpdCB0aGlzLl9sb2NrQ29uY3VycmVuY3lSb3coZGIsIGpvYi5jb25jdXJyZW5jeUtleSlcblxuICAgICAgY29uc3QgYWZmZWN0ZWRSb3dzID0gYXdhaXQgdGhpcy5fdXBkYXRlQWZmZWN0ZWRSb3dzKGRiLCB7XG4gICAgICAgIGNvbmRpdGlvbnM6IHtoYW5kb2ZmX2lkOiBoYW5kb2ZmSWQsIGlkOiBqb2JJZCwgc3RhdHVzOiBcImhhbmRlZF9vZmZcIn0sXG4gICAgICAgIGRhdGE6IHtjb21wbGV0ZWRfYXRfbXM6IHRoaXMuY2xvY2subm93KCksIHN0YXR1czogXCJjb21wbGV0ZWRcIn0sXG4gICAgICAgIHRhYmxlTmFtZTogTE9DQUxfQkFDS0dST1VORF9KT0JTX1RBQkxFXG4gICAgICB9KVxuXG4gICAgICBpZiAoYWZmZWN0ZWRSb3dzICE9PSAxKSByZXR1cm4gZmFsc2VcbiAgICAgIGF3YWl0IHRoaXMuX3JlbGVhc2VDb25jdXJyZW5jeShkYiwgam9iLmNvbmN1cnJlbmN5S2V5KVxuICAgICAgcmV0dXJuIHRydWVcbiAgICB9KSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSZWNvcmRzIHBvb2xlZC1jaGlsZCBhY2NlcHRhbmNlIGV2aWRlbmNlIGZvciBhbiBhY3RpdmUgaGFuZG9mZi4gT25seSB0aGVcbiAgICogZmllbGRzIHN1cHBsaWVkIGFyZSB3cml0dGVuLCBmZW5jZWQgYnkgdGhlIGV4YWN0IGFjdGl2ZSBoYW5kb2ZmIGxlYXNlLlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIEFjY2VwdGFuY2UgcmVwb3J0LlxuICAgKiBAcGFyYW0ge3N0cmluZ30gYXJncy5qb2JJZCAtIEpvYiBpZC5cbiAgICogQHBhcmFtIHtzdHJpbmd9IFthcmdzLmhhbmRvZmZJZF0gLSBIYW5kb2ZmIGxlYXNlIGlkLlxuICAgKiBAcGFyYW0ge251bWJlcn0gW2FyZ3MucmVjZWl2ZWRBdE1zXSAtIEVwb2NoIG1zIHRoZSBydW5uZXIgY2hpbGQgcmVjZWl2ZWQgdGhlIGpvYi5cbiAgICogQHBhcmFtIHtudW1iZXJ9IFthcmdzLnN0YXJ0ZWRBdE1zXSAtIEVwb2NoIG1zIHRoZSBqb2IncyBwZXJmb3JtIHN0YXJ0ZWQgaW4gdGhlIGNoaWxkLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gW2FyZ3MuY2hpbGRJbnN0YW5jZUlkXSAtIFN0YWJsZSBwb29sZWQgY2hpbGQgaWRlbnRpdHkuXG4gICAqIEBwYXJhbSB7bnVtYmVyfSBbYXJncy5jaGlsZFBpZF0gLSBQb29sZWQgY2hpbGQgT1MgcGlkLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxib29sZWFuPn0gLSBXaGV0aGVyIHRoZSBsZWFzZSB3b24uXG4gICAqL1xuICBhc3luYyBtYXJrQ2hpbGRBY2NlcHRlZCh7am9iSWQsIGhhbmRvZmZJZCwgcmVjZWl2ZWRBdE1zLCBzdGFydGVkQXRNcywgY2hpbGRJbnN0YW5jZUlkLCBjaGlsZFBpZH0pIHtcbiAgICBhd2FpdCB0aGlzLmVuc3VyZVJlYWR5KClcblxuICAgIHJldHVybiBhd2FpdCB0aGlzLl93aXRoRGIoYXN5bmMgKGNvbm5lY3Rpb24pID0+IGF3YWl0IHRoaXMuX211dGF0ZShjb25uZWN0aW9uLCBhc3luYyAoZGIpID0+IHtcbiAgICAgIGNvbnN0IGpvYiA9IGF3YWl0IHRoaXMuX2dldEpvYihkYiwgam9iSWQpXG5cbiAgICAgIGlmICghdGhpcy5fYWNjZXB0c0hhbmRvZmYoam9iLCBoYW5kb2ZmSWQpKSByZXR1cm4gZmFsc2VcblxuICAgICAgY29uc3QgZGF0YSA9IHt9XG4gICAgICBpZiAodHlwZW9mIHJlY2VpdmVkQXRNcyA9PT0gXCJudW1iZXJcIikgZGF0YS5jaGlsZF9yZWNlaXZlZF9hdF9tcyA9IHJlY2VpdmVkQXRNc1xuICAgICAgaWYgKHR5cGVvZiBzdGFydGVkQXRNcyA9PT0gXCJudW1iZXJcIikgZGF0YS5jaGlsZF9zdGFydGVkX2F0X21zID0gc3RhcnRlZEF0TXNcbiAgICAgIGlmICh0eXBlb2YgY2hpbGRJbnN0YW5jZUlkID09PSBcInN0cmluZ1wiKSBkYXRhLmNoaWxkX2luc3RhbmNlX2lkID0gY2hpbGRJbnN0YW5jZUlkXG4gICAgICBpZiAodHlwZW9mIGNoaWxkUGlkID09PSBcIm51bWJlclwiKSBkYXRhLmNoaWxkX3BpZCA9IGNoaWxkUGlkXG4gICAgICBpZiAoT2JqZWN0LmtleXMoZGF0YSkubGVuZ3RoID09PSAwKSByZXR1cm4gZmFsc2VcblxuICAgICAgY29uc3QgYWZmZWN0ZWRSb3dzID0gYXdhaXQgdGhpcy5fdXBkYXRlQWZmZWN0ZWRSb3dzKGRiLCB7XG4gICAgICAgIGNvbmRpdGlvbnM6IHtoYW5kb2ZmX2lkOiBoYW5kb2ZmSWQsIGlkOiBqb2JJZCwgc3RhdHVzOiBcImhhbmRlZF9vZmZcIn0sXG4gICAgICAgIGRhdGEsXG4gICAgICAgIHRhYmxlTmFtZTogTE9DQUxfQkFDS0dST1VORF9KT0JTX1RBQkxFXG4gICAgICB9KVxuXG4gICAgICByZXR1cm4gYWZmZWN0ZWRSb3dzID09PSAxXG4gICAgfSkpXG4gIH1cblxuICAvKipcbiAgICogQXBwbGllcyBhIGZlbmNlZCByZXNjaGVkdWxlIHdpdGhvdXQgY29uc3VtaW5nIGFuIGF0dGVtcHQuXG4gICAqIEBwYXJhbSB7e2pvYklkOiBzdHJpbmcsIGhhbmRvZmZJZD86IHN0cmluZywgZGVsYXlNczogbnVtYmVyfX0gYXJncyAtIFJlc2NoZWR1bGUgcmVwb3J0LlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxib29sZWFuPn0gLSBXaGV0aGVyIHRoZSBsZWFzZSB3b24uXG4gICAqL1xuICBhc3luYyBtYXJrUmVzY2hlZHVsZWQoe2pvYklkLCBoYW5kb2ZmSWQsIGRlbGF5TXN9KSB7XG4gICAgYXdhaXQgdGhpcy5lbnN1cmVSZWFkeSgpXG5cbiAgICByZXR1cm4gYXdhaXQgdGhpcy5fd2l0aERiKGFzeW5jIChjb25uZWN0aW9uKSA9PiBhd2FpdCB0aGlzLl9tdXRhdGUoY29ubmVjdGlvbiwgYXN5bmMgKGRiKSA9PiB7XG4gICAgICBjb25zdCBqb2IgPSBhd2FpdCB0aGlzLl9nZXRKb2IoZGIsIGpvYklkKVxuXG4gICAgICBpZiAoIXRoaXMuX2FjY2VwdHNIYW5kb2ZmKGpvYiwgaGFuZG9mZklkKSkgcmV0dXJuIGZhbHNlXG4gICAgICBhd2FpdCB0aGlzLl9sb2NrQ29uY3VycmVuY3lSb3coZGIsIGpvYi5jb25jdXJyZW5jeUtleSlcblxuICAgICAgY29uc3QgYWZmZWN0ZWRSb3dzID0gYXdhaXQgdGhpcy5fdXBkYXRlQWZmZWN0ZWRSb3dzKGRiLCB7XG4gICAgICAgIGNvbmRpdGlvbnM6IHtoYW5kb2ZmX2lkOiBoYW5kb2ZmSWQsIGlkOiBqb2JJZCwgc3RhdHVzOiBcImhhbmRlZF9vZmZcIn0sXG4gICAgICAgIGRhdGE6IHtcbiAgICAgICAgICAuLi50aGlzLl9jbGVhcmVkQ2hpbGRBY2NlcHRhbmNlRGF0YSgpLFxuICAgICAgICAgIGhhbmRlZF9vZmZfYXRfbXM6IG51bGwsXG4gICAgICAgICAgaGFuZG9mZl9pZDogbnVsbCxcbiAgICAgICAgICBzY2hlZHVsZWRfYXRfbXM6IHJlc2NoZWR1bGVkQmFja2dyb3VuZEpvYkF0TXMoZGVsYXlNcywgdGhpcy5jbG9jay5ub3coKSksXG4gICAgICAgICAgc3RhdHVzOiBcInF1ZXVlZFwiLFxuICAgICAgICAgIHdvcmtlcl9pZDogbnVsbFxuICAgICAgICB9LFxuICAgICAgICB0YWJsZU5hbWU6IExPQ0FMX0JBQ0tHUk9VTkRfSk9CU19UQUJMRVxuICAgICAgfSlcblxuICAgICAgaWYgKGFmZmVjdGVkUm93cyAhPT0gMSkgcmV0dXJuIGZhbHNlXG4gICAgICBhd2FpdCB0aGlzLl9yZWxlYXNlQ29uY3VycmVuY3koZGIsIGpvYi5jb25jdXJyZW5jeUtleSlcbiAgICAgIHJldHVybiB0cnVlXG4gICAgfSkpXG4gIH1cblxuICAvKipcbiAgICogQXBwbGllcyBhIGZlbmNlZCBmYWlsdXJlLCByZXRyeSwgb3IgdGVybWluYWwgdHJhbnNpdGlvbi5cbiAgICogQHBhcmFtIHt7am9iSWQ6IHN0cmluZywgaGFuZG9mZklkPzogc3RyaW5nLCBlcnJvcjogUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59fSBhcmdzIC0gRmFpbHVyZSByZXBvcnQuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPGltcG9ydChcIi4vdHlwZXMuanNcIikuQmFja2dyb3VuZEpvYlJvdyB8IG51bGw+fSAtIEFjY2VwdGVkIHRyYW5zaXRpb24gc25hcHNob3QuXG4gICAqL1xuICBhc3luYyBtYXJrRmFpbGVkKHtqb2JJZCwgaGFuZG9mZklkLCBlcnJvcn0pIHtcbiAgICBhd2FpdCB0aGlzLmVuc3VyZVJlYWR5KClcblxuICAgIHJldHVybiBhd2FpdCB0aGlzLl93aXRoRGIoYXN5bmMgKGNvbm5lY3Rpb24pID0+IGF3YWl0IHRoaXMuX211dGF0ZShjb25uZWN0aW9uLCBhc3luYyAoZGIpID0+IHtcbiAgICAgIGNvbnN0IGpvYiA9IGF3YWl0IHRoaXMuX2dldEpvYihkYiwgam9iSWQpXG5cbiAgICAgIGlmICghdGhpcy5fYWNjZXB0c0hhbmRvZmYoam9iLCBoYW5kb2ZmSWQpKSByZXR1cm4gbnVsbFxuXG4gICAgICByZXR1cm4gYXdhaXQgdGhpcy5fYXBwbHlGYWlsdXJlKGRiLCBqb2IsIGVycm9yKVxuICAgIH0pKVxuICB9XG5cbiAgLyoqXG4gICAqIFR1cm5zIGV2ZXJ5IGFiYW5kb25lZCBsb2NhbCBoYW5kb2ZmIGludG8gdGhlIG5vcm1hbCBmYWlsdXJlL3JldHJ5IHBhdGguXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPGltcG9ydChcIi4vdHlwZXMuanNcIikuQmFja2dyb3VuZEpvYlJvd1tdPn0gLSBSZWNvdmVyZWQgdHJhbnNpdGlvbnMuXG4gICAqL1xuICBhc3luYyByZWNvdmVySGFuZGVkT2ZmSm9icygpIHtcbiAgICBhd2FpdCB0aGlzLmVuc3VyZVJlYWR5KClcblxuICAgIHJldHVybiBhd2FpdCB0aGlzLl93aXRoRGIoYXN5bmMgKGNvbm5lY3Rpb24pID0+IGF3YWl0IHRoaXMuX211dGF0ZShjb25uZWN0aW9uLCBhc3luYyAoZGIpID0+IHtcbiAgICAgIGNvbnN0IHF1ZXVlcyA9IHRoaXMuY29uZmlndXJhdGlvbi5nZXRCYWNrZ3JvdW5kSm9ic0NvbmZpZygpLnF1ZXVlc1xuICAgICAgY29uc3Qgcm93cyA9IGF3YWl0IGRiLm5ld1F1ZXJ5KCkuZnJvbShMT0NBTF9CQUNLR1JPVU5EX0pPQlNfVEFCTEUpLndoZXJlKHtzdGF0dXM6IFwiaGFuZGVkX29mZlwifSkucmVzdWx0cygpXG4gICAgICAvKiogQHR5cGUge2ltcG9ydChcIi4vdHlwZXMuanNcIikuQmFja2dyb3VuZEpvYlJvd1tdfSAqL1xuICAgICAgY29uc3QgcmVjb3ZlcmVkID0gW11cblxuICAgICAgZm9yIChjb25zdCByYXdSb3cgb2Ygcm93cykge1xuICAgICAgICBjb25zdCBqb2IgPSB0aGlzLl9ub3JtYWxpemVSb3cocmF3Um93KVxuICAgICAgICBjb25zdCB1cGRhdGVkID0gYXdhaXQgdGhpcy5fYXBwbHlGYWlsdXJlKGRiLCBqb2IsIG5ldyBFcnJvcihcIkxvY2FsIGJhY2tncm91bmQgam9iIHJlY292ZXJlZCBhZnRlciBhbiBpbnRlcnJ1cHRlZCBkaXNwYXRjaGVyXCIpKVxuXG4gICAgICAgIGlmICghdXBkYXRlZCkgY29udGludWVcblxuICAgICAgICBjb25zdCByZWNvbmNpbGVkID0gdXBkYXRlZC5zdGF0dXMgPT09IFwicXVldWVkXCJcbiAgICAgICAgICA/IGF3YWl0IHRoaXMuX3JlY29uY2lsZVF1ZXVlZEpvYkNvbmN1cnJlbmN5KGRiLCB1cGRhdGVkLCBxdWV1ZXMpXG4gICAgICAgICAgOiB1cGRhdGVkXG5cbiAgICAgICAgcmVjb3ZlcmVkLnB1c2gocmVjb25jaWxlZClcbiAgICAgIH1cblxuICAgICAgYXdhaXQgdGhpcy5fcmVidWlsZENvbmN1cnJlbmN5Q291bnRzKGRiKVxuICAgICAgcmV0dXJuIHJlY292ZXJlZFxuICAgIH0pKVxuICB9XG5cbiAgLyoqXG4gICAqIERlbGV0ZXMgbG9jYWwgcXVldWUgc3RhdGUgZm9yIGZvY3VzZWQgdGVzdHMuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIGFmdGVyIGRlbGV0aW9uLlxuICAgKi9cbiAgYXN5bmMgY2xlYXJBbGwoKSB7XG4gICAgYXdhaXQgdGhpcy5lbnN1cmVSZWFkeSgpXG4gICAgYXdhaXQgdGhpcy5fd2l0aERiKGFzeW5jIChjb25uZWN0aW9uKSA9PiBhd2FpdCB0aGlzLl9tdXRhdGUoY29ubmVjdGlvbiwgYXN5bmMgKGRiKSA9PiB7XG4gICAgICBhd2FpdCBkYi5xdWVyeShgREVMRVRFIEZST00gJHtkYi5xdW90ZVRhYmxlKExPQ0FMX0JBQ0tHUk9VTkRfSk9CU19UQUJMRSl9YClcbiAgICAgIGF3YWl0IGRiLnF1ZXJ5KGBERUxFVEUgRlJPTSAke2RiLnF1b3RlVGFibGUoTE9DQUxfQkFDS0dST1VORF9KT0JfQ09OQ1VSUkVOQ1lfVEFCTEUpfWApXG4gICAgfSkpXG4gIH1cblxuICAvKipcbiAgICogQXBwbGllcyB0aGUgY29tbW9uIHJldHJ5IG9yIGV4aGF1c3RlZCBmYWlsdXJlIHRyYW5zaXRpb24uXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vZGF0YWJhc2UvZHJpdmVycy9iYXNlLmpzXCIpLmRlZmF1bHR9IGRiIC0gTG9jYWwgU1FMaXRlIGNvbm5lY3Rpb24uXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi90eXBlcy5qc1wiKS5CYWNrZ3JvdW5kSm9iUm93fSBqb2IgLSBBY3RpdmUgaGFuZG9mZi5cbiAgICogQHBhcmFtIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gZXJyb3IgLSBQZXJmb3JtYW5jZSBlcnJvci5cbiAgICogQHJldHVybnMge1Byb21pc2U8aW1wb3J0KFwiLi90eXBlcy5qc1wiKS5CYWNrZ3JvdW5kSm9iUm93IHwgbnVsbD59IC0gVHJhbnNpdGlvbiBzbmFwc2hvdC5cbiAgICovXG4gIGFzeW5jIF9hcHBseUZhaWx1cmUoZGIsIGpvYiwgZXJyb3IpIHtcbiAgICBjb25zdCBhdHRlbXB0cyA9IChqb2IuYXR0ZW1wdHMgfHwgMCkgKyAxXG4gICAgY29uc3QgbWF4UmV0cmllcyA9IG5vcm1hbGl6ZUJhY2tncm91bmRKb2JNYXhSZXRyaWVzKGpvYi5tYXhSZXRyaWVzKVxuICAgIGNvbnN0IHdpbGxSZXRyeSA9IGF0dGVtcHRzIDw9IG1heFJldHJpZXNcbiAgICBjb25zdCBub3dNcyA9IHRoaXMuY2xvY2subm93KClcbiAgICAvKiogQHR5cGUge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gKi9cbiAgICBjb25zdCBkYXRhID0ge1xuICAgICAgYXR0ZW1wdHMsXG4gICAgICBoYW5kZWRfb2ZmX2F0X21zOiBudWxsLFxuICAgICAgaGFuZG9mZl9pZDogbnVsbCxcbiAgICAgIGxhc3RfZXJyb3I6IG5vcm1hbGl6ZUJhY2tncm91bmRKb2JFcnJvcihlcnJvciksXG4gICAgICBzdGF0dXM6IHdpbGxSZXRyeSA/IFwicXVldWVkXCIgOiBcImZhaWxlZFwiLFxuICAgICAgd29ya2VyX2lkOiBudWxsXG4gICAgfVxuXG4gICAgaWYgKHdpbGxSZXRyeSkge1xuICAgICAgLy8gQSByZXRyeSBzdGFydHMgYSBmcmVzaCBoYW5kb2ZmIHdpdGggYSBwb3NzaWJseSBkaWZmZXJlbnQgcnVubmVyLCBzbyB0aGVcbiAgICAgIC8vIHByZXZpb3VzIGNoaWxkJ3MgYWNjZXB0YW5jZSBldmlkZW5jZSBtdXN0IG5vdCBsZWFrIGludG8gdGhlIG5leHQgYXR0ZW1wdC5cbiAgICAgIE9iamVjdC5hc3NpZ24oZGF0YSwge3NjaGVkdWxlZF9hdF9tczogbm93TXMgKyByZXRyeURlbGF5TXMoYXR0ZW1wdHMpLCAuLi50aGlzLl9jbGVhcmVkQ2hpbGRBY2NlcHRhbmNlRGF0YSgpfSlcbiAgICB9IGVsc2Uge1xuICAgICAgT2JqZWN0LmFzc2lnbihkYXRhLCB7ZmFpbGVkX2F0X21zOiBub3dNc30pXG4gICAgfVxuXG4gICAgYXdhaXQgdGhpcy5fbG9ja0NvbmN1cnJlbmN5Um93KGRiLCBqb2IuY29uY3VycmVuY3lLZXkpXG4gICAgY29uc3QgYWZmZWN0ZWRSb3dzID0gYXdhaXQgdGhpcy5fdXBkYXRlQWZmZWN0ZWRSb3dzKGRiLCB7XG4gICAgICBjb25kaXRpb25zOiB7aGFuZG9mZl9pZDogam9iLmhhbmRvZmZJZCwgaWQ6IGpvYi5pZCwgc3RhdHVzOiBcImhhbmRlZF9vZmZcIn0sXG4gICAgICBkYXRhLFxuICAgICAgdGFibGVOYW1lOiBMT0NBTF9CQUNLR1JPVU5EX0pPQlNfVEFCTEVcbiAgICB9KVxuXG4gICAgaWYgKGFmZmVjdGVkUm93cyAhPT0gMSkgcmV0dXJuIG51bGxcbiAgICBhd2FpdCB0aGlzLl9yZWxlYXNlQ29uY3VycmVuY3koZGIsIGpvYi5jb25jdXJyZW5jeUtleSlcblxuICAgIHJldHVybiB7XG4gICAgICAuLi5qb2IsXG4gICAgICAuLi4od2lsbFJldHJ5ID8gdGhpcy5fY2xlYXJlZENoaWxkQWNjZXB0YW5jZVJvdygpIDoge30pLFxuICAgICAgYXR0ZW1wdHMsXG4gICAgICBmYWlsZWRBdE1zOiB3aWxsUmV0cnkgPyBqb2IuZmFpbGVkQXRNcyA6IG5vd01zLFxuICAgICAgaGFuZGVkT2ZmQXRNczogbnVsbCxcbiAgICAgIGhhbmRvZmZJZDogbnVsbCxcbiAgICAgIGxhc3RFcnJvcjogZGF0YS5sYXN0X2Vycm9yLFxuICAgICAgc2NoZWR1bGVkQXRNczogd2lsbFJldHJ5ID8gTnVtYmVyKGRhdGEuc2NoZWR1bGVkX2F0X21zKSA6IGpvYi5zY2hlZHVsZWRBdE1zLFxuICAgICAgc3RhdHVzOiBkYXRhLnN0YXR1cyxcbiAgICAgIHdvcmtlcklkOiBudWxsXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIFJldHVybnMgdGhlIGRhdGFiYXNlIGRhdGEgdGhhdCBjbGVhcnMgcG9vbGVkLWNoaWxkIGFjY2VwdGFuY2UgZXZpZGVuY2UuXG4gICAqIEByZXR1cm5zIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59IC0gQ2xlYXJlZCBhY2NlcHRhbmNlIGNvbHVtbnMuXG4gICAqL1xuICBfY2xlYXJlZENoaWxkQWNjZXB0YW5jZURhdGEoKSB7XG4gICAgcmV0dXJuIHtjaGlsZF9pbnN0YW5jZV9pZDogbnVsbCwgY2hpbGRfcGlkOiBudWxsLCBjaGlsZF9yZWNlaXZlZF9hdF9tczogbnVsbCwgY2hpbGRfc3RhcnRlZF9hdF9tczogbnVsbH1cbiAgfVxuXG4gIC8qKlxuICAgKiBSZXR1cm5zIHRoZSByb3ctc2hhcGUgY291bnRlcnBhcnQgb2YgdGhlIGNsZWFyZWQgYWNjZXB0YW5jZSBjb2x1bW5zLlxuICAgKiBAcmV0dXJucyB7UGljazxpbXBvcnQoXCIuL3R5cGVzLmpzXCIpLkJhY2tncm91bmRKb2JSb3csIFwiY2hpbGRJbnN0YW5jZUlkXCIgfCBcImNoaWxkUGlkXCIgfCBcImNoaWxkUmVjZWl2ZWRBdE1zXCIgfCBcImNoaWxkU3RhcnRlZEF0TXNcIj59IC0gQ2xlYXJlZCBhY2NlcHRhbmNlIGZpZWxkcy5cbiAgICovXG4gIF9jbGVhcmVkQ2hpbGRBY2NlcHRhbmNlUm93KCkge1xuICAgIHJldHVybiB7Y2hpbGRJbnN0YW5jZUlkOiBudWxsLCBjaGlsZFBpZDogbnVsbCwgY2hpbGRSZWNlaXZlZEF0TXM6IG51bGwsIGNoaWxkU3RhcnRlZEF0TXM6IG51bGx9XG4gIH1cblxuICAvKipcbiAgICogRW5zdXJlcyB0aGF0IGEgZHVyYWJsZSBjb25jdXJyZW5jeSBjb3VudGVyIGV4aXN0cyB3aXRoIHRoZSByZXF1aXJlZCBjYXAuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vZGF0YWJhc2UvZHJpdmVycy9iYXNlLmpzXCIpLmRlZmF1bHR9IGRiIC0gTG9jYWwgU1FMaXRlIGNvbm5lY3Rpb24uXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi90eXBlcy5qc1wiKS5SZXNvbHZlZEJhY2tncm91bmRKb2JDb25jdXJyZW5jeX0gY29uY3VycmVuY3kgLSBEZXNpcmVkIGNvdW50ZXIuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIHdoZW4gZW5zdXJlZC5cbiAgICovXG4gIGFzeW5jIF9lbnN1cmVDb25jdXJyZW5jeShkYiwgY29uY3VycmVuY3kpIHtcbiAgICBhd2FpdCBkYi51cHNlcnQoe1xuICAgICAgY29uZmxpY3RDb2x1bW5zOiBbXCJjb25jdXJyZW5jeV9rZXlcIl0sXG4gICAgICBkYXRhOiB7YWN0aXZlX2NvdW50OiAwLCBjb25jdXJyZW5jeV9rZXk6IGNvbmN1cnJlbmN5LmNvbmN1cnJlbmN5S2V5LCBtYXhfY29uY3VycmVuY3k6IGNvbmN1cnJlbmN5Lm1heENvbmN1cnJlbmN5fSxcbiAgICAgIHRhYmxlTmFtZTogTE9DQUxfQkFDS0dST1VORF9KT0JfQ09OQ1VSUkVOQ1lfVEFCTEUsXG4gICAgICB1cGRhdGVDb2x1bW5zOiBbXCJjb25jdXJyZW5jeV9rZXlcIl1cbiAgICB9KVxuXG4gICAgY29uc3Qgcm93cyA9IGF3YWl0IGRiXG4gICAgICAubmV3UXVlcnkoKVxuICAgICAgLmZyb20oTE9DQUxfQkFDS0dST1VORF9KT0JfQ09OQ1VSUkVOQ1lfVEFCTEUpXG4gICAgICAud2hlcmUoe2NvbmN1cnJlbmN5X2tleTogY29uY3VycmVuY3kuY29uY3VycmVuY3lLZXl9KVxuICAgICAgLmxpbWl0KDEpXG4gICAgICAucmVzdWx0cygpXG5cbiAgICBjb25zdCBleGlzdGluZ1JvdyA9IC8qKiBAdHlwZSB7e21heF9jb25jdXJyZW5jeTogbnVtYmVyIHwgc3RyaW5nfX0gKi8gKHJvd3NbMF0pXG4gICAgY29uc3QgZXhpc3RpbmdDYXAgPSBOdW1iZXIoZXhpc3RpbmdSb3cubWF4X2NvbmN1cnJlbmN5KVxuXG4gICAgaWYgKGV4aXN0aW5nQ2FwID09PSBjb25jdXJyZW5jeS5tYXhDb25jdXJyZW5jeSkgcmV0dXJuXG4gICAgaWYgKCFjb25jdXJyZW5jeS5xdWV1ZURlcml2ZWQpIHRocm93IG5ldyBFcnJvcihgQ29uZmxpY3RpbmcgbWF4Q29uY3VycmVuY3kgZm9yIGJhY2tncm91bmQgam9iIGNvbmN1cnJlbmN5S2V5OiAke2NvbmN1cnJlbmN5LmNvbmN1cnJlbmN5S2V5fWApXG5cbiAgICBhd2FpdCBkYi51cGRhdGUoe1xuICAgICAgY29uZGl0aW9uczoge2NvbmN1cnJlbmN5X2tleTogY29uY3VycmVuY3kuY29uY3VycmVuY3lLZXl9LFxuICAgICAgZGF0YToge21heF9jb25jdXJyZW5jeTogY29uY3VycmVuY3kubWF4Q29uY3VycmVuY3l9LFxuICAgICAgdGFibGVOYW1lOiBMT0NBTF9CQUNLR1JPVU5EX0pPQl9DT05DVVJSRU5DWV9UQUJMRVxuICAgIH0pXG4gIH1cblxuICAvKipcbiAgICogQXRvbWljYWxseSByZXNlcnZlcyBvbmUgc2xvdCBmb3IgYSBjb25jdXJyZW5jeSBrZXkuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vZGF0YWJhc2UvZHJpdmVycy9iYXNlLmpzXCIpLmRlZmF1bHR9IGRiIC0gQ29ubmVjdGlvbi5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGNvbmN1cnJlbmN5S2V5IC0gQ29uY3VycmVuY3kga2V5LlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxib29sZWFuPn0gLSBXaGV0aGVyIGEgc2xvdCB3YXMgcmVzZXJ2ZWQuXG4gICAqL1xuICBhc3luYyBfcmVzZXJ2ZUNvbmN1cnJlbmN5KGRiLCBjb25jdXJyZW5jeUtleSkge1xuICAgIGNvbnN0IHRhYmxlID0gZGIucXVvdGVUYWJsZShMT0NBTF9CQUNLR1JPVU5EX0pPQl9DT05DVVJSRU5DWV9UQUJMRSlcbiAgICBjb25zdCBjb3VudCA9IGRiLnF1b3RlQ29sdW1uKFwiYWN0aXZlX2NvdW50XCIpXG4gICAgY29uc3QgYWZmZWN0ZWRSb3dzID0gYXdhaXQgZGIuYWZmZWN0ZWRSb3dzKFxuICAgICAgYFVQREFURSAke3RhYmxlfSBTRVQgJHtjb3VudH0gPSAke2NvdW50fSArIDEgYCArXG4gICAgICBgV0hFUkUgJHtkYi5xdW90ZUNvbHVtbihcImNvbmN1cnJlbmN5X2tleVwiKX0gPSAke2RiLnF1b3RlKGNvbmN1cnJlbmN5S2V5KX0gYCArXG4gICAgICBgQU5EICR7Y291bnR9IDwgJHtkYi5xdW90ZUNvbHVtbihcIm1heF9jb25jdXJyZW5jeVwiKX1gXG4gICAgKVxuXG4gICAgcmV0dXJuIGFmZmVjdGVkUm93cyA9PT0gMVxuICB9XG5cbiAgLyoqXG4gICAqIFJlbGVhc2VzIG9uZSBzbG90IGZvciBhIGNvbmN1cnJlbmN5IGtleS5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9kYXRhYmFzZS9kcml2ZXJzL2Jhc2UuanNcIikuZGVmYXVsdH0gZGIgLSBDb25uZWN0aW9uLlxuICAgKiBAcGFyYW0ge3N0cmluZyB8IG51bGx9IGNvbmN1cnJlbmN5S2V5IC0gQ29uY3VycmVuY3kga2V5LlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyBhZnRlciByZWxlYXNlLlxuICAgKi9cbiAgYXN5bmMgX3JlbGVhc2VDb25jdXJyZW5jeShkYiwgY29uY3VycmVuY3lLZXkpIHtcbiAgICBpZiAoIWNvbmN1cnJlbmN5S2V5KSByZXR1cm5cblxuICAgIGNvbnN0IHRhYmxlID0gZGIucXVvdGVUYWJsZShMT0NBTF9CQUNLR1JPVU5EX0pPQl9DT05DVVJSRU5DWV9UQUJMRSlcbiAgICBjb25zdCBjb3VudCA9IGRiLnF1b3RlQ29sdW1uKFwiYWN0aXZlX2NvdW50XCIpXG5cbiAgICBhd2FpdCBkYi5hZmZlY3RlZFJvd3MoXG4gICAgICBgVVBEQVRFICR7dGFibGV9IFNFVCAke2NvdW50fSA9ICR7Y291bnR9IC0gMSBgICtcbiAgICAgIGBXSEVSRSAke2RiLnF1b3RlQ29sdW1uKFwiY29uY3VycmVuY3lfa2V5XCIpfSA9ICR7ZGIucXVvdGUoY29uY3VycmVuY3lLZXkpfSBBTkQgJHtjb3VudH0gPiAwYFxuICAgIClcbiAgfVxuXG4gIC8qKlxuICAgKiBBY3F1aXJlcyB0aGUgdHJhbnNhY3Rpb24ncyB3cml0ZSBsb2NrIGZvciBhIGNvbmN1cnJlbmN5IGNvdW50ZXIgcm93LlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL2RhdGFiYXNlL2RyaXZlcnMvYmFzZS5qc1wiKS5kZWZhdWx0fSBkYiAtIENvbm5lY3Rpb24uXG4gICAqIEBwYXJhbSB7c3RyaW5nIHwgbnVsbH0gY29uY3VycmVuY3lLZXkgLSBDb25jdXJyZW5jeSBrZXkuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIGFmdGVyIGxvY2tpbmcuXG4gICAqL1xuICBhc3luYyBfbG9ja0NvbmN1cnJlbmN5Um93KGRiLCBjb25jdXJyZW5jeUtleSkge1xuICAgIGlmICghY29uY3VycmVuY3lLZXkpIHJldHVyblxuXG4gICAgY29uc3QgdGFibGUgPSBkYi5xdW90ZVRhYmxlKExPQ0FMX0JBQ0tHUk9VTkRfSk9CX0NPTkNVUlJFTkNZX1RBQkxFKVxuICAgIGNvbnN0IGNvdW50ID0gZGIucXVvdGVDb2x1bW4oXCJhY3RpdmVfY291bnRcIilcblxuICAgIGF3YWl0IGRiLnF1ZXJ5KFxuICAgICAgYFVQREFURSAke3RhYmxlfSBTRVQgJHtjb3VudH0gPSAke2NvdW50fSBgICtcbiAgICAgIGBXSEVSRSAke2RiLnF1b3RlQ29sdW1uKFwiY29uY3VycmVuY3lfa2V5XCIpfSA9ICR7ZGIucXVvdGUoY29uY3VycmVuY3lLZXkpfWBcbiAgICApXG4gIH1cblxuICAvKipcbiAgICogUmVidWlsZHMgYWN0aXZlIGNvdW50ZXJzIGZyb20gZHVyYWJsZSBoYW5kZWQtb2ZmIGpvYnMuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vZGF0YWJhc2UvZHJpdmVycy9iYXNlLmpzXCIpLmRlZmF1bHR9IGRiIC0gQ29ubmVjdGlvbi5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgYWZ0ZXIgY291bnRlciByZWJ1aWxkLlxuICAgKi9cbiAgYXN5bmMgX3JlYnVpbGRDb25jdXJyZW5jeUNvdW50cyhkYikge1xuICAgIGNvbnN0IGNvbmN1cnJlbmN5VGFibGUgPSBkYi5xdW90ZVRhYmxlKExPQ0FMX0JBQ0tHUk9VTkRfSk9CX0NPTkNVUlJFTkNZX1RBQkxFKVxuICAgIGNvbnN0IGpvYnNUYWJsZSA9IGRiLnF1b3RlVGFibGUoTE9DQUxfQkFDS0dST1VORF9KT0JTX1RBQkxFKVxuXG4gICAgYXdhaXQgZGIucXVlcnkoXG4gICAgICBgVVBEQVRFICR7Y29uY3VycmVuY3lUYWJsZX0gU0VUICR7ZGIucXVvdGVDb2x1bW4oXCJhY3RpdmVfY291bnRcIil9ID0gKGAgK1xuICAgICAgYFNFTEVDVCBDT1VOVCgqKSBGUk9NICR7am9ic1RhYmxlfSBXSEVSRSAke2pvYnNUYWJsZX0uJHtkYi5xdW90ZUNvbHVtbihcInN0YXR1c1wiKX0gPSAke2RiLnF1b3RlKFwiaGFuZGVkX29mZlwiKX0gQU5EIGAgK1xuICAgICAgYCR7am9ic1RhYmxlfS4ke2RiLnF1b3RlQ29sdW1uKFwiY29uY3VycmVuY3lfa2V5XCIpfSA9ICR7Y29uY3VycmVuY3lUYWJsZX0uJHtkYi5xdW90ZUNvbHVtbihcImNvbmN1cnJlbmN5X2tleVwiKX0pYFxuICAgIClcbiAgfVxuXG4gIC8qKlxuICAgKiBCdWlsZHMgdGhlIGNvbmZpZ3VyZWQgcXVldWUtcHJpb3JpdHkgb3JkZXJpbmcgZXhwcmVzc2lvbi5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9kYXRhYmFzZS9kcml2ZXJzL2Jhc2UuanNcIikuZGVmYXVsdH0gZGIgLSBDb25uZWN0aW9uLlxuICAgKiBAcmV0dXJucyB7c3RyaW5nIHwgbnVsbH0gLSBRdWV1ZSBwcmlvcml0eSBleHByZXNzaW9uLlxuICAgKi9cbiAgX3F1ZXVlUHJpb3JpdHlPcmRlclNxbChkYikge1xuICAgIGNvbnN0IHF1ZXVlcyA9IHRoaXMuY29uZmlndXJhdGlvbi5nZXRCYWNrZ3JvdW5kSm9ic0NvbmZpZygpLnF1ZXVlc1xuICAgIGNvbnN0IHByaW9yaXRpemVkID0gT2JqZWN0LmVudHJpZXMocXVldWVzKVxuICAgICAgLmZpbHRlcigoWywgcXVldWVdKSA9PiBOdW1iZXIuaXNGaW5pdGUocXVldWU/LnByaW9yaXR5KSAmJiBOdW1iZXIocXVldWUucHJpb3JpdHkpICE9PSAwKVxuICAgICAgLm1hcCgoW3F1ZXVlTmFtZSwgcXVldWVdKSA9PiBbcXVldWVOYW1lLCBOdW1iZXIocXVldWUucHJpb3JpdHkpXSlcblxuICAgIGlmIChwcmlvcml0aXplZC5sZW5ndGggPT09IDApIHJldHVybiBudWxsXG5cbiAgICBjb25zdCB3aGVucyA9IHByaW9yaXRpemVkXG4gICAgICAubWFwKChbcXVldWUsIHByaW9yaXR5XSkgPT4gYFdIRU4gJHtkYi5xdW90ZShxdWV1ZSl9IFRIRU4gJHtwcmlvcml0eX1gKVxuICAgICAgLmpvaW4oXCIgXCIpXG5cbiAgICByZXR1cm4gYENBU0UgQ09BTEVTQ0UoJHtkYi5xdW90ZUNvbHVtbihcInF1ZXVlXCIpfSwgJHtkYi5xdW90ZShERUZBVUxUX0JBQ0tHUk9VTkRfSk9CX1FVRVVFKX0pICR7d2hlbnN9IEVMU0UgMCBFTkRgXG4gIH1cblxuICAvKipcbiAgICogQ2hlY2tzIHdoZXRoZXIgYSBwZXJzaXN0ZWQgaGFuZG9mZiBvd25zIHRoZSBzdXBwbGllZCBhY2tub3dsZWRnZW1lbnQgZmVuY2UuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi90eXBlcy5qc1wiKS5CYWNrZ3JvdW5kSm9iUm93IHwgbnVsbH0gam9iIC0gUGVyc2lzdGVkIGpvYi5cbiAgICogQHBhcmFtIHtzdHJpbmcgfCB1bmRlZmluZWR9IGhhbmRvZmZJZCAtIEhhbmRvZmYgZmVuY2UuXG4gICAqIEByZXR1cm5zIHtqb2IgaXMgaW1wb3J0KFwiLi90eXBlcy5qc1wiKS5CYWNrZ3JvdW5kSm9iUm93fSAtIFdoZXRoZXIgYWNjZXB0ZWQuXG4gICAqL1xuICBfYWNjZXB0c0hhbmRvZmYoam9iLCBoYW5kb2ZmSWQpIHtcbiAgICByZXR1cm4gQm9vbGVhbihqb2IgJiYgam9iLnN0YXR1cyA9PT0gXCJoYW5kZWRfb2ZmXCIgJiYgam9iLmhhbmRvZmZJZCAmJiBqb2IuaGFuZG9mZklkID09PSBoYW5kb2ZmSWQpXG4gIH1cblxuICAvKipcbiAgICogRmluZHMgYSBwZXJzaXN0ZWQgbG9jYWwgam9iIHVzaW5nIHRoZSBjdXJyZW50IGNvbm5lY3Rpb24uXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vZGF0YWJhc2UvZHJpdmVycy9iYXNlLmpzXCIpLmRlZmF1bHR9IGRiIC0gQ29ubmVjdGlvbi5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGpvYklkIC0gSm9iIGlkLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxpbXBvcnQoXCIuL3R5cGVzLmpzXCIpLkJhY2tncm91bmRKb2JSb3cgfCBudWxsPn0gLSBQZXJzaXN0ZWQgcm93LlxuICAgKi9cbiAgYXN5bmMgX2dldEpvYihkYiwgam9iSWQpIHtcbiAgICBjb25zdCByb3dzID0gYXdhaXQgZGIubmV3UXVlcnkoKS5mcm9tKExPQ0FMX0JBQ0tHUk9VTkRfSk9CU19UQUJMRSkud2hlcmUoe2lkOiBqb2JJZH0pLmxpbWl0KDEpLnJlc3VsdHMoKVxuXG4gICAgcmV0dXJuIHJvd3NbMF0gPyB0aGlzLl9ub3JtYWxpemVSb3cocm93c1swXSkgOiBudWxsXG4gIH1cblxuICAvKipcbiAgICogTm9ybWFsaXplcyBvbmUgcmF3IGxvY2FsIGRhdGFiYXNlIHJvdy5cbiAgICogQHBhcmFtIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59IHJvdyAtIFJhdyByb3cuXG4gICAqIEByZXR1cm5zIHtpbXBvcnQoXCIuL3R5cGVzLmpzXCIpLkJhY2tncm91bmRKb2JSb3d9IC0gTm9ybWFsaXplZCByb3cuXG4gICAqL1xuICBfbm9ybWFsaXplUm93KHJvdykge1xuICAgIGNvbnN0IHBhcnNlZEFyZ3MgPSBKU09OLnBhcnNlKFN0cmluZyhyb3cuYXJnc19qc29uKSlcbiAgICBjb25zdCBleGVjdXRpb25Nb2RlID0gbm9ybWFsaXplQmFja2dyb3VuZEpvYkV4ZWN1dGlvbk1vZGUoe2V4ZWN1dGlvbk1vZGU6IFN0cmluZyhyb3cuZXhlY3V0aW9uX21vZGUpfSwgXCJpbmxpbmVcIiwgTE9DQUxfRVhFQ1VUSU9OX01PREVTKVxuXG4gICAgaWYgKCFBcnJheS5pc0FycmF5KHBhcnNlZEFyZ3MpKSB0aHJvdyBuZXcgRXJyb3IoYEludmFsaWQgbG9jYWwgYmFja2dyb3VuZCBqb2IgYXJnc19qc29uIGZvciBqb2I6ICR7U3RyaW5nKHJvdy5pZCl9YClcbiAgICBpZiAoZXhlY3V0aW9uTW9kZSAhPT0gXCJpbmxpbmVcIikgdGhyb3cgbmV3IEVycm9yKFwiTG9jYWwgYmFja2dyb3VuZCBqb2IgZXhlY3V0aW9uIG1vZGUgaW52YXJpYW50IHdhcyB2aW9sYXRlZFwiKVxuXG4gICAgcmV0dXJuIHtcbiAgICAgIGFyZ3M6IHBhcnNlZEFyZ3MsXG4gICAgICBhdHRlbXB0czogdGhpcy5fbnVtYmVyT3JOdWxsKHJvdy5hdHRlbXB0cyksXG4gICAgICBjaGlsZEluc3RhbmNlSWQ6IHJvdy5jaGlsZF9pbnN0YW5jZV9pZCA9PT0gbnVsbCB8fCByb3cuY2hpbGRfaW5zdGFuY2VfaWQgPT09IHVuZGVmaW5lZCA/IG51bGwgOiBTdHJpbmcocm93LmNoaWxkX2luc3RhbmNlX2lkKSxcbiAgICAgIGNoaWxkUGlkOiB0aGlzLl9udW1iZXJPck51bGwocm93LmNoaWxkX3BpZCksXG4gICAgICBjaGlsZFJlY2VpdmVkQXRNczogdGhpcy5fbnVtYmVyT3JOdWxsKHJvdy5jaGlsZF9yZWNlaXZlZF9hdF9tcyksXG4gICAgICBjaGlsZFN0YXJ0ZWRBdE1zOiB0aGlzLl9udW1iZXJPck51bGwocm93LmNoaWxkX3N0YXJ0ZWRfYXRfbXMpLFxuICAgICAgY29tcGxldGVkQXRNczogdGhpcy5fbnVtYmVyT3JOdWxsKHJvdy5jb21wbGV0ZWRfYXRfbXMpLFxuICAgICAgY29uY3VycmVuY3lLZXk6IHJvdy5jb25jdXJyZW5jeV9rZXkgPT09IG51bGwgfHwgcm93LmNvbmN1cnJlbmN5X2tleSA9PT0gdW5kZWZpbmVkID8gbnVsbCA6IFN0cmluZyhyb3cuY29uY3VycmVuY3lfa2V5KSxcbiAgICAgIGNyZWF0ZWRBdE1zOiB0aGlzLl9udW1iZXJPck51bGwocm93LmNyZWF0ZWRfYXRfbXMpLFxuICAgICAgZXhlY3V0aW9uTW9kZSxcbiAgICAgIGZhaWxlZEF0TXM6IHRoaXMuX251bWJlck9yTnVsbChyb3cuZmFpbGVkX2F0X21zKSxcbiAgICAgIGhhbmRlZE9mZkF0TXM6IHRoaXMuX251bWJlck9yTnVsbChyb3cuaGFuZGVkX29mZl9hdF9tcyksXG4gICAgICBoYW5kb2ZmSWQ6IHJvdy5oYW5kb2ZmX2lkID09PSBudWxsIHx8IHJvdy5oYW5kb2ZmX2lkID09PSB1bmRlZmluZWQgPyBudWxsIDogU3RyaW5nKHJvdy5oYW5kb2ZmX2lkKSxcbiAgICAgIGlkOiBTdHJpbmcocm93LmlkKSxcbiAgICAgIGpvYk5hbWU6IFN0cmluZyhyb3cuam9iX25hbWUpLFxuICAgICAgbGFzdEVycm9yOiByb3cubGFzdF9lcnJvciA9PT0gbnVsbCB8fCByb3cubGFzdF9lcnJvciA9PT0gdW5kZWZpbmVkID8gbnVsbCA6IFN0cmluZyhyb3cubGFzdF9lcnJvciksXG4gICAgICBtYXhDb25jdXJyZW5jeTogdGhpcy5fbnVtYmVyT3JOdWxsKHJvdy5tYXhfY29uY3VycmVuY3kpLFxuICAgICAgbWF4UmV0cmllczogdGhpcy5fbnVtYmVyT3JOdWxsKHJvdy5tYXhfcmV0cmllcyksXG4gICAgICBvcnBoYW5lZEF0TXM6IG51bGwsXG4gICAgICBxdWV1ZTogcm93LnF1ZXVlID8gU3RyaW5nKHJvdy5xdWV1ZSkgOiBERUZBVUxUX0JBQ0tHUk9VTkRfSk9CX1FVRVVFLFxuICAgICAgc2NoZWR1bGVLZXk6IG51bGwsXG4gICAgICBzY2hlZHVsZWRBdE1zOiB0aGlzLl9udW1iZXJPck51bGwocm93LnNjaGVkdWxlZF9hdF9tcyksXG4gICAgICBzdGF0dXM6IHJvdy5zdGF0dXMgPyBTdHJpbmcocm93LnN0YXR1cykgOiBcInF1ZXVlZFwiLFxuICAgICAgdGltZW91dE1zOiBudWxsLFxuICAgICAgd29ya2VySWQ6IHJvdy53b3JrZXJfaWQgPT09IG51bGwgfHwgcm93Lndvcmtlcl9pZCA9PT0gdW5kZWZpbmVkID8gbnVsbCA6IFN0cmluZyhyb3cud29ya2VyX2lkKVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBOb3JtYWxpemVzIG9uZSBudWxsYWJsZSBkYXRhYmFzZSBudW1iZXIuXG4gICAqIEBwYXJhbSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59IHZhbHVlIC0gRGF0YWJhc2UgbnVtYmVyLlxuICAgKiBAcmV0dXJucyB7bnVtYmVyIHwgbnVsbH0gLSBOb3JtYWxpemVkIG51bWJlci5cbiAgICovXG4gIF9udW1iZXJPck51bGwodmFsdWUpIHtcbiAgICBpZiAodmFsdWUgPT09IG51bGwgfHwgdmFsdWUgPT09IHVuZGVmaW5lZCB8fCB2YWx1ZSA9PT0gXCJcIikgcmV0dXJuIG51bGxcblxuICAgIGNvbnN0IG51bWJlciA9IE51bWJlcih2YWx1ZSlcblxuICAgIHJldHVybiBOdW1iZXIuaXNOYU4obnVtYmVyKSA/IG51bGwgOiBudW1iZXJcbiAgfVxuXG4gIC8qKlxuICAgKiBFeGVjdXRlcyBhIHN0cnVjdHVyZWQgdXBkYXRlIGFuZCByZXBvcnRzIGl0cyBhZmZlY3RlZC1yb3cgY291bnQuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vZGF0YWJhc2UvZHJpdmVycy9iYXNlLmpzXCIpLmRlZmF1bHR9IGRiIC0gQ29ubmVjdGlvbi5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9kYXRhYmFzZS9kcml2ZXJzL2Jhc2UuanNcIikuVXBkYXRlU3FsQXJnc1R5cGV9IGFyZ3MgLSBVcGRhdGUgYXJndW1lbnRzLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxudW1iZXI+fSAtIEFmZmVjdGVkIHJvd3MuXG4gICAqL1xuICBhc3luYyBfdXBkYXRlQWZmZWN0ZWRSb3dzKGRiLCBhcmdzKSB7IHJldHVybiBhd2FpdCBkYi5hZmZlY3RlZFJvd3MoZGIudXBkYXRlU3FsKGFyZ3MpKSB9XG5cbiAgLyoqXG4gICAqIEpvaW5zIGFuIGFtYmllbnQgYXBwIHRyYW5zYWN0aW9uIG9yIHVzZXMgdGhlIGRhdGFiYXNlJ3Mgc2NvcGVkIG9wZXJhdGlvbiBsZWFzZS5cbiAgICogQHRlbXBsYXRlIFRcbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9kYXRhYmFzZS9kcml2ZXJzL2Jhc2UuanNcIikuZGVmYXVsdH0gZGIgLSBDb25uZWN0aW9uLlxuICAgKiBAcGFyYW0geyhkYjogaW1wb3J0KFwiLi4vZGF0YWJhc2UvZHJpdmVycy9iYXNlLmpzXCIpLmRlZmF1bHQpID0+IFByb21pc2U8VD59IGNhbGxiYWNrIC0gTXV0YXRpb24uXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPFQ+fSAtIE11dGF0aW9uIHJlc3VsdC5cbiAgICovXG4gIGFzeW5jIF9tdXRhdGUoZGIsIGNhbGxiYWNrKSB7XG4gICAgaWYgKGRiLmluc2lkZVRyYW5zYWN0aW9uKCkpIHJldHVybiBhd2FpdCB0aGlzLl90cmFuc2FjdGlvblJlc3VsdChkYiwgYXN5bmMgKCkgPT4gYXdhaXQgY2FsbGJhY2soZGIpKVxuXG4gICAgcmV0dXJuIGF3YWl0IHRoaXMuY29uZmlndXJhdGlvbi53aXRoVHJhbnNhY3Rpb24oe1xuICAgICAgZGF0YWJhc2VJZGVudGlmaWVyOiB0aGlzLmdldERhdGFiYXNlSWRlbnRpZmllcigpLFxuICAgICAgbmFtZTogXCJMb2NhbCBiYWNrZ3JvdW5kIGpvYnMgbXV0YXRpb25cIlxuICAgIH0sIGFzeW5jIChvcGVyYXRpb24pID0+IGF3YWl0IGNhbGxiYWNrKG9wZXJhdGlvbi5jb25uZWN0aW9uKCkpKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgYSBjYWxsYmFjayBpbiBhIHRyYW5zYWN0aW9uIGFuZCByZXR1cm5zIGl0cyBjYXB0dXJlZCByZXN1bHQuXG4gICAqIEB0ZW1wbGF0ZSBUXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vZGF0YWJhc2UvZHJpdmVycy9iYXNlLmpzXCIpLmRlZmF1bHR9IGRiIC0gQ29ubmVjdGlvbi5cbiAgICogQHBhcmFtIHsoKSA9PiBQcm9taXNlPFQ+fSBjYWxsYmFjayAtIFRyYW5zYWN0aW9uIGNhbGxiYWNrLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxUPn0gLSBDYWxsYmFjayByZXN1bHQuXG4gICAqL1xuICBhc3luYyBfdHJhbnNhY3Rpb25SZXN1bHQoZGIsIGNhbGxiYWNrKSB7XG4gICAgbGV0IGNvbXBsZXRlZCA9IGZhbHNlXG4gICAgLyoqIEB0eXBlIHtUIHwgdW5kZWZpbmVkfSAqL1xuICAgIGxldCByZXN1bHRcblxuICAgIGF3YWl0IGRiLnRyYW5zYWN0aW9uKGFzeW5jICgpID0+IHtcbiAgICAgIHJlc3VsdCA9IGF3YWl0IGNhbGxiYWNrKClcbiAgICAgIGNvbXBsZXRlZCA9IHRydWVcbiAgICB9KVxuXG4gICAgaWYgKCFjb21wbGV0ZWQpIHRocm93IG5ldyBFcnJvcihcIkxvY2FsIGJhY2tncm91bmQgam9icyB0cmFuc2FjdGlvbiBjYWxsYmFjayB3YXMgbm90IGludm9rZWRcIilcbiAgICByZXR1cm4gLyoqIEB0eXBlIHtUfSAqLyAocmVzdWx0KVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgYSBjYWxsYmFjayB3aXRoIHRoZSBjb25maWd1cmVkIGxvY2FsIGRhdGFiYXNlIGNvbm5lY3Rpb24uXG4gICAqIEB0ZW1wbGF0ZSBUXG4gICAqIEBwYXJhbSB7KGRiOiBpbXBvcnQoXCIuLi9kYXRhYmFzZS9kcml2ZXJzL2Jhc2UuanNcIikuZGVmYXVsdCkgPT4gUHJvbWlzZTxUPn0gY2FsbGJhY2sgLSBDb25uZWN0aW9uIGNhbGxiYWNrLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxUPn0gLSBDYWxsYmFjayByZXN1bHQuXG4gICAqL1xuICBhc3luYyBfd2l0aERiKGNhbGxiYWNrKSB7XG4gICAgY29uc3QgZGF0YWJhc2VJZGVudGlmaWVyID0gdGhpcy5nZXREYXRhYmFzZUlkZW50aWZpZXIoKVxuXG4gICAgcmV0dXJuIGF3YWl0IHRoaXMuY29uZmlndXJhdGlvbi5lbnN1cmVDb25uZWN0aW9ucyh7ZGF0YWJhc2VJZGVudGlmaWVyczogW2RhdGFiYXNlSWRlbnRpZmllcl0sIG5hbWU6IFwiTG9jYWwgYmFja2dyb3VuZCBqb2JzIHN0b3JlXCJ9LCBhc3luYyAoZGJzKSA9PiB7XG4gICAgICBjb25zdCBkYiA9IGRic1tkYXRhYmFzZUlkZW50aWZpZXJdXG5cbiAgICAgIGlmICghZGIpIHRocm93IG5ldyBFcnJvcihgTm8gbG9jYWwgYmFja2dyb3VuZC1qb2JzIGRhdGFiYXNlIGNvbm5lY3Rpb24gYXZhaWxhYmxlIGZvciBpZGVudGlmaWVyOiAke2RhdGFiYXNlSWRlbnRpZmllcn1gKVxuXG4gICAgICByZXR1cm4gYXdhaXQgY2FsbGJhY2soZGIpXG4gICAgfSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSZXBvcnRzIGFuIHVuZXhwZWN0ZWQgbG9jYWwtc3RvcmUgZmFpbHVyZSB0aHJvdWdoIGZyYW1ld29yayBjaGFubmVscy5cbiAgICogQHBhcmFtIHt7ZXJyb3I6IEVycm9yLCBzdGFnZTogc3RyaW5nfX0gYXJncyAtIEVycm9yIHJlcG9ydC5cbiAgICogQHJldHVybnMge3ZvaWR9IC0gTm8gcmV0dXJuIHZhbHVlLlxuICAgKi9cbiAgX3JlcG9ydEZyYW1ld29ya0Vycm9yKHtlcnJvciwgc3RhZ2V9KSB7XG4gICAgY29uc3QgcGF5bG9hZCA9IHtjb250ZXh0OiB7c3RhZ2V9LCBlcnJvcn1cbiAgICBjb25zdCBlcnJvckV2ZW50cyA9IHRoaXMuY29uZmlndXJhdGlvbi5nZXRFcnJvckV2ZW50cygpXG5cbiAgICBlcnJvckV2ZW50cy5lbWl0KFwiZnJhbWV3b3JrLWVycm9yXCIsIHBheWxvYWQpXG4gICAgZXJyb3JFdmVudHMuZW1pdChcImFsbC1lcnJvclwiLCB7Li4ucGF5bG9hZCwgZXJyb3JUeXBlOiBcImZyYW1ld29yay1lcnJvclwifSlcbiAgfVxufVxuIl19