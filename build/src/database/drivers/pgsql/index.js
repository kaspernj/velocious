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
     * Runs is advisory lock held.
     * @param {string} name - Lock name.
     * @returns {Promise<boolean>} - True if any session currently holds the lock.
     */
    async isAdvisoryLockHeld(name) {
        const key = this.advisoryLockKey(name);
        const rows = await this.query(`SELECT EXISTS (SELECT 1 FROM pg_locks WHERE locktype = 'advisory' AND ((classid::bigint << 32) | (objid::bigint & 4294967295)) = ${key}) AS velocious_advisory_lock_held`);
        const held = rows?.[0]?.velocious_advisory_lock_held;
        return held === true || held === "t" || held === 1 || held === "1";
    }
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiaW5kZXguanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi8uLi8uLi9zcmMvZGF0YWJhc2UvZHJpdmVycy9wZ3NxbC9pbmRleC5qcyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiQUFBQSxZQUFZO0FBRVosT0FBTyxVQUFVLE1BQU0sc0JBQXNCLENBQUE7QUFDN0MsT0FBTyxJQUFJLE1BQU0sd0JBQXdCLENBQUE7QUFDekMsT0FBTyxJQUFJLE1BQU0sWUFBWSxDQUFBO0FBQzdCLE9BQU8sRUFBRSxNQUFNLEVBQUUsS0FBSyxJQUFJLE9BQU8sRUFBRSxNQUFNLElBQUksQ0FBQTtBQUM3QyxPQUFPLGNBQWMsTUFBTSwwQkFBMEIsQ0FBQTtBQUNyRCxPQUFPLFdBQVcsTUFBTSx1QkFBdUIsQ0FBQTtBQUMvQyxPQUFPLFdBQVcsTUFBTSx1QkFBdUIsQ0FBQTtBQUMvQyxPQUFPLE1BQU0sTUFBTSxpQkFBaUIsQ0FBQTtBQUNwQyxPQUFPLEVBQUMsSUFBSSxFQUFDLE1BQU0sV0FBVyxDQUFBO0FBQzlCLE9BQU8sWUFBWSxNQUFNLHdCQUF3QixDQUFBO0FBQ2pELE9BQU8sU0FBUyxNQUFNLHFCQUFxQixDQUFBO0FBQzNDLE9BQU8sTUFBTSxNQUFNLGlCQUFpQixDQUFBO0FBQ3BDLE9BQU8sT0FBTyxNQUFNLGNBQWMsQ0FBQTtBQUNsQyxPQUFPLFdBQVcsTUFBTSxtQkFBbUIsQ0FBQTtBQUMzQyxPQUFPLFdBQVcsTUFBTSx1QkFBdUIsQ0FBQTtBQUMvQyxPQUFPLEtBQUssTUFBTSxZQUFZLENBQUE7QUFDOUIsT0FBTyxZQUFZLE1BQU0sb0JBQW9CLENBQUE7QUFDN0MsT0FBTyxNQUFNLE1BQU0saUJBQWlCLENBQUE7QUFDcEMsT0FBTyxNQUFNLE1BQU0saUJBQWlCLENBQUE7QUFFcEMsTUFBTSxpQ0FBaUMsR0FBRyxJQUFJLENBQUE7QUFFOUMsbUhBQW1IO0FBQ25ILE1BQU0sd0NBQXdDLEdBQUcsRUFBRSxDQUFBO0FBQ25ELDZIQUE2SDtBQUM3SCxN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LENBQzNCLG9JQUFvSSxHQUFHLG1DQUFtQyxDQUMzSyxDQUFBO1FBQ0QsTUFBTSxJQUFJLEdBQUcsSUFBSSxFQUFFLENBQUMsQ0FBQyxDQUFDLEVBQUUsNEJBQTRCLENBQUE7UUFFcEQsT0FBTyxJQUFJLEtBQUssSUFBSSxJQUFJLElBQUksS0FBSyxHQUFHLElBQUksSUFBSSxLQUFLLENBQUMsSUFBSSxJQUFJLEtBQUssR0FBRyxDQUFBO0lBQ3BFLENBQUM7Q0FDRiIsInNvdXJjZXNDb250ZW50IjpbIi8vIEB0cy1jaGVja1xuXG5pbXBvcnQgQWx0ZXJUYWJsZSBmcm9tIFwiLi9zcWwvYWx0ZXItdGFibGUuanNcIlxuaW1wb3J0IHdhaXQgZnJvbSBcImF3YWl0ZXJ5L2J1aWxkL3dhaXQuanNcIlxuaW1wb3J0IEJhc2UgZnJvbSBcIi4uL2Jhc2UuanNcIlxuaW1wb3J0IHsgQ2xpZW50LCB0eXBlcyBhcyBwZ1R5cGVzIH0gZnJvbSBcInBnXCJcbmltcG9ydCBDcmVhdGVEYXRhYmFzZSBmcm9tIFwiLi9zcWwvY3JlYXRlLWRhdGFiYXNlLmpzXCJcbmltcG9ydCBDcmVhdGVJbmRleCBmcm9tIFwiLi9zcWwvY3JlYXRlLWluZGV4LmpzXCJcbmltcG9ydCBDcmVhdGVUYWJsZSBmcm9tIFwiLi9zcWwvY3JlYXRlLXRhYmxlLmpzXCJcbmltcG9ydCBEZWxldGUgZnJvbSBcIi4vc3FsL2RlbGV0ZS5qc1wiXG5pbXBvcnQge2RpZ2d9IGZyb20gXCJkaWdnZXJpemVcIlxuaW1wb3J0IERyb3BEYXRhYmFzZSBmcm9tIFwiLi9zcWwvZHJvcC1kYXRhYmFzZS5qc1wiXG5pbXBvcnQgRHJvcFRhYmxlIGZyb20gXCIuL3NxbC9kcm9wLXRhYmxlLmpzXCJcbmltcG9ydCBJbnNlcnQgZnJvbSBcIi4vc3FsL2luc2VydC5qc1wiXG5pbXBvcnQgT3B0aW9ucyBmcm9tIFwiLi9vcHRpb25zLmpzXCJcbmltcG9ydCBRdWVyeVBhcnNlciBmcm9tIFwiLi9xdWVyeS1wYXJzZXIuanNcIlxuaW1wb3J0IFJlbW92ZUluZGV4IGZyb20gXCIuL3NxbC9yZW1vdmUtaW5kZXguanNcIlxuaW1wb3J0IFRhYmxlIGZyb20gXCIuL3RhYmxlLmpzXCJcbmltcG9ydCBTdHJ1Y3R1cmVTcWwgZnJvbSBcIi4vc3RydWN0dXJlLXNxbC5qc1wiXG5pbXBvcnQgVXBzZXJ0IGZyb20gXCIuL3NxbC91cHNlcnQuanNcIlxuaW1wb3J0IFVwZGF0ZSBmcm9tIFwiLi9zcWwvdXBkYXRlLmpzXCJcblxuY29uc3QgUEdfVElNRVNUQU1QX1dJVEhPVVRfVElNRVpPTkVfT0lEID0gMTExNFxuXG4vKiogU21hbGxlc3Qgd2FpdCBiZXR3ZWVuIGBwZ190cnlfYWR2aXNvcnlfbG9ja2AgcHJvYmVzOyBwcmVzZXJ2ZXMgdGhlIGhpc3RvcmljYWwgNTBtcyBjYWRlbmNlIGZvciBzaG9ydCBib3VuZHMuICovXG5jb25zdCBQR1NRTF9BRFZJU09SWV9MT0NLX1BPTExfTUlOX0lOVEVSVkFMX01TID0gNTBcbi8qKiBMYXJnZXN0IHdhaXQgYmV0d2VlbiBgcGdfdHJ5X2Fkdmlzb3J5X2xvY2tgIHByb2Jlczsga2VlcHMgYSBsb25nIGJvdW5kZWQgd2FpdCBmcm9tIHByb2JpbmcgdGVucyBvZiB0aG91c2FuZHMgb2YgdGltZXMuICovXG5jb25zdCBQR1NRTF9BRFZJU09SWV9MT0NLX1BPTExfTUFYX0lOVEVSVkFMX01TID0gMjAwMFxuXG5wZ1R5cGVzLnNldFR5cGVQYXJzZXIoUEdfVElNRVNUQU1QX1dJVEhPVVRfVElNRVpPTkVfT0lELCAodmFsdWUpID0+IG5ldyBEYXRlKGAke3ZhbHVlLnJlcGxhY2UoXCIgXCIsIFwiVFwiKX1aYCkpXG5cbmV4cG9ydCBkZWZhdWx0IGNsYXNzIFZlbG9jaW91c0RhdGFiYXNlRHJpdmVyc1Bnc3FsIGV4dGVuZHMgQmFzZXtcbiAgYXN5bmMgY29ubmVjdCgpIHtcbiAgICBjb25zdCBjbGllbnQgPSBuZXcgQ2xpZW50KHRoaXMuY29ubmVjdEFyZ3MoKSlcblxuICAgIHRyeSB7XG4gICAgICBhd2FpdCBjbGllbnQuY29ubmVjdCgpXG4gICAgICB0aGlzLmNvbm5lY3Rpb24gPSBjbGllbnRcbiAgICAgIGF3YWl0IHRoaXMuc2V0U2Vzc2lvblRpbWV6b25lVG9VdGMoKVxuICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICAvLyBSZS10aHJvdyB0byByZWNvdmVyIHJlYWwgc3RhY2sgdHJhY2VcbiAgICAgIGlmIChlcnJvciBpbnN0YW5jZW9mIEVycm9yKSB7XG4gICAgICAgIHRocm93IG5ldyBFcnJvcihgQ29ubmVjdCB0byBQb3N0Z3JlcyBzZXJ2ZXIgZmFpbGVkOiAke2Vycm9yLm1lc3NhZ2V9YCwge2NhdXNlOiBlcnJvcn0pXG4gICAgICB9IGVsc2Uge1xuICAgICAgICB0aHJvdyBuZXcgRXJyb3IoYENvbm5lY3QgdG8gUG9zdGdyZXMgc2VydmVyIGZhaWxlZDogJHtlcnJvcn1gLCB7Y2F1c2U6IGVycm9yfSlcbiAgICAgIH1cbiAgICB9XG4gIH1cblxuICBjb25uZWN0QXJncygpIHtcbiAgICBjb25zdCBhcmdzID0gdGhpcy5nZXRBcmdzKClcbiAgICBjb25zdCBmb3J3YXJkID0gW1wiZGF0YWJhc2VcIiwgXCJob3N0XCIsIFwicGFzc3dvcmRcIiwgXCJwb3J0XCJdXG5cbiAgICAvKipcbiAgICAgKiBDb25uZWN0IGFyZ3MuXG4gICAgICogQHR5cGUge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gKi9cbiAgICBjb25zdCBjb25uZWN0QXJncyA9IHt9XG5cbiAgICBmb3IgKGNvbnN0IGZvcndhcmRWYWx1ZSBvZiBmb3J3YXJkKSB7XG4gICAgICBpZiAoZm9yd2FyZFZhbHVlIGluIGFyZ3MpIGNvbm5lY3RBcmdzW2ZvcndhcmRWYWx1ZV0gPSBkaWdnKGFyZ3MsIGZvcndhcmRWYWx1ZSlcbiAgICB9XG5cbiAgICBpZiAoXCJ1c2VybmFtZVwiIGluIGFyZ3MpIGNvbm5lY3RBcmdzW1widXNlclwiXSA9IGFyZ3NbXCJ1c2VybmFtZVwiXVxuXG4gICAgcmV0dXJuIGNvbm5lY3RBcmdzXG4gIH1cblxuICBhc3luYyBfY2xvc2UoKSB7XG4gICAgYXdhaXQgdGhpcy5jb25uZWN0aW9uPy5lbmQoKVxuICAgIHRoaXMuY29ubmVjdGlvbiA9IHVuZGVmaW5lZFxuICAgIHRoaXMuX3RyYW5zYWN0aW9uc0NvdW50ID0gMFxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgc2V0IGNvbm5lY3Rpb24gY2hlY2tvdXQgbmFtZS5cbiAgICogQHBhcmFtIHtzdHJpbmcgfCB1bmRlZmluZWR9IG5hbWUgLSBIdW1hbi1yZWFkYWJsZSBuYW1lIGZvciB0aGlzIGFjdGl2ZSBjaGVja291dC5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgd2hlbiBjb21wbGV0ZS5cbiAgICovXG4gIGFzeW5jIHNldENvbm5lY3Rpb25DaGVja291dE5hbWUobmFtZSkge1xuICAgIGlmIChuYW1lKSB7XG4gICAgICBhd2FpdCB0aGlzLnF1ZXJ5KGBTRVQgYXBwbGljYXRpb25fbmFtZSA9ICR7dGhpcy5xdW90ZShuYW1lKX1gLCB7bG9nTmFtZTogXCJTZXQgQ29ubmVjdGlvbiBDaGVja291dCBOYW1lXCIsIHByb2Nlc3NMaXN0Q29tbWVudDogZmFsc2V9KVxuICAgIH0gZWxzZSB7XG4gICAgICBhd2FpdCB0aGlzLnF1ZXJ5KFwiUkVTRVQgYXBwbGljYXRpb25fbmFtZVwiLCB7bG9nTmFtZTogXCJDbGVhciBDb25uZWN0aW9uIENoZWNrb3V0IE5hbWVcIiwgcHJvY2Vzc0xpc3RDb21tZW50OiBmYWxzZX0pXG4gICAgfVxuXG4gICAgYXdhaXQgc3VwZXIuc2V0Q29ubmVjdGlvbkNoZWNrb3V0TmFtZShuYW1lKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgY2xlYXIgY29ubmVjdGlvbiBjaGVja291dCBuYW1lLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyB3aGVuIGNvbXBsZXRlLlxuICAgKi9cbiAgYXN5bmMgY2xlYXJDb25uZWN0aW9uQ2hlY2tvdXROYW1lKCkge1xuICAgIGF3YWl0IHRoaXMucXVlcnkoXCJSRVNFVCBhcHBsaWNhdGlvbl9uYW1lXCIsIHtsb2dOYW1lOiBcIkNsZWFyIENvbm5lY3Rpb24gQ2hlY2tvdXQgTmFtZVwiLCBwcm9jZXNzTGlzdENvbW1lbnQ6IGZhbHNlfSlcbiAgICBhd2FpdCBzdXBlci5jbGVhckNvbm5lY3Rpb25DaGVja291dE5hbWUoKVxuICB9XG5cbiAgLyoqXG4gICAqIFNldHMgdGhlIGRhdGFiYXNlIHNlc3Npb24gdGltZXpvbmUgdG8gVVRDIHNvIGJhcmUgdGltZXN0YW1wIGxpdGVyYWxzIHN0b3JlIFVUQyBpbnN0YW50cy5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgd2hlbiBjb21wbGV0ZS5cbiAgICovXG4gIGFzeW5jIHNldFNlc3Npb25UaW1lem9uZVRvVXRjKCkge1xuICAgIGF3YWl0IHRoaXMucXVlcnkoXCJTRVQgVElNRSBaT05FICdVVEMnXCIsIHtsb2dOYW1lOiBcIlNldCBTZXNzaW9uIFRpbWUgWm9uZVwiLCBwcm9jZXNzTGlzdENvbW1lbnQ6IGZhbHNlfSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGFsdGVyIHRhYmxlIHNxbHMuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vLi4vdGFibGUtZGF0YS9pbmRleC5qc1wiKS5kZWZhdWx0fSB0YWJsZURhdGEgLSBUYWJsZSBkYXRhLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxzdHJpbmdbXT59IC0gUmVzb2x2ZXMgd2l0aCBTUUwgc3RhdGVtZW50cy5cbiAgICovXG4gIGFzeW5jIGFsdGVyVGFibGVTUUxzKHRhYmxlRGF0YSkge1xuICAgIGNvbnN0IGFsdGVyQXJncyA9IHt0YWJsZURhdGEsIGRyaXZlcjogdGhpc31cbiAgICBjb25zdCBhbHRlclRhYmxlID0gbmV3IEFsdGVyVGFibGUoYWx0ZXJBcmdzKVxuXG4gICAgcmV0dXJuIGF3YWl0IGFsdGVyVGFibGUudG9TUUxzKClcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGNyZWF0ZSBkYXRhYmFzZSBzcWwuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBkYXRhYmFzZU5hbWUgLSBEYXRhYmFzZSBuYW1lLlxuICAgKiBAcGFyYW0ge29iamVjdH0gW2FyZ3NdIC0gT3B0aW9ucyBvYmplY3QuXG4gICAqIEBwYXJhbSB7Ym9vbGVhbn0gW2FyZ3MuaWZOb3RFeGlzdHNdIC0gV2hldGhlciBpZiBub3QgZXhpc3RzLlxuICAgKiBAcmV0dXJucyB7c3RyaW5nW119IC0gU1FMIHN0YXRlbWVudHMuXG4gICAqL1xuICBjcmVhdGVEYXRhYmFzZVNxbChkYXRhYmFzZU5hbWUsIGFyZ3MpIHtcbiAgICBjb25zdCBjcmVhdGVBcmdzID0gT2JqZWN0LmFzc2lnbih7ZGF0YWJhc2VOYW1lLCBkcml2ZXI6IHRoaXN9LCBhcmdzKVxuICAgIGNvbnN0IGNyZWF0ZURhdGFiYXNlID0gbmV3IENyZWF0ZURhdGFiYXNlKGNyZWF0ZUFyZ3MpXG5cbiAgICByZXR1cm4gY3JlYXRlRGF0YWJhc2UudG9TcWwoKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZHJvcCBkYXRhYmFzZSBzcWwuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBkYXRhYmFzZU5hbWUgLSBEYXRhYmFzZSBuYW1lLlxuICAgKiBAcGFyYW0ge29iamVjdH0gW2FyZ3NdIC0gT3B0aW9ucyBvYmplY3QuXG4gICAqIEBwYXJhbSB7Ym9vbGVhbn0gW2FyZ3MuaWZFeGlzdHNdIC0gV2hldGhlciBpZiBleGlzdHMuXG4gICAqIEByZXR1cm5zIHtzdHJpbmdbXX0gLSBTUUwgc3RhdGVtZW50cy5cbiAgICovXG4gIGRyb3BEYXRhYmFzZVNxbChkYXRhYmFzZU5hbWUsIGFyZ3MpIHtcbiAgICBjb25zdCBkcm9wQXJncyA9IE9iamVjdC5hc3NpZ24oe2RhdGFiYXNlTmFtZSwgZHJpdmVyOiB0aGlzfSwgYXJncylcbiAgICBjb25zdCBkcm9wRGF0YWJhc2UgPSBuZXcgRHJvcERhdGFiYXNlKGRyb3BBcmdzKVxuXG4gICAgcmV0dXJuIGRyb3BEYXRhYmFzZS50b1NxbCgpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBjcmVhdGUgaW5kZXggc3Fscy5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9iYXNlLmpzXCIpLkNyZWF0ZUluZGV4U3FsQXJnc30gaW5kZXhEYXRhIC0gSW5kZXggZGF0YS5cbiAgICogQHJldHVybnMge1Byb21pc2U8c3RyaW5nW10+fSAtIFJlc29sdmVzIHdpdGggU1FMIHN0YXRlbWVudHMuXG4gICAqL1xuICBhc3luYyBjcmVhdGVJbmRleFNRTHMoaW5kZXhEYXRhKSB7XG4gICAgY29uc3QgY3JlYXRlQXJncyA9IE9iamVjdC5hc3NpZ24oe2RyaXZlcjogdGhpc30sIGluZGV4RGF0YSlcbiAgICBjb25zdCBjcmVhdGVJbmRleCA9IG5ldyBDcmVhdGVJbmRleChjcmVhdGVBcmdzKVxuXG4gICAgcmV0dXJuIGF3YWl0IGNyZWF0ZUluZGV4LnRvU1FMcygpXG4gIH1cblxuICAvKipcbiAgICogUnVucyByZW1vdmUgaW5kZXggc3Fscy5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9iYXNlLmpzXCIpLlJlbW92ZUluZGV4U3FsQXJnc30gaW5kZXhEYXRhIC0gSW5kZXggZGF0YS5cbiAgICogQHJldHVybnMge1Byb21pc2U8c3RyaW5nW10+fSAtIFJlc29sdmVzIHdpdGggU1FMIHN0YXRlbWVudHMuXG4gICAqL1xuICBhc3luYyByZW1vdmVJbmRleFNRTHMoaW5kZXhEYXRhKSB7XG4gICAgY29uc3QgcmVtb3ZlQXJncyA9IE9iamVjdC5hc3NpZ24oe2RyaXZlcjogdGhpc30sIGluZGV4RGF0YSlcbiAgICBjb25zdCByZW1vdmVJbmRleCA9IG5ldyBSZW1vdmVJbmRleChyZW1vdmVBcmdzKVxuXG4gICAgcmV0dXJuIGF3YWl0IHJlbW92ZUluZGV4LnRvU1FMcygpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBjcmVhdGUgdGFibGUgc3FsLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uLy4uL3RhYmxlLWRhdGEvaW5kZXguanNcIikuZGVmYXVsdH0gdGFibGVEYXRhIC0gVGFibGUgZGF0YS5cbiAgICogQHJldHVybnMge1Byb21pc2U8c3RyaW5nW10+fSAtIFJlc29sdmVzIHdpdGggU1FMIHN0YXRlbWVudHMuXG4gICAqL1xuICBhc3luYyBjcmVhdGVUYWJsZVNxbCh0YWJsZURhdGEpIHtcbiAgICBjb25zdCBjcmVhdGVBcmdzID0ge3RhYmxlRGF0YSwgZHJpdmVyOiB0aGlzLCBpbmRleEluQ3JlYXRlVGFibGU6IGZhbHNlfVxuICAgIGNvbnN0IGNyZWF0ZVRhYmxlID0gbmV3IENyZWF0ZVRhYmxlKGNyZWF0ZUFyZ3MpXG5cbiAgICByZXR1cm4gYXdhaXQgY3JlYXRlVGFibGUudG9TcWwoKVxuICB9XG5cbiAgYXN5bmMgY3VycmVudERhdGFiYXNlKCkge1xuICAgIGNvbnN0IHJvd3MgPSBhd2FpdCB0aGlzLnF1ZXJ5KFwiU0VMRUNUIENVUlJFTlRfREFUQUJBU0UoKSBBUyBkYl9uYW1lXCIpXG5cbiAgICByZXR1cm4gZGlnZyhyb3dzLCAwLCBcImRiX25hbWVcIilcbiAgfVxuXG4gIGFzeW5jIGRpc2FibGVGb3JlaWduS2V5cygpIHtcbiAgICBhd2FpdCB0aGlzLnF1ZXJ5KFwiU0VUIHNlc3Npb25fcmVwbGljYXRpb25fcm9sZSA9ICdyZXBsaWNhJ1wiKVxuICB9XG5cbiAgYXN5bmMgZW5hYmxlRm9yZWlnbktleXMoKSB7XG4gICAgYXdhaXQgdGhpcy5xdWVyeShcIlNFVCBzZXNzaW9uX3JlcGxpY2F0aW9uX3JvbGUgPSAnb3JpZ2luJ1wiKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZHJvcCB0YWJsZSBzcWxzLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gdGFibGVOYW1lIC0gVGFibGUgbmFtZS5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9iYXNlLmpzXCIpLkRyb3BUYWJsZVNxbEFyZ3NUeXBlfSBbYXJnc10gLSBPcHRpb25zIG9iamVjdC5cbiAgICogQHJldHVybnMge1Byb21pc2U8c3RyaW5nW10+fSAtIFJlc29sdmVzIHdpdGggU1FMIHN0YXRlbWVudHMuXG4gICAqL1xuICBhc3luYyBkcm9wVGFibGVTUUxzKHRhYmxlTmFtZSwgYXJncyA9IHt9KSB7XG4gICAgY29uc3QgZHJvcEFyZ3MgPSBPYmplY3QuYXNzaWduKHt0YWJsZU5hbWUsIGRyaXZlcjogdGhpc30sIGFyZ3MpXG4gICAgY29uc3QgZHJvcFRhYmxlID0gbmV3IERyb3BUYWJsZShkcm9wQXJncylcblxuICAgIHJldHVybiBhd2FpdCBkcm9wVGFibGUudG9TUUxzKClcbiAgfVxuXG4gIGdldFR5cGUoKSB7IHJldHVybiBcInBnc3FsXCIgfVxuXG4gIC8qKlxuICAgKiBXaGV0aGVyIHRoaXMgZHJpdmVyIHN1cHBvcnRzIGNvbWJpbmluZyBvcGVyYXRpb25zIGludG8gb25lIGJ1bGsgYEFMVEVSYC5cbiAgICogQHJldHVybnMge2Jvb2xlYW59IC0gV2hldGhlciBidWxrIGFsdGVyIGlzIHN1cHBvcnRlZC5cbiAgICovXG4gIHN1cHBvcnRzQnVsa0FsdGVyKCkgeyByZXR1cm4gdHJ1ZSB9XG5cbiAgLyoqXG4gICAqIFdoZXRoZXIgdGhlIGJ1bGsgYEFMVEVSYCBjYW4gYWxzbyBjYXJyeSBgQUREIElOREVYYCBjbGF1c2VzLiBQb3N0Z3JlU1FMJ3NcbiAgICogYEFMVEVSIFRBQkxFYCBjYW5ub3QgZXhwcmVzcyBpbmRleCBjcmVhdGlvbiwgc28gaW5kZXhlcyBzdGF5IHN0YW5kYWxvbmUuXG4gICAqIEByZXR1cm5zIHtib29sZWFufSAtIFdoZXRoZXIgaW5kZXhlcyBjYW4gYmUgYWRkZWQgaW5zaWRlIGEgYnVsayBhbHRlci5cbiAgICovXG4gIHN1cHBvcnRzQnVsa0FsdGVySW5kZXhlcygpIHsgcmV0dXJuIGZhbHNlIH1cblxuICAvKipcbiAgICogUnVucyBxdWVyeSBhY3R1YWwuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBzcWwgLSBTUUwgc3RyaW5nLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxpbXBvcnQoXCIuLi9iYXNlLmpzXCIpLlF1ZXJ5UmVzdWx0VHlwZT59IC0gUmVzb2x2ZXMgd2l0aCB0aGUgcXVlcnkgYWN0dWFsLlxuICAgKi9cbiAgYXN5bmMgX3F1ZXJ5QWN0dWFsKHNxbCkge1xuICAgIGxldCByZXNwb25zZVxuXG4gICAgaWYgKCF0aGlzLmNvbm5lY3Rpb24pIGF3YWl0IHRoaXMuY29ubmVjdCgpXG4gICAgaWYgKCF0aGlzLmNvbm5lY3Rpb24pIHRocm93IG5ldyBFcnJvcihcIlBvc3RncmVTUUwgY29ubmVjdGlvbiBmYWlsZWQgdG8gaW5pdGlhbGl6ZVwiKVxuXG4gICAgdHJ5IHtcbiAgICAgIHJlc3BvbnNlID0gYXdhaXQgdGhpcy5jb25uZWN0aW9uLnF1ZXJ5KHNxbClcbiAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgaWYgKGVycm9yIGluc3RhbmNlb2YgRXJyb3IpIHtcbiAgICAgICAgdGhyb3cgbmV3IEVycm9yKGBRdWVyeSBmYWlsZWQ6ICR7ZXJyb3IubWVzc2FnZX0gd2l0aCBTUUw6ICR7c3FsfWAsIHtjYXVzZTogZXJyb3J9KVxuICAgICAgfSBlbHNlIHtcbiAgICAgICAgdGhyb3cgbmV3IEVycm9yKGBRdWVyeSBmYWlsZWQ6ICR7ZXJyb3J9IHdpdGggU1FMOiAke3NxbH1gLCB7Y2F1c2U6IGVycm9yfSlcbiAgICAgIH1cbiAgICB9XG5cbiAgICByZXR1cm4gcmVzcG9uc2Uucm93c1xuICB9XG5cbiAgLyoqXG4gICAqIEV4ZWN1dGVzIGEgbXV0YXRpb24gd2l0aCBhZmZlY3RlZC1yb3cgbWV0YWRhdGEuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBzcWwgLSBNdXRhdGlvbiBTUUwuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPG51bWJlcj59IC0gQWZmZWN0ZWQgcm93IGNvdW50LlxuICAgKi9cbiAgYXN5bmMgX2FmZmVjdGVkUm93c0FjdHVhbChzcWwpIHtcbiAgICBpZiAoIXRoaXMuY29ubmVjdGlvbikgYXdhaXQgdGhpcy5jb25uZWN0KClcbiAgICBpZiAoIXRoaXMuY29ubmVjdGlvbikgdGhyb3cgbmV3IEVycm9yKFwiUG9zdGdyZVNRTCBjb25uZWN0aW9uIGZhaWxlZCB0byBpbml0aWFsaXplXCIpXG4gICAgY29uc3QgcmVzcG9uc2UgPSBhd2FpdCB0aGlzLmNvbm5lY3Rpb24ucXVlcnkoc3FsKVxuICAgIHJldHVybiByZXNwb25zZS5yb3dDb3VudCB8fCAwXG4gIH1cblxuICAvKipcbiAgICogUnVucyBxdWVyeSB0byBzcWwuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vLi4vcXVlcnkvaW5kZXguanNcIikuZGVmYXVsdH0gcXVlcnkgLSBRdWVyeSBpbnN0YW5jZS5cbiAgICogQHJldHVybnMge3N0cmluZ30gLSBTUUwgc3RyaW5nLlxuICAgKi9cbiAgcXVlcnlUb1NxbChxdWVyeSkgeyByZXR1cm4gbmV3IFF1ZXJ5UGFyc2VyKHtxdWVyeX0pLnRvU3FsKCkgfVxuICBzaG91bGRTZXRBdXRvSW5jcmVtZW50V2hlblByaW1hcnlLZXkoKSB7IHJldHVybiB0cnVlIH1cbiAgc3VwcG9ydHNEZWZhdWx0UHJpbWFyeUtleVVVSUQoKSB7IHJldHVybiB0cnVlIH1cblxuICAvKipcbiAgICogUnVucyBjb252ZXJ0IHZhbHVlLlxuICAgKiBAcGFyYW0ge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSB2YWx1ZSAtIFZhbHVlIHRvIHVzZS5cbiAgICogQHJldHVybnMge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSAtIFRoZSBjb252ZXJ0ZWQgdmFsdWUuXG4gICAqL1xuICBfY29udmVydFZhbHVlKHZhbHVlKSB7XG4gICAgaWYgKHR5cGVvZiB2YWx1ZSA9PT0gXCJib29sZWFuXCIpIHtcbiAgICAgIHJldHVybiB2YWx1ZSA/IFwidHJ1ZVwiIDogXCJmYWxzZVwiXG4gICAgfVxuXG4gICAgcmV0dXJuIHN1cGVyLl9jb252ZXJ0VmFsdWUodmFsdWUpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBlc2NhcGUuXG4gICAqIEBwYXJhbSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59IHZhbHVlIC0gVmFsdWUgdG8gdXNlLlxuICAgKiBAcmV0dXJucyB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59IC0gVGhlIGVzY2FwZS5cbiAgICovXG4gIGVzY2FwZSh2YWx1ZSkge1xuICAgIGlmICghdGhpcy5jb25uZWN0aW9uKSB0aHJvdyBuZXcgRXJyb3IoXCJDYW4ndCBlc2NhcGUgYmVmb3JlIGNvbm5lY3RlZFwiKVxuICAgIGlmICh0eXBlb2YgdmFsdWUgPT09IFwibnVtYmVyXCIpIHJldHVybiB2YWx1ZVxuXG4gICAgY29uc3QgZXNjYXBlZFZhbHVlV2l0aFF1b3RlcyA9IHRoaXMuY29ubmVjdGlvbi5lc2NhcGVMaXRlcmFsKHRoaXMuX2NvbnZlcnRWYWx1ZSh2YWx1ZSkpXG5cbiAgICByZXR1cm4gZXNjYXBlZFZhbHVlV2l0aFF1b3Rlcy5zbGljZSgxLCBlc2NhcGVkVmFsdWVXaXRoUXVvdGVzLmxlbmd0aCAtIDEpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBxdW90ZS5cbiAgICogQHBhcmFtIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gdmFsdWUgLSBWYWx1ZSB0byB1c2UuXG4gICAqIEByZXR1cm5zIHtzdHJpbmcgfCBudW1iZXJ9IC0gVGhlIHF1b3RlZCB2YWx1ZS5cbiAgICovXG4gIHF1b3RlKHZhbHVlKSB7XG4gICAgaWYgKCF0aGlzLmNvbm5lY3Rpb24pIHRocm93IG5ldyBFcnJvcihcIkNhbid0IGVzY2FwZSBiZWZvcmUgY29ubmVjdGVkXCIpXG4gICAgaWYgKHR5cGVvZiB2YWx1ZSA9PT0gXCJudW1iZXJcIikgcmV0dXJuIHZhbHVlXG5cbiAgICByZXR1cm4gdGhpcy5jb25uZWN0aW9uLmVzY2FwZUxpdGVyYWwodGhpcy5fY29udmVydFZhbHVlKHZhbHVlKSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGRlbGV0ZSBzcWwuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vYmFzZS5qc1wiKS5EZWxldGVTcWxBcmdzVHlwZX0gYXJncyAtIE9wdGlvbnMgb2JqZWN0LlxuICAgKiBAcmV0dXJucyB7c3RyaW5nfSAtIFNRTCBzdHJpbmcuXG4gICAqL1xuICBkZWxldGVTcWwoe3RhYmxlTmFtZSwgY29uZGl0aW9uc30pIHtcbiAgICBjb25zdCBkZWxldGVJbnN0cnVjdGlvbiA9IG5ldyBEZWxldGUoe2NvbmRpdGlvbnMsIGRyaXZlcjogdGhpcywgdGFibGVOYW1lfSlcblxuICAgIHJldHVybiBkZWxldGVJbnN0cnVjdGlvbi50b1NxbCgpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBpbnNlcnQgc3FsLlxuICAgKiBAYWJzdHJhY3RcbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9iYXNlLmpzXCIpLkluc2VydFNxbEFyZ3NUeXBlfSBhcmdzIC0gT3B0aW9ucyBvYmplY3QuXG4gICAqIEByZXR1cm5zIHtzdHJpbmd9IC0gU1FMIHN0cmluZy5cbiAgICovXG4gIGluc2VydFNxbChhcmdzKSB7XG4gICAgY29uc3QgaW5zZXJ0QXJncyA9IE9iamVjdC5hc3NpZ24oe2RyaXZlcjogdGhpc30sIGFyZ3MpXG4gICAgY29uc3QgaW5zZXJ0ID0gbmV3IEluc2VydChpbnNlcnRBcmdzKVxuXG4gICAgcmV0dXJuIGluc2VydC50b1NxbCgpXG4gIH1cblxuICBhc3luYyBnZXRUYWJsZXMoKSB7XG4gICAgcmV0dXJuIGF3YWl0IHRoaXMuX2NhY2hlZFNjaGVtYU1ldGFkYXRhKFwidGFibGVzXCIsIGFzeW5jICgpID0+IHtcbiAgICAgIGNvbnN0IHJlc3VsdCA9IGF3YWl0IHRoaXMucXVlcnkoXCJTRUxFQ1QgKiBGUk9NIGluZm9ybWF0aW9uX3NjaGVtYS50YWJsZXMgV0hFUkUgdGFibGVfY2F0YWxvZyA9IENVUlJFTlRfREFUQUJBU0UoKSBBTkQgdGFibGVfc2NoZW1hID0gJ3B1YmxpYydcIilcbiAgICAgIGNvbnN0IHRhYmxlcyA9IFtdXG5cbiAgICAgIGZvciAoY29uc3Qgcm93IG9mIHJlc3VsdCkge1xuICAgICAgICBjb25zdCB0YWJsZSA9IG5ldyBUYWJsZSh0aGlzLCAvKiogQHR5cGUge1JlY29yZDxzdHJpbmcsIHN0cmluZz59ICovIChyb3cpKVxuXG4gICAgICAgIHRhYmxlcy5wdXNoKHRhYmxlKVxuICAgICAgfVxuXG4gICAgICByZXR1cm4gdGFibGVzXG4gICAgfSlcbiAgfVxuXG4gIC8qKlxuICAgKiBUcnVuY2F0ZXMgYWxsIGVsaWdpYmxlIHRhYmxlcyBpbiBvbmUgUG9zdGdyZVNRTCByZXF1ZXN0LlxuICAgKiBAcGFyYW0ge0FycmF5PGltcG9ydChcIi4uL2Jhc2UtdGFibGUuanNcIikuZGVmYXVsdD59IHRhYmxlcyAtIEVsaWdpYmxlIHRhYmxlcy5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgd2hlbiB0aGUgYmF0Y2ggY29tcGxldGVzLlxuICAgKi9cbiAgYXN5bmMgdHJ1bmNhdGVUYWJsZXModGFibGVzKSB7XG4gICAgY29uc3QgcXVvdGVkVGFibGVzID0gdGFibGVzLm1hcCgodGFibGUpID0+IHRoaXMucXVvdGVUYWJsZSh0YWJsZS5nZXROYW1lKCkpKVxuXG4gICAgYXdhaXQgdGhpcy5xdWVyeShgVFJVTkNBVEUgVEFCTEUgJHtxdW90ZWRUYWJsZXMuam9pbihcIiwgXCIpfSBDQVNDQURFYClcbiAgfVxuXG4gIGFzeW5jIGxhc3RJbnNlcnRJRChvcHRpb25zID0ge30pIHtcbiAgICBjb25zdCByZXN1bHQgPSBhd2FpdCB0aGlzLnF1ZXJ5KFwiU0VMRUNUIExBU1RWQUwoKSBBUyBsYXN0X2luc2VydF9pZFwiLCBvcHRpb25zKVxuXG4gICAgcmV0dXJuIGRpZ2cocmVzdWx0LCAwLCBcImxhc3RfaW5zZXJ0X2lkXCIpXG4gIH1cblxuICBvcHRpb25zKCkge1xuICAgIGlmICghdGhpcy5fb3B0aW9ucykgdGhpcy5fb3B0aW9ucyA9IG5ldyBPcHRpb25zKHRoaXMpXG5cbiAgICByZXR1cm4gdGhpcy5fb3B0aW9uc1xuICB9XG5cbiAgYXN5bmMgX3N0YXJ0VHJhbnNhY3Rpb25BY3Rpb24ob3B0aW9ucyA9IHt9KSB7XG4gICAgYXdhaXQgdGhpcy5xdWVyeShcIlNUQVJUIFRSQU5TQUNUSU9OXCIsIG9wdGlvbnMpXG4gIH1cblxuICAvKipcbiAgICogUnVucyB1cGRhdGUgc3FsLlxuICAgKiBAYWJzdHJhY3RcbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9iYXNlLmpzXCIpLlVwZGF0ZVNxbEFyZ3NUeXBlfSBhcmdzIC0gT3B0aW9ucyBvYmplY3QuXG4gICAqIEByZXR1cm5zIHtzdHJpbmd9IC0gU1FMIHN0cmluZy5cbiAgICovXG4gIHVwZGF0ZVNxbCh7Y29uZGl0aW9ucywgZGF0YSwgdGFibGVOYW1lfSkge1xuICAgIGNvbnN0IHVwZGF0ZSA9IG5ldyBVcGRhdGUoe2NvbmRpdGlvbnMsIGRhdGEsIGRyaXZlcjogdGhpcywgdGFibGVOYW1lfSlcblxuICAgIHJldHVybiB1cGRhdGUudG9TcWwoKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgdXBzZXJ0IHNxbC5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9iYXNlLmpzXCIpLlVwc2VydFNxbEFyZ3NUeXBlfSBhcmdzIC0gT3B0aW9ucyBvYmplY3QuXG4gICAqIEByZXR1cm5zIHtzdHJpbmd9IC0gU1FMIHN0cmluZy5cbiAgICovXG4gIHVwc2VydFNxbChhcmdzKSB7XG4gICAgY29uc3QgdXBzZXJ0ID0gbmV3IFVwc2VydCh7Li4uYXJncywgZHJpdmVyOiB0aGlzfSlcblxuICAgIHJldHVybiB1cHNlcnQudG9TcWwoKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgc3RydWN0dXJlIHNxbC5cbiAgICogQHJldHVybnMge1Byb21pc2U8c3RyaW5nIHwgbnVsbD59IC0gUmVzb2x2ZXMgd2l0aCBTUUwgc3RyaW5nLlxuICAgKi9cbiAgYXN5bmMgc3RydWN0dXJlU3FsKCkge1xuICAgIHJldHVybiBhd2FpdCB0aGlzLl9jYWNoZWRTY2hlbWFNZXRhZGF0YShcInN0cnVjdHVyZVNxbFwiLCBhc3luYyAoKSA9PiBhd2FpdCBuZXcgU3RydWN0dXJlU3FsKHtkcml2ZXI6IHRoaXN9KS50b1NxbCgpKVxuICB9XG5cbiAgLyoqXG4gICAqIERldGVybWluaXN0aWNhbGx5IGhhc2hlcyBhIGxvY2sgbmFtZSBpbnRvIGEgc2lnbmVkIDY0LWJpdCBpbnRlZ2VyIHNvIGl0XG4gICAqIGNhbiBiZSBwYXNzZWQgdG8gYHBnX2Fkdmlzb3J5X2xvY2soYmlnaW50KWAuIFdlIHVzZSBhIGZhc3QgNjQtYml0IEZOVi0xYVxuICAgKiBoYXNoIOKAlCB0aGUgZXhhY3QgdmFsdWUgZG9lcyBub3QgbWF0dGVyLCBvbmx5IHRoYXQgdGhlIHNhbWUgbmFtZSBhbHdheXNcbiAgICogcHJvZHVjZXMgdGhlIHNhbWUga2V5IHdpdGhpbiBhIHByb2Nlc3MgQU5EIGFjcm9zcyBwcm9jZXNzZXMgdGhhdCBzaGFyZVxuICAgKiB0aGUgc2FtZSBpbXBsZW1lbnRhdGlvbi4gUmV0dXJucyB0aGUgdmFsdWUgYXMgYSBzdHJpbmcgc28gdGhlIGNhbGxlclxuICAgKiBjYW4gaW50ZXJwb2xhdGUgaXQgaW50byBTUUwgd2l0aG91dCBsb3NpbmcgcHJlY2lzaW9uIHRvIEpTIG51bWJlclxuICAgKiBjb2VyY2lvbi5cbiAgICogQHBhcmFtIHtzdHJpbmd9IG5hbWUgLSBMb2NrIG5hbWUuXG4gICAqIEByZXR1cm5zIHtzdHJpbmd9IC0gU2lnbmVkIDY0LWJpdCBpbnRlZ2VyIGFzIGEgZGVjaW1hbCBzdHJpbmcuXG4gICAqL1xuICBhZHZpc29yeUxvY2tLZXkobmFtZSkge1xuICAgIC8vIEZOVi0xYSA2NC1iaXQsIGNvbXB1dGVkIHdpdGggQmlnSW50IHNvIHdlIGRvbid0IGxvc2UgcHJlY2lzaW9uLlxuICAgIGNvbnN0IGZudk9mZnNldEJhc2lzID0gMHhjYmYyOWNlNDg0MjIyMzI1blxuICAgIGNvbnN0IGZudlByaW1lID0gMHgwMDAwMDEwMDAwMDAwMWIzblxuICAgIGNvbnN0IG1hc2s2NCA9IDB4ZmZmZmZmZmZmZmZmZmZmZm5cbiAgICBsZXQgaGFzaCA9IGZudk9mZnNldEJhc2lzXG5cbiAgICBmb3IgKGxldCBpbmRleCA9IDA7IGluZGV4IDwgbmFtZS5sZW5ndGg7IGluZGV4ICs9IDEpIHtcbiAgICAgIGhhc2ggPSBCaWdJbnQuYXNVaW50Tig2NCwgKGhhc2ggXiBCaWdJbnQobmFtZS5jaGFyQ29kZUF0KGluZGV4KSkpICogZm52UHJpbWUgJiBtYXNrNjQpXG4gICAgfVxuXG4gICAgLy8gQ29udmVydCB1bnNpZ25lZCA2NC1iaXQgaW50byBzaWduZWQgYnkgcmVpbnRlcnByZXRpbmcgdGhlIHRvcCBiaXQuXG4gICAgY29uc3Qgc2lnbmVkID0gaGFzaCA+PSAweDgwMDAwMDAwMDAwMDAwMDBuID8gaGFzaCAtIDB4MTAwMDAwMDAwMDAwMDAwMDBuIDogaGFzaFxuXG4gICAgcmV0dXJuIHNpZ25lZC50b1N0cmluZygpXG4gIH1cblxuICAvKipcbiAgICogUmVzb2x2ZXMgdGhlIGBwZ190cnlfYWR2aXNvcnlfbG9ja2AgcHJvYmUgY2FkZW5jZSBmb3Igb25lIGJvdW5kZWQgd2FpdC5cbiAgICpcbiAgICogYHBnX2Fkdmlzb3J5X2xvY2tgIGhhcyBubyBuYXRpdmUgdGltZW91dCwgc28gYSBib3VuZGVkIGFjcXVpc2l0aW9uIHBvbGxzLiBTY2FsaW5nIHRoZSBpbnRlcnZhbFxuICAgKiB3aXRoIHRoZSBib3VuZCBrZWVwcyB0aGUgaGlzdG9yaWNhbCA1MG1zIGNhZGVuY2Ug4oCUIGFuZCBpdHMgZmFzdCBhY3F1aXNpdGlvbiDigJQgZm9yIHRoZSBzaG9ydFxuICAgKiBleHBsaWNpdCBgdGltZW91dE1zYCB2YWx1ZXMgY2FsbGVycyBhbHJlYWR5IHBhc3MsIHdoaWxlIGEgbG9uZyBmcmFtZXdvcmsgZGVmYXVsdCBzdGF5c1xuICAgKiByZXNwb25zaXZlIHdpdGhvdXQgdHVybmluZyBvbmUgY29udGVuZGVkIGxvY2sgaW50byB0ZW5zIG9mIHRob3VzYW5kcyBvZiBwcm9iZSBxdWVyaWVzLlxuICAgKiBAcGFyYW0ge251bWJlcn0gdGltZW91dE1zIC0gQm91bmRlZCB3YWl0IGluIG1pbGxpc2Vjb25kcy5cbiAgICogQHJldHVybnMge251bWJlcn0gLSBQcm9iZSBpbnRlcnZhbCBpbiBtaWxsaXNlY29uZHMuXG4gICAqL1xuICBzdGF0aWMgYWR2aXNvcnlMb2NrUG9sbEludGVydmFsTXModGltZW91dE1zKSB7XG4gICAgcmV0dXJuIE1hdGgubWluKFxuICAgICAgTWF0aC5tYXgoTWF0aC5mbG9vcih0aW1lb3V0TXMgLyAxMDApLCBQR1NRTF9BRFZJU09SWV9MT0NLX1BPTExfTUlOX0lOVEVSVkFMX01TKSxcbiAgICAgIFBHU1FMX0FEVklTT1JZX0xPQ0tfUE9MTF9NQVhfSU5URVJWQUxfTVNcbiAgICApXG4gIH1cblxuICAvKipcbiAgICogQmxvY2tzIHVudGlsIGEgUG9zdGdyZVNRTCBzZXNzaW9uLWxldmVsIGFkdmlzb3J5IGxvY2sgaXMgYWNxdWlyZWQgb25cbiAgICogdGhpcyBjb25uZWN0aW9uLiBJbXBsZW1lbnRlZCB2aWEgYHBnX2Fkdmlzb3J5X2xvY2soYmlnaW50KWAsIHdoaWNoIGhhc1xuICAgKiBubyBuYXRpdmUgdGltZW91dCDigJQgdGhlIGB0aW1lb3V0TXNgIGFyZ3VtZW50IGlzIGVtdWxhdGVkIGJ5IHJhY2luZyBhXG4gICAqIGBwZ190cnlfYWR2aXNvcnlfbG9ja2AgcG9sbCBsb29wIHNvIGNhbGxlcnMgb24gTXlTUUwgYW5kIFBvc3RncmVzIHNlZSB0aGVcbiAgICogc2FtZSBjb250cmFjdC4gVGhlIHBvbGwgaW50ZXJ2YWwgYmFja3Mgb2ZmIHRvIGEgY2FwIHNvIGEgbG9uZyBib3VuZGVkIHdhaXRcbiAgICogZG9lcyBub3QgdHVybiBvbmUgY29udGVuZGVkIGxvY2sgaW50byB0aG91c2FuZHMgb2YgcHJvYmUgcXVlcmllcy5cbiAgICogQHBhcmFtIHtzdHJpbmd9IG5hbWUgLSBMb2NrIG5hbWUuXG4gICAqIEBwYXJhbSB7e3RpbWVvdXRNcz86IG51bWJlciB8IG51bGx9fSBbYXJnc10gLSBPcHRpb25hbCB0aW1lb3V0IGluIG1pbGxpc2Vjb25kczsgYG51bGxgIG9yIG5lZ2F0aXZlIGJsb2NrcyBmb3JldmVyLCBhbmQgYW4gb21pdHRlZCB2YWx1ZSB1c2VzIHRoZSBkYXRhYmFzZSdzIGBhZHZpc29yeUxvY2tBY3F1aXJlVGltZW91dE1zYCBvciB0aGUgZnJhbWV3b3JrIGRlZmF1bHQuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPGJvb2xlYW4+fSAtIFRydWUgaWYgdGhlIGxvY2sgd2FzIGFjcXVpcmVkLCBmYWxzZSBpZiB0aGUgdGltZW91dCBlbGFwc2VkLlxuICAgKi9cbiAgYXN5bmMgX2FjcXVpcmVBZHZpc29yeUxvY2sobmFtZSwge3RpbWVvdXRNc30gPSB7fSkge1xuICAgIGNvbnN0IGtleSA9IHRoaXMuYWR2aXNvcnlMb2NrS2V5KG5hbWUpXG5cbiAgICBpZiAodHlwZW9mIHRpbWVvdXRNcyAhPT0gXCJudW1iZXJcIiB8fCB0aW1lb3V0TXMgPCAwKSB7XG4gICAgICBhd2FpdCB0aGlzLnF1ZXJ5KGBTRUxFQ1QgcGdfYWR2aXNvcnlfbG9jaygke2tleX0pYClcbiAgICAgIHJldHVybiB0cnVlXG4gICAgfVxuXG4gICAgY29uc3QgZGVhZGxpbmUgPSBEYXRlLm5vdygpICsgdGltZW91dE1zXG4gICAgY29uc3QgcG9sbEludGVydmFsTXMgPSBWZWxvY2lvdXNEYXRhYmFzZURyaXZlcnNQZ3NxbC5hZHZpc29yeUxvY2tQb2xsSW50ZXJ2YWxNcyh0aW1lb3V0TXMpXG5cbiAgICB3aGlsZSAodHJ1ZSkge1xuICAgICAgaWYgKGF3YWl0IHRoaXMuX3RyeUFjcXVpcmVBZHZpc29yeUxvY2sobmFtZSkpIHJldHVybiB0cnVlXG4gICAgICBpZiAoRGF0ZS5ub3coKSA+PSBkZWFkbGluZSkgcmV0dXJuIGZhbHNlXG5cbiAgICAgIGNvbnN0IHJlbWFpbmluZyA9IGRlYWRsaW5lIC0gRGF0ZS5ub3coKVxuXG4gICAgICBhd2FpdCB3YWl0KE1hdGgubWluKHBvbGxJbnRlcnZhbE1zLCByZW1haW5pbmcpKVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHRyeSBhY3F1aXJlIGFkdmlzb3J5IGxvY2suXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBuYW1lIC0gTG9jayBuYW1lLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxib29sZWFuPn0gLSBUcnVlIGlmIHRoZSBsb2NrIHdhcyBhY3F1aXJlZCwgZmFsc2UgaWYgaXQgd2FzIGFscmVhZHkgaGVsZC5cbiAgICovXG4gIGFzeW5jIF90cnlBY3F1aXJlQWR2aXNvcnlMb2NrKG5hbWUpIHtcbiAgICBjb25zdCBrZXkgPSB0aGlzLmFkdmlzb3J5TG9ja0tleShuYW1lKVxuICAgIGNvbnN0IHJvd3MgPSBhd2FpdCB0aGlzLnF1ZXJ5KGBTRUxFQ1QgcGdfdHJ5X2Fkdmlzb3J5X2xvY2soJHtrZXl9KSBBUyB2ZWxvY2lvdXNfYWR2aXNvcnlfbG9ja19yZXN1bHRgKVxuICAgIGNvbnN0IHJlc3VsdCA9IHJvd3M/LlswXT8udmVsb2Npb3VzX2Fkdmlzb3J5X2xvY2tfcmVzdWx0XG5cbiAgICByZXR1cm4gcmVzdWx0ID09PSB0cnVlIHx8IHJlc3VsdCA9PT0gXCJ0XCIgfHwgcmVzdWx0ID09PSAxIHx8IHJlc3VsdCA9PT0gXCIxXCJcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHJlbGVhc2UgYWR2aXNvcnkgbG9jay5cbiAgICogQHBhcmFtIHtzdHJpbmd9IG5hbWUgLSBMb2NrIG5hbWUuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPGJvb2xlYW4+fSAtIFRydWUgaWYgdGhlIGxvY2sgd2FzIGhlbGQgYnkgdGhpcyBzZXNzaW9uIGFuZCBoYXMgbm93IGJlZW4gcmVsZWFzZWQuXG4gICAqL1xuICBhc3luYyBfcmVsZWFzZUFkdmlzb3J5TG9jayhuYW1lKSB7XG4gICAgY29uc3Qga2V5ID0gdGhpcy5hZHZpc29yeUxvY2tLZXkobmFtZSlcbiAgICBjb25zdCByb3dzID0gYXdhaXQgdGhpcy5xdWVyeShgU0VMRUNUIHBnX2Fkdmlzb3J5X3VubG9jaygke2tleX0pIEFTIHZlbG9jaW91c19hZHZpc29yeV9sb2NrX3Jlc3VsdGApXG4gICAgY29uc3QgcmVzdWx0ID0gcm93cz8uWzBdPy52ZWxvY2lvdXNfYWR2aXNvcnlfbG9ja19yZXN1bHRcblxuICAgIHJldHVybiByZXN1bHQgPT09IHRydWUgfHwgcmVzdWx0ID09PSBcInRcIiB8fCByZXN1bHQgPT09IDEgfHwgcmVzdWx0ID09PSBcIjFcIlxuICB9XG5cbiAgLyoqXG4gICAqIEF0dHJpYnV0ZXMgdGhlIGN1cnJlbnQgaG9sZGVyIG9mIHRoZSBuYW1lZCBhZHZpc29yeSBsb2NrIHRvIGl0cyBiYWNrZW5kXG4gICAqIHByb2Nlc3MgaWQgZnJvbSBgcGdfbG9ja3NgLCBjYXB0dXJlZCBhdCB0aGUgdGVsZW1ldHJ5IGV2ZW50IG1vbWVudFxuICAgKiAoYmVzdC1lZmZvcnQ7IHRoZSBjYWxsZXIgZ3VhcmRzIGZhaWx1cmVzKS5cbiAgICogQHBhcmFtIHtzdHJpbmd9IG5hbWUgLSBMb2NrIG5hbWUuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHN0cmluZyB8IG51bGw+fSAtIFBvc3RncmVTUUwgYmFja2VuZCBwaWQgb2YgdGhlIGhvbGRlciwgb3IgbnVsbCB3aGVuIG5vIHNlc3Npb24gaG9sZHMgdGhlIGxvY2suXG4gICAqL1xuICBhc3luYyBhZHZpc29yeUxvY2tIb2xkZXJDb25uZWN0aW9uSWQobmFtZSkge1xuICAgIGNvbnN0IGtleSA9IHRoaXMuYWR2aXNvcnlMb2NrS2V5KG5hbWUpXG4gICAgY29uc3Qgcm93cyA9IGF3YWl0IHRoaXMucXVlcnkoXG4gICAgICBgU0VMRUNUIHBpZCBGUk9NIHBnX2xvY2tzIFdIRVJFIGxvY2t0eXBlID0gJ2Fkdmlzb3J5JyBBTkQgKChjbGFzc2lkOjpiaWdpbnQgPDwgMzIpIHwgKG9iamlkOjpiaWdpbnQgJiA0Mjk0OTY3Mjk1KSkgPSAke2tleX0gTElNSVQgMWBcbiAgICApXG4gICAgY29uc3QgaG9sZGVyID0gcm93cz8uWzBdPy5waWRcblxuICAgIHJldHVybiBob2xkZXIgPT09IG51bGwgfHwgaG9sZGVyID09PSB1bmRlZmluZWQgPyBudWxsIDogU3RyaW5nKGhvbGRlcilcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGlzIGFkdmlzb3J5IGxvY2sgaGVsZC5cbiAgICogQHBhcmFtIHtzdHJpbmd9IG5hbWUgLSBMb2NrIG5hbWUuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPGJvb2xlYW4+fSAtIFRydWUgaWYgYW55IHNlc3Npb24gY3VycmVudGx5IGhvbGRzIHRoZSBsb2NrLlxuICAgKi9cbiAgYXN5bmMgaXNBZHZpc29yeUxvY2tIZWxkKG5hbWUpIHtcbiAgICBjb25zdCBrZXkgPSB0aGlzLmFkdmlzb3J5TG9ja0tleShuYW1lKVxuICAgIGNvbnN0IHJvd3MgPSBhd2FpdCB0aGlzLnF1ZXJ5KFxuICAgICAgYFNFTEVDVCBFWElTVFMgKFNFTEVDVCAxIEZST00gcGdfbG9ja3MgV0hFUkUgbG9ja3R5cGUgPSAnYWR2aXNvcnknIEFORCAoKGNsYXNzaWQ6OmJpZ2ludCA8PCAzMikgfCAob2JqaWQ6OmJpZ2ludCAmIDQyOTQ5NjcyOTUpKSA9ICR7a2V5fSkgQVMgdmVsb2Npb3VzX2Fkdmlzb3J5X2xvY2tfaGVsZGBcbiAgICApXG4gICAgY29uc3QgaGVsZCA9IHJvd3M/LlswXT8udmVsb2Npb3VzX2Fkdmlzb3J5X2xvY2tfaGVsZFxuXG4gICAgcmV0dXJuIGhlbGQgPT09IHRydWUgfHwgaGVsZCA9PT0gXCJ0XCIgfHwgaGVsZCA9PT0gMSB8fCBoZWxkID09PSBcIjFcIlxuICB9XG59XG4iXX0=