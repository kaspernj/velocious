// @ts-check
import AlterTable from "./sql/alter-table.js";
import Base from "../base.js";
import CreateDatabase from "./sql/create-database.js";
import CreateIndex from "./sql/create-index.js";
import CreateTable from "./sql/create-table.js";
import Delete from "./sql/delete.js";
import DropDatabase from "./sql/drop-database.js";
import DropTable from "./sql/drop-table.js";
import { digg } from "diggerize";
import escapeString from "sql-escape-string";
import Insert from "./sql/insert.js";
import Options from "./options.js";
import mssql from "mssql";
import net from "node:net";
import QueryParser from "./query-parser.js";
import RemoveIndex from "./sql/remove-index.js";
import Table from "./table.js";
import StructureSql from "./structure-sql.js";
import timeout from "awaitery/build/timeout.js";
import Upsert from "./sql/upsert.js";
import Update from "./sql/update.js";
import UUID from "pure-uuid";
/**
 * SQL Server error number raised by `sp_releaseapplock` when the current
 * session does not hold the requested application lock. Releasing a lock the
 * session no longer holds is a normal race (a shared connection's final
 * check-in may already have auto-released it), which the cross-driver
 * `releaseAdvisoryLock` contract models by resolving to `false`. We translate
 * this specific error into that result rather than letting it escape.
 * @type {number}
 */
const APPLOCK_NOT_HELD_ERROR_NUMBER = 1223;
export default class VelociousDatabaseDriversMssql extends Base {
    /** @type {import("mssql").Transaction | null} */
    _advisoryLockTransaction = null;
    async connect() {
        const args = this.getArgs();
        const sqlConfig = digg(args, "sqlConfig");
        try {
            if (this.connection)
                await this.close();
            if (sqlConfig) {
                sqlConfig.options = Object.assign({}, sqlConfig.options, { useUTC: true });
            }
            if (sqlConfig?.server && !sqlConfig.options?.serverName && net.isIP(sqlConfig.server)) {
                sqlConfig.options = Object.assign({}, sqlConfig.options, { serverName: "" });
            }
            this.connection = new mssql.ConnectionPool(sqlConfig);
            await this.connection.connect();
        }
        catch (error) {
            // Re-throw to fix unuseable stack trace.
            throw new Error(`Couldn't connect to database: ${error instanceof Error ? error.message : error}`, { cause: error });
        }
    }
    async _close() {
        if (!this.connection)
            return;
        const connection = this.connection;
        this.connection = undefined;
        this._currentTransaction = null;
        this._transactionsCount = 0;
        /** @type {Error | undefined} */
        let sessionError;
        try {
            await this._closeAdvisoryLockTransaction();
        }
        catch (error) {
            sessionError = error instanceof Error ? error : new Error("Failed to close MSSQL advisory-lock session", { cause: error });
        }
        try {
            await timeout({ timeout: 2000 }, () => connection.close());
        }
        catch (error) {
            this.logger.warn("Failed to close MSSQL connection cleanly", { error });
        }
        if (sessionError)
            throw sessionError;
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
    /**
     * Runs current database.
     * @returns {Promise<string>} - Resolves with the current database.
     */
    async currentDatabase() {
        const rows = await this.query("SELECT DB_NAME() AS db_name");
        return digg(rows, 0, "db_name");
    }
    /**
     * Disables every foreign key constraint (bulk `NOCHECK`).
     * @returns {Promise<void>} - Resolves when foreign keys are disabled.
     */
    async disableForeignKeys() {
        await this._execConstraintToggle("EXEC sp_MSforeachtable \"ALTER TABLE ? NOCHECK CONSTRAINT all\"", "disableForeignKeys");
    }
    /**
     * Re-enables and re-validates every foreign key constraint (`WITH CHECK`).
     * @returns {Promise<void>} - Resolves when foreign keys are enabled.
     */
    async enableForeignKeys() {
        await this._execConstraintToggle("EXEC sp_MSforeachtable @command1=\"print '?'\", @command2=\"ALTER TABLE ? WITH CHECK CHECK CONSTRAINT all\"", "enableForeignKeys");
    }
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
    async _execConstraintToggle(sql, label) {
        try {
            await this.query(sql);
        }
        catch (error) {
            if (error instanceof Error && /Timeout: Request failed to complete/i.test(error.message)) {
                const snapshot = await this._captureBlockingSessionsForDebug().catch((diagError) => `(blocking diagnostics query failed: ${diagError instanceof Error ? diagError.message : diagError})`);
                throw new Error(`${error.message}\n\n[${label} blocked] other user sessions with open transactions or active requests:\n${snapshot}`, { cause: error });
            }
            throw error;
        }
    }
    /**
     * Snapshots the sessions that could be blocking a constraint toggle in THIS
     * database — every session other than this one that holds a lock in `DB_ID()`
     * or is running a request against it — with its last statement, wait state,
     * and blocking session, enough to identify a connection that leaked a lock.
     * Scoped to the current database so a multi-database server does not leak
     * unrelated sessions' SQL into the error and bury the real blocker.
     * @returns {Promise<string>} - JSON snapshot, or a "(none)" marker.
     */
    async _captureBlockingSessionsForDebug() {
        const rows = await this.query(`
      WITH lock_sessions AS (
        SELECT DISTINCT request_session_id AS session_id
        FROM sys.dm_tran_locks
        WHERE resource_database_id = DB_ID()
      )
      SELECT
        s.session_id AS sessionId,
        s.status AS sessionStatus,
        s.login_time AS loginTime,
        s.last_request_start_time AS lastRequestStart,
        s.last_request_end_time AS lastRequestEnd,
        s.open_transaction_count AS openTransactionCount,
        r.status AS requestStatus,
        r.command AS command,
        r.wait_type AS waitType,
        r.wait_time AS waitTimeMs,
        r.blocking_session_id AS blockingSessionId,
        CAST(ib.event_info AS NVARCHAR(MAX)) AS lastSql
      FROM sys.dm_exec_sessions s
      LEFT JOIN sys.dm_exec_requests r ON r.session_id = s.session_id
      OUTER APPLY sys.dm_exec_input_buffer(s.session_id, NULL) ib
      WHERE s.is_user_process = 1
        AND s.session_id <> @@SPID
        AND (s.session_id IN (SELECT session_id FROM lock_sessions) OR r.database_id = DB_ID())
    `);
        if (rows.length === 0)
            return "(none — no other session held a lock or ran a request in this database when queried)";
        return JSON.stringify(rows, null, 2);
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
    async _dropReferencingForeignKeys(tableName) {
        const rows = await this.query("SELECT fk.name AS constraint_name, OBJECT_NAME(fk.parent_object_id) AS parent_table " +
            `FROM sys.foreign_keys fk WHERE fk.referenced_object_id = OBJECT_ID(${this.quote(tableName)})`);
        for (const row of rows) {
            const constraintName = row.constraint_name ?? row.CONSTRAINT_NAME;
            const parentTable = row.parent_table ?? row.PARENT_TABLE;
            await this.query(`ALTER TABLE [${parentTable}] DROP CONSTRAINT [${constraintName}]`);
        }
    }
    /**
     * Runs drop table.
     * @param {string} tableName - Table name.
     * @param {import("../base.js").DropTableSqlArgsType} [args] - Options object.
     * @returns {Promise<void>} - Resolves when complete.
     */
    async dropTable(tableName, args = {}) {
        this._assertNotReadOnly();
        await this._dropReferencingForeignKeys(tableName);
        const sqls = await this.dropTableSQLs(tableName, args);
        for (const sql of sqls) {
            await this.query(sql);
        }
    }
    /**
     * Runs get type.
     * @returns {string} - The type.
     */
    getType() { return "mssql"; }
    /**
     * Runs query actual.
     * @param {string} sql - SQL string.
     * @returns {Promise<import("../base.js").QueryResultType>} - Resolves with the query actual.
     */
    async _queryActual(sql) {
        let result;
        let tries = 0;
        while (true) {
            tries++;
            try {
                const request = this._currentTransaction
                    ? new mssql.Request(this._currentTransaction)
                    : new mssql.Request(this.connection);
                result = await request.query(sql);
                break;
            }
            catch (error) {
                if (error instanceof Error && error.message == "No connection is specified for that request." && tries <= 3) {
                    this.logger.warn("Reconnecting to database");
                    await this.reconnect();
                    // Retry
                }
                else if (error instanceof Error) {
                    // Re-throw error because the stack-trace is broken and can't be used for app-development.
                    throw new Error(`Query failed '${error.message}': ${sql}`, { cause: error });
                }
                else {
                    throw new Error(`Query failed '${error}': ${sql}`, { cause: error });
                }
            }
        }
        return Array.isArray(result.recordsets) ? result.recordsets[0] || [] : [];
    }
    /**
     * Executes a mutation with affected-row metadata.
     * @param {string} sql - Mutation SQL.
     * @returns {Promise<number>} - Affected row count.
     */
    async _affectedRowsActual(sql) {
        const request = this._currentTransaction
            ? new mssql.Request(this._currentTransaction)
            : new mssql.Request(this.connection);
        const result = await request.query(sql);
        return result.rowsAffected.reduce((total, count) => total + count, 0);
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
    async insertWithExplicitPrimaryKey({ options, sql, tableName }) {
        const quotedTable = this.quoteTable(tableName);
        const batch = [
            `SET IDENTITY_INSERT ${quotedTable} ON;`,
            "BEGIN TRY",
            `${sql};`,
            `SET IDENTITY_INSERT ${quotedTable} OFF;`,
            "END TRY",
            "BEGIN CATCH",
            `SET IDENTITY_INSERT ${quotedTable} OFF;`,
            "THROW;",
            "END CATCH"
        ].join("\n");
        return await this.query(batch, options);
    }
    /**
     * Runs escape.
     * @param {ReturnType<typeof JSON.parse>} value - Value to use.
     * @returns {string} - The escape.
     */
    escape(value) {
        value = this._convertValue(value);
        const stringValue = typeof value == "string" ? value : `${value}`;
        const resultWithQuotes = escapeString(stringValue, null);
        const result = resultWithQuotes.substring(1, resultWithQuotes.length - 1);
        return result;
    }
    /**
     * Runs quote.
     * @param {ReturnType<typeof JSON.parse>} value - Value to use.
     * @returns {string | number} - The quoted value.
     */
    quote(value) {
        value = this._convertValue(value);
        if (typeof value == "number")
            return value;
        const stringValue = typeof value == "string" ? value : String(value);
        return `N${escapeString(stringValue, null)}`;
    }
    /**
     * Runs quote column.
     * @param {string} columnName - Column name.
     * @returns {string} - The quote column.
     */
    quoteColumn(columnName) { return this.options().quoteColumnName(columnName); }
    /**
     * Runs quote table.
     * @param {string} string - String.
     * @returns {string} - The quote table.
     */
    quoteTable(string) { return this.options().quoteTableName(string); }
    /**
     * Runs rename column.
     * @param {string} tableName - Table name.
     * @param {string} oldColumnName - Previous column name.
     * @param {string} newColumnName - New column name.
     * @returns {Promise<void>} - Resolves when complete.
     */
    async renameColumn(tableName, oldColumnName, newColumnName) {
        await this.query(`EXEC sp_rename ${this.quote(`${tableName}.${oldColumnName}`)}, ${this.quote(newColumnName)}, 'COLUMN'`);
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
    /**
     * Runs get tables.
     * @returns {Promise<Array<import("../base-table.js").default>>} - Resolves with the tables.
     */
    async getTables() {
        return await this._cachedSchemaMetadata("tables", async () => {
            const schema = this.getArgs()?.schema || this.getArgs()?.sqlConfig?.options?.schema;
            const schemaClause = schema
                ? ` AND [TABLE_SCHEMA] = ${this.quote(schema)}`
                : " AND [TABLE_SCHEMA] = SCHEMA_NAME()";
            const result = await this.query(`SELECT [TABLE_NAME] FROM [INFORMATION_SCHEMA].[TABLES] WHERE [TABLE_CATALOG] = DB_NAME()${schemaClause}`);
            const tables = [];
            for (const row of result) {
                const table = new Table(this, /** @type {Record<string, string>} */ (row));
                tables.push(table);
            }
            return tables;
        });
    }
    /**
     * Truncates all eligible tables in one SQL Server request, retaining the
     * recognized foreign-key fallback used by the per-table implementation.
     * @param {Array<import("../base-table.js").default>} tables - Eligible tables.
     * @returns {Promise<void>} - Resolves when the batch completes.
     */
    async truncateTables(tables) {
        const statements = [];
        for (const table of tables) {
            const quotedTable = this.quoteTable(table.getName());
            statements.push("BEGIN TRY", `  TRUNCATE TABLE ${quotedTable};`, "END TRY", "BEGIN CATCH", "  IF ERROR_NUMBER() = 4712", "  BEGIN", `    DELETE FROM ${quotedTable};`, "  END", "  ELSE", "  BEGIN", "    THROW;", "  END", "END CATCH;");
        }
        await this.query(statements.join("\n"));
    }
    async lastInsertID(options = {}) {
        const result = await this.query("SELECT SCOPE_IDENTITY() AS last_insert_id", options);
        const lastInsertID = digg(result, 0, "last_insert_id");
        if (lastInsertID === null)
            throw new Error("Couldn't get the last inserted ID");
        return lastInsertID;
    }
    /**
     * Runs options.
     * @returns {Options} - The options options.
     */
    options() {
        if (!this._options)
            this._options = new Options({ driver: this });
        return this._options;
    }
    async _startTransactionAction() {
        await this._runPhysicalConnectionRequest(async () => {
            if (this._currentTransaction)
                throw new Error("A transaction is already running");
            if (!this.connection)
                await this.connect();
            this._currentTransaction = new mssql.Transaction(this.connection);
            try {
                await this._currentTransaction.begin();
            }
            catch (error) {
                this._currentTransaction = null;
                throw error;
            }
        });
    }
    async _commitTransactionAction() {
        await this._runPhysicalConnectionRequest(async () => {
            if (!this._currentTransaction)
                throw new Error("A transaction isn't running");
            await this._currentTransaction.commit();
            this._currentTransaction = null;
        });
    }
    async _rollbackTransactionAction() {
        await this._runPhysicalConnectionRequest(async () => {
            if (!this._currentTransaction) {
                this.logger.debug("A transaction isn't running - ignoring because that can happen if something else has failed in the db");
                return;
            }
            try {
                await this._currentTransaction.rollback();
            }
            catch (transactionRollbackError) {
                // When SQL Server has already aborted the transaction (e.g., a
                // stale concurrent request triggered XACT_ABORT), the
                // mssql.Transaction.rollback() call fails because the
                // Transaction object is dead.  Issue a raw ROLLBACK on the
                // underlying connection to clear SQL Server's session-level
                // aborted-transaction state so the connection is usable for the
                // next BEGIN TRANSACTION.
                this.logger.warn("Transaction.rollback() failed, clearing session state with raw ROLLBACK", {
                    error: transactionRollbackError instanceof Error ? transactionRollbackError.message : transactionRollbackError
                });
                const request = new mssql.Request(this.connection);
                await request.query("IF @@TRANCOUNT > 0 ROLLBACK");
            }
            finally {
                this._currentTransaction = null;
            }
        });
    }
    /**
     * Runs start save point action.
     * @param {string} savePointName - Save point name.
     * @param {Pick<import("../base.js").QueryOptions, "operationOwner">} [options] - Transaction ownership.
     * @returns {Promise<void>} - Resolves when complete.
     */
    async _startSavePointAction(savePointName, options = {}) {
        await this.query(`SAVE TRANSACTION [${savePointName}]`, options);
    }
    /**
     * Runs release save point action.
     * @param {string} savePointName - Save point name.
     * @param {Pick<import("../base.js").QueryOptions, "operationOwner">} [_options] - Transaction ownership.
     * @returns {Promise<void>} - Resolves when complete.
     */
    async _releaseSavePointAction(savePointName, _options = {}) {
        // Do nothing in MS-SQL.
    }
    /**
     * Runs rollback save point action.
     * @param {string} savePointName - Save point name.
     * @param {Pick<import("../base.js").QueryOptions, "operationOwner">} [options] - Transaction ownership.
     * @returns {Promise<void>} - Resolves when complete.
     */
    async _rollbackSavePointAction(savePointName, options = {}) {
        try {
            await this.query(`ROLLBACK TRANSACTION [${savePointName}]`, options);
        }
        catch (error) {
            const message = error instanceof Error ? error.message : `${error}`;
            // When XACT_ABORT kills the entire transaction, the savepoint
            // no longer exists and the ROLLBACK TRANSACTION [name] fails.
            // Issue a raw IF @@TRANCOUNT > 0 ROLLBACK to clear whatever
            // session state remains, then let the error propagate so the
            // outer transaction() call knows the transaction is dead.
            if (message.includes("Transaction has not begun") || message.includes("Transaction has been aborted")) {
                this.logger.debug("Savepoint rollback failed; transaction already dead, clearing session state");
                const request = new mssql.Request(this.connection);
                await request.query("IF @@TRANCOUNT > 0 ROLLBACK");
                return;
            }
            throw error;
        }
    }
    generateSavePointName() {
        return `sp${new UUID(4).format().replaceAll("-", "")}`.substring(0, 32);
    }
    /**
     * Runs update sql.
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
    async _acquireAdvisoryLock(name, { timeoutMs } = {}) {
        const timeoutValue = typeof timeoutMs === "number" && timeoutMs >= 0 ? Math.ceil(timeoutMs) : -1;
        const rows = await this._advisoryLockQuery(`DECLARE @velocious_advisory_lock_result INT; EXEC @velocious_advisory_lock_result = sp_getapplock @Resource = ${this.quote(name)}, @LockMode = 'Exclusive', @LockOwner = 'Session', @LockTimeout = ${timeoutValue}; SELECT @velocious_advisory_lock_result AS velocious_advisory_lock_result`);
        const result = Number(rows?.[0]?.velocious_advisory_lock_result);
        if (result === 0 || result === 1)
            return true;
        await this._closeAdvisoryLockTransaction();
        if (result === -1)
            return false;
        throw new Error(`sp_getapplock returned ${result} for advisory lock ${JSON.stringify(name)} (see SQL Server documentation for sp_getapplock return codes)`);
    }
    /**
     * Runs try acquire advisory lock.
     * @param {string} name - Lock name.
     * @returns {Promise<boolean>} - True if the lock was acquired, false if it was already held.
     */
    async _tryAcquireAdvisoryLock(name) {
        return await this._acquireAdvisoryLock(name, { timeoutMs: 0 });
    }
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
    async _releaseAdvisoryLock(name) {
        let rows;
        try {
            rows = await this._advisoryLockQuery(`DECLARE @velocious_advisory_lock_result INT; EXEC @velocious_advisory_lock_result = sp_releaseapplock @Resource = ${this.quote(name)}, @LockOwner = 'Session'; SELECT @velocious_advisory_lock_result AS velocious_advisory_lock_result`);
        }
        catch (error) {
            if (this._isApplockNotHeldError(error)) {
                await this._closeAdvisoryLockTransactionIfFinalRelease();
                return false;
            }
            throw error;
        }
        const result = Number(rows?.[0]?.velocious_advisory_lock_result);
        await this._closeAdvisoryLockTransactionIfFinalRelease();
        return result === 0;
    }
    /**
     * Runs an advisory-lock statement through one transaction request parent.
     * node-mssql reserves one physical session for a Transaction, whereas
     * separate ConnectionPool requests may check out different sessions. The
     * transaction contains only application-lock statements; caller/model work
     * continues through its original connection.
     * @param {string} sql - Advisory-lock SQL.
     * @returns {Promise<import("../base.js").QueryResultType>} - Result rows.
     */
    async _advisoryLockQuery(sql) {
        const transaction = await this._ensureAdvisoryLockTransaction();
        try {
            const request = new mssql.Request(transaction);
            const result = await request.query(sql);
            return Array.isArray(result.recordsets) ? result.recordsets[0] || [] : [];
        }
        catch (error) {
            if (error instanceof Error) {
                throw new Error(`Query failed '${error.message}': ${sql}`, { cause: error });
            }
            throw new Error(`Query failed '${error}': ${sql}`, { cause: error });
        }
    }
    /**
     * Starts the transaction request parent that reserves the advisory-lock
     * session until the final release or driver close.
     * @returns {Promise<import("mssql").Transaction>} - Session-affine parent.
     */
    async _ensureAdvisoryLockTransaction() {
        if (this._advisoryLockTransaction)
            return this._advisoryLockTransaction;
        if (!this.connection)
            await this.connect();
        if (!this.connection)
            throw new Error("MSSQL connection unavailable for advisory lock");
        const transaction = new mssql.Transaction(this.connection);
        await transaction.begin();
        this._advisoryLockTransaction = transaction;
        return transaction;
    }
    /**
     * Releases the reserved session after the last tracked lock release.
     * Base untracks the current release after the driver hook returns, so a
     * current total of one means this is the final release.
     * @returns {Promise<void>} - Resolves after cleanup when this is final.
     */
    async _closeAdvisoryLockTransactionIfFinalRelease() {
        let heldCount = 0;
        for (const count of this._heldAdvisoryLocks.values())
            heldCount += count;
        if (heldCount <= 1)
            await this._closeAdvisoryLockTransaction();
    }
    /**
     * Rolls back the otherwise-empty transaction and returns its physical
     * session to node-mssql. Rollback is cleanup only; advisory locks are
     * explicitly released first whenever their release statement succeeds.
     * @returns {Promise<void>} - Resolves after session cleanup.
     */
    async _closeAdvisoryLockTransaction() {
        const transaction = this._advisoryLockTransaction;
        if (!transaction)
            return;
        this._advisoryLockTransaction = null;
        await transaction.rollback();
    }
    /**
     * Detects the SQL Server "application lock is not currently held" error
     * raised by `sp_releaseapplock`. It walks the wrapped-error cause chain
     * because `query` re-wraps the driver's `RequestError` in a plain `Error`,
     * and matches on the stable numeric error number rather than the message.
     * @param {unknown} error - Error thrown while releasing the lock.
     * @returns {boolean} - True if the error means the lock was not held by this session.
     */
    _isApplockNotHeldError(error) {
        let current = error;
        while (current instanceof Error) {
            const errorNumber = /** @type {{number?: unknown}} */ (current).number;
            if (typeof errorNumber === "number" && errorNumber === APPLOCK_NOT_HELD_ERROR_NUMBER)
                return true;
            current = current.cause;
        }
        return false;
    }
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
    async isAdvisoryLockHeld(name) {
        const rows = await this.query(`SELECT ` +
            `APPLOCK_MODE('public', ${this.quote(name)}, 'Session') AS velocious_advisory_self_mode, ` +
            `APPLOCK_TEST('public', ${this.quote(name)}, 'Exclusive', 'Session') AS velocious_advisory_test_result`);
        const selfMode = rows?.[0]?.velocious_advisory_self_mode;
        const heldBySelf = typeof selfMode === "string" && selfMode.length > 0 && selfMode !== "NoLock";
        if (heldBySelf)
            return true;
        const testResult = Number(rows?.[0]?.velocious_advisory_test_result);
        return testResult === 0;
    }
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiaW5kZXguanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi8uLi8uLi9zcmMvZGF0YWJhc2UvZHJpdmVycy9tc3NxbC9pbmRleC5qcyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiQUFBQSxZQUFZO0FBRVosT0FBTyxVQUFVLE1BQU0sc0JBQXNCLENBQUE7QUFDN0MsT0FBTyxJQUFJLE1BQU0sWUFBWSxDQUFBO0FBQzdCLE9BQU8sY0FBYyxNQUFNLDBCQUEwQixDQUFBO0FBQ3JELE9BQU8sV0FBVyxNQUFNLHVCQUF1QixDQUFBO0FBQy9DLE9BQU8sV0FBVyxNQUFNLHVCQUF1QixDQUFBO0FBQy9DLE9BQU8sTUFBTSxNQUFNLGlCQUFpQixDQUFBO0FBQ3BDLE9BQU8sWUFBWSxNQUFNLHdCQUF3QixDQUFBO0FBQ2pELE9BQU8sU0FBUyxNQUFNLHFCQUFxQixDQUFBO0FBQzNDLE9BQU8sRUFBQyxJQUFJLEVBQUMsTUFBTSxXQUFXLENBQUE7QUFDOUIsT0FBTyxZQUFZLE1BQU0sbUJBQW1CLENBQUE7QUFDNUMsT0FBTyxNQUFNLE1BQU0saUJBQWlCLENBQUE7QUFDcEMsT0FBTyxPQUFPLE1BQU0sY0FBYyxDQUFBO0FBQ2xDLE9BQU8sS0FBSyxNQUFNLE9BQU8sQ0FBQTtBQUN6QixPQUFPLEdBQUcsTUFBTSxVQUFVLENBQUE7QUFDMUIsT0FBTyxXQUFXLE1BQU0sbUJBQW1CLENBQUE7QUFDM0MsT0FBTyxXQUFXLE1BQU0sdUJBQXVCLENBQUE7QUFDL0MsT0FBTyxLQUFLLE1BQU0sWUFBWSxDQUFBO0FBQzlCLE9BQU8sWUFBWSxNQUFNLG9CQUFvQixDQUFBO0FBQzdDLE9BQU8sT0FBTyxNQUFNLDJCQUEyQixDQUFBO0FBQy9DLE9BQU8sTUFBTSxNQUFNLGlCQUFpQixDQUFBO0FBQ3BDLE9BQU8sTUFBTSxNQUFNLGlCQUFpQixDQUFBO0FBQ3BDLE9BQU8sSUFBSSxNQUFNLFdBQVcsQ0FBQTtBQUU1Qjs7Ozs7Ozs7R0FRRztBQUNILE1BQU0sNkJBQTZC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QyxDQUFDLENBQUMsRUFBRSw0QkFBNEIsQ0FBQTtRQUN4RCxNQUFNLFVBQVUsR0FBRyxPQUFPLFFBQVEsS0FBSyxRQUFRLElBQUksUUFBUSxDQUFDLE1BQU0sR0FBRyxDQUFDLElBQUksUUFBUSxLQUFLLFFBQVEsQ0FBQTtRQUUvRixJQUFJLFVBQVU7WUFBRSxPQUFPLElBQUksQ0FBQTtRQUUzQixNQUFNLFVBQVUsR0FBRyxNQUFNLENBQUMsSUFBSSxFQUFFLENBQUMsQ0FBQyxDQUFDLEVBQUUsOEJBQThCLENBQUMsQ0FBQTtRQUVwRSxPQUFPLFVBQVUsS0FBSyxDQUFDLENBQUE7SUFDekIsQ0FBQztDQUNGIiwic291cmNlc0NvbnRlbnQiOlsiLy8gQHRzLWNoZWNrXG5cbmltcG9ydCBBbHRlclRhYmxlIGZyb20gXCIuL3NxbC9hbHRlci10YWJsZS5qc1wiXG5pbXBvcnQgQmFzZSBmcm9tIFwiLi4vYmFzZS5qc1wiXG5pbXBvcnQgQ3JlYXRlRGF0YWJhc2UgZnJvbSBcIi4vc3FsL2NyZWF0ZS1kYXRhYmFzZS5qc1wiXG5pbXBvcnQgQ3JlYXRlSW5kZXggZnJvbSBcIi4vc3FsL2NyZWF0ZS1pbmRleC5qc1wiXG5pbXBvcnQgQ3JlYXRlVGFibGUgZnJvbSBcIi4vc3FsL2NyZWF0ZS10YWJsZS5qc1wiXG5pbXBvcnQgRGVsZXRlIGZyb20gXCIuL3NxbC9kZWxldGUuanNcIlxuaW1wb3J0IERyb3BEYXRhYmFzZSBmcm9tIFwiLi9zcWwvZHJvcC1kYXRhYmFzZS5qc1wiXG5pbXBvcnQgRHJvcFRhYmxlIGZyb20gXCIuL3NxbC9kcm9wLXRhYmxlLmpzXCJcbmltcG9ydCB7ZGlnZ30gZnJvbSBcImRpZ2dlcml6ZVwiXG5pbXBvcnQgZXNjYXBlU3RyaW5nIGZyb20gXCJzcWwtZXNjYXBlLXN0cmluZ1wiXG5pbXBvcnQgSW5zZXJ0IGZyb20gXCIuL3NxbC9pbnNlcnQuanNcIlxuaW1wb3J0IE9wdGlvbnMgZnJvbSBcIi4vb3B0aW9ucy5qc1wiXG5pbXBvcnQgbXNzcWwgZnJvbSBcIm1zc3FsXCJcbmltcG9ydCBuZXQgZnJvbSBcIm5vZGU6bmV0XCJcbmltcG9ydCBRdWVyeVBhcnNlciBmcm9tIFwiLi9xdWVyeS1wYXJzZXIuanNcIlxuaW1wb3J0IFJlbW92ZUluZGV4IGZyb20gXCIuL3NxbC9yZW1vdmUtaW5kZXguanNcIlxuaW1wb3J0IFRhYmxlIGZyb20gXCIuL3RhYmxlLmpzXCJcbmltcG9ydCBTdHJ1Y3R1cmVTcWwgZnJvbSBcIi4vc3RydWN0dXJlLXNxbC5qc1wiXG5pbXBvcnQgdGltZW91dCBmcm9tIFwiYXdhaXRlcnkvYnVpbGQvdGltZW91dC5qc1wiXG5pbXBvcnQgVXBzZXJ0IGZyb20gXCIuL3NxbC91cHNlcnQuanNcIlxuaW1wb3J0IFVwZGF0ZSBmcm9tIFwiLi9zcWwvdXBkYXRlLmpzXCJcbmltcG9ydCBVVUlEIGZyb20gXCJwdXJlLXV1aWRcIlxuXG4vKipcbiAqIFNRTCBTZXJ2ZXIgZXJyb3IgbnVtYmVyIHJhaXNlZCBieSBgc3BfcmVsZWFzZWFwcGxvY2tgIHdoZW4gdGhlIGN1cnJlbnRcbiAqIHNlc3Npb24gZG9lcyBub3QgaG9sZCB0aGUgcmVxdWVzdGVkIGFwcGxpY2F0aW9uIGxvY2suIFJlbGVhc2luZyBhIGxvY2sgdGhlXG4gKiBzZXNzaW9uIG5vIGxvbmdlciBob2xkcyBpcyBhIG5vcm1hbCByYWNlIChhIHNoYXJlZCBjb25uZWN0aW9uJ3MgZmluYWxcbiAqIGNoZWNrLWluIG1heSBhbHJlYWR5IGhhdmUgYXV0by1yZWxlYXNlZCBpdCksIHdoaWNoIHRoZSBjcm9zcy1kcml2ZXJcbiAqIGByZWxlYXNlQWR2aXNvcnlMb2NrYCBjb250cmFjdCBtb2RlbHMgYnkgcmVzb2x2aW5nIHRvIGBmYWxzZWAuIFdlIHRyYW5zbGF0ZVxuICogdGhpcyBzcGVjaWZpYyBlcnJvciBpbnRvIHRoYXQgcmVzdWx0IHJhdGhlciB0aGFuIGxldHRpbmcgaXQgZXNjYXBlLlxuICogQHR5cGUge251bWJlcn1cbiAqL1xuY29uc3QgQVBQTE9DS19OT1RfSEVMRF9FUlJPUl9OVU1CRVIgPSAxMjIzXG5cbmV4cG9ydCBkZWZhdWx0IGNsYXNzIFZlbG9jaW91c0RhdGFiYXNlRHJpdmVyc01zc3FsIGV4dGVuZHMgQmFzZXtcbiAgLyoqIEB0eXBlIHtpbXBvcnQoXCJtc3NxbFwiKS5UcmFuc2FjdGlvbiB8IG51bGx9ICovXG4gIF9hZHZpc29yeUxvY2tUcmFuc2FjdGlvbiA9IG51bGxcblxuICBhc3luYyBjb25uZWN0KCkge1xuICAgIGNvbnN0IGFyZ3MgPSB0aGlzLmdldEFyZ3MoKVxuICAgIGNvbnN0IHNxbENvbmZpZyA9IGRpZ2coYXJncywgXCJzcWxDb25maWdcIilcblxuICAgIHRyeSB7XG4gICAgICBpZiAodGhpcy5jb25uZWN0aW9uKSBhd2FpdCB0aGlzLmNsb3NlKClcblxuICAgICAgaWYgKHNxbENvbmZpZykge1xuICAgICAgICBzcWxDb25maWcub3B0aW9ucyA9IE9iamVjdC5hc3NpZ24oe30sIHNxbENvbmZpZy5vcHRpb25zLCB7dXNlVVRDOiB0cnVlfSlcbiAgICAgIH1cblxuICAgICAgaWYgKHNxbENvbmZpZz8uc2VydmVyICYmICFzcWxDb25maWcub3B0aW9ucz8uc2VydmVyTmFtZSAmJiBuZXQuaXNJUChzcWxDb25maWcuc2VydmVyKSkge1xuICAgICAgICBzcWxDb25maWcub3B0aW9ucyA9IE9iamVjdC5hc3NpZ24oe30sIHNxbENvbmZpZy5vcHRpb25zLCB7c2VydmVyTmFtZTogXCJcIn0pXG4gICAgICB9XG5cbiAgICAgIHRoaXMuY29ubmVjdGlvbiA9IG5ldyBtc3NxbC5Db25uZWN0aW9uUG9vbChzcWxDb25maWcpXG4gICAgICBhd2FpdCB0aGlzLmNvbm5lY3Rpb24uY29ubmVjdCgpXG4gICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgIC8vIFJlLXRocm93IHRvIGZpeCB1bnVzZWFibGUgc3RhY2sgdHJhY2UuXG4gICAgICB0aHJvdyBuZXcgRXJyb3IoYENvdWxkbid0IGNvbm5lY3QgdG8gZGF0YWJhc2U6ICR7ZXJyb3IgaW5zdGFuY2VvZiBFcnJvciA/IGVycm9yLm1lc3NhZ2UgOiBlcnJvcn1gLCB7Y2F1c2U6IGVycm9yfSlcbiAgICB9XG4gIH1cblxuICBhc3luYyBfY2xvc2UoKSB7XG4gICAgaWYgKCF0aGlzLmNvbm5lY3Rpb24pIHJldHVyblxuXG4gICAgY29uc3QgY29ubmVjdGlvbiA9IHRoaXMuY29ubmVjdGlvblxuICAgIHRoaXMuY29ubmVjdGlvbiA9IHVuZGVmaW5lZFxuICAgIHRoaXMuX2N1cnJlbnRUcmFuc2FjdGlvbiA9IG51bGxcbiAgICB0aGlzLl90cmFuc2FjdGlvbnNDb3VudCA9IDBcbiAgICAvKiogQHR5cGUge0Vycm9yIHwgdW5kZWZpbmVkfSAqL1xuICAgIGxldCBzZXNzaW9uRXJyb3JcblxuICAgIHRyeSB7XG4gICAgICBhd2FpdCB0aGlzLl9jbG9zZUFkdmlzb3J5TG9ja1RyYW5zYWN0aW9uKClcbiAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgc2Vzc2lvbkVycm9yID0gZXJyb3IgaW5zdGFuY2VvZiBFcnJvciA/IGVycm9yIDogbmV3IEVycm9yKFwiRmFpbGVkIHRvIGNsb3NlIE1TU1FMIGFkdmlzb3J5LWxvY2sgc2Vzc2lvblwiLCB7Y2F1c2U6IGVycm9yfSlcbiAgICB9XG5cbiAgICB0cnkge1xuICAgICAgYXdhaXQgdGltZW91dCh7dGltZW91dDogMjAwMH0sICgpID0+IGNvbm5lY3Rpb24uY2xvc2UoKSlcbiAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgdGhpcy5sb2dnZXIud2FybihcIkZhaWxlZCB0byBjbG9zZSBNU1NRTCBjb25uZWN0aW9uIGNsZWFubHlcIiwge2Vycm9yfSlcbiAgICB9XG5cbiAgICBpZiAoc2Vzc2lvbkVycm9yKSB0aHJvdyBzZXNzaW9uRXJyb3JcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGFsdGVyIHRhYmxlIHNxbHMuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vLi4vdGFibGUtZGF0YS9pbmRleC5qc1wiKS5kZWZhdWx0fSB0YWJsZURhdGEgLSBUYWJsZSBkYXRhLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxzdHJpbmdbXT59IC0gUmVzb2x2ZXMgd2l0aCBTUUwgc3RhdGVtZW50cy5cbiAgICovXG4gIGFzeW5jIGFsdGVyVGFibGVTUUxzKHRhYmxlRGF0YSkge1xuICAgIGNvbnN0IGFsdGVyQXJncyA9IHt0YWJsZURhdGEsIGRyaXZlcjogdGhpc31cbiAgICBjb25zdCBhbHRlclRhYmxlID0gbmV3IEFsdGVyVGFibGUoYWx0ZXJBcmdzKVxuXG4gICAgcmV0dXJuIGF3YWl0IGFsdGVyVGFibGUudG9TUUxzKClcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGNyZWF0ZSBkYXRhYmFzZSBzcWwuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBkYXRhYmFzZU5hbWUgLSBEYXRhYmFzZSBuYW1lLlxuICAgKiBAcGFyYW0ge29iamVjdH0gW2FyZ3NdIC0gT3B0aW9ucyBvYmplY3QuXG4gICAqIEBwYXJhbSB7Ym9vbGVhbn0gW2FyZ3MuaWZOb3RFeGlzdHNdIC0gV2hldGhlciBpZiBub3QgZXhpc3RzLlxuICAgKiBAcmV0dXJucyB7c3RyaW5nW119IC0gU1FMIHN0YXRlbWVudHMuXG4gICAqL1xuICBjcmVhdGVEYXRhYmFzZVNxbChkYXRhYmFzZU5hbWUsIGFyZ3MpIHtcbiAgICBjb25zdCBjcmVhdGVBcmdzID0gT2JqZWN0LmFzc2lnbih7ZGF0YWJhc2VOYW1lLCBkcml2ZXI6IHRoaXN9LCBhcmdzKVxuICAgIGNvbnN0IGNyZWF0ZURhdGFiYXNlID0gbmV3IENyZWF0ZURhdGFiYXNlKGNyZWF0ZUFyZ3MpXG5cbiAgICByZXR1cm4gY3JlYXRlRGF0YWJhc2UudG9TcWwoKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZHJvcCBkYXRhYmFzZSBzcWwuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBkYXRhYmFzZU5hbWUgLSBEYXRhYmFzZSBuYW1lLlxuICAgKiBAcGFyYW0ge29iamVjdH0gW2FyZ3NdIC0gT3B0aW9ucyBvYmplY3QuXG4gICAqIEBwYXJhbSB7Ym9vbGVhbn0gW2FyZ3MuaWZFeGlzdHNdIC0gV2hldGhlciBpZiBleGlzdHMuXG4gICAqIEByZXR1cm5zIHtzdHJpbmdbXX0gLSBTUUwgc3RhdGVtZW50cy5cbiAgICovXG4gIGRyb3BEYXRhYmFzZVNxbChkYXRhYmFzZU5hbWUsIGFyZ3MpIHtcbiAgICBjb25zdCBkcm9wQXJncyA9IE9iamVjdC5hc3NpZ24oe2RhdGFiYXNlTmFtZSwgZHJpdmVyOiB0aGlzfSwgYXJncylcbiAgICBjb25zdCBkcm9wRGF0YWJhc2UgPSBuZXcgRHJvcERhdGFiYXNlKGRyb3BBcmdzKVxuXG4gICAgcmV0dXJuIGRyb3BEYXRhYmFzZS50b1NxbCgpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBjcmVhdGUgaW5kZXggc3Fscy5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9iYXNlLmpzXCIpLkNyZWF0ZUluZGV4U3FsQXJnc30gaW5kZXhEYXRhIC0gSW5kZXggZGF0YS5cbiAgICogQHJldHVybnMge1Byb21pc2U8c3RyaW5nW10+fSAtIFJlc29sdmVzIHdpdGggU1FMIHN0YXRlbWVudHMuXG4gICAqL1xuICBhc3luYyBjcmVhdGVJbmRleFNRTHMoaW5kZXhEYXRhKSB7XG4gICAgY29uc3QgY3JlYXRlQXJncyA9IE9iamVjdC5hc3NpZ24oe2RyaXZlcjogdGhpc30sIGluZGV4RGF0YSlcbiAgICBjb25zdCBjcmVhdGVJbmRleCA9IG5ldyBDcmVhdGVJbmRleChjcmVhdGVBcmdzKVxuXG4gICAgcmV0dXJuIGF3YWl0IGNyZWF0ZUluZGV4LnRvU1FMcygpXG4gIH1cblxuICAvKipcbiAgICogUnVucyByZW1vdmUgaW5kZXggc3Fscy5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9iYXNlLmpzXCIpLlJlbW92ZUluZGV4U3FsQXJnc30gaW5kZXhEYXRhIC0gSW5kZXggZGF0YS5cbiAgICogQHJldHVybnMge1Byb21pc2U8c3RyaW5nW10+fSAtIFJlc29sdmVzIHdpdGggU1FMIHN0YXRlbWVudHMuXG4gICAqL1xuICBhc3luYyByZW1vdmVJbmRleFNRTHMoaW5kZXhEYXRhKSB7XG4gICAgY29uc3QgcmVtb3ZlQXJncyA9IE9iamVjdC5hc3NpZ24oe2RyaXZlcjogdGhpc30sIGluZGV4RGF0YSlcbiAgICBjb25zdCByZW1vdmVJbmRleCA9IG5ldyBSZW1vdmVJbmRleChyZW1vdmVBcmdzKVxuXG4gICAgcmV0dXJuIGF3YWl0IHJlbW92ZUluZGV4LnRvU1FMcygpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBjcmVhdGUgdGFibGUgc3FsLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uLy4uL3RhYmxlLWRhdGEvaW5kZXguanNcIikuZGVmYXVsdH0gdGFibGVEYXRhIC0gVGFibGUgZGF0YS5cbiAgICogQHJldHVybnMge1Byb21pc2U8c3RyaW5nW10+fSAtIFJlc29sdmVzIHdpdGggU1FMIHN0YXRlbWVudHMuXG4gICAqL1xuICBhc3luYyBjcmVhdGVUYWJsZVNxbCh0YWJsZURhdGEpIHtcbiAgICBjb25zdCBjcmVhdGVBcmdzID0ge3RhYmxlRGF0YSwgZHJpdmVyOiB0aGlzLCBpbmRleEluQ3JlYXRlVGFibGU6IGZhbHNlfVxuICAgIGNvbnN0IGNyZWF0ZVRhYmxlID0gbmV3IENyZWF0ZVRhYmxlKGNyZWF0ZUFyZ3MpXG5cbiAgICByZXR1cm4gYXdhaXQgY3JlYXRlVGFibGUudG9TcWwoKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgY3VycmVudCBkYXRhYmFzZS5cbiAgICogQHJldHVybnMge1Byb21pc2U8c3RyaW5nPn0gLSBSZXNvbHZlcyB3aXRoIHRoZSBjdXJyZW50IGRhdGFiYXNlLlxuICAgKi9cbiAgYXN5bmMgY3VycmVudERhdGFiYXNlKCkge1xuICAgIGNvbnN0IHJvd3MgPSBhd2FpdCB0aGlzLnF1ZXJ5KFwiU0VMRUNUIERCX05BTUUoKSBBUyBkYl9uYW1lXCIpXG5cbiAgICByZXR1cm4gZGlnZyhyb3dzLCAwLCBcImRiX25hbWVcIilcbiAgfVxuXG4gIC8qKlxuICAgKiBEaXNhYmxlcyBldmVyeSBmb3JlaWduIGtleSBjb25zdHJhaW50IChidWxrIGBOT0NIRUNLYCkuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIHdoZW4gZm9yZWlnbiBrZXlzIGFyZSBkaXNhYmxlZC5cbiAgICovXG4gIGFzeW5jIGRpc2FibGVGb3JlaWduS2V5cygpIHtcbiAgICBhd2FpdCB0aGlzLl9leGVjQ29uc3RyYWludFRvZ2dsZShcIkVYRUMgc3BfTVNmb3JlYWNodGFibGUgXFxcIkFMVEVSIFRBQkxFID8gTk9DSEVDSyBDT05TVFJBSU5UIGFsbFxcXCJcIiwgXCJkaXNhYmxlRm9yZWlnbktleXNcIilcbiAgfVxuXG4gIC8qKlxuICAgKiBSZS1lbmFibGVzIGFuZCByZS12YWxpZGF0ZXMgZXZlcnkgZm9yZWlnbiBrZXkgY29uc3RyYWludCAoYFdJVEggQ0hFQ0tgKS5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgd2hlbiBmb3JlaWduIGtleXMgYXJlIGVuYWJsZWQuXG4gICAqL1xuICBhc3luYyBlbmFibGVGb3JlaWduS2V5cygpIHtcbiAgICBhd2FpdCB0aGlzLl9leGVjQ29uc3RyYWludFRvZ2dsZShcIkVYRUMgc3BfTVNmb3JlYWNodGFibGUgQGNvbW1hbmQxPVxcXCJwcmludCAnPydcXFwiLCBAY29tbWFuZDI9XFxcIkFMVEVSIFRBQkxFID8gV0lUSCBDSEVDSyBDSEVDSyBDT05TVFJBSU5UIGFsbFxcXCJcIiwgXCJlbmFibGVGb3JlaWduS2V5c1wiKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgYSBidWxrIGNvbnN0cmFpbnQtdG9nZ2xlIHN0YXRlbWVudC4gYEFMVEVSIFRBQkxFIC4uLiBOT0NIRUNLL0NIRUNLXG4gICAqIENPTlNUUkFJTlRgIG5lZWRzIGEgc2NoZW1hLW1vZGlmaWNhdGlvbiBsb2NrIG9uIGV2ZXJ5IHRhYmxlLCBzbyBpZiB0aGVcbiAgICogcmVxdWVzdCB0aW1lcyBvdXQgaXQgaXMgYWxtb3N0IGFsd2F5cyBibG9ja2VkIGJ5IGFub3RoZXIgc2Vzc2lvbiB0aGF0IGlzXG4gICAqIHN0aWxsIGhvbGRpbmcgYSBsb2NrIChhIGxlYWtlZC91bmNvbW1pdHRlZCBjb25uZWN0aW9uKS4gT24gYSB0aW1lb3V0LFxuICAgKiBjYXB0dXJlIHdoaWNoIHNlc3Npb25zIHdlcmUgYmxvY2tpbmcgc28gdGhlIHJlYWwgY3VscHJpdCBpcyBuYW1lZCBpbnN0ZWFkXG4gICAqIG9mIGxlYXZpbmcgYSBiYXJlIFwiUmVxdWVzdCBmYWlsZWQgdG8gY29tcGxldGUgaW4gMTUwMDBtc1wiLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gc3FsIC0gQ29uc3RyYWludC10b2dnbGUgU1FMLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gbGFiZWwgLSBPcGVyYXRpb24gbGFiZWwgZm9yIHRoZSBlcnJvci5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgd2hlbiB0aGUgdG9nZ2xlIGNvbXBsZXRlcy5cbiAgICovXG4gIGFzeW5jIF9leGVjQ29uc3RyYWludFRvZ2dsZShzcWwsIGxhYmVsKSB7XG4gICAgdHJ5IHtcbiAgICAgIGF3YWl0IHRoaXMucXVlcnkoc3FsKVxuICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICBpZiAoZXJyb3IgaW5zdGFuY2VvZiBFcnJvciAmJiAvVGltZW91dDogUmVxdWVzdCBmYWlsZWQgdG8gY29tcGxldGUvaS50ZXN0KGVycm9yLm1lc3NhZ2UpKSB7XG4gICAgICAgIGNvbnN0IHNuYXBzaG90ID0gYXdhaXQgdGhpcy5fY2FwdHVyZUJsb2NraW5nU2Vzc2lvbnNGb3JEZWJ1ZygpLmNhdGNoKFxuICAgICAgICAgIChkaWFnRXJyb3IpID0+IGAoYmxvY2tpbmcgZGlhZ25vc3RpY3MgcXVlcnkgZmFpbGVkOiAke2RpYWdFcnJvciBpbnN0YW5jZW9mIEVycm9yID8gZGlhZ0Vycm9yLm1lc3NhZ2UgOiBkaWFnRXJyb3J9KWBcbiAgICAgICAgKVxuXG4gICAgICAgIHRocm93IG5ldyBFcnJvcihgJHtlcnJvci5tZXNzYWdlfVxcblxcblske2xhYmVsfSBibG9ja2VkXSBvdGhlciB1c2VyIHNlc3Npb25zIHdpdGggb3BlbiB0cmFuc2FjdGlvbnMgb3IgYWN0aXZlIHJlcXVlc3RzOlxcbiR7c25hcHNob3R9YCwge2NhdXNlOiBlcnJvcn0pXG4gICAgICB9XG5cbiAgICAgIHRocm93IGVycm9yXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIFNuYXBzaG90cyB0aGUgc2Vzc2lvbnMgdGhhdCBjb3VsZCBiZSBibG9ja2luZyBhIGNvbnN0cmFpbnQgdG9nZ2xlIGluIFRISVNcbiAgICogZGF0YWJhc2Ug4oCUIGV2ZXJ5IHNlc3Npb24gb3RoZXIgdGhhbiB0aGlzIG9uZSB0aGF0IGhvbGRzIGEgbG9jayBpbiBgREJfSUQoKWBcbiAgICogb3IgaXMgcnVubmluZyBhIHJlcXVlc3QgYWdhaW5zdCBpdCDigJQgd2l0aCBpdHMgbGFzdCBzdGF0ZW1lbnQsIHdhaXQgc3RhdGUsXG4gICAqIGFuZCBibG9ja2luZyBzZXNzaW9uLCBlbm91Z2ggdG8gaWRlbnRpZnkgYSBjb25uZWN0aW9uIHRoYXQgbGVha2VkIGEgbG9jay5cbiAgICogU2NvcGVkIHRvIHRoZSBjdXJyZW50IGRhdGFiYXNlIHNvIGEgbXVsdGktZGF0YWJhc2Ugc2VydmVyIGRvZXMgbm90IGxlYWtcbiAgICogdW5yZWxhdGVkIHNlc3Npb25zJyBTUUwgaW50byB0aGUgZXJyb3IgYW5kIGJ1cnkgdGhlIHJlYWwgYmxvY2tlci5cbiAgICogQHJldHVybnMge1Byb21pc2U8c3RyaW5nPn0gLSBKU09OIHNuYXBzaG90LCBvciBhIFwiKG5vbmUpXCIgbWFya2VyLlxuICAgKi9cbiAgYXN5bmMgX2NhcHR1cmVCbG9ja2luZ1Nlc3Npb25zRm9yRGVidWcoKSB7XG4gICAgY29uc3Qgcm93cyA9IGF3YWl0IHRoaXMucXVlcnkoYFxuICAgICAgV0lUSCBsb2NrX3Nlc3Npb25zIEFTIChcbiAgICAgICAgU0VMRUNUIERJU1RJTkNUIHJlcXVlc3Rfc2Vzc2lvbl9pZCBBUyBzZXNzaW9uX2lkXG4gICAgICAgIEZST00gc3lzLmRtX3RyYW5fbG9ja3NcbiAgICAgICAgV0hFUkUgcmVzb3VyY2VfZGF0YWJhc2VfaWQgPSBEQl9JRCgpXG4gICAgICApXG4gICAgICBTRUxFQ1RcbiAgICAgICAgcy5zZXNzaW9uX2lkIEFTIHNlc3Npb25JZCxcbiAgICAgICAgcy5zdGF0dXMgQVMgc2Vzc2lvblN0YXR1cyxcbiAgICAgICAgcy5sb2dpbl90aW1lIEFTIGxvZ2luVGltZSxcbiAgICAgICAgcy5sYXN0X3JlcXVlc3Rfc3RhcnRfdGltZSBBUyBsYXN0UmVxdWVzdFN0YXJ0LFxuICAgICAgICBzLmxhc3RfcmVxdWVzdF9lbmRfdGltZSBBUyBsYXN0UmVxdWVzdEVuZCxcbiAgICAgICAgcy5vcGVuX3RyYW5zYWN0aW9uX2NvdW50IEFTIG9wZW5UcmFuc2FjdGlvbkNvdW50LFxuICAgICAgICByLnN0YXR1cyBBUyByZXF1ZXN0U3RhdHVzLFxuICAgICAgICByLmNvbW1hbmQgQVMgY29tbWFuZCxcbiAgICAgICAgci53YWl0X3R5cGUgQVMgd2FpdFR5cGUsXG4gICAgICAgIHIud2FpdF90aW1lIEFTIHdhaXRUaW1lTXMsXG4gICAgICAgIHIuYmxvY2tpbmdfc2Vzc2lvbl9pZCBBUyBibG9ja2luZ1Nlc3Npb25JZCxcbiAgICAgICAgQ0FTVChpYi5ldmVudF9pbmZvIEFTIE5WQVJDSEFSKE1BWCkpIEFTIGxhc3RTcWxcbiAgICAgIEZST00gc3lzLmRtX2V4ZWNfc2Vzc2lvbnMgc1xuICAgICAgTEVGVCBKT0lOIHN5cy5kbV9leGVjX3JlcXVlc3RzIHIgT04gci5zZXNzaW9uX2lkID0gcy5zZXNzaW9uX2lkXG4gICAgICBPVVRFUiBBUFBMWSBzeXMuZG1fZXhlY19pbnB1dF9idWZmZXIocy5zZXNzaW9uX2lkLCBOVUxMKSBpYlxuICAgICAgV0hFUkUgcy5pc191c2VyX3Byb2Nlc3MgPSAxXG4gICAgICAgIEFORCBzLnNlc3Npb25faWQgPD4gQEBTUElEXG4gICAgICAgIEFORCAocy5zZXNzaW9uX2lkIElOIChTRUxFQ1Qgc2Vzc2lvbl9pZCBGUk9NIGxvY2tfc2Vzc2lvbnMpIE9SIHIuZGF0YWJhc2VfaWQgPSBEQl9JRCgpKVxuICAgIGApXG5cbiAgICBpZiAocm93cy5sZW5ndGggPT09IDApIHJldHVybiBcIihub25lIOKAlCBubyBvdGhlciBzZXNzaW9uIGhlbGQgYSBsb2NrIG9yIHJhbiBhIHJlcXVlc3QgaW4gdGhpcyBkYXRhYmFzZSB3aGVuIHF1ZXJpZWQpXCJcblxuICAgIHJldHVybiBKU09OLnN0cmluZ2lmeShyb3dzLCBudWxsLCAyKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZHJvcCB0YWJsZSBzcWxzLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gdGFibGVOYW1lIC0gVGFibGUgbmFtZS5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9iYXNlLmpzXCIpLkRyb3BUYWJsZVNxbEFyZ3NUeXBlfSBbYXJnc10gLSBPcHRpb25zIG9iamVjdC5cbiAgICogQHJldHVybnMge1Byb21pc2U8c3RyaW5nW10+fSAtIFJlc29sdmVzIHdpdGggU1FMIHN0YXRlbWVudHMuXG4gICAqL1xuICBhc3luYyBkcm9wVGFibGVTUUxzKHRhYmxlTmFtZSwgYXJncyA9IHt9KSB7XG4gICAgY29uc3QgZHJvcEFyZ3MgPSBPYmplY3QuYXNzaWduKHt0YWJsZU5hbWUsIGRyaXZlcjogdGhpc30sIGFyZ3MpXG4gICAgY29uc3QgZHJvcFRhYmxlID0gbmV3IERyb3BUYWJsZShkcm9wQXJncylcblxuICAgIHJldHVybiBhd2FpdCBkcm9wVGFibGUudG9TUUxzKClcbiAgfVxuXG4gIC8qKlxuICAgKiBEcm9wcyB0aGUgZm9yZWlnbiBrZXkgY29uc3RyYWludHMgdGhhdCByZWZlcmVuY2UgdGhlIGdpdmVuIHRhYmxlLiBNU1NRTFxuICAgKiByZWZ1c2VzIHRvIGRyb3AgYSB0YWJsZSB0aGF0IGlzIHN0aWxsIHJlZmVyZW5jZWQgYnkgYSBGT1JFSUdOIEtFWVxuICAgKiBjb25zdHJhaW50IGV2ZW4gd2hlbiBjb25zdHJhaW50cyBhcmUgZGlzYWJsZWQgdmlhIE5PQ0hFQ0ssIHNvIHRoZVxuICAgKiByZWZlcmVuY2luZyBjb25zdHJhaW50cyBtdXN0IGJlIHJlbW92ZWQgYmVmb3JlIHRoZSB0YWJsZSBjYW4gYmUgZHJvcHBlZC5cbiAgICogVGhpcyBsZXRzIGNhbGxlcnMgZHJvcCB0YWJsZXMgaW4gYW55IG9yZGVyIChlLmcuIHdpcGluZyBhIHdob2xlIHNjaGVtYSlcbiAgICogd2l0aG91dCBmaXJzdCBkcm9wcGluZyBldmVyeSBkZXBlbmRlbnQgdGFibGUuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSB0YWJsZU5hbWUgLSBUYWJsZSBuYW1lLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyB3aGVuIGNvbXBsZXRlLlxuICAgKi9cbiAgYXN5bmMgX2Ryb3BSZWZlcmVuY2luZ0ZvcmVpZ25LZXlzKHRhYmxlTmFtZSkge1xuICAgIGNvbnN0IHJvd3MgPSBhd2FpdCB0aGlzLnF1ZXJ5KFxuICAgICAgXCJTRUxFQ1QgZmsubmFtZSBBUyBjb25zdHJhaW50X25hbWUsIE9CSkVDVF9OQU1FKGZrLnBhcmVudF9vYmplY3RfaWQpIEFTIHBhcmVudF90YWJsZSBcIiArXG4gICAgICBgRlJPTSBzeXMuZm9yZWlnbl9rZXlzIGZrIFdIRVJFIGZrLnJlZmVyZW5jZWRfb2JqZWN0X2lkID0gT0JKRUNUX0lEKCR7dGhpcy5xdW90ZSh0YWJsZU5hbWUpfSlgXG4gICAgKVxuXG4gICAgZm9yIChjb25zdCByb3cgb2Ygcm93cykge1xuICAgICAgY29uc3QgY29uc3RyYWludE5hbWUgPSByb3cuY29uc3RyYWludF9uYW1lID8/IHJvdy5DT05TVFJBSU5UX05BTUVcbiAgICAgIGNvbnN0IHBhcmVudFRhYmxlID0gcm93LnBhcmVudF90YWJsZSA/PyByb3cuUEFSRU5UX1RBQkxFXG5cbiAgICAgIGF3YWl0IHRoaXMucXVlcnkoYEFMVEVSIFRBQkxFIFske3BhcmVudFRhYmxlfV0gRFJPUCBDT05TVFJBSU5UIFske2NvbnN0cmFpbnROYW1lfV1gKVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGRyb3AgdGFibGUuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSB0YWJsZU5hbWUgLSBUYWJsZSBuYW1lLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL2Jhc2UuanNcIikuRHJvcFRhYmxlU3FsQXJnc1R5cGV9IFthcmdzXSAtIE9wdGlvbnMgb2JqZWN0LlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyB3aGVuIGNvbXBsZXRlLlxuICAgKi9cbiAgYXN5bmMgZHJvcFRhYmxlKHRhYmxlTmFtZSwgYXJncyA9IHt9KSB7XG4gICAgdGhpcy5fYXNzZXJ0Tm90UmVhZE9ubHkoKVxuICAgIGF3YWl0IHRoaXMuX2Ryb3BSZWZlcmVuY2luZ0ZvcmVpZ25LZXlzKHRhYmxlTmFtZSlcblxuICAgIGNvbnN0IHNxbHMgPSBhd2FpdCB0aGlzLmRyb3BUYWJsZVNRTHModGFibGVOYW1lLCBhcmdzKVxuXG4gICAgZm9yIChjb25zdCBzcWwgb2Ygc3Fscykge1xuICAgICAgYXdhaXQgdGhpcy5xdWVyeShzcWwpXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZ2V0IHR5cGUuXG4gICAqIEByZXR1cm5zIHtzdHJpbmd9IC0gVGhlIHR5cGUuXG4gICAqL1xuICBnZXRUeXBlKCkgeyByZXR1cm4gXCJtc3NxbFwiIH1cblxuICAvKipcbiAgICogUnVucyBxdWVyeSBhY3R1YWwuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBzcWwgLSBTUUwgc3RyaW5nLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxpbXBvcnQoXCIuLi9iYXNlLmpzXCIpLlF1ZXJ5UmVzdWx0VHlwZT59IC0gUmVzb2x2ZXMgd2l0aCB0aGUgcXVlcnkgYWN0dWFsLlxuICAgKi9cbiAgYXN5bmMgX3F1ZXJ5QWN0dWFsKHNxbCkge1xuICAgIGxldCByZXN1bHRcbiAgICBsZXQgdHJpZXMgPSAwXG5cbiAgICB3aGlsZSAodHJ1ZSkge1xuICAgICAgdHJpZXMrK1xuXG4gICAgICB0cnkge1xuICAgICAgICBjb25zdCByZXF1ZXN0ID0gdGhpcy5fY3VycmVudFRyYW5zYWN0aW9uXG4gICAgICAgICAgPyBuZXcgbXNzcWwuUmVxdWVzdCh0aGlzLl9jdXJyZW50VHJhbnNhY3Rpb24pXG4gICAgICAgICAgOiBuZXcgbXNzcWwuUmVxdWVzdCh0aGlzLmNvbm5lY3Rpb24pXG4gICAgICAgIHJlc3VsdCA9IGF3YWl0IHJlcXVlc3QucXVlcnkoc3FsKVxuICAgICAgICBicmVha1xuICAgICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgICAgaWYgKGVycm9yIGluc3RhbmNlb2YgRXJyb3IgJiYgZXJyb3IubWVzc2FnZSA9PSBcIk5vIGNvbm5lY3Rpb24gaXMgc3BlY2lmaWVkIGZvciB0aGF0IHJlcXVlc3QuXCIgJiYgdHJpZXMgPD0gMykge1xuICAgICAgICAgIHRoaXMubG9nZ2VyLndhcm4oXCJSZWNvbm5lY3RpbmcgdG8gZGF0YWJhc2VcIilcbiAgICAgICAgICBhd2FpdCB0aGlzLnJlY29ubmVjdCgpXG4gICAgICAgICAgLy8gUmV0cnlcbiAgICAgICAgfSBlbHNlIGlmIChlcnJvciBpbnN0YW5jZW9mIEVycm9yKSB7XG4gICAgICAgICAgLy8gUmUtdGhyb3cgZXJyb3IgYmVjYXVzZSB0aGUgc3RhY2stdHJhY2UgaXMgYnJva2VuIGFuZCBjYW4ndCBiZSB1c2VkIGZvciBhcHAtZGV2ZWxvcG1lbnQuXG4gICAgICAgICAgdGhyb3cgbmV3IEVycm9yKGBRdWVyeSBmYWlsZWQgJyR7ZXJyb3IubWVzc2FnZX0nOiAke3NxbH1gLCB7Y2F1c2U6IGVycm9yfSlcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoYFF1ZXJ5IGZhaWxlZCAnJHtlcnJvcn0nOiAke3NxbH1gLCB7Y2F1c2U6IGVycm9yfSlcbiAgICAgICAgfVxuICAgICAgfVxuICAgIH1cblxuICAgIHJldHVybiBBcnJheS5pc0FycmF5KHJlc3VsdC5yZWNvcmRzZXRzKSA/IHJlc3VsdC5yZWNvcmRzZXRzWzBdIHx8IFtdIDogW11cbiAgfVxuXG4gIC8qKlxuICAgKiBFeGVjdXRlcyBhIG11dGF0aW9uIHdpdGggYWZmZWN0ZWQtcm93IG1ldGFkYXRhLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gc3FsIC0gTXV0YXRpb24gU1FMLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxudW1iZXI+fSAtIEFmZmVjdGVkIHJvdyBjb3VudC5cbiAgICovXG4gIGFzeW5jIF9hZmZlY3RlZFJvd3NBY3R1YWwoc3FsKSB7XG4gICAgY29uc3QgcmVxdWVzdCA9IHRoaXMuX2N1cnJlbnRUcmFuc2FjdGlvblxuICAgICAgPyBuZXcgbXNzcWwuUmVxdWVzdCh0aGlzLl9jdXJyZW50VHJhbnNhY3Rpb24pXG4gICAgICA6IG5ldyBtc3NxbC5SZXF1ZXN0KHRoaXMuY29ubmVjdGlvbilcbiAgICBjb25zdCByZXN1bHQgPSBhd2FpdCByZXF1ZXN0LnF1ZXJ5KHNxbClcbiAgICByZXR1cm4gcmVzdWx0LnJvd3NBZmZlY3RlZC5yZWR1Y2UoKHRvdGFsLCBjb3VudCkgPT4gdG90YWwgKyBjb3VudCwgMClcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHF1ZXJ5IHRvIHNxbC5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi8uLi9xdWVyeS9pbmRleC5qc1wiKS5kZWZhdWx0fSBxdWVyeSAtIFF1ZXJ5IGluc3RhbmNlLlxuICAgKiBAcmV0dXJucyB7c3RyaW5nfSAtIFNRTCBzdHJpbmcuXG4gICAqL1xuICBxdWVyeVRvU3FsKHF1ZXJ5KSB7IHJldHVybiBuZXcgUXVlcnlQYXJzZXIoe3F1ZXJ5fSkudG9TcWwoKSB9XG5cbiAgc2hvdWxkU2V0QXV0b0luY3JlbWVudFdoZW5QcmltYXJ5S2V5KCkgeyByZXR1cm4gdHJ1ZSB9XG4gIHN1cHBvcnRzRGVmYXVsdFByaW1hcnlLZXlVVUlEKCkgeyByZXR1cm4gdHJ1ZSB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgYW4gZXhwbGljaXQgcHJpbWFyeS1rZXkgaW5zZXJ0IGFzIG9uZSBiYXRjaCByZXF1ZXN0OiBTUUwgU2VydmVyIHNjb3Blc1xuICAgKiBJREVOVElUWV9JTlNFUlQgdG8gdGhlIHNlc3Npb24sIGFuZCBub2RlLW1zc3FsIHBvb2wtYmFja2VkIHJlcXVlc3RzIG1heSB1c2VcbiAgICogYSBkaWZmZXJlbnQgcGh5c2ljYWwgc2Vzc2lvbiBwZXIgcXVlcnksIHNvIGVuYWJsaW5nIGl0IGluIGEgc2VwYXJhdGUgcXVlcnlcbiAgICogY2FuIGxlYXZlIHRoZSBhY3R1YWwgSU5TRVJUIG9uIGFub3RoZXIgc2Vzc2lvbi4gQSBzaW5nbGUgYmF0Y2gga2VlcHMgdGhlXG4gICAqIHdob2xlIHNlcXVlbmNlIG9uIG9uZSBzZXNzaW9uIGJ5IGNvbnN0cnVjdGlvbjogZW5hYmxlLCBpbnNlcnQsIGRpc2FibGUgb25cbiAgICogc3VjY2VzcywgYW5kIGEgQ0FUQ0ggdGhhdCBkaXNhYmxlcyBhbmQgcmV0aHJvd3MgdGhlIG9yaWdpbmFsIGVycm9yLlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIE9wdGlvbnMgb2JqZWN0LlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL2Jhc2UuanNcIikuUXVlcnlPcHRpb25zfSBhcmdzLm9wdGlvbnMgLSBRdWVyeSBvcHRpb25zIGZvciB0aGUgc3RhbmRhcmQgcXVlcnkgcGF0aC5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGFyZ3Muc3FsIC0gR2VuZXJhdGVkIGluc2VydCBTUUwuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBhcmdzLnRhYmxlTmFtZSAtIFRhYmxlIGJlaW5nIGluc2VydGVkIGludG8uXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPGltcG9ydChcIi4uL2Jhc2UuanNcIikuUXVlcnlSZXN1bHRUeXBlPn0gLSBJbnNlcnQgcmVzdWx0LlxuICAgKi9cbiAgYXN5bmMgaW5zZXJ0V2l0aEV4cGxpY2l0UHJpbWFyeUtleSh7b3B0aW9ucywgc3FsLCB0YWJsZU5hbWV9KSB7XG4gICAgY29uc3QgcXVvdGVkVGFibGUgPSB0aGlzLnF1b3RlVGFibGUodGFibGVOYW1lKVxuICAgIGNvbnN0IGJhdGNoID0gW1xuICAgICAgYFNFVCBJREVOVElUWV9JTlNFUlQgJHtxdW90ZWRUYWJsZX0gT047YCxcbiAgICAgIFwiQkVHSU4gVFJZXCIsXG4gICAgICBgJHtzcWx9O2AsXG4gICAgICBgU0VUIElERU5USVRZX0lOU0VSVCAke3F1b3RlZFRhYmxlfSBPRkY7YCxcbiAgICAgIFwiRU5EIFRSWVwiLFxuICAgICAgXCJCRUdJTiBDQVRDSFwiLFxuICAgICAgYFNFVCBJREVOVElUWV9JTlNFUlQgJHtxdW90ZWRUYWJsZX0gT0ZGO2AsXG4gICAgICBcIlRIUk9XO1wiLFxuICAgICAgXCJFTkQgQ0FUQ0hcIlxuICAgIF0uam9pbihcIlxcblwiKVxuXG4gICAgcmV0dXJuIGF3YWl0IHRoaXMucXVlcnkoYmF0Y2gsIG9wdGlvbnMpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBlc2NhcGUuXG4gICAqIEBwYXJhbSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59IHZhbHVlIC0gVmFsdWUgdG8gdXNlLlxuICAgKiBAcmV0dXJucyB7c3RyaW5nfSAtIFRoZSBlc2NhcGUuXG4gICAqL1xuICBlc2NhcGUodmFsdWUpIHtcbiAgICB2YWx1ZSA9IHRoaXMuX2NvbnZlcnRWYWx1ZSh2YWx1ZSlcbiAgICBjb25zdCBzdHJpbmdWYWx1ZSA9IHR5cGVvZiB2YWx1ZSA9PSBcInN0cmluZ1wiID8gdmFsdWUgOiBgJHt2YWx1ZX1gXG5cbiAgICBjb25zdCByZXN1bHRXaXRoUXVvdGVzID0gZXNjYXBlU3RyaW5nKHN0cmluZ1ZhbHVlLCBudWxsKVxuICAgIGNvbnN0IHJlc3VsdCA9IHJlc3VsdFdpdGhRdW90ZXMuc3Vic3RyaW5nKDEsIHJlc3VsdFdpdGhRdW90ZXMubGVuZ3RoIC0gMSlcblxuICAgIHJldHVybiByZXN1bHRcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHF1b3RlLlxuICAgKiBAcGFyYW0ge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSB2YWx1ZSAtIFZhbHVlIHRvIHVzZS5cbiAgICogQHJldHVybnMge3N0cmluZyB8IG51bWJlcn0gLSBUaGUgcXVvdGVkIHZhbHVlLlxuICAgKi9cbiAgcXVvdGUodmFsdWUpIHtcbiAgICB2YWx1ZSA9IHRoaXMuX2NvbnZlcnRWYWx1ZSh2YWx1ZSlcblxuICAgIGlmICh0eXBlb2YgdmFsdWUgPT0gXCJudW1iZXJcIikgcmV0dXJuIHZhbHVlXG4gICAgY29uc3Qgc3RyaW5nVmFsdWUgPSB0eXBlb2YgdmFsdWUgPT0gXCJzdHJpbmdcIiA/IHZhbHVlIDogU3RyaW5nKHZhbHVlKVxuXG4gICAgcmV0dXJuIGBOJHtlc2NhcGVTdHJpbmcoc3RyaW5nVmFsdWUsIG51bGwpfWBcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHF1b3RlIGNvbHVtbi5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGNvbHVtbk5hbWUgLSBDb2x1bW4gbmFtZS5cbiAgICogQHJldHVybnMge3N0cmluZ30gLSBUaGUgcXVvdGUgY29sdW1uLlxuICAgKi9cbiAgcXVvdGVDb2x1bW4oY29sdW1uTmFtZSkgeyByZXR1cm4gdGhpcy5vcHRpb25zKCkucXVvdGVDb2x1bW5OYW1lKGNvbHVtbk5hbWUpIH1cblxuICAvKipcbiAgICogUnVucyBxdW90ZSB0YWJsZS5cbiAgICogQHBhcmFtIHtzdHJpbmd9IHN0cmluZyAtIFN0cmluZy5cbiAgICogQHJldHVybnMge3N0cmluZ30gLSBUaGUgcXVvdGUgdGFibGUuXG4gICAqL1xuICBxdW90ZVRhYmxlKHN0cmluZykgeyByZXR1cm4gdGhpcy5vcHRpb25zKCkucXVvdGVUYWJsZU5hbWUoc3RyaW5nKSB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgcmVuYW1lIGNvbHVtbi5cbiAgICogQHBhcmFtIHtzdHJpbmd9IHRhYmxlTmFtZSAtIFRhYmxlIG5hbWUuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBvbGRDb2x1bW5OYW1lIC0gUHJldmlvdXMgY29sdW1uIG5hbWUuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBuZXdDb2x1bW5OYW1lIC0gTmV3IGNvbHVtbiBuYW1lLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyB3aGVuIGNvbXBsZXRlLlxuICAgKi9cbiAgYXN5bmMgcmVuYW1lQ29sdW1uKHRhYmxlTmFtZSwgb2xkQ29sdW1uTmFtZSwgbmV3Q29sdW1uTmFtZSkge1xuICAgIGF3YWl0IHRoaXMucXVlcnkoYEVYRUMgc3BfcmVuYW1lICR7dGhpcy5xdW90ZShgJHt0YWJsZU5hbWV9LiR7b2xkQ29sdW1uTmFtZX1gKX0sICR7dGhpcy5xdW90ZShuZXdDb2x1bW5OYW1lKX0sICdDT0xVTU4nYClcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGRlbGV0ZSBzcWwuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vYmFzZS5qc1wiKS5EZWxldGVTcWxBcmdzVHlwZX0gYXJncyAtIE9wdGlvbnMgb2JqZWN0LlxuICAgKiBAcmV0dXJucyB7c3RyaW5nfSAtIFNRTCBzdHJpbmcuXG4gICAqL1xuICBkZWxldGVTcWwoe3RhYmxlTmFtZSwgY29uZGl0aW9uc30pIHtcbiAgICBjb25zdCBkZWxldGVJbnN0cnVjdGlvbiA9IG5ldyBEZWxldGUoe2NvbmRpdGlvbnMsIGRyaXZlcjogdGhpcywgdGFibGVOYW1lfSlcblxuICAgIHJldHVybiBkZWxldGVJbnN0cnVjdGlvbi50b1NxbCgpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBpbnNlcnQgc3FsLlxuICAgKiBAYWJzdHJhY3RcbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9iYXNlLmpzXCIpLkluc2VydFNxbEFyZ3NUeXBlfSBhcmdzIC0gT3B0aW9ucyBvYmplY3QuXG4gICAqIEByZXR1cm5zIHtzdHJpbmd9IC0gU1FMIHN0cmluZy5cbiAgICovXG4gIGluc2VydFNxbChhcmdzKSB7XG4gICAgY29uc3QgaW5zZXJ0QXJncyA9IE9iamVjdC5hc3NpZ24oe2RyaXZlcjogdGhpc30sIGFyZ3MpXG4gICAgY29uc3QgaW5zZXJ0ID0gbmV3IEluc2VydChpbnNlcnRBcmdzKVxuXG4gICAgcmV0dXJuIGluc2VydC50b1NxbCgpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBnZXQgdGFibGVzLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxBcnJheTxpbXBvcnQoXCIuLi9iYXNlLXRhYmxlLmpzXCIpLmRlZmF1bHQ+Pn0gLSBSZXNvbHZlcyB3aXRoIHRoZSB0YWJsZXMuXG4gICAqL1xuICBhc3luYyBnZXRUYWJsZXMoKSB7XG4gICAgcmV0dXJuIGF3YWl0IHRoaXMuX2NhY2hlZFNjaGVtYU1ldGFkYXRhKFwidGFibGVzXCIsIGFzeW5jICgpID0+IHtcbiAgICAgIGNvbnN0IHNjaGVtYSA9IHRoaXMuZ2V0QXJncygpPy5zY2hlbWEgfHwgdGhpcy5nZXRBcmdzKCk/LnNxbENvbmZpZz8ub3B0aW9ucz8uc2NoZW1hXG4gICAgICBjb25zdCBzY2hlbWFDbGF1c2UgPSBzY2hlbWFcbiAgICAgICAgPyBgIEFORCBbVEFCTEVfU0NIRU1BXSA9ICR7dGhpcy5xdW90ZShzY2hlbWEpfWBcbiAgICAgICAgOiBcIiBBTkQgW1RBQkxFX1NDSEVNQV0gPSBTQ0hFTUFfTkFNRSgpXCJcbiAgICAgIGNvbnN0IHJlc3VsdCA9IGF3YWl0IHRoaXMucXVlcnkoYFNFTEVDVCBbVEFCTEVfTkFNRV0gRlJPTSBbSU5GT1JNQVRJT05fU0NIRU1BXS5bVEFCTEVTXSBXSEVSRSBbVEFCTEVfQ0FUQUxPR10gPSBEQl9OQU1FKCkke3NjaGVtYUNsYXVzZX1gKVxuICAgICAgY29uc3QgdGFibGVzID0gW11cblxuICAgICAgZm9yIChjb25zdCByb3cgb2YgcmVzdWx0KSB7XG4gICAgICAgIGNvbnN0IHRhYmxlID0gbmV3IFRhYmxlKHRoaXMsIC8qKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgc3RyaW5nPn0gKi8gKHJvdykpXG5cbiAgICAgICAgdGFibGVzLnB1c2godGFibGUpXG4gICAgICB9XG5cbiAgICAgIHJldHVybiB0YWJsZXNcbiAgICB9KVxuICB9XG5cbiAgLyoqXG4gICAqIFRydW5jYXRlcyBhbGwgZWxpZ2libGUgdGFibGVzIGluIG9uZSBTUUwgU2VydmVyIHJlcXVlc3QsIHJldGFpbmluZyB0aGVcbiAgICogcmVjb2duaXplZCBmb3JlaWduLWtleSBmYWxsYmFjayB1c2VkIGJ5IHRoZSBwZXItdGFibGUgaW1wbGVtZW50YXRpb24uXG4gICAqIEBwYXJhbSB7QXJyYXk8aW1wb3J0KFwiLi4vYmFzZS10YWJsZS5qc1wiKS5kZWZhdWx0Pn0gdGFibGVzIC0gRWxpZ2libGUgdGFibGVzLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyB3aGVuIHRoZSBiYXRjaCBjb21wbGV0ZXMuXG4gICAqL1xuICBhc3luYyB0cnVuY2F0ZVRhYmxlcyh0YWJsZXMpIHtcbiAgICBjb25zdCBzdGF0ZW1lbnRzID0gW11cblxuICAgIGZvciAoY29uc3QgdGFibGUgb2YgdGFibGVzKSB7XG4gICAgICBjb25zdCBxdW90ZWRUYWJsZSA9IHRoaXMucXVvdGVUYWJsZSh0YWJsZS5nZXROYW1lKCkpXG5cbiAgICAgIHN0YXRlbWVudHMucHVzaChcbiAgICAgICAgXCJCRUdJTiBUUllcIixcbiAgICAgICAgYCAgVFJVTkNBVEUgVEFCTEUgJHtxdW90ZWRUYWJsZX07YCxcbiAgICAgICAgXCJFTkQgVFJZXCIsXG4gICAgICAgIFwiQkVHSU4gQ0FUQ0hcIixcbiAgICAgICAgXCIgIElGIEVSUk9SX05VTUJFUigpID0gNDcxMlwiLFxuICAgICAgICBcIiAgQkVHSU5cIixcbiAgICAgICAgYCAgICBERUxFVEUgRlJPTSAke3F1b3RlZFRhYmxlfTtgLFxuICAgICAgICBcIiAgRU5EXCIsXG4gICAgICAgIFwiICBFTFNFXCIsXG4gICAgICAgIFwiICBCRUdJTlwiLFxuICAgICAgICBcIiAgICBUSFJPVztcIixcbiAgICAgICAgXCIgIEVORFwiLFxuICAgICAgICBcIkVORCBDQVRDSDtcIlxuICAgICAgKVxuICAgIH1cblxuICAgIGF3YWl0IHRoaXMucXVlcnkoc3RhdGVtZW50cy5qb2luKFwiXFxuXCIpKVxuICB9XG5cbiAgYXN5bmMgbGFzdEluc2VydElEKG9wdGlvbnMgPSB7fSkge1xuICAgIGNvbnN0IHJlc3VsdCA9IGF3YWl0IHRoaXMucXVlcnkoXCJTRUxFQ1QgU0NPUEVfSURFTlRJVFkoKSBBUyBsYXN0X2luc2VydF9pZFwiLCBvcHRpb25zKVxuICAgIGNvbnN0IGxhc3RJbnNlcnRJRCA9IGRpZ2cocmVzdWx0LCAwLCBcImxhc3RfaW5zZXJ0X2lkXCIpXG5cbiAgICBpZiAobGFzdEluc2VydElEID09PSBudWxsKSB0aHJvdyBuZXcgRXJyb3IoXCJDb3VsZG4ndCBnZXQgdGhlIGxhc3QgaW5zZXJ0ZWQgSURcIilcblxuICAgIHJldHVybiBsYXN0SW5zZXJ0SURcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIG9wdGlvbnMuXG4gICAqIEByZXR1cm5zIHtPcHRpb25zfSAtIFRoZSBvcHRpb25zIG9wdGlvbnMuXG4gICAqL1xuICBvcHRpb25zKCkge1xuICAgIGlmICghdGhpcy5fb3B0aW9ucykgdGhpcy5fb3B0aW9ucyA9IG5ldyBPcHRpb25zKHtkcml2ZXI6IHRoaXN9KVxuXG4gICAgcmV0dXJuIHRoaXMuX29wdGlvbnNcbiAgfVxuXG4gIGFzeW5jIF9zdGFydFRyYW5zYWN0aW9uQWN0aW9uKCkge1xuICAgIGF3YWl0IHRoaXMuX3J1blBoeXNpY2FsQ29ubmVjdGlvblJlcXVlc3QoYXN5bmMgKCkgPT4ge1xuICAgICAgaWYgKHRoaXMuX2N1cnJlbnRUcmFuc2FjdGlvbikgdGhyb3cgbmV3IEVycm9yKFwiQSB0cmFuc2FjdGlvbiBpcyBhbHJlYWR5IHJ1bm5pbmdcIilcbiAgICAgIGlmICghdGhpcy5jb25uZWN0aW9uKSBhd2FpdCB0aGlzLmNvbm5lY3QoKVxuXG4gICAgICB0aGlzLl9jdXJyZW50VHJhbnNhY3Rpb24gPSBuZXcgbXNzcWwuVHJhbnNhY3Rpb24odGhpcy5jb25uZWN0aW9uKVxuXG4gICAgICB0cnkge1xuICAgICAgICBhd2FpdCB0aGlzLl9jdXJyZW50VHJhbnNhY3Rpb24uYmVnaW4oKVxuICAgICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgICAgdGhpcy5fY3VycmVudFRyYW5zYWN0aW9uID0gbnVsbFxuICAgICAgICB0aHJvdyBlcnJvclxuICAgICAgfVxuICAgIH0pXG4gIH1cblxuICBhc3luYyBfY29tbWl0VHJhbnNhY3Rpb25BY3Rpb24oKSB7XG4gICAgYXdhaXQgdGhpcy5fcnVuUGh5c2ljYWxDb25uZWN0aW9uUmVxdWVzdChhc3luYyAoKSA9PiB7XG4gICAgICBpZiAoIXRoaXMuX2N1cnJlbnRUcmFuc2FjdGlvbikgdGhyb3cgbmV3IEVycm9yKFwiQSB0cmFuc2FjdGlvbiBpc24ndCBydW5uaW5nXCIpXG5cbiAgICAgIGF3YWl0IHRoaXMuX2N1cnJlbnRUcmFuc2FjdGlvbi5jb21taXQoKVxuICAgICAgdGhpcy5fY3VycmVudFRyYW5zYWN0aW9uID0gbnVsbFxuICAgIH0pXG4gIH1cblxuICBhc3luYyBfcm9sbGJhY2tUcmFuc2FjdGlvbkFjdGlvbigpIHtcbiAgICBhd2FpdCB0aGlzLl9ydW5QaHlzaWNhbENvbm5lY3Rpb25SZXF1ZXN0KGFzeW5jICgpID0+IHtcbiAgICAgIGlmICghdGhpcy5fY3VycmVudFRyYW5zYWN0aW9uKSB7XG4gICAgICAgIHRoaXMubG9nZ2VyLmRlYnVnKFwiQSB0cmFuc2FjdGlvbiBpc24ndCBydW5uaW5nIC0gaWdub3JpbmcgYmVjYXVzZSB0aGF0IGNhbiBoYXBwZW4gaWYgc29tZXRoaW5nIGVsc2UgaGFzIGZhaWxlZCBpbiB0aGUgZGJcIilcbiAgICAgICAgcmV0dXJuXG4gICAgICB9XG5cbiAgICAgIHRyeSB7XG4gICAgICAgIGF3YWl0IHRoaXMuX2N1cnJlbnRUcmFuc2FjdGlvbi5yb2xsYmFjaygpXG4gICAgICB9IGNhdGNoICh0cmFuc2FjdGlvblJvbGxiYWNrRXJyb3IpIHtcbiAgICAgICAgLy8gV2hlbiBTUUwgU2VydmVyIGhhcyBhbHJlYWR5IGFib3J0ZWQgdGhlIHRyYW5zYWN0aW9uIChlLmcuLCBhXG4gICAgICAgIC8vIHN0YWxlIGNvbmN1cnJlbnQgcmVxdWVzdCB0cmlnZ2VyZWQgWEFDVF9BQk9SVCksIHRoZVxuICAgICAgICAvLyBtc3NxbC5UcmFuc2FjdGlvbi5yb2xsYmFjaygpIGNhbGwgZmFpbHMgYmVjYXVzZSB0aGVcbiAgICAgICAgLy8gVHJhbnNhY3Rpb24gb2JqZWN0IGlzIGRlYWQuICBJc3N1ZSBhIHJhdyBST0xMQkFDSyBvbiB0aGVcbiAgICAgICAgLy8gdW5kZXJseWluZyBjb25uZWN0aW9uIHRvIGNsZWFyIFNRTCBTZXJ2ZXIncyBzZXNzaW9uLWxldmVsXG4gICAgICAgIC8vIGFib3J0ZWQtdHJhbnNhY3Rpb24gc3RhdGUgc28gdGhlIGNvbm5lY3Rpb24gaXMgdXNhYmxlIGZvciB0aGVcbiAgICAgICAgLy8gbmV4dCBCRUdJTiBUUkFOU0FDVElPTi5cbiAgICAgICAgdGhpcy5sb2dnZXIud2FybihcIlRyYW5zYWN0aW9uLnJvbGxiYWNrKCkgZmFpbGVkLCBjbGVhcmluZyBzZXNzaW9uIHN0YXRlIHdpdGggcmF3IFJPTExCQUNLXCIsIHtcbiAgICAgICAgICBlcnJvcjogdHJhbnNhY3Rpb25Sb2xsYmFja0Vycm9yIGluc3RhbmNlb2YgRXJyb3IgPyB0cmFuc2FjdGlvblJvbGxiYWNrRXJyb3IubWVzc2FnZSA6IHRyYW5zYWN0aW9uUm9sbGJhY2tFcnJvclxuICAgICAgICB9KVxuXG4gICAgICAgIGNvbnN0IHJlcXVlc3QgPSBuZXcgbXNzcWwuUmVxdWVzdCh0aGlzLmNvbm5lY3Rpb24pXG5cbiAgICAgICAgYXdhaXQgcmVxdWVzdC5xdWVyeShcIklGIEBAVFJBTkNPVU5UID4gMCBST0xMQkFDS1wiKVxuICAgICAgfSBmaW5hbGx5IHtcbiAgICAgICAgdGhpcy5fY3VycmVudFRyYW5zYWN0aW9uID0gbnVsbFxuICAgICAgfVxuICAgIH0pXG4gIH1cblxuICAvKipcbiAgICogUnVucyBzdGFydCBzYXZlIHBvaW50IGFjdGlvbi5cbiAgICogQHBhcmFtIHtzdHJpbmd9IHNhdmVQb2ludE5hbWUgLSBTYXZlIHBvaW50IG5hbWUuXG4gICAqIEBwYXJhbSB7UGljazxpbXBvcnQoXCIuLi9iYXNlLmpzXCIpLlF1ZXJ5T3B0aW9ucywgXCJvcGVyYXRpb25Pd25lclwiPn0gW29wdGlvbnNdIC0gVHJhbnNhY3Rpb24gb3duZXJzaGlwLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyB3aGVuIGNvbXBsZXRlLlxuICAgKi9cbiAgYXN5bmMgX3N0YXJ0U2F2ZVBvaW50QWN0aW9uKHNhdmVQb2ludE5hbWUsIG9wdGlvbnMgPSB7fSkge1xuICAgIGF3YWl0IHRoaXMucXVlcnkoYFNBVkUgVFJBTlNBQ1RJT04gWyR7c2F2ZVBvaW50TmFtZX1dYCwgb3B0aW9ucylcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHJlbGVhc2Ugc2F2ZSBwb2ludCBhY3Rpb24uXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBzYXZlUG9pbnROYW1lIC0gU2F2ZSBwb2ludCBuYW1lLlxuICAgKiBAcGFyYW0ge1BpY2s8aW1wb3J0KFwiLi4vYmFzZS5qc1wiKS5RdWVyeU9wdGlvbnMsIFwib3BlcmF0aW9uT3duZXJcIj59IFtfb3B0aW9uc10gLSBUcmFuc2FjdGlvbiBvd25lcnNoaXAuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIHdoZW4gY29tcGxldGUuXG4gICAqL1xuICBhc3luYyBfcmVsZWFzZVNhdmVQb2ludEFjdGlvbihzYXZlUG9pbnROYW1lLCBfb3B0aW9ucyA9IHt9KSB7XG4gICAgLy8gRG8gbm90aGluZyBpbiBNUy1TUUwuXG4gIH1cblxuICAvKipcbiAgICogUnVucyByb2xsYmFjayBzYXZlIHBvaW50IGFjdGlvbi5cbiAgICogQHBhcmFtIHtzdHJpbmd9IHNhdmVQb2ludE5hbWUgLSBTYXZlIHBvaW50IG5hbWUuXG4gICAqIEBwYXJhbSB7UGljazxpbXBvcnQoXCIuLi9iYXNlLmpzXCIpLlF1ZXJ5T3B0aW9ucywgXCJvcGVyYXRpb25Pd25lclwiPn0gW29wdGlvbnNdIC0gVHJhbnNhY3Rpb24gb3duZXJzaGlwLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyB3aGVuIGNvbXBsZXRlLlxuICAgKi9cbiAgYXN5bmMgX3JvbGxiYWNrU2F2ZVBvaW50QWN0aW9uKHNhdmVQb2ludE5hbWUsIG9wdGlvbnMgPSB7fSkge1xuICAgIHRyeSB7XG4gICAgICBhd2FpdCB0aGlzLnF1ZXJ5KGBST0xMQkFDSyBUUkFOU0FDVElPTiBbJHtzYXZlUG9pbnROYW1lfV1gLCBvcHRpb25zKVxuICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICBjb25zdCBtZXNzYWdlID0gZXJyb3IgaW5zdGFuY2VvZiBFcnJvciA/IGVycm9yLm1lc3NhZ2UgOiBgJHtlcnJvcn1gXG5cbiAgICAgIC8vIFdoZW4gWEFDVF9BQk9SVCBraWxscyB0aGUgZW50aXJlIHRyYW5zYWN0aW9uLCB0aGUgc2F2ZXBvaW50XG4gICAgICAvLyBubyBsb25nZXIgZXhpc3RzIGFuZCB0aGUgUk9MTEJBQ0sgVFJBTlNBQ1RJT04gW25hbWVdIGZhaWxzLlxuICAgICAgLy8gSXNzdWUgYSByYXcgSUYgQEBUUkFOQ09VTlQgPiAwIFJPTExCQUNLIHRvIGNsZWFyIHdoYXRldmVyXG4gICAgICAvLyBzZXNzaW9uIHN0YXRlIHJlbWFpbnMsIHRoZW4gbGV0IHRoZSBlcnJvciBwcm9wYWdhdGUgc28gdGhlXG4gICAgICAvLyBvdXRlciB0cmFuc2FjdGlvbigpIGNhbGwga25vd3MgdGhlIHRyYW5zYWN0aW9uIGlzIGRlYWQuXG4gICAgICBpZiAobWVzc2FnZS5pbmNsdWRlcyhcIlRyYW5zYWN0aW9uIGhhcyBub3QgYmVndW5cIikgfHwgbWVzc2FnZS5pbmNsdWRlcyhcIlRyYW5zYWN0aW9uIGhhcyBiZWVuIGFib3J0ZWRcIikpIHtcbiAgICAgICAgdGhpcy5sb2dnZXIuZGVidWcoXCJTYXZlcG9pbnQgcm9sbGJhY2sgZmFpbGVkOyB0cmFuc2FjdGlvbiBhbHJlYWR5IGRlYWQsIGNsZWFyaW5nIHNlc3Npb24gc3RhdGVcIilcblxuICAgICAgICBjb25zdCByZXF1ZXN0ID0gbmV3IG1zc3FsLlJlcXVlc3QodGhpcy5jb25uZWN0aW9uKVxuXG4gICAgICAgIGF3YWl0IHJlcXVlc3QucXVlcnkoXCJJRiBAQFRSQU5DT1VOVCA+IDAgUk9MTEJBQ0tcIilcblxuICAgICAgICByZXR1cm5cbiAgICAgIH1cblxuICAgICAgdGhyb3cgZXJyb3JcbiAgICB9XG4gIH1cblxuICBnZW5lcmF0ZVNhdmVQb2ludE5hbWUoKSB7XG4gICAgcmV0dXJuIGBzcCR7bmV3IFVVSUQoNCkuZm9ybWF0KCkucmVwbGFjZUFsbChcIi1cIiwgXCJcIil9YC5zdWJzdHJpbmcoMCwgMzIpXG4gIH1cblxuICAvKipcbiAgICogUnVucyB1cGRhdGUgc3FsLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL2Jhc2UuanNcIikuVXBkYXRlU3FsQXJnc1R5cGV9IGFyZ3MgLSBPcHRpb25zIG9iamVjdC5cbiAgICogQHJldHVybnMge3N0cmluZ30gLSBTUUwgc3RyaW5nLlxuICAgKi9cbiAgdXBkYXRlU3FsKHtjb25kaXRpb25zLCBkYXRhLCB0YWJsZU5hbWV9KSB7XG4gICAgY29uc3QgdXBkYXRlID0gbmV3IFVwZGF0ZSh7Y29uZGl0aW9ucywgZGF0YSwgZHJpdmVyOiB0aGlzLCB0YWJsZU5hbWV9KVxuXG4gICAgcmV0dXJuIHVwZGF0ZS50b1NxbCgpXG4gIH1cblxuICAvKipcbiAgICogUnVucyB1cHNlcnQgc3FsLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL2Jhc2UuanNcIikuVXBzZXJ0U3FsQXJnc1R5cGV9IGFyZ3MgLSBPcHRpb25zIG9iamVjdC5cbiAgICogQHJldHVybnMge3N0cmluZ30gLSBTUUwgc3RyaW5nLlxuICAgKi9cbiAgdXBzZXJ0U3FsKGFyZ3MpIHtcbiAgICBjb25zdCB1cHNlcnQgPSBuZXcgVXBzZXJ0KHsuLi5hcmdzLCBkcml2ZXI6IHRoaXN9KVxuXG4gICAgcmV0dXJuIHVwc2VydC50b1NxbCgpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBzdHJ1Y3R1cmUgc3FsLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxzdHJpbmcgfCBudWxsPn0gLSBSZXNvbHZlcyB3aXRoIFNRTCBzdHJpbmcuXG4gICAqL1xuICBhc3luYyBzdHJ1Y3R1cmVTcWwoKSB7XG4gICAgcmV0dXJuIGF3YWl0IHRoaXMuX2NhY2hlZFNjaGVtYU1ldGFkYXRhKFwic3RydWN0dXJlU3FsXCIsIGFzeW5jICgpID0+IGF3YWl0IG5ldyBTdHJ1Y3R1cmVTcWwoe2RyaXZlcjogdGhpc30pLnRvU3FsKCkpXG4gIH1cblxuICAvKipcbiAgICogQmxvY2tzIHVudGlsIGEgU1FMIFNlcnZlciBhcHBsaWNhdGlvbiBsb2NrIGlzIGFjcXVpcmVkIG9uIHRoaXNcbiAgICogY29ubmVjdGlvbiB2aWEgYHNwX2dldGFwcGxvY2tgLiBUaGUgU2Vzc2lvbiBsb2NrIG93bmVyIHNjb3BlcyB0aGUgbG9ja1xuICAgKiB0byB0aGUgY3VycmVudCBzZXNzaW9uLCBtYXRjaGluZyB0aGUgY29ubmVjdGlvbi1zY29wZWQgc2VtYW50aWNzIG9uXG4gICAqIE15U1FMIGFuZCBQb3N0Z3JlU1FMLlxuICAgKlxuICAgKiBgc3BfZ2V0YXBwbG9ja2AgcmV0dXJucyAwIG9uIGltbWVkaWF0ZSBncmFudCwgMSBhZnRlciB3YWl0aW5nLCBhbmRcbiAgICogbmVnYXRpdmUgdmFsdWVzIG9uIGZhaWx1cmUgKHRpbWVvdXQsIGRlYWRsb2NrLCBjYW5jZWxlZCwgcGFyYW1ldGVyXG4gICAqIGVycm9yKS4gV2UgdHJlYXQgMC8xIGFzIHN1Y2Nlc3MgYW5kIC0xICh0aW1lb3V0KSBhcyBhIGNsZWFuIGBmYWxzZWA7XG4gICAqIGFueXRoaW5nIGVsc2UgdGhyb3dzLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gbmFtZSAtIExvY2sgbmFtZS5cbiAgICogQHBhcmFtIHt7dGltZW91dE1zPzogbnVtYmVyIHwgbnVsbH19IFthcmdzXSAtIE9wdGlvbmFsIHRpbWVvdXQgaW4gbWlsbGlzZWNvbmRzOyBgbnVsbGAsIGB1bmRlZmluZWRgLCBvciBuZWdhdGl2ZSBibG9ja3MgZm9yZXZlci5cbiAgICogQHJldHVybnMge1Byb21pc2U8Ym9vbGVhbj59IC0gVHJ1ZSBpZiB0aGUgbG9jayB3YXMgYWNxdWlyZWQsIGZhbHNlIGlmIHRoZSB0aW1lb3V0IGVsYXBzZWQuXG4gICAqL1xuICBhc3luYyBfYWNxdWlyZUFkdmlzb3J5TG9jayhuYW1lLCB7dGltZW91dE1zfSA9IHt9KSB7XG4gICAgY29uc3QgdGltZW91dFZhbHVlID0gdHlwZW9mIHRpbWVvdXRNcyA9PT0gXCJudW1iZXJcIiAmJiB0aW1lb3V0TXMgPj0gMCA/IE1hdGguY2VpbCh0aW1lb3V0TXMpIDogLTFcbiAgICBjb25zdCByb3dzID0gYXdhaXQgdGhpcy5fYWR2aXNvcnlMb2NrUXVlcnkoXG4gICAgICBgREVDTEFSRSBAdmVsb2Npb3VzX2Fkdmlzb3J5X2xvY2tfcmVzdWx0IElOVDsgRVhFQyBAdmVsb2Npb3VzX2Fkdmlzb3J5X2xvY2tfcmVzdWx0ID0gc3BfZ2V0YXBwbG9jayBAUmVzb3VyY2UgPSAke3RoaXMucXVvdGUobmFtZSl9LCBATG9ja01vZGUgPSAnRXhjbHVzaXZlJywgQExvY2tPd25lciA9ICdTZXNzaW9uJywgQExvY2tUaW1lb3V0ID0gJHt0aW1lb3V0VmFsdWV9OyBTRUxFQ1QgQHZlbG9jaW91c19hZHZpc29yeV9sb2NrX3Jlc3VsdCBBUyB2ZWxvY2lvdXNfYWR2aXNvcnlfbG9ja19yZXN1bHRgXG4gICAgKVxuICAgIGNvbnN0IHJlc3VsdCA9IE51bWJlcihyb3dzPy5bMF0/LnZlbG9jaW91c19hZHZpc29yeV9sb2NrX3Jlc3VsdClcblxuICAgIGlmIChyZXN1bHQgPT09IDAgfHwgcmVzdWx0ID09PSAxKSByZXR1cm4gdHJ1ZVxuXG4gICAgYXdhaXQgdGhpcy5fY2xvc2VBZHZpc29yeUxvY2tUcmFuc2FjdGlvbigpXG5cbiAgICBpZiAocmVzdWx0ID09PSAtMSkgcmV0dXJuIGZhbHNlXG5cbiAgICB0aHJvdyBuZXcgRXJyb3IoYHNwX2dldGFwcGxvY2sgcmV0dXJuZWQgJHtyZXN1bHR9IGZvciBhZHZpc29yeSBsb2NrICR7SlNPTi5zdHJpbmdpZnkobmFtZSl9IChzZWUgU1FMIFNlcnZlciBkb2N1bWVudGF0aW9uIGZvciBzcF9nZXRhcHBsb2NrIHJldHVybiBjb2RlcylgKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgdHJ5IGFjcXVpcmUgYWR2aXNvcnkgbG9jay5cbiAgICogQHBhcmFtIHtzdHJpbmd9IG5hbWUgLSBMb2NrIG5hbWUuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPGJvb2xlYW4+fSAtIFRydWUgaWYgdGhlIGxvY2sgd2FzIGFjcXVpcmVkLCBmYWxzZSBpZiBpdCB3YXMgYWxyZWFkeSBoZWxkLlxuICAgKi9cbiAgYXN5bmMgX3RyeUFjcXVpcmVBZHZpc29yeUxvY2sobmFtZSkge1xuICAgIHJldHVybiBhd2FpdCB0aGlzLl9hY3F1aXJlQWR2aXNvcnlMb2NrKG5hbWUsIHt0aW1lb3V0TXM6IDB9KVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgcmVsZWFzZSBhZHZpc29yeSBsb2NrLlxuICAgKlxuICAgKiBgc3BfcmVsZWFzZWFwcGxvY2tgIHJldHVybnMgMCB3aGVuIHRoZSBsb2NrIHdhcyByZWxlYXNlZCwgYnV0IFNRTCBTZXJ2ZXJcbiAgICogcmFpc2VzIGVycm9yIHtAbGluayBBUFBMT0NLX05PVF9IRUxEX0VSUk9SX05VTUJFUn0gaW5zdGVhZCBvZiByZXR1cm5pbmcgYVxuICAgKiBmYWlsdXJlIGNvZGUgd2hlbiB0aGUgc2Vzc2lvbiBkb2VzIG5vdCBjdXJyZW50bHkgaG9sZCB0aGUgbG9jay4gVGhhdFxuICAgKiBlcnJvciBhYm9ydHMgdGhlIGJhdGNoIGJlZm9yZSB0aGUgdHJhaWxpbmcgYFNFTEVDVGAgY2FuIHJ1biwgc28gd2UgY2F0Y2hcbiAgICogaXQgYW5kIHJlc29sdmUgdG8gYGZhbHNlYCB0byBob25vciB0aGUgY3Jvc3MtZHJpdmVyIGNvbnRyYWN0IGZvciBhblxuICAgKiBhbHJlYWR5LXVuaGVsZCBsb2NrLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gbmFtZSAtIExvY2sgbmFtZS5cbiAgICogQHJldHVybnMge1Byb21pc2U8Ym9vbGVhbj59IC0gVHJ1ZSBpZiB0aGUgbG9jayB3YXMgaGVsZCBieSB0aGlzIHNlc3Npb24gYW5kIGhhcyBub3cgYmVlbiByZWxlYXNlZC5cbiAgICovXG4gIGFzeW5jIF9yZWxlYXNlQWR2aXNvcnlMb2NrKG5hbWUpIHtcbiAgICBsZXQgcm93c1xuXG4gICAgdHJ5IHtcbiAgICAgIHJvd3MgPSBhd2FpdCB0aGlzLl9hZHZpc29yeUxvY2tRdWVyeShcbiAgICAgICAgYERFQ0xBUkUgQHZlbG9jaW91c19hZHZpc29yeV9sb2NrX3Jlc3VsdCBJTlQ7IEVYRUMgQHZlbG9jaW91c19hZHZpc29yeV9sb2NrX3Jlc3VsdCA9IHNwX3JlbGVhc2VhcHBsb2NrIEBSZXNvdXJjZSA9ICR7dGhpcy5xdW90ZShuYW1lKX0sIEBMb2NrT3duZXIgPSAnU2Vzc2lvbic7IFNFTEVDVCBAdmVsb2Npb3VzX2Fkdmlzb3J5X2xvY2tfcmVzdWx0IEFTIHZlbG9jaW91c19hZHZpc29yeV9sb2NrX3Jlc3VsdGBcbiAgICAgIClcbiAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgaWYgKHRoaXMuX2lzQXBwbG9ja05vdEhlbGRFcnJvcihlcnJvcikpIHtcbiAgICAgICAgYXdhaXQgdGhpcy5fY2xvc2VBZHZpc29yeUxvY2tUcmFuc2FjdGlvbklmRmluYWxSZWxlYXNlKClcblxuICAgICAgICByZXR1cm4gZmFsc2VcbiAgICAgIH1cblxuICAgICAgdGhyb3cgZXJyb3JcbiAgICB9XG5cbiAgICBjb25zdCByZXN1bHQgPSBOdW1iZXIocm93cz8uWzBdPy52ZWxvY2lvdXNfYWR2aXNvcnlfbG9ja19yZXN1bHQpXG5cbiAgICBhd2FpdCB0aGlzLl9jbG9zZUFkdmlzb3J5TG9ja1RyYW5zYWN0aW9uSWZGaW5hbFJlbGVhc2UoKVxuXG4gICAgcmV0dXJuIHJlc3VsdCA9PT0gMFxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgYW4gYWR2aXNvcnktbG9jayBzdGF0ZW1lbnQgdGhyb3VnaCBvbmUgdHJhbnNhY3Rpb24gcmVxdWVzdCBwYXJlbnQuXG4gICAqIG5vZGUtbXNzcWwgcmVzZXJ2ZXMgb25lIHBoeXNpY2FsIHNlc3Npb24gZm9yIGEgVHJhbnNhY3Rpb24sIHdoZXJlYXNcbiAgICogc2VwYXJhdGUgQ29ubmVjdGlvblBvb2wgcmVxdWVzdHMgbWF5IGNoZWNrIG91dCBkaWZmZXJlbnQgc2Vzc2lvbnMuIFRoZVxuICAgKiB0cmFuc2FjdGlvbiBjb250YWlucyBvbmx5IGFwcGxpY2F0aW9uLWxvY2sgc3RhdGVtZW50czsgY2FsbGVyL21vZGVsIHdvcmtcbiAgICogY29udGludWVzIHRocm91Z2ggaXRzIG9yaWdpbmFsIGNvbm5lY3Rpb24uXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBzcWwgLSBBZHZpc29yeS1sb2NrIFNRTC5cbiAgICogQHJldHVybnMge1Byb21pc2U8aW1wb3J0KFwiLi4vYmFzZS5qc1wiKS5RdWVyeVJlc3VsdFR5cGU+fSAtIFJlc3VsdCByb3dzLlxuICAgKi9cbiAgYXN5bmMgX2Fkdmlzb3J5TG9ja1F1ZXJ5KHNxbCkge1xuICAgIGNvbnN0IHRyYW5zYWN0aW9uID0gYXdhaXQgdGhpcy5fZW5zdXJlQWR2aXNvcnlMb2NrVHJhbnNhY3Rpb24oKVxuXG4gICAgdHJ5IHtcbiAgICAgIGNvbnN0IHJlcXVlc3QgPSBuZXcgbXNzcWwuUmVxdWVzdCh0cmFuc2FjdGlvbilcbiAgICAgIGNvbnN0IHJlc3VsdCA9IGF3YWl0IHJlcXVlc3QucXVlcnkoc3FsKVxuXG4gICAgICByZXR1cm4gQXJyYXkuaXNBcnJheShyZXN1bHQucmVjb3Jkc2V0cykgPyByZXN1bHQucmVjb3Jkc2V0c1swXSB8fCBbXSA6IFtdXG4gICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgIGlmIChlcnJvciBpbnN0YW5jZW9mIEVycm9yKSB7XG4gICAgICAgIHRocm93IG5ldyBFcnJvcihgUXVlcnkgZmFpbGVkICcke2Vycm9yLm1lc3NhZ2V9JzogJHtzcWx9YCwge2NhdXNlOiBlcnJvcn0pXG4gICAgICB9XG5cbiAgICAgIHRocm93IG5ldyBFcnJvcihgUXVlcnkgZmFpbGVkICcke2Vycm9yfSc6ICR7c3FsfWAsIHtjYXVzZTogZXJyb3J9KVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBTdGFydHMgdGhlIHRyYW5zYWN0aW9uIHJlcXVlc3QgcGFyZW50IHRoYXQgcmVzZXJ2ZXMgdGhlIGFkdmlzb3J5LWxvY2tcbiAgICogc2Vzc2lvbiB1bnRpbCB0aGUgZmluYWwgcmVsZWFzZSBvciBkcml2ZXIgY2xvc2UuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPGltcG9ydChcIm1zc3FsXCIpLlRyYW5zYWN0aW9uPn0gLSBTZXNzaW9uLWFmZmluZSBwYXJlbnQuXG4gICAqL1xuICBhc3luYyBfZW5zdXJlQWR2aXNvcnlMb2NrVHJhbnNhY3Rpb24oKSB7XG4gICAgaWYgKHRoaXMuX2Fkdmlzb3J5TG9ja1RyYW5zYWN0aW9uKSByZXR1cm4gdGhpcy5fYWR2aXNvcnlMb2NrVHJhbnNhY3Rpb25cbiAgICBpZiAoIXRoaXMuY29ubmVjdGlvbikgYXdhaXQgdGhpcy5jb25uZWN0KClcbiAgICBpZiAoIXRoaXMuY29ubmVjdGlvbikgdGhyb3cgbmV3IEVycm9yKFwiTVNTUUwgY29ubmVjdGlvbiB1bmF2YWlsYWJsZSBmb3IgYWR2aXNvcnkgbG9ja1wiKVxuXG4gICAgY29uc3QgdHJhbnNhY3Rpb24gPSBuZXcgbXNzcWwuVHJhbnNhY3Rpb24odGhpcy5jb25uZWN0aW9uKVxuXG4gICAgYXdhaXQgdHJhbnNhY3Rpb24uYmVnaW4oKVxuICAgIHRoaXMuX2Fkdmlzb3J5TG9ja1RyYW5zYWN0aW9uID0gdHJhbnNhY3Rpb25cblxuICAgIHJldHVybiB0cmFuc2FjdGlvblxuICB9XG5cbiAgLyoqXG4gICAqIFJlbGVhc2VzIHRoZSByZXNlcnZlZCBzZXNzaW9uIGFmdGVyIHRoZSBsYXN0IHRyYWNrZWQgbG9jayByZWxlYXNlLlxuICAgKiBCYXNlIHVudHJhY2tzIHRoZSBjdXJyZW50IHJlbGVhc2UgYWZ0ZXIgdGhlIGRyaXZlciBob29rIHJldHVybnMsIHNvIGFcbiAgICogY3VycmVudCB0b3RhbCBvZiBvbmUgbWVhbnMgdGhpcyBpcyB0aGUgZmluYWwgcmVsZWFzZS5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgYWZ0ZXIgY2xlYW51cCB3aGVuIHRoaXMgaXMgZmluYWwuXG4gICAqL1xuICBhc3luYyBfY2xvc2VBZHZpc29yeUxvY2tUcmFuc2FjdGlvbklmRmluYWxSZWxlYXNlKCkge1xuICAgIGxldCBoZWxkQ291bnQgPSAwXG5cbiAgICBmb3IgKGNvbnN0IGNvdW50IG9mIHRoaXMuX2hlbGRBZHZpc29yeUxvY2tzLnZhbHVlcygpKSBoZWxkQ291bnQgKz0gY291bnRcblxuICAgIGlmIChoZWxkQ291bnQgPD0gMSkgYXdhaXQgdGhpcy5fY2xvc2VBZHZpc29yeUxvY2tUcmFuc2FjdGlvbigpXG4gIH1cblxuICAvKipcbiAgICogUm9sbHMgYmFjayB0aGUgb3RoZXJ3aXNlLWVtcHR5IHRyYW5zYWN0aW9uIGFuZCByZXR1cm5zIGl0cyBwaHlzaWNhbFxuICAgKiBzZXNzaW9uIHRvIG5vZGUtbXNzcWwuIFJvbGxiYWNrIGlzIGNsZWFudXAgb25seTsgYWR2aXNvcnkgbG9ja3MgYXJlXG4gICAqIGV4cGxpY2l0bHkgcmVsZWFzZWQgZmlyc3Qgd2hlbmV2ZXIgdGhlaXIgcmVsZWFzZSBzdGF0ZW1lbnQgc3VjY2VlZHMuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIGFmdGVyIHNlc3Npb24gY2xlYW51cC5cbiAgICovXG4gIGFzeW5jIF9jbG9zZUFkdmlzb3J5TG9ja1RyYW5zYWN0aW9uKCkge1xuICAgIGNvbnN0IHRyYW5zYWN0aW9uID0gdGhpcy5fYWR2aXNvcnlMb2NrVHJhbnNhY3Rpb25cblxuICAgIGlmICghdHJhbnNhY3Rpb24pIHJldHVyblxuXG4gICAgdGhpcy5fYWR2aXNvcnlMb2NrVHJhbnNhY3Rpb24gPSBudWxsXG4gICAgYXdhaXQgdHJhbnNhY3Rpb24ucm9sbGJhY2soKVxuICB9XG5cbiAgLyoqXG4gICAqIERldGVjdHMgdGhlIFNRTCBTZXJ2ZXIgXCJhcHBsaWNhdGlvbiBsb2NrIGlzIG5vdCBjdXJyZW50bHkgaGVsZFwiIGVycm9yXG4gICAqIHJhaXNlZCBieSBgc3BfcmVsZWFzZWFwcGxvY2tgLiBJdCB3YWxrcyB0aGUgd3JhcHBlZC1lcnJvciBjYXVzZSBjaGFpblxuICAgKiBiZWNhdXNlIGBxdWVyeWAgcmUtd3JhcHMgdGhlIGRyaXZlcidzIGBSZXF1ZXN0RXJyb3JgIGluIGEgcGxhaW4gYEVycm9yYCxcbiAgICogYW5kIG1hdGNoZXMgb24gdGhlIHN0YWJsZSBudW1lcmljIGVycm9yIG51bWJlciByYXRoZXIgdGhhbiB0aGUgbWVzc2FnZS5cbiAgICogQHBhcmFtIHt1bmtub3dufSBlcnJvciAtIEVycm9yIHRocm93biB3aGlsZSByZWxlYXNpbmcgdGhlIGxvY2suXG4gICAqIEByZXR1cm5zIHtib29sZWFufSAtIFRydWUgaWYgdGhlIGVycm9yIG1lYW5zIHRoZSBsb2NrIHdhcyBub3QgaGVsZCBieSB0aGlzIHNlc3Npb24uXG4gICAqL1xuICBfaXNBcHBsb2NrTm90SGVsZEVycm9yKGVycm9yKSB7XG4gICAgbGV0IGN1cnJlbnQgPSBlcnJvclxuXG4gICAgd2hpbGUgKGN1cnJlbnQgaW5zdGFuY2VvZiBFcnJvcikge1xuICAgICAgY29uc3QgZXJyb3JOdW1iZXIgPSAvKiogQHR5cGUge3tudW1iZXI/OiB1bmtub3dufX0gKi8gKGN1cnJlbnQpLm51bWJlclxuXG4gICAgICBpZiAodHlwZW9mIGVycm9yTnVtYmVyID09PSBcIm51bWJlclwiICYmIGVycm9yTnVtYmVyID09PSBBUFBMT0NLX05PVF9IRUxEX0VSUk9SX05VTUJFUikgcmV0dXJuIHRydWVcblxuICAgICAgY3VycmVudCA9IGN1cnJlbnQuY2F1c2VcbiAgICB9XG5cbiAgICByZXR1cm4gZmFsc2VcbiAgfVxuXG4gIC8qKlxuICAgKiBSZXR1cm5zIHRydWUgaWYgYW55IHNlc3Npb24gY3VycmVudGx5IGhvbGRzIHRoZSBhcHBsaWNhdGlvbiBsb2NrLlxuICAgKlxuICAgKiBUaGlzIGNvbWJpbmVzIHR3byBwcm9iZXMgYmVjYXVzZSBuZWl0aGVyIGlzIHN1ZmZpY2llbnQgb24gaXRzIG93bjpcbiAgICogICAtIGBBUFBMT0NLX01PREUoLi4uLCAnU2Vzc2lvbicpYCBvbmx5IHJlcG9ydHMgbG9ja3MgaGVsZCBieSB0aGVcbiAgICogICAgICoqY3VycmVudCoqIHNlc3Npb24sIHNvIGl0IG1pc3NlcyBsb2NrcyBoZWxkIGJ5IGFueSBvdGhlclxuICAgKiAgICAgc2Vzc2lvbiBhbmQgd291bGQgcmV0dXJuIGBOb0xvY2tgIGV2ZW4gdW5kZXIgY3Jvc3Mtc2Vzc2lvblxuICAgKiAgICAgY29udGVudGlvbi5cbiAgICogICAtIGBBUFBMT0NLX1RFU1QoLi4uLCAnRXhjbHVzaXZlJywgJ1Nlc3Npb24nKWAgcmV0dXJucyB3aGV0aGVyIGFuXG4gICAqICAgICBFeGNsdXNpdmUgbG9jayBjb3VsZCBiZSBncmFudGVkIHRvICp0aGlzKiBzZXNzaW9uIHJpZ2h0IG5vdy4gQVxuICAgKiAgICAgcmV0dXJuIHZhbHVlIG9mIDAgbWVhbnMgc29tZWJvZHkgZWxzZSBob2xkcyBhbiBpbmNvbXBhdGlibGVcbiAgICogICAgIGxvY2s7IGEgdmFsdWUgb2YgMSBtZWFucyBpdCBpcyBlaXRoZXIgZnJlZSAqKm9yKiogYWxyZWFkeSBoZWxkXG4gICAqICAgICBieSB1cyByZS1lbnRyYW50bHkgKHdoaWNoIHRoZSBgQVBQTE9DS19NT0RFYCBjaGVjayBjYXRjaGVzKS5cbiAgICpcbiAgICogVGhlIGNvbWJpbmVkIHJlc3VsdCBpcyBcImhlbGRcIiBpZmYgd2UgaG9sZCBpdCBvdXJzZWx2ZXMgb3JcbiAgICogYEFQUExPQ0tfVEVTVGAgcmVwb3J0cyB3ZSBjYW5ub3QgYWNxdWlyZSBpdCB3aXRob3V0IHdhaXRpbmcuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBuYW1lIC0gTG9jayBuYW1lLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxib29sZWFuPn0gLSBUcnVlIGlmIGFueSBzZXNzaW9uIGN1cnJlbnRseSBob2xkcyB0aGUgbG9jay5cbiAgICovXG4gIGFzeW5jIGlzQWR2aXNvcnlMb2NrSGVsZChuYW1lKSB7XG4gICAgY29uc3Qgcm93cyA9IGF3YWl0IHRoaXMucXVlcnkoXG4gICAgICBgU0VMRUNUIGAgK1xuICAgICAgICBgQVBQTE9DS19NT0RFKCdwdWJsaWMnLCAke3RoaXMucXVvdGUobmFtZSl9LCAnU2Vzc2lvbicpIEFTIHZlbG9jaW91c19hZHZpc29yeV9zZWxmX21vZGUsIGAgK1xuICAgICAgICBgQVBQTE9DS19URVNUKCdwdWJsaWMnLCAke3RoaXMucXVvdGUobmFtZSl9LCAnRXhjbHVzaXZlJywgJ1Nlc3Npb24nKSBBUyB2ZWxvY2lvdXNfYWR2aXNvcnlfdGVzdF9yZXN1bHRgXG4gICAgKVxuICAgIGNvbnN0IHNlbGZNb2RlID0gcm93cz8uWzBdPy52ZWxvY2lvdXNfYWR2aXNvcnlfc2VsZl9tb2RlXG4gICAgY29uc3QgaGVsZEJ5U2VsZiA9IHR5cGVvZiBzZWxmTW9kZSA9PT0gXCJzdHJpbmdcIiAmJiBzZWxmTW9kZS5sZW5ndGggPiAwICYmIHNlbGZNb2RlICE9PSBcIk5vTG9ja1wiXG5cbiAgICBpZiAoaGVsZEJ5U2VsZikgcmV0dXJuIHRydWVcblxuICAgIGNvbnN0IHRlc3RSZXN1bHQgPSBOdW1iZXIocm93cz8uWzBdPy52ZWxvY2lvdXNfYWR2aXNvcnlfdGVzdF9yZXN1bHQpXG5cbiAgICByZXR1cm4gdGVzdFJlc3VsdCA9PT0gMFxuICB9XG59XG4iXX0=