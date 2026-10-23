// @ts-check
import AlterTable from "./sql/alter-table.js";
import wait from "awaitery/build/wait.js";
import Base from "../base.js";
import Column from "./column.js";
import { Client, types as pgTypes } from "pg";
import CreateDatabase from "./sql/create-database.js";
import CreateIndex from "./sql/create-index.js";
import CreateTable from "./sql/create-table.js";
import Delete from "./sql/delete.js";
import { digg } from "diggerize";
import DropDatabase from "./sql/drop-database.js";
import DropTable from "./sql/drop-table.js";
import Insert from "./sql/insert.js";
import Options from "./options.js";
import QueryParser from "./query-parser.js";
import RemoveIndex from "./sql/remove-index.js";
import Table from "./table.js";
import StructureSql from "./structure-sql.js";
import Upsert from "./sql/upsert.js";
import Update from "./sql/update.js";
const PG_TIMESTAMP_WITHOUT_TIMEZONE_OID = 1114;
/** Smallest wait between `pg_try_advisory_lock` probes; preserves the historical 50ms cadence for short bounds. */
const PGSQL_ADVISORY_LOCK_POLL_MIN_INTERVAL_MS = 50;
/** Largest wait between `pg_try_advisory_lock` probes; keeps a long bounded wait from probing tens of thousands of times. */
const PGSQL_ADVISORY_LOCK_POLL_MAX_INTERVAL_MS = 2000;
pgTypes.setTypeParser(PG_TIMESTAMP_WITHOUT_TIMEZONE_OID, (value) => new Date(`${value.replace(" ", "T")}Z`));
export default class VelociousDatabaseDriversPgsql extends Base {
    async connect() {
        const client = new Client(this.connectArgs());
        try {
            await client.connect();
            this.connection = client;
            await this.setSessionTimezoneToUtc();
        }
        catch (error) {
            // Re-throw to recover real stack trace
            if (error instanceof Error) {
                throw new Error(`Connect to Postgres server failed: ${error.message}`, { cause: error });
            }
            else {
                throw new Error(`Connect to Postgres server failed: ${error}`, { cause: error });
            }
        }
    }
    connectArgs() {
        const args = this.getArgs();
        const forward = ["database", "host", "password", "port"];
        /**
         * Connect args.
         * @type {Record<string, ReturnType<typeof JSON.parse>>} */
        const connectArgs = {};
        for (const forwardValue of forward) {
            if (forwardValue in args)
                connectArgs[forwardValue] = digg(args, forwardValue);
        }
        if ("username" in args)
            connectArgs["user"] = args["username"];
        return connectArgs;
    }
    async _close() {
        await this.connection?.end();
        this.connection = undefined;
        this._transactionsCount = 0;
    }
    /**
     * Runs set connection checkout name.
     * @param {string | undefined} name - Human-readable name for this active checkout.
     * @returns {Promise<void>} - Resolves when complete.
     */
    async setConnectionCheckoutName(name) {
        if (name) {
            await this.query(`SET application_name = ${this.quote(name)}`, { logName: "Set Connection Checkout Name", processListComment: false });
        }
        else {
            await this.query("RESET application_name", { logName: "Clear Connection Checkout Name", processListComment: false });
        }
        await super.setConnectionCheckoutName(name);
    }
    /**
     * Runs clear connection checkout name.
     * @returns {Promise<void>} - Resolves when complete.
     */
    async clearConnectionCheckoutName() {
        await this.query("RESET application_name", { logName: "Clear Connection Checkout Name", processListComment: false });
        await super.clearConnectionCheckoutName();
    }
    /**
     * Sets the database session timezone to UTC so bare timestamp literals store UTC instants.
     * @returns {Promise<void>} - Resolves when complete.
     */
    async setSessionTimezoneToUtc() {
        await this.query("SET TIME ZONE 'UTC'", { logName: "Set Session Time Zone", processListComment: false });
    }
    /**
     * Runs alter table sqls.
     * @param {import("../../table-data/index.js").default} tableData - Table data.
     * @returns {Promise<string[]>} - Resolves with SQL statements.
     */
    async alterTableSQLs(tableData) {
        const alterArgs = { tableData, driver: this };
        const alterTable = new AlterTable(alterArgs);
        return await alterTable.toSQLs();
    }
    /**
     * Runs create database sql.
     * @param {string} databaseName - Database name.
     * @param {object} [args] - Options object.
     * @param {boolean} [args.ifNotExists] - Whether if not exists.
     * @returns {string[]} - SQL statements.
     */
    createDatabaseSql(databaseName, args) {
        const createArgs = Object.assign({ databaseName, driver: this }, args);
        const createDatabase = new CreateDatabase(createArgs);
        return createDatabase.toSql();
    }
    /**
     * Runs drop database sql.
     * @param {string} databaseName - Database name.
     * @param {object} [args] - Options object.
     * @param {boolean} [args.ifExists] - Whether if exists.
     * @returns {string[]} - SQL statements.
     */
    dropDatabaseSql(databaseName, args) {
        const dropArgs = Object.assign({ databaseName, driver: this }, args);
        const dropDatabase = new DropDatabase(dropArgs);
        return dropDatabase.toSql();
    }
    /**
     * Runs create index sqls.
     * @param {import("../base.js").CreateIndexSqlArgs} indexData - Index data.
     * @returns {Promise<string[]>} - Resolves with SQL statements.
     */
    async createIndexSQLs(indexData) {
        const createArgs = Object.assign({ driver: this }, indexData);
        const createIndex = new CreateIndex(createArgs);
        return await createIndex.toSQLs();
    }
    /**
     * Runs remove index sqls.
     * @param {import("../base.js").RemoveIndexSqlArgs} indexData - Index data.
     * @returns {Promise<string[]>} - Resolves with SQL statements.
     */
    async removeIndexSQLs(indexData) {
        const removeArgs = Object.assign({ driver: this }, indexData);
        const removeIndex = new RemoveIndex(removeArgs);
        return await removeIndex.toSQLs();
    }
    /**
     * Runs create table sql.
     * @param {import("../../table-data/index.js").default} tableData - Table data.
     * @returns {Promise<string[]>} - Resolves with SQL statements.
     */
    async createTableSql(tableData) {
        const createArgs = { tableData, driver: this, indexInCreateTable: false };
        const createTable = new CreateTable(createArgs);
        return await createTable.toSql();
    }
    async currentDatabase() {
        const rows = await this.query("SELECT CURRENT_DATABASE() AS db_name");
        return digg(rows, 0, "db_name");
    }
    async disableForeignKeys() {
        await this.query("SET session_replication_role = 'replica'");
    }
    async enableForeignKeys() {
        await this.query("SET session_replication_role = 'origin'");
    }
    /**
     * Runs drop table sqls.
     * @param {string} tableName - Table name.
     * @param {import("../base.js").DropTableSqlArgsType} [args] - Options object.
     * @returns {Promise<string[]>} - Resolves with SQL statements.
     */
    async dropTableSQLs(tableName, args = {}) {
        const dropArgs = Object.assign({ tableName, driver: this }, args);
        const dropTable = new DropTable(dropArgs);
        return await dropTable.toSQLs();
    }
    getType() { return "pgsql"; }
    /**
     * Whether this driver supports combining operations into one bulk `ALTER`.
     * @returns {boolean} - Whether bulk alter is supported.
     */
    supportsBulkAlter() { return true; }
    /**
     * Whether the bulk `ALTER` can also carry `ADD INDEX` clauses. PostgreSQL's
     * `ALTER TABLE` cannot express index creation, so indexes stay standalone.
     * @returns {boolean} - Whether indexes can be added inside a bulk alter.
     */
    supportsBulkAlterIndexes() { return false; }
    /**
     * Runs query actual.
     * @param {string} sql - SQL string.
     * @returns {Promise<import("../base.js").QueryResultType>} - Resolves with the query actual.
     */
    async _queryActual(sql) {
        let response;
        if (!this.connection)
            await this.connect();
        if (!this.connection)
            throw new Error("PostgreSQL connection failed to initialize");
        try {
            response = await this.connection.query(sql);
        }
        catch (error) {
            if (error instanceof Error) {
                throw new Error(`Query failed: ${error.message} with SQL: ${sql}`, { cause: error });
            }
            else {
                throw new Error(`Query failed: ${error} with SQL: ${sql}`, { cause: error });
            }
        }
        return response.rows;
    }
    /**
     * Executes a mutation with affected-row metadata.
     * @param {string} sql - Mutation SQL.
     * @returns {Promise<number>} - Affected row count.
     */
    async _affectedRowsActual(sql) {
        if (!this.connection)
            await this.connect();
        if (!this.connection)
            throw new Error("PostgreSQL connection failed to initialize");
        const response = await this.connection.query(sql);
        return response.rowCount || 0;
    }
    /**
     * Runs query to sql.
     * @param {import("../../query/index.js").default} query - Query instance.
     * @returns {string} - SQL string.
     */
    queryToSql(query) { return new QueryParser({ query }).toSql(); }
    shouldSetAutoIncrementWhenPrimaryKey() { return true; }
    supportsDefaultPrimaryKeyUUID() { return true; }
    /**
     * Runs convert value.
     * @param {ReturnType<typeof JSON.parse>} value - Value to use.
     * @returns {ReturnType<typeof JSON.parse>} - The converted value.
     */
    _convertValue(value) {
        if (typeof value === "boolean") {
            return value ? "true" : "false";
        }
        return super._convertValue(value);
    }
    /**
     * Runs escape.
     * @param {ReturnType<typeof JSON.parse>} value - Value to use.
     * @returns {ReturnType<typeof JSON.parse>} - The escape.
     */
    escape(value) {
        if (!this.connection)
            throw new Error("Can't escape before connected");
        if (typeof value === "number")
            return value;
        const escapedValueWithQuotes = this.connection.escapeLiteral(this._convertValue(value));
        return escapedValueWithQuotes.slice(1, escapedValueWithQuotes.length - 1);
    }
    /**
     * Runs quote.
     * @param {ReturnType<typeof JSON.parse>} value - Value to use.
     * @returns {string | number} - The quoted value.
     */
    quote(value) {
        if (!this.connection)
            throw new Error("Can't escape before connected");
        if (typeof value === "number")
            return value;
        return this.connection.escapeLiteral(this._convertValue(value));
    }
    /**
     * Runs delete sql.
     * @param {import("../base.js").DeleteSqlArgsType} args - Options object.
     * @returns {string} - SQL string.
     */
    deleteSql({ tableName, conditions }) {
        const deleteInstruction = new Delete({ conditions, driver: this, tableName });
        return deleteInstruction.toSql();
    }
    /**
     * Runs insert sql.
     * @abstract
     * @param {import("../base.js").InsertSqlArgsType} args - Options object.
     * @returns {string} - SQL string.
     */
    insertSql(args) {
        const insertArgs = Object.assign({ driver: this }, args);
        const insert = new Insert(insertArgs);
        return insert.toSql();
    }
    /**
     * Runs get tables.
     * @returns {Promise<Array<import("../base-table.js").default>>} - Resolves with the tables.
     */
    async getTables() {
        return await this._cachedSchemaMetadata("tables", async () => {
            const result = await this.query("SELECT * FROM information_schema.tables WHERE table_catalog = CURRENT_DATABASE() AND table_schema = 'public'");
            const tables = [];
            for (const row of result) {
                const table = new Table(this, /** @type {Record<string, string>} */ (row));
                tables.push(table);
            }
            return tables;
        });
    }
    /**
     * Reads column metadata for many tables in one query instead of one catalog
     * join per table.
     * @param {Array<import("../base-table.js").default>} tables - Tables to load columns for.
     * @returns {Promise<Map<string, Array<import("../base-column.js").default>>>} - Columns keyed by table name.
     */
    async batchTableColumns(tables) {
        /** @type {Map<string, Array<import("../base-column.js").default>>} */
        const columnsByTable = new Map();
        if (tables.length === 0)
            return columnsByTable;
        const tablesByName = new Map(tables.map((table) => [table.getName(), table]));
        const tableNamesSql = [...tablesByName.keys()].map((tableName) => this.quote(tableName)).join(", ");
        const rows = await this.query(`
      SELECT
        columns.*,
        CASE WHEN key_column_usage.column_name IS NOT NULL THEN 1 ELSE 0 END AS is_primary_key,
        col_description((columns.table_schema || '.' || columns.table_name)::regclass, columns.ordinal_position) AS column_comment

      FROM
        information_schema.columns AS columns

      LEFT JOIN information_schema.table_constraints AS table_constraints ON
        table_constraints.table_name = columns.table_name AND
        table_constraints.table_schema = columns.table_schema AND
        table_constraints.constraint_type = 'PRIMARY KEY'

      LEFT JOIN information_schema.key_column_usage AS key_column_usage ON
        key_column_usage.constraint_name = table_constraints.constraint_name AND
        key_column_usage.table_schema = table_constraints.table_schema AND
        key_column_usage.table_name = columns.table_name AND
        key_column_usage.column_name = columns.column_name

      WHERE
        columns.table_catalog = CURRENT_DATABASE() AND
        columns.table_schema = 'public' AND
        columns.table_name IN (${tableNamesSql})
      ORDER BY columns.table_name, columns.ordinal_position
    `);
        for (const row of rows) {
            const tableName = /** @type {string} */ (row.table_name);
            const table = tablesByName.get(tableName);
            if (!table)
                continue;
            const columns = columnsByTable.get(tableName) || [];
            columns.push(new Column(table, /** @type {Record<string, ReturnType<typeof JSON.parse>>} */ (row)));
            columnsByTable.set(tableName, columns);
        }
        return columnsByTable;
    }
    /**
     * Truncates all eligible tables in one PostgreSQL request.
     * @param {Array<import("../base-table.js").default>} tables - Eligible tables.
     * @returns {Promise<void>} - Resolves when the batch completes.
     */
    async truncateTables(tables) {
        const quotedTables = tables.map((table) => this.quoteTable(table.getName()));
        await this.query(`TRUNCATE TABLE ${quotedTables.join(", ")} CASCADE`);
    }
    async lastInsertID(options = {}) {
        const result = await this.query("SELECT LASTVAL() AS last_insert_id", options);
        return digg(result, 0, "last_insert_id");
    }
    options() {
        if (!this._options)
            this._options = new Options(this);
        return this._options;
    }
    async _startTransactionAction(options = {}) {
        await this.query("START TRANSACTION", options);
    }
    /**
     * Runs update sql.
     * @abstract
     * @param {import("../base.js").UpdateSqlArgsType} args - Options object.
     * @returns {string} - SQL string.
     */
    updateSql({ conditions, data, tableName }) {
        const update = new Update({ conditions, data, driver: this, tableName });
        return update.toSql();
    }
    /**
     * Runs upsert sql.
     * @param {import("../base.js").UpsertSqlArgsType} args - Options object.
     * @returns {string} - SQL string.
     */
    upsertSql(args) {
        const upsert = new Upsert({ ...args, driver: this });
        return upsert.toSql();
    }
    /**
     * Runs structure sql.
     * @returns {Promise<string | null>} - Resolves with SQL string.
     */
    async structureSql() {
        return await this._cachedSchemaMetadata("structureSql", async () => await new StructureSql({ driver: this }).toSql());
    }
    /**
     * Deterministically hashes a lock name into a signed 64-bit integer so it
     * can be passed to `pg_advisory_lock(bigint)`. We use a fast 64-bit FNV-1a
     * hash — the exact value does not matter, only that the same name always
     * produces the same key within a process AND across processes that share
     * the same implementation. Returns the value as a string so the caller
     * can interpolate it into SQL without losing precision to JS number
     * coercion.
     * @param {string} name - Lock name.
     * @returns {string} - Signed 64-bit integer as a decimal string.
     */
    advisoryLockKey(name) {
        // FNV-1a 64-bit, computed with BigInt so we don't lose precision.
        const fnvOffsetBasis = 0xcbf29ce484222325n;
        const fnvPrime = 0x00000100000001b3n;
        const mask64 = 0xffffffffffffffffn;
        let hash = fnvOffsetBasis;
        for (let index = 0; index < name.length; index += 1) {
            hash = BigInt.asUintN(64, (hash ^ BigInt(name.charCodeAt(index))) * fnvPrime & mask64);
        }
        // Convert unsigned 64-bit into signed by reinterpreting the top bit.
        const signed = hash >= 0x8000000000000000n ? hash - 0x10000000000000000n : hash;
        return signed.toString();
    }
    /**
     * Resolves the `pg_try_advisory_lock` probe cadence for one bounded wait.
     *
     * `pg_advisory_lock` has no native timeout, so a bounded acquisition polls. Scaling the interval
     * with the bound keeps the historical 50ms cadence — and its fast acquisition — for the short
     * explicit `timeoutMs` values callers already pass, while a long framework default stays
     * responsive without turning one contended lock into tens of thousands of probe queries.
     * @param {number} timeoutMs - Bounded wait in milliseconds.
     * @returns {number} - Probe interval in milliseconds.
     */
    static advisoryLockPollIntervalMs(timeoutMs) {
        return Math.min(Math.max(Math.floor(timeoutMs / 100), PGSQL_ADVISORY_LOCK_POLL_MIN_INTERVAL_MS), PGSQL_ADVISORY_LOCK_POLL_MAX_INTERVAL_MS);
    }
    /**
     * Blocks until a PostgreSQL session-level advisory lock is acquired on
     * this connection. Implemented via `pg_advisory_lock(bigint)`, which has
     * no native timeout — the `timeoutMs` argument is emulated by racing a
     * `pg_try_advisory_lock` poll loop so callers on MySQL and Postgres see the
     * same contract. The poll interval backs off to a cap so a long bounded wait
     * does not turn one contended lock into thousands of probe queries.
     * @param {string} name - Lock name.
     * @param {{timeoutMs?: number | null}} [args] - Optional timeout in milliseconds; `null` or negative blocks forever, and an omitted value uses the database's `advisoryLockAcquireTimeoutMs` or the framework default.
     * @returns {Promise<boolean>} - True if the lock was acquired, false if the timeout elapsed.
     */
    async _acquireAdvisoryLock(name, { timeoutMs } = {}) {
        const key = this.advisoryLockKey(name);
        if (typeof timeoutMs !== "number" || timeoutMs < 0) {
            await this.query(`SELECT pg_advisory_lock(${key})`);
            return true;
        }
        const deadline = Date.now() + timeoutMs;
        const pollIntervalMs = VelociousDatabaseDriversPgsql.advisoryLockPollIntervalMs(timeoutMs);
        while (true) {
            if (await this._tryAcquireAdvisoryLock(name))
                return true;
            if (Date.now() >= deadline)
                return false;
            const remaining = deadline - Date.now();
            await wait(Math.min(pollIntervalMs, remaining));
        }
    }
    /**
     * Runs try acquire advisory lock.
     * @param {string} name - Lock name.
     * @returns {Promise<boolean>} - True if the lock was acquired, false if it was already held.
     */
    async _tryAcquireAdvisoryLock(name) {
        const key = this.advisoryLockKey(name);
        const rows = await this.query(`SELECT pg_try_advisory_lock(${key}) AS velocious_advisory_lock_result`);
        const result = rows?.[0]?.velocious_advisory_lock_result;
        return result === true || result === "t" || result === 1 || result === "1";
    }
    /**
     * Runs release advisory lock.
     * @param {string} name - Lock name.
     * @returns {Promise<boolean>} - True if the lock was held by this session and has now been released.
     */
    async _releaseAdvisoryLock(name) {
        const key = this.advisoryLockKey(name);
        const rows = await this.query(`SELECT pg_advisory_unlock(${key}) AS velocious_advisory_lock_result`);
        const result = rows?.[0]?.velocious_advisory_lock_result;
        return result === true || result === "t" || result === 1 || result === "1";
    }
    /**
    /**
     * Attributes the current holder of the named advisory lock to its backend
     * process id from `pg_locks`, captured at the telemetry event moment
     * (best-effort; the caller guards failures).
     * @param {string} name - Lock name.
     * @returns {Promise<string | null>} - PostgreSQL backend pid of the holder, or null when no session holds the lock.
     */
    async advisoryLockHolderConnectionId(name) {
        const key = this.advisoryLockKey(name);
        const rows = await this.query(`SELECT pid FROM pg_locks WHERE locktype = 'advisory' AND ((classid::bigint << 32) | (objid::bigint & 4294967295)) = ${key} LIMIT 1`);
        const holder = rows?.[0]?.pid;
        return holder === null || holder === undefined ? null : String(holder);
    }
    /**
     * Driver-native view for the base driver's `isAdvisoryLockHeld`, which
     * answers from the process-local tier first.
     * @param {string} name - Lock name.
     * @returns {Promise<boolean>} - True if any session currently holds the lock.
     */
    async _isAdvisoryLockHeldNative(name) {
        const key = this.advisoryLockKey(name);
        const rows = await this.query(`SELECT EXISTS (SELECT 1 FROM pg_locks WHERE locktype = 'advisory' AND ((classid::bigint << 32) | (objid::bigint & 4294967295)) = ${key}) AS velocious_advisory_lock_held`);
        const held = rows?.[0]?.velocious_advisory_lock_held;
        return held === true || held === "t" || held === 1 || held === "1";
    }
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiaW5kZXguanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi8uLi8uLi9zcmMvZGF0YWJhc2UvZHJpdmVycy9wZ3NxbC9pbmRleC5qcyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiQUFBQSxZQUFZO0FBRVosT0FBTyxVQUFVLE1BQU0sc0JBQXNCLENBQUE7QUFDN0MsT0FBTyxJQUFJLE1BQU0sd0JBQXdCLENBQUE7QUFDekMsT0FBTyxJQUFJLE1BQU0sWUFBWSxDQUFBO0FBQzdCLE9BQU8sTUFBTSxNQUFNLGFBQWEsQ0FBQTtBQUNoQyxPQUFPLEVBQUUsTUFBTSxFQUFFLEtBQUssSUFBSSxPQUFPLEVBQUUsTUFBTSxJQUFJLENBQUE7QUFDN0MsT0FBTyxjQUFjLE1BQU0sMEJBQTBCLENBQUE7QUFDckQsT0FBTyxXQUFXLE1BQU0sdUJBQXVCLENBQUE7QUFDL0MsT0FBTyxXQUFXLE1BQU0sdUJBQXVCLENBQUE7QUFDL0MsT0FBTyxNQUFNLE1BQU0saUJBQWlCLENBQUE7QUFDcEMsT0FBTyxFQUFDLElBQUksRUFBQyxNQUFNLFdBQVcsQ0FBQTtBQUM5QixPQUFPLFlBQVksTUFBTSx3QkFBd0IsQ0FBQTtBQUNqRCxPQUFPLFNBQVMsTUFBTSxxQkFBcUIsQ0FBQTtBQUMzQyxPQUFPLE1BQU0sTUFBTSxpQkFBaUIsQ0FBQTtBQUNwQyxPQUFPLE9BQU8sTUFBTSxjQUFjLENBQUE7QUFDbEMsT0FBTyxXQUFXLE1BQU0sbUJBQW1CLENBQUE7QUFDM0MsT0FBTyxXQUFXLE1BQU0sdUJBQXVCLENBQUE7QUFDL0MsT0FBTyxLQUFLLE1BQU0sWUFBWSxDQUFBO0FBQzlCLE9BQU8sWUFBWSxNQUFNLG9CQUFvQixDQUFBO0FBQzdDLE9BQU8sTUFBTSxNQUFNLGlCQUFpQixDQUFBO0FBQ3BDLE9BQU8sTUFBTSxNQUFNLGlCQUFpQixDQUFBO0FBRXBDLE1BQU0saUNBQWlDLEdBQUcsSUFBSSxDQUFBO0FBRTlDLG1IQUFtSDtBQUNuSCxNQUFNLHdDQUF3QyxHQUFH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Ozs7OztPQUtHO0lBQ0gsS0FBSyxDQUFDLHlCQUF5QixDQUFDLElBQUk7UUFDbEMsTUFBTSxHQUFHLEdBQUcsSUFBSSxDQUFDLGVBQWUsQ0FBQyxJQUFJLENBQUMsQ0FBQTtRQUN0QyxNQUFNLElBQUksR0FBRyxNQUFNLElBQUksQ0FBQyxLQUFLLENBQzNCLG9JQUFvSSxHQUFHLG1DQUFtQyxDQUMzSyxDQUFBO1FBQ0QsTUFBTSxJQUFJLEdBQUcsSUFBSSxFQUFFLENBQUMsQ0FBQyxDQUFDLEVBQUUsNEJBQTRCLENBQUE7UUFFcEQsT0FBTyxJQUFJLEtBQUssSUFBSSxJQUFJLElBQUksS0FBSyxHQUFHLElBQUksSUFBSSxLQUFLLENBQUMsSUFBSSxJQUFJLEtBQUssR0FBRyxDQUFBO0lBQ3BFLENBQUM7Q0FDRiIsInNvdXJjZXNDb250ZW50IjpbIi8vIEB0cy1jaGVja1xuXG5pbXBvcnQgQWx0ZXJUYWJsZSBmcm9tIFwiLi9zcWwvYWx0ZXItdGFibGUuanNcIlxuaW1wb3J0IHdhaXQgZnJvbSBcImF3YWl0ZXJ5L2J1aWxkL3dhaXQuanNcIlxuaW1wb3J0IEJhc2UgZnJvbSBcIi4uL2Jhc2UuanNcIlxuaW1wb3J0IENvbHVtbiBmcm9tIFwiLi9jb2x1bW4uanNcIlxuaW1wb3J0IHsgQ2xpZW50LCB0eXBlcyBhcyBwZ1R5cGVzIH0gZnJvbSBcInBnXCJcbmltcG9ydCBDcmVhdGVEYXRhYmFzZSBmcm9tIFwiLi9zcWwvY3JlYXRlLWRhdGFiYXNlLmpzXCJcbmltcG9ydCBDcmVhdGVJbmRleCBmcm9tIFwiLi9zcWwvY3JlYXRlLWluZGV4LmpzXCJcbmltcG9ydCBDcmVhdGVUYWJsZSBmcm9tIFwiLi9zcWwvY3JlYXRlLXRhYmxlLmpzXCJcbmltcG9ydCBEZWxldGUgZnJvbSBcIi4vc3FsL2RlbGV0ZS5qc1wiXG5pbXBvcnQge2RpZ2d9IGZyb20gXCJkaWdnZXJpemVcIlxuaW1wb3J0IERyb3BEYXRhYmFzZSBmcm9tIFwiLi9zcWwvZHJvcC1kYXRhYmFzZS5qc1wiXG5pbXBvcnQgRHJvcFRhYmxlIGZyb20gXCIuL3NxbC9kcm9wLXRhYmxlLmpzXCJcbmltcG9ydCBJbnNlcnQgZnJvbSBcIi4vc3FsL2luc2VydC5qc1wiXG5pbXBvcnQgT3B0aW9ucyBmcm9tIFwiLi9vcHRpb25zLmpzXCJcbmltcG9ydCBRdWVyeVBhcnNlciBmcm9tIFwiLi9xdWVyeS1wYXJzZXIuanNcIlxuaW1wb3J0IFJlbW92ZUluZGV4IGZyb20gXCIuL3NxbC9yZW1vdmUtaW5kZXguanNcIlxuaW1wb3J0IFRhYmxlIGZyb20gXCIuL3RhYmxlLmpzXCJcbmltcG9ydCBTdHJ1Y3R1cmVTcWwgZnJvbSBcIi4vc3RydWN0dXJlLXNxbC5qc1wiXG5pbXBvcnQgVXBzZXJ0IGZyb20gXCIuL3NxbC91cHNlcnQuanNcIlxuaW1wb3J0IFVwZGF0ZSBmcm9tIFwiLi9zcWwvdXBkYXRlLmpzXCJcblxuY29uc3QgUEdfVElNRVNUQU1QX1dJVEhPVVRfVElNRVpPTkVfT0lEID0gMTExNFxuXG4vKiogU21hbGxlc3Qgd2FpdCBiZXR3ZWVuIGBwZ190cnlfYWR2aXNvcnlfbG9ja2AgcHJvYmVzOyBwcmVzZXJ2ZXMgdGhlIGhpc3RvcmljYWwgNTBtcyBjYWRlbmNlIGZvciBzaG9ydCBib3VuZHMuICovXG5jb25zdCBQR1NRTF9BRFZJU09SWV9MT0NLX1BPTExfTUlOX0lOVEVSVkFMX01TID0gNTBcbi8qKiBMYXJnZXN0IHdhaXQgYmV0d2VlbiBgcGdfdHJ5X2Fkdmlzb3J5X2xvY2tgIHByb2Jlczsga2VlcHMgYSBsb25nIGJvdW5kZWQgd2FpdCBmcm9tIHByb2JpbmcgdGVucyBvZiB0aG91c2FuZHMgb2YgdGltZXMuICovXG5jb25zdCBQR1NRTF9BRFZJU09SWV9MT0NLX1BPTExfTUFYX0lOVEVSVkFMX01TID0gMjAwMFxuXG5wZ1R5cGVzLnNldFR5cGVQYXJzZXIoUEdfVElNRVNUQU1QX1dJVEhPVVRfVElNRVpPTkVfT0lELCAodmFsdWUpID0+IG5ldyBEYXRlKGAke3ZhbHVlLnJlcGxhY2UoXCIgXCIsIFwiVFwiKX1aYCkpXG5cbmV4cG9ydCBkZWZhdWx0IGNsYXNzIFZlbG9jaW91c0RhdGFiYXNlRHJpdmVyc1Bnc3FsIGV4dGVuZHMgQmFzZXtcbiAgYXN5bmMgY29ubmVjdCgpIHtcbiAgICBjb25zdCBjbGllbnQgPSBuZXcgQ2xpZW50KHRoaXMuY29ubmVjdEFyZ3MoKSlcblxuICAgIHRyeSB7XG4gICAgICBhd2FpdCBjbGllbnQuY29ubmVjdCgpXG4gICAgICB0aGlzLmNvbm5lY3Rpb24gPSBjbGllbnRcbiAgICAgIGF3YWl0IHRoaXMuc2V0U2Vzc2lvblRpbWV6b25lVG9VdGMoKVxuICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICAvLyBSZS10aHJvdyB0byByZWNvdmVyIHJlYWwgc3RhY2sgdHJhY2VcbiAgICAgIGlmIChlcnJvciBpbnN0YW5jZW9mIEVycm9yKSB7XG4gICAgICAgIHRocm93IG5ldyBFcnJvcihgQ29ubmVjdCB0byBQb3N0Z3JlcyBzZXJ2ZXIgZmFpbGVkOiAke2Vycm9yLm1lc3NhZ2V9YCwge2NhdXNlOiBlcnJvcn0pXG4gICAgICB9IGVsc2Uge1xuICAgICAgICB0aHJvdyBuZXcgRXJyb3IoYENvbm5lY3QgdG8gUG9zdGdyZXMgc2VydmVyIGZhaWxlZDogJHtlcnJvcn1gLCB7Y2F1c2U6IGVycm9yfSlcbiAgICAgIH1cbiAgICB9XG4gIH1cblxuICBjb25uZWN0QXJncygpIHtcbiAgICBjb25zdCBhcmdzID0gdGhpcy5nZXRBcmdzKClcbiAgICBjb25zdCBmb3J3YXJkID0gW1wiZGF0YWJhc2VcIiwgXCJob3N0XCIsIFwicGFzc3dvcmRcIiwgXCJwb3J0XCJdXG5cbiAgICAvKipcbiAgICAgKiBDb25uZWN0IGFyZ3MuXG4gICAgICogQHR5cGUge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gKi9cbiAgICBjb25zdCBjb25uZWN0QXJncyA9IHt9XG5cbiAgICBmb3IgKGNvbnN0IGZvcndhcmRWYWx1ZSBvZiBmb3J3YXJkKSB7XG4gICAgICBpZiAoZm9yd2FyZFZhbHVlIGluIGFyZ3MpIGNvbm5lY3RBcmdzW2ZvcndhcmRWYWx1ZV0gPSBkaWdnKGFyZ3MsIGZvcndhcmRWYWx1ZSlcbiAgICB9XG5cbiAgICBpZiAoXCJ1c2VybmFtZVwiIGluIGFyZ3MpIGNvbm5lY3RBcmdzW1widXNlclwiXSA9IGFyZ3NbXCJ1c2VybmFtZVwiXVxuXG4gICAgcmV0dXJuIGNvbm5lY3RBcmdzXG4gIH1cblxuICBhc3luYyBfY2xvc2UoKSB7XG4gICAgYXdhaXQgdGhpcy5jb25uZWN0aW9uPy5lbmQoKVxuICAgIHRoaXMuY29ubmVjdGlvbiA9IHVuZGVmaW5lZFxuICAgIHRoaXMuX3RyYW5zYWN0aW9uc0NvdW50ID0gMFxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgc2V0IGNvbm5lY3Rpb24gY2hlY2tvdXQgbmFtZS5cbiAgICogQHBhcmFtIHtzdHJpbmcgfCB1bmRlZmluZWR9IG5hbWUgLSBIdW1hbi1yZWFkYWJsZSBuYW1lIGZvciB0aGlzIGFjdGl2ZSBjaGVja291dC5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgd2hlbiBjb21wbGV0ZS5cbiAgICovXG4gIGFzeW5jIHNldENvbm5lY3Rpb25DaGVja291dE5hbWUobmFtZSkge1xuICAgIGlmIChuYW1lKSB7XG4gICAgICBhd2FpdCB0aGlzLnF1ZXJ5KGBTRVQgYXBwbGljYXRpb25fbmFtZSA9ICR7dGhpcy5xdW90ZShuYW1lKX1gLCB7bG9nTmFtZTogXCJTZXQgQ29ubmVjdGlvbiBDaGVja291dCBOYW1lXCIsIHByb2Nlc3NMaXN0Q29tbWVudDogZmFsc2V9KVxuICAgIH0gZWxzZSB7XG4gICAgICBhd2FpdCB0aGlzLnF1ZXJ5KFwiUkVTRVQgYXBwbGljYXRpb25fbmFtZVwiLCB7bG9nTmFtZTogXCJDbGVhciBDb25uZWN0aW9uIENoZWNrb3V0IE5hbWVcIiwgcHJvY2Vzc0xpc3RDb21tZW50OiBmYWxzZX0pXG4gICAgfVxuXG4gICAgYXdhaXQgc3VwZXIuc2V0Q29ubmVjdGlvbkNoZWNrb3V0TmFtZShuYW1lKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgY2xlYXIgY29ubmVjdGlvbiBjaGVja291dCBuYW1lLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyB3aGVuIGNvbXBsZXRlLlxuICAgKi9cbiAgYXN5bmMgY2xlYXJDb25uZWN0aW9uQ2hlY2tvdXROYW1lKCkge1xuICAgIGF3YWl0IHRoaXMucXVlcnkoXCJSRVNFVCBhcHBsaWNhdGlvbl9uYW1lXCIsIHtsb2dOYW1lOiBcIkNsZWFyIENvbm5lY3Rpb24gQ2hlY2tvdXQgTmFtZVwiLCBwcm9jZXNzTGlzdENvbW1lbnQ6IGZhbHNlfSlcbiAgICBhd2FpdCBzdXBlci5jbGVhckNvbm5lY3Rpb25DaGVja291dE5hbWUoKVxuICB9XG5cbiAgLyoqXG4gICAqIFNldHMgdGhlIGRhdGFiYXNlIHNlc3Npb24gdGltZXpvbmUgdG8gVVRDIHNvIGJhcmUgdGltZXN0YW1wIGxpdGVyYWxzIHN0b3JlIFVUQyBpbnN0YW50cy5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgd2hlbiBjb21wbGV0ZS5cbiAgICovXG4gIGFzeW5jIHNldFNlc3Npb25UaW1lem9uZVRvVXRjKCkge1xuICAgIGF3YWl0IHRoaXMucXVlcnkoXCJTRVQgVElNRSBaT05FICdVVEMnXCIsIHtsb2dOYW1lOiBcIlNldCBTZXNzaW9uIFRpbWUgWm9uZVwiLCBwcm9jZXNzTGlzdENvbW1lbnQ6IGZhbHNlfSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGFsdGVyIHRhYmxlIHNxbHMuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vLi4vdGFibGUtZGF0YS9pbmRleC5qc1wiKS5kZWZhdWx0fSB0YWJsZURhdGEgLSBUYWJsZSBkYXRhLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxzdHJpbmdbXT59IC0gUmVzb2x2ZXMgd2l0aCBTUUwgc3RhdGVtZW50cy5cbiAgICovXG4gIGFzeW5jIGFsdGVyVGFibGVTUUxzKHRhYmxlRGF0YSkge1xuICAgIGNvbnN0IGFsdGVyQXJncyA9IHt0YWJsZURhdGEsIGRyaXZlcjogdGhpc31cbiAgICBjb25zdCBhbHRlclRhYmxlID0gbmV3IEFsdGVyVGFibGUoYWx0ZXJBcmdzKVxuXG4gICAgcmV0dXJuIGF3YWl0IGFsdGVyVGFibGUudG9TUUxzKClcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGNyZWF0ZSBkYXRhYmFzZSBzcWwuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBkYXRhYmFzZU5hbWUgLSBEYXRhYmFzZSBuYW1lLlxuICAgKiBAcGFyYW0ge29iamVjdH0gW2FyZ3NdIC0gT3B0aW9ucyBvYmplY3QuXG4gICAqIEBwYXJhbSB7Ym9vbGVhbn0gW2FyZ3MuaWZOb3RFeGlzdHNdIC0gV2hldGhlciBpZiBub3QgZXhpc3RzLlxuICAgKiBAcmV0dXJucyB7c3RyaW5nW119IC0gU1FMIHN0YXRlbWVudHMuXG4gICAqL1xuICBjcmVhdGVEYXRhYmFzZVNxbChkYXRhYmFzZU5hbWUsIGFyZ3MpIHtcbiAgICBjb25zdCBjcmVhdGVBcmdzID0gT2JqZWN0LmFzc2lnbih7ZGF0YWJhc2VOYW1lLCBkcml2ZXI6IHRoaXN9LCBhcmdzKVxuICAgIGNvbnN0IGNyZWF0ZURhdGFiYXNlID0gbmV3IENyZWF0ZURhdGFiYXNlKGNyZWF0ZUFyZ3MpXG5cbiAgICByZXR1cm4gY3JlYXRlRGF0YWJhc2UudG9TcWwoKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZHJvcCBkYXRhYmFzZSBzcWwuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBkYXRhYmFzZU5hbWUgLSBEYXRhYmFzZSBuYW1lLlxuICAgKiBAcGFyYW0ge29iamVjdH0gW2FyZ3NdIC0gT3B0aW9ucyBvYmplY3QuXG4gICAqIEBwYXJhbSB7Ym9vbGVhbn0gW2FyZ3MuaWZFeGlzdHNdIC0gV2hldGhlciBpZiBleGlzdHMuXG4gICAqIEByZXR1cm5zIHtzdHJpbmdbXX0gLSBTUUwgc3RhdGVtZW50cy5cbiAgICovXG4gIGRyb3BEYXRhYmFzZVNxbChkYXRhYmFzZU5hbWUsIGFyZ3MpIHtcbiAgICBjb25zdCBkcm9wQXJncyA9IE9iamVjdC5hc3NpZ24oe2RhdGFiYXNlTmFtZSwgZHJpdmVyOiB0aGlzfSwgYXJncylcbiAgICBjb25zdCBkcm9wRGF0YWJhc2UgPSBuZXcgRHJvcERhdGFiYXNlKGRyb3BBcmdzKVxuXG4gICAgcmV0dXJuIGRyb3BEYXRhYmFzZS50b1NxbCgpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBjcmVhdGUgaW5kZXggc3Fscy5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9iYXNlLmpzXCIpLkNyZWF0ZUluZGV4U3FsQXJnc30gaW5kZXhEYXRhIC0gSW5kZXggZGF0YS5cbiAgICogQHJldHVybnMge1Byb21pc2U8c3RyaW5nW10+fSAtIFJlc29sdmVzIHdpdGggU1FMIHN0YXRlbWVudHMuXG4gICAqL1xuICBhc3luYyBjcmVhdGVJbmRleFNRTHMoaW5kZXhEYXRhKSB7XG4gICAgY29uc3QgY3JlYXRlQXJncyA9IE9iamVjdC5hc3NpZ24oe2RyaXZlcjogdGhpc30sIGluZGV4RGF0YSlcbiAgICBjb25zdCBjcmVhdGVJbmRleCA9IG5ldyBDcmVhdGVJbmRleChjcmVhdGVBcmdzKVxuXG4gICAgcmV0dXJuIGF3YWl0IGNyZWF0ZUluZGV4LnRvU1FMcygpXG4gIH1cblxuICAvKipcbiAgICogUnVucyByZW1vdmUgaW5kZXggc3Fscy5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9iYXNlLmpzXCIpLlJlbW92ZUluZGV4U3FsQXJnc30gaW5kZXhEYXRhIC0gSW5kZXggZGF0YS5cbiAgICogQHJldHVybnMge1Byb21pc2U8c3RyaW5nW10+fSAtIFJlc29sdmVzIHdpdGggU1FMIHN0YXRlbWVudHMuXG4gICAqL1xuICBhc3luYyByZW1vdmVJbmRleFNRTHMoaW5kZXhEYXRhKSB7XG4gICAgY29uc3QgcmVtb3ZlQXJncyA9IE9iamVjdC5hc3NpZ24oe2RyaXZlcjogdGhpc30sIGluZGV4RGF0YSlcbiAgICBjb25zdCByZW1vdmVJbmRleCA9IG5ldyBSZW1vdmVJbmRleChyZW1vdmVBcmdzKVxuXG4gICAgcmV0dXJuIGF3YWl0IHJlbW92ZUluZGV4LnRvU1FMcygpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBjcmVhdGUgdGFibGUgc3FsLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uLy4uL3RhYmxlLWRhdGEvaW5kZXguanNcIikuZGVmYXVsdH0gdGFibGVEYXRhIC0gVGFibGUgZGF0YS5cbiAgICogQHJldHVybnMge1Byb21pc2U8c3RyaW5nW10+fSAtIFJlc29sdmVzIHdpdGggU1FMIHN0YXRlbWVudHMuXG4gICAqL1xuICBhc3luYyBjcmVhdGVUYWJsZVNxbCh0YWJsZURhdGEpIHtcbiAgICBjb25zdCBjcmVhdGVBcmdzID0ge3RhYmxlRGF0YSwgZHJpdmVyOiB0aGlzLCBpbmRleEluQ3JlYXRlVGFibGU6IGZhbHNlfVxuICAgIGNvbnN0IGNyZWF0ZVRhYmxlID0gbmV3IENyZWF0ZVRhYmxlKGNyZWF0ZUFyZ3MpXG5cbiAgICByZXR1cm4gYXdhaXQgY3JlYXRlVGFibGUudG9TcWwoKVxuICB9XG5cbiAgYXN5bmMgY3VycmVudERhdGFiYXNlKCkge1xuICAgIGNvbnN0IHJvd3MgPSBhd2FpdCB0aGlzLnF1ZXJ5KFwiU0VMRUNUIENVUlJFTlRfREFUQUJBU0UoKSBBUyBkYl9uYW1lXCIpXG5cbiAgICByZXR1cm4gZGlnZyhyb3dzLCAwLCBcImRiX25hbWVcIilcbiAgfVxuXG4gIGFzeW5jIGRpc2FibGVGb3JlaWduS2V5cygpIHtcbiAgICBhd2FpdCB0aGlzLnF1ZXJ5KFwiU0VUIHNlc3Npb25fcmVwbGljYXRpb25fcm9sZSA9ICdyZXBsaWNhJ1wiKVxuICB9XG5cbiAgYXN5bmMgZW5hYmxlRm9yZWlnbktleXMoKSB7XG4gICAgYXdhaXQgdGhpcy5xdWVyeShcIlNFVCBzZXNzaW9uX3JlcGxpY2F0aW9uX3JvbGUgPSAnb3JpZ2luJ1wiKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZHJvcCB0YWJsZSBzcWxzLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gdGFibGVOYW1lIC0gVGFibGUgbmFtZS5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9iYXNlLmpzXCIpLkRyb3BUYWJsZVNxbEFyZ3NUeXBlfSBbYXJnc10gLSBPcHRpb25zIG9iamVjdC5cbiAgICogQHJldHVybnMge1Byb21pc2U8c3RyaW5nW10+fSAtIFJlc29sdmVzIHdpdGggU1FMIHN0YXRlbWVudHMuXG4gICAqL1xuICBhc3luYyBkcm9wVGFibGVTUUxzKHRhYmxlTmFtZSwgYXJncyA9IHt9KSB7XG4gICAgY29uc3QgZHJvcEFyZ3MgPSBPYmplY3QuYXNzaWduKHt0YWJsZU5hbWUsIGRyaXZlcjogdGhpc30sIGFyZ3MpXG4gICAgY29uc3QgZHJvcFRhYmxlID0gbmV3IERyb3BUYWJsZShkcm9wQXJncylcblxuICAgIHJldHVybiBhd2FpdCBkcm9wVGFibGUudG9TUUxzKClcbiAgfVxuXG4gIGdldFR5cGUoKSB7IHJldHVybiBcInBnc3FsXCIgfVxuXG4gIC8qKlxuICAgKiBXaGV0aGVyIHRoaXMgZHJpdmVyIHN1cHBvcnRzIGNvbWJpbmluZyBvcGVyYXRpb25zIGludG8gb25lIGJ1bGsgYEFMVEVSYC5cbiAgICogQHJldHVybnMge2Jvb2xlYW59IC0gV2hldGhlciBidWxrIGFsdGVyIGlzIHN1cHBvcnRlZC5cbiAgICovXG4gIHN1cHBvcnRzQnVsa0FsdGVyKCkgeyByZXR1cm4gdHJ1ZSB9XG5cbiAgLyoqXG4gICAqIFdoZXRoZXIgdGhlIGJ1bGsgYEFMVEVSYCBjYW4gYWxzbyBjYXJyeSBgQUREIElOREVYYCBjbGF1c2VzLiBQb3N0Z3JlU1FMJ3NcbiAgICogYEFMVEVSIFRBQkxFYCBjYW5ub3QgZXhwcmVzcyBpbmRleCBjcmVhdGlvbiwgc28gaW5kZXhlcyBzdGF5IHN0YW5kYWxvbmUuXG4gICAqIEByZXR1cm5zIHtib29sZWFufSAtIFdoZXRoZXIgaW5kZXhlcyBjYW4gYmUgYWRkZWQgaW5zaWRlIGEgYnVsayBhbHRlci5cbiAgICovXG4gIHN1cHBvcnRzQnVsa0FsdGVySW5kZXhlcygpIHsgcmV0dXJuIGZhbHNlIH1cblxuICAvKipcbiAgICogUnVucyBxdWVyeSBhY3R1YWwuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBzcWwgLSBTUUwgc3RyaW5nLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxpbXBvcnQoXCIuLi9iYXNlLmpzXCIpLlF1ZXJ5UmVzdWx0VHlwZT59IC0gUmVzb2x2ZXMgd2l0aCB0aGUgcXVlcnkgYWN0dWFsLlxuICAgKi9cbiAgYXN5bmMgX3F1ZXJ5QWN0dWFsKHNxbCkge1xuICAgIGxldCByZXNwb25zZVxuXG4gICAgaWYgKCF0aGlzLmNvbm5lY3Rpb24pIGF3YWl0IHRoaXMuY29ubmVjdCgpXG4gICAgaWYgKCF0aGlzLmNvbm5lY3Rpb24pIHRocm93IG5ldyBFcnJvcihcIlBvc3RncmVTUUwgY29ubmVjdGlvbiBmYWlsZWQgdG8gaW5pdGlhbGl6ZVwiKVxuXG4gICAgdHJ5IHtcbiAgICAgIHJlc3BvbnNlID0gYXdhaXQgdGhpcy5jb25uZWN0aW9uLnF1ZXJ5KHNxbClcbiAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgaWYgKGVycm9yIGluc3RhbmNlb2YgRXJyb3IpIHtcbiAgICAgICAgdGhyb3cgbmV3IEVycm9yKGBRdWVyeSBmYWlsZWQ6ICR7ZXJyb3IubWVzc2FnZX0gd2l0aCBTUUw6ICR7c3FsfWAsIHtjYXVzZTogZXJyb3J9KVxuICAgICAgfSBlbHNlIHtcbiAgICAgICAgdGhyb3cgbmV3IEVycm9yKGBRdWVyeSBmYWlsZWQ6ICR7ZXJyb3J9IHdpdGggU1FMOiAke3NxbH1gLCB7Y2F1c2U6IGVycm9yfSlcbiAgICAgIH1cbiAgICB9XG5cbiAgICByZXR1cm4gcmVzcG9uc2Uucm93c1xuICB9XG5cbiAgLyoqXG4gICAqIEV4ZWN1dGVzIGEgbXV0YXRpb24gd2l0aCBhZmZlY3RlZC1yb3cgbWV0YWRhdGEuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBzcWwgLSBNdXRhdGlvbiBTUUwuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPG51bWJlcj59IC0gQWZmZWN0ZWQgcm93IGNvdW50LlxuICAgKi9cbiAgYXN5bmMgX2FmZmVjdGVkUm93c0FjdHVhbChzcWwpIHtcbiAgICBpZiAoIXRoaXMuY29ubmVjdGlvbikgYXdhaXQgdGhpcy5jb25uZWN0KClcbiAgICBpZiAoIXRoaXMuY29ubmVjdGlvbikgdGhyb3cgbmV3IEVycm9yKFwiUG9zdGdyZVNRTCBjb25uZWN0aW9uIGZhaWxlZCB0byBpbml0aWFsaXplXCIpXG4gICAgY29uc3QgcmVzcG9uc2UgPSBhd2FpdCB0aGlzLmNvbm5lY3Rpb24ucXVlcnkoc3FsKVxuICAgIHJldHVybiByZXNwb25zZS5yb3dDb3VudCB8fCAwXG4gIH1cblxuICAvKipcbiAgICogUnVucyBxdWVyeSB0byBzcWwuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vLi4vcXVlcnkvaW5kZXguanNcIikuZGVmYXVsdH0gcXVlcnkgLSBRdWVyeSBpbnN0YW5jZS5cbiAgICogQHJldHVybnMge3N0cmluZ30gLSBTUUwgc3RyaW5nLlxuICAgKi9cbiAgcXVlcnlUb1NxbChxdWVyeSkgeyByZXR1cm4gbmV3IFF1ZXJ5UGFyc2VyKHtxdWVyeX0pLnRvU3FsKCkgfVxuICBzaG91bGRTZXRBdXRvSW5jcmVtZW50V2hlblByaW1hcnlLZXkoKSB7IHJldHVybiB0cnVlIH1cbiAgc3VwcG9ydHNEZWZhdWx0UHJpbWFyeUtleVVVSUQoKSB7IHJldHVybiB0cnVlIH1cblxuICAvKipcbiAgICogUnVucyBjb252ZXJ0IHZhbHVlLlxuICAgKiBAcGFyYW0ge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSB2YWx1ZSAtIFZhbHVlIHRvIHVzZS5cbiAgICogQHJldHVybnMge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSAtIFRoZSBjb252ZXJ0ZWQgdmFsdWUuXG4gICAqL1xuICBfY29udmVydFZhbHVlKHZhbHVlKSB7XG4gICAgaWYgKHR5cGVvZiB2YWx1ZSA9PT0gXCJib29sZWFuXCIpIHtcbiAgICAgIHJldHVybiB2YWx1ZSA/IFwidHJ1ZVwiIDogXCJmYWxzZVwiXG4gICAgfVxuXG4gICAgcmV0dXJuIHN1cGVyLl9jb252ZXJ0VmFsdWUodmFsdWUpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBlc2NhcGUuXG4gICAqIEBwYXJhbSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59IHZhbHVlIC0gVmFsdWUgdG8gdXNlLlxuICAgKiBAcmV0dXJucyB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59IC0gVGhlIGVzY2FwZS5cbiAgICovXG4gIGVzY2FwZSh2YWx1ZSkge1xuICAgIGlmICghdGhpcy5jb25uZWN0aW9uKSB0aHJvdyBuZXcgRXJyb3IoXCJDYW4ndCBlc2NhcGUgYmVmb3JlIGNvbm5lY3RlZFwiKVxuICAgIGlmICh0eXBlb2YgdmFsdWUgPT09IFwibnVtYmVyXCIpIHJldHVybiB2YWx1ZVxuXG4gICAgY29uc3QgZXNjYXBlZFZhbHVlV2l0aFF1b3RlcyA9IHRoaXMuY29ubmVjdGlvbi5lc2NhcGVMaXRlcmFsKHRoaXMuX2NvbnZlcnRWYWx1ZSh2YWx1ZSkpXG5cbiAgICByZXR1cm4gZXNjYXBlZFZhbHVlV2l0aFF1b3Rlcy5zbGljZSgxLCBlc2NhcGVkVmFsdWVXaXRoUXVvdGVzLmxlbmd0aCAtIDEpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBxdW90ZS5cbiAgICogQHBhcmFtIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gdmFsdWUgLSBWYWx1ZSB0byB1c2UuXG4gICAqIEByZXR1cm5zIHtzdHJpbmcgfCBudW1iZXJ9IC0gVGhlIHF1b3RlZCB2YWx1ZS5cbiAgICovXG4gIHF1b3RlKHZhbHVlKSB7XG4gICAgaWYgKCF0aGlzLmNvbm5lY3Rpb24pIHRocm93IG5ldyBFcnJvcihcIkNhbid0IGVzY2FwZSBiZWZvcmUgY29ubmVjdGVkXCIpXG4gICAgaWYgKHR5cGVvZiB2YWx1ZSA9PT0gXCJudW1iZXJcIikgcmV0dXJuIHZhbHVlXG5cbiAgICByZXR1cm4gdGhpcy5jb25uZWN0aW9uLmVzY2FwZUxpdGVyYWwodGhpcy5fY29udmVydFZhbHVlKHZhbHVlKSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGRlbGV0ZSBzcWwuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vYmFzZS5qc1wiKS5EZWxldGVTcWxBcmdzVHlwZX0gYXJncyAtIE9wdGlvbnMgb2JqZWN0LlxuICAgKiBAcmV0dXJucyB7c3RyaW5nfSAtIFNRTCBzdHJpbmcuXG4gICAqL1xuICBkZWxldGVTcWwoe3RhYmxlTmFtZSwgY29uZGl0aW9uc30pIHtcbiAgICBjb25zdCBkZWxldGVJbnN0cnVjdGlvbiA9IG5ldyBEZWxldGUoe2NvbmRpdGlvbnMsIGRyaXZlcjogdGhpcywgdGFibGVOYW1lfSlcblxuICAgIHJldHVybiBkZWxldGVJbnN0cnVjdGlvbi50b1NxbCgpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBpbnNlcnQgc3FsLlxuICAgKiBAYWJzdHJhY3RcbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9iYXNlLmpzXCIpLkluc2VydFNxbEFyZ3NUeXBlfSBhcmdzIC0gT3B0aW9ucyBvYmplY3QuXG4gICAqIEByZXR1cm5zIHtzdHJpbmd9IC0gU1FMIHN0cmluZy5cbiAgICovXG4gIGluc2VydFNxbChhcmdzKSB7XG4gICAgY29uc3QgaW5zZXJ0QXJncyA9IE9iamVjdC5hc3NpZ24oe2RyaXZlcjogdGhpc30sIGFyZ3MpXG4gICAgY29uc3QgaW5zZXJ0ID0gbmV3IEluc2VydChpbnNlcnRBcmdzKVxuXG4gICAgcmV0dXJuIGluc2VydC50b1NxbCgpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBnZXQgdGFibGVzLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxBcnJheTxpbXBvcnQoXCIuLi9iYXNlLXRhYmxlLmpzXCIpLmRlZmF1bHQ+Pn0gLSBSZXNvbHZlcyB3aXRoIHRoZSB0YWJsZXMuXG4gICAqL1xuICBhc3luYyBnZXRUYWJsZXMoKSB7XG4gICAgcmV0dXJuIGF3YWl0IHRoaXMuX2NhY2hlZFNjaGVtYU1ldGFkYXRhKFwidGFibGVzXCIsIGFzeW5jICgpID0+IHtcbiAgICAgIGNvbnN0IHJlc3VsdCA9IGF3YWl0IHRoaXMucXVlcnkoXCJTRUxFQ1QgKiBGUk9NIGluZm9ybWF0aW9uX3NjaGVtYS50YWJsZXMgV0hFUkUgdGFibGVfY2F0YWxvZyA9IENVUlJFTlRfREFUQUJBU0UoKSBBTkQgdGFibGVfc2NoZW1hID0gJ3B1YmxpYydcIilcbiAgICAgIGNvbnN0IHRhYmxlcyA9IFtdXG5cbiAgICAgIGZvciAoY29uc3Qgcm93IG9mIHJlc3VsdCkge1xuICAgICAgICBjb25zdCB0YWJsZSA9IG5ldyBUYWJsZSh0aGlzLCAvKiogQHR5cGUge1JlY29yZDxzdHJpbmcsIHN0cmluZz59ICovIChyb3cpKVxuXG4gICAgICAgIHRhYmxlcy5wdXNoKHRhYmxlKVxuICAgICAgfVxuXG4gICAgICByZXR1cm4gdGFibGVzXG4gICAgfSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSZWFkcyBjb2x1bW4gbWV0YWRhdGEgZm9yIG1hbnkgdGFibGVzIGluIG9uZSBxdWVyeSBpbnN0ZWFkIG9mIG9uZSBjYXRhbG9nXG4gICAqIGpvaW4gcGVyIHRhYmxlLlxuICAgKiBAcGFyYW0ge0FycmF5PGltcG9ydChcIi4uL2Jhc2UtdGFibGUuanNcIikuZGVmYXVsdD59IHRhYmxlcyAtIFRhYmxlcyB0byBsb2FkIGNvbHVtbnMgZm9yLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxNYXA8c3RyaW5nLCBBcnJheTxpbXBvcnQoXCIuLi9iYXNlLWNvbHVtbi5qc1wiKS5kZWZhdWx0Pj4+fSAtIENvbHVtbnMga2V5ZWQgYnkgdGFibGUgbmFtZS5cbiAgICovXG4gIGFzeW5jIGJhdGNoVGFibGVDb2x1bW5zKHRhYmxlcykge1xuICAgIC8qKiBAdHlwZSB7TWFwPHN0cmluZywgQXJyYXk8aW1wb3J0KFwiLi4vYmFzZS1jb2x1bW4uanNcIikuZGVmYXVsdD4+fSAqL1xuICAgIGNvbnN0IGNvbHVtbnNCeVRhYmxlID0gbmV3IE1hcCgpXG5cbiAgICBpZiAodGFibGVzLmxlbmd0aCA9PT0gMCkgcmV0dXJuIGNvbHVtbnNCeVRhYmxlXG5cbiAgICBjb25zdCB0YWJsZXNCeU5hbWUgPSBuZXcgTWFwKHRhYmxlcy5tYXAoKHRhYmxlKSA9PiBbdGFibGUuZ2V0TmFtZSgpLCB0YWJsZV0pKVxuICAgIGNvbnN0IHRhYmxlTmFtZXNTcWwgPSBbLi4udGFibGVzQnlOYW1lLmtleXMoKV0ubWFwKCh0YWJsZU5hbWUpID0+IHRoaXMucXVvdGUodGFibGVOYW1lKSkuam9pbihcIiwgXCIpXG4gICAgY29uc3Qgcm93cyA9IGF3YWl0IHRoaXMucXVlcnkoYFxuICAgICAgU0VMRUNUXG4gICAgICAgIGNvbHVtbnMuKixcbiAgICAgICAgQ0FTRSBXSEVOIGtleV9jb2x1bW5fdXNhZ2UuY29sdW1uX25hbWUgSVMgTk9UIE5VTEwgVEhFTiAxIEVMU0UgMCBFTkQgQVMgaXNfcHJpbWFyeV9rZXksXG4gICAgICAgIGNvbF9kZXNjcmlwdGlvbigoY29sdW1ucy50YWJsZV9zY2hlbWEgfHwgJy4nIHx8IGNvbHVtbnMudGFibGVfbmFtZSk6OnJlZ2NsYXNzLCBjb2x1bW5zLm9yZGluYWxfcG9zaXRpb24pIEFTIGNvbHVtbl9jb21tZW50XG5cbiAgICAgIEZST01cbiAgICAgICAgaW5mb3JtYXRpb25fc2NoZW1hLmNvbHVtbnMgQVMgY29sdW1uc1xuXG4gICAgICBMRUZUIEpPSU4gaW5mb3JtYXRpb25fc2NoZW1hLnRhYmxlX2NvbnN0cmFpbnRzIEFTIHRhYmxlX2NvbnN0cmFpbnRzIE9OXG4gICAgICAgIHRhYmxlX2NvbnN0cmFpbnRzLnRhYmxlX25hbWUgPSBjb2x1bW5zLnRhYmxlX25hbWUgQU5EXG4gICAgICAgIHRhYmxlX2NvbnN0cmFpbnRzLnRhYmxlX3NjaGVtYSA9IGNvbHVtbnMudGFibGVfc2NoZW1hIEFORFxuICAgICAgICB0YWJsZV9jb25zdHJhaW50cy5jb25zdHJhaW50X3R5cGUgPSAnUFJJTUFSWSBLRVknXG5cbiAgICAgIExFRlQgSk9JTiBpbmZvcm1hdGlvbl9zY2hlbWEua2V5X2NvbHVtbl91c2FnZSBBUyBrZXlfY29sdW1uX3VzYWdlIE9OXG4gICAgICAgIGtleV9jb2x1bW5fdXNhZ2UuY29uc3RyYWludF9uYW1lID0gdGFibGVfY29uc3RyYWludHMuY29uc3RyYWludF9uYW1lIEFORFxuICAgICAgICBrZXlfY29sdW1uX3VzYWdlLnRhYmxlX3NjaGVtYSA9IHRhYmxlX2NvbnN0cmFpbnRzLnRhYmxlX3NjaGVtYSBBTkRcbiAgICAgICAga2V5X2NvbHVtbl91c2FnZS50YWJsZV9uYW1lID0gY29sdW1ucy50YWJsZV9uYW1lIEFORFxuICAgICAgICBrZXlfY29sdW1uX3VzYWdlLmNvbHVtbl9uYW1lID0gY29sdW1ucy5jb2x1bW5fbmFtZVxuXG4gICAgICBXSEVSRVxuICAgICAgICBjb2x1bW5zLnRhYmxlX2NhdGFsb2cgPSBDVVJSRU5UX0RBVEFCQVNFKCkgQU5EXG4gICAgICAgIGNvbHVtbnMudGFibGVfc2NoZW1hID0gJ3B1YmxpYycgQU5EXG4gICAgICAgIGNvbHVtbnMudGFibGVfbmFtZSBJTiAoJHt0YWJsZU5hbWVzU3FsfSlcbiAgICAgIE9SREVSIEJZIGNvbHVtbnMudGFibGVfbmFtZSwgY29sdW1ucy5vcmRpbmFsX3Bvc2l0aW9uXG4gICAgYClcblxuICAgIGZvciAoY29uc3Qgcm93IG9mIHJvd3MpIHtcbiAgICAgIGNvbnN0IHRhYmxlTmFtZSA9IC8qKiBAdHlwZSB7c3RyaW5nfSAqLyAocm93LnRhYmxlX25hbWUpXG4gICAgICBjb25zdCB0YWJsZSA9IHRhYmxlc0J5TmFtZS5nZXQodGFibGVOYW1lKVxuXG4gICAgICBpZiAoIXRhYmxlKSBjb250aW51ZVxuXG4gICAgICBjb25zdCBjb2x1bW5zID0gY29sdW1uc0J5VGFibGUuZ2V0KHRhYmxlTmFtZSkgfHwgW11cblxuICAgICAgY29sdW1ucy5wdXNoKG5ldyBDb2x1bW4odGFibGUsIC8qKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSAqLyAocm93KSkpXG4gICAgICBjb2x1bW5zQnlUYWJsZS5zZXQodGFibGVOYW1lLCBjb2x1bW5zKVxuICAgIH1cblxuICAgIHJldHVybiBjb2x1bW5zQnlUYWJsZVxuICB9XG5cbiAgLyoqXG4gICAqIFRydW5jYXRlcyBhbGwgZWxpZ2libGUgdGFibGVzIGluIG9uZSBQb3N0Z3JlU1FMIHJlcXVlc3QuXG4gICAqIEBwYXJhbSB7QXJyYXk8aW1wb3J0KFwiLi4vYmFzZS10YWJsZS5qc1wiKS5kZWZhdWx0Pn0gdGFibGVzIC0gRWxpZ2libGUgdGFibGVzLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyB3aGVuIHRoZSBiYXRjaCBjb21wbGV0ZXMuXG4gICAqL1xuICBhc3luYyB0cnVuY2F0ZVRhYmxlcyh0YWJsZXMpIHtcbiAgICBjb25zdCBxdW90ZWRUYWJsZXMgPSB0YWJsZXMubWFwKCh0YWJsZSkgPT4gdGhpcy5xdW90ZVRhYmxlKHRhYmxlLmdldE5hbWUoKSkpXG5cbiAgICBhd2FpdCB0aGlzLnF1ZXJ5KGBUUlVOQ0FURSBUQUJMRSAke3F1b3RlZFRhYmxlcy5qb2luKFwiLCBcIil9IENBU0NBREVgKVxuICB9XG5cbiAgYXN5bmMgbGFzdEluc2VydElEKG9wdGlvbnMgPSB7fSkge1xuICAgIGNvbnN0IHJlc3VsdCA9IGF3YWl0IHRoaXMucXVlcnkoXCJTRUxFQ1QgTEFTVFZBTCgpIEFTIGxhc3RfaW5zZXJ0X2lkXCIsIG9wdGlvbnMpXG5cbiAgICByZXR1cm4gZGlnZyhyZXN1bHQsIDAsIFwibGFzdF9pbnNlcnRfaWRcIilcbiAgfVxuXG4gIG9wdGlvbnMoKSB7XG4gICAgaWYgKCF0aGlzLl9vcHRpb25zKSB0aGlzLl9vcHRpb25zID0gbmV3IE9wdGlvbnModGhpcylcblxuICAgIHJldHVybiB0aGlzLl9vcHRpb25zXG4gIH1cblxuICBhc3luYyBfc3RhcnRUcmFuc2FjdGlvbkFjdGlvbihvcHRpb25zID0ge30pIHtcbiAgICBhd2FpdCB0aGlzLnF1ZXJ5KFwiU1RBUlQgVFJBTlNBQ1RJT05cIiwgb3B0aW9ucylcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHVwZGF0ZSBzcWwuXG4gICAqIEBhYnN0cmFjdFxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL2Jhc2UuanNcIikuVXBkYXRlU3FsQXJnc1R5cGV9IGFyZ3MgLSBPcHRpb25zIG9iamVjdC5cbiAgICogQHJldHVybnMge3N0cmluZ30gLSBTUUwgc3RyaW5nLlxuICAgKi9cbiAgdXBkYXRlU3FsKHtjb25kaXRpb25zLCBkYXRhLCB0YWJsZU5hbWV9KSB7XG4gICAgY29uc3QgdXBkYXRlID0gbmV3IFVwZGF0ZSh7Y29uZGl0aW9ucywgZGF0YSwgZHJpdmVyOiB0aGlzLCB0YWJsZU5hbWV9KVxuXG4gICAgcmV0dXJuIHVwZGF0ZS50b1NxbCgpXG4gIH1cblxuICAvKipcbiAgICogUnVucyB1cHNlcnQgc3FsLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL2Jhc2UuanNcIikuVXBzZXJ0U3FsQXJnc1R5cGV9IGFyZ3MgLSBPcHRpb25zIG9iamVjdC5cbiAgICogQHJldHVybnMge3N0cmluZ30gLSBTUUwgc3RyaW5nLlxuICAgKi9cbiAgdXBzZXJ0U3FsKGFyZ3MpIHtcbiAgICBjb25zdCB1cHNlcnQgPSBuZXcgVXBzZXJ0KHsuLi5hcmdzLCBkcml2ZXI6IHRoaXN9KVxuXG4gICAgcmV0dXJuIHVwc2VydC50b1NxbCgpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBzdHJ1Y3R1cmUgc3FsLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxzdHJpbmcgfCBudWxsPn0gLSBSZXNvbHZlcyB3aXRoIFNRTCBzdHJpbmcuXG4gICAqL1xuICBhc3luYyBzdHJ1Y3R1cmVTcWwoKSB7XG4gICAgcmV0dXJuIGF3YWl0IHRoaXMuX2NhY2hlZFNjaGVtYU1ldGFkYXRhKFwic3RydWN0dXJlU3FsXCIsIGFzeW5jICgpID0+IGF3YWl0IG5ldyBTdHJ1Y3R1cmVTcWwoe2RyaXZlcjogdGhpc30pLnRvU3FsKCkpXG4gIH1cblxuICAvKipcbiAgICogRGV0ZXJtaW5pc3RpY2FsbHkgaGFzaGVzIGEgbG9jayBuYW1lIGludG8gYSBzaWduZWQgNjQtYml0IGludGVnZXIgc28gaXRcbiAgICogY2FuIGJlIHBhc3NlZCB0byBgcGdfYWR2aXNvcnlfbG9jayhiaWdpbnQpYC4gV2UgdXNlIGEgZmFzdCA2NC1iaXQgRk5WLTFhXG4gICAqIGhhc2gg4oCUIHRoZSBleGFjdCB2YWx1ZSBkb2VzIG5vdCBtYXR0ZXIsIG9ubHkgdGhhdCB0aGUgc2FtZSBuYW1lIGFsd2F5c1xuICAgKiBwcm9kdWNlcyB0aGUgc2FtZSBrZXkgd2l0aGluIGEgcHJvY2VzcyBBTkQgYWNyb3NzIHByb2Nlc3NlcyB0aGF0IHNoYXJlXG4gICAqIHRoZSBzYW1lIGltcGxlbWVudGF0aW9uLiBSZXR1cm5zIHRoZSB2YWx1ZSBhcyBhIHN0cmluZyBzbyB0aGUgY2FsbGVyXG4gICAqIGNhbiBpbnRlcnBvbGF0ZSBpdCBpbnRvIFNRTCB3aXRob3V0IGxvc2luZyBwcmVjaXNpb24gdG8gSlMgbnVtYmVyXG4gICAqIGNvZXJjaW9uLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gbmFtZSAtIExvY2sgbmFtZS5cbiAgICogQHJldHVybnMge3N0cmluZ30gLSBTaWduZWQgNjQtYml0IGludGVnZXIgYXMgYSBkZWNpbWFsIHN0cmluZy5cbiAgICovXG4gIGFkdmlzb3J5TG9ja0tleShuYW1lKSB7XG4gICAgLy8gRk5WLTFhIDY0LWJpdCwgY29tcHV0ZWQgd2l0aCBCaWdJbnQgc28gd2UgZG9uJ3QgbG9zZSBwcmVjaXNpb24uXG4gICAgY29uc3QgZm52T2Zmc2V0QmFzaXMgPSAweGNiZjI5Y2U0ODQyMjIzMjVuXG4gICAgY29uc3QgZm52UHJpbWUgPSAweDAwMDAwMTAwMDAwMDAxYjNuXG4gICAgY29uc3QgbWFzazY0ID0gMHhmZmZmZmZmZmZmZmZmZmZmblxuICAgIGxldCBoYXNoID0gZm52T2Zmc2V0QmFzaXNcblxuICAgIGZvciAobGV0IGluZGV4ID0gMDsgaW5kZXggPCBuYW1lLmxlbmd0aDsgaW5kZXggKz0gMSkge1xuICAgICAgaGFzaCA9IEJpZ0ludC5hc1VpbnROKDY0LCAoaGFzaCBeIEJpZ0ludChuYW1lLmNoYXJDb2RlQXQoaW5kZXgpKSkgKiBmbnZQcmltZSAmIG1hc2s2NClcbiAgICB9XG5cbiAgICAvLyBDb252ZXJ0IHVuc2lnbmVkIDY0LWJpdCBpbnRvIHNpZ25lZCBieSByZWludGVycHJldGluZyB0aGUgdG9wIGJpdC5cbiAgICBjb25zdCBzaWduZWQgPSBoYXNoID49IDB4ODAwMDAwMDAwMDAwMDAwMG4gPyBoYXNoIC0gMHgxMDAwMDAwMDAwMDAwMDAwMG4gOiBoYXNoXG5cbiAgICByZXR1cm4gc2lnbmVkLnRvU3RyaW5nKClcbiAgfVxuXG4gIC8qKlxuICAgKiBSZXNvbHZlcyB0aGUgYHBnX3RyeV9hZHZpc29yeV9sb2NrYCBwcm9iZSBjYWRlbmNlIGZvciBvbmUgYm91bmRlZCB3YWl0LlxuICAgKlxuICAgKiBgcGdfYWR2aXNvcnlfbG9ja2AgaGFzIG5vIG5hdGl2ZSB0aW1lb3V0LCBzbyBhIGJvdW5kZWQgYWNxdWlzaXRpb24gcG9sbHMuIFNjYWxpbmcgdGhlIGludGVydmFsXG4gICAqIHdpdGggdGhlIGJvdW5kIGtlZXBzIHRoZSBoaXN0b3JpY2FsIDUwbXMgY2FkZW5jZSDigJQgYW5kIGl0cyBmYXN0IGFjcXVpc2l0aW9uIOKAlCBmb3IgdGhlIHNob3J0XG4gICAqIGV4cGxpY2l0IGB0aW1lb3V0TXNgIHZhbHVlcyBjYWxsZXJzIGFscmVhZHkgcGFzcywgd2hpbGUgYSBsb25nIGZyYW1ld29yayBkZWZhdWx0IHN0YXlzXG4gICAqIHJlc3BvbnNpdmUgd2l0aG91dCB0dXJuaW5nIG9uZSBjb250ZW5kZWQgbG9jayBpbnRvIHRlbnMgb2YgdGhvdXNhbmRzIG9mIHByb2JlIHF1ZXJpZXMuXG4gICAqIEBwYXJhbSB7bnVtYmVyfSB0aW1lb3V0TXMgLSBCb3VuZGVkIHdhaXQgaW4gbWlsbGlzZWNvbmRzLlxuICAgKiBAcmV0dXJucyB7bnVtYmVyfSAtIFByb2JlIGludGVydmFsIGluIG1pbGxpc2Vjb25kcy5cbiAgICovXG4gIHN0YXRpYyBhZHZpc29yeUxvY2tQb2xsSW50ZXJ2YWxNcyh0aW1lb3V0TXMpIHtcbiAgICByZXR1cm4gTWF0aC5taW4oXG4gICAgICBNYXRoLm1heChNYXRoLmZsb29yKHRpbWVvdXRNcyAvIDEwMCksIFBHU1FMX0FEVklTT1JZX0xPQ0tfUE9MTF9NSU5fSU5URVJWQUxfTVMpLFxuICAgICAgUEdTUUxfQURWSVNPUllfTE9DS19QT0xMX01BWF9JTlRFUlZBTF9NU1xuICAgIClcbiAgfVxuXG4gIC8qKlxuICAgKiBCbG9ja3MgdW50aWwgYSBQb3N0Z3JlU1FMIHNlc3Npb24tbGV2ZWwgYWR2aXNvcnkgbG9jayBpcyBhY3F1aXJlZCBvblxuICAgKiB0aGlzIGNvbm5lY3Rpb24uIEltcGxlbWVudGVkIHZpYSBgcGdfYWR2aXNvcnlfbG9jayhiaWdpbnQpYCwgd2hpY2ggaGFzXG4gICAqIG5vIG5hdGl2ZSB0aW1lb3V0IOKAlCB0aGUgYHRpbWVvdXRNc2AgYXJndW1lbnQgaXMgZW11bGF0ZWQgYnkgcmFjaW5nIGFcbiAgICogYHBnX3RyeV9hZHZpc29yeV9sb2NrYCBwb2xsIGxvb3Agc28gY2FsbGVycyBvbiBNeVNRTCBhbmQgUG9zdGdyZXMgc2VlIHRoZVxuICAgKiBzYW1lIGNvbnRyYWN0LiBUaGUgcG9sbCBpbnRlcnZhbCBiYWNrcyBvZmYgdG8gYSBjYXAgc28gYSBsb25nIGJvdW5kZWQgd2FpdFxuICAgKiBkb2VzIG5vdCB0dXJuIG9uZSBjb250ZW5kZWQgbG9jayBpbnRvIHRob3VzYW5kcyBvZiBwcm9iZSBxdWVyaWVzLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gbmFtZSAtIExvY2sgbmFtZS5cbiAgICogQHBhcmFtIHt7dGltZW91dE1zPzogbnVtYmVyIHwgbnVsbH19IFthcmdzXSAtIE9wdGlvbmFsIHRpbWVvdXQgaW4gbWlsbGlzZWNvbmRzOyBgbnVsbGAgb3IgbmVnYXRpdmUgYmxvY2tzIGZvcmV2ZXIsIGFuZCBhbiBvbWl0dGVkIHZhbHVlIHVzZXMgdGhlIGRhdGFiYXNlJ3MgYGFkdmlzb3J5TG9ja0FjcXVpcmVUaW1lb3V0TXNgIG9yIHRoZSBmcmFtZXdvcmsgZGVmYXVsdC5cbiAgICogQHJldHVybnMge1Byb21pc2U8Ym9vbGVhbj59IC0gVHJ1ZSBpZiB0aGUgbG9jayB3YXMgYWNxdWlyZWQsIGZhbHNlIGlmIHRoZSB0aW1lb3V0IGVsYXBzZWQuXG4gICAqL1xuICBhc3luYyBfYWNxdWlyZUFkdmlzb3J5TG9jayhuYW1lLCB7dGltZW91dE1zfSA9IHt9KSB7XG4gICAgY29uc3Qga2V5ID0gdGhpcy5hZHZpc29yeUxvY2tLZXkobmFtZSlcblxuICAgIGlmICh0eXBlb2YgdGltZW91dE1zICE9PSBcIm51bWJlclwiIHx8IHRpbWVvdXRNcyA8IDApIHtcbiAgICAgIGF3YWl0IHRoaXMucXVlcnkoYFNFTEVDVCBwZ19hZHZpc29yeV9sb2NrKCR7a2V5fSlgKVxuICAgICAgcmV0dXJuIHRydWVcbiAgICB9XG5cbiAgICBjb25zdCBkZWFkbGluZSA9IERhdGUubm93KCkgKyB0aW1lb3V0TXNcbiAgICBjb25zdCBwb2xsSW50ZXJ2YWxNcyA9IFZlbG9jaW91c0RhdGFiYXNlRHJpdmVyc1Bnc3FsLmFkdmlzb3J5TG9ja1BvbGxJbnRlcnZhbE1zKHRpbWVvdXRNcylcblxuICAgIHdoaWxlICh0cnVlKSB7XG4gICAgICBpZiAoYXdhaXQgdGhpcy5fdHJ5QWNxdWlyZUFkdmlzb3J5TG9jayhuYW1lKSkgcmV0dXJuIHRydWVcbiAgICAgIGlmIChEYXRlLm5vdygpID49IGRlYWRsaW5lKSByZXR1cm4gZmFsc2VcblxuICAgICAgY29uc3QgcmVtYWluaW5nID0gZGVhZGxpbmUgLSBEYXRlLm5vdygpXG5cbiAgICAgIGF3YWl0IHdhaXQoTWF0aC5taW4ocG9sbEludGVydmFsTXMsIHJlbWFpbmluZykpXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgdHJ5IGFjcXVpcmUgYWR2aXNvcnkgbG9jay5cbiAgICogQHBhcmFtIHtzdHJpbmd9IG5hbWUgLSBMb2NrIG5hbWUuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPGJvb2xlYW4+fSAtIFRydWUgaWYgdGhlIGxvY2sgd2FzIGFjcXVpcmVkLCBmYWxzZSBpZiBpdCB3YXMgYWxyZWFkeSBoZWxkLlxuICAgKi9cbiAgYXN5bmMgX3RyeUFjcXVpcmVBZHZpc29yeUxvY2sobmFtZSkge1xuICAgIGNvbnN0IGtleSA9IHRoaXMuYWR2aXNvcnlMb2NrS2V5KG5hbWUpXG4gICAgY29uc3Qgcm93cyA9IGF3YWl0IHRoaXMucXVlcnkoYFNFTEVDVCBwZ190cnlfYWR2aXNvcnlfbG9jaygke2tleX0pIEFTIHZlbG9jaW91c19hZHZpc29yeV9sb2NrX3Jlc3VsdGApXG4gICAgY29uc3QgcmVzdWx0ID0gcm93cz8uWzBdPy52ZWxvY2lvdXNfYWR2aXNvcnlfbG9ja19yZXN1bHRcblxuICAgIHJldHVybiByZXN1bHQgPT09IHRydWUgfHwgcmVzdWx0ID09PSBcInRcIiB8fCByZXN1bHQgPT09IDEgfHwgcmVzdWx0ID09PSBcIjFcIlxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgcmVsZWFzZSBhZHZpc29yeSBsb2NrLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gbmFtZSAtIExvY2sgbmFtZS5cbiAgICogQHJldHVybnMge1Byb21pc2U8Ym9vbGVhbj59IC0gVHJ1ZSBpZiB0aGUgbG9jayB3YXMgaGVsZCBieSB0aGlzIHNlc3Npb24gYW5kIGhhcyBub3cgYmVlbiByZWxlYXNlZC5cbiAgICovXG4gIGFzeW5jIF9yZWxlYXNlQWR2aXNvcnlMb2NrKG5hbWUpIHtcbiAgICBjb25zdCBrZXkgPSB0aGlzLmFkdmlzb3J5TG9ja0tleShuYW1lKVxuICAgIGNvbnN0IHJvd3MgPSBhd2FpdCB0aGlzLnF1ZXJ5KGBTRUxFQ1QgcGdfYWR2aXNvcnlfdW5sb2NrKCR7a2V5fSkgQVMgdmVsb2Npb3VzX2Fkdmlzb3J5X2xvY2tfcmVzdWx0YClcbiAgICBjb25zdCByZXN1bHQgPSByb3dzPy5bMF0/LnZlbG9jaW91c19hZHZpc29yeV9sb2NrX3Jlc3VsdFxuXG4gICAgcmV0dXJuIHJlc3VsdCA9PT0gdHJ1ZSB8fCByZXN1bHQgPT09IFwidFwiIHx8IHJlc3VsdCA9PT0gMSB8fCByZXN1bHQgPT09IFwiMVwiXG4gIH1cblxuICAvKipcbiAgLyoqXG4gICAqIEF0dHJpYnV0ZXMgdGhlIGN1cnJlbnQgaG9sZGVyIG9mIHRoZSBuYW1lZCBhZHZpc29yeSBsb2NrIHRvIGl0cyBiYWNrZW5kXG4gICAqIHByb2Nlc3MgaWQgZnJvbSBgcGdfbG9ja3NgLCBjYXB0dXJlZCBhdCB0aGUgdGVsZW1ldHJ5IGV2ZW50IG1vbWVudFxuICAgKiAoYmVzdC1lZmZvcnQ7IHRoZSBjYWxsZXIgZ3VhcmRzIGZhaWx1cmVzKS5cbiAgICogQHBhcmFtIHtzdHJpbmd9IG5hbWUgLSBMb2NrIG5hbWUuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHN0cmluZyB8IG51bGw+fSAtIFBvc3RncmVTUUwgYmFja2VuZCBwaWQgb2YgdGhlIGhvbGRlciwgb3IgbnVsbCB3aGVuIG5vIHNlc3Npb24gaG9sZHMgdGhlIGxvY2suXG4gICAqL1xuICBhc3luYyBhZHZpc29yeUxvY2tIb2xkZXJDb25uZWN0aW9uSWQobmFtZSkge1xuICAgIGNvbnN0IGtleSA9IHRoaXMuYWR2aXNvcnlMb2NrS2V5KG5hbWUpXG4gICAgY29uc3Qgcm93cyA9IGF3YWl0IHRoaXMucXVlcnkoXG4gICAgICBgU0VMRUNUIHBpZCBGUk9NIHBnX2xvY2tzIFdIRVJFIGxvY2t0eXBlID0gJ2Fkdmlzb3J5JyBBTkQgKChjbGFzc2lkOjpiaWdpbnQgPDwgMzIpIHwgKG9iamlkOjpiaWdpbnQgJiA0Mjk0OTY3Mjk1KSkgPSAke2tleX0gTElNSVQgMWBcbiAgICApXG4gICAgY29uc3QgaG9sZGVyID0gcm93cz8uWzBdPy5waWRcblxuICAgIHJldHVybiBob2xkZXIgPT09IG51bGwgfHwgaG9sZGVyID09PSB1bmRlZmluZWQgPyBudWxsIDogU3RyaW5nKGhvbGRlcilcbiAgfVxuXG4gIC8qKlxuICAgKiBEcml2ZXItbmF0aXZlIHZpZXcgZm9yIHRoZSBiYXNlIGRyaXZlcidzIGBpc0Fkdmlzb3J5TG9ja0hlbGRgLCB3aGljaFxuICAgKiBhbnN3ZXJzIGZyb20gdGhlIHByb2Nlc3MtbG9jYWwgdGllciBmaXJzdC5cbiAgICogQHBhcmFtIHtzdHJpbmd9IG5hbWUgLSBMb2NrIG5hbWUuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPGJvb2xlYW4+fSAtIFRydWUgaWYgYW55IHNlc3Npb24gY3VycmVudGx5IGhvbGRzIHRoZSBsb2NrLlxuICAgKi9cbiAgYXN5bmMgX2lzQWR2aXNvcnlMb2NrSGVsZE5hdGl2ZShuYW1lKSB7XG4gICAgY29uc3Qga2V5ID0gdGhpcy5hZHZpc29yeUxvY2tLZXkobmFtZSlcbiAgICBjb25zdCByb3dzID0gYXdhaXQgdGhpcy5xdWVyeShcbiAgICAgIGBTRUxFQ1QgRVhJU1RTIChTRUxFQ1QgMSBGUk9NIHBnX2xvY2tzIFdIRVJFIGxvY2t0eXBlID0gJ2Fkdmlzb3J5JyBBTkQgKChjbGFzc2lkOjpiaWdpbnQgPDwgMzIpIHwgKG9iamlkOjpiaWdpbnQgJiA0Mjk0OTY3Mjk1KSkgPSAke2tleX0pIEFTIHZlbG9jaW91c19hZHZpc29yeV9sb2NrX2hlbGRgXG4gICAgKVxuICAgIGNvbnN0IGhlbGQgPSByb3dzPy5bMF0/LnZlbG9jaW91c19hZHZpc29yeV9sb2NrX2hlbGRcblxuICAgIHJldHVybiBoZWxkID09PSB0cnVlIHx8IGhlbGQgPT09IFwidFwiIHx8IGhlbGQgPT09IDEgfHwgaGVsZCA9PT0gXCIxXCJcbiAgfVxufVxuIl19