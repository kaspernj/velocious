// @ts-check
import AlterTable from "./sql/alter-table.js";
import Base from "../base.js";
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiaW5kZXguanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi8uLi8uLi9zcmMvZGF0YWJhc2UvZHJpdmVycy9teXNxbC9pbmRleC5qcyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiQUFBQSxZQUFZO0FBRVosT0FBTyxVQUFVLE1BQU0sc0JBQXNCLENBQUE7QUFDN0MsT0FBTyxJQUFJLE1BQU0sWUFBWSxDQUFBO0FBQzdCLE9BQU8sY0FBYyxNQUFNLDBCQUEwQixDQUFBO0FBQ3JELE9BQU8sV0FBVyxNQUFNLHVCQUF1QixDQUFBO0FBQy9DLE9BQU8sV0FBVyxNQUFNLHVCQUF1QixDQUFBO0FBQy9DLE9BQU8sTUFBTSxNQUFNLGlCQUFpQixDQUFBO0FBQ3BDLE9BQU8sRUFBQyxJQUFJLEVBQUMsTUFBTSxXQUFXLENBQUE7QUFDOUIsT0FBTyxZQUFZLE1BQU0sd0JBQXdCLENBQUE7QUFDakQsT0FBTyxTQUFTLE1BQU0scUJBQXFCLENBQUE7QUFDM0MsT0FBTyxNQUFNLE1BQU0saUJBQWlCLENBQUE7QUFDcEMsT0FBTyxPQUFPLE1BQU0sY0FBYyxDQUFBO0FBQ2xDLE9BQU8sS0FBSyxNQUFNLE9BQU8sQ0FBQTtBQUN6QixPQUFPLEtBQUssTUFBTSxZQUFZLENBQUE7QUFDOUIsT0FBTyxpQkFBaUIsTUFBTSw4QkFBOEIsQ0FBQTtBQUM1RCxPQUFPLFdBQVcsTUFBTSxtQkFBbUIsQ0FBQTtBQUMzQyxPQUFPLFdBQVcsTUFBTSxtQkFBbUIsQ0FBQTtBQUMzQyxPQUFPLFdBQVcsTUFBTSx1QkFBdUIsQ0FBQTtBQUMvQyxPQUFPLEtBQUssTUFBTSxZQUFZLENBQUE7QUFDOUIsT0FBTyxZQUFZLE1BQU0sb0JBQW9CLENBQUE7QUFDN0MsT0FBTyxNQUFNLE1BQU0saUJBQWlCLENBQUE7QUFDcEMsT0FBTyxNQUFNLE1BQU0saUJBQWlCLENBQUE7QUFDcEMsT0FBTywwQkFBMEIsTUFBTSxpQ0FBaUMsQ0FBQTtBQUV4RTs7Ozs7OztHQU9HO0FBQ0gsTUFBTSxxQ0FBcUMsR0FBRyxFQUFFLEdBQUcsRUFBRSxHQUFHLEVBQUUsR0FBRyxHQUFHLENBQUE7QUFDaEUsTUFBTSxrQ0FBa0MsR0FBRyxHQUFHLENBQUE7QUFFOUMsTUFBTSxDQUFDLE9BQU8sT0FBTyw2QkFBOEIsU0FBUSxJQUFJO0lBQzdELCtDQUErQztJQUMvQyxJQUFJLEdBQUcsU0FBUyxDQUFBO0lBRWhCLDRCQUE0QjtJQUM1Qix1QkFBdUIsR0FBRyxRQUFRLENBQUE7SUFFbEMsNEJBQTRCO0lBQzVCLHVCQUF1QixHQUFHLElBQUksQ0FBQTtJQUU5Qjs7O09BR0c7SUFDSCxLQUFLLENBQUMsT0FBTztRQUNYLElBQUksQ0FBQywyQkFBMkIsRUFBRSxDQUFBO1FBQ2xDLElBQUksQ0FBQyxJQUFJLEdBQUcsS0FBSyxDQUFDLFVBQVUsQ0FBQyxNQUFNLENBQUMsTUFBTSxDQUFDLEVBQUMsZUFBZSxFQUFFLENBQUMsRUFBQyxFQUFFLElBQUksQ0FBQyxXQUFXLEVBQUUsQ0FBQyxDQUFDLENBQUE7UUFDckYsSUFBSSxDQUFDLElBQUksQ0FBQyxFQUFFLENBQUMsT0FBTyxFQUFFLElBQUksQ0FBQyxXQUFXLENBQUMsQ0FBQTtJQUN6QyxDQUFDO0lBRUQ7OztPQUdHO0lBQ0gsV0FBVyxHQUFHLENBQUMsS0FBSyxFQUFFLEVBQUU7UUFDdEIsT0FBTyxDQUFDLEtBQUssQ0FBQyx1Q0FBdUMsRUFBRSxLQUFLLENBQUMsQ0FBQTtJQUMvRCxDQUFDLENBQUE7SUFFRDs7O09BR0c7SUFDSCxLQUFLLENBQUMsTUFBTTtRQUNWLE1BQU0sSUFBSSxHQUFHLElBQUksQ0FBQyxJQUFJLENBQUE7UUFFdEIsSUFBSSxDQUFDLElBQUk7WUFBRSxPQUFNO1FBRWpCLE1BQU0sSUFBSSxPQUFPLENBQUMsQ0FBQyxPQUFPLEVBQUUsTUFBTSxFQUFFLEVBQUU7WUFDcEMsSUFBSSxDQUFDLEdBQUcsQ0FBQyxDQUFDLEtBQUssRUFBRSxFQUFFO2dCQUNqQixJQUFJLEtBQUssRUFBRSxDQUFDO29CQUNWLE1BQU0sQ0FBQyxLQUFLLENBQUMsQ0FBQTtnQkFDZixDQUFDO3FCQUFNLENBQUM7b0JBQ04sT0FBTyxDQUFDLFNBQVMsQ0FBQyxDQUFBO2dCQUNwQixDQUFDO1lBQ0gsQ0FBQyxDQUFDLENBQUE7UUFDSixDQUFDLENBQUMsQ0FBQTtRQUNGLElBQUksQ0FBQyxJQUFJLEdBQUcsU0FBUyxDQUFBO1FBQ3JCLElBQUksQ0FBQywyQkFBMkIsRUFBRSxDQUFBO0lBQ3BDLENBQUM7SUFFRDs7Ozs7Ozs7Ozs7OztPQWFHO0lBQ0gsS0FBSyxDQUFDLGdDQUFnQztRQUNwQyxNQUFNLElBQUksR0FBRyxJQUFJLENBQUMsSUFBSSxDQUFBO1FBRXRCLElBQUksQ0FBQyxJQUFJO1lBQUUsT0FBTTtRQUVqQixJQUFJLENBQUM7WUFDSCxNQUFNLGdCQUFnQixHQUFHLE1BQU0sSUFBSSxPQUFPLENBQUMsQ0FBQyxPQUFPLEVBQUUsTUFBTSxFQUFFLEVBQUU7Z0JBQzdELElBQUksQ0FBQyxhQUFhLENBQUMsQ0FBQyxLQUFLLEVBQUUsVUFBVSxFQUFFLEVBQUU7b0JBQ3ZDLElBQUksS0FBSzt3QkFBRSxNQUFNLENBQUMsS0FBSyxZQUFZLEtBQUssQ0FBQyxDQUFDLENBQUMsS0FBSyxDQUFDLENBQUMsQ0FBQyxJQUFJLEtBQUssQ0FBQyxxREFBcUQsS0FBSyxFQUFFLENBQUMsQ0FBQyxDQUFBOzt3QkFDdEgsT0FBTyxDQUFDLFVBQVUsQ0FBQyxDQUFBO2dCQUMxQixDQUFDLENBQUMsQ0FBQTtZQUNKLENBQUMsQ0FBQyxDQUFBO1lBRUYsSUFBSSxDQUFDO2dCQUNILE1BQU0sSUFBSSxPQUFPLENBQUMsQ0FBQyxPQUFPLEVBQUUsTUFBTSxFQUFFLEVBQUU7b0JBQ3BDLGdCQUFnQixDQUFDLFVBQVUsQ0FBQyxFQUFDLE9BQU8sRUFBRSxTQUFTLEVBQUUsT0FBTyxFQUFFLEtBQUssRUFBQyxFQUFFLENBQUMsQ0FBQyx5Q0FBeUMsQ0FBQyxLQUFLLEVBQUUsRUFBRTt3QkFDckgsSUFBSSxLQUFLOzRCQUFFLE1BQU0sQ0FBQyxLQUFLLFlBQVksS0FBSyxDQUFDLENBQUMsQ0FBQyxLQUFLLENBQUMsQ0FBQyxDQUFDLElBQUksS0FBSyxDQUFDLCtCQUErQixLQUFLLEVBQUUsQ0FBQyxDQUFDLENBQUE7OzRCQUNoRyxPQUFPLENBQUMsU0FBUyxDQUFDLENBQUE7b0JBQ3pCLENBQUMsQ0FBQyxDQUFDLENBQUE7Z0JBQ0wsQ0FBQyxDQUFDLENBQUE7WUFDSixDQUFDO29CQUFTLENBQUM7Z0JBQ1QsZ0JBQWdCLENBQUMsT0FBTyxFQUFFLENBQUE7WUFDNUIsQ0FBQztZQUVELHdFQUF3RTtZQUN4RSx5RUFBeUU7WUFDekUsMEVBQTBFO1lBQzFFLElBQUksQ0FBQywyQkFBMkIsRUFBRSxDQUFBO1FBQ3BDLENBQUM7UUFBQyxPQUFPLEtBQUssRUFBRSxDQUFDO1lBQ2YscUVBQXFFO1lBQ3JFLDBFQUEwRTtZQUMxRSx1REFBdUQ7WUFDdkQsSUFBSSxDQUFDO2dCQUNILE1BQU0sSUFBSSxDQUFDLE1BQU0sRUFBRSxDQUFBO1lBQ3JCLENBQUM7WUFBQyxPQUFPLFVBQVUsRUFBRSxDQUFDO2dCQUNwQixNQUFNLElBQUksY0FBYyxDQUFDLENBQUMsS0FBSyxFQUFFLFVBQVUsQ0FBQyxFQUFFLDZFQUE2RSxFQUFFLEVBQUMsS0FBSyxFQUFFLFVBQVUsRUFBQyxDQUFDLENBQUE7WUFDbkosQ0FBQztZQUVELE1BQU0sS0FBSyxDQUFBO1FBQ2IsQ0FBQztJQUNILENBQUM7SUFFRDs7OztPQUlHO0lBQ0gsS0FBSyxDQUFDLHlCQUF5QixDQUFDLElBQUk7UUFDbEMsTUFBTSxZQUFZLEdBQUcsSUFBSSxDQUFDLHVCQUF1QixDQUFBO1FBRWpELE1BQU0sS0FBSyxDQUFDLHlCQUF5QixDQUFDLElBQUksQ0FBQyxDQUFBO1FBRTNDLElBQUksSUFBSSxLQUFLLFNBQVMsRUFBRSxDQUFDO1lBQ3ZCLElBQUksWUFBWSxLQUFLLFNBQVMsRUFBRSxDQUFDO2dCQUMvQixNQUFNLElBQUksQ0FBQyxLQUFLLENBQUMsZ0RBQWdELEVBQUUsRUFBQyxPQUFPLEVBQUUsZ0NBQWdDLEVBQUUsa0JBQWtCLEVBQUUsS0FBSyxFQUFFLGVBQWUsRUFBRSxLQUFLLEVBQUMsQ0FBQyxDQUFBO1lBQ3BLLENBQUM7WUFFRCxPQUFNO1FBQ1IsQ0FBQztRQUVELE1BQU0sSUFBSSxDQUFDLEtBQUssQ0FBQyw2Q0FBNkMsSUFBSSxDQUFDLEtBQUssQ0FBQyxJQUFJLENBQUMsRUFBRSxFQUFFLEVBQUMsT0FBTyxFQUFFLDhCQUE4QixFQUFFLGtCQUFrQixFQUFFLEtBQUssRUFBRSxlQUFlLEVBQUUsS0FBSyxFQUFDLENBQUMsQ0FBQTtJQUNqTCxDQUFDO0lBRUQ7OztPQUdHO0lBQ0gsS0FBSyxDQUFDLDJCQUEyQjtRQUMvQixJQUFJLElBQUksQ0FBQyx1QkFBdUIsS0FBSyxTQUFTLEVBQUUsQ0FBQztZQUMvQyxNQUFNLElBQUksQ0FBQyxLQUFLLENBQUMsZ0RBQWdELEVBQUUsRUFBQyxPQUFPLEVBQUUsZ0NBQWdDLEVBQUUsa0JBQWtCLEVBQUUsS0FBSyxFQUFFLGVBQWUsRUFBRSxLQUFLLEVBQUMsQ0FBQyxDQUFBO1FBQ3BLLENBQUM7UUFFRCxNQUFNLEtBQUssQ0FBQywyQkFBMkIsRUFBRSxDQUFBO0lBQzNDLENBQUM7SUFFRDs7Ozs7T0FLRztJQUNILEtBQUssQ0FBQyxXQUFXLENBQUMsSUFBSSxFQUFFLE9BQU87UUFDN0IsSUFBSSxPQUFPLENBQUMsZUFBZSxLQUFLLEtBQUs7WUFBRSxNQUFNLElBQUksQ0FBQyxxQkFBcUIsRUFBRSxDQUFBO0lBQzNFLENBQUM7SUFFRDs7O09BR0c7SUFDSCx5QkFBeUI7UUFDdkIsT0FBTyxJQUFJLENBQUMsdUJBQXVCLENBQUE7SUFDckMsQ0FBQztJQUVEOzs7T0FHRztJQUNILHlCQUF5QixDQUFDLFFBQVE7UUFDaEMsSUFBSSxDQUFDLHVCQUF1QixHQUFHLFFBQVEsQ0FBQTtJQUN6QyxDQUFDO0lBRUQ7OztPQUdHO0lBQ0gseUJBQXlCO1FBQ3ZCLE9BQU8sSUFBSSxDQUFDLHVCQUF1QixDQUFBO0lBQ3JDLENBQUM7SUFFRDs7T0FFRztJQUNILDJCQUEyQjtRQUN6QixJQUFJLENBQUMsdUJBQXVCLEdBQUcsSUFBSSxDQUFBO0lBQ3JDLENBQUM7SUFFRDs7O09BR0c7SUFDSCxLQUFLLENBQUMscUJBQXFCO1FBQ3pCLE1BQU0sc0JBQXNCLEdBQUcsSUFBSSxDQUFDLHlCQUF5QixFQUFFLENBQUE7UUFFL0QsSUFBSSxzQkFBc0IsS0FBSyxJQUFJLElBQUksSUFBSSxDQUFDLHlCQUF5QixFQUFFLEtBQUssc0JBQXNCO1lBQUUsT0FBTyxLQUFLLENBQUE7UUFFaEgsTUFBTSxJQUFJLENBQUMsa0JBQWtCLENBQUMsc0JBQXNCLENBQUMsQ0FBQTtRQUVyRCxPQUFPLElBQUksQ0FBQTtJQUNiLENBQUM7SUFFRDs7OztPQUlHO0lBQ0gsS0FBSyxDQUFDLGtCQUFrQixDQUFDLFFBQVE7UUFDL0IsSUFBSSxJQUFJLENBQUMseUJBQXlCLEVBQUUsS0FBSyxRQUFRO1lBQUUsT0FBTyxLQUFLLENBQUE7UUFFL0QsTUFBTSxJQUFJLENBQUMsWUFBWSxDQUFDLG1CQUFtQixJQUFJLENBQUMsS0FBSyxDQUFDLFFBQVEsQ0FBQyxFQUFFLENBQUMsQ0FBQTtRQUNsRSxJQUFJLENBQUMsdUJBQXVCLEdBQUcsUUFBUSxDQUFBO1FBRXZDLE9BQU8sSUFBSSxDQUFBO0lBQ2IsQ0FBQztJQUVEOzs7T0FHRztJQUNILFdBQVc7UUFDVCxNQUFNLElBQUksR0FBRyxJQUFJLENBQUMsT0FBTyxFQUFFLENBQUE7UUFDM0IsTUFBTSxPQUFPLEdBQUcsQ0FBQyxVQUFVLEVBQUUsTUFBTSxFQUFFLFVBQVUsRUFBRSxNQUFNLENBQUMsQ0FBQTtRQUV4RDs7bUVBRTJEO1FBQzNELE1BQU0sV0FBVyxHQUFHLEVBQUMsT0FBTyxFQUFFLFNBQVMsRUFBRSxRQUFRLEVBQUUsR0FBRyxFQUFDLENBQUE7UUFFdkQsS0FBSyxNQUFNLFlBQVksSUFBSSxPQUFPLEVBQUUsQ0FBQztZQUNuQyxJQUFJLFlBQVksSUFBSSxJQUFJO2dCQUFFLFdBQVcsQ0FBQyxZQUFZLENBQUMsR0FBRyxJQUFJLENBQUMsSUFBSSxFQUFFLFlBQVksQ0FBQyxDQUFBO1FBQ2hGLENBQUM7UUFFRCxJQUFJLFVBQVUsSUFBSSxJQUFJO1lBQUUsV0FBVyxDQUFDLE1BQU0sQ0FBQyxHQUFHLElBQUksQ0FBQyxVQUFVLENBQUMsQ0FBQTtRQUM5RCxJQUFJLFNBQVMsSUFBSSxJQUFJO1lBQUUsV0FBVyxDQUFDLFNBQVMsQ0FBQyxHQUFHLElBQUksQ0FBQyxTQUFTLENBQUMsQ0FBQTtRQUMvRCx5RUFBeUU7UUFDekUsaUZBQWlGO1FBQ2pGLHNCQUFzQjtRQUN0QixJQUFJLG9CQUFvQixJQUFJLElBQUk7WUFBRSxXQUFXLENBQUMsb0JBQW9CLENBQUMsR0FBRyxPQUFPLENBQUMsSUFBSSxDQUFDLElBQUksRUFBRSxvQkFBb0IsQ0FBQyxDQUFDLENBQUE7UUFFL0csT0FBTyxXQUFXLENBQUE7SUFDcEIsQ0FBQztJQUVEOzs7O09BSUc7SUFDSCxLQUFLLENBQUMsY0FBYyxDQUFDLFNBQVM7UUFDNUIsTUFBTSxTQUFTLEdBQUcsRUFBQyxTQUFTLEVBQUUsTUFBTSxFQUFFLElBQUksRUFBQyxDQUFBO1FBQzNDLE1BQU0sVUFBVSxHQUFHLElBQUksVUFBVSxDQUFDLFNBQVMsQ0FBQyxDQUFBO1FBRTVDLE9BQU8sTUFBTSxVQUFVLENBQUMsTUFBTSxFQUFFLENBQUE7SUFDbEMsQ0FBQztJQUVEOzs7Ozs7T0FNRztJQUNILGlCQUFpQixDQUFDLFlBQVksRUFBRSxJQUFJO1FBQ2xDLE1BQU0sVUFBVSxHQUFHLE1BQU0sQ0FBQyxNQUFNLENBQUMsRUFBQyxZQUFZLEVBQUUsTUFBTSxFQUFFLElBQUksRUFBQyxFQUFFLElBQUksQ0FBQyxDQUFBO1FBQ3BFLE1BQU0sY0FBYyxHQUFHLElBQUksY0FBYyxDQUFDLFVBQVUsQ0FBQyxDQUFBO1FBRXJELE9BQU8sY0FBYyxDQUFDLEtBQUssRUFBRSxDQUFBO0lBQy9CLENBQUM7SUFFRDs7Ozs7O09BTUc7SUFDSCxlQUFlLENBQUMsWUFBWSxFQUFFLElBQUk7UUFDaEMsTUFBTSxRQUFRLEdBQUcsTUFBTSxDQUFDLE1BQU0sQ0FBQyxFQUFDLFlBQVksRUFBRSxNQUFNLEVBQUUsSUFBSSxFQUFDLEVBQUUsSUFBSSxDQUFDLENBQUE7UUFDbEUsTUFBTSxZQUFZLEdBQUcsSUFBSSxZQUFZLENBQUMsUUFBUSxDQUFDLENBQUE7UUFFL0MsT0FBTyxZQUFZLENBQUMsS0FBSyxFQUFFLENBQUE7SUFDN0IsQ0FBQztJQUVEOzs7O09BSUc7SUFDSCxLQUFLLENBQUMsZUFBZSxDQUFDLFNBQVM7UUFDN0IsTUFBTSxVQUFVLEdBQUcsTUFBTSxDQUFDLE1BQU0sQ0FBQyxFQUFDLE1BQU0sRUFBRSxJQUFJLEVBQUMsRUFBRSxTQUFTLENBQUMsQ0FBQTtRQUMzRCxNQUFNLFdBQVcsR0FBRyxJQUFJLFdBQVcsQ0FBQyxVQUFVLENBQUMsQ0FBQTtRQUUvQyxPQUFPLE1BQU0sV0FBVyxDQUFDLE1BQU0sRUFBRSxDQUFBO0lBQ25DLENBQUM7SUFFRDs7OztPQUlHO0lBQ0gsS0FBSyxDQUFDLGVBQWUsQ0FBQyxTQUFTO1FBQzdCLE1BQU0sVUFBVSxHQUFHLE1BQU0sQ0FBQyxNQUFNLENBQUMsRUFBQyxNQUFNLEVBQUUsSUFBSSxFQUFDLEVBQUUsU0FBUyxDQUFDLENBQUE7UUFDM0QsTUFBTSxXQUFXLEdBQUcsSUFBSSxXQUFXLENBQUMsVUFBVSxDQUFDLENBQUE7UUFFL0MsT0FBTyxNQUFNLFdBQVcsQ0FBQyxNQUFNLEVBQUUsQ0FBQTtJQUNuQyxDQUFDO0lBRUQ7Ozs7T0FJRztJQUNILEtBQUssQ0FBQyxjQUFjLENBQUMsU0FBUztRQUM1QixNQUFNLFVBQVUsR0FBRyxFQUFDLFNBQVMsRUFBRSxNQUFNLEVBQUUsSUFBSSxFQUFDLENBQUE7UUFDNUMsTUFBTSxXQUFXLEdBQUcsSUFBSSxXQUFXLENBQUMsVUFBVSxDQUFDLENBQUE7UUFFL0MsT0FBTyxXQUFXLENBQUMsS0FBSyxFQUFFLENBQUE7SUFDNUIsQ0FBQztJQUVEOzs7T0FHRztJQUNILEtBQUssQ0FBQyxlQUFlO1FBQ25CLE1BQU0sSUFBSSxHQUFHLE1BQU0sSUFBSSxDQUFDLEtBQUssQ0FBQyw4QkFBOEIsQ0FBQyxDQUFBO1FBRTdELE9BQU8sSUFBSSxDQUFDLElBQUksRUFBRSxDQUFDLEVBQUUsU0FBUyxDQUFDLENBQUE7SUFDakMsQ0FBQztJQUVEOzs7T0FHRztJQUNILEtBQUssQ0FBQyxrQkFBa0I7UUFDdEIsTUFBTSxJQUFJLENBQUMsS0FBSyxDQUFDLDRCQUE0QixDQUFDLENBQUE7SUFDaEQsQ0FBQztJQUVEOzs7T0FHRztJQUNILEtBQUssQ0FBQyxpQkFBaUI7UUFDckIsTUFBTSxJQUFJLENBQUMsS0FBSyxDQUFDLDRCQUE0QixDQUFDLENBQUE7SUFDaEQsQ0FBQztJQUVEOzs7OztPQUtHO0lBQ0gsS0FBSyxDQUFDLGFBQWEsQ0FBQyxTQUFTLEVBQUUsSUFBSSxHQUFHLEVBQUU7UUFDdEMsTUFBTSxRQUFRLEdBQUcsTUFBTSxDQUFDLE1BQU0sQ0FBQyxFQUFDLFNBQVMsRUFBRSxNQUFNLEVBQUUsSUFBSSxFQUFDLEVBQUUsSUFBSSxDQUFDLENBQUE7UUFDL0QsTUFBTSxTQUFTLEdBQUcsSUFBSSxTQUFTLENBQUMsUUFBUSxDQUFDLENBQUE7UUFFekMsT0FBTyxNQUFNLFNBQVMsQ0FBQyxNQUFNLEVBQUUsQ0FBQTtJQUNqQyxDQUFDO0lBRUQ7OztPQUdHO0lBQ0gsT0FBTyxLQUFLLE9BQU8sT0FBTyxDQUFBLENBQUMsQ0FBQztJQUU1Qjs7O09BR0c7SUFDSCxpQkFBaUIsS0FBSyxPQUFPLElBQUksQ0FBQSxDQUFDLENBQUM7SUFFbkM7OztPQUdHO0lBQ0gsd0JBQXdCLEtBQUssT0FBTyxJQUFJLENBQUEsQ0FBQyxDQUFDO0lBRTFDOzs7O09BSUc7SUFDSCxzQkFBc0IsQ0FBQyxLQUFLO1FBQzFCLGdDQUFnQztRQUNoQyxJQUFJLFlBQVksR0FBRyxLQUFLLENBQUE7UUFDeEIsSUFBSSxlQUFlLEdBQUcsS0FBSyxDQUFBO1FBRTNCLE9BQU8sWUFBWSxFQUFFLENBQUM7WUFDcEIsTUFBTSxTQUFTLEdBQUcsTUFBTSxJQUFJLFlBQVksSUFBSSxPQUFPLFlBQVksQ0FBQyxJQUFJLElBQUksUUFBUSxDQUFDLENBQUMsQ0FBQyxZQUFZLENBQUMsSUFBSSxDQUFDLENBQUMsQ0FBQyxTQUFTLENBQUE7WUFDaEgsTUFBTSxPQUFPLEdBQUcsWUFBWSxDQUFDLE9BQU8sSUFBSSxFQUFFLENBQUE7WUFFMUMsSUFBSSxTQUFTLElBQUksY0FBYyxJQUFJLE9BQU8sQ0FBQyxRQUFRLENBQUMsb0NBQW9DLENBQUMsRUFBRSxDQUFDO2dCQUMxRixPQUFPLEVBQUMsS0FBSyxFQUFFLElBQUksRUFBRSxTQUFTLEVBQUUsS0FBSyxFQUFFLE1BQU0sRUFBRSxFQUFFLEVBQUMsQ0FBQTtZQUNwRCxDQUFDO1lBRUQsMEZBQTBGO1lBQzFGLDJGQUEyRjtZQUMzRiw2RkFBNkY7WUFDN0YsSUFBSSxTQUFTLElBQUksa0JBQWtCLElBQUksT0FBTyxDQUFDLFFBQVEsQ0FBQyxrQkFBa0IsQ0FBQyxJQUFJLE9BQU8sQ0FBQyxRQUFRLENBQUMsZ0JBQWdCLENBQUMsRUFBRSxDQUFDO2dCQUNsSCxPQUFPLEVBQUMsS0FBSyxFQUFFLEtBQUssRUFBRSxTQUFTLEVBQUUsS0FBSyxFQUFFLFFBQVEsRUFBRSxJQUFJLEVBQUUsY0FBYyxFQUFFLFVBQVUsRUFBRSxNQUFNLEVBQUUsRUFBRSxFQUFDLENBQUE7WUFDakcsQ0FBQztZQUVELElBQUksU0FBUyxJQUFJLHNCQUFzQixJQUFJLE9BQU8sQ0FBQyxRQUFRLENBQUMsNEJBQTRCLENBQUMsRUFBRSxDQUFDO2dCQUMxRixPQUFPLEVBQUMsS0FBSyxFQUFFLEtBQUssRUFBRSxTQUFTLEVBQUUsS0FBSyxFQUFFLFFBQVEsRUFBRSxJQUFJLEVBQUUsY0FBYyxFQUFFLG1CQUFtQixFQUFFLE1BQU0sRUFBRSxFQUFFLEVBQUMsQ0FBQTtZQUMxRyxDQUFDO1lBRUQsZUFBZSxLQUFLLENBQ2xCLFNBQVMsSUFBSSxjQUFjO2dCQUMzQixPQUFPLENBQUMsUUFBUSxDQUFDLGNBQWMsQ0FBQztnQkFDaEMsT0FBTyxDQUFDLFFBQVEsQ0FBQyxzQkFBc0IsQ0FBQztnQkFDeEMsT0FBTyxDQUFDLFFBQVEsQ0FBQywwQkFBMEIsQ0FBQztnQkFDNUMsT0FBTyxDQUFDLFFBQVEsQ0FBQyxpQkFBaUIsQ0FBQyxDQUNwQyxDQUFBO1lBRUQsWUFBWSxHQUFHLFlBQVksQ0FBQyxLQUFLLFlBQVksS0FBSyxDQUFDLENBQUMsQ0FBQyxZQUFZLENBQUMsS0FBSyxDQUFDLENBQUMsQ0FBQyxTQUFTLENBQUE7UUFDckYsQ0FBQztRQUVELE9BQU87WUFDTCxLQUFLLEVBQUUsZUFBZTtZQUN0QixTQUFTLEVBQUUsZUFBZTtZQUMxQixNQUFNLEVBQUUsRUFBRTtTQUNYLENBQUE7SUFDSCxDQUFDO0lBRUQ7Ozs7OztPQU1HO0lBQ0gsS0FBSyxDQUFDLDBCQUEwQixDQUFDLFFBQVE7UUFDdkMsSUFBSSxRQUFRLENBQUMsY0FBYyxJQUFJLG1CQUFtQjtZQUFFLE9BQU8sRUFBQyxhQUFhLEVBQUUsZ0JBQWdCLEVBQUMsQ0FBQTtRQUU1RixJQUFJLE1BQU0sQ0FBQTtRQUVWLElBQUksQ0FBQztZQUNILE1BQU0sR0FBRyxNQUFNLElBQUksQ0FBQyw0QkFBNEIsRUFBRSxDQUFBO1FBQ3BELENBQUM7UUFBQyxNQUFNLENBQUM7WUFDUCxPQUFPLEVBQUMsYUFBYSxFQUFFLFFBQVEsRUFBQyxDQUFBO1FBQ2xDLENBQUM7UUFFRCxPQUFPO1lBQ0wscUJBQXFCLEVBQUUsSUFBSSxDQUFDLHNCQUFzQixDQUFDLE1BQU0sQ0FBQztZQUMxRCxhQUFhLEVBQUUsVUFBVTtTQUMxQixDQUFBO0lBQ0gsQ0FBQztJQUVEOzs7T0FHRztJQUNILEtBQUssQ0FBQyw0QkFBNEI7UUFDaEMsTUFBTSxjQUFjLEdBQUcsd0ZBQXdGLENBQUMsQ0FBQyxJQUFJLENBQUMsSUFBSSxDQUFDLENBQUE7UUFDM0gsTUFBTSxnQkFBZ0IsR0FBRyxjQUFjLEVBQUUsTUFBTSxFQUFFLGdCQUFnQixDQUFBO1FBQ2pFLE1BQU0sYUFBYSxHQUFHLGdCQUFnQixJQUFJLElBQUksQ0FBQyxXQUFXLEVBQUUsQ0FBQTtRQUU1RCxPQUFPLE1BQU0sSUFBSSxPQUFPLENBQUMsQ0FBQyxPQUFPLEVBQUUsTUFBTSxFQUFFLEVBQUU7WUFDM0MscURBQXFEO1lBQ3JELElBQUksVUFBVSxDQUFBO1lBQ2QsSUFBSSxPQUFPLEdBQUcsS0FBSyxDQUFBO1lBQ25COzs7OztlQUtHO1lBQ0gsTUFBTSxNQUFNLEdBQUcsQ0FBQyxLQUFLLEVBQUUsTUFBTSxHQUFHLEVBQUUsRUFBRSxFQUFFO2dCQUNwQyxJQUFJLE9BQU87b0JBQUUsT0FBTTtnQkFDbkIsT0FBTyxHQUFHLElBQUksQ0FBQTtnQkFDZCxZQUFZLENBQUMsT0FBTyxDQUFDLENBQUE7Z0JBQ3JCLElBQUksVUFBVTtvQkFBRSxVQUFVLENBQUMsT0FBTyxFQUFFLENBQUE7Z0JBQ3BDLElBQUksS0FBSztvQkFBRSxNQUFNLENBQUMsS0FBSyxDQUFDLENBQUE7O29CQUNuQixPQUFPLENBQUMsTUFBTSxDQUFDLENBQUE7WUFDdEIsQ0FBQyxDQUFBO1lBQ0QsTUFBTSxPQUFPLEdBQUcsVUFBVSxDQUFDLEdBQUcsRUFBRSxDQUFDLE1BQU0sQ0FBQyxJQUFJLEtBQUssQ0FBQyxpQ0FBaUMsQ0FBQyxDQUFDLEVBQUUsa0NBQWtDLENBQUMsQ0FBQTtZQUUxSCxJQUFJLENBQUM7Z0JBQ0gsVUFBVSxHQUFHLEtBQUssQ0FBQyxnQkFBZ0IsQ0FBQyxhQUFhLENBQUMsQ0FBQTtnQkFDbEQsVUFBVSxDQUFDLEVBQUUsQ0FBQyxPQUFPLEVBQUUsQ0FBQyxLQUFLLEVBQUUsRUFBRSxDQUFDLE1BQU0sQ0FBQyxLQUFLLENBQUMsQ0FBQyxDQUFBO2dCQUNoRCxVQUFVLENBQUMsS0FBSyxDQUFDLDJCQUEyQixFQUFFLENBQUMsS0FBSyxFQUFFLElBQUksRUFBRSxFQUFFO29CQUM1RCxJQUFJLEtBQUssRUFBRSxDQUFDO3dCQUNWLE1BQU0sQ0FBQyxLQUFLLENBQUMsQ0FBQTt3QkFDYixPQUFNO29CQUNSLENBQUM7b0JBRUQsTUFBTSxRQUFRLEdBQUcsS0FBSyxDQUFDLE9BQU8sQ0FBQyxJQUFJLENBQUMsQ0FBQyxDQUFDLENBQUMsSUFBSSxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxTQUFTLENBQUE7b0JBQzFELE1BQU0sTUFBTSxHQUFHLFFBQVEsSUFBSSxPQUFPLFFBQVEsQ0FBQyxNQUFNLElBQUksUUFBUSxDQUFDLENBQUMsQ0FBQyxRQUFRLENBQUMsTUFBTSxDQUFDLENBQUMsQ0FBQyxFQUFFLENBQUE7b0JBRXBGLE1BQU0sQ0FBQyxTQUFTLEVBQUUsTUFBTSxDQUFDLENBQUE7Z0JBQzNCLENBQUMsQ0FBQyxDQUFBO1lBQ0osQ0FBQztZQUFDLE9BQU8sS0FBSyxFQUFFLENBQUM7Z0JBQ2YsTUFBTSxDQUFDLEtBQUssWUFBWSxLQUFLLENBQUMsQ0FBQyxDQUFDLEtBQUssQ0FBQyxDQUFDLENBQUMsSUFBSSxLQUFLLENBQUMsOEJBQThCLENBQUMsQ0FBQyxDQUFBO1lBQ3BGLENBQUM7UUFDSCxDQUFDLENBQUMsQ0FBQTtJQUNKLENBQUM7SUFFRDs7Ozs7T0FLRztJQUNILHNCQUFzQixDQUFDLE1BQU07UUFDM0IsT0FBTywwQkFBMEIsQ0FBQyxNQUFNLENBQUMsQ0FBQTtJQUMzQyxDQUFDO0lBRUQ7Ozs7O09BS0c7SUFDSCxLQUFLLENBQUMsWUFBWSxDQUFDLEdBQUcsRUFBRSxPQUFPLEdBQUcsRUFBRTtRQUNsQyxJQUFJLENBQUMsSUFBSSxDQUFDLElBQUk7WUFBRSxNQUFNLElBQUksQ0FBQyxPQUFPLEVBQUUsQ0FBQTtRQUNwQyxJQUFJLENBQUMsSUFBSSxDQUFDLElBQUk7WUFBRSxNQUFNLElBQUksS0FBSyxDQUFDLGlDQUFpQyxDQUFDLENBQUE7UUFFbEUsSUFBSSxDQUFDO1lBQ0gsT0FBTyxNQUFNLEtBQUssQ0FBQyxJQUFJLENBQUMsSUFBSSxFQUFFLEdBQUcsRUFBRSxFQUFDLE1BQU0sRUFBRSxPQUFPLENBQUMsTUFBTSxFQUFDLENBQUMsQ0FBQTtRQUM5RCxDQUFDO1FBQUMsT0FBTyxLQUFLLEVBQUUsQ0FBQztZQUNmLHlFQUF5RTtZQUN6RSx3RUFBd0U7WUFDeEUsSUFBSSxLQUFLLFlBQVksaUJBQWlCLEVBQUUsQ0FBQztnQkFDdkMsSUFBSSxLQUFLLENBQUMsbUJBQW1CO29CQUFFLElBQUksQ0FBQywyQkFBMkIsRUFBRSxDQUFBO2dCQUNqRSxNQUFNLEtBQUssQ0FBQTtZQUNiLENBQUM7WUFFRCxvQ0FBb0M7WUFDcEMsSUFBSSxLQUFLLFlBQVksS0FBSyxFQUFFLENBQUM7Z0JBQzNCLE1BQU0sSUFBSSxLQUFLLENBQUMsaUJBQWlCLEtBQUssQ0FBQyxPQUFPLEVBQUUsRUFBRSxFQUFDLEtBQUssRUFBRSxLQUFLLEVBQUMsQ0FBQyxDQUFBO1lBQ25FLENBQUM7aUJBQU0sQ0FBQztnQkFDTixNQUFNLElBQUksS0FBSyxDQUFDLGlCQUFpQixLQUFLLEVBQUUsRUFBRSxFQUFDLEtBQUssRUFBRSxLQUFLLEVBQUMsQ0FBQyxDQUFBO1lBQzNELENBQUM7UUFDSCxDQUFDO0lBQ0gsQ0FBQztJQUVEOzs7Ozs7O09BT0c7SUFDSCxLQUFLLENBQUMsQ0FBQyxXQUFXLENBQUMsR0FBRyxFQUFFLE9BQU8sR0FBRyxFQUFFO1FBQ2xDLE1BQU0sSUFBSSxDQUFDLHNCQUFzQixDQUFDLE9BQU8sQ0FBQyxjQUFjLENBQUMsQ0FBQTtRQUV6RCxJQUFJLENBQUMsSUFBSSxDQUFDLElBQUk7WUFBRSxNQUFNLElBQUksQ0FBQyxPQUFPLEVBQUUsQ0FBQTtRQUNwQyxJQUFJLENBQUMsSUFBSSxDQUFDLElBQUk7WUFBRSxNQUFNLElBQUksS0FBSyxDQUFDLGlDQUFpQyxDQUFDLENBQUE7UUFFbEUsTUFBTSxjQUFjLEdBQUcsSUFBSSxDQUFDLDBCQUEwQixDQUFDLEdBQUcsQ0FBQyxDQUFBO1FBQzNELElBQUksTUFBTSxHQUFHLElBQUksQ0FBQTtRQUVqQixJQUFJLENBQUM7WUFDSCxLQUFLLENBQUMsQ0FBQyxXQUFXLENBQUMsSUFBSSxDQUFDLElBQUksRUFBRSxHQUFHLENBQUMsQ0FBQTtZQUNsQyxNQUFNLEdBQUcsS0FBSyxDQUFBO1FBQ2hCLENBQUM7Z0JBQVMsQ0FBQztZQUNULElBQUksQ0FBQywyQkFBMkIsQ0FBQyxjQUFjLEVBQUUsTUFBTSxDQUFDLENBQUE7UUFDMUQsQ0FBQztJQUNILENBQUM7SUFFRDs7OztPQUlHO0lBQ0gsS0FBSyxDQUFDLG1CQUFtQixDQUFDLEdBQUc7UUFDM0IsSUFBSSxDQUFDLElBQUksQ0FBQyxJQUFJO1lBQUUsTUFBTSxJQUFJLENBQUMsT0FBTyxFQUFFLENBQUE7UUFDcEMsSUFBSSxDQUFDLElBQUksQ0FBQyxJQUFJO1lBQUUsTUFBTSxJQUFJLEtBQUssQ0FBQyxpQ0FBaUMsQ0FBQyxDQUFBO1FBQ2xFLE1BQU0sSUFBSSxHQUFHLElBQUksQ0FBQyxJQUFJLENBQUE7UUFFdEIsT0FBTyxNQUFNLElBQUksT0FBTyxDQUFDLENBQUMsT0FBTyxFQUFFLE1BQU0sRUFBRSxFQUFFO1lBQzNDLElBQUksQ0FBQyxLQUFLLENBQUMsR0FBRyxFQUFFLENBQUMsS0FBSyxFQUFFLE1BQU0sRUFBRSxFQUFFO2dCQUNoQyxJQUFJLEtBQUs7b0JBQUUsTUFBTSxDQUFDLEtBQUssQ0FBQyxDQUFBOztvQkFDbkIsT0FBTyxDQUFDLGNBQWMsSUFBSSxNQUFNLENBQUMsQ0FBQyxDQUFDLE1BQU0sQ0FBQyxZQUFZLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFBO1lBQ2xFLENBQUMsQ0FBQyxDQUFBO1FBQ0osQ0FBQyxDQUFDLENBQUE7SUFDSixDQUFDO0lBRUQ7Ozs7Ozs7T0FPRztJQUNILEtBQUssQ0FBQyxtQkFBbUIsQ0FBQyxZQUFZO1FBQ3BDLElBQUksQ0FBQyxJQUFJLENBQUMsT0FBTyxFQUFFLENBQUMsa0JBQWtCO1lBQUUsT0FBTyxLQUFLLENBQUE7UUFFcEQsZ0ZBQWdGO1FBQ2hGLHdFQUF3RTtRQUN4RSxJQUFJLENBQUMsb0JBQW9CLENBQUMsWUFBWSxDQUFDLENBQUE7UUFFdkMsSUFBSSxDQUFDLElBQUksQ0FBQyxJQUFJO1lBQUUsTUFBTSxJQUFJLENBQUMsT0FBTyxFQUFFLENBQUE7UUFDcEMsSUFBSSxDQUFDLElBQUksQ0FBQyxJQUFJO1lBQUUsTUFBTSxJQUFJLEtBQUssQ0FBQyxpQ0FBaUMsQ0FBQyxDQUFBO1FBRWxFLE1BQU0sSUFBSSxHQUFHLElBQUksQ0FBQyxJQUFJLENBQUE7UUFDdEIsTUFBTSxjQUFjLEdBQUcsSUFBSSxDQUFDLDBCQUEwQixDQUFDLFlBQVksQ0FBQyxDQUFBO1FBQ3BFLElBQUksTUFBTSxHQUFHLElBQUksQ0FBQTtRQUVqQixJQUFJLENBQUM7WUFDSCxNQUFNLElBQUksT0FBTyxDQUFDLENBQUMsT0FBTyxFQUFFLE1BQU0sRUFBRSxFQUFFO2dCQUNwQyxJQUFJLENBQUMsS0FBSyxDQUFDLFlBQVksRUFBRSxDQUFDLEtBQUssRUFBRSxFQUFFO29CQUNqQyxJQUFJLEtBQUs7d0JBQUUsTUFBTSxDQUFDLEtBQUssQ0FBQyxDQUFBOzt3QkFDbkIsT0FBTyxDQUFDLFNBQVMsQ0FBQyxDQUFBO2dCQUN6QixDQUFDLENBQUMsQ0FBQTtZQUNKLENBQUMsQ0FBQyxDQUFBO1lBQ0YsTUFBTSxHQUFHLEtBQUssQ0FBQTtRQUNoQixDQUFDO2dCQUFTLENBQUM7WUFDVCxJQUFJLENBQUMsMkJBQTJCLENBQUMsY0FBYyxFQUFFLE1BQU0sQ0FBQyxDQUFBO1FBQzFELENBQUM7UUFFRCxPQUFPLElBQUksQ0FBQTtJQUNiLENBQUM7SUFFRDs7Ozs7T0FLRztJQUNILEtBQUssQ0FBQyxjQUFjLENBQUMsTUFBTTtRQUN6QixJQUFJLENBQUMsSUFBSSxDQUFDLE9BQU8sRUFBRSxDQUFDLGtCQUFrQixFQUFFLENBQUM7WUFDdkMsTUFBTSxLQUFLLENBQUMsY0FBYyxDQUFDLE1BQU0sQ0FBQyxDQUFBO1lBQ2xDLE9BQU07UUFDUixDQUFDO1FBRUQsTUFBTSxVQUFVLEdBQUcsTUFBTSxDQUFDLEdBQUcsQ0FBQyxDQUFDLEtBQUssRUFBRSxFQUFFLENBQUMsa0JBQWtCLElBQUksQ0FBQyxVQUFVLENBQUMsS0FBSyxDQUFDLE9BQU8sRUFBRSxDQUFDLEVBQUUsQ0FBQyxDQUFBO1FBRTlGLE1BQU0sSUFBSSxDQUFDLEtBQUssQ0FBQyxVQUFVLENBQUMsSUFBSSxDQUFDLEtBQUssQ0FBQyxDQUFDLENBQUE7SUFDMUMsQ0FBQztJQUVEOzs7O09BSUc7SUFDSCxVQUFVLENBQUMsS0FBSyxJQUFJLE9BQU8sSUFBSSxXQUFXLENBQUMsRUFBQyxLQUFLLEVBQUMsQ0FBQyxDQUFDLEtBQUssRUFBRSxDQUFBLENBQUMsQ0FBQztJQUU3RDs7O09BR0c7SUFDSCxvQ0FBb0MsS0FBSyxPQUFPLElBQUksQ0FBQSxDQUFDLENBQUM7SUFDdEQsNkJBQTZCLEtBQUssT0FBTyxLQUFLLENBQUEsQ0FBQyxDQUFDO0lBQ2hELCtCQUErQixLQUFLLE9BQU8sSUFBSSxDQUFBLENBQUMsQ0FBQztJQUVqRDs7OztPQUlHO0lBQ0gsTUFBTSxDQUFDLEtBQUs7UUFDVixNQUFNLHNCQUFzQixHQUFHLElBQUksQ0FBQyxJQUFJO1lBQ3RDLENBQUMsQ0FBQyxJQUFJLENBQUMsSUFBSSxDQUFDLE1BQU0sQ0FBQyxJQUFJLENBQUMsYUFBYSxDQUFDLEtBQUssQ0FBQyxDQUFDO1lBQzdDLENBQUMsQ0FBQyxLQUFLLENBQUMsTUFBTSxDQUFDLElBQUksQ0FBQyxhQUFhLENBQUMsS0FBSyxDQUFDLENBQUMsQ0FBQTtRQUUzQyxPQUFPLHNCQUFzQixDQUFDLEtBQUssQ0FBQyxDQUFDLEVBQUUsc0JBQXNCLENBQUMsTUFBTSxHQUFHLENBQUMsQ0FBQyxDQUFBO0lBQzNFLENBQUM7SUFFRDs7OztPQUlHO0lBQ0gsS0FBSyxDQUFDLEtBQUs7UUFDVCxJQUFJLElBQUksQ0FBQyxJQUFJLEVBQUUsQ0FBQztZQUNkLE9BQU8sSUFBSSxDQUFDLElBQUksQ0FBQyxNQUFNLENBQUMsSUFBSSxDQUFDLGFBQWEsQ0FBQyxLQUFLLENBQUMsQ0FBQyxDQUFBO1FBQ3BELENBQUM7UUFFRCxPQUFPLEtBQUssQ0FBQyxNQUFNLENBQUMsSUFBSSxDQUFDLGFBQWEsQ0FBQyxLQUFLLENBQUMsQ0FBQyxDQUFBO0lBQ2hELENBQUM7SUFFRDs7OztPQUlHO0lBQ0gsU0FBUyxDQUFDLEVBQUMsU0FBUyxFQUFFLFVBQVUsRUFBQztRQUMvQixNQUFNLGlCQUFpQixHQUFHLElBQUksTUFBTSxDQUFDLEVBQUMsVUFBVSxFQUFFLE1BQU0sRUFBRSxJQUFJLEVBQUUsU0FBUyxFQUFDLENBQUMsQ0FBQTtRQUUzRSxPQUFPLGlCQUFpQixDQUFDLEtBQUssRUFBRSxDQUFBO0lBQ2xDLENBQUM7SUFFRDs7Ozs7T0FLRztJQUNILFNBQVMsQ0FBQyxJQUFJO1FBQ1osTUFBTSxVQUFVLEdBQUcsTUFBTSxDQUFDLE1BQU0sQ0FBQyxFQUFDLE1BQU0sRUFBRSxJQUFJLEVBQUMsRUFBRSxJQUFJLENBQUMsQ0FBQTtRQUN0RCxNQUFNLE1BQU0sR0FBRyxJQUFJLE1BQU0sQ0FBQyxVQUFVLENBQUMsQ0FBQTtRQUVyQyxPQUFPLE1BQU0sQ0FBQyxLQUFLLEVBQUUsQ0FBQTtJQUN2QixDQUFDO0lBRUQ7Ozs7Ozs7T0FPRztJQUNILCtCQUErQixDQUFDLEtBQUs7UUFDbkMsSUFBSSxZQUFZLEdBQUcsMkRBQTJELENBQUM7UUFDN0Usc0JBQXNCLENBQUMsQ0FBQyxLQUFLLENBQUMsQ0FDL0IsQ0FBQTtRQUVELEtBQUssSUFBSSxLQUFLLEdBQUcsQ0FBQyxFQUFFLEtBQUssR0FBRyxDQUFDLElBQUksWUFBWSxFQUFFLEtBQUssRUFBRSxFQUFFLENBQUM7WUFDdkQsSUFBSSxZQUFZLENBQUMsSUFBSSxLQUFLLDJCQUEyQjtnQkFBRSxPQUFPLElBQUksQ0FBQTtZQUNsRSxZQUFZLEdBQUcsMkRBQTJELENBQUM7WUFDekUsc0JBQXNCLENBQUMsQ0FBQyxZQUFZLENBQUMsS0FBSyxDQUFDLENBQzVDLENBQUE7UUFDSCxDQUFDO1FBRUQsT0FBTyxLQUFLLENBQUE7SUFDZCxDQUFDO0lBRUQ7OztPQUdHO0lBQ0gsS0FBSyxDQUFDLFNBQVM7UUFDYixPQUFPLE1BQU0sSUFBSSxDQUFDLHFCQUFxQixDQUFDLFFBQVEsRUFBRSxLQUFLLElBQUksRUFBRTtZQUMzRCxNQUFNLE1BQU0sR0FBRyxNQUFNLElBQUksQ0FBQyxLQUFLLENBQUMsa0JBQWtCLENBQUMsQ0FBQTtZQUNuRCxNQUFNLE1BQU0sR0FBRyxFQUFFLENBQUE7WUFFakIsS0FBSyxNQUFNLEdBQUcsSUFBSSxNQUFNLEVBQUUsQ0FBQztnQkFDekIsTUFBTSxLQUFLLEdBQUcsSUFBSSxLQUFLLENBQUMsSUFBSSxFQUFFLHFDQUFxQyxDQUFDLENBQUMsR0FBRyxDQUFDLENBQUMsQ0FBQTtnQkFFMUUsTUFBTSxDQUFDLElBQUksQ0FBQyxLQUFLLENBQUMsQ0FBQTtZQUNwQixDQUFDO1lBRUQsT0FBTyxNQUFNLENBQUE7UUFDZixDQUFDLENBQUMsQ0FBQTtJQUNKLENBQUM7SUFFRDs7O09BR0c7SUFDSCxLQUFLLENBQUMsWUFBWTtRQUNoQixPQUFPLE1BQU0sSUFBSSxDQUFDLHFCQUFxQixDQUFDLGNBQWMsRUFBRSxLQUFLLElBQUksRUFBRSxDQUFDLE1BQU0sSUFBSSxZQUFZLENBQUMsRUFBQyxNQUFNLEVBQUUsSUFBSSxFQUFDLENBQUMsQ0FBQyxLQUFLLEVBQUUsQ0FBQyxDQUFBO0lBQ3JILENBQUM7SUFFRDs7OztPQUlHO0lBQ0gsS0FBSyxDQUFDLFlBQVksQ0FBQyxPQUFPLEdBQUcsRUFBRTtRQUM3QixNQUFNLE1BQU0sR0FBRyxNQUFNLElBQUksQ0FBQyxLQUFLLENBQUMsMkNBQTJDLEVBQUUsT0FBTyxDQUFDLENBQUE7UUFFckYsT0FBTyxJQUFJLENBQUMsTUFBTSxFQUFFLENBQUMsRUFBRSxnQkFBZ0IsQ0FBQyxDQUFBO0lBQzFDLENBQUM7SUFFRDs7O09BR0c7SUFDSCxPQUFPO1FBQ0wsSUFBSSxDQUFDLElBQUksQ0FBQyxRQUFRO1lBQUUsSUFBSSxDQUFDLFFBQVEsR0FBRyxJQUFJLE9BQU8sQ0FBQyxFQUFDLE1BQU0sRUFBRSxJQUFJLEVBQUMsQ0FBQyxDQUFBO1FBRS9ELE9BQU8sSUFBSSxDQUFDLFFBQVEsQ0FBQTtJQUN0QixDQUFDO0lBRUQ7Ozs7T0FJRztJQUNILEtBQUssQ0FBQyx1QkFBdUIsQ0FBQyxPQUFPLEdBQUcsRUFBRTtRQUN4QyxNQUFNLElBQUksQ0FBQyxLQUFLLENBQUMsbUJBQW1CLEVBQUUsT0FBTyxDQUFDLENBQUE7SUFDaEQsQ0FBQztJQUVEOzs7O09BSUc7SUFDSCxTQUFTLENBQUMsRUFBQyxVQUFVLEVBQUUsSUFBSSxFQUFFLFNBQVMsRUFBQztRQUNyQyxNQUFNLE1BQU0sR0FBRyxJQUFJLE1BQU0sQ0FBQyxFQUFDLFVBQVUsRUFBRSxJQUFJLEVBQUUsTUFBTSxFQUFFLElBQUksRUFBRSxTQUFTLEVBQUMsQ0FBQyxDQUFBO1FBRXRFLE9BQU8sTUFBTSxDQUFDLEtBQUssRUFBRSxDQUFBO0lBQ3ZCLENBQUM7SUFFRDs7OztPQUlHO0lBQ0gsU0FBUyxDQUFDLElBQUk7UUFDWixNQUFNLE1BQU0sR0FBRyxJQUFJLE1BQU0sQ0FBQyxFQUFDLEdBQUcsSUFBSSxFQUFFLE1BQU0sRUFBRSxJQUFJLEVBQUMsQ0FBQyxDQUFBO1FBRWxELE9BQU8sTUFBTSxDQUFDLEtBQUssRUFBRSxDQUFBO0lBQ3ZCLENBQUM7SUFFRDs7Ozs7Ozs7Ozs7Ozs7T0FjRztJQUNILEtBQUssQ0FBQyxvQkFBb0IsQ0FBQyxJQUFJLEVBQUUsRUFBQyxTQUFTLEVBQUMsR0FBRyxFQUFFO1FBQy9DLE1BQU0sY0FBYyxHQUFHLE9BQU8sU0FBUyxLQUFLLFFBQVEsSUFBSSxTQUFTLElBQUksQ0FBQztZQUNwRSxDQUFDLENBQUMsSUFBSSxDQUFDLElBQUksQ0FBQyxTQUFTLEdBQUcsSUFBSSxDQUFDO1lBQzdCLENBQUMsQ0FBQyxxQ0FBcUMsQ0FBQTtRQUN6QyxNQUFNLElBQUksR0FBRyxNQUFNLElBQUksQ0FBQyxLQUFLLENBQUMsbUJBQW1CLElBQUksQ0FBQyxLQUFLLENBQUMsSUFBSSxDQUFDLEtBQUssY0FBYyxxQ0FBcUMsQ0FBQyxDQUFBO1FBQzFILE1BQU0sTUFBTSxHQUFHLElBQUksRUFBRSxDQUFDLENBQUMsQ0FBQyxFQUFFLDhCQUE4QixDQUFBO1FBRXhELElBQUksTUFBTSxLQUFLLElBQUksSUFBSSxNQUFNLEtBQUssU0FBUyxFQUFFLENBQUM7WUFDNUMsTUFBTSxJQUFJLEtBQUssQ0FBQyw0Q0FBNEMsSUFBSSxDQUFDLFNBQVMsQ0FBQyxJQUFJLENBQUMsMERBQTBELENBQUMsQ0FBQTtRQUM3SSxDQUFDO1FBRUQsT0FBTyxNQUFNLENBQUMsTUFBTSxDQUFDLEtBQUssQ0FBQyxDQUFBO0lBQzdCLENBQUM7SUFFRDs7OztPQUlHO0lBQ0gsS0FBSyxDQUFDLHVCQUF1QixDQUFDLElBQUk7UUFDaEMsTUFBTSxJQUFJLEdBQUcsTUFBTSxJQUFJLENBQUMsS0FBSyxDQUFDLG1CQUFtQixJQUFJLENBQUMsS0FBSyxDQUFDLElBQUksQ0FBQyx3Q0FBd0MsQ0FBQyxDQUFBO1FBQzFHLE1BQU0sTUFBTSxHQUFHLElBQUksRUFBRSxDQUFDLENBQUMsQ0FBQyxFQUFFLDhCQUE4QixDQUFBO1FBRXhELElBQUksTUFBTSxLQUFLLElBQUksSUFBSSxNQUFNLEtBQUssU0FBUyxFQUFFLENBQUM7WUFDNUMsTUFBTSxJQUFJLEtBQUssQ0FBQyw0Q0FBNEMsSUFBSSxDQUFDLFNBQVMsQ0FBQyxJQUFJLENBQUMsMERBQTBELENBQUMsQ0FBQTtRQUM3SSxDQUFDO1FBRUQsT0FBTyxNQUFNLENBQUMsTUFBTSxDQUFDLEtBQUssQ0FBQyxDQUFBO0lBQzdCLENBQUM7SUFFRDs7OztPQUlHO0lBQ0gsS0FBSyxDQUFDLG9CQUFvQixDQUFDLElBQUk7UUFDN0IsTUFBTSxJQUFJLEdBQUcsTUFBTSxJQUFJLENBQUMsS0FBSyxDQUFDLHVCQUF1QixJQUFJLENBQUMsS0FBSyxDQUFDLElBQUksQ0FBQyxxQ0FBcUMsRUFBRSxFQUFDLEtBQUssRUFBRSxLQUFLLEVBQUMsQ0FBQyxDQUFBO1FBQzNILE1BQU0sTUFBTSxHQUFHLElBQUksRUFBRSxDQUFDLENBQUMsQ0FBQyxFQUFFLDhCQUE4QixDQUFBO1FBRXhELE9BQU8sTUFBTSxDQUFDLE1BQU0sQ0FBQyxLQUFLLENBQUMsQ0FBQTtJQUM3QixDQUFDO0lBRUQ7Ozs7O09BS0c7SUFDSCxLQUFLLENBQUMseUJBQXlCLENBQUMsSUFBSTtRQUNsQyxNQUFNLElBQUksR0FBRyxNQUFNLElBQUksQ0FBQyxLQUFLLENBQUMsdUJBQXVCLElBQUksQ0FBQyxLQUFLLENBQUMsSUFBSSxDQUFDLHFDQUFxQyxDQUFDLENBQUE7UUFDM0csTUFBTSxNQUFNLEdBQUcsSUFBSSxFQUFFLENBQUMsQ0FBQyxDQUFDLEVBQUUsOEJBQThCLENBQUE7UUFFeEQsT0FBTyxNQUFNLEtBQUssSUFBSSxJQUFJLE1BQU0sS0FBSyxTQUFTLENBQUE7SUFDaEQsQ0FBQztDQUNGIiwic291cmNlc0NvbnRlbnQiOlsiLy8gQHRzLWNoZWNrXG5cbmltcG9ydCBBbHRlclRhYmxlIGZyb20gXCIuL3NxbC9hbHRlci10YWJsZS5qc1wiXG5pbXBvcnQgQmFzZSBmcm9tIFwiLi4vYmFzZS5qc1wiXG5pbXBvcnQgQ3JlYXRlRGF0YWJhc2UgZnJvbSBcIi4vc3FsL2NyZWF0ZS1kYXRhYmFzZS5qc1wiXG5pbXBvcnQgQ3JlYXRlSW5kZXggZnJvbSBcIi4vc3FsL2NyZWF0ZS1pbmRleC5qc1wiXG5pbXBvcnQgQ3JlYXRlVGFibGUgZnJvbSBcIi4vc3FsL2NyZWF0ZS10YWJsZS5qc1wiXG5pbXBvcnQgRGVsZXRlIGZyb20gXCIuL3NxbC9kZWxldGUuanNcIlxuaW1wb3J0IHtkaWdnfSBmcm9tIFwiZGlnZ2VyaXplXCJcbmltcG9ydCBEcm9wRGF0YWJhc2UgZnJvbSBcIi4vc3FsL2Ryb3AtZGF0YWJhc2UuanNcIlxuaW1wb3J0IERyb3BUYWJsZSBmcm9tIFwiLi9zcWwvZHJvcC10YWJsZS5qc1wiXG5pbXBvcnQgSW5zZXJ0IGZyb20gXCIuL3NxbC9pbnNlcnQuanNcIlxuaW1wb3J0IE9wdGlvbnMgZnJvbSBcIi4vb3B0aW9ucy5qc1wiXG5pbXBvcnQgbXlzcWwgZnJvbSBcIm15c3FsXCJcbmltcG9ydCBxdWVyeSBmcm9tIFwiLi9xdWVyeS5qc1wiXG5pbXBvcnQgUXVlcnlBYm9ydGVkRXJyb3IgZnJvbSBcIi4uLy4uL3F1ZXJ5LWFib3J0ZWQtZXJyb3IuanNcIlxuaW1wb3J0IFF1ZXJ5UGFyc2VyIGZyb20gXCIuL3F1ZXJ5LXBhcnNlci5qc1wiXG5pbXBvcnQgc3RyZWFtUXVlcnkgZnJvbSBcIi4vcXVlcnktc3RyZWFtLmpzXCJcbmltcG9ydCBSZW1vdmVJbmRleCBmcm9tIFwiLi9zcWwvcmVtb3ZlLWluZGV4LmpzXCJcbmltcG9ydCBUYWJsZSBmcm9tIFwiLi90YWJsZS5qc1wiXG5pbXBvcnQgU3RydWN0dXJlU3FsIGZyb20gXCIuL3N0cnVjdHVyZS1zcWwuanNcIlxuaW1wb3J0IFVwc2VydCBmcm9tIFwiLi9zcWwvdXBzZXJ0LmpzXCJcbmltcG9ydCBVcGRhdGUgZnJvbSBcIi4vc3FsL3VwZGF0ZS5qc1wiXG5pbXBvcnQgcGFyc2VJbm5vZGJEZWFkbG9ja1N1bW1hcnkgZnJvbSBcIi4vZGVhZGxvY2stZGlhZ25vc3RpYy1wYXJzZXIuanNcIlxuXG4vKipcbiAqIFNlbnRpbmVsIHRpbWVvdXQgKGluIHNlY29uZHMpIHVzZWQgYXMgdGhlIFwiYmxvY2sgZm9yZXZlclwiIHZhbHVlIHdoZW4gYVxuICogY2FsbGVyIGFza3MgZm9yIGFuIGluZGVmaW5pdGUgYWR2aXNvcnkgbG9jayBhY3F1aXJlLiBNeVNRTCBoaXN0b3JpY2FsbHlcbiAqIGFjY2VwdGVkIG5lZ2F0aXZlIHRpbWVvdXRzIGFzIFwiaW5maW5pdGVcIiwgYnV0IE1hcmlhREIgMTArIHNpbGVudGx5XG4gKiByZXR1cm5zIE5VTEwgZnJvbSBgR0VUX0xPQ0tgIHdoZW4gdGhlIHRpbWVvdXQgaXMgbmVnYXRpdmUsIHNvIHRoZVxuICogZHJpdmVyIGNsYW1wcyB0byBhIGNvbWZvcnRhYmx5IGxhcmdlIHBvc2l0aXZlIHZhbHVlICgxIHllYXIg4omrIGFueVxuICogcmVhbGlzdGljIGNyaXRpY2FsIHNlY3Rpb24pIGluc3RlYWQuXG4gKi9cbmNvbnN0IE1ZU1FMX0lOREVGSU5JVEVfTE9DS19USU1FT1VUX1NFQ09ORFMgPSA2MCAqIDYwICogMjQgKiAzNjVcbmNvbnN0IElOTk9EQl9ERUFETE9DS19DQVBUVVJFX1RJTUVPVVRfTVMgPSAyNTBcblxuZXhwb3J0IGRlZmF1bHQgY2xhc3MgVmVsb2Npb3VzRGF0YWJhc2VEcml2ZXJzTXlzcWwgZXh0ZW5kcyBCYXNle1xuICAvKiogQHR5cGUge2ltcG9ydChcIm15c3FsXCIpLlBvb2wgfCB1bmRlZmluZWR9ICovXG4gIHBvb2wgPSB1bmRlZmluZWRcblxuICAvKiogQHR5cGUge3N0cmluZyB8IG51bGx9ICovXG4gIF9kZXNpcmVkU2Vzc2lvblRpbWVab25lID0gXCIrMDA6MDBcIlxuXG4gIC8qKiBAdHlwZSB7c3RyaW5nIHwgbnVsbH0gKi9cbiAgX2N1cnJlbnRTZXNzaW9uVGltZVpvbmUgPSBudWxsXG5cbiAgLyoqXG4gICAqIFJ1bnMgY29ubmVjdC5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgd2hlbiBjb21wbGV0ZS5cbiAgICovXG4gIGFzeW5jIGNvbm5lY3QoKSB7XG4gICAgdGhpcy5yZXNldEN1cnJlbnRTZXNzaW9uVGltZVpvbmUoKVxuICAgIHRoaXMucG9vbCA9IG15c3FsLmNyZWF0ZVBvb2woT2JqZWN0LmFzc2lnbih7Y29ubmVjdGlvbkxpbWl0OiAxfSwgdGhpcy5jb25uZWN0QXJncygpKSlcbiAgICB0aGlzLnBvb2wub24oXCJlcnJvclwiLCB0aGlzLm9uUG9vbEVycm9yKVxuICB9XG5cbiAgLyoqXG4gICAqIE9uIHBvb2wgZXJyb3IuXG4gICAqIEBwYXJhbSB7RXJyb3J9IGVycm9yIC0gRXJyb3IgZnJvbSB0aGUgY29ubmVjdGlvbiBhdHRlbXB0LlxuICAgKi9cbiAgb25Qb29sRXJyb3IgPSAoZXJyb3IpID0+IHtcbiAgICBjb25zb2xlLmVycm9yKFwiVmVsb2Npb3VzIC8gTXlTUUwgZHJpdmVyIC8gUG9vbCBlcnJvclwiLCBlcnJvcilcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGNsb3NlLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyB3aGVuIGNvbXBsZXRlLlxuICAgKi9cbiAgYXN5bmMgX2Nsb3NlKCkge1xuICAgIGNvbnN0IHBvb2wgPSB0aGlzLnBvb2xcblxuICAgIGlmICghcG9vbCkgcmV0dXJuXG5cbiAgICBhd2FpdCBuZXcgUHJvbWlzZSgocmVzb2x2ZSwgcmVqZWN0KSA9PiB7XG4gICAgICBwb29sLmVuZCgoZXJyb3IpID0+IHtcbiAgICAgICAgaWYgKGVycm9yKSB7XG4gICAgICAgICAgcmVqZWN0KGVycm9yKVxuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgIHJlc29sdmUodW5kZWZpbmVkKVxuICAgICAgICB9XG4gICAgICB9KVxuICAgIH0pXG4gICAgdGhpcy5wb29sID0gdW5kZWZpbmVkXG4gICAgdGhpcy5yZXNldEN1cnJlbnRTZXNzaW9uVGltZVpvbmUoKVxuICB9XG5cbiAgLyoqXG4gICAqIFJlc2V0cyB0aGUgTXlTUUwgc2Vzc2lvbiBzdGF0ZSBhZnRlciBlYWNoIGxvZ2ljYWwgcG9vbCBjaGVja291dCB3aGlsZVxuICAgKiByZXVzaW5nIHRoZSBleGlzdGluZyBwaHlzaWNhbCBjb25uZWN0aW9uLlxuICAgKiBNeVNRTCBleHBvc2VzIG9wZW4tZW5kZWQgc2Vzc2lvbiBzdGF0ZSAodXNlciB2YXJpYWJsZXMsIHRlbXBvcmFyeSB0YWJsZXMsXG4gICAqIHByZXBhcmVkIHN0YXRlbWVudHMsIGBTRVQgU0VTU0lPTmAgY2hhbmdlcyksIHNvIHRoZSBzdGF0ZSBtdXN0IGJlIGNsZWFyZWRcbiAgICogYmVmb3JlIHRoZSBsb2dpY2FsIHBvb2wgZW50cnkgaXMgaGFuZGVkIG91dCBhZ2Fpbi4gYENPTV9DSEFOR0VfVVNFUmBcbiAgICogcGVyZm9ybXMgYSBmdWxsIHNlc3Npb24gcmUtaW5pdGlhbGl6YXRpb24gb24gdGhlIHNlcnZlciBzaWRlIOKAlCB0aGUgc2FtZVxuICAgKiBzdGF0ZSBhIGZyZXNoIGhhbmRzaGFrZSB3b3VsZCBzdGFydCB3aXRoIOKAlCB3aXRob3V0IG9wZW5pbmcgYSBuZXcgVENQXG4gICAqIGNvbm5lY3Rpb24uIFRoYXQga2VlcHMgY2hlY2tvdXRzIGlzb2xhdGVkIGZyb20gZWFjaCBvdGhlciB3aGlsZSBhdm9pZGluZ1xuICAgKiBhIHJlY29ubmVjdCAoaGFuZHNoYWtlICsgYXV0aCArIHNjaGVtYSByZS1pbnRyb3NwZWN0aW9uKSBvbiBldmVyeVxuICAgKiBvcGVyYXRpb24uIElmIHRoZSByZXNldCBmYWlscyB0aGUgcGh5c2ljYWwgc2Vzc2lvbiBpcyBjbG9zZWQgaW5zdGVhZCwgc29cbiAgICogdGhlIG5leHQgcXVlcnkgcmVjb25uZWN0cyBvbiBhIGZyZXNoIHNlc3Npb24gYXMgYSBzYWZlIGZhbGxiYWNrLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyBvbmNlIHRoZSBzZXNzaW9uIHN0YXRlIGlzIHJlc2V0LlxuICAgKi9cbiAgYXN5bmMgY2xlYW51cFNlc3Npb25TdGF0ZUFmdGVyQ2hlY2tvdXQoKSB7XG4gICAgY29uc3QgcG9vbCA9IHRoaXMucG9vbFxuXG4gICAgaWYgKCFwb29sKSByZXR1cm5cblxuICAgIHRyeSB7XG4gICAgICBjb25zdCBwb29sZWRDb25uZWN0aW9uID0gYXdhaXQgbmV3IFByb21pc2UoKHJlc29sdmUsIHJlamVjdCkgPT4ge1xuICAgICAgICBwb29sLmdldENvbm5lY3Rpb24oKGVycm9yLCBjb25uZWN0aW9uKSA9PiB7XG4gICAgICAgICAgaWYgKGVycm9yKSByZWplY3QoZXJyb3IgaW5zdGFuY2VvZiBFcnJvciA/IGVycm9yIDogbmV3IEVycm9yKGBGYWlsZWQgdG8gY2hlY2sgb3V0IGNvbm5lY3Rpb24gZm9yIHNlc3Npb24gcmVzZXQ6ICR7ZXJyb3J9YCkpXG4gICAgICAgICAgZWxzZSByZXNvbHZlKGNvbm5lY3Rpb24pXG4gICAgICAgIH0pXG4gICAgICB9KVxuXG4gICAgICB0cnkge1xuICAgICAgICBhd2FpdCBuZXcgUHJvbWlzZSgocmVzb2x2ZSwgcmVqZWN0KSA9PiB7XG4gICAgICAgICAgcG9vbGVkQ29ubmVjdGlvbi5jaGFuZ2VVc2VyKHtjaGFyc2V0OiBcInV0ZjhtYjRcIiwgdGltZW91dDogMTAwMDB9LCAoKC8qKiBAdHlwZSB7aW1wb3J0KFwibXlzcWxcIikuTXlzcWxFcnJvcn0gKi8gZXJyb3IpID0+IHtcbiAgICAgICAgICAgIGlmIChlcnJvcikgcmVqZWN0KGVycm9yIGluc3RhbmNlb2YgRXJyb3IgPyBlcnJvciA6IG5ldyBFcnJvcihgTXlTUUwgc2Vzc2lvbiByZXNldCBmYWlsZWQ6ICR7ZXJyb3J9YCkpXG4gICAgICAgICAgICBlbHNlIHJlc29sdmUodW5kZWZpbmVkKVxuICAgICAgICAgIH0pKVxuICAgICAgICB9KVxuICAgICAgfSBmaW5hbGx5IHtcbiAgICAgICAgcG9vbGVkQ29ubmVjdGlvbi5yZWxlYXNlKClcbiAgICAgIH1cblxuICAgICAgLy8gVGhlIHNlcnZlciByZS1pbml0aWFsaXplZCB0aGUgc2Vzc2lvbiBvbiB0aGlzIHNvY2tldDogdXNlciB2YXJpYWJsZXMsXG4gICAgICAvLyB0ZW1wb3JhcnkgdGFibGVzLCBwcmVwYXJlZCBzdGF0ZW1lbnRzLCBhbmQgc2Vzc2lvbiB2YXJpYWJsZXMgYXJlIGdvbmUsXG4gICAgICAvLyBhbmQgdGhlIHNlc3Npb24gdGltZSB6b25lIG11c3QgYmUgcmUtZXN0YWJsaXNoZWQgYmVmb3JlIHRoZSBuZXh0IHF1ZXJ5LlxuICAgICAgdGhpcy5yZXNldEN1cnJlbnRTZXNzaW9uVGltZVpvbmUoKVxuICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICAvLyBBIGZhaWxlZCByZXNldCBsZWF2ZXMgdGhlIHNlc3Npb24gc3RhdGUgdW5rbm93biwgc28gZmFsbCBiYWNrIHRvIGFcbiAgICAgIC8vIGZ1bGwgcGh5c2ljYWwgZGlzY29ubmVjdDogdGhlIG5leHQgcXVlcnkgcmVjb25uZWN0cyBvbiBhIGZyZXNoIHNlc3Npb24uXG4gICAgICAvLyBUaGUgbG9naWNhbCBjb25uZWN0aW9uIGlzIHN0aWxsIHJldXNhYmxlIGFmdGVyd2FyZHMuXG4gICAgICB0cnkge1xuICAgICAgICBhd2FpdCB0aGlzLl9jbG9zZSgpXG4gICAgICB9IGNhdGNoIChjbG9zZUVycm9yKSB7XG4gICAgICAgIHRocm93IG5ldyBBZ2dyZWdhdGVFcnJvcihbZXJyb3IsIGNsb3NlRXJyb3JdLCBcIk15U1FMIHNlc3Npb24gcmVzZXQgZmFpbGVkIGFuZCB0aGUgcGh5c2ljYWwgZGlzY29ubmVjdCBmYWxsYmFjayBhbHNvIGZhaWxlZFwiLCB7Y2F1c2U6IGNsb3NlRXJyb3J9KVxuICAgICAgfVxuXG4gICAgICB0aHJvdyBlcnJvclxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHNldCBjb25uZWN0aW9uIGNoZWNrb3V0IG5hbWUuXG4gICAqIEBwYXJhbSB7c3RyaW5nIHwgdW5kZWZpbmVkfSBuYW1lIC0gSHVtYW4tcmVhZGFibGUgbmFtZSBmb3IgdGhpcyBhY3RpdmUgY2hlY2tvdXQuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIHdoZW4gY29tcGxldGUuXG4gICAqL1xuICBhc3luYyBzZXRDb25uZWN0aW9uQ2hlY2tvdXROYW1lKG5hbWUpIHtcbiAgICBjb25zdCBwcmV2aW91c05hbWUgPSB0aGlzLl9jb25uZWN0aW9uQ2hlY2tvdXROYW1lXG5cbiAgICBhd2FpdCBzdXBlci5zZXRDb25uZWN0aW9uQ2hlY2tvdXROYW1lKG5hbWUpXG5cbiAgICBpZiAobmFtZSA9PT0gdW5kZWZpbmVkKSB7XG4gICAgICBpZiAocHJldmlvdXNOYW1lICE9PSB1bmRlZmluZWQpIHtcbiAgICAgICAgYXdhaXQgdGhpcy5xdWVyeShcIlNFVCBAdmVsb2Npb3VzX2Nvbm5lY3Rpb25fY2hlY2tvdXRfbmFtZSA9IE5VTExcIiwge2xvZ05hbWU6IFwiQ2xlYXIgQ29ubmVjdGlvbiBDaGVja291dCBOYW1lXCIsIHByb2Nlc3NMaXN0Q29tbWVudDogZmFsc2UsIHNlc3Npb25UaW1lWm9uZTogZmFsc2V9KVxuICAgICAgfVxuXG4gICAgICByZXR1cm5cbiAgICB9XG5cbiAgICBhd2FpdCB0aGlzLnF1ZXJ5KGBTRVQgQHZlbG9jaW91c19jb25uZWN0aW9uX2NoZWNrb3V0X25hbWUgPSAke3RoaXMucXVvdGUobmFtZSl9YCwge2xvZ05hbWU6IFwiU2V0IENvbm5lY3Rpb24gQ2hlY2tvdXQgTmFtZVwiLCBwcm9jZXNzTGlzdENvbW1lbnQ6IGZhbHNlLCBzZXNzaW9uVGltZVpvbmU6IGZhbHNlfSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGNsZWFyIGNvbm5lY3Rpb24gY2hlY2tvdXQgbmFtZS5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgd2hlbiBjb21wbGV0ZS5cbiAgICovXG4gIGFzeW5jIGNsZWFyQ29ubmVjdGlvbkNoZWNrb3V0TmFtZSgpIHtcbiAgICBpZiAodGhpcy5fY29ubmVjdGlvbkNoZWNrb3V0TmFtZSAhPT0gdW5kZWZpbmVkKSB7XG4gICAgICBhd2FpdCB0aGlzLnF1ZXJ5KFwiU0VUIEB2ZWxvY2lvdXNfY29ubmVjdGlvbl9jaGVja291dF9uYW1lID0gTlVMTFwiLCB7bG9nTmFtZTogXCJDbGVhciBDb25uZWN0aW9uIENoZWNrb3V0IE5hbWVcIiwgcHJvY2Vzc0xpc3RDb21tZW50OiBmYWxzZSwgc2Vzc2lvblRpbWVab25lOiBmYWxzZX0pXG4gICAgfVxuXG4gICAgYXdhaXQgc3VwZXIuY2xlYXJDb25uZWN0aW9uQ2hlY2tvdXROYW1lKClcbiAgfVxuXG4gIC8qKlxuICAgKiBIb29rIGJlZm9yZSBldmVyeSBxdWVyeS5cbiAgICogQHBhcmFtIHtzdHJpbmd9IF9zcWwgLSBTUUwgc3RyaW5nLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL2Jhc2UuanNcIikuUXVlcnlPcHRpb25zfSBvcHRpb25zIC0gUXVlcnkgb3B0aW9ucy5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgd2hlbiBjb21wbGV0ZS5cbiAgICovXG4gIGFzeW5jIGJlZm9yZVF1ZXJ5KF9zcWwsIG9wdGlvbnMpIHtcbiAgICBpZiAob3B0aW9ucy5zZXNzaW9uVGltZVpvbmUgIT09IGZhbHNlKSBhd2FpdCB0aGlzLmVuc3VyZVNlc3Npb25UaW1lWm9uZSgpXG4gIH1cblxuICAvKipcbiAgICogR2V0cyB0aGUgZGVzaXJlZCBkYXRhYmFzZSBzZXNzaW9uIHRpbWUgem9uZSBmb3IgdGhpcyBjb25uZWN0aW9uIGNvbnRleHQuXG4gICAqIEByZXR1cm5zIHtzdHJpbmcgfCBudWxsfSAtIERlc2lyZWQgc2Vzc2lvbiB0aW1lIHpvbmUuXG4gICAqL1xuICBnZXREZXNpcmVkU2Vzc2lvblRpbWVab25lKCkge1xuICAgIHJldHVybiB0aGlzLl9kZXNpcmVkU2Vzc2lvblRpbWVab25lXG4gIH1cblxuICAvKipcbiAgICogU2V0cyB0aGUgZGVzaXJlZCBkYXRhYmFzZSBzZXNzaW9uIHRpbWUgem9uZSB3aXRob3V0IHF1ZXJ5aW5nIE15U1FMIGltbWVkaWF0ZWx5LlxuICAgKiBAcGFyYW0ge3N0cmluZyB8IG51bGx9IHRpbWVab25lIC0gRGVzaXJlZCBzZXNzaW9uIHRpbWUgem9uZS5cbiAgICovXG4gIHNldERlc2lyZWRTZXNzaW9uVGltZVpvbmUodGltZVpvbmUpIHtcbiAgICB0aGlzLl9kZXNpcmVkU2Vzc2lvblRpbWVab25lID0gdGltZVpvbmVcbiAgfVxuXG4gIC8qKlxuICAgKiBHZXRzIHRoZSBkYXRhYmFzZSBzZXNzaW9uIHRpbWUgem9uZSBsYXN0IGNvbmZpcm1lZCB0aHJvdWdoIFNFVCB0aW1lX3pvbmUuXG4gICAqIEByZXR1cm5zIHtzdHJpbmcgfCBudWxsfSAtIEN1cnJlbnQga25vd24gc2Vzc2lvbiB0aW1lIHpvbmUuXG4gICAqL1xuICBnZXRDdXJyZW50U2Vzc2lvblRpbWVab25lKCkge1xuICAgIHJldHVybiB0aGlzLl9jdXJyZW50U2Vzc2lvblRpbWVab25lXG4gIH1cblxuICAvKipcbiAgICogQ2xlYXJzIHRoZSBjdXJyZW50IGtub3duIGRhdGFiYXNlIHNlc3Npb24gdGltZSB6b25lIHdoZW4gdGhlIHBoeXNpY2FsIGNvbm5lY3Rpb24gY2hhbmdlcy5cbiAgICovXG4gIHJlc2V0Q3VycmVudFNlc3Npb25UaW1lWm9uZSgpIHtcbiAgICB0aGlzLl9jdXJyZW50U2Vzc2lvblRpbWVab25lID0gbnVsbFxuICB9XG5cbiAgLyoqXG4gICAqIEVuc3VyZXMgTXlTUUwgaGFzIHRoZSBkZXNpcmVkIHNlc3Npb24gdGltZSB6b25lIGJlZm9yZSB1c2VyIFNRTCBydW5zLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxib29sZWFuPn0gLSBUcnVlIHdoZW4gU0VUIHRpbWVfem9uZSB3YXMgZXhlY3V0ZWQuXG4gICAqL1xuICBhc3luYyBlbnN1cmVTZXNzaW9uVGltZVpvbmUoKSB7XG4gICAgY29uc3QgZGVzaXJlZFNlc3Npb25UaW1lWm9uZSA9IHRoaXMuZ2V0RGVzaXJlZFNlc3Npb25UaW1lWm9uZSgpXG5cbiAgICBpZiAoZGVzaXJlZFNlc3Npb25UaW1lWm9uZSA9PT0gbnVsbCB8fCB0aGlzLmdldEN1cnJlbnRTZXNzaW9uVGltZVpvbmUoKSA9PT0gZGVzaXJlZFNlc3Npb25UaW1lWm9uZSkgcmV0dXJuIGZhbHNlXG5cbiAgICBhd2FpdCB0aGlzLnNldFNlc3Npb25UaW1lWm9uZShkZXNpcmVkU2Vzc2lvblRpbWVab25lKVxuXG4gICAgcmV0dXJuIHRydWVcbiAgfVxuXG4gIC8qKlxuICAgKiBTZXRzIHRoZSBkYXRhYmFzZSBzZXNzaW9uIHRpbWUgem9uZSBpZiBpdCBjaGFuZ2VkIGZyb20gdGhlIGxhc3QgY29uZmlybWVkIHZhbHVlLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gdGltZVpvbmUgLSBTZXNzaW9uIHRpbWUgem9uZSB2YWx1ZSBhY2NlcHRlZCBieSBNeVNRTC5cbiAgICogQHJldHVybnMge1Byb21pc2U8Ym9vbGVhbj59IC0gVHJ1ZSB3aGVuIFNFVCB0aW1lX3pvbmUgd2FzIGV4ZWN1dGVkLlxuICAgKi9cbiAgYXN5bmMgc2V0U2Vzc2lvblRpbWVab25lKHRpbWVab25lKSB7XG4gICAgaWYgKHRoaXMuZ2V0Q3VycmVudFNlc3Npb25UaW1lWm9uZSgpID09PSB0aW1lWm9uZSkgcmV0dXJuIGZhbHNlXG5cbiAgICBhd2FpdCB0aGlzLl9xdWVyeUFjdHVhbChgU0VUIHRpbWVfem9uZSA9ICR7dGhpcy5xdW90ZSh0aW1lWm9uZSl9YClcbiAgICB0aGlzLl9jdXJyZW50U2Vzc2lvblRpbWVab25lID0gdGltZVpvbmVcblxuICAgIHJldHVybiB0cnVlXG4gIH1cblxuICAvKipcbiAgICogUnVucyBjb25uZWN0IGFyZ3MuXG4gICAqIEByZXR1cm5zIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59IC0gVGhlIGNvbm5lY3QgYXJncy5cbiAgICovXG4gIGNvbm5lY3RBcmdzKCkge1xuICAgIGNvbnN0IGFyZ3MgPSB0aGlzLmdldEFyZ3MoKVxuICAgIGNvbnN0IGZvcndhcmQgPSBbXCJkYXRhYmFzZVwiLCBcImhvc3RcIiwgXCJwYXNzd29yZFwiLCBcInBvcnRcIl1cblxuICAgIC8qKlxuICAgICAqIENvbm5lY3QgYXJncy5cbiAgICAgKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSAqL1xuICAgIGNvbnN0IGNvbm5lY3RBcmdzID0ge2NoYXJzZXQ6IFwidXRmOG1iNFwiLCB0aW1lem9uZTogXCJaXCJ9XG5cbiAgICBmb3IgKGNvbnN0IGZvcndhcmRWYWx1ZSBvZiBmb3J3YXJkKSB7XG4gICAgICBpZiAoZm9yd2FyZFZhbHVlIGluIGFyZ3MpIGNvbm5lY3RBcmdzW2ZvcndhcmRWYWx1ZV0gPSBkaWdnKGFyZ3MsIGZvcndhcmRWYWx1ZSlcbiAgICB9XG5cbiAgICBpZiAoXCJ1c2VybmFtZVwiIGluIGFyZ3MpIGNvbm5lY3RBcmdzW1widXNlclwiXSA9IGFyZ3NbXCJ1c2VybmFtZVwiXVxuICAgIGlmIChcImNoYXJzZXRcIiBpbiBhcmdzKSBjb25uZWN0QXJnc1tcImNoYXJzZXRcIl0gPSBhcmdzW1wiY2hhcnNldFwiXVxuICAgIC8vIE9wdC1pbiBvbmx5LiBMZXRzIGEgd2hvbGUgc3RydWN0dXJlIFNRTCBkdW1wIHJ1biBpbiBvbmUgcm91bmQtdHJpcCB2aWFcbiAgICAvLyB7QGxpbmsgZXhlY1N0cnVjdHVyZVNjcmlwdH07IG9mZiBieSBkZWZhdWx0IHNvIG9yZGluYXJ5IHF1ZXJpZXMga2VlcCByZWplY3RpbmdcbiAgICAvLyBzdGFja2VkIHN0YXRlbWVudHMuXG4gICAgaWYgKFwibXVsdGlwbGVTdGF0ZW1lbnRzXCIgaW4gYXJncykgY29ubmVjdEFyZ3NbXCJtdWx0aXBsZVN0YXRlbWVudHNcIl0gPSBCb29sZWFuKGRpZ2coYXJncywgXCJtdWx0aXBsZVN0YXRlbWVudHNcIikpXG5cbiAgICByZXR1cm4gY29ubmVjdEFyZ3NcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGFsdGVyIHRhYmxlIHNxbHMuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vLi4vdGFibGUtZGF0YS9pbmRleC5qc1wiKS5kZWZhdWx0fSB0YWJsZURhdGEgLSBUYWJsZSBkYXRhLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxzdHJpbmdbXT59IC0gUmVzb2x2ZXMgd2l0aCBTUUwgc3RhdGVtZW50cy5cbiAgICovXG4gIGFzeW5jIGFsdGVyVGFibGVTUUxzKHRhYmxlRGF0YSkge1xuICAgIGNvbnN0IGFsdGVyQXJncyA9IHt0YWJsZURhdGEsIGRyaXZlcjogdGhpc31cbiAgICBjb25zdCBhbHRlclRhYmxlID0gbmV3IEFsdGVyVGFibGUoYWx0ZXJBcmdzKVxuXG4gICAgcmV0dXJuIGF3YWl0IGFsdGVyVGFibGUudG9TUUxzKClcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGNyZWF0ZSBkYXRhYmFzZSBzcWwuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBkYXRhYmFzZU5hbWUgLSBEYXRhYmFzZSBuYW1lLlxuICAgKiBAcGFyYW0ge29iamVjdH0gW2FyZ3NdIC0gT3B0aW9ucyBvYmplY3QuXG4gICAqIEBwYXJhbSB7Ym9vbGVhbn0gW2FyZ3MuaWZOb3RFeGlzdHNdIC0gV2hldGhlciBpZiBub3QgZXhpc3RzLlxuICAgKiBAcmV0dXJucyB7c3RyaW5nW119IC0gU1FMIHN0YXRlbWVudHMuXG4gICAqL1xuICBjcmVhdGVEYXRhYmFzZVNxbChkYXRhYmFzZU5hbWUsIGFyZ3MpIHtcbiAgICBjb25zdCBjcmVhdGVBcmdzID0gT2JqZWN0LmFzc2lnbih7ZGF0YWJhc2VOYW1lLCBkcml2ZXI6IHRoaXN9LCBhcmdzKVxuICAgIGNvbnN0IGNyZWF0ZURhdGFiYXNlID0gbmV3IENyZWF0ZURhdGFiYXNlKGNyZWF0ZUFyZ3MpXG5cbiAgICByZXR1cm4gY3JlYXRlRGF0YWJhc2UudG9TcWwoKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZHJvcCBkYXRhYmFzZSBzcWwuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBkYXRhYmFzZU5hbWUgLSBEYXRhYmFzZSBuYW1lLlxuICAgKiBAcGFyYW0ge29iamVjdH0gW2FyZ3NdIC0gT3B0aW9ucyBvYmplY3QuXG4gICAqIEBwYXJhbSB7Ym9vbGVhbn0gW2FyZ3MuaWZFeGlzdHNdIC0gV2hldGhlciBpZiBleGlzdHMuXG4gICAqIEByZXR1cm5zIHtzdHJpbmdbXX0gLSBTUUwgc3RhdGVtZW50cy5cbiAgICovXG4gIGRyb3BEYXRhYmFzZVNxbChkYXRhYmFzZU5hbWUsIGFyZ3MpIHtcbiAgICBjb25zdCBkcm9wQXJncyA9IE9iamVjdC5hc3NpZ24oe2RhdGFiYXNlTmFtZSwgZHJpdmVyOiB0aGlzfSwgYXJncylcbiAgICBjb25zdCBkcm9wRGF0YWJhc2UgPSBuZXcgRHJvcERhdGFiYXNlKGRyb3BBcmdzKVxuXG4gICAgcmV0dXJuIGRyb3BEYXRhYmFzZS50b1NxbCgpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBjcmVhdGUgaW5kZXggc3Fscy5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9iYXNlLmpzXCIpLkNyZWF0ZUluZGV4U3FsQXJnc30gaW5kZXhEYXRhIC0gSW5kZXggZGF0YS5cbiAgICogQHJldHVybnMge1Byb21pc2U8c3RyaW5nW10+fSAtIFJlc29sdmVzIHdpdGggU1FMIHN0YXRlbWVudHMuXG4gICAqL1xuICBhc3luYyBjcmVhdGVJbmRleFNRTHMoaW5kZXhEYXRhKSB7XG4gICAgY29uc3QgY3JlYXRlQXJncyA9IE9iamVjdC5hc3NpZ24oe2RyaXZlcjogdGhpc30sIGluZGV4RGF0YSlcbiAgICBjb25zdCBjcmVhdGVJbmRleCA9IG5ldyBDcmVhdGVJbmRleChjcmVhdGVBcmdzKVxuXG4gICAgcmV0dXJuIGF3YWl0IGNyZWF0ZUluZGV4LnRvU1FMcygpXG4gIH1cblxuICAvKipcbiAgICogUnVucyByZW1vdmUgaW5kZXggc3Fscy5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9iYXNlLmpzXCIpLlJlbW92ZUluZGV4U3FsQXJnc30gaW5kZXhEYXRhIC0gSW5kZXggZGF0YS5cbiAgICogQHJldHVybnMge1Byb21pc2U8c3RyaW5nW10+fSAtIFJlc29sdmVzIHdpdGggU1FMIHN0YXRlbWVudHMuXG4gICAqL1xuICBhc3luYyByZW1vdmVJbmRleFNRTHMoaW5kZXhEYXRhKSB7XG4gICAgY29uc3QgcmVtb3ZlQXJncyA9IE9iamVjdC5hc3NpZ24oe2RyaXZlcjogdGhpc30sIGluZGV4RGF0YSlcbiAgICBjb25zdCByZW1vdmVJbmRleCA9IG5ldyBSZW1vdmVJbmRleChyZW1vdmVBcmdzKVxuXG4gICAgcmV0dXJuIGF3YWl0IHJlbW92ZUluZGV4LnRvU1FMcygpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBjcmVhdGUgdGFibGUgc3FsLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uLy4uL3RhYmxlLWRhdGEvaW5kZXguanNcIikuZGVmYXVsdH0gdGFibGVEYXRhIC0gVGFibGUgZGF0YS5cbiAgICogQHJldHVybnMge1Byb21pc2U8c3RyaW5nW10+fSAtIFJlc29sdmVzIHdpdGggU1FMIHN0YXRlbWVudHMuXG4gICAqL1xuICBhc3luYyBjcmVhdGVUYWJsZVNxbCh0YWJsZURhdGEpIHtcbiAgICBjb25zdCBjcmVhdGVBcmdzID0ge3RhYmxlRGF0YSwgZHJpdmVyOiB0aGlzfVxuICAgIGNvbnN0IGNyZWF0ZVRhYmxlID0gbmV3IENyZWF0ZVRhYmxlKGNyZWF0ZUFyZ3MpXG5cbiAgICByZXR1cm4gY3JlYXRlVGFibGUudG9TcWwoKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgY3VycmVudCBkYXRhYmFzZS5cbiAgICogQHJldHVybnMge1Byb21pc2U8c3RyaW5nPn0gLSBSZXNvbHZlcyB3aXRoIHRoZSBjdXJyZW50IGRhdGFiYXNlLlxuICAgKi9cbiAgYXN5bmMgY3VycmVudERhdGFiYXNlKCkge1xuICAgIGNvbnN0IHJvd3MgPSBhd2FpdCB0aGlzLnF1ZXJ5KFwiU0VMRUNUIERBVEFCQVNFKCkgQVMgZGJfbmFtZVwiKVxuXG4gICAgcmV0dXJuIGRpZ2cocm93cywgMCwgXCJkYl9uYW1lXCIpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBkaXNhYmxlIGZvcmVpZ24ga2V5cy5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgd2hlbiBjb21wbGV0ZS5cbiAgICovXG4gIGFzeW5jIGRpc2FibGVGb3JlaWduS2V5cygpIHtcbiAgICBhd2FpdCB0aGlzLnF1ZXJ5KFwiU0VUIEZPUkVJR05fS0VZX0NIRUNLUyA9IDBcIilcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGVuYWJsZSBmb3JlaWduIGtleXMuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIHdoZW4gY29tcGxldGUuXG4gICAqL1xuICBhc3luYyBlbmFibGVGb3JlaWduS2V5cygpIHtcbiAgICBhd2FpdCB0aGlzLnF1ZXJ5KFwiU0VUIEZPUkVJR05fS0VZX0NIRUNLUyA9IDFcIilcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGRyb3AgdGFibGUgc3Fscy5cbiAgICogQHBhcmFtIHtzdHJpbmd9IHRhYmxlTmFtZSAtIFRhYmxlIG5hbWUuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vYmFzZS5qc1wiKS5Ecm9wVGFibGVTcWxBcmdzVHlwZX0gW2FyZ3NdIC0gT3B0aW9ucyBvYmplY3QuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHN0cmluZ1tdPn0gLSBSZXNvbHZlcyB3aXRoIFNRTCBzdGF0ZW1lbnRzLlxuICAgKi9cbiAgYXN5bmMgZHJvcFRhYmxlU1FMcyh0YWJsZU5hbWUsIGFyZ3MgPSB7fSkge1xuICAgIGNvbnN0IGRyb3BBcmdzID0gT2JqZWN0LmFzc2lnbih7dGFibGVOYW1lLCBkcml2ZXI6IHRoaXN9LCBhcmdzKVxuICAgIGNvbnN0IGRyb3BUYWJsZSA9IG5ldyBEcm9wVGFibGUoZHJvcEFyZ3MpXG5cbiAgICByZXR1cm4gYXdhaXQgZHJvcFRhYmxlLnRvU1FMcygpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBnZXQgdHlwZS5cbiAgICogQHJldHVybnMge3N0cmluZ30gLSBUaGUgdHlwZS5cbiAgICovXG4gIGdldFR5cGUoKSB7IHJldHVybiBcIm15c3FsXCIgfVxuXG4gIC8qKlxuICAgKiBXaGV0aGVyIHRoaXMgZHJpdmVyIHN1cHBvcnRzIGNvbWJpbmluZyBvcGVyYXRpb25zIGludG8gb25lIGJ1bGsgYEFMVEVSYC5cbiAgICogQHJldHVybnMge2Jvb2xlYW59IC0gV2hldGhlciBidWxrIGFsdGVyIGlzIHN1cHBvcnRlZC5cbiAgICovXG4gIHN1cHBvcnRzQnVsa0FsdGVyKCkgeyByZXR1cm4gdHJ1ZSB9XG5cbiAgLyoqXG4gICAqIFdoZXRoZXIgdGhlIGJ1bGsgYEFMVEVSYCBjYW4gYWxzbyBjYXJyeSBgQUREIElOREVYYCBjbGF1c2VzLlxuICAgKiBAcmV0dXJucyB7Ym9vbGVhbn0gLSBXaGV0aGVyIGluZGV4ZXMgY2FuIGJlIGFkZGVkIGluc2lkZSBhIGJ1bGsgYWx0ZXIuXG4gICAqL1xuICBzdXBwb3J0c0J1bGtBbHRlckluZGV4ZXMoKSB7IHJldHVybiB0cnVlIH1cblxuICAvKipcbiAgICogUnVucyByZXRyeWFibGUgZGF0YWJhc2UgZXJyb3IuXG4gICAqIEBwYXJhbSB7RXJyb3J9IGVycm9yIC0gRXJyb3IgaW5zdGFuY2UuXG4gICAqIEByZXR1cm5zIHtpbXBvcnQoXCIuLi9iYXNlLmpzXCIpLlJldHJ5YWJsZURhdGFiYXNlRXJyb3JSZXN1bHR9IC0gUmV0cnkgaW5mby5cbiAgICovXG4gIHJldHJ5YWJsZURhdGFiYXNlRXJyb3IoZXJyb3IpIHtcbiAgICAvKiogQHR5cGUge0Vycm9yIHwgdW5kZWZpbmVkfSAqL1xuICAgIGxldCBjdXJyZW50RXJyb3IgPSBlcnJvclxuICAgIGxldCBzaG91bGRSZWNvbm5lY3QgPSBmYWxzZVxuXG4gICAgd2hpbGUgKGN1cnJlbnRFcnJvcikge1xuICAgICAgY29uc3QgZXJyb3JDb2RlID0gXCJjb2RlXCIgaW4gY3VycmVudEVycm9yICYmIHR5cGVvZiBjdXJyZW50RXJyb3IuY29kZSA9PSBcInN0cmluZ1wiID8gY3VycmVudEVycm9yLmNvZGUgOiB1bmRlZmluZWRcbiAgICAgIGNvbnN0IG1lc3NhZ2UgPSBjdXJyZW50RXJyb3IubWVzc2FnZSB8fCBcIlwiXG5cbiAgICAgIGlmIChlcnJvckNvZGUgPT0gXCJFUl9DSEVDS1JFQURcIiB8fCBtZXNzYWdlLmluY2x1ZGVzKFwiUmVjb3JkIGhhcyBjaGFuZ2VkIHNpbmNlIGxhc3QgcmVhZFwiKSkge1xuICAgICAgICByZXR1cm4ge3JldHJ5OiB0cnVlLCByZWNvbm5lY3Q6IGZhbHNlLCB3YWl0TXM6IDUwfVxuICAgICAgfVxuXG4gICAgICAvLyBBIGRlYWRsb2NrIG9yIGxvY2std2FpdC10aW1lb3V0IGFib3J0cyB0aGUgd2hvbGUgdHJhbnNhY3Rpb247IGl0IG11c3QgYmUgcmV0cmllZCBhdCB0aGVcbiAgICAgIC8vIHRyYW5zYWN0aW9uIGxldmVsIChyZS1ydW5uaW5nIHRoZSBjYWxsYmFjayksIG5vdCB0aGUgcXVlcnkgbGV2ZWwsIHNvIGZsYWcgaXQgYXMgc3VjaCBhbmRcbiAgICAgIC8vIGtlZXAgYHJldHJ5YCBmYWxzZSBzbyBhbiBpbi10cmFuc2FjdGlvbiBxdWVyeSBkb2VzIG5vdCByZXRyeSBhZ2FpbnN0IHRoZSBkZWFkIHRyYW5zYWN0aW9uLlxuICAgICAgaWYgKGVycm9yQ29kZSA9PSBcIkVSX0xPQ0tfREVBRExPQ0tcIiB8fCBtZXNzYWdlLmluY2x1ZGVzKFwiRVJfTE9DS19ERUFETE9DS1wiKSB8fCBtZXNzYWdlLmluY2x1ZGVzKFwiRGVhZGxvY2sgZm91bmRcIikpIHtcbiAgICAgICAgcmV0dXJuIHtyZXRyeTogZmFsc2UsIHJlY29ubmVjdDogZmFsc2UsIGRlYWRsb2NrOiB0cnVlLCBjb250ZW50aW9uS2luZDogXCJkZWFkbG9ja1wiLCB3YWl0TXM6IDUwfVxuICAgICAgfVxuXG4gICAgICBpZiAoZXJyb3JDb2RlID09IFwiRVJfTE9DS19XQUlUX1RJTUVPVVRcIiB8fCBtZXNzYWdlLmluY2x1ZGVzKFwiTG9jayB3YWl0IHRpbWVvdXQgZXhjZWVkZWRcIikpIHtcbiAgICAgICAgcmV0dXJuIHtyZXRyeTogZmFsc2UsIHJlY29ubmVjdDogZmFsc2UsIGRlYWRsb2NrOiB0cnVlLCBjb250ZW50aW9uS2luZDogXCJsb2NrLXdhaXQtdGltZW91dFwiLCB3YWl0TXM6IDUwfVxuICAgICAgfVxuXG4gICAgICBzaG91bGRSZWNvbm5lY3QgfHw9IChcbiAgICAgICAgZXJyb3JDb2RlID09IFwiRUNPTk5SRUZVU0VEXCIgfHxcbiAgICAgICAgbWVzc2FnZS5pbmNsdWRlcyhcIkVDT05OUkVGVVNFRFwiKSB8fFxuICAgICAgICBtZXNzYWdlLmluY2x1ZGVzKFwiY29ubmVjdCBFQ09OTlJFRlVTRURcIikgfHxcbiAgICAgICAgbWVzc2FnZS5pbmNsdWRlcyhcIlBST1RPQ09MX0NPTk5FQ1RJT05fTE9TVFwiKSB8fFxuICAgICAgICBtZXNzYWdlLmluY2x1ZGVzKFwiQ29ubmVjdGlvbiBsb3N0XCIpXG4gICAgICApXG5cbiAgICAgIGN1cnJlbnRFcnJvciA9IGN1cnJlbnRFcnJvci5jYXVzZSBpbnN0YW5jZW9mIEVycm9yID8gY3VycmVudEVycm9yLmNhdXNlIDogdW5kZWZpbmVkXG4gICAgfVxuXG4gICAgcmV0dXJuIHtcbiAgICAgIHJldHJ5OiBzaG91bGRSZWNvbm5lY3QsXG4gICAgICByZWNvbm5lY3Q6IHNob3VsZFJlY29ubmVjdCxcbiAgICAgIHdhaXRNczogNTBcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogQWRkcyBhIHJlZGFjdGVkLCBib3VuZGVkIGV4Y2VycHQgZnJvbSBNeVNRTCdzIGxhdGVzdCBJbm5vREIgZGVhZGxvY2sgcmVwb3J0LiBDYXB0dXJlIHVzZXMgYVxuICAgKiBzZXBhcmF0ZSBzaG9ydC1saXZlZCBjb25uZWN0aW9uIHNvIGl0IGNhbm5vdCBxdWV1ZSBhaGVhZCBvZiByb2xsYmFjayBvciB0aGUgbmV4dCByZXRyeSBvbiB0aGlzXG4gICAqIGRyaXZlcidzIHNpbmdsZS1jb25uZWN0aW9uIHBvb2wuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vYmFzZS5qc1wiKS5EZWFkbG9ja1JldHJ5RGlhZ25vc3RpY1NuYXBzaG90fSBzbmFwc2hvdCAtIEltbXV0YWJsZSByZXRyeSBzbmFwc2hvdC5cbiAgICogQHJldHVybnMge1Byb21pc2U8UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+Pn0gLSBTYWZlIGRpYWdub3N0aWMgY29udGV4dC5cbiAgICovXG4gIGFzeW5jIF9kZWFkbG9ja0RpYWdub3N0aWNDb250ZXh0KHNuYXBzaG90KSB7XG4gICAgaWYgKHNuYXBzaG90LmNvbnRlbnRpb25LaW5kID09IFwibG9jay13YWl0LXRpbWVvdXRcIikgcmV0dXJuIHtzdGF0dXNDYXB0dXJlOiBcIm5vdC1hcHBsaWNhYmxlXCJ9XG5cbiAgICBsZXQgc3RhdHVzXG5cbiAgICB0cnkge1xuICAgICAgc3RhdHVzID0gYXdhaXQgdGhpcy5fY2FwdHVyZUlubm9kYkRlYWRsb2NrU3RhdHVzKClcbiAgICB9IGNhdGNoIHtcbiAgICAgIHJldHVybiB7c3RhdHVzQ2FwdHVyZTogXCJmYWlsZWRcIn1cbiAgICB9XG5cbiAgICByZXR1cm4ge1xuICAgICAgaW5ub2RiRGVhZGxvY2tTdW1tYXJ5OiB0aGlzLl9pbm5vZGJEZWFkbG9ja1N1bW1hcnkoc3RhdHVzKSxcbiAgICAgIHN0YXR1c0NhcHR1cmU6IFwiY2FwdHVyZWRcIlxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBDYXB0dXJlcyBTSE9XIEVOR0lORSBJTk5PREIgU1RBVFVTIG9uIGEgYm91bmRlZCB0aHJvd2F3YXkgY29ubmVjdGlvbi5cbiAgICogQHJldHVybnMge1Byb21pc2U8c3RyaW5nPn0gLSBSYXcgc2VydmVyIHN0YXR1cywgcmV0YWluZWQgb25seSBpbnNpZGUgdGhlIHJlZGFjdGlvbiBwYXRoLlxuICAgKi9cbiAgYXN5bmMgX2NhcHR1cmVJbm5vZGJEZWFkbG9ja1N0YXR1cygpIHtcbiAgICBjb25zdCBwb29sV2l0aENvbmZpZyA9IC8qKiBAdHlwZSB7e2NvbmZpZz86IHtjb25uZWN0aW9uQ29uZmlnPzogUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59fSB8IHVuZGVmaW5lZH0gKi8gKHRoaXMucG9vbClcbiAgICBjb25zdCBjb25uZWN0aW9uQ29uZmlnID0gcG9vbFdpdGhDb25maWc/LmNvbmZpZz8uY29ubmVjdGlvbkNvbmZpZ1xuICAgIGNvbnN0IGNhcHR1cmVDb25maWcgPSBjb25uZWN0aW9uQ29uZmlnIHx8IHRoaXMuY29ubmVjdEFyZ3MoKVxuXG4gICAgcmV0dXJuIGF3YWl0IG5ldyBQcm9taXNlKChyZXNvbHZlLCByZWplY3QpID0+IHtcbiAgICAgIC8qKiBAdHlwZSB7aW1wb3J0KFwibXlzcWxcIikuQ29ubmVjdGlvbiB8IHVuZGVmaW5lZH0gKi9cbiAgICAgIGxldCBjb25uZWN0aW9uXG4gICAgICBsZXQgc2V0dGxlZCA9IGZhbHNlXG4gICAgICAvKipcbiAgICAgICAqIEZpbmlzaGVzIHRoZSBzdGF0dXMgY2FwdHVyZSBvbmNlIGFuZCBkZXN0cm95cyBpdHMgdGVtcG9yYXJ5IGNvbm5lY3Rpb24uXG4gICAgICAgKiBAcGFyYW0ge0Vycm9yIHwgdW5kZWZpbmVkfSBlcnJvciAtIENhcHR1cmUgZXJyb3IsIHdoZW4gcHJlc2VudC5cbiAgICAgICAqIEBwYXJhbSB7c3RyaW5nfSBbc3RhdHVzXSAtIENhcHR1cmVkIHN0YXR1cy5cbiAgICAgICAqIEByZXR1cm5zIHt2b2lkfVxuICAgICAgICovXG4gICAgICBjb25zdCBmaW5pc2ggPSAoZXJyb3IsIHN0YXR1cyA9IFwiXCIpID0+IHtcbiAgICAgICAgaWYgKHNldHRsZWQpIHJldHVyblxuICAgICAgICBzZXR0bGVkID0gdHJ1ZVxuICAgICAgICBjbGVhclRpbWVvdXQodGltZW91dClcbiAgICAgICAgaWYgKGNvbm5lY3Rpb24pIGNvbm5lY3Rpb24uZGVzdHJveSgpXG4gICAgICAgIGlmIChlcnJvcikgcmVqZWN0KGVycm9yKVxuICAgICAgICBlbHNlIHJlc29sdmUoc3RhdHVzKVxuICAgICAgfVxuICAgICAgY29uc3QgdGltZW91dCA9IHNldFRpbWVvdXQoKCkgPT4gZmluaXNoKG5ldyBFcnJvcihcIklubm9EQiBzdGF0dXMgY2FwdHVyZSB0aW1lZCBvdXRcIikpLCBJTk5PREJfREVBRExPQ0tfQ0FQVFVSRV9USU1FT1VUX01TKVxuXG4gICAgICB0cnkge1xuICAgICAgICBjb25uZWN0aW9uID0gbXlzcWwuY3JlYXRlQ29ubmVjdGlvbihjYXB0dXJlQ29uZmlnKVxuICAgICAgICBjb25uZWN0aW9uLm9uKFwiZXJyb3JcIiwgKGVycm9yKSA9PiBmaW5pc2goZXJyb3IpKVxuICAgICAgICBjb25uZWN0aW9uLnF1ZXJ5KFwiU0hPVyBFTkdJTkUgSU5OT0RCIFNUQVRVU1wiLCAoZXJyb3IsIHJvd3MpID0+IHtcbiAgICAgICAgICBpZiAoZXJyb3IpIHtcbiAgICAgICAgICAgIGZpbmlzaChlcnJvcilcbiAgICAgICAgICAgIHJldHVyblxuICAgICAgICAgIH1cblxuICAgICAgICAgIGNvbnN0IGZpcnN0Um93ID0gQXJyYXkuaXNBcnJheShyb3dzKSA/IHJvd3NbMF0gOiB1bmRlZmluZWRcbiAgICAgICAgICBjb25zdCBzdGF0dXMgPSBmaXJzdFJvdyAmJiB0eXBlb2YgZmlyc3RSb3cuU3RhdHVzID09IFwic3RyaW5nXCIgPyBmaXJzdFJvdy5TdGF0dXMgOiBcIlwiXG5cbiAgICAgICAgICBmaW5pc2godW5kZWZpbmVkLCBzdGF0dXMpXG4gICAgICAgIH0pXG4gICAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgICBmaW5pc2goZXJyb3IgaW5zdGFuY2VvZiBFcnJvciA/IGVycm9yIDogbmV3IEVycm9yKFwiSW5ub0RCIHN0YXR1cyBjYXB0dXJlIGZhaWxlZFwiKSlcbiAgICAgIH1cbiAgICB9KVxuICB9XG5cbiAgLyoqXG4gICAqIEV4dHJhY3RzIG9ubHkgZml4ZWQtZm9ybWF0IGRlYWRsb2NrIGNvdW50ZXJzLiBUaGUgc2VydmVyIHJlcG9ydCBjb250YWlucyByYXcgU1FMLCBpZGVudGlmaWVycyxcbiAgICogYW5kIHBoeXNpY2FsIHJlY29yZCBkYXRhLCBzbyBubyBzb3VyY2UgdGV4dCBpcyBldmVyIGluY2x1ZGVkIGluIGFuIGFwcGxpY2F0aW9uIGRpYWdub3N0aWMuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBzdGF0dXMgLSBTSE9XIEVOR0lORSBJTk5PREIgU1RBVFVTIHRleHQuXG4gICAqIEByZXR1cm5zIHt7bG9ja1JlY29yZHNUcnVuY2F0ZWQ6IGJvb2xlYW4sIHNlY3Rpb25UcnVuY2F0ZWQ6IGJvb2xlYW4sIHRyYW5zYWN0aW9uTm9kZXM6IEFycmF5PHtjb25mbGljdGluZ0xvY2tzOiBBcnJheTx7aW5kZXhGaW5nZXJwcmludDogc3RyaW5nLCBsb2NrTW9kZTogc3RyaW5nLCBzdGF0ZTogc3RyaW5nLCB0YWJsZUZpbmdlcnByaW50OiBzdHJpbmd9PiwgbG9ja3M6IEFycmF5PHtpbmRleEZpbmdlcnByaW50OiBzdHJpbmcsIGxvY2tNb2RlOiBzdHJpbmcsIHN0YXRlOiBzdHJpbmcsIHRhYmxlRmluZ2VycHJpbnQ6IHN0cmluZ30+LCBvcmRpbmFsOiBudW1iZXJ9PiwgdHJhbnNhY3Rpb25Ob2Rlc1RydW5jYXRlZDogYm9vbGVhbiwgdHJhbnNhY3Rpb25zOiBudW1iZXIsIHZpY3RpbVRyYW5zYWN0aW9uOiBudW1iZXIgfCBudWxsfX0gLSBTdHJ1Y3R1cmFsIGRlYWRsb2NrIHN1bW1hcnkuXG4gICAqL1xuICBfaW5ub2RiRGVhZGxvY2tTdW1tYXJ5KHN0YXR1cykge1xuICAgIHJldHVybiBwYXJzZUlubm9kYkRlYWRsb2NrU3VtbWFyeShzdGF0dXMpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBxdWVyeSBhY3R1YWwuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBzcWwgLSBTUUwgc3RyaW5nLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL2Jhc2UuanNcIikuUXVlcnlPcHRpb25zfSBbb3B0aW9uc10gLSBRdWVyeSBvcHRpb25zIChjYXJyaWVzIHRoZSBvcHRpb25hbCBhYm9ydCBzaWduYWwpLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxpbXBvcnQoXCIuLi9iYXNlLmpzXCIpLlF1ZXJ5UmVzdWx0VHlwZT59IC0gUmVzb2x2ZXMgd2l0aCB0aGUgcXVlcnkgYWN0dWFsLlxuICAgKi9cbiAgYXN5bmMgX3F1ZXJ5QWN0dWFsKHNxbCwgb3B0aW9ucyA9IHt9KSB7XG4gICAgaWYgKCF0aGlzLnBvb2wpIGF3YWl0IHRoaXMuY29ubmVjdCgpXG4gICAgaWYgKCF0aGlzLnBvb2wpIHRocm93IG5ldyBFcnJvcihcIk15U1FMIHBvb2wgZmFpbGVkIHRvIGluaXRpYWxpemVcIilcblxuICAgIHRyeSB7XG4gICAgICByZXR1cm4gYXdhaXQgcXVlcnkodGhpcy5wb29sLCBzcWwsIHtzaWduYWw6IG9wdGlvbnMuc2lnbmFsfSlcbiAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgLy8gUHJlc2VydmUgYW4gYWJvcnQgYXMtaXMgc28gdGhlIHJldHJ5IGxvb3AgY2FuIHJlY29nbmlzZSBpdCBhcyB0ZXJtaW5hbFxuICAgICAgLy8gKHdyYXBwaW5nIGl0IGluIGEgcGxhaW4gRXJyb3Igd291bGQgbG9zZSB0aGUgUXVlcnlBYm9ydGVkRXJyb3IgdHlwZSkuXG4gICAgICBpZiAoZXJyb3IgaW5zdGFuY2VvZiBRdWVyeUFib3J0ZWRFcnJvcikge1xuICAgICAgICBpZiAoZXJyb3IuY29ubmVjdGlvbkRlc3Ryb3llZCkgdGhpcy5yZXNldEN1cnJlbnRTZXNzaW9uVGltZVpvbmUoKVxuICAgICAgICB0aHJvdyBlcnJvclxuICAgICAgfVxuXG4gICAgICAvLyBSZS10aHJvdyB0byB1bi1jb3JydXB0IHN0YWNrdHJhY2VcbiAgICAgIGlmIChlcnJvciBpbnN0YW5jZW9mIEVycm9yKSB7XG4gICAgICAgIHRocm93IG5ldyBFcnJvcihgUXVlcnkgZmFpbGVkOiAke2Vycm9yLm1lc3NhZ2V9YCwge2NhdXNlOiBlcnJvcn0pXG4gICAgICB9IGVsc2Uge1xuICAgICAgICB0aHJvdyBuZXcgRXJyb3IoYFF1ZXJ5IGZhaWxlZDogJHtlcnJvcn1gLCB7Y2F1c2U6IGVycm9yfSlcbiAgICAgIH1cbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogU3RyZWFtcyB0aGUgcm93cyBvZiBgc3FsYCBmcm9tIGEgZGVkaWNhdGVkIHBvb2xlZCBjb25uZWN0aW9uIHVzaW5nIHRoZSBNeVNRTCBjdXJzb3IsIHNvIGFcbiAgICogbGFyZ2UgcmVzdWx0IHNldCBpcyByZWFkIGluY3JlbWVudGFsbHkgaW5zdGVhZCBvZiBiZWluZyBidWZmZXJlZC4gT3ZlcnJpZGVzIHRoZSBiYXNlXG4gICAqIGJ1ZmZlcmVkIGZhbGxiYWNrIHdpdGggdHJ1ZSBzZXJ2ZXItc2lkZSBzdHJlYW1pbmcuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBzcWwgLSBTUUwgc3RyaW5nIHRvIHN0cmVhbS5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9iYXNlLmpzXCIpLlF1ZXJ5T3B0aW9uc30gW29wdGlvbnNdIC0gUXVlcnkgb3duZXJzaGlwIG9wdGlvbnMuXG4gICAqIEB5aWVsZHMge1JlY29yZDxzdHJpbmcsIHVua25vd24+fSAtIFRoZSByZXN1bHQgcm93cywgb25lIGF0IGEgdGltZS5cbiAgICovXG4gIGFzeW5jICpxdWVyeVN0cmVhbShzcWwsIG9wdGlvbnMgPSB7fSkge1xuICAgIGF3YWl0IHRoaXMuX3dhaXRGb3JPcGVyYXRpb25MZWFzZShvcHRpb25zLm9wZXJhdGlvbk93bmVyKVxuXG4gICAgaWYgKCF0aGlzLnBvb2wpIGF3YWl0IHRoaXMuY29ubmVjdCgpXG4gICAgaWYgKCF0aGlzLnBvb2wpIHRocm93IG5ldyBFcnJvcihcIk15U1FMIHBvb2wgZmFpbGVkIHRvIGluaXRpYWxpemVcIilcblxuICAgIGNvbnN0IHByb2ZpbGVBdHRlbXB0ID0gdGhpcy5fc3RhcnRQcm9maWxlZFF1ZXJ5QXR0ZW1wdChzcWwpXG4gICAgbGV0IGZhaWxlZCA9IHRydWVcblxuICAgIHRyeSB7XG4gICAgICB5aWVsZCogc3RyZWFtUXVlcnkodGhpcy5wb29sLCBzcWwpXG4gICAgICBmYWlsZWQgPSBmYWxzZVxuICAgIH0gZmluYWxseSB7XG4gICAgICB0aGlzLl9maW5pc2hQcm9maWxlZFF1ZXJ5QXR0ZW1wdChwcm9maWxlQXR0ZW1wdCwgZmFpbGVkKVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBFeGVjdXRlcyBhIG11dGF0aW9uIHdpdGggYWZmZWN0ZWQtcm93IG1ldGFkYXRhLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gc3FsIC0gTXV0YXRpb24gU1FMLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxudW1iZXI+fSAtIEFmZmVjdGVkIHJvdyBjb3VudC5cbiAgICovXG4gIGFzeW5jIF9hZmZlY3RlZFJvd3NBY3R1YWwoc3FsKSB7XG4gICAgaWYgKCF0aGlzLnBvb2wpIGF3YWl0IHRoaXMuY29ubmVjdCgpXG4gICAgaWYgKCF0aGlzLnBvb2wpIHRocm93IG5ldyBFcnJvcihcIk15U1FMIHBvb2wgZmFpbGVkIHRvIGluaXRpYWxpemVcIilcbiAgICBjb25zdCBwb29sID0gdGhpcy5wb29sXG5cbiAgICByZXR1cm4gYXdhaXQgbmV3IFByb21pc2UoKHJlc29sdmUsIHJlamVjdCkgPT4ge1xuICAgICAgcG9vbC5xdWVyeShzcWwsIChlcnJvciwgcmVzdWx0KSA9PiB7XG4gICAgICAgIGlmIChlcnJvcikgcmVqZWN0KGVycm9yKVxuICAgICAgICBlbHNlIHJlc29sdmUoXCJhZmZlY3RlZFJvd3NcIiBpbiByZXN1bHQgPyByZXN1bHQuYWZmZWN0ZWRSb3dzIDogMClcbiAgICAgIH0pXG4gICAgfSlcbiAgfVxuXG4gIC8qKlxuICAgKiBFeGVjdXRlcyBhIGZ1bGwgbXVsdGktc3RhdGVtZW50IHN0cnVjdHVyZSBTUUwgc2NyaXB0IGluIG9uZSByb3VuZC10cmlwIHdoZW4gdGhlXG4gICAqIGNvbm5lY3Rpb24gd2FzIGNvbmZpZ3VyZWQgd2l0aCBgbXVsdGlwbGVTdGF0ZW1lbnRzOiB0cnVlYC4gUnVucyBvbiB0aGUgcG9vbGVkXG4gICAqIGNvbm5lY3Rpb24gc28gdGhlIGNhbGxlcidzIGBTRVQgRk9SRUlHTl9LRVlfQ0hFQ0tTID0gMGAgYXBwbGllcy4gUmV0dXJucyBmYWxzZSBzb1xuICAgKiB0aGUgY2FsbGVyIHJ1bnMgc3RhdGVtZW50cyBpbmRpdmlkdWFsbHkgd2hlbiBtdWx0aS1zdGF0ZW1lbnQgcXVlcmllcyBhcmUgb2ZmLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gc3RydWN0dXJlU3FsIC0gRnVsbCBtdWx0aS1zdGF0ZW1lbnQgc3RydWN0dXJlIFNRTC5cbiAgICogQHJldHVybnMge1Byb21pc2U8Ym9vbGVhbj59IC0gV2hldGhlciB0aGUgc2NyaXB0IHdhcyBleGVjdXRlZCBhcyBvbmUgYmF0Y2guXG4gICAqL1xuICBhc3luYyBleGVjU3RydWN0dXJlU2NyaXB0KHN0cnVjdHVyZVNxbCkge1xuICAgIGlmICghdGhpcy5nZXRBcmdzKCkubXVsdGlwbGVTdGF0ZW1lbnRzKSByZXR1cm4gZmFsc2VcblxuICAgIC8vIFRoZSBiYXRjaGVkIHBvb2wgY2FsbCBiZWxvdyBieXBhc3NlcyBCYXNlI3F1ZXJ5LCBzbyByZS1ydW4gdGhlIHNhbWUgcmVhZC1vbmx5XG4gICAgLy8gd3JpdGUgZ3VhcmQgdGhlIHBlci1zdGF0ZW1lbnQgcGF0aCBhcHBsaWVzIGJlZm9yZSBleGVjdXRpbmcgdGhlIGR1bXAuXG4gICAgdGhpcy5fYXNzZXJ0V3JpdGFibGVRdWVyeShzdHJ1Y3R1cmVTcWwpXG5cbiAgICBpZiAoIXRoaXMucG9vbCkgYXdhaXQgdGhpcy5jb25uZWN0KClcbiAgICBpZiAoIXRoaXMucG9vbCkgdGhyb3cgbmV3IEVycm9yKFwiTXlTUUwgcG9vbCBmYWlsZWQgdG8gaW5pdGlhbGl6ZVwiKVxuXG4gICAgY29uc3QgcG9vbCA9IHRoaXMucG9vbFxuICAgIGNvbnN0IHByb2ZpbGVBdHRlbXB0ID0gdGhpcy5fc3RhcnRQcm9maWxlZFF1ZXJ5QXR0ZW1wdChzdHJ1Y3R1cmVTcWwpXG4gICAgbGV0IGZhaWxlZCA9IHRydWVcblxuICAgIHRyeSB7XG4gICAgICBhd2FpdCBuZXcgUHJvbWlzZSgocmVzb2x2ZSwgcmVqZWN0KSA9PiB7XG4gICAgICAgIHBvb2wucXVlcnkoc3RydWN0dXJlU3FsLCAoZXJyb3IpID0+IHtcbiAgICAgICAgICBpZiAoZXJyb3IpIHJlamVjdChlcnJvcilcbiAgICAgICAgICBlbHNlIHJlc29sdmUodW5kZWZpbmVkKVxuICAgICAgICB9KVxuICAgICAgfSlcbiAgICAgIGZhaWxlZCA9IGZhbHNlXG4gICAgfSBmaW5hbGx5IHtcbiAgICAgIHRoaXMuX2ZpbmlzaFByb2ZpbGVkUXVlcnlBdHRlbXB0KHByb2ZpbGVBdHRlbXB0LCBmYWlsZWQpXG4gICAgfVxuXG4gICAgcmV0dXJuIHRydWVcbiAgfVxuXG4gIC8qKlxuICAgKiBVc2VzIG9uZSBtdWx0aS1zdGF0ZW1lbnQgcmVxdWVzdCBvbmx5IHdoZW4gdGhlIGV4aXN0aW5nIGNvbm5lY3Rpb24gb3B0aW9uXG4gICAqIGV4cGxpY2l0bHkgYWxsb3dzIGl0OyBvdGhlcndpc2UgcmV0YWlucyB0aGUgYmFzZSBzZXF1ZW50aWFsIGJlaGF2aW9yLlxuICAgKiBAcGFyYW0ge0FycmF5PGltcG9ydChcIi4uL2Jhc2UtdGFibGUuanNcIikuZGVmYXVsdD59IHRhYmxlcyAtIEVsaWdpYmxlIHRhYmxlcy5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgd2hlbiBldmVyeSB0YWJsZSBoYXMgYmVlbiB0cnVuY2F0ZWQuXG4gICAqL1xuICBhc3luYyB0cnVuY2F0ZVRhYmxlcyh0YWJsZXMpIHtcbiAgICBpZiAoIXRoaXMuZ2V0QXJncygpLm11bHRpcGxlU3RhdGVtZW50cykge1xuICAgICAgYXdhaXQgc3VwZXIudHJ1bmNhdGVUYWJsZXModGFibGVzKVxuICAgICAgcmV0dXJuXG4gICAgfVxuXG4gICAgY29uc3Qgc3RhdGVtZW50cyA9IHRhYmxlcy5tYXAoKHRhYmxlKSA9PiBgVFJVTkNBVEUgVEFCTEUgJHt0aGlzLnF1b3RlVGFibGUodGFibGUuZ2V0TmFtZSgpKX1gKVxuXG4gICAgYXdhaXQgdGhpcy5xdWVyeShzdGF0ZW1lbnRzLmpvaW4oXCI7XFxuXCIpKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgcXVlcnkgdG8gc3FsLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uLy4uL3F1ZXJ5L2luZGV4LmpzXCIpLmRlZmF1bHR9IHF1ZXJ5IC0gUXVlcnkgaW5zdGFuY2UuXG4gICAqIEByZXR1cm5zIHtzdHJpbmd9IC0gU1FMIHN0cmluZy5cbiAgICovXG4gIHF1ZXJ5VG9TcWwocXVlcnkpIHsgcmV0dXJuIG5ldyBRdWVyeVBhcnNlcih7cXVlcnl9KS50b1NxbCgpIH1cblxuICAvKipcbiAgICogUnVucyBzaG91bGQgc2V0IGF1dG8gaW5jcmVtZW50IHdoZW4gcHJpbWFyeSBrZXkuXG4gICAqIEByZXR1cm5zIHtib29sZWFufSAtIFdoZXRoZXIgc2V0IGF1dG8gaW5jcmVtZW50IHdoZW4gcHJpbWFyeSBrZXkuXG4gICAqL1xuICBzaG91bGRTZXRBdXRvSW5jcmVtZW50V2hlblByaW1hcnlLZXkoKSB7IHJldHVybiB0cnVlIH1cbiAgc3VwcG9ydHNEZWZhdWx0UHJpbWFyeUtleVVVSUQoKSB7IHJldHVybiBmYWxzZSB9XG4gIHN1cHBvcnRzQ3Jvc3NEYXRhYmFzZVJlZmVyZW5jZXMoKSB7IHJldHVybiB0cnVlIH1cblxuICAvKipcbiAgICogUnVucyBlc2NhcGUuXG4gICAqIEBwYXJhbSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59IHZhbHVlIC0gVmFsdWUgdG8gdXNlLlxuICAgKiBAcmV0dXJucyB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59IC0gVGhlIGVzY2FwZS5cbiAgICovXG4gIGVzY2FwZSh2YWx1ZSkge1xuICAgIGNvbnN0IGVzY2FwZWRWYWx1ZVdpdGhRdW90ZXMgPSB0aGlzLnBvb2xcbiAgICAgID8gdGhpcy5wb29sLmVzY2FwZSh0aGlzLl9jb252ZXJ0VmFsdWUodmFsdWUpKVxuICAgICAgOiBteXNxbC5lc2NhcGUodGhpcy5fY29udmVydFZhbHVlKHZhbHVlKSlcblxuICAgIHJldHVybiBlc2NhcGVkVmFsdWVXaXRoUXVvdGVzLnNsaWNlKDEsIGVzY2FwZWRWYWx1ZVdpdGhRdW90ZXMubGVuZ3RoIC0gMSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHF1b3RlLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gdmFsdWUgLSBWYWx1ZSB0byB1c2UuXG4gICAqIEByZXR1cm5zIHtzdHJpbmd9IC0gVGhlIHF1b3RlLlxuICAgKi9cbiAgcXVvdGUodmFsdWUpIHtcbiAgICBpZiAodGhpcy5wb29sKSB7XG4gICAgICByZXR1cm4gdGhpcy5wb29sLmVzY2FwZSh0aGlzLl9jb252ZXJ0VmFsdWUodmFsdWUpKVxuICAgIH1cblxuICAgIHJldHVybiBteXNxbC5lc2NhcGUodGhpcy5fY29udmVydFZhbHVlKHZhbHVlKSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGRlbGV0ZSBzcWwuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vYmFzZS5qc1wiKS5EZWxldGVTcWxBcmdzVHlwZX0gYXJncyAtIE9wdGlvbnMgb2JqZWN0LlxuICAgKiBAcmV0dXJucyB7c3RyaW5nfSAtIFNRTCBzdHJpbmcuXG4gICAqL1xuICBkZWxldGVTcWwoe3RhYmxlTmFtZSwgY29uZGl0aW9uc30pIHtcbiAgICBjb25zdCBkZWxldGVJbnN0cnVjdGlvbiA9IG5ldyBEZWxldGUoe2NvbmRpdGlvbnMsIGRyaXZlcjogdGhpcywgdGFibGVOYW1lfSlcblxuICAgIHJldHVybiBkZWxldGVJbnN0cnVjdGlvbi50b1NxbCgpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBpbnNlcnQgc3FsLlxuICAgKiBAYWJzdHJhY3RcbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9iYXNlLmpzXCIpLkluc2VydFNxbEFyZ3NUeXBlfSBhcmdzIC0gT3B0aW9ucyBvYmplY3QuXG4gICAqIEByZXR1cm5zIHtzdHJpbmd9IC0gU1FMIHN0cmluZy5cbiAgICovXG4gIGluc2VydFNxbChhcmdzKSB7XG4gICAgY29uc3QgaW5zZXJ0QXJncyA9IE9iamVjdC5hc3NpZ24oe2RyaXZlcjogdGhpc30sIGFyZ3MpXG4gICAgY29uc3QgaW5zZXJ0ID0gbmV3IEluc2VydChpbnNlcnRBcmdzKVxuXG4gICAgcmV0dXJuIGluc2VydC50b1NxbCgpXG4gIH1cblxuICAvKipcbiAgICogTWFyaWFEQiBza2lwcyBpbmZvcm1hdGlvbi1zY2hlbWEvU0hPVyByZWFkcyBmb3IgYSB0YWJsZSB3aG9zZSBkZWZpbml0aW9uIGlzIGJlaW5nIG1vZGlmaWVkXG4gICAqIGJ5IGNvbmN1cnJlbnQgb25saW5lIERETCAoRVJfV0FSTl9JX1NfU0tJUFBFRF9UQUJMRSkuIFRoZSBidWlsZCBjb21wbGV0ZXMgaW4gc2Vjb25kcywgc28gdGhlXG4gICAqIHNraXAgaXMgdHJhbnNpZW50IGNvbnRlbnRpb24gdGhhdCB0aGUgYm91bmRlZCBzY2hlbWEtbWV0YWRhdGEgcmV0cnkgY2FuIG91dGxhc3QuIFF1ZXJ5XG4gICAqIGhlbHBlcnMgd3JhcCB0aGUgZHJpdmVyIGVycm9yLCBzbyB0aGUgY29kZSBpcyBzZWFyY2hlZCB0aHJvdWdoIHRoZSBjYXVzZSBjaGFpbi5cbiAgICogQHBhcmFtIHt1bmtub3dufSBlcnJvciAtIEVycm9yIHJhaXNlZCBieSBhIHNjaGVtYS1tZXRhZGF0YSByZWFkLlxuICAgKiBAcmV0dXJucyB7Ym9vbGVhbn0gLSBXaGV0aGVyIHRoZSByZWFkIGhpdCBjb25jdXJyZW50LURETCBtZXRhZGF0YSBjb250ZW50aW9uLlxuICAgKi9cbiAgX2lzVHJhbnNpZW50U2NoZW1hTWV0YWRhdGFFcnJvcihlcnJvcikge1xuICAgIGxldCBjdXJyZW50RXJyb3IgPSAvKiogQHR5cGUge3tjb2RlPzogc3RyaW5nLCBjYXVzZT86IHVua25vd259IHwgdW5kZWZpbmVkfSAqLyAoXG4gICAgICAvKiogQHR5cGUge3Vua25vd259ICovIChlcnJvcilcbiAgICApXG5cbiAgICBmb3IgKGxldCBkZXB0aCA9IDA7IGRlcHRoIDwgNSAmJiBjdXJyZW50RXJyb3I7IGRlcHRoKyspIHtcbiAgICAgIGlmIChjdXJyZW50RXJyb3IuY29kZSA9PT0gXCJFUl9XQVJOX0lfU19TS0lQUEVEX1RBQkxFXCIpIHJldHVybiB0cnVlXG4gICAgICBjdXJyZW50RXJyb3IgPSAvKiogQHR5cGUge3tjb2RlPzogc3RyaW5nLCBjYXVzZT86IHVua25vd259IHwgdW5kZWZpbmVkfSAqLyAoXG4gICAgICAgIC8qKiBAdHlwZSB7dW5rbm93bn0gKi8gKGN1cnJlbnRFcnJvci5jYXVzZSlcbiAgICAgIClcbiAgICB9XG5cbiAgICByZXR1cm4gZmFsc2VcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGdldCB0YWJsZXMuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPEFycmF5PGltcG9ydChcIi4uL2Jhc2UtdGFibGUuanNcIikuZGVmYXVsdD4+fSAtIFJlc29sdmVzIHdpdGggdGhlIHRhYmxlcy5cbiAgICovXG4gIGFzeW5jIGdldFRhYmxlcygpIHtcbiAgICByZXR1cm4gYXdhaXQgdGhpcy5fY2FjaGVkU2NoZW1hTWV0YWRhdGEoXCJ0YWJsZXNcIiwgYXN5bmMgKCkgPT4ge1xuICAgICAgY29uc3QgcmVzdWx0ID0gYXdhaXQgdGhpcy5xdWVyeShcIlNIT1cgRlVMTCBUQUJMRVNcIilcbiAgICAgIGNvbnN0IHRhYmxlcyA9IFtdXG5cbiAgICAgIGZvciAoY29uc3Qgcm93IG9mIHJlc3VsdCkge1xuICAgICAgICBjb25zdCB0YWJsZSA9IG5ldyBUYWJsZSh0aGlzLCAvKiogQHR5cGUge1JlY29yZDxzdHJpbmcsIHN0cmluZz59ICovIChyb3cpKVxuXG4gICAgICAgIHRhYmxlcy5wdXNoKHRhYmxlKVxuICAgICAgfVxuXG4gICAgICByZXR1cm4gdGFibGVzXG4gICAgfSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHN0cnVjdHVyZSBzcWwuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHN0cmluZyB8IG51bGw+fSAtIFJlc29sdmVzIHdpdGggU1FMIHN0cmluZy5cbiAgICovXG4gIGFzeW5jIHN0cnVjdHVyZVNxbCgpIHtcbiAgICByZXR1cm4gYXdhaXQgdGhpcy5fY2FjaGVkU2NoZW1hTWV0YWRhdGEoXCJzdHJ1Y3R1cmVTcWxcIiwgYXN5bmMgKCkgPT4gYXdhaXQgbmV3IFN0cnVjdHVyZVNxbCh7ZHJpdmVyOiB0aGlzfSkudG9TcWwoKSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGxhc3QgaW5zZXJ0IGlkLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL2Jhc2UuanNcIikuUXVlcnlPcHRpb25zfSBbb3B0aW9uc10gLSBRdWVyeSBvd25lcnNoaXAgb3B0aW9ucy5cbiAgICogQHJldHVybnMge1Byb21pc2U8bnVtYmVyPn0gLSBSZXNvbHZlcyB3aXRoIHRoZSBsYXN0IGluc2VydCBpZC5cbiAgICovXG4gIGFzeW5jIGxhc3RJbnNlcnRJRChvcHRpb25zID0ge30pIHtcbiAgICBjb25zdCByZXN1bHQgPSBhd2FpdCB0aGlzLnF1ZXJ5KFwiU0VMRUNUIExBU1RfSU5TRVJUX0lEKCkgQVMgbGFzdF9pbnNlcnRfaWRcIiwgb3B0aW9ucylcblxuICAgIHJldHVybiBkaWdnKHJlc3VsdCwgMCwgXCJsYXN0X2luc2VydF9pZFwiKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgb3B0aW9ucy5cbiAgICogQHJldHVybnMge09wdGlvbnN9IC0gVGhlIG9wdGlvbnMgb3B0aW9ucy5cbiAgICovXG4gIG9wdGlvbnMoKSB7XG4gICAgaWYgKCF0aGlzLl9vcHRpb25zKSB0aGlzLl9vcHRpb25zID0gbmV3IE9wdGlvbnMoe2RyaXZlcjogdGhpc30pXG5cbiAgICByZXR1cm4gdGhpcy5fb3B0aW9uc1xuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgc3RhcnQgdHJhbnNhY3Rpb24gYWN0aW9uLlxuICAgKiBAcGFyYW0ge1BpY2s8aW1wb3J0KFwiLi4vYmFzZS5qc1wiKS5RdWVyeU9wdGlvbnMsIFwib3BlcmF0aW9uT3duZXJcIj59IFtvcHRpb25zXSAtIFRyYW5zYWN0aW9uIG93bmVyc2hpcC5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgd2hlbiBjb21wbGV0ZS5cbiAgICovXG4gIGFzeW5jIF9zdGFydFRyYW5zYWN0aW9uQWN0aW9uKG9wdGlvbnMgPSB7fSkge1xuICAgIGF3YWl0IHRoaXMucXVlcnkoXCJTVEFSVCBUUkFOU0FDVElPTlwiLCBvcHRpb25zKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgdXBkYXRlIHNxbC5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9iYXNlLmpzXCIpLlVwZGF0ZVNxbEFyZ3NUeXBlfSBhcmdzIC0gT3B0aW9ucyBvYmplY3QuXG4gICAqIEByZXR1cm5zIHtzdHJpbmd9IC0gU1FMIHN0cmluZy5cbiAgICovXG4gIHVwZGF0ZVNxbCh7Y29uZGl0aW9ucywgZGF0YSwgdGFibGVOYW1lfSkge1xuICAgIGNvbnN0IHVwZGF0ZSA9IG5ldyBVcGRhdGUoe2NvbmRpdGlvbnMsIGRhdGEsIGRyaXZlcjogdGhpcywgdGFibGVOYW1lfSlcblxuICAgIHJldHVybiB1cGRhdGUudG9TcWwoKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgdXBzZXJ0IHNxbC5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9iYXNlLmpzXCIpLlVwc2VydFNxbEFyZ3NUeXBlfSBhcmdzIC0gT3B0aW9ucyBvYmplY3QuXG4gICAqIEByZXR1cm5zIHtzdHJpbmd9IC0gU1FMIHN0cmluZy5cbiAgICovXG4gIHVwc2VydFNxbChhcmdzKSB7XG4gICAgY29uc3QgdXBzZXJ0ID0gbmV3IFVwc2VydCh7Li4uYXJncywgZHJpdmVyOiB0aGlzfSlcblxuICAgIHJldHVybiB1cHNlcnQudG9TcWwoKVxuICB9XG5cbiAgLyoqXG4gICAqIEJsb2NrcyB1bnRpbCBhIE15U1FML01hcmlhREIgdXNlci1sZXZlbCBsb2NrIGlzIGFjcXVpcmVkIG9uIHRoaXNcbiAgICogY29ubmVjdGlvbi4gSW1wbGVtZW50ZWQgdmlhIGBHRVRfTE9DSyhuYW1lLCB0aW1lb3V0KWAsIHdoZXJlIHRoZVxuICAgKiB0aW1lb3V0IGlzIGluIHNlY29uZHMuXG4gICAqXG4gICAqIE15U1FMIGhpc3RvcmljYWxseSBkb2N1bWVudGVkIGEgbmVnYXRpdmUgdGltZW91dCBhcyBcImluZmluaXRlXCIsXG4gICAqIGJ1dCBNYXJpYURCIDEwKyBzaWxlbnRseSByZWplY3RzIG5lZ2F0aXZlIHRpbWVvdXRzIGFuZCByZXR1cm5zXG4gICAqIGBOVUxMYCBmcm9tIGBHRVRfTE9DS2AuIFRvIG1ha2UgdGhlIGhlbHBlciBwb3J0YWJsZSBhY3Jvc3MgTXlTUUxcbiAgICogYW5kIE1hcmlhREIgdGhlIFwiaW5kZWZpbml0ZVwiIGNhc2UgaXMgZW5jb2RlZCBhcyBhIGxhcmdlIHBvc2l0aXZlXG4gICAqIHRpbWVvdXQgKG9uZSB5ZWFyKSwgd2hpY2ggaXMgY29tZm9ydGFibHkgbG9uZ2VyIHRoYW4gYW55XG4gICAqIHJlYWxpc3RpYyBjcml0aWNhbCBzZWN0aW9uIGFuZCB3b3JrcyBvbiBldmVyeSBzdXBwb3J0ZWQgdmVyc2lvbi5cbiAgICogQHBhcmFtIHtzdHJpbmd9IG5hbWUgLSBMb2NrIG5hbWUuXG4gICAqIEBwYXJhbSB7e3RpbWVvdXRNcz86IG51bWJlciB8IG51bGx9fSBbYXJnc10gLSBPcHRpb25hbCB0aW1lb3V0IGluIG1pbGxpc2Vjb25kczsgYG51bGxgLCBgdW5kZWZpbmVkYCwgb3IgbmVnYXRpdmUgYmxvY2tzIGZvciBgTVlTUUxfSU5ERUZJTklURV9MT0NLX1RJTUVPVVRfU0VDT05EU2AuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPGJvb2xlYW4+fSAtIFRydWUgaWYgYWNxdWlyZWQsIGZhbHNlIGlmIHRoZSB0aW1lb3V0IGVsYXBzZWQuXG4gICAqL1xuICBhc3luYyBfYWNxdWlyZUFkdmlzb3J5TG9jayhuYW1lLCB7dGltZW91dE1zfSA9IHt9KSB7XG4gICAgY29uc3QgdGltZW91dFNlY29uZHMgPSB0eXBlb2YgdGltZW91dE1zID09PSBcIm51bWJlclwiICYmIHRpbWVvdXRNcyA+PSAwXG4gICAgICA/IE1hdGguY2VpbCh0aW1lb3V0TXMgLyAxMDAwKVxuICAgICAgOiBNWVNRTF9JTkRFRklOSVRFX0xPQ0tfVElNRU9VVF9TRUNPTkRTXG4gICAgY29uc3Qgcm93cyA9IGF3YWl0IHRoaXMucXVlcnkoYFNFTEVDVCBHRVRfTE9DSygke3RoaXMucXVvdGUobmFtZSl9LCAke3RpbWVvdXRTZWNvbmRzfSkgQVMgdmVsb2Npb3VzX2Fkdmlzb3J5X2xvY2tfcmVzdWx0YClcbiAgICBjb25zdCByZXN1bHQgPSByb3dzPy5bMF0/LnZlbG9jaW91c19hZHZpc29yeV9sb2NrX3Jlc3VsdFxuXG4gICAgaWYgKHJlc3VsdCA9PT0gbnVsbCB8fCByZXN1bHQgPT09IHVuZGVmaW5lZCkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKGBHRVRfTE9DSyByZXR1cm5lZCBOVUxMIGZvciBhZHZpc29yeSBsb2NrICR7SlNPTi5zdHJpbmdpZnkobmFtZSl9ICh0eXBpY2FsbHkgYW4gb3V0LW9mLW1lbW9yeSBvciB0aHJlYWQta2lsbGVkIGNvbmRpdGlvbilgKVxuICAgIH1cblxuICAgIHJldHVybiBOdW1iZXIocmVzdWx0KSA9PT0gMVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgdHJ5IGFjcXVpcmUgYWR2aXNvcnkgbG9jay5cbiAgICogQHBhcmFtIHtzdHJpbmd9IG5hbWUgLSBMb2NrIG5hbWUuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPGJvb2xlYW4+fSAtIFRydWUgaWYgdGhlIGxvY2sgd2FzIGFjcXVpcmVkLCBmYWxzZSBpZiBpdCB3YXMgYWxyZWFkeSBoZWxkLlxuICAgKi9cbiAgYXN5bmMgX3RyeUFjcXVpcmVBZHZpc29yeUxvY2sobmFtZSkge1xuICAgIGNvbnN0IHJvd3MgPSBhd2FpdCB0aGlzLnF1ZXJ5KGBTRUxFQ1QgR0VUX0xPQ0soJHt0aGlzLnF1b3RlKG5hbWUpfSwgMCkgQVMgdmVsb2Npb3VzX2Fkdmlzb3J5X2xvY2tfcmVzdWx0YClcbiAgICBjb25zdCByZXN1bHQgPSByb3dzPy5bMF0/LnZlbG9jaW91c19hZHZpc29yeV9sb2NrX3Jlc3VsdFxuXG4gICAgaWYgKHJlc3VsdCA9PT0gbnVsbCB8fCByZXN1bHQgPT09IHVuZGVmaW5lZCkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKGBHRVRfTE9DSyByZXR1cm5lZCBOVUxMIGZvciBhZHZpc29yeSBsb2NrICR7SlNPTi5zdHJpbmdpZnkobmFtZSl9ICh0eXBpY2FsbHkgYW4gb3V0LW9mLW1lbW9yeSBvciB0aHJlYWQta2lsbGVkIGNvbmRpdGlvbilgKVxuICAgIH1cblxuICAgIHJldHVybiBOdW1iZXIocmVzdWx0KSA9PT0gMVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgcmVsZWFzZSBhZHZpc29yeSBsb2NrLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gbmFtZSAtIExvY2sgbmFtZS5cbiAgICogQHJldHVybnMge1Byb21pc2U8Ym9vbGVhbj59IC0gVHJ1ZSBpZiB0aGUgbG9jayB3YXMgaGVsZCBieSB0aGlzIHNlc3Npb24gYW5kIGhhcyBub3cgYmVlbiByZWxlYXNlZC5cbiAgICovXG4gIGFzeW5jIF9yZWxlYXNlQWR2aXNvcnlMb2NrKG5hbWUpIHtcbiAgICBjb25zdCByb3dzID0gYXdhaXQgdGhpcy5xdWVyeShgU0VMRUNUIFJFTEVBU0VfTE9DSygke3RoaXMucXVvdGUobmFtZSl9KSBBUyB2ZWxvY2lvdXNfYWR2aXNvcnlfbG9ja19yZXN1bHRgLCB7cmV0cnk6IGZhbHNlfSlcbiAgICBjb25zdCByZXN1bHQgPSByb3dzPy5bMF0/LnZlbG9jaW91c19hZHZpc29yeV9sb2NrX3Jlc3VsdFxuXG4gICAgcmV0dXJuIE51bWJlcihyZXN1bHQpID09PSAxXG4gIH1cblxuICAvKipcbiAgICogRHJpdmVyLW5hdGl2ZSB2aWV3IGZvciB0aGUgYmFzZSBkcml2ZXIncyBgaXNBZHZpc29yeUxvY2tIZWxkYCwgd2hpY2hcbiAgICogYW5zd2VycyBmcm9tIHRoZSBwcm9jZXNzLWxvY2FsIHRpZXIgZmlyc3QuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBuYW1lIC0gTG9jayBuYW1lLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxib29sZWFuPn0gLSBUcnVlIGlmIGFueSBzZXNzaW9uIGN1cnJlbnRseSBob2xkcyB0aGUgbG9jay5cbiAgICovXG4gIGFzeW5jIF9pc0Fkdmlzb3J5TG9ja0hlbGROYXRpdmUobmFtZSkge1xuICAgIGNvbnN0IHJvd3MgPSBhd2FpdCB0aGlzLnF1ZXJ5KGBTRUxFQ1QgSVNfVVNFRF9MT0NLKCR7dGhpcy5xdW90ZShuYW1lKX0pIEFTIHZlbG9jaW91c19hZHZpc29yeV9sb2NrX2hvbGRlcmApXG4gICAgY29uc3QgaG9sZGVyID0gcm93cz8uWzBdPy52ZWxvY2lvdXNfYWR2aXNvcnlfbG9ja19ob2xkZXJcblxuICAgIHJldHVybiBob2xkZXIgIT09IG51bGwgJiYgaG9sZGVyICE9PSB1bmRlZmluZWRcbiAgfVxufVxuIl19