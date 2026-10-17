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
     * SQLite has no native advisory-lock primitive, so the shared
     * process-local pre-filter tier in the base driver is the whole
     * implementation for the web/sql.js and Expo native builds. The Node
     * driver layers its filesystem lock on top as the driver-native tier.
     * @returns {boolean} - Always false for plain SQLite.
     */
    supportsDriverNativeAdvisoryLock() {
        return false;
    }
    /**
     * The SQLite emulation is not re-entrant: a re-acquisition by the same
     * driver instance is contention, not a grant, exactly as the in-process
     * queue always behaved.
     * @returns {boolean} - Always false for SQLite.
     */
    supportsReentrantAdvisoryLock() {
        return false;
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiYmFzZS5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uLy4uLy4uLy4uLy4uL3NyYy9kYXRhYmFzZS9kcml2ZXJzL3NxbGl0ZS9iYXNlLmpzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiJBQUFBLFlBQVk7QUFFWixPQUFPLEVBQUMsSUFBSSxFQUFDLE1BQU0sV0FBVyxDQUFBO0FBRTlCLE9BQU8sVUFBVSxNQUFNLHNCQUFzQixDQUFBO0FBQzdDLE9BQU8sSUFBSSxNQUFNLFlBQVksQ0FBQTtBQUM3QixPQUFPLFdBQVcsTUFBTSx1QkFBdUIsQ0FBQTtBQUMvQyxPQUFPLFdBQVcsTUFBTSx1QkFBdUIsQ0FBQTtBQUMvQyxPQUFPLE1BQU0sTUFBTSxpQkFBaUIsQ0FBQTtBQUNwQyxPQUFPLFNBQVMsTUFBTSxxQkFBcUIsQ0FBQTtBQUMzQyxPQUFPLFlBQVksTUFBTSxtQkFBbUIsQ0FBQTtBQUM1QyxPQUFPLE1BQU0sTUFBTSxpQkFBaUIsQ0FBQTtBQUNwQyxPQUFPLE9BQU8sTUFBTSxjQUFjLENBQUE7QUFDbEMsT0FBTyxXQUFXLE1BQU0sbUJBQW1CLENBQUE7QUFDM0MsT0FBTyxXQUFXLE1BQU0sdUJBQXVCLENBQUE7QUFDL0MsT0FBTyxLQUFLLE1BQU0sWUFBWSxDQUFBO0FBQzlCLE9BQU8sWUFBWSxNQUFNLG9CQUFvQixDQUFBO0FBQzdDLE9BQU8sTUFBTSxNQUFNLGlCQUFpQixDQUFBO0FBQ3BDLE9BQU8sTUFBTSxNQUFNLGlCQUFpQixDQUFBO0FBRXBDLE1BQU0sQ0FBQyxPQUFPLE9BQU8sa0NBQW1DLFNBQVEsSUFBSTtJQUNsRTs7b0NBRWdDO0lBQ2hDLFlBQVksR0FBRyxTQUFTLENBQUE7SUFDeEI7O29DQUVnQztJQUNoQyxZQUFZLEdBQUcsU0FBUyxDQUFBO0lBQ3hCOztvQ0FFZ0M7SUFDaEMsWUFBWSxHQUFHLFNBQVMsQ0FBQTtJQUV4Qjs7OztPQUlHO0lBQ0gsS0FBSyxDQUFDLGNBQWMsQ0FBQyxTQUFTO1FBQzVCLE1BQU0sU0FBUyxHQUFH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QUFDLEVBQUMsTUFBTSxFQUFFLElBQUksRUFBQyxDQUFDLENBQUMsS0FBSyxFQUFFLENBQUMsQ0FBQTtJQUNySCxDQUFDO0lBRUQ7Ozs7OztPQU1HO0lBQ0gsZ0NBQWdDO1FBQzlCLE9BQU8sS0FBSyxDQUFBO0lBQ2QsQ0FBQztJQUVEOzs7OztPQUtHO0lBQ0gsNkJBQTZCO1FBQzNCLE9BQU8sS0FBSyxDQUFBO0lBQ2QsQ0FBQztJQUVEOzs7T0FHRztJQUNILHVCQUF1QjtRQUNyQixPQUFPLGVBQWUsQ0FBQTtJQUN4QixDQUFDO0lBRUQ7Ozs7O09BS0c7SUFDSCxLQUFLLENBQUMsOEJBQThCLENBQUMsSUFBSTtRQUN2QyxNQUFNLEtBQUssR0FBRyxrQ0FBa0MsQ0FBQyxrQkFBa0IsQ0FBQyxZQUFZLENBQUMsR0FBRyxDQUFDLElBQUksQ0FBQyxDQUFBO1FBRTFGLE9BQU8sS0FBSyxDQUFDLENBQUMsQ0FBQyxLQUFLLENBQUMsb0JBQW9CLEVBQUUsQ0FBQyxDQUFDLENBQUMsSUFBSSxDQUFBO0lBQ3BELENBQUM7Q0FDRiIsInNvdXJjZXNDb250ZW50IjpbIi8vIEB0cy1jaGVja1xuXG5pbXBvcnQge2RpZ2d9IGZyb20gXCJkaWdnZXJpemVcIlxuXG5pbXBvcnQgQWx0ZXJUYWJsZSBmcm9tIFwiLi9zcWwvYWx0ZXItdGFibGUuanNcIlxuaW1wb3J0IEJhc2UgZnJvbSBcIi4uL2Jhc2UuanNcIlxuaW1wb3J0IENyZWF0ZUluZGV4IGZyb20gXCIuL3NxbC9jcmVhdGUtaW5kZXguanNcIlxuaW1wb3J0IENyZWF0ZVRhYmxlIGZyb20gXCIuL3NxbC9jcmVhdGUtdGFibGUuanNcIlxuaW1wb3J0IERlbGV0ZSBmcm9tIFwiLi9zcWwvZGVsZXRlLmpzXCJcbmltcG9ydCBEcm9wVGFibGUgZnJvbSBcIi4vc3FsL2Ryb3AtdGFibGUuanNcIlxuaW1wb3J0IGVzY2FwZVN0cmluZyBmcm9tIFwic3FsLWVzY2FwZS1zdHJpbmdcIlxuaW1wb3J0IEluc2VydCBmcm9tIFwiLi9zcWwvaW5zZXJ0LmpzXCJcbmltcG9ydCBPcHRpb25zIGZyb20gXCIuL29wdGlvbnMuanNcIlxuaW1wb3J0IFF1ZXJ5UGFyc2VyIGZyb20gXCIuL3F1ZXJ5LXBhcnNlci5qc1wiXG5pbXBvcnQgUmVtb3ZlSW5kZXggZnJvbSBcIi4vc3FsL3JlbW92ZS1pbmRleC5qc1wiXG5pbXBvcnQgVGFibGUgZnJvbSBcIi4vdGFibGUuanNcIlxuaW1wb3J0IFN0cnVjdHVyZVNxbCBmcm9tIFwiLi9zdHJ1Y3R1cmUtc3FsLmpzXCJcbmltcG9ydCBVcHNlcnQgZnJvbSBcIi4vc3FsL3Vwc2VydC5qc1wiXG5pbXBvcnQgVXBkYXRlIGZyb20gXCIuL3NxbC91cGRhdGUuanNcIlxuXG5leHBvcnQgZGVmYXVsdCBjbGFzcyBWZWxvY2lvdXNEYXRhYmFzZURyaXZlcnNTcWxpdGVCYXNlIGV4dGVuZHMgQmFzZSB7XG4gIC8qKlxuICAgKiBWZXJzaW9uIG1ham9yLlxuICAgKiBAdHlwZSB7bnVtYmVyIHwgdW5kZWZpbmVkfSAqL1xuICB2ZXJzaW9uTWFqb3IgPSB1bmRlZmluZWRcbiAgLyoqXG4gICAqIFZlcnNpb24gbWlub3IuXG4gICAqIEB0eXBlIHtudW1iZXIgfCB1bmRlZmluZWR9ICovXG4gIHZlcnNpb25NaW5vciA9IHVuZGVmaW5lZFxuICAvKipcbiAgICogVmVyc2lvbiBwYXRjaC5cbiAgICogQHR5cGUge251bWJlciB8IHVuZGVmaW5lZH0gKi9cbiAgdmVyc2lvblBhdGNoID0gdW5kZWZpbmVkXG5cbiAgLyoqXG4gICAqIFJ1bnMgYWx0ZXIgdGFibGUgc3Fscy5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi8uLi90YWJsZS1kYXRhL2luZGV4LmpzXCIpLmRlZmF1bHR9IHRhYmxlRGF0YSAtIFRhYmxlIGRhdGEuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHN0cmluZ1tdPn0gLSBSZXNvbHZlcyB3aXRoIFNRTCBzdGF0ZW1lbnRzLlxuICAgKi9cbiAgYXN5bmMgYWx0ZXJUYWJsZVNRTHModGFibGVEYXRhKSB7XG4gICAgY29uc3QgYWx0ZXJBcmdzID0ge2RyaXZlcjogdGhpcywgdGFibGVEYXRhfVxuICAgIGNvbnN0IGFsdGVyVGFibGUgPSBuZXcgQWx0ZXJUYWJsZShhbHRlckFyZ3MpXG5cbiAgICByZXR1cm4gYXdhaXQgYWx0ZXJUYWJsZS50b1NRTHMoKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgY3JlYXRlIGluZGV4IHNxbHMuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vYmFzZS5qc1wiKS5DcmVhdGVJbmRleFNxbEFyZ3N9IGluZGV4RGF0YSAtIEluZGV4IGRhdGEuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHN0cmluZ1tdPn0gLSBSZXNvbHZlcyB3aXRoIFNRTCBzdGF0ZW1lbnRzLlxuICAgKi9cbiAgYXN5bmMgY3JlYXRlSW5kZXhTUUxzKGluZGV4RGF0YSkge1xuICAgIGNvbnN0IGNyZWF0ZUFyZ3MgPSBPYmplY3QuYXNzaWduKHtkcml2ZXI6IHRoaXN9LCBpbmRleERhdGEpXG4gICAgY29uc3QgY3JlYXRlSW5kZXggPSBuZXcgQ3JlYXRlSW5kZXgoY3JlYXRlQXJncylcblxuICAgIHJldHVybiBhd2FpdCBjcmVhdGVJbmRleC50b1NRTHMoKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgcmVtb3ZlIGluZGV4IHNxbHMuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vYmFzZS5qc1wiKS5SZW1vdmVJbmRleFNxbEFyZ3N9IGluZGV4RGF0YSAtIEluZGV4IGRhdGEuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHN0cmluZ1tdPn0gLSBSZXNvbHZlcyB3aXRoIFNRTCBzdGF0ZW1lbnRzLlxuICAgKi9cbiAgYXN5bmMgcmVtb3ZlSW5kZXhTUUxzKGluZGV4RGF0YSkge1xuICAgIGNvbnN0IHJlbW92ZUFyZ3MgPSBPYmplY3QuYXNzaWduKHtkcml2ZXI6IHRoaXN9LCBpbmRleERhdGEpXG4gICAgY29uc3QgcmVtb3ZlSW5kZXggPSBuZXcgUmVtb3ZlSW5kZXgocmVtb3ZlQXJncylcblxuICAgIHJldHVybiBhd2FpdCByZW1vdmVJbmRleC50b1NRTHMoKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgY3JlYXRlIHRhYmxlIHNxbC5cbiAgICogQGFic3RyYWN0XG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vLi4vdGFibGUtZGF0YS9pbmRleC5qc1wiKS5kZWZhdWx0fSB0YWJsZURhdGEgLSBUYWJsZSBkYXRhLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxzdHJpbmdbXT59IC0gUmVzb2x2ZXMgd2l0aCBTUUwgc3RhdGVtZW50cy5cbiAgICovXG4gIGFzeW5jIGNyZWF0ZVRhYmxlU3FsKHRhYmxlRGF0YSkge1xuICAgIGNvbnN0IGNyZWF0ZUFyZ3MgPSB7dGFibGVEYXRhLCBkcml2ZXI6IHRoaXMsIGluZGV4SW5DcmVhdGVUYWJsZTogZmFsc2V9XG4gICAgY29uc3QgY3JlYXRlVGFibGUgPSBuZXcgQ3JlYXRlVGFibGUoY3JlYXRlQXJncylcblxuICAgIHJldHVybiBhd2FpdCBjcmVhdGVUYWJsZS50b1NxbCgpXG4gIH1cblxuICBjdXJyZW50RGF0YWJhc2UoKSB7XG4gICAgcmV0dXJuIG51bGxcbiAgfVxuXG4gIGFzeW5jIGRpc2FibGVGb3JlaWduS2V5cygpIHtcbiAgICBhd2FpdCB0aGlzLnF1ZXJ5KFwiUFJBR01BIGZvcmVpZ25fa2V5cyA9IDBcIilcbiAgfVxuXG4gIGFzeW5jIGVuYWJsZUZvcmVpZ25LZXlzKCkge1xuICAgIGF3YWl0IHRoaXMucXVlcnkoXCJQUkFHTUEgZm9yZWlnbl9rZXlzID0gMVwiKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZHJvcCB0YWJsZSBzcWxzLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gdGFibGVOYW1lIC0gVGFibGUgbmFtZS5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9iYXNlLmpzXCIpLkRyb3BUYWJsZVNxbEFyZ3NUeXBlfSBbYXJnc10gLSBPcHRpb25zIG9iamVjdC5cbiAgICogQHJldHVybnMge1Byb21pc2U8c3RyaW5nW10+fSAtIFJlc29sdmVzIHdpdGggU1FMIHN0YXRlbWVudHMuXG4gICAqL1xuICBhc3luYyBkcm9wVGFibGVTUUxzKHRhYmxlTmFtZSwgYXJncyA9IHt9KSB7XG4gICAgY29uc3QgZHJpdmVyID0gLyoqIEB0eXBlIHtpbXBvcnQoXCIuLi9iYXNlLmpzXCIpLmRlZmF1bHR9ICovICh0aGlzKVxuICAgIGNvbnN0IGRyb3BBcmdzID0gT2JqZWN0LmFzc2lnbih7dGFibGVOYW1lLCBkcml2ZXJ9LCBhcmdzKVxuICAgIGNvbnN0IGRyb3BUYWJsZSA9IG5ldyBEcm9wVGFibGUoZHJvcEFyZ3MpXG5cbiAgICByZXR1cm4gYXdhaXQgZHJvcFRhYmxlLnRvU1FMcygpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBkZWxldGUgc3FsLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL2Jhc2UuanNcIikuRGVsZXRlU3FsQXJnc1R5cGV9IGFyZ3MgLSBPcHRpb25zIG9iamVjdC5cbiAgICogQHJldHVybnMge3N0cmluZ30gLSBTUUwgc3RyaW5nLlxuICAgKi9cbiAgZGVsZXRlU3FsKGFyZ3MpIHsgcmV0dXJuIG5ldyBEZWxldGUoT2JqZWN0LmFzc2lnbih7ZHJpdmVyOiB0aGlzfSwgYXJncykpLnRvU3FsKCkgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGdldCB0eXBlLlxuICAgKiBAcmV0dXJucyB7c3RyaW5nfSAtIFRoZSB0eXBlLlxuICAgKi9cbiAgZ2V0VHlwZSgpIHsgcmV0dXJuIFwic3FsaXRlXCIgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGluc2VydCBzcWwuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vYmFzZS5qc1wiKS5JbnNlcnRTcWxBcmdzVHlwZX0gYXJncyAtIE9wdGlvbnMgb2JqZWN0LlxuICAgKiBAcmV0dXJucyB7c3RyaW5nfSAtIFNRTCBzdHJpbmcuXG4gICAqL1xuICBpbnNlcnRTcWwoYXJncykgeyByZXR1cm4gbmV3IEluc2VydChPYmplY3QuYXNzaWduKHtkcml2ZXI6IHRoaXN9LCBhcmdzKSkudG9TcWwoKSB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZ2V0IHRhYmxlcy5cbiAgICogQHJldHVybnMge1Byb21pc2U8QXJyYXk8aW1wb3J0KFwiLi4vYmFzZS10YWJsZS5qc1wiKS5kZWZhdWx0Pj59IC0gUmVzb2x2ZXMgd2l0aCB0aGUgdGFibGVzLlxuICAgKi9cbiAgYXN5bmMgZ2V0VGFibGVzKCkge1xuICAgIHJldHVybiBhd2FpdCB0aGlzLl9jYWNoZWRTY2hlbWFNZXRhZGF0YShcInRhYmxlc1wiLCBhc3luYyAoKSA9PiB7XG4gICAgICBjb25zdCByZXN1bHQgPSBhd2FpdCB0aGlzLnF1ZXJ5KFwiU0VMRUNUIG5hbWUgRlJPTSBzcWxpdGVfbWFzdGVyIFdIRVJFIHR5cGUgPSAndGFibGUnIE9SREVSIEJZIG5hbWVcIilcbiAgICAgIGNvbnN0IHRhYmxlcyA9IFtdXG5cbiAgICAgIGZvciAoY29uc3Qgcm93IG9mIHJlc3VsdCkge1xuICAgICAgICBjb25zdCB0YWJsZSA9IG5ldyBUYWJsZSh7ZHJpdmVyOiB0aGlzLCByb3c6IC8qKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgc3RyaW5nIHwgbnVtYmVyIHwgbnVsbD59ICovIChyb3cpfSlcblxuICAgICAgICB0YWJsZXMucHVzaCh0YWJsZSlcbiAgICAgIH1cblxuICAgICAgcmV0dXJuIHRhYmxlc1xuICAgIH0pXG4gIH1cblxuICAvKipcbiAgICogRGVsZXRlcyBldmVyeSBlbGlnaWJsZSB0YWJsZSB0aHJvdWdoIHRoZSBwbGF0Zm9ybSBkcml2ZXIncyBuYXRpdmUgU1FMaXRlXG4gICAqIHNjcmlwdCBwYXRoIHNvIHRoZSB3aG9sZSBjbGVhbnVwIGlzIHN1Ym1pdHRlZCBhcyBvbmUgcmVxdWVzdC5cbiAgICogQHBhcmFtIHtBcnJheTxpbXBvcnQoXCIuLi9iYXNlLXRhYmxlLmpzXCIpLmRlZmF1bHQ+fSB0YWJsZXMgLSBFbGlnaWJsZSB0YWJsZXMuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIHdoZW4gdGhlIHNjcmlwdCBjb21wbGV0ZXMuXG4gICAqL1xuICBhc3luYyB0cnVuY2F0ZVRhYmxlcyh0YWJsZXMpIHtcbiAgICBjb25zdCBzdGF0ZW1lbnRzID0gdGFibGVzLm1hcCgodGFibGUpID0+IGBERUxFVEUgRlJPTSAke3RoaXMucXVvdGVUYWJsZSh0YWJsZS5nZXROYW1lKCkpfWApXG5cbiAgICBhd2FpdCB0aGlzLnF1ZXJ5KHN0YXRlbWVudHMuam9pbihcIjtcXG5cIiksIHtzcWxpdGVTY3JpcHQ6IHRydWV9KVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgaW5zZXJ0IG11bHRpcGxlLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gdGFibGVOYW1lIC0gVGFibGUgbmFtZS5cbiAgICogQHBhcmFtIHtBcnJheTxzdHJpbmc+fSBjb2x1bW5zIC0gQ29sdW1uIG5hbWVzLlxuICAgKiBAcGFyYW0ge0FycmF5PEFycmF5PFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pj59IHJvd3MgLSBSb3dzIHRvIGluc2VydC5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgd2hlbiBjb21wbGV0ZS5cbiAgICovXG4gIGFzeW5jIGluc2VydE11bHRpcGxlKHRhYmxlTmFtZSwgY29sdW1ucywgcm93cykge1xuICAgIHRoaXMuX2Fzc2VydE5vdFJlYWRPbmx5KClcbiAgICBhd2FpdCB0aGlzLnJlZ2lzdGVyVmVyc2lvbigpXG5cbiAgICBpZiAodGhpcy5zdXBwb3J0c011bHRpcGxlSW5zZXJ0VmFsdWVzKCkpIHtcbiAgICAgIGF3YWl0IHRoaXMuaW5zZXJ0TXVsdGlwbGVXaXRoU2luZ2xlSW5zZXJ0KHRhYmxlTmFtZSwgY29sdW1ucywgcm93cylcbiAgICB9IGVsc2Uge1xuICAgICAgYXdhaXQgdGhpcy5pbnNlcnRNdWx0aXBsZVdpdGhUcmFuc2FjdGlvbih0YWJsZU5hbWUsIGNvbHVtbnMsIHJvd3MpXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgc3VwcG9ydHMgbXVsdGlwbGUgaW5zZXJ0IHZhbHVlcy5cbiAgICogQHJldHVybnMge2Jvb2xlYW59IC0gV2hldGhlciBzdXBwb3J0cyBtdWx0aXBsZSBpbnNlcnQgdmFsdWVzLlxuICAgKi9cbiAgc3VwcG9ydHNNdWx0aXBsZUluc2VydFZhbHVlcygpIHtcbiAgICAvKipcbiAgICAgKiBWZXJzaW9uIG1ham9yLlxuICAgICAqIEB0eXBlIHtudW1iZXJ9ICovXG4gICAgY29uc3QgdmVyc2lvbk1ham9yID0gdGhpcy52ZXJzaW9uTWFqb3IgfHwgMFxuICAgIC8qKlxuICAgICAqIFZlcnNpb24gbWlub3IuXG4gICAgICogQHR5cGUge251bWJlcn0gKi9cbiAgICBjb25zdCB2ZXJzaW9uTWlub3IgPSB0aGlzLnZlcnNpb25NaW5vciB8fCAwXG4gICAgLyoqXG4gICAgICogVmVyc2lvbiBwYXRjaC5cbiAgICAgKiBAdHlwZSB7bnVtYmVyfSAqL1xuICAgIGNvbnN0IHZlcnNpb25QYXRjaCA9IHRoaXMudmVyc2lvblBhdGNoIHx8IDBcblxuICAgIGlmICh2ZXJzaW9uTWFqb3IgPj0gNCkgcmV0dXJuIHRydWVcbiAgICBpZiAodmVyc2lvbk1ham9yID09IDMgJiYgdmVyc2lvbk1pbm9yID49IDgpIHJldHVybiB0cnVlXG4gICAgaWYgKHZlcnNpb25NYWpvciA9PSAzICYmIHZlcnNpb25NaW5vciA9PSA3ICYmIHZlcnNpb25QYXRjaCA+PSAxMSkgcmV0dXJuIHRydWVcblxuICAgIHJldHVybiBmYWxzZVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgc3VwcG9ydHMgaW5zZXJ0IGludG8gcmV0dXJuaW5nLlxuICAgKiBAcmV0dXJucyB7Ym9vbGVhbn0gLSBXaGV0aGVyIHN1cHBvcnRzIGluc2VydCBpbnRvIHJldHVybmluZy5cbiAgICovXG4gIHN1cHBvcnRzSW5zZXJ0SW50b1JldHVybmluZygpIHtcbiAgICAvKipcbiAgICAgKiBWZXJzaW9uIG1ham9yLlxuICAgICAqIEB0eXBlIHtudW1iZXJ9ICovXG4gICAgY29uc3QgdmVyc2lvbk1ham9yID0gdGhpcy52ZXJzaW9uTWFqb3IgfHwgMFxuICAgIC8qKlxuICAgICAqIFZlcnNpb24gbWlub3IuXG4gICAgICogQHR5cGUge251bWJlcn0gKi9cbiAgICBjb25zdCB2ZXJzaW9uTWlub3IgPSB0aGlzLnZlcnNpb25NaW5vciB8fCAwXG5cbiAgICBpZiAodmVyc2lvbk1ham9yID49IDQpIHJldHVybiB0cnVlXG4gICAgaWYgKHZlcnNpb25NYWpvciA9PSAzICYmIHZlcnNpb25NaW5vciA+PSAzNSkgcmV0dXJuIHRydWVcblxuICAgIHJldHVybiBmYWxzZVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgaW5zZXJ0IG11bHRpcGxlIHdpdGggc2luZ2xlIGluc2VydC5cbiAgICogQHBhcmFtIHtzdHJpbmd9IHRhYmxlTmFtZSAtIFRhYmxlIG5hbWUuXG4gICAqIEBwYXJhbSB7QXJyYXk8c3RyaW5nPn0gY29sdW1ucyAtIENvbHVtbiBuYW1lcy5cbiAgICogQHBhcmFtIHtBcnJheTxBcnJheTxSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj4+fSByb3dzIC0gUm93cyB0byBpbnNlcnQuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIHdoZW4gY29tcGxldGUuXG4gICAqL1xuICBhc3luYyBpbnNlcnRNdWx0aXBsZVdpdGhTaW5nbGVJbnNlcnQodGFibGVOYW1lLCBjb2x1bW5zLCByb3dzKSB7XG4gICAgdGhpcy5fYXNzZXJ0Tm90UmVhZE9ubHkoKVxuXG4gICAgY29uc3QgY2h1bmtzID0gdGhpcy5faW5zZXJ0TXVsdGlwbGVDaHVua3Mocm93cywgKGNodW5rUm93cykgPT4gbmV3IEluc2VydCh7Y29sdW1ucywgZHJpdmVyOiB0aGlzLCByb3dzOiBjaHVua1Jvd3MsIHRhYmxlTmFtZX0pLnRvU3FsKCkpXG5cbiAgICBmb3IgKGNvbnN0IGNodW5rIG9mIGNodW5rcykge1xuICAgICAgY29uc3Qgc3FsID0gbmV3IEluc2VydCh7Y29sdW1ucywgZHJpdmVyOiB0aGlzLCByb3dzOiBjaHVuaywgdGFibGVOYW1lfSkudG9TcWwoKVxuXG4gICAgICBhd2FpdCB0aGlzLnF1ZXJ5KHNxbClcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogUnVucyBpbnNlcnQgbXVsdGlwbGUgd2l0aCB0cmFuc2FjdGlvbi5cbiAgICogQHBhcmFtIHtzdHJpbmd9IHRhYmxlTmFtZSAtIFRhYmxlIG5hbWUuXG4gICAqIEBwYXJhbSB7QXJyYXk8c3RyaW5nPn0gY29sdW1ucyAtIENvbHVtbiBuYW1lcy5cbiAgICogQHBhcmFtIHtBcnJheTxBcnJheTxSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj4+fSByb3dzIC0gUm93cyB0byBpbnNlcnQuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIHdoZW4gY29tcGxldGUuXG4gICAqL1xuICBhc3luYyBpbnNlcnRNdWx0aXBsZVdpdGhUcmFuc2FjdGlvbih0YWJsZU5hbWUsIGNvbHVtbnMsIHJvd3MpIHtcbiAgICB0aGlzLl9hc3NlcnROb3RSZWFkT25seSgpXG4gICAgLyoqXG4gICAgICogU3Fscy5cbiAgICAgKiBAdHlwZSB7c3RyaW5nW119ICovXG4gICAgY29uc3Qgc3FscyA9IFtdXG5cbiAgICBmb3IgKGNvbnN0IHJvdyBvZiByb3dzKSB7XG4gICAgICAvKipcbiAgICAgICAqIERhdGEuXG4gICAgICAgKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSAqL1xuICAgICAgY29uc3QgZGF0YSA9IHt9XG5cbiAgICAgIGZvciAoY29uc3QgY29sdW1uSW5kZXggaW4gY29sdW1ucykge1xuICAgICAgICBjb25zdCBjb2x1bW5OYW1lID0gY29sdW1uc1tjb2x1bW5JbmRleF1cbiAgICAgICAgY29uc3QgdmFsdWUgPSByb3dbY29sdW1uSW5kZXhdXG5cbiAgICAgICAgZGF0YVtjb2x1bW5OYW1lXSA9IHZhbHVlXG4gICAgICB9XG5cbiAgICAgIGNvbnN0IGluc2VydFNxbCA9IHRoaXMuaW5zZXJ0U3FsKHt0YWJsZU5hbWUsIGRhdGF9KVxuXG4gICAgICBzcWxzLnB1c2goaW5zZXJ0U3FsKVxuICAgIH1cblxuICAgIGF3YWl0IHRoaXMudHJhbnNhY3Rpb24oYXN5bmMgKCkgPT4ge1xuICAgICAgZm9yIChjb25zdCBzcWwgb2Ygc3Fscykge1xuICAgICAgICBhd2FpdCB0aGlzLnF1ZXJ5KHNxbClcbiAgICAgIH1cbiAgICB9KVxuICB9XG5cbiAgYXN5bmMgbGFzdEluc2VydElEKG9wdGlvbnMgPSB7fSkge1xuICAgIGNvbnN0IHJlc3VsdCA9IGF3YWl0IHRoaXMucXVlcnkoXCJTRUxFQ1QgTEFTVF9JTlNFUlRfUk9XSUQoKSBBUyBsYXN0X2luc2VydF9pZFwiLCBvcHRpb25zKVxuXG4gICAgcmV0dXJuIGRpZ2cocmVzdWx0LCAwLCBcImxhc3RfaW5zZXJ0X2lkXCIpXG4gIH1cblxuICBvcHRpb25zKCkge1xuICAgIGlmICghdGhpcy5fb3B0aW9ucykgdGhpcy5fb3B0aW9ucyA9IG5ldyBPcHRpb25zKHRoaXMpXG5cbiAgICByZXR1cm4gdGhpcy5fb3B0aW9uc1xuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgcXVlcnkgdG8gc3FsLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uLy4uL3F1ZXJ5L2luZGV4LmpzXCIpLmRlZmF1bHR9IHF1ZXJ5IC0gUXVlcnkgaW5zdGFuY2UuXG4gICAqIEByZXR1cm5zIHtzdHJpbmd9IC0gU1FMIHN0cmluZy5cbiAgICovXG4gIHF1ZXJ5VG9TcWwocXVlcnkpIHsgcmV0dXJuIG5ldyBRdWVyeVBhcnNlcih7cXVlcnl9KS50b1NxbCgpIH1cblxuICBhc3luYyByZWdpc3RlclZlcnNpb24oKSB7XG4gICAgaWYgKHRoaXMudmVyc2lvbk1ham9yIHx8IHRoaXMudmVyc2lvbk1pbm9yKSB7XG4gICAgICByZXR1cm5cbiAgICB9XG5cbiAgICBjb25zdCB2ZXJzaW9uUmVzdWx0ID0gYXdhaXQgdGhpcy5xdWVyeShcIlNFTEVDVCBzcWxpdGVfdmVyc2lvbigpIEFTIHZlcnNpb25cIilcblxuICAgIHRoaXMudmVyc2lvbiA9IFN0cmluZyh2ZXJzaW9uUmVzdWx0WzBdLnZlcnNpb24pXG5cbiAgICBjb25zdCB2ZXJzaW9uUGFydHMgPSB0aGlzLnZlcnNpb24uc3BsaXQoXCIuXCIpXG5cbiAgICB0aGlzLnZlcnNpb25NYWpvciA9IE51bWJlcih2ZXJzaW9uUGFydHNbMF0pXG4gICAgdGhpcy52ZXJzaW9uTWlub3IgPSBOdW1iZXIodmVyc2lvblBhcnRzWzFdKVxuICAgIHRoaXMudmVyc2lvblBhdGNoID0gTnVtYmVyKHZlcnNpb25QYXJ0c1syXSlcbiAgfVxuXG4gIHNob3VsZFNldEF1dG9JbmNyZW1lbnRXaGVuUHJpbWFyeUtleSgpIHsgcmV0dXJuIGZhbHNlIH1cbiAgc3VwcG9ydHNEZWZhdWx0UHJpbWFyeUtleVVVSUQoKSB7IHJldHVybiBmYWxzZSB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZXNjYXBlLlxuICAgKiBAcGFyYW0ge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSB2YWx1ZSAtIFZhbHVlIHRvIHVzZS5cbiAgICogQHJldHVybnMge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSAtIFRoZSBlc2NhcGUuXG4gICAqL1xuICBlc2NhcGUodmFsdWUpIHtcbiAgICB2YWx1ZSA9IHRoaXMuX2NvbnZlcnRWYWx1ZSh2YWx1ZSlcblxuICAgIGNvbnN0IHR5cGUgPSB0eXBlb2YgdmFsdWVcblxuICAgIGlmICh0eXBlICE9IFwic3RyaW5nXCIpIHZhbHVlID0gYCR7dmFsdWV9YFxuXG4gICAgY29uc3QgcmVzdWx0V2l0aFF1b3RlcyA9IGVzY2FwZVN0cmluZyh2YWx1ZSwgbnVsbClcbiAgICBjb25zdCByZXN1bHQgPSByZXN1bHRXaXRoUXVvdGVzLnN1YnN0cmluZygxLCByZXN1bHRXaXRoUXVvdGVzLmxlbmd0aCAtIDEpXG5cbiAgICByZXR1cm4gcmVzdWx0XG4gIH1cblxuICAvKipcbiAgICogUnVucyByZXRyeWFibGUgZGF0YWJhc2UgZXJyb3IuXG4gICAqIEBwYXJhbSB7RXJyb3J9IGVycm9yIC0gRXJyb3IgaW5zdGFuY2UuXG4gICAqIEByZXR1cm5zIHtpbXBvcnQoXCIuLi9iYXNlLmpzXCIpLlJldHJ5YWJsZURhdGFiYXNlRXJyb3JSZXN1bHR9IC0gUmV0cnkgaW5mby5cbiAgICovXG4gIHJldHJ5YWJsZURhdGFiYXNlRXJyb3IoZXJyb3IpIHtcbiAgICBjb25zdCBkYXRhYmFzZUxvY2tlZCA9IEJvb2xlYW4oZXJyb3IubWVzc2FnZT8uaW5jbHVkZXMoXCJkYXRhYmFzZSBpcyBsb2NrZWRcIikpXG4gICAgY29uc3Qgc2hvdWxkUmV0cnkgPSAoXG4gICAgICBlcnJvci5tZXNzYWdlPy5zdGFydHNXaXRoKFwiYXR0ZW1wdCB0byB3cml0ZSBhIHJlYWRvbmx5IGRhdGFiYXNlXCIpIHx8XG4gICAgICBkYXRhYmFzZUxvY2tlZFxuICAgIClcblxuICAgIHJldHVybiB7ZGVhZGxvY2s6IGRhdGFiYXNlTG9ja2VkLCByZXRyeTogc2hvdWxkUmV0cnksIHJlY29ubmVjdDogZmFsc2V9XG4gIH1cblxuICAvKipcbiAgICogUnVucyBxdW90ZS5cbiAgICogQHBhcmFtIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gdmFsdWUgLSBWYWx1ZSB0byB1c2UuXG4gICAqIEByZXR1cm5zIHtzdHJpbmcgfCBudW1iZXJ9IC0gVGhlIHF1b3RlZCB2YWx1ZS5cbiAgICovXG4gIHF1b3RlKHZhbHVlKSB7XG4gICAgdmFsdWUgPSB0aGlzLl9jb252ZXJ0VmFsdWUodmFsdWUpXG5cbiAgICBjb25zdCB0eXBlID0gdHlwZW9mIHZhbHVlXG5cbiAgICBpZiAodHlwZSA9PSBcIm51bWJlclwiKSByZXR1cm4gLyoqIEB0eXBlIHtudW1iZXJ9ICovICh2YWx1ZSlcbiAgICBpZiAodHlwZSAhPSBcInN0cmluZ1wiKSB2YWx1ZSA9IFN0cmluZyh2YWx1ZSlcblxuICAgIHJldHVybiBlc2NhcGVTdHJpbmcodmFsdWUsIG51bGwpXG4gIH1cblxuICAvKipcbiAgICogUnVucyB1cGRhdGUgc3FsLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL2Jhc2UuanNcIikuVXBkYXRlU3FsQXJnc1R5cGV9IGFyZ3MgLSBPcHRpb25zIG9iamVjdC5cbiAgICogQHJldHVybnMge3N0cmluZ30gLSBTUUwgc3RyaW5nLlxuICAgKi9cbiAgdXBkYXRlU3FsKHtjb25kaXRpb25zLCBkYXRhLCB0YWJsZU5hbWV9KSB7IHJldHVybiBuZXcgVXBkYXRlKHtjb25kaXRpb25zLCBkYXRhLCBkcml2ZXI6IHRoaXMsIHRhYmxlTmFtZX0pLnRvU3FsKCkgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHVwc2VydCBzcWwuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vYmFzZS5qc1wiKS5VcHNlcnRTcWxBcmdzVHlwZX0gYXJncyAtIE9wdGlvbnMgb2JqZWN0LlxuICAgKiBAcmV0dXJucyB7c3RyaW5nfSAtIFNRTCBzdHJpbmcuXG4gICAqL1xuICB1cHNlcnRTcWwoYXJncykgeyByZXR1cm4gbmV3IFVwc2VydCh7Li4uYXJncywgZHJpdmVyOiB0aGlzfSkudG9TcWwoKSB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgc3RydWN0dXJlIHNxbC5cbiAgICogQHJldHVybnMge1Byb21pc2U8c3RyaW5nIHwgbnVsbD59IC0gUmVzb2x2ZXMgd2l0aCBTUUwgc3RyaW5nLlxuICAgKi9cbiAgYXN5bmMgc3RydWN0dXJlU3FsKCkge1xuICAgIHJldHVybiBhd2FpdCB0aGlzLl9jYWNoZWRTY2hlbWFNZXRhZGF0YShcInN0cnVjdHVyZVNxbFwiLCBhc3luYyAoKSA9PiBhd2FpdCBuZXcgU3RydWN0dXJlU3FsKHtkcml2ZXI6IHRoaXN9KS50b1NxbCgpKVxuICB9XG5cbiAgLyoqXG4gICAqIFNRTGl0ZSBoYXMgbm8gbmF0aXZlIGFkdmlzb3J5LWxvY2sgcHJpbWl0aXZlLCBzbyB0aGUgc2hhcmVkXG4gICAqIHByb2Nlc3MtbG9jYWwgcHJlLWZpbHRlciB0aWVyIGluIHRoZSBiYXNlIGRyaXZlciBpcyB0aGUgd2hvbGVcbiAgICogaW1wbGVtZW50YXRpb24gZm9yIHRoZSB3ZWIvc3FsLmpzIGFuZCBFeHBvIG5hdGl2ZSBidWlsZHMuIFRoZSBOb2RlXG4gICAqIGRyaXZlciBsYXllcnMgaXRzIGZpbGVzeXN0ZW0gbG9jayBvbiB0b3AgYXMgdGhlIGRyaXZlci1uYXRpdmUgdGllci5cbiAgICogQHJldHVybnMge2Jvb2xlYW59IC0gQWx3YXlzIGZhbHNlIGZvciBwbGFpbiBTUUxpdGUuXG4gICAqL1xuICBzdXBwb3J0c0RyaXZlck5hdGl2ZUFkdmlzb3J5TG9jaygpIHtcbiAgICByZXR1cm4gZmFsc2VcbiAgfVxuXG4gIC8qKlxuICAgKiBUaGUgU1FMaXRlIGVtdWxhdGlvbiBpcyBub3QgcmUtZW50cmFudDogYSByZS1hY3F1aXNpdGlvbiBieSB0aGUgc2FtZVxuICAgKiBkcml2ZXIgaW5zdGFuY2UgaXMgY29udGVudGlvbiwgbm90IGEgZ3JhbnQsIGV4YWN0bHkgYXMgdGhlIGluLXByb2Nlc3NcbiAgICogcXVldWUgYWx3YXlzIGJlaGF2ZWQuXG4gICAqIEByZXR1cm5zIHtib29sZWFufSAtIEFsd2F5cyBmYWxzZSBmb3IgU1FMaXRlLlxuICAgKi9cbiAgc3VwcG9ydHNSZWVudHJhbnRBZHZpc29yeUxvY2soKSB7XG4gICAgcmV0dXJuIGZhbHNlXG4gIH1cblxuICAvKipcbiAgICogVGhlIFNRTGl0ZSBlbXVsYXRpb24gaXMgdGhlIHByb2Nlc3MtbG9jYWwgdGllciBvZiB0aGUgU1RDLTIxMCBjaGFpbi5cbiAgICogQHJldHVybnMge3N0cmluZ30gLSBUaWVyIG5hbWUgcmVwb3J0ZWQgb24gdGVsZW1ldHJ5IHBheWxvYWRzLlxuICAgKi9cbiAgYWR2aXNvcnlMb2NrQmFja2VuZFRpZXIoKSB7XG4gICAgcmV0dXJuIFwicHJvY2Vzcy1sb2NhbFwiXG4gIH1cblxuICAvKipcbiAgICogQXR0cmlidXRlIHRoZSBuYW1lZCBsb2NrIHRvIHRoZSBkcml2ZXIgaW5zdGFuY2UgdGhhdCBvd25zIGl0IGluIHRoZVxuICAgKiBzaGFyZWQgaW4tcHJvY2VzcyByZWdpc3RyeSAoYmVzdC1lZmZvcnQ7IHRoZSBjYWxsZXIgZ3VhcmRzIGZhaWx1cmVzKS5cbiAgICogQHBhcmFtIHtzdHJpbmd9IG5hbWUgLSBMb2NrIG5hbWUuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHN0cmluZyB8IG51bGw+fSAtIE93bmluZyBkcml2ZXIncyBob2xkZXIgaWQsIG9yIG51bGwgd2hlbiBubyBpbnN0YW5jZSBob2xkcyB0aGUgbG9jay5cbiAgICovXG4gIGFzeW5jIGFkdmlzb3J5TG9ja0hvbGRlckNvbm5lY3Rpb25JZChuYW1lKSB7XG4gICAgY29uc3Qgb3duZXIgPSBWZWxvY2lvdXNEYXRhYmFzZURyaXZlcnNTcWxpdGVCYXNlLl9hZHZpc29yeUxvY2tTdGF0ZS5vd25lcnNCeU5hbWUuZ2V0KG5hbWUpXG5cbiAgICByZXR1cm4gb3duZXIgPyBvd25lci5hZHZpc29yeUxvY2tIb2xkZXJJZCgpIDogbnVsbFxuICB9XG59XG4iXX0=