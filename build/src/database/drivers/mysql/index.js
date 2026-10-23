// @ts-check
import AlterTable from "./sql/alter-table.js";
import Base from "../base.js";
import Column from "./column.js";
import CreateDatabase from "./sql/create-database.js";
import CreateIndex from "./sql/create-index.js";
import CreateTable from "./sql/create-table.js";
import Delete from "./sql/delete.js";
import { digg } from "diggerize";
import DropDatabase from "./sql/drop-database.js";
import DropTable from "./sql/drop-table.js";
import Insert from "./sql/insert.js";
import Options from "./options.js";
import mysql from "mysql";
import query from "./query.js";
import QueryAbortedError from "../../query-aborted-error.js";
import QueryParser from "./query-parser.js";
import streamQuery from "./query-stream.js";
import RemoveIndex from "./sql/remove-index.js";
import Table from "./table.js";
import StructureSql from "./structure-sql.js";
import Upsert from "./sql/upsert.js";
import Update from "./sql/update.js";
import parseInnodbDeadlockSummary from "./deadlock-diagnostic-parser.js";
/**
 * Sentinel timeout (in seconds) used as the "block forever" value when a
 * caller asks for an indefinite advisory lock acquire. MySQL historically
 * accepted negative timeouts as "infinite", but MariaDB 10+ silently
 * returns NULL from `GET_LOCK` when the timeout is negative, so the
 * driver clamps to a comfortably large positive value (1 year ≫ any
 * realistic critical section) instead.
 */
const MYSQL_INDEFINITE_LOCK_TIMEOUT_SECONDS = 60 * 60 * 24 * 365;
const INNODB_DEADLOCK_CAPTURE_TIMEOUT_MS = 250;
export default class VelociousDatabaseDriversMysql extends Base {
    /** @type {import("mysql").Pool | undefined} */
    pool = undefined;
    /** @type {string | null} */
    _desiredSessionTimeZone = "+00:00";
    /** @type {string | null} */
    _currentSessionTimeZone = null;
    /**
     * Runs connect.
     * @returns {Promise<void>} - Resolves when complete.
     */
    async connect() {
        this.resetCurrentSessionTimeZone();
        this.pool = mysql.createPool(Object.assign({ connectionLimit: 1 }, this.connectArgs()));
        this.pool.on("error", this.onPoolError);
    }
    /**
     * On pool error.
     * @param {Error} error - Error from the connection attempt.
     */
    onPoolError = (error) => {
        console.error("Velocious / MySQL driver / Pool error", error);
    };
    /**
     * Runs close.
     * @returns {Promise<void>} - Resolves when complete.
     */
    async _close() {
        const pool = this.pool;
        if (!pool)
            return;
        await new Promise((resolve, reject) => {
            pool.end((error) => {
                if (error) {
                    reject(error);
                }
                else {
                    resolve(undefined);
                }
            });
        });
        this.pool = undefined;
        this.resetCurrentSessionTimeZone();
    }
    /**
     * Resets the MySQL session state after each logical pool checkout while
     * reusing the existing physical connection.
     * MySQL exposes open-ended session state (user variables, temporary tables,
     * prepared statements, `SET SESSION` changes), so the state must be cleared
     * before the logical pool entry is handed out again. `COM_CHANGE_USER`
     * performs a full session re-initialization on the server side — the same
     * state a fresh handshake would start with — without opening a new TCP
     * connection. That keeps checkouts isolated from each other while avoiding
     * a reconnect (handshake + auth + schema re-introspection) on every
     * operation. If the reset fails the physical session is closed instead, so
     * the next query reconnects on a fresh session as a safe fallback.
     * @returns {Promise<void>} - Resolves once the session state is reset.
     */
    async cleanupSessionStateAfterCheckout() {
        const pool = this.pool;
        if (!pool)
            return;
        try {
            const pooledConnection = await new Promise((resolve, reject) => {
                pool.getConnection((error, connection) => {
                    if (error)
                        reject(error instanceof Error ? error : new Error(`Failed to check out connection for session reset: ${error}`));
                    else
                        resolve(connection);
                });
            });
            try {
                await new Promise((resolve, reject) => {
                    pooledConnection.changeUser({ charset: "utf8mb4", timeout: 10000 }, ((/** @type {import("mysql").MysqlError} */ error) => {
                        if (error)
                            reject(error instanceof Error ? error : new Error(`MySQL session reset failed: ${error}`));
                        else
                            resolve(undefined);
                    }));
                });
            }
            finally {
                pooledConnection.release();
            }
            // The server re-initialized the session on this socket: user variables,
            // temporary tables, prepared statements, and session variables are gone,
            // and the session time zone must be re-established before the next query.
            this.resetCurrentSessionTimeZone();
        }
        catch (error) {
            // A failed reset leaves the session state unknown, so fall back to a
            // full physical disconnect: the next query reconnects on a fresh session.
            // The logical connection is still reusable afterwards.
            try {
                await this._close();
            }
            catch (closeError) {
                throw new AggregateError([error, closeError], "MySQL session reset failed and the physical disconnect fallback also failed", { cause: closeError });
            }
            throw error;
        }
    }
    /**
     * Runs set connection checkout name.
     * @param {string | undefined} name - Human-readable name for this active checkout.
     * @returns {Promise<void>} - Resolves when complete.
     */
    async setConnectionCheckoutName(name) {
        const previousName = this._connectionCheckoutName;
        await super.setConnectionCheckoutName(name);
        if (name === undefined) {
            if (previousName !== undefined) {
                await this.query("SET @velocious_connection_checkout_name = NULL", { logName: "Clear Connection Checkout Name", processListComment: false, sessionTimeZone: false });
            }
            return;
        }
        await this.query(`SET @velocious_connection_checkout_name = ${this.quote(name)}`, { logName: "Set Connection Checkout Name", processListComment: false, sessionTimeZone: false });
    }
    /**
     * Runs clear connection checkout name.
     * @returns {Promise<void>} - Resolves when complete.
     */
    async clearConnectionCheckoutName() {
        if (this._connectionCheckoutName !== undefined) {
            await this.query("SET @velocious_connection_checkout_name = NULL", { logName: "Clear Connection Checkout Name", processListComment: false, sessionTimeZone: false });
        }
        await super.clearConnectionCheckoutName();
    }
    /**
     * Hook before every query.
     * @param {string} _sql - SQL string.
     * @param {import("../base.js").QueryOptions} options - Query options.
     * @returns {Promise<void>} - Resolves when complete.
     */
    async beforeQuery(_sql, options) {
        if (options.sessionTimeZone !== false)
            await this.ensureSessionTimeZone();
    }
    /**
     * Gets the desired database session time zone for this connection context.
     * @returns {string | null} - Desired session time zone.
     */
    getDesiredSessionTimeZone() {
        return this._desiredSessionTimeZone;
    }
    /**
     * Sets the desired database session time zone without querying MySQL immediately.
     * @param {string | null} timeZone - Desired session time zone.
     */
    setDesiredSessionTimeZone(timeZone) {
        this._desiredSessionTimeZone = timeZone;
    }
    /**
     * Gets the database session time zone last confirmed through SET time_zone.
     * @returns {string | null} - Current known session time zone.
     */
    getCurrentSessionTimeZone() {
        return this._currentSessionTimeZone;
    }
    /**
     * Clears the current known database session time zone when the physical connection changes.
     */
    resetCurrentSessionTimeZone() {
        this._currentSessionTimeZone = null;
    }
    /**
     * Ensures MySQL has the desired session time zone before user SQL runs.
     * @returns {Promise<boolean>} - True when SET time_zone was executed.
     */
    async ensureSessionTimeZone() {
        const desiredSessionTimeZone = this.getDesiredSessionTimeZone();
        if (desiredSessionTimeZone === null || this.getCurrentSessionTimeZone() === desiredSessionTimeZone)
            return false;
        await this.setSessionTimeZone(desiredSessionTimeZone);
        return true;
    }
    /**
     * Sets the database session time zone if it changed from the last confirmed value.
     * @param {string} timeZone - Session time zone value accepted by MySQL.
     * @returns {Promise<boolean>} - True when SET time_zone was executed.
     */
    async setSessionTimeZone(timeZone) {
        if (this.getCurrentSessionTimeZone() === timeZone)
            return false;
        await this._queryActual(`SET time_zone = ${this.quote(timeZone)}`);
        this._currentSessionTimeZone = timeZone;
        return true;
    }
    /**
     * Runs connect args.
     * @returns {Record<string, ReturnType<typeof JSON.parse>>} - The connect args.
     */
    connectArgs() {
        const args = this.getArgs();
        const forward = ["database", "host", "password", "port"];
        /**
         * Connect args.
         * @type {Record<string, ReturnType<typeof JSON.parse>>} */
        const connectArgs = { charset: "utf8mb4", timezone: "Z" };
        for (const forwardValue of forward) {
            if (forwardValue in args)
                connectArgs[forwardValue] = digg(args, forwardValue);
        }
        if ("username" in args)
            connectArgs["user"] = args["username"];
        if ("charset" in args)
            connectArgs["charset"] = args["charset"];
        // Opt-in only. Lets a whole structure SQL dump run in one round-trip via
        // {@link execStructureScript}; off by default so ordinary queries keep rejecting
        // stacked statements.
        if ("multipleStatements" in args)
            connectArgs["multipleStatements"] = Boolean(digg(args, "multipleStatements"));
        return connectArgs;
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
        const createArgs = { tableData, driver: this };
        const createTable = new CreateTable(createArgs);
        return createTable.toSql();
    }
    /**
     * Runs current database.
     * @returns {Promise<string>} - Resolves with the current database.
     */
    async currentDatabase() {
        const rows = await this.query("SELECT DATABASE() AS db_name");
        return digg(rows, 0, "db_name");
    }
    /**
     * Runs disable foreign keys.
     * @returns {Promise<void>} - Resolves when complete.
     */
    async disableForeignKeys() {
        await this.query("SET FOREIGN_KEY_CHECKS = 0");
    }
    /**
     * Runs enable foreign keys.
     * @returns {Promise<void>} - Resolves when complete.
     */
    async enableForeignKeys() {
        await this.query("SET FOREIGN_KEY_CHECKS = 1");
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
     * Runs get type.
     * @returns {string} - The type.
     */
    getType() { return "mysql"; }
    /**
     * Whether this driver supports combining operations into one bulk `ALTER`.
     * @returns {boolean} - Whether bulk alter is supported.
     */
    supportsBulkAlter() { return true; }
    /**
     * Whether the bulk `ALTER` can also carry `ADD INDEX` clauses.
     * @returns {boolean} - Whether indexes can be added inside a bulk alter.
     */
    supportsBulkAlterIndexes() { return true; }
    /**
     * Runs retryable database error.
     * @param {Error} error - Error instance.
     * @returns {import("../base.js").RetryableDatabaseErrorResult} - Retry info.
     */
    retryableDatabaseError(error) {
        /** @type {Error | undefined} */
        let currentError = error;
        let shouldReconnect = false;
        while (currentError) {
            const errorCode = "code" in currentError && typeof currentError.code == "string" ? currentError.code : undefined;
            const message = currentError.message || "";
            if (errorCode == "ER_CHECKREAD" || message.includes("Record has changed since last read")) {
                return { retry: true, reconnect: false, waitMs: 50 };
            }
            // A deadlock or lock-wait-timeout aborts the whole transaction; it must be retried at the
            // transaction level (re-running the callback), not the query level, so flag it as such and
            // keep `retry` false so an in-transaction query does not retry against the dead transaction.
            if (errorCode == "ER_LOCK_DEADLOCK" || message.includes("ER_LOCK_DEADLOCK") || message.includes("Deadlock found")) {
                return { retry: false, reconnect: false, deadlock: true, contentionKind: "deadlock", waitMs: 50 };
            }
            if (errorCode == "ER_LOCK_WAIT_TIMEOUT" || message.includes("Lock wait timeout exceeded")) {
                return { retry: false, reconnect: false, deadlock: true, contentionKind: "lock-wait-timeout", waitMs: 50 };
            }
            shouldReconnect ||= (errorCode == "ECONNREFUSED" ||
                message.includes("ECONNREFUSED") ||
                message.includes("connect ECONNREFUSED") ||
                message.includes("PROTOCOL_CONNECTION_LOST") ||
                message.includes("Connection lost"));
            currentError = currentError.cause instanceof Error ? currentError.cause : undefined;
        }
        return {
            retry: shouldReconnect,
            reconnect: shouldReconnect,
            waitMs: 50
        };
    }
    /**
     * Adds a redacted, bounded excerpt from MySQL's latest InnoDB deadlock report. Capture uses a
     * separate short-lived connection so it cannot queue ahead of rollback or the next retry on this
     * driver's single-connection pool.
     * @param {import("../base.js").DeadlockRetryDiagnosticSnapshot} snapshot - Immutable retry snapshot.
     * @returns {Promise<Record<string, ReturnType<typeof JSON.parse>>>} - Safe diagnostic context.
     */
    async _deadlockDiagnosticContext(snapshot) {
        if (snapshot.contentionKind == "lock-wait-timeout")
            return { statusCapture: "not-applicable" };
        let status;
        try {
            status = await this._captureInnodbDeadlockStatus();
        }
        catch {
            return { statusCapture: "failed" };
        }
        return {
            innodbDeadlockSummary: this._innodbDeadlockSummary(status),
            statusCapture: "captured"
        };
    }
    /**
     * Captures SHOW ENGINE INNODB STATUS on a bounded throwaway connection.
     * @returns {Promise<string>} - Raw server status, retained only inside the redaction path.
     */
    async _captureInnodbDeadlockStatus() {
        const poolWithConfig = /** @type {{config?: {connectionConfig?: ReturnType<typeof JSON.parse>}} | undefined} */ (this.pool);
        const connectionConfig = poolWithConfig?.config?.connectionConfig;
        const captureConfig = connectionConfig || this.connectArgs();
        return await new Promise((resolve, reject) => {
            /** @type {import("mysql").Connection | undefined} */
            let connection;
            let settled = false;
            /**
             * Finishes the status capture once and destroys its temporary connection.
             * @param {Error | undefined} error - Capture error, when present.
             * @param {string} [status] - Captured status.
             * @returns {void}
             */
            const finish = (error, status = "") => {
                if (settled)
                    return;
                settled = true;
                clearTimeout(timeout);
                if (connection)
                    connection.destroy();
                if (error)
                    reject(error);
                else
                    resolve(status);
            };
            const timeout = setTimeout(() => finish(new Error("InnoDB status capture timed out")), INNODB_DEADLOCK_CAPTURE_TIMEOUT_MS);
            try {
                connection = mysql.createConnection(captureConfig);
                connection.on("error", (error) => finish(error));
                connection.query("SHOW ENGINE INNODB STATUS", (error, rows) => {
                    if (error) {
                        finish(error);
                        return;
                    }
                    const firstRow = Array.isArray(rows) ? rows[0] : undefined;
                    const status = firstRow && typeof firstRow.Status == "string" ? firstRow.Status : "";
                    finish(undefined, status);
                });
            }
            catch (error) {
                finish(error instanceof Error ? error : new Error("InnoDB status capture failed"));
            }
        });
    }
    /**
     * Extracts only fixed-format deadlock counters. The server report contains raw SQL, identifiers,
     * and physical record data, so no source text is ever included in an application diagnostic.
     * @param {string} status - SHOW ENGINE INNODB STATUS text.
     * @returns {{lockRecordsTruncated: boolean, sectionTruncated: boolean, transactionNodes: Array<{conflictingLocks: Array<{indexFingerprint: string, lockMode: string, state: string, tableFingerprint: string}>, locks: Array<{indexFingerprint: string, lockMode: string, state: string, tableFingerprint: string}>, ordinal: number}>, transactionNodesTruncated: boolean, transactions: number, victimTransaction: number | null}} - Structural deadlock summary.
     */
    _innodbDeadlockSummary(status) {
        return parseInnodbDeadlockSummary(status);
    }
    /**
     * Runs query actual.
     * @param {string} sql - SQL string.
     * @param {import("../base.js").QueryOptions} [options] - Query options (carries the optional abort signal).
     * @returns {Promise<import("../base.js").QueryResultType>} - Resolves with the query actual.
     */
    async _queryActual(sql, options = {}) {
        if (!this.pool)
            await this.connect();
        if (!this.pool)
            throw new Error("MySQL pool failed to initialize");
        try {
            return await query(this.pool, sql, { signal: options.signal });
        }
        catch (error) {
            // Preserve an abort as-is so the retry loop can recognise it as terminal
            // (wrapping it in a plain Error would lose the QueryAbortedError type).
            if (error instanceof QueryAbortedError) {
                if (error.connectionDestroyed)
                    this.resetCurrentSessionTimeZone();
                throw error;
            }
            // Re-throw to un-corrupt stacktrace
            if (error instanceof Error) {
                throw new Error(`Query failed: ${error.message}`, { cause: error });
            }
            else {
                throw new Error(`Query failed: ${error}`, { cause: error });
            }
        }
    }
    /**
     * Streams the rows of `sql` from a dedicated pooled connection using the MySQL cursor, so a
     * large result set is read incrementally instead of being buffered. Overrides the base
     * buffered fallback with true server-side streaming.
     * @param {string} sql - SQL string to stream.
     * @param {import("../base.js").QueryOptions} [options] - Query ownership options.
     * @yields {Record<string, unknown>} - The result rows, one at a time.
     */
    async *queryStream(sql, options = {}) {
        await this._waitForOperationLease(options.operationOwner);
        if (!this.pool)
            await this.connect();
        if (!this.pool)
            throw new Error("MySQL pool failed to initialize");
        const profileAttempt = this._startProfiledQueryAttempt(sql);
        let failed = true;
        try {
            yield* streamQuery(this.pool, sql);
            failed = false;
        }
        finally {
            this._finishProfiledQueryAttempt(profileAttempt, failed);
        }
    }
    /**
     * Executes a mutation with affected-row metadata.
     * @param {string} sql - Mutation SQL.
     * @returns {Promise<number>} - Affected row count.
     */
    async _affectedRowsActual(sql) {
        if (!this.pool)
            await this.connect();
        if (!this.pool)
            throw new Error("MySQL pool failed to initialize");
        const pool = this.pool;
        return await new Promise((resolve, reject) => {
            pool.query(sql, (error, result) => {
                if (error)
                    reject(error);
                else
                    resolve("affectedRows" in result ? result.affectedRows : 0);
            });
        });
    }
    /**
     * Executes a full multi-statement structure SQL script in one round-trip when the
     * connection was configured with `multipleStatements: true`. Runs on the pooled
     * connection so the caller's `SET FOREIGN_KEY_CHECKS = 0` applies. Returns false so
     * the caller runs statements individually when multi-statement queries are off.
     * @param {string} structureSql - Full multi-statement structure SQL.
     * @returns {Promise<boolean>} - Whether the script was executed as one batch.
     */
    async execStructureScript(structureSql) {
        if (!this.getArgs().multipleStatements)
            return false;
        // The batched pool call below bypasses Base#query, so re-run the same read-only
        // write guard the per-statement path applies before executing the dump.
        this._assertWritableQuery(structureSql);
        if (!this.pool)
            await this.connect();
        if (!this.pool)
            throw new Error("MySQL pool failed to initialize");
        const pool = this.pool;
        const profileAttempt = this._startProfiledQueryAttempt(structureSql);
        let failed = true;
        try {
            await new Promise((resolve, reject) => {
                pool.query(structureSql, (error) => {
                    if (error)
                        reject(error);
                    else
                        resolve(undefined);
                });
            });
            failed = false;
        }
        finally {
            this._finishProfiledQueryAttempt(profileAttempt, failed);
        }
        return true;
    }
    /**
     * Uses one multi-statement request only when the existing connection option
     * explicitly allows it; otherwise retains the base sequential behavior.
     * @param {Array<import("../base-table.js").default>} tables - Eligible tables.
     * @returns {Promise<void>} - Resolves when every table has been truncated.
     */
    async truncateTables(tables) {
        if (!this.getArgs().multipleStatements) {
            await super.truncateTables(tables);
            return;
        }
        const statements = tables.map((table) => `TRUNCATE TABLE ${this.quoteTable(table.getName())}`);
        await this.query(statements.join(";\n"));
    }
    /**
     * Runs query to sql.
     * @param {import("../../query/index.js").default} query - Query instance.
     * @returns {string} - SQL string.
     */
    queryToSql(query) { return new QueryParser({ query }).toSql(); }
    /**
     * Runs should set auto increment when primary key.
     * @returns {boolean} - Whether set auto increment when primary key.
     */
    shouldSetAutoIncrementWhenPrimaryKey() { return true; }
    supportsDefaultPrimaryKeyUUID() { return false; }
    supportsCrossDatabaseReferences() { return true; }
    /**
     * Runs escape.
     * @param {ReturnType<typeof JSON.parse>} value - Value to use.
     * @returns {ReturnType<typeof JSON.parse>} - The escape.
     */
    escape(value) {
        const escapedValueWithQuotes = this.pool
            ? this.pool.escape(this._convertValue(value))
            : mysql.escape(this._convertValue(value));
        return escapedValueWithQuotes.slice(1, escapedValueWithQuotes.length - 1);
    }
    /**
     * Runs quote.
     * @param {string} value - Value to use.
     * @returns {string} - The quote.
     */
    quote(value) {
        if (this.pool) {
            return this.pool.escape(this._convertValue(value));
        }
        return mysql.escape(this._convertValue(value));
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
     * MariaDB skips information-schema/SHOW reads for a table whose definition is being modified
     * by concurrent online DDL (ER_WARN_I_S_SKIPPED_TABLE). The build completes in seconds, so the
     * skip is transient contention that the bounded schema-metadata retry can outlast. Query
     * helpers wrap the driver error, so the code is searched through the cause chain.
     * @param {unknown} error - Error raised by a schema-metadata read.
     * @returns {boolean} - Whether the read hit concurrent-DDL metadata contention.
     */
    _isTransientSchemaMetadataError(error) {
        let currentError = /** @type {{code?: string, cause?: unknown} | undefined} */ (
        /** @type {unknown} */ (error));
        for (let depth = 0; depth < 5 && currentError; depth++) {
            if (currentError.code === "ER_WARN_I_S_SKIPPED_TABLE")
                return true;
            currentError = /** @type {{code?: string, cause?: unknown} | undefined} */ (
            /** @type {unknown} */ (currentError.cause));
        }
        return false;
    }
    /**
     * Runs get tables.
     * @returns {Promise<Array<import("../base-table.js").default>>} - Resolves with the tables.
     */
    async getTables() {
        return await this._cachedSchemaMetadata("tables", async () => {
            const result = await this.query("SHOW FULL TABLES");
            const tables = [];
            for (const row of result) {
                const table = new Table(this, /** @type {Record<string, string>} */ (row));
                tables.push(table);
            }
            return tables;
        });
    }
    /**
     * Reads column metadata for many tables in one query. `SHOW FULL COLUMNS` only
     * describes a single table, but `information_schema.COLUMNS` carries the same
     * fields, so the result is aliased to the shape `Column` already reads.
     *
     * `NULLIF(COLUMN_DEFAULT, 'NULL')` compensates for MariaDB reporting a SQL NULL
     * default as the literal string 'NULL', where `SHOW FULL COLUMNS` reports NULL.
     * Verified column-for-column against `SHOW FULL COLUMNS` on a 44-table MariaDB
     * schema; the only divergence was that sentinel.
     * @param {Array<import("../base-table.js").default>} tables - Tables to load columns for.
     * @returns {Promise<Map<string, Array<import("../base-column.js").default>>>} - Columns keyed by table name.
     */
    async batchTableColumns(tables) {
        /** @type {Map<string, Array<import("../base-column.js").default>>} */
        const columnsByTable = new Map();
        if (tables.length === 0)
            return columnsByTable;
        const tablesByName = new Map(tables.map((table) => [table.getName(), table]));
        const tableNamesSql = [...tablesByName.keys()].map((tableName) => this.quote(tableName)).join(", ");
        const rows = await this.query(`
      SELECT
        TABLE_NAME AS tableName,
        COLUMN_NAME AS Field,
        COLUMN_TYPE AS Type,
        IS_NULLABLE AS \`Null\`,
        COLUMN_KEY AS \`Key\`,
        NULLIF(COLUMN_DEFAULT, 'NULL') AS \`Default\`,
        EXTRA AS Extra,
        COLUMN_COMMENT AS Comment
      FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME IN (${tableNamesSql})
      ORDER BY TABLE_NAME, ORDINAL_POSITION
    `);
        for (const row of rows) {
            const tableName = /** @type {string} */ (row.tableName);
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
     * Runs structure sql.
     * @returns {Promise<string | null>} - Resolves with SQL string.
     */
    async structureSql() {
        return await this._cachedSchemaMetadata("structureSql", async () => await new StructureSql({ driver: this }).toSql());
    }
    /**
     * Runs last insert id.
     * @param {import("../base.js").QueryOptions} [options] - Query ownership options.
     * @returns {Promise<number>} - Resolves with the last insert id.
     */
    async lastInsertID(options = {}) {
        const result = await this.query("SELECT LAST_INSERT_ID() AS last_insert_id", options);
        return digg(result, 0, "last_insert_id");
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
    /**
     * Runs start transaction action.
     * @param {Pick<import("../base.js").QueryOptions, "operationOwner">} [options] - Transaction ownership.
     * @returns {Promise<void>} - Resolves when complete.
     */
    async _startTransactionAction(options = {}) {
        await this.query("START TRANSACTION", options);
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
    async _acquireAdvisoryLock(name, { timeoutMs } = {}) {
        const timeoutSeconds = typeof timeoutMs === "number" && timeoutMs >= 0
            ? Math.ceil(timeoutMs / 1000)
            : MYSQL_INDEFINITE_LOCK_TIMEOUT_SECONDS;
        const rows = await this.query(`SELECT GET_LOCK(${this.quote(name)}, ${timeoutSeconds}) AS velocious_advisory_lock_result`);
        const result = rows?.[0]?.velocious_advisory_lock_result;
        if (result === null || result === undefined) {
            throw new Error(`GET_LOCK returned NULL for advisory lock ${JSON.stringify(name)} (typically an out-of-memory or thread-killed condition)`);
        }
        return Number(result) === 1;
    }
    /**
     * Runs try acquire advisory lock.
     * @param {string} name - Lock name.
     * @returns {Promise<boolean>} - True if the lock was acquired, false if it was already held.
     */
    async _tryAcquireAdvisoryLock(name) {
        const rows = await this.query(`SELECT GET_LOCK(${this.quote(name)}, 0) AS velocious_advisory_lock_result`);
        const result = rows?.[0]?.velocious_advisory_lock_result;
        if (result === null || result === undefined) {
            throw new Error(`GET_LOCK returned NULL for advisory lock ${JSON.stringify(name)} (typically an out-of-memory or thread-killed condition)`);
        }
        return Number(result) === 1;
    }
    /**
     * Runs release advisory lock.
     * @param {string} name - Lock name.
     * @returns {Promise<boolean>} - True if the lock was held by this session and has now been released.
     */
    async _releaseAdvisoryLock(name) {
        const rows = await this.query(`SELECT RELEASE_LOCK(${this.quote(name)}) AS velocious_advisory_lock_result`, { retry: false });
        const result = rows?.[0]?.velocious_advisory_lock_result;
        return Number(result) === 1;
    }
    /**
    /**
     * Attributes the current holder of the named lock to its physical session
     * connection id via `IS_USED_LOCK(name)`, captured at the telemetry event
     * moment (best-effort; the caller guards failures).
     * @param {string} name - Lock name.
     * @returns {Promise<string | null>} - MariaDB/MySQL connection id of the holder, or null when no session holds the lock.
     */
    async advisoryLockHolderConnectionId(name) {
        const rows = await this.query(`SELECT IS_USED_LOCK(${this.quote(name)}) AS velocious_advisory_lock_holder`);
        const holder = rows?.[0]?.velocious_advisory_lock_holder;
        return holder === null || holder === undefined ? null : String(holder);
    }
    /**
     * Driver-native view for the base driver's `isAdvisoryLockHeld`, which
     * answers from the process-local tier first.
     * @param {string} name - Lock name.
     * @returns {Promise<boolean>} - True if any session currently holds the lock.
     */
    async _isAdvisoryLockHeldNative(name) {
        const rows = await this.query(`SELECT IS_USED_LOCK(${this.quote(name)}) AS velocious_advisory_lock_holder`);
        const holder = rows?.[0]?.velocious_advisory_lock_holder;
        return holder !== null && holder !== undefined;
    }
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiaW5kZXguanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi8uLi8uLi9zcmMvZGF0YWJhc2UvZHJpdmVycy9teXNxbC9pbmRleC5qcyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiQUFBQSxZQUFZO0FBRVosT0FBTyxVQUFVLE1BQU0sc0JBQXNCLENBQUE7QUFDN0MsT0FBTyxJQUFJLE1BQU0sWUFBWSxDQUFBO0FBQzdCLE9BQU8sTUFBTSxNQUFNLGFBQWEsQ0FBQTtBQUNoQyxPQUFPLGNBQWMsTUFBTSwwQkFBMEIsQ0FBQTtBQUNyRCxPQUFPLFdBQVcsTUFBTSx1QkFBdUIsQ0FBQTtBQUMvQyxPQUFPLFdBQVcsTUFBTSx1QkFBdUIsQ0FBQTtBQUMvQyxPQUFPLE1BQU0sTUFBTSxpQkFBaUIsQ0FBQTtBQUNwQyxPQUFPLEVBQUMsSUFBSSxFQUFDLE1BQU0sV0FBVyxDQUFBO0FBQzlCLE9BQU8sWUFBWSxNQUFNLHdCQUF3QixDQUFBO0FBQ2pELE9BQU8sU0FBUyxNQUFNLHFCQUFxQixDQUFBO0FBQzNDLE9BQU8sTUFBTSxNQUFNLGlCQUFpQixDQUFBO0FBQ3BDLE9BQU8sT0FBTyxNQUFNLGNBQWMsQ0FBQTtBQUNsQyxPQUFPLEtBQUssTUFBTSxPQUFPLENBQUE7QUFDekIsT0FBTyxLQUFLLE1BQU0sWUFBWSxDQUFBO0FBQzlCLE9BQU8saUJBQWlCLE1BQU0sOEJBQThCLENBQUE7QUFDNUQsT0FBTyxXQUFXLE1BQU0sbUJBQW1CLENBQUE7QUFDM0MsT0FBTyxXQUFXLE1BQU0sbUJBQW1CLENBQUE7QUFDM0MsT0FBTyxXQUFXLE1BQU0sdUJBQXVCLENBQUE7QUFDL0MsT0FBTyxLQUFLLE1BQU0sWUFBWSxDQUFBO0FBQzlCLE9BQU8sWUFBWSxNQUFNLG9CQUFvQixDQUFBO0FBQzdDLE9BQU8sTUFBTSxNQUFNLGlCQUFpQixDQUFBO0FBQ3BDLE9BQU8sTUFBTSxNQUFNLGlCQUFpQixDQUFBO0FBQ3BDLE9BQU8sMEJBQTBCLE1BQU0saUNBQWlDLENB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OEJBQThCLENBQUMsSUFBSTtRQUN2QyxNQUFNLElBQUksR0FBRyxNQUFNLElBQUksQ0FBQyxLQUFLLENBQUMsdUJBQXVCLElBQUksQ0FBQyxLQUFLLENBQUMsSUFBSSxDQUFDLHFDQUFxQyxDQUFDLENBQUE7UUFDM0csTUFBTSxNQUFNLEdBQUcsSUFBSSxFQUFFLENBQUMsQ0FBQyxDQUFDLEVBQUUsOEJBQThCLENBQUE7UUFFeEQsT0FBTyxNQUFNLEtBQUssSUFBSSxJQUFJLE1BQU0sS0FBSyxTQUFTLENBQUMsQ0FBQyxDQUFDLElBQUksQ0FBQyxDQUFDLENBQUMsTUFBTSxDQUFDLE1BQU0sQ0FBQyxDQUFBO0lBQ3hFLENBQUM7SUFFRDs7Ozs7T0FLRztJQUNILEtBQUssQ0FBQyx5QkFBeUIsQ0FBQyxJQUFJO1FBQ2xDLE1BQU0sSUFBSSxHQUFHLE1BQU0sSUFBSSxDQUFDLEtBQUssQ0FBQyx1QkFBdUIsSUFBSSxDQUFDLEtBQUssQ0FBQyxJQUFJLENBQUMscUNBQXFDLENBQUMsQ0FBQTtRQUMzRyxNQUFNLE1BQU0sR0FBRyxJQUFJLEVBQUUsQ0FBQyxDQUFDLENBQUMsRUFBRSw4QkFBOEIsQ0FBQTtRQUV4RCxPQUFPLE1BQU0sS0FBSyxJQUFJLElBQUksTUFBTSxLQUFLLFNBQVMsQ0FBQTtJQUNoRCxDQUFDO0NBQ0YiLCJzb3VyY2VzQ29udGVudCI6WyIvLyBAdHMtY2hlY2tcblxuaW1wb3J0IEFsdGVyVGFibGUgZnJvbSBcIi4vc3FsL2FsdGVyLXRhYmxlLmpzXCJcbmltcG9ydCBCYXNlIGZyb20gXCIuLi9iYXNlLmpzXCJcbmltcG9ydCBDb2x1bW4gZnJvbSBcIi4vY29sdW1uLmpzXCJcbmltcG9ydCBDcmVhdGVEYXRhYmFzZSBmcm9tIFwiLi9zcWwvY3JlYXRlLWRhdGFiYXNlLmpzXCJcbmltcG9ydCBDcmVhdGVJbmRleCBmcm9tIFwiLi9zcWwvY3JlYXRlLWluZGV4LmpzXCJcbmltcG9ydCBDcmVhdGVUYWJsZSBmcm9tIFwiLi9zcWwvY3JlYXRlLXRhYmxlLmpzXCJcbmltcG9ydCBEZWxldGUgZnJvbSBcIi4vc3FsL2RlbGV0ZS5qc1wiXG5pbXBvcnQge2RpZ2d9IGZyb20gXCJkaWdnZXJpemVcIlxuaW1wb3J0IERyb3BEYXRhYmFzZSBmcm9tIFwiLi9zcWwvZHJvcC1kYXRhYmFzZS5qc1wiXG5pbXBvcnQgRHJvcFRhYmxlIGZyb20gXCIuL3NxbC9kcm9wLXRhYmxlLmpzXCJcbmltcG9ydCBJbnNlcnQgZnJvbSBcIi4vc3FsL2luc2VydC5qc1wiXG5pbXBvcnQgT3B0aW9ucyBmcm9tIFwiLi9vcHRpb25zLmpzXCJcbmltcG9ydCBteXNxbCBmcm9tIFwibXlzcWxcIlxuaW1wb3J0IHF1ZXJ5IGZyb20gXCIuL3F1ZXJ5LmpzXCJcbmltcG9ydCBRdWVyeUFib3J0ZWRFcnJvciBmcm9tIFwiLi4vLi4vcXVlcnktYWJvcnRlZC1lcnJvci5qc1wiXG5pbXBvcnQgUXVlcnlQYXJzZXIgZnJvbSBcIi4vcXVlcnktcGFyc2VyLmpzXCJcbmltcG9ydCBzdHJlYW1RdWVyeSBmcm9tIFwiLi9xdWVyeS1zdHJlYW0uanNcIlxuaW1wb3J0IFJlbW92ZUluZGV4IGZyb20gXCIuL3NxbC9yZW1vdmUtaW5kZXguanNcIlxuaW1wb3J0IFRhYmxlIGZyb20gXCIuL3RhYmxlLmpzXCJcbmltcG9ydCBTdHJ1Y3R1cmVTcWwgZnJvbSBcIi4vc3RydWN0dXJlLXNxbC5qc1wiXG5pbXBvcnQgVXBzZXJ0IGZyb20gXCIuL3NxbC91cHNlcnQuanNcIlxuaW1wb3J0IFVwZGF0ZSBmcm9tIFwiLi9zcWwvdXBkYXRlLmpzXCJcbmltcG9ydCBwYXJzZUlubm9kYkRlYWRsb2NrU3VtbWFyeSBmcm9tIFwiLi9kZWFkbG9jay1kaWFnbm9zdGljLXBhcnNlci5qc1wiXG5cbi8qKlxuICogU2VudGluZWwgdGltZW91dCAoaW4gc2Vjb25kcykgdXNlZCBhcyB0aGUgXCJibG9jayBmb3JldmVyXCIgdmFsdWUgd2hlbiBhXG4gKiBjYWxsZXIgYXNrcyBmb3IgYW4gaW5kZWZpbml0ZSBhZHZpc29yeSBsb2NrIGFjcXVpcmUuIE15U1FMIGhpc3RvcmljYWxseVxuICogYWNjZXB0ZWQgbmVnYXRpdmUgdGltZW91dHMgYXMgXCJpbmZpbml0ZVwiLCBidXQgTWFyaWFEQiAxMCsgc2lsZW50bHlcbiAqIHJldHVybnMgTlVMTCBmcm9tIGBHRVRfTE9DS2Agd2hlbiB0aGUgdGltZW91dCBpcyBuZWdhdGl2ZSwgc28gdGhlXG4gKiBkcml2ZXIgY2xhbXBzIHRvIGEgY29tZm9ydGFibHkgbGFyZ2UgcG9zaXRpdmUgdmFsdWUgKDEgeWVhciDiiasgYW55XG4gKiByZWFsaXN0aWMgY3JpdGljYWwgc2VjdGlvbikgaW5zdGVhZC5cbiAqL1xuY29uc3QgTVlTUUxfSU5ERUZJTklURV9MT0NLX1RJTUVPVVRfU0VDT05EUyA9IDYwICogNjAgKiAyNCAqIDM2NVxuY29uc3QgSU5OT0RCX0RFQURMT0NLX0NBUFRVUkVfVElNRU9VVF9NUyA9IDI1MFxuXG5leHBvcnQgZGVmYXVsdCBjbGFzcyBWZWxvY2lvdXNEYXRhYmFzZURyaXZlcnNNeXNxbCBleHRlbmRzIEJhc2V7XG4gIC8qKiBAdHlwZSB7aW1wb3J0KFwibXlzcWxcIikuUG9vbCB8IHVuZGVmaW5lZH0gKi9cbiAgcG9vbCA9IHVuZGVmaW5lZFxuXG4gIC8qKiBAdHlwZSB7c3RyaW5nIHwgbnVsbH0gKi9cbiAgX2Rlc2lyZWRTZXNzaW9uVGltZVpvbmUgPSBcIiswMDowMFwiXG5cbiAgLyoqIEB0eXBlIHtzdHJpbmcgfCBudWxsfSAqL1xuICBfY3VycmVudFNlc3Npb25UaW1lWm9uZSA9IG51bGxcblxuICAvKipcbiAgICogUnVucyBjb25uZWN0LlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyB3aGVuIGNvbXBsZXRlLlxuICAgKi9cbiAgYXN5bmMgY29ubmVjdCgpIHtcbiAgICB0aGlzLnJlc2V0Q3VycmVudFNlc3Npb25UaW1lWm9uZSgpXG4gICAgdGhpcy5wb29sID0gbXlzcWwuY3JlYXRlUG9vbChPYmplY3QuYXNzaWduKHtjb25uZWN0aW9uTGltaXQ6IDF9LCB0aGlzLmNvbm5lY3RBcmdzKCkpKVxuICAgIHRoaXMucG9vbC5vbihcImVycm9yXCIsIHRoaXMub25Qb29sRXJyb3IpXG4gIH1cblxuICAvKipcbiAgICogT24gcG9vbCBlcnJvci5cbiAgICogQHBhcmFtIHtFcnJvcn0gZXJyb3IgLSBFcnJvciBmcm9tIHRoZSBjb25uZWN0aW9uIGF0dGVtcHQuXG4gICAqL1xuICBvblBvb2xFcnJvciA9IChlcnJvcikgPT4ge1xuICAgIGNvbnNvbGUuZXJyb3IoXCJWZWxvY2lvdXMgLyBNeVNRTCBkcml2ZXIgLyBQb29sIGVycm9yXCIsIGVycm9yKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgY2xvc2UuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIHdoZW4gY29tcGxldGUuXG4gICAqL1xuICBhc3luYyBfY2xvc2UoKSB7XG4gICAgY29uc3QgcG9vbCA9IHRoaXMucG9vbFxuXG4gICAgaWYgKCFwb29sKSByZXR1cm5cblxuICAgIGF3YWl0IG5ldyBQcm9taXNlKChyZXNvbHZlLCByZWplY3QpID0+IHtcbiAgICAgIHBvb2wuZW5kKChlcnJvcikgPT4ge1xuICAgICAgICBpZiAoZXJyb3IpIHtcbiAgICAgICAgICByZWplY3QoZXJyb3IpXG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgcmVzb2x2ZSh1bmRlZmluZWQpXG4gICAgICAgIH1cbiAgICAgIH0pXG4gICAgfSlcbiAgICB0aGlzLnBvb2wgPSB1bmRlZmluZWRcbiAgICB0aGlzLnJlc2V0Q3VycmVudFNlc3Npb25UaW1lWm9uZSgpXG4gIH1cblxuICAvKipcbiAgICogUmVzZXRzIHRoZSBNeVNRTCBzZXNzaW9uIHN0YXRlIGFmdGVyIGVhY2ggbG9naWNhbCBwb29sIGNoZWNrb3V0IHdoaWxlXG4gICAqIHJldXNpbmcgdGhlIGV4aXN0aW5nIHBoeXNpY2FsIGNvbm5lY3Rpb24uXG4gICAqIE15U1FMIGV4cG9zZXMgb3Blbi1lbmRlZCBzZXNzaW9uIHN0YXRlICh1c2VyIHZhcmlhYmxlcywgdGVtcG9yYXJ5IHRhYmxlcyxcbiAgICogcHJlcGFyZWQgc3RhdGVtZW50cywgYFNFVCBTRVNTSU9OYCBjaGFuZ2VzKSwgc28gdGhlIHN0YXRlIG11c3QgYmUgY2xlYXJlZFxuICAgKiBiZWZvcmUgdGhlIGxvZ2ljYWwgcG9vbCBlbnRyeSBpcyBoYW5kZWQgb3V0IGFnYWluLiBgQ09NX0NIQU5HRV9VU0VSYFxuICAgKiBwZXJmb3JtcyBhIGZ1bGwgc2Vzc2lvbiByZS1pbml0aWFsaXphdGlvbiBvbiB0aGUgc2VydmVyIHNpZGUg4oCUIHRoZSBzYW1lXG4gICAqIHN0YXRlIGEgZnJlc2ggaGFuZHNoYWtlIHdvdWxkIHN0YXJ0IHdpdGgg4oCUIHdpdGhvdXQgb3BlbmluZyBhIG5ldyBUQ1BcbiAgICogY29ubmVjdGlvbi4gVGhhdCBrZWVwcyBjaGVja291dHMgaXNvbGF0ZWQgZnJvbSBlYWNoIG90aGVyIHdoaWxlIGF2b2lkaW5nXG4gICAqIGEgcmVjb25uZWN0IChoYW5kc2hha2UgKyBhdXRoICsgc2NoZW1hIHJlLWludHJvc3BlY3Rpb24pIG9uIGV2ZXJ5XG4gICAqIG9wZXJhdGlvbi4gSWYgdGhlIHJlc2V0IGZhaWxzIHRoZSBwaHlzaWNhbCBzZXNzaW9uIGlzIGNsb3NlZCBpbnN0ZWFkLCBzb1xuICAgKiB0aGUgbmV4dCBxdWVyeSByZWNvbm5lY3RzIG9uIGEgZnJlc2ggc2Vzc2lvbiBhcyBhIHNhZmUgZmFsbGJhY2suXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIG9uY2UgdGhlIHNlc3Npb24gc3RhdGUgaXMgcmVzZXQuXG4gICAqL1xuICBhc3luYyBjbGVhbnVwU2Vzc2lvblN0YXRlQWZ0ZXJDaGVja291dCgpIHtcbiAgICBjb25zdCBwb29sID0gdGhpcy5wb29sXG5cbiAgICBpZiAoIXBvb2wpIHJldHVyblxuXG4gICAgdHJ5IHtcbiAgICAgIGNvbnN0IHBvb2xlZENvbm5lY3Rpb24gPSBhd2FpdCBuZXcgUHJvbWlzZSgocmVzb2x2ZSwgcmVqZWN0KSA9PiB7XG4gICAgICAgIHBvb2wuZ2V0Q29ubmVjdGlvbigoZXJyb3IsIGNvbm5lY3Rpb24pID0+IHtcbiAgICAgICAgICBpZiAoZXJyb3IpIHJlamVjdChlcnJvciBpbnN0YW5jZW9mIEVycm9yID8gZXJyb3IgOiBuZXcgRXJyb3IoYEZhaWxlZCB0byBjaGVjayBvdXQgY29ubmVjdGlvbiBmb3Igc2Vzc2lvbiByZXNldDogJHtlcnJvcn1gKSlcbiAgICAgICAgICBlbHNlIHJlc29sdmUoY29ubmVjdGlvbilcbiAgICAgICAgfSlcbiAgICAgIH0pXG5cbiAgICAgIHRyeSB7XG4gICAgICAgIGF3YWl0IG5ldyBQcm9taXNlKChyZXNvbHZlLCByZWplY3QpID0+IHtcbiAgICAgICAgICBwb29sZWRDb25uZWN0aW9uLmNoYW5nZVVzZXIoe2NoYXJzZXQ6IFwidXRmOG1iNFwiLCB0aW1lb3V0OiAxMDAwMH0sICgoLyoqIEB0eXBlIHtpbXBvcnQoXCJteXNxbFwiKS5NeXNxbEVycm9yfSAqLyBlcnJvcikgPT4ge1xuICAgICAgICAgICAgaWYgKGVycm9yKSByZWplY3QoZXJyb3IgaW5zdGFuY2VvZiBFcnJvciA/IGVycm9yIDogbmV3IEVycm9yKGBNeVNRTCBzZXNzaW9uIHJlc2V0IGZhaWxlZDogJHtlcnJvcn1gKSlcbiAgICAgICAgICAgIGVsc2UgcmVzb2x2ZSh1bmRlZmluZWQpXG4gICAgICAgICAgfSkpXG4gICAgICAgIH0pXG4gICAgICB9IGZpbmFsbHkge1xuICAgICAgICBwb29sZWRDb25uZWN0aW9uLnJlbGVhc2UoKVxuICAgICAgfVxuXG4gICAgICAvLyBUaGUgc2VydmVyIHJlLWluaXRpYWxpemVkIHRoZSBzZXNzaW9uIG9uIHRoaXMgc29ja2V0OiB1c2VyIHZhcmlhYmxlcyxcbiAgICAgIC8vIHRlbXBvcmFyeSB0YWJsZXMsIHByZXBhcmVkIHN0YXRlbWVudHMsIGFuZCBzZXNzaW9uIHZhcmlhYmxlcyBhcmUgZ29uZSxcbiAgICAgIC8vIGFuZCB0aGUgc2Vzc2lvbiB0aW1lIHpvbmUgbXVzdCBiZSByZS1lc3RhYmxpc2hlZCBiZWZvcmUgdGhlIG5leHQgcXVlcnkuXG4gICAgICB0aGlzLnJlc2V0Q3VycmVudFNlc3Npb25UaW1lWm9uZSgpXG4gICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgIC8vIEEgZmFpbGVkIHJlc2V0IGxlYXZlcyB0aGUgc2Vzc2lvbiBzdGF0ZSB1bmtub3duLCBzbyBmYWxsIGJhY2sgdG8gYVxuICAgICAgLy8gZnVsbCBwaHlzaWNhbCBkaXNjb25uZWN0OiB0aGUgbmV4dCBxdWVyeSByZWNvbm5lY3RzIG9uIGEgZnJlc2ggc2Vzc2lvbi5cbiAgICAgIC8vIFRoZSBsb2dpY2FsIGNvbm5lY3Rpb24gaXMgc3RpbGwgcmV1c2FibGUgYWZ0ZXJ3YXJkcy5cbiAgICAgIHRyeSB7XG4gICAgICAgIGF3YWl0IHRoaXMuX2Nsb3NlKClcbiAgICAgIH0gY2F0Y2ggKGNsb3NlRXJyb3IpIHtcbiAgICAgICAgdGhyb3cgbmV3IEFnZ3JlZ2F0ZUVycm9yKFtlcnJvciwgY2xvc2VFcnJvcl0sIFwiTXlTUUwgc2Vzc2lvbiByZXNldCBmYWlsZWQgYW5kIHRoZSBwaHlzaWNhbCBkaXNjb25uZWN0IGZhbGxiYWNrIGFsc28gZmFpbGVkXCIsIHtjYXVzZTogY2xvc2VFcnJvcn0pXG4gICAgICB9XG5cbiAgICAgIHRocm93IGVycm9yXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgc2V0IGNvbm5lY3Rpb24gY2hlY2tvdXQgbmFtZS5cbiAgICogQHBhcmFtIHtzdHJpbmcgfCB1bmRlZmluZWR9IG5hbWUgLSBIdW1hbi1yZWFkYWJsZSBuYW1lIGZvciB0aGlzIGFjdGl2ZSBjaGVja291dC5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgd2hlbiBjb21wbGV0ZS5cbiAgICovXG4gIGFzeW5jIHNldENvbm5lY3Rpb25DaGVja291dE5hbWUobmFtZSkge1xuICAgIGNvbnN0IHByZXZpb3VzTmFtZSA9IHRoaXMuX2Nvbm5lY3Rpb25DaGVja291dE5hbWVcblxuICAgIGF3YWl0IHN1cGVyLnNldENvbm5lY3Rpb25DaGVja291dE5hbWUobmFtZSlcblxuICAgIGlmIChuYW1lID09PSB1bmRlZmluZWQpIHtcbiAgICAgIGlmIChwcmV2aW91c05hbWUgIT09IHVuZGVmaW5lZCkge1xuICAgICAgICBhd2FpdCB0aGlzLnF1ZXJ5KFwiU0VUIEB2ZWxvY2lvdXNfY29ubmVjdGlvbl9jaGVja291dF9uYW1lID0gTlVMTFwiLCB7bG9nTmFtZTogXCJDbGVhciBDb25uZWN0aW9uIENoZWNrb3V0IE5hbWVcIiwgcHJvY2Vzc0xpc3RDb21tZW50OiBmYWxzZSwgc2Vzc2lvblRpbWVab25lOiBmYWxzZX0pXG4gICAgICB9XG5cbiAgICAgIHJldHVyblxuICAgIH1cblxuICAgIGF3YWl0IHRoaXMucXVlcnkoYFNFVCBAdmVsb2Npb3VzX2Nvbm5lY3Rpb25fY2hlY2tvdXRfbmFtZSA9ICR7dGhpcy5xdW90ZShuYW1lKX1gLCB7bG9nTmFtZTogXCJTZXQgQ29ubmVjdGlvbiBDaGVja291dCBOYW1lXCIsIHByb2Nlc3NMaXN0Q29tbWVudDogZmFsc2UsIHNlc3Npb25UaW1lWm9uZTogZmFsc2V9KVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgY2xlYXIgY29ubmVjdGlvbiBjaGVja291dCBuYW1lLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyB3aGVuIGNvbXBsZXRlLlxuICAgKi9cbiAgYXN5bmMgY2xlYXJDb25uZWN0aW9uQ2hlY2tvdXROYW1lKCkge1xuICAgIGlmICh0aGlzLl9jb25uZWN0aW9uQ2hlY2tvdXROYW1lICE9PSB1bmRlZmluZWQpIHtcbiAgICAgIGF3YWl0IHRoaXMucXVlcnkoXCJTRVQgQHZlbG9jaW91c19jb25uZWN0aW9uX2NoZWNrb3V0X25hbWUgPSBOVUxMXCIsIHtsb2dOYW1lOiBcIkNsZWFyIENvbm5lY3Rpb24gQ2hlY2tvdXQgTmFtZVwiLCBwcm9jZXNzTGlzdENvbW1lbnQ6IGZhbHNlLCBzZXNzaW9uVGltZVpvbmU6IGZhbHNlfSlcbiAgICB9XG5cbiAgICBhd2FpdCBzdXBlci5jbGVhckNvbm5lY3Rpb25DaGVja291dE5hbWUoKVxuICB9XG5cbiAgLyoqXG4gICAqIEhvb2sgYmVmb3JlIGV2ZXJ5IHF1ZXJ5LlxuICAgKiBAcGFyYW0ge3N0cmluZ30gX3NxbCAtIFNRTCBzdHJpbmcuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vYmFzZS5qc1wiKS5RdWVyeU9wdGlvbnN9IG9wdGlvbnMgLSBRdWVyeSBvcHRpb25zLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyB3aGVuIGNvbXBsZXRlLlxuICAgKi9cbiAgYXN5bmMgYmVmb3JlUXVlcnkoX3NxbCwgb3B0aW9ucykge1xuICAgIGlmIChvcHRpb25zLnNlc3Npb25UaW1lWm9uZSAhPT0gZmFsc2UpIGF3YWl0IHRoaXMuZW5zdXJlU2Vzc2lvblRpbWVab25lKClcbiAgfVxuXG4gIC8qKlxuICAgKiBHZXRzIHRoZSBkZXNpcmVkIGRhdGFiYXNlIHNlc3Npb24gdGltZSB6b25lIGZvciB0aGlzIGNvbm5lY3Rpb24gY29udGV4dC5cbiAgICogQHJldHVybnMge3N0cmluZyB8IG51bGx9IC0gRGVzaXJlZCBzZXNzaW9uIHRpbWUgem9uZS5cbiAgICovXG4gIGdldERlc2lyZWRTZXNzaW9uVGltZVpvbmUoKSB7XG4gICAgcmV0dXJuIHRoaXMuX2Rlc2lyZWRTZXNzaW9uVGltZVpvbmVcbiAgfVxuXG4gIC8qKlxuICAgKiBTZXRzIHRoZSBkZXNpcmVkIGRhdGFiYXNlIHNlc3Npb24gdGltZSB6b25lIHdpdGhvdXQgcXVlcnlpbmcgTXlTUUwgaW1tZWRpYXRlbHkuXG4gICAqIEBwYXJhbSB7c3RyaW5nIHwgbnVsbH0gdGltZVpvbmUgLSBEZXNpcmVkIHNlc3Npb24gdGltZSB6b25lLlxuICAgKi9cbiAgc2V0RGVzaXJlZFNlc3Npb25UaW1lWm9uZSh0aW1lWm9uZSkge1xuICAgIHRoaXMuX2Rlc2lyZWRTZXNzaW9uVGltZVpvbmUgPSB0aW1lWm9uZVxuICB9XG5cbiAgLyoqXG4gICAqIEdldHMgdGhlIGRhdGFiYXNlIHNlc3Npb24gdGltZSB6b25lIGxhc3QgY29uZmlybWVkIHRocm91Z2ggU0VUIHRpbWVfem9uZS5cbiAgICogQHJldHVybnMge3N0cmluZyB8IG51bGx9IC0gQ3VycmVudCBrbm93biBzZXNzaW9uIHRpbWUgem9uZS5cbiAgICovXG4gIGdldEN1cnJlbnRTZXNzaW9uVGltZVpvbmUoKSB7XG4gICAgcmV0dXJuIHRoaXMuX2N1cnJlbnRTZXNzaW9uVGltZVpvbmVcbiAgfVxuXG4gIC8qKlxuICAgKiBDbGVhcnMgdGhlIGN1cnJlbnQga25vd24gZGF0YWJhc2Ugc2Vzc2lvbiB0aW1lIHpvbmUgd2hlbiB0aGUgcGh5c2ljYWwgY29ubmVjdGlvbiBjaGFuZ2VzLlxuICAgKi9cbiAgcmVzZXRDdXJyZW50U2Vzc2lvblRpbWVab25lKCkge1xuICAgIHRoaXMuX2N1cnJlbnRTZXNzaW9uVGltZVpvbmUgPSBudWxsXG4gIH1cblxuICAvKipcbiAgICogRW5zdXJlcyBNeVNRTCBoYXMgdGhlIGRlc2lyZWQgc2Vzc2lvbiB0aW1lIHpvbmUgYmVmb3JlIHVzZXIgU1FMIHJ1bnMuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPGJvb2xlYW4+fSAtIFRydWUgd2hlbiBTRVQgdGltZV96b25lIHdhcyBleGVjdXRlZC5cbiAgICovXG4gIGFzeW5jIGVuc3VyZVNlc3Npb25UaW1lWm9uZSgpIHtcbiAgICBjb25zdCBkZXNpcmVkU2Vzc2lvblRpbWVab25lID0gdGhpcy5nZXREZXNpcmVkU2Vzc2lvblRpbWVab25lKClcblxuICAgIGlmIChkZXNpcmVkU2Vzc2lvblRpbWVab25lID09PSBudWxsIHx8IHRoaXMuZ2V0Q3VycmVudFNlc3Npb25UaW1lWm9uZSgpID09PSBkZXNpcmVkU2Vzc2lvblRpbWVab25lKSByZXR1cm4gZmFsc2VcblxuICAgIGF3YWl0IHRoaXMuc2V0U2Vzc2lvblRpbWVab25lKGRlc2lyZWRTZXNzaW9uVGltZVpvbmUpXG5cbiAgICByZXR1cm4gdHJ1ZVxuICB9XG5cbiAgLyoqXG4gICAqIFNldHMgdGhlIGRhdGFiYXNlIHNlc3Npb24gdGltZSB6b25lIGlmIGl0IGNoYW5nZWQgZnJvbSB0aGUgbGFzdCBjb25maXJtZWQgdmFsdWUuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSB0aW1lWm9uZSAtIFNlc3Npb24gdGltZSB6b25lIHZhbHVlIGFjY2VwdGVkIGJ5IE15U1FMLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxib29sZWFuPn0gLSBUcnVlIHdoZW4gU0VUIHRpbWVfem9uZSB3YXMgZXhlY3V0ZWQuXG4gICAqL1xuICBhc3luYyBzZXRTZXNzaW9uVGltZVpvbmUodGltZVpvbmUpIHtcbiAgICBpZiAodGhpcy5nZXRDdXJyZW50U2Vzc2lvblRpbWVab25lKCkgPT09IHRpbWVab25lKSByZXR1cm4gZmFsc2VcblxuICAgIGF3YWl0IHRoaXMuX3F1ZXJ5QWN0dWFsKGBTRVQgdGltZV96b25lID0gJHt0aGlzLnF1b3RlKHRpbWVab25lKX1gKVxuICAgIHRoaXMuX2N1cnJlbnRTZXNzaW9uVGltZVpvbmUgPSB0aW1lWm9uZVxuXG4gICAgcmV0dXJuIHRydWVcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGNvbm5lY3QgYXJncy5cbiAgICogQHJldHVybnMge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gLSBUaGUgY29ubmVjdCBhcmdzLlxuICAgKi9cbiAgY29ubmVjdEFyZ3MoKSB7XG4gICAgY29uc3QgYXJncyA9IHRoaXMuZ2V0QXJncygpXG4gICAgY29uc3QgZm9yd2FyZCA9IFtcImRhdGFiYXNlXCIsIFwiaG9zdFwiLCBcInBhc3N3b3JkXCIsIFwicG9ydFwiXVxuXG4gICAgLyoqXG4gICAgICogQ29ubmVjdCBhcmdzLlxuICAgICAqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59ICovXG4gICAgY29uc3QgY29ubmVjdEFyZ3MgPSB7Y2hhcnNldDogXCJ1dGY4bWI0XCIsIHRpbWV6b25lOiBcIlpcIn1cblxuICAgIGZvciAoY29uc3QgZm9yd2FyZFZhbHVlIG9mIGZvcndhcmQpIHtcbiAgICAgIGlmIChmb3J3YXJkVmFsdWUgaW4gYXJncykgY29ubmVjdEFyZ3NbZm9yd2FyZFZhbHVlXSA9IGRpZ2coYXJncywgZm9yd2FyZFZhbHVlKVxuICAgIH1cblxuICAgIGlmIChcInVzZXJuYW1lXCIgaW4gYXJncykgY29ubmVjdEFyZ3NbXCJ1c2VyXCJdID0gYXJnc1tcInVzZXJuYW1lXCJdXG4gICAgaWYgKFwiY2hhcnNldFwiIGluIGFyZ3MpIGNvbm5lY3RBcmdzW1wiY2hhcnNldFwiXSA9IGFyZ3NbXCJjaGFyc2V0XCJdXG4gICAgLy8gT3B0LWluIG9ubHkuIExldHMgYSB3aG9sZSBzdHJ1Y3R1cmUgU1FMIGR1bXAgcnVuIGluIG9uZSByb3VuZC10cmlwIHZpYVxuICAgIC8vIHtAbGluayBleGVjU3RydWN0dXJlU2NyaXB0fTsgb2ZmIGJ5IGRlZmF1bHQgc28gb3JkaW5hcnkgcXVlcmllcyBrZWVwIHJlamVjdGluZ1xuICAgIC8vIHN0YWNrZWQgc3RhdGVtZW50cy5cbiAgICBpZiAoXCJtdWx0aXBsZVN0YXRlbWVudHNcIiBpbiBhcmdzKSBjb25uZWN0QXJnc1tcIm11bHRpcGxlU3RhdGVtZW50c1wiXSA9IEJvb2xlYW4oZGlnZyhhcmdzLCBcIm11bHRpcGxlU3RhdGVtZW50c1wiKSlcblxuICAgIHJldHVybiBjb25uZWN0QXJnc1xuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgYWx0ZXIgdGFibGUgc3Fscy5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi8uLi90YWJsZS1kYXRhL2luZGV4LmpzXCIpLmRlZmF1bHR9IHRhYmxlRGF0YSAtIFRhYmxlIGRhdGEuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHN0cmluZ1tdPn0gLSBSZXNvbHZlcyB3aXRoIFNRTCBzdGF0ZW1lbnRzLlxuICAgKi9cbiAgYXN5bmMgYWx0ZXJUYWJsZVNRTHModGFibGVEYXRhKSB7XG4gICAgY29uc3QgYWx0ZXJBcmdzID0ge3RhYmxlRGF0YSwgZHJpdmVyOiB0aGlzfVxuICAgIGNvbnN0IGFsdGVyVGFibGUgPSBuZXcgQWx0ZXJUYWJsZShhbHRlckFyZ3MpXG5cbiAgICByZXR1cm4gYXdhaXQgYWx0ZXJUYWJsZS50b1NRTHMoKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgY3JlYXRlIGRhdGFiYXNlIHNxbC5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGRhdGFiYXNlTmFtZSAtIERhdGFiYXNlIG5hbWUuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBbYXJnc10gLSBPcHRpb25zIG9iamVjdC5cbiAgICogQHBhcmFtIHtib29sZWFufSBbYXJncy5pZk5vdEV4aXN0c10gLSBXaGV0aGVyIGlmIG5vdCBleGlzdHMuXG4gICAqIEByZXR1cm5zIHtzdHJpbmdbXX0gLSBTUUwgc3RhdGVtZW50cy5cbiAgICovXG4gIGNyZWF0ZURhdGFiYXNlU3FsKGRhdGFiYXNlTmFtZSwgYXJncykge1xuICAgIGNvbnN0IGNyZWF0ZUFyZ3MgPSBPYmplY3QuYXNzaWduKHtkYXRhYmFzZU5hbWUsIGRyaXZlcjogdGhpc30sIGFyZ3MpXG4gICAgY29uc3QgY3JlYXRlRGF0YWJhc2UgPSBuZXcgQ3JlYXRlRGF0YWJhc2UoY3JlYXRlQXJncylcblxuICAgIHJldHVybiBjcmVhdGVEYXRhYmFzZS50b1NxbCgpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBkcm9wIGRhdGFiYXNlIHNxbC5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGRhdGFiYXNlTmFtZSAtIERhdGFiYXNlIG5hbWUuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBbYXJnc10gLSBPcHRpb25zIG9iamVjdC5cbiAgICogQHBhcmFtIHtib29sZWFufSBbYXJncy5pZkV4aXN0c10gLSBXaGV0aGVyIGlmIGV4aXN0cy5cbiAgICogQHJldHVybnMge3N0cmluZ1tdfSAtIFNRTCBzdGF0ZW1lbnRzLlxuICAgKi9cbiAgZHJvcERhdGFiYXNlU3FsKGRhdGFiYXNlTmFtZSwgYXJncykge1xuICAgIGNvbnN0IGRyb3BBcmdzID0gT2JqZWN0LmFzc2lnbih7ZGF0YWJhc2VOYW1lLCBkcml2ZXI6IHRoaXN9LCBhcmdzKVxuICAgIGNvbnN0IGRyb3BEYXRhYmFzZSA9IG5ldyBEcm9wRGF0YWJhc2UoZHJvcEFyZ3MpXG5cbiAgICByZXR1cm4gZHJvcERhdGFiYXNlLnRvU3FsKClcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGNyZWF0ZSBpbmRleCBzcWxzLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL2Jhc2UuanNcIikuQ3JlYXRlSW5kZXhTcWxBcmdzfSBpbmRleERhdGEgLSBJbmRleCBkYXRhLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxzdHJpbmdbXT59IC0gUmVzb2x2ZXMgd2l0aCBTUUwgc3RhdGVtZW50cy5cbiAgICovXG4gIGFzeW5jIGNyZWF0ZUluZGV4U1FMcyhpbmRleERhdGEpIHtcbiAgICBjb25zdCBjcmVhdGVBcmdzID0gT2JqZWN0LmFzc2lnbih7ZHJpdmVyOiB0aGlzfSwgaW5kZXhEYXRhKVxuICAgIGNvbnN0IGNyZWF0ZUluZGV4ID0gbmV3IENyZWF0ZUluZGV4KGNyZWF0ZUFyZ3MpXG5cbiAgICByZXR1cm4gYXdhaXQgY3JlYXRlSW5kZXgudG9TUUxzKClcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHJlbW92ZSBpbmRleCBzcWxzLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL2Jhc2UuanNcIikuUmVtb3ZlSW5kZXhTcWxBcmdzfSBpbmRleERhdGEgLSBJbmRleCBkYXRhLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxzdHJpbmdbXT59IC0gUmVzb2x2ZXMgd2l0aCBTUUwgc3RhdGVtZW50cy5cbiAgICovXG4gIGFzeW5jIHJlbW92ZUluZGV4U1FMcyhpbmRleERhdGEpIHtcbiAgICBjb25zdCByZW1vdmVBcmdzID0gT2JqZWN0LmFzc2lnbih7ZHJpdmVyOiB0aGlzfSwgaW5kZXhEYXRhKVxuICAgIGNvbnN0IHJlbW92ZUluZGV4ID0gbmV3IFJlbW92ZUluZGV4KHJlbW92ZUFyZ3MpXG5cbiAgICByZXR1cm4gYXdhaXQgcmVtb3ZlSW5kZXgudG9TUUxzKClcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGNyZWF0ZSB0YWJsZSBzcWwuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vLi4vdGFibGUtZGF0YS9pbmRleC5qc1wiKS5kZWZhdWx0fSB0YWJsZURhdGEgLSBUYWJsZSBkYXRhLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxzdHJpbmdbXT59IC0gUmVzb2x2ZXMgd2l0aCBTUUwgc3RhdGVtZW50cy5cbiAgICovXG4gIGFzeW5jIGNyZWF0ZVRhYmxlU3FsKHRhYmxlRGF0YSkge1xuICAgIGNvbnN0IGNyZWF0ZUFyZ3MgPSB7dGFibGVEYXRhLCBkcml2ZXI6IHRoaXN9XG4gICAgY29uc3QgY3JlYXRlVGFibGUgPSBuZXcgQ3JlYXRlVGFibGUoY3JlYXRlQXJncylcblxuICAgIHJldHVybiBjcmVhdGVUYWJsZS50b1NxbCgpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBjdXJyZW50IGRhdGFiYXNlLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxzdHJpbmc+fSAtIFJlc29sdmVzIHdpdGggdGhlIGN1cnJlbnQgZGF0YWJhc2UuXG4gICAqL1xuICBhc3luYyBjdXJyZW50RGF0YWJhc2UoKSB7XG4gICAgY29uc3Qgcm93cyA9IGF3YWl0IHRoaXMucXVlcnkoXCJTRUxFQ1QgREFUQUJBU0UoKSBBUyBkYl9uYW1lXCIpXG5cbiAgICByZXR1cm4gZGlnZyhyb3dzLCAwLCBcImRiX25hbWVcIilcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGRpc2FibGUgZm9yZWlnbiBrZXlzLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyB3aGVuIGNvbXBsZXRlLlxuICAgKi9cbiAgYXN5bmMgZGlzYWJsZUZvcmVpZ25LZXlzKCkge1xuICAgIGF3YWl0IHRoaXMucXVlcnkoXCJTRVQgRk9SRUlHTl9LRVlfQ0hFQ0tTID0gMFwiKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZW5hYmxlIGZvcmVpZ24ga2V5cy5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgd2hlbiBjb21wbGV0ZS5cbiAgICovXG4gIGFzeW5jIGVuYWJsZUZvcmVpZ25LZXlzKCkge1xuICAgIGF3YWl0IHRoaXMucXVlcnkoXCJTRVQgRk9SRUlHTl9LRVlfQ0hFQ0tTID0gMVwiKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZHJvcCB0YWJsZSBzcWxzLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gdGFibGVOYW1lIC0gVGFibGUgbmFtZS5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9iYXNlLmpzXCIpLkRyb3BUYWJsZVNxbEFyZ3NUeXBlfSBbYXJnc10gLSBPcHRpb25zIG9iamVjdC5cbiAgICogQHJldHVybnMge1Byb21pc2U8c3RyaW5nW10+fSAtIFJlc29sdmVzIHdpdGggU1FMIHN0YXRlbWVudHMuXG4gICAqL1xuICBhc3luYyBkcm9wVGFibGVTUUxzKHRhYmxlTmFtZSwgYXJncyA9IHt9KSB7XG4gICAgY29uc3QgZHJvcEFyZ3MgPSBPYmplY3QuYXNzaWduKHt0YWJsZU5hbWUsIGRyaXZlcjogdGhpc30sIGFyZ3MpXG4gICAgY29uc3QgZHJvcFRhYmxlID0gbmV3IERyb3BUYWJsZShkcm9wQXJncylcblxuICAgIHJldHVybiBhd2FpdCBkcm9wVGFibGUudG9TUUxzKClcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGdldCB0eXBlLlxuICAgKiBAcmV0dXJucyB7c3RyaW5nfSAtIFRoZSB0eXBlLlxuICAgKi9cbiAgZ2V0VHlwZSgpIHsgcmV0dXJuIFwibXlzcWxcIiB9XG5cbiAgLyoqXG4gICAqIFdoZXRoZXIgdGhpcyBkcml2ZXIgc3VwcG9ydHMgY29tYmluaW5nIG9wZXJhdGlvbnMgaW50byBvbmUgYnVsayBgQUxURVJgLlxuICAgKiBAcmV0dXJucyB7Ym9vbGVhbn0gLSBXaGV0aGVyIGJ1bGsgYWx0ZXIgaXMgc3VwcG9ydGVkLlxuICAgKi9cbiAgc3VwcG9ydHNCdWxrQWx0ZXIoKSB7IHJldHVybiB0cnVlIH1cblxuICAvKipcbiAgICogV2hldGhlciB0aGUgYnVsayBgQUxURVJgIGNhbiBhbHNvIGNhcnJ5IGBBREQgSU5ERVhgIGNsYXVzZXMuXG4gICAqIEByZXR1cm5zIHtib29sZWFufSAtIFdoZXRoZXIgaW5kZXhlcyBjYW4gYmUgYWRkZWQgaW5zaWRlIGEgYnVsayBhbHRlci5cbiAgICovXG4gIHN1cHBvcnRzQnVsa0FsdGVySW5kZXhlcygpIHsgcmV0dXJuIHRydWUgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHJldHJ5YWJsZSBkYXRhYmFzZSBlcnJvci5cbiAgICogQHBhcmFtIHtFcnJvcn0gZXJyb3IgLSBFcnJvciBpbnN0YW5jZS5cbiAgICogQHJldHVybnMge2ltcG9ydChcIi4uL2Jhc2UuanNcIikuUmV0cnlhYmxlRGF0YWJhc2VFcnJvclJlc3VsdH0gLSBSZXRyeSBpbmZvLlxuICAgKi9cbiAgcmV0cnlhYmxlRGF0YWJhc2VFcnJvcihlcnJvcikge1xuICAgIC8qKiBAdHlwZSB7RXJyb3IgfCB1bmRlZmluZWR9ICovXG4gICAgbGV0IGN1cnJlbnRFcnJvciA9IGVycm9yXG4gICAgbGV0IHNob3VsZFJlY29ubmVjdCA9IGZhbHNlXG5cbiAgICB3aGlsZSAoY3VycmVudEVycm9yKSB7XG4gICAgICBjb25zdCBlcnJvckNvZGUgPSBcImNvZGVcIiBpbiBjdXJyZW50RXJyb3IgJiYgdHlwZW9mIGN1cnJlbnRFcnJvci5jb2RlID09IFwic3RyaW5nXCIgPyBjdXJyZW50RXJyb3IuY29kZSA6IHVuZGVmaW5lZFxuICAgICAgY29uc3QgbWVzc2FnZSA9IGN1cnJlbnRFcnJvci5tZXNzYWdlIHx8IFwiXCJcblxuICAgICAgaWYgKGVycm9yQ29kZSA9PSBcIkVSX0NIRUNLUkVBRFwiIHx8IG1lc3NhZ2UuaW5jbHVkZXMoXCJSZWNvcmQgaGFzIGNoYW5nZWQgc2luY2UgbGFzdCByZWFkXCIpKSB7XG4gICAgICAgIHJldHVybiB7cmV0cnk6IHRydWUsIHJlY29ubmVjdDogZmFsc2UsIHdhaXRNczogNTB9XG4gICAgICB9XG5cbiAgICAgIC8vIEEgZGVhZGxvY2sgb3IgbG9jay13YWl0LXRpbWVvdXQgYWJvcnRzIHRoZSB3aG9sZSB0cmFuc2FjdGlvbjsgaXQgbXVzdCBiZSByZXRyaWVkIGF0IHRoZVxuICAgICAgLy8gdHJhbnNhY3Rpb24gbGV2ZWwgKHJlLXJ1bm5pbmcgdGhlIGNhbGxiYWNrKSwgbm90IHRoZSBxdWVyeSBsZXZlbCwgc28gZmxhZyBpdCBhcyBzdWNoIGFuZFxuICAgICAgLy8ga2VlcCBgcmV0cnlgIGZhbHNlIHNvIGFuIGluLXRyYW5zYWN0aW9uIHF1ZXJ5IGRvZXMgbm90IHJldHJ5IGFnYWluc3QgdGhlIGRlYWQgdHJhbnNhY3Rpb24uXG4gICAgICBpZiAoZXJyb3JDb2RlID09IFwiRVJfTE9DS19ERUFETE9DS1wiIHx8IG1lc3NhZ2UuaW5jbHVkZXMoXCJFUl9MT0NLX0RFQURMT0NLXCIpIHx8IG1lc3NhZ2UuaW5jbHVkZXMoXCJEZWFkbG9jayBmb3VuZFwiKSkge1xuICAgICAgICByZXR1cm4ge3JldHJ5OiBmYWxzZSwgcmVjb25uZWN0OiBmYWxzZSwgZGVhZGxvY2s6IHRydWUsIGNvbnRlbnRpb25LaW5kOiBcImRlYWRsb2NrXCIsIHdhaXRNczogNTB9XG4gICAgICB9XG5cbiAgICAgIGlmIChlcnJvckNvZGUgPT0gXCJFUl9MT0NLX1dBSVRfVElNRU9VVFwiIHx8IG1lc3NhZ2UuaW5jbHVkZXMoXCJMb2NrIHdhaXQgdGltZW91dCBleGNlZWRlZFwiKSkge1xuICAgICAgICByZXR1cm4ge3JldHJ5OiBmYWxzZSwgcmVjb25uZWN0OiBmYWxzZSwgZGVhZGxvY2s6IHRydWUsIGNvbnRlbnRpb25LaW5kOiBcImxvY2std2FpdC10aW1lb3V0XCIsIHdhaXRNczogNTB9XG4gICAgICB9XG5cbiAgICAgIHNob3VsZFJlY29ubmVjdCB8fD0gKFxuICAgICAgICBlcnJvckNvZGUgPT0gXCJFQ09OTlJFRlVTRURcIiB8fFxuICAgICAgICBtZXNzYWdlLmluY2x1ZGVzKFwiRUNPTk5SRUZVU0VEXCIpIHx8XG4gICAgICAgIG1lc3NhZ2UuaW5jbHVkZXMoXCJjb25uZWN0IEVDT05OUkVGVVNFRFwiKSB8fFxuICAgICAgICBtZXNzYWdlLmluY2x1ZGVzKFwiUFJPVE9DT0xfQ09OTkVDVElPTl9MT1NUXCIpIHx8XG4gICAgICAgIG1lc3NhZ2UuaW5jbHVkZXMoXCJDb25uZWN0aW9uIGxvc3RcIilcbiAgICAgIClcblxuICAgICAgY3VycmVudEVycm9yID0gY3VycmVudEVycm9yLmNhdXNlIGluc3RhbmNlb2YgRXJyb3IgPyBjdXJyZW50RXJyb3IuY2F1c2UgOiB1bmRlZmluZWRcbiAgICB9XG5cbiAgICByZXR1cm4ge1xuICAgICAgcmV0cnk6IHNob3VsZFJlY29ubmVjdCxcbiAgICAgIHJlY29ubmVjdDogc2hvdWxkUmVjb25uZWN0LFxuICAgICAgd2FpdE1zOiA1MFxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBBZGRzIGEgcmVkYWN0ZWQsIGJvdW5kZWQgZXhjZXJwdCBmcm9tIE15U1FMJ3MgbGF0ZXN0IElubm9EQiBkZWFkbG9jayByZXBvcnQuIENhcHR1cmUgdXNlcyBhXG4gICAqIHNlcGFyYXRlIHNob3J0LWxpdmVkIGNvbm5lY3Rpb24gc28gaXQgY2Fubm90IHF1ZXVlIGFoZWFkIG9mIHJvbGxiYWNrIG9yIHRoZSBuZXh0IHJldHJ5IG9uIHRoaXNcbiAgICogZHJpdmVyJ3Mgc2luZ2xlLWNvbm5lY3Rpb24gcG9vbC5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9iYXNlLmpzXCIpLkRlYWRsb2NrUmV0cnlEaWFnbm9zdGljU25hcHNob3R9IHNuYXBzaG90IC0gSW1tdXRhYmxlIHJldHJ5IHNuYXBzaG90LlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj4+fSAtIFNhZmUgZGlhZ25vc3RpYyBjb250ZXh0LlxuICAgKi9cbiAgYXN5bmMgX2RlYWRsb2NrRGlhZ25vc3RpY0NvbnRleHQoc25hcHNob3QpIHtcbiAgICBpZiAoc25hcHNob3QuY29udGVudGlvbktpbmQgPT0gXCJsb2NrLXdhaXQtdGltZW91dFwiKSByZXR1cm4ge3N0YXR1c0NhcHR1cmU6IFwibm90LWFwcGxpY2FibGVcIn1cblxuICAgIGxldCBzdGF0dXNcblxuICAgIHRyeSB7XG4gICAgICBzdGF0dXMgPSBhd2FpdCB0aGlzLl9jYXB0dXJlSW5ub2RiRGVhZGxvY2tTdGF0dXMoKVxuICAgIH0gY2F0Y2gge1xuICAgICAgcmV0dXJuIHtzdGF0dXNDYXB0dXJlOiBcImZhaWxlZFwifVxuICAgIH1cblxuICAgIHJldHVybiB7XG4gICAgICBpbm5vZGJEZWFkbG9ja1N1bW1hcnk6IHRoaXMuX2lubm9kYkRlYWRsb2NrU3VtbWFyeShzdGF0dXMpLFxuICAgICAgc3RhdHVzQ2FwdHVyZTogXCJjYXB0dXJlZFwiXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIENhcHR1cmVzIFNIT1cgRU5HSU5FIElOTk9EQiBTVEFUVVMgb24gYSBib3VuZGVkIHRocm93YXdheSBjb25uZWN0aW9uLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxzdHJpbmc+fSAtIFJhdyBzZXJ2ZXIgc3RhdHVzLCByZXRhaW5lZCBvbmx5IGluc2lkZSB0aGUgcmVkYWN0aW9uIHBhdGguXG4gICAqL1xuICBhc3luYyBfY2FwdHVyZUlubm9kYkRlYWRsb2NrU3RhdHVzKCkge1xuICAgIGNvbnN0IHBvb2xXaXRoQ29uZmlnID0gLyoqIEB0eXBlIHt7Y29uZmlnPzoge2Nvbm5lY3Rpb25Db25maWc/OiBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn19IHwgdW5kZWZpbmVkfSAqLyAodGhpcy5wb29sKVxuICAgIGNvbnN0IGNvbm5lY3Rpb25Db25maWcgPSBwb29sV2l0aENvbmZpZz8uY29uZmlnPy5jb25uZWN0aW9uQ29uZmlnXG4gICAgY29uc3QgY2FwdHVyZUNvbmZpZyA9IGNvbm5lY3Rpb25Db25maWcgfHwgdGhpcy5jb25uZWN0QXJncygpXG5cbiAgICByZXR1cm4gYXdhaXQgbmV3IFByb21pc2UoKHJlc29sdmUsIHJlamVjdCkgPT4ge1xuICAgICAgLyoqIEB0eXBlIHtpbXBvcnQoXCJteXNxbFwiKS5Db25uZWN0aW9uIHwgdW5kZWZpbmVkfSAqL1xuICAgICAgbGV0IGNvbm5lY3Rpb25cbiAgICAgIGxldCBzZXR0bGVkID0gZmFsc2VcbiAgICAgIC8qKlxuICAgICAgICogRmluaXNoZXMgdGhlIHN0YXR1cyBjYXB0dXJlIG9uY2UgYW5kIGRlc3Ryb3lzIGl0cyB0ZW1wb3JhcnkgY29ubmVjdGlvbi5cbiAgICAgICAqIEBwYXJhbSB7RXJyb3IgfCB1bmRlZmluZWR9IGVycm9yIC0gQ2FwdHVyZSBlcnJvciwgd2hlbiBwcmVzZW50LlxuICAgICAgICogQHBhcmFtIHtzdHJpbmd9IFtzdGF0dXNdIC0gQ2FwdHVyZWQgc3RhdHVzLlxuICAgICAgICogQHJldHVybnMge3ZvaWR9XG4gICAgICAgKi9cbiAgICAgIGNvbnN0IGZpbmlzaCA9IChlcnJvciwgc3RhdHVzID0gXCJcIikgPT4ge1xuICAgICAgICBpZiAoc2V0dGxlZCkgcmV0dXJuXG4gICAgICAgIHNldHRsZWQgPSB0cnVlXG4gICAgICAgIGNsZWFyVGltZW91dCh0aW1lb3V0KVxuICAgICAgICBpZiAoY29ubmVjdGlvbikgY29ubmVjdGlvbi5kZXN0cm95KClcbiAgICAgICAgaWYgKGVycm9yKSByZWplY3QoZXJyb3IpXG4gICAgICAgIGVsc2UgcmVzb2x2ZShzdGF0dXMpXG4gICAgICB9XG4gICAgICBjb25zdCB0aW1lb3V0ID0gc2V0VGltZW91dCgoKSA9PiBmaW5pc2gobmV3IEVycm9yKFwiSW5ub0RCIHN0YXR1cyBjYXB0dXJlIHRpbWVkIG91dFwiKSksIElOTk9EQl9ERUFETE9DS19DQVBUVVJFX1RJTUVPVVRfTVMpXG5cbiAgICAgIHRyeSB7XG4gICAgICAgIGNvbm5lY3Rpb24gPSBteXNxbC5jcmVhdGVDb25uZWN0aW9uKGNhcHR1cmVDb25maWcpXG4gICAgICAgIGNvbm5lY3Rpb24ub24oXCJlcnJvclwiLCAoZXJyb3IpID0+IGZpbmlzaChlcnJvcikpXG4gICAgICAgIGNvbm5lY3Rpb24ucXVlcnkoXCJTSE9XIEVOR0lORSBJTk5PREIgU1RBVFVTXCIsIChlcnJvciwgcm93cykgPT4ge1xuICAgICAgICAgIGlmIChlcnJvcikge1xuICAgICAgICAgICAgZmluaXNoKGVycm9yKVxuICAgICAgICAgICAgcmV0dXJuXG4gICAgICAgICAgfVxuXG4gICAgICAgICAgY29uc3QgZmlyc3RSb3cgPSBBcnJheS5pc0FycmF5KHJvd3MpID8gcm93c1swXSA6IHVuZGVmaW5lZFxuICAgICAgICAgIGNvbnN0IHN0YXR1cyA9IGZpcnN0Um93ICYmIHR5cGVvZiBmaXJzdFJvdy5TdGF0dXMgPT0gXCJzdHJpbmdcIiA/IGZpcnN0Um93LlN0YXR1cyA6IFwiXCJcblxuICAgICAgICAgIGZpbmlzaCh1bmRlZmluZWQsIHN0YXR1cylcbiAgICAgICAgfSlcbiAgICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICAgIGZpbmlzaChlcnJvciBpbnN0YW5jZW9mIEVycm9yID8gZXJyb3IgOiBuZXcgRXJyb3IoXCJJbm5vREIgc3RhdHVzIGNhcHR1cmUgZmFpbGVkXCIpKVxuICAgICAgfVxuICAgIH0pXG4gIH1cblxuICAvKipcbiAgICogRXh0cmFjdHMgb25seSBmaXhlZC1mb3JtYXQgZGVhZGxvY2sgY291bnRlcnMuIFRoZSBzZXJ2ZXIgcmVwb3J0IGNvbnRhaW5zIHJhdyBTUUwsIGlkZW50aWZpZXJzLFxuICAgKiBhbmQgcGh5c2ljYWwgcmVjb3JkIGRhdGEsIHNvIG5vIHNvdXJjZSB0ZXh0IGlzIGV2ZXIgaW5jbHVkZWQgaW4gYW4gYXBwbGljYXRpb24gZGlhZ25vc3RpYy5cbiAgICogQHBhcmFtIHtzdHJpbmd9IHN0YXR1cyAtIFNIT1cgRU5HSU5FIElOTk9EQiBTVEFUVVMgdGV4dC5cbiAgICogQHJldHVybnMge3tsb2NrUmVjb3Jkc1RydW5jYXRlZDogYm9vbGVhbiwgc2VjdGlvblRydW5jYXRlZDogYm9vbGVhbiwgdHJhbnNhY3Rpb25Ob2RlczogQXJyYXk8e2NvbmZsaWN0aW5nTG9ja3M6IEFycmF5PHtpbmRleEZpbmdlcnByaW50OiBzdHJpbmcsIGxvY2tNb2RlOiBzdHJpbmcsIHN0YXRlOiBzdHJpbmcsIHRhYmxlRmluZ2VycHJpbnQ6IHN0cmluZ30+LCBsb2NrczogQXJyYXk8e2luZGV4RmluZ2VycHJpbnQ6IHN0cmluZywgbG9ja01vZGU6IHN0cmluZywgc3RhdGU6IHN0cmluZywgdGFibGVGaW5nZXJwcmludDogc3RyaW5nfT4sIG9yZGluYWw6IG51bWJlcn0+LCB0cmFuc2FjdGlvbk5vZGVzVHJ1bmNhdGVkOiBib29sZWFuLCB0cmFuc2FjdGlvbnM6IG51bWJlciwgdmljdGltVHJhbnNhY3Rpb246IG51bWJlciB8IG51bGx9fSAtIFN0cnVjdHVyYWwgZGVhZGxvY2sgc3VtbWFyeS5cbiAgICovXG4gIF9pbm5vZGJEZWFkbG9ja1N1bW1hcnkoc3RhdHVzKSB7XG4gICAgcmV0dXJuIHBhcnNlSW5ub2RiRGVhZGxvY2tTdW1tYXJ5KHN0YXR1cylcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHF1ZXJ5IGFjdHVhbC5cbiAgICogQHBhcmFtIHtzdHJpbmd9IHNxbCAtIFNRTCBzdHJpbmcuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vYmFzZS5qc1wiKS5RdWVyeU9wdGlvbnN9IFtvcHRpb25zXSAtIFF1ZXJ5IG9wdGlvbnMgKGNhcnJpZXMgdGhlIG9wdGlvbmFsIGFib3J0IHNpZ25hbCkuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPGltcG9ydChcIi4uL2Jhc2UuanNcIikuUXVlcnlSZXN1bHRUeXBlPn0gLSBSZXNvbHZlcyB3aXRoIHRoZSBxdWVyeSBhY3R1YWwuXG4gICAqL1xuICBhc3luYyBfcXVlcnlBY3R1YWwoc3FsLCBvcHRpb25zID0ge30pIHtcbiAgICBpZiAoIXRoaXMucG9vbCkgYXdhaXQgdGhpcy5jb25uZWN0KClcbiAgICBpZiAoIXRoaXMucG9vbCkgdGhyb3cgbmV3IEVycm9yKFwiTXlTUUwgcG9vbCBmYWlsZWQgdG8gaW5pdGlhbGl6ZVwiKVxuXG4gICAgdHJ5IHtcbiAgICAgIHJldHVybiBhd2FpdCBxdWVyeSh0aGlzLnBvb2wsIHNxbCwge3NpZ25hbDogb3B0aW9ucy5zaWduYWx9KVxuICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICAvLyBQcmVzZXJ2ZSBhbiBhYm9ydCBhcy1pcyBzbyB0aGUgcmV0cnkgbG9vcCBjYW4gcmVjb2duaXNlIGl0IGFzIHRlcm1pbmFsXG4gICAgICAvLyAod3JhcHBpbmcgaXQgaW4gYSBwbGFpbiBFcnJvciB3b3VsZCBsb3NlIHRoZSBRdWVyeUFib3J0ZWRFcnJvciB0eXBlKS5cbiAgICAgIGlmIChlcnJvciBpbnN0YW5jZW9mIFF1ZXJ5QWJvcnRlZEVycm9yKSB7XG4gICAgICAgIGlmIChlcnJvci5jb25uZWN0aW9uRGVzdHJveWVkKSB0aGlzLnJlc2V0Q3VycmVudFNlc3Npb25UaW1lWm9uZSgpXG4gICAgICAgIHRocm93IGVycm9yXG4gICAgICB9XG5cbiAgICAgIC8vIFJlLXRocm93IHRvIHVuLWNvcnJ1cHQgc3RhY2t0cmFjZVxuICAgICAgaWYgKGVycm9yIGluc3RhbmNlb2YgRXJyb3IpIHtcbiAgICAgICAgdGhyb3cgbmV3IEVycm9yKGBRdWVyeSBmYWlsZWQ6ICR7ZXJyb3IubWVzc2FnZX1gLCB7Y2F1c2U6IGVycm9yfSlcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIHRocm93IG5ldyBFcnJvcihgUXVlcnkgZmFpbGVkOiAke2Vycm9yfWAsIHtjYXVzZTogZXJyb3J9KVxuICAgICAgfVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBTdHJlYW1zIHRoZSByb3dzIG9mIGBzcWxgIGZyb20gYSBkZWRpY2F0ZWQgcG9vbGVkIGNvbm5lY3Rpb24gdXNpbmcgdGhlIE15U1FMIGN1cnNvciwgc28gYVxuICAgKiBsYXJnZSByZXN1bHQgc2V0IGlzIHJlYWQgaW5jcmVtZW50YWxseSBpbnN0ZWFkIG9mIGJlaW5nIGJ1ZmZlcmVkLiBPdmVycmlkZXMgdGhlIGJhc2VcbiAgICogYnVmZmVyZWQgZmFsbGJhY2sgd2l0aCB0cnVlIHNlcnZlci1zaWRlIHN0cmVhbWluZy5cbiAgICogQHBhcmFtIHtzdHJpbmd9IHNxbCAtIFNRTCBzdHJpbmcgdG8gc3RyZWFtLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL2Jhc2UuanNcIikuUXVlcnlPcHRpb25zfSBbb3B0aW9uc10gLSBRdWVyeSBvd25lcnNoaXAgb3B0aW9ucy5cbiAgICogQHlpZWxkcyB7UmVjb3JkPHN0cmluZywgdW5rbm93bj59IC0gVGhlIHJlc3VsdCByb3dzLCBvbmUgYXQgYSB0aW1lLlxuICAgKi9cbiAgYXN5bmMgKnF1ZXJ5U3RyZWFtKHNxbCwgb3B0aW9ucyA9IHt9KSB7XG4gICAgYXdhaXQgdGhpcy5fd2FpdEZvck9wZXJhdGlvbkxlYXNlKG9wdGlvbnMub3BlcmF0aW9uT3duZXIpXG5cbiAgICBpZiAoIXRoaXMucG9vbCkgYXdhaXQgdGhpcy5jb25uZWN0KClcbiAgICBpZiAoIXRoaXMucG9vbCkgdGhyb3cgbmV3IEVycm9yKFwiTXlTUUwgcG9vbCBmYWlsZWQgdG8gaW5pdGlhbGl6ZVwiKVxuXG4gICAgY29uc3QgcHJvZmlsZUF0dGVtcHQgPSB0aGlzLl9zdGFydFByb2ZpbGVkUXVlcnlBdHRlbXB0KHNxbClcbiAgICBsZXQgZmFpbGVkID0gdHJ1ZVxuXG4gICAgdHJ5IHtcbiAgICAgIHlpZWxkKiBzdHJlYW1RdWVyeSh0aGlzLnBvb2wsIHNxbClcbiAgICAgIGZhaWxlZCA9IGZhbHNlXG4gICAgfSBmaW5hbGx5IHtcbiAgICAgIHRoaXMuX2ZpbmlzaFByb2ZpbGVkUXVlcnlBdHRlbXB0KHByb2ZpbGVBdHRlbXB0LCBmYWlsZWQpXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIEV4ZWN1dGVzIGEgbXV0YXRpb24gd2l0aCBhZmZlY3RlZC1yb3cgbWV0YWRhdGEuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBzcWwgLSBNdXRhdGlvbiBTUUwuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPG51bWJlcj59IC0gQWZmZWN0ZWQgcm93IGNvdW50LlxuICAgKi9cbiAgYXN5bmMgX2FmZmVjdGVkUm93c0FjdHVhbChzcWwpIHtcbiAgICBpZiAoIXRoaXMucG9vbCkgYXdhaXQgdGhpcy5jb25uZWN0KClcbiAgICBpZiAoIXRoaXMucG9vbCkgdGhyb3cgbmV3IEVycm9yKFwiTXlTUUwgcG9vbCBmYWlsZWQgdG8gaW5pdGlhbGl6ZVwiKVxuICAgIGNvbnN0IHBvb2wgPSB0aGlzLnBvb2xcblxuICAgIHJldHVybiBhd2FpdCBuZXcgUHJvbWlzZSgocmVzb2x2ZSwgcmVqZWN0KSA9PiB7XG4gICAgICBwb29sLnF1ZXJ5KHNxbCwgKGVycm9yLCByZXN1bHQpID0+IHtcbiAgICAgICAgaWYgKGVycm9yKSByZWplY3QoZXJyb3IpXG4gICAgICAgIGVsc2UgcmVzb2x2ZShcImFmZmVjdGVkUm93c1wiIGluIHJlc3VsdCA/IHJlc3VsdC5hZmZlY3RlZFJvd3MgOiAwKVxuICAgICAgfSlcbiAgICB9KVxuICB9XG5cbiAgLyoqXG4gICAqIEV4ZWN1dGVzIGEgZnVsbCBtdWx0aS1zdGF0ZW1lbnQgc3RydWN0dXJlIFNRTCBzY3JpcHQgaW4gb25lIHJvdW5kLXRyaXAgd2hlbiB0aGVcbiAgICogY29ubmVjdGlvbiB3YXMgY29uZmlndXJlZCB3aXRoIGBtdWx0aXBsZVN0YXRlbWVudHM6IHRydWVgLiBSdW5zIG9uIHRoZSBwb29sZWRcbiAgICogY29ubmVjdGlvbiBzbyB0aGUgY2FsbGVyJ3MgYFNFVCBGT1JFSUdOX0tFWV9DSEVDS1MgPSAwYCBhcHBsaWVzLiBSZXR1cm5zIGZhbHNlIHNvXG4gICAqIHRoZSBjYWxsZXIgcnVucyBzdGF0ZW1lbnRzIGluZGl2aWR1YWxseSB3aGVuIG11bHRpLXN0YXRlbWVudCBxdWVyaWVzIGFyZSBvZmYuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBzdHJ1Y3R1cmVTcWwgLSBGdWxsIG11bHRpLXN0YXRlbWVudCBzdHJ1Y3R1cmUgU1FMLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxib29sZWFuPn0gLSBXaGV0aGVyIHRoZSBzY3JpcHQgd2FzIGV4ZWN1dGVkIGFzIG9uZSBiYXRjaC5cbiAgICovXG4gIGFzeW5jIGV4ZWNTdHJ1Y3R1cmVTY3JpcHQoc3RydWN0dXJlU3FsKSB7XG4gICAgaWYgKCF0aGlzLmdldEFyZ3MoKS5tdWx0aXBsZVN0YXRlbWVudHMpIHJldHVybiBmYWxzZVxuXG4gICAgLy8gVGhlIGJhdGNoZWQgcG9vbCBjYWxsIGJlbG93IGJ5cGFzc2VzIEJhc2UjcXVlcnksIHNvIHJlLXJ1biB0aGUgc2FtZSByZWFkLW9ubHlcbiAgICAvLyB3cml0ZSBndWFyZCB0aGUgcGVyLXN0YXRlbWVudCBwYXRoIGFwcGxpZXMgYmVmb3JlIGV4ZWN1dGluZyB0aGUgZHVtcC5cbiAgICB0aGlzLl9hc3NlcnRXcml0YWJsZVF1ZXJ5KHN0cnVjdHVyZVNxbClcblxuICAgIGlmICghdGhpcy5wb29sKSBhd2FpdCB0aGlzLmNvbm5lY3QoKVxuICAgIGlmICghdGhpcy5wb29sKSB0aHJvdyBuZXcgRXJyb3IoXCJNeVNRTCBwb29sIGZhaWxlZCB0byBpbml0aWFsaXplXCIpXG5cbiAgICBjb25zdCBwb29sID0gdGhpcy5wb29sXG4gICAgY29uc3QgcHJvZmlsZUF0dGVtcHQgPSB0aGlzLl9zdGFydFByb2ZpbGVkUXVlcnlBdHRlbXB0KHN0cnVjdHVyZVNxbClcbiAgICBsZXQgZmFpbGVkID0gdHJ1ZVxuXG4gICAgdHJ5IHtcbiAgICAgIGF3YWl0IG5ldyBQcm9taXNlKChyZXNvbHZlLCByZWplY3QpID0+IHtcbiAgICAgICAgcG9vbC5xdWVyeShzdHJ1Y3R1cmVTcWwsIChlcnJvcikgPT4ge1xuICAgICAgICAgIGlmIChlcnJvcikgcmVqZWN0KGVycm9yKVxuICAgICAgICAgIGVsc2UgcmVzb2x2ZSh1bmRlZmluZWQpXG4gICAgICAgIH0pXG4gICAgICB9KVxuICAgICAgZmFpbGVkID0gZmFsc2VcbiAgICB9IGZpbmFsbHkge1xuICAgICAgdGhpcy5fZmluaXNoUHJvZmlsZWRRdWVyeUF0dGVtcHQocHJvZmlsZUF0dGVtcHQsIGZhaWxlZClcbiAgICB9XG5cbiAgICByZXR1cm4gdHJ1ZVxuICB9XG5cbiAgLyoqXG4gICAqIFVzZXMgb25lIG11bHRpLXN0YXRlbWVudCByZXF1ZXN0IG9ubHkgd2hlbiB0aGUgZXhpc3RpbmcgY29ubmVjdGlvbiBvcHRpb25cbiAgICogZXhwbGljaXRseSBhbGxvd3MgaXQ7IG90aGVyd2lzZSByZXRhaW5zIHRoZSBiYXNlIHNlcXVlbnRpYWwgYmVoYXZpb3IuXG4gICAqIEBwYXJhbSB7QXJyYXk8aW1wb3J0KFwiLi4vYmFzZS10YWJsZS5qc1wiKS5kZWZhdWx0Pn0gdGFibGVzIC0gRWxpZ2libGUgdGFibGVzLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyB3aGVuIGV2ZXJ5IHRhYmxlIGhhcyBiZWVuIHRydW5jYXRlZC5cbiAgICovXG4gIGFzeW5jIHRydW5jYXRlVGFibGVzKHRhYmxlcykge1xuICAgIGlmICghdGhpcy5nZXRBcmdzKCkubXVsdGlwbGVTdGF0ZW1lbnRzKSB7XG4gICAgICBhd2FpdCBzdXBlci50cnVuY2F0ZVRhYmxlcyh0YWJsZXMpXG4gICAgICByZXR1cm5cbiAgICB9XG5cbiAgICBjb25zdCBzdGF0ZW1lbnRzID0gdGFibGVzLm1hcCgodGFibGUpID0+IGBUUlVOQ0FURSBUQUJMRSAke3RoaXMucXVvdGVUYWJsZSh0YWJsZS5nZXROYW1lKCkpfWApXG5cbiAgICBhd2FpdCB0aGlzLnF1ZXJ5KHN0YXRlbWVudHMuam9pbihcIjtcXG5cIikpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBxdWVyeSB0byBzcWwuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vLi4vcXVlcnkvaW5kZXguanNcIikuZGVmYXVsdH0gcXVlcnkgLSBRdWVyeSBpbnN0YW5jZS5cbiAgICogQHJldHVybnMge3N0cmluZ30gLSBTUUwgc3RyaW5nLlxuICAgKi9cbiAgcXVlcnlUb1NxbChxdWVyeSkgeyByZXR1cm4gbmV3IFF1ZXJ5UGFyc2VyKHtxdWVyeX0pLnRvU3FsKCkgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHNob3VsZCBzZXQgYXV0byBpbmNyZW1lbnQgd2hlbiBwcmltYXJ5IGtleS5cbiAgICogQHJldHVybnMge2Jvb2xlYW59IC0gV2hldGhlciBzZXQgYXV0byBpbmNyZW1lbnQgd2hlbiBwcmltYXJ5IGtleS5cbiAgICovXG4gIHNob3VsZFNldEF1dG9JbmNyZW1lbnRXaGVuUHJpbWFyeUtleSgpIHsgcmV0dXJuIHRydWUgfVxuICBzdXBwb3J0c0RlZmF1bHRQcmltYXJ5S2V5VVVJRCgpIHsgcmV0dXJuIGZhbHNlIH1cbiAgc3VwcG9ydHNDcm9zc0RhdGFiYXNlUmVmZXJlbmNlcygpIHsgcmV0dXJuIHRydWUgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGVzY2FwZS5cbiAgICogQHBhcmFtIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gdmFsdWUgLSBWYWx1ZSB0byB1c2UuXG4gICAqIEByZXR1cm5zIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gLSBUaGUgZXNjYXBlLlxuICAgKi9cbiAgZXNjYXBlKHZhbHVlKSB7XG4gICAgY29uc3QgZXNjYXBlZFZhbHVlV2l0aFF1b3RlcyA9IHRoaXMucG9vbFxuICAgICAgPyB0aGlzLnBvb2wuZXNjYXBlKHRoaXMuX2NvbnZlcnRWYWx1ZSh2YWx1ZSkpXG4gICAgICA6IG15c3FsLmVzY2FwZSh0aGlzLl9jb252ZXJ0VmFsdWUodmFsdWUpKVxuXG4gICAgcmV0dXJuIGVzY2FwZWRWYWx1ZVdpdGhRdW90ZXMuc2xpY2UoMSwgZXNjYXBlZFZhbHVlV2l0aFF1b3Rlcy5sZW5ndGggLSAxKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgcXVvdGUuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSB2YWx1ZSAtIFZhbHVlIHRvIHVzZS5cbiAgICogQHJldHVybnMge3N0cmluZ30gLSBUaGUgcXVvdGUuXG4gICAqL1xuICBxdW90ZSh2YWx1ZSkge1xuICAgIGlmICh0aGlzLnBvb2wpIHtcbiAgICAgIHJldHVybiB0aGlzLnBvb2wuZXNjYXBlKHRoaXMuX2NvbnZlcnRWYWx1ZSh2YWx1ZSkpXG4gICAgfVxuXG4gICAgcmV0dXJuIG15c3FsLmVzY2FwZSh0aGlzLl9jb252ZXJ0VmFsdWUodmFsdWUpKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZGVsZXRlIHNxbC5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9iYXNlLmpzXCIpLkRlbGV0ZVNxbEFyZ3NUeXBlfSBhcmdzIC0gT3B0aW9ucyBvYmplY3QuXG4gICAqIEByZXR1cm5zIHtzdHJpbmd9IC0gU1FMIHN0cmluZy5cbiAgICovXG4gIGRlbGV0ZVNxbCh7dGFibGVOYW1lLCBjb25kaXRpb25zfSkge1xuICAgIGNvbnN0IGRlbGV0ZUluc3RydWN0aW9uID0gbmV3IERlbGV0ZSh7Y29uZGl0aW9ucywgZHJpdmVyOiB0aGlzLCB0YWJsZU5hbWV9KVxuXG4gICAgcmV0dXJuIGRlbGV0ZUluc3RydWN0aW9uLnRvU3FsKClcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGluc2VydCBzcWwuXG4gICAqIEBhYnN0cmFjdFxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL2Jhc2UuanNcIikuSW5zZXJ0U3FsQXJnc1R5cGV9IGFyZ3MgLSBPcHRpb25zIG9iamVjdC5cbiAgICogQHJldHVybnMge3N0cmluZ30gLSBTUUwgc3RyaW5nLlxuICAgKi9cbiAgaW5zZXJ0U3FsKGFyZ3MpIHtcbiAgICBjb25zdCBpbnNlcnRBcmdzID0gT2JqZWN0LmFzc2lnbih7ZHJpdmVyOiB0aGlzfSwgYXJncylcbiAgICBjb25zdCBpbnNlcnQgPSBuZXcgSW5zZXJ0KGluc2VydEFyZ3MpXG5cbiAgICByZXR1cm4gaW5zZXJ0LnRvU3FsKClcbiAgfVxuXG4gIC8qKlxuICAgKiBNYXJpYURCIHNraXBzIGluZm9ybWF0aW9uLXNjaGVtYS9TSE9XIHJlYWRzIGZvciBhIHRhYmxlIHdob3NlIGRlZmluaXRpb24gaXMgYmVpbmcgbW9kaWZpZWRcbiAgICogYnkgY29uY3VycmVudCBvbmxpbmUgRERMIChFUl9XQVJOX0lfU19TS0lQUEVEX1RBQkxFKS4gVGhlIGJ1aWxkIGNvbXBsZXRlcyBpbiBzZWNvbmRzLCBzbyB0aGVcbiAgICogc2tpcCBpcyB0cmFuc2llbnQgY29udGVudGlvbiB0aGF0IHRoZSBib3VuZGVkIHNjaGVtYS1tZXRhZGF0YSByZXRyeSBjYW4gb3V0bGFzdC4gUXVlcnlcbiAgICogaGVscGVycyB3cmFwIHRoZSBkcml2ZXIgZXJyb3IsIHNvIHRoZSBjb2RlIGlzIHNlYXJjaGVkIHRocm91Z2ggdGhlIGNhdXNlIGNoYWluLlxuICAgKiBAcGFyYW0ge3Vua25vd259IGVycm9yIC0gRXJyb3IgcmFpc2VkIGJ5IGEgc2NoZW1hLW1ldGFkYXRhIHJlYWQuXG4gICAqIEByZXR1cm5zIHtib29sZWFufSAtIFdoZXRoZXIgdGhlIHJlYWQgaGl0IGNvbmN1cnJlbnQtRERMIG1ldGFkYXRhIGNvbnRlbnRpb24uXG4gICAqL1xuICBfaXNUcmFuc2llbnRTY2hlbWFNZXRhZGF0YUVycm9yKGVycm9yKSB7XG4gICAgbGV0IGN1cnJlbnRFcnJvciA9IC8qKiBAdHlwZSB7e2NvZGU/OiBzdHJpbmcsIGNhdXNlPzogdW5rbm93bn0gfCB1bmRlZmluZWR9ICovIChcbiAgICAgIC8qKiBAdHlwZSB7dW5rbm93bn0gKi8gKGVycm9yKVxuICAgIClcblxuICAgIGZvciAobGV0IGRlcHRoID0gMDsgZGVwdGggPCA1ICYmIGN1cnJlbnRFcnJvcjsgZGVwdGgrKykge1xuICAgICAgaWYgKGN1cnJlbnRFcnJvci5jb2RlID09PSBcIkVSX1dBUk5fSV9TX1NLSVBQRURfVEFCTEVcIikgcmV0dXJuIHRydWVcbiAgICAgIGN1cnJlbnRFcnJvciA9IC8qKiBAdHlwZSB7e2NvZGU/OiBzdHJpbmcsIGNhdXNlPzogdW5rbm93bn0gfCB1bmRlZmluZWR9ICovIChcbiAgICAgICAgLyoqIEB0eXBlIHt1bmtub3dufSAqLyAoY3VycmVudEVycm9yLmNhdXNlKVxuICAgICAgKVxuICAgIH1cblxuICAgIHJldHVybiBmYWxzZVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZ2V0IHRhYmxlcy5cbiAgICogQHJldHVybnMge1Byb21pc2U8QXJyYXk8aW1wb3J0KFwiLi4vYmFzZS10YWJsZS5qc1wiKS5kZWZhdWx0Pj59IC0gUmVzb2x2ZXMgd2l0aCB0aGUgdGFibGVzLlxuICAgKi9cbiAgYXN5bmMgZ2V0VGFibGVzKCkge1xuICAgIHJldHVybiBhd2FpdCB0aGlzLl9jYWNoZWRTY2hlbWFNZXRhZGF0YShcInRhYmxlc1wiLCBhc3luYyAoKSA9PiB7XG4gICAgICBjb25zdCByZXN1bHQgPSBhd2FpdCB0aGlzLnF1ZXJ5KFwiU0hPVyBGVUxMIFRBQkxFU1wiKVxuICAgICAgY29uc3QgdGFibGVzID0gW11cblxuICAgICAgZm9yIChjb25zdCByb3cgb2YgcmVzdWx0KSB7XG4gICAgICAgIGNvbnN0IHRhYmxlID0gbmV3IFRhYmxlKHRoaXMsIC8qKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgc3RyaW5nPn0gKi8gKHJvdykpXG5cbiAgICAgICAgdGFibGVzLnB1c2godGFibGUpXG4gICAgICB9XG5cbiAgICAgIHJldHVybiB0YWJsZXNcbiAgICB9KVxuICB9XG5cbiAgLyoqXG4gICAqIFJlYWRzIGNvbHVtbiBtZXRhZGF0YSBmb3IgbWFueSB0YWJsZXMgaW4gb25lIHF1ZXJ5LiBgU0hPVyBGVUxMIENPTFVNTlNgIG9ubHlcbiAgICogZGVzY3JpYmVzIGEgc2luZ2xlIHRhYmxlLCBidXQgYGluZm9ybWF0aW9uX3NjaGVtYS5DT0xVTU5TYCBjYXJyaWVzIHRoZSBzYW1lXG4gICAqIGZpZWxkcywgc28gdGhlIHJlc3VsdCBpcyBhbGlhc2VkIHRvIHRoZSBzaGFwZSBgQ29sdW1uYCBhbHJlYWR5IHJlYWRzLlxuICAgKlxuICAgKiBgTlVMTElGKENPTFVNTl9ERUZBVUxULCAnTlVMTCcpYCBjb21wZW5zYXRlcyBmb3IgTWFyaWFEQiByZXBvcnRpbmcgYSBTUUwgTlVMTFxuICAgKiBkZWZhdWx0IGFzIHRoZSBsaXRlcmFsIHN0cmluZyAnTlVMTCcsIHdoZXJlIGBTSE9XIEZVTEwgQ09MVU1OU2AgcmVwb3J0cyBOVUxMLlxuICAgKiBWZXJpZmllZCBjb2x1bW4tZm9yLWNvbHVtbiBhZ2FpbnN0IGBTSE9XIEZVTEwgQ09MVU1OU2Agb24gYSA0NC10YWJsZSBNYXJpYURCXG4gICAqIHNjaGVtYTsgdGhlIG9ubHkgZGl2ZXJnZW5jZSB3YXMgdGhhdCBzZW50aW5lbC5cbiAgICogQHBhcmFtIHtBcnJheTxpbXBvcnQoXCIuLi9iYXNlLXRhYmxlLmpzXCIpLmRlZmF1bHQ+fSB0YWJsZXMgLSBUYWJsZXMgdG8gbG9hZCBjb2x1bW5zIGZvci5cbiAgICogQHJldHVybnMge1Byb21pc2U8TWFwPHN0cmluZywgQXJyYXk8aW1wb3J0KFwiLi4vYmFzZS1jb2x1bW4uanNcIikuZGVmYXVsdD4+Pn0gLSBDb2x1bW5zIGtleWVkIGJ5IHRhYmxlIG5hbWUuXG4gICAqL1xuICBhc3luYyBiYXRjaFRhYmxlQ29sdW1ucyh0YWJsZXMpIHtcbiAgICAvKiogQHR5cGUge01hcDxzdHJpbmcsIEFycmF5PGltcG9ydChcIi4uL2Jhc2UtY29sdW1uLmpzXCIpLmRlZmF1bHQ+Pn0gKi9cbiAgICBjb25zdCBjb2x1bW5zQnlUYWJsZSA9IG5ldyBNYXAoKVxuXG4gICAgaWYgKHRhYmxlcy5sZW5ndGggPT09IDApIHJldHVybiBjb2x1bW5zQnlUYWJsZVxuXG4gICAgY29uc3QgdGFibGVzQnlOYW1lID0gbmV3IE1hcCh0YWJsZXMubWFwKCh0YWJsZSkgPT4gW3RhYmxlLmdldE5hbWUoKSwgdGFibGVdKSlcbiAgICBjb25zdCB0YWJsZU5hbWVzU3FsID0gWy4uLnRhYmxlc0J5TmFtZS5rZXlzKCldLm1hcCgodGFibGVOYW1lKSA9PiB0aGlzLnF1b3RlKHRhYmxlTmFtZSkpLmpvaW4oXCIsIFwiKVxuICAgIGNvbnN0IHJvd3MgPSBhd2FpdCB0aGlzLnF1ZXJ5KGBcbiAgICAgIFNFTEVDVFxuICAgICAgICBUQUJMRV9OQU1FIEFTIHRhYmxlTmFtZSxcbiAgICAgICAgQ09MVU1OX05BTUUgQVMgRmllbGQsXG4gICAgICAgIENPTFVNTl9UWVBFIEFTIFR5cGUsXG4gICAgICAgIElTX05VTExBQkxFIEFTIFxcYE51bGxcXGAsXG4gICAgICAgIENPTFVNTl9LRVkgQVMgXFxgS2V5XFxgLFxuICAgICAgICBOVUxMSUYoQ09MVU1OX0RFRkFVTFQsICdOVUxMJykgQVMgXFxgRGVmYXVsdFxcYCxcbiAgICAgICAgRVhUUkEgQVMgRXh0cmEsXG4gICAgICAgIENPTFVNTl9DT01NRU5UIEFTIENvbW1lbnRcbiAgICAgIEZST00gaW5mb3JtYXRpb25fc2NoZW1hLkNPTFVNTlNcbiAgICAgIFdIRVJFIFRBQkxFX1NDSEVNQSA9IERBVEFCQVNFKCkgQU5EIFRBQkxFX05BTUUgSU4gKCR7dGFibGVOYW1lc1NxbH0pXG4gICAgICBPUkRFUiBCWSBUQUJMRV9OQU1FLCBPUkRJTkFMX1BPU0lUSU9OXG4gICAgYClcblxuICAgIGZvciAoY29uc3Qgcm93IG9mIHJvd3MpIHtcbiAgICAgIGNvbnN0IHRhYmxlTmFtZSA9IC8qKiBAdHlwZSB7c3RyaW5nfSAqLyAocm93LnRhYmxlTmFtZSlcbiAgICAgIGNvbnN0IHRhYmxlID0gdGFibGVzQnlOYW1lLmdldCh0YWJsZU5hbWUpXG5cbiAgICAgIGlmICghdGFibGUpIGNvbnRpbnVlXG5cbiAgICAgIGNvbnN0IGNvbHVtbnMgPSBjb2x1bW5zQnlUYWJsZS5nZXQodGFibGVOYW1lKSB8fCBbXVxuXG4gICAgICBjb2x1bW5zLnB1c2gobmV3IENvbHVtbih0YWJsZSwgLyoqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59ICovIChyb3cpKSlcbiAgICAgIGNvbHVtbnNCeVRhYmxlLnNldCh0YWJsZU5hbWUsIGNvbHVtbnMpXG4gICAgfVxuXG4gICAgcmV0dXJuIGNvbHVtbnNCeVRhYmxlXG4gIH1cblxuICAvKipcbiAgICogUnVucyBzdHJ1Y3R1cmUgc3FsLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxzdHJpbmcgfCBudWxsPn0gLSBSZXNvbHZlcyB3aXRoIFNRTCBzdHJpbmcuXG4gICAqL1xuICBhc3luYyBzdHJ1Y3R1cmVTcWwoKSB7XG4gICAgcmV0dXJuIGF3YWl0IHRoaXMuX2NhY2hlZFNjaGVtYU1ldGFkYXRhKFwic3RydWN0dXJlU3FsXCIsIGFzeW5jICgpID0+IGF3YWl0IG5ldyBTdHJ1Y3R1cmVTcWwoe2RyaXZlcjogdGhpc30pLnRvU3FsKCkpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBsYXN0IGluc2VydCBpZC5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9iYXNlLmpzXCIpLlF1ZXJ5T3B0aW9uc30gW29wdGlvbnNdIC0gUXVlcnkgb3duZXJzaGlwIG9wdGlvbnMuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPG51bWJlcj59IC0gUmVzb2x2ZXMgd2l0aCB0aGUgbGFzdCBpbnNlcnQgaWQuXG4gICAqL1xuICBhc3luYyBsYXN0SW5zZXJ0SUQob3B0aW9ucyA9IHt9KSB7XG4gICAgY29uc3QgcmVzdWx0ID0gYXdhaXQgdGhpcy5xdWVyeShcIlNFTEVDVCBMQVNUX0lOU0VSVF9JRCgpIEFTIGxhc3RfaW5zZXJ0X2lkXCIsIG9wdGlvbnMpXG5cbiAgICByZXR1cm4gZGlnZyhyZXN1bHQsIDAsIFwibGFzdF9pbnNlcnRfaWRcIilcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIG9wdGlvbnMuXG4gICAqIEByZXR1cm5zIHtPcHRpb25zfSAtIFRoZSBvcHRpb25zIG9wdGlvbnMuXG4gICAqL1xuICBvcHRpb25zKCkge1xuICAgIGlmICghdGhpcy5fb3B0aW9ucykgdGhpcy5fb3B0aW9ucyA9IG5ldyBPcHRpb25zKHtkcml2ZXI6IHRoaXN9KVxuXG4gICAgcmV0dXJuIHRoaXMuX29wdGlvbnNcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHN0YXJ0IHRyYW5zYWN0aW9uIGFjdGlvbi5cbiAgICogQHBhcmFtIHtQaWNrPGltcG9ydChcIi4uL2Jhc2UuanNcIikuUXVlcnlPcHRpb25zLCBcIm9wZXJhdGlvbk93bmVyXCI+fSBbb3B0aW9uc10gLSBUcmFuc2FjdGlvbiBvd25lcnNoaXAuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIHdoZW4gY29tcGxldGUuXG4gICAqL1xuICBhc3luYyBfc3RhcnRUcmFuc2FjdGlvbkFjdGlvbihvcHRpb25zID0ge30pIHtcbiAgICBhd2FpdCB0aGlzLnF1ZXJ5KFwiU1RBUlQgVFJBTlNBQ1RJT05cIiwgb3B0aW9ucylcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHVwZGF0ZSBzcWwuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vYmFzZS5qc1wiKS5VcGRhdGVTcWxBcmdzVHlwZX0gYXJncyAtIE9wdGlvbnMgb2JqZWN0LlxuICAgKiBAcmV0dXJucyB7c3RyaW5nfSAtIFNRTCBzdHJpbmcuXG4gICAqL1xuICB1cGRhdGVTcWwoe2NvbmRpdGlvbnMsIGRhdGEsIHRhYmxlTmFtZX0pIHtcbiAgICBjb25zdCB1cGRhdGUgPSBuZXcgVXBkYXRlKHtjb25kaXRpb25zLCBkYXRhLCBkcml2ZXI6IHRoaXMsIHRhYmxlTmFtZX0pXG5cbiAgICByZXR1cm4gdXBkYXRlLnRvU3FsKClcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHVwc2VydCBzcWwuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vYmFzZS5qc1wiKS5VcHNlcnRTcWxBcmdzVHlwZX0gYXJncyAtIE9wdGlvbnMgb2JqZWN0LlxuICAgKiBAcmV0dXJucyB7c3RyaW5nfSAtIFNRTCBzdHJpbmcuXG4gICAqL1xuICB1cHNlcnRTcWwoYXJncykge1xuICAgIGNvbnN0IHVwc2VydCA9IG5ldyBVcHNlcnQoey4uLmFyZ3MsIGRyaXZlcjogdGhpc30pXG5cbiAgICByZXR1cm4gdXBzZXJ0LnRvU3FsKClcbiAgfVxuXG4gIC8qKlxuICAgKiBCbG9ja3MgdW50aWwgYSBNeVNRTC9NYXJpYURCIHVzZXItbGV2ZWwgbG9jayBpcyBhY3F1aXJlZCBvbiB0aGlzXG4gICAqIGNvbm5lY3Rpb24uIEltcGxlbWVudGVkIHZpYSBgR0VUX0xPQ0sobmFtZSwgdGltZW91dClgLCB3aGVyZSB0aGVcbiAgICogdGltZW91dCBpcyBpbiBzZWNvbmRzLlxuICAgKlxuICAgKiBNeVNRTCBoaXN0b3JpY2FsbHkgZG9jdW1lbnRlZCBhIG5lZ2F0aXZlIHRpbWVvdXQgYXMgXCJpbmZpbml0ZVwiLFxuICAgKiBidXQgTWFyaWFEQiAxMCsgc2lsZW50bHkgcmVqZWN0cyBuZWdhdGl2ZSB0aW1lb3V0cyBhbmQgcmV0dXJuc1xuICAgKiBgTlVMTGAgZnJvbSBgR0VUX0xPQ0tgLiBUbyBtYWtlIHRoZSBoZWxwZXIgcG9ydGFibGUgYWNyb3NzIE15U1FMXG4gICAqIGFuZCBNYXJpYURCIHRoZSBcImluZGVmaW5pdGVcIiBjYXNlIGlzIGVuY29kZWQgYXMgYSBsYXJnZSBwb3NpdGl2ZVxuICAgKiB0aW1lb3V0IChvbmUgeWVhciksIHdoaWNoIGlzIGNvbWZvcnRhYmx5IGxvbmdlciB0aGFuIGFueVxuICAgKiByZWFsaXN0aWMgY3JpdGljYWwgc2VjdGlvbiBhbmQgd29ya3Mgb24gZXZlcnkgc3VwcG9ydGVkIHZlcnNpb24uXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBuYW1lIC0gTG9jayBuYW1lLlxuICAgKiBAcGFyYW0ge3t0aW1lb3V0TXM/OiBudW1iZXIgfCBudWxsfX0gW2FyZ3NdIC0gT3B0aW9uYWwgdGltZW91dCBpbiBtaWxsaXNlY29uZHM7IGBudWxsYCwgYHVuZGVmaW5lZGAsIG9yIG5lZ2F0aXZlIGJsb2NrcyBmb3IgYE1ZU1FMX0lOREVGSU5JVEVfTE9DS19USU1FT1VUX1NFQ09ORFNgLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxib29sZWFuPn0gLSBUcnVlIGlmIGFjcXVpcmVkLCBmYWxzZSBpZiB0aGUgdGltZW91dCBlbGFwc2VkLlxuICAgKi9cbiAgYXN5bmMgX2FjcXVpcmVBZHZpc29yeUxvY2sobmFtZSwge3RpbWVvdXRNc30gPSB7fSkge1xuICAgIGNvbnN0IHRpbWVvdXRTZWNvbmRzID0gdHlwZW9mIHRpbWVvdXRNcyA9PT0gXCJudW1iZXJcIiAmJiB0aW1lb3V0TXMgPj0gMFxuICAgICAgPyBNYXRoLmNlaWwodGltZW91dE1zIC8gMTAwMClcbiAgICAgIDogTVlTUUxfSU5ERUZJTklURV9MT0NLX1RJTUVPVVRfU0VDT05EU1xuICAgIGNvbnN0IHJvd3MgPSBhd2FpdCB0aGlzLnF1ZXJ5KGBTRUxFQ1QgR0VUX0xPQ0soJHt0aGlzLnF1b3RlKG5hbWUpfSwgJHt0aW1lb3V0U2Vjb25kc30pIEFTIHZlbG9jaW91c19hZHZpc29yeV9sb2NrX3Jlc3VsdGApXG4gICAgY29uc3QgcmVzdWx0ID0gcm93cz8uWzBdPy52ZWxvY2lvdXNfYWR2aXNvcnlfbG9ja19yZXN1bHRcblxuICAgIGlmIChyZXN1bHQgPT09IG51bGwgfHwgcmVzdWx0ID09PSB1bmRlZmluZWQpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihgR0VUX0xPQ0sgcmV0dXJuZWQgTlVMTCBmb3IgYWR2aXNvcnkgbG9jayAke0pTT04uc3RyaW5naWZ5KG5hbWUpfSAodHlwaWNhbGx5IGFuIG91dC1vZi1tZW1vcnkgb3IgdGhyZWFkLWtpbGxlZCBjb25kaXRpb24pYClcbiAgICB9XG5cbiAgICByZXR1cm4gTnVtYmVyKHJlc3VsdCkgPT09IDFcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHRyeSBhY3F1aXJlIGFkdmlzb3J5IGxvY2suXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBuYW1lIC0gTG9jayBuYW1lLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxib29sZWFuPn0gLSBUcnVlIGlmIHRoZSBsb2NrIHdhcyBhY3F1aXJlZCwgZmFsc2UgaWYgaXQgd2FzIGFscmVhZHkgaGVsZC5cbiAgICovXG4gIGFzeW5jIF90cnlBY3F1aXJlQWR2aXNvcnlMb2NrKG5hbWUpIHtcbiAgICBjb25zdCByb3dzID0gYXdhaXQgdGhpcy5xdWVyeShgU0VMRUNUIEdFVF9MT0NLKCR7dGhpcy5xdW90ZShuYW1lKX0sIDApIEFTIHZlbG9jaW91c19hZHZpc29yeV9sb2NrX3Jlc3VsdGApXG4gICAgY29uc3QgcmVzdWx0ID0gcm93cz8uWzBdPy52ZWxvY2lvdXNfYWR2aXNvcnlfbG9ja19yZXN1bHRcblxuICAgIGlmIChyZXN1bHQgPT09IG51bGwgfHwgcmVzdWx0ID09PSB1bmRlZmluZWQpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihgR0VUX0xPQ0sgcmV0dXJuZWQgTlVMTCBmb3IgYWR2aXNvcnkgbG9jayAke0pTT04uc3RyaW5naWZ5KG5hbWUpfSAodHlwaWNhbGx5IGFuIG91dC1vZi1tZW1vcnkgb3IgdGhyZWFkLWtpbGxlZCBjb25kaXRpb24pYClcbiAgICB9XG5cbiAgICByZXR1cm4gTnVtYmVyKHJlc3VsdCkgPT09IDFcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHJlbGVhc2UgYWR2aXNvcnkgbG9jay5cbiAgICogQHBhcmFtIHtzdHJpbmd9IG5hbWUgLSBMb2NrIG5hbWUuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPGJvb2xlYW4+fSAtIFRydWUgaWYgdGhlIGxvY2sgd2FzIGhlbGQgYnkgdGhpcyBzZXNzaW9uIGFuZCBoYXMgbm93IGJlZW4gcmVsZWFzZWQuXG4gICAqL1xuICBhc3luYyBfcmVsZWFzZUFkdmlzb3J5TG9jayhuYW1lKSB7XG4gICAgY29uc3Qgcm93cyA9IGF3YWl0IHRoaXMucXVlcnkoYFNFTEVDVCBSRUxFQVNFX0xPQ0soJHt0aGlzLnF1b3RlKG5hbWUpfSkgQVMgdmVsb2Npb3VzX2Fkdmlzb3J5X2xvY2tfcmVzdWx0YCwge3JldHJ5OiBmYWxzZX0pXG4gICAgY29uc3QgcmVzdWx0ID0gcm93cz8uWzBdPy52ZWxvY2lvdXNfYWR2aXNvcnlfbG9ja19yZXN1bHRcblxuICAgIHJldHVybiBOdW1iZXIocmVzdWx0KSA9PT0gMVxuICB9XG5cbiAgLyoqXG4gIC8qKlxuICAgKiBBdHRyaWJ1dGVzIHRoZSBjdXJyZW50IGhvbGRlciBvZiB0aGUgbmFtZWQgbG9jayB0byBpdHMgcGh5c2ljYWwgc2Vzc2lvblxuICAgKiBjb25uZWN0aW9uIGlkIHZpYSBgSVNfVVNFRF9MT0NLKG5hbWUpYCwgY2FwdHVyZWQgYXQgdGhlIHRlbGVtZXRyeSBldmVudFxuICAgKiBtb21lbnQgKGJlc3QtZWZmb3J0OyB0aGUgY2FsbGVyIGd1YXJkcyBmYWlsdXJlcykuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBuYW1lIC0gTG9jayBuYW1lLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxzdHJpbmcgfCBudWxsPn0gLSBNYXJpYURCL015U1FMIGNvbm5lY3Rpb24gaWQgb2YgdGhlIGhvbGRlciwgb3IgbnVsbCB3aGVuIG5vIHNlc3Npb24gaG9sZHMgdGhlIGxvY2suXG4gICAqL1xuICBhc3luYyBhZHZpc29yeUxvY2tIb2xkZXJDb25uZWN0aW9uSWQobmFtZSkge1xuICAgIGNvbnN0IHJvd3MgPSBhd2FpdCB0aGlzLnF1ZXJ5KGBTRUxFQ1QgSVNfVVNFRF9MT0NLKCR7dGhpcy5xdW90ZShuYW1lKX0pIEFTIHZlbG9jaW91c19hZHZpc29yeV9sb2NrX2hvbGRlcmApXG4gICAgY29uc3QgaG9sZGVyID0gcm93cz8uWzBdPy52ZWxvY2lvdXNfYWR2aXNvcnlfbG9ja19ob2xkZXJcblxuICAgIHJldHVybiBob2xkZXIgPT09IG51bGwgfHwgaG9sZGVyID09PSB1bmRlZmluZWQgPyBudWxsIDogU3RyaW5nKGhvbGRlcilcbiAgfVxuXG4gIC8qKlxuICAgKiBEcml2ZXItbmF0aXZlIHZpZXcgZm9yIHRoZSBiYXNlIGRyaXZlcidzIGBpc0Fkdmlzb3J5TG9ja0hlbGRgLCB3aGljaFxuICAgKiBhbnN3ZXJzIGZyb20gdGhlIHByb2Nlc3MtbG9jYWwgdGllciBmaXJzdC5cbiAgICogQHBhcmFtIHtzdHJpbmd9IG5hbWUgLSBMb2NrIG5hbWUuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPGJvb2xlYW4+fSAtIFRydWUgaWYgYW55IHNlc3Npb24gY3VycmVudGx5IGhvbGRzIHRoZSBsb2NrLlxuICAgKi9cbiAgYXN5bmMgX2lzQWR2aXNvcnlMb2NrSGVsZE5hdGl2ZShuYW1lKSB7XG4gICAgY29uc3Qgcm93cyA9IGF3YWl0IHRoaXMucXVlcnkoYFNFTEVDVCBJU19VU0VEX0xPQ0soJHt0aGlzLnF1b3RlKG5hbWUpfSkgQVMgdmVsb2Npb3VzX2Fkdmlzb3J5X2xvY2tfaG9sZGVyYClcbiAgICBjb25zdCBob2xkZXIgPSByb3dzPy5bMF0/LnZlbG9jaW91c19hZHZpc29yeV9sb2NrX2hvbGRlclxuXG4gICAgcmV0dXJuIGhvbGRlciAhPT0gbnVsbCAmJiBob2xkZXIgIT09IHVuZGVmaW5lZFxuICB9XG59XG4iXX0=