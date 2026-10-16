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
    /**
     * Attributes the current holder of the named application lock to its
     * requesting session from `sys.dm_tran_locks`, captured at the telemetry
     * event moment (best-effort; the caller guards failures).
     * @param {string} name - Lock name.
     * @returns {Promise<string | null>} - SQL Server session id of the holder, or null when no session holds the lock.
     */
    async advisoryLockHolderConnectionId(name) {
        const rows = await this.query(`SELECT TOP 1 request_session_id AS velocious_advisory_lock_holder FROM sys.dm_tran_locks WHERE resource_type = 'APPLICATIONLOCK' AND resource_description = ${this.quote(name)}`);
        const holder = rows?.[0]?.velocious_advisory_lock_holder;
        return holder === null || holder === undefined ? null : String(holder);
    }
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiaW5kZXguanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi8uLi8uLi9zcmMvZGF0YWJhc2UvZHJpdmVycy9tc3NxbC9pbmRleC5qcyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiQUFBQSxZQUFZO0FBRVosT0FBTyxVQUFVLE1BQU0sc0JBQXNCLENBQUE7QUFDN0MsT0FBTyxJQUFJLE1BQU0sWUFBWSxDQUFBO0FBQzdCLE9BQU8sY0FBYyxNQUFNLDBCQUEwQixDQUFBO0FBQ3JELE9BQU8sV0FBVyxNQUFNLHVCQUF1QixDQUFBO0FBQy9DLE9BQU8sV0FBVyxNQUFNLHVCQUF1QixDQUFBO0FBQy9DLE9BQU8sTUFBTSxNQUFNLGlCQUFpQixDQUFBO0FBQ3BDLE9BQU8sWUFBWSxNQUFNLHdCQUF3QixDQUFBO0FBQ2pELE9BQU8sU0FBUyxNQUFNLHFCQUFxQixDQUFBO0FBQzNDLE9BQU8sRUFBQyxJQUFJLEVBQUMsTUFBTSxXQUFXLENBQUE7QUFDOUIsT0FBTyxZQUFZLE1BQU0sbUJBQW1CLENBQUE7QUFDNUMsT0FBTyxNQUFNLE1BQU0saUJBQWlCLENBQUE7QUFDcEMsT0FBTyxPQUFPLE1BQU0sY0FBYyxDQUFBO0FBQ2xDLE9BQU8sS0FBSyxNQUFNLE9BQU8sQ0FBQTtBQUN6QixPQUFPLEdBQUcsTUFBTSxVQUFVLENBQUE7QUFDMUIsT0FBTyxXQUFXLE1BQU0sbUJBQW1CLENBQUE7QUFDM0MsT0FBTyxXQUFXLE1BQU0sdUJBQXVCLENBQUE7QUFDL0MsT0FBTyxLQUFLLE1BQU0sWUFBWSxDQUFBO0FBQzlCLE9BQU8sWUFBWSxNQUFNLG9CQUFvQixDQUFBO0FBQzdDLE9BQU8sT0FBTyxNQUFNLDJCQUEyQixDQUFBO0FBQy9DLE9BQU8sTUFBTSxNQUFNLGlCQUFpQixDQUFBO0FBQ3BDLE9BQU8sTUFBTSxNQUFNLGlCQUFpQixDQUFBO0FBQ3BDLE9BQU8sSUFBSSxNQUFNLFdBQVcsQ0FBQTtBQUU1Qjs7Ozs7Ozs7R0FRRztBQUNILE1BQU0sNkJBQTZC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QUksRUFBRSxDQUFDLENBQUMsQ0FBQyxFQUFFLDRCQUE0QixDQUFBO1FBQ3hELE1BQU0sVUFBVSxHQUFHLE9BQU8sUUFBUSxLQUFLLFFBQVEsSUFBSSxRQUFRLENBQUMsTUFBTSxHQUFHLENBQUMsSUFBSSxRQUFRLEtBQUssUUFBUSxDQUFBO1FBRS9GLElBQUksVUFBVTtZQUFFLE9BQU8sSUFBSSxDQUFBO1FBRTNCLE1BQU0sVUFBVSxHQUFHLE1BQU0sQ0FBQyxJQUFJLEVBQUUsQ0FBQyxDQUFDLENBQUMsRUFBRSw4QkFBOEIsQ0FBQyxDQUFBO1FBRXBFLE9BQU8sVUFBVSxLQUFLLENBQUMsQ0FBQTtJQUN6QixDQUFDO0lBRUQ7Ozs7OztPQU1HO0lBQ0gsS0FBSyxDQUFDLDhCQUE4QixDQUFDLElBQUk7UUFDdkMsTUFBTSxJQUFJLEdBQUcsTUFBTSxJQUFJLENBQUMsS0FBSyxDQUMzQiwrSkFBK0osSUFBSSxDQUFDLEtBQUssQ0FBQyxJQUFJLENBQUMsRUFBRSxDQUNsTCxDQUFBO1FBQ0QsTUFBTSxNQUFNLEdBQUcsSUFBSSxFQUFFLENBQUMsQ0FBQyxDQUFDLEVBQUUsOEJBQThCLENBQUE7UUFFeEQsT0FBTyxNQUFNLEtBQUssSUFBSSxJQUFJLE1BQU0sS0FBSyxTQUFTLENBQUMsQ0FBQyxDQUFDLElBQUksQ0FBQyxDQUFDLENBQUMsTUFBTSxDQUFDLE1BQU0sQ0FBQyxDQUFBO0lBQ3hFLENBQUM7Q0FDRiIsInNvdXJjZXNDb250ZW50IjpbIi8vIEB0cy1jaGVja1xuXG5pbXBvcnQgQWx0ZXJUYWJsZSBmcm9tIFwiLi9zcWwvYWx0ZXItdGFibGUuanNcIlxuaW1wb3J0IEJhc2UgZnJvbSBcIi4uL2Jhc2UuanNcIlxuaW1wb3J0IENyZWF0ZURhdGFiYXNlIGZyb20gXCIuL3NxbC9jcmVhdGUtZGF0YWJhc2UuanNcIlxuaW1wb3J0IENyZWF0ZUluZGV4IGZyb20gXCIuL3NxbC9jcmVhdGUtaW5kZXguanNcIlxuaW1wb3J0IENyZWF0ZVRhYmxlIGZyb20gXCIuL3NxbC9jcmVhdGUtdGFibGUuanNcIlxuaW1wb3J0IERlbGV0ZSBmcm9tIFwiLi9zcWwvZGVsZXRlLmpzXCJcbmltcG9ydCBEcm9wRGF0YWJhc2UgZnJvbSBcIi4vc3FsL2Ryb3AtZGF0YWJhc2UuanNcIlxuaW1wb3J0IERyb3BUYWJsZSBmcm9tIFwiLi9zcWwvZHJvcC10YWJsZS5qc1wiXG5pbXBvcnQge2RpZ2d9IGZyb20gXCJkaWdnZXJpemVcIlxuaW1wb3J0IGVzY2FwZVN0cmluZyBmcm9tIFwic3FsLWVzY2FwZS1zdHJpbmdcIlxuaW1wb3J0IEluc2VydCBmcm9tIFwiLi9zcWwvaW5zZXJ0LmpzXCJcbmltcG9ydCBPcHRpb25zIGZyb20gXCIuL29wdGlvbnMuanNcIlxuaW1wb3J0IG1zc3FsIGZyb20gXCJtc3NxbFwiXG5pbXBvcnQgbmV0IGZyb20gXCJub2RlOm5ldFwiXG5pbXBvcnQgUXVlcnlQYXJzZXIgZnJvbSBcIi4vcXVlcnktcGFyc2VyLmpzXCJcbmltcG9ydCBSZW1vdmVJbmRleCBmcm9tIFwiLi9zcWwvcmVtb3ZlLWluZGV4LmpzXCJcbmltcG9ydCBUYWJsZSBmcm9tIFwiLi90YWJsZS5qc1wiXG5pbXBvcnQgU3RydWN0dXJlU3FsIGZyb20gXCIuL3N0cnVjdHVyZS1zcWwuanNcIlxuaW1wb3J0IHRpbWVvdXQgZnJvbSBcImF3YWl0ZXJ5L2J1aWxkL3RpbWVvdXQuanNcIlxuaW1wb3J0IFVwc2VydCBmcm9tIFwiLi9zcWwvdXBzZXJ0LmpzXCJcbmltcG9ydCBVcGRhdGUgZnJvbSBcIi4vc3FsL3VwZGF0ZS5qc1wiXG5pbXBvcnQgVVVJRCBmcm9tIFwicHVyZS11dWlkXCJcblxuLyoqXG4gKiBTUUwgU2VydmVyIGVycm9yIG51bWJlciByYWlzZWQgYnkgYHNwX3JlbGVhc2VhcHBsb2NrYCB3aGVuIHRoZSBjdXJyZW50XG4gKiBzZXNzaW9uIGRvZXMgbm90IGhvbGQgdGhlIHJlcXVlc3RlZCBhcHBsaWNhdGlvbiBsb2NrLiBSZWxlYXNpbmcgYSBsb2NrIHRoZVxuICogc2Vzc2lvbiBubyBsb25nZXIgaG9sZHMgaXMgYSBub3JtYWwgcmFjZSAoYSBzaGFyZWQgY29ubmVjdGlvbidzIGZpbmFsXG4gKiBjaGVjay1pbiBtYXkgYWxyZWFkeSBoYXZlIGF1dG8tcmVsZWFzZWQgaXQpLCB3aGljaCB0aGUgY3Jvc3MtZHJpdmVyXG4gKiBgcmVsZWFzZUFkdmlzb3J5TG9ja2AgY29udHJhY3QgbW9kZWxzIGJ5IHJlc29sdmluZyB0byBgZmFsc2VgLiBXZSB0cmFuc2xhdGVcbiAqIHRoaXMgc3BlY2lmaWMgZXJyb3IgaW50byB0aGF0IHJlc3VsdCByYXRoZXIgdGhhbiBsZXR0aW5nIGl0IGVzY2FwZS5cbiAqIEB0eXBlIHtudW1iZXJ9XG4gKi9cbmNvbnN0IEFQUExPQ0tfTk9UX0hFTERfRVJST1JfTlVNQkVSID0gMTIyM1xuY29uc3QgRElTQUJMRV9GT1JFSUdOX0tFWVNfU1FMID0gXCJFWEVDIHNwX01TZm9yZWFjaHRhYmxlIFxcXCJBTFRFUiBUQUJMRSA/IE5PQ0hFQ0sgQ09OU1RSQUlOVCBhbGxcXFwiXCJcbmNvbnN0IEVOQUJMRV9GT1JFSUdOX0tFWVNfU1FMID0gXCJFWEVDIHNwX01TZm9yZWFjaHRhYmxlIEBjb21tYW5kMT1cXFwicHJpbnQgJz8nXFxcIiwgQGNvbW1hbmQyPVxcXCJBTFRFUiBUQUJMRSA/IFdJVEggQ0hFQ0sgQ0hFQ0sgQ09OU1RSQUlOVCBhbGxcXFwiXCJcblxuZXhwb3J0IGRlZmF1bHQgY2xhc3MgVmVsb2Npb3VzRGF0YWJhc2VEcml2ZXJzTXNzcWwgZXh0ZW5kcyBCYXNle1xuICAvKiogQHR5cGUge2ltcG9ydChcIm1zc3FsXCIpLlRyYW5zYWN0aW9uIHwgbnVsbH0gKi9cbiAgX2Fkdmlzb3J5TG9ja1RyYW5zYWN0aW9uID0gbnVsbFxuXG4gIGFzeW5jIGNvbm5lY3QoKSB7XG4gICAgY29uc3QgYXJncyA9IHRoaXMuZ2V0QXJncygpXG4gICAgY29uc3Qgc3FsQ29uZmlnID0gZGlnZyhhcmdzLCBcInNxbENvbmZpZ1wiKVxuXG4gICAgdHJ5IHtcbiAgICAgIGlmICh0aGlzLmNvbm5lY3Rpb24pIGF3YWl0IHRoaXMuY2xvc2UoKVxuXG4gICAgICBpZiAoc3FsQ29uZmlnKSB7XG4gICAgICAgIHNxbENvbmZpZy5vcHRpb25zID0gT2JqZWN0LmFzc2lnbih7fSwgc3FsQ29uZmlnLm9wdGlvbnMsIHt1c2VVVEM6IHRydWV9KVxuICAgICAgfVxuXG4gICAgICBpZiAoc3FsQ29uZmlnPy5zZXJ2ZXIgJiYgIXNxbENvbmZpZy5vcHRpb25zPy5zZXJ2ZXJOYW1lICYmIG5ldC5pc0lQKHNxbENvbmZpZy5zZXJ2ZXIpKSB7XG4gICAgICAgIHNxbENvbmZpZy5vcHRpb25zID0gT2JqZWN0LmFzc2lnbih7fSwgc3FsQ29uZmlnLm9wdGlvbnMsIHtzZXJ2ZXJOYW1lOiBcIlwifSlcbiAgICAgIH1cblxuICAgICAgdGhpcy5jb25uZWN0aW9uID0gbmV3IG1zc3FsLkNvbm5lY3Rpb25Qb29sKHNxbENvbmZpZylcbiAgICAgIGF3YWl0IHRoaXMuY29ubmVjdGlvbi5jb25uZWN0KClcbiAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgLy8gUmUtdGhyb3cgdG8gZml4IHVudXNlYWJsZSBzdGFjayB0cmFjZS5cbiAgICAgIHRocm93IG5ldyBFcnJvcihgQ291bGRuJ3QgY29ubmVjdCB0byBkYXRhYmFzZTogJHtlcnJvciBpbnN0YW5jZW9mIEVycm9yID8gZXJyb3IubWVzc2FnZSA6IGVycm9yfWAsIHtjYXVzZTogZXJyb3J9KVxuICAgIH1cbiAgfVxuXG4gIGFzeW5jIF9jbG9zZSgpIHtcbiAgICBpZiAoIXRoaXMuY29ubmVjdGlvbikgcmV0dXJuXG5cbiAgICBjb25zdCBjb25uZWN0aW9uID0gdGhpcy5jb25uZWN0aW9uXG4gICAgdGhpcy5jb25uZWN0aW9uID0gdW5kZWZpbmVkXG4gICAgdGhpcy5fY3VycmVudFRyYW5zYWN0aW9uID0gbnVsbFxuICAgIHRoaXMuX3RyYW5zYWN0aW9uc0NvdW50ID0gMFxuICAgIC8qKiBAdHlwZSB7RXJyb3IgfCB1bmRlZmluZWR9ICovXG4gICAgbGV0IHNlc3Npb25FcnJvclxuXG4gICAgdHJ5IHtcbiAgICAgIGF3YWl0IHRoaXMuX2Nsb3NlQWR2aXNvcnlMb2NrVHJhbnNhY3Rpb24oKVxuICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICBzZXNzaW9uRXJyb3IgPSBlcnJvciBpbnN0YW5jZW9mIEVycm9yID8gZXJyb3IgOiBuZXcgRXJyb3IoXCJGYWlsZWQgdG8gY2xvc2UgTVNTUUwgYWR2aXNvcnktbG9jayBzZXNzaW9uXCIsIHtjYXVzZTogZXJyb3J9KVxuICAgIH1cblxuICAgIHRyeSB7XG4gICAgICBhd2FpdCB0aW1lb3V0KHt0aW1lb3V0OiAyMDAwfSwgKCkgPT4gY29ubmVjdGlvbi5jbG9zZSgpKVxuICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICB0aGlzLmxvZ2dlci53YXJuKFwiRmFpbGVkIHRvIGNsb3NlIE1TU1FMIGNvbm5lY3Rpb24gY2xlYW5seVwiLCB7ZXJyb3J9KVxuICAgIH1cblxuICAgIGlmIChzZXNzaW9uRXJyb3IpIHRocm93IHNlc3Npb25FcnJvclxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgYWx0ZXIgdGFibGUgc3Fscy5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi8uLi90YWJsZS1kYXRhL2luZGV4LmpzXCIpLmRlZmF1bHR9IHRhYmxlRGF0YSAtIFRhYmxlIGRhdGEuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHN0cmluZ1tdPn0gLSBSZXNvbHZlcyB3aXRoIFNRTCBzdGF0ZW1lbnRzLlxuICAgKi9cbiAgYXN5bmMgYWx0ZXJUYWJsZVNRTHModGFibGVEYXRhKSB7XG4gICAgY29uc3QgYWx0ZXJBcmdzID0ge3RhYmxlRGF0YSwgZHJpdmVyOiB0aGlzfVxuICAgIGNvbnN0IGFsdGVyVGFibGUgPSBuZXcgQWx0ZXJUYWJsZShhbHRlckFyZ3MpXG5cbiAgICByZXR1cm4gYXdhaXQgYWx0ZXJUYWJsZS50b1NRTHMoKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgY3JlYXRlIGRhdGFiYXNlIHNxbC5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGRhdGFiYXNlTmFtZSAtIERhdGFiYXNlIG5hbWUuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBbYXJnc10gLSBPcHRpb25zIG9iamVjdC5cbiAgICogQHBhcmFtIHtib29sZWFufSBbYXJncy5pZk5vdEV4aXN0c10gLSBXaGV0aGVyIGlmIG5vdCBleGlzdHMuXG4gICAqIEByZXR1cm5zIHtzdHJpbmdbXX0gLSBTUUwgc3RhdGVtZW50cy5cbiAgICovXG4gIGNyZWF0ZURhdGFiYXNlU3FsKGRhdGFiYXNlTmFtZSwgYXJncykge1xuICAgIGNvbnN0IGNyZWF0ZUFyZ3MgPSBPYmplY3QuYXNzaWduKHtkYXRhYmFzZU5hbWUsIGRyaXZlcjogdGhpc30sIGFyZ3MpXG4gICAgY29uc3QgY3JlYXRlRGF0YWJhc2UgPSBuZXcgQ3JlYXRlRGF0YWJhc2UoY3JlYXRlQXJncylcblxuICAgIHJldHVybiBjcmVhdGVEYXRhYmFzZS50b1NxbCgpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBkcm9wIGRhdGFiYXNlIHNxbC5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGRhdGFiYXNlTmFtZSAtIERhdGFiYXNlIG5hbWUuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBbYXJnc10gLSBPcHRpb25zIG9iamVjdC5cbiAgICogQHBhcmFtIHtib29sZWFufSBbYXJncy5pZkV4aXN0c10gLSBXaGV0aGVyIGlmIGV4aXN0cy5cbiAgICogQHJldHVybnMge3N0cmluZ1tdfSAtIFNRTCBzdGF0ZW1lbnRzLlxuICAgKi9cbiAgZHJvcERhdGFiYXNlU3FsKGRhdGFiYXNlTmFtZSwgYXJncykge1xuICAgIGNvbnN0IGRyb3BBcmdzID0gT2JqZWN0LmFzc2lnbih7ZGF0YWJhc2VOYW1lLCBkcml2ZXI6IHRoaXN9LCBhcmdzKVxuICAgIGNvbnN0IGRyb3BEYXRhYmFzZSA9IG5ldyBEcm9wRGF0YWJhc2UoZHJvcEFyZ3MpXG5cbiAgICByZXR1cm4gZHJvcERhdGFiYXNlLnRvU3FsKClcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGNyZWF0ZSBpbmRleCBzcWxzLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL2Jhc2UuanNcIikuQ3JlYXRlSW5kZXhTcWxBcmdzfSBpbmRleERhdGEgLSBJbmRleCBkYXRhLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxzdHJpbmdbXT59IC0gUmVzb2x2ZXMgd2l0aCBTUUwgc3RhdGVtZW50cy5cbiAgICovXG4gIGFzeW5jIGNyZWF0ZUluZGV4U1FMcyhpbmRleERhdGEpIHtcbiAgICBjb25zdCBjcmVhdGVBcmdzID0gT2JqZWN0LmFzc2lnbih7ZHJpdmVyOiB0aGlzfSwgaW5kZXhEYXRhKVxuICAgIGNvbnN0IGNyZWF0ZUluZGV4ID0gbmV3IENyZWF0ZUluZGV4KGNyZWF0ZUFyZ3MpXG5cbiAgICByZXR1cm4gYXdhaXQgY3JlYXRlSW5kZXgudG9TUUxzKClcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHJlbW92ZSBpbmRleCBzcWxzLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL2Jhc2UuanNcIikuUmVtb3ZlSW5kZXhTcWxBcmdzfSBpbmRleERhdGEgLSBJbmRleCBkYXRhLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxzdHJpbmdbXT59IC0gUmVzb2x2ZXMgd2l0aCBTUUwgc3RhdGVtZW50cy5cbiAgICovXG4gIGFzeW5jIHJlbW92ZUluZGV4U1FMcyhpbmRleERhdGEpIHtcbiAgICBjb25zdCByZW1vdmVBcmdzID0gT2JqZWN0LmFzc2lnbih7ZHJpdmVyOiB0aGlzfSwgaW5kZXhEYXRhKVxuICAgIGNvbnN0IHJlbW92ZUluZGV4ID0gbmV3IFJlbW92ZUluZGV4KHJlbW92ZUFyZ3MpXG5cbiAgICByZXR1cm4gYXdhaXQgcmVtb3ZlSW5kZXgudG9TUUxzKClcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGNyZWF0ZSB0YWJsZSBzcWwuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vLi4vdGFibGUtZGF0YS9pbmRleC5qc1wiKS5kZWZhdWx0fSB0YWJsZURhdGEgLSBUYWJsZSBkYXRhLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxzdHJpbmdbXT59IC0gUmVzb2x2ZXMgd2l0aCBTUUwgc3RhdGVtZW50cy5cbiAgICovXG4gIGFzeW5jIGNyZWF0ZVRhYmxlU3FsKHRhYmxlRGF0YSkge1xuICAgIGNvbnN0IGNyZWF0ZUFyZ3MgPSB7dGFibGVEYXRhLCBkcml2ZXI6IHRoaXMsIGluZGV4SW5DcmVhdGVUYWJsZTogZmFsc2V9XG4gICAgY29uc3QgY3JlYXRlVGFibGUgPSBuZXcgQ3JlYXRlVGFibGUoY3JlYXRlQXJncylcblxuICAgIHJldHVybiBhd2FpdCBjcmVhdGVUYWJsZS50b1NxbCgpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBjdXJyZW50IGRhdGFiYXNlLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxzdHJpbmc+fSAtIFJlc29sdmVzIHdpdGggdGhlIGN1cnJlbnQgZGF0YWJhc2UuXG4gICAqL1xuICBhc3luYyBjdXJyZW50RGF0YWJhc2UoKSB7XG4gICAgY29uc3Qgcm93cyA9IGF3YWl0IHRoaXMucXVlcnkoXCJTRUxFQ1QgREJfTkFNRSgpIEFTIGRiX25hbWVcIilcblxuICAgIHJldHVybiBkaWdnKHJvd3MsIDAsIFwiZGJfbmFtZVwiKVxuICB9XG5cbiAgLyoqXG4gICAqIERpc2FibGVzIGV2ZXJ5IGZvcmVpZ24ga2V5IGNvbnN0cmFpbnQgKGJ1bGsgYE5PQ0hFQ0tgKS5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgd2hlbiBmb3JlaWduIGtleXMgYXJlIGRpc2FibGVkLlxuICAgKi9cbiAgYXN5bmMgZGlzYWJsZUZvcmVpZ25LZXlzKCkge1xuICAgIGF3YWl0IHRoaXMuX2V4ZWNDb25zdHJhaW50VG9nZ2xlKERJU0FCTEVfRk9SRUlHTl9LRVlTX1NRTCwgXCJkaXNhYmxlRm9yZWlnbktleXNcIilcbiAgfVxuXG4gIC8qKlxuICAgKiBSZS1lbmFibGVzIGFuZCByZS12YWxpZGF0ZXMgZXZlcnkgZm9yZWlnbiBrZXkgY29uc3RyYWludCAoYFdJVEggQ0hFQ0tgKS5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgd2hlbiBmb3JlaWduIGtleXMgYXJlIGVuYWJsZWQuXG4gICAqL1xuICBhc3luYyBlbmFibGVGb3JlaWduS2V5cygpIHtcbiAgICBhd2FpdCB0aGlzLl9leGVjQ29uc3RyYWludFRvZ2dsZShFTkFCTEVfRk9SRUlHTl9LRVlTX1NRTCwgXCJlbmFibGVGb3JlaWduS2V5c1wiKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgYSBidWxrIGNvbnN0cmFpbnQtdG9nZ2xlIHN0YXRlbWVudC4gYEFMVEVSIFRBQkxFIC4uLiBOT0NIRUNLL0NIRUNLXG4gICAqIENPTlNUUkFJTlRgIG5lZWRzIGEgc2NoZW1hLW1vZGlmaWNhdGlvbiBsb2NrIG9uIGV2ZXJ5IHRhYmxlLCBzbyBpZiB0aGVcbiAgICogcmVxdWVzdCB0aW1lcyBvdXQgaXQgaXMgYWxtb3N0IGFsd2F5cyBibG9ja2VkIGJ5IGFub3RoZXIgc2Vzc2lvbiB0aGF0IGlzXG4gICAqIHN0aWxsIGhvbGRpbmcgYSBsb2NrIChhIGxlYWtlZC91bmNvbW1pdHRlZCBjb25uZWN0aW9uKS4gT24gYSB0aW1lb3V0LFxuICAgKiBjYXB0dXJlIHdoaWNoIHNlc3Npb25zIHdlcmUgYmxvY2tpbmcgc28gdGhlIHJlYWwgY3VscHJpdCBpcyBuYW1lZCBpbnN0ZWFkXG4gICAqIG9mIGxlYXZpbmcgYSBiYXJlIFwiUmVxdWVzdCBmYWlsZWQgdG8gY29tcGxldGUgaW4gMTUwMDBtc1wiLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gc3FsIC0gQ29uc3RyYWludC10b2dnbGUgU1FMLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gbGFiZWwgLSBPcGVyYXRpb24gbGFiZWwgZm9yIHRoZSBlcnJvci5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgd2hlbiB0aGUgdG9nZ2xlIGNvbXBsZXRlcy5cbiAgICovXG4gIGFzeW5jIF9leGVjQ29uc3RyYWludFRvZ2dsZShzcWwsIGxhYmVsKSB7XG4gICAgdHJ5IHtcbiAgICAgIGF3YWl0IHRoaXMucXVlcnkoc3FsKVxuICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICBpZiAoZXJyb3IgaW5zdGFuY2VvZiBFcnJvciAmJiAvVGltZW91dDogUmVxdWVzdCBmYWlsZWQgdG8gY29tcGxldGUvaS50ZXN0KGVycm9yLm1lc3NhZ2UpKSB7XG4gICAgICAgIGNvbnN0IHNuYXBzaG90ID0gYXdhaXQgdGhpcy5fY2FwdHVyZUJsb2NraW5nU2Vzc2lvbnNGb3JEZWJ1ZygpLmNhdGNoKFxuICAgICAgICAgIChkaWFnRXJyb3IpID0+IGAoYmxvY2tpbmcgZGlhZ25vc3RpY3MgcXVlcnkgZmFpbGVkOiAke2RpYWdFcnJvciBpbnN0YW5jZW9mIEVycm9yID8gZGlhZ0Vycm9yLm1lc3NhZ2UgOiBkaWFnRXJyb3J9KWBcbiAgICAgICAgKVxuXG4gICAgICAgIHRocm93IG5ldyBFcnJvcihgJHtlcnJvci5tZXNzYWdlfVxcblxcblske2xhYmVsfSBibG9ja2VkXSBvdGhlciB1c2VyIHNlc3Npb25zIHdpdGggb3BlbiB0cmFuc2FjdGlvbnMgb3IgYWN0aXZlIHJlcXVlc3RzOlxcbiR7c25hcHNob3R9YCwge2NhdXNlOiBlcnJvcn0pXG4gICAgICB9XG5cbiAgICAgIHRocm93IGVycm9yXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIFNuYXBzaG90cyB0aGUgc2Vzc2lvbnMgdGhhdCBjb3VsZCBiZSBibG9ja2luZyBhIGNvbnN0cmFpbnQgdG9nZ2xlIGluIFRISVNcbiAgICogZGF0YWJhc2Ug4oCUIGV2ZXJ5IHNlc3Npb24gb3RoZXIgdGhhbiB0aGlzIG9uZSB0aGF0IGhvbGRzIGEgbG9jayBpbiBgREJfSUQoKWBcbiAgICogb3IgaXMgcnVubmluZyBhIHJlcXVlc3QgYWdhaW5zdCBpdCDigJQgd2l0aCBpdHMgbGFzdCBzdGF0ZW1lbnQsIHdhaXQgc3RhdGUsXG4gICAqIGFuZCBibG9ja2luZyBzZXNzaW9uLCBlbm91Z2ggdG8gaWRlbnRpZnkgYSBjb25uZWN0aW9uIHRoYXQgbGVha2VkIGEgbG9jay5cbiAgICogU2NvcGVkIHRvIHRoZSBjdXJyZW50IGRhdGFiYXNlIHNvIGEgbXVsdGktZGF0YWJhc2Ugc2VydmVyIGRvZXMgbm90IGxlYWtcbiAgICogdW5yZWxhdGVkIHNlc3Npb25zJyBTUUwgaW50byB0aGUgZXJyb3IgYW5kIGJ1cnkgdGhlIHJlYWwgYmxvY2tlci5cbiAgICogQHJldHVybnMge1Byb21pc2U8c3RyaW5nPn0gLSBKU09OIHNuYXBzaG90LCBvciBhIFwiKG5vbmUpXCIgbWFya2VyLlxuICAgKi9cbiAgYXN5bmMgX2NhcHR1cmVCbG9ja2luZ1Nlc3Npb25zRm9yRGVidWcoKSB7XG4gICAgY29uc3Qgcm93cyA9IGF3YWl0IHRoaXMucXVlcnkoYFxuICAgICAgV0lUSCBsb2NrX3Nlc3Npb25zIEFTIChcbiAgICAgICAgU0VMRUNUIERJU1RJTkNUIHJlcXVlc3Rfc2Vzc2lvbl9pZCBBUyBzZXNzaW9uX2lkXG4gICAgICAgIEZST00gc3lzLmRtX3RyYW5fbG9ja3NcbiAgICAgICAgV0hFUkUgcmVzb3VyY2VfZGF0YWJhc2VfaWQgPSBEQl9JRCgpXG4gICAgICApXG4gICAgICBTRUxFQ1RcbiAgICAgICAgcy5zZXNzaW9uX2lkIEFTIHNlc3Npb25JZCxcbiAgICAgICAgcy5zdGF0dXMgQVMgc2Vzc2lvblN0YXR1cyxcbiAgICAgICAgcy5sb2dpbl90aW1lIEFTIGxvZ2luVGltZSxcbiAgICAgICAgcy5sYXN0X3JlcXVlc3Rfc3RhcnRfdGltZSBBUyBsYXN0UmVxdWVzdFN0YXJ0LFxuICAgICAgICBzLmxhc3RfcmVxdWVzdF9lbmRfdGltZSBBUyBsYXN0UmVxdWVzdEVuZCxcbiAgICAgICAgcy5vcGVuX3RyYW5zYWN0aW9uX2NvdW50IEFTIG9wZW5UcmFuc2FjdGlvbkNvdW50LFxuICAgICAgICByLnN0YXR1cyBBUyByZXF1ZXN0U3RhdHVzLFxuICAgICAgICByLmNvbW1hbmQgQVMgY29tbWFuZCxcbiAgICAgICAgci53YWl0X3R5cGUgQVMgd2FpdFR5cGUsXG4gICAgICAgIHIud2FpdF90aW1lIEFTIHdhaXRUaW1lTXMsXG4gICAgICAgIHIuYmxvY2tpbmdfc2Vzc2lvbl9pZCBBUyBibG9ja2luZ1Nlc3Npb25JZCxcbiAgICAgICAgQ0FTVChpYi5ldmVudF9pbmZvIEFTIE5WQVJDSEFSKE1BWCkpIEFTIGxhc3RTcWxcbiAgICAgIEZST00gc3lzLmRtX2V4ZWNfc2Vzc2lvbnMgc1xuICAgICAgTEVGVCBKT0lOIHN5cy5kbV9leGVjX3JlcXVlc3RzIHIgT04gci5zZXNzaW9uX2lkID0gcy5zZXNzaW9uX2lkXG4gICAgICBPVVRFUiBBUFBMWSBzeXMuZG1fZXhlY19pbnB1dF9idWZmZXIocy5zZXNzaW9uX2lkLCBOVUxMKSBpYlxuICAgICAgV0hFUkUgcy5pc191c2VyX3Byb2Nlc3MgPSAxXG4gICAgICAgIEFORCBzLnNlc3Npb25faWQgPD4gQEBTUElEXG4gICAgICAgIEFORCAocy5zZXNzaW9uX2lkIElOIChTRUxFQ1Qgc2Vzc2lvbl9pZCBGUk9NIGxvY2tfc2Vzc2lvbnMpIE9SIHIuZGF0YWJhc2VfaWQgPSBEQl9JRCgpKVxuICAgIGApXG5cbiAgICBpZiAocm93cy5sZW5ndGggPT09IDApIHJldHVybiBcIihub25lIOKAlCBubyBvdGhlciBzZXNzaW9uIGhlbGQgYSBsb2NrIG9yIHJhbiBhIHJlcXVlc3QgaW4gdGhpcyBkYXRhYmFzZSB3aGVuIHF1ZXJpZWQpXCJcblxuICAgIHJldHVybiBKU09OLnN0cmluZ2lmeShyb3dzLCBudWxsLCAyKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZHJvcCB0YWJsZSBzcWxzLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gdGFibGVOYW1lIC0gVGFibGUgbmFtZS5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9iYXNlLmpzXCIpLkRyb3BUYWJsZVNxbEFyZ3NUeXBlfSBbYXJnc10gLSBPcHRpb25zIG9iamVjdC5cbiAgICogQHJldHVybnMge1Byb21pc2U8c3RyaW5nW10+fSAtIFJlc29sdmVzIHdpdGggU1FMIHN0YXRlbWVudHMuXG4gICAqL1xuICBhc3luYyBkcm9wVGFibGVTUUxzKHRhYmxlTmFtZSwgYXJncyA9IHt9KSB7XG4gICAgY29uc3QgZHJvcEFyZ3MgPSBPYmplY3QuYXNzaWduKHt0YWJsZU5hbWUsIGRyaXZlcjogdGhpc30sIGFyZ3MpXG4gICAgY29uc3QgZHJvcFRhYmxlID0gbmV3IERyb3BUYWJsZShkcm9wQXJncylcblxuICAgIHJldHVybiBhd2FpdCBkcm9wVGFibGUudG9TUUxzKClcbiAgfVxuXG4gIC8qKlxuICAgKiBEcm9wcyB0aGUgZm9yZWlnbiBrZXkgY29uc3RyYWludHMgdGhhdCByZWZlcmVuY2UgdGhlIGdpdmVuIHRhYmxlLiBNU1NRTFxuICAgKiByZWZ1c2VzIHRvIGRyb3AgYSB0YWJsZSB0aGF0IGlzIHN0aWxsIHJlZmVyZW5jZWQgYnkgYSBGT1JFSUdOIEtFWVxuICAgKiBjb25zdHJhaW50IGV2ZW4gd2hlbiBjb25zdHJhaW50cyBhcmUgZGlzYWJsZWQgdmlhIE5PQ0hFQ0ssIHNvIHRoZVxuICAgKiByZWZlcmVuY2luZyBjb25zdHJhaW50cyBtdXN0IGJlIHJlbW92ZWQgYmVmb3JlIHRoZSB0YWJsZSBjYW4gYmUgZHJvcHBlZC5cbiAgICogVGhpcyBsZXRzIGNhbGxlcnMgZHJvcCB0YWJsZXMgaW4gYW55IG9yZGVyIChlLmcuIHdpcGluZyBhIHdob2xlIHNjaGVtYSlcbiAgICogd2l0aG91dCBmaXJzdCBkcm9wcGluZyBldmVyeSBkZXBlbmRlbnQgdGFibGUuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSB0YWJsZU5hbWUgLSBUYWJsZSBuYW1lLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyB3aGVuIGNvbXBsZXRlLlxuICAgKi9cbiAgYXN5bmMgX2Ryb3BSZWZlcmVuY2luZ0ZvcmVpZ25LZXlzKHRhYmxlTmFtZSkge1xuICAgIGNvbnN0IHJvd3MgPSBhd2FpdCB0aGlzLnF1ZXJ5KFxuICAgICAgXCJTRUxFQ1QgZmsubmFtZSBBUyBjb25zdHJhaW50X25hbWUsIE9CSkVDVF9OQU1FKGZrLnBhcmVudF9vYmplY3RfaWQpIEFTIHBhcmVudF90YWJsZSBcIiArXG4gICAgICBgRlJPTSBzeXMuZm9yZWlnbl9rZXlzIGZrIFdIRVJFIGZrLnJlZmVyZW5jZWRfb2JqZWN0X2lkID0gT0JKRUNUX0lEKCR7dGhpcy5xdW90ZSh0YWJsZU5hbWUpfSlgXG4gICAgKVxuXG4gICAgZm9yIChjb25zdCByb3cgb2Ygcm93cykge1xuICAgICAgY29uc3QgY29uc3RyYWludE5hbWUgPSByb3cuY29uc3RyYWludF9uYW1lID8/IHJvdy5DT05TVFJBSU5UX05BTUVcbiAgICAgIGNvbnN0IHBhcmVudFRhYmxlID0gcm93LnBhcmVudF90YWJsZSA/PyByb3cuUEFSRU5UX1RBQkxFXG5cbiAgICAgIGF3YWl0IHRoaXMucXVlcnkoYEFMVEVSIFRBQkxFIFske3BhcmVudFRhYmxlfV0gRFJPUCBDT05TVFJBSU5UIFske2NvbnN0cmFpbnROYW1lfV1gKVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGRyb3AgdGFibGUuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSB0YWJsZU5hbWUgLSBUYWJsZSBuYW1lLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL2Jhc2UuanNcIikuRHJvcFRhYmxlU3FsQXJnc1R5cGV9IFthcmdzXSAtIE9wdGlvbnMgb2JqZWN0LlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyB3aGVuIGNvbXBsZXRlLlxuICAgKi9cbiAgYXN5bmMgZHJvcFRhYmxlKHRhYmxlTmFtZSwgYXJncyA9IHt9KSB7XG4gICAgdGhpcy5fYXNzZXJ0Tm90UmVhZE9ubHkoKVxuICAgIGF3YWl0IHRoaXMuX2Ryb3BSZWZlcmVuY2luZ0ZvcmVpZ25LZXlzKHRhYmxlTmFtZSlcblxuICAgIGNvbnN0IHNxbHMgPSBhd2FpdCB0aGlzLmRyb3BUYWJsZVNRTHModGFibGVOYW1lLCBhcmdzKVxuXG4gICAgZm9yIChjb25zdCBzcWwgb2Ygc3Fscykge1xuICAgICAgYXdhaXQgdGhpcy5xdWVyeShzcWwpXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZ2V0IHR5cGUuXG4gICAqIEByZXR1cm5zIHtzdHJpbmd9IC0gVGhlIHR5cGUuXG4gICAqL1xuICBnZXRUeXBlKCkgeyByZXR1cm4gXCJtc3NxbFwiIH1cblxuICAvKipcbiAgICogUnVucyBxdWVyeSBhY3R1YWwuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBzcWwgLSBTUUwgc3RyaW5nLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL2Jhc2UuanNcIikuUXVlcnlPcHRpb25zfSBbb3B0aW9uc10gLSBRdWVyeSBvcHRpb25zLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxpbXBvcnQoXCIuLi9iYXNlLmpzXCIpLlF1ZXJ5UmVzdWx0VHlwZT59IC0gUmVzb2x2ZXMgd2l0aCB0aGUgcXVlcnkgYWN0dWFsLlxuICAgKi9cbiAgYXN5bmMgX3F1ZXJ5QWN0dWFsKHNxbCwgb3B0aW9ucyA9IHt9KSB7XG4gICAgbGV0IHJlc3VsdFxuICAgIGxldCB0cmllcyA9IDBcblxuICAgIHdoaWxlICh0cnVlKSB7XG4gICAgICB0cmllcysrXG5cbiAgICAgIHRyeSB7XG4gICAgICAgIGNvbnN0IHJlcXVlc3RPcHRpb25zID0gb3B0aW9ucy5yZXF1ZXN0VGltZW91dE1zID09PSB1bmRlZmluZWRcbiAgICAgICAgICA/IHVuZGVmaW5lZFxuICAgICAgICAgIDoge3JlcXVlc3RUaW1lb3V0OiBvcHRpb25zLnJlcXVlc3RUaW1lb3V0TXN9XG4gICAgICAgIC8vIG5vZGUtbXNzcWwgc3VwcG9ydHMgcmVxdWVzdC1sb2NhbCBvdmVycmlkZXMsIGJ1dCBpdHMgRGVmaW5pdGVseVR5cGVkXG4gICAgICAgIC8vIGNvbnN0cnVjdG9yIGRlY2xhcmF0aW9uIHN0aWxsIGV4cG9zZXMgb25seSB0aGUgbGVnYWN5IGZpcnN0IGFyZ3VtZW50LlxuICAgICAgICBjb25zdCByZXF1ZXN0ID0gcmVxdWVzdE9wdGlvbnNcbiAgICAgICAgICA/IFJlZmxlY3QuY29uc3RydWN0KG1zc3FsLlJlcXVlc3QsIFt0aGlzLl9jdXJyZW50VHJhbnNhY3Rpb24gfHwgdGhpcy5jb25uZWN0aW9uLCByZXF1ZXN0T3B0aW9uc10pXG4gICAgICAgICAgOiB0aGlzLl9jdXJyZW50VHJhbnNhY3Rpb25cbiAgICAgICAgICAgID8gbmV3IG1zc3FsLlJlcXVlc3QodGhpcy5fY3VycmVudFRyYW5zYWN0aW9uKVxuICAgICAgICAgICAgOiBuZXcgbXNzcWwuUmVxdWVzdCh0aGlzLmNvbm5lY3Rpb24pXG4gICAgICAgIHJlc3VsdCA9IGF3YWl0IHJlcXVlc3QucXVlcnkoc3FsKVxuICAgICAgICBicmVha1xuICAgICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgICAgaWYgKGVycm9yIGluc3RhbmNlb2YgRXJyb3IgJiYgZXJyb3IubWVzc2FnZSA9PSBcIk5vIGNvbm5lY3Rpb24gaXMgc3BlY2lmaWVkIGZvciB0aGF0IHJlcXVlc3QuXCIgJiYgdHJpZXMgPD0gMykge1xuICAgICAgICAgIHRoaXMubG9nZ2VyLndhcm4oXCJSZWNvbm5lY3RpbmcgdG8gZGF0YWJhc2VcIilcbiAgICAgICAgICBhd2FpdCB0aGlzLnJlY29ubmVjdCgpXG4gICAgICAgICAgLy8gUmV0cnlcbiAgICAgICAgfSBlbHNlIGlmIChlcnJvciBpbnN0YW5jZW9mIEVycm9yKSB7XG4gICAgICAgICAgLy8gUmUtdGhyb3cgZXJyb3IgYmVjYXVzZSB0aGUgc3RhY2stdHJhY2UgaXMgYnJva2VuIGFuZCBjYW4ndCBiZSB1c2VkIGZvciBhcHAtZGV2ZWxvcG1lbnQuXG4gICAgICAgICAgdGhyb3cgbmV3IEVycm9yKGBRdWVyeSBmYWlsZWQgJyR7ZXJyb3IubWVzc2FnZX0nOiAke3NxbH1gLCB7Y2F1c2U6IGVycm9yfSlcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoYFF1ZXJ5IGZhaWxlZCAnJHtlcnJvcn0nOiAke3NxbH1gLCB7Y2F1c2U6IGVycm9yfSlcbiAgICAgICAgfVxuICAgICAgfVxuICAgIH1cblxuICAgIHJldHVybiBBcnJheS5pc0FycmF5KHJlc3VsdC5yZWNvcmRzZXRzKSA/IHJlc3VsdC5yZWNvcmRzZXRzWzBdIHx8IFtdIDogW11cbiAgfVxuXG4gIC8qKlxuICAgKiBFeGVjdXRlcyBhIG11dGF0aW9uIHdpdGggYWZmZWN0ZWQtcm93IG1ldGFkYXRhLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gc3FsIC0gTXV0YXRpb24gU1FMLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxudW1iZXI+fSAtIEFmZmVjdGVkIHJvdyBjb3VudC5cbiAgICovXG4gIGFzeW5jIF9hZmZlY3RlZFJvd3NBY3R1YWwoc3FsKSB7XG4gICAgY29uc3QgcmVxdWVzdCA9IHRoaXMuX2N1cnJlbnRUcmFuc2FjdGlvblxuICAgICAgPyBuZXcgbXNzcWwuUmVxdWVzdCh0aGlzLl9jdXJyZW50VHJhbnNhY3Rpb24pXG4gICAgICA6IG5ldyBtc3NxbC5SZXF1ZXN0KHRoaXMuY29ubmVjdGlvbilcbiAgICBjb25zdCByZXN1bHQgPSBhd2FpdCByZXF1ZXN0LnF1ZXJ5KHNxbClcbiAgICByZXR1cm4gcmVzdWx0LnJvd3NBZmZlY3RlZC5yZWR1Y2UoKHRvdGFsLCBjb3VudCkgPT4gdG90YWwgKyBjb3VudCwgMClcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHF1ZXJ5IHRvIHNxbC5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi8uLi9xdWVyeS9pbmRleC5qc1wiKS5kZWZhdWx0fSBxdWVyeSAtIFF1ZXJ5IGluc3RhbmNlLlxuICAgKiBAcmV0dXJucyB7c3RyaW5nfSAtIFNRTCBzdHJpbmcuXG4gICAqL1xuICBxdWVyeVRvU3FsKHF1ZXJ5KSB7IHJldHVybiBuZXcgUXVlcnlQYXJzZXIoe3F1ZXJ5fSkudG9TcWwoKSB9XG5cbiAgc2hvdWxkU2V0QXV0b0luY3JlbWVudFdoZW5QcmltYXJ5S2V5KCkgeyByZXR1cm4gdHJ1ZSB9XG4gIHN1cHBvcnRzRGVmYXVsdFByaW1hcnlLZXlVVUlEKCkgeyByZXR1cm4gdHJ1ZSB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgYW4gZXhwbGljaXQgcHJpbWFyeS1rZXkgaW5zZXJ0IGFzIG9uZSBiYXRjaCByZXF1ZXN0OiBTUUwgU2VydmVyIHNjb3Blc1xuICAgKiBJREVOVElUWV9JTlNFUlQgdG8gdGhlIHNlc3Npb24sIGFuZCBub2RlLW1zc3FsIHBvb2wtYmFja2VkIHJlcXVlc3RzIG1heSB1c2VcbiAgICogYSBkaWZmZXJlbnQgcGh5c2ljYWwgc2Vzc2lvbiBwZXIgcXVlcnksIHNvIGVuYWJsaW5nIGl0IGluIGEgc2VwYXJhdGUgcXVlcnlcbiAgICogY2FuIGxlYXZlIHRoZSBhY3R1YWwgSU5TRVJUIG9uIGFub3RoZXIgc2Vzc2lvbi4gQSBzaW5nbGUgYmF0Y2gga2VlcHMgdGhlXG4gICAqIHdob2xlIHNlcXVlbmNlIG9uIG9uZSBzZXNzaW9uIGJ5IGNvbnN0cnVjdGlvbjogZW5hYmxlLCBpbnNlcnQsIGRpc2FibGUgb25cbiAgICogc3VjY2VzcywgYW5kIGEgQ0FUQ0ggdGhhdCBkaXNhYmxlcyBhbmQgcmV0aHJvd3MgdGhlIG9yaWdpbmFsIGVycm9yLlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIE9wdGlvbnMgb2JqZWN0LlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL2Jhc2UuanNcIikuUXVlcnlPcHRpb25zfSBhcmdzLm9wdGlvbnMgLSBRdWVyeSBvcHRpb25zIGZvciB0aGUgc3RhbmRhcmQgcXVlcnkgcGF0aC5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGFyZ3Muc3FsIC0gR2VuZXJhdGVkIGluc2VydCBTUUwuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBhcmdzLnRhYmxlTmFtZSAtIFRhYmxlIGJlaW5nIGluc2VydGVkIGludG8uXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPGltcG9ydChcIi4uL2Jhc2UuanNcIikuUXVlcnlSZXN1bHRUeXBlPn0gLSBJbnNlcnQgcmVzdWx0LlxuICAgKi9cbiAgYXN5bmMgaW5zZXJ0V2l0aEV4cGxpY2l0UHJpbWFyeUtleSh7b3B0aW9ucywgc3FsLCB0YWJsZU5hbWV9KSB7XG4gICAgY29uc3QgcXVvdGVkVGFibGUgPSB0aGlzLnF1b3RlVGFibGUodGFibGVOYW1lKVxuICAgIGNvbnN0IGJhdGNoID0gW1xuICAgICAgYFNFVCBJREVOVElUWV9JTlNFUlQgJHtxdW90ZWRUYWJsZX0gT047YCxcbiAgICAgIFwiQkVHSU4gVFJZXCIsXG4gICAgICBgJHtzcWx9O2AsXG4gICAgICBgU0VUIElERU5USVRZX0lOU0VSVCAke3F1b3RlZFRhYmxlfSBPRkY7YCxcbiAgICAgIFwiRU5EIFRSWVwiLFxuICAgICAgXCJCRUdJTiBDQVRDSFwiLFxuICAgICAgYFNFVCBJREVOVElUWV9JTlNFUlQgJHtxdW90ZWRUYWJsZX0gT0ZGO2AsXG4gICAgICBcIlRIUk9XO1wiLFxuICAgICAgXCJFTkQgQ0FUQ0hcIlxuICAgIF0uam9pbihcIlxcblwiKVxuXG4gICAgcmV0dXJuIGF3YWl0IHRoaXMucXVlcnkoYmF0Y2gsIG9wdGlvbnMpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBlc2NhcGUuXG4gICAqIEBwYXJhbSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59IHZhbHVlIC0gVmFsdWUgdG8gdXNlLlxuICAgKiBAcmV0dXJucyB7c3RyaW5nfSAtIFRoZSBlc2NhcGUuXG4gICAqL1xuICBlc2NhcGUodmFsdWUpIHtcbiAgICB2YWx1ZSA9IHRoaXMuX2NvbnZlcnRWYWx1ZSh2YWx1ZSlcbiAgICBjb25zdCBzdHJpbmdWYWx1ZSA9IHR5cGVvZiB2YWx1ZSA9PSBcInN0cmluZ1wiID8gdmFsdWUgOiBgJHt2YWx1ZX1gXG5cbiAgICBjb25zdCByZXN1bHRXaXRoUXVvdGVzID0gZXNjYXBlU3RyaW5nKHN0cmluZ1ZhbHVlLCBudWxsKVxuICAgIGNvbnN0IHJlc3VsdCA9IHJlc3VsdFdpdGhRdW90ZXMuc3Vic3RyaW5nKDEsIHJlc3VsdFdpdGhRdW90ZXMubGVuZ3RoIC0gMSlcblxuICAgIHJldHVybiByZXN1bHRcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHF1b3RlLlxuICAgKiBAcGFyYW0ge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSB2YWx1ZSAtIFZhbHVlIHRvIHVzZS5cbiAgICogQHJldHVybnMge3N0cmluZyB8IG51bWJlcn0gLSBUaGUgcXVvdGVkIHZhbHVlLlxuICAgKi9cbiAgcXVvdGUodmFsdWUpIHtcbiAgICB2YWx1ZSA9IHRoaXMuX2NvbnZlcnRWYWx1ZSh2YWx1ZSlcblxuICAgIGlmICh0eXBlb2YgdmFsdWUgPT0gXCJudW1iZXJcIikgcmV0dXJuIHZhbHVlXG4gICAgY29uc3Qgc3RyaW5nVmFsdWUgPSB0eXBlb2YgdmFsdWUgPT0gXCJzdHJpbmdcIiA/IHZhbHVlIDogU3RyaW5nKHZhbHVlKVxuXG4gICAgcmV0dXJuIGBOJHtlc2NhcGVTdHJpbmcoc3RyaW5nVmFsdWUsIG51bGwpfWBcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHF1b3RlIGNvbHVtbi5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGNvbHVtbk5hbWUgLSBDb2x1bW4gbmFtZS5cbiAgICogQHJldHVybnMge3N0cmluZ30gLSBUaGUgcXVvdGUgY29sdW1uLlxuICAgKi9cbiAgcXVvdGVDb2x1bW4oY29sdW1uTmFtZSkgeyByZXR1cm4gdGhpcy5vcHRpb25zKCkucXVvdGVDb2x1bW5OYW1lKGNvbHVtbk5hbWUpIH1cblxuICAvKipcbiAgICogUnVucyBxdW90ZSB0YWJsZS5cbiAgICogQHBhcmFtIHtzdHJpbmd9IHN0cmluZyAtIFN0cmluZy5cbiAgICogQHJldHVybnMge3N0cmluZ30gLSBUaGUgcXVvdGUgdGFibGUuXG4gICAqL1xuICBxdW90ZVRhYmxlKHN0cmluZykgeyByZXR1cm4gdGhpcy5vcHRpb25zKCkucXVvdGVUYWJsZU5hbWUoc3RyaW5nKSB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgcmVuYW1lIGNvbHVtbi5cbiAgICogQHBhcmFtIHtzdHJpbmd9IHRhYmxlTmFtZSAtIFRhYmxlIG5hbWUuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBvbGRDb2x1bW5OYW1lIC0gUHJldmlvdXMgY29sdW1uIG5hbWUuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBuZXdDb2x1bW5OYW1lIC0gTmV3IGNvbHVtbiBuYW1lLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyB3aGVuIGNvbXBsZXRlLlxuICAgKi9cbiAgYXN5bmMgcmVuYW1lQ29sdW1uKHRhYmxlTmFtZSwgb2xkQ29sdW1uTmFtZSwgbmV3Q29sdW1uTmFtZSkge1xuICAgIGF3YWl0IHRoaXMucXVlcnkoYEVYRUMgc3BfcmVuYW1lICR7dGhpcy5xdW90ZShgJHt0YWJsZU5hbWV9LiR7b2xkQ29sdW1uTmFtZX1gKX0sICR7dGhpcy5xdW90ZShuZXdDb2x1bW5OYW1lKX0sICdDT0xVTU4nYClcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGRlbGV0ZSBzcWwuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vYmFzZS5qc1wiKS5EZWxldGVTcWxBcmdzVHlwZX0gYXJncyAtIE9wdGlvbnMgb2JqZWN0LlxuICAgKiBAcmV0dXJucyB7c3RyaW5nfSAtIFNRTCBzdHJpbmcuXG4gICAqL1xuICBkZWxldGVTcWwoe3RhYmxlTmFtZSwgY29uZGl0aW9uc30pIHtcbiAgICBjb25zdCBkZWxldGVJbnN0cnVjdGlvbiA9IG5ldyBEZWxldGUoe2NvbmRpdGlvbnMsIGRyaXZlcjogdGhpcywgdGFibGVOYW1lfSlcblxuICAgIHJldHVybiBkZWxldGVJbnN0cnVjdGlvbi50b1NxbCgpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBpbnNlcnQgc3FsLlxuICAgKiBAYWJzdHJhY3RcbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9iYXNlLmpzXCIpLkluc2VydFNxbEFyZ3NUeXBlfSBhcmdzIC0gT3B0aW9ucyBvYmplY3QuXG4gICAqIEByZXR1cm5zIHtzdHJpbmd9IC0gU1FMIHN0cmluZy5cbiAgICovXG4gIGluc2VydFNxbChhcmdzKSB7XG4gICAgY29uc3QgaW5zZXJ0QXJncyA9IE9iamVjdC5hc3NpZ24oe2RyaXZlcjogdGhpc30sIGFyZ3MpXG4gICAgY29uc3QgaW5zZXJ0ID0gbmV3IEluc2VydChpbnNlcnRBcmdzKVxuXG4gICAgcmV0dXJuIGluc2VydC50b1NxbCgpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBnZXQgdGFibGVzLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxBcnJheTxpbXBvcnQoXCIuLi9iYXNlLXRhYmxlLmpzXCIpLmRlZmF1bHQ+Pn0gLSBSZXNvbHZlcyB3aXRoIHRoZSB0YWJsZXMuXG4gICAqL1xuICBhc3luYyBnZXRUYWJsZXMoKSB7XG4gICAgcmV0dXJuIGF3YWl0IHRoaXMuX2NhY2hlZFNjaGVtYU1ldGFkYXRhKFwidGFibGVzXCIsIGFzeW5jICgpID0+IHtcbiAgICAgIGNvbnN0IHNjaGVtYSA9IHRoaXMuZ2V0QXJncygpPy5zY2hlbWEgfHwgdGhpcy5nZXRBcmdzKCk/LnNxbENvbmZpZz8ub3B0aW9ucz8uc2NoZW1hXG4gICAgICBjb25zdCBzY2hlbWFDbGF1c2UgPSBzY2hlbWFcbiAgICAgICAgPyBgIEFORCBbVEFCTEVfU0NIRU1BXSA9ICR7dGhpcy5xdW90ZShzY2hlbWEpfWBcbiAgICAgICAgOiBcIiBBTkQgW1RBQkxFX1NDSEVNQV0gPSBTQ0hFTUFfTkFNRSgpXCJcbiAgICAgIGNvbnN0IHJlc3VsdCA9IGF3YWl0IHRoaXMucXVlcnkoYFNFTEVDVCBbVEFCTEVfTkFNRV0gRlJPTSBbSU5GT1JNQVRJT05fU0NIRU1BXS5bVEFCTEVTXSBXSEVSRSBbVEFCTEVfQ0FUQUxPR10gPSBEQl9OQU1FKCkke3NjaGVtYUNsYXVzZX1gKVxuICAgICAgY29uc3QgdGFibGVzID0gW11cblxuICAgICAgZm9yIChjb25zdCByb3cgb2YgcmVzdWx0KSB7XG4gICAgICAgIGNvbnN0IHRhYmxlID0gbmV3IFRhYmxlKHRoaXMsIC8qKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgc3RyaW5nPn0gKi8gKHJvdykpXG5cbiAgICAgICAgdGFibGVzLnB1c2godGFibGUpXG4gICAgICB9XG5cbiAgICAgIHJldHVybiB0YWJsZXNcbiAgICB9KVxuICB9XG5cbiAgLyoqXG4gICAqIEtlZXBzIGNvbnN0cmFpbnQgdG9nZ2xlcyBhbmQgY2xlYW51cCBpbnNpZGUgZWFjaCBwaHlzaWNhbCBTUUwgU2VydmVyXG4gICAqIHJlcXVlc3Qgc28gYSBwb29sIGNhbm5vdCBzcGxpdCBsaWZlY3ljbGUgb3duZXJzaGlwIGFjcm9zcyBzZXNzaW9ucy5cbiAgICogQHByb3RlY3RlZFxuICAgKiBAcGFyYW0ge0FycmF5PGltcG9ydChcIi4uL2Jhc2UtdGFibGUuanNcIikuZGVmYXVsdD59IHRhYmxlcyAtIEVsaWdpYmxlIHRhYmxlcy5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgYWZ0ZXIgb25lIGNsZWFudXAgYXR0ZW1wdCBzdWNjZWVkcy5cbiAgICovXG4gIGFzeW5jIF90cnVuY2F0ZUFsbFRhYmxlcyh0YWJsZXMpIHtcbiAgICBhd2FpdCB0aGlzLl90cnVuY2F0ZUFsbFRhYmxlc1dpdGhSZXRyaWVzKHRhYmxlcylcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIG9uZSBmYWlsLWxvdWQgY2xlYW51cCBiYXRjaCB3aXRoIHJlc3RvcmF0aW9uIG9uIGJvdGggc3VjY2VzcyBhbmRcbiAgICogZmFpbHVyZS4gVGhlIG91dGVyIHJldHJ5IG93bmVyIHJlZnJlc2hlcyBzdGFsZSB0YWJsZSBzbmFwc2hvdHMuXG4gICAqIEBwcm90ZWN0ZWRcbiAgICogQHBhcmFtIHtBcnJheTxpbXBvcnQoXCIuLi9iYXNlLXRhYmxlLmpzXCIpLmRlZmF1bHQ+fSB0YWJsZXMgLSBDdXJyZW50IGVsaWdpYmxlIHRhYmxlcy5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgYWZ0ZXIgdGhlIGJhdGNoIGNvbXBsZXRlcy5cbiAgICovXG4gIGFzeW5jIF90cnVuY2F0ZUFsbFRhYmxlc0F0dGVtcHQodGFibGVzKSB7XG4gICAgY29uc3Qgc3RhdGVtZW50cyA9IFtcbiAgICAgIFwiQkVHSU4gVFJZXCIsXG4gICAgICBgICAke0RJU0FCTEVfRk9SRUlHTl9LRVlTX1NRTH07YCxcbiAgICAgIC4uLnRoaXMuX3RydW5jYXRlVGFibGVTdGF0ZW1lbnRzKHRhYmxlcyksXG4gICAgICBgICAke0VOQUJMRV9GT1JFSUdOX0tFWVNfU1FMfTtgLFxuICAgICAgXCJFTkQgVFJZXCIsXG4gICAgICBcIkJFR0lOIENBVENIXCIsXG4gICAgICBgICAke0VOQUJMRV9GT1JFSUdOX0tFWVNfU1FMfTtgLFxuICAgICAgXCIgIFRIUk9XO1wiLFxuICAgICAgXCJFTkQgQ0FUQ0g7XCJcbiAgICBdXG5cbiAgICBhd2FpdCB0aGlzLnF1ZXJ5KHN0YXRlbWVudHMuam9pbihcIlxcblwiKSlcbiAgfVxuXG4gIC8qKlxuICAgKiBUcnVuY2F0ZXMgYWxsIGVsaWdpYmxlIHRhYmxlcyBpbiBvbmUgU1FMIFNlcnZlciByZXF1ZXN0LCByZXRhaW5pbmcgdGhlXG4gICAqIHJlY29nbml6ZWQgZm9yZWlnbi1rZXkgZmFsbGJhY2sgdXNlZCBieSB0aGUgcGVyLXRhYmxlIGltcGxlbWVudGF0aW9uLlxuICAgKiBAcGFyYW0ge0FycmF5PGltcG9ydChcIi4uL2Jhc2UtdGFibGUuanNcIikuZGVmYXVsdD59IHRhYmxlcyAtIEVsaWdpYmxlIHRhYmxlcy5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgd2hlbiB0aGUgYmF0Y2ggY29tcGxldGVzLlxuICAgKi9cbiAgYXN5bmMgdHJ1bmNhdGVUYWJsZXModGFibGVzKSB7XG4gICAgYXdhaXQgdGhpcy5xdWVyeSh0aGlzLl90cnVuY2F0ZVRhYmxlU3RhdGVtZW50cyh0YWJsZXMpLmpvaW4oXCJcXG5cIikpXG4gIH1cblxuICAvKipcbiAgICogQnVpbGRzIHRoZSBwZXItdGFibGUgdHJ1bmNhdGUvZGVsZXRlLWZhbGxiYWNrIHN0YXRlbWVudHMuXG4gICAqIEBwYXJhbSB7QXJyYXk8aW1wb3J0KFwiLi4vYmFzZS10YWJsZS5qc1wiKS5kZWZhdWx0Pn0gdGFibGVzIC0gRWxpZ2libGUgdGFibGVzLlxuICAgKiBAcmV0dXJucyB7c3RyaW5nW119IC0gU1FMIHN0YXRlbWVudHMuXG4gICAqL1xuICBfdHJ1bmNhdGVUYWJsZVN0YXRlbWVudHModGFibGVzKSB7XG4gICAgY29uc3Qgc3RhdGVtZW50cyA9IFtdXG5cbiAgICBmb3IgKGNvbnN0IHRhYmxlIG9mIHRhYmxlcykge1xuICAgICAgY29uc3QgcXVvdGVkVGFibGUgPSB0aGlzLnF1b3RlVGFibGUodGFibGUuZ2V0TmFtZSgpKVxuXG4gICAgICBzdGF0ZW1lbnRzLnB1c2goXG4gICAgICAgIFwiQkVHSU4gVFJZXCIsXG4gICAgICAgIGAgIFRSVU5DQVRFIFRBQkxFICR7cXVvdGVkVGFibGV9O2AsXG4gICAgICAgIFwiRU5EIFRSWVwiLFxuICAgICAgICBcIkJFR0lOIENBVENIXCIsXG4gICAgICAgIFwiICBJRiBFUlJPUl9OVU1CRVIoKSA9IDQ3MTJcIixcbiAgICAgICAgXCIgIEJFR0lOXCIsXG4gICAgICAgIGAgICAgREVMRVRFIEZST00gJHtxdW90ZWRUYWJsZX07YCxcbiAgICAgICAgXCIgIEVORFwiLFxuICAgICAgICBcIiAgRUxTRVwiLFxuICAgICAgICBcIiAgQkVHSU5cIixcbiAgICAgICAgXCIgICAgVEhST1c7XCIsXG4gICAgICAgIFwiICBFTkRcIixcbiAgICAgICAgXCJFTkQgQ0FUQ0g7XCJcbiAgICAgIClcbiAgICB9XG5cbiAgICByZXR1cm4gc3RhdGVtZW50c1xuICB9XG5cbiAgYXN5bmMgbGFzdEluc2VydElEKG9wdGlvbnMgPSB7fSkge1xuICAgIGNvbnN0IHJlc3VsdCA9IGF3YWl0IHRoaXMucXVlcnkoXCJTRUxFQ1QgU0NPUEVfSURFTlRJVFkoKSBBUyBsYXN0X2luc2VydF9pZFwiLCBvcHRpb25zKVxuICAgIGNvbnN0IGxhc3RJbnNlcnRJRCA9IGRpZ2cocmVzdWx0LCAwLCBcImxhc3RfaW5zZXJ0X2lkXCIpXG5cbiAgICBpZiAobGFzdEluc2VydElEID09PSBudWxsKSB0aHJvdyBuZXcgRXJyb3IoXCJDb3VsZG4ndCBnZXQgdGhlIGxhc3QgaW5zZXJ0ZWQgSURcIilcblxuICAgIHJldHVybiBsYXN0SW5zZXJ0SURcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIG9wdGlvbnMuXG4gICAqIEByZXR1cm5zIHtPcHRpb25zfSAtIFRoZSBvcHRpb25zIG9wdGlvbnMuXG4gICAqL1xuICBvcHRpb25zKCkge1xuICAgIGlmICghdGhpcy5fb3B0aW9ucykgdGhpcy5fb3B0aW9ucyA9IG5ldyBPcHRpb25zKHtkcml2ZXI6IHRoaXN9KVxuXG4gICAgcmV0dXJuIHRoaXMuX29wdGlvbnNcbiAgfVxuXG4gIGFzeW5jIF9zdGFydFRyYW5zYWN0aW9uQWN0aW9uKCkge1xuICAgIGF3YWl0IHRoaXMuX3J1blBoeXNpY2FsQ29ubmVjdGlvblJlcXVlc3QoYXN5bmMgKCkgPT4ge1xuICAgICAgaWYgKHRoaXMuX2N1cnJlbnRUcmFuc2FjdGlvbikgdGhyb3cgbmV3IEVycm9yKFwiQSB0cmFuc2FjdGlvbiBpcyBhbHJlYWR5IHJ1bm5pbmdcIilcbiAgICAgIGlmICghdGhpcy5jb25uZWN0aW9uKSBhd2FpdCB0aGlzLmNvbm5lY3QoKVxuXG4gICAgICB0aGlzLl9jdXJyZW50VHJhbnNhY3Rpb24gPSBuZXcgbXNzcWwuVHJhbnNhY3Rpb24odGhpcy5jb25uZWN0aW9uKVxuXG4gICAgICB0cnkge1xuICAgICAgICBhd2FpdCB0aGlzLl9jdXJyZW50VHJhbnNhY3Rpb24uYmVnaW4oKVxuICAgICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgICAgdGhpcy5fY3VycmVudFRyYW5zYWN0aW9uID0gbnVsbFxuICAgICAgICB0aHJvdyBlcnJvclxuICAgICAgfVxuICAgIH0pXG4gIH1cblxuICBhc3luYyBfY29tbWl0VHJhbnNhY3Rpb25BY3Rpb24oKSB7XG4gICAgYXdhaXQgdGhpcy5fcnVuUGh5c2ljYWxDb25uZWN0aW9uUmVxdWVzdChhc3luYyAoKSA9PiB7XG4gICAgICBpZiAoIXRoaXMuX2N1cnJlbnRUcmFuc2FjdGlvbikgdGhyb3cgbmV3IEVycm9yKFwiQSB0cmFuc2FjdGlvbiBpc24ndCBydW5uaW5nXCIpXG5cbiAgICAgIGF3YWl0IHRoaXMuX2N1cnJlbnRUcmFuc2FjdGlvbi5jb21taXQoKVxuICAgICAgdGhpcy5fY3VycmVudFRyYW5zYWN0aW9uID0gbnVsbFxuICAgIH0pXG4gIH1cblxuICBhc3luYyBfcm9sbGJhY2tUcmFuc2FjdGlvbkFjdGlvbigpIHtcbiAgICBhd2FpdCB0aGlzLl9ydW5QaHlzaWNhbENvbm5lY3Rpb25SZXF1ZXN0KGFzeW5jICgpID0+IHtcbiAgICAgIGlmICghdGhpcy5fY3VycmVudFRyYW5zYWN0aW9uKSB7XG4gICAgICAgIHRoaXMubG9nZ2VyLmRlYnVnKFwiQSB0cmFuc2FjdGlvbiBpc24ndCBydW5uaW5nIC0gaWdub3JpbmcgYmVjYXVzZSB0aGF0IGNhbiBoYXBwZW4gaWYgc29tZXRoaW5nIGVsc2UgaGFzIGZhaWxlZCBpbiB0aGUgZGJcIilcbiAgICAgICAgcmV0dXJuXG4gICAgICB9XG5cbiAgICAgIHRyeSB7XG4gICAgICAgIGF3YWl0IHRoaXMuX2N1cnJlbnRUcmFuc2FjdGlvbi5yb2xsYmFjaygpXG4gICAgICB9IGNhdGNoICh0cmFuc2FjdGlvblJvbGxiYWNrRXJyb3IpIHtcbiAgICAgICAgLy8gV2hlbiBTUUwgU2VydmVyIGhhcyBhbHJlYWR5IGFib3J0ZWQgdGhlIHRyYW5zYWN0aW9uIChlLmcuLCBhXG4gICAgICAgIC8vIHN0YWxlIGNvbmN1cnJlbnQgcmVxdWVzdCB0cmlnZ2VyZWQgWEFDVF9BQk9SVCksIHRoZVxuICAgICAgICAvLyBtc3NxbC5UcmFuc2FjdGlvbi5yb2xsYmFjaygpIGNhbGwgZmFpbHMgYmVjYXVzZSB0aGVcbiAgICAgICAgLy8gVHJhbnNhY3Rpb24gb2JqZWN0IGlzIGRlYWQuICBJc3N1ZSBhIHJhdyBST0xMQkFDSyBvbiB0aGVcbiAgICAgICAgLy8gdW5kZXJseWluZyBjb25uZWN0aW9uIHRvIGNsZWFyIFNRTCBTZXJ2ZXIncyBzZXNzaW9uLWxldmVsXG4gICAgICAgIC8vIGFib3J0ZWQtdHJhbnNhY3Rpb24gc3RhdGUgc28gdGhlIGNvbm5lY3Rpb24gaXMgdXNhYmxlIGZvciB0aGVcbiAgICAgICAgLy8gbmV4dCBCRUdJTiBUUkFOU0FDVElPTi5cbiAgICAgICAgdGhpcy5sb2dnZXIud2FybihcIlRyYW5zYWN0aW9uLnJvbGxiYWNrKCkgZmFpbGVkLCBjbGVhcmluZyBzZXNzaW9uIHN0YXRlIHdpdGggcmF3IFJPTExCQUNLXCIsIHtcbiAgICAgICAgICBlcnJvcjogdHJhbnNhY3Rpb25Sb2xsYmFja0Vycm9yIGluc3RhbmNlb2YgRXJyb3IgPyB0cmFuc2FjdGlvblJvbGxiYWNrRXJyb3IubWVzc2FnZSA6IHRyYW5zYWN0aW9uUm9sbGJhY2tFcnJvclxuICAgICAgICB9KVxuXG4gICAgICAgIGNvbnN0IHJlcXVlc3QgPSBuZXcgbXNzcWwuUmVxdWVzdCh0aGlzLmNvbm5lY3Rpb24pXG5cbiAgICAgICAgYXdhaXQgcmVxdWVzdC5xdWVyeShcIklGIEBAVFJBTkNPVU5UID4gMCBST0xMQkFDS1wiKVxuICAgICAgfSBmaW5hbGx5IHtcbiAgICAgICAgdGhpcy5fY3VycmVudFRyYW5zYWN0aW9uID0gbnVsbFxuICAgICAgfVxuICAgIH0pXG4gIH1cblxuICAvKipcbiAgICogUnVucyBzdGFydCBzYXZlIHBvaW50IGFjdGlvbi5cbiAgICogQHBhcmFtIHtzdHJpbmd9IHNhdmVQb2ludE5hbWUgLSBTYXZlIHBvaW50IG5hbWUuXG4gICAqIEBwYXJhbSB7UGljazxpbXBvcnQoXCIuLi9iYXNlLmpzXCIpLlF1ZXJ5T3B0aW9ucywgXCJvcGVyYXRpb25Pd25lclwiPn0gW29wdGlvbnNdIC0gVHJhbnNhY3Rpb24gb3duZXJzaGlwLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyB3aGVuIGNvbXBsZXRlLlxuICAgKi9cbiAgYXN5bmMgX3N0YXJ0U2F2ZVBvaW50QWN0aW9uKHNhdmVQb2ludE5hbWUsIG9wdGlvbnMgPSB7fSkge1xuICAgIGF3YWl0IHRoaXMucXVlcnkoYFNBVkUgVFJBTlNBQ1RJT04gWyR7c2F2ZVBvaW50TmFtZX1dYCwgb3B0aW9ucylcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHJlbGVhc2Ugc2F2ZSBwb2ludCBhY3Rpb24uXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBzYXZlUG9pbnROYW1lIC0gU2F2ZSBwb2ludCBuYW1lLlxuICAgKiBAcGFyYW0ge1BpY2s8aW1wb3J0KFwiLi4vYmFzZS5qc1wiKS5RdWVyeU9wdGlvbnMsIFwib3BlcmF0aW9uT3duZXJcIj59IFtfb3B0aW9uc10gLSBUcmFuc2FjdGlvbiBvd25lcnNoaXAuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIHdoZW4gY29tcGxldGUuXG4gICAqL1xuICBhc3luYyBfcmVsZWFzZVNhdmVQb2ludEFjdGlvbihzYXZlUG9pbnROYW1lLCBfb3B0aW9ucyA9IHt9KSB7XG4gICAgLy8gRG8gbm90aGluZyBpbiBNUy1TUUwuXG4gIH1cblxuICAvKipcbiAgICogUnVucyByb2xsYmFjayBzYXZlIHBvaW50IGFjdGlvbi5cbiAgICogQHBhcmFtIHtzdHJpbmd9IHNhdmVQb2ludE5hbWUgLSBTYXZlIHBvaW50IG5hbWUuXG4gICAqIEBwYXJhbSB7UGljazxpbXBvcnQoXCIuLi9iYXNlLmpzXCIpLlF1ZXJ5T3B0aW9ucywgXCJvcGVyYXRpb25Pd25lclwiPn0gW29wdGlvbnNdIC0gVHJhbnNhY3Rpb24gb3duZXJzaGlwLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyB3aGVuIGNvbXBsZXRlLlxuICAgKi9cbiAgYXN5bmMgX3JvbGxiYWNrU2F2ZVBvaW50QWN0aW9uKHNhdmVQb2ludE5hbWUsIG9wdGlvbnMgPSB7fSkge1xuICAgIHRyeSB7XG4gICAgICBhd2FpdCB0aGlzLnF1ZXJ5KGBST0xMQkFDSyBUUkFOU0FDVElPTiBbJHtzYXZlUG9pbnROYW1lfV1gLCBvcHRpb25zKVxuICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICBjb25zdCBtZXNzYWdlID0gZXJyb3IgaW5zdGFuY2VvZiBFcnJvciA/IGVycm9yLm1lc3NhZ2UgOiBgJHtlcnJvcn1gXG5cbiAgICAgIC8vIFdoZW4gWEFDVF9BQk9SVCBraWxscyB0aGUgZW50aXJlIHRyYW5zYWN0aW9uLCB0aGUgc2F2ZXBvaW50XG4gICAgICAvLyBubyBsb25nZXIgZXhpc3RzIGFuZCB0aGUgUk9MTEJBQ0sgVFJBTlNBQ1RJT04gW25hbWVdIGZhaWxzLlxuICAgICAgLy8gSXNzdWUgYSByYXcgSUYgQEBUUkFOQ09VTlQgPiAwIFJPTExCQUNLIHRvIGNsZWFyIHdoYXRldmVyXG4gICAgICAvLyBzZXNzaW9uIHN0YXRlIHJlbWFpbnMsIHRoZW4gbGV0IHRoZSBlcnJvciBwcm9wYWdhdGUgc28gdGhlXG4gICAgICAvLyBvdXRlciB0cmFuc2FjdGlvbigpIGNhbGwga25vd3MgdGhlIHRyYW5zYWN0aW9uIGlzIGRlYWQuXG4gICAgICBpZiAobWVzc2FnZS5pbmNsdWRlcyhcIlRyYW5zYWN0aW9uIGhhcyBub3QgYmVndW5cIikgfHwgbWVzc2FnZS5pbmNsdWRlcyhcIlRyYW5zYWN0aW9uIGhhcyBiZWVuIGFib3J0ZWRcIikpIHtcbiAgICAgICAgdGhpcy5sb2dnZXIuZGVidWcoXCJTYXZlcG9pbnQgcm9sbGJhY2sgZmFpbGVkOyB0cmFuc2FjdGlvbiBhbHJlYWR5IGRlYWQsIGNsZWFyaW5nIHNlc3Npb24gc3RhdGVcIilcblxuICAgICAgICBjb25zdCByZXF1ZXN0ID0gbmV3IG1zc3FsLlJlcXVlc3QodGhpcy5jb25uZWN0aW9uKVxuXG4gICAgICAgIGF3YWl0IHJlcXVlc3QucXVlcnkoXCJJRiBAQFRSQU5DT1VOVCA+IDAgUk9MTEJBQ0tcIilcblxuICAgICAgICByZXR1cm5cbiAgICAgIH1cblxuICAgICAgdGhyb3cgZXJyb3JcbiAgICB9XG4gIH1cblxuICBnZW5lcmF0ZVNhdmVQb2ludE5hbWUoKSB7XG4gICAgcmV0dXJuIGBzcCR7bmV3IFVVSUQoNCkuZm9ybWF0KCkucmVwbGFjZUFsbChcIi1cIiwgXCJcIil9YC5zdWJzdHJpbmcoMCwgMzIpXG4gIH1cblxuICAvKipcbiAgICogUnVucyB1cGRhdGUgc3FsLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL2Jhc2UuanNcIikuVXBkYXRlU3FsQXJnc1R5cGV9IGFyZ3MgLSBPcHRpb25zIG9iamVjdC5cbiAgICogQHJldHVybnMge3N0cmluZ30gLSBTUUwgc3RyaW5nLlxuICAgKi9cbiAgdXBkYXRlU3FsKHtjb25kaXRpb25zLCBkYXRhLCB0YWJsZU5hbWV9KSB7XG4gICAgY29uc3QgdXBkYXRlID0gbmV3IFVwZGF0ZSh7Y29uZGl0aW9ucywgZGF0YSwgZHJpdmVyOiB0aGlzLCB0YWJsZU5hbWV9KVxuXG4gICAgcmV0dXJuIHVwZGF0ZS50b1NxbCgpXG4gIH1cblxuICAvKipcbiAgICogUnVucyB1cHNlcnQgc3FsLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL2Jhc2UuanNcIikuVXBzZXJ0U3FsQXJnc1R5cGV9IGFyZ3MgLSBPcHRpb25zIG9iamVjdC5cbiAgICogQHJldHVybnMge3N0cmluZ30gLSBTUUwgc3RyaW5nLlxuICAgKi9cbiAgdXBzZXJ0U3FsKGFyZ3MpIHtcbiAgICBjb25zdCB1cHNlcnQgPSBuZXcgVXBzZXJ0KHsuLi5hcmdzLCBkcml2ZXI6IHRoaXN9KVxuXG4gICAgcmV0dXJuIHVwc2VydC50b1NxbCgpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBzdHJ1Y3R1cmUgc3FsLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxzdHJpbmcgfCBudWxsPn0gLSBSZXNvbHZlcyB3aXRoIFNRTCBzdHJpbmcuXG4gICAqL1xuICBhc3luYyBzdHJ1Y3R1cmVTcWwoKSB7XG4gICAgcmV0dXJuIGF3YWl0IHRoaXMuX2NhY2hlZFNjaGVtYU1ldGFkYXRhKFwic3RydWN0dXJlU3FsXCIsIGFzeW5jICgpID0+IGF3YWl0IG5ldyBTdHJ1Y3R1cmVTcWwoe2RyaXZlcjogdGhpc30pLnRvU3FsKCkpXG4gIH1cblxuICAvKipcbiAgICogQmxvY2tzIHVudGlsIGEgU1FMIFNlcnZlciBhcHBsaWNhdGlvbiBsb2NrIGlzIGFjcXVpcmVkIG9uIHRoaXNcbiAgICogY29ubmVjdGlvbiB2aWEgYHNwX2dldGFwcGxvY2tgLiBUaGUgU2Vzc2lvbiBsb2NrIG93bmVyIHNjb3BlcyB0aGUgbG9ja1xuICAgKiB0byB0aGUgY3VycmVudCBzZXNzaW9uLCBtYXRjaGluZyB0aGUgY29ubmVjdGlvbi1zY29wZWQgc2VtYW50aWNzIG9uXG4gICAqIE15U1FMIGFuZCBQb3N0Z3JlU1FMLlxuICAgKlxuICAgKiBgc3BfZ2V0YXBwbG9ja2AgcmV0dXJucyAwIG9uIGltbWVkaWF0ZSBncmFudCwgMSBhZnRlciB3YWl0aW5nLCBhbmRcbiAgICogbmVnYXRpdmUgdmFsdWVzIG9uIGZhaWx1cmUgKHRpbWVvdXQsIGRlYWRsb2NrLCBjYW5jZWxlZCwgcGFyYW1ldGVyXG4gICAqIGVycm9yKS4gV2UgdHJlYXQgMC8xIGFzIHN1Y2Nlc3MgYW5kIC0xICh0aW1lb3V0KSBhcyBhIGNsZWFuIGBmYWxzZWA7XG4gICAqIGFueXRoaW5nIGVsc2UgdGhyb3dzLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gbmFtZSAtIExvY2sgbmFtZS5cbiAgICogQHBhcmFtIHt7dGltZW91dE1zPzogbnVtYmVyIHwgbnVsbH19IFthcmdzXSAtIE9wdGlvbmFsIHRpbWVvdXQgaW4gbWlsbGlzZWNvbmRzOyBgbnVsbGAsIGB1bmRlZmluZWRgLCBvciBuZWdhdGl2ZSBibG9ja3MgZm9yZXZlci5cbiAgICogQHJldHVybnMge1Byb21pc2U8Ym9vbGVhbj59IC0gVHJ1ZSBpZiB0aGUgbG9jayB3YXMgYWNxdWlyZWQsIGZhbHNlIGlmIHRoZSB0aW1lb3V0IGVsYXBzZWQuXG4gICAqL1xuICBhc3luYyBfYWNxdWlyZUFkdmlzb3J5TG9jayhuYW1lLCB7dGltZW91dE1zfSA9IHt9KSB7XG4gICAgY29uc3QgdGltZW91dFZhbHVlID0gdHlwZW9mIHRpbWVvdXRNcyA9PT0gXCJudW1iZXJcIiAmJiB0aW1lb3V0TXMgPj0gMCA/IE1hdGguY2VpbCh0aW1lb3V0TXMpIDogLTFcbiAgICBjb25zdCByb3dzID0gYXdhaXQgdGhpcy5fYWR2aXNvcnlMb2NrUXVlcnkoXG4gICAgICBgREVDTEFSRSBAdmVsb2Npb3VzX2Fkdmlzb3J5X2xvY2tfcmVzdWx0IElOVDsgRVhFQyBAdmVsb2Npb3VzX2Fkdmlzb3J5X2xvY2tfcmVzdWx0ID0gc3BfZ2V0YXBwbG9jayBAUmVzb3VyY2UgPSAke3RoaXMucXVvdGUobmFtZSl9LCBATG9ja01vZGUgPSAnRXhjbHVzaXZlJywgQExvY2tPd25lciA9ICdTZXNzaW9uJywgQExvY2tUaW1lb3V0ID0gJHt0aW1lb3V0VmFsdWV9OyBTRUxFQ1QgQHZlbG9jaW91c19hZHZpc29yeV9sb2NrX3Jlc3VsdCBBUyB2ZWxvY2lvdXNfYWR2aXNvcnlfbG9ja19yZXN1bHRgXG4gICAgKVxuICAgIGNvbnN0IHJlc3VsdCA9IE51bWJlcihyb3dzPy5bMF0/LnZlbG9jaW91c19hZHZpc29yeV9sb2NrX3Jlc3VsdClcblxuICAgIGlmIChyZXN1bHQgPT09IDAgfHwgcmVzdWx0ID09PSAxKSByZXR1cm4gdHJ1ZVxuXG4gICAgYXdhaXQgdGhpcy5fY2xvc2VBZHZpc29yeUxvY2tUcmFuc2FjdGlvbigpXG5cbiAgICBpZiAocmVzdWx0ID09PSAtMSkgcmV0dXJuIGZhbHNlXG5cbiAgICB0aHJvdyBuZXcgRXJyb3IoYHNwX2dldGFwcGxvY2sgcmV0dXJuZWQgJHtyZXN1bHR9IGZvciBhZHZpc29yeSBsb2NrICR7SlNPTi5zdHJpbmdpZnkobmFtZSl9IChzZWUgU1FMIFNlcnZlciBkb2N1bWVudGF0aW9uIGZvciBzcF9nZXRhcHBsb2NrIHJldHVybiBjb2RlcylgKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgdHJ5IGFjcXVpcmUgYWR2aXNvcnkgbG9jay5cbiAgICogQHBhcmFtIHtzdHJpbmd9IG5hbWUgLSBMb2NrIG5hbWUuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPGJvb2xlYW4+fSAtIFRydWUgaWYgdGhlIGxvY2sgd2FzIGFjcXVpcmVkLCBmYWxzZSBpZiBpdCB3YXMgYWxyZWFkeSBoZWxkLlxuICAgKi9cbiAgYXN5bmMgX3RyeUFjcXVpcmVBZHZpc29yeUxvY2sobmFtZSkge1xuICAgIHJldHVybiBhd2FpdCB0aGlzLl9hY3F1aXJlQWR2aXNvcnlMb2NrKG5hbWUsIHt0aW1lb3V0TXM6IDB9KVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgcmVsZWFzZSBhZHZpc29yeSBsb2NrLlxuICAgKlxuICAgKiBgc3BfcmVsZWFzZWFwcGxvY2tgIHJldHVybnMgMCB3aGVuIHRoZSBsb2NrIHdhcyByZWxlYXNlZCwgYnV0IFNRTCBTZXJ2ZXJcbiAgICogcmFpc2VzIGVycm9yIHtAbGluayBBUFBMT0NLX05PVF9IRUxEX0VSUk9SX05VTUJFUn0gaW5zdGVhZCBvZiByZXR1cm5pbmcgYVxuICAgKiBmYWlsdXJlIGNvZGUgd2hlbiB0aGUgc2Vzc2lvbiBkb2VzIG5vdCBjdXJyZW50bHkgaG9sZCB0aGUgbG9jay4gVGhhdFxuICAgKiBlcnJvciBhYm9ydHMgdGhlIGJhdGNoIGJlZm9yZSB0aGUgdHJhaWxpbmcgYFNFTEVDVGAgY2FuIHJ1biwgc28gd2UgY2F0Y2hcbiAgICogaXQgYW5kIHJlc29sdmUgdG8gYGZhbHNlYCB0byBob25vciB0aGUgY3Jvc3MtZHJpdmVyIGNvbnRyYWN0IGZvciBhblxuICAgKiBhbHJlYWR5LXVuaGVsZCBsb2NrLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gbmFtZSAtIExvY2sgbmFtZS5cbiAgICogQHJldHVybnMge1Byb21pc2U8Ym9vbGVhbj59IC0gVHJ1ZSBpZiB0aGUgbG9jayB3YXMgaGVsZCBieSB0aGlzIHNlc3Npb24gYW5kIGhhcyBub3cgYmVlbiByZWxlYXNlZC5cbiAgICovXG4gIGFzeW5jIF9yZWxlYXNlQWR2aXNvcnlMb2NrKG5hbWUpIHtcbiAgICBsZXQgcm93c1xuXG4gICAgdHJ5IHtcbiAgICAgIHJvd3MgPSBhd2FpdCB0aGlzLl9hZHZpc29yeUxvY2tRdWVyeShcbiAgICAgICAgYERFQ0xBUkUgQHZlbG9jaW91c19hZHZpc29yeV9sb2NrX3Jlc3VsdCBJTlQ7IEVYRUMgQHZlbG9jaW91c19hZHZpc29yeV9sb2NrX3Jlc3VsdCA9IHNwX3JlbGVhc2VhcHBsb2NrIEBSZXNvdXJjZSA9ICR7dGhpcy5xdW90ZShuYW1lKX0sIEBMb2NrT3duZXIgPSAnU2Vzc2lvbic7IFNFTEVDVCBAdmVsb2Npb3VzX2Fkdmlzb3J5X2xvY2tfcmVzdWx0IEFTIHZlbG9jaW91c19hZHZpc29yeV9sb2NrX3Jlc3VsdGBcbiAgICAgIClcbiAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgaWYgKHRoaXMuX2lzQXBwbG9ja05vdEhlbGRFcnJvcihlcnJvcikpIHtcbiAgICAgICAgYXdhaXQgdGhpcy5fY2xvc2VBZHZpc29yeUxvY2tUcmFuc2FjdGlvbklmRmluYWxSZWxlYXNlKClcblxuICAgICAgICByZXR1cm4gZmFsc2VcbiAgICAgIH1cblxuICAgICAgdGhyb3cgZXJyb3JcbiAgICB9XG5cbiAgICBjb25zdCByZXN1bHQgPSBOdW1iZXIocm93cz8uWzBdPy52ZWxvY2lvdXNfYWR2aXNvcnlfbG9ja19yZXN1bHQpXG5cbiAgICBhd2FpdCB0aGlzLl9jbG9zZUFkdmlzb3J5TG9ja1RyYW5zYWN0aW9uSWZGaW5hbFJlbGVhc2UoKVxuXG4gICAgcmV0dXJuIHJlc3VsdCA9PT0gMFxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgYW4gYWR2aXNvcnktbG9jayBzdGF0ZW1lbnQgdGhyb3VnaCBvbmUgdHJhbnNhY3Rpb24gcmVxdWVzdCBwYXJlbnQuXG4gICAqIG5vZGUtbXNzcWwgcmVzZXJ2ZXMgb25lIHBoeXNpY2FsIHNlc3Npb24gZm9yIGEgVHJhbnNhY3Rpb24sIHdoZXJlYXNcbiAgICogc2VwYXJhdGUgQ29ubmVjdGlvblBvb2wgcmVxdWVzdHMgbWF5IGNoZWNrIG91dCBkaWZmZXJlbnQgc2Vzc2lvbnMuIFRoZVxuICAgKiB0cmFuc2FjdGlvbiBjb250YWlucyBvbmx5IGFwcGxpY2F0aW9uLWxvY2sgc3RhdGVtZW50czsgY2FsbGVyL21vZGVsIHdvcmtcbiAgICogY29udGludWVzIHRocm91Z2ggaXRzIG9yaWdpbmFsIGNvbm5lY3Rpb24uXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBzcWwgLSBBZHZpc29yeS1sb2NrIFNRTC5cbiAgICogQHJldHVybnMge1Byb21pc2U8aW1wb3J0KFwiLi4vYmFzZS5qc1wiKS5RdWVyeVJlc3VsdFR5cGU+fSAtIFJlc3VsdCByb3dzLlxuICAgKi9cbiAgYXN5bmMgX2Fkdmlzb3J5TG9ja1F1ZXJ5KHNxbCkge1xuICAgIGNvbnN0IHRyYW5zYWN0aW9uID0gYXdhaXQgdGhpcy5fZW5zdXJlQWR2aXNvcnlMb2NrVHJhbnNhY3Rpb24oKVxuXG4gICAgdHJ5IHtcbiAgICAgIGNvbnN0IHJlcXVlc3QgPSBuZXcgbXNzcWwuUmVxdWVzdCh0cmFuc2FjdGlvbilcbiAgICAgIGNvbnN0IHJlc3VsdCA9IGF3YWl0IHJlcXVlc3QucXVlcnkoc3FsKVxuXG4gICAgICByZXR1cm4gQXJyYXkuaXNBcnJheShyZXN1bHQucmVjb3Jkc2V0cykgPyByZXN1bHQucmVjb3Jkc2V0c1swXSB8fCBbXSA6IFtdXG4gICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgIGlmIChlcnJvciBpbnN0YW5jZW9mIEVycm9yKSB7XG4gICAgICAgIHRocm93IG5ldyBFcnJvcihgUXVlcnkgZmFpbGVkICcke2Vycm9yLm1lc3NhZ2V9JzogJHtzcWx9YCwge2NhdXNlOiBlcnJvcn0pXG4gICAgICB9XG5cbiAgICAgIHRocm93IG5ldyBFcnJvcihgUXVlcnkgZmFpbGVkICcke2Vycm9yfSc6ICR7c3FsfWAsIHtjYXVzZTogZXJyb3J9KVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBTdGFydHMgdGhlIHRyYW5zYWN0aW9uIHJlcXVlc3QgcGFyZW50IHRoYXQgcmVzZXJ2ZXMgdGhlIGFkdmlzb3J5LWxvY2tcbiAgICogc2Vzc2lvbiB1bnRpbCB0aGUgZmluYWwgcmVsZWFzZSBvciBkcml2ZXIgY2xvc2UuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPGltcG9ydChcIm1zc3FsXCIpLlRyYW5zYWN0aW9uPn0gLSBTZXNzaW9uLWFmZmluZSBwYXJlbnQuXG4gICAqL1xuICBhc3luYyBfZW5zdXJlQWR2aXNvcnlMb2NrVHJhbnNhY3Rpb24oKSB7XG4gICAgaWYgKHRoaXMuX2Fkdmlzb3J5TG9ja1RyYW5zYWN0aW9uKSByZXR1cm4gdGhpcy5fYWR2aXNvcnlMb2NrVHJhbnNhY3Rpb25cbiAgICBpZiAoIXRoaXMuY29ubmVjdGlvbikgYXdhaXQgdGhpcy5jb25uZWN0KClcbiAgICBpZiAoIXRoaXMuY29ubmVjdGlvbikgdGhyb3cgbmV3IEVycm9yKFwiTVNTUUwgY29ubmVjdGlvbiB1bmF2YWlsYWJsZSBmb3IgYWR2aXNvcnkgbG9ja1wiKVxuXG4gICAgY29uc3QgdHJhbnNhY3Rpb24gPSBuZXcgbXNzcWwuVHJhbnNhY3Rpb24odGhpcy5jb25uZWN0aW9uKVxuXG4gICAgYXdhaXQgdHJhbnNhY3Rpb24uYmVnaW4oKVxuICAgIHRoaXMuX2Fkdmlzb3J5TG9ja1RyYW5zYWN0aW9uID0gdHJhbnNhY3Rpb25cblxuICAgIHJldHVybiB0cmFuc2FjdGlvblxuICB9XG5cbiAgLyoqXG4gICAqIFJlbGVhc2VzIHRoZSByZXNlcnZlZCBzZXNzaW9uIGFmdGVyIHRoZSBsYXN0IHRyYWNrZWQgbG9jayByZWxlYXNlLlxuICAgKiBCYXNlIHVudHJhY2tzIHRoZSBjdXJyZW50IHJlbGVhc2UgYWZ0ZXIgdGhlIGRyaXZlciBob29rIHJldHVybnMsIHNvIGFcbiAgICogY3VycmVudCB0b3RhbCBvZiBvbmUgbWVhbnMgdGhpcyBpcyB0aGUgZmluYWwgcmVsZWFzZS5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgYWZ0ZXIgY2xlYW51cCB3aGVuIHRoaXMgaXMgZmluYWwuXG4gICAqL1xuICBhc3luYyBfY2xvc2VBZHZpc29yeUxvY2tUcmFuc2FjdGlvbklmRmluYWxSZWxlYXNlKCkge1xuICAgIGxldCBoZWxkQ291bnQgPSAwXG5cbiAgICBmb3IgKGNvbnN0IGNvdW50IG9mIHRoaXMuX2hlbGRBZHZpc29yeUxvY2tzLnZhbHVlcygpKSBoZWxkQ291bnQgKz0gY291bnRcblxuICAgIGlmIChoZWxkQ291bnQgPD0gMSkgYXdhaXQgdGhpcy5fY2xvc2VBZHZpc29yeUxvY2tUcmFuc2FjdGlvbigpXG4gIH1cblxuICAvKipcbiAgICogUm9sbHMgYmFjayB0aGUgb3RoZXJ3aXNlLWVtcHR5IHRyYW5zYWN0aW9uIGFuZCByZXR1cm5zIGl0cyBwaHlzaWNhbFxuICAgKiBzZXNzaW9uIHRvIG5vZGUtbXNzcWwuIFJvbGxiYWNrIGlzIGNsZWFudXAgb25seTsgYWR2aXNvcnkgbG9ja3MgYXJlXG4gICAqIGV4cGxpY2l0bHkgcmVsZWFzZWQgZmlyc3Qgd2hlbmV2ZXIgdGhlaXIgcmVsZWFzZSBzdGF0ZW1lbnQgc3VjY2VlZHMuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIGFmdGVyIHNlc3Npb24gY2xlYW51cC5cbiAgICovXG4gIGFzeW5jIF9jbG9zZUFkdmlzb3J5TG9ja1RyYW5zYWN0aW9uKCkge1xuICAgIGNvbnN0IHRyYW5zYWN0aW9uID0gdGhpcy5fYWR2aXNvcnlMb2NrVHJhbnNhY3Rpb25cblxuICAgIGlmICghdHJhbnNhY3Rpb24pIHJldHVyblxuXG4gICAgdGhpcy5fYWR2aXNvcnlMb2NrVHJhbnNhY3Rpb24gPSBudWxsXG4gICAgYXdhaXQgdHJhbnNhY3Rpb24ucm9sbGJhY2soKVxuICB9XG5cbiAgLyoqXG4gICAqIERldGVjdHMgdGhlIFNRTCBTZXJ2ZXIgXCJhcHBsaWNhdGlvbiBsb2NrIGlzIG5vdCBjdXJyZW50bHkgaGVsZFwiIGVycm9yXG4gICAqIHJhaXNlZCBieSBgc3BfcmVsZWFzZWFwcGxvY2tgLiBJdCB3YWxrcyB0aGUgd3JhcHBlZC1lcnJvciBjYXVzZSBjaGFpblxuICAgKiBiZWNhdXNlIGBxdWVyeWAgcmUtd3JhcHMgdGhlIGRyaXZlcidzIGBSZXF1ZXN0RXJyb3JgIGluIGEgcGxhaW4gYEVycm9yYCxcbiAgICogYW5kIG1hdGNoZXMgb24gdGhlIHN0YWJsZSBudW1lcmljIGVycm9yIG51bWJlciByYXRoZXIgdGhhbiB0aGUgbWVzc2FnZS5cbiAgICogQHBhcmFtIHt1bmtub3dufSBlcnJvciAtIEVycm9yIHRocm93biB3aGlsZSByZWxlYXNpbmcgdGhlIGxvY2suXG4gICAqIEByZXR1cm5zIHtib29sZWFufSAtIFRydWUgaWYgdGhlIGVycm9yIG1lYW5zIHRoZSBsb2NrIHdhcyBub3QgaGVsZCBieSB0aGlzIHNlc3Npb24uXG4gICAqL1xuICBfaXNBcHBsb2NrTm90SGVsZEVycm9yKGVycm9yKSB7XG4gICAgbGV0IGN1cnJlbnQgPSBlcnJvclxuXG4gICAgd2hpbGUgKGN1cnJlbnQgaW5zdGFuY2VvZiBFcnJvcikge1xuICAgICAgY29uc3QgZXJyb3JOdW1iZXIgPSAvKiogQHR5cGUge3tudW1iZXI/OiB1bmtub3dufX0gKi8gKGN1cnJlbnQpLm51bWJlclxuXG4gICAgICBpZiAodHlwZW9mIGVycm9yTnVtYmVyID09PSBcIm51bWJlclwiICYmIGVycm9yTnVtYmVyID09PSBBUFBMT0NLX05PVF9IRUxEX0VSUk9SX05VTUJFUikgcmV0dXJuIHRydWVcblxuICAgICAgY3VycmVudCA9IGN1cnJlbnQuY2F1c2VcbiAgICB9XG5cbiAgICByZXR1cm4gZmFsc2VcbiAgfVxuXG4gIC8qKlxuICAgKiBSZXR1cm5zIHRydWUgaWYgYW55IHNlc3Npb24gY3VycmVudGx5IGhvbGRzIHRoZSBhcHBsaWNhdGlvbiBsb2NrLlxuICAgKlxuICAgKiBUaGlzIGNvbWJpbmVzIHR3byBwcm9iZXMgYmVjYXVzZSBuZWl0aGVyIGlzIHN1ZmZpY2llbnQgb24gaXRzIG93bjpcbiAgICogICAtIGBBUFBMT0NLX01PREUoLi4uLCAnU2Vzc2lvbicpYCBvbmx5IHJlcG9ydHMgbG9ja3MgaGVsZCBieSB0aGVcbiAgICogICAgICoqY3VycmVudCoqIHNlc3Npb24sIHNvIGl0IG1pc3NlcyBsb2NrcyBoZWxkIGJ5IGFueSBvdGhlclxuICAgKiAgICAgc2Vzc2lvbiBhbmQgd291bGQgcmV0dXJuIGBOb0xvY2tgIGV2ZW4gdW5kZXIgY3Jvc3Mtc2Vzc2lvblxuICAgKiAgICAgY29udGVudGlvbi5cbiAgICogICAtIGBBUFBMT0NLX1RFU1QoLi4uLCAnRXhjbHVzaXZlJywgJ1Nlc3Npb24nKWAgcmV0dXJucyB3aGV0aGVyIGFuXG4gICAqICAgICBFeGNsdXNpdmUgbG9jayBjb3VsZCBiZSBncmFudGVkIHRvICp0aGlzKiBzZXNzaW9uIHJpZ2h0IG5vdy4gQVxuICAgKiAgICAgcmV0dXJuIHZhbHVlIG9mIDAgbWVhbnMgc29tZWJvZHkgZWxzZSBob2xkcyBhbiBpbmNvbXBhdGlibGVcbiAgICogICAgIGxvY2s7IGEgdmFsdWUgb2YgMSBtZWFucyBpdCBpcyBlaXRoZXIgZnJlZSAqKm9yKiogYWxyZWFkeSBoZWxkXG4gICAqICAgICBieSB1cyByZS1lbnRyYW50bHkgKHdoaWNoIHRoZSBgQVBQTE9DS19NT0RFYCBjaGVjayBjYXRjaGVzKS5cbiAgICpcbiAgICogVGhlIGNvbWJpbmVkIHJlc3VsdCBpcyBcImhlbGRcIiBpZmYgd2UgaG9sZCBpdCBvdXJzZWx2ZXMgb3JcbiAgICogYEFQUExPQ0tfVEVTVGAgcmVwb3J0cyB3ZSBjYW5ub3QgYWNxdWlyZSBpdCB3aXRob3V0IHdhaXRpbmcuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBuYW1lIC0gTG9jayBuYW1lLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxib29sZWFuPn0gLSBUcnVlIGlmIGFueSBzZXNzaW9uIGN1cnJlbnRseSBob2xkcyB0aGUgbG9jay5cbiAgICovXG4gIGFzeW5jIGlzQWR2aXNvcnlMb2NrSGVsZChuYW1lKSB7XG4gICAgY29uc3Qgcm93cyA9IGF3YWl0IHRoaXMucXVlcnkoXG4gICAgICBgU0VMRUNUIGAgK1xuICAgICAgICBgQVBQTE9DS19NT0RFKCdwdWJsaWMnLCAke3RoaXMucXVvdGUobmFtZSl9LCAnU2Vzc2lvbicpIEFTIHZlbG9jaW91c19hZHZpc29yeV9zZWxmX21vZGUsIGAgK1xuICAgICAgICBgQVBQTE9DS19URVNUKCdwdWJsaWMnLCAke3RoaXMucXVvdGUobmFtZSl9LCAnRXhjbHVzaXZlJywgJ1Nlc3Npb24nKSBBUyB2ZWxvY2lvdXNfYWR2aXNvcnlfdGVzdF9yZXN1bHRgXG4gICAgKVxuICAgIGNvbnN0IHNlbGZNb2RlID0gcm93cz8uWzBdPy52ZWxvY2lvdXNfYWR2aXNvcnlfc2VsZl9tb2RlXG4gICAgY29uc3QgaGVsZEJ5U2VsZiA9IHR5cGVvZiBzZWxmTW9kZSA9PT0gXCJzdHJpbmdcIiAmJiBzZWxmTW9kZS5sZW5ndGggPiAwICYmIHNlbGZNb2RlICE9PSBcIk5vTG9ja1wiXG5cbiAgICBpZiAoaGVsZEJ5U2VsZikgcmV0dXJuIHRydWVcblxuICAgIGNvbnN0IHRlc3RSZXN1bHQgPSBOdW1iZXIocm93cz8uWzBdPy52ZWxvY2lvdXNfYWR2aXNvcnlfdGVzdF9yZXN1bHQpXG5cbiAgICByZXR1cm4gdGVzdFJlc3VsdCA9PT0gMFxuICB9XG5cbiAgLyoqXG4gICAqIEF0dHJpYnV0ZXMgdGhlIGN1cnJlbnQgaG9sZGVyIG9mIHRoZSBuYW1lZCBhcHBsaWNhdGlvbiBsb2NrIHRvIGl0c1xuICAgKiByZXF1ZXN0aW5nIHNlc3Npb24gZnJvbSBgc3lzLmRtX3RyYW5fbG9ja3NgLCBjYXB0dXJlZCBhdCB0aGUgdGVsZW1ldHJ5XG4gICAqIGV2ZW50IG1vbWVudCAoYmVzdC1lZmZvcnQ7IHRoZSBjYWxsZXIgZ3VhcmRzIGZhaWx1cmVzKS5cbiAgICogQHBhcmFtIHtzdHJpbmd9IG5hbWUgLSBMb2NrIG5hbWUuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHN0cmluZyB8IG51bGw+fSAtIFNRTCBTZXJ2ZXIgc2Vzc2lvbiBpZCBvZiB0aGUgaG9sZGVyLCBvciBudWxsIHdoZW4gbm8gc2Vzc2lvbiBob2xkcyB0aGUgbG9jay5cbiAgICovXG4gIGFzeW5jIGFkdmlzb3J5TG9ja0hvbGRlckNvbm5lY3Rpb25JZChuYW1lKSB7XG4gICAgY29uc3Qgcm93cyA9IGF3YWl0IHRoaXMucXVlcnkoXG4gICAgICBgU0VMRUNUIFRPUCAxIHJlcXVlc3Rfc2Vzc2lvbl9pZCBBUyB2ZWxvY2lvdXNfYWR2aXNvcnlfbG9ja19ob2xkZXIgRlJPTSBzeXMuZG1fdHJhbl9sb2NrcyBXSEVSRSByZXNvdXJjZV90eXBlID0gJ0FQUExJQ0FUSU9OTE9DSycgQU5EIHJlc291cmNlX2Rlc2NyaXB0aW9uID0gJHt0aGlzLnF1b3RlKG5hbWUpfWBcbiAgICApXG4gICAgY29uc3QgaG9sZGVyID0gcm93cz8uWzBdPy52ZWxvY2lvdXNfYWR2aXNvcnlfbG9ja19ob2xkZXJcblxuICAgIHJldHVybiBob2xkZXIgPT09IG51bGwgfHwgaG9sZGVyID09PSB1bmRlZmluZWQgPyBudWxsIDogU3RyaW5nKGhvbGRlcilcbiAgfVxufVxuIl19