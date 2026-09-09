import Base from "../base.js";
import Options from "./options.js";
export default class VelociousDatabaseDriversMysql extends Base {
    _options: Options | undefined;
    /** @type {import("mysql").Pool | undefined} */
    pool: import("mysql").Pool | undefined;
    /** @type {string | null} */
    _desiredSessionTimeZone: string | null;
    /** @type {string | null} */
    _currentSessionTimeZone: string | null;
    /**
     * Runs connect.
     * @returns {Promise<void>} - Resolves when complete.
     */
    connect(): Promise<void>;
    /**
     * On pool error.
     * @param {Error} error - Error from the connection attempt.
     */
    onPoolError: (error: Error) => void;
    /**
     * Runs close.
     * @returns {Promise<void>} - Resolves when complete.
     */
    _close(): Promise<void>;
    /**
     * Disposes the physical MySQL session after each logical pool checkout.
     * MySQL exposes open-ended session state, so reconnecting is safer than trying
     * to enumerate and reset variables, temporary tables, prepared statements,
     * SQL modes, and other caller-controlled state.
     * @returns {Promise<void>} - Resolves after the physical session is closed.
     */
    cleanupSessionStateAfterCheckout(): Promise<void>;
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
     * Hook before every query.
     * @param {string} _sql - SQL string.
     * @param {import("../base.js").QueryOptions} options - Query options.
     * @returns {Promise<void>} - Resolves when complete.
     */
    beforeQuery(_sql: string, options: import("../base.js").QueryOptions): Promise<void>;
    /**
     * Gets the desired database session time zone for this connection context.
     * @returns {string | null} - Desired session time zone.
     */
    getDesiredSessionTimeZone(): string | null;
    /**
     * Sets the desired database session time zone without querying MySQL immediately.
     * @param {string | null} timeZone - Desired session time zone.
     */
    setDesiredSessionTimeZone(timeZone: string | null): void;
    /**
     * Gets the database session time zone last confirmed through SET time_zone.
     * @returns {string | null} - Current known session time zone.
     */
    getCurrentSessionTimeZone(): string | null;
    /**
     * Clears the current known database session time zone when the physical connection changes.
     */
    resetCurrentSessionTimeZone(): void;
    /**
     * Ensures MySQL has the desired session time zone before user SQL runs.
     * @returns {Promise<boolean>} - True when SET time_zone was executed.
     */
    ensureSessionTimeZone(): Promise<boolean>;
    /**
     * Sets the database session time zone if it changed from the last confirmed value.
     * @param {string} timeZone - Session time zone value accepted by MySQL.
     * @returns {Promise<boolean>} - True when SET time_zone was executed.
     */
    setSessionTimeZone(timeZone: string): Promise<boolean>;
    /**
     * Runs connect args.
     * @returns {Record<string, ReturnType<typeof JSON.parse>>} - The connect args.
     */
    connectArgs(): Record<string, ReturnType<typeof JSON.parse>>;
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
    /**
     * Runs current database.
     * @returns {Promise<string>} - Resolves with the current database.
     */
    currentDatabase(): Promise<string>;
    /**
     * Runs disable foreign keys.
     * @returns {Promise<void>} - Resolves when complete.
     */
    disableForeignKeys(): Promise<void>;
    /**
     * Runs enable foreign keys.
     * @returns {Promise<void>} - Resolves when complete.
     */
    enableForeignKeys(): Promise<void>;
    /**
     * Runs drop table sqls.
     * @param {string} tableName - Table name.
     * @param {import("../base.js").DropTableSqlArgsType} [args] - Options object.
     * @returns {Promise<string[]>} - Resolves with SQL statements.
     */
    dropTableSQLs(tableName: string, args?: import("../base.js").DropTableSqlArgsType): Promise<string[]>;
    /**
     * Runs get type.
     * @returns {string} - The type.
     */
    getType(): string;
    /**
     * Whether this driver supports combining operations into one bulk `ALTER`.
     * @returns {boolean} - Whether bulk alter is supported.
     */
    supportsBulkAlter(): boolean;
    /**
     * Whether the bulk `ALTER` can also carry `ADD INDEX` clauses.
     * @returns {boolean} - Whether indexes can be added inside a bulk alter.
     */
    supportsBulkAlterIndexes(): boolean;
    /**
     * Runs retryable database error.
     * @param {Error} error - Error instance.
     * @returns {import("../base.js").RetryableDatabaseErrorResult} - Retry info.
     */
    retryableDatabaseError(error: Error): import("../base.js").RetryableDatabaseErrorResult;
    /**
     * Adds a redacted, bounded excerpt from MySQL's latest InnoDB deadlock report. Capture uses a
     * separate short-lived connection so it cannot queue ahead of rollback or the next retry on this
     * driver's single-connection pool.
     * @param {import("../base.js").DeadlockRetryDiagnosticSnapshot} snapshot - Immutable retry snapshot.
     * @returns {Promise<Record<string, ReturnType<typeof JSON.parse>>>} - Safe diagnostic context.
     */
    _deadlockDiagnosticContext(snapshot: import("../base.js").DeadlockRetryDiagnosticSnapshot): Promise<Record<string, ReturnType<typeof JSON.parse>>>;
    /**
     * Captures SHOW ENGINE INNODB STATUS on a bounded throwaway connection.
     * @returns {Promise<string>} - Raw server status, retained only inside the redaction path.
     */
    _captureInnodbDeadlockStatus(): Promise<string>;
    /**
     * Extracts only fixed-format deadlock counters. The server report contains raw SQL, identifiers,
     * and physical record data, so no source text is ever included in an application diagnostic.
     * @param {string} status - SHOW ENGINE INNODB STATUS text.
     * @returns {{lockRecordsTruncated: boolean, sectionTruncated: boolean, transactionNodes: Array<{conflictingLocks: Array<{indexFingerprint: string, lockMode: string, state: string, tableFingerprint: string}>, locks: Array<{indexFingerprint: string, lockMode: string, state: string, tableFingerprint: string}>, ordinal: number}>, transactionNodesTruncated: boolean, transactions: number, victimTransaction: number | null}} - Structural deadlock summary.
     */
    _innodbDeadlockSummary(status: string): {
        lockRecordsTruncated: boolean;
        sectionTruncated: boolean;
        transactionNodes: Array<{
            conflictingLocks: Array<{
                indexFingerprint: string;
                lockMode: string;
                state: string;
                tableFingerprint: string;
            }>;
            locks: Array<{
                indexFingerprint: string;
                lockMode: string;
                state: string;
                tableFingerprint: string;
            }>;
            ordinal: number;
        }>;
        transactionNodesTruncated: boolean;
        transactions: number;
        victimTransaction: number | null;
    };
    /**
     * Runs query actual.
     * @param {string} sql - SQL string.
     * @param {import("../base.js").QueryOptions} [options] - Query options (carries the optional abort signal).
     * @returns {Promise<import("../base.js").QueryResultType>} - Resolves with the query actual.
     */
    _queryActual(sql: string, options?: import("../base.js").QueryOptions): Promise<import("../base.js").QueryResultType>;
    /**
     * Streams the rows of `sql` from a dedicated pooled connection using the MySQL cursor, so a
     * large result set is read incrementally instead of being buffered. Overrides the base
     * buffered fallback with true server-side streaming.
     * @param {string} sql - SQL string to stream.
     * @param {import("../base.js").QueryOptions} [options] - Query ownership options.
     * @yields {Record<string, unknown>} - The result rows, one at a time.
     */
    queryStream(sql: string, options?: import("../base.js").QueryOptions): AsyncGenerator<any, void, unknown>;
    /**
     * Executes a mutation with affected-row metadata.
     * @param {string} sql - Mutation SQL.
     * @returns {Promise<number>} - Affected row count.
     */
    _affectedRowsActual(sql: string): Promise<number>;
    /**
     * Executes a full multi-statement structure SQL script in one round-trip when the
     * connection was configured with `multipleStatements: true`. Runs on the pooled
     * connection so the caller's `SET FOREIGN_KEY_CHECKS = 0` applies. Returns false so
     * the caller runs statements individually when multi-statement queries are off.
     * @param {string} structureSql - Full multi-statement structure SQL.
     * @returns {Promise<boolean>} - Whether the script was executed as one batch.
     */
    execStructureScript(structureSql: string): Promise<boolean>;
    /**
     * Uses one multi-statement request only when the existing connection option
     * explicitly allows it; otherwise retains the base sequential behavior.
     * @param {Array<import("../base-table.js").default>} tables - Eligible tables.
     * @returns {Promise<void>} - Resolves when every table has been truncated.
     */
    truncateTables(tables: Array<import("../base-table.js").default>): Promise<void>;
    /**
     * Runs query to sql.
     * @param {import("../../query/index.js").default} query - Query instance.
     * @returns {string} - SQL string.
     */
    queryToSql(query: import("../../query/index.js").default): string;
    /**
     * Runs should set auto increment when primary key.
     * @returns {boolean} - Whether set auto increment when primary key.
     */
    shouldSetAutoIncrementWhenPrimaryKey(): boolean;
    supportsDefaultPrimaryKeyUUID(): boolean;
    supportsCrossDatabaseReferences(): boolean;
    /**
     * Runs escape.
     * @param {ReturnType<typeof JSON.parse>} value - Value to use.
     * @returns {ReturnType<typeof JSON.parse>} - The escape.
     */
    escape(value: ReturnType<typeof JSON.parse>): ReturnType<typeof JSON.parse>;
    /**
     * Runs quote.
     * @param {string} value - Value to use.
     * @returns {string} - The quote.
     */
    quote(value: string): string;
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
    /**
     * Runs get tables.
     * @returns {Promise<Array<import("../base-table.js").default>>} - Resolves with the tables.
     */
    getTables(): Promise<Array<import("../base-table.js").default>>;
    /**
     * Runs structure sql.
     * @returns {Promise<string | null>} - Resolves with SQL string.
     */
    structureSql(): Promise<string | null>;
    /**
     * Runs last insert id.
     * @param {import("../base.js").QueryOptions} [options] - Query ownership options.
     * @returns {Promise<number>} - Resolves with the last insert id.
     */
    lastInsertID(options?: import("../base.js").QueryOptions): Promise<number>;
    /**
     * Runs options.
     * @returns {Options} - The options options.
     */
    options(): Options;
    /**
     * Runs start transaction action.
     * @param {Pick<import("../base.js").QueryOptions, "operationOwner">} [options] - Transaction ownership.
     * @returns {Promise<void>} - Resolves when complete.
     */
    _startTransactionAction(options?: Pick<import("../base.js").QueryOptions, "operationOwner">): Promise<void>;
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
     * Blocks until a MySQL/MariaDB user-level lock is acquired on this
     * connection. Implemented via `GET_LOCK(name, timeout)`, where the
     * timeout is in seconds.
     *
     * MySQL historically documented a negative timeout as "infinite",
     * but MariaDB 10+ silently rejects negative timeouts and returns
     * `NULL` from `GET_LOCK`. To make the helper portable across MySQL
     * and MariaDB the "indefinite" case is encoded as a large positive
     * timeout (one year), which is comfortably longer than any
     * realistic critical section and works on every supported version.
     * @param {string} name - Lock name.
     * @param {{timeoutMs?: number | null}} [args] - Optional timeout in milliseconds; `null`, `undefined`, or negative blocks for `MYSQL_INDEFINITE_LOCK_TIMEOUT_SECONDS`.
     * @returns {Promise<boolean>} - True if acquired, false if the timeout elapsed.
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