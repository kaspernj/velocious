import Base from "../base.js";
import { Client } from "pg";
import Options from "./options.js";
import Table from "./table.js";
export default class VelociousDatabaseDriversPgsql extends Base {
    connection: Client | undefined;
    _options: Options | undefined;
    connect(): Promise<void>;
    connectArgs(): Record<string, any>;
    _close(): Promise<void>;
    /**
     * Runs set connection checkout name.
     * @param {string | undefined} name - Human-readable name for this active checkout.
     * @returns {Promise<void>} - Resolves when complete.
     */
    setConnectionCheckoutName(name: string | undefined): Promise<void>;
    /**
     * Runs clear connection checkout name.
     * @returns {Promise<void>} - Resolves when complete.
     */
    clearConnectionCheckoutName(): Promise<void>;
    /**
     * Sets the database session timezone to UTC so bare timestamp literals store UTC instants.
     * @returns {Promise<void>} - Resolves when complete.
     */
    setSessionTimezoneToUtc(): Promise<void>;
    /**
     * Runs alter table sqls.
     * @param {import("../../table-data/index.js").default} tableData - Table data.
     * @returns {Promise<string[]>} - Resolves with SQL statements.
     */
    alterTableSQLs(tableData: import("../../table-data/index.js").default): Promise<string[]>;
    /**
     * Runs create database sql.
     * @param {string} databaseName - Database name.
     * @param {object} [args] - Options object.
     * @param {boolean} [args.ifNotExists] - Whether if not exists.
     * @returns {string[]} - SQL statements.
     */
    createDatabaseSql(databaseName: string, args?: {
        ifNotExists?: boolean;
    }): string[];
    /**
     * Runs drop database sql.
     * @param {string} databaseName - Database name.
     * @param {object} [args] - Options object.
     * @param {boolean} [args.ifExists] - Whether if exists.
     * @returns {string[]} - SQL statements.
     */
    dropDatabaseSql(databaseName: string, args?: {
        ifExists?: boolean;
    }): string[];
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
     * @param {import("../../table-data/index.js").default} tableData - Table data.
     * @returns {Promise<string[]>} - Resolves with SQL statements.
     */
    createTableSql(tableData: import("../../table-data/index.js").default): Promise<string[]>;
    currentDatabase(): Promise<any>;
    disableForeignKeys(): Promise<void>;
    enableForeignKeys(): Promise<void>;
    /**
     * Runs drop table sqls.
     * @param {string} tableName - Table name.
     * @param {import("../base.js").DropTableSqlArgsType} [args] - Options object.
     * @returns {Promise<string[]>} - Resolves with SQL statements.
     */
    dropTableSQLs(tableName: string, args?: import("../base.js").DropTableSqlArgsType): Promise<string[]>;
    getType(): string;
    /**
     * Whether this driver supports combining operations into one bulk `ALTER`.
     * @returns {boolean} - Whether bulk alter is supported.
     */
    supportsBulkAlter(): boolean;
    /**
     * Whether the bulk `ALTER` can also carry `ADD INDEX` clauses. PostgreSQL's
     * `ALTER TABLE` cannot express index creation, so indexes stay standalone.
     * @returns {boolean} - Whether indexes can be added inside a bulk alter.
     */
    supportsBulkAlterIndexes(): boolean;
    /**
     * Runs query actual.
     * @param {string} sql - SQL string.
     * @returns {Promise<import("../base.js").QueryResultType>} - Resolves with the query actual.
     */
    _queryActual(sql: string): Promise<import("../base.js").QueryResultType>;
    /**
     * Executes a mutation with affected-row metadata.
     * @param {string} sql - Mutation SQL.
     * @returns {Promise<number>} - Affected row count.
     */
    _affectedRowsActual(sql: string): Promise<number>;
    /**
     * Runs query to sql.
     * @param {import("../../query/index.js").default} query - Query instance.
     * @returns {string} - SQL string.
     */
    queryToSql(query: import("../../query/index.js").default): string;
    shouldSetAutoIncrementWhenPrimaryKey(): boolean;
    supportsDefaultPrimaryKeyUUID(): boolean;
    /**
     * Runs convert value.
     * @param {ReturnType<typeof JSON.parse>} value - Value to use.
     * @returns {ReturnType<typeof JSON.parse>} - The converted value.
     */
    _convertValue(value: ReturnType<typeof JSON.parse>): ReturnType<typeof JSON.parse>;
    /**
     * Runs escape.
     * @param {ReturnType<typeof JSON.parse>} value - Value to use.
     * @returns {ReturnType<typeof JSON.parse>} - The escape.
     */
    escape(value: ReturnType<typeof JSON.parse>): ReturnType<typeof JSON.parse>;
    /**
     * Runs quote.
     * @param {ReturnType<typeof JSON.parse>} value - Value to use.
     * @returns {string | number} - The quoted value.
     */
    quote(value: ReturnType<typeof JSON.parse>): string | number;
    /**
     * Runs delete sql.
     * @param {import("../base.js").DeleteSqlArgsType} args - Options object.
     * @returns {string} - SQL string.
     */
    deleteSql({ tableName, conditions }: import("../base.js").DeleteSqlArgsType): string;
    /**
     * Runs insert sql.
     * @abstract
     * @param {import("../base.js").InsertSqlArgsType} args - Options object.
     * @returns {string} - SQL string.
     */
    insertSql(args: import("../base.js").InsertSqlArgsType): string;
    getTables(): Promise<Table[]>;
    /**
     * Truncates all eligible tables in one PostgreSQL request.
     * @param {Array<import("../base-table.js").default>} tables - Eligible tables.
     * @returns {Promise<void>} - Resolves when the batch completes.
     */
    truncateTables(tables: Array<import("../base-table.js").default>): Promise<void>;
    lastInsertID(options?: {}): Promise<any>;
    options(): Options;
    _startTransactionAction(options?: {}): Promise<void>;
    /**
     * Runs update sql.
     * @abstract
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
    advisoryLockKey(name: string): string;
    /**
     * Blocks until a PostgreSQL session-level advisory lock is acquired on
     * this connection. Implemented via `pg_advisory_lock(bigint)`, which has
     * no native timeout — the `timeoutMs` argument is emulated by racing a
     * `pg_try_advisory_lock` poll loop so callers on MySQL and Postgres see
     * the same contract.
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
     * Runs release advisory lock.
     * @param {string} name - Lock name.
     * @returns {Promise<boolean>} - True if the lock was held by this session and has now been released.
     */
    _releaseAdvisoryLock(name: string): Promise<boolean>;
    /**
     * Runs is advisory lock held.
     * @param {string} name - Lock name.
     * @returns {Promise<boolean>} - True if any session currently holds the lock.
     */
    isAdvisoryLockHeld(name: string): Promise<boolean>;
}
//# sourceMappingURL=index.d.ts.map