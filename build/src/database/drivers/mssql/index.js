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
const DISABLE_FOREIGN_KEYS_SQL = "EXEC sp_MSforeachtable \"ALTER TABLE ? NOCHECK CONSTRAINT all\"";
const ENABLE_FOREIGN_KEYS_SQL = "EXEC sp_MSforeachtable @command1=\"print '?'\", @command2=\"ALTER TABLE ? WITH CHECK CHECK CONSTRAINT all\"";
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
        await this._execConstraintToggle(DISABLE_FOREIGN_KEYS_SQL, "disableForeignKeys");
    }
    /**
     * Re-enables and re-validates every foreign key constraint (`WITH CHECK`).
     * @returns {Promise<void>} - Resolves when foreign keys are enabled.
     */
    async enableForeignKeys() {
        await this._execConstraintToggle(ENABLE_FOREIGN_KEYS_SQL, "enableForeignKeys");
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
     * Keeps constraint toggles and cleanup inside each physical SQL Server
     * request so a pool cannot split lifecycle ownership across sessions.
     * @protected
     * @param {Array<import("../base-table.js").default>} tables - Eligible tables.
     * @returns {Promise<void>} - Resolves after one cleanup attempt succeeds.
     */
    async _truncateAllTables(tables) {
        await this._truncateAllTablesWithRetries(tables);
    }
    /**
     * Runs one fail-loud cleanup batch with restoration on both success and
     * failure. The outer retry owner refreshes stale table snapshots.
     * @protected
     * @param {Array<import("../base-table.js").default>} tables - Current eligible tables.
     * @returns {Promise<void>} - Resolves after the batch completes.
     */
    async _truncateAllTablesAttempt(tables) {
        const statements = [
            "BEGIN TRY",
            `  ${DISABLE_FOREIGN_KEYS_SQL};`,
            ...this._truncateTableStatements(tables),
            `  ${ENABLE_FOREIGN_KEYS_SQL};`,
            "END TRY",
            "BEGIN CATCH",
            `  ${ENABLE_FOREIGN_KEYS_SQL};`,
            "  THROW;",
            "END CATCH;"
        ];
        await this.query(statements.join("\n"));
    }
    /**
     * Truncates all eligible tables in one SQL Server request, retaining the
     * recognized foreign-key fallback used by the per-table implementation.
     * @param {Array<import("../base-table.js").default>} tables - Eligible tables.
     * @returns {Promise<void>} - Resolves when the batch completes.
     */
    async truncateTables(tables) {
        await this.query(this._truncateTableStatements(tables).join("\n"));
    }
    /**
     * Builds the per-table truncate/delete-fallback statements.
     * @param {Array<import("../base-table.js").default>} tables - Eligible tables.
     * @returns {string[]} - SQL statements.
     */
    _truncateTableStatements(tables) {
        const statements = [];
        for (const table of tables) {
            const quotedTable = this.quoteTable(table.getName());
            statements.push("BEGIN TRY", `  TRUNCATE TABLE ${quotedTable};`, "END TRY", "BEGIN CATCH", "  IF ERROR_NUMBER() = 4712", "  BEGIN", `    DELETE FROM ${quotedTable};`, "  END", "  ELSE", "  BEGIN", "    THROW;", "  END", "END CATCH;");
        }
        return statements;
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiaW5kZXguanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi8uLi8uLi9zcmMvZGF0YWJhc2UvZHJpdmVycy9tc3NxbC9pbmRleC5qcyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiQUFBQSxZQUFZO0FBRVosT0FBTyxVQUFVLE1BQU0sc0JBQXNCLENBQUE7QUFDN0MsT0FBTyxJQUFJLE1BQU0sWUFBWSxDQUFBO0FBQzdCLE9BQU8sY0FBYyxNQUFNLDBCQUEwQixDQUFBO0FBQ3JELE9BQU8sV0FBVyxNQUFNLHVCQUF1QixDQUFBO0FBQy9DLE9BQU8sV0FBVyxNQUFNLHVCQUF1QixDQUFBO0FBQy9DLE9BQU8sTUFBTSxNQUFNLGlCQUFpQixDQUFBO0FBQ3BDLE9BQU8sWUFBWSxNQUFNLHdCQUF3QixDQUFBO0FBQ2pELE9BQU8sU0FBUyxNQUFNLHFCQUFxQixDQUFBO0FBQzNDLE9BQU8sRUFBQyxJQUFJLEVBQUMsTUFBTSxXQUFXLENBQUE7QUFDOUIsT0FBTyxZQUFZLE1BQU0sbUJBQW1CLENBQUE7QUFDNUMsT0FBTyxNQUFNLE1BQU0saUJBQWlCLENBQUE7QUFDcEMsT0FBTyxPQUFPLE1BQU0sY0FBYyxDQUFBO0FBQ2xDLE9BQU8sS0FBSyxNQUFNLE9BQU8sQ0FBQTtBQUN6QixPQUFPLEdBQUcsTUFBTSxVQUFVLENBQUE7QUFDMUIsT0FBTyxXQUFXLE1BQU0sbUJBQW1CLENBQUE7QUFDM0MsT0FBTyxXQUFXLE1BQU0sdUJBQXVCLENBQUE7QUFDL0MsT0FBTyxLQUFLLE1BQU0sWUFBWSxDQUFBO0FBQzlCLE9BQU8sWUFBWSxNQUFNLG9CQUFvQixDQUFBO0FBQzdDLE9BQU8sT0FBTyxNQUFNLDJCQUEyQixDQUFBO0FBQy9DLE9BQU8sTUFBTSxNQUFNLGlCQUFpQixDQUFBO0FBQ3BDLE9BQU8sTUFBTSxNQUFNLGlCQUFpQixDQUFBO0FBQ3BDLE9BQU8sSUFBSSxNQUFNLFdBQVcsQ0FBQTtBQUU1Qjs7Ozs7Ozs7R0FRRztBQUNILE1BQU0sNkJBQTZC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QUksRUFBRSxDQUFDLENBQUMsQ0FBQyxFQUFFLDRCQUE0QixDQUFBO1FBQ3hELE1BQU0sVUFBVSxHQUFHLE9BQU8sUUFBUSxLQUFLLFFBQVEsSUFBSSxRQUFRLENBQUMsTUFBTSxHQUFHLENBQUMsSUFBSSxRQUFRLEtBQUssUUFBUSxDQUFBO1FBRS9GLElBQUksVUFBVTtZQUFFLE9BQU8sSUFBSSxDQUFBO1FBRTNCLE1BQU0sVUFBVSxHQUFHLE1BQU0sQ0FBQyxJQUFJLEVBQUUsQ0FBQyxDQUFDLENBQUMsRUFBRSw4QkFBOEIsQ0FBQyxDQUFBO1FBRXBFLE9BQU8sVUFBVSxLQUFLLENBQUMsQ0FBQTtJQUN6QixDQUFDO0NBQ0YiLCJzb3VyY2VzQ29udGVudCI6WyIvLyBAdHMtY2hlY2tcblxuaW1wb3J0IEFsdGVyVGFibGUgZnJvbSBcIi4vc3FsL2FsdGVyLXRhYmxlLmpzXCJcbmltcG9ydCBCYXNlIGZyb20gXCIuLi9iYXNlLmpzXCJcbmltcG9ydCBDcmVhdGVEYXRhYmFzZSBmcm9tIFwiLi9zcWwvY3JlYXRlLWRhdGFiYXNlLmpzXCJcbmltcG9ydCBDcmVhdGVJbmRleCBmcm9tIFwiLi9zcWwvY3JlYXRlLWluZGV4LmpzXCJcbmltcG9ydCBDcmVhdGVUYWJsZSBmcm9tIFwiLi9zcWwvY3JlYXRlLXRhYmxlLmpzXCJcbmltcG9ydCBEZWxldGUgZnJvbSBcIi4vc3FsL2RlbGV0ZS5qc1wiXG5pbXBvcnQgRHJvcERhdGFiYXNlIGZyb20gXCIuL3NxbC9kcm9wLWRhdGFiYXNlLmpzXCJcbmltcG9ydCBEcm9wVGFibGUgZnJvbSBcIi4vc3FsL2Ryb3AtdGFibGUuanNcIlxuaW1wb3J0IHtkaWdnfSBmcm9tIFwiZGlnZ2VyaXplXCJcbmltcG9ydCBlc2NhcGVTdHJpbmcgZnJvbSBcInNxbC1lc2NhcGUtc3RyaW5nXCJcbmltcG9ydCBJbnNlcnQgZnJvbSBcIi4vc3FsL2luc2VydC5qc1wiXG5pbXBvcnQgT3B0aW9ucyBmcm9tIFwiLi9vcHRpb25zLmpzXCJcbmltcG9ydCBtc3NxbCBmcm9tIFwibXNzcWxcIlxuaW1wb3J0IG5ldCBmcm9tIFwibm9kZTpuZXRcIlxuaW1wb3J0IFF1ZXJ5UGFyc2VyIGZyb20gXCIuL3F1ZXJ5LXBhcnNlci5qc1wiXG5pbXBvcnQgUmVtb3ZlSW5kZXggZnJvbSBcIi4vc3FsL3JlbW92ZS1pbmRleC5qc1wiXG5pbXBvcnQgVGFibGUgZnJvbSBcIi4vdGFibGUuanNcIlxuaW1wb3J0IFN0cnVjdHVyZVNxbCBmcm9tIFwiLi9zdHJ1Y3R1cmUtc3FsLmpzXCJcbmltcG9ydCB0aW1lb3V0IGZyb20gXCJhd2FpdGVyeS9idWlsZC90aW1lb3V0LmpzXCJcbmltcG9ydCBVcHNlcnQgZnJvbSBcIi4vc3FsL3Vwc2VydC5qc1wiXG5pbXBvcnQgVXBkYXRlIGZyb20gXCIuL3NxbC91cGRhdGUuanNcIlxuaW1wb3J0IFVVSUQgZnJvbSBcInB1cmUtdXVpZFwiXG5cbi8qKlxuICogU1FMIFNlcnZlciBlcnJvciBudW1iZXIgcmFpc2VkIGJ5IGBzcF9yZWxlYXNlYXBwbG9ja2Agd2hlbiB0aGUgY3VycmVudFxuICogc2Vzc2lvbiBkb2VzIG5vdCBob2xkIHRoZSByZXF1ZXN0ZWQgYXBwbGljYXRpb24gbG9jay4gUmVsZWFzaW5nIGEgbG9jayB0aGVcbiAqIHNlc3Npb24gbm8gbG9uZ2VyIGhvbGRzIGlzIGEgbm9ybWFsIHJhY2UgKGEgc2hhcmVkIGNvbm5lY3Rpb24ncyBmaW5hbFxuICogY2hlY2staW4gbWF5IGFscmVhZHkgaGF2ZSBhdXRvLXJlbGVhc2VkIGl0KSwgd2hpY2ggdGhlIGNyb3NzLWRyaXZlclxuICogYHJlbGVhc2VBZHZpc29yeUxvY2tgIGNvbnRyYWN0IG1vZGVscyBieSByZXNvbHZpbmcgdG8gYGZhbHNlYC4gV2UgdHJhbnNsYXRlXG4gKiB0aGlzIHNwZWNpZmljIGVycm9yIGludG8gdGhhdCByZXN1bHQgcmF0aGVyIHRoYW4gbGV0dGluZyBpdCBlc2NhcGUuXG4gKiBAdHlwZSB7bnVtYmVyfVxuICovXG5jb25zdCBBUFBMT0NLX05PVF9IRUxEX0VSUk9SX05VTUJFUiA9IDEyMjNcbmNvbnN0IERJU0FCTEVfRk9SRUlHTl9LRVlTX1NRTCA9IFwiRVhFQyBzcF9NU2ZvcmVhY2h0YWJsZSBcXFwiQUxURVIgVEFCTEUgPyBOT0NIRUNLIENPTlNUUkFJTlQgYWxsXFxcIlwiXG5jb25zdCBFTkFCTEVfRk9SRUlHTl9LRVlTX1NRTCA9IFwiRVhFQyBzcF9NU2ZvcmVhY2h0YWJsZSBAY29tbWFuZDE9XFxcInByaW50ICc/J1xcXCIsIEBjb21tYW5kMj1cXFwiQUxURVIgVEFCTEUgPyBXSVRIIENIRUNLIENIRUNLIENPTlNUUkFJTlQgYWxsXFxcIlwiXG5cbmV4cG9ydCBkZWZhdWx0IGNsYXNzIFZlbG9jaW91c0RhdGFiYXNlRHJpdmVyc01zc3FsIGV4dGVuZHMgQmFzZXtcbiAgLyoqIEB0eXBlIHtpbXBvcnQoXCJtc3NxbFwiKS5UcmFuc2FjdGlvbiB8IG51bGx9ICovXG4gIF9hZHZpc29yeUxvY2tUcmFuc2FjdGlvbiA9IG51bGxcblxuICBhc3luYyBjb25uZWN0KCkge1xuICAgIGNvbnN0IGFyZ3MgPSB0aGlzLmdldEFyZ3MoKVxuICAgIGNvbnN0IHNxbENvbmZpZyA9IGRpZ2coYXJncywgXCJzcWxDb25maWdcIilcblxuICAgIHRyeSB7XG4gICAgICBpZiAodGhpcy5jb25uZWN0aW9uKSBhd2FpdCB0aGlzLmNsb3NlKClcblxuICAgICAgaWYgKHNxbENvbmZpZykge1xuICAgICAgICBzcWxDb25maWcub3B0aW9ucyA9IE9iamVjdC5hc3NpZ24oe30sIHNxbENvbmZpZy5vcHRpb25zLCB7dXNlVVRDOiB0cnVlfSlcbiAgICAgIH1cblxuICAgICAgaWYgKHNxbENvbmZpZz8uc2VydmVyICYmICFzcWxDb25maWcub3B0aW9ucz8uc2VydmVyTmFtZSAmJiBuZXQuaXNJUChzcWxDb25maWcuc2VydmVyKSkge1xuICAgICAgICBzcWxDb25maWcub3B0aW9ucyA9IE9iamVjdC5hc3NpZ24oe30sIHNxbENvbmZpZy5vcHRpb25zLCB7c2VydmVyTmFtZTogXCJcIn0pXG4gICAgICB9XG5cbiAgICAgIHRoaXMuY29ubmVjdGlvbiA9IG5ldyBtc3NxbC5Db25uZWN0aW9uUG9vbChzcWxDb25maWcpXG4gICAgICBhd2FpdCB0aGlzLmNvbm5lY3Rpb24uY29ubmVjdCgpXG4gICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgIC8vIFJlLXRocm93IHRvIGZpeCB1bnVzZWFibGUgc3RhY2sgdHJhY2UuXG4gICAgICB0aHJvdyBuZXcgRXJyb3IoYENvdWxkbid0IGNvbm5lY3QgdG8gZGF0YWJhc2U6ICR7ZXJyb3IgaW5zdGFuY2VvZiBFcnJvciA/IGVycm9yLm1lc3NhZ2UgOiBlcnJvcn1gLCB7Y2F1c2U6IGVycm9yfSlcbiAgICB9XG4gIH1cblxuICBhc3luYyBfY2xvc2UoKSB7XG4gICAgaWYgKCF0aGlzLmNvbm5lY3Rpb24pIHJldHVyblxuXG4gICAgY29uc3QgY29ubmVjdGlvbiA9IHRoaXMuY29ubmVjdGlvblxuICAgIHRoaXMuY29ubmVjdGlvbiA9IHVuZGVmaW5lZFxuICAgIHRoaXMuX2N1cnJlbnRUcmFuc2FjdGlvbiA9IG51bGxcbiAgICB0aGlzLl90cmFuc2FjdGlvbnNDb3VudCA9IDBcbiAgICAvKiogQHR5cGUge0Vycm9yIHwgdW5kZWZpbmVkfSAqL1xuICAgIGxldCBzZXNzaW9uRXJyb3JcblxuICAgIHRyeSB7XG4gICAgICBhd2FpdCB0aGlzLl9jbG9zZUFkdmlzb3J5TG9ja1RyYW5zYWN0aW9uKClcbiAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgc2Vzc2lvbkVycm9yID0gZXJyb3IgaW5zdGFuY2VvZiBFcnJvciA/IGVycm9yIDogbmV3IEVycm9yKFwiRmFpbGVkIHRvIGNsb3NlIE1TU1FMIGFkdmlzb3J5LWxvY2sgc2Vzc2lvblwiLCB7Y2F1c2U6IGVycm9yfSlcbiAgICB9XG5cbiAgICB0cnkge1xuICAgICAgYXdhaXQgdGltZW91dCh7dGltZW91dDogMjAwMH0sICgpID0+IGNvbm5lY3Rpb24uY2xvc2UoKSlcbiAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgdGhpcy5sb2dnZXIud2FybihcIkZhaWxlZCB0byBjbG9zZSBNU1NRTCBjb25uZWN0aW9uIGNsZWFubHlcIiwge2Vycm9yfSlcbiAgICB9XG5cbiAgICBpZiAoc2Vzc2lvbkVycm9yKSB0aHJvdyBzZXNzaW9uRXJyb3JcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGFsdGVyIHRhYmxlIHNxbHMuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vLi4vdGFibGUtZGF0YS9pbmRleC5qc1wiKS5kZWZhdWx0fSB0YWJsZURhdGEgLSBUYWJsZSBkYXRhLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxzdHJpbmdbXT59IC0gUmVzb2x2ZXMgd2l0aCBTUUwgc3RhdGVtZW50cy5cbiAgICovXG4gIGFzeW5jIGFsdGVyVGFibGVTUUxzKHRhYmxlRGF0YSkge1xuICAgIGNvbnN0IGFsdGVyQXJncyA9IHt0YWJsZURhdGEsIGRyaXZlcjogdGhpc31cbiAgICBjb25zdCBhbHRlclRhYmxlID0gbmV3IEFsdGVyVGFibGUoYWx0ZXJBcmdzKVxuXG4gICAgcmV0dXJuIGF3YWl0IGFsdGVyVGFibGUudG9TUUxzKClcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGNyZWF0ZSBkYXRhYmFzZSBzcWwuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBkYXRhYmFzZU5hbWUgLSBEYXRhYmFzZSBuYW1lLlxuICAgKiBAcGFyYW0ge29iamVjdH0gW2FyZ3NdIC0gT3B0aW9ucyBvYmplY3QuXG4gICAqIEBwYXJhbSB7Ym9vbGVhbn0gW2FyZ3MuaWZOb3RFeGlzdHNdIC0gV2hldGhlciBpZiBub3QgZXhpc3RzLlxuICAgKiBAcmV0dXJucyB7c3RyaW5nW119IC0gU1FMIHN0YXRlbWVudHMuXG4gICAqL1xuICBjcmVhdGVEYXRhYmFzZVNxbChkYXRhYmFzZU5hbWUsIGFyZ3MpIHtcbiAgICBjb25zdCBjcmVhdGVBcmdzID0gT2JqZWN0LmFzc2lnbih7ZGF0YWJhc2VOYW1lLCBkcml2ZXI6IHRoaXN9LCBhcmdzKVxuICAgIGNvbnN0IGNyZWF0ZURhdGFiYXNlID0gbmV3IENyZWF0ZURhdGFiYXNlKGNyZWF0ZUFyZ3MpXG5cbiAgICByZXR1cm4gY3JlYXRlRGF0YWJhc2UudG9TcWwoKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZHJvcCBkYXRhYmFzZSBzcWwuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBkYXRhYmFzZU5hbWUgLSBEYXRhYmFzZSBuYW1lLlxuICAgKiBAcGFyYW0ge29iamVjdH0gW2FyZ3NdIC0gT3B0aW9ucyBvYmplY3QuXG4gICAqIEBwYXJhbSB7Ym9vbGVhbn0gW2FyZ3MuaWZFeGlzdHNdIC0gV2hldGhlciBpZiBleGlzdHMuXG4gICAqIEByZXR1cm5zIHtzdHJpbmdbXX0gLSBTUUwgc3RhdGVtZW50cy5cbiAgICovXG4gIGRyb3BEYXRhYmFzZVNxbChkYXRhYmFzZU5hbWUsIGFyZ3MpIHtcbiAgICBjb25zdCBkcm9wQXJncyA9IE9iamVjdC5hc3NpZ24oe2RhdGFiYXNlTmFtZSwgZHJpdmVyOiB0aGlzfSwgYXJncylcbiAgICBjb25zdCBkcm9wRGF0YWJhc2UgPSBuZXcgRHJvcERhdGFiYXNlKGRyb3BBcmdzKVxuXG4gICAgcmV0dXJuIGRyb3BEYXRhYmFzZS50b1NxbCgpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBjcmVhdGUgaW5kZXggc3Fscy5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9iYXNlLmpzXCIpLkNyZWF0ZUluZGV4U3FsQXJnc30gaW5kZXhEYXRhIC0gSW5kZXggZGF0YS5cbiAgICogQHJldHVybnMge1Byb21pc2U8c3RyaW5nW10+fSAtIFJlc29sdmVzIHdpdGggU1FMIHN0YXRlbWVudHMuXG4gICAqL1xuICBhc3luYyBjcmVhdGVJbmRleFNRTHMoaW5kZXhEYXRhKSB7XG4gICAgY29uc3QgY3JlYXRlQXJncyA9IE9iamVjdC5hc3NpZ24oe2RyaXZlcjogdGhpc30sIGluZGV4RGF0YSlcbiAgICBjb25zdCBjcmVhdGVJbmRleCA9IG5ldyBDcmVhdGVJbmRleChjcmVhdGVBcmdzKVxuXG4gICAgcmV0dXJuIGF3YWl0IGNyZWF0ZUluZGV4LnRvU1FMcygpXG4gIH1cblxuICAvKipcbiAgICogUnVucyByZW1vdmUgaW5kZXggc3Fscy5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9iYXNlLmpzXCIpLlJlbW92ZUluZGV4U3FsQXJnc30gaW5kZXhEYXRhIC0gSW5kZXggZGF0YS5cbiAgICogQHJldHVybnMge1Byb21pc2U8c3RyaW5nW10+fSAtIFJlc29sdmVzIHdpdGggU1FMIHN0YXRlbWVudHMuXG4gICAqL1xuICBhc3luYyByZW1vdmVJbmRleFNRTHMoaW5kZXhEYXRhKSB7XG4gICAgY29uc3QgcmVtb3ZlQXJncyA9IE9iamVjdC5hc3NpZ24oe2RyaXZlcjogdGhpc30sIGluZGV4RGF0YSlcbiAgICBjb25zdCByZW1vdmVJbmRleCA9IG5ldyBSZW1vdmVJbmRleChyZW1vdmVBcmdzKVxuXG4gICAgcmV0dXJuIGF3YWl0IHJlbW92ZUluZGV4LnRvU1FMcygpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBjcmVhdGUgdGFibGUgc3FsLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uLy4uL3RhYmxlLWRhdGEvaW5kZXguanNcIikuZGVmYXVsdH0gdGFibGVEYXRhIC0gVGFibGUgZGF0YS5cbiAgICogQHJldHVybnMge1Byb21pc2U8c3RyaW5nW10+fSAtIFJlc29sdmVzIHdpdGggU1FMIHN0YXRlbWVudHMuXG4gICAqL1xuICBhc3luYyBjcmVhdGVUYWJsZVNxbCh0YWJsZURhdGEpIHtcbiAgICBjb25zdCBjcmVhdGVBcmdzID0ge3RhYmxlRGF0YSwgZHJpdmVyOiB0aGlzLCBpbmRleEluQ3JlYXRlVGFibGU6IGZhbHNlfVxuICAgIGNvbnN0IGNyZWF0ZVRhYmxlID0gbmV3IENyZWF0ZVRhYmxlKGNyZWF0ZUFyZ3MpXG5cbiAgICByZXR1cm4gYXdhaXQgY3JlYXRlVGFibGUudG9TcWwoKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgY3VycmVudCBkYXRhYmFzZS5cbiAgICogQHJldHVybnMge1Byb21pc2U8c3RyaW5nPn0gLSBSZXNvbHZlcyB3aXRoIHRoZSBjdXJyZW50IGRhdGFiYXNlLlxuICAgKi9cbiAgYXN5bmMgY3VycmVudERhdGFiYXNlKCkge1xuICAgIGNvbnN0IHJvd3MgPSBhd2FpdCB0aGlzLnF1ZXJ5KFwiU0VMRUNUIERCX05BTUUoKSBBUyBkYl9uYW1lXCIpXG5cbiAgICByZXR1cm4gZGlnZyhyb3dzLCAwLCBcImRiX25hbWVcIilcbiAgfVxuXG4gIC8qKlxuICAgKiBEaXNhYmxlcyBldmVyeSBmb3JlaWduIGtleSBjb25zdHJhaW50IChidWxrIGBOT0NIRUNLYCkuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIHdoZW4gZm9yZWlnbiBrZXlzIGFyZSBkaXNhYmxlZC5cbiAgICovXG4gIGFzeW5jIGRpc2FibGVGb3JlaWduS2V5cygpIHtcbiAgICBhd2FpdCB0aGlzLl9leGVjQ29uc3RyYWludFRvZ2dsZShESVNBQkxFX0ZPUkVJR05fS0VZU19TUUwsIFwiZGlzYWJsZUZvcmVpZ25LZXlzXCIpXG4gIH1cblxuICAvKipcbiAgICogUmUtZW5hYmxlcyBhbmQgcmUtdmFsaWRhdGVzIGV2ZXJ5IGZvcmVpZ24ga2V5IGNvbnN0cmFpbnQgKGBXSVRIIENIRUNLYCkuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIHdoZW4gZm9yZWlnbiBrZXlzIGFyZSBlbmFibGVkLlxuICAgKi9cbiAgYXN5bmMgZW5hYmxlRm9yZWlnbktleXMoKSB7XG4gICAgYXdhaXQgdGhpcy5fZXhlY0NvbnN0cmFpbnRUb2dnbGUoRU5BQkxFX0ZPUkVJR05fS0VZU19TUUwsIFwiZW5hYmxlRm9yZWlnbktleXNcIilcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGEgYnVsayBjb25zdHJhaW50LXRvZ2dsZSBzdGF0ZW1lbnQuIGBBTFRFUiBUQUJMRSAuLi4gTk9DSEVDSy9DSEVDS1xuICAgKiBDT05TVFJBSU5UYCBuZWVkcyBhIHNjaGVtYS1tb2RpZmljYXRpb24gbG9jayBvbiBldmVyeSB0YWJsZSwgc28gaWYgdGhlXG4gICAqIHJlcXVlc3QgdGltZXMgb3V0IGl0IGlzIGFsbW9zdCBhbHdheXMgYmxvY2tlZCBieSBhbm90aGVyIHNlc3Npb24gdGhhdCBpc1xuICAgKiBzdGlsbCBob2xkaW5nIGEgbG9jayAoYSBsZWFrZWQvdW5jb21taXR0ZWQgY29ubmVjdGlvbikuIE9uIGEgdGltZW91dCxcbiAgICogY2FwdHVyZSB3aGljaCBzZXNzaW9ucyB3ZXJlIGJsb2NraW5nIHNvIHRoZSByZWFsIGN1bHByaXQgaXMgbmFtZWQgaW5zdGVhZFxuICAgKiBvZiBsZWF2aW5nIGEgYmFyZSBcIlJlcXVlc3QgZmFpbGVkIHRvIGNvbXBsZXRlIGluIDE1MDAwbXNcIi5cbiAgICogQHBhcmFtIHtzdHJpbmd9IHNxbCAtIENvbnN0cmFpbnQtdG9nZ2xlIFNRTC5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGxhYmVsIC0gT3BlcmF0aW9uIGxhYmVsIGZvciB0aGUgZXJyb3IuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIHdoZW4gdGhlIHRvZ2dsZSBjb21wbGV0ZXMuXG4gICAqL1xuICBhc3luYyBfZXhlY0NvbnN0cmFpbnRUb2dnbGUoc3FsLCBsYWJlbCkge1xuICAgIHRyeSB7XG4gICAgICBhd2FpdCB0aGlzLnF1ZXJ5KHNxbClcbiAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgaWYgKGVycm9yIGluc3RhbmNlb2YgRXJyb3IgJiYgL1RpbWVvdXQ6IFJlcXVlc3QgZmFpbGVkIHRvIGNvbXBsZXRlL2kudGVzdChlcnJvci5tZXNzYWdlKSkge1xuICAgICAgICBjb25zdCBzbmFwc2hvdCA9IGF3YWl0IHRoaXMuX2NhcHR1cmVCbG9ja2luZ1Nlc3Npb25zRm9yRGVidWcoKS5jYXRjaChcbiAgICAgICAgICAoZGlhZ0Vycm9yKSA9PiBgKGJsb2NraW5nIGRpYWdub3N0aWNzIHF1ZXJ5IGZhaWxlZDogJHtkaWFnRXJyb3IgaW5zdGFuY2VvZiBFcnJvciA/IGRpYWdFcnJvci5tZXNzYWdlIDogZGlhZ0Vycm9yfSlgXG4gICAgICAgIClcblxuICAgICAgICB0aHJvdyBuZXcgRXJyb3IoYCR7ZXJyb3IubWVzc2FnZX1cXG5cXG5bJHtsYWJlbH0gYmxvY2tlZF0gb3RoZXIgdXNlciBzZXNzaW9ucyB3aXRoIG9wZW4gdHJhbnNhY3Rpb25zIG9yIGFjdGl2ZSByZXF1ZXN0czpcXG4ke3NuYXBzaG90fWAsIHtjYXVzZTogZXJyb3J9KVxuICAgICAgfVxuXG4gICAgICB0aHJvdyBlcnJvclxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBTbmFwc2hvdHMgdGhlIHNlc3Npb25zIHRoYXQgY291bGQgYmUgYmxvY2tpbmcgYSBjb25zdHJhaW50IHRvZ2dsZSBpbiBUSElTXG4gICAqIGRhdGFiYXNlIOKAlCBldmVyeSBzZXNzaW9uIG90aGVyIHRoYW4gdGhpcyBvbmUgdGhhdCBob2xkcyBhIGxvY2sgaW4gYERCX0lEKClgXG4gICAqIG9yIGlzIHJ1bm5pbmcgYSByZXF1ZXN0IGFnYWluc3QgaXQg4oCUIHdpdGggaXRzIGxhc3Qgc3RhdGVtZW50LCB3YWl0IHN0YXRlLFxuICAgKiBhbmQgYmxvY2tpbmcgc2Vzc2lvbiwgZW5vdWdoIHRvIGlkZW50aWZ5IGEgY29ubmVjdGlvbiB0aGF0IGxlYWtlZCBhIGxvY2suXG4gICAqIFNjb3BlZCB0byB0aGUgY3VycmVudCBkYXRhYmFzZSBzbyBhIG11bHRpLWRhdGFiYXNlIHNlcnZlciBkb2VzIG5vdCBsZWFrXG4gICAqIHVucmVsYXRlZCBzZXNzaW9ucycgU1FMIGludG8gdGhlIGVycm9yIGFuZCBidXJ5IHRoZSByZWFsIGJsb2NrZXIuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHN0cmluZz59IC0gSlNPTiBzbmFwc2hvdCwgb3IgYSBcIihub25lKVwiIG1hcmtlci5cbiAgICovXG4gIGFzeW5jIF9jYXB0dXJlQmxvY2tpbmdTZXNzaW9uc0ZvckRlYnVnKCkge1xuICAgIGNvbnN0IHJvd3MgPSBhd2FpdCB0aGlzLnF1ZXJ5KGBcbiAgICAgIFdJVEggbG9ja19zZXNzaW9ucyBBUyAoXG4gICAgICAgIFNFTEVDVCBESVNUSU5DVCByZXF1ZXN0X3Nlc3Npb25faWQgQVMgc2Vzc2lvbl9pZFxuICAgICAgICBGUk9NIHN5cy5kbV90cmFuX2xvY2tzXG4gICAgICAgIFdIRVJFIHJlc291cmNlX2RhdGFiYXNlX2lkID0gREJfSUQoKVxuICAgICAgKVxuICAgICAgU0VMRUNUXG4gICAgICAgIHMuc2Vzc2lvbl9pZCBBUyBzZXNzaW9uSWQsXG4gICAgICAgIHMuc3RhdHVzIEFTIHNlc3Npb25TdGF0dXMsXG4gICAgICAgIHMubG9naW5fdGltZSBBUyBsb2dpblRpbWUsXG4gICAgICAgIHMubGFzdF9yZXF1ZXN0X3N0YXJ0X3RpbWUgQVMgbGFzdFJlcXVlc3RTdGFydCxcbiAgICAgICAgcy5sYXN0X3JlcXVlc3RfZW5kX3RpbWUgQVMgbGFzdFJlcXVlc3RFbmQsXG4gICAgICAgIHMub3Blbl90cmFuc2FjdGlvbl9jb3VudCBBUyBvcGVuVHJhbnNhY3Rpb25Db3VudCxcbiAgICAgICAgci5zdGF0dXMgQVMgcmVxdWVzdFN0YXR1cyxcbiAgICAgICAgci5jb21tYW5kIEFTIGNvbW1hbmQsXG4gICAgICAgIHIud2FpdF90eXBlIEFTIHdhaXRUeXBlLFxuICAgICAgICByLndhaXRfdGltZSBBUyB3YWl0VGltZU1zLFxuICAgICAgICByLmJsb2NraW5nX3Nlc3Npb25faWQgQVMgYmxvY2tpbmdTZXNzaW9uSWQsXG4gICAgICAgIENBU1QoaWIuZXZlbnRfaW5mbyBBUyBOVkFSQ0hBUihNQVgpKSBBUyBsYXN0U3FsXG4gICAgICBGUk9NIHN5cy5kbV9leGVjX3Nlc3Npb25zIHNcbiAgICAgIExFRlQgSk9JTiBzeXMuZG1fZXhlY19yZXF1ZXN0cyByIE9OIHIuc2Vzc2lvbl9pZCA9IHMuc2Vzc2lvbl9pZFxuICAgICAgT1VURVIgQVBQTFkgc3lzLmRtX2V4ZWNfaW5wdXRfYnVmZmVyKHMuc2Vzc2lvbl9pZCwgTlVMTCkgaWJcbiAgICAgIFdIRVJFIHMuaXNfdXNlcl9wcm9jZXNzID0gMVxuICAgICAgICBBTkQgcy5zZXNzaW9uX2lkIDw+IEBAU1BJRFxuICAgICAgICBBTkQgKHMuc2Vzc2lvbl9pZCBJTiAoU0VMRUNUIHNlc3Npb25faWQgRlJPTSBsb2NrX3Nlc3Npb25zKSBPUiByLmRhdGFiYXNlX2lkID0gREJfSUQoKSlcbiAgICBgKVxuXG4gICAgaWYgKHJvd3MubGVuZ3RoID09PSAwKSByZXR1cm4gXCIobm9uZSDigJQgbm8gb3RoZXIgc2Vzc2lvbiBoZWxkIGEgbG9jayBvciByYW4gYSByZXF1ZXN0IGluIHRoaXMgZGF0YWJhc2Ugd2hlbiBxdWVyaWVkKVwiXG5cbiAgICByZXR1cm4gSlNPTi5zdHJpbmdpZnkocm93cywgbnVsbCwgMilcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGRyb3AgdGFibGUgc3Fscy5cbiAgICogQHBhcmFtIHtzdHJpbmd9IHRhYmxlTmFtZSAtIFRhYmxlIG5hbWUuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vYmFzZS5qc1wiKS5Ecm9wVGFibGVTcWxBcmdzVHlwZX0gW2FyZ3NdIC0gT3B0aW9ucyBvYmplY3QuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHN0cmluZ1tdPn0gLSBSZXNvbHZlcyB3aXRoIFNRTCBzdGF0ZW1lbnRzLlxuICAgKi9cbiAgYXN5bmMgZHJvcFRhYmxlU1FMcyh0YWJsZU5hbWUsIGFyZ3MgPSB7fSkge1xuICAgIGNvbnN0IGRyb3BBcmdzID0gT2JqZWN0LmFzc2lnbih7dGFibGVOYW1lLCBkcml2ZXI6IHRoaXN9LCBhcmdzKVxuICAgIGNvbnN0IGRyb3BUYWJsZSA9IG5ldyBEcm9wVGFibGUoZHJvcEFyZ3MpXG5cbiAgICByZXR1cm4gYXdhaXQgZHJvcFRhYmxlLnRvU1FMcygpXG4gIH1cblxuICAvKipcbiAgICogRHJvcHMgdGhlIGZvcmVpZ24ga2V5IGNvbnN0cmFpbnRzIHRoYXQgcmVmZXJlbmNlIHRoZSBnaXZlbiB0YWJsZS4gTVNTUUxcbiAgICogcmVmdXNlcyB0byBkcm9wIGEgdGFibGUgdGhhdCBpcyBzdGlsbCByZWZlcmVuY2VkIGJ5IGEgRk9SRUlHTiBLRVlcbiAgICogY29uc3RyYWludCBldmVuIHdoZW4gY29uc3RyYWludHMgYXJlIGRpc2FibGVkIHZpYSBOT0NIRUNLLCBzbyB0aGVcbiAgICogcmVmZXJlbmNpbmcgY29uc3RyYWludHMgbXVzdCBiZSByZW1vdmVkIGJlZm9yZSB0aGUgdGFibGUgY2FuIGJlIGRyb3BwZWQuXG4gICAqIFRoaXMgbGV0cyBjYWxsZXJzIGRyb3AgdGFibGVzIGluIGFueSBvcmRlciAoZS5nLiB3aXBpbmcgYSB3aG9sZSBzY2hlbWEpXG4gICAqIHdpdGhvdXQgZmlyc3QgZHJvcHBpbmcgZXZlcnkgZGVwZW5kZW50IHRhYmxlLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gdGFibGVOYW1lIC0gVGFibGUgbmFtZS5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgd2hlbiBjb21wbGV0ZS5cbiAgICovXG4gIGFzeW5jIF9kcm9wUmVmZXJlbmNpbmdGb3JlaWduS2V5cyh0YWJsZU5hbWUpIHtcbiAgICBjb25zdCByb3dzID0gYXdhaXQgdGhpcy5xdWVyeShcbiAgICAgIFwiU0VMRUNUIGZrLm5hbWUgQVMgY29uc3RyYWludF9uYW1lLCBPQkpFQ1RfTkFNRShmay5wYXJlbnRfb2JqZWN0X2lkKSBBUyBwYXJlbnRfdGFibGUgXCIgK1xuICAgICAgYEZST00gc3lzLmZvcmVpZ25fa2V5cyBmayBXSEVSRSBmay5yZWZlcmVuY2VkX29iamVjdF9pZCA9IE9CSkVDVF9JRCgke3RoaXMucXVvdGUodGFibGVOYW1lKX0pYFxuICAgIClcblxuICAgIGZvciAoY29uc3Qgcm93IG9mIHJvd3MpIHtcbiAgICAgIGNvbnN0IGNvbnN0cmFpbnROYW1lID0gcm93LmNvbnN0cmFpbnRfbmFtZSA/PyByb3cuQ09OU1RSQUlOVF9OQU1FXG4gICAgICBjb25zdCBwYXJlbnRUYWJsZSA9IHJvdy5wYXJlbnRfdGFibGUgPz8gcm93LlBBUkVOVF9UQUJMRVxuXG4gICAgICBhd2FpdCB0aGlzLnF1ZXJ5KGBBTFRFUiBUQUJMRSBbJHtwYXJlbnRUYWJsZX1dIERST1AgQ09OU1RSQUlOVCBbJHtjb25zdHJhaW50TmFtZX1dYClcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogUnVucyBkcm9wIHRhYmxlLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gdGFibGVOYW1lIC0gVGFibGUgbmFtZS5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9iYXNlLmpzXCIpLkRyb3BUYWJsZVNxbEFyZ3NUeXBlfSBbYXJnc10gLSBPcHRpb25zIG9iamVjdC5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgd2hlbiBjb21wbGV0ZS5cbiAgICovXG4gIGFzeW5jIGRyb3BUYWJsZSh0YWJsZU5hbWUsIGFyZ3MgPSB7fSkge1xuICAgIHRoaXMuX2Fzc2VydE5vdFJlYWRPbmx5KClcbiAgICBhd2FpdCB0aGlzLl9kcm9wUmVmZXJlbmNpbmdGb3JlaWduS2V5cyh0YWJsZU5hbWUpXG5cbiAgICBjb25zdCBzcWxzID0gYXdhaXQgdGhpcy5kcm9wVGFibGVTUUxzKHRhYmxlTmFtZSwgYXJncylcblxuICAgIGZvciAoY29uc3Qgc3FsIG9mIHNxbHMpIHtcbiAgICAgIGF3YWl0IHRoaXMucXVlcnkoc3FsKVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGdldCB0eXBlLlxuICAgKiBAcmV0dXJucyB7c3RyaW5nfSAtIFRoZSB0eXBlLlxuICAgKi9cbiAgZ2V0VHlwZSgpIHsgcmV0dXJuIFwibXNzcWxcIiB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgcXVlcnkgYWN0dWFsLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gc3FsIC0gU1FMIHN0cmluZy5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9iYXNlLmpzXCIpLlF1ZXJ5T3B0aW9uc30gW29wdGlvbnNdIC0gUXVlcnkgb3B0aW9ucy5cbiAgICogQHJldHVybnMge1Byb21pc2U8aW1wb3J0KFwiLi4vYmFzZS5qc1wiKS5RdWVyeVJlc3VsdFR5cGU+fSAtIFJlc29sdmVzIHdpdGggdGhlIHF1ZXJ5IGFjdHVhbC5cbiAgICovXG4gIGFzeW5jIF9xdWVyeUFjdHVhbChzcWwsIG9wdGlvbnMgPSB7fSkge1xuICAgIGxldCByZXN1bHRcbiAgICBsZXQgdHJpZXMgPSAwXG5cbiAgICB3aGlsZSAodHJ1ZSkge1xuICAgICAgdHJpZXMrK1xuXG4gICAgICB0cnkge1xuICAgICAgICBjb25zdCByZXF1ZXN0T3B0aW9ucyA9IG9wdGlvbnMucmVxdWVzdFRpbWVvdXRNcyA9PT0gdW5kZWZpbmVkXG4gICAgICAgICAgPyB1bmRlZmluZWRcbiAgICAgICAgICA6IHtyZXF1ZXN0VGltZW91dDogb3B0aW9ucy5yZXF1ZXN0VGltZW91dE1zfVxuICAgICAgICAvLyBub2RlLW1zc3FsIHN1cHBvcnRzIHJlcXVlc3QtbG9jYWwgb3ZlcnJpZGVzLCBidXQgaXRzIERlZmluaXRlbHlUeXBlZFxuICAgICAgICAvLyBjb25zdHJ1Y3RvciBkZWNsYXJhdGlvbiBzdGlsbCBleHBvc2VzIG9ubHkgdGhlIGxlZ2FjeSBmaXJzdCBhcmd1bWVudC5cbiAgICAgICAgY29uc3QgcmVxdWVzdCA9IHJlcXVlc3RPcHRpb25zXG4gICAgICAgICAgPyBSZWZsZWN0LmNvbnN0cnVjdChtc3NxbC5SZXF1ZXN0LCBbdGhpcy5fY3VycmVudFRyYW5zYWN0aW9uIHx8IHRoaXMuY29ubmVjdGlvbiwgcmVxdWVzdE9wdGlvbnNdKVxuICAgICAgICAgIDogdGhpcy5fY3VycmVudFRyYW5zYWN0aW9uXG4gICAgICAgICAgICA/IG5ldyBtc3NxbC5SZXF1ZXN0KHRoaXMuX2N1cnJlbnRUcmFuc2FjdGlvbilcbiAgICAgICAgICAgIDogbmV3IG1zc3FsLlJlcXVlc3QodGhpcy5jb25uZWN0aW9uKVxuICAgICAgICByZXN1bHQgPSBhd2FpdCByZXF1ZXN0LnF1ZXJ5KHNxbClcbiAgICAgICAgYnJlYWtcbiAgICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICAgIGlmIChlcnJvciBpbnN0YW5jZW9mIEVycm9yICYmIGVycm9yLm1lc3NhZ2UgPT0gXCJObyBjb25uZWN0aW9uIGlzIHNwZWNpZmllZCBmb3IgdGhhdCByZXF1ZXN0LlwiICYmIHRyaWVzIDw9IDMpIHtcbiAgICAgICAgICB0aGlzLmxvZ2dlci53YXJuKFwiUmVjb25uZWN0aW5nIHRvIGRhdGFiYXNlXCIpXG4gICAgICAgICAgYXdhaXQgdGhpcy5yZWNvbm5lY3QoKVxuICAgICAgICAgIC8vIFJldHJ5XG4gICAgICAgIH0gZWxzZSBpZiAoZXJyb3IgaW5zdGFuY2VvZiBFcnJvcikge1xuICAgICAgICAgIC8vIFJlLXRocm93IGVycm9yIGJlY2F1c2UgdGhlIHN0YWNrLXRyYWNlIGlzIGJyb2tlbiBhbmQgY2FuJ3QgYmUgdXNlZCBmb3IgYXBwLWRldmVsb3BtZW50LlxuICAgICAgICAgIHRocm93IG5ldyBFcnJvcihgUXVlcnkgZmFpbGVkICcke2Vycm9yLm1lc3NhZ2V9JzogJHtzcWx9YCwge2NhdXNlOiBlcnJvcn0pXG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgdGhyb3cgbmV3IEVycm9yKGBRdWVyeSBmYWlsZWQgJyR7ZXJyb3J9JzogJHtzcWx9YCwge2NhdXNlOiBlcnJvcn0pXG4gICAgICAgIH1cbiAgICAgIH1cbiAgICB9XG5cbiAgICByZXR1cm4gQXJyYXkuaXNBcnJheShyZXN1bHQucmVjb3Jkc2V0cykgPyByZXN1bHQucmVjb3Jkc2V0c1swXSB8fCBbXSA6IFtdXG4gIH1cblxuICAvKipcbiAgICogRXhlY3V0ZXMgYSBtdXRhdGlvbiB3aXRoIGFmZmVjdGVkLXJvdyBtZXRhZGF0YS5cbiAgICogQHBhcmFtIHtzdHJpbmd9IHNxbCAtIE11dGF0aW9uIFNRTC5cbiAgICogQHJldHVybnMge1Byb21pc2U8bnVtYmVyPn0gLSBBZmZlY3RlZCByb3cgY291bnQuXG4gICAqL1xuICBhc3luYyBfYWZmZWN0ZWRSb3dzQWN0dWFsKHNxbCkge1xuICAgIGNvbnN0IHJlcXVlc3QgPSB0aGlzLl9jdXJyZW50VHJhbnNhY3Rpb25cbiAgICAgID8gbmV3IG1zc3FsLlJlcXVlc3QodGhpcy5fY3VycmVudFRyYW5zYWN0aW9uKVxuICAgICAgOiBuZXcgbXNzcWwuUmVxdWVzdCh0aGlzLmNvbm5lY3Rpb24pXG4gICAgY29uc3QgcmVzdWx0ID0gYXdhaXQgcmVxdWVzdC5xdWVyeShzcWwpXG4gICAgcmV0dXJuIHJlc3VsdC5yb3dzQWZmZWN0ZWQucmVkdWNlKCh0b3RhbCwgY291bnQpID0+IHRvdGFsICsgY291bnQsIDApXG4gIH1cblxuICAvKipcbiAgICogUnVucyBxdWVyeSB0byBzcWwuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vLi4vcXVlcnkvaW5kZXguanNcIikuZGVmYXVsdH0gcXVlcnkgLSBRdWVyeSBpbnN0YW5jZS5cbiAgICogQHJldHVybnMge3N0cmluZ30gLSBTUUwgc3RyaW5nLlxuICAgKi9cbiAgcXVlcnlUb1NxbChxdWVyeSkgeyByZXR1cm4gbmV3IFF1ZXJ5UGFyc2VyKHtxdWVyeX0pLnRvU3FsKCkgfVxuXG4gIHNob3VsZFNldEF1dG9JbmNyZW1lbnRXaGVuUHJpbWFyeUtleSgpIHsgcmV0dXJuIHRydWUgfVxuICBzdXBwb3J0c0RlZmF1bHRQcmltYXJ5S2V5VVVJRCgpIHsgcmV0dXJuIHRydWUgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGFuIGV4cGxpY2l0IHByaW1hcnkta2V5IGluc2VydCBhcyBvbmUgYmF0Y2ggcmVxdWVzdDogU1FMIFNlcnZlciBzY29wZXNcbiAgICogSURFTlRJVFlfSU5TRVJUIHRvIHRoZSBzZXNzaW9uLCBhbmQgbm9kZS1tc3NxbCBwb29sLWJhY2tlZCByZXF1ZXN0cyBtYXkgdXNlXG4gICAqIGEgZGlmZmVyZW50IHBoeXNpY2FsIHNlc3Npb24gcGVyIHF1ZXJ5LCBzbyBlbmFibGluZyBpdCBpbiBhIHNlcGFyYXRlIHF1ZXJ5XG4gICAqIGNhbiBsZWF2ZSB0aGUgYWN0dWFsIElOU0VSVCBvbiBhbm90aGVyIHNlc3Npb24uIEEgc2luZ2xlIGJhdGNoIGtlZXBzIHRoZVxuICAgKiB3aG9sZSBzZXF1ZW5jZSBvbiBvbmUgc2Vzc2lvbiBieSBjb25zdHJ1Y3Rpb246IGVuYWJsZSwgaW5zZXJ0LCBkaXNhYmxlIG9uXG4gICAqIHN1Y2Nlc3MsIGFuZCBhIENBVENIIHRoYXQgZGlzYWJsZXMgYW5kIHJldGhyb3dzIHRoZSBvcmlnaW5hbCBlcnJvci5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBPcHRpb25zIG9iamVjdC5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9iYXNlLmpzXCIpLlF1ZXJ5T3B0aW9uc30gYXJncy5vcHRpb25zIC0gUXVlcnkgb3B0aW9ucyBmb3IgdGhlIHN0YW5kYXJkIHF1ZXJ5IHBhdGguXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBhcmdzLnNxbCAtIEdlbmVyYXRlZCBpbnNlcnQgU1FMLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gYXJncy50YWJsZU5hbWUgLSBUYWJsZSBiZWluZyBpbnNlcnRlZCBpbnRvLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxpbXBvcnQoXCIuLi9iYXNlLmpzXCIpLlF1ZXJ5UmVzdWx0VHlwZT59IC0gSW5zZXJ0IHJlc3VsdC5cbiAgICovXG4gIGFzeW5jIGluc2VydFdpdGhFeHBsaWNpdFByaW1hcnlLZXkoe29wdGlvbnMsIHNxbCwgdGFibGVOYW1lfSkge1xuICAgIGNvbnN0IHF1b3RlZFRhYmxlID0gdGhpcy5xdW90ZVRhYmxlKHRhYmxlTmFtZSlcbiAgICBjb25zdCBiYXRjaCA9IFtcbiAgICAgIGBTRVQgSURFTlRJVFlfSU5TRVJUICR7cXVvdGVkVGFibGV9IE9OO2AsXG4gICAgICBcIkJFR0lOIFRSWVwiLFxuICAgICAgYCR7c3FsfTtgLFxuICAgICAgYFNFVCBJREVOVElUWV9JTlNFUlQgJHtxdW90ZWRUYWJsZX0gT0ZGO2AsXG4gICAgICBcIkVORCBUUllcIixcbiAgICAgIFwiQkVHSU4gQ0FUQ0hcIixcbiAgICAgIGBTRVQgSURFTlRJVFlfSU5TRVJUICR7cXVvdGVkVGFibGV9IE9GRjtgLFxuICAgICAgXCJUSFJPVztcIixcbiAgICAgIFwiRU5EIENBVENIXCJcbiAgICBdLmpvaW4oXCJcXG5cIilcblxuICAgIHJldHVybiBhd2FpdCB0aGlzLnF1ZXJ5KGJhdGNoLCBvcHRpb25zKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZXNjYXBlLlxuICAgKiBAcGFyYW0ge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSB2YWx1ZSAtIFZhbHVlIHRvIHVzZS5cbiAgICogQHJldHVybnMge3N0cmluZ30gLSBUaGUgZXNjYXBlLlxuICAgKi9cbiAgZXNjYXBlKHZhbHVlKSB7XG4gICAgdmFsdWUgPSB0aGlzLl9jb252ZXJ0VmFsdWUodmFsdWUpXG4gICAgY29uc3Qgc3RyaW5nVmFsdWUgPSB0eXBlb2YgdmFsdWUgPT0gXCJzdHJpbmdcIiA/IHZhbHVlIDogYCR7dmFsdWV9YFxuXG4gICAgY29uc3QgcmVzdWx0V2l0aFF1b3RlcyA9IGVzY2FwZVN0cmluZyhzdHJpbmdWYWx1ZSwgbnVsbClcbiAgICBjb25zdCByZXN1bHQgPSByZXN1bHRXaXRoUXVvdGVzLnN1YnN0cmluZygxLCByZXN1bHRXaXRoUXVvdGVzLmxlbmd0aCAtIDEpXG5cbiAgICByZXR1cm4gcmVzdWx0XG4gIH1cblxuICAvKipcbiAgICogUnVucyBxdW90ZS5cbiAgICogQHBhcmFtIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gdmFsdWUgLSBWYWx1ZSB0byB1c2UuXG4gICAqIEByZXR1cm5zIHtzdHJpbmcgfCBudW1iZXJ9IC0gVGhlIHF1b3RlZCB2YWx1ZS5cbiAgICovXG4gIHF1b3RlKHZhbHVlKSB7XG4gICAgdmFsdWUgPSB0aGlzLl9jb252ZXJ0VmFsdWUodmFsdWUpXG5cbiAgICBpZiAodHlwZW9mIHZhbHVlID09IFwibnVtYmVyXCIpIHJldHVybiB2YWx1ZVxuICAgIGNvbnN0IHN0cmluZ1ZhbHVlID0gdHlwZW9mIHZhbHVlID09IFwic3RyaW5nXCIgPyB2YWx1ZSA6IFN0cmluZyh2YWx1ZSlcblxuICAgIHJldHVybiBgTiR7ZXNjYXBlU3RyaW5nKHN0cmluZ1ZhbHVlLCBudWxsKX1gXG4gIH1cblxuICAvKipcbiAgICogUnVucyBxdW90ZSBjb2x1bW4uXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBjb2x1bW5OYW1lIC0gQ29sdW1uIG5hbWUuXG4gICAqIEByZXR1cm5zIHtzdHJpbmd9IC0gVGhlIHF1b3RlIGNvbHVtbi5cbiAgICovXG4gIHF1b3RlQ29sdW1uKGNvbHVtbk5hbWUpIHsgcmV0dXJuIHRoaXMub3B0aW9ucygpLnF1b3RlQ29sdW1uTmFtZShjb2x1bW5OYW1lKSB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgcXVvdGUgdGFibGUuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBzdHJpbmcgLSBTdHJpbmcuXG4gICAqIEByZXR1cm5zIHtzdHJpbmd9IC0gVGhlIHF1b3RlIHRhYmxlLlxuICAgKi9cbiAgcXVvdGVUYWJsZShzdHJpbmcpIHsgcmV0dXJuIHRoaXMub3B0aW9ucygpLnF1b3RlVGFibGVOYW1lKHN0cmluZykgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHJlbmFtZSBjb2x1bW4uXG4gICAqIEBwYXJhbSB7c3RyaW5nfSB0YWJsZU5hbWUgLSBUYWJsZSBuYW1lLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gb2xkQ29sdW1uTmFtZSAtIFByZXZpb3VzIGNvbHVtbiBuYW1lLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gbmV3Q29sdW1uTmFtZSAtIE5ldyBjb2x1bW4gbmFtZS5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgd2hlbiBjb21wbGV0ZS5cbiAgICovXG4gIGFzeW5jIHJlbmFtZUNvbHVtbih0YWJsZU5hbWUsIG9sZENvbHVtbk5hbWUsIG5ld0NvbHVtbk5hbWUpIHtcbiAgICBhd2FpdCB0aGlzLnF1ZXJ5KGBFWEVDIHNwX3JlbmFtZSAke3RoaXMucXVvdGUoYCR7dGFibGVOYW1lfS4ke29sZENvbHVtbk5hbWV9YCl9LCAke3RoaXMucXVvdGUobmV3Q29sdW1uTmFtZSl9LCAnQ09MVU1OJ2ApXG4gIH1cblxuICAvKipcbiAgICogUnVucyBkZWxldGUgc3FsLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL2Jhc2UuanNcIikuRGVsZXRlU3FsQXJnc1R5cGV9IGFyZ3MgLSBPcHRpb25zIG9iamVjdC5cbiAgICogQHJldHVybnMge3N0cmluZ30gLSBTUUwgc3RyaW5nLlxuICAgKi9cbiAgZGVsZXRlU3FsKHt0YWJsZU5hbWUsIGNvbmRpdGlvbnN9KSB7XG4gICAgY29uc3QgZGVsZXRlSW5zdHJ1Y3Rpb24gPSBuZXcgRGVsZXRlKHtjb25kaXRpb25zLCBkcml2ZXI6IHRoaXMsIHRhYmxlTmFtZX0pXG5cbiAgICByZXR1cm4gZGVsZXRlSW5zdHJ1Y3Rpb24udG9TcWwoKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgaW5zZXJ0IHNxbC5cbiAgICogQGFic3RyYWN0XG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vYmFzZS5qc1wiKS5JbnNlcnRTcWxBcmdzVHlwZX0gYXJncyAtIE9wdGlvbnMgb2JqZWN0LlxuICAgKiBAcmV0dXJucyB7c3RyaW5nfSAtIFNRTCBzdHJpbmcuXG4gICAqL1xuICBpbnNlcnRTcWwoYXJncykge1xuICAgIGNvbnN0IGluc2VydEFyZ3MgPSBPYmplY3QuYXNzaWduKHtkcml2ZXI6IHRoaXN9LCBhcmdzKVxuICAgIGNvbnN0IGluc2VydCA9IG5ldyBJbnNlcnQoaW5zZXJ0QXJncylcblxuICAgIHJldHVybiBpbnNlcnQudG9TcWwoKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZ2V0IHRhYmxlcy5cbiAgICogQHJldHVybnMge1Byb21pc2U8QXJyYXk8aW1wb3J0KFwiLi4vYmFzZS10YWJsZS5qc1wiKS5kZWZhdWx0Pj59IC0gUmVzb2x2ZXMgd2l0aCB0aGUgdGFibGVzLlxuICAgKi9cbiAgYXN5bmMgZ2V0VGFibGVzKCkge1xuICAgIHJldHVybiBhd2FpdCB0aGlzLl9jYWNoZWRTY2hlbWFNZXRhZGF0YShcInRhYmxlc1wiLCBhc3luYyAoKSA9PiB7XG4gICAgICBjb25zdCBzY2hlbWEgPSB0aGlzLmdldEFyZ3MoKT8uc2NoZW1hIHx8IHRoaXMuZ2V0QXJncygpPy5zcWxDb25maWc/Lm9wdGlvbnM/LnNjaGVtYVxuICAgICAgY29uc3Qgc2NoZW1hQ2xhdXNlID0gc2NoZW1hXG4gICAgICAgID8gYCBBTkQgW1RBQkxFX1NDSEVNQV0gPSAke3RoaXMucXVvdGUoc2NoZW1hKX1gXG4gICAgICAgIDogXCIgQU5EIFtUQUJMRV9TQ0hFTUFdID0gU0NIRU1BX05BTUUoKVwiXG4gICAgICBjb25zdCByZXN1bHQgPSBhd2FpdCB0aGlzLnF1ZXJ5KGBTRUxFQ1QgW1RBQkxFX05BTUVdIEZST00gW0lORk9STUFUSU9OX1NDSEVNQV0uW1RBQkxFU10gV0hFUkUgW1RBQkxFX0NBVEFMT0ddID0gREJfTkFNRSgpJHtzY2hlbWFDbGF1c2V9YClcbiAgICAgIGNvbnN0IHRhYmxlcyA9IFtdXG5cbiAgICAgIGZvciAoY29uc3Qgcm93IG9mIHJlc3VsdCkge1xuICAgICAgICBjb25zdCB0YWJsZSA9IG5ldyBUYWJsZSh0aGlzLCAvKiogQHR5cGUge1JlY29yZDxzdHJpbmcsIHN0cmluZz59ICovIChyb3cpKVxuXG4gICAgICAgIHRhYmxlcy5wdXNoKHRhYmxlKVxuICAgICAgfVxuXG4gICAgICByZXR1cm4gdGFibGVzXG4gICAgfSlcbiAgfVxuXG4gIC8qKlxuICAgKiBLZWVwcyBjb25zdHJhaW50IHRvZ2dsZXMgYW5kIGNsZWFudXAgaW5zaWRlIGVhY2ggcGh5c2ljYWwgU1FMIFNlcnZlclxuICAgKiByZXF1ZXN0IHNvIGEgcG9vbCBjYW5ub3Qgc3BsaXQgbGlmZWN5Y2xlIG93bmVyc2hpcCBhY3Jvc3Mgc2Vzc2lvbnMuXG4gICAqIEBwcm90ZWN0ZWRcbiAgICogQHBhcmFtIHtBcnJheTxpbXBvcnQoXCIuLi9iYXNlLXRhYmxlLmpzXCIpLmRlZmF1bHQ+fSB0YWJsZXMgLSBFbGlnaWJsZSB0YWJsZXMuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIGFmdGVyIG9uZSBjbGVhbnVwIGF0dGVtcHQgc3VjY2VlZHMuXG4gICAqL1xuICBhc3luYyBfdHJ1bmNhdGVBbGxUYWJsZXModGFibGVzKSB7XG4gICAgYXdhaXQgdGhpcy5fdHJ1bmNhdGVBbGxUYWJsZXNXaXRoUmV0cmllcyh0YWJsZXMpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBvbmUgZmFpbC1sb3VkIGNsZWFudXAgYmF0Y2ggd2l0aCByZXN0b3JhdGlvbiBvbiBib3RoIHN1Y2Nlc3MgYW5kXG4gICAqIGZhaWx1cmUuIFRoZSBvdXRlciByZXRyeSBvd25lciByZWZyZXNoZXMgc3RhbGUgdGFibGUgc25hcHNob3RzLlxuICAgKiBAcHJvdGVjdGVkXG4gICAqIEBwYXJhbSB7QXJyYXk8aW1wb3J0KFwiLi4vYmFzZS10YWJsZS5qc1wiKS5kZWZhdWx0Pn0gdGFibGVzIC0gQ3VycmVudCBlbGlnaWJsZSB0YWJsZXMuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIGFmdGVyIHRoZSBiYXRjaCBjb21wbGV0ZXMuXG4gICAqL1xuICBhc3luYyBfdHJ1bmNhdGVBbGxUYWJsZXNBdHRlbXB0KHRhYmxlcykge1xuICAgIGNvbnN0IHN0YXRlbWVudHMgPSBbXG4gICAgICBcIkJFR0lOIFRSWVwiLFxuICAgICAgYCAgJHtESVNBQkxFX0ZPUkVJR05fS0VZU19TUUx9O2AsXG4gICAgICAuLi50aGlzLl90cnVuY2F0ZVRhYmxlU3RhdGVtZW50cyh0YWJsZXMpLFxuICAgICAgYCAgJHtFTkFCTEVfRk9SRUlHTl9LRVlTX1NRTH07YCxcbiAgICAgIFwiRU5EIFRSWVwiLFxuICAgICAgXCJCRUdJTiBDQVRDSFwiLFxuICAgICAgYCAgJHtFTkFCTEVfRk9SRUlHTl9LRVlTX1NRTH07YCxcbiAgICAgIFwiICBUSFJPVztcIixcbiAgICAgIFwiRU5EIENBVENIO1wiXG4gICAgXVxuXG4gICAgYXdhaXQgdGhpcy5xdWVyeShzdGF0ZW1lbnRzLmpvaW4oXCJcXG5cIikpXG4gIH1cblxuICAvKipcbiAgICogVHJ1bmNhdGVzIGFsbCBlbGlnaWJsZSB0YWJsZXMgaW4gb25lIFNRTCBTZXJ2ZXIgcmVxdWVzdCwgcmV0YWluaW5nIHRoZVxuICAgKiByZWNvZ25pemVkIGZvcmVpZ24ta2V5IGZhbGxiYWNrIHVzZWQgYnkgdGhlIHBlci10YWJsZSBpbXBsZW1lbnRhdGlvbi5cbiAgICogQHBhcmFtIHtBcnJheTxpbXBvcnQoXCIuLi9iYXNlLXRhYmxlLmpzXCIpLmRlZmF1bHQ+fSB0YWJsZXMgLSBFbGlnaWJsZSB0YWJsZXMuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIHdoZW4gdGhlIGJhdGNoIGNvbXBsZXRlcy5cbiAgICovXG4gIGFzeW5jIHRydW5jYXRlVGFibGVzKHRhYmxlcykge1xuICAgIGF3YWl0IHRoaXMucXVlcnkodGhpcy5fdHJ1bmNhdGVUYWJsZVN0YXRlbWVudHModGFibGVzKS5qb2luKFwiXFxuXCIpKVxuICB9XG5cbiAgLyoqXG4gICAqIEJ1aWxkcyB0aGUgcGVyLXRhYmxlIHRydW5jYXRlL2RlbGV0ZS1mYWxsYmFjayBzdGF0ZW1lbnRzLlxuICAgKiBAcGFyYW0ge0FycmF5PGltcG9ydChcIi4uL2Jhc2UtdGFibGUuanNcIikuZGVmYXVsdD59IHRhYmxlcyAtIEVsaWdpYmxlIHRhYmxlcy5cbiAgICogQHJldHVybnMge3N0cmluZ1tdfSAtIFNRTCBzdGF0ZW1lbnRzLlxuICAgKi9cbiAgX3RydW5jYXRlVGFibGVTdGF0ZW1lbnRzKHRhYmxlcykge1xuICAgIGNvbnN0IHN0YXRlbWVudHMgPSBbXVxuXG4gICAgZm9yIChjb25zdCB0YWJsZSBvZiB0YWJsZXMpIHtcbiAgICAgIGNvbnN0IHF1b3RlZFRhYmxlID0gdGhpcy5xdW90ZVRhYmxlKHRhYmxlLmdldE5hbWUoKSlcblxuICAgICAgc3RhdGVtZW50cy5wdXNoKFxuICAgICAgICBcIkJFR0lOIFRSWVwiLFxuICAgICAgICBgICBUUlVOQ0FURSBUQUJMRSAke3F1b3RlZFRhYmxlfTtgLFxuICAgICAgICBcIkVORCBUUllcIixcbiAgICAgICAgXCJCRUdJTiBDQVRDSFwiLFxuICAgICAgICBcIiAgSUYgRVJST1JfTlVNQkVSKCkgPSA0NzEyXCIsXG4gICAgICAgIFwiICBCRUdJTlwiLFxuICAgICAgICBgICAgIERFTEVURSBGUk9NICR7cXVvdGVkVGFibGV9O2AsXG4gICAgICAgIFwiICBFTkRcIixcbiAgICAgICAgXCIgIEVMU0VcIixcbiAgICAgICAgXCIgIEJFR0lOXCIsXG4gICAgICAgIFwiICAgIFRIUk9XO1wiLFxuICAgICAgICBcIiAgRU5EXCIsXG4gICAgICAgIFwiRU5EIENBVENIO1wiXG4gICAgICApXG4gICAgfVxuXG4gICAgcmV0dXJuIHN0YXRlbWVudHNcbiAgfVxuXG4gIGFzeW5jIGxhc3RJbnNlcnRJRChvcHRpb25zID0ge30pIHtcbiAgICBjb25zdCByZXN1bHQgPSBhd2FpdCB0aGlzLnF1ZXJ5KFwiU0VMRUNUIFNDT1BFX0lERU5USVRZKCkgQVMgbGFzdF9pbnNlcnRfaWRcIiwgb3B0aW9ucylcbiAgICBjb25zdCBsYXN0SW5zZXJ0SUQgPSBkaWdnKHJlc3VsdCwgMCwgXCJsYXN0X2luc2VydF9pZFwiKVxuXG4gICAgaWYgKGxhc3RJbnNlcnRJRCA9PT0gbnVsbCkgdGhyb3cgbmV3IEVycm9yKFwiQ291bGRuJ3QgZ2V0IHRoZSBsYXN0IGluc2VydGVkIElEXCIpXG5cbiAgICByZXR1cm4gbGFzdEluc2VydElEXG4gIH1cblxuICAvKipcbiAgICogUnVucyBvcHRpb25zLlxuICAgKiBAcmV0dXJucyB7T3B0aW9uc30gLSBUaGUgb3B0aW9ucyBvcHRpb25zLlxuICAgKi9cbiAgb3B0aW9ucygpIHtcbiAgICBpZiAoIXRoaXMuX29wdGlvbnMpIHRoaXMuX29wdGlvbnMgPSBuZXcgT3B0aW9ucyh7ZHJpdmVyOiB0aGlzfSlcblxuICAgIHJldHVybiB0aGlzLl9vcHRpb25zXG4gIH1cblxuICBhc3luYyBfc3RhcnRUcmFuc2FjdGlvbkFjdGlvbigpIHtcbiAgICBhd2FpdCB0aGlzLl9ydW5QaHlzaWNhbENvbm5lY3Rpb25SZXF1ZXN0KGFzeW5jICgpID0+IHtcbiAgICAgIGlmICh0aGlzLl9jdXJyZW50VHJhbnNhY3Rpb24pIHRocm93IG5ldyBFcnJvcihcIkEgdHJhbnNhY3Rpb24gaXMgYWxyZWFkeSBydW5uaW5nXCIpXG4gICAgICBpZiAoIXRoaXMuY29ubmVjdGlvbikgYXdhaXQgdGhpcy5jb25uZWN0KClcblxuICAgICAgdGhpcy5fY3VycmVudFRyYW5zYWN0aW9uID0gbmV3IG1zc3FsLlRyYW5zYWN0aW9uKHRoaXMuY29ubmVjdGlvbilcblxuICAgICAgdHJ5IHtcbiAgICAgICAgYXdhaXQgdGhpcy5fY3VycmVudFRyYW5zYWN0aW9uLmJlZ2luKClcbiAgICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICAgIHRoaXMuX2N1cnJlbnRUcmFuc2FjdGlvbiA9IG51bGxcbiAgICAgICAgdGhyb3cgZXJyb3JcbiAgICAgIH1cbiAgICB9KVxuICB9XG5cbiAgYXN5bmMgX2NvbW1pdFRyYW5zYWN0aW9uQWN0aW9uKCkge1xuICAgIGF3YWl0IHRoaXMuX3J1blBoeXNpY2FsQ29ubmVjdGlvblJlcXVlc3QoYXN5bmMgKCkgPT4ge1xuICAgICAgaWYgKCF0aGlzLl9jdXJyZW50VHJhbnNhY3Rpb24pIHRocm93IG5ldyBFcnJvcihcIkEgdHJhbnNhY3Rpb24gaXNuJ3QgcnVubmluZ1wiKVxuXG4gICAgICBhd2FpdCB0aGlzLl9jdXJyZW50VHJhbnNhY3Rpb24uY29tbWl0KClcbiAgICAgIHRoaXMuX2N1cnJlbnRUcmFuc2FjdGlvbiA9IG51bGxcbiAgICB9KVxuICB9XG5cbiAgYXN5bmMgX3JvbGxiYWNrVHJhbnNhY3Rpb25BY3Rpb24oKSB7XG4gICAgYXdhaXQgdGhpcy5fcnVuUGh5c2ljYWxDb25uZWN0aW9uUmVxdWVzdChhc3luYyAoKSA9PiB7XG4gICAgICBpZiAoIXRoaXMuX2N1cnJlbnRUcmFuc2FjdGlvbikge1xuICAgICAgICB0aGlzLmxvZ2dlci5kZWJ1ZyhcIkEgdHJhbnNhY3Rpb24gaXNuJ3QgcnVubmluZyAtIGlnbm9yaW5nIGJlY2F1c2UgdGhhdCBjYW4gaGFwcGVuIGlmIHNvbWV0aGluZyBlbHNlIGhhcyBmYWlsZWQgaW4gdGhlIGRiXCIpXG4gICAgICAgIHJldHVyblxuICAgICAgfVxuXG4gICAgICB0cnkge1xuICAgICAgICBhd2FpdCB0aGlzLl9jdXJyZW50VHJhbnNhY3Rpb24ucm9sbGJhY2soKVxuICAgICAgfSBjYXRjaCAodHJhbnNhY3Rpb25Sb2xsYmFja0Vycm9yKSB7XG4gICAgICAgIC8vIFdoZW4gU1FMIFNlcnZlciBoYXMgYWxyZWFkeSBhYm9ydGVkIHRoZSB0cmFuc2FjdGlvbiAoZS5nLiwgYVxuICAgICAgICAvLyBzdGFsZSBjb25jdXJyZW50IHJlcXVlc3QgdHJpZ2dlcmVkIFhBQ1RfQUJPUlQpLCB0aGVcbiAgICAgICAgLy8gbXNzcWwuVHJhbnNhY3Rpb24ucm9sbGJhY2soKSBjYWxsIGZhaWxzIGJlY2F1c2UgdGhlXG4gICAgICAgIC8vIFRyYW5zYWN0aW9uIG9iamVjdCBpcyBkZWFkLiAgSXNzdWUgYSByYXcgUk9MTEJBQ0sgb24gdGhlXG4gICAgICAgIC8vIHVuZGVybHlpbmcgY29ubmVjdGlvbiB0byBjbGVhciBTUUwgU2VydmVyJ3Mgc2Vzc2lvbi1sZXZlbFxuICAgICAgICAvLyBhYm9ydGVkLXRyYW5zYWN0aW9uIHN0YXRlIHNvIHRoZSBjb25uZWN0aW9uIGlzIHVzYWJsZSBmb3IgdGhlXG4gICAgICAgIC8vIG5leHQgQkVHSU4gVFJBTlNBQ1RJT04uXG4gICAgICAgIHRoaXMubG9nZ2VyLndhcm4oXCJUcmFuc2FjdGlvbi5yb2xsYmFjaygpIGZhaWxlZCwgY2xlYXJpbmcgc2Vzc2lvbiBzdGF0ZSB3aXRoIHJhdyBST0xMQkFDS1wiLCB7XG4gICAgICAgICAgZXJyb3I6IHRyYW5zYWN0aW9uUm9sbGJhY2tFcnJvciBpbnN0YW5jZW9mIEVycm9yID8gdHJhbnNhY3Rpb25Sb2xsYmFja0Vycm9yLm1lc3NhZ2UgOiB0cmFuc2FjdGlvblJvbGxiYWNrRXJyb3JcbiAgICAgICAgfSlcblxuICAgICAgICBjb25zdCByZXF1ZXN0ID0gbmV3IG1zc3FsLlJlcXVlc3QodGhpcy5jb25uZWN0aW9uKVxuXG4gICAgICAgIGF3YWl0IHJlcXVlc3QucXVlcnkoXCJJRiBAQFRSQU5DT1VOVCA+IDAgUk9MTEJBQ0tcIilcbiAgICAgIH0gZmluYWxseSB7XG4gICAgICAgIHRoaXMuX2N1cnJlbnRUcmFuc2FjdGlvbiA9IG51bGxcbiAgICAgIH1cbiAgICB9KVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgc3RhcnQgc2F2ZSBwb2ludCBhY3Rpb24uXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBzYXZlUG9pbnROYW1lIC0gU2F2ZSBwb2ludCBuYW1lLlxuICAgKiBAcGFyYW0ge1BpY2s8aW1wb3J0KFwiLi4vYmFzZS5qc1wiKS5RdWVyeU9wdGlvbnMsIFwib3BlcmF0aW9uT3duZXJcIj59IFtvcHRpb25zXSAtIFRyYW5zYWN0aW9uIG93bmVyc2hpcC5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgd2hlbiBjb21wbGV0ZS5cbiAgICovXG4gIGFzeW5jIF9zdGFydFNhdmVQb2ludEFjdGlvbihzYXZlUG9pbnROYW1lLCBvcHRpb25zID0ge30pIHtcbiAgICBhd2FpdCB0aGlzLnF1ZXJ5KGBTQVZFIFRSQU5TQUNUSU9OIFske3NhdmVQb2ludE5hbWV9XWAsIG9wdGlvbnMpXG4gIH1cblxuICAvKipcbiAgICogUnVucyByZWxlYXNlIHNhdmUgcG9pbnQgYWN0aW9uLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gc2F2ZVBvaW50TmFtZSAtIFNhdmUgcG9pbnQgbmFtZS5cbiAgICogQHBhcmFtIHtQaWNrPGltcG9ydChcIi4uL2Jhc2UuanNcIikuUXVlcnlPcHRpb25zLCBcIm9wZXJhdGlvbk93bmVyXCI+fSBbX29wdGlvbnNdIC0gVHJhbnNhY3Rpb24gb3duZXJzaGlwLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyB3aGVuIGNvbXBsZXRlLlxuICAgKi9cbiAgYXN5bmMgX3JlbGVhc2VTYXZlUG9pbnRBY3Rpb24oc2F2ZVBvaW50TmFtZSwgX29wdGlvbnMgPSB7fSkge1xuICAgIC8vIERvIG5vdGhpbmcgaW4gTVMtU1FMLlxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgcm9sbGJhY2sgc2F2ZSBwb2ludCBhY3Rpb24uXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBzYXZlUG9pbnROYW1lIC0gU2F2ZSBwb2ludCBuYW1lLlxuICAgKiBAcGFyYW0ge1BpY2s8aW1wb3J0KFwiLi4vYmFzZS5qc1wiKS5RdWVyeU9wdGlvbnMsIFwib3BlcmF0aW9uT3duZXJcIj59IFtvcHRpb25zXSAtIFRyYW5zYWN0aW9uIG93bmVyc2hpcC5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgd2hlbiBjb21wbGV0ZS5cbiAgICovXG4gIGFzeW5jIF9yb2xsYmFja1NhdmVQb2ludEFjdGlvbihzYXZlUG9pbnROYW1lLCBvcHRpb25zID0ge30pIHtcbiAgICB0cnkge1xuICAgICAgYXdhaXQgdGhpcy5xdWVyeShgUk9MTEJBQ0sgVFJBTlNBQ1RJT04gWyR7c2F2ZVBvaW50TmFtZX1dYCwgb3B0aW9ucylcbiAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgY29uc3QgbWVzc2FnZSA9IGVycm9yIGluc3RhbmNlb2YgRXJyb3IgPyBlcnJvci5tZXNzYWdlIDogYCR7ZXJyb3J9YFxuXG4gICAgICAvLyBXaGVuIFhBQ1RfQUJPUlQga2lsbHMgdGhlIGVudGlyZSB0cmFuc2FjdGlvbiwgdGhlIHNhdmVwb2ludFxuICAgICAgLy8gbm8gbG9uZ2VyIGV4aXN0cyBhbmQgdGhlIFJPTExCQUNLIFRSQU5TQUNUSU9OIFtuYW1lXSBmYWlscy5cbiAgICAgIC8vIElzc3VlIGEgcmF3IElGIEBAVFJBTkNPVU5UID4gMCBST0xMQkFDSyB0byBjbGVhciB3aGF0ZXZlclxuICAgICAgLy8gc2Vzc2lvbiBzdGF0ZSByZW1haW5zLCB0aGVuIGxldCB0aGUgZXJyb3IgcHJvcGFnYXRlIHNvIHRoZVxuICAgICAgLy8gb3V0ZXIgdHJhbnNhY3Rpb24oKSBjYWxsIGtub3dzIHRoZSB0cmFuc2FjdGlvbiBpcyBkZWFkLlxuICAgICAgaWYgKG1lc3NhZ2UuaW5jbHVkZXMoXCJUcmFuc2FjdGlvbiBoYXMgbm90IGJlZ3VuXCIpIHx8IG1lc3NhZ2UuaW5jbHVkZXMoXCJUcmFuc2FjdGlvbiBoYXMgYmVlbiBhYm9ydGVkXCIpKSB7XG4gICAgICAgIHRoaXMubG9nZ2VyLmRlYnVnKFwiU2F2ZXBvaW50IHJvbGxiYWNrIGZhaWxlZDsgdHJhbnNhY3Rpb24gYWxyZWFkeSBkZWFkLCBjbGVhcmluZyBzZXNzaW9uIHN0YXRlXCIpXG5cbiAgICAgICAgY29uc3QgcmVxdWVzdCA9IG5ldyBtc3NxbC5SZXF1ZXN0KHRoaXMuY29ubmVjdGlvbilcblxuICAgICAgICBhd2FpdCByZXF1ZXN0LnF1ZXJ5KFwiSUYgQEBUUkFOQ09VTlQgPiAwIFJPTExCQUNLXCIpXG5cbiAgICAgICAgcmV0dXJuXG4gICAgICB9XG5cbiAgICAgIHRocm93IGVycm9yXG4gICAgfVxuICB9XG5cbiAgZ2VuZXJhdGVTYXZlUG9pbnROYW1lKCkge1xuICAgIHJldHVybiBgc3Ake25ldyBVVUlEKDQpLmZvcm1hdCgpLnJlcGxhY2VBbGwoXCItXCIsIFwiXCIpfWAuc3Vic3RyaW5nKDAsIDMyKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgdXBkYXRlIHNxbC5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9iYXNlLmpzXCIpLlVwZGF0ZVNxbEFyZ3NUeXBlfSBhcmdzIC0gT3B0aW9ucyBvYmplY3QuXG4gICAqIEByZXR1cm5zIHtzdHJpbmd9IC0gU1FMIHN0cmluZy5cbiAgICovXG4gIHVwZGF0ZVNxbCh7Y29uZGl0aW9ucywgZGF0YSwgdGFibGVOYW1lfSkge1xuICAgIGNvbnN0IHVwZGF0ZSA9IG5ldyBVcGRhdGUoe2NvbmRpdGlvbnMsIGRhdGEsIGRyaXZlcjogdGhpcywgdGFibGVOYW1lfSlcblxuICAgIHJldHVybiB1cGRhdGUudG9TcWwoKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgdXBzZXJ0IHNxbC5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9iYXNlLmpzXCIpLlVwc2VydFNxbEFyZ3NUeXBlfSBhcmdzIC0gT3B0aW9ucyBvYmplY3QuXG4gICAqIEByZXR1cm5zIHtzdHJpbmd9IC0gU1FMIHN0cmluZy5cbiAgICovXG4gIHVwc2VydFNxbChhcmdzKSB7XG4gICAgY29uc3QgdXBzZXJ0ID0gbmV3IFVwc2VydCh7Li4uYXJncywgZHJpdmVyOiB0aGlzfSlcblxuICAgIHJldHVybiB1cHNlcnQudG9TcWwoKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgc3RydWN0dXJlIHNxbC5cbiAgICogQHJldHVybnMge1Byb21pc2U8c3RyaW5nIHwgbnVsbD59IC0gUmVzb2x2ZXMgd2l0aCBTUUwgc3RyaW5nLlxuICAgKi9cbiAgYXN5bmMgc3RydWN0dXJlU3FsKCkge1xuICAgIHJldHVybiBhd2FpdCB0aGlzLl9jYWNoZWRTY2hlbWFNZXRhZGF0YShcInN0cnVjdHVyZVNxbFwiLCBhc3luYyAoKSA9PiBhd2FpdCBuZXcgU3RydWN0dXJlU3FsKHtkcml2ZXI6IHRoaXN9KS50b1NxbCgpKVxuICB9XG5cbiAgLyoqXG4gICAqIEJsb2NrcyB1bnRpbCBhIFNRTCBTZXJ2ZXIgYXBwbGljYXRpb24gbG9jayBpcyBhY3F1aXJlZCBvbiB0aGlzXG4gICAqIGNvbm5lY3Rpb24gdmlhIGBzcF9nZXRhcHBsb2NrYC4gVGhlIFNlc3Npb24gbG9jayBvd25lciBzY29wZXMgdGhlIGxvY2tcbiAgICogdG8gdGhlIGN1cnJlbnQgc2Vzc2lvbiwgbWF0Y2hpbmcgdGhlIGNvbm5lY3Rpb24tc2NvcGVkIHNlbWFudGljcyBvblxuICAgKiBNeVNRTCBhbmQgUG9zdGdyZVNRTC5cbiAgICpcbiAgICogYHNwX2dldGFwcGxvY2tgIHJldHVybnMgMCBvbiBpbW1lZGlhdGUgZ3JhbnQsIDEgYWZ0ZXIgd2FpdGluZywgYW5kXG4gICAqIG5lZ2F0aXZlIHZhbHVlcyBvbiBmYWlsdXJlICh0aW1lb3V0LCBkZWFkbG9jaywgY2FuY2VsZWQsIHBhcmFtZXRlclxuICAgKiBlcnJvcikuIFdlIHRyZWF0IDAvMSBhcyBzdWNjZXNzIGFuZCAtMSAodGltZW91dCkgYXMgYSBjbGVhbiBgZmFsc2VgO1xuICAgKiBhbnl0aGluZyBlbHNlIHRocm93cy5cbiAgICogQHBhcmFtIHtzdHJpbmd9IG5hbWUgLSBMb2NrIG5hbWUuXG4gICAqIEBwYXJhbSB7e3RpbWVvdXRNcz86IG51bWJlciB8IG51bGx9fSBbYXJnc10gLSBPcHRpb25hbCB0aW1lb3V0IGluIG1pbGxpc2Vjb25kczsgYG51bGxgLCBgdW5kZWZpbmVkYCwgb3IgbmVnYXRpdmUgYmxvY2tzIGZvcmV2ZXIuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPGJvb2xlYW4+fSAtIFRydWUgaWYgdGhlIGxvY2sgd2FzIGFjcXVpcmVkLCBmYWxzZSBpZiB0aGUgdGltZW91dCBlbGFwc2VkLlxuICAgKi9cbiAgYXN5bmMgX2FjcXVpcmVBZHZpc29yeUxvY2sobmFtZSwge3RpbWVvdXRNc30gPSB7fSkge1xuICAgIGNvbnN0IHRpbWVvdXRWYWx1ZSA9IHR5cGVvZiB0aW1lb3V0TXMgPT09IFwibnVtYmVyXCIgJiYgdGltZW91dE1zID49IDAgPyBNYXRoLmNlaWwodGltZW91dE1zKSA6IC0xXG4gICAgY29uc3Qgcm93cyA9IGF3YWl0IHRoaXMuX2Fkdmlzb3J5TG9ja1F1ZXJ5KFxuICAgICAgYERFQ0xBUkUgQHZlbG9jaW91c19hZHZpc29yeV9sb2NrX3Jlc3VsdCBJTlQ7IEVYRUMgQHZlbG9jaW91c19hZHZpc29yeV9sb2NrX3Jlc3VsdCA9IHNwX2dldGFwcGxvY2sgQFJlc291cmNlID0gJHt0aGlzLnF1b3RlKG5hbWUpfSwgQExvY2tNb2RlID0gJ0V4Y2x1c2l2ZScsIEBMb2NrT3duZXIgPSAnU2Vzc2lvbicsIEBMb2NrVGltZW91dCA9ICR7dGltZW91dFZhbHVlfTsgU0VMRUNUIEB2ZWxvY2lvdXNfYWR2aXNvcnlfbG9ja19yZXN1bHQgQVMgdmVsb2Npb3VzX2Fkdmlzb3J5X2xvY2tfcmVzdWx0YFxuICAgIClcbiAgICBjb25zdCByZXN1bHQgPSBOdW1iZXIocm93cz8uWzBdPy52ZWxvY2lvdXNfYWR2aXNvcnlfbG9ja19yZXN1bHQpXG5cbiAgICBpZiAocmVzdWx0ID09PSAwIHx8IHJlc3VsdCA9PT0gMSkgcmV0dXJuIHRydWVcblxuICAgIGF3YWl0IHRoaXMuX2Nsb3NlQWR2aXNvcnlMb2NrVHJhbnNhY3Rpb24oKVxuXG4gICAgaWYgKHJlc3VsdCA9PT0gLTEpIHJldHVybiBmYWxzZVxuXG4gICAgdGhyb3cgbmV3IEVycm9yKGBzcF9nZXRhcHBsb2NrIHJldHVybmVkICR7cmVzdWx0fSBmb3IgYWR2aXNvcnkgbG9jayAke0pTT04uc3RyaW5naWZ5KG5hbWUpfSAoc2VlIFNRTCBTZXJ2ZXIgZG9jdW1lbnRhdGlvbiBmb3Igc3BfZ2V0YXBwbG9jayByZXR1cm4gY29kZXMpYClcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHRyeSBhY3F1aXJlIGFkdmlzb3J5IGxvY2suXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBuYW1lIC0gTG9jayBuYW1lLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxib29sZWFuPn0gLSBUcnVlIGlmIHRoZSBsb2NrIHdhcyBhY3F1aXJlZCwgZmFsc2UgaWYgaXQgd2FzIGFscmVhZHkgaGVsZC5cbiAgICovXG4gIGFzeW5jIF90cnlBY3F1aXJlQWR2aXNvcnlMb2NrKG5hbWUpIHtcbiAgICByZXR1cm4gYXdhaXQgdGhpcy5fYWNxdWlyZUFkdmlzb3J5TG9jayhuYW1lLCB7dGltZW91dE1zOiAwfSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHJlbGVhc2UgYWR2aXNvcnkgbG9jay5cbiAgICpcbiAgICogYHNwX3JlbGVhc2VhcHBsb2NrYCByZXR1cm5zIDAgd2hlbiB0aGUgbG9jayB3YXMgcmVsZWFzZWQsIGJ1dCBTUUwgU2VydmVyXG4gICAqIHJhaXNlcyBlcnJvciB7QGxpbmsgQVBQTE9DS19OT1RfSEVMRF9FUlJPUl9OVU1CRVJ9IGluc3RlYWQgb2YgcmV0dXJuaW5nIGFcbiAgICogZmFpbHVyZSBjb2RlIHdoZW4gdGhlIHNlc3Npb24gZG9lcyBub3QgY3VycmVudGx5IGhvbGQgdGhlIGxvY2suIFRoYXRcbiAgICogZXJyb3IgYWJvcnRzIHRoZSBiYXRjaCBiZWZvcmUgdGhlIHRyYWlsaW5nIGBTRUxFQ1RgIGNhbiBydW4sIHNvIHdlIGNhdGNoXG4gICAqIGl0IGFuZCByZXNvbHZlIHRvIGBmYWxzZWAgdG8gaG9ub3IgdGhlIGNyb3NzLWRyaXZlciBjb250cmFjdCBmb3IgYW5cbiAgICogYWxyZWFkeS11bmhlbGQgbG9jay5cbiAgICogQHBhcmFtIHtzdHJpbmd9IG5hbWUgLSBMb2NrIG5hbWUuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPGJvb2xlYW4+fSAtIFRydWUgaWYgdGhlIGxvY2sgd2FzIGhlbGQgYnkgdGhpcyBzZXNzaW9uIGFuZCBoYXMgbm93IGJlZW4gcmVsZWFzZWQuXG4gICAqL1xuICBhc3luYyBfcmVsZWFzZUFkdmlzb3J5TG9jayhuYW1lKSB7XG4gICAgbGV0IHJvd3NcblxuICAgIHRyeSB7XG4gICAgICByb3dzID0gYXdhaXQgdGhpcy5fYWR2aXNvcnlMb2NrUXVlcnkoXG4gICAgICAgIGBERUNMQVJFIEB2ZWxvY2lvdXNfYWR2aXNvcnlfbG9ja19yZXN1bHQgSU5UOyBFWEVDIEB2ZWxvY2lvdXNfYWR2aXNvcnlfbG9ja19yZXN1bHQgPSBzcF9yZWxlYXNlYXBwbG9jayBAUmVzb3VyY2UgPSAke3RoaXMucXVvdGUobmFtZSl9LCBATG9ja093bmVyID0gJ1Nlc3Npb24nOyBTRUxFQ1QgQHZlbG9jaW91c19hZHZpc29yeV9sb2NrX3Jlc3VsdCBBUyB2ZWxvY2lvdXNfYWR2aXNvcnlfbG9ja19yZXN1bHRgXG4gICAgICApXG4gICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgIGlmICh0aGlzLl9pc0FwcGxvY2tOb3RIZWxkRXJyb3IoZXJyb3IpKSB7XG4gICAgICAgIGF3YWl0IHRoaXMuX2Nsb3NlQWR2aXNvcnlMb2NrVHJhbnNhY3Rpb25JZkZpbmFsUmVsZWFzZSgpXG5cbiAgICAgICAgcmV0dXJuIGZhbHNlXG4gICAgICB9XG5cbiAgICAgIHRocm93IGVycm9yXG4gICAgfVxuXG4gICAgY29uc3QgcmVzdWx0ID0gTnVtYmVyKHJvd3M/LlswXT8udmVsb2Npb3VzX2Fkdmlzb3J5X2xvY2tfcmVzdWx0KVxuXG4gICAgYXdhaXQgdGhpcy5fY2xvc2VBZHZpc29yeUxvY2tUcmFuc2FjdGlvbklmRmluYWxSZWxlYXNlKClcblxuICAgIHJldHVybiByZXN1bHQgPT09IDBcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGFuIGFkdmlzb3J5LWxvY2sgc3RhdGVtZW50IHRocm91Z2ggb25lIHRyYW5zYWN0aW9uIHJlcXVlc3QgcGFyZW50LlxuICAgKiBub2RlLW1zc3FsIHJlc2VydmVzIG9uZSBwaHlzaWNhbCBzZXNzaW9uIGZvciBhIFRyYW5zYWN0aW9uLCB3aGVyZWFzXG4gICAqIHNlcGFyYXRlIENvbm5lY3Rpb25Qb29sIHJlcXVlc3RzIG1heSBjaGVjayBvdXQgZGlmZmVyZW50IHNlc3Npb25zLiBUaGVcbiAgICogdHJhbnNhY3Rpb24gY29udGFpbnMgb25seSBhcHBsaWNhdGlvbi1sb2NrIHN0YXRlbWVudHM7IGNhbGxlci9tb2RlbCB3b3JrXG4gICAqIGNvbnRpbnVlcyB0aHJvdWdoIGl0cyBvcmlnaW5hbCBjb25uZWN0aW9uLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gc3FsIC0gQWR2aXNvcnktbG9jayBTUUwuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPGltcG9ydChcIi4uL2Jhc2UuanNcIikuUXVlcnlSZXN1bHRUeXBlPn0gLSBSZXN1bHQgcm93cy5cbiAgICovXG4gIGFzeW5jIF9hZHZpc29yeUxvY2tRdWVyeShzcWwpIHtcbiAgICBjb25zdCB0cmFuc2FjdGlvbiA9IGF3YWl0IHRoaXMuX2Vuc3VyZUFkdmlzb3J5TG9ja1RyYW5zYWN0aW9uKClcblxuICAgIHRyeSB7XG4gICAgICBjb25zdCByZXF1ZXN0ID0gbmV3IG1zc3FsLlJlcXVlc3QodHJhbnNhY3Rpb24pXG4gICAgICBjb25zdCByZXN1bHQgPSBhd2FpdCByZXF1ZXN0LnF1ZXJ5KHNxbClcblxuICAgICAgcmV0dXJuIEFycmF5LmlzQXJyYXkocmVzdWx0LnJlY29yZHNldHMpID8gcmVzdWx0LnJlY29yZHNldHNbMF0gfHwgW10gOiBbXVxuICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICBpZiAoZXJyb3IgaW5zdGFuY2VvZiBFcnJvcikge1xuICAgICAgICB0aHJvdyBuZXcgRXJyb3IoYFF1ZXJ5IGZhaWxlZCAnJHtlcnJvci5tZXNzYWdlfSc6ICR7c3FsfWAsIHtjYXVzZTogZXJyb3J9KVxuICAgICAgfVxuXG4gICAgICB0aHJvdyBuZXcgRXJyb3IoYFF1ZXJ5IGZhaWxlZCAnJHtlcnJvcn0nOiAke3NxbH1gLCB7Y2F1c2U6IGVycm9yfSlcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogU3RhcnRzIHRoZSB0cmFuc2FjdGlvbiByZXF1ZXN0IHBhcmVudCB0aGF0IHJlc2VydmVzIHRoZSBhZHZpc29yeS1sb2NrXG4gICAqIHNlc3Npb24gdW50aWwgdGhlIGZpbmFsIHJlbGVhc2Ugb3IgZHJpdmVyIGNsb3NlLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxpbXBvcnQoXCJtc3NxbFwiKS5UcmFuc2FjdGlvbj59IC0gU2Vzc2lvbi1hZmZpbmUgcGFyZW50LlxuICAgKi9cbiAgYXN5bmMgX2Vuc3VyZUFkdmlzb3J5TG9ja1RyYW5zYWN0aW9uKCkge1xuICAgIGlmICh0aGlzLl9hZHZpc29yeUxvY2tUcmFuc2FjdGlvbikgcmV0dXJuIHRoaXMuX2Fkdmlzb3J5TG9ja1RyYW5zYWN0aW9uXG4gICAgaWYgKCF0aGlzLmNvbm5lY3Rpb24pIGF3YWl0IHRoaXMuY29ubmVjdCgpXG4gICAgaWYgKCF0aGlzLmNvbm5lY3Rpb24pIHRocm93IG5ldyBFcnJvcihcIk1TU1FMIGNvbm5lY3Rpb24gdW5hdmFpbGFibGUgZm9yIGFkdmlzb3J5IGxvY2tcIilcblxuICAgIGNvbnN0IHRyYW5zYWN0aW9uID0gbmV3IG1zc3FsLlRyYW5zYWN0aW9uKHRoaXMuY29ubmVjdGlvbilcblxuICAgIGF3YWl0IHRyYW5zYWN0aW9uLmJlZ2luKClcbiAgICB0aGlzLl9hZHZpc29yeUxvY2tUcmFuc2FjdGlvbiA9IHRyYW5zYWN0aW9uXG5cbiAgICByZXR1cm4gdHJhbnNhY3Rpb25cbiAgfVxuXG4gIC8qKlxuICAgKiBSZWxlYXNlcyB0aGUgcmVzZXJ2ZWQgc2Vzc2lvbiBhZnRlciB0aGUgbGFzdCB0cmFja2VkIGxvY2sgcmVsZWFzZS5cbiAgICogQmFzZSB1bnRyYWNrcyB0aGUgY3VycmVudCByZWxlYXNlIGFmdGVyIHRoZSBkcml2ZXIgaG9vayByZXR1cm5zLCBzbyBhXG4gICAqIGN1cnJlbnQgdG90YWwgb2Ygb25lIG1lYW5zIHRoaXMgaXMgdGhlIGZpbmFsIHJlbGVhc2UuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIGFmdGVyIGNsZWFudXAgd2hlbiB0aGlzIGlzIGZpbmFsLlxuICAgKi9cbiAgYXN5bmMgX2Nsb3NlQWR2aXNvcnlMb2NrVHJhbnNhY3Rpb25JZkZpbmFsUmVsZWFzZSgpIHtcbiAgICBsZXQgaGVsZENvdW50ID0gMFxuXG4gICAgZm9yIChjb25zdCBjb3VudCBvZiB0aGlzLl9oZWxkQWR2aXNvcnlMb2Nrcy52YWx1ZXMoKSkgaGVsZENvdW50ICs9IGNvdW50XG5cbiAgICBpZiAoaGVsZENvdW50IDw9IDEpIGF3YWl0IHRoaXMuX2Nsb3NlQWR2aXNvcnlMb2NrVHJhbnNhY3Rpb24oKVxuICB9XG5cbiAgLyoqXG4gICAqIFJvbGxzIGJhY2sgdGhlIG90aGVyd2lzZS1lbXB0eSB0cmFuc2FjdGlvbiBhbmQgcmV0dXJucyBpdHMgcGh5c2ljYWxcbiAgICogc2Vzc2lvbiB0byBub2RlLW1zc3FsLiBSb2xsYmFjayBpcyBjbGVhbnVwIG9ubHk7IGFkdmlzb3J5IGxvY2tzIGFyZVxuICAgKiBleHBsaWNpdGx5IHJlbGVhc2VkIGZpcnN0IHdoZW5ldmVyIHRoZWlyIHJlbGVhc2Ugc3RhdGVtZW50IHN1Y2NlZWRzLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyBhZnRlciBzZXNzaW9uIGNsZWFudXAuXG4gICAqL1xuICBhc3luYyBfY2xvc2VBZHZpc29yeUxvY2tUcmFuc2FjdGlvbigpIHtcbiAgICBjb25zdCB0cmFuc2FjdGlvbiA9IHRoaXMuX2Fkdmlzb3J5TG9ja1RyYW5zYWN0aW9uXG5cbiAgICBpZiAoIXRyYW5zYWN0aW9uKSByZXR1cm5cblxuICAgIHRoaXMuX2Fkdmlzb3J5TG9ja1RyYW5zYWN0aW9uID0gbnVsbFxuICAgIGF3YWl0IHRyYW5zYWN0aW9uLnJvbGxiYWNrKClcbiAgfVxuXG4gIC8qKlxuICAgKiBEZXRlY3RzIHRoZSBTUUwgU2VydmVyIFwiYXBwbGljYXRpb24gbG9jayBpcyBub3QgY3VycmVudGx5IGhlbGRcIiBlcnJvclxuICAgKiByYWlzZWQgYnkgYHNwX3JlbGVhc2VhcHBsb2NrYC4gSXQgd2Fsa3MgdGhlIHdyYXBwZWQtZXJyb3IgY2F1c2UgY2hhaW5cbiAgICogYmVjYXVzZSBgcXVlcnlgIHJlLXdyYXBzIHRoZSBkcml2ZXIncyBgUmVxdWVzdEVycm9yYCBpbiBhIHBsYWluIGBFcnJvcmAsXG4gICAqIGFuZCBtYXRjaGVzIG9uIHRoZSBzdGFibGUgbnVtZXJpYyBlcnJvciBudW1iZXIgcmF0aGVyIHRoYW4gdGhlIG1lc3NhZ2UuXG4gICAqIEBwYXJhbSB7dW5rbm93bn0gZXJyb3IgLSBFcnJvciB0aHJvd24gd2hpbGUgcmVsZWFzaW5nIHRoZSBsb2NrLlxuICAgKiBAcmV0dXJucyB7Ym9vbGVhbn0gLSBUcnVlIGlmIHRoZSBlcnJvciBtZWFucyB0aGUgbG9jayB3YXMgbm90IGhlbGQgYnkgdGhpcyBzZXNzaW9uLlxuICAgKi9cbiAgX2lzQXBwbG9ja05vdEhlbGRFcnJvcihlcnJvcikge1xuICAgIGxldCBjdXJyZW50ID0gZXJyb3JcblxuICAgIHdoaWxlIChjdXJyZW50IGluc3RhbmNlb2YgRXJyb3IpIHtcbiAgICAgIGNvbnN0IGVycm9yTnVtYmVyID0gLyoqIEB0eXBlIHt7bnVtYmVyPzogdW5rbm93bn19ICovIChjdXJyZW50KS5udW1iZXJcblxuICAgICAgaWYgKHR5cGVvZiBlcnJvck51bWJlciA9PT0gXCJudW1iZXJcIiAmJiBlcnJvck51bWJlciA9PT0gQVBQTE9DS19OT1RfSEVMRF9FUlJPUl9OVU1CRVIpIHJldHVybiB0cnVlXG5cbiAgICAgIGN1cnJlbnQgPSBjdXJyZW50LmNhdXNlXG4gICAgfVxuXG4gICAgcmV0dXJuIGZhbHNlXG4gIH1cblxuICAvKipcbiAgICogUmV0dXJucyB0cnVlIGlmIGFueSBzZXNzaW9uIGN1cnJlbnRseSBob2xkcyB0aGUgYXBwbGljYXRpb24gbG9jay5cbiAgICpcbiAgICogVGhpcyBjb21iaW5lcyB0d28gcHJvYmVzIGJlY2F1c2UgbmVpdGhlciBpcyBzdWZmaWNpZW50IG9uIGl0cyBvd246XG4gICAqICAgLSBgQVBQTE9DS19NT0RFKC4uLiwgJ1Nlc3Npb24nKWAgb25seSByZXBvcnRzIGxvY2tzIGhlbGQgYnkgdGhlXG4gICAqICAgICAqKmN1cnJlbnQqKiBzZXNzaW9uLCBzbyBpdCBtaXNzZXMgbG9ja3MgaGVsZCBieSBhbnkgb3RoZXJcbiAgICogICAgIHNlc3Npb24gYW5kIHdvdWxkIHJldHVybiBgTm9Mb2NrYCBldmVuIHVuZGVyIGNyb3NzLXNlc3Npb25cbiAgICogICAgIGNvbnRlbnRpb24uXG4gICAqICAgLSBgQVBQTE9DS19URVNUKC4uLiwgJ0V4Y2x1c2l2ZScsICdTZXNzaW9uJylgIHJldHVybnMgd2hldGhlciBhblxuICAgKiAgICAgRXhjbHVzaXZlIGxvY2sgY291bGQgYmUgZ3JhbnRlZCB0byAqdGhpcyogc2Vzc2lvbiByaWdodCBub3cuIEFcbiAgICogICAgIHJldHVybiB2YWx1ZSBvZiAwIG1lYW5zIHNvbWVib2R5IGVsc2UgaG9sZHMgYW4gaW5jb21wYXRpYmxlXG4gICAqICAgICBsb2NrOyBhIHZhbHVlIG9mIDEgbWVhbnMgaXQgaXMgZWl0aGVyIGZyZWUgKipvcioqIGFscmVhZHkgaGVsZFxuICAgKiAgICAgYnkgdXMgcmUtZW50cmFudGx5ICh3aGljaCB0aGUgYEFQUExPQ0tfTU9ERWAgY2hlY2sgY2F0Y2hlcykuXG4gICAqXG4gICAqIFRoZSBjb21iaW5lZCByZXN1bHQgaXMgXCJoZWxkXCIgaWZmIHdlIGhvbGQgaXQgb3Vyc2VsdmVzIG9yXG4gICAqIGBBUFBMT0NLX1RFU1RgIHJlcG9ydHMgd2UgY2Fubm90IGFjcXVpcmUgaXQgd2l0aG91dCB3YWl0aW5nLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gbmFtZSAtIExvY2sgbmFtZS5cbiAgICogQHJldHVybnMge1Byb21pc2U8Ym9vbGVhbj59IC0gVHJ1ZSBpZiBhbnkgc2Vzc2lvbiBjdXJyZW50bHkgaG9sZHMgdGhlIGxvY2suXG4gICAqL1xuICBhc3luYyBpc0Fkdmlzb3J5TG9ja0hlbGQobmFtZSkge1xuICAgIGNvbnN0IHJvd3MgPSBhd2FpdCB0aGlzLnF1ZXJ5KFxuICAgICAgYFNFTEVDVCBgICtcbiAgICAgICAgYEFQUExPQ0tfTU9ERSgncHVibGljJywgJHt0aGlzLnF1b3RlKG5hbWUpfSwgJ1Nlc3Npb24nKSBBUyB2ZWxvY2lvdXNfYWR2aXNvcnlfc2VsZl9tb2RlLCBgICtcbiAgICAgICAgYEFQUExPQ0tfVEVTVCgncHVibGljJywgJHt0aGlzLnF1b3RlKG5hbWUpfSwgJ0V4Y2x1c2l2ZScsICdTZXNzaW9uJykgQVMgdmVsb2Npb3VzX2Fkdmlzb3J5X3Rlc3RfcmVzdWx0YFxuICAgIClcbiAgICBjb25zdCBzZWxmTW9kZSA9IHJvd3M/LlswXT8udmVsb2Npb3VzX2Fkdmlzb3J5X3NlbGZfbW9kZVxuICAgIGNvbnN0IGhlbGRCeVNlbGYgPSB0eXBlb2Ygc2VsZk1vZGUgPT09IFwic3RyaW5nXCIgJiYgc2VsZk1vZGUubGVuZ3RoID4gMCAmJiBzZWxmTW9kZSAhPT0gXCJOb0xvY2tcIlxuXG4gICAgaWYgKGhlbGRCeVNlbGYpIHJldHVybiB0cnVlXG5cbiAgICBjb25zdCB0ZXN0UmVzdWx0ID0gTnVtYmVyKHJvd3M/LlswXT8udmVsb2Npb3VzX2Fkdmlzb3J5X3Rlc3RfcmVzdWx0KVxuXG4gICAgcmV0dXJuIHRlc3RSZXN1bHQgPT09IDBcbiAgfVxufVxuIl19