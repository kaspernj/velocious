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
    "child_pid",
    "runner_hostname"
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
        table.string("runner_hostname", { null: true });
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
     * @param {string} [args.runnerHostname] - Hostname of the machine running the pooled child.
     * @returns {Promise<boolean>} - Whether the lease won.
     */
    async markChildAccepted({ jobId, handoffId, receivedAtMs, startedAtMs, childInstanceId, childPid, runnerHostname }) {
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
            if (typeof runnerHostname === "string")
                data.runner_hostname = runnerHostname;
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
            runnerHostname: row.runner_hostname === null || row.runner_hostname === undefined ? null : String(row.runner_hostname),
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
            // Local (browser/Expo) dispatch is strictly FIFO and has no priority column,
            // so every row reports the default priority.
            priority: 0,
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoibG9jYWwtc3RvcmUuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi9zcmMvYmFja2dyb3VuZC1qb2JzL2xvY2FsLXN0b3JlLmpzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiJBQUFBLFlBQVk7QUFFWixPQUFPLElBQUksTUFBTSxXQUFXLENBQUE7QUFFNUIsT0FBTyxTQUFTLE1BQU0saUNBQWlDLENBQUE7QUFDdkQsT0FBTyxVQUFVLE1BQU0sdUNBQXVDLENBQUE7QUFDOUQsT0FBTyxTQUFTLE1BQU0sd0JBQXdCLENBQUE7QUFDOUMsT0FBTyxjQUFjLE1BQU0sdUJBQXVCLENBQUE7QUFDbEQsT0FBTywyQkFBMkIsTUFBTSxzQkFBc0IsQ0FBQTtBQUM5RCxPQUFPLEVBQ0wsZ0NBQWdDLEVBQ2hDLDRCQUE0QixFQUM1Qiw0QkFBNEIsRUFDNUIsaUNBQWlDLEVBQ2pDLG1DQUFtQyxFQUNuQyxnQ0FBZ0MsRUFDaEMsMkJBQTJCLEVBQzNCLGlDQUFpQyxFQUNqQyxtQ0FBbUMsRUFDbkMsNEJBQTRCLEVBQzVCLDRCQUE0QixFQUM1QixZQUFZLEVBQ2IsTUFBTSxvQkFBb0IsQ0FBQTtBQUUzQixNQUFNLENBQUMsTUFBTSwyQkFBMkIsR0FBRyxpQ0FBaUMsQ0FBQTtBQUM1RSxNQUFNLENBQUMsTUFBTSxzQ0FBc0MsR0FBRyw0Q0FBNEMsQ0FBQTtBQUNsRyxNQUFNLENBQUMsTUFBTSx3Q0FBd0MsR0FBRyw4Q0FBOEMsQ0FBQTtBQUN0RyxNQUFNLGdCQUFnQixHQUFHLCtCQUErQixDQUFBO0FBQ3hELE1BQU0sZUFBZSxHQUFHLHVCQUF1QixDQUFBO0FBQy9DLE1BQU0sa0JBQWtCLEdBQUcsQ0FBQyxHQUFHLEVBQUUsR0FBRyxFQUFFLEdBQUcsQ0FBQyxDQUFBO0FBQzFDLE1BQU0scUJBQXFCLEdBQUcsQ0FBQyxvQkFBb0IsQ0FBQyxDQUFDLFFBQVEsQ0FBQyxDQUFDLENBQUE7QUFDL0QsTUFBTSxDQUFDLE1BQU0saUNBQWlDLEdBQUc7SUFDL0MsMkNB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LCJzb3VyY2VzQ29udGVudCI6WyIvLyBAdHMtY2hlY2tcblxuaW1wb3J0IFVVSUQgZnJvbSBcInB1cmUtdXVpZFwiXG5cbmltcG9ydCBUYWJsZURhdGEgZnJvbSBcIi4uL2RhdGFiYXNlL3RhYmxlLWRhdGEvaW5kZXguanNcIlxuaW1wb3J0IFRhYmxlSW5kZXggZnJvbSBcIi4uL2RhdGFiYXNlL3RhYmxlLWRhdGEvdGFibGUtaW5kZXguanNcIlxuaW1wb3J0IHNoYTI1NkhleCBmcm9tIFwiLi4vdXRpbHMvc2hhMjU2LWhleC5qc1wiXG5pbXBvcnQgVmVsb2Npb3VzRXJyb3IgZnJvbSBcIi4uL3ZlbG9jaW91cy1lcnJvci5qc1wiXG5pbXBvcnQgbm9ybWFsaXplQmFja2dyb3VuZEpvYkVycm9yIGZyb20gXCIuL25vcm1hbGl6ZS1lcnJvci5qc1wiXG5pbXBvcnQge1xuICBCQUNLR1JPVU5EX0pPQl9URVJNSU5BTF9TVEFUVVNFUyxcbiAgREVGQVVMVF9CQUNLR1JPVU5EX0pPQl9RVUVVRSxcbiAgUVVFVUVfQ09OQ1VSUkVOQ1lfS0VZX1BSRUZJWCxcbiAgbm9ybWFsaXplQmFja2dyb3VuZEpvYkNvbmN1cnJlbmN5LFxuICBub3JtYWxpemVCYWNrZ3JvdW5kSm9iRXhlY3V0aW9uTW9kZSxcbiAgbm9ybWFsaXplQmFja2dyb3VuZEpvYk1heFJldHJpZXMsXG4gIG5vcm1hbGl6ZUJhY2tncm91bmRKb2JRdWV1ZSxcbiAgbm9ybWFsaXplQmFja2dyb3VuZEpvYlNjaGVkdWxlS2V5LFxuICBub3JtYWxpemVCYWNrZ3JvdW5kSm9iU2NoZWR1bGVkQXRNcyxcbiAgbm9ybWFsaXplQmFja2dyb3VuZEpvYlN0YXR1cyxcbiAgcmVzY2hlZHVsZWRCYWNrZ3JvdW5kSm9iQXRNcyxcbiAgcmV0cnlEZWxheU1zXG59IGZyb20gXCIuL2pvYi1zZW1hbnRpY3MuanNcIlxuXG5leHBvcnQgY29uc3QgTE9DQUxfQkFDS0dST1VORF9KT0JTX1RBQkxFID0gXCJ2ZWxvY2lvdXNfbG9jYWxfYmFja2dyb3VuZF9qb2JzXCJcbmV4cG9ydCBjb25zdCBMT0NBTF9CQUNLR1JPVU5EX0pPQl9DT05DVVJSRU5DWV9UQUJMRSA9IFwidmVsb2Npb3VzX2xvY2FsX2JhY2tncm91bmRfam9iX2NvbmN1cnJlbmN5XCJcbmV4cG9ydCBjb25zdCBMT0NBTF9CQUNLR1JPVU5EX0pPQl9TQ0hFRFVMRV9LRVlTX1RBQkxFID0gXCJ2ZWxvY2lvdXNfbG9jYWxfYmFja2dyb3VuZF9qb2Jfc2NoZWR1bGVfa2V5c1wiXG5jb25zdCBNSUdSQVRJT05TX1RBQkxFID0gXCJ2ZWxvY2lvdXNfaW50ZXJuYWxfbWlncmF0aW9uc1wiXG5jb25zdCBNSUdSQVRJT05fU0NPUEUgPSBcImxvY2FsX2JhY2tncm91bmRfam9ic1wiXG5jb25zdCBNSUdSQVRJT05fVkVSU0lPTlMgPSBbXCIxXCIsIFwiMlwiLCBcIjNcIl1cbmNvbnN0IExPQ0FMX0VYRUNVVElPTl9NT0RFUyA9IFsvKiogQHR5cGUge2NvbnN0fSAqLyAoXCJpbmxpbmVcIildXG5leHBvcnQgY29uc3QgTE9DQUxfQkFDS0dST1VORF9KT0JTX0lOREVYX05BTUVTID0gW1xuICBcImluZGV4X3ZlbG9jaW91c19sb2NhbF9iYWNrZ3JvdW5kX2pvYnNfZHVlXCIsXG4gIFwiaW5kZXhfdmVsb2Npb3VzX2xvY2FsX2JhY2tncm91bmRfam9ic19xdWV1ZV9zdGF0dXNcIixcbiAgXCJpbmRleF92ZWxvY2lvdXNfbG9jYWxfYmFja2dyb3VuZF9qb2JzX2RlZHVwbGljYXRpb25cIixcbiAgXCJpbmRleF92ZWxvY2lvdXNfbG9jYWxfYmFja2dyb3VuZF9qb2JzX2NvbmN1cnJlbmN5XCIsXG4gIFwiaW5kZXhfdmVsb2Npb3VzX2xvY2FsX2JhY2tncm91bmRfam9ic19zY2hlZHVsZV9oaXN0b3J5XCIsXG4gIFwiaW5kZXhfdmVsb2Npb3VzX2xvY2FsX2JhY2tncm91bmRfam9ic19zY2hlZHVsZV9vcmRlclwiXG5dXG5leHBvcnQgY29uc3QgTE9DQUxfQkFDS0dST1VORF9KT0JfU0NIRURVTEVfS0VZU19JTkRFWF9OQU1FUyA9IFtcImluZGV4X3ZlbG9jaW91c19sb2NhbF9iYWNrZ3JvdW5kX2pvYl9zY2hlZHVsZV9rZXlzX2pvYlwiXVxuY29uc3QgRVhQRUNURURfSk9CX0NPTFVNTlMgPSBbXG4gIFwiaWRcIixcbiAgXCJqb2JfbmFtZVwiLFxuICBcImFyZ3NfanNvblwiLFxuICBcImFyZ3NfZGlnZXN0XCIsXG4gIFwiZXhlY3V0aW9uX21vZGVcIixcbiAgXCJxdWV1ZVwiLFxuICBcInNjaGVkdWxlX2tleVwiLFxuICBcInNjaGVkdWxlX29yZGVyXCIsXG4gIFwibWF4X3JldHJpZXNcIixcbiAgXCJhdHRlbXB0c1wiLFxuICBcInN0YXR1c1wiLFxuICBcInNjaGVkdWxlZF9hdF9tc1wiLFxuICBcImNyZWF0ZWRfYXRfbXNcIixcbiAgXCJoYW5kZWRfb2ZmX2F0X21zXCIsXG4gIFwiaGFuZG9mZl9pZFwiLFxuICBcIndvcmtlcl9pZFwiLFxuICBcImNvbXBsZXRlZF9hdF9tc1wiLFxuICBcImZhaWxlZF9hdF9tc1wiLFxuICBcImxhc3RfZXJyb3JcIixcbiAgXCJjb25jdXJyZW5jeV9rZXlcIixcbiAgXCJtYXhfY29uY3VycmVuY3lcIixcbiAgXCJjaGlsZF9yZWNlaXZlZF9hdF9tc1wiLFxuICBcImNoaWxkX3N0YXJ0ZWRfYXRfbXNcIixcbiAgXCJjaGlsZF9pbnN0YW5jZV9pZFwiLFxuICBcImNoaWxkX3BpZFwiLFxuICBcInJ1bm5lcl9ob3N0bmFtZVwiXG5dXG5jb25zdCBFWFBFQ1RFRF9DT05DVVJSRU5DWV9DT0xVTU5TID0gW1wiY29uY3VycmVuY3lfa2V5XCIsIFwibWF4X2NvbmN1cnJlbmN5XCIsIFwiYWN0aXZlX2NvdW50XCJdXG5jb25zdCBFWFBFQ1RFRF9TQ0hFRFVMRV9LRVlfQ09MVU1OUyA9IFtcInNjaGVkdWxlX2tleVwiLCBcImpvYl9pZFwiXVxuLyoqIEB0eXBlIHtXZWFrTWFwPGltcG9ydChcIi4uL2NvbmZpZ3VyYXRpb24uanNcIikuZGVmYXVsdCwgTWFwPHN0cmluZywgUHJvbWlzZTx2b2lkPj4+fSAqL1xuY29uc3QgZGVkdXBsaWNhdGVkRW5xdWV1ZUNoYWlucyA9IG5ldyBXZWFrTWFwKClcblxuLyoqXG4gKiBDcmVhdGVzIHRoZSBwcm9kdWN0aW9uIGNsb2NrIHVzZWQgYnkgbG9jYWwgZGlzcGF0Y2guXG4gKiBAcmV0dXJucyB7aW1wb3J0KFwiLi90eXBlcy5qc1wiKS5Mb2NhbEJhY2tncm91bmRKb2JzQ2xvY2t9IC0gUHJvZHVjdGlvbiBjbG9jay5cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGxvY2FsQmFja2dyb3VuZEpvYnNDbG9jaygpIHtcbiAgcmV0dXJuIHtcbiAgICBjbGVhclRpbWVvdXQ6ICh0aW1lcklkKSA9PiBnbG9iYWxUaGlzLmNsZWFyVGltZW91dCh0aW1lcklkKSxcbiAgICBub3c6ICgpID0+IERhdGUubm93KCksXG4gICAgc2V0VGltZW91dDogKGNhbGxiYWNrLCBkZWxheU1zKSA9PiBnbG9iYWxUaGlzLnNldFRpbWVvdXQoY2FsbGJhY2ssIGRlbGF5TXMpXG4gIH1cbn1cblxuLyoqIE5hbWVzcGFjZWQgcG9ydGFibGUgU1FMaXRlIHBlcnNpc3RlbmNlIGZvciBsb2NhbCBiYWNrZ3JvdW5kIGpvYnMuICovXG5leHBvcnQgZGVmYXVsdCBjbGFzcyBMb2NhbEJhY2tncm91bmRKb2JzU3RvcmUge1xuICAvKipcbiAgICogQ3JlYXRlcyBhIHN0b3JlIGZvciBvbmUgY29uZmlndXJhdGlvbiBhbmQgbG9jYWwgZGF0YWJhc2UuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gU3RvcmUgb3B0aW9ucy5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9jb25maWd1cmF0aW9uLmpzXCIpLmRlZmF1bHR9IGFyZ3MuY29uZmlndXJhdGlvbiAtIE93bmluZyBjb25maWd1cmF0aW9uLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vdHlwZXMuanNcIikuTG9jYWxCYWNrZ3JvdW5kSm9ic0Nsb2NrfSBbYXJncy5jbG9ja10gLSBQZXJzaXN0ZW5jZSBjbG9jay5cbiAgICogQHBhcmFtIHtzdHJpbmd9IFthcmdzLmRhdGFiYXNlSWRlbnRpZmllcl0gLSBDb25maWd1cmVkIGxvY2FsIGRhdGFiYXNlIGlkZW50aWZpZXIuXG4gICAqIEBwYXJhbSB7KCkgPT4gdm9pZH0gW2FyZ3Mub25Db21taXR0ZWRFbnF1ZXVlXSAtIENvbW1pdC1hd2FyZSBkaXNwYXRjaGVyIHdha2UuXG4gICAqL1xuICBjb25zdHJ1Y3Rvcih7Y29uZmlndXJhdGlvbiwgY2xvY2sgPSBsb2NhbEJhY2tncm91bmRKb2JzQ2xvY2soKSwgZGF0YWJhc2VJZGVudGlmaWVyLCBvbkNvbW1pdHRlZEVucXVldWV9KSB7XG4gICAgdGhpcy5jbG9jayA9IGNsb2NrXG4gICAgdGhpcy5jb25maWd1cmF0aW9uID0gY29uZmlndXJhdGlvblxuICAgIHRoaXMuZGF0YWJhc2VJZGVudGlmaWVyID0gZGF0YWJhc2VJZGVudGlmaWVyXG4gICAgdGhpcy5vbkNvbW1pdHRlZEVucXVldWUgPSBvbkNvbW1pdHRlZEVucXVldWVcbiAgICB0aGlzLl9pc1JlYWR5ID0gZmFsc2VcbiAgICAvKiogQHR5cGUge1Byb21pc2U8dm9pZD4gfCBudWxsfSAqL1xuICAgIHRoaXMuX3JlYWR5UHJvbWlzZSA9IG51bGxcbiAgICAvKiogQHR5cGUge1dlYWtNYXA8aW1wb3J0KFwiLi4vZGF0YWJhc2UvZHJpdmVycy9iYXNlLmpzXCIpLmRlZmF1bHQsIHtjb21wbGV0aW9uOiBQcm9taXNlPHZvaWQ+LCBwcm9taXNlOiBQcm9taXNlPHZvaWQ+fT59ICovXG4gICAgdGhpcy5fdHJhbnNhY3Rpb25SZWFkeVByb21pc2VzID0gbmV3IFdlYWtNYXAoKVxuICB9XG5cbiAgLyoqXG4gICAqIFJlc29sdmVzIHRoZSBjb25maWd1cmVkIGxvY2FsIGRhdGFiYXNlIGlkZW50aWZpZXIuXG4gICAqIEByZXR1cm5zIHtzdHJpbmd9IC0gRGF0YWJhc2UgaWRlbnRpZmllci5cbiAgICovXG4gIGdldERhdGFiYXNlSWRlbnRpZmllcigpIHtcbiAgICByZXR1cm4gdGhpcy5kYXRhYmFzZUlkZW50aWZpZXIgfHwgdGhpcy5jb25maWd1cmF0aW9uLmdldEJhY2tncm91bmRKb2JzQ29uZmlnKCkuZGF0YWJhc2VJZGVudGlmaWVyXG4gIH1cblxuICAvKipcbiAgICogRW5zdXJlcyB0aGUgdmVyc2lvbmVkIHBoeXNpY2FsIHNjaGVtYSBleGlzdHMuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIHdoZW4gcmVhZHkuXG4gICAqL1xuICBhc3luYyBlbnN1cmVSZWFkeSgpIHtcbiAgICBpZiAodGhpcy5faXNSZWFkeSkgcmV0dXJuXG5cbiAgICBhd2FpdCB0aGlzLl93aXRoRGIoYXN5bmMgKGRiKSA9PiBhd2FpdCB0aGlzLl9lbnN1cmVSZWFkeVdpdGhEYihkYikpXG4gIH1cblxuICAvKipcbiAgICogQ2xlYXJzIHRoZSBwZXItaW5zdGFuY2UgcmVhZGluZXNzIGxhdGNoIGZvciBhIGRlbGliZXJhdGUgYWRhcHRlciByZW9wZW4uXG4gICAqIEByZXR1cm5zIHt2b2lkfSAtIE5vIHJldHVybiB2YWx1ZS5cbiAgICovXG4gIHJlc2V0UmVhZGluZXNzKCkge1xuICAgIHRoaXMuX2lzUmVhZHkgPSBmYWxzZVxuICAgIHRoaXMuX3JlYWR5UHJvbWlzZSA9IG51bGxcbiAgICB0aGlzLl90cmFuc2FjdGlvblJlYWR5UHJvbWlzZXMgPSBuZXcgV2Vha01hcCgpXG4gIH1cblxuICAvKipcbiAgICogQ29vcmRpbmF0ZXMgcGh5c2ljYWwgYW5kIHRyYW5zYWN0aW9uLWxvY2FsIHNjaGVtYSByZWFkaW5lc3MuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vZGF0YWJhc2UvZHJpdmVycy9iYXNlLmpzXCIpLmRlZmF1bHR9IGRiIC0gTG9jYWwgU1FMaXRlIGNvbm5lY3Rpb24uXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIHdoZW4gdGhpcyBjYWxsZXIgY2FuIHVzZSB0aGUgc2NoZW1hLlxuICAgKi9cbiAgYXN5bmMgX2Vuc3VyZVJlYWR5V2l0aERiKGRiKSB7XG4gICAgaWYgKHRoaXMuX2lzUmVhZHkpIHJldHVyblxuXG4gICAgY29uc3QgdHJhbnNhY3Rpb25Db21wbGV0aW9uID0gZGIuaW5zaWRlVHJhbnNhY3Rpb24oKSA/IGRiLnRyYW5zYWN0aW9uQ29tcGxldGlvbigpIDogbnVsbFxuICAgIGNvbnN0IHRyYW5zYWN0aW9uUmVhZHkgPSB0aGlzLl90cmFuc2FjdGlvblJlYWR5UHJvbWlzZXMuZ2V0KGRiKVxuXG4gICAgaWYgKHRyYW5zYWN0aW9uQ29tcGxldGlvbiAmJiB0cmFuc2FjdGlvblJlYWR5Py5jb21wbGV0aW9uID09PSB0cmFuc2FjdGlvbkNvbXBsZXRpb24pIHtcbiAgICAgIGF3YWl0IHRyYW5zYWN0aW9uUmVhZHkucHJvbWlzZVxuICAgICAgcmV0dXJuXG4gICAgfVxuXG4gICAgaWYgKHRoaXMuX3JlYWR5UHJvbWlzZSkge1xuICAgICAgY29uc3QgcmVhZHlQcm9taXNlID0gdGhpcy5fcmVhZHlQcm9taXNlXG5cbiAgICAgIGF3YWl0IHJlYWR5UHJvbWlzZVxuICAgICAgaWYgKHRoaXMuX3JlYWR5UHJvbWlzZSA9PT0gcmVhZHlQcm9taXNlKSB0aGlzLl9yZWFkeVByb21pc2UgPSBudWxsXG4gICAgICBpZiAodGhpcy5faXNSZWFkeSkgcmV0dXJuXG5cbiAgICAgIGF3YWl0IHRoaXMuZW5zdXJlUmVhZHkoKVxuICAgICAgcmV0dXJuXG4gICAgfVxuXG4gICAgaWYgKHRyYW5zYWN0aW9uQ29tcGxldGlvbikge1xuICAgICAgY29uc3Qgc2NoZW1hUmVhZHlQcm9taXNlID0gdGhpcy5fYXBwbHlTY2hlbWEoZGIpXG4gICAgICBjb25zdCB0cmFuc2FjdGlvblJlYWR5UHJvbWlzZSA9IHNjaGVtYVJlYWR5UHJvbWlzZS50aGVuKCgpID0+IHVuZGVmaW5lZClcbiAgICAgIGNvbnN0IHRyYW5zYWN0aW9uUmVhZHkgPSB7Y29tcGxldGlvbjogdHJhbnNhY3Rpb25Db21wbGV0aW9uLCBwcm9taXNlOiB0cmFuc2FjdGlvblJlYWR5UHJvbWlzZX1cbiAgICAgIGNvbnN0IGR1cmFibGVSZWFkeVByb21pc2UgPSBzY2hlbWFSZWFkeVByb21pc2UudGhlbihhc3luYyAoY2hhbmdlZCkgPT4ge1xuICAgICAgICBpZiAoIWNoYW5nZWQpIHtcbiAgICAgICAgICB0aGlzLl9pc1JlYWR5ID0gdHJ1ZVxuICAgICAgICAgIHJldHVyblxuICAgICAgICB9XG5cbiAgICAgICAgYXdhaXQgdHJhbnNhY3Rpb25Db21wbGV0aW9uXG4gICAgICB9LCAoKSA9PiB7XG4gICAgICAgIC8vIFRoZSB0cmFuc2FjdGlvbi1sb2NhbCBjYWxsZXIgYmVsb3cgb3ducyBhbmQgcmV0aHJvd3MgdGhpcyBzYW1lIHNjaGVtYSBlcnJvci5cbiAgICAgICAgLy8gVGhpcyBicmFuY2ggb25seSBzZXR0bGVzIHRoZSBzaGFyZWQgZHVyYWJpbGl0eSBiYXJyaWVyIHNvIGl0IGNhbm5vdCBiZWNvbWVcbiAgICAgICAgLy8gYW4gaW5kZXBlbmRlbnQgdW5oYW5kbGVkIHJlamVjdGlvbiB3aGlsZSBmYWlsZWQgb3duZXJzaGlwIGlzIGNsZWFyZWQuXG4gICAgICB9KVxuXG4gICAgICB0aGlzLl90cmFuc2FjdGlvblJlYWR5UHJvbWlzZXMuc2V0KGRiLCB0cmFuc2FjdGlvblJlYWR5KVxuICAgICAgdGhpcy5fcmVhZHlQcm9taXNlID0gZHVyYWJsZVJlYWR5UHJvbWlzZVxuXG4gICAgICB0cnkge1xuICAgICAgICBhd2FpdCB0cmFuc2FjdGlvblJlYWR5UHJvbWlzZVxuICAgICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgICAgaWYgKHRoaXMuX3RyYW5zYWN0aW9uUmVhZHlQcm9taXNlcy5nZXQoZGIpID09PSB0cmFuc2FjdGlvblJlYWR5KSB0aGlzLl90cmFuc2FjdGlvblJlYWR5UHJvbWlzZXMuZGVsZXRlKGRiKVxuICAgICAgICBpZiAodGhpcy5fcmVhZHlQcm9taXNlID09PSBkdXJhYmxlUmVhZHlQcm9taXNlKSB0aGlzLl9yZWFkeVByb21pc2UgPSBudWxsXG4gICAgICAgIHRocm93IGVycm9yXG4gICAgICB9XG4gICAgICByZXR1cm5cbiAgICB9XG5cbiAgICB0aGlzLl9yZWFkeVByb21pc2UgPSB0aGlzLl90cmFuc2FjdGlvblJlc3VsdChkYiwgYXN5bmMgKCkgPT4gYXdhaXQgdGhpcy5fYXBwbHlTY2hlbWEoZGIpKS50aGVuKCgpID0+IHtcbiAgICAgIHRoaXMuX2lzUmVhZHkgPSB0cnVlXG4gICAgfSlcblxuICAgIHRyeSB7XG4gICAgICBhd2FpdCB0aGlzLl9yZWFkeVByb21pc2VcbiAgICB9IGZpbmFsbHkge1xuICAgICAgaWYgKCF0aGlzLl9pc1JlYWR5KSB0aGlzLl9yZWFkeVByb21pc2UgPSBudWxsXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIENyZWF0ZXMgb3IgdXBncmFkZXMgdGhlIHZlcnNpb25lZCBsb2NhbCB0YWJsZXMgYW5kIGluZGV4ZXMgd2l0aG91dFxuICAgKiByZWJ1aWxkaW5nIHBlcnNpc3RlZCBxdWV1ZSBkYXRhLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL2RhdGFiYXNlL2RyaXZlcnMvYmFzZS5qc1wiKS5kZWZhdWx0fSBkYiAtIExvY2FsIFNRTGl0ZSBjb25uZWN0aW9uLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxib29sZWFuPn0gLSBXaGV0aGVyIHNjaGVtYSBzdGF0ZSBjaGFuZ2VkLlxuICAgKi9cbiAgYXN5bmMgX2FwcGx5U2NoZW1hKGRiKSB7XG4gICAgbGV0IGNoYW5nZWQgPSBmYWxzZVxuXG4gICAgaWYgKCEoYXdhaXQgZGIudGFibGVFeGlzdHMoTUlHUkFUSU9OU19UQUJMRSkpKSB7XG4gICAgICBhd2FpdCBkYi5jcmVhdGVUYWJsZSh0aGlzLl9taWdyYXRpb25zVGFibGVEYXRhKCkpXG4gICAgICBjaGFuZ2VkID0gdHJ1ZVxuICAgIH1cblxuICAgIGlmICghKGF3YWl0IGRiLnRhYmxlRXhpc3RzKExPQ0FMX0JBQ0tHUk9VTkRfSk9CU19UQUJMRSkpKSB7XG4gICAgICBhd2FpdCBkYi5jcmVhdGVUYWJsZSh0aGlzLl9qb2JzVGFibGVEYXRhKCkpXG4gICAgICBjaGFuZ2VkID0gdHJ1ZVxuICAgIH0gZWxzZSB7XG4gICAgICBpZiAoYXdhaXQgdGhpcy5fZW5zdXJlSm9iQ29sdW1ucyhkYikpIGNoYW5nZWQgPSB0cnVlXG4gICAgICBhd2FpdCB0aGlzLl9hc3NlcnRDb2x1bW5zKGRiLCBMT0NBTF9CQUNLR1JPVU5EX0pPQlNfVEFCTEUsIEVYUEVDVEVEX0pPQl9DT0xVTU5TKVxuICAgIH1cblxuICAgIGlmICghKGF3YWl0IGRiLnRhYmxlRXhpc3RzKExPQ0FMX0JBQ0tHUk9VTkRfSk9CX0NPTkNVUlJFTkNZX1RBQkxFKSkpIHtcbiAgICAgIGF3YWl0IGRiLmNyZWF0ZVRhYmxlKHRoaXMuX2NvbmN1cnJlbmN5VGFibGVEYXRhKCkpXG4gICAgICBjaGFuZ2VkID0gdHJ1ZVxuICAgIH0gZWxzZSB7XG4gICAgICBhd2FpdCB0aGlzLl9hc3NlcnRDb2x1bW5zKGRiLCBMT0NBTF9CQUNLR1JPVU5EX0pPQl9DT05DVVJSRU5DWV9UQUJMRSwgRVhQRUNURURfQ09OQ1VSUkVOQ1lfQ09MVU1OUylcbiAgICB9XG5cbiAgICBpZiAoIShhd2FpdCBkYi50YWJsZUV4aXN0cyhMT0NBTF9CQUNLR1JPVU5EX0pPQl9TQ0hFRFVMRV9LRVlTX1RBQkxFKSkpIHtcbiAgICAgIGF3YWl0IGRiLmNyZWF0ZVRhYmxlKHRoaXMuX3NjaGVkdWxlS2V5c1RhYmxlRGF0YSgpKVxuICAgICAgY2hhbmdlZCA9IHRydWVcbiAgICB9IGVsc2Uge1xuICAgICAgYXdhaXQgdGhpcy5fYXNzZXJ0Q29sdW1ucyhkYiwgTE9DQUxfQkFDS0dST1VORF9KT0JfU0NIRURVTEVfS0VZU19UQUJMRSwgRVhQRUNURURfU0NIRURVTEVfS0VZX0NPTFVNTlMpXG4gICAgfVxuXG4gICAgaWYgKGF3YWl0IHRoaXMuX2Vuc3VyZUluZGV4ZXMoZGIpKSBjaGFuZ2VkID0gdHJ1ZVxuXG4gICAgZm9yIChjb25zdCB2ZXJzaW9uIG9mIE1JR1JBVElPTl9WRVJTSU9OUykge1xuICAgICAgaWYgKGF3YWl0IHRoaXMuX2hhc01pZ3JhdGlvbihkYiwgdmVyc2lvbikpIGNvbnRpbnVlXG5cbiAgICAgIGF3YWl0IHRoaXMuX3JlY29yZE1pZ3JhdGlvbihkYiwgdmVyc2lvbilcbiAgICAgIGNoYW5nZWQgPSB0cnVlXG4gICAgfVxuXG4gICAgcmV0dXJuIGNoYW5nZWRcbiAgfVxuXG4gIC8qKlxuICAgKiBJZGVtcG90ZW50bHkgYWRkcyBjb2x1bW5zIGZyb20gdGhlIGN1cnJlbnQgam9icyB0YWJsZSBkZWZpbml0aW9uIHRoYXQgYW5cbiAgICogZXhpc3RpbmcgbG9jYWwgdGFibGUgaXMgbWlzc2luZywgc28gYW4gdXBncmFkZWQgZnJhbWV3b3JrIGZpbmRzIGFcbiAgICogY29tcGF0aWJsZSBzY2hlbWEgaW5zdGVhZCBvZiBmYWlsaW5nIHRoZSBjb2x1bW4gYXNzZXJ0aW9uLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL2RhdGFiYXNlL2RyaXZlcnMvYmFzZS5qc1wiKS5kZWZhdWx0fSBkYiAtIExvY2FsIFNRTGl0ZSBjb25uZWN0aW9uLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxib29sZWFuPn0gLSBXaGV0aGVyIGEgY29sdW1uIHdhcyBhZGRlZC5cbiAgICovXG4gIGFzeW5jIF9lbnN1cmVKb2JDb2x1bW5zKGRiKSB7XG4gICAgZGIuY2xlYXJTY2hlbWFDYWNoZSgpXG4gICAgY29uc3QgdGFibGUgPSBhd2FpdCBkYi5nZXRUYWJsZUJ5TmFtZU9yRmFpbChMT0NBTF9CQUNLR1JPVU5EX0pPQlNfVEFCTEUpXG4gICAgY29uc3QgdGFibGVEYXRhID0gbmV3IFRhYmxlRGF0YShMT0NBTF9CQUNLR1JPVU5EX0pPQlNfVEFCTEUpXG4gICAgbGV0IGFkZGVkID0gZmFsc2VcblxuICAgIGZvciAoY29uc3QgY29sdW1uIG9mIHRoaXMuX2pvYnNUYWJsZURhdGEoKS5nZXRDb2x1bW5zKCkpIHtcbiAgICAgIGlmIChhd2FpdCB0YWJsZS5nZXRDb2x1bW5CeU5hbWUoY29sdW1uLmdldE5hbWUoKSkpIGNvbnRpbnVlXG4gICAgICBpZiAoY29sdW1uLmdldFByaW1hcnlLZXkoKSkgY29udGludWVcblxuICAgICAgY29uc3QgY29sdW1uQXJncyA9IC8qKiBAdHlwZSB7e251bGw6IGJvb2xlYW4sIG1heExlbmd0aD86IG51bWJlcn19ICovICh7bnVsbDogY29sdW1uLmdldE51bGwoKSAhPT0gZmFsc2V9KVxuICAgICAgY29uc3QgbWF4TGVuZ3RoID0gY29sdW1uLmdldE1heExlbmd0aCgpXG5cbiAgICAgIGlmICh0eXBlb2YgbWF4TGVuZ3RoID09PSBcIm51bWJlclwiKSBjb2x1bW5BcmdzLm1heExlbmd0aCA9IG1heExlbmd0aFxuXG4gICAgICBjb25zdCB0eXBlID0gY29sdW1uLmdldFR5cGUoKVxuICAgICAgaWYgKHR5cGUgPT09IFwic3RyaW5nXCIpIHRhYmxlRGF0YS5zdHJpbmcoY29sdW1uLmdldE5hbWUoKSwgY29sdW1uQXJncylcbiAgICAgIGVsc2UgaWYgKHR5cGUgPT09IFwidGV4dFwiKSB0YWJsZURhdGEudGV4dChjb2x1bW4uZ2V0TmFtZSgpLCBjb2x1bW5BcmdzKVxuICAgICAgZWxzZSBpZiAodHlwZSA9PT0gXCJiaWdpbnRcIikgdGFibGVEYXRhLmJpZ2ludChjb2x1bW4uZ2V0TmFtZSgpLCBjb2x1bW5BcmdzKVxuICAgICAgZWxzZSBpZiAodHlwZSA9PT0gXCJpbnRlZ2VyXCIpIHRhYmxlRGF0YS5pbnRlZ2VyKGNvbHVtbi5nZXROYW1lKCksIGNvbHVtbkFyZ3MpXG4gICAgICBlbHNlIGlmICh0eXBlID09PSBcImJvb2xlYW5cIikgdGFibGVEYXRhLmJvb2xlYW4oY29sdW1uLmdldE5hbWUoKSwgY29sdW1uQXJncylcbiAgICAgIGVsc2UgY29udGludWVcbiAgICAgIGFkZGVkID0gdHJ1ZVxuICAgIH1cblxuICAgIGlmICghYWRkZWQpIHJldHVybiBmYWxzZVxuXG4gICAgZm9yIChjb25zdCBzcWwgb2YgYXdhaXQgZGIuYWx0ZXJUYWJsZVNRTHModGFibGVEYXRhKSkgYXdhaXQgZGIucXVlcnkoc3FsKVxuICAgIGRiLmNsZWFyU2NoZW1hQ2FjaGUoKVxuICAgIHJldHVybiB0cnVlXG4gIH1cblxuICAvKipcbiAgICogQnVpbGRzIHRoZSBtaWdyYXRpb24gbGVkZ2VyIHRhYmxlIGRlZmluaXRpb24uXG4gICAqIEByZXR1cm5zIHtUYWJsZURhdGF9IC0gTWlncmF0aW9uIGxlZGdlciB0YWJsZS5cbiAgICovXG4gIF9taWdyYXRpb25zVGFibGVEYXRhKCkge1xuICAgIGNvbnN0IHRhYmxlID0gbmV3IFRhYmxlRGF0YShNSUdSQVRJT05TX1RBQkxFLCB7aWZOb3RFeGlzdHM6IHRydWV9KVxuXG4gICAgdGFibGUuc3RyaW5nKFwia2V5XCIsIHtudWxsOiBmYWxzZSwgcHJpbWFyeUtleTogdHJ1ZX0pXG4gICAgdGFibGUuc3RyaW5nKFwic2NvcGVcIiwge251bGw6IGZhbHNlfSlcbiAgICB0YWJsZS5zdHJpbmcoXCJ2ZXJzaW9uXCIsIHtudWxsOiBmYWxzZX0pXG4gICAgdGFibGUuYmlnaW50KFwiYXBwbGllZF9hdF9tc1wiLCB7bnVsbDogZmFsc2V9KVxuICAgIHJldHVybiB0YWJsZVxuICB9XG5cbiAgLyoqXG4gICAqIEJ1aWxkcyB0aGUgbG9jYWwgam9icyB0YWJsZSBkZWZpbml0aW9uLlxuICAgKiBAcmV0dXJucyB7VGFibGVEYXRhfSAtIExvY2FsIGpvYnMgdGFibGUgZGVmaW5pdGlvbi5cbiAgICovXG4gIF9qb2JzVGFibGVEYXRhKCkge1xuICAgIGNvbnN0IHRhYmxlID0gbmV3IFRhYmxlRGF0YShMT0NBTF9CQUNLR1JPVU5EX0pPQlNfVEFCTEUsIHtpZk5vdEV4aXN0czogdHJ1ZX0pXG5cbiAgICB0YWJsZS5zdHJpbmcoXCJpZFwiLCB7bnVsbDogZmFsc2UsIHByaW1hcnlLZXk6IHRydWV9KVxuICAgIHRhYmxlLnN0cmluZyhcImpvYl9uYW1lXCIsIHtudWxsOiBmYWxzZX0pXG4gICAgdGFibGUudGV4dChcImFyZ3NfanNvblwiLCB7bnVsbDogZmFsc2V9KVxuICAgIHRhYmxlLnN0cmluZyhcImFyZ3NfZGlnZXN0XCIsIHttYXhMZW5ndGg6IDY0LCBudWxsOiBmYWxzZX0pXG4gICAgdGFibGUuc3RyaW5nKFwiZXhlY3V0aW9uX21vZGVcIiwge251bGw6IGZhbHNlfSlcbiAgICB0YWJsZS5zdHJpbmcoXCJxdWV1ZVwiLCB7bnVsbDogZmFsc2V9KVxuICAgIHRhYmxlLnN0cmluZyhcInNjaGVkdWxlX2tleVwiLCB7bnVsbDogdHJ1ZX0pXG4gICAgdGFibGUuYmlnaW50KFwic2NoZWR1bGVfb3JkZXJcIiwge251bGw6IHRydWV9KVxuICAgIHRhYmxlLmludGVnZXIoXCJtYXhfcmV0cmllc1wiLCB7bnVsbDogZmFsc2V9KVxuICAgIHRhYmxlLmludGVnZXIoXCJhdHRlbXB0c1wiLCB7bnVsbDogZmFsc2V9KVxuICAgIHRhYmxlLnN0cmluZyhcInN0YXR1c1wiLCB7bnVsbDogZmFsc2V9KVxuICAgIHRhYmxlLmJpZ2ludChcInNjaGVkdWxlZF9hdF9tc1wiLCB7bnVsbDogZmFsc2V9KVxuICAgIHRhYmxlLmJpZ2ludChcImNyZWF0ZWRfYXRfbXNcIiwge251bGw6IGZhbHNlfSlcbiAgICB0YWJsZS5iaWdpbnQoXCJoYW5kZWRfb2ZmX2F0X21zXCIsIHtudWxsOiB0cnVlfSlcbiAgICB0YWJsZS5zdHJpbmcoXCJoYW5kb2ZmX2lkXCIsIHtudWxsOiB0cnVlfSlcbiAgICB0YWJsZS5zdHJpbmcoXCJ3b3JrZXJfaWRcIiwge251bGw6IHRydWV9KVxuICAgIHRhYmxlLmJpZ2ludChcImNvbXBsZXRlZF9hdF9tc1wiLCB7bnVsbDogdHJ1ZX0pXG4gICAgdGFibGUuYmlnaW50KFwiZmFpbGVkX2F0X21zXCIsIHtudWxsOiB0cnVlfSlcbiAgICB0YWJsZS50ZXh0KFwibGFzdF9lcnJvclwiLCB7bnVsbDogdHJ1ZX0pXG4gICAgdGFibGUuc3RyaW5nKFwiY29uY3VycmVuY3lfa2V5XCIsIHtudWxsOiB0cnVlfSlcbiAgICB0YWJsZS5pbnRlZ2VyKFwibWF4X2NvbmN1cnJlbmN5XCIsIHtudWxsOiB0cnVlfSlcbiAgICB0YWJsZS5iaWdpbnQoXCJjaGlsZF9yZWNlaXZlZF9hdF9tc1wiLCB7bnVsbDogdHJ1ZX0pXG4gICAgdGFibGUuYmlnaW50KFwiY2hpbGRfc3RhcnRlZF9hdF9tc1wiLCB7bnVsbDogdHJ1ZX0pXG4gICAgdGFibGUuc3RyaW5nKFwiY2hpbGRfaW5zdGFuY2VfaWRcIiwge251bGw6IHRydWV9KVxuICAgIHRhYmxlLmludGVnZXIoXCJjaGlsZF9waWRcIiwge251bGw6IHRydWV9KVxuICAgIHRhYmxlLnN0cmluZyhcInJ1bm5lcl9ob3N0bmFtZVwiLCB7bnVsbDogdHJ1ZX0pXG4gICAgdGFibGUuYWRkSW5kZXgobmV3IFRhYmxlSW5kZXgoW1wic3RhdHVzXCIsIFwic2NoZWR1bGVkX2F0X21zXCIsIFwiY3JlYXRlZF9hdF9tc1wiLCBcImlkXCJdLCB7bmFtZTogTE9DQUxfQkFDS0dST1VORF9KT0JTX0lOREVYX05BTUVTWzBdfSkpXG4gICAgdGFibGUuYWRkSW5kZXgobmV3IFRhYmxlSW5kZXgoW1wicXVldWVcIiwgXCJzdGF0dXNcIiwgXCJjcmVhdGVkX2F0X21zXCJdLCB7bmFtZTogTE9DQUxfQkFDS0dST1VORF9KT0JTX0lOREVYX05BTUVTWzFdfSkpXG4gICAgdGFibGUuYWRkSW5kZXgobmV3IFRhYmxlSW5kZXgoW1wiYXJnc19kaWdlc3RcIl0sIHtuYW1lOiBMT0NBTF9CQUNLR1JPVU5EX0pPQlNfSU5ERVhfTkFNRVNbMl19KSlcbiAgICB0YWJsZS5hZGRJbmRleChuZXcgVGFibGVJbmRleChbXCJzdGF0dXNcIiwgXCJjb25jdXJyZW5jeV9rZXlcIiwgXCJzY2hlZHVsZWRfYXRfbXNcIl0sIHtuYW1lOiBMT0NBTF9CQUNLR1JPVU5EX0pPQlNfSU5ERVhfTkFNRVNbM119KSlcbiAgICB0YWJsZS5hZGRJbmRleChuZXcgVGFibGVJbmRleChbXCJzY2hlZHVsZV9rZXlcIiwgXCJjcmVhdGVkX2F0X21zXCIsIFwiaWRcIl0sIHtuYW1lOiBMT0NBTF9CQUNLR1JPVU5EX0pPQlNfSU5ERVhfTkFNRVNbNF19KSlcbiAgICB0YWJsZS5hZGRJbmRleChuZXcgVGFibGVJbmRleChbXCJzY2hlZHVsZV9rZXlcIiwgXCJzY2hlZHVsZV9vcmRlclwiLCBcImNyZWF0ZWRfYXRfbXNcIiwgXCJpZFwiXSwge25hbWU6IExPQ0FMX0JBQ0tHUk9VTkRfSk9CU19JTkRFWF9OQU1FU1s1XX0pKVxuICAgIHJldHVybiB0YWJsZVxuICB9XG5cbiAgLyoqXG4gICAqIEJ1aWxkcyB0aGUgbG9jYWwgY29uY3VycmVuY3kgY291bnRlciB0YWJsZSBkZWZpbml0aW9uLlxuICAgKiBAcmV0dXJucyB7VGFibGVEYXRhfSAtIENvbmN1cnJlbmN5IGNvdW50ZXIgdGFibGUgZGVmaW5pdGlvbi5cbiAgICovXG4gIF9jb25jdXJyZW5jeVRhYmxlRGF0YSgpIHtcbiAgICBjb25zdCB0YWJsZSA9IG5ldyBUYWJsZURhdGEoTE9DQUxfQkFDS0dST1VORF9KT0JfQ09OQ1VSUkVOQ1lfVEFCTEUsIHtpZk5vdEV4aXN0czogdHJ1ZX0pXG5cbiAgICB0YWJsZS5zdHJpbmcoXCJjb25jdXJyZW5jeV9rZXlcIiwge251bGw6IGZhbHNlLCBwcmltYXJ5S2V5OiB0cnVlfSlcbiAgICB0YWJsZS5pbnRlZ2VyKFwibWF4X2NvbmN1cnJlbmN5XCIsIHtudWxsOiBmYWxzZX0pXG4gICAgdGFibGUuaW50ZWdlcihcImFjdGl2ZV9jb3VudFwiLCB7bnVsbDogZmFsc2V9KVxuICAgIHJldHVybiB0YWJsZVxuICB9XG5cbiAgLyoqXG4gICAqIEJ1aWxkcyB0aGUgc3RhYmxlIHNjaGVkdWxlLW93bmVyIHRhYmxlIGRlZmluaXRpb24uXG4gICAqIEByZXR1cm5zIHtUYWJsZURhdGF9IC0gU3RhYmxlIG93bmVyIHRhYmxlIGRlZmluaXRpb24uXG4gICAqL1xuICBfc2NoZWR1bGVLZXlzVGFibGVEYXRhKCkge1xuICAgIGNvbnN0IHRhYmxlID0gbmV3IFRhYmxlRGF0YShMT0NBTF9CQUNLR1JPVU5EX0pPQl9TQ0hFRFVMRV9LRVlTX1RBQkxFLCB7aWZOb3RFeGlzdHM6IHRydWV9KVxuXG4gICAgdGFibGUuc3RyaW5nKFwic2NoZWR1bGVfa2V5XCIsIHtudWxsOiBmYWxzZSwgcHJpbWFyeUtleTogdHJ1ZX0pXG4gICAgdGFibGUuc3RyaW5nKFwiam9iX2lkXCIsIHtudWxsOiBmYWxzZX0pXG4gICAgdGFibGUuYWRkSW5kZXgobmV3IFRhYmxlSW5kZXgoW1wiam9iX2lkXCJdLCB7bmFtZTogTE9DQUxfQkFDS0dST1VORF9KT0JfU0NIRURVTEVfS0VZU19JTkRFWF9OQU1FU1swXX0pKVxuICAgIHJldHVybiB0YWJsZVxuICB9XG5cbiAgLyoqXG4gICAqIFJlamVjdHMgYW4gaW5jb21wYXRpYmxlIGN1cnJlbnQtdmVyc2lvbiB0YWJsZSByYXRoZXIgdGhhbiByZWJ1aWxkaW5nIGRhdGEuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vZGF0YWJhc2UvZHJpdmVycy9iYXNlLmpzXCIpLmRlZmF1bHR9IGRiIC0gTG9jYWwgU1FMaXRlIGNvbm5lY3Rpb24uXG4gICAqIEBwYXJhbSB7c3RyaW5nfSB0YWJsZU5hbWUgLSBUYWJsZSBuYW1lLlxuICAgKiBAcGFyYW0ge3N0cmluZ1tdfSBleHBlY3RlZENvbHVtbnMgLSBSZXF1aXJlZCBjb2x1bW5zLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyB3aGVuIGNvbXBhdGlibGUuXG4gICAqL1xuICBhc3luYyBfYXNzZXJ0Q29sdW1ucyhkYiwgdGFibGVOYW1lLCBleHBlY3RlZENvbHVtbnMpIHtcbiAgICBjb25zdCB0YWJsZSA9IGF3YWl0IGRiLmdldFRhYmxlQnlOYW1lT3JGYWlsKHRhYmxlTmFtZSlcbiAgICBjb25zdCBjb2x1bW5zID0gYXdhaXQgdGFibGUuZ2V0Q29sdW1ucygpXG4gICAgY29uc3QgbmFtZXMgPSBuZXcgU2V0KGNvbHVtbnMubWFwKChjb2x1bW4pID0+IGNvbHVtbi5nZXROYW1lKCkpKVxuICAgIGNvbnN0IG1pc3NpbmcgPSBleHBlY3RlZENvbHVtbnMuZmlsdGVyKChjb2x1bW5OYW1lKSA9PiAhbmFtZXMuaGFzKGNvbHVtbk5hbWUpKVxuXG4gICAgaWYgKG1pc3NpbmcubGVuZ3RoID09PSAwKSByZXR1cm5cblxuICAgIGNvbnN0IGVycm9yID0gbmV3IEVycm9yKGBJbmNvbXBhdGlibGUgbG9jYWwgYmFja2dyb3VuZC1qb2JzIHNjaGVtYSBmb3IgJHt0YWJsZU5hbWV9OyBtaXNzaW5nIGNvbHVtbnM6ICR7bWlzc2luZy5qb2luKFwiLCBcIil9YClcblxuICAgIHRoaXMuX3JlcG9ydEZyYW1ld29ya0Vycm9yKHtlcnJvciwgc3RhZ2U6IFwibG9jYWwtYmFja2dyb3VuZC1qb2JzLXNjaGVtYVwifSlcbiAgICB0aHJvdyBlcnJvclxuICB9XG5cbiAgLyoqXG4gICAqIFJlY3JlYXRlcyBtaXNzaW5nIGluZGV4ZXMgZGVjbGFyZWQgYnkgdGhlIGN1cnJlbnQgc2NoZW1hLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL2RhdGFiYXNlL2RyaXZlcnMvYmFzZS5qc1wiKS5kZWZhdWx0fSBkYiAtIExvY2FsIFNRTGl0ZSBjb25uZWN0aW9uLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxib29sZWFuPn0gLSBXaGV0aGVyIGFuIGluZGV4IHdhcyBjcmVhdGVkLlxuICAgKi9cbiAgYXN5bmMgX2Vuc3VyZUluZGV4ZXMoZGIpIHtcbiAgICBkYi5jbGVhclNjaGVtYUNhY2hlKClcbiAgICBsZXQgY2hhbmdlZCA9IGZhbHNlXG4gICAgLyoqIEB0eXBlIHtBcnJheTxbc3RyaW5nLCBUYWJsZURhdGFdPn0gKi9cbiAgICBjb25zdCBkZWZpbml0aW9ucyA9IFtcbiAgICAgIFtMT0NBTF9CQUNLR1JPVU5EX0pPQlNfVEFCTEUsIHRoaXMuX2pvYnNUYWJsZURhdGEoKV0sXG4gICAgICBbTE9DQUxfQkFDS0dST1VORF9KT0JfU0NIRURVTEVfS0VZU19UQUJMRSwgdGhpcy5fc2NoZWR1bGVLZXlzVGFibGVEYXRhKCldXG4gICAgXVxuXG4gICAgZm9yIChjb25zdCBbdGFibGVOYW1lLCB0YWJsZURhdGFdIG9mIGRlZmluaXRpb25zKSB7XG4gICAgICBjb25zdCB0YWJsZSA9IGF3YWl0IGRiLmdldFRhYmxlQnlOYW1lT3JGYWlsKHRhYmxlTmFtZSlcbiAgICAgIGNvbnN0IGV4aXN0aW5nTmFtZXMgPSBuZXcgU2V0KChhd2FpdCB0YWJsZS5nZXRJbmRleGVzKCkpLm1hcCgoaW5kZXgpID0+IGluZGV4LmdldE5hbWUoKSkpXG5cbiAgICAgIGZvciAoY29uc3QgaW5kZXggb2YgdGFibGVEYXRhLmdldEluZGV4ZXMoKSkge1xuICAgICAgICBjb25zdCBpbmRleE5hbWUgPSBpbmRleC5nZXROYW1lKClcblxuICAgICAgICBpZiAoIWluZGV4TmFtZSB8fCBleGlzdGluZ05hbWVzLmhhcyhpbmRleE5hbWUpKSBjb250aW51ZVxuXG4gICAgICAgIGNvbnN0IHNxbHMgPSBhd2FpdCBkYi5jcmVhdGVJbmRleFNRTHMoe1xuICAgICAgICAgIGNvbHVtbnM6IGluZGV4LmdldENvbHVtbnMoKSxcbiAgICAgICAgICBpZk5vdEV4aXN0czogdHJ1ZSxcbiAgICAgICAgICBuYW1lOiBpbmRleE5hbWUsXG4gICAgICAgICAgdGFibGVOYW1lLFxuICAgICAgICAgIHVuaXF1ZTogaW5kZXguZ2V0VW5pcXVlKClcbiAgICAgICAgfSlcblxuICAgICAgICBmb3IgKGNvbnN0IHNxbCBvZiBzcWxzKSBhd2FpdCBkYi5xdWVyeShzcWwpXG4gICAgICAgIGNoYW5nZWQgPSB0cnVlXG4gICAgICB9XG4gICAgfVxuXG4gICAgaWYgKGNoYW5nZWQpIGRiLmNsZWFyU2NoZW1hQ2FjaGUoKVxuICAgIHJldHVybiBjaGFuZ2VkXG4gIH1cblxuICAvKipcbiAgICogQ2hlY2tzIHdoZXRoZXIgdGhlIGN1cnJlbnQgbG9jYWwgc2NoZW1hIHZlcnNpb24gaXMgcmVjb3JkZWQuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vZGF0YWJhc2UvZHJpdmVycy9iYXNlLmpzXCIpLmRlZmF1bHR9IGRiIC0gQ29ubmVjdGlvbi5cbiAgICogQHBhcmFtIHtzdHJpbmd9IHZlcnNpb24gLSBMb2NhbCBzY2hlbWEgdmVyc2lvbi5cbiAgICogQHJldHVybnMge1Byb21pc2U8Ym9vbGVhbj59IC0gV2hldGhlciB0aGUgdmVyc2lvbiBpcyByZWNvcmRlZC5cbiAgICovXG4gIGFzeW5jIF9oYXNNaWdyYXRpb24oZGIsIHZlcnNpb24pIHtcbiAgICBjb25zdCByb3dzID0gYXdhaXQgZGJcbiAgICAgIC5uZXdRdWVyeSgpXG4gICAgICAuZnJvbShNSUdSQVRJT05TX1RBQkxFKVxuICAgICAgLndoZXJlKHtrZXk6IHRoaXMuX21pZ3JhdGlvbktleSh2ZXJzaW9uKX0pXG4gICAgICAubGltaXQoMSlcbiAgICAgIC5yZXN1bHRzKClcblxuICAgIHJldHVybiByb3dzLmxlbmd0aCA+IDBcbiAgfVxuXG4gIC8qKlxuICAgKiBSZWNvcmRzIG9uZSBsb2NhbCBzY2hlbWEgdmVyc2lvbiBhZnRlciBpdHMgYWRkaXRpdmUgY2hhbmdlcyBhcmUgcHJlc2VudC5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9kYXRhYmFzZS9kcml2ZXJzL2Jhc2UuanNcIikuZGVmYXVsdH0gZGIgLSBDb25uZWN0aW9uLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gdmVyc2lvbiAtIExvY2FsIHNjaGVtYSB2ZXJzaW9uLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyBhZnRlciByZWNvcmRpbmcuXG4gICAqL1xuICBhc3luYyBfcmVjb3JkTWlncmF0aW9uKGRiLCB2ZXJzaW9uKSB7XG4gICAgYXdhaXQgZGIudXBzZXJ0KHtcbiAgICAgIHRhYmxlTmFtZTogTUlHUkFUSU9OU19UQUJMRSxcbiAgICAgIGRhdGE6IHtcbiAgICAgICAgYXBwbGllZF9hdF9tczogdGhpcy5jbG9jay5ub3coKSxcbiAgICAgICAga2V5OiB0aGlzLl9taWdyYXRpb25LZXkodmVyc2lvbiksXG4gICAgICAgIHNjb3BlOiBNSUdSQVRJT05fU0NPUEUsXG4gICAgICAgIHZlcnNpb25cbiAgICAgIH0sXG4gICAgICBjb25mbGljdENvbHVtbnM6IFtcImtleVwiXSxcbiAgICAgIHVwZGF0ZUNvbHVtbnM6IFtcInNjb3BlXCIsIFwidmVyc2lvblwiLCBcImFwcGxpZWRfYXRfbXNcIl1cbiAgICB9KVxuICB9XG5cbiAgLyoqXG4gICAqIEJ1aWxkcyB0aGUgc2NvcGVkIG1pZ3JhdGlvbiBrZXkuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSB2ZXJzaW9uIC0gTG9jYWwgc2NoZW1hIHZlcnNpb24uXG4gICAqIEByZXR1cm5zIHtzdHJpbmd9IC0gU2NvcGVkIG1pZ3JhdGlvbiBrZXkuXG4gICAqL1xuICBfbWlncmF0aW9uS2V5KHZlcnNpb24pIHsgcmV0dXJuIGAke01JR1JBVElPTl9TQ09QRX06JHt2ZXJzaW9ufWAgfVxuXG4gIC8qKlxuICAgKiBFbnF1ZXVlcyBhIGxvY2FsIGpvYiBpbiB0aGUgY2FsbGVyJ3MgYWN0aXZlIHRyYW5zYWN0aW9uIHdoZW4gcHJlc2VudC5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBFbnF1ZXVlIHJlcXVlc3QuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBhcmdzLmpvYk5hbWUgLSBSZWdpc3RlcmVkIGpvYiBuYW1lLlxuICAgKiBAcGFyYW0ge0FycmF5PFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gYXJncy5hcmdzIC0gU2VyaWFsaXplZCBqb2IgYXJndW1lbnRzLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vdHlwZXMuanNcIikuQmFja2dyb3VuZEpvYk9wdGlvbnN9IFthcmdzLm9wdGlvbnNdIC0gSm9iIG9wdGlvbnMuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHN0cmluZz59IC0gRHVyYWJsZSBqb2IgaWQuXG4gICAqL1xuICBhc3luYyBlbnF1ZXVlKHtqb2JOYW1lLCBhcmdzLCBvcHRpb25zID0ge319KSB7XG4gICAgYXdhaXQgdGhpcy5lbnN1cmVSZWFkeSgpXG5cbiAgICBjb25zdCBwcmVwYXJlZEpvYiA9IHRoaXMuX3ByZXBhcmVKb2Ioe2FyZ3MsIGpvYk5hbWUsIG9wdGlvbnN9KVxuICAgIGNvbnN0IG11dGF0ZSA9IGFzeW5jIChob2xkVW50aWwgPSAoLyoqIEB0eXBlIHtQcm9taXNlPHZvaWQ+fSAqLyBfY29tcGxldGlvbikgPT4ge30pID0+IGF3YWl0IHRoaXMuX3dpdGhEYihhc3luYyAoY29ubmVjdGlvbikgPT4ge1xuICAgICAgaWYgKGNvbm5lY3Rpb24uaW5zaWRlVHJhbnNhY3Rpb24oKSkgaG9sZFVudGlsKGNvbm5lY3Rpb24udHJhbnNhY3Rpb25Db21wbGV0aW9uKCkpXG5cbiAgICAgIHJldHVybiBhd2FpdCB0aGlzLl9tdXRhdGUoY29ubmVjdGlvbiwgYXN5bmMgKGRiKSA9PiB7XG4gICAgICAgIGxldCBqb2JJZCA9IHByZXBhcmVkSm9iLmpvYklkXG5cbiAgICAgICAgaWYgKHByZXBhcmVkSm9iLmNvbmN1cnJlbmN5KSBhd2FpdCB0aGlzLl9lbnN1cmVDb25jdXJyZW5jeShkYiwgcHJlcGFyZWRKb2IuY29uY3VycmVuY3kpXG5cbiAgICAgICAgaWYgKG9wdGlvbnMuZGVkdXBsaWNhdGVXaGlsZVF1ZXVlZCkge1xuICAgICAgICAgIGNvbnN0IGV4aXN0aW5nID0gYXdhaXQgZGJcbiAgICAgICAgICAgIC5uZXdRdWVyeSgpXG4gICAgICAgICAgICAuZnJvbShMT0NBTF9CQUNLR1JPVU5EX0pPQlNfVEFCTEUpXG4gICAgICAgICAgICAuc2VsZWN0KFwiaWRcIilcbiAgICAgICAgICAgIC53aGVyZSh7XG4gICAgICAgICAgICAgIGFyZ3NfZGlnZXN0OiBwcmVwYXJlZEpvYi5hcmdzRGlnZXN0LFxuICAgICAgICAgICAgICBhcmdzX2pzb246IHByZXBhcmVkSm9iLmFyZ3NKc29uLFxuICAgICAgICAgICAgICBqb2JfbmFtZTogcHJlcGFyZWRKb2Iuam9iTmFtZSxcbiAgICAgICAgICAgICAgcXVldWU6IHByZXBhcmVkSm9iLnF1ZXVlLFxuICAgICAgICAgICAgICBzdGF0dXM6IFwicXVldWVkXCJcbiAgICAgICAgICAgIH0pXG4gICAgICAgICAgICAud2hlcmUoYHNjaGVkdWxlZF9hdF9tcyA8PSAke2RiLnF1b3RlKHByZXBhcmVkSm9iLnNjaGVkdWxlZEF0TXMpfWApXG4gICAgICAgICAgICAub3JkZXIoXCJzY2hlZHVsZWRfYXRfbXMgQVNDXCIpXG4gICAgICAgICAgICAub3JkZXIoXCJjcmVhdGVkX2F0X21zIEFTQ1wiKVxuICAgICAgICAgICAgLmxpbWl0KDEpXG4gICAgICAgICAgICAucmVzdWx0cygpXG5cbiAgICAgICAgICBjb25zdCBleGlzdGluZ1JvdyA9IC8qKiBAdHlwZSB7e2lkOiBzdHJpbmcgfCBudW1iZXJ9IHwgdW5kZWZpbmVkfSAqLyAoZXhpc3RpbmdbMF0pXG5cbiAgICAgICAgICBpZiAoZXhpc3RpbmdSb3cpIGpvYklkID0gU3RyaW5nKGV4aXN0aW5nUm93LmlkKVxuICAgICAgICB9XG5cbiAgICAgICAgaWYgKGpvYklkID09PSBwcmVwYXJlZEpvYi5qb2JJZCkgYXdhaXQgdGhpcy5faW5zZXJ0UHJlcGFyZWRKb2IoZGIsIHByZXBhcmVkSm9iKVxuICAgICAgICBpZiAodGhpcy5vbkNvbW1pdHRlZEVucXVldWUpIGF3YWl0IGRiLmFmdGVyQ29tbWl0KHRoaXMub25Db21taXR0ZWRFbnF1ZXVlKVxuXG4gICAgICAgIHJldHVybiBqb2JJZFxuICAgICAgfSlcbiAgICB9KVxuXG4gICAgaWYgKG9wdGlvbnMuZGVkdXBsaWNhdGVXaGlsZVF1ZXVlZCkgcmV0dXJuIGF3YWl0IHRoaXMuX3NlcmlhbGl6ZURlZHVwbGljYXRlZEVucXVldWUocHJlcGFyZWRKb2IsIG11dGF0ZSlcbiAgICByZXR1cm4gYXdhaXQgbXV0YXRlKClcbiAgfVxuXG4gIC8qKlxuICAgKiBSZXBsYWNlcyB0aGUgcXVldWVkIG93bmVyIG9mIGEgc3RhYmxlIHNjaGVkdWxlIGtleSB3aXRoIGEgbmV3IGxvY2FsIGpvYi5cbiAgICogQSBoYW5kZWQtb2ZmIG93bmVyIHJlbWFpbnMgcnVubmFibGUgYnV0IGlzIGRldGFjaGVkIGZyb20gZnV0dXJlIG93bmVyc2hpcC5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBSZXBsYWNlbWVudCByZXF1ZXN0LlxuICAgKiBAcGFyYW0ge3N0cmluZ30gYXJncy5zY2hlZHVsZUtleSAtIFN0YWJsZSBsb2dpY2FsIHNjaGVkdWxlIGtleS5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGFyZ3Muam9iTmFtZSAtIFJlZ2lzdGVyZWQgam9iIG5hbWUuXG4gICAqIEBwYXJhbSB7QXJyYXk8UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSBhcmdzLmFyZ3MgLSBTZXJpYWxpemVkIGpvYiBhcmd1bWVudHMuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi90eXBlcy5qc1wiKS5CYWNrZ3JvdW5kSm9iT3B0aW9uc30gW2FyZ3Mub3B0aW9uc10gLSBKb2Igb3B0aW9ucy5cbiAgICogQHJldHVybnMge1Byb21pc2U8aW1wb3J0KFwiLi90eXBlcy5qc1wiKS5CYWNrZ3JvdW5kSm9iUmVwbGFjZW1lbnRSZXN1bHQ+fSAtIFJlcGxhY2VtZW50IHJlc3VsdC5cbiAgICovXG4gIGFzeW5jIHJlcGxhY2VTY2hlZHVsZWQoe3NjaGVkdWxlS2V5LCBqb2JOYW1lLCBhcmdzLCBvcHRpb25zID0ge319KSB7XG4gICAgYXdhaXQgdGhpcy5lbnN1cmVSZWFkeSgpXG5cbiAgICBjb25zdCBub3JtYWxpemVkU2NoZWR1bGVLZXkgPSBub3JtYWxpemVCYWNrZ3JvdW5kSm9iU2NoZWR1bGVLZXkoc2NoZWR1bGVLZXkpXG4gICAgY29uc3QgcHJlcGFyZWRKb2IgPSB0aGlzLl9wcmVwYXJlSm9iKHthcmdzLCBqb2JOYW1lLCBvcHRpb25zfSlcblxuICAgIHJldHVybiBhd2FpdCB0aGlzLl93aXRoRGIoYXN5bmMgKGNvbm5lY3Rpb24pID0+IGF3YWl0IHRoaXMuX211dGF0ZShjb25uZWN0aW9uLCBhc3luYyAoZGIpID0+IHtcbiAgICAgIGF3YWl0IHRoaXMuX2xvY2tTY2hlZHVsZUtleShkYiwgbm9ybWFsaXplZFNjaGVkdWxlS2V5KVxuICAgICAgY29uc3Qgb3duZXJKb2IgPSBhd2FpdCB0aGlzLl9zY2hlZHVsZWRPd25lckpvYihkYiwgbm9ybWFsaXplZFNjaGVkdWxlS2V5KVxuICAgICAgLyoqIEB0eXBlIHtpbXBvcnQoXCIuL3R5cGVzLmpzXCIpLkJhY2tncm91bmRKb2JSZXBsYWNlbWVudFByZXZpb3VzU3RhdHVzfSAqL1xuICAgICAgbGV0IHByZXZpb3VzU3RhdHVzID0gbnVsbFxuICAgICAgbGV0IHByZXZpb3VzSm9iSWQgPSBudWxsXG5cbiAgICAgIGlmIChvd25lckpvYj8uc3RhdHVzID09PSBcInF1ZXVlZFwiKSB7XG4gICAgICAgIGNvbnN0IGFmZmVjdGVkUm93cyA9IGF3YWl0IHRoaXMuX3VwZGF0ZUFmZmVjdGVkUm93cyhkYiwge1xuICAgICAgICAgIGNvbmRpdGlvbnM6IHtpZDogb3duZXJKb2IuaWQsIHN0YXR1czogXCJxdWV1ZWRcIn0sXG4gICAgICAgICAgZGF0YToge3N0YXR1czogXCJjYW5jZWxsZWRcIn0sXG4gICAgICAgICAgdGFibGVOYW1lOiBMT0NBTF9CQUNLR1JPVU5EX0pPQlNfVEFCTEVcbiAgICAgICAgfSlcblxuICAgICAgICBpZiAoYWZmZWN0ZWRSb3dzID09PSAxKSB7XG4gICAgICAgICAgcHJldmlvdXNKb2JJZCA9IG93bmVySm9iLmlkXG4gICAgICAgICAgcHJldmlvdXNTdGF0dXMgPSBcInF1ZXVlZFwiXG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgY29uc3QgY3VycmVudE93bmVySm9iID0gYXdhaXQgdGhpcy5fZ2V0Sm9iKGRiLCBvd25lckpvYi5pZClcblxuICAgICAgICAgIGlmIChjdXJyZW50T3duZXJKb2I/LnN0YXR1cyA9PT0gXCJoYW5kZWRfb2ZmXCIpIHtcbiAgICAgICAgICAgIHByZXZpb3VzSm9iSWQgPSBjdXJyZW50T3duZXJKb2IuaWRcbiAgICAgICAgICAgIHByZXZpb3VzU3RhdHVzID0gXCJoYW5kZWRfb2ZmXCJcbiAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICAgIH0gZWxzZSBpZiAob3duZXJKb2I/LnN0YXR1cyA9PT0gXCJoYW5kZWRfb2ZmXCIpIHtcbiAgICAgICAgcHJldmlvdXNKb2JJZCA9IG93bmVySm9iLmlkXG4gICAgICAgIHByZXZpb3VzU3RhdHVzID0gXCJoYW5kZWRfb2ZmXCJcbiAgICAgIH1cblxuICAgICAgY29uc3Qgc2NoZWR1bGVPcmRlciA9IGF3YWl0IHRoaXMuX25leHRTY2hlZHVsZU9yZGVyKGRiLCBub3JtYWxpemVkU2NoZWR1bGVLZXkpXG5cbiAgICAgIGlmIChwcmVwYXJlZEpvYi5jb25jdXJyZW5jeSkgYXdhaXQgdGhpcy5fZW5zdXJlQ29uY3VycmVuY3koZGIsIHByZXBhcmVkSm9iLmNvbmN1cnJlbmN5KVxuICAgICAgYXdhaXQgdGhpcy5faW5zZXJ0UHJlcGFyZWRKb2IoZGIsIHByZXBhcmVkSm9iLCBub3JtYWxpemVkU2NoZWR1bGVLZXksIHNjaGVkdWxlT3JkZXIpXG4gICAgICBhd2FpdCBkYi51cHNlcnQoe1xuICAgICAgICBjb25mbGljdENvbHVtbnM6IFtcInNjaGVkdWxlX2tleVwiXSxcbiAgICAgICAgZGF0YToge2pvYl9pZDogcHJlcGFyZWRKb2Iuam9iSWQsIHNjaGVkdWxlX2tleTogbm9ybWFsaXplZFNjaGVkdWxlS2V5fSxcbiAgICAgICAgdGFibGVOYW1lOiBMT0NBTF9CQUNLR1JPVU5EX0pPQl9TQ0hFRFVMRV9LRVlTX1RBQkxFLFxuICAgICAgICB1cGRhdGVDb2x1bW5zOiBbXCJqb2JfaWRcIl1cbiAgICAgIH0pXG4gICAgICBhd2FpdCB0aGlzLl93YWtlRGlzcGF0Y2hlckFmdGVyQ29tbWl0KGRiKVxuXG4gICAgICByZXR1cm4ge2pvYklkOiBwcmVwYXJlZEpvYi5qb2JJZCwgcHJldmlvdXNKb2JJZCwgcHJldmlvdXNTdGF0dXN9XG4gICAgfSkpXG4gIH1cblxuICAvKipcbiAgICogQ2FuY2VscyBhIHF1ZXVlZCBzdGFibGUgb3duZXIgb3IgZGV0YWNoZXMgYW4gYWN0aXZlIGhhbmRvZmYgdHJ1dGhmdWxseS5cbiAgICogQHBhcmFtIHtzdHJpbmd9IHNjaGVkdWxlS2V5IC0gU3RhYmxlIGxvZ2ljYWwgc2NoZWR1bGUga2V5LlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxpbXBvcnQoXCIuL3R5cGVzLmpzXCIpLkJhY2tncm91bmRKb2JDYW5jZWxsYXRpb25SZXN1bHQ+fSAtIENhbmNlbGxhdGlvbiByZXN1bHQuXG4gICAqL1xuICBhc3luYyBjYW5jZWxTY2hlZHVsZWQoc2NoZWR1bGVLZXkpIHtcbiAgICBhd2FpdCB0aGlzLmVuc3VyZVJlYWR5KClcblxuICAgIGNvbnN0IG5vcm1hbGl6ZWRTY2hlZHVsZUtleSA9IG5vcm1hbGl6ZUJhY2tncm91bmRKb2JTY2hlZHVsZUtleShzY2hlZHVsZUtleSlcblxuICAgIHJldHVybiBhd2FpdCB0aGlzLl93aXRoRGIoYXN5bmMgKGNvbm5lY3Rpb24pID0+IGF3YWl0IHRoaXMuX211dGF0ZShjb25uZWN0aW9uLCBhc3luYyAoZGIpID0+IHtcbiAgICAgIGF3YWl0IHRoaXMuX2xvY2tTY2hlZHVsZUtleShkYiwgbm9ybWFsaXplZFNjaGVkdWxlS2V5KVxuICAgICAgY29uc3Qgb3duZXJKb2IgPSBhd2FpdCB0aGlzLl9zY2hlZHVsZWRPd25lckpvYihkYiwgbm9ybWFsaXplZFNjaGVkdWxlS2V5KVxuXG4gICAgICBpZiAoIW93bmVySm9iKSB7XG4gICAgICAgIGF3YWl0IHRoaXMuX3JlbGVhc2VTY2hlZHVsZU93bmVyc2hpcChkYiwge2pvYklkOiBudWxsLCBzY2hlZHVsZUtleTogbm9ybWFsaXplZFNjaGVkdWxlS2V5fSlcbiAgICAgICAgcmV0dXJuIHtqb2JJZDogbnVsbCwgb3V0Y29tZTogXCJub3RfZm91bmRcIn1cbiAgICAgIH1cblxuICAgICAgaWYgKG93bmVySm9iLnN0YXR1cyA9PT0gXCJxdWV1ZWRcIikge1xuICAgICAgICBjb25zdCBhZmZlY3RlZFJvd3MgPSBhd2FpdCB0aGlzLl91cGRhdGVBZmZlY3RlZFJvd3MoZGIsIHtcbiAgICAgICAgICBjb25kaXRpb25zOiB7aWQ6IG93bmVySm9iLmlkLCBzdGF0dXM6IFwicXVldWVkXCJ9LFxuICAgICAgICAgIGRhdGE6IHtzdGF0dXM6IFwiY2FuY2VsbGVkXCJ9LFxuICAgICAgICAgIHRhYmxlTmFtZTogTE9DQUxfQkFDS0dST1VORF9KT0JTX1RBQkxFXG4gICAgICAgIH0pXG5cbiAgICAgICAgaWYgKGFmZmVjdGVkUm93cyA9PT0gMSkge1xuICAgICAgICAgIGF3YWl0IHRoaXMuX3JlbGVhc2VTY2hlZHVsZU93bmVyc2hpcChkYiwge2pvYklkOiBvd25lckpvYi5pZCwgc2NoZWR1bGVLZXk6IG5vcm1hbGl6ZWRTY2hlZHVsZUtleX0pXG4gICAgICAgICAgYXdhaXQgdGhpcy5fd2FrZURpc3BhdGNoZXJBZnRlckNvbW1pdChkYilcbiAgICAgICAgICByZXR1cm4ge2pvYklkOiBvd25lckpvYi5pZCwgb3V0Y29tZTogXCJjYW5jZWxsZWRcIn1cbiAgICAgICAgfVxuICAgICAgfVxuXG4gICAgICBjb25zdCBjdXJyZW50Sm9iID0gYXdhaXQgdGhpcy5fc2NoZWR1bGVkT3duZXJKb2IoZGIsIG5vcm1hbGl6ZWRTY2hlZHVsZUtleSlcblxuICAgICAgYXdhaXQgdGhpcy5fcmVsZWFzZVNjaGVkdWxlT3duZXJzaGlwKGRiLCB7am9iSWQ6IG93bmVySm9iLmlkLCBzY2hlZHVsZUtleTogbm9ybWFsaXplZFNjaGVkdWxlS2V5fSlcbiAgICAgIGF3YWl0IHRoaXMuX3dha2VEaXNwYXRjaGVyQWZ0ZXJDb21taXQoZGIpXG4gICAgICBpZiAoY3VycmVudEpvYj8uc3RhdHVzID09PSBcImhhbmRlZF9vZmZcIikgcmV0dXJuIHtqb2JJZDogY3VycmVudEpvYi5pZCwgb3V0Y29tZTogXCJoYW5kZWRfb2ZmXCJ9XG4gICAgICByZXR1cm4ge2pvYklkOiBudWxsLCBvdXRjb21lOiBcIm5vdF9mb3VuZFwifVxuICAgIH0pKVxuICB9XG5cbiAgLyoqXG4gICAqIFJlYWRzIHN0YWJsZSBvd25lcnNoaXAgYW5kIG9wdGlvbmFsIGxhdGVzdCB0ZXJtaW5hbCBoaXN0b3J5IGluIG9uZSB0cmFuc2FjdGlvbi5cbiAgICogQHBhcmFtIHtzdHJpbmd9IHNjaGVkdWxlS2V5IC0gU3RhYmxlIGxvZ2ljYWwgc2NoZWR1bGUga2V5LlxuICAgKiBAcGFyYW0ge3tpbmNsdWRlTGF0ZXN0VGVybWluYWw/OiBib29sZWFufX0gW29wdGlvbnNdIC0gTG9va3VwIG9wdGlvbnMuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPGltcG9ydChcIi4vdHlwZXMuanNcIikuQmFja2dyb3VuZEpvYlNjaGVkdWxlZExvb2t1cFJlc3VsdD59IC0gTm9ybWFsaXplZCBsb2NhbCBqb2JzLlxuICAgKi9cbiAgYXN5bmMgZ2V0U2NoZWR1bGVkSm9iKHNjaGVkdWxlS2V5LCB7aW5jbHVkZUxhdGVzdFRlcm1pbmFsID0gZmFsc2V9ID0ge30pIHtcbiAgICBhd2FpdCB0aGlzLmVuc3VyZVJlYWR5KClcblxuICAgIGNvbnN0IG5vcm1hbGl6ZWRTY2hlZHVsZUtleSA9IG5vcm1hbGl6ZUJhY2tncm91bmRKb2JTY2hlZHVsZUtleShzY2hlZHVsZUtleSlcblxuICAgIGlmICh0eXBlb2YgaW5jbHVkZUxhdGVzdFRlcm1pbmFsICE9PSBcImJvb2xlYW5cIikge1xuICAgICAgdGhyb3cgVmVsb2Npb3VzRXJyb3Iuc2FmZShcImJhY2tncm91bmQgam9iIGluY2x1ZGVMYXRlc3RUZXJtaW5hbCBtdXN0IGJlIGEgYm9vbGVhblwiKVxuICAgIH1cblxuICAgIHJldHVybiBhd2FpdCB0aGlzLl93aXRoRGIoYXN5bmMgKGNvbm5lY3Rpb24pID0+IGF3YWl0IHRoaXMuX211dGF0ZShjb25uZWN0aW9uLCBhc3luYyAoZGIpID0+IHtcbiAgICAgIHJldHVybiBhd2FpdCB0aGlzLl9zY2hlZHVsZWRKb2JMb29rdXAoZGIsIHtcbiAgICAgICAgaW5jbHVkZUxhdGVzdFRlcm1pbmFsLFxuICAgICAgICBzY2hlZHVsZUtleTogbm9ybWFsaXplZFNjaGVkdWxlS2V5XG4gICAgICB9KVxuICAgIH0pKVxuICB9XG5cbiAgLyoqXG4gICAqIE1vdmVzIG9ubHkgYSBmdXR1cmUgcXVldWVkIHN0YWJsZSBvd25lciB0byB0aGUgY3VycmVudCB0aW1lLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gc2NoZWR1bGVLZXkgLSBTdGFibGUgbG9naWNhbCBzY2hlZHVsZSBrZXkuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPGltcG9ydChcIi4vdHlwZXMuanNcIikuQmFja2dyb3VuZEpvYldha2VSZXN1bHQ+fSAtIEV4YWN0IHdha2Ugb3V0Y29tZS5cbiAgICovXG4gIGFzeW5jIHdha2VTY2hlZHVsZWQoc2NoZWR1bGVLZXkpIHtcbiAgICBhd2FpdCB0aGlzLmVuc3VyZVJlYWR5KClcblxuICAgIGNvbnN0IG5vcm1hbGl6ZWRTY2hlZHVsZUtleSA9IG5vcm1hbGl6ZUJhY2tncm91bmRKb2JTY2hlZHVsZUtleShzY2hlZHVsZUtleSlcblxuICAgIHJldHVybiBhd2FpdCB0aGlzLl93aXRoRGIoYXN5bmMgKGNvbm5lY3Rpb24pID0+IGF3YWl0IHRoaXMuX211dGF0ZShjb25uZWN0aW9uLCBhc3luYyAoZGIpID0+IHtcbiAgICAgIGF3YWl0IHRoaXMuX2xvY2tTY2hlZHVsZUtleShkYiwgbm9ybWFsaXplZFNjaGVkdWxlS2V5KVxuICAgICAgY29uc3Qgam9iID0gYXdhaXQgdGhpcy5fc2NoZWR1bGVkT3duZXJKb2IoZGIsIG5vcm1hbGl6ZWRTY2hlZHVsZUtleSlcblxuICAgICAgaWYgKCFqb2IgfHwgKGpvYi5zdGF0dXMgIT09IFwicXVldWVkXCIgJiYgam9iLnN0YXR1cyAhPT0gXCJoYW5kZWRfb2ZmXCIpKSByZXR1cm4ge2pvYklkOiBudWxsLCBvdXRjb21lOiBcIm5vdF9mb3VuZFwifVxuICAgICAgaWYgKGpvYi5zdGF0dXMgPT09IFwiaGFuZGVkX29mZlwiKSByZXR1cm4ge2pvYklkOiBqb2IuaWQsIG91dGNvbWU6IFwiaGFuZGVkX29mZlwifVxuXG4gICAgICBjb25zdCBub3dNcyA9IHRoaXMuY2xvY2subm93KClcblxuICAgICAgaWYgKE51bWJlcihqb2Iuc2NoZWR1bGVkQXRNcykgPD0gbm93TXMpIHtcbiAgICAgICAgYXdhaXQgdGhpcy5fd2FrZURpc3BhdGNoZXJBZnRlckNvbW1pdChkYilcbiAgICAgICAgcmV0dXJuIHtqb2JJZDogam9iLmlkLCBvdXRjb21lOiBcImFscmVhZHlfZHVlXCJ9XG4gICAgICB9XG5cbiAgICAgIGNvbnN0IGFmZmVjdGVkUm93cyA9IGF3YWl0IHRoaXMuX3VwZGF0ZUFmZmVjdGVkUm93cyhkYiwge1xuICAgICAgICBjb25kaXRpb25zOiB7aWQ6IGpvYi5pZCwgc2NoZWR1bGVkX2F0X21zOiBqb2Iuc2NoZWR1bGVkQXRNcywgc3RhdHVzOiBcInF1ZXVlZFwifSxcbiAgICAgICAgZGF0YToge3NjaGVkdWxlZF9hdF9tczogbm93TXN9LFxuICAgICAgICB0YWJsZU5hbWU6IExPQ0FMX0JBQ0tHUk9VTkRfSk9CU19UQUJMRVxuICAgICAgfSlcblxuICAgICAgaWYgKGFmZmVjdGVkUm93cyA9PT0gMSkge1xuICAgICAgICBhd2FpdCB0aGlzLl93YWtlRGlzcGF0Y2hlckFmdGVyQ29tbWl0KGRiKVxuICAgICAgICByZXR1cm4ge2pvYklkOiBqb2IuaWQsIG91dGNvbWU6IFwid29rZW5cIn1cbiAgICAgIH1cblxuICAgICAgY29uc3QgY3VycmVudEpvYiA9IGF3YWl0IHRoaXMuX3NjaGVkdWxlZE93bmVySm9iKGRiLCBub3JtYWxpemVkU2NoZWR1bGVLZXkpXG5cbiAgICAgIGlmIChjdXJyZW50Sm9iPy5zdGF0dXMgPT09IFwiaGFuZGVkX29mZlwiKSByZXR1cm4ge2pvYklkOiBjdXJyZW50Sm9iLmlkLCBvdXRjb21lOiBcImhhbmRlZF9vZmZcIn1cbiAgICAgIGlmIChjdXJyZW50Sm9iPy5zdGF0dXMgPT09IFwicXVldWVkXCIgJiYgTnVtYmVyKGN1cnJlbnRKb2Iuc2NoZWR1bGVkQXRNcykgPD0gbm93TXMpIHtcbiAgICAgICAgYXdhaXQgdGhpcy5fd2FrZURpc3BhdGNoZXJBZnRlckNvbW1pdChkYilcbiAgICAgICAgcmV0dXJuIHtqb2JJZDogY3VycmVudEpvYi5pZCwgb3V0Y29tZTogXCJhbHJlYWR5X2R1ZVwifVxuICAgICAgfVxuXG4gICAgICByZXR1cm4ge2pvYklkOiBudWxsLCBvdXRjb21lOiBcIm5vdF9mb3VuZFwifVxuICAgIH0pKVxuICB9XG5cbiAgLyoqXG4gICAqIFNlcmlhbGl6ZXMgbWF0Y2hpbmcgaW4tcHJvY2VzcyBkZWR1cGxpY2F0aW9uIGNoZWNrcyB0aHJvdWdoIGNvbW1pdCB3aGlsZVxuICAgKiBsZWF2aW5nIHVucmVsYXRlZCBqb2IgaWRlbnRpdGllcyBpbmRlcGVuZGVudC5cbiAgICogQHRlbXBsYXRlIFRcbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL3R5cGVzLmpzXCIpLlByZXBhcmVkTG9jYWxCYWNrZ3JvdW5kSm9ifSBwcmVwYXJlZEpvYiAtIFByZXBhcmVkIGpvYiBpZGVudGl0eS5cbiAgICogQHBhcmFtIHsoaG9sZFVudGlsOiAoY29tcGxldGlvbjogUHJvbWlzZTx2b2lkPikgPT4gdm9pZCkgPT4gUHJvbWlzZTxUPn0gY2FsbGJhY2sgLSBEZWR1cGxpY2F0aW9uIG11dGF0aW9uLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxUPn0gLSBNdXRhdGlvbiByZXN1bHQuXG4gICAqL1xuICBhc3luYyBfc2VyaWFsaXplRGVkdXBsaWNhdGVkRW5xdWV1ZShwcmVwYXJlZEpvYiwgY2FsbGJhY2spIHtcbiAgICBsZXQgY2hhaW5zID0gZGVkdXBsaWNhdGVkRW5xdWV1ZUNoYWlucy5nZXQodGhpcy5jb25maWd1cmF0aW9uKVxuXG4gICAgaWYgKCFjaGFpbnMpIHtcbiAgICAgIGNoYWlucyA9IG5ldyBNYXAoKVxuICAgICAgZGVkdXBsaWNhdGVkRW5xdWV1ZUNoYWlucy5zZXQodGhpcy5jb25maWd1cmF0aW9uLCBjaGFpbnMpXG4gICAgfVxuXG4gICAgY29uc3Qga2V5ID0gc2hhMjU2SGV4KEpTT04uc3RyaW5naWZ5KFtcbiAgICAgIHRoaXMuZ2V0RGF0YWJhc2VJZGVudGlmaWVyKCksXG4gICAgICBwcmVwYXJlZEpvYi5qb2JOYW1lLFxuICAgICAgcHJlcGFyZWRKb2IuYXJnc0RpZ2VzdCxcbiAgICAgIHByZXBhcmVkSm9iLnF1ZXVlXG4gICAgXSkpXG4gICAgY29uc3QgcHJldmlvdXMgPSBjaGFpbnMuZ2V0KGtleSkgfHwgUHJvbWlzZS5yZXNvbHZlKClcbiAgICBsZXQgcmVsZWFzZSA9ICgpID0+IHt9XG4gICAgY29uc3QgcnVubmluZyA9IG5ldyBQcm9taXNlKChyZXNvbHZlKSA9PiB7IHJlbGVhc2UgPSAoKSA9PiByZXNvbHZlKHVuZGVmaW5lZCkgfSlcbiAgICBjb25zdCBjaGFpbiA9IHByZXZpb3VzLnRoZW4oKCkgPT4gcnVubmluZylcbiAgICAvKiogQHR5cGUge1Byb21pc2U8dm9pZD4gfCB1bmRlZmluZWR9ICovXG4gICAgbGV0IGNvbXBsZXRpb25cbiAgICBjb25zdCBmaW5pc2ggPSAoKSA9PiB7XG4gICAgICByZWxlYXNlKClcbiAgICAgIGlmIChjaGFpbnMuZ2V0KGtleSkgPT09IGNoYWluKSBjaGFpbnMuZGVsZXRlKGtleSlcbiAgICAgIGlmIChjaGFpbnMuc2l6ZSA9PT0gMCkgZGVkdXBsaWNhdGVkRW5xdWV1ZUNoYWlucy5kZWxldGUodGhpcy5jb25maWd1cmF0aW9uKVxuICAgIH1cblxuICAgIGNoYWlucy5zZXQoa2V5LCBjaGFpbilcbiAgICBhd2FpdCBwcmV2aW91c1xuXG4gICAgdHJ5IHtcbiAgICAgIGNvbnN0IHJlc3VsdCA9IGF3YWl0IGNhbGxiYWNrKCh0cmFuc2FjdGlvbkNvbXBsZXRpb24pID0+IHsgY29tcGxldGlvbiA9IHRyYW5zYWN0aW9uQ29tcGxldGlvbiB9KVxuXG4gICAgICBpZiAoY29tcGxldGlvbikge1xuICAgICAgICBjb21wbGV0aW9uLnRoZW4oZmluaXNoLCBmaW5pc2gpXG4gICAgICB9IGVsc2Uge1xuICAgICAgICBmaW5pc2goKVxuICAgICAgfVxuXG4gICAgICByZXR1cm4gcmVzdWx0XG4gICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgIGZpbmlzaCgpXG4gICAgICB0aHJvdyBlcnJvclxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBQcmVwYXJlcyB2YWxpZGF0ZWQgbG9jYWwgam9iIGRhdGEgZm9yIGluc2VydGlvbi5cbiAgICogQHBhcmFtIHt7YXJnczogQXJyYXk8UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+LCBqb2JOYW1lOiBzdHJpbmcsIG9wdGlvbnM6IGltcG9ydChcIi4vdHlwZXMuanNcIikuQmFja2dyb3VuZEpvYk9wdGlvbnN9fSBhcmdzIC0gSm9iIHJlcXVlc3QuXG4gICAqIEByZXR1cm5zIHtpbXBvcnQoXCIuL3R5cGVzLmpzXCIpLlByZXBhcmVkTG9jYWxCYWNrZ3JvdW5kSm9ifSAtIFByZXBhcmVkIHJvdyBkYXRhLlxuICAgKi9cbiAgX3ByZXBhcmVKb2Ioe2FyZ3MsIGpvYk5hbWUsIG9wdGlvbnN9KSB7XG4gICAgaWYgKG9wdGlvbnMuaWRlbXBvdGVuY3lLZXkgIT09IHVuZGVmaW5lZCkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKFwiaWRlbXBvdGVuY3lLZXkgaXMgbm90IHN1cHBvcnRlZCBieSB0aGUgbG9jYWwgYmFja2dyb3VuZC1qb2JzIGFkYXB0ZXJcIilcbiAgICB9XG5cbiAgICBjb25zdCBjcmVhdGVkQXRNcyA9IHRoaXMuY2xvY2subm93KClcbiAgICBjb25zdCBxdWV1ZSA9IG5vcm1hbGl6ZUJhY2tncm91bmRKb2JRdWV1ZShvcHRpb25zKVxuICAgIGNvbnN0IHF1ZXVlcyA9IHRoaXMuY29uZmlndXJhdGlvbi5nZXRCYWNrZ3JvdW5kSm9ic0NvbmZpZygpLnF1ZXVlc1xuICAgIGNvbnN0IGFyZ3NKc29uID0gSlNPTi5zdHJpbmdpZnkoYXJncyB8fCBbXSlcbiAgICBjb25zdCBleGVjdXRpb25Nb2RlID0gbm9ybWFsaXplQmFja2dyb3VuZEpvYkV4ZWN1dGlvbk1vZGUob3B0aW9ucywgXCJpbmxpbmVcIiwgTE9DQUxfRVhFQ1VUSU9OX01PREVTKVxuXG4gICAgaWYgKHR5cGVvZiBhcmdzSnNvbiAhPT0gXCJzdHJpbmdcIikgdGhyb3cgbmV3IFR5cGVFcnJvcihcIkxvY2FsIGJhY2tncm91bmQgam9iIGFyZ3VtZW50cyBtdXN0IGJlIEpTT04gc2VyaWFsaXphYmxlXCIpXG4gICAgaWYgKGV4ZWN1dGlvbk1vZGUgIT09IFwiaW5saW5lXCIpIHRocm93IG5ldyBFcnJvcihcIkxvY2FsIGJhY2tncm91bmQgam9iIGV4ZWN1dGlvbiBtb2RlIGludmFyaWFudCB3YXMgdmlvbGF0ZWRcIilcblxuICAgIHJldHVybiB7XG4gICAgICBhcmdzRGlnZXN0OiBzaGEyNTZIZXgoYXJnc0pzb24pLFxuICAgICAgYXJnc0pzb24sXG4gICAgICBjb25jdXJyZW5jeTogbm9ybWFsaXplQmFja2dyb3VuZEpvYkNvbmN1cnJlbmN5KHtvcHRpb25zLCBxdWV1ZSwgcXVldWVzfSksXG4gICAgICBjcmVhdGVkQXRNcyxcbiAgICAgIGV4ZWN1dGlvbk1vZGUsXG4gICAgICBqb2JJZDogbmV3IFVVSUQoNCkuZm9ybWF0KCksXG4gICAgICBqb2JOYW1lLFxuICAgICAgbWF4UmV0cmllczogbm9ybWFsaXplQmFja2dyb3VuZEpvYk1heFJldHJpZXMob3B0aW9ucy5tYXhSZXRyaWVzKSxcbiAgICAgIHF1ZXVlLFxuICAgICAgc2NoZWR1bGVkQXRNczogbm9ybWFsaXplQmFja2dyb3VuZEpvYlNjaGVkdWxlZEF0TXMob3B0aW9ucy5zY2hlZHVsZWRBdE1zLCBjcmVhdGVkQXRNcylcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogSW5zZXJ0cyBvbmUgcHJlcGFyZWQgbG9jYWwgam9iIHJvdyBhbmQgaXRzIGNvbmN1cnJlbmN5IG1ldGFkYXRhLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL2RhdGFiYXNlL2RyaXZlcnMvYmFzZS5qc1wiKS5kZWZhdWx0fSBkYiAtIExvY2FsIFNRTGl0ZSBjb25uZWN0aW9uLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vdHlwZXMuanNcIikuUHJlcGFyZWRMb2NhbEJhY2tncm91bmRKb2J9IHByZXBhcmVkSm9iIC0gUHJlcGFyZWQgcm93IGRhdGEuXG4gICAqIEBwYXJhbSB7c3RyaW5nIHwgbnVsbH0gW3NjaGVkdWxlS2V5XSAtIFN0YWJsZSBzY2hlZHVsZSBoaXN0b3J5IGtleS5cbiAgICogQHBhcmFtIHtudW1iZXIgfCBudWxsfSBbc2NoZWR1bGVPcmRlcl0gLSBNb25vdG9uaWMgc3RhYmxlIG93bmVyc2hpcCBvcmRlci5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgYWZ0ZXIgaW5zZXJ0aW9uLlxuICAgKi9cbiAgYXN5bmMgX2luc2VydFByZXBhcmVkSm9iKGRiLCBwcmVwYXJlZEpvYiwgc2NoZWR1bGVLZXkgPSBudWxsLCBzY2hlZHVsZU9yZGVyID0gbnVsbCkge1xuICAgIGF3YWl0IGRiLmluc2VydCh7XG4gICAgICB0YWJsZU5hbWU6IExPQ0FMX0JBQ0tHUk9VTkRfSk9CU19UQUJMRSxcbiAgICAgIGRhdGE6IHtcbiAgICAgICAgYXJnc19kaWdlc3Q6IHByZXBhcmVkSm9iLmFyZ3NEaWdlc3QsXG4gICAgICAgIGFyZ3NfanNvbjogcHJlcGFyZWRKb2IuYXJnc0pzb24sXG4gICAgICAgIGF0dGVtcHRzOiAwLFxuICAgICAgICBjb21wbGV0ZWRfYXRfbXM6IG51bGwsXG4gICAgICAgIGNvbmN1cnJlbmN5X2tleTogcHJlcGFyZWRKb2IuY29uY3VycmVuY3k/LmNvbmN1cnJlbmN5S2V5IHx8IG51bGwsXG4gICAgICAgIGNyZWF0ZWRfYXRfbXM6IHByZXBhcmVkSm9iLmNyZWF0ZWRBdE1zLFxuICAgICAgICBleGVjdXRpb25fbW9kZTogcHJlcGFyZWRKb2IuZXhlY3V0aW9uTW9kZSxcbiAgICAgICAgZmFpbGVkX2F0X21zOiBudWxsLFxuICAgICAgICBoYW5kZWRfb2ZmX2F0X21zOiBudWxsLFxuICAgICAgICBoYW5kb2ZmX2lkOiBudWxsLFxuICAgICAgICBpZDogcHJlcGFyZWRKb2Iuam9iSWQsXG4gICAgICAgIGpvYl9uYW1lOiBwcmVwYXJlZEpvYi5qb2JOYW1lLFxuICAgICAgICBsYXN0X2Vycm9yOiBudWxsLFxuICAgICAgICBtYXhfY29uY3VycmVuY3k6IHByZXBhcmVkSm9iLmNvbmN1cnJlbmN5Py5tYXhDb25jdXJyZW5jeSB8fCBudWxsLFxuICAgICAgICBtYXhfcmV0cmllczogcHJlcGFyZWRKb2IubWF4UmV0cmllcyxcbiAgICAgICAgcXVldWU6IHByZXBhcmVkSm9iLnF1ZXVlLFxuICAgICAgICBzY2hlZHVsZV9rZXk6IHNjaGVkdWxlS2V5LFxuICAgICAgICBzY2hlZHVsZV9vcmRlcjogc2NoZWR1bGVPcmRlcixcbiAgICAgICAgc2NoZWR1bGVkX2F0X21zOiBwcmVwYXJlZEpvYi5zY2hlZHVsZWRBdE1zLFxuICAgICAgICBzdGF0dXM6IFwicXVldWVkXCIsXG4gICAgICAgIHdvcmtlcl9pZDogbnVsbFxuICAgICAgfVxuICAgIH0pXG4gIH1cblxuICAvKipcbiAgICogUmVjb25jaWxlcyBjb25maWd1cmVkIHF1ZXVlLWRlcml2ZWQgY2FwcyBhbmQgZHVyYWJsZSBjb3VudGVycy5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgYWZ0ZXIgcmVjb25jaWxpYXRpb24uXG4gICAqL1xuICBhc3luYyByZWNvbmNpbGVRdWV1ZUNvbmN1cnJlbmN5KCkge1xuICAgIGF3YWl0IHRoaXMuZW5zdXJlUmVhZHkoKVxuXG4gICAgYXdhaXQgdGhpcy5fd2l0aERiKGFzeW5jIChjb25uZWN0aW9uKSA9PiBhd2FpdCB0aGlzLl9tdXRhdGUoY29ubmVjdGlvbiwgYXN5bmMgKGRiKSA9PiB7XG4gICAgICBjb25zdCBxdWV1ZXMgPSB0aGlzLmNvbmZpZ3VyYXRpb24uZ2V0QmFja2dyb3VuZEpvYnNDb25maWcoKS5xdWV1ZXNcbiAgICAgIGNvbnN0IHJvd3MgPSBhd2FpdCBkYi5uZXdRdWVyeSgpLmZyb20oTE9DQUxfQkFDS0dST1VORF9KT0JTX1RBQkxFKS53aGVyZSh7c3RhdHVzOiBcInF1ZXVlZFwifSkucmVzdWx0cygpXG5cbiAgICAgIGZvciAoY29uc3QgcmF3Um93IG9mIHJvd3MpIHtcbiAgICAgICAgYXdhaXQgdGhpcy5fcmVjb25jaWxlUXVldWVkSm9iQ29uY3VycmVuY3koZGIsIHRoaXMuX25vcm1hbGl6ZVJvdyhyYXdSb3cpLCBxdWV1ZXMpXG4gICAgICB9XG5cbiAgICAgIGF3YWl0IHRoaXMuX3JlYnVpbGRDb25jdXJyZW5jeUNvdW50cyhkYilcbiAgICB9KSlcbiAgfVxuXG4gIC8qKlxuICAgKiBBcHBsaWVzIGN1cnJlbnQgcXVldWUtZGVyaXZlZCBjb25jdXJyZW5jeSBwb2xpY3kgdG8gb25lIHF1ZXVlZCByb3cuXG4gICAqIEV4cGxpY2l0IGNvbmN1cnJlbmN5IGtleXMgcmVtYWluIG93bmVkIGJ5IHRoZSBlbnF1ZXVlIGNvbnRyYWN0LlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL2RhdGFiYXNlL2RyaXZlcnMvYmFzZS5qc1wiKS5kZWZhdWx0fSBkYiAtIExvY2FsIFNRTGl0ZSBjb25uZWN0aW9uLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vdHlwZXMuanNcIikuQmFja2dyb3VuZEpvYlJvd30gam9iIC0gUXVldWVkIGpvYiBzbmFwc2hvdC5cbiAgICogQHBhcmFtIHtSZWNvcmQ8c3RyaW5nLCB7bWF4Q29uY3VycmVudD86IG51bWJlciwgcHJpb3JpdHk/OiBudW1iZXJ9Pn0gcXVldWVzIC0gQ3VycmVudCBxdWV1ZSBwb2xpY3kgc25hcHNob3QuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPGltcG9ydChcIi4vdHlwZXMuanNcIikuQmFja2dyb3VuZEpvYlJvdz59IC0gUmVjb25jaWxlZCBzbmFwc2hvdC5cbiAgICovXG4gIGFzeW5jIF9yZWNvbmNpbGVRdWV1ZWRKb2JDb25jdXJyZW5jeShkYiwgam9iLCBxdWV1ZXMpIHtcbiAgICBjb25zdCBjdXJyZW50SXNRdWV1ZURlcml2ZWQgPSBCb29sZWFuKGpvYi5jb25jdXJyZW5jeUtleT8uc3RhcnRzV2l0aChRVUVVRV9DT05DVVJSRU5DWV9LRVlfUFJFRklYKSlcblxuICAgIGlmIChqb2IuY29uY3VycmVuY3lLZXkgJiYgIWN1cnJlbnRJc1F1ZXVlRGVyaXZlZCkgcmV0dXJuIGpvYlxuXG4gICAgY29uc3QgY29uY3VycmVuY3kgPSBub3JtYWxpemVCYWNrZ3JvdW5kSm9iQ29uY3VycmVuY3koe1xuICAgICAgb3B0aW9uczoge30sXG4gICAgICBxdWV1ZTogam9iLnF1ZXVlLFxuICAgICAgcXVldWVzXG4gICAgfSlcblxuICAgIGlmICghY29uY3VycmVuY3kpIHtcbiAgICAgIGlmIChjdXJyZW50SXNRdWV1ZURlcml2ZWQpIHtcbiAgICAgICAgYXdhaXQgZGIudXBkYXRlKHtcbiAgICAgICAgICBjb25kaXRpb25zOiB7aWQ6IGpvYi5pZCwgc3RhdHVzOiBcInF1ZXVlZFwifSxcbiAgICAgICAgICBkYXRhOiB7Y29uY3VycmVuY3lfa2V5OiBudWxsLCBtYXhfY29uY3VycmVuY3k6IG51bGx9LFxuICAgICAgICAgIHRhYmxlTmFtZTogTE9DQUxfQkFDS0dST1VORF9KT0JTX1RBQkxFXG4gICAgICAgIH0pXG4gICAgICB9XG5cbiAgICAgIHJldHVybiB7Li4uam9iLCBjb25jdXJyZW5jeUtleTogbnVsbCwgbWF4Q29uY3VycmVuY3k6IG51bGx9XG4gICAgfVxuXG4gICAgYXdhaXQgdGhpcy5fZW5zdXJlQ29uY3VycmVuY3koZGIsIGNvbmN1cnJlbmN5KVxuICAgIGlmIChqb2IuY29uY3VycmVuY3lLZXkgIT09IGNvbmN1cnJlbmN5LmNvbmN1cnJlbmN5S2V5IHx8IGpvYi5tYXhDb25jdXJyZW5jeSAhPT0gY29uY3VycmVuY3kubWF4Q29uY3VycmVuY3kpIHtcbiAgICAgIGF3YWl0IGRiLnVwZGF0ZSh7XG4gICAgICAgIGNvbmRpdGlvbnM6IHtpZDogam9iLmlkLCBzdGF0dXM6IFwicXVldWVkXCJ9LFxuICAgICAgICBkYXRhOiB7Y29uY3VycmVuY3lfa2V5OiBjb25jdXJyZW5jeS5jb25jdXJyZW5jeUtleSwgbWF4X2NvbmN1cnJlbmN5OiBjb25jdXJyZW5jeS5tYXhDb25jdXJyZW5jeX0sXG4gICAgICAgIHRhYmxlTmFtZTogTE9DQUxfQkFDS0dST1VORF9KT0JTX1RBQkxFXG4gICAgICB9KVxuICAgIH1cblxuICAgIHJldHVybiB7Li4uam9iLCBjb25jdXJyZW5jeUtleTogY29uY3VycmVuY3kuY29uY3VycmVuY3lLZXksIG1heENvbmN1cnJlbmN5OiBjb25jdXJyZW5jeS5tYXhDb25jdXJyZW5jeX1cbiAgfVxuXG4gIC8qKlxuICAgKiBGaW5kcyB0aGUgbmV4dCBlbGlnaWJsZSBsb2NhbCBqb2IuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPGltcG9ydChcIi4vdHlwZXMuanNcIikuQmFja2dyb3VuZEpvYlJvdyB8IG51bGw+fSAtIE5leHQgZWxpZ2libGUgbG9jYWwgam9iLlxuICAgKi9cbiAgYXN5bmMgbmV4dEF2YWlsYWJsZUpvYigpIHtcbiAgICBhd2FpdCB0aGlzLmVuc3VyZVJlYWR5KClcblxuICAgIHJldHVybiBhd2FpdCB0aGlzLl93aXRoRGIoYXN5bmMgKGRiKSA9PiB7XG4gICAgICBjb25zdCBqb2JzVGFibGUgPSBkYi5xdW90ZVRhYmxlKExPQ0FMX0JBQ0tHUk9VTkRfSk9CU19UQUJMRSlcbiAgICAgIGNvbnN0IGNvbmN1cnJlbmN5VGFibGUgPSBkYi5xdW90ZVRhYmxlKExPQ0FMX0JBQ0tHUk9VTkRfSk9CX0NPTkNVUlJFTkNZX1RBQkxFKVxuICAgICAgY29uc3QgcHJpb3JpdHlPcmRlciA9IHRoaXMuX3F1ZXVlUHJpb3JpdHlPcmRlclNxbChkYilcbiAgICAgIGxldCBxdWVyeSA9IGRiXG4gICAgICAgIC5uZXdRdWVyeSgpXG4gICAgICAgIC5mcm9tKExPQ0FMX0JBQ0tHUk9VTkRfSk9CU19UQUJMRSlcbiAgICAgICAgLndoZXJlKHtzdGF0dXM6IFwicXVldWVkXCJ9KVxuICAgICAgICAud2hlcmUoYHNjaGVkdWxlZF9hdF9tcyA8PSAke2RiLnF1b3RlKHRoaXMuY2xvY2subm93KCkpfWApXG4gICAgICAgIC53aGVyZShcbiAgICAgICAgICBgKCR7am9ic1RhYmxlfS4ke2RiLnF1b3RlQ29sdW1uKFwiY29uY3VycmVuY3lfa2V5XCIpfSBJUyBOVUxMIE9SIEVYSVNUUyAoYCArXG4gICAgICAgICAgYFNFTEVDVCAxIEZST00gJHtjb25jdXJyZW5jeVRhYmxlfSBXSEVSRSBgICtcbiAgICAgICAgICBgJHtjb25jdXJyZW5jeVRhYmxlfS4ke2RiLnF1b3RlQ29sdW1uKFwiY29uY3VycmVuY3lfa2V5XCIpfSA9ICR7am9ic1RhYmxlfS4ke2RiLnF1b3RlQ29sdW1uKFwiY29uY3VycmVuY3lfa2V5XCIpfSBBTkQgYCArXG4gICAgICAgICAgYCR7Y29uY3VycmVuY3lUYWJsZX0uJHtkYi5xdW90ZUNvbHVtbihcImFjdGl2ZV9jb3VudFwiKX0gPCAke2NvbmN1cnJlbmN5VGFibGV9LiR7ZGIucXVvdGVDb2x1bW4oXCJtYXhfY29uY3VycmVuY3lcIil9KSlgXG4gICAgICAgIClcblxuICAgICAgaWYgKHByaW9yaXR5T3JkZXIpIHF1ZXJ5ID0gcXVlcnkub3JkZXIoYCR7cHJpb3JpdHlPcmRlcn0gREVTQ2ApXG5cbiAgICAgIGNvbnN0IHJvd3MgPSBhd2FpdCBxdWVyeVxuICAgICAgICAub3JkZXIoXCJzY2hlZHVsZWRfYXRfbXMgQVNDXCIpXG4gICAgICAgIC5vcmRlcihcImNyZWF0ZWRfYXRfbXMgQVNDXCIpXG4gICAgICAgIC5vcmRlcihcImlkIEFTQ1wiKVxuICAgICAgICAubGltaXQoMSlcbiAgICAgICAgLnJlc3VsdHMoKVxuXG4gICAgICByZXR1cm4gcm93c1swXSA/IHRoaXMuX25vcm1hbGl6ZVJvdyhyb3dzWzBdKSA6IG51bGxcbiAgICB9KVxuICB9XG5cbiAgLyoqXG4gICAqIEZpbmRzIHRoZSBzb29uZXN0IGZ1dHVyZSBxdWV1ZWQgam9iLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxpbXBvcnQoXCIuL3R5cGVzLmpzXCIpLkJhY2tncm91bmRKb2JSb3cgfCBudWxsPn0gLSBTb29uZXN0IGZ1dHVyZSBxdWV1ZWQgam9iLlxuICAgKi9cbiAgYXN5bmMgbmV4dFNjaGVkdWxlZEpvYigpIHtcbiAgICBhd2FpdCB0aGlzLmVuc3VyZVJlYWR5KClcblxuICAgIHJldHVybiBhd2FpdCB0aGlzLl93aXRoRGIoYXN5bmMgKGRiKSA9PiB7XG4gICAgICBjb25zdCByb3dzID0gYXdhaXQgZGJcbiAgICAgICAgLm5ld1F1ZXJ5KClcbiAgICAgICAgLmZyb20oTE9DQUxfQkFDS0dST1VORF9KT0JTX1RBQkxFKVxuICAgICAgICAud2hlcmUoe3N0YXR1czogXCJxdWV1ZWRcIn0pXG4gICAgICAgIC53aGVyZShgc2NoZWR1bGVkX2F0X21zID4gJHtkYi5xdW90ZSh0aGlzLmNsb2NrLm5vdygpKX1gKVxuICAgICAgICAub3JkZXIoXCJzY2hlZHVsZWRfYXRfbXMgQVNDXCIpXG4gICAgICAgIC5vcmRlcihcImNyZWF0ZWRfYXRfbXMgQVNDXCIpXG4gICAgICAgIC5vcmRlcihcImlkIEFTQ1wiKVxuICAgICAgICAubGltaXQoMSlcbiAgICAgICAgLnJlc3VsdHMoKVxuXG4gICAgICByZXR1cm4gcm93c1swXSA/IHRoaXMuX25vcm1hbGl6ZVJvdyhyb3dzWzBdKSA6IG51bGxcbiAgICB9KVxuICB9XG5cbiAgLyoqXG4gICAqIEZpbmRzIGEgcGVyc2lzdGVkIGxvY2FsIGpvYiBieSBpZC5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGpvYklkIC0gSm9iIGlkLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxpbXBvcnQoXCIuL3R5cGVzLmpzXCIpLkJhY2tncm91bmRKb2JSb3cgfCBudWxsPn0gLSBQZXJzaXN0ZWQgam9iLlxuICAgKi9cbiAgYXN5bmMgZ2V0Sm9iKGpvYklkKSB7XG4gICAgYXdhaXQgdGhpcy5lbnN1cmVSZWFkeSgpXG5cbiAgICByZXR1cm4gYXdhaXQgdGhpcy5fd2l0aERiKGFzeW5jIChkYikgPT4gYXdhaXQgdGhpcy5fZ2V0Sm9iKGRiLCBqb2JJZCkpXG4gIH1cblxuICAvKipcbiAgICogTGlzdHMgbG9jYWwgam9icyBpbiBjcmVhdGlvbiBvcmRlci5cbiAgICogQHJldHVybnMge1Byb21pc2U8aW1wb3J0KFwiLi90eXBlcy5qc1wiKS5CYWNrZ3JvdW5kSm9iUm93W10+fSAtIEFsbCBsb2NhbCBqb2JzIGluIGNyZWF0aW9uIG9yZGVyLlxuICAgKi9cbiAgYXN5bmMgbGlzdEpvYnMoKSB7XG4gICAgYXdhaXQgdGhpcy5lbnN1cmVSZWFkeSgpXG5cbiAgICByZXR1cm4gYXdhaXQgdGhpcy5fd2l0aERiKGFzeW5jIChkYikgPT4ge1xuICAgICAgY29uc3Qgcm93cyA9IGF3YWl0IGRiXG4gICAgICAgIC5uZXdRdWVyeSgpXG4gICAgICAgIC5mcm9tKExPQ0FMX0JBQ0tHUk9VTkRfSk9CU19UQUJMRSlcbiAgICAgICAgLm9yZGVyKFwiY3JlYXRlZF9hdF9tcyBBU0NcIilcbiAgICAgICAgLm9yZGVyKFwiaWQgQVNDXCIpXG4gICAgICAgIC5yZXN1bHRzKClcblxuICAgICAgcmV0dXJuIHJvd3MubWFwKChyb3cpID0+IHRoaXMuX25vcm1hbGl6ZVJvdyhyb3cpKVxuICAgIH0pXG4gIH1cblxuICAvKipcbiAgICogQXRvbWljYWxseSByZXNlcnZlcyBjb25jdXJyZW5jeSBhbmQgY2xhaW1zIG9uZSBxdWV1ZWQgam9iLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vdHlwZXMuanNcIikuQmFja2dyb3VuZEpvYkhhbmRvZmZSZXF1ZXN0fSBhcmdzIC0gQ2xhaW0gcmVxdWVzdC4gQSBzdXBwbGllZCBoYW5kb2ZmIGlkIGlzIHBlcnNpc3RlZCBleGFjdGx5LlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxpbXBvcnQoXCIuL3R5cGVzLmpzXCIpLkJhY2tncm91bmRKb2JIYW5kb2ZmIHwgbnVsbD59IC0gRmVuY2VkIGNsYWltLlxuICAgKi9cbiAgYXN5bmMgbWFya0hhbmRlZE9mZih7am9iSWQsIGhhbmRvZmZJZCA9IG5ldyBVVUlEKDQpLmZvcm1hdCgpLCB3b3JrZXJJZH0pIHtcbiAgICBhd2FpdCB0aGlzLmVuc3VyZVJlYWR5KClcblxuICAgIHJldHVybiBhd2FpdCB0aGlzLl93aXRoRGIoYXN5bmMgKGNvbm5lY3Rpb24pID0+IGF3YWl0IHRoaXMuX211dGF0ZShjb25uZWN0aW9uLCBhc3luYyAoZGIpID0+IHtcbiAgICAgIGNvbnN0IGpvYiA9IGF3YWl0IHRoaXMuX2dldEpvYihkYiwgam9iSWQpXG5cbiAgICAgIGlmICgham9iIHx8IGpvYi5zdGF0dXMgIT09IFwicXVldWVkXCIgfHwgTnVtYmVyKGpvYi5zY2hlZHVsZWRBdE1zKSA+IHRoaXMuY2xvY2subm93KCkpIHJldHVybiBudWxsXG4gICAgICBpZiAoam9iLmNvbmN1cnJlbmN5S2V5ICYmICEoYXdhaXQgdGhpcy5fcmVzZXJ2ZUNvbmN1cnJlbmN5KGRiLCBqb2IuY29uY3VycmVuY3lLZXkpKSkgcmV0dXJuIG51bGxcblxuICAgICAgY29uc3QgaGFuZGVkT2ZmQXRNcyA9IHRoaXMuY2xvY2subm93KClcbiAgICAgIGNvbnN0IGFmZmVjdGVkUm93cyA9IGF3YWl0IHRoaXMuX3VwZGF0ZUFmZmVjdGVkUm93cyhkYiwge1xuICAgICAgICBjb25kaXRpb25zOiB7aWQ6IGpvYklkLCBzdGF0dXM6IFwicXVldWVkXCJ9LFxuICAgICAgICBkYXRhOiB7Li4udGhpcy5fY2xlYXJlZENoaWxkQWNjZXB0YW5jZURhdGEoKSwgaGFuZGVkX29mZl9hdF9tczogaGFuZGVkT2ZmQXRNcywgaGFuZG9mZl9pZDogaGFuZG9mZklkLCBzdGF0dXM6IFwiaGFuZGVkX29mZlwiLCB3b3JrZXJfaWQ6IHdvcmtlcklkIHx8IFwibG9jYWxcIn0sXG4gICAgICAgIHRhYmxlTmFtZTogTE9DQUxfQkFDS0dST1VORF9KT0JTX1RBQkxFXG4gICAgICB9KVxuXG4gICAgICBpZiAoYWZmZWN0ZWRSb3dzICE9PSAxKSB7XG4gICAgICAgIGF3YWl0IHRoaXMuX3JlbGVhc2VDb25jdXJyZW5jeShkYiwgam9iLmNvbmN1cnJlbmN5S2V5KVxuICAgICAgICByZXR1cm4gbnVsbFxuICAgICAgfVxuXG4gICAgICByZXR1cm4ge2hhbmRlZE9mZkF0TXMsIGhhbmRvZmZJZH1cbiAgICB9KSlcbiAgfVxuXG4gIC8qKlxuICAgKiBGaW5kcyBhY3RpdmUgbG9jYWwgaGFuZG9mZnMgb3duZWQgYnkgb25lIHdvcmtlci5cbiAgICogQHBhcmFtIHt7d29ya2VySWQ6IHN0cmluZ319IGFyZ3MgLSBXb3JrZXIgaWRlbnRpdHkuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPEFycmF5PHtqb2JJZDogc3RyaW5nLCBoYW5kb2ZmSWQ6IHN0cmluZ30+Pn0gLSBBY3RpdmUgd29ya2VyIGhhbmRvZmZzLlxuICAgKi9cbiAgYXN5bmMgaGFuZGVkT2ZmSm9ic0Zvcldvcmtlcih7d29ya2VySWR9KSB7XG4gICAgYXdhaXQgdGhpcy5lbnN1cmVSZWFkeSgpXG5cbiAgICBjb25zdCByb3dzID0gYXdhaXQgdGhpcy5fd2l0aERiKGFzeW5jIChkYikgPT4gYXdhaXQgZGJcbiAgICAgIC5uZXdRdWVyeSgpXG4gICAgICAuZnJvbShMT0NBTF9CQUNLR1JPVU5EX0pPQlNfVEFCTEUpXG4gICAgICAud2hlcmUoe3N0YXR1czogXCJoYW5kZWRfb2ZmXCIsIHdvcmtlcl9pZDogd29ya2VySWR9KVxuICAgICAgLnJlc3VsdHMoKSlcbiAgICAvKiogQHR5cGUge0FycmF5PHtqb2JJZDogc3RyaW5nLCBoYW5kb2ZmSWQ6IHN0cmluZ30+fSAqL1xuICAgIGNvbnN0IGhhbmRvZmZzID0gW11cblxuICAgIGZvciAoY29uc3QgcmF3Um93IG9mIHJvd3MpIHtcbiAgICAgIGNvbnN0IGpvYiA9IHRoaXMuX25vcm1hbGl6ZVJvdyhyYXdSb3cpXG5cbiAgICAgIGlmIChqb2IuaGFuZG9mZklkKSBoYW5kb2Zmcy5wdXNoKHtqb2JJZDogam9iLmlkLCBoYW5kb2ZmSWQ6IGpvYi5oYW5kb2ZmSWR9KVxuICAgIH1cblxuICAgIHJldHVybiBoYW5kb2Zmc1xuICB9XG5cbiAgLyoqXG4gICAqIFJldHVybnMgYW4gZXhhY3QgYWN0aXZlIGhhbmRvZmYgdG8gdGhlIHF1ZXVlLlxuICAgKiBAcGFyYW0ge3tqb2JJZDogc3RyaW5nLCBoYW5kb2ZmSWQ6IHN0cmluZ319IGFyZ3MgLSBIYW5kb2ZmIHJlbGVhc2UuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIGFmdGVyIHRoZSBmZW5jZWQgcmVsZWFzZS5cbiAgICovXG4gIGFzeW5jIG1hcmtSZXR1cm5lZFRvUXVldWUoe2pvYklkLCBoYW5kb2ZmSWR9KSB7XG4gICAgYXdhaXQgdGhpcy5lbnN1cmVSZWFkeSgpXG5cbiAgICBhd2FpdCB0aGlzLl93aXRoRGIoYXN5bmMgKGNvbm5lY3Rpb24pID0+IGF3YWl0IHRoaXMuX211dGF0ZShjb25uZWN0aW9uLCBhc3luYyAoZGIpID0+IHtcbiAgICAgIGNvbnN0IGpvYiA9IGF3YWl0IHRoaXMuX2dldEpvYihkYiwgam9iSWQpXG5cbiAgICAgIGlmICghdGhpcy5fYWNjZXB0c0hhbmRvZmYoam9iLCBoYW5kb2ZmSWQpKSByZXR1cm5cbiAgICAgIGF3YWl0IHRoaXMuX2xvY2tDb25jdXJyZW5jeVJvdyhkYiwgam9iLmNvbmN1cnJlbmN5S2V5KVxuXG4gICAgICBjb25zdCBhZmZlY3RlZFJvd3MgPSBhd2FpdCB0aGlzLl91cGRhdGVBZmZlY3RlZFJvd3MoZGIsIHtcbiAgICAgICAgY29uZGl0aW9uczoge2hhbmRvZmZfaWQ6IGhhbmRvZmZJZCwgaWQ6IGpvYklkLCBzdGF0dXM6IFwiaGFuZGVkX29mZlwifSxcbiAgICAgICAgZGF0YToge1xuICAgICAgICAgIC4uLnRoaXMuX2NsZWFyZWRDaGlsZEFjY2VwdGFuY2VEYXRhKCksXG4gICAgICAgICAgaGFuZGVkX29mZl9hdF9tczogbnVsbCxcbiAgICAgICAgICBoYW5kb2ZmX2lkOiBudWxsLFxuICAgICAgICAgIHNjaGVkdWxlZF9hdF9tczogdGhpcy5jbG9jay5ub3coKSxcbiAgICAgICAgICBzdGF0dXM6IFwicXVldWVkXCIsXG4gICAgICAgICAgd29ya2VyX2lkOiBudWxsXG4gICAgICAgIH0sXG4gICAgICAgIHRhYmxlTmFtZTogTE9DQUxfQkFDS0dST1VORF9KT0JTX1RBQkxFXG4gICAgICB9KVxuXG4gICAgICBpZiAoYWZmZWN0ZWRSb3dzID09PSAxKSBhd2FpdCB0aGlzLl9yZWxlYXNlQ29uY3VycmVuY3koZGIsIGpvYi5jb25jdXJyZW5jeUtleSlcbiAgICB9KSlcbiAgfVxuXG4gIC8qKlxuICAgKiBBcHBsaWVzIGEgZmVuY2VkIHN1Y2Nlc3NmdWwgYWNrbm93bGVkZ2VtZW50LlxuICAgKiBAcGFyYW0ge3tqb2JJZDogc3RyaW5nLCBoYW5kb2ZmSWQ/OiBzdHJpbmd9fSBhcmdzIC0gQ29tcGxldGlvbiByZXBvcnQuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPGJvb2xlYW4+fSAtIFdoZXRoZXIgdGhlIGxlYXNlIHdvbi5cbiAgICovXG4gIGFzeW5jIG1hcmtDb21wbGV0ZWQoe2pvYklkLCBoYW5kb2ZmSWR9KSB7XG4gICAgYXdhaXQgdGhpcy5lbnN1cmVSZWFkeSgpXG5cbiAgICByZXR1cm4gYXdhaXQgdGhpcy5fd2l0aERiKGFzeW5jIChjb25uZWN0aW9uKSA9PiBhd2FpdCB0aGlzLl9tdXRhdGUoY29ubmVjdGlvbiwgYXN5bmMgKGRiKSA9PiB7XG4gICAgICBjb25zdCBqb2IgPSBhd2FpdCB0aGlzLl9nZXRKb2IoZGIsIGpvYklkKVxuXG4gICAgICBpZiAoIXRoaXMuX2FjY2VwdHNIYW5kb2ZmKGpvYiwgaGFuZG9mZklkKSkgcmV0dXJuIGZhbHNlXG4gICAgICBhd2FpdCB0aGlzLl9sb2NrQ29uY3VycmVuY3lSb3coZGIsIGpvYi5jb25jdXJyZW5jeUtleSlcblxuICAgICAgY29uc3QgYWZmZWN0ZWRSb3dzID0gYXdhaXQgdGhpcy5fdXBkYXRlQWZmZWN0ZWRSb3dzKGRiLCB7XG4gICAgICAgIGNvbmRpdGlvbnM6IHtoYW5kb2ZmX2lkOiBoYW5kb2ZmSWQsIGlkOiBqb2JJZCwgc3RhdHVzOiBcImhhbmRlZF9vZmZcIn0sXG4gICAgICAgIGRhdGE6IHtjb21wbGV0ZWRfYXRfbXM6IHRoaXMuY2xvY2subm93KCksIHN0YXR1czogXCJjb21wbGV0ZWRcIn0sXG4gICAgICAgIHRhYmxlTmFtZTogTE9DQUxfQkFDS0dST1VORF9KT0JTX1RBQkxFXG4gICAgICB9KVxuXG4gICAgICBpZiAoYWZmZWN0ZWRSb3dzICE9PSAxKSByZXR1cm4gZmFsc2VcbiAgICAgIGF3YWl0IHRoaXMuX3JlbGVhc2VDb25jdXJyZW5jeShkYiwgam9iLmNvbmN1cnJlbmN5S2V5KVxuICAgICAgYXdhaXQgdGhpcy5fcmVsZWFzZVNjaGVkdWxlT3duZXJzaGlwRm9ySm9iKGRiLCBqb2IpXG4gICAgICByZXR1cm4gdHJ1ZVxuICAgIH0pKVxuICB9XG5cbiAgLyoqXG4gICAqIFJlY29yZHMgcG9vbGVkLWNoaWxkIGFjY2VwdGFuY2UgZXZpZGVuY2UgZm9yIGFuIGFjdGl2ZSBoYW5kb2ZmLiBPbmx5IHRoZVxuICAgKiBmaWVsZHMgc3VwcGxpZWQgYXJlIHdyaXR0ZW4sIGZlbmNlZCBieSB0aGUgZXhhY3QgYWN0aXZlIGhhbmRvZmYgbGVhc2UuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gQWNjZXB0YW5jZSByZXBvcnQuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBhcmdzLmpvYklkIC0gSm9iIGlkLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gW2FyZ3MuaGFuZG9mZklkXSAtIEhhbmRvZmYgbGVhc2UgaWQuXG4gICAqIEBwYXJhbSB7bnVtYmVyfSBbYXJncy5yZWNlaXZlZEF0TXNdIC0gRXBvY2ggbXMgdGhlIHJ1bm5lciBjaGlsZCByZWNlaXZlZCB0aGUgam9iLlxuICAgKiBAcGFyYW0ge251bWJlcn0gW2FyZ3Muc3RhcnRlZEF0TXNdIC0gRXBvY2ggbXMgdGhlIGpvYidzIHBlcmZvcm0gc3RhcnRlZCBpbiB0aGUgY2hpbGQuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBbYXJncy5jaGlsZEluc3RhbmNlSWRdIC0gU3RhYmxlIHBvb2xlZCBjaGlsZCBpZGVudGl0eS5cbiAgICogQHBhcmFtIHtudW1iZXJ9IFthcmdzLmNoaWxkUGlkXSAtIFBvb2xlZCBjaGlsZCBPUyBwaWQuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBbYXJncy5ydW5uZXJIb3N0bmFtZV0gLSBIb3N0bmFtZSBvZiB0aGUgbWFjaGluZSBydW5uaW5nIHRoZSBwb29sZWQgY2hpbGQuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPGJvb2xlYW4+fSAtIFdoZXRoZXIgdGhlIGxlYXNlIHdvbi5cbiAgICovXG4gIGFzeW5jIG1hcmtDaGlsZEFjY2VwdGVkKHtqb2JJZCwgaGFuZG9mZklkLCByZWNlaXZlZEF0TXMsIHN0YXJ0ZWRBdE1zLCBjaGlsZEluc3RhbmNlSWQsIGNoaWxkUGlkLCBydW5uZXJIb3N0bmFtZX0pIHtcbiAgICBhd2FpdCB0aGlzLmVuc3VyZVJlYWR5KClcblxuICAgIHJldHVybiBhd2FpdCB0aGlzLl93aXRoRGIoYXN5bmMgKGNvbm5lY3Rpb24pID0+IGF3YWl0IHRoaXMuX211dGF0ZShjb25uZWN0aW9uLCBhc3luYyAoZGIpID0+IHtcbiAgICAgIGNvbnN0IGpvYiA9IGF3YWl0IHRoaXMuX2dldEpvYihkYiwgam9iSWQpXG5cbiAgICAgIGlmICghdGhpcy5fYWNjZXB0c0hhbmRvZmYoam9iLCBoYW5kb2ZmSWQpKSByZXR1cm4gZmFsc2VcblxuICAgICAgY29uc3QgZGF0YSA9IHt9XG4gICAgICBpZiAodHlwZW9mIHJlY2VpdmVkQXRNcyA9PT0gXCJudW1iZXJcIikgZGF0YS5jaGlsZF9yZWNlaXZlZF9hdF9tcyA9IHJlY2VpdmVkQXRNc1xuICAgICAgaWYgKHR5cGVvZiBzdGFydGVkQXRNcyA9PT0gXCJudW1iZXJcIikgZGF0YS5jaGlsZF9zdGFydGVkX2F0X21zID0gc3RhcnRlZEF0TXNcbiAgICAgIGlmICh0eXBlb2YgY2hpbGRJbnN0YW5jZUlkID09PSBcInN0cmluZ1wiKSBkYXRhLmNoaWxkX2luc3RhbmNlX2lkID0gY2hpbGRJbnN0YW5jZUlkXG4gICAgICBpZiAodHlwZW9mIGNoaWxkUGlkID09PSBcIm51bWJlclwiKSBkYXRhLmNoaWxkX3BpZCA9IGNoaWxkUGlkXG4gICAgICBpZiAodHlwZW9mIHJ1bm5lckhvc3RuYW1lID09PSBcInN0cmluZ1wiKSBkYXRhLnJ1bm5lcl9ob3N0bmFtZSA9IHJ1bm5lckhvc3RuYW1lXG4gICAgICBpZiAoT2JqZWN0LmtleXMoZGF0YSkubGVuZ3RoID09PSAwKSByZXR1cm4gZmFsc2VcblxuICAgICAgY29uc3QgYWZmZWN0ZWRSb3dzID0gYXdhaXQgdGhpcy5fdXBkYXRlQWZmZWN0ZWRSb3dzKGRiLCB7XG4gICAgICAgIGNvbmRpdGlvbnM6IHtoYW5kb2ZmX2lkOiBoYW5kb2ZmSWQsIGlkOiBqb2JJZCwgc3RhdHVzOiBcImhhbmRlZF9vZmZcIn0sXG4gICAgICAgIGRhdGEsXG4gICAgICAgIHRhYmxlTmFtZTogTE9DQUxfQkFDS0dST1VORF9KT0JTX1RBQkxFXG4gICAgICB9KVxuXG4gICAgICByZXR1cm4gYWZmZWN0ZWRSb3dzID09PSAxXG4gICAgfSkpXG4gIH1cblxuICAvKipcbiAgICogQXBwbGllcyBhIGZlbmNlZCByZXNjaGVkdWxlIHdpdGhvdXQgY29uc3VtaW5nIGFuIGF0dGVtcHQuXG4gICAqIEBwYXJhbSB7e2pvYklkOiBzdHJpbmcsIGhhbmRvZmZJZD86IHN0cmluZywgZGVsYXlNczogbnVtYmVyfX0gYXJncyAtIFJlc2NoZWR1bGUgcmVwb3J0LlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxib29sZWFuPn0gLSBXaGV0aGVyIHRoZSBsZWFzZSB3b24uXG4gICAqL1xuICBhc3luYyBtYXJrUmVzY2hlZHVsZWQoe2pvYklkLCBoYW5kb2ZmSWQsIGRlbGF5TXN9KSB7XG4gICAgYXdhaXQgdGhpcy5lbnN1cmVSZWFkeSgpXG5cbiAgICByZXR1cm4gYXdhaXQgdGhpcy5fd2l0aERiKGFzeW5jIChjb25uZWN0aW9uKSA9PiBhd2FpdCB0aGlzLl9tdXRhdGUoY29ubmVjdGlvbiwgYXN5bmMgKGRiKSA9PiB7XG4gICAgICBjb25zdCBqb2IgPSBhd2FpdCB0aGlzLl9nZXRKb2IoZGIsIGpvYklkKVxuXG4gICAgICBpZiAoIXRoaXMuX2FjY2VwdHNIYW5kb2ZmKGpvYiwgaGFuZG9mZklkKSkgcmV0dXJuIGZhbHNlXG4gICAgICBhd2FpdCB0aGlzLl9sb2NrQ29uY3VycmVuY3lSb3coZGIsIGpvYi5jb25jdXJyZW5jeUtleSlcblxuICAgICAgY29uc3QgYWZmZWN0ZWRSb3dzID0gYXdhaXQgdGhpcy5fdXBkYXRlQWZmZWN0ZWRSb3dzKGRiLCB7XG4gICAgICAgIGNvbmRpdGlvbnM6IHtoYW5kb2ZmX2lkOiBoYW5kb2ZmSWQsIGlkOiBqb2JJZCwgc3RhdHVzOiBcImhhbmRlZF9vZmZcIn0sXG4gICAgICAgIGRhdGE6IHtcbiAgICAgICAgICAuLi50aGlzLl9jbGVhcmVkQ2hpbGRBY2NlcHRhbmNlRGF0YSgpLFxuICAgICAgICAgIGhhbmRlZF9vZmZfYXRfbXM6IG51bGwsXG4gICAgICAgICAgaGFuZG9mZl9pZDogbnVsbCxcbiAgICAgICAgICBzY2hlZHVsZWRfYXRfbXM6IHJlc2NoZWR1bGVkQmFja2dyb3VuZEpvYkF0TXMoZGVsYXlNcywgdGhpcy5jbG9jay5ub3coKSksXG4gICAgICAgICAgc3RhdHVzOiBcInF1ZXVlZFwiLFxuICAgICAgICAgIHdvcmtlcl9pZDogbnVsbFxuICAgICAgICB9LFxuICAgICAgICB0YWJsZU5hbWU6IExPQ0FMX0JBQ0tHUk9VTkRfSk9CU19UQUJMRVxuICAgICAgfSlcblxuICAgICAgaWYgKGFmZmVjdGVkUm93cyAhPT0gMSkgcmV0dXJuIGZhbHNlXG4gICAgICBhd2FpdCB0aGlzLl9yZWxlYXNlQ29uY3VycmVuY3koZGIsIGpvYi5jb25jdXJyZW5jeUtleSlcbiAgICAgIHJldHVybiB0cnVlXG4gICAgfSkpXG4gIH1cblxuICAvKipcbiAgICogQXBwbGllcyBhIGZlbmNlZCBmYWlsdXJlLCByZXRyeSwgb3IgdGVybWluYWwgdHJhbnNpdGlvbi5cbiAgICogQHBhcmFtIHt7am9iSWQ6IHN0cmluZywgaGFuZG9mZklkPzogc3RyaW5nLCBlcnJvcjogUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59fSBhcmdzIC0gRmFpbHVyZSByZXBvcnQuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPGltcG9ydChcIi4vdHlwZXMuanNcIikuQmFja2dyb3VuZEpvYlJvdyB8IG51bGw+fSAtIEFjY2VwdGVkIHRyYW5zaXRpb24gc25hcHNob3QuXG4gICAqL1xuICBhc3luYyBtYXJrRmFpbGVkKHtqb2JJZCwgaGFuZG9mZklkLCBlcnJvcn0pIHtcbiAgICBhd2FpdCB0aGlzLmVuc3VyZVJlYWR5KClcblxuICAgIHJldHVybiBhd2FpdCB0aGlzLl93aXRoRGIoYXN5bmMgKGNvbm5lY3Rpb24pID0+IGF3YWl0IHRoaXMuX211dGF0ZShjb25uZWN0aW9uLCBhc3luYyAoZGIpID0+IHtcbiAgICAgIGNvbnN0IGpvYiA9IGF3YWl0IHRoaXMuX2dldEpvYihkYiwgam9iSWQpXG5cbiAgICAgIGlmICghdGhpcy5fYWNjZXB0c0hhbmRvZmYoam9iLCBoYW5kb2ZmSWQpKSByZXR1cm4gbnVsbFxuXG4gICAgICByZXR1cm4gYXdhaXQgdGhpcy5fYXBwbHlGYWlsdXJlKGRiLCBqb2IsIGVycm9yKVxuICAgIH0pKVxuICB9XG5cbiAgLyoqXG4gICAqIFR1cm5zIGV2ZXJ5IGFiYW5kb25lZCBsb2NhbCBoYW5kb2ZmIGludG8gdGhlIG5vcm1hbCBmYWlsdXJlL3JldHJ5IHBhdGguXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPGltcG9ydChcIi4vdHlwZXMuanNcIikuQmFja2dyb3VuZEpvYlJvd1tdPn0gLSBSZWNvdmVyZWQgdHJhbnNpdGlvbnMuXG4gICAqL1xuICBhc3luYyByZWNvdmVySGFuZGVkT2ZmSm9icygpIHtcbiAgICBhd2FpdCB0aGlzLmVuc3VyZVJlYWR5KClcblxuICAgIHJldHVybiBhd2FpdCB0aGlzLl93aXRoRGIoYXN5bmMgKGNvbm5lY3Rpb24pID0+IGF3YWl0IHRoaXMuX211dGF0ZShjb25uZWN0aW9uLCBhc3luYyAoZGIpID0+IHtcbiAgICAgIGNvbnN0IHF1ZXVlcyA9IHRoaXMuY29uZmlndXJhdGlvbi5nZXRCYWNrZ3JvdW5kSm9ic0NvbmZpZygpLnF1ZXVlc1xuICAgICAgY29uc3Qgcm93cyA9IGF3YWl0IGRiLm5ld1F1ZXJ5KCkuZnJvbShMT0NBTF9CQUNLR1JPVU5EX0pPQlNfVEFCTEUpLndoZXJlKHtzdGF0dXM6IFwiaGFuZGVkX29mZlwifSkucmVzdWx0cygpXG4gICAgICAvKiogQHR5cGUge2ltcG9ydChcIi4vdHlwZXMuanNcIikuQmFja2dyb3VuZEpvYlJvd1tdfSAqL1xuICAgICAgY29uc3QgcmVjb3ZlcmVkID0gW11cblxuICAgICAgZm9yIChjb25zdCByYXdSb3cgb2Ygcm93cykge1xuICAgICAgICBjb25zdCBqb2IgPSB0aGlzLl9ub3JtYWxpemVSb3cocmF3Um93KVxuICAgICAgICBjb25zdCB1cGRhdGVkID0gYXdhaXQgdGhpcy5fYXBwbHlGYWlsdXJlKGRiLCBqb2IsIG5ldyBFcnJvcihcIkxvY2FsIGJhY2tncm91bmQgam9iIHJlY292ZXJlZCBhZnRlciBhbiBpbnRlcnJ1cHRlZCBkaXNwYXRjaGVyXCIpKVxuXG4gICAgICAgIGlmICghdXBkYXRlZCkgY29udGludWVcblxuICAgICAgICBjb25zdCByZWNvbmNpbGVkID0gdXBkYXRlZC5zdGF0dXMgPT09IFwicXVldWVkXCJcbiAgICAgICAgICA/IGF3YWl0IHRoaXMuX3JlY29uY2lsZVF1ZXVlZEpvYkNvbmN1cnJlbmN5KGRiLCB1cGRhdGVkLCBxdWV1ZXMpXG4gICAgICAgICAgOiB1cGRhdGVkXG5cbiAgICAgICAgcmVjb3ZlcmVkLnB1c2gocmVjb25jaWxlZClcbiAgICAgIH1cblxuICAgICAgYXdhaXQgdGhpcy5fcmVidWlsZENvbmN1cnJlbmN5Q291bnRzKGRiKVxuICAgICAgcmV0dXJuIHJlY292ZXJlZFxuICAgIH0pKVxuICB9XG5cbiAgLyoqXG4gICAqIERlbGV0ZXMgbG9jYWwgcXVldWUgc3RhdGUgZm9yIGZvY3VzZWQgdGVzdHMuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIGFmdGVyIGRlbGV0aW9uLlxuICAgKi9cbiAgYXN5bmMgY2xlYXJBbGwoKSB7XG4gICAgYXdhaXQgdGhpcy5lbnN1cmVSZWFkeSgpXG4gICAgYXdhaXQgdGhpcy5fd2l0aERiKGFzeW5jIChjb25uZWN0aW9uKSA9PiBhd2FpdCB0aGlzLl9tdXRhdGUoY29ubmVjdGlvbiwgYXN5bmMgKGRiKSA9PiB7XG4gICAgICBhd2FpdCBkYi5xdWVyeShgREVMRVRFIEZST00gJHtkYi5xdW90ZVRhYmxlKExPQ0FMX0JBQ0tHUk9VTkRfSk9CX1NDSEVEVUxFX0tFWVNfVEFCTEUpfWApXG4gICAgICBhd2FpdCBkYi5xdWVyeShgREVMRVRFIEZST00gJHtkYi5xdW90ZVRhYmxlKExPQ0FMX0JBQ0tHUk9VTkRfSk9CU19UQUJMRSl9YClcbiAgICAgIGF3YWl0IGRiLnF1ZXJ5KGBERUxFVEUgRlJPTSAke2RiLnF1b3RlVGFibGUoTE9DQUxfQkFDS0dST1VORF9KT0JfQ09OQ1VSUkVOQ1lfVEFCTEUpfWApXG4gICAgfSkpXG4gIH1cblxuICAvKipcbiAgICogQXBwbGllcyB0aGUgY29tbW9uIHJldHJ5IG9yIGV4aGF1c3RlZCBmYWlsdXJlIHRyYW5zaXRpb24uXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vZGF0YWJhc2UvZHJpdmVycy9iYXNlLmpzXCIpLmRlZmF1bHR9IGRiIC0gTG9jYWwgU1FMaXRlIGNvbm5lY3Rpb24uXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi90eXBlcy5qc1wiKS5CYWNrZ3JvdW5kSm9iUm93fSBqb2IgLSBBY3RpdmUgaGFuZG9mZi5cbiAgICogQHBhcmFtIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gZXJyb3IgLSBQZXJmb3JtYW5jZSBlcnJvci5cbiAgICogQHJldHVybnMge1Byb21pc2U8aW1wb3J0KFwiLi90eXBlcy5qc1wiKS5CYWNrZ3JvdW5kSm9iUm93IHwgbnVsbD59IC0gVHJhbnNpdGlvbiBzbmFwc2hvdC5cbiAgICovXG4gIGFzeW5jIF9hcHBseUZhaWx1cmUoZGIsIGpvYiwgZXJyb3IpIHtcbiAgICBjb25zdCBhdHRlbXB0cyA9IChqb2IuYXR0ZW1wdHMgfHwgMCkgKyAxXG4gICAgY29uc3QgbWF4UmV0cmllcyA9IG5vcm1hbGl6ZUJhY2tncm91bmRKb2JNYXhSZXRyaWVzKGpvYi5tYXhSZXRyaWVzKVxuICAgIGNvbnN0IHdpbGxSZXRyeSA9IGF0dGVtcHRzIDw9IG1heFJldHJpZXNcbiAgICBjb25zdCBub3dNcyA9IHRoaXMuY2xvY2subm93KClcbiAgICAvKiogQHR5cGUge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gKi9cbiAgICBjb25zdCBkYXRhID0ge1xuICAgICAgYXR0ZW1wdHMsXG4gICAgICBoYW5kZWRfb2ZmX2F0X21zOiBudWxsLFxuICAgICAgaGFuZG9mZl9pZDogbnVsbCxcbiAgICAgIGxhc3RfZXJyb3I6IG5vcm1hbGl6ZUJhY2tncm91bmRKb2JFcnJvcihlcnJvciksXG4gICAgICBzdGF0dXM6IHdpbGxSZXRyeSA/IFwicXVldWVkXCIgOiBcImZhaWxlZFwiLFxuICAgICAgd29ya2VyX2lkOiBudWxsXG4gICAgfVxuXG4gICAgaWYgKHdpbGxSZXRyeSkge1xuICAgICAgLy8gQSByZXRyeSBzdGFydHMgYSBmcmVzaCBoYW5kb2ZmIHdpdGggYSBwb3NzaWJseSBkaWZmZXJlbnQgcnVubmVyLCBzbyB0aGVcbiAgICAgIC8vIHByZXZpb3VzIGNoaWxkJ3MgYWNjZXB0YW5jZSBldmlkZW5jZSBtdXN0IG5vdCBsZWFrIGludG8gdGhlIG5leHQgYXR0ZW1wdC5cbiAgICAgIE9iamVjdC5hc3NpZ24oZGF0YSwge3NjaGVkdWxlZF9hdF9tczogbm93TXMgKyByZXRyeURlbGF5TXMoYXR0ZW1wdHMpLCAuLi50aGlzLl9jbGVhcmVkQ2hpbGRBY2NlcHRhbmNlRGF0YSgpfSlcbiAgICB9IGVsc2Uge1xuICAgICAgT2JqZWN0LmFzc2lnbihkYXRhLCB7ZmFpbGVkX2F0X21zOiBub3dNc30pXG4gICAgfVxuXG4gICAgYXdhaXQgdGhpcy5fbG9ja0NvbmN1cnJlbmN5Um93KGRiLCBqb2IuY29uY3VycmVuY3lLZXkpXG4gICAgY29uc3QgYWZmZWN0ZWRSb3dzID0gYXdhaXQgdGhpcy5fdXBkYXRlQWZmZWN0ZWRSb3dzKGRiLCB7XG4gICAgICBjb25kaXRpb25zOiB7aGFuZG9mZl9pZDogam9iLmhhbmRvZmZJZCwgaWQ6IGpvYi5pZCwgc3RhdHVzOiBcImhhbmRlZF9vZmZcIn0sXG4gICAgICBkYXRhLFxuICAgICAgdGFibGVOYW1lOiBMT0NBTF9CQUNLR1JPVU5EX0pPQlNfVEFCTEVcbiAgICB9KVxuXG4gICAgaWYgKGFmZmVjdGVkUm93cyAhPT0gMSkgcmV0dXJuIG51bGxcbiAgICBhd2FpdCB0aGlzLl9yZWxlYXNlQ29uY3VycmVuY3koZGIsIGpvYi5jb25jdXJyZW5jeUtleSlcbiAgICBpZiAoIXdpbGxSZXRyeSkgYXdhaXQgdGhpcy5fcmVsZWFzZVNjaGVkdWxlT3duZXJzaGlwRm9ySm9iKGRiLCBqb2IpXG5cbiAgICByZXR1cm4ge1xuICAgICAgLi4uam9iLFxuICAgICAgLi4uKHdpbGxSZXRyeSA/IHRoaXMuX2NsZWFyZWRDaGlsZEFjY2VwdGFuY2VSb3coKSA6IHt9KSxcbiAgICAgIGF0dGVtcHRzLFxuICAgICAgZmFpbGVkQXRNczogd2lsbFJldHJ5ID8gam9iLmZhaWxlZEF0TXMgOiBub3dNcyxcbiAgICAgIGhhbmRlZE9mZkF0TXM6IG51bGwsXG4gICAgICBoYW5kb2ZmSWQ6IG51bGwsXG4gICAgICBsYXN0RXJyb3I6IGRhdGEubGFzdF9lcnJvcixcbiAgICAgIHNjaGVkdWxlZEF0TXM6IHdpbGxSZXRyeSA/IE51bWJlcihkYXRhLnNjaGVkdWxlZF9hdF9tcykgOiBqb2Iuc2NoZWR1bGVkQXRNcyxcbiAgICAgIHN0YXR1czogZGF0YS5zdGF0dXMsXG4gICAgICB3b3JrZXJJZDogbnVsbFxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBSZXR1cm5zIHRoZSBkYXRhYmFzZSBkYXRhIHRoYXQgY2xlYXJzIHBvb2xlZC1jaGlsZCBhY2NlcHRhbmNlIGV2aWRlbmNlLlxuICAgKiBAcmV0dXJucyB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSAtIENsZWFyZWQgYWNjZXB0YW5jZSBjb2x1bW5zLlxuICAgKi9cbiAgX2NsZWFyZWRDaGlsZEFjY2VwdGFuY2VEYXRhKCkge1xuICAgIHJldHVybiB7Y2hpbGRfaW5zdGFuY2VfaWQ6IG51bGwsIGNoaWxkX3BpZDogbnVsbCwgY2hpbGRfcmVjZWl2ZWRfYXRfbXM6IG51bGwsIGNoaWxkX3N0YXJ0ZWRfYXRfbXM6IG51bGwsIHJ1bm5lcl9ob3N0bmFtZTogbnVsbH1cbiAgfVxuXG4gIC8qKlxuICAgKiBSZXR1cm5zIHRoZSByb3ctc2hhcGUgY291bnRlcnBhcnQgb2YgdGhlIGNsZWFyZWQgYWNjZXB0YW5jZSBjb2x1bW5zLlxuICAgKiBAcmV0dXJucyB7UGljazxpbXBvcnQoXCIuL3R5cGVzLmpzXCIpLkJhY2tncm91bmRKb2JSb3csIFwiY2hpbGRJbnN0YW5jZUlkXCIgfCBcImNoaWxkUGlkXCIgfCBcImNoaWxkUmVjZWl2ZWRBdE1zXCIgfCBcImNoaWxkU3RhcnRlZEF0TXNcIiB8IFwicnVubmVySG9zdG5hbWVcIj59IC0gQ2xlYXJlZCBhY2NlcHRhbmNlIGZpZWxkcy5cbiAgICovXG4gIF9jbGVhcmVkQ2hpbGRBY2NlcHRhbmNlUm93KCkge1xuICAgIHJldHVybiB7Y2hpbGRJbnN0YW5jZUlkOiBudWxsLCBjaGlsZFBpZDogbnVsbCwgY2hpbGRSZWNlaXZlZEF0TXM6IG51bGwsIGNoaWxkU3RhcnRlZEF0TXM6IG51bGwsIHJ1bm5lckhvc3RuYW1lOiBudWxsfVxuICB9XG5cbiAgLyoqXG4gICAqIEVuc3VyZXMgdGhhdCBhIGR1cmFibGUgY29uY3VycmVuY3kgY291bnRlciBleGlzdHMgd2l0aCB0aGUgcmVxdWlyZWQgY2FwLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL2RhdGFiYXNlL2RyaXZlcnMvYmFzZS5qc1wiKS5kZWZhdWx0fSBkYiAtIExvY2FsIFNRTGl0ZSBjb25uZWN0aW9uLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vdHlwZXMuanNcIikuUmVzb2x2ZWRCYWNrZ3JvdW5kSm9iQ29uY3VycmVuY3l9IGNvbmN1cnJlbmN5IC0gRGVzaXJlZCBjb3VudGVyLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyB3aGVuIGVuc3VyZWQuXG4gICAqL1xuICBhc3luYyBfZW5zdXJlQ29uY3VycmVuY3koZGIsIGNvbmN1cnJlbmN5KSB7XG4gICAgYXdhaXQgZGIudXBzZXJ0KHtcbiAgICAgIGNvbmZsaWN0Q29sdW1uczogW1wiY29uY3VycmVuY3lfa2V5XCJdLFxuICAgICAgZGF0YToge2FjdGl2ZV9jb3VudDogMCwgY29uY3VycmVuY3lfa2V5OiBjb25jdXJyZW5jeS5jb25jdXJyZW5jeUtleSwgbWF4X2NvbmN1cnJlbmN5OiBjb25jdXJyZW5jeS5tYXhDb25jdXJyZW5jeX0sXG4gICAgICB0YWJsZU5hbWU6IExPQ0FMX0JBQ0tHUk9VTkRfSk9CX0NPTkNVUlJFTkNZX1RBQkxFLFxuICAgICAgdXBkYXRlQ29sdW1uczogW1wiY29uY3VycmVuY3lfa2V5XCJdXG4gICAgfSlcblxuICAgIGNvbnN0IHJvd3MgPSBhd2FpdCBkYlxuICAgICAgLm5ld1F1ZXJ5KClcbiAgICAgIC5mcm9tKExPQ0FMX0JBQ0tHUk9VTkRfSk9CX0NPTkNVUlJFTkNZX1RBQkxFKVxuICAgICAgLndoZXJlKHtjb25jdXJyZW5jeV9rZXk6IGNvbmN1cnJlbmN5LmNvbmN1cnJlbmN5S2V5fSlcbiAgICAgIC5saW1pdCgxKVxuICAgICAgLnJlc3VsdHMoKVxuXG4gICAgY29uc3QgZXhpc3RpbmdSb3cgPSAvKiogQHR5cGUge3ttYXhfY29uY3VycmVuY3k6IG51bWJlciB8IHN0cmluZ319ICovIChyb3dzWzBdKVxuICAgIGNvbnN0IGV4aXN0aW5nQ2FwID0gTnVtYmVyKGV4aXN0aW5nUm93Lm1heF9jb25jdXJyZW5jeSlcblxuICAgIGlmIChleGlzdGluZ0NhcCA9PT0gY29uY3VycmVuY3kubWF4Q29uY3VycmVuY3kpIHJldHVyblxuICAgIGlmICghY29uY3VycmVuY3kucXVldWVEZXJpdmVkKSB0aHJvdyBuZXcgRXJyb3IoYENvbmZsaWN0aW5nIG1heENvbmN1cnJlbmN5IGZvciBiYWNrZ3JvdW5kIGpvYiBjb25jdXJyZW5jeUtleTogJHtjb25jdXJyZW5jeS5jb25jdXJyZW5jeUtleX1gKVxuXG4gICAgYXdhaXQgZGIudXBkYXRlKHtcbiAgICAgIGNvbmRpdGlvbnM6IHtjb25jdXJyZW5jeV9rZXk6IGNvbmN1cnJlbmN5LmNvbmN1cnJlbmN5S2V5fSxcbiAgICAgIGRhdGE6IHttYXhfY29uY3VycmVuY3k6IGNvbmN1cnJlbmN5Lm1heENvbmN1cnJlbmN5fSxcbiAgICAgIHRhYmxlTmFtZTogTE9DQUxfQkFDS0dST1VORF9KT0JfQ09OQ1VSUkVOQ1lfVEFCTEVcbiAgICB9KVxuICB9XG5cbiAgLyoqXG4gICAqIEF0b21pY2FsbHkgcmVzZXJ2ZXMgb25lIHNsb3QgZm9yIGEgY29uY3VycmVuY3kga2V5LlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL2RhdGFiYXNlL2RyaXZlcnMvYmFzZS5qc1wiKS5kZWZhdWx0fSBkYiAtIENvbm5lY3Rpb24uXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBjb25jdXJyZW5jeUtleSAtIENvbmN1cnJlbmN5IGtleS5cbiAgICogQHJldHVybnMge1Byb21pc2U8Ym9vbGVhbj59IC0gV2hldGhlciBhIHNsb3Qgd2FzIHJlc2VydmVkLlxuICAgKi9cbiAgYXN5bmMgX3Jlc2VydmVDb25jdXJyZW5jeShkYiwgY29uY3VycmVuY3lLZXkpIHtcbiAgICBjb25zdCB0YWJsZSA9IGRiLnF1b3RlVGFibGUoTE9DQUxfQkFDS0dST1VORF9KT0JfQ09OQ1VSUkVOQ1lfVEFCTEUpXG4gICAgY29uc3QgY291bnQgPSBkYi5xdW90ZUNvbHVtbihcImFjdGl2ZV9jb3VudFwiKVxuICAgIGNvbnN0IGFmZmVjdGVkUm93cyA9IGF3YWl0IGRiLmFmZmVjdGVkUm93cyhcbiAgICAgIGBVUERBVEUgJHt0YWJsZX0gU0VUICR7Y291bnR9ID0gJHtjb3VudH0gKyAxIGAgK1xuICAgICAgYFdIRVJFICR7ZGIucXVvdGVDb2x1bW4oXCJjb25jdXJyZW5jeV9rZXlcIil9ID0gJHtkYi5xdW90ZShjb25jdXJyZW5jeUtleSl9IGAgK1xuICAgICAgYEFORCAke2NvdW50fSA8ICR7ZGIucXVvdGVDb2x1bW4oXCJtYXhfY29uY3VycmVuY3lcIil9YFxuICAgIClcblxuICAgIHJldHVybiBhZmZlY3RlZFJvd3MgPT09IDFcbiAgfVxuXG4gIC8qKlxuICAgKiBSZWxlYXNlcyBvbmUgc2xvdCBmb3IgYSBjb25jdXJyZW5jeSBrZXkuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vZGF0YWJhc2UvZHJpdmVycy9iYXNlLmpzXCIpLmRlZmF1bHR9IGRiIC0gQ29ubmVjdGlvbi5cbiAgICogQHBhcmFtIHtzdHJpbmcgfCBudWxsfSBjb25jdXJyZW5jeUtleSAtIENvbmN1cnJlbmN5IGtleS5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgYWZ0ZXIgcmVsZWFzZS5cbiAgICovXG4gIGFzeW5jIF9yZWxlYXNlQ29uY3VycmVuY3koZGIsIGNvbmN1cnJlbmN5S2V5KSB7XG4gICAgaWYgKCFjb25jdXJyZW5jeUtleSkgcmV0dXJuXG5cbiAgICBjb25zdCB0YWJsZSA9IGRiLnF1b3RlVGFibGUoTE9DQUxfQkFDS0dST1VORF9KT0JfQ09OQ1VSUkVOQ1lfVEFCTEUpXG4gICAgY29uc3QgY291bnQgPSBkYi5xdW90ZUNvbHVtbihcImFjdGl2ZV9jb3VudFwiKVxuXG4gICAgYXdhaXQgZGIuYWZmZWN0ZWRSb3dzKFxuICAgICAgYFVQREFURSAke3RhYmxlfSBTRVQgJHtjb3VudH0gPSAke2NvdW50fSAtIDEgYCArXG4gICAgICBgV0hFUkUgJHtkYi5xdW90ZUNvbHVtbihcImNvbmN1cnJlbmN5X2tleVwiKX0gPSAke2RiLnF1b3RlKGNvbmN1cnJlbmN5S2V5KX0gQU5EICR7Y291bnR9ID4gMGBcbiAgICApXG4gIH1cblxuICAvKipcbiAgICogQWNxdWlyZXMgdGhlIHRyYW5zYWN0aW9uJ3Mgd3JpdGUgbG9jayBmb3IgYSBjb25jdXJyZW5jeSBjb3VudGVyIHJvdy5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9kYXRhYmFzZS9kcml2ZXJzL2Jhc2UuanNcIikuZGVmYXVsdH0gZGIgLSBDb25uZWN0aW9uLlxuICAgKiBAcGFyYW0ge3N0cmluZyB8IG51bGx9IGNvbmN1cnJlbmN5S2V5IC0gQ29uY3VycmVuY3kga2V5LlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyBhZnRlciBsb2NraW5nLlxuICAgKi9cbiAgYXN5bmMgX2xvY2tDb25jdXJyZW5jeVJvdyhkYiwgY29uY3VycmVuY3lLZXkpIHtcbiAgICBpZiAoIWNvbmN1cnJlbmN5S2V5KSByZXR1cm5cblxuICAgIGNvbnN0IHRhYmxlID0gZGIucXVvdGVUYWJsZShMT0NBTF9CQUNLR1JPVU5EX0pPQl9DT05DVVJSRU5DWV9UQUJMRSlcbiAgICBjb25zdCBjb3VudCA9IGRiLnF1b3RlQ29sdW1uKFwiYWN0aXZlX2NvdW50XCIpXG5cbiAgICBhd2FpdCBkYi5xdWVyeShcbiAgICAgIGBVUERBVEUgJHt0YWJsZX0gU0VUICR7Y291bnR9ID0gJHtjb3VudH0gYCArXG4gICAgICBgV0hFUkUgJHtkYi5xdW90ZUNvbHVtbihcImNvbmN1cnJlbmN5X2tleVwiKX0gPSAke2RiLnF1b3RlKGNvbmN1cnJlbmN5S2V5KX1gXG4gICAgKVxuICB9XG5cbiAgLyoqXG4gICAqIFJlYnVpbGRzIGFjdGl2ZSBjb3VudGVycyBmcm9tIGR1cmFibGUgaGFuZGVkLW9mZiBqb2JzLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL2RhdGFiYXNlL2RyaXZlcnMvYmFzZS5qc1wiKS5kZWZhdWx0fSBkYiAtIENvbm5lY3Rpb24uXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIGFmdGVyIGNvdW50ZXIgcmVidWlsZC5cbiAgICovXG4gIGFzeW5jIF9yZWJ1aWxkQ29uY3VycmVuY3lDb3VudHMoZGIpIHtcbiAgICBjb25zdCBjb25jdXJyZW5jeVRhYmxlID0gZGIucXVvdGVUYWJsZShMT0NBTF9CQUNLR1JPVU5EX0pPQl9DT05DVVJSRU5DWV9UQUJMRSlcbiAgICBjb25zdCBqb2JzVGFibGUgPSBkYi5xdW90ZVRhYmxlKExPQ0FMX0JBQ0tHUk9VTkRfSk9CU19UQUJMRSlcblxuICAgIGF3YWl0IGRiLnF1ZXJ5KFxuICAgICAgYFVQREFURSAke2NvbmN1cnJlbmN5VGFibGV9IFNFVCAke2RiLnF1b3RlQ29sdW1uKFwiYWN0aXZlX2NvdW50XCIpfSA9IChgICtcbiAgICAgIGBTRUxFQ1QgQ09VTlQoKikgRlJPTSAke2pvYnNUYWJsZX0gV0hFUkUgJHtqb2JzVGFibGV9LiR7ZGIucXVvdGVDb2x1bW4oXCJzdGF0dXNcIil9ID0gJHtkYi5xdW90ZShcImhhbmRlZF9vZmZcIil9IEFORCBgICtcbiAgICAgIGAke2pvYnNUYWJsZX0uJHtkYi5xdW90ZUNvbHVtbihcImNvbmN1cnJlbmN5X2tleVwiKX0gPSAke2NvbmN1cnJlbmN5VGFibGV9LiR7ZGIucXVvdGVDb2x1bW4oXCJjb25jdXJyZW5jeV9rZXlcIil9KWBcbiAgICApXG4gIH1cblxuICAvKipcbiAgICogQnVpbGRzIHRoZSBjb25maWd1cmVkIHF1ZXVlLXByaW9yaXR5IG9yZGVyaW5nIGV4cHJlc3Npb24uXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vZGF0YWJhc2UvZHJpdmVycy9iYXNlLmpzXCIpLmRlZmF1bHR9IGRiIC0gQ29ubmVjdGlvbi5cbiAgICogQHJldHVybnMge3N0cmluZyB8IG51bGx9IC0gUXVldWUgcHJpb3JpdHkgZXhwcmVzc2lvbi5cbiAgICovXG4gIF9xdWV1ZVByaW9yaXR5T3JkZXJTcWwoZGIpIHtcbiAgICBjb25zdCBxdWV1ZXMgPSB0aGlzLmNvbmZpZ3VyYXRpb24uZ2V0QmFja2dyb3VuZEpvYnNDb25maWcoKS5xdWV1ZXNcbiAgICBjb25zdCBwcmlvcml0aXplZCA9IE9iamVjdC5lbnRyaWVzKHF1ZXVlcylcbiAgICAgIC5maWx0ZXIoKFssIHF1ZXVlXSkgPT4gTnVtYmVyLmlzRmluaXRlKHF1ZXVlPy5wcmlvcml0eSkgJiYgTnVtYmVyKHF1ZXVlLnByaW9yaXR5KSAhPT0gMClcbiAgICAgIC5tYXAoKFtxdWV1ZU5hbWUsIHF1ZXVlXSkgPT4gW3F1ZXVlTmFtZSwgTnVtYmVyKHF1ZXVlLnByaW9yaXR5KV0pXG5cbiAgICBpZiAocHJpb3JpdGl6ZWQubGVuZ3RoID09PSAwKSByZXR1cm4gbnVsbFxuXG4gICAgY29uc3Qgd2hlbnMgPSBwcmlvcml0aXplZFxuICAgICAgLm1hcCgoW3F1ZXVlLCBwcmlvcml0eV0pID0+IGBXSEVOICR7ZGIucXVvdGUocXVldWUpfSBUSEVOICR7cHJpb3JpdHl9YClcbiAgICAgIC5qb2luKFwiIFwiKVxuXG4gICAgcmV0dXJuIGBDQVNFIENPQUxFU0NFKCR7ZGIucXVvdGVDb2x1bW4oXCJxdWV1ZVwiKX0sICR7ZGIucXVvdGUoREVGQVVMVF9CQUNLR1JPVU5EX0pPQl9RVUVVRSl9KSAke3doZW5zfSBFTFNFIDAgRU5EYFxuICB9XG5cbiAgLyoqXG4gICAqIENoZWNrcyB3aGV0aGVyIGEgcGVyc2lzdGVkIGhhbmRvZmYgb3ducyB0aGUgc3VwcGxpZWQgYWNrbm93bGVkZ2VtZW50IGZlbmNlLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vdHlwZXMuanNcIikuQmFja2dyb3VuZEpvYlJvdyB8IG51bGx9IGpvYiAtIFBlcnNpc3RlZCBqb2IuXG4gICAqIEBwYXJhbSB7c3RyaW5nIHwgdW5kZWZpbmVkfSBoYW5kb2ZmSWQgLSBIYW5kb2ZmIGZlbmNlLlxuICAgKiBAcmV0dXJucyB7am9iIGlzIGltcG9ydChcIi4vdHlwZXMuanNcIikuQmFja2dyb3VuZEpvYlJvd30gLSBXaGV0aGVyIGFjY2VwdGVkLlxuICAgKi9cbiAgX2FjY2VwdHNIYW5kb2ZmKGpvYiwgaGFuZG9mZklkKSB7XG4gICAgcmV0dXJuIEJvb2xlYW4oam9iICYmIGpvYi5zdGF0dXMgPT09IFwiaGFuZGVkX29mZlwiICYmIGpvYi5oYW5kb2ZmSWQgJiYgam9iLmhhbmRvZmZJZCA9PT0gaGFuZG9mZklkKVxuICB9XG5cbiAgLyoqXG4gICAqIEZpbmRzIGEgcGVyc2lzdGVkIGxvY2FsIGpvYiB1c2luZyB0aGUgY3VycmVudCBjb25uZWN0aW9uLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL2RhdGFiYXNlL2RyaXZlcnMvYmFzZS5qc1wiKS5kZWZhdWx0fSBkYiAtIENvbm5lY3Rpb24uXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBqb2JJZCAtIEpvYiBpZC5cbiAgICogQHJldHVybnMge1Byb21pc2U8aW1wb3J0KFwiLi90eXBlcy5qc1wiKS5CYWNrZ3JvdW5kSm9iUm93IHwgbnVsbD59IC0gUGVyc2lzdGVkIHJvdy5cbiAgICovXG4gIGFzeW5jIF9nZXRKb2IoZGIsIGpvYklkKSB7XG4gICAgY29uc3Qgcm93cyA9IGF3YWl0IGRiLm5ld1F1ZXJ5KCkuZnJvbShMT0NBTF9CQUNLR1JPVU5EX0pPQlNfVEFCTEUpLndoZXJlKHtpZDogam9iSWR9KS5saW1pdCgxKS5yZXN1bHRzKClcblxuICAgIHJldHVybiByb3dzWzBdID8gdGhpcy5fbm9ybWFsaXplUm93KHJvd3NbMF0pIDogbnVsbFxuICB9XG5cbiAgLyoqXG4gICAqIFJlYWRzIHRoZSBqb2IgY3VycmVudGx5IG5hbWVkIGJ5IG9uZSBzdGFibGUgb3duZXIgcm93LlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL2RhdGFiYXNlL2RyaXZlcnMvYmFzZS5qc1wiKS5kZWZhdWx0fSBkYiAtIERhdGFiYXNlIGNvbm5lY3Rpb24uXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBzY2hlZHVsZUtleSAtIFZhbGlkYXRlZCBzdGFibGUgc2NoZWR1bGUga2V5LlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxpbXBvcnQoXCIuL3R5cGVzLmpzXCIpLkJhY2tncm91bmRKb2JSb3cgfCBudWxsPn0gLSBOb3JtYWxpemVkIG93bmVyIGpvYi5cbiAgICovXG4gIGFzeW5jIF9zY2hlZHVsZWRPd25lckpvYihkYiwgc2NoZWR1bGVLZXkpIHtcbiAgICBjb25zdCBvd25lclJvd3MgPSBhd2FpdCBkYlxuICAgICAgLm5ld1F1ZXJ5KClcbiAgICAgIC5mcm9tKExPQ0FMX0JBQ0tHUk9VTkRfSk9CX1NDSEVEVUxFX0tFWVNfVEFCTEUpXG4gICAgICAud2hlcmUoe3NjaGVkdWxlX2tleTogc2NoZWR1bGVLZXl9KVxuICAgICAgLmxpbWl0KDEpXG4gICAgICAucmVzdWx0cygpXG4gICAgY29uc3Qgb3duZXJSb3cgPSBvd25lclJvd3NbMF1cblxuICAgIGlmICghb3duZXJSb3cpIHJldHVybiBudWxsXG5cbiAgICByZXR1cm4gYXdhaXQgdGhpcy5fZ2V0Sm9iKGRiLCBTdHJpbmcob3duZXJSb3cuam9iX2lkKSlcbiAgfVxuXG4gIC8qKlxuICAgKiBBc3NpZ25zIHRoZSBuZXh0IG93bmVyc2hpcCBvcmRlciBhZnRlciBTUUxpdGUgd3JpdGUgc2VyaWFsaXphdGlvbiBpcyBoZWxkLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL2RhdGFiYXNlL2RyaXZlcnMvYmFzZS5qc1wiKS5kZWZhdWx0fSBkYiAtIERhdGFiYXNlIGNvbm5lY3Rpb24uXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBzY2hlZHVsZUtleSAtIFZhbGlkYXRlZCBzdGFibGUgc2NoZWR1bGUga2V5LlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxudW1iZXI+fSAtIE5leHQgbW9ub3RvbmljIG93bmVyc2hpcCBvcmRlci5cbiAgICovXG4gIGFzeW5jIF9uZXh0U2NoZWR1bGVPcmRlcihkYiwgc2NoZWR1bGVLZXkpIHtcbiAgICBjb25zdCByb3dzID0gYXdhaXQgZGJcbiAgICAgIC5uZXdRdWVyeSgpXG4gICAgICAuZnJvbShMT0NBTF9CQUNLR1JPVU5EX0pPQlNfVEFCTEUpXG4gICAgICAuc2VsZWN0KFwic2NoZWR1bGVfb3JkZXJcIilcbiAgICAgIC53aGVyZSh7c2NoZWR1bGVfa2V5OiBzY2hlZHVsZUtleX0pXG4gICAgICAud2hlcmUoYCR7ZGIucXVvdGVDb2x1bW4oXCJzY2hlZHVsZV9vcmRlclwiKX0gSVMgTk9UIE5VTExgKVxuICAgICAgLm9yZGVyKFwic2NoZWR1bGVfb3JkZXIgREVTQ1wiKVxuICAgICAgLmxpbWl0KDEpXG4gICAgICAucmVzdWx0cygpXG4gICAgY29uc3QgY3VycmVudE9yZGVyID0gdGhpcy5fbnVtYmVyT3JOdWxsKC8qKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSAqLyAocm93c1swXSB8fCB7fSkuc2NoZWR1bGVfb3JkZXIpXG5cbiAgICBpZiAoY3VycmVudE9yZGVyID09PSBudWxsKSByZXR1cm4gMVxuICAgIGlmICghTnVtYmVyLmlzU2FmZUludGVnZXIoY3VycmVudE9yZGVyKSB8fCBjdXJyZW50T3JkZXIgPCAxIHx8IGN1cnJlbnRPcmRlciA+PSBOdW1iZXIuTUFYX1NBRkVfSU5URUdFUikge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKGBJbnZhbGlkIGxvY2FsIGJhY2tncm91bmQgam9iIHNjaGVkdWxlIG93bmVyc2hpcCBvcmRlcjogJHtjdXJyZW50T3JkZXJ9YClcbiAgICB9XG5cbiAgICByZXR1cm4gY3VycmVudE9yZGVyICsgMVxuICB9XG5cbiAgLyoqXG4gICAqIEJ1aWxkcyBhIHN0YWJsZS1zY2hlZHVsZSBsb29rdXAgZXhjbHVzaXZlbHkgZnJvbSBub3JtYWxpemVkIGxvY2FsIGpvYnMuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vZGF0YWJhc2UvZHJpdmVycy9iYXNlLmpzXCIpLmRlZmF1bHR9IGRiIC0gRGF0YWJhc2UgY29ubmVjdGlvbi5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBMb29rdXAgb3B0aW9ucy5cbiAgICogQHBhcmFtIHtib29sZWFufSBhcmdzLmluY2x1ZGVMYXRlc3RUZXJtaW5hbCAtIFdoZXRoZXIgdGVybWluYWwgaGlzdG9yeSBpcyByZXF1ZXN0ZWQuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBhcmdzLnNjaGVkdWxlS2V5IC0gVmFsaWRhdGVkIHN0YWJsZSBzY2hlZHVsZSBrZXkuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPGltcG9ydChcIi4vdHlwZXMuanNcIikuQmFja2dyb3VuZEpvYlNjaGVkdWxlZExvb2t1cFJlc3VsdD59IC0gTm9ybWFsaXplZCBsb2NhbCBqb2JzLlxuICAgKi9cbiAgYXN5bmMgX3NjaGVkdWxlZEpvYkxvb2t1cChkYiwge2luY2x1ZGVMYXRlc3RUZXJtaW5hbCwgc2NoZWR1bGVLZXl9KSB7XG4gICAgY29uc3Qgb3duZXJKb2IgPSBhd2FpdCB0aGlzLl9zY2hlZHVsZWRPd25lckpvYihkYiwgc2NoZWR1bGVLZXkpXG4gICAgY29uc3QgY3VycmVudEpvYiA9IG93bmVySm9iICYmIChvd25lckpvYi5zdGF0dXMgPT09IFwicXVldWVkXCIgfHwgb3duZXJKb2Iuc3RhdHVzID09PSBcImhhbmRlZF9vZmZcIikgPyBvd25lckpvYiA6IG51bGxcblxuICAgIGlmICghaW5jbHVkZUxhdGVzdFRlcm1pbmFsKSByZXR1cm4ge2N1cnJlbnRKb2IsIGxhdGVzdFRlcm1pbmFsSm9iOiBudWxsfVxuXG4gICAgY29uc3QgdGVybWluYWxTdGF0dXNlcyA9IEJBQ0tHUk9VTkRfSk9CX1RFUk1JTkFMX1NUQVRVU0VTLm1hcCgoc3RhdHVzKSA9PiBkYi5xdW90ZShzdGF0dXMpKS5qb2luKFwiLCBcIilcbiAgICBjb25zdCB0ZXJtaW5hbFJvd3MgPSBhd2FpdCBkYlxuICAgICAgLm5ld1F1ZXJ5KClcbiAgICAgIC5mcm9tKExPQ0FMX0JBQ0tHUk9VTkRfSk9CU19UQUJMRSlcbiAgICAgIC53aGVyZSh7c2NoZWR1bGVfa2V5OiBzY2hlZHVsZUtleX0pXG4gICAgICAud2hlcmUoYCR7ZGIucXVvdGVDb2x1bW4oXCJzdGF0dXNcIil9IElOICgke3Rlcm1pbmFsU3RhdHVzZXN9KWApXG4gICAgICAub3JkZXIoYENBU0UgV0hFTiAke2RiLnF1b3RlQ29sdW1uKFwic2NoZWR1bGVfb3JkZXJcIil9IElTIE5VTEwgVEhFTiAwIEVMU0UgMSBFTkQgREVTQ2ApXG4gICAgICAub3JkZXIoXCJzY2hlZHVsZV9vcmRlciBERVNDXCIpXG4gICAgICAub3JkZXIoXCJjcmVhdGVkX2F0X21zIERFU0NcIilcbiAgICAgIC5vcmRlcihcImlkIERFU0NcIilcbiAgICAgIC5saW1pdCgxKVxuICAgICAgLnJlc3VsdHMoKVxuICAgIGNvbnN0IGxhdGVzdFRlcm1pbmFsSm9iID0gdGVybWluYWxSb3dzWzBdID8gdGhpcy5fbm9ybWFsaXplUm93KHRlcm1pbmFsUm93c1swXSkgOiBudWxsXG5cbiAgICByZXR1cm4ge2N1cnJlbnRKb2IsIGxhdGVzdFRlcm1pbmFsSm9ifVxuICB9XG5cbiAgLyoqXG4gICAqIFJlbGVhc2VzIG93bmVyc2hpcCBvbmx5IHdoZW4gdGhlIGtleSBzdGlsbCBwb2ludHMgYXQgdGhlIGV4cGVjdGVkIGpvYi5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9kYXRhYmFzZS9kcml2ZXJzL2Jhc2UuanNcIikuZGVmYXVsdH0gZGIgLSBEYXRhYmFzZSBjb25uZWN0aW9uLlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIE93bmVyc2hpcCBpZGVudGl0eS5cbiAgICogQHBhcmFtIHtzdHJpbmcgfCBudWxsfSBhcmdzLmpvYklkIC0gRXhwZWN0ZWQgb3duZXIgam9iIGlkLCBvciBudWxsIGZvciBhIGRhbmdsaW5nIG93bmVyLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gYXJncy5zY2hlZHVsZUtleSAtIFN0YWJsZSBzY2hlZHVsZSBrZXkuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIHdoZW4gZGVsZXRlZCBvciBhbHJlYWR5IHN1cGVyc2VkZWQuXG4gICAqL1xuICBhc3luYyBfcmVsZWFzZVNjaGVkdWxlT3duZXJzaGlwKGRiLCB7am9iSWQsIHNjaGVkdWxlS2V5fSkge1xuICAgIGNvbnN0IGNvbmRpdGlvbnMgPSBqb2JJZCA9PT0gbnVsbFxuICAgICAgPyB7c2NoZWR1bGVfa2V5OiBzY2hlZHVsZUtleX1cbiAgICAgIDoge2pvYl9pZDogam9iSWQsIHNjaGVkdWxlX2tleTogc2NoZWR1bGVLZXl9XG5cbiAgICBhd2FpdCBkYi5kZWxldGUoe2NvbmRpdGlvbnMsIHRhYmxlTmFtZTogTE9DQUxfQkFDS0dST1VORF9KT0JfU0NIRURVTEVfS0VZU19UQUJMRX0pXG4gIH1cblxuICAvKipcbiAgICogUmVsZWFzZXMgYSB0ZXJtaW5hbCBqb2IncyBzdGFibGUgb3duZXJzaGlwIHdoZW4gc3RpbGwgY3VycmVudC5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9kYXRhYmFzZS9kcml2ZXJzL2Jhc2UuanNcIikuZGVmYXVsdH0gZGIgLSBEYXRhYmFzZSBjb25uZWN0aW9uLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vdHlwZXMuanNcIikuQmFja2dyb3VuZEpvYlJvd30gam9iIC0gVGVybWluYWwgam9iLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyB3aGVuIGRlbGV0ZWQgb3Igbm90IGFwcGxpY2FibGUuXG4gICAqL1xuICBhc3luYyBfcmVsZWFzZVNjaGVkdWxlT3duZXJzaGlwRm9ySm9iKGRiLCBqb2IpIHtcbiAgICBpZiAoIWpvYi5zY2hlZHVsZUtleSkgcmV0dXJuXG5cbiAgICBhd2FpdCB0aGlzLl9yZWxlYXNlU2NoZWR1bGVPd25lcnNoaXAoZGIsIHtqb2JJZDogam9iLmlkLCBzY2hlZHVsZUtleTogam9iLnNjaGVkdWxlS2V5fSlcbiAgfVxuXG4gIC8qKlxuICAgKiBBY3F1aXJlcyBTUUxpdGUncyB0cmFuc2FjdGlvbiB3cml0ZSBzZXJpYWxpemF0aW9uIGJlZm9yZSByZWFkaW5nIGEgc3RhYmxlXG4gICAqIG93bmVyLiBBIHplcm8tcm93IHVwZGF0ZSBzdGlsbCBlc3RhYmxpc2hlcyB0aGUgd3JpdGUgYm91bmRhcnkgZm9yIGEgbmV3IGtleS5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9kYXRhYmFzZS9kcml2ZXJzL2Jhc2UuanNcIikuZGVmYXVsdH0gZGIgLSBEYXRhYmFzZSBjb25uZWN0aW9uLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gc2NoZWR1bGVLZXkgLSBWYWxpZGF0ZWQgc3RhYmxlIHNjaGVkdWxlIGtleS5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgYWZ0ZXIgd3JpdGUgc2VyaWFsaXphdGlvbiBpcyBhY3F1aXJlZC5cbiAgICovXG4gIGFzeW5jIF9sb2NrU2NoZWR1bGVLZXkoZGIsIHNjaGVkdWxlS2V5KSB7XG4gICAgY29uc3QgdGFibGUgPSBkYi5xdW90ZVRhYmxlKExPQ0FMX0JBQ0tHUk9VTkRfSk9CX1NDSEVEVUxFX0tFWVNfVEFCTEUpXG4gICAgY29uc3Qgam9iSWQgPSBkYi5xdW90ZUNvbHVtbihcImpvYl9pZFwiKVxuXG4gICAgYXdhaXQgZGIucXVlcnkoXG4gICAgICBgVVBEQVRFICR7dGFibGV9IFNFVCAke2pvYklkfSA9ICR7am9iSWR9IGAgK1xuICAgICAgYFdIRVJFICR7ZGIucXVvdGVDb2x1bW4oXCJzY2hlZHVsZV9rZXlcIil9ID0gJHtkYi5xdW90ZShzY2hlZHVsZUtleSl9YFxuICAgIClcbiAgfVxuXG4gIC8qKlxuICAgKiBSZWdpc3RlcnMgdGhlIGxvY2FsIGRpc3BhdGNoIHBva2Ugb24gdGhlIHN1cnJvdW5kaW5nIHRyYW5zYWN0aW9uIGNvbW1pdC5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9kYXRhYmFzZS9kcml2ZXJzL2Jhc2UuanNcIikuZGVmYXVsdH0gZGIgLSBUcmFuc2FjdGlvbiBjb25uZWN0aW9uLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyBhZnRlciByZWdpc3RyYXRpb24uXG4gICAqL1xuICBhc3luYyBfd2FrZURpc3BhdGNoZXJBZnRlckNvbW1pdChkYikge1xuICAgIGlmICh0aGlzLm9uQ29tbWl0dGVkRW5xdWV1ZSkgYXdhaXQgZGIuYWZ0ZXJDb21taXQodGhpcy5vbkNvbW1pdHRlZEVucXVldWUpXG4gIH1cblxuICAvKipcbiAgICogTm9ybWFsaXplcyBvbmUgcmF3IGxvY2FsIGRhdGFiYXNlIHJvdy5cbiAgICogQHBhcmFtIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59IHJvdyAtIFJhdyByb3cuXG4gICAqIEByZXR1cm5zIHtpbXBvcnQoXCIuL3R5cGVzLmpzXCIpLkJhY2tncm91bmRKb2JSb3d9IC0gTm9ybWFsaXplZCByb3cuXG4gICAqL1xuICBfbm9ybWFsaXplUm93KHJvdykge1xuICAgIGNvbnN0IHBhcnNlZEFyZ3MgPSBKU09OLnBhcnNlKFN0cmluZyhyb3cuYXJnc19qc29uKSlcbiAgICBjb25zdCBleGVjdXRpb25Nb2RlID0gbm9ybWFsaXplQmFja2dyb3VuZEpvYkV4ZWN1dGlvbk1vZGUoe2V4ZWN1dGlvbk1vZGU6IFN0cmluZyhyb3cuZXhlY3V0aW9uX21vZGUpfSwgXCJpbmxpbmVcIiwgTE9DQUxfRVhFQ1VUSU9OX01PREVTKVxuXG4gICAgaWYgKCFBcnJheS5pc0FycmF5KHBhcnNlZEFyZ3MpKSB0aHJvdyBuZXcgRXJyb3IoYEludmFsaWQgbG9jYWwgYmFja2dyb3VuZCBqb2IgYXJnc19qc29uIGZvciBqb2I6ICR7U3RyaW5nKHJvdy5pZCl9YClcbiAgICBpZiAoZXhlY3V0aW9uTW9kZSAhPT0gXCJpbmxpbmVcIikgdGhyb3cgbmV3IEVycm9yKFwiTG9jYWwgYmFja2dyb3VuZCBqb2IgZXhlY3V0aW9uIG1vZGUgaW52YXJpYW50IHdhcyB2aW9sYXRlZFwiKVxuXG4gICAgcmV0dXJuIHtcbiAgICAgIGFyZ3M6IHBhcnNlZEFyZ3MsXG4gICAgICBhdHRlbXB0czogdGhpcy5fbnVtYmVyT3JOdWxsKHJvdy5hdHRlbXB0cyksXG4gICAgICBjaGlsZEluc3RhbmNlSWQ6IHJvdy5jaGlsZF9pbnN0YW5jZV9pZCA9PT0gbnVsbCB8fCByb3cuY2hpbGRfaW5zdGFuY2VfaWQgPT09IHVuZGVmaW5lZCA/IG51bGwgOiBTdHJpbmcocm93LmNoaWxkX2luc3RhbmNlX2lkKSxcbiAgICAgIHJ1bm5lckhvc3RuYW1lOiByb3cucnVubmVyX2hvc3RuYW1lID09PSBudWxsIHx8IHJvdy5ydW5uZXJfaG9zdG5hbWUgPT09IHVuZGVmaW5lZCA/IG51bGwgOiBTdHJpbmcocm93LnJ1bm5lcl9ob3N0bmFtZSksXG4gICAgICBjaGlsZFBpZDogdGhpcy5fbnVtYmVyT3JOdWxsKHJvdy5jaGlsZF9waWQpLFxuICAgICAgY2hpbGRSZWNlaXZlZEF0TXM6IHRoaXMuX251bWJlck9yTnVsbChyb3cuY2hpbGRfcmVjZWl2ZWRfYXRfbXMpLFxuICAgICAgY2hpbGRTdGFydGVkQXRNczogdGhpcy5fbnVtYmVyT3JOdWxsKHJvdy5jaGlsZF9zdGFydGVkX2F0X21zKSxcbiAgICAgIGNvbXBsZXRlZEF0TXM6IHRoaXMuX251bWJlck9yTnVsbChyb3cuY29tcGxldGVkX2F0X21zKSxcbiAgICAgIGNvbmN1cnJlbmN5S2V5OiByb3cuY29uY3VycmVuY3lfa2V5ID09PSBudWxsIHx8IHJvdy5jb25jdXJyZW5jeV9rZXkgPT09IHVuZGVmaW5lZCA/IG51bGwgOiBTdHJpbmcocm93LmNvbmN1cnJlbmN5X2tleSksXG4gICAgICBjcmVhdGVkQXRNczogdGhpcy5fbnVtYmVyT3JOdWxsKHJvdy5jcmVhdGVkX2F0X21zKSxcbiAgICAgIGV4ZWN1dGlvbk1vZGUsXG4gICAgICBmYWlsZWRBdE1zOiB0aGlzLl9udW1iZXJPck51bGwocm93LmZhaWxlZF9hdF9tcyksXG4gICAgICBoYW5kZWRPZmZBdE1zOiB0aGlzLl9udW1iZXJPck51bGwocm93LmhhbmRlZF9vZmZfYXRfbXMpLFxuICAgICAgaGFuZG9mZklkOiByb3cuaGFuZG9mZl9pZCA9PT0gbnVsbCB8fCByb3cuaGFuZG9mZl9pZCA9PT0gdW5kZWZpbmVkID8gbnVsbCA6IFN0cmluZyhyb3cuaGFuZG9mZl9pZCksXG4gICAgICAvLyBMb2NhbCAoYnJvd3Nlci9FeHBvKSBkaXNwYXRjaCBpcyBzdHJpY3RseSBGSUZPIGFuZCBoYXMgbm8gcHJpb3JpdHkgY29sdW1uLFxuICAgICAgLy8gc28gZXZlcnkgcm93IHJlcG9ydHMgdGhlIGRlZmF1bHQgcHJpb3JpdHkuXG4gICAgICBwcmlvcml0eTogMCxcbiAgICAgIGlkOiBTdHJpbmcocm93LmlkKSxcbiAgICAgIGpvYk5hbWU6IFN0cmluZyhyb3cuam9iX25hbWUpLFxuICAgICAgbGFzdEVycm9yOiByb3cubGFzdF9lcnJvciA9PT0gbnVsbCB8fCByb3cubGFzdF9lcnJvciA9PT0gdW5kZWZpbmVkID8gbnVsbCA6IFN0cmluZyhyb3cubGFzdF9lcnJvciksXG4gICAgICBtYXhDb25jdXJyZW5jeTogdGhpcy5fbnVtYmVyT3JOdWxsKHJvdy5tYXhfY29uY3VycmVuY3kpLFxuICAgICAgbWF4UmV0cmllczogdGhpcy5fbnVtYmVyT3JOdWxsKHJvdy5tYXhfcmV0cmllcyksXG4gICAgICBvcnBoYW5lZEF0TXM6IG51bGwsXG4gICAgICBxdWV1ZTogcm93LnF1ZXVlID8gU3RyaW5nKHJvdy5xdWV1ZSkgOiBERUZBVUxUX0JBQ0tHUk9VTkRfSk9CX1FVRVVFLFxuICAgICAgc2NoZWR1bGVLZXk6IHJvdy5zY2hlZHVsZV9rZXkgPT09IG51bGwgfHwgcm93LnNjaGVkdWxlX2tleSA9PT0gdW5kZWZpbmVkID8gbnVsbCA6IFN0cmluZyhyb3cuc2NoZWR1bGVfa2V5KSxcbiAgICAgIHNjaGVkdWxlT3JkZXI6IHRoaXMuX251bWJlck9yTnVsbChyb3cuc2NoZWR1bGVfb3JkZXIpLFxuICAgICAgc2NoZWR1bGVkQXRNczogdGhpcy5fbnVtYmVyT3JOdWxsKHJvdy5zY2hlZHVsZWRfYXRfbXMpLFxuICAgICAgc3RhdHVzOiBub3JtYWxpemVCYWNrZ3JvdW5kSm9iU3RhdHVzKHJvdy5zdGF0dXMgPyBTdHJpbmcocm93LnN0YXR1cykgOiBcInF1ZXVlZFwiKSxcbiAgICAgIHRpbWVvdXRNczogbnVsbCxcbiAgICAgIHdvcmtlcklkOiByb3cud29ya2VyX2lkID09PSBudWxsIHx8IHJvdy53b3JrZXJfaWQgPT09IHVuZGVmaW5lZCA/IG51bGwgOiBTdHJpbmcocm93Lndvcmtlcl9pZClcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogTm9ybWFsaXplcyBvbmUgbnVsbGFibGUgZGF0YWJhc2UgbnVtYmVyLlxuICAgKiBAcGFyYW0ge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSB2YWx1ZSAtIERhdGFiYXNlIG51bWJlci5cbiAgICogQHJldHVybnMge251bWJlciB8IG51bGx9IC0gTm9ybWFsaXplZCBudW1iZXIuXG4gICAqL1xuICBfbnVtYmVyT3JOdWxsKHZhbHVlKSB7XG4gICAgaWYgKHZhbHVlID09PSBudWxsIHx8IHZhbHVlID09PSB1bmRlZmluZWQgfHwgdmFsdWUgPT09IFwiXCIpIHJldHVybiBudWxsXG5cbiAgICBjb25zdCBudW1iZXIgPSBOdW1iZXIodmFsdWUpXG5cbiAgICByZXR1cm4gTnVtYmVyLmlzTmFOKG51bWJlcikgPyBudWxsIDogbnVtYmVyXG4gIH1cblxuICAvKipcbiAgICogRXhlY3V0ZXMgYSBzdHJ1Y3R1cmVkIHVwZGF0ZSBhbmQgcmVwb3J0cyBpdHMgYWZmZWN0ZWQtcm93IGNvdW50LlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL2RhdGFiYXNlL2RyaXZlcnMvYmFzZS5qc1wiKS5kZWZhdWx0fSBkYiAtIENvbm5lY3Rpb24uXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vZGF0YWJhc2UvZHJpdmVycy9iYXNlLmpzXCIpLlVwZGF0ZVNxbEFyZ3NUeXBlfSBhcmdzIC0gVXBkYXRlIGFyZ3VtZW50cy5cbiAgICogQHJldHVybnMge1Byb21pc2U8bnVtYmVyPn0gLSBBZmZlY3RlZCByb3dzLlxuICAgKi9cbiAgYXN5bmMgX3VwZGF0ZUFmZmVjdGVkUm93cyhkYiwgYXJncykgeyByZXR1cm4gYXdhaXQgZGIuYWZmZWN0ZWRSb3dzKGRiLnVwZGF0ZVNxbChhcmdzKSkgfVxuXG4gIC8qKlxuICAgKiBKb2lucyBhbiBhbWJpZW50IGFwcCB0cmFuc2FjdGlvbiBvciB1c2VzIHRoZSBkYXRhYmFzZSdzIHNjb3BlZCBvcGVyYXRpb24gbGVhc2UuXG4gICAqIEB0ZW1wbGF0ZSBUXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vZGF0YWJhc2UvZHJpdmVycy9iYXNlLmpzXCIpLmRlZmF1bHR9IGRiIC0gQ29ubmVjdGlvbi5cbiAgICogQHBhcmFtIHsoZGI6IGltcG9ydChcIi4uL2RhdGFiYXNlL2RyaXZlcnMvYmFzZS5qc1wiKS5kZWZhdWx0KSA9PiBQcm9taXNlPFQ+fSBjYWxsYmFjayAtIE11dGF0aW9uLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxUPn0gLSBNdXRhdGlvbiByZXN1bHQuXG4gICAqL1xuICBhc3luYyBfbXV0YXRlKGRiLCBjYWxsYmFjaykge1xuICAgIGlmIChkYi5pbnNpZGVUcmFuc2FjdGlvbigpKSByZXR1cm4gYXdhaXQgdGhpcy5fdHJhbnNhY3Rpb25SZXN1bHQoZGIsIGFzeW5jICgpID0+IGF3YWl0IGNhbGxiYWNrKGRiKSlcblxuICAgIHJldHVybiBhd2FpdCB0aGlzLmNvbmZpZ3VyYXRpb24ud2l0aFRyYW5zYWN0aW9uKHtcbiAgICAgIGRhdGFiYXNlSWRlbnRpZmllcjogdGhpcy5nZXREYXRhYmFzZUlkZW50aWZpZXIoKSxcbiAgICAgIG5hbWU6IFwiTG9jYWwgYmFja2dyb3VuZCBqb2JzIG11dGF0aW9uXCJcbiAgICB9LCBhc3luYyAob3BlcmF0aW9uKSA9PiBhd2FpdCBjYWxsYmFjayhvcGVyYXRpb24uY29ubmVjdGlvbigpKSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGEgY2FsbGJhY2sgaW4gYSB0cmFuc2FjdGlvbiBhbmQgcmV0dXJucyBpdHMgY2FwdHVyZWQgcmVzdWx0LlxuICAgKiBAdGVtcGxhdGUgVFxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL2RhdGFiYXNlL2RyaXZlcnMvYmFzZS5qc1wiKS5kZWZhdWx0fSBkYiAtIENvbm5lY3Rpb24uXG4gICAqIEBwYXJhbSB7KCkgPT4gUHJvbWlzZTxUPn0gY2FsbGJhY2sgLSBUcmFuc2FjdGlvbiBjYWxsYmFjay5cbiAgICogQHJldHVybnMge1Byb21pc2U8VD59IC0gQ2FsbGJhY2sgcmVzdWx0LlxuICAgKi9cbiAgYXN5bmMgX3RyYW5zYWN0aW9uUmVzdWx0KGRiLCBjYWxsYmFjaykge1xuICAgIGxldCBjb21wbGV0ZWQgPSBmYWxzZVxuICAgIC8qKiBAdHlwZSB7VCB8IHVuZGVmaW5lZH0gKi9cbiAgICBsZXQgcmVzdWx0XG5cbiAgICBhd2FpdCBkYi50cmFuc2FjdGlvbihhc3luYyAoKSA9PiB7XG4gICAgICByZXN1bHQgPSBhd2FpdCBjYWxsYmFjaygpXG4gICAgICBjb21wbGV0ZWQgPSB0cnVlXG4gICAgfSlcblxuICAgIGlmICghY29tcGxldGVkKSB0aHJvdyBuZXcgRXJyb3IoXCJMb2NhbCBiYWNrZ3JvdW5kIGpvYnMgdHJhbnNhY3Rpb24gY2FsbGJhY2sgd2FzIG5vdCBpbnZva2VkXCIpXG4gICAgcmV0dXJuIC8qKiBAdHlwZSB7VH0gKi8gKHJlc3VsdClcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGEgY2FsbGJhY2sgd2l0aCB0aGUgY29uZmlndXJlZCBsb2NhbCBkYXRhYmFzZSBjb25uZWN0aW9uLlxuICAgKiBAdGVtcGxhdGUgVFxuICAgKiBAcGFyYW0geyhkYjogaW1wb3J0KFwiLi4vZGF0YWJhc2UvZHJpdmVycy9iYXNlLmpzXCIpLmRlZmF1bHQpID0+IFByb21pc2U8VD59IGNhbGxiYWNrIC0gQ29ubmVjdGlvbiBjYWxsYmFjay5cbiAgICogQHJldHVybnMge1Byb21pc2U8VD59IC0gQ2FsbGJhY2sgcmVzdWx0LlxuICAgKi9cbiAgYXN5bmMgX3dpdGhEYihjYWxsYmFjaykge1xuICAgIGNvbnN0IGRhdGFiYXNlSWRlbnRpZmllciA9IHRoaXMuZ2V0RGF0YWJhc2VJZGVudGlmaWVyKClcblxuICAgIHJldHVybiBhd2FpdCB0aGlzLmNvbmZpZ3VyYXRpb24uZW5zdXJlQ29ubmVjdGlvbnMoe2RhdGFiYXNlSWRlbnRpZmllcnM6IFtkYXRhYmFzZUlkZW50aWZpZXJdLCBuYW1lOiBcIkxvY2FsIGJhY2tncm91bmQgam9icyBzdG9yZVwifSwgYXN5bmMgKGRicykgPT4ge1xuICAgICAgY29uc3QgZGIgPSBkYnNbZGF0YWJhc2VJZGVudGlmaWVyXVxuXG4gICAgICBpZiAoIWRiKSB0aHJvdyBuZXcgRXJyb3IoYE5vIGxvY2FsIGJhY2tncm91bmQtam9icyBkYXRhYmFzZSBjb25uZWN0aW9uIGF2YWlsYWJsZSBmb3IgaWRlbnRpZmllcjogJHtkYXRhYmFzZUlkZW50aWZpZXJ9YClcblxuICAgICAgcmV0dXJuIGF3YWl0IGNhbGxiYWNrKGRiKVxuICAgIH0pXG4gIH1cblxuICAvKipcbiAgICogUmVwb3J0cyBhbiB1bmV4cGVjdGVkIGxvY2FsLXN0b3JlIGZhaWx1cmUgdGhyb3VnaCBmcmFtZXdvcmsgY2hhbm5lbHMuXG4gICAqIEBwYXJhbSB7e2Vycm9yOiBFcnJvciwgc3RhZ2U6IHN0cmluZ319IGFyZ3MgLSBFcnJvciByZXBvcnQuXG4gICAqIEByZXR1cm5zIHt2b2lkfSAtIE5vIHJldHVybiB2YWx1ZS5cbiAgICovXG4gIF9yZXBvcnRGcmFtZXdvcmtFcnJvcih7ZXJyb3IsIHN0YWdlfSkge1xuICAgIGNvbnN0IHBheWxvYWQgPSB7Y29udGV4dDoge3N0YWdlfSwgZXJyb3J9XG4gICAgY29uc3QgZXJyb3JFdmVudHMgPSB0aGlzLmNvbmZpZ3VyYXRpb24uZ2V0RXJyb3JFdmVudHMoKVxuXG4gICAgZXJyb3JFdmVudHMuZW1pdChcImZyYW1ld29yay1lcnJvclwiLCBwYXlsb2FkKVxuICAgIGVycm9yRXZlbnRzLmVtaXQoXCJhbGwtZXJyb3JcIiwgey4uLnBheWxvYWQsIGVycm9yVHlwZTogXCJmcmFtZXdvcmstZXJyb3JcIn0pXG4gIH1cbn1cbiJdfQ==