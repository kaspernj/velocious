// @ts-check
import UUID from "pure-uuid";
import TableData from "../database/table-data/index.js";
import TableIndex from "../database/table-data/table-index.js";
import sha256Hex from "../utils/sha256-hex.js";
import VelociousError from "../velocious-error.js";
import normalizeBackgroundJobError from "./normalize-error.js";
import { BACKGROUND_JOB_TERMINAL_STATUSES, DEFAULT_BACKGROUND_JOB_QUEUE, QUEUE_CONCURRENCY_KEY_PREFIX, normalizeBackgroundJobConcurrency, normalizeBackgroundJobExecutionMode, normalizeBackgroundJobMaxRetries, normalizeBackgroundJobQueue, normalizeBackgroundJobScheduleKey, normalizeBackgroundJobScheduledAtMs, normalizeBackgroundJobStatus, rescheduledBackgroundJobAtMs, retryDelayMs } from "./job-semantics.js";
export const LOCAL_BACKGROUND_JOBS_TABLE = "velocious_local_background_jobs";
export const LOCAL_BACKGROUND_JOB_CONCURRENCY_TABLE = "velocious_local_background_job_concurrency";
export const LOCAL_BACKGROUND_JOB_SCHEDULE_KEYS_TABLE = "velocious_local_background_job_schedule_keys";
const MIGRATIONS_TABLE = "velocious_internal_migrations";
const MIGRATION_SCOPE = "local_background_jobs";
const MIGRATION_VERSIONS = ["1", "2", "3"];
const LOCAL_EXECUTION_MODES = [/** @type {const} */ ("inline")];
export const LOCAL_BACKGROUND_JOBS_INDEX_NAMES = [
    "index_velocious_local_background_jobs_due",
    "index_velocious_local_background_jobs_queue_status",
    "index_velocious_local_background_jobs_deduplication",
    "index_velocious_local_background_jobs_concurrency",
    "index_velocious_local_background_jobs_schedule_history",
    "index_velocious_local_background_jobs_schedule_order"
];
export const LOCAL_BACKGROUND_JOB_SCHEDULE_KEYS_INDEX_NAMES = ["index_velocious_local_background_job_schedule_keys_job"];
const EXPECTED_JOB_COLUMNS = [
    "id",
    "job_name",
    "args_json",
    "args_digest",
    "execution_mode",
    "queue",
    "schedule_key",
    "schedule_order",
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
const EXPECTED_SCHEDULE_KEY_COLUMNS = ["schedule_key", "job_id"];
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
     * Creates or upgrades the versioned local tables and indexes without
     * rebuilding persisted queue data.
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
        if (!(await db.tableExists(LOCAL_BACKGROUND_JOB_SCHEDULE_KEYS_TABLE))) {
            await db.createTable(this._scheduleKeysTableData());
            changed = true;
        }
        else {
            await this._assertColumns(db, LOCAL_BACKGROUND_JOB_SCHEDULE_KEYS_TABLE, EXPECTED_SCHEDULE_KEY_COLUMNS);
        }
        if (await this._ensureIndexes(db))
            changed = true;
        for (const version of MIGRATION_VERSIONS) {
            if (await this._hasMigration(db, version))
                continue;
            await this._recordMigration(db, version);
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
        table.string("schedule_key", { null: true });
        table.bigint("schedule_order", { null: true });
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
        table.addIndex(new TableIndex(["schedule_key", "created_at_ms", "id"], { name: LOCAL_BACKGROUND_JOBS_INDEX_NAMES[4] }));
        table.addIndex(new TableIndex(["schedule_key", "schedule_order", "created_at_ms", "id"], { name: LOCAL_BACKGROUND_JOBS_INDEX_NAMES[5] }));
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
     * Builds the stable schedule-owner table definition.
     * @returns {TableData} - Stable owner table definition.
     */
    _scheduleKeysTableData() {
        const table = new TableData(LOCAL_BACKGROUND_JOB_SCHEDULE_KEYS_TABLE, { ifNotExists: true });
        table.string("schedule_key", { null: false, primaryKey: true });
        table.string("job_id", { null: false });
        table.addIndex(new TableIndex(["job_id"], { name: LOCAL_BACKGROUND_JOB_SCHEDULE_KEYS_INDEX_NAMES[0] }));
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
        let changed = false;
        /** @type {Array<[string, TableData]>} */
        const definitions = [
            [LOCAL_BACKGROUND_JOBS_TABLE, this._jobsTableData()],
            [LOCAL_BACKGROUND_JOB_SCHEDULE_KEYS_TABLE, this._scheduleKeysTableData()]
        ];
        for (const [tableName, tableData] of definitions) {
            const table = await db.getTableByNameOrFail(tableName);
            const existingNames = new Set((await table.getIndexes()).map((index) => index.getName()));
            for (const index of tableData.getIndexes()) {
                const indexName = index.getName();
                if (!indexName || existingNames.has(indexName))
                    continue;
                const sqls = await db.createIndexSQLs({
                    columns: index.getColumns(),
                    ifNotExists: true,
                    name: indexName,
                    tableName,
                    unique: index.getUnique()
                });
                for (const sql of sqls)
                    await db.query(sql);
                changed = true;
            }
        }
        if (changed)
            db.clearSchemaCache();
        return changed;
    }
    /**
     * Checks whether the current local schema version is recorded.
     * @param {import("../database/drivers/base.js").default} db - Connection.
     * @param {string} version - Local schema version.
     * @returns {Promise<boolean>} - Whether the version is recorded.
     */
    async _hasMigration(db, version) {
        const rows = await db
            .newQuery()
            .from(MIGRATIONS_TABLE)
            .where({ key: this._migrationKey(version) })
            .limit(1)
            .results();
        return rows.length > 0;
    }
    /**
     * Records one local schema version after its additive changes are present.
     * @param {import("../database/drivers/base.js").default} db - Connection.
     * @param {string} version - Local schema version.
     * @returns {Promise<void>} - Resolves after recording.
     */
    async _recordMigration(db, version) {
        await db.upsert({
            tableName: MIGRATIONS_TABLE,
            data: {
                applied_at_ms: this.clock.now(),
                key: this._migrationKey(version),
                scope: MIGRATION_SCOPE,
                version
            },
            conflictColumns: ["key"],
            updateColumns: ["scope", "version", "applied_at_ms"]
        });
    }
    /**
     * Builds the scoped migration key.
     * @param {string} version - Local schema version.
     * @returns {string} - Scoped migration key.
     */
    _migrationKey(version) { return `${MIGRATION_SCOPE}:${version}`; }
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
     * Replaces the queued owner of a stable schedule key with a new local job.
     * A handed-off owner remains runnable but is detached from future ownership.
     * @param {object} args - Replacement request.
     * @param {string} args.scheduleKey - Stable logical schedule key.
     * @param {string} args.jobName - Registered job name.
     * @param {Array<ReturnType<typeof JSON.parse>>} args.args - Serialized job arguments.
     * @param {import("./types.js").BackgroundJobOptions} [args.options] - Job options.
     * @returns {Promise<import("./types.js").BackgroundJobReplacementResult>} - Replacement result.
     */
    async replaceScheduled({ scheduleKey, jobName, args, options = {} }) {
        await this.ensureReady();
        const normalizedScheduleKey = normalizeBackgroundJobScheduleKey(scheduleKey);
        const preparedJob = this._prepareJob({ args, jobName, options });
        return await this._withDb(async (connection) => await this._mutate(connection, async (db) => {
            await this._lockScheduleKey(db, normalizedScheduleKey);
            const ownerJob = await this._scheduledOwnerJob(db, normalizedScheduleKey);
            /** @type {import("./types.js").BackgroundJobReplacementPreviousStatus} */
            let previousStatus = null;
            let previousJobId = null;
            if (ownerJob?.status === "queued") {
                const affectedRows = await this._updateAffectedRows(db, {
                    conditions: { id: ownerJob.id, status: "queued" },
                    data: { status: "cancelled" },
                    tableName: LOCAL_BACKGROUND_JOBS_TABLE
                });
                if (affectedRows === 1) {
                    previousJobId = ownerJob.id;
                    previousStatus = "queued";
                }
                else {
                    const currentOwnerJob = await this._getJob(db, ownerJob.id);
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
            if (preparedJob.concurrency)
                await this._ensureConcurrency(db, preparedJob.concurrency);
            await this._insertPreparedJob(db, preparedJob, normalizedScheduleKey, scheduleOrder);
            await db.upsert({
                conflictColumns: ["schedule_key"],
                data: { job_id: preparedJob.jobId, schedule_key: normalizedScheduleKey },
                tableName: LOCAL_BACKGROUND_JOB_SCHEDULE_KEYS_TABLE,
                updateColumns: ["job_id"]
            });
            await this._wakeDispatcherAfterCommit(db);
            return { jobId: preparedJob.jobId, previousJobId, previousStatus };
        }));
    }
    /**
     * Cancels a queued stable owner or detaches an active handoff truthfully.
     * @param {string} scheduleKey - Stable logical schedule key.
     * @returns {Promise<import("./types.js").BackgroundJobCancellationResult>} - Cancellation result.
     */
    async cancelScheduled(scheduleKey) {
        await this.ensureReady();
        const normalizedScheduleKey = normalizeBackgroundJobScheduleKey(scheduleKey);
        return await this._withDb(async (connection) => await this._mutate(connection, async (db) => {
            await this._lockScheduleKey(db, normalizedScheduleKey);
            const ownerJob = await this._scheduledOwnerJob(db, normalizedScheduleKey);
            if (!ownerJob) {
                await this._releaseScheduleOwnership(db, { jobId: null, scheduleKey: normalizedScheduleKey });
                return { jobId: null, outcome: "not_found" };
            }
            if (ownerJob.status === "queued") {
                const affectedRows = await this._updateAffectedRows(db, {
                    conditions: { id: ownerJob.id, status: "queued" },
                    data: { status: "cancelled" },
                    tableName: LOCAL_BACKGROUND_JOBS_TABLE
                });
                if (affectedRows === 1) {
                    await this._releaseScheduleOwnership(db, { jobId: ownerJob.id, scheduleKey: normalizedScheduleKey });
                    await this._wakeDispatcherAfterCommit(db);
                    return { jobId: ownerJob.id, outcome: "cancelled" };
                }
            }
            const currentJob = await this._scheduledOwnerJob(db, normalizedScheduleKey);
            await this._releaseScheduleOwnership(db, { jobId: ownerJob.id, scheduleKey: normalizedScheduleKey });
            await this._wakeDispatcherAfterCommit(db);
            if (currentJob?.status === "handed_off")
                return { jobId: currentJob.id, outcome: "handed_off" };
            return { jobId: null, outcome: "not_found" };
        }));
    }
    /**
     * Reads stable ownership and optional latest terminal history in one transaction.
     * @param {string} scheduleKey - Stable logical schedule key.
     * @param {{includeLatestTerminal?: boolean}} [options] - Lookup options.
     * @returns {Promise<import("./types.js").BackgroundJobScheduledLookupResult>} - Normalized local jobs.
     */
    async getScheduledJob(scheduleKey, { includeLatestTerminal = false } = {}) {
        await this.ensureReady();
        const normalizedScheduleKey = normalizeBackgroundJobScheduleKey(scheduleKey);
        if (typeof includeLatestTerminal !== "boolean") {
            throw VelociousError.safe("background job includeLatestTerminal must be a boolean");
        }
        return await this._withDb(async (connection) => await this._mutate(connection, async (db) => {
            return await this._scheduledJobLookup(db, {
                includeLatestTerminal,
                scheduleKey: normalizedScheduleKey
            });
        }));
    }
    /**
     * Moves only a future queued stable owner to the current time.
     * @param {string} scheduleKey - Stable logical schedule key.
     * @returns {Promise<import("./types.js").BackgroundJobWakeResult>} - Exact wake outcome.
     */
    async wakeScheduled(scheduleKey) {
        await this.ensureReady();
        const normalizedScheduleKey = normalizeBackgroundJobScheduleKey(scheduleKey);
        return await this._withDb(async (connection) => await this._mutate(connection, async (db) => {
            await this._lockScheduleKey(db, normalizedScheduleKey);
            const job = await this._scheduledOwnerJob(db, normalizedScheduleKey);
            if (!job || (job.status !== "queued" && job.status !== "handed_off"))
                return { jobId: null, outcome: "not_found" };
            if (job.status === "handed_off")
                return { jobId: job.id, outcome: "handed_off" };
            const nowMs = this.clock.now();
            if (Number(job.scheduledAtMs) <= nowMs) {
                await this._wakeDispatcherAfterCommit(db);
                return { jobId: job.id, outcome: "already_due" };
            }
            const affectedRows = await this._updateAffectedRows(db, {
                conditions: { id: job.id, scheduled_at_ms: job.scheduledAtMs, status: "queued" },
                data: { scheduled_at_ms: nowMs },
                tableName: LOCAL_BACKGROUND_JOBS_TABLE
            });
            if (affectedRows === 1) {
                await this._wakeDispatcherAfterCommit(db);
                return { jobId: job.id, outcome: "woken" };
            }
            const currentJob = await this._scheduledOwnerJob(db, normalizedScheduleKey);
            if (currentJob?.status === "handed_off")
                return { jobId: currentJob.id, outcome: "handed_off" };
            if (currentJob?.status === "queued" && Number(currentJob.scheduledAtMs) <= nowMs) {
                await this._wakeDispatcherAfterCommit(db);
                return { jobId: currentJob.id, outcome: "already_due" };
            }
            return { jobId: null, outcome: "not_found" };
        }));
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
     * @param {string | null} [scheduleKey] - Stable schedule history key.
     * @param {number | null} [scheduleOrder] - Monotonic stable ownership order.
     * @returns {Promise<void>} - Resolves after insertion.
     */
    async _insertPreparedJob(db, preparedJob, scheduleKey = null, scheduleOrder = null) {
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
                schedule_key: scheduleKey,
                schedule_order: scheduleOrder,
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
            await this._releaseScheduleOwnershipForJob(db, job);
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
            await db.query(`DELETE FROM ${db.quoteTable(LOCAL_BACKGROUND_JOB_SCHEDULE_KEYS_TABLE)}`);
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
        if (!willRetry)
            await this._releaseScheduleOwnershipForJob(db, job);
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
     * Reads the job currently named by one stable owner row.
     * @param {import("../database/drivers/base.js").default} db - Database connection.
     * @param {string} scheduleKey - Validated stable schedule key.
     * @returns {Promise<import("./types.js").BackgroundJobRow | null>} - Normalized owner job.
     */
    async _scheduledOwnerJob(db, scheduleKey) {
        const ownerRows = await db
            .newQuery()
            .from(LOCAL_BACKGROUND_JOB_SCHEDULE_KEYS_TABLE)
            .where({ schedule_key: scheduleKey })
            .limit(1)
            .results();
        const ownerRow = ownerRows[0];
        if (!ownerRow)
            return null;
        return await this._getJob(db, String(ownerRow.job_id));
    }
    /**
     * Assigns the next ownership order after SQLite write serialization is held.
     * @param {import("../database/drivers/base.js").default} db - Database connection.
     * @param {string} scheduleKey - Validated stable schedule key.
     * @returns {Promise<number>} - Next monotonic ownership order.
     */
    async _nextScheduleOrder(db, scheduleKey) {
        const rows = await db
            .newQuery()
            .from(LOCAL_BACKGROUND_JOBS_TABLE)
            .select("schedule_order")
            .where({ schedule_key: scheduleKey })
            .where(`${db.quoteColumn("schedule_order")} IS NOT NULL`)
            .order("schedule_order DESC")
            .limit(1)
            .results();
        const currentOrder = this._numberOrNull(/** @type {Record<string, ReturnType<typeof JSON.parse>>} */ (rows[0] || {}).schedule_order);
        if (currentOrder === null)
            return 1;
        if (!Number.isSafeInteger(currentOrder) || currentOrder < 1 || currentOrder >= Number.MAX_SAFE_INTEGER) {
            throw new Error(`Invalid local background job schedule ownership order: ${currentOrder}`);
        }
        return currentOrder + 1;
    }
    /**
     * Builds a stable-schedule lookup exclusively from normalized local jobs.
     * @param {import("../database/drivers/base.js").default} db - Database connection.
     * @param {object} args - Lookup options.
     * @param {boolean} args.includeLatestTerminal - Whether terminal history is requested.
     * @param {string} args.scheduleKey - Validated stable schedule key.
     * @returns {Promise<import("./types.js").BackgroundJobScheduledLookupResult>} - Normalized local jobs.
     */
    async _scheduledJobLookup(db, { includeLatestTerminal, scheduleKey }) {
        const ownerJob = await this._scheduledOwnerJob(db, scheduleKey);
        const currentJob = ownerJob && (ownerJob.status === "queued" || ownerJob.status === "handed_off") ? ownerJob : null;
        if (!includeLatestTerminal)
            return { currentJob, latestTerminalJob: null };
        const terminalStatuses = BACKGROUND_JOB_TERMINAL_STATUSES.map((status) => db.quote(status)).join(", ");
        const terminalRows = await db
            .newQuery()
            .from(LOCAL_BACKGROUND_JOBS_TABLE)
            .where({ schedule_key: scheduleKey })
            .where(`${db.quoteColumn("status")} IN (${terminalStatuses})`)
            .order(`CASE WHEN ${db.quoteColumn("schedule_order")} IS NULL THEN 0 ELSE 1 END DESC`)
            .order("schedule_order DESC")
            .order("created_at_ms DESC")
            .order("id DESC")
            .limit(1)
            .results();
        const latestTerminalJob = terminalRows[0] ? this._normalizeRow(terminalRows[0]) : null;
        return { currentJob, latestTerminalJob };
    }
    /**
     * Releases ownership only when the key still points at the expected job.
     * @param {import("../database/drivers/base.js").default} db - Database connection.
     * @param {object} args - Ownership identity.
     * @param {string | null} args.jobId - Expected owner job id, or null for a dangling owner.
     * @param {string} args.scheduleKey - Stable schedule key.
     * @returns {Promise<void>} - Resolves when deleted or already superseded.
     */
    async _releaseScheduleOwnership(db, { jobId, scheduleKey }) {
        const conditions = jobId === null
            ? { schedule_key: scheduleKey }
            : { job_id: jobId, schedule_key: scheduleKey };
        await db.delete({ conditions, tableName: LOCAL_BACKGROUND_JOB_SCHEDULE_KEYS_TABLE });
    }
    /**
     * Releases a terminal job's stable ownership when still current.
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
     * Acquires SQLite's transaction write serialization before reading a stable
     * owner. A zero-row update still establishes the write boundary for a new key.
     * @param {import("../database/drivers/base.js").default} db - Database connection.
     * @param {string} scheduleKey - Validated stable schedule key.
     * @returns {Promise<void>} - Resolves after write serialization is acquired.
     */
    async _lockScheduleKey(db, scheduleKey) {
        const table = db.quoteTable(LOCAL_BACKGROUND_JOB_SCHEDULE_KEYS_TABLE);
        const jobId = db.quoteColumn("job_id");
        await db.query(`UPDATE ${table} SET ${jobId} = ${jobId} ` +
            `WHERE ${db.quoteColumn("schedule_key")} = ${db.quote(scheduleKey)}`);
    }
    /**
     * Registers the local dispatch poke on the surrounding transaction commit.
     * @param {import("../database/drivers/base.js").default} db - Transaction connection.
     * @returns {Promise<void>} - Resolves after registration.
     */
    async _wakeDispatcherAfterCommit(db) {
        if (this.onCommittedEnqueue)
            await db.afterCommit(this.onCommittedEnqueue);
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
            scheduleKey: row.schedule_key === null || row.schedule_key === undefined ? null : String(row.schedule_key),
            scheduleOrder: this._numberOrNull(row.schedule_order),
            scheduledAtMs: this._numberOrNull(row.scheduled_at_ms),
            status: normalizeBackgroundJobStatus(row.status ? String(row.status) : "queued"),
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoibG9jYWwtc3RvcmUuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi9zcmMvYmFja2dyb3VuZC1qb2JzL2xvY2FsLXN0b3JlLmpzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiJBQUFBLFlBQVk7QUFFWixPQUFPLElBQUksTUFBTSxXQUFXLENBQUE7QUFFNUIsT0FBTyxTQUFTLE1BQU0saUNBQWlDLENBQUE7QUFDdkQsT0FBTyxVQUFVLE1BQU0sdUNBQXVDLENBQUE7QUFDOUQsT0FBTyxTQUFTLE1BQU0sd0JBQXdCLENBQUE7QUFDOUMsT0FBTyxjQUFjLE1BQU0sdUJBQXVCLENBQUE7QUFDbEQsT0FBTywyQkFBMkIsTUFBTSxzQkFBc0IsQ0FBQTtBQUM5RCxPQUFPLEVBQ0wsZ0NBQWdDLEVBQ2hDLDRCQUE0QixFQUM1Qiw0QkFBNEIsRUFDNUIsaUNBQWlDLEVBQ2pDLG1DQUFtQyxFQUNuQyxnQ0FBZ0MsRUFDaEMsMkJBQTJCLEVBQzNCLGlDQUFpQyxFQUNqQyxtQ0FBbUMsRUFDbkMsNEJBQTRCLEVBQzVCLDRCQUE0QixFQUM1QixZQUFZLEVBQ2IsTUFBTSxvQkFBb0IsQ0FBQTtBQUUzQixNQUFNLENBQUMsTUFBTSwyQkFBMkIsR0FBRyxpQ0FBaUMsQ0FBQTtBQUM1RSxNQUFNLENBQUMsTUFBTSxzQ0FBc0MsR0FBRyw0Q0FBNEMsQ0FBQTtBQUNsRyxNQUFNLENBQUMsTUFBTSx3Q0FBd0MsR0FBRyw4Q0FBOEMsQ0FBQTtBQUN0RyxNQUFNLGdCQUFnQixHQUFHLCtCQUErQixDQUFBO0FBQ3hELE1BQU0sZUFBZSxHQUFHLHVCQUF1QixDQUFBO0FBQy9DLE1BQU0sa0JBQWtCLEdBQUcsQ0FBQyxHQUFHLEVBQUUsR0FBRyxFQUFFLEdBQUcsQ0FBQyxDQUFBO0FBQzFDLE1BQU0scUJBQXFCLEdBQUcsQ0FBQyxvQkFBb0IsQ0FBQyxDQUFDLFFBQVEsQ0FBQyxDQUFDLENBQUE7QUFDL0QsTUFBTSxDQUFDLE1BQU0saUNBQWlDLEdBQUc7SUFDL0MsMkNB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R0FBRyxDQUFDLGtCQUFrQixDQUFDLENBQUE7WUFFbEMsSUFBSSxDQUFDLEVBQUU7Z0JBQUUsTUFBTSxJQUFJLEtBQUssQ0FBQywwRUFBMEUsa0JBQWtCLEVBQUUsQ0FBQyxDQUFBO1lBRXhILE9BQU8sTUFBTSxRQUFRLENBQUMsRUFBRSxDQUFDLENBQUE7UUFDM0IsQ0FBQyxDQUFDLENBQUE7SUFDSixDQUFDO0lBRUQ7Ozs7T0FJRztJQUNILHFCQUFxQixDQUFDLEVBQUMsS0FBSyxFQUFFLEtBQUssRUFBQztRQUNsQyxNQUFNLE9BQU8sR0FBRyxFQUFDLE9BQU8sRUFBRSxFQUFDLEtBQUssRUFBQyxFQUFFLEtBQUssRUFBQyxDQUFBO1FBQ3pDLE1BQU0sV0FBVyxHQUFHLElBQUksQ0FBQyxhQUFhLENBQUMsY0FBYyxFQUFFLENBQUE7UUFFdkQsV0FBVyxDQUFDLElBQUksQ0FBQyxpQkFBaUIsRUFBRSxPQUFPLENBQUMsQ0FBQTtRQUM1QyxXQUFXLENBQUMsSUFBSSxDQUFDLFdBQVcsRUFBRSxFQUFDLEdBQUcsT0FBTyxFQUFFLFNBQVMsRUFBRSxpQkFBaUIsRUFBQyxDQUFDLENBQUE7SUFDM0UsQ0FBQztDQUNGIiwic291cmNlc0NvbnRlbnQiOlsiLy8gQHRzLWNoZWNrXG5cbmltcG9ydCBVVUlEIGZyb20gXCJwdXJlLXV1aWRcIlxuXG5pbXBvcnQgVGFibGVEYXRhIGZyb20gXCIuLi9kYXRhYmFzZS90YWJsZS1kYXRhL2luZGV4LmpzXCJcbmltcG9ydCBUYWJsZUluZGV4IGZyb20gXCIuLi9kYXRhYmFzZS90YWJsZS1kYXRhL3RhYmxlLWluZGV4LmpzXCJcbmltcG9ydCBzaGEyNTZIZXggZnJvbSBcIi4uL3V0aWxzL3NoYTI1Ni1oZXguanNcIlxuaW1wb3J0IFZlbG9jaW91c0Vycm9yIGZyb20gXCIuLi92ZWxvY2lvdXMtZXJyb3IuanNcIlxuaW1wb3J0IG5vcm1hbGl6ZUJhY2tncm91bmRKb2JFcnJvciBmcm9tIFwiLi9ub3JtYWxpemUtZXJyb3IuanNcIlxuaW1wb3J0IHtcbiAgQkFDS0dST1VORF9KT0JfVEVSTUlOQUxfU1RBVFVTRVMsXG4gIERFRkFVTFRfQkFDS0dST1VORF9KT0JfUVVFVUUsXG4gIFFVRVVFX0NPTkNVUlJFTkNZX0tFWV9QUkVGSVgsXG4gIG5vcm1hbGl6ZUJhY2tncm91bmRKb2JDb25jdXJyZW5jeSxcbiAgbm9ybWFsaXplQmFja2dyb3VuZEpvYkV4ZWN1dGlvbk1vZGUsXG4gIG5vcm1hbGl6ZUJhY2tncm91bmRKb2JNYXhSZXRyaWVzLFxuICBub3JtYWxpemVCYWNrZ3JvdW5kSm9iUXVldWUsXG4gIG5vcm1hbGl6ZUJhY2tncm91bmRKb2JTY2hlZHVsZUtleSxcbiAgbm9ybWFsaXplQmFja2dyb3VuZEpvYlNjaGVkdWxlZEF0TXMsXG4gIG5vcm1hbGl6ZUJhY2tncm91bmRKb2JTdGF0dXMsXG4gIHJlc2NoZWR1bGVkQmFja2dyb3VuZEpvYkF0TXMsXG4gIHJldHJ5RGVsYXlNc1xufSBmcm9tIFwiLi9qb2Itc2VtYW50aWNzLmpzXCJcblxuZXhwb3J0IGNvbnN0IExPQ0FMX0JBQ0tHUk9VTkRfSk9CU19UQUJMRSA9IFwidmVsb2Npb3VzX2xvY2FsX2JhY2tncm91bmRfam9ic1wiXG5leHBvcnQgY29uc3QgTE9DQUxfQkFDS0dST1VORF9KT0JfQ09OQ1VSUkVOQ1lfVEFCTEUgPSBcInZlbG9jaW91c19sb2NhbF9iYWNrZ3JvdW5kX2pvYl9jb25jdXJyZW5jeVwiXG5leHBvcnQgY29uc3QgTE9DQUxfQkFDS0dST1VORF9KT0JfU0NIRURVTEVfS0VZU19UQUJMRSA9IFwidmVsb2Npb3VzX2xvY2FsX2JhY2tncm91bmRfam9iX3NjaGVkdWxlX2tleXNcIlxuY29uc3QgTUlHUkFUSU9OU19UQUJMRSA9IFwidmVsb2Npb3VzX2ludGVybmFsX21pZ3JhdGlvbnNcIlxuY29uc3QgTUlHUkFUSU9OX1NDT1BFID0gXCJsb2NhbF9iYWNrZ3JvdW5kX2pvYnNcIlxuY29uc3QgTUlHUkFUSU9OX1ZFUlNJT05TID0gW1wiMVwiLCBcIjJcIiwgXCIzXCJdXG5jb25zdCBMT0NBTF9FWEVDVVRJT05fTU9ERVMgPSBbLyoqIEB0eXBlIHtjb25zdH0gKi8gKFwiaW5saW5lXCIpXVxuZXhwb3J0IGNvbnN0IExPQ0FMX0JBQ0tHUk9VTkRfSk9CU19JTkRFWF9OQU1FUyA9IFtcbiAgXCJpbmRleF92ZWxvY2lvdXNfbG9jYWxfYmFja2dyb3VuZF9qb2JzX2R1ZVwiLFxuICBcImluZGV4X3ZlbG9jaW91c19sb2NhbF9iYWNrZ3JvdW5kX2pvYnNfcXVldWVfc3RhdHVzXCIsXG4gIFwiaW5kZXhfdmVsb2Npb3VzX2xvY2FsX2JhY2tncm91bmRfam9ic19kZWR1cGxpY2F0aW9uXCIsXG4gIFwiaW5kZXhfdmVsb2Npb3VzX2xvY2FsX2JhY2tncm91bmRfam9ic19jb25jdXJyZW5jeVwiLFxuICBcImluZGV4X3ZlbG9jaW91c19sb2NhbF9iYWNrZ3JvdW5kX2pvYnNfc2NoZWR1bGVfaGlzdG9yeVwiLFxuICBcImluZGV4X3ZlbG9jaW91c19sb2NhbF9iYWNrZ3JvdW5kX2pvYnNfc2NoZWR1bGVfb3JkZXJcIlxuXVxuZXhwb3J0IGNvbnN0IExPQ0FMX0JBQ0tHUk9VTkRfSk9CX1NDSEVEVUxFX0tFWVNfSU5ERVhfTkFNRVMgPSBbXCJpbmRleF92ZWxvY2lvdXNfbG9jYWxfYmFja2dyb3VuZF9qb2Jfc2NoZWR1bGVfa2V5c19qb2JcIl1cbmNvbnN0IEVYUEVDVEVEX0pPQl9DT0xVTU5TID0gW1xuICBcImlkXCIsXG4gIFwiam9iX25hbWVcIixcbiAgXCJhcmdzX2pzb25cIixcbiAgXCJhcmdzX2RpZ2VzdFwiLFxuICBcImV4ZWN1dGlvbl9tb2RlXCIsXG4gIFwicXVldWVcIixcbiAgXCJzY2hlZHVsZV9rZXlcIixcbiAgXCJzY2hlZHVsZV9vcmRlclwiLFxuICBcIm1heF9yZXRyaWVzXCIsXG4gIFwiYXR0ZW1wdHNcIixcbiAgXCJzdGF0dXNcIixcbiAgXCJzY2hlZHVsZWRfYXRfbXNcIixcbiAgXCJjcmVhdGVkX2F0X21zXCIsXG4gIFwiaGFuZGVkX29mZl9hdF9tc1wiLFxuICBcImhhbmRvZmZfaWRcIixcbiAgXCJ3b3JrZXJfaWRcIixcbiAgXCJjb21wbGV0ZWRfYXRfbXNcIixcbiAgXCJmYWlsZWRfYXRfbXNcIixcbiAgXCJsYXN0X2Vycm9yXCIsXG4gIFwiY29uY3VycmVuY3lfa2V5XCIsXG4gIFwibWF4X2NvbmN1cnJlbmN5XCIsXG4gIFwiY2hpbGRfcmVjZWl2ZWRfYXRfbXNcIixcbiAgXCJjaGlsZF9zdGFydGVkX2F0X21zXCIsXG4gIFwiY2hpbGRfaW5zdGFuY2VfaWRcIixcbiAgXCJjaGlsZF9waWRcIlxuXVxuY29uc3QgRVhQRUNURURfQ09OQ1VSUkVOQ1lfQ09MVU1OUyA9IFtcImNvbmN1cnJlbmN5X2tleVwiLCBcIm1heF9jb25jdXJyZW5jeVwiLCBcImFjdGl2ZV9jb3VudFwiXVxuY29uc3QgRVhQRUNURURfU0NIRURVTEVfS0VZX0NPTFVNTlMgPSBbXCJzY2hlZHVsZV9rZXlcIiwgXCJqb2JfaWRcIl1cbi8qKiBAdHlwZSB7V2Vha01hcDxpbXBvcnQoXCIuLi9jb25maWd1cmF0aW9uLmpzXCIpLmRlZmF1bHQsIE1hcDxzdHJpbmcsIFByb21pc2U8dm9pZD4+Pn0gKi9cbmNvbnN0IGRlZHVwbGljYXRlZEVucXVldWVDaGFpbnMgPSBuZXcgV2Vha01hcCgpXG5cbi8qKlxuICogQ3JlYXRlcyB0aGUgcHJvZHVjdGlvbiBjbG9jayB1c2VkIGJ5IGxvY2FsIGRpc3BhdGNoLlxuICogQHJldHVybnMge2ltcG9ydChcIi4vdHlwZXMuanNcIikuTG9jYWxCYWNrZ3JvdW5kSm9ic0Nsb2NrfSAtIFByb2R1Y3Rpb24gY2xvY2suXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBsb2NhbEJhY2tncm91bmRKb2JzQ2xvY2soKSB7XG4gIHJldHVybiB7XG4gICAgY2xlYXJUaW1lb3V0OiAodGltZXJJZCkgPT4gZ2xvYmFsVGhpcy5jbGVhclRpbWVvdXQodGltZXJJZCksXG4gICAgbm93OiAoKSA9PiBEYXRlLm5vdygpLFxuICAgIHNldFRpbWVvdXQ6IChjYWxsYmFjaywgZGVsYXlNcykgPT4gZ2xvYmFsVGhpcy5zZXRUaW1lb3V0KGNhbGxiYWNrLCBkZWxheU1zKVxuICB9XG59XG5cbi8qKiBOYW1lc3BhY2VkIHBvcnRhYmxlIFNRTGl0ZSBwZXJzaXN0ZW5jZSBmb3IgbG9jYWwgYmFja2dyb3VuZCBqb2JzLiAqL1xuZXhwb3J0IGRlZmF1bHQgY2xhc3MgTG9jYWxCYWNrZ3JvdW5kSm9ic1N0b3JlIHtcbiAgLyoqXG4gICAqIENyZWF0ZXMgYSBzdG9yZSBmb3Igb25lIGNvbmZpZ3VyYXRpb24gYW5kIGxvY2FsIGRhdGFiYXNlLlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIFN0b3JlIG9wdGlvbnMuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vY29uZmlndXJhdGlvbi5qc1wiKS5kZWZhdWx0fSBhcmdzLmNvbmZpZ3VyYXRpb24gLSBPd25pbmcgY29uZmlndXJhdGlvbi5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL3R5cGVzLmpzXCIpLkxvY2FsQmFja2dyb3VuZEpvYnNDbG9ja30gW2FyZ3MuY2xvY2tdIC0gUGVyc2lzdGVuY2UgY2xvY2suXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBbYXJncy5kYXRhYmFzZUlkZW50aWZpZXJdIC0gQ29uZmlndXJlZCBsb2NhbCBkYXRhYmFzZSBpZGVudGlmaWVyLlxuICAgKiBAcGFyYW0geygpID0+IHZvaWR9IFthcmdzLm9uQ29tbWl0dGVkRW5xdWV1ZV0gLSBDb21taXQtYXdhcmUgZGlzcGF0Y2hlciB3YWtlLlxuICAgKi9cbiAgY29uc3RydWN0b3Ioe2NvbmZpZ3VyYXRpb24sIGNsb2NrID0gbG9jYWxCYWNrZ3JvdW5kSm9ic0Nsb2NrKCksIGRhdGFiYXNlSWRlbnRpZmllciwgb25Db21taXR0ZWRFbnF1ZXVlfSkge1xuICAgIHRoaXMuY2xvY2sgPSBjbG9ja1xuICAgIHRoaXMuY29uZmlndXJhdGlvbiA9IGNvbmZpZ3VyYXRpb25cbiAgICB0aGlzLmRhdGFiYXNlSWRlbnRpZmllciA9IGRhdGFiYXNlSWRlbnRpZmllclxuICAgIHRoaXMub25Db21taXR0ZWRFbnF1ZXVlID0gb25Db21taXR0ZWRFbnF1ZXVlXG4gICAgdGhpcy5faXNSZWFkeSA9IGZhbHNlXG4gICAgLyoqIEB0eXBlIHtQcm9taXNlPHZvaWQ+IHwgbnVsbH0gKi9cbiAgICB0aGlzLl9yZWFkeVByb21pc2UgPSBudWxsXG4gICAgLyoqIEB0eXBlIHtXZWFrTWFwPGltcG9ydChcIi4uL2RhdGFiYXNlL2RyaXZlcnMvYmFzZS5qc1wiKS5kZWZhdWx0LCB7Y29tcGxldGlvbjogUHJvbWlzZTx2b2lkPiwgcHJvbWlzZTogUHJvbWlzZTx2b2lkPn0+fSAqL1xuICAgIHRoaXMuX3RyYW5zYWN0aW9uUmVhZHlQcm9taXNlcyA9IG5ldyBXZWFrTWFwKClcbiAgfVxuXG4gIC8qKlxuICAgKiBSZXNvbHZlcyB0aGUgY29uZmlndXJlZCBsb2NhbCBkYXRhYmFzZSBpZGVudGlmaWVyLlxuICAgKiBAcmV0dXJucyB7c3RyaW5nfSAtIERhdGFiYXNlIGlkZW50aWZpZXIuXG4gICAqL1xuICBnZXREYXRhYmFzZUlkZW50aWZpZXIoKSB7XG4gICAgcmV0dXJuIHRoaXMuZGF0YWJhc2VJZGVudGlmaWVyIHx8IHRoaXMuY29uZmlndXJhdGlvbi5nZXRCYWNrZ3JvdW5kSm9ic0NvbmZpZygpLmRhdGFiYXNlSWRlbnRpZmllclxuICB9XG5cbiAgLyoqXG4gICAqIEVuc3VyZXMgdGhlIHZlcnNpb25lZCBwaHlzaWNhbCBzY2hlbWEgZXhpc3RzLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyB3aGVuIHJlYWR5LlxuICAgKi9cbiAgYXN5bmMgZW5zdXJlUmVhZHkoKSB7XG4gICAgaWYgKHRoaXMuX2lzUmVhZHkpIHJldHVyblxuXG4gICAgYXdhaXQgdGhpcy5fd2l0aERiKGFzeW5jIChkYikgPT4gYXdhaXQgdGhpcy5fZW5zdXJlUmVhZHlXaXRoRGIoZGIpKVxuICB9XG5cbiAgLyoqXG4gICAqIENsZWFycyB0aGUgcGVyLWluc3RhbmNlIHJlYWRpbmVzcyBsYXRjaCBmb3IgYSBkZWxpYmVyYXRlIGFkYXB0ZXIgcmVvcGVuLlxuICAgKiBAcmV0dXJucyB7dm9pZH0gLSBObyByZXR1cm4gdmFsdWUuXG4gICAqL1xuICByZXNldFJlYWRpbmVzcygpIHtcbiAgICB0aGlzLl9pc1JlYWR5ID0gZmFsc2VcbiAgICB0aGlzLl9yZWFkeVByb21pc2UgPSBudWxsXG4gICAgdGhpcy5fdHJhbnNhY3Rpb25SZWFkeVByb21pc2VzID0gbmV3IFdlYWtNYXAoKVxuICB9XG5cbiAgLyoqXG4gICAqIENvb3JkaW5hdGVzIHBoeXNpY2FsIGFuZCB0cmFuc2FjdGlvbi1sb2NhbCBzY2hlbWEgcmVhZGluZXNzLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL2RhdGFiYXNlL2RyaXZlcnMvYmFzZS5qc1wiKS5kZWZhdWx0fSBkYiAtIExvY2FsIFNRTGl0ZSBjb25uZWN0aW9uLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyB3aGVuIHRoaXMgY2FsbGVyIGNhbiB1c2UgdGhlIHNjaGVtYS5cbiAgICovXG4gIGFzeW5jIF9lbnN1cmVSZWFkeVdpdGhEYihkYikge1xuICAgIGlmICh0aGlzLl9pc1JlYWR5KSByZXR1cm5cblxuICAgIGNvbnN0IHRyYW5zYWN0aW9uQ29tcGxldGlvbiA9IGRiLmluc2lkZVRyYW5zYWN0aW9uKCkgPyBkYi50cmFuc2FjdGlvbkNvbXBsZXRpb24oKSA6IG51bGxcbiAgICBjb25zdCB0cmFuc2FjdGlvblJlYWR5ID0gdGhpcy5fdHJhbnNhY3Rpb25SZWFkeVByb21pc2VzLmdldChkYilcblxuICAgIGlmICh0cmFuc2FjdGlvbkNvbXBsZXRpb24gJiYgdHJhbnNhY3Rpb25SZWFkeT8uY29tcGxldGlvbiA9PT0gdHJhbnNhY3Rpb25Db21wbGV0aW9uKSB7XG4gICAgICBhd2FpdCB0cmFuc2FjdGlvblJlYWR5LnByb21pc2VcbiAgICAgIHJldHVyblxuICAgIH1cblxuICAgIGlmICh0aGlzLl9yZWFkeVByb21pc2UpIHtcbiAgICAgIGNvbnN0IHJlYWR5UHJvbWlzZSA9IHRoaXMuX3JlYWR5UHJvbWlzZVxuXG4gICAgICBhd2FpdCByZWFkeVByb21pc2VcbiAgICAgIGlmICh0aGlzLl9yZWFkeVByb21pc2UgPT09IHJlYWR5UHJvbWlzZSkgdGhpcy5fcmVhZHlQcm9taXNlID0gbnVsbFxuICAgICAgaWYgKHRoaXMuX2lzUmVhZHkpIHJldHVyblxuXG4gICAgICBhd2FpdCB0aGlzLmVuc3VyZVJlYWR5KClcbiAgICAgIHJldHVyblxuICAgIH1cblxuICAgIGlmICh0cmFuc2FjdGlvbkNvbXBsZXRpb24pIHtcbiAgICAgIGNvbnN0IHNjaGVtYVJlYWR5UHJvbWlzZSA9IHRoaXMuX2FwcGx5U2NoZW1hKGRiKVxuICAgICAgY29uc3QgdHJhbnNhY3Rpb25SZWFkeVByb21pc2UgPSBzY2hlbWFSZWFkeVByb21pc2UudGhlbigoKSA9PiB1bmRlZmluZWQpXG4gICAgICBjb25zdCB0cmFuc2FjdGlvblJlYWR5ID0ge2NvbXBsZXRpb246IHRyYW5zYWN0aW9uQ29tcGxldGlvbiwgcHJvbWlzZTogdHJhbnNhY3Rpb25SZWFkeVByb21pc2V9XG4gICAgICBjb25zdCBkdXJhYmxlUmVhZHlQcm9taXNlID0gc2NoZW1hUmVhZHlQcm9taXNlLnRoZW4oYXN5bmMgKGNoYW5nZWQpID0+IHtcbiAgICAgICAgaWYgKCFjaGFuZ2VkKSB7XG4gICAgICAgICAgdGhpcy5faXNSZWFkeSA9IHRydWVcbiAgICAgICAgICByZXR1cm5cbiAgICAgICAgfVxuXG4gICAgICAgIGF3YWl0IHRyYW5zYWN0aW9uQ29tcGxldGlvblxuICAgICAgfSwgKCkgPT4ge1xuICAgICAgICAvLyBUaGUgdHJhbnNhY3Rpb24tbG9jYWwgY2FsbGVyIGJlbG93IG93bnMgYW5kIHJldGhyb3dzIHRoaXMgc2FtZSBzY2hlbWEgZXJyb3IuXG4gICAgICAgIC8vIFRoaXMgYnJhbmNoIG9ubHkgc2V0dGxlcyB0aGUgc2hhcmVkIGR1cmFiaWxpdHkgYmFycmllciBzbyBpdCBjYW5ub3QgYmVjb21lXG4gICAgICAgIC8vIGFuIGluZGVwZW5kZW50IHVuaGFuZGxlZCByZWplY3Rpb24gd2hpbGUgZmFpbGVkIG93bmVyc2hpcCBpcyBjbGVhcmVkLlxuICAgICAgfSlcblxuICAgICAgdGhpcy5fdHJhbnNhY3Rpb25SZWFkeVByb21pc2VzLnNldChkYiwgdHJhbnNhY3Rpb25SZWFkeSlcbiAgICAgIHRoaXMuX3JlYWR5UHJvbWlzZSA9IGR1cmFibGVSZWFkeVByb21pc2VcblxuICAgICAgdHJ5IHtcbiAgICAgICAgYXdhaXQgdHJhbnNhY3Rpb25SZWFkeVByb21pc2VcbiAgICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICAgIGlmICh0aGlzLl90cmFuc2FjdGlvblJlYWR5UHJvbWlzZXMuZ2V0KGRiKSA9PT0gdHJhbnNhY3Rpb25SZWFkeSkgdGhpcy5fdHJhbnNhY3Rpb25SZWFkeVByb21pc2VzLmRlbGV0ZShkYilcbiAgICAgICAgaWYgKHRoaXMuX3JlYWR5UHJvbWlzZSA9PT0gZHVyYWJsZVJlYWR5UHJvbWlzZSkgdGhpcy5fcmVhZHlQcm9taXNlID0gbnVsbFxuICAgICAgICB0aHJvdyBlcnJvclxuICAgICAgfVxuICAgICAgcmV0dXJuXG4gICAgfVxuXG4gICAgdGhpcy5fcmVhZHlQcm9taXNlID0gdGhpcy5fdHJhbnNhY3Rpb25SZXN1bHQoZGIsIGFzeW5jICgpID0+IGF3YWl0IHRoaXMuX2FwcGx5U2NoZW1hKGRiKSkudGhlbigoKSA9PiB7XG4gICAgICB0aGlzLl9pc1JlYWR5ID0gdHJ1ZVxuICAgIH0pXG5cbiAgICB0cnkge1xuICAgICAgYXdhaXQgdGhpcy5fcmVhZHlQcm9taXNlXG4gICAgfSBmaW5hbGx5IHtcbiAgICAgIGlmICghdGhpcy5faXNSZWFkeSkgdGhpcy5fcmVhZHlQcm9taXNlID0gbnVsbFxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBDcmVhdGVzIG9yIHVwZ3JhZGVzIHRoZSB2ZXJzaW9uZWQgbG9jYWwgdGFibGVzIGFuZCBpbmRleGVzIHdpdGhvdXRcbiAgICogcmVidWlsZGluZyBwZXJzaXN0ZWQgcXVldWUgZGF0YS5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9kYXRhYmFzZS9kcml2ZXJzL2Jhc2UuanNcIikuZGVmYXVsdH0gZGIgLSBMb2NhbCBTUUxpdGUgY29ubmVjdGlvbi5cbiAgICogQHJldHVybnMge1Byb21pc2U8Ym9vbGVhbj59IC0gV2hldGhlciBzY2hlbWEgc3RhdGUgY2hhbmdlZC5cbiAgICovXG4gIGFzeW5jIF9hcHBseVNjaGVtYShkYikge1xuICAgIGxldCBjaGFuZ2VkID0gZmFsc2VcblxuICAgIGlmICghKGF3YWl0IGRiLnRhYmxlRXhpc3RzKE1JR1JBVElPTlNfVEFCTEUpKSkge1xuICAgICAgYXdhaXQgZGIuY3JlYXRlVGFibGUodGhpcy5fbWlncmF0aW9uc1RhYmxlRGF0YSgpKVxuICAgICAgY2hhbmdlZCA9IHRydWVcbiAgICB9XG5cbiAgICBpZiAoIShhd2FpdCBkYi50YWJsZUV4aXN0cyhMT0NBTF9CQUNLR1JPVU5EX0pPQlNfVEFCTEUpKSkge1xuICAgICAgYXdhaXQgZGIuY3JlYXRlVGFibGUodGhpcy5fam9ic1RhYmxlRGF0YSgpKVxuICAgICAgY2hhbmdlZCA9IHRydWVcbiAgICB9IGVsc2Uge1xuICAgICAgaWYgKGF3YWl0IHRoaXMuX2Vuc3VyZUpvYkNvbHVtbnMoZGIpKSBjaGFuZ2VkID0gdHJ1ZVxuICAgICAgYXdhaXQgdGhpcy5fYXNzZXJ0Q29sdW1ucyhkYiwgTE9DQUxfQkFDS0dST1VORF9KT0JTX1RBQkxFLCBFWFBFQ1RFRF9KT0JfQ09MVU1OUylcbiAgICB9XG5cbiAgICBpZiAoIShhd2FpdCBkYi50YWJsZUV4aXN0cyhMT0NBTF9CQUNLR1JPVU5EX0pPQl9DT05DVVJSRU5DWV9UQUJMRSkpKSB7XG4gICAgICBhd2FpdCBkYi5jcmVhdGVUYWJsZSh0aGlzLl9jb25jdXJyZW5jeVRhYmxlRGF0YSgpKVxuICAgICAgY2hhbmdlZCA9IHRydWVcbiAgICB9IGVsc2Uge1xuICAgICAgYXdhaXQgdGhpcy5fYXNzZXJ0Q29sdW1ucyhkYiwgTE9DQUxfQkFDS0dST1VORF9KT0JfQ09OQ1VSUkVOQ1lfVEFCTEUsIEVYUEVDVEVEX0NPTkNVUlJFTkNZX0NPTFVNTlMpXG4gICAgfVxuXG4gICAgaWYgKCEoYXdhaXQgZGIudGFibGVFeGlzdHMoTE9DQUxfQkFDS0dST1VORF9KT0JfU0NIRURVTEVfS0VZU19UQUJMRSkpKSB7XG4gICAgICBhd2FpdCBkYi5jcmVhdGVUYWJsZSh0aGlzLl9zY2hlZHVsZUtleXNUYWJsZURhdGEoKSlcbiAgICAgIGNoYW5nZWQgPSB0cnVlXG4gICAgfSBlbHNlIHtcbiAgICAgIGF3YWl0IHRoaXMuX2Fzc2VydENvbHVtbnMoZGIsIExPQ0FMX0JBQ0tHUk9VTkRfSk9CX1NDSEVEVUxFX0tFWVNfVEFCTEUsIEVYUEVDVEVEX1NDSEVEVUxFX0tFWV9DT0xVTU5TKVxuICAgIH1cblxuICAgIGlmIChhd2FpdCB0aGlzLl9lbnN1cmVJbmRleGVzKGRiKSkgY2hhbmdlZCA9IHRydWVcblxuICAgIGZvciAoY29uc3QgdmVyc2lvbiBvZiBNSUdSQVRJT05fVkVSU0lPTlMpIHtcbiAgICAgIGlmIChhd2FpdCB0aGlzLl9oYXNNaWdyYXRpb24oZGIsIHZlcnNpb24pKSBjb250aW51ZVxuXG4gICAgICBhd2FpdCB0aGlzLl9yZWNvcmRNaWdyYXRpb24oZGIsIHZlcnNpb24pXG4gICAgICBjaGFuZ2VkID0gdHJ1ZVxuICAgIH1cblxuICAgIHJldHVybiBjaGFuZ2VkXG4gIH1cblxuICAvKipcbiAgICogSWRlbXBvdGVudGx5IGFkZHMgY29sdW1ucyBmcm9tIHRoZSBjdXJyZW50IGpvYnMgdGFibGUgZGVmaW5pdGlvbiB0aGF0IGFuXG4gICAqIGV4aXN0aW5nIGxvY2FsIHRhYmxlIGlzIG1pc3NpbmcsIHNvIGFuIHVwZ3JhZGVkIGZyYW1ld29yayBmaW5kcyBhXG4gICAqIGNvbXBhdGlibGUgc2NoZW1hIGluc3RlYWQgb2YgZmFpbGluZyB0aGUgY29sdW1uIGFzc2VydGlvbi5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9kYXRhYmFzZS9kcml2ZXJzL2Jhc2UuanNcIikuZGVmYXVsdH0gZGIgLSBMb2NhbCBTUUxpdGUgY29ubmVjdGlvbi5cbiAgICogQHJldHVybnMge1Byb21pc2U8Ym9vbGVhbj59IC0gV2hldGhlciBhIGNvbHVtbiB3YXMgYWRkZWQuXG4gICAqL1xuICBhc3luYyBfZW5zdXJlSm9iQ29sdW1ucyhkYikge1xuICAgIGRiLmNsZWFyU2NoZW1hQ2FjaGUoKVxuICAgIGNvbnN0IHRhYmxlID0gYXdhaXQgZGIuZ2V0VGFibGVCeU5hbWVPckZhaWwoTE9DQUxfQkFDS0dST1VORF9KT0JTX1RBQkxFKVxuICAgIGNvbnN0IHRhYmxlRGF0YSA9IG5ldyBUYWJsZURhdGEoTE9DQUxfQkFDS0dST1VORF9KT0JTX1RBQkxFKVxuICAgIGxldCBhZGRlZCA9IGZhbHNlXG5cbiAgICBmb3IgKGNvbnN0IGNvbHVtbiBvZiB0aGlzLl9qb2JzVGFibGVEYXRhKCkuZ2V0Q29sdW1ucygpKSB7XG4gICAgICBpZiAoYXdhaXQgdGFibGUuZ2V0Q29sdW1uQnlOYW1lKGNvbHVtbi5nZXROYW1lKCkpKSBjb250aW51ZVxuICAgICAgaWYgKGNvbHVtbi5nZXRQcmltYXJ5S2V5KCkpIGNvbnRpbnVlXG5cbiAgICAgIGNvbnN0IGNvbHVtbkFyZ3MgPSAvKiogQHR5cGUge3tudWxsOiBib29sZWFuLCBtYXhMZW5ndGg/OiBudW1iZXJ9fSAqLyAoe251bGw6IGNvbHVtbi5nZXROdWxsKCkgIT09IGZhbHNlfSlcbiAgICAgIGNvbnN0IG1heExlbmd0aCA9IGNvbHVtbi5nZXRNYXhMZW5ndGgoKVxuXG4gICAgICBpZiAodHlwZW9mIG1heExlbmd0aCA9PT0gXCJudW1iZXJcIikgY29sdW1uQXJncy5tYXhMZW5ndGggPSBtYXhMZW5ndGhcblxuICAgICAgY29uc3QgdHlwZSA9IGNvbHVtbi5nZXRUeXBlKClcbiAgICAgIGlmICh0eXBlID09PSBcInN0cmluZ1wiKSB0YWJsZURhdGEuc3RyaW5nKGNvbHVtbi5nZXROYW1lKCksIGNvbHVtbkFyZ3MpXG4gICAgICBlbHNlIGlmICh0eXBlID09PSBcInRleHRcIikgdGFibGVEYXRhLnRleHQoY29sdW1uLmdldE5hbWUoKSwgY29sdW1uQXJncylcbiAgICAgIGVsc2UgaWYgKHR5cGUgPT09IFwiYmlnaW50XCIpIHRhYmxlRGF0YS5iaWdpbnQoY29sdW1uLmdldE5hbWUoKSwgY29sdW1uQXJncylcbiAgICAgIGVsc2UgaWYgKHR5cGUgPT09IFwiaW50ZWdlclwiKSB0YWJsZURhdGEuaW50ZWdlcihjb2x1bW4uZ2V0TmFtZSgpLCBjb2x1bW5BcmdzKVxuICAgICAgZWxzZSBpZiAodHlwZSA9PT0gXCJib29sZWFuXCIpIHRhYmxlRGF0YS5ib29sZWFuKGNvbHVtbi5nZXROYW1lKCksIGNvbHVtbkFyZ3MpXG4gICAgICBlbHNlIGNvbnRpbnVlXG4gICAgICBhZGRlZCA9IHRydWVcbiAgICB9XG5cbiAgICBpZiAoIWFkZGVkKSByZXR1cm4gZmFsc2VcblxuICAgIGZvciAoY29uc3Qgc3FsIG9mIGF3YWl0IGRiLmFsdGVyVGFibGVTUUxzKHRhYmxlRGF0YSkpIGF3YWl0IGRiLnF1ZXJ5KHNxbClcbiAgICBkYi5jbGVhclNjaGVtYUNhY2hlKClcbiAgICByZXR1cm4gdHJ1ZVxuICB9XG5cbiAgLyoqXG4gICAqIEJ1aWxkcyB0aGUgbWlncmF0aW9uIGxlZGdlciB0YWJsZSBkZWZpbml0aW9uLlxuICAgKiBAcmV0dXJucyB7VGFibGVEYXRhfSAtIE1pZ3JhdGlvbiBsZWRnZXIgdGFibGUuXG4gICAqL1xuICBfbWlncmF0aW9uc1RhYmxlRGF0YSgpIHtcbiAgICBjb25zdCB0YWJsZSA9IG5ldyBUYWJsZURhdGEoTUlHUkFUSU9OU19UQUJMRSwge2lmTm90RXhpc3RzOiB0cnVlfSlcblxuICAgIHRhYmxlLnN0cmluZyhcImtleVwiLCB7bnVsbDogZmFsc2UsIHByaW1hcnlLZXk6IHRydWV9KVxuICAgIHRhYmxlLnN0cmluZyhcInNjb3BlXCIsIHtudWxsOiBmYWxzZX0pXG4gICAgdGFibGUuc3RyaW5nKFwidmVyc2lvblwiLCB7bnVsbDogZmFsc2V9KVxuICAgIHRhYmxlLmJpZ2ludChcImFwcGxpZWRfYXRfbXNcIiwge251bGw6IGZhbHNlfSlcbiAgICByZXR1cm4gdGFibGVcbiAgfVxuXG4gIC8qKlxuICAgKiBCdWlsZHMgdGhlIGxvY2FsIGpvYnMgdGFibGUgZGVmaW5pdGlvbi5cbiAgICogQHJldHVybnMge1RhYmxlRGF0YX0gLSBMb2NhbCBqb2JzIHRhYmxlIGRlZmluaXRpb24uXG4gICAqL1xuICBfam9ic1RhYmxlRGF0YSgpIHtcbiAgICBjb25zdCB0YWJsZSA9IG5ldyBUYWJsZURhdGEoTE9DQUxfQkFDS0dST1VORF9KT0JTX1RBQkxFLCB7aWZOb3RFeGlzdHM6IHRydWV9KVxuXG4gICAgdGFibGUuc3RyaW5nKFwiaWRcIiwge251bGw6IGZhbHNlLCBwcmltYXJ5S2V5OiB0cnVlfSlcbiAgICB0YWJsZS5zdHJpbmcoXCJqb2JfbmFtZVwiLCB7bnVsbDogZmFsc2V9KVxuICAgIHRhYmxlLnRleHQoXCJhcmdzX2pzb25cIiwge251bGw6IGZhbHNlfSlcbiAgICB0YWJsZS5zdHJpbmcoXCJhcmdzX2RpZ2VzdFwiLCB7bWF4TGVuZ3RoOiA2NCwgbnVsbDogZmFsc2V9KVxuICAgIHRhYmxlLnN0cmluZyhcImV4ZWN1dGlvbl9tb2RlXCIsIHtudWxsOiBmYWxzZX0pXG4gICAgdGFibGUuc3RyaW5nKFwicXVldWVcIiwge251bGw6IGZhbHNlfSlcbiAgICB0YWJsZS5zdHJpbmcoXCJzY2hlZHVsZV9rZXlcIiwge251bGw6IHRydWV9KVxuICAgIHRhYmxlLmJpZ2ludChcInNjaGVkdWxlX29yZGVyXCIsIHtudWxsOiB0cnVlfSlcbiAgICB0YWJsZS5pbnRlZ2VyKFwibWF4X3JldHJpZXNcIiwge251bGw6IGZhbHNlfSlcbiAgICB0YWJsZS5pbnRlZ2VyKFwiYXR0ZW1wdHNcIiwge251bGw6IGZhbHNlfSlcbiAgICB0YWJsZS5zdHJpbmcoXCJzdGF0dXNcIiwge251bGw6IGZhbHNlfSlcbiAgICB0YWJsZS5iaWdpbnQoXCJzY2hlZHVsZWRfYXRfbXNcIiwge251bGw6IGZhbHNlfSlcbiAgICB0YWJsZS5iaWdpbnQoXCJjcmVhdGVkX2F0X21zXCIsIHtudWxsOiBmYWxzZX0pXG4gICAgdGFibGUuYmlnaW50KFwiaGFuZGVkX29mZl9hdF9tc1wiLCB7bnVsbDogdHJ1ZX0pXG4gICAgdGFibGUuc3RyaW5nKFwiaGFuZG9mZl9pZFwiLCB7bnVsbDogdHJ1ZX0pXG4gICAgdGFibGUuc3RyaW5nKFwid29ya2VyX2lkXCIsIHtudWxsOiB0cnVlfSlcbiAgICB0YWJsZS5iaWdpbnQoXCJjb21wbGV0ZWRfYXRfbXNcIiwge251bGw6IHRydWV9KVxuICAgIHRhYmxlLmJpZ2ludChcImZhaWxlZF9hdF9tc1wiLCB7bnVsbDogdHJ1ZX0pXG4gICAgdGFibGUudGV4dChcImxhc3RfZXJyb3JcIiwge251bGw6IHRydWV9KVxuICAgIHRhYmxlLnN0cmluZyhcImNvbmN1cnJlbmN5X2tleVwiLCB7bnVsbDogdHJ1ZX0pXG4gICAgdGFibGUuaW50ZWdlcihcIm1heF9jb25jdXJyZW5jeVwiLCB7bnVsbDogdHJ1ZX0pXG4gICAgdGFibGUuYmlnaW50KFwiY2hpbGRfcmVjZWl2ZWRfYXRfbXNcIiwge251bGw6IHRydWV9KVxuICAgIHRhYmxlLmJpZ2ludChcImNoaWxkX3N0YXJ0ZWRfYXRfbXNcIiwge251bGw6IHRydWV9KVxuICAgIHRhYmxlLnN0cmluZyhcImNoaWxkX2luc3RhbmNlX2lkXCIsIHtudWxsOiB0cnVlfSlcbiAgICB0YWJsZS5pbnRlZ2VyKFwiY2hpbGRfcGlkXCIsIHtudWxsOiB0cnVlfSlcbiAgICB0YWJsZS5hZGRJbmRleChuZXcgVGFibGVJbmRleChbXCJzdGF0dXNcIiwgXCJzY2hlZHVsZWRfYXRfbXNcIiwgXCJjcmVhdGVkX2F0X21zXCIsIFwiaWRcIl0sIHtuYW1lOiBMT0NBTF9CQUNLR1JPVU5EX0pPQlNfSU5ERVhfTkFNRVNbMF19KSlcbiAgICB0YWJsZS5hZGRJbmRleChuZXcgVGFibGVJbmRleChbXCJxdWV1ZVwiLCBcInN0YXR1c1wiLCBcImNyZWF0ZWRfYXRfbXNcIl0sIHtuYW1lOiBMT0NBTF9CQUNLR1JPVU5EX0pPQlNfSU5ERVhfTkFNRVNbMV19KSlcbiAgICB0YWJsZS5hZGRJbmRleChuZXcgVGFibGVJbmRleChbXCJhcmdzX2RpZ2VzdFwiXSwge25hbWU6IExPQ0FMX0JBQ0tHUk9VTkRfSk9CU19JTkRFWF9OQU1FU1syXX0pKVxuICAgIHRhYmxlLmFkZEluZGV4KG5ldyBUYWJsZUluZGV4KFtcInN0YXR1c1wiLCBcImNvbmN1cnJlbmN5X2tleVwiLCBcInNjaGVkdWxlZF9hdF9tc1wiXSwge25hbWU6IExPQ0FMX0JBQ0tHUk9VTkRfSk9CU19JTkRFWF9OQU1FU1szXX0pKVxuICAgIHRhYmxlLmFkZEluZGV4KG5ldyBUYWJsZUluZGV4KFtcInNjaGVkdWxlX2tleVwiLCBcImNyZWF0ZWRfYXRfbXNcIiwgXCJpZFwiXSwge25hbWU6IExPQ0FMX0JBQ0tHUk9VTkRfSk9CU19JTkRFWF9OQU1FU1s0XX0pKVxuICAgIHRhYmxlLmFkZEluZGV4KG5ldyBUYWJsZUluZGV4KFtcInNjaGVkdWxlX2tleVwiLCBcInNjaGVkdWxlX29yZGVyXCIsIFwiY3JlYXRlZF9hdF9tc1wiLCBcImlkXCJdLCB7bmFtZTogTE9DQUxfQkFDS0dST1VORF9KT0JTX0lOREVYX05BTUVTWzVdfSkpXG4gICAgcmV0dXJuIHRhYmxlXG4gIH1cblxuICAvKipcbiAgICogQnVpbGRzIHRoZSBsb2NhbCBjb25jdXJyZW5jeSBjb3VudGVyIHRhYmxlIGRlZmluaXRpb24uXG4gICAqIEByZXR1cm5zIHtUYWJsZURhdGF9IC0gQ29uY3VycmVuY3kgY291bnRlciB0YWJsZSBkZWZpbml0aW9uLlxuICAgKi9cbiAgX2NvbmN1cnJlbmN5VGFibGVEYXRhKCkge1xuICAgIGNvbnN0IHRhYmxlID0gbmV3IFRhYmxlRGF0YShMT0NBTF9CQUNLR1JPVU5EX0pPQl9DT05DVVJSRU5DWV9UQUJMRSwge2lmTm90RXhpc3RzOiB0cnVlfSlcblxuICAgIHRhYmxlLnN0cmluZyhcImNvbmN1cnJlbmN5X2tleVwiLCB7bnVsbDogZmFsc2UsIHByaW1hcnlLZXk6IHRydWV9KVxuICAgIHRhYmxlLmludGVnZXIoXCJtYXhfY29uY3VycmVuY3lcIiwge251bGw6IGZhbHNlfSlcbiAgICB0YWJsZS5pbnRlZ2VyKFwiYWN0aXZlX2NvdW50XCIsIHtudWxsOiBmYWxzZX0pXG4gICAgcmV0dXJuIHRhYmxlXG4gIH1cblxuICAvKipcbiAgICogQnVpbGRzIHRoZSBzdGFibGUgc2NoZWR1bGUtb3duZXIgdGFibGUgZGVmaW5pdGlvbi5cbiAgICogQHJldHVybnMge1RhYmxlRGF0YX0gLSBTdGFibGUgb3duZXIgdGFibGUgZGVmaW5pdGlvbi5cbiAgICovXG4gIF9zY2hlZHVsZUtleXNUYWJsZURhdGEoKSB7XG4gICAgY29uc3QgdGFibGUgPSBuZXcgVGFibGVEYXRhKExPQ0FMX0JBQ0tHUk9VTkRfSk9CX1NDSEVEVUxFX0tFWVNfVEFCTEUsIHtpZk5vdEV4aXN0czogdHJ1ZX0pXG5cbiAgICB0YWJsZS5zdHJpbmcoXCJzY2hlZHVsZV9rZXlcIiwge251bGw6IGZhbHNlLCBwcmltYXJ5S2V5OiB0cnVlfSlcbiAgICB0YWJsZS5zdHJpbmcoXCJqb2JfaWRcIiwge251bGw6IGZhbHNlfSlcbiAgICB0YWJsZS5hZGRJbmRleChuZXcgVGFibGVJbmRleChbXCJqb2JfaWRcIl0sIHtuYW1lOiBMT0NBTF9CQUNLR1JPVU5EX0pPQl9TQ0hFRFVMRV9LRVlTX0lOREVYX05BTUVTWzBdfSkpXG4gICAgcmV0dXJuIHRhYmxlXG4gIH1cblxuICAvKipcbiAgICogUmVqZWN0cyBhbiBpbmNvbXBhdGlibGUgY3VycmVudC12ZXJzaW9uIHRhYmxlIHJhdGhlciB0aGFuIHJlYnVpbGRpbmcgZGF0YS5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9kYXRhYmFzZS9kcml2ZXJzL2Jhc2UuanNcIikuZGVmYXVsdH0gZGIgLSBMb2NhbCBTUUxpdGUgY29ubmVjdGlvbi5cbiAgICogQHBhcmFtIHtzdHJpbmd9IHRhYmxlTmFtZSAtIFRhYmxlIG5hbWUuXG4gICAqIEBwYXJhbSB7c3RyaW5nW119IGV4cGVjdGVkQ29sdW1ucyAtIFJlcXVpcmVkIGNvbHVtbnMuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIHdoZW4gY29tcGF0aWJsZS5cbiAgICovXG4gIGFzeW5jIF9hc3NlcnRDb2x1bW5zKGRiLCB0YWJsZU5hbWUsIGV4cGVjdGVkQ29sdW1ucykge1xuICAgIGNvbnN0IHRhYmxlID0gYXdhaXQgZGIuZ2V0VGFibGVCeU5hbWVPckZhaWwodGFibGVOYW1lKVxuICAgIGNvbnN0IGNvbHVtbnMgPSBhd2FpdCB0YWJsZS5nZXRDb2x1bW5zKClcbiAgICBjb25zdCBuYW1lcyA9IG5ldyBTZXQoY29sdW1ucy5tYXAoKGNvbHVtbikgPT4gY29sdW1uLmdldE5hbWUoKSkpXG4gICAgY29uc3QgbWlzc2luZyA9IGV4cGVjdGVkQ29sdW1ucy5maWx0ZXIoKGNvbHVtbk5hbWUpID0+ICFuYW1lcy5oYXMoY29sdW1uTmFtZSkpXG5cbiAgICBpZiAobWlzc2luZy5sZW5ndGggPT09IDApIHJldHVyblxuXG4gICAgY29uc3QgZXJyb3IgPSBuZXcgRXJyb3IoYEluY29tcGF0aWJsZSBsb2NhbCBiYWNrZ3JvdW5kLWpvYnMgc2NoZW1hIGZvciAke3RhYmxlTmFtZX07IG1pc3NpbmcgY29sdW1uczogJHttaXNzaW5nLmpvaW4oXCIsIFwiKX1gKVxuXG4gICAgdGhpcy5fcmVwb3J0RnJhbWV3b3JrRXJyb3Ioe2Vycm9yLCBzdGFnZTogXCJsb2NhbC1iYWNrZ3JvdW5kLWpvYnMtc2NoZW1hXCJ9KVxuICAgIHRocm93IGVycm9yXG4gIH1cblxuICAvKipcbiAgICogUmVjcmVhdGVzIG1pc3NpbmcgaW5kZXhlcyBkZWNsYXJlZCBieSB0aGUgY3VycmVudCBzY2hlbWEuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vZGF0YWJhc2UvZHJpdmVycy9iYXNlLmpzXCIpLmRlZmF1bHR9IGRiIC0gTG9jYWwgU1FMaXRlIGNvbm5lY3Rpb24uXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPGJvb2xlYW4+fSAtIFdoZXRoZXIgYW4gaW5kZXggd2FzIGNyZWF0ZWQuXG4gICAqL1xuICBhc3luYyBfZW5zdXJlSW5kZXhlcyhkYikge1xuICAgIGRiLmNsZWFyU2NoZW1hQ2FjaGUoKVxuICAgIGxldCBjaGFuZ2VkID0gZmFsc2VcbiAgICAvKiogQHR5cGUge0FycmF5PFtzdHJpbmcsIFRhYmxlRGF0YV0+fSAqL1xuICAgIGNvbnN0IGRlZmluaXRpb25zID0gW1xuICAgICAgW0xPQ0FMX0JBQ0tHUk9VTkRfSk9CU19UQUJMRSwgdGhpcy5fam9ic1RhYmxlRGF0YSgpXSxcbiAgICAgIFtMT0NBTF9CQUNLR1JPVU5EX0pPQl9TQ0hFRFVMRV9LRVlTX1RBQkxFLCB0aGlzLl9zY2hlZHVsZUtleXNUYWJsZURhdGEoKV1cbiAgICBdXG5cbiAgICBmb3IgKGNvbnN0IFt0YWJsZU5hbWUsIHRhYmxlRGF0YV0gb2YgZGVmaW5pdGlvbnMpIHtcbiAgICAgIGNvbnN0IHRhYmxlID0gYXdhaXQgZGIuZ2V0VGFibGVCeU5hbWVPckZhaWwodGFibGVOYW1lKVxuICAgICAgY29uc3QgZXhpc3RpbmdOYW1lcyA9IG5ldyBTZXQoKGF3YWl0IHRhYmxlLmdldEluZGV4ZXMoKSkubWFwKChpbmRleCkgPT4gaW5kZXguZ2V0TmFtZSgpKSlcblxuICAgICAgZm9yIChjb25zdCBpbmRleCBvZiB0YWJsZURhdGEuZ2V0SW5kZXhlcygpKSB7XG4gICAgICAgIGNvbnN0IGluZGV4TmFtZSA9IGluZGV4LmdldE5hbWUoKVxuXG4gICAgICAgIGlmICghaW5kZXhOYW1lIHx8IGV4aXN0aW5nTmFtZXMuaGFzKGluZGV4TmFtZSkpIGNvbnRpbnVlXG5cbiAgICAgICAgY29uc3Qgc3FscyA9IGF3YWl0IGRiLmNyZWF0ZUluZGV4U1FMcyh7XG4gICAgICAgICAgY29sdW1uczogaW5kZXguZ2V0Q29sdW1ucygpLFxuICAgICAgICAgIGlmTm90RXhpc3RzOiB0cnVlLFxuICAgICAgICAgIG5hbWU6IGluZGV4TmFtZSxcbiAgICAgICAgICB0YWJsZU5hbWUsXG4gICAgICAgICAgdW5pcXVlOiBpbmRleC5nZXRVbmlxdWUoKVxuICAgICAgICB9KVxuXG4gICAgICAgIGZvciAoY29uc3Qgc3FsIG9mIHNxbHMpIGF3YWl0IGRiLnF1ZXJ5KHNxbClcbiAgICAgICAgY2hhbmdlZCA9IHRydWVcbiAgICAgIH1cbiAgICB9XG5cbiAgICBpZiAoY2hhbmdlZCkgZGIuY2xlYXJTY2hlbWFDYWNoZSgpXG4gICAgcmV0dXJuIGNoYW5nZWRcbiAgfVxuXG4gIC8qKlxuICAgKiBDaGVja3Mgd2hldGhlciB0aGUgY3VycmVudCBsb2NhbCBzY2hlbWEgdmVyc2lvbiBpcyByZWNvcmRlZC5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9kYXRhYmFzZS9kcml2ZXJzL2Jhc2UuanNcIikuZGVmYXVsdH0gZGIgLSBDb25uZWN0aW9uLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gdmVyc2lvbiAtIExvY2FsIHNjaGVtYSB2ZXJzaW9uLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxib29sZWFuPn0gLSBXaGV0aGVyIHRoZSB2ZXJzaW9uIGlzIHJlY29yZGVkLlxuICAgKi9cbiAgYXN5bmMgX2hhc01pZ3JhdGlvbihkYiwgdmVyc2lvbikge1xuICAgIGNvbnN0IHJvd3MgPSBhd2FpdCBkYlxuICAgICAgLm5ld1F1ZXJ5KClcbiAgICAgIC5mcm9tKE1JR1JBVElPTlNfVEFCTEUpXG4gICAgICAud2hlcmUoe2tleTogdGhpcy5fbWlncmF0aW9uS2V5KHZlcnNpb24pfSlcbiAgICAgIC5saW1pdCgxKVxuICAgICAgLnJlc3VsdHMoKVxuXG4gICAgcmV0dXJuIHJvd3MubGVuZ3RoID4gMFxuICB9XG5cbiAgLyoqXG4gICAqIFJlY29yZHMgb25lIGxvY2FsIHNjaGVtYSB2ZXJzaW9uIGFmdGVyIGl0cyBhZGRpdGl2ZSBjaGFuZ2VzIGFyZSBwcmVzZW50LlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL2RhdGFiYXNlL2RyaXZlcnMvYmFzZS5qc1wiKS5kZWZhdWx0fSBkYiAtIENvbm5lY3Rpb24uXG4gICAqIEBwYXJhbSB7c3RyaW5nfSB2ZXJzaW9uIC0gTG9jYWwgc2NoZW1hIHZlcnNpb24uXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIGFmdGVyIHJlY29yZGluZy5cbiAgICovXG4gIGFzeW5jIF9yZWNvcmRNaWdyYXRpb24oZGIsIHZlcnNpb24pIHtcbiAgICBhd2FpdCBkYi51cHNlcnQoe1xuICAgICAgdGFibGVOYW1lOiBNSUdSQVRJT05TX1RBQkxFLFxuICAgICAgZGF0YToge1xuICAgICAgICBhcHBsaWVkX2F0X21zOiB0aGlzLmNsb2NrLm5vdygpLFxuICAgICAgICBrZXk6IHRoaXMuX21pZ3JhdGlvbktleSh2ZXJzaW9uKSxcbiAgICAgICAgc2NvcGU6IE1JR1JBVElPTl9TQ09QRSxcbiAgICAgICAgdmVyc2lvblxuICAgICAgfSxcbiAgICAgIGNvbmZsaWN0Q29sdW1uczogW1wia2V5XCJdLFxuICAgICAgdXBkYXRlQ29sdW1uczogW1wic2NvcGVcIiwgXCJ2ZXJzaW9uXCIsIFwiYXBwbGllZF9hdF9tc1wiXVxuICAgIH0pXG4gIH1cblxuICAvKipcbiAgICogQnVpbGRzIHRoZSBzY29wZWQgbWlncmF0aW9uIGtleS5cbiAgICogQHBhcmFtIHtzdHJpbmd9IHZlcnNpb24gLSBMb2NhbCBzY2hlbWEgdmVyc2lvbi5cbiAgICogQHJldHVybnMge3N0cmluZ30gLSBTY29wZWQgbWlncmF0aW9uIGtleS5cbiAgICovXG4gIF9taWdyYXRpb25LZXkodmVyc2lvbikgeyByZXR1cm4gYCR7TUlHUkFUSU9OX1NDT1BFfToke3ZlcnNpb259YCB9XG5cbiAgLyoqXG4gICAqIEVucXVldWVzIGEgbG9jYWwgam9iIGluIHRoZSBjYWxsZXIncyBhY3RpdmUgdHJhbnNhY3Rpb24gd2hlbiBwcmVzZW50LlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIEVucXVldWUgcmVxdWVzdC5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGFyZ3Muam9iTmFtZSAtIFJlZ2lzdGVyZWQgam9iIG5hbWUuXG4gICAqIEBwYXJhbSB7QXJyYXk8UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSBhcmdzLmFyZ3MgLSBTZXJpYWxpemVkIGpvYiBhcmd1bWVudHMuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi90eXBlcy5qc1wiKS5CYWNrZ3JvdW5kSm9iT3B0aW9uc30gW2FyZ3Mub3B0aW9uc10gLSBKb2Igb3B0aW9ucy5cbiAgICogQHJldHVybnMge1Byb21pc2U8c3RyaW5nPn0gLSBEdXJhYmxlIGpvYiBpZC5cbiAgICovXG4gIGFzeW5jIGVucXVldWUoe2pvYk5hbWUsIGFyZ3MsIG9wdGlvbnMgPSB7fX0pIHtcbiAgICBhd2FpdCB0aGlzLmVuc3VyZVJlYWR5KClcblxuICAgIGNvbnN0IHByZXBhcmVkSm9iID0gdGhpcy5fcHJlcGFyZUpvYih7YXJncywgam9iTmFtZSwgb3B0aW9uc30pXG4gICAgY29uc3QgbXV0YXRlID0gYXN5bmMgKGhvbGRVbnRpbCA9ICgvKiogQHR5cGUge1Byb21pc2U8dm9pZD59ICovIF9jb21wbGV0aW9uKSA9PiB7fSkgPT4gYXdhaXQgdGhpcy5fd2l0aERiKGFzeW5jIChjb25uZWN0aW9uKSA9PiB7XG4gICAgICBpZiAoY29ubmVjdGlvbi5pbnNpZGVUcmFuc2FjdGlvbigpKSBob2xkVW50aWwoY29ubmVjdGlvbi50cmFuc2FjdGlvbkNvbXBsZXRpb24oKSlcblxuICAgICAgcmV0dXJuIGF3YWl0IHRoaXMuX211dGF0ZShjb25uZWN0aW9uLCBhc3luYyAoZGIpID0+IHtcbiAgICAgICAgbGV0IGpvYklkID0gcHJlcGFyZWRKb2Iuam9iSWRcblxuICAgICAgICBpZiAocHJlcGFyZWRKb2IuY29uY3VycmVuY3kpIGF3YWl0IHRoaXMuX2Vuc3VyZUNvbmN1cnJlbmN5KGRiLCBwcmVwYXJlZEpvYi5jb25jdXJyZW5jeSlcblxuICAgICAgICBpZiAob3B0aW9ucy5kZWR1cGxpY2F0ZVdoaWxlUXVldWVkKSB7XG4gICAgICAgICAgY29uc3QgZXhpc3RpbmcgPSBhd2FpdCBkYlxuICAgICAgICAgICAgLm5ld1F1ZXJ5KClcbiAgICAgICAgICAgIC5mcm9tKExPQ0FMX0JBQ0tHUk9VTkRfSk9CU19UQUJMRSlcbiAgICAgICAgICAgIC5zZWxlY3QoXCJpZFwiKVxuICAgICAgICAgICAgLndoZXJlKHtcbiAgICAgICAgICAgICAgYXJnc19kaWdlc3Q6IHByZXBhcmVkSm9iLmFyZ3NEaWdlc3QsXG4gICAgICAgICAgICAgIGFyZ3NfanNvbjogcHJlcGFyZWRKb2IuYXJnc0pzb24sXG4gICAgICAgICAgICAgIGpvYl9uYW1lOiBwcmVwYXJlZEpvYi5qb2JOYW1lLFxuICAgICAgICAgICAgICBxdWV1ZTogcHJlcGFyZWRKb2IucXVldWUsXG4gICAgICAgICAgICAgIHN0YXR1czogXCJxdWV1ZWRcIlxuICAgICAgICAgICAgfSlcbiAgICAgICAgICAgIC53aGVyZShgc2NoZWR1bGVkX2F0X21zIDw9ICR7ZGIucXVvdGUocHJlcGFyZWRKb2Iuc2NoZWR1bGVkQXRNcyl9YClcbiAgICAgICAgICAgIC5vcmRlcihcInNjaGVkdWxlZF9hdF9tcyBBU0NcIilcbiAgICAgICAgICAgIC5vcmRlcihcImNyZWF0ZWRfYXRfbXMgQVNDXCIpXG4gICAgICAgICAgICAubGltaXQoMSlcbiAgICAgICAgICAgIC5yZXN1bHRzKClcblxuICAgICAgICAgIGNvbnN0IGV4aXN0aW5nUm93ID0gLyoqIEB0eXBlIHt7aWQ6IHN0cmluZyB8IG51bWJlcn0gfCB1bmRlZmluZWR9ICovIChleGlzdGluZ1swXSlcblxuICAgICAgICAgIGlmIChleGlzdGluZ1Jvdykgam9iSWQgPSBTdHJpbmcoZXhpc3RpbmdSb3cuaWQpXG4gICAgICAgIH1cblxuICAgICAgICBpZiAoam9iSWQgPT09IHByZXBhcmVkSm9iLmpvYklkKSBhd2FpdCB0aGlzLl9pbnNlcnRQcmVwYXJlZEpvYihkYiwgcHJlcGFyZWRKb2IpXG4gICAgICAgIGlmICh0aGlzLm9uQ29tbWl0dGVkRW5xdWV1ZSkgYXdhaXQgZGIuYWZ0ZXJDb21taXQodGhpcy5vbkNvbW1pdHRlZEVucXVldWUpXG5cbiAgICAgICAgcmV0dXJuIGpvYklkXG4gICAgICB9KVxuICAgIH0pXG5cbiAgICBpZiAob3B0aW9ucy5kZWR1cGxpY2F0ZVdoaWxlUXVldWVkKSByZXR1cm4gYXdhaXQgdGhpcy5fc2VyaWFsaXplRGVkdXBsaWNhdGVkRW5xdWV1ZShwcmVwYXJlZEpvYiwgbXV0YXRlKVxuICAgIHJldHVybiBhd2FpdCBtdXRhdGUoKVxuICB9XG5cbiAgLyoqXG4gICAqIFJlcGxhY2VzIHRoZSBxdWV1ZWQgb3duZXIgb2YgYSBzdGFibGUgc2NoZWR1bGUga2V5IHdpdGggYSBuZXcgbG9jYWwgam9iLlxuICAgKiBBIGhhbmRlZC1vZmYgb3duZXIgcmVtYWlucyBydW5uYWJsZSBidXQgaXMgZGV0YWNoZWQgZnJvbSBmdXR1cmUgb3duZXJzaGlwLlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIFJlcGxhY2VtZW50IHJlcXVlc3QuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBhcmdzLnNjaGVkdWxlS2V5IC0gU3RhYmxlIGxvZ2ljYWwgc2NoZWR1bGUga2V5LlxuICAgKiBAcGFyYW0ge3N0cmluZ30gYXJncy5qb2JOYW1lIC0gUmVnaXN0ZXJlZCBqb2IgbmFtZS5cbiAgICogQHBhcmFtIHtBcnJheTxSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59IGFyZ3MuYXJncyAtIFNlcmlhbGl6ZWQgam9iIGFyZ3VtZW50cy5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL3R5cGVzLmpzXCIpLkJhY2tncm91bmRKb2JPcHRpb25zfSBbYXJncy5vcHRpb25zXSAtIEpvYiBvcHRpb25zLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxpbXBvcnQoXCIuL3R5cGVzLmpzXCIpLkJhY2tncm91bmRKb2JSZXBsYWNlbWVudFJlc3VsdD59IC0gUmVwbGFjZW1lbnQgcmVzdWx0LlxuICAgKi9cbiAgYXN5bmMgcmVwbGFjZVNjaGVkdWxlZCh7c2NoZWR1bGVLZXksIGpvYk5hbWUsIGFyZ3MsIG9wdGlvbnMgPSB7fX0pIHtcbiAgICBhd2FpdCB0aGlzLmVuc3VyZVJlYWR5KClcblxuICAgIGNvbnN0IG5vcm1hbGl6ZWRTY2hlZHVsZUtleSA9IG5vcm1hbGl6ZUJhY2tncm91bmRKb2JTY2hlZHVsZUtleShzY2hlZHVsZUtleSlcbiAgICBjb25zdCBwcmVwYXJlZEpvYiA9IHRoaXMuX3ByZXBhcmVKb2Ioe2FyZ3MsIGpvYk5hbWUsIG9wdGlvbnN9KVxuXG4gICAgcmV0dXJuIGF3YWl0IHRoaXMuX3dpdGhEYihhc3luYyAoY29ubmVjdGlvbikgPT4gYXdhaXQgdGhpcy5fbXV0YXRlKGNvbm5lY3Rpb24sIGFzeW5jIChkYikgPT4ge1xuICAgICAgYXdhaXQgdGhpcy5fbG9ja1NjaGVkdWxlS2V5KGRiLCBub3JtYWxpemVkU2NoZWR1bGVLZXkpXG4gICAgICBjb25zdCBvd25lckpvYiA9IGF3YWl0IHRoaXMuX3NjaGVkdWxlZE93bmVySm9iKGRiLCBub3JtYWxpemVkU2NoZWR1bGVLZXkpXG4gICAgICAvKiogQHR5cGUge2ltcG9ydChcIi4vdHlwZXMuanNcIikuQmFja2dyb3VuZEpvYlJlcGxhY2VtZW50UHJldmlvdXNTdGF0dXN9ICovXG4gICAgICBsZXQgcHJldmlvdXNTdGF0dXMgPSBudWxsXG4gICAgICBsZXQgcHJldmlvdXNKb2JJZCA9IG51bGxcblxuICAgICAgaWYgKG93bmVySm9iPy5zdGF0dXMgPT09IFwicXVldWVkXCIpIHtcbiAgICAgICAgY29uc3QgYWZmZWN0ZWRSb3dzID0gYXdhaXQgdGhpcy5fdXBkYXRlQWZmZWN0ZWRSb3dzKGRiLCB7XG4gICAgICAgICAgY29uZGl0aW9uczoge2lkOiBvd25lckpvYi5pZCwgc3RhdHVzOiBcInF1ZXVlZFwifSxcbiAgICAgICAgICBkYXRhOiB7c3RhdHVzOiBcImNhbmNlbGxlZFwifSxcbiAgICAgICAgICB0YWJsZU5hbWU6IExPQ0FMX0JBQ0tHUk9VTkRfSk9CU19UQUJMRVxuICAgICAgICB9KVxuXG4gICAgICAgIGlmIChhZmZlY3RlZFJvd3MgPT09IDEpIHtcbiAgICAgICAgICBwcmV2aW91c0pvYklkID0gb3duZXJKb2IuaWRcbiAgICAgICAgICBwcmV2aW91c1N0YXR1cyA9IFwicXVldWVkXCJcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICBjb25zdCBjdXJyZW50T3duZXJKb2IgPSBhd2FpdCB0aGlzLl9nZXRKb2IoZGIsIG93bmVySm9iLmlkKVxuXG4gICAgICAgICAgaWYgKGN1cnJlbnRPd25lckpvYj8uc3RhdHVzID09PSBcImhhbmRlZF9vZmZcIikge1xuICAgICAgICAgICAgcHJldmlvdXNKb2JJZCA9IGN1cnJlbnRPd25lckpvYi5pZFxuICAgICAgICAgICAgcHJldmlvdXNTdGF0dXMgPSBcImhhbmRlZF9vZmZcIlxuICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgICAgfSBlbHNlIGlmIChvd25lckpvYj8uc3RhdHVzID09PSBcImhhbmRlZF9vZmZcIikge1xuICAgICAgICBwcmV2aW91c0pvYklkID0gb3duZXJKb2IuaWRcbiAgICAgICAgcHJldmlvdXNTdGF0dXMgPSBcImhhbmRlZF9vZmZcIlxuICAgICAgfVxuXG4gICAgICBjb25zdCBzY2hlZHVsZU9yZGVyID0gYXdhaXQgdGhpcy5fbmV4dFNjaGVkdWxlT3JkZXIoZGIsIG5vcm1hbGl6ZWRTY2hlZHVsZUtleSlcblxuICAgICAgaWYgKHByZXBhcmVkSm9iLmNvbmN1cnJlbmN5KSBhd2FpdCB0aGlzLl9lbnN1cmVDb25jdXJyZW5jeShkYiwgcHJlcGFyZWRKb2IuY29uY3VycmVuY3kpXG4gICAgICBhd2FpdCB0aGlzLl9pbnNlcnRQcmVwYXJlZEpvYihkYiwgcHJlcGFyZWRKb2IsIG5vcm1hbGl6ZWRTY2hlZHVsZUtleSwgc2NoZWR1bGVPcmRlcilcbiAgICAgIGF3YWl0IGRiLnVwc2VydCh7XG4gICAgICAgIGNvbmZsaWN0Q29sdW1uczogW1wic2NoZWR1bGVfa2V5XCJdLFxuICAgICAgICBkYXRhOiB7am9iX2lkOiBwcmVwYXJlZEpvYi5qb2JJZCwgc2NoZWR1bGVfa2V5OiBub3JtYWxpemVkU2NoZWR1bGVLZXl9LFxuICAgICAgICB0YWJsZU5hbWU6IExPQ0FMX0JBQ0tHUk9VTkRfSk9CX1NDSEVEVUxFX0tFWVNfVEFCTEUsXG4gICAgICAgIHVwZGF0ZUNvbHVtbnM6IFtcImpvYl9pZFwiXVxuICAgICAgfSlcbiAgICAgIGF3YWl0IHRoaXMuX3dha2VEaXNwYXRjaGVyQWZ0ZXJDb21taXQoZGIpXG5cbiAgICAgIHJldHVybiB7am9iSWQ6IHByZXBhcmVkSm9iLmpvYklkLCBwcmV2aW91c0pvYklkLCBwcmV2aW91c1N0YXR1c31cbiAgICB9KSlcbiAgfVxuXG4gIC8qKlxuICAgKiBDYW5jZWxzIGEgcXVldWVkIHN0YWJsZSBvd25lciBvciBkZXRhY2hlcyBhbiBhY3RpdmUgaGFuZG9mZiB0cnV0aGZ1bGx5LlxuICAgKiBAcGFyYW0ge3N0cmluZ30gc2NoZWR1bGVLZXkgLSBTdGFibGUgbG9naWNhbCBzY2hlZHVsZSBrZXkuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPGltcG9ydChcIi4vdHlwZXMuanNcIikuQmFja2dyb3VuZEpvYkNhbmNlbGxhdGlvblJlc3VsdD59IC0gQ2FuY2VsbGF0aW9uIHJlc3VsdC5cbiAgICovXG4gIGFzeW5jIGNhbmNlbFNjaGVkdWxlZChzY2hlZHVsZUtleSkge1xuICAgIGF3YWl0IHRoaXMuZW5zdXJlUmVhZHkoKVxuXG4gICAgY29uc3Qgbm9ybWFsaXplZFNjaGVkdWxlS2V5ID0gbm9ybWFsaXplQmFja2dyb3VuZEpvYlNjaGVkdWxlS2V5KHNjaGVkdWxlS2V5KVxuXG4gICAgcmV0dXJuIGF3YWl0IHRoaXMuX3dpdGhEYihhc3luYyAoY29ubmVjdGlvbikgPT4gYXdhaXQgdGhpcy5fbXV0YXRlKGNvbm5lY3Rpb24sIGFzeW5jIChkYikgPT4ge1xuICAgICAgYXdhaXQgdGhpcy5fbG9ja1NjaGVkdWxlS2V5KGRiLCBub3JtYWxpemVkU2NoZWR1bGVLZXkpXG4gICAgICBjb25zdCBvd25lckpvYiA9IGF3YWl0IHRoaXMuX3NjaGVkdWxlZE93bmVySm9iKGRiLCBub3JtYWxpemVkU2NoZWR1bGVLZXkpXG5cbiAgICAgIGlmICghb3duZXJKb2IpIHtcbiAgICAgICAgYXdhaXQgdGhpcy5fcmVsZWFzZVNjaGVkdWxlT3duZXJzaGlwKGRiLCB7am9iSWQ6IG51bGwsIHNjaGVkdWxlS2V5OiBub3JtYWxpemVkU2NoZWR1bGVLZXl9KVxuICAgICAgICByZXR1cm4ge2pvYklkOiBudWxsLCBvdXRjb21lOiBcIm5vdF9mb3VuZFwifVxuICAgICAgfVxuXG4gICAgICBpZiAob3duZXJKb2Iuc3RhdHVzID09PSBcInF1ZXVlZFwiKSB7XG4gICAgICAgIGNvbnN0IGFmZmVjdGVkUm93cyA9IGF3YWl0IHRoaXMuX3VwZGF0ZUFmZmVjdGVkUm93cyhkYiwge1xuICAgICAgICAgIGNvbmRpdGlvbnM6IHtpZDogb3duZXJKb2IuaWQsIHN0YXR1czogXCJxdWV1ZWRcIn0sXG4gICAgICAgICAgZGF0YToge3N0YXR1czogXCJjYW5jZWxsZWRcIn0sXG4gICAgICAgICAgdGFibGVOYW1lOiBMT0NBTF9CQUNLR1JPVU5EX0pPQlNfVEFCTEVcbiAgICAgICAgfSlcblxuICAgICAgICBpZiAoYWZmZWN0ZWRSb3dzID09PSAxKSB7XG4gICAgICAgICAgYXdhaXQgdGhpcy5fcmVsZWFzZVNjaGVkdWxlT3duZXJzaGlwKGRiLCB7am9iSWQ6IG93bmVySm9iLmlkLCBzY2hlZHVsZUtleTogbm9ybWFsaXplZFNjaGVkdWxlS2V5fSlcbiAgICAgICAgICBhd2FpdCB0aGlzLl93YWtlRGlzcGF0Y2hlckFmdGVyQ29tbWl0KGRiKVxuICAgICAgICAgIHJldHVybiB7am9iSWQ6IG93bmVySm9iLmlkLCBvdXRjb21lOiBcImNhbmNlbGxlZFwifVxuICAgICAgICB9XG4gICAgICB9XG5cbiAgICAgIGNvbnN0IGN1cnJlbnRKb2IgPSBhd2FpdCB0aGlzLl9zY2hlZHVsZWRPd25lckpvYihkYiwgbm9ybWFsaXplZFNjaGVkdWxlS2V5KVxuXG4gICAgICBhd2FpdCB0aGlzLl9yZWxlYXNlU2NoZWR1bGVPd25lcnNoaXAoZGIsIHtqb2JJZDogb3duZXJKb2IuaWQsIHNjaGVkdWxlS2V5OiBub3JtYWxpemVkU2NoZWR1bGVLZXl9KVxuICAgICAgYXdhaXQgdGhpcy5fd2FrZURpc3BhdGNoZXJBZnRlckNvbW1pdChkYilcbiAgICAgIGlmIChjdXJyZW50Sm9iPy5zdGF0dXMgPT09IFwiaGFuZGVkX29mZlwiKSByZXR1cm4ge2pvYklkOiBjdXJyZW50Sm9iLmlkLCBvdXRjb21lOiBcImhhbmRlZF9vZmZcIn1cbiAgICAgIHJldHVybiB7am9iSWQ6IG51bGwsIG91dGNvbWU6IFwibm90X2ZvdW5kXCJ9XG4gICAgfSkpXG4gIH1cblxuICAvKipcbiAgICogUmVhZHMgc3RhYmxlIG93bmVyc2hpcCBhbmQgb3B0aW9uYWwgbGF0ZXN0IHRlcm1pbmFsIGhpc3RvcnkgaW4gb25lIHRyYW5zYWN0aW9uLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gc2NoZWR1bGVLZXkgLSBTdGFibGUgbG9naWNhbCBzY2hlZHVsZSBrZXkuXG4gICAqIEBwYXJhbSB7e2luY2x1ZGVMYXRlc3RUZXJtaW5hbD86IGJvb2xlYW59fSBbb3B0aW9uc10gLSBMb29rdXAgb3B0aW9ucy5cbiAgICogQHJldHVybnMge1Byb21pc2U8aW1wb3J0KFwiLi90eXBlcy5qc1wiKS5CYWNrZ3JvdW5kSm9iU2NoZWR1bGVkTG9va3VwUmVzdWx0Pn0gLSBOb3JtYWxpemVkIGxvY2FsIGpvYnMuXG4gICAqL1xuICBhc3luYyBnZXRTY2hlZHVsZWRKb2Ioc2NoZWR1bGVLZXksIHtpbmNsdWRlTGF0ZXN0VGVybWluYWwgPSBmYWxzZX0gPSB7fSkge1xuICAgIGF3YWl0IHRoaXMuZW5zdXJlUmVhZHkoKVxuXG4gICAgY29uc3Qgbm9ybWFsaXplZFNjaGVkdWxlS2V5ID0gbm9ybWFsaXplQmFja2dyb3VuZEpvYlNjaGVkdWxlS2V5KHNjaGVkdWxlS2V5KVxuXG4gICAgaWYgKHR5cGVvZiBpbmNsdWRlTGF0ZXN0VGVybWluYWwgIT09IFwiYm9vbGVhblwiKSB7XG4gICAgICB0aHJvdyBWZWxvY2lvdXNFcnJvci5zYWZlKFwiYmFja2dyb3VuZCBqb2IgaW5jbHVkZUxhdGVzdFRlcm1pbmFsIG11c3QgYmUgYSBib29sZWFuXCIpXG4gICAgfVxuXG4gICAgcmV0dXJuIGF3YWl0IHRoaXMuX3dpdGhEYihhc3luYyAoY29ubmVjdGlvbikgPT4gYXdhaXQgdGhpcy5fbXV0YXRlKGNvbm5lY3Rpb24sIGFzeW5jIChkYikgPT4ge1xuICAgICAgcmV0dXJuIGF3YWl0IHRoaXMuX3NjaGVkdWxlZEpvYkxvb2t1cChkYiwge1xuICAgICAgICBpbmNsdWRlTGF0ZXN0VGVybWluYWwsXG4gICAgICAgIHNjaGVkdWxlS2V5OiBub3JtYWxpemVkU2NoZWR1bGVLZXlcbiAgICAgIH0pXG4gICAgfSkpXG4gIH1cblxuICAvKipcbiAgICogTW92ZXMgb25seSBhIGZ1dHVyZSBxdWV1ZWQgc3RhYmxlIG93bmVyIHRvIHRoZSBjdXJyZW50IHRpbWUuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBzY2hlZHVsZUtleSAtIFN0YWJsZSBsb2dpY2FsIHNjaGVkdWxlIGtleS5cbiAgICogQHJldHVybnMge1Byb21pc2U8aW1wb3J0KFwiLi90eXBlcy5qc1wiKS5CYWNrZ3JvdW5kSm9iV2FrZVJlc3VsdD59IC0gRXhhY3Qgd2FrZSBvdXRjb21lLlxuICAgKi9cbiAgYXN5bmMgd2FrZVNjaGVkdWxlZChzY2hlZHVsZUtleSkge1xuICAgIGF3YWl0IHRoaXMuZW5zdXJlUmVhZHkoKVxuXG4gICAgY29uc3Qgbm9ybWFsaXplZFNjaGVkdWxlS2V5ID0gbm9ybWFsaXplQmFja2dyb3VuZEpvYlNjaGVkdWxlS2V5KHNjaGVkdWxlS2V5KVxuXG4gICAgcmV0dXJuIGF3YWl0IHRoaXMuX3dpdGhEYihhc3luYyAoY29ubmVjdGlvbikgPT4gYXdhaXQgdGhpcy5fbXV0YXRlKGNvbm5lY3Rpb24sIGFzeW5jIChkYikgPT4ge1xuICAgICAgYXdhaXQgdGhpcy5fbG9ja1NjaGVkdWxlS2V5KGRiLCBub3JtYWxpemVkU2NoZWR1bGVLZXkpXG4gICAgICBjb25zdCBqb2IgPSBhd2FpdCB0aGlzLl9zY2hlZHVsZWRPd25lckpvYihkYiwgbm9ybWFsaXplZFNjaGVkdWxlS2V5KVxuXG4gICAgICBpZiAoIWpvYiB8fCAoam9iLnN0YXR1cyAhPT0gXCJxdWV1ZWRcIiAmJiBqb2Iuc3RhdHVzICE9PSBcImhhbmRlZF9vZmZcIikpIHJldHVybiB7am9iSWQ6IG51bGwsIG91dGNvbWU6IFwibm90X2ZvdW5kXCJ9XG4gICAgICBpZiAoam9iLnN0YXR1cyA9PT0gXCJoYW5kZWRfb2ZmXCIpIHJldHVybiB7am9iSWQ6IGpvYi5pZCwgb3V0Y29tZTogXCJoYW5kZWRfb2ZmXCJ9XG5cbiAgICAgIGNvbnN0IG5vd01zID0gdGhpcy5jbG9jay5ub3coKVxuXG4gICAgICBpZiAoTnVtYmVyKGpvYi5zY2hlZHVsZWRBdE1zKSA8PSBub3dNcykge1xuICAgICAgICBhd2FpdCB0aGlzLl93YWtlRGlzcGF0Y2hlckFmdGVyQ29tbWl0KGRiKVxuICAgICAgICByZXR1cm4ge2pvYklkOiBqb2IuaWQsIG91dGNvbWU6IFwiYWxyZWFkeV9kdWVcIn1cbiAgICAgIH1cblxuICAgICAgY29uc3QgYWZmZWN0ZWRSb3dzID0gYXdhaXQgdGhpcy5fdXBkYXRlQWZmZWN0ZWRSb3dzKGRiLCB7XG4gICAgICAgIGNvbmRpdGlvbnM6IHtpZDogam9iLmlkLCBzY2hlZHVsZWRfYXRfbXM6IGpvYi5zY2hlZHVsZWRBdE1zLCBzdGF0dXM6IFwicXVldWVkXCJ9LFxuICAgICAgICBkYXRhOiB7c2NoZWR1bGVkX2F0X21zOiBub3dNc30sXG4gICAgICAgIHRhYmxlTmFtZTogTE9DQUxfQkFDS0dST1VORF9KT0JTX1RBQkxFXG4gICAgICB9KVxuXG4gICAgICBpZiAoYWZmZWN0ZWRSb3dzID09PSAxKSB7XG4gICAgICAgIGF3YWl0IHRoaXMuX3dha2VEaXNwYXRjaGVyQWZ0ZXJDb21taXQoZGIpXG4gICAgICAgIHJldHVybiB7am9iSWQ6IGpvYi5pZCwgb3V0Y29tZTogXCJ3b2tlblwifVxuICAgICAgfVxuXG4gICAgICBjb25zdCBjdXJyZW50Sm9iID0gYXdhaXQgdGhpcy5fc2NoZWR1bGVkT3duZXJKb2IoZGIsIG5vcm1hbGl6ZWRTY2hlZHVsZUtleSlcblxuICAgICAgaWYgKGN1cnJlbnRKb2I/LnN0YXR1cyA9PT0gXCJoYW5kZWRfb2ZmXCIpIHJldHVybiB7am9iSWQ6IGN1cnJlbnRKb2IuaWQsIG91dGNvbWU6IFwiaGFuZGVkX29mZlwifVxuICAgICAgaWYgKGN1cnJlbnRKb2I/LnN0YXR1cyA9PT0gXCJxdWV1ZWRcIiAmJiBOdW1iZXIoY3VycmVudEpvYi5zY2hlZHVsZWRBdE1zKSA8PSBub3dNcykge1xuICAgICAgICBhd2FpdCB0aGlzLl93YWtlRGlzcGF0Y2hlckFmdGVyQ29tbWl0KGRiKVxuICAgICAgICByZXR1cm4ge2pvYklkOiBjdXJyZW50Sm9iLmlkLCBvdXRjb21lOiBcImFscmVhZHlfZHVlXCJ9XG4gICAgICB9XG5cbiAgICAgIHJldHVybiB7am9iSWQ6IG51bGwsIG91dGNvbWU6IFwibm90X2ZvdW5kXCJ9XG4gICAgfSkpXG4gIH1cblxuICAvKipcbiAgICogU2VyaWFsaXplcyBtYXRjaGluZyBpbi1wcm9jZXNzIGRlZHVwbGljYXRpb24gY2hlY2tzIHRocm91Z2ggY29tbWl0IHdoaWxlXG4gICAqIGxlYXZpbmcgdW5yZWxhdGVkIGpvYiBpZGVudGl0aWVzIGluZGVwZW5kZW50LlxuICAgKiBAdGVtcGxhdGUgVFxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vdHlwZXMuanNcIikuUHJlcGFyZWRMb2NhbEJhY2tncm91bmRKb2J9IHByZXBhcmVkSm9iIC0gUHJlcGFyZWQgam9iIGlkZW50aXR5LlxuICAgKiBAcGFyYW0geyhob2xkVW50aWw6IChjb21wbGV0aW9uOiBQcm9taXNlPHZvaWQ+KSA9PiB2b2lkKSA9PiBQcm9taXNlPFQ+fSBjYWxsYmFjayAtIERlZHVwbGljYXRpb24gbXV0YXRpb24uXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPFQ+fSAtIE11dGF0aW9uIHJlc3VsdC5cbiAgICovXG4gIGFzeW5jIF9zZXJpYWxpemVEZWR1cGxpY2F0ZWRFbnF1ZXVlKHByZXBhcmVkSm9iLCBjYWxsYmFjaykge1xuICAgIGxldCBjaGFpbnMgPSBkZWR1cGxpY2F0ZWRFbnF1ZXVlQ2hhaW5zLmdldCh0aGlzLmNvbmZpZ3VyYXRpb24pXG5cbiAgICBpZiAoIWNoYWlucykge1xuICAgICAgY2hhaW5zID0gbmV3IE1hcCgpXG4gICAgICBkZWR1cGxpY2F0ZWRFbnF1ZXVlQ2hhaW5zLnNldCh0aGlzLmNvbmZpZ3VyYXRpb24sIGNoYWlucylcbiAgICB9XG5cbiAgICBjb25zdCBrZXkgPSBzaGEyNTZIZXgoSlNPTi5zdHJpbmdpZnkoW1xuICAgICAgdGhpcy5nZXREYXRhYmFzZUlkZW50aWZpZXIoKSxcbiAgICAgIHByZXBhcmVkSm9iLmpvYk5hbWUsXG4gICAgICBwcmVwYXJlZEpvYi5hcmdzRGlnZXN0LFxuICAgICAgcHJlcGFyZWRKb2IucXVldWVcbiAgICBdKSlcbiAgICBjb25zdCBwcmV2aW91cyA9IGNoYWlucy5nZXQoa2V5KSB8fCBQcm9taXNlLnJlc29sdmUoKVxuICAgIGxldCByZWxlYXNlID0gKCkgPT4ge31cbiAgICBjb25zdCBydW5uaW5nID0gbmV3IFByb21pc2UoKHJlc29sdmUpID0+IHsgcmVsZWFzZSA9ICgpID0+IHJlc29sdmUodW5kZWZpbmVkKSB9KVxuICAgIGNvbnN0IGNoYWluID0gcHJldmlvdXMudGhlbigoKSA9PiBydW5uaW5nKVxuICAgIC8qKiBAdHlwZSB7UHJvbWlzZTx2b2lkPiB8IHVuZGVmaW5lZH0gKi9cbiAgICBsZXQgY29tcGxldGlvblxuICAgIGNvbnN0IGZpbmlzaCA9ICgpID0+IHtcbiAgICAgIHJlbGVhc2UoKVxuICAgICAgaWYgKGNoYWlucy5nZXQoa2V5KSA9PT0gY2hhaW4pIGNoYWlucy5kZWxldGUoa2V5KVxuICAgICAgaWYgKGNoYWlucy5zaXplID09PSAwKSBkZWR1cGxpY2F0ZWRFbnF1ZXVlQ2hhaW5zLmRlbGV0ZSh0aGlzLmNvbmZpZ3VyYXRpb24pXG4gICAgfVxuXG4gICAgY2hhaW5zLnNldChrZXksIGNoYWluKVxuICAgIGF3YWl0IHByZXZpb3VzXG5cbiAgICB0cnkge1xuICAgICAgY29uc3QgcmVzdWx0ID0gYXdhaXQgY2FsbGJhY2soKHRyYW5zYWN0aW9uQ29tcGxldGlvbikgPT4geyBjb21wbGV0aW9uID0gdHJhbnNhY3Rpb25Db21wbGV0aW9uIH0pXG5cbiAgICAgIGlmIChjb21wbGV0aW9uKSB7XG4gICAgICAgIGNvbXBsZXRpb24udGhlbihmaW5pc2gsIGZpbmlzaClcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIGZpbmlzaCgpXG4gICAgICB9XG5cbiAgICAgIHJldHVybiByZXN1bHRcbiAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgZmluaXNoKClcbiAgICAgIHRocm93IGVycm9yXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIFByZXBhcmVzIHZhbGlkYXRlZCBsb2NhbCBqb2IgZGF0YSBmb3IgaW5zZXJ0aW9uLlxuICAgKiBAcGFyYW0ge3thcmdzOiBBcnJheTxSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj4sIGpvYk5hbWU6IHN0cmluZywgb3B0aW9uczogaW1wb3J0KFwiLi90eXBlcy5qc1wiKS5CYWNrZ3JvdW5kSm9iT3B0aW9uc319IGFyZ3MgLSBKb2IgcmVxdWVzdC5cbiAgICogQHJldHVybnMge2ltcG9ydChcIi4vdHlwZXMuanNcIikuUHJlcGFyZWRMb2NhbEJhY2tncm91bmRKb2J9IC0gUHJlcGFyZWQgcm93IGRhdGEuXG4gICAqL1xuICBfcHJlcGFyZUpvYih7YXJncywgam9iTmFtZSwgb3B0aW9uc30pIHtcbiAgICBpZiAob3B0aW9ucy5pZGVtcG90ZW5jeUtleSAhPT0gdW5kZWZpbmVkKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoXCJpZGVtcG90ZW5jeUtleSBpcyBub3Qgc3VwcG9ydGVkIGJ5IHRoZSBsb2NhbCBiYWNrZ3JvdW5kLWpvYnMgYWRhcHRlclwiKVxuICAgIH1cblxuICAgIGNvbnN0IGNyZWF0ZWRBdE1zID0gdGhpcy5jbG9jay5ub3coKVxuICAgIGNvbnN0IHF1ZXVlID0gbm9ybWFsaXplQmFja2dyb3VuZEpvYlF1ZXVlKG9wdGlvbnMpXG4gICAgY29uc3QgcXVldWVzID0gdGhpcy5jb25maWd1cmF0aW9uLmdldEJhY2tncm91bmRKb2JzQ29uZmlnKCkucXVldWVzXG4gICAgY29uc3QgYXJnc0pzb24gPSBKU09OLnN0cmluZ2lmeShhcmdzIHx8IFtdKVxuICAgIGNvbnN0IGV4ZWN1dGlvbk1vZGUgPSBub3JtYWxpemVCYWNrZ3JvdW5kSm9iRXhlY3V0aW9uTW9kZShvcHRpb25zLCBcImlubGluZVwiLCBMT0NBTF9FWEVDVVRJT05fTU9ERVMpXG5cbiAgICBpZiAodHlwZW9mIGFyZ3NKc29uICE9PSBcInN0cmluZ1wiKSB0aHJvdyBuZXcgVHlwZUVycm9yKFwiTG9jYWwgYmFja2dyb3VuZCBqb2IgYXJndW1lbnRzIG11c3QgYmUgSlNPTiBzZXJpYWxpemFibGVcIilcbiAgICBpZiAoZXhlY3V0aW9uTW9kZSAhPT0gXCJpbmxpbmVcIikgdGhyb3cgbmV3IEVycm9yKFwiTG9jYWwgYmFja2dyb3VuZCBqb2IgZXhlY3V0aW9uIG1vZGUgaW52YXJpYW50IHdhcyB2aW9sYXRlZFwiKVxuXG4gICAgcmV0dXJuIHtcbiAgICAgIGFyZ3NEaWdlc3Q6IHNoYTI1NkhleChhcmdzSnNvbiksXG4gICAgICBhcmdzSnNvbixcbiAgICAgIGNvbmN1cnJlbmN5OiBub3JtYWxpemVCYWNrZ3JvdW5kSm9iQ29uY3VycmVuY3koe29wdGlvbnMsIHF1ZXVlLCBxdWV1ZXN9KSxcbiAgICAgIGNyZWF0ZWRBdE1zLFxuICAgICAgZXhlY3V0aW9uTW9kZSxcbiAgICAgIGpvYklkOiBuZXcgVVVJRCg0KS5mb3JtYXQoKSxcbiAgICAgIGpvYk5hbWUsXG4gICAgICBtYXhSZXRyaWVzOiBub3JtYWxpemVCYWNrZ3JvdW5kSm9iTWF4UmV0cmllcyhvcHRpb25zLm1heFJldHJpZXMpLFxuICAgICAgcXVldWUsXG4gICAgICBzY2hlZHVsZWRBdE1zOiBub3JtYWxpemVCYWNrZ3JvdW5kSm9iU2NoZWR1bGVkQXRNcyhvcHRpb25zLnNjaGVkdWxlZEF0TXMsIGNyZWF0ZWRBdE1zKVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBJbnNlcnRzIG9uZSBwcmVwYXJlZCBsb2NhbCBqb2Igcm93IGFuZCBpdHMgY29uY3VycmVuY3kgbWV0YWRhdGEuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vZGF0YWJhc2UvZHJpdmVycy9iYXNlLmpzXCIpLmRlZmF1bHR9IGRiIC0gTG9jYWwgU1FMaXRlIGNvbm5lY3Rpb24uXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi90eXBlcy5qc1wiKS5QcmVwYXJlZExvY2FsQmFja2dyb3VuZEpvYn0gcHJlcGFyZWRKb2IgLSBQcmVwYXJlZCByb3cgZGF0YS5cbiAgICogQHBhcmFtIHtzdHJpbmcgfCBudWxsfSBbc2NoZWR1bGVLZXldIC0gU3RhYmxlIHNjaGVkdWxlIGhpc3Rvcnkga2V5LlxuICAgKiBAcGFyYW0ge251bWJlciB8IG51bGx9IFtzY2hlZHVsZU9yZGVyXSAtIE1vbm90b25pYyBzdGFibGUgb3duZXJzaGlwIG9yZGVyLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyBhZnRlciBpbnNlcnRpb24uXG4gICAqL1xuICBhc3luYyBfaW5zZXJ0UHJlcGFyZWRKb2IoZGIsIHByZXBhcmVkSm9iLCBzY2hlZHVsZUtleSA9IG51bGwsIHNjaGVkdWxlT3JkZXIgPSBudWxsKSB7XG4gICAgYXdhaXQgZGIuaW5zZXJ0KHtcbiAgICAgIHRhYmxlTmFtZTogTE9DQUxfQkFDS0dST1VORF9KT0JTX1RBQkxFLFxuICAgICAgZGF0YToge1xuICAgICAgICBhcmdzX2RpZ2VzdDogcHJlcGFyZWRKb2IuYXJnc0RpZ2VzdCxcbiAgICAgICAgYXJnc19qc29uOiBwcmVwYXJlZEpvYi5hcmdzSnNvbixcbiAgICAgICAgYXR0ZW1wdHM6IDAsXG4gICAgICAgIGNvbXBsZXRlZF9hdF9tczogbnVsbCxcbiAgICAgICAgY29uY3VycmVuY3lfa2V5OiBwcmVwYXJlZEpvYi5jb25jdXJyZW5jeT8uY29uY3VycmVuY3lLZXkgfHwgbnVsbCxcbiAgICAgICAgY3JlYXRlZF9hdF9tczogcHJlcGFyZWRKb2IuY3JlYXRlZEF0TXMsXG4gICAgICAgIGV4ZWN1dGlvbl9tb2RlOiBwcmVwYXJlZEpvYi5leGVjdXRpb25Nb2RlLFxuICAgICAgICBmYWlsZWRfYXRfbXM6IG51bGwsXG4gICAgICAgIGhhbmRlZF9vZmZfYXRfbXM6IG51bGwsXG4gICAgICAgIGhhbmRvZmZfaWQ6IG51bGwsXG4gICAgICAgIGlkOiBwcmVwYXJlZEpvYi5qb2JJZCxcbiAgICAgICAgam9iX25hbWU6IHByZXBhcmVkSm9iLmpvYk5hbWUsXG4gICAgICAgIGxhc3RfZXJyb3I6IG51bGwsXG4gICAgICAgIG1heF9jb25jdXJyZW5jeTogcHJlcGFyZWRKb2IuY29uY3VycmVuY3k/Lm1heENvbmN1cnJlbmN5IHx8IG51bGwsXG4gICAgICAgIG1heF9yZXRyaWVzOiBwcmVwYXJlZEpvYi5tYXhSZXRyaWVzLFxuICAgICAgICBxdWV1ZTogcHJlcGFyZWRKb2IucXVldWUsXG4gICAgICAgIHNjaGVkdWxlX2tleTogc2NoZWR1bGVLZXksXG4gICAgICAgIHNjaGVkdWxlX29yZGVyOiBzY2hlZHVsZU9yZGVyLFxuICAgICAgICBzY2hlZHVsZWRfYXRfbXM6IHByZXBhcmVkSm9iLnNjaGVkdWxlZEF0TXMsXG4gICAgICAgIHN0YXR1czogXCJxdWV1ZWRcIixcbiAgICAgICAgd29ya2VyX2lkOiBudWxsXG4gICAgICB9XG4gICAgfSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSZWNvbmNpbGVzIGNvbmZpZ3VyZWQgcXVldWUtZGVyaXZlZCBjYXBzIGFuZCBkdXJhYmxlIGNvdW50ZXJzLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyBhZnRlciByZWNvbmNpbGlhdGlvbi5cbiAgICovXG4gIGFzeW5jIHJlY29uY2lsZVF1ZXVlQ29uY3VycmVuY3koKSB7XG4gICAgYXdhaXQgdGhpcy5lbnN1cmVSZWFkeSgpXG5cbiAgICBhd2FpdCB0aGlzLl93aXRoRGIoYXN5bmMgKGNvbm5lY3Rpb24pID0+IGF3YWl0IHRoaXMuX211dGF0ZShjb25uZWN0aW9uLCBhc3luYyAoZGIpID0+IHtcbiAgICAgIGNvbnN0IHF1ZXVlcyA9IHRoaXMuY29uZmlndXJhdGlvbi5nZXRCYWNrZ3JvdW5kSm9ic0NvbmZpZygpLnF1ZXVlc1xuICAgICAgY29uc3Qgcm93cyA9IGF3YWl0IGRiLm5ld1F1ZXJ5KCkuZnJvbShMT0NBTF9CQUNLR1JPVU5EX0pPQlNfVEFCTEUpLndoZXJlKHtzdGF0dXM6IFwicXVldWVkXCJ9KS5yZXN1bHRzKClcblxuICAgICAgZm9yIChjb25zdCByYXdSb3cgb2Ygcm93cykge1xuICAgICAgICBhd2FpdCB0aGlzLl9yZWNvbmNpbGVRdWV1ZWRKb2JDb25jdXJyZW5jeShkYiwgdGhpcy5fbm9ybWFsaXplUm93KHJhd1JvdyksIHF1ZXVlcylcbiAgICAgIH1cblxuICAgICAgYXdhaXQgdGhpcy5fcmVidWlsZENvbmN1cnJlbmN5Q291bnRzKGRiKVxuICAgIH0pKVxuICB9XG5cbiAgLyoqXG4gICAqIEFwcGxpZXMgY3VycmVudCBxdWV1ZS1kZXJpdmVkIGNvbmN1cnJlbmN5IHBvbGljeSB0byBvbmUgcXVldWVkIHJvdy5cbiAgICogRXhwbGljaXQgY29uY3VycmVuY3kga2V5cyByZW1haW4gb3duZWQgYnkgdGhlIGVucXVldWUgY29udHJhY3QuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vZGF0YWJhc2UvZHJpdmVycy9iYXNlLmpzXCIpLmRlZmF1bHR9IGRiIC0gTG9jYWwgU1FMaXRlIGNvbm5lY3Rpb24uXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi90eXBlcy5qc1wiKS5CYWNrZ3JvdW5kSm9iUm93fSBqb2IgLSBRdWV1ZWQgam9iIHNuYXBzaG90LlxuICAgKiBAcGFyYW0ge1JlY29yZDxzdHJpbmcsIHttYXhDb25jdXJyZW50PzogbnVtYmVyLCBwcmlvcml0eT86IG51bWJlcn0+fSBxdWV1ZXMgLSBDdXJyZW50IHF1ZXVlIHBvbGljeSBzbmFwc2hvdC5cbiAgICogQHJldHVybnMge1Byb21pc2U8aW1wb3J0KFwiLi90eXBlcy5qc1wiKS5CYWNrZ3JvdW5kSm9iUm93Pn0gLSBSZWNvbmNpbGVkIHNuYXBzaG90LlxuICAgKi9cbiAgYXN5bmMgX3JlY29uY2lsZVF1ZXVlZEpvYkNvbmN1cnJlbmN5KGRiLCBqb2IsIHF1ZXVlcykge1xuICAgIGNvbnN0IGN1cnJlbnRJc1F1ZXVlRGVyaXZlZCA9IEJvb2xlYW4oam9iLmNvbmN1cnJlbmN5S2V5Py5zdGFydHNXaXRoKFFVRVVFX0NPTkNVUlJFTkNZX0tFWV9QUkVGSVgpKVxuXG4gICAgaWYgKGpvYi5jb25jdXJyZW5jeUtleSAmJiAhY3VycmVudElzUXVldWVEZXJpdmVkKSByZXR1cm4gam9iXG5cbiAgICBjb25zdCBjb25jdXJyZW5jeSA9IG5vcm1hbGl6ZUJhY2tncm91bmRKb2JDb25jdXJyZW5jeSh7XG4gICAgICBvcHRpb25zOiB7fSxcbiAgICAgIHF1ZXVlOiBqb2IucXVldWUsXG4gICAgICBxdWV1ZXNcbiAgICB9KVxuXG4gICAgaWYgKCFjb25jdXJyZW5jeSkge1xuICAgICAgaWYgKGN1cnJlbnRJc1F1ZXVlRGVyaXZlZCkge1xuICAgICAgICBhd2FpdCBkYi51cGRhdGUoe1xuICAgICAgICAgIGNvbmRpdGlvbnM6IHtpZDogam9iLmlkLCBzdGF0dXM6IFwicXVldWVkXCJ9LFxuICAgICAgICAgIGRhdGE6IHtjb25jdXJyZW5jeV9rZXk6IG51bGwsIG1heF9jb25jdXJyZW5jeTogbnVsbH0sXG4gICAgICAgICAgdGFibGVOYW1lOiBMT0NBTF9CQUNLR1JPVU5EX0pPQlNfVEFCTEVcbiAgICAgICAgfSlcbiAgICAgIH1cblxuICAgICAgcmV0dXJuIHsuLi5qb2IsIGNvbmN1cnJlbmN5S2V5OiBudWxsLCBtYXhDb25jdXJyZW5jeTogbnVsbH1cbiAgICB9XG5cbiAgICBhd2FpdCB0aGlzLl9lbnN1cmVDb25jdXJyZW5jeShkYiwgY29uY3VycmVuY3kpXG4gICAgaWYgKGpvYi5jb25jdXJyZW5jeUtleSAhPT0gY29uY3VycmVuY3kuY29uY3VycmVuY3lLZXkgfHwgam9iLm1heENvbmN1cnJlbmN5ICE9PSBjb25jdXJyZW5jeS5tYXhDb25jdXJyZW5jeSkge1xuICAgICAgYXdhaXQgZGIudXBkYXRlKHtcbiAgICAgICAgY29uZGl0aW9uczoge2lkOiBqb2IuaWQsIHN0YXR1czogXCJxdWV1ZWRcIn0sXG4gICAgICAgIGRhdGE6IHtjb25jdXJyZW5jeV9rZXk6IGNvbmN1cnJlbmN5LmNvbmN1cnJlbmN5S2V5LCBtYXhfY29uY3VycmVuY3k6IGNvbmN1cnJlbmN5Lm1heENvbmN1cnJlbmN5fSxcbiAgICAgICAgdGFibGVOYW1lOiBMT0NBTF9CQUNLR1JPVU5EX0pPQlNfVEFCTEVcbiAgICAgIH0pXG4gICAgfVxuXG4gICAgcmV0dXJuIHsuLi5qb2IsIGNvbmN1cnJlbmN5S2V5OiBjb25jdXJyZW5jeS5jb25jdXJyZW5jeUtleSwgbWF4Q29uY3VycmVuY3k6IGNvbmN1cnJlbmN5Lm1heENvbmN1cnJlbmN5fVxuICB9XG5cbiAgLyoqXG4gICAqIEZpbmRzIHRoZSBuZXh0IGVsaWdpYmxlIGxvY2FsIGpvYi5cbiAgICogQHJldHVybnMge1Byb21pc2U8aW1wb3J0KFwiLi90eXBlcy5qc1wiKS5CYWNrZ3JvdW5kSm9iUm93IHwgbnVsbD59IC0gTmV4dCBlbGlnaWJsZSBsb2NhbCBqb2IuXG4gICAqL1xuICBhc3luYyBuZXh0QXZhaWxhYmxlSm9iKCkge1xuICAgIGF3YWl0IHRoaXMuZW5zdXJlUmVhZHkoKVxuXG4gICAgcmV0dXJuIGF3YWl0IHRoaXMuX3dpdGhEYihhc3luYyAoZGIpID0+IHtcbiAgICAgIGNvbnN0IGpvYnNUYWJsZSA9IGRiLnF1b3RlVGFibGUoTE9DQUxfQkFDS0dST1VORF9KT0JTX1RBQkxFKVxuICAgICAgY29uc3QgY29uY3VycmVuY3lUYWJsZSA9IGRiLnF1b3RlVGFibGUoTE9DQUxfQkFDS0dST1VORF9KT0JfQ09OQ1VSUkVOQ1lfVEFCTEUpXG4gICAgICBjb25zdCBwcmlvcml0eU9yZGVyID0gdGhpcy5fcXVldWVQcmlvcml0eU9yZGVyU3FsKGRiKVxuICAgICAgbGV0IHF1ZXJ5ID0gZGJcbiAgICAgICAgLm5ld1F1ZXJ5KClcbiAgICAgICAgLmZyb20oTE9DQUxfQkFDS0dST1VORF9KT0JTX1RBQkxFKVxuICAgICAgICAud2hlcmUoe3N0YXR1czogXCJxdWV1ZWRcIn0pXG4gICAgICAgIC53aGVyZShgc2NoZWR1bGVkX2F0X21zIDw9ICR7ZGIucXVvdGUodGhpcy5jbG9jay5ub3coKSl9YClcbiAgICAgICAgLndoZXJlKFxuICAgICAgICAgIGAoJHtqb2JzVGFibGV9LiR7ZGIucXVvdGVDb2x1bW4oXCJjb25jdXJyZW5jeV9rZXlcIil9IElTIE5VTEwgT1IgRVhJU1RTIChgICtcbiAgICAgICAgICBgU0VMRUNUIDEgRlJPTSAke2NvbmN1cnJlbmN5VGFibGV9IFdIRVJFIGAgK1xuICAgICAgICAgIGAke2NvbmN1cnJlbmN5VGFibGV9LiR7ZGIucXVvdGVDb2x1bW4oXCJjb25jdXJyZW5jeV9rZXlcIil9ID0gJHtqb2JzVGFibGV9LiR7ZGIucXVvdGVDb2x1bW4oXCJjb25jdXJyZW5jeV9rZXlcIil9IEFORCBgICtcbiAgICAgICAgICBgJHtjb25jdXJyZW5jeVRhYmxlfS4ke2RiLnF1b3RlQ29sdW1uKFwiYWN0aXZlX2NvdW50XCIpfSA8ICR7Y29uY3VycmVuY3lUYWJsZX0uJHtkYi5xdW90ZUNvbHVtbihcIm1heF9jb25jdXJyZW5jeVwiKX0pKWBcbiAgICAgICAgKVxuXG4gICAgICBpZiAocHJpb3JpdHlPcmRlcikgcXVlcnkgPSBxdWVyeS5vcmRlcihgJHtwcmlvcml0eU9yZGVyfSBERVNDYClcblxuICAgICAgY29uc3Qgcm93cyA9IGF3YWl0IHF1ZXJ5XG4gICAgICAgIC5vcmRlcihcInNjaGVkdWxlZF9hdF9tcyBBU0NcIilcbiAgICAgICAgLm9yZGVyKFwiY3JlYXRlZF9hdF9tcyBBU0NcIilcbiAgICAgICAgLm9yZGVyKFwiaWQgQVNDXCIpXG4gICAgICAgIC5saW1pdCgxKVxuICAgICAgICAucmVzdWx0cygpXG5cbiAgICAgIHJldHVybiByb3dzWzBdID8gdGhpcy5fbm9ybWFsaXplUm93KHJvd3NbMF0pIDogbnVsbFxuICAgIH0pXG4gIH1cblxuICAvKipcbiAgICogRmluZHMgdGhlIHNvb25lc3QgZnV0dXJlIHF1ZXVlZCBqb2IuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPGltcG9ydChcIi4vdHlwZXMuanNcIikuQmFja2dyb3VuZEpvYlJvdyB8IG51bGw+fSAtIFNvb25lc3QgZnV0dXJlIHF1ZXVlZCBqb2IuXG4gICAqL1xuICBhc3luYyBuZXh0U2NoZWR1bGVkSm9iKCkge1xuICAgIGF3YWl0IHRoaXMuZW5zdXJlUmVhZHkoKVxuXG4gICAgcmV0dXJuIGF3YWl0IHRoaXMuX3dpdGhEYihhc3luYyAoZGIpID0+IHtcbiAgICAgIGNvbnN0IHJvd3MgPSBhd2FpdCBkYlxuICAgICAgICAubmV3UXVlcnkoKVxuICAgICAgICAuZnJvbShMT0NBTF9CQUNLR1JPVU5EX0pPQlNfVEFCTEUpXG4gICAgICAgIC53aGVyZSh7c3RhdHVzOiBcInF1ZXVlZFwifSlcbiAgICAgICAgLndoZXJlKGBzY2hlZHVsZWRfYXRfbXMgPiAke2RiLnF1b3RlKHRoaXMuY2xvY2subm93KCkpfWApXG4gICAgICAgIC5vcmRlcihcInNjaGVkdWxlZF9hdF9tcyBBU0NcIilcbiAgICAgICAgLm9yZGVyKFwiY3JlYXRlZF9hdF9tcyBBU0NcIilcbiAgICAgICAgLm9yZGVyKFwiaWQgQVNDXCIpXG4gICAgICAgIC5saW1pdCgxKVxuICAgICAgICAucmVzdWx0cygpXG5cbiAgICAgIHJldHVybiByb3dzWzBdID8gdGhpcy5fbm9ybWFsaXplUm93KHJvd3NbMF0pIDogbnVsbFxuICAgIH0pXG4gIH1cblxuICAvKipcbiAgICogRmluZHMgYSBwZXJzaXN0ZWQgbG9jYWwgam9iIGJ5IGlkLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gam9iSWQgLSBKb2IgaWQuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPGltcG9ydChcIi4vdHlwZXMuanNcIikuQmFja2dyb3VuZEpvYlJvdyB8IG51bGw+fSAtIFBlcnNpc3RlZCBqb2IuXG4gICAqL1xuICBhc3luYyBnZXRKb2Ioam9iSWQpIHtcbiAgICBhd2FpdCB0aGlzLmVuc3VyZVJlYWR5KClcblxuICAgIHJldHVybiBhd2FpdCB0aGlzLl93aXRoRGIoYXN5bmMgKGRiKSA9PiBhd2FpdCB0aGlzLl9nZXRKb2IoZGIsIGpvYklkKSlcbiAgfVxuXG4gIC8qKlxuICAgKiBMaXN0cyBsb2NhbCBqb2JzIGluIGNyZWF0aW9uIG9yZGVyLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxpbXBvcnQoXCIuL3R5cGVzLmpzXCIpLkJhY2tncm91bmRKb2JSb3dbXT59IC0gQWxsIGxvY2FsIGpvYnMgaW4gY3JlYXRpb24gb3JkZXIuXG4gICAqL1xuICBhc3luYyBsaXN0Sm9icygpIHtcbiAgICBhd2FpdCB0aGlzLmVuc3VyZVJlYWR5KClcblxuICAgIHJldHVybiBhd2FpdCB0aGlzLl93aXRoRGIoYXN5bmMgKGRiKSA9PiB7XG4gICAgICBjb25zdCByb3dzID0gYXdhaXQgZGJcbiAgICAgICAgLm5ld1F1ZXJ5KClcbiAgICAgICAgLmZyb20oTE9DQUxfQkFDS0dST1VORF9KT0JTX1RBQkxFKVxuICAgICAgICAub3JkZXIoXCJjcmVhdGVkX2F0X21zIEFTQ1wiKVxuICAgICAgICAub3JkZXIoXCJpZCBBU0NcIilcbiAgICAgICAgLnJlc3VsdHMoKVxuXG4gICAgICByZXR1cm4gcm93cy5tYXAoKHJvdykgPT4gdGhpcy5fbm9ybWFsaXplUm93KHJvdykpXG4gICAgfSlcbiAgfVxuXG4gIC8qKlxuICAgKiBBdG9taWNhbGx5IHJlc2VydmVzIGNvbmN1cnJlbmN5IGFuZCBjbGFpbXMgb25lIHF1ZXVlZCBqb2IuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi90eXBlcy5qc1wiKS5CYWNrZ3JvdW5kSm9iSGFuZG9mZlJlcXVlc3R9IGFyZ3MgLSBDbGFpbSByZXF1ZXN0LiBBIHN1cHBsaWVkIGhhbmRvZmYgaWQgaXMgcGVyc2lzdGVkIGV4YWN0bHkuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPGltcG9ydChcIi4vdHlwZXMuanNcIikuQmFja2dyb3VuZEpvYkhhbmRvZmYgfCBudWxsPn0gLSBGZW5jZWQgY2xhaW0uXG4gICAqL1xuICBhc3luYyBtYXJrSGFuZGVkT2ZmKHtqb2JJZCwgaGFuZG9mZklkID0gbmV3IFVVSUQoNCkuZm9ybWF0KCksIHdvcmtlcklkfSkge1xuICAgIGF3YWl0IHRoaXMuZW5zdXJlUmVhZHkoKVxuXG4gICAgcmV0dXJuIGF3YWl0IHRoaXMuX3dpdGhEYihhc3luYyAoY29ubmVjdGlvbikgPT4gYXdhaXQgdGhpcy5fbXV0YXRlKGNvbm5lY3Rpb24sIGFzeW5jIChkYikgPT4ge1xuICAgICAgY29uc3Qgam9iID0gYXdhaXQgdGhpcy5fZ2V0Sm9iKGRiLCBqb2JJZClcblxuICAgICAgaWYgKCFqb2IgfHwgam9iLnN0YXR1cyAhPT0gXCJxdWV1ZWRcIiB8fCBOdW1iZXIoam9iLnNjaGVkdWxlZEF0TXMpID4gdGhpcy5jbG9jay5ub3coKSkgcmV0dXJuIG51bGxcbiAgICAgIGlmIChqb2IuY29uY3VycmVuY3lLZXkgJiYgIShhd2FpdCB0aGlzLl9yZXNlcnZlQ29uY3VycmVuY3koZGIsIGpvYi5jb25jdXJyZW5jeUtleSkpKSByZXR1cm4gbnVsbFxuXG4gICAgICBjb25zdCBoYW5kZWRPZmZBdE1zID0gdGhpcy5jbG9jay5ub3coKVxuICAgICAgY29uc3QgYWZmZWN0ZWRSb3dzID0gYXdhaXQgdGhpcy5fdXBkYXRlQWZmZWN0ZWRSb3dzKGRiLCB7XG4gICAgICAgIGNvbmRpdGlvbnM6IHtpZDogam9iSWQsIHN0YXR1czogXCJxdWV1ZWRcIn0sXG4gICAgICAgIGRhdGE6IHsuLi50aGlzLl9jbGVhcmVkQ2hpbGRBY2NlcHRhbmNlRGF0YSgpLCBoYW5kZWRfb2ZmX2F0X21zOiBoYW5kZWRPZmZBdE1zLCBoYW5kb2ZmX2lkOiBoYW5kb2ZmSWQsIHN0YXR1czogXCJoYW5kZWRfb2ZmXCIsIHdvcmtlcl9pZDogd29ya2VySWQgfHwgXCJsb2NhbFwifSxcbiAgICAgICAgdGFibGVOYW1lOiBMT0NBTF9CQUNLR1JPVU5EX0pPQlNfVEFCTEVcbiAgICAgIH0pXG5cbiAgICAgIGlmIChhZmZlY3RlZFJvd3MgIT09IDEpIHtcbiAgICAgICAgYXdhaXQgdGhpcy5fcmVsZWFzZUNvbmN1cnJlbmN5KGRiLCBqb2IuY29uY3VycmVuY3lLZXkpXG4gICAgICAgIHJldHVybiBudWxsXG4gICAgICB9XG5cbiAgICAgIHJldHVybiB7aGFuZGVkT2ZmQXRNcywgaGFuZG9mZklkfVxuICAgIH0pKVxuICB9XG5cbiAgLyoqXG4gICAqIEZpbmRzIGFjdGl2ZSBsb2NhbCBoYW5kb2ZmcyBvd25lZCBieSBvbmUgd29ya2VyLlxuICAgKiBAcGFyYW0ge3t3b3JrZXJJZDogc3RyaW5nfX0gYXJncyAtIFdvcmtlciBpZGVudGl0eS5cbiAgICogQHJldHVybnMge1Byb21pc2U8QXJyYXk8e2pvYklkOiBzdHJpbmcsIGhhbmRvZmZJZDogc3RyaW5nfT4+fSAtIEFjdGl2ZSB3b3JrZXIgaGFuZG9mZnMuXG4gICAqL1xuICBhc3luYyBoYW5kZWRPZmZKb2JzRm9yV29ya2VyKHt3b3JrZXJJZH0pIHtcbiAgICBhd2FpdCB0aGlzLmVuc3VyZVJlYWR5KClcblxuICAgIGNvbnN0IHJvd3MgPSBhd2FpdCB0aGlzLl93aXRoRGIoYXN5bmMgKGRiKSA9PiBhd2FpdCBkYlxuICAgICAgLm5ld1F1ZXJ5KClcbiAgICAgIC5mcm9tKExPQ0FMX0JBQ0tHUk9VTkRfSk9CU19UQUJMRSlcbiAgICAgIC53aGVyZSh7c3RhdHVzOiBcImhhbmRlZF9vZmZcIiwgd29ya2VyX2lkOiB3b3JrZXJJZH0pXG4gICAgICAucmVzdWx0cygpKVxuICAgIC8qKiBAdHlwZSB7QXJyYXk8e2pvYklkOiBzdHJpbmcsIGhhbmRvZmZJZDogc3RyaW5nfT59ICovXG4gICAgY29uc3QgaGFuZG9mZnMgPSBbXVxuXG4gICAgZm9yIChjb25zdCByYXdSb3cgb2Ygcm93cykge1xuICAgICAgY29uc3Qgam9iID0gdGhpcy5fbm9ybWFsaXplUm93KHJhd1JvdylcblxuICAgICAgaWYgKGpvYi5oYW5kb2ZmSWQpIGhhbmRvZmZzLnB1c2goe2pvYklkOiBqb2IuaWQsIGhhbmRvZmZJZDogam9iLmhhbmRvZmZJZH0pXG4gICAgfVxuXG4gICAgcmV0dXJuIGhhbmRvZmZzXG4gIH1cblxuICAvKipcbiAgICogUmV0dXJucyBhbiBleGFjdCBhY3RpdmUgaGFuZG9mZiB0byB0aGUgcXVldWUuXG4gICAqIEBwYXJhbSB7e2pvYklkOiBzdHJpbmcsIGhhbmRvZmZJZDogc3RyaW5nfX0gYXJncyAtIEhhbmRvZmYgcmVsZWFzZS5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgYWZ0ZXIgdGhlIGZlbmNlZCByZWxlYXNlLlxuICAgKi9cbiAgYXN5bmMgbWFya1JldHVybmVkVG9RdWV1ZSh7am9iSWQsIGhhbmRvZmZJZH0pIHtcbiAgICBhd2FpdCB0aGlzLmVuc3VyZVJlYWR5KClcblxuICAgIGF3YWl0IHRoaXMuX3dpdGhEYihhc3luYyAoY29ubmVjdGlvbikgPT4gYXdhaXQgdGhpcy5fbXV0YXRlKGNvbm5lY3Rpb24sIGFzeW5jIChkYikgPT4ge1xuICAgICAgY29uc3Qgam9iID0gYXdhaXQgdGhpcy5fZ2V0Sm9iKGRiLCBqb2JJZClcblxuICAgICAgaWYgKCF0aGlzLl9hY2NlcHRzSGFuZG9mZihqb2IsIGhhbmRvZmZJZCkpIHJldHVyblxuICAgICAgYXdhaXQgdGhpcy5fbG9ja0NvbmN1cnJlbmN5Um93KGRiLCBqb2IuY29uY3VycmVuY3lLZXkpXG5cbiAgICAgIGNvbnN0IGFmZmVjdGVkUm93cyA9IGF3YWl0IHRoaXMuX3VwZGF0ZUFmZmVjdGVkUm93cyhkYiwge1xuICAgICAgICBjb25kaXRpb25zOiB7aGFuZG9mZl9pZDogaGFuZG9mZklkLCBpZDogam9iSWQsIHN0YXR1czogXCJoYW5kZWRfb2ZmXCJ9LFxuICAgICAgICBkYXRhOiB7XG4gICAgICAgICAgLi4udGhpcy5fY2xlYXJlZENoaWxkQWNjZXB0YW5jZURhdGEoKSxcbiAgICAgICAgICBoYW5kZWRfb2ZmX2F0X21zOiBudWxsLFxuICAgICAgICAgIGhhbmRvZmZfaWQ6IG51bGwsXG4gICAgICAgICAgc2NoZWR1bGVkX2F0X21zOiB0aGlzLmNsb2NrLm5vdygpLFxuICAgICAgICAgIHN0YXR1czogXCJxdWV1ZWRcIixcbiAgICAgICAgICB3b3JrZXJfaWQ6IG51bGxcbiAgICAgICAgfSxcbiAgICAgICAgdGFibGVOYW1lOiBMT0NBTF9CQUNLR1JPVU5EX0pPQlNfVEFCTEVcbiAgICAgIH0pXG5cbiAgICAgIGlmIChhZmZlY3RlZFJvd3MgPT09IDEpIGF3YWl0IHRoaXMuX3JlbGVhc2VDb25jdXJyZW5jeShkYiwgam9iLmNvbmN1cnJlbmN5S2V5KVxuICAgIH0pKVxuICB9XG5cbiAgLyoqXG4gICAqIEFwcGxpZXMgYSBmZW5jZWQgc3VjY2Vzc2Z1bCBhY2tub3dsZWRnZW1lbnQuXG4gICAqIEBwYXJhbSB7e2pvYklkOiBzdHJpbmcsIGhhbmRvZmZJZD86IHN0cmluZ319IGFyZ3MgLSBDb21wbGV0aW9uIHJlcG9ydC5cbiAgICogQHJldHVybnMge1Byb21pc2U8Ym9vbGVhbj59IC0gV2hldGhlciB0aGUgbGVhc2Ugd29uLlxuICAgKi9cbiAgYXN5bmMgbWFya0NvbXBsZXRlZCh7am9iSWQsIGhhbmRvZmZJZH0pIHtcbiAgICBhd2FpdCB0aGlzLmVuc3VyZVJlYWR5KClcblxuICAgIHJldHVybiBhd2FpdCB0aGlzLl93aXRoRGIoYXN5bmMgKGNvbm5lY3Rpb24pID0+IGF3YWl0IHRoaXMuX211dGF0ZShjb25uZWN0aW9uLCBhc3luYyAoZGIpID0+IHtcbiAgICAgIGNvbnN0IGpvYiA9IGF3YWl0IHRoaXMuX2dldEpvYihkYiwgam9iSWQpXG5cbiAgICAgIGlmICghdGhpcy5fYWNjZXB0c0hhbmRvZmYoam9iLCBoYW5kb2ZmSWQpKSByZXR1cm4gZmFsc2VcbiAgICAgIGF3YWl0IHRoaXMuX2xvY2tDb25jdXJyZW5jeVJvdyhkYiwgam9iLmNvbmN1cnJlbmN5S2V5KVxuXG4gICAgICBjb25zdCBhZmZlY3RlZFJvd3MgPSBhd2FpdCB0aGlzLl91cGRhdGVBZmZlY3RlZFJvd3MoZGIsIHtcbiAgICAgICAgY29uZGl0aW9uczoge2hhbmRvZmZfaWQ6IGhhbmRvZmZJZCwgaWQ6IGpvYklkLCBzdGF0dXM6IFwiaGFuZGVkX29mZlwifSxcbiAgICAgICAgZGF0YToge2NvbXBsZXRlZF9hdF9tczogdGhpcy5jbG9jay5ub3coKSwgc3RhdHVzOiBcImNvbXBsZXRlZFwifSxcbiAgICAgICAgdGFibGVOYW1lOiBMT0NBTF9CQUNLR1JPVU5EX0pPQlNfVEFCTEVcbiAgICAgIH0pXG5cbiAgICAgIGlmIChhZmZlY3RlZFJvd3MgIT09IDEpIHJldHVybiBmYWxzZVxuICAgICAgYXdhaXQgdGhpcy5fcmVsZWFzZUNvbmN1cnJlbmN5KGRiLCBqb2IuY29uY3VycmVuY3lLZXkpXG4gICAgICBhd2FpdCB0aGlzLl9yZWxlYXNlU2NoZWR1bGVPd25lcnNoaXBGb3JKb2IoZGIsIGpvYilcbiAgICAgIHJldHVybiB0cnVlXG4gICAgfSkpXG4gIH1cblxuICAvKipcbiAgICogUmVjb3JkcyBwb29sZWQtY2hpbGQgYWNjZXB0YW5jZSBldmlkZW5jZSBmb3IgYW4gYWN0aXZlIGhhbmRvZmYuIE9ubHkgdGhlXG4gICAqIGZpZWxkcyBzdXBwbGllZCBhcmUgd3JpdHRlbiwgZmVuY2VkIGJ5IHRoZSBleGFjdCBhY3RpdmUgaGFuZG9mZiBsZWFzZS5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBBY2NlcHRhbmNlIHJlcG9ydC5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGFyZ3Muam9iSWQgLSBKb2IgaWQuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBbYXJncy5oYW5kb2ZmSWRdIC0gSGFuZG9mZiBsZWFzZSBpZC5cbiAgICogQHBhcmFtIHtudW1iZXJ9IFthcmdzLnJlY2VpdmVkQXRNc10gLSBFcG9jaCBtcyB0aGUgcnVubmVyIGNoaWxkIHJlY2VpdmVkIHRoZSBqb2IuXG4gICAqIEBwYXJhbSB7bnVtYmVyfSBbYXJncy5zdGFydGVkQXRNc10gLSBFcG9jaCBtcyB0aGUgam9iJ3MgcGVyZm9ybSBzdGFydGVkIGluIHRoZSBjaGlsZC5cbiAgICogQHBhcmFtIHtzdHJpbmd9IFthcmdzLmNoaWxkSW5zdGFuY2VJZF0gLSBTdGFibGUgcG9vbGVkIGNoaWxkIGlkZW50aXR5LlxuICAgKiBAcGFyYW0ge251bWJlcn0gW2FyZ3MuY2hpbGRQaWRdIC0gUG9vbGVkIGNoaWxkIE9TIHBpZC5cbiAgICogQHJldHVybnMge1Byb21pc2U8Ym9vbGVhbj59IC0gV2hldGhlciB0aGUgbGVhc2Ugd29uLlxuICAgKi9cbiAgYXN5bmMgbWFya0NoaWxkQWNjZXB0ZWQoe2pvYklkLCBoYW5kb2ZmSWQsIHJlY2VpdmVkQXRNcywgc3RhcnRlZEF0TXMsIGNoaWxkSW5zdGFuY2VJZCwgY2hpbGRQaWR9KSB7XG4gICAgYXdhaXQgdGhpcy5lbnN1cmVSZWFkeSgpXG5cbiAgICByZXR1cm4gYXdhaXQgdGhpcy5fd2l0aERiKGFzeW5jIChjb25uZWN0aW9uKSA9PiBhd2FpdCB0aGlzLl9tdXRhdGUoY29ubmVjdGlvbiwgYXN5bmMgKGRiKSA9PiB7XG4gICAgICBjb25zdCBqb2IgPSBhd2FpdCB0aGlzLl9nZXRKb2IoZGIsIGpvYklkKVxuXG4gICAgICBpZiAoIXRoaXMuX2FjY2VwdHNIYW5kb2ZmKGpvYiwgaGFuZG9mZklkKSkgcmV0dXJuIGZhbHNlXG5cbiAgICAgIGNvbnN0IGRhdGEgPSB7fVxuICAgICAgaWYgKHR5cGVvZiByZWNlaXZlZEF0TXMgPT09IFwibnVtYmVyXCIpIGRhdGEuY2hpbGRfcmVjZWl2ZWRfYXRfbXMgPSByZWNlaXZlZEF0TXNcbiAgICAgIGlmICh0eXBlb2Ygc3RhcnRlZEF0TXMgPT09IFwibnVtYmVyXCIpIGRhdGEuY2hpbGRfc3RhcnRlZF9hdF9tcyA9IHN0YXJ0ZWRBdE1zXG4gICAgICBpZiAodHlwZW9mIGNoaWxkSW5zdGFuY2VJZCA9PT0gXCJzdHJpbmdcIikgZGF0YS5jaGlsZF9pbnN0YW5jZV9pZCA9IGNoaWxkSW5zdGFuY2VJZFxuICAgICAgaWYgKHR5cGVvZiBjaGlsZFBpZCA9PT0gXCJudW1iZXJcIikgZGF0YS5jaGlsZF9waWQgPSBjaGlsZFBpZFxuICAgICAgaWYgKE9iamVjdC5rZXlzKGRhdGEpLmxlbmd0aCA9PT0gMCkgcmV0dXJuIGZhbHNlXG5cbiAgICAgIGNvbnN0IGFmZmVjdGVkUm93cyA9IGF3YWl0IHRoaXMuX3VwZGF0ZUFmZmVjdGVkUm93cyhkYiwge1xuICAgICAgICBjb25kaXRpb25zOiB7aGFuZG9mZl9pZDogaGFuZG9mZklkLCBpZDogam9iSWQsIHN0YXR1czogXCJoYW5kZWRfb2ZmXCJ9LFxuICAgICAgICBkYXRhLFxuICAgICAgICB0YWJsZU5hbWU6IExPQ0FMX0JBQ0tHUk9VTkRfSk9CU19UQUJMRVxuICAgICAgfSlcblxuICAgICAgcmV0dXJuIGFmZmVjdGVkUm93cyA9PT0gMVxuICAgIH0pKVxuICB9XG5cbiAgLyoqXG4gICAqIEFwcGxpZXMgYSBmZW5jZWQgcmVzY2hlZHVsZSB3aXRob3V0IGNvbnN1bWluZyBhbiBhdHRlbXB0LlxuICAgKiBAcGFyYW0ge3tqb2JJZDogc3RyaW5nLCBoYW5kb2ZmSWQ/OiBzdHJpbmcsIGRlbGF5TXM6IG51bWJlcn19IGFyZ3MgLSBSZXNjaGVkdWxlIHJlcG9ydC5cbiAgICogQHJldHVybnMge1Byb21pc2U8Ym9vbGVhbj59IC0gV2hldGhlciB0aGUgbGVhc2Ugd29uLlxuICAgKi9cbiAgYXN5bmMgbWFya1Jlc2NoZWR1bGVkKHtqb2JJZCwgaGFuZG9mZklkLCBkZWxheU1zfSkge1xuICAgIGF3YWl0IHRoaXMuZW5zdXJlUmVhZHkoKVxuXG4gICAgcmV0dXJuIGF3YWl0IHRoaXMuX3dpdGhEYihhc3luYyAoY29ubmVjdGlvbikgPT4gYXdhaXQgdGhpcy5fbXV0YXRlKGNvbm5lY3Rpb24sIGFzeW5jIChkYikgPT4ge1xuICAgICAgY29uc3Qgam9iID0gYXdhaXQgdGhpcy5fZ2V0Sm9iKGRiLCBqb2JJZClcblxuICAgICAgaWYgKCF0aGlzLl9hY2NlcHRzSGFuZG9mZihqb2IsIGhhbmRvZmZJZCkpIHJldHVybiBmYWxzZVxuICAgICAgYXdhaXQgdGhpcy5fbG9ja0NvbmN1cnJlbmN5Um93KGRiLCBqb2IuY29uY3VycmVuY3lLZXkpXG5cbiAgICAgIGNvbnN0IGFmZmVjdGVkUm93cyA9IGF3YWl0IHRoaXMuX3VwZGF0ZUFmZmVjdGVkUm93cyhkYiwge1xuICAgICAgICBjb25kaXRpb25zOiB7aGFuZG9mZl9pZDogaGFuZG9mZklkLCBpZDogam9iSWQsIHN0YXR1czogXCJoYW5kZWRfb2ZmXCJ9LFxuICAgICAgICBkYXRhOiB7XG4gICAgICAgICAgLi4udGhpcy5fY2xlYXJlZENoaWxkQWNjZXB0YW5jZURhdGEoKSxcbiAgICAgICAgICBoYW5kZWRfb2ZmX2F0X21zOiBudWxsLFxuICAgICAgICAgIGhhbmRvZmZfaWQ6IG51bGwsXG4gICAgICAgICAgc2NoZWR1bGVkX2F0X21zOiByZXNjaGVkdWxlZEJhY2tncm91bmRKb2JBdE1zKGRlbGF5TXMsIHRoaXMuY2xvY2subm93KCkpLFxuICAgICAgICAgIHN0YXR1czogXCJxdWV1ZWRcIixcbiAgICAgICAgICB3b3JrZXJfaWQ6IG51bGxcbiAgICAgICAgfSxcbiAgICAgICAgdGFibGVOYW1lOiBMT0NBTF9CQUNLR1JPVU5EX0pPQlNfVEFCTEVcbiAgICAgIH0pXG5cbiAgICAgIGlmIChhZmZlY3RlZFJvd3MgIT09IDEpIHJldHVybiBmYWxzZVxuICAgICAgYXdhaXQgdGhpcy5fcmVsZWFzZUNvbmN1cnJlbmN5KGRiLCBqb2IuY29uY3VycmVuY3lLZXkpXG4gICAgICByZXR1cm4gdHJ1ZVxuICAgIH0pKVxuICB9XG5cbiAgLyoqXG4gICAqIEFwcGxpZXMgYSBmZW5jZWQgZmFpbHVyZSwgcmV0cnksIG9yIHRlcm1pbmFsIHRyYW5zaXRpb24uXG4gICAqIEBwYXJhbSB7e2pvYklkOiBzdHJpbmcsIGhhbmRvZmZJZD86IHN0cmluZywgZXJyb3I6IFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fX0gYXJncyAtIEZhaWx1cmUgcmVwb3J0LlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxpbXBvcnQoXCIuL3R5cGVzLmpzXCIpLkJhY2tncm91bmRKb2JSb3cgfCBudWxsPn0gLSBBY2NlcHRlZCB0cmFuc2l0aW9uIHNuYXBzaG90LlxuICAgKi9cbiAgYXN5bmMgbWFya0ZhaWxlZCh7am9iSWQsIGhhbmRvZmZJZCwgZXJyb3J9KSB7XG4gICAgYXdhaXQgdGhpcy5lbnN1cmVSZWFkeSgpXG5cbiAgICByZXR1cm4gYXdhaXQgdGhpcy5fd2l0aERiKGFzeW5jIChjb25uZWN0aW9uKSA9PiBhd2FpdCB0aGlzLl9tdXRhdGUoY29ubmVjdGlvbiwgYXN5bmMgKGRiKSA9PiB7XG4gICAgICBjb25zdCBqb2IgPSBhd2FpdCB0aGlzLl9nZXRKb2IoZGIsIGpvYklkKVxuXG4gICAgICBpZiAoIXRoaXMuX2FjY2VwdHNIYW5kb2ZmKGpvYiwgaGFuZG9mZklkKSkgcmV0dXJuIG51bGxcblxuICAgICAgcmV0dXJuIGF3YWl0IHRoaXMuX2FwcGx5RmFpbHVyZShkYiwgam9iLCBlcnJvcilcbiAgICB9KSlcbiAgfVxuXG4gIC8qKlxuICAgKiBUdXJucyBldmVyeSBhYmFuZG9uZWQgbG9jYWwgaGFuZG9mZiBpbnRvIHRoZSBub3JtYWwgZmFpbHVyZS9yZXRyeSBwYXRoLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxpbXBvcnQoXCIuL3R5cGVzLmpzXCIpLkJhY2tncm91bmRKb2JSb3dbXT59IC0gUmVjb3ZlcmVkIHRyYW5zaXRpb25zLlxuICAgKi9cbiAgYXN5bmMgcmVjb3ZlckhhbmRlZE9mZkpvYnMoKSB7XG4gICAgYXdhaXQgdGhpcy5lbnN1cmVSZWFkeSgpXG5cbiAgICByZXR1cm4gYXdhaXQgdGhpcy5fd2l0aERiKGFzeW5jIChjb25uZWN0aW9uKSA9PiBhd2FpdCB0aGlzLl9tdXRhdGUoY29ubmVjdGlvbiwgYXN5bmMgKGRiKSA9PiB7XG4gICAgICBjb25zdCBxdWV1ZXMgPSB0aGlzLmNvbmZpZ3VyYXRpb24uZ2V0QmFja2dyb3VuZEpvYnNDb25maWcoKS5xdWV1ZXNcbiAgICAgIGNvbnN0IHJvd3MgPSBhd2FpdCBkYi5uZXdRdWVyeSgpLmZyb20oTE9DQUxfQkFDS0dST1VORF9KT0JTX1RBQkxFKS53aGVyZSh7c3RhdHVzOiBcImhhbmRlZF9vZmZcIn0pLnJlc3VsdHMoKVxuICAgICAgLyoqIEB0eXBlIHtpbXBvcnQoXCIuL3R5cGVzLmpzXCIpLkJhY2tncm91bmRKb2JSb3dbXX0gKi9cbiAgICAgIGNvbnN0IHJlY292ZXJlZCA9IFtdXG5cbiAgICAgIGZvciAoY29uc3QgcmF3Um93IG9mIHJvd3MpIHtcbiAgICAgICAgY29uc3Qgam9iID0gdGhpcy5fbm9ybWFsaXplUm93KHJhd1JvdylcbiAgICAgICAgY29uc3QgdXBkYXRlZCA9IGF3YWl0IHRoaXMuX2FwcGx5RmFpbHVyZShkYiwgam9iLCBuZXcgRXJyb3IoXCJMb2NhbCBiYWNrZ3JvdW5kIGpvYiByZWNvdmVyZWQgYWZ0ZXIgYW4gaW50ZXJydXB0ZWQgZGlzcGF0Y2hlclwiKSlcblxuICAgICAgICBpZiAoIXVwZGF0ZWQpIGNvbnRpbnVlXG5cbiAgICAgICAgY29uc3QgcmVjb25jaWxlZCA9IHVwZGF0ZWQuc3RhdHVzID09PSBcInF1ZXVlZFwiXG4gICAgICAgICAgPyBhd2FpdCB0aGlzLl9yZWNvbmNpbGVRdWV1ZWRKb2JDb25jdXJyZW5jeShkYiwgdXBkYXRlZCwgcXVldWVzKVxuICAgICAgICAgIDogdXBkYXRlZFxuXG4gICAgICAgIHJlY292ZXJlZC5wdXNoKHJlY29uY2lsZWQpXG4gICAgICB9XG5cbiAgICAgIGF3YWl0IHRoaXMuX3JlYnVpbGRDb25jdXJyZW5jeUNvdW50cyhkYilcbiAgICAgIHJldHVybiByZWNvdmVyZWRcbiAgICB9KSlcbiAgfVxuXG4gIC8qKlxuICAgKiBEZWxldGVzIGxvY2FsIHF1ZXVlIHN0YXRlIGZvciBmb2N1c2VkIHRlc3RzLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyBhZnRlciBkZWxldGlvbi5cbiAgICovXG4gIGFzeW5jIGNsZWFyQWxsKCkge1xuICAgIGF3YWl0IHRoaXMuZW5zdXJlUmVhZHkoKVxuICAgIGF3YWl0IHRoaXMuX3dpdGhEYihhc3luYyAoY29ubmVjdGlvbikgPT4gYXdhaXQgdGhpcy5fbXV0YXRlKGNvbm5lY3Rpb24sIGFzeW5jIChkYikgPT4ge1xuICAgICAgYXdhaXQgZGIucXVlcnkoYERFTEVURSBGUk9NICR7ZGIucXVvdGVUYWJsZShMT0NBTF9CQUNLR1JPVU5EX0pPQl9TQ0hFRFVMRV9LRVlTX1RBQkxFKX1gKVxuICAgICAgYXdhaXQgZGIucXVlcnkoYERFTEVURSBGUk9NICR7ZGIucXVvdGVUYWJsZShMT0NBTF9CQUNLR1JPVU5EX0pPQlNfVEFCTEUpfWApXG4gICAgICBhd2FpdCBkYi5xdWVyeShgREVMRVRFIEZST00gJHtkYi5xdW90ZVRhYmxlKExPQ0FMX0JBQ0tHUk9VTkRfSk9CX0NPTkNVUlJFTkNZX1RBQkxFKX1gKVxuICAgIH0pKVxuICB9XG5cbiAgLyoqXG4gICAqIEFwcGxpZXMgdGhlIGNvbW1vbiByZXRyeSBvciBleGhhdXN0ZWQgZmFpbHVyZSB0cmFuc2l0aW9uLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL2RhdGFiYXNlL2RyaXZlcnMvYmFzZS5qc1wiKS5kZWZhdWx0fSBkYiAtIExvY2FsIFNRTGl0ZSBjb25uZWN0aW9uLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vdHlwZXMuanNcIikuQmFja2dyb3VuZEpvYlJvd30gam9iIC0gQWN0aXZlIGhhbmRvZmYuXG4gICAqIEBwYXJhbSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59IGVycm9yIC0gUGVyZm9ybWFuY2UgZXJyb3IuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPGltcG9ydChcIi4vdHlwZXMuanNcIikuQmFja2dyb3VuZEpvYlJvdyB8IG51bGw+fSAtIFRyYW5zaXRpb24gc25hcHNob3QuXG4gICAqL1xuICBhc3luYyBfYXBwbHlGYWlsdXJlKGRiLCBqb2IsIGVycm9yKSB7XG4gICAgY29uc3QgYXR0ZW1wdHMgPSAoam9iLmF0dGVtcHRzIHx8IDApICsgMVxuICAgIGNvbnN0IG1heFJldHJpZXMgPSBub3JtYWxpemVCYWNrZ3JvdW5kSm9iTWF4UmV0cmllcyhqb2IubWF4UmV0cmllcylcbiAgICBjb25zdCB3aWxsUmV0cnkgPSBhdHRlbXB0cyA8PSBtYXhSZXRyaWVzXG4gICAgY29uc3Qgbm93TXMgPSB0aGlzLmNsb2NrLm5vdygpXG4gICAgLyoqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59ICovXG4gICAgY29uc3QgZGF0YSA9IHtcbiAgICAgIGF0dGVtcHRzLFxuICAgICAgaGFuZGVkX29mZl9hdF9tczogbnVsbCxcbiAgICAgIGhhbmRvZmZfaWQ6IG51bGwsXG4gICAgICBsYXN0X2Vycm9yOiBub3JtYWxpemVCYWNrZ3JvdW5kSm9iRXJyb3IoZXJyb3IpLFxuICAgICAgc3RhdHVzOiB3aWxsUmV0cnkgPyBcInF1ZXVlZFwiIDogXCJmYWlsZWRcIixcbiAgICAgIHdvcmtlcl9pZDogbnVsbFxuICAgIH1cblxuICAgIGlmICh3aWxsUmV0cnkpIHtcbiAgICAgIC8vIEEgcmV0cnkgc3RhcnRzIGEgZnJlc2ggaGFuZG9mZiB3aXRoIGEgcG9zc2libHkgZGlmZmVyZW50IHJ1bm5lciwgc28gdGhlXG4gICAgICAvLyBwcmV2aW91cyBjaGlsZCdzIGFjY2VwdGFuY2UgZXZpZGVuY2UgbXVzdCBub3QgbGVhayBpbnRvIHRoZSBuZXh0IGF0dGVtcHQuXG4gICAgICBPYmplY3QuYXNzaWduKGRhdGEsIHtzY2hlZHVsZWRfYXRfbXM6IG5vd01zICsgcmV0cnlEZWxheU1zKGF0dGVtcHRzKSwgLi4udGhpcy5fY2xlYXJlZENoaWxkQWNjZXB0YW5jZURhdGEoKX0pXG4gICAgfSBlbHNlIHtcbiAgICAgIE9iamVjdC5hc3NpZ24oZGF0YSwge2ZhaWxlZF9hdF9tczogbm93TXN9KVxuICAgIH1cblxuICAgIGF3YWl0IHRoaXMuX2xvY2tDb25jdXJyZW5jeVJvdyhkYiwgam9iLmNvbmN1cnJlbmN5S2V5KVxuICAgIGNvbnN0IGFmZmVjdGVkUm93cyA9IGF3YWl0IHRoaXMuX3VwZGF0ZUFmZmVjdGVkUm93cyhkYiwge1xuICAgICAgY29uZGl0aW9uczoge2hhbmRvZmZfaWQ6IGpvYi5oYW5kb2ZmSWQsIGlkOiBqb2IuaWQsIHN0YXR1czogXCJoYW5kZWRfb2ZmXCJ9LFxuICAgICAgZGF0YSxcbiAgICAgIHRhYmxlTmFtZTogTE9DQUxfQkFDS0dST1VORF9KT0JTX1RBQkxFXG4gICAgfSlcblxuICAgIGlmIChhZmZlY3RlZFJvd3MgIT09IDEpIHJldHVybiBudWxsXG4gICAgYXdhaXQgdGhpcy5fcmVsZWFzZUNvbmN1cnJlbmN5KGRiLCBqb2IuY29uY3VycmVuY3lLZXkpXG4gICAgaWYgKCF3aWxsUmV0cnkpIGF3YWl0IHRoaXMuX3JlbGVhc2VTY2hlZHVsZU93bmVyc2hpcEZvckpvYihkYiwgam9iKVxuXG4gICAgcmV0dXJuIHtcbiAgICAgIC4uLmpvYixcbiAgICAgIC4uLih3aWxsUmV0cnkgPyB0aGlzLl9jbGVhcmVkQ2hpbGRBY2NlcHRhbmNlUm93KCkgOiB7fSksXG4gICAgICBhdHRlbXB0cyxcbiAgICAgIGZhaWxlZEF0TXM6IHdpbGxSZXRyeSA/IGpvYi5mYWlsZWRBdE1zIDogbm93TXMsXG4gICAgICBoYW5kZWRPZmZBdE1zOiBudWxsLFxuICAgICAgaGFuZG9mZklkOiBudWxsLFxuICAgICAgbGFzdEVycm9yOiBkYXRhLmxhc3RfZXJyb3IsXG4gICAgICBzY2hlZHVsZWRBdE1zOiB3aWxsUmV0cnkgPyBOdW1iZXIoZGF0YS5zY2hlZHVsZWRfYXRfbXMpIDogam9iLnNjaGVkdWxlZEF0TXMsXG4gICAgICBzdGF0dXM6IGRhdGEuc3RhdHVzLFxuICAgICAgd29ya2VySWQ6IG51bGxcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogUmV0dXJucyB0aGUgZGF0YWJhc2UgZGF0YSB0aGF0IGNsZWFycyBwb29sZWQtY2hpbGQgYWNjZXB0YW5jZSBldmlkZW5jZS5cbiAgICogQHJldHVybnMge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gLSBDbGVhcmVkIGFjY2VwdGFuY2UgY29sdW1ucy5cbiAgICovXG4gIF9jbGVhcmVkQ2hpbGRBY2NlcHRhbmNlRGF0YSgpIHtcbiAgICByZXR1cm4ge2NoaWxkX2luc3RhbmNlX2lkOiBudWxsLCBjaGlsZF9waWQ6IG51bGwsIGNoaWxkX3JlY2VpdmVkX2F0X21zOiBudWxsLCBjaGlsZF9zdGFydGVkX2F0X21zOiBudWxsfVxuICB9XG5cbiAgLyoqXG4gICAqIFJldHVybnMgdGhlIHJvdy1zaGFwZSBjb3VudGVycGFydCBvZiB0aGUgY2xlYXJlZCBhY2NlcHRhbmNlIGNvbHVtbnMuXG4gICAqIEByZXR1cm5zIHtQaWNrPGltcG9ydChcIi4vdHlwZXMuanNcIikuQmFja2dyb3VuZEpvYlJvdywgXCJjaGlsZEluc3RhbmNlSWRcIiB8IFwiY2hpbGRQaWRcIiB8IFwiY2hpbGRSZWNlaXZlZEF0TXNcIiB8IFwiY2hpbGRTdGFydGVkQXRNc1wiPn0gLSBDbGVhcmVkIGFjY2VwdGFuY2UgZmllbGRzLlxuICAgKi9cbiAgX2NsZWFyZWRDaGlsZEFjY2VwdGFuY2VSb3coKSB7XG4gICAgcmV0dXJuIHtjaGlsZEluc3RhbmNlSWQ6IG51bGwsIGNoaWxkUGlkOiBudWxsLCBjaGlsZFJlY2VpdmVkQXRNczogbnVsbCwgY2hpbGRTdGFydGVkQXRNczogbnVsbH1cbiAgfVxuXG4gIC8qKlxuICAgKiBFbnN1cmVzIHRoYXQgYSBkdXJhYmxlIGNvbmN1cnJlbmN5IGNvdW50ZXIgZXhpc3RzIHdpdGggdGhlIHJlcXVpcmVkIGNhcC5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9kYXRhYmFzZS9kcml2ZXJzL2Jhc2UuanNcIikuZGVmYXVsdH0gZGIgLSBMb2NhbCBTUUxpdGUgY29ubmVjdGlvbi5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL3R5cGVzLmpzXCIpLlJlc29sdmVkQmFja2dyb3VuZEpvYkNvbmN1cnJlbmN5fSBjb25jdXJyZW5jeSAtIERlc2lyZWQgY291bnRlci5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgd2hlbiBlbnN1cmVkLlxuICAgKi9cbiAgYXN5bmMgX2Vuc3VyZUNvbmN1cnJlbmN5KGRiLCBjb25jdXJyZW5jeSkge1xuICAgIGF3YWl0IGRiLnVwc2VydCh7XG4gICAgICBjb25mbGljdENvbHVtbnM6IFtcImNvbmN1cnJlbmN5X2tleVwiXSxcbiAgICAgIGRhdGE6IHthY3RpdmVfY291bnQ6IDAsIGNvbmN1cnJlbmN5X2tleTogY29uY3VycmVuY3kuY29uY3VycmVuY3lLZXksIG1heF9jb25jdXJyZW5jeTogY29uY3VycmVuY3kubWF4Q29uY3VycmVuY3l9LFxuICAgICAgdGFibGVOYW1lOiBMT0NBTF9CQUNLR1JPVU5EX0pPQl9DT05DVVJSRU5DWV9UQUJMRSxcbiAgICAgIHVwZGF0ZUNvbHVtbnM6IFtcImNvbmN1cnJlbmN5X2tleVwiXVxuICAgIH0pXG5cbiAgICBjb25zdCByb3dzID0gYXdhaXQgZGJcbiAgICAgIC5uZXdRdWVyeSgpXG4gICAgICAuZnJvbShMT0NBTF9CQUNLR1JPVU5EX0pPQl9DT05DVVJSRU5DWV9UQUJMRSlcbiAgICAgIC53aGVyZSh7Y29uY3VycmVuY3lfa2V5OiBjb25jdXJyZW5jeS5jb25jdXJyZW5jeUtleX0pXG4gICAgICAubGltaXQoMSlcbiAgICAgIC5yZXN1bHRzKClcblxuICAgIGNvbnN0IGV4aXN0aW5nUm93ID0gLyoqIEB0eXBlIHt7bWF4X2NvbmN1cnJlbmN5OiBudW1iZXIgfCBzdHJpbmd9fSAqLyAocm93c1swXSlcbiAgICBjb25zdCBleGlzdGluZ0NhcCA9IE51bWJlcihleGlzdGluZ1Jvdy5tYXhfY29uY3VycmVuY3kpXG5cbiAgICBpZiAoZXhpc3RpbmdDYXAgPT09IGNvbmN1cnJlbmN5Lm1heENvbmN1cnJlbmN5KSByZXR1cm5cbiAgICBpZiAoIWNvbmN1cnJlbmN5LnF1ZXVlRGVyaXZlZCkgdGhyb3cgbmV3IEVycm9yKGBDb25mbGljdGluZyBtYXhDb25jdXJyZW5jeSBmb3IgYmFja2dyb3VuZCBqb2IgY29uY3VycmVuY3lLZXk6ICR7Y29uY3VycmVuY3kuY29uY3VycmVuY3lLZXl9YClcblxuICAgIGF3YWl0IGRiLnVwZGF0ZSh7XG4gICAgICBjb25kaXRpb25zOiB7Y29uY3VycmVuY3lfa2V5OiBjb25jdXJyZW5jeS5jb25jdXJyZW5jeUtleX0sXG4gICAgICBkYXRhOiB7bWF4X2NvbmN1cnJlbmN5OiBjb25jdXJyZW5jeS5tYXhDb25jdXJyZW5jeX0sXG4gICAgICB0YWJsZU5hbWU6IExPQ0FMX0JBQ0tHUk9VTkRfSk9CX0NPTkNVUlJFTkNZX1RBQkxFXG4gICAgfSlcbiAgfVxuXG4gIC8qKlxuICAgKiBBdG9taWNhbGx5IHJlc2VydmVzIG9uZSBzbG90IGZvciBhIGNvbmN1cnJlbmN5IGtleS5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9kYXRhYmFzZS9kcml2ZXJzL2Jhc2UuanNcIikuZGVmYXVsdH0gZGIgLSBDb25uZWN0aW9uLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gY29uY3VycmVuY3lLZXkgLSBDb25jdXJyZW5jeSBrZXkuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPGJvb2xlYW4+fSAtIFdoZXRoZXIgYSBzbG90IHdhcyByZXNlcnZlZC5cbiAgICovXG4gIGFzeW5jIF9yZXNlcnZlQ29uY3VycmVuY3koZGIsIGNvbmN1cnJlbmN5S2V5KSB7XG4gICAgY29uc3QgdGFibGUgPSBkYi5xdW90ZVRhYmxlKExPQ0FMX0JBQ0tHUk9VTkRfSk9CX0NPTkNVUlJFTkNZX1RBQkxFKVxuICAgIGNvbnN0IGNvdW50ID0gZGIucXVvdGVDb2x1bW4oXCJhY3RpdmVfY291bnRcIilcbiAgICBjb25zdCBhZmZlY3RlZFJvd3MgPSBhd2FpdCBkYi5hZmZlY3RlZFJvd3MoXG4gICAgICBgVVBEQVRFICR7dGFibGV9IFNFVCAke2NvdW50fSA9ICR7Y291bnR9ICsgMSBgICtcbiAgICAgIGBXSEVSRSAke2RiLnF1b3RlQ29sdW1uKFwiY29uY3VycmVuY3lfa2V5XCIpfSA9ICR7ZGIucXVvdGUoY29uY3VycmVuY3lLZXkpfSBgICtcbiAgICAgIGBBTkQgJHtjb3VudH0gPCAke2RiLnF1b3RlQ29sdW1uKFwibWF4X2NvbmN1cnJlbmN5XCIpfWBcbiAgICApXG5cbiAgICByZXR1cm4gYWZmZWN0ZWRSb3dzID09PSAxXG4gIH1cblxuICAvKipcbiAgICogUmVsZWFzZXMgb25lIHNsb3QgZm9yIGEgY29uY3VycmVuY3kga2V5LlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL2RhdGFiYXNlL2RyaXZlcnMvYmFzZS5qc1wiKS5kZWZhdWx0fSBkYiAtIENvbm5lY3Rpb24uXG4gICAqIEBwYXJhbSB7c3RyaW5nIHwgbnVsbH0gY29uY3VycmVuY3lLZXkgLSBDb25jdXJyZW5jeSBrZXkuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIGFmdGVyIHJlbGVhc2UuXG4gICAqL1xuICBhc3luYyBfcmVsZWFzZUNvbmN1cnJlbmN5KGRiLCBjb25jdXJyZW5jeUtleSkge1xuICAgIGlmICghY29uY3VycmVuY3lLZXkpIHJldHVyblxuXG4gICAgY29uc3QgdGFibGUgPSBkYi5xdW90ZVRhYmxlKExPQ0FMX0JBQ0tHUk9VTkRfSk9CX0NPTkNVUlJFTkNZX1RBQkxFKVxuICAgIGNvbnN0IGNvdW50ID0gZGIucXVvdGVDb2x1bW4oXCJhY3RpdmVfY291bnRcIilcblxuICAgIGF3YWl0IGRiLmFmZmVjdGVkUm93cyhcbiAgICAgIGBVUERBVEUgJHt0YWJsZX0gU0VUICR7Y291bnR9ID0gJHtjb3VudH0gLSAxIGAgK1xuICAgICAgYFdIRVJFICR7ZGIucXVvdGVDb2x1bW4oXCJjb25jdXJyZW5jeV9rZXlcIil9ID0gJHtkYi5xdW90ZShjb25jdXJyZW5jeUtleSl9IEFORCAke2NvdW50fSA+IDBgXG4gICAgKVxuICB9XG5cbiAgLyoqXG4gICAqIEFjcXVpcmVzIHRoZSB0cmFuc2FjdGlvbidzIHdyaXRlIGxvY2sgZm9yIGEgY29uY3VycmVuY3kgY291bnRlciByb3cuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vZGF0YWJhc2UvZHJpdmVycy9iYXNlLmpzXCIpLmRlZmF1bHR9IGRiIC0gQ29ubmVjdGlvbi5cbiAgICogQHBhcmFtIHtzdHJpbmcgfCBudWxsfSBjb25jdXJyZW5jeUtleSAtIENvbmN1cnJlbmN5IGtleS5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgYWZ0ZXIgbG9ja2luZy5cbiAgICovXG4gIGFzeW5jIF9sb2NrQ29uY3VycmVuY3lSb3coZGIsIGNvbmN1cnJlbmN5S2V5KSB7XG4gICAgaWYgKCFjb25jdXJyZW5jeUtleSkgcmV0dXJuXG5cbiAgICBjb25zdCB0YWJsZSA9IGRiLnF1b3RlVGFibGUoTE9DQUxfQkFDS0dST1VORF9KT0JfQ09OQ1VSUkVOQ1lfVEFCTEUpXG4gICAgY29uc3QgY291bnQgPSBkYi5xdW90ZUNvbHVtbihcImFjdGl2ZV9jb3VudFwiKVxuXG4gICAgYXdhaXQgZGIucXVlcnkoXG4gICAgICBgVVBEQVRFICR7dGFibGV9IFNFVCAke2NvdW50fSA9ICR7Y291bnR9IGAgK1xuICAgICAgYFdIRVJFICR7ZGIucXVvdGVDb2x1bW4oXCJjb25jdXJyZW5jeV9rZXlcIil9ID0gJHtkYi5xdW90ZShjb25jdXJyZW5jeUtleSl9YFxuICAgIClcbiAgfVxuXG4gIC8qKlxuICAgKiBSZWJ1aWxkcyBhY3RpdmUgY291bnRlcnMgZnJvbSBkdXJhYmxlIGhhbmRlZC1vZmYgam9icy5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9kYXRhYmFzZS9kcml2ZXJzL2Jhc2UuanNcIikuZGVmYXVsdH0gZGIgLSBDb25uZWN0aW9uLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyBhZnRlciBjb3VudGVyIHJlYnVpbGQuXG4gICAqL1xuICBhc3luYyBfcmVidWlsZENvbmN1cnJlbmN5Q291bnRzKGRiKSB7XG4gICAgY29uc3QgY29uY3VycmVuY3lUYWJsZSA9IGRiLnF1b3RlVGFibGUoTE9DQUxfQkFDS0dST1VORF9KT0JfQ09OQ1VSUkVOQ1lfVEFCTEUpXG4gICAgY29uc3Qgam9ic1RhYmxlID0gZGIucXVvdGVUYWJsZShMT0NBTF9CQUNLR1JPVU5EX0pPQlNfVEFCTEUpXG5cbiAgICBhd2FpdCBkYi5xdWVyeShcbiAgICAgIGBVUERBVEUgJHtjb25jdXJyZW5jeVRhYmxlfSBTRVQgJHtkYi5xdW90ZUNvbHVtbihcImFjdGl2ZV9jb3VudFwiKX0gPSAoYCArXG4gICAgICBgU0VMRUNUIENPVU5UKCopIEZST00gJHtqb2JzVGFibGV9IFdIRVJFICR7am9ic1RhYmxlfS4ke2RiLnF1b3RlQ29sdW1uKFwic3RhdHVzXCIpfSA9ICR7ZGIucXVvdGUoXCJoYW5kZWRfb2ZmXCIpfSBBTkQgYCArXG4gICAgICBgJHtqb2JzVGFibGV9LiR7ZGIucXVvdGVDb2x1bW4oXCJjb25jdXJyZW5jeV9rZXlcIil9ID0gJHtjb25jdXJyZW5jeVRhYmxlfS4ke2RiLnF1b3RlQ29sdW1uKFwiY29uY3VycmVuY3lfa2V5XCIpfSlgXG4gICAgKVxuICB9XG5cbiAgLyoqXG4gICAqIEJ1aWxkcyB0aGUgY29uZmlndXJlZCBxdWV1ZS1wcmlvcml0eSBvcmRlcmluZyBleHByZXNzaW9uLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL2RhdGFiYXNlL2RyaXZlcnMvYmFzZS5qc1wiKS5kZWZhdWx0fSBkYiAtIENvbm5lY3Rpb24uXG4gICAqIEByZXR1cm5zIHtzdHJpbmcgfCBudWxsfSAtIFF1ZXVlIHByaW9yaXR5IGV4cHJlc3Npb24uXG4gICAqL1xuICBfcXVldWVQcmlvcml0eU9yZGVyU3FsKGRiKSB7XG4gICAgY29uc3QgcXVldWVzID0gdGhpcy5jb25maWd1cmF0aW9uLmdldEJhY2tncm91bmRKb2JzQ29uZmlnKCkucXVldWVzXG4gICAgY29uc3QgcHJpb3JpdGl6ZWQgPSBPYmplY3QuZW50cmllcyhxdWV1ZXMpXG4gICAgICAuZmlsdGVyKChbLCBxdWV1ZV0pID0+IE51bWJlci5pc0Zpbml0ZShxdWV1ZT8ucHJpb3JpdHkpICYmIE51bWJlcihxdWV1ZS5wcmlvcml0eSkgIT09IDApXG4gICAgICAubWFwKChbcXVldWVOYW1lLCBxdWV1ZV0pID0+IFtxdWV1ZU5hbWUsIE51bWJlcihxdWV1ZS5wcmlvcml0eSldKVxuXG4gICAgaWYgKHByaW9yaXRpemVkLmxlbmd0aCA9PT0gMCkgcmV0dXJuIG51bGxcblxuICAgIGNvbnN0IHdoZW5zID0gcHJpb3JpdGl6ZWRcbiAgICAgIC5tYXAoKFtxdWV1ZSwgcHJpb3JpdHldKSA9PiBgV0hFTiAke2RiLnF1b3RlKHF1ZXVlKX0gVEhFTiAke3ByaW9yaXR5fWApXG4gICAgICAuam9pbihcIiBcIilcblxuICAgIHJldHVybiBgQ0FTRSBDT0FMRVNDRSgke2RiLnF1b3RlQ29sdW1uKFwicXVldWVcIil9LCAke2RiLnF1b3RlKERFRkFVTFRfQkFDS0dST1VORF9KT0JfUVVFVUUpfSkgJHt3aGVuc30gRUxTRSAwIEVORGBcbiAgfVxuXG4gIC8qKlxuICAgKiBDaGVja3Mgd2hldGhlciBhIHBlcnNpc3RlZCBoYW5kb2ZmIG93bnMgdGhlIHN1cHBsaWVkIGFja25vd2xlZGdlbWVudCBmZW5jZS5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL3R5cGVzLmpzXCIpLkJhY2tncm91bmRKb2JSb3cgfCBudWxsfSBqb2IgLSBQZXJzaXN0ZWQgam9iLlxuICAgKiBAcGFyYW0ge3N0cmluZyB8IHVuZGVmaW5lZH0gaGFuZG9mZklkIC0gSGFuZG9mZiBmZW5jZS5cbiAgICogQHJldHVybnMge2pvYiBpcyBpbXBvcnQoXCIuL3R5cGVzLmpzXCIpLkJhY2tncm91bmRKb2JSb3d9IC0gV2hldGhlciBhY2NlcHRlZC5cbiAgICovXG4gIF9hY2NlcHRzSGFuZG9mZihqb2IsIGhhbmRvZmZJZCkge1xuICAgIHJldHVybiBCb29sZWFuKGpvYiAmJiBqb2Iuc3RhdHVzID09PSBcImhhbmRlZF9vZmZcIiAmJiBqb2IuaGFuZG9mZklkICYmIGpvYi5oYW5kb2ZmSWQgPT09IGhhbmRvZmZJZClcbiAgfVxuXG4gIC8qKlxuICAgKiBGaW5kcyBhIHBlcnNpc3RlZCBsb2NhbCBqb2IgdXNpbmcgdGhlIGN1cnJlbnQgY29ubmVjdGlvbi5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9kYXRhYmFzZS9kcml2ZXJzL2Jhc2UuanNcIikuZGVmYXVsdH0gZGIgLSBDb25uZWN0aW9uLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gam9iSWQgLSBKb2IgaWQuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPGltcG9ydChcIi4vdHlwZXMuanNcIikuQmFja2dyb3VuZEpvYlJvdyB8IG51bGw+fSAtIFBlcnNpc3RlZCByb3cuXG4gICAqL1xuICBhc3luYyBfZ2V0Sm9iKGRiLCBqb2JJZCkge1xuICAgIGNvbnN0IHJvd3MgPSBhd2FpdCBkYi5uZXdRdWVyeSgpLmZyb20oTE9DQUxfQkFDS0dST1VORF9KT0JTX1RBQkxFKS53aGVyZSh7aWQ6IGpvYklkfSkubGltaXQoMSkucmVzdWx0cygpXG5cbiAgICByZXR1cm4gcm93c1swXSA/IHRoaXMuX25vcm1hbGl6ZVJvdyhyb3dzWzBdKSA6IG51bGxcbiAgfVxuXG4gIC8qKlxuICAgKiBSZWFkcyB0aGUgam9iIGN1cnJlbnRseSBuYW1lZCBieSBvbmUgc3RhYmxlIG93bmVyIHJvdy5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9kYXRhYmFzZS9kcml2ZXJzL2Jhc2UuanNcIikuZGVmYXVsdH0gZGIgLSBEYXRhYmFzZSBjb25uZWN0aW9uLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gc2NoZWR1bGVLZXkgLSBWYWxpZGF0ZWQgc3RhYmxlIHNjaGVkdWxlIGtleS5cbiAgICogQHJldHVybnMge1Byb21pc2U8aW1wb3J0KFwiLi90eXBlcy5qc1wiKS5CYWNrZ3JvdW5kSm9iUm93IHwgbnVsbD59IC0gTm9ybWFsaXplZCBvd25lciBqb2IuXG4gICAqL1xuICBhc3luYyBfc2NoZWR1bGVkT3duZXJKb2IoZGIsIHNjaGVkdWxlS2V5KSB7XG4gICAgY29uc3Qgb3duZXJSb3dzID0gYXdhaXQgZGJcbiAgICAgIC5uZXdRdWVyeSgpXG4gICAgICAuZnJvbShMT0NBTF9CQUNLR1JPVU5EX0pPQl9TQ0hFRFVMRV9LRVlTX1RBQkxFKVxuICAgICAgLndoZXJlKHtzY2hlZHVsZV9rZXk6IHNjaGVkdWxlS2V5fSlcbiAgICAgIC5saW1pdCgxKVxuICAgICAgLnJlc3VsdHMoKVxuICAgIGNvbnN0IG93bmVyUm93ID0gb3duZXJSb3dzWzBdXG5cbiAgICBpZiAoIW93bmVyUm93KSByZXR1cm4gbnVsbFxuXG4gICAgcmV0dXJuIGF3YWl0IHRoaXMuX2dldEpvYihkYiwgU3RyaW5nKG93bmVyUm93LmpvYl9pZCkpXG4gIH1cblxuICAvKipcbiAgICogQXNzaWducyB0aGUgbmV4dCBvd25lcnNoaXAgb3JkZXIgYWZ0ZXIgU1FMaXRlIHdyaXRlIHNlcmlhbGl6YXRpb24gaXMgaGVsZC5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9kYXRhYmFzZS9kcml2ZXJzL2Jhc2UuanNcIikuZGVmYXVsdH0gZGIgLSBEYXRhYmFzZSBjb25uZWN0aW9uLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gc2NoZWR1bGVLZXkgLSBWYWxpZGF0ZWQgc3RhYmxlIHNjaGVkdWxlIGtleS5cbiAgICogQHJldHVybnMge1Byb21pc2U8bnVtYmVyPn0gLSBOZXh0IG1vbm90b25pYyBvd25lcnNoaXAgb3JkZXIuXG4gICAqL1xuICBhc3luYyBfbmV4dFNjaGVkdWxlT3JkZXIoZGIsIHNjaGVkdWxlS2V5KSB7XG4gICAgY29uc3Qgcm93cyA9IGF3YWl0IGRiXG4gICAgICAubmV3UXVlcnkoKVxuICAgICAgLmZyb20oTE9DQUxfQkFDS0dST1VORF9KT0JTX1RBQkxFKVxuICAgICAgLnNlbGVjdChcInNjaGVkdWxlX29yZGVyXCIpXG4gICAgICAud2hlcmUoe3NjaGVkdWxlX2tleTogc2NoZWR1bGVLZXl9KVxuICAgICAgLndoZXJlKGAke2RiLnF1b3RlQ29sdW1uKFwic2NoZWR1bGVfb3JkZXJcIil9IElTIE5PVCBOVUxMYClcbiAgICAgIC5vcmRlcihcInNjaGVkdWxlX29yZGVyIERFU0NcIilcbiAgICAgIC5saW1pdCgxKVxuICAgICAgLnJlc3VsdHMoKVxuICAgIGNvbnN0IGN1cnJlbnRPcmRlciA9IHRoaXMuX251bWJlck9yTnVsbCgvKiogQHR5cGUge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gKi8gKHJvd3NbMF0gfHwge30pLnNjaGVkdWxlX29yZGVyKVxuXG4gICAgaWYgKGN1cnJlbnRPcmRlciA9PT0gbnVsbCkgcmV0dXJuIDFcbiAgICBpZiAoIU51bWJlci5pc1NhZmVJbnRlZ2VyKGN1cnJlbnRPcmRlcikgfHwgY3VycmVudE9yZGVyIDwgMSB8fCBjdXJyZW50T3JkZXIgPj0gTnVtYmVyLk1BWF9TQUZFX0lOVEVHRVIpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihgSW52YWxpZCBsb2NhbCBiYWNrZ3JvdW5kIGpvYiBzY2hlZHVsZSBvd25lcnNoaXAgb3JkZXI6ICR7Y3VycmVudE9yZGVyfWApXG4gICAgfVxuXG4gICAgcmV0dXJuIGN1cnJlbnRPcmRlciArIDFcbiAgfVxuXG4gIC8qKlxuICAgKiBCdWlsZHMgYSBzdGFibGUtc2NoZWR1bGUgbG9va3VwIGV4Y2x1c2l2ZWx5IGZyb20gbm9ybWFsaXplZCBsb2NhbCBqb2JzLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL2RhdGFiYXNlL2RyaXZlcnMvYmFzZS5qc1wiKS5kZWZhdWx0fSBkYiAtIERhdGFiYXNlIGNvbm5lY3Rpb24uXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gTG9va3VwIG9wdGlvbnMuXG4gICAqIEBwYXJhbSB7Ym9vbGVhbn0gYXJncy5pbmNsdWRlTGF0ZXN0VGVybWluYWwgLSBXaGV0aGVyIHRlcm1pbmFsIGhpc3RvcnkgaXMgcmVxdWVzdGVkLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gYXJncy5zY2hlZHVsZUtleSAtIFZhbGlkYXRlZCBzdGFibGUgc2NoZWR1bGUga2V5LlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxpbXBvcnQoXCIuL3R5cGVzLmpzXCIpLkJhY2tncm91bmRKb2JTY2hlZHVsZWRMb29rdXBSZXN1bHQ+fSAtIE5vcm1hbGl6ZWQgbG9jYWwgam9icy5cbiAgICovXG4gIGFzeW5jIF9zY2hlZHVsZWRKb2JMb29rdXAoZGIsIHtpbmNsdWRlTGF0ZXN0VGVybWluYWwsIHNjaGVkdWxlS2V5fSkge1xuICAgIGNvbnN0IG93bmVySm9iID0gYXdhaXQgdGhpcy5fc2NoZWR1bGVkT3duZXJKb2IoZGIsIHNjaGVkdWxlS2V5KVxuICAgIGNvbnN0IGN1cnJlbnRKb2IgPSBvd25lckpvYiAmJiAob3duZXJKb2Iuc3RhdHVzID09PSBcInF1ZXVlZFwiIHx8IG93bmVySm9iLnN0YXR1cyA9PT0gXCJoYW5kZWRfb2ZmXCIpID8gb3duZXJKb2IgOiBudWxsXG5cbiAgICBpZiAoIWluY2x1ZGVMYXRlc3RUZXJtaW5hbCkgcmV0dXJuIHtjdXJyZW50Sm9iLCBsYXRlc3RUZXJtaW5hbEpvYjogbnVsbH1cblxuICAgIGNvbnN0IHRlcm1pbmFsU3RhdHVzZXMgPSBCQUNLR1JPVU5EX0pPQl9URVJNSU5BTF9TVEFUVVNFUy5tYXAoKHN0YXR1cykgPT4gZGIucXVvdGUoc3RhdHVzKSkuam9pbihcIiwgXCIpXG4gICAgY29uc3QgdGVybWluYWxSb3dzID0gYXdhaXQgZGJcbiAgICAgIC5uZXdRdWVyeSgpXG4gICAgICAuZnJvbShMT0NBTF9CQUNLR1JPVU5EX0pPQlNfVEFCTEUpXG4gICAgICAud2hlcmUoe3NjaGVkdWxlX2tleTogc2NoZWR1bGVLZXl9KVxuICAgICAgLndoZXJlKGAke2RiLnF1b3RlQ29sdW1uKFwic3RhdHVzXCIpfSBJTiAoJHt0ZXJtaW5hbFN0YXR1c2VzfSlgKVxuICAgICAgLm9yZGVyKGBDQVNFIFdIRU4gJHtkYi5xdW90ZUNvbHVtbihcInNjaGVkdWxlX29yZGVyXCIpfSBJUyBOVUxMIFRIRU4gMCBFTFNFIDEgRU5EIERFU0NgKVxuICAgICAgLm9yZGVyKFwic2NoZWR1bGVfb3JkZXIgREVTQ1wiKVxuICAgICAgLm9yZGVyKFwiY3JlYXRlZF9hdF9tcyBERVNDXCIpXG4gICAgICAub3JkZXIoXCJpZCBERVNDXCIpXG4gICAgICAubGltaXQoMSlcbiAgICAgIC5yZXN1bHRzKClcbiAgICBjb25zdCBsYXRlc3RUZXJtaW5hbEpvYiA9IHRlcm1pbmFsUm93c1swXSA/IHRoaXMuX25vcm1hbGl6ZVJvdyh0ZXJtaW5hbFJvd3NbMF0pIDogbnVsbFxuXG4gICAgcmV0dXJuIHtjdXJyZW50Sm9iLCBsYXRlc3RUZXJtaW5hbEpvYn1cbiAgfVxuXG4gIC8qKlxuICAgKiBSZWxlYXNlcyBvd25lcnNoaXAgb25seSB3aGVuIHRoZSBrZXkgc3RpbGwgcG9pbnRzIGF0IHRoZSBleHBlY3RlZCBqb2IuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vZGF0YWJhc2UvZHJpdmVycy9iYXNlLmpzXCIpLmRlZmF1bHR9IGRiIC0gRGF0YWJhc2UgY29ubmVjdGlvbi5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBPd25lcnNoaXAgaWRlbnRpdHkuXG4gICAqIEBwYXJhbSB7c3RyaW5nIHwgbnVsbH0gYXJncy5qb2JJZCAtIEV4cGVjdGVkIG93bmVyIGpvYiBpZCwgb3IgbnVsbCBmb3IgYSBkYW5nbGluZyBvd25lci5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGFyZ3Muc2NoZWR1bGVLZXkgLSBTdGFibGUgc2NoZWR1bGUga2V5LlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyB3aGVuIGRlbGV0ZWQgb3IgYWxyZWFkeSBzdXBlcnNlZGVkLlxuICAgKi9cbiAgYXN5bmMgX3JlbGVhc2VTY2hlZHVsZU93bmVyc2hpcChkYiwge2pvYklkLCBzY2hlZHVsZUtleX0pIHtcbiAgICBjb25zdCBjb25kaXRpb25zID0gam9iSWQgPT09IG51bGxcbiAgICAgID8ge3NjaGVkdWxlX2tleTogc2NoZWR1bGVLZXl9XG4gICAgICA6IHtqb2JfaWQ6IGpvYklkLCBzY2hlZHVsZV9rZXk6IHNjaGVkdWxlS2V5fVxuXG4gICAgYXdhaXQgZGIuZGVsZXRlKHtjb25kaXRpb25zLCB0YWJsZU5hbWU6IExPQ0FMX0JBQ0tHUk9VTkRfSk9CX1NDSEVEVUxFX0tFWVNfVEFCTEV9KVxuICB9XG5cbiAgLyoqXG4gICAqIFJlbGVhc2VzIGEgdGVybWluYWwgam9iJ3Mgc3RhYmxlIG93bmVyc2hpcCB3aGVuIHN0aWxsIGN1cnJlbnQuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vZGF0YWJhc2UvZHJpdmVycy9iYXNlLmpzXCIpLmRlZmF1bHR9IGRiIC0gRGF0YWJhc2UgY29ubmVjdGlvbi5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL3R5cGVzLmpzXCIpLkJhY2tncm91bmRKb2JSb3d9IGpvYiAtIFRlcm1pbmFsIGpvYi5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgd2hlbiBkZWxldGVkIG9yIG5vdCBhcHBsaWNhYmxlLlxuICAgKi9cbiAgYXN5bmMgX3JlbGVhc2VTY2hlZHVsZU93bmVyc2hpcEZvckpvYihkYiwgam9iKSB7XG4gICAgaWYgKCFqb2Iuc2NoZWR1bGVLZXkpIHJldHVyblxuXG4gICAgYXdhaXQgdGhpcy5fcmVsZWFzZVNjaGVkdWxlT3duZXJzaGlwKGRiLCB7am9iSWQ6IGpvYi5pZCwgc2NoZWR1bGVLZXk6IGpvYi5zY2hlZHVsZUtleX0pXG4gIH1cblxuICAvKipcbiAgICogQWNxdWlyZXMgU1FMaXRlJ3MgdHJhbnNhY3Rpb24gd3JpdGUgc2VyaWFsaXphdGlvbiBiZWZvcmUgcmVhZGluZyBhIHN0YWJsZVxuICAgKiBvd25lci4gQSB6ZXJvLXJvdyB1cGRhdGUgc3RpbGwgZXN0YWJsaXNoZXMgdGhlIHdyaXRlIGJvdW5kYXJ5IGZvciBhIG5ldyBrZXkuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vZGF0YWJhc2UvZHJpdmVycy9iYXNlLmpzXCIpLmRlZmF1bHR9IGRiIC0gRGF0YWJhc2UgY29ubmVjdGlvbi5cbiAgICogQHBhcmFtIHtzdHJpbmd9IHNjaGVkdWxlS2V5IC0gVmFsaWRhdGVkIHN0YWJsZSBzY2hlZHVsZSBrZXkuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIGFmdGVyIHdyaXRlIHNlcmlhbGl6YXRpb24gaXMgYWNxdWlyZWQuXG4gICAqL1xuICBhc3luYyBfbG9ja1NjaGVkdWxlS2V5KGRiLCBzY2hlZHVsZUtleSkge1xuICAgIGNvbnN0IHRhYmxlID0gZGIucXVvdGVUYWJsZShMT0NBTF9CQUNLR1JPVU5EX0pPQl9TQ0hFRFVMRV9LRVlTX1RBQkxFKVxuICAgIGNvbnN0IGpvYklkID0gZGIucXVvdGVDb2x1bW4oXCJqb2JfaWRcIilcblxuICAgIGF3YWl0IGRiLnF1ZXJ5KFxuICAgICAgYFVQREFURSAke3RhYmxlfSBTRVQgJHtqb2JJZH0gPSAke2pvYklkfSBgICtcbiAgICAgIGBXSEVSRSAke2RiLnF1b3RlQ29sdW1uKFwic2NoZWR1bGVfa2V5XCIpfSA9ICR7ZGIucXVvdGUoc2NoZWR1bGVLZXkpfWBcbiAgICApXG4gIH1cblxuICAvKipcbiAgICogUmVnaXN0ZXJzIHRoZSBsb2NhbCBkaXNwYXRjaCBwb2tlIG9uIHRoZSBzdXJyb3VuZGluZyB0cmFuc2FjdGlvbiBjb21taXQuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vZGF0YWJhc2UvZHJpdmVycy9iYXNlLmpzXCIpLmRlZmF1bHR9IGRiIC0gVHJhbnNhY3Rpb24gY29ubmVjdGlvbi5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgYWZ0ZXIgcmVnaXN0cmF0aW9uLlxuICAgKi9cbiAgYXN5bmMgX3dha2VEaXNwYXRjaGVyQWZ0ZXJDb21taXQoZGIpIHtcbiAgICBpZiAodGhpcy5vbkNvbW1pdHRlZEVucXVldWUpIGF3YWl0IGRiLmFmdGVyQ29tbWl0KHRoaXMub25Db21taXR0ZWRFbnF1ZXVlKVxuICB9XG5cbiAgLyoqXG4gICAqIE5vcm1hbGl6ZXMgb25lIHJhdyBsb2NhbCBkYXRhYmFzZSByb3cuXG4gICAqIEBwYXJhbSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSByb3cgLSBSYXcgcm93LlxuICAgKiBAcmV0dXJucyB7aW1wb3J0KFwiLi90eXBlcy5qc1wiKS5CYWNrZ3JvdW5kSm9iUm93fSAtIE5vcm1hbGl6ZWQgcm93LlxuICAgKi9cbiAgX25vcm1hbGl6ZVJvdyhyb3cpIHtcbiAgICBjb25zdCBwYXJzZWRBcmdzID0gSlNPTi5wYXJzZShTdHJpbmcocm93LmFyZ3NfanNvbikpXG4gICAgY29uc3QgZXhlY3V0aW9uTW9kZSA9IG5vcm1hbGl6ZUJhY2tncm91bmRKb2JFeGVjdXRpb25Nb2RlKHtleGVjdXRpb25Nb2RlOiBTdHJpbmcocm93LmV4ZWN1dGlvbl9tb2RlKX0sIFwiaW5saW5lXCIsIExPQ0FMX0VYRUNVVElPTl9NT0RFUylcblxuICAgIGlmICghQXJyYXkuaXNBcnJheShwYXJzZWRBcmdzKSkgdGhyb3cgbmV3IEVycm9yKGBJbnZhbGlkIGxvY2FsIGJhY2tncm91bmQgam9iIGFyZ3NfanNvbiBmb3Igam9iOiAke1N0cmluZyhyb3cuaWQpfWApXG4gICAgaWYgKGV4ZWN1dGlvbk1vZGUgIT09IFwiaW5saW5lXCIpIHRocm93IG5ldyBFcnJvcihcIkxvY2FsIGJhY2tncm91bmQgam9iIGV4ZWN1dGlvbiBtb2RlIGludmFyaWFudCB3YXMgdmlvbGF0ZWRcIilcblxuICAgIHJldHVybiB7XG4gICAgICBhcmdzOiBwYXJzZWRBcmdzLFxuICAgICAgYXR0ZW1wdHM6IHRoaXMuX251bWJlck9yTnVsbChyb3cuYXR0ZW1wdHMpLFxuICAgICAgY2hpbGRJbnN0YW5jZUlkOiByb3cuY2hpbGRfaW5zdGFuY2VfaWQgPT09IG51bGwgfHwgcm93LmNoaWxkX2luc3RhbmNlX2lkID09PSB1bmRlZmluZWQgPyBudWxsIDogU3RyaW5nKHJvdy5jaGlsZF9pbnN0YW5jZV9pZCksXG4gICAgICBjaGlsZFBpZDogdGhpcy5fbnVtYmVyT3JOdWxsKHJvdy5jaGlsZF9waWQpLFxuICAgICAgY2hpbGRSZWNlaXZlZEF0TXM6IHRoaXMuX251bWJlck9yTnVsbChyb3cuY2hpbGRfcmVjZWl2ZWRfYXRfbXMpLFxuICAgICAgY2hpbGRTdGFydGVkQXRNczogdGhpcy5fbnVtYmVyT3JOdWxsKHJvdy5jaGlsZF9zdGFydGVkX2F0X21zKSxcbiAgICAgIGNvbXBsZXRlZEF0TXM6IHRoaXMuX251bWJlck9yTnVsbChyb3cuY29tcGxldGVkX2F0X21zKSxcbiAgICAgIGNvbmN1cnJlbmN5S2V5OiByb3cuY29uY3VycmVuY3lfa2V5ID09PSBudWxsIHx8IHJvdy5jb25jdXJyZW5jeV9rZXkgPT09IHVuZGVmaW5lZCA/IG51bGwgOiBTdHJpbmcocm93LmNvbmN1cnJlbmN5X2tleSksXG4gICAgICBjcmVhdGVkQXRNczogdGhpcy5fbnVtYmVyT3JOdWxsKHJvdy5jcmVhdGVkX2F0X21zKSxcbiAgICAgIGV4ZWN1dGlvbk1vZGUsXG4gICAgICBmYWlsZWRBdE1zOiB0aGlzLl9udW1iZXJPck51bGwocm93LmZhaWxlZF9hdF9tcyksXG4gICAgICBoYW5kZWRPZmZBdE1zOiB0aGlzLl9udW1iZXJPck51bGwocm93LmhhbmRlZF9vZmZfYXRfbXMpLFxuICAgICAgaGFuZG9mZklkOiByb3cuaGFuZG9mZl9pZCA9PT0gbnVsbCB8fCByb3cuaGFuZG9mZl9pZCA9PT0gdW5kZWZpbmVkID8gbnVsbCA6IFN0cmluZyhyb3cuaGFuZG9mZl9pZCksXG4gICAgICBpZDogU3RyaW5nKHJvdy5pZCksXG4gICAgICBqb2JOYW1lOiBTdHJpbmcocm93LmpvYl9uYW1lKSxcbiAgICAgIGxhc3RFcnJvcjogcm93Lmxhc3RfZXJyb3IgPT09IG51bGwgfHwgcm93Lmxhc3RfZXJyb3IgPT09IHVuZGVmaW5lZCA/IG51bGwgOiBTdHJpbmcocm93Lmxhc3RfZXJyb3IpLFxuICAgICAgbWF4Q29uY3VycmVuY3k6IHRoaXMuX251bWJlck9yTnVsbChyb3cubWF4X2NvbmN1cnJlbmN5KSxcbiAgICAgIG1heFJldHJpZXM6IHRoaXMuX251bWJlck9yTnVsbChyb3cubWF4X3JldHJpZXMpLFxuICAgICAgb3JwaGFuZWRBdE1zOiBudWxsLFxuICAgICAgcXVldWU6IHJvdy5xdWV1ZSA/IFN0cmluZyhyb3cucXVldWUpIDogREVGQVVMVF9CQUNLR1JPVU5EX0pPQl9RVUVVRSxcbiAgICAgIHNjaGVkdWxlS2V5OiByb3cuc2NoZWR1bGVfa2V5ID09PSBudWxsIHx8IHJvdy5zY2hlZHVsZV9rZXkgPT09IHVuZGVmaW5lZCA/IG51bGwgOiBTdHJpbmcocm93LnNjaGVkdWxlX2tleSksXG4gICAgICBzY2hlZHVsZU9yZGVyOiB0aGlzLl9udW1iZXJPck51bGwocm93LnNjaGVkdWxlX29yZGVyKSxcbiAgICAgIHNjaGVkdWxlZEF0TXM6IHRoaXMuX251bWJlck9yTnVsbChyb3cuc2NoZWR1bGVkX2F0X21zKSxcbiAgICAgIHN0YXR1czogbm9ybWFsaXplQmFja2dyb3VuZEpvYlN0YXR1cyhyb3cuc3RhdHVzID8gU3RyaW5nKHJvdy5zdGF0dXMpIDogXCJxdWV1ZWRcIiksXG4gICAgICB0aW1lb3V0TXM6IG51bGwsXG4gICAgICB3b3JrZXJJZDogcm93Lndvcmtlcl9pZCA9PT0gbnVsbCB8fCByb3cud29ya2VyX2lkID09PSB1bmRlZmluZWQgPyBudWxsIDogU3RyaW5nKHJvdy53b3JrZXJfaWQpXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIE5vcm1hbGl6ZXMgb25lIG51bGxhYmxlIGRhdGFiYXNlIG51bWJlci5cbiAgICogQHBhcmFtIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gdmFsdWUgLSBEYXRhYmFzZSBudW1iZXIuXG4gICAqIEByZXR1cm5zIHtudW1iZXIgfCBudWxsfSAtIE5vcm1hbGl6ZWQgbnVtYmVyLlxuICAgKi9cbiAgX251bWJlck9yTnVsbCh2YWx1ZSkge1xuICAgIGlmICh2YWx1ZSA9PT0gbnVsbCB8fCB2YWx1ZSA9PT0gdW5kZWZpbmVkIHx8IHZhbHVlID09PSBcIlwiKSByZXR1cm4gbnVsbFxuXG4gICAgY29uc3QgbnVtYmVyID0gTnVtYmVyKHZhbHVlKVxuXG4gICAgcmV0dXJuIE51bWJlci5pc05hTihudW1iZXIpID8gbnVsbCA6IG51bWJlclxuICB9XG5cbiAgLyoqXG4gICAqIEV4ZWN1dGVzIGEgc3RydWN0dXJlZCB1cGRhdGUgYW5kIHJlcG9ydHMgaXRzIGFmZmVjdGVkLXJvdyBjb3VudC5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9kYXRhYmFzZS9kcml2ZXJzL2Jhc2UuanNcIikuZGVmYXVsdH0gZGIgLSBDb25uZWN0aW9uLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL2RhdGFiYXNlL2RyaXZlcnMvYmFzZS5qc1wiKS5VcGRhdGVTcWxBcmdzVHlwZX0gYXJncyAtIFVwZGF0ZSBhcmd1bWVudHMuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPG51bWJlcj59IC0gQWZmZWN0ZWQgcm93cy5cbiAgICovXG4gIGFzeW5jIF91cGRhdGVBZmZlY3RlZFJvd3MoZGIsIGFyZ3MpIHsgcmV0dXJuIGF3YWl0IGRiLmFmZmVjdGVkUm93cyhkYi51cGRhdGVTcWwoYXJncykpIH1cblxuICAvKipcbiAgICogSm9pbnMgYW4gYW1iaWVudCBhcHAgdHJhbnNhY3Rpb24gb3IgdXNlcyB0aGUgZGF0YWJhc2UncyBzY29wZWQgb3BlcmF0aW9uIGxlYXNlLlxuICAgKiBAdGVtcGxhdGUgVFxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL2RhdGFiYXNlL2RyaXZlcnMvYmFzZS5qc1wiKS5kZWZhdWx0fSBkYiAtIENvbm5lY3Rpb24uXG4gICAqIEBwYXJhbSB7KGRiOiBpbXBvcnQoXCIuLi9kYXRhYmFzZS9kcml2ZXJzL2Jhc2UuanNcIikuZGVmYXVsdCkgPT4gUHJvbWlzZTxUPn0gY2FsbGJhY2sgLSBNdXRhdGlvbi5cbiAgICogQHJldHVybnMge1Byb21pc2U8VD59IC0gTXV0YXRpb24gcmVzdWx0LlxuICAgKi9cbiAgYXN5bmMgX211dGF0ZShkYiwgY2FsbGJhY2spIHtcbiAgICBpZiAoZGIuaW5zaWRlVHJhbnNhY3Rpb24oKSkgcmV0dXJuIGF3YWl0IHRoaXMuX3RyYW5zYWN0aW9uUmVzdWx0KGRiLCBhc3luYyAoKSA9PiBhd2FpdCBjYWxsYmFjayhkYikpXG5cbiAgICByZXR1cm4gYXdhaXQgdGhpcy5jb25maWd1cmF0aW9uLndpdGhUcmFuc2FjdGlvbih7XG4gICAgICBkYXRhYmFzZUlkZW50aWZpZXI6IHRoaXMuZ2V0RGF0YWJhc2VJZGVudGlmaWVyKCksXG4gICAgICBuYW1lOiBcIkxvY2FsIGJhY2tncm91bmQgam9icyBtdXRhdGlvblwiXG4gICAgfSwgYXN5bmMgKG9wZXJhdGlvbikgPT4gYXdhaXQgY2FsbGJhY2sob3BlcmF0aW9uLmNvbm5lY3Rpb24oKSkpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBhIGNhbGxiYWNrIGluIGEgdHJhbnNhY3Rpb24gYW5kIHJldHVybnMgaXRzIGNhcHR1cmVkIHJlc3VsdC5cbiAgICogQHRlbXBsYXRlIFRcbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9kYXRhYmFzZS9kcml2ZXJzL2Jhc2UuanNcIikuZGVmYXVsdH0gZGIgLSBDb25uZWN0aW9uLlxuICAgKiBAcGFyYW0geygpID0+IFByb21pc2U8VD59IGNhbGxiYWNrIC0gVHJhbnNhY3Rpb24gY2FsbGJhY2suXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPFQ+fSAtIENhbGxiYWNrIHJlc3VsdC5cbiAgICovXG4gIGFzeW5jIF90cmFuc2FjdGlvblJlc3VsdChkYiwgY2FsbGJhY2spIHtcbiAgICBsZXQgY29tcGxldGVkID0gZmFsc2VcbiAgICAvKiogQHR5cGUge1QgfCB1bmRlZmluZWR9ICovXG4gICAgbGV0IHJlc3VsdFxuXG4gICAgYXdhaXQgZGIudHJhbnNhY3Rpb24oYXN5bmMgKCkgPT4ge1xuICAgICAgcmVzdWx0ID0gYXdhaXQgY2FsbGJhY2soKVxuICAgICAgY29tcGxldGVkID0gdHJ1ZVxuICAgIH0pXG5cbiAgICBpZiAoIWNvbXBsZXRlZCkgdGhyb3cgbmV3IEVycm9yKFwiTG9jYWwgYmFja2dyb3VuZCBqb2JzIHRyYW5zYWN0aW9uIGNhbGxiYWNrIHdhcyBub3QgaW52b2tlZFwiKVxuICAgIHJldHVybiAvKiogQHR5cGUge1R9ICovIChyZXN1bHQpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBhIGNhbGxiYWNrIHdpdGggdGhlIGNvbmZpZ3VyZWQgbG9jYWwgZGF0YWJhc2UgY29ubmVjdGlvbi5cbiAgICogQHRlbXBsYXRlIFRcbiAgICogQHBhcmFtIHsoZGI6IGltcG9ydChcIi4uL2RhdGFiYXNlL2RyaXZlcnMvYmFzZS5qc1wiKS5kZWZhdWx0KSA9PiBQcm9taXNlPFQ+fSBjYWxsYmFjayAtIENvbm5lY3Rpb24gY2FsbGJhY2suXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPFQ+fSAtIENhbGxiYWNrIHJlc3VsdC5cbiAgICovXG4gIGFzeW5jIF93aXRoRGIoY2FsbGJhY2spIHtcbiAgICBjb25zdCBkYXRhYmFzZUlkZW50aWZpZXIgPSB0aGlzLmdldERhdGFiYXNlSWRlbnRpZmllcigpXG5cbiAgICByZXR1cm4gYXdhaXQgdGhpcy5jb25maWd1cmF0aW9uLmVuc3VyZUNvbm5lY3Rpb25zKHtkYXRhYmFzZUlkZW50aWZpZXJzOiBbZGF0YWJhc2VJZGVudGlmaWVyXSwgbmFtZTogXCJMb2NhbCBiYWNrZ3JvdW5kIGpvYnMgc3RvcmVcIn0sIGFzeW5jIChkYnMpID0+IHtcbiAgICAgIGNvbnN0IGRiID0gZGJzW2RhdGFiYXNlSWRlbnRpZmllcl1cblxuICAgICAgaWYgKCFkYikgdGhyb3cgbmV3IEVycm9yKGBObyBsb2NhbCBiYWNrZ3JvdW5kLWpvYnMgZGF0YWJhc2UgY29ubmVjdGlvbiBhdmFpbGFibGUgZm9yIGlkZW50aWZpZXI6ICR7ZGF0YWJhc2VJZGVudGlmaWVyfWApXG5cbiAgICAgIHJldHVybiBhd2FpdCBjYWxsYmFjayhkYilcbiAgICB9KVxuICB9XG5cbiAgLyoqXG4gICAqIFJlcG9ydHMgYW4gdW5leHBlY3RlZCBsb2NhbC1zdG9yZSBmYWlsdXJlIHRocm91Z2ggZnJhbWV3b3JrIGNoYW5uZWxzLlxuICAgKiBAcGFyYW0ge3tlcnJvcjogRXJyb3IsIHN0YWdlOiBzdHJpbmd9fSBhcmdzIC0gRXJyb3IgcmVwb3J0LlxuICAgKiBAcmV0dXJucyB7dm9pZH0gLSBObyByZXR1cm4gdmFsdWUuXG4gICAqL1xuICBfcmVwb3J0RnJhbWV3b3JrRXJyb3Ioe2Vycm9yLCBzdGFnZX0pIHtcbiAgICBjb25zdCBwYXlsb2FkID0ge2NvbnRleHQ6IHtzdGFnZX0sIGVycm9yfVxuICAgIGNvbnN0IGVycm9yRXZlbnRzID0gdGhpcy5jb25maWd1cmF0aW9uLmdldEVycm9yRXZlbnRzKClcblxuICAgIGVycm9yRXZlbnRzLmVtaXQoXCJmcmFtZXdvcmstZXJyb3JcIiwgcGF5bG9hZClcbiAgICBlcnJvckV2ZW50cy5lbWl0KFwiYWxsLWVycm9yXCIsIHsuLi5wYXlsb2FkLCBlcnJvclR5cGU6IFwiZnJhbWV3b3JrLWVycm9yXCJ9KVxuICB9XG59XG4iXX0=