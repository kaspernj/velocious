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
     * @param {import("../base.js").QueryOptions} [options] - Query options.
     * @returns {Promise<import("../base.js").QueryResultType>} - Resolves with the query actual.
     */
    async _queryActual(sql, options = {}) {
        let result;
        let tries = 0;
        while (true) {
            tries++;
            try {
                const requestOptions = options.requestTimeoutMs === undefined
                    ? undefined
                    : { requestTimeout: options.requestTimeoutMs };
                // node-mssql supports request-local overrides, but its DefinitelyTyped
                // constructor declaration still exposes only the legacy first argument.
                const request = requestOptions
                    ? Reflect.construct(mssql.Request, [this._currentTransaction || this.connection, requestOptions])
                    : this._currentTransaction
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiaW5kZXguanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi8uLi8uLi9zcmMvZGF0YWJhc2UvZHJpdmVycy9tc3NxbC9pbmRleC5qcyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiQUFBQSxZQUFZO0FBRVosT0FBTyxVQUFVLE1BQU0sc0JBQXNCLENBQUE7QUFDN0MsT0FBTyxJQUFJLE1BQU0sWUFBWSxDQUFBO0FBQzdCLE9BQU8sY0FBYyxNQUFNLDBCQUEwQixDQUFBO0FBQ3JELE9BQU8sV0FBVyxNQUFNLHVCQUF1QixDQUFBO0FBQy9DLE9BQU8sV0FBVyxNQUFNLHVCQUF1QixDQUFBO0FBQy9DLE9BQU8sTUFBTSxNQUFNLGlCQUFpQixDQUFBO0FBQ3BDLE9BQU8sWUFBWSxNQUFNLHdCQUF3QixDQUFBO0FBQ2pELE9BQU8sU0FBUyxNQUFNLHFCQUFxQixDQUFBO0FBQzNDLE9BQU8sRUFBQyxJQUFJLEVBQUMsTUFBTSxXQUFXLENBQUE7QUFDOUIsT0FBTyxZQUFZLE1BQU0sbUJBQW1CLENBQUE7QUFDNUMsT0FBTyxNQUFNLE1BQU0saUJBQWlCLENBQUE7QUFDcEMsT0FBTyxPQUFPLE1BQU0sY0FBYyxDQUFBO0FBQ2xDLE9BQU8sS0FBSyxNQUFNLE9BQU8sQ0FBQTtBQUN6QixPQUFPLEdBQUcsTUFBTSxVQUFVLENBQUE7QUFDMUIsT0FBTyxXQUFXLE1BQU0sbUJBQW1CLENBQUE7QUFDM0MsT0FBTyxXQUFXLE1BQU0sdUJBQXVCLENBQUE7QUFDL0MsT0FBTyxLQUFLLE1BQU0sWUFBWSxDQUFBO0FBQzlCLE9BQU8sWUFBWSxNQUFNLG9CQUFvQixDQUFBO0FBQzdDLE9BQU8sT0FBTyxNQUFNLDJCQUEyQixDQUFBO0FBQy9DLE9BQU8sTUFBTSxNQUFNLGlCQUFpQixDQUFBO0FBQ3BDLE9BQU8sTUFBTSxNQUFNLGlCQUFpQixDQUFBO0FBQ3BDLE9BQU8sSUFBSSxNQUFNLFdBQVcsQ0FBQTtBQUU1Qjs7Ozs7Ozs7R0FRRztBQUNILE1BQU0sNkJBQTZC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QUcsT0FBTyxDQUFDLEtBQUssQ0FBQTtRQUN6QixDQUFDO1FBRUQsT0FBTyxLQUFLLENBQUE7SUFDZCxDQUFDO0lBRUQ7Ozs7Ozs7Ozs7Ozs7Ozs7OztPQWtCRztJQUNILEtBQUssQ0FBQyxrQkFBa0IsQ0FBQyxJQUFJO1FBQzNCLE1BQU0sSUFBSSxHQUFHLE1BQU0sSUFBSSxDQUFDLEtBQUssQ0FDM0IsU0FBUztZQUNQLDBCQUEwQixJQUFJLENBQUMsS0FBSyxDQUFDLElBQUksQ0FBQyxnREFBZ0Q7WUFDMUYsMEJBQTBCLElBQUksQ0FBQyxLQUFLLENBQUMsSUFBSSxDQUFDLDZEQUE2RCxDQUMxRyxDQUFBO1FBQ0QsTUFBTSxRQUFRLEdBQUcsSUFBSSxFQUFFLENBQUMsQ0FBQyxDQUFDLEVBQUUsNEJBQTRCLENBQUE7UUFDeEQsTUFBTSxVQUFVLEdBQUcsT0FBTyxRQUFRLEtBQUssUUFBUSxJQUFJLFFBQVEsQ0FBQyxNQUFNLEdBQUcsQ0FBQyxJQUFJLFFBQVEsS0FBSyxRQUFRLENBQUE7UUFFL0YsSUFBSSxVQUFVO1lBQUUsT0FBTyxJQUFJLENBQUE7UUFFM0IsTUFBTSxVQUFVLEdBQUcsTUFBTSxDQUFDLElBQUksRUFBRSxDQUFDLENBQUMsQ0FBQyxFQUFFLDhCQUE4QixDQUFDLENBQUE7UUFFcEUsT0FBTyxVQUFVLEtBQUssQ0FBQyxDQUFBO0lBQ3pCLENBQUM7Q0FDRiIsInNvdXJjZXNDb250ZW50IjpbIi8vIEB0cy1jaGVja1xuXG5pbXBvcnQgQWx0ZXJUYWJsZSBmcm9tIFwiLi9zcWwvYWx0ZXItdGFibGUuanNcIlxuaW1wb3J0IEJhc2UgZnJvbSBcIi4uL2Jhc2UuanNcIlxuaW1wb3J0IENyZWF0ZURhdGFiYXNlIGZyb20gXCIuL3NxbC9jcmVhdGUtZGF0YWJhc2UuanNcIlxuaW1wb3J0IENyZWF0ZUluZGV4IGZyb20gXCIuL3NxbC9jcmVhdGUtaW5kZXguanNcIlxuaW1wb3J0IENyZWF0ZVRhYmxlIGZyb20gXCIuL3NxbC9jcmVhdGUtdGFibGUuanNcIlxuaW1wb3J0IERlbGV0ZSBmcm9tIFwiLi9zcWwvZGVsZXRlLmpzXCJcbmltcG9ydCBEcm9wRGF0YWJhc2UgZnJvbSBcIi4vc3FsL2Ryb3AtZGF0YWJhc2UuanNcIlxuaW1wb3J0IERyb3BUYWJsZSBmcm9tIFwiLi9zcWwvZHJvcC10YWJsZS5qc1wiXG5pbXBvcnQge2RpZ2d9IGZyb20gXCJkaWdnZXJpemVcIlxuaW1wb3J0IGVzY2FwZVN0cmluZyBmcm9tIFwic3FsLWVzY2FwZS1zdHJpbmdcIlxuaW1wb3J0IEluc2VydCBmcm9tIFwiLi9zcWwvaW5zZXJ0LmpzXCJcbmltcG9ydCBPcHRpb25zIGZyb20gXCIuL29wdGlvbnMuanNcIlxuaW1wb3J0IG1zc3FsIGZyb20gXCJtc3NxbFwiXG5pbXBvcnQgbmV0IGZyb20gXCJub2RlOm5ldFwiXG5pbXBvcnQgUXVlcnlQYXJzZXIgZnJvbSBcIi4vcXVlcnktcGFyc2VyLmpzXCJcbmltcG9ydCBSZW1vdmVJbmRleCBmcm9tIFwiLi9zcWwvcmVtb3ZlLWluZGV4LmpzXCJcbmltcG9ydCBUYWJsZSBmcm9tIFwiLi90YWJsZS5qc1wiXG5pbXBvcnQgU3RydWN0dXJlU3FsIGZyb20gXCIuL3N0cnVjdHVyZS1zcWwuanNcIlxuaW1wb3J0IHRpbWVvdXQgZnJvbSBcImF3YWl0ZXJ5L2J1aWxkL3RpbWVvdXQuanNcIlxuaW1wb3J0IFVwc2VydCBmcm9tIFwiLi9zcWwvdXBzZXJ0LmpzXCJcbmltcG9ydCBVcGRhdGUgZnJvbSBcIi4vc3FsL3VwZGF0ZS5qc1wiXG5pbXBvcnQgVVVJRCBmcm9tIFwicHVyZS11dWlkXCJcblxuLyoqXG4gKiBTUUwgU2VydmVyIGVycm9yIG51bWJlciByYWlzZWQgYnkgYHNwX3JlbGVhc2VhcHBsb2NrYCB3aGVuIHRoZSBjdXJyZW50XG4gKiBzZXNzaW9uIGRvZXMgbm90IGhvbGQgdGhlIHJlcXVlc3RlZCBhcHBsaWNhdGlvbiBsb2NrLiBSZWxlYXNpbmcgYSBsb2NrIHRoZVxuICogc2Vzc2lvbiBubyBsb25nZXIgaG9sZHMgaXMgYSBub3JtYWwgcmFjZSAoYSBzaGFyZWQgY29ubmVjdGlvbidzIGZpbmFsXG4gKiBjaGVjay1pbiBtYXkgYWxyZWFkeSBoYXZlIGF1dG8tcmVsZWFzZWQgaXQpLCB3aGljaCB0aGUgY3Jvc3MtZHJpdmVyXG4gKiBgcmVsZWFzZUFkdmlzb3J5TG9ja2AgY29udHJhY3QgbW9kZWxzIGJ5IHJlc29sdmluZyB0byBgZmFsc2VgLiBXZSB0cmFuc2xhdGVcbiAqIHRoaXMgc3BlY2lmaWMgZXJyb3IgaW50byB0aGF0IHJlc3VsdCByYXRoZXIgdGhhbiBsZXR0aW5nIGl0IGVzY2FwZS5cbiAqIEB0eXBlIHtudW1iZXJ9XG4gKi9cbmNvbnN0IEFQUExPQ0tfTk9UX0hFTERfRVJST1JfTlVNQkVSID0gMTIyM1xuXG5leHBvcnQgZGVmYXVsdCBjbGFzcyBWZWxvY2lvdXNEYXRhYmFzZURyaXZlcnNNc3NxbCBleHRlbmRzIEJhc2V7XG4gIC8qKiBAdHlwZSB7aW1wb3J0KFwibXNzcWxcIikuVHJhbnNhY3Rpb24gfCBudWxsfSAqL1xuICBfYWR2aXNvcnlMb2NrVHJhbnNhY3Rpb24gPSBudWxsXG5cbiAgYXN5bmMgY29ubmVjdCgpIHtcbiAgICBjb25zdCBhcmdzID0gdGhpcy5nZXRBcmdzKClcbiAgICBjb25zdCBzcWxDb25maWcgPSBkaWdnKGFyZ3MsIFwic3FsQ29uZmlnXCIpXG5cbiAgICB0cnkge1xuICAgICAgaWYgKHRoaXMuY29ubmVjdGlvbikgYXdhaXQgdGhpcy5jbG9zZSgpXG5cbiAgICAgIGlmIChzcWxDb25maWcpIHtcbiAgICAgICAgc3FsQ29uZmlnLm9wdGlvbnMgPSBPYmplY3QuYXNzaWduKHt9LCBzcWxDb25maWcub3B0aW9ucywge3VzZVVUQzogdHJ1ZX0pXG4gICAgICB9XG5cbiAgICAgIGlmIChzcWxDb25maWc/LnNlcnZlciAmJiAhc3FsQ29uZmlnLm9wdGlvbnM/LnNlcnZlck5hbWUgJiYgbmV0LmlzSVAoc3FsQ29uZmlnLnNlcnZlcikpIHtcbiAgICAgICAgc3FsQ29uZmlnLm9wdGlvbnMgPSBPYmplY3QuYXNzaWduKHt9LCBzcWxDb25maWcub3B0aW9ucywge3NlcnZlck5hbWU6IFwiXCJ9KVxuICAgICAgfVxuXG4gICAgICB0aGlzLmNvbm5lY3Rpb24gPSBuZXcgbXNzcWwuQ29ubmVjdGlvblBvb2woc3FsQ29uZmlnKVxuICAgICAgYXdhaXQgdGhpcy5jb25uZWN0aW9uLmNvbm5lY3QoKVxuICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICAvLyBSZS10aHJvdyB0byBmaXggdW51c2VhYmxlIHN0YWNrIHRyYWNlLlxuICAgICAgdGhyb3cgbmV3IEVycm9yKGBDb3VsZG4ndCBjb25uZWN0IHRvIGRhdGFiYXNlOiAke2Vycm9yIGluc3RhbmNlb2YgRXJyb3IgPyBlcnJvci5tZXNzYWdlIDogZXJyb3J9YCwge2NhdXNlOiBlcnJvcn0pXG4gICAgfVxuICB9XG5cbiAgYXN5bmMgX2Nsb3NlKCkge1xuICAgIGlmICghdGhpcy5jb25uZWN0aW9uKSByZXR1cm5cblxuICAgIGNvbnN0IGNvbm5lY3Rpb24gPSB0aGlzLmNvbm5lY3Rpb25cbiAgICB0aGlzLmNvbm5lY3Rpb24gPSB1bmRlZmluZWRcbiAgICB0aGlzLl9jdXJyZW50VHJhbnNhY3Rpb24gPSBudWxsXG4gICAgdGhpcy5fdHJhbnNhY3Rpb25zQ291bnQgPSAwXG4gICAgLyoqIEB0eXBlIHtFcnJvciB8IHVuZGVmaW5lZH0gKi9cbiAgICBsZXQgc2Vzc2lvbkVycm9yXG5cbiAgICB0cnkge1xuICAgICAgYXdhaXQgdGhpcy5fY2xvc2VBZHZpc29yeUxvY2tUcmFuc2FjdGlvbigpXG4gICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgIHNlc3Npb25FcnJvciA9IGVycm9yIGluc3RhbmNlb2YgRXJyb3IgPyBlcnJvciA6IG5ldyBFcnJvcihcIkZhaWxlZCB0byBjbG9zZSBNU1NRTCBhZHZpc29yeS1sb2NrIHNlc3Npb25cIiwge2NhdXNlOiBlcnJvcn0pXG4gICAgfVxuXG4gICAgdHJ5IHtcbiAgICAgIGF3YWl0IHRpbWVvdXQoe3RpbWVvdXQ6IDIwMDB9LCAoKSA9PiBjb25uZWN0aW9uLmNsb3NlKCkpXG4gICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgIHRoaXMubG9nZ2VyLndhcm4oXCJGYWlsZWQgdG8gY2xvc2UgTVNTUUwgY29ubmVjdGlvbiBjbGVhbmx5XCIsIHtlcnJvcn0pXG4gICAgfVxuXG4gICAgaWYgKHNlc3Npb25FcnJvcikgdGhyb3cgc2Vzc2lvbkVycm9yXG4gIH1cblxuICAvKipcbiAgICogUnVucyBhbHRlciB0YWJsZSBzcWxzLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uLy4uL3RhYmxlLWRhdGEvaW5kZXguanNcIikuZGVmYXVsdH0gdGFibGVEYXRhIC0gVGFibGUgZGF0YS5cbiAgICogQHJldHVybnMge1Byb21pc2U8c3RyaW5nW10+fSAtIFJlc29sdmVzIHdpdGggU1FMIHN0YXRlbWVudHMuXG4gICAqL1xuICBhc3luYyBhbHRlclRhYmxlU1FMcyh0YWJsZURhdGEpIHtcbiAgICBjb25zdCBhbHRlckFyZ3MgPSB7dGFibGVEYXRhLCBkcml2ZXI6IHRoaXN9XG4gICAgY29uc3QgYWx0ZXJUYWJsZSA9IG5ldyBBbHRlclRhYmxlKGFsdGVyQXJncylcblxuICAgIHJldHVybiBhd2FpdCBhbHRlclRhYmxlLnRvU1FMcygpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBjcmVhdGUgZGF0YWJhc2Ugc3FsLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gZGF0YWJhc2VOYW1lIC0gRGF0YWJhc2UgbmFtZS5cbiAgICogQHBhcmFtIHtvYmplY3R9IFthcmdzXSAtIE9wdGlvbnMgb2JqZWN0LlxuICAgKiBAcGFyYW0ge2Jvb2xlYW59IFthcmdzLmlmTm90RXhpc3RzXSAtIFdoZXRoZXIgaWYgbm90IGV4aXN0cy5cbiAgICogQHJldHVybnMge3N0cmluZ1tdfSAtIFNRTCBzdGF0ZW1lbnRzLlxuICAgKi9cbiAgY3JlYXRlRGF0YWJhc2VTcWwoZGF0YWJhc2VOYW1lLCBhcmdzKSB7XG4gICAgY29uc3QgY3JlYXRlQXJncyA9IE9iamVjdC5hc3NpZ24oe2RhdGFiYXNlTmFtZSwgZHJpdmVyOiB0aGlzfSwgYXJncylcbiAgICBjb25zdCBjcmVhdGVEYXRhYmFzZSA9IG5ldyBDcmVhdGVEYXRhYmFzZShjcmVhdGVBcmdzKVxuXG4gICAgcmV0dXJuIGNyZWF0ZURhdGFiYXNlLnRvU3FsKClcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGRyb3AgZGF0YWJhc2Ugc3FsLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gZGF0YWJhc2VOYW1lIC0gRGF0YWJhc2UgbmFtZS5cbiAgICogQHBhcmFtIHtvYmplY3R9IFthcmdzXSAtIE9wdGlvbnMgb2JqZWN0LlxuICAgKiBAcGFyYW0ge2Jvb2xlYW59IFthcmdzLmlmRXhpc3RzXSAtIFdoZXRoZXIgaWYgZXhpc3RzLlxuICAgKiBAcmV0dXJucyB7c3RyaW5nW119IC0gU1FMIHN0YXRlbWVudHMuXG4gICAqL1xuICBkcm9wRGF0YWJhc2VTcWwoZGF0YWJhc2VOYW1lLCBhcmdzKSB7XG4gICAgY29uc3QgZHJvcEFyZ3MgPSBPYmplY3QuYXNzaWduKHtkYXRhYmFzZU5hbWUsIGRyaXZlcjogdGhpc30sIGFyZ3MpXG4gICAgY29uc3QgZHJvcERhdGFiYXNlID0gbmV3IERyb3BEYXRhYmFzZShkcm9wQXJncylcblxuICAgIHJldHVybiBkcm9wRGF0YWJhc2UudG9TcWwoKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgY3JlYXRlIGluZGV4IHNxbHMuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vYmFzZS5qc1wiKS5DcmVhdGVJbmRleFNxbEFyZ3N9IGluZGV4RGF0YSAtIEluZGV4IGRhdGEuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHN0cmluZ1tdPn0gLSBSZXNvbHZlcyB3aXRoIFNRTCBzdGF0ZW1lbnRzLlxuICAgKi9cbiAgYXN5bmMgY3JlYXRlSW5kZXhTUUxzKGluZGV4RGF0YSkge1xuICAgIGNvbnN0IGNyZWF0ZUFyZ3MgPSBPYmplY3QuYXNzaWduKHtkcml2ZXI6IHRoaXN9LCBpbmRleERhdGEpXG4gICAgY29uc3QgY3JlYXRlSW5kZXggPSBuZXcgQ3JlYXRlSW5kZXgoY3JlYXRlQXJncylcblxuICAgIHJldHVybiBhd2FpdCBjcmVhdGVJbmRleC50b1NRTHMoKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgcmVtb3ZlIGluZGV4IHNxbHMuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vYmFzZS5qc1wiKS5SZW1vdmVJbmRleFNxbEFyZ3N9IGluZGV4RGF0YSAtIEluZGV4IGRhdGEuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHN0cmluZ1tdPn0gLSBSZXNvbHZlcyB3aXRoIFNRTCBzdGF0ZW1lbnRzLlxuICAgKi9cbiAgYXN5bmMgcmVtb3ZlSW5kZXhTUUxzKGluZGV4RGF0YSkge1xuICAgIGNvbnN0IHJlbW92ZUFyZ3MgPSBPYmplY3QuYXNzaWduKHtkcml2ZXI6IHRoaXN9LCBpbmRleERhdGEpXG4gICAgY29uc3QgcmVtb3ZlSW5kZXggPSBuZXcgUmVtb3ZlSW5kZXgocmVtb3ZlQXJncylcblxuICAgIHJldHVybiBhd2FpdCByZW1vdmVJbmRleC50b1NRTHMoKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgY3JlYXRlIHRhYmxlIHNxbC5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi8uLi90YWJsZS1kYXRhL2luZGV4LmpzXCIpLmRlZmF1bHR9IHRhYmxlRGF0YSAtIFRhYmxlIGRhdGEuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHN0cmluZ1tdPn0gLSBSZXNvbHZlcyB3aXRoIFNRTCBzdGF0ZW1lbnRzLlxuICAgKi9cbiAgYXN5bmMgY3JlYXRlVGFibGVTcWwodGFibGVEYXRhKSB7XG4gICAgY29uc3QgY3JlYXRlQXJncyA9IHt0YWJsZURhdGEsIGRyaXZlcjogdGhpcywgaW5kZXhJbkNyZWF0ZVRhYmxlOiBmYWxzZX1cbiAgICBjb25zdCBjcmVhdGVUYWJsZSA9IG5ldyBDcmVhdGVUYWJsZShjcmVhdGVBcmdzKVxuXG4gICAgcmV0dXJuIGF3YWl0IGNyZWF0ZVRhYmxlLnRvU3FsKClcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGN1cnJlbnQgZGF0YWJhc2UuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHN0cmluZz59IC0gUmVzb2x2ZXMgd2l0aCB0aGUgY3VycmVudCBkYXRhYmFzZS5cbiAgICovXG4gIGFzeW5jIGN1cnJlbnREYXRhYmFzZSgpIHtcbiAgICBjb25zdCByb3dzID0gYXdhaXQgdGhpcy5xdWVyeShcIlNFTEVDVCBEQl9OQU1FKCkgQVMgZGJfbmFtZVwiKVxuXG4gICAgcmV0dXJuIGRpZ2cocm93cywgMCwgXCJkYl9uYW1lXCIpXG4gIH1cblxuICAvKipcbiAgICogRGlzYWJsZXMgZXZlcnkgZm9yZWlnbiBrZXkgY29uc3RyYWludCAoYnVsayBgTk9DSEVDS2ApLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyB3aGVuIGZvcmVpZ24ga2V5cyBhcmUgZGlzYWJsZWQuXG4gICAqL1xuICBhc3luYyBkaXNhYmxlRm9yZWlnbktleXMoKSB7XG4gICAgYXdhaXQgdGhpcy5fZXhlY0NvbnN0cmFpbnRUb2dnbGUoXCJFWEVDIHNwX01TZm9yZWFjaHRhYmxlIFxcXCJBTFRFUiBUQUJMRSA/IE5PQ0hFQ0sgQ09OU1RSQUlOVCBhbGxcXFwiXCIsIFwiZGlzYWJsZUZvcmVpZ25LZXlzXCIpXG4gIH1cblxuICAvKipcbiAgICogUmUtZW5hYmxlcyBhbmQgcmUtdmFsaWRhdGVzIGV2ZXJ5IGZvcmVpZ24ga2V5IGNvbnN0cmFpbnQgKGBXSVRIIENIRUNLYCkuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIHdoZW4gZm9yZWlnbiBrZXlzIGFyZSBlbmFibGVkLlxuICAgKi9cbiAgYXN5bmMgZW5hYmxlRm9yZWlnbktleXMoKSB7XG4gICAgYXdhaXQgdGhpcy5fZXhlY0NvbnN0cmFpbnRUb2dnbGUoXCJFWEVDIHNwX01TZm9yZWFjaHRhYmxlIEBjb21tYW5kMT1cXFwicHJpbnQgJz8nXFxcIiwgQGNvbW1hbmQyPVxcXCJBTFRFUiBUQUJMRSA/IFdJVEggQ0hFQ0sgQ0hFQ0sgQ09OU1RSQUlOVCBhbGxcXFwiXCIsIFwiZW5hYmxlRm9yZWlnbktleXNcIilcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGEgYnVsayBjb25zdHJhaW50LXRvZ2dsZSBzdGF0ZW1lbnQuIGBBTFRFUiBUQUJMRSAuLi4gTk9DSEVDSy9DSEVDS1xuICAgKiBDT05TVFJBSU5UYCBuZWVkcyBhIHNjaGVtYS1tb2RpZmljYXRpb24gbG9jayBvbiBldmVyeSB0YWJsZSwgc28gaWYgdGhlXG4gICAqIHJlcXVlc3QgdGltZXMgb3V0IGl0IGlzIGFsbW9zdCBhbHdheXMgYmxvY2tlZCBieSBhbm90aGVyIHNlc3Npb24gdGhhdCBpc1xuICAgKiBzdGlsbCBob2xkaW5nIGEgbG9jayAoYSBsZWFrZWQvdW5jb21taXR0ZWQgY29ubmVjdGlvbikuIE9uIGEgdGltZW91dCxcbiAgICogY2FwdHVyZSB3aGljaCBzZXNzaW9ucyB3ZXJlIGJsb2NraW5nIHNvIHRoZSByZWFsIGN1bHByaXQgaXMgbmFtZWQgaW5zdGVhZFxuICAgKiBvZiBsZWF2aW5nIGEgYmFyZSBcIlJlcXVlc3QgZmFpbGVkIHRvIGNvbXBsZXRlIGluIDE1MDAwbXNcIi5cbiAgICogQHBhcmFtIHtzdHJpbmd9IHNxbCAtIENvbnN0cmFpbnQtdG9nZ2xlIFNRTC5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGxhYmVsIC0gT3BlcmF0aW9uIGxhYmVsIGZvciB0aGUgZXJyb3IuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIHdoZW4gdGhlIHRvZ2dsZSBjb21wbGV0ZXMuXG4gICAqL1xuICBhc3luYyBfZXhlY0NvbnN0cmFpbnRUb2dnbGUoc3FsLCBsYWJlbCkge1xuICAgIHRyeSB7XG4gICAgICBhd2FpdCB0aGlzLnF1ZXJ5KHNxbClcbiAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgaWYgKGVycm9yIGluc3RhbmNlb2YgRXJyb3IgJiYgL1RpbWVvdXQ6IFJlcXVlc3QgZmFpbGVkIHRvIGNvbXBsZXRlL2kudGVzdChlcnJvci5tZXNzYWdlKSkge1xuICAgICAgICBjb25zdCBzbmFwc2hvdCA9IGF3YWl0IHRoaXMuX2NhcHR1cmVCbG9ja2luZ1Nlc3Npb25zRm9yRGVidWcoKS5jYXRjaChcbiAgICAgICAgICAoZGlhZ0Vycm9yKSA9PiBgKGJsb2NraW5nIGRpYWdub3N0aWNzIHF1ZXJ5IGZhaWxlZDogJHtkaWFnRXJyb3IgaW5zdGFuY2VvZiBFcnJvciA/IGRpYWdFcnJvci5tZXNzYWdlIDogZGlhZ0Vycm9yfSlgXG4gICAgICAgIClcblxuICAgICAgICB0aHJvdyBuZXcgRXJyb3IoYCR7ZXJyb3IubWVzc2FnZX1cXG5cXG5bJHtsYWJlbH0gYmxvY2tlZF0gb3RoZXIgdXNlciBzZXNzaW9ucyB3aXRoIG9wZW4gdHJhbnNhY3Rpb25zIG9yIGFjdGl2ZSByZXF1ZXN0czpcXG4ke3NuYXBzaG90fWAsIHtjYXVzZTogZXJyb3J9KVxuICAgICAgfVxuXG4gICAgICB0aHJvdyBlcnJvclxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBTbmFwc2hvdHMgdGhlIHNlc3Npb25zIHRoYXQgY291bGQgYmUgYmxvY2tpbmcgYSBjb25zdHJhaW50IHRvZ2dsZSBpbiBUSElTXG4gICAqIGRhdGFiYXNlIOKAlCBldmVyeSBzZXNzaW9uIG90aGVyIHRoYW4gdGhpcyBvbmUgdGhhdCBob2xkcyBhIGxvY2sgaW4gYERCX0lEKClgXG4gICAqIG9yIGlzIHJ1bm5pbmcgYSByZXF1ZXN0IGFnYWluc3QgaXQg4oCUIHdpdGggaXRzIGxhc3Qgc3RhdGVtZW50LCB3YWl0IHN0YXRlLFxuICAgKiBhbmQgYmxvY2tpbmcgc2Vzc2lvbiwgZW5vdWdoIHRvIGlkZW50aWZ5IGEgY29ubmVjdGlvbiB0aGF0IGxlYWtlZCBhIGxvY2suXG4gICAqIFNjb3BlZCB0byB0aGUgY3VycmVudCBkYXRhYmFzZSBzbyBhIG11bHRpLWRhdGFiYXNlIHNlcnZlciBkb2VzIG5vdCBsZWFrXG4gICAqIHVucmVsYXRlZCBzZXNzaW9ucycgU1FMIGludG8gdGhlIGVycm9yIGFuZCBidXJ5IHRoZSByZWFsIGJsb2NrZXIuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHN0cmluZz59IC0gSlNPTiBzbmFwc2hvdCwgb3IgYSBcIihub25lKVwiIG1hcmtlci5cbiAgICovXG4gIGFzeW5jIF9jYXB0dXJlQmxvY2tpbmdTZXNzaW9uc0ZvckRlYnVnKCkge1xuICAgIGNvbnN0IHJvd3MgPSBhd2FpdCB0aGlzLnF1ZXJ5KGBcbiAgICAgIFdJVEggbG9ja19zZXNzaW9ucyBBUyAoXG4gICAgICAgIFNFTEVDVCBESVNUSU5DVCByZXF1ZXN0X3Nlc3Npb25faWQgQVMgc2Vzc2lvbl9pZFxuICAgICAgICBGUk9NIHN5cy5kbV90cmFuX2xvY2tzXG4gICAgICAgIFdIRVJFIHJlc291cmNlX2RhdGFiYXNlX2lkID0gREJfSUQoKVxuICAgICAgKVxuICAgICAgU0VMRUNUXG4gICAgICAgIHMuc2Vzc2lvbl9pZCBBUyBzZXNzaW9uSWQsXG4gICAgICAgIHMuc3RhdHVzIEFTIHNlc3Npb25TdGF0dXMsXG4gICAgICAgIHMubG9naW5fdGltZSBBUyBsb2dpblRpbWUsXG4gICAgICAgIHMubGFzdF9yZXF1ZXN0X3N0YXJ0X3RpbWUgQVMgbGFzdFJlcXVlc3RTdGFydCxcbiAgICAgICAgcy5sYXN0X3JlcXVlc3RfZW5kX3RpbWUgQVMgbGFzdFJlcXVlc3RFbmQsXG4gICAgICAgIHMub3Blbl90cmFuc2FjdGlvbl9jb3VudCBBUyBvcGVuVHJhbnNhY3Rpb25Db3VudCxcbiAgICAgICAgci5zdGF0dXMgQVMgcmVxdWVzdFN0YXR1cyxcbiAgICAgICAgci5jb21tYW5kIEFTIGNvbW1hbmQsXG4gICAgICAgIHIud2FpdF90eXBlIEFTIHdhaXRUeXBlLFxuICAgICAgICByLndhaXRfdGltZSBBUyB3YWl0VGltZU1zLFxuICAgICAgICByLmJsb2NraW5nX3Nlc3Npb25faWQgQVMgYmxvY2tpbmdTZXNzaW9uSWQsXG4gICAgICAgIENBU1QoaWIuZXZlbnRfaW5mbyBBUyBOVkFSQ0hBUihNQVgpKSBBUyBsYXN0U3FsXG4gICAgICBGUk9NIHN5cy5kbV9leGVjX3Nlc3Npb25zIHNcbiAgICAgIExFRlQgSk9JTiBzeXMuZG1fZXhlY19yZXF1ZXN0cyByIE9OIHIuc2Vzc2lvbl9pZCA9IHMuc2Vzc2lvbl9pZFxuICAgICAgT1VURVIgQVBQTFkgc3lzLmRtX2V4ZWNfaW5wdXRfYnVmZmVyKHMuc2Vzc2lvbl9pZCwgTlVMTCkgaWJcbiAgICAgIFdIRVJFIHMuaXNfdXNlcl9wcm9jZXNzID0gMVxuICAgICAgICBBTkQgcy5zZXNzaW9uX2lkIDw+IEBAU1BJRFxuICAgICAgICBBTkQgKHMuc2Vzc2lvbl9pZCBJTiAoU0VMRUNUIHNlc3Npb25faWQgRlJPTSBsb2NrX3Nlc3Npb25zKSBPUiByLmRhdGFiYXNlX2lkID0gREJfSUQoKSlcbiAgICBgKVxuXG4gICAgaWYgKHJvd3MubGVuZ3RoID09PSAwKSByZXR1cm4gXCIobm9uZSDigJQgbm8gb3RoZXIgc2Vzc2lvbiBoZWxkIGEgbG9jayBvciByYW4gYSByZXF1ZXN0IGluIHRoaXMgZGF0YWJhc2Ugd2hlbiBxdWVyaWVkKVwiXG5cbiAgICByZXR1cm4gSlNPTi5zdHJpbmdpZnkocm93cywgbnVsbCwgMilcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGRyb3AgdGFibGUgc3Fscy5cbiAgICogQHBhcmFtIHtzdHJpbmd9IHRhYmxlTmFtZSAtIFRhYmxlIG5hbWUuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vYmFzZS5qc1wiKS5Ecm9wVGFibGVTcWxBcmdzVHlwZX0gW2FyZ3NdIC0gT3B0aW9ucyBvYmplY3QuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHN0cmluZ1tdPn0gLSBSZXNvbHZlcyB3aXRoIFNRTCBzdGF0ZW1lbnRzLlxuICAgKi9cbiAgYXN5bmMgZHJvcFRhYmxlU1FMcyh0YWJsZU5hbWUsIGFyZ3MgPSB7fSkge1xuICAgIGNvbnN0IGRyb3BBcmdzID0gT2JqZWN0LmFzc2lnbih7dGFibGVOYW1lLCBkcml2ZXI6IHRoaXN9LCBhcmdzKVxuICAgIGNvbnN0IGRyb3BUYWJsZSA9IG5ldyBEcm9wVGFibGUoZHJvcEFyZ3MpXG5cbiAgICByZXR1cm4gYXdhaXQgZHJvcFRhYmxlLnRvU1FMcygpXG4gIH1cblxuICAvKipcbiAgICogRHJvcHMgdGhlIGZvcmVpZ24ga2V5IGNvbnN0cmFpbnRzIHRoYXQgcmVmZXJlbmNlIHRoZSBnaXZlbiB0YWJsZS4gTVNTUUxcbiAgICogcmVmdXNlcyB0byBkcm9wIGEgdGFibGUgdGhhdCBpcyBzdGlsbCByZWZlcmVuY2VkIGJ5IGEgRk9SRUlHTiBLRVlcbiAgICogY29uc3RyYWludCBldmVuIHdoZW4gY29uc3RyYWludHMgYXJlIGRpc2FibGVkIHZpYSBOT0NIRUNLLCBzbyB0aGVcbiAgICogcmVmZXJlbmNpbmcgY29uc3RyYWludHMgbXVzdCBiZSByZW1vdmVkIGJlZm9yZSB0aGUgdGFibGUgY2FuIGJlIGRyb3BwZWQuXG4gICAqIFRoaXMgbGV0cyBjYWxsZXJzIGRyb3AgdGFibGVzIGluIGFueSBvcmRlciAoZS5nLiB3aXBpbmcgYSB3aG9sZSBzY2hlbWEpXG4gICAqIHdpdGhvdXQgZmlyc3QgZHJvcHBpbmcgZXZlcnkgZGVwZW5kZW50IHRhYmxlLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gdGFibGVOYW1lIC0gVGFibGUgbmFtZS5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgd2hlbiBjb21wbGV0ZS5cbiAgICovXG4gIGFzeW5jIF9kcm9wUmVmZXJlbmNpbmdGb3JlaWduS2V5cyh0YWJsZU5hbWUpIHtcbiAgICBjb25zdCByb3dzID0gYXdhaXQgdGhpcy5xdWVyeShcbiAgICAgIFwiU0VMRUNUIGZrLm5hbWUgQVMgY29uc3RyYWludF9uYW1lLCBPQkpFQ1RfTkFNRShmay5wYXJlbnRfb2JqZWN0X2lkKSBBUyBwYXJlbnRfdGFibGUgXCIgK1xuICAgICAgYEZST00gc3lzLmZvcmVpZ25fa2V5cyBmayBXSEVSRSBmay5yZWZlcmVuY2VkX29iamVjdF9pZCA9IE9CSkVDVF9JRCgke3RoaXMucXVvdGUodGFibGVOYW1lKX0pYFxuICAgIClcblxuICAgIGZvciAoY29uc3Qgcm93IG9mIHJvd3MpIHtcbiAgICAgIGNvbnN0IGNvbnN0cmFpbnROYW1lID0gcm93LmNvbnN0cmFpbnRfbmFtZSA/PyByb3cuQ09OU1RSQUlOVF9OQU1FXG4gICAgICBjb25zdCBwYXJlbnRUYWJsZSA9IHJvdy5wYXJlbnRfdGFibGUgPz8gcm93LlBBUkVOVF9UQUJMRVxuXG4gICAgICBhd2FpdCB0aGlzLnF1ZXJ5KGBBTFRFUiBUQUJMRSBbJHtwYXJlbnRUYWJsZX1dIERST1AgQ09OU1RSQUlOVCBbJHtjb25zdHJhaW50TmFtZX1dYClcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogUnVucyBkcm9wIHRhYmxlLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gdGFibGVOYW1lIC0gVGFibGUgbmFtZS5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9iYXNlLmpzXCIpLkRyb3BUYWJsZVNxbEFyZ3NUeXBlfSBbYXJnc10gLSBPcHRpb25zIG9iamVjdC5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgd2hlbiBjb21wbGV0ZS5cbiAgICovXG4gIGFzeW5jIGRyb3BUYWJsZSh0YWJsZU5hbWUsIGFyZ3MgPSB7fSkge1xuICAgIHRoaXMuX2Fzc2VydE5vdFJlYWRPbmx5KClcbiAgICBhd2FpdCB0aGlzLl9kcm9wUmVmZXJlbmNpbmdGb3JlaWduS2V5cyh0YWJsZU5hbWUpXG5cbiAgICBjb25zdCBzcWxzID0gYXdhaXQgdGhpcy5kcm9wVGFibGVTUUxzKHRhYmxlTmFtZSwgYXJncylcblxuICAgIGZvciAoY29uc3Qgc3FsIG9mIHNxbHMpIHtcbiAgICAgIGF3YWl0IHRoaXMucXVlcnkoc3FsKVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGdldCB0eXBlLlxuICAgKiBAcmV0dXJucyB7c3RyaW5nfSAtIFRoZSB0eXBlLlxuICAgKi9cbiAgZ2V0VHlwZSgpIHsgcmV0dXJuIFwibXNzcWxcIiB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgcXVlcnkgYWN0dWFsLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gc3FsIC0gU1FMIHN0cmluZy5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9iYXNlLmpzXCIpLlF1ZXJ5T3B0aW9uc30gW29wdGlvbnNdIC0gUXVlcnkgb3B0aW9ucy5cbiAgICogQHJldHVybnMge1Byb21pc2U8aW1wb3J0KFwiLi4vYmFzZS5qc1wiKS5RdWVyeVJlc3VsdFR5cGU+fSAtIFJlc29sdmVzIHdpdGggdGhlIHF1ZXJ5IGFjdHVhbC5cbiAgICovXG4gIGFzeW5jIF9xdWVyeUFjdHVhbChzcWwsIG9wdGlvbnMgPSB7fSkge1xuICAgIGxldCByZXN1bHRcbiAgICBsZXQgdHJpZXMgPSAwXG5cbiAgICB3aGlsZSAodHJ1ZSkge1xuICAgICAgdHJpZXMrK1xuXG4gICAgICB0cnkge1xuICAgICAgICBjb25zdCByZXF1ZXN0T3B0aW9ucyA9IG9wdGlvbnMucmVxdWVzdFRpbWVvdXRNcyA9PT0gdW5kZWZpbmVkXG4gICAgICAgICAgPyB1bmRlZmluZWRcbiAgICAgICAgICA6IHtyZXF1ZXN0VGltZW91dDogb3B0aW9ucy5yZXF1ZXN0VGltZW91dE1zfVxuICAgICAgICAvLyBub2RlLW1zc3FsIHN1cHBvcnRzIHJlcXVlc3QtbG9jYWwgb3ZlcnJpZGVzLCBidXQgaXRzIERlZmluaXRlbHlUeXBlZFxuICAgICAgICAvLyBjb25zdHJ1Y3RvciBkZWNsYXJhdGlvbiBzdGlsbCBleHBvc2VzIG9ubHkgdGhlIGxlZ2FjeSBmaXJzdCBhcmd1bWVudC5cbiAgICAgICAgY29uc3QgcmVxdWVzdCA9IHJlcXVlc3RPcHRpb25zXG4gICAgICAgICAgPyBSZWZsZWN0LmNvbnN0cnVjdChtc3NxbC5SZXF1ZXN0LCBbdGhpcy5fY3VycmVudFRyYW5zYWN0aW9uIHx8IHRoaXMuY29ubmVjdGlvbiwgcmVxdWVzdE9wdGlvbnNdKVxuICAgICAgICAgIDogdGhpcy5fY3VycmVudFRyYW5zYWN0aW9uXG4gICAgICAgICAgICA/IG5ldyBtc3NxbC5SZXF1ZXN0KHRoaXMuX2N1cnJlbnRUcmFuc2FjdGlvbilcbiAgICAgICAgICAgIDogbmV3IG1zc3FsLlJlcXVlc3QodGhpcy5jb25uZWN0aW9uKVxuICAgICAgICByZXN1bHQgPSBhd2FpdCByZXF1ZXN0LnF1ZXJ5KHNxbClcbiAgICAgICAgYnJlYWtcbiAgICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICAgIGlmIChlcnJvciBpbnN0YW5jZW9mIEVycm9yICYmIGVycm9yLm1lc3NhZ2UgPT0gXCJObyBjb25uZWN0aW9uIGlzIHNwZWNpZmllZCBmb3IgdGhhdCByZXF1ZXN0LlwiICYmIHRyaWVzIDw9IDMpIHtcbiAgICAgICAgICB0aGlzLmxvZ2dlci53YXJuKFwiUmVjb25uZWN0aW5nIHRvIGRhdGFiYXNlXCIpXG4gICAgICAgICAgYXdhaXQgdGhpcy5yZWNvbm5lY3QoKVxuICAgICAgICAgIC8vIFJldHJ5XG4gICAgICAgIH0gZWxzZSBpZiAoZXJyb3IgaW5zdGFuY2VvZiBFcnJvcikge1xuICAgICAgICAgIC8vIFJlLXRocm93IGVycm9yIGJlY2F1c2UgdGhlIHN0YWNrLXRyYWNlIGlzIGJyb2tlbiBhbmQgY2FuJ3QgYmUgdXNlZCBmb3IgYXBwLWRldmVsb3BtZW50LlxuICAgICAgICAgIHRocm93IG5ldyBFcnJvcihgUXVlcnkgZmFpbGVkICcke2Vycm9yLm1lc3NhZ2V9JzogJHtzcWx9YCwge2NhdXNlOiBlcnJvcn0pXG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgdGhyb3cgbmV3IEVycm9yKGBRdWVyeSBmYWlsZWQgJyR7ZXJyb3J9JzogJHtzcWx9YCwge2NhdXNlOiBlcnJvcn0pXG4gICAgICAgIH1cbiAgICAgIH1cbiAgICB9XG5cbiAgICByZXR1cm4gQXJyYXkuaXNBcnJheShyZXN1bHQucmVjb3Jkc2V0cykgPyByZXN1bHQucmVjb3Jkc2V0c1swXSB8fCBbXSA6IFtdXG4gIH1cblxuICAvKipcbiAgICogRXhlY3V0ZXMgYSBtdXRhdGlvbiB3aXRoIGFmZmVjdGVkLXJvdyBtZXRhZGF0YS5cbiAgICogQHBhcmFtIHtzdHJpbmd9IHNxbCAtIE11dGF0aW9uIFNRTC5cbiAgICogQHJldHVybnMge1Byb21pc2U8bnVtYmVyPn0gLSBBZmZlY3RlZCByb3cgY291bnQuXG4gICAqL1xuICBhc3luYyBfYWZmZWN0ZWRSb3dzQWN0dWFsKHNxbCkge1xuICAgIGNvbnN0IHJlcXVlc3QgPSB0aGlzLl9jdXJyZW50VHJhbnNhY3Rpb25cbiAgICAgID8gbmV3IG1zc3FsLlJlcXVlc3QodGhpcy5fY3VycmVudFRyYW5zYWN0aW9uKVxuICAgICAgOiBuZXcgbXNzcWwuUmVxdWVzdCh0aGlzLmNvbm5lY3Rpb24pXG4gICAgY29uc3QgcmVzdWx0ID0gYXdhaXQgcmVxdWVzdC5xdWVyeShzcWwpXG4gICAgcmV0dXJuIHJlc3VsdC5yb3dzQWZmZWN0ZWQucmVkdWNlKCh0b3RhbCwgY291bnQpID0+IHRvdGFsICsgY291bnQsIDApXG4gIH1cblxuICAvKipcbiAgICogUnVucyBxdWVyeSB0byBzcWwuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vLi4vcXVlcnkvaW5kZXguanNcIikuZGVmYXVsdH0gcXVlcnkgLSBRdWVyeSBpbnN0YW5jZS5cbiAgICogQHJldHVybnMge3N0cmluZ30gLSBTUUwgc3RyaW5nLlxuICAgKi9cbiAgcXVlcnlUb1NxbChxdWVyeSkgeyByZXR1cm4gbmV3IFF1ZXJ5UGFyc2VyKHtxdWVyeX0pLnRvU3FsKCkgfVxuXG4gIHNob3VsZFNldEF1dG9JbmNyZW1lbnRXaGVuUHJpbWFyeUtleSgpIHsgcmV0dXJuIHRydWUgfVxuICBzdXBwb3J0c0RlZmF1bHRQcmltYXJ5S2V5VVVJRCgpIHsgcmV0dXJuIHRydWUgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGFuIGV4cGxpY2l0IHByaW1hcnkta2V5IGluc2VydCBhcyBvbmUgYmF0Y2ggcmVxdWVzdDogU1FMIFNlcnZlciBzY29wZXNcbiAgICogSURFTlRJVFlfSU5TRVJUIHRvIHRoZSBzZXNzaW9uLCBhbmQgbm9kZS1tc3NxbCBwb29sLWJhY2tlZCByZXF1ZXN0cyBtYXkgdXNlXG4gICAqIGEgZGlmZmVyZW50IHBoeXNpY2FsIHNlc3Npb24gcGVyIHF1ZXJ5LCBzbyBlbmFibGluZyBpdCBpbiBhIHNlcGFyYXRlIHF1ZXJ5XG4gICAqIGNhbiBsZWF2ZSB0aGUgYWN0dWFsIElOU0VSVCBvbiBhbm90aGVyIHNlc3Npb24uIEEgc2luZ2xlIGJhdGNoIGtlZXBzIHRoZVxuICAgKiB3aG9sZSBzZXF1ZW5jZSBvbiBvbmUgc2Vzc2lvbiBieSBjb25zdHJ1Y3Rpb246IGVuYWJsZSwgaW5zZXJ0LCBkaXNhYmxlIG9uXG4gICAqIHN1Y2Nlc3MsIGFuZCBhIENBVENIIHRoYXQgZGlzYWJsZXMgYW5kIHJldGhyb3dzIHRoZSBvcmlnaW5hbCBlcnJvci5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBPcHRpb25zIG9iamVjdC5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9iYXNlLmpzXCIpLlF1ZXJ5T3B0aW9uc30gYXJncy5vcHRpb25zIC0gUXVlcnkgb3B0aW9ucyBmb3IgdGhlIHN0YW5kYXJkIHF1ZXJ5IHBhdGguXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBhcmdzLnNxbCAtIEdlbmVyYXRlZCBpbnNlcnQgU1FMLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gYXJncy50YWJsZU5hbWUgLSBUYWJsZSBiZWluZyBpbnNlcnRlZCBpbnRvLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxpbXBvcnQoXCIuLi9iYXNlLmpzXCIpLlF1ZXJ5UmVzdWx0VHlwZT59IC0gSW5zZXJ0IHJlc3VsdC5cbiAgICovXG4gIGFzeW5jIGluc2VydFdpdGhFeHBsaWNpdFByaW1hcnlLZXkoe29wdGlvbnMsIHNxbCwgdGFibGVOYW1lfSkge1xuICAgIGNvbnN0IHF1b3RlZFRhYmxlID0gdGhpcy5xdW90ZVRhYmxlKHRhYmxlTmFtZSlcbiAgICBjb25zdCBiYXRjaCA9IFtcbiAgICAgIGBTRVQgSURFTlRJVFlfSU5TRVJUICR7cXVvdGVkVGFibGV9IE9OO2AsXG4gICAgICBcIkJFR0lOIFRSWVwiLFxuICAgICAgYCR7c3FsfTtgLFxuICAgICAgYFNFVCBJREVOVElUWV9JTlNFUlQgJHtxdW90ZWRUYWJsZX0gT0ZGO2AsXG4gICAgICBcIkVORCBUUllcIixcbiAgICAgIFwiQkVHSU4gQ0FUQ0hcIixcbiAgICAgIGBTRVQgSURFTlRJVFlfSU5TRVJUICR7cXVvdGVkVGFibGV9IE9GRjtgLFxuICAgICAgXCJUSFJPVztcIixcbiAgICAgIFwiRU5EIENBVENIXCJcbiAgICBdLmpvaW4oXCJcXG5cIilcblxuICAgIHJldHVybiBhd2FpdCB0aGlzLnF1ZXJ5KGJhdGNoLCBvcHRpb25zKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZXNjYXBlLlxuICAgKiBAcGFyYW0ge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSB2YWx1ZSAtIFZhbHVlIHRvIHVzZS5cbiAgICogQHJldHVybnMge3N0cmluZ30gLSBUaGUgZXNjYXBlLlxuICAgKi9cbiAgZXNjYXBlKHZhbHVlKSB7XG4gICAgdmFsdWUgPSB0aGlzLl9jb252ZXJ0VmFsdWUodmFsdWUpXG4gICAgY29uc3Qgc3RyaW5nVmFsdWUgPSB0eXBlb2YgdmFsdWUgPT0gXCJzdHJpbmdcIiA/IHZhbHVlIDogYCR7dmFsdWV9YFxuXG4gICAgY29uc3QgcmVzdWx0V2l0aFF1b3RlcyA9IGVzY2FwZVN0cmluZyhzdHJpbmdWYWx1ZSwgbnVsbClcbiAgICBjb25zdCByZXN1bHQgPSByZXN1bHRXaXRoUXVvdGVzLnN1YnN0cmluZygxLCByZXN1bHRXaXRoUXVvdGVzLmxlbmd0aCAtIDEpXG5cbiAgICByZXR1cm4gcmVzdWx0XG4gIH1cblxuICAvKipcbiAgICogUnVucyBxdW90ZS5cbiAgICogQHBhcmFtIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gdmFsdWUgLSBWYWx1ZSB0byB1c2UuXG4gICAqIEByZXR1cm5zIHtzdHJpbmcgfCBudW1iZXJ9IC0gVGhlIHF1b3RlZCB2YWx1ZS5cbiAgICovXG4gIHF1b3RlKHZhbHVlKSB7XG4gICAgdmFsdWUgPSB0aGlzLl9jb252ZXJ0VmFsdWUodmFsdWUpXG5cbiAgICBpZiAodHlwZW9mIHZhbHVlID09IFwibnVtYmVyXCIpIHJldHVybiB2YWx1ZVxuICAgIGNvbnN0IHN0cmluZ1ZhbHVlID0gdHlwZW9mIHZhbHVlID09IFwic3RyaW5nXCIgPyB2YWx1ZSA6IFN0cmluZyh2YWx1ZSlcblxuICAgIHJldHVybiBgTiR7ZXNjYXBlU3RyaW5nKHN0cmluZ1ZhbHVlLCBudWxsKX1gXG4gIH1cblxuICAvKipcbiAgICogUnVucyBxdW90ZSBjb2x1bW4uXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBjb2x1bW5OYW1lIC0gQ29sdW1uIG5hbWUuXG4gICAqIEByZXR1cm5zIHtzdHJpbmd9IC0gVGhlIHF1b3RlIGNvbHVtbi5cbiAgICovXG4gIHF1b3RlQ29sdW1uKGNvbHVtbk5hbWUpIHsgcmV0dXJuIHRoaXMub3B0aW9ucygpLnF1b3RlQ29sdW1uTmFtZShjb2x1bW5OYW1lKSB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgcXVvdGUgdGFibGUuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBzdHJpbmcgLSBTdHJpbmcuXG4gICAqIEByZXR1cm5zIHtzdHJpbmd9IC0gVGhlIHF1b3RlIHRhYmxlLlxuICAgKi9cbiAgcXVvdGVUYWJsZShzdHJpbmcpIHsgcmV0dXJuIHRoaXMub3B0aW9ucygpLnF1b3RlVGFibGVOYW1lKHN0cmluZykgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHJlbmFtZSBjb2x1bW4uXG4gICAqIEBwYXJhbSB7c3RyaW5nfSB0YWJsZU5hbWUgLSBUYWJsZSBuYW1lLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gb2xkQ29sdW1uTmFtZSAtIFByZXZpb3VzIGNvbHVtbiBuYW1lLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gbmV3Q29sdW1uTmFtZSAtIE5ldyBjb2x1bW4gbmFtZS5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgd2hlbiBjb21wbGV0ZS5cbiAgICovXG4gIGFzeW5jIHJlbmFtZUNvbHVtbih0YWJsZU5hbWUsIG9sZENvbHVtbk5hbWUsIG5ld0NvbHVtbk5hbWUpIHtcbiAgICBhd2FpdCB0aGlzLnF1ZXJ5KGBFWEVDIHNwX3JlbmFtZSAke3RoaXMucXVvdGUoYCR7dGFibGVOYW1lfS4ke29sZENvbHVtbk5hbWV9YCl9LCAke3RoaXMucXVvdGUobmV3Q29sdW1uTmFtZSl9LCAnQ09MVU1OJ2ApXG4gIH1cblxuICAvKipcbiAgICogUnVucyBkZWxldGUgc3FsLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL2Jhc2UuanNcIikuRGVsZXRlU3FsQXJnc1R5cGV9IGFyZ3MgLSBPcHRpb25zIG9iamVjdC5cbiAgICogQHJldHVybnMge3N0cmluZ30gLSBTUUwgc3RyaW5nLlxuICAgKi9cbiAgZGVsZXRlU3FsKHt0YWJsZU5hbWUsIGNvbmRpdGlvbnN9KSB7XG4gICAgY29uc3QgZGVsZXRlSW5zdHJ1Y3Rpb24gPSBuZXcgRGVsZXRlKHtjb25kaXRpb25zLCBkcml2ZXI6IHRoaXMsIHRhYmxlTmFtZX0pXG5cbiAgICByZXR1cm4gZGVsZXRlSW5zdHJ1Y3Rpb24udG9TcWwoKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgaW5zZXJ0IHNxbC5cbiAgICogQGFic3RyYWN0XG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vYmFzZS5qc1wiKS5JbnNlcnRTcWxBcmdzVHlwZX0gYXJncyAtIE9wdGlvbnMgb2JqZWN0LlxuICAgKiBAcmV0dXJucyB7c3RyaW5nfSAtIFNRTCBzdHJpbmcuXG4gICAqL1xuICBpbnNlcnRTcWwoYXJncykge1xuICAgIGNvbnN0IGluc2VydEFyZ3MgPSBPYmplY3QuYXNzaWduKHtkcml2ZXI6IHRoaXN9LCBhcmdzKVxuICAgIGNvbnN0IGluc2VydCA9IG5ldyBJbnNlcnQoaW5zZXJ0QXJncylcblxuICAgIHJldHVybiBpbnNlcnQudG9TcWwoKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZ2V0IHRhYmxlcy5cbiAgICogQHJldHVybnMge1Byb21pc2U8QXJyYXk8aW1wb3J0KFwiLi4vYmFzZS10YWJsZS5qc1wiKS5kZWZhdWx0Pj59IC0gUmVzb2x2ZXMgd2l0aCB0aGUgdGFibGVzLlxuICAgKi9cbiAgYXN5bmMgZ2V0VGFibGVzKCkge1xuICAgIHJldHVybiBhd2FpdCB0aGlzLl9jYWNoZWRTY2hlbWFNZXRhZGF0YShcInRhYmxlc1wiLCBhc3luYyAoKSA9PiB7XG4gICAgICBjb25zdCBzY2hlbWEgPSB0aGlzLmdldEFyZ3MoKT8uc2NoZW1hIHx8IHRoaXMuZ2V0QXJncygpPy5zcWxDb25maWc/Lm9wdGlvbnM/LnNjaGVtYVxuICAgICAgY29uc3Qgc2NoZW1hQ2xhdXNlID0gc2NoZW1hXG4gICAgICAgID8gYCBBTkQgW1RBQkxFX1NDSEVNQV0gPSAke3RoaXMucXVvdGUoc2NoZW1hKX1gXG4gICAgICAgIDogXCIgQU5EIFtUQUJMRV9TQ0hFTUFdID0gU0NIRU1BX05BTUUoKVwiXG4gICAgICBjb25zdCByZXN1bHQgPSBhd2FpdCB0aGlzLnF1ZXJ5KGBTRUxFQ1QgW1RBQkxFX05BTUVdIEZST00gW0lORk9STUFUSU9OX1NDSEVNQV0uW1RBQkxFU10gV0hFUkUgW1RBQkxFX0NBVEFMT0ddID0gREJfTkFNRSgpJHtzY2hlbWFDbGF1c2V9YClcbiAgICAgIGNvbnN0IHRhYmxlcyA9IFtdXG5cbiAgICAgIGZvciAoY29uc3Qgcm93IG9mIHJlc3VsdCkge1xuICAgICAgICBjb25zdCB0YWJsZSA9IG5ldyBUYWJsZSh0aGlzLCAvKiogQHR5cGUge1JlY29yZDxzdHJpbmcsIHN0cmluZz59ICovIChyb3cpKVxuXG4gICAgICAgIHRhYmxlcy5wdXNoKHRhYmxlKVxuICAgICAgfVxuXG4gICAgICByZXR1cm4gdGFibGVzXG4gICAgfSlcbiAgfVxuXG4gIC8qKlxuICAgKiBUcnVuY2F0ZXMgYWxsIGVsaWdpYmxlIHRhYmxlcyBpbiBvbmUgU1FMIFNlcnZlciByZXF1ZXN0LCByZXRhaW5pbmcgdGhlXG4gICAqIHJlY29nbml6ZWQgZm9yZWlnbi1rZXkgZmFsbGJhY2sgdXNlZCBieSB0aGUgcGVyLXRhYmxlIGltcGxlbWVudGF0aW9uLlxuICAgKiBAcGFyYW0ge0FycmF5PGltcG9ydChcIi4uL2Jhc2UtdGFibGUuanNcIikuZGVmYXVsdD59IHRhYmxlcyAtIEVsaWdpYmxlIHRhYmxlcy5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgd2hlbiB0aGUgYmF0Y2ggY29tcGxldGVzLlxuICAgKi9cbiAgYXN5bmMgdHJ1bmNhdGVUYWJsZXModGFibGVzKSB7XG4gICAgY29uc3Qgc3RhdGVtZW50cyA9IFtdXG5cbiAgICBmb3IgKGNvbnN0IHRhYmxlIG9mIHRhYmxlcykge1xuICAgICAgY29uc3QgcXVvdGVkVGFibGUgPSB0aGlzLnF1b3RlVGFibGUodGFibGUuZ2V0TmFtZSgpKVxuXG4gICAgICBzdGF0ZW1lbnRzLnB1c2goXG4gICAgICAgIFwiQkVHSU4gVFJZXCIsXG4gICAgICAgIGAgIFRSVU5DQVRFIFRBQkxFICR7cXVvdGVkVGFibGV9O2AsXG4gICAgICAgIFwiRU5EIFRSWVwiLFxuICAgICAgICBcIkJFR0lOIENBVENIXCIsXG4gICAgICAgIFwiICBJRiBFUlJPUl9OVU1CRVIoKSA9IDQ3MTJcIixcbiAgICAgICAgXCIgIEJFR0lOXCIsXG4gICAgICAgIGAgICAgREVMRVRFIEZST00gJHtxdW90ZWRUYWJsZX07YCxcbiAgICAgICAgXCIgIEVORFwiLFxuICAgICAgICBcIiAgRUxTRVwiLFxuICAgICAgICBcIiAgQkVHSU5cIixcbiAgICAgICAgXCIgICAgVEhST1c7XCIsXG4gICAgICAgIFwiICBFTkRcIixcbiAgICAgICAgXCJFTkQgQ0FUQ0g7XCJcbiAgICAgIClcbiAgICB9XG5cbiAgICBhd2FpdCB0aGlzLnF1ZXJ5KHN0YXRlbWVudHMuam9pbihcIlxcblwiKSlcbiAgfVxuXG4gIGFzeW5jIGxhc3RJbnNlcnRJRChvcHRpb25zID0ge30pIHtcbiAgICBjb25zdCByZXN1bHQgPSBhd2FpdCB0aGlzLnF1ZXJ5KFwiU0VMRUNUIFNDT1BFX0lERU5USVRZKCkgQVMgbGFzdF9pbnNlcnRfaWRcIiwgb3B0aW9ucylcbiAgICBjb25zdCBsYXN0SW5zZXJ0SUQgPSBkaWdnKHJlc3VsdCwgMCwgXCJsYXN0X2luc2VydF9pZFwiKVxuXG4gICAgaWYgKGxhc3RJbnNlcnRJRCA9PT0gbnVsbCkgdGhyb3cgbmV3IEVycm9yKFwiQ291bGRuJ3QgZ2V0IHRoZSBsYXN0IGluc2VydGVkIElEXCIpXG5cbiAgICByZXR1cm4gbGFzdEluc2VydElEXG4gIH1cblxuICAvKipcbiAgICogUnVucyBvcHRpb25zLlxuICAgKiBAcmV0dXJucyB7T3B0aW9uc30gLSBUaGUgb3B0aW9ucyBvcHRpb25zLlxuICAgKi9cbiAgb3B0aW9ucygpIHtcbiAgICBpZiAoIXRoaXMuX29wdGlvbnMpIHRoaXMuX29wdGlvbnMgPSBuZXcgT3B0aW9ucyh7ZHJpdmVyOiB0aGlzfSlcblxuICAgIHJldHVybiB0aGlzLl9vcHRpb25zXG4gIH1cblxuICBhc3luYyBfc3RhcnRUcmFuc2FjdGlvbkFjdGlvbigpIHtcbiAgICBhd2FpdCB0aGlzLl9ydW5QaHlzaWNhbENvbm5lY3Rpb25SZXF1ZXN0KGFzeW5jICgpID0+IHtcbiAgICAgIGlmICh0aGlzLl9jdXJyZW50VHJhbnNhY3Rpb24pIHRocm93IG5ldyBFcnJvcihcIkEgdHJhbnNhY3Rpb24gaXMgYWxyZWFkeSBydW5uaW5nXCIpXG4gICAgICBpZiAoIXRoaXMuY29ubmVjdGlvbikgYXdhaXQgdGhpcy5jb25uZWN0KClcblxuICAgICAgdGhpcy5fY3VycmVudFRyYW5zYWN0aW9uID0gbmV3IG1zc3FsLlRyYW5zYWN0aW9uKHRoaXMuY29ubmVjdGlvbilcblxuICAgICAgdHJ5IHtcbiAgICAgICAgYXdhaXQgdGhpcy5fY3VycmVudFRyYW5zYWN0aW9uLmJlZ2luKClcbiAgICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICAgIHRoaXMuX2N1cnJlbnRUcmFuc2FjdGlvbiA9IG51bGxcbiAgICAgICAgdGhyb3cgZXJyb3JcbiAgICAgIH1cbiAgICB9KVxuICB9XG5cbiAgYXN5bmMgX2NvbW1pdFRyYW5zYWN0aW9uQWN0aW9uKCkge1xuICAgIGF3YWl0IHRoaXMuX3J1blBoeXNpY2FsQ29ubmVjdGlvblJlcXVlc3QoYXN5bmMgKCkgPT4ge1xuICAgICAgaWYgKCF0aGlzLl9jdXJyZW50VHJhbnNhY3Rpb24pIHRocm93IG5ldyBFcnJvcihcIkEgdHJhbnNhY3Rpb24gaXNuJ3QgcnVubmluZ1wiKVxuXG4gICAgICBhd2FpdCB0aGlzLl9jdXJyZW50VHJhbnNhY3Rpb24uY29tbWl0KClcbiAgICAgIHRoaXMuX2N1cnJlbnRUcmFuc2FjdGlvbiA9IG51bGxcbiAgICB9KVxuICB9XG5cbiAgYXN5bmMgX3JvbGxiYWNrVHJhbnNhY3Rpb25BY3Rpb24oKSB7XG4gICAgYXdhaXQgdGhpcy5fcnVuUGh5c2ljYWxDb25uZWN0aW9uUmVxdWVzdChhc3luYyAoKSA9PiB7XG4gICAgICBpZiAoIXRoaXMuX2N1cnJlbnRUcmFuc2FjdGlvbikge1xuICAgICAgICB0aGlzLmxvZ2dlci5kZWJ1ZyhcIkEgdHJhbnNhY3Rpb24gaXNuJ3QgcnVubmluZyAtIGlnbm9yaW5nIGJlY2F1c2UgdGhhdCBjYW4gaGFwcGVuIGlmIHNvbWV0aGluZyBlbHNlIGhhcyBmYWlsZWQgaW4gdGhlIGRiXCIpXG4gICAgICAgIHJldHVyblxuICAgICAgfVxuXG4gICAgICB0cnkge1xuICAgICAgICBhd2FpdCB0aGlzLl9jdXJyZW50VHJhbnNhY3Rpb24ucm9sbGJhY2soKVxuICAgICAgfSBjYXRjaCAodHJhbnNhY3Rpb25Sb2xsYmFja0Vycm9yKSB7XG4gICAgICAgIC8vIFdoZW4gU1FMIFNlcnZlciBoYXMgYWxyZWFkeSBhYm9ydGVkIHRoZSB0cmFuc2FjdGlvbiAoZS5nLiwgYVxuICAgICAgICAvLyBzdGFsZSBjb25jdXJyZW50IHJlcXVlc3QgdHJpZ2dlcmVkIFhBQ1RfQUJPUlQpLCB0aGVcbiAgICAgICAgLy8gbXNzcWwuVHJhbnNhY3Rpb24ucm9sbGJhY2soKSBjYWxsIGZhaWxzIGJlY2F1c2UgdGhlXG4gICAgICAgIC8vIFRyYW5zYWN0aW9uIG9iamVjdCBpcyBkZWFkLiAgSXNzdWUgYSByYXcgUk9MTEJBQ0sgb24gdGhlXG4gICAgICAgIC8vIHVuZGVybHlpbmcgY29ubmVjdGlvbiB0byBjbGVhciBTUUwgU2VydmVyJ3Mgc2Vzc2lvbi1sZXZlbFxuICAgICAgICAvLyBhYm9ydGVkLXRyYW5zYWN0aW9uIHN0YXRlIHNvIHRoZSBjb25uZWN0aW9uIGlzIHVzYWJsZSBmb3IgdGhlXG4gICAgICAgIC8vIG5leHQgQkVHSU4gVFJBTlNBQ1RJT04uXG4gICAgICAgIHRoaXMubG9nZ2VyLndhcm4oXCJUcmFuc2FjdGlvbi5yb2xsYmFjaygpIGZhaWxlZCwgY2xlYXJpbmcgc2Vzc2lvbiBzdGF0ZSB3aXRoIHJhdyBST0xMQkFDS1wiLCB7XG4gICAgICAgICAgZXJyb3I6IHRyYW5zYWN0aW9uUm9sbGJhY2tFcnJvciBpbnN0YW5jZW9mIEVycm9yID8gdHJhbnNhY3Rpb25Sb2xsYmFja0Vycm9yLm1lc3NhZ2UgOiB0cmFuc2FjdGlvblJvbGxiYWNrRXJyb3JcbiAgICAgICAgfSlcblxuICAgICAgICBjb25zdCByZXF1ZXN0ID0gbmV3IG1zc3FsLlJlcXVlc3QodGhpcy5jb25uZWN0aW9uKVxuXG4gICAgICAgIGF3YWl0IHJlcXVlc3QucXVlcnkoXCJJRiBAQFRSQU5DT1VOVCA+IDAgUk9MTEJBQ0tcIilcbiAgICAgIH0gZmluYWxseSB7XG4gICAgICAgIHRoaXMuX2N1cnJlbnRUcmFuc2FjdGlvbiA9IG51bGxcbiAgICAgIH1cbiAgICB9KVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgc3RhcnQgc2F2ZSBwb2ludCBhY3Rpb24uXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBzYXZlUG9pbnROYW1lIC0gU2F2ZSBwb2ludCBuYW1lLlxuICAgKiBAcGFyYW0ge1BpY2s8aW1wb3J0KFwiLi4vYmFzZS5qc1wiKS5RdWVyeU9wdGlvbnMsIFwib3BlcmF0aW9uT3duZXJcIj59IFtvcHRpb25zXSAtIFRyYW5zYWN0aW9uIG93bmVyc2hpcC5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgd2hlbiBjb21wbGV0ZS5cbiAgICovXG4gIGFzeW5jIF9zdGFydFNhdmVQb2ludEFjdGlvbihzYXZlUG9pbnROYW1lLCBvcHRpb25zID0ge30pIHtcbiAgICBhd2FpdCB0aGlzLnF1ZXJ5KGBTQVZFIFRSQU5TQUNUSU9OIFske3NhdmVQb2ludE5hbWV9XWAsIG9wdGlvbnMpXG4gIH1cblxuICAvKipcbiAgICogUnVucyByZWxlYXNlIHNhdmUgcG9pbnQgYWN0aW9uLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gc2F2ZVBvaW50TmFtZSAtIFNhdmUgcG9pbnQgbmFtZS5cbiAgICogQHBhcmFtIHtQaWNrPGltcG9ydChcIi4uL2Jhc2UuanNcIikuUXVlcnlPcHRpb25zLCBcIm9wZXJhdGlvbk93bmVyXCI+fSBbX29wdGlvbnNdIC0gVHJhbnNhY3Rpb24gb3duZXJzaGlwLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyB3aGVuIGNvbXBsZXRlLlxuICAgKi9cbiAgYXN5bmMgX3JlbGVhc2VTYXZlUG9pbnRBY3Rpb24oc2F2ZVBvaW50TmFtZSwgX29wdGlvbnMgPSB7fSkge1xuICAgIC8vIERvIG5vdGhpbmcgaW4gTVMtU1FMLlxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgcm9sbGJhY2sgc2F2ZSBwb2ludCBhY3Rpb24uXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBzYXZlUG9pbnROYW1lIC0gU2F2ZSBwb2ludCBuYW1lLlxuICAgKiBAcGFyYW0ge1BpY2s8aW1wb3J0KFwiLi4vYmFzZS5qc1wiKS5RdWVyeU9wdGlvbnMsIFwib3BlcmF0aW9uT3duZXJcIj59IFtvcHRpb25zXSAtIFRyYW5zYWN0aW9uIG93bmVyc2hpcC5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgd2hlbiBjb21wbGV0ZS5cbiAgICovXG4gIGFzeW5jIF9yb2xsYmFja1NhdmVQb2ludEFjdGlvbihzYXZlUG9pbnROYW1lLCBvcHRpb25zID0ge30pIHtcbiAgICB0cnkge1xuICAgICAgYXdhaXQgdGhpcy5xdWVyeShgUk9MTEJBQ0sgVFJBTlNBQ1RJT04gWyR7c2F2ZVBvaW50TmFtZX1dYCwgb3B0aW9ucylcbiAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgY29uc3QgbWVzc2FnZSA9IGVycm9yIGluc3RhbmNlb2YgRXJyb3IgPyBlcnJvci5tZXNzYWdlIDogYCR7ZXJyb3J9YFxuXG4gICAgICAvLyBXaGVuIFhBQ1RfQUJPUlQga2lsbHMgdGhlIGVudGlyZSB0cmFuc2FjdGlvbiwgdGhlIHNhdmVwb2ludFxuICAgICAgLy8gbm8gbG9uZ2VyIGV4aXN0cyBhbmQgdGhlIFJPTExCQUNLIFRSQU5TQUNUSU9OIFtuYW1lXSBmYWlscy5cbiAgICAgIC8vIElzc3VlIGEgcmF3IElGIEBAVFJBTkNPVU5UID4gMCBST0xMQkFDSyB0byBjbGVhciB3aGF0ZXZlclxuICAgICAgLy8gc2Vzc2lvbiBzdGF0ZSByZW1haW5zLCB0aGVuIGxldCB0aGUgZXJyb3IgcHJvcGFnYXRlIHNvIHRoZVxuICAgICAgLy8gb3V0ZXIgdHJhbnNhY3Rpb24oKSBjYWxsIGtub3dzIHRoZSB0cmFuc2FjdGlvbiBpcyBkZWFkLlxuICAgICAgaWYgKG1lc3NhZ2UuaW5jbHVkZXMoXCJUcmFuc2FjdGlvbiBoYXMgbm90IGJlZ3VuXCIpIHx8IG1lc3NhZ2UuaW5jbHVkZXMoXCJUcmFuc2FjdGlvbiBoYXMgYmVlbiBhYm9ydGVkXCIpKSB7XG4gICAgICAgIHRoaXMubG9nZ2VyLmRlYnVnKFwiU2F2ZXBvaW50IHJvbGxiYWNrIGZhaWxlZDsgdHJhbnNhY3Rpb24gYWxyZWFkeSBkZWFkLCBjbGVhcmluZyBzZXNzaW9uIHN0YXRlXCIpXG5cbiAgICAgICAgY29uc3QgcmVxdWVzdCA9IG5ldyBtc3NxbC5SZXF1ZXN0KHRoaXMuY29ubmVjdGlvbilcblxuICAgICAgICBhd2FpdCByZXF1ZXN0LnF1ZXJ5KFwiSUYgQEBUUkFOQ09VTlQgPiAwIFJPTExCQUNLXCIpXG5cbiAgICAgICAgcmV0dXJuXG4gICAgICB9XG5cbiAgICAgIHRocm93IGVycm9yXG4gICAgfVxuICB9XG5cbiAgZ2VuZXJhdGVTYXZlUG9pbnROYW1lKCkge1xuICAgIHJldHVybiBgc3Ake25ldyBVVUlEKDQpLmZvcm1hdCgpLnJlcGxhY2VBbGwoXCItXCIsIFwiXCIpfWAuc3Vic3RyaW5nKDAsIDMyKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgdXBkYXRlIHNxbC5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9iYXNlLmpzXCIpLlVwZGF0ZVNxbEFyZ3NUeXBlfSBhcmdzIC0gT3B0aW9ucyBvYmplY3QuXG4gICAqIEByZXR1cm5zIHtzdHJpbmd9IC0gU1FMIHN0cmluZy5cbiAgICovXG4gIHVwZGF0ZVNxbCh7Y29uZGl0aW9ucywgZGF0YSwgdGFibGVOYW1lfSkge1xuICAgIGNvbnN0IHVwZGF0ZSA9IG5ldyBVcGRhdGUoe2NvbmRpdGlvbnMsIGRhdGEsIGRyaXZlcjogdGhpcywgdGFibGVOYW1lfSlcblxuICAgIHJldHVybiB1cGRhdGUudG9TcWwoKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgdXBzZXJ0IHNxbC5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9iYXNlLmpzXCIpLlVwc2VydFNxbEFyZ3NUeXBlfSBhcmdzIC0gT3B0aW9ucyBvYmplY3QuXG4gICAqIEByZXR1cm5zIHtzdHJpbmd9IC0gU1FMIHN0cmluZy5cbiAgICovXG4gIHVwc2VydFNxbChhcmdzKSB7XG4gICAgY29uc3QgdXBzZXJ0ID0gbmV3IFVwc2VydCh7Li4uYXJncywgZHJpdmVyOiB0aGlzfSlcblxuICAgIHJldHVybiB1cHNlcnQudG9TcWwoKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgc3RydWN0dXJlIHNxbC5cbiAgICogQHJldHVybnMge1Byb21pc2U8c3RyaW5nIHwgbnVsbD59IC0gUmVzb2x2ZXMgd2l0aCBTUUwgc3RyaW5nLlxuICAgKi9cbiAgYXN5bmMgc3RydWN0dXJlU3FsKCkge1xuICAgIHJldHVybiBhd2FpdCB0aGlzLl9jYWNoZWRTY2hlbWFNZXRhZGF0YShcInN0cnVjdHVyZVNxbFwiLCBhc3luYyAoKSA9PiBhd2FpdCBuZXcgU3RydWN0dXJlU3FsKHtkcml2ZXI6IHRoaXN9KS50b1NxbCgpKVxuICB9XG5cbiAgLyoqXG4gICAqIEJsb2NrcyB1bnRpbCBhIFNRTCBTZXJ2ZXIgYXBwbGljYXRpb24gbG9jayBpcyBhY3F1aXJlZCBvbiB0aGlzXG4gICAqIGNvbm5lY3Rpb24gdmlhIGBzcF9nZXRhcHBsb2NrYC4gVGhlIFNlc3Npb24gbG9jayBvd25lciBzY29wZXMgdGhlIGxvY2tcbiAgICogdG8gdGhlIGN1cnJlbnQgc2Vzc2lvbiwgbWF0Y2hpbmcgdGhlIGNvbm5lY3Rpb24tc2NvcGVkIHNlbWFudGljcyBvblxuICAgKiBNeVNRTCBhbmQgUG9zdGdyZVNRTC5cbiAgICpcbiAgICogYHNwX2dldGFwcGxvY2tgIHJldHVybnMgMCBvbiBpbW1lZGlhdGUgZ3JhbnQsIDEgYWZ0ZXIgd2FpdGluZywgYW5kXG4gICAqIG5lZ2F0aXZlIHZhbHVlcyBvbiBmYWlsdXJlICh0aW1lb3V0LCBkZWFkbG9jaywgY2FuY2VsZWQsIHBhcmFtZXRlclxuICAgKiBlcnJvcikuIFdlIHRyZWF0IDAvMSBhcyBzdWNjZXNzIGFuZCAtMSAodGltZW91dCkgYXMgYSBjbGVhbiBgZmFsc2VgO1xuICAgKiBhbnl0aGluZyBlbHNlIHRocm93cy5cbiAgICogQHBhcmFtIHtzdHJpbmd9IG5hbWUgLSBMb2NrIG5hbWUuXG4gICAqIEBwYXJhbSB7e3RpbWVvdXRNcz86IG51bWJlciB8IG51bGx9fSBbYXJnc10gLSBPcHRpb25hbCB0aW1lb3V0IGluIG1pbGxpc2Vjb25kczsgYG51bGxgLCBgdW5kZWZpbmVkYCwgb3IgbmVnYXRpdmUgYmxvY2tzIGZvcmV2ZXIuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPGJvb2xlYW4+fSAtIFRydWUgaWYgdGhlIGxvY2sgd2FzIGFjcXVpcmVkLCBmYWxzZSBpZiB0aGUgdGltZW91dCBlbGFwc2VkLlxuICAgKi9cbiAgYXN5bmMgX2FjcXVpcmVBZHZpc29yeUxvY2sobmFtZSwge3RpbWVvdXRNc30gPSB7fSkge1xuICAgIGNvbnN0IHRpbWVvdXRWYWx1ZSA9IHR5cGVvZiB0aW1lb3V0TXMgPT09IFwibnVtYmVyXCIgJiYgdGltZW91dE1zID49IDAgPyBNYXRoLmNlaWwodGltZW91dE1zKSA6IC0xXG4gICAgY29uc3Qgcm93cyA9IGF3YWl0IHRoaXMuX2Fkdmlzb3J5TG9ja1F1ZXJ5KFxuICAgICAgYERFQ0xBUkUgQHZlbG9jaW91c19hZHZpc29yeV9sb2NrX3Jlc3VsdCBJTlQ7IEVYRUMgQHZlbG9jaW91c19hZHZpc29yeV9sb2NrX3Jlc3VsdCA9IHNwX2dldGFwcGxvY2sgQFJlc291cmNlID0gJHt0aGlzLnF1b3RlKG5hbWUpfSwgQExvY2tNb2RlID0gJ0V4Y2x1c2l2ZScsIEBMb2NrT3duZXIgPSAnU2Vzc2lvbicsIEBMb2NrVGltZW91dCA9ICR7dGltZW91dFZhbHVlfTsgU0VMRUNUIEB2ZWxvY2lvdXNfYWR2aXNvcnlfbG9ja19yZXN1bHQgQVMgdmVsb2Npb3VzX2Fkdmlzb3J5X2xvY2tfcmVzdWx0YFxuICAgIClcbiAgICBjb25zdCByZXN1bHQgPSBOdW1iZXIocm93cz8uWzBdPy52ZWxvY2lvdXNfYWR2aXNvcnlfbG9ja19yZXN1bHQpXG5cbiAgICBpZiAocmVzdWx0ID09PSAwIHx8IHJlc3VsdCA9PT0gMSkgcmV0dXJuIHRydWVcblxuICAgIGF3YWl0IHRoaXMuX2Nsb3NlQWR2aXNvcnlMb2NrVHJhbnNhY3Rpb24oKVxuXG4gICAgaWYgKHJlc3VsdCA9PT0gLTEpIHJldHVybiBmYWxzZVxuXG4gICAgdGhyb3cgbmV3IEVycm9yKGBzcF9nZXRhcHBsb2NrIHJldHVybmVkICR7cmVzdWx0fSBmb3IgYWR2aXNvcnkgbG9jayAke0pTT04uc3RyaW5naWZ5KG5hbWUpfSAoc2VlIFNRTCBTZXJ2ZXIgZG9jdW1lbnRhdGlvbiBmb3Igc3BfZ2V0YXBwbG9jayByZXR1cm4gY29kZXMpYClcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHRyeSBhY3F1aXJlIGFkdmlzb3J5IGxvY2suXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBuYW1lIC0gTG9jayBuYW1lLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxib29sZWFuPn0gLSBUcnVlIGlmIHRoZSBsb2NrIHdhcyBhY3F1aXJlZCwgZmFsc2UgaWYgaXQgd2FzIGFscmVhZHkgaGVsZC5cbiAgICovXG4gIGFzeW5jIF90cnlBY3F1aXJlQWR2aXNvcnlMb2NrKG5hbWUpIHtcbiAgICByZXR1cm4gYXdhaXQgdGhpcy5fYWNxdWlyZUFkdmlzb3J5TG9jayhuYW1lLCB7dGltZW91dE1zOiAwfSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHJlbGVhc2UgYWR2aXNvcnkgbG9jay5cbiAgICpcbiAgICogYHNwX3JlbGVhc2VhcHBsb2NrYCByZXR1cm5zIDAgd2hlbiB0aGUgbG9jayB3YXMgcmVsZWFzZWQsIGJ1dCBTUUwgU2VydmVyXG4gICAqIHJhaXNlcyBlcnJvciB7QGxpbmsgQVBQTE9DS19OT1RfSEVMRF9FUlJPUl9OVU1CRVJ9IGluc3RlYWQgb2YgcmV0dXJuaW5nIGFcbiAgICogZmFpbHVyZSBjb2RlIHdoZW4gdGhlIHNlc3Npb24gZG9lcyBub3QgY3VycmVudGx5IGhvbGQgdGhlIGxvY2suIFRoYXRcbiAgICogZXJyb3IgYWJvcnRzIHRoZSBiYXRjaCBiZWZvcmUgdGhlIHRyYWlsaW5nIGBTRUxFQ1RgIGNhbiBydW4sIHNvIHdlIGNhdGNoXG4gICAqIGl0IGFuZCByZXNvbHZlIHRvIGBmYWxzZWAgdG8gaG9ub3IgdGhlIGNyb3NzLWRyaXZlciBjb250cmFjdCBmb3IgYW5cbiAgICogYWxyZWFkeS11bmhlbGQgbG9jay5cbiAgICogQHBhcmFtIHtzdHJpbmd9IG5hbWUgLSBMb2NrIG5hbWUuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPGJvb2xlYW4+fSAtIFRydWUgaWYgdGhlIGxvY2sgd2FzIGhlbGQgYnkgdGhpcyBzZXNzaW9uIGFuZCBoYXMgbm93IGJlZW4gcmVsZWFzZWQuXG4gICAqL1xuICBhc3luYyBfcmVsZWFzZUFkdmlzb3J5TG9jayhuYW1lKSB7XG4gICAgbGV0IHJvd3NcblxuICAgIHRyeSB7XG4gICAgICByb3dzID0gYXdhaXQgdGhpcy5fYWR2aXNvcnlMb2NrUXVlcnkoXG4gICAgICAgIGBERUNMQVJFIEB2ZWxvY2lvdXNfYWR2aXNvcnlfbG9ja19yZXN1bHQgSU5UOyBFWEVDIEB2ZWxvY2lvdXNfYWR2aXNvcnlfbG9ja19yZXN1bHQgPSBzcF9yZWxlYXNlYXBwbG9jayBAUmVzb3VyY2UgPSAke3RoaXMucXVvdGUobmFtZSl9LCBATG9ja093bmVyID0gJ1Nlc3Npb24nOyBTRUxFQ1QgQHZlbG9jaW91c19hZHZpc29yeV9sb2NrX3Jlc3VsdCBBUyB2ZWxvY2lvdXNfYWR2aXNvcnlfbG9ja19yZXN1bHRgXG4gICAgICApXG4gICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgIGlmICh0aGlzLl9pc0FwcGxvY2tOb3RIZWxkRXJyb3IoZXJyb3IpKSB7XG4gICAgICAgIGF3YWl0IHRoaXMuX2Nsb3NlQWR2aXNvcnlMb2NrVHJhbnNhY3Rpb25JZkZpbmFsUmVsZWFzZSgpXG5cbiAgICAgICAgcmV0dXJuIGZhbHNlXG4gICAgICB9XG5cbiAgICAgIHRocm93IGVycm9yXG4gICAgfVxuXG4gICAgY29uc3QgcmVzdWx0ID0gTnVtYmVyKHJvd3M/LlswXT8udmVsb2Npb3VzX2Fkdmlzb3J5X2xvY2tfcmVzdWx0KVxuXG4gICAgYXdhaXQgdGhpcy5fY2xvc2VBZHZpc29yeUxvY2tUcmFuc2FjdGlvbklmRmluYWxSZWxlYXNlKClcblxuICAgIHJldHVybiByZXN1bHQgPT09IDBcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGFuIGFkdmlzb3J5LWxvY2sgc3RhdGVtZW50IHRocm91Z2ggb25lIHRyYW5zYWN0aW9uIHJlcXVlc3QgcGFyZW50LlxuICAgKiBub2RlLW1zc3FsIHJlc2VydmVzIG9uZSBwaHlzaWNhbCBzZXNzaW9uIGZvciBhIFRyYW5zYWN0aW9uLCB3aGVyZWFzXG4gICAqIHNlcGFyYXRlIENvbm5lY3Rpb25Qb29sIHJlcXVlc3RzIG1heSBjaGVjayBvdXQgZGlmZmVyZW50IHNlc3Npb25zLiBUaGVcbiAgICogdHJhbnNhY3Rpb24gY29udGFpbnMgb25seSBhcHBsaWNhdGlvbi1sb2NrIHN0YXRlbWVudHM7IGNhbGxlci9tb2RlbCB3b3JrXG4gICAqIGNvbnRpbnVlcyB0aHJvdWdoIGl0cyBvcmlnaW5hbCBjb25uZWN0aW9uLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gc3FsIC0gQWR2aXNvcnktbG9jayBTUUwuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPGltcG9ydChcIi4uL2Jhc2UuanNcIikuUXVlcnlSZXN1bHRUeXBlPn0gLSBSZXN1bHQgcm93cy5cbiAgICovXG4gIGFzeW5jIF9hZHZpc29yeUxvY2tRdWVyeShzcWwpIHtcbiAgICBjb25zdCB0cmFuc2FjdGlvbiA9IGF3YWl0IHRoaXMuX2Vuc3VyZUFkdmlzb3J5TG9ja1RyYW5zYWN0aW9uKClcblxuICAgIHRyeSB7XG4gICAgICBjb25zdCByZXF1ZXN0ID0gbmV3IG1zc3FsLlJlcXVlc3QodHJhbnNhY3Rpb24pXG4gICAgICBjb25zdCByZXN1bHQgPSBhd2FpdCByZXF1ZXN0LnF1ZXJ5KHNxbClcblxuICAgICAgcmV0dXJuIEFycmF5LmlzQXJyYXkocmVzdWx0LnJlY29yZHNldHMpID8gcmVzdWx0LnJlY29yZHNldHNbMF0gfHwgW10gOiBbXVxuICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICBpZiAoZXJyb3IgaW5zdGFuY2VvZiBFcnJvcikge1xuICAgICAgICB0aHJvdyBuZXcgRXJyb3IoYFF1ZXJ5IGZhaWxlZCAnJHtlcnJvci5tZXNzYWdlfSc6ICR7c3FsfWAsIHtjYXVzZTogZXJyb3J9KVxuICAgICAgfVxuXG4gICAgICB0aHJvdyBuZXcgRXJyb3IoYFF1ZXJ5IGZhaWxlZCAnJHtlcnJvcn0nOiAke3NxbH1gLCB7Y2F1c2U6IGVycm9yfSlcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogU3RhcnRzIHRoZSB0cmFuc2FjdGlvbiByZXF1ZXN0IHBhcmVudCB0aGF0IHJlc2VydmVzIHRoZSBhZHZpc29yeS1sb2NrXG4gICAqIHNlc3Npb24gdW50aWwgdGhlIGZpbmFsIHJlbGVhc2Ugb3IgZHJpdmVyIGNsb3NlLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxpbXBvcnQoXCJtc3NxbFwiKS5UcmFuc2FjdGlvbj59IC0gU2Vzc2lvbi1hZmZpbmUgcGFyZW50LlxuICAgKi9cbiAgYXN5bmMgX2Vuc3VyZUFkdmlzb3J5TG9ja1RyYW5zYWN0aW9uKCkge1xuICAgIGlmICh0aGlzLl9hZHZpc29yeUxvY2tUcmFuc2FjdGlvbikgcmV0dXJuIHRoaXMuX2Fkdmlzb3J5TG9ja1RyYW5zYWN0aW9uXG4gICAgaWYgKCF0aGlzLmNvbm5lY3Rpb24pIGF3YWl0IHRoaXMuY29ubmVjdCgpXG4gICAgaWYgKCF0aGlzLmNvbm5lY3Rpb24pIHRocm93IG5ldyBFcnJvcihcIk1TU1FMIGNvbm5lY3Rpb24gdW5hdmFpbGFibGUgZm9yIGFkdmlzb3J5IGxvY2tcIilcblxuICAgIGNvbnN0IHRyYW5zYWN0aW9uID0gbmV3IG1zc3FsLlRyYW5zYWN0aW9uKHRoaXMuY29ubmVjdGlvbilcblxuICAgIGF3YWl0IHRyYW5zYWN0aW9uLmJlZ2luKClcbiAgICB0aGlzLl9hZHZpc29yeUxvY2tUcmFuc2FjdGlvbiA9IHRyYW5zYWN0aW9uXG5cbiAgICByZXR1cm4gdHJhbnNhY3Rpb25cbiAgfVxuXG4gIC8qKlxuICAgKiBSZWxlYXNlcyB0aGUgcmVzZXJ2ZWQgc2Vzc2lvbiBhZnRlciB0aGUgbGFzdCB0cmFja2VkIGxvY2sgcmVsZWFzZS5cbiAgICogQmFzZSB1bnRyYWNrcyB0aGUgY3VycmVudCByZWxlYXNlIGFmdGVyIHRoZSBkcml2ZXIgaG9vayByZXR1cm5zLCBzbyBhXG4gICAqIGN1cnJlbnQgdG90YWwgb2Ygb25lIG1lYW5zIHRoaXMgaXMgdGhlIGZpbmFsIHJlbGVhc2UuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIGFmdGVyIGNsZWFudXAgd2hlbiB0aGlzIGlzIGZpbmFsLlxuICAgKi9cbiAgYXN5bmMgX2Nsb3NlQWR2aXNvcnlMb2NrVHJhbnNhY3Rpb25JZkZpbmFsUmVsZWFzZSgpIHtcbiAgICBsZXQgaGVsZENvdW50ID0gMFxuXG4gICAgZm9yIChjb25zdCBjb3VudCBvZiB0aGlzLl9oZWxkQWR2aXNvcnlMb2Nrcy52YWx1ZXMoKSkgaGVsZENvdW50ICs9IGNvdW50XG5cbiAgICBpZiAoaGVsZENvdW50IDw9IDEpIGF3YWl0IHRoaXMuX2Nsb3NlQWR2aXNvcnlMb2NrVHJhbnNhY3Rpb24oKVxuICB9XG5cbiAgLyoqXG4gICAqIFJvbGxzIGJhY2sgdGhlIG90aGVyd2lzZS1lbXB0eSB0cmFuc2FjdGlvbiBhbmQgcmV0dXJucyBpdHMgcGh5c2ljYWxcbiAgICogc2Vzc2lvbiB0byBub2RlLW1zc3FsLiBSb2xsYmFjayBpcyBjbGVhbnVwIG9ubHk7IGFkdmlzb3J5IGxvY2tzIGFyZVxuICAgKiBleHBsaWNpdGx5IHJlbGVhc2VkIGZpcnN0IHdoZW5ldmVyIHRoZWlyIHJlbGVhc2Ugc3RhdGVtZW50IHN1Y2NlZWRzLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyBhZnRlciBzZXNzaW9uIGNsZWFudXAuXG4gICAqL1xuICBhc3luYyBfY2xvc2VBZHZpc29yeUxvY2tUcmFuc2FjdGlvbigpIHtcbiAgICBjb25zdCB0cmFuc2FjdGlvbiA9IHRoaXMuX2Fkdmlzb3J5TG9ja1RyYW5zYWN0aW9uXG5cbiAgICBpZiAoIXRyYW5zYWN0aW9uKSByZXR1cm5cblxuICAgIHRoaXMuX2Fkdmlzb3J5TG9ja1RyYW5zYWN0aW9uID0gbnVsbFxuICAgIGF3YWl0IHRyYW5zYWN0aW9uLnJvbGxiYWNrKClcbiAgfVxuXG4gIC8qKlxuICAgKiBEZXRlY3RzIHRoZSBTUUwgU2VydmVyIFwiYXBwbGljYXRpb24gbG9jayBpcyBub3QgY3VycmVudGx5IGhlbGRcIiBlcnJvclxuICAgKiByYWlzZWQgYnkgYHNwX3JlbGVhc2VhcHBsb2NrYC4gSXQgd2Fsa3MgdGhlIHdyYXBwZWQtZXJyb3IgY2F1c2UgY2hhaW5cbiAgICogYmVjYXVzZSBgcXVlcnlgIHJlLXdyYXBzIHRoZSBkcml2ZXIncyBgUmVxdWVzdEVycm9yYCBpbiBhIHBsYWluIGBFcnJvcmAsXG4gICAqIGFuZCBtYXRjaGVzIG9uIHRoZSBzdGFibGUgbnVtZXJpYyBlcnJvciBudW1iZXIgcmF0aGVyIHRoYW4gdGhlIG1lc3NhZ2UuXG4gICAqIEBwYXJhbSB7dW5rbm93bn0gZXJyb3IgLSBFcnJvciB0aHJvd24gd2hpbGUgcmVsZWFzaW5nIHRoZSBsb2NrLlxuICAgKiBAcmV0dXJucyB7Ym9vbGVhbn0gLSBUcnVlIGlmIHRoZSBlcnJvciBtZWFucyB0aGUgbG9jayB3YXMgbm90IGhlbGQgYnkgdGhpcyBzZXNzaW9uLlxuICAgKi9cbiAgX2lzQXBwbG9ja05vdEhlbGRFcnJvcihlcnJvcikge1xuICAgIGxldCBjdXJyZW50ID0gZXJyb3JcblxuICAgIHdoaWxlIChjdXJyZW50IGluc3RhbmNlb2YgRXJyb3IpIHtcbiAgICAgIGNvbnN0IGVycm9yTnVtYmVyID0gLyoqIEB0eXBlIHt7bnVtYmVyPzogdW5rbm93bn19ICovIChjdXJyZW50KS5udW1iZXJcblxuICAgICAgaWYgKHR5cGVvZiBlcnJvck51bWJlciA9PT0gXCJudW1iZXJcIiAmJiBlcnJvck51bWJlciA9PT0gQVBQTE9DS19OT1RfSEVMRF9FUlJPUl9OVU1CRVIpIHJldHVybiB0cnVlXG5cbiAgICAgIGN1cnJlbnQgPSBjdXJyZW50LmNhdXNlXG4gICAgfVxuXG4gICAgcmV0dXJuIGZhbHNlXG4gIH1cblxuICAvKipcbiAgICogUmV0dXJucyB0cnVlIGlmIGFueSBzZXNzaW9uIGN1cnJlbnRseSBob2xkcyB0aGUgYXBwbGljYXRpb24gbG9jay5cbiAgICpcbiAgICogVGhpcyBjb21iaW5lcyB0d28gcHJvYmVzIGJlY2F1c2UgbmVpdGhlciBpcyBzdWZmaWNpZW50IG9uIGl0cyBvd246XG4gICAqICAgLSBgQVBQTE9DS19NT0RFKC4uLiwgJ1Nlc3Npb24nKWAgb25seSByZXBvcnRzIGxvY2tzIGhlbGQgYnkgdGhlXG4gICAqICAgICAqKmN1cnJlbnQqKiBzZXNzaW9uLCBzbyBpdCBtaXNzZXMgbG9ja3MgaGVsZCBieSBhbnkgb3RoZXJcbiAgICogICAgIHNlc3Npb24gYW5kIHdvdWxkIHJldHVybiBgTm9Mb2NrYCBldmVuIHVuZGVyIGNyb3NzLXNlc3Npb25cbiAgICogICAgIGNvbnRlbnRpb24uXG4gICAqICAgLSBgQVBQTE9DS19URVNUKC4uLiwgJ0V4Y2x1c2l2ZScsICdTZXNzaW9uJylgIHJldHVybnMgd2hldGhlciBhblxuICAgKiAgICAgRXhjbHVzaXZlIGxvY2sgY291bGQgYmUgZ3JhbnRlZCB0byAqdGhpcyogc2Vzc2lvbiByaWdodCBub3cuIEFcbiAgICogICAgIHJldHVybiB2YWx1ZSBvZiAwIG1lYW5zIHNvbWVib2R5IGVsc2UgaG9sZHMgYW4gaW5jb21wYXRpYmxlXG4gICAqICAgICBsb2NrOyBhIHZhbHVlIG9mIDEgbWVhbnMgaXQgaXMgZWl0aGVyIGZyZWUgKipvcioqIGFscmVhZHkgaGVsZFxuICAgKiAgICAgYnkgdXMgcmUtZW50cmFudGx5ICh3aGljaCB0aGUgYEFQUExPQ0tfTU9ERWAgY2hlY2sgY2F0Y2hlcykuXG4gICAqXG4gICAqIFRoZSBjb21iaW5lZCByZXN1bHQgaXMgXCJoZWxkXCIgaWZmIHdlIGhvbGQgaXQgb3Vyc2VsdmVzIG9yXG4gICAqIGBBUFBMT0NLX1RFU1RgIHJlcG9ydHMgd2UgY2Fubm90IGFjcXVpcmUgaXQgd2l0aG91dCB3YWl0aW5nLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gbmFtZSAtIExvY2sgbmFtZS5cbiAgICogQHJldHVybnMge1Byb21pc2U8Ym9vbGVhbj59IC0gVHJ1ZSBpZiBhbnkgc2Vzc2lvbiBjdXJyZW50bHkgaG9sZHMgdGhlIGxvY2suXG4gICAqL1xuICBhc3luYyBpc0Fkdmlzb3J5TG9ja0hlbGQobmFtZSkge1xuICAgIGNvbnN0IHJvd3MgPSBhd2FpdCB0aGlzLnF1ZXJ5KFxuICAgICAgYFNFTEVDVCBgICtcbiAgICAgICAgYEFQUExPQ0tfTU9ERSgncHVibGljJywgJHt0aGlzLnF1b3RlKG5hbWUpfSwgJ1Nlc3Npb24nKSBBUyB2ZWxvY2lvdXNfYWR2aXNvcnlfc2VsZl9tb2RlLCBgICtcbiAgICAgICAgYEFQUExPQ0tfVEVTVCgncHVibGljJywgJHt0aGlzLnF1b3RlKG5hbWUpfSwgJ0V4Y2x1c2l2ZScsICdTZXNzaW9uJykgQVMgdmVsb2Npb3VzX2Fkdmlzb3J5X3Rlc3RfcmVzdWx0YFxuICAgIClcbiAgICBjb25zdCBzZWxmTW9kZSA9IHJvd3M/LlswXT8udmVsb2Npb3VzX2Fkdmlzb3J5X3NlbGZfbW9kZVxuICAgIGNvbnN0IGhlbGRCeVNlbGYgPSB0eXBlb2Ygc2VsZk1vZGUgPT09IFwic3RyaW5nXCIgJiYgc2VsZk1vZGUubGVuZ3RoID4gMCAmJiBzZWxmTW9kZSAhPT0gXCJOb0xvY2tcIlxuXG4gICAgaWYgKGhlbGRCeVNlbGYpIHJldHVybiB0cnVlXG5cbiAgICBjb25zdCB0ZXN0UmVzdWx0ID0gTnVtYmVyKHJvd3M/LlswXT8udmVsb2Npb3VzX2Fkdmlzb3J5X3Rlc3RfcmVzdWx0KVxuXG4gICAgcmV0dXJuIHRlc3RSZXN1bHQgPT09IDBcbiAgfVxufVxuIl19