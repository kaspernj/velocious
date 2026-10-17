import Base from "../base.js";
import Options from "./options.js";
export default class VelociousDatabaseDriversSqliteBase extends Base {
    _options: Options | undefined;
    version: string | undefined;
    /**
     * Version major.
     * @type {number | undefined} */
    versionMajor: number | undefined;
    /**
     * Version minor.
     * @type {number | undefined} */
    versionMinor: number | undefined;
    /**
     * Version patch.
     * @type {number | undefined} */
    versionPatch: number | undefined;
    /**
     * Runs alter table sqls.
     * @param {import("../../table-data/index.js").default} tableData - Table data.
     * @returns {Promise<string[]>} - Resolves with SQL statements.
     */
    alterTableSQLs(tableData: import("../../table-data/index.js").default): Promise<string[]>;
    /**
     * Runs create index sqls.
     * @param {import("../base.js").CreateIndexSqlArgs} indexData - Index data.
     * @returns {Promise<string[]>} - Resolves with SQL statements.
     */
    createIndexSQLs(indexData: import("../base.js").CreateIndexSqlArgs): Promise<string[]>;
    /**
     * Runs remove index sqls.
     * @param {import("../base.js").RemoveIndexSqlArgs} indexData - Index data.
     * @returns {Promise<string[]>} - Resolves with SQL statements.
     */
    removeIndexSQLs(indexData: import("../base.js").RemoveIndexSqlArgs): Promise<string[]>;
    /**
     * Runs create table sql.
     * @abstract
     * @param {import("../../table-data/index.js").default} tableData - Table data.
     * @returns {Promise<string[]>} - Resolves with SQL statements.
     */
    createTableSql(tableData: import("../../table-data/index.js").default): Promise<string[]>;
    currentDatabase(): null;
    disableForeignKeys(): Promise<void>;
    enableForeignKeys(): Promise<void>;
    /**
     * Runs drop table sqls.
     * @param {string} tableName - Table name.
     * @param {import("../base.js").DropTableSqlArgsType} [args] - Options object.
     * @returns {Promise<string[]>} - Resolves with SQL statements.
     */
    dropTableSQLs(tableName: string, args?: import("../base.js").DropTableSqlArgsType): Promise<string[]>;
    /**
     * Runs delete sql.
     * @param {import("../base.js").DeleteSqlArgsType} args - Options object.
     * @returns {string} - SQL string.
     */
    deleteSql(args: import("../base.js").DeleteSqlArgsType): string;
    /**
     * Runs get type.
     * @returns {string} - The type.
     */
    getType(): string;
    /**
     * Runs insert sql.
     * @param {import("../base.js").InsertSqlArgsType} args - Options object.
     * @returns {string} - SQL string.
     */
    insertSql(args: import("../base.js").InsertSqlArgsType): string;
    /**
     * Runs get tables.
     * @returns {Promise<Array<import("../base-table.js").default>>} - Resolves with the tables.
     */
    getTables(): Promise<Array<import("../base-table.js").default>>;
    /**
     * Deletes every eligible table through the platform driver's native SQLite
     * script path so the whole cleanup is submitted as one request.
     * @param {Array<import("../base-table.js").default>} tables - Eligible tables.
     * @returns {Promise<void>} - Resolves when the script completes.
     */
    truncateTables(tables: Array<import("../base-table.js").default>): Promise<void>;
    /**
     * Runs insert multiple.
     * @param {string} tableName - Table name.
     * @param {Array<string>} columns - Column names.
     * @param {Array<Array<ReturnType<typeof JSON.parse>>>} rows - Rows to insert.
     * @returns {Promise<void>} - Resolves when complete.
     */
    insertMultiple(tableName: string, columns: Array<string>, rows: Array<Array<ReturnType<typeof JSON.parse>>>): Promise<void>;
    /**
     * Runs supports multiple insert values.
     * @returns {boolean} - Whether supports multiple insert values.
     */
    supportsMultipleInsertValues(): boolean;
    /**
     * Runs supports insert into returning.
     * @returns {boolean} - Whether supports insert into returning.
     */
    supportsInsertIntoReturning(): boolean;
    /**
     * Runs insert multiple with single insert.
     * @param {string} tableName - Table name.
     * @param {Array<string>} columns - Column names.
     * @param {Array<Array<ReturnType<typeof JSON.parse>>>} rows - Rows to insert.
     * @returns {Promise<void>} - Resolves when complete.
     */
    insertMultipleWithSingleInsert(tableName: string, columns: Array<string>, rows: Array<Array<ReturnType<typeof JSON.parse>>>): Promise<void>;
    /**
     * Runs insert multiple with transaction.
     * @param {string} tableName - Table name.
     * @param {Array<string>} columns - Column names.
     * @param {Array<Array<ReturnType<typeof JSON.parse>>>} rows - Rows to insert.
     * @returns {Promise<void>} - Resolves when complete.
     */
    insertMultipleWithTransaction(tableName: string, columns: Array<string>, rows: Array<Array<ReturnType<typeof JSON.parse>>>): Promise<void>;
    lastInsertID(options?: {}): Promise<any>;
    options(): Options;
    /**
     * Runs query to sql.
     * @param {import("../../query/index.js").default} query - Query instance.
     * @returns {string} - SQL string.
     */
    queryToSql(query: import("../../query/index.js").default): string;
    registerVersion(): Promise<void>;
    shouldSetAutoIncrementWhenPrimaryKey(): boolean;
    supportsDefaultPrimaryKeyUUID(): boolean;
    /**
     * Runs escape.
     * @param {ReturnType<typeof JSON.parse>} value - Value to use.
     * @returns {ReturnType<typeof JSON.parse>} - The escape.
     */
    escape(value: ReturnType<typeof JSON.parse>): ReturnType<typeof JSON.parse>;
    /**
     * Runs retryable database error.
     * @param {Error} error - Error instance.
     * @returns {import("../base.js").RetryableDatabaseErrorResult} - Retry info.
     */
    retryableDatabaseError(error: Error): import("../base.js").RetryableDatabaseErrorResult;
    /**
     * Runs quote.
     * @param {ReturnType<typeof JSON.parse>} value - Value to use.
     * @returns {string | number} - The quoted value.
     */
    quote(value: ReturnType<typeof JSON.parse>): string | number;
    /**
     * Runs update sql.
     * @param {import("../base.js").UpdateSqlArgsType} args - Options object.
     * @returns {string} - SQL string.
     */
    updateSql({ conditions, data, tableName }: import("../base.js").UpdateSqlArgsType): string;
    /**
     * Runs upsert sql.
     * @param {import("../base.js").UpsertSqlArgsType} args - Options object.
     * @returns {string} - SQL string.
     */
    upsertSql(args: import("../base.js").UpsertSqlArgsType): string;
    /**
     * Runs structure sql.
     * @returns {Promise<string | null>} - Resolves with SQL string.
     */
    structureSql(): Promise<string | null>;
    /**
     * SQLite has no native advisory-lock primitive, so the shared
     * process-local pre-filter tier in the base driver is the whole
     * implementation for the web/sql.js and Expo native builds. The Node
     * driver layers its filesystem lock on top as the driver-native tier.
     * @returns {boolean} - Always false for plain SQLite.
     */
    supportsDriverNativeAdvisoryLock(): boolean;
    /**
     * The SQLite emulation is not re-entrant: a re-acquisition by the same
     * driver instance is contention, not a grant, exactly as the in-process
     * queue always behaved.
     * @returns {boolean} - Always false for SQLite.
     */
    supportsReentrantAdvisoryLock(): boolean;
    /**
     * The SQLite emulation is the process-local tier of the STC-210 chain.
     * @returns {string} - Tier name reported on telemetry payloads.
     */
    advisoryLockBackendTier(): string;
    /**
     * Attribute the named lock to the driver instance that owns it in the
     * shared in-process registry (best-effort; the caller guards failures).
     * @param {string} name - Lock name.
     * @returns {Promise<string | null>} - Owning driver's holder id, or null when no instance holds the lock.
     */
    advisoryLockHolderConnectionId(name: string): Promise<string | null>;
}
//# sourceMappingURL=base.d.ts.map