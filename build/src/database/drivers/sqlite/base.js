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
    /**
     * The SQLite emulation is the process-local tier of the STC-210 chain.
     * @returns {string} - Tier name reported on telemetry payloads.
     */
    advisoryLockBackendTier() {
        return "process-local";
    }
    /**
     * Attribute the named lock to the driver instance that owns it in the
     * shared in-process registry (best-effort; the caller guards failures).
     * @param {string} name - Lock name.
     * @returns {Promise<string | null>} - Owning driver's holder id, or null when no instance holds the lock.
     */
    async advisoryLockHolderConnectionId(name) {
        const owner = VelociousDatabaseDriversSqliteBase._advisoryLockState.ownersByName.get(name);
        return owner ? owner.advisoryLockHolderId() : null;
    }
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiYmFzZS5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uLy4uLy4uLy4uLy4uL3NyYy9kYXRhYmFzZS9kcml2ZXJzL3NxbGl0ZS9iYXNlLmpzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiJBQUFBLFlBQVk7QUFFWixPQUFPLEVBQUMsSUFBSSxFQUFDLE1BQU0sV0FBVyxDQUFBO0FBRTlCLE9BQU8sVUFBVSxNQUFNLHNCQUFzQixDQUFBO0FBQzdDLE9BQU8sSUFBSSxNQUFNLFlBQVksQ0FBQTtBQUM3QixPQUFPLFdBQVcsTUFBTSx1QkFBdUIsQ0FBQTtBQUMvQyxPQUFPLFdBQVcsTUFBTSx1QkFBdUIsQ0FBQTtBQUMvQyxPQUFPLE1BQU0sTUFBTSxpQkFBaUIsQ0FBQTtBQUNwQyxPQUFPLFNBQVMsTUFBTSxxQkFBcUIsQ0FBQTtBQUMzQyxPQUFPLFlBQVksTUFBTSxtQkFBbUIsQ0FBQTtBQUM1QyxPQUFPLE1BQU0sTUFBTSxpQkFBaUIsQ0FBQTtBQUNwQyxPQUFPLE9BQU8sTUFBTSxjQUFjLENBQUE7QUFDbEMsT0FBTyxXQUFXLE1BQU0sbUJBQW1CLENBQUE7QUFDM0MsT0FBTyxXQUFXLE1BQU0sdUJBQXVCLENBQUE7QUFDL0MsT0FBTyxLQUFLLE1BQU0sWUFBWSxDQUFBO0FBQzlCLE9BQU8sWUFBWSxNQUFNLG9CQUFvQixDQUFBO0FBQzdDLE9BQU8sTUFBTSxNQUFNLGlCQUFpQixDQUFBO0FBQ3BDLE9BQU8sTUFBTSxNQUFNLGlCQUFpQixDQUFBO0FBRXBDLE1BQU0sQ0FBQyxPQUFPLE9BQU8sa0NBQW1DLFNBQVEsSUFBSTtJQUNsRTs7Ozs7Ozs7O09BU0c7SUFDSCxNQUFNLENBQUMsa0JBQWtCLEdBQUc7UUFDMUIsWUFBWSxFQUFFLElBQUksR0FBRyxFQUFFO1FBQ3ZCLGFBQWEsRUFBRSxJQUFJLEdBQUcsRUFBRTtLQUN6QixDQUFBO0lBRUQ7O29DQUVnQztJQUNoQyxZQUFZLEdBQUcsU0FBUyxDQUFBO0lBQ3hCOztvQ0FFZ0M7SUFDaEMsWUFBWSxH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Q0FBQTtJQUNyRixDQUFDO0lBRUQ7OztPQUdHO0lBQ0gsdUJBQXVCO1FBQ3JCLE9BQU8sZUFBZSxDQUFBO0lBQ3hCLENBQUM7SUFFRDs7Ozs7T0FLRztJQUNILEtBQUssQ0FBQyw4QkFBOEIsQ0FBQyxJQUFJO1FBQ3ZDLE1BQU0sS0FBSyxHQUFHLGtDQUFrQyxDQUFDLGtCQUFrQixDQUFDLFlBQVksQ0FBQyxHQUFHLENBQUMsSUFBSSxDQUFDLENBQUE7UUFFMUYsT0FBTyxLQUFLLENBQUMsQ0FBQyxDQUFDLEtBQUssQ0FBQyxvQkFBb0IsRUFBRSxDQUFDLENBQUMsQ0FBQyxJQUFJLENBQUE7SUFDcEQsQ0FBQztDQUNGIiwic291cmNlc0NvbnRlbnQiOlsiLy8gQHRzLWNoZWNrXG5cbmltcG9ydCB7ZGlnZ30gZnJvbSBcImRpZ2dlcml6ZVwiXG5cbmltcG9ydCBBbHRlclRhYmxlIGZyb20gXCIuL3NxbC9hbHRlci10YWJsZS5qc1wiXG5pbXBvcnQgQmFzZSBmcm9tIFwiLi4vYmFzZS5qc1wiXG5pbXBvcnQgQ3JlYXRlSW5kZXggZnJvbSBcIi4vc3FsL2NyZWF0ZS1pbmRleC5qc1wiXG5pbXBvcnQgQ3JlYXRlVGFibGUgZnJvbSBcIi4vc3FsL2NyZWF0ZS10YWJsZS5qc1wiXG5pbXBvcnQgRGVsZXRlIGZyb20gXCIuL3NxbC9kZWxldGUuanNcIlxuaW1wb3J0IERyb3BUYWJsZSBmcm9tIFwiLi9zcWwvZHJvcC10YWJsZS5qc1wiXG5pbXBvcnQgZXNjYXBlU3RyaW5nIGZyb20gXCJzcWwtZXNjYXBlLXN0cmluZ1wiXG5pbXBvcnQgSW5zZXJ0IGZyb20gXCIuL3NxbC9pbnNlcnQuanNcIlxuaW1wb3J0IE9wdGlvbnMgZnJvbSBcIi4vb3B0aW9ucy5qc1wiXG5pbXBvcnQgUXVlcnlQYXJzZXIgZnJvbSBcIi4vcXVlcnktcGFyc2VyLmpzXCJcbmltcG9ydCBSZW1vdmVJbmRleCBmcm9tIFwiLi9zcWwvcmVtb3ZlLWluZGV4LmpzXCJcbmltcG9ydCBUYWJsZSBmcm9tIFwiLi90YWJsZS5qc1wiXG5pbXBvcnQgU3RydWN0dXJlU3FsIGZyb20gXCIuL3N0cnVjdHVyZS1zcWwuanNcIlxuaW1wb3J0IFVwc2VydCBmcm9tIFwiLi9zcWwvdXBzZXJ0LmpzXCJcbmltcG9ydCBVcGRhdGUgZnJvbSBcIi4vc3FsL3VwZGF0ZS5qc1wiXG5cbmV4cG9ydCBkZWZhdWx0IGNsYXNzIFZlbG9jaW91c0RhdGFiYXNlRHJpdmVyc1NxbGl0ZUJhc2UgZXh0ZW5kcyBCYXNlIHtcbiAgLyoqXG4gICAqIFByb2Nlc3Mtd2lkZSBzdGF0ZSBmb3IgdGhlIFNRTGl0ZSBhZHZpc29yeSBsb2NrIGVtdWxhdGlvbi4gU2hhcmVkIGFjcm9zc1xuICAgKiBldmVyeSBTUUxpdGUgZHJpdmVyIGluc3RhbmNlIChuYXRpdmUsIHdlYiwgc3FsLmpzKSBiZWNhdXNlIHRoZXJlIGlzIG5vXG4gICAqIGNvbmNlcHQgb2YgXCJjb25uZWN0aW9uXCIgdG8gZGlzdGluZ3Vpc2ggdGhlbSBhdCB0aGUgU1FMaXRlIGxldmVsLlxuICAgKlxuICAgKiBgb3duZXJzQnlOYW1lYCBtYXBzIGVhY2ggaGVsZCBsb2NrIG5hbWUgdG8gdGhlIGRyaXZlciBpbnN0YW5jZSB0aGF0XG4gICAqIGFjcXVpcmVkIGl0IHNvIGByZWxlYXNlQWR2aXNvcnlMb2NrYCBjYW4gcmVqZWN0IHJlbGVhc2VzIGZyb20gZHJpdmVyc1xuICAgKiB0aGF0IGRvIG5vdCBvd24gdGhlIGxvY2suXG4gICAqIEB0eXBlIHt7b3duZXJzQnlOYW1lOiBNYXA8c3RyaW5nLCBWZWxvY2lvdXNEYXRhYmFzZURyaXZlcnNTcWxpdGVCYXNlPiwgd2FpdGVyc0J5TmFtZTogTWFwPHN0cmluZywgQXJyYXk8KCkgPT4gdm9pZD4+fX1cbiAgICovXG4gIHN0YXRpYyBfYWR2aXNvcnlMb2NrU3RhdGUgPSB7XG4gICAgb3duZXJzQnlOYW1lOiBuZXcgTWFwKCksXG4gICAgd2FpdGVyc0J5TmFtZTogbmV3IE1hcCgpXG4gIH1cblxuICAvKipcbiAgICogVmVyc2lvbiBtYWpvci5cbiAgICogQHR5cGUge251bWJlciB8IHVuZGVmaW5lZH0gKi9cbiAgdmVyc2lvbk1ham9yID0gdW5kZWZpbmVkXG4gIC8qKlxuICAgKiBWZXJzaW9uIG1pbm9yLlxuICAgKiBAdHlwZSB7bnVtYmVyIHwgdW5kZWZpbmVkfSAqL1xuICB2ZXJzaW9uTWlub3IgPSB1bmRlZmluZWRcbiAgLyoqXG4gICAqIFZlcnNpb24gcGF0Y2guXG4gICAqIEB0eXBlIHtudW1iZXIgfCB1bmRlZmluZWR9ICovXG4gIHZlcnNpb25QYXRjaCA9IHVuZGVmaW5lZFxuXG4gIC8qKlxuICAgKiBSdW5zIGFsdGVyIHRhYmxlIHNxbHMuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vLi4vdGFibGUtZGF0YS9pbmRleC5qc1wiKS5kZWZhdWx0fSB0YWJsZURhdGEgLSBUYWJsZSBkYXRhLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxzdHJpbmdbXT59IC0gUmVzb2x2ZXMgd2l0aCBTUUwgc3RhdGVtZW50cy5cbiAgICovXG4gIGFzeW5jIGFsdGVyVGFibGVTUUxzKHRhYmxlRGF0YSkge1xuICAgIGNvbnN0IGFsdGVyQXJncyA9IHtkcml2ZXI6IHRoaXMsIHRhYmxlRGF0YX1cbiAgICBjb25zdCBhbHRlclRhYmxlID0gbmV3IEFsdGVyVGFibGUoYWx0ZXJBcmdzKVxuXG4gICAgcmV0dXJuIGF3YWl0IGFsdGVyVGFibGUudG9TUUxzKClcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGNyZWF0ZSBpbmRleCBzcWxzLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL2Jhc2UuanNcIikuQ3JlYXRlSW5kZXhTcWxBcmdzfSBpbmRleERhdGEgLSBJbmRleCBkYXRhLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxzdHJpbmdbXT59IC0gUmVzb2x2ZXMgd2l0aCBTUUwgc3RhdGVtZW50cy5cbiAgICovXG4gIGFzeW5jIGNyZWF0ZUluZGV4U1FMcyhpbmRleERhdGEpIHtcbiAgICBjb25zdCBjcmVhdGVBcmdzID0gT2JqZWN0LmFzc2lnbih7ZHJpdmVyOiB0aGlzfSwgaW5kZXhEYXRhKVxuICAgIGNvbnN0IGNyZWF0ZUluZGV4ID0gbmV3IENyZWF0ZUluZGV4KGNyZWF0ZUFyZ3MpXG5cbiAgICByZXR1cm4gYXdhaXQgY3JlYXRlSW5kZXgudG9TUUxzKClcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHJlbW92ZSBpbmRleCBzcWxzLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL2Jhc2UuanNcIikuUmVtb3ZlSW5kZXhTcWxBcmdzfSBpbmRleERhdGEgLSBJbmRleCBkYXRhLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxzdHJpbmdbXT59IC0gUmVzb2x2ZXMgd2l0aCBTUUwgc3RhdGVtZW50cy5cbiAgICovXG4gIGFzeW5jIHJlbW92ZUluZGV4U1FMcyhpbmRleERhdGEpIHtcbiAgICBjb25zdCByZW1vdmVBcmdzID0gT2JqZWN0LmFzc2lnbih7ZHJpdmVyOiB0aGlzfSwgaW5kZXhEYXRhKVxuICAgIGNvbnN0IHJlbW92ZUluZGV4ID0gbmV3IFJlbW92ZUluZGV4KHJlbW92ZUFyZ3MpXG5cbiAgICByZXR1cm4gYXdhaXQgcmVtb3ZlSW5kZXgudG9TUUxzKClcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGNyZWF0ZSB0YWJsZSBzcWwuXG4gICAqIEBhYnN0cmFjdFxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uLy4uL3RhYmxlLWRhdGEvaW5kZXguanNcIikuZGVmYXVsdH0gdGFibGVEYXRhIC0gVGFibGUgZGF0YS5cbiAgICogQHJldHVybnMge1Byb21pc2U8c3RyaW5nW10+fSAtIFJlc29sdmVzIHdpdGggU1FMIHN0YXRlbWVudHMuXG4gICAqL1xuICBhc3luYyBjcmVhdGVUYWJsZVNxbCh0YWJsZURhdGEpIHtcbiAgICBjb25zdCBjcmVhdGVBcmdzID0ge3RhYmxlRGF0YSwgZHJpdmVyOiB0aGlzLCBpbmRleEluQ3JlYXRlVGFibGU6IGZhbHNlfVxuICAgIGNvbnN0IGNyZWF0ZVRhYmxlID0gbmV3IENyZWF0ZVRhYmxlKGNyZWF0ZUFyZ3MpXG5cbiAgICByZXR1cm4gYXdhaXQgY3JlYXRlVGFibGUudG9TcWwoKVxuICB9XG5cbiAgY3VycmVudERhdGFiYXNlKCkge1xuICAgIHJldHVybiBudWxsXG4gIH1cblxuICBhc3luYyBkaXNhYmxlRm9yZWlnbktleXMoKSB7XG4gICAgYXdhaXQgdGhpcy5xdWVyeShcIlBSQUdNQSBmb3JlaWduX2tleXMgPSAwXCIpXG4gIH1cblxuICBhc3luYyBlbmFibGVGb3JlaWduS2V5cygpIHtcbiAgICBhd2FpdCB0aGlzLnF1ZXJ5KFwiUFJBR01BIGZvcmVpZ25fa2V5cyA9IDFcIilcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGRyb3AgdGFibGUgc3Fscy5cbiAgICogQHBhcmFtIHtzdHJpbmd9IHRhYmxlTmFtZSAtIFRhYmxlIG5hbWUuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vYmFzZS5qc1wiKS5Ecm9wVGFibGVTcWxBcmdzVHlwZX0gW2FyZ3NdIC0gT3B0aW9ucyBvYmplY3QuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHN0cmluZ1tdPn0gLSBSZXNvbHZlcyB3aXRoIFNRTCBzdGF0ZW1lbnRzLlxuICAgKi9cbiAgYXN5bmMgZHJvcFRhYmxlU1FMcyh0YWJsZU5hbWUsIGFyZ3MgPSB7fSkge1xuICAgIGNvbnN0IGRyaXZlciA9IC8qKiBAdHlwZSB7aW1wb3J0KFwiLi4vYmFzZS5qc1wiKS5kZWZhdWx0fSAqLyAodGhpcylcbiAgICBjb25zdCBkcm9wQXJncyA9IE9iamVjdC5hc3NpZ24oe3RhYmxlTmFtZSwgZHJpdmVyfSwgYXJncylcbiAgICBjb25zdCBkcm9wVGFibGUgPSBuZXcgRHJvcFRhYmxlKGRyb3BBcmdzKVxuXG4gICAgcmV0dXJuIGF3YWl0IGRyb3BUYWJsZS50b1NRTHMoKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZGVsZXRlIHNxbC5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9iYXNlLmpzXCIpLkRlbGV0ZVNxbEFyZ3NUeXBlfSBhcmdzIC0gT3B0aW9ucyBvYmplY3QuXG4gICAqIEByZXR1cm5zIHtzdHJpbmd9IC0gU1FMIHN0cmluZy5cbiAgICovXG4gIGRlbGV0ZVNxbChhcmdzKSB7IHJldHVybiBuZXcgRGVsZXRlKE9iamVjdC5hc3NpZ24oe2RyaXZlcjogdGhpc30sIGFyZ3MpKS50b1NxbCgpIH1cblxuICAvKipcbiAgICogUnVucyBnZXQgdHlwZS5cbiAgICogQHJldHVybnMge3N0cmluZ30gLSBUaGUgdHlwZS5cbiAgICovXG4gIGdldFR5cGUoKSB7IHJldHVybiBcInNxbGl0ZVwiIH1cblxuICAvKipcbiAgICogUnVucyBpbnNlcnQgc3FsLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL2Jhc2UuanNcIikuSW5zZXJ0U3FsQXJnc1R5cGV9IGFyZ3MgLSBPcHRpb25zIG9iamVjdC5cbiAgICogQHJldHVybnMge3N0cmluZ30gLSBTUUwgc3RyaW5nLlxuICAgKi9cbiAgaW5zZXJ0U3FsKGFyZ3MpIHsgcmV0dXJuIG5ldyBJbnNlcnQoT2JqZWN0LmFzc2lnbih7ZHJpdmVyOiB0aGlzfSwgYXJncykpLnRvU3FsKCkgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGdldCB0YWJsZXMuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPEFycmF5PGltcG9ydChcIi4uL2Jhc2UtdGFibGUuanNcIikuZGVmYXVsdD4+fSAtIFJlc29sdmVzIHdpdGggdGhlIHRhYmxlcy5cbiAgICovXG4gIGFzeW5jIGdldFRhYmxlcygpIHtcbiAgICByZXR1cm4gYXdhaXQgdGhpcy5fY2FjaGVkU2NoZW1hTWV0YWRhdGEoXCJ0YWJsZXNcIiwgYXN5bmMgKCkgPT4ge1xuICAgICAgY29uc3QgcmVzdWx0ID0gYXdhaXQgdGhpcy5xdWVyeShcIlNFTEVDVCBuYW1lIEZST00gc3FsaXRlX21hc3RlciBXSEVSRSB0eXBlID0gJ3RhYmxlJyBPUkRFUiBCWSBuYW1lXCIpXG4gICAgICBjb25zdCB0YWJsZXMgPSBbXVxuXG4gICAgICBmb3IgKGNvbnN0IHJvdyBvZiByZXN1bHQpIHtcbiAgICAgICAgY29uc3QgdGFibGUgPSBuZXcgVGFibGUoe2RyaXZlcjogdGhpcywgcm93OiAvKiogQHR5cGUge1JlY29yZDxzdHJpbmcsIHN0cmluZyB8IG51bWJlciB8IG51bGw+fSAqLyAocm93KX0pXG5cbiAgICAgICAgdGFibGVzLnB1c2godGFibGUpXG4gICAgICB9XG5cbiAgICAgIHJldHVybiB0YWJsZXNcbiAgICB9KVxuICB9XG5cbiAgLyoqXG4gICAqIERlbGV0ZXMgZXZlcnkgZWxpZ2libGUgdGFibGUgdGhyb3VnaCB0aGUgcGxhdGZvcm0gZHJpdmVyJ3MgbmF0aXZlIFNRTGl0ZVxuICAgKiBzY3JpcHQgcGF0aCBzbyB0aGUgd2hvbGUgY2xlYW51cCBpcyBzdWJtaXR0ZWQgYXMgb25lIHJlcXVlc3QuXG4gICAqIEBwYXJhbSB7QXJyYXk8aW1wb3J0KFwiLi4vYmFzZS10YWJsZS5qc1wiKS5kZWZhdWx0Pn0gdGFibGVzIC0gRWxpZ2libGUgdGFibGVzLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyB3aGVuIHRoZSBzY3JpcHQgY29tcGxldGVzLlxuICAgKi9cbiAgYXN5bmMgdHJ1bmNhdGVUYWJsZXModGFibGVzKSB7XG4gICAgY29uc3Qgc3RhdGVtZW50cyA9IHRhYmxlcy5tYXAoKHRhYmxlKSA9PiBgREVMRVRFIEZST00gJHt0aGlzLnF1b3RlVGFibGUodGFibGUuZ2V0TmFtZSgpKX1gKVxuXG4gICAgYXdhaXQgdGhpcy5xdWVyeShzdGF0ZW1lbnRzLmpvaW4oXCI7XFxuXCIpLCB7c3FsaXRlU2NyaXB0OiB0cnVlfSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGluc2VydCBtdWx0aXBsZS5cbiAgICogQHBhcmFtIHtzdHJpbmd9IHRhYmxlTmFtZSAtIFRhYmxlIG5hbWUuXG4gICAqIEBwYXJhbSB7QXJyYXk8c3RyaW5nPn0gY29sdW1ucyAtIENvbHVtbiBuYW1lcy5cbiAgICogQHBhcmFtIHtBcnJheTxBcnJheTxSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj4+fSByb3dzIC0gUm93cyB0byBpbnNlcnQuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIHdoZW4gY29tcGxldGUuXG4gICAqL1xuICBhc3luYyBpbnNlcnRNdWx0aXBsZSh0YWJsZU5hbWUsIGNvbHVtbnMsIHJvd3MpIHtcbiAgICB0aGlzLl9hc3NlcnROb3RSZWFkT25seSgpXG4gICAgYXdhaXQgdGhpcy5yZWdpc3RlclZlcnNpb24oKVxuXG4gICAgaWYgKHRoaXMuc3VwcG9ydHNNdWx0aXBsZUluc2VydFZhbHVlcygpKSB7XG4gICAgICBhd2FpdCB0aGlzLmluc2VydE11bHRpcGxlV2l0aFNpbmdsZUluc2VydCh0YWJsZU5hbWUsIGNvbHVtbnMsIHJvd3MpXG4gICAgfSBlbHNlIHtcbiAgICAgIGF3YWl0IHRoaXMuaW5zZXJ0TXVsdGlwbGVXaXRoVHJhbnNhY3Rpb24odGFibGVOYW1lLCBjb2x1bW5zLCByb3dzKVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHN1cHBvcnRzIG11bHRpcGxlIGluc2VydCB2YWx1ZXMuXG4gICAqIEByZXR1cm5zIHtib29sZWFufSAtIFdoZXRoZXIgc3VwcG9ydHMgbXVsdGlwbGUgaW5zZXJ0IHZhbHVlcy5cbiAgICovXG4gIHN1cHBvcnRzTXVsdGlwbGVJbnNlcnRWYWx1ZXMoKSB7XG4gICAgLyoqXG4gICAgICogVmVyc2lvbiBtYWpvci5cbiAgICAgKiBAdHlwZSB7bnVtYmVyfSAqL1xuICAgIGNvbnN0IHZlcnNpb25NYWpvciA9IHRoaXMudmVyc2lvbk1ham9yIHx8IDBcbiAgICAvKipcbiAgICAgKiBWZXJzaW9uIG1pbm9yLlxuICAgICAqIEB0eXBlIHtudW1iZXJ9ICovXG4gICAgY29uc3QgdmVyc2lvbk1pbm9yID0gdGhpcy52ZXJzaW9uTWlub3IgfHwgMFxuICAgIC8qKlxuICAgICAqIFZlcnNpb24gcGF0Y2guXG4gICAgICogQHR5cGUge251bWJlcn0gKi9cbiAgICBjb25zdCB2ZXJzaW9uUGF0Y2ggPSB0aGlzLnZlcnNpb25QYXRjaCB8fCAwXG5cbiAgICBpZiAodmVyc2lvbk1ham9yID49IDQpIHJldHVybiB0cnVlXG4gICAgaWYgKHZlcnNpb25NYWpvciA9PSAzICYmIHZlcnNpb25NaW5vciA+PSA4KSByZXR1cm4gdHJ1ZVxuICAgIGlmICh2ZXJzaW9uTWFqb3IgPT0gMyAmJiB2ZXJzaW9uTWlub3IgPT0gNyAmJiB2ZXJzaW9uUGF0Y2ggPj0gMTEpIHJldHVybiB0cnVlXG5cbiAgICByZXR1cm4gZmFsc2VcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHN1cHBvcnRzIGluc2VydCBpbnRvIHJldHVybmluZy5cbiAgICogQHJldHVybnMge2Jvb2xlYW59IC0gV2hldGhlciBzdXBwb3J0cyBpbnNlcnQgaW50byByZXR1cm5pbmcuXG4gICAqL1xuICBzdXBwb3J0c0luc2VydEludG9SZXR1cm5pbmcoKSB7XG4gICAgLyoqXG4gICAgICogVmVyc2lvbiBtYWpvci5cbiAgICAgKiBAdHlwZSB7bnVtYmVyfSAqL1xuICAgIGNvbnN0IHZlcnNpb25NYWpvciA9IHRoaXMudmVyc2lvbk1ham9yIHx8IDBcbiAgICAvKipcbiAgICAgKiBWZXJzaW9uIG1pbm9yLlxuICAgICAqIEB0eXBlIHtudW1iZXJ9ICovXG4gICAgY29uc3QgdmVyc2lvbk1pbm9yID0gdGhpcy52ZXJzaW9uTWlub3IgfHwgMFxuXG4gICAgaWYgKHZlcnNpb25NYWpvciA+PSA0KSByZXR1cm4gdHJ1ZVxuICAgIGlmICh2ZXJzaW9uTWFqb3IgPT0gMyAmJiB2ZXJzaW9uTWlub3IgPj0gMzUpIHJldHVybiB0cnVlXG5cbiAgICByZXR1cm4gZmFsc2VcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGluc2VydCBtdWx0aXBsZSB3aXRoIHNpbmdsZSBpbnNlcnQuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSB0YWJsZU5hbWUgLSBUYWJsZSBuYW1lLlxuICAgKiBAcGFyYW0ge0FycmF5PHN0cmluZz59IGNvbHVtbnMgLSBDb2x1bW4gbmFtZXMuXG4gICAqIEBwYXJhbSB7QXJyYXk8QXJyYXk8UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+Pn0gcm93cyAtIFJvd3MgdG8gaW5zZXJ0LlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyB3aGVuIGNvbXBsZXRlLlxuICAgKi9cbiAgYXN5bmMgaW5zZXJ0TXVsdGlwbGVXaXRoU2luZ2xlSW5zZXJ0KHRhYmxlTmFtZSwgY29sdW1ucywgcm93cykge1xuICAgIHRoaXMuX2Fzc2VydE5vdFJlYWRPbmx5KClcblxuICAgIGNvbnN0IGNodW5rcyA9IHRoaXMuX2luc2VydE11bHRpcGxlQ2h1bmtzKHJvd3MsIChjaHVua1Jvd3MpID0+IG5ldyBJbnNlcnQoe2NvbHVtbnMsIGRyaXZlcjogdGhpcywgcm93czogY2h1bmtSb3dzLCB0YWJsZU5hbWV9KS50b1NxbCgpKVxuXG4gICAgZm9yIChjb25zdCBjaHVuayBvZiBjaHVua3MpIHtcbiAgICAgIGNvbnN0IHNxbCA9IG5ldyBJbnNlcnQoe2NvbHVtbnMsIGRyaXZlcjogdGhpcywgcm93czogY2h1bmssIHRhYmxlTmFtZX0pLnRvU3FsKClcblxuICAgICAgYXdhaXQgdGhpcy5xdWVyeShzcWwpXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgaW5zZXJ0IG11bHRpcGxlIHdpdGggdHJhbnNhY3Rpb24uXG4gICAqIEBwYXJhbSB7c3RyaW5nfSB0YWJsZU5hbWUgLSBUYWJsZSBuYW1lLlxuICAgKiBAcGFyYW0ge0FycmF5PHN0cmluZz59IGNvbHVtbnMgLSBDb2x1bW4gbmFtZXMuXG4gICAqIEBwYXJhbSB7QXJyYXk8QXJyYXk8UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+Pn0gcm93cyAtIFJvd3MgdG8gaW5zZXJ0LlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyB3aGVuIGNvbXBsZXRlLlxuICAgKi9cbiAgYXN5bmMgaW5zZXJ0TXVsdGlwbGVXaXRoVHJhbnNhY3Rpb24odGFibGVOYW1lLCBjb2x1bW5zLCByb3dzKSB7XG4gICAgdGhpcy5fYXNzZXJ0Tm90UmVhZE9ubHkoKVxuICAgIC8qKlxuICAgICAqIFNxbHMuXG4gICAgICogQHR5cGUge3N0cmluZ1tdfSAqL1xuICAgIGNvbnN0IHNxbHMgPSBbXVxuXG4gICAgZm9yIChjb25zdCByb3cgb2Ygcm93cykge1xuICAgICAgLyoqXG4gICAgICAgKiBEYXRhLlxuICAgICAgICogQHR5cGUge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gKi9cbiAgICAgIGNvbnN0IGRhdGEgPSB7fVxuXG4gICAgICBmb3IgKGNvbnN0IGNvbHVtbkluZGV4IGluIGNvbHVtbnMpIHtcbiAgICAgICAgY29uc3QgY29sdW1uTmFtZSA9IGNvbHVtbnNbY29sdW1uSW5kZXhdXG4gICAgICAgIGNvbnN0IHZhbHVlID0gcm93W2NvbHVtbkluZGV4XVxuXG4gICAgICAgIGRhdGFbY29sdW1uTmFtZV0gPSB2YWx1ZVxuICAgICAgfVxuXG4gICAgICBjb25zdCBpbnNlcnRTcWwgPSB0aGlzLmluc2VydFNxbCh7dGFibGVOYW1lLCBkYXRhfSlcblxuICAgICAgc3Fscy5wdXNoKGluc2VydFNxbClcbiAgICB9XG5cbiAgICBhd2FpdCB0aGlzLnRyYW5zYWN0aW9uKGFzeW5jICgpID0+IHtcbiAgICAgIGZvciAoY29uc3Qgc3FsIG9mIHNxbHMpIHtcbiAgICAgICAgYXdhaXQgdGhpcy5xdWVyeShzcWwpXG4gICAgICB9XG4gICAgfSlcbiAgfVxuXG4gIGFzeW5jIGxhc3RJbnNlcnRJRChvcHRpb25zID0ge30pIHtcbiAgICBjb25zdCByZXN1bHQgPSBhd2FpdCB0aGlzLnF1ZXJ5KFwiU0VMRUNUIExBU1RfSU5TRVJUX1JPV0lEKCkgQVMgbGFzdF9pbnNlcnRfaWRcIiwgb3B0aW9ucylcblxuICAgIHJldHVybiBkaWdnKHJlc3VsdCwgMCwgXCJsYXN0X2luc2VydF9pZFwiKVxuICB9XG5cbiAgb3B0aW9ucygpIHtcbiAgICBpZiAoIXRoaXMuX29wdGlvbnMpIHRoaXMuX29wdGlvbnMgPSBuZXcgT3B0aW9ucyh0aGlzKVxuXG4gICAgcmV0dXJuIHRoaXMuX29wdGlvbnNcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHF1ZXJ5IHRvIHNxbC5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi8uLi9xdWVyeS9pbmRleC5qc1wiKS5kZWZhdWx0fSBxdWVyeSAtIFF1ZXJ5IGluc3RhbmNlLlxuICAgKiBAcmV0dXJucyB7c3RyaW5nfSAtIFNRTCBzdHJpbmcuXG4gICAqL1xuICBxdWVyeVRvU3FsKHF1ZXJ5KSB7IHJldHVybiBuZXcgUXVlcnlQYXJzZXIoe3F1ZXJ5fSkudG9TcWwoKSB9XG5cbiAgYXN5bmMgcmVnaXN0ZXJWZXJzaW9uKCkge1xuICAgIGlmICh0aGlzLnZlcnNpb25NYWpvciB8fCB0aGlzLnZlcnNpb25NaW5vcikge1xuICAgICAgcmV0dXJuXG4gICAgfVxuXG4gICAgY29uc3QgdmVyc2lvblJlc3VsdCA9IGF3YWl0IHRoaXMucXVlcnkoXCJTRUxFQ1Qgc3FsaXRlX3ZlcnNpb24oKSBBUyB2ZXJzaW9uXCIpXG5cbiAgICB0aGlzLnZlcnNpb24gPSBTdHJpbmcodmVyc2lvblJlc3VsdFswXS52ZXJzaW9uKVxuXG4gICAgY29uc3QgdmVyc2lvblBhcnRzID0gdGhpcy52ZXJzaW9uLnNwbGl0KFwiLlwiKVxuXG4gICAgdGhpcy52ZXJzaW9uTWFqb3IgPSBOdW1iZXIodmVyc2lvblBhcnRzWzBdKVxuICAgIHRoaXMudmVyc2lvbk1pbm9yID0gTnVtYmVyKHZlcnNpb25QYXJ0c1sxXSlcbiAgICB0aGlzLnZlcnNpb25QYXRjaCA9IE51bWJlcih2ZXJzaW9uUGFydHNbMl0pXG4gIH1cblxuICBzaG91bGRTZXRBdXRvSW5jcmVtZW50V2hlblByaW1hcnlLZXkoKSB7IHJldHVybiBmYWxzZSB9XG4gIHN1cHBvcnRzRGVmYXVsdFByaW1hcnlLZXlVVUlEKCkgeyByZXR1cm4gZmFsc2UgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGVzY2FwZS5cbiAgICogQHBhcmFtIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gdmFsdWUgLSBWYWx1ZSB0byB1c2UuXG4gICAqIEByZXR1cm5zIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gLSBUaGUgZXNjYXBlLlxuICAgKi9cbiAgZXNjYXBlKHZhbHVlKSB7XG4gICAgdmFsdWUgPSB0aGlzLl9jb252ZXJ0VmFsdWUodmFsdWUpXG5cbiAgICBjb25zdCB0eXBlID0gdHlwZW9mIHZhbHVlXG5cbiAgICBpZiAodHlwZSAhPSBcInN0cmluZ1wiKSB2YWx1ZSA9IGAke3ZhbHVlfWBcblxuICAgIGNvbnN0IHJlc3VsdFdpdGhRdW90ZXMgPSBlc2NhcGVTdHJpbmcodmFsdWUsIG51bGwpXG4gICAgY29uc3QgcmVzdWx0ID0gcmVzdWx0V2l0aFF1b3Rlcy5zdWJzdHJpbmcoMSwgcmVzdWx0V2l0aFF1b3Rlcy5sZW5ndGggLSAxKVxuXG4gICAgcmV0dXJuIHJlc3VsdFxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgcmV0cnlhYmxlIGRhdGFiYXNlIGVycm9yLlxuICAgKiBAcGFyYW0ge0Vycm9yfSBlcnJvciAtIEVycm9yIGluc3RhbmNlLlxuICAgKiBAcmV0dXJucyB7aW1wb3J0KFwiLi4vYmFzZS5qc1wiKS5SZXRyeWFibGVEYXRhYmFzZUVycm9yUmVzdWx0fSAtIFJldHJ5IGluZm8uXG4gICAqL1xuICByZXRyeWFibGVEYXRhYmFzZUVycm9yKGVycm9yKSB7XG4gICAgY29uc3QgZGF0YWJhc2VMb2NrZWQgPSBCb29sZWFuKGVycm9yLm1lc3NhZ2U/LmluY2x1ZGVzKFwiZGF0YWJhc2UgaXMgbG9ja2VkXCIpKVxuICAgIGNvbnN0IHNob3VsZFJldHJ5ID0gKFxuICAgICAgZXJyb3IubWVzc2FnZT8uc3RhcnRzV2l0aChcImF0dGVtcHQgdG8gd3JpdGUgYSByZWFkb25seSBkYXRhYmFzZVwiKSB8fFxuICAgICAgZGF0YWJhc2VMb2NrZWRcbiAgICApXG5cbiAgICByZXR1cm4ge2RlYWRsb2NrOiBkYXRhYmFzZUxvY2tlZCwgcmV0cnk6IHNob3VsZFJldHJ5LCByZWNvbm5lY3Q6IGZhbHNlfVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgcXVvdGUuXG4gICAqIEBwYXJhbSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59IHZhbHVlIC0gVmFsdWUgdG8gdXNlLlxuICAgKiBAcmV0dXJucyB7c3RyaW5nIHwgbnVtYmVyfSAtIFRoZSBxdW90ZWQgdmFsdWUuXG4gICAqL1xuICBxdW90ZSh2YWx1ZSkge1xuICAgIHZhbHVlID0gdGhpcy5fY29udmVydFZhbHVlKHZhbHVlKVxuXG4gICAgY29uc3QgdHlwZSA9IHR5cGVvZiB2YWx1ZVxuXG4gICAgaWYgKHR5cGUgPT0gXCJudW1iZXJcIikgcmV0dXJuIC8qKiBAdHlwZSB7bnVtYmVyfSAqLyAodmFsdWUpXG4gICAgaWYgKHR5cGUgIT0gXCJzdHJpbmdcIikgdmFsdWUgPSBTdHJpbmcodmFsdWUpXG5cbiAgICByZXR1cm4gZXNjYXBlU3RyaW5nKHZhbHVlLCBudWxsKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgdXBkYXRlIHNxbC5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9iYXNlLmpzXCIpLlVwZGF0ZVNxbEFyZ3NUeXBlfSBhcmdzIC0gT3B0aW9ucyBvYmplY3QuXG4gICAqIEByZXR1cm5zIHtzdHJpbmd9IC0gU1FMIHN0cmluZy5cbiAgICovXG4gIHVwZGF0ZVNxbCh7Y29uZGl0aW9ucywgZGF0YSwgdGFibGVOYW1lfSkgeyByZXR1cm4gbmV3IFVwZGF0ZSh7Y29uZGl0aW9ucywgZGF0YSwgZHJpdmVyOiB0aGlzLCB0YWJsZU5hbWV9KS50b1NxbCgpIH1cblxuICAvKipcbiAgICogUnVucyB1cHNlcnQgc3FsLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL2Jhc2UuanNcIikuVXBzZXJ0U3FsQXJnc1R5cGV9IGFyZ3MgLSBPcHRpb25zIG9iamVjdC5cbiAgICogQHJldHVybnMge3N0cmluZ30gLSBTUUwgc3RyaW5nLlxuICAgKi9cbiAgdXBzZXJ0U3FsKGFyZ3MpIHsgcmV0dXJuIG5ldyBVcHNlcnQoey4uLmFyZ3MsIGRyaXZlcjogdGhpc30pLnRvU3FsKCkgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHN0cnVjdHVyZSBzcWwuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHN0cmluZyB8IG51bGw+fSAtIFJlc29sdmVzIHdpdGggU1FMIHN0cmluZy5cbiAgICovXG4gIGFzeW5jIHN0cnVjdHVyZVNxbCgpIHtcbiAgICByZXR1cm4gYXdhaXQgdGhpcy5fY2FjaGVkU2NoZW1hTWV0YWRhdGEoXCJzdHJ1Y3R1cmVTcWxcIiwgYXN5bmMgKCkgPT4gYXdhaXQgbmV3IFN0cnVjdHVyZVNxbCh7ZHJpdmVyOiB0aGlzfSkudG9TcWwoKSlcbiAgfVxuXG4gIC8qKlxuICAgKiBCbG9ja3MgdW50aWwgYW4gaW4tcHJvY2VzcyBhZHZpc29yeSBsb2NrIHdpdGggdGhlIGdpdmVuIG5hbWUgaXNcbiAgICogYWNxdWlyZWQuIFNRTGl0ZSBoYXMgbm8gYnVpbHQtaW4gYWR2aXNvcnkgbG9jayBwcmltaXRpdmUsIHNvIHRoaXMgaXNcbiAgICogaW1wbGVtZW50ZWQgYXMgYSBwcm9jZXNzLWxvY2FsIHdhaXRlciBxdWV1ZS4gVHlwaWNhbCBTUUxpdGUgZGVwbG95bWVudHNcbiAgICogcnVuIGluc2lkZSBhIHNpbmdsZSBOb2RlIHByb2Nlc3MsIHdoaWNoIGlzIGV4YWN0bHkgdGhlIHNjb3BlIHRoaXNcbiAgICogZW11bGF0aW9uIGNvdmVyczsgbXVsdGktcHJvY2VzcyBTUUxpdGUgc2V0dXBzIHNob3VsZCBub3QgcmVseSBvbiB0aGlzXG4gICAqIGZvciBjcm9zcy1wcm9jZXNzIG11dHVhbCBleGNsdXNpb24uXG4gICAqXG4gICAqIFRoZSBvd25pbmcgZHJpdmVyIGluc3RhbmNlIGlzIHJlY29yZGVkIHNvIHRoYXQgYHJlbGVhc2VBZHZpc29yeUxvY2tgXG4gICAqIGNhbiByZWZ1c2UgdG8gcmVsZWFzZSBhIGxvY2sgdGhhdCB3YXMgYWNxdWlyZWQgYnkgc29tZW9uZSBlbHNlLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gbmFtZSAtIExvY2sgbmFtZS5cbiAgICogQHBhcmFtIHt7dGltZW91dE1zPzogbnVtYmVyIHwgbnVsbH19IFthcmdzXSAtIE9wdGlvbmFsIHRpbWVvdXQgaW4gbWlsbGlzZWNvbmRzOyBgbnVsbGAsIGB1bmRlZmluZWRgLCBvciBuZWdhdGl2ZSBibG9ja3MgZm9yZXZlci5cbiAgICogQHJldHVybnMge1Byb21pc2U8Ym9vbGVhbj59IC0gVHJ1ZSBpZiB0aGUgbG9jayB3YXMgYWNxdWlyZWQsIGZhbHNlIGlmIHRoZSB0aW1lb3V0IGVsYXBzZWQuXG4gICAqL1xuICBhc3luYyBfYWNxdWlyZUFkdmlzb3J5TG9jayhuYW1lLCB7dGltZW91dE1zfSA9IHt9KSB7XG4gICAgY29uc3Qgc3RhdGUgPSBWZWxvY2lvdXNEYXRhYmFzZURyaXZlcnNTcWxpdGVCYXNlLl9hZHZpc29yeUxvY2tTdGF0ZVxuXG4gICAgd2hpbGUgKHN0YXRlLm93bmVyc0J5TmFtZS5oYXMobmFtZSkpIHtcbiAgICAgIGxldCByZW1haW5pbmdNcyA9IG51bGxcblxuICAgICAgaWYgKHR5cGVvZiB0aW1lb3V0TXMgPT09IFwibnVtYmVyXCIgJiYgdGltZW91dE1zID49IDApIHtcbiAgICAgICAgcmVtYWluaW5nTXMgPSB0aW1lb3V0TXNcblxuICAgICAgICBpZiAocmVtYWluaW5nTXMgPD0gMCkgcmV0dXJuIGZhbHNlXG4gICAgICB9XG5cbiAgICAgIGF3YWl0IG5ldyBQcm9taXNlKChyZXNvbHZlKSA9PiB7XG4gICAgICAgIGNvbnN0IHdhaXRlcnMgPSBzdGF0ZS53YWl0ZXJzQnlOYW1lLmdldChuYW1lKSB8fCBbXVxuICAgICAgICAvKipcbiAgICAgICAgICogVGltZW91dCBoYW5kbGUuXG4gICAgICAgICAqIEB0eXBlIHtSZXR1cm5UeXBlPHR5cGVvZiBzZXRUaW1lb3V0PiB8IG51bGx9ICovXG4gICAgICAgIGxldCB0aW1lb3V0SGFuZGxlID0gbnVsbFxuICAgICAgICAvKipcbiAgICAgICAgICogUmVtb3ZlIGFuZCByZXNvbHZlLlxuICAgICAgICAgKiBAdHlwZSB7KCgpID0+IHZvaWQpIHwgbnVsbH0gKi9cbiAgICAgICAgbGV0IHJlbW92ZUFuZFJlc29sdmUgPSBudWxsXG5cbiAgICAgICAgcmVtb3ZlQW5kUmVzb2x2ZSA9ICgpID0+IHtcbiAgICAgICAgICBpZiAodGltZW91dEhhbmRsZSkgY2xlYXJUaW1lb3V0KHRpbWVvdXRIYW5kbGUpXG5cbiAgICAgICAgICBjb25zdCBjdXJyZW50ID0gc3RhdGUud2FpdGVyc0J5TmFtZS5nZXQobmFtZSkgfHwgW11cbiAgICAgICAgICBjb25zdCBpbmRleCA9IGN1cnJlbnQuaW5kZXhPZigvKiogQHR5cGUgeygpID0+IHZvaWR9ICovIChyZW1vdmVBbmRSZXNvbHZlKSlcblxuICAgICAgICAgIGlmIChpbmRleCA+PSAwKSBjdXJyZW50LnNwbGljZShpbmRleCwgMSlcbiAgICAgICAgICBpZiAoY3VycmVudC5sZW5ndGggPT09IDApIHN0YXRlLndhaXRlcnNCeU5hbWUuZGVsZXRlKG5hbWUpXG5cbiAgICAgICAgICByZXNvbHZlKHVuZGVmaW5lZClcbiAgICAgICAgfVxuXG4gICAgICAgIHdhaXRlcnMucHVzaChyZW1vdmVBbmRSZXNvbHZlKVxuICAgICAgICBzdGF0ZS53YWl0ZXJzQnlOYW1lLnNldChuYW1lLCB3YWl0ZXJzKVxuXG4gICAgICAgIGlmIChyZW1haW5pbmdNcyAhPT0gbnVsbCkge1xuICAgICAgICAgIHRpbWVvdXRIYW5kbGUgPSBzZXRUaW1lb3V0KCgpID0+IHtcbiAgICAgICAgICAgIGlmIChyZW1vdmVBbmRSZXNvbHZlKSByZW1vdmVBbmRSZXNvbHZlKClcbiAgICAgICAgICB9LCByZW1haW5pbmdNcylcbiAgICAgICAgfVxuICAgICAgfSlcblxuICAgICAgaWYgKHR5cGVvZiB0aW1lb3V0TXMgPT09IFwibnVtYmVyXCIgJiYgdGltZW91dE1zID49IDAgJiYgc3RhdGUub3duZXJzQnlOYW1lLmhhcyhuYW1lKSkge1xuICAgICAgICByZXR1cm4gZmFsc2VcbiAgICAgIH1cbiAgICB9XG5cbiAgICBzdGF0ZS5vd25lcnNCeU5hbWUuc2V0KG5hbWUsIHRoaXMpXG5cbiAgICByZXR1cm4gdHJ1ZVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgdHJ5IGFjcXVpcmUgYWR2aXNvcnkgbG9jay5cbiAgICogQHBhcmFtIHtzdHJpbmd9IG5hbWUgLSBMb2NrIG5hbWUuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPGJvb2xlYW4+fSAtIFRydWUgaWYgdGhlIGxvY2sgd2FzIGFjcXVpcmVkLCBmYWxzZSBpZiBpdCB3YXMgYWxyZWFkeSBoZWxkLlxuICAgKi9cbiAgYXN5bmMgX3RyeUFjcXVpcmVBZHZpc29yeUxvY2sobmFtZSkge1xuICAgIGNvbnN0IHN0YXRlID0gVmVsb2Npb3VzRGF0YWJhc2VEcml2ZXJzU3FsaXRlQmFzZS5fYWR2aXNvcnlMb2NrU3RhdGVcblxuICAgIGlmIChzdGF0ZS5vd25lcnNCeU5hbWUuaGFzKG5hbWUpKSByZXR1cm4gZmFsc2VcblxuICAgIHN0YXRlLm93bmVyc0J5TmFtZS5zZXQobmFtZSwgdGhpcylcblxuICAgIHJldHVybiB0cnVlXG4gIH1cblxuICAvKipcbiAgICogUmVsZWFzZXMgdGhlIGxvY2sgb25seSBpZiAqKnRoaXMqKiBkcml2ZXIgaW5zdGFuY2Ugb3ducyBpdC4gQ2FsbGluZ1xuICAgKiByZWxlYXNlIGZvciBhIGxvY2sgb3duZWQgYnkgYW5vdGhlciBkcml2ZXIgaW5zdGFuY2UgaXMgYSBuby1vcCB0aGF0XG4gICAqIHJldHVybnMgYGZhbHNlYCwgbWF0Y2hpbmcgdGhlIFwieW91IGNhbiBvbmx5IHJlbGVhc2UgbG9ja3MgeW91IG93blwiXG4gICAqIGNvbnRyYWN0IG9mIE15U1FMJ3MgYFJFTEVBU0VfTE9DS2AgYW5kIFBvc3RncmVTUUwnc1xuICAgKiBgcGdfYWR2aXNvcnlfdW5sb2NrYC5cbiAgICogQHBhcmFtIHtzdHJpbmd9IG5hbWUgLSBMb2NrIG5hbWUuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPGJvb2xlYW4+fSAtIFRydWUgaWYgdGhlIGxvY2sgd2FzIGhlbGQgYnkgdGhpcyBkcml2ZXIgYW5kIGhhcyBub3cgYmVlbiByZWxlYXNlZC5cbiAgICovXG4gIGFzeW5jIF9yZWxlYXNlQWR2aXNvcnlMb2NrKG5hbWUpIHtcbiAgICBjb25zdCBzdGF0ZSA9IFZlbG9jaW91c0RhdGFiYXNlRHJpdmVyc1NxbGl0ZUJhc2UuX2Fkdmlzb3J5TG9ja1N0YXRlXG4gICAgY29uc3Qgb3duZXIgPSBzdGF0ZS5vd25lcnNCeU5hbWUuZ2V0KG5hbWUpXG5cbiAgICBpZiAob3duZXIgIT09IHRoaXMpIHJldHVybiBmYWxzZVxuXG4gICAgc3RhdGUub3duZXJzQnlOYW1lLmRlbGV0ZShuYW1lKVxuXG4gICAgY29uc3Qgd2FpdGVycyA9IHN0YXRlLndhaXRlcnNCeU5hbWUuZ2V0KG5hbWUpXG5cbiAgICBpZiAod2FpdGVycyAmJiB3YWl0ZXJzLmxlbmd0aCA+IDApIHtcbiAgICAgIGNvbnN0IG5leHRXYWl0ZXIgPSB3YWl0ZXJzLnNoaWZ0KClcblxuICAgICAgaWYgKHdhaXRlcnMubGVuZ3RoID09PSAwKSBzdGF0ZS53YWl0ZXJzQnlOYW1lLmRlbGV0ZShuYW1lKVxuICAgICAgaWYgKG5leHRXYWl0ZXIpIG5leHRXYWl0ZXIoKVxuICAgIH1cblxuICAgIHJldHVybiB0cnVlXG4gIH1cblxuICAvKipcbiAgICogUnVucyBpcyBhZHZpc29yeSBsb2NrIGhlbGQuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBuYW1lIC0gTG9jayBuYW1lLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxib29sZWFuPn0gLSBUcnVlIGlmIGFueSBkcml2ZXIgaW5zdGFuY2UgY3VycmVudGx5IGhvbGRzIHRoZSBsb2NrLlxuICAgKi9cbiAgYXN5bmMgaXNBZHZpc29yeUxvY2tIZWxkKG5hbWUpIHtcbiAgICByZXR1cm4gVmVsb2Npb3VzRGF0YWJhc2VEcml2ZXJzU3FsaXRlQmFzZS5fYWR2aXNvcnlMb2NrU3RhdGUub3duZXJzQnlOYW1lLmhhcyhuYW1lKVxuICB9XG5cbiAgLyoqXG4gICAqIFRoZSBTUUxpdGUgZW11bGF0aW9uIGlzIHRoZSBwcm9jZXNzLWxvY2FsIHRpZXIgb2YgdGhlIFNUQy0yMTAgY2hhaW4uXG4gICAqIEByZXR1cm5zIHtzdHJpbmd9IC0gVGllciBuYW1lIHJlcG9ydGVkIG9uIHRlbGVtZXRyeSBwYXlsb2Fkcy5cbiAgICovXG4gIGFkdmlzb3J5TG9ja0JhY2tlbmRUaWVyKCkge1xuICAgIHJldHVybiBcInByb2Nlc3MtbG9jYWxcIlxuICB9XG5cbiAgLyoqXG4gICAqIEF0dHJpYnV0ZSB0aGUgbmFtZWQgbG9jayB0byB0aGUgZHJpdmVyIGluc3RhbmNlIHRoYXQgb3ducyBpdCBpbiB0aGVcbiAgICogc2hhcmVkIGluLXByb2Nlc3MgcmVnaXN0cnkgKGJlc3QtZWZmb3J0OyB0aGUgY2FsbGVyIGd1YXJkcyBmYWlsdXJlcykuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBuYW1lIC0gTG9jayBuYW1lLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxzdHJpbmcgfCBudWxsPn0gLSBPd25pbmcgZHJpdmVyJ3MgaG9sZGVyIGlkLCBvciBudWxsIHdoZW4gbm8gaW5zdGFuY2UgaG9sZHMgdGhlIGxvY2suXG4gICAqL1xuICBhc3luYyBhZHZpc29yeUxvY2tIb2xkZXJDb25uZWN0aW9uSWQobmFtZSkge1xuICAgIGNvbnN0IG93bmVyID0gVmVsb2Npb3VzRGF0YWJhc2VEcml2ZXJzU3FsaXRlQmFzZS5fYWR2aXNvcnlMb2NrU3RhdGUub3duZXJzQnlOYW1lLmdldChuYW1lKVxuXG4gICAgcmV0dXJuIG93bmVyID8gb3duZXIuYWR2aXNvcnlMb2NrSG9sZGVySWQoKSA6IG51bGxcbiAgfVxufVxuIl19