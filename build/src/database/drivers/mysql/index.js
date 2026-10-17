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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiaW5kZXguanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi8uLi8uLi9zcmMvZGF0YWJhc2UvZHJpdmVycy9teXNxbC9pbmRleC5qcyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiQUFBQSxZQUFZO0FBRVosT0FBTyxVQUFVLE1BQU0sc0JBQXNCLENBQUE7QUFDN0MsT0FBTyxJQUFJLE1BQU0sWUFBWSxDQUFBO0FBQzdCLE9BQU8sY0FBYyxNQUFNLDBCQUEwQixDQUFBO0FBQ3JELE9BQU8sV0FBVyxNQUFNLHVCQUF1QixDQUFBO0FBQy9DLE9BQU8sV0FBVyxNQUFNLHVCQUF1QixDQUFBO0FBQy9DLE9BQU8sTUFBTSxNQUFNLGlCQUFpQixDQUFBO0FBQ3BDLE9BQU8sRUFBQyxJQUFJLEVBQUMsTUFBTSxXQUFXLENBQUE7QUFDOUIsT0FBTyxZQUFZLE1BQU0sd0JBQXdCLENBQUE7QUFDakQsT0FBTyxTQUFTLE1BQU0scUJBQXFCLENBQUE7QUFDM0MsT0FBTyxNQUFNLE1BQU0saUJBQWlCLENBQUE7QUFDcEMsT0FBTyxPQUFPLE1BQU0sY0FBYyxDQUFBO0FBQ2xDLE9BQU8sS0FBSyxNQUFNLE9BQU8sQ0FBQTtBQUN6QixPQUFPLEtBQUssTUFBTSxZQUFZLENBQUE7QUFDOUIsT0FBTyxpQkFBaUIsTUFBTSw4QkFBOEIsQ0FBQTtBQUM1RCxPQUFPLFdBQVcsTUFBTSxtQkFBbUIsQ0FBQTtBQUMzQyxPQUFPLFdBQVcsTUFBTSxtQkFBbUIsQ0FBQTtBQUMzQyxPQUFPLFdBQVcsTUFBTSx1QkFBdUIsQ0FBQTtBQUMvQyxPQUFPLEtBQUssTUFBTSxZQUFZLENBQUE7QUFDOUIsT0FBTyxZQUFZLE1BQU0sb0JBQW9CLENBQUE7QUFDN0MsT0FBTyxNQUFNLE1BQU0saUJBQWlCLENBQUE7QUFDcEMsT0FBTyxNQUFNLE1BQU0saUJBQWlCLENBQUE7QUFDcEMsT0FBTywwQkFBMEIsTUFBTSxpQ0FBaUMsQ0FBQTtBQUV4RTs7Ozs7OztHQU9HO0FBQ0gsTUFBTSxx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QUMzRyxNQUFNLE1BQU0sR0FBRyxJQUFJLEVBQUUsQ0FBQyxDQUFDLENBQUMsRUFBRSw4QkFBOEIsQ0FBQTtRQUV4RCxPQUFPLE1BQU0sS0FBSyxJQUFJLElBQUksTUFBTSxLQUFLLFNBQVMsQ0FBQyxDQUFDLENBQUMsSUFBSSxDQUFDLENBQUMsQ0FBQyxNQUFNLENBQUMsTUFBTSxDQUFDLENBQUE7SUFDeEUsQ0FBQztJQUVEOzs7OztPQUtHO0lBQ0gsS0FBSyxDQUFDLHlCQUF5QixDQUFDLElBQUk7UUFDbEMsTUFBTSxJQUFJLEdBQUcsTUFBTSxJQUFJLENBQUMsS0FBSyxDQUFDLHVCQUF1QixJQUFJLENBQUMsS0FBSyxDQUFDLElBQUksQ0FBQyxxQ0FBcUMsQ0FBQyxDQUFBO1FBQzNHLE1BQU0sTUFBTSxHQUFHLElBQUksRUFBRSxDQUFDLENBQUMsQ0FBQyxFQUFFLDhCQUE4QixDQUFBO1FBRXhELE9BQU8sTUFBTSxLQUFLLElBQUksSUFBSSxNQUFNLEtBQUssU0FBUyxDQUFBO0lBQ2hELENBQUM7Q0FDRiIsInNvdXJjZXNDb250ZW50IjpbIi8vIEB0cy1jaGVja1xuXG5pbXBvcnQgQWx0ZXJUYWJsZSBmcm9tIFwiLi9zcWwvYWx0ZXItdGFibGUuanNcIlxuaW1wb3J0IEJhc2UgZnJvbSBcIi4uL2Jhc2UuanNcIlxuaW1wb3J0IENyZWF0ZURhdGFiYXNlIGZyb20gXCIuL3NxbC9jcmVhdGUtZGF0YWJhc2UuanNcIlxuaW1wb3J0IENyZWF0ZUluZGV4IGZyb20gXCIuL3NxbC9jcmVhdGUtaW5kZXguanNcIlxuaW1wb3J0IENyZWF0ZVRhYmxlIGZyb20gXCIuL3NxbC9jcmVhdGUtdGFibGUuanNcIlxuaW1wb3J0IERlbGV0ZSBmcm9tIFwiLi9zcWwvZGVsZXRlLmpzXCJcbmltcG9ydCB7ZGlnZ30gZnJvbSBcImRpZ2dlcml6ZVwiXG5pbXBvcnQgRHJvcERhdGFiYXNlIGZyb20gXCIuL3NxbC9kcm9wLWRhdGFiYXNlLmpzXCJcbmltcG9ydCBEcm9wVGFibGUgZnJvbSBcIi4vc3FsL2Ryb3AtdGFibGUuanNcIlxuaW1wb3J0IEluc2VydCBmcm9tIFwiLi9zcWwvaW5zZXJ0LmpzXCJcbmltcG9ydCBPcHRpb25zIGZyb20gXCIuL29wdGlvbnMuanNcIlxuaW1wb3J0IG15c3FsIGZyb20gXCJteXNxbFwiXG5pbXBvcnQgcXVlcnkgZnJvbSBcIi4vcXVlcnkuanNcIlxuaW1wb3J0IFF1ZXJ5QWJvcnRlZEVycm9yIGZyb20gXCIuLi8uLi9xdWVyeS1hYm9ydGVkLWVycm9yLmpzXCJcbmltcG9ydCBRdWVyeVBhcnNlciBmcm9tIFwiLi9xdWVyeS1wYXJzZXIuanNcIlxuaW1wb3J0IHN0cmVhbVF1ZXJ5IGZyb20gXCIuL3F1ZXJ5LXN0cmVhbS5qc1wiXG5pbXBvcnQgUmVtb3ZlSW5kZXggZnJvbSBcIi4vc3FsL3JlbW92ZS1pbmRleC5qc1wiXG5pbXBvcnQgVGFibGUgZnJvbSBcIi4vdGFibGUuanNcIlxuaW1wb3J0IFN0cnVjdHVyZVNxbCBmcm9tIFwiLi9zdHJ1Y3R1cmUtc3FsLmpzXCJcbmltcG9ydCBVcHNlcnQgZnJvbSBcIi4vc3FsL3Vwc2VydC5qc1wiXG5pbXBvcnQgVXBkYXRlIGZyb20gXCIuL3NxbC91cGRhdGUuanNcIlxuaW1wb3J0IHBhcnNlSW5ub2RiRGVhZGxvY2tTdW1tYXJ5IGZyb20gXCIuL2RlYWRsb2NrLWRpYWdub3N0aWMtcGFyc2VyLmpzXCJcblxuLyoqXG4gKiBTZW50aW5lbCB0aW1lb3V0IChpbiBzZWNvbmRzKSB1c2VkIGFzIHRoZSBcImJsb2NrIGZvcmV2ZXJcIiB2YWx1ZSB3aGVuIGFcbiAqIGNhbGxlciBhc2tzIGZvciBhbiBpbmRlZmluaXRlIGFkdmlzb3J5IGxvY2sgYWNxdWlyZS4gTXlTUUwgaGlzdG9yaWNhbGx5XG4gKiBhY2NlcHRlZCBuZWdhdGl2ZSB0aW1lb3V0cyBhcyBcImluZmluaXRlXCIsIGJ1dCBNYXJpYURCIDEwKyBzaWxlbnRseVxuICogcmV0dXJucyBOVUxMIGZyb20gYEdFVF9MT0NLYCB3aGVuIHRoZSB0aW1lb3V0IGlzIG5lZ2F0aXZlLCBzbyB0aGVcbiAqIGRyaXZlciBjbGFtcHMgdG8gYSBjb21mb3J0YWJseSBsYXJnZSBwb3NpdGl2ZSB2YWx1ZSAoMSB5ZWFyIOKJqyBhbnlcbiAqIHJlYWxpc3RpYyBjcml0aWNhbCBzZWN0aW9uKSBpbnN0ZWFkLlxuICovXG5jb25zdCBNWVNRTF9JTkRFRklOSVRFX0xPQ0tfVElNRU9VVF9TRUNPTkRTID0gNjAgKiA2MCAqIDI0ICogMzY1XG5jb25zdCBJTk5PREJfREVBRExPQ0tfQ0FQVFVSRV9USU1FT1VUX01TID0gMjUwXG5cbmV4cG9ydCBkZWZhdWx0IGNsYXNzIFZlbG9jaW91c0RhdGFiYXNlRHJpdmVyc015c3FsIGV4dGVuZHMgQmFzZXtcbiAgLyoqIEB0eXBlIHtpbXBvcnQoXCJteXNxbFwiKS5Qb29sIHwgdW5kZWZpbmVkfSAqL1xuICBwb29sID0gdW5kZWZpbmVkXG5cbiAgLyoqIEB0eXBlIHtzdHJpbmcgfCBudWxsfSAqL1xuICBfZGVzaXJlZFNlc3Npb25UaW1lWm9uZSA9IFwiKzAwOjAwXCJcblxuICAvKiogQHR5cGUge3N0cmluZyB8IG51bGx9ICovXG4gIF9jdXJyZW50U2Vzc2lvblRpbWVab25lID0gbnVsbFxuXG4gIC8qKlxuICAgKiBSdW5zIGNvbm5lY3QuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIHdoZW4gY29tcGxldGUuXG4gICAqL1xuICBhc3luYyBjb25uZWN0KCkge1xuICAgIHRoaXMucmVzZXRDdXJyZW50U2Vzc2lvblRpbWVab25lKClcbiAgICB0aGlzLnBvb2wgPSBteXNxbC5jcmVhdGVQb29sKE9iamVjdC5hc3NpZ24oe2Nvbm5lY3Rpb25MaW1pdDogMX0sIHRoaXMuY29ubmVjdEFyZ3MoKSkpXG4gICAgdGhpcy5wb29sLm9uKFwiZXJyb3JcIiwgdGhpcy5vblBvb2xFcnJvcilcbiAgfVxuXG4gIC8qKlxuICAgKiBPbiBwb29sIGVycm9yLlxuICAgKiBAcGFyYW0ge0Vycm9yfSBlcnJvciAtIEVycm9yIGZyb20gdGhlIGNvbm5lY3Rpb24gYXR0ZW1wdC5cbiAgICovXG4gIG9uUG9vbEVycm9yID0gKGVycm9yKSA9PiB7XG4gICAgY29uc29sZS5lcnJvcihcIlZlbG9jaW91cyAvIE15U1FMIGRyaXZlciAvIFBvb2wgZXJyb3JcIiwgZXJyb3IpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBjbG9zZS5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgd2hlbiBjb21wbGV0ZS5cbiAgICovXG4gIGFzeW5jIF9jbG9zZSgpIHtcbiAgICBjb25zdCBwb29sID0gdGhpcy5wb29sXG5cbiAgICBpZiAoIXBvb2wpIHJldHVyblxuXG4gICAgYXdhaXQgbmV3IFByb21pc2UoKHJlc29sdmUsIHJlamVjdCkgPT4ge1xuICAgICAgcG9vbC5lbmQoKGVycm9yKSA9PiB7XG4gICAgICAgIGlmIChlcnJvcikge1xuICAgICAgICAgIHJlamVjdChlcnJvcilcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICByZXNvbHZlKHVuZGVmaW5lZClcbiAgICAgICAgfVxuICAgICAgfSlcbiAgICB9KVxuICAgIHRoaXMucG9vbCA9IHVuZGVmaW5lZFxuICAgIHRoaXMucmVzZXRDdXJyZW50U2Vzc2lvblRpbWVab25lKClcbiAgfVxuXG4gIC8qKlxuICAgKiBSZXNldHMgdGhlIE15U1FMIHNlc3Npb24gc3RhdGUgYWZ0ZXIgZWFjaCBsb2dpY2FsIHBvb2wgY2hlY2tvdXQgd2hpbGVcbiAgICogcmV1c2luZyB0aGUgZXhpc3RpbmcgcGh5c2ljYWwgY29ubmVjdGlvbi5cbiAgICogTXlTUUwgZXhwb3NlcyBvcGVuLWVuZGVkIHNlc3Npb24gc3RhdGUgKHVzZXIgdmFyaWFibGVzLCB0ZW1wb3JhcnkgdGFibGVzLFxuICAgKiBwcmVwYXJlZCBzdGF0ZW1lbnRzLCBgU0VUIFNFU1NJT05gIGNoYW5nZXMpLCBzbyB0aGUgc3RhdGUgbXVzdCBiZSBjbGVhcmVkXG4gICAqIGJlZm9yZSB0aGUgbG9naWNhbCBwb29sIGVudHJ5IGlzIGhhbmRlZCBvdXQgYWdhaW4uIGBDT01fQ0hBTkdFX1VTRVJgXG4gICAqIHBlcmZvcm1zIGEgZnVsbCBzZXNzaW9uIHJlLWluaXRpYWxpemF0aW9uIG9uIHRoZSBzZXJ2ZXIgc2lkZSDigJQgdGhlIHNhbWVcbiAgICogc3RhdGUgYSBmcmVzaCBoYW5kc2hha2Ugd291bGQgc3RhcnQgd2l0aCDigJQgd2l0aG91dCBvcGVuaW5nIGEgbmV3IFRDUFxuICAgKiBjb25uZWN0aW9uLiBUaGF0IGtlZXBzIGNoZWNrb3V0cyBpc29sYXRlZCBmcm9tIGVhY2ggb3RoZXIgd2hpbGUgYXZvaWRpbmdcbiAgICogYSByZWNvbm5lY3QgKGhhbmRzaGFrZSArIGF1dGggKyBzY2hlbWEgcmUtaW50cm9zcGVjdGlvbikgb24gZXZlcnlcbiAgICogb3BlcmF0aW9uLiBJZiB0aGUgcmVzZXQgZmFpbHMgdGhlIHBoeXNpY2FsIHNlc3Npb24gaXMgY2xvc2VkIGluc3RlYWQsIHNvXG4gICAqIHRoZSBuZXh0IHF1ZXJ5IHJlY29ubmVjdHMgb24gYSBmcmVzaCBzZXNzaW9uIGFzIGEgc2FmZSBmYWxsYmFjay5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgb25jZSB0aGUgc2Vzc2lvbiBzdGF0ZSBpcyByZXNldC5cbiAgICovXG4gIGFzeW5jIGNsZWFudXBTZXNzaW9uU3RhdGVBZnRlckNoZWNrb3V0KCkge1xuICAgIGNvbnN0IHBvb2wgPSB0aGlzLnBvb2xcblxuICAgIGlmICghcG9vbCkgcmV0dXJuXG5cbiAgICB0cnkge1xuICAgICAgY29uc3QgcG9vbGVkQ29ubmVjdGlvbiA9IGF3YWl0IG5ldyBQcm9taXNlKChyZXNvbHZlLCByZWplY3QpID0+IHtcbiAgICAgICAgcG9vbC5nZXRDb25uZWN0aW9uKChlcnJvciwgY29ubmVjdGlvbikgPT4ge1xuICAgICAgICAgIGlmIChlcnJvcikgcmVqZWN0KGVycm9yIGluc3RhbmNlb2YgRXJyb3IgPyBlcnJvciA6IG5ldyBFcnJvcihgRmFpbGVkIHRvIGNoZWNrIG91dCBjb25uZWN0aW9uIGZvciBzZXNzaW9uIHJlc2V0OiAke2Vycm9yfWApKVxuICAgICAgICAgIGVsc2UgcmVzb2x2ZShjb25uZWN0aW9uKVxuICAgICAgICB9KVxuICAgICAgfSlcblxuICAgICAgdHJ5IHtcbiAgICAgICAgYXdhaXQgbmV3IFByb21pc2UoKHJlc29sdmUsIHJlamVjdCkgPT4ge1xuICAgICAgICAgIHBvb2xlZENvbm5lY3Rpb24uY2hhbmdlVXNlcih7Y2hhcnNldDogXCJ1dGY4bWI0XCIsIHRpbWVvdXQ6IDEwMDAwfSwgKCgvKiogQHR5cGUge2ltcG9ydChcIm15c3FsXCIpLk15c3FsRXJyb3J9ICovIGVycm9yKSA9PiB7XG4gICAgICAgICAgICBpZiAoZXJyb3IpIHJlamVjdChlcnJvciBpbnN0YW5jZW9mIEVycm9yID8gZXJyb3IgOiBuZXcgRXJyb3IoYE15U1FMIHNlc3Npb24gcmVzZXQgZmFpbGVkOiAke2Vycm9yfWApKVxuICAgICAgICAgICAgZWxzZSByZXNvbHZlKHVuZGVmaW5lZClcbiAgICAgICAgICB9KSlcbiAgICAgICAgfSlcbiAgICAgIH0gZmluYWxseSB7XG4gICAgICAgIHBvb2xlZENvbm5lY3Rpb24ucmVsZWFzZSgpXG4gICAgICB9XG5cbiAgICAgIC8vIFRoZSBzZXJ2ZXIgcmUtaW5pdGlhbGl6ZWQgdGhlIHNlc3Npb24gb24gdGhpcyBzb2NrZXQ6IHVzZXIgdmFyaWFibGVzLFxuICAgICAgLy8gdGVtcG9yYXJ5IHRhYmxlcywgcHJlcGFyZWQgc3RhdGVtZW50cywgYW5kIHNlc3Npb24gdmFyaWFibGVzIGFyZSBnb25lLFxuICAgICAgLy8gYW5kIHRoZSBzZXNzaW9uIHRpbWUgem9uZSBtdXN0IGJlIHJlLWVzdGFibGlzaGVkIGJlZm9yZSB0aGUgbmV4dCBxdWVyeS5cbiAgICAgIHRoaXMucmVzZXRDdXJyZW50U2Vzc2lvblRpbWVab25lKClcbiAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgLy8gQSBmYWlsZWQgcmVzZXQgbGVhdmVzIHRoZSBzZXNzaW9uIHN0YXRlIHVua25vd24sIHNvIGZhbGwgYmFjayB0byBhXG4gICAgICAvLyBmdWxsIHBoeXNpY2FsIGRpc2Nvbm5lY3Q6IHRoZSBuZXh0IHF1ZXJ5IHJlY29ubmVjdHMgb24gYSBmcmVzaCBzZXNzaW9uLlxuICAgICAgLy8gVGhlIGxvZ2ljYWwgY29ubmVjdGlvbiBpcyBzdGlsbCByZXVzYWJsZSBhZnRlcndhcmRzLlxuICAgICAgdHJ5IHtcbiAgICAgICAgYXdhaXQgdGhpcy5fY2xvc2UoKVxuICAgICAgfSBjYXRjaCAoY2xvc2VFcnJvcikge1xuICAgICAgICB0aHJvdyBuZXcgQWdncmVnYXRlRXJyb3IoW2Vycm9yLCBjbG9zZUVycm9yXSwgXCJNeVNRTCBzZXNzaW9uIHJlc2V0IGZhaWxlZCBhbmQgdGhlIHBoeXNpY2FsIGRpc2Nvbm5lY3QgZmFsbGJhY2sgYWxzbyBmYWlsZWRcIiwge2NhdXNlOiBjbG9zZUVycm9yfSlcbiAgICAgIH1cblxuICAgICAgdGhyb3cgZXJyb3JcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogUnVucyBzZXQgY29ubmVjdGlvbiBjaGVja291dCBuYW1lLlxuICAgKiBAcGFyYW0ge3N0cmluZyB8IHVuZGVmaW5lZH0gbmFtZSAtIEh1bWFuLXJlYWRhYmxlIG5hbWUgZm9yIHRoaXMgYWN0aXZlIGNoZWNrb3V0LlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyB3aGVuIGNvbXBsZXRlLlxuICAgKi9cbiAgYXN5bmMgc2V0Q29ubmVjdGlvbkNoZWNrb3V0TmFtZShuYW1lKSB7XG4gICAgY29uc3QgcHJldmlvdXNOYW1lID0gdGhpcy5fY29ubmVjdGlvbkNoZWNrb3V0TmFtZVxuXG4gICAgYXdhaXQgc3VwZXIuc2V0Q29ubmVjdGlvbkNoZWNrb3V0TmFtZShuYW1lKVxuXG4gICAgaWYgKG5hbWUgPT09IHVuZGVmaW5lZCkge1xuICAgICAgaWYgKHByZXZpb3VzTmFtZSAhPT0gdW5kZWZpbmVkKSB7XG4gICAgICAgIGF3YWl0IHRoaXMucXVlcnkoXCJTRVQgQHZlbG9jaW91c19jb25uZWN0aW9uX2NoZWNrb3V0X25hbWUgPSBOVUxMXCIsIHtsb2dOYW1lOiBcIkNsZWFyIENvbm5lY3Rpb24gQ2hlY2tvdXQgTmFtZVwiLCBwcm9jZXNzTGlzdENvbW1lbnQ6IGZhbHNlLCBzZXNzaW9uVGltZVpvbmU6IGZhbHNlfSlcbiAgICAgIH1cblxuICAgICAgcmV0dXJuXG4gICAgfVxuXG4gICAgYXdhaXQgdGhpcy5xdWVyeShgU0VUIEB2ZWxvY2lvdXNfY29ubmVjdGlvbl9jaGVja291dF9uYW1lID0gJHt0aGlzLnF1b3RlKG5hbWUpfWAsIHtsb2dOYW1lOiBcIlNldCBDb25uZWN0aW9uIENoZWNrb3V0IE5hbWVcIiwgcHJvY2Vzc0xpc3RDb21tZW50OiBmYWxzZSwgc2Vzc2lvblRpbWVab25lOiBmYWxzZX0pXG4gIH1cblxuICAvKipcbiAgICogUnVucyBjbGVhciBjb25uZWN0aW9uIGNoZWNrb3V0IG5hbWUuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIHdoZW4gY29tcGxldGUuXG4gICAqL1xuICBhc3luYyBjbGVhckNvbm5lY3Rpb25DaGVja291dE5hbWUoKSB7XG4gICAgaWYgKHRoaXMuX2Nvbm5lY3Rpb25DaGVja291dE5hbWUgIT09IHVuZGVmaW5lZCkge1xuICAgICAgYXdhaXQgdGhpcy5xdWVyeShcIlNFVCBAdmVsb2Npb3VzX2Nvbm5lY3Rpb25fY2hlY2tvdXRfbmFtZSA9IE5VTExcIiwge2xvZ05hbWU6IFwiQ2xlYXIgQ29ubmVjdGlvbiBDaGVja291dCBOYW1lXCIsIHByb2Nlc3NMaXN0Q29tbWVudDogZmFsc2UsIHNlc3Npb25UaW1lWm9uZTogZmFsc2V9KVxuICAgIH1cblxuICAgIGF3YWl0IHN1cGVyLmNsZWFyQ29ubmVjdGlvbkNoZWNrb3V0TmFtZSgpXG4gIH1cblxuICAvKipcbiAgICogSG9vayBiZWZvcmUgZXZlcnkgcXVlcnkuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBfc3FsIC0gU1FMIHN0cmluZy5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9iYXNlLmpzXCIpLlF1ZXJ5T3B0aW9uc30gb3B0aW9ucyAtIFF1ZXJ5IG9wdGlvbnMuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIHdoZW4gY29tcGxldGUuXG4gICAqL1xuICBhc3luYyBiZWZvcmVRdWVyeShfc3FsLCBvcHRpb25zKSB7XG4gICAgaWYgKG9wdGlvbnMuc2Vzc2lvblRpbWVab25lICE9PSBmYWxzZSkgYXdhaXQgdGhpcy5lbnN1cmVTZXNzaW9uVGltZVpvbmUoKVxuICB9XG5cbiAgLyoqXG4gICAqIEdldHMgdGhlIGRlc2lyZWQgZGF0YWJhc2Ugc2Vzc2lvbiB0aW1lIHpvbmUgZm9yIHRoaXMgY29ubmVjdGlvbiBjb250ZXh0LlxuICAgKiBAcmV0dXJucyB7c3RyaW5nIHwgbnVsbH0gLSBEZXNpcmVkIHNlc3Npb24gdGltZSB6b25lLlxuICAgKi9cbiAgZ2V0RGVzaXJlZFNlc3Npb25UaW1lWm9uZSgpIHtcbiAgICByZXR1cm4gdGhpcy5fZGVzaXJlZFNlc3Npb25UaW1lWm9uZVxuICB9XG5cbiAgLyoqXG4gICAqIFNldHMgdGhlIGRlc2lyZWQgZGF0YWJhc2Ugc2Vzc2lvbiB0aW1lIHpvbmUgd2l0aG91dCBxdWVyeWluZyBNeVNRTCBpbW1lZGlhdGVseS5cbiAgICogQHBhcmFtIHtzdHJpbmcgfCBudWxsfSB0aW1lWm9uZSAtIERlc2lyZWQgc2Vzc2lvbiB0aW1lIHpvbmUuXG4gICAqL1xuICBzZXREZXNpcmVkU2Vzc2lvblRpbWVab25lKHRpbWVab25lKSB7XG4gICAgdGhpcy5fZGVzaXJlZFNlc3Npb25UaW1lWm9uZSA9IHRpbWVab25lXG4gIH1cblxuICAvKipcbiAgICogR2V0cyB0aGUgZGF0YWJhc2Ugc2Vzc2lvbiB0aW1lIHpvbmUgbGFzdCBjb25maXJtZWQgdGhyb3VnaCBTRVQgdGltZV96b25lLlxuICAgKiBAcmV0dXJucyB7c3RyaW5nIHwgbnVsbH0gLSBDdXJyZW50IGtub3duIHNlc3Npb24gdGltZSB6b25lLlxuICAgKi9cbiAgZ2V0Q3VycmVudFNlc3Npb25UaW1lWm9uZSgpIHtcbiAgICByZXR1cm4gdGhpcy5fY3VycmVudFNlc3Npb25UaW1lWm9uZVxuICB9XG5cbiAgLyoqXG4gICAqIENsZWFycyB0aGUgY3VycmVudCBrbm93biBkYXRhYmFzZSBzZXNzaW9uIHRpbWUgem9uZSB3aGVuIHRoZSBwaHlzaWNhbCBjb25uZWN0aW9uIGNoYW5nZXMuXG4gICAqL1xuICByZXNldEN1cnJlbnRTZXNzaW9uVGltZVpvbmUoKSB7XG4gICAgdGhpcy5fY3VycmVudFNlc3Npb25UaW1lWm9uZSA9IG51bGxcbiAgfVxuXG4gIC8qKlxuICAgKiBFbnN1cmVzIE15U1FMIGhhcyB0aGUgZGVzaXJlZCBzZXNzaW9uIHRpbWUgem9uZSBiZWZvcmUgdXNlciBTUUwgcnVucy5cbiAgICogQHJldHVybnMge1Byb21pc2U8Ym9vbGVhbj59IC0gVHJ1ZSB3aGVuIFNFVCB0aW1lX3pvbmUgd2FzIGV4ZWN1dGVkLlxuICAgKi9cbiAgYXN5bmMgZW5zdXJlU2Vzc2lvblRpbWVab25lKCkge1xuICAgIGNvbnN0IGRlc2lyZWRTZXNzaW9uVGltZVpvbmUgPSB0aGlzLmdldERlc2lyZWRTZXNzaW9uVGltZVpvbmUoKVxuXG4gICAgaWYgKGRlc2lyZWRTZXNzaW9uVGltZVpvbmUgPT09IG51bGwgfHwgdGhpcy5nZXRDdXJyZW50U2Vzc2lvblRpbWVab25lKCkgPT09IGRlc2lyZWRTZXNzaW9uVGltZVpvbmUpIHJldHVybiBmYWxzZVxuXG4gICAgYXdhaXQgdGhpcy5zZXRTZXNzaW9uVGltZVpvbmUoZGVzaXJlZFNlc3Npb25UaW1lWm9uZSlcblxuICAgIHJldHVybiB0cnVlXG4gIH1cblxuICAvKipcbiAgICogU2V0cyB0aGUgZGF0YWJhc2Ugc2Vzc2lvbiB0aW1lIHpvbmUgaWYgaXQgY2hhbmdlZCBmcm9tIHRoZSBsYXN0IGNvbmZpcm1lZCB2YWx1ZS5cbiAgICogQHBhcmFtIHtzdHJpbmd9IHRpbWVab25lIC0gU2Vzc2lvbiB0aW1lIHpvbmUgdmFsdWUgYWNjZXB0ZWQgYnkgTXlTUUwuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPGJvb2xlYW4+fSAtIFRydWUgd2hlbiBTRVQgdGltZV96b25lIHdhcyBleGVjdXRlZC5cbiAgICovXG4gIGFzeW5jIHNldFNlc3Npb25UaW1lWm9uZSh0aW1lWm9uZSkge1xuICAgIGlmICh0aGlzLmdldEN1cnJlbnRTZXNzaW9uVGltZVpvbmUoKSA9PT0gdGltZVpvbmUpIHJldHVybiBmYWxzZVxuXG4gICAgYXdhaXQgdGhpcy5fcXVlcnlBY3R1YWwoYFNFVCB0aW1lX3pvbmUgPSAke3RoaXMucXVvdGUodGltZVpvbmUpfWApXG4gICAgdGhpcy5fY3VycmVudFNlc3Npb25UaW1lWm9uZSA9IHRpbWVab25lXG5cbiAgICByZXR1cm4gdHJ1ZVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgY29ubmVjdCBhcmdzLlxuICAgKiBAcmV0dXJucyB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSAtIFRoZSBjb25uZWN0IGFyZ3MuXG4gICAqL1xuICBjb25uZWN0QXJncygpIHtcbiAgICBjb25zdCBhcmdzID0gdGhpcy5nZXRBcmdzKClcbiAgICBjb25zdCBmb3J3YXJkID0gW1wiZGF0YWJhc2VcIiwgXCJob3N0XCIsIFwicGFzc3dvcmRcIiwgXCJwb3J0XCJdXG5cbiAgICAvKipcbiAgICAgKiBDb25uZWN0IGFyZ3MuXG4gICAgICogQHR5cGUge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gKi9cbiAgICBjb25zdCBjb25uZWN0QXJncyA9IHtjaGFyc2V0OiBcInV0ZjhtYjRcIiwgdGltZXpvbmU6IFwiWlwifVxuXG4gICAgZm9yIChjb25zdCBmb3J3YXJkVmFsdWUgb2YgZm9yd2FyZCkge1xuICAgICAgaWYgKGZvcndhcmRWYWx1ZSBpbiBhcmdzKSBjb25uZWN0QXJnc1tmb3J3YXJkVmFsdWVdID0gZGlnZyhhcmdzLCBmb3J3YXJkVmFsdWUpXG4gICAgfVxuXG4gICAgaWYgKFwidXNlcm5hbWVcIiBpbiBhcmdzKSBjb25uZWN0QXJnc1tcInVzZXJcIl0gPSBhcmdzW1widXNlcm5hbWVcIl1cbiAgICBpZiAoXCJjaGFyc2V0XCIgaW4gYXJncykgY29ubmVjdEFyZ3NbXCJjaGFyc2V0XCJdID0gYXJnc1tcImNoYXJzZXRcIl1cbiAgICAvLyBPcHQtaW4gb25seS4gTGV0cyBhIHdob2xlIHN0cnVjdHVyZSBTUUwgZHVtcCBydW4gaW4gb25lIHJvdW5kLXRyaXAgdmlhXG4gICAgLy8ge0BsaW5rIGV4ZWNTdHJ1Y3R1cmVTY3JpcHR9OyBvZmYgYnkgZGVmYXVsdCBzbyBvcmRpbmFyeSBxdWVyaWVzIGtlZXAgcmVqZWN0aW5nXG4gICAgLy8gc3RhY2tlZCBzdGF0ZW1lbnRzLlxuICAgIGlmIChcIm11bHRpcGxlU3RhdGVtZW50c1wiIGluIGFyZ3MpIGNvbm5lY3RBcmdzW1wibXVsdGlwbGVTdGF0ZW1lbnRzXCJdID0gQm9vbGVhbihkaWdnKGFyZ3MsIFwibXVsdGlwbGVTdGF0ZW1lbnRzXCIpKVxuXG4gICAgcmV0dXJuIGNvbm5lY3RBcmdzXG4gIH1cblxuICAvKipcbiAgICogUnVucyBhbHRlciB0YWJsZSBzcWxzLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uLy4uL3RhYmxlLWRhdGEvaW5kZXguanNcIikuZGVmYXVsdH0gdGFibGVEYXRhIC0gVGFibGUgZGF0YS5cbiAgICogQHJldHVybnMge1Byb21pc2U8c3RyaW5nW10+fSAtIFJlc29sdmVzIHdpdGggU1FMIHN0YXRlbWVudHMuXG4gICAqL1xuICBhc3luYyBhbHRlclRhYmxlU1FMcyh0YWJsZURhdGEpIHtcbiAgICBjb25zdCBhbHRlckFyZ3MgPSB7dGFibGVEYXRhLCBkcml2ZXI6IHRoaXN9XG4gICAgY29uc3QgYWx0ZXJUYWJsZSA9IG5ldyBBbHRlclRhYmxlKGFsdGVyQXJncylcblxuICAgIHJldHVybiBhd2FpdCBhbHRlclRhYmxlLnRvU1FMcygpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBjcmVhdGUgZGF0YWJhc2Ugc3FsLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gZGF0YWJhc2VOYW1lIC0gRGF0YWJhc2UgbmFtZS5cbiAgICogQHBhcmFtIHtvYmplY3R9IFthcmdzXSAtIE9wdGlvbnMgb2JqZWN0LlxuICAgKiBAcGFyYW0ge2Jvb2xlYW59IFthcmdzLmlmTm90RXhpc3RzXSAtIFdoZXRoZXIgaWYgbm90IGV4aXN0cy5cbiAgICogQHJldHVybnMge3N0cmluZ1tdfSAtIFNRTCBzdGF0ZW1lbnRzLlxuICAgKi9cbiAgY3JlYXRlRGF0YWJhc2VTcWwoZGF0YWJhc2VOYW1lLCBhcmdzKSB7XG4gICAgY29uc3QgY3JlYXRlQXJncyA9IE9iamVjdC5hc3NpZ24oe2RhdGFiYXNlTmFtZSwgZHJpdmVyOiB0aGlzfSwgYXJncylcbiAgICBjb25zdCBjcmVhdGVEYXRhYmFzZSA9IG5ldyBDcmVhdGVEYXRhYmFzZShjcmVhdGVBcmdzKVxuXG4gICAgcmV0dXJuIGNyZWF0ZURhdGFiYXNlLnRvU3FsKClcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGRyb3AgZGF0YWJhc2Ugc3FsLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gZGF0YWJhc2VOYW1lIC0gRGF0YWJhc2UgbmFtZS5cbiAgICogQHBhcmFtIHtvYmplY3R9IFthcmdzXSAtIE9wdGlvbnMgb2JqZWN0LlxuICAgKiBAcGFyYW0ge2Jvb2xlYW59IFthcmdzLmlmRXhpc3RzXSAtIFdoZXRoZXIgaWYgZXhpc3RzLlxuICAgKiBAcmV0dXJucyB7c3RyaW5nW119IC0gU1FMIHN0YXRlbWVudHMuXG4gICAqL1xuICBkcm9wRGF0YWJhc2VTcWwoZGF0YWJhc2VOYW1lLCBhcmdzKSB7XG4gICAgY29uc3QgZHJvcEFyZ3MgPSBPYmplY3QuYXNzaWduKHtkYXRhYmFzZU5hbWUsIGRyaXZlcjogdGhpc30sIGFyZ3MpXG4gICAgY29uc3QgZHJvcERhdGFiYXNlID0gbmV3IERyb3BEYXRhYmFzZShkcm9wQXJncylcblxuICAgIHJldHVybiBkcm9wRGF0YWJhc2UudG9TcWwoKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgY3JlYXRlIGluZGV4IHNxbHMuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vYmFzZS5qc1wiKS5DcmVhdGVJbmRleFNxbEFyZ3N9IGluZGV4RGF0YSAtIEluZGV4IGRhdGEuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHN0cmluZ1tdPn0gLSBSZXNvbHZlcyB3aXRoIFNRTCBzdGF0ZW1lbnRzLlxuICAgKi9cbiAgYXN5bmMgY3JlYXRlSW5kZXhTUUxzKGluZGV4RGF0YSkge1xuICAgIGNvbnN0IGNyZWF0ZUFyZ3MgPSBPYmplY3QuYXNzaWduKHtkcml2ZXI6IHRoaXN9LCBpbmRleERhdGEpXG4gICAgY29uc3QgY3JlYXRlSW5kZXggPSBuZXcgQ3JlYXRlSW5kZXgoY3JlYXRlQXJncylcblxuICAgIHJldHVybiBhd2FpdCBjcmVhdGVJbmRleC50b1NRTHMoKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgcmVtb3ZlIGluZGV4IHNxbHMuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vYmFzZS5qc1wiKS5SZW1vdmVJbmRleFNxbEFyZ3N9IGluZGV4RGF0YSAtIEluZGV4IGRhdGEuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHN0cmluZ1tdPn0gLSBSZXNvbHZlcyB3aXRoIFNRTCBzdGF0ZW1lbnRzLlxuICAgKi9cbiAgYXN5bmMgcmVtb3ZlSW5kZXhTUUxzKGluZGV4RGF0YSkge1xuICAgIGNvbnN0IHJlbW92ZUFyZ3MgPSBPYmplY3QuYXNzaWduKHtkcml2ZXI6IHRoaXN9LCBpbmRleERhdGEpXG4gICAgY29uc3QgcmVtb3ZlSW5kZXggPSBuZXcgUmVtb3ZlSW5kZXgocmVtb3ZlQXJncylcblxuICAgIHJldHVybiBhd2FpdCByZW1vdmVJbmRleC50b1NRTHMoKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgY3JlYXRlIHRhYmxlIHNxbC5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi8uLi90YWJsZS1kYXRhL2luZGV4LmpzXCIpLmRlZmF1bHR9IHRhYmxlRGF0YSAtIFRhYmxlIGRhdGEuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHN0cmluZ1tdPn0gLSBSZXNvbHZlcyB3aXRoIFNRTCBzdGF0ZW1lbnRzLlxuICAgKi9cbiAgYXN5bmMgY3JlYXRlVGFibGVTcWwodGFibGVEYXRhKSB7XG4gICAgY29uc3QgY3JlYXRlQXJncyA9IHt0YWJsZURhdGEsIGRyaXZlcjogdGhpc31cbiAgICBjb25zdCBjcmVhdGVUYWJsZSA9IG5ldyBDcmVhdGVUYWJsZShjcmVhdGVBcmdzKVxuXG4gICAgcmV0dXJuIGNyZWF0ZVRhYmxlLnRvU3FsKClcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGN1cnJlbnQgZGF0YWJhc2UuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHN0cmluZz59IC0gUmVzb2x2ZXMgd2l0aCB0aGUgY3VycmVudCBkYXRhYmFzZS5cbiAgICovXG4gIGFzeW5jIGN1cnJlbnREYXRhYmFzZSgpIHtcbiAgICBjb25zdCByb3dzID0gYXdhaXQgdGhpcy5xdWVyeShcIlNFTEVDVCBEQVRBQkFTRSgpIEFTIGRiX25hbWVcIilcblxuICAgIHJldHVybiBkaWdnKHJvd3MsIDAsIFwiZGJfbmFtZVwiKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZGlzYWJsZSBmb3JlaWduIGtleXMuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIHdoZW4gY29tcGxldGUuXG4gICAqL1xuICBhc3luYyBkaXNhYmxlRm9yZWlnbktleXMoKSB7XG4gICAgYXdhaXQgdGhpcy5xdWVyeShcIlNFVCBGT1JFSUdOX0tFWV9DSEVDS1MgPSAwXCIpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBlbmFibGUgZm9yZWlnbiBrZXlzLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyB3aGVuIGNvbXBsZXRlLlxuICAgKi9cbiAgYXN5bmMgZW5hYmxlRm9yZWlnbktleXMoKSB7XG4gICAgYXdhaXQgdGhpcy5xdWVyeShcIlNFVCBGT1JFSUdOX0tFWV9DSEVDS1MgPSAxXCIpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBkcm9wIHRhYmxlIHNxbHMuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSB0YWJsZU5hbWUgLSBUYWJsZSBuYW1lLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL2Jhc2UuanNcIikuRHJvcFRhYmxlU3FsQXJnc1R5cGV9IFthcmdzXSAtIE9wdGlvbnMgb2JqZWN0LlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxzdHJpbmdbXT59IC0gUmVzb2x2ZXMgd2l0aCBTUUwgc3RhdGVtZW50cy5cbiAgICovXG4gIGFzeW5jIGRyb3BUYWJsZVNRTHModGFibGVOYW1lLCBhcmdzID0ge30pIHtcbiAgICBjb25zdCBkcm9wQXJncyA9IE9iamVjdC5hc3NpZ24oe3RhYmxlTmFtZSwgZHJpdmVyOiB0aGlzfSwgYXJncylcbiAgICBjb25zdCBkcm9wVGFibGUgPSBuZXcgRHJvcFRhYmxlKGRyb3BBcmdzKVxuXG4gICAgcmV0dXJuIGF3YWl0IGRyb3BUYWJsZS50b1NRTHMoKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZ2V0IHR5cGUuXG4gICAqIEByZXR1cm5zIHtzdHJpbmd9IC0gVGhlIHR5cGUuXG4gICAqL1xuICBnZXRUeXBlKCkgeyByZXR1cm4gXCJteXNxbFwiIH1cblxuICAvKipcbiAgICogV2hldGhlciB0aGlzIGRyaXZlciBzdXBwb3J0cyBjb21iaW5pbmcgb3BlcmF0aW9ucyBpbnRvIG9uZSBidWxrIGBBTFRFUmAuXG4gICAqIEByZXR1cm5zIHtib29sZWFufSAtIFdoZXRoZXIgYnVsayBhbHRlciBpcyBzdXBwb3J0ZWQuXG4gICAqL1xuICBzdXBwb3J0c0J1bGtBbHRlcigpIHsgcmV0dXJuIHRydWUgfVxuXG4gIC8qKlxuICAgKiBXaGV0aGVyIHRoZSBidWxrIGBBTFRFUmAgY2FuIGFsc28gY2FycnkgYEFERCBJTkRFWGAgY2xhdXNlcy5cbiAgICogQHJldHVybnMge2Jvb2xlYW59IC0gV2hldGhlciBpbmRleGVzIGNhbiBiZSBhZGRlZCBpbnNpZGUgYSBidWxrIGFsdGVyLlxuICAgKi9cbiAgc3VwcG9ydHNCdWxrQWx0ZXJJbmRleGVzKCkgeyByZXR1cm4gdHJ1ZSB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgcmV0cnlhYmxlIGRhdGFiYXNlIGVycm9yLlxuICAgKiBAcGFyYW0ge0Vycm9yfSBlcnJvciAtIEVycm9yIGluc3RhbmNlLlxuICAgKiBAcmV0dXJucyB7aW1wb3J0KFwiLi4vYmFzZS5qc1wiKS5SZXRyeWFibGVEYXRhYmFzZUVycm9yUmVzdWx0fSAtIFJldHJ5IGluZm8uXG4gICAqL1xuICByZXRyeWFibGVEYXRhYmFzZUVycm9yKGVycm9yKSB7XG4gICAgLyoqIEB0eXBlIHtFcnJvciB8IHVuZGVmaW5lZH0gKi9cbiAgICBsZXQgY3VycmVudEVycm9yID0gZXJyb3JcbiAgICBsZXQgc2hvdWxkUmVjb25uZWN0ID0gZmFsc2VcblxuICAgIHdoaWxlIChjdXJyZW50RXJyb3IpIHtcbiAgICAgIGNvbnN0IGVycm9yQ29kZSA9IFwiY29kZVwiIGluIGN1cnJlbnRFcnJvciAmJiB0eXBlb2YgY3VycmVudEVycm9yLmNvZGUgPT0gXCJzdHJpbmdcIiA/IGN1cnJlbnRFcnJvci5jb2RlIDogdW5kZWZpbmVkXG4gICAgICBjb25zdCBtZXNzYWdlID0gY3VycmVudEVycm9yLm1lc3NhZ2UgfHwgXCJcIlxuXG4gICAgICBpZiAoZXJyb3JDb2RlID09IFwiRVJfQ0hFQ0tSRUFEXCIgfHwgbWVzc2FnZS5pbmNsdWRlcyhcIlJlY29yZCBoYXMgY2hhbmdlZCBzaW5jZSBsYXN0IHJlYWRcIikpIHtcbiAgICAgICAgcmV0dXJuIHtyZXRyeTogdHJ1ZSwgcmVjb25uZWN0OiBmYWxzZSwgd2FpdE1zOiA1MH1cbiAgICAgIH1cblxuICAgICAgLy8gQSBkZWFkbG9jayBvciBsb2NrLXdhaXQtdGltZW91dCBhYm9ydHMgdGhlIHdob2xlIHRyYW5zYWN0aW9uOyBpdCBtdXN0IGJlIHJldHJpZWQgYXQgdGhlXG4gICAgICAvLyB0cmFuc2FjdGlvbiBsZXZlbCAocmUtcnVubmluZyB0aGUgY2FsbGJhY2spLCBub3QgdGhlIHF1ZXJ5IGxldmVsLCBzbyBmbGFnIGl0IGFzIHN1Y2ggYW5kXG4gICAgICAvLyBrZWVwIGByZXRyeWAgZmFsc2Ugc28gYW4gaW4tdHJhbnNhY3Rpb24gcXVlcnkgZG9lcyBub3QgcmV0cnkgYWdhaW5zdCB0aGUgZGVhZCB0cmFuc2FjdGlvbi5cbiAgICAgIGlmIChlcnJvckNvZGUgPT0gXCJFUl9MT0NLX0RFQURMT0NLXCIgfHwgbWVzc2FnZS5pbmNsdWRlcyhcIkVSX0xPQ0tfREVBRExPQ0tcIikgfHwgbWVzc2FnZS5pbmNsdWRlcyhcIkRlYWRsb2NrIGZvdW5kXCIpKSB7XG4gICAgICAgIHJldHVybiB7cmV0cnk6IGZhbHNlLCByZWNvbm5lY3Q6IGZhbHNlLCBkZWFkbG9jazogdHJ1ZSwgY29udGVudGlvbktpbmQ6IFwiZGVhZGxvY2tcIiwgd2FpdE1zOiA1MH1cbiAgICAgIH1cblxuICAgICAgaWYgKGVycm9yQ29kZSA9PSBcIkVSX0xPQ0tfV0FJVF9USU1FT1VUXCIgfHwgbWVzc2FnZS5pbmNsdWRlcyhcIkxvY2sgd2FpdCB0aW1lb3V0IGV4Y2VlZGVkXCIpKSB7XG4gICAgICAgIHJldHVybiB7cmV0cnk6IGZhbHNlLCByZWNvbm5lY3Q6IGZhbHNlLCBkZWFkbG9jazogdHJ1ZSwgY29udGVudGlvbktpbmQ6IFwibG9jay13YWl0LXRpbWVvdXRcIiwgd2FpdE1zOiA1MH1cbiAgICAgIH1cblxuICAgICAgc2hvdWxkUmVjb25uZWN0IHx8PSAoXG4gICAgICAgIGVycm9yQ29kZSA9PSBcIkVDT05OUkVGVVNFRFwiIHx8XG4gICAgICAgIG1lc3NhZ2UuaW5jbHVkZXMoXCJFQ09OTlJFRlVTRURcIikgfHxcbiAgICAgICAgbWVzc2FnZS5pbmNsdWRlcyhcImNvbm5lY3QgRUNPTk5SRUZVU0VEXCIpIHx8XG4gICAgICAgIG1lc3NhZ2UuaW5jbHVkZXMoXCJQUk9UT0NPTF9DT05ORUNUSU9OX0xPU1RcIikgfHxcbiAgICAgICAgbWVzc2FnZS5pbmNsdWRlcyhcIkNvbm5lY3Rpb24gbG9zdFwiKVxuICAgICAgKVxuXG4gICAgICBjdXJyZW50RXJyb3IgPSBjdXJyZW50RXJyb3IuY2F1c2UgaW5zdGFuY2VvZiBFcnJvciA/IGN1cnJlbnRFcnJvci5jYXVzZSA6IHVuZGVmaW5lZFxuICAgIH1cblxuICAgIHJldHVybiB7XG4gICAgICByZXRyeTogc2hvdWxkUmVjb25uZWN0LFxuICAgICAgcmVjb25uZWN0OiBzaG91bGRSZWNvbm5lY3QsXG4gICAgICB3YWl0TXM6IDUwXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIEFkZHMgYSByZWRhY3RlZCwgYm91bmRlZCBleGNlcnB0IGZyb20gTXlTUUwncyBsYXRlc3QgSW5ub0RCIGRlYWRsb2NrIHJlcG9ydC4gQ2FwdHVyZSB1c2VzIGFcbiAgICogc2VwYXJhdGUgc2hvcnQtbGl2ZWQgY29ubmVjdGlvbiBzbyBpdCBjYW5ub3QgcXVldWUgYWhlYWQgb2Ygcm9sbGJhY2sgb3IgdGhlIG5leHQgcmV0cnkgb24gdGhpc1xuICAgKiBkcml2ZXIncyBzaW5nbGUtY29ubmVjdGlvbiBwb29sLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL2Jhc2UuanNcIikuRGVhZGxvY2tSZXRyeURpYWdub3N0aWNTbmFwc2hvdH0gc25hcHNob3QgLSBJbW11dGFibGUgcmV0cnkgc25hcHNob3QuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPFJlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pj59IC0gU2FmZSBkaWFnbm9zdGljIGNvbnRleHQuXG4gICAqL1xuICBhc3luYyBfZGVhZGxvY2tEaWFnbm9zdGljQ29udGV4dChzbmFwc2hvdCkge1xuICAgIGlmIChzbmFwc2hvdC5jb250ZW50aW9uS2luZCA9PSBcImxvY2std2FpdC10aW1lb3V0XCIpIHJldHVybiB7c3RhdHVzQ2FwdHVyZTogXCJub3QtYXBwbGljYWJsZVwifVxuXG4gICAgbGV0IHN0YXR1c1xuXG4gICAgdHJ5IHtcbiAgICAgIHN0YXR1cyA9IGF3YWl0IHRoaXMuX2NhcHR1cmVJbm5vZGJEZWFkbG9ja1N0YXR1cygpXG4gICAgfSBjYXRjaCB7XG4gICAgICByZXR1cm4ge3N0YXR1c0NhcHR1cmU6IFwiZmFpbGVkXCJ9XG4gICAgfVxuXG4gICAgcmV0dXJuIHtcbiAgICAgIGlubm9kYkRlYWRsb2NrU3VtbWFyeTogdGhpcy5faW5ub2RiRGVhZGxvY2tTdW1tYXJ5KHN0YXR1cyksXG4gICAgICBzdGF0dXNDYXB0dXJlOiBcImNhcHR1cmVkXCJcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogQ2FwdHVyZXMgU0hPVyBFTkdJTkUgSU5OT0RCIFNUQVRVUyBvbiBhIGJvdW5kZWQgdGhyb3dhd2F5IGNvbm5lY3Rpb24uXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHN0cmluZz59IC0gUmF3IHNlcnZlciBzdGF0dXMsIHJldGFpbmVkIG9ubHkgaW5zaWRlIHRoZSByZWRhY3Rpb24gcGF0aC5cbiAgICovXG4gIGFzeW5jIF9jYXB0dXJlSW5ub2RiRGVhZGxvY2tTdGF0dXMoKSB7XG4gICAgY29uc3QgcG9vbFdpdGhDb25maWcgPSAvKiogQHR5cGUge3tjb25maWc/OiB7Y29ubmVjdGlvbkNvbmZpZz86IFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fX0gfCB1bmRlZmluZWR9ICovICh0aGlzLnBvb2wpXG4gICAgY29uc3QgY29ubmVjdGlvbkNvbmZpZyA9IHBvb2xXaXRoQ29uZmlnPy5jb25maWc/LmNvbm5lY3Rpb25Db25maWdcbiAgICBjb25zdCBjYXB0dXJlQ29uZmlnID0gY29ubmVjdGlvbkNvbmZpZyB8fCB0aGlzLmNvbm5lY3RBcmdzKClcblxuICAgIHJldHVybiBhd2FpdCBuZXcgUHJvbWlzZSgocmVzb2x2ZSwgcmVqZWN0KSA9PiB7XG4gICAgICAvKiogQHR5cGUge2ltcG9ydChcIm15c3FsXCIpLkNvbm5lY3Rpb24gfCB1bmRlZmluZWR9ICovXG4gICAgICBsZXQgY29ubmVjdGlvblxuICAgICAgbGV0IHNldHRsZWQgPSBmYWxzZVxuICAgICAgLyoqXG4gICAgICAgKiBGaW5pc2hlcyB0aGUgc3RhdHVzIGNhcHR1cmUgb25jZSBhbmQgZGVzdHJveXMgaXRzIHRlbXBvcmFyeSBjb25uZWN0aW9uLlxuICAgICAgICogQHBhcmFtIHtFcnJvciB8IHVuZGVmaW5lZH0gZXJyb3IgLSBDYXB0dXJlIGVycm9yLCB3aGVuIHByZXNlbnQuXG4gICAgICAgKiBAcGFyYW0ge3N0cmluZ30gW3N0YXR1c10gLSBDYXB0dXJlZCBzdGF0dXMuXG4gICAgICAgKiBAcmV0dXJucyB7dm9pZH1cbiAgICAgICAqL1xuICAgICAgY29uc3QgZmluaXNoID0gKGVycm9yLCBzdGF0dXMgPSBcIlwiKSA9PiB7XG4gICAgICAgIGlmIChzZXR0bGVkKSByZXR1cm5cbiAgICAgICAgc2V0dGxlZCA9IHRydWVcbiAgICAgICAgY2xlYXJUaW1lb3V0KHRpbWVvdXQpXG4gICAgICAgIGlmIChjb25uZWN0aW9uKSBjb25uZWN0aW9uLmRlc3Ryb3koKVxuICAgICAgICBpZiAoZXJyb3IpIHJlamVjdChlcnJvcilcbiAgICAgICAgZWxzZSByZXNvbHZlKHN0YXR1cylcbiAgICAgIH1cbiAgICAgIGNvbnN0IHRpbWVvdXQgPSBzZXRUaW1lb3V0KCgpID0+IGZpbmlzaChuZXcgRXJyb3IoXCJJbm5vREIgc3RhdHVzIGNhcHR1cmUgdGltZWQgb3V0XCIpKSwgSU5OT0RCX0RFQURMT0NLX0NBUFRVUkVfVElNRU9VVF9NUylcblxuICAgICAgdHJ5IHtcbiAgICAgICAgY29ubmVjdGlvbiA9IG15c3FsLmNyZWF0ZUNvbm5lY3Rpb24oY2FwdHVyZUNvbmZpZylcbiAgICAgICAgY29ubmVjdGlvbi5vbihcImVycm9yXCIsIChlcnJvcikgPT4gZmluaXNoKGVycm9yKSlcbiAgICAgICAgY29ubmVjdGlvbi5xdWVyeShcIlNIT1cgRU5HSU5FIElOTk9EQiBTVEFUVVNcIiwgKGVycm9yLCByb3dzKSA9PiB7XG4gICAgICAgICAgaWYgKGVycm9yKSB7XG4gICAgICAgICAgICBmaW5pc2goZXJyb3IpXG4gICAgICAgICAgICByZXR1cm5cbiAgICAgICAgICB9XG5cbiAgICAgICAgICBjb25zdCBmaXJzdFJvdyA9IEFycmF5LmlzQXJyYXkocm93cykgPyByb3dzWzBdIDogdW5kZWZpbmVkXG4gICAgICAgICAgY29uc3Qgc3RhdHVzID0gZmlyc3RSb3cgJiYgdHlwZW9mIGZpcnN0Um93LlN0YXR1cyA9PSBcInN0cmluZ1wiID8gZmlyc3RSb3cuU3RhdHVzIDogXCJcIlxuXG4gICAgICAgICAgZmluaXNoKHVuZGVmaW5lZCwgc3RhdHVzKVxuICAgICAgICB9KVxuICAgICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgICAgZmluaXNoKGVycm9yIGluc3RhbmNlb2YgRXJyb3IgPyBlcnJvciA6IG5ldyBFcnJvcihcIklubm9EQiBzdGF0dXMgY2FwdHVyZSBmYWlsZWRcIikpXG4gICAgICB9XG4gICAgfSlcbiAgfVxuXG4gIC8qKlxuICAgKiBFeHRyYWN0cyBvbmx5IGZpeGVkLWZvcm1hdCBkZWFkbG9jayBjb3VudGVycy4gVGhlIHNlcnZlciByZXBvcnQgY29udGFpbnMgcmF3IFNRTCwgaWRlbnRpZmllcnMsXG4gICAqIGFuZCBwaHlzaWNhbCByZWNvcmQgZGF0YSwgc28gbm8gc291cmNlIHRleHQgaXMgZXZlciBpbmNsdWRlZCBpbiBhbiBhcHBsaWNhdGlvbiBkaWFnbm9zdGljLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gc3RhdHVzIC0gU0hPVyBFTkdJTkUgSU5OT0RCIFNUQVRVUyB0ZXh0LlxuICAgKiBAcmV0dXJucyB7e2xvY2tSZWNvcmRzVHJ1bmNhdGVkOiBib29sZWFuLCBzZWN0aW9uVHJ1bmNhdGVkOiBib29sZWFuLCB0cmFuc2FjdGlvbk5vZGVzOiBBcnJheTx7Y29uZmxpY3RpbmdMb2NrczogQXJyYXk8e2luZGV4RmluZ2VycHJpbnQ6IHN0cmluZywgbG9ja01vZGU6IHN0cmluZywgc3RhdGU6IHN0cmluZywgdGFibGVGaW5nZXJwcmludDogc3RyaW5nfT4sIGxvY2tzOiBBcnJheTx7aW5kZXhGaW5nZXJwcmludDogc3RyaW5nLCBsb2NrTW9kZTogc3RyaW5nLCBzdGF0ZTogc3RyaW5nLCB0YWJsZUZpbmdlcnByaW50OiBzdHJpbmd9Piwgb3JkaW5hbDogbnVtYmVyfT4sIHRyYW5zYWN0aW9uTm9kZXNUcnVuY2F0ZWQ6IGJvb2xlYW4sIHRyYW5zYWN0aW9uczogbnVtYmVyLCB2aWN0aW1UcmFuc2FjdGlvbjogbnVtYmVyIHwgbnVsbH19IC0gU3RydWN0dXJhbCBkZWFkbG9jayBzdW1tYXJ5LlxuICAgKi9cbiAgX2lubm9kYkRlYWRsb2NrU3VtbWFyeShzdGF0dXMpIHtcbiAgICByZXR1cm4gcGFyc2VJbm5vZGJEZWFkbG9ja1N1bW1hcnkoc3RhdHVzKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgcXVlcnkgYWN0dWFsLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gc3FsIC0gU1FMIHN0cmluZy5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9iYXNlLmpzXCIpLlF1ZXJ5T3B0aW9uc30gW29wdGlvbnNdIC0gUXVlcnkgb3B0aW9ucyAoY2FycmllcyB0aGUgb3B0aW9uYWwgYWJvcnQgc2lnbmFsKS5cbiAgICogQHJldHVybnMge1Byb21pc2U8aW1wb3J0KFwiLi4vYmFzZS5qc1wiKS5RdWVyeVJlc3VsdFR5cGU+fSAtIFJlc29sdmVzIHdpdGggdGhlIHF1ZXJ5IGFjdHVhbC5cbiAgICovXG4gIGFzeW5jIF9xdWVyeUFjdHVhbChzcWwsIG9wdGlvbnMgPSB7fSkge1xuICAgIGlmICghdGhpcy5wb29sKSBhd2FpdCB0aGlzLmNvbm5lY3QoKVxuICAgIGlmICghdGhpcy5wb29sKSB0aHJvdyBuZXcgRXJyb3IoXCJNeVNRTCBwb29sIGZhaWxlZCB0byBpbml0aWFsaXplXCIpXG5cbiAgICB0cnkge1xuICAgICAgcmV0dXJuIGF3YWl0IHF1ZXJ5KHRoaXMucG9vbCwgc3FsLCB7c2lnbmFsOiBvcHRpb25zLnNpZ25hbH0pXG4gICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgIC8vIFByZXNlcnZlIGFuIGFib3J0IGFzLWlzIHNvIHRoZSByZXRyeSBsb29wIGNhbiByZWNvZ25pc2UgaXQgYXMgdGVybWluYWxcbiAgICAgIC8vICh3cmFwcGluZyBpdCBpbiBhIHBsYWluIEVycm9yIHdvdWxkIGxvc2UgdGhlIFF1ZXJ5QWJvcnRlZEVycm9yIHR5cGUpLlxuICAgICAgaWYgKGVycm9yIGluc3RhbmNlb2YgUXVlcnlBYm9ydGVkRXJyb3IpIHtcbiAgICAgICAgaWYgKGVycm9yLmNvbm5lY3Rpb25EZXN0cm95ZWQpIHRoaXMucmVzZXRDdXJyZW50U2Vzc2lvblRpbWVab25lKClcbiAgICAgICAgdGhyb3cgZXJyb3JcbiAgICAgIH1cblxuICAgICAgLy8gUmUtdGhyb3cgdG8gdW4tY29ycnVwdCBzdGFja3RyYWNlXG4gICAgICBpZiAoZXJyb3IgaW5zdGFuY2VvZiBFcnJvcikge1xuICAgICAgICB0aHJvdyBuZXcgRXJyb3IoYFF1ZXJ5IGZhaWxlZDogJHtlcnJvci5tZXNzYWdlfWAsIHtjYXVzZTogZXJyb3J9KVxuICAgICAgfSBlbHNlIHtcbiAgICAgICAgdGhyb3cgbmV3IEVycm9yKGBRdWVyeSBmYWlsZWQ6ICR7ZXJyb3J9YCwge2NhdXNlOiBlcnJvcn0pXG4gICAgICB9XG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIFN0cmVhbXMgdGhlIHJvd3Mgb2YgYHNxbGAgZnJvbSBhIGRlZGljYXRlZCBwb29sZWQgY29ubmVjdGlvbiB1c2luZyB0aGUgTXlTUUwgY3Vyc29yLCBzbyBhXG4gICAqIGxhcmdlIHJlc3VsdCBzZXQgaXMgcmVhZCBpbmNyZW1lbnRhbGx5IGluc3RlYWQgb2YgYmVpbmcgYnVmZmVyZWQuIE92ZXJyaWRlcyB0aGUgYmFzZVxuICAgKiBidWZmZXJlZCBmYWxsYmFjayB3aXRoIHRydWUgc2VydmVyLXNpZGUgc3RyZWFtaW5nLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gc3FsIC0gU1FMIHN0cmluZyB0byBzdHJlYW0uXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vYmFzZS5qc1wiKS5RdWVyeU9wdGlvbnN9IFtvcHRpb25zXSAtIFF1ZXJ5IG93bmVyc2hpcCBvcHRpb25zLlxuICAgKiBAeWllbGRzIHtSZWNvcmQ8c3RyaW5nLCB1bmtub3duPn0gLSBUaGUgcmVzdWx0IHJvd3MsIG9uZSBhdCBhIHRpbWUuXG4gICAqL1xuICBhc3luYyAqcXVlcnlTdHJlYW0oc3FsLCBvcHRpb25zID0ge30pIHtcbiAgICBhd2FpdCB0aGlzLl93YWl0Rm9yT3BlcmF0aW9uTGVhc2Uob3B0aW9ucy5vcGVyYXRpb25Pd25lcilcblxuICAgIGlmICghdGhpcy5wb29sKSBhd2FpdCB0aGlzLmNvbm5lY3QoKVxuICAgIGlmICghdGhpcy5wb29sKSB0aHJvdyBuZXcgRXJyb3IoXCJNeVNRTCBwb29sIGZhaWxlZCB0byBpbml0aWFsaXplXCIpXG5cbiAgICBjb25zdCBwcm9maWxlQXR0ZW1wdCA9IHRoaXMuX3N0YXJ0UHJvZmlsZWRRdWVyeUF0dGVtcHQoc3FsKVxuICAgIGxldCBmYWlsZWQgPSB0cnVlXG5cbiAgICB0cnkge1xuICAgICAgeWllbGQqIHN0cmVhbVF1ZXJ5KHRoaXMucG9vbCwgc3FsKVxuICAgICAgZmFpbGVkID0gZmFsc2VcbiAgICB9IGZpbmFsbHkge1xuICAgICAgdGhpcy5fZmluaXNoUHJvZmlsZWRRdWVyeUF0dGVtcHQocHJvZmlsZUF0dGVtcHQsIGZhaWxlZClcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogRXhlY3V0ZXMgYSBtdXRhdGlvbiB3aXRoIGFmZmVjdGVkLXJvdyBtZXRhZGF0YS5cbiAgICogQHBhcmFtIHtzdHJpbmd9IHNxbCAtIE11dGF0aW9uIFNRTC5cbiAgICogQHJldHVybnMge1Byb21pc2U8bnVtYmVyPn0gLSBBZmZlY3RlZCByb3cgY291bnQuXG4gICAqL1xuICBhc3luYyBfYWZmZWN0ZWRSb3dzQWN0dWFsKHNxbCkge1xuICAgIGlmICghdGhpcy5wb29sKSBhd2FpdCB0aGlzLmNvbm5lY3QoKVxuICAgIGlmICghdGhpcy5wb29sKSB0aHJvdyBuZXcgRXJyb3IoXCJNeVNRTCBwb29sIGZhaWxlZCB0byBpbml0aWFsaXplXCIpXG4gICAgY29uc3QgcG9vbCA9IHRoaXMucG9vbFxuXG4gICAgcmV0dXJuIGF3YWl0IG5ldyBQcm9taXNlKChyZXNvbHZlLCByZWplY3QpID0+IHtcbiAgICAgIHBvb2wucXVlcnkoc3FsLCAoZXJyb3IsIHJlc3VsdCkgPT4ge1xuICAgICAgICBpZiAoZXJyb3IpIHJlamVjdChlcnJvcilcbiAgICAgICAgZWxzZSByZXNvbHZlKFwiYWZmZWN0ZWRSb3dzXCIgaW4gcmVzdWx0ID8gcmVzdWx0LmFmZmVjdGVkUm93cyA6IDApXG4gICAgICB9KVxuICAgIH0pXG4gIH1cblxuICAvKipcbiAgICogRXhlY3V0ZXMgYSBmdWxsIG11bHRpLXN0YXRlbWVudCBzdHJ1Y3R1cmUgU1FMIHNjcmlwdCBpbiBvbmUgcm91bmQtdHJpcCB3aGVuIHRoZVxuICAgKiBjb25uZWN0aW9uIHdhcyBjb25maWd1cmVkIHdpdGggYG11bHRpcGxlU3RhdGVtZW50czogdHJ1ZWAuIFJ1bnMgb24gdGhlIHBvb2xlZFxuICAgKiBjb25uZWN0aW9uIHNvIHRoZSBjYWxsZXIncyBgU0VUIEZPUkVJR05fS0VZX0NIRUNLUyA9IDBgIGFwcGxpZXMuIFJldHVybnMgZmFsc2Ugc29cbiAgICogdGhlIGNhbGxlciBydW5zIHN0YXRlbWVudHMgaW5kaXZpZHVhbGx5IHdoZW4gbXVsdGktc3RhdGVtZW50IHF1ZXJpZXMgYXJlIG9mZi5cbiAgICogQHBhcmFtIHtzdHJpbmd9IHN0cnVjdHVyZVNxbCAtIEZ1bGwgbXVsdGktc3RhdGVtZW50IHN0cnVjdHVyZSBTUUwuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPGJvb2xlYW4+fSAtIFdoZXRoZXIgdGhlIHNjcmlwdCB3YXMgZXhlY3V0ZWQgYXMgb25lIGJhdGNoLlxuICAgKi9cbiAgYXN5bmMgZXhlY1N0cnVjdHVyZVNjcmlwdChzdHJ1Y3R1cmVTcWwpIHtcbiAgICBpZiAoIXRoaXMuZ2V0QXJncygpLm11bHRpcGxlU3RhdGVtZW50cykgcmV0dXJuIGZhbHNlXG5cbiAgICAvLyBUaGUgYmF0Y2hlZCBwb29sIGNhbGwgYmVsb3cgYnlwYXNzZXMgQmFzZSNxdWVyeSwgc28gcmUtcnVuIHRoZSBzYW1lIHJlYWQtb25seVxuICAgIC8vIHdyaXRlIGd1YXJkIHRoZSBwZXItc3RhdGVtZW50IHBhdGggYXBwbGllcyBiZWZvcmUgZXhlY3V0aW5nIHRoZSBkdW1wLlxuICAgIHRoaXMuX2Fzc2VydFdyaXRhYmxlUXVlcnkoc3RydWN0dXJlU3FsKVxuXG4gICAgaWYgKCF0aGlzLnBvb2wpIGF3YWl0IHRoaXMuY29ubmVjdCgpXG4gICAgaWYgKCF0aGlzLnBvb2wpIHRocm93IG5ldyBFcnJvcihcIk15U1FMIHBvb2wgZmFpbGVkIHRvIGluaXRpYWxpemVcIilcblxuICAgIGNvbnN0IHBvb2wgPSB0aGlzLnBvb2xcbiAgICBjb25zdCBwcm9maWxlQXR0ZW1wdCA9IHRoaXMuX3N0YXJ0UHJvZmlsZWRRdWVyeUF0dGVtcHQoc3RydWN0dXJlU3FsKVxuICAgIGxldCBmYWlsZWQgPSB0cnVlXG5cbiAgICB0cnkge1xuICAgICAgYXdhaXQgbmV3IFByb21pc2UoKHJlc29sdmUsIHJlamVjdCkgPT4ge1xuICAgICAgICBwb29sLnF1ZXJ5KHN0cnVjdHVyZVNxbCwgKGVycm9yKSA9PiB7XG4gICAgICAgICAgaWYgKGVycm9yKSByZWplY3QoZXJyb3IpXG4gICAgICAgICAgZWxzZSByZXNvbHZlKHVuZGVmaW5lZClcbiAgICAgICAgfSlcbiAgICAgIH0pXG4gICAgICBmYWlsZWQgPSBmYWxzZVxuICAgIH0gZmluYWxseSB7XG4gICAgICB0aGlzLl9maW5pc2hQcm9maWxlZFF1ZXJ5QXR0ZW1wdChwcm9maWxlQXR0ZW1wdCwgZmFpbGVkKVxuICAgIH1cblxuICAgIHJldHVybiB0cnVlXG4gIH1cblxuICAvKipcbiAgICogVXNlcyBvbmUgbXVsdGktc3RhdGVtZW50IHJlcXVlc3Qgb25seSB3aGVuIHRoZSBleGlzdGluZyBjb25uZWN0aW9uIG9wdGlvblxuICAgKiBleHBsaWNpdGx5IGFsbG93cyBpdDsgb3RoZXJ3aXNlIHJldGFpbnMgdGhlIGJhc2Ugc2VxdWVudGlhbCBiZWhhdmlvci5cbiAgICogQHBhcmFtIHtBcnJheTxpbXBvcnQoXCIuLi9iYXNlLXRhYmxlLmpzXCIpLmRlZmF1bHQ+fSB0YWJsZXMgLSBFbGlnaWJsZSB0YWJsZXMuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIHdoZW4gZXZlcnkgdGFibGUgaGFzIGJlZW4gdHJ1bmNhdGVkLlxuICAgKi9cbiAgYXN5bmMgdHJ1bmNhdGVUYWJsZXModGFibGVzKSB7XG4gICAgaWYgKCF0aGlzLmdldEFyZ3MoKS5tdWx0aXBsZVN0YXRlbWVudHMpIHtcbiAgICAgIGF3YWl0IHN1cGVyLnRydW5jYXRlVGFibGVzKHRhYmxlcylcbiAgICAgIHJldHVyblxuICAgIH1cblxuICAgIGNvbnN0IHN0YXRlbWVudHMgPSB0YWJsZXMubWFwKCh0YWJsZSkgPT4gYFRSVU5DQVRFIFRBQkxFICR7dGhpcy5xdW90ZVRhYmxlKHRhYmxlLmdldE5hbWUoKSl9YClcblxuICAgIGF3YWl0IHRoaXMucXVlcnkoc3RhdGVtZW50cy5qb2luKFwiO1xcblwiKSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHF1ZXJ5IHRvIHNxbC5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi8uLi9xdWVyeS9pbmRleC5qc1wiKS5kZWZhdWx0fSBxdWVyeSAtIFF1ZXJ5IGluc3RhbmNlLlxuICAgKiBAcmV0dXJucyB7c3RyaW5nfSAtIFNRTCBzdHJpbmcuXG4gICAqL1xuICBxdWVyeVRvU3FsKHF1ZXJ5KSB7IHJldHVybiBuZXcgUXVlcnlQYXJzZXIoe3F1ZXJ5fSkudG9TcWwoKSB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgc2hvdWxkIHNldCBhdXRvIGluY3JlbWVudCB3aGVuIHByaW1hcnkga2V5LlxuICAgKiBAcmV0dXJucyB7Ym9vbGVhbn0gLSBXaGV0aGVyIHNldCBhdXRvIGluY3JlbWVudCB3aGVuIHByaW1hcnkga2V5LlxuICAgKi9cbiAgc2hvdWxkU2V0QXV0b0luY3JlbWVudFdoZW5QcmltYXJ5S2V5KCkgeyByZXR1cm4gdHJ1ZSB9XG4gIHN1cHBvcnRzRGVmYXVsdFByaW1hcnlLZXlVVUlEKCkgeyByZXR1cm4gZmFsc2UgfVxuICBzdXBwb3J0c0Nyb3NzRGF0YWJhc2VSZWZlcmVuY2VzKCkgeyByZXR1cm4gdHJ1ZSB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZXNjYXBlLlxuICAgKiBAcGFyYW0ge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSB2YWx1ZSAtIFZhbHVlIHRvIHVzZS5cbiAgICogQHJldHVybnMge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSAtIFRoZSBlc2NhcGUuXG4gICAqL1xuICBlc2NhcGUodmFsdWUpIHtcbiAgICBjb25zdCBlc2NhcGVkVmFsdWVXaXRoUXVvdGVzID0gdGhpcy5wb29sXG4gICAgICA/IHRoaXMucG9vbC5lc2NhcGUodGhpcy5fY29udmVydFZhbHVlKHZhbHVlKSlcbiAgICAgIDogbXlzcWwuZXNjYXBlKHRoaXMuX2NvbnZlcnRWYWx1ZSh2YWx1ZSkpXG5cbiAgICByZXR1cm4gZXNjYXBlZFZhbHVlV2l0aFF1b3Rlcy5zbGljZSgxLCBlc2NhcGVkVmFsdWVXaXRoUXVvdGVzLmxlbmd0aCAtIDEpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBxdW90ZS5cbiAgICogQHBhcmFtIHtzdHJpbmd9IHZhbHVlIC0gVmFsdWUgdG8gdXNlLlxuICAgKiBAcmV0dXJucyB7c3RyaW5nfSAtIFRoZSBxdW90ZS5cbiAgICovXG4gIHF1b3RlKHZhbHVlKSB7XG4gICAgaWYgKHRoaXMucG9vbCkge1xuICAgICAgcmV0dXJuIHRoaXMucG9vbC5lc2NhcGUodGhpcy5fY29udmVydFZhbHVlKHZhbHVlKSlcbiAgICB9XG5cbiAgICByZXR1cm4gbXlzcWwuZXNjYXBlKHRoaXMuX2NvbnZlcnRWYWx1ZSh2YWx1ZSkpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBkZWxldGUgc3FsLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL2Jhc2UuanNcIikuRGVsZXRlU3FsQXJnc1R5cGV9IGFyZ3MgLSBPcHRpb25zIG9iamVjdC5cbiAgICogQHJldHVybnMge3N0cmluZ30gLSBTUUwgc3RyaW5nLlxuICAgKi9cbiAgZGVsZXRlU3FsKHt0YWJsZU5hbWUsIGNvbmRpdGlvbnN9KSB7XG4gICAgY29uc3QgZGVsZXRlSW5zdHJ1Y3Rpb24gPSBuZXcgRGVsZXRlKHtjb25kaXRpb25zLCBkcml2ZXI6IHRoaXMsIHRhYmxlTmFtZX0pXG5cbiAgICByZXR1cm4gZGVsZXRlSW5zdHJ1Y3Rpb24udG9TcWwoKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgaW5zZXJ0IHNxbC5cbiAgICogQGFic3RyYWN0XG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vYmFzZS5qc1wiKS5JbnNlcnRTcWxBcmdzVHlwZX0gYXJncyAtIE9wdGlvbnMgb2JqZWN0LlxuICAgKiBAcmV0dXJucyB7c3RyaW5nfSAtIFNRTCBzdHJpbmcuXG4gICAqL1xuICBpbnNlcnRTcWwoYXJncykge1xuICAgIGNvbnN0IGluc2VydEFyZ3MgPSBPYmplY3QuYXNzaWduKHtkcml2ZXI6IHRoaXN9LCBhcmdzKVxuICAgIGNvbnN0IGluc2VydCA9IG5ldyBJbnNlcnQoaW5zZXJ0QXJncylcblxuICAgIHJldHVybiBpbnNlcnQudG9TcWwoKVxuICB9XG5cbiAgLyoqXG4gICAqIE1hcmlhREIgc2tpcHMgaW5mb3JtYXRpb24tc2NoZW1hL1NIT1cgcmVhZHMgZm9yIGEgdGFibGUgd2hvc2UgZGVmaW5pdGlvbiBpcyBiZWluZyBtb2RpZmllZFxuICAgKiBieSBjb25jdXJyZW50IG9ubGluZSBEREwgKEVSX1dBUk5fSV9TX1NLSVBQRURfVEFCTEUpLiBUaGUgYnVpbGQgY29tcGxldGVzIGluIHNlY29uZHMsIHNvIHRoZVxuICAgKiBza2lwIGlzIHRyYW5zaWVudCBjb250ZW50aW9uIHRoYXQgdGhlIGJvdW5kZWQgc2NoZW1hLW1ldGFkYXRhIHJldHJ5IGNhbiBvdXRsYXN0LiBRdWVyeVxuICAgKiBoZWxwZXJzIHdyYXAgdGhlIGRyaXZlciBlcnJvciwgc28gdGhlIGNvZGUgaXMgc2VhcmNoZWQgdGhyb3VnaCB0aGUgY2F1c2UgY2hhaW4uXG4gICAqIEBwYXJhbSB7dW5rbm93bn0gZXJyb3IgLSBFcnJvciByYWlzZWQgYnkgYSBzY2hlbWEtbWV0YWRhdGEgcmVhZC5cbiAgICogQHJldHVybnMge2Jvb2xlYW59IC0gV2hldGhlciB0aGUgcmVhZCBoaXQgY29uY3VycmVudC1EREwgbWV0YWRhdGEgY29udGVudGlvbi5cbiAgICovXG4gIF9pc1RyYW5zaWVudFNjaGVtYU1ldGFkYXRhRXJyb3IoZXJyb3IpIHtcbiAgICBsZXQgY3VycmVudEVycm9yID0gLyoqIEB0eXBlIHt7Y29kZT86IHN0cmluZywgY2F1c2U/OiB1bmtub3dufSB8IHVuZGVmaW5lZH0gKi8gKFxuICAgICAgLyoqIEB0eXBlIHt1bmtub3dufSAqLyAoZXJyb3IpXG4gICAgKVxuXG4gICAgZm9yIChsZXQgZGVwdGggPSAwOyBkZXB0aCA8IDUgJiYgY3VycmVudEVycm9yOyBkZXB0aCsrKSB7XG4gICAgICBpZiAoY3VycmVudEVycm9yLmNvZGUgPT09IFwiRVJfV0FSTl9JX1NfU0tJUFBFRF9UQUJMRVwiKSByZXR1cm4gdHJ1ZVxuICAgICAgY3VycmVudEVycm9yID0gLyoqIEB0eXBlIHt7Y29kZT86IHN0cmluZywgY2F1c2U/OiB1bmtub3dufSB8IHVuZGVmaW5lZH0gKi8gKFxuICAgICAgICAvKiogQHR5cGUge3Vua25vd259ICovIChjdXJyZW50RXJyb3IuY2F1c2UpXG4gICAgICApXG4gICAgfVxuXG4gICAgcmV0dXJuIGZhbHNlXG4gIH1cblxuICAvKipcbiAgICogUnVucyBnZXQgdGFibGVzLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxBcnJheTxpbXBvcnQoXCIuLi9iYXNlLXRhYmxlLmpzXCIpLmRlZmF1bHQ+Pn0gLSBSZXNvbHZlcyB3aXRoIHRoZSB0YWJsZXMuXG4gICAqL1xuICBhc3luYyBnZXRUYWJsZXMoKSB7XG4gICAgcmV0dXJuIGF3YWl0IHRoaXMuX2NhY2hlZFNjaGVtYU1ldGFkYXRhKFwidGFibGVzXCIsIGFzeW5jICgpID0+IHtcbiAgICAgIGNvbnN0IHJlc3VsdCA9IGF3YWl0IHRoaXMucXVlcnkoXCJTSE9XIEZVTEwgVEFCTEVTXCIpXG4gICAgICBjb25zdCB0YWJsZXMgPSBbXVxuXG4gICAgICBmb3IgKGNvbnN0IHJvdyBvZiByZXN1bHQpIHtcbiAgICAgICAgY29uc3QgdGFibGUgPSBuZXcgVGFibGUodGhpcywgLyoqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBzdHJpbmc+fSAqLyAocm93KSlcblxuICAgICAgICB0YWJsZXMucHVzaCh0YWJsZSlcbiAgICAgIH1cblxuICAgICAgcmV0dXJuIHRhYmxlc1xuICAgIH0pXG4gIH1cblxuICAvKipcbiAgICogUnVucyBzdHJ1Y3R1cmUgc3FsLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxzdHJpbmcgfCBudWxsPn0gLSBSZXNvbHZlcyB3aXRoIFNRTCBzdHJpbmcuXG4gICAqL1xuICBhc3luYyBzdHJ1Y3R1cmVTcWwoKSB7XG4gICAgcmV0dXJuIGF3YWl0IHRoaXMuX2NhY2hlZFNjaGVtYU1ldGFkYXRhKFwic3RydWN0dXJlU3FsXCIsIGFzeW5jICgpID0+IGF3YWl0IG5ldyBTdHJ1Y3R1cmVTcWwoe2RyaXZlcjogdGhpc30pLnRvU3FsKCkpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBsYXN0IGluc2VydCBpZC5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9iYXNlLmpzXCIpLlF1ZXJ5T3B0aW9uc30gW29wdGlvbnNdIC0gUXVlcnkgb3duZXJzaGlwIG9wdGlvbnMuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPG51bWJlcj59IC0gUmVzb2x2ZXMgd2l0aCB0aGUgbGFzdCBpbnNlcnQgaWQuXG4gICAqL1xuICBhc3luYyBsYXN0SW5zZXJ0SUQob3B0aW9ucyA9IHt9KSB7XG4gICAgY29uc3QgcmVzdWx0ID0gYXdhaXQgdGhpcy5xdWVyeShcIlNFTEVDVCBMQVNUX0lOU0VSVF9JRCgpIEFTIGxhc3RfaW5zZXJ0X2lkXCIsIG9wdGlvbnMpXG5cbiAgICByZXR1cm4gZGlnZyhyZXN1bHQsIDAsIFwibGFzdF9pbnNlcnRfaWRcIilcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIG9wdGlvbnMuXG4gICAqIEByZXR1cm5zIHtPcHRpb25zfSAtIFRoZSBvcHRpb25zIG9wdGlvbnMuXG4gICAqL1xuICBvcHRpb25zKCkge1xuICAgIGlmICghdGhpcy5fb3B0aW9ucykgdGhpcy5fb3B0aW9ucyA9IG5ldyBPcHRpb25zKHtkcml2ZXI6IHRoaXN9KVxuXG4gICAgcmV0dXJuIHRoaXMuX29wdGlvbnNcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHN0YXJ0IHRyYW5zYWN0aW9uIGFjdGlvbi5cbiAgICogQHBhcmFtIHtQaWNrPGltcG9ydChcIi4uL2Jhc2UuanNcIikuUXVlcnlPcHRpb25zLCBcIm9wZXJhdGlvbk93bmVyXCI+fSBbb3B0aW9uc10gLSBUcmFuc2FjdGlvbiBvd25lcnNoaXAuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIHdoZW4gY29tcGxldGUuXG4gICAqL1xuICBhc3luYyBfc3RhcnRUcmFuc2FjdGlvbkFjdGlvbihvcHRpb25zID0ge30pIHtcbiAgICBhd2FpdCB0aGlzLnF1ZXJ5KFwiU1RBUlQgVFJBTlNBQ1RJT05cIiwgb3B0aW9ucylcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHVwZGF0ZSBzcWwuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vYmFzZS5qc1wiKS5VcGRhdGVTcWxBcmdzVHlwZX0gYXJncyAtIE9wdGlvbnMgb2JqZWN0LlxuICAgKiBAcmV0dXJucyB7c3RyaW5nfSAtIFNRTCBzdHJpbmcuXG4gICAqL1xuICB1cGRhdGVTcWwoe2NvbmRpdGlvbnMsIGRhdGEsIHRhYmxlTmFtZX0pIHtcbiAgICBjb25zdCB1cGRhdGUgPSBuZXcgVXBkYXRlKHtjb25kaXRpb25zLCBkYXRhLCBkcml2ZXI6IHRoaXMsIHRhYmxlTmFtZX0pXG5cbiAgICByZXR1cm4gdXBkYXRlLnRvU3FsKClcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHVwc2VydCBzcWwuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vYmFzZS5qc1wiKS5VcHNlcnRTcWxBcmdzVHlwZX0gYXJncyAtIE9wdGlvbnMgb2JqZWN0LlxuICAgKiBAcmV0dXJucyB7c3RyaW5nfSAtIFNRTCBzdHJpbmcuXG4gICAqL1xuICB1cHNlcnRTcWwoYXJncykge1xuICAgIGNvbnN0IHVwc2VydCA9IG5ldyBVcHNlcnQoey4uLmFyZ3MsIGRyaXZlcjogdGhpc30pXG5cbiAgICByZXR1cm4gdXBzZXJ0LnRvU3FsKClcbiAgfVxuXG4gIC8qKlxuICAgKiBCbG9ja3MgdW50aWwgYSBNeVNRTC9NYXJpYURCIHVzZXItbGV2ZWwgbG9jayBpcyBhY3F1aXJlZCBvbiB0aGlzXG4gICAqIGNvbm5lY3Rpb24uIEltcGxlbWVudGVkIHZpYSBgR0VUX0xPQ0sobmFtZSwgdGltZW91dClgLCB3aGVyZSB0aGVcbiAgICogdGltZW91dCBpcyBpbiBzZWNvbmRzLlxuICAgKlxuICAgKiBNeVNRTCBoaXN0b3JpY2FsbHkgZG9jdW1lbnRlZCBhIG5lZ2F0aXZlIHRpbWVvdXQgYXMgXCJpbmZpbml0ZVwiLFxuICAgKiBidXQgTWFyaWFEQiAxMCsgc2lsZW50bHkgcmVqZWN0cyBuZWdhdGl2ZSB0aW1lb3V0cyBhbmQgcmV0dXJuc1xuICAgKiBgTlVMTGAgZnJvbSBgR0VUX0xPQ0tgLiBUbyBtYWtlIHRoZSBoZWxwZXIgcG9ydGFibGUgYWNyb3NzIE15U1FMXG4gICAqIGFuZCBNYXJpYURCIHRoZSBcImluZGVmaW5pdGVcIiBjYXNlIGlzIGVuY29kZWQgYXMgYSBsYXJnZSBwb3NpdGl2ZVxuICAgKiB0aW1lb3V0IChvbmUgeWVhciksIHdoaWNoIGlzIGNvbWZvcnRhYmx5IGxvbmdlciB0aGFuIGFueVxuICAgKiByZWFsaXN0aWMgY3JpdGljYWwgc2VjdGlvbiBhbmQgd29ya3Mgb24gZXZlcnkgc3VwcG9ydGVkIHZlcnNpb24uXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBuYW1lIC0gTG9jayBuYW1lLlxuICAgKiBAcGFyYW0ge3t0aW1lb3V0TXM/OiBudW1iZXIgfCBudWxsfX0gW2FyZ3NdIC0gT3B0aW9uYWwgdGltZW91dCBpbiBtaWxsaXNlY29uZHM7IGBudWxsYCwgYHVuZGVmaW5lZGAsIG9yIG5lZ2F0aXZlIGJsb2NrcyBmb3IgYE1ZU1FMX0lOREVGSU5JVEVfTE9DS19USU1FT1VUX1NFQ09ORFNgLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxib29sZWFuPn0gLSBUcnVlIGlmIGFjcXVpcmVkLCBmYWxzZSBpZiB0aGUgdGltZW91dCBlbGFwc2VkLlxuICAgKi9cbiAgYXN5bmMgX2FjcXVpcmVBZHZpc29yeUxvY2sobmFtZSwge3RpbWVvdXRNc30gPSB7fSkge1xuICAgIGNvbnN0IHRpbWVvdXRTZWNvbmRzID0gdHlwZW9mIHRpbWVvdXRNcyA9PT0gXCJudW1iZXJcIiAmJiB0aW1lb3V0TXMgPj0gMFxuICAgICAgPyBNYXRoLmNlaWwodGltZW91dE1zIC8gMTAwMClcbiAgICAgIDogTVlTUUxfSU5ERUZJTklURV9MT0NLX1RJTUVPVVRfU0VDT05EU1xuICAgIGNvbnN0IHJvd3MgPSBhd2FpdCB0aGlzLnF1ZXJ5KGBTRUxFQ1QgR0VUX0xPQ0soJHt0aGlzLnF1b3RlKG5hbWUpfSwgJHt0aW1lb3V0U2Vjb25kc30pIEFTIHZlbG9jaW91c19hZHZpc29yeV9sb2NrX3Jlc3VsdGApXG4gICAgY29uc3QgcmVzdWx0ID0gcm93cz8uWzBdPy52ZWxvY2lvdXNfYWR2aXNvcnlfbG9ja19yZXN1bHRcblxuICAgIGlmIChyZXN1bHQgPT09IG51bGwgfHwgcmVzdWx0ID09PSB1bmRlZmluZWQpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihgR0VUX0xPQ0sgcmV0dXJuZWQgTlVMTCBmb3IgYWR2aXNvcnkgbG9jayAke0pTT04uc3RyaW5naWZ5KG5hbWUpfSAodHlwaWNhbGx5IGFuIG91dC1vZi1tZW1vcnkgb3IgdGhyZWFkLWtpbGxlZCBjb25kaXRpb24pYClcbiAgICB9XG5cbiAgICByZXR1cm4gTnVtYmVyKHJlc3VsdCkgPT09IDFcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHRyeSBhY3F1aXJlIGFkdmlzb3J5IGxvY2suXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBuYW1lIC0gTG9jayBuYW1lLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxib29sZWFuPn0gLSBUcnVlIGlmIHRoZSBsb2NrIHdhcyBhY3F1aXJlZCwgZmFsc2UgaWYgaXQgd2FzIGFscmVhZHkgaGVsZC5cbiAgICovXG4gIGFzeW5jIF90cnlBY3F1aXJlQWR2aXNvcnlMb2NrKG5hbWUpIHtcbiAgICBjb25zdCByb3dzID0gYXdhaXQgdGhpcy5xdWVyeShgU0VMRUNUIEdFVF9MT0NLKCR7dGhpcy5xdW90ZShuYW1lKX0sIDApIEFTIHZlbG9jaW91c19hZHZpc29yeV9sb2NrX3Jlc3VsdGApXG4gICAgY29uc3QgcmVzdWx0ID0gcm93cz8uWzBdPy52ZWxvY2lvdXNfYWR2aXNvcnlfbG9ja19yZXN1bHRcblxuICAgIGlmIChyZXN1bHQgPT09IG51bGwgfHwgcmVzdWx0ID09PSB1bmRlZmluZWQpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihgR0VUX0xPQ0sgcmV0dXJuZWQgTlVMTCBmb3IgYWR2aXNvcnkgbG9jayAke0pTT04uc3RyaW5naWZ5KG5hbWUpfSAodHlwaWNhbGx5IGFuIG91dC1vZi1tZW1vcnkgb3IgdGhyZWFkLWtpbGxlZCBjb25kaXRpb24pYClcbiAgICB9XG5cbiAgICByZXR1cm4gTnVtYmVyKHJlc3VsdCkgPT09IDFcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHJlbGVhc2UgYWR2aXNvcnkgbG9jay5cbiAgICogQHBhcmFtIHtzdHJpbmd9IG5hbWUgLSBMb2NrIG5hbWUuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPGJvb2xlYW4+fSAtIFRydWUgaWYgdGhlIGxvY2sgd2FzIGhlbGQgYnkgdGhpcyBzZXNzaW9uIGFuZCBoYXMgbm93IGJlZW4gcmVsZWFzZWQuXG4gICAqL1xuICBhc3luYyBfcmVsZWFzZUFkdmlzb3J5TG9jayhuYW1lKSB7XG4gICAgY29uc3Qgcm93cyA9IGF3YWl0IHRoaXMucXVlcnkoYFNFTEVDVCBSRUxFQVNFX0xPQ0soJHt0aGlzLnF1b3RlKG5hbWUpfSkgQVMgdmVsb2Npb3VzX2Fkdmlzb3J5X2xvY2tfcmVzdWx0YCwge3JldHJ5OiBmYWxzZX0pXG4gICAgY29uc3QgcmVzdWx0ID0gcm93cz8uWzBdPy52ZWxvY2lvdXNfYWR2aXNvcnlfbG9ja19yZXN1bHRcblxuICAgIHJldHVybiBOdW1iZXIocmVzdWx0KSA9PT0gMVxuICB9XG5cbiAgLyoqXG4gIC8qKlxuICAgKiBBdHRyaWJ1dGVzIHRoZSBjdXJyZW50IGhvbGRlciBvZiB0aGUgbmFtZWQgbG9jayB0byBpdHMgcGh5c2ljYWwgc2Vzc2lvblxuICAgKiBjb25uZWN0aW9uIGlkIHZpYSBgSVNfVVNFRF9MT0NLKG5hbWUpYCwgY2FwdHVyZWQgYXQgdGhlIHRlbGVtZXRyeSBldmVudFxuICAgKiBtb21lbnQgKGJlc3QtZWZmb3J0OyB0aGUgY2FsbGVyIGd1YXJkcyBmYWlsdXJlcykuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBuYW1lIC0gTG9jayBuYW1lLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxzdHJpbmcgfCBudWxsPn0gLSBNYXJpYURCL015U1FMIGNvbm5lY3Rpb24gaWQgb2YgdGhlIGhvbGRlciwgb3IgbnVsbCB3aGVuIG5vIHNlc3Npb24gaG9sZHMgdGhlIGxvY2suXG4gICAqL1xuICBhc3luYyBhZHZpc29yeUxvY2tIb2xkZXJDb25uZWN0aW9uSWQobmFtZSkge1xuICAgIGNvbnN0IHJvd3MgPSBhd2FpdCB0aGlzLnF1ZXJ5KGBTRUxFQ1QgSVNfVVNFRF9MT0NLKCR7dGhpcy5xdW90ZShuYW1lKX0pIEFTIHZlbG9jaW91c19hZHZpc29yeV9sb2NrX2hvbGRlcmApXG4gICAgY29uc3QgaG9sZGVyID0gcm93cz8uWzBdPy52ZWxvY2lvdXNfYWR2aXNvcnlfbG9ja19ob2xkZXJcblxuICAgIHJldHVybiBob2xkZXIgPT09IG51bGwgfHwgaG9sZGVyID09PSB1bmRlZmluZWQgPyBudWxsIDogU3RyaW5nKGhvbGRlcilcbiAgfVxuXG4gIC8qKlxuICAgKiBEcml2ZXItbmF0aXZlIHZpZXcgZm9yIHRoZSBiYXNlIGRyaXZlcidzIGBpc0Fkdmlzb3J5TG9ja0hlbGRgLCB3aGljaFxuICAgKiBhbnN3ZXJzIGZyb20gdGhlIHByb2Nlc3MtbG9jYWwgdGllciBmaXJzdC5cbiAgICogQHBhcmFtIHtzdHJpbmd9IG5hbWUgLSBMb2NrIG5hbWUuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPGJvb2xlYW4+fSAtIFRydWUgaWYgYW55IHNlc3Npb24gY3VycmVudGx5IGhvbGRzIHRoZSBsb2NrLlxuICAgKi9cbiAgYXN5bmMgX2lzQWR2aXNvcnlMb2NrSGVsZE5hdGl2ZShuYW1lKSB7XG4gICAgY29uc3Qgcm93cyA9IGF3YWl0IHRoaXMucXVlcnkoYFNFTEVDVCBJU19VU0VEX0xPQ0soJHt0aGlzLnF1b3RlKG5hbWUpfSkgQVMgdmVsb2Npb3VzX2Fkdmlzb3J5X2xvY2tfaG9sZGVyYClcbiAgICBjb25zdCBob2xkZXIgPSByb3dzPy5bMF0/LnZlbG9jaW91c19hZHZpc29yeV9sb2NrX2hvbGRlclxuXG4gICAgcmV0dXJuIGhvbGRlciAhPT0gbnVsbCAmJiBob2xkZXIgIT09IHVuZGVmaW5lZFxuICB9XG59XG4iXX0=