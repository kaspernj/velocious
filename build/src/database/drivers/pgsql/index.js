// @ts-check
import AlterTable from "./sql/alter-table.js";
import wait from "awaitery/build/wait.js";
import Base from "../base.js";
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiaW5kZXguanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi8uLi8uLi9zcmMvZGF0YWJhc2UvZHJpdmVycy9wZ3NxbC9pbmRleC5qcyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiQUFBQSxZQUFZO0FBRVosT0FBTyxVQUFVLE1BQU0sc0JBQXNCLENBQUE7QUFDN0MsT0FBTyxJQUFJLE1BQU0sd0JBQXdCLENBQUE7QUFDekMsT0FBTyxJQUFJLE1BQU0sWUFBWSxDQUFBO0FBQzdCLE9BQU8sRUFBRSxNQUFNLEVBQUUsS0FBSyxJQUFJLE9BQU8sRUFBRSxNQUFNLElBQUksQ0FBQTtBQUM3QyxPQUFPLGNBQWMsTUFBTSwwQkFBMEIsQ0FBQTtBQUNyRCxPQUFPLFdBQVcsTUFBTSx1QkFBdUIsQ0FBQTtBQUMvQyxPQUFPLFdBQVcsTUFBTSx1QkFBdUIsQ0FBQTtBQUMvQyxPQUFPLE1BQU0sTUFBTSxpQkFBaUIsQ0FBQTtBQUNwQyxPQUFPLEVBQUMsSUFBSSxFQUFDLE1BQU0sV0FBVyxDQUFBO0FBQzlCLE9BQU8sWUFBWSxNQUFNLHdCQUF3QixDQUFBO0FBQ2pELE9BQU8sU0FBUyxNQUFNLHFCQUFxQixDQUFBO0FBQzNDLE9BQU8sTUFBTSxNQUFNLGlCQUFpQixDQUFBO0FBQ3BDLE9BQU8sT0FBTyxNQUFNLGNBQWMsQ0FBQTtBQUNsQyxPQUFPLFdBQVcsTUFBTSxtQkFBbUIsQ0FBQTtBQUMzQyxPQUFPLFdBQVcsTUFBTSx1QkFBdUIsQ0FBQTtBQUMvQyxPQUFPLEtBQUssTUFBTSxZQUFZLENBQUE7QUFDOUIsT0FBTyxZQUFZLE1BQU0sb0JBQW9CLENBQUE7QUFDN0MsT0FBTyxNQUFNLE1BQU0saUJBQWlCLENBQUE7QUFDcEMsT0FBTyxNQUFNLE1BQU0saUJBQWlCLENBQUE7QUFFcEMsTUFBTSxpQ0FBaUMsR0FBRyxJQUFJLENBQUE7QUFFOUMsbUhBQW1IO0FBQ25ILE1BQU0sd0NBQXdDLEdBQUcsRUFBRSxDQUFBO0FBQ25ELDZIQUE2SDtBQUM3SCxN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QUssQ0FDM0Isb0lBQW9JLEdBQUcsbUNBQW1DLENBQzNLLENBQUE7UUFDRCxNQUFNLElBQUksR0FBRyxJQUFJLEVBQUUsQ0FBQyxDQUFDLENBQUMsRUFBRSw0QkFBNEIsQ0FBQTtRQUVwRCxPQUFPLElBQUksS0FBSyxJQUFJLElBQUksSUFBSSxLQUFLLEdBQUcsSUFBSSxJQUFJLEtBQUssQ0FBQyxJQUFJLElBQUksS0FBSyxHQUFHLENBQUE7SUFDcEUsQ0FBQztDQUNGIiwic291cmNlc0NvbnRlbnQiOlsiLy8gQHRzLWNoZWNrXG5cbmltcG9ydCBBbHRlclRhYmxlIGZyb20gXCIuL3NxbC9hbHRlci10YWJsZS5qc1wiXG5pbXBvcnQgd2FpdCBmcm9tIFwiYXdhaXRlcnkvYnVpbGQvd2FpdC5qc1wiXG5pbXBvcnQgQmFzZSBmcm9tIFwiLi4vYmFzZS5qc1wiXG5pbXBvcnQgeyBDbGllbnQsIHR5cGVzIGFzIHBnVHlwZXMgfSBmcm9tIFwicGdcIlxuaW1wb3J0IENyZWF0ZURhdGFiYXNlIGZyb20gXCIuL3NxbC9jcmVhdGUtZGF0YWJhc2UuanNcIlxuaW1wb3J0IENyZWF0ZUluZGV4IGZyb20gXCIuL3NxbC9jcmVhdGUtaW5kZXguanNcIlxuaW1wb3J0IENyZWF0ZVRhYmxlIGZyb20gXCIuL3NxbC9jcmVhdGUtdGFibGUuanNcIlxuaW1wb3J0IERlbGV0ZSBmcm9tIFwiLi9zcWwvZGVsZXRlLmpzXCJcbmltcG9ydCB7ZGlnZ30gZnJvbSBcImRpZ2dlcml6ZVwiXG5pbXBvcnQgRHJvcERhdGFiYXNlIGZyb20gXCIuL3NxbC9kcm9wLWRhdGFiYXNlLmpzXCJcbmltcG9ydCBEcm9wVGFibGUgZnJvbSBcIi4vc3FsL2Ryb3AtdGFibGUuanNcIlxuaW1wb3J0IEluc2VydCBmcm9tIFwiLi9zcWwvaW5zZXJ0LmpzXCJcbmltcG9ydCBPcHRpb25zIGZyb20gXCIuL29wdGlvbnMuanNcIlxuaW1wb3J0IFF1ZXJ5UGFyc2VyIGZyb20gXCIuL3F1ZXJ5LXBhcnNlci5qc1wiXG5pbXBvcnQgUmVtb3ZlSW5kZXggZnJvbSBcIi4vc3FsL3JlbW92ZS1pbmRleC5qc1wiXG5pbXBvcnQgVGFibGUgZnJvbSBcIi4vdGFibGUuanNcIlxuaW1wb3J0IFN0cnVjdHVyZVNxbCBmcm9tIFwiLi9zdHJ1Y3R1cmUtc3FsLmpzXCJcbmltcG9ydCBVcHNlcnQgZnJvbSBcIi4vc3FsL3Vwc2VydC5qc1wiXG5pbXBvcnQgVXBkYXRlIGZyb20gXCIuL3NxbC91cGRhdGUuanNcIlxuXG5jb25zdCBQR19USU1FU1RBTVBfV0lUSE9VVF9USU1FWk9ORV9PSUQgPSAxMTE0XG5cbi8qKiBTbWFsbGVzdCB3YWl0IGJldHdlZW4gYHBnX3RyeV9hZHZpc29yeV9sb2NrYCBwcm9iZXM7IHByZXNlcnZlcyB0aGUgaGlzdG9yaWNhbCA1MG1zIGNhZGVuY2UgZm9yIHNob3J0IGJvdW5kcy4gKi9cbmNvbnN0IFBHU1FMX0FEVklTT1JZX0xPQ0tfUE9MTF9NSU5fSU5URVJWQUxfTVMgPSA1MFxuLyoqIExhcmdlc3Qgd2FpdCBiZXR3ZWVuIGBwZ190cnlfYWR2aXNvcnlfbG9ja2AgcHJvYmVzOyBrZWVwcyBhIGxvbmcgYm91bmRlZCB3YWl0IGZyb20gcHJvYmluZyB0ZW5zIG9mIHRob3VzYW5kcyBvZiB0aW1lcy4gKi9cbmNvbnN0IFBHU1FMX0FEVklTT1JZX0xPQ0tfUE9MTF9NQVhfSU5URVJWQUxfTVMgPSAyMDAwXG5cbnBnVHlwZXMuc2V0VHlwZVBhcnNlcihQR19USU1FU1RBTVBfV0lUSE9VVF9USU1FWk9ORV9PSUQsICh2YWx1ZSkgPT4gbmV3IERhdGUoYCR7dmFsdWUucmVwbGFjZShcIiBcIiwgXCJUXCIpfVpgKSlcblxuZXhwb3J0IGRlZmF1bHQgY2xhc3MgVmVsb2Npb3VzRGF0YWJhc2VEcml2ZXJzUGdzcWwgZXh0ZW5kcyBCYXNle1xuICBhc3luYyBjb25uZWN0KCkge1xuICAgIGNvbnN0IGNsaWVudCA9IG5ldyBDbGllbnQodGhpcy5jb25uZWN0QXJncygpKVxuXG4gICAgdHJ5IHtcbiAgICAgIGF3YWl0IGNsaWVudC5jb25uZWN0KClcbiAgICAgIHRoaXMuY29ubmVjdGlvbiA9IGNsaWVudFxuICAgICAgYXdhaXQgdGhpcy5zZXRTZXNzaW9uVGltZXpvbmVUb1V0YygpXG4gICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgIC8vIFJlLXRocm93IHRvIHJlY292ZXIgcmVhbCBzdGFjayB0cmFjZVxuICAgICAgaWYgKGVycm9yIGluc3RhbmNlb2YgRXJyb3IpIHtcbiAgICAgICAgdGhyb3cgbmV3IEVycm9yKGBDb25uZWN0IHRvIFBvc3RncmVzIHNlcnZlciBmYWlsZWQ6ICR7ZXJyb3IubWVzc2FnZX1gLCB7Y2F1c2U6IGVycm9yfSlcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIHRocm93IG5ldyBFcnJvcihgQ29ubmVjdCB0byBQb3N0Z3JlcyBzZXJ2ZXIgZmFpbGVkOiAke2Vycm9yfWAsIHtjYXVzZTogZXJyb3J9KVxuICAgICAgfVxuICAgIH1cbiAgfVxuXG4gIGNvbm5lY3RBcmdzKCkge1xuICAgIGNvbnN0IGFyZ3MgPSB0aGlzLmdldEFyZ3MoKVxuICAgIGNvbnN0IGZvcndhcmQgPSBbXCJkYXRhYmFzZVwiLCBcImhvc3RcIiwgXCJwYXNzd29yZFwiLCBcInBvcnRcIl1cblxuICAgIC8qKlxuICAgICAqIENvbm5lY3QgYXJncy5cbiAgICAgKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSAqL1xuICAgIGNvbnN0IGNvbm5lY3RBcmdzID0ge31cblxuICAgIGZvciAoY29uc3QgZm9yd2FyZFZhbHVlIG9mIGZvcndhcmQpIHtcbiAgICAgIGlmIChmb3J3YXJkVmFsdWUgaW4gYXJncykgY29ubmVjdEFyZ3NbZm9yd2FyZFZhbHVlXSA9IGRpZ2coYXJncywgZm9yd2FyZFZhbHVlKVxuICAgIH1cblxuICAgIGlmIChcInVzZXJuYW1lXCIgaW4gYXJncykgY29ubmVjdEFyZ3NbXCJ1c2VyXCJdID0gYXJnc1tcInVzZXJuYW1lXCJdXG5cbiAgICByZXR1cm4gY29ubmVjdEFyZ3NcbiAgfVxuXG4gIGFzeW5jIF9jbG9zZSgpIHtcbiAgICBhd2FpdCB0aGlzLmNvbm5lY3Rpb24/LmVuZCgpXG4gICAgdGhpcy5jb25uZWN0aW9uID0gdW5kZWZpbmVkXG4gICAgdGhpcy5fdHJhbnNhY3Rpb25zQ291bnQgPSAwXG4gIH1cblxuICAvKipcbiAgICogUnVucyBzZXQgY29ubmVjdGlvbiBjaGVja291dCBuYW1lLlxuICAgKiBAcGFyYW0ge3N0cmluZyB8IHVuZGVmaW5lZH0gbmFtZSAtIEh1bWFuLXJlYWRhYmxlIG5hbWUgZm9yIHRoaXMgYWN0aXZlIGNoZWNrb3V0LlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyB3aGVuIGNvbXBsZXRlLlxuICAgKi9cbiAgYXN5bmMgc2V0Q29ubmVjdGlvbkNoZWNrb3V0TmFtZShuYW1lKSB7XG4gICAgaWYgKG5hbWUpIHtcbiAgICAgIGF3YWl0IHRoaXMucXVlcnkoYFNFVCBhcHBsaWNhdGlvbl9uYW1lID0gJHt0aGlzLnF1b3RlKG5hbWUpfWAsIHtsb2dOYW1lOiBcIlNldCBDb25uZWN0aW9uIENoZWNrb3V0IE5hbWVcIiwgcHJvY2Vzc0xpc3RDb21tZW50OiBmYWxzZX0pXG4gICAgfSBlbHNlIHtcbiAgICAgIGF3YWl0IHRoaXMucXVlcnkoXCJSRVNFVCBhcHBsaWNhdGlvbl9uYW1lXCIsIHtsb2dOYW1lOiBcIkNsZWFyIENvbm5lY3Rpb24gQ2hlY2tvdXQgTmFtZVwiLCBwcm9jZXNzTGlzdENvbW1lbnQ6IGZhbHNlfSlcbiAgICB9XG5cbiAgICBhd2FpdCBzdXBlci5zZXRDb25uZWN0aW9uQ2hlY2tvdXROYW1lKG5hbWUpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBjbGVhciBjb25uZWN0aW9uIGNoZWNrb3V0IG5hbWUuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIHdoZW4gY29tcGxldGUuXG4gICAqL1xuICBhc3luYyBjbGVhckNvbm5lY3Rpb25DaGVja291dE5hbWUoKSB7XG4gICAgYXdhaXQgdGhpcy5xdWVyeShcIlJFU0VUIGFwcGxpY2F0aW9uX25hbWVcIiwge2xvZ05hbWU6IFwiQ2xlYXIgQ29ubmVjdGlvbiBDaGVja291dCBOYW1lXCIsIHByb2Nlc3NMaXN0Q29tbWVudDogZmFsc2V9KVxuICAgIGF3YWl0IHN1cGVyLmNsZWFyQ29ubmVjdGlvbkNoZWNrb3V0TmFtZSgpXG4gIH1cblxuICAvKipcbiAgICogU2V0cyB0aGUgZGF0YWJhc2Ugc2Vzc2lvbiB0aW1lem9uZSB0byBVVEMgc28gYmFyZSB0aW1lc3RhbXAgbGl0ZXJhbHMgc3RvcmUgVVRDIGluc3RhbnRzLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyB3aGVuIGNvbXBsZXRlLlxuICAgKi9cbiAgYXN5bmMgc2V0U2Vzc2lvblRpbWV6b25lVG9VdGMoKSB7XG4gICAgYXdhaXQgdGhpcy5xdWVyeShcIlNFVCBUSU1FIFpPTkUgJ1VUQydcIiwge2xvZ05hbWU6IFwiU2V0IFNlc3Npb24gVGltZSBab25lXCIsIHByb2Nlc3NMaXN0Q29tbWVudDogZmFsc2V9KVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgYWx0ZXIgdGFibGUgc3Fscy5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi8uLi90YWJsZS1kYXRhL2luZGV4LmpzXCIpLmRlZmF1bHR9IHRhYmxlRGF0YSAtIFRhYmxlIGRhdGEuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHN0cmluZ1tdPn0gLSBSZXNvbHZlcyB3aXRoIFNRTCBzdGF0ZW1lbnRzLlxuICAgKi9cbiAgYXN5bmMgYWx0ZXJUYWJsZVNRTHModGFibGVEYXRhKSB7XG4gICAgY29uc3QgYWx0ZXJBcmdzID0ge3RhYmxlRGF0YSwgZHJpdmVyOiB0aGlzfVxuICAgIGNvbnN0IGFsdGVyVGFibGUgPSBuZXcgQWx0ZXJUYWJsZShhbHRlckFyZ3MpXG5cbiAgICByZXR1cm4gYXdhaXQgYWx0ZXJUYWJsZS50b1NRTHMoKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgY3JlYXRlIGRhdGFiYXNlIHNxbC5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGRhdGFiYXNlTmFtZSAtIERhdGFiYXNlIG5hbWUuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBbYXJnc10gLSBPcHRpb25zIG9iamVjdC5cbiAgICogQHBhcmFtIHtib29sZWFufSBbYXJncy5pZk5vdEV4aXN0c10gLSBXaGV0aGVyIGlmIG5vdCBleGlzdHMuXG4gICAqIEByZXR1cm5zIHtzdHJpbmdbXX0gLSBTUUwgc3RhdGVtZW50cy5cbiAgICovXG4gIGNyZWF0ZURhdGFiYXNlU3FsKGRhdGFiYXNlTmFtZSwgYXJncykge1xuICAgIGNvbnN0IGNyZWF0ZUFyZ3MgPSBPYmplY3QuYXNzaWduKHtkYXRhYmFzZU5hbWUsIGRyaXZlcjogdGhpc30sIGFyZ3MpXG4gICAgY29uc3QgY3JlYXRlRGF0YWJhc2UgPSBuZXcgQ3JlYXRlRGF0YWJhc2UoY3JlYXRlQXJncylcblxuICAgIHJldHVybiBjcmVhdGVEYXRhYmFzZS50b1NxbCgpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBkcm9wIGRhdGFiYXNlIHNxbC5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGRhdGFiYXNlTmFtZSAtIERhdGFiYXNlIG5hbWUuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBbYXJnc10gLSBPcHRpb25zIG9iamVjdC5cbiAgICogQHBhcmFtIHtib29sZWFufSBbYXJncy5pZkV4aXN0c10gLSBXaGV0aGVyIGlmIGV4aXN0cy5cbiAgICogQHJldHVybnMge3N0cmluZ1tdfSAtIFNRTCBzdGF0ZW1lbnRzLlxuICAgKi9cbiAgZHJvcERhdGFiYXNlU3FsKGRhdGFiYXNlTmFtZSwgYXJncykge1xuICAgIGNvbnN0IGRyb3BBcmdzID0gT2JqZWN0LmFzc2lnbih7ZGF0YWJhc2VOYW1lLCBkcml2ZXI6IHRoaXN9LCBhcmdzKVxuICAgIGNvbnN0IGRyb3BEYXRhYmFzZSA9IG5ldyBEcm9wRGF0YWJhc2UoZHJvcEFyZ3MpXG5cbiAgICByZXR1cm4gZHJvcERhdGFiYXNlLnRvU3FsKClcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGNyZWF0ZSBpbmRleCBzcWxzLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL2Jhc2UuanNcIikuQ3JlYXRlSW5kZXhTcWxBcmdzfSBpbmRleERhdGEgLSBJbmRleCBkYXRhLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxzdHJpbmdbXT59IC0gUmVzb2x2ZXMgd2l0aCBTUUwgc3RhdGVtZW50cy5cbiAgICovXG4gIGFzeW5jIGNyZWF0ZUluZGV4U1FMcyhpbmRleERhdGEpIHtcbiAgICBjb25zdCBjcmVhdGVBcmdzID0gT2JqZWN0LmFzc2lnbih7ZHJpdmVyOiB0aGlzfSwgaW5kZXhEYXRhKVxuICAgIGNvbnN0IGNyZWF0ZUluZGV4ID0gbmV3IENyZWF0ZUluZGV4KGNyZWF0ZUFyZ3MpXG5cbiAgICByZXR1cm4gYXdhaXQgY3JlYXRlSW5kZXgudG9TUUxzKClcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHJlbW92ZSBpbmRleCBzcWxzLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL2Jhc2UuanNcIikuUmVtb3ZlSW5kZXhTcWxBcmdzfSBpbmRleERhdGEgLSBJbmRleCBkYXRhLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxzdHJpbmdbXT59IC0gUmVzb2x2ZXMgd2l0aCBTUUwgc3RhdGVtZW50cy5cbiAgICovXG4gIGFzeW5jIHJlbW92ZUluZGV4U1FMcyhpbmRleERhdGEpIHtcbiAgICBjb25zdCByZW1vdmVBcmdzID0gT2JqZWN0LmFzc2lnbih7ZHJpdmVyOiB0aGlzfSwgaW5kZXhEYXRhKVxuICAgIGNvbnN0IHJlbW92ZUluZGV4ID0gbmV3IFJlbW92ZUluZGV4KHJlbW92ZUFyZ3MpXG5cbiAgICByZXR1cm4gYXdhaXQgcmVtb3ZlSW5kZXgudG9TUUxzKClcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGNyZWF0ZSB0YWJsZSBzcWwuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vLi4vdGFibGUtZGF0YS9pbmRleC5qc1wiKS5kZWZhdWx0fSB0YWJsZURhdGEgLSBUYWJsZSBkYXRhLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxzdHJpbmdbXT59IC0gUmVzb2x2ZXMgd2l0aCBTUUwgc3RhdGVtZW50cy5cbiAgICovXG4gIGFzeW5jIGNyZWF0ZVRhYmxlU3FsKHRhYmxlRGF0YSkge1xuICAgIGNvbnN0IGNyZWF0ZUFyZ3MgPSB7dGFibGVEYXRhLCBkcml2ZXI6IHRoaXMsIGluZGV4SW5DcmVhdGVUYWJsZTogZmFsc2V9XG4gICAgY29uc3QgY3JlYXRlVGFibGUgPSBuZXcgQ3JlYXRlVGFibGUoY3JlYXRlQXJncylcblxuICAgIHJldHVybiBhd2FpdCBjcmVhdGVUYWJsZS50b1NxbCgpXG4gIH1cblxuICBhc3luYyBjdXJyZW50RGF0YWJhc2UoKSB7XG4gICAgY29uc3Qgcm93cyA9IGF3YWl0IHRoaXMucXVlcnkoXCJTRUxFQ1QgQ1VSUkVOVF9EQVRBQkFTRSgpIEFTIGRiX25hbWVcIilcblxuICAgIHJldHVybiBkaWdnKHJvd3MsIDAsIFwiZGJfbmFtZVwiKVxuICB9XG5cbiAgYXN5bmMgZGlzYWJsZUZvcmVpZ25LZXlzKCkge1xuICAgIGF3YWl0IHRoaXMucXVlcnkoXCJTRVQgc2Vzc2lvbl9yZXBsaWNhdGlvbl9yb2xlID0gJ3JlcGxpY2EnXCIpXG4gIH1cblxuICBhc3luYyBlbmFibGVGb3JlaWduS2V5cygpIHtcbiAgICBhd2FpdCB0aGlzLnF1ZXJ5KFwiU0VUIHNlc3Npb25fcmVwbGljYXRpb25fcm9sZSA9ICdvcmlnaW4nXCIpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBkcm9wIHRhYmxlIHNxbHMuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSB0YWJsZU5hbWUgLSBUYWJsZSBuYW1lLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL2Jhc2UuanNcIikuRHJvcFRhYmxlU3FsQXJnc1R5cGV9IFthcmdzXSAtIE9wdGlvbnMgb2JqZWN0LlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxzdHJpbmdbXT59IC0gUmVzb2x2ZXMgd2l0aCBTUUwgc3RhdGVtZW50cy5cbiAgICovXG4gIGFzeW5jIGRyb3BUYWJsZVNRTHModGFibGVOYW1lLCBhcmdzID0ge30pIHtcbiAgICBjb25zdCBkcm9wQXJncyA9IE9iamVjdC5hc3NpZ24oe3RhYmxlTmFtZSwgZHJpdmVyOiB0aGlzfSwgYXJncylcbiAgICBjb25zdCBkcm9wVGFibGUgPSBuZXcgRHJvcFRhYmxlKGRyb3BBcmdzKVxuXG4gICAgcmV0dXJuIGF3YWl0IGRyb3BUYWJsZS50b1NRTHMoKVxuICB9XG5cbiAgZ2V0VHlwZSgpIHsgcmV0dXJuIFwicGdzcWxcIiB9XG5cbiAgLyoqXG4gICAqIFdoZXRoZXIgdGhpcyBkcml2ZXIgc3VwcG9ydHMgY29tYmluaW5nIG9wZXJhdGlvbnMgaW50byBvbmUgYnVsayBgQUxURVJgLlxuICAgKiBAcmV0dXJucyB7Ym9vbGVhbn0gLSBXaGV0aGVyIGJ1bGsgYWx0ZXIgaXMgc3VwcG9ydGVkLlxuICAgKi9cbiAgc3VwcG9ydHNCdWxrQWx0ZXIoKSB7IHJldHVybiB0cnVlIH1cblxuICAvKipcbiAgICogV2hldGhlciB0aGUgYnVsayBgQUxURVJgIGNhbiBhbHNvIGNhcnJ5IGBBREQgSU5ERVhgIGNsYXVzZXMuIFBvc3RncmVTUUwnc1xuICAgKiBgQUxURVIgVEFCTEVgIGNhbm5vdCBleHByZXNzIGluZGV4IGNyZWF0aW9uLCBzbyBpbmRleGVzIHN0YXkgc3RhbmRhbG9uZS5cbiAgICogQHJldHVybnMge2Jvb2xlYW59IC0gV2hldGhlciBpbmRleGVzIGNhbiBiZSBhZGRlZCBpbnNpZGUgYSBidWxrIGFsdGVyLlxuICAgKi9cbiAgc3VwcG9ydHNCdWxrQWx0ZXJJbmRleGVzKCkgeyByZXR1cm4gZmFsc2UgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHF1ZXJ5IGFjdHVhbC5cbiAgICogQHBhcmFtIHtzdHJpbmd9IHNxbCAtIFNRTCBzdHJpbmcuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPGltcG9ydChcIi4uL2Jhc2UuanNcIikuUXVlcnlSZXN1bHRUeXBlPn0gLSBSZXNvbHZlcyB3aXRoIHRoZSBxdWVyeSBhY3R1YWwuXG4gICAqL1xuICBhc3luYyBfcXVlcnlBY3R1YWwoc3FsKSB7XG4gICAgbGV0IHJlc3BvbnNlXG5cbiAgICBpZiAoIXRoaXMuY29ubmVjdGlvbikgYXdhaXQgdGhpcy5jb25uZWN0KClcbiAgICBpZiAoIXRoaXMuY29ubmVjdGlvbikgdGhyb3cgbmV3IEVycm9yKFwiUG9zdGdyZVNRTCBjb25uZWN0aW9uIGZhaWxlZCB0byBpbml0aWFsaXplXCIpXG5cbiAgICB0cnkge1xuICAgICAgcmVzcG9uc2UgPSBhd2FpdCB0aGlzLmNvbm5lY3Rpb24ucXVlcnkoc3FsKVxuICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICBpZiAoZXJyb3IgaW5zdGFuY2VvZiBFcnJvcikge1xuICAgICAgICB0aHJvdyBuZXcgRXJyb3IoYFF1ZXJ5IGZhaWxlZDogJHtlcnJvci5tZXNzYWdlfSB3aXRoIFNRTDogJHtzcWx9YCwge2NhdXNlOiBlcnJvcn0pXG4gICAgICB9IGVsc2Uge1xuICAgICAgICB0aHJvdyBuZXcgRXJyb3IoYFF1ZXJ5IGZhaWxlZDogJHtlcnJvcn0gd2l0aCBTUUw6ICR7c3FsfWAsIHtjYXVzZTogZXJyb3J9KVxuICAgICAgfVxuICAgIH1cblxuICAgIHJldHVybiByZXNwb25zZS5yb3dzXG4gIH1cblxuICAvKipcbiAgICogRXhlY3V0ZXMgYSBtdXRhdGlvbiB3aXRoIGFmZmVjdGVkLXJvdyBtZXRhZGF0YS5cbiAgICogQHBhcmFtIHtzdHJpbmd9IHNxbCAtIE11dGF0aW9uIFNRTC5cbiAgICogQHJldHVybnMge1Byb21pc2U8bnVtYmVyPn0gLSBBZmZlY3RlZCByb3cgY291bnQuXG4gICAqL1xuICBhc3luYyBfYWZmZWN0ZWRSb3dzQWN0dWFsKHNxbCkge1xuICAgIGlmICghdGhpcy5jb25uZWN0aW9uKSBhd2FpdCB0aGlzLmNvbm5lY3QoKVxuICAgIGlmICghdGhpcy5jb25uZWN0aW9uKSB0aHJvdyBuZXcgRXJyb3IoXCJQb3N0Z3JlU1FMIGNvbm5lY3Rpb24gZmFpbGVkIHRvIGluaXRpYWxpemVcIilcbiAgICBjb25zdCByZXNwb25zZSA9IGF3YWl0IHRoaXMuY29ubmVjdGlvbi5xdWVyeShzcWwpXG4gICAgcmV0dXJuIHJlc3BvbnNlLnJvd0NvdW50IHx8IDBcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHF1ZXJ5IHRvIHNxbC5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi8uLi9xdWVyeS9pbmRleC5qc1wiKS5kZWZhdWx0fSBxdWVyeSAtIFF1ZXJ5IGluc3RhbmNlLlxuICAgKiBAcmV0dXJucyB7c3RyaW5nfSAtIFNRTCBzdHJpbmcuXG4gICAqL1xuICBxdWVyeVRvU3FsKHF1ZXJ5KSB7IHJldHVybiBuZXcgUXVlcnlQYXJzZXIoe3F1ZXJ5fSkudG9TcWwoKSB9XG4gIHNob3VsZFNldEF1dG9JbmNyZW1lbnRXaGVuUHJpbWFyeUtleSgpIHsgcmV0dXJuIHRydWUgfVxuICBzdXBwb3J0c0RlZmF1bHRQcmltYXJ5S2V5VVVJRCgpIHsgcmV0dXJuIHRydWUgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGNvbnZlcnQgdmFsdWUuXG4gICAqIEBwYXJhbSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59IHZhbHVlIC0gVmFsdWUgdG8gdXNlLlxuICAgKiBAcmV0dXJucyB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59IC0gVGhlIGNvbnZlcnRlZCB2YWx1ZS5cbiAgICovXG4gIF9jb252ZXJ0VmFsdWUodmFsdWUpIHtcbiAgICBpZiAodHlwZW9mIHZhbHVlID09PSBcImJvb2xlYW5cIikge1xuICAgICAgcmV0dXJuIHZhbHVlID8gXCJ0cnVlXCIgOiBcImZhbHNlXCJcbiAgICB9XG5cbiAgICByZXR1cm4gc3VwZXIuX2NvbnZlcnRWYWx1ZSh2YWx1ZSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGVzY2FwZS5cbiAgICogQHBhcmFtIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gdmFsdWUgLSBWYWx1ZSB0byB1c2UuXG4gICAqIEByZXR1cm5zIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gLSBUaGUgZXNjYXBlLlxuICAgKi9cbiAgZXNjYXBlKHZhbHVlKSB7XG4gICAgaWYgKCF0aGlzLmNvbm5lY3Rpb24pIHRocm93IG5ldyBFcnJvcihcIkNhbid0IGVzY2FwZSBiZWZvcmUgY29ubmVjdGVkXCIpXG4gICAgaWYgKHR5cGVvZiB2YWx1ZSA9PT0gXCJudW1iZXJcIikgcmV0dXJuIHZhbHVlXG5cbiAgICBjb25zdCBlc2NhcGVkVmFsdWVXaXRoUXVvdGVzID0gdGhpcy5jb25uZWN0aW9uLmVzY2FwZUxpdGVyYWwodGhpcy5fY29udmVydFZhbHVlKHZhbHVlKSlcblxuICAgIHJldHVybiBlc2NhcGVkVmFsdWVXaXRoUXVvdGVzLnNsaWNlKDEsIGVzY2FwZWRWYWx1ZVdpdGhRdW90ZXMubGVuZ3RoIC0gMSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHF1b3RlLlxuICAgKiBAcGFyYW0ge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSB2YWx1ZSAtIFZhbHVlIHRvIHVzZS5cbiAgICogQHJldHVybnMge3N0cmluZyB8IG51bWJlcn0gLSBUaGUgcXVvdGVkIHZhbHVlLlxuICAgKi9cbiAgcXVvdGUodmFsdWUpIHtcbiAgICBpZiAoIXRoaXMuY29ubmVjdGlvbikgdGhyb3cgbmV3IEVycm9yKFwiQ2FuJ3QgZXNjYXBlIGJlZm9yZSBjb25uZWN0ZWRcIilcbiAgICBpZiAodHlwZW9mIHZhbHVlID09PSBcIm51bWJlclwiKSByZXR1cm4gdmFsdWVcblxuICAgIHJldHVybiB0aGlzLmNvbm5lY3Rpb24uZXNjYXBlTGl0ZXJhbCh0aGlzLl9jb252ZXJ0VmFsdWUodmFsdWUpKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZGVsZXRlIHNxbC5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9iYXNlLmpzXCIpLkRlbGV0ZVNxbEFyZ3NUeXBlfSBhcmdzIC0gT3B0aW9ucyBvYmplY3QuXG4gICAqIEByZXR1cm5zIHtzdHJpbmd9IC0gU1FMIHN0cmluZy5cbiAgICovXG4gIGRlbGV0ZVNxbCh7dGFibGVOYW1lLCBjb25kaXRpb25zfSkge1xuICAgIGNvbnN0IGRlbGV0ZUluc3RydWN0aW9uID0gbmV3IERlbGV0ZSh7Y29uZGl0aW9ucywgZHJpdmVyOiB0aGlzLCB0YWJsZU5hbWV9KVxuXG4gICAgcmV0dXJuIGRlbGV0ZUluc3RydWN0aW9uLnRvU3FsKClcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGluc2VydCBzcWwuXG4gICAqIEBhYnN0cmFjdFxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL2Jhc2UuanNcIikuSW5zZXJ0U3FsQXJnc1R5cGV9IGFyZ3MgLSBPcHRpb25zIG9iamVjdC5cbiAgICogQHJldHVybnMge3N0cmluZ30gLSBTUUwgc3RyaW5nLlxuICAgKi9cbiAgaW5zZXJ0U3FsKGFyZ3MpIHtcbiAgICBjb25zdCBpbnNlcnRBcmdzID0gT2JqZWN0LmFzc2lnbih7ZHJpdmVyOiB0aGlzfSwgYXJncylcbiAgICBjb25zdCBpbnNlcnQgPSBuZXcgSW5zZXJ0KGluc2VydEFyZ3MpXG5cbiAgICByZXR1cm4gaW5zZXJ0LnRvU3FsKClcbiAgfVxuXG4gIGFzeW5jIGdldFRhYmxlcygpIHtcbiAgICByZXR1cm4gYXdhaXQgdGhpcy5fY2FjaGVkU2NoZW1hTWV0YWRhdGEoXCJ0YWJsZXNcIiwgYXN5bmMgKCkgPT4ge1xuICAgICAgY29uc3QgcmVzdWx0ID0gYXdhaXQgdGhpcy5xdWVyeShcIlNFTEVDVCAqIEZST00gaW5mb3JtYXRpb25fc2NoZW1hLnRhYmxlcyBXSEVSRSB0YWJsZV9jYXRhbG9nID0gQ1VSUkVOVF9EQVRBQkFTRSgpIEFORCB0YWJsZV9zY2hlbWEgPSAncHVibGljJ1wiKVxuICAgICAgY29uc3QgdGFibGVzID0gW11cblxuICAgICAgZm9yIChjb25zdCByb3cgb2YgcmVzdWx0KSB7XG4gICAgICAgIGNvbnN0IHRhYmxlID0gbmV3IFRhYmxlKHRoaXMsIC8qKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgc3RyaW5nPn0gKi8gKHJvdykpXG5cbiAgICAgICAgdGFibGVzLnB1c2godGFibGUpXG4gICAgICB9XG5cbiAgICAgIHJldHVybiB0YWJsZXNcbiAgICB9KVxuICB9XG5cbiAgLyoqXG4gICAqIFRydW5jYXRlcyBhbGwgZWxpZ2libGUgdGFibGVzIGluIG9uZSBQb3N0Z3JlU1FMIHJlcXVlc3QuXG4gICAqIEBwYXJhbSB7QXJyYXk8aW1wb3J0KFwiLi4vYmFzZS10YWJsZS5qc1wiKS5kZWZhdWx0Pn0gdGFibGVzIC0gRWxpZ2libGUgdGFibGVzLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyB3aGVuIHRoZSBiYXRjaCBjb21wbGV0ZXMuXG4gICAqL1xuICBhc3luYyB0cnVuY2F0ZVRhYmxlcyh0YWJsZXMpIHtcbiAgICBjb25zdCBxdW90ZWRUYWJsZXMgPSB0YWJsZXMubWFwKCh0YWJsZSkgPT4gdGhpcy5xdW90ZVRhYmxlKHRhYmxlLmdldE5hbWUoKSkpXG5cbiAgICBhd2FpdCB0aGlzLnF1ZXJ5KGBUUlVOQ0FURSBUQUJMRSAke3F1b3RlZFRhYmxlcy5qb2luKFwiLCBcIil9IENBU0NBREVgKVxuICB9XG5cbiAgYXN5bmMgbGFzdEluc2VydElEKG9wdGlvbnMgPSB7fSkge1xuICAgIGNvbnN0IHJlc3VsdCA9IGF3YWl0IHRoaXMucXVlcnkoXCJTRUxFQ1QgTEFTVFZBTCgpIEFTIGxhc3RfaW5zZXJ0X2lkXCIsIG9wdGlvbnMpXG5cbiAgICByZXR1cm4gZGlnZyhyZXN1bHQsIDAsIFwibGFzdF9pbnNlcnRfaWRcIilcbiAgfVxuXG4gIG9wdGlvbnMoKSB7XG4gICAgaWYgKCF0aGlzLl9vcHRpb25zKSB0aGlzLl9vcHRpb25zID0gbmV3IE9wdGlvbnModGhpcylcblxuICAgIHJldHVybiB0aGlzLl9vcHRpb25zXG4gIH1cblxuICBhc3luYyBfc3RhcnRUcmFuc2FjdGlvbkFjdGlvbihvcHRpb25zID0ge30pIHtcbiAgICBhd2FpdCB0aGlzLnF1ZXJ5KFwiU1RBUlQgVFJBTlNBQ1RJT05cIiwgb3B0aW9ucylcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHVwZGF0ZSBzcWwuXG4gICAqIEBhYnN0cmFjdFxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL2Jhc2UuanNcIikuVXBkYXRlU3FsQXJnc1R5cGV9IGFyZ3MgLSBPcHRpb25zIG9iamVjdC5cbiAgICogQHJldHVybnMge3N0cmluZ30gLSBTUUwgc3RyaW5nLlxuICAgKi9cbiAgdXBkYXRlU3FsKHtjb25kaXRpb25zLCBkYXRhLCB0YWJsZU5hbWV9KSB7XG4gICAgY29uc3QgdXBkYXRlID0gbmV3IFVwZGF0ZSh7Y29uZGl0aW9ucywgZGF0YSwgZHJpdmVyOiB0aGlzLCB0YWJsZU5hbWV9KVxuXG4gICAgcmV0dXJuIHVwZGF0ZS50b1NxbCgpXG4gIH1cblxuICAvKipcbiAgICogUnVucyB1cHNlcnQgc3FsLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL2Jhc2UuanNcIikuVXBzZXJ0U3FsQXJnc1R5cGV9IGFyZ3MgLSBPcHRpb25zIG9iamVjdC5cbiAgICogQHJldHVybnMge3N0cmluZ30gLSBTUUwgc3RyaW5nLlxuICAgKi9cbiAgdXBzZXJ0U3FsKGFyZ3MpIHtcbiAgICBjb25zdCB1cHNlcnQgPSBuZXcgVXBzZXJ0KHsuLi5hcmdzLCBkcml2ZXI6IHRoaXN9KVxuXG4gICAgcmV0dXJuIHVwc2VydC50b1NxbCgpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBzdHJ1Y3R1cmUgc3FsLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxzdHJpbmcgfCBudWxsPn0gLSBSZXNvbHZlcyB3aXRoIFNRTCBzdHJpbmcuXG4gICAqL1xuICBhc3luYyBzdHJ1Y3R1cmVTcWwoKSB7XG4gICAgcmV0dXJuIGF3YWl0IHRoaXMuX2NhY2hlZFNjaGVtYU1ldGFkYXRhKFwic3RydWN0dXJlU3FsXCIsIGFzeW5jICgpID0+IGF3YWl0IG5ldyBTdHJ1Y3R1cmVTcWwoe2RyaXZlcjogdGhpc30pLnRvU3FsKCkpXG4gIH1cblxuICAvKipcbiAgICogRGV0ZXJtaW5pc3RpY2FsbHkgaGFzaGVzIGEgbG9jayBuYW1lIGludG8gYSBzaWduZWQgNjQtYml0IGludGVnZXIgc28gaXRcbiAgICogY2FuIGJlIHBhc3NlZCB0byBgcGdfYWR2aXNvcnlfbG9jayhiaWdpbnQpYC4gV2UgdXNlIGEgZmFzdCA2NC1iaXQgRk5WLTFhXG4gICAqIGhhc2gg4oCUIHRoZSBleGFjdCB2YWx1ZSBkb2VzIG5vdCBtYXR0ZXIsIG9ubHkgdGhhdCB0aGUgc2FtZSBuYW1lIGFsd2F5c1xuICAgKiBwcm9kdWNlcyB0aGUgc2FtZSBrZXkgd2l0aGluIGEgcHJvY2VzcyBBTkQgYWNyb3NzIHByb2Nlc3NlcyB0aGF0IHNoYXJlXG4gICAqIHRoZSBzYW1lIGltcGxlbWVudGF0aW9uLiBSZXR1cm5zIHRoZSB2YWx1ZSBhcyBhIHN0cmluZyBzbyB0aGUgY2FsbGVyXG4gICAqIGNhbiBpbnRlcnBvbGF0ZSBpdCBpbnRvIFNRTCB3aXRob3V0IGxvc2luZyBwcmVjaXNpb24gdG8gSlMgbnVtYmVyXG4gICAqIGNvZXJjaW9uLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gbmFtZSAtIExvY2sgbmFtZS5cbiAgICogQHJldHVybnMge3N0cmluZ30gLSBTaWduZWQgNjQtYml0IGludGVnZXIgYXMgYSBkZWNpbWFsIHN0cmluZy5cbiAgICovXG4gIGFkdmlzb3J5TG9ja0tleShuYW1lKSB7XG4gICAgLy8gRk5WLTFhIDY0LWJpdCwgY29tcHV0ZWQgd2l0aCBCaWdJbnQgc28gd2UgZG9uJ3QgbG9zZSBwcmVjaXNpb24uXG4gICAgY29uc3QgZm52T2Zmc2V0QmFzaXMgPSAweGNiZjI5Y2U0ODQyMjIzMjVuXG4gICAgY29uc3QgZm52UHJpbWUgPSAweDAwMDAwMTAwMDAwMDAxYjNuXG4gICAgY29uc3QgbWFzazY0ID0gMHhmZmZmZmZmZmZmZmZmZmZmblxuICAgIGxldCBoYXNoID0gZm52T2Zmc2V0QmFzaXNcblxuICAgIGZvciAobGV0IGluZGV4ID0gMDsgaW5kZXggPCBuYW1lLmxlbmd0aDsgaW5kZXggKz0gMSkge1xuICAgICAgaGFzaCA9IEJpZ0ludC5hc1VpbnROKDY0LCAoaGFzaCBeIEJpZ0ludChuYW1lLmNoYXJDb2RlQXQoaW5kZXgpKSkgKiBmbnZQcmltZSAmIG1hc2s2NClcbiAgICB9XG5cbiAgICAvLyBDb252ZXJ0IHVuc2lnbmVkIDY0LWJpdCBpbnRvIHNpZ25lZCBieSByZWludGVycHJldGluZyB0aGUgdG9wIGJpdC5cbiAgICBjb25zdCBzaWduZWQgPSBoYXNoID49IDB4ODAwMDAwMDAwMDAwMDAwMG4gPyBoYXNoIC0gMHgxMDAwMDAwMDAwMDAwMDAwMG4gOiBoYXNoXG5cbiAgICByZXR1cm4gc2lnbmVkLnRvU3RyaW5nKClcbiAgfVxuXG4gIC8qKlxuICAgKiBSZXNvbHZlcyB0aGUgYHBnX3RyeV9hZHZpc29yeV9sb2NrYCBwcm9iZSBjYWRlbmNlIGZvciBvbmUgYm91bmRlZCB3YWl0LlxuICAgKlxuICAgKiBgcGdfYWR2aXNvcnlfbG9ja2AgaGFzIG5vIG5hdGl2ZSB0aW1lb3V0LCBzbyBhIGJvdW5kZWQgYWNxdWlzaXRpb24gcG9sbHMuIFNjYWxpbmcgdGhlIGludGVydmFsXG4gICAqIHdpdGggdGhlIGJvdW5kIGtlZXBzIHRoZSBoaXN0b3JpY2FsIDUwbXMgY2FkZW5jZSDigJQgYW5kIGl0cyBmYXN0IGFjcXVpc2l0aW9uIOKAlCBmb3IgdGhlIHNob3J0XG4gICAqIGV4cGxpY2l0IGB0aW1lb3V0TXNgIHZhbHVlcyBjYWxsZXJzIGFscmVhZHkgcGFzcywgd2hpbGUgYSBsb25nIGZyYW1ld29yayBkZWZhdWx0IHN0YXlzXG4gICAqIHJlc3BvbnNpdmUgd2l0aG91dCB0dXJuaW5nIG9uZSBjb250ZW5kZWQgbG9jayBpbnRvIHRlbnMgb2YgdGhvdXNhbmRzIG9mIHByb2JlIHF1ZXJpZXMuXG4gICAqIEBwYXJhbSB7bnVtYmVyfSB0aW1lb3V0TXMgLSBCb3VuZGVkIHdhaXQgaW4gbWlsbGlzZWNvbmRzLlxuICAgKiBAcmV0dXJucyB7bnVtYmVyfSAtIFByb2JlIGludGVydmFsIGluIG1pbGxpc2Vjb25kcy5cbiAgICovXG4gIHN0YXRpYyBhZHZpc29yeUxvY2tQb2xsSW50ZXJ2YWxNcyh0aW1lb3V0TXMpIHtcbiAgICByZXR1cm4gTWF0aC5taW4oXG4gICAgICBNYXRoLm1heChNYXRoLmZsb29yKHRpbWVvdXRNcyAvIDEwMCksIFBHU1FMX0FEVklTT1JZX0xPQ0tfUE9MTF9NSU5fSU5URVJWQUxfTVMpLFxuICAgICAgUEdTUUxfQURWSVNPUllfTE9DS19QT0xMX01BWF9JTlRFUlZBTF9NU1xuICAgIClcbiAgfVxuXG4gIC8qKlxuICAgKiBCbG9ja3MgdW50aWwgYSBQb3N0Z3JlU1FMIHNlc3Npb24tbGV2ZWwgYWR2aXNvcnkgbG9jayBpcyBhY3F1aXJlZCBvblxuICAgKiB0aGlzIGNvbm5lY3Rpb24uIEltcGxlbWVudGVkIHZpYSBgcGdfYWR2aXNvcnlfbG9jayhiaWdpbnQpYCwgd2hpY2ggaGFzXG4gICAqIG5vIG5hdGl2ZSB0aW1lb3V0IOKAlCB0aGUgYHRpbWVvdXRNc2AgYXJndW1lbnQgaXMgZW11bGF0ZWQgYnkgcmFjaW5nIGFcbiAgICogYHBnX3RyeV9hZHZpc29yeV9sb2NrYCBwb2xsIGxvb3Agc28gY2FsbGVycyBvbiBNeVNRTCBhbmQgUG9zdGdyZXMgc2VlIHRoZVxuICAgKiBzYW1lIGNvbnRyYWN0LiBUaGUgcG9sbCBpbnRlcnZhbCBiYWNrcyBvZmYgdG8gYSBjYXAgc28gYSBsb25nIGJvdW5kZWQgd2FpdFxuICAgKiBkb2VzIG5vdCB0dXJuIG9uZSBjb250ZW5kZWQgbG9jayBpbnRvIHRob3VzYW5kcyBvZiBwcm9iZSBxdWVyaWVzLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gbmFtZSAtIExvY2sgbmFtZS5cbiAgICogQHBhcmFtIHt7dGltZW91dE1zPzogbnVtYmVyIHwgbnVsbH19IFthcmdzXSAtIE9wdGlvbmFsIHRpbWVvdXQgaW4gbWlsbGlzZWNvbmRzOyBgbnVsbGAgb3IgbmVnYXRpdmUgYmxvY2tzIGZvcmV2ZXIsIGFuZCBhbiBvbWl0dGVkIHZhbHVlIHVzZXMgdGhlIGRhdGFiYXNlJ3MgYGFkdmlzb3J5TG9ja0FjcXVpcmVUaW1lb3V0TXNgIG9yIHRoZSBmcmFtZXdvcmsgZGVmYXVsdC5cbiAgICogQHJldHVybnMge1Byb21pc2U8Ym9vbGVhbj59IC0gVHJ1ZSBpZiB0aGUgbG9jayB3YXMgYWNxdWlyZWQsIGZhbHNlIGlmIHRoZSB0aW1lb3V0IGVsYXBzZWQuXG4gICAqL1xuICBhc3luYyBfYWNxdWlyZUFkdmlzb3J5TG9jayhuYW1lLCB7dGltZW91dE1zfSA9IHt9KSB7XG4gICAgY29uc3Qga2V5ID0gdGhpcy5hZHZpc29yeUxvY2tLZXkobmFtZSlcblxuICAgIGlmICh0eXBlb2YgdGltZW91dE1zICE9PSBcIm51bWJlclwiIHx8IHRpbWVvdXRNcyA8IDApIHtcbiAgICAgIGF3YWl0IHRoaXMucXVlcnkoYFNFTEVDVCBwZ19hZHZpc29yeV9sb2NrKCR7a2V5fSlgKVxuICAgICAgcmV0dXJuIHRydWVcbiAgICB9XG5cbiAgICBjb25zdCBkZWFkbGluZSA9IERhdGUubm93KCkgKyB0aW1lb3V0TXNcbiAgICBjb25zdCBwb2xsSW50ZXJ2YWxNcyA9IFZlbG9jaW91c0RhdGFiYXNlRHJpdmVyc1Bnc3FsLmFkdmlzb3J5TG9ja1BvbGxJbnRlcnZhbE1zKHRpbWVvdXRNcylcblxuICAgIHdoaWxlICh0cnVlKSB7XG4gICAgICBpZiAoYXdhaXQgdGhpcy5fdHJ5QWNxdWlyZUFkdmlzb3J5TG9jayhuYW1lKSkgcmV0dXJuIHRydWVcbiAgICAgIGlmIChEYXRlLm5vdygpID49IGRlYWRsaW5lKSByZXR1cm4gZmFsc2VcblxuICAgICAgY29uc3QgcmVtYWluaW5nID0gZGVhZGxpbmUgLSBEYXRlLm5vdygpXG5cbiAgICAgIGF3YWl0IHdhaXQoTWF0aC5taW4ocG9sbEludGVydmFsTXMsIHJlbWFpbmluZykpXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgdHJ5IGFjcXVpcmUgYWR2aXNvcnkgbG9jay5cbiAgICogQHBhcmFtIHtzdHJpbmd9IG5hbWUgLSBMb2NrIG5hbWUuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPGJvb2xlYW4+fSAtIFRydWUgaWYgdGhlIGxvY2sgd2FzIGFjcXVpcmVkLCBmYWxzZSBpZiBpdCB3YXMgYWxyZWFkeSBoZWxkLlxuICAgKi9cbiAgYXN5bmMgX3RyeUFjcXVpcmVBZHZpc29yeUxvY2sobmFtZSkge1xuICAgIGNvbnN0IGtleSA9IHRoaXMuYWR2aXNvcnlMb2NrS2V5KG5hbWUpXG4gICAgY29uc3Qgcm93cyA9IGF3YWl0IHRoaXMucXVlcnkoYFNFTEVDVCBwZ190cnlfYWR2aXNvcnlfbG9jaygke2tleX0pIEFTIHZlbG9jaW91c19hZHZpc29yeV9sb2NrX3Jlc3VsdGApXG4gICAgY29uc3QgcmVzdWx0ID0gcm93cz8uWzBdPy52ZWxvY2lvdXNfYWR2aXNvcnlfbG9ja19yZXN1bHRcblxuICAgIHJldHVybiByZXN1bHQgPT09IHRydWUgfHwgcmVzdWx0ID09PSBcInRcIiB8fCByZXN1bHQgPT09IDEgfHwgcmVzdWx0ID09PSBcIjFcIlxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgcmVsZWFzZSBhZHZpc29yeSBsb2NrLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gbmFtZSAtIExvY2sgbmFtZS5cbiAgICogQHJldHVybnMge1Byb21pc2U8Ym9vbGVhbj59IC0gVHJ1ZSBpZiB0aGUgbG9jayB3YXMgaGVsZCBieSB0aGlzIHNlc3Npb24gYW5kIGhhcyBub3cgYmVlbiByZWxlYXNlZC5cbiAgICovXG4gIGFzeW5jIF9yZWxlYXNlQWR2aXNvcnlMb2NrKG5hbWUpIHtcbiAgICBjb25zdCBrZXkgPSB0aGlzLmFkdmlzb3J5TG9ja0tleShuYW1lKVxuICAgIGNvbnN0IHJvd3MgPSBhd2FpdCB0aGlzLnF1ZXJ5KGBTRUxFQ1QgcGdfYWR2aXNvcnlfdW5sb2NrKCR7a2V5fSkgQVMgdmVsb2Npb3VzX2Fkdmlzb3J5X2xvY2tfcmVzdWx0YClcbiAgICBjb25zdCByZXN1bHQgPSByb3dzPy5bMF0/LnZlbG9jaW91c19hZHZpc29yeV9sb2NrX3Jlc3VsdFxuXG4gICAgcmV0dXJuIHJlc3VsdCA9PT0gdHJ1ZSB8fCByZXN1bHQgPT09IFwidFwiIHx8IHJlc3VsdCA9PT0gMSB8fCByZXN1bHQgPT09IFwiMVwiXG4gIH1cblxuICAvKipcbiAgLyoqXG4gICAqIEF0dHJpYnV0ZXMgdGhlIGN1cnJlbnQgaG9sZGVyIG9mIHRoZSBuYW1lZCBhZHZpc29yeSBsb2NrIHRvIGl0cyBiYWNrZW5kXG4gICAqIHByb2Nlc3MgaWQgZnJvbSBgcGdfbG9ja3NgLCBjYXB0dXJlZCBhdCB0aGUgdGVsZW1ldHJ5IGV2ZW50IG1vbWVudFxuICAgKiAoYmVzdC1lZmZvcnQ7IHRoZSBjYWxsZXIgZ3VhcmRzIGZhaWx1cmVzKS5cbiAgICogQHBhcmFtIHtzdHJpbmd9IG5hbWUgLSBMb2NrIG5hbWUuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHN0cmluZyB8IG51bGw+fSAtIFBvc3RncmVTUUwgYmFja2VuZCBwaWQgb2YgdGhlIGhvbGRlciwgb3IgbnVsbCB3aGVuIG5vIHNlc3Npb24gaG9sZHMgdGhlIGxvY2suXG4gICAqL1xuICBhc3luYyBhZHZpc29yeUxvY2tIb2xkZXJDb25uZWN0aW9uSWQobmFtZSkge1xuICAgIGNvbnN0IGtleSA9IHRoaXMuYWR2aXNvcnlMb2NrS2V5KG5hbWUpXG4gICAgY29uc3Qgcm93cyA9IGF3YWl0IHRoaXMucXVlcnkoXG4gICAgICBgU0VMRUNUIHBpZCBGUk9NIHBnX2xvY2tzIFdIRVJFIGxvY2t0eXBlID0gJ2Fkdmlzb3J5JyBBTkQgKChjbGFzc2lkOjpiaWdpbnQgPDwgMzIpIHwgKG9iamlkOjpiaWdpbnQgJiA0Mjk0OTY3Mjk1KSkgPSAke2tleX0gTElNSVQgMWBcbiAgICApXG4gICAgY29uc3QgaG9sZGVyID0gcm93cz8uWzBdPy5waWRcblxuICAgIHJldHVybiBob2xkZXIgPT09IG51bGwgfHwgaG9sZGVyID09PSB1bmRlZmluZWQgPyBudWxsIDogU3RyaW5nKGhvbGRlcilcbiAgfVxuXG4gIC8qKlxuICAgKiBEcml2ZXItbmF0aXZlIHZpZXcgZm9yIHRoZSBiYXNlIGRyaXZlcidzIGBpc0Fkdmlzb3J5TG9ja0hlbGRgLCB3aGljaFxuICAgKiBhbnN3ZXJzIGZyb20gdGhlIHByb2Nlc3MtbG9jYWwgdGllciBmaXJzdC5cbiAgICogQHBhcmFtIHtzdHJpbmd9IG5hbWUgLSBMb2NrIG5hbWUuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPGJvb2xlYW4+fSAtIFRydWUgaWYgYW55IHNlc3Npb24gY3VycmVudGx5IGhvbGRzIHRoZSBsb2NrLlxuICAgKi9cbiAgYXN5bmMgX2lzQWR2aXNvcnlMb2NrSGVsZE5hdGl2ZShuYW1lKSB7XG4gICAgY29uc3Qga2V5ID0gdGhpcy5hZHZpc29yeUxvY2tLZXkobmFtZSlcbiAgICBjb25zdCByb3dzID0gYXdhaXQgdGhpcy5xdWVyeShcbiAgICAgIGBTRUxFQ1QgRVhJU1RTIChTRUxFQ1QgMSBGUk9NIHBnX2xvY2tzIFdIRVJFIGxvY2t0eXBlID0gJ2Fkdmlzb3J5JyBBTkQgKChjbGFzc2lkOjpiaWdpbnQgPDwgMzIpIHwgKG9iamlkOjpiaWdpbnQgJiA0Mjk0OTY3Mjk1KSkgPSAke2tleX0pIEFTIHZlbG9jaW91c19hZHZpc29yeV9sb2NrX2hlbGRgXG4gICAgKVxuICAgIGNvbnN0IGhlbGQgPSByb3dzPy5bMF0/LnZlbG9jaW91c19hZHZpc29yeV9sb2NrX2hlbGRcblxuICAgIHJldHVybiBoZWxkID09PSB0cnVlIHx8IGhlbGQgPT09IFwidFwiIHx8IGhlbGQgPT09IDEgfHwgaGVsZCA9PT0gXCIxXCJcbiAgfVxufVxuIl19