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
     * Runs is advisory lock held.
     * @param {string} name - Lock name.
     * @returns {Promise<boolean>} - True if any session currently holds the lock.
     */
    async isAdvisoryLockHeld(name) {
        const rows = await this.query(`SELECT IS_USED_LOCK(${this.quote(name)}) AS velocious_advisory_lock_holder`);
        const holder = rows?.[0]?.velocious_advisory_lock_holder;
        return holder !== null && holder !== undefined;
    }
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiaW5kZXguanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi8uLi8uLi9zcmMvZGF0YWJhc2UvZHJpdmVycy9teXNxbC9pbmRleC5qcyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiQUFBQSxZQUFZO0FBRVosT0FBTyxVQUFVLE1BQU0sc0JBQXNCLENBQUE7QUFDN0MsT0FBTyxJQUFJLE1BQU0sWUFBWSxDQUFBO0FBQzdCLE9BQU8sY0FBYyxNQUFNLDBCQUEwQixDQUFBO0FBQ3JELE9BQU8sV0FBVyxNQUFNLHVCQUF1QixDQUFBO0FBQy9DLE9BQU8sV0FBVyxNQUFNLHVCQUF1QixDQUFBO0FBQy9DLE9BQU8sTUFBTSxNQUFNLGlCQUFpQixDQUFBO0FBQ3BDLE9BQU8sRUFBQyxJQUFJLEVBQUMsTUFBTSxXQUFXLENBQUE7QUFDOUIsT0FBTyxZQUFZLE1BQU0sd0JBQXdCLENBQUE7QUFDakQsT0FBTyxTQUFTLE1BQU0scUJBQXFCLENBQUE7QUFDM0MsT0FBTyxNQUFNLE1BQU0saUJBQWlCLENBQUE7QUFDcEMsT0FBTyxPQUFPLE1BQU0sY0FBYyxDQUFBO0FBQ2xDLE9BQU8sS0FBSyxNQUFNLE9BQU8sQ0FBQTtBQUN6QixPQUFPLEtBQUssTUFBTSxZQUFZLENBQUE7QUFDOUIsT0FBTyxpQkFBaUIsTUFBTSw4QkFBOEIsQ0FBQTtBQUM1RCxPQUFPLFdBQVcsTUFBTSxtQkFBbUIsQ0FBQTtBQUMzQyxPQUFPLFdBQVcsTUFBTSxtQkFBbUIsQ0FBQTtBQUMzQyxPQUFPLFdBQVcsTUFBTSx1QkFBdUIsQ0FBQTtBQUMvQyxPQUFPLEtBQUssTUFBTSxZQUFZLENBQUE7QUFDOUIsT0FBTyxZQUFZLE1BQU0sb0JBQW9CLENBQUE7QUFDN0MsT0FBTyxNQUFNLE1BQU0saUJBQWlCLENBQUE7QUFDcEMsT0FBTyxNQUFNLE1BQU0saUJBQWlCLENBQUE7QUFDcEMsT0FBTywwQkFBMEIsTUFBTSxpQ0FBaUMsQ0FBQTtBQUV4RTs7Ozs7OztHQU9HO0FBQ0gsTUFBTSxx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QUMsQ0FBQTtRQUM3SSxDQUFDO1FBRUQsT0FBTyxNQUFNLENBQUMsTUFBTSxDQUFDLEtBQUssQ0FBQyxDQUFBO0lBQzdCLENBQUM7SUFFRDs7OztPQUlHO0lBQ0gsS0FBSyxDQUFDLG9CQUFvQixDQUFDLElBQUk7UUFDN0IsTUFBTSxJQUFJLEdBQUcsTUFBTSxJQUFJLENBQUMsS0FBSyxDQUFDLHVCQUF1QixJQUFJLENBQUMsS0FBSyxDQUFDLElBQUksQ0FBQyxxQ0FBcUMsRUFBRSxFQUFDLEtBQUssRUFBRSxLQUFLLEVBQUMsQ0FBQyxDQUFBO1FBQzNILE1BQU0sTUFBTSxHQUFHLElBQUksRUFBRSxDQUFDLENBQUMsQ0FBQyxFQUFFLDhCQUE4QixDQUFBO1FBRXhELE9BQU8sTUFBTSxDQUFDLE1BQU0sQ0FBQyxLQUFLLENBQUMsQ0FBQTtJQUM3QixDQUFDO0lBRUQ7Ozs7T0FJRztJQUNILEtBQUssQ0FBQyxrQkFBa0IsQ0FBQyxJQUFJO1FBQzNCLE1BQU0sSUFBSSxHQUFHLE1BQU0sSUFBSSxDQUFDLEtBQUssQ0FBQyx1QkFBdUIsSUFBSSxDQUFDLEtBQUssQ0FBQyxJQUFJLENBQUMscUNBQXFDLENBQUMsQ0FBQTtRQUMzRyxNQUFNLE1BQU0sR0FBRyxJQUFJLEVBQUUsQ0FBQyxDQUFDLENBQUMsRUFBRSw4QkFBOEIsQ0FBQTtRQUV4RCxPQUFPLE1BQU0sS0FBSyxJQUFJLElBQUksTUFBTSxLQUFLLFNBQVMsQ0FBQTtJQUNoRCxDQUFDO0NBQ0YiLCJzb3VyY2VzQ29udGVudCI6WyIvLyBAdHMtY2hlY2tcblxuaW1wb3J0IEFsdGVyVGFibGUgZnJvbSBcIi4vc3FsL2FsdGVyLXRhYmxlLmpzXCJcbmltcG9ydCBCYXNlIGZyb20gXCIuLi9iYXNlLmpzXCJcbmltcG9ydCBDcmVhdGVEYXRhYmFzZSBmcm9tIFwiLi9zcWwvY3JlYXRlLWRhdGFiYXNlLmpzXCJcbmltcG9ydCBDcmVhdGVJbmRleCBmcm9tIFwiLi9zcWwvY3JlYXRlLWluZGV4LmpzXCJcbmltcG9ydCBDcmVhdGVUYWJsZSBmcm9tIFwiLi9zcWwvY3JlYXRlLXRhYmxlLmpzXCJcbmltcG9ydCBEZWxldGUgZnJvbSBcIi4vc3FsL2RlbGV0ZS5qc1wiXG5pbXBvcnQge2RpZ2d9IGZyb20gXCJkaWdnZXJpemVcIlxuaW1wb3J0IERyb3BEYXRhYmFzZSBmcm9tIFwiLi9zcWwvZHJvcC1kYXRhYmFzZS5qc1wiXG5pbXBvcnQgRHJvcFRhYmxlIGZyb20gXCIuL3NxbC9kcm9wLXRhYmxlLmpzXCJcbmltcG9ydCBJbnNlcnQgZnJvbSBcIi4vc3FsL2luc2VydC5qc1wiXG5pbXBvcnQgT3B0aW9ucyBmcm9tIFwiLi9vcHRpb25zLmpzXCJcbmltcG9ydCBteXNxbCBmcm9tIFwibXlzcWxcIlxuaW1wb3J0IHF1ZXJ5IGZyb20gXCIuL3F1ZXJ5LmpzXCJcbmltcG9ydCBRdWVyeUFib3J0ZWRFcnJvciBmcm9tIFwiLi4vLi4vcXVlcnktYWJvcnRlZC1lcnJvci5qc1wiXG5pbXBvcnQgUXVlcnlQYXJzZXIgZnJvbSBcIi4vcXVlcnktcGFyc2VyLmpzXCJcbmltcG9ydCBzdHJlYW1RdWVyeSBmcm9tIFwiLi9xdWVyeS1zdHJlYW0uanNcIlxuaW1wb3J0IFJlbW92ZUluZGV4IGZyb20gXCIuL3NxbC9yZW1vdmUtaW5kZXguanNcIlxuaW1wb3J0IFRhYmxlIGZyb20gXCIuL3RhYmxlLmpzXCJcbmltcG9ydCBTdHJ1Y3R1cmVTcWwgZnJvbSBcIi4vc3RydWN0dXJlLXNxbC5qc1wiXG5pbXBvcnQgVXBzZXJ0IGZyb20gXCIuL3NxbC91cHNlcnQuanNcIlxuaW1wb3J0IFVwZGF0ZSBmcm9tIFwiLi9zcWwvdXBkYXRlLmpzXCJcbmltcG9ydCBwYXJzZUlubm9kYkRlYWRsb2NrU3VtbWFyeSBmcm9tIFwiLi9kZWFkbG9jay1kaWFnbm9zdGljLXBhcnNlci5qc1wiXG5cbi8qKlxuICogU2VudGluZWwgdGltZW91dCAoaW4gc2Vjb25kcykgdXNlZCBhcyB0aGUgXCJibG9jayBmb3JldmVyXCIgdmFsdWUgd2hlbiBhXG4gKiBjYWxsZXIgYXNrcyBmb3IgYW4gaW5kZWZpbml0ZSBhZHZpc29yeSBsb2NrIGFjcXVpcmUuIE15U1FMIGhpc3RvcmljYWxseVxuICogYWNjZXB0ZWQgbmVnYXRpdmUgdGltZW91dHMgYXMgXCJpbmZpbml0ZVwiLCBidXQgTWFyaWFEQiAxMCsgc2lsZW50bHlcbiAqIHJldHVybnMgTlVMTCBmcm9tIGBHRVRfTE9DS2Agd2hlbiB0aGUgdGltZW91dCBpcyBuZWdhdGl2ZSwgc28gdGhlXG4gKiBkcml2ZXIgY2xhbXBzIHRvIGEgY29tZm9ydGFibHkgbGFyZ2UgcG9zaXRpdmUgdmFsdWUgKDEgeWVhciDiiasgYW55XG4gKiByZWFsaXN0aWMgY3JpdGljYWwgc2VjdGlvbikgaW5zdGVhZC5cbiAqL1xuY29uc3QgTVlTUUxfSU5ERUZJTklURV9MT0NLX1RJTUVPVVRfU0VDT05EUyA9IDYwICogNjAgKiAyNCAqIDM2NVxuY29uc3QgSU5OT0RCX0RFQURMT0NLX0NBUFRVUkVfVElNRU9VVF9NUyA9IDI1MFxuXG5leHBvcnQgZGVmYXVsdCBjbGFzcyBWZWxvY2lvdXNEYXRhYmFzZURyaXZlcnNNeXNxbCBleHRlbmRzIEJhc2V7XG4gIC8qKiBAdHlwZSB7aW1wb3J0KFwibXlzcWxcIikuUG9vbCB8IHVuZGVmaW5lZH0gKi9cbiAgcG9vbCA9IHVuZGVmaW5lZFxuXG4gIC8qKiBAdHlwZSB7c3RyaW5nIHwgbnVsbH0gKi9cbiAgX2Rlc2lyZWRTZXNzaW9uVGltZVpvbmUgPSBcIiswMDowMFwiXG5cbiAgLyoqIEB0eXBlIHtzdHJpbmcgfCBudWxsfSAqL1xuICBfY3VycmVudFNlc3Npb25UaW1lWm9uZSA9IG51bGxcblxuICAvKipcbiAgICogUnVucyBjb25uZWN0LlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyB3aGVuIGNvbXBsZXRlLlxuICAgKi9cbiAgYXN5bmMgY29ubmVjdCgpIHtcbiAgICB0aGlzLnJlc2V0Q3VycmVudFNlc3Npb25UaW1lWm9uZSgpXG4gICAgdGhpcy5wb29sID0gbXlzcWwuY3JlYXRlUG9vbChPYmplY3QuYXNzaWduKHtjb25uZWN0aW9uTGltaXQ6IDF9LCB0aGlzLmNvbm5lY3RBcmdzKCkpKVxuICAgIHRoaXMucG9vbC5vbihcImVycm9yXCIsIHRoaXMub25Qb29sRXJyb3IpXG4gIH1cblxuICAvKipcbiAgICogT24gcG9vbCBlcnJvci5cbiAgICogQHBhcmFtIHtFcnJvcn0gZXJyb3IgLSBFcnJvciBmcm9tIHRoZSBjb25uZWN0aW9uIGF0dGVtcHQuXG4gICAqL1xuICBvblBvb2xFcnJvciA9IChlcnJvcikgPT4ge1xuICAgIGNvbnNvbGUuZXJyb3IoXCJWZWxvY2lvdXMgLyBNeVNRTCBkcml2ZXIgLyBQb29sIGVycm9yXCIsIGVycm9yKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgY2xvc2UuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIHdoZW4gY29tcGxldGUuXG4gICAqL1xuICBhc3luYyBfY2xvc2UoKSB7XG4gICAgY29uc3QgcG9vbCA9IHRoaXMucG9vbFxuXG4gICAgaWYgKCFwb29sKSByZXR1cm5cblxuICAgIGF3YWl0IG5ldyBQcm9taXNlKChyZXNvbHZlLCByZWplY3QpID0+IHtcbiAgICAgIHBvb2wuZW5kKChlcnJvcikgPT4ge1xuICAgICAgICBpZiAoZXJyb3IpIHtcbiAgICAgICAgICByZWplY3QoZXJyb3IpXG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgcmVzb2x2ZSh1bmRlZmluZWQpXG4gICAgICAgIH1cbiAgICAgIH0pXG4gICAgfSlcbiAgICB0aGlzLnBvb2wgPSB1bmRlZmluZWRcbiAgICB0aGlzLnJlc2V0Q3VycmVudFNlc3Npb25UaW1lWm9uZSgpXG4gIH1cblxuICAvKipcbiAgICogUmVzZXRzIHRoZSBNeVNRTCBzZXNzaW9uIHN0YXRlIGFmdGVyIGVhY2ggbG9naWNhbCBwb29sIGNoZWNrb3V0IHdoaWxlXG4gICAqIHJldXNpbmcgdGhlIGV4aXN0aW5nIHBoeXNpY2FsIGNvbm5lY3Rpb24uXG4gICAqIE15U1FMIGV4cG9zZXMgb3Blbi1lbmRlZCBzZXNzaW9uIHN0YXRlICh1c2VyIHZhcmlhYmxlcywgdGVtcG9yYXJ5IHRhYmxlcyxcbiAgICogcHJlcGFyZWQgc3RhdGVtZW50cywgYFNFVCBTRVNTSU9OYCBjaGFuZ2VzKSwgc28gdGhlIHN0YXRlIG11c3QgYmUgY2xlYXJlZFxuICAgKiBiZWZvcmUgdGhlIGxvZ2ljYWwgcG9vbCBlbnRyeSBpcyBoYW5kZWQgb3V0IGFnYWluLiBgQ09NX0NIQU5HRV9VU0VSYFxuICAgKiBwZXJmb3JtcyBhIGZ1bGwgc2Vzc2lvbiByZS1pbml0aWFsaXphdGlvbiBvbiB0aGUgc2VydmVyIHNpZGUg4oCUIHRoZSBzYW1lXG4gICAqIHN0YXRlIGEgZnJlc2ggaGFuZHNoYWtlIHdvdWxkIHN0YXJ0IHdpdGgg4oCUIHdpdGhvdXQgb3BlbmluZyBhIG5ldyBUQ1BcbiAgICogY29ubmVjdGlvbi4gVGhhdCBrZWVwcyBjaGVja291dHMgaXNvbGF0ZWQgZnJvbSBlYWNoIG90aGVyIHdoaWxlIGF2b2lkaW5nXG4gICAqIGEgcmVjb25uZWN0IChoYW5kc2hha2UgKyBhdXRoICsgc2NoZW1hIHJlLWludHJvc3BlY3Rpb24pIG9uIGV2ZXJ5XG4gICAqIG9wZXJhdGlvbi4gSWYgdGhlIHJlc2V0IGZhaWxzIHRoZSBwaHlzaWNhbCBzZXNzaW9uIGlzIGNsb3NlZCBpbnN0ZWFkLCBzb1xuICAgKiB0aGUgbmV4dCBxdWVyeSByZWNvbm5lY3RzIG9uIGEgZnJlc2ggc2Vzc2lvbiBhcyBhIHNhZmUgZmFsbGJhY2suXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIG9uY2UgdGhlIHNlc3Npb24gc3RhdGUgaXMgcmVzZXQuXG4gICAqL1xuICBhc3luYyBjbGVhbnVwU2Vzc2lvblN0YXRlQWZ0ZXJDaGVja291dCgpIHtcbiAgICBjb25zdCBwb29sID0gdGhpcy5wb29sXG5cbiAgICBpZiAoIXBvb2wpIHJldHVyblxuXG4gICAgdHJ5IHtcbiAgICAgIGNvbnN0IHBvb2xlZENvbm5lY3Rpb24gPSBhd2FpdCBuZXcgUHJvbWlzZSgocmVzb2x2ZSwgcmVqZWN0KSA9PiB7XG4gICAgICAgIHBvb2wuZ2V0Q29ubmVjdGlvbigoZXJyb3IsIGNvbm5lY3Rpb24pID0+IHtcbiAgICAgICAgICBpZiAoZXJyb3IpIHJlamVjdChlcnJvciBpbnN0YW5jZW9mIEVycm9yID8gZXJyb3IgOiBuZXcgRXJyb3IoYEZhaWxlZCB0byBjaGVjayBvdXQgY29ubmVjdGlvbiBmb3Igc2Vzc2lvbiByZXNldDogJHtlcnJvcn1gKSlcbiAgICAgICAgICBlbHNlIHJlc29sdmUoY29ubmVjdGlvbilcbiAgICAgICAgfSlcbiAgICAgIH0pXG5cbiAgICAgIHRyeSB7XG4gICAgICAgIGF3YWl0IG5ldyBQcm9taXNlKChyZXNvbHZlLCByZWplY3QpID0+IHtcbiAgICAgICAgICBwb29sZWRDb25uZWN0aW9uLmNoYW5nZVVzZXIoe2NoYXJzZXQ6IFwidXRmOG1iNFwiLCB0aW1lb3V0OiAxMDAwMH0sICgoLyoqIEB0eXBlIHtpbXBvcnQoXCJteXNxbFwiKS5NeXNxbEVycm9yfSAqLyBlcnJvcikgPT4ge1xuICAgICAgICAgICAgaWYgKGVycm9yKSByZWplY3QoZXJyb3IgaW5zdGFuY2VvZiBFcnJvciA/IGVycm9yIDogbmV3IEVycm9yKGBNeVNRTCBzZXNzaW9uIHJlc2V0IGZhaWxlZDogJHtlcnJvcn1gKSlcbiAgICAgICAgICAgIGVsc2UgcmVzb2x2ZSh1bmRlZmluZWQpXG4gICAgICAgICAgfSkpXG4gICAgICAgIH0pXG4gICAgICB9IGZpbmFsbHkge1xuICAgICAgICBwb29sZWRDb25uZWN0aW9uLnJlbGVhc2UoKVxuICAgICAgfVxuXG4gICAgICAvLyBUaGUgc2VydmVyIHJlLWluaXRpYWxpemVkIHRoZSBzZXNzaW9uIG9uIHRoaXMgc29ja2V0OiB1c2VyIHZhcmlhYmxlcyxcbiAgICAgIC8vIHRlbXBvcmFyeSB0YWJsZXMsIHByZXBhcmVkIHN0YXRlbWVudHMsIGFuZCBzZXNzaW9uIHZhcmlhYmxlcyBhcmUgZ29uZSxcbiAgICAgIC8vIGFuZCB0aGUgc2Vzc2lvbiB0aW1lIHpvbmUgbXVzdCBiZSByZS1lc3RhYmxpc2hlZCBiZWZvcmUgdGhlIG5leHQgcXVlcnkuXG4gICAgICB0aGlzLnJlc2V0Q3VycmVudFNlc3Npb25UaW1lWm9uZSgpXG4gICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgIC8vIEEgZmFpbGVkIHJlc2V0IGxlYXZlcyB0aGUgc2Vzc2lvbiBzdGF0ZSB1bmtub3duLCBzbyBmYWxsIGJhY2sgdG8gYVxuICAgICAgLy8gZnVsbCBwaHlzaWNhbCBkaXNjb25uZWN0OiB0aGUgbmV4dCBxdWVyeSByZWNvbm5lY3RzIG9uIGEgZnJlc2ggc2Vzc2lvbi5cbiAgICAgIC8vIFRoZSBsb2dpY2FsIGNvbm5lY3Rpb24gaXMgc3RpbGwgcmV1c2FibGUgYWZ0ZXJ3YXJkcy5cbiAgICAgIHRyeSB7XG4gICAgICAgIGF3YWl0IHRoaXMuX2Nsb3NlKClcbiAgICAgIH0gY2F0Y2ggKGNsb3NlRXJyb3IpIHtcbiAgICAgICAgdGhyb3cgbmV3IEFnZ3JlZ2F0ZUVycm9yKFtlcnJvciwgY2xvc2VFcnJvcl0sIFwiTXlTUUwgc2Vzc2lvbiByZXNldCBmYWlsZWQgYW5kIHRoZSBwaHlzaWNhbCBkaXNjb25uZWN0IGZhbGxiYWNrIGFsc28gZmFpbGVkXCIsIHtjYXVzZTogY2xvc2VFcnJvcn0pXG4gICAgICB9XG5cbiAgICAgIHRocm93IGVycm9yXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgc2V0IGNvbm5lY3Rpb24gY2hlY2tvdXQgbmFtZS5cbiAgICogQHBhcmFtIHtzdHJpbmcgfCB1bmRlZmluZWR9IG5hbWUgLSBIdW1hbi1yZWFkYWJsZSBuYW1lIGZvciB0aGlzIGFjdGl2ZSBjaGVja291dC5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgd2hlbiBjb21wbGV0ZS5cbiAgICovXG4gIGFzeW5jIHNldENvbm5lY3Rpb25DaGVja291dE5hbWUobmFtZSkge1xuICAgIGNvbnN0IHByZXZpb3VzTmFtZSA9IHRoaXMuX2Nvbm5lY3Rpb25DaGVja291dE5hbWVcblxuICAgIGF3YWl0IHN1cGVyLnNldENvbm5lY3Rpb25DaGVja291dE5hbWUobmFtZSlcblxuICAgIGlmIChuYW1lID09PSB1bmRlZmluZWQpIHtcbiAgICAgIGlmIChwcmV2aW91c05hbWUgIT09IHVuZGVmaW5lZCkge1xuICAgICAgICBhd2FpdCB0aGlzLnF1ZXJ5KFwiU0VUIEB2ZWxvY2lvdXNfY29ubmVjdGlvbl9jaGVja291dF9uYW1lID0gTlVMTFwiLCB7bG9nTmFtZTogXCJDbGVhciBDb25uZWN0aW9uIENoZWNrb3V0IE5hbWVcIiwgcHJvY2Vzc0xpc3RDb21tZW50OiBmYWxzZSwgc2Vzc2lvblRpbWVab25lOiBmYWxzZX0pXG4gICAgICB9XG5cbiAgICAgIHJldHVyblxuICAgIH1cblxuICAgIGF3YWl0IHRoaXMucXVlcnkoYFNFVCBAdmVsb2Npb3VzX2Nvbm5lY3Rpb25fY2hlY2tvdXRfbmFtZSA9ICR7dGhpcy5xdW90ZShuYW1lKX1gLCB7bG9nTmFtZTogXCJTZXQgQ29ubmVjdGlvbiBDaGVja291dCBOYW1lXCIsIHByb2Nlc3NMaXN0Q29tbWVudDogZmFsc2UsIHNlc3Npb25UaW1lWm9uZTogZmFsc2V9KVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgY2xlYXIgY29ubmVjdGlvbiBjaGVja291dCBuYW1lLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyB3aGVuIGNvbXBsZXRlLlxuICAgKi9cbiAgYXN5bmMgY2xlYXJDb25uZWN0aW9uQ2hlY2tvdXROYW1lKCkge1xuICAgIGlmICh0aGlzLl9jb25uZWN0aW9uQ2hlY2tvdXROYW1lICE9PSB1bmRlZmluZWQpIHtcbiAgICAgIGF3YWl0IHRoaXMucXVlcnkoXCJTRVQgQHZlbG9jaW91c19jb25uZWN0aW9uX2NoZWNrb3V0X25hbWUgPSBOVUxMXCIsIHtsb2dOYW1lOiBcIkNsZWFyIENvbm5lY3Rpb24gQ2hlY2tvdXQgTmFtZVwiLCBwcm9jZXNzTGlzdENvbW1lbnQ6IGZhbHNlLCBzZXNzaW9uVGltZVpvbmU6IGZhbHNlfSlcbiAgICB9XG5cbiAgICBhd2FpdCBzdXBlci5jbGVhckNvbm5lY3Rpb25DaGVja291dE5hbWUoKVxuICB9XG5cbiAgLyoqXG4gICAqIEhvb2sgYmVmb3JlIGV2ZXJ5IHF1ZXJ5LlxuICAgKiBAcGFyYW0ge3N0cmluZ30gX3NxbCAtIFNRTCBzdHJpbmcuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vYmFzZS5qc1wiKS5RdWVyeU9wdGlvbnN9IG9wdGlvbnMgLSBRdWVyeSBvcHRpb25zLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyB3aGVuIGNvbXBsZXRlLlxuICAgKi9cbiAgYXN5bmMgYmVmb3JlUXVlcnkoX3NxbCwgb3B0aW9ucykge1xuICAgIGlmIChvcHRpb25zLnNlc3Npb25UaW1lWm9uZSAhPT0gZmFsc2UpIGF3YWl0IHRoaXMuZW5zdXJlU2Vzc2lvblRpbWVab25lKClcbiAgfVxuXG4gIC8qKlxuICAgKiBHZXRzIHRoZSBkZXNpcmVkIGRhdGFiYXNlIHNlc3Npb24gdGltZSB6b25lIGZvciB0aGlzIGNvbm5lY3Rpb24gY29udGV4dC5cbiAgICogQHJldHVybnMge3N0cmluZyB8IG51bGx9IC0gRGVzaXJlZCBzZXNzaW9uIHRpbWUgem9uZS5cbiAgICovXG4gIGdldERlc2lyZWRTZXNzaW9uVGltZVpvbmUoKSB7XG4gICAgcmV0dXJuIHRoaXMuX2Rlc2lyZWRTZXNzaW9uVGltZVpvbmVcbiAgfVxuXG4gIC8qKlxuICAgKiBTZXRzIHRoZSBkZXNpcmVkIGRhdGFiYXNlIHNlc3Npb24gdGltZSB6b25lIHdpdGhvdXQgcXVlcnlpbmcgTXlTUUwgaW1tZWRpYXRlbHkuXG4gICAqIEBwYXJhbSB7c3RyaW5nIHwgbnVsbH0gdGltZVpvbmUgLSBEZXNpcmVkIHNlc3Npb24gdGltZSB6b25lLlxuICAgKi9cbiAgc2V0RGVzaXJlZFNlc3Npb25UaW1lWm9uZSh0aW1lWm9uZSkge1xuICAgIHRoaXMuX2Rlc2lyZWRTZXNzaW9uVGltZVpvbmUgPSB0aW1lWm9uZVxuICB9XG5cbiAgLyoqXG4gICAqIEdldHMgdGhlIGRhdGFiYXNlIHNlc3Npb24gdGltZSB6b25lIGxhc3QgY29uZmlybWVkIHRocm91Z2ggU0VUIHRpbWVfem9uZS5cbiAgICogQHJldHVybnMge3N0cmluZyB8IG51bGx9IC0gQ3VycmVudCBrbm93biBzZXNzaW9uIHRpbWUgem9uZS5cbiAgICovXG4gIGdldEN1cnJlbnRTZXNzaW9uVGltZVpvbmUoKSB7XG4gICAgcmV0dXJuIHRoaXMuX2N1cnJlbnRTZXNzaW9uVGltZVpvbmVcbiAgfVxuXG4gIC8qKlxuICAgKiBDbGVhcnMgdGhlIGN1cnJlbnQga25vd24gZGF0YWJhc2Ugc2Vzc2lvbiB0aW1lIHpvbmUgd2hlbiB0aGUgcGh5c2ljYWwgY29ubmVjdGlvbiBjaGFuZ2VzLlxuICAgKi9cbiAgcmVzZXRDdXJyZW50U2Vzc2lvblRpbWVab25lKCkge1xuICAgIHRoaXMuX2N1cnJlbnRTZXNzaW9uVGltZVpvbmUgPSBudWxsXG4gIH1cblxuICAvKipcbiAgICogRW5zdXJlcyBNeVNRTCBoYXMgdGhlIGRlc2lyZWQgc2Vzc2lvbiB0aW1lIHpvbmUgYmVmb3JlIHVzZXIgU1FMIHJ1bnMuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPGJvb2xlYW4+fSAtIFRydWUgd2hlbiBTRVQgdGltZV96b25lIHdhcyBleGVjdXRlZC5cbiAgICovXG4gIGFzeW5jIGVuc3VyZVNlc3Npb25UaW1lWm9uZSgpIHtcbiAgICBjb25zdCBkZXNpcmVkU2Vzc2lvblRpbWVab25lID0gdGhpcy5nZXREZXNpcmVkU2Vzc2lvblRpbWVab25lKClcblxuICAgIGlmIChkZXNpcmVkU2Vzc2lvblRpbWVab25lID09PSBudWxsIHx8IHRoaXMuZ2V0Q3VycmVudFNlc3Npb25UaW1lWm9uZSgpID09PSBkZXNpcmVkU2Vzc2lvblRpbWVab25lKSByZXR1cm4gZmFsc2VcblxuICAgIGF3YWl0IHRoaXMuc2V0U2Vzc2lvblRpbWVab25lKGRlc2lyZWRTZXNzaW9uVGltZVpvbmUpXG5cbiAgICByZXR1cm4gdHJ1ZVxuICB9XG5cbiAgLyoqXG4gICAqIFNldHMgdGhlIGRhdGFiYXNlIHNlc3Npb24gdGltZSB6b25lIGlmIGl0IGNoYW5nZWQgZnJvbSB0aGUgbGFzdCBjb25maXJtZWQgdmFsdWUuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSB0aW1lWm9uZSAtIFNlc3Npb24gdGltZSB6b25lIHZhbHVlIGFjY2VwdGVkIGJ5IE15U1FMLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxib29sZWFuPn0gLSBUcnVlIHdoZW4gU0VUIHRpbWVfem9uZSB3YXMgZXhlY3V0ZWQuXG4gICAqL1xuICBhc3luYyBzZXRTZXNzaW9uVGltZVpvbmUodGltZVpvbmUpIHtcbiAgICBpZiAodGhpcy5nZXRDdXJyZW50U2Vzc2lvblRpbWVab25lKCkgPT09IHRpbWVab25lKSByZXR1cm4gZmFsc2VcblxuICAgIGF3YWl0IHRoaXMuX3F1ZXJ5QWN0dWFsKGBTRVQgdGltZV96b25lID0gJHt0aGlzLnF1b3RlKHRpbWVab25lKX1gKVxuICAgIHRoaXMuX2N1cnJlbnRTZXNzaW9uVGltZVpvbmUgPSB0aW1lWm9uZVxuXG4gICAgcmV0dXJuIHRydWVcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGNvbm5lY3QgYXJncy5cbiAgICogQHJldHVybnMge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gLSBUaGUgY29ubmVjdCBhcmdzLlxuICAgKi9cbiAgY29ubmVjdEFyZ3MoKSB7XG4gICAgY29uc3QgYXJncyA9IHRoaXMuZ2V0QXJncygpXG4gICAgY29uc3QgZm9yd2FyZCA9IFtcImRhdGFiYXNlXCIsIFwiaG9zdFwiLCBcInBhc3N3b3JkXCIsIFwicG9ydFwiXVxuXG4gICAgLyoqXG4gICAgICogQ29ubmVjdCBhcmdzLlxuICAgICAqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59ICovXG4gICAgY29uc3QgY29ubmVjdEFyZ3MgPSB7Y2hhcnNldDogXCJ1dGY4bWI0XCIsIHRpbWV6b25lOiBcIlpcIn1cblxuICAgIGZvciAoY29uc3QgZm9yd2FyZFZhbHVlIG9mIGZvcndhcmQpIHtcbiAgICAgIGlmIChmb3J3YXJkVmFsdWUgaW4gYXJncykgY29ubmVjdEFyZ3NbZm9yd2FyZFZhbHVlXSA9IGRpZ2coYXJncywgZm9yd2FyZFZhbHVlKVxuICAgIH1cblxuICAgIGlmIChcInVzZXJuYW1lXCIgaW4gYXJncykgY29ubmVjdEFyZ3NbXCJ1c2VyXCJdID0gYXJnc1tcInVzZXJuYW1lXCJdXG4gICAgaWYgKFwiY2hhcnNldFwiIGluIGFyZ3MpIGNvbm5lY3RBcmdzW1wiY2hhcnNldFwiXSA9IGFyZ3NbXCJjaGFyc2V0XCJdXG4gICAgLy8gT3B0LWluIG9ubHkuIExldHMgYSB3aG9sZSBzdHJ1Y3R1cmUgU1FMIGR1bXAgcnVuIGluIG9uZSByb3VuZC10cmlwIHZpYVxuICAgIC8vIHtAbGluayBleGVjU3RydWN0dXJlU2NyaXB0fTsgb2ZmIGJ5IGRlZmF1bHQgc28gb3JkaW5hcnkgcXVlcmllcyBrZWVwIHJlamVjdGluZ1xuICAgIC8vIHN0YWNrZWQgc3RhdGVtZW50cy5cbiAgICBpZiAoXCJtdWx0aXBsZVN0YXRlbWVudHNcIiBpbiBhcmdzKSBjb25uZWN0QXJnc1tcIm11bHRpcGxlU3RhdGVtZW50c1wiXSA9IEJvb2xlYW4oZGlnZyhhcmdzLCBcIm11bHRpcGxlU3RhdGVtZW50c1wiKSlcblxuICAgIHJldHVybiBjb25uZWN0QXJnc1xuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgYWx0ZXIgdGFibGUgc3Fscy5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi8uLi90YWJsZS1kYXRhL2luZGV4LmpzXCIpLmRlZmF1bHR9IHRhYmxlRGF0YSAtIFRhYmxlIGRhdGEuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHN0cmluZ1tdPn0gLSBSZXNvbHZlcyB3aXRoIFNRTCBzdGF0ZW1lbnRzLlxuICAgKi9cbiAgYXN5bmMgYWx0ZXJUYWJsZVNRTHModGFibGVEYXRhKSB7XG4gICAgY29uc3QgYWx0ZXJBcmdzID0ge3RhYmxlRGF0YSwgZHJpdmVyOiB0aGlzfVxuICAgIGNvbnN0IGFsdGVyVGFibGUgPSBuZXcgQWx0ZXJUYWJsZShhbHRlckFyZ3MpXG5cbiAgICByZXR1cm4gYXdhaXQgYWx0ZXJUYWJsZS50b1NRTHMoKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgY3JlYXRlIGRhdGFiYXNlIHNxbC5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGRhdGFiYXNlTmFtZSAtIERhdGFiYXNlIG5hbWUuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBbYXJnc10gLSBPcHRpb25zIG9iamVjdC5cbiAgICogQHBhcmFtIHtib29sZWFufSBbYXJncy5pZk5vdEV4aXN0c10gLSBXaGV0aGVyIGlmIG5vdCBleGlzdHMuXG4gICAqIEByZXR1cm5zIHtzdHJpbmdbXX0gLSBTUUwgc3RhdGVtZW50cy5cbiAgICovXG4gIGNyZWF0ZURhdGFiYXNlU3FsKGRhdGFiYXNlTmFtZSwgYXJncykge1xuICAgIGNvbnN0IGNyZWF0ZUFyZ3MgPSBPYmplY3QuYXNzaWduKHtkYXRhYmFzZU5hbWUsIGRyaXZlcjogdGhpc30sIGFyZ3MpXG4gICAgY29uc3QgY3JlYXRlRGF0YWJhc2UgPSBuZXcgQ3JlYXRlRGF0YWJhc2UoY3JlYXRlQXJncylcblxuICAgIHJldHVybiBjcmVhdGVEYXRhYmFzZS50b1NxbCgpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBkcm9wIGRhdGFiYXNlIHNxbC5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGRhdGFiYXNlTmFtZSAtIERhdGFiYXNlIG5hbWUuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBbYXJnc10gLSBPcHRpb25zIG9iamVjdC5cbiAgICogQHBhcmFtIHtib29sZWFufSBbYXJncy5pZkV4aXN0c10gLSBXaGV0aGVyIGlmIGV4aXN0cy5cbiAgICogQHJldHVybnMge3N0cmluZ1tdfSAtIFNRTCBzdGF0ZW1lbnRzLlxuICAgKi9cbiAgZHJvcERhdGFiYXNlU3FsKGRhdGFiYXNlTmFtZSwgYXJncykge1xuICAgIGNvbnN0IGRyb3BBcmdzID0gT2JqZWN0LmFzc2lnbih7ZGF0YWJhc2VOYW1lLCBkcml2ZXI6IHRoaXN9LCBhcmdzKVxuICAgIGNvbnN0IGRyb3BEYXRhYmFzZSA9IG5ldyBEcm9wRGF0YWJhc2UoZHJvcEFyZ3MpXG5cbiAgICByZXR1cm4gZHJvcERhdGFiYXNlLnRvU3FsKClcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGNyZWF0ZSBpbmRleCBzcWxzLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL2Jhc2UuanNcIikuQ3JlYXRlSW5kZXhTcWxBcmdzfSBpbmRleERhdGEgLSBJbmRleCBkYXRhLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxzdHJpbmdbXT59IC0gUmVzb2x2ZXMgd2l0aCBTUUwgc3RhdGVtZW50cy5cbiAgICovXG4gIGFzeW5jIGNyZWF0ZUluZGV4U1FMcyhpbmRleERhdGEpIHtcbiAgICBjb25zdCBjcmVhdGVBcmdzID0gT2JqZWN0LmFzc2lnbih7ZHJpdmVyOiB0aGlzfSwgaW5kZXhEYXRhKVxuICAgIGNvbnN0IGNyZWF0ZUluZGV4ID0gbmV3IENyZWF0ZUluZGV4KGNyZWF0ZUFyZ3MpXG5cbiAgICByZXR1cm4gYXdhaXQgY3JlYXRlSW5kZXgudG9TUUxzKClcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHJlbW92ZSBpbmRleCBzcWxzLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL2Jhc2UuanNcIikuUmVtb3ZlSW5kZXhTcWxBcmdzfSBpbmRleERhdGEgLSBJbmRleCBkYXRhLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxzdHJpbmdbXT59IC0gUmVzb2x2ZXMgd2l0aCBTUUwgc3RhdGVtZW50cy5cbiAgICovXG4gIGFzeW5jIHJlbW92ZUluZGV4U1FMcyhpbmRleERhdGEpIHtcbiAgICBjb25zdCByZW1vdmVBcmdzID0gT2JqZWN0LmFzc2lnbih7ZHJpdmVyOiB0aGlzfSwgaW5kZXhEYXRhKVxuICAgIGNvbnN0IHJlbW92ZUluZGV4ID0gbmV3IFJlbW92ZUluZGV4KHJlbW92ZUFyZ3MpXG5cbiAgICByZXR1cm4gYXdhaXQgcmVtb3ZlSW5kZXgudG9TUUxzKClcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGNyZWF0ZSB0YWJsZSBzcWwuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vLi4vdGFibGUtZGF0YS9pbmRleC5qc1wiKS5kZWZhdWx0fSB0YWJsZURhdGEgLSBUYWJsZSBkYXRhLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxzdHJpbmdbXT59IC0gUmVzb2x2ZXMgd2l0aCBTUUwgc3RhdGVtZW50cy5cbiAgICovXG4gIGFzeW5jIGNyZWF0ZVRhYmxlU3FsKHRhYmxlRGF0YSkge1xuICAgIGNvbnN0IGNyZWF0ZUFyZ3MgPSB7dGFibGVEYXRhLCBkcml2ZXI6IHRoaXN9XG4gICAgY29uc3QgY3JlYXRlVGFibGUgPSBuZXcgQ3JlYXRlVGFibGUoY3JlYXRlQXJncylcblxuICAgIHJldHVybiBjcmVhdGVUYWJsZS50b1NxbCgpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBjdXJyZW50IGRhdGFiYXNlLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxzdHJpbmc+fSAtIFJlc29sdmVzIHdpdGggdGhlIGN1cnJlbnQgZGF0YWJhc2UuXG4gICAqL1xuICBhc3luYyBjdXJyZW50RGF0YWJhc2UoKSB7XG4gICAgY29uc3Qgcm93cyA9IGF3YWl0IHRoaXMucXVlcnkoXCJTRUxFQ1QgREFUQUJBU0UoKSBBUyBkYl9uYW1lXCIpXG5cbiAgICByZXR1cm4gZGlnZyhyb3dzLCAwLCBcImRiX25hbWVcIilcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGRpc2FibGUgZm9yZWlnbiBrZXlzLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyB3aGVuIGNvbXBsZXRlLlxuICAgKi9cbiAgYXN5bmMgZGlzYWJsZUZvcmVpZ25LZXlzKCkge1xuICAgIGF3YWl0IHRoaXMucXVlcnkoXCJTRVQgRk9SRUlHTl9LRVlfQ0hFQ0tTID0gMFwiKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZW5hYmxlIGZvcmVpZ24ga2V5cy5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgd2hlbiBjb21wbGV0ZS5cbiAgICovXG4gIGFzeW5jIGVuYWJsZUZvcmVpZ25LZXlzKCkge1xuICAgIGF3YWl0IHRoaXMucXVlcnkoXCJTRVQgRk9SRUlHTl9LRVlfQ0hFQ0tTID0gMVwiKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZHJvcCB0YWJsZSBzcWxzLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gdGFibGVOYW1lIC0gVGFibGUgbmFtZS5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9iYXNlLmpzXCIpLkRyb3BUYWJsZVNxbEFyZ3NUeXBlfSBbYXJnc10gLSBPcHRpb25zIG9iamVjdC5cbiAgICogQHJldHVybnMge1Byb21pc2U8c3RyaW5nW10+fSAtIFJlc29sdmVzIHdpdGggU1FMIHN0YXRlbWVudHMuXG4gICAqL1xuICBhc3luYyBkcm9wVGFibGVTUUxzKHRhYmxlTmFtZSwgYXJncyA9IHt9KSB7XG4gICAgY29uc3QgZHJvcEFyZ3MgPSBPYmplY3QuYXNzaWduKHt0YWJsZU5hbWUsIGRyaXZlcjogdGhpc30sIGFyZ3MpXG4gICAgY29uc3QgZHJvcFRhYmxlID0gbmV3IERyb3BUYWJsZShkcm9wQXJncylcblxuICAgIHJldHVybiBhd2FpdCBkcm9wVGFibGUudG9TUUxzKClcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGdldCB0eXBlLlxuICAgKiBAcmV0dXJucyB7c3RyaW5nfSAtIFRoZSB0eXBlLlxuICAgKi9cbiAgZ2V0VHlwZSgpIHsgcmV0dXJuIFwibXlzcWxcIiB9XG5cbiAgLyoqXG4gICAqIFdoZXRoZXIgdGhpcyBkcml2ZXIgc3VwcG9ydHMgY29tYmluaW5nIG9wZXJhdGlvbnMgaW50byBvbmUgYnVsayBgQUxURVJgLlxuICAgKiBAcmV0dXJucyB7Ym9vbGVhbn0gLSBXaGV0aGVyIGJ1bGsgYWx0ZXIgaXMgc3VwcG9ydGVkLlxuICAgKi9cbiAgc3VwcG9ydHNCdWxrQWx0ZXIoKSB7IHJldHVybiB0cnVlIH1cblxuICAvKipcbiAgICogV2hldGhlciB0aGUgYnVsayBgQUxURVJgIGNhbiBhbHNvIGNhcnJ5IGBBREQgSU5ERVhgIGNsYXVzZXMuXG4gICAqIEByZXR1cm5zIHtib29sZWFufSAtIFdoZXRoZXIgaW5kZXhlcyBjYW4gYmUgYWRkZWQgaW5zaWRlIGEgYnVsayBhbHRlci5cbiAgICovXG4gIHN1cHBvcnRzQnVsa0FsdGVySW5kZXhlcygpIHsgcmV0dXJuIHRydWUgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHJldHJ5YWJsZSBkYXRhYmFzZSBlcnJvci5cbiAgICogQHBhcmFtIHtFcnJvcn0gZXJyb3IgLSBFcnJvciBpbnN0YW5jZS5cbiAgICogQHJldHVybnMge2ltcG9ydChcIi4uL2Jhc2UuanNcIikuUmV0cnlhYmxlRGF0YWJhc2VFcnJvclJlc3VsdH0gLSBSZXRyeSBpbmZvLlxuICAgKi9cbiAgcmV0cnlhYmxlRGF0YWJhc2VFcnJvcihlcnJvcikge1xuICAgIC8qKiBAdHlwZSB7RXJyb3IgfCB1bmRlZmluZWR9ICovXG4gICAgbGV0IGN1cnJlbnRFcnJvciA9IGVycm9yXG4gICAgbGV0IHNob3VsZFJlY29ubmVjdCA9IGZhbHNlXG5cbiAgICB3aGlsZSAoY3VycmVudEVycm9yKSB7XG4gICAgICBjb25zdCBlcnJvckNvZGUgPSBcImNvZGVcIiBpbiBjdXJyZW50RXJyb3IgJiYgdHlwZW9mIGN1cnJlbnRFcnJvci5jb2RlID09IFwic3RyaW5nXCIgPyBjdXJyZW50RXJyb3IuY29kZSA6IHVuZGVmaW5lZFxuICAgICAgY29uc3QgbWVzc2FnZSA9IGN1cnJlbnRFcnJvci5tZXNzYWdlIHx8IFwiXCJcblxuICAgICAgaWYgKGVycm9yQ29kZSA9PSBcIkVSX0NIRUNLUkVBRFwiIHx8IG1lc3NhZ2UuaW5jbHVkZXMoXCJSZWNvcmQgaGFzIGNoYW5nZWQgc2luY2UgbGFzdCByZWFkXCIpKSB7XG4gICAgICAgIHJldHVybiB7cmV0cnk6IHRydWUsIHJlY29ubmVjdDogZmFsc2UsIHdhaXRNczogNTB9XG4gICAgICB9XG5cbiAgICAgIC8vIEEgZGVhZGxvY2sgb3IgbG9jay13YWl0LXRpbWVvdXQgYWJvcnRzIHRoZSB3aG9sZSB0cmFuc2FjdGlvbjsgaXQgbXVzdCBiZSByZXRyaWVkIGF0IHRoZVxuICAgICAgLy8gdHJhbnNhY3Rpb24gbGV2ZWwgKHJlLXJ1bm5pbmcgdGhlIGNhbGxiYWNrKSwgbm90IHRoZSBxdWVyeSBsZXZlbCwgc28gZmxhZyBpdCBhcyBzdWNoIGFuZFxuICAgICAgLy8ga2VlcCBgcmV0cnlgIGZhbHNlIHNvIGFuIGluLXRyYW5zYWN0aW9uIHF1ZXJ5IGRvZXMgbm90IHJldHJ5IGFnYWluc3QgdGhlIGRlYWQgdHJhbnNhY3Rpb24uXG4gICAgICBpZiAoZXJyb3JDb2RlID09IFwiRVJfTE9DS19ERUFETE9DS1wiIHx8IG1lc3NhZ2UuaW5jbHVkZXMoXCJFUl9MT0NLX0RFQURMT0NLXCIpIHx8IG1lc3NhZ2UuaW5jbHVkZXMoXCJEZWFkbG9jayBmb3VuZFwiKSkge1xuICAgICAgICByZXR1cm4ge3JldHJ5OiBmYWxzZSwgcmVjb25uZWN0OiBmYWxzZSwgZGVhZGxvY2s6IHRydWUsIGNvbnRlbnRpb25LaW5kOiBcImRlYWRsb2NrXCIsIHdhaXRNczogNTB9XG4gICAgICB9XG5cbiAgICAgIGlmIChlcnJvckNvZGUgPT0gXCJFUl9MT0NLX1dBSVRfVElNRU9VVFwiIHx8IG1lc3NhZ2UuaW5jbHVkZXMoXCJMb2NrIHdhaXQgdGltZW91dCBleGNlZWRlZFwiKSkge1xuICAgICAgICByZXR1cm4ge3JldHJ5OiBmYWxzZSwgcmVjb25uZWN0OiBmYWxzZSwgZGVhZGxvY2s6IHRydWUsIGNvbnRlbnRpb25LaW5kOiBcImxvY2std2FpdC10aW1lb3V0XCIsIHdhaXRNczogNTB9XG4gICAgICB9XG5cbiAgICAgIHNob3VsZFJlY29ubmVjdCB8fD0gKFxuICAgICAgICBlcnJvckNvZGUgPT0gXCJFQ09OTlJFRlVTRURcIiB8fFxuICAgICAgICBtZXNzYWdlLmluY2x1ZGVzKFwiRUNPTk5SRUZVU0VEXCIpIHx8XG4gICAgICAgIG1lc3NhZ2UuaW5jbHVkZXMoXCJjb25uZWN0IEVDT05OUkVGVVNFRFwiKSB8fFxuICAgICAgICBtZXNzYWdlLmluY2x1ZGVzKFwiUFJPVE9DT0xfQ09OTkVDVElPTl9MT1NUXCIpIHx8XG4gICAgICAgIG1lc3NhZ2UuaW5jbHVkZXMoXCJDb25uZWN0aW9uIGxvc3RcIilcbiAgICAgIClcblxuICAgICAgY3VycmVudEVycm9yID0gY3VycmVudEVycm9yLmNhdXNlIGluc3RhbmNlb2YgRXJyb3IgPyBjdXJyZW50RXJyb3IuY2F1c2UgOiB1bmRlZmluZWRcbiAgICB9XG5cbiAgICByZXR1cm4ge1xuICAgICAgcmV0cnk6IHNob3VsZFJlY29ubmVjdCxcbiAgICAgIHJlY29ubmVjdDogc2hvdWxkUmVjb25uZWN0LFxuICAgICAgd2FpdE1zOiA1MFxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBBZGRzIGEgcmVkYWN0ZWQsIGJvdW5kZWQgZXhjZXJwdCBmcm9tIE15U1FMJ3MgbGF0ZXN0IElubm9EQiBkZWFkbG9jayByZXBvcnQuIENhcHR1cmUgdXNlcyBhXG4gICAqIHNlcGFyYXRlIHNob3J0LWxpdmVkIGNvbm5lY3Rpb24gc28gaXQgY2Fubm90IHF1ZXVlIGFoZWFkIG9mIHJvbGxiYWNrIG9yIHRoZSBuZXh0IHJldHJ5IG9uIHRoaXNcbiAgICogZHJpdmVyJ3Mgc2luZ2xlLWNvbm5lY3Rpb24gcG9vbC5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9iYXNlLmpzXCIpLkRlYWRsb2NrUmV0cnlEaWFnbm9zdGljU25hcHNob3R9IHNuYXBzaG90IC0gSW1tdXRhYmxlIHJldHJ5IHNuYXBzaG90LlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj4+fSAtIFNhZmUgZGlhZ25vc3RpYyBjb250ZXh0LlxuICAgKi9cbiAgYXN5bmMgX2RlYWRsb2NrRGlhZ25vc3RpY0NvbnRleHQoc25hcHNob3QpIHtcbiAgICBpZiAoc25hcHNob3QuY29udGVudGlvbktpbmQgPT0gXCJsb2NrLXdhaXQtdGltZW91dFwiKSByZXR1cm4ge3N0YXR1c0NhcHR1cmU6IFwibm90LWFwcGxpY2FibGVcIn1cblxuICAgIGxldCBzdGF0dXNcblxuICAgIHRyeSB7XG4gICAgICBzdGF0dXMgPSBhd2FpdCB0aGlzLl9jYXB0dXJlSW5ub2RiRGVhZGxvY2tTdGF0dXMoKVxuICAgIH0gY2F0Y2gge1xuICAgICAgcmV0dXJuIHtzdGF0dXNDYXB0dXJlOiBcImZhaWxlZFwifVxuICAgIH1cblxuICAgIHJldHVybiB7XG4gICAgICBpbm5vZGJEZWFkbG9ja1N1bW1hcnk6IHRoaXMuX2lubm9kYkRlYWRsb2NrU3VtbWFyeShzdGF0dXMpLFxuICAgICAgc3RhdHVzQ2FwdHVyZTogXCJjYXB0dXJlZFwiXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIENhcHR1cmVzIFNIT1cgRU5HSU5FIElOTk9EQiBTVEFUVVMgb24gYSBib3VuZGVkIHRocm93YXdheSBjb25uZWN0aW9uLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxzdHJpbmc+fSAtIFJhdyBzZXJ2ZXIgc3RhdHVzLCByZXRhaW5lZCBvbmx5IGluc2lkZSB0aGUgcmVkYWN0aW9uIHBhdGguXG4gICAqL1xuICBhc3luYyBfY2FwdHVyZUlubm9kYkRlYWRsb2NrU3RhdHVzKCkge1xuICAgIGNvbnN0IHBvb2xXaXRoQ29uZmlnID0gLyoqIEB0eXBlIHt7Y29uZmlnPzoge2Nvbm5lY3Rpb25Db25maWc/OiBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn19IHwgdW5kZWZpbmVkfSAqLyAodGhpcy5wb29sKVxuICAgIGNvbnN0IGNvbm5lY3Rpb25Db25maWcgPSBwb29sV2l0aENvbmZpZz8uY29uZmlnPy5jb25uZWN0aW9uQ29uZmlnXG4gICAgY29uc3QgY2FwdHVyZUNvbmZpZyA9IGNvbm5lY3Rpb25Db25maWcgfHwgdGhpcy5jb25uZWN0QXJncygpXG5cbiAgICByZXR1cm4gYXdhaXQgbmV3IFByb21pc2UoKHJlc29sdmUsIHJlamVjdCkgPT4ge1xuICAgICAgLyoqIEB0eXBlIHtpbXBvcnQoXCJteXNxbFwiKS5Db25uZWN0aW9uIHwgdW5kZWZpbmVkfSAqL1xuICAgICAgbGV0IGNvbm5lY3Rpb25cbiAgICAgIGxldCBzZXR0bGVkID0gZmFsc2VcbiAgICAgIC8qKlxuICAgICAgICogRmluaXNoZXMgdGhlIHN0YXR1cyBjYXB0dXJlIG9uY2UgYW5kIGRlc3Ryb3lzIGl0cyB0ZW1wb3JhcnkgY29ubmVjdGlvbi5cbiAgICAgICAqIEBwYXJhbSB7RXJyb3IgfCB1bmRlZmluZWR9IGVycm9yIC0gQ2FwdHVyZSBlcnJvciwgd2hlbiBwcmVzZW50LlxuICAgICAgICogQHBhcmFtIHtzdHJpbmd9IFtzdGF0dXNdIC0gQ2FwdHVyZWQgc3RhdHVzLlxuICAgICAgICogQHJldHVybnMge3ZvaWR9XG4gICAgICAgKi9cbiAgICAgIGNvbnN0IGZpbmlzaCA9IChlcnJvciwgc3RhdHVzID0gXCJcIikgPT4ge1xuICAgICAgICBpZiAoc2V0dGxlZCkgcmV0dXJuXG4gICAgICAgIHNldHRsZWQgPSB0cnVlXG4gICAgICAgIGNsZWFyVGltZW91dCh0aW1lb3V0KVxuICAgICAgICBpZiAoY29ubmVjdGlvbikgY29ubmVjdGlvbi5kZXN0cm95KClcbiAgICAgICAgaWYgKGVycm9yKSByZWplY3QoZXJyb3IpXG4gICAgICAgIGVsc2UgcmVzb2x2ZShzdGF0dXMpXG4gICAgICB9XG4gICAgICBjb25zdCB0aW1lb3V0ID0gc2V0VGltZW91dCgoKSA9PiBmaW5pc2gobmV3IEVycm9yKFwiSW5ub0RCIHN0YXR1cyBjYXB0dXJlIHRpbWVkIG91dFwiKSksIElOTk9EQl9ERUFETE9DS19DQVBUVVJFX1RJTUVPVVRfTVMpXG5cbiAgICAgIHRyeSB7XG4gICAgICAgIGNvbm5lY3Rpb24gPSBteXNxbC5jcmVhdGVDb25uZWN0aW9uKGNhcHR1cmVDb25maWcpXG4gICAgICAgIGNvbm5lY3Rpb24ub24oXCJlcnJvclwiLCAoZXJyb3IpID0+IGZpbmlzaChlcnJvcikpXG4gICAgICAgIGNvbm5lY3Rpb24ucXVlcnkoXCJTSE9XIEVOR0lORSBJTk5PREIgU1RBVFVTXCIsIChlcnJvciwgcm93cykgPT4ge1xuICAgICAgICAgIGlmIChlcnJvcikge1xuICAgICAgICAgICAgZmluaXNoKGVycm9yKVxuICAgICAgICAgICAgcmV0dXJuXG4gICAgICAgICAgfVxuXG4gICAgICAgICAgY29uc3QgZmlyc3RSb3cgPSBBcnJheS5pc0FycmF5KHJvd3MpID8gcm93c1swXSA6IHVuZGVmaW5lZFxuICAgICAgICAgIGNvbnN0IHN0YXR1cyA9IGZpcnN0Um93ICYmIHR5cGVvZiBmaXJzdFJvdy5TdGF0dXMgPT0gXCJzdHJpbmdcIiA/IGZpcnN0Um93LlN0YXR1cyA6IFwiXCJcblxuICAgICAgICAgIGZpbmlzaCh1bmRlZmluZWQsIHN0YXR1cylcbiAgICAgICAgfSlcbiAgICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICAgIGZpbmlzaChlcnJvciBpbnN0YW5jZW9mIEVycm9yID8gZXJyb3IgOiBuZXcgRXJyb3IoXCJJbm5vREIgc3RhdHVzIGNhcHR1cmUgZmFpbGVkXCIpKVxuICAgICAgfVxuICAgIH0pXG4gIH1cblxuICAvKipcbiAgICogRXh0cmFjdHMgb25seSBmaXhlZC1mb3JtYXQgZGVhZGxvY2sgY291bnRlcnMuIFRoZSBzZXJ2ZXIgcmVwb3J0IGNvbnRhaW5zIHJhdyBTUUwsIGlkZW50aWZpZXJzLFxuICAgKiBhbmQgcGh5c2ljYWwgcmVjb3JkIGRhdGEsIHNvIG5vIHNvdXJjZSB0ZXh0IGlzIGV2ZXIgaW5jbHVkZWQgaW4gYW4gYXBwbGljYXRpb24gZGlhZ25vc3RpYy5cbiAgICogQHBhcmFtIHtzdHJpbmd9IHN0YXR1cyAtIFNIT1cgRU5HSU5FIElOTk9EQiBTVEFUVVMgdGV4dC5cbiAgICogQHJldHVybnMge3tsb2NrUmVjb3Jkc1RydW5jYXRlZDogYm9vbGVhbiwgc2VjdGlvblRydW5jYXRlZDogYm9vbGVhbiwgdHJhbnNhY3Rpb25Ob2RlczogQXJyYXk8e2NvbmZsaWN0aW5nTG9ja3M6IEFycmF5PHtpbmRleEZpbmdlcnByaW50OiBzdHJpbmcsIGxvY2tNb2RlOiBzdHJpbmcsIHN0YXRlOiBzdHJpbmcsIHRhYmxlRmluZ2VycHJpbnQ6IHN0cmluZ30+LCBsb2NrczogQXJyYXk8e2luZGV4RmluZ2VycHJpbnQ6IHN0cmluZywgbG9ja01vZGU6IHN0cmluZywgc3RhdGU6IHN0cmluZywgdGFibGVGaW5nZXJwcmludDogc3RyaW5nfT4sIG9yZGluYWw6IG51bWJlcn0+LCB0cmFuc2FjdGlvbk5vZGVzVHJ1bmNhdGVkOiBib29sZWFuLCB0cmFuc2FjdGlvbnM6IG51bWJlciwgdmljdGltVHJhbnNhY3Rpb246IG51bWJlciB8IG51bGx9fSAtIFN0cnVjdHVyYWwgZGVhZGxvY2sgc3VtbWFyeS5cbiAgICovXG4gIF9pbm5vZGJEZWFkbG9ja1N1bW1hcnkoc3RhdHVzKSB7XG4gICAgcmV0dXJuIHBhcnNlSW5ub2RiRGVhZGxvY2tTdW1tYXJ5KHN0YXR1cylcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHF1ZXJ5IGFjdHVhbC5cbiAgICogQHBhcmFtIHtzdHJpbmd9IHNxbCAtIFNRTCBzdHJpbmcuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vYmFzZS5qc1wiKS5RdWVyeU9wdGlvbnN9IFtvcHRpb25zXSAtIFF1ZXJ5IG9wdGlvbnMgKGNhcnJpZXMgdGhlIG9wdGlvbmFsIGFib3J0IHNpZ25hbCkuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPGltcG9ydChcIi4uL2Jhc2UuanNcIikuUXVlcnlSZXN1bHRUeXBlPn0gLSBSZXNvbHZlcyB3aXRoIHRoZSBxdWVyeSBhY3R1YWwuXG4gICAqL1xuICBhc3luYyBfcXVlcnlBY3R1YWwoc3FsLCBvcHRpb25zID0ge30pIHtcbiAgICBpZiAoIXRoaXMucG9vbCkgYXdhaXQgdGhpcy5jb25uZWN0KClcbiAgICBpZiAoIXRoaXMucG9vbCkgdGhyb3cgbmV3IEVycm9yKFwiTXlTUUwgcG9vbCBmYWlsZWQgdG8gaW5pdGlhbGl6ZVwiKVxuXG4gICAgdHJ5IHtcbiAgICAgIHJldHVybiBhd2FpdCBxdWVyeSh0aGlzLnBvb2wsIHNxbCwge3NpZ25hbDogb3B0aW9ucy5zaWduYWx9KVxuICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICAvLyBQcmVzZXJ2ZSBhbiBhYm9ydCBhcy1pcyBzbyB0aGUgcmV0cnkgbG9vcCBjYW4gcmVjb2duaXNlIGl0IGFzIHRlcm1pbmFsXG4gICAgICAvLyAod3JhcHBpbmcgaXQgaW4gYSBwbGFpbiBFcnJvciB3b3VsZCBsb3NlIHRoZSBRdWVyeUFib3J0ZWRFcnJvciB0eXBlKS5cbiAgICAgIGlmIChlcnJvciBpbnN0YW5jZW9mIFF1ZXJ5QWJvcnRlZEVycm9yKSB7XG4gICAgICAgIGlmIChlcnJvci5jb25uZWN0aW9uRGVzdHJveWVkKSB0aGlzLnJlc2V0Q3VycmVudFNlc3Npb25UaW1lWm9uZSgpXG4gICAgICAgIHRocm93IGVycm9yXG4gICAgICB9XG5cbiAgICAgIC8vIFJlLXRocm93IHRvIHVuLWNvcnJ1cHQgc3RhY2t0cmFjZVxuICAgICAgaWYgKGVycm9yIGluc3RhbmNlb2YgRXJyb3IpIHtcbiAgICAgICAgdGhyb3cgbmV3IEVycm9yKGBRdWVyeSBmYWlsZWQ6ICR7ZXJyb3IubWVzc2FnZX1gLCB7Y2F1c2U6IGVycm9yfSlcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIHRocm93IG5ldyBFcnJvcihgUXVlcnkgZmFpbGVkOiAke2Vycm9yfWAsIHtjYXVzZTogZXJyb3J9KVxuICAgICAgfVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBTdHJlYW1zIHRoZSByb3dzIG9mIGBzcWxgIGZyb20gYSBkZWRpY2F0ZWQgcG9vbGVkIGNvbm5lY3Rpb24gdXNpbmcgdGhlIE15U1FMIGN1cnNvciwgc28gYVxuICAgKiBsYXJnZSByZXN1bHQgc2V0IGlzIHJlYWQgaW5jcmVtZW50YWxseSBpbnN0ZWFkIG9mIGJlaW5nIGJ1ZmZlcmVkLiBPdmVycmlkZXMgdGhlIGJhc2VcbiAgICogYnVmZmVyZWQgZmFsbGJhY2sgd2l0aCB0cnVlIHNlcnZlci1zaWRlIHN0cmVhbWluZy5cbiAgICogQHBhcmFtIHtzdHJpbmd9IHNxbCAtIFNRTCBzdHJpbmcgdG8gc3RyZWFtLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL2Jhc2UuanNcIikuUXVlcnlPcHRpb25zfSBbb3B0aW9uc10gLSBRdWVyeSBvd25lcnNoaXAgb3B0aW9ucy5cbiAgICogQHlpZWxkcyB7UmVjb3JkPHN0cmluZywgdW5rbm93bj59IC0gVGhlIHJlc3VsdCByb3dzLCBvbmUgYXQgYSB0aW1lLlxuICAgKi9cbiAgYXN5bmMgKnF1ZXJ5U3RyZWFtKHNxbCwgb3B0aW9ucyA9IHt9KSB7XG4gICAgYXdhaXQgdGhpcy5fd2FpdEZvck9wZXJhdGlvbkxlYXNlKG9wdGlvbnMub3BlcmF0aW9uT3duZXIpXG5cbiAgICBpZiAoIXRoaXMucG9vbCkgYXdhaXQgdGhpcy5jb25uZWN0KClcbiAgICBpZiAoIXRoaXMucG9vbCkgdGhyb3cgbmV3IEVycm9yKFwiTXlTUUwgcG9vbCBmYWlsZWQgdG8gaW5pdGlhbGl6ZVwiKVxuXG4gICAgY29uc3QgcHJvZmlsZUF0dGVtcHQgPSB0aGlzLl9zdGFydFByb2ZpbGVkUXVlcnlBdHRlbXB0KHNxbClcbiAgICBsZXQgZmFpbGVkID0gdHJ1ZVxuXG4gICAgdHJ5IHtcbiAgICAgIHlpZWxkKiBzdHJlYW1RdWVyeSh0aGlzLnBvb2wsIHNxbClcbiAgICAgIGZhaWxlZCA9IGZhbHNlXG4gICAgfSBmaW5hbGx5IHtcbiAgICAgIHRoaXMuX2ZpbmlzaFByb2ZpbGVkUXVlcnlBdHRlbXB0KHByb2ZpbGVBdHRlbXB0LCBmYWlsZWQpXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIEV4ZWN1dGVzIGEgbXV0YXRpb24gd2l0aCBhZmZlY3RlZC1yb3cgbWV0YWRhdGEuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBzcWwgLSBNdXRhdGlvbiBTUUwuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPG51bWJlcj59IC0gQWZmZWN0ZWQgcm93IGNvdW50LlxuICAgKi9cbiAgYXN5bmMgX2FmZmVjdGVkUm93c0FjdHVhbChzcWwpIHtcbiAgICBpZiAoIXRoaXMucG9vbCkgYXdhaXQgdGhpcy5jb25uZWN0KClcbiAgICBpZiAoIXRoaXMucG9vbCkgdGhyb3cgbmV3IEVycm9yKFwiTXlTUUwgcG9vbCBmYWlsZWQgdG8gaW5pdGlhbGl6ZVwiKVxuICAgIGNvbnN0IHBvb2wgPSB0aGlzLnBvb2xcblxuICAgIHJldHVybiBhd2FpdCBuZXcgUHJvbWlzZSgocmVzb2x2ZSwgcmVqZWN0KSA9PiB7XG4gICAgICBwb29sLnF1ZXJ5KHNxbCwgKGVycm9yLCByZXN1bHQpID0+IHtcbiAgICAgICAgaWYgKGVycm9yKSByZWplY3QoZXJyb3IpXG4gICAgICAgIGVsc2UgcmVzb2x2ZShcImFmZmVjdGVkUm93c1wiIGluIHJlc3VsdCA/IHJlc3VsdC5hZmZlY3RlZFJvd3MgOiAwKVxuICAgICAgfSlcbiAgICB9KVxuICB9XG5cbiAgLyoqXG4gICAqIEV4ZWN1dGVzIGEgZnVsbCBtdWx0aS1zdGF0ZW1lbnQgc3RydWN0dXJlIFNRTCBzY3JpcHQgaW4gb25lIHJvdW5kLXRyaXAgd2hlbiB0aGVcbiAgICogY29ubmVjdGlvbiB3YXMgY29uZmlndXJlZCB3aXRoIGBtdWx0aXBsZVN0YXRlbWVudHM6IHRydWVgLiBSdW5zIG9uIHRoZSBwb29sZWRcbiAgICogY29ubmVjdGlvbiBzbyB0aGUgY2FsbGVyJ3MgYFNFVCBGT1JFSUdOX0tFWV9DSEVDS1MgPSAwYCBhcHBsaWVzLiBSZXR1cm5zIGZhbHNlIHNvXG4gICAqIHRoZSBjYWxsZXIgcnVucyBzdGF0ZW1lbnRzIGluZGl2aWR1YWxseSB3aGVuIG11bHRpLXN0YXRlbWVudCBxdWVyaWVzIGFyZSBvZmYuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBzdHJ1Y3R1cmVTcWwgLSBGdWxsIG11bHRpLXN0YXRlbWVudCBzdHJ1Y3R1cmUgU1FMLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxib29sZWFuPn0gLSBXaGV0aGVyIHRoZSBzY3JpcHQgd2FzIGV4ZWN1dGVkIGFzIG9uZSBiYXRjaC5cbiAgICovXG4gIGFzeW5jIGV4ZWNTdHJ1Y3R1cmVTY3JpcHQoc3RydWN0dXJlU3FsKSB7XG4gICAgaWYgKCF0aGlzLmdldEFyZ3MoKS5tdWx0aXBsZVN0YXRlbWVudHMpIHJldHVybiBmYWxzZVxuXG4gICAgLy8gVGhlIGJhdGNoZWQgcG9vbCBjYWxsIGJlbG93IGJ5cGFzc2VzIEJhc2UjcXVlcnksIHNvIHJlLXJ1biB0aGUgc2FtZSByZWFkLW9ubHlcbiAgICAvLyB3cml0ZSBndWFyZCB0aGUgcGVyLXN0YXRlbWVudCBwYXRoIGFwcGxpZXMgYmVmb3JlIGV4ZWN1dGluZyB0aGUgZHVtcC5cbiAgICB0aGlzLl9hc3NlcnRXcml0YWJsZVF1ZXJ5KHN0cnVjdHVyZVNxbClcblxuICAgIGlmICghdGhpcy5wb29sKSBhd2FpdCB0aGlzLmNvbm5lY3QoKVxuICAgIGlmICghdGhpcy5wb29sKSB0aHJvdyBuZXcgRXJyb3IoXCJNeVNRTCBwb29sIGZhaWxlZCB0byBpbml0aWFsaXplXCIpXG5cbiAgICBjb25zdCBwb29sID0gdGhpcy5wb29sXG4gICAgY29uc3QgcHJvZmlsZUF0dGVtcHQgPSB0aGlzLl9zdGFydFByb2ZpbGVkUXVlcnlBdHRlbXB0KHN0cnVjdHVyZVNxbClcbiAgICBsZXQgZmFpbGVkID0gdHJ1ZVxuXG4gICAgdHJ5IHtcbiAgICAgIGF3YWl0IG5ldyBQcm9taXNlKChyZXNvbHZlLCByZWplY3QpID0+IHtcbiAgICAgICAgcG9vbC5xdWVyeShzdHJ1Y3R1cmVTcWwsIChlcnJvcikgPT4ge1xuICAgICAgICAgIGlmIChlcnJvcikgcmVqZWN0KGVycm9yKVxuICAgICAgICAgIGVsc2UgcmVzb2x2ZSh1bmRlZmluZWQpXG4gICAgICAgIH0pXG4gICAgICB9KVxuICAgICAgZmFpbGVkID0gZmFsc2VcbiAgICB9IGZpbmFsbHkge1xuICAgICAgdGhpcy5fZmluaXNoUHJvZmlsZWRRdWVyeUF0dGVtcHQocHJvZmlsZUF0dGVtcHQsIGZhaWxlZClcbiAgICB9XG5cbiAgICByZXR1cm4gdHJ1ZVxuICB9XG5cbiAgLyoqXG4gICAqIFVzZXMgb25lIG11bHRpLXN0YXRlbWVudCByZXF1ZXN0IG9ubHkgd2hlbiB0aGUgZXhpc3RpbmcgY29ubmVjdGlvbiBvcHRpb25cbiAgICogZXhwbGljaXRseSBhbGxvd3MgaXQ7IG90aGVyd2lzZSByZXRhaW5zIHRoZSBiYXNlIHNlcXVlbnRpYWwgYmVoYXZpb3IuXG4gICAqIEBwYXJhbSB7QXJyYXk8aW1wb3J0KFwiLi4vYmFzZS10YWJsZS5qc1wiKS5kZWZhdWx0Pn0gdGFibGVzIC0gRWxpZ2libGUgdGFibGVzLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyB3aGVuIGV2ZXJ5IHRhYmxlIGhhcyBiZWVuIHRydW5jYXRlZC5cbiAgICovXG4gIGFzeW5jIHRydW5jYXRlVGFibGVzKHRhYmxlcykge1xuICAgIGlmICghdGhpcy5nZXRBcmdzKCkubXVsdGlwbGVTdGF0ZW1lbnRzKSB7XG4gICAgICBhd2FpdCBzdXBlci50cnVuY2F0ZVRhYmxlcyh0YWJsZXMpXG4gICAgICByZXR1cm5cbiAgICB9XG5cbiAgICBjb25zdCBzdGF0ZW1lbnRzID0gdGFibGVzLm1hcCgodGFibGUpID0+IGBUUlVOQ0FURSBUQUJMRSAke3RoaXMucXVvdGVUYWJsZSh0YWJsZS5nZXROYW1lKCkpfWApXG5cbiAgICBhd2FpdCB0aGlzLnF1ZXJ5KHN0YXRlbWVudHMuam9pbihcIjtcXG5cIikpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBxdWVyeSB0byBzcWwuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vLi4vcXVlcnkvaW5kZXguanNcIikuZGVmYXVsdH0gcXVlcnkgLSBRdWVyeSBpbnN0YW5jZS5cbiAgICogQHJldHVybnMge3N0cmluZ30gLSBTUUwgc3RyaW5nLlxuICAgKi9cbiAgcXVlcnlUb1NxbChxdWVyeSkgeyByZXR1cm4gbmV3IFF1ZXJ5UGFyc2VyKHtxdWVyeX0pLnRvU3FsKCkgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHNob3VsZCBzZXQgYXV0byBpbmNyZW1lbnQgd2hlbiBwcmltYXJ5IGtleS5cbiAgICogQHJldHVybnMge2Jvb2xlYW59IC0gV2hldGhlciBzZXQgYXV0byBpbmNyZW1lbnQgd2hlbiBwcmltYXJ5IGtleS5cbiAgICovXG4gIHNob3VsZFNldEF1dG9JbmNyZW1lbnRXaGVuUHJpbWFyeUtleSgpIHsgcmV0dXJuIHRydWUgfVxuICBzdXBwb3J0c0RlZmF1bHRQcmltYXJ5S2V5VVVJRCgpIHsgcmV0dXJuIGZhbHNlIH1cbiAgc3VwcG9ydHNDcm9zc0RhdGFiYXNlUmVmZXJlbmNlcygpIHsgcmV0dXJuIHRydWUgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGVzY2FwZS5cbiAgICogQHBhcmFtIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gdmFsdWUgLSBWYWx1ZSB0byB1c2UuXG4gICAqIEByZXR1cm5zIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gLSBUaGUgZXNjYXBlLlxuICAgKi9cbiAgZXNjYXBlKHZhbHVlKSB7XG4gICAgY29uc3QgZXNjYXBlZFZhbHVlV2l0aFF1b3RlcyA9IHRoaXMucG9vbFxuICAgICAgPyB0aGlzLnBvb2wuZXNjYXBlKHRoaXMuX2NvbnZlcnRWYWx1ZSh2YWx1ZSkpXG4gICAgICA6IG15c3FsLmVzY2FwZSh0aGlzLl9jb252ZXJ0VmFsdWUodmFsdWUpKVxuXG4gICAgcmV0dXJuIGVzY2FwZWRWYWx1ZVdpdGhRdW90ZXMuc2xpY2UoMSwgZXNjYXBlZFZhbHVlV2l0aFF1b3Rlcy5sZW5ndGggLSAxKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgcXVvdGUuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSB2YWx1ZSAtIFZhbHVlIHRvIHVzZS5cbiAgICogQHJldHVybnMge3N0cmluZ30gLSBUaGUgcXVvdGUuXG4gICAqL1xuICBxdW90ZSh2YWx1ZSkge1xuICAgIGlmICh0aGlzLnBvb2wpIHtcbiAgICAgIHJldHVybiB0aGlzLnBvb2wuZXNjYXBlKHRoaXMuX2NvbnZlcnRWYWx1ZSh2YWx1ZSkpXG4gICAgfVxuXG4gICAgcmV0dXJuIG15c3FsLmVzY2FwZSh0aGlzLl9jb252ZXJ0VmFsdWUodmFsdWUpKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZGVsZXRlIHNxbC5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9iYXNlLmpzXCIpLkRlbGV0ZVNxbEFyZ3NUeXBlfSBhcmdzIC0gT3B0aW9ucyBvYmplY3QuXG4gICAqIEByZXR1cm5zIHtzdHJpbmd9IC0gU1FMIHN0cmluZy5cbiAgICovXG4gIGRlbGV0ZVNxbCh7dGFibGVOYW1lLCBjb25kaXRpb25zfSkge1xuICAgIGNvbnN0IGRlbGV0ZUluc3RydWN0aW9uID0gbmV3IERlbGV0ZSh7Y29uZGl0aW9ucywgZHJpdmVyOiB0aGlzLCB0YWJsZU5hbWV9KVxuXG4gICAgcmV0dXJuIGRlbGV0ZUluc3RydWN0aW9uLnRvU3FsKClcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGluc2VydCBzcWwuXG4gICAqIEBhYnN0cmFjdFxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL2Jhc2UuanNcIikuSW5zZXJ0U3FsQXJnc1R5cGV9IGFyZ3MgLSBPcHRpb25zIG9iamVjdC5cbiAgICogQHJldHVybnMge3N0cmluZ30gLSBTUUwgc3RyaW5nLlxuICAgKi9cbiAgaW5zZXJ0U3FsKGFyZ3MpIHtcbiAgICBjb25zdCBpbnNlcnRBcmdzID0gT2JqZWN0LmFzc2lnbih7ZHJpdmVyOiB0aGlzfSwgYXJncylcbiAgICBjb25zdCBpbnNlcnQgPSBuZXcgSW5zZXJ0KGluc2VydEFyZ3MpXG5cbiAgICByZXR1cm4gaW5zZXJ0LnRvU3FsKClcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGdldCB0YWJsZXMuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPEFycmF5PGltcG9ydChcIi4uL2Jhc2UtdGFibGUuanNcIikuZGVmYXVsdD4+fSAtIFJlc29sdmVzIHdpdGggdGhlIHRhYmxlcy5cbiAgICovXG4gIGFzeW5jIGdldFRhYmxlcygpIHtcbiAgICByZXR1cm4gYXdhaXQgdGhpcy5fY2FjaGVkU2NoZW1hTWV0YWRhdGEoXCJ0YWJsZXNcIiwgYXN5bmMgKCkgPT4ge1xuICAgICAgY29uc3QgcmVzdWx0ID0gYXdhaXQgdGhpcy5xdWVyeShcIlNIT1cgRlVMTCBUQUJMRVNcIilcbiAgICAgIGNvbnN0IHRhYmxlcyA9IFtdXG5cbiAgICAgIGZvciAoY29uc3Qgcm93IG9mIHJlc3VsdCkge1xuICAgICAgICBjb25zdCB0YWJsZSA9IG5ldyBUYWJsZSh0aGlzLCAvKiogQHR5cGUge1JlY29yZDxzdHJpbmcsIHN0cmluZz59ICovIChyb3cpKVxuXG4gICAgICAgIHRhYmxlcy5wdXNoKHRhYmxlKVxuICAgICAgfVxuXG4gICAgICByZXR1cm4gdGFibGVzXG4gICAgfSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHN0cnVjdHVyZSBzcWwuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHN0cmluZyB8IG51bGw+fSAtIFJlc29sdmVzIHdpdGggU1FMIHN0cmluZy5cbiAgICovXG4gIGFzeW5jIHN0cnVjdHVyZVNxbCgpIHtcbiAgICByZXR1cm4gYXdhaXQgdGhpcy5fY2FjaGVkU2NoZW1hTWV0YWRhdGEoXCJzdHJ1Y3R1cmVTcWxcIiwgYXN5bmMgKCkgPT4gYXdhaXQgbmV3IFN0cnVjdHVyZVNxbCh7ZHJpdmVyOiB0aGlzfSkudG9TcWwoKSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGxhc3QgaW5zZXJ0IGlkLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL2Jhc2UuanNcIikuUXVlcnlPcHRpb25zfSBbb3B0aW9uc10gLSBRdWVyeSBvd25lcnNoaXAgb3B0aW9ucy5cbiAgICogQHJldHVybnMge1Byb21pc2U8bnVtYmVyPn0gLSBSZXNvbHZlcyB3aXRoIHRoZSBsYXN0IGluc2VydCBpZC5cbiAgICovXG4gIGFzeW5jIGxhc3RJbnNlcnRJRChvcHRpb25zID0ge30pIHtcbiAgICBjb25zdCByZXN1bHQgPSBhd2FpdCB0aGlzLnF1ZXJ5KFwiU0VMRUNUIExBU1RfSU5TRVJUX0lEKCkgQVMgbGFzdF9pbnNlcnRfaWRcIiwgb3B0aW9ucylcblxuICAgIHJldHVybiBkaWdnKHJlc3VsdCwgMCwgXCJsYXN0X2luc2VydF9pZFwiKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgb3B0aW9ucy5cbiAgICogQHJldHVybnMge09wdGlvbnN9IC0gVGhlIG9wdGlvbnMgb3B0aW9ucy5cbiAgICovXG4gIG9wdGlvbnMoKSB7XG4gICAgaWYgKCF0aGlzLl9vcHRpb25zKSB0aGlzLl9vcHRpb25zID0gbmV3IE9wdGlvbnMoe2RyaXZlcjogdGhpc30pXG5cbiAgICByZXR1cm4gdGhpcy5fb3B0aW9uc1xuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgc3RhcnQgdHJhbnNhY3Rpb24gYWN0aW9uLlxuICAgKiBAcGFyYW0ge1BpY2s8aW1wb3J0KFwiLi4vYmFzZS5qc1wiKS5RdWVyeU9wdGlvbnMsIFwib3BlcmF0aW9uT3duZXJcIj59IFtvcHRpb25zXSAtIFRyYW5zYWN0aW9uIG93bmVyc2hpcC5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgd2hlbiBjb21wbGV0ZS5cbiAgICovXG4gIGFzeW5jIF9zdGFydFRyYW5zYWN0aW9uQWN0aW9uKG9wdGlvbnMgPSB7fSkge1xuICAgIGF3YWl0IHRoaXMucXVlcnkoXCJTVEFSVCBUUkFOU0FDVElPTlwiLCBvcHRpb25zKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgdXBkYXRlIHNxbC5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9iYXNlLmpzXCIpLlVwZGF0ZVNxbEFyZ3NUeXBlfSBhcmdzIC0gT3B0aW9ucyBvYmplY3QuXG4gICAqIEByZXR1cm5zIHtzdHJpbmd9IC0gU1FMIHN0cmluZy5cbiAgICovXG4gIHVwZGF0ZVNxbCh7Y29uZGl0aW9ucywgZGF0YSwgdGFibGVOYW1lfSkge1xuICAgIGNvbnN0IHVwZGF0ZSA9IG5ldyBVcGRhdGUoe2NvbmRpdGlvbnMsIGRhdGEsIGRyaXZlcjogdGhpcywgdGFibGVOYW1lfSlcblxuICAgIHJldHVybiB1cGRhdGUudG9TcWwoKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgdXBzZXJ0IHNxbC5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9iYXNlLmpzXCIpLlVwc2VydFNxbEFyZ3NUeXBlfSBhcmdzIC0gT3B0aW9ucyBvYmplY3QuXG4gICAqIEByZXR1cm5zIHtzdHJpbmd9IC0gU1FMIHN0cmluZy5cbiAgICovXG4gIHVwc2VydFNxbChhcmdzKSB7XG4gICAgY29uc3QgdXBzZXJ0ID0gbmV3IFVwc2VydCh7Li4uYXJncywgZHJpdmVyOiB0aGlzfSlcblxuICAgIHJldHVybiB1cHNlcnQudG9TcWwoKVxuICB9XG5cbiAgLyoqXG4gICAqIEJsb2NrcyB1bnRpbCBhIE15U1FML01hcmlhREIgdXNlci1sZXZlbCBsb2NrIGlzIGFjcXVpcmVkIG9uIHRoaXNcbiAgICogY29ubmVjdGlvbi4gSW1wbGVtZW50ZWQgdmlhIGBHRVRfTE9DSyhuYW1lLCB0aW1lb3V0KWAsIHdoZXJlIHRoZVxuICAgKiB0aW1lb3V0IGlzIGluIHNlY29uZHMuXG4gICAqXG4gICAqIE15U1FMIGhpc3RvcmljYWxseSBkb2N1bWVudGVkIGEgbmVnYXRpdmUgdGltZW91dCBhcyBcImluZmluaXRlXCIsXG4gICAqIGJ1dCBNYXJpYURCIDEwKyBzaWxlbnRseSByZWplY3RzIG5lZ2F0aXZlIHRpbWVvdXRzIGFuZCByZXR1cm5zXG4gICAqIGBOVUxMYCBmcm9tIGBHRVRfTE9DS2AuIFRvIG1ha2UgdGhlIGhlbHBlciBwb3J0YWJsZSBhY3Jvc3MgTXlTUUxcbiAgICogYW5kIE1hcmlhREIgdGhlIFwiaW5kZWZpbml0ZVwiIGNhc2UgaXMgZW5jb2RlZCBhcyBhIGxhcmdlIHBvc2l0aXZlXG4gICAqIHRpbWVvdXQgKG9uZSB5ZWFyKSwgd2hpY2ggaXMgY29tZm9ydGFibHkgbG9uZ2VyIHRoYW4gYW55XG4gICAqIHJlYWxpc3RpYyBjcml0aWNhbCBzZWN0aW9uIGFuZCB3b3JrcyBvbiBldmVyeSBzdXBwb3J0ZWQgdmVyc2lvbi5cbiAgICogQHBhcmFtIHtzdHJpbmd9IG5hbWUgLSBMb2NrIG5hbWUuXG4gICAqIEBwYXJhbSB7e3RpbWVvdXRNcz86IG51bWJlciB8IG51bGx9fSBbYXJnc10gLSBPcHRpb25hbCB0aW1lb3V0IGluIG1pbGxpc2Vjb25kczsgYG51bGxgLCBgdW5kZWZpbmVkYCwgb3IgbmVnYXRpdmUgYmxvY2tzIGZvciBgTVlTUUxfSU5ERUZJTklURV9MT0NLX1RJTUVPVVRfU0VDT05EU2AuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPGJvb2xlYW4+fSAtIFRydWUgaWYgYWNxdWlyZWQsIGZhbHNlIGlmIHRoZSB0aW1lb3V0IGVsYXBzZWQuXG4gICAqL1xuICBhc3luYyBfYWNxdWlyZUFkdmlzb3J5TG9jayhuYW1lLCB7dGltZW91dE1zfSA9IHt9KSB7XG4gICAgY29uc3QgdGltZW91dFNlY29uZHMgPSB0eXBlb2YgdGltZW91dE1zID09PSBcIm51bWJlclwiICYmIHRpbWVvdXRNcyA+PSAwXG4gICAgICA/IE1hdGguY2VpbCh0aW1lb3V0TXMgLyAxMDAwKVxuICAgICAgOiBNWVNRTF9JTkRFRklOSVRFX0xPQ0tfVElNRU9VVF9TRUNPTkRTXG4gICAgY29uc3Qgcm93cyA9IGF3YWl0IHRoaXMucXVlcnkoYFNFTEVDVCBHRVRfTE9DSygke3RoaXMucXVvdGUobmFtZSl9LCAke3RpbWVvdXRTZWNvbmRzfSkgQVMgdmVsb2Npb3VzX2Fkdmlzb3J5X2xvY2tfcmVzdWx0YClcbiAgICBjb25zdCByZXN1bHQgPSByb3dzPy5bMF0/LnZlbG9jaW91c19hZHZpc29yeV9sb2NrX3Jlc3VsdFxuXG4gICAgaWYgKHJlc3VsdCA9PT0gbnVsbCB8fCByZXN1bHQgPT09IHVuZGVmaW5lZCkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKGBHRVRfTE9DSyByZXR1cm5lZCBOVUxMIGZvciBhZHZpc29yeSBsb2NrICR7SlNPTi5zdHJpbmdpZnkobmFtZSl9ICh0eXBpY2FsbHkgYW4gb3V0LW9mLW1lbW9yeSBvciB0aHJlYWQta2lsbGVkIGNvbmRpdGlvbilgKVxuICAgIH1cblxuICAgIHJldHVybiBOdW1iZXIocmVzdWx0KSA9PT0gMVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgdHJ5IGFjcXVpcmUgYWR2aXNvcnkgbG9jay5cbiAgICogQHBhcmFtIHtzdHJpbmd9IG5hbWUgLSBMb2NrIG5hbWUuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPGJvb2xlYW4+fSAtIFRydWUgaWYgdGhlIGxvY2sgd2FzIGFjcXVpcmVkLCBmYWxzZSBpZiBpdCB3YXMgYWxyZWFkeSBoZWxkLlxuICAgKi9cbiAgYXN5bmMgX3RyeUFjcXVpcmVBZHZpc29yeUxvY2sobmFtZSkge1xuICAgIGNvbnN0IHJvd3MgPSBhd2FpdCB0aGlzLnF1ZXJ5KGBTRUxFQ1QgR0VUX0xPQ0soJHt0aGlzLnF1b3RlKG5hbWUpfSwgMCkgQVMgdmVsb2Npb3VzX2Fkdmlzb3J5X2xvY2tfcmVzdWx0YClcbiAgICBjb25zdCByZXN1bHQgPSByb3dzPy5bMF0/LnZlbG9jaW91c19hZHZpc29yeV9sb2NrX3Jlc3VsdFxuXG4gICAgaWYgKHJlc3VsdCA9PT0gbnVsbCB8fCByZXN1bHQgPT09IHVuZGVmaW5lZCkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKGBHRVRfTE9DSyByZXR1cm5lZCBOVUxMIGZvciBhZHZpc29yeSBsb2NrICR7SlNPTi5zdHJpbmdpZnkobmFtZSl9ICh0eXBpY2FsbHkgYW4gb3V0LW9mLW1lbW9yeSBvciB0aHJlYWQta2lsbGVkIGNvbmRpdGlvbilgKVxuICAgIH1cblxuICAgIHJldHVybiBOdW1iZXIocmVzdWx0KSA9PT0gMVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgcmVsZWFzZSBhZHZpc29yeSBsb2NrLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gbmFtZSAtIExvY2sgbmFtZS5cbiAgICogQHJldHVybnMge1Byb21pc2U8Ym9vbGVhbj59IC0gVHJ1ZSBpZiB0aGUgbG9jayB3YXMgaGVsZCBieSB0aGlzIHNlc3Npb24gYW5kIGhhcyBub3cgYmVlbiByZWxlYXNlZC5cbiAgICovXG4gIGFzeW5jIF9yZWxlYXNlQWR2aXNvcnlMb2NrKG5hbWUpIHtcbiAgICBjb25zdCByb3dzID0gYXdhaXQgdGhpcy5xdWVyeShgU0VMRUNUIFJFTEVBU0VfTE9DSygke3RoaXMucXVvdGUobmFtZSl9KSBBUyB2ZWxvY2lvdXNfYWR2aXNvcnlfbG9ja19yZXN1bHRgLCB7cmV0cnk6IGZhbHNlfSlcbiAgICBjb25zdCByZXN1bHQgPSByb3dzPy5bMF0/LnZlbG9jaW91c19hZHZpc29yeV9sb2NrX3Jlc3VsdFxuXG4gICAgcmV0dXJuIE51bWJlcihyZXN1bHQpID09PSAxXG4gIH1cblxuICAvKipcbiAgICogUnVucyBpcyBhZHZpc29yeSBsb2NrIGhlbGQuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBuYW1lIC0gTG9jayBuYW1lLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxib29sZWFuPn0gLSBUcnVlIGlmIGFueSBzZXNzaW9uIGN1cnJlbnRseSBob2xkcyB0aGUgbG9jay5cbiAgICovXG4gIGFzeW5jIGlzQWR2aXNvcnlMb2NrSGVsZChuYW1lKSB7XG4gICAgY29uc3Qgcm93cyA9IGF3YWl0IHRoaXMucXVlcnkoYFNFTEVDVCBJU19VU0VEX0xPQ0soJHt0aGlzLnF1b3RlKG5hbWUpfSkgQVMgdmVsb2Npb3VzX2Fkdmlzb3J5X2xvY2tfaG9sZGVyYClcbiAgICBjb25zdCBob2xkZXIgPSByb3dzPy5bMF0/LnZlbG9jaW91c19hZHZpc29yeV9sb2NrX2hvbGRlclxuXG4gICAgcmV0dXJuIGhvbGRlciAhPT0gbnVsbCAmJiBob2xkZXIgIT09IHVuZGVmaW5lZFxuICB9XG59XG4iXX0=