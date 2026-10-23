// @ts-check
import AlterTable from "./sql/alter-table.js";
import Base from "../base.js";
import Column from "./column.js";
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
     * Reads column metadata for many tables in one query. The per-table read of the
     * same three-way `INFORMATION_SCHEMA` join is one of the slowest things a boot
     * does against the legacy SQL Server, so it is worth combining regardless of the
     * number of tables.
     * @param {Array<import("../base-table.js").default>} tables - Tables to load columns for.
     * @returns {Promise<Map<string, Array<import("../base-column.js").default>>>} - Columns keyed by table name.
     */
    async batchTableColumns(tables) {
        /** @type {Map<string, Array<import("../base-column.js").default>>} */
        const columnsByTable = new Map();
        if (tables.length === 0)
            return columnsByTable;
        const schema = this.getArgs()?.schema || this.getArgs()?.sqlConfig?.options?.schema;
        const schemaClause = schema
            ? ` AND columns.[TABLE_SCHEMA] = ${this.quote(schema)}`
            : " AND columns.[TABLE_SCHEMA] = SCHEMA_NAME()";
        const tablesByName = new Map(tables.map((table) => [table.getName(), table]));
        const tableNamesSql = [...tablesByName.keys()].map((tableName) => this.quote(tableName)).join(", ");
        const rows = await this.query(`
      SELECT
        columns.*,
        COLUMNPROPERTY(object_id(columns.TABLE_SCHEMA + '.' + columns.TABLE_NAME), columns.COLUMN_NAME, 'IsIdentity') AS isIdentity,
        CASE WHEN keyColumnUsage.COLUMN_NAME IS NOT NULL THEN 1 ELSE 0 END AS isPrimaryKey
      FROM [INFORMATION_SCHEMA].[COLUMNS] AS columns
      LEFT JOIN [INFORMATION_SCHEMA].[TABLE_CONSTRAINTS] AS tableConstraints ON
        tableConstraints.CONSTRAINT_TYPE = 'PRIMARY KEY' AND
        tableConstraints.TABLE_CATALOG = columns.TABLE_CATALOG AND
        tableConstraints.TABLE_SCHEMA = columns.TABLE_SCHEMA AND
        tableConstraints.TABLE_NAME = columns.TABLE_NAME
      LEFT JOIN [INFORMATION_SCHEMA].[KEY_COLUMN_USAGE] AS keyColumnUsage ON
        keyColumnUsage.CONSTRAINT_CATALOG = tableConstraints.CONSTRAINT_CATALOG AND
        keyColumnUsage.CONSTRAINT_SCHEMA = tableConstraints.CONSTRAINT_SCHEMA AND
        keyColumnUsage.CONSTRAINT_NAME = tableConstraints.CONSTRAINT_NAME AND
        keyColumnUsage.TABLE_CATALOG = columns.TABLE_CATALOG AND
        keyColumnUsage.TABLE_SCHEMA = columns.TABLE_SCHEMA AND
        keyColumnUsage.TABLE_NAME = columns.TABLE_NAME AND
        keyColumnUsage.COLUMN_NAME = columns.COLUMN_NAME
      WHERE columns.TABLE_NAME IN (${tableNamesSql})${schemaClause}
      ORDER BY columns.TABLE_NAME, columns.ORDINAL_POSITION
    `);
        for (const row of rows) {
            const tableName = /** @type {string} */ (row.TABLE_NAME);
            const table = tablesByName.get(tableName);
            if (!table)
                continue;
            const columns = columnsByTable.get(tableName) || [];
            columns.push(new Column(table, /** @type {Record<string, ReturnType<typeof JSON.parse>>} */ (row)));
            columnsByTable.set(tableName, columns);
        }
        return columnsByTable;
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
    async _isAdvisoryLockHeldNative(name) {
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiaW5kZXguanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi8uLi8uLi9zcmMvZGF0YWJhc2UvZHJpdmVycy9tc3NxbC9pbmRleC5qcyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiQUFBQSxZQUFZO0FBRVosT0FBTyxVQUFVLE1BQU0sc0JBQXNCLENBQUE7QUFDN0MsT0FBTyxJQUFJLE1BQU0sWUFBWSxDQUFBO0FBQzdCLE9BQU8sTUFBTSxNQUFNLGFBQWEsQ0FBQTtBQUNoQyxPQUFPLGNBQWMsTUFBTSwwQkFBMEIsQ0FBQTtBQUNyRCxPQUFPLFdBQVcsTUFBTSx1QkFBdUIsQ0FBQTtBQUMvQyxPQUFPLFdBQVcsTUFBTSx1QkFBdUIsQ0FBQTtBQUMvQyxPQUFPLE1BQU0sTUFBTSxpQkFBaUIsQ0FBQTtBQUNwQyxPQUFPLFlBQVksTUFBTSx3QkFBd0IsQ0FBQTtBQUNqRCxPQUFPLFNBQVMsTUFBTSxxQkFBcUIsQ0FBQTtBQUMzQyxPQUFPLEVBQUMsSUFBSSxFQUFDLE1BQU0sV0FBVyxDQUFBO0FBQzlCLE9BQU8sWUFBWSxNQUFNLG1CQUFtQixDQUFBO0FBQzVDLE9BQU8sTUFBTSxNQUFNLGlCQUFpQixDQUFBO0FBQ3BDLE9BQU8sT0FBTyxNQUFNLGNBQWMsQ0FBQTtBQUNsQyxPQUFPLEtBQUssTUFBTSxPQUFPLENBQUE7QUFDekIsT0FBTyxHQUFHLE1BQU0sVUFBVSxDQUFBO0FBQzFCLE9BQU8sV0FBVyxNQUFNLG1CQUFtQixDQUFBO0FBQzNDLE9BQU8sV0FBVyxNQUFNLHVCQUF1QixDQUFBO0FBQy9DLE9BQU8sS0FBSyxNQUFNLFlBQVksQ0FBQTtBQUM5QixPQUFPLFlBQVksTUFBTSxvQkFBb0IsQ0FBQTtBQUM3QyxPQUFPLE9BQU8sTUFBTSwyQkFBMkIsQ0FBQTtBQUMvQyxPQUFPLE1BQU0sTUFBTSxpQkFBaUIsQ0FBQTtBQUNwQyxPQUFPLE1BQU0sTUFBTSxpQkFBaUIsQ0FBQTtBQUNwQyxPQUFPLElBQUksTUFBTSxXQUFXLENBQUE7QUFF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UyxDQUFDLENBQUMsQ0FBQyxJQUFJLENBQUMsQ0FBQyxDQUFDLE1BQU0sQ0FBQyxNQUFNLENBQUMsQ0FBQTtJQUN4RSxDQUFDO0NBQ0YiLCJzb3VyY2VzQ29udGVudCI6WyIvLyBAdHMtY2hlY2tcblxuaW1wb3J0IEFsdGVyVGFibGUgZnJvbSBcIi4vc3FsL2FsdGVyLXRhYmxlLmpzXCJcbmltcG9ydCBCYXNlIGZyb20gXCIuLi9iYXNlLmpzXCJcbmltcG9ydCBDb2x1bW4gZnJvbSBcIi4vY29sdW1uLmpzXCJcbmltcG9ydCBDcmVhdGVEYXRhYmFzZSBmcm9tIFwiLi9zcWwvY3JlYXRlLWRhdGFiYXNlLmpzXCJcbmltcG9ydCBDcmVhdGVJbmRleCBmcm9tIFwiLi9zcWwvY3JlYXRlLWluZGV4LmpzXCJcbmltcG9ydCBDcmVhdGVUYWJsZSBmcm9tIFwiLi9zcWwvY3JlYXRlLXRhYmxlLmpzXCJcbmltcG9ydCBEZWxldGUgZnJvbSBcIi4vc3FsL2RlbGV0ZS5qc1wiXG5pbXBvcnQgRHJvcERhdGFiYXNlIGZyb20gXCIuL3NxbC9kcm9wLWRhdGFiYXNlLmpzXCJcbmltcG9ydCBEcm9wVGFibGUgZnJvbSBcIi4vc3FsL2Ryb3AtdGFibGUuanNcIlxuaW1wb3J0IHtkaWdnfSBmcm9tIFwiZGlnZ2VyaXplXCJcbmltcG9ydCBlc2NhcGVTdHJpbmcgZnJvbSBcInNxbC1lc2NhcGUtc3RyaW5nXCJcbmltcG9ydCBJbnNlcnQgZnJvbSBcIi4vc3FsL2luc2VydC5qc1wiXG5pbXBvcnQgT3B0aW9ucyBmcm9tIFwiLi9vcHRpb25zLmpzXCJcbmltcG9ydCBtc3NxbCBmcm9tIFwibXNzcWxcIlxuaW1wb3J0IG5ldCBmcm9tIFwibm9kZTpuZXRcIlxuaW1wb3J0IFF1ZXJ5UGFyc2VyIGZyb20gXCIuL3F1ZXJ5LXBhcnNlci5qc1wiXG5pbXBvcnQgUmVtb3ZlSW5kZXggZnJvbSBcIi4vc3FsL3JlbW92ZS1pbmRleC5qc1wiXG5pbXBvcnQgVGFibGUgZnJvbSBcIi4vdGFibGUuanNcIlxuaW1wb3J0IFN0cnVjdHVyZVNxbCBmcm9tIFwiLi9zdHJ1Y3R1cmUtc3FsLmpzXCJcbmltcG9ydCB0aW1lb3V0IGZyb20gXCJhd2FpdGVyeS9idWlsZC90aW1lb3V0LmpzXCJcbmltcG9ydCBVcHNlcnQgZnJvbSBcIi4vc3FsL3Vwc2VydC5qc1wiXG5pbXBvcnQgVXBkYXRlIGZyb20gXCIuL3NxbC91cGRhdGUuanNcIlxuaW1wb3J0IFVVSUQgZnJvbSBcInB1cmUtdXVpZFwiXG5cbi8qKlxuICogU1FMIFNlcnZlciBlcnJvciBudW1iZXIgcmFpc2VkIGJ5IGBzcF9yZWxlYXNlYXBwbG9ja2Agd2hlbiB0aGUgY3VycmVudFxuICogc2Vzc2lvbiBkb2VzIG5vdCBob2xkIHRoZSByZXF1ZXN0ZWQgYXBwbGljYXRpb24gbG9jay4gUmVsZWFzaW5nIGEgbG9jayB0aGVcbiAqIHNlc3Npb24gbm8gbG9uZ2VyIGhvbGRzIGlzIGEgbm9ybWFsIHJhY2UgKGEgc2hhcmVkIGNvbm5lY3Rpb24ncyBmaW5hbFxuICogY2hlY2staW4gbWF5IGFscmVhZHkgaGF2ZSBhdXRvLXJlbGVhc2VkIGl0KSwgd2hpY2ggdGhlIGNyb3NzLWRyaXZlclxuICogYHJlbGVhc2VBZHZpc29yeUxvY2tgIGNvbnRyYWN0IG1vZGVscyBieSByZXNvbHZpbmcgdG8gYGZhbHNlYC4gV2UgdHJhbnNsYXRlXG4gKiB0aGlzIHNwZWNpZmljIGVycm9yIGludG8gdGhhdCByZXN1bHQgcmF0aGVyIHRoYW4gbGV0dGluZyBpdCBlc2NhcGUuXG4gKiBAdHlwZSB7bnVtYmVyfVxuICovXG5jb25zdCBBUFBMT0NLX05PVF9IRUxEX0VSUk9SX05VTUJFUiA9IDEyMjNcbmNvbnN0IERJU0FCTEVfRk9SRUlHTl9LRVlTX1NRTCA9IFwiRVhFQyBzcF9NU2ZvcmVhY2h0YWJsZSBcXFwiQUxURVIgVEFCTEUgPyBOT0NIRUNLIENPTlNUUkFJTlQgYWxsXFxcIlwiXG5jb25zdCBFTkFCTEVfRk9SRUlHTl9LRVlTX1NRTCA9IFwiRVhFQyBzcF9NU2ZvcmVhY2h0YWJsZSBAY29tbWFuZDE9XFxcInByaW50ICc/J1xcXCIsIEBjb21tYW5kMj1cXFwiQUxURVIgVEFCTEUgPyBXSVRIIENIRUNLIENIRUNLIENPTlNUUkFJTlQgYWxsXFxcIlwiXG5cbmV4cG9ydCBkZWZhdWx0IGNsYXNzIFZlbG9jaW91c0RhdGFiYXNlRHJpdmVyc01zc3FsIGV4dGVuZHMgQmFzZXtcbiAgLyoqIEB0eXBlIHtpbXBvcnQoXCJtc3NxbFwiKS5UcmFuc2FjdGlvbiB8IG51bGx9ICovXG4gIF9hZHZpc29yeUxvY2tUcmFuc2FjdGlvbiA9IG51bGxcblxuICBhc3luYyBjb25uZWN0KCkge1xuICAgIGNvbnN0IGFyZ3MgPSB0aGlzLmdldEFyZ3MoKVxuICAgIGNvbnN0IHNxbENvbmZpZyA9IGRpZ2coYXJncywgXCJzcWxDb25maWdcIilcblxuICAgIHRyeSB7XG4gICAgICBpZiAodGhpcy5jb25uZWN0aW9uKSBhd2FpdCB0aGlzLmNsb3NlKClcblxuICAgICAgaWYgKHNxbENvbmZpZykge1xuICAgICAgICBzcWxDb25maWcub3B0aW9ucyA9IE9iamVjdC5hc3NpZ24oe30sIHNxbENvbmZpZy5vcHRpb25zLCB7dXNlVVRDOiB0cnVlfSlcbiAgICAgIH1cblxuICAgICAgaWYgKHNxbENvbmZpZz8uc2VydmVyICYmICFzcWxDb25maWcub3B0aW9ucz8uc2VydmVyTmFtZSAmJiBuZXQuaXNJUChzcWxDb25maWcuc2VydmVyKSkge1xuICAgICAgICBzcWxDb25maWcub3B0aW9ucyA9IE9iamVjdC5hc3NpZ24oe30sIHNxbENvbmZpZy5vcHRpb25zLCB7c2VydmVyTmFtZTogXCJcIn0pXG4gICAgICB9XG5cbiAgICAgIHRoaXMuY29ubmVjdGlvbiA9IG5ldyBtc3NxbC5Db25uZWN0aW9uUG9vbChzcWxDb25maWcpXG4gICAgICBhd2FpdCB0aGlzLmNvbm5lY3Rpb24uY29ubmVjdCgpXG4gICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgIC8vIFJlLXRocm93IHRvIGZpeCB1bnVzZWFibGUgc3RhY2sgdHJhY2UuXG4gICAgICB0aHJvdyBuZXcgRXJyb3IoYENvdWxkbid0IGNvbm5lY3QgdG8gZGF0YWJhc2U6ICR7ZXJyb3IgaW5zdGFuY2VvZiBFcnJvciA/IGVycm9yLm1lc3NhZ2UgOiBlcnJvcn1gLCB7Y2F1c2U6IGVycm9yfSlcbiAgICB9XG4gIH1cblxuICBhc3luYyBfY2xvc2UoKSB7XG4gICAgaWYgKCF0aGlzLmNvbm5lY3Rpb24pIHJldHVyblxuXG4gICAgY29uc3QgY29ubmVjdGlvbiA9IHRoaXMuY29ubmVjdGlvblxuICAgIHRoaXMuY29ubmVjdGlvbiA9IHVuZGVmaW5lZFxuICAgIHRoaXMuX2N1cnJlbnRUcmFuc2FjdGlvbiA9IG51bGxcbiAgICB0aGlzLl90cmFuc2FjdGlvbnNDb3VudCA9IDBcbiAgICAvKiogQHR5cGUge0Vycm9yIHwgdW5kZWZpbmVkfSAqL1xuICAgIGxldCBzZXNzaW9uRXJyb3JcblxuICAgIHRyeSB7XG4gICAgICBhd2FpdCB0aGlzLl9jbG9zZUFkdmlzb3J5TG9ja1RyYW5zYWN0aW9uKClcbiAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgc2Vzc2lvbkVycm9yID0gZXJyb3IgaW5zdGFuY2VvZiBFcnJvciA/IGVycm9yIDogbmV3IEVycm9yKFwiRmFpbGVkIHRvIGNsb3NlIE1TU1FMIGFkdmlzb3J5LWxvY2sgc2Vzc2lvblwiLCB7Y2F1c2U6IGVycm9yfSlcbiAgICB9XG5cbiAgICB0cnkge1xuICAgICAgYXdhaXQgdGltZW91dCh7dGltZW91dDogMjAwMH0sICgpID0+IGNvbm5lY3Rpb24uY2xvc2UoKSlcbiAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgdGhpcy5sb2dnZXIud2FybihcIkZhaWxlZCB0byBjbG9zZSBNU1NRTCBjb25uZWN0aW9uIGNsZWFubHlcIiwge2Vycm9yfSlcbiAgICB9XG5cbiAgICBpZiAoc2Vzc2lvbkVycm9yKSB0aHJvdyBzZXNzaW9uRXJyb3JcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGFsdGVyIHRhYmxlIHNxbHMuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vLi4vdGFibGUtZGF0YS9pbmRleC5qc1wiKS5kZWZhdWx0fSB0YWJsZURhdGEgLSBUYWJsZSBkYXRhLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxzdHJpbmdbXT59IC0gUmVzb2x2ZXMgd2l0aCBTUUwgc3RhdGVtZW50cy5cbiAgICovXG4gIGFzeW5jIGFsdGVyVGFibGVTUUxzKHRhYmxlRGF0YSkge1xuICAgIGNvbnN0IGFsdGVyQXJncyA9IHt0YWJsZURhdGEsIGRyaXZlcjogdGhpc31cbiAgICBjb25zdCBhbHRlclRhYmxlID0gbmV3IEFsdGVyVGFibGUoYWx0ZXJBcmdzKVxuXG4gICAgcmV0dXJuIGF3YWl0IGFsdGVyVGFibGUudG9TUUxzKClcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGNyZWF0ZSBkYXRhYmFzZSBzcWwuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBkYXRhYmFzZU5hbWUgLSBEYXRhYmFzZSBuYW1lLlxuICAgKiBAcGFyYW0ge29iamVjdH0gW2FyZ3NdIC0gT3B0aW9ucyBvYmplY3QuXG4gICAqIEBwYXJhbSB7Ym9vbGVhbn0gW2FyZ3MuaWZOb3RFeGlzdHNdIC0gV2hldGhlciBpZiBub3QgZXhpc3RzLlxuICAgKiBAcmV0dXJucyB7c3RyaW5nW119IC0gU1FMIHN0YXRlbWVudHMuXG4gICAqL1xuICBjcmVhdGVEYXRhYmFzZVNxbChkYXRhYmFzZU5hbWUsIGFyZ3MpIHtcbiAgICBjb25zdCBjcmVhdGVBcmdzID0gT2JqZWN0LmFzc2lnbih7ZGF0YWJhc2VOYW1lLCBkcml2ZXI6IHRoaXN9LCBhcmdzKVxuICAgIGNvbnN0IGNyZWF0ZURhdGFiYXNlID0gbmV3IENyZWF0ZURhdGFiYXNlKGNyZWF0ZUFyZ3MpXG5cbiAgICByZXR1cm4gY3JlYXRlRGF0YWJhc2UudG9TcWwoKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZHJvcCBkYXRhYmFzZSBzcWwuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBkYXRhYmFzZU5hbWUgLSBEYXRhYmFzZSBuYW1lLlxuICAgKiBAcGFyYW0ge29iamVjdH0gW2FyZ3NdIC0gT3B0aW9ucyBvYmplY3QuXG4gICAqIEBwYXJhbSB7Ym9vbGVhbn0gW2FyZ3MuaWZFeGlzdHNdIC0gV2hldGhlciBpZiBleGlzdHMuXG4gICAqIEByZXR1cm5zIHtzdHJpbmdbXX0gLSBTUUwgc3RhdGVtZW50cy5cbiAgICovXG4gIGRyb3BEYXRhYmFzZVNxbChkYXRhYmFzZU5hbWUsIGFyZ3MpIHtcbiAgICBjb25zdCBkcm9wQXJncyA9IE9iamVjdC5hc3NpZ24oe2RhdGFiYXNlTmFtZSwgZHJpdmVyOiB0aGlzfSwgYXJncylcbiAgICBjb25zdCBkcm9wRGF0YWJhc2UgPSBuZXcgRHJvcERhdGFiYXNlKGRyb3BBcmdzKVxuXG4gICAgcmV0dXJuIGRyb3BEYXRhYmFzZS50b1NxbCgpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBjcmVhdGUgaW5kZXggc3Fscy5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9iYXNlLmpzXCIpLkNyZWF0ZUluZGV4U3FsQXJnc30gaW5kZXhEYXRhIC0gSW5kZXggZGF0YS5cbiAgICogQHJldHVybnMge1Byb21pc2U8c3RyaW5nW10+fSAtIFJlc29sdmVzIHdpdGggU1FMIHN0YXRlbWVudHMuXG4gICAqL1xuICBhc3luYyBjcmVhdGVJbmRleFNRTHMoaW5kZXhEYXRhKSB7XG4gICAgY29uc3QgY3JlYXRlQXJncyA9IE9iamVjdC5hc3NpZ24oe2RyaXZlcjogdGhpc30sIGluZGV4RGF0YSlcbiAgICBjb25zdCBjcmVhdGVJbmRleCA9IG5ldyBDcmVhdGVJbmRleChjcmVhdGVBcmdzKVxuXG4gICAgcmV0dXJuIGF3YWl0IGNyZWF0ZUluZGV4LnRvU1FMcygpXG4gIH1cblxuICAvKipcbiAgICogUnVucyByZW1vdmUgaW5kZXggc3Fscy5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9iYXNlLmpzXCIpLlJlbW92ZUluZGV4U3FsQXJnc30gaW5kZXhEYXRhIC0gSW5kZXggZGF0YS5cbiAgICogQHJldHVybnMge1Byb21pc2U8c3RyaW5nW10+fSAtIFJlc29sdmVzIHdpdGggU1FMIHN0YXRlbWVudHMuXG4gICAqL1xuICBhc3luYyByZW1vdmVJbmRleFNRTHMoaW5kZXhEYXRhKSB7XG4gICAgY29uc3QgcmVtb3ZlQXJncyA9IE9iamVjdC5hc3NpZ24oe2RyaXZlcjogdGhpc30sIGluZGV4RGF0YSlcbiAgICBjb25zdCByZW1vdmVJbmRleCA9IG5ldyBSZW1vdmVJbmRleChyZW1vdmVBcmdzKVxuXG4gICAgcmV0dXJuIGF3YWl0IHJlbW92ZUluZGV4LnRvU1FMcygpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBjcmVhdGUgdGFibGUgc3FsLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uLy4uL3RhYmxlLWRhdGEvaW5kZXguanNcIikuZGVmYXVsdH0gdGFibGVEYXRhIC0gVGFibGUgZGF0YS5cbiAgICogQHJldHVybnMge1Byb21pc2U8c3RyaW5nW10+fSAtIFJlc29sdmVzIHdpdGggU1FMIHN0YXRlbWVudHMuXG4gICAqL1xuICBhc3luYyBjcmVhdGVUYWJsZVNxbCh0YWJsZURhdGEpIHtcbiAgICBjb25zdCBjcmVhdGVBcmdzID0ge3RhYmxlRGF0YSwgZHJpdmVyOiB0aGlzLCBpbmRleEluQ3JlYXRlVGFibGU6IGZhbHNlfVxuICAgIGNvbnN0IGNyZWF0ZVRhYmxlID0gbmV3IENyZWF0ZVRhYmxlKGNyZWF0ZUFyZ3MpXG5cbiAgICByZXR1cm4gYXdhaXQgY3JlYXRlVGFibGUudG9TcWwoKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgY3VycmVudCBkYXRhYmFzZS5cbiAgICogQHJldHVybnMge1Byb21pc2U8c3RyaW5nPn0gLSBSZXNvbHZlcyB3aXRoIHRoZSBjdXJyZW50IGRhdGFiYXNlLlxuICAgKi9cbiAgYXN5bmMgY3VycmVudERhdGFiYXNlKCkge1xuICAgIGNvbnN0IHJvd3MgPSBhd2FpdCB0aGlzLnF1ZXJ5KFwiU0VMRUNUIERCX05BTUUoKSBBUyBkYl9uYW1lXCIpXG5cbiAgICByZXR1cm4gZGlnZyhyb3dzLCAwLCBcImRiX25hbWVcIilcbiAgfVxuXG4gIC8qKlxuICAgKiBEaXNhYmxlcyBldmVyeSBmb3JlaWduIGtleSBjb25zdHJhaW50IChidWxrIGBOT0NIRUNLYCkuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIHdoZW4gZm9yZWlnbiBrZXlzIGFyZSBkaXNhYmxlZC5cbiAgICovXG4gIGFzeW5jIGRpc2FibGVGb3JlaWduS2V5cygpIHtcbiAgICBhd2FpdCB0aGlzLl9leGVjQ29uc3RyYWludFRvZ2dsZShESVNBQkxFX0ZPUkVJR05fS0VZU19TUUwsIFwiZGlzYWJsZUZvcmVpZ25LZXlzXCIpXG4gIH1cblxuICAvKipcbiAgICogUmUtZW5hYmxlcyBhbmQgcmUtdmFsaWRhdGVzIGV2ZXJ5IGZvcmVpZ24ga2V5IGNvbnN0cmFpbnQgKGBXSVRIIENIRUNLYCkuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIHdoZW4gZm9yZWlnbiBrZXlzIGFyZSBlbmFibGVkLlxuICAgKi9cbiAgYXN5bmMgZW5hYmxlRm9yZWlnbktleXMoKSB7XG4gICAgYXdhaXQgdGhpcy5fZXhlY0NvbnN0cmFpbnRUb2dnbGUoRU5BQkxFX0ZPUkVJR05fS0VZU19TUUwsIFwiZW5hYmxlRm9yZWlnbktleXNcIilcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGEgYnVsayBjb25zdHJhaW50LXRvZ2dsZSBzdGF0ZW1lbnQuIGBBTFRFUiBUQUJMRSAuLi4gTk9DSEVDSy9DSEVDS1xuICAgKiBDT05TVFJBSU5UYCBuZWVkcyBhIHNjaGVtYS1tb2RpZmljYXRpb24gbG9jayBvbiBldmVyeSB0YWJsZSwgc28gaWYgdGhlXG4gICAqIHJlcXVlc3QgdGltZXMgb3V0IGl0IGlzIGFsbW9zdCBhbHdheXMgYmxvY2tlZCBieSBhbm90aGVyIHNlc3Npb24gdGhhdCBpc1xuICAgKiBzdGlsbCBob2xkaW5nIGEgbG9jayAoYSBsZWFrZWQvdW5jb21taXR0ZWQgY29ubmVjdGlvbikuIE9uIGEgdGltZW91dCxcbiAgICogY2FwdHVyZSB3aGljaCBzZXNzaW9ucyB3ZXJlIGJsb2NraW5nIHNvIHRoZSByZWFsIGN1bHByaXQgaXMgbmFtZWQgaW5zdGVhZFxuICAgKiBvZiBsZWF2aW5nIGEgYmFyZSBcIlJlcXVlc3QgZmFpbGVkIHRvIGNvbXBsZXRlIGluIDE1MDAwbXNcIi5cbiAgICogQHBhcmFtIHtzdHJpbmd9IHNxbCAtIENvbnN0cmFpbnQtdG9nZ2xlIFNRTC5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGxhYmVsIC0gT3BlcmF0aW9uIGxhYmVsIGZvciB0aGUgZXJyb3IuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIHdoZW4gdGhlIHRvZ2dsZSBjb21wbGV0ZXMuXG4gICAqL1xuICBhc3luYyBfZXhlY0NvbnN0cmFpbnRUb2dnbGUoc3FsLCBsYWJlbCkge1xuICAgIHRyeSB7XG4gICAgICBhd2FpdCB0aGlzLnF1ZXJ5KHNxbClcbiAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgaWYgKGVycm9yIGluc3RhbmNlb2YgRXJyb3IgJiYgL1RpbWVvdXQ6IFJlcXVlc3QgZmFpbGVkIHRvIGNvbXBsZXRlL2kudGVzdChlcnJvci5tZXNzYWdlKSkge1xuICAgICAgICBjb25zdCBzbmFwc2hvdCA9IGF3YWl0IHRoaXMuX2NhcHR1cmVCbG9ja2luZ1Nlc3Npb25zRm9yRGVidWcoKS5jYXRjaChcbiAgICAgICAgICAoZGlhZ0Vycm9yKSA9PiBgKGJsb2NraW5nIGRpYWdub3N0aWNzIHF1ZXJ5IGZhaWxlZDogJHtkaWFnRXJyb3IgaW5zdGFuY2VvZiBFcnJvciA/IGRpYWdFcnJvci5tZXNzYWdlIDogZGlhZ0Vycm9yfSlgXG4gICAgICAgIClcblxuICAgICAgICB0aHJvdyBuZXcgRXJyb3IoYCR7ZXJyb3IubWVzc2FnZX1cXG5cXG5bJHtsYWJlbH0gYmxvY2tlZF0gb3RoZXIgdXNlciBzZXNzaW9ucyB3aXRoIG9wZW4gdHJhbnNhY3Rpb25zIG9yIGFjdGl2ZSByZXF1ZXN0czpcXG4ke3NuYXBzaG90fWAsIHtjYXVzZTogZXJyb3J9KVxuICAgICAgfVxuXG4gICAgICB0aHJvdyBlcnJvclxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBTbmFwc2hvdHMgdGhlIHNlc3Npb25zIHRoYXQgY291bGQgYmUgYmxvY2tpbmcgYSBjb25zdHJhaW50IHRvZ2dsZSBpbiBUSElTXG4gICAqIGRhdGFiYXNlIOKAlCBldmVyeSBzZXNzaW9uIG90aGVyIHRoYW4gdGhpcyBvbmUgdGhhdCBob2xkcyBhIGxvY2sgaW4gYERCX0lEKClgXG4gICAqIG9yIGlzIHJ1bm5pbmcgYSByZXF1ZXN0IGFnYWluc3QgaXQg4oCUIHdpdGggaXRzIGxhc3Qgc3RhdGVtZW50LCB3YWl0IHN0YXRlLFxuICAgKiBhbmQgYmxvY2tpbmcgc2Vzc2lvbiwgZW5vdWdoIHRvIGlkZW50aWZ5IGEgY29ubmVjdGlvbiB0aGF0IGxlYWtlZCBhIGxvY2suXG4gICAqIFNjb3BlZCB0byB0aGUgY3VycmVudCBkYXRhYmFzZSBzbyBhIG11bHRpLWRhdGFiYXNlIHNlcnZlciBkb2VzIG5vdCBsZWFrXG4gICAqIHVucmVsYXRlZCBzZXNzaW9ucycgU1FMIGludG8gdGhlIGVycm9yIGFuZCBidXJ5IHRoZSByZWFsIGJsb2NrZXIuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHN0cmluZz59IC0gSlNPTiBzbmFwc2hvdCwgb3IgYSBcIihub25lKVwiIG1hcmtlci5cbiAgICovXG4gIGFzeW5jIF9jYXB0dXJlQmxvY2tpbmdTZXNzaW9uc0ZvckRlYnVnKCkge1xuICAgIGNvbnN0IHJvd3MgPSBhd2FpdCB0aGlzLnF1ZXJ5KGBcbiAgICAgIFdJVEggbG9ja19zZXNzaW9ucyBBUyAoXG4gICAgICAgIFNFTEVDVCBESVNUSU5DVCByZXF1ZXN0X3Nlc3Npb25faWQgQVMgc2Vzc2lvbl9pZFxuICAgICAgICBGUk9NIHN5cy5kbV90cmFuX2xvY2tzXG4gICAgICAgIFdIRVJFIHJlc291cmNlX2RhdGFiYXNlX2lkID0gREJfSUQoKVxuICAgICAgKVxuICAgICAgU0VMRUNUXG4gICAgICAgIHMuc2Vzc2lvbl9pZCBBUyBzZXNzaW9uSWQsXG4gICAgICAgIHMuc3RhdHVzIEFTIHNlc3Npb25TdGF0dXMsXG4gICAgICAgIHMubG9naW5fdGltZSBBUyBsb2dpblRpbWUsXG4gICAgICAgIHMubGFzdF9yZXF1ZXN0X3N0YXJ0X3RpbWUgQVMgbGFzdFJlcXVlc3RTdGFydCxcbiAgICAgICAgcy5sYXN0X3JlcXVlc3RfZW5kX3RpbWUgQVMgbGFzdFJlcXVlc3RFbmQsXG4gICAgICAgIHMub3Blbl90cmFuc2FjdGlvbl9jb3VudCBBUyBvcGVuVHJhbnNhY3Rpb25Db3VudCxcbiAgICAgICAgci5zdGF0dXMgQVMgcmVxdWVzdFN0YXR1cyxcbiAgICAgICAgci5jb21tYW5kIEFTIGNvbW1hbmQsXG4gICAgICAgIHIud2FpdF90eXBlIEFTIHdhaXRUeXBlLFxuICAgICAgICByLndhaXRfdGltZSBBUyB3YWl0VGltZU1zLFxuICAgICAgICByLmJsb2NraW5nX3Nlc3Npb25faWQgQVMgYmxvY2tpbmdTZXNzaW9uSWQsXG4gICAgICAgIENBU1QoaWIuZXZlbnRfaW5mbyBBUyBOVkFSQ0hBUihNQVgpKSBBUyBsYXN0U3FsXG4gICAgICBGUk9NIHN5cy5kbV9leGVjX3Nlc3Npb25zIHNcbiAgICAgIExFRlQgSk9JTiBzeXMuZG1fZXhlY19yZXF1ZXN0cyByIE9OIHIuc2Vzc2lvbl9pZCA9IHMuc2Vzc2lvbl9pZFxuICAgICAgT1VURVIgQVBQTFkgc3lzLmRtX2V4ZWNfaW5wdXRfYnVmZmVyKHMuc2Vzc2lvbl9pZCwgTlVMTCkgaWJcbiAgICAgIFdIRVJFIHMuaXNfdXNlcl9wcm9jZXNzID0gMVxuICAgICAgICBBTkQgcy5zZXNzaW9uX2lkIDw+IEBAU1BJRFxuICAgICAgICBBTkQgKHMuc2Vzc2lvbl9pZCBJTiAoU0VMRUNUIHNlc3Npb25faWQgRlJPTSBsb2NrX3Nlc3Npb25zKSBPUiByLmRhdGFiYXNlX2lkID0gREJfSUQoKSlcbiAgICBgKVxuXG4gICAgaWYgKHJvd3MubGVuZ3RoID09PSAwKSByZXR1cm4gXCIobm9uZSDigJQgbm8gb3RoZXIgc2Vzc2lvbiBoZWxkIGEgbG9jayBvciByYW4gYSByZXF1ZXN0IGluIHRoaXMgZGF0YWJhc2Ugd2hlbiBxdWVyaWVkKVwiXG5cbiAgICByZXR1cm4gSlNPTi5zdHJpbmdpZnkocm93cywgbnVsbCwgMilcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGRyb3AgdGFibGUgc3Fscy5cbiAgICogQHBhcmFtIHtzdHJpbmd9IHRhYmxlTmFtZSAtIFRhYmxlIG5hbWUuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vYmFzZS5qc1wiKS5Ecm9wVGFibGVTcWxBcmdzVHlwZX0gW2FyZ3NdIC0gT3B0aW9ucyBvYmplY3QuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHN0cmluZ1tdPn0gLSBSZXNvbHZlcyB3aXRoIFNRTCBzdGF0ZW1lbnRzLlxuICAgKi9cbiAgYXN5bmMgZHJvcFRhYmxlU1FMcyh0YWJsZU5hbWUsIGFyZ3MgPSB7fSkge1xuICAgIGNvbnN0IGRyb3BBcmdzID0gT2JqZWN0LmFzc2lnbih7dGFibGVOYW1lLCBkcml2ZXI6IHRoaXN9LCBhcmdzKVxuICAgIGNvbnN0IGRyb3BUYWJsZSA9IG5ldyBEcm9wVGFibGUoZHJvcEFyZ3MpXG5cbiAgICByZXR1cm4gYXdhaXQgZHJvcFRhYmxlLnRvU1FMcygpXG4gIH1cblxuICAvKipcbiAgICogRHJvcHMgdGhlIGZvcmVpZ24ga2V5IGNvbnN0cmFpbnRzIHRoYXQgcmVmZXJlbmNlIHRoZSBnaXZlbiB0YWJsZS4gTVNTUUxcbiAgICogcmVmdXNlcyB0byBkcm9wIGEgdGFibGUgdGhhdCBpcyBzdGlsbCByZWZlcmVuY2VkIGJ5IGEgRk9SRUlHTiBLRVlcbiAgICogY29uc3RyYWludCBldmVuIHdoZW4gY29uc3RyYWludHMgYXJlIGRpc2FibGVkIHZpYSBOT0NIRUNLLCBzbyB0aGVcbiAgICogcmVmZXJlbmNpbmcgY29uc3RyYWludHMgbXVzdCBiZSByZW1vdmVkIGJlZm9yZSB0aGUgdGFibGUgY2FuIGJlIGRyb3BwZWQuXG4gICAqIFRoaXMgbGV0cyBjYWxsZXJzIGRyb3AgdGFibGVzIGluIGFueSBvcmRlciAoZS5nLiB3aXBpbmcgYSB3aG9sZSBzY2hlbWEpXG4gICAqIHdpdGhvdXQgZmlyc3QgZHJvcHBpbmcgZXZlcnkgZGVwZW5kZW50IHRhYmxlLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gdGFibGVOYW1lIC0gVGFibGUgbmFtZS5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgd2hlbiBjb21wbGV0ZS5cbiAgICovXG4gIGFzeW5jIF9kcm9wUmVmZXJlbmNpbmdGb3JlaWduS2V5cyh0YWJsZU5hbWUpIHtcbiAgICBjb25zdCByb3dzID0gYXdhaXQgdGhpcy5xdWVyeShcbiAgICAgIFwiU0VMRUNUIGZrLm5hbWUgQVMgY29uc3RyYWludF9uYW1lLCBPQkpFQ1RfTkFNRShmay5wYXJlbnRfb2JqZWN0X2lkKSBBUyBwYXJlbnRfdGFibGUgXCIgK1xuICAgICAgYEZST00gc3lzLmZvcmVpZ25fa2V5cyBmayBXSEVSRSBmay5yZWZlcmVuY2VkX29iamVjdF9pZCA9IE9CSkVDVF9JRCgke3RoaXMucXVvdGUodGFibGVOYW1lKX0pYFxuICAgIClcblxuICAgIGZvciAoY29uc3Qgcm93IG9mIHJvd3MpIHtcbiAgICAgIGNvbnN0IGNvbnN0cmFpbnROYW1lID0gcm93LmNvbnN0cmFpbnRfbmFtZSA/PyByb3cuQ09OU1RSQUlOVF9OQU1FXG4gICAgICBjb25zdCBwYXJlbnRUYWJsZSA9IHJvdy5wYXJlbnRfdGFibGUgPz8gcm93LlBBUkVOVF9UQUJMRVxuXG4gICAgICBhd2FpdCB0aGlzLnF1ZXJ5KGBBTFRFUiBUQUJMRSBbJHtwYXJlbnRUYWJsZX1dIERST1AgQ09OU1RSQUlOVCBbJHtjb25zdHJhaW50TmFtZX1dYClcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogUnVucyBkcm9wIHRhYmxlLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gdGFibGVOYW1lIC0gVGFibGUgbmFtZS5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9iYXNlLmpzXCIpLkRyb3BUYWJsZVNxbEFyZ3NUeXBlfSBbYXJnc10gLSBPcHRpb25zIG9iamVjdC5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgd2hlbiBjb21wbGV0ZS5cbiAgICovXG4gIGFzeW5jIGRyb3BUYWJsZSh0YWJsZU5hbWUsIGFyZ3MgPSB7fSkge1xuICAgIHRoaXMuX2Fzc2VydE5vdFJlYWRPbmx5KClcbiAgICBhd2FpdCB0aGlzLl9kcm9wUmVmZXJlbmNpbmdGb3JlaWduS2V5cyh0YWJsZU5hbWUpXG5cbiAgICBjb25zdCBzcWxzID0gYXdhaXQgdGhpcy5kcm9wVGFibGVTUUxzKHRhYmxlTmFtZSwgYXJncylcblxuICAgIGZvciAoY29uc3Qgc3FsIG9mIHNxbHMpIHtcbiAgICAgIGF3YWl0IHRoaXMucXVlcnkoc3FsKVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGdldCB0eXBlLlxuICAgKiBAcmV0dXJucyB7c3RyaW5nfSAtIFRoZSB0eXBlLlxuICAgKi9cbiAgZ2V0VHlwZSgpIHsgcmV0dXJuIFwibXNzcWxcIiB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgcXVlcnkgYWN0dWFsLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gc3FsIC0gU1FMIHN0cmluZy5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9iYXNlLmpzXCIpLlF1ZXJ5T3B0aW9uc30gW29wdGlvbnNdIC0gUXVlcnkgb3B0aW9ucy5cbiAgICogQHJldHVybnMge1Byb21pc2U8aW1wb3J0KFwiLi4vYmFzZS5qc1wiKS5RdWVyeVJlc3VsdFR5cGU+fSAtIFJlc29sdmVzIHdpdGggdGhlIHF1ZXJ5IGFjdHVhbC5cbiAgICovXG4gIGFzeW5jIF9xdWVyeUFjdHVhbChzcWwsIG9wdGlvbnMgPSB7fSkge1xuICAgIGxldCByZXN1bHRcbiAgICBsZXQgdHJpZXMgPSAwXG5cbiAgICB3aGlsZSAodHJ1ZSkge1xuICAgICAgdHJpZXMrK1xuXG4gICAgICB0cnkge1xuICAgICAgICBjb25zdCByZXF1ZXN0T3B0aW9ucyA9IG9wdGlvbnMucmVxdWVzdFRpbWVvdXRNcyA9PT0gdW5kZWZpbmVkXG4gICAgICAgICAgPyB1bmRlZmluZWRcbiAgICAgICAgICA6IHtyZXF1ZXN0VGltZW91dDogb3B0aW9ucy5yZXF1ZXN0VGltZW91dE1zfVxuICAgICAgICAvLyBub2RlLW1zc3FsIHN1cHBvcnRzIHJlcXVlc3QtbG9jYWwgb3ZlcnJpZGVzLCBidXQgaXRzIERlZmluaXRlbHlUeXBlZFxuICAgICAgICAvLyBjb25zdHJ1Y3RvciBkZWNsYXJhdGlvbiBzdGlsbCBleHBvc2VzIG9ubHkgdGhlIGxlZ2FjeSBmaXJzdCBhcmd1bWVudC5cbiAgICAgICAgY29uc3QgcmVxdWVzdCA9IHJlcXVlc3RPcHRpb25zXG4gICAgICAgICAgPyBSZWZsZWN0LmNvbnN0cnVjdChtc3NxbC5SZXF1ZXN0LCBbdGhpcy5fY3VycmVudFRyYW5zYWN0aW9uIHx8IHRoaXMuY29ubmVjdGlvbiwgcmVxdWVzdE9wdGlvbnNdKVxuICAgICAgICAgIDogdGhpcy5fY3VycmVudFRyYW5zYWN0aW9uXG4gICAgICAgICAgICA/IG5ldyBtc3NxbC5SZXF1ZXN0KHRoaXMuX2N1cnJlbnRUcmFuc2FjdGlvbilcbiAgICAgICAgICAgIDogbmV3IG1zc3FsLlJlcXVlc3QodGhpcy5jb25uZWN0aW9uKVxuICAgICAgICByZXN1bHQgPSBhd2FpdCByZXF1ZXN0LnF1ZXJ5KHNxbClcbiAgICAgICAgYnJlYWtcbiAgICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICAgIGlmIChlcnJvciBpbnN0YW5jZW9mIEVycm9yICYmIGVycm9yLm1lc3NhZ2UgPT0gXCJObyBjb25uZWN0aW9uIGlzIHNwZWNpZmllZCBmb3IgdGhhdCByZXF1ZXN0LlwiICYmIHRyaWVzIDw9IDMpIHtcbiAgICAgICAgICB0aGlzLmxvZ2dlci53YXJuKFwiUmVjb25uZWN0aW5nIHRvIGRhdGFiYXNlXCIpXG4gICAgICAgICAgYXdhaXQgdGhpcy5yZWNvbm5lY3QoKVxuICAgICAgICAgIC8vIFJldHJ5XG4gICAgICAgIH0gZWxzZSBpZiAoZXJyb3IgaW5zdGFuY2VvZiBFcnJvcikge1xuICAgICAgICAgIC8vIFJlLXRocm93IGVycm9yIGJlY2F1c2UgdGhlIHN0YWNrLXRyYWNlIGlzIGJyb2tlbiBhbmQgY2FuJ3QgYmUgdXNlZCBmb3IgYXBwLWRldmVsb3BtZW50LlxuICAgICAgICAgIHRocm93IG5ldyBFcnJvcihgUXVlcnkgZmFpbGVkICcke2Vycm9yLm1lc3NhZ2V9JzogJHtzcWx9YCwge2NhdXNlOiBlcnJvcn0pXG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgdGhyb3cgbmV3IEVycm9yKGBRdWVyeSBmYWlsZWQgJyR7ZXJyb3J9JzogJHtzcWx9YCwge2NhdXNlOiBlcnJvcn0pXG4gICAgICAgIH1cbiAgICAgIH1cbiAgICB9XG5cbiAgICByZXR1cm4gQXJyYXkuaXNBcnJheShyZXN1bHQucmVjb3Jkc2V0cykgPyByZXN1bHQucmVjb3Jkc2V0c1swXSB8fCBbXSA6IFtdXG4gIH1cblxuICAvKipcbiAgICogRXhlY3V0ZXMgYSBtdXRhdGlvbiB3aXRoIGFmZmVjdGVkLXJvdyBtZXRhZGF0YS5cbiAgICogQHBhcmFtIHtzdHJpbmd9IHNxbCAtIE11dGF0aW9uIFNRTC5cbiAgICogQHJldHVybnMge1Byb21pc2U8bnVtYmVyPn0gLSBBZmZlY3RlZCByb3cgY291bnQuXG4gICAqL1xuICBhc3luYyBfYWZmZWN0ZWRSb3dzQWN0dWFsKHNxbCkge1xuICAgIGNvbnN0IHJlcXVlc3QgPSB0aGlzLl9jdXJyZW50VHJhbnNhY3Rpb25cbiAgICAgID8gbmV3IG1zc3FsLlJlcXVlc3QodGhpcy5fY3VycmVudFRyYW5zYWN0aW9uKVxuICAgICAgOiBuZXcgbXNzcWwuUmVxdWVzdCh0aGlzLmNvbm5lY3Rpb24pXG4gICAgY29uc3QgcmVzdWx0ID0gYXdhaXQgcmVxdWVzdC5xdWVyeShzcWwpXG4gICAgcmV0dXJuIHJlc3VsdC5yb3dzQWZmZWN0ZWQucmVkdWNlKCh0b3RhbCwgY291bnQpID0+IHRvdGFsICsgY291bnQsIDApXG4gIH1cblxuICAvKipcbiAgICogUnVucyBxdWVyeSB0byBzcWwuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vLi4vcXVlcnkvaW5kZXguanNcIikuZGVmYXVsdH0gcXVlcnkgLSBRdWVyeSBpbnN0YW5jZS5cbiAgICogQHJldHVybnMge3N0cmluZ30gLSBTUUwgc3RyaW5nLlxuICAgKi9cbiAgcXVlcnlUb1NxbChxdWVyeSkgeyByZXR1cm4gbmV3IFF1ZXJ5UGFyc2VyKHtxdWVyeX0pLnRvU3FsKCkgfVxuXG4gIHNob3VsZFNldEF1dG9JbmNyZW1lbnRXaGVuUHJpbWFyeUtleSgpIHsgcmV0dXJuIHRydWUgfVxuICBzdXBwb3J0c0RlZmF1bHRQcmltYXJ5S2V5VVVJRCgpIHsgcmV0dXJuIHRydWUgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGFuIGV4cGxpY2l0IHByaW1hcnkta2V5IGluc2VydCBhcyBvbmUgYmF0Y2ggcmVxdWVzdDogU1FMIFNlcnZlciBzY29wZXNcbiAgICogSURFTlRJVFlfSU5TRVJUIHRvIHRoZSBzZXNzaW9uLCBhbmQgbm9kZS1tc3NxbCBwb29sLWJhY2tlZCByZXF1ZXN0cyBtYXkgdXNlXG4gICAqIGEgZGlmZmVyZW50IHBoeXNpY2FsIHNlc3Npb24gcGVyIHF1ZXJ5LCBzbyBlbmFibGluZyBpdCBpbiBhIHNlcGFyYXRlIHF1ZXJ5XG4gICAqIGNhbiBsZWF2ZSB0aGUgYWN0dWFsIElOU0VSVCBvbiBhbm90aGVyIHNlc3Npb24uIEEgc2luZ2xlIGJhdGNoIGtlZXBzIHRoZVxuICAgKiB3aG9sZSBzZXF1ZW5jZSBvbiBvbmUgc2Vzc2lvbiBieSBjb25zdHJ1Y3Rpb246IGVuYWJsZSwgaW5zZXJ0LCBkaXNhYmxlIG9uXG4gICAqIHN1Y2Nlc3MsIGFuZCBhIENBVENIIHRoYXQgZGlzYWJsZXMgYW5kIHJldGhyb3dzIHRoZSBvcmlnaW5hbCBlcnJvci5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBPcHRpb25zIG9iamVjdC5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9iYXNlLmpzXCIpLlF1ZXJ5T3B0aW9uc30gYXJncy5vcHRpb25zIC0gUXVlcnkgb3B0aW9ucyBmb3IgdGhlIHN0YW5kYXJkIHF1ZXJ5IHBhdGguXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBhcmdzLnNxbCAtIEdlbmVyYXRlZCBpbnNlcnQgU1FMLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gYXJncy50YWJsZU5hbWUgLSBUYWJsZSBiZWluZyBpbnNlcnRlZCBpbnRvLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxpbXBvcnQoXCIuLi9iYXNlLmpzXCIpLlF1ZXJ5UmVzdWx0VHlwZT59IC0gSW5zZXJ0IHJlc3VsdC5cbiAgICovXG4gIGFzeW5jIGluc2VydFdpdGhFeHBsaWNpdFByaW1hcnlLZXkoe29wdGlvbnMsIHNxbCwgdGFibGVOYW1lfSkge1xuICAgIGNvbnN0IHF1b3RlZFRhYmxlID0gdGhpcy5xdW90ZVRhYmxlKHRhYmxlTmFtZSlcbiAgICBjb25zdCBiYXRjaCA9IFtcbiAgICAgIGBTRVQgSURFTlRJVFlfSU5TRVJUICR7cXVvdGVkVGFibGV9IE9OO2AsXG4gICAgICBcIkJFR0lOIFRSWVwiLFxuICAgICAgYCR7c3FsfTtgLFxuICAgICAgYFNFVCBJREVOVElUWV9JTlNFUlQgJHtxdW90ZWRUYWJsZX0gT0ZGO2AsXG4gICAgICBcIkVORCBUUllcIixcbiAgICAgIFwiQkVHSU4gQ0FUQ0hcIixcbiAgICAgIGBTRVQgSURFTlRJVFlfSU5TRVJUICR7cXVvdGVkVGFibGV9IE9GRjtgLFxuICAgICAgXCJUSFJPVztcIixcbiAgICAgIFwiRU5EIENBVENIXCJcbiAgICBdLmpvaW4oXCJcXG5cIilcblxuICAgIHJldHVybiBhd2FpdCB0aGlzLnF1ZXJ5KGJhdGNoLCBvcHRpb25zKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZXNjYXBlLlxuICAgKiBAcGFyYW0ge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSB2YWx1ZSAtIFZhbHVlIHRvIHVzZS5cbiAgICogQHJldHVybnMge3N0cmluZ30gLSBUaGUgZXNjYXBlLlxuICAgKi9cbiAgZXNjYXBlKHZhbHVlKSB7XG4gICAgdmFsdWUgPSB0aGlzLl9jb252ZXJ0VmFsdWUodmFsdWUpXG4gICAgY29uc3Qgc3RyaW5nVmFsdWUgPSB0eXBlb2YgdmFsdWUgPT0gXCJzdHJpbmdcIiA/IHZhbHVlIDogYCR7dmFsdWV9YFxuXG4gICAgY29uc3QgcmVzdWx0V2l0aFF1b3RlcyA9IGVzY2FwZVN0cmluZyhzdHJpbmdWYWx1ZSwgbnVsbClcbiAgICBjb25zdCByZXN1bHQgPSByZXN1bHRXaXRoUXVvdGVzLnN1YnN0cmluZygxLCByZXN1bHRXaXRoUXVvdGVzLmxlbmd0aCAtIDEpXG5cbiAgICByZXR1cm4gcmVzdWx0XG4gIH1cblxuICAvKipcbiAgICogUnVucyBxdW90ZS5cbiAgICogQHBhcmFtIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gdmFsdWUgLSBWYWx1ZSB0byB1c2UuXG4gICAqIEByZXR1cm5zIHtzdHJpbmcgfCBudW1iZXJ9IC0gVGhlIHF1b3RlZCB2YWx1ZS5cbiAgICovXG4gIHF1b3RlKHZhbHVlKSB7XG4gICAgdmFsdWUgPSB0aGlzLl9jb252ZXJ0VmFsdWUodmFsdWUpXG5cbiAgICBpZiAodHlwZW9mIHZhbHVlID09IFwibnVtYmVyXCIpIHJldHVybiB2YWx1ZVxuICAgIGNvbnN0IHN0cmluZ1ZhbHVlID0gdHlwZW9mIHZhbHVlID09IFwic3RyaW5nXCIgPyB2YWx1ZSA6IFN0cmluZyh2YWx1ZSlcblxuICAgIHJldHVybiBgTiR7ZXNjYXBlU3RyaW5nKHN0cmluZ1ZhbHVlLCBudWxsKX1gXG4gIH1cblxuICAvKipcbiAgICogUnVucyBxdW90ZSBjb2x1bW4uXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBjb2x1bW5OYW1lIC0gQ29sdW1uIG5hbWUuXG4gICAqIEByZXR1cm5zIHtzdHJpbmd9IC0gVGhlIHF1b3RlIGNvbHVtbi5cbiAgICovXG4gIHF1b3RlQ29sdW1uKGNvbHVtbk5hbWUpIHsgcmV0dXJuIHRoaXMub3B0aW9ucygpLnF1b3RlQ29sdW1uTmFtZShjb2x1bW5OYW1lKSB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgcXVvdGUgdGFibGUuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBzdHJpbmcgLSBTdHJpbmcuXG4gICAqIEByZXR1cm5zIHtzdHJpbmd9IC0gVGhlIHF1b3RlIHRhYmxlLlxuICAgKi9cbiAgcXVvdGVUYWJsZShzdHJpbmcpIHsgcmV0dXJuIHRoaXMub3B0aW9ucygpLnF1b3RlVGFibGVOYW1lKHN0cmluZykgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHJlbmFtZSBjb2x1bW4uXG4gICAqIEBwYXJhbSB7c3RyaW5nfSB0YWJsZU5hbWUgLSBUYWJsZSBuYW1lLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gb2xkQ29sdW1uTmFtZSAtIFByZXZpb3VzIGNvbHVtbiBuYW1lLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gbmV3Q29sdW1uTmFtZSAtIE5ldyBjb2x1bW4gbmFtZS5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgd2hlbiBjb21wbGV0ZS5cbiAgICovXG4gIGFzeW5jIHJlbmFtZUNvbHVtbih0YWJsZU5hbWUsIG9sZENvbHVtbk5hbWUsIG5ld0NvbHVtbk5hbWUpIHtcbiAgICBhd2FpdCB0aGlzLnF1ZXJ5KGBFWEVDIHNwX3JlbmFtZSAke3RoaXMucXVvdGUoYCR7dGFibGVOYW1lfS4ke29sZENvbHVtbk5hbWV9YCl9LCAke3RoaXMucXVvdGUobmV3Q29sdW1uTmFtZSl9LCAnQ09MVU1OJ2ApXG4gIH1cblxuICAvKipcbiAgICogUnVucyBkZWxldGUgc3FsLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL2Jhc2UuanNcIikuRGVsZXRlU3FsQXJnc1R5cGV9IGFyZ3MgLSBPcHRpb25zIG9iamVjdC5cbiAgICogQHJldHVybnMge3N0cmluZ30gLSBTUUwgc3RyaW5nLlxuICAgKi9cbiAgZGVsZXRlU3FsKHt0YWJsZU5hbWUsIGNvbmRpdGlvbnN9KSB7XG4gICAgY29uc3QgZGVsZXRlSW5zdHJ1Y3Rpb24gPSBuZXcgRGVsZXRlKHtjb25kaXRpb25zLCBkcml2ZXI6IHRoaXMsIHRhYmxlTmFtZX0pXG5cbiAgICByZXR1cm4gZGVsZXRlSW5zdHJ1Y3Rpb24udG9TcWwoKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgaW5zZXJ0IHNxbC5cbiAgICogQGFic3RyYWN0XG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vYmFzZS5qc1wiKS5JbnNlcnRTcWxBcmdzVHlwZX0gYXJncyAtIE9wdGlvbnMgb2JqZWN0LlxuICAgKiBAcmV0dXJucyB7c3RyaW5nfSAtIFNRTCBzdHJpbmcuXG4gICAqL1xuICBpbnNlcnRTcWwoYXJncykge1xuICAgIGNvbnN0IGluc2VydEFyZ3MgPSBPYmplY3QuYXNzaWduKHtkcml2ZXI6IHRoaXN9LCBhcmdzKVxuICAgIGNvbnN0IGluc2VydCA9IG5ldyBJbnNlcnQoaW5zZXJ0QXJncylcblxuICAgIHJldHVybiBpbnNlcnQudG9TcWwoKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZ2V0IHRhYmxlcy5cbiAgICogQHJldHVybnMge1Byb21pc2U8QXJyYXk8aW1wb3J0KFwiLi4vYmFzZS10YWJsZS5qc1wiKS5kZWZhdWx0Pj59IC0gUmVzb2x2ZXMgd2l0aCB0aGUgdGFibGVzLlxuICAgKi9cbiAgYXN5bmMgZ2V0VGFibGVzKCkge1xuICAgIHJldHVybiBhd2FpdCB0aGlzLl9jYWNoZWRTY2hlbWFNZXRhZGF0YShcInRhYmxlc1wiLCBhc3luYyAoKSA9PiB7XG4gICAgICBjb25zdCBzY2hlbWEgPSB0aGlzLmdldEFyZ3MoKT8uc2NoZW1hIHx8IHRoaXMuZ2V0QXJncygpPy5zcWxDb25maWc/Lm9wdGlvbnM/LnNjaGVtYVxuICAgICAgY29uc3Qgc2NoZW1hQ2xhdXNlID0gc2NoZW1hXG4gICAgICAgID8gYCBBTkQgW1RBQkxFX1NDSEVNQV0gPSAke3RoaXMucXVvdGUoc2NoZW1hKX1gXG4gICAgICAgIDogXCIgQU5EIFtUQUJMRV9TQ0hFTUFdID0gU0NIRU1BX05BTUUoKVwiXG4gICAgICBjb25zdCByZXN1bHQgPSBhd2FpdCB0aGlzLnF1ZXJ5KGBTRUxFQ1QgW1RBQkxFX05BTUVdIEZST00gW0lORk9STUFUSU9OX1NDSEVNQV0uW1RBQkxFU10gV0hFUkUgW1RBQkxFX0NBVEFMT0ddID0gREJfTkFNRSgpJHtzY2hlbWFDbGF1c2V9YClcbiAgICAgIGNvbnN0IHRhYmxlcyA9IFtdXG5cbiAgICAgIGZvciAoY29uc3Qgcm93IG9mIHJlc3VsdCkge1xuICAgICAgICBjb25zdCB0YWJsZSA9IG5ldyBUYWJsZSh0aGlzLCAvKiogQHR5cGUge1JlY29yZDxzdHJpbmcsIHN0cmluZz59ICovIChyb3cpKVxuXG4gICAgICAgIHRhYmxlcy5wdXNoKHRhYmxlKVxuICAgICAgfVxuXG4gICAgICByZXR1cm4gdGFibGVzXG4gICAgfSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSZWFkcyBjb2x1bW4gbWV0YWRhdGEgZm9yIG1hbnkgdGFibGVzIGluIG9uZSBxdWVyeS4gVGhlIHBlci10YWJsZSByZWFkIG9mIHRoZVxuICAgKiBzYW1lIHRocmVlLXdheSBgSU5GT1JNQVRJT05fU0NIRU1BYCBqb2luIGlzIG9uZSBvZiB0aGUgc2xvd2VzdCB0aGluZ3MgYSBib290XG4gICAqIGRvZXMgYWdhaW5zdCB0aGUgbGVnYWN5IFNRTCBTZXJ2ZXIsIHNvIGl0IGlzIHdvcnRoIGNvbWJpbmluZyByZWdhcmRsZXNzIG9mIHRoZVxuICAgKiBudW1iZXIgb2YgdGFibGVzLlxuICAgKiBAcGFyYW0ge0FycmF5PGltcG9ydChcIi4uL2Jhc2UtdGFibGUuanNcIikuZGVmYXVsdD59IHRhYmxlcyAtIFRhYmxlcyB0byBsb2FkIGNvbHVtbnMgZm9yLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxNYXA8c3RyaW5nLCBBcnJheTxpbXBvcnQoXCIuLi9iYXNlLWNvbHVtbi5qc1wiKS5kZWZhdWx0Pj4+fSAtIENvbHVtbnMga2V5ZWQgYnkgdGFibGUgbmFtZS5cbiAgICovXG4gIGFzeW5jIGJhdGNoVGFibGVDb2x1bW5zKHRhYmxlcykge1xuICAgIC8qKiBAdHlwZSB7TWFwPHN0cmluZywgQXJyYXk8aW1wb3J0KFwiLi4vYmFzZS1jb2x1bW4uanNcIikuZGVmYXVsdD4+fSAqL1xuICAgIGNvbnN0IGNvbHVtbnNCeVRhYmxlID0gbmV3IE1hcCgpXG5cbiAgICBpZiAodGFibGVzLmxlbmd0aCA9PT0gMCkgcmV0dXJuIGNvbHVtbnNCeVRhYmxlXG5cbiAgICBjb25zdCBzY2hlbWEgPSB0aGlzLmdldEFyZ3MoKT8uc2NoZW1hIHx8IHRoaXMuZ2V0QXJncygpPy5zcWxDb25maWc/Lm9wdGlvbnM/LnNjaGVtYVxuICAgIGNvbnN0IHNjaGVtYUNsYXVzZSA9IHNjaGVtYVxuICAgICAgPyBgIEFORCBjb2x1bW5zLltUQUJMRV9TQ0hFTUFdID0gJHt0aGlzLnF1b3RlKHNjaGVtYSl9YFxuICAgICAgOiBcIiBBTkQgY29sdW1ucy5bVEFCTEVfU0NIRU1BXSA9IFNDSEVNQV9OQU1FKClcIlxuICAgIGNvbnN0IHRhYmxlc0J5TmFtZSA9IG5ldyBNYXAodGFibGVzLm1hcCgodGFibGUpID0+IFt0YWJsZS5nZXROYW1lKCksIHRhYmxlXSkpXG4gICAgY29uc3QgdGFibGVOYW1lc1NxbCA9IFsuLi50YWJsZXNCeU5hbWUua2V5cygpXS5tYXAoKHRhYmxlTmFtZSkgPT4gdGhpcy5xdW90ZSh0YWJsZU5hbWUpKS5qb2luKFwiLCBcIilcbiAgICBjb25zdCByb3dzID0gYXdhaXQgdGhpcy5xdWVyeShgXG4gICAgICBTRUxFQ1RcbiAgICAgICAgY29sdW1ucy4qLFxuICAgICAgICBDT0xVTU5QUk9QRVJUWShvYmplY3RfaWQoY29sdW1ucy5UQUJMRV9TQ0hFTUEgKyAnLicgKyBjb2x1bW5zLlRBQkxFX05BTUUpLCBjb2x1bW5zLkNPTFVNTl9OQU1FLCAnSXNJZGVudGl0eScpIEFTIGlzSWRlbnRpdHksXG4gICAgICAgIENBU0UgV0hFTiBrZXlDb2x1bW5Vc2FnZS5DT0xVTU5fTkFNRSBJUyBOT1QgTlVMTCBUSEVOIDEgRUxTRSAwIEVORCBBUyBpc1ByaW1hcnlLZXlcbiAgICAgIEZST00gW0lORk9STUFUSU9OX1NDSEVNQV0uW0NPTFVNTlNdIEFTIGNvbHVtbnNcbiAgICAgIExFRlQgSk9JTiBbSU5GT1JNQVRJT05fU0NIRU1BXS5bVEFCTEVfQ09OU1RSQUlOVFNdIEFTIHRhYmxlQ29uc3RyYWludHMgT05cbiAgICAgICAgdGFibGVDb25zdHJhaW50cy5DT05TVFJBSU5UX1RZUEUgPSAnUFJJTUFSWSBLRVknIEFORFxuICAgICAgICB0YWJsZUNvbnN0cmFpbnRzLlRBQkxFX0NBVEFMT0cgPSBjb2x1bW5zLlRBQkxFX0NBVEFMT0cgQU5EXG4gICAgICAgIHRhYmxlQ29uc3RyYWludHMuVEFCTEVfU0NIRU1BID0gY29sdW1ucy5UQUJMRV9TQ0hFTUEgQU5EXG4gICAgICAgIHRhYmxlQ29uc3RyYWludHMuVEFCTEVfTkFNRSA9IGNvbHVtbnMuVEFCTEVfTkFNRVxuICAgICAgTEVGVCBKT0lOIFtJTkZPUk1BVElPTl9TQ0hFTUFdLltLRVlfQ09MVU1OX1VTQUdFXSBBUyBrZXlDb2x1bW5Vc2FnZSBPTlxuICAgICAgICBrZXlDb2x1bW5Vc2FnZS5DT05TVFJBSU5UX0NBVEFMT0cgPSB0YWJsZUNvbnN0cmFpbnRzLkNPTlNUUkFJTlRfQ0FUQUxPRyBBTkRcbiAgICAgICAga2V5Q29sdW1uVXNhZ2UuQ09OU1RSQUlOVF9TQ0hFTUEgPSB0YWJsZUNvbnN0cmFpbnRzLkNPTlNUUkFJTlRfU0NIRU1BIEFORFxuICAgICAgICBrZXlDb2x1bW5Vc2FnZS5DT05TVFJBSU5UX05BTUUgPSB0YWJsZUNvbnN0cmFpbnRzLkNPTlNUUkFJTlRfTkFNRSBBTkRcbiAgICAgICAga2V5Q29sdW1uVXNhZ2UuVEFCTEVfQ0FUQUxPRyA9IGNvbHVtbnMuVEFCTEVfQ0FUQUxPRyBBTkRcbiAgICAgICAga2V5Q29sdW1uVXNhZ2UuVEFCTEVfU0NIRU1BID0gY29sdW1ucy5UQUJMRV9TQ0hFTUEgQU5EXG4gICAgICAgIGtleUNvbHVtblVzYWdlLlRBQkxFX05BTUUgPSBjb2x1bW5zLlRBQkxFX05BTUUgQU5EXG4gICAgICAgIGtleUNvbHVtblVzYWdlLkNPTFVNTl9OQU1FID0gY29sdW1ucy5DT0xVTU5fTkFNRVxuICAgICAgV0hFUkUgY29sdW1ucy5UQUJMRV9OQU1FIElOICgke3RhYmxlTmFtZXNTcWx9KSR7c2NoZW1hQ2xhdXNlfVxuICAgICAgT1JERVIgQlkgY29sdW1ucy5UQUJMRV9OQU1FLCBjb2x1bW5zLk9SRElOQUxfUE9TSVRJT05cbiAgICBgKVxuXG4gICAgZm9yIChjb25zdCByb3cgb2Ygcm93cykge1xuICAgICAgY29uc3QgdGFibGVOYW1lID0gLyoqIEB0eXBlIHtzdHJpbmd9ICovIChyb3cuVEFCTEVfTkFNRSlcbiAgICAgIGNvbnN0IHRhYmxlID0gdGFibGVzQnlOYW1lLmdldCh0YWJsZU5hbWUpXG5cbiAgICAgIGlmICghdGFibGUpIGNvbnRpbnVlXG5cbiAgICAgIGNvbnN0IGNvbHVtbnMgPSBjb2x1bW5zQnlUYWJsZS5nZXQodGFibGVOYW1lKSB8fCBbXVxuXG4gICAgICBjb2x1bW5zLnB1c2gobmV3IENvbHVtbih0YWJsZSwgLyoqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59ICovIChyb3cpKSlcbiAgICAgIGNvbHVtbnNCeVRhYmxlLnNldCh0YWJsZU5hbWUsIGNvbHVtbnMpXG4gICAgfVxuXG4gICAgcmV0dXJuIGNvbHVtbnNCeVRhYmxlXG4gIH1cblxuICAvKipcbiAgICogS2VlcHMgY29uc3RyYWludCB0b2dnbGVzIGFuZCBjbGVhbnVwIGluc2lkZSBlYWNoIHBoeXNpY2FsIFNRTCBTZXJ2ZXJcbiAgICogcmVxdWVzdCBzbyBhIHBvb2wgY2Fubm90IHNwbGl0IGxpZmVjeWNsZSBvd25lcnNoaXAgYWNyb3NzIHNlc3Npb25zLlxuICAgKiBAcHJvdGVjdGVkXG4gICAqIEBwYXJhbSB7QXJyYXk8aW1wb3J0KFwiLi4vYmFzZS10YWJsZS5qc1wiKS5kZWZhdWx0Pn0gdGFibGVzIC0gRWxpZ2libGUgdGFibGVzLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyBhZnRlciBvbmUgY2xlYW51cCBhdHRlbXB0IHN1Y2NlZWRzLlxuICAgKi9cbiAgYXN5bmMgX3RydW5jYXRlQWxsVGFibGVzKHRhYmxlcykge1xuICAgIGF3YWl0IHRoaXMuX3RydW5jYXRlQWxsVGFibGVzV2l0aFJldHJpZXModGFibGVzKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgb25lIGZhaWwtbG91ZCBjbGVhbnVwIGJhdGNoIHdpdGggcmVzdG9yYXRpb24gb24gYm90aCBzdWNjZXNzIGFuZFxuICAgKiBmYWlsdXJlLiBUaGUgb3V0ZXIgcmV0cnkgb3duZXIgcmVmcmVzaGVzIHN0YWxlIHRhYmxlIHNuYXBzaG90cy5cbiAgICogQHByb3RlY3RlZFxuICAgKiBAcGFyYW0ge0FycmF5PGltcG9ydChcIi4uL2Jhc2UtdGFibGUuanNcIikuZGVmYXVsdD59IHRhYmxlcyAtIEN1cnJlbnQgZWxpZ2libGUgdGFibGVzLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyBhZnRlciB0aGUgYmF0Y2ggY29tcGxldGVzLlxuICAgKi9cbiAgYXN5bmMgX3RydW5jYXRlQWxsVGFibGVzQXR0ZW1wdCh0YWJsZXMpIHtcbiAgICBjb25zdCBzdGF0ZW1lbnRzID0gW1xuICAgICAgXCJCRUdJTiBUUllcIixcbiAgICAgIGAgICR7RElTQUJMRV9GT1JFSUdOX0tFWVNfU1FMfTtgLFxuICAgICAgLi4udGhpcy5fdHJ1bmNhdGVUYWJsZVN0YXRlbWVudHModGFibGVzKSxcbiAgICAgIGAgICR7RU5BQkxFX0ZPUkVJR05fS0VZU19TUUx9O2AsXG4gICAgICBcIkVORCBUUllcIixcbiAgICAgIFwiQkVHSU4gQ0FUQ0hcIixcbiAgICAgIGAgICR7RU5BQkxFX0ZPUkVJR05fS0VZU19TUUx9O2AsXG4gICAgICBcIiAgVEhST1c7XCIsXG4gICAgICBcIkVORCBDQVRDSDtcIlxuICAgIF1cblxuICAgIGF3YWl0IHRoaXMucXVlcnkoc3RhdGVtZW50cy5qb2luKFwiXFxuXCIpKVxuICB9XG5cbiAgLyoqXG4gICAqIFRydW5jYXRlcyBhbGwgZWxpZ2libGUgdGFibGVzIGluIG9uZSBTUUwgU2VydmVyIHJlcXVlc3QsIHJldGFpbmluZyB0aGVcbiAgICogcmVjb2duaXplZCBmb3JlaWduLWtleSBmYWxsYmFjayB1c2VkIGJ5IHRoZSBwZXItdGFibGUgaW1wbGVtZW50YXRpb24uXG4gICAqIEBwYXJhbSB7QXJyYXk8aW1wb3J0KFwiLi4vYmFzZS10YWJsZS5qc1wiKS5kZWZhdWx0Pn0gdGFibGVzIC0gRWxpZ2libGUgdGFibGVzLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyB3aGVuIHRoZSBiYXRjaCBjb21wbGV0ZXMuXG4gICAqL1xuICBhc3luYyB0cnVuY2F0ZVRhYmxlcyh0YWJsZXMpIHtcbiAgICBhd2FpdCB0aGlzLnF1ZXJ5KHRoaXMuX3RydW5jYXRlVGFibGVTdGF0ZW1lbnRzKHRhYmxlcykuam9pbihcIlxcblwiKSlcbiAgfVxuXG4gIC8qKlxuICAgKiBCdWlsZHMgdGhlIHBlci10YWJsZSB0cnVuY2F0ZS9kZWxldGUtZmFsbGJhY2sgc3RhdGVtZW50cy5cbiAgICogQHBhcmFtIHtBcnJheTxpbXBvcnQoXCIuLi9iYXNlLXRhYmxlLmpzXCIpLmRlZmF1bHQ+fSB0YWJsZXMgLSBFbGlnaWJsZSB0YWJsZXMuXG4gICAqIEByZXR1cm5zIHtzdHJpbmdbXX0gLSBTUUwgc3RhdGVtZW50cy5cbiAgICovXG4gIF90cnVuY2F0ZVRhYmxlU3RhdGVtZW50cyh0YWJsZXMpIHtcbiAgICBjb25zdCBzdGF0ZW1lbnRzID0gW11cblxuICAgIGZvciAoY29uc3QgdGFibGUgb2YgdGFibGVzKSB7XG4gICAgICBjb25zdCBxdW90ZWRUYWJsZSA9IHRoaXMucXVvdGVUYWJsZSh0YWJsZS5nZXROYW1lKCkpXG5cbiAgICAgIHN0YXRlbWVudHMucHVzaChcbiAgICAgICAgXCJCRUdJTiBUUllcIixcbiAgICAgICAgYCAgVFJVTkNBVEUgVEFCTEUgJHtxdW90ZWRUYWJsZX07YCxcbiAgICAgICAgXCJFTkQgVFJZXCIsXG4gICAgICAgIFwiQkVHSU4gQ0FUQ0hcIixcbiAgICAgICAgXCIgIElGIEVSUk9SX05VTUJFUigpID0gNDcxMlwiLFxuICAgICAgICBcIiAgQkVHSU5cIixcbiAgICAgICAgYCAgICBERUxFVEUgRlJPTSAke3F1b3RlZFRhYmxlfTtgLFxuICAgICAgICBcIiAgRU5EXCIsXG4gICAgICAgIFwiICBFTFNFXCIsXG4gICAgICAgIFwiICBCRUdJTlwiLFxuICAgICAgICBcIiAgICBUSFJPVztcIixcbiAgICAgICAgXCIgIEVORFwiLFxuICAgICAgICBcIkVORCBDQVRDSDtcIlxuICAgICAgKVxuICAgIH1cblxuICAgIHJldHVybiBzdGF0ZW1lbnRzXG4gIH1cblxuICBhc3luYyBsYXN0SW5zZXJ0SUQob3B0aW9ucyA9IHt9KSB7XG4gICAgY29uc3QgcmVzdWx0ID0gYXdhaXQgdGhpcy5xdWVyeShcIlNFTEVDVCBTQ09QRV9JREVOVElUWSgpIEFTIGxhc3RfaW5zZXJ0X2lkXCIsIG9wdGlvbnMpXG4gICAgY29uc3QgbGFzdEluc2VydElEID0gZGlnZyhyZXN1bHQsIDAsIFwibGFzdF9pbnNlcnRfaWRcIilcblxuICAgIGlmIChsYXN0SW5zZXJ0SUQgPT09IG51bGwpIHRocm93IG5ldyBFcnJvcihcIkNvdWxkbid0IGdldCB0aGUgbGFzdCBpbnNlcnRlZCBJRFwiKVxuXG4gICAgcmV0dXJuIGxhc3RJbnNlcnRJRFxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgb3B0aW9ucy5cbiAgICogQHJldHVybnMge09wdGlvbnN9IC0gVGhlIG9wdGlvbnMgb3B0aW9ucy5cbiAgICovXG4gIG9wdGlvbnMoKSB7XG4gICAgaWYgKCF0aGlzLl9vcHRpb25zKSB0aGlzLl9vcHRpb25zID0gbmV3IE9wdGlvbnMoe2RyaXZlcjogdGhpc30pXG5cbiAgICByZXR1cm4gdGhpcy5fb3B0aW9uc1xuICB9XG5cbiAgYXN5bmMgX3N0YXJ0VHJhbnNhY3Rpb25BY3Rpb24oKSB7XG4gICAgYXdhaXQgdGhpcy5fcnVuUGh5c2ljYWxDb25uZWN0aW9uUmVxdWVzdChhc3luYyAoKSA9PiB7XG4gICAgICBpZiAodGhpcy5fY3VycmVudFRyYW5zYWN0aW9uKSB0aHJvdyBuZXcgRXJyb3IoXCJBIHRyYW5zYWN0aW9uIGlzIGFscmVhZHkgcnVubmluZ1wiKVxuICAgICAgaWYgKCF0aGlzLmNvbm5lY3Rpb24pIGF3YWl0IHRoaXMuY29ubmVjdCgpXG5cbiAgICAgIHRoaXMuX2N1cnJlbnRUcmFuc2FjdGlvbiA9IG5ldyBtc3NxbC5UcmFuc2FjdGlvbih0aGlzLmNvbm5lY3Rpb24pXG5cbiAgICAgIHRyeSB7XG4gICAgICAgIGF3YWl0IHRoaXMuX2N1cnJlbnRUcmFuc2FjdGlvbi5iZWdpbigpXG4gICAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgICB0aGlzLl9jdXJyZW50VHJhbnNhY3Rpb24gPSBudWxsXG4gICAgICAgIHRocm93IGVycm9yXG4gICAgICB9XG4gICAgfSlcbiAgfVxuXG4gIGFzeW5jIF9jb21taXRUcmFuc2FjdGlvbkFjdGlvbigpIHtcbiAgICBhd2FpdCB0aGlzLl9ydW5QaHlzaWNhbENvbm5lY3Rpb25SZXF1ZXN0KGFzeW5jICgpID0+IHtcbiAgICAgIGlmICghdGhpcy5fY3VycmVudFRyYW5zYWN0aW9uKSB0aHJvdyBuZXcgRXJyb3IoXCJBIHRyYW5zYWN0aW9uIGlzbid0IHJ1bm5pbmdcIilcblxuICAgICAgYXdhaXQgdGhpcy5fY3VycmVudFRyYW5zYWN0aW9uLmNvbW1pdCgpXG4gICAgICB0aGlzLl9jdXJyZW50VHJhbnNhY3Rpb24gPSBudWxsXG4gICAgfSlcbiAgfVxuXG4gIGFzeW5jIF9yb2xsYmFja1RyYW5zYWN0aW9uQWN0aW9uKCkge1xuICAgIGF3YWl0IHRoaXMuX3J1blBoeXNpY2FsQ29ubmVjdGlvblJlcXVlc3QoYXN5bmMgKCkgPT4ge1xuICAgICAgaWYgKCF0aGlzLl9jdXJyZW50VHJhbnNhY3Rpb24pIHtcbiAgICAgICAgdGhpcy5sb2dnZXIuZGVidWcoXCJBIHRyYW5zYWN0aW9uIGlzbid0IHJ1bm5pbmcgLSBpZ25vcmluZyBiZWNhdXNlIHRoYXQgY2FuIGhhcHBlbiBpZiBzb21ldGhpbmcgZWxzZSBoYXMgZmFpbGVkIGluIHRoZSBkYlwiKVxuICAgICAgICByZXR1cm5cbiAgICAgIH1cblxuICAgICAgdHJ5IHtcbiAgICAgICAgYXdhaXQgdGhpcy5fY3VycmVudFRyYW5zYWN0aW9uLnJvbGxiYWNrKClcbiAgICAgIH0gY2F0Y2ggKHRyYW5zYWN0aW9uUm9sbGJhY2tFcnJvcikge1xuICAgICAgICAvLyBXaGVuIFNRTCBTZXJ2ZXIgaGFzIGFscmVhZHkgYWJvcnRlZCB0aGUgdHJhbnNhY3Rpb24gKGUuZy4sIGFcbiAgICAgICAgLy8gc3RhbGUgY29uY3VycmVudCByZXF1ZXN0IHRyaWdnZXJlZCBYQUNUX0FCT1JUKSwgdGhlXG4gICAgICAgIC8vIG1zc3FsLlRyYW5zYWN0aW9uLnJvbGxiYWNrKCkgY2FsbCBmYWlscyBiZWNhdXNlIHRoZVxuICAgICAgICAvLyBUcmFuc2FjdGlvbiBvYmplY3QgaXMgZGVhZC4gIElzc3VlIGEgcmF3IFJPTExCQUNLIG9uIHRoZVxuICAgICAgICAvLyB1bmRlcmx5aW5nIGNvbm5lY3Rpb24gdG8gY2xlYXIgU1FMIFNlcnZlcidzIHNlc3Npb24tbGV2ZWxcbiAgICAgICAgLy8gYWJvcnRlZC10cmFuc2FjdGlvbiBzdGF0ZSBzbyB0aGUgY29ubmVjdGlvbiBpcyB1c2FibGUgZm9yIHRoZVxuICAgICAgICAvLyBuZXh0IEJFR0lOIFRSQU5TQUNUSU9OLlxuICAgICAgICB0aGlzLmxvZ2dlci53YXJuKFwiVHJhbnNhY3Rpb24ucm9sbGJhY2soKSBmYWlsZWQsIGNsZWFyaW5nIHNlc3Npb24gc3RhdGUgd2l0aCByYXcgUk9MTEJBQ0tcIiwge1xuICAgICAgICAgIGVycm9yOiB0cmFuc2FjdGlvblJvbGxiYWNrRXJyb3IgaW5zdGFuY2VvZiBFcnJvciA/IHRyYW5zYWN0aW9uUm9sbGJhY2tFcnJvci5tZXNzYWdlIDogdHJhbnNhY3Rpb25Sb2xsYmFja0Vycm9yXG4gICAgICAgIH0pXG5cbiAgICAgICAgY29uc3QgcmVxdWVzdCA9IG5ldyBtc3NxbC5SZXF1ZXN0KHRoaXMuY29ubmVjdGlvbilcblxuICAgICAgICBhd2FpdCByZXF1ZXN0LnF1ZXJ5KFwiSUYgQEBUUkFOQ09VTlQgPiAwIFJPTExCQUNLXCIpXG4gICAgICB9IGZpbmFsbHkge1xuICAgICAgICB0aGlzLl9jdXJyZW50VHJhbnNhY3Rpb24gPSBudWxsXG4gICAgICB9XG4gICAgfSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHN0YXJ0IHNhdmUgcG9pbnQgYWN0aW9uLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gc2F2ZVBvaW50TmFtZSAtIFNhdmUgcG9pbnQgbmFtZS5cbiAgICogQHBhcmFtIHtQaWNrPGltcG9ydChcIi4uL2Jhc2UuanNcIikuUXVlcnlPcHRpb25zLCBcIm9wZXJhdGlvbk93bmVyXCI+fSBbb3B0aW9uc10gLSBUcmFuc2FjdGlvbiBvd25lcnNoaXAuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIHdoZW4gY29tcGxldGUuXG4gICAqL1xuICBhc3luYyBfc3RhcnRTYXZlUG9pbnRBY3Rpb24oc2F2ZVBvaW50TmFtZSwgb3B0aW9ucyA9IHt9KSB7XG4gICAgYXdhaXQgdGhpcy5xdWVyeShgU0FWRSBUUkFOU0FDVElPTiBbJHtzYXZlUG9pbnROYW1lfV1gLCBvcHRpb25zKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgcmVsZWFzZSBzYXZlIHBvaW50IGFjdGlvbi5cbiAgICogQHBhcmFtIHtzdHJpbmd9IHNhdmVQb2ludE5hbWUgLSBTYXZlIHBvaW50IG5hbWUuXG4gICAqIEBwYXJhbSB7UGljazxpbXBvcnQoXCIuLi9iYXNlLmpzXCIpLlF1ZXJ5T3B0aW9ucywgXCJvcGVyYXRpb25Pd25lclwiPn0gW19vcHRpb25zXSAtIFRyYW5zYWN0aW9uIG93bmVyc2hpcC5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgd2hlbiBjb21wbGV0ZS5cbiAgICovXG4gIGFzeW5jIF9yZWxlYXNlU2F2ZVBvaW50QWN0aW9uKHNhdmVQb2ludE5hbWUsIF9vcHRpb25zID0ge30pIHtcbiAgICAvLyBEbyBub3RoaW5nIGluIE1TLVNRTC5cbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHJvbGxiYWNrIHNhdmUgcG9pbnQgYWN0aW9uLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gc2F2ZVBvaW50TmFtZSAtIFNhdmUgcG9pbnQgbmFtZS5cbiAgICogQHBhcmFtIHtQaWNrPGltcG9ydChcIi4uL2Jhc2UuanNcIikuUXVlcnlPcHRpb25zLCBcIm9wZXJhdGlvbk93bmVyXCI+fSBbb3B0aW9uc10gLSBUcmFuc2FjdGlvbiBvd25lcnNoaXAuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIHdoZW4gY29tcGxldGUuXG4gICAqL1xuICBhc3luYyBfcm9sbGJhY2tTYXZlUG9pbnRBY3Rpb24oc2F2ZVBvaW50TmFtZSwgb3B0aW9ucyA9IHt9KSB7XG4gICAgdHJ5IHtcbiAgICAgIGF3YWl0IHRoaXMucXVlcnkoYFJPTExCQUNLIFRSQU5TQUNUSU9OIFske3NhdmVQb2ludE5hbWV9XWAsIG9wdGlvbnMpXG4gICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgIGNvbnN0IG1lc3NhZ2UgPSBlcnJvciBpbnN0YW5jZW9mIEVycm9yID8gZXJyb3IubWVzc2FnZSA6IGAke2Vycm9yfWBcblxuICAgICAgLy8gV2hlbiBYQUNUX0FCT1JUIGtpbGxzIHRoZSBlbnRpcmUgdHJhbnNhY3Rpb24sIHRoZSBzYXZlcG9pbnRcbiAgICAgIC8vIG5vIGxvbmdlciBleGlzdHMgYW5kIHRoZSBST0xMQkFDSyBUUkFOU0FDVElPTiBbbmFtZV0gZmFpbHMuXG4gICAgICAvLyBJc3N1ZSBhIHJhdyBJRiBAQFRSQU5DT1VOVCA+IDAgUk9MTEJBQ0sgdG8gY2xlYXIgd2hhdGV2ZXJcbiAgICAgIC8vIHNlc3Npb24gc3RhdGUgcmVtYWlucywgdGhlbiBsZXQgdGhlIGVycm9yIHByb3BhZ2F0ZSBzbyB0aGVcbiAgICAgIC8vIG91dGVyIHRyYW5zYWN0aW9uKCkgY2FsbCBrbm93cyB0aGUgdHJhbnNhY3Rpb24gaXMgZGVhZC5cbiAgICAgIGlmIChtZXNzYWdlLmluY2x1ZGVzKFwiVHJhbnNhY3Rpb24gaGFzIG5vdCBiZWd1blwiKSB8fCBtZXNzYWdlLmluY2x1ZGVzKFwiVHJhbnNhY3Rpb24gaGFzIGJlZW4gYWJvcnRlZFwiKSkge1xuICAgICAgICB0aGlzLmxvZ2dlci5kZWJ1ZyhcIlNhdmVwb2ludCByb2xsYmFjayBmYWlsZWQ7IHRyYW5zYWN0aW9uIGFscmVhZHkgZGVhZCwgY2xlYXJpbmcgc2Vzc2lvbiBzdGF0ZVwiKVxuXG4gICAgICAgIGNvbnN0IHJlcXVlc3QgPSBuZXcgbXNzcWwuUmVxdWVzdCh0aGlzLmNvbm5lY3Rpb24pXG5cbiAgICAgICAgYXdhaXQgcmVxdWVzdC5xdWVyeShcIklGIEBAVFJBTkNPVU5UID4gMCBST0xMQkFDS1wiKVxuXG4gICAgICAgIHJldHVyblxuICAgICAgfVxuXG4gICAgICB0aHJvdyBlcnJvclxuICAgIH1cbiAgfVxuXG4gIGdlbmVyYXRlU2F2ZVBvaW50TmFtZSgpIHtcbiAgICByZXR1cm4gYHNwJHtuZXcgVVVJRCg0KS5mb3JtYXQoKS5yZXBsYWNlQWxsKFwiLVwiLCBcIlwiKX1gLnN1YnN0cmluZygwLCAzMilcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHVwZGF0ZSBzcWwuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vYmFzZS5qc1wiKS5VcGRhdGVTcWxBcmdzVHlwZX0gYXJncyAtIE9wdGlvbnMgb2JqZWN0LlxuICAgKiBAcmV0dXJucyB7c3RyaW5nfSAtIFNRTCBzdHJpbmcuXG4gICAqL1xuICB1cGRhdGVTcWwoe2NvbmRpdGlvbnMsIGRhdGEsIHRhYmxlTmFtZX0pIHtcbiAgICBjb25zdCB1cGRhdGUgPSBuZXcgVXBkYXRlKHtjb25kaXRpb25zLCBkYXRhLCBkcml2ZXI6IHRoaXMsIHRhYmxlTmFtZX0pXG5cbiAgICByZXR1cm4gdXBkYXRlLnRvU3FsKClcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHVwc2VydCBzcWwuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vYmFzZS5qc1wiKS5VcHNlcnRTcWxBcmdzVHlwZX0gYXJncyAtIE9wdGlvbnMgb2JqZWN0LlxuICAgKiBAcmV0dXJucyB7c3RyaW5nfSAtIFNRTCBzdHJpbmcuXG4gICAqL1xuICB1cHNlcnRTcWwoYXJncykge1xuICAgIGNvbnN0IHVwc2VydCA9IG5ldyBVcHNlcnQoey4uLmFyZ3MsIGRyaXZlcjogdGhpc30pXG5cbiAgICByZXR1cm4gdXBzZXJ0LnRvU3FsKClcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHN0cnVjdHVyZSBzcWwuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHN0cmluZyB8IG51bGw+fSAtIFJlc29sdmVzIHdpdGggU1FMIHN0cmluZy5cbiAgICovXG4gIGFzeW5jIHN0cnVjdHVyZVNxbCgpIHtcbiAgICByZXR1cm4gYXdhaXQgdGhpcy5fY2FjaGVkU2NoZW1hTWV0YWRhdGEoXCJzdHJ1Y3R1cmVTcWxcIiwgYXN5bmMgKCkgPT4gYXdhaXQgbmV3IFN0cnVjdHVyZVNxbCh7ZHJpdmVyOiB0aGlzfSkudG9TcWwoKSlcbiAgfVxuXG4gIC8qKlxuICAgKiBCbG9ja3MgdW50aWwgYSBTUUwgU2VydmVyIGFwcGxpY2F0aW9uIGxvY2sgaXMgYWNxdWlyZWQgb24gdGhpc1xuICAgKiBjb25uZWN0aW9uIHZpYSBgc3BfZ2V0YXBwbG9ja2AuIFRoZSBTZXNzaW9uIGxvY2sgb3duZXIgc2NvcGVzIHRoZSBsb2NrXG4gICAqIHRvIHRoZSBjdXJyZW50IHNlc3Npb24sIG1hdGNoaW5nIHRoZSBjb25uZWN0aW9uLXNjb3BlZCBzZW1hbnRpY3Mgb25cbiAgICogTXlTUUwgYW5kIFBvc3RncmVTUUwuXG4gICAqXG4gICAqIGBzcF9nZXRhcHBsb2NrYCByZXR1cm5zIDAgb24gaW1tZWRpYXRlIGdyYW50LCAxIGFmdGVyIHdhaXRpbmcsIGFuZFxuICAgKiBuZWdhdGl2ZSB2YWx1ZXMgb24gZmFpbHVyZSAodGltZW91dCwgZGVhZGxvY2ssIGNhbmNlbGVkLCBwYXJhbWV0ZXJcbiAgICogZXJyb3IpLiBXZSB0cmVhdCAwLzEgYXMgc3VjY2VzcyBhbmQgLTEgKHRpbWVvdXQpIGFzIGEgY2xlYW4gYGZhbHNlYDtcbiAgICogYW55dGhpbmcgZWxzZSB0aHJvd3MuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBuYW1lIC0gTG9jayBuYW1lLlxuICAgKiBAcGFyYW0ge3t0aW1lb3V0TXM/OiBudW1iZXIgfCBudWxsfX0gW2FyZ3NdIC0gT3B0aW9uYWwgdGltZW91dCBpbiBtaWxsaXNlY29uZHM7IGBudWxsYCwgYHVuZGVmaW5lZGAsIG9yIG5lZ2F0aXZlIGJsb2NrcyBmb3JldmVyLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxib29sZWFuPn0gLSBUcnVlIGlmIHRoZSBsb2NrIHdhcyBhY3F1aXJlZCwgZmFsc2UgaWYgdGhlIHRpbWVvdXQgZWxhcHNlZC5cbiAgICovXG4gIGFzeW5jIF9hY3F1aXJlQWR2aXNvcnlMb2NrKG5hbWUsIHt0aW1lb3V0TXN9ID0ge30pIHtcbiAgICBjb25zdCB0aW1lb3V0VmFsdWUgPSB0eXBlb2YgdGltZW91dE1zID09PSBcIm51bWJlclwiICYmIHRpbWVvdXRNcyA+PSAwID8gTWF0aC5jZWlsKHRpbWVvdXRNcykgOiAtMVxuICAgIGNvbnN0IHJvd3MgPSBhd2FpdCB0aGlzLl9hZHZpc29yeUxvY2tRdWVyeShcbiAgICAgIGBERUNMQVJFIEB2ZWxvY2lvdXNfYWR2aXNvcnlfbG9ja19yZXN1bHQgSU5UOyBFWEVDIEB2ZWxvY2lvdXNfYWR2aXNvcnlfbG9ja19yZXN1bHQgPSBzcF9nZXRhcHBsb2NrIEBSZXNvdXJjZSA9ICR7dGhpcy5xdW90ZShuYW1lKX0sIEBMb2NrTW9kZSA9ICdFeGNsdXNpdmUnLCBATG9ja093bmVyID0gJ1Nlc3Npb24nLCBATG9ja1RpbWVvdXQgPSAke3RpbWVvdXRWYWx1ZX07IFNFTEVDVCBAdmVsb2Npb3VzX2Fkdmlzb3J5X2xvY2tfcmVzdWx0IEFTIHZlbG9jaW91c19hZHZpc29yeV9sb2NrX3Jlc3VsdGBcbiAgICApXG4gICAgY29uc3QgcmVzdWx0ID0gTnVtYmVyKHJvd3M/LlswXT8udmVsb2Npb3VzX2Fkdmlzb3J5X2xvY2tfcmVzdWx0KVxuXG4gICAgaWYgKHJlc3VsdCA9PT0gMCB8fCByZXN1bHQgPT09IDEpIHJldHVybiB0cnVlXG5cbiAgICBhd2FpdCB0aGlzLl9jbG9zZUFkdmlzb3J5TG9ja1RyYW5zYWN0aW9uKClcblxuICAgIGlmIChyZXN1bHQgPT09IC0xKSByZXR1cm4gZmFsc2VcblxuICAgIHRocm93IG5ldyBFcnJvcihgc3BfZ2V0YXBwbG9jayByZXR1cm5lZCAke3Jlc3VsdH0gZm9yIGFkdmlzb3J5IGxvY2sgJHtKU09OLnN0cmluZ2lmeShuYW1lKX0gKHNlZSBTUUwgU2VydmVyIGRvY3VtZW50YXRpb24gZm9yIHNwX2dldGFwcGxvY2sgcmV0dXJuIGNvZGVzKWApXG4gIH1cblxuICAvKipcbiAgICogUnVucyB0cnkgYWNxdWlyZSBhZHZpc29yeSBsb2NrLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gbmFtZSAtIExvY2sgbmFtZS5cbiAgICogQHJldHVybnMge1Byb21pc2U8Ym9vbGVhbj59IC0gVHJ1ZSBpZiB0aGUgbG9jayB3YXMgYWNxdWlyZWQsIGZhbHNlIGlmIGl0IHdhcyBhbHJlYWR5IGhlbGQuXG4gICAqL1xuICBhc3luYyBfdHJ5QWNxdWlyZUFkdmlzb3J5TG9jayhuYW1lKSB7XG4gICAgcmV0dXJuIGF3YWl0IHRoaXMuX2FjcXVpcmVBZHZpc29yeUxvY2sobmFtZSwge3RpbWVvdXRNczogMH0pXG4gIH1cblxuICAvKipcbiAgICogUnVucyByZWxlYXNlIGFkdmlzb3J5IGxvY2suXG4gICAqXG4gICAqIGBzcF9yZWxlYXNlYXBwbG9ja2AgcmV0dXJucyAwIHdoZW4gdGhlIGxvY2sgd2FzIHJlbGVhc2VkLCBidXQgU1FMIFNlcnZlclxuICAgKiByYWlzZXMgZXJyb3Ige0BsaW5rIEFQUExPQ0tfTk9UX0hFTERfRVJST1JfTlVNQkVSfSBpbnN0ZWFkIG9mIHJldHVybmluZyBhXG4gICAqIGZhaWx1cmUgY29kZSB3aGVuIHRoZSBzZXNzaW9uIGRvZXMgbm90IGN1cnJlbnRseSBob2xkIHRoZSBsb2NrLiBUaGF0XG4gICAqIGVycm9yIGFib3J0cyB0aGUgYmF0Y2ggYmVmb3JlIHRoZSB0cmFpbGluZyBgU0VMRUNUYCBjYW4gcnVuLCBzbyB3ZSBjYXRjaFxuICAgKiBpdCBhbmQgcmVzb2x2ZSB0byBgZmFsc2VgIHRvIGhvbm9yIHRoZSBjcm9zcy1kcml2ZXIgY29udHJhY3QgZm9yIGFuXG4gICAqIGFscmVhZHktdW5oZWxkIGxvY2suXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBuYW1lIC0gTG9jayBuYW1lLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxib29sZWFuPn0gLSBUcnVlIGlmIHRoZSBsb2NrIHdhcyBoZWxkIGJ5IHRoaXMgc2Vzc2lvbiBhbmQgaGFzIG5vdyBiZWVuIHJlbGVhc2VkLlxuICAgKi9cbiAgYXN5bmMgX3JlbGVhc2VBZHZpc29yeUxvY2sobmFtZSkge1xuICAgIGxldCByb3dzXG5cbiAgICB0cnkge1xuICAgICAgcm93cyA9IGF3YWl0IHRoaXMuX2Fkdmlzb3J5TG9ja1F1ZXJ5KFxuICAgICAgICBgREVDTEFSRSBAdmVsb2Npb3VzX2Fkdmlzb3J5X2xvY2tfcmVzdWx0IElOVDsgRVhFQyBAdmVsb2Npb3VzX2Fkdmlzb3J5X2xvY2tfcmVzdWx0ID0gc3BfcmVsZWFzZWFwcGxvY2sgQFJlc291cmNlID0gJHt0aGlzLnF1b3RlKG5hbWUpfSwgQExvY2tPd25lciA9ICdTZXNzaW9uJzsgU0VMRUNUIEB2ZWxvY2lvdXNfYWR2aXNvcnlfbG9ja19yZXN1bHQgQVMgdmVsb2Npb3VzX2Fkdmlzb3J5X2xvY2tfcmVzdWx0YFxuICAgICAgKVxuICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICBpZiAodGhpcy5faXNBcHBsb2NrTm90SGVsZEVycm9yKGVycm9yKSkge1xuICAgICAgICBhd2FpdCB0aGlzLl9jbG9zZUFkdmlzb3J5TG9ja1RyYW5zYWN0aW9uSWZGaW5hbFJlbGVhc2UoKVxuXG4gICAgICAgIHJldHVybiBmYWxzZVxuICAgICAgfVxuXG4gICAgICB0aHJvdyBlcnJvclxuICAgIH1cblxuICAgIGNvbnN0IHJlc3VsdCA9IE51bWJlcihyb3dzPy5bMF0/LnZlbG9jaW91c19hZHZpc29yeV9sb2NrX3Jlc3VsdClcblxuICAgIGF3YWl0IHRoaXMuX2Nsb3NlQWR2aXNvcnlMb2NrVHJhbnNhY3Rpb25JZkZpbmFsUmVsZWFzZSgpXG5cbiAgICByZXR1cm4gcmVzdWx0ID09PSAwXG4gIH1cblxuICAvKipcbiAgICogUnVucyBhbiBhZHZpc29yeS1sb2NrIHN0YXRlbWVudCB0aHJvdWdoIG9uZSB0cmFuc2FjdGlvbiByZXF1ZXN0IHBhcmVudC5cbiAgICogbm9kZS1tc3NxbCByZXNlcnZlcyBvbmUgcGh5c2ljYWwgc2Vzc2lvbiBmb3IgYSBUcmFuc2FjdGlvbiwgd2hlcmVhc1xuICAgKiBzZXBhcmF0ZSBDb25uZWN0aW9uUG9vbCByZXF1ZXN0cyBtYXkgY2hlY2sgb3V0IGRpZmZlcmVudCBzZXNzaW9ucy4gVGhlXG4gICAqIHRyYW5zYWN0aW9uIGNvbnRhaW5zIG9ubHkgYXBwbGljYXRpb24tbG9jayBzdGF0ZW1lbnRzOyBjYWxsZXIvbW9kZWwgd29ya1xuICAgKiBjb250aW51ZXMgdGhyb3VnaCBpdHMgb3JpZ2luYWwgY29ubmVjdGlvbi5cbiAgICogQHBhcmFtIHtzdHJpbmd9IHNxbCAtIEFkdmlzb3J5LWxvY2sgU1FMLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxpbXBvcnQoXCIuLi9iYXNlLmpzXCIpLlF1ZXJ5UmVzdWx0VHlwZT59IC0gUmVzdWx0IHJvd3MuXG4gICAqL1xuICBhc3luYyBfYWR2aXNvcnlMb2NrUXVlcnkoc3FsKSB7XG4gICAgY29uc3QgdHJhbnNhY3Rpb24gPSBhd2FpdCB0aGlzLl9lbnN1cmVBZHZpc29yeUxvY2tUcmFuc2FjdGlvbigpXG5cbiAgICB0cnkge1xuICAgICAgY29uc3QgcmVxdWVzdCA9IG5ldyBtc3NxbC5SZXF1ZXN0KHRyYW5zYWN0aW9uKVxuICAgICAgY29uc3QgcmVzdWx0ID0gYXdhaXQgcmVxdWVzdC5xdWVyeShzcWwpXG5cbiAgICAgIHJldHVybiBBcnJheS5pc0FycmF5KHJlc3VsdC5yZWNvcmRzZXRzKSA/IHJlc3VsdC5yZWNvcmRzZXRzWzBdIHx8IFtdIDogW11cbiAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgaWYgKGVycm9yIGluc3RhbmNlb2YgRXJyb3IpIHtcbiAgICAgICAgdGhyb3cgbmV3IEVycm9yKGBRdWVyeSBmYWlsZWQgJyR7ZXJyb3IubWVzc2FnZX0nOiAke3NxbH1gLCB7Y2F1c2U6IGVycm9yfSlcbiAgICAgIH1cblxuICAgICAgdGhyb3cgbmV3IEVycm9yKGBRdWVyeSBmYWlsZWQgJyR7ZXJyb3J9JzogJHtzcWx9YCwge2NhdXNlOiBlcnJvcn0pXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIFN0YXJ0cyB0aGUgdHJhbnNhY3Rpb24gcmVxdWVzdCBwYXJlbnQgdGhhdCByZXNlcnZlcyB0aGUgYWR2aXNvcnktbG9ja1xuICAgKiBzZXNzaW9uIHVudGlsIHRoZSBmaW5hbCByZWxlYXNlIG9yIGRyaXZlciBjbG9zZS5cbiAgICogQHJldHVybnMge1Byb21pc2U8aW1wb3J0KFwibXNzcWxcIikuVHJhbnNhY3Rpb24+fSAtIFNlc3Npb24tYWZmaW5lIHBhcmVudC5cbiAgICovXG4gIGFzeW5jIF9lbnN1cmVBZHZpc29yeUxvY2tUcmFuc2FjdGlvbigpIHtcbiAgICBpZiAodGhpcy5fYWR2aXNvcnlMb2NrVHJhbnNhY3Rpb24pIHJldHVybiB0aGlzLl9hZHZpc29yeUxvY2tUcmFuc2FjdGlvblxuICAgIGlmICghdGhpcy5jb25uZWN0aW9uKSBhd2FpdCB0aGlzLmNvbm5lY3QoKVxuICAgIGlmICghdGhpcy5jb25uZWN0aW9uKSB0aHJvdyBuZXcgRXJyb3IoXCJNU1NRTCBjb25uZWN0aW9uIHVuYXZhaWxhYmxlIGZvciBhZHZpc29yeSBsb2NrXCIpXG5cbiAgICBjb25zdCB0cmFuc2FjdGlvbiA9IG5ldyBtc3NxbC5UcmFuc2FjdGlvbih0aGlzLmNvbm5lY3Rpb24pXG5cbiAgICBhd2FpdCB0cmFuc2FjdGlvbi5iZWdpbigpXG4gICAgdGhpcy5fYWR2aXNvcnlMb2NrVHJhbnNhY3Rpb24gPSB0cmFuc2FjdGlvblxuXG4gICAgcmV0dXJuIHRyYW5zYWN0aW9uXG4gIH1cblxuICAvKipcbiAgICogUmVsZWFzZXMgdGhlIHJlc2VydmVkIHNlc3Npb24gYWZ0ZXIgdGhlIGxhc3QgdHJhY2tlZCBsb2NrIHJlbGVhc2UuXG4gICAqIEJhc2UgdW50cmFja3MgdGhlIGN1cnJlbnQgcmVsZWFzZSBhZnRlciB0aGUgZHJpdmVyIGhvb2sgcmV0dXJucywgc28gYVxuICAgKiBjdXJyZW50IHRvdGFsIG9mIG9uZSBtZWFucyB0aGlzIGlzIHRoZSBmaW5hbCByZWxlYXNlLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyBhZnRlciBjbGVhbnVwIHdoZW4gdGhpcyBpcyBmaW5hbC5cbiAgICovXG4gIGFzeW5jIF9jbG9zZUFkdmlzb3J5TG9ja1RyYW5zYWN0aW9uSWZGaW5hbFJlbGVhc2UoKSB7XG4gICAgbGV0IGhlbGRDb3VudCA9IDBcblxuICAgIGZvciAoY29uc3QgY291bnQgb2YgdGhpcy5faGVsZEFkdmlzb3J5TG9ja3MudmFsdWVzKCkpIGhlbGRDb3VudCArPSBjb3VudFxuXG4gICAgaWYgKGhlbGRDb3VudCA8PSAxKSBhd2FpdCB0aGlzLl9jbG9zZUFkdmlzb3J5TG9ja1RyYW5zYWN0aW9uKClcbiAgfVxuXG4gIC8qKlxuICAgKiBSb2xscyBiYWNrIHRoZSBvdGhlcndpc2UtZW1wdHkgdHJhbnNhY3Rpb24gYW5kIHJldHVybnMgaXRzIHBoeXNpY2FsXG4gICAqIHNlc3Npb24gdG8gbm9kZS1tc3NxbC4gUm9sbGJhY2sgaXMgY2xlYW51cCBvbmx5OyBhZHZpc29yeSBsb2NrcyBhcmVcbiAgICogZXhwbGljaXRseSByZWxlYXNlZCBmaXJzdCB3aGVuZXZlciB0aGVpciByZWxlYXNlIHN0YXRlbWVudCBzdWNjZWVkcy5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgYWZ0ZXIgc2Vzc2lvbiBjbGVhbnVwLlxuICAgKi9cbiAgYXN5bmMgX2Nsb3NlQWR2aXNvcnlMb2NrVHJhbnNhY3Rpb24oKSB7XG4gICAgY29uc3QgdHJhbnNhY3Rpb24gPSB0aGlzLl9hZHZpc29yeUxvY2tUcmFuc2FjdGlvblxuXG4gICAgaWYgKCF0cmFuc2FjdGlvbikgcmV0dXJuXG5cbiAgICB0aGlzLl9hZHZpc29yeUxvY2tUcmFuc2FjdGlvbiA9IG51bGxcbiAgICBhd2FpdCB0cmFuc2FjdGlvbi5yb2xsYmFjaygpXG4gIH1cblxuICAvKipcbiAgICogRGV0ZWN0cyB0aGUgU1FMIFNlcnZlciBcImFwcGxpY2F0aW9uIGxvY2sgaXMgbm90IGN1cnJlbnRseSBoZWxkXCIgZXJyb3JcbiAgICogcmFpc2VkIGJ5IGBzcF9yZWxlYXNlYXBwbG9ja2AuIEl0IHdhbGtzIHRoZSB3cmFwcGVkLWVycm9yIGNhdXNlIGNoYWluXG4gICAqIGJlY2F1c2UgYHF1ZXJ5YCByZS13cmFwcyB0aGUgZHJpdmVyJ3MgYFJlcXVlc3RFcnJvcmAgaW4gYSBwbGFpbiBgRXJyb3JgLFxuICAgKiBhbmQgbWF0Y2hlcyBvbiB0aGUgc3RhYmxlIG51bWVyaWMgZXJyb3IgbnVtYmVyIHJhdGhlciB0aGFuIHRoZSBtZXNzYWdlLlxuICAgKiBAcGFyYW0ge3Vua25vd259IGVycm9yIC0gRXJyb3IgdGhyb3duIHdoaWxlIHJlbGVhc2luZyB0aGUgbG9jay5cbiAgICogQHJldHVybnMge2Jvb2xlYW59IC0gVHJ1ZSBpZiB0aGUgZXJyb3IgbWVhbnMgdGhlIGxvY2sgd2FzIG5vdCBoZWxkIGJ5IHRoaXMgc2Vzc2lvbi5cbiAgICovXG4gIF9pc0FwcGxvY2tOb3RIZWxkRXJyb3IoZXJyb3IpIHtcbiAgICBsZXQgY3VycmVudCA9IGVycm9yXG5cbiAgICB3aGlsZSAoY3VycmVudCBpbnN0YW5jZW9mIEVycm9yKSB7XG4gICAgICBjb25zdCBlcnJvck51bWJlciA9IC8qKiBAdHlwZSB7e251bWJlcj86IHVua25vd259fSAqLyAoY3VycmVudCkubnVtYmVyXG5cbiAgICAgIGlmICh0eXBlb2YgZXJyb3JOdW1iZXIgPT09IFwibnVtYmVyXCIgJiYgZXJyb3JOdW1iZXIgPT09IEFQUExPQ0tfTk9UX0hFTERfRVJST1JfTlVNQkVSKSByZXR1cm4gdHJ1ZVxuXG4gICAgICBjdXJyZW50ID0gY3VycmVudC5jYXVzZVxuICAgIH1cblxuICAgIHJldHVybiBmYWxzZVxuICB9XG5cbiAgLyoqXG4gICAqIFJldHVybnMgdHJ1ZSBpZiBhbnkgc2Vzc2lvbiBjdXJyZW50bHkgaG9sZHMgdGhlIGFwcGxpY2F0aW9uIGxvY2suXG4gICAqXG4gICAqIFRoaXMgY29tYmluZXMgdHdvIHByb2JlcyBiZWNhdXNlIG5laXRoZXIgaXMgc3VmZmljaWVudCBvbiBpdHMgb3duOlxuICAgKiAgIC0gYEFQUExPQ0tfTU9ERSguLi4sICdTZXNzaW9uJylgIG9ubHkgcmVwb3J0cyBsb2NrcyBoZWxkIGJ5IHRoZVxuICAgKiAgICAgKipjdXJyZW50Kiogc2Vzc2lvbiwgc28gaXQgbWlzc2VzIGxvY2tzIGhlbGQgYnkgYW55IG90aGVyXG4gICAqICAgICBzZXNzaW9uIGFuZCB3b3VsZCByZXR1cm4gYE5vTG9ja2AgZXZlbiB1bmRlciBjcm9zcy1zZXNzaW9uXG4gICAqICAgICBjb250ZW50aW9uLlxuICAgKiAgIC0gYEFQUExPQ0tfVEVTVCguLi4sICdFeGNsdXNpdmUnLCAnU2Vzc2lvbicpYCByZXR1cm5zIHdoZXRoZXIgYW5cbiAgICogICAgIEV4Y2x1c2l2ZSBsb2NrIGNvdWxkIGJlIGdyYW50ZWQgdG8gKnRoaXMqIHNlc3Npb24gcmlnaHQgbm93LiBBXG4gICAqICAgICByZXR1cm4gdmFsdWUgb2YgMCBtZWFucyBzb21lYm9keSBlbHNlIGhvbGRzIGFuIGluY29tcGF0aWJsZVxuICAgKiAgICAgbG9jazsgYSB2YWx1ZSBvZiAxIG1lYW5zIGl0IGlzIGVpdGhlciBmcmVlICoqb3IqKiBhbHJlYWR5IGhlbGRcbiAgICogICAgIGJ5IHVzIHJlLWVudHJhbnRseSAod2hpY2ggdGhlIGBBUFBMT0NLX01PREVgIGNoZWNrIGNhdGNoZXMpLlxuICAgKlxuICAgKiBUaGUgY29tYmluZWQgcmVzdWx0IGlzIFwiaGVsZFwiIGlmZiB3ZSBob2xkIGl0IG91cnNlbHZlcyBvclxuICAgKiBgQVBQTE9DS19URVNUYCByZXBvcnRzIHdlIGNhbm5vdCBhY3F1aXJlIGl0IHdpdGhvdXQgd2FpdGluZy5cbiAgICogQHBhcmFtIHtzdHJpbmd9IG5hbWUgLSBMb2NrIG5hbWUuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPGJvb2xlYW4+fSAtIFRydWUgaWYgYW55IHNlc3Npb24gY3VycmVudGx5IGhvbGRzIHRoZSBsb2NrLlxuICAgKi9cbiAgYXN5bmMgX2lzQWR2aXNvcnlMb2NrSGVsZE5hdGl2ZShuYW1lKSB7XG4gICAgY29uc3Qgcm93cyA9IGF3YWl0IHRoaXMucXVlcnkoXG4gICAgICBgU0VMRUNUIGAgK1xuICAgICAgICBgQVBQTE9DS19NT0RFKCdwdWJsaWMnLCAke3RoaXMucXVvdGUobmFtZSl9LCAnU2Vzc2lvbicpIEFTIHZlbG9jaW91c19hZHZpc29yeV9zZWxmX21vZGUsIGAgK1xuICAgICAgICBgQVBQTE9DS19URVNUKCdwdWJsaWMnLCAke3RoaXMucXVvdGUobmFtZSl9LCAnRXhjbHVzaXZlJywgJ1Nlc3Npb24nKSBBUyB2ZWxvY2lvdXNfYWR2aXNvcnlfdGVzdF9yZXN1bHRgXG4gICAgKVxuICAgIGNvbnN0IHNlbGZNb2RlID0gcm93cz8uWzBdPy52ZWxvY2lvdXNfYWR2aXNvcnlfc2VsZl9tb2RlXG4gICAgY29uc3QgaGVsZEJ5U2VsZiA9IHR5cGVvZiBzZWxmTW9kZSA9PT0gXCJzdHJpbmdcIiAmJiBzZWxmTW9kZS5sZW5ndGggPiAwICYmIHNlbGZNb2RlICE9PSBcIk5vTG9ja1wiXG5cbiAgICBpZiAoaGVsZEJ5U2VsZikgcmV0dXJuIHRydWVcblxuICAgIGNvbnN0IHRlc3RSZXN1bHQgPSBOdW1iZXIocm93cz8uWzBdPy52ZWxvY2lvdXNfYWR2aXNvcnlfdGVzdF9yZXN1bHQpXG5cbiAgICByZXR1cm4gdGVzdFJlc3VsdCA9PT0gMFxuICB9XG5cbiAgLyoqXG4gICAqIEF0dHJpYnV0ZXMgdGhlIGN1cnJlbnQgaG9sZGVyIG9mIHRoZSBuYW1lZCBhcHBsaWNhdGlvbiBsb2NrIHRvIGl0c1xuICAgKiByZXF1ZXN0aW5nIHNlc3Npb24gZnJvbSBgc3lzLmRtX3RyYW5fbG9ja3NgLCBjYXB0dXJlZCBhdCB0aGUgdGVsZW1ldHJ5XG4gICAqIGV2ZW50IG1vbWVudCAoYmVzdC1lZmZvcnQ7IHRoZSBjYWxsZXIgZ3VhcmRzIGZhaWx1cmVzKS5cbiAgICogQHBhcmFtIHtzdHJpbmd9IG5hbWUgLSBMb2NrIG5hbWUuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHN0cmluZyB8IG51bGw+fSAtIFNRTCBTZXJ2ZXIgc2Vzc2lvbiBpZCBvZiB0aGUgaG9sZGVyLCBvciBudWxsIHdoZW4gbm8gc2Vzc2lvbiBob2xkcyB0aGUgbG9jay5cbiAgICovXG4gIGFzeW5jIGFkdmlzb3J5TG9ja0hvbGRlckNvbm5lY3Rpb25JZChuYW1lKSB7XG4gICAgY29uc3Qgcm93cyA9IGF3YWl0IHRoaXMucXVlcnkoXG4gICAgICBgU0VMRUNUIFRPUCAxIHJlcXVlc3Rfc2Vzc2lvbl9pZCBBUyB2ZWxvY2lvdXNfYWR2aXNvcnlfbG9ja19ob2xkZXIgRlJPTSBzeXMuZG1fdHJhbl9sb2NrcyBXSEVSRSByZXNvdXJjZV90eXBlID0gJ0FQUExJQ0FUSU9OTE9DSycgQU5EIHJlc291cmNlX2Rlc2NyaXB0aW9uID0gJHt0aGlzLnF1b3RlKG5hbWUpfWBcbiAgICApXG4gICAgY29uc3QgaG9sZGVyID0gcm93cz8uWzBdPy52ZWxvY2lvdXNfYWR2aXNvcnlfbG9ja19ob2xkZXJcblxuICAgIHJldHVybiBob2xkZXIgPT09IG51bGwgfHwgaG9sZGVyID09PSB1bmRlZmluZWQgPyBudWxsIDogU3RyaW5nKGhvbGRlcilcbiAgfVxufVxuIl19