// @ts-check
import { digg } from "diggerize";
import AlterTable from "./sql/alter-table.js";
import Base from "../base.js";
import CreateIndex from "./sql/create-index.js";
import CreateTable from "./sql/create-table.js";
import Delete from "./sql/delete.js";
import DropTable from "./sql/drop-table.js";
import escapeString from "sql-escape-string";
import Insert from "./sql/insert.js";
import Options from "./options.js";
import QueryParser from "./query-parser.js";
import RemoveIndex from "./sql/remove-index.js";
import Table from "./table.js";
import StructureSql from "./structure-sql.js";
import Upsert from "./sql/upsert.js";
import Update from "./sql/update.js";
export default class VelociousDatabaseDriversSqliteBase extends Base {
    /**
     * Process-wide state for the SQLite advisory lock emulation. Shared across
     * every SQLite driver instance (native, web, sql.js) because there is no
     * concept of "connection" to distinguish them at the SQLite level.
     *
     * `ownersByName` maps each held lock name to the driver instance that
     * acquired it so `releaseAdvisoryLock` can reject releases from drivers
     * that do not own the lock.
     * @type {{ownersByName: Map<string, VelociousDatabaseDriversSqliteBase>, waitersByName: Map<string, Array<() => void>>}}
     */
    static _advisoryLockState = {
        ownersByName: new Map(),
        waitersByName: new Map()
    };
    /**
     * Version major.
     * @type {number | undefined} */
    versionMajor = undefined;
    /**
     * Version minor.
     * @type {number | undefined} */
    versionMinor = undefined;
    /**
     * Version patch.
     * @type {number | undefined} */
    versionPatch = undefined;
    /**
     * Runs alter table sqls.
     * @param {import("../../table-data/index.js").default} tableData - Table data.
     * @returns {Promise<string[]>} - Resolves with SQL statements.
     */
    async alterTableSQLs(tableData) {
        const alterArgs = { driver: this, tableData };
        const alterTable = new AlterTable(alterArgs);
        return await alterTable.toSQLs();
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
     * @abstract
     * @param {import("../../table-data/index.js").default} tableData - Table data.
     * @returns {Promise<string[]>} - Resolves with SQL statements.
     */
    async createTableSql(tableData) {
        const createArgs = { tableData, driver: this, indexInCreateTable: false };
        const createTable = new CreateTable(createArgs);
        return await createTable.toSql();
    }
    currentDatabase() {
        return null;
    }
    async disableForeignKeys() {
        await this.query("PRAGMA foreign_keys = 0");
    }
    async enableForeignKeys() {
        await this.query("PRAGMA foreign_keys = 1");
    }
    /**
     * Runs drop table sqls.
     * @param {string} tableName - Table name.
     * @param {import("../base.js").DropTableSqlArgsType} [args] - Options object.
     * @returns {Promise<string[]>} - Resolves with SQL statements.
     */
    async dropTableSQLs(tableName, args = {}) {
        const driver = /** @type {import("../base.js").default} */ (this);
        const dropArgs = Object.assign({ tableName, driver }, args);
        const dropTable = new DropTable(dropArgs);
        return await dropTable.toSQLs();
    }
    /**
     * Runs delete sql.
     * @param {import("../base.js").DeleteSqlArgsType} args - Options object.
     * @returns {string} - SQL string.
     */
    deleteSql(args) { return new Delete(Object.assign({ driver: this }, args)).toSql(); }
    /**
     * Runs get type.
     * @returns {string} - The type.
     */
    getType() { return "sqlite"; }
    /**
     * Runs insert sql.
     * @param {import("../base.js").InsertSqlArgsType} args - Options object.
     * @returns {string} - SQL string.
     */
    insertSql(args) { return new Insert(Object.assign({ driver: this }, args)).toSql(); }
    /**
     * Runs get tables.
     * @returns {Promise<Array<import("../base-table.js").default>>} - Resolves with the tables.
     */
    async getTables() {
        return await this._cachedSchemaMetadata("tables", async () => {
            const result = await this.query("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name");
            const tables = [];
            for (const row of result) {
                const table = new Table({ driver: this, row: /** @type {Record<string, string | number | null>} */ (row) });
                tables.push(table);
            }
            return tables;
        });
    }
    /**
     * Deletes every eligible table through the platform driver's native SQLite
     * script path so the whole cleanup is submitted as one request.
     * @param {Array<import("../base-table.js").default>} tables - Eligible tables.
     * @returns {Promise<void>} - Resolves when the script completes.
     */
    async truncateTables(tables) {
        const statements = tables.map((table) => `DELETE FROM ${this.quoteTable(table.getName())}`);
        await this.query(statements.join(";\n"), { sqliteScript: true });
    }
    /**
     * Runs insert multiple.
     * @param {string} tableName - Table name.
     * @param {Array<string>} columns - Column names.
     * @param {Array<Array<ReturnType<typeof JSON.parse>>>} rows - Rows to insert.
     * @returns {Promise<void>} - Resolves when complete.
     */
    async insertMultiple(tableName, columns, rows) {
        this._assertNotReadOnly();
        await this.registerVersion();
        if (this.supportsMultipleInsertValues()) {
            await this.insertMultipleWithSingleInsert(tableName, columns, rows);
        }
        else {
            await this.insertMultipleWithTransaction(tableName, columns, rows);
        }
    }
    /**
     * Runs supports multiple insert values.
     * @returns {boolean} - Whether supports multiple insert values.
     */
    supportsMultipleInsertValues() {
        /**
         * Version major.
         * @type {number} */
        const versionMajor = this.versionMajor || 0;
        /**
         * Version minor.
         * @type {number} */
        const versionMinor = this.versionMinor || 0;
        /**
         * Version patch.
         * @type {number} */
        const versionPatch = this.versionPatch || 0;
        if (versionMajor >= 4)
            return true;
        if (versionMajor == 3 && versionMinor >= 8)
            return true;
        if (versionMajor == 3 && versionMinor == 7 && versionPatch >= 11)
            return true;
        return false;
    }
    /**
     * Runs supports insert into returning.
     * @returns {boolean} - Whether supports insert into returning.
     */
    supportsInsertIntoReturning() {
        /**
         * Version major.
         * @type {number} */
        const versionMajor = this.versionMajor || 0;
        /**
         * Version minor.
         * @type {number} */
        const versionMinor = this.versionMinor || 0;
        if (versionMajor >= 4)
            return true;
        if (versionMajor == 3 && versionMinor >= 35)
            return true;
        return false;
    }
    /**
     * Runs insert multiple with single insert.
     * @param {string} tableName - Table name.
     * @param {Array<string>} columns - Column names.
     * @param {Array<Array<ReturnType<typeof JSON.parse>>>} rows - Rows to insert.
     * @returns {Promise<void>} - Resolves when complete.
     */
    async insertMultipleWithSingleInsert(tableName, columns, rows) {
        this._assertNotReadOnly();
        const chunks = this._insertMultipleChunks(rows, (chunkRows) => new Insert({ columns, driver: this, rows: chunkRows, tableName }).toSql());
        for (const chunk of chunks) {
            const sql = new Insert({ columns, driver: this, rows: chunk, tableName }).toSql();
            await this.query(sql);
        }
    }
    /**
     * Runs insert multiple with transaction.
     * @param {string} tableName - Table name.
     * @param {Array<string>} columns - Column names.
     * @param {Array<Array<ReturnType<typeof JSON.parse>>>} rows - Rows to insert.
     * @returns {Promise<void>} - Resolves when complete.
     */
    async insertMultipleWithTransaction(tableName, columns, rows) {
        this._assertNotReadOnly();
        /**
         * Sqls.
         * @type {string[]} */
        const sqls = [];
        for (const row of rows) {
            /**
             * Data.
             * @type {Record<string, ReturnType<typeof JSON.parse>>} */
            const data = {};
            for (const columnIndex in columns) {
                const columnName = columns[columnIndex];
                const value = row[columnIndex];
                data[columnName] = value;
            }
            const insertSql = this.insertSql({ tableName, data });
            sqls.push(insertSql);
        }
        await this.transaction(async () => {
            for (const sql of sqls) {
                await this.query(sql);
            }
        });
    }
    async lastInsertID(options = {}) {
        const result = await this.query("SELECT LAST_INSERT_ROWID() AS last_insert_id", options);
        return digg(result, 0, "last_insert_id");
    }
    options() {
        if (!this._options)
            this._options = new Options(this);
        return this._options;
    }
    /**
     * Runs query to sql.
     * @param {import("../../query/index.js").default} query - Query instance.
     * @returns {string} - SQL string.
     */
    queryToSql(query) { return new QueryParser({ query }).toSql(); }
    async registerVersion() {
        if (this.versionMajor || this.versionMinor) {
            return;
        }
        const versionResult = await this.query("SELECT sqlite_version() AS version");
        this.version = String(versionResult[0].version);
        const versionParts = this.version.split(".");
        this.versionMajor = Number(versionParts[0]);
        this.versionMinor = Number(versionParts[1]);
        this.versionPatch = Number(versionParts[2]);
    }
    shouldSetAutoIncrementWhenPrimaryKey() { return false; }
    supportsDefaultPrimaryKeyUUID() { return false; }
    /**
     * Runs escape.
     * @param {ReturnType<typeof JSON.parse>} value - Value to use.
     * @returns {ReturnType<typeof JSON.parse>} - The escape.
     */
    escape(value) {
        value = this._convertValue(value);
        const type = typeof value;
        if (type != "string")
            value = `${value}`;
        const resultWithQuotes = escapeString(value, null);
        const result = resultWithQuotes.substring(1, resultWithQuotes.length - 1);
        return result;
    }
    /**
     * Runs retryable database error.
     * @param {Error} error - Error instance.
     * @returns {import("../base.js").RetryableDatabaseErrorResult} - Retry info.
     */
    retryableDatabaseError(error) {
        const databaseLocked = Boolean(error.message?.includes("database is locked"));
        const shouldRetry = (error.message?.startsWith("attempt to write a readonly database") ||
            databaseLocked);
        return { deadlock: databaseLocked, retry: shouldRetry, reconnect: false };
    }
    /**
     * Runs quote.
     * @param {ReturnType<typeof JSON.parse>} value - Value to use.
     * @returns {string | number} - The quoted value.
     */
    quote(value) {
        value = this._convertValue(value);
        const type = typeof value;
        if (type == "number")
            return /** @type {number} */ (value);
        if (type != "string")
            value = String(value);
        return escapeString(value, null);
    }
    /**
     * Runs update sql.
     * @param {import("../base.js").UpdateSqlArgsType} args - Options object.
     * @returns {string} - SQL string.
     */
    updateSql({ conditions, data, tableName }) { return new Update({ conditions, data, driver: this, tableName }).toSql(); }
    /**
     * Runs upsert sql.
     * @param {import("../base.js").UpsertSqlArgsType} args - Options object.
     * @returns {string} - SQL string.
     */
    upsertSql(args) { return new Upsert({ ...args, driver: this }).toSql(); }
    /**
     * Runs structure sql.
     * @returns {Promise<string | null>} - Resolves with SQL string.
     */
    async structureSql() {
        return await this._cachedSchemaMetadata("structureSql", async () => await new StructureSql({ driver: this }).toSql());
    }
    /**
     * Blocks until an in-process advisory lock with the given name is
     * acquired. SQLite has no built-in advisory lock primitive, so this is
     * implemented as a process-local waiter queue. Typical SQLite deployments
     * run inside a single Node process, which is exactly the scope this
     * emulation covers; multi-process SQLite setups should not rely on this
     * for cross-process mutual exclusion.
     *
     * The owning driver instance is recorded so that `releaseAdvisoryLock`
     * can refuse to release a lock that was acquired by someone else.
     * @param {string} name - Lock name.
     * @param {{timeoutMs?: number | null}} [args] - Optional timeout in milliseconds; `null`, `undefined`, or negative blocks forever.
     * @returns {Promise<boolean>} - True if the lock was acquired, false if the timeout elapsed.
     */
    async _acquireAdvisoryLock(name, { timeoutMs } = {}) {
        const state = VelociousDatabaseDriversSqliteBase._advisoryLockState;
        while (state.ownersByName.has(name)) {
            let remainingMs = null;
            if (typeof timeoutMs === "number" && timeoutMs >= 0) {
                remainingMs = timeoutMs;
                if (remainingMs <= 0)
                    return false;
            }
            await new Promise((resolve) => {
                const waiters = state.waitersByName.get(name) || [];
                /**
                 * Timeout handle.
                 * @type {ReturnType<typeof setTimeout> | null} */
                let timeoutHandle = null;
                /**
                 * Remove and resolve.
                 * @type {(() => void) | null} */
                let removeAndResolve = null;
                removeAndResolve = () => {
                    if (timeoutHandle)
                        clearTimeout(timeoutHandle);
                    const current = state.waitersByName.get(name) || [];
                    const index = current.indexOf(/** @type {() => void} */ (removeAndResolve));
                    if (index >= 0)
                        current.splice(index, 1);
                    if (current.length === 0)
                        state.waitersByName.delete(name);
                    resolve(undefined);
                };
                waiters.push(removeAndResolve);
                state.waitersByName.set(name, waiters);
                if (remainingMs !== null) {
                    timeoutHandle = setTimeout(() => {
                        if (removeAndResolve)
                            removeAndResolve();
                    }, remainingMs);
                }
            });
            if (typeof timeoutMs === "number" && timeoutMs >= 0 && state.ownersByName.has(name)) {
                return false;
            }
        }
        state.ownersByName.set(name, this);
        return true;
    }
    /**
     * Runs try acquire advisory lock.
     * @param {string} name - Lock name.
     * @returns {Promise<boolean>} - True if the lock was acquired, false if it was already held.
     */
    async _tryAcquireAdvisoryLock(name) {
        const state = VelociousDatabaseDriversSqliteBase._advisoryLockState;
        if (state.ownersByName.has(name))
            return false;
        state.ownersByName.set(name, this);
        return true;
    }
    /**
     * Releases the lock only if **this** driver instance owns it. Calling
     * release for a lock owned by another driver instance is a no-op that
     * returns `false`, matching the "you can only release locks you own"
     * contract of MySQL's `RELEASE_LOCK` and PostgreSQL's
     * `pg_advisory_unlock`.
     * @param {string} name - Lock name.
     * @returns {Promise<boolean>} - True if the lock was held by this driver and has now been released.
     */
    async _releaseAdvisoryLock(name) {
        const state = VelociousDatabaseDriversSqliteBase._advisoryLockState;
        const owner = state.ownersByName.get(name);
        if (owner !== this)
            return false;
        state.ownersByName.delete(name);
        const waiters = state.waitersByName.get(name);
        if (waiters && waiters.length > 0) {
            const nextWaiter = waiters.shift();
            if (waiters.length === 0)
                state.waitersByName.delete(name);
            if (nextWaiter)
                nextWaiter();
        }
        return true;
    }
    /**
     * Runs is advisory lock held.
     * @param {string} name - Lock name.
     * @returns {Promise<boolean>} - True if any driver instance currently holds the lock.
     */
    async isAdvisoryLockHeld(name) {
        return VelociousDatabaseDriversSqliteBase._advisoryLockState.ownersByName.has(name);
    }
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiYmFzZS5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uLy4uLy4uLy4uLy4uL3NyYy9kYXRhYmFzZS9kcml2ZXJzL3NxbGl0ZS9iYXNlLmpzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiJBQUFBLFlBQVk7QUFFWixPQUFPLEVBQUMsSUFBSSxFQUFDLE1BQU0sV0FBVyxDQUFBO0FBRTlCLE9BQU8sVUFBVSxNQUFNLHNCQUFzQixDQUFBO0FBQzdDLE9BQU8sSUFBSSxNQUFNLFlBQVksQ0FBQTtBQUM3QixPQUFPLFdBQVcsTUFBTSx1QkFBdUIsQ0FBQTtBQUMvQyxPQUFPLFdBQVcsTUFBTSx1QkFBdUIsQ0FBQTtBQUMvQyxPQUFPLE1BQU0sTUFBTSxpQkFBaUIsQ0FBQTtBQUNwQyxPQUFPLFNBQVMsTUFBTSxxQkFBcUIsQ0FBQTtBQUMzQyxPQUFPLFlBQVksTUFBTSxtQkFBbUIsQ0FBQTtBQUM1QyxPQUFPLE1BQU0sTUFBTSxpQkFBaUIsQ0FBQTtBQUNwQyxPQUFPLE9BQU8sTUFBTSxjQUFjLENBQUE7QUFDbEMsT0FBTyxXQUFXLE1BQU0sbUJBQW1CLENBQUE7QUFDM0MsT0FBTyxXQUFXLE1BQU0sdUJBQXVCLENBQUE7QUFDL0MsT0FBTyxLQUFLLE1BQU0sWUFBWSxDQUFBO0FBQzlCLE9BQU8sWUFBWSxNQUFNLG9CQUFvQixDQUFBO0FBQzdDLE9BQU8sTUFBTSxNQUFNLGlCQUFpQixDQUFBO0FBQ3BDLE9BQU8sTUFBTSxNQUFNLGlCQUFpQixDQUFBO0FBRXBDLE1BQU0sQ0FBQyxPQUFPLE9BQU8sa0NBQW1DLFNBQVEsSUFBSTtJQUNsRTs7Ozs7Ozs7O09BU0c7SUFDSCxNQUFNLENBQUMsa0JBQWtCLEdBQUc7UUFDMUIsWUFBWSxFQUFFLElBQUksR0FBRyxFQUFFO1FBQ3ZCLGFBQWEsRUFBRSxJQUFJLEdBQUcsRUFBRTtLQUN6QixDQUFBO0lBRUQ7O29DQUVnQztJQUNoQyxZQUFZLEdBQUcsU0FBUyxDQUFBO0lBQ3hCOztvQ0FFZ0M7SUFDaEMsWUFBWSxH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Q0FBQTtJQUNyRixDQUFDO0NBQ0YiLCJzb3VyY2VzQ29udGVudCI6WyIvLyBAdHMtY2hlY2tcblxuaW1wb3J0IHtkaWdnfSBmcm9tIFwiZGlnZ2VyaXplXCJcblxuaW1wb3J0IEFsdGVyVGFibGUgZnJvbSBcIi4vc3FsL2FsdGVyLXRhYmxlLmpzXCJcbmltcG9ydCBCYXNlIGZyb20gXCIuLi9iYXNlLmpzXCJcbmltcG9ydCBDcmVhdGVJbmRleCBmcm9tIFwiLi9zcWwvY3JlYXRlLWluZGV4LmpzXCJcbmltcG9ydCBDcmVhdGVUYWJsZSBmcm9tIFwiLi9zcWwvY3JlYXRlLXRhYmxlLmpzXCJcbmltcG9ydCBEZWxldGUgZnJvbSBcIi4vc3FsL2RlbGV0ZS5qc1wiXG5pbXBvcnQgRHJvcFRhYmxlIGZyb20gXCIuL3NxbC9kcm9wLXRhYmxlLmpzXCJcbmltcG9ydCBlc2NhcGVTdHJpbmcgZnJvbSBcInNxbC1lc2NhcGUtc3RyaW5nXCJcbmltcG9ydCBJbnNlcnQgZnJvbSBcIi4vc3FsL2luc2VydC5qc1wiXG5pbXBvcnQgT3B0aW9ucyBmcm9tIFwiLi9vcHRpb25zLmpzXCJcbmltcG9ydCBRdWVyeVBhcnNlciBmcm9tIFwiLi9xdWVyeS1wYXJzZXIuanNcIlxuaW1wb3J0IFJlbW92ZUluZGV4IGZyb20gXCIuL3NxbC9yZW1vdmUtaW5kZXguanNcIlxuaW1wb3J0IFRhYmxlIGZyb20gXCIuL3RhYmxlLmpzXCJcbmltcG9ydCBTdHJ1Y3R1cmVTcWwgZnJvbSBcIi4vc3RydWN0dXJlLXNxbC5qc1wiXG5pbXBvcnQgVXBzZXJ0IGZyb20gXCIuL3NxbC91cHNlcnQuanNcIlxuaW1wb3J0IFVwZGF0ZSBmcm9tIFwiLi9zcWwvdXBkYXRlLmpzXCJcblxuZXhwb3J0IGRlZmF1bHQgY2xhc3MgVmVsb2Npb3VzRGF0YWJhc2VEcml2ZXJzU3FsaXRlQmFzZSBleHRlbmRzIEJhc2Uge1xuICAvKipcbiAgICogUHJvY2Vzcy13aWRlIHN0YXRlIGZvciB0aGUgU1FMaXRlIGFkdmlzb3J5IGxvY2sgZW11bGF0aW9uLiBTaGFyZWQgYWNyb3NzXG4gICAqIGV2ZXJ5IFNRTGl0ZSBkcml2ZXIgaW5zdGFuY2UgKG5hdGl2ZSwgd2ViLCBzcWwuanMpIGJlY2F1c2UgdGhlcmUgaXMgbm9cbiAgICogY29uY2VwdCBvZiBcImNvbm5lY3Rpb25cIiB0byBkaXN0aW5ndWlzaCB0aGVtIGF0IHRoZSBTUUxpdGUgbGV2ZWwuXG4gICAqXG4gICAqIGBvd25lcnNCeU5hbWVgIG1hcHMgZWFjaCBoZWxkIGxvY2sgbmFtZSB0byB0aGUgZHJpdmVyIGluc3RhbmNlIHRoYXRcbiAgICogYWNxdWlyZWQgaXQgc28gYHJlbGVhc2VBZHZpc29yeUxvY2tgIGNhbiByZWplY3QgcmVsZWFzZXMgZnJvbSBkcml2ZXJzXG4gICAqIHRoYXQgZG8gbm90IG93biB0aGUgbG9jay5cbiAgICogQHR5cGUge3tvd25lcnNCeU5hbWU6IE1hcDxzdHJpbmcsIFZlbG9jaW91c0RhdGFiYXNlRHJpdmVyc1NxbGl0ZUJhc2U+LCB3YWl0ZXJzQnlOYW1lOiBNYXA8c3RyaW5nLCBBcnJheTwoKSA9PiB2b2lkPj59fVxuICAgKi9cbiAgc3RhdGljIF9hZHZpc29yeUxvY2tTdGF0ZSA9IHtcbiAgICBvd25lcnNCeU5hbWU6IG5ldyBNYXAoKSxcbiAgICB3YWl0ZXJzQnlOYW1lOiBuZXcgTWFwKClcbiAgfVxuXG4gIC8qKlxuICAgKiBWZXJzaW9uIG1ham9yLlxuICAgKiBAdHlwZSB7bnVtYmVyIHwgdW5kZWZpbmVkfSAqL1xuICB2ZXJzaW9uTWFqb3IgPSB1bmRlZmluZWRcbiAgLyoqXG4gICAqIFZlcnNpb24gbWlub3IuXG4gICAqIEB0eXBlIHtudW1iZXIgfCB1bmRlZmluZWR9ICovXG4gIHZlcnNpb25NaW5vciA9IHVuZGVmaW5lZFxuICAvKipcbiAgICogVmVyc2lvbiBwYXRjaC5cbiAgICogQHR5cGUge251bWJlciB8IHVuZGVmaW5lZH0gKi9cbiAgdmVyc2lvblBhdGNoID0gdW5kZWZpbmVkXG5cbiAgLyoqXG4gICAqIFJ1bnMgYWx0ZXIgdGFibGUgc3Fscy5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi8uLi90YWJsZS1kYXRhL2luZGV4LmpzXCIpLmRlZmF1bHR9IHRhYmxlRGF0YSAtIFRhYmxlIGRhdGEuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHN0cmluZ1tdPn0gLSBSZXNvbHZlcyB3aXRoIFNRTCBzdGF0ZW1lbnRzLlxuICAgKi9cbiAgYXN5bmMgYWx0ZXJUYWJsZVNRTHModGFibGVEYXRhKSB7XG4gICAgY29uc3QgYWx0ZXJBcmdzID0ge2RyaXZlcjogdGhpcywgdGFibGVEYXRhfVxuICAgIGNvbnN0IGFsdGVyVGFibGUgPSBuZXcgQWx0ZXJUYWJsZShhbHRlckFyZ3MpXG5cbiAgICByZXR1cm4gYXdhaXQgYWx0ZXJUYWJsZS50b1NRTHMoKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgY3JlYXRlIGluZGV4IHNxbHMuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vYmFzZS5qc1wiKS5DcmVhdGVJbmRleFNxbEFyZ3N9IGluZGV4RGF0YSAtIEluZGV4IGRhdGEuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHN0cmluZ1tdPn0gLSBSZXNvbHZlcyB3aXRoIFNRTCBzdGF0ZW1lbnRzLlxuICAgKi9cbiAgYXN5bmMgY3JlYXRlSW5kZXhTUUxzKGluZGV4RGF0YSkge1xuICAgIGNvbnN0IGNyZWF0ZUFyZ3MgPSBPYmplY3QuYXNzaWduKHtkcml2ZXI6IHRoaXN9LCBpbmRleERhdGEpXG4gICAgY29uc3QgY3JlYXRlSW5kZXggPSBuZXcgQ3JlYXRlSW5kZXgoY3JlYXRlQXJncylcblxuICAgIHJldHVybiBhd2FpdCBjcmVhdGVJbmRleC50b1NRTHMoKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgcmVtb3ZlIGluZGV4IHNxbHMuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vYmFzZS5qc1wiKS5SZW1vdmVJbmRleFNxbEFyZ3N9IGluZGV4RGF0YSAtIEluZGV4IGRhdGEuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHN0cmluZ1tdPn0gLSBSZXNvbHZlcyB3aXRoIFNRTCBzdGF0ZW1lbnRzLlxuICAgKi9cbiAgYXN5bmMgcmVtb3ZlSW5kZXhTUUxzKGluZGV4RGF0YSkge1xuICAgIGNvbnN0IHJlbW92ZUFyZ3MgPSBPYmplY3QuYXNzaWduKHtkcml2ZXI6IHRoaXN9LCBpbmRleERhdGEpXG4gICAgY29uc3QgcmVtb3ZlSW5kZXggPSBuZXcgUmVtb3ZlSW5kZXgocmVtb3ZlQXJncylcblxuICAgIHJldHVybiBhd2FpdCByZW1vdmVJbmRleC50b1NRTHMoKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgY3JlYXRlIHRhYmxlIHNxbC5cbiAgICogQGFic3RyYWN0XG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vLi4vdGFibGUtZGF0YS9pbmRleC5qc1wiKS5kZWZhdWx0fSB0YWJsZURhdGEgLSBUYWJsZSBkYXRhLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxzdHJpbmdbXT59IC0gUmVzb2x2ZXMgd2l0aCBTUUwgc3RhdGVtZW50cy5cbiAgICovXG4gIGFzeW5jIGNyZWF0ZVRhYmxlU3FsKHRhYmxlRGF0YSkge1xuICAgIGNvbnN0IGNyZWF0ZUFyZ3MgPSB7dGFibGVEYXRhLCBkcml2ZXI6IHRoaXMsIGluZGV4SW5DcmVhdGVUYWJsZTogZmFsc2V9XG4gICAgY29uc3QgY3JlYXRlVGFibGUgPSBuZXcgQ3JlYXRlVGFibGUoY3JlYXRlQXJncylcblxuICAgIHJldHVybiBhd2FpdCBjcmVhdGVUYWJsZS50b1NxbCgpXG4gIH1cblxuICBjdXJyZW50RGF0YWJhc2UoKSB7XG4gICAgcmV0dXJuIG51bGxcbiAgfVxuXG4gIGFzeW5jIGRpc2FibGVGb3JlaWduS2V5cygpIHtcbiAgICBhd2FpdCB0aGlzLnF1ZXJ5KFwiUFJBR01BIGZvcmVpZ25fa2V5cyA9IDBcIilcbiAgfVxuXG4gIGFzeW5jIGVuYWJsZUZvcmVpZ25LZXlzKCkge1xuICAgIGF3YWl0IHRoaXMucXVlcnkoXCJQUkFHTUEgZm9yZWlnbl9rZXlzID0gMVwiKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZHJvcCB0YWJsZSBzcWxzLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gdGFibGVOYW1lIC0gVGFibGUgbmFtZS5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9iYXNlLmpzXCIpLkRyb3BUYWJsZVNxbEFyZ3NUeXBlfSBbYXJnc10gLSBPcHRpb25zIG9iamVjdC5cbiAgICogQHJldHVybnMge1Byb21pc2U8c3RyaW5nW10+fSAtIFJlc29sdmVzIHdpdGggU1FMIHN0YXRlbWVudHMuXG4gICAqL1xuICBhc3luYyBkcm9wVGFibGVTUUxzKHRhYmxlTmFtZSwgYXJncyA9IHt9KSB7XG4gICAgY29uc3QgZHJpdmVyID0gLyoqIEB0eXBlIHtpbXBvcnQoXCIuLi9iYXNlLmpzXCIpLmRlZmF1bHR9ICovICh0aGlzKVxuICAgIGNvbnN0IGRyb3BBcmdzID0gT2JqZWN0LmFzc2lnbih7dGFibGVOYW1lLCBkcml2ZXJ9LCBhcmdzKVxuICAgIGNvbnN0IGRyb3BUYWJsZSA9IG5ldyBEcm9wVGFibGUoZHJvcEFyZ3MpXG5cbiAgICByZXR1cm4gYXdhaXQgZHJvcFRhYmxlLnRvU1FMcygpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBkZWxldGUgc3FsLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL2Jhc2UuanNcIikuRGVsZXRlU3FsQXJnc1R5cGV9IGFyZ3MgLSBPcHRpb25zIG9iamVjdC5cbiAgICogQHJldHVybnMge3N0cmluZ30gLSBTUUwgc3RyaW5nLlxuICAgKi9cbiAgZGVsZXRlU3FsKGFyZ3MpIHsgcmV0dXJuIG5ldyBEZWxldGUoT2JqZWN0LmFzc2lnbih7ZHJpdmVyOiB0aGlzfSwgYXJncykpLnRvU3FsKCkgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGdldCB0eXBlLlxuICAgKiBAcmV0dXJucyB7c3RyaW5nfSAtIFRoZSB0eXBlLlxuICAgKi9cbiAgZ2V0VHlwZSgpIHsgcmV0dXJuIFwic3FsaXRlXCIgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGluc2VydCBzcWwuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vYmFzZS5qc1wiKS5JbnNlcnRTcWxBcmdzVHlwZX0gYXJncyAtIE9wdGlvbnMgb2JqZWN0LlxuICAgKiBAcmV0dXJucyB7c3RyaW5nfSAtIFNRTCBzdHJpbmcuXG4gICAqL1xuICBpbnNlcnRTcWwoYXJncykgeyByZXR1cm4gbmV3IEluc2VydChPYmplY3QuYXNzaWduKHtkcml2ZXI6IHRoaXN9LCBhcmdzKSkudG9TcWwoKSB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZ2V0IHRhYmxlcy5cbiAgICogQHJldHVybnMge1Byb21pc2U8QXJyYXk8aW1wb3J0KFwiLi4vYmFzZS10YWJsZS5qc1wiKS5kZWZhdWx0Pj59IC0gUmVzb2x2ZXMgd2l0aCB0aGUgdGFibGVzLlxuICAgKi9cbiAgYXN5bmMgZ2V0VGFibGVzKCkge1xuICAgIHJldHVybiBhd2FpdCB0aGlzLl9jYWNoZWRTY2hlbWFNZXRhZGF0YShcInRhYmxlc1wiLCBhc3luYyAoKSA9PiB7XG4gICAgICBjb25zdCByZXN1bHQgPSBhd2FpdCB0aGlzLnF1ZXJ5KFwiU0VMRUNUIG5hbWUgRlJPTSBzcWxpdGVfbWFzdGVyIFdIRVJFIHR5cGUgPSAndGFibGUnIE9SREVSIEJZIG5hbWVcIilcbiAgICAgIGNvbnN0IHRhYmxlcyA9IFtdXG5cbiAgICAgIGZvciAoY29uc3Qgcm93IG9mIHJlc3VsdCkge1xuICAgICAgICBjb25zdCB0YWJsZSA9IG5ldyBUYWJsZSh7ZHJpdmVyOiB0aGlzLCByb3c6IC8qKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgc3RyaW5nIHwgbnVtYmVyIHwgbnVsbD59ICovIChyb3cpfSlcblxuICAgICAgICB0YWJsZXMucHVzaCh0YWJsZSlcbiAgICAgIH1cblxuICAgICAgcmV0dXJuIHRhYmxlc1xuICAgIH0pXG4gIH1cblxuICAvKipcbiAgICogRGVsZXRlcyBldmVyeSBlbGlnaWJsZSB0YWJsZSB0aHJvdWdoIHRoZSBwbGF0Zm9ybSBkcml2ZXIncyBuYXRpdmUgU1FMaXRlXG4gICAqIHNjcmlwdCBwYXRoIHNvIHRoZSB3aG9sZSBjbGVhbnVwIGlzIHN1Ym1pdHRlZCBhcyBvbmUgcmVxdWVzdC5cbiAgICogQHBhcmFtIHtBcnJheTxpbXBvcnQoXCIuLi9iYXNlLXRhYmxlLmpzXCIpLmRlZmF1bHQ+fSB0YWJsZXMgLSBFbGlnaWJsZSB0YWJsZXMuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIHdoZW4gdGhlIHNjcmlwdCBjb21wbGV0ZXMuXG4gICAqL1xuICBhc3luYyB0cnVuY2F0ZVRhYmxlcyh0YWJsZXMpIHtcbiAgICBjb25zdCBzdGF0ZW1lbnRzID0gdGFibGVzLm1hcCgodGFibGUpID0+IGBERUxFVEUgRlJPTSAke3RoaXMucXVvdGVUYWJsZSh0YWJsZS5nZXROYW1lKCkpfWApXG5cbiAgICBhd2FpdCB0aGlzLnF1ZXJ5KHN0YXRlbWVudHMuam9pbihcIjtcXG5cIiksIHtzcWxpdGVTY3JpcHQ6IHRydWV9KVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgaW5zZXJ0IG11bHRpcGxlLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gdGFibGVOYW1lIC0gVGFibGUgbmFtZS5cbiAgICogQHBhcmFtIHtBcnJheTxzdHJpbmc+fSBjb2x1bW5zIC0gQ29sdW1uIG5hbWVzLlxuICAgKiBAcGFyYW0ge0FycmF5PEFycmF5PFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pj59IHJvd3MgLSBSb3dzIHRvIGluc2VydC5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgd2hlbiBjb21wbGV0ZS5cbiAgICovXG4gIGFzeW5jIGluc2VydE11bHRpcGxlKHRhYmxlTmFtZSwgY29sdW1ucywgcm93cykge1xuICAgIHRoaXMuX2Fzc2VydE5vdFJlYWRPbmx5KClcbiAgICBhd2FpdCB0aGlzLnJlZ2lzdGVyVmVyc2lvbigpXG5cbiAgICBpZiAodGhpcy5zdXBwb3J0c011bHRpcGxlSW5zZXJ0VmFsdWVzKCkpIHtcbiAgICAgIGF3YWl0IHRoaXMuaW5zZXJ0TXVsdGlwbGVXaXRoU2luZ2xlSW5zZXJ0KHRhYmxlTmFtZSwgY29sdW1ucywgcm93cylcbiAgICB9IGVsc2Uge1xuICAgICAgYXdhaXQgdGhpcy5pbnNlcnRNdWx0aXBsZVdpdGhUcmFuc2FjdGlvbih0YWJsZU5hbWUsIGNvbHVtbnMsIHJvd3MpXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgc3VwcG9ydHMgbXVsdGlwbGUgaW5zZXJ0IHZhbHVlcy5cbiAgICogQHJldHVybnMge2Jvb2xlYW59IC0gV2hldGhlciBzdXBwb3J0cyBtdWx0aXBsZSBpbnNlcnQgdmFsdWVzLlxuICAgKi9cbiAgc3VwcG9ydHNNdWx0aXBsZUluc2VydFZhbHVlcygpIHtcbiAgICAvKipcbiAgICAgKiBWZXJzaW9uIG1ham9yLlxuICAgICAqIEB0eXBlIHtudW1iZXJ9ICovXG4gICAgY29uc3QgdmVyc2lvbk1ham9yID0gdGhpcy52ZXJzaW9uTWFqb3IgfHwgMFxuICAgIC8qKlxuICAgICAqIFZlcnNpb24gbWlub3IuXG4gICAgICogQHR5cGUge251bWJlcn0gKi9cbiAgICBjb25zdCB2ZXJzaW9uTWlub3IgPSB0aGlzLnZlcnNpb25NaW5vciB8fCAwXG4gICAgLyoqXG4gICAgICogVmVyc2lvbiBwYXRjaC5cbiAgICAgKiBAdHlwZSB7bnVtYmVyfSAqL1xuICAgIGNvbnN0IHZlcnNpb25QYXRjaCA9IHRoaXMudmVyc2lvblBhdGNoIHx8IDBcblxuICAgIGlmICh2ZXJzaW9uTWFqb3IgPj0gNCkgcmV0dXJuIHRydWVcbiAgICBpZiAodmVyc2lvbk1ham9yID09IDMgJiYgdmVyc2lvbk1pbm9yID49IDgpIHJldHVybiB0cnVlXG4gICAgaWYgKHZlcnNpb25NYWpvciA9PSAzICYmIHZlcnNpb25NaW5vciA9PSA3ICYmIHZlcnNpb25QYXRjaCA+PSAxMSkgcmV0dXJuIHRydWVcblxuICAgIHJldHVybiBmYWxzZVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgc3VwcG9ydHMgaW5zZXJ0IGludG8gcmV0dXJuaW5nLlxuICAgKiBAcmV0dXJucyB7Ym9vbGVhbn0gLSBXaGV0aGVyIHN1cHBvcnRzIGluc2VydCBpbnRvIHJldHVybmluZy5cbiAgICovXG4gIHN1cHBvcnRzSW5zZXJ0SW50b1JldHVybmluZygpIHtcbiAgICAvKipcbiAgICAgKiBWZXJzaW9uIG1ham9yLlxuICAgICAqIEB0eXBlIHtudW1iZXJ9ICovXG4gICAgY29uc3QgdmVyc2lvbk1ham9yID0gdGhpcy52ZXJzaW9uTWFqb3IgfHwgMFxuICAgIC8qKlxuICAgICAqIFZlcnNpb24gbWlub3IuXG4gICAgICogQHR5cGUge251bWJlcn0gKi9cbiAgICBjb25zdCB2ZXJzaW9uTWlub3IgPSB0aGlzLnZlcnNpb25NaW5vciB8fCAwXG5cbiAgICBpZiAodmVyc2lvbk1ham9yID49IDQpIHJldHVybiB0cnVlXG4gICAgaWYgKHZlcnNpb25NYWpvciA9PSAzICYmIHZlcnNpb25NaW5vciA+PSAzNSkgcmV0dXJuIHRydWVcblxuICAgIHJldHVybiBmYWxzZVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgaW5zZXJ0IG11bHRpcGxlIHdpdGggc2luZ2xlIGluc2VydC5cbiAgICogQHBhcmFtIHtzdHJpbmd9IHRhYmxlTmFtZSAtIFRhYmxlIG5hbWUuXG4gICAqIEBwYXJhbSB7QXJyYXk8c3RyaW5nPn0gY29sdW1ucyAtIENvbHVtbiBuYW1lcy5cbiAgICogQHBhcmFtIHtBcnJheTxBcnJheTxSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj4+fSByb3dzIC0gUm93cyB0byBpbnNlcnQuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIHdoZW4gY29tcGxldGUuXG4gICAqL1xuICBhc3luYyBpbnNlcnRNdWx0aXBsZVdpdGhTaW5nbGVJbnNlcnQodGFibGVOYW1lLCBjb2x1bW5zLCByb3dzKSB7XG4gICAgdGhpcy5fYXNzZXJ0Tm90UmVhZE9ubHkoKVxuXG4gICAgY29uc3QgY2h1bmtzID0gdGhpcy5faW5zZXJ0TXVsdGlwbGVDaHVua3Mocm93cywgKGNodW5rUm93cykgPT4gbmV3IEluc2VydCh7Y29sdW1ucywgZHJpdmVyOiB0aGlzLCByb3dzOiBjaHVua1Jvd3MsIHRhYmxlTmFtZX0pLnRvU3FsKCkpXG5cbiAgICBmb3IgKGNvbnN0IGNodW5rIG9mIGNodW5rcykge1xuICAgICAgY29uc3Qgc3FsID0gbmV3IEluc2VydCh7Y29sdW1ucywgZHJpdmVyOiB0aGlzLCByb3dzOiBjaHVuaywgdGFibGVOYW1lfSkudG9TcWwoKVxuXG4gICAgICBhd2FpdCB0aGlzLnF1ZXJ5KHNxbClcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogUnVucyBpbnNlcnQgbXVsdGlwbGUgd2l0aCB0cmFuc2FjdGlvbi5cbiAgICogQHBhcmFtIHtzdHJpbmd9IHRhYmxlTmFtZSAtIFRhYmxlIG5hbWUuXG4gICAqIEBwYXJhbSB7QXJyYXk8c3RyaW5nPn0gY29sdW1ucyAtIENvbHVtbiBuYW1lcy5cbiAgICogQHBhcmFtIHtBcnJheTxBcnJheTxSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj4+fSByb3dzIC0gUm93cyB0byBpbnNlcnQuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIHdoZW4gY29tcGxldGUuXG4gICAqL1xuICBhc3luYyBpbnNlcnRNdWx0aXBsZVdpdGhUcmFuc2FjdGlvbih0YWJsZU5hbWUsIGNvbHVtbnMsIHJvd3MpIHtcbiAgICB0aGlzLl9hc3NlcnROb3RSZWFkT25seSgpXG4gICAgLyoqXG4gICAgICogU3Fscy5cbiAgICAgKiBAdHlwZSB7c3RyaW5nW119ICovXG4gICAgY29uc3Qgc3FscyA9IFtdXG5cbiAgICBmb3IgKGNvbnN0IHJvdyBvZiByb3dzKSB7XG4gICAgICAvKipcbiAgICAgICAqIERhdGEuXG4gICAgICAgKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSAqL1xuICAgICAgY29uc3QgZGF0YSA9IHt9XG5cbiAgICAgIGZvciAoY29uc3QgY29sdW1uSW5kZXggaW4gY29sdW1ucykge1xuICAgICAgICBjb25zdCBjb2x1bW5OYW1lID0gY29sdW1uc1tjb2x1bW5JbmRleF1cbiAgICAgICAgY29uc3QgdmFsdWUgPSByb3dbY29sdW1uSW5kZXhdXG5cbiAgICAgICAgZGF0YVtjb2x1bW5OYW1lXSA9IHZhbHVlXG4gICAgICB9XG5cbiAgICAgIGNvbnN0IGluc2VydFNxbCA9IHRoaXMuaW5zZXJ0U3FsKHt0YWJsZU5hbWUsIGRhdGF9KVxuXG4gICAgICBzcWxzLnB1c2goaW5zZXJ0U3FsKVxuICAgIH1cblxuICAgIGF3YWl0IHRoaXMudHJhbnNhY3Rpb24oYXN5bmMgKCkgPT4ge1xuICAgICAgZm9yIChjb25zdCBzcWwgb2Ygc3Fscykge1xuICAgICAgICBhd2FpdCB0aGlzLnF1ZXJ5KHNxbClcbiAgICAgIH1cbiAgICB9KVxuICB9XG5cbiAgYXN5bmMgbGFzdEluc2VydElEKG9wdGlvbnMgPSB7fSkge1xuICAgIGNvbnN0IHJlc3VsdCA9IGF3YWl0IHRoaXMucXVlcnkoXCJTRUxFQ1QgTEFTVF9JTlNFUlRfUk9XSUQoKSBBUyBsYXN0X2luc2VydF9pZFwiLCBvcHRpb25zKVxuXG4gICAgcmV0dXJuIGRpZ2cocmVzdWx0LCAwLCBcImxhc3RfaW5zZXJ0X2lkXCIpXG4gIH1cblxuICBvcHRpb25zKCkge1xuICAgIGlmICghdGhpcy5fb3B0aW9ucykgdGhpcy5fb3B0aW9ucyA9IG5ldyBPcHRpb25zKHRoaXMpXG5cbiAgICByZXR1cm4gdGhpcy5fb3B0aW9uc1xuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgcXVlcnkgdG8gc3FsLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uLy4uL3F1ZXJ5L2luZGV4LmpzXCIpLmRlZmF1bHR9IHF1ZXJ5IC0gUXVlcnkgaW5zdGFuY2UuXG4gICAqIEByZXR1cm5zIHtzdHJpbmd9IC0gU1FMIHN0cmluZy5cbiAgICovXG4gIHF1ZXJ5VG9TcWwocXVlcnkpIHsgcmV0dXJuIG5ldyBRdWVyeVBhcnNlcih7cXVlcnl9KS50b1NxbCgpIH1cblxuICBhc3luYyByZWdpc3RlclZlcnNpb24oKSB7XG4gICAgaWYgKHRoaXMudmVyc2lvbk1ham9yIHx8IHRoaXMudmVyc2lvbk1pbm9yKSB7XG4gICAgICByZXR1cm5cbiAgICB9XG5cbiAgICBjb25zdCB2ZXJzaW9uUmVzdWx0ID0gYXdhaXQgdGhpcy5xdWVyeShcIlNFTEVDVCBzcWxpdGVfdmVyc2lvbigpIEFTIHZlcnNpb25cIilcblxuICAgIHRoaXMudmVyc2lvbiA9IFN0cmluZyh2ZXJzaW9uUmVzdWx0WzBdLnZlcnNpb24pXG5cbiAgICBjb25zdCB2ZXJzaW9uUGFydHMgPSB0aGlzLnZlcnNpb24uc3BsaXQoXCIuXCIpXG5cbiAgICB0aGlzLnZlcnNpb25NYWpvciA9IE51bWJlcih2ZXJzaW9uUGFydHNbMF0pXG4gICAgdGhpcy52ZXJzaW9uTWlub3IgPSBOdW1iZXIodmVyc2lvblBhcnRzWzFdKVxuICAgIHRoaXMudmVyc2lvblBhdGNoID0gTnVtYmVyKHZlcnNpb25QYXJ0c1syXSlcbiAgfVxuXG4gIHNob3VsZFNldEF1dG9JbmNyZW1lbnRXaGVuUHJpbWFyeUtleSgpIHsgcmV0dXJuIGZhbHNlIH1cbiAgc3VwcG9ydHNEZWZhdWx0UHJpbWFyeUtleVVVSUQoKSB7IHJldHVybiBmYWxzZSB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZXNjYXBlLlxuICAgKiBAcGFyYW0ge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSB2YWx1ZSAtIFZhbHVlIHRvIHVzZS5cbiAgICogQHJldHVybnMge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSAtIFRoZSBlc2NhcGUuXG4gICAqL1xuICBlc2NhcGUodmFsdWUpIHtcbiAgICB2YWx1ZSA9IHRoaXMuX2NvbnZlcnRWYWx1ZSh2YWx1ZSlcblxuICAgIGNvbnN0IHR5cGUgPSB0eXBlb2YgdmFsdWVcblxuICAgIGlmICh0eXBlICE9IFwic3RyaW5nXCIpIHZhbHVlID0gYCR7dmFsdWV9YFxuXG4gICAgY29uc3QgcmVzdWx0V2l0aFF1b3RlcyA9IGVzY2FwZVN0cmluZyh2YWx1ZSwgbnVsbClcbiAgICBjb25zdCByZXN1bHQgPSByZXN1bHRXaXRoUXVvdGVzLnN1YnN0cmluZygxLCByZXN1bHRXaXRoUXVvdGVzLmxlbmd0aCAtIDEpXG5cbiAgICByZXR1cm4gcmVzdWx0XG4gIH1cblxuICAvKipcbiAgICogUnVucyByZXRyeWFibGUgZGF0YWJhc2UgZXJyb3IuXG4gICAqIEBwYXJhbSB7RXJyb3J9IGVycm9yIC0gRXJyb3IgaW5zdGFuY2UuXG4gICAqIEByZXR1cm5zIHtpbXBvcnQoXCIuLi9iYXNlLmpzXCIpLlJldHJ5YWJsZURhdGFiYXNlRXJyb3JSZXN1bHR9IC0gUmV0cnkgaW5mby5cbiAgICovXG4gIHJldHJ5YWJsZURhdGFiYXNlRXJyb3IoZXJyb3IpIHtcbiAgICBjb25zdCBkYXRhYmFzZUxvY2tlZCA9IEJvb2xlYW4oZXJyb3IubWVzc2FnZT8uaW5jbHVkZXMoXCJkYXRhYmFzZSBpcyBsb2NrZWRcIikpXG4gICAgY29uc3Qgc2hvdWxkUmV0cnkgPSAoXG4gICAgICBlcnJvci5tZXNzYWdlPy5zdGFydHNXaXRoKFwiYXR0ZW1wdCB0byB3cml0ZSBhIHJlYWRvbmx5IGRhdGFiYXNlXCIpIHx8XG4gICAgICBkYXRhYmFzZUxvY2tlZFxuICAgIClcblxuICAgIHJldHVybiB7ZGVhZGxvY2s6IGRhdGFiYXNlTG9ja2VkLCByZXRyeTogc2hvdWxkUmV0cnksIHJlY29ubmVjdDogZmFsc2V9XG4gIH1cblxuICAvKipcbiAgICogUnVucyBxdW90ZS5cbiAgICogQHBhcmFtIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gdmFsdWUgLSBWYWx1ZSB0byB1c2UuXG4gICAqIEByZXR1cm5zIHtzdHJpbmcgfCBudW1iZXJ9IC0gVGhlIHF1b3RlZCB2YWx1ZS5cbiAgICovXG4gIHF1b3RlKHZhbHVlKSB7XG4gICAgdmFsdWUgPSB0aGlzLl9jb252ZXJ0VmFsdWUodmFsdWUpXG5cbiAgICBjb25zdCB0eXBlID0gdHlwZW9mIHZhbHVlXG5cbiAgICBpZiAodHlwZSA9PSBcIm51bWJlclwiKSByZXR1cm4gLyoqIEB0eXBlIHtudW1iZXJ9ICovICh2YWx1ZSlcbiAgICBpZiAodHlwZSAhPSBcInN0cmluZ1wiKSB2YWx1ZSA9IFN0cmluZyh2YWx1ZSlcblxuICAgIHJldHVybiBlc2NhcGVTdHJpbmcodmFsdWUsIG51bGwpXG4gIH1cblxuICAvKipcbiAgICogUnVucyB1cGRhdGUgc3FsLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL2Jhc2UuanNcIikuVXBkYXRlU3FsQXJnc1R5cGV9IGFyZ3MgLSBPcHRpb25zIG9iamVjdC5cbiAgICogQHJldHVybnMge3N0cmluZ30gLSBTUUwgc3RyaW5nLlxuICAgKi9cbiAgdXBkYXRlU3FsKHtjb25kaXRpb25zLCBkYXRhLCB0YWJsZU5hbWV9KSB7IHJldHVybiBuZXcgVXBkYXRlKHtjb25kaXRpb25zLCBkYXRhLCBkcml2ZXI6IHRoaXMsIHRhYmxlTmFtZX0pLnRvU3FsKCkgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHVwc2VydCBzcWwuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vYmFzZS5qc1wiKS5VcHNlcnRTcWxBcmdzVHlwZX0gYXJncyAtIE9wdGlvbnMgb2JqZWN0LlxuICAgKiBAcmV0dXJucyB7c3RyaW5nfSAtIFNRTCBzdHJpbmcuXG4gICAqL1xuICB1cHNlcnRTcWwoYXJncykgeyByZXR1cm4gbmV3IFVwc2VydCh7Li4uYXJncywgZHJpdmVyOiB0aGlzfSkudG9TcWwoKSB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgc3RydWN0dXJlIHNxbC5cbiAgICogQHJldHVybnMge1Byb21pc2U8c3RyaW5nIHwgbnVsbD59IC0gUmVzb2x2ZXMgd2l0aCBTUUwgc3RyaW5nLlxuICAgKi9cbiAgYXN5bmMgc3RydWN0dXJlU3FsKCkge1xuICAgIHJldHVybiBhd2FpdCB0aGlzLl9jYWNoZWRTY2hlbWFNZXRhZGF0YShcInN0cnVjdHVyZVNxbFwiLCBhc3luYyAoKSA9PiBhd2FpdCBuZXcgU3RydWN0dXJlU3FsKHtkcml2ZXI6IHRoaXN9KS50b1NxbCgpKVxuICB9XG5cbiAgLyoqXG4gICAqIEJsb2NrcyB1bnRpbCBhbiBpbi1wcm9jZXNzIGFkdmlzb3J5IGxvY2sgd2l0aCB0aGUgZ2l2ZW4gbmFtZSBpc1xuICAgKiBhY3F1aXJlZC4gU1FMaXRlIGhhcyBubyBidWlsdC1pbiBhZHZpc29yeSBsb2NrIHByaW1pdGl2ZSwgc28gdGhpcyBpc1xuICAgKiBpbXBsZW1lbnRlZCBhcyBhIHByb2Nlc3MtbG9jYWwgd2FpdGVyIHF1ZXVlLiBUeXBpY2FsIFNRTGl0ZSBkZXBsb3ltZW50c1xuICAgKiBydW4gaW5zaWRlIGEgc2luZ2xlIE5vZGUgcHJvY2Vzcywgd2hpY2ggaXMgZXhhY3RseSB0aGUgc2NvcGUgdGhpc1xuICAgKiBlbXVsYXRpb24gY292ZXJzOyBtdWx0aS1wcm9jZXNzIFNRTGl0ZSBzZXR1cHMgc2hvdWxkIG5vdCByZWx5IG9uIHRoaXNcbiAgICogZm9yIGNyb3NzLXByb2Nlc3MgbXV0dWFsIGV4Y2x1c2lvbi5cbiAgICpcbiAgICogVGhlIG93bmluZyBkcml2ZXIgaW5zdGFuY2UgaXMgcmVjb3JkZWQgc28gdGhhdCBgcmVsZWFzZUFkdmlzb3J5TG9ja2BcbiAgICogY2FuIHJlZnVzZSB0byByZWxlYXNlIGEgbG9jayB0aGF0IHdhcyBhY3F1aXJlZCBieSBzb21lb25lIGVsc2UuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBuYW1lIC0gTG9jayBuYW1lLlxuICAgKiBAcGFyYW0ge3t0aW1lb3V0TXM/OiBudW1iZXIgfCBudWxsfX0gW2FyZ3NdIC0gT3B0aW9uYWwgdGltZW91dCBpbiBtaWxsaXNlY29uZHM7IGBudWxsYCwgYHVuZGVmaW5lZGAsIG9yIG5lZ2F0aXZlIGJsb2NrcyBmb3JldmVyLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxib29sZWFuPn0gLSBUcnVlIGlmIHRoZSBsb2NrIHdhcyBhY3F1aXJlZCwgZmFsc2UgaWYgdGhlIHRpbWVvdXQgZWxhcHNlZC5cbiAgICovXG4gIGFzeW5jIF9hY3F1aXJlQWR2aXNvcnlMb2NrKG5hbWUsIHt0aW1lb3V0TXN9ID0ge30pIHtcbiAgICBjb25zdCBzdGF0ZSA9IFZlbG9jaW91c0RhdGFiYXNlRHJpdmVyc1NxbGl0ZUJhc2UuX2Fkdmlzb3J5TG9ja1N0YXRlXG5cbiAgICB3aGlsZSAoc3RhdGUub3duZXJzQnlOYW1lLmhhcyhuYW1lKSkge1xuICAgICAgbGV0IHJlbWFpbmluZ01zID0gbnVsbFxuXG4gICAgICBpZiAodHlwZW9mIHRpbWVvdXRNcyA9PT0gXCJudW1iZXJcIiAmJiB0aW1lb3V0TXMgPj0gMCkge1xuICAgICAgICByZW1haW5pbmdNcyA9IHRpbWVvdXRNc1xuXG4gICAgICAgIGlmIChyZW1haW5pbmdNcyA8PSAwKSByZXR1cm4gZmFsc2VcbiAgICAgIH1cblxuICAgICAgYXdhaXQgbmV3IFByb21pc2UoKHJlc29sdmUpID0+IHtcbiAgICAgICAgY29uc3Qgd2FpdGVycyA9IHN0YXRlLndhaXRlcnNCeU5hbWUuZ2V0KG5hbWUpIHx8IFtdXG4gICAgICAgIC8qKlxuICAgICAgICAgKiBUaW1lb3V0IGhhbmRsZS5cbiAgICAgICAgICogQHR5cGUge1JldHVyblR5cGU8dHlwZW9mIHNldFRpbWVvdXQ+IHwgbnVsbH0gKi9cbiAgICAgICAgbGV0IHRpbWVvdXRIYW5kbGUgPSBudWxsXG4gICAgICAgIC8qKlxuICAgICAgICAgKiBSZW1vdmUgYW5kIHJlc29sdmUuXG4gICAgICAgICAqIEB0eXBlIHsoKCkgPT4gdm9pZCkgfCBudWxsfSAqL1xuICAgICAgICBsZXQgcmVtb3ZlQW5kUmVzb2x2ZSA9IG51bGxcblxuICAgICAgICByZW1vdmVBbmRSZXNvbHZlID0gKCkgPT4ge1xuICAgICAgICAgIGlmICh0aW1lb3V0SGFuZGxlKSBjbGVhclRpbWVvdXQodGltZW91dEhhbmRsZSlcblxuICAgICAgICAgIGNvbnN0IGN1cnJlbnQgPSBzdGF0ZS53YWl0ZXJzQnlOYW1lLmdldChuYW1lKSB8fCBbXVxuICAgICAgICAgIGNvbnN0IGluZGV4ID0gY3VycmVudC5pbmRleE9mKC8qKiBAdHlwZSB7KCkgPT4gdm9pZH0gKi8gKHJlbW92ZUFuZFJlc29sdmUpKVxuXG4gICAgICAgICAgaWYgKGluZGV4ID49IDApIGN1cnJlbnQuc3BsaWNlKGluZGV4LCAxKVxuICAgICAgICAgIGlmIChjdXJyZW50Lmxlbmd0aCA9PT0gMCkgc3RhdGUud2FpdGVyc0J5TmFtZS5kZWxldGUobmFtZSlcblxuICAgICAgICAgIHJlc29sdmUodW5kZWZpbmVkKVxuICAgICAgICB9XG5cbiAgICAgICAgd2FpdGVycy5wdXNoKHJlbW92ZUFuZFJlc29sdmUpXG4gICAgICAgIHN0YXRlLndhaXRlcnNCeU5hbWUuc2V0KG5hbWUsIHdhaXRlcnMpXG5cbiAgICAgICAgaWYgKHJlbWFpbmluZ01zICE9PSBudWxsKSB7XG4gICAgICAgICAgdGltZW91dEhhbmRsZSA9IHNldFRpbWVvdXQoKCkgPT4ge1xuICAgICAgICAgICAgaWYgKHJlbW92ZUFuZFJlc29sdmUpIHJlbW92ZUFuZFJlc29sdmUoKVxuICAgICAgICAgIH0sIHJlbWFpbmluZ01zKVxuICAgICAgICB9XG4gICAgICB9KVxuXG4gICAgICBpZiAodHlwZW9mIHRpbWVvdXRNcyA9PT0gXCJudW1iZXJcIiAmJiB0aW1lb3V0TXMgPj0gMCAmJiBzdGF0ZS5vd25lcnNCeU5hbWUuaGFzKG5hbWUpKSB7XG4gICAgICAgIHJldHVybiBmYWxzZVxuICAgICAgfVxuICAgIH1cblxuICAgIHN0YXRlLm93bmVyc0J5TmFtZS5zZXQobmFtZSwgdGhpcylcblxuICAgIHJldHVybiB0cnVlXG4gIH1cblxuICAvKipcbiAgICogUnVucyB0cnkgYWNxdWlyZSBhZHZpc29yeSBsb2NrLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gbmFtZSAtIExvY2sgbmFtZS5cbiAgICogQHJldHVybnMge1Byb21pc2U8Ym9vbGVhbj59IC0gVHJ1ZSBpZiB0aGUgbG9jayB3YXMgYWNxdWlyZWQsIGZhbHNlIGlmIGl0IHdhcyBhbHJlYWR5IGhlbGQuXG4gICAqL1xuICBhc3luYyBfdHJ5QWNxdWlyZUFkdmlzb3J5TG9jayhuYW1lKSB7XG4gICAgY29uc3Qgc3RhdGUgPSBWZWxvY2lvdXNEYXRhYmFzZURyaXZlcnNTcWxpdGVCYXNlLl9hZHZpc29yeUxvY2tTdGF0ZVxuXG4gICAgaWYgKHN0YXRlLm93bmVyc0J5TmFtZS5oYXMobmFtZSkpIHJldHVybiBmYWxzZVxuXG4gICAgc3RhdGUub3duZXJzQnlOYW1lLnNldChuYW1lLCB0aGlzKVxuXG4gICAgcmV0dXJuIHRydWVcbiAgfVxuXG4gIC8qKlxuICAgKiBSZWxlYXNlcyB0aGUgbG9jayBvbmx5IGlmICoqdGhpcyoqIGRyaXZlciBpbnN0YW5jZSBvd25zIGl0LiBDYWxsaW5nXG4gICAqIHJlbGVhc2UgZm9yIGEgbG9jayBvd25lZCBieSBhbm90aGVyIGRyaXZlciBpbnN0YW5jZSBpcyBhIG5vLW9wIHRoYXRcbiAgICogcmV0dXJucyBgZmFsc2VgLCBtYXRjaGluZyB0aGUgXCJ5b3UgY2FuIG9ubHkgcmVsZWFzZSBsb2NrcyB5b3Ugb3duXCJcbiAgICogY29udHJhY3Qgb2YgTXlTUUwncyBgUkVMRUFTRV9MT0NLYCBhbmQgUG9zdGdyZVNRTCdzXG4gICAqIGBwZ19hZHZpc29yeV91bmxvY2tgLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gbmFtZSAtIExvY2sgbmFtZS5cbiAgICogQHJldHVybnMge1Byb21pc2U8Ym9vbGVhbj59IC0gVHJ1ZSBpZiB0aGUgbG9jayB3YXMgaGVsZCBieSB0aGlzIGRyaXZlciBhbmQgaGFzIG5vdyBiZWVuIHJlbGVhc2VkLlxuICAgKi9cbiAgYXN5bmMgX3JlbGVhc2VBZHZpc29yeUxvY2sobmFtZSkge1xuICAgIGNvbnN0IHN0YXRlID0gVmVsb2Npb3VzRGF0YWJhc2VEcml2ZXJzU3FsaXRlQmFzZS5fYWR2aXNvcnlMb2NrU3RhdGVcbiAgICBjb25zdCBvd25lciA9IHN0YXRlLm93bmVyc0J5TmFtZS5nZXQobmFtZSlcblxuICAgIGlmIChvd25lciAhPT0gdGhpcykgcmV0dXJuIGZhbHNlXG5cbiAgICBzdGF0ZS5vd25lcnNCeU5hbWUuZGVsZXRlKG5hbWUpXG5cbiAgICBjb25zdCB3YWl0ZXJzID0gc3RhdGUud2FpdGVyc0J5TmFtZS5nZXQobmFtZSlcblxuICAgIGlmICh3YWl0ZXJzICYmIHdhaXRlcnMubGVuZ3RoID4gMCkge1xuICAgICAgY29uc3QgbmV4dFdhaXRlciA9IHdhaXRlcnMuc2hpZnQoKVxuXG4gICAgICBpZiAod2FpdGVycy5sZW5ndGggPT09IDApIHN0YXRlLndhaXRlcnNCeU5hbWUuZGVsZXRlKG5hbWUpXG4gICAgICBpZiAobmV4dFdhaXRlcikgbmV4dFdhaXRlcigpXG4gICAgfVxuXG4gICAgcmV0dXJuIHRydWVcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGlzIGFkdmlzb3J5IGxvY2sgaGVsZC5cbiAgICogQHBhcmFtIHtzdHJpbmd9IG5hbWUgLSBMb2NrIG5hbWUuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPGJvb2xlYW4+fSAtIFRydWUgaWYgYW55IGRyaXZlciBpbnN0YW5jZSBjdXJyZW50bHkgaG9sZHMgdGhlIGxvY2suXG4gICAqL1xuICBhc3luYyBpc0Fkdmlzb3J5TG9ja0hlbGQobmFtZSkge1xuICAgIHJldHVybiBWZWxvY2lvdXNEYXRhYmFzZURyaXZlcnNTcWxpdGVCYXNlLl9hZHZpc29yeUxvY2tTdGF0ZS5vd25lcnNCeU5hbWUuaGFzKG5hbWUpXG4gIH1cbn1cbiJdfQ==