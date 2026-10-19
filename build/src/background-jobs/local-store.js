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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoibG9jYWwtc3RvcmUuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi9zcmMvYmFja2dyb3VuZC1qb2JzL2xvY2FsLXN0b3JlLmpzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiJBQUFBLFlBQVk7QUFFWixPQUFPLElBQUksTUFBTSxXQUFXLENBQUE7QUFFNUIsT0FBTyxTQUFTLE1BQU0saUNBQWlDLENBQUE7QUFDdkQsT0FBTyxVQUFVLE1BQU0sdUNBQXVDLENBQUE7QUFDOUQsT0FBTyxTQUFTLE1BQU0sd0JBQXdCLENBQUE7QUFDOUMsT0FBTyxjQUFjLE1BQU0sdUJBQXVCLENBQUE7QUFDbEQsT0FBTywyQkFBMkIsTUFBTSxzQkFBc0IsQ0FBQTtBQUM5RCxPQUFPLEVBQ0wsZ0NBQWdDLEVBQ2hDLDRCQUE0QixFQUM1Qiw0QkFBNEIsRUFDNUIsaUNBQWlDLEVBQ2pDLG1DQUFtQyxFQUNuQyxnQ0FBZ0MsRUFDaEMsMkJBQTJCLEVBQzNCLGlDQUFpQyxFQUNqQyxtQ0FBbUMsRUFDbkMsNEJBQTRCLEVBQzVCLDRCQUE0QixFQUM1QixZQUFZLEVBQ2IsTUFBTSxvQkFBb0IsQ0FBQTtBQUUzQixNQUFNLENBQUMsTUFBTSwyQkFBMkIsR0FBRyxpQ0FBaUMsQ0FBQTtBQUM1RSxNQUFNLENBQUMsTUFBTSxzQ0FBc0MsR0FBRyw0Q0FBNEMsQ0FBQTtBQUNsRyxNQUFNLENBQUMsTUFBTSx3Q0FBd0MsR0FBRyw4Q0FBOEMsQ0FBQTtBQUN0RyxNQUFNLGdCQUFnQixHQUFHLCtCQUErQixDQUFBO0FBQ3hELE1BQU0sZUFBZSxHQUFHLHVCQUF1QixDQUFBO0FBQy9DLE1BQU0sa0JBQWtCLEdBQUcsQ0FBQyxHQUFHLEVBQUUsR0FBRyxFQUFFLEdBQUcsQ0FBQyxDQUFBO0FBQzFDLE1BQU0scUJBQXFCLEdBQUcsQ0FBQyxvQkFBb0IsQ0FBQyxDQUFDLFFBQVEsQ0FBQyxDQUFDLENBQUE7QUFDL0QsTUFBTSxDQUFDLE1BQU0saUNBQWlDLEdBQUc7SUFDL0MsMkNB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RCBmcm9tIFwicHVyZS11dWlkXCJcblxuaW1wb3J0IFRhYmxlRGF0YSBmcm9tIFwiLi4vZGF0YWJhc2UvdGFibGUtZGF0YS9pbmRleC5qc1wiXG5pbXBvcnQgVGFibGVJbmRleCBmcm9tIFwiLi4vZGF0YWJhc2UvdGFibGUtZGF0YS90YWJsZS1pbmRleC5qc1wiXG5pbXBvcnQgc2hhMjU2SGV4IGZyb20gXCIuLi91dGlscy9zaGEyNTYtaGV4LmpzXCJcbmltcG9ydCBWZWxvY2lvdXNFcnJvciBmcm9tIFwiLi4vdmVsb2Npb3VzLWVycm9yLmpzXCJcbmltcG9ydCBub3JtYWxpemVCYWNrZ3JvdW5kSm9iRXJyb3IgZnJvbSBcIi4vbm9ybWFsaXplLWVycm9yLmpzXCJcbmltcG9ydCB7XG4gIEJBQ0tHUk9VTkRfSk9CX1RFUk1JTkFMX1NUQVRVU0VTLFxuICBERUZBVUxUX0JBQ0tHUk9VTkRfSk9CX1FVRVVFLFxuICBRVUVVRV9DT05DVVJSRU5DWV9LRVlfUFJFRklYLFxuICBub3JtYWxpemVCYWNrZ3JvdW5kSm9iQ29uY3VycmVuY3ksXG4gIG5vcm1hbGl6ZUJhY2tncm91bmRKb2JFeGVjdXRpb25Nb2RlLFxuICBub3JtYWxpemVCYWNrZ3JvdW5kSm9iTWF4UmV0cmllcyxcbiAgbm9ybWFsaXplQmFja2dyb3VuZEpvYlF1ZXVlLFxuICBub3JtYWxpemVCYWNrZ3JvdW5kSm9iU2NoZWR1bGVLZXksXG4gIG5vcm1hbGl6ZUJhY2tncm91bmRKb2JTY2hlZHVsZWRBdE1zLFxuICBub3JtYWxpemVCYWNrZ3JvdW5kSm9iU3RhdHVzLFxuICByZXNjaGVkdWxlZEJhY2tncm91bmRKb2JBdE1zLFxuICByZXRyeURlbGF5TXNcbn0gZnJvbSBcIi4vam9iLXNlbWFudGljcy5qc1wiXG5cbmV4cG9ydCBjb25zdCBMT0NBTF9CQUNLR1JPVU5EX0pPQlNfVEFCTEUgPSBcInZlbG9jaW91c19sb2NhbF9iYWNrZ3JvdW5kX2pvYnNcIlxuZXhwb3J0IGNvbnN0IExPQ0FMX0JBQ0tHUk9VTkRfSk9CX0NPTkNVUlJFTkNZX1RBQkxFID0gXCJ2ZWxvY2lvdXNfbG9jYWxfYmFja2dyb3VuZF9qb2JfY29uY3VycmVuY3lcIlxuZXhwb3J0IGNvbnN0IExPQ0FMX0JBQ0tHUk9VTkRfSk9CX1NDSEVEVUxFX0tFWVNfVEFCTEUgPSBcInZlbG9jaW91c19sb2NhbF9iYWNrZ3JvdW5kX2pvYl9zY2hlZHVsZV9rZXlzXCJcbmNvbnN0IE1JR1JBVElPTlNfVEFCTEUgPSBcInZlbG9jaW91c19pbnRlcm5hbF9taWdyYXRpb25zXCJcbmNvbnN0IE1JR1JBVElPTl9TQ09QRSA9IFwibG9jYWxfYmFja2dyb3VuZF9qb2JzXCJcbmNvbnN0IE1JR1JBVElPTl9WRVJTSU9OUyA9IFtcIjFcIiwgXCIyXCIsIFwiM1wiXVxuY29uc3QgTE9DQUxfRVhFQ1VUSU9OX01PREVTID0gWy8qKiBAdHlwZSB7Y29uc3R9ICovIChcImlubGluZVwiKV1cbmV4cG9ydCBjb25zdCBMT0NBTF9CQUNLR1JPVU5EX0pPQlNfSU5ERVhfTkFNRVMgPSBbXG4gIFwiaW5kZXhfdmVsb2Npb3VzX2xvY2FsX2JhY2tncm91bmRfam9ic19kdWVcIixcbiAgXCJpbmRleF92ZWxvY2lvdXNfbG9jYWxfYmFja2dyb3VuZF9qb2JzX3F1ZXVlX3N0YXR1c1wiLFxuICBcImluZGV4X3ZlbG9jaW91c19sb2NhbF9iYWNrZ3JvdW5kX2pvYnNfZGVkdXBsaWNhdGlvblwiLFxuICBcImluZGV4X3ZlbG9jaW91c19sb2NhbF9iYWNrZ3JvdW5kX2pvYnNfY29uY3VycmVuY3lcIixcbiAgXCJpbmRleF92ZWxvY2lvdXNfbG9jYWxfYmFja2dyb3VuZF9qb2JzX3NjaGVkdWxlX2hpc3RvcnlcIixcbiAgXCJpbmRleF92ZWxvY2lvdXNfbG9jYWxfYmFja2dyb3VuZF9qb2JzX3NjaGVkdWxlX29yZGVyXCJcbl1cbmV4cG9ydCBjb25zdCBMT0NBTF9CQUNLR1JPVU5EX0pPQl9TQ0hFRFVMRV9LRVlTX0lOREVYX05BTUVTID0gW1wiaW5kZXhfdmVsb2Npb3VzX2xvY2FsX2JhY2tncm91bmRfam9iX3NjaGVkdWxlX2tleXNfam9iXCJdXG5jb25zdCBFWFBFQ1RFRF9KT0JfQ09MVU1OUyA9IFtcbiAgXCJpZFwiLFxuICBcImpvYl9uYW1lXCIsXG4gIFwiYXJnc19qc29uXCIsXG4gIFwiYXJnc19kaWdlc3RcIixcbiAgXCJleGVjdXRpb25fbW9kZVwiLFxuICBcInF1ZXVlXCIsXG4gIFwic2NoZWR1bGVfa2V5XCIsXG4gIFwic2NoZWR1bGVfb3JkZXJcIixcbiAgXCJtYXhfcmV0cmllc1wiLFxuICBcImF0dGVtcHRzXCIsXG4gIFwic3RhdHVzXCIsXG4gIFwic2NoZWR1bGVkX2F0X21zXCIsXG4gIFwiY3JlYXRlZF9hdF9tc1wiLFxuICBcImhhbmRlZF9vZmZfYXRfbXNcIixcbiAgXCJoYW5kb2ZmX2lkXCIsXG4gIFwid29ya2VyX2lkXCIsXG4gIFwiY29tcGxldGVkX2F0X21zXCIsXG4gIFwiZmFpbGVkX2F0X21zXCIsXG4gIFwibGFzdF9lcnJvclwiLFxuICBcImNvbmN1cnJlbmN5X2tleVwiLFxuICBcIm1heF9jb25jdXJyZW5jeVwiLFxuICBcImNoaWxkX3JlY2VpdmVkX2F0X21zXCIsXG4gIFwiY2hpbGRfc3RhcnRlZF9hdF9tc1wiLFxuICBcImNoaWxkX2luc3RhbmNlX2lkXCIsXG4gIFwiY2hpbGRfcGlkXCIsXG4gIFwicnVubmVyX2hvc3RuYW1lXCJcbl1cbmNvbnN0IEVYUEVDVEVEX0NPTkNVUlJFTkNZX0NPTFVNTlMgPSBbXCJjb25jdXJyZW5jeV9rZXlcIiwgXCJtYXhfY29uY3VycmVuY3lcIiwgXCJhY3RpdmVfY291bnRcIl1cbmNvbnN0IEVYUEVDVEVEX1NDSEVEVUxFX0tFWV9DT0xVTU5TID0gW1wic2NoZWR1bGVfa2V5XCIsIFwiam9iX2lkXCJdXG4vKiogQHR5cGUge1dlYWtNYXA8aW1wb3J0KFwiLi4vY29uZmlndXJhdGlvbi5qc1wiKS5kZWZhdWx0LCBNYXA8c3RyaW5nLCBQcm9taXNlPHZvaWQ+Pj59ICovXG5jb25zdCBkZWR1cGxpY2F0ZWRFbnF1ZXVlQ2hhaW5zID0gbmV3IFdlYWtNYXAoKVxuXG4vKipcbiAqIENyZWF0ZXMgdGhlIHByb2R1Y3Rpb24gY2xvY2sgdXNlZCBieSBsb2NhbCBkaXNwYXRjaC5cbiAqIEByZXR1cm5zIHtpbXBvcnQoXCIuL3R5cGVzLmpzXCIpLkxvY2FsQmFja2dyb3VuZEpvYnNDbG9ja30gLSBQcm9kdWN0aW9uIGNsb2NrLlxuICovXG5leHBvcnQgZnVuY3Rpb24gbG9jYWxCYWNrZ3JvdW5kSm9ic0Nsb2NrKCkge1xuICByZXR1cm4ge1xuICAgIGNsZWFyVGltZW91dDogKHRpbWVySWQpID0+IGdsb2JhbFRoaXMuY2xlYXJUaW1lb3V0KHRpbWVySWQpLFxuICAgIG5vdzogKCkgPT4gRGF0ZS5ub3coKSxcbiAgICBzZXRUaW1lb3V0OiAoY2FsbGJhY2ssIGRlbGF5TXMpID0+IGdsb2JhbFRoaXMuc2V0VGltZW91dChjYWxsYmFjaywgZGVsYXlNcylcbiAgfVxufVxuXG4vKiogTmFtZXNwYWNlZCBwb3J0YWJsZSBTUUxpdGUgcGVyc2lzdGVuY2UgZm9yIGxvY2FsIGJhY2tncm91bmQgam9icy4gKi9cbmV4cG9ydCBkZWZhdWx0IGNsYXNzIExvY2FsQmFja2dyb3VuZEpvYnNTdG9yZSB7XG4gIC8qKlxuICAgKiBDcmVhdGVzIGEgc3RvcmUgZm9yIG9uZSBjb25maWd1cmF0aW9uIGFuZCBsb2NhbCBkYXRhYmFzZS5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBTdG9yZSBvcHRpb25zLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL2NvbmZpZ3VyYXRpb24uanNcIikuZGVmYXVsdH0gYXJncy5jb25maWd1cmF0aW9uIC0gT3duaW5nIGNvbmZpZ3VyYXRpb24uXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi90eXBlcy5qc1wiKS5Mb2NhbEJhY2tncm91bmRKb2JzQ2xvY2t9IFthcmdzLmNsb2NrXSAtIFBlcnNpc3RlbmNlIGNsb2NrLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gW2FyZ3MuZGF0YWJhc2VJZGVudGlmaWVyXSAtIENvbmZpZ3VyZWQgbG9jYWwgZGF0YWJhc2UgaWRlbnRpZmllci5cbiAgICogQHBhcmFtIHsoKSA9PiB2b2lkfSBbYXJncy5vbkNvbW1pdHRlZEVucXVldWVdIC0gQ29tbWl0LWF3YXJlIGRpc3BhdGNoZXIgd2FrZS5cbiAgICovXG4gIGNvbnN0cnVjdG9yKHtjb25maWd1cmF0aW9uLCBjbG9jayA9IGxvY2FsQmFja2dyb3VuZEpvYnNDbG9jaygpLCBkYXRhYmFzZUlkZW50aWZpZXIsIG9uQ29tbWl0dGVkRW5xdWV1ZX0pIHtcbiAgICB0aGlzLmNsb2NrID0gY2xvY2tcbiAgICB0aGlzLmNvbmZpZ3VyYXRpb24gPSBjb25maWd1cmF0aW9uXG4gICAgdGhpcy5kYXRhYmFzZUlkZW50aWZpZXIgPSBkYXRhYmFzZUlkZW50aWZpZXJcbiAgICB0aGlzLm9uQ29tbWl0dGVkRW5xdWV1ZSA9IG9uQ29tbWl0dGVkRW5xdWV1ZVxuICAgIHRoaXMuX2lzUmVhZHkgPSBmYWxzZVxuICAgIC8qKiBAdHlwZSB7UHJvbWlzZTx2b2lkPiB8IG51bGx9ICovXG4gICAgdGhpcy5fcmVhZHlQcm9taXNlID0gbnVsbFxuICAgIC8qKiBAdHlwZSB7V2Vha01hcDxpbXBvcnQoXCIuLi9kYXRhYmFzZS9kcml2ZXJzL2Jhc2UuanNcIikuZGVmYXVsdCwge2NvbXBsZXRpb246IFByb21pc2U8dm9pZD4sIHByb21pc2U6IFByb21pc2U8dm9pZD59Pn0gKi9cbiAgICB0aGlzLl90cmFuc2FjdGlvblJlYWR5UHJvbWlzZXMgPSBuZXcgV2Vha01hcCgpXG4gIH1cblxuICAvKipcbiAgICogUmVzb2x2ZXMgdGhlIGNvbmZpZ3VyZWQgbG9jYWwgZGF0YWJhc2UgaWRlbnRpZmllci5cbiAgICogQHJldHVybnMge3N0cmluZ30gLSBEYXRhYmFzZSBpZGVudGlmaWVyLlxuICAgKi9cbiAgZ2V0RGF0YWJhc2VJZGVudGlmaWVyKCkge1xuICAgIHJldHVybiB0aGlzLmRhdGFiYXNlSWRlbnRpZmllciB8fCB0aGlzLmNvbmZpZ3VyYXRpb24uZ2V0QmFja2dyb3VuZEpvYnNDb25maWcoKS5kYXRhYmFzZUlkZW50aWZpZXJcbiAgfVxuXG4gIC8qKlxuICAgKiBFbnN1cmVzIHRoZSB2ZXJzaW9uZWQgcGh5c2ljYWwgc2NoZW1hIGV4aXN0cy5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgd2hlbiByZWFkeS5cbiAgICovXG4gIGFzeW5jIGVuc3VyZVJlYWR5KCkge1xuICAgIGlmICh0aGlzLl9pc1JlYWR5KSByZXR1cm5cblxuICAgIGF3YWl0IHRoaXMuX3dpdGhEYihhc3luYyAoZGIpID0+IGF3YWl0IHRoaXMuX2Vuc3VyZVJlYWR5V2l0aERiKGRiKSlcbiAgfVxuXG4gIC8qKlxuICAgKiBDbGVhcnMgdGhlIHBlci1pbnN0YW5jZSByZWFkaW5lc3MgbGF0Y2ggZm9yIGEgZGVsaWJlcmF0ZSBhZGFwdGVyIHJlb3Blbi5cbiAgICogQHJldHVybnMge3ZvaWR9IC0gTm8gcmV0dXJuIHZhbHVlLlxuICAgKi9cbiAgcmVzZXRSZWFkaW5lc3MoKSB7XG4gICAgdGhpcy5faXNSZWFkeSA9IGZhbHNlXG4gICAgdGhpcy5fcmVhZHlQcm9taXNlID0gbnVsbFxuICAgIHRoaXMuX3RyYW5zYWN0aW9uUmVhZHlQcm9taXNlcyA9IG5ldyBXZWFrTWFwKClcbiAgfVxuXG4gIC8qKlxuICAgKiBDb29yZGluYXRlcyBwaHlzaWNhbCBhbmQgdHJhbnNhY3Rpb24tbG9jYWwgc2NoZW1hIHJlYWRpbmVzcy5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9kYXRhYmFzZS9kcml2ZXJzL2Jhc2UuanNcIikuZGVmYXVsdH0gZGIgLSBMb2NhbCBTUUxpdGUgY29ubmVjdGlvbi5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgd2hlbiB0aGlzIGNhbGxlciBjYW4gdXNlIHRoZSBzY2hlbWEuXG4gICAqL1xuICBhc3luYyBfZW5zdXJlUmVhZHlXaXRoRGIoZGIpIHtcbiAgICBpZiAodGhpcy5faXNSZWFkeSkgcmV0dXJuXG5cbiAgICBjb25zdCB0cmFuc2FjdGlvbkNvbXBsZXRpb24gPSBkYi5pbnNpZGVUcmFuc2FjdGlvbigpID8gZGIudHJhbnNhY3Rpb25Db21wbGV0aW9uKCkgOiBudWxsXG4gICAgY29uc3QgdHJhbnNhY3Rpb25SZWFkeSA9IHRoaXMuX3RyYW5zYWN0aW9uUmVhZHlQcm9taXNlcy5nZXQoZGIpXG5cbiAgICBpZiAodHJhbnNhY3Rpb25Db21wbGV0aW9uICYmIHRyYW5zYWN0aW9uUmVhZHk/LmNvbXBsZXRpb24gPT09IHRyYW5zYWN0aW9uQ29tcGxldGlvbikge1xuICAgICAgYXdhaXQgdHJhbnNhY3Rpb25SZWFkeS5wcm9taXNlXG4gICAgICByZXR1cm5cbiAgICB9XG5cbiAgICBpZiAodGhpcy5fcmVhZHlQcm9taXNlKSB7XG4gICAgICBjb25zdCByZWFkeVByb21pc2UgPSB0aGlzLl9yZWFkeVByb21pc2VcblxuICAgICAgYXdhaXQgcmVhZHlQcm9taXNlXG4gICAgICBpZiAodGhpcy5fcmVhZHlQcm9taXNlID09PSByZWFkeVByb21pc2UpIHRoaXMuX3JlYWR5UHJvbWlzZSA9IG51bGxcbiAgICAgIGlmICh0aGlzLl9pc1JlYWR5KSByZXR1cm5cblxuICAgICAgYXdhaXQgdGhpcy5lbnN1cmVSZWFkeSgpXG4gICAgICByZXR1cm5cbiAgICB9XG5cbiAgICBpZiAodHJhbnNhY3Rpb25Db21wbGV0aW9uKSB7XG4gICAgICBjb25zdCBzY2hlbWFSZWFkeVByb21pc2UgPSB0aGlzLl9hcHBseVNjaGVtYShkYilcbiAgICAgIGNvbnN0IHRyYW5zYWN0aW9uUmVhZHlQcm9taXNlID0gc2NoZW1hUmVhZHlQcm9taXNlLnRoZW4oKCkgPT4gdW5kZWZpbmVkKVxuICAgICAgY29uc3QgdHJhbnNhY3Rpb25SZWFkeSA9IHtjb21wbGV0aW9uOiB0cmFuc2FjdGlvbkNvbXBsZXRpb24sIHByb21pc2U6IHRyYW5zYWN0aW9uUmVhZHlQcm9taXNlfVxuICAgICAgY29uc3QgZHVyYWJsZVJlYWR5UHJvbWlzZSA9IHNjaGVtYVJlYWR5UHJvbWlzZS50aGVuKGFzeW5jIChjaGFuZ2VkKSA9PiB7XG4gICAgICAgIGlmICghY2hhbmdlZCkge1xuICAgICAgICAgIHRoaXMuX2lzUmVhZHkgPSB0cnVlXG4gICAgICAgICAgcmV0dXJuXG4gICAgICAgIH1cblxuICAgICAgICBhd2FpdCB0cmFuc2FjdGlvbkNvbXBsZXRpb25cbiAgICAgIH0sICgpID0+IHtcbiAgICAgICAgLy8gVGhlIHRyYW5zYWN0aW9uLWxvY2FsIGNhbGxlciBiZWxvdyBvd25zIGFuZCByZXRocm93cyB0aGlzIHNhbWUgc2NoZW1hIGVycm9yLlxuICAgICAgICAvLyBUaGlzIGJyYW5jaCBvbmx5IHNldHRsZXMgdGhlIHNoYXJlZCBkdXJhYmlsaXR5IGJhcnJpZXIgc28gaXQgY2Fubm90IGJlY29tZVxuICAgICAgICAvLyBhbiBpbmRlcGVuZGVudCB1bmhhbmRsZWQgcmVqZWN0aW9uIHdoaWxlIGZhaWxlZCBvd25lcnNoaXAgaXMgY2xlYXJlZC5cbiAgICAgIH0pXG5cbiAgICAgIHRoaXMuX3RyYW5zYWN0aW9uUmVhZHlQcm9taXNlcy5zZXQoZGIsIHRyYW5zYWN0aW9uUmVhZHkpXG4gICAgICB0aGlzLl9yZWFkeVByb21pc2UgPSBkdXJhYmxlUmVhZHlQcm9taXNlXG5cbiAgICAgIHRyeSB7XG4gICAgICAgIGF3YWl0IHRyYW5zYWN0aW9uUmVhZHlQcm9taXNlXG4gICAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgICBpZiAodGhpcy5fdHJhbnNhY3Rpb25SZWFkeVByb21pc2VzLmdldChkYikgPT09IHRyYW5zYWN0aW9uUmVhZHkpIHRoaXMuX3RyYW5zYWN0aW9uUmVhZHlQcm9taXNlcy5kZWxldGUoZGIpXG4gICAgICAgIGlmICh0aGlzLl9yZWFkeVByb21pc2UgPT09IGR1cmFibGVSZWFkeVByb21pc2UpIHRoaXMuX3JlYWR5UHJvbWlzZSA9IG51bGxcbiAgICAgICAgdGhyb3cgZXJyb3JcbiAgICAgIH1cbiAgICAgIHJldHVyblxuICAgIH1cblxuICAgIHRoaXMuX3JlYWR5UHJvbWlzZSA9IHRoaXMuX3RyYW5zYWN0aW9uUmVzdWx0KGRiLCBhc3luYyAoKSA9PiBhd2FpdCB0aGlzLl9hcHBseVNjaGVtYShkYikpLnRoZW4oKCkgPT4ge1xuICAgICAgdGhpcy5faXNSZWFkeSA9IHRydWVcbiAgICB9KVxuXG4gICAgdHJ5IHtcbiAgICAgIGF3YWl0IHRoaXMuX3JlYWR5UHJvbWlzZVxuICAgIH0gZmluYWxseSB7XG4gICAgICBpZiAoIXRoaXMuX2lzUmVhZHkpIHRoaXMuX3JlYWR5UHJvbWlzZSA9IG51bGxcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogQ3JlYXRlcyBvciB1cGdyYWRlcyB0aGUgdmVyc2lvbmVkIGxvY2FsIHRhYmxlcyBhbmQgaW5kZXhlcyB3aXRob3V0XG4gICAqIHJlYnVpbGRpbmcgcGVyc2lzdGVkIHF1ZXVlIGRhdGEuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vZGF0YWJhc2UvZHJpdmVycy9iYXNlLmpzXCIpLmRlZmF1bHR9IGRiIC0gTG9jYWwgU1FMaXRlIGNvbm5lY3Rpb24uXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPGJvb2xlYW4+fSAtIFdoZXRoZXIgc2NoZW1hIHN0YXRlIGNoYW5nZWQuXG4gICAqL1xuICBhc3luYyBfYXBwbHlTY2hlbWEoZGIpIHtcbiAgICBsZXQgY2hhbmdlZCA9IGZhbHNlXG5cbiAgICBpZiAoIShhd2FpdCBkYi50YWJsZUV4aXN0cyhNSUdSQVRJT05TX1RBQkxFKSkpIHtcbiAgICAgIGF3YWl0IGRiLmNyZWF0ZVRhYmxlKHRoaXMuX21pZ3JhdGlvbnNUYWJsZURhdGEoKSlcbiAgICAgIGNoYW5nZWQgPSB0cnVlXG4gICAgfVxuXG4gICAgaWYgKCEoYXdhaXQgZGIudGFibGVFeGlzdHMoTE9DQUxfQkFDS0dST1VORF9KT0JTX1RBQkxFKSkpIHtcbiAgICAgIGF3YWl0IGRiLmNyZWF0ZVRhYmxlKHRoaXMuX2pvYnNUYWJsZURhdGEoKSlcbiAgICAgIGNoYW5nZWQgPSB0cnVlXG4gICAgfSBlbHNlIHtcbiAgICAgIGlmIChhd2FpdCB0aGlzLl9lbnN1cmVKb2JDb2x1bW5zKGRiKSkgY2hhbmdlZCA9IHRydWVcbiAgICAgIGF3YWl0IHRoaXMuX2Fzc2VydENvbHVtbnMoZGIsIExPQ0FMX0JBQ0tHUk9VTkRfSk9CU19UQUJMRSwgRVhQRUNURURfSk9CX0NPTFVNTlMpXG4gICAgfVxuXG4gICAgaWYgKCEoYXdhaXQgZGIudGFibGVFeGlzdHMoTE9DQUxfQkFDS0dST1VORF9KT0JfQ09OQ1VSUkVOQ1lfVEFCTEUpKSkge1xuICAgICAgYXdhaXQgZGIuY3JlYXRlVGFibGUodGhpcy5fY29uY3VycmVuY3lUYWJsZURhdGEoKSlcbiAgICAgIGNoYW5nZWQgPSB0cnVlXG4gICAgfSBlbHNlIHtcbiAgICAgIGF3YWl0IHRoaXMuX2Fzc2VydENvbHVtbnMoZGIsIExPQ0FMX0JBQ0tHUk9VTkRfSk9CX0NPTkNVUlJFTkNZX1RBQkxFLCBFWFBFQ1RFRF9DT05DVVJSRU5DWV9DT0xVTU5TKVxuICAgIH1cblxuICAgIGlmICghKGF3YWl0IGRiLnRhYmxlRXhpc3RzKExPQ0FMX0JBQ0tHUk9VTkRfSk9CX1NDSEVEVUxFX0tFWVNfVEFCTEUpKSkge1xuICAgICAgYXdhaXQgZGIuY3JlYXRlVGFibGUodGhpcy5fc2NoZWR1bGVLZXlzVGFibGVEYXRhKCkpXG4gICAgICBjaGFuZ2VkID0gdHJ1ZVxuICAgIH0gZWxzZSB7XG4gICAgICBhd2FpdCB0aGlzLl9hc3NlcnRDb2x1bW5zKGRiLCBMT0NBTF9CQUNLR1JPVU5EX0pPQl9TQ0hFRFVMRV9LRVlTX1RBQkxFLCBFWFBFQ1RFRF9TQ0hFRFVMRV9LRVlfQ09MVU1OUylcbiAgICB9XG5cbiAgICBpZiAoYXdhaXQgdGhpcy5fZW5zdXJlSW5kZXhlcyhkYikpIGNoYW5nZWQgPSB0cnVlXG5cbiAgICBmb3IgKGNvbnN0IHZlcnNpb24gb2YgTUlHUkFUSU9OX1ZFUlNJT05TKSB7XG4gICAgICBpZiAoYXdhaXQgdGhpcy5faGFzTWlncmF0aW9uKGRiLCB2ZXJzaW9uKSkgY29udGludWVcblxuICAgICAgYXdhaXQgdGhpcy5fcmVjb3JkTWlncmF0aW9uKGRiLCB2ZXJzaW9uKVxuICAgICAgY2hhbmdlZCA9IHRydWVcbiAgICB9XG5cbiAgICByZXR1cm4gY2hhbmdlZFxuICB9XG5cbiAgLyoqXG4gICAqIElkZW1wb3RlbnRseSBhZGRzIGNvbHVtbnMgZnJvbSB0aGUgY3VycmVudCBqb2JzIHRhYmxlIGRlZmluaXRpb24gdGhhdCBhblxuICAgKiBleGlzdGluZyBsb2NhbCB0YWJsZSBpcyBtaXNzaW5nLCBzbyBhbiB1cGdyYWRlZCBmcmFtZXdvcmsgZmluZHMgYVxuICAgKiBjb21wYXRpYmxlIHNjaGVtYSBpbnN0ZWFkIG9mIGZhaWxpbmcgdGhlIGNvbHVtbiBhc3NlcnRpb24uXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vZGF0YWJhc2UvZHJpdmVycy9iYXNlLmpzXCIpLmRlZmF1bHR9IGRiIC0gTG9jYWwgU1FMaXRlIGNvbm5lY3Rpb24uXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPGJvb2xlYW4+fSAtIFdoZXRoZXIgYSBjb2x1bW4gd2FzIGFkZGVkLlxuICAgKi9cbiAgYXN5bmMgX2Vuc3VyZUpvYkNvbHVtbnMoZGIpIHtcbiAgICBkYi5jbGVhclNjaGVtYUNhY2hlKClcbiAgICBjb25zdCB0YWJsZSA9IGF3YWl0IGRiLmdldFRhYmxlQnlOYW1lT3JGYWlsKExPQ0FMX0JBQ0tHUk9VTkRfSk9CU19UQUJMRSlcbiAgICBjb25zdCB0YWJsZURhdGEgPSBuZXcgVGFibGVEYXRhKExPQ0FMX0JBQ0tHUk9VTkRfSk9CU19UQUJMRSlcbiAgICBsZXQgYWRkZWQgPSBmYWxzZVxuXG4gICAgZm9yIChjb25zdCBjb2x1bW4gb2YgdGhpcy5fam9ic1RhYmxlRGF0YSgpLmdldENvbHVtbnMoKSkge1xuICAgICAgaWYgKGF3YWl0IHRhYmxlLmdldENvbHVtbkJ5TmFtZShjb2x1bW4uZ2V0TmFtZSgpKSkgY29udGludWVcbiAgICAgIGlmIChjb2x1bW4uZ2V0UHJpbWFyeUtleSgpKSBjb250aW51ZVxuXG4gICAgICBjb25zdCBjb2x1bW5BcmdzID0gLyoqIEB0eXBlIHt7bnVsbDogYm9vbGVhbiwgbWF4TGVuZ3RoPzogbnVtYmVyfX0gKi8gKHtudWxsOiBjb2x1bW4uZ2V0TnVsbCgpICE9PSBmYWxzZX0pXG4gICAgICBjb25zdCBtYXhMZW5ndGggPSBjb2x1bW4uZ2V0TWF4TGVuZ3RoKClcblxuICAgICAgaWYgKHR5cGVvZiBtYXhMZW5ndGggPT09IFwibnVtYmVyXCIpIGNvbHVtbkFyZ3MubWF4TGVuZ3RoID0gbWF4TGVuZ3RoXG5cbiAgICAgIGNvbnN0IHR5cGUgPSBjb2x1bW4uZ2V0VHlwZSgpXG4gICAgICBpZiAodHlwZSA9PT0gXCJzdHJpbmdcIikgdGFibGVEYXRhLnN0cmluZyhjb2x1bW4uZ2V0TmFtZSgpLCBjb2x1bW5BcmdzKVxuICAgICAgZWxzZSBpZiAodHlwZSA9PT0gXCJ0ZXh0XCIpIHRhYmxlRGF0YS50ZXh0KGNvbHVtbi5nZXROYW1lKCksIGNvbHVtbkFyZ3MpXG4gICAgICBlbHNlIGlmICh0eXBlID09PSBcImJpZ2ludFwiKSB0YWJsZURhdGEuYmlnaW50KGNvbHVtbi5nZXROYW1lKCksIGNvbHVtbkFyZ3MpXG4gICAgICBlbHNlIGlmICh0eXBlID09PSBcImludGVnZXJcIikgdGFibGVEYXRhLmludGVnZXIoY29sdW1uLmdldE5hbWUoKSwgY29sdW1uQXJncylcbiAgICAgIGVsc2UgaWYgKHR5cGUgPT09IFwiYm9vbGVhblwiKSB0YWJsZURhdGEuYm9vbGVhbihjb2x1bW4uZ2V0TmFtZSgpLCBjb2x1bW5BcmdzKVxuICAgICAgZWxzZSBjb250aW51ZVxuICAgICAgYWRkZWQgPSB0cnVlXG4gICAgfVxuXG4gICAgaWYgKCFhZGRlZCkgcmV0dXJuIGZhbHNlXG5cbiAgICBmb3IgKGNvbnN0IHNxbCBvZiBhd2FpdCBkYi5hbHRlclRhYmxlU1FMcyh0YWJsZURhdGEpKSBhd2FpdCBkYi5xdWVyeShzcWwpXG4gICAgZGIuY2xlYXJTY2hlbWFDYWNoZSgpXG4gICAgcmV0dXJuIHRydWVcbiAgfVxuXG4gIC8qKlxuICAgKiBCdWlsZHMgdGhlIG1pZ3JhdGlvbiBsZWRnZXIgdGFibGUgZGVmaW5pdGlvbi5cbiAgICogQHJldHVybnMge1RhYmxlRGF0YX0gLSBNaWdyYXRpb24gbGVkZ2VyIHRhYmxlLlxuICAgKi9cbiAgX21pZ3JhdGlvbnNUYWJsZURhdGEoKSB7XG4gICAgY29uc3QgdGFibGUgPSBuZXcgVGFibGVEYXRhKE1JR1JBVElPTlNfVEFCTEUsIHtpZk5vdEV4aXN0czogdHJ1ZX0pXG5cbiAgICB0YWJsZS5zdHJpbmcoXCJrZXlcIiwge251bGw6IGZhbHNlLCBwcmltYXJ5S2V5OiB0cnVlfSlcbiAgICB0YWJsZS5zdHJpbmcoXCJzY29wZVwiLCB7bnVsbDogZmFsc2V9KVxuICAgIHRhYmxlLnN0cmluZyhcInZlcnNpb25cIiwge251bGw6IGZhbHNlfSlcbiAgICB0YWJsZS5iaWdpbnQoXCJhcHBsaWVkX2F0X21zXCIsIHtudWxsOiBmYWxzZX0pXG4gICAgcmV0dXJuIHRhYmxlXG4gIH1cblxuICAvKipcbiAgICogQnVpbGRzIHRoZSBsb2NhbCBqb2JzIHRhYmxlIGRlZmluaXRpb24uXG4gICAqIEByZXR1cm5zIHtUYWJsZURhdGF9IC0gTG9jYWwgam9icyB0YWJsZSBkZWZpbml0aW9uLlxuICAgKi9cbiAgX2pvYnNUYWJsZURhdGEoKSB7XG4gICAgY29uc3QgdGFibGUgPSBuZXcgVGFibGVEYXRhKExPQ0FMX0JBQ0tHUk9VTkRfSk9CU19UQUJMRSwge2lmTm90RXhpc3RzOiB0cnVlfSlcblxuICAgIHRhYmxlLnN0cmluZyhcImlkXCIsIHtudWxsOiBmYWxzZSwgcHJpbWFyeUtleTogdHJ1ZX0pXG4gICAgdGFibGUuc3RyaW5nKFwiam9iX25hbWVcIiwge251bGw6IGZhbHNlfSlcbiAgICB0YWJsZS50ZXh0KFwiYXJnc19qc29uXCIsIHtudWxsOiBmYWxzZX0pXG4gICAgdGFibGUuc3RyaW5nKFwiYXJnc19kaWdlc3RcIiwge21heExlbmd0aDogNjQsIG51bGw6IGZhbHNlfSlcbiAgICB0YWJsZS5zdHJpbmcoXCJleGVjdXRpb25fbW9kZVwiLCB7bnVsbDogZmFsc2V9KVxuICAgIHRhYmxlLnN0cmluZyhcInF1ZXVlXCIsIHtudWxsOiBmYWxzZX0pXG4gICAgdGFibGUuc3RyaW5nKFwic2NoZWR1bGVfa2V5XCIsIHtudWxsOiB0cnVlfSlcbiAgICB0YWJsZS5iaWdpbnQoXCJzY2hlZHVsZV9vcmRlclwiLCB7bnVsbDogdHJ1ZX0pXG4gICAgdGFibGUuaW50ZWdlcihcIm1heF9yZXRyaWVzXCIsIHtudWxsOiBmYWxzZX0pXG4gICAgdGFibGUuaW50ZWdlcihcImF0dGVtcHRzXCIsIHtudWxsOiBmYWxzZX0pXG4gICAgdGFibGUuc3RyaW5nKFwic3RhdHVzXCIsIHtudWxsOiBmYWxzZX0pXG4gICAgdGFibGUuYmlnaW50KFwic2NoZWR1bGVkX2F0X21zXCIsIHtudWxsOiBmYWxzZX0pXG4gICAgdGFibGUuYmlnaW50KFwiY3JlYXRlZF9hdF9tc1wiLCB7bnVsbDogZmFsc2V9KVxuICAgIHRhYmxlLmJpZ2ludChcImhhbmRlZF9vZmZfYXRfbXNcIiwge251bGw6IHRydWV9KVxuICAgIHRhYmxlLnN0cmluZyhcImhhbmRvZmZfaWRcIiwge251bGw6IHRydWV9KVxuICAgIHRhYmxlLnN0cmluZyhcIndvcmtlcl9pZFwiLCB7bnVsbDogdHJ1ZX0pXG4gICAgdGFibGUuYmlnaW50KFwiY29tcGxldGVkX2F0X21zXCIsIHtudWxsOiB0cnVlfSlcbiAgICB0YWJsZS5iaWdpbnQoXCJmYWlsZWRfYXRfbXNcIiwge251bGw6IHRydWV9KVxuICAgIHRhYmxlLnRleHQoXCJsYXN0X2Vycm9yXCIsIHtudWxsOiB0cnVlfSlcbiAgICB0YWJsZS5zdHJpbmcoXCJjb25jdXJyZW5jeV9rZXlcIiwge251bGw6IHRydWV9KVxuICAgIHRhYmxlLmludGVnZXIoXCJtYXhfY29uY3VycmVuY3lcIiwge251bGw6IHRydWV9KVxuICAgIHRhYmxlLmJpZ2ludChcImNoaWxkX3JlY2VpdmVkX2F0X21zXCIsIHtudWxsOiB0cnVlfSlcbiAgICB0YWJsZS5iaWdpbnQoXCJjaGlsZF9zdGFydGVkX2F0X21zXCIsIHtudWxsOiB0cnVlfSlcbiAgICB0YWJsZS5zdHJpbmcoXCJjaGlsZF9pbnN0YW5jZV9pZFwiLCB7bnVsbDogdHJ1ZX0pXG4gICAgdGFibGUuaW50ZWdlcihcImNoaWxkX3BpZFwiLCB7bnVsbDogdHJ1ZX0pXG4gICAgdGFibGUuc3RyaW5nKFwicnVubmVyX2hvc3RuYW1lXCIsIHtudWxsOiB0cnVlfSlcbiAgICB0YWJsZS5hZGRJbmRleChuZXcgVGFibGVJbmRleChbXCJzdGF0dXNcIiwgXCJzY2hlZHVsZWRfYXRfbXNcIiwgXCJjcmVhdGVkX2F0X21zXCIsIFwiaWRcIl0sIHtuYW1lOiBMT0NBTF9CQUNLR1JPVU5EX0pPQlNfSU5ERVhfTkFNRVNbMF19KSlcbiAgICB0YWJsZS5hZGRJbmRleChuZXcgVGFibGVJbmRleChbXCJxdWV1ZVwiLCBcInN0YXR1c1wiLCBcImNyZWF0ZWRfYXRfbXNcIl0sIHtuYW1lOiBMT0NBTF9CQUNLR1JPVU5EX0pPQlNfSU5ERVhfTkFNRVNbMV19KSlcbiAgICB0YWJsZS5hZGRJbmRleChuZXcgVGFibGVJbmRleChbXCJhcmdzX2RpZ2VzdFwiXSwge25hbWU6IExPQ0FMX0JBQ0tHUk9VTkRfSk9CU19JTkRFWF9OQU1FU1syXX0pKVxuICAgIHRhYmxlLmFkZEluZGV4KG5ldyBUYWJsZUluZGV4KFtcInN0YXR1c1wiLCBcImNvbmN1cnJlbmN5X2tleVwiLCBcInNjaGVkdWxlZF9hdF9tc1wiXSwge25hbWU6IExPQ0FMX0JBQ0tHUk9VTkRfSk9CU19JTkRFWF9OQU1FU1szXX0pKVxuICAgIHRhYmxlLmFkZEluZGV4KG5ldyBUYWJsZUluZGV4KFtcInNjaGVkdWxlX2tleVwiLCBcImNyZWF0ZWRfYXRfbXNcIiwgXCJpZFwiXSwge25hbWU6IExPQ0FMX0JBQ0tHUk9VTkRfSk9CU19JTkRFWF9OQU1FU1s0XX0pKVxuICAgIHRhYmxlLmFkZEluZGV4KG5ldyBUYWJsZUluZGV4KFtcInNjaGVkdWxlX2tleVwiLCBcInNjaGVkdWxlX29yZGVyXCIsIFwiY3JlYXRlZF9hdF9tc1wiLCBcImlkXCJdLCB7bmFtZTogTE9DQUxfQkFDS0dST1VORF9KT0JTX0lOREVYX05BTUVTWzVdfSkpXG4gICAgcmV0dXJuIHRhYmxlXG4gIH1cblxuICAvKipcbiAgICogQnVpbGRzIHRoZSBsb2NhbCBjb25jdXJyZW5jeSBjb3VudGVyIHRhYmxlIGRlZmluaXRpb24uXG4gICAqIEByZXR1cm5zIHtUYWJsZURhdGF9IC0gQ29uY3VycmVuY3kgY291bnRlciB0YWJsZSBkZWZpbml0aW9uLlxuICAgKi9cbiAgX2NvbmN1cnJlbmN5VGFibGVEYXRhKCkge1xuICAgIGNvbnN0IHRhYmxlID0gbmV3IFRhYmxlRGF0YShMT0NBTF9CQUNLR1JPVU5EX0pPQl9DT05DVVJSRU5DWV9UQUJMRSwge2lmTm90RXhpc3RzOiB0cnVlfSlcblxuICAgIHRhYmxlLnN0cmluZyhcImNvbmN1cnJlbmN5X2tleVwiLCB7bnVsbDogZmFsc2UsIHByaW1hcnlLZXk6IHRydWV9KVxuICAgIHRhYmxlLmludGVnZXIoXCJtYXhfY29uY3VycmVuY3lcIiwge251bGw6IGZhbHNlfSlcbiAgICB0YWJsZS5pbnRlZ2VyKFwiYWN0aXZlX2NvdW50XCIsIHtudWxsOiBmYWxzZX0pXG4gICAgcmV0dXJuIHRhYmxlXG4gIH1cblxuICAvKipcbiAgICogQnVpbGRzIHRoZSBzdGFibGUgc2NoZWR1bGUtb3duZXIgdGFibGUgZGVmaW5pdGlvbi5cbiAgICogQHJldHVybnMge1RhYmxlRGF0YX0gLSBTdGFibGUgb3duZXIgdGFibGUgZGVmaW5pdGlvbi5cbiAgICovXG4gIF9zY2hlZHVsZUtleXNUYWJsZURhdGEoKSB7XG4gICAgY29uc3QgdGFibGUgPSBuZXcgVGFibGVEYXRhKExPQ0FMX0JBQ0tHUk9VTkRfSk9CX1NDSEVEVUxFX0tFWVNfVEFCTEUsIHtpZk5vdEV4aXN0czogdHJ1ZX0pXG5cbiAgICB0YWJsZS5zdHJpbmcoXCJzY2hlZHVsZV9rZXlcIiwge251bGw6IGZhbHNlLCBwcmltYXJ5S2V5OiB0cnVlfSlcbiAgICB0YWJsZS5zdHJpbmcoXCJqb2JfaWRcIiwge251bGw6IGZhbHNlfSlcbiAgICB0YWJsZS5hZGRJbmRleChuZXcgVGFibGVJbmRleChbXCJqb2JfaWRcIl0sIHtuYW1lOiBMT0NBTF9CQUNLR1JPVU5EX0pPQl9TQ0hFRFVMRV9LRVlTX0lOREVYX05BTUVTWzBdfSkpXG4gICAgcmV0dXJuIHRhYmxlXG4gIH1cblxuICAvKipcbiAgICogUmVqZWN0cyBhbiBpbmNvbXBhdGlibGUgY3VycmVudC12ZXJzaW9uIHRhYmxlIHJhdGhlciB0aGFuIHJlYnVpbGRpbmcgZGF0YS5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9kYXRhYmFzZS9kcml2ZXJzL2Jhc2UuanNcIikuZGVmYXVsdH0gZGIgLSBMb2NhbCBTUUxpdGUgY29ubmVjdGlvbi5cbiAgICogQHBhcmFtIHtzdHJpbmd9IHRhYmxlTmFtZSAtIFRhYmxlIG5hbWUuXG4gICAqIEBwYXJhbSB7c3RyaW5nW119IGV4cGVjdGVkQ29sdW1ucyAtIFJlcXVpcmVkIGNvbHVtbnMuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIHdoZW4gY29tcGF0aWJsZS5cbiAgICovXG4gIGFzeW5jIF9hc3NlcnRDb2x1bW5zKGRiLCB0YWJsZU5hbWUsIGV4cGVjdGVkQ29sdW1ucykge1xuICAgIGNvbnN0IHRhYmxlID0gYXdhaXQgZGIuZ2V0VGFibGVCeU5hbWVPckZhaWwodGFibGVOYW1lKVxuICAgIGNvbnN0IGNvbHVtbnMgPSBhd2FpdCB0YWJsZS5nZXRDb2x1bW5zKClcbiAgICBjb25zdCBuYW1lcyA9IG5ldyBTZXQoY29sdW1ucy5tYXAoKGNvbHVtbikgPT4gY29sdW1uLmdldE5hbWUoKSkpXG4gICAgY29uc3QgbWlzc2luZyA9IGV4cGVjdGVkQ29sdW1ucy5maWx0ZXIoKGNvbHVtbk5hbWUpID0+ICFuYW1lcy5oYXMoY29sdW1uTmFtZSkpXG5cbiAgICBpZiAobWlzc2luZy5sZW5ndGggPT09IDApIHJldHVyblxuXG4gICAgY29uc3QgZXJyb3IgPSBuZXcgRXJyb3IoYEluY29tcGF0aWJsZSBsb2NhbCBiYWNrZ3JvdW5kLWpvYnMgc2NoZW1hIGZvciAke3RhYmxlTmFtZX07IG1pc3NpbmcgY29sdW1uczogJHttaXNzaW5nLmpvaW4oXCIsIFwiKX1gKVxuXG4gICAgdGhpcy5fcmVwb3J0RnJhbWV3b3JrRXJyb3Ioe2Vycm9yLCBzdGFnZTogXCJsb2NhbC1iYWNrZ3JvdW5kLWpvYnMtc2NoZW1hXCJ9KVxuICAgIHRocm93IGVycm9yXG4gIH1cblxuICAvKipcbiAgICogUmVjcmVhdGVzIG1pc3NpbmcgaW5kZXhlcyBkZWNsYXJlZCBieSB0aGUgY3VycmVudCBzY2hlbWEuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vZGF0YWJhc2UvZHJpdmVycy9iYXNlLmpzXCIpLmRlZmF1bHR9IGRiIC0gTG9jYWwgU1FMaXRlIGNvbm5lY3Rpb24uXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPGJvb2xlYW4+fSAtIFdoZXRoZXIgYW4gaW5kZXggd2FzIGNyZWF0ZWQuXG4gICAqL1xuICBhc3luYyBfZW5zdXJlSW5kZXhlcyhkYikge1xuICAgIGRiLmNsZWFyU2NoZW1hQ2FjaGUoKVxuICAgIGxldCBjaGFuZ2VkID0gZmFsc2VcbiAgICAvKiogQHR5cGUge0FycmF5PFtzdHJpbmcsIFRhYmxlRGF0YV0+fSAqL1xuICAgIGNvbnN0IGRlZmluaXRpb25zID0gW1xuICAgICAgW0xPQ0FMX0JBQ0tHUk9VTkRfSk9CU19UQUJMRSwgdGhpcy5fam9ic1RhYmxlRGF0YSgpXSxcbiAgICAgIFtMT0NBTF9CQUNLR1JPVU5EX0pPQl9TQ0hFRFVMRV9LRVlTX1RBQkxFLCB0aGlzLl9zY2hlZHVsZUtleXNUYWJsZURhdGEoKV1cbiAgICBdXG5cbiAgICBmb3IgKGNvbnN0IFt0YWJsZU5hbWUsIHRhYmxlRGF0YV0gb2YgZGVmaW5pdGlvbnMpIHtcbiAgICAgIGNvbnN0IHRhYmxlID0gYXdhaXQgZGIuZ2V0VGFibGVCeU5hbWVPckZhaWwodGFibGVOYW1lKVxuICAgICAgY29uc3QgZXhpc3RpbmdOYW1lcyA9IG5ldyBTZXQoKGF3YWl0IHRhYmxlLmdldEluZGV4ZXMoKSkubWFwKChpbmRleCkgPT4gaW5kZXguZ2V0TmFtZSgpKSlcblxuICAgICAgZm9yIChjb25zdCBpbmRleCBvZiB0YWJsZURhdGEuZ2V0SW5kZXhlcygpKSB7XG4gICAgICAgIGNvbnN0IGluZGV4TmFtZSA9IGluZGV4LmdldE5hbWUoKVxuXG4gICAgICAgIGlmICghaW5kZXhOYW1lIHx8IGV4aXN0aW5nTmFtZXMuaGFzKGluZGV4TmFtZSkpIGNvbnRpbnVlXG5cbiAgICAgICAgY29uc3Qgc3FscyA9IGF3YWl0IGRiLmNyZWF0ZUluZGV4U1FMcyh7XG4gICAgICAgICAgY29sdW1uczogaW5kZXguZ2V0Q29sdW1ucygpLFxuICAgICAgICAgIGlmTm90RXhpc3RzOiB0cnVlLFxuICAgICAgICAgIG5hbWU6IGluZGV4TmFtZSxcbiAgICAgICAgICB0YWJsZU5hbWUsXG4gICAgICAgICAgdW5pcXVlOiBpbmRleC5nZXRVbmlxdWUoKVxuICAgICAgICB9KVxuXG4gICAgICAgIGZvciAoY29uc3Qgc3FsIG9mIHNxbHMpIGF3YWl0IGRiLnF1ZXJ5KHNxbClcbiAgICAgICAgY2hhbmdlZCA9IHRydWVcbiAgICAgIH1cbiAgICB9XG5cbiAgICBpZiAoY2hhbmdlZCkgZGIuY2xlYXJTY2hlbWFDYWNoZSgpXG4gICAgcmV0dXJuIGNoYW5nZWRcbiAgfVxuXG4gIC8qKlxuICAgKiBDaGVja3Mgd2hldGhlciB0aGUgY3VycmVudCBsb2NhbCBzY2hlbWEgdmVyc2lvbiBpcyByZWNvcmRlZC5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9kYXRhYmFzZS9kcml2ZXJzL2Jhc2UuanNcIikuZGVmYXVsdH0gZGIgLSBDb25uZWN0aW9uLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gdmVyc2lvbiAtIExvY2FsIHNjaGVtYSB2ZXJzaW9uLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxib29sZWFuPn0gLSBXaGV0aGVyIHRoZSB2ZXJzaW9uIGlzIHJlY29yZGVkLlxuICAgKi9cbiAgYXN5bmMgX2hhc01pZ3JhdGlvbihkYiwgdmVyc2lvbikge1xuICAgIGNvbnN0IHJvd3MgPSBhd2FpdCBkYlxuICAgICAgLm5ld1F1ZXJ5KClcbiAgICAgIC5mcm9tKE1JR1JBVElPTlNfVEFCTEUpXG4gICAgICAud2hlcmUoe2tleTogdGhpcy5fbWlncmF0aW9uS2V5KHZlcnNpb24pfSlcbiAgICAgIC5saW1pdCgxKVxuICAgICAgLnJlc3VsdHMoKVxuXG4gICAgcmV0dXJuIHJvd3MubGVuZ3RoID4gMFxuICB9XG5cbiAgLyoqXG4gICAqIFJlY29yZHMgb25lIGxvY2FsIHNjaGVtYSB2ZXJzaW9uIGFmdGVyIGl0cyBhZGRpdGl2ZSBjaGFuZ2VzIGFyZSBwcmVzZW50LlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL2RhdGFiYXNlL2RyaXZlcnMvYmFzZS5qc1wiKS5kZWZhdWx0fSBkYiAtIENvbm5lY3Rpb24uXG4gICAqIEBwYXJhbSB7c3RyaW5nfSB2ZXJzaW9uIC0gTG9jYWwgc2NoZW1hIHZlcnNpb24uXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIGFmdGVyIHJlY29yZGluZy5cbiAgICovXG4gIGFzeW5jIF9yZWNvcmRNaWdyYXRpb24oZGIsIHZlcnNpb24pIHtcbiAgICBhd2FpdCBkYi51cHNlcnQoe1xuICAgICAgdGFibGVOYW1lOiBNSUdSQVRJT05TX1RBQkxFLFxuICAgICAgZGF0YToge1xuICAgICAgICBhcHBsaWVkX2F0X21zOiB0aGlzLmNsb2NrLm5vdygpLFxuICAgICAgICBrZXk6IHRoaXMuX21pZ3JhdGlvbktleSh2ZXJzaW9uKSxcbiAgICAgICAgc2NvcGU6IE1JR1JBVElPTl9TQ09QRSxcbiAgICAgICAgdmVyc2lvblxuICAgICAgfSxcbiAgICAgIGNvbmZsaWN0Q29sdW1uczogW1wia2V5XCJdLFxuICAgICAgdXBkYXRlQ29sdW1uczogW1wic2NvcGVcIiwgXCJ2ZXJzaW9uXCIsIFwiYXBwbGllZF9hdF9tc1wiXVxuICAgIH0pXG4gIH1cblxuICAvKipcbiAgICogQnVpbGRzIHRoZSBzY29wZWQgbWlncmF0aW9uIGtleS5cbiAgICogQHBhcmFtIHtzdHJpbmd9IHZlcnNpb24gLSBMb2NhbCBzY2hlbWEgdmVyc2lvbi5cbiAgICogQHJldHVybnMge3N0cmluZ30gLSBTY29wZWQgbWlncmF0aW9uIGtleS5cbiAgICovXG4gIF9taWdyYXRpb25LZXkodmVyc2lvbikgeyByZXR1cm4gYCR7TUlHUkFUSU9OX1NDT1BFfToke3ZlcnNpb259YCB9XG5cbiAgLyoqXG4gICAqIEVucXVldWVzIGEgbG9jYWwgam9iIGluIHRoZSBjYWxsZXIncyBhY3RpdmUgdHJhbnNhY3Rpb24gd2hlbiBwcmVzZW50LlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIEVucXVldWUgcmVxdWVzdC5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGFyZ3Muam9iTmFtZSAtIFJlZ2lzdGVyZWQgam9iIG5hbWUuXG4gICAqIEBwYXJhbSB7QXJyYXk8UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSBhcmdzLmFyZ3MgLSBTZXJpYWxpemVkIGpvYiBhcmd1bWVudHMuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi90eXBlcy5qc1wiKS5CYWNrZ3JvdW5kSm9iT3B0aW9uc30gW2FyZ3Mub3B0aW9uc10gLSBKb2Igb3B0aW9ucy5cbiAgICogQHJldHVybnMge1Byb21pc2U8c3RyaW5nPn0gLSBEdXJhYmxlIGpvYiBpZC5cbiAgICovXG4gIGFzeW5jIGVucXVldWUoe2pvYk5hbWUsIGFyZ3MsIG9wdGlvbnMgPSB7fX0pIHtcbiAgICBhd2FpdCB0aGlzLmVuc3VyZVJlYWR5KClcblxuICAgIGNvbnN0IHByZXBhcmVkSm9iID0gdGhpcy5fcHJlcGFyZUpvYih7YXJncywgam9iTmFtZSwgb3B0aW9uc30pXG4gICAgY29uc3QgbXV0YXRlID0gYXN5bmMgKGhvbGRVbnRpbCA9ICgvKiogQHR5cGUge1Byb21pc2U8dm9pZD59ICovIF9jb21wbGV0aW9uKSA9PiB7fSkgPT4gYXdhaXQgdGhpcy5fd2l0aERiKGFzeW5jIChjb25uZWN0aW9uKSA9PiB7XG4gICAgICBpZiAoY29ubmVjdGlvbi5pbnNpZGVUcmFuc2FjdGlvbigpKSBob2xkVW50aWwoY29ubmVjdGlvbi50cmFuc2FjdGlvbkNvbXBsZXRpb24oKSlcblxuICAgICAgcmV0dXJuIGF3YWl0IHRoaXMuX211dGF0ZShjb25uZWN0aW9uLCBhc3luYyAoZGIpID0+IHtcbiAgICAgICAgbGV0IGpvYklkID0gcHJlcGFyZWRKb2Iuam9iSWRcblxuICAgICAgICBpZiAocHJlcGFyZWRKb2IuY29uY3VycmVuY3kpIGF3YWl0IHRoaXMuX2Vuc3VyZUNvbmN1cnJlbmN5KGRiLCBwcmVwYXJlZEpvYi5jb25jdXJyZW5jeSlcblxuICAgICAgICBpZiAob3B0aW9ucy5kZWR1cGxpY2F0ZVdoaWxlUXVldWVkKSB7XG4gICAgICAgICAgY29uc3QgZXhpc3RpbmcgPSBhd2FpdCBkYlxuICAgICAgICAgICAgLm5ld1F1ZXJ5KClcbiAgICAgICAgICAgIC5mcm9tKExPQ0FMX0JBQ0tHUk9VTkRfSk9CU19UQUJMRSlcbiAgICAgICAgICAgIC5zZWxlY3QoXCJpZFwiKVxuICAgICAgICAgICAgLndoZXJlKHtcbiAgICAgICAgICAgICAgYXJnc19kaWdlc3Q6IHByZXBhcmVkSm9iLmFyZ3NEaWdlc3QsXG4gICAgICAgICAgICAgIGFyZ3NfanNvbjogcHJlcGFyZWRKb2IuYXJnc0pzb24sXG4gICAgICAgICAgICAgIGpvYl9uYW1lOiBwcmVwYXJlZEpvYi5qb2JOYW1lLFxuICAgICAgICAgICAgICBxdWV1ZTogcHJlcGFyZWRKb2IucXVldWUsXG4gICAgICAgICAgICAgIHN0YXR1czogXCJxdWV1ZWRcIlxuICAgICAgICAgICAgfSlcbiAgICAgICAgICAgIC53aGVyZShgc2NoZWR1bGVkX2F0X21zIDw9ICR7ZGIucXVvdGUocHJlcGFyZWRKb2Iuc2NoZWR1bGVkQXRNcyl9YClcbiAgICAgICAgICAgIC5vcmRlcihcInNjaGVkdWxlZF9hdF9tcyBBU0NcIilcbiAgICAgICAgICAgIC5vcmRlcihcImNyZWF0ZWRfYXRfbXMgQVNDXCIpXG4gICAgICAgICAgICAubGltaXQoMSlcbiAgICAgICAgICAgIC5yZXN1bHRzKClcblxuICAgICAgICAgIGNvbnN0IGV4aXN0aW5nUm93ID0gLyoqIEB0eXBlIHt7aWQ6IHN0cmluZyB8IG51bWJlcn0gfCB1bmRlZmluZWR9ICovIChleGlzdGluZ1swXSlcblxuICAgICAgICAgIGlmIChleGlzdGluZ1Jvdykgam9iSWQgPSBTdHJpbmcoZXhpc3RpbmdSb3cuaWQpXG4gICAgICAgIH1cblxuICAgICAgICBpZiAoam9iSWQgPT09IHByZXBhcmVkSm9iLmpvYklkKSBhd2FpdCB0aGlzLl9pbnNlcnRQcmVwYXJlZEpvYihkYiwgcHJlcGFyZWRKb2IpXG4gICAgICAgIGlmICh0aGlzLm9uQ29tbWl0dGVkRW5xdWV1ZSkgYXdhaXQgZGIuYWZ0ZXJDb21taXQodGhpcy5vbkNvbW1pdHRlZEVucXVldWUpXG5cbiAgICAgICAgcmV0dXJuIGpvYklkXG4gICAgICB9KVxuICAgIH0pXG5cbiAgICBpZiAob3B0aW9ucy5kZWR1cGxpY2F0ZVdoaWxlUXVldWVkKSByZXR1cm4gYXdhaXQgdGhpcy5fc2VyaWFsaXplRGVkdXBsaWNhdGVkRW5xdWV1ZShwcmVwYXJlZEpvYiwgbXV0YXRlKVxuICAgIHJldHVybiBhd2FpdCBtdXRhdGUoKVxuICB9XG5cbiAgLyoqXG4gICAqIFJlcGxhY2VzIHRoZSBxdWV1ZWQgb3duZXIgb2YgYSBzdGFibGUgc2NoZWR1bGUga2V5IHdpdGggYSBuZXcgbG9jYWwgam9iLlxuICAgKiBBIGhhbmRlZC1vZmYgb3duZXIgcmVtYWlucyBydW5uYWJsZSBidXQgaXMgZGV0YWNoZWQgZnJvbSBmdXR1cmUgb3duZXJzaGlwLlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIFJlcGxhY2VtZW50IHJlcXVlc3QuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBhcmdzLnNjaGVkdWxlS2V5IC0gU3RhYmxlIGxvZ2ljYWwgc2NoZWR1bGUga2V5LlxuICAgKiBAcGFyYW0ge3N0cmluZ30gYXJncy5qb2JOYW1lIC0gUmVnaXN0ZXJlZCBqb2IgbmFtZS5cbiAgICogQHBhcmFtIHtBcnJheTxSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59IGFyZ3MuYXJncyAtIFNlcmlhbGl6ZWQgam9iIGFyZ3VtZW50cy5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL3R5cGVzLmpzXCIpLkJhY2tncm91bmRKb2JPcHRpb25zfSBbYXJncy5vcHRpb25zXSAtIEpvYiBvcHRpb25zLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxpbXBvcnQoXCIuL3R5cGVzLmpzXCIpLkJhY2tncm91bmRKb2JSZXBsYWNlbWVudFJlc3VsdD59IC0gUmVwbGFjZW1lbnQgcmVzdWx0LlxuICAgKi9cbiAgYXN5bmMgcmVwbGFjZVNjaGVkdWxlZCh7c2NoZWR1bGVLZXksIGpvYk5hbWUsIGFyZ3MsIG9wdGlvbnMgPSB7fX0pIHtcbiAgICBhd2FpdCB0aGlzLmVuc3VyZVJlYWR5KClcblxuICAgIGNvbnN0IG5vcm1hbGl6ZWRTY2hlZHVsZUtleSA9IG5vcm1hbGl6ZUJhY2tncm91bmRKb2JTY2hlZHVsZUtleShzY2hlZHVsZUtleSlcbiAgICBjb25zdCBwcmVwYXJlZEpvYiA9IHRoaXMuX3ByZXBhcmVKb2Ioe2FyZ3MsIGpvYk5hbWUsIG9wdGlvbnN9KVxuXG4gICAgcmV0dXJuIGF3YWl0IHRoaXMuX3dpdGhEYihhc3luYyAoY29ubmVjdGlvbikgPT4gYXdhaXQgdGhpcy5fbXV0YXRlKGNvbm5lY3Rpb24sIGFzeW5jIChkYikgPT4ge1xuICAgICAgYXdhaXQgdGhpcy5fbG9ja1NjaGVkdWxlS2V5KGRiLCBub3JtYWxpemVkU2NoZWR1bGVLZXkpXG4gICAgICBjb25zdCBvd25lckpvYiA9IGF3YWl0IHRoaXMuX3NjaGVkdWxlZE93bmVySm9iKGRiLCBub3JtYWxpemVkU2NoZWR1bGVLZXkpXG4gICAgICAvKiogQHR5cGUge2ltcG9ydChcIi4vdHlwZXMuanNcIikuQmFja2dyb3VuZEpvYlJlcGxhY2VtZW50UHJldmlvdXNTdGF0dXN9ICovXG4gICAgICBsZXQgcHJldmlvdXNTdGF0dXMgPSBudWxsXG4gICAgICBsZXQgcHJldmlvdXNKb2JJZCA9IG51bGxcblxuICAgICAgaWYgKG93bmVySm9iPy5zdGF0dXMgPT09IFwicXVldWVkXCIpIHtcbiAgICAgICAgY29uc3QgYWZmZWN0ZWRSb3dzID0gYXdhaXQgdGhpcy5fdXBkYXRlQWZmZWN0ZWRSb3dzKGRiLCB7XG4gICAgICAgICAgY29uZGl0aW9uczoge2lkOiBvd25lckpvYi5pZCwgc3RhdHVzOiBcInF1ZXVlZFwifSxcbiAgICAgICAgICBkYXRhOiB7c3RhdHVzOiBcImNhbmNlbGxlZFwifSxcbiAgICAgICAgICB0YWJsZU5hbWU6IExPQ0FMX0JBQ0tHUk9VTkRfSk9CU19UQUJMRVxuICAgICAgICB9KVxuXG4gICAgICAgIGlmIChhZmZlY3RlZFJvd3MgPT09IDEpIHtcbiAgICAgICAgICBwcmV2aW91c0pvYklkID0gb3duZXJKb2IuaWRcbiAgICAgICAgICBwcmV2aW91c1N0YXR1cyA9IFwicXVldWVkXCJcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICBjb25zdCBjdXJyZW50T3duZXJKb2IgPSBhd2FpdCB0aGlzLl9nZXRKb2IoZGIsIG93bmVySm9iLmlkKVxuXG4gICAgICAgICAgaWYgKGN1cnJlbnRPd25lckpvYj8uc3RhdHVzID09PSBcImhhbmRlZF9vZmZcIikge1xuICAgICAgICAgICAgcHJldmlvdXNKb2JJZCA9IGN1cnJlbnRPd25lckpvYi5pZFxuICAgICAgICAgICAgcHJldmlvdXNTdGF0dXMgPSBcImhhbmRlZF9vZmZcIlxuICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgICAgfSBlbHNlIGlmIChvd25lckpvYj8uc3RhdHVzID09PSBcImhhbmRlZF9vZmZcIikge1xuICAgICAgICBwcmV2aW91c0pvYklkID0gb3duZXJKb2IuaWRcbiAgICAgICAgcHJldmlvdXNTdGF0dXMgPSBcImhhbmRlZF9vZmZcIlxuICAgICAgfVxuXG4gICAgICBjb25zdCBzY2hlZHVsZU9yZGVyID0gYXdhaXQgdGhpcy5fbmV4dFNjaGVkdWxlT3JkZXIoZGIsIG5vcm1hbGl6ZWRTY2hlZHVsZUtleSlcblxuICAgICAgaWYgKHByZXBhcmVkSm9iLmNvbmN1cnJlbmN5KSBhd2FpdCB0aGlzLl9lbnN1cmVDb25jdXJyZW5jeShkYiwgcHJlcGFyZWRKb2IuY29uY3VycmVuY3kpXG4gICAgICBhd2FpdCB0aGlzLl9pbnNlcnRQcmVwYXJlZEpvYihkYiwgcHJlcGFyZWRKb2IsIG5vcm1hbGl6ZWRTY2hlZHVsZUtleSwgc2NoZWR1bGVPcmRlcilcbiAgICAgIGF3YWl0IGRiLnVwc2VydCh7XG4gICAgICAgIGNvbmZsaWN0Q29sdW1uczogW1wic2NoZWR1bGVfa2V5XCJdLFxuICAgICAgICBkYXRhOiB7am9iX2lkOiBwcmVwYXJlZEpvYi5qb2JJZCwgc2NoZWR1bGVfa2V5OiBub3JtYWxpemVkU2NoZWR1bGVLZXl9LFxuICAgICAgICB0YWJsZU5hbWU6IExPQ0FMX0JBQ0tHUk9VTkRfSk9CX1NDSEVEVUxFX0tFWVNfVEFCTEUsXG4gICAgICAgIHVwZGF0ZUNvbHVtbnM6IFtcImpvYl9pZFwiXVxuICAgICAgfSlcbiAgICAgIGF3YWl0IHRoaXMuX3dha2VEaXNwYXRjaGVyQWZ0ZXJDb21taXQoZGIpXG5cbiAgICAgIHJldHVybiB7am9iSWQ6IHByZXBhcmVkSm9iLmpvYklkLCBwcmV2aW91c0pvYklkLCBwcmV2aW91c1N0YXR1c31cbiAgICB9KSlcbiAgfVxuXG4gIC8qKlxuICAgKiBDYW5jZWxzIGEgcXVldWVkIHN0YWJsZSBvd25lciBvciBkZXRhY2hlcyBhbiBhY3RpdmUgaGFuZG9mZiB0cnV0aGZ1bGx5LlxuICAgKiBAcGFyYW0ge3N0cmluZ30gc2NoZWR1bGVLZXkgLSBTdGFibGUgbG9naWNhbCBzY2hlZHVsZSBrZXkuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPGltcG9ydChcIi4vdHlwZXMuanNcIikuQmFja2dyb3VuZEpvYkNhbmNlbGxhdGlvblJlc3VsdD59IC0gQ2FuY2VsbGF0aW9uIHJlc3VsdC5cbiAgICovXG4gIGFzeW5jIGNhbmNlbFNjaGVkdWxlZChzY2hlZHVsZUtleSkge1xuICAgIGF3YWl0IHRoaXMuZW5zdXJlUmVhZHkoKVxuXG4gICAgY29uc3Qgbm9ybWFsaXplZFNjaGVkdWxlS2V5ID0gbm9ybWFsaXplQmFja2dyb3VuZEpvYlNjaGVkdWxlS2V5KHNjaGVkdWxlS2V5KVxuXG4gICAgcmV0dXJuIGF3YWl0IHRoaXMuX3dpdGhEYihhc3luYyAoY29ubmVjdGlvbikgPT4gYXdhaXQgdGhpcy5fbXV0YXRlKGNvbm5lY3Rpb24sIGFzeW5jIChkYikgPT4ge1xuICAgICAgYXdhaXQgdGhpcy5fbG9ja1NjaGVkdWxlS2V5KGRiLCBub3JtYWxpemVkU2NoZWR1bGVLZXkpXG4gICAgICBjb25zdCBvd25lckpvYiA9IGF3YWl0IHRoaXMuX3NjaGVkdWxlZE93bmVySm9iKGRiLCBub3JtYWxpemVkU2NoZWR1bGVLZXkpXG5cbiAgICAgIGlmICghb3duZXJKb2IpIHtcbiAgICAgICAgYXdhaXQgdGhpcy5fcmVsZWFzZVNjaGVkdWxlT3duZXJzaGlwKGRiLCB7am9iSWQ6IG51bGwsIHNjaGVkdWxlS2V5OiBub3JtYWxpemVkU2NoZWR1bGVLZXl9KVxuICAgICAgICByZXR1cm4ge2pvYklkOiBudWxsLCBvdXRjb21lOiBcIm5vdF9mb3VuZFwifVxuICAgICAgfVxuXG4gICAgICBpZiAob3duZXJKb2Iuc3RhdHVzID09PSBcInF1ZXVlZFwiKSB7XG4gICAgICAgIGNvbnN0IGFmZmVjdGVkUm93cyA9IGF3YWl0IHRoaXMuX3VwZGF0ZUFmZmVjdGVkUm93cyhkYiwge1xuICAgICAgICAgIGNvbmRpdGlvbnM6IHtpZDogb3duZXJKb2IuaWQsIHN0YXR1czogXCJxdWV1ZWRcIn0sXG4gICAgICAgICAgZGF0YToge3N0YXR1czogXCJjYW5jZWxsZWRcIn0sXG4gICAgICAgICAgdGFibGVOYW1lOiBMT0NBTF9CQUNLR1JPVU5EX0pPQlNfVEFCTEVcbiAgICAgICAgfSlcblxuICAgICAgICBpZiAoYWZmZWN0ZWRSb3dzID09PSAxKSB7XG4gICAgICAgICAgYXdhaXQgdGhpcy5fcmVsZWFzZVNjaGVkdWxlT3duZXJzaGlwKGRiLCB7am9iSWQ6IG93bmVySm9iLmlkLCBzY2hlZHVsZUtleTogbm9ybWFsaXplZFNjaGVkdWxlS2V5fSlcbiAgICAgICAgICBhd2FpdCB0aGlzLl93YWtlRGlzcGF0Y2hlckFmdGVyQ29tbWl0KGRiKVxuICAgICAgICAgIHJldHVybiB7am9iSWQ6IG93bmVySm9iLmlkLCBvdXRjb21lOiBcImNhbmNlbGxlZFwifVxuICAgICAgICB9XG4gICAgICB9XG5cbiAgICAgIGNvbnN0IGN1cnJlbnRKb2IgPSBhd2FpdCB0aGlzLl9zY2hlZHVsZWRPd25lckpvYihkYiwgbm9ybWFsaXplZFNjaGVkdWxlS2V5KVxuXG4gICAgICBhd2FpdCB0aGlzLl9yZWxlYXNlU2NoZWR1bGVPd25lcnNoaXAoZGIsIHtqb2JJZDogb3duZXJKb2IuaWQsIHNjaGVkdWxlS2V5OiBub3JtYWxpemVkU2NoZWR1bGVLZXl9KVxuICAgICAgYXdhaXQgdGhpcy5fd2FrZURpc3BhdGNoZXJBZnRlckNvbW1pdChkYilcbiAgICAgIGlmIChjdXJyZW50Sm9iPy5zdGF0dXMgPT09IFwiaGFuZGVkX29mZlwiKSByZXR1cm4ge2pvYklkOiBjdXJyZW50Sm9iLmlkLCBvdXRjb21lOiBcImhhbmRlZF9vZmZcIn1cbiAgICAgIHJldHVybiB7am9iSWQ6IG51bGwsIG91dGNvbWU6IFwibm90X2ZvdW5kXCJ9XG4gICAgfSkpXG4gIH1cblxuICAvKipcbiAgICogUmVhZHMgc3RhYmxlIG93bmVyc2hpcCBhbmQgb3B0aW9uYWwgbGF0ZXN0IHRlcm1pbmFsIGhpc3RvcnkgaW4gb25lIHRyYW5zYWN0aW9uLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gc2NoZWR1bGVLZXkgLSBTdGFibGUgbG9naWNhbCBzY2hlZHVsZSBrZXkuXG4gICAqIEBwYXJhbSB7e2luY2x1ZGVMYXRlc3RUZXJtaW5hbD86IGJvb2xlYW59fSBbb3B0aW9uc10gLSBMb29rdXAgb3B0aW9ucy5cbiAgICogQHJldHVybnMge1Byb21pc2U8aW1wb3J0KFwiLi90eXBlcy5qc1wiKS5CYWNrZ3JvdW5kSm9iU2NoZWR1bGVkTG9va3VwUmVzdWx0Pn0gLSBOb3JtYWxpemVkIGxvY2FsIGpvYnMuXG4gICAqL1xuICBhc3luYyBnZXRTY2hlZHVsZWRKb2Ioc2NoZWR1bGVLZXksIHtpbmNsdWRlTGF0ZXN0VGVybWluYWwgPSBmYWxzZX0gPSB7fSkge1xuICAgIGF3YWl0IHRoaXMuZW5zdXJlUmVhZHkoKVxuXG4gICAgY29uc3Qgbm9ybWFsaXplZFNjaGVkdWxlS2V5ID0gbm9ybWFsaXplQmFja2dyb3VuZEpvYlNjaGVkdWxlS2V5KHNjaGVkdWxlS2V5KVxuXG4gICAgaWYgKHR5cGVvZiBpbmNsdWRlTGF0ZXN0VGVybWluYWwgIT09IFwiYm9vbGVhblwiKSB7XG4gICAgICB0aHJvdyBWZWxvY2lvdXNFcnJvci5zYWZlKFwiYmFja2dyb3VuZCBqb2IgaW5jbHVkZUxhdGVzdFRlcm1pbmFsIG11c3QgYmUgYSBib29sZWFuXCIpXG4gICAgfVxuXG4gICAgcmV0dXJuIGF3YWl0IHRoaXMuX3dpdGhEYihhc3luYyAoY29ubmVjdGlvbikgPT4gYXdhaXQgdGhpcy5fbXV0YXRlKGNvbm5lY3Rpb24sIGFzeW5jIChkYikgPT4ge1xuICAgICAgcmV0dXJuIGF3YWl0IHRoaXMuX3NjaGVkdWxlZEpvYkxvb2t1cChkYiwge1xuICAgICAgICBpbmNsdWRlTGF0ZXN0VGVybWluYWwsXG4gICAgICAgIHNjaGVkdWxlS2V5OiBub3JtYWxpemVkU2NoZWR1bGVLZXlcbiAgICAgIH0pXG4gICAgfSkpXG4gIH1cblxuICAvKipcbiAgICogTW92ZXMgb25seSBhIGZ1dHVyZSBxdWV1ZWQgc3RhYmxlIG93bmVyIHRvIHRoZSBjdXJyZW50IHRpbWUuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBzY2hlZHVsZUtleSAtIFN0YWJsZSBsb2dpY2FsIHNjaGVkdWxlIGtleS5cbiAgICogQHJldHVybnMge1Byb21pc2U8aW1wb3J0KFwiLi90eXBlcy5qc1wiKS5CYWNrZ3JvdW5kSm9iV2FrZVJlc3VsdD59IC0gRXhhY3Qgd2FrZSBvdXRjb21lLlxuICAgKi9cbiAgYXN5bmMgd2FrZVNjaGVkdWxlZChzY2hlZHVsZUtleSkge1xuICAgIGF3YWl0IHRoaXMuZW5zdXJlUmVhZHkoKVxuXG4gICAgY29uc3Qgbm9ybWFsaXplZFNjaGVkdWxlS2V5ID0gbm9ybWFsaXplQmFja2dyb3VuZEpvYlNjaGVkdWxlS2V5KHNjaGVkdWxlS2V5KVxuXG4gICAgcmV0dXJuIGF3YWl0IHRoaXMuX3dpdGhEYihhc3luYyAoY29ubmVjdGlvbikgPT4gYXdhaXQgdGhpcy5fbXV0YXRlKGNvbm5lY3Rpb24sIGFzeW5jIChkYikgPT4ge1xuICAgICAgYXdhaXQgdGhpcy5fbG9ja1NjaGVkdWxlS2V5KGRiLCBub3JtYWxpemVkU2NoZWR1bGVLZXkpXG4gICAgICBjb25zdCBqb2IgPSBhd2FpdCB0aGlzLl9zY2hlZHVsZWRPd25lckpvYihkYiwgbm9ybWFsaXplZFNjaGVkdWxlS2V5KVxuXG4gICAgICBpZiAoIWpvYiB8fCAoam9iLnN0YXR1cyAhPT0gXCJxdWV1ZWRcIiAmJiBqb2Iuc3RhdHVzICE9PSBcImhhbmRlZF9vZmZcIikpIHJldHVybiB7am9iSWQ6IG51bGwsIG91dGNvbWU6IFwibm90X2ZvdW5kXCJ9XG4gICAgICBpZiAoam9iLnN0YXR1cyA9PT0gXCJoYW5kZWRfb2ZmXCIpIHJldHVybiB7am9iSWQ6IGpvYi5pZCwgb3V0Y29tZTogXCJoYW5kZWRfb2ZmXCJ9XG5cbiAgICAgIGNvbnN0IG5vd01zID0gdGhpcy5jbG9jay5ub3coKVxuXG4gICAgICBpZiAoTnVtYmVyKGpvYi5zY2hlZHVsZWRBdE1zKSA8PSBub3dNcykge1xuICAgICAgICBhd2FpdCB0aGlzLl93YWtlRGlzcGF0Y2hlckFmdGVyQ29tbWl0KGRiKVxuICAgICAgICByZXR1cm4ge2pvYklkOiBqb2IuaWQsIG91dGNvbWU6IFwiYWxyZWFkeV9kdWVcIn1cbiAgICAgIH1cblxuICAgICAgY29uc3QgYWZmZWN0ZWRSb3dzID0gYXdhaXQgdGhpcy5fdXBkYXRlQWZmZWN0ZWRSb3dzKGRiLCB7XG4gICAgICAgIGNvbmRpdGlvbnM6IHtpZDogam9iLmlkLCBzY2hlZHVsZWRfYXRfbXM6IGpvYi5zY2hlZHVsZWRBdE1zLCBzdGF0dXM6IFwicXVldWVkXCJ9LFxuICAgICAgICBkYXRhOiB7c2NoZWR1bGVkX2F0X21zOiBub3dNc30sXG4gICAgICAgIHRhYmxlTmFtZTogTE9DQUxfQkFDS0dST1VORF9KT0JTX1RBQkxFXG4gICAgICB9KVxuXG4gICAgICBpZiAoYWZmZWN0ZWRSb3dzID09PSAxKSB7XG4gICAgICAgIGF3YWl0IHRoaXMuX3dha2VEaXNwYXRjaGVyQWZ0ZXJDb21taXQoZGIpXG4gICAgICAgIHJldHVybiB7am9iSWQ6IGpvYi5pZCwgb3V0Y29tZTogXCJ3b2tlblwifVxuICAgICAgfVxuXG4gICAgICBjb25zdCBjdXJyZW50Sm9iID0gYXdhaXQgdGhpcy5fc2NoZWR1bGVkT3duZXJKb2IoZGIsIG5vcm1hbGl6ZWRTY2hlZHVsZUtleSlcblxuICAgICAgaWYgKGN1cnJlbnRKb2I/LnN0YXR1cyA9PT0gXCJoYW5kZWRfb2ZmXCIpIHJldHVybiB7am9iSWQ6IGN1cnJlbnRKb2IuaWQsIG91dGNvbWU6IFwiaGFuZGVkX29mZlwifVxuICAgICAgaWYgKGN1cnJlbnRKb2I/LnN0YXR1cyA9PT0gXCJxdWV1ZWRcIiAmJiBOdW1iZXIoY3VycmVudEpvYi5zY2hlZHVsZWRBdE1zKSA8PSBub3dNcykge1xuICAgICAgICBhd2FpdCB0aGlzLl93YWtlRGlzcGF0Y2hlckFmdGVyQ29tbWl0KGRiKVxuICAgICAgICByZXR1cm4ge2pvYklkOiBjdXJyZW50Sm9iLmlkLCBvdXRjb21lOiBcImFscmVhZHlfZHVlXCJ9XG4gICAgICB9XG5cbiAgICAgIHJldHVybiB7am9iSWQ6IG51bGwsIG91dGNvbWU6IFwibm90X2ZvdW5kXCJ9XG4gICAgfSkpXG4gIH1cblxuICAvKipcbiAgICogU2VyaWFsaXplcyBtYXRjaGluZyBpbi1wcm9jZXNzIGRlZHVwbGljYXRpb24gY2hlY2tzIHRocm91Z2ggY29tbWl0IHdoaWxlXG4gICAqIGxlYXZpbmcgdW5yZWxhdGVkIGpvYiBpZGVudGl0aWVzIGluZGVwZW5kZW50LlxuICAgKiBAdGVtcGxhdGUgVFxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vdHlwZXMuanNcIikuUHJlcGFyZWRMb2NhbEJhY2tncm91bmRKb2J9IHByZXBhcmVkSm9iIC0gUHJlcGFyZWQgam9iIGlkZW50aXR5LlxuICAgKiBAcGFyYW0geyhob2xkVW50aWw6IChjb21wbGV0aW9uOiBQcm9taXNlPHZvaWQ+KSA9PiB2b2lkKSA9PiBQcm9taXNlPFQ+fSBjYWxsYmFjayAtIERlZHVwbGljYXRpb24gbXV0YXRpb24uXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPFQ+fSAtIE11dGF0aW9uIHJlc3VsdC5cbiAgICovXG4gIGFzeW5jIF9zZXJpYWxpemVEZWR1cGxpY2F0ZWRFbnF1ZXVlKHByZXBhcmVkSm9iLCBjYWxsYmFjaykge1xuICAgIGxldCBjaGFpbnMgPSBkZWR1cGxpY2F0ZWRFbnF1ZXVlQ2hhaW5zLmdldCh0aGlzLmNvbmZpZ3VyYXRpb24pXG5cbiAgICBpZiAoIWNoYWlucykge1xuICAgICAgY2hhaW5zID0gbmV3IE1hcCgpXG4gICAgICBkZWR1cGxpY2F0ZWRFbnF1ZXVlQ2hhaW5zLnNldCh0aGlzLmNvbmZpZ3VyYXRpb24sIGNoYWlucylcbiAgICB9XG5cbiAgICBjb25zdCBrZXkgPSBzaGEyNTZIZXgoSlNPTi5zdHJpbmdpZnkoW1xuICAgICAgdGhpcy5nZXREYXRhYmFzZUlkZW50aWZpZXIoKSxcbiAgICAgIHByZXBhcmVkSm9iLmpvYk5hbWUsXG4gICAgICBwcmVwYXJlZEpvYi5hcmdzRGlnZXN0LFxuICAgICAgcHJlcGFyZWRKb2IucXVldWVcbiAgICBdKSlcbiAgICBjb25zdCBwcmV2aW91cyA9IGNoYWlucy5nZXQoa2V5KSB8fCBQcm9taXNlLnJlc29sdmUoKVxuICAgIGxldCByZWxlYXNlID0gKCkgPT4ge31cbiAgICBjb25zdCBydW5uaW5nID0gbmV3IFByb21pc2UoKHJlc29sdmUpID0+IHsgcmVsZWFzZSA9ICgpID0+IHJlc29sdmUodW5kZWZpbmVkKSB9KVxuICAgIGNvbnN0IGNoYWluID0gcHJldmlvdXMudGhlbigoKSA9PiBydW5uaW5nKVxuICAgIC8qKiBAdHlwZSB7UHJvbWlzZTx2b2lkPiB8IHVuZGVmaW5lZH0gKi9cbiAgICBsZXQgY29tcGxldGlvblxuICAgIGNvbnN0IGZpbmlzaCA9ICgpID0+IHtcbiAgICAgIHJlbGVhc2UoKVxuICAgICAgaWYgKGNoYWlucy5nZXQoa2V5KSA9PT0gY2hhaW4pIGNoYWlucy5kZWxldGUoa2V5KVxuICAgICAgaWYgKGNoYWlucy5zaXplID09PSAwKSBkZWR1cGxpY2F0ZWRFbnF1ZXVlQ2hhaW5zLmRlbGV0ZSh0aGlzLmNvbmZpZ3VyYXRpb24pXG4gICAgfVxuXG4gICAgY2hhaW5zLnNldChrZXksIGNoYWluKVxuICAgIGF3YWl0IHByZXZpb3VzXG5cbiAgICB0cnkge1xuICAgICAgY29uc3QgcmVzdWx0ID0gYXdhaXQgY2FsbGJhY2soKHRyYW5zYWN0aW9uQ29tcGxldGlvbikgPT4geyBjb21wbGV0aW9uID0gdHJhbnNhY3Rpb25Db21wbGV0aW9uIH0pXG5cbiAgICAgIGlmIChjb21wbGV0aW9uKSB7XG4gICAgICAgIGNvbXBsZXRpb24udGhlbihmaW5pc2gsIGZpbmlzaClcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIGZpbmlzaCgpXG4gICAgICB9XG5cbiAgICAgIHJldHVybiByZXN1bHRcbiAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgZmluaXNoKClcbiAgICAgIHRocm93IGVycm9yXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIFByZXBhcmVzIHZhbGlkYXRlZCBsb2NhbCBqb2IgZGF0YSBmb3IgaW5zZXJ0aW9uLlxuICAgKiBAcGFyYW0ge3thcmdzOiBBcnJheTxSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj4sIGpvYk5hbWU6IHN0cmluZywgb3B0aW9uczogaW1wb3J0KFwiLi90eXBlcy5qc1wiKS5CYWNrZ3JvdW5kSm9iT3B0aW9uc319IGFyZ3MgLSBKb2IgcmVxdWVzdC5cbiAgICogQHJldHVybnMge2ltcG9ydChcIi4vdHlwZXMuanNcIikuUHJlcGFyZWRMb2NhbEJhY2tncm91bmRKb2J9IC0gUHJlcGFyZWQgcm93IGRhdGEuXG4gICAqL1xuICBfcHJlcGFyZUpvYih7YXJncywgam9iTmFtZSwgb3B0aW9uc30pIHtcbiAgICBpZiAob3B0aW9ucy5pZGVtcG90ZW5jeUtleSAhPT0gdW5kZWZpbmVkKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoXCJpZGVtcG90ZW5jeUtleSBpcyBub3Qgc3VwcG9ydGVkIGJ5IHRoZSBsb2NhbCBiYWNrZ3JvdW5kLWpvYnMgYWRhcHRlclwiKVxuICAgIH1cblxuICAgIGNvbnN0IGNyZWF0ZWRBdE1zID0gdGhpcy5jbG9jay5ub3coKVxuICAgIGNvbnN0IHF1ZXVlID0gbm9ybWFsaXplQmFja2dyb3VuZEpvYlF1ZXVlKG9wdGlvbnMpXG4gICAgY29uc3QgcXVldWVzID0gdGhpcy5jb25maWd1cmF0aW9uLmdldEJhY2tncm91bmRKb2JzQ29uZmlnKCkucXVldWVzXG4gICAgY29uc3QgYXJnc0pzb24gPSBKU09OLnN0cmluZ2lmeShhcmdzIHx8IFtdKVxuICAgIGNvbnN0IGV4ZWN1dGlvbk1vZGUgPSBub3JtYWxpemVCYWNrZ3JvdW5kSm9iRXhlY3V0aW9uTW9kZShvcHRpb25zLCBcImlubGluZVwiLCBMT0NBTF9FWEVDVVRJT05fTU9ERVMpXG5cbiAgICBpZiAodHlwZW9mIGFyZ3NKc29uICE9PSBcInN0cmluZ1wiKSB0aHJvdyBuZXcgVHlwZUVycm9yKFwiTG9jYWwgYmFja2dyb3VuZCBqb2IgYXJndW1lbnRzIG11c3QgYmUgSlNPTiBzZXJpYWxpemFibGVcIilcbiAgICBpZiAoZXhlY3V0aW9uTW9kZSAhPT0gXCJpbmxpbmVcIikgdGhyb3cgbmV3IEVycm9yKFwiTG9jYWwgYmFja2dyb3VuZCBqb2IgZXhlY3V0aW9uIG1vZGUgaW52YXJpYW50IHdhcyB2aW9sYXRlZFwiKVxuXG4gICAgcmV0dXJuIHtcbiAgICAgIGFyZ3NEaWdlc3Q6IHNoYTI1NkhleChhcmdzSnNvbiksXG4gICAgICBhcmdzSnNvbixcbiAgICAgIGNvbmN1cnJlbmN5OiBub3JtYWxpemVCYWNrZ3JvdW5kSm9iQ29uY3VycmVuY3koe29wdGlvbnMsIHF1ZXVlLCBxdWV1ZXN9KSxcbiAgICAgIGNyZWF0ZWRBdE1zLFxuICAgICAgZXhlY3V0aW9uTW9kZSxcbiAgICAgIGpvYklkOiBuZXcgVVVJRCg0KS5mb3JtYXQoKSxcbiAgICAgIGpvYk5hbWUsXG4gICAgICBtYXhSZXRyaWVzOiBub3JtYWxpemVCYWNrZ3JvdW5kSm9iTWF4UmV0cmllcyhvcHRpb25zLm1heFJldHJpZXMpLFxuICAgICAgcXVldWUsXG4gICAgICBzY2hlZHVsZWRBdE1zOiBub3JtYWxpemVCYWNrZ3JvdW5kSm9iU2NoZWR1bGVkQXRNcyhvcHRpb25zLnNjaGVkdWxlZEF0TXMsIGNyZWF0ZWRBdE1zKVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBJbnNlcnRzIG9uZSBwcmVwYXJlZCBsb2NhbCBqb2Igcm93IGFuZCBpdHMgY29uY3VycmVuY3kgbWV0YWRhdGEuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vZGF0YWJhc2UvZHJpdmVycy9iYXNlLmpzXCIpLmRlZmF1bHR9IGRiIC0gTG9jYWwgU1FMaXRlIGNvbm5lY3Rpb24uXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi90eXBlcy5qc1wiKS5QcmVwYXJlZExvY2FsQmFja2dyb3VuZEpvYn0gcHJlcGFyZWRKb2IgLSBQcmVwYXJlZCByb3cgZGF0YS5cbiAgICogQHBhcmFtIHtzdHJpbmcgfCBudWxsfSBbc2NoZWR1bGVLZXldIC0gU3RhYmxlIHNjaGVkdWxlIGhpc3Rvcnkga2V5LlxuICAgKiBAcGFyYW0ge251bWJlciB8IG51bGx9IFtzY2hlZHVsZU9yZGVyXSAtIE1vbm90b25pYyBzdGFibGUgb3duZXJzaGlwIG9yZGVyLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyBhZnRlciBpbnNlcnRpb24uXG4gICAqL1xuICBhc3luYyBfaW5zZXJ0UHJlcGFyZWRKb2IoZGIsIHByZXBhcmVkSm9iLCBzY2hlZHVsZUtleSA9IG51bGwsIHNjaGVkdWxlT3JkZXIgPSBudWxsKSB7XG4gICAgYXdhaXQgZGIuaW5zZXJ0KHtcbiAgICAgIHRhYmxlTmFtZTogTE9DQUxfQkFDS0dST1VORF9KT0JTX1RBQkxFLFxuICAgICAgZGF0YToge1xuICAgICAgICBhcmdzX2RpZ2VzdDogcHJlcGFyZWRKb2IuYXJnc0RpZ2VzdCxcbiAgICAgICAgYXJnc19qc29uOiBwcmVwYXJlZEpvYi5hcmdzSnNvbixcbiAgICAgICAgYXR0ZW1wdHM6IDAsXG4gICAgICAgIGNvbXBsZXRlZF9hdF9tczogbnVsbCxcbiAgICAgICAgY29uY3VycmVuY3lfa2V5OiBwcmVwYXJlZEpvYi5jb25jdXJyZW5jeT8uY29uY3VycmVuY3lLZXkgfHwgbnVsbCxcbiAgICAgICAgY3JlYXRlZF9hdF9tczogcHJlcGFyZWRKb2IuY3JlYXRlZEF0TXMsXG4gICAgICAgIGV4ZWN1dGlvbl9tb2RlOiBwcmVwYXJlZEpvYi5leGVjdXRpb25Nb2RlLFxuICAgICAgICBmYWlsZWRfYXRfbXM6IG51bGwsXG4gICAgICAgIGhhbmRlZF9vZmZfYXRfbXM6IG51bGwsXG4gICAgICAgIGhhbmRvZmZfaWQ6IG51bGwsXG4gICAgICAgIGlkOiBwcmVwYXJlZEpvYi5qb2JJZCxcbiAgICAgICAgam9iX25hbWU6IHByZXBhcmVkSm9iLmpvYk5hbWUsXG4gICAgICAgIGxhc3RfZXJyb3I6IG51bGwsXG4gICAgICAgIG1heF9jb25jdXJyZW5jeTogcHJlcGFyZWRKb2IuY29uY3VycmVuY3k/Lm1heENvbmN1cnJlbmN5IHx8IG51bGwsXG4gICAgICAgIG1heF9yZXRyaWVzOiBwcmVwYXJlZEpvYi5tYXhSZXRyaWVzLFxuICAgICAgICBxdWV1ZTogcHJlcGFyZWRKb2IucXVldWUsXG4gICAgICAgIHNjaGVkdWxlX2tleTogc2NoZWR1bGVLZXksXG4gICAgICAgIHNjaGVkdWxlX29yZGVyOiBzY2hlZHVsZU9yZGVyLFxuICAgICAgICBzY2hlZHVsZWRfYXRfbXM6IHByZXBhcmVkSm9iLnNjaGVkdWxlZEF0TXMsXG4gICAgICAgIHN0YXR1czogXCJxdWV1ZWRcIixcbiAgICAgICAgd29ya2VyX2lkOiBudWxsXG4gICAgICB9XG4gICAgfSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSZWNvbmNpbGVzIGNvbmZpZ3VyZWQgcXVldWUtZGVyaXZlZCBjYXBzIGFuZCBkdXJhYmxlIGNvdW50ZXJzLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyBhZnRlciByZWNvbmNpbGlhdGlvbi5cbiAgICovXG4gIGFzeW5jIHJlY29uY2lsZVF1ZXVlQ29uY3VycmVuY3koKSB7XG4gICAgYXdhaXQgdGhpcy5lbnN1cmVSZWFkeSgpXG5cbiAgICBhd2FpdCB0aGlzLl93aXRoRGIoYXN5bmMgKGNvbm5lY3Rpb24pID0+IGF3YWl0IHRoaXMuX211dGF0ZShjb25uZWN0aW9uLCBhc3luYyAoZGIpID0+IHtcbiAgICAgIGNvbnN0IHF1ZXVlcyA9IHRoaXMuY29uZmlndXJhdGlvbi5nZXRCYWNrZ3JvdW5kSm9ic0NvbmZpZygpLnF1ZXVlc1xuICAgICAgY29uc3Qgcm93cyA9IGF3YWl0IGRiLm5ld1F1ZXJ5KCkuZnJvbShMT0NBTF9CQUNLR1JPVU5EX0pPQlNfVEFCTEUpLndoZXJlKHtzdGF0dXM6IFwicXVldWVkXCJ9KS5yZXN1bHRzKClcblxuICAgICAgZm9yIChjb25zdCByYXdSb3cgb2Ygcm93cykge1xuICAgICAgICBhd2FpdCB0aGlzLl9yZWNvbmNpbGVRdWV1ZWRKb2JDb25jdXJyZW5jeShkYiwgdGhpcy5fbm9ybWFsaXplUm93KHJhd1JvdyksIHF1ZXVlcylcbiAgICAgIH1cblxuICAgICAgYXdhaXQgdGhpcy5fcmVidWlsZENvbmN1cnJlbmN5Q291bnRzKGRiKVxuICAgIH0pKVxuICB9XG5cbiAgLyoqXG4gICAqIEFwcGxpZXMgY3VycmVudCBxdWV1ZS1kZXJpdmVkIGNvbmN1cnJlbmN5IHBvbGljeSB0byBvbmUgcXVldWVkIHJvdy5cbiAgICogRXhwbGljaXQgY29uY3VycmVuY3kga2V5cyByZW1haW4gb3duZWQgYnkgdGhlIGVucXVldWUgY29udHJhY3QuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vZGF0YWJhc2UvZHJpdmVycy9iYXNlLmpzXCIpLmRlZmF1bHR9IGRiIC0gTG9jYWwgU1FMaXRlIGNvbm5lY3Rpb24uXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi90eXBlcy5qc1wiKS5CYWNrZ3JvdW5kSm9iUm93fSBqb2IgLSBRdWV1ZWQgam9iIHNuYXBzaG90LlxuICAgKiBAcGFyYW0ge1JlY29yZDxzdHJpbmcsIHttYXhDb25jdXJyZW50PzogbnVtYmVyLCBwcmlvcml0eT86IG51bWJlcn0+fSBxdWV1ZXMgLSBDdXJyZW50IHF1ZXVlIHBvbGljeSBzbmFwc2hvdC5cbiAgICogQHJldHVybnMge1Byb21pc2U8aW1wb3J0KFwiLi90eXBlcy5qc1wiKS5CYWNrZ3JvdW5kSm9iUm93Pn0gLSBSZWNvbmNpbGVkIHNuYXBzaG90LlxuICAgKi9cbiAgYXN5bmMgX3JlY29uY2lsZVF1ZXVlZEpvYkNvbmN1cnJlbmN5KGRiLCBqb2IsIHF1ZXVlcykge1xuICAgIGNvbnN0IGN1cnJlbnRJc1F1ZXVlRGVyaXZlZCA9IEJvb2xlYW4oam9iLmNvbmN1cnJlbmN5S2V5Py5zdGFydHNXaXRoKFFVRVVFX0NPTkNVUlJFTkNZX0tFWV9QUkVGSVgpKVxuXG4gICAgaWYgKGpvYi5jb25jdXJyZW5jeUtleSAmJiAhY3VycmVudElzUXVldWVEZXJpdmVkKSByZXR1cm4gam9iXG5cbiAgICBjb25zdCBjb25jdXJyZW5jeSA9IG5vcm1hbGl6ZUJhY2tncm91bmRKb2JDb25jdXJyZW5jeSh7XG4gICAgICBvcHRpb25zOiB7fSxcbiAgICAgIHF1ZXVlOiBqb2IucXVldWUsXG4gICAgICBxdWV1ZXNcbiAgICB9KVxuXG4gICAgaWYgKCFjb25jdXJyZW5jeSkge1xuICAgICAgaWYgKGN1cnJlbnRJc1F1ZXVlRGVyaXZlZCkge1xuICAgICAgICBhd2FpdCBkYi51cGRhdGUoe1xuICAgICAgICAgIGNvbmRpdGlvbnM6IHtpZDogam9iLmlkLCBzdGF0dXM6IFwicXVldWVkXCJ9LFxuICAgICAgICAgIGRhdGE6IHtjb25jdXJyZW5jeV9rZXk6IG51bGwsIG1heF9jb25jdXJyZW5jeTogbnVsbH0sXG4gICAgICAgICAgdGFibGVOYW1lOiBMT0NBTF9CQUNLR1JPVU5EX0pPQlNfVEFCTEVcbiAgICAgICAgfSlcbiAgICAgIH1cblxuICAgICAgcmV0dXJuIHsuLi5qb2IsIGNvbmN1cnJlbmN5S2V5OiBudWxsLCBtYXhDb25jdXJyZW5jeTogbnVsbH1cbiAgICB9XG5cbiAgICBhd2FpdCB0aGlzLl9lbnN1cmVDb25jdXJyZW5jeShkYiwgY29uY3VycmVuY3kpXG4gICAgaWYgKGpvYi5jb25jdXJyZW5jeUtleSAhPT0gY29uY3VycmVuY3kuY29uY3VycmVuY3lLZXkgfHwgam9iLm1heENvbmN1cnJlbmN5ICE9PSBjb25jdXJyZW5jeS5tYXhDb25jdXJyZW5jeSkge1xuICAgICAgYXdhaXQgZGIudXBkYXRlKHtcbiAgICAgICAgY29uZGl0aW9uczoge2lkOiBqb2IuaWQsIHN0YXR1czogXCJxdWV1ZWRcIn0sXG4gICAgICAgIGRhdGE6IHtjb25jdXJyZW5jeV9rZXk6IGNvbmN1cnJlbmN5LmNvbmN1cnJlbmN5S2V5LCBtYXhfY29uY3VycmVuY3k6IGNvbmN1cnJlbmN5Lm1heENvbmN1cnJlbmN5fSxcbiAgICAgICAgdGFibGVOYW1lOiBMT0NBTF9CQUNLR1JPVU5EX0pPQlNfVEFCTEVcbiAgICAgIH0pXG4gICAgfVxuXG4gICAgcmV0dXJuIHsuLi5qb2IsIGNvbmN1cnJlbmN5S2V5OiBjb25jdXJyZW5jeS5jb25jdXJyZW5jeUtleSwgbWF4Q29uY3VycmVuY3k6IGNvbmN1cnJlbmN5Lm1heENvbmN1cnJlbmN5fVxuICB9XG5cbiAgLyoqXG4gICAqIEZpbmRzIHRoZSBuZXh0IGVsaWdpYmxlIGxvY2FsIGpvYi5cbiAgICogQHJldHVybnMge1Byb21pc2U8aW1wb3J0KFwiLi90eXBlcy5qc1wiKS5CYWNrZ3JvdW5kSm9iUm93IHwgbnVsbD59IC0gTmV4dCBlbGlnaWJsZSBsb2NhbCBqb2IuXG4gICAqL1xuICBhc3luYyBuZXh0QXZhaWxhYmxlSm9iKCkge1xuICAgIGF3YWl0IHRoaXMuZW5zdXJlUmVhZHkoKVxuXG4gICAgcmV0dXJuIGF3YWl0IHRoaXMuX3dpdGhEYihhc3luYyAoZGIpID0+IHtcbiAgICAgIGNvbnN0IGpvYnNUYWJsZSA9IGRiLnF1b3RlVGFibGUoTE9DQUxfQkFDS0dST1VORF9KT0JTX1RBQkxFKVxuICAgICAgY29uc3QgY29uY3VycmVuY3lUYWJsZSA9IGRiLnF1b3RlVGFibGUoTE9DQUxfQkFDS0dST1VORF9KT0JfQ09OQ1VSUkVOQ1lfVEFCTEUpXG4gICAgICBjb25zdCBwcmlvcml0eU9yZGVyID0gdGhpcy5fcXVldWVQcmlvcml0eU9yZGVyU3FsKGRiKVxuICAgICAgbGV0IHF1ZXJ5ID0gZGJcbiAgICAgICAgLm5ld1F1ZXJ5KClcbiAgICAgICAgLmZyb20oTE9DQUxfQkFDS0dST1VORF9KT0JTX1RBQkxFKVxuICAgICAgICAud2hlcmUoe3N0YXR1czogXCJxdWV1ZWRcIn0pXG4gICAgICAgIC53aGVyZShgc2NoZWR1bGVkX2F0X21zIDw9ICR7ZGIucXVvdGUodGhpcy5jbG9jay5ub3coKSl9YClcbiAgICAgICAgLndoZXJlKFxuICAgICAgICAgIGAoJHtqb2JzVGFibGV9LiR7ZGIucXVvdGVDb2x1bW4oXCJjb25jdXJyZW5jeV9rZXlcIil9IElTIE5VTEwgT1IgRVhJU1RTIChgICtcbiAgICAgICAgICBgU0VMRUNUIDEgRlJPTSAke2NvbmN1cnJlbmN5VGFibGV9IFdIRVJFIGAgK1xuICAgICAgICAgIGAke2NvbmN1cnJlbmN5VGFibGV9LiR7ZGIucXVvdGVDb2x1bW4oXCJjb25jdXJyZW5jeV9rZXlcIil9ID0gJHtqb2JzVGFibGV9LiR7ZGIucXVvdGVDb2x1bW4oXCJjb25jdXJyZW5jeV9rZXlcIil9IEFORCBgICtcbiAgICAgICAgICBgJHtjb25jdXJyZW5jeVRhYmxlfS4ke2RiLnF1b3RlQ29sdW1uKFwiYWN0aXZlX2NvdW50XCIpfSA8ICR7Y29uY3VycmVuY3lUYWJsZX0uJHtkYi5xdW90ZUNvbHVtbihcIm1heF9jb25jdXJyZW5jeVwiKX0pKWBcbiAgICAgICAgKVxuXG4gICAgICBpZiAocHJpb3JpdHlPcmRlcikgcXVlcnkgPSBxdWVyeS5vcmRlcihgJHtwcmlvcml0eU9yZGVyfSBERVNDYClcblxuICAgICAgY29uc3Qgcm93cyA9IGF3YWl0IHF1ZXJ5XG4gICAgICAgIC5vcmRlcihcInNjaGVkdWxlZF9hdF9tcyBBU0NcIilcbiAgICAgICAgLm9yZGVyKFwiY3JlYXRlZF9hdF9tcyBBU0NcIilcbiAgICAgICAgLm9yZGVyKFwiaWQgQVNDXCIpXG4gICAgICAgIC5saW1pdCgxKVxuICAgICAgICAucmVzdWx0cygpXG5cbiAgICAgIHJldHVybiByb3dzWzBdID8gdGhpcy5fbm9ybWFsaXplUm93KHJvd3NbMF0pIDogbnVsbFxuICAgIH0pXG4gIH1cblxuICAvKipcbiAgICogRmluZHMgdGhlIHNvb25lc3QgZnV0dXJlIHF1ZXVlZCBqb2IuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPGltcG9ydChcIi4vdHlwZXMuanNcIikuQmFja2dyb3VuZEpvYlJvdyB8IG51bGw+fSAtIFNvb25lc3QgZnV0dXJlIHF1ZXVlZCBqb2IuXG4gICAqL1xuICBhc3luYyBuZXh0U2NoZWR1bGVkSm9iKCkge1xuICAgIGF3YWl0IHRoaXMuZW5zdXJlUmVhZHkoKVxuXG4gICAgcmV0dXJuIGF3YWl0IHRoaXMuX3dpdGhEYihhc3luYyAoZGIpID0+IHtcbiAgICAgIGNvbnN0IHJvd3MgPSBhd2FpdCBkYlxuICAgICAgICAubmV3UXVlcnkoKVxuICAgICAgICAuZnJvbShMT0NBTF9CQUNLR1JPVU5EX0pPQlNfVEFCTEUpXG4gICAgICAgIC53aGVyZSh7c3RhdHVzOiBcInF1ZXVlZFwifSlcbiAgICAgICAgLndoZXJlKGBzY2hlZHVsZWRfYXRfbXMgPiAke2RiLnF1b3RlKHRoaXMuY2xvY2subm93KCkpfWApXG4gICAgICAgIC5vcmRlcihcInNjaGVkdWxlZF9hdF9tcyBBU0NcIilcbiAgICAgICAgLm9yZGVyKFwiY3JlYXRlZF9hdF9tcyBBU0NcIilcbiAgICAgICAgLm9yZGVyKFwiaWQgQVNDXCIpXG4gICAgICAgIC5saW1pdCgxKVxuICAgICAgICAucmVzdWx0cygpXG5cbiAgICAgIHJldHVybiByb3dzWzBdID8gdGhpcy5fbm9ybWFsaXplUm93KHJvd3NbMF0pIDogbnVsbFxuICAgIH0pXG4gIH1cblxuICAvKipcbiAgICogRmluZHMgYSBwZXJzaXN0ZWQgbG9jYWwgam9iIGJ5IGlkLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gam9iSWQgLSBKb2IgaWQuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPGltcG9ydChcIi4vdHlwZXMuanNcIikuQmFja2dyb3VuZEpvYlJvdyB8IG51bGw+fSAtIFBlcnNpc3RlZCBqb2IuXG4gICAqL1xuICBhc3luYyBnZXRKb2Ioam9iSWQpIHtcbiAgICBhd2FpdCB0aGlzLmVuc3VyZVJlYWR5KClcblxuICAgIHJldHVybiBhd2FpdCB0aGlzLl93aXRoRGIoYXN5bmMgKGRiKSA9PiBhd2FpdCB0aGlzLl9nZXRKb2IoZGIsIGpvYklkKSlcbiAgfVxuXG4gIC8qKlxuICAgKiBMaXN0cyBsb2NhbCBqb2JzIGluIGNyZWF0aW9uIG9yZGVyLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxpbXBvcnQoXCIuL3R5cGVzLmpzXCIpLkJhY2tncm91bmRKb2JSb3dbXT59IC0gQWxsIGxvY2FsIGpvYnMgaW4gY3JlYXRpb24gb3JkZXIuXG4gICAqL1xuICBhc3luYyBsaXN0Sm9icygpIHtcbiAgICBhd2FpdCB0aGlzLmVuc3VyZVJlYWR5KClcblxuICAgIHJldHVybiBhd2FpdCB0aGlzLl93aXRoRGIoYXN5bmMgKGRiKSA9PiB7XG4gICAgICBjb25zdCByb3dzID0gYXdhaXQgZGJcbiAgICAgICAgLm5ld1F1ZXJ5KClcbiAgICAgICAgLmZyb20oTE9DQUxfQkFDS0dST1VORF9KT0JTX1RBQkxFKVxuICAgICAgICAub3JkZXIoXCJjcmVhdGVkX2F0X21zIEFTQ1wiKVxuICAgICAgICAub3JkZXIoXCJpZCBBU0NcIilcbiAgICAgICAgLnJlc3VsdHMoKVxuXG4gICAgICByZXR1cm4gcm93cy5tYXAoKHJvdykgPT4gdGhpcy5fbm9ybWFsaXplUm93KHJvdykpXG4gICAgfSlcbiAgfVxuXG4gIC8qKlxuICAgKiBBdG9taWNhbGx5IHJlc2VydmVzIGNvbmN1cnJlbmN5IGFuZCBjbGFpbXMgb25lIHF1ZXVlZCBqb2IuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi90eXBlcy5qc1wiKS5CYWNrZ3JvdW5kSm9iSGFuZG9mZlJlcXVlc3R9IGFyZ3MgLSBDbGFpbSByZXF1ZXN0LiBBIHN1cHBsaWVkIGhhbmRvZmYgaWQgaXMgcGVyc2lzdGVkIGV4YWN0bHkuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPGltcG9ydChcIi4vdHlwZXMuanNcIikuQmFja2dyb3VuZEpvYkhhbmRvZmYgfCBudWxsPn0gLSBGZW5jZWQgY2xhaW0uXG4gICAqL1xuICBhc3luYyBtYXJrSGFuZGVkT2ZmKHtqb2JJZCwgaGFuZG9mZklkID0gbmV3IFVVSUQoNCkuZm9ybWF0KCksIHdvcmtlcklkfSkge1xuICAgIGF3YWl0IHRoaXMuZW5zdXJlUmVhZHkoKVxuXG4gICAgcmV0dXJuIGF3YWl0IHRoaXMuX3dpdGhEYihhc3luYyAoY29ubmVjdGlvbikgPT4gYXdhaXQgdGhpcy5fbXV0YXRlKGNvbm5lY3Rpb24sIGFzeW5jIChkYikgPT4ge1xuICAgICAgY29uc3Qgam9iID0gYXdhaXQgdGhpcy5fZ2V0Sm9iKGRiLCBqb2JJZClcblxuICAgICAgaWYgKCFqb2IgfHwgam9iLnN0YXR1cyAhPT0gXCJxdWV1ZWRcIiB8fCBOdW1iZXIoam9iLnNjaGVkdWxlZEF0TXMpID4gdGhpcy5jbG9jay5ub3coKSkgcmV0dXJuIG51bGxcbiAgICAgIGlmIChqb2IuY29uY3VycmVuY3lLZXkgJiYgIShhd2FpdCB0aGlzLl9yZXNlcnZlQ29uY3VycmVuY3koZGIsIGpvYi5jb25jdXJyZW5jeUtleSkpKSByZXR1cm4gbnVsbFxuXG4gICAgICBjb25zdCBoYW5kZWRPZmZBdE1zID0gdGhpcy5jbG9jay5ub3coKVxuICAgICAgY29uc3QgYWZmZWN0ZWRSb3dzID0gYXdhaXQgdGhpcy5fdXBkYXRlQWZmZWN0ZWRSb3dzKGRiLCB7XG4gICAgICAgIGNvbmRpdGlvbnM6IHtpZDogam9iSWQsIHN0YXR1czogXCJxdWV1ZWRcIn0sXG4gICAgICAgIGRhdGE6IHsuLi50aGlzLl9jbGVhcmVkQ2hpbGRBY2NlcHRhbmNlRGF0YSgpLCBoYW5kZWRfb2ZmX2F0X21zOiBoYW5kZWRPZmZBdE1zLCBoYW5kb2ZmX2lkOiBoYW5kb2ZmSWQsIHN0YXR1czogXCJoYW5kZWRfb2ZmXCIsIHdvcmtlcl9pZDogd29ya2VySWQgfHwgXCJsb2NhbFwifSxcbiAgICAgICAgdGFibGVOYW1lOiBMT0NBTF9CQUNLR1JPVU5EX0pPQlNfVEFCTEVcbiAgICAgIH0pXG5cbiAgICAgIGlmIChhZmZlY3RlZFJvd3MgIT09IDEpIHtcbiAgICAgICAgYXdhaXQgdGhpcy5fcmVsZWFzZUNvbmN1cnJlbmN5KGRiLCBqb2IuY29uY3VycmVuY3lLZXkpXG4gICAgICAgIHJldHVybiBudWxsXG4gICAgICB9XG5cbiAgICAgIHJldHVybiB7aGFuZGVkT2ZmQXRNcywgaGFuZG9mZklkfVxuICAgIH0pKVxuICB9XG5cbiAgLyoqXG4gICAqIEZpbmRzIGFjdGl2ZSBsb2NhbCBoYW5kb2ZmcyBvd25lZCBieSBvbmUgd29ya2VyLlxuICAgKiBAcGFyYW0ge3t3b3JrZXJJZDogc3RyaW5nfX0gYXJncyAtIFdvcmtlciBpZGVudGl0eS5cbiAgICogQHJldHVybnMge1Byb21pc2U8QXJyYXk8e2pvYklkOiBzdHJpbmcsIGhhbmRvZmZJZDogc3RyaW5nfT4+fSAtIEFjdGl2ZSB3b3JrZXIgaGFuZG9mZnMuXG4gICAqL1xuICBhc3luYyBoYW5kZWRPZmZKb2JzRm9yV29ya2VyKHt3b3JrZXJJZH0pIHtcbiAgICBhd2FpdCB0aGlzLmVuc3VyZVJlYWR5KClcblxuICAgIGNvbnN0IHJvd3MgPSBhd2FpdCB0aGlzLl93aXRoRGIoYXN5bmMgKGRiKSA9PiBhd2FpdCBkYlxuICAgICAgLm5ld1F1ZXJ5KClcbiAgICAgIC5mcm9tKExPQ0FMX0JBQ0tHUk9VTkRfSk9CU19UQUJMRSlcbiAgICAgIC53aGVyZSh7c3RhdHVzOiBcImhhbmRlZF9vZmZcIiwgd29ya2VyX2lkOiB3b3JrZXJJZH0pXG4gICAgICAucmVzdWx0cygpKVxuICAgIC8qKiBAdHlwZSB7QXJyYXk8e2pvYklkOiBzdHJpbmcsIGhhbmRvZmZJZDogc3RyaW5nfT59ICovXG4gICAgY29uc3QgaGFuZG9mZnMgPSBbXVxuXG4gICAgZm9yIChjb25zdCByYXdSb3cgb2Ygcm93cykge1xuICAgICAgY29uc3Qgam9iID0gdGhpcy5fbm9ybWFsaXplUm93KHJhd1JvdylcblxuICAgICAgaWYgKGpvYi5oYW5kb2ZmSWQpIGhhbmRvZmZzLnB1c2goe2pvYklkOiBqb2IuaWQsIGhhbmRvZmZJZDogam9iLmhhbmRvZmZJZH0pXG4gICAgfVxuXG4gICAgcmV0dXJuIGhhbmRvZmZzXG4gIH1cblxuICAvKipcbiAgICogUmV0dXJucyBhbiBleGFjdCBhY3RpdmUgaGFuZG9mZiB0byB0aGUgcXVldWUuXG4gICAqIEBwYXJhbSB7e2pvYklkOiBzdHJpbmcsIGhhbmRvZmZJZDogc3RyaW5nfX0gYXJncyAtIEhhbmRvZmYgcmVsZWFzZS5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgYWZ0ZXIgdGhlIGZlbmNlZCByZWxlYXNlLlxuICAgKi9cbiAgYXN5bmMgbWFya1JldHVybmVkVG9RdWV1ZSh7am9iSWQsIGhhbmRvZmZJZH0pIHtcbiAgICBhd2FpdCB0aGlzLmVuc3VyZVJlYWR5KClcblxuICAgIGF3YWl0IHRoaXMuX3dpdGhEYihhc3luYyAoY29ubmVjdGlvbikgPT4gYXdhaXQgdGhpcy5fbXV0YXRlKGNvbm5lY3Rpb24sIGFzeW5jIChkYikgPT4ge1xuICAgICAgY29uc3Qgam9iID0gYXdhaXQgdGhpcy5fZ2V0Sm9iKGRiLCBqb2JJZClcblxuICAgICAgaWYgKCF0aGlzLl9hY2NlcHRzSGFuZG9mZihqb2IsIGhhbmRvZmZJZCkpIHJldHVyblxuICAgICAgYXdhaXQgdGhpcy5fbG9ja0NvbmN1cnJlbmN5Um93KGRiLCBqb2IuY29uY3VycmVuY3lLZXkpXG5cbiAgICAgIGNvbnN0IGFmZmVjdGVkUm93cyA9IGF3YWl0IHRoaXMuX3VwZGF0ZUFmZmVjdGVkUm93cyhkYiwge1xuICAgICAgICBjb25kaXRpb25zOiB7aGFuZG9mZl9pZDogaGFuZG9mZklkLCBpZDogam9iSWQsIHN0YXR1czogXCJoYW5kZWRfb2ZmXCJ9LFxuICAgICAgICBkYXRhOiB7XG4gICAgICAgICAgLi4udGhpcy5fY2xlYXJlZENoaWxkQWNjZXB0YW5jZURhdGEoKSxcbiAgICAgICAgICBoYW5kZWRfb2ZmX2F0X21zOiBudWxsLFxuICAgICAgICAgIGhhbmRvZmZfaWQ6IG51bGwsXG4gICAgICAgICAgc2NoZWR1bGVkX2F0X21zOiB0aGlzLmNsb2NrLm5vdygpLFxuICAgICAgICAgIHN0YXR1czogXCJxdWV1ZWRcIixcbiAgICAgICAgICB3b3JrZXJfaWQ6IG51bGxcbiAgICAgICAgfSxcbiAgICAgICAgdGFibGVOYW1lOiBMT0NBTF9CQUNLR1JPVU5EX0pPQlNfVEFCTEVcbiAgICAgIH0pXG5cbiAgICAgIGlmIChhZmZlY3RlZFJvd3MgPT09IDEpIGF3YWl0IHRoaXMuX3JlbGVhc2VDb25jdXJyZW5jeShkYiwgam9iLmNvbmN1cnJlbmN5S2V5KVxuICAgIH0pKVxuICB9XG5cbiAgLyoqXG4gICAqIEFwcGxpZXMgYSBmZW5jZWQgc3VjY2Vzc2Z1bCBhY2tub3dsZWRnZW1lbnQuXG4gICAqIEBwYXJhbSB7e2pvYklkOiBzdHJpbmcsIGhhbmRvZmZJZD86IHN0cmluZ319IGFyZ3MgLSBDb21wbGV0aW9uIHJlcG9ydC5cbiAgICogQHJldHVybnMge1Byb21pc2U8Ym9vbGVhbj59IC0gV2hldGhlciB0aGUgbGVhc2Ugd29uLlxuICAgKi9cbiAgYXN5bmMgbWFya0NvbXBsZXRlZCh7am9iSWQsIGhhbmRvZmZJZH0pIHtcbiAgICBhd2FpdCB0aGlzLmVuc3VyZVJlYWR5KClcblxuICAgIHJldHVybiBhd2FpdCB0aGlzLl93aXRoRGIoYXN5bmMgKGNvbm5lY3Rpb24pID0+IGF3YWl0IHRoaXMuX211dGF0ZShjb25uZWN0aW9uLCBhc3luYyAoZGIpID0+IHtcbiAgICAgIGNvbnN0IGpvYiA9IGF3YWl0IHRoaXMuX2dldEpvYihkYiwgam9iSWQpXG5cbiAgICAgIGlmICghdGhpcy5fYWNjZXB0c0hhbmRvZmYoam9iLCBoYW5kb2ZmSWQpKSByZXR1cm4gZmFsc2VcbiAgICAgIGF3YWl0IHRoaXMuX2xvY2tDb25jdXJyZW5jeVJvdyhkYiwgam9iLmNvbmN1cnJlbmN5S2V5KVxuXG4gICAgICBjb25zdCBhZmZlY3RlZFJvd3MgPSBhd2FpdCB0aGlzLl91cGRhdGVBZmZlY3RlZFJvd3MoZGIsIHtcbiAgICAgICAgY29uZGl0aW9uczoge2hhbmRvZmZfaWQ6IGhhbmRvZmZJZCwgaWQ6IGpvYklkLCBzdGF0dXM6IFwiaGFuZGVkX29mZlwifSxcbiAgICAgICAgZGF0YToge2NvbXBsZXRlZF9hdF9tczogdGhpcy5jbG9jay5ub3coKSwgc3RhdHVzOiBcImNvbXBsZXRlZFwifSxcbiAgICAgICAgdGFibGVOYW1lOiBMT0NBTF9CQUNLR1JPVU5EX0pPQlNfVEFCTEVcbiAgICAgIH0pXG5cbiAgICAgIGlmIChhZmZlY3RlZFJvd3MgIT09IDEpIHJldHVybiBmYWxzZVxuICAgICAgYXdhaXQgdGhpcy5fcmVsZWFzZUNvbmN1cnJlbmN5KGRiLCBqb2IuY29uY3VycmVuY3lLZXkpXG4gICAgICBhd2FpdCB0aGlzLl9yZWxlYXNlU2NoZWR1bGVPd25lcnNoaXBGb3JKb2IoZGIsIGpvYilcbiAgICAgIHJldHVybiB0cnVlXG4gICAgfSkpXG4gIH1cblxuICAvKipcbiAgICogUmVjb3JkcyBwb29sZWQtY2hpbGQgYWNjZXB0YW5jZSBldmlkZW5jZSBmb3IgYW4gYWN0aXZlIGhhbmRvZmYuIE9ubHkgdGhlXG4gICAqIGZpZWxkcyBzdXBwbGllZCBhcmUgd3JpdHRlbiwgZmVuY2VkIGJ5IHRoZSBleGFjdCBhY3RpdmUgaGFuZG9mZiBsZWFzZS5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBBY2NlcHRhbmNlIHJlcG9ydC5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGFyZ3Muam9iSWQgLSBKb2IgaWQuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBbYXJncy5oYW5kb2ZmSWRdIC0gSGFuZG9mZiBsZWFzZSBpZC5cbiAgICogQHBhcmFtIHtudW1iZXJ9IFthcmdzLnJlY2VpdmVkQXRNc10gLSBFcG9jaCBtcyB0aGUgcnVubmVyIGNoaWxkIHJlY2VpdmVkIHRoZSBqb2IuXG4gICAqIEBwYXJhbSB7bnVtYmVyfSBbYXJncy5zdGFydGVkQXRNc10gLSBFcG9jaCBtcyB0aGUgam9iJ3MgcGVyZm9ybSBzdGFydGVkIGluIHRoZSBjaGlsZC5cbiAgICogQHBhcmFtIHtzdHJpbmd9IFthcmdzLmNoaWxkSW5zdGFuY2VJZF0gLSBTdGFibGUgcG9vbGVkIGNoaWxkIGlkZW50aXR5LlxuICAgKiBAcGFyYW0ge251bWJlcn0gW2FyZ3MuY2hpbGRQaWRdIC0gUG9vbGVkIGNoaWxkIE9TIHBpZC5cbiAgICogQHBhcmFtIHtzdHJpbmd9IFthcmdzLnJ1bm5lckhvc3RuYW1lXSAtIEhvc3RuYW1lIG9mIHRoZSBtYWNoaW5lIHJ1bm5pbmcgdGhlIHBvb2xlZCBjaGlsZC5cbiAgICogQHJldHVybnMge1Byb21pc2U8Ym9vbGVhbj59IC0gV2hldGhlciB0aGUgbGVhc2Ugd29uLlxuICAgKi9cbiAgYXN5bmMgbWFya0NoaWxkQWNjZXB0ZWQoe2pvYklkLCBoYW5kb2ZmSWQsIHJlY2VpdmVkQXRNcywgc3RhcnRlZEF0TXMsIGNoaWxkSW5zdGFuY2VJZCwgY2hpbGRQaWQsIHJ1bm5lckhvc3RuYW1lfSkge1xuICAgIGF3YWl0IHRoaXMuZW5zdXJlUmVhZHkoKVxuXG4gICAgcmV0dXJuIGF3YWl0IHRoaXMuX3dpdGhEYihhc3luYyAoY29ubmVjdGlvbikgPT4gYXdhaXQgdGhpcy5fbXV0YXRlKGNvbm5lY3Rpb24sIGFzeW5jIChkYikgPT4ge1xuICAgICAgY29uc3Qgam9iID0gYXdhaXQgdGhpcy5fZ2V0Sm9iKGRiLCBqb2JJZClcblxuICAgICAgaWYgKCF0aGlzLl9hY2NlcHRzSGFuZG9mZihqb2IsIGhhbmRvZmZJZCkpIHJldHVybiBmYWxzZVxuXG4gICAgICBjb25zdCBkYXRhID0ge31cbiAgICAgIGlmICh0eXBlb2YgcmVjZWl2ZWRBdE1zID09PSBcIm51bWJlclwiKSBkYXRhLmNoaWxkX3JlY2VpdmVkX2F0X21zID0gcmVjZWl2ZWRBdE1zXG4gICAgICBpZiAodHlwZW9mIHN0YXJ0ZWRBdE1zID09PSBcIm51bWJlclwiKSBkYXRhLmNoaWxkX3N0YXJ0ZWRfYXRfbXMgPSBzdGFydGVkQXRNc1xuICAgICAgaWYgKHR5cGVvZiBjaGlsZEluc3RhbmNlSWQgPT09IFwic3RyaW5nXCIpIGRhdGEuY2hpbGRfaW5zdGFuY2VfaWQgPSBjaGlsZEluc3RhbmNlSWRcbiAgICAgIGlmICh0eXBlb2YgY2hpbGRQaWQgPT09IFwibnVtYmVyXCIpIGRhdGEuY2hpbGRfcGlkID0gY2hpbGRQaWRcbiAgICAgIGlmICh0eXBlb2YgcnVubmVySG9zdG5hbWUgPT09IFwic3RyaW5nXCIpIGRhdGEucnVubmVyX2hvc3RuYW1lID0gcnVubmVySG9zdG5hbWVcbiAgICAgIGlmIChPYmplY3Qua2V5cyhkYXRhKS5sZW5ndGggPT09IDApIHJldHVybiBmYWxzZVxuXG4gICAgICBjb25zdCBhZmZlY3RlZFJvd3MgPSBhd2FpdCB0aGlzLl91cGRhdGVBZmZlY3RlZFJvd3MoZGIsIHtcbiAgICAgICAgY29uZGl0aW9uczoge2hhbmRvZmZfaWQ6IGhhbmRvZmZJZCwgaWQ6IGpvYklkLCBzdGF0dXM6IFwiaGFuZGVkX29mZlwifSxcbiAgICAgICAgZGF0YSxcbiAgICAgICAgdGFibGVOYW1lOiBMT0NBTF9CQUNLR1JPVU5EX0pPQlNfVEFCTEVcbiAgICAgIH0pXG5cbiAgICAgIHJldHVybiBhZmZlY3RlZFJvd3MgPT09IDFcbiAgICB9KSlcbiAgfVxuXG4gIC8qKlxuICAgKiBBcHBsaWVzIGEgZmVuY2VkIHJlc2NoZWR1bGUgd2l0aG91dCBjb25zdW1pbmcgYW4gYXR0ZW1wdC5cbiAgICogQHBhcmFtIHt7am9iSWQ6IHN0cmluZywgaGFuZG9mZklkPzogc3RyaW5nLCBkZWxheU1zOiBudW1iZXJ9fSBhcmdzIC0gUmVzY2hlZHVsZSByZXBvcnQuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPGJvb2xlYW4+fSAtIFdoZXRoZXIgdGhlIGxlYXNlIHdvbi5cbiAgICovXG4gIGFzeW5jIG1hcmtSZXNjaGVkdWxlZCh7am9iSWQsIGhhbmRvZmZJZCwgZGVsYXlNc30pIHtcbiAgICBhd2FpdCB0aGlzLmVuc3VyZVJlYWR5KClcblxuICAgIHJldHVybiBhd2FpdCB0aGlzLl93aXRoRGIoYXN5bmMgKGNvbm5lY3Rpb24pID0+IGF3YWl0IHRoaXMuX211dGF0ZShjb25uZWN0aW9uLCBhc3luYyAoZGIpID0+IHtcbiAgICAgIGNvbnN0IGpvYiA9IGF3YWl0IHRoaXMuX2dldEpvYihkYiwgam9iSWQpXG5cbiAgICAgIGlmICghdGhpcy5fYWNjZXB0c0hhbmRvZmYoam9iLCBoYW5kb2ZmSWQpKSByZXR1cm4gZmFsc2VcbiAgICAgIGF3YWl0IHRoaXMuX2xvY2tDb25jdXJyZW5jeVJvdyhkYiwgam9iLmNvbmN1cnJlbmN5S2V5KVxuXG4gICAgICBjb25zdCBhZmZlY3RlZFJvd3MgPSBhd2FpdCB0aGlzLl91cGRhdGVBZmZlY3RlZFJvd3MoZGIsIHtcbiAgICAgICAgY29uZGl0aW9uczoge2hhbmRvZmZfaWQ6IGhhbmRvZmZJZCwgaWQ6IGpvYklkLCBzdGF0dXM6IFwiaGFuZGVkX29mZlwifSxcbiAgICAgICAgZGF0YToge1xuICAgICAgICAgIC4uLnRoaXMuX2NsZWFyZWRDaGlsZEFjY2VwdGFuY2VEYXRhKCksXG4gICAgICAgICAgaGFuZGVkX29mZl9hdF9tczogbnVsbCxcbiAgICAgICAgICBoYW5kb2ZmX2lkOiBudWxsLFxuICAgICAgICAgIHNjaGVkdWxlZF9hdF9tczogcmVzY2hlZHVsZWRCYWNrZ3JvdW5kSm9iQXRNcyhkZWxheU1zLCB0aGlzLmNsb2NrLm5vdygpKSxcbiAgICAgICAgICBzdGF0dXM6IFwicXVldWVkXCIsXG4gICAgICAgICAgd29ya2VyX2lkOiBudWxsXG4gICAgICAgIH0sXG4gICAgICAgIHRhYmxlTmFtZTogTE9DQUxfQkFDS0dST1VORF9KT0JTX1RBQkxFXG4gICAgICB9KVxuXG4gICAgICBpZiAoYWZmZWN0ZWRSb3dzICE9PSAxKSByZXR1cm4gZmFsc2VcbiAgICAgIGF3YWl0IHRoaXMuX3JlbGVhc2VDb25jdXJyZW5jeShkYiwgam9iLmNvbmN1cnJlbmN5S2V5KVxuICAgICAgcmV0dXJuIHRydWVcbiAgICB9KSlcbiAgfVxuXG4gIC8qKlxuICAgKiBBcHBsaWVzIGEgZmVuY2VkIGZhaWx1cmUsIHJldHJ5LCBvciB0ZXJtaW5hbCB0cmFuc2l0aW9uLlxuICAgKiBAcGFyYW0ge3tqb2JJZDogc3RyaW5nLCBoYW5kb2ZmSWQ/OiBzdHJpbmcsIGVycm9yOiBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn19IGFyZ3MgLSBGYWlsdXJlIHJlcG9ydC5cbiAgICogQHJldHVybnMge1Byb21pc2U8aW1wb3J0KFwiLi90eXBlcy5qc1wiKS5CYWNrZ3JvdW5kSm9iUm93IHwgbnVsbD59IC0gQWNjZXB0ZWQgdHJhbnNpdGlvbiBzbmFwc2hvdC5cbiAgICovXG4gIGFzeW5jIG1hcmtGYWlsZWQoe2pvYklkLCBoYW5kb2ZmSWQsIGVycm9yfSkge1xuICAgIGF3YWl0IHRoaXMuZW5zdXJlUmVhZHkoKVxuXG4gICAgcmV0dXJuIGF3YWl0IHRoaXMuX3dpdGhEYihhc3luYyAoY29ubmVjdGlvbikgPT4gYXdhaXQgdGhpcy5fbXV0YXRlKGNvbm5lY3Rpb24sIGFzeW5jIChkYikgPT4ge1xuICAgICAgY29uc3Qgam9iID0gYXdhaXQgdGhpcy5fZ2V0Sm9iKGRiLCBqb2JJZClcblxuICAgICAgaWYgKCF0aGlzLl9hY2NlcHRzSGFuZG9mZihqb2IsIGhhbmRvZmZJZCkpIHJldHVybiBudWxsXG5cbiAgICAgIHJldHVybiBhd2FpdCB0aGlzLl9hcHBseUZhaWx1cmUoZGIsIGpvYiwgZXJyb3IpXG4gICAgfSkpXG4gIH1cblxuICAvKipcbiAgICogVHVybnMgZXZlcnkgYWJhbmRvbmVkIGxvY2FsIGhhbmRvZmYgaW50byB0aGUgbm9ybWFsIGZhaWx1cmUvcmV0cnkgcGF0aC5cbiAgICogQHJldHVybnMge1Byb21pc2U8aW1wb3J0KFwiLi90eXBlcy5qc1wiKS5CYWNrZ3JvdW5kSm9iUm93W10+fSAtIFJlY292ZXJlZCB0cmFuc2l0aW9ucy5cbiAgICovXG4gIGFzeW5jIHJlY292ZXJIYW5kZWRPZmZKb2JzKCkge1xuICAgIGF3YWl0IHRoaXMuZW5zdXJlUmVhZHkoKVxuXG4gICAgcmV0dXJuIGF3YWl0IHRoaXMuX3dpdGhEYihhc3luYyAoY29ubmVjdGlvbikgPT4gYXdhaXQgdGhpcy5fbXV0YXRlKGNvbm5lY3Rpb24sIGFzeW5jIChkYikgPT4ge1xuICAgICAgY29uc3QgcXVldWVzID0gdGhpcy5jb25maWd1cmF0aW9uLmdldEJhY2tncm91bmRKb2JzQ29uZmlnKCkucXVldWVzXG4gICAgICBjb25zdCByb3dzID0gYXdhaXQgZGIubmV3UXVlcnkoKS5mcm9tKExPQ0FMX0JBQ0tHUk9VTkRfSk9CU19UQUJMRSkud2hlcmUoe3N0YXR1czogXCJoYW5kZWRfb2ZmXCJ9KS5yZXN1bHRzKClcbiAgICAgIC8qKiBAdHlwZSB7aW1wb3J0KFwiLi90eXBlcy5qc1wiKS5CYWNrZ3JvdW5kSm9iUm93W119ICovXG4gICAgICBjb25zdCByZWNvdmVyZWQgPSBbXVxuXG4gICAgICBmb3IgKGNvbnN0IHJhd1JvdyBvZiByb3dzKSB7XG4gICAgICAgIGNvbnN0IGpvYiA9IHRoaXMuX25vcm1hbGl6ZVJvdyhyYXdSb3cpXG4gICAgICAgIGNvbnN0IHVwZGF0ZWQgPSBhd2FpdCB0aGlzLl9hcHBseUZhaWx1cmUoZGIsIGpvYiwgbmV3IEVycm9yKFwiTG9jYWwgYmFja2dyb3VuZCBqb2IgcmVjb3ZlcmVkIGFmdGVyIGFuIGludGVycnVwdGVkIGRpc3BhdGNoZXJcIikpXG5cbiAgICAgICAgaWYgKCF1cGRhdGVkKSBjb250aW51ZVxuXG4gICAgICAgIGNvbnN0IHJlY29uY2lsZWQgPSB1cGRhdGVkLnN0YXR1cyA9PT0gXCJxdWV1ZWRcIlxuICAgICAgICAgID8gYXdhaXQgdGhpcy5fcmVjb25jaWxlUXVldWVkSm9iQ29uY3VycmVuY3koZGIsIHVwZGF0ZWQsIHF1ZXVlcylcbiAgICAgICAgICA6IHVwZGF0ZWRcblxuICAgICAgICByZWNvdmVyZWQucHVzaChyZWNvbmNpbGVkKVxuICAgICAgfVxuXG4gICAgICBhd2FpdCB0aGlzLl9yZWJ1aWxkQ29uY3VycmVuY3lDb3VudHMoZGIpXG4gICAgICByZXR1cm4gcmVjb3ZlcmVkXG4gICAgfSkpXG4gIH1cblxuICAvKipcbiAgICogRGVsZXRlcyBsb2NhbCBxdWV1ZSBzdGF0ZSBmb3IgZm9jdXNlZCB0ZXN0cy5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgYWZ0ZXIgZGVsZXRpb24uXG4gICAqL1xuICBhc3luYyBjbGVhckFsbCgpIHtcbiAgICBhd2FpdCB0aGlzLmVuc3VyZVJlYWR5KClcbiAgICBhd2FpdCB0aGlzLl93aXRoRGIoYXN5bmMgKGNvbm5lY3Rpb24pID0+IGF3YWl0IHRoaXMuX211dGF0ZShjb25uZWN0aW9uLCBhc3luYyAoZGIpID0+IHtcbiAgICAgIGF3YWl0IGRiLnF1ZXJ5KGBERUxFVEUgRlJPTSAke2RiLnF1b3RlVGFibGUoTE9DQUxfQkFDS0dST1VORF9KT0JfU0NIRURVTEVfS0VZU19UQUJMRSl9YClcbiAgICAgIGF3YWl0IGRiLnF1ZXJ5KGBERUxFVEUgRlJPTSAke2RiLnF1b3RlVGFibGUoTE9DQUxfQkFDS0dST1VORF9KT0JTX1RBQkxFKX1gKVxuICAgICAgYXdhaXQgZGIucXVlcnkoYERFTEVURSBGUk9NICR7ZGIucXVvdGVUYWJsZShMT0NBTF9CQUNLR1JPVU5EX0pPQl9DT05DVVJSRU5DWV9UQUJMRSl9YClcbiAgICB9KSlcbiAgfVxuXG4gIC8qKlxuICAgKiBBcHBsaWVzIHRoZSBjb21tb24gcmV0cnkgb3IgZXhoYXVzdGVkIGZhaWx1cmUgdHJhbnNpdGlvbi5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9kYXRhYmFzZS9kcml2ZXJzL2Jhc2UuanNcIikuZGVmYXVsdH0gZGIgLSBMb2NhbCBTUUxpdGUgY29ubmVjdGlvbi5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL3R5cGVzLmpzXCIpLkJhY2tncm91bmRKb2JSb3d9IGpvYiAtIEFjdGl2ZSBoYW5kb2ZmLlxuICAgKiBAcGFyYW0ge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSBlcnJvciAtIFBlcmZvcm1hbmNlIGVycm9yLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxpbXBvcnQoXCIuL3R5cGVzLmpzXCIpLkJhY2tncm91bmRKb2JSb3cgfCBudWxsPn0gLSBUcmFuc2l0aW9uIHNuYXBzaG90LlxuICAgKi9cbiAgYXN5bmMgX2FwcGx5RmFpbHVyZShkYiwgam9iLCBlcnJvcikge1xuICAgIGNvbnN0IGF0dGVtcHRzID0gKGpvYi5hdHRlbXB0cyB8fCAwKSArIDFcbiAgICBjb25zdCBtYXhSZXRyaWVzID0gbm9ybWFsaXplQmFja2dyb3VuZEpvYk1heFJldHJpZXMoam9iLm1heFJldHJpZXMpXG4gICAgY29uc3Qgd2lsbFJldHJ5ID0gYXR0ZW1wdHMgPD0gbWF4UmV0cmllc1xuICAgIGNvbnN0IG5vd01zID0gdGhpcy5jbG9jay5ub3coKVxuICAgIC8qKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSAqL1xuICAgIGNvbnN0IGRhdGEgPSB7XG4gICAgICBhdHRlbXB0cyxcbiAgICAgIGhhbmRlZF9vZmZfYXRfbXM6IG51bGwsXG4gICAgICBoYW5kb2ZmX2lkOiBudWxsLFxuICAgICAgbGFzdF9lcnJvcjogbm9ybWFsaXplQmFja2dyb3VuZEpvYkVycm9yKGVycm9yKSxcbiAgICAgIHN0YXR1czogd2lsbFJldHJ5ID8gXCJxdWV1ZWRcIiA6IFwiZmFpbGVkXCIsXG4gICAgICB3b3JrZXJfaWQ6IG51bGxcbiAgICB9XG5cbiAgICBpZiAod2lsbFJldHJ5KSB7XG4gICAgICAvLyBBIHJldHJ5IHN0YXJ0cyBhIGZyZXNoIGhhbmRvZmYgd2l0aCBhIHBvc3NpYmx5IGRpZmZlcmVudCBydW5uZXIsIHNvIHRoZVxuICAgICAgLy8gcHJldmlvdXMgY2hpbGQncyBhY2NlcHRhbmNlIGV2aWRlbmNlIG11c3Qgbm90IGxlYWsgaW50byB0aGUgbmV4dCBhdHRlbXB0LlxuICAgICAgT2JqZWN0LmFzc2lnbihkYXRhLCB7c2NoZWR1bGVkX2F0X21zOiBub3dNcyArIHJldHJ5RGVsYXlNcyhhdHRlbXB0cyksIC4uLnRoaXMuX2NsZWFyZWRDaGlsZEFjY2VwdGFuY2VEYXRhKCl9KVxuICAgIH0gZWxzZSB7XG4gICAgICBPYmplY3QuYXNzaWduKGRhdGEsIHtmYWlsZWRfYXRfbXM6IG5vd01zfSlcbiAgICB9XG5cbiAgICBhd2FpdCB0aGlzLl9sb2NrQ29uY3VycmVuY3lSb3coZGIsIGpvYi5jb25jdXJyZW5jeUtleSlcbiAgICBjb25zdCBhZmZlY3RlZFJvd3MgPSBhd2FpdCB0aGlzLl91cGRhdGVBZmZlY3RlZFJvd3MoZGIsIHtcbiAgICAgIGNvbmRpdGlvbnM6IHtoYW5kb2ZmX2lkOiBqb2IuaGFuZG9mZklkLCBpZDogam9iLmlkLCBzdGF0dXM6IFwiaGFuZGVkX29mZlwifSxcbiAgICAgIGRhdGEsXG4gICAgICB0YWJsZU5hbWU6IExPQ0FMX0JBQ0tHUk9VTkRfSk9CU19UQUJMRVxuICAgIH0pXG5cbiAgICBpZiAoYWZmZWN0ZWRSb3dzICE9PSAxKSByZXR1cm4gbnVsbFxuICAgIGF3YWl0IHRoaXMuX3JlbGVhc2VDb25jdXJyZW5jeShkYiwgam9iLmNvbmN1cnJlbmN5S2V5KVxuICAgIGlmICghd2lsbFJldHJ5KSBhd2FpdCB0aGlzLl9yZWxlYXNlU2NoZWR1bGVPd25lcnNoaXBGb3JKb2IoZGIsIGpvYilcblxuICAgIHJldHVybiB7XG4gICAgICAuLi5qb2IsXG4gICAgICAuLi4od2lsbFJldHJ5ID8gdGhpcy5fY2xlYXJlZENoaWxkQWNjZXB0YW5jZVJvdygpIDoge30pLFxuICAgICAgYXR0ZW1wdHMsXG4gICAgICBmYWlsZWRBdE1zOiB3aWxsUmV0cnkgPyBqb2IuZmFpbGVkQXRNcyA6IG5vd01zLFxuICAgICAgaGFuZGVkT2ZmQXRNczogbnVsbCxcbiAgICAgIGhhbmRvZmZJZDogbnVsbCxcbiAgICAgIGxhc3RFcnJvcjogZGF0YS5sYXN0X2Vycm9yLFxuICAgICAgc2NoZWR1bGVkQXRNczogd2lsbFJldHJ5ID8gTnVtYmVyKGRhdGEuc2NoZWR1bGVkX2F0X21zKSA6IGpvYi5zY2hlZHVsZWRBdE1zLFxuICAgICAgc3RhdHVzOiBkYXRhLnN0YXR1cyxcbiAgICAgIHdvcmtlcklkOiBudWxsXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIFJldHVybnMgdGhlIGRhdGFiYXNlIGRhdGEgdGhhdCBjbGVhcnMgcG9vbGVkLWNoaWxkIGFjY2VwdGFuY2UgZXZpZGVuY2UuXG4gICAqIEByZXR1cm5zIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59IC0gQ2xlYXJlZCBhY2NlcHRhbmNlIGNvbHVtbnMuXG4gICAqL1xuICBfY2xlYXJlZENoaWxkQWNjZXB0YW5jZURhdGEoKSB7XG4gICAgcmV0dXJuIHtjaGlsZF9pbnN0YW5jZV9pZDogbnVsbCwgY2hpbGRfcGlkOiBudWxsLCBjaGlsZF9yZWNlaXZlZF9hdF9tczogbnVsbCwgY2hpbGRfc3RhcnRlZF9hdF9tczogbnVsbCwgcnVubmVyX2hvc3RuYW1lOiBudWxsfVxuICB9XG5cbiAgLyoqXG4gICAqIFJldHVybnMgdGhlIHJvdy1zaGFwZSBjb3VudGVycGFydCBvZiB0aGUgY2xlYXJlZCBhY2NlcHRhbmNlIGNvbHVtbnMuXG4gICAqIEByZXR1cm5zIHtQaWNrPGltcG9ydChcIi4vdHlwZXMuanNcIikuQmFja2dyb3VuZEpvYlJvdywgXCJjaGlsZEluc3RhbmNlSWRcIiB8IFwiY2hpbGRQaWRcIiB8IFwiY2hpbGRSZWNlaXZlZEF0TXNcIiB8IFwiY2hpbGRTdGFydGVkQXRNc1wiIHwgXCJydW5uZXJIb3N0bmFtZVwiPn0gLSBDbGVhcmVkIGFjY2VwdGFuY2UgZmllbGRzLlxuICAgKi9cbiAgX2NsZWFyZWRDaGlsZEFjY2VwdGFuY2VSb3coKSB7XG4gICAgcmV0dXJuIHtjaGlsZEluc3RhbmNlSWQ6IG51bGwsIGNoaWxkUGlkOiBudWxsLCBjaGlsZFJlY2VpdmVkQXRNczogbnVsbCwgY2hpbGRTdGFydGVkQXRNczogbnVsbCwgcnVubmVySG9zdG5hbWU6IG51bGx9XG4gIH1cblxuICAvKipcbiAgICogRW5zdXJlcyB0aGF0IGEgZHVyYWJsZSBjb25jdXJyZW5jeSBjb3VudGVyIGV4aXN0cyB3aXRoIHRoZSByZXF1aXJlZCBjYXAuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vZGF0YWJhc2UvZHJpdmVycy9iYXNlLmpzXCIpLmRlZmF1bHR9IGRiIC0gTG9jYWwgU1FMaXRlIGNvbm5lY3Rpb24uXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi90eXBlcy5qc1wiKS5SZXNvbHZlZEJhY2tncm91bmRKb2JDb25jdXJyZW5jeX0gY29uY3VycmVuY3kgLSBEZXNpcmVkIGNvdW50ZXIuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIHdoZW4gZW5zdXJlZC5cbiAgICovXG4gIGFzeW5jIF9lbnN1cmVDb25jdXJyZW5jeShkYiwgY29uY3VycmVuY3kpIHtcbiAgICBhd2FpdCBkYi51cHNlcnQoe1xuICAgICAgY29uZmxpY3RDb2x1bW5zOiBbXCJjb25jdXJyZW5jeV9rZXlcIl0sXG4gICAgICBkYXRhOiB7YWN0aXZlX2NvdW50OiAwLCBjb25jdXJyZW5jeV9rZXk6IGNvbmN1cnJlbmN5LmNvbmN1cnJlbmN5S2V5LCBtYXhfY29uY3VycmVuY3k6IGNvbmN1cnJlbmN5Lm1heENvbmN1cnJlbmN5fSxcbiAgICAgIHRhYmxlTmFtZTogTE9DQUxfQkFDS0dST1VORF9KT0JfQ09OQ1VSUkVOQ1lfVEFCTEUsXG4gICAgICB1cGRhdGVDb2x1bW5zOiBbXCJjb25jdXJyZW5jeV9rZXlcIl1cbiAgICB9KVxuXG4gICAgY29uc3Qgcm93cyA9IGF3YWl0IGRiXG4gICAgICAubmV3UXVlcnkoKVxuICAgICAgLmZyb20oTE9DQUxfQkFDS0dST1VORF9KT0JfQ09OQ1VSUkVOQ1lfVEFCTEUpXG4gICAgICAud2hlcmUoe2NvbmN1cnJlbmN5X2tleTogY29uY3VycmVuY3kuY29uY3VycmVuY3lLZXl9KVxuICAgICAgLmxpbWl0KDEpXG4gICAgICAucmVzdWx0cygpXG5cbiAgICBjb25zdCBleGlzdGluZ1JvdyA9IC8qKiBAdHlwZSB7e21heF9jb25jdXJyZW5jeTogbnVtYmVyIHwgc3RyaW5nfX0gKi8gKHJvd3NbMF0pXG4gICAgY29uc3QgZXhpc3RpbmdDYXAgPSBOdW1iZXIoZXhpc3RpbmdSb3cubWF4X2NvbmN1cnJlbmN5KVxuXG4gICAgaWYgKGV4aXN0aW5nQ2FwID09PSBjb25jdXJyZW5jeS5tYXhDb25jdXJyZW5jeSkgcmV0dXJuXG4gICAgaWYgKCFjb25jdXJyZW5jeS5xdWV1ZURlcml2ZWQpIHRocm93IG5ldyBFcnJvcihgQ29uZmxpY3RpbmcgbWF4Q29uY3VycmVuY3kgZm9yIGJhY2tncm91bmQgam9iIGNvbmN1cnJlbmN5S2V5OiAke2NvbmN1cnJlbmN5LmNvbmN1cnJlbmN5S2V5fWApXG5cbiAgICBhd2FpdCBkYi51cGRhdGUoe1xuICAgICAgY29uZGl0aW9uczoge2NvbmN1cnJlbmN5X2tleTogY29uY3VycmVuY3kuY29uY3VycmVuY3lLZXl9LFxuICAgICAgZGF0YToge21heF9jb25jdXJyZW5jeTogY29uY3VycmVuY3kubWF4Q29uY3VycmVuY3l9LFxuICAgICAgdGFibGVOYW1lOiBMT0NBTF9CQUNLR1JPVU5EX0pPQl9DT05DVVJSRU5DWV9UQUJMRVxuICAgIH0pXG4gIH1cblxuICAvKipcbiAgICogQXRvbWljYWxseSByZXNlcnZlcyBvbmUgc2xvdCBmb3IgYSBjb25jdXJyZW5jeSBrZXkuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vZGF0YWJhc2UvZHJpdmVycy9iYXNlLmpzXCIpLmRlZmF1bHR9IGRiIC0gQ29ubmVjdGlvbi5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGNvbmN1cnJlbmN5S2V5IC0gQ29uY3VycmVuY3kga2V5LlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxib29sZWFuPn0gLSBXaGV0aGVyIGEgc2xvdCB3YXMgcmVzZXJ2ZWQuXG4gICAqL1xuICBhc3luYyBfcmVzZXJ2ZUNvbmN1cnJlbmN5KGRiLCBjb25jdXJyZW5jeUtleSkge1xuICAgIGNvbnN0IHRhYmxlID0gZGIucXVvdGVUYWJsZShMT0NBTF9CQUNLR1JPVU5EX0pPQl9DT05DVVJSRU5DWV9UQUJMRSlcbiAgICBjb25zdCBjb3VudCA9IGRiLnF1b3RlQ29sdW1uKFwiYWN0aXZlX2NvdW50XCIpXG4gICAgY29uc3QgYWZmZWN0ZWRSb3dzID0gYXdhaXQgZGIuYWZmZWN0ZWRSb3dzKFxuICAgICAgYFVQREFURSAke3RhYmxlfSBTRVQgJHtjb3VudH0gPSAke2NvdW50fSArIDEgYCArXG4gICAgICBgV0hFUkUgJHtkYi5xdW90ZUNvbHVtbihcImNvbmN1cnJlbmN5X2tleVwiKX0gPSAke2RiLnF1b3RlKGNvbmN1cnJlbmN5S2V5KX0gYCArXG4gICAgICBgQU5EICR7Y291bnR9IDwgJHtkYi5xdW90ZUNvbHVtbihcIm1heF9jb25jdXJyZW5jeVwiKX1gXG4gICAgKVxuXG4gICAgcmV0dXJuIGFmZmVjdGVkUm93cyA9PT0gMVxuICB9XG5cbiAgLyoqXG4gICAqIFJlbGVhc2VzIG9uZSBzbG90IGZvciBhIGNvbmN1cnJlbmN5IGtleS5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9kYXRhYmFzZS9kcml2ZXJzL2Jhc2UuanNcIikuZGVmYXVsdH0gZGIgLSBDb25uZWN0aW9uLlxuICAgKiBAcGFyYW0ge3N0cmluZyB8IG51bGx9IGNvbmN1cnJlbmN5S2V5IC0gQ29uY3VycmVuY3kga2V5LlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyBhZnRlciByZWxlYXNlLlxuICAgKi9cbiAgYXN5bmMgX3JlbGVhc2VDb25jdXJyZW5jeShkYiwgY29uY3VycmVuY3lLZXkpIHtcbiAgICBpZiAoIWNvbmN1cnJlbmN5S2V5KSByZXR1cm5cblxuICAgIGNvbnN0IHRhYmxlID0gZGIucXVvdGVUYWJsZShMT0NBTF9CQUNLR1JPVU5EX0pPQl9DT05DVVJSRU5DWV9UQUJMRSlcbiAgICBjb25zdCBjb3VudCA9IGRiLnF1b3RlQ29sdW1uKFwiYWN0aXZlX2NvdW50XCIpXG5cbiAgICBhd2FpdCBkYi5hZmZlY3RlZFJvd3MoXG4gICAgICBgVVBEQVRFICR7dGFibGV9IFNFVCAke2NvdW50fSA9ICR7Y291bnR9IC0gMSBgICtcbiAgICAgIGBXSEVSRSAke2RiLnF1b3RlQ29sdW1uKFwiY29uY3VycmVuY3lfa2V5XCIpfSA9ICR7ZGIucXVvdGUoY29uY3VycmVuY3lLZXkpfSBBTkQgJHtjb3VudH0gPiAwYFxuICAgIClcbiAgfVxuXG4gIC8qKlxuICAgKiBBY3F1aXJlcyB0aGUgdHJhbnNhY3Rpb24ncyB3cml0ZSBsb2NrIGZvciBhIGNvbmN1cnJlbmN5IGNvdW50ZXIgcm93LlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL2RhdGFiYXNlL2RyaXZlcnMvYmFzZS5qc1wiKS5kZWZhdWx0fSBkYiAtIENvbm5lY3Rpb24uXG4gICAqIEBwYXJhbSB7c3RyaW5nIHwgbnVsbH0gY29uY3VycmVuY3lLZXkgLSBDb25jdXJyZW5jeSBrZXkuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIGFmdGVyIGxvY2tpbmcuXG4gICAqL1xuICBhc3luYyBfbG9ja0NvbmN1cnJlbmN5Um93KGRiLCBjb25jdXJyZW5jeUtleSkge1xuICAgIGlmICghY29uY3VycmVuY3lLZXkpIHJldHVyblxuXG4gICAgY29uc3QgdGFibGUgPSBkYi5xdW90ZVRhYmxlKExPQ0FMX0JBQ0tHUk9VTkRfSk9CX0NPTkNVUlJFTkNZX1RBQkxFKVxuICAgIGNvbnN0IGNvdW50ID0gZGIucXVvdGVDb2x1bW4oXCJhY3RpdmVfY291bnRcIilcblxuICAgIGF3YWl0IGRiLnF1ZXJ5KFxuICAgICAgYFVQREFURSAke3RhYmxlfSBTRVQgJHtjb3VudH0gPSAke2NvdW50fSBgICtcbiAgICAgIGBXSEVSRSAke2RiLnF1b3RlQ29sdW1uKFwiY29uY3VycmVuY3lfa2V5XCIpfSA9ICR7ZGIucXVvdGUoY29uY3VycmVuY3lLZXkpfWBcbiAgICApXG4gIH1cblxuICAvKipcbiAgICogUmVidWlsZHMgYWN0aXZlIGNvdW50ZXJzIGZyb20gZHVyYWJsZSBoYW5kZWQtb2ZmIGpvYnMuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vZGF0YWJhc2UvZHJpdmVycy9iYXNlLmpzXCIpLmRlZmF1bHR9IGRiIC0gQ29ubmVjdGlvbi5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgYWZ0ZXIgY291bnRlciByZWJ1aWxkLlxuICAgKi9cbiAgYXN5bmMgX3JlYnVpbGRDb25jdXJyZW5jeUNvdW50cyhkYikge1xuICAgIGNvbnN0IGNvbmN1cnJlbmN5VGFibGUgPSBkYi5xdW90ZVRhYmxlKExPQ0FMX0JBQ0tHUk9VTkRfSk9CX0NPTkNVUlJFTkNZX1RBQkxFKVxuICAgIGNvbnN0IGpvYnNUYWJsZSA9IGRiLnF1b3RlVGFibGUoTE9DQUxfQkFDS0dST1VORF9KT0JTX1RBQkxFKVxuXG4gICAgYXdhaXQgZGIucXVlcnkoXG4gICAgICBgVVBEQVRFICR7Y29uY3VycmVuY3lUYWJsZX0gU0VUICR7ZGIucXVvdGVDb2x1bW4oXCJhY3RpdmVfY291bnRcIil9ID0gKGAgK1xuICAgICAgYFNFTEVDVCBDT1VOVCgqKSBGUk9NICR7am9ic1RhYmxlfSBXSEVSRSAke2pvYnNUYWJsZX0uJHtkYi5xdW90ZUNvbHVtbihcInN0YXR1c1wiKX0gPSAke2RiLnF1b3RlKFwiaGFuZGVkX29mZlwiKX0gQU5EIGAgK1xuICAgICAgYCR7am9ic1RhYmxlfS4ke2RiLnF1b3RlQ29sdW1uKFwiY29uY3VycmVuY3lfa2V5XCIpfSA9ICR7Y29uY3VycmVuY3lUYWJsZX0uJHtkYi5xdW90ZUNvbHVtbihcImNvbmN1cnJlbmN5X2tleVwiKX0pYFxuICAgIClcbiAgfVxuXG4gIC8qKlxuICAgKiBCdWlsZHMgdGhlIGNvbmZpZ3VyZWQgcXVldWUtcHJpb3JpdHkgb3JkZXJpbmcgZXhwcmVzc2lvbi5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9kYXRhYmFzZS9kcml2ZXJzL2Jhc2UuanNcIikuZGVmYXVsdH0gZGIgLSBDb25uZWN0aW9uLlxuICAgKiBAcmV0dXJucyB7c3RyaW5nIHwgbnVsbH0gLSBRdWV1ZSBwcmlvcml0eSBleHByZXNzaW9uLlxuICAgKi9cbiAgX3F1ZXVlUHJpb3JpdHlPcmRlclNxbChkYikge1xuICAgIGNvbnN0IHF1ZXVlcyA9IHRoaXMuY29uZmlndXJhdGlvbi5nZXRCYWNrZ3JvdW5kSm9ic0NvbmZpZygpLnF1ZXVlc1xuICAgIGNvbnN0IHByaW9yaXRpemVkID0gT2JqZWN0LmVudHJpZXMocXVldWVzKVxuICAgICAgLmZpbHRlcigoWywgcXVldWVdKSA9PiBOdW1iZXIuaXNGaW5pdGUocXVldWU/LnByaW9yaXR5KSAmJiBOdW1iZXIocXVldWUucHJpb3JpdHkpICE9PSAwKVxuICAgICAgLm1hcCgoW3F1ZXVlTmFtZSwgcXVldWVdKSA9PiBbcXVldWVOYW1lLCBOdW1iZXIocXVldWUucHJpb3JpdHkpXSlcblxuICAgIGlmIChwcmlvcml0aXplZC5sZW5ndGggPT09IDApIHJldHVybiBudWxsXG5cbiAgICBjb25zdCB3aGVucyA9IHByaW9yaXRpemVkXG4gICAgICAubWFwKChbcXVldWUsIHByaW9yaXR5XSkgPT4gYFdIRU4gJHtkYi5xdW90ZShxdWV1ZSl9IFRIRU4gJHtwcmlvcml0eX1gKVxuICAgICAgLmpvaW4oXCIgXCIpXG5cbiAgICByZXR1cm4gYENBU0UgQ09BTEVTQ0UoJHtkYi5xdW90ZUNvbHVtbihcInF1ZXVlXCIpfSwgJHtkYi5xdW90ZShERUZBVUxUX0JBQ0tHUk9VTkRfSk9CX1FVRVVFKX0pICR7d2hlbnN9IEVMU0UgMCBFTkRgXG4gIH1cblxuICAvKipcbiAgICogQ2hlY2tzIHdoZXRoZXIgYSBwZXJzaXN0ZWQgaGFuZG9mZiBvd25zIHRoZSBzdXBwbGllZCBhY2tub3dsZWRnZW1lbnQgZmVuY2UuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi90eXBlcy5qc1wiKS5CYWNrZ3JvdW5kSm9iUm93IHwgbnVsbH0gam9iIC0gUGVyc2lzdGVkIGpvYi5cbiAgICogQHBhcmFtIHtzdHJpbmcgfCB1bmRlZmluZWR9IGhhbmRvZmZJZCAtIEhhbmRvZmYgZmVuY2UuXG4gICAqIEByZXR1cm5zIHtqb2IgaXMgaW1wb3J0KFwiLi90eXBlcy5qc1wiKS5CYWNrZ3JvdW5kSm9iUm93fSAtIFdoZXRoZXIgYWNjZXB0ZWQuXG4gICAqL1xuICBfYWNjZXB0c0hhbmRvZmYoam9iLCBoYW5kb2ZmSWQpIHtcbiAgICByZXR1cm4gQm9vbGVhbihqb2IgJiYgam9iLnN0YXR1cyA9PT0gXCJoYW5kZWRfb2ZmXCIgJiYgam9iLmhhbmRvZmZJZCAmJiBqb2IuaGFuZG9mZklkID09PSBoYW5kb2ZmSWQpXG4gIH1cblxuICAvKipcbiAgICogRmluZHMgYSBwZXJzaXN0ZWQgbG9jYWwgam9iIHVzaW5nIHRoZSBjdXJyZW50IGNvbm5lY3Rpb24uXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vZGF0YWJhc2UvZHJpdmVycy9iYXNlLmpzXCIpLmRlZmF1bHR9IGRiIC0gQ29ubmVjdGlvbi5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGpvYklkIC0gSm9iIGlkLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxpbXBvcnQoXCIuL3R5cGVzLmpzXCIpLkJhY2tncm91bmRKb2JSb3cgfCBudWxsPn0gLSBQZXJzaXN0ZWQgcm93LlxuICAgKi9cbiAgYXN5bmMgX2dldEpvYihkYiwgam9iSWQpIHtcbiAgICBjb25zdCByb3dzID0gYXdhaXQgZGIubmV3UXVlcnkoKS5mcm9tKExPQ0FMX0JBQ0tHUk9VTkRfSk9CU19UQUJMRSkud2hlcmUoe2lkOiBqb2JJZH0pLmxpbWl0KDEpLnJlc3VsdHMoKVxuXG4gICAgcmV0dXJuIHJvd3NbMF0gPyB0aGlzLl9ub3JtYWxpemVSb3cocm93c1swXSkgOiBudWxsXG4gIH1cblxuICAvKipcbiAgICogUmVhZHMgdGhlIGpvYiBjdXJyZW50bHkgbmFtZWQgYnkgb25lIHN0YWJsZSBvd25lciByb3cuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vZGF0YWJhc2UvZHJpdmVycy9iYXNlLmpzXCIpLmRlZmF1bHR9IGRiIC0gRGF0YWJhc2UgY29ubmVjdGlvbi5cbiAgICogQHBhcmFtIHtzdHJpbmd9IHNjaGVkdWxlS2V5IC0gVmFsaWRhdGVkIHN0YWJsZSBzY2hlZHVsZSBrZXkuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPGltcG9ydChcIi4vdHlwZXMuanNcIikuQmFja2dyb3VuZEpvYlJvdyB8IG51bGw+fSAtIE5vcm1hbGl6ZWQgb3duZXIgam9iLlxuICAgKi9cbiAgYXN5bmMgX3NjaGVkdWxlZE93bmVySm9iKGRiLCBzY2hlZHVsZUtleSkge1xuICAgIGNvbnN0IG93bmVyUm93cyA9IGF3YWl0IGRiXG4gICAgICAubmV3UXVlcnkoKVxuICAgICAgLmZyb20oTE9DQUxfQkFDS0dST1VORF9KT0JfU0NIRURVTEVfS0VZU19UQUJMRSlcbiAgICAgIC53aGVyZSh7c2NoZWR1bGVfa2V5OiBzY2hlZHVsZUtleX0pXG4gICAgICAubGltaXQoMSlcbiAgICAgIC5yZXN1bHRzKClcbiAgICBjb25zdCBvd25lclJvdyA9IG93bmVyUm93c1swXVxuXG4gICAgaWYgKCFvd25lclJvdykgcmV0dXJuIG51bGxcblxuICAgIHJldHVybiBhd2FpdCB0aGlzLl9nZXRKb2IoZGIsIFN0cmluZyhvd25lclJvdy5qb2JfaWQpKVxuICB9XG5cbiAgLyoqXG4gICAqIEFzc2lnbnMgdGhlIG5leHQgb3duZXJzaGlwIG9yZGVyIGFmdGVyIFNRTGl0ZSB3cml0ZSBzZXJpYWxpemF0aW9uIGlzIGhlbGQuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vZGF0YWJhc2UvZHJpdmVycy9iYXNlLmpzXCIpLmRlZmF1bHR9IGRiIC0gRGF0YWJhc2UgY29ubmVjdGlvbi5cbiAgICogQHBhcmFtIHtzdHJpbmd9IHNjaGVkdWxlS2V5IC0gVmFsaWRhdGVkIHN0YWJsZSBzY2hlZHVsZSBrZXkuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPG51bWJlcj59IC0gTmV4dCBtb25vdG9uaWMgb3duZXJzaGlwIG9yZGVyLlxuICAgKi9cbiAgYXN5bmMgX25leHRTY2hlZHVsZU9yZGVyKGRiLCBzY2hlZHVsZUtleSkge1xuICAgIGNvbnN0IHJvd3MgPSBhd2FpdCBkYlxuICAgICAgLm5ld1F1ZXJ5KClcbiAgICAgIC5mcm9tKExPQ0FMX0JBQ0tHUk9VTkRfSk9CU19UQUJMRSlcbiAgICAgIC5zZWxlY3QoXCJzY2hlZHVsZV9vcmRlclwiKVxuICAgICAgLndoZXJlKHtzY2hlZHVsZV9rZXk6IHNjaGVkdWxlS2V5fSlcbiAgICAgIC53aGVyZShgJHtkYi5xdW90ZUNvbHVtbihcInNjaGVkdWxlX29yZGVyXCIpfSBJUyBOT1QgTlVMTGApXG4gICAgICAub3JkZXIoXCJzY2hlZHVsZV9vcmRlciBERVNDXCIpXG4gICAgICAubGltaXQoMSlcbiAgICAgIC5yZXN1bHRzKClcbiAgICBjb25zdCBjdXJyZW50T3JkZXIgPSB0aGlzLl9udW1iZXJPck51bGwoLyoqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59ICovIChyb3dzWzBdIHx8IHt9KS5zY2hlZHVsZV9vcmRlcilcblxuICAgIGlmIChjdXJyZW50T3JkZXIgPT09IG51bGwpIHJldHVybiAxXG4gICAgaWYgKCFOdW1iZXIuaXNTYWZlSW50ZWdlcihjdXJyZW50T3JkZXIpIHx8IGN1cnJlbnRPcmRlciA8IDEgfHwgY3VycmVudE9yZGVyID49IE51bWJlci5NQVhfU0FGRV9JTlRFR0VSKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoYEludmFsaWQgbG9jYWwgYmFja2dyb3VuZCBqb2Igc2NoZWR1bGUgb3duZXJzaGlwIG9yZGVyOiAke2N1cnJlbnRPcmRlcn1gKVxuICAgIH1cblxuICAgIHJldHVybiBjdXJyZW50T3JkZXIgKyAxXG4gIH1cblxuICAvKipcbiAgICogQnVpbGRzIGEgc3RhYmxlLXNjaGVkdWxlIGxvb2t1cCBleGNsdXNpdmVseSBmcm9tIG5vcm1hbGl6ZWQgbG9jYWwgam9icy5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9kYXRhYmFzZS9kcml2ZXJzL2Jhc2UuanNcIikuZGVmYXVsdH0gZGIgLSBEYXRhYmFzZSBjb25uZWN0aW9uLlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIExvb2t1cCBvcHRpb25zLlxuICAgKiBAcGFyYW0ge2Jvb2xlYW59IGFyZ3MuaW5jbHVkZUxhdGVzdFRlcm1pbmFsIC0gV2hldGhlciB0ZXJtaW5hbCBoaXN0b3J5IGlzIHJlcXVlc3RlZC5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGFyZ3Muc2NoZWR1bGVLZXkgLSBWYWxpZGF0ZWQgc3RhYmxlIHNjaGVkdWxlIGtleS5cbiAgICogQHJldHVybnMge1Byb21pc2U8aW1wb3J0KFwiLi90eXBlcy5qc1wiKS5CYWNrZ3JvdW5kSm9iU2NoZWR1bGVkTG9va3VwUmVzdWx0Pn0gLSBOb3JtYWxpemVkIGxvY2FsIGpvYnMuXG4gICAqL1xuICBhc3luYyBfc2NoZWR1bGVkSm9iTG9va3VwKGRiLCB7aW5jbHVkZUxhdGVzdFRlcm1pbmFsLCBzY2hlZHVsZUtleX0pIHtcbiAgICBjb25zdCBvd25lckpvYiA9IGF3YWl0IHRoaXMuX3NjaGVkdWxlZE93bmVySm9iKGRiLCBzY2hlZHVsZUtleSlcbiAgICBjb25zdCBjdXJyZW50Sm9iID0gb3duZXJKb2IgJiYgKG93bmVySm9iLnN0YXR1cyA9PT0gXCJxdWV1ZWRcIiB8fCBvd25lckpvYi5zdGF0dXMgPT09IFwiaGFuZGVkX29mZlwiKSA/IG93bmVySm9iIDogbnVsbFxuXG4gICAgaWYgKCFpbmNsdWRlTGF0ZXN0VGVybWluYWwpIHJldHVybiB7Y3VycmVudEpvYiwgbGF0ZXN0VGVybWluYWxKb2I6IG51bGx9XG5cbiAgICBjb25zdCB0ZXJtaW5hbFN0YXR1c2VzID0gQkFDS0dST1VORF9KT0JfVEVSTUlOQUxfU1RBVFVTRVMubWFwKChzdGF0dXMpID0+IGRiLnF1b3RlKHN0YXR1cykpLmpvaW4oXCIsIFwiKVxuICAgIGNvbnN0IHRlcm1pbmFsUm93cyA9IGF3YWl0IGRiXG4gICAgICAubmV3UXVlcnkoKVxuICAgICAgLmZyb20oTE9DQUxfQkFDS0dST1VORF9KT0JTX1RBQkxFKVxuICAgICAgLndoZXJlKHtzY2hlZHVsZV9rZXk6IHNjaGVkdWxlS2V5fSlcbiAgICAgIC53aGVyZShgJHtkYi5xdW90ZUNvbHVtbihcInN0YXR1c1wiKX0gSU4gKCR7dGVybWluYWxTdGF0dXNlc30pYClcbiAgICAgIC5vcmRlcihgQ0FTRSBXSEVOICR7ZGIucXVvdGVDb2x1bW4oXCJzY2hlZHVsZV9vcmRlclwiKX0gSVMgTlVMTCBUSEVOIDAgRUxTRSAxIEVORCBERVNDYClcbiAgICAgIC5vcmRlcihcInNjaGVkdWxlX29yZGVyIERFU0NcIilcbiAgICAgIC5vcmRlcihcImNyZWF0ZWRfYXRfbXMgREVTQ1wiKVxuICAgICAgLm9yZGVyKFwiaWQgREVTQ1wiKVxuICAgICAgLmxpbWl0KDEpXG4gICAgICAucmVzdWx0cygpXG4gICAgY29uc3QgbGF0ZXN0VGVybWluYWxKb2IgPSB0ZXJtaW5hbFJvd3NbMF0gPyB0aGlzLl9ub3JtYWxpemVSb3codGVybWluYWxSb3dzWzBdKSA6IG51bGxcblxuICAgIHJldHVybiB7Y3VycmVudEpvYiwgbGF0ZXN0VGVybWluYWxKb2J9XG4gIH1cblxuICAvKipcbiAgICogUmVsZWFzZXMgb3duZXJzaGlwIG9ubHkgd2hlbiB0aGUga2V5IHN0aWxsIHBvaW50cyBhdCB0aGUgZXhwZWN0ZWQgam9iLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL2RhdGFiYXNlL2RyaXZlcnMvYmFzZS5qc1wiKS5kZWZhdWx0fSBkYiAtIERhdGFiYXNlIGNvbm5lY3Rpb24uXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gT3duZXJzaGlwIGlkZW50aXR5LlxuICAgKiBAcGFyYW0ge3N0cmluZyB8IG51bGx9IGFyZ3Muam9iSWQgLSBFeHBlY3RlZCBvd25lciBqb2IgaWQsIG9yIG51bGwgZm9yIGEgZGFuZ2xpbmcgb3duZXIuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBhcmdzLnNjaGVkdWxlS2V5IC0gU3RhYmxlIHNjaGVkdWxlIGtleS5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgd2hlbiBkZWxldGVkIG9yIGFscmVhZHkgc3VwZXJzZWRlZC5cbiAgICovXG4gIGFzeW5jIF9yZWxlYXNlU2NoZWR1bGVPd25lcnNoaXAoZGIsIHtqb2JJZCwgc2NoZWR1bGVLZXl9KSB7XG4gICAgY29uc3QgY29uZGl0aW9ucyA9IGpvYklkID09PSBudWxsXG4gICAgICA/IHtzY2hlZHVsZV9rZXk6IHNjaGVkdWxlS2V5fVxuICAgICAgOiB7am9iX2lkOiBqb2JJZCwgc2NoZWR1bGVfa2V5OiBzY2hlZHVsZUtleX1cblxuICAgIGF3YWl0IGRiLmRlbGV0ZSh7Y29uZGl0aW9ucywgdGFibGVOYW1lOiBMT0NBTF9CQUNLR1JPVU5EX0pPQl9TQ0hFRFVMRV9LRVlTX1RBQkxFfSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSZWxlYXNlcyBhIHRlcm1pbmFsIGpvYidzIHN0YWJsZSBvd25lcnNoaXAgd2hlbiBzdGlsbCBjdXJyZW50LlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL2RhdGFiYXNlL2RyaXZlcnMvYmFzZS5qc1wiKS5kZWZhdWx0fSBkYiAtIERhdGFiYXNlIGNvbm5lY3Rpb24uXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi90eXBlcy5qc1wiKS5CYWNrZ3JvdW5kSm9iUm93fSBqb2IgLSBUZXJtaW5hbCBqb2IuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIHdoZW4gZGVsZXRlZCBvciBub3QgYXBwbGljYWJsZS5cbiAgICovXG4gIGFzeW5jIF9yZWxlYXNlU2NoZWR1bGVPd25lcnNoaXBGb3JKb2IoZGIsIGpvYikge1xuICAgIGlmICgham9iLnNjaGVkdWxlS2V5KSByZXR1cm5cblxuICAgIGF3YWl0IHRoaXMuX3JlbGVhc2VTY2hlZHVsZU93bmVyc2hpcChkYiwge2pvYklkOiBqb2IuaWQsIHNjaGVkdWxlS2V5OiBqb2Iuc2NoZWR1bGVLZXl9KVxuICB9XG5cbiAgLyoqXG4gICAqIEFjcXVpcmVzIFNRTGl0ZSdzIHRyYW5zYWN0aW9uIHdyaXRlIHNlcmlhbGl6YXRpb24gYmVmb3JlIHJlYWRpbmcgYSBzdGFibGVcbiAgICogb3duZXIuIEEgemVyby1yb3cgdXBkYXRlIHN0aWxsIGVzdGFibGlzaGVzIHRoZSB3cml0ZSBib3VuZGFyeSBmb3IgYSBuZXcga2V5LlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL2RhdGFiYXNlL2RyaXZlcnMvYmFzZS5qc1wiKS5kZWZhdWx0fSBkYiAtIERhdGFiYXNlIGNvbm5lY3Rpb24uXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBzY2hlZHVsZUtleSAtIFZhbGlkYXRlZCBzdGFibGUgc2NoZWR1bGUga2V5LlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyBhZnRlciB3cml0ZSBzZXJpYWxpemF0aW9uIGlzIGFjcXVpcmVkLlxuICAgKi9cbiAgYXN5bmMgX2xvY2tTY2hlZHVsZUtleShkYiwgc2NoZWR1bGVLZXkpIHtcbiAgICBjb25zdCB0YWJsZSA9IGRiLnF1b3RlVGFibGUoTE9DQUxfQkFDS0dST1VORF9KT0JfU0NIRURVTEVfS0VZU19UQUJMRSlcbiAgICBjb25zdCBqb2JJZCA9IGRiLnF1b3RlQ29sdW1uKFwiam9iX2lkXCIpXG5cbiAgICBhd2FpdCBkYi5xdWVyeShcbiAgICAgIGBVUERBVEUgJHt0YWJsZX0gU0VUICR7am9iSWR9ID0gJHtqb2JJZH0gYCArXG4gICAgICBgV0hFUkUgJHtkYi5xdW90ZUNvbHVtbihcInNjaGVkdWxlX2tleVwiKX0gPSAke2RiLnF1b3RlKHNjaGVkdWxlS2V5KX1gXG4gICAgKVxuICB9XG5cbiAgLyoqXG4gICAqIFJlZ2lzdGVycyB0aGUgbG9jYWwgZGlzcGF0Y2ggcG9rZSBvbiB0aGUgc3Vycm91bmRpbmcgdHJhbnNhY3Rpb24gY29tbWl0LlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL2RhdGFiYXNlL2RyaXZlcnMvYmFzZS5qc1wiKS5kZWZhdWx0fSBkYiAtIFRyYW5zYWN0aW9uIGNvbm5lY3Rpb24uXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIGFmdGVyIHJlZ2lzdHJhdGlvbi5cbiAgICovXG4gIGFzeW5jIF93YWtlRGlzcGF0Y2hlckFmdGVyQ29tbWl0KGRiKSB7XG4gICAgaWYgKHRoaXMub25Db21taXR0ZWRFbnF1ZXVlKSBhd2FpdCBkYi5hZnRlckNvbW1pdCh0aGlzLm9uQ29tbWl0dGVkRW5xdWV1ZSlcbiAgfVxuXG4gIC8qKlxuICAgKiBOb3JtYWxpemVzIG9uZSByYXcgbG9jYWwgZGF0YWJhc2Ugcm93LlxuICAgKiBAcGFyYW0ge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gcm93IC0gUmF3IHJvdy5cbiAgICogQHJldHVybnMge2ltcG9ydChcIi4vdHlwZXMuanNcIikuQmFja2dyb3VuZEpvYlJvd30gLSBOb3JtYWxpemVkIHJvdy5cbiAgICovXG4gIF9ub3JtYWxpemVSb3cocm93KSB7XG4gICAgY29uc3QgcGFyc2VkQXJncyA9IEpTT04ucGFyc2UoU3RyaW5nKHJvdy5hcmdzX2pzb24pKVxuICAgIGNvbnN0IGV4ZWN1dGlvbk1vZGUgPSBub3JtYWxpemVCYWNrZ3JvdW5kSm9iRXhlY3V0aW9uTW9kZSh7ZXhlY3V0aW9uTW9kZTogU3RyaW5nKHJvdy5leGVjdXRpb25fbW9kZSl9LCBcImlubGluZVwiLCBMT0NBTF9FWEVDVVRJT05fTU9ERVMpXG5cbiAgICBpZiAoIUFycmF5LmlzQXJyYXkocGFyc2VkQXJncykpIHRocm93IG5ldyBFcnJvcihgSW52YWxpZCBsb2NhbCBiYWNrZ3JvdW5kIGpvYiBhcmdzX2pzb24gZm9yIGpvYjogJHtTdHJpbmcocm93LmlkKX1gKVxuICAgIGlmIChleGVjdXRpb25Nb2RlICE9PSBcImlubGluZVwiKSB0aHJvdyBuZXcgRXJyb3IoXCJMb2NhbCBiYWNrZ3JvdW5kIGpvYiBleGVjdXRpb24gbW9kZSBpbnZhcmlhbnQgd2FzIHZpb2xhdGVkXCIpXG5cbiAgICByZXR1cm4ge1xuICAgICAgYXJnczogcGFyc2VkQXJncyxcbiAgICAgIGF0dGVtcHRzOiB0aGlzLl9udW1iZXJPck51bGwocm93LmF0dGVtcHRzKSxcbiAgICAgIGNoaWxkSW5zdGFuY2VJZDogcm93LmNoaWxkX2luc3RhbmNlX2lkID09PSBudWxsIHx8IHJvdy5jaGlsZF9pbnN0YW5jZV9pZCA9PT0gdW5kZWZpbmVkID8gbnVsbCA6IFN0cmluZyhyb3cuY2hpbGRfaW5zdGFuY2VfaWQpLFxuICAgICAgcnVubmVySG9zdG5hbWU6IHJvdy5ydW5uZXJfaG9zdG5hbWUgPT09IG51bGwgfHwgcm93LnJ1bm5lcl9ob3N0bmFtZSA9PT0gdW5kZWZpbmVkID8gbnVsbCA6IFN0cmluZyhyb3cucnVubmVyX2hvc3RuYW1lKSxcbiAgICAgIGNoaWxkUGlkOiB0aGlzLl9udW1iZXJPck51bGwocm93LmNoaWxkX3BpZCksXG4gICAgICBjaGlsZFJlY2VpdmVkQXRNczogdGhpcy5fbnVtYmVyT3JOdWxsKHJvdy5jaGlsZF9yZWNlaXZlZF9hdF9tcyksXG4gICAgICBjaGlsZFN0YXJ0ZWRBdE1zOiB0aGlzLl9udW1iZXJPck51bGwocm93LmNoaWxkX3N0YXJ0ZWRfYXRfbXMpLFxuICAgICAgY29tcGxldGVkQXRNczogdGhpcy5fbnVtYmVyT3JOdWxsKHJvdy5jb21wbGV0ZWRfYXRfbXMpLFxuICAgICAgY29uY3VycmVuY3lLZXk6IHJvdy5jb25jdXJyZW5jeV9rZXkgPT09IG51bGwgfHwgcm93LmNvbmN1cnJlbmN5X2tleSA9PT0gdW5kZWZpbmVkID8gbnVsbCA6IFN0cmluZyhyb3cuY29uY3VycmVuY3lfa2V5KSxcbiAgICAgIGNyZWF0ZWRBdE1zOiB0aGlzLl9udW1iZXJPck51bGwocm93LmNyZWF0ZWRfYXRfbXMpLFxuICAgICAgZXhlY3V0aW9uTW9kZSxcbiAgICAgIGZhaWxlZEF0TXM6IHRoaXMuX251bWJlck9yTnVsbChyb3cuZmFpbGVkX2F0X21zKSxcbiAgICAgIGhhbmRlZE9mZkF0TXM6IHRoaXMuX251bWJlck9yTnVsbChyb3cuaGFuZGVkX29mZl9hdF9tcyksXG4gICAgICBoYW5kb2ZmSWQ6IHJvdy5oYW5kb2ZmX2lkID09PSBudWxsIHx8IHJvdy5oYW5kb2ZmX2lkID09PSB1bmRlZmluZWQgPyBudWxsIDogU3RyaW5nKHJvdy5oYW5kb2ZmX2lkKSxcbiAgICAgIGlkOiBTdHJpbmcocm93LmlkKSxcbiAgICAgIGpvYk5hbWU6IFN0cmluZyhyb3cuam9iX25hbWUpLFxuICAgICAgbGFzdEVycm9yOiByb3cubGFzdF9lcnJvciA9PT0gbnVsbCB8fCByb3cubGFzdF9lcnJvciA9PT0gdW5kZWZpbmVkID8gbnVsbCA6IFN0cmluZyhyb3cubGFzdF9lcnJvciksXG4gICAgICBtYXhDb25jdXJyZW5jeTogdGhpcy5fbnVtYmVyT3JOdWxsKHJvdy5tYXhfY29uY3VycmVuY3kpLFxuICAgICAgbWF4UmV0cmllczogdGhpcy5fbnVtYmVyT3JOdWxsKHJvdy5tYXhfcmV0cmllcyksXG4gICAgICBvcnBoYW5lZEF0TXM6IG51bGwsXG4gICAgICBxdWV1ZTogcm93LnF1ZXVlID8gU3RyaW5nKHJvdy5xdWV1ZSkgOiBERUZBVUxUX0JBQ0tHUk9VTkRfSk9CX1FVRVVFLFxuICAgICAgc2NoZWR1bGVLZXk6IHJvdy5zY2hlZHVsZV9rZXkgPT09IG51bGwgfHwgcm93LnNjaGVkdWxlX2tleSA9PT0gdW5kZWZpbmVkID8gbnVsbCA6IFN0cmluZyhyb3cuc2NoZWR1bGVfa2V5KSxcbiAgICAgIHNjaGVkdWxlT3JkZXI6IHRoaXMuX251bWJlck9yTnVsbChyb3cuc2NoZWR1bGVfb3JkZXIpLFxuICAgICAgc2NoZWR1bGVkQXRNczogdGhpcy5fbnVtYmVyT3JOdWxsKHJvdy5zY2hlZHVsZWRfYXRfbXMpLFxuICAgICAgc3RhdHVzOiBub3JtYWxpemVCYWNrZ3JvdW5kSm9iU3RhdHVzKHJvdy5zdGF0dXMgPyBTdHJpbmcocm93LnN0YXR1cykgOiBcInF1ZXVlZFwiKSxcbiAgICAgIHRpbWVvdXRNczogbnVsbCxcbiAgICAgIHdvcmtlcklkOiByb3cud29ya2VyX2lkID09PSBudWxsIHx8IHJvdy53b3JrZXJfaWQgPT09IHVuZGVmaW5lZCA/IG51bGwgOiBTdHJpbmcocm93Lndvcmtlcl9pZClcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogTm9ybWFsaXplcyBvbmUgbnVsbGFibGUgZGF0YWJhc2UgbnVtYmVyLlxuICAgKiBAcGFyYW0ge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSB2YWx1ZSAtIERhdGFiYXNlIG51bWJlci5cbiAgICogQHJldHVybnMge251bWJlciB8IG51bGx9IC0gTm9ybWFsaXplZCBudW1iZXIuXG4gICAqL1xuICBfbnVtYmVyT3JOdWxsKHZhbHVlKSB7XG4gICAgaWYgKHZhbHVlID09PSBudWxsIHx8IHZhbHVlID09PSB1bmRlZmluZWQgfHwgdmFsdWUgPT09IFwiXCIpIHJldHVybiBudWxsXG5cbiAgICBjb25zdCBudW1iZXIgPSBOdW1iZXIodmFsdWUpXG5cbiAgICByZXR1cm4gTnVtYmVyLmlzTmFOKG51bWJlcikgPyBudWxsIDogbnVtYmVyXG4gIH1cblxuICAvKipcbiAgICogRXhlY3V0ZXMgYSBzdHJ1Y3R1cmVkIHVwZGF0ZSBhbmQgcmVwb3J0cyBpdHMgYWZmZWN0ZWQtcm93IGNvdW50LlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL2RhdGFiYXNlL2RyaXZlcnMvYmFzZS5qc1wiKS5kZWZhdWx0fSBkYiAtIENvbm5lY3Rpb24uXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vZGF0YWJhc2UvZHJpdmVycy9iYXNlLmpzXCIpLlVwZGF0ZVNxbEFyZ3NUeXBlfSBhcmdzIC0gVXBkYXRlIGFyZ3VtZW50cy5cbiAgICogQHJldHVybnMge1Byb21pc2U8bnVtYmVyPn0gLSBBZmZlY3RlZCByb3dzLlxuICAgKi9cbiAgYXN5bmMgX3VwZGF0ZUFmZmVjdGVkUm93cyhkYiwgYXJncykgeyByZXR1cm4gYXdhaXQgZGIuYWZmZWN0ZWRSb3dzKGRiLnVwZGF0ZVNxbChhcmdzKSkgfVxuXG4gIC8qKlxuICAgKiBKb2lucyBhbiBhbWJpZW50IGFwcCB0cmFuc2FjdGlvbiBvciB1c2VzIHRoZSBkYXRhYmFzZSdzIHNjb3BlZCBvcGVyYXRpb24gbGVhc2UuXG4gICAqIEB0ZW1wbGF0ZSBUXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vZGF0YWJhc2UvZHJpdmVycy9iYXNlLmpzXCIpLmRlZmF1bHR9IGRiIC0gQ29ubmVjdGlvbi5cbiAgICogQHBhcmFtIHsoZGI6IGltcG9ydChcIi4uL2RhdGFiYXNlL2RyaXZlcnMvYmFzZS5qc1wiKS5kZWZhdWx0KSA9PiBQcm9taXNlPFQ+fSBjYWxsYmFjayAtIE11dGF0aW9uLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxUPn0gLSBNdXRhdGlvbiByZXN1bHQuXG4gICAqL1xuICBhc3luYyBfbXV0YXRlKGRiLCBjYWxsYmFjaykge1xuICAgIGlmIChkYi5pbnNpZGVUcmFuc2FjdGlvbigpKSByZXR1cm4gYXdhaXQgdGhpcy5fdHJhbnNhY3Rpb25SZXN1bHQoZGIsIGFzeW5jICgpID0+IGF3YWl0IGNhbGxiYWNrKGRiKSlcblxuICAgIHJldHVybiBhd2FpdCB0aGlzLmNvbmZpZ3VyYXRpb24ud2l0aFRyYW5zYWN0aW9uKHtcbiAgICAgIGRhdGFiYXNlSWRlbnRpZmllcjogdGhpcy5nZXREYXRhYmFzZUlkZW50aWZpZXIoKSxcbiAgICAgIG5hbWU6IFwiTG9jYWwgYmFja2dyb3VuZCBqb2JzIG11dGF0aW9uXCJcbiAgICB9LCBhc3luYyAob3BlcmF0aW9uKSA9PiBhd2FpdCBjYWxsYmFjayhvcGVyYXRpb24uY29ubmVjdGlvbigpKSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGEgY2FsbGJhY2sgaW4gYSB0cmFuc2FjdGlvbiBhbmQgcmV0dXJucyBpdHMgY2FwdHVyZWQgcmVzdWx0LlxuICAgKiBAdGVtcGxhdGUgVFxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL2RhdGFiYXNlL2RyaXZlcnMvYmFzZS5qc1wiKS5kZWZhdWx0fSBkYiAtIENvbm5lY3Rpb24uXG4gICAqIEBwYXJhbSB7KCkgPT4gUHJvbWlzZTxUPn0gY2FsbGJhY2sgLSBUcmFuc2FjdGlvbiBjYWxsYmFjay5cbiAgICogQHJldHVybnMge1Byb21pc2U8VD59IC0gQ2FsbGJhY2sgcmVzdWx0LlxuICAgKi9cbiAgYXN5bmMgX3RyYW5zYWN0aW9uUmVzdWx0KGRiLCBjYWxsYmFjaykge1xuICAgIGxldCBjb21wbGV0ZWQgPSBmYWxzZVxuICAgIC8qKiBAdHlwZSB7VCB8IHVuZGVmaW5lZH0gKi9cbiAgICBsZXQgcmVzdWx0XG5cbiAgICBhd2FpdCBkYi50cmFuc2FjdGlvbihhc3luYyAoKSA9PiB7XG4gICAgICByZXN1bHQgPSBhd2FpdCBjYWxsYmFjaygpXG4gICAgICBjb21wbGV0ZWQgPSB0cnVlXG4gICAgfSlcblxuICAgIGlmICghY29tcGxldGVkKSB0aHJvdyBuZXcgRXJyb3IoXCJMb2NhbCBiYWNrZ3JvdW5kIGpvYnMgdHJhbnNhY3Rpb24gY2FsbGJhY2sgd2FzIG5vdCBpbnZva2VkXCIpXG4gICAgcmV0dXJuIC8qKiBAdHlwZSB7VH0gKi8gKHJlc3VsdClcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGEgY2FsbGJhY2sgd2l0aCB0aGUgY29uZmlndXJlZCBsb2NhbCBkYXRhYmFzZSBjb25uZWN0aW9uLlxuICAgKiBAdGVtcGxhdGUgVFxuICAgKiBAcGFyYW0geyhkYjogaW1wb3J0KFwiLi4vZGF0YWJhc2UvZHJpdmVycy9iYXNlLmpzXCIpLmRlZmF1bHQpID0+IFByb21pc2U8VD59IGNhbGxiYWNrIC0gQ29ubmVjdGlvbiBjYWxsYmFjay5cbiAgICogQHJldHVybnMge1Byb21pc2U8VD59IC0gQ2FsbGJhY2sgcmVzdWx0LlxuICAgKi9cbiAgYXN5bmMgX3dpdGhEYihjYWxsYmFjaykge1xuICAgIGNvbnN0IGRhdGFiYXNlSWRlbnRpZmllciA9IHRoaXMuZ2V0RGF0YWJhc2VJZGVudGlmaWVyKClcblxuICAgIHJldHVybiBhd2FpdCB0aGlzLmNvbmZpZ3VyYXRpb24uZW5zdXJlQ29ubmVjdGlvbnMoe2RhdGFiYXNlSWRlbnRpZmllcnM6IFtkYXRhYmFzZUlkZW50aWZpZXJdLCBuYW1lOiBcIkxvY2FsIGJhY2tncm91bmQgam9icyBzdG9yZVwifSwgYXN5bmMgKGRicykgPT4ge1xuICAgICAgY29uc3QgZGIgPSBkYnNbZGF0YWJhc2VJZGVudGlmaWVyXVxuXG4gICAgICBpZiAoIWRiKSB0aHJvdyBuZXcgRXJyb3IoYE5vIGxvY2FsIGJhY2tncm91bmQtam9icyBkYXRhYmFzZSBjb25uZWN0aW9uIGF2YWlsYWJsZSBmb3IgaWRlbnRpZmllcjogJHtkYXRhYmFzZUlkZW50aWZpZXJ9YClcblxuICAgICAgcmV0dXJuIGF3YWl0IGNhbGxiYWNrKGRiKVxuICAgIH0pXG4gIH1cblxuICAvKipcbiAgICogUmVwb3J0cyBhbiB1bmV4cGVjdGVkIGxvY2FsLXN0b3JlIGZhaWx1cmUgdGhyb3VnaCBmcmFtZXdvcmsgY2hhbm5lbHMuXG4gICAqIEBwYXJhbSB7e2Vycm9yOiBFcnJvciwgc3RhZ2U6IHN0cmluZ319IGFyZ3MgLSBFcnJvciByZXBvcnQuXG4gICAqIEByZXR1cm5zIHt2b2lkfSAtIE5vIHJldHVybiB2YWx1ZS5cbiAgICovXG4gIF9yZXBvcnRGcmFtZXdvcmtFcnJvcih7ZXJyb3IsIHN0YWdlfSkge1xuICAgIGNvbnN0IHBheWxvYWQgPSB7Y29udGV4dDoge3N0YWdlfSwgZXJyb3J9XG4gICAgY29uc3QgZXJyb3JFdmVudHMgPSB0aGlzLmNvbmZpZ3VyYXRpb24uZ2V0RXJyb3JFdmVudHMoKVxuXG4gICAgZXJyb3JFdmVudHMuZW1pdChcImZyYW1ld29yay1lcnJvclwiLCBwYXlsb2FkKVxuICAgIGVycm9yRXZlbnRzLmVtaXQoXCJhbGwtZXJyb3JcIiwgey4uLnBheWxvYWQsIGVycm9yVHlwZTogXCJmcmFtZXdvcmstZXJyb3JcIn0pXG4gIH1cbn1cbiJdfQ==