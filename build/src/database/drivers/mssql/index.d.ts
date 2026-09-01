import Base from "../base.js";
import Options from "./options.js";
import mssql from "mssql";
export default class VelociousDatabaseDriversMssql extends Base {
    connection: mssql.ConnectionPool | undefined;
    _currentTransaction: mssql.Transaction | null | undefined;
    _options: Options | undefined;
    /** @type {import("mssql").Transaction | null} */
    _advisoryLockTransaction: import("mssql").Transaction | null;
    connect(): Promise<void>;
    _close(): Promise<void>;
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
     * Disables every foreign key constraint (bulk `NOCHECK`).
     * @returns {Promise<void>} - Resolves when foreign keys are disabled.
     */
    disableForeignKeys(): Promise<void>;
    /**
     * Re-enables and re-validates every foreign key constraint (`WITH CHECK`).
     * @returns {Promise<void>} - Resolves when foreign keys are enabled.
     */
    enableForeignKeys(): Promise<void>;
    /**
     * Runs a bulk constraint-toggle statement. `ALTER TABLE ... NOCHECK/CHECK
     * CONSTRAINT` needs a schema-modification lock on every table, so if the
     * request times out it is almost always blocked by another session that is
     * still holding a lock (a leaked/uncommitted connection). On a timeout,
     * capture which sessions were blocking so the real culprit is named instead
     * of leaving a bare "Request failed to complete in 15000ms".
     * @param {string} sql - Constraint-toggle SQL.
     * @param {string} label - Operation label for the error.
     * @returns {Promise<void>} - Resolves when the toggle completes.
     */
    _execConstraintToggle(sql: string, label: string): Promise<void>;
    /**
     * Snapshots the sessions that could be blocking a constraint toggle in THIS
     * database — every session other than this one that holds a lock in `DB_ID()`
     * or is running a request against it — with its last statement, wait state,
     * and blocking session, enough to identify a connection that leaked a lock.
     * Scoped to the current database so a multi-database server does not leak
     * unrelated sessions' SQL into the error and bury the real blocker.
     * @returns {Promise<string>} - JSON snapshot, or a "(none)" marker.
     */
    _captureBlockingSessionsForDebug(): Promise<string>;
    /**
     * Runs drop table sqls.
     * @param {string} tableName - Table name.
     * @param {import("../base.js").DropTableSqlArgsType} [args] - Options object.
     * @returns {Promise<string[]>} - Resolves with SQL statements.
     */
    dropTableSQLs(tableName: string, args?: import("../base.js").DropTableSqlArgsType): Promise<string[]>;
    /**
     * Drops the foreign key constraints that reference the given table. MSSQL
     * refuses to drop a table that is still referenced by a FOREIGN KEY
     * constraint even when constraints are disabled via NOCHECK, so the
     * referencing constraints must be removed before the table can be dropped.
     * This lets callers drop tables in any order (e.g. wiping a whole schema)
     * without first dropping every dependent table.
     * @param {string} tableName - Table name.
     * @returns {Promise<void>} - Resolves when complete.
     */
    _dropReferencingForeignKeys(tableName: string): Promise<void>;
    /**
     * Runs drop table.
     * @param {string} tableName - Table name.
     * @param {import("../base.js").DropTableSqlArgsType} [args] - Options object.
     * @returns {Promise<void>} - Resolves when complete.
     */
    dropTable(tableName: string, args?: import("../base.js").DropTableSqlArgsType): Promise<void>;
    /**
     * Runs get type.
     * @returns {string} - The type.
     */
    getType(): string;
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
     * Runs an explicit primary-key insert as one batch request: SQL Server scopes
     * IDENTITY_INSERT to the session, and node-mssql pool-backed requests may use
     * a different physical session per query, so enabling it in a separate query
     * can leave the actual INSERT on another session. A single batch keeps the
     * whole sequence on one session by construction: enable, insert, disable on
     * success, and a CATCH that disables and rethrows the original error.
     * @param {object} args - Options object.
     * @param {import("../base.js").QueryOptions} args.options - Query options for the standard query path.
     * @param {string} args.sql - Generated insert SQL.
     * @param {string} args.tableName - Table being inserted into.
     * @returns {Promise<import("../base.js").QueryResultType>} - Insert result.
     */
    insertWithExplicitPrimaryKey({ options, sql, tableName }: {
        options: import("../base.js").QueryOptions;
        sql: string;
        tableName: string;
    }): Promise<import("../base.js").QueryResultType>;
    /**
     * Runs escape.
     * @param {ReturnType<typeof JSON.parse>} value - Value to use.
     * @returns {string} - The escape.
     */
    escape(value: ReturnType<typeof JSON.parse>): string;
    /**
     * Runs quote.
     * @param {ReturnType<typeof JSON.parse>} value - Value to use.
     * @returns {string | number} - The quoted value.
     */
    quote(value: ReturnType<typeof JSON.parse>): string | number;
    /**
     * Runs quote column.
     * @param {string} columnName - Column name.
     * @returns {string} - The quote column.
     */
    quoteColumn(columnName: string): string;
    /**
     * Runs quote table.
     * @param {string} string - String.
     * @returns {string} - The quote table.
     */
    quoteTable(string: string): string;
    /**
     * Runs rename column.
     * @param {string} tableName - Table name.
     * @param {string} oldColumnName - Previous column name.
     * @param {string} newColumnName - New column name.
     * @returns {Promise<void>} - Resolves when complete.
     */
    renameColumn(tableName: string, oldColumnName: string, newColumnName: string): Promise<void>;
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
     * Truncates all eligible tables in one SQL Server request, retaining the
     * recognized foreign-key fallback used by the per-table implementation.
     * @param {Array<import("../base-table.js").default>} tables - Eligible tables.
     * @returns {Promise<void>} - Resolves when the batch completes.
     */
    truncateTables(tables: Array<import("../base-table.js").default>): Promise<void>;
    lastInsertID(options?: {}): Promise<any>;
    /**
     * Runs options.
     * @returns {Options} - The options options.
     */
    options(): Options;
    _startTransactionAction(): Promise<void>;
    _commitTransactionAction(): Promise<void>;
    _rollbackTransactionAction(): Promise<void>;
    /**
     * Runs start save point action.
     * @param {string} savePointName - Save point name.
     * @param {Pick<import("../base.js").QueryOptions, "operationOwner">} [options] - Transaction ownership.
     * @returns {Promise<void>} - Resolves when complete.
     */
    _startSavePointAction(savePointName: string, options?: Pick<import("../base.js").QueryOptions, "operationOwner">): Promise<void>;
    /**
     * Runs release save point action.
     * @param {string} savePointName - Save point name.
     * @param {Pick<import("../base.js").QueryOptions, "operationOwner">} [_options] - Transaction ownership.
     * @returns {Promise<void>} - Resolves when complete.
     */
    _releaseSavePointAction(savePointName: string, _options?: Pick<import("../base.js").QueryOptions, "operationOwner">): Promise<void>;
    /**
     * Runs rollback save point action.
     * @param {string} savePointName - Save point name.
     * @param {Pick<import("../base.js").QueryOptions, "operationOwner">} [options] - Transaction ownership.
     * @returns {Promise<void>} - Resolves when complete.
     */
    _rollbackSavePointAction(savePointName: string, options?: Pick<import("../base.js").QueryOptions, "operationOwner">): Promise<void>;
    generateSavePointName(): string;
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
     * Blocks until a SQL Server application lock is acquired on this
     * connection via `sp_getapplock`. The Session lock owner scopes the lock
     * to the current session, matching the connection-scoped semantics on
     * MySQL and PostgreSQL.
     *
     * `sp_getapplock` returns 0 on immediate grant, 1 after waiting, and
     * negative values on failure (timeout, deadlock, canceled, parameter
     * error). We treat 0/1 as success and -1 (timeout) as a clean `false`;
     * anything else throws.
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
     *
     * `sp_releaseapplock` returns 0 when the lock was released, but SQL Server
     * raises error {@link APPLOCK_NOT_HELD_ERROR_NUMBER} instead of returning a
     * failure code when the session does not currently hold the lock. That
     * error aborts the batch before the trailing `SELECT` can run, so we catch
     * it and resolve to `false` to honor the cross-driver contract for an
     * already-unheld lock.
     * @param {string} name - Lock name.
     * @returns {Promise<boolean>} - True if the lock was held by this session and has now been released.
     */
    _releaseAdvisoryLock(name: string): Promise<boolean>;
    /**
     * Runs an advisory-lock statement through one transaction request parent.
     * node-mssql reserves one physical session for a Transaction, whereas
     * separate ConnectionPool requests may check out different sessions. The
     * transaction contains only application-lock statements; caller/model work
     * continues through its original connection.
     * @param {string} sql - Advisory-lock SQL.
     * @returns {Promise<import("../base.js").QueryResultType>} - Result rows.
     */
    _advisoryLockQuery(sql: string): Promise<import("../base.js").QueryResultType>;
    /**
     * Starts the transaction request parent that reserves the advisory-lock
     * session until the final release or driver close.
     * @returns {Promise<import("mssql").Transaction>} - Session-affine parent.
     */
    _ensureAdvisoryLockTransaction(): Promise<import("mssql").Transaction>;
    /**
     * Releases the reserved session after the last tracked lock release.
     * Base untracks the current release after the driver hook returns, so a
     * current total of one means this is the final release.
     * @returns {Promise<void>} - Resolves after cleanup when this is final.
     */
    _closeAdvisoryLockTransactionIfFinalRelease(): Promise<void>;
    /**
     * Rolls back the otherwise-empty transaction and returns its physical
     * session to node-mssql. Rollback is cleanup only; advisory locks are
     * explicitly released first whenever their release statement succeeds.
     * @returns {Promise<void>} - Resolves after session cleanup.
     */
    _closeAdvisoryLockTransaction(): Promise<void>;
    /**
     * Detects the SQL Server "application lock is not currently held" error
     * raised by `sp_releaseapplock`. It walks the wrapped-error cause chain
     * because `query` re-wraps the driver's `RequestError` in a plain `Error`,
     * and matches on the stable numeric error number rather than the message.
     * @param {unknown} error - Error thrown while releasing the lock.
     * @returns {boolean} - True if the error means the lock was not held by this session.
     */
    _isApplockNotHeldError(error: unknown): boolean;
    /**
     * Returns true if any session currently holds the application lock.
     *
     * This combines two probes because neither is sufficient on its own:
     *   - `APPLOCK_MODE(..., 'Session')` only reports locks held by the
     *     **current** session, so it misses locks held by any other
     *     session and would return `NoLock` even under cross-session
     *     contention.
     *   - `APPLOCK_TEST(..., 'Exclusive', 'Session')` returns whether an
     *     Exclusive lock could be granted to *this* session right now. A
     *     return value of 0 means somebody else holds an incompatible
     *     lock; a value of 1 means it is either free **or** already held
     *     by us re-entrantly (which the `APPLOCK_MODE` check catches).
     *
     * The combined result is "held" iff we hold it ourselves or
     * `APPLOCK_TEST` reports we cannot acquire it without waiting.
     * @param {string} name - Lock name.
     * @returns {Promise<boolean>} - True if any session currently holds the lock.
     */
    isAdvisoryLockHeld(name: string): Promise<boolean>;
}
//# sourceMappingURL=index.d.ts.map