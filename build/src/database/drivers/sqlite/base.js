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
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiYmFzZS5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uLy4uLy4uLy4uLy4uL3NyYy9kYXRhYmFzZS9kcml2ZXJzL3NxbGl0ZS9iYXNlLmpzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiJBQUFBLFlBQVk7QUFFWixPQUFPLEVBQUMsSUFBSSxFQUFDLE1BQU0sV0FBVyxDQUFBO0FBRTlCLE9BQU8sVUFBVSxNQUFNLHNCQUFzQixDQUFBO0FBQzdDLE9BQU8sSUFBSSxNQUFNLFlBQVksQ0FBQTtBQUM3QixPQUFPLFdBQVcsTUFBTSx1QkFBdUIsQ0FBQTtBQUMvQyxPQUFPLFdBQVcsTUFBTSx1QkFBdUIsQ0FBQTtBQUMvQyxPQUFPLE1BQU0sTUFBTSxpQkFBaUIsQ0FBQTtBQUNwQyxPQUFPLFNBQVMsTUFBTSxxQkFBcUIsQ0FBQTtBQUMzQyxPQUFPLFlBQVksTUFBTSxtQkFBbUIsQ0FBQTtBQUM1QyxPQUFPLE1BQU0sTUFBTSxpQkFBaUIsQ0FBQTtBQUNwQyxPQUFPLE9BQU8sTUFBTSxjQUFjLENBQUE7QUFDbEMsT0FBTyxXQUFXLE1BQU0sbUJBQW1CLENBQUE7QUFDM0MsT0FBTyxXQUFXLE1BQU0sdUJBQXVCLENBQUE7QUFDL0MsT0FBTyxLQUFLLE1BQU0sWUFBWSxDQUFBO0FBQzlCLE9BQU8sWUFBWSxNQUFNLG9CQUFvQixDQUFBO0FBQzdDLE9BQU8sTUFBTSxNQUFNLGlCQUFpQixDQUFBO0FBQ3BDLE9BQU8sTUFBTSxNQUFNLGlCQUFpQixDQUFBO0FBRXBDLE1BQU0sQ0FBQyxPQUFPLE9BQU8sa0NBQW1DLFNBQVEsSUFBSTtJQUNsRTs7b0NBRWdDO0lBQ2hDLFlBQVksR0FBRyxTQUFTLENBQUE7SUFDeEI7O29DQUVnQztJQUNoQyxZQUFZLEdBQUcsU0FBUyxDQUFBO0lBQ3hCOztvQ0FFZ0M7SUFDaEMsWUFBWSxHQUFHLFNBQVMsQ0FBQTtJQUV4Qjs7OztPQUlHO0lBQ0gsS0FBSyxDQUFDLGNBQWMsQ0FBQyxTQUFTO1FBQzVCLE1BQU0sU0FBUyxHQUFH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QUFDLEVBQUMsTUFBTSxFQUFFLElBQUksRUFBQyxDQUFDLENBQUMsS0FBSyxFQUFFLENBQUMsQ0FBQTtJQUNySCxDQUFDO0lBRUQ7Ozs7OztPQU1HO0lBQ0gsZ0NBQWdDO1FBQzlCLE9BQU8sS0FBSyxDQUFBO0lBQ2QsQ0FBQztJQUVEOzs7OztPQUtHO0lBQ0gsNkJBQTZCO1FBQzNCLE9BQU8sS0FBSyxDQUFBO0lBQ2QsQ0FBQztDQUNGIiwic291cmNlc0NvbnRlbnQiOlsiLy8gQHRzLWNoZWNrXG5cbmltcG9ydCB7ZGlnZ30gZnJvbSBcImRpZ2dlcml6ZVwiXG5cbmltcG9ydCBBbHRlclRhYmxlIGZyb20gXCIuL3NxbC9hbHRlci10YWJsZS5qc1wiXG5pbXBvcnQgQmFzZSBmcm9tIFwiLi4vYmFzZS5qc1wiXG5pbXBvcnQgQ3JlYXRlSW5kZXggZnJvbSBcIi4vc3FsL2NyZWF0ZS1pbmRleC5qc1wiXG5pbXBvcnQgQ3JlYXRlVGFibGUgZnJvbSBcIi4vc3FsL2NyZWF0ZS10YWJsZS5qc1wiXG5pbXBvcnQgRGVsZXRlIGZyb20gXCIuL3NxbC9kZWxldGUuanNcIlxuaW1wb3J0IERyb3BUYWJsZSBmcm9tIFwiLi9zcWwvZHJvcC10YWJsZS5qc1wiXG5pbXBvcnQgZXNjYXBlU3RyaW5nIGZyb20gXCJzcWwtZXNjYXBlLXN0cmluZ1wiXG5pbXBvcnQgSW5zZXJ0IGZyb20gXCIuL3NxbC9pbnNlcnQuanNcIlxuaW1wb3J0IE9wdGlvbnMgZnJvbSBcIi4vb3B0aW9ucy5qc1wiXG5pbXBvcnQgUXVlcnlQYXJzZXIgZnJvbSBcIi4vcXVlcnktcGFyc2VyLmpzXCJcbmltcG9ydCBSZW1vdmVJbmRleCBmcm9tIFwiLi9zcWwvcmVtb3ZlLWluZGV4LmpzXCJcbmltcG9ydCBUYWJsZSBmcm9tIFwiLi90YWJsZS5qc1wiXG5pbXBvcnQgU3RydWN0dXJlU3FsIGZyb20gXCIuL3N0cnVjdHVyZS1zcWwuanNcIlxuaW1wb3J0IFVwc2VydCBmcm9tIFwiLi9zcWwvdXBzZXJ0LmpzXCJcbmltcG9ydCBVcGRhdGUgZnJvbSBcIi4vc3FsL3VwZGF0ZS5qc1wiXG5cbmV4cG9ydCBkZWZhdWx0IGNsYXNzIFZlbG9jaW91c0RhdGFiYXNlRHJpdmVyc1NxbGl0ZUJhc2UgZXh0ZW5kcyBCYXNlIHtcbiAgLyoqXG4gICAqIFZlcnNpb24gbWFqb3IuXG4gICAqIEB0eXBlIHtudW1iZXIgfCB1bmRlZmluZWR9ICovXG4gIHZlcnNpb25NYWpvciA9IHVuZGVmaW5lZFxuICAvKipcbiAgICogVmVyc2lvbiBtaW5vci5cbiAgICogQHR5cGUge251bWJlciB8IHVuZGVmaW5lZH0gKi9cbiAgdmVyc2lvbk1pbm9yID0gdW5kZWZpbmVkXG4gIC8qKlxuICAgKiBWZXJzaW9uIHBhdGNoLlxuICAgKiBAdHlwZSB7bnVtYmVyIHwgdW5kZWZpbmVkfSAqL1xuICB2ZXJzaW9uUGF0Y2ggPSB1bmRlZmluZWRcblxuICAvKipcbiAgICogUnVucyBhbHRlciB0YWJsZSBzcWxzLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uLy4uL3RhYmxlLWRhdGEvaW5kZXguanNcIikuZGVmYXVsdH0gdGFibGVEYXRhIC0gVGFibGUgZGF0YS5cbiAgICogQHJldHVybnMge1Byb21pc2U8c3RyaW5nW10+fSAtIFJlc29sdmVzIHdpdGggU1FMIHN0YXRlbWVudHMuXG4gICAqL1xuICBhc3luYyBhbHRlclRhYmxlU1FMcyh0YWJsZURhdGEpIHtcbiAgICBjb25zdCBhbHRlckFyZ3MgPSB7ZHJpdmVyOiB0aGlzLCB0YWJsZURhdGF9XG4gICAgY29uc3QgYWx0ZXJUYWJsZSA9IG5ldyBBbHRlclRhYmxlKGFsdGVyQXJncylcblxuICAgIHJldHVybiBhd2FpdCBhbHRlclRhYmxlLnRvU1FMcygpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBjcmVhdGUgaW5kZXggc3Fscy5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9iYXNlLmpzXCIpLkNyZWF0ZUluZGV4U3FsQXJnc30gaW5kZXhEYXRhIC0gSW5kZXggZGF0YS5cbiAgICogQHJldHVybnMge1Byb21pc2U8c3RyaW5nW10+fSAtIFJlc29sdmVzIHdpdGggU1FMIHN0YXRlbWVudHMuXG4gICAqL1xuICBhc3luYyBjcmVhdGVJbmRleFNRTHMoaW5kZXhEYXRhKSB7XG4gICAgY29uc3QgY3JlYXRlQXJncyA9IE9iamVjdC5hc3NpZ24oe2RyaXZlcjogdGhpc30sIGluZGV4RGF0YSlcbiAgICBjb25zdCBjcmVhdGVJbmRleCA9IG5ldyBDcmVhdGVJbmRleChjcmVhdGVBcmdzKVxuXG4gICAgcmV0dXJuIGF3YWl0IGNyZWF0ZUluZGV4LnRvU1FMcygpXG4gIH1cblxuICAvKipcbiAgICogUnVucyByZW1vdmUgaW5kZXggc3Fscy5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9iYXNlLmpzXCIpLlJlbW92ZUluZGV4U3FsQXJnc30gaW5kZXhEYXRhIC0gSW5kZXggZGF0YS5cbiAgICogQHJldHVybnMge1Byb21pc2U8c3RyaW5nW10+fSAtIFJlc29sdmVzIHdpdGggU1FMIHN0YXRlbWVudHMuXG4gICAqL1xuICBhc3luYyByZW1vdmVJbmRleFNRTHMoaW5kZXhEYXRhKSB7XG4gICAgY29uc3QgcmVtb3ZlQXJncyA9IE9iamVjdC5hc3NpZ24oe2RyaXZlcjogdGhpc30sIGluZGV4RGF0YSlcbiAgICBjb25zdCByZW1vdmVJbmRleCA9IG5ldyBSZW1vdmVJbmRleChyZW1vdmVBcmdzKVxuXG4gICAgcmV0dXJuIGF3YWl0IHJlbW92ZUluZGV4LnRvU1FMcygpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBjcmVhdGUgdGFibGUgc3FsLlxuICAgKiBAYWJzdHJhY3RcbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi8uLi90YWJsZS1kYXRhL2luZGV4LmpzXCIpLmRlZmF1bHR9IHRhYmxlRGF0YSAtIFRhYmxlIGRhdGEuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHN0cmluZ1tdPn0gLSBSZXNvbHZlcyB3aXRoIFNRTCBzdGF0ZW1lbnRzLlxuICAgKi9cbiAgYXN5bmMgY3JlYXRlVGFibGVTcWwodGFibGVEYXRhKSB7XG4gICAgY29uc3QgY3JlYXRlQXJncyA9IHt0YWJsZURhdGEsIGRyaXZlcjogdGhpcywgaW5kZXhJbkNyZWF0ZVRhYmxlOiBmYWxzZX1cbiAgICBjb25zdCBjcmVhdGVUYWJsZSA9IG5ldyBDcmVhdGVUYWJsZShjcmVhdGVBcmdzKVxuXG4gICAgcmV0dXJuIGF3YWl0IGNyZWF0ZVRhYmxlLnRvU3FsKClcbiAgfVxuXG4gIGN1cnJlbnREYXRhYmFzZSgpIHtcbiAgICByZXR1cm4gbnVsbFxuICB9XG5cbiAgYXN5bmMgZGlzYWJsZUZvcmVpZ25LZXlzKCkge1xuICAgIGF3YWl0IHRoaXMucXVlcnkoXCJQUkFHTUEgZm9yZWlnbl9rZXlzID0gMFwiKVxuICB9XG5cbiAgYXN5bmMgZW5hYmxlRm9yZWlnbktleXMoKSB7XG4gICAgYXdhaXQgdGhpcy5xdWVyeShcIlBSQUdNQSBmb3JlaWduX2tleXMgPSAxXCIpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBkcm9wIHRhYmxlIHNxbHMuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSB0YWJsZU5hbWUgLSBUYWJsZSBuYW1lLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL2Jhc2UuanNcIikuRHJvcFRhYmxlU3FsQXJnc1R5cGV9IFthcmdzXSAtIE9wdGlvbnMgb2JqZWN0LlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxzdHJpbmdbXT59IC0gUmVzb2x2ZXMgd2l0aCBTUUwgc3RhdGVtZW50cy5cbiAgICovXG4gIGFzeW5jIGRyb3BUYWJsZVNRTHModGFibGVOYW1lLCBhcmdzID0ge30pIHtcbiAgICBjb25zdCBkcml2ZXIgPSAvKiogQHR5cGUge2ltcG9ydChcIi4uL2Jhc2UuanNcIikuZGVmYXVsdH0gKi8gKHRoaXMpXG4gICAgY29uc3QgZHJvcEFyZ3MgPSBPYmplY3QuYXNzaWduKHt0YWJsZU5hbWUsIGRyaXZlcn0sIGFyZ3MpXG4gICAgY29uc3QgZHJvcFRhYmxlID0gbmV3IERyb3BUYWJsZShkcm9wQXJncylcblxuICAgIHJldHVybiBhd2FpdCBkcm9wVGFibGUudG9TUUxzKClcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGRlbGV0ZSBzcWwuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vYmFzZS5qc1wiKS5EZWxldGVTcWxBcmdzVHlwZX0gYXJncyAtIE9wdGlvbnMgb2JqZWN0LlxuICAgKiBAcmV0dXJucyB7c3RyaW5nfSAtIFNRTCBzdHJpbmcuXG4gICAqL1xuICBkZWxldGVTcWwoYXJncykgeyByZXR1cm4gbmV3IERlbGV0ZShPYmplY3QuYXNzaWduKHtkcml2ZXI6IHRoaXN9LCBhcmdzKSkudG9TcWwoKSB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZ2V0IHR5cGUuXG4gICAqIEByZXR1cm5zIHtzdHJpbmd9IC0gVGhlIHR5cGUuXG4gICAqL1xuICBnZXRUeXBlKCkgeyByZXR1cm4gXCJzcWxpdGVcIiB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgaW5zZXJ0IHNxbC5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9iYXNlLmpzXCIpLkluc2VydFNxbEFyZ3NUeXBlfSBhcmdzIC0gT3B0aW9ucyBvYmplY3QuXG4gICAqIEByZXR1cm5zIHtzdHJpbmd9IC0gU1FMIHN0cmluZy5cbiAgICovXG4gIGluc2VydFNxbChhcmdzKSB7IHJldHVybiBuZXcgSW5zZXJ0KE9iamVjdC5hc3NpZ24oe2RyaXZlcjogdGhpc30sIGFyZ3MpKS50b1NxbCgpIH1cblxuICAvKipcbiAgICogUnVucyBnZXQgdGFibGVzLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxBcnJheTxpbXBvcnQoXCIuLi9iYXNlLXRhYmxlLmpzXCIpLmRlZmF1bHQ+Pn0gLSBSZXNvbHZlcyB3aXRoIHRoZSB0YWJsZXMuXG4gICAqL1xuICBhc3luYyBnZXRUYWJsZXMoKSB7XG4gICAgcmV0dXJuIGF3YWl0IHRoaXMuX2NhY2hlZFNjaGVtYU1ldGFkYXRhKFwidGFibGVzXCIsIGFzeW5jICgpID0+IHtcbiAgICAgIGNvbnN0IHJlc3VsdCA9IGF3YWl0IHRoaXMucXVlcnkoXCJTRUxFQ1QgbmFtZSBGUk9NIHNxbGl0ZV9tYXN0ZXIgV0hFUkUgdHlwZSA9ICd0YWJsZScgT1JERVIgQlkgbmFtZVwiKVxuICAgICAgY29uc3QgdGFibGVzID0gW11cblxuICAgICAgZm9yIChjb25zdCByb3cgb2YgcmVzdWx0KSB7XG4gICAgICAgIGNvbnN0IHRhYmxlID0gbmV3IFRhYmxlKHtkcml2ZXI6IHRoaXMsIHJvdzogLyoqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBzdHJpbmcgfCBudW1iZXIgfCBudWxsPn0gKi8gKHJvdyl9KVxuXG4gICAgICAgIHRhYmxlcy5wdXNoKHRhYmxlKVxuICAgICAgfVxuXG4gICAgICByZXR1cm4gdGFibGVzXG4gICAgfSlcbiAgfVxuXG4gIC8qKlxuICAgKiBEZWxldGVzIGV2ZXJ5IGVsaWdpYmxlIHRhYmxlIHRocm91Z2ggdGhlIHBsYXRmb3JtIGRyaXZlcidzIG5hdGl2ZSBTUUxpdGVcbiAgICogc2NyaXB0IHBhdGggc28gdGhlIHdob2xlIGNsZWFudXAgaXMgc3VibWl0dGVkIGFzIG9uZSByZXF1ZXN0LlxuICAgKiBAcGFyYW0ge0FycmF5PGltcG9ydChcIi4uL2Jhc2UtdGFibGUuanNcIikuZGVmYXVsdD59IHRhYmxlcyAtIEVsaWdpYmxlIHRhYmxlcy5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgd2hlbiB0aGUgc2NyaXB0IGNvbXBsZXRlcy5cbiAgICovXG4gIGFzeW5jIHRydW5jYXRlVGFibGVzKHRhYmxlcykge1xuICAgIGNvbnN0IHN0YXRlbWVudHMgPSB0YWJsZXMubWFwKCh0YWJsZSkgPT4gYERFTEVURSBGUk9NICR7dGhpcy5xdW90ZVRhYmxlKHRhYmxlLmdldE5hbWUoKSl9YClcblxuICAgIGF3YWl0IHRoaXMucXVlcnkoc3RhdGVtZW50cy5qb2luKFwiO1xcblwiKSwge3NxbGl0ZVNjcmlwdDogdHJ1ZX0pXG4gIH1cblxuICAvKipcbiAgICogUnVucyBpbnNlcnQgbXVsdGlwbGUuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSB0YWJsZU5hbWUgLSBUYWJsZSBuYW1lLlxuICAgKiBAcGFyYW0ge0FycmF5PHN0cmluZz59IGNvbHVtbnMgLSBDb2x1bW4gbmFtZXMuXG4gICAqIEBwYXJhbSB7QXJyYXk8QXJyYXk8UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+Pn0gcm93cyAtIFJvd3MgdG8gaW5zZXJ0LlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyB3aGVuIGNvbXBsZXRlLlxuICAgKi9cbiAgYXN5bmMgaW5zZXJ0TXVsdGlwbGUodGFibGVOYW1lLCBjb2x1bW5zLCByb3dzKSB7XG4gICAgdGhpcy5fYXNzZXJ0Tm90UmVhZE9ubHkoKVxuICAgIGF3YWl0IHRoaXMucmVnaXN0ZXJWZXJzaW9uKClcblxuICAgIGlmICh0aGlzLnN1cHBvcnRzTXVsdGlwbGVJbnNlcnRWYWx1ZXMoKSkge1xuICAgICAgYXdhaXQgdGhpcy5pbnNlcnRNdWx0aXBsZVdpdGhTaW5nbGVJbnNlcnQodGFibGVOYW1lLCBjb2x1bW5zLCByb3dzKVxuICAgIH0gZWxzZSB7XG4gICAgICBhd2FpdCB0aGlzLmluc2VydE11bHRpcGxlV2l0aFRyYW5zYWN0aW9uKHRhYmxlTmFtZSwgY29sdW1ucywgcm93cylcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogUnVucyBzdXBwb3J0cyBtdWx0aXBsZSBpbnNlcnQgdmFsdWVzLlxuICAgKiBAcmV0dXJucyB7Ym9vbGVhbn0gLSBXaGV0aGVyIHN1cHBvcnRzIG11bHRpcGxlIGluc2VydCB2YWx1ZXMuXG4gICAqL1xuICBzdXBwb3J0c011bHRpcGxlSW5zZXJ0VmFsdWVzKCkge1xuICAgIC8qKlxuICAgICAqIFZlcnNpb24gbWFqb3IuXG4gICAgICogQHR5cGUge251bWJlcn0gKi9cbiAgICBjb25zdCB2ZXJzaW9uTWFqb3IgPSB0aGlzLnZlcnNpb25NYWpvciB8fCAwXG4gICAgLyoqXG4gICAgICogVmVyc2lvbiBtaW5vci5cbiAgICAgKiBAdHlwZSB7bnVtYmVyfSAqL1xuICAgIGNvbnN0IHZlcnNpb25NaW5vciA9IHRoaXMudmVyc2lvbk1pbm9yIHx8IDBcbiAgICAvKipcbiAgICAgKiBWZXJzaW9uIHBhdGNoLlxuICAgICAqIEB0eXBlIHtudW1iZXJ9ICovXG4gICAgY29uc3QgdmVyc2lvblBhdGNoID0gdGhpcy52ZXJzaW9uUGF0Y2ggfHwgMFxuXG4gICAgaWYgKHZlcnNpb25NYWpvciA+PSA0KSByZXR1cm4gdHJ1ZVxuICAgIGlmICh2ZXJzaW9uTWFqb3IgPT0gMyAmJiB2ZXJzaW9uTWlub3IgPj0gOCkgcmV0dXJuIHRydWVcbiAgICBpZiAodmVyc2lvbk1ham9yID09IDMgJiYgdmVyc2lvbk1pbm9yID09IDcgJiYgdmVyc2lvblBhdGNoID49IDExKSByZXR1cm4gdHJ1ZVxuXG4gICAgcmV0dXJuIGZhbHNlXG4gIH1cblxuICAvKipcbiAgICogUnVucyBzdXBwb3J0cyBpbnNlcnQgaW50byByZXR1cm5pbmcuXG4gICAqIEByZXR1cm5zIHtib29sZWFufSAtIFdoZXRoZXIgc3VwcG9ydHMgaW5zZXJ0IGludG8gcmV0dXJuaW5nLlxuICAgKi9cbiAgc3VwcG9ydHNJbnNlcnRJbnRvUmV0dXJuaW5nKCkge1xuICAgIC8qKlxuICAgICAqIFZlcnNpb24gbWFqb3IuXG4gICAgICogQHR5cGUge251bWJlcn0gKi9cbiAgICBjb25zdCB2ZXJzaW9uTWFqb3IgPSB0aGlzLnZlcnNpb25NYWpvciB8fCAwXG4gICAgLyoqXG4gICAgICogVmVyc2lvbiBtaW5vci5cbiAgICAgKiBAdHlwZSB7bnVtYmVyfSAqL1xuICAgIGNvbnN0IHZlcnNpb25NaW5vciA9IHRoaXMudmVyc2lvbk1pbm9yIHx8IDBcblxuICAgIGlmICh2ZXJzaW9uTWFqb3IgPj0gNCkgcmV0dXJuIHRydWVcbiAgICBpZiAodmVyc2lvbk1ham9yID09IDMgJiYgdmVyc2lvbk1pbm9yID49IDM1KSByZXR1cm4gdHJ1ZVxuXG4gICAgcmV0dXJuIGZhbHNlXG4gIH1cblxuICAvKipcbiAgICogUnVucyBpbnNlcnQgbXVsdGlwbGUgd2l0aCBzaW5nbGUgaW5zZXJ0LlxuICAgKiBAcGFyYW0ge3N0cmluZ30gdGFibGVOYW1lIC0gVGFibGUgbmFtZS5cbiAgICogQHBhcmFtIHtBcnJheTxzdHJpbmc+fSBjb2x1bW5zIC0gQ29sdW1uIG5hbWVzLlxuICAgKiBAcGFyYW0ge0FycmF5PEFycmF5PFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pj59IHJvd3MgLSBSb3dzIHRvIGluc2VydC5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgd2hlbiBjb21wbGV0ZS5cbiAgICovXG4gIGFzeW5jIGluc2VydE11bHRpcGxlV2l0aFNpbmdsZUluc2VydCh0YWJsZU5hbWUsIGNvbHVtbnMsIHJvd3MpIHtcbiAgICB0aGlzLl9hc3NlcnROb3RSZWFkT25seSgpXG5cbiAgICBjb25zdCBjaHVua3MgPSB0aGlzLl9pbnNlcnRNdWx0aXBsZUNodW5rcyhyb3dzLCAoY2h1bmtSb3dzKSA9PiBuZXcgSW5zZXJ0KHtjb2x1bW5zLCBkcml2ZXI6IHRoaXMsIHJvd3M6IGNodW5rUm93cywgdGFibGVOYW1lfSkudG9TcWwoKSlcblxuICAgIGZvciAoY29uc3QgY2h1bmsgb2YgY2h1bmtzKSB7XG4gICAgICBjb25zdCBzcWwgPSBuZXcgSW5zZXJ0KHtjb2x1bW5zLCBkcml2ZXI6IHRoaXMsIHJvd3M6IGNodW5rLCB0YWJsZU5hbWV9KS50b1NxbCgpXG5cbiAgICAgIGF3YWl0IHRoaXMucXVlcnkoc3FsKVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGluc2VydCBtdWx0aXBsZSB3aXRoIHRyYW5zYWN0aW9uLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gdGFibGVOYW1lIC0gVGFibGUgbmFtZS5cbiAgICogQHBhcmFtIHtBcnJheTxzdHJpbmc+fSBjb2x1bW5zIC0gQ29sdW1uIG5hbWVzLlxuICAgKiBAcGFyYW0ge0FycmF5PEFycmF5PFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pj59IHJvd3MgLSBSb3dzIHRvIGluc2VydC5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgd2hlbiBjb21wbGV0ZS5cbiAgICovXG4gIGFzeW5jIGluc2VydE11bHRpcGxlV2l0aFRyYW5zYWN0aW9uKHRhYmxlTmFtZSwgY29sdW1ucywgcm93cykge1xuICAgIHRoaXMuX2Fzc2VydE5vdFJlYWRPbmx5KClcbiAgICAvKipcbiAgICAgKiBTcWxzLlxuICAgICAqIEB0eXBlIHtzdHJpbmdbXX0gKi9cbiAgICBjb25zdCBzcWxzID0gW11cblxuICAgIGZvciAoY29uc3Qgcm93IG9mIHJvd3MpIHtcbiAgICAgIC8qKlxuICAgICAgICogRGF0YS5cbiAgICAgICAqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59ICovXG4gICAgICBjb25zdCBkYXRhID0ge31cblxuICAgICAgZm9yIChjb25zdCBjb2x1bW5JbmRleCBpbiBjb2x1bW5zKSB7XG4gICAgICAgIGNvbnN0IGNvbHVtbk5hbWUgPSBjb2x1bW5zW2NvbHVtbkluZGV4XVxuICAgICAgICBjb25zdCB2YWx1ZSA9IHJvd1tjb2x1bW5JbmRleF1cblxuICAgICAgICBkYXRhW2NvbHVtbk5hbWVdID0gdmFsdWVcbiAgICAgIH1cblxuICAgICAgY29uc3QgaW5zZXJ0U3FsID0gdGhpcy5pbnNlcnRTcWwoe3RhYmxlTmFtZSwgZGF0YX0pXG5cbiAgICAgIHNxbHMucHVzaChpbnNlcnRTcWwpXG4gICAgfVxuXG4gICAgYXdhaXQgdGhpcy50cmFuc2FjdGlvbihhc3luYyAoKSA9PiB7XG4gICAgICBmb3IgKGNvbnN0IHNxbCBvZiBzcWxzKSB7XG4gICAgICAgIGF3YWl0IHRoaXMucXVlcnkoc3FsKVxuICAgICAgfVxuICAgIH0pXG4gIH1cblxuICBhc3luYyBsYXN0SW5zZXJ0SUQob3B0aW9ucyA9IHt9KSB7XG4gICAgY29uc3QgcmVzdWx0ID0gYXdhaXQgdGhpcy5xdWVyeShcIlNFTEVDVCBMQVNUX0lOU0VSVF9ST1dJRCgpIEFTIGxhc3RfaW5zZXJ0X2lkXCIsIG9wdGlvbnMpXG5cbiAgICByZXR1cm4gZGlnZyhyZXN1bHQsIDAsIFwibGFzdF9pbnNlcnRfaWRcIilcbiAgfVxuXG4gIG9wdGlvbnMoKSB7XG4gICAgaWYgKCF0aGlzLl9vcHRpb25zKSB0aGlzLl9vcHRpb25zID0gbmV3IE9wdGlvbnModGhpcylcblxuICAgIHJldHVybiB0aGlzLl9vcHRpb25zXG4gIH1cblxuICAvKipcbiAgICogUnVucyBxdWVyeSB0byBzcWwuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vLi4vcXVlcnkvaW5kZXguanNcIikuZGVmYXVsdH0gcXVlcnkgLSBRdWVyeSBpbnN0YW5jZS5cbiAgICogQHJldHVybnMge3N0cmluZ30gLSBTUUwgc3RyaW5nLlxuICAgKi9cbiAgcXVlcnlUb1NxbChxdWVyeSkgeyByZXR1cm4gbmV3IFF1ZXJ5UGFyc2VyKHtxdWVyeX0pLnRvU3FsKCkgfVxuXG4gIGFzeW5jIHJlZ2lzdGVyVmVyc2lvbigpIHtcbiAgICBpZiAodGhpcy52ZXJzaW9uTWFqb3IgfHwgdGhpcy52ZXJzaW9uTWlub3IpIHtcbiAgICAgIHJldHVyblxuICAgIH1cblxuICAgIGNvbnN0IHZlcnNpb25SZXN1bHQgPSBhd2FpdCB0aGlzLnF1ZXJ5KFwiU0VMRUNUIHNxbGl0ZV92ZXJzaW9uKCkgQVMgdmVyc2lvblwiKVxuXG4gICAgdGhpcy52ZXJzaW9uID0gU3RyaW5nKHZlcnNpb25SZXN1bHRbMF0udmVyc2lvbilcblxuICAgIGNvbnN0IHZlcnNpb25QYXJ0cyA9IHRoaXMudmVyc2lvbi5zcGxpdChcIi5cIilcblxuICAgIHRoaXMudmVyc2lvbk1ham9yID0gTnVtYmVyKHZlcnNpb25QYXJ0c1swXSlcbiAgICB0aGlzLnZlcnNpb25NaW5vciA9IE51bWJlcih2ZXJzaW9uUGFydHNbMV0pXG4gICAgdGhpcy52ZXJzaW9uUGF0Y2ggPSBOdW1iZXIodmVyc2lvblBhcnRzWzJdKVxuICB9XG5cbiAgc2hvdWxkU2V0QXV0b0luY3JlbWVudFdoZW5QcmltYXJ5S2V5KCkgeyByZXR1cm4gZmFsc2UgfVxuICBzdXBwb3J0c0RlZmF1bHRQcmltYXJ5S2V5VVVJRCgpIHsgcmV0dXJuIGZhbHNlIH1cblxuICAvKipcbiAgICogUnVucyBlc2NhcGUuXG4gICAqIEBwYXJhbSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59IHZhbHVlIC0gVmFsdWUgdG8gdXNlLlxuICAgKiBAcmV0dXJucyB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59IC0gVGhlIGVzY2FwZS5cbiAgICovXG4gIGVzY2FwZSh2YWx1ZSkge1xuICAgIHZhbHVlID0gdGhpcy5fY29udmVydFZhbHVlKHZhbHVlKVxuXG4gICAgY29uc3QgdHlwZSA9IHR5cGVvZiB2YWx1ZVxuXG4gICAgaWYgKHR5cGUgIT0gXCJzdHJpbmdcIikgdmFsdWUgPSBgJHt2YWx1ZX1gXG5cbiAgICBjb25zdCByZXN1bHRXaXRoUXVvdGVzID0gZXNjYXBlU3RyaW5nKHZhbHVlLCBudWxsKVxuICAgIGNvbnN0IHJlc3VsdCA9IHJlc3VsdFdpdGhRdW90ZXMuc3Vic3RyaW5nKDEsIHJlc3VsdFdpdGhRdW90ZXMubGVuZ3RoIC0gMSlcblxuICAgIHJldHVybiByZXN1bHRcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHJldHJ5YWJsZSBkYXRhYmFzZSBlcnJvci5cbiAgICogQHBhcmFtIHtFcnJvcn0gZXJyb3IgLSBFcnJvciBpbnN0YW5jZS5cbiAgICogQHJldHVybnMge2ltcG9ydChcIi4uL2Jhc2UuanNcIikuUmV0cnlhYmxlRGF0YWJhc2VFcnJvclJlc3VsdH0gLSBSZXRyeSBpbmZvLlxuICAgKi9cbiAgcmV0cnlhYmxlRGF0YWJhc2VFcnJvcihlcnJvcikge1xuICAgIGNvbnN0IGRhdGFiYXNlTG9ja2VkID0gQm9vbGVhbihlcnJvci5tZXNzYWdlPy5pbmNsdWRlcyhcImRhdGFiYXNlIGlzIGxvY2tlZFwiKSlcbiAgICBjb25zdCBzaG91bGRSZXRyeSA9IChcbiAgICAgIGVycm9yLm1lc3NhZ2U/LnN0YXJ0c1dpdGgoXCJhdHRlbXB0IHRvIHdyaXRlIGEgcmVhZG9ubHkgZGF0YWJhc2VcIikgfHxcbiAgICAgIGRhdGFiYXNlTG9ja2VkXG4gICAgKVxuXG4gICAgcmV0dXJuIHtkZWFkbG9jazogZGF0YWJhc2VMb2NrZWQsIHJldHJ5OiBzaG91bGRSZXRyeSwgcmVjb25uZWN0OiBmYWxzZX1cbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHF1b3RlLlxuICAgKiBAcGFyYW0ge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSB2YWx1ZSAtIFZhbHVlIHRvIHVzZS5cbiAgICogQHJldHVybnMge3N0cmluZyB8IG51bWJlcn0gLSBUaGUgcXVvdGVkIHZhbHVlLlxuICAgKi9cbiAgcXVvdGUodmFsdWUpIHtcbiAgICB2YWx1ZSA9IHRoaXMuX2NvbnZlcnRWYWx1ZSh2YWx1ZSlcblxuICAgIGNvbnN0IHR5cGUgPSB0eXBlb2YgdmFsdWVcblxuICAgIGlmICh0eXBlID09IFwibnVtYmVyXCIpIHJldHVybiAvKiogQHR5cGUge251bWJlcn0gKi8gKHZhbHVlKVxuICAgIGlmICh0eXBlICE9IFwic3RyaW5nXCIpIHZhbHVlID0gU3RyaW5nKHZhbHVlKVxuXG4gICAgcmV0dXJuIGVzY2FwZVN0cmluZyh2YWx1ZSwgbnVsbClcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHVwZGF0ZSBzcWwuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vYmFzZS5qc1wiKS5VcGRhdGVTcWxBcmdzVHlwZX0gYXJncyAtIE9wdGlvbnMgb2JqZWN0LlxuICAgKiBAcmV0dXJucyB7c3RyaW5nfSAtIFNRTCBzdHJpbmcuXG4gICAqL1xuICB1cGRhdGVTcWwoe2NvbmRpdGlvbnMsIGRhdGEsIHRhYmxlTmFtZX0pIHsgcmV0dXJuIG5ldyBVcGRhdGUoe2NvbmRpdGlvbnMsIGRhdGEsIGRyaXZlcjogdGhpcywgdGFibGVOYW1lfSkudG9TcWwoKSB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgdXBzZXJ0IHNxbC5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9iYXNlLmpzXCIpLlVwc2VydFNxbEFyZ3NUeXBlfSBhcmdzIC0gT3B0aW9ucyBvYmplY3QuXG4gICAqIEByZXR1cm5zIHtzdHJpbmd9IC0gU1FMIHN0cmluZy5cbiAgICovXG4gIHVwc2VydFNxbChhcmdzKSB7IHJldHVybiBuZXcgVXBzZXJ0KHsuLi5hcmdzLCBkcml2ZXI6IHRoaXN9KS50b1NxbCgpIH1cblxuICAvKipcbiAgICogUnVucyBzdHJ1Y3R1cmUgc3FsLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxzdHJpbmcgfCBudWxsPn0gLSBSZXNvbHZlcyB3aXRoIFNRTCBzdHJpbmcuXG4gICAqL1xuICBhc3luYyBzdHJ1Y3R1cmVTcWwoKSB7XG4gICAgcmV0dXJuIGF3YWl0IHRoaXMuX2NhY2hlZFNjaGVtYU1ldGFkYXRhKFwic3RydWN0dXJlU3FsXCIsIGFzeW5jICgpID0+IGF3YWl0IG5ldyBTdHJ1Y3R1cmVTcWwoe2RyaXZlcjogdGhpc30pLnRvU3FsKCkpXG4gIH1cblxuICAvKipcbiAgICogU1FMaXRlIGhhcyBubyBuYXRpdmUgYWR2aXNvcnktbG9jayBwcmltaXRpdmUsIHNvIHRoZSBzaGFyZWRcbiAgICogcHJvY2Vzcy1sb2NhbCBwcmUtZmlsdGVyIHRpZXIgaW4gdGhlIGJhc2UgZHJpdmVyIGlzIHRoZSB3aG9sZVxuICAgKiBpbXBsZW1lbnRhdGlvbiBmb3IgdGhlIHdlYi9zcWwuanMgYW5kIEV4cG8gbmF0aXZlIGJ1aWxkcy4gVGhlIE5vZGVcbiAgICogZHJpdmVyIGxheWVycyBpdHMgZmlsZXN5c3RlbSBsb2NrIG9uIHRvcCBhcyB0aGUgZHJpdmVyLW5hdGl2ZSB0aWVyLlxuICAgKiBAcmV0dXJucyB7Ym9vbGVhbn0gLSBBbHdheXMgZmFsc2UgZm9yIHBsYWluIFNRTGl0ZS5cbiAgICovXG4gIHN1cHBvcnRzRHJpdmVyTmF0aXZlQWR2aXNvcnlMb2NrKCkge1xuICAgIHJldHVybiBmYWxzZVxuICB9XG5cbiAgLyoqXG4gICAqIFRoZSBTUUxpdGUgZW11bGF0aW9uIGlzIG5vdCByZS1lbnRyYW50OiBhIHJlLWFjcXVpc2l0aW9uIGJ5IHRoZSBzYW1lXG4gICAqIGRyaXZlciBpbnN0YW5jZSBpcyBjb250ZW50aW9uLCBub3QgYSBncmFudCwgZXhhY3RseSBhcyB0aGUgaW4tcHJvY2Vzc1xuICAgKiBxdWV1ZSBhbHdheXMgYmVoYXZlZC5cbiAgICogQHJldHVybnMge2Jvb2xlYW59IC0gQWx3YXlzIGZhbHNlIGZvciBTUUxpdGUuXG4gICAqL1xuICBzdXBwb3J0c1JlZW50cmFudEFkdmlzb3J5TG9jaygpIHtcbiAgICByZXR1cm4gZmFsc2VcbiAgfVxufVxuIl19