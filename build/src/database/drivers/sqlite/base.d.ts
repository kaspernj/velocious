import Base from "../base.js";
import Options from "./options.js";
export default class VelociousDatabaseDriversSqliteBase extends Base {
    _options: Options | undefined;
    version: string | undefined;
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
    static _advisoryLockState: {
        ownersByName: Map<string, VelociousDatabaseDriversSqliteBase>;
        waitersByName: Map<string, Array<() => void>>;
    };
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
    _acquireAdvisoryLock(name: string, { timeoutMs }?: {
        timeoutMs?: number | null;
    }): Promise<boolean>;
    /**
     * Runs try acquire advisory lock.
     * @param {string} name - Lock name.
     * @returns {Promise<boolean>} - True if the lock was acquired, false if it was already held.
     */
    _tryAcquireAdvisoryLock(name: string): Promise<boolean>;
    /**
     * Releases the lock only if **this** driver instance owns it. Calling
     * release for a lock owned by another driver instance is a no-op that
     * returns `false`, matching the "you can only release locks you own"
     * contract of MySQL's `RELEASE_LOCK` and PostgreSQL's
     * `pg_advisory_unlock`.
     * @param {string} name - Lock name.
     * @returns {Promise<boolean>} - True if the lock was held by this driver and has now been released.
     */
    _releaseAdvisoryLock(name: string): Promise<boolean>;
    /**
     * Runs is advisory lock held.
     * @param {string} name - Lock name.
     * @returns {Promise<boolean>} - True if any driver instance currently holds the lock.
     */
    isAdvisoryLockHeld(name: string): Promise<boolean>;
}
//# sourceMappingURL=base.d.ts.map