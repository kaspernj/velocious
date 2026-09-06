// @ts-check
/**
 * CreateIndexSqlArgs type.
 * @typedef {object} CreateIndexSqlArgs
 * @property {Array<string | import("./../table-data/table-column.js").default>} columns - Columns to include in the index.
 * @property {boolean} [ifNotExists] - Skip creation if the index already exists.
 * @property {string} [name] - Explicit index name to use.
 * @property {boolean} [unique] - Whether the index should enforce uniqueness.
 * @property {string} tableName - Name of the table to add the index to.
 */
/**
 * RemoveIndexSqlArgs type.
 * @typedef {object} RemoveIndexSqlArgs
 * @property {string} name - Index name to drop.
 * @property {string} tableName - Name of the table the index belongs to.
 */
/**
 * DropTableSqlArgsType type.
 * @typedef {object} DropTableSqlArgsType
 * @property {boolean} [cascade] - Whether dependent objects should be dropped too.
 * @property {boolean} [ifExists] - Skip dropping if the table does not exist.
 */
/**
 * DeleteSqlArgsType type.
 * @typedef {object} DeleteSqlArgsType
 * @property {string} tableName - Table name to delete from.
 * @property {{[key: string]: ReturnType<typeof JSON.parse>}} conditions - Conditions used to build the delete WHERE clause.
 */
/**
 * InsertSqlArgsType type.
 * @typedef {object} InsertSqlArgsType
 * @property {string[]} [columns] - Column names for `rows` inserts.
 * @property {{[key: string]: ReturnType<typeof JSON.parse>}} [data] - Column/value pairs for a single-row insert.
 * @property {boolean} [multiple] - Whether this insert should be treated as multi-row.
 * @property {string[]} [returnLastInsertedColumnNames] - Column names to return after insert.
 * @property {Array<Array<ReturnType<typeof JSON.parse>>>} [rows] - Row values for a multi-row insert.
 * @property {string} tableName - Table name to insert into.
 */
/**
 * QueryRowType type.
 * @typedef {Record<string, ReturnType<typeof JSON.parse>>} QueryRowType
 * @typedef {Array<QueryRowType>} QueryResultType
 */
/**
 * TransactionCallbackFrame type.
 * @typedef {object} TransactionCallbackFrame
 * @property {Array<() => void | Promise<void>>} afterCommitCallbacks - Callbacks to merge or run after commit.
 * @property {Array<() => void | Promise<void>>} beforeCommitCallbacks - Guards to run before this frame completes.
 */
/**
 * RetryableDatabaseErrorResult type.
 * @typedef {object} RetryableDatabaseErrorResult
 * @property {boolean} retry - Whether the error should be retried.
 * @property {boolean} reconnect - Whether to reconnect before retrying.
 * @property {boolean} [deadlock] - Whether the error is a transaction deadlock/lock-wait-timeout that should retry the whole transaction.
 * @property {"deadlock" | "lock-wait-timeout"} [contentionKind] - Classified transaction contention kind.
 * @property {number} [maxTries] - Override the max retry attempts.
 * @property {number} [waitMs] - Wait time before retrying in milliseconds.
 */
/**
 * QueryOptions type.
 * @typedef {object} QueryOptions
 * @property {string} [logName] - Query log subject.
 * @property {boolean} [logQuery] - Whether to log the query.
 * @property {boolean} [processListComment] - Whether to add process-list comments to the query.
 * @property {number} [requestTimeoutMs] - Per-request driver timeout in milliseconds; zero disables the deadline on supporting drivers.
 * @property {boolean} [retry] - Whether retryable errors may retry the query; defaults to true.
 * @property {boolean} [sessionTimeZone] - Whether to ensure the configured database session time zone before the query.
 * @property {boolean} [sqliteScript] - Internal SQLite flag selecting native multi-statement script execution.
 * @property {AbortSignal} [signal] - Aborts the in-flight query (destroying its connection) when it fires.
 * @property {string} [sourceStack] - Stack captured at the caller boundary.
 * @property {symbol} [operationOwner] - Opaque owner for an operation-leased connection.
 */
/**
 * DeadlockRetryDiagnosticSnapshot type.
 * @typedef {object} DeadlockRetryDiagnosticSnapshot
 * @property {number} attempt - One-based transaction attempt.
 * @property {"deadlock" | "lock-wait-timeout"} contentionKind - Classified contention kind.
 * @property {string} [databaseIdentifier] - Redacted logical database pool identifier marker.
 * @property {string} [databaseIdentifierFingerprint] - Opaque logical database pool identity.
 * @property {string} [databaseIdentityFingerprint] - Opaque physical database identity.
 * @property {string} driverType - Driver type.
 * @property {number} maxAttempts - Configured transaction attempt budget.
 * @property {string} [operationName] - Redacted operation-name marker.
 * @property {string} [operationNameFingerprint] - Opaque operation-name identity.
 * @property {string} [sqlFingerprint] - Normalized SQL-shape fingerprint.
 * @property {string} [sqlOperation] - SQL verb.
 * @property {string} stage - Error-event stage.
 * @property {number} transactionAttemptDurationMs - Duration of the failed outer attempt.
 * @property {boolean} willRetry - Whether another outer transaction attempt will run.
 */
/**
 * TestProfileQueryAttempt type.
 * @typedef {object} TestProfileQueryAttempt
 * @property {import("../../testing/test-profiler.js").TestProfileAsyncContext} context - Captured async attribution.
 * @property {{sqlFingerprint: string, sqlOperation: string}} diagnostic - Redacted statement diagnostic.
 * @property {number} startedAtMs - Physical attempt start time.
 */
/**
 * ActiveQueryDebugSnapshot type.
 * @typedef {object} ActiveQueryDebugSnapshot
 * @property {string[]} annotations - Database annotations active when the query started.
 * @property {string} logName - Query log name.
 * @property {number} startedAtUnixMs - Query start timestamp.
 * @property {number} runningMs - Query runtime in milliseconds.
 * @property {string} sqlPreview - Truncated SQL preview.
 */
/**
 * DatabaseConnectionDebugSnapshot type.
 * @typedef {object} DatabaseConnectionDebugSnapshot
 * @property {ActiveQueryDebugSnapshot | null} activeQuery - Currently running query, if any.
 * @property {number | undefined} checkedOutAtUnixMs - Checkout start timestamp for active checkouts.
 * @property {number | undefined} checkoutAgeMs - Active checkout age in milliseconds.
 * @property {string | undefined} checkoutName - Human-readable checkout name.
 * @property {string} driverClass - Driver class name.
 * @property {number | undefined} idSeq - Pool checkout ID sequence.
 * @property {number} openTransactions - Number of open transaction frames.
 * @property {number} schemaCacheEntries - Number of cached schema metadata entries.
 */
/**
 * ActiveQueryState type.
 * @typedef {object} ActiveQueryState
 * @property {string[]} annotations - Database annotations active when the query started.
 * @property {string} logName - Query log name.
 * @property {number} startedAtUnixMs - Query start timestamp.
 * @property {string} sqlPreview - Truncated SQL preview.
 */
/**
 * UpdateSqlArgsType type.
 * @typedef {object}UpdateSqlArgsType
 * @property {object} conditions - Conditions used to build the update WHERE clause.
 * @property {object} data - Column/value pairs to update.
 * @property {string} tableName - Table name to update.
 */
/**
 * UpsertSqlArgsType type.
 * @typedef {object}UpsertSqlArgsType
 * @property {string[]} conflictColumns - Columns that define a conflict.
 * @property {object} data - Column/value pairs to insert.
 * @property {string} tableName - Table name to upsert into.
 * @property {string[]} updateColumns - Columns to update on conflict.
 */
/**
 * SqlTokenResult type.
 * @typedef {object} SqlTokenResult
 * @property {boolean} incomplete - Whether the scan hit its bound before finishing trivia/token parsing.
 * @property {string | undefined} token - Lowercased token when parsing completed; undefined when no token was found.
 * @property {number} index - Index immediately after the parsed token or trivia.
 */
import BacktraceCleaner from "../../utils/backtrace-cleaner.js";
import { getDatabaseAnnotations } from "../annotations.js";
import { formatDateForDatabase } from "../datetime-storage.js";
import isDate from "../../utils/is-date.js";
import Logger from "../../logger.js";
import Query from "../query/index.js";
import QueryAbortedError from "../query-aborted-error.js";
import Handler from "../handler.js";
import { utf8ByteLength } from "../../utils/utf8-byte-length.js";
import Mutex from "epic-locks/build/mutex.js";
import UUID from "pure-uuid";
import TableData from "../table-data/index.js";
import TableColumn from "../table-data/table-column.js";
import TableForeignKey from "../table-data/table-foreign-key.js";
import wait from "awaitery/build/wait.js";
import { ensureError, optionalPositiveInteger } from "typanic";
import { coordinateSharedTransactionConnection, runWithoutSharedTransactionCoordinatorOwner } from "../../testing/shared-transaction-connection-coordinator.js";
import { currentTestProfileContext } from "../../testing/test-profile-context.js";
import sha256Hex from "../../utils/sha256-hex.js";
/** Maximum characters inspected when building the debug SQL preview. */
const SQL_PREVIEW_SCAN_LIMIT = 4096;
/** Maximum characters inspected when deciding whether a statement invalidates schema metadata. */
const SCHEMA_INVALIDATION_SCAN_LIMIT = 8192;
/** Maximum checkout-name characters inspected by retry diagnostics. */
const OPERATION_NAME_SCAN_LIMIT = 1024;
const REDACTED_DIAGNOSTIC_LABEL = "[REDACTED]";
/**
 * Builds a non-reversible, stable SQL fingerprint without retaining SQL text. Literal spelling is
 * normalized first so the same statement shape produces the same fingerprint across values.
 * @param {string} sql - SQL to fingerprint.
 * @returns {{sqlFingerprint: string, sqlOperation: string}} - Bounded query diagnostic.
 */
function sqlDiagnostic(sql) {
    let fingerprintInput = "";
    for (let index = 0; index < sql.length;) {
        const character = sql[index];
        const nextCharacter = sql[index + 1];
        if (character == "'" || character == '"') {
            const quote = character;
            fingerprintInput += "?";
            index++;
            while (index < sql.length) {
                if (sql[index] == "\\") {
                    index += 2;
                }
                else if (sql[index] == quote && sql[index + 1] == quote) {
                    index += 2;
                }
                else if (sql[index] == quote) {
                    index++;
                    break;
                }
                else {
                    index++;
                }
            }
        }
        else if (character == "/" && nextCharacter == "*") {
            const commentEnd = sql.indexOf("*/", index + 2);
            fingerprintInput += " ";
            index = commentEnd == -1 ? sql.length : commentEnd + 2;
        }
        else if ((character == "-" && nextCharacter == "-") || character == "#") {
            const lineEnd = sql.indexOf("\n", index + 1);
            fingerprintInput += " ";
            index = lineEnd == -1 ? sql.length : lineEnd + 1;
        }
        else {
            fingerprintInput += character;
            index++;
        }
    }
    const normalized = fingerprintInput
        .replace(/\b(?:0x[0-9a-f]+|\d+(?:\.\d+)?(?:e[+-]?\d+)?)\b/gi, "?")
        .replace(/\s+/g, " ")
        .trim()
        .toLowerCase();
    let hash = 0xcbf29ce484222325n;
    for (let index = 0; index < normalized.length; index++) {
        hash ^= BigInt(normalized.charCodeAt(index));
        hash = BigInt.asUintN(64, hash * 0x100000001b3n);
    }
    const operationMatch = /^([a-z]+)/.exec(normalized);
    return {
        sqlFingerprint: `fnv1a64:${hash.toString(16).padStart(16, "0")}`,
        sqlOperation: operationMatch ? operationMatch[1].toUpperCase() : "UNKNOWN"
    };
}
/**
 * Marks a callback failure that happened after the owning transaction was durably committed.
 * The public transaction boundary unwraps it before deadlock classification.
 */
class VelociousDatabaseAfterCommitCallbackError extends Error {
    /**
     * Runs constructor.
     * @param {ReturnType<typeof JSON.parse>} callbackError - Original callback failure.
     */
    constructor(callbackError) {
        super("Database afterCommit callback failed");
        this.callbackError = callbackError;
    }
}
/**
 * Runs now ms.
 * @returns {number} - Current high-resolution-ish timestamp in milliseconds.
 */
function nowMs() {
    if (globalThis.performance && typeof globalThis.performance.now == "function") {
        return globalThis.performance.now();
    }
    return Date.now();
}
/**
 * Runs format elapsed ms.
 * @param {number} elapsedMs - Elapsed milliseconds.
 * @returns {string} - Formatted elapsed milliseconds.
 */
function formatElapsedMs(elapsedMs) {
    return `${Math.max(elapsedMs, 0).toFixed(1)}ms`;
}
export default class VelociousDatabaseDriversBase {
    /**
     * Id seq.
     * @type {number | undefined} */
    idSeq = undefined;
    /**
     * Narrows the runtime value to the documented type.
     * @type {TransactionCallbackFrame[]} */
    _transactionCallbackFrames;
    /** @type {Promise<void>} */
    _transactionCompletionPromise;
    /** @type {(() => void) | undefined} */
    _resolveTransactionCompletion;
    /**
     * Narrows the runtime value to the documented type.
     * @type {Map<string, Promise<ReturnType<typeof JSON.parse>>>} */
    _schemaCache;
    /**
     * Narrows the runtime value to the documented type.
     * @type {(() => void) | undefined} */
    _schemaCacheInvalidator;
    /**
     * Narrows the runtime value to the documented type.
     * @type {string | undefined} */
    _connectionCheckoutName;
    /** @type {string | undefined} */
    _databaseIdentifier;
    /** @type {string | undefined} */
    _databaseIdentityFingerprint;
    /**
     * Active query.
     * @type {ActiveQueryState | null} */
    _activeQuery = null;
    /** @type {WeakMap<Error, {sqlFingerprint: string, sqlOperation: string}>} */
    _failedQueryDiagnostics = new WeakMap();
    /** @type {Map<string, number>} */
    _heldAdvisoryLocks = new Map();
    /**
     * Exclusive operation lease installed by a single-multi-use pool.
     * @type {import("../operation-lease.js").default | undefined}
     */
    _operationLease = undefined;
    /**
     * Runs constructor.
     * @param {import("../../configuration-types.js").DatabaseConfigurationType} config - Configuration object.
     * @param {import("../../configuration.js").default} configuration - Configuration instance.
     */
    constructor(config, configuration) {
        this._args = config;
        this.configuration = configuration;
        this.mutex = new Mutex(); // Can be used to lock this instance for exclusive use
        this.logger = new Logger(this);
        this._transactionCallbackFrames = [];
        this._transactionsCount = 0;
        this._transactionCompletionPromise = Promise.resolve();
        this._resolveTransactionCompletion = undefined;
        this._transactionsActionsMutex = new Mutex();
        this._physicalConnectionMutex = new Mutex();
        this._schemaCache = new Map();
    }
    /**
     * Serializes access to one physical database session.
     * @template T
     * @param {() => Promise<T>} callback - Physical driver operation.
     * @returns {Promise<T>} - Operation result.
     */
    async _runPhysicalConnectionRequest(callback) {
        return await this._physicalConnectionMutex.sync(async () => {
            return await runWithoutSharedTransactionCoordinatorOwner(this, callback);
        });
    }
    /**
     * Cleans driver-specific session state before this logical connection is reusable.
     * Drivers whose physical sessions cannot be safely reset should dispose them here.
     * @returns {Promise<void>} - Resolves when the next checkout cannot observe prior session state.
     */
    async cleanupSessionStateAfterCheckout() { }
    /**
     * Runs add foreign key.
     * @param {string} tableName - Table name.
     * @param {string} columnName - Column name.
     * @param {string} referencedTableName - Referenced table name.
     * @param {string} referencedColumnName - Referenced column name.
     * @param {object} args - Options object.
     * @returns {Promise<void>} - Resolves when complete.
     */
    async addForeignKey(tableName, columnName, referencedTableName, referencedColumnName, args) {
        this._assertNotReadOnly();
        const tableForeignKeyArgs = Object.assign({
            columnName,
            tableName,
            referencedColumnName,
            referencedTableName
        }, args);
        const tableForeignKey = new TableForeignKey(tableForeignKeyArgs);
        const tableData = new TableData(tableName);
        tableData.addForeignKey(tableForeignKey);
        const alterTableSQLs = await this.alterTableSQLs(tableData);
        for (const alterTableSQL of alterTableSQLs) {
            await this.query(alterTableSQL);
        }
    }
    /**
     * Runs remove foreign key.
     * @param {string} tableName - Table name.
     * @param {import("./base-foreign-key.js").default} foreignKeyMetadata - Foreign key metadata.
     * @returns {Promise<void>} - Resolves when complete.
     */
    async removeForeignKey(tableName, foreignKeyMetadata) {
        this._assertNotReadOnly();
        const tableForeignKey = new TableForeignKey({
            columnName: foreignKeyMetadata.getColumnName(),
            dropForeignKey: true,
            name: foreignKeyMetadata.getName(),
            referencedColumnName: foreignKeyMetadata.getReferencedColumnName(),
            referencedTableName: foreignKeyMetadata.getReferencedTableName(),
            tableName
        });
        const tableData = new TableData(tableName);
        tableData.addForeignKey(tableForeignKey);
        const alterTableSQLs = await this.alterTableSQLs(tableData);
        for (const alterTableSQL of alterTableSQLs) {
            await this.query(alterTableSQL);
        }
    }
    /**
     * Runs alter table sqls.
     * @abstract
     * @param {import("../table-data/index.js").default} _tableData - Table data.
     * @returns {Promise<string[]>} - Resolves with SQL statements.
     */
    alterTableSQLs(_tableData) {
        throw new Error("alterTableSQLs not implemented");
    }
    /**
     * Runs connect.
     * @abstract
     * @returns {Promise<void>} - Resolves when complete.
     */
    connect() {
        throw new Error("'connect' not implemented");
    }
    /**
     * Releases tracked advisory locks and closes the physical database connection.
     * @returns {Promise<void>} - Resolves when cleanup and close complete.
     */
    async close() {
        /** @type {Error | undefined} */
        let advisoryLockError;
        try {
            await this.releaseHeldAdvisoryLocks();
        }
        catch (error) {
            advisoryLockError = error instanceof Error ? error : new Error("Failed to release held advisory locks", { cause: error });
        }
        try {
            await this._close();
            this._heldAdvisoryLocks.clear();
        }
        catch (error) {
            const closeError = error instanceof Error ? error : new Error("Failed to close database connection", { cause: error });
            if (advisoryLockError) {
                throw new AggregateError([advisoryLockError, closeError], "Failed to release advisory locks and close database connection", { cause: error });
            }
            throw closeError;
        }
        if (advisoryLockError)
            throw advisoryLockError;
    }
    /**
     * Driver-specific physical close hook.
     * @returns {Promise<void>} - Resolves when the underlying connection closes.
     */
    async _close() {
        // No-op by default
    }
    /**
     * Flushes pending writes that the driver delayed for persistence.
     * @returns {Promise<void>} - Resolves when pending writes are durable.
     */
    async flushPendingWrites() {
        // No-op by default
    }
    /**
     * Returns whether delayed persistence writes remain.
     * @returns {boolean} - Whether writes remain.
     */
    hasPendingWrites() { return false; }
    /**
     * Deletes this driver's physical database storage without opening it.
     * @returns {Promise<void>} - Resolves after deletion.
     */
    async deleteDatabaseStorage() { throw new Error(`Database storage deletion is not supported by ${this.constructor.name}`); }
    /**
     * Runs set connection checkout name.
     * @param {string | undefined} name - Human-readable name for this active checkout.
     * @returns {Promise<void>} - Resolves when complete.
     */
    async setConnectionCheckoutName(name) {
        this._connectionCheckoutName = name;
        this._connectionCheckedOutAtUnixMs = Date.now();
    }
    /**
     * Runs clear connection checkout name.
     * @returns {Promise<void>} - Resolves when complete.
     */
    async clearConnectionCheckoutName() {
        this._connectionCheckoutName = undefined;
        this._connectionCheckedOutAtUnixMs = undefined;
    }
    /**
     * Sets the pool-owned identity used by safe database diagnostics.
     * @param {{databaseIdentifier: string, databaseIdentityFingerprint: string}} identity - Pool-stamped identity redacted at diagnostic snapshot time.
     * @returns {void}
     */
    setPoolDiagnosticIdentity({ databaseIdentifier, databaseIdentityFingerprint }) {
        this._databaseIdentifier = databaseIdentifier;
        this._databaseIdentityFingerprint = databaseIdentityFingerprint;
    }
    /**
     * Runs reconnect.
     * @returns {Promise<void>} - Resolves when complete.
     */
    async reconnect() {
        this.clearSchemaCache();
        await this.close();
        await this.connect();
    }
    /**
     * Runs create database sql.
     * @abstract
     * @param {string} databaseName - Database name.
     * @param {object} [args] - Options object.
     * @param {boolean} [args.ifNotExists] - Whether if not exists.
     * @param {string} [args.databaseCharset] - Database-default character set (driver-specific; mysql/mariadb).
     * @param {string} [args.databaseCollation] - Database-default collation (driver-specific; mysql/mariadb).
     * @returns {string[]} - SQL statements.
     */
    createDatabaseSql(databaseName, args) { throw new Error("'createDatabaseSql' not implemented"); } // eslint-disable-line no-unused-vars
    /**
     * Runs drop database sql.
     * @abstract
     * @param {string} databaseName - Database name.
     * @param {object} [args] - Options object.
     * @param {boolean} [args.ifExists] - Whether if exists.
     * @returns {string[]} - SQL statements.
     */
    dropDatabaseSql(databaseName, args) { throw new Error("'dropDatabaseSql' not implemented"); } // eslint-disable-line no-unused-vars
    /**
     * Runs create index sqls.
     * @abstract
     * @param {CreateIndexSqlArgs} indexData - Index data.
     * @returns {Promise<string[]>} - Resolves with SQL statements.
     */
    async createIndexSQLs(indexData) {
        throw new Error("'createIndexSQLs' not implemented");
    }
    /**
     * Runs remove index sqls.
     * @abstract
     * @param {RemoveIndexSqlArgs} indexData - Index data.
     * @returns {Promise<string[]>} - Resolves with SQL statements.
     */
    async removeIndexSQLs(indexData) {
        throw new Error("'removeIndexSQLs' not implemented");
    }
    /**
     * Runs create table.
     * @param {import("../table-data/index.js").default} tableData - Table data.
     * @returns {Promise<void>} - Resolves when complete.
     */
    async createTable(tableData) {
        this._assertNotReadOnly();
        const sqls = await this.createTableSql(tableData);
        for (const sql of sqls) {
            await this.query(sql);
        }
    }
    /**
     * Runs create table sql.
     * @abstract
     * @param {import("../table-data/index.js").default} tableData - Table data.
     * @returns {Promise<string[]>} - Resolves with SQL statements.
     */
    async createTableSql(tableData) {
        throw new Error("'createTableSql' not implemented");
    }
    /**
     * Runs delete.
     * @param {DeleteSqlArgsType} args - Options object.
     * @returns {Promise<void>} - Resolves when complete.
     */
    async delete(args) {
        this._assertNotReadOnly();
        const sql = this.deleteSql(args);
        await this.query(sql);
    }
    /**
     * Runs delete sql.
     * @abstract
     * @param {DeleteSqlArgsType} args - Options object.
     * @returns {string} - SQL string.
     */
    deleteSql(args) {
        throw new Error(`'deleteSql' not implemented`);
    }
    /**
     * Runs drop table.
     * @param {string} tableName - Table name.
     * @param {DropTableSqlArgsType} [args] - Options object.
     * @returns {Promise<void>} - Resolves when complete.
     */
    async dropTable(tableName, args) {
        this._assertNotReadOnly();
        const sqls = await this.dropTableSQLs(tableName, args);
        for (const sql of sqls) {
            await this.query(sql);
        }
    }
    /**
     * Runs drop table sqls.
     * @abstract
     * @param {string} tableName - Table name.
     * @param {DropTableSqlArgsType} [args] - Options object.
     * @returns {Promise<string[]>} - Resolves with SQL statements.
     */
    async dropTableSQLs(tableName, args) {
        throw new Error("dropTableSQLs not implemented");
    }
    /**
     * Runs escape.
     * @abstract
     * @param {ReturnType<typeof JSON.parse>} value - Value to use.
     * @returns {ReturnType<typeof JSON.parse>} - The escape.
     */
    escape(value) {
        throw new Error("'escape' not implemented");
    }
    /**
     * Runs get args.
     * @returns {import("../../configuration-types.js").DatabaseConfigurationType} - The args.
     */
    getArgs() {
        return this._args;
    }
    /**
     * Runs get configuration.
     * @returns {import("../../configuration.js").default} - The configuration.
     */
    getConfiguration() {
        if (!this.configuration)
            throw new Error("No configuration set");
        return this.configuration;
    }
    /**
     * Installs an operation lease atomically with ordinary transaction admission.
     * @param {import("../operation-lease.js").default} operationLease - Active lease.
     * @returns {Promise<void>} - Resolves once the lease owns transaction admission.
     */
    async setOperationLease(operationLease) {
        await this._transactionsActionsMutex.sync(async () => {
            if (this._operationLease)
                throw new Error("A database operation lease is already active");
            if (this._transactionsCount > 0) {
                throw new Error("Cannot start a database operation while an unrelated ordinary transaction is already active");
            }
            this._operationLease = operationLease;
        });
    }
    /**
     * Clears the matching operation lease.
     * @param {import("../operation-lease.js").default} operationLease - Lease to clear.
     * @returns {void}
     */
    clearOperationLease(operationLease) {
        if (this._operationLease !== operationLease) {
            throw new Error("Cannot clear a database operation lease owned by another operation");
        }
        this._operationLease = undefined;
    }
    /**
     * Waits for an unrelated operation lease to release.
     * @param {symbol | undefined} operationOwner - Candidate operation owner.
     * @returns {Promise<void>}
     */
    async _waitForOperationLease(operationOwner) {
        const operationLease = this._operationLease;
        if (operationLease)
            await operationLease.wait(operationOwner);
    }
    /**
     * Runs get id seq.
     * @returns {number | undefined} - The id seq.
     */
    getIdSeq() {
        return this.idSeq;
    }
    /**
     * Runs primary key type.
     * @returns {string} - Configured primary key type, defaulting to UUID.
     */
    primaryKeyType() {
        return this.getArgs().primaryKeyType || "uuid";
    }
    /**
     * Clears cached schema metadata for this driver instance.
     * @returns {void} - No return value.
     */
    clearSchemaCache() {
        if (this._schemaCacheInvalidator) {
            this._schemaCacheInvalidator();
            return;
        }
        this._clearLocalSchemaCache();
    }
    /**
     * Clears only the metadata cached on this driver instance.
     * @returns {void} - No return value.
     */
    _clearLocalSchemaCache() {
        this._schemaCache.clear();
    }
    /**
     * Runs set schema cache invalidator.
     * @param {() => void} invalidator - Callback used to clear schema caches that share this driver pool.
     * @returns {void} - No return value.
     */
    setSchemaCacheInvalidator(invalidator) {
        this._schemaCacheInvalidator = invalidator;
    }
    /**
     * Runs schema cache enabled.
     * @returns {boolean} - Whether schema metadata caching is enabled.
     */
    _schemaCacheEnabled() {
        return this.getArgs().schemaCache !== false;
    }
    /**
     * Runs cached schema metadata.
     * @template T
     * @param {string} cacheKey - Schema cache key.
     * @param {() => Promise<T>} callback - Cache miss callback.
     * @returns {Promise<T>} - Resolves with the cached metadata.
     */
    async _cachedSchemaMetadata(cacheKey, callback) {
        if (!this._schemaCacheEnabled())
            return await callback();
        const existingPromise = this._schemaCache.get(cacheKey);
        if (existingPromise) {
            return /** @type {T} */ (this._schemaCacheReturnValue(await existingPromise));
        }
        const promise = (async () => await callback())();
        this._schemaCache.set(cacheKey, promise);
        try {
            return /** @type {T} */ (this._schemaCacheReturnValue(await promise));
        }
        catch (error) {
            if (this._schemaCache.get(cacheKey) === promise) {
                this._schemaCache.delete(cacheKey);
            }
            throw error;
        }
    }
    /**
     * Runs cached table schema metadata.
     * @template T
     * @param {string} tableName - Table name.
     * @param {string} metadataName - Metadata name.
     * @param {() => Promise<T>} callback - Cache miss callback.
     * @returns {Promise<T>} - Resolves with the cached table metadata.
     */
    async _cachedTableSchemaMetadata(tableName, metadataName, callback) {
        return await this._cachedSchemaMetadata(`table:${tableName}:${metadataName}`, callback);
    }
    /**
     * Runs schema cache return value.
     * @param {ReturnType<typeof JSON.parse>} value - Cached value.
     * @returns {ReturnType<typeof JSON.parse>} - Value returned to callers.
     */
    _schemaCacheReturnValue(value) {
        if (Array.isArray(value))
            return value.slice();
        return value;
    }
    /**
     * Runs get tables.
     * @abstract
     * @returns {Promise<Array<import("./base-table.js").default>>} - Resolves with the tables.
     */
    getTables() {
        throw new Error(`${this.constructor.name}#getTables not implemented`);
    }
    /**
     * Runs structure sql.
     * @returns {Promise<string | null>} - Resolves with SQL string.
     */
    async structureSql() {
        return null;
    }
    /**
     * Executes a whole multi-statement structure SQL script in a single round-trip when
     * the driver supports it, running on this connection (so the caller's foreign-key
     * handling applies). Returns true if it ran the whole script; false when the caller
     * should run the statements individually. The base driver has no batch path.
     * @param {string} _structureSql - Full multi-statement structure SQL.
     * @returns {Promise<boolean>} - Whether the script was executed as one batch.
     */
    async execStructureScript(_structureSql) {
        return false;
    }
    /**
     * Runs get table by name.
     * @param {string} name - Name.
     * @param {object} [args] - Options object.
     * @param {boolean} args.throwError - Whether throw error.
     * @returns {Promise<import("./base-table.js").default | undefined>} - Resolves with the table by name.
     */
    async getTableByName(name, args) {
        const tables = await this.getTables();
        const tableNames = [];
        let table;
        for (const candidate of tables) {
            const candidateName = candidate.getName();
            if (candidateName == name) {
                table = candidate;
                break;
            }
            tableNames.push(candidateName);
        }
        if (!table && args?.throwError !== false) {
            throw new Error(this._missingTableErrorMessage(name, tableNames));
        }
        return table;
    }
    /**
     * Runs missing table error message.
     * @param {string} name - Table name.
     * @param {string[]} tableNames - Available table names.
     * @returns {string} - Error message.
     */
    _missingTableErrorMessage(name, tableNames) {
        const environment = this.getConfiguration().getEnvironment();
        const args = this.getArgs();
        const databaseName = args?.database || args?.name || args?.useDatabase || "unknown";
        return `Couldn't find a table by that name "${name}" in: ${tableNames.join(", ")} (environment: ${environment}, database: ${databaseName})`;
    }
    /**
     * Runs get table by name or fail.
     * @param {string} name - Name.
     * @returns {Promise<import("./base-table.js").default>} - Resolves with the table by name or fail.
     */
    async getTableByNameOrFail(name) {
        return /** @type {import("./base-table.js").default} */ (await this.getTableByName(name, { throwError: true }));
    }
    /**
     * Runs get type.
     * @abstract
     * @returns {string} - The type.
     */
    getType() {
        throw new Error("'type' not implemented");
    }
    /**
     * Whether this driver can combine unrelated alter-table operations into a
     * single `ALTER TABLE` statement (Rails' `supports_bulk_alter`).
     * @returns {boolean} - Whether bulk alter is supported.
     */
    supportsBulkAlter() {
        return false;
    }
    /**
     * Whether a bulk `ALTER TABLE` statement can also carry `ADD INDEX` clauses.
     * Only drivers that support this keep index adds inside the combined batch;
     * the rest execute each index as its own statement.
     * @returns {boolean} - Whether indexes can be added inside a bulk alter.
     */
    supportsBulkAlterIndexes() {
        return false;
    }
    /**
     * Runs insert.
     * @param {InsertSqlArgsType} args - Options object.
     * @returns {Promise<void>} - Resolves when complete.
     */
    async insert(args) {
        this._assertNotReadOnly();
        const sql = this.insertSql(args);
        await this.query(sql);
    }
    /**
     * Maximum rows per `INSERT ... VALUES (...), (...), ...` statement. Drivers
     * that build multi-value inserts must stay below database-specific limits
     * (SQLite's `MAX_VARIABLE_NUMBER`, SQL Server's 2100 parameters, PostgreSQL's
     * 65535 parameters, and so on). 500 rows is safely under every major engine
     * for tables with a moderate number of columns and keeps generated SQL small.
     *
     * Override via `maxRowsPerInsert` in the database configuration.
     * @returns {number} - Maximum rows per insert statement.
     */
    maxRowsPerInsert() {
        return optionalPositiveInteger(this.getArgs().maxRowsPerInsert, "maxRowsPerInsert") ?? 500;
    }
    /**
     * Maximum serialized SQL size, in bytes, for a single `INSERT ... VALUES`
     * statement. Large text/JSON payloads can push a modest row count well beyond
     * database wire/protocol limits, so chunking also stops when the next row
     * would push the generated string over this threshold.
     *
     * Override via `maxInsertSqlBytes` in the database configuration.
     * @returns {number} - Maximum bytes per insert statement.
     */
    maxInsertSqlBytes() {
        return optionalPositiveInteger(this.getArgs().maxInsertSqlBytes, "maxInsertSqlBytes") ?? 1048576;
    }
    /**
     * Maximum values in a single `IN (...)` cohort used by preloads, association
     * counts, and queryData aggregates. The default stays under SQLite's default
     * `MAX_VARIABLE_NUMBER` compile-time limit.
     *
     * Override via `maxInClauseValues` in the database configuration.
     * @returns {number} - Maximum values per IN clause cohort.
     */
    maxInClauseValues() {
        return optionalPositiveInteger(this.getArgs().maxInClauseValues, "maxInClauseValues") ?? 999;
    }
    /**
     * Maximum serialized SQL size, in bytes, for a single cohort query used by
     * preloads, association counts, and queryData aggregates. Cohort chunking
     * stops when the next value would push the generated string over this threshold.
     *
     * Override via `maxQuerySqlBytes` in the database configuration.
     * @returns {number} - Maximum bytes per cohort query.
     */
    maxQuerySqlBytes() {
        return optionalPositiveInteger(this.getArgs().maxQuerySqlBytes, "maxQuerySqlBytes") ?? 1048576;
    }
    /**
     * Splits `values` into cohort chunks that stay within both `maxCount` and
     * `maxBytes` while preserving order.
     *
     * A chunk always contains at least one value, even if that single value exceeds
     * the byte limit, so progress is guaranteed.
     * @template T
     * @param {Array<T>} values - Values to chunk.
     * @param {(values: Array<T>) => string} buildSql - Function that builds the full SQL for a candidate chunk.
     * @param {{maxCount?: number, maxBytes?: number}} [options] - Chunking bounds.
     * @returns {Array<Array<T>>} - Value cohorts.
     */
    chunkValues(values, buildSql, { maxCount = this.maxInClauseValues(), maxBytes = this.maxQuerySqlBytes() } = {}) {
        if (values.length === 0)
            return [];
        /**
         * Chunks.
         * @type {Array<Array<T>>} */
        const chunks = [];
        /**
         * Current chunk.
         * @type {Array<T>} */
        let currentChunk = [];
        for (const value of values) {
            const candidate = [...currentChunk, value];
            const candidateBytes = utf8ByteLength(buildSql(candidate));
            if (currentChunk.length > 0 && (candidate.length > maxCount || candidateBytes > maxBytes)) {
                chunks.push(currentChunk);
                currentChunk = [value];
            }
            else {
                currentChunk = candidate;
            }
        }
        if (currentChunk.length > 0) {
            chunks.push(currentChunk);
        }
        return chunks;
    }
    /**
     * Splits `rows` into chunks that stay within both {@link maxRowsPerInsert}
     * and {@link maxInsertSqlBytes} while preserving order.
     *
     * Byte accounting is incremental: `buildSql` is called once with `[]` to
     * measure the statement prefix and once per row with `[row]` to measure the
     * row's values tuple. This keeps chunking linear in the number of rows
     * instead of rebuilding the full multi-row SQL for every candidate.
     *
     * A chunk always contains at least one row, even if that single row exceeds
     * the byte limit, so progress is guaranteed.
     * @param {Array<Array<ReturnType<typeof JSON.parse>>>} rows - Rows to insert.
     * @param {(rows: Array<Array<ReturnType<typeof JSON.parse>>>) => string} buildSql - Function that builds the full SQL for a candidate chunk; called with `[]` to measure the statement prefix and with `[row]` to measure each row's values tuple.
     * @returns {Array<Array<Array<ReturnType<typeof JSON.parse>>>>} - Row chunks.
     */
    _insertMultipleChunks(rows, buildSql) {
        const chunks = [];
        const maxRows = this.maxRowsPerInsert();
        const maxBytes = this.maxInsertSqlBytes();
        const emptySql = buildSql([]);
        const prefix = `${emptySql} VALUES `;
        const baseByteLength = utf8ByteLength(prefix);
        /**
         * Current chunk.
         * @type {Array<Array<ReturnType<typeof JSON.parse>>>} */
        let currentChunk = [];
        let currentBytes = 0;
        for (const row of rows) {
            const singleRowSql = buildSql([row]);
            const rowValuesSql = singleRowSql.slice(prefix.length);
            const rowValuesSqlBytes = utf8ByteLength(rowValuesSql);
            if (currentChunk.length > 0) {
                const candidateRows = currentChunk.length + 1;
                const candidateBytes = currentBytes + 2 + rowValuesSqlBytes; // ", " separator
                if (candidateRows > maxRows || candidateBytes > maxBytes) {
                    chunks.push(currentChunk);
                    currentChunk = [];
                    currentBytes = 0;
                }
            }
            if (currentChunk.length === 0) {
                currentBytes = baseByteLength + rowValuesSqlBytes;
            }
            else {
                currentBytes += 2 + rowValuesSqlBytes;
            }
            currentChunk.push(row);
        }
        if (currentChunk.length > 0) {
            chunks.push(currentChunk);
        }
        return chunks;
    }
    /**
     * Runs insert multiple.
     *
     * Large row sets are split into multiple statements that each stay within
     * {@link maxRowsPerInsert} rows and {@link maxInsertSqlBytes} serialized
     * bytes so the generated SQL stays within database parameter and wire limits.
     * When called outside a transaction each chunk commits independently; callers
     * that need all-or-nothing semantics should wrap the call in {@link transaction}.
     * @param {string} tableName - Table name.
     * @param {Array<string>} columns - Column names.
     * @param {Array<Array<ReturnType<typeof JSON.parse>>>} rows - Rows to insert.
     * @returns {Promise<void>} - Resolves when complete.
     */
    async insertMultiple(tableName, columns, rows) {
        this._assertNotReadOnly();
        const chunks = this._insertMultipleChunks(rows, (chunkRows) => this.insertSql({ columns, tableName, rows: chunkRows }));
        for (const chunk of chunks) {
            const sql = this.insertSql({ columns, tableName, rows: chunk });
            await this.query(sql);
        }
    }
    /**
     * Runs insert sql.
     * @abstract
     * @param {InsertSqlArgsType} args - Options object.
     * @returns {string} - SQL string.
     */
    insertSql(args) {
        throw new Error("'insertSql' not implemented");
    }
    /**
     * Runs upsert.
     * @param {UpsertSqlArgsType} args - Options object.
     * @returns {Promise<void>} - Resolves when complete.
     */
    async upsert(args) {
        this._assertNotReadOnly();
        const sql = this.upsertSql(args);
        await this.query(sql);
    }
    /**
     * Runs last insert id.
     * @abstract
     * @param {QueryOptions} [_options] - Query ownership options.
     * @returns {Promise<number>} - Resolves with the last insert id.
     */
    lastInsertID(_options = {}) {
        throw new Error(`${this.constructor.name}#lastInsertID not implemented`);
    }
    /**
     * Runs convert value.
     * @param {ReturnType<typeof JSON.parse>} value - Value to use.
     * @returns {ReturnType<typeof JSON.parse>} - The convert value.
     */
    _convertValue(value) {
        if (typeof value === "boolean") {
            return value ? 1 : 0;
        }
        // isDate instead of instanceof: a Date created in another realm (e.g. the console REPL) would
        // fail instanceof, skip this conversion, and serialize as an empty SQL value downstream.
        if (isDate(value)) {
            return formatDateForDatabase(value, { databaseType: this.getType() });
        }
        // JSON-encode plain objects/arrays so they land in JSON/text columns as valid
        // JSON. Without this, drivers like mysql's escape() turn an object into
        // `key` = value assignment pairs (its `SET ?` form), producing invalid SQL in
        // a value position. Only PLAIN objects and arrays are encoded — class
        // instances (e.g. model records, which are circular via _changes) and Buffers
        // pass through untouched, since JSON.stringify on a record throws on its
        // circular structure and a record is never a valid column value to serialize.
        if (this._isJsonEncodableValue(value)) {
            return JSON.stringify(value);
        }
        return value;
    }
    /**
     * Whether a value is a plain object or array that should be JSON-encoded for a
     * JSON/text column. Excludes Buffers and class instances (e.g. model records).
     * @param {ReturnType<typeof JSON.parse>} value - Value to test.
     * @returns {boolean} - Whether to JSON-encode the value.
     */
    _isJsonEncodableValue(value) {
        if (value === null || typeof value !== "object")
            return false;
        if (typeof Buffer !== "undefined" && Buffer.isBuffer(value))
            return false;
        if (Array.isArray(value))
            return true;
        const prototype = Object.getPrototypeOf(value);
        return prototype === Object.prototype || prototype === null;
    }
    /**
     * Runs options.
     * @abstract
     * @returns {import("../query-parser/options.js").default} - The options options.
     */
    options() {
        throw new Error("'options' not implemented.");
    }
    /**
     * Runs quote.
     * @param {ReturnType<typeof JSON.parse>} value - Value to use.
     * @returns {number | string} - The quote.
     */
    quote(value) {
        if (typeof value == "number")
            return value;
        const escapedValue = this.escape(value);
        const result = `"${escapedValue}"`;
        return result;
    }
    /**
     * Runs quote column.
     * @param {string} columnName - Column name.
     * @returns {string} - The quote column.
     */
    quoteColumn(columnName) {
        return this.options().quoteColumnName(columnName);
    }
    /**
     * Runs quote index.
     * @param {string} columnName - Column name.
     * @returns {string} - The quote index.
     */
    quoteIndex(columnName) {
        return this.options().quoteIndexName(columnName);
    }
    /**
     * Runs quote table.
     * @param {string} tableName - Table name.
     * @returns {string} - The quote table.
     */
    quoteTable(tableName) {
        return this.options().quoteTableName(tableName);
    }
    /**
     * Runs new query.
     * @returns {Query} - The new query.
     */
    newQuery() {
        const handler = new Handler();
        return new Query({
            driver: this,
            handler
        });
    }
    /**
     * Runs select.
     * @param {string} tableName - Table name.
     * @returns {Promise<QueryResultType>} - Resolves with the select.
     */
    async select(tableName) {
        const query = this.newQuery();
        const sql = query
            .from(tableName)
            .toSql();
        return await this.query(sql);
    }
    /**
     * Runs set id seq.
     * @param {number | undefined} newIdSeq - New id seq.
     * @returns {void} - No return value.
     */
    setIdSeq(newIdSeq) {
        this.idSeq = newIdSeq;
    }
    /**
     * Runs should set auto increment when primary key.
     * @abstract
     * @returns {boolean} - Whether set auto increment when primary key.
     */
    shouldSetAutoIncrementWhenPrimaryKey() {
        throw new Error(`'shouldSetAutoIncrementWhenPrimaryKey' not implemented`);
    }
    /**
     * Runs supports default primary key uuid.
     * @returns {boolean} - Whether supports default primary key uuid.
     */
    supportsDefaultPrimaryKeyUUID() { return false; }
    /**
     * Executes an insert that carries an explicit primary-key value
     * (client-generated offline-sync ids). Drivers whose auto-increment columns
     * reject explicit values (MSSQL IDENTITY) override this to run the insert
     * with identity insert enabled in a single request.
     * @param {object} args - Options object.
     * @param {QueryOptions} args.options - Query options for the standard query path.
     * @param {string} args.sql - Generated insert SQL.
     * @param {string} args.tableName - Table being inserted into.
     * @returns {Promise<QueryResultType>} - Insert result.
     */
    async insertWithExplicitPrimaryKey({ options, sql, tableName }) {
        void tableName;
        return await this.query(sql, options);
    }
    /**
     * Runs supports insert into returning.
     * @abstract
     * @returns {boolean} - Whether supports insert into returning.
     */
    supportsInsertIntoReturning() { return false; }
    /**
     * Whether a single connection can reference tables in another database on the same server via a
     * two-part `database`.`table` identifier. When true, a query spanning several databases on this
     * server can be expressed as one statement (a cross-tenant `UNION ALL`); when false, each database
     * is queried on its own connection and the results merged in the caller. Only MySQL/MariaDB return
     * true: PostgreSQL (one database per connection) and SQLite (one attached file per connection)
     * cannot, and MSSQL is excluded because it reads a two-part name as `schema.table` (cross-database
     * access needs a three-part `database.schema.table`), so it stays on the always-correct fan-out
     * path. Consumed by `Tenant.aggregateAcross`.
     * @returns {boolean} - Whether two-part cross-database references are supported.
     */
    supportsCrossDatabaseReferences() { return false; }
    /**
     * Runs table exists.
     * @param {string} tableName - Table name.
     * @returns {Promise<boolean>} - Resolves with Whether table exists.
     */
    async tableExists(tableName) {
        const tables = await this.getTables();
        const table = tables.find((table) => table.getName() == tableName);
        if (table)
            return true;
        return false;
    }
    /**
     * Runs a callback inside a database transaction (or a savepoint when already inside one).
     * The outermost transaction retries the whole callback on a deadlock / lock-wait-timeout,
     * because such errors roll the entire transaction back and the standard recovery is to
     * restart it. Nested savepoints let the deadlock bubble up to this outer retry.
     * @template T
     * @param {() => Promise<T>} callback - Callback function.
     * @param {Pick<QueryOptions, "operationOwner">} [options] - Transaction ownership.
     * @returns {Promise<T>} - Resolves with the transaction result.
     */
    async transaction(callback, options = {}) {
        await this._waitForOperationLease(options.operationOwner);
        return await coordinateSharedTransactionConnection(this, async () => {
            if (this._transactionsCount > 0) {
                return await this._runTransactionAttempt(callback, options);
            }
            const args = this.getArgs();
            const maxAttempts = optionalPositiveInteger(args.deadlockMaxRetries, "deadlockMaxRetries") ?? 8;
            const configuredBaseWaitMs = optionalPositiveInteger(args.deadlockBaseWaitMs, "deadlockBaseWaitMs");
            const deadlockMaxWaitMs = optionalPositiveInteger(args.deadlockMaxWaitMs, "deadlockMaxWaitMs") ?? 1000;
            let attempt = 0;
            while (true) {
                attempt++;
                const attemptStartedAtMs = this._nowMs();
                try {
                    return await this._runTransactionAttempt(callback, options);
                }
                catch (error) {
                    if (error instanceof VelociousDatabaseAfterCommitCallbackError)
                        throw error.callbackError;
                    if (!(error instanceof Error))
                        throw error;
                    const retryInfo = this.retryableDatabaseError(error);
                    const willRetry = Boolean(retryInfo.deadlock && attempt < maxAttempts && this._transactionsCount == 0);
                    if (willRetry) {
                        this._reportDeadlockRetryDiagnostic({
                            attempt,
                            contentionKind: retryInfo.contentionKind || "deadlock",
                            error,
                            maxAttempts,
                            transactionAttemptDurationMs: Math.max(0, this._nowMs() - attemptStartedAtMs),
                            willRetry
                        });
                        // An explicitly-configured base wins so the tuning knob is effective even on drivers
                        // whose classifier supplies its own `waitMs` (MySQL/MariaDB return a fixed 50ms for
                        // deadlocks); otherwise honor that classifier hint, then fall back to 50ms.
                        const baseWaitMs = configuredBaseWaitMs ?? (typeof retryInfo.waitMs == "number" && retryInfo.waitMs > 0 ? retryInfo.waitMs : 50);
                        // Full-jitter exponential backoff: wait a uniform-random duration in
                        // [0, min(base * 2^(attempt-1), cap)]. The doubling ceiling spreads retries out as
                        // contention persists, and the jitter de-correlates transactions that deadlocked in
                        // lockstep so they stop re-colliding on the same wait (the linear `base * attempt`
                        // this replaces had every victim retry after an identical delay). `attempt` is
                        // 1-based here, so 2^(attempt-1) is 1, 2, 4, ... The cap keeps the tail sub-second.
                        const ceilingWaitMs = Math.min(baseWaitMs * (2 ** (attempt - 1)), deadlockMaxWaitMs);
                        const jitteredWaitMs = Math.floor(Math.random() * (ceilingWaitMs + 1));
                        const loggedContentionKind = retryInfo.contentionKind || "transaction contention";
                        this.logger.warn(`Retrying transaction after ${loggedContentionKind} (attempt ${attempt}/${maxAttempts})`);
                        await this._waitMs(jitteredWaitMs);
                        continue;
                    }
                    throw error;
                }
            }
        }, options.operationOwner);
    }
    /**
     * Waits `ms` milliseconds. Isolated in its own method so tests can observe (and skip) the
     * deadlock-retry backoff without a real timer.
     * @param {number} ms - Milliseconds to wait.
     * @returns {Promise<void>} - Resolves after the delay.
     */
    async _waitMs(ms) {
        await wait(ms);
    }
    /**
     * Returns the clock used for transaction-attempt diagnostics.
     * @returns {number} - Monotonic milliseconds where available.
     */
    _nowMs() {
        return nowMs();
    }
    /**
     * Starts best-effort deadlock diagnostics without joining the retry control flow. Subclasses may
     * add bounded driver-specific context; capture and event-listener failures cannot affect retry.
     * @param {{attempt: number, contentionKind: "deadlock" | "lock-wait-timeout", error: Error, maxAttempts: number, transactionAttemptDurationMs: number, willRetry: boolean}} args - Retry metadata.
     * @returns {void}
     */
    _reportDeadlockRetryDiagnostic({ attempt, contentionKind, error, maxAttempts, transactionAttemptDurationMs, willRetry }) {
        let snapshot;
        try {
            const queryDiagnostic = this._failedQueryDiagnostics.get(error);
            snapshot = Object.freeze({
                attempt,
                contentionKind,
                driverType: this.getType(),
                maxAttempts,
                stage: "database-deadlock-retry",
                transactionAttemptDurationMs,
                willRetry,
                ...this._poolDiagnosticIdentityContext(),
                ...this._operationDiagnosticContext(),
                ...queryDiagnostic
            });
        }
        catch (diagnosticError) {
            this._reportDeadlockDiagnosticPipelineFailure(diagnosticError);
            return;
        }
        let driverContextResult;
        try {
            driverContextResult = this._deadlockDiagnosticContext(snapshot);
        }
        catch (diagnosticError) {
            this._reportDeadlockDiagnosticPipelineFailure(diagnosticError);
            return;
        }
        const hasPromiseContract = driverContextResult instanceof Promise;
        void Promise.resolve(driverContextResult)
            .then((driverContext) => {
            if (!hasPromiseContract)
                throw new Error("Database deadlock diagnostic context must return a Promise");
            const context = {
                ...snapshot,
                ...driverContext
            };
            const payload = {
                context,
                error: new Error(willRetry
                    ? `Database transaction ${contentionKind} will be retried`
                    : `Database transaction ${contentionKind} exhausted its retry budget`)
            };
            const errorEvents = this.configuration.getErrorEvents();
            try {
                errorEvents.emit("database-deadlock-retry", payload);
            }
            catch (eventError) {
                this.logger.warn("Database deadlock retry diagnostic listener failed", { error: eventError });
            }
            try {
                errorEvents.emit("all-error", { ...payload, errorType: "database-deadlock-retry" });
            }
            catch (eventError) {
                this.logger.warn("Database deadlock retry all-error listener failed", { error: eventError });
            }
        })
            .catch((diagnosticError) => this._reportDeadlockDiagnosticPipelineFailure(diagnosticError));
    }
    /**
     * Returns pool identity only when this driver was stamped by a pool.
     * @returns {{databaseIdentifier?: string, databaseIdentifierFingerprint?: string, databaseIdentityFingerprint?: string}} - Safe pool identity.
     */
    _poolDiagnosticIdentityContext() {
        if (this._databaseIdentifier === undefined || !this._databaseIdentityFingerprint)
            return {};
        const identifierFingerprintInput = typeof this._databaseIdentifier === "string"
            ? this._databaseIdentifier
            : `invalid:${typeof this._databaseIdentifier}`;
        const databaseIdentifierFingerprint = `sha256:${sha256Hex(`database-logical-identifier:v1\0${identifierFingerprintInput}`)}`;
        return {
            databaseIdentifier: REDACTED_DIAGNOSTIC_LABEL,
            databaseIdentifierFingerprint,
            databaseIdentityFingerprint: this._databaseIdentityFingerprint
        };
    }
    /**
     * Builds the bounded operation portion of an immutable retry snapshot.
     * @returns {{operationName?: string, operationNameFingerprint?: string}} - Safe operation fields.
     */
    _operationDiagnosticContext() {
        const rawOperationName = this._connectionCheckoutName;
        if (rawOperationName === undefined)
            return {};
        if (typeof rawOperationName !== "string") {
            return {
                operationName: REDACTED_DIAGNOSTIC_LABEL,
                operationNameFingerprint: `sha256:${sha256Hex(`database-operation:v1\0invalid:${typeof rawOperationName}`)}`
            };
        }
        const scannedOperationName = rawOperationName.slice(0, OPERATION_NAME_SCAN_LIMIT);
        const operationNameFingerprint = `sha256:${sha256Hex(`database-operation:v1\0${scannedOperationName}\0length:${rawOperationName.length}`)}`;
        return {
            operationName: REDACTED_DIAGNOSTIC_LABEL,
            operationNameFingerprint
        };
    }
    /**
     * Reports an unexpected detached diagnostics failure without changing transaction control flow.
     * @param {ReturnType<typeof JSON.parse>} diagnosticError - Diagnostics failure.
     * @returns {void}
     */
    _reportDeadlockDiagnosticPipelineFailure(diagnosticError) {
        const normalizedError = diagnosticError instanceof Error
            ? diagnosticError
            : new Error("Database deadlock retry diagnostic failed", { cause: diagnosticError });
        const payload = {
            context: { stage: "database-deadlock-retry-diagnostic" },
            error: normalizedError
        };
        let errorEvents;
        try {
            errorEvents = this.configuration.getErrorEvents();
        }
        catch (reportingError) {
            this.logger.warn("Database deadlock retry diagnostic pipeline reporting failed", { error: normalizedError, reportingError });
            return;
        }
        try {
            errorEvents.emit("framework-error", payload);
        }
        catch (reportingError) {
            this.logger.warn("Database deadlock retry framework-error listener failed", { error: normalizedError, reportingError });
        }
        try {
            errorEvents.emit("all-error", { ...payload, errorType: "framework-error" });
        }
        catch (reportingError) {
            this.logger.warn("Database deadlock retry all-error listener failed", { error: normalizedError, reportingError });
        }
    }
    /**
     * Builds driver-specific deadlock context. The base driver has no server diagnostic source.
     * @param {DeadlockRetryDiagnosticSnapshot} _snapshot - Immutable retry snapshot.
     * @returns {Promise<Record<string, ReturnType<typeof JSON.parse>>>} - Safe context fields.
     */
    async _deadlockDiagnosticContext(_snapshot) {
        return {};
    }
    /**
     * Runs a single transaction attempt: starts a transaction (or a savepoint when nested), runs
     * `callback`, and commits — rolling back on error. {@link transaction} wraps this with deadlock
     * retry at the outermost level.
     * @template T
     * @param {() => Promise<T>} callback - Callback function.
     * @param {Pick<QueryOptions, "operationOwner">} options - Transaction ownership.
     * @returns {Promise<ReturnType<typeof JSON.parse>>} - Resolves with the transaction result.
     */
    async _runTransactionAttempt(callback, options) {
        const savePointName = this.generateSavePointName();
        /** @type {TransactionCallbackFrame} */
        const callbackFrame = {
            afterCommitCallbacks: [],
            beforeCommitCallbacks: []
        };
        let transactionStarted = false;
        let savePointStarted = false;
        this._transactionCallbackFrames.push(callbackFrame);
        try {
            if (this._transactionsCount == 0) {
                this.logger.debug("Start transaction");
                await this.startTransaction(options);
                transactionStarted = true;
            }
            else {
                this.logger.debug("Start savepoint", savePointName);
                await this.startSavePoint(savePointName, options);
                savePointStarted = true;
            }
        }
        catch (error) {
            this._transactionCallbackFrames.pop();
            throw error;
        }
        let result;
        try {
            result = await callback();
            await this._runBeforeCommitCallbacks(callbackFrame);
            if (savePointStarted) {
                this.logger.debug("Release savepoint", savePointName);
                await this.releaseSavePoint(savePointName, options);
            }
            if (transactionStarted) {
                this.logger.debug("Commit transaction");
                await this.commitTransaction(options);
            }
        }
        catch (error) {
            if (error instanceof Error) {
                this.logger.debug("Transaction error", error.message);
            }
            else {
                this.logger.debug("Transaction error", error);
            }
            try {
                let transactionRolledBack = false;
                if (savePointStarted) {
                    this.logger.debug("Rollback savepoint", savePointName);
                    try {
                        await this.rollbackSavePoint(savePointName, options);
                    }
                    catch (savePointError) {
                        const message = savePointError instanceof Error ? savePointError.message : `${savePointError}`;
                        // MySQL sometimes drops savepoints unexpectedly; fall back to rolling back the full transaction
                        if (message.includes("SAVEPOINT") || message.includes("ER_SP_DOES_NOT_EXIST")) {
                            this.logger.debug("Savepoint rollback failed; rolling back entire transaction instead");
                            await this.rollbackTransaction(options);
                            transactionRolledBack = true;
                        }
                        else {
                            throw savePointError;
                        }
                    }
                }
                // Only roll back if a transaction is still open. A nested savepoint whose rollback failed
                // falls back to rolling back the whole transaction (above), which already closed it and
                // dropped the count to 0; rolling back again here would issue a second ROLLBACK and drive
                // `_transactionsCount` below zero, which would then defeat the outermost deadlock-retry guard.
                if (transactionStarted && !transactionRolledBack && this._transactionsCount > 0) {
                    this.logger.debug("Rollback transaction");
                    await this.rollbackTransaction(options);
                }
            }
            finally {
                this._transactionCallbackFrames.pop();
            }
            throw error;
        }
        try {
            await this._commitTransactionCallbackFrame();
        }
        catch (error) {
            throw new VelociousDatabaseAfterCommitCallbackError(error);
        }
        return result;
    }
    /**
     * Registers a guard to run after the current transaction callback succeeds and before its
     * outer commit or nested savepoint release.
     * @param {() => void | Promise<void>} callback - Guard callback.
     * @param {Pick<QueryOptions, "operationOwner">} [options] - Callback ownership.
     * @returns {Promise<void>} - Resolves when the guard has been registered.
     */
    async beforeCommit(callback, options = {}) {
        await this._waitForOperationLease(options.operationOwner);
        const currentFrame = this._transactionCallbackFrames[this._transactionCallbackFrames.length - 1];
        if (!currentFrame)
            throw new Error("beforeCommit requires an active transaction");
        currentFrame.beforeCommitCallbacks.push(callback);
    }
    /**
     * Runs a callback after the surrounding transaction commits.
     * If no transaction is active, the callback runs immediately.
     * @param {() => void | Promise<void>} callback - Callback.
     * @param {Pick<QueryOptions, "operationOwner">} [options] - Callback ownership.
     * @returns {Promise<void>} - Resolves when the callback has been registered or run.
     */
    async afterCommit(callback, options = {}) {
        await this._waitForOperationLease(options.operationOwner);
        const currentFrame = this._transactionCallbackFrames[this._transactionCallbackFrames.length - 1];
        if (!currentFrame) {
            await callback();
            return;
        }
        currentFrame.afterCommitCallbacks.push(callback);
    }
    /**
     * Whether a transaction is currently open on this connection.
     * @returns {boolean} - Whether inside a transaction.
     */
    insideTransaction() { return this._transactionsCount > 0; }
    /**
     * Returns the completion promise identifying the current outer transaction.
     * @returns {Promise<void>} Resolves after that transaction commits or rolls back.
     */
    transactionCompletion() { return this._transactionCompletionPromise; }
    /**
     * Runs start transaction.
     * @param {Pick<QueryOptions, "operationOwner">} [options] - Transaction ownership.
     * @returns {Promise<void>} - Resolves when complete.
     */
    async startTransaction(options = {}) {
        await coordinateSharedTransactionConnection(this, async () => {
            while (true) {
                /** @type {import("../operation-lease.js").default | undefined} */
                let blockingOperationLease;
                await this._transactionsActionsMutex.sync(async () => {
                    const operationLease = this._operationLease;
                    if (operationLease && options.operationOwner !== operationLease.owner) {
                        blockingOperationLease = operationLease;
                        return;
                    }
                    await this._runProfiledTransactionAction("start", async () => {
                        await this._startTransactionAction(options);
                    });
                    this._transactionsCount++;
                    if (this._transactionsCount === 1) {
                        this._transactionCompletionPromise = new Promise((resolve) => {
                            this._resolveTransactionCompletion = resolve;
                        });
                    }
                });
                if (!blockingOperationLease)
                    return;
                await blockingOperationLease.wait(options.operationOwner);
            }
        }, options.operationOwner);
    }
    /**
     * Runs start transaction action.
     * @param {Pick<QueryOptions, "operationOwner">} [options] - Transaction ownership.
     * @returns {Promise<void>} - Resolves when complete.
     */
    async _startTransactionAction(options = {}) {
        await this.query("BEGIN TRANSACTION", options);
    }
    /**
     * Runs commit transaction.
     * @param {Pick<QueryOptions, "operationOwner">} [options] - Transaction ownership.
     * @returns {Promise<void>} - Resolves when complete.
     */
    async commitTransaction(options = {}) {
        await coordinateSharedTransactionConnection(this, async () => {
            await this._transactionsActionsMutex.sync(async () => {
                await this._runProfiledTransactionAction("commit", async () => {
                    await this._commitTransactionAction(options);
                });
                this._transactionsCount--;
                this._resolveCompletedTransaction();
            });
        }, options.operationOwner);
    }
    /** Resolves the current outer transaction completion when it has finished. */
    _resolveCompletedTransaction() {
        if (this._transactionsCount !== 0)
            return;
        const resolve = this._resolveTransactionCompletion;
        this._resolveTransactionCompletion = undefined;
        if (resolve)
            resolve();
    }
    /**
     * Runs commit transaction action.
     * @param {Pick<QueryOptions, "operationOwner">} [options] - Transaction ownership.
     * @returns {Promise<void>} - Resolves when complete.
     */
    async _commitTransactionAction(options = {}) {
        await this.query("COMMIT", options);
    }
    /**
     * Times a physical transaction action only when test profiling is active.
     * @template T
     * @param {"start" | "commit" | "rollback"} action - Transaction action.
     * @param {() => Promise<T>} callback - Physical action callback.
     * @returns {Promise<T>} - Callback result.
     */
    async _runProfiledTransactionAction(action, callback) {
        const profileContext = currentTestProfileContext(this.configuration);
        if (!profileContext)
            return await callback();
        const startedAtMs = nowMs();
        let failed = true;
        try {
            const result = await callback();
            failed = false;
            return result;
        }
        finally {
            profileContext.profiler.recordDatabaseTransaction(profileContext, {
                action,
                durationMs: nowMs() - startedAtMs,
                failed
            });
        }
    }
    /**
     * Starts an optional physical-query profile attempt without retaining SQL.
     * @param {string} sql - Original SQL used only to derive its redacted diagnostic.
     * @returns {TestProfileQueryAttempt | undefined} - Active profile handle.
     */
    _startProfiledQueryAttempt(sql) {
        const context = currentTestProfileContext(this.configuration);
        if (!context)
            return undefined;
        return {
            context,
            diagnostic: sqlDiagnostic(sql),
            startedAtMs: nowMs()
        };
    }
    /**
     * Completes an optional physical-query profile attempt.
     * @param {TestProfileQueryAttempt | undefined} attempt - Profile handle.
     * @param {boolean} failed - Whether the physical driver call failed.
     * @returns {void}
     */
    _finishProfiledQueryAttempt(attempt, failed) {
        if (!attempt)
            return;
        attempt.context.profiler.recordDatabaseQuery(attempt.context, {
            durationMs: nowMs() - attempt.startedAtMs,
            failed,
            ...attempt.diagnostic
        });
    }
    /**
     * Runs every guard registered to the transaction frame.
     * @param {TransactionCallbackFrame} callbackFrame - Frame whose guards are completing.
     * @returns {Promise<void>} - Resolves when every guard accepts the commit.
     */
    async _runBeforeCommitCallbacks(callbackFrame) {
        for (const callback of callbackFrame.beforeCommitCallbacks) {
            await callback();
        }
    }
    /**
     * Merges committed callbacks into the parent transaction frame or runs them when the outermost commit completes.
     * @returns {Promise<void>} - Resolves when complete.
     */
    async _commitTransactionCallbackFrame() {
        const committedFrame = this._transactionCallbackFrames.pop();
        if (!committedFrame || committedFrame.afterCommitCallbacks.length === 0)
            return;
        const parentFrame = this._transactionCallbackFrames[this._transactionCallbackFrames.length - 1];
        if (parentFrame) {
            parentFrame.afterCommitCallbacks.push(...committedFrame.afterCommitCallbacks);
            return;
        }
        for (const callback of committedFrame.afterCommitCallbacks) {
            await callback();
        }
    }
    /**
     * Streams the rows of `sql` one at a time instead of buffering the whole result set, so a
     * caller can process an arbitrarily large result with bounded memory. This base implementation
     * falls back to a buffered {@link query} and yields its rows; drivers backed by a cursor-capable
     * client (the MySQL driver) override it with true server-side streaming.
     * @param {string} sql - SQL string to stream.
     * @param {QueryOptions} [options] - Query options, as for {@link query}.
     * @yields {Record<string, unknown>} - The result rows, one at a time.
     */
    async *queryStream(sql, options = {}) {
        const rows = await this.query(sql, options);
        for (const row of Array.isArray(rows) ? rows : []) {
            yield row;
        }
    }
    /**
     * Runs query.
     * @param {string} sql - SQL string.
     * @param {QueryOptions} [options] - Query options.
     * @returns {Promise<QueryResultType>} - Resolves with the query.
     */
    async query(sql, options = {}) {
        await this._waitForOperationLease(options.operationOwner);
        this._assertWritableQuery(sql);
        let tries = 0;
        const maxTries = 5;
        const requestTiming = this.configuration.getCurrentRequestTiming();
        const logQuery = options.logQuery ?? this._queryLoggingEnabled();
        const sourceStack = logQuery ? (options.sourceStack || Error().stack) : undefined;
        const querySql = this._querySqlWithProcessListComment(sql, options);
        while (tries < maxTries) {
            tries++;
            try {
                return await this._queryActualWithLogging({ originalSql: sql, querySql }, { ...options, logQuery, sourceStack }, requestTiming, tries);
            }
            catch (error) {
                if (!(error instanceof Error))
                    throw error;
                this._failedQueryDiagnostics.set(error, sqlDiagnostic(sql));
                // A deliberately-aborted query must never be silently re-run — its
                // connection was destroyed on purpose, so treat it as terminal.
                if (error instanceof QueryAbortedError)
                    throw error;
                const retryInfo = this.retryableDatabaseError(error);
                if (options.retry !== false && tries < maxTries && retryInfo.retry) {
                    if (retryInfo.reconnect) {
                        if (this._transactionsCount > 0) {
                            throw new Error(`Cannot reconnect while a transaction is active (${this._transactionsCount}). Original error: ${error.message}`, { cause: error });
                        }
                        await this.reconnect();
                    }
                    const waitMs = typeof retryInfo.waitMs === "number" && Number.isFinite(retryInfo.waitMs) ? retryInfo.waitMs : 100;
                    if (waitMs > 0)
                        await wait(waitMs);
                    const sensitiveValues = requestTiming ? requestTiming.getLogSensitiveValues() : new Set();
                    const loggedError = this.configuration.getLogRedactor().redactString(error.stack || error.message, sensitiveValues);
                    this.logger.warn(`Retrying query because failed with: ${loggedError}`);
                    // Retry
                }
                else {
                    throw error;
                }
            }
        }
        throw new Error("'query' unexpected came here");
    }
    /**
     * Executes a mutation and returns the number of rows changed by that statement.
     * @param {string} sql - Mutation SQL string.
     * @param {QueryOptions} [options] - Query ownership options.
     * @returns {Promise<number>} - Affected row count.
     */
    async affectedRows(sql, options = {}) {
        await this._waitForOperationLease(options.operationOwner);
        this._assertWritableQuery(sql);
        return await coordinateSharedTransactionConnection(this, async () => {
            await this.beforeQuery(sql, options);
            try {
                const profileAttempt = this._startProfiledQueryAttempt(sql);
                let failed = true;
                try {
                    const affectedRows = await this._runPhysicalConnectionRequest(async () => await this._affectedRowsActual(sql));
                    failed = false;
                    return affectedRows;
                }
                finally {
                    this._finishProfiledQueryAttempt(profileAttempt, failed);
                }
            }
            finally {
                await this.afterQuery(sql, options);
            }
        }, options.operationOwner);
    }
    /**
     * Runs query actual with logging.
     * @param {object} args - Options object.
     * @param {string} args.originalSql - Original SQL string before process-list comments.
     * @param {string} args.querySql - SQL string sent to the database.
     * @param {QueryOptions} options - Query options.
     * @param {import("../../http-server/client/request-timing.js").default | undefined} requestTiming - Request timing.
     * @param {number} tries - Query attempt count.
     * @returns {Promise<QueryResultType>} - Resolves with the query.
     */
    async _queryActualWithLogging({ originalSql, querySql }, options, requestTiming, tries) {
        const startedAtMs = nowMs();
        const previousActiveQuery = this._activeQuery;
        this._activeQuery = {
            annotations: getDatabaseAnnotations(),
            logName: options.logName || "SQL",
            sqlPreview: this._debugSqlPreview(originalSql),
            startedAtUnixMs: Date.now()
        };
        let result;
        try {
            try {
                const runQueryActualWithHooks = async () => await this._queryActualWithHooks(querySql, options, originalSql);
                if (requestTiming && tries === 1) {
                    result = await requestTiming.measureDbQuery(runQueryActualWithHooks);
                }
                else if (requestTiming) {
                    result = await requestTiming.measure("db", runQueryActualWithHooks);
                }
                else {
                    result = await runQueryActualWithHooks();
                }
            }
            finally {
                this._activeQuery = previousActiveQuery;
            }
        }
        catch (error) {
            if (options.logQuery !== false) {
                await this._logQuery({
                    elapsedMs: nowMs() - startedAtMs,
                    error: ensureError(error),
                    logName: options.logName || "SQL",
                    requestTiming,
                    sourceStack: options.sourceStack,
                    sql: originalSql
                });
            }
            throw error;
        }
        const elapsedMs = nowMs() - startedAtMs;
        if (options.logQuery !== false) {
            await this._logQuery({
                elapsedMs,
                logName: options.logName || "SQL",
                requestTiming,
                sourceStack: options.sourceStack,
                sql: originalSql
            });
        }
        if (this._schemaCacheInvalidatingSql(originalSql)) {
            this.clearSchemaCache();
        }
        return result;
    }
    /**
     * Runs query actual with before/after hooks.
     * @param {string} sql - SQL string.
     * @param {QueryOptions} options - Query options.
     * @param {string} originalSql - SQL before process-list comments.
     * @returns {Promise<QueryResultType>} - Resolves with the query.
     */
    async _queryActualWithHooks(sql, options, originalSql) {
        return await coordinateSharedTransactionConnection(this, async () => {
            await this.beforeQuery(sql, options);
            try {
                const profileAttempt = this._startProfiledQueryAttempt(originalSql);
                let failed = true;
                try {
                    const result = await this._runPhysicalConnectionRequest(async () => await this._queryActual(sql, options));
                    failed = false;
                    return result;
                }
                finally {
                    this._finishProfiledQueryAttempt(profileAttempt, failed);
                }
            }
            finally {
                await this.afterQuery(sql, options);
            }
        }, options.operationOwner);
    }
    /**
     * Hook that runs immediately before a SQL query is sent to the driver.
     * @param {string} _sql - SQL string.
     * @param {QueryOptions} _options - Query options.
     * @returns {Promise<void>} - Resolves when complete.
     */
    async beforeQuery(_sql, _options) {
        // No-op by default
    }
    /**
     * Hook that runs immediately after a SQL query has completed or failed.
     * @param {string} _sql - SQL string.
     * @param {QueryOptions} _options - Query options.
     * @returns {Promise<void>} - Resolves when complete.
     */
    async afterQuery(_sql, _options) {
        // No-op by default
    }
    /**
     * Runs get debug snapshot.
     * @returns {DatabaseConnectionDebugSnapshot} - Diagnostic snapshot for this connection.
     */
    getDebugSnapshot() {
        const now = Date.now();
        const activeQuery = this._activeQuery;
        return {
            activeQuery: activeQuery ? { ...activeQuery, runningMs: Math.max(0, now - activeQuery.startedAtUnixMs) } : null,
            checkoutAgeMs: this._connectionCheckedOutAtUnixMs ? Math.max(0, now - this._connectionCheckedOutAtUnixMs) : undefined,
            checkedOutAtUnixMs: this._connectionCheckedOutAtUnixMs,
            checkoutName: this._connectionCheckoutName,
            driverClass: this.constructor.name,
            idSeq: this.idSeq,
            openTransactions: this._transactionsCount,
            schemaCacheEntries: this._schemaCache.size
        };
    }
    /**
     * Returns a bounded prefix of `sql` for lightweight diagnostic scanning.
     * @param {string} sql - SQL string.
     * @param {number} limit - Maximum code units to inspect.
     * @returns {string} - Prefix of `sql`.
     */
    _diagnosticSqlPrefix(sql, limit) {
        return sql.length <= limit ? sql : sql.slice(0, limit);
    }
    /**
     * Runs debug sql preview.
     * @param {string} sql - SQL to preview.
     * @returns {string} - Normalized truncated SQL preview for diagnostics.
     */
    _debugSqlPreview(sql) {
        const prefix = this._diagnosticSqlPrefix(sql, SQL_PREVIEW_SCAN_LIMIT);
        return prefix
            .replace(/\s+/g, " ")
            .trim()
            .slice(0, 500);
    }
    /**
     * Runs query sql with process list comment.
     * @param {string} sql - SQL string.
     * @param {QueryOptions} options - Query options.
     * @returns {string} - SQL string with a leading process-list comment when annotations exist.
     */
    _querySqlWithProcessListComment(sql, options) {
        if (options.processListComment === false)
            return sql;
        const parts = [];
        if (this._connectionCheckoutName) {
            parts.push(`checkout="${this._processListCommentValue(this._connectionCheckoutName)}"`);
        }
        const annotations = getDatabaseAnnotations();
        if (annotations.length > 0) {
            parts.push(`annotations="${this._processListCommentValue(annotations.join(" > "))}"`);
        }
        if (parts.length === 0)
            return sql;
        return `/* velocious ${parts.join(" ")} */ ${sql}`;
    }
    /**
     * Runs process list comment value.
     * @param {string} value - Raw process-list comment value.
     * @returns {string} - Sanitized process-list comment value.
     */
    _processListCommentValue(value) {
        let sanitized = "";
        for (const character of value) {
            const codePoint = character.codePointAt(0);
            sanitized += codePoint !== undefined && (codePoint < 32 || codePoint === 127) ? " " : character;
        }
        return sanitized
            .replace(/\*\//g, "* /")
            .replace(/\s+/g, " ")
            .trim()
            .slice(0, 200)
            .replace(/"/g, "'");
    }
    /**
     * Reads the next SQL token starting at `startIndex`, skipping leading trivia
     * (BOM, whitespace, block comments, line comments). If the scan cannot finish
     * skipping trivia before `limit`, the result is marked incomplete so callers
     * can conservatively treat the statement as schema-invalidating.
     * @param {string} sql - SQL string.
     * @param {number} startIndex - Index to start scanning.
     * @param {number} limit - Maximum absolute index to scan while skipping leading trivia.
     * @returns {SqlTokenResult} - Token result.
     */
    _readSqlToken(sql, startIndex, limit) {
        let i = startIndex;
        const len = sql.length;
        while (i < len && i < limit) {
            const char = sql[i];
            if (char === "\ufeff" || /\s/.test(char)) {
                i++;
                continue;
            }
            if (char === "/" && sql[i + 1] === "*") {
                const close = sql.indexOf("*/", i + 2);
                if (close === -1 || close + 2 > limit) {
                    return { incomplete: true, index: i, token: undefined };
                }
                i = close + 2;
                continue;
            }
            if (char === "-" && sql[i + 1] === "-") {
                const newline = sql.indexOf("\n", i + 2);
                if (newline === -1) {
                    return { incomplete: false, index: len, token: undefined };
                }
                if (newline + 1 > limit) {
                    return { incomplete: true, index: i, token: undefined };
                }
                i = newline + 1;
                continue;
            }
            let token = "";
            while (i < len) {
                const c = sql[i];
                if (/\s/.test(c) || c === "\ufeff")
                    break;
                if (c === "/" && sql[i + 1] === "*")
                    break;
                if (c === "-" && sql[i + 1] === "-")
                    break;
                token += c;
                i++;
            }
            return { incomplete: false, token: token.toLowerCase(), index: i };
        }
        if (i >= len) {
            return { incomplete: false, index: len, token: undefined };
        }
        return { incomplete: true, index: i, token: undefined };
    }
    /**
     * Runs schema cache invalidating sql.
     * @param {string} sql - SQL string.
     * @returns {boolean} - Whether the SQL should invalidate schema metadata.
     */
    _schemaCacheInvalidatingSql(sql) {
        const first = this._readSqlToken(sql, 0, SCHEMA_INVALIDATION_SCAN_LIMIT);
        if (first.incomplete)
            return true;
        const firstToken = first.token;
        if (!firstToken)
            return false;
        if (/^(create|alter|drop|rename)$/.test(firstToken))
            return true;
        if (firstToken === "comment") {
            const next = this._readSqlToken(sql, first.index, SCHEMA_INVALIDATION_SCAN_LIMIT);
            return next.incomplete || next.token === "on";
        }
        if (firstToken === "exec" || firstToken === "execute") {
            const next = this._readSqlToken(sql, first.index, SCHEMA_INVALIDATION_SCAN_LIMIT);
            return next.incomplete || next.token === "sp_rename";
        }
        if (firstToken === "if") {
            let index = first.index;
            while (true) {
                const result = this._readSqlToken(sql, index, SCHEMA_INVALIDATION_SCAN_LIMIT);
                if (result.incomplete)
                    return true;
                if (!result.token)
                    return false;
                if (result.token === "begin") {
                    const ddlResult = this._readSqlToken(sql, result.index, SCHEMA_INVALIDATION_SCAN_LIMIT);
                    return ddlResult.incomplete || /^(create|alter|drop|rename)$/.test(ddlResult.token || "");
                }
                index = result.index;
            }
        }
        return false;
    }
    /**
     * Runs query logging enabled.
     * @returns {boolean} - Whether query logging is enabled for this driver.
     */
    _queryLoggingEnabled() {
        if (!this.configuration)
            return true;
        if (!this.configuration.getQueryLoggingEnabled())
            return false;
        const logger = new Logger("SQL", { configuration: this.configuration });
        return logger.isLevelEnabled("info");
    }
    /**
     * Runs log query.
     * @param {object} args - Options object.
     * @param {number} args.elapsedMs - Elapsed milliseconds.
     * @param {Error} [args.error] - Query failure, when the driver call failed.
     * @param {string} args.logName - Query log subject.
     * @param {import("../../http-server/client/request-timing.js").default | undefined} args.requestTiming - Request timing.
     * @param {string | undefined} args.sourceStack - Source stack.
     * @param {string} args.sql - SQL string.
     * @returns {Promise<void>} - Resolves when complete.
     */
    async _logQuery({ elapsedMs, error, logName, requestTiming, sourceStack, sql }) {
        const logger = new Logger(logName, { configuration: this.configuration });
        const sourceLine = this._querySourceLine(sourceStack);
        const sensitiveValues = requestTiming ? requestTiming.getLogSensitiveValues() : new Set();
        const redactor = this.configuration.getLogRedactor();
        const loggedSql = redactor.redactString(sql, sensitiveValues);
        const failure = error
            ? ` FAILED ${error.name}: ${redactor.redactString(error.message, sensitiveValues)}`
            : "";
        const message = sourceLine
            ? `(${formatElapsedMs(elapsedMs)})${failure}  ${loggedSql}\n  ↳ ${sourceLine}`
            : `(${formatElapsedMs(elapsedMs)})${failure}  ${loggedSql}`;
        await logger.info(message);
    }
    /**
     * Runs query source line.
     * @param {string | undefined} sourceStack - Source stack.
     * @returns {string | undefined} - Source line when an application frame is available.
     */
    _querySourceLine(sourceStack) {
        if (!sourceStack)
            return undefined;
        const applicationDirectory = this.configuration
            ? this.configuration.getDirectoryIfAvailable()
            : undefined;
        if (!applicationDirectory)
            return undefined;
        const error = new Error("Query source");
        error.stack = sourceStack;
        return BacktraceCleaner.getApplicationSourceLine(error, {
            applicationDirectory,
            frameworkSourceDirectory: this.configuration.getEnvironmentHandler().getFrameworkSourceDirectory()
        });
    }
    /**
     * Runs query actual.
     * @abstract
     * @param {string} sql - SQL string.
     * @param {QueryOptions} [options] - Query options (carries the optional abort signal).
     * @returns {Promise<QueryResultType>} - Resolves with the query actual.
     */
    _queryActual(sql, options) {
        throw new Error(`queryActual not implemented`);
    }
    /**
     * Executes a mutation and returns its affected row count.
     * @abstract
     * @param {string} sql - Mutation SQL string.
     * @returns {Promise<number>} - Affected row count.
     */
    _affectedRowsActual(sql) {
        throw new Error(`affectedRowsActual not implemented`);
    }
    /**
     * Runs query to sql.
     * @abstract
     * @param {Query} _query - Query instance.
     * @returns {string} - SQL string.
     */
    queryToSql(_query) { throw new Error("queryToSql not implemented"); }
    /**
     * Runs retryable database error.
     * @param {Error} _error - Error instance.
     * @returns {RetryableDatabaseErrorResult} - Retry info.
     */
    retryableDatabaseError(_error) {
        return { retry: false, reconnect: false };
    }
    /**
     * Runs assert writable query.
     * @param {string} sql - SQL string.
     * @returns {void} - No return value.
     */
    _assertWritableQuery(sql) {
        if (!this.isReadOnly())
            return;
        if (!this._sqlLooksLikeWrite(sql))
            return;
        throw new Error("Database is read-only");
    }
    /**
     * Runs assert not read only.
     * @returns {void} - No return value.
     */
    _assertNotReadOnly() {
        if (this.isReadOnly()) {
            throw new Error("Database is read-only");
        }
    }
    /**
     * Runs sql looks like write.
     * @param {string} sql - SQL string.
     * @returns {boolean} - SQL representation.
     */
    _sqlLooksLikeWrite(sql) {
        const normalized = sql.trim().toLowerCase();
        if (!normalized)
            return false;
        if (normalized.startsWith("select") ||
            normalized.startsWith("show") ||
            normalized.startsWith("pragma") ||
            normalized.startsWith("explain") ||
            normalized.startsWith("describe")) {
            return false;
        }
        if (normalized.startsWith("with")) {
            const withMatch = normalized.match(/^\s*with[\s\S]+?\)\s*(select|insert|update|delete|merge|replace)\b/);
            if (withMatch) {
                return withMatch[1] !== "select";
            }
            return false;
        }
        const keywordMatch = normalized.match(/^\s*(\w+)/);
        const keyword = keywordMatch ? keywordMatch[1] : "";
        return [
            "insert",
            "update",
            "delete",
            "create",
            "alter",
            "drop",
            "truncate",
            "merge",
            "replace"
        ].includes(keyword);
    }
    /**
     * Runs is read only.
     * @returns {boolean} - Whether read only.
     */
    isReadOnly() {
        return Boolean(this.getArgs().readOnly);
    }
    /**
     * Runs rollback transaction.
     * @param {Pick<QueryOptions, "operationOwner">} [options] - Transaction ownership.
     * @returns {Promise<void>} - Resolves when complete.
     */
    async rollbackTransaction(options = {}) {
        await coordinateSharedTransactionConnection(this, async () => {
            await this._transactionsActionsMutex.sync(async () => {
                try {
                    await this._runProfiledTransactionAction("rollback", async () => {
                        await this._rollbackTransactionAction(options);
                    });
                }
                finally {
                    // Driver recovery may need to clear a stale physical transaction when
                    // no logical transaction is active. Never let that cleanup underflow
                    // the logical depth and turn the next root transaction into a savepoint.
                    if (this._transactionsCount > 0)
                        this._transactionsCount--;
                    this._resolveCompletedTransaction();
                    // A rolled-back transaction may have reverted DDL (e.g. a CREATE TABLE
                    // run lazily inside the transaction), so any cached schema metadata is
                    // now stale and must be invalidated. Without this, a later tableExists()
                    // check can report a table that the rollback already removed, so callers
                    // skip recreating it and then fail with "no such table".
                    this.clearSchemaCache();
                }
            });
        }, options.operationOwner);
    }
    /**
     * Runs rollback transaction action.
     * @param {Pick<QueryOptions, "operationOwner">} [options] - Transaction ownership.
     * @returns {Promise<void>} - Resolves when complete.
     */
    async _rollbackTransactionAction(options = {}) {
        await this.query("ROLLBACK", options);
    }
    /**
     * Runs generate save point name.
     * @returns {string} - The generate save point name.
     */
    generateSavePointName() {
        return `sp${new UUID(4).format().replaceAll("-", "")}`;
    }
    /**
     * Runs start save point.
     * @param {string} savePointName - Save point name.
     * @param {Pick<QueryOptions, "operationOwner">} [options] - Transaction ownership.
     * @returns {Promise<void>} - Resolves when complete.
     */
    async startSavePoint(savePointName, options = {}) {
        await coordinateSharedTransactionConnection(this, async () => {
            await this._transactionsActionsMutex.sync(async () => {
                await this._startSavePointAction(savePointName, options);
            });
        }, options.operationOwner);
    }
    /**
     * Runs start save point action.
     * @param {string} savePointName - Save point name.
     * @param {Pick<QueryOptions, "operationOwner">} [options] - Transaction ownership.
     * @returns {Promise<void>} - Resolves when complete.
     */
    async _startSavePointAction(savePointName, options = {}) {
        await this.query(`SAVEPOINT ${savePointName}`, options);
    }
    /**
     * Runs rename column.
     * @param {string} tableName - Table name.
     * @param {string} oldColumnName - Previous column name.
     * @param {string} newColumnName - New column name.
     * @returns {Promise<void>} - Resolves when complete.
     */
    async renameColumn(tableName, oldColumnName, newColumnName) {
        this._assertNotReadOnly();
        const tableColumn = new TableColumn(oldColumnName);
        tableColumn.setNewName(newColumnName);
        const tableData = new TableData(tableName);
        tableData.addColumn(tableColumn);
        const alterTableSQLs = await this.alterTableSQLs(tableData);
        for (const alterTableSQL of alterTableSQLs) {
            await this.query(alterTableSQL);
        }
    }
    /**
     * Runs release save point.
     * @param {string} savePointName - Save point name.
     * @param {Pick<QueryOptions, "operationOwner">} [options] - Transaction ownership.
     * @returns {Promise<void>} - Resolves when complete.
     */
    async releaseSavePoint(savePointName, options = {}) {
        await coordinateSharedTransactionConnection(this, async () => {
            await this._transactionsActionsMutex.sync(async () => {
                await this._releaseSavePointAction(savePointName, options);
            });
        }, options.operationOwner);
    }
    /**
     * Runs release save point action.
     * @param {string} savePointName - Save point name.
     * @param {Pick<QueryOptions, "operationOwner">} [options] - Transaction ownership.
     * @returns {Promise<void>} - Resolves when complete.
     */
    async _releaseSavePointAction(savePointName, options = {}) {
        try {
            await this.query(`RELEASE SAVEPOINT ${savePointName}`, options);
        }
        catch (error) {
            const message = error instanceof Error ? error.message : `${error}`;
            // Savepoint may already be gone if the database rolled back automatically
            if (message.toLowerCase().includes("savepoint") && message.toLowerCase().includes("does not exist")) {
                this.logger.debug(`Release savepoint ignored because it no longer exists: ${savePointName}`);
                return;
            }
            throw error;
        }
    }
    /**
     * Runs rollback save point.
     * @param {string} savePointName - Save point name.
     * @param {Pick<QueryOptions, "operationOwner">} [options] - Transaction ownership.
     * @returns {Promise<void>} - Resolves when complete.
     */
    async rollbackSavePoint(savePointName, options = {}) {
        await coordinateSharedTransactionConnection(this, async () => {
            await this._transactionsActionsMutex.sync(async () => {
                await this._rollbackSavePointAction(savePointName, options);
            });
        }, options.operationOwner);
    }
    /**
     * Runs rollback save point action.
     * @param {string} savePointName - Save point name.
     * @param {Pick<QueryOptions, "operationOwner">} [options] - Transaction ownership.
     * @returns {Promise<void>} - Resolves when complete.
     */
    async _rollbackSavePointAction(savePointName, options = {}) {
        await this.query(`ROLLBACK TO SAVEPOINT ${savePointName}`, options);
    }
    /**
     * Truncates the given table snapshot. Drivers can override this to issue one batch.
     * @protected
     * @param {Array<import("./base-table.js").default>} tables - Eligible tables for this cleanup attempt.
     * @returns {Promise<void>} - Resolves when every table has been cleaned.
     */
    async truncateTables(tables) {
        const truncateErrors = [];
        for (const table of tables) {
            try {
                await table.truncate({ cascade: true });
            }
            catch (error) {
                truncateErrors.push(error);
            }
        }
        if (truncateErrors.length > 0)
            throw truncateErrors[0];
    }
    /**
     * Runs truncate all tables.
     * @returns {Promise<void>} - Resolves when complete.
     */
    async truncateAllTables() {
        this._assertNotReadOnly();
        let tables = (await this.getTables()).filter((table) => table.getName() != "schema_migrations");
        if (tables.length == 0)
            return;
        await this.withDisabledForeignKeys(async () => {
            for (let tries = 1; tries <= 6; tries++) {
                try {
                    await this.truncateTables(tables);
                    return;
                }
                catch (error) {
                    console.error(error);
                    if (tries == 6)
                        throw error;
                    // A truncate failed — the schema cache may still list a table that was
                    // dropped out from under us (e.g. a db:rollback test that left the
                    // shared DB rolled back). Clear it so the next pass re-reads the live
                    // table list and no longer tries to truncate a table that is gone.
                    this.clearSchemaCache();
                    tables = (await this.getTables()).filter((table) => table.getName() != "schema_migrations");
                    if (tables.length == 0)
                        return;
                }
            }
        });
        await this.flushPendingWrites();
    }
    /**
     * Runs update.
     * @param {UpdateSqlArgsType} args - Options object.
     * @returns {Promise<void>} - Resolves when complete.
     */
    async update(args) {
        this._assertNotReadOnly();
        const sql = this.updateSql(args);
        await this.query(sql);
    }
    /**
     * Runs update sql.
     * @abstract
     * @param {UpdateSqlArgsType} args - Options object.
     * @returns {string} - SQL string.
     */
    updateSql(args) {
        throw new Error("'disableForeignKeys' not implemented");
    }
    /**
     * Runs upsert sql.
     * @abstract
     * @param {UpsertSqlArgsType} args - Options object.
     * @returns {string} - SQL string.
     */
    upsertSql(args) {
        throw new Error("'upsertSql' not implemented");
    }
    /**
     * Runs disable foreign keys.
     * @abstract
     * @returns {Promise<void>} - Resolves when complete.
     */
    disableForeignKeys() {
        throw new Error("'disableForeignKeys' not implemented");
    }
    /**
     * Runs enable foreign keys.
     * @abstract
     * @returns {Promise<void>} - Resolves when complete.
     */
    enableForeignKeys() {
        throw new Error("'enableForeignKeys' not implemented");
    }
    /**
     * Runs with disabled foreign keys.
     * @param {() => void} callback - Callback function.
     * @returns {Promise<ReturnType<typeof JSON.parse>>} - Resolves with the with disabled foreign keys.
     */
    async withDisabledForeignKeys(callback) {
        await this.disableForeignKeys();
        try {
            return await callback();
        }
        finally {
            await this.enableForeignKeys();
        }
    }
    /**
     * Blocks until a named advisory lock is acquired on this connection.
     * Advisory locks are connection-scoped and do not interact with row or
     * table locks; they are purely cooperative between callers that use the
     * same name and let you serialize functionality without blocking readers
     * or writers that do not participate in the same lock.
     * @param {string} name - Lock name.
     * @param {{timeoutMs?: number | null}} [args] - Optional timeout in milliseconds; `null` or undefined blocks forever.
     * @returns {Promise<boolean>} - Resolves to true when the lock has been acquired, false if the timeout elapsed.
     */
    async acquireAdvisoryLock(name, args = {}) {
        const acquired = await this._acquireAdvisoryLock(name, args);
        if (acquired)
            this._trackAdvisoryLock(name);
        return acquired;
    }
    /**
     * Driver-specific blocking advisory-lock acquisition hook.
     * @abstract
     * @param {string} name - Lock name.
     * @param {{timeoutMs?: number | null}} [_args] - Lock timeout options.
     * @returns {Promise<boolean>} - Whether the lock was acquired.
     */
    _acquireAdvisoryLock(name, _args = {}) {
        throw new Error(`'_acquireAdvisoryLock' not implemented for ${this.constructor.name}`);
    }
    /**
     * Attempts to acquire a named advisory lock without blocking.
     * @param {string} name - Lock name.
     * @returns {Promise<boolean>} - Resolves to true if the lock was acquired, false if it was already held.
     */
    async tryAcquireAdvisoryLock(name) {
        const acquired = await this._tryAcquireAdvisoryLock(name);
        if (acquired)
            this._trackAdvisoryLock(name);
        return acquired;
    }
    /**
     * Driver-specific non-blocking advisory-lock acquisition hook.
     * @abstract
     * @param {string} name - Lock name.
     * @returns {Promise<boolean>} - Whether the lock was acquired.
     */
    _tryAcquireAdvisoryLock(name) {
        throw new Error(`'_tryAcquireAdvisoryLock' not implemented for ${this.constructor.name}`);
    }
    /**
     * Releases a named advisory lock previously acquired on this connection.
     * @param {string} name - Lock name.
     * @returns {Promise<boolean>} - Resolves to true if the lock was held by this session and has now been released.
     */
    async releaseAdvisoryLock(name) {
        const released = await this._releaseAdvisoryLock(name);
        if (released) {
            this._untrackAdvisoryLock(name);
        }
        else {
            this._heldAdvisoryLocks.delete(name);
        }
        return released;
    }
    /**
     * Driver-specific advisory-lock release hook.
     * @abstract
     * @param {string} name - Lock name.
     * @returns {Promise<boolean>} - Whether the lock was released.
     */
    _releaseAdvisoryLock(name) {
        throw new Error(`'_releaseAdvisoryLock' not implemented for ${this.constructor.name}`);
    }
    /**
     * Releases every advisory lock still tracked on this connection.
     * @returns {Promise<void>} - Resolves when every tracked lock is released.
     */
    async releaseHeldAdvisoryLocks() {
        /** @type {Error[]} */
        const errors = [];
        for (const name of [...this._heldAdvisoryLocks.keys()]) {
            while (this._heldAdvisoryLocks.has(name)) {
                try {
                    await this.releaseAdvisoryLock(name);
                }
                catch (error) {
                    errors.push(error instanceof Error ? error : new Error(`Failed to release advisory lock ${JSON.stringify(name)}`, { cause: error }));
                    break;
                }
            }
        }
        if (errors.length == 1)
            throw errors[0];
        if (errors.length > 1)
            throw new AggregateError(errors, "Failed to release held advisory locks");
    }
    /**
     * Records one successful acquisition, including re-entrant acquisitions.
     * @param {string} name - Lock name.
     * @returns {void}
     */
    _trackAdvisoryLock(name) {
        this._heldAdvisoryLocks.set(name, (this._heldAdvisoryLocks.get(name) || 0) + 1);
    }
    /**
     * Removes one successful acquisition from the connection registry.
     * @param {string} name - Lock name.
     * @returns {void}
     */
    _untrackAdvisoryLock(name) {
        const remainingCount = (this._heldAdvisoryLocks.get(name) || 0) - 1;
        if (remainingCount > 0) {
            this._heldAdvisoryLocks.set(name, remainingCount);
        }
        else {
            this._heldAdvisoryLocks.delete(name);
        }
    }
    /**
     * Checks whether a named advisory lock is currently held by any session.
     * Intended as an introspection helper; callers who need to act on the
     * result should prefer `tryAcquireAdvisoryLock` to avoid a TOCTOU race.
     * @abstract
     * @param {string} name - Lock name.
     * @returns {Promise<boolean>} - Resolves to true if the lock is held by ? session.
     */
    isAdvisoryLockHeld(name) {
        throw new Error(`'isAdvisoryLockHeld' not implemented for ${this.constructor.name}`);
    }
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiYmFzZS5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uLy4uLy4uLy4uL3NyYy9kYXRhYmFzZS9kcml2ZXJzL2Jhc2UuanMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6IkFBQUEsWUFBWTtBQUVaOzs7Ozs7OztHQVFHO0FBQ0g7Ozs7O0dBS0c7QUFDSDs7Ozs7R0FLRztBQUNIOzs7OztHQUtHO0FBQ0g7Ozs7Ozs7OztHQVNHO0FBQ0g7Ozs7R0FJRztBQUNIOzs7OztHQUtHO0FBQ0g7Ozs7Ozs7OztHQVNHO0FBQ0g7Ozs7Ozs7Ozs7Ozs7R0FhRztBQUVIOzs7Ozs7Ozs7Ozs7Ozs7OztHQWlCRztBQUVIOzs7Ozs7R0FNRztBQUVIOzs7Ozs7OztHQVFHO0FBRUg7Ozs7Ozs7Ozs7O0dBV0c7QUFFSDs7Ozs7OztHQU9HO0FBRUg7Ozs7OztHQU1HO0FBQ0g7Ozs7Ozs7R0FPRztBQUVIOzs7Ozs7R0FNRztBQUVILE9BQU8sZ0JBQWdCLE1BQU0sa0NBQWtDLENBQUE7QUFDL0QsT0FBTyxFQUFFLHNCQUFzQixFQUFFLE1BQU0sbUJBQW1CLENBQUE7QUFDMUQsT0FBTyxFQUFFLHFCQUFxQixFQUFFLE1BQU0sd0JBQXdCLENBQUE7QUFDOUQsT0FBTyxNQUFNLE1BQU0sd0JBQXdCLENBQUE7QUFDM0MsT0FBTyxNQUFNLE1BQU0saUJBQWlCLENBQUE7QUFDcEMsT0FBTyxLQUFLLE1BQU0sbUJBQW1CLENBQUE7QUFDckMsT0FBTyxpQkFBaUIsTUFBTSwyQkFBMkIsQ0FBQTtBQUN6RCxPQUFPLE9BQU8sTUFBTSxlQUFlLENBQUE7QUFDbkMsT0FBTyxFQUFFLGNBQWMsRUFBRSxNQUFNLGlDQUFpQyxDQUFBO0FBQ2hFLE9BQU8sS0FBSyxNQUFNLDJCQUEyQixDQUFBO0FBQzdDLE9BQU8sSUFBSSxNQUFNLFdBQVcsQ0FBQTtBQUM1QixPQUFPLFNBQVMsTUFBTSx3QkFBd0IsQ0FBQTtBQUM5QyxPQUFPLFdBQVcsTUFBTSwrQkFBK0IsQ0FBQTtBQUN2RCxPQUFPLGVBQWUsTUFB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QztRQUVELElBQUksTUFBTSxDQUFDLE1BQU0sSUFBSSxDQUFDO1lBQUUsTUFBTSxNQUFNLENBQUMsQ0FBQyxDQUFDLENBQUE7UUFDdkMsSUFBSSxNQUFNLENBQUMsTUFBTSxHQUFHLENBQUM7WUFBRSxNQUFNLElBQUksY0FBYyxDQUFDLE1BQU0sRUFBRSx1Q0FBdUMsQ0FBQyxDQUFBO0lBQ2xHLENBQUM7SUFFRDs7OztPQUlHO0lBQ0gsa0JBQWtCLENBQUMsSUFBSTtRQUNyQixJQUFJLENBQUMsa0JBQWtCLENBQUMsR0FBRyxDQUFDLElBQUksRUFBRSxDQUFDLElBQUksQ0FBQyxrQkFBa0IsQ0FBQyxHQUFHLENBQUMsSUFBSSxDQUFDLElBQUksQ0FBQyxDQUFDLEdBQUcsQ0FBQyxDQUFDLENBQUE7SUFDakYsQ0FBQztJQUVEOzs7O09BSUc7SUFDSCxvQkFBb0IsQ0FBQyxJQUFJO1FBQ3ZCLE1BQU0sY0FBYyxHQUFHLENBQUMsSUFBSSxDQUFDLGtCQUFrQixDQUFDLEdBQUcsQ0FBQyxJQUFJLENBQUMsSUFBSSxDQUFDLENBQUMsR0FBRyxDQUFDLENBQUE7UUFFbkUsSUFBSSxjQUFjLEdBQUcsQ0FBQyxFQUFFLENBQUM7WUFDdkIsSUFBSSxDQUFDLGtCQUFrQixDQUFDLEdBQUcsQ0FBQyxJQUFJLEVBQUUsY0FBYyxDQUFDLENBQUE7UUFDbkQsQ0FBQzthQUFNLENBQUM7WUFDTixJQUFJLENBQUMsa0JBQWtCLENBQUMsTUFBTSxDQUFDLElBQUksQ0FBQyxDQUFBO1FBQ3RDLENBQUM7SUFDSCxDQUFDO0lBRUQ7Ozs7Ozs7T0FPRztJQUNILGtCQUFrQixDQUFDLElBQUk7UUFDckIsTUFBTSxJQUFJLEtBQUssQ0FBQyw0Q0FBNEMsSUFBSSxDQUFDLFdBQVcsQ0FBQyxJQUFJLEVBQUUsQ0FBQyxDQUFBO0lBQ3RGLENBQUM7Q0FDRiIsInNvdXJjZXNDb250ZW50IjpbIi8vIEB0cy1jaGVja1xuXG4vKipcbiAqIENyZWF0ZUluZGV4U3FsQXJncyB0eXBlLlxuICogQHR5cGVkZWYge29iamVjdH0gQ3JlYXRlSW5kZXhTcWxBcmdzXG4gKiBAcHJvcGVydHkge0FycmF5PHN0cmluZyB8IGltcG9ydChcIi4vLi4vdGFibGUtZGF0YS90YWJsZS1jb2x1bW4uanNcIikuZGVmYXVsdD59IGNvbHVtbnMgLSBDb2x1bW5zIHRvIGluY2x1ZGUgaW4gdGhlIGluZGV4LlxuICogQHByb3BlcnR5IHtib29sZWFufSBbaWZOb3RFeGlzdHNdIC0gU2tpcCBjcmVhdGlvbiBpZiB0aGUgaW5kZXggYWxyZWFkeSBleGlzdHMuXG4gKiBAcHJvcGVydHkge3N0cmluZ30gW25hbWVdIC0gRXhwbGljaXQgaW5kZXggbmFtZSB0byB1c2UuXG4gKiBAcHJvcGVydHkge2Jvb2xlYW59IFt1bmlxdWVdIC0gV2hldGhlciB0aGUgaW5kZXggc2hvdWxkIGVuZm9yY2UgdW5pcXVlbmVzcy5cbiAqIEBwcm9wZXJ0eSB7c3RyaW5nfSB0YWJsZU5hbWUgLSBOYW1lIG9mIHRoZSB0YWJsZSB0byBhZGQgdGhlIGluZGV4IHRvLlxuICovXG4vKipcbiAqIFJlbW92ZUluZGV4U3FsQXJncyB0eXBlLlxuICogQHR5cGVkZWYge29iamVjdH0gUmVtb3ZlSW5kZXhTcWxBcmdzXG4gKiBAcHJvcGVydHkge3N0cmluZ30gbmFtZSAtIEluZGV4IG5hbWUgdG8gZHJvcC5cbiAqIEBwcm9wZXJ0eSB7c3RyaW5nfSB0YWJsZU5hbWUgLSBOYW1lIG9mIHRoZSB0YWJsZSB0aGUgaW5kZXggYmVsb25ncyB0by5cbiAqL1xuLyoqXG4gKiBEcm9wVGFibGVTcWxBcmdzVHlwZSB0eXBlLlxuICogQHR5cGVkZWYge29iamVjdH0gRHJvcFRhYmxlU3FsQXJnc1R5cGVcbiAqIEBwcm9wZXJ0eSB7Ym9vbGVhbn0gW2Nhc2NhZGVdIC0gV2hldGhlciBkZXBlbmRlbnQgb2JqZWN0cyBzaG91bGQgYmUgZHJvcHBlZCB0b28uXG4gKiBAcHJvcGVydHkge2Jvb2xlYW59IFtpZkV4aXN0c10gLSBTa2lwIGRyb3BwaW5nIGlmIHRoZSB0YWJsZSBkb2VzIG5vdCBleGlzdC5cbiAqL1xuLyoqXG4gKiBEZWxldGVTcWxBcmdzVHlwZSB0eXBlLlxuICogQHR5cGVkZWYge29iamVjdH0gRGVsZXRlU3FsQXJnc1R5cGVcbiAqIEBwcm9wZXJ0eSB7c3RyaW5nfSB0YWJsZU5hbWUgLSBUYWJsZSBuYW1lIHRvIGRlbGV0ZSBmcm9tLlxuICogQHByb3BlcnR5IHt7W2tleTogc3RyaW5nXTogUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59fSBjb25kaXRpb25zIC0gQ29uZGl0aW9ucyB1c2VkIHRvIGJ1aWxkIHRoZSBkZWxldGUgV0hFUkUgY2xhdXNlLlxuICovXG4vKipcbiAqIEluc2VydFNxbEFyZ3NUeXBlIHR5cGUuXG4gKiBAdHlwZWRlZiB7b2JqZWN0fSBJbnNlcnRTcWxBcmdzVHlwZVxuICogQHByb3BlcnR5IHtzdHJpbmdbXX0gW2NvbHVtbnNdIC0gQ29sdW1uIG5hbWVzIGZvciBgcm93c2AgaW5zZXJ0cy5cbiAqIEBwcm9wZXJ0eSB7e1trZXk6IHN0cmluZ106IFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fX0gW2RhdGFdIC0gQ29sdW1uL3ZhbHVlIHBhaXJzIGZvciBhIHNpbmdsZS1yb3cgaW5zZXJ0LlxuICogQHByb3BlcnR5IHtib29sZWFufSBbbXVsdGlwbGVdIC0gV2hldGhlciB0aGlzIGluc2VydCBzaG91bGQgYmUgdHJlYXRlZCBhcyBtdWx0aS1yb3cuXG4gKiBAcHJvcGVydHkge3N0cmluZ1tdfSBbcmV0dXJuTGFzdEluc2VydGVkQ29sdW1uTmFtZXNdIC0gQ29sdW1uIG5hbWVzIHRvIHJldHVybiBhZnRlciBpbnNlcnQuXG4gKiBAcHJvcGVydHkge0FycmF5PEFycmF5PFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pj59IFtyb3dzXSAtIFJvdyB2YWx1ZXMgZm9yIGEgbXVsdGktcm93IGluc2VydC5cbiAqIEBwcm9wZXJ0eSB7c3RyaW5nfSB0YWJsZU5hbWUgLSBUYWJsZSBuYW1lIHRvIGluc2VydCBpbnRvLlxuICovXG4vKipcbiAqIFF1ZXJ5Um93VHlwZSB0eXBlLlxuICogQHR5cGVkZWYge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gUXVlcnlSb3dUeXBlXG4gKiBAdHlwZWRlZiB7QXJyYXk8UXVlcnlSb3dUeXBlPn0gUXVlcnlSZXN1bHRUeXBlXG4gKi9cbi8qKlxuICogVHJhbnNhY3Rpb25DYWxsYmFja0ZyYW1lIHR5cGUuXG4gKiBAdHlwZWRlZiB7b2JqZWN0fSBUcmFuc2FjdGlvbkNhbGxiYWNrRnJhbWVcbiAqIEBwcm9wZXJ0eSB7QXJyYXk8KCkgPT4gdm9pZCB8IFByb21pc2U8dm9pZD4+fSBhZnRlckNvbW1pdENhbGxiYWNrcyAtIENhbGxiYWNrcyB0byBtZXJnZSBvciBydW4gYWZ0ZXIgY29tbWl0LlxuICogQHByb3BlcnR5IHtBcnJheTwoKSA9PiB2b2lkIHwgUHJvbWlzZTx2b2lkPj59IGJlZm9yZUNvbW1pdENhbGxiYWNrcyAtIEd1YXJkcyB0byBydW4gYmVmb3JlIHRoaXMgZnJhbWUgY29tcGxldGVzLlxuICovXG4vKipcbiAqIFJldHJ5YWJsZURhdGFiYXNlRXJyb3JSZXN1bHQgdHlwZS5cbiAqIEB0eXBlZGVmIHtvYmplY3R9IFJldHJ5YWJsZURhdGFiYXNlRXJyb3JSZXN1bHRcbiAqIEBwcm9wZXJ0eSB7Ym9vbGVhbn0gcmV0cnkgLSBXaGV0aGVyIHRoZSBlcnJvciBzaG91bGQgYmUgcmV0cmllZC5cbiAqIEBwcm9wZXJ0eSB7Ym9vbGVhbn0gcmVjb25uZWN0IC0gV2hldGhlciB0byByZWNvbm5lY3QgYmVmb3JlIHJldHJ5aW5nLlxuICogQHByb3BlcnR5IHtib29sZWFufSBbZGVhZGxvY2tdIC0gV2hldGhlciB0aGUgZXJyb3IgaXMgYSB0cmFuc2FjdGlvbiBkZWFkbG9jay9sb2NrLXdhaXQtdGltZW91dCB0aGF0IHNob3VsZCByZXRyeSB0aGUgd2hvbGUgdHJhbnNhY3Rpb24uXG4gKiBAcHJvcGVydHkge1wiZGVhZGxvY2tcIiB8IFwibG9jay13YWl0LXRpbWVvdXRcIn0gW2NvbnRlbnRpb25LaW5kXSAtIENsYXNzaWZpZWQgdHJhbnNhY3Rpb24gY29udGVudGlvbiBraW5kLlxuICogQHByb3BlcnR5IHtudW1iZXJ9IFttYXhUcmllc10gLSBPdmVycmlkZSB0aGUgbWF4IHJldHJ5IGF0dGVtcHRzLlxuICogQHByb3BlcnR5IHtudW1iZXJ9IFt3YWl0TXNdIC0gV2FpdCB0aW1lIGJlZm9yZSByZXRyeWluZyBpbiBtaWxsaXNlY29uZHMuXG4gKi9cbi8qKlxuICogUXVlcnlPcHRpb25zIHR5cGUuXG4gKiBAdHlwZWRlZiB7b2JqZWN0fSBRdWVyeU9wdGlvbnNcbiAqIEBwcm9wZXJ0eSB7c3RyaW5nfSBbbG9nTmFtZV0gLSBRdWVyeSBsb2cgc3ViamVjdC5cbiAqIEBwcm9wZXJ0eSB7Ym9vbGVhbn0gW2xvZ1F1ZXJ5XSAtIFdoZXRoZXIgdG8gbG9nIHRoZSBxdWVyeS5cbiAqIEBwcm9wZXJ0eSB7Ym9vbGVhbn0gW3Byb2Nlc3NMaXN0Q29tbWVudF0gLSBXaGV0aGVyIHRvIGFkZCBwcm9jZXNzLWxpc3QgY29tbWVudHMgdG8gdGhlIHF1ZXJ5LlxuICogQHByb3BlcnR5IHtudW1iZXJ9IFtyZXF1ZXN0VGltZW91dE1zXSAtIFBlci1yZXF1ZXN0IGRyaXZlciB0aW1lb3V0IGluIG1pbGxpc2Vjb25kczsgemVybyBkaXNhYmxlcyB0aGUgZGVhZGxpbmUgb24gc3VwcG9ydGluZyBkcml2ZXJzLlxuICogQHByb3BlcnR5IHtib29sZWFufSBbcmV0cnldIC0gV2hldGhlciByZXRyeWFibGUgZXJyb3JzIG1heSByZXRyeSB0aGUgcXVlcnk7IGRlZmF1bHRzIHRvIHRydWUuXG4gKiBAcHJvcGVydHkge2Jvb2xlYW59IFtzZXNzaW9uVGltZVpvbmVdIC0gV2hldGhlciB0byBlbnN1cmUgdGhlIGNvbmZpZ3VyZWQgZGF0YWJhc2Ugc2Vzc2lvbiB0aW1lIHpvbmUgYmVmb3JlIHRoZSBxdWVyeS5cbiAqIEBwcm9wZXJ0eSB7Ym9vbGVhbn0gW3NxbGl0ZVNjcmlwdF0gLSBJbnRlcm5hbCBTUUxpdGUgZmxhZyBzZWxlY3RpbmcgbmF0aXZlIG11bHRpLXN0YXRlbWVudCBzY3JpcHQgZXhlY3V0aW9uLlxuICogQHByb3BlcnR5IHtBYm9ydFNpZ25hbH0gW3NpZ25hbF0gLSBBYm9ydHMgdGhlIGluLWZsaWdodCBxdWVyeSAoZGVzdHJveWluZyBpdHMgY29ubmVjdGlvbikgd2hlbiBpdCBmaXJlcy5cbiAqIEBwcm9wZXJ0eSB7c3RyaW5nfSBbc291cmNlU3RhY2tdIC0gU3RhY2sgY2FwdHVyZWQgYXQgdGhlIGNhbGxlciBib3VuZGFyeS5cbiAqIEBwcm9wZXJ0eSB7c3ltYm9sfSBbb3BlcmF0aW9uT3duZXJdIC0gT3BhcXVlIG93bmVyIGZvciBhbiBvcGVyYXRpb24tbGVhc2VkIGNvbm5lY3Rpb24uXG4gKi9cblxuLyoqXG4gKiBEZWFkbG9ja1JldHJ5RGlhZ25vc3RpY1NuYXBzaG90IHR5cGUuXG4gKiBAdHlwZWRlZiB7b2JqZWN0fSBEZWFkbG9ja1JldHJ5RGlhZ25vc3RpY1NuYXBzaG90XG4gKiBAcHJvcGVydHkge251bWJlcn0gYXR0ZW1wdCAtIE9uZS1iYXNlZCB0cmFuc2FjdGlvbiBhdHRlbXB0LlxuICogQHByb3BlcnR5IHtcImRlYWRsb2NrXCIgfCBcImxvY2std2FpdC10aW1lb3V0XCJ9IGNvbnRlbnRpb25LaW5kIC0gQ2xhc3NpZmllZCBjb250ZW50aW9uIGtpbmQuXG4gKiBAcHJvcGVydHkge3N0cmluZ30gW2RhdGFiYXNlSWRlbnRpZmllcl0gLSBSZWRhY3RlZCBsb2dpY2FsIGRhdGFiYXNlIHBvb2wgaWRlbnRpZmllciBtYXJrZXIuXG4gKiBAcHJvcGVydHkge3N0cmluZ30gW2RhdGFiYXNlSWRlbnRpZmllckZpbmdlcnByaW50XSAtIE9wYXF1ZSBsb2dpY2FsIGRhdGFiYXNlIHBvb2wgaWRlbnRpdHkuXG4gKiBAcHJvcGVydHkge3N0cmluZ30gW2RhdGFiYXNlSWRlbnRpdHlGaW5nZXJwcmludF0gLSBPcGFxdWUgcGh5c2ljYWwgZGF0YWJhc2UgaWRlbnRpdHkuXG4gKiBAcHJvcGVydHkge3N0cmluZ30gZHJpdmVyVHlwZSAtIERyaXZlciB0eXBlLlxuICogQHByb3BlcnR5IHtudW1iZXJ9IG1heEF0dGVtcHRzIC0gQ29uZmlndXJlZCB0cmFuc2FjdGlvbiBhdHRlbXB0IGJ1ZGdldC5cbiAqIEBwcm9wZXJ0eSB7c3RyaW5nfSBbb3BlcmF0aW9uTmFtZV0gLSBSZWRhY3RlZCBvcGVyYXRpb24tbmFtZSBtYXJrZXIuXG4gKiBAcHJvcGVydHkge3N0cmluZ30gW29wZXJhdGlvbk5hbWVGaW5nZXJwcmludF0gLSBPcGFxdWUgb3BlcmF0aW9uLW5hbWUgaWRlbnRpdHkuXG4gKiBAcHJvcGVydHkge3N0cmluZ30gW3NxbEZpbmdlcnByaW50XSAtIE5vcm1hbGl6ZWQgU1FMLXNoYXBlIGZpbmdlcnByaW50LlxuICogQHByb3BlcnR5IHtzdHJpbmd9IFtzcWxPcGVyYXRpb25dIC0gU1FMIHZlcmIuXG4gKiBAcHJvcGVydHkge3N0cmluZ30gc3RhZ2UgLSBFcnJvci1ldmVudCBzdGFnZS5cbiAqIEBwcm9wZXJ0eSB7bnVtYmVyfSB0cmFuc2FjdGlvbkF0dGVtcHREdXJhdGlvbk1zIC0gRHVyYXRpb24gb2YgdGhlIGZhaWxlZCBvdXRlciBhdHRlbXB0LlxuICogQHByb3BlcnR5IHtib29sZWFufSB3aWxsUmV0cnkgLSBXaGV0aGVyIGFub3RoZXIgb3V0ZXIgdHJhbnNhY3Rpb24gYXR0ZW1wdCB3aWxsIHJ1bi5cbiAqL1xuXG4vKipcbiAqIFRlc3RQcm9maWxlUXVlcnlBdHRlbXB0IHR5cGUuXG4gKiBAdHlwZWRlZiB7b2JqZWN0fSBUZXN0UHJvZmlsZVF1ZXJ5QXR0ZW1wdFxuICogQHByb3BlcnR5IHtpbXBvcnQoXCIuLi8uLi90ZXN0aW5nL3Rlc3QtcHJvZmlsZXIuanNcIikuVGVzdFByb2ZpbGVBc3luY0NvbnRleHR9IGNvbnRleHQgLSBDYXB0dXJlZCBhc3luYyBhdHRyaWJ1dGlvbi5cbiAqIEBwcm9wZXJ0eSB7e3NxbEZpbmdlcnByaW50OiBzdHJpbmcsIHNxbE9wZXJhdGlvbjogc3RyaW5nfX0gZGlhZ25vc3RpYyAtIFJlZGFjdGVkIHN0YXRlbWVudCBkaWFnbm9zdGljLlxuICogQHByb3BlcnR5IHtudW1iZXJ9IHN0YXJ0ZWRBdE1zIC0gUGh5c2ljYWwgYXR0ZW1wdCBzdGFydCB0aW1lLlxuICovXG5cbi8qKlxuICogQWN0aXZlUXVlcnlEZWJ1Z1NuYXBzaG90IHR5cGUuXG4gKiBAdHlwZWRlZiB7b2JqZWN0fSBBY3RpdmVRdWVyeURlYnVnU25hcHNob3RcbiAqIEBwcm9wZXJ0eSB7c3RyaW5nW119IGFubm90YXRpb25zIC0gRGF0YWJhc2UgYW5ub3RhdGlvbnMgYWN0aXZlIHdoZW4gdGhlIHF1ZXJ5IHN0YXJ0ZWQuXG4gKiBAcHJvcGVydHkge3N0cmluZ30gbG9nTmFtZSAtIFF1ZXJ5IGxvZyBuYW1lLlxuICogQHByb3BlcnR5IHtudW1iZXJ9IHN0YXJ0ZWRBdFVuaXhNcyAtIFF1ZXJ5IHN0YXJ0IHRpbWVzdGFtcC5cbiAqIEBwcm9wZXJ0eSB7bnVtYmVyfSBydW5uaW5nTXMgLSBRdWVyeSBydW50aW1lIGluIG1pbGxpc2Vjb25kcy5cbiAqIEBwcm9wZXJ0eSB7c3RyaW5nfSBzcWxQcmV2aWV3IC0gVHJ1bmNhdGVkIFNRTCBwcmV2aWV3LlxuICovXG5cbi8qKlxuICogRGF0YWJhc2VDb25uZWN0aW9uRGVidWdTbmFwc2hvdCB0eXBlLlxuICogQHR5cGVkZWYge29iamVjdH0gRGF0YWJhc2VDb25uZWN0aW9uRGVidWdTbmFwc2hvdFxuICogQHByb3BlcnR5IHtBY3RpdmVRdWVyeURlYnVnU25hcHNob3QgfCBudWxsfSBhY3RpdmVRdWVyeSAtIEN1cnJlbnRseSBydW5uaW5nIHF1ZXJ5LCBpZiBhbnkuXG4gKiBAcHJvcGVydHkge251bWJlciB8IHVuZGVmaW5lZH0gY2hlY2tlZE91dEF0VW5peE1zIC0gQ2hlY2tvdXQgc3RhcnQgdGltZXN0YW1wIGZvciBhY3RpdmUgY2hlY2tvdXRzLlxuICogQHByb3BlcnR5IHtudW1iZXIgfCB1bmRlZmluZWR9IGNoZWNrb3V0QWdlTXMgLSBBY3RpdmUgY2hlY2tvdXQgYWdlIGluIG1pbGxpc2Vjb25kcy5cbiAqIEBwcm9wZXJ0eSB7c3RyaW5nIHwgdW5kZWZpbmVkfSBjaGVja291dE5hbWUgLSBIdW1hbi1yZWFkYWJsZSBjaGVja291dCBuYW1lLlxuICogQHByb3BlcnR5IHtzdHJpbmd9IGRyaXZlckNsYXNzIC0gRHJpdmVyIGNsYXNzIG5hbWUuXG4gKiBAcHJvcGVydHkge251bWJlciB8IHVuZGVmaW5lZH0gaWRTZXEgLSBQb29sIGNoZWNrb3V0IElEIHNlcXVlbmNlLlxuICogQHByb3BlcnR5IHtudW1iZXJ9IG9wZW5UcmFuc2FjdGlvbnMgLSBOdW1iZXIgb2Ygb3BlbiB0cmFuc2FjdGlvbiBmcmFtZXMuXG4gKiBAcHJvcGVydHkge251bWJlcn0gc2NoZW1hQ2FjaGVFbnRyaWVzIC0gTnVtYmVyIG9mIGNhY2hlZCBzY2hlbWEgbWV0YWRhdGEgZW50cmllcy5cbiAqL1xuXG4vKipcbiAqIEFjdGl2ZVF1ZXJ5U3RhdGUgdHlwZS5cbiAqIEB0eXBlZGVmIHtvYmplY3R9IEFjdGl2ZVF1ZXJ5U3RhdGVcbiAqIEBwcm9wZXJ0eSB7c3RyaW5nW119IGFubm90YXRpb25zIC0gRGF0YWJhc2UgYW5ub3RhdGlvbnMgYWN0aXZlIHdoZW4gdGhlIHF1ZXJ5IHN0YXJ0ZWQuXG4gKiBAcHJvcGVydHkge3N0cmluZ30gbG9nTmFtZSAtIFF1ZXJ5IGxvZyBuYW1lLlxuICogQHByb3BlcnR5IHtudW1iZXJ9IHN0YXJ0ZWRBdFVuaXhNcyAtIFF1ZXJ5IHN0YXJ0IHRpbWVzdGFtcC5cbiAqIEBwcm9wZXJ0eSB7c3RyaW5nfSBzcWxQcmV2aWV3IC0gVHJ1bmNhdGVkIFNRTCBwcmV2aWV3LlxuICovXG5cbi8qKlxuICogVXBkYXRlU3FsQXJnc1R5cGUgdHlwZS5cbiAqIEB0eXBlZGVmIHtvYmplY3R9VXBkYXRlU3FsQXJnc1R5cGVcbiAqIEBwcm9wZXJ0eSB7b2JqZWN0fSBjb25kaXRpb25zIC0gQ29uZGl0aW9ucyB1c2VkIHRvIGJ1aWxkIHRoZSB1cGRhdGUgV0hFUkUgY2xhdXNlLlxuICogQHByb3BlcnR5IHtvYmplY3R9IGRhdGEgLSBDb2x1bW4vdmFsdWUgcGFpcnMgdG8gdXBkYXRlLlxuICogQHByb3BlcnR5IHtzdHJpbmd9IHRhYmxlTmFtZSAtIFRhYmxlIG5hbWUgdG8gdXBkYXRlLlxuICovXG4vKipcbiAqIFVwc2VydFNxbEFyZ3NUeXBlIHR5cGUuXG4gKiBAdHlwZWRlZiB7b2JqZWN0fVVwc2VydFNxbEFyZ3NUeXBlXG4gKiBAcHJvcGVydHkge3N0cmluZ1tdfSBjb25mbGljdENvbHVtbnMgLSBDb2x1bW5zIHRoYXQgZGVmaW5lIGEgY29uZmxpY3QuXG4gKiBAcHJvcGVydHkge29iamVjdH0gZGF0YSAtIENvbHVtbi92YWx1ZSBwYWlycyB0byBpbnNlcnQuXG4gKiBAcHJvcGVydHkge3N0cmluZ30gdGFibGVOYW1lIC0gVGFibGUgbmFtZSB0byB1cHNlcnQgaW50by5cbiAqIEBwcm9wZXJ0eSB7c3RyaW5nW119IHVwZGF0ZUNvbHVtbnMgLSBDb2x1bW5zIHRvIHVwZGF0ZSBvbiBjb25mbGljdC5cbiAqL1xuXG4vKipcbiAqIFNxbFRva2VuUmVzdWx0IHR5cGUuXG4gKiBAdHlwZWRlZiB7b2JqZWN0fSBTcWxUb2tlblJlc3VsdFxuICogQHByb3BlcnR5IHtib29sZWFufSBpbmNvbXBsZXRlIC0gV2hldGhlciB0aGUgc2NhbiBoaXQgaXRzIGJvdW5kIGJlZm9yZSBmaW5pc2hpbmcgdHJpdmlhL3Rva2VuIHBhcnNpbmcuXG4gKiBAcHJvcGVydHkge3N0cmluZyB8IHVuZGVmaW5lZH0gdG9rZW4gLSBMb3dlcmNhc2VkIHRva2VuIHdoZW4gcGFyc2luZyBjb21wbGV0ZWQ7IHVuZGVmaW5lZCB3aGVuIG5vIHRva2VuIHdhcyBmb3VuZC5cbiAqIEBwcm9wZXJ0eSB7bnVtYmVyfSBpbmRleCAtIEluZGV4IGltbWVkaWF0ZWx5IGFmdGVyIHRoZSBwYXJzZWQgdG9rZW4gb3IgdHJpdmlhLlxuICovXG5cbmltcG9ydCBCYWNrdHJhY2VDbGVhbmVyIGZyb20gXCIuLi8uLi91dGlscy9iYWNrdHJhY2UtY2xlYW5lci5qc1wiXG5pbXBvcnQgeyBnZXREYXRhYmFzZUFubm90YXRpb25zIH0gZnJvbSBcIi4uL2Fubm90YXRpb25zLmpzXCJcbmltcG9ydCB7IGZvcm1hdERhdGVGb3JEYXRhYmFzZSB9IGZyb20gXCIuLi9kYXRldGltZS1zdG9yYWdlLmpzXCJcbmltcG9ydCBpc0RhdGUgZnJvbSBcIi4uLy4uL3V0aWxzL2lzLWRhdGUuanNcIlxuaW1wb3J0IExvZ2dlciBmcm9tIFwiLi4vLi4vbG9nZ2VyLmpzXCJcbmltcG9ydCBRdWVyeSBmcm9tIFwiLi4vcXVlcnkvaW5kZXguanNcIlxuaW1wb3J0IFF1ZXJ5QWJvcnRlZEVycm9yIGZyb20gXCIuLi9xdWVyeS1hYm9ydGVkLWVycm9yLmpzXCJcbmltcG9ydCBIYW5kbGVyIGZyb20gXCIuLi9oYW5kbGVyLmpzXCJcbmltcG9ydCB7IHV0ZjhCeXRlTGVuZ3RoIH0gZnJvbSBcIi4uLy4uL3V0aWxzL3V0ZjgtYnl0ZS1sZW5ndGguanNcIlxuaW1wb3J0IE11dGV4IGZyb20gXCJlcGljLWxvY2tzL2J1aWxkL211dGV4LmpzXCJcbmltcG9ydCBVVUlEIGZyb20gXCJwdXJlLXV1aWRcIlxuaW1wb3J0IFRhYmxlRGF0YSBmcm9tIFwiLi4vdGFibGUtZGF0YS9pbmRleC5qc1wiXG5pbXBvcnQgVGFibGVDb2x1bW4gZnJvbSBcIi4uL3RhYmxlLWRhdGEvdGFibGUtY29sdW1uLmpzXCJcbmltcG9ydCBUYWJsZUZvcmVpZ25LZXkgZnJvbSBcIi4uL3RhYmxlLWRhdGEvdGFibGUtZm9yZWlnbi1rZXkuanNcIlxuaW1wb3J0IHdhaXQgZnJvbSBcImF3YWl0ZXJ5L2J1aWxkL3dhaXQuanNcIlxuaW1wb3J0IHsgZW5zdXJlRXJyb3IsIG9wdGlvbmFsUG9zaXRpdmVJbnRlZ2VyIH0gZnJvbSBcInR5cGFuaWNcIlxuaW1wb3J0IHtjb29yZGluYXRlU2hhcmVkVHJhbnNhY3Rpb25Db25uZWN0aW9uLCBydW5XaXRob3V0U2hhcmVkVHJhbnNhY3Rpb25Db29yZGluYXRvck93bmVyfSBmcm9tIFwiLi4vLi4vdGVzdGluZy9zaGFyZWQtdHJhbnNhY3Rpb24tY29ubmVjdGlvbi1jb29yZGluYXRvci5qc1wiXG5pbXBvcnQgeyBjdXJyZW50VGVzdFByb2ZpbGVDb250ZXh0IH0gZnJvbSBcIi4uLy4uL3Rlc3RpbmcvdGVzdC1wcm9maWxlLWNvbnRleHQuanNcIlxuaW1wb3J0IHNoYTI1NkhleCBmcm9tIFwiLi4vLi4vdXRpbHMvc2hhMjU2LWhleC5qc1wiXG5cbi8qKiBNYXhpbXVtIGNoYXJhY3RlcnMgaW5zcGVjdGVkIHdoZW4gYnVpbGRpbmcgdGhlIGRlYnVnIFNRTCBwcmV2aWV3LiAqL1xuY29uc3QgU1FMX1BSRVZJRVdfU0NBTl9MSU1JVCA9IDQwOTZcbi8qKiBNYXhpbXVtIGNoYXJhY3RlcnMgaW5zcGVjdGVkIHdoZW4gZGVjaWRpbmcgd2hldGhlciBhIHN0YXRlbWVudCBpbnZhbGlkYXRlcyBzY2hlbWEgbWV0YWRhdGEuICovXG5jb25zdCBTQ0hFTUFfSU5WQUxJREFUSU9OX1NDQU5fTElNSVQgPSA4MTkyXG4vKiogTWF4aW11bSBjaGVja291dC1uYW1lIGNoYXJhY3RlcnMgaW5zcGVjdGVkIGJ5IHJldHJ5IGRpYWdub3N0aWNzLiAqL1xuY29uc3QgT1BFUkFUSU9OX05BTUVfU0NBTl9MSU1JVCA9IDEwMjRcbmNvbnN0IFJFREFDVEVEX0RJQUdOT1NUSUNfTEFCRUwgPSBcIltSRURBQ1RFRF1cIlxuXG4vKipcbiAqIEJ1aWxkcyBhIG5vbi1yZXZlcnNpYmxlLCBzdGFibGUgU1FMIGZpbmdlcnByaW50IHdpdGhvdXQgcmV0YWluaW5nIFNRTCB0ZXh0LiBMaXRlcmFsIHNwZWxsaW5nIGlzXG4gKiBub3JtYWxpemVkIGZpcnN0IHNvIHRoZSBzYW1lIHN0YXRlbWVudCBzaGFwZSBwcm9kdWNlcyB0aGUgc2FtZSBmaW5nZXJwcmludCBhY3Jvc3MgdmFsdWVzLlxuICogQHBhcmFtIHtzdHJpbmd9IHNxbCAtIFNRTCB0byBmaW5nZXJwcmludC5cbiAqIEByZXR1cm5zIHt7c3FsRmluZ2VycHJpbnQ6IHN0cmluZywgc3FsT3BlcmF0aW9uOiBzdHJpbmd9fSAtIEJvdW5kZWQgcXVlcnkgZGlhZ25vc3RpYy5cbiAqL1xuZnVuY3Rpb24gc3FsRGlhZ25vc3RpYyhzcWwpIHtcbiAgbGV0IGZpbmdlcnByaW50SW5wdXQgPSBcIlwiXG5cbiAgZm9yIChsZXQgaW5kZXggPSAwOyBpbmRleCA8IHNxbC5sZW5ndGg7KSB7XG4gICAgY29uc3QgY2hhcmFjdGVyID0gc3FsW2luZGV4XVxuICAgIGNvbnN0IG5leHRDaGFyYWN0ZXIgPSBzcWxbaW5kZXggKyAxXVxuXG4gICAgaWYgKGNoYXJhY3RlciA9PSBcIidcIiB8fCBjaGFyYWN0ZXIgPT0gJ1wiJykge1xuICAgICAgY29uc3QgcXVvdGUgPSBjaGFyYWN0ZXJcbiAgICAgIGZpbmdlcnByaW50SW5wdXQgKz0gXCI/XCJcbiAgICAgIGluZGV4KytcblxuICAgICAgd2hpbGUgKGluZGV4IDwgc3FsLmxlbmd0aCkge1xuICAgICAgICBpZiAoc3FsW2luZGV4XSA9PSBcIlxcXFxcIikge1xuICAgICAgICAgIGluZGV4ICs9IDJcbiAgICAgICAgfSBlbHNlIGlmIChzcWxbaW5kZXhdID09IHF1b3RlICYmIHNxbFtpbmRleCArIDFdID09IHF1b3RlKSB7XG4gICAgICAgICAgaW5kZXggKz0gMlxuICAgICAgICB9IGVsc2UgaWYgKHNxbFtpbmRleF0gPT0gcXVvdGUpIHtcbiAgICAgICAgICBpbmRleCsrXG4gICAgICAgICAgYnJlYWtcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICBpbmRleCsrXG4gICAgICAgIH1cbiAgICAgIH1cbiAgICB9IGVsc2UgaWYgKGNoYXJhY3RlciA9PSBcIi9cIiAmJiBuZXh0Q2hhcmFjdGVyID09IFwiKlwiKSB7XG4gICAgICBjb25zdCBjb21tZW50RW5kID0gc3FsLmluZGV4T2YoXCIqL1wiLCBpbmRleCArIDIpXG4gICAgICBmaW5nZXJwcmludElucHV0ICs9IFwiIFwiXG4gICAgICBpbmRleCA9IGNvbW1lbnRFbmQgPT0gLTEgPyBzcWwubGVuZ3RoIDogY29tbWVudEVuZCArIDJcbiAgICB9IGVsc2UgaWYgKChjaGFyYWN0ZXIgPT0gXCItXCIgJiYgbmV4dENoYXJhY3RlciA9PSBcIi1cIikgfHwgY2hhcmFjdGVyID09IFwiI1wiKSB7XG4gICAgICBjb25zdCBsaW5lRW5kID0gc3FsLmluZGV4T2YoXCJcXG5cIiwgaW5kZXggKyAxKVxuICAgICAgZmluZ2VycHJpbnRJbnB1dCArPSBcIiBcIlxuICAgICAgaW5kZXggPSBsaW5lRW5kID09IC0xID8gc3FsLmxlbmd0aCA6IGxpbmVFbmQgKyAxXG4gICAgfSBlbHNlIHtcbiAgICAgIGZpbmdlcnByaW50SW5wdXQgKz0gY2hhcmFjdGVyXG4gICAgICBpbmRleCsrXG4gICAgfVxuICB9XG5cbiAgY29uc3Qgbm9ybWFsaXplZCA9IGZpbmdlcnByaW50SW5wdXRcbiAgICAucmVwbGFjZSgvXFxiKD86MHhbMC05YS1mXSt8XFxkKyg/OlxcLlxcZCspPyg/OmVbKy1dP1xcZCspPylcXGIvZ2ksIFwiP1wiKVxuICAgIC5yZXBsYWNlKC9cXHMrL2csIFwiIFwiKVxuICAgIC50cmltKClcbiAgICAudG9Mb3dlckNhc2UoKVxuICBsZXQgaGFzaCA9IDB4Y2JmMjljZTQ4NDIyMjMyNW5cblxuICBmb3IgKGxldCBpbmRleCA9IDA7IGluZGV4IDwgbm9ybWFsaXplZC5sZW5ndGg7IGluZGV4KyspIHtcbiAgICBoYXNoIF49IEJpZ0ludChub3JtYWxpemVkLmNoYXJDb2RlQXQoaW5kZXgpKVxuICAgIGhhc2ggPSBCaWdJbnQuYXNVaW50Tig2NCwgaGFzaCAqIDB4MTAwMDAwMDAxYjNuKVxuICB9XG5cbiAgY29uc3Qgb3BlcmF0aW9uTWF0Y2ggPSAvXihbYS16XSspLy5leGVjKG5vcm1hbGl6ZWQpXG5cbiAgcmV0dXJuIHtcbiAgICBzcWxGaW5nZXJwcmludDogYGZudjFhNjQ6JHtoYXNoLnRvU3RyaW5nKDE2KS5wYWRTdGFydCgxNiwgXCIwXCIpfWAsXG4gICAgc3FsT3BlcmF0aW9uOiBvcGVyYXRpb25NYXRjaCA/IG9wZXJhdGlvbk1hdGNoWzFdLnRvVXBwZXJDYXNlKCkgOiBcIlVOS05PV05cIlxuICB9XG59XG5cbi8qKlxuICogTWFya3MgYSBjYWxsYmFjayBmYWlsdXJlIHRoYXQgaGFwcGVuZWQgYWZ0ZXIgdGhlIG93bmluZyB0cmFuc2FjdGlvbiB3YXMgZHVyYWJseSBjb21taXR0ZWQuXG4gKiBUaGUgcHVibGljIHRyYW5zYWN0aW9uIGJvdW5kYXJ5IHVud3JhcHMgaXQgYmVmb3JlIGRlYWRsb2NrIGNsYXNzaWZpY2F0aW9uLlxuICovXG5jbGFzcyBWZWxvY2lvdXNEYXRhYmFzZUFmdGVyQ29tbWl0Q2FsbGJhY2tFcnJvciBleHRlbmRzIEVycm9yIHtcbiAgLyoqXG4gICAqIFJ1bnMgY29uc3RydWN0b3IuXG4gICAqIEBwYXJhbSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59IGNhbGxiYWNrRXJyb3IgLSBPcmlnaW5hbCBjYWxsYmFjayBmYWlsdXJlLlxuICAgKi9cbiAgY29uc3RydWN0b3IoY2FsbGJhY2tFcnJvcikge1xuICAgIHN1cGVyKFwiRGF0YWJhc2UgYWZ0ZXJDb21taXQgY2FsbGJhY2sgZmFpbGVkXCIpXG4gICAgdGhpcy5jYWxsYmFja0Vycm9yID0gY2FsbGJhY2tFcnJvclxuICB9XG59XG5cbi8qKlxuICogUnVucyBub3cgbXMuXG4gKiBAcmV0dXJucyB7bnVtYmVyfSAtIEN1cnJlbnQgaGlnaC1yZXNvbHV0aW9uLWlzaCB0aW1lc3RhbXAgaW4gbWlsbGlzZWNvbmRzLlxuICovXG5mdW5jdGlvbiBub3dNcygpIHtcbiAgaWYgKGdsb2JhbFRoaXMucGVyZm9ybWFuY2UgJiYgdHlwZW9mIGdsb2JhbFRoaXMucGVyZm9ybWFuY2Uubm93ID09IFwiZnVuY3Rpb25cIikge1xuICAgIHJldHVybiBnbG9iYWxUaGlzLnBlcmZvcm1hbmNlLm5vdygpXG4gIH1cblxuICByZXR1cm4gRGF0ZS5ub3coKVxufVxuXG4vKipcbiAqIFJ1bnMgZm9ybWF0IGVsYXBzZWQgbXMuXG4gKiBAcGFyYW0ge251bWJlcn0gZWxhcHNlZE1zIC0gRWxhcHNlZCBtaWxsaXNlY29uZHMuXG4gKiBAcmV0dXJucyB7c3RyaW5nfSAtIEZvcm1hdHRlZCBlbGFwc2VkIG1pbGxpc2Vjb25kcy5cbiAqL1xuZnVuY3Rpb24gZm9ybWF0RWxhcHNlZE1zKGVsYXBzZWRNcykge1xuICByZXR1cm4gYCR7TWF0aC5tYXgoZWxhcHNlZE1zLCAwKS50b0ZpeGVkKDEpfW1zYFxufVxuXG5leHBvcnQgZGVmYXVsdCBjbGFzcyBWZWxvY2lvdXNEYXRhYmFzZURyaXZlcnNCYXNlIHtcbiAgLyoqXG4gICAqIElkIHNlcS5cbiAgICogQHR5cGUge251bWJlciB8IHVuZGVmaW5lZH0gKi9cbiAgaWRTZXEgPSB1bmRlZmluZWRcbiAgLyoqXG4gICAqIE5hcnJvd3MgdGhlIHJ1bnRpbWUgdmFsdWUgdG8gdGhlIGRvY3VtZW50ZWQgdHlwZS5cbiAgICogQHR5cGUge1RyYW5zYWN0aW9uQ2FsbGJhY2tGcmFtZVtdfSAqL1xuICBfdHJhbnNhY3Rpb25DYWxsYmFja0ZyYW1lc1xuICAvKiogQHR5cGUge1Byb21pc2U8dm9pZD59ICovXG4gIF90cmFuc2FjdGlvbkNvbXBsZXRpb25Qcm9taXNlXG4gIC8qKiBAdHlwZSB7KCgpID0+IHZvaWQpIHwgdW5kZWZpbmVkfSAqL1xuICBfcmVzb2x2ZVRyYW5zYWN0aW9uQ29tcGxldGlvblxuICAvKipcbiAgICogTmFycm93cyB0aGUgcnVudGltZSB2YWx1ZSB0byB0aGUgZG9jdW1lbnRlZCB0eXBlLlxuICAgKiBAdHlwZSB7TWFwPHN0cmluZywgUHJvbWlzZTxSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj4+fSAqL1xuICBfc2NoZW1hQ2FjaGVcbiAgLyoqXG4gICAqIE5hcnJvd3MgdGhlIHJ1bnRpbWUgdmFsdWUgdG8gdGhlIGRvY3VtZW50ZWQgdHlwZS5cbiAgICogQHR5cGUgeygoKSA9PiB2b2lkKSB8IHVuZGVmaW5lZH0gKi9cbiAgX3NjaGVtYUNhY2hlSW52YWxpZGF0b3JcbiAgLyoqXG4gICAqIE5hcnJvd3MgdGhlIHJ1bnRpbWUgdmFsdWUgdG8gdGhlIGRvY3VtZW50ZWQgdHlwZS5cbiAgICogQHR5cGUge3N0cmluZyB8IHVuZGVmaW5lZH0gKi9cbiAgX2Nvbm5lY3Rpb25DaGVja291dE5hbWVcbiAgLyoqIEB0eXBlIHtzdHJpbmcgfCB1bmRlZmluZWR9ICovXG4gIF9kYXRhYmFzZUlkZW50aWZpZXJcbiAgLyoqIEB0eXBlIHtzdHJpbmcgfCB1bmRlZmluZWR9ICovXG4gIF9kYXRhYmFzZUlkZW50aXR5RmluZ2VycHJpbnRcbiAgLyoqXG4gICAqIEFjdGl2ZSBxdWVyeS5cbiAgICogQHR5cGUge0FjdGl2ZVF1ZXJ5U3RhdGUgfCBudWxsfSAqL1xuICBfYWN0aXZlUXVlcnkgPSBudWxsXG4gIC8qKiBAdHlwZSB7V2Vha01hcDxFcnJvciwge3NxbEZpbmdlcnByaW50OiBzdHJpbmcsIHNxbE9wZXJhdGlvbjogc3RyaW5nfT59ICovXG4gIF9mYWlsZWRRdWVyeURpYWdub3N0aWNzID0gbmV3IFdlYWtNYXAoKVxuICAvKiogQHR5cGUge01hcDxzdHJpbmcsIG51bWJlcj59ICovXG4gIF9oZWxkQWR2aXNvcnlMb2NrcyA9IG5ldyBNYXAoKVxuICAvKipcbiAgICogRXhjbHVzaXZlIG9wZXJhdGlvbiBsZWFzZSBpbnN0YWxsZWQgYnkgYSBzaW5nbGUtbXVsdGktdXNlIHBvb2wuXG4gICAqIEB0eXBlIHtpbXBvcnQoXCIuLi9vcGVyYXRpb24tbGVhc2UuanNcIikuZGVmYXVsdCB8IHVuZGVmaW5lZH1cbiAgICovXG4gIF9vcGVyYXRpb25MZWFzZSA9IHVuZGVmaW5lZFxuXG4gIC8qKlxuICAgKiBSdW5zIGNvbnN0cnVjdG9yLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uLy4uL2NvbmZpZ3VyYXRpb24tdHlwZXMuanNcIikuRGF0YWJhc2VDb25maWd1cmF0aW9uVHlwZX0gY29uZmlnIC0gQ29uZmlndXJhdGlvbiBvYmplY3QuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vLi4vY29uZmlndXJhdGlvbi5qc1wiKS5kZWZhdWx0fSBjb25maWd1cmF0aW9uIC0gQ29uZmlndXJhdGlvbiBpbnN0YW5jZS5cbiAgICovXG4gIGNvbnN0cnVjdG9yKGNvbmZpZywgY29uZmlndXJhdGlvbikge1xuICAgIHRoaXMuX2FyZ3MgPSBjb25maWdcbiAgICB0aGlzLmNvbmZpZ3VyYXRpb24gPSBjb25maWd1cmF0aW9uXG4gICAgdGhpcy5tdXRleCA9IG5ldyBNdXRleCgpIC8vIENhbiBiZSB1c2VkIHRvIGxvY2sgdGhpcyBpbnN0YW5jZSBmb3IgZXhjbHVzaXZlIHVzZVxuICAgIHRoaXMubG9nZ2VyID0gbmV3IExvZ2dlcih0aGlzKVxuICAgIHRoaXMuX3RyYW5zYWN0aW9uQ2FsbGJhY2tGcmFtZXMgPSBbXVxuICAgIHRoaXMuX3RyYW5zYWN0aW9uc0NvdW50ID0gMFxuICAgIHRoaXMuX3RyYW5zYWN0aW9uQ29tcGxldGlvblByb21pc2UgPSBQcm9taXNlLnJlc29sdmUoKVxuICAgIHRoaXMuX3Jlc29sdmVUcmFuc2FjdGlvbkNvbXBsZXRpb24gPSB1bmRlZmluZWRcbiAgICB0aGlzLl90cmFuc2FjdGlvbnNBY3Rpb25zTXV0ZXggPSBuZXcgTXV0ZXgoKVxuICAgIHRoaXMuX3BoeXNpY2FsQ29ubmVjdGlvbk11dGV4ID0gbmV3IE11dGV4KClcbiAgICB0aGlzLl9zY2hlbWFDYWNoZSA9IG5ldyBNYXAoKVxuICB9XG5cbiAgLyoqXG4gICAqIFNlcmlhbGl6ZXMgYWNjZXNzIHRvIG9uZSBwaHlzaWNhbCBkYXRhYmFzZSBzZXNzaW9uLlxuICAgKiBAdGVtcGxhdGUgVFxuICAgKiBAcGFyYW0geygpID0+IFByb21pc2U8VD59IGNhbGxiYWNrIC0gUGh5c2ljYWwgZHJpdmVyIG9wZXJhdGlvbi5cbiAgICogQHJldHVybnMge1Byb21pc2U8VD59IC0gT3BlcmF0aW9uIHJlc3VsdC5cbiAgICovXG4gIGFzeW5jIF9ydW5QaHlzaWNhbENvbm5lY3Rpb25SZXF1ZXN0KGNhbGxiYWNrKSB7XG4gICAgcmV0dXJuIGF3YWl0IHRoaXMuX3BoeXNpY2FsQ29ubmVjdGlvbk11dGV4LnN5bmMoYXN5bmMgKCkgPT4ge1xuICAgICAgcmV0dXJuIGF3YWl0IHJ1bldpdGhvdXRTaGFyZWRUcmFuc2FjdGlvbkNvb3JkaW5hdG9yT3duZXIodGhpcywgY2FsbGJhY2spXG4gICAgfSlcbiAgfVxuXG4gIC8qKlxuICAgKiBDbGVhbnMgZHJpdmVyLXNwZWNpZmljIHNlc3Npb24gc3RhdGUgYmVmb3JlIHRoaXMgbG9naWNhbCBjb25uZWN0aW9uIGlzIHJldXNhYmxlLlxuICAgKiBEcml2ZXJzIHdob3NlIHBoeXNpY2FsIHNlc3Npb25zIGNhbm5vdCBiZSBzYWZlbHkgcmVzZXQgc2hvdWxkIGRpc3Bvc2UgdGhlbSBoZXJlLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyB3aGVuIHRoZSBuZXh0IGNoZWNrb3V0IGNhbm5vdCBvYnNlcnZlIHByaW9yIHNlc3Npb24gc3RhdGUuXG4gICAqL1xuICBhc3luYyBjbGVhbnVwU2Vzc2lvblN0YXRlQWZ0ZXJDaGVja291dCgpIHt9XG5cbiAgLyoqXG4gICAqIFJ1bnMgYWRkIGZvcmVpZ24ga2V5LlxuICAgKiBAcGFyYW0ge3N0cmluZ30gdGFibGVOYW1lIC0gVGFibGUgbmFtZS5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGNvbHVtbk5hbWUgLSBDb2x1bW4gbmFtZS5cbiAgICogQHBhcmFtIHtzdHJpbmd9IHJlZmVyZW5jZWRUYWJsZU5hbWUgLSBSZWZlcmVuY2VkIHRhYmxlIG5hbWUuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSByZWZlcmVuY2VkQ29sdW1uTmFtZSAtIFJlZmVyZW5jZWQgY29sdW1uIG5hbWUuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gT3B0aW9ucyBvYmplY3QuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIHdoZW4gY29tcGxldGUuXG4gICAqL1xuICBhc3luYyBhZGRGb3JlaWduS2V5KHRhYmxlTmFtZSwgY29sdW1uTmFtZSwgcmVmZXJlbmNlZFRhYmxlTmFtZSwgcmVmZXJlbmNlZENvbHVtbk5hbWUsIGFyZ3MpIHtcbiAgICB0aGlzLl9hc3NlcnROb3RSZWFkT25seSgpXG4gICAgY29uc3QgdGFibGVGb3JlaWduS2V5QXJncyA9IE9iamVjdC5hc3NpZ24oXG4gICAgICB7XG4gICAgICAgIGNvbHVtbk5hbWUsXG4gICAgICAgIHRhYmxlTmFtZSxcbiAgICAgICAgcmVmZXJlbmNlZENvbHVtbk5hbWUsXG4gICAgICAgIHJlZmVyZW5jZWRUYWJsZU5hbWVcbiAgICAgIH0sXG4gICAgICBhcmdzXG4gICAgKVxuICAgIGNvbnN0IHRhYmxlRm9yZWlnbktleSA9IG5ldyBUYWJsZUZvcmVpZ25LZXkodGFibGVGb3JlaWduS2V5QXJncylcbiAgICBjb25zdCB0YWJsZURhdGEgPSBuZXcgVGFibGVEYXRhKHRhYmxlTmFtZSlcblxuICAgIHRhYmxlRGF0YS5hZGRGb3JlaWduS2V5KHRhYmxlRm9yZWlnbktleSlcblxuICAgIGNvbnN0IGFsdGVyVGFibGVTUUxzID0gYXdhaXQgdGhpcy5hbHRlclRhYmxlU1FMcyh0YWJsZURhdGEpXG5cbiAgICBmb3IgKGNvbnN0IGFsdGVyVGFibGVTUUwgb2YgYWx0ZXJUYWJsZVNRTHMpIHtcbiAgICAgIGF3YWl0IHRoaXMucXVlcnkoYWx0ZXJUYWJsZVNRTClcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogUnVucyByZW1vdmUgZm9yZWlnbiBrZXkuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSB0YWJsZU5hbWUgLSBUYWJsZSBuYW1lLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vYmFzZS1mb3JlaWduLWtleS5qc1wiKS5kZWZhdWx0fSBmb3JlaWduS2V5TWV0YWRhdGEgLSBGb3JlaWduIGtleSBtZXRhZGF0YS5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgd2hlbiBjb21wbGV0ZS5cbiAgICovXG4gIGFzeW5jIHJlbW92ZUZvcmVpZ25LZXkodGFibGVOYW1lLCBmb3JlaWduS2V5TWV0YWRhdGEpIHtcbiAgICB0aGlzLl9hc3NlcnROb3RSZWFkT25seSgpXG5cbiAgICBjb25zdCB0YWJsZUZvcmVpZ25LZXkgPSBuZXcgVGFibGVGb3JlaWduS2V5KHtcbiAgICAgIGNvbHVtbk5hbWU6IGZvcmVpZ25LZXlNZXRhZGF0YS5nZXRDb2x1bW5OYW1lKCksXG4gICAgICBkcm9wRm9yZWlnbktleTogdHJ1ZSxcbiAgICAgIG5hbWU6IGZvcmVpZ25LZXlNZXRhZGF0YS5nZXROYW1lKCksXG4gICAgICByZWZlcmVuY2VkQ29sdW1uTmFtZTogZm9yZWlnbktleU1ldGFkYXRhLmdldFJlZmVyZW5jZWRDb2x1bW5OYW1lKCksXG4gICAgICByZWZlcmVuY2VkVGFibGVOYW1lOiBmb3JlaWduS2V5TWV0YWRhdGEuZ2V0UmVmZXJlbmNlZFRhYmxlTmFtZSgpLFxuICAgICAgdGFibGVOYW1lXG4gICAgfSlcbiAgICBjb25zdCB0YWJsZURhdGEgPSBuZXcgVGFibGVEYXRhKHRhYmxlTmFtZSlcblxuICAgIHRhYmxlRGF0YS5hZGRGb3JlaWduS2V5KHRhYmxlRm9yZWlnbktleSlcblxuICAgIGNvbnN0IGFsdGVyVGFibGVTUUxzID0gYXdhaXQgdGhpcy5hbHRlclRhYmxlU1FMcyh0YWJsZURhdGEpXG5cbiAgICBmb3IgKGNvbnN0IGFsdGVyVGFibGVTUUwgb2YgYWx0ZXJUYWJsZVNRTHMpIHtcbiAgICAgIGF3YWl0IHRoaXMucXVlcnkoYWx0ZXJUYWJsZVNRTClcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogUnVucyBhbHRlciB0YWJsZSBzcWxzLlxuICAgKiBAYWJzdHJhY3RcbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi90YWJsZS1kYXRhL2luZGV4LmpzXCIpLmRlZmF1bHR9IF90YWJsZURhdGEgLSBUYWJsZSBkYXRhLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxzdHJpbmdbXT59IC0gUmVzb2x2ZXMgd2l0aCBTUUwgc3RhdGVtZW50cy5cbiAgICovXG4gIGFsdGVyVGFibGVTUUxzKF90YWJsZURhdGEpIHtcbiAgICB0aHJvdyBuZXcgRXJyb3IoXCJhbHRlclRhYmxlU1FMcyBub3QgaW1wbGVtZW50ZWRcIilcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGNvbm5lY3QuXG4gICAqIEBhYnN0cmFjdFxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyB3aGVuIGNvbXBsZXRlLlxuICAgKi9cbiAgY29ubmVjdCgpIHtcbiAgICB0aHJvdyBuZXcgRXJyb3IoXCInY29ubmVjdCcgbm90IGltcGxlbWVudGVkXCIpXG4gIH1cblxuICAvKipcbiAgICogUmVsZWFzZXMgdHJhY2tlZCBhZHZpc29yeSBsb2NrcyBhbmQgY2xvc2VzIHRoZSBwaHlzaWNhbCBkYXRhYmFzZSBjb25uZWN0aW9uLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyB3aGVuIGNsZWFudXAgYW5kIGNsb3NlIGNvbXBsZXRlLlxuICAgKi9cbiAgYXN5bmMgY2xvc2UoKSB7XG4gICAgLyoqIEB0eXBlIHtFcnJvciB8IHVuZGVmaW5lZH0gKi9cbiAgICBsZXQgYWR2aXNvcnlMb2NrRXJyb3JcblxuICAgIHRyeSB7XG4gICAgICBhd2FpdCB0aGlzLnJlbGVhc2VIZWxkQWR2aXNvcnlMb2NrcygpXG4gICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgIGFkdmlzb3J5TG9ja0Vycm9yID0gZXJyb3IgaW5zdGFuY2VvZiBFcnJvciA/IGVycm9yIDogbmV3IEVycm9yKFwiRmFpbGVkIHRvIHJlbGVhc2UgaGVsZCBhZHZpc29yeSBsb2Nrc1wiLCB7Y2F1c2U6IGVycm9yfSlcbiAgICB9XG5cbiAgICB0cnkge1xuICAgICAgYXdhaXQgdGhpcy5fY2xvc2UoKVxuICAgICAgdGhpcy5faGVsZEFkdmlzb3J5TG9ja3MuY2xlYXIoKVxuICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICBjb25zdCBjbG9zZUVycm9yID0gZXJyb3IgaW5zdGFuY2VvZiBFcnJvciA/IGVycm9yIDogbmV3IEVycm9yKFwiRmFpbGVkIHRvIGNsb3NlIGRhdGFiYXNlIGNvbm5lY3Rpb25cIiwge2NhdXNlOiBlcnJvcn0pXG5cbiAgICAgIGlmIChhZHZpc29yeUxvY2tFcnJvcikge1xuICAgICAgICB0aHJvdyBuZXcgQWdncmVnYXRlRXJyb3IoW2Fkdmlzb3J5TG9ja0Vycm9yLCBjbG9zZUVycm9yXSwgXCJGYWlsZWQgdG8gcmVsZWFzZSBhZHZpc29yeSBsb2NrcyBhbmQgY2xvc2UgZGF0YWJhc2UgY29ubmVjdGlvblwiLCB7Y2F1c2U6IGVycm9yfSlcbiAgICAgIH1cblxuICAgICAgdGhyb3cgY2xvc2VFcnJvclxuICAgIH1cblxuICAgIGlmIChhZHZpc29yeUxvY2tFcnJvcikgdGhyb3cgYWR2aXNvcnlMb2NrRXJyb3JcbiAgfVxuXG4gIC8qKlxuICAgKiBEcml2ZXItc3BlY2lmaWMgcGh5c2ljYWwgY2xvc2UgaG9vay5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgd2hlbiB0aGUgdW5kZXJseWluZyBjb25uZWN0aW9uIGNsb3Nlcy5cbiAgICovXG4gIGFzeW5jIF9jbG9zZSgpIHtcbiAgICAvLyBOby1vcCBieSBkZWZhdWx0XG4gIH1cblxuICAvKipcbiAgICogRmx1c2hlcyBwZW5kaW5nIHdyaXRlcyB0aGF0IHRoZSBkcml2ZXIgZGVsYXllZCBmb3IgcGVyc2lzdGVuY2UuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIHdoZW4gcGVuZGluZyB3cml0ZXMgYXJlIGR1cmFibGUuXG4gICAqL1xuICBhc3luYyBmbHVzaFBlbmRpbmdXcml0ZXMoKSB7XG4gICAgLy8gTm8tb3AgYnkgZGVmYXVsdFxuICB9XG5cbiAgLyoqXG4gICAqIFJldHVybnMgd2hldGhlciBkZWxheWVkIHBlcnNpc3RlbmNlIHdyaXRlcyByZW1haW4uXG4gICAqIEByZXR1cm5zIHtib29sZWFufSAtIFdoZXRoZXIgd3JpdGVzIHJlbWFpbi5cbiAgICovXG4gIGhhc1BlbmRpbmdXcml0ZXMoKSB7IHJldHVybiBmYWxzZSB9XG5cbiAgLyoqXG4gICAqIERlbGV0ZXMgdGhpcyBkcml2ZXIncyBwaHlzaWNhbCBkYXRhYmFzZSBzdG9yYWdlIHdpdGhvdXQgb3BlbmluZyBpdC5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgYWZ0ZXIgZGVsZXRpb24uXG4gICAqL1xuICBhc3luYyBkZWxldGVEYXRhYmFzZVN0b3JhZ2UoKSB7IHRocm93IG5ldyBFcnJvcihgRGF0YWJhc2Ugc3RvcmFnZSBkZWxldGlvbiBpcyBub3Qgc3VwcG9ydGVkIGJ5ICR7dGhpcy5jb25zdHJ1Y3Rvci5uYW1lfWApIH1cblxuICAvKipcbiAgICogUnVucyBzZXQgY29ubmVjdGlvbiBjaGVja291dCBuYW1lLlxuICAgKiBAcGFyYW0ge3N0cmluZyB8IHVuZGVmaW5lZH0gbmFtZSAtIEh1bWFuLXJlYWRhYmxlIG5hbWUgZm9yIHRoaXMgYWN0aXZlIGNoZWNrb3V0LlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyB3aGVuIGNvbXBsZXRlLlxuICAgKi9cbiAgYXN5bmMgc2V0Q29ubmVjdGlvbkNoZWNrb3V0TmFtZShuYW1lKSB7XG4gICAgdGhpcy5fY29ubmVjdGlvbkNoZWNrb3V0TmFtZSA9IG5hbWVcbiAgICB0aGlzLl9jb25uZWN0aW9uQ2hlY2tlZE91dEF0VW5peE1zID0gRGF0ZS5ub3coKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgY2xlYXIgY29ubmVjdGlvbiBjaGVja291dCBuYW1lLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyB3aGVuIGNvbXBsZXRlLlxuICAgKi9cbiAgYXN5bmMgY2xlYXJDb25uZWN0aW9uQ2hlY2tvdXROYW1lKCkge1xuICAgIHRoaXMuX2Nvbm5lY3Rpb25DaGVja291dE5hbWUgPSB1bmRlZmluZWRcbiAgICB0aGlzLl9jb25uZWN0aW9uQ2hlY2tlZE91dEF0VW5peE1zID0gdW5kZWZpbmVkXG4gIH1cblxuICAvKipcbiAgICogU2V0cyB0aGUgcG9vbC1vd25lZCBpZGVudGl0eSB1c2VkIGJ5IHNhZmUgZGF0YWJhc2UgZGlhZ25vc3RpY3MuXG4gICAqIEBwYXJhbSB7e2RhdGFiYXNlSWRlbnRpZmllcjogc3RyaW5nLCBkYXRhYmFzZUlkZW50aXR5RmluZ2VycHJpbnQ6IHN0cmluZ319IGlkZW50aXR5IC0gUG9vbC1zdGFtcGVkIGlkZW50aXR5IHJlZGFjdGVkIGF0IGRpYWdub3N0aWMgc25hcHNob3QgdGltZS5cbiAgICogQHJldHVybnMge3ZvaWR9XG4gICAqL1xuICBzZXRQb29sRGlhZ25vc3RpY0lkZW50aXR5KHtkYXRhYmFzZUlkZW50aWZpZXIsIGRhdGFiYXNlSWRlbnRpdHlGaW5nZXJwcmludH0pIHtcbiAgICB0aGlzLl9kYXRhYmFzZUlkZW50aWZpZXIgPSBkYXRhYmFzZUlkZW50aWZpZXJcbiAgICB0aGlzLl9kYXRhYmFzZUlkZW50aXR5RmluZ2VycHJpbnQgPSBkYXRhYmFzZUlkZW50aXR5RmluZ2VycHJpbnRcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHJlY29ubmVjdC5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgd2hlbiBjb21wbGV0ZS5cbiAgICovXG4gIGFzeW5jIHJlY29ubmVjdCgpIHtcbiAgICB0aGlzLmNsZWFyU2NoZW1hQ2FjaGUoKVxuICAgIGF3YWl0IHRoaXMuY2xvc2UoKVxuICAgIGF3YWl0IHRoaXMuY29ubmVjdCgpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBjcmVhdGUgZGF0YWJhc2Ugc3FsLlxuICAgKiBAYWJzdHJhY3RcbiAgICogQHBhcmFtIHtzdHJpbmd9IGRhdGFiYXNlTmFtZSAtIERhdGFiYXNlIG5hbWUuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBbYXJnc10gLSBPcHRpb25zIG9iamVjdC5cbiAgICogQHBhcmFtIHtib29sZWFufSBbYXJncy5pZk5vdEV4aXN0c10gLSBXaGV0aGVyIGlmIG5vdCBleGlzdHMuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBbYXJncy5kYXRhYmFzZUNoYXJzZXRdIC0gRGF0YWJhc2UtZGVmYXVsdCBjaGFyYWN0ZXIgc2V0IChkcml2ZXItc3BlY2lmaWM7IG15c3FsL21hcmlhZGIpLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gW2FyZ3MuZGF0YWJhc2VDb2xsYXRpb25dIC0gRGF0YWJhc2UtZGVmYXVsdCBjb2xsYXRpb24gKGRyaXZlci1zcGVjaWZpYzsgbXlzcWwvbWFyaWFkYikuXG4gICAqIEByZXR1cm5zIHtzdHJpbmdbXX0gLSBTUUwgc3RhdGVtZW50cy5cbiAgICovXG4gIGNyZWF0ZURhdGFiYXNlU3FsKGRhdGFiYXNlTmFtZSwgYXJncykgeyB0aHJvdyBuZXcgRXJyb3IoXCInY3JlYXRlRGF0YWJhc2VTcWwnIG5vdCBpbXBsZW1lbnRlZFwiKSB9IC8vIGVzbGludC1kaXNhYmxlLWxpbmUgbm8tdW51c2VkLXZhcnNcblxuICAvKipcbiAgICogUnVucyBkcm9wIGRhdGFiYXNlIHNxbC5cbiAgICogQGFic3RyYWN0XG4gICAqIEBwYXJhbSB7c3RyaW5nfSBkYXRhYmFzZU5hbWUgLSBEYXRhYmFzZSBuYW1lLlxuICAgKiBAcGFyYW0ge29iamVjdH0gW2FyZ3NdIC0gT3B0aW9ucyBvYmplY3QuXG4gICAqIEBwYXJhbSB7Ym9vbGVhbn0gW2FyZ3MuaWZFeGlzdHNdIC0gV2hldGhlciBpZiBleGlzdHMuXG4gICAqIEByZXR1cm5zIHtzdHJpbmdbXX0gLSBTUUwgc3RhdGVtZW50cy5cbiAgICovXG4gIGRyb3BEYXRhYmFzZVNxbChkYXRhYmFzZU5hbWUsIGFyZ3MpIHsgdGhyb3cgbmV3IEVycm9yKFwiJ2Ryb3BEYXRhYmFzZVNxbCcgbm90IGltcGxlbWVudGVkXCIpIH0gLy8gZXNsaW50LWRpc2FibGUtbGluZSBuby11bnVzZWQtdmFyc1xuXG4gIC8qKlxuICAgKiBSdW5zIGNyZWF0ZSBpbmRleCBzcWxzLlxuICAgKiBAYWJzdHJhY3RcbiAgICogQHBhcmFtIHtDcmVhdGVJbmRleFNxbEFyZ3N9IGluZGV4RGF0YSAtIEluZGV4IGRhdGEuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHN0cmluZ1tdPn0gLSBSZXNvbHZlcyB3aXRoIFNRTCBzdGF0ZW1lbnRzLlxuICAgKi9cbiAgYXN5bmMgY3JlYXRlSW5kZXhTUUxzKGluZGV4RGF0YSkgeyAvLyBlc2xpbnQtZGlzYWJsZS1saW5lIG5vLXVudXNlZC12YXJzXG4gICAgdGhyb3cgbmV3IEVycm9yKFwiJ2NyZWF0ZUluZGV4U1FMcycgbm90IGltcGxlbWVudGVkXCIpXG4gIH1cblxuICAvKipcbiAgICogUnVucyByZW1vdmUgaW5kZXggc3Fscy5cbiAgICogQGFic3RyYWN0XG4gICAqIEBwYXJhbSB7UmVtb3ZlSW5kZXhTcWxBcmdzfSBpbmRleERhdGEgLSBJbmRleCBkYXRhLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxzdHJpbmdbXT59IC0gUmVzb2x2ZXMgd2l0aCBTUUwgc3RhdGVtZW50cy5cbiAgICovXG4gIGFzeW5jIHJlbW92ZUluZGV4U1FMcyhpbmRleERhdGEpIHsgLy8gZXNsaW50LWRpc2FibGUtbGluZSBuby11bnVzZWQtdmFyc1xuICAgIHRocm93IG5ldyBFcnJvcihcIidyZW1vdmVJbmRleFNRTHMnIG5vdCBpbXBsZW1lbnRlZFwiKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgY3JlYXRlIHRhYmxlLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL3RhYmxlLWRhdGEvaW5kZXguanNcIikuZGVmYXVsdH0gdGFibGVEYXRhIC0gVGFibGUgZGF0YS5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgd2hlbiBjb21wbGV0ZS5cbiAgICovXG4gIGFzeW5jIGNyZWF0ZVRhYmxlKHRhYmxlRGF0YSkge1xuICAgIHRoaXMuX2Fzc2VydE5vdFJlYWRPbmx5KClcbiAgICBjb25zdCBzcWxzID0gYXdhaXQgdGhpcy5jcmVhdGVUYWJsZVNxbCh0YWJsZURhdGEpXG5cbiAgICBmb3IgKGNvbnN0IHNxbCBvZiBzcWxzKSB7XG4gICAgICBhd2FpdCB0aGlzLnF1ZXJ5KHNxbClcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogUnVucyBjcmVhdGUgdGFibGUgc3FsLlxuICAgKiBAYWJzdHJhY3RcbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi90YWJsZS1kYXRhL2luZGV4LmpzXCIpLmRlZmF1bHR9IHRhYmxlRGF0YSAtIFRhYmxlIGRhdGEuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHN0cmluZ1tdPn0gLSBSZXNvbHZlcyB3aXRoIFNRTCBzdGF0ZW1lbnRzLlxuICAgKi9cbiAgYXN5bmMgY3JlYXRlVGFibGVTcWwodGFibGVEYXRhKSB7IC8vIGVzbGludC1kaXNhYmxlLWxpbmUgbm8tdW51c2VkLXZhcnNcbiAgICB0aHJvdyBuZXcgRXJyb3IoXCInY3JlYXRlVGFibGVTcWwnIG5vdCBpbXBsZW1lbnRlZFwiKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZGVsZXRlLlxuICAgKiBAcGFyYW0ge0RlbGV0ZVNxbEFyZ3NUeXBlfSBhcmdzIC0gT3B0aW9ucyBvYmplY3QuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIHdoZW4gY29tcGxldGUuXG4gICAqL1xuICBhc3luYyBkZWxldGUoYXJncykge1xuICAgIHRoaXMuX2Fzc2VydE5vdFJlYWRPbmx5KClcbiAgICBjb25zdCBzcWwgPSB0aGlzLmRlbGV0ZVNxbChhcmdzKVxuXG4gICAgYXdhaXQgdGhpcy5xdWVyeShzcWwpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBkZWxldGUgc3FsLlxuICAgKiBAYWJzdHJhY3RcbiAgICogQHBhcmFtIHtEZWxldGVTcWxBcmdzVHlwZX0gYXJncyAtIE9wdGlvbnMgb2JqZWN0LlxuICAgKiBAcmV0dXJucyB7c3RyaW5nfSAtIFNRTCBzdHJpbmcuXG4gICAqL1xuICBkZWxldGVTcWwoYXJncykgeyAvLyBlc2xpbnQtZGlzYWJsZS1saW5lIG5vLXVudXNlZC12YXJzXG4gICAgdGhyb3cgbmV3IEVycm9yKGAnZGVsZXRlU3FsJyBub3QgaW1wbGVtZW50ZWRgKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZHJvcCB0YWJsZS5cbiAgICogQHBhcmFtIHtzdHJpbmd9IHRhYmxlTmFtZSAtIFRhYmxlIG5hbWUuXG4gICAqIEBwYXJhbSB7RHJvcFRhYmxlU3FsQXJnc1R5cGV9IFthcmdzXSAtIE9wdGlvbnMgb2JqZWN0LlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyB3aGVuIGNvbXBsZXRlLlxuICAgKi9cbiAgYXN5bmMgZHJvcFRhYmxlKHRhYmxlTmFtZSwgYXJncykge1xuICAgIHRoaXMuX2Fzc2VydE5vdFJlYWRPbmx5KClcbiAgICBjb25zdCBzcWxzID0gYXdhaXQgdGhpcy5kcm9wVGFibGVTUUxzKHRhYmxlTmFtZSwgYXJncylcblxuICAgIGZvciAoY29uc3Qgc3FsIG9mIHNxbHMpIHtcbiAgICAgIGF3YWl0IHRoaXMucXVlcnkoc3FsKVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGRyb3AgdGFibGUgc3Fscy5cbiAgICogQGFic3RyYWN0XG4gICAqIEBwYXJhbSB7c3RyaW5nfSB0YWJsZU5hbWUgLSBUYWJsZSBuYW1lLlxuICAgKiBAcGFyYW0ge0Ryb3BUYWJsZVNxbEFyZ3NUeXBlfSBbYXJnc10gLSBPcHRpb25zIG9iamVjdC5cbiAgICogQHJldHVybnMge1Byb21pc2U8c3RyaW5nW10+fSAtIFJlc29sdmVzIHdpdGggU1FMIHN0YXRlbWVudHMuXG4gICAqL1xuICBhc3luYyBkcm9wVGFibGVTUUxzKHRhYmxlTmFtZSwgYXJncykgeyAvLyBlc2xpbnQtZGlzYWJsZS1saW5lIG5vLXVudXNlZC12YXJzXG4gICAgdGhyb3cgbmV3IEVycm9yKFwiZHJvcFRhYmxlU1FMcyBub3QgaW1wbGVtZW50ZWRcIilcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGVzY2FwZS5cbiAgICogQGFic3RyYWN0XG4gICAqIEBwYXJhbSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59IHZhbHVlIC0gVmFsdWUgdG8gdXNlLlxuICAgKiBAcmV0dXJucyB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59IC0gVGhlIGVzY2FwZS5cbiAgICovXG4gIGVzY2FwZSh2YWx1ZSkgeyAvLyBlc2xpbnQtZGlzYWJsZS1saW5lIG5vLXVudXNlZC12YXJzXG4gICAgdGhyb3cgbmV3IEVycm9yKFwiJ2VzY2FwZScgbm90IGltcGxlbWVudGVkXCIpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBnZXQgYXJncy5cbiAgICogQHJldHVybnMge2ltcG9ydChcIi4uLy4uL2NvbmZpZ3VyYXRpb24tdHlwZXMuanNcIikuRGF0YWJhc2VDb25maWd1cmF0aW9uVHlwZX0gLSBUaGUgYXJncy5cbiAgICovXG4gIGdldEFyZ3MoKSB7XG4gICAgcmV0dXJuIHRoaXMuX2FyZ3NcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGdldCBjb25maWd1cmF0aW9uLlxuICAgKiBAcmV0dXJucyB7aW1wb3J0KFwiLi4vLi4vY29uZmlndXJhdGlvbi5qc1wiKS5kZWZhdWx0fSAtIFRoZSBjb25maWd1cmF0aW9uLlxuICAgKi9cbiAgZ2V0Q29uZmlndXJhdGlvbigpIHtcbiAgICBpZiAoIXRoaXMuY29uZmlndXJhdGlvbikgdGhyb3cgbmV3IEVycm9yKFwiTm8gY29uZmlndXJhdGlvbiBzZXRcIilcblxuICAgIHJldHVybiB0aGlzLmNvbmZpZ3VyYXRpb25cbiAgfVxuXG4gIC8qKlxuICAgKiBJbnN0YWxscyBhbiBvcGVyYXRpb24gbGVhc2UgYXRvbWljYWxseSB3aXRoIG9yZGluYXJ5IHRyYW5zYWN0aW9uIGFkbWlzc2lvbi5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9vcGVyYXRpb24tbGVhc2UuanNcIikuZGVmYXVsdH0gb3BlcmF0aW9uTGVhc2UgLSBBY3RpdmUgbGVhc2UuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIG9uY2UgdGhlIGxlYXNlIG93bnMgdHJhbnNhY3Rpb24gYWRtaXNzaW9uLlxuICAgKi9cbiAgYXN5bmMgc2V0T3BlcmF0aW9uTGVhc2Uob3BlcmF0aW9uTGVhc2UpIHtcbiAgICBhd2FpdCB0aGlzLl90cmFuc2FjdGlvbnNBY3Rpb25zTXV0ZXguc3luYyhhc3luYyAoKSA9PiB7XG4gICAgICBpZiAodGhpcy5fb3BlcmF0aW9uTGVhc2UpIHRocm93IG5ldyBFcnJvcihcIkEgZGF0YWJhc2Ugb3BlcmF0aW9uIGxlYXNlIGlzIGFscmVhZHkgYWN0aXZlXCIpXG4gICAgICBpZiAodGhpcy5fdHJhbnNhY3Rpb25zQ291bnQgPiAwKSB7XG4gICAgICAgIHRocm93IG5ldyBFcnJvcihcIkNhbm5vdCBzdGFydCBhIGRhdGFiYXNlIG9wZXJhdGlvbiB3aGlsZSBhbiB1bnJlbGF0ZWQgb3JkaW5hcnkgdHJhbnNhY3Rpb24gaXMgYWxyZWFkeSBhY3RpdmVcIilcbiAgICAgIH1cblxuICAgICAgdGhpcy5fb3BlcmF0aW9uTGVhc2UgPSBvcGVyYXRpb25MZWFzZVxuICAgIH0pXG4gIH1cblxuICAvKipcbiAgICogQ2xlYXJzIHRoZSBtYXRjaGluZyBvcGVyYXRpb24gbGVhc2UuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vb3BlcmF0aW9uLWxlYXNlLmpzXCIpLmRlZmF1bHR9IG9wZXJhdGlvbkxlYXNlIC0gTGVhc2UgdG8gY2xlYXIuXG4gICAqIEByZXR1cm5zIHt2b2lkfVxuICAgKi9cbiAgY2xlYXJPcGVyYXRpb25MZWFzZShvcGVyYXRpb25MZWFzZSkge1xuICAgIGlmICh0aGlzLl9vcGVyYXRpb25MZWFzZSAhPT0gb3BlcmF0aW9uTGVhc2UpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihcIkNhbm5vdCBjbGVhciBhIGRhdGFiYXNlIG9wZXJhdGlvbiBsZWFzZSBvd25lZCBieSBhbm90aGVyIG9wZXJhdGlvblwiKVxuICAgIH1cblxuICAgIHRoaXMuX29wZXJhdGlvbkxlYXNlID0gdW5kZWZpbmVkXG4gIH1cblxuICAvKipcbiAgICogV2FpdHMgZm9yIGFuIHVucmVsYXRlZCBvcGVyYXRpb24gbGVhc2UgdG8gcmVsZWFzZS5cbiAgICogQHBhcmFtIHtzeW1ib2wgfCB1bmRlZmluZWR9IG9wZXJhdGlvbk93bmVyIC0gQ2FuZGlkYXRlIG9wZXJhdGlvbiBvd25lci5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59XG4gICAqL1xuICBhc3luYyBfd2FpdEZvck9wZXJhdGlvbkxlYXNlKG9wZXJhdGlvbk93bmVyKSB7XG4gICAgY29uc3Qgb3BlcmF0aW9uTGVhc2UgPSB0aGlzLl9vcGVyYXRpb25MZWFzZVxuXG4gICAgaWYgKG9wZXJhdGlvbkxlYXNlKSBhd2FpdCBvcGVyYXRpb25MZWFzZS53YWl0KG9wZXJhdGlvbk93bmVyKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZ2V0IGlkIHNlcS5cbiAgICogQHJldHVybnMge251bWJlciB8IHVuZGVmaW5lZH0gLSBUaGUgaWQgc2VxLlxuICAgKi9cbiAgZ2V0SWRTZXEoKSB7XG4gICAgcmV0dXJuIHRoaXMuaWRTZXFcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHByaW1hcnkga2V5IHR5cGUuXG4gICAqIEByZXR1cm5zIHtzdHJpbmd9IC0gQ29uZmlndXJlZCBwcmltYXJ5IGtleSB0eXBlLCBkZWZhdWx0aW5nIHRvIFVVSUQuXG4gICAqL1xuICBwcmltYXJ5S2V5VHlwZSgpIHtcbiAgICByZXR1cm4gdGhpcy5nZXRBcmdzKCkucHJpbWFyeUtleVR5cGUgfHwgXCJ1dWlkXCJcbiAgfVxuXG4gIC8qKlxuICAgKiBDbGVhcnMgY2FjaGVkIHNjaGVtYSBtZXRhZGF0YSBmb3IgdGhpcyBkcml2ZXIgaW5zdGFuY2UuXG4gICAqIEByZXR1cm5zIHt2b2lkfSAtIE5vIHJldHVybiB2YWx1ZS5cbiAgICovXG4gIGNsZWFyU2NoZW1hQ2FjaGUoKSB7XG4gICAgaWYgKHRoaXMuX3NjaGVtYUNhY2hlSW52YWxpZGF0b3IpIHtcbiAgICAgIHRoaXMuX3NjaGVtYUNhY2hlSW52YWxpZGF0b3IoKVxuICAgICAgcmV0dXJuXG4gICAgfVxuXG4gICAgdGhpcy5fY2xlYXJMb2NhbFNjaGVtYUNhY2hlKClcbiAgfVxuXG4gIC8qKlxuICAgKiBDbGVhcnMgb25seSB0aGUgbWV0YWRhdGEgY2FjaGVkIG9uIHRoaXMgZHJpdmVyIGluc3RhbmNlLlxuICAgKiBAcmV0dXJucyB7dm9pZH0gLSBObyByZXR1cm4gdmFsdWUuXG4gICAqL1xuICBfY2xlYXJMb2NhbFNjaGVtYUNhY2hlKCkge1xuICAgIHRoaXMuX3NjaGVtYUNhY2hlLmNsZWFyKClcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHNldCBzY2hlbWEgY2FjaGUgaW52YWxpZGF0b3IuXG4gICAqIEBwYXJhbSB7KCkgPT4gdm9pZH0gaW52YWxpZGF0b3IgLSBDYWxsYmFjayB1c2VkIHRvIGNsZWFyIHNjaGVtYSBjYWNoZXMgdGhhdCBzaGFyZSB0aGlzIGRyaXZlciBwb29sLlxuICAgKiBAcmV0dXJucyB7dm9pZH0gLSBObyByZXR1cm4gdmFsdWUuXG4gICAqL1xuICBzZXRTY2hlbWFDYWNoZUludmFsaWRhdG9yKGludmFsaWRhdG9yKSB7XG4gICAgdGhpcy5fc2NoZW1hQ2FjaGVJbnZhbGlkYXRvciA9IGludmFsaWRhdG9yXG4gIH1cblxuICAvKipcbiAgICogUnVucyBzY2hlbWEgY2FjaGUgZW5hYmxlZC5cbiAgICogQHJldHVybnMge2Jvb2xlYW59IC0gV2hldGhlciBzY2hlbWEgbWV0YWRhdGEgY2FjaGluZyBpcyBlbmFibGVkLlxuICAgKi9cbiAgX3NjaGVtYUNhY2hlRW5hYmxlZCgpIHtcbiAgICByZXR1cm4gdGhpcy5nZXRBcmdzKCkuc2NoZW1hQ2FjaGUgIT09IGZhbHNlXG4gIH1cblxuICAvKipcbiAgICogUnVucyBjYWNoZWQgc2NoZW1hIG1ldGFkYXRhLlxuICAgKiBAdGVtcGxhdGUgVFxuICAgKiBAcGFyYW0ge3N0cmluZ30gY2FjaGVLZXkgLSBTY2hlbWEgY2FjaGUga2V5LlxuICAgKiBAcGFyYW0geygpID0+IFByb21pc2U8VD59IGNhbGxiYWNrIC0gQ2FjaGUgbWlzcyBjYWxsYmFjay5cbiAgICogQHJldHVybnMge1Byb21pc2U8VD59IC0gUmVzb2x2ZXMgd2l0aCB0aGUgY2FjaGVkIG1ldGFkYXRhLlxuICAgKi9cbiAgYXN5bmMgX2NhY2hlZFNjaGVtYU1ldGFkYXRhKGNhY2hlS2V5LCBjYWxsYmFjaykge1xuICAgIGlmICghdGhpcy5fc2NoZW1hQ2FjaGVFbmFibGVkKCkpIHJldHVybiBhd2FpdCBjYWxsYmFjaygpXG5cbiAgICBjb25zdCBleGlzdGluZ1Byb21pc2UgPSB0aGlzLl9zY2hlbWFDYWNoZS5nZXQoY2FjaGVLZXkpXG5cbiAgICBpZiAoZXhpc3RpbmdQcm9taXNlKSB7XG4gICAgICByZXR1cm4gLyoqIEB0eXBlIHtUfSAqLyAodGhpcy5fc2NoZW1hQ2FjaGVSZXR1cm5WYWx1ZShhd2FpdCBleGlzdGluZ1Byb21pc2UpKVxuICAgIH1cblxuICAgIGNvbnN0IHByb21pc2UgPSAoYXN5bmMgKCkgPT4gYXdhaXQgY2FsbGJhY2soKSkoKVxuXG4gICAgdGhpcy5fc2NoZW1hQ2FjaGUuc2V0KGNhY2hlS2V5LCBwcm9taXNlKVxuXG4gICAgdHJ5IHtcbiAgICAgIHJldHVybiAvKiogQHR5cGUge1R9ICovICh0aGlzLl9zY2hlbWFDYWNoZVJldHVyblZhbHVlKGF3YWl0IHByb21pc2UpKVxuICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICBpZiAodGhpcy5fc2NoZW1hQ2FjaGUuZ2V0KGNhY2hlS2V5KSA9PT0gcHJvbWlzZSkge1xuICAgICAgICB0aGlzLl9zY2hlbWFDYWNoZS5kZWxldGUoY2FjaGVLZXkpXG4gICAgICB9XG5cbiAgICAgIHRocm93IGVycm9yXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgY2FjaGVkIHRhYmxlIHNjaGVtYSBtZXRhZGF0YS5cbiAgICogQHRlbXBsYXRlIFRcbiAgICogQHBhcmFtIHtzdHJpbmd9IHRhYmxlTmFtZSAtIFRhYmxlIG5hbWUuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBtZXRhZGF0YU5hbWUgLSBNZXRhZGF0YSBuYW1lLlxuICAgKiBAcGFyYW0geygpID0+IFByb21pc2U8VD59IGNhbGxiYWNrIC0gQ2FjaGUgbWlzcyBjYWxsYmFjay5cbiAgICogQHJldHVybnMge1Byb21pc2U8VD59IC0gUmVzb2x2ZXMgd2l0aCB0aGUgY2FjaGVkIHRhYmxlIG1ldGFkYXRhLlxuICAgKi9cbiAgYXN5bmMgX2NhY2hlZFRhYmxlU2NoZW1hTWV0YWRhdGEodGFibGVOYW1lLCBtZXRhZGF0YU5hbWUsIGNhbGxiYWNrKSB7XG4gICAgcmV0dXJuIGF3YWl0IHRoaXMuX2NhY2hlZFNjaGVtYU1ldGFkYXRhKGB0YWJsZToke3RhYmxlTmFtZX06JHttZXRhZGF0YU5hbWV9YCwgY2FsbGJhY2spXG4gIH1cblxuICAvKipcbiAgICogUnVucyBzY2hlbWEgY2FjaGUgcmV0dXJuIHZhbHVlLlxuICAgKiBAcGFyYW0ge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSB2YWx1ZSAtIENhY2hlZCB2YWx1ZS5cbiAgICogQHJldHVybnMge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSAtIFZhbHVlIHJldHVybmVkIHRvIGNhbGxlcnMuXG4gICAqL1xuICBfc2NoZW1hQ2FjaGVSZXR1cm5WYWx1ZSh2YWx1ZSkge1xuICAgIGlmIChBcnJheS5pc0FycmF5KHZhbHVlKSkgcmV0dXJuIHZhbHVlLnNsaWNlKClcblxuICAgIHJldHVybiB2YWx1ZVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZ2V0IHRhYmxlcy5cbiAgICogQGFic3RyYWN0XG4gICAqIEByZXR1cm5zIHtQcm9taXNlPEFycmF5PGltcG9ydChcIi4vYmFzZS10YWJsZS5qc1wiKS5kZWZhdWx0Pj59IC0gUmVzb2x2ZXMgd2l0aCB0aGUgdGFibGVzLlxuICAgKi9cbiAgZ2V0VGFibGVzKCkge1xuICAgIHRocm93IG5ldyBFcnJvcihgJHt0aGlzLmNvbnN0cnVjdG9yLm5hbWV9I2dldFRhYmxlcyBub3QgaW1wbGVtZW50ZWRgKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgc3RydWN0dXJlIHNxbC5cbiAgICogQHJldHVybnMge1Byb21pc2U8c3RyaW5nIHwgbnVsbD59IC0gUmVzb2x2ZXMgd2l0aCBTUUwgc3RyaW5nLlxuICAgKi9cbiAgYXN5bmMgc3RydWN0dXJlU3FsKCkge1xuICAgIHJldHVybiBudWxsXG4gIH1cblxuICAvKipcbiAgICogRXhlY3V0ZXMgYSB3aG9sZSBtdWx0aS1zdGF0ZW1lbnQgc3RydWN0dXJlIFNRTCBzY3JpcHQgaW4gYSBzaW5nbGUgcm91bmQtdHJpcCB3aGVuXG4gICAqIHRoZSBkcml2ZXIgc3VwcG9ydHMgaXQsIHJ1bm5pbmcgb24gdGhpcyBjb25uZWN0aW9uIChzbyB0aGUgY2FsbGVyJ3MgZm9yZWlnbi1rZXlcbiAgICogaGFuZGxpbmcgYXBwbGllcykuIFJldHVybnMgdHJ1ZSBpZiBpdCByYW4gdGhlIHdob2xlIHNjcmlwdDsgZmFsc2Ugd2hlbiB0aGUgY2FsbGVyXG4gICAqIHNob3VsZCBydW4gdGhlIHN0YXRlbWVudHMgaW5kaXZpZHVhbGx5LiBUaGUgYmFzZSBkcml2ZXIgaGFzIG5vIGJhdGNoIHBhdGguXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBfc3RydWN0dXJlU3FsIC0gRnVsbCBtdWx0aS1zdGF0ZW1lbnQgc3RydWN0dXJlIFNRTC5cbiAgICogQHJldHVybnMge1Byb21pc2U8Ym9vbGVhbj59IC0gV2hldGhlciB0aGUgc2NyaXB0IHdhcyBleGVjdXRlZCBhcyBvbmUgYmF0Y2guXG4gICAqL1xuICBhc3luYyBleGVjU3RydWN0dXJlU2NyaXB0KF9zdHJ1Y3R1cmVTcWwpIHtcbiAgICByZXR1cm4gZmFsc2VcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGdldCB0YWJsZSBieSBuYW1lLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gbmFtZSAtIE5hbWUuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBbYXJnc10gLSBPcHRpb25zIG9iamVjdC5cbiAgICogQHBhcmFtIHtib29sZWFufSBhcmdzLnRocm93RXJyb3IgLSBXaGV0aGVyIHRocm93IGVycm9yLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxpbXBvcnQoXCIuL2Jhc2UtdGFibGUuanNcIikuZGVmYXVsdCB8IHVuZGVmaW5lZD59IC0gUmVzb2x2ZXMgd2l0aCB0aGUgdGFibGUgYnkgbmFtZS5cbiAgICovXG4gIGFzeW5jIGdldFRhYmxlQnlOYW1lKG5hbWUsIGFyZ3MpIHtcbiAgICBjb25zdCB0YWJsZXMgPSBhd2FpdCB0aGlzLmdldFRhYmxlcygpXG4gICAgY29uc3QgdGFibGVOYW1lcyA9IFtdXG4gICAgbGV0IHRhYmxlXG5cbiAgICBmb3IgKGNvbnN0IGNhbmRpZGF0ZSBvZiB0YWJsZXMpIHtcbiAgICAgIGNvbnN0IGNhbmRpZGF0ZU5hbWUgPSBjYW5kaWRhdGUuZ2V0TmFtZSgpXG5cbiAgICAgIGlmIChjYW5kaWRhdGVOYW1lID09IG5hbWUpIHtcbiAgICAgICAgdGFibGUgPSBjYW5kaWRhdGVcbiAgICAgICAgYnJlYWtcbiAgICAgIH1cblxuICAgICAgdGFibGVOYW1lcy5wdXNoKGNhbmRpZGF0ZU5hbWUpXG4gICAgfVxuXG4gICAgaWYgKCF0YWJsZSAmJiBhcmdzPy50aHJvd0Vycm9yICE9PSBmYWxzZSkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKHRoaXMuX21pc3NpbmdUYWJsZUVycm9yTWVzc2FnZShuYW1lLCB0YWJsZU5hbWVzKSlcbiAgICB9XG5cbiAgICByZXR1cm4gdGFibGVcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIG1pc3NpbmcgdGFibGUgZXJyb3IgbWVzc2FnZS5cbiAgICogQHBhcmFtIHtzdHJpbmd9IG5hbWUgLSBUYWJsZSBuYW1lLlxuICAgKiBAcGFyYW0ge3N0cmluZ1tdfSB0YWJsZU5hbWVzIC0gQXZhaWxhYmxlIHRhYmxlIG5hbWVzLlxuICAgKiBAcmV0dXJucyB7c3RyaW5nfSAtIEVycm9yIG1lc3NhZ2UuXG4gICAqL1xuICBfbWlzc2luZ1RhYmxlRXJyb3JNZXNzYWdlKG5hbWUsIHRhYmxlTmFtZXMpIHtcbiAgICBjb25zdCBlbnZpcm9ubWVudCA9IHRoaXMuZ2V0Q29uZmlndXJhdGlvbigpLmdldEVudmlyb25tZW50KClcbiAgICBjb25zdCBhcmdzID0gdGhpcy5nZXRBcmdzKClcbiAgICBjb25zdCBkYXRhYmFzZU5hbWUgPSBhcmdzPy5kYXRhYmFzZSB8fCBhcmdzPy5uYW1lIHx8IGFyZ3M/LnVzZURhdGFiYXNlIHx8IFwidW5rbm93blwiXG5cbiAgICByZXR1cm4gYENvdWxkbid0IGZpbmQgYSB0YWJsZSBieSB0aGF0IG5hbWUgXCIke25hbWV9XCIgaW46ICR7dGFibGVOYW1lcy5qb2luKFwiLCBcIil9IChlbnZpcm9ubWVudDogJHtlbnZpcm9ubWVudH0sIGRhdGFiYXNlOiAke2RhdGFiYXNlTmFtZX0pYFxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZ2V0IHRhYmxlIGJ5IG5hbWUgb3IgZmFpbC5cbiAgICogQHBhcmFtIHtzdHJpbmd9IG5hbWUgLSBOYW1lLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxpbXBvcnQoXCIuL2Jhc2UtdGFibGUuanNcIikuZGVmYXVsdD59IC0gUmVzb2x2ZXMgd2l0aCB0aGUgdGFibGUgYnkgbmFtZSBvciBmYWlsLlxuICAgKi9cbiAgYXN5bmMgZ2V0VGFibGVCeU5hbWVPckZhaWwobmFtZSkge1xuICAgIHJldHVybiAvKiogQHR5cGUge2ltcG9ydChcIi4vYmFzZS10YWJsZS5qc1wiKS5kZWZhdWx0fSAqLyAoYXdhaXQgdGhpcy5nZXRUYWJsZUJ5TmFtZShuYW1lLCB7dGhyb3dFcnJvcjogdHJ1ZX0pKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZ2V0IHR5cGUuXG4gICAqIEBhYnN0cmFjdFxuICAgKiBAcmV0dXJucyB7c3RyaW5nfSAtIFRoZSB0eXBlLlxuICAgKi9cbiAgZ2V0VHlwZSgpIHtcbiAgICB0aHJvdyBuZXcgRXJyb3IoXCIndHlwZScgbm90IGltcGxlbWVudGVkXCIpXG4gIH1cblxuICAvKipcbiAgICogV2hldGhlciB0aGlzIGRyaXZlciBjYW4gY29tYmluZSB1bnJlbGF0ZWQgYWx0ZXItdGFibGUgb3BlcmF0aW9ucyBpbnRvIGFcbiAgICogc2luZ2xlIGBBTFRFUiBUQUJMRWAgc3RhdGVtZW50IChSYWlscycgYHN1cHBvcnRzX2J1bGtfYWx0ZXJgKS5cbiAgICogQHJldHVybnMge2Jvb2xlYW59IC0gV2hldGhlciBidWxrIGFsdGVyIGlzIHN1cHBvcnRlZC5cbiAgICovXG4gIHN1cHBvcnRzQnVsa0FsdGVyKCkge1xuICAgIHJldHVybiBmYWxzZVxuICB9XG5cbiAgLyoqXG4gICAqIFdoZXRoZXIgYSBidWxrIGBBTFRFUiBUQUJMRWAgc3RhdGVtZW50IGNhbiBhbHNvIGNhcnJ5IGBBREQgSU5ERVhgIGNsYXVzZXMuXG4gICAqIE9ubHkgZHJpdmVycyB0aGF0IHN1cHBvcnQgdGhpcyBrZWVwIGluZGV4IGFkZHMgaW5zaWRlIHRoZSBjb21iaW5lZCBiYXRjaDtcbiAgICogdGhlIHJlc3QgZXhlY3V0ZSBlYWNoIGluZGV4IGFzIGl0cyBvd24gc3RhdGVtZW50LlxuICAgKiBAcmV0dXJucyB7Ym9vbGVhbn0gLSBXaGV0aGVyIGluZGV4ZXMgY2FuIGJlIGFkZGVkIGluc2lkZSBhIGJ1bGsgYWx0ZXIuXG4gICAqL1xuICBzdXBwb3J0c0J1bGtBbHRlckluZGV4ZXMoKSB7XG4gICAgcmV0dXJuIGZhbHNlXG4gIH1cblxuICAvKipcbiAgICogUnVucyBpbnNlcnQuXG4gICAqIEBwYXJhbSB7SW5zZXJ0U3FsQXJnc1R5cGV9IGFyZ3MgLSBPcHRpb25zIG9iamVjdC5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgd2hlbiBjb21wbGV0ZS5cbiAgICovXG4gIGFzeW5jIGluc2VydChhcmdzKSB7XG4gICAgdGhpcy5fYXNzZXJ0Tm90UmVhZE9ubHkoKVxuICAgIGNvbnN0IHNxbCA9IHRoaXMuaW5zZXJ0U3FsKGFyZ3MpXG5cbiAgICBhd2FpdCB0aGlzLnF1ZXJ5KHNxbClcbiAgfVxuXG4gIC8qKlxuICAgKiBNYXhpbXVtIHJvd3MgcGVyIGBJTlNFUlQgLi4uIFZBTFVFUyAoLi4uKSwgKC4uLiksIC4uLmAgc3RhdGVtZW50LiBEcml2ZXJzXG4gICAqIHRoYXQgYnVpbGQgbXVsdGktdmFsdWUgaW5zZXJ0cyBtdXN0IHN0YXkgYmVsb3cgZGF0YWJhc2Utc3BlY2lmaWMgbGltaXRzXG4gICAqIChTUUxpdGUncyBgTUFYX1ZBUklBQkxFX05VTUJFUmAsIFNRTCBTZXJ2ZXIncyAyMTAwIHBhcmFtZXRlcnMsIFBvc3RncmVTUUwnc1xuICAgKiA2NTUzNSBwYXJhbWV0ZXJzLCBhbmQgc28gb24pLiA1MDAgcm93cyBpcyBzYWZlbHkgdW5kZXIgZXZlcnkgbWFqb3IgZW5naW5lXG4gICAqIGZvciB0YWJsZXMgd2l0aCBhIG1vZGVyYXRlIG51bWJlciBvZiBjb2x1bW5zIGFuZCBrZWVwcyBnZW5lcmF0ZWQgU1FMIHNtYWxsLlxuICAgKlxuICAgKiBPdmVycmlkZSB2aWEgYG1heFJvd3NQZXJJbnNlcnRgIGluIHRoZSBkYXRhYmFzZSBjb25maWd1cmF0aW9uLlxuICAgKiBAcmV0dXJucyB7bnVtYmVyfSAtIE1heGltdW0gcm93cyBwZXIgaW5zZXJ0IHN0YXRlbWVudC5cbiAgICovXG4gIG1heFJvd3NQZXJJbnNlcnQoKSB7XG4gICAgcmV0dXJuIG9wdGlvbmFsUG9zaXRpdmVJbnRlZ2VyKHRoaXMuZ2V0QXJncygpLm1heFJvd3NQZXJJbnNlcnQsIFwibWF4Um93c1Blckluc2VydFwiKSA/PyA1MDBcbiAgfVxuXG4gIC8qKlxuICAgKiBNYXhpbXVtIHNlcmlhbGl6ZWQgU1FMIHNpemUsIGluIGJ5dGVzLCBmb3IgYSBzaW5nbGUgYElOU0VSVCAuLi4gVkFMVUVTYFxuICAgKiBzdGF0ZW1lbnQuIExhcmdlIHRleHQvSlNPTiBwYXlsb2FkcyBjYW4gcHVzaCBhIG1vZGVzdCByb3cgY291bnQgd2VsbCBiZXlvbmRcbiAgICogZGF0YWJhc2Ugd2lyZS9wcm90b2NvbCBsaW1pdHMsIHNvIGNodW5raW5nIGFsc28gc3RvcHMgd2hlbiB0aGUgbmV4dCByb3dcbiAgICogd291bGQgcHVzaCB0aGUgZ2VuZXJhdGVkIHN0cmluZyBvdmVyIHRoaXMgdGhyZXNob2xkLlxuICAgKlxuICAgKiBPdmVycmlkZSB2aWEgYG1heEluc2VydFNxbEJ5dGVzYCBpbiB0aGUgZGF0YWJhc2UgY29uZmlndXJhdGlvbi5cbiAgICogQHJldHVybnMge251bWJlcn0gLSBNYXhpbXVtIGJ5dGVzIHBlciBpbnNlcnQgc3RhdGVtZW50LlxuICAgKi9cbiAgbWF4SW5zZXJ0U3FsQnl0ZXMoKSB7XG4gICAgcmV0dXJuIG9wdGlvbmFsUG9zaXRpdmVJbnRlZ2VyKHRoaXMuZ2V0QXJncygpLm1heEluc2VydFNxbEJ5dGVzLCBcIm1heEluc2VydFNxbEJ5dGVzXCIpID8/IDEwNDg1NzZcbiAgfVxuXG4gIC8qKlxuICAgKiBNYXhpbXVtIHZhbHVlcyBpbiBhIHNpbmdsZSBgSU4gKC4uLilgIGNvaG9ydCB1c2VkIGJ5IHByZWxvYWRzLCBhc3NvY2lhdGlvblxuICAgKiBjb3VudHMsIGFuZCBxdWVyeURhdGEgYWdncmVnYXRlcy4gVGhlIGRlZmF1bHQgc3RheXMgdW5kZXIgU1FMaXRlJ3MgZGVmYXVsdFxuICAgKiBgTUFYX1ZBUklBQkxFX05VTUJFUmAgY29tcGlsZS10aW1lIGxpbWl0LlxuICAgKlxuICAgKiBPdmVycmlkZSB2aWEgYG1heEluQ2xhdXNlVmFsdWVzYCBpbiB0aGUgZGF0YWJhc2UgY29uZmlndXJhdGlvbi5cbiAgICogQHJldHVybnMge251bWJlcn0gLSBNYXhpbXVtIHZhbHVlcyBwZXIgSU4gY2xhdXNlIGNvaG9ydC5cbiAgICovXG4gIG1heEluQ2xhdXNlVmFsdWVzKCkge1xuICAgIHJldHVybiBvcHRpb25hbFBvc2l0aXZlSW50ZWdlcih0aGlzLmdldEFyZ3MoKS5tYXhJbkNsYXVzZVZhbHVlcywgXCJtYXhJbkNsYXVzZVZhbHVlc1wiKSA/PyA5OTlcbiAgfVxuXG4gIC8qKlxuICAgKiBNYXhpbXVtIHNlcmlhbGl6ZWQgU1FMIHNpemUsIGluIGJ5dGVzLCBmb3IgYSBzaW5nbGUgY29ob3J0IHF1ZXJ5IHVzZWQgYnlcbiAgICogcHJlbG9hZHMsIGFzc29jaWF0aW9uIGNvdW50cywgYW5kIHF1ZXJ5RGF0YSBhZ2dyZWdhdGVzLiBDb2hvcnQgY2h1bmtpbmdcbiAgICogc3RvcHMgd2hlbiB0aGUgbmV4dCB2YWx1ZSB3b3VsZCBwdXNoIHRoZSBnZW5lcmF0ZWQgc3RyaW5nIG92ZXIgdGhpcyB0aHJlc2hvbGQuXG4gICAqXG4gICAqIE92ZXJyaWRlIHZpYSBgbWF4UXVlcnlTcWxCeXRlc2AgaW4gdGhlIGRhdGFiYXNlIGNvbmZpZ3VyYXRpb24uXG4gICAqIEByZXR1cm5zIHtudW1iZXJ9IC0gTWF4aW11bSBieXRlcyBwZXIgY29ob3J0IHF1ZXJ5LlxuICAgKi9cbiAgbWF4UXVlcnlTcWxCeXRlcygpIHtcbiAgICByZXR1cm4gb3B0aW9uYWxQb3NpdGl2ZUludGVnZXIodGhpcy5nZXRBcmdzKCkubWF4UXVlcnlTcWxCeXRlcywgXCJtYXhRdWVyeVNxbEJ5dGVzXCIpID8/IDEwNDg1NzZcbiAgfVxuXG4gIC8qKlxuICAgKiBTcGxpdHMgYHZhbHVlc2AgaW50byBjb2hvcnQgY2h1bmtzIHRoYXQgc3RheSB3aXRoaW4gYm90aCBgbWF4Q291bnRgIGFuZFxuICAgKiBgbWF4Qnl0ZXNgIHdoaWxlIHByZXNlcnZpbmcgb3JkZXIuXG4gICAqXG4gICAqIEEgY2h1bmsgYWx3YXlzIGNvbnRhaW5zIGF0IGxlYXN0IG9uZSB2YWx1ZSwgZXZlbiBpZiB0aGF0IHNpbmdsZSB2YWx1ZSBleGNlZWRzXG4gICAqIHRoZSBieXRlIGxpbWl0LCBzbyBwcm9ncmVzcyBpcyBndWFyYW50ZWVkLlxuICAgKiBAdGVtcGxhdGUgVFxuICAgKiBAcGFyYW0ge0FycmF5PFQ+fSB2YWx1ZXMgLSBWYWx1ZXMgdG8gY2h1bmsuXG4gICAqIEBwYXJhbSB7KHZhbHVlczogQXJyYXk8VD4pID0+IHN0cmluZ30gYnVpbGRTcWwgLSBGdW5jdGlvbiB0aGF0IGJ1aWxkcyB0aGUgZnVsbCBTUUwgZm9yIGEgY2FuZGlkYXRlIGNodW5rLlxuICAgKiBAcGFyYW0ge3ttYXhDb3VudD86IG51bWJlciwgbWF4Qnl0ZXM/OiBudW1iZXJ9fSBbb3B0aW9uc10gLSBDaHVua2luZyBib3VuZHMuXG4gICAqIEByZXR1cm5zIHtBcnJheTxBcnJheTxUPj59IC0gVmFsdWUgY29ob3J0cy5cbiAgICovXG4gIGNodW5rVmFsdWVzKHZhbHVlcywgYnVpbGRTcWwsIHttYXhDb3VudCA9IHRoaXMubWF4SW5DbGF1c2VWYWx1ZXMoKSwgbWF4Qnl0ZXMgPSB0aGlzLm1heFF1ZXJ5U3FsQnl0ZXMoKX0gPSB7fSkge1xuICAgIGlmICh2YWx1ZXMubGVuZ3RoID09PSAwKSByZXR1cm4gW11cblxuICAgIC8qKlxuICAgICAqIENodW5rcy5cbiAgICAgKiBAdHlwZSB7QXJyYXk8QXJyYXk8VD4+fSAqL1xuICAgIGNvbnN0IGNodW5rcyA9IFtdXG4gICAgLyoqXG4gICAgICogQ3VycmVudCBjaHVuay5cbiAgICAgKiBAdHlwZSB7QXJyYXk8VD59ICovXG4gICAgbGV0IGN1cnJlbnRDaHVuayA9IFtdXG5cbiAgICBmb3IgKGNvbnN0IHZhbHVlIG9mIHZhbHVlcykge1xuICAgICAgY29uc3QgY2FuZGlkYXRlID0gWy4uLmN1cnJlbnRDaHVuaywgdmFsdWVdXG4gICAgICBjb25zdCBjYW5kaWRhdGVCeXRlcyA9IHV0ZjhCeXRlTGVuZ3RoKGJ1aWxkU3FsKGNhbmRpZGF0ZSkpXG5cbiAgICAgIGlmIChjdXJyZW50Q2h1bmsubGVuZ3RoID4gMCAmJiAoY2FuZGlkYXRlLmxlbmd0aCA+IG1heENvdW50IHx8IGNhbmRpZGF0ZUJ5dGVzID4gbWF4Qnl0ZXMpKSB7XG4gICAgICAgIGNodW5rcy5wdXNoKGN1cnJlbnRDaHVuaylcbiAgICAgICAgY3VycmVudENodW5rID0gW3ZhbHVlXVxuICAgICAgfSBlbHNlIHtcbiAgICAgICAgY3VycmVudENodW5rID0gY2FuZGlkYXRlXG4gICAgICB9XG4gICAgfVxuXG4gICAgaWYgKGN1cnJlbnRDaHVuay5sZW5ndGggPiAwKSB7XG4gICAgICBjaHVua3MucHVzaChjdXJyZW50Q2h1bmspXG4gICAgfVxuXG4gICAgcmV0dXJuIGNodW5rc1xuICB9XG5cbiAgLyoqXG4gICAqIFNwbGl0cyBgcm93c2AgaW50byBjaHVua3MgdGhhdCBzdGF5IHdpdGhpbiBib3RoIHtAbGluayBtYXhSb3dzUGVySW5zZXJ0fVxuICAgKiBhbmQge0BsaW5rIG1heEluc2VydFNxbEJ5dGVzfSB3aGlsZSBwcmVzZXJ2aW5nIG9yZGVyLlxuICAgKlxuICAgKiBCeXRlIGFjY291bnRpbmcgaXMgaW5jcmVtZW50YWw6IGBidWlsZFNxbGAgaXMgY2FsbGVkIG9uY2Ugd2l0aCBgW11gIHRvXG4gICAqIG1lYXN1cmUgdGhlIHN0YXRlbWVudCBwcmVmaXggYW5kIG9uY2UgcGVyIHJvdyB3aXRoIGBbcm93XWAgdG8gbWVhc3VyZSB0aGVcbiAgICogcm93J3MgdmFsdWVzIHR1cGxlLiBUaGlzIGtlZXBzIGNodW5raW5nIGxpbmVhciBpbiB0aGUgbnVtYmVyIG9mIHJvd3NcbiAgICogaW5zdGVhZCBvZiByZWJ1aWxkaW5nIHRoZSBmdWxsIG11bHRpLXJvdyBTUUwgZm9yIGV2ZXJ5IGNhbmRpZGF0ZS5cbiAgICpcbiAgICogQSBjaHVuayBhbHdheXMgY29udGFpbnMgYXQgbGVhc3Qgb25lIHJvdywgZXZlbiBpZiB0aGF0IHNpbmdsZSByb3cgZXhjZWVkc1xuICAgKiB0aGUgYnl0ZSBsaW1pdCwgc28gcHJvZ3Jlc3MgaXMgZ3VhcmFudGVlZC5cbiAgICogQHBhcmFtIHtBcnJheTxBcnJheTxSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj4+fSByb3dzIC0gUm93cyB0byBpbnNlcnQuXG4gICAqIEBwYXJhbSB7KHJvd3M6IEFycmF5PEFycmF5PFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pj4pID0+IHN0cmluZ30gYnVpbGRTcWwgLSBGdW5jdGlvbiB0aGF0IGJ1aWxkcyB0aGUgZnVsbCBTUUwgZm9yIGEgY2FuZGlkYXRlIGNodW5rOyBjYWxsZWQgd2l0aCBgW11gIHRvIG1lYXN1cmUgdGhlIHN0YXRlbWVudCBwcmVmaXggYW5kIHdpdGggYFtyb3ddYCB0byBtZWFzdXJlIGVhY2ggcm93J3MgdmFsdWVzIHR1cGxlLlxuICAgKiBAcmV0dXJucyB7QXJyYXk8QXJyYXk8QXJyYXk8UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+Pj59IC0gUm93IGNodW5rcy5cbiAgICovXG4gIF9pbnNlcnRNdWx0aXBsZUNodW5rcyhyb3dzLCBidWlsZFNxbCkge1xuICAgIGNvbnN0IGNodW5rcyA9IFtdXG4gICAgY29uc3QgbWF4Um93cyA9IHRoaXMubWF4Um93c1Blckluc2VydCgpXG4gICAgY29uc3QgbWF4Qnl0ZXMgPSB0aGlzLm1heEluc2VydFNxbEJ5dGVzKClcbiAgICBjb25zdCBlbXB0eVNxbCA9IGJ1aWxkU3FsKFtdKVxuICAgIGNvbnN0IHByZWZpeCA9IGAke2VtcHR5U3FsfSBWQUxVRVMgYFxuICAgIGNvbnN0IGJhc2VCeXRlTGVuZ3RoID0gdXRmOEJ5dGVMZW5ndGgocHJlZml4KVxuXG4gICAgLyoqXG4gICAgICogQ3VycmVudCBjaHVuay5cbiAgICAgKiBAdHlwZSB7QXJyYXk8QXJyYXk8UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+Pn0gKi9cbiAgICBsZXQgY3VycmVudENodW5rID0gW11cbiAgICBsZXQgY3VycmVudEJ5dGVzID0gMFxuXG4gICAgZm9yIChjb25zdCByb3cgb2Ygcm93cykge1xuICAgICAgY29uc3Qgc2luZ2xlUm93U3FsID0gYnVpbGRTcWwoW3Jvd10pXG4gICAgICBjb25zdCByb3dWYWx1ZXNTcWwgPSBzaW5nbGVSb3dTcWwuc2xpY2UocHJlZml4Lmxlbmd0aClcbiAgICAgIGNvbnN0IHJvd1ZhbHVlc1NxbEJ5dGVzID0gdXRmOEJ5dGVMZW5ndGgocm93VmFsdWVzU3FsKVxuXG4gICAgICBpZiAoY3VycmVudENodW5rLmxlbmd0aCA+IDApIHtcbiAgICAgICAgY29uc3QgY2FuZGlkYXRlUm93cyA9IGN1cnJlbnRDaHVuay5sZW5ndGggKyAxXG4gICAgICAgIGNvbnN0IGNhbmRpZGF0ZUJ5dGVzID0gY3VycmVudEJ5dGVzICsgMiArIHJvd1ZhbHVlc1NxbEJ5dGVzIC8vIFwiLCBcIiBzZXBhcmF0b3JcblxuICAgICAgICBpZiAoY2FuZGlkYXRlUm93cyA+IG1heFJvd3MgfHwgY2FuZGlkYXRlQnl0ZXMgPiBtYXhCeXRlcykge1xuICAgICAgICAgIGNodW5rcy5wdXNoKGN1cnJlbnRDaHVuaylcbiAgICAgICAgICBjdXJyZW50Q2h1bmsgPSBbXVxuICAgICAgICAgIGN1cnJlbnRCeXRlcyA9IDBcbiAgICAgICAgfVxuICAgICAgfVxuXG4gICAgICBpZiAoY3VycmVudENodW5rLmxlbmd0aCA9PT0gMCkge1xuICAgICAgICBjdXJyZW50Qnl0ZXMgPSBiYXNlQnl0ZUxlbmd0aCArIHJvd1ZhbHVlc1NxbEJ5dGVzXG4gICAgICB9IGVsc2Uge1xuICAgICAgICBjdXJyZW50Qnl0ZXMgKz0gMiArIHJvd1ZhbHVlc1NxbEJ5dGVzXG4gICAgICB9XG5cbiAgICAgIGN1cnJlbnRDaHVuay5wdXNoKHJvdylcbiAgICB9XG5cbiAgICBpZiAoY3VycmVudENodW5rLmxlbmd0aCA+IDApIHtcbiAgICAgIGNodW5rcy5wdXNoKGN1cnJlbnRDaHVuaylcbiAgICB9XG5cbiAgICByZXR1cm4gY2h1bmtzXG4gIH1cblxuICAvKipcbiAgICogUnVucyBpbnNlcnQgbXVsdGlwbGUuXG4gICAqXG4gICAqIExhcmdlIHJvdyBzZXRzIGFyZSBzcGxpdCBpbnRvIG11bHRpcGxlIHN0YXRlbWVudHMgdGhhdCBlYWNoIHN0YXkgd2l0aGluXG4gICAqIHtAbGluayBtYXhSb3dzUGVySW5zZXJ0fSByb3dzIGFuZCB7QGxpbmsgbWF4SW5zZXJ0U3FsQnl0ZXN9IHNlcmlhbGl6ZWRcbiAgICogYnl0ZXMgc28gdGhlIGdlbmVyYXRlZCBTUUwgc3RheXMgd2l0aGluIGRhdGFiYXNlIHBhcmFtZXRlciBhbmQgd2lyZSBsaW1pdHMuXG4gICAqIFdoZW4gY2FsbGVkIG91dHNpZGUgYSB0cmFuc2FjdGlvbiBlYWNoIGNodW5rIGNvbW1pdHMgaW5kZXBlbmRlbnRseTsgY2FsbGVyc1xuICAgKiB0aGF0IG5lZWQgYWxsLW9yLW5vdGhpbmcgc2VtYW50aWNzIHNob3VsZCB3cmFwIHRoZSBjYWxsIGluIHtAbGluayB0cmFuc2FjdGlvbn0uXG4gICAqIEBwYXJhbSB7c3RyaW5nfSB0YWJsZU5hbWUgLSBUYWJsZSBuYW1lLlxuICAgKiBAcGFyYW0ge0FycmF5PHN0cmluZz59IGNvbHVtbnMgLSBDb2x1bW4gbmFtZXMuXG4gICAqIEBwYXJhbSB7QXJyYXk8QXJyYXk8UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+Pn0gcm93cyAtIFJvd3MgdG8gaW5zZXJ0LlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyB3aGVuIGNvbXBsZXRlLlxuICAgKi9cbiAgYXN5bmMgaW5zZXJ0TXVsdGlwbGUodGFibGVOYW1lLCBjb2x1bW5zLCByb3dzKSB7XG4gICAgdGhpcy5fYXNzZXJ0Tm90UmVhZE9ubHkoKVxuXG4gICAgY29uc3QgY2h1bmtzID0gdGhpcy5faW5zZXJ0TXVsdGlwbGVDaHVua3Mocm93cywgKGNodW5rUm93cykgPT4gdGhpcy5pbnNlcnRTcWwoe2NvbHVtbnMsIHRhYmxlTmFtZSwgcm93czogY2h1bmtSb3dzfSkpXG5cbiAgICBmb3IgKGNvbnN0IGNodW5rIG9mIGNodW5rcykge1xuICAgICAgY29uc3Qgc3FsID0gdGhpcy5pbnNlcnRTcWwoe2NvbHVtbnMsIHRhYmxlTmFtZSwgcm93czogY2h1bmt9KVxuXG4gICAgICBhd2FpdCB0aGlzLnF1ZXJ5KHNxbClcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogUnVucyBpbnNlcnQgc3FsLlxuICAgKiBAYWJzdHJhY3RcbiAgICogQHBhcmFtIHtJbnNlcnRTcWxBcmdzVHlwZX0gYXJncyAtIE9wdGlvbnMgb2JqZWN0LlxuICAgKiBAcmV0dXJucyB7c3RyaW5nfSAtIFNRTCBzdHJpbmcuXG4gICAqL1xuICBpbnNlcnRTcWwoYXJncykgeyAvLyBlc2xpbnQtZGlzYWJsZS1saW5lIG5vLXVudXNlZC12YXJzXG4gICAgdGhyb3cgbmV3IEVycm9yKFwiJ2luc2VydFNxbCcgbm90IGltcGxlbWVudGVkXCIpXG4gIH1cblxuICAvKipcbiAgICogUnVucyB1cHNlcnQuXG4gICAqIEBwYXJhbSB7VXBzZXJ0U3FsQXJnc1R5cGV9IGFyZ3MgLSBPcHRpb25zIG9iamVjdC5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgd2hlbiBjb21wbGV0ZS5cbiAgICovXG4gIGFzeW5jIHVwc2VydChhcmdzKSB7XG4gICAgdGhpcy5fYXNzZXJ0Tm90UmVhZE9ubHkoKVxuICAgIGNvbnN0IHNxbCA9IHRoaXMudXBzZXJ0U3FsKGFyZ3MpXG5cbiAgICBhd2FpdCB0aGlzLnF1ZXJ5KHNxbClcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGxhc3QgaW5zZXJ0IGlkLlxuICAgKiBAYWJzdHJhY3RcbiAgICogQHBhcmFtIHtRdWVyeU9wdGlvbnN9IFtfb3B0aW9uc10gLSBRdWVyeSBvd25lcnNoaXAgb3B0aW9ucy5cbiAgICogQHJldHVybnMge1Byb21pc2U8bnVtYmVyPn0gLSBSZXNvbHZlcyB3aXRoIHRoZSBsYXN0IGluc2VydCBpZC5cbiAgICovXG4gIGxhc3RJbnNlcnRJRChfb3B0aW9ucyA9IHt9KSB7XG4gICAgdGhyb3cgbmV3IEVycm9yKGAke3RoaXMuY29uc3RydWN0b3IubmFtZX0jbGFzdEluc2VydElEIG5vdCBpbXBsZW1lbnRlZGApXG4gIH1cblxuICAvKipcbiAgICogUnVucyBjb252ZXJ0IHZhbHVlLlxuICAgKiBAcGFyYW0ge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSB2YWx1ZSAtIFZhbHVlIHRvIHVzZS5cbiAgICogQHJldHVybnMge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSAtIFRoZSBjb252ZXJ0IHZhbHVlLlxuICAgKi9cbiAgX2NvbnZlcnRWYWx1ZSh2YWx1ZSkge1xuICAgIGlmICh0eXBlb2YgdmFsdWUgPT09IFwiYm9vbGVhblwiKSB7XG4gICAgICByZXR1cm4gdmFsdWUgPyAxIDogMFxuICAgIH1cblxuICAgIC8vIGlzRGF0ZSBpbnN0ZWFkIG9mIGluc3RhbmNlb2Y6IGEgRGF0ZSBjcmVhdGVkIGluIGFub3RoZXIgcmVhbG0gKGUuZy4gdGhlIGNvbnNvbGUgUkVQTCkgd291bGRcbiAgICAvLyBmYWlsIGluc3RhbmNlb2YsIHNraXAgdGhpcyBjb252ZXJzaW9uLCBhbmQgc2VyaWFsaXplIGFzIGFuIGVtcHR5IFNRTCB2YWx1ZSBkb3duc3RyZWFtLlxuICAgIGlmIChpc0RhdGUodmFsdWUpKSB7XG4gICAgICByZXR1cm4gZm9ybWF0RGF0ZUZvckRhdGFiYXNlKHZhbHVlLCB7ZGF0YWJhc2VUeXBlOiB0aGlzLmdldFR5cGUoKX0pXG4gICAgfVxuXG4gICAgLy8gSlNPTi1lbmNvZGUgcGxhaW4gb2JqZWN0cy9hcnJheXMgc28gdGhleSBsYW5kIGluIEpTT04vdGV4dCBjb2x1bW5zIGFzIHZhbGlkXG4gICAgLy8gSlNPTi4gV2l0aG91dCB0aGlzLCBkcml2ZXJzIGxpa2UgbXlzcWwncyBlc2NhcGUoKSB0dXJuIGFuIG9iamVjdCBpbnRvXG4gICAgLy8gYGtleWAgPSB2YWx1ZSBhc3NpZ25tZW50IHBhaXJzIChpdHMgYFNFVCA/YCBmb3JtKSwgcHJvZHVjaW5nIGludmFsaWQgU1FMIGluXG4gICAgLy8gYSB2YWx1ZSBwb3NpdGlvbi4gT25seSBQTEFJTiBvYmplY3RzIGFuZCBhcnJheXMgYXJlIGVuY29kZWQg4oCUIGNsYXNzXG4gICAgLy8gaW5zdGFuY2VzIChlLmcuIG1vZGVsIHJlY29yZHMsIHdoaWNoIGFyZSBjaXJjdWxhciB2aWEgX2NoYW5nZXMpIGFuZCBCdWZmZXJzXG4gICAgLy8gcGFzcyB0aHJvdWdoIHVudG91Y2hlZCwgc2luY2UgSlNPTi5zdHJpbmdpZnkgb24gYSByZWNvcmQgdGhyb3dzIG9uIGl0c1xuICAgIC8vIGNpcmN1bGFyIHN0cnVjdHVyZSBhbmQgYSByZWNvcmQgaXMgbmV2ZXIgYSB2YWxpZCBjb2x1bW4gdmFsdWUgdG8gc2VyaWFsaXplLlxuICAgIGlmICh0aGlzLl9pc0pzb25FbmNvZGFibGVWYWx1ZSh2YWx1ZSkpIHtcbiAgICAgIHJldHVybiBKU09OLnN0cmluZ2lmeSh2YWx1ZSlcbiAgICB9XG5cbiAgICByZXR1cm4gdmFsdWVcbiAgfVxuXG4gIC8qKlxuICAgKiBXaGV0aGVyIGEgdmFsdWUgaXMgYSBwbGFpbiBvYmplY3Qgb3IgYXJyYXkgdGhhdCBzaG91bGQgYmUgSlNPTi1lbmNvZGVkIGZvciBhXG4gICAqIEpTT04vdGV4dCBjb2x1bW4uIEV4Y2x1ZGVzIEJ1ZmZlcnMgYW5kIGNsYXNzIGluc3RhbmNlcyAoZS5nLiBtb2RlbCByZWNvcmRzKS5cbiAgICogQHBhcmFtIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gdmFsdWUgLSBWYWx1ZSB0byB0ZXN0LlxuICAgKiBAcmV0dXJucyB7Ym9vbGVhbn0gLSBXaGV0aGVyIHRvIEpTT04tZW5jb2RlIHRoZSB2YWx1ZS5cbiAgICovXG4gIF9pc0pzb25FbmNvZGFibGVWYWx1ZSh2YWx1ZSkge1xuICAgIGlmICh2YWx1ZSA9PT0gbnVsbCB8fCB0eXBlb2YgdmFsdWUgIT09IFwib2JqZWN0XCIpIHJldHVybiBmYWxzZVxuICAgIGlmICh0eXBlb2YgQnVmZmVyICE9PSBcInVuZGVmaW5lZFwiICYmIEJ1ZmZlci5pc0J1ZmZlcih2YWx1ZSkpIHJldHVybiBmYWxzZVxuICAgIGlmIChBcnJheS5pc0FycmF5KHZhbHVlKSkgcmV0dXJuIHRydWVcblxuICAgIGNvbnN0IHByb3RvdHlwZSA9IE9iamVjdC5nZXRQcm90b3R5cGVPZih2YWx1ZSlcblxuICAgIHJldHVybiBwcm90b3R5cGUgPT09IE9iamVjdC5wcm90b3R5cGUgfHwgcHJvdG90eXBlID09PSBudWxsXG4gIH1cblxuICAvKipcbiAgICogUnVucyBvcHRpb25zLlxuICAgKiBAYWJzdHJhY3RcbiAgICogQHJldHVybnMge2ltcG9ydChcIi4uL3F1ZXJ5LXBhcnNlci9vcHRpb25zLmpzXCIpLmRlZmF1bHR9IC0gVGhlIG9wdGlvbnMgb3B0aW9ucy5cbiAgICovXG4gIG9wdGlvbnMoKSB7XG4gICAgdGhyb3cgbmV3IEVycm9yKFwiJ29wdGlvbnMnIG5vdCBpbXBsZW1lbnRlZC5cIilcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHF1b3RlLlxuICAgKiBAcGFyYW0ge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSB2YWx1ZSAtIFZhbHVlIHRvIHVzZS5cbiAgICogQHJldHVybnMge251bWJlciB8IHN0cmluZ30gLSBUaGUgcXVvdGUuXG4gICAqL1xuICBxdW90ZSh2YWx1ZSkge1xuICAgIGlmICh0eXBlb2YgdmFsdWUgPT0gXCJudW1iZXJcIikgcmV0dXJuIHZhbHVlXG5cbiAgICBjb25zdCBlc2NhcGVkVmFsdWUgPSB0aGlzLmVzY2FwZSh2YWx1ZSlcbiAgICBjb25zdCByZXN1bHQgPSBgXCIke2VzY2FwZWRWYWx1ZX1cImBcblxuICAgIHJldHVybiByZXN1bHRcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHF1b3RlIGNvbHVtbi5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGNvbHVtbk5hbWUgLSBDb2x1bW4gbmFtZS5cbiAgICogQHJldHVybnMge3N0cmluZ30gLSBUaGUgcXVvdGUgY29sdW1uLlxuICAgKi9cbiAgcXVvdGVDb2x1bW4oY29sdW1uTmFtZSkge1xuICAgIHJldHVybiB0aGlzLm9wdGlvbnMoKS5xdW90ZUNvbHVtbk5hbWUoY29sdW1uTmFtZSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHF1b3RlIGluZGV4LlxuICAgKiBAcGFyYW0ge3N0cmluZ30gY29sdW1uTmFtZSAtIENvbHVtbiBuYW1lLlxuICAgKiBAcmV0dXJucyB7c3RyaW5nfSAtIFRoZSBxdW90ZSBpbmRleC5cbiAgICovXG4gIHF1b3RlSW5kZXgoY29sdW1uTmFtZSkge1xuICAgIHJldHVybiB0aGlzLm9wdGlvbnMoKS5xdW90ZUluZGV4TmFtZShjb2x1bW5OYW1lKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgcXVvdGUgdGFibGUuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSB0YWJsZU5hbWUgLSBUYWJsZSBuYW1lLlxuICAgKiBAcmV0dXJucyB7c3RyaW5nfSAtIFRoZSBxdW90ZSB0YWJsZS5cbiAgICovXG4gIHF1b3RlVGFibGUodGFibGVOYW1lKSB7XG4gICAgcmV0dXJuIHRoaXMub3B0aW9ucygpLnF1b3RlVGFibGVOYW1lKHRhYmxlTmFtZSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIG5ldyBxdWVyeS5cbiAgICogQHJldHVybnMge1F1ZXJ5fSAtIFRoZSBuZXcgcXVlcnkuXG4gICAqL1xuICBuZXdRdWVyeSgpIHtcbiAgICBjb25zdCBoYW5kbGVyID0gbmV3IEhhbmRsZXIoKVxuXG4gICAgcmV0dXJuIG5ldyBRdWVyeSh7XG4gICAgICBkcml2ZXI6IHRoaXMsXG4gICAgICBoYW5kbGVyXG4gICAgfSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHNlbGVjdC5cbiAgICogQHBhcmFtIHtzdHJpbmd9IHRhYmxlTmFtZSAtIFRhYmxlIG5hbWUuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPFF1ZXJ5UmVzdWx0VHlwZT59IC0gUmVzb2x2ZXMgd2l0aCB0aGUgc2VsZWN0LlxuICAgKi9cbiAgYXN5bmMgc2VsZWN0KHRhYmxlTmFtZSkge1xuICAgIGNvbnN0IHF1ZXJ5ID0gdGhpcy5uZXdRdWVyeSgpXG5cbiAgICBjb25zdCBzcWwgPSBxdWVyeVxuICAgICAgLmZyb20odGFibGVOYW1lKVxuICAgICAgLnRvU3FsKClcblxuICAgIHJldHVybiBhd2FpdCB0aGlzLnF1ZXJ5KHNxbClcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHNldCBpZCBzZXEuXG4gICAqIEBwYXJhbSB7bnVtYmVyIHwgdW5kZWZpbmVkfSBuZXdJZFNlcSAtIE5ldyBpZCBzZXEuXG4gICAqIEByZXR1cm5zIHt2b2lkfSAtIE5vIHJldHVybiB2YWx1ZS5cbiAgICovXG4gIHNldElkU2VxKG5ld0lkU2VxKSB7XG4gICAgdGhpcy5pZFNlcSA9IG5ld0lkU2VxXG4gIH1cblxuICAvKipcbiAgICogUnVucyBzaG91bGQgc2V0IGF1dG8gaW5jcmVtZW50IHdoZW4gcHJpbWFyeSBrZXkuXG4gICAqIEBhYnN0cmFjdFxuICAgKiBAcmV0dXJucyB7Ym9vbGVhbn0gLSBXaGV0aGVyIHNldCBhdXRvIGluY3JlbWVudCB3aGVuIHByaW1hcnkga2V5LlxuICAgKi9cbiAgc2hvdWxkU2V0QXV0b0luY3JlbWVudFdoZW5QcmltYXJ5S2V5KCkge1xuICAgIHRocm93IG5ldyBFcnJvcihgJ3Nob3VsZFNldEF1dG9JbmNyZW1lbnRXaGVuUHJpbWFyeUtleScgbm90IGltcGxlbWVudGVkYClcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHN1cHBvcnRzIGRlZmF1bHQgcHJpbWFyeSBrZXkgdXVpZC5cbiAgICogQHJldHVybnMge2Jvb2xlYW59IC0gV2hldGhlciBzdXBwb3J0cyBkZWZhdWx0IHByaW1hcnkga2V5IHV1aWQuXG4gICAqL1xuICBzdXBwb3J0c0RlZmF1bHRQcmltYXJ5S2V5VVVJRCgpIHsgcmV0dXJuIGZhbHNlIH1cblxuICAvKipcbiAgICogRXhlY3V0ZXMgYW4gaW5zZXJ0IHRoYXQgY2FycmllcyBhbiBleHBsaWNpdCBwcmltYXJ5LWtleSB2YWx1ZVxuICAgKiAoY2xpZW50LWdlbmVyYXRlZCBvZmZsaW5lLXN5bmMgaWRzKS4gRHJpdmVycyB3aG9zZSBhdXRvLWluY3JlbWVudCBjb2x1bW5zXG4gICAqIHJlamVjdCBleHBsaWNpdCB2YWx1ZXMgKE1TU1FMIElERU5USVRZKSBvdmVycmlkZSB0aGlzIHRvIHJ1biB0aGUgaW5zZXJ0XG4gICAqIHdpdGggaWRlbnRpdHkgaW5zZXJ0IGVuYWJsZWQgaW4gYSBzaW5nbGUgcmVxdWVzdC5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBPcHRpb25zIG9iamVjdC5cbiAgICogQHBhcmFtIHtRdWVyeU9wdGlvbnN9IGFyZ3Mub3B0aW9ucyAtIFF1ZXJ5IG9wdGlvbnMgZm9yIHRoZSBzdGFuZGFyZCBxdWVyeSBwYXRoLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gYXJncy5zcWwgLSBHZW5lcmF0ZWQgaW5zZXJ0IFNRTC5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGFyZ3MudGFibGVOYW1lIC0gVGFibGUgYmVpbmcgaW5zZXJ0ZWQgaW50by5cbiAgICogQHJldHVybnMge1Byb21pc2U8UXVlcnlSZXN1bHRUeXBlPn0gLSBJbnNlcnQgcmVzdWx0LlxuICAgKi9cbiAgYXN5bmMgaW5zZXJ0V2l0aEV4cGxpY2l0UHJpbWFyeUtleSh7b3B0aW9ucywgc3FsLCB0YWJsZU5hbWV9KSB7XG4gICAgdm9pZCB0YWJsZU5hbWVcblxuICAgIHJldHVybiBhd2FpdCB0aGlzLnF1ZXJ5KHNxbCwgb3B0aW9ucylcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHN1cHBvcnRzIGluc2VydCBpbnRvIHJldHVybmluZy5cbiAgICogQGFic3RyYWN0XG4gICAqIEByZXR1cm5zIHtib29sZWFufSAtIFdoZXRoZXIgc3VwcG9ydHMgaW5zZXJ0IGludG8gcmV0dXJuaW5nLlxuICAgKi9cbiAgc3VwcG9ydHNJbnNlcnRJbnRvUmV0dXJuaW5nKCkgeyByZXR1cm4gZmFsc2UgfVxuXG4gIC8qKlxuICAgKiBXaGV0aGVyIGEgc2luZ2xlIGNvbm5lY3Rpb24gY2FuIHJlZmVyZW5jZSB0YWJsZXMgaW4gYW5vdGhlciBkYXRhYmFzZSBvbiB0aGUgc2FtZSBzZXJ2ZXIgdmlhIGFcbiAgICogdHdvLXBhcnQgYGRhdGFiYXNlYC5gdGFibGVgIGlkZW50aWZpZXIuIFdoZW4gdHJ1ZSwgYSBxdWVyeSBzcGFubmluZyBzZXZlcmFsIGRhdGFiYXNlcyBvbiB0aGlzXG4gICAqIHNlcnZlciBjYW4gYmUgZXhwcmVzc2VkIGFzIG9uZSBzdGF0ZW1lbnQgKGEgY3Jvc3MtdGVuYW50IGBVTklPTiBBTExgKTsgd2hlbiBmYWxzZSwgZWFjaCBkYXRhYmFzZVxuICAgKiBpcyBxdWVyaWVkIG9uIGl0cyBvd24gY29ubmVjdGlvbiBhbmQgdGhlIHJlc3VsdHMgbWVyZ2VkIGluIHRoZSBjYWxsZXIuIE9ubHkgTXlTUUwvTWFyaWFEQiByZXR1cm5cbiAgICogdHJ1ZTogUG9zdGdyZVNRTCAob25lIGRhdGFiYXNlIHBlciBjb25uZWN0aW9uKSBhbmQgU1FMaXRlIChvbmUgYXR0YWNoZWQgZmlsZSBwZXIgY29ubmVjdGlvbilcbiAgICogY2Fubm90LCBhbmQgTVNTUUwgaXMgZXhjbHVkZWQgYmVjYXVzZSBpdCByZWFkcyBhIHR3by1wYXJ0IG5hbWUgYXMgYHNjaGVtYS50YWJsZWAgKGNyb3NzLWRhdGFiYXNlXG4gICAqIGFjY2VzcyBuZWVkcyBhIHRocmVlLXBhcnQgYGRhdGFiYXNlLnNjaGVtYS50YWJsZWApLCBzbyBpdCBzdGF5cyBvbiB0aGUgYWx3YXlzLWNvcnJlY3QgZmFuLW91dFxuICAgKiBwYXRoLiBDb25zdW1lZCBieSBgVGVuYW50LmFnZ3JlZ2F0ZUFjcm9zc2AuXG4gICAqIEByZXR1cm5zIHtib29sZWFufSAtIFdoZXRoZXIgdHdvLXBhcnQgY3Jvc3MtZGF0YWJhc2UgcmVmZXJlbmNlcyBhcmUgc3VwcG9ydGVkLlxuICAgKi9cbiAgc3VwcG9ydHNDcm9zc0RhdGFiYXNlUmVmZXJlbmNlcygpIHsgcmV0dXJuIGZhbHNlIH1cblxuICAvKipcbiAgICogUnVucyB0YWJsZSBleGlzdHMuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSB0YWJsZU5hbWUgLSBUYWJsZSBuYW1lLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxib29sZWFuPn0gLSBSZXNvbHZlcyB3aXRoIFdoZXRoZXIgdGFibGUgZXhpc3RzLlxuICAgKi9cbiAgYXN5bmMgdGFibGVFeGlzdHModGFibGVOYW1lKSB7XG4gICAgY29uc3QgdGFibGVzID0gYXdhaXQgdGhpcy5nZXRUYWJsZXMoKVxuICAgIGNvbnN0IHRhYmxlID0gdGFibGVzLmZpbmQoKHRhYmxlKSA9PiB0YWJsZS5nZXROYW1lKCkgPT0gdGFibGVOYW1lKVxuXG4gICAgaWYgKHRhYmxlKSByZXR1cm4gdHJ1ZVxuXG4gICAgcmV0dXJuIGZhbHNlXG4gIH1cblxuICAvKipcbiAgICogUnVucyBhIGNhbGxiYWNrIGluc2lkZSBhIGRhdGFiYXNlIHRyYW5zYWN0aW9uIChvciBhIHNhdmVwb2ludCB3aGVuIGFscmVhZHkgaW5zaWRlIG9uZSkuXG4gICAqIFRoZSBvdXRlcm1vc3QgdHJhbnNhY3Rpb24gcmV0cmllcyB0aGUgd2hvbGUgY2FsbGJhY2sgb24gYSBkZWFkbG9jayAvIGxvY2std2FpdC10aW1lb3V0LFxuICAgKiBiZWNhdXNlIHN1Y2ggZXJyb3JzIHJvbGwgdGhlIGVudGlyZSB0cmFuc2FjdGlvbiBiYWNrIGFuZCB0aGUgc3RhbmRhcmQgcmVjb3ZlcnkgaXMgdG9cbiAgICogcmVzdGFydCBpdC4gTmVzdGVkIHNhdmVwb2ludHMgbGV0IHRoZSBkZWFkbG9jayBidWJibGUgdXAgdG8gdGhpcyBvdXRlciByZXRyeS5cbiAgICogQHRlbXBsYXRlIFRcbiAgICogQHBhcmFtIHsoKSA9PiBQcm9taXNlPFQ+fSBjYWxsYmFjayAtIENhbGxiYWNrIGZ1bmN0aW9uLlxuICAgKiBAcGFyYW0ge1BpY2s8UXVlcnlPcHRpb25zLCBcIm9wZXJhdGlvbk93bmVyXCI+fSBbb3B0aW9uc10gLSBUcmFuc2FjdGlvbiBvd25lcnNoaXAuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPFQ+fSAtIFJlc29sdmVzIHdpdGggdGhlIHRyYW5zYWN0aW9uIHJlc3VsdC5cbiAgICovXG4gIGFzeW5jIHRyYW5zYWN0aW9uKGNhbGxiYWNrLCBvcHRpb25zID0ge30pIHtcbiAgICBhd2FpdCB0aGlzLl93YWl0Rm9yT3BlcmF0aW9uTGVhc2Uob3B0aW9ucy5vcGVyYXRpb25Pd25lcilcblxuICAgIHJldHVybiBhd2FpdCBjb29yZGluYXRlU2hhcmVkVHJhbnNhY3Rpb25Db25uZWN0aW9uKHRoaXMsIGFzeW5jICgpID0+IHtcbiAgICAgIGlmICh0aGlzLl90cmFuc2FjdGlvbnNDb3VudCA+IDApIHtcbiAgICAgICAgcmV0dXJuIGF3YWl0IHRoaXMuX3J1blRyYW5zYWN0aW9uQXR0ZW1wdChjYWxsYmFjaywgb3B0aW9ucylcbiAgICAgIH1cblxuICAgICAgY29uc3QgYXJncyA9IHRoaXMuZ2V0QXJncygpXG4gICAgICBjb25zdCBtYXhBdHRlbXB0cyA9IG9wdGlvbmFsUG9zaXRpdmVJbnRlZ2VyKGFyZ3MuZGVhZGxvY2tNYXhSZXRyaWVzLCBcImRlYWRsb2NrTWF4UmV0cmllc1wiKSA/PyA4XG4gICAgICBjb25zdCBjb25maWd1cmVkQmFzZVdhaXRNcyA9IG9wdGlvbmFsUG9zaXRpdmVJbnRlZ2VyKGFyZ3MuZGVhZGxvY2tCYXNlV2FpdE1zLCBcImRlYWRsb2NrQmFzZVdhaXRNc1wiKVxuICAgICAgY29uc3QgZGVhZGxvY2tNYXhXYWl0TXMgPSBvcHRpb25hbFBvc2l0aXZlSW50ZWdlcihhcmdzLmRlYWRsb2NrTWF4V2FpdE1zLCBcImRlYWRsb2NrTWF4V2FpdE1zXCIpID8/IDEwMDBcbiAgICAgIGxldCBhdHRlbXB0ID0gMFxuXG4gICAgICB3aGlsZSAodHJ1ZSkge1xuICAgICAgICBhdHRlbXB0KytcbiAgICAgICAgY29uc3QgYXR0ZW1wdFN0YXJ0ZWRBdE1zID0gdGhpcy5fbm93TXMoKVxuXG4gICAgICAgIHRyeSB7XG4gICAgICAgICAgcmV0dXJuIGF3YWl0IHRoaXMuX3J1blRyYW5zYWN0aW9uQXR0ZW1wdChjYWxsYmFjaywgb3B0aW9ucylcbiAgICAgICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgICAgICBpZiAoZXJyb3IgaW5zdGFuY2VvZiBWZWxvY2lvdXNEYXRhYmFzZUFmdGVyQ29tbWl0Q2FsbGJhY2tFcnJvcikgdGhyb3cgZXJyb3IuY2FsbGJhY2tFcnJvclxuICAgICAgICAgIGlmICghKGVycm9yIGluc3RhbmNlb2YgRXJyb3IpKSB0aHJvdyBlcnJvclxuXG4gICAgICAgICAgY29uc3QgcmV0cnlJbmZvID0gdGhpcy5yZXRyeWFibGVEYXRhYmFzZUVycm9yKGVycm9yKVxuICAgICAgICAgIGNvbnN0IHdpbGxSZXRyeSA9IEJvb2xlYW4ocmV0cnlJbmZvLmRlYWRsb2NrICYmIGF0dGVtcHQgPCBtYXhBdHRlbXB0cyAmJiB0aGlzLl90cmFuc2FjdGlvbnNDb3VudCA9PSAwKVxuXG4gICAgICAgICAgaWYgKHdpbGxSZXRyeSkge1xuICAgICAgICAgICAgdGhpcy5fcmVwb3J0RGVhZGxvY2tSZXRyeURpYWdub3N0aWMoe1xuICAgICAgICAgICAgICBhdHRlbXB0LFxuICAgICAgICAgICAgICBjb250ZW50aW9uS2luZDogcmV0cnlJbmZvLmNvbnRlbnRpb25LaW5kIHx8IFwiZGVhZGxvY2tcIixcbiAgICAgICAgICAgICAgZXJyb3IsXG4gICAgICAgICAgICAgIG1heEF0dGVtcHRzLFxuICAgICAgICAgICAgICB0cmFuc2FjdGlvbkF0dGVtcHREdXJhdGlvbk1zOiBNYXRoLm1heCgwLCB0aGlzLl9ub3dNcygpIC0gYXR0ZW1wdFN0YXJ0ZWRBdE1zKSxcbiAgICAgICAgICAgICAgd2lsbFJldHJ5XG4gICAgICAgICAgICB9KVxuXG4gICAgICAgICAgICAvLyBBbiBleHBsaWNpdGx5LWNvbmZpZ3VyZWQgYmFzZSB3aW5zIHNvIHRoZSB0dW5pbmcga25vYiBpcyBlZmZlY3RpdmUgZXZlbiBvbiBkcml2ZXJzXG4gICAgICAgICAgICAvLyB3aG9zZSBjbGFzc2lmaWVyIHN1cHBsaWVzIGl0cyBvd24gYHdhaXRNc2AgKE15U1FML01hcmlhREIgcmV0dXJuIGEgZml4ZWQgNTBtcyBmb3JcbiAgICAgICAgICAgIC8vIGRlYWRsb2Nrcyk7IG90aGVyd2lzZSBob25vciB0aGF0IGNsYXNzaWZpZXIgaGludCwgdGhlbiBmYWxsIGJhY2sgdG8gNTBtcy5cbiAgICAgICAgICAgIGNvbnN0IGJhc2VXYWl0TXMgPSBjb25maWd1cmVkQmFzZVdhaXRNcyA/PyAodHlwZW9mIHJldHJ5SW5mby53YWl0TXMgPT0gXCJudW1iZXJcIiAmJiByZXRyeUluZm8ud2FpdE1zID4gMCA/IHJldHJ5SW5mby53YWl0TXMgOiA1MClcblxuICAgICAgICAgICAgLy8gRnVsbC1qaXR0ZXIgZXhwb25lbnRpYWwgYmFja29mZjogd2FpdCBhIHVuaWZvcm0tcmFuZG9tIGR1cmF0aW9uIGluXG4gICAgICAgICAgICAvLyBbMCwgbWluKGJhc2UgKiAyXihhdHRlbXB0LTEpLCBjYXApXS4gVGhlIGRvdWJsaW5nIGNlaWxpbmcgc3ByZWFkcyByZXRyaWVzIG91dCBhc1xuICAgICAgICAgICAgLy8gY29udGVudGlvbiBwZXJzaXN0cywgYW5kIHRoZSBqaXR0ZXIgZGUtY29ycmVsYXRlcyB0cmFuc2FjdGlvbnMgdGhhdCBkZWFkbG9ja2VkIGluXG4gICAgICAgICAgICAvLyBsb2Nrc3RlcCBzbyB0aGV5IHN0b3AgcmUtY29sbGlkaW5nIG9uIHRoZSBzYW1lIHdhaXQgKHRoZSBsaW5lYXIgYGJhc2UgKiBhdHRlbXB0YFxuICAgICAgICAgICAgLy8gdGhpcyByZXBsYWNlcyBoYWQgZXZlcnkgdmljdGltIHJldHJ5IGFmdGVyIGFuIGlkZW50aWNhbCBkZWxheSkuIGBhdHRlbXB0YCBpc1xuICAgICAgICAgICAgLy8gMS1iYXNlZCBoZXJlLCBzbyAyXihhdHRlbXB0LTEpIGlzIDEsIDIsIDQsIC4uLiBUaGUgY2FwIGtlZXBzIHRoZSB0YWlsIHN1Yi1zZWNvbmQuXG4gICAgICAgICAgICBjb25zdCBjZWlsaW5nV2FpdE1zID0gTWF0aC5taW4oYmFzZVdhaXRNcyAqICgyICoqIChhdHRlbXB0IC0gMSkpLCBkZWFkbG9ja01heFdhaXRNcylcbiAgICAgICAgICAgIGNvbnN0IGppdHRlcmVkV2FpdE1zID0gTWF0aC5mbG9vcihNYXRoLnJhbmRvbSgpICogKGNlaWxpbmdXYWl0TXMgKyAxKSlcblxuICAgICAgICAgICAgY29uc3QgbG9nZ2VkQ29udGVudGlvbktpbmQgPSByZXRyeUluZm8uY29udGVudGlvbktpbmQgfHwgXCJ0cmFuc2FjdGlvbiBjb250ZW50aW9uXCJcblxuICAgICAgICAgICAgdGhpcy5sb2dnZXIud2FybihgUmV0cnlpbmcgdHJhbnNhY3Rpb24gYWZ0ZXIgJHtsb2dnZWRDb250ZW50aW9uS2luZH0gKGF0dGVtcHQgJHthdHRlbXB0fS8ke21heEF0dGVtcHRzfSlgKVxuICAgICAgICAgICAgYXdhaXQgdGhpcy5fd2FpdE1zKGppdHRlcmVkV2FpdE1zKVxuICAgICAgICAgICAgY29udGludWVcbiAgICAgICAgICB9XG5cbiAgICAgICAgICB0aHJvdyBlcnJvclxuICAgICAgICB9XG4gICAgICB9XG4gICAgfSwgb3B0aW9ucy5vcGVyYXRpb25Pd25lcilcbiAgfVxuXG4gIC8qKlxuICAgKiBXYWl0cyBgbXNgIG1pbGxpc2Vjb25kcy4gSXNvbGF0ZWQgaW4gaXRzIG93biBtZXRob2Qgc28gdGVzdHMgY2FuIG9ic2VydmUgKGFuZCBza2lwKSB0aGVcbiAgICogZGVhZGxvY2stcmV0cnkgYmFja29mZiB3aXRob3V0IGEgcmVhbCB0aW1lci5cbiAgICogQHBhcmFtIHtudW1iZXJ9IG1zIC0gTWlsbGlzZWNvbmRzIHRvIHdhaXQuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIGFmdGVyIHRoZSBkZWxheS5cbiAgICovXG4gIGFzeW5jIF93YWl0TXMobXMpIHtcbiAgICBhd2FpdCB3YWl0KG1zKVxuICB9XG5cbiAgLyoqXG4gICAqIFJldHVybnMgdGhlIGNsb2NrIHVzZWQgZm9yIHRyYW5zYWN0aW9uLWF0dGVtcHQgZGlhZ25vc3RpY3MuXG4gICAqIEByZXR1cm5zIHtudW1iZXJ9IC0gTW9ub3RvbmljIG1pbGxpc2Vjb25kcyB3aGVyZSBhdmFpbGFibGUuXG4gICAqL1xuICBfbm93TXMoKSB7XG4gICAgcmV0dXJuIG5vd01zKClcbiAgfVxuXG4gIC8qKlxuICAgKiBTdGFydHMgYmVzdC1lZmZvcnQgZGVhZGxvY2sgZGlhZ25vc3RpY3Mgd2l0aG91dCBqb2luaW5nIHRoZSByZXRyeSBjb250cm9sIGZsb3cuIFN1YmNsYXNzZXMgbWF5XG4gICAqIGFkZCBib3VuZGVkIGRyaXZlci1zcGVjaWZpYyBjb250ZXh0OyBjYXB0dXJlIGFuZCBldmVudC1saXN0ZW5lciBmYWlsdXJlcyBjYW5ub3QgYWZmZWN0IHJldHJ5LlxuICAgKiBAcGFyYW0ge3thdHRlbXB0OiBudW1iZXIsIGNvbnRlbnRpb25LaW5kOiBcImRlYWRsb2NrXCIgfCBcImxvY2std2FpdC10aW1lb3V0XCIsIGVycm9yOiBFcnJvciwgbWF4QXR0ZW1wdHM6IG51bWJlciwgdHJhbnNhY3Rpb25BdHRlbXB0RHVyYXRpb25NczogbnVtYmVyLCB3aWxsUmV0cnk6IGJvb2xlYW59fSBhcmdzIC0gUmV0cnkgbWV0YWRhdGEuXG4gICAqIEByZXR1cm5zIHt2b2lkfVxuICAgKi9cbiAgX3JlcG9ydERlYWRsb2NrUmV0cnlEaWFnbm9zdGljKHthdHRlbXB0LCBjb250ZW50aW9uS2luZCwgZXJyb3IsIG1heEF0dGVtcHRzLCB0cmFuc2FjdGlvbkF0dGVtcHREdXJhdGlvbk1zLCB3aWxsUmV0cnl9KSB7XG4gICAgbGV0IHNuYXBzaG90XG5cbiAgICB0cnkge1xuICAgICAgY29uc3QgcXVlcnlEaWFnbm9zdGljID0gdGhpcy5fZmFpbGVkUXVlcnlEaWFnbm9zdGljcy5nZXQoZXJyb3IpXG5cbiAgICAgIHNuYXBzaG90ID0gT2JqZWN0LmZyZWV6ZSh7XG4gICAgICAgIGF0dGVtcHQsXG4gICAgICAgIGNvbnRlbnRpb25LaW5kLFxuICAgICAgICBkcml2ZXJUeXBlOiB0aGlzLmdldFR5cGUoKSxcbiAgICAgICAgbWF4QXR0ZW1wdHMsXG4gICAgICAgIHN0YWdlOiBcImRhdGFiYXNlLWRlYWRsb2NrLXJldHJ5XCIsXG4gICAgICAgIHRyYW5zYWN0aW9uQXR0ZW1wdER1cmF0aW9uTXMsXG4gICAgICAgIHdpbGxSZXRyeSxcbiAgICAgICAgLi4udGhpcy5fcG9vbERpYWdub3N0aWNJZGVudGl0eUNvbnRleHQoKSxcbiAgICAgICAgLi4udGhpcy5fb3BlcmF0aW9uRGlhZ25vc3RpY0NvbnRleHQoKSxcbiAgICAgICAgLi4ucXVlcnlEaWFnbm9zdGljXG4gICAgICB9KVxuICAgIH0gY2F0Y2ggKGRpYWdub3N0aWNFcnJvcikge1xuICAgICAgdGhpcy5fcmVwb3J0RGVhZGxvY2tEaWFnbm9zdGljUGlwZWxpbmVGYWlsdXJlKGRpYWdub3N0aWNFcnJvcilcbiAgICAgIHJldHVyblxuICAgIH1cblxuICAgIGxldCBkcml2ZXJDb250ZXh0UmVzdWx0XG5cbiAgICB0cnkge1xuICAgICAgZHJpdmVyQ29udGV4dFJlc3VsdCA9IHRoaXMuX2RlYWRsb2NrRGlhZ25vc3RpY0NvbnRleHQoc25hcHNob3QpXG4gICAgfSBjYXRjaCAoZGlhZ25vc3RpY0Vycm9yKSB7XG4gICAgICB0aGlzLl9yZXBvcnREZWFkbG9ja0RpYWdub3N0aWNQaXBlbGluZUZhaWx1cmUoZGlhZ25vc3RpY0Vycm9yKVxuICAgICAgcmV0dXJuXG4gICAgfVxuXG4gICAgY29uc3QgaGFzUHJvbWlzZUNvbnRyYWN0ID0gZHJpdmVyQ29udGV4dFJlc3VsdCBpbnN0YW5jZW9mIFByb21pc2VcblxuICAgIHZvaWQgUHJvbWlzZS5yZXNvbHZlKGRyaXZlckNvbnRleHRSZXN1bHQpXG4gICAgICAudGhlbigoZHJpdmVyQ29udGV4dCkgPT4ge1xuICAgICAgICBpZiAoIWhhc1Byb21pc2VDb250cmFjdCkgdGhyb3cgbmV3IEVycm9yKFwiRGF0YWJhc2UgZGVhZGxvY2sgZGlhZ25vc3RpYyBjb250ZXh0IG11c3QgcmV0dXJuIGEgUHJvbWlzZVwiKVxuXG4gICAgICAgIGNvbnN0IGNvbnRleHQgPSB7XG4gICAgICAgICAgLi4uc25hcHNob3QsXG4gICAgICAgICAgLi4uZHJpdmVyQ29udGV4dFxuICAgICAgICB9XG4gICAgICAgIGNvbnN0IHBheWxvYWQgPSB7XG4gICAgICAgICAgY29udGV4dCxcbiAgICAgICAgICBlcnJvcjogbmV3IEVycm9yKHdpbGxSZXRyeVxuICAgICAgICAgICAgPyBgRGF0YWJhc2UgdHJhbnNhY3Rpb24gJHtjb250ZW50aW9uS2luZH0gd2lsbCBiZSByZXRyaWVkYFxuICAgICAgICAgICAgOiBgRGF0YWJhc2UgdHJhbnNhY3Rpb24gJHtjb250ZW50aW9uS2luZH0gZXhoYXVzdGVkIGl0cyByZXRyeSBidWRnZXRgKVxuICAgICAgICB9XG4gICAgICAgIGNvbnN0IGVycm9yRXZlbnRzID0gdGhpcy5jb25maWd1cmF0aW9uLmdldEVycm9yRXZlbnRzKClcblxuICAgICAgICB0cnkge1xuICAgICAgICAgIGVycm9yRXZlbnRzLmVtaXQoXCJkYXRhYmFzZS1kZWFkbG9jay1yZXRyeVwiLCBwYXlsb2FkKVxuICAgICAgICB9IGNhdGNoIChldmVudEVycm9yKSB7XG4gICAgICAgICAgdGhpcy5sb2dnZXIud2FybihcIkRhdGFiYXNlIGRlYWRsb2NrIHJldHJ5IGRpYWdub3N0aWMgbGlzdGVuZXIgZmFpbGVkXCIsIHtlcnJvcjogZXZlbnRFcnJvcn0pXG4gICAgICAgIH1cblxuICAgICAgICB0cnkge1xuICAgICAgICAgIGVycm9yRXZlbnRzLmVtaXQoXCJhbGwtZXJyb3JcIiwgey4uLnBheWxvYWQsIGVycm9yVHlwZTogXCJkYXRhYmFzZS1kZWFkbG9jay1yZXRyeVwifSlcbiAgICAgICAgfSBjYXRjaCAoZXZlbnRFcnJvcikge1xuICAgICAgICAgIHRoaXMubG9nZ2VyLndhcm4oXCJEYXRhYmFzZSBkZWFkbG9jayByZXRyeSBhbGwtZXJyb3IgbGlzdGVuZXIgZmFpbGVkXCIsIHtlcnJvcjogZXZlbnRFcnJvcn0pXG4gICAgICAgIH1cbiAgICAgIH0pXG4gICAgICAuY2F0Y2goKGRpYWdub3N0aWNFcnJvcikgPT4gdGhpcy5fcmVwb3J0RGVhZGxvY2tEaWFnbm9zdGljUGlwZWxpbmVGYWlsdXJlKGRpYWdub3N0aWNFcnJvcikpXG4gIH1cblxuICAvKipcbiAgICogUmV0dXJucyBwb29sIGlkZW50aXR5IG9ubHkgd2hlbiB0aGlzIGRyaXZlciB3YXMgc3RhbXBlZCBieSBhIHBvb2wuXG4gICAqIEByZXR1cm5zIHt7ZGF0YWJhc2VJZGVudGlmaWVyPzogc3RyaW5nLCBkYXRhYmFzZUlkZW50aWZpZXJGaW5nZXJwcmludD86IHN0cmluZywgZGF0YWJhc2VJZGVudGl0eUZpbmdlcnByaW50Pzogc3RyaW5nfX0gLSBTYWZlIHBvb2wgaWRlbnRpdHkuXG4gICAqL1xuICBfcG9vbERpYWdub3N0aWNJZGVudGl0eUNvbnRleHQoKSB7XG4gICAgaWYgKHRoaXMuX2RhdGFiYXNlSWRlbnRpZmllciA9PT0gdW5kZWZpbmVkIHx8ICF0aGlzLl9kYXRhYmFzZUlkZW50aXR5RmluZ2VycHJpbnQpIHJldHVybiB7fVxuXG4gICAgY29uc3QgaWRlbnRpZmllckZpbmdlcnByaW50SW5wdXQgPSB0eXBlb2YgdGhpcy5fZGF0YWJhc2VJZGVudGlmaWVyID09PSBcInN0cmluZ1wiXG4gICAgICA/IHRoaXMuX2RhdGFiYXNlSWRlbnRpZmllclxuICAgICAgOiBgaW52YWxpZDoke3R5cGVvZiB0aGlzLl9kYXRhYmFzZUlkZW50aWZpZXJ9YFxuICAgIGNvbnN0IGRhdGFiYXNlSWRlbnRpZmllckZpbmdlcnByaW50ID0gYHNoYTI1Njoke3NoYTI1NkhleChgZGF0YWJhc2UtbG9naWNhbC1pZGVudGlmaWVyOnYxXFwwJHtpZGVudGlmaWVyRmluZ2VycHJpbnRJbnB1dH1gKX1gXG5cbiAgICByZXR1cm4ge1xuICAgICAgZGF0YWJhc2VJZGVudGlmaWVyOiBSRURBQ1RFRF9ESUFHTk9TVElDX0xBQkVMLFxuICAgICAgZGF0YWJhc2VJZGVudGlmaWVyRmluZ2VycHJpbnQsXG4gICAgICBkYXRhYmFzZUlkZW50aXR5RmluZ2VycHJpbnQ6IHRoaXMuX2RhdGFiYXNlSWRlbnRpdHlGaW5nZXJwcmludFxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBCdWlsZHMgdGhlIGJvdW5kZWQgb3BlcmF0aW9uIHBvcnRpb24gb2YgYW4gaW1tdXRhYmxlIHJldHJ5IHNuYXBzaG90LlxuICAgKiBAcmV0dXJucyB7e29wZXJhdGlvbk5hbWU/OiBzdHJpbmcsIG9wZXJhdGlvbk5hbWVGaW5nZXJwcmludD86IHN0cmluZ319IC0gU2FmZSBvcGVyYXRpb24gZmllbGRzLlxuICAgKi9cbiAgX29wZXJhdGlvbkRpYWdub3N0aWNDb250ZXh0KCkge1xuICAgIGNvbnN0IHJhd09wZXJhdGlvbk5hbWUgPSB0aGlzLl9jb25uZWN0aW9uQ2hlY2tvdXROYW1lXG5cbiAgICBpZiAocmF3T3BlcmF0aW9uTmFtZSA9PT0gdW5kZWZpbmVkKSByZXR1cm4ge31cbiAgICBpZiAodHlwZW9mIHJhd09wZXJhdGlvbk5hbWUgIT09IFwic3RyaW5nXCIpIHtcbiAgICAgIHJldHVybiB7XG4gICAgICAgIG9wZXJhdGlvbk5hbWU6IFJFREFDVEVEX0RJQUdOT1NUSUNfTEFCRUwsXG4gICAgICAgIG9wZXJhdGlvbk5hbWVGaW5nZXJwcmludDogYHNoYTI1Njoke3NoYTI1NkhleChgZGF0YWJhc2Utb3BlcmF0aW9uOnYxXFwwaW52YWxpZDoke3R5cGVvZiByYXdPcGVyYXRpb25OYW1lfWApfWBcbiAgICAgIH1cbiAgICB9XG5cbiAgICBjb25zdCBzY2FubmVkT3BlcmF0aW9uTmFtZSA9IHJhd09wZXJhdGlvbk5hbWUuc2xpY2UoMCwgT1BFUkFUSU9OX05BTUVfU0NBTl9MSU1JVClcbiAgICBjb25zdCBvcGVyYXRpb25OYW1lRmluZ2VycHJpbnQgPSBgc2hhMjU2OiR7c2hhMjU2SGV4KGBkYXRhYmFzZS1vcGVyYXRpb246djFcXDAke3NjYW5uZWRPcGVyYXRpb25OYW1lfVxcMGxlbmd0aDoke3Jhd09wZXJhdGlvbk5hbWUubGVuZ3RofWApfWBcblxuICAgIHJldHVybiB7XG4gICAgICBvcGVyYXRpb25OYW1lOiBSRURBQ1RFRF9ESUFHTk9TVElDX0xBQkVMLFxuICAgICAgb3BlcmF0aW9uTmFtZUZpbmdlcnByaW50XG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIFJlcG9ydHMgYW4gdW5leHBlY3RlZCBkZXRhY2hlZCBkaWFnbm9zdGljcyBmYWlsdXJlIHdpdGhvdXQgY2hhbmdpbmcgdHJhbnNhY3Rpb24gY29udHJvbCBmbG93LlxuICAgKiBAcGFyYW0ge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSBkaWFnbm9zdGljRXJyb3IgLSBEaWFnbm9zdGljcyBmYWlsdXJlLlxuICAgKiBAcmV0dXJucyB7dm9pZH1cbiAgICovXG4gIF9yZXBvcnREZWFkbG9ja0RpYWdub3N0aWNQaXBlbGluZUZhaWx1cmUoZGlhZ25vc3RpY0Vycm9yKSB7XG4gICAgY29uc3Qgbm9ybWFsaXplZEVycm9yID0gZGlhZ25vc3RpY0Vycm9yIGluc3RhbmNlb2YgRXJyb3JcbiAgICAgID8gZGlhZ25vc3RpY0Vycm9yXG4gICAgICA6IG5ldyBFcnJvcihcIkRhdGFiYXNlIGRlYWRsb2NrIHJldHJ5IGRpYWdub3N0aWMgZmFpbGVkXCIsIHtjYXVzZTogZGlhZ25vc3RpY0Vycm9yfSlcbiAgICBjb25zdCBwYXlsb2FkID0ge1xuICAgICAgY29udGV4dDoge3N0YWdlOiBcImRhdGFiYXNlLWRlYWRsb2NrLXJldHJ5LWRpYWdub3N0aWNcIn0sXG4gICAgICBlcnJvcjogbm9ybWFsaXplZEVycm9yXG4gICAgfVxuICAgIGxldCBlcnJvckV2ZW50c1xuXG4gICAgdHJ5IHtcbiAgICAgIGVycm9yRXZlbnRzID0gdGhpcy5jb25maWd1cmF0aW9uLmdldEVycm9yRXZlbnRzKClcbiAgICB9IGNhdGNoIChyZXBvcnRpbmdFcnJvcikge1xuICAgICAgdGhpcy5sb2dnZXIud2FybihcIkRhdGFiYXNlIGRlYWRsb2NrIHJldHJ5IGRpYWdub3N0aWMgcGlwZWxpbmUgcmVwb3J0aW5nIGZhaWxlZFwiLCB7ZXJyb3I6IG5vcm1hbGl6ZWRFcnJvciwgcmVwb3J0aW5nRXJyb3J9KVxuICAgICAgcmV0dXJuXG4gICAgfVxuXG4gICAgdHJ5IHtcbiAgICAgIGVycm9yRXZlbnRzLmVtaXQoXCJmcmFtZXdvcmstZXJyb3JcIiwgcGF5bG9hZClcbiAgICB9IGNhdGNoIChyZXBvcnRpbmdFcnJvcikge1xuICAgICAgdGhpcy5sb2dnZXIud2FybihcIkRhdGFiYXNlIGRlYWRsb2NrIHJldHJ5IGZyYW1ld29yay1lcnJvciBsaXN0ZW5lciBmYWlsZWRcIiwge2Vycm9yOiBub3JtYWxpemVkRXJyb3IsIHJlcG9ydGluZ0Vycm9yfSlcbiAgICB9XG5cbiAgICB0cnkge1xuICAgICAgZXJyb3JFdmVudHMuZW1pdChcImFsbC1lcnJvclwiLCB7Li4ucGF5bG9hZCwgZXJyb3JUeXBlOiBcImZyYW1ld29yay1lcnJvclwifSlcbiAgICB9IGNhdGNoIChyZXBvcnRpbmdFcnJvcikge1xuICAgICAgdGhpcy5sb2dnZXIud2FybihcIkRhdGFiYXNlIGRlYWRsb2NrIHJldHJ5IGFsbC1lcnJvciBsaXN0ZW5lciBmYWlsZWRcIiwge2Vycm9yOiBub3JtYWxpemVkRXJyb3IsIHJlcG9ydGluZ0Vycm9yfSlcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogQnVpbGRzIGRyaXZlci1zcGVjaWZpYyBkZWFkbG9jayBjb250ZXh0LiBUaGUgYmFzZSBkcml2ZXIgaGFzIG5vIHNlcnZlciBkaWFnbm9zdGljIHNvdXJjZS5cbiAgICogQHBhcmFtIHtEZWFkbG9ja1JldHJ5RGlhZ25vc3RpY1NuYXBzaG90fSBfc25hcHNob3QgLSBJbW11dGFibGUgcmV0cnkgc25hcHNob3QuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPFJlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pj59IC0gU2FmZSBjb250ZXh0IGZpZWxkcy5cbiAgICovXG4gIGFzeW5jIF9kZWFkbG9ja0RpYWdub3N0aWNDb250ZXh0KF9zbmFwc2hvdCkge1xuICAgIHJldHVybiB7fVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgYSBzaW5nbGUgdHJhbnNhY3Rpb24gYXR0ZW1wdDogc3RhcnRzIGEgdHJhbnNhY3Rpb24gKG9yIGEgc2F2ZXBvaW50IHdoZW4gbmVzdGVkKSwgcnVuc1xuICAgKiBgY2FsbGJhY2tgLCBhbmQgY29tbWl0cyDigJQgcm9sbGluZyBiYWNrIG9uIGVycm9yLiB7QGxpbmsgdHJhbnNhY3Rpb259IHdyYXBzIHRoaXMgd2l0aCBkZWFkbG9ja1xuICAgKiByZXRyeSBhdCB0aGUgb3V0ZXJtb3N0IGxldmVsLlxuICAgKiBAdGVtcGxhdGUgVFxuICAgKiBAcGFyYW0geygpID0+IFByb21pc2U8VD59IGNhbGxiYWNrIC0gQ2FsbGJhY2sgZnVuY3Rpb24uXG4gICAqIEBwYXJhbSB7UGljazxRdWVyeU9wdGlvbnMsIFwib3BlcmF0aW9uT3duZXJcIj59IG9wdGlvbnMgLSBUcmFuc2FjdGlvbiBvd25lcnNoaXAuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gLSBSZXNvbHZlcyB3aXRoIHRoZSB0cmFuc2FjdGlvbiByZXN1bHQuXG4gICAqL1xuICBhc3luYyBfcnVuVHJhbnNhY3Rpb25BdHRlbXB0KGNhbGxiYWNrLCBvcHRpb25zKSB7XG4gICAgY29uc3Qgc2F2ZVBvaW50TmFtZSA9IHRoaXMuZ2VuZXJhdGVTYXZlUG9pbnROYW1lKClcbiAgICAvKiogQHR5cGUge1RyYW5zYWN0aW9uQ2FsbGJhY2tGcmFtZX0gKi9cbiAgICBjb25zdCBjYWxsYmFja0ZyYW1lID0ge1xuICAgICAgYWZ0ZXJDb21taXRDYWxsYmFja3M6IFtdLFxuICAgICAgYmVmb3JlQ29tbWl0Q2FsbGJhY2tzOiBbXVxuICAgIH1cbiAgICBsZXQgdHJhbnNhY3Rpb25TdGFydGVkID0gZmFsc2VcbiAgICBsZXQgc2F2ZVBvaW50U3RhcnRlZCA9IGZhbHNlXG5cbiAgICB0aGlzLl90cmFuc2FjdGlvbkNhbGxiYWNrRnJhbWVzLnB1c2goY2FsbGJhY2tGcmFtZSlcblxuICAgIHRyeSB7XG4gICAgICBpZiAodGhpcy5fdHJhbnNhY3Rpb25zQ291bnQgPT0gMCkge1xuICAgICAgICB0aGlzLmxvZ2dlci5kZWJ1ZyhcIlN0YXJ0IHRyYW5zYWN0aW9uXCIpXG4gICAgICAgIGF3YWl0IHRoaXMuc3RhcnRUcmFuc2FjdGlvbihvcHRpb25zKVxuICAgICAgICB0cmFuc2FjdGlvblN0YXJ0ZWQgPSB0cnVlXG4gICAgICB9IGVsc2Uge1xuICAgICAgICB0aGlzLmxvZ2dlci5kZWJ1ZyhcIlN0YXJ0IHNhdmVwb2ludFwiLCBzYXZlUG9pbnROYW1lKVxuICAgICAgICBhd2FpdCB0aGlzLnN0YXJ0U2F2ZVBvaW50KHNhdmVQb2ludE5hbWUsIG9wdGlvbnMpXG4gICAgICAgIHNhdmVQb2ludFN0YXJ0ZWQgPSB0cnVlXG4gICAgICB9XG4gICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgIHRoaXMuX3RyYW5zYWN0aW9uQ2FsbGJhY2tGcmFtZXMucG9wKClcbiAgICAgIHRocm93IGVycm9yXG4gICAgfVxuXG4gICAgbGV0IHJlc3VsdFxuXG4gICAgdHJ5IHtcbiAgICAgIHJlc3VsdCA9IGF3YWl0IGNhbGxiYWNrKClcbiAgICAgIGF3YWl0IHRoaXMuX3J1bkJlZm9yZUNvbW1pdENhbGxiYWNrcyhjYWxsYmFja0ZyYW1lKVxuXG4gICAgICBpZiAoc2F2ZVBvaW50U3RhcnRlZCkge1xuICAgICAgICB0aGlzLmxvZ2dlci5kZWJ1ZyhcIlJlbGVhc2Ugc2F2ZXBvaW50XCIsIHNhdmVQb2ludE5hbWUpXG4gICAgICAgIGF3YWl0IHRoaXMucmVsZWFzZVNhdmVQb2ludChzYXZlUG9pbnROYW1lLCBvcHRpb25zKVxuICAgICAgfVxuXG4gICAgICBpZiAodHJhbnNhY3Rpb25TdGFydGVkKSB7XG4gICAgICAgIHRoaXMubG9nZ2VyLmRlYnVnKFwiQ29tbWl0IHRyYW5zYWN0aW9uXCIpXG4gICAgICAgIGF3YWl0IHRoaXMuY29tbWl0VHJhbnNhY3Rpb24ob3B0aW9ucylcbiAgICAgIH1cbiAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgaWYgKGVycm9yIGluc3RhbmNlb2YgRXJyb3IpIHtcbiAgICAgICAgdGhpcy5sb2dnZXIuZGVidWcoXCJUcmFuc2FjdGlvbiBlcnJvclwiLCBlcnJvci5tZXNzYWdlKVxuICAgICAgfSBlbHNlIHtcbiAgICAgICAgdGhpcy5sb2dnZXIuZGVidWcoXCJUcmFuc2FjdGlvbiBlcnJvclwiLCBlcnJvcilcbiAgICAgIH1cblxuICAgICAgdHJ5IHtcbiAgICAgICAgbGV0IHRyYW5zYWN0aW9uUm9sbGVkQmFjayA9IGZhbHNlXG5cbiAgICAgICAgaWYgKHNhdmVQb2ludFN0YXJ0ZWQpIHtcbiAgICAgICAgICB0aGlzLmxvZ2dlci5kZWJ1ZyhcIlJvbGxiYWNrIHNhdmVwb2ludFwiLCBzYXZlUG9pbnROYW1lKVxuICAgICAgICAgIHRyeSB7XG4gICAgICAgICAgICBhd2FpdCB0aGlzLnJvbGxiYWNrU2F2ZVBvaW50KHNhdmVQb2ludE5hbWUsIG9wdGlvbnMpXG4gICAgICAgICAgfSBjYXRjaCAoc2F2ZVBvaW50RXJyb3IpIHtcbiAgICAgICAgICAgIGNvbnN0IG1lc3NhZ2UgPSBzYXZlUG9pbnRFcnJvciBpbnN0YW5jZW9mIEVycm9yID8gc2F2ZVBvaW50RXJyb3IubWVzc2FnZSA6IGAke3NhdmVQb2ludEVycm9yfWBcblxuICAgICAgICAgICAgLy8gTXlTUUwgc29tZXRpbWVzIGRyb3BzIHNhdmVwb2ludHMgdW5leHBlY3RlZGx5OyBmYWxsIGJhY2sgdG8gcm9sbGluZyBiYWNrIHRoZSBmdWxsIHRyYW5zYWN0aW9uXG4gICAgICAgICAgICBpZiAobWVzc2FnZS5pbmNsdWRlcyhcIlNBVkVQT0lOVFwiKSB8fCBtZXNzYWdlLmluY2x1ZGVzKFwiRVJfU1BfRE9FU19OT1RfRVhJU1RcIikpIHtcbiAgICAgICAgICAgICAgdGhpcy5sb2dnZXIuZGVidWcoXCJTYXZlcG9pbnQgcm9sbGJhY2sgZmFpbGVkOyByb2xsaW5nIGJhY2sgZW50aXJlIHRyYW5zYWN0aW9uIGluc3RlYWRcIilcbiAgICAgICAgICAgICAgYXdhaXQgdGhpcy5yb2xsYmFja1RyYW5zYWN0aW9uKG9wdGlvbnMpXG4gICAgICAgICAgICAgIHRyYW5zYWN0aW9uUm9sbGVkQmFjayA9IHRydWVcbiAgICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICAgIHRocm93IHNhdmVQb2ludEVycm9yXG4gICAgICAgICAgICB9XG4gICAgICAgICAgfVxuICAgICAgICB9XG5cbiAgICAgICAgLy8gT25seSByb2xsIGJhY2sgaWYgYSB0cmFuc2FjdGlvbiBpcyBzdGlsbCBvcGVuLiBBIG5lc3RlZCBzYXZlcG9pbnQgd2hvc2Ugcm9sbGJhY2sgZmFpbGVkXG4gICAgICAgIC8vIGZhbGxzIGJhY2sgdG8gcm9sbGluZyBiYWNrIHRoZSB3aG9sZSB0cmFuc2FjdGlvbiAoYWJvdmUpLCB3aGljaCBhbHJlYWR5IGNsb3NlZCBpdCBhbmRcbiAgICAgICAgLy8gZHJvcHBlZCB0aGUgY291bnQgdG8gMDsgcm9sbGluZyBiYWNrIGFnYWluIGhlcmUgd291bGQgaXNzdWUgYSBzZWNvbmQgUk9MTEJBQ0sgYW5kIGRyaXZlXG4gICAgICAgIC8vIGBfdHJhbnNhY3Rpb25zQ291bnRgIGJlbG93IHplcm8sIHdoaWNoIHdvdWxkIHRoZW4gZGVmZWF0IHRoZSBvdXRlcm1vc3QgZGVhZGxvY2stcmV0cnkgZ3VhcmQuXG4gICAgICAgIGlmICh0cmFuc2FjdGlvblN0YXJ0ZWQgJiYgIXRyYW5zYWN0aW9uUm9sbGVkQmFjayAmJiB0aGlzLl90cmFuc2FjdGlvbnNDb3VudCA+IDApIHtcbiAgICAgICAgICB0aGlzLmxvZ2dlci5kZWJ1ZyhcIlJvbGxiYWNrIHRyYW5zYWN0aW9uXCIpXG4gICAgICAgICAgYXdhaXQgdGhpcy5yb2xsYmFja1RyYW5zYWN0aW9uKG9wdGlvbnMpXG4gICAgICAgIH1cbiAgICAgIH0gZmluYWxseSB7XG4gICAgICAgIHRoaXMuX3RyYW5zYWN0aW9uQ2FsbGJhY2tGcmFtZXMucG9wKClcbiAgICAgIH1cblxuICAgICAgdGhyb3cgZXJyb3JcbiAgICB9XG5cbiAgICB0cnkge1xuICAgICAgYXdhaXQgdGhpcy5fY29tbWl0VHJhbnNhY3Rpb25DYWxsYmFja0ZyYW1lKClcbiAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgdGhyb3cgbmV3IFZlbG9jaW91c0RhdGFiYXNlQWZ0ZXJDb21taXRDYWxsYmFja0Vycm9yKGVycm9yKVxuICAgIH1cblxuICAgIHJldHVybiByZXN1bHRcbiAgfVxuXG4gIC8qKlxuICAgKiBSZWdpc3RlcnMgYSBndWFyZCB0byBydW4gYWZ0ZXIgdGhlIGN1cnJlbnQgdHJhbnNhY3Rpb24gY2FsbGJhY2sgc3VjY2VlZHMgYW5kIGJlZm9yZSBpdHNcbiAgICogb3V0ZXIgY29tbWl0IG9yIG5lc3RlZCBzYXZlcG9pbnQgcmVsZWFzZS5cbiAgICogQHBhcmFtIHsoKSA9PiB2b2lkIHwgUHJvbWlzZTx2b2lkPn0gY2FsbGJhY2sgLSBHdWFyZCBjYWxsYmFjay5cbiAgICogQHBhcmFtIHtQaWNrPFF1ZXJ5T3B0aW9ucywgXCJvcGVyYXRpb25Pd25lclwiPn0gW29wdGlvbnNdIC0gQ2FsbGJhY2sgb3duZXJzaGlwLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyB3aGVuIHRoZSBndWFyZCBoYXMgYmVlbiByZWdpc3RlcmVkLlxuICAgKi9cbiAgYXN5bmMgYmVmb3JlQ29tbWl0KGNhbGxiYWNrLCBvcHRpb25zID0ge30pIHtcbiAgICBhd2FpdCB0aGlzLl93YWl0Rm9yT3BlcmF0aW9uTGVhc2Uob3B0aW9ucy5vcGVyYXRpb25Pd25lcilcblxuICAgIGNvbnN0IGN1cnJlbnRGcmFtZSA9IHRoaXMuX3RyYW5zYWN0aW9uQ2FsbGJhY2tGcmFtZXNbdGhpcy5fdHJhbnNhY3Rpb25DYWxsYmFja0ZyYW1lcy5sZW5ndGggLSAxXVxuXG4gICAgaWYgKCFjdXJyZW50RnJhbWUpIHRocm93IG5ldyBFcnJvcihcImJlZm9yZUNvbW1pdCByZXF1aXJlcyBhbiBhY3RpdmUgdHJhbnNhY3Rpb25cIilcblxuICAgIGN1cnJlbnRGcmFtZS5iZWZvcmVDb21taXRDYWxsYmFja3MucHVzaChjYWxsYmFjaylcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGEgY2FsbGJhY2sgYWZ0ZXIgdGhlIHN1cnJvdW5kaW5nIHRyYW5zYWN0aW9uIGNvbW1pdHMuXG4gICAqIElmIG5vIHRyYW5zYWN0aW9uIGlzIGFjdGl2ZSwgdGhlIGNhbGxiYWNrIHJ1bnMgaW1tZWRpYXRlbHkuXG4gICAqIEBwYXJhbSB7KCkgPT4gdm9pZCB8IFByb21pc2U8dm9pZD59IGNhbGxiYWNrIC0gQ2FsbGJhY2suXG4gICAqIEBwYXJhbSB7UGljazxRdWVyeU9wdGlvbnMsIFwib3BlcmF0aW9uT3duZXJcIj59IFtvcHRpb25zXSAtIENhbGxiYWNrIG93bmVyc2hpcC5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgd2hlbiB0aGUgY2FsbGJhY2sgaGFzIGJlZW4gcmVnaXN0ZXJlZCBvciBydW4uXG4gICAqL1xuICBhc3luYyBhZnRlckNvbW1pdChjYWxsYmFjaywgb3B0aW9ucyA9IHt9KSB7XG4gICAgYXdhaXQgdGhpcy5fd2FpdEZvck9wZXJhdGlvbkxlYXNlKG9wdGlvbnMub3BlcmF0aW9uT3duZXIpXG5cbiAgICBjb25zdCBjdXJyZW50RnJhbWUgPSB0aGlzLl90cmFuc2FjdGlvbkNhbGxiYWNrRnJhbWVzW3RoaXMuX3RyYW5zYWN0aW9uQ2FsbGJhY2tGcmFtZXMubGVuZ3RoIC0gMV1cblxuICAgIGlmICghY3VycmVudEZyYW1lKSB7XG4gICAgICBhd2FpdCBjYWxsYmFjaygpXG4gICAgICByZXR1cm5cbiAgICB9XG5cbiAgICBjdXJyZW50RnJhbWUuYWZ0ZXJDb21taXRDYWxsYmFja3MucHVzaChjYWxsYmFjaylcbiAgfVxuXG4gIC8qKlxuICAgKiBXaGV0aGVyIGEgdHJhbnNhY3Rpb24gaXMgY3VycmVudGx5IG9wZW4gb24gdGhpcyBjb25uZWN0aW9uLlxuICAgKiBAcmV0dXJucyB7Ym9vbGVhbn0gLSBXaGV0aGVyIGluc2lkZSBhIHRyYW5zYWN0aW9uLlxuICAgKi9cbiAgaW5zaWRlVHJhbnNhY3Rpb24oKSB7IHJldHVybiB0aGlzLl90cmFuc2FjdGlvbnNDb3VudCA+IDAgfVxuXG4gIC8qKlxuICAgKiBSZXR1cm5zIHRoZSBjb21wbGV0aW9uIHByb21pc2UgaWRlbnRpZnlpbmcgdGhlIGN1cnJlbnQgb3V0ZXIgdHJhbnNhY3Rpb24uXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSBSZXNvbHZlcyBhZnRlciB0aGF0IHRyYW5zYWN0aW9uIGNvbW1pdHMgb3Igcm9sbHMgYmFjay5cbiAgICovXG4gIHRyYW5zYWN0aW9uQ29tcGxldGlvbigpIHsgcmV0dXJuIHRoaXMuX3RyYW5zYWN0aW9uQ29tcGxldGlvblByb21pc2UgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHN0YXJ0IHRyYW5zYWN0aW9uLlxuICAgKiBAcGFyYW0ge1BpY2s8UXVlcnlPcHRpb25zLCBcIm9wZXJhdGlvbk93bmVyXCI+fSBbb3B0aW9uc10gLSBUcmFuc2FjdGlvbiBvd25lcnNoaXAuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIHdoZW4gY29tcGxldGUuXG4gICAqL1xuICBhc3luYyBzdGFydFRyYW5zYWN0aW9uKG9wdGlvbnMgPSB7fSkge1xuICAgIGF3YWl0IGNvb3JkaW5hdGVTaGFyZWRUcmFuc2FjdGlvbkNvbm5lY3Rpb24odGhpcywgYXN5bmMgKCkgPT4ge1xuICAgICAgd2hpbGUgKHRydWUpIHtcbiAgICAgICAgLyoqIEB0eXBlIHtpbXBvcnQoXCIuLi9vcGVyYXRpb24tbGVhc2UuanNcIikuZGVmYXVsdCB8IHVuZGVmaW5lZH0gKi9cbiAgICAgICAgbGV0IGJsb2NraW5nT3BlcmF0aW9uTGVhc2VcblxuICAgICAgICBhd2FpdCB0aGlzLl90cmFuc2FjdGlvbnNBY3Rpb25zTXV0ZXguc3luYyhhc3luYyAoKSA9PiB7XG4gICAgICAgICAgY29uc3Qgb3BlcmF0aW9uTGVhc2UgPSB0aGlzLl9vcGVyYXRpb25MZWFzZVxuXG4gICAgICAgICAgaWYgKG9wZXJhdGlvbkxlYXNlICYmIG9wdGlvbnMub3BlcmF0aW9uT3duZXIgIT09IG9wZXJhdGlvbkxlYXNlLm93bmVyKSB7XG4gICAgICAgICAgICBibG9ja2luZ09wZXJhdGlvbkxlYXNlID0gb3BlcmF0aW9uTGVhc2VcbiAgICAgICAgICAgIHJldHVyblxuICAgICAgICAgIH1cblxuICAgICAgICAgIGF3YWl0IHRoaXMuX3J1blByb2ZpbGVkVHJhbnNhY3Rpb25BY3Rpb24oXCJzdGFydFwiLCBhc3luYyAoKSA9PiB7XG4gICAgICAgICAgICBhd2FpdCB0aGlzLl9zdGFydFRyYW5zYWN0aW9uQWN0aW9uKG9wdGlvbnMpXG4gICAgICAgICAgfSlcbiAgICAgICAgICB0aGlzLl90cmFuc2FjdGlvbnNDb3VudCsrXG5cbiAgICAgICAgICBpZiAodGhpcy5fdHJhbnNhY3Rpb25zQ291bnQgPT09IDEpIHtcbiAgICAgICAgICAgIHRoaXMuX3RyYW5zYWN0aW9uQ29tcGxldGlvblByb21pc2UgPSBuZXcgUHJvbWlzZSgocmVzb2x2ZSkgPT4ge1xuICAgICAgICAgICAgICB0aGlzLl9yZXNvbHZlVHJhbnNhY3Rpb25Db21wbGV0aW9uID0gcmVzb2x2ZVxuICAgICAgICAgICAgfSlcbiAgICAgICAgICB9XG4gICAgICAgIH0pXG5cbiAgICAgICAgaWYgKCFibG9ja2luZ09wZXJhdGlvbkxlYXNlKSByZXR1cm5cblxuICAgICAgICBhd2FpdCBibG9ja2luZ09wZXJhdGlvbkxlYXNlLndhaXQob3B0aW9ucy5vcGVyYXRpb25Pd25lcilcbiAgICAgIH1cbiAgICB9LCBvcHRpb25zLm9wZXJhdGlvbk93bmVyKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgc3RhcnQgdHJhbnNhY3Rpb24gYWN0aW9uLlxuICAgKiBAcGFyYW0ge1BpY2s8UXVlcnlPcHRpb25zLCBcIm9wZXJhdGlvbk93bmVyXCI+fSBbb3B0aW9uc10gLSBUcmFuc2FjdGlvbiBvd25lcnNoaXAuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIHdoZW4gY29tcGxldGUuXG4gICAqL1xuICBhc3luYyBfc3RhcnRUcmFuc2FjdGlvbkFjdGlvbihvcHRpb25zID0ge30pIHtcbiAgICBhd2FpdCB0aGlzLnF1ZXJ5KFwiQkVHSU4gVFJBTlNBQ1RJT05cIiwgb3B0aW9ucylcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGNvbW1pdCB0cmFuc2FjdGlvbi5cbiAgICogQHBhcmFtIHtQaWNrPFF1ZXJ5T3B0aW9ucywgXCJvcGVyYXRpb25Pd25lclwiPn0gW29wdGlvbnNdIC0gVHJhbnNhY3Rpb24gb3duZXJzaGlwLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyB3aGVuIGNvbXBsZXRlLlxuICAgKi9cbiAgYXN5bmMgY29tbWl0VHJhbnNhY3Rpb24ob3B0aW9ucyA9IHt9KSB7XG4gICAgYXdhaXQgY29vcmRpbmF0ZVNoYXJlZFRyYW5zYWN0aW9uQ29ubmVjdGlvbih0aGlzLCBhc3luYyAoKSA9PiB7XG4gICAgICBhd2FpdCB0aGlzLl90cmFuc2FjdGlvbnNBY3Rpb25zTXV0ZXguc3luYyhhc3luYyAoKSA9PiB7XG4gICAgICAgIGF3YWl0IHRoaXMuX3J1blByb2ZpbGVkVHJhbnNhY3Rpb25BY3Rpb24oXCJjb21taXRcIiwgYXN5bmMgKCkgPT4ge1xuICAgICAgICAgIGF3YWl0IHRoaXMuX2NvbW1pdFRyYW5zYWN0aW9uQWN0aW9uKG9wdGlvbnMpXG4gICAgICAgIH0pXG4gICAgICAgIHRoaXMuX3RyYW5zYWN0aW9uc0NvdW50LS1cbiAgICAgICAgdGhpcy5fcmVzb2x2ZUNvbXBsZXRlZFRyYW5zYWN0aW9uKClcbiAgICAgIH0pXG4gICAgfSwgb3B0aW9ucy5vcGVyYXRpb25Pd25lcilcbiAgfVxuXG4gIC8qKiBSZXNvbHZlcyB0aGUgY3VycmVudCBvdXRlciB0cmFuc2FjdGlvbiBjb21wbGV0aW9uIHdoZW4gaXQgaGFzIGZpbmlzaGVkLiAqL1xuICBfcmVzb2x2ZUNvbXBsZXRlZFRyYW5zYWN0aW9uKCkge1xuICAgIGlmICh0aGlzLl90cmFuc2FjdGlvbnNDb3VudCAhPT0gMCkgcmV0dXJuXG5cbiAgICBjb25zdCByZXNvbHZlID0gdGhpcy5fcmVzb2x2ZVRyYW5zYWN0aW9uQ29tcGxldGlvblxuXG4gICAgdGhpcy5fcmVzb2x2ZVRyYW5zYWN0aW9uQ29tcGxldGlvbiA9IHVuZGVmaW5lZFxuICAgIGlmIChyZXNvbHZlKSByZXNvbHZlKClcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGNvbW1pdCB0cmFuc2FjdGlvbiBhY3Rpb24uXG4gICAqIEBwYXJhbSB7UGljazxRdWVyeU9wdGlvbnMsIFwib3BlcmF0aW9uT3duZXJcIj59IFtvcHRpb25zXSAtIFRyYW5zYWN0aW9uIG93bmVyc2hpcC5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgd2hlbiBjb21wbGV0ZS5cbiAgICovXG4gIGFzeW5jIF9jb21taXRUcmFuc2FjdGlvbkFjdGlvbihvcHRpb25zID0ge30pIHtcbiAgICBhd2FpdCB0aGlzLnF1ZXJ5KFwiQ09NTUlUXCIsIG9wdGlvbnMpXG4gIH1cblxuICAvKipcbiAgICogVGltZXMgYSBwaHlzaWNhbCB0cmFuc2FjdGlvbiBhY3Rpb24gb25seSB3aGVuIHRlc3QgcHJvZmlsaW5nIGlzIGFjdGl2ZS5cbiAgICogQHRlbXBsYXRlIFRcbiAgICogQHBhcmFtIHtcInN0YXJ0XCIgfCBcImNvbW1pdFwiIHwgXCJyb2xsYmFja1wifSBhY3Rpb24gLSBUcmFuc2FjdGlvbiBhY3Rpb24uXG4gICAqIEBwYXJhbSB7KCkgPT4gUHJvbWlzZTxUPn0gY2FsbGJhY2sgLSBQaHlzaWNhbCBhY3Rpb24gY2FsbGJhY2suXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPFQ+fSAtIENhbGxiYWNrIHJlc3VsdC5cbiAgICovXG4gIGFzeW5jIF9ydW5Qcm9maWxlZFRyYW5zYWN0aW9uQWN0aW9uKGFjdGlvbiwgY2FsbGJhY2spIHtcbiAgICBjb25zdCBwcm9maWxlQ29udGV4dCA9IGN1cnJlbnRUZXN0UHJvZmlsZUNvbnRleHQodGhpcy5jb25maWd1cmF0aW9uKVxuXG4gICAgaWYgKCFwcm9maWxlQ29udGV4dCkgcmV0dXJuIGF3YWl0IGNhbGxiYWNrKClcblxuICAgIGNvbnN0IHN0YXJ0ZWRBdE1zID0gbm93TXMoKVxuICAgIGxldCBmYWlsZWQgPSB0cnVlXG5cbiAgICB0cnkge1xuICAgICAgY29uc3QgcmVzdWx0ID0gYXdhaXQgY2FsbGJhY2soKVxuXG4gICAgICBmYWlsZWQgPSBmYWxzZVxuICAgICAgcmV0dXJuIHJlc3VsdFxuICAgIH0gZmluYWxseSB7XG4gICAgICBwcm9maWxlQ29udGV4dC5wcm9maWxlci5yZWNvcmREYXRhYmFzZVRyYW5zYWN0aW9uKHByb2ZpbGVDb250ZXh0LCB7XG4gICAgICAgIGFjdGlvbixcbiAgICAgICAgZHVyYXRpb25Nczogbm93TXMoKSAtIHN0YXJ0ZWRBdE1zLFxuICAgICAgICBmYWlsZWRcbiAgICAgIH0pXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIFN0YXJ0cyBhbiBvcHRpb25hbCBwaHlzaWNhbC1xdWVyeSBwcm9maWxlIGF0dGVtcHQgd2l0aG91dCByZXRhaW5pbmcgU1FMLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gc3FsIC0gT3JpZ2luYWwgU1FMIHVzZWQgb25seSB0byBkZXJpdmUgaXRzIHJlZGFjdGVkIGRpYWdub3N0aWMuXG4gICAqIEByZXR1cm5zIHtUZXN0UHJvZmlsZVF1ZXJ5QXR0ZW1wdCB8IHVuZGVmaW5lZH0gLSBBY3RpdmUgcHJvZmlsZSBoYW5kbGUuXG4gICAqL1xuICBfc3RhcnRQcm9maWxlZFF1ZXJ5QXR0ZW1wdChzcWwpIHtcbiAgICBjb25zdCBjb250ZXh0ID0gY3VycmVudFRlc3RQcm9maWxlQ29udGV4dCh0aGlzLmNvbmZpZ3VyYXRpb24pXG5cbiAgICBpZiAoIWNvbnRleHQpIHJldHVybiB1bmRlZmluZWRcblxuICAgIHJldHVybiB7XG4gICAgICBjb250ZXh0LFxuICAgICAgZGlhZ25vc3RpYzogc3FsRGlhZ25vc3RpYyhzcWwpLFxuICAgICAgc3RhcnRlZEF0TXM6IG5vd01zKClcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogQ29tcGxldGVzIGFuIG9wdGlvbmFsIHBoeXNpY2FsLXF1ZXJ5IHByb2ZpbGUgYXR0ZW1wdC5cbiAgICogQHBhcmFtIHtUZXN0UHJvZmlsZVF1ZXJ5QXR0ZW1wdCB8IHVuZGVmaW5lZH0gYXR0ZW1wdCAtIFByb2ZpbGUgaGFuZGxlLlxuICAgKiBAcGFyYW0ge2Jvb2xlYW59IGZhaWxlZCAtIFdoZXRoZXIgdGhlIHBoeXNpY2FsIGRyaXZlciBjYWxsIGZhaWxlZC5cbiAgICogQHJldHVybnMge3ZvaWR9XG4gICAqL1xuICBfZmluaXNoUHJvZmlsZWRRdWVyeUF0dGVtcHQoYXR0ZW1wdCwgZmFpbGVkKSB7XG4gICAgaWYgKCFhdHRlbXB0KSByZXR1cm5cblxuICAgIGF0dGVtcHQuY29udGV4dC5wcm9maWxlci5yZWNvcmREYXRhYmFzZVF1ZXJ5KGF0dGVtcHQuY29udGV4dCwge1xuICAgICAgZHVyYXRpb25Nczogbm93TXMoKSAtIGF0dGVtcHQuc3RhcnRlZEF0TXMsXG4gICAgICBmYWlsZWQsXG4gICAgICAuLi5hdHRlbXB0LmRpYWdub3N0aWNcbiAgICB9KVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZXZlcnkgZ3VhcmQgcmVnaXN0ZXJlZCB0byB0aGUgdHJhbnNhY3Rpb24gZnJhbWUuXG4gICAqIEBwYXJhbSB7VHJhbnNhY3Rpb25DYWxsYmFja0ZyYW1lfSBjYWxsYmFja0ZyYW1lIC0gRnJhbWUgd2hvc2UgZ3VhcmRzIGFyZSBjb21wbGV0aW5nLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyB3aGVuIGV2ZXJ5IGd1YXJkIGFjY2VwdHMgdGhlIGNvbW1pdC5cbiAgICovXG4gIGFzeW5jIF9ydW5CZWZvcmVDb21taXRDYWxsYmFja3MoY2FsbGJhY2tGcmFtZSkge1xuICAgIGZvciAoY29uc3QgY2FsbGJhY2sgb2YgY2FsbGJhY2tGcmFtZS5iZWZvcmVDb21taXRDYWxsYmFja3MpIHtcbiAgICAgIGF3YWl0IGNhbGxiYWNrKClcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogTWVyZ2VzIGNvbW1pdHRlZCBjYWxsYmFja3MgaW50byB0aGUgcGFyZW50IHRyYW5zYWN0aW9uIGZyYW1lIG9yIHJ1bnMgdGhlbSB3aGVuIHRoZSBvdXRlcm1vc3QgY29tbWl0IGNvbXBsZXRlcy5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgd2hlbiBjb21wbGV0ZS5cbiAgICovXG4gIGFzeW5jIF9jb21taXRUcmFuc2FjdGlvbkNhbGxiYWNrRnJhbWUoKSB7XG4gICAgY29uc3QgY29tbWl0dGVkRnJhbWUgPSB0aGlzLl90cmFuc2FjdGlvbkNhbGxiYWNrRnJhbWVzLnBvcCgpXG5cbiAgICBpZiAoIWNvbW1pdHRlZEZyYW1lIHx8IGNvbW1pdHRlZEZyYW1lLmFmdGVyQ29tbWl0Q2FsbGJhY2tzLmxlbmd0aCA9PT0gMCkgcmV0dXJuXG5cbiAgICBjb25zdCBwYXJlbnRGcmFtZSA9IHRoaXMuX3RyYW5zYWN0aW9uQ2FsbGJhY2tGcmFtZXNbdGhpcy5fdHJhbnNhY3Rpb25DYWxsYmFja0ZyYW1lcy5sZW5ndGggLSAxXVxuXG4gICAgaWYgKHBhcmVudEZyYW1lKSB7XG4gICAgICBwYXJlbnRGcmFtZS5hZnRlckNvbW1pdENhbGxiYWNrcy5wdXNoKC4uLmNvbW1pdHRlZEZyYW1lLmFmdGVyQ29tbWl0Q2FsbGJhY2tzKVxuICAgICAgcmV0dXJuXG4gICAgfVxuXG4gICAgZm9yIChjb25zdCBjYWxsYmFjayBvZiBjb21taXR0ZWRGcmFtZS5hZnRlckNvbW1pdENhbGxiYWNrcykge1xuICAgICAgYXdhaXQgY2FsbGJhY2soKVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBTdHJlYW1zIHRoZSByb3dzIG9mIGBzcWxgIG9uZSBhdCBhIHRpbWUgaW5zdGVhZCBvZiBidWZmZXJpbmcgdGhlIHdob2xlIHJlc3VsdCBzZXQsIHNvIGFcbiAgICogY2FsbGVyIGNhbiBwcm9jZXNzIGFuIGFyYml0cmFyaWx5IGxhcmdlIHJlc3VsdCB3aXRoIGJvdW5kZWQgbWVtb3J5LiBUaGlzIGJhc2UgaW1wbGVtZW50YXRpb25cbiAgICogZmFsbHMgYmFjayB0byBhIGJ1ZmZlcmVkIHtAbGluayBxdWVyeX0gYW5kIHlpZWxkcyBpdHMgcm93czsgZHJpdmVycyBiYWNrZWQgYnkgYSBjdXJzb3ItY2FwYWJsZVxuICAgKiBjbGllbnQgKHRoZSBNeVNRTCBkcml2ZXIpIG92ZXJyaWRlIGl0IHdpdGggdHJ1ZSBzZXJ2ZXItc2lkZSBzdHJlYW1pbmcuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBzcWwgLSBTUUwgc3RyaW5nIHRvIHN0cmVhbS5cbiAgICogQHBhcmFtIHtRdWVyeU9wdGlvbnN9IFtvcHRpb25zXSAtIFF1ZXJ5IG9wdGlvbnMsIGFzIGZvciB7QGxpbmsgcXVlcnl9LlxuICAgKiBAeWllbGRzIHtSZWNvcmQ8c3RyaW5nLCB1bmtub3duPn0gLSBUaGUgcmVzdWx0IHJvd3MsIG9uZSBhdCBhIHRpbWUuXG4gICAqL1xuICBhc3luYyAqcXVlcnlTdHJlYW0oc3FsLCBvcHRpb25zID0ge30pIHtcbiAgICBjb25zdCByb3dzID0gYXdhaXQgdGhpcy5xdWVyeShzcWwsIG9wdGlvbnMpXG5cbiAgICBmb3IgKGNvbnN0IHJvdyBvZiBBcnJheS5pc0FycmF5KHJvd3MpID8gcm93cyA6IFtdKSB7XG4gICAgICB5aWVsZCByb3dcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogUnVucyBxdWVyeS5cbiAgICogQHBhcmFtIHtzdHJpbmd9IHNxbCAtIFNRTCBzdHJpbmcuXG4gICAqIEBwYXJhbSB7UXVlcnlPcHRpb25zfSBbb3B0aW9uc10gLSBRdWVyeSBvcHRpb25zLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxRdWVyeVJlc3VsdFR5cGU+fSAtIFJlc29sdmVzIHdpdGggdGhlIHF1ZXJ5LlxuICAgKi9cbiAgYXN5bmMgcXVlcnkoc3FsLCBvcHRpb25zID0ge30pIHtcbiAgICBhd2FpdCB0aGlzLl93YWl0Rm9yT3BlcmF0aW9uTGVhc2Uob3B0aW9ucy5vcGVyYXRpb25Pd25lcilcbiAgICB0aGlzLl9hc3NlcnRXcml0YWJsZVF1ZXJ5KHNxbClcblxuICAgIGxldCB0cmllcyA9IDBcbiAgICBjb25zdCBtYXhUcmllcyA9IDVcbiAgICBjb25zdCByZXF1ZXN0VGltaW5nID0gdGhpcy5jb25maWd1cmF0aW9uLmdldEN1cnJlbnRSZXF1ZXN0VGltaW5nKClcbiAgICBjb25zdCBsb2dRdWVyeSA9IG9wdGlvbnMubG9nUXVlcnkgPz8gdGhpcy5fcXVlcnlMb2dnaW5nRW5hYmxlZCgpXG4gICAgY29uc3Qgc291cmNlU3RhY2sgPSBsb2dRdWVyeSA/IChvcHRpb25zLnNvdXJjZVN0YWNrIHx8IEVycm9yKCkuc3RhY2spIDogdW5kZWZpbmVkXG4gICAgY29uc3QgcXVlcnlTcWwgPSB0aGlzLl9xdWVyeVNxbFdpdGhQcm9jZXNzTGlzdENvbW1lbnQoc3FsLCBvcHRpb25zKVxuXG4gICAgd2hpbGUgKHRyaWVzIDwgbWF4VHJpZXMpIHtcbiAgICAgIHRyaWVzKytcblxuICAgICAgdHJ5IHtcbiAgICAgICAgcmV0dXJuIGF3YWl0IHRoaXMuX3F1ZXJ5QWN0dWFsV2l0aExvZ2dpbmcoe29yaWdpbmFsU3FsOiBzcWwsIHF1ZXJ5U3FsfSwgey4uLm9wdGlvbnMsIGxvZ1F1ZXJ5LCBzb3VyY2VTdGFja30sIHJlcXVlc3RUaW1pbmcsIHRyaWVzKVxuICAgICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgICAgaWYgKCEoZXJyb3IgaW5zdGFuY2VvZiBFcnJvcikpIHRocm93IGVycm9yXG5cbiAgICAgICAgdGhpcy5fZmFpbGVkUXVlcnlEaWFnbm9zdGljcy5zZXQoZXJyb3IsIHNxbERpYWdub3N0aWMoc3FsKSlcblxuICAgICAgICAvLyBBIGRlbGliZXJhdGVseS1hYm9ydGVkIHF1ZXJ5IG11c3QgbmV2ZXIgYmUgc2lsZW50bHkgcmUtcnVuIOKAlCBpdHNcbiAgICAgICAgLy8gY29ubmVjdGlvbiB3YXMgZGVzdHJveWVkIG9uIHB1cnBvc2UsIHNvIHRyZWF0IGl0IGFzIHRlcm1pbmFsLlxuICAgICAgICBpZiAoZXJyb3IgaW5zdGFuY2VvZiBRdWVyeUFib3J0ZWRFcnJvcikgdGhyb3cgZXJyb3JcblxuICAgICAgICBjb25zdCByZXRyeUluZm8gPSB0aGlzLnJldHJ5YWJsZURhdGFiYXNlRXJyb3IoZXJyb3IpXG5cbiAgICAgICAgaWYgKG9wdGlvbnMucmV0cnkgIT09IGZhbHNlICYmIHRyaWVzIDwgbWF4VHJpZXMgJiYgcmV0cnlJbmZvLnJldHJ5KSB7XG4gICAgICAgICAgaWYgKHJldHJ5SW5mby5yZWNvbm5lY3QpIHtcbiAgICAgICAgICAgIGlmICh0aGlzLl90cmFuc2FjdGlvbnNDb3VudCA+IDApIHtcbiAgICAgICAgICAgICAgdGhyb3cgbmV3IEVycm9yKGBDYW5ub3QgcmVjb25uZWN0IHdoaWxlIGEgdHJhbnNhY3Rpb24gaXMgYWN0aXZlICgke3RoaXMuX3RyYW5zYWN0aW9uc0NvdW50fSkuIE9yaWdpbmFsIGVycm9yOiAke2Vycm9yLm1lc3NhZ2V9YCwge2NhdXNlOiBlcnJvcn0pXG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIGF3YWl0IHRoaXMucmVjb25uZWN0KClcbiAgICAgICAgICB9XG5cbiAgICAgICAgICBjb25zdCB3YWl0TXMgPSB0eXBlb2YgcmV0cnlJbmZvLndhaXRNcyA9PT0gXCJudW1iZXJcIiAmJiBOdW1iZXIuaXNGaW5pdGUocmV0cnlJbmZvLndhaXRNcykgPyByZXRyeUluZm8ud2FpdE1zIDogMTAwXG5cbiAgICAgICAgICBpZiAod2FpdE1zID4gMCkgYXdhaXQgd2FpdCh3YWl0TXMpXG4gICAgICAgICAgY29uc3Qgc2Vuc2l0aXZlVmFsdWVzID0gcmVxdWVzdFRpbWluZyA/IHJlcXVlc3RUaW1pbmcuZ2V0TG9nU2Vuc2l0aXZlVmFsdWVzKCkgOiBuZXcgU2V0KClcbiAgICAgICAgICBjb25zdCBsb2dnZWRFcnJvciA9IHRoaXMuY29uZmlndXJhdGlvbi5nZXRMb2dSZWRhY3RvcigpLnJlZGFjdFN0cmluZyhlcnJvci5zdGFjayB8fCBlcnJvci5tZXNzYWdlLCBzZW5zaXRpdmVWYWx1ZXMpXG5cbiAgICAgICAgICB0aGlzLmxvZ2dlci53YXJuKGBSZXRyeWluZyBxdWVyeSBiZWNhdXNlIGZhaWxlZCB3aXRoOiAke2xvZ2dlZEVycm9yfWApXG4gICAgICAgICAgLy8gUmV0cnlcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICB0aHJvdyBlcnJvclxuICAgICAgICB9XG4gICAgICB9XG4gICAgfVxuXG4gICAgdGhyb3cgbmV3IEVycm9yKFwiJ3F1ZXJ5JyB1bmV4cGVjdGVkIGNhbWUgaGVyZVwiKVxuICB9XG5cbiAgLyoqXG4gICAqIEV4ZWN1dGVzIGEgbXV0YXRpb24gYW5kIHJldHVybnMgdGhlIG51bWJlciBvZiByb3dzIGNoYW5nZWQgYnkgdGhhdCBzdGF0ZW1lbnQuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBzcWwgLSBNdXRhdGlvbiBTUUwgc3RyaW5nLlxuICAgKiBAcGFyYW0ge1F1ZXJ5T3B0aW9uc30gW29wdGlvbnNdIC0gUXVlcnkgb3duZXJzaGlwIG9wdGlvbnMuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPG51bWJlcj59IC0gQWZmZWN0ZWQgcm93IGNvdW50LlxuICAgKi9cbiAgYXN5bmMgYWZmZWN0ZWRSb3dzKHNxbCwgb3B0aW9ucyA9IHt9KSB7XG4gICAgYXdhaXQgdGhpcy5fd2FpdEZvck9wZXJhdGlvbkxlYXNlKG9wdGlvbnMub3BlcmF0aW9uT3duZXIpXG4gICAgdGhpcy5fYXNzZXJ0V3JpdGFibGVRdWVyeShzcWwpXG5cbiAgICByZXR1cm4gYXdhaXQgY29vcmRpbmF0ZVNoYXJlZFRyYW5zYWN0aW9uQ29ubmVjdGlvbih0aGlzLCBhc3luYyAoKSA9PiB7XG4gICAgICBhd2FpdCB0aGlzLmJlZm9yZVF1ZXJ5KHNxbCwgb3B0aW9ucylcblxuICAgICAgdHJ5IHtcbiAgICAgICAgY29uc3QgcHJvZmlsZUF0dGVtcHQgPSB0aGlzLl9zdGFydFByb2ZpbGVkUXVlcnlBdHRlbXB0KHNxbClcbiAgICAgICAgbGV0IGZhaWxlZCA9IHRydWVcblxuICAgICAgICB0cnkge1xuICAgICAgICAgIGNvbnN0IGFmZmVjdGVkUm93cyA9IGF3YWl0IHRoaXMuX3J1blBoeXNpY2FsQ29ubmVjdGlvblJlcXVlc3QoXG4gICAgICAgICAgICBhc3luYyAoKSA9PiBhd2FpdCB0aGlzLl9hZmZlY3RlZFJvd3NBY3R1YWwoc3FsKVxuICAgICAgICAgIClcblxuICAgICAgICAgIGZhaWxlZCA9IGZhbHNlXG4gICAgICAgICAgcmV0dXJuIGFmZmVjdGVkUm93c1xuICAgICAgICB9IGZpbmFsbHkge1xuICAgICAgICAgIHRoaXMuX2ZpbmlzaFByb2ZpbGVkUXVlcnlBdHRlbXB0KHByb2ZpbGVBdHRlbXB0LCBmYWlsZWQpXG4gICAgICAgIH1cbiAgICAgIH0gZmluYWxseSB7XG4gICAgICAgIGF3YWl0IHRoaXMuYWZ0ZXJRdWVyeShzcWwsIG9wdGlvbnMpXG4gICAgICB9XG4gICAgfSwgb3B0aW9ucy5vcGVyYXRpb25Pd25lcilcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHF1ZXJ5IGFjdHVhbCB3aXRoIGxvZ2dpbmcuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gT3B0aW9ucyBvYmplY3QuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBhcmdzLm9yaWdpbmFsU3FsIC0gT3JpZ2luYWwgU1FMIHN0cmluZyBiZWZvcmUgcHJvY2Vzcy1saXN0IGNvbW1lbnRzLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gYXJncy5xdWVyeVNxbCAtIFNRTCBzdHJpbmcgc2VudCB0byB0aGUgZGF0YWJhc2UuXG4gICAqIEBwYXJhbSB7UXVlcnlPcHRpb25zfSBvcHRpb25zIC0gUXVlcnkgb3B0aW9ucy5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi8uLi9odHRwLXNlcnZlci9jbGllbnQvcmVxdWVzdC10aW1pbmcuanNcIikuZGVmYXVsdCB8IHVuZGVmaW5lZH0gcmVxdWVzdFRpbWluZyAtIFJlcXVlc3QgdGltaW5nLlxuICAgKiBAcGFyYW0ge251bWJlcn0gdHJpZXMgLSBRdWVyeSBhdHRlbXB0IGNvdW50LlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxRdWVyeVJlc3VsdFR5cGU+fSAtIFJlc29sdmVzIHdpdGggdGhlIHF1ZXJ5LlxuICAgKi9cbiAgYXN5bmMgX3F1ZXJ5QWN0dWFsV2l0aExvZ2dpbmcoe29yaWdpbmFsU3FsLCBxdWVyeVNxbH0sIG9wdGlvbnMsIHJlcXVlc3RUaW1pbmcsIHRyaWVzKSB7XG4gICAgY29uc3Qgc3RhcnRlZEF0TXMgPSBub3dNcygpXG4gICAgY29uc3QgcHJldmlvdXNBY3RpdmVRdWVyeSA9IHRoaXMuX2FjdGl2ZVF1ZXJ5XG4gICAgdGhpcy5fYWN0aXZlUXVlcnkgPSB7XG4gICAgICBhbm5vdGF0aW9uczogZ2V0RGF0YWJhc2VBbm5vdGF0aW9ucygpLFxuICAgICAgbG9nTmFtZTogb3B0aW9ucy5sb2dOYW1lIHx8IFwiU1FMXCIsXG4gICAgICBzcWxQcmV2aWV3OiB0aGlzLl9kZWJ1Z1NxbFByZXZpZXcob3JpZ2luYWxTcWwpLFxuICAgICAgc3RhcnRlZEF0VW5peE1zOiBEYXRlLm5vdygpXG4gICAgfVxuICAgIGxldCByZXN1bHRcblxuICAgIHRyeSB7XG4gICAgICB0cnkge1xuICAgICAgICBjb25zdCBydW5RdWVyeUFjdHVhbFdpdGhIb29rcyA9IGFzeW5jICgpID0+IGF3YWl0IHRoaXMuX3F1ZXJ5QWN0dWFsV2l0aEhvb2tzKHF1ZXJ5U3FsLCBvcHRpb25zLCBvcmlnaW5hbFNxbClcblxuICAgICAgICBpZiAocmVxdWVzdFRpbWluZyAmJiB0cmllcyA9PT0gMSkge1xuICAgICAgICAgIHJlc3VsdCA9IGF3YWl0IHJlcXVlc3RUaW1pbmcubWVhc3VyZURiUXVlcnkocnVuUXVlcnlBY3R1YWxXaXRoSG9va3MpXG4gICAgICAgIH0gZWxzZSBpZiAocmVxdWVzdFRpbWluZykge1xuICAgICAgICAgIHJlc3VsdCA9IGF3YWl0IHJlcXVlc3RUaW1pbmcubWVhc3VyZShcImRiXCIsIHJ1blF1ZXJ5QWN0dWFsV2l0aEhvb2tzKVxuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgIHJlc3VsdCA9IGF3YWl0IHJ1blF1ZXJ5QWN0dWFsV2l0aEhvb2tzKClcbiAgICAgICAgfVxuICAgICAgfSBmaW5hbGx5IHtcbiAgICAgICAgdGhpcy5fYWN0aXZlUXVlcnkgPSBwcmV2aW91c0FjdGl2ZVF1ZXJ5XG4gICAgICB9XG4gICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgIGlmIChvcHRpb25zLmxvZ1F1ZXJ5ICE9PSBmYWxzZSkge1xuICAgICAgICBhd2FpdCB0aGlzLl9sb2dRdWVyeSh7XG4gICAgICAgICAgZWxhcHNlZE1zOiBub3dNcygpIC0gc3RhcnRlZEF0TXMsXG4gICAgICAgICAgZXJyb3I6IGVuc3VyZUVycm9yKGVycm9yKSxcbiAgICAgICAgICBsb2dOYW1lOiBvcHRpb25zLmxvZ05hbWUgfHwgXCJTUUxcIixcbiAgICAgICAgICByZXF1ZXN0VGltaW5nLFxuICAgICAgICAgIHNvdXJjZVN0YWNrOiBvcHRpb25zLnNvdXJjZVN0YWNrLFxuICAgICAgICAgIHNxbDogb3JpZ2luYWxTcWxcbiAgICAgICAgfSlcbiAgICAgIH1cblxuICAgICAgdGhyb3cgZXJyb3JcbiAgICB9XG5cbiAgICBjb25zdCBlbGFwc2VkTXMgPSBub3dNcygpIC0gc3RhcnRlZEF0TXNcblxuICAgIGlmIChvcHRpb25zLmxvZ1F1ZXJ5ICE9PSBmYWxzZSkge1xuICAgICAgYXdhaXQgdGhpcy5fbG9nUXVlcnkoe1xuICAgICAgICBlbGFwc2VkTXMsXG4gICAgICAgIGxvZ05hbWU6IG9wdGlvbnMubG9nTmFtZSB8fCBcIlNRTFwiLFxuICAgICAgICByZXF1ZXN0VGltaW5nLFxuICAgICAgICBzb3VyY2VTdGFjazogb3B0aW9ucy5zb3VyY2VTdGFjayxcbiAgICAgICAgc3FsOiBvcmlnaW5hbFNxbFxuICAgICAgfSlcbiAgICB9XG5cbiAgICBpZiAodGhpcy5fc2NoZW1hQ2FjaGVJbnZhbGlkYXRpbmdTcWwob3JpZ2luYWxTcWwpKSB7XG4gICAgICB0aGlzLmNsZWFyU2NoZW1hQ2FjaGUoKVxuICAgIH1cblxuICAgIHJldHVybiByZXN1bHRcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHF1ZXJ5IGFjdHVhbCB3aXRoIGJlZm9yZS9hZnRlciBob29rcy5cbiAgICogQHBhcmFtIHtzdHJpbmd9IHNxbCAtIFNRTCBzdHJpbmcuXG4gICAqIEBwYXJhbSB7UXVlcnlPcHRpb25zfSBvcHRpb25zIC0gUXVlcnkgb3B0aW9ucy5cbiAgICogQHBhcmFtIHtzdHJpbmd9IG9yaWdpbmFsU3FsIC0gU1FMIGJlZm9yZSBwcm9jZXNzLWxpc3QgY29tbWVudHMuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPFF1ZXJ5UmVzdWx0VHlwZT59IC0gUmVzb2x2ZXMgd2l0aCB0aGUgcXVlcnkuXG4gICAqL1xuICBhc3luYyBfcXVlcnlBY3R1YWxXaXRoSG9va3Moc3FsLCBvcHRpb25zLCBvcmlnaW5hbFNxbCkge1xuICAgIHJldHVybiBhd2FpdCBjb29yZGluYXRlU2hhcmVkVHJhbnNhY3Rpb25Db25uZWN0aW9uKHRoaXMsIGFzeW5jICgpID0+IHtcbiAgICAgIGF3YWl0IHRoaXMuYmVmb3JlUXVlcnkoc3FsLCBvcHRpb25zKVxuXG4gICAgICB0cnkge1xuICAgICAgICBjb25zdCBwcm9maWxlQXR0ZW1wdCA9IHRoaXMuX3N0YXJ0UHJvZmlsZWRRdWVyeUF0dGVtcHQob3JpZ2luYWxTcWwpXG4gICAgICAgIGxldCBmYWlsZWQgPSB0cnVlXG5cbiAgICAgICAgdHJ5IHtcbiAgICAgICAgICBjb25zdCByZXN1bHQgPSBhd2FpdCB0aGlzLl9ydW5QaHlzaWNhbENvbm5lY3Rpb25SZXF1ZXN0KFxuICAgICAgICAgICAgYXN5bmMgKCkgPT4gYXdhaXQgdGhpcy5fcXVlcnlBY3R1YWwoc3FsLCBvcHRpb25zKVxuICAgICAgICAgIClcblxuICAgICAgICAgIGZhaWxlZCA9IGZhbHNlXG4gICAgICAgICAgcmV0dXJuIHJlc3VsdFxuICAgICAgICB9IGZpbmFsbHkge1xuICAgICAgICAgIHRoaXMuX2ZpbmlzaFByb2ZpbGVkUXVlcnlBdHRlbXB0KHByb2ZpbGVBdHRlbXB0LCBmYWlsZWQpXG4gICAgICAgIH1cbiAgICAgIH0gZmluYWxseSB7XG4gICAgICAgIGF3YWl0IHRoaXMuYWZ0ZXJRdWVyeShzcWwsIG9wdGlvbnMpXG4gICAgICB9XG4gICAgfSwgb3B0aW9ucy5vcGVyYXRpb25Pd25lcilcbiAgfVxuXG4gIC8qKlxuICAgKiBIb29rIHRoYXQgcnVucyBpbW1lZGlhdGVseSBiZWZvcmUgYSBTUUwgcXVlcnkgaXMgc2VudCB0byB0aGUgZHJpdmVyLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gX3NxbCAtIFNRTCBzdHJpbmcuXG4gICAqIEBwYXJhbSB7UXVlcnlPcHRpb25zfSBfb3B0aW9ucyAtIFF1ZXJ5IG9wdGlvbnMuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIHdoZW4gY29tcGxldGUuXG4gICAqL1xuICBhc3luYyBiZWZvcmVRdWVyeShfc3FsLCBfb3B0aW9ucykge1xuICAgIC8vIE5vLW9wIGJ5IGRlZmF1bHRcbiAgfVxuXG4gIC8qKlxuICAgKiBIb29rIHRoYXQgcnVucyBpbW1lZGlhdGVseSBhZnRlciBhIFNRTCBxdWVyeSBoYXMgY29tcGxldGVkIG9yIGZhaWxlZC5cbiAgICogQHBhcmFtIHtzdHJpbmd9IF9zcWwgLSBTUUwgc3RyaW5nLlxuICAgKiBAcGFyYW0ge1F1ZXJ5T3B0aW9uc30gX29wdGlvbnMgLSBRdWVyeSBvcHRpb25zLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyB3aGVuIGNvbXBsZXRlLlxuICAgKi9cbiAgYXN5bmMgYWZ0ZXJRdWVyeShfc3FsLCBfb3B0aW9ucykge1xuICAgIC8vIE5vLW9wIGJ5IGRlZmF1bHRcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGdldCBkZWJ1ZyBzbmFwc2hvdC5cbiAgICogQHJldHVybnMge0RhdGFiYXNlQ29ubmVjdGlvbkRlYnVnU25hcHNob3R9IC0gRGlhZ25vc3RpYyBzbmFwc2hvdCBmb3IgdGhpcyBjb25uZWN0aW9uLlxuICAgKi9cbiAgZ2V0RGVidWdTbmFwc2hvdCgpIHtcbiAgICBjb25zdCBub3cgPSBEYXRlLm5vdygpXG4gICAgY29uc3QgYWN0aXZlUXVlcnkgPSB0aGlzLl9hY3RpdmVRdWVyeVxuXG4gICAgcmV0dXJuIHtcbiAgICAgIGFjdGl2ZVF1ZXJ5OiBhY3RpdmVRdWVyeSA/IHsuLi5hY3RpdmVRdWVyeSwgcnVubmluZ01zOiBNYXRoLm1heCgwLCBub3cgLSBhY3RpdmVRdWVyeS5zdGFydGVkQXRVbml4TXMpfSA6IG51bGwsXG4gICAgICBjaGVja291dEFnZU1zOiB0aGlzLl9jb25uZWN0aW9uQ2hlY2tlZE91dEF0VW5peE1zID8gTWF0aC5tYXgoMCwgbm93IC0gdGhpcy5fY29ubmVjdGlvbkNoZWNrZWRPdXRBdFVuaXhNcykgOiB1bmRlZmluZWQsXG4gICAgICBjaGVja2VkT3V0QXRVbml4TXM6IHRoaXMuX2Nvbm5lY3Rpb25DaGVja2VkT3V0QXRVbml4TXMsXG4gICAgICBjaGVja291dE5hbWU6IHRoaXMuX2Nvbm5lY3Rpb25DaGVja291dE5hbWUsXG4gICAgICBkcml2ZXJDbGFzczogdGhpcy5jb25zdHJ1Y3Rvci5uYW1lLFxuICAgICAgaWRTZXE6IHRoaXMuaWRTZXEsXG4gICAgICBvcGVuVHJhbnNhY3Rpb25zOiB0aGlzLl90cmFuc2FjdGlvbnNDb3VudCxcbiAgICAgIHNjaGVtYUNhY2hlRW50cmllczogdGhpcy5fc2NoZW1hQ2FjaGUuc2l6ZVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBSZXR1cm5zIGEgYm91bmRlZCBwcmVmaXggb2YgYHNxbGAgZm9yIGxpZ2h0d2VpZ2h0IGRpYWdub3N0aWMgc2Nhbm5pbmcuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBzcWwgLSBTUUwgc3RyaW5nLlxuICAgKiBAcGFyYW0ge251bWJlcn0gbGltaXQgLSBNYXhpbXVtIGNvZGUgdW5pdHMgdG8gaW5zcGVjdC5cbiAgICogQHJldHVybnMge3N0cmluZ30gLSBQcmVmaXggb2YgYHNxbGAuXG4gICAqL1xuICBfZGlhZ25vc3RpY1NxbFByZWZpeChzcWwsIGxpbWl0KSB7XG4gICAgcmV0dXJuIHNxbC5sZW5ndGggPD0gbGltaXQgPyBzcWwgOiBzcWwuc2xpY2UoMCwgbGltaXQpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBkZWJ1ZyBzcWwgcHJldmlldy5cbiAgICogQHBhcmFtIHtzdHJpbmd9IHNxbCAtIFNRTCB0byBwcmV2aWV3LlxuICAgKiBAcmV0dXJucyB7c3RyaW5nfSAtIE5vcm1hbGl6ZWQgdHJ1bmNhdGVkIFNRTCBwcmV2aWV3IGZvciBkaWFnbm9zdGljcy5cbiAgICovXG4gIF9kZWJ1Z1NxbFByZXZpZXcoc3FsKSB7XG4gICAgY29uc3QgcHJlZml4ID0gdGhpcy5fZGlhZ25vc3RpY1NxbFByZWZpeChzcWwsIFNRTF9QUkVWSUVXX1NDQU5fTElNSVQpXG5cbiAgICByZXR1cm4gcHJlZml4XG4gICAgICAucmVwbGFjZSgvXFxzKy9nLCBcIiBcIilcbiAgICAgIC50cmltKClcbiAgICAgIC5zbGljZSgwLCA1MDApXG4gIH1cblxuICAvKipcbiAgICogUnVucyBxdWVyeSBzcWwgd2l0aCBwcm9jZXNzIGxpc3QgY29tbWVudC5cbiAgICogQHBhcmFtIHtzdHJpbmd9IHNxbCAtIFNRTCBzdHJpbmcuXG4gICAqIEBwYXJhbSB7UXVlcnlPcHRpb25zfSBvcHRpb25zIC0gUXVlcnkgb3B0aW9ucy5cbiAgICogQHJldHVybnMge3N0cmluZ30gLSBTUUwgc3RyaW5nIHdpdGggYSBsZWFkaW5nIHByb2Nlc3MtbGlzdCBjb21tZW50IHdoZW4gYW5ub3RhdGlvbnMgZXhpc3QuXG4gICAqL1xuICBfcXVlcnlTcWxXaXRoUHJvY2Vzc0xpc3RDb21tZW50KHNxbCwgb3B0aW9ucykge1xuICAgIGlmIChvcHRpb25zLnByb2Nlc3NMaXN0Q29tbWVudCA9PT0gZmFsc2UpIHJldHVybiBzcWxcblxuICAgIGNvbnN0IHBhcnRzID0gW11cblxuICAgIGlmICh0aGlzLl9jb25uZWN0aW9uQ2hlY2tvdXROYW1lKSB7XG4gICAgICBwYXJ0cy5wdXNoKGBjaGVja291dD1cIiR7dGhpcy5fcHJvY2Vzc0xpc3RDb21tZW50VmFsdWUodGhpcy5fY29ubmVjdGlvbkNoZWNrb3V0TmFtZSl9XCJgKVxuICAgIH1cblxuICAgIGNvbnN0IGFubm90YXRpb25zID0gZ2V0RGF0YWJhc2VBbm5vdGF0aW9ucygpXG5cbiAgICBpZiAoYW5ub3RhdGlvbnMubGVuZ3RoID4gMCkge1xuICAgICAgcGFydHMucHVzaChgYW5ub3RhdGlvbnM9XCIke3RoaXMuX3Byb2Nlc3NMaXN0Q29tbWVudFZhbHVlKGFubm90YXRpb25zLmpvaW4oXCIgPiBcIikpfVwiYClcbiAgICB9XG5cbiAgICBpZiAocGFydHMubGVuZ3RoID09PSAwKSByZXR1cm4gc3FsXG5cbiAgICByZXR1cm4gYC8qIHZlbG9jaW91cyAke3BhcnRzLmpvaW4oXCIgXCIpfSAqLyAke3NxbH1gXG4gIH1cblxuICAvKipcbiAgICogUnVucyBwcm9jZXNzIGxpc3QgY29tbWVudCB2YWx1ZS5cbiAgICogQHBhcmFtIHtzdHJpbmd9IHZhbHVlIC0gUmF3IHByb2Nlc3MtbGlzdCBjb21tZW50IHZhbHVlLlxuICAgKiBAcmV0dXJucyB7c3RyaW5nfSAtIFNhbml0aXplZCBwcm9jZXNzLWxpc3QgY29tbWVudCB2YWx1ZS5cbiAgICovXG4gIF9wcm9jZXNzTGlzdENvbW1lbnRWYWx1ZSh2YWx1ZSkge1xuICAgIGxldCBzYW5pdGl6ZWQgPSBcIlwiXG5cbiAgICBmb3IgKGNvbnN0IGNoYXJhY3RlciBvZiB2YWx1ZSkge1xuICAgICAgY29uc3QgY29kZVBvaW50ID0gY2hhcmFjdGVyLmNvZGVQb2ludEF0KDApXG5cbiAgICAgIHNhbml0aXplZCArPSBjb2RlUG9pbnQgIT09IHVuZGVmaW5lZCAmJiAoY29kZVBvaW50IDwgMzIgfHwgY29kZVBvaW50ID09PSAxMjcpID8gXCIgXCIgOiBjaGFyYWN0ZXJcbiAgICB9XG5cbiAgICByZXR1cm4gc2FuaXRpemVkXG4gICAgICAucmVwbGFjZSgvXFwqXFwvL2csIFwiKiAvXCIpXG4gICAgICAucmVwbGFjZSgvXFxzKy9nLCBcIiBcIilcbiAgICAgIC50cmltKClcbiAgICAgIC5zbGljZSgwLCAyMDApXG4gICAgICAucmVwbGFjZSgvXCIvZywgXCInXCIpXG4gIH1cblxuICAvKipcbiAgICogUmVhZHMgdGhlIG5leHQgU1FMIHRva2VuIHN0YXJ0aW5nIGF0IGBzdGFydEluZGV4YCwgc2tpcHBpbmcgbGVhZGluZyB0cml2aWFcbiAgICogKEJPTSwgd2hpdGVzcGFjZSwgYmxvY2sgY29tbWVudHMsIGxpbmUgY29tbWVudHMpLiBJZiB0aGUgc2NhbiBjYW5ub3QgZmluaXNoXG4gICAqIHNraXBwaW5nIHRyaXZpYSBiZWZvcmUgYGxpbWl0YCwgdGhlIHJlc3VsdCBpcyBtYXJrZWQgaW5jb21wbGV0ZSBzbyBjYWxsZXJzXG4gICAqIGNhbiBjb25zZXJ2YXRpdmVseSB0cmVhdCB0aGUgc3RhdGVtZW50IGFzIHNjaGVtYS1pbnZhbGlkYXRpbmcuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBzcWwgLSBTUUwgc3RyaW5nLlxuICAgKiBAcGFyYW0ge251bWJlcn0gc3RhcnRJbmRleCAtIEluZGV4IHRvIHN0YXJ0IHNjYW5uaW5nLlxuICAgKiBAcGFyYW0ge251bWJlcn0gbGltaXQgLSBNYXhpbXVtIGFic29sdXRlIGluZGV4IHRvIHNjYW4gd2hpbGUgc2tpcHBpbmcgbGVhZGluZyB0cml2aWEuXG4gICAqIEByZXR1cm5zIHtTcWxUb2tlblJlc3VsdH0gLSBUb2tlbiByZXN1bHQuXG4gICAqL1xuICBfcmVhZFNxbFRva2VuKHNxbCwgc3RhcnRJbmRleCwgbGltaXQpIHtcbiAgICBsZXQgaSA9IHN0YXJ0SW5kZXhcbiAgICBjb25zdCBsZW4gPSBzcWwubGVuZ3RoXG5cbiAgICB3aGlsZSAoaSA8IGxlbiAmJiBpIDwgbGltaXQpIHtcbiAgICAgIGNvbnN0IGNoYXIgPSBzcWxbaV1cblxuICAgICAgaWYgKGNoYXIgPT09IFwiXFx1ZmVmZlwiIHx8IC9cXHMvLnRlc3QoY2hhcikpIHtcbiAgICAgICAgaSsrXG4gICAgICAgIGNvbnRpbnVlXG4gICAgICB9XG5cbiAgICAgIGlmIChjaGFyID09PSBcIi9cIiAmJiBzcWxbaSArIDFdID09PSBcIipcIikge1xuICAgICAgICBjb25zdCBjbG9zZSA9IHNxbC5pbmRleE9mKFwiKi9cIiwgaSArIDIpXG5cbiAgICAgICAgaWYgKGNsb3NlID09PSAtMSB8fCBjbG9zZSArIDIgPiBsaW1pdCkge1xuICAgICAgICAgIHJldHVybiB7aW5jb21wbGV0ZTogdHJ1ZSwgaW5kZXg6IGksIHRva2VuOiB1bmRlZmluZWR9XG4gICAgICAgIH1cblxuICAgICAgICBpID0gY2xvc2UgKyAyXG4gICAgICAgIGNvbnRpbnVlXG4gICAgICB9XG5cbiAgICAgIGlmIChjaGFyID09PSBcIi1cIiAmJiBzcWxbaSArIDFdID09PSBcIi1cIikge1xuICAgICAgICBjb25zdCBuZXdsaW5lID0gc3FsLmluZGV4T2YoXCJcXG5cIiwgaSArIDIpXG5cbiAgICAgICAgaWYgKG5ld2xpbmUgPT09IC0xKSB7XG4gICAgICAgICAgcmV0dXJuIHtpbmNvbXBsZXRlOiBmYWxzZSwgaW5kZXg6IGxlbiwgdG9rZW46IHVuZGVmaW5lZH1cbiAgICAgICAgfVxuXG4gICAgICAgIGlmIChuZXdsaW5lICsgMSA+IGxpbWl0KSB7XG4gICAgICAgICAgcmV0dXJuIHtpbmNvbXBsZXRlOiB0cnVlLCBpbmRleDogaSwgdG9rZW46IHVuZGVmaW5lZH1cbiAgICAgICAgfVxuXG4gICAgICAgIGkgPSBuZXdsaW5lICsgMVxuICAgICAgICBjb250aW51ZVxuICAgICAgfVxuXG4gICAgICBsZXQgdG9rZW4gPSBcIlwiXG5cbiAgICAgIHdoaWxlIChpIDwgbGVuKSB7XG4gICAgICAgIGNvbnN0IGMgPSBzcWxbaV1cblxuICAgICAgICBpZiAoL1xccy8udGVzdChjKSB8fCBjID09PSBcIlxcdWZlZmZcIikgYnJlYWtcbiAgICAgICAgaWYgKGMgPT09IFwiL1wiICYmIHNxbFtpICsgMV0gPT09IFwiKlwiKSBicmVha1xuICAgICAgICBpZiAoYyA9PT0gXCItXCIgJiYgc3FsW2kgKyAxXSA9PT0gXCItXCIpIGJyZWFrXG5cbiAgICAgICAgdG9rZW4gKz0gY1xuICAgICAgICBpKytcbiAgICAgIH1cblxuICAgICAgcmV0dXJuIHtpbmNvbXBsZXRlOiBmYWxzZSwgdG9rZW46IHRva2VuLnRvTG93ZXJDYXNlKCksIGluZGV4OiBpfVxuICAgIH1cblxuICAgIGlmIChpID49IGxlbikge1xuICAgICAgcmV0dXJuIHtpbmNvbXBsZXRlOiBmYWxzZSwgaW5kZXg6IGxlbiwgdG9rZW46IHVuZGVmaW5lZH1cbiAgICB9XG5cbiAgICByZXR1cm4ge2luY29tcGxldGU6IHRydWUsIGluZGV4OiBpLCB0b2tlbjogdW5kZWZpbmVkfVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgc2NoZW1hIGNhY2hlIGludmFsaWRhdGluZyBzcWwuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBzcWwgLSBTUUwgc3RyaW5nLlxuICAgKiBAcmV0dXJucyB7Ym9vbGVhbn0gLSBXaGV0aGVyIHRoZSBTUUwgc2hvdWxkIGludmFsaWRhdGUgc2NoZW1hIG1ldGFkYXRhLlxuICAgKi9cbiAgX3NjaGVtYUNhY2hlSW52YWxpZGF0aW5nU3FsKHNxbCkge1xuICAgIGNvbnN0IGZpcnN0ID0gdGhpcy5fcmVhZFNxbFRva2VuKHNxbCwgMCwgU0NIRU1BX0lOVkFMSURBVElPTl9TQ0FOX0xJTUlUKVxuXG4gICAgaWYgKGZpcnN0LmluY29tcGxldGUpIHJldHVybiB0cnVlXG5cbiAgICBjb25zdCBmaXJzdFRva2VuID0gZmlyc3QudG9rZW5cblxuICAgIGlmICghZmlyc3RUb2tlbikgcmV0dXJuIGZhbHNlXG4gICAgaWYgKC9eKGNyZWF0ZXxhbHRlcnxkcm9wfHJlbmFtZSkkLy50ZXN0KGZpcnN0VG9rZW4pKSByZXR1cm4gdHJ1ZVxuXG4gICAgaWYgKGZpcnN0VG9rZW4gPT09IFwiY29tbWVudFwiKSB7XG4gICAgICBjb25zdCBuZXh0ID0gdGhpcy5fcmVhZFNxbFRva2VuKHNxbCwgZmlyc3QuaW5kZXgsIFNDSEVNQV9JTlZBTElEQVRJT05fU0NBTl9MSU1JVClcblxuICAgICAgcmV0dXJuIG5leHQuaW5jb21wbGV0ZSB8fCBuZXh0LnRva2VuID09PSBcIm9uXCJcbiAgICB9XG5cbiAgICBpZiAoZmlyc3RUb2tlbiA9PT0gXCJleGVjXCIgfHwgZmlyc3RUb2tlbiA9PT0gXCJleGVjdXRlXCIpIHtcbiAgICAgIGNvbnN0IG5leHQgPSB0aGlzLl9yZWFkU3FsVG9rZW4oc3FsLCBmaXJzdC5pbmRleCwgU0NIRU1BX0lOVkFMSURBVElPTl9TQ0FOX0xJTUlUKVxuXG4gICAgICByZXR1cm4gbmV4dC5pbmNvbXBsZXRlIHx8IG5leHQudG9rZW4gPT09IFwic3BfcmVuYW1lXCJcbiAgICB9XG5cbiAgICBpZiAoZmlyc3RUb2tlbiA9PT0gXCJpZlwiKSB7XG4gICAgICBsZXQgaW5kZXggPSBmaXJzdC5pbmRleFxuXG4gICAgICB3aGlsZSAodHJ1ZSkge1xuICAgICAgICBjb25zdCByZXN1bHQgPSB0aGlzLl9yZWFkU3FsVG9rZW4oc3FsLCBpbmRleCwgU0NIRU1BX0lOVkFMSURBVElPTl9TQ0FOX0xJTUlUKVxuXG4gICAgICAgIGlmIChyZXN1bHQuaW5jb21wbGV0ZSkgcmV0dXJuIHRydWVcbiAgICAgICAgaWYgKCFyZXN1bHQudG9rZW4pIHJldHVybiBmYWxzZVxuICAgICAgICBpZiAocmVzdWx0LnRva2VuID09PSBcImJlZ2luXCIpIHtcbiAgICAgICAgICBjb25zdCBkZGxSZXN1bHQgPSB0aGlzLl9yZWFkU3FsVG9rZW4oc3FsLCByZXN1bHQuaW5kZXgsIFNDSEVNQV9JTlZBTElEQVRJT05fU0NBTl9MSU1JVClcblxuICAgICAgICAgIHJldHVybiBkZGxSZXN1bHQuaW5jb21wbGV0ZSB8fCAvXihjcmVhdGV8YWx0ZXJ8ZHJvcHxyZW5hbWUpJC8udGVzdChkZGxSZXN1bHQudG9rZW4gfHwgXCJcIilcbiAgICAgICAgfVxuXG4gICAgICAgIGluZGV4ID0gcmVzdWx0LmluZGV4XG4gICAgICB9XG4gICAgfVxuXG4gICAgcmV0dXJuIGZhbHNlXG4gIH1cblxuICAvKipcbiAgICogUnVucyBxdWVyeSBsb2dnaW5nIGVuYWJsZWQuXG4gICAqIEByZXR1cm5zIHtib29sZWFufSAtIFdoZXRoZXIgcXVlcnkgbG9nZ2luZyBpcyBlbmFibGVkIGZvciB0aGlzIGRyaXZlci5cbiAgICovXG4gIF9xdWVyeUxvZ2dpbmdFbmFibGVkKCkge1xuICAgIGlmICghdGhpcy5jb25maWd1cmF0aW9uKSByZXR1cm4gdHJ1ZVxuICAgIGlmICghdGhpcy5jb25maWd1cmF0aW9uLmdldFF1ZXJ5TG9nZ2luZ0VuYWJsZWQoKSkgcmV0dXJuIGZhbHNlXG5cbiAgICBjb25zdCBsb2dnZXIgPSBuZXcgTG9nZ2VyKFwiU1FMXCIsIHtjb25maWd1cmF0aW9uOiB0aGlzLmNvbmZpZ3VyYXRpb259KVxuXG4gICAgcmV0dXJuIGxvZ2dlci5pc0xldmVsRW5hYmxlZChcImluZm9cIilcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGxvZyBxdWVyeS5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBPcHRpb25zIG9iamVjdC5cbiAgICogQHBhcmFtIHtudW1iZXJ9IGFyZ3MuZWxhcHNlZE1zIC0gRWxhcHNlZCBtaWxsaXNlY29uZHMuXG4gICAqIEBwYXJhbSB7RXJyb3J9IFthcmdzLmVycm9yXSAtIFF1ZXJ5IGZhaWx1cmUsIHdoZW4gdGhlIGRyaXZlciBjYWxsIGZhaWxlZC5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGFyZ3MubG9nTmFtZSAtIFF1ZXJ5IGxvZyBzdWJqZWN0LlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uLy4uL2h0dHAtc2VydmVyL2NsaWVudC9yZXF1ZXN0LXRpbWluZy5qc1wiKS5kZWZhdWx0IHwgdW5kZWZpbmVkfSBhcmdzLnJlcXVlc3RUaW1pbmcgLSBSZXF1ZXN0IHRpbWluZy5cbiAgICogQHBhcmFtIHtzdHJpbmcgfCB1bmRlZmluZWR9IGFyZ3Muc291cmNlU3RhY2sgLSBTb3VyY2Ugc3RhY2suXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBhcmdzLnNxbCAtIFNRTCBzdHJpbmcuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIHdoZW4gY29tcGxldGUuXG4gICAqL1xuICBhc3luYyBfbG9nUXVlcnkoe2VsYXBzZWRNcywgZXJyb3IsIGxvZ05hbWUsIHJlcXVlc3RUaW1pbmcsIHNvdXJjZVN0YWNrLCBzcWx9KSB7XG4gICAgY29uc3QgbG9nZ2VyID0gbmV3IExvZ2dlcihsb2dOYW1lLCB7Y29uZmlndXJhdGlvbjogdGhpcy5jb25maWd1cmF0aW9ufSlcbiAgICBjb25zdCBzb3VyY2VMaW5lID0gdGhpcy5fcXVlcnlTb3VyY2VMaW5lKHNvdXJjZVN0YWNrKVxuICAgIGNvbnN0IHNlbnNpdGl2ZVZhbHVlcyA9IHJlcXVlc3RUaW1pbmcgPyByZXF1ZXN0VGltaW5nLmdldExvZ1NlbnNpdGl2ZVZhbHVlcygpIDogbmV3IFNldCgpXG4gICAgY29uc3QgcmVkYWN0b3IgPSB0aGlzLmNvbmZpZ3VyYXRpb24uZ2V0TG9nUmVkYWN0b3IoKVxuICAgIGNvbnN0IGxvZ2dlZFNxbCA9IHJlZGFjdG9yLnJlZGFjdFN0cmluZyhzcWwsIHNlbnNpdGl2ZVZhbHVlcylcbiAgICBjb25zdCBmYWlsdXJlID0gZXJyb3JcbiAgICAgID8gYCBGQUlMRUQgJHtlcnJvci5uYW1lfTogJHtyZWRhY3Rvci5yZWRhY3RTdHJpbmcoZXJyb3IubWVzc2FnZSwgc2Vuc2l0aXZlVmFsdWVzKX1gXG4gICAgICA6IFwiXCJcbiAgICBjb25zdCBtZXNzYWdlID0gc291cmNlTGluZVxuICAgICAgPyBgKCR7Zm9ybWF0RWxhcHNlZE1zKGVsYXBzZWRNcyl9KSR7ZmFpbHVyZX0gICR7bG9nZ2VkU3FsfVxcbiAg4oazICR7c291cmNlTGluZX1gXG4gICAgICA6IGAoJHtmb3JtYXRFbGFwc2VkTXMoZWxhcHNlZE1zKX0pJHtmYWlsdXJlfSAgJHtsb2dnZWRTcWx9YFxuXG4gICAgYXdhaXQgbG9nZ2VyLmluZm8obWVzc2FnZSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHF1ZXJ5IHNvdXJjZSBsaW5lLlxuICAgKiBAcGFyYW0ge3N0cmluZyB8IHVuZGVmaW5lZH0gc291cmNlU3RhY2sgLSBTb3VyY2Ugc3RhY2suXG4gICAqIEByZXR1cm5zIHtzdHJpbmcgfCB1bmRlZmluZWR9IC0gU291cmNlIGxpbmUgd2hlbiBhbiBhcHBsaWNhdGlvbiBmcmFtZSBpcyBhdmFpbGFibGUuXG4gICAqL1xuICBfcXVlcnlTb3VyY2VMaW5lKHNvdXJjZVN0YWNrKSB7XG4gICAgaWYgKCFzb3VyY2VTdGFjaykgcmV0dXJuIHVuZGVmaW5lZFxuXG4gICAgY29uc3QgYXBwbGljYXRpb25EaXJlY3RvcnkgPSB0aGlzLmNvbmZpZ3VyYXRpb25cbiAgICAgID8gdGhpcy5jb25maWd1cmF0aW9uLmdldERpcmVjdG9yeUlmQXZhaWxhYmxlKClcbiAgICAgIDogdW5kZWZpbmVkXG5cbiAgICBpZiAoIWFwcGxpY2F0aW9uRGlyZWN0b3J5KSByZXR1cm4gdW5kZWZpbmVkXG5cbiAgICBjb25zdCBlcnJvciA9IG5ldyBFcnJvcihcIlF1ZXJ5IHNvdXJjZVwiKVxuXG4gICAgZXJyb3Iuc3RhY2sgPSBzb3VyY2VTdGFja1xuXG4gICAgcmV0dXJuIEJhY2t0cmFjZUNsZWFuZXIuZ2V0QXBwbGljYXRpb25Tb3VyY2VMaW5lKGVycm9yLCB7XG4gICAgICBhcHBsaWNhdGlvbkRpcmVjdG9yeSxcbiAgICAgIGZyYW1ld29ya1NvdXJjZURpcmVjdG9yeTogdGhpcy5jb25maWd1cmF0aW9uLmdldEVudmlyb25tZW50SGFuZGxlcigpLmdldEZyYW1ld29ya1NvdXJjZURpcmVjdG9yeSgpXG4gICAgfSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHF1ZXJ5IGFjdHVhbC5cbiAgICogQGFic3RyYWN0XG4gICAqIEBwYXJhbSB7c3RyaW5nfSBzcWwgLSBTUUwgc3RyaW5nLlxuICAgKiBAcGFyYW0ge1F1ZXJ5T3B0aW9uc30gW29wdGlvbnNdIC0gUXVlcnkgb3B0aW9ucyAoY2FycmllcyB0aGUgb3B0aW9uYWwgYWJvcnQgc2lnbmFsKS5cbiAgICogQHJldHVybnMge1Byb21pc2U8UXVlcnlSZXN1bHRUeXBlPn0gLSBSZXNvbHZlcyB3aXRoIHRoZSBxdWVyeSBhY3R1YWwuXG4gICAqL1xuICBfcXVlcnlBY3R1YWwoc3FsLCBvcHRpb25zKSB7IC8vIGVzbGludC1kaXNhYmxlLWxpbmUgbm8tdW51c2VkLXZhcnNcbiAgICB0aHJvdyBuZXcgRXJyb3IoYHF1ZXJ5QWN0dWFsIG5vdCBpbXBsZW1lbnRlZGApXG4gIH1cblxuICAvKipcbiAgICogRXhlY3V0ZXMgYSBtdXRhdGlvbiBhbmQgcmV0dXJucyBpdHMgYWZmZWN0ZWQgcm93IGNvdW50LlxuICAgKiBAYWJzdHJhY3RcbiAgICogQHBhcmFtIHtzdHJpbmd9IHNxbCAtIE11dGF0aW9uIFNRTCBzdHJpbmcuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPG51bWJlcj59IC0gQWZmZWN0ZWQgcm93IGNvdW50LlxuICAgKi9cbiAgX2FmZmVjdGVkUm93c0FjdHVhbChzcWwpIHsgLy8gZXNsaW50LWRpc2FibGUtbGluZSBuby11bnVzZWQtdmFyc1xuICAgIHRocm93IG5ldyBFcnJvcihgYWZmZWN0ZWRSb3dzQWN0dWFsIG5vdCBpbXBsZW1lbnRlZGApXG4gIH1cblxuICAvKipcbiAgICogUnVucyBxdWVyeSB0byBzcWwuXG4gICAqIEBhYnN0cmFjdFxuICAgKiBAcGFyYW0ge1F1ZXJ5fSBfcXVlcnkgLSBRdWVyeSBpbnN0YW5jZS5cbiAgICogQHJldHVybnMge3N0cmluZ30gLSBTUUwgc3RyaW5nLlxuICAgKi9cbiAgcXVlcnlUb1NxbChfcXVlcnkpIHsgdGhyb3cgbmV3IEVycm9yKFwicXVlcnlUb1NxbCBub3QgaW1wbGVtZW50ZWRcIikgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHJldHJ5YWJsZSBkYXRhYmFzZSBlcnJvci5cbiAgICogQHBhcmFtIHtFcnJvcn0gX2Vycm9yIC0gRXJyb3IgaW5zdGFuY2UuXG4gICAqIEByZXR1cm5zIHtSZXRyeWFibGVEYXRhYmFzZUVycm9yUmVzdWx0fSAtIFJldHJ5IGluZm8uXG4gICAqL1xuICByZXRyeWFibGVEYXRhYmFzZUVycm9yKF9lcnJvcikge1xuICAgIHJldHVybiB7cmV0cnk6IGZhbHNlLCByZWNvbm5lY3Q6IGZhbHNlfVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgYXNzZXJ0IHdyaXRhYmxlIHF1ZXJ5LlxuICAgKiBAcGFyYW0ge3N0cmluZ30gc3FsIC0gU1FMIHN0cmluZy5cbiAgICogQHJldHVybnMge3ZvaWR9IC0gTm8gcmV0dXJuIHZhbHVlLlxuICAgKi9cbiAgX2Fzc2VydFdyaXRhYmxlUXVlcnkoc3FsKSB7XG4gICAgaWYgKCF0aGlzLmlzUmVhZE9ubHkoKSkgcmV0dXJuXG4gICAgaWYgKCF0aGlzLl9zcWxMb29rc0xpa2VXcml0ZShzcWwpKSByZXR1cm5cblxuICAgIHRocm93IG5ldyBFcnJvcihcIkRhdGFiYXNlIGlzIHJlYWQtb25seVwiKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgYXNzZXJ0IG5vdCByZWFkIG9ubHkuXG4gICAqIEByZXR1cm5zIHt2b2lkfSAtIE5vIHJldHVybiB2YWx1ZS5cbiAgICovXG4gIF9hc3NlcnROb3RSZWFkT25seSgpIHtcbiAgICBpZiAodGhpcy5pc1JlYWRPbmx5KCkpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihcIkRhdGFiYXNlIGlzIHJlYWQtb25seVwiKVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHNxbCBsb29rcyBsaWtlIHdyaXRlLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gc3FsIC0gU1FMIHN0cmluZy5cbiAgICogQHJldHVybnMge2Jvb2xlYW59IC0gU1FMIHJlcHJlc2VudGF0aW9uLlxuICAgKi9cbiAgX3NxbExvb2tzTGlrZVdyaXRlKHNxbCkge1xuICAgIGNvbnN0IG5vcm1hbGl6ZWQgPSBzcWwudHJpbSgpLnRvTG93ZXJDYXNlKClcblxuICAgIGlmICghbm9ybWFsaXplZCkgcmV0dXJuIGZhbHNlXG5cbiAgICBpZiAoXG4gICAgICBub3JtYWxpemVkLnN0YXJ0c1dpdGgoXCJzZWxlY3RcIikgfHxcbiAgICAgIG5vcm1hbGl6ZWQuc3RhcnRzV2l0aChcInNob3dcIikgfHxcbiAgICAgIG5vcm1hbGl6ZWQuc3RhcnRzV2l0aChcInByYWdtYVwiKSB8fFxuICAgICAgbm9ybWFsaXplZC5zdGFydHNXaXRoKFwiZXhwbGFpblwiKSB8fFxuICAgICAgbm9ybWFsaXplZC5zdGFydHNXaXRoKFwiZGVzY3JpYmVcIilcbiAgICApIHtcbiAgICAgIHJldHVybiBmYWxzZVxuICAgIH1cblxuICAgIGlmIChub3JtYWxpemVkLnN0YXJ0c1dpdGgoXCJ3aXRoXCIpKSB7XG4gICAgICBjb25zdCB3aXRoTWF0Y2ggPSBub3JtYWxpemVkLm1hdGNoKC9eXFxzKndpdGhbXFxzXFxTXSs/XFwpXFxzKihzZWxlY3R8aW5zZXJ0fHVwZGF0ZXxkZWxldGV8bWVyZ2V8cmVwbGFjZSlcXGIvKVxuXG4gICAgICBpZiAod2l0aE1hdGNoKSB7XG4gICAgICAgIHJldHVybiB3aXRoTWF0Y2hbMV0gIT09IFwic2VsZWN0XCJcbiAgICAgIH1cblxuICAgICAgcmV0dXJuIGZhbHNlXG4gICAgfVxuXG4gICAgY29uc3Qga2V5d29yZE1hdGNoID0gbm9ybWFsaXplZC5tYXRjaCgvXlxccyooXFx3KykvKVxuICAgIGNvbnN0IGtleXdvcmQgPSBrZXl3b3JkTWF0Y2ggPyBrZXl3b3JkTWF0Y2hbMV0gOiBcIlwiXG5cbiAgICByZXR1cm4gW1xuICAgICAgXCJpbnNlcnRcIixcbiAgICAgIFwidXBkYXRlXCIsXG4gICAgICBcImRlbGV0ZVwiLFxuICAgICAgXCJjcmVhdGVcIixcbiAgICAgIFwiYWx0ZXJcIixcbiAgICAgIFwiZHJvcFwiLFxuICAgICAgXCJ0cnVuY2F0ZVwiLFxuICAgICAgXCJtZXJnZVwiLFxuICAgICAgXCJyZXBsYWNlXCJcbiAgICBdLmluY2x1ZGVzKGtleXdvcmQpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBpcyByZWFkIG9ubHkuXG4gICAqIEByZXR1cm5zIHtib29sZWFufSAtIFdoZXRoZXIgcmVhZCBvbmx5LlxuICAgKi9cbiAgaXNSZWFkT25seSgpIHtcbiAgICByZXR1cm4gQm9vbGVhbih0aGlzLmdldEFyZ3MoKS5yZWFkT25seSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHJvbGxiYWNrIHRyYW5zYWN0aW9uLlxuICAgKiBAcGFyYW0ge1BpY2s8UXVlcnlPcHRpb25zLCBcIm9wZXJhdGlvbk93bmVyXCI+fSBbb3B0aW9uc10gLSBUcmFuc2FjdGlvbiBvd25lcnNoaXAuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIHdoZW4gY29tcGxldGUuXG4gICAqL1xuICBhc3luYyByb2xsYmFja1RyYW5zYWN0aW9uKG9wdGlvbnMgPSB7fSkge1xuICAgIGF3YWl0IGNvb3JkaW5hdGVTaGFyZWRUcmFuc2FjdGlvbkNvbm5lY3Rpb24odGhpcywgYXN5bmMgKCkgPT4ge1xuICAgICAgYXdhaXQgdGhpcy5fdHJhbnNhY3Rpb25zQWN0aW9uc011dGV4LnN5bmMoYXN5bmMgKCkgPT4ge1xuICAgICAgICB0cnkge1xuICAgICAgICAgIGF3YWl0IHRoaXMuX3J1blByb2ZpbGVkVHJhbnNhY3Rpb25BY3Rpb24oXCJyb2xsYmFja1wiLCBhc3luYyAoKSA9PiB7XG4gICAgICAgICAgICBhd2FpdCB0aGlzLl9yb2xsYmFja1RyYW5zYWN0aW9uQWN0aW9uKG9wdGlvbnMpXG4gICAgICAgICAgfSlcbiAgICAgICAgfSBmaW5hbGx5IHtcbiAgICAgICAgICAvLyBEcml2ZXIgcmVjb3ZlcnkgbWF5IG5lZWQgdG8gY2xlYXIgYSBzdGFsZSBwaHlzaWNhbCB0cmFuc2FjdGlvbiB3aGVuXG4gICAgICAgICAgLy8gbm8gbG9naWNhbCB0cmFuc2FjdGlvbiBpcyBhY3RpdmUuIE5ldmVyIGxldCB0aGF0IGNsZWFudXAgdW5kZXJmbG93XG4gICAgICAgICAgLy8gdGhlIGxvZ2ljYWwgZGVwdGggYW5kIHR1cm4gdGhlIG5leHQgcm9vdCB0cmFuc2FjdGlvbiBpbnRvIGEgc2F2ZXBvaW50LlxuICAgICAgICAgIGlmICh0aGlzLl90cmFuc2FjdGlvbnNDb3VudCA+IDApIHRoaXMuX3RyYW5zYWN0aW9uc0NvdW50LS1cbiAgICAgICAgICB0aGlzLl9yZXNvbHZlQ29tcGxldGVkVHJhbnNhY3Rpb24oKVxuXG4gICAgICAgICAgLy8gQSByb2xsZWQtYmFjayB0cmFuc2FjdGlvbiBtYXkgaGF2ZSByZXZlcnRlZCBEREwgKGUuZy4gYSBDUkVBVEUgVEFCTEVcbiAgICAgICAgICAvLyBydW4gbGF6aWx5IGluc2lkZSB0aGUgdHJhbnNhY3Rpb24pLCBzbyBhbnkgY2FjaGVkIHNjaGVtYSBtZXRhZGF0YSBpc1xuICAgICAgICAgIC8vIG5vdyBzdGFsZSBhbmQgbXVzdCBiZSBpbnZhbGlkYXRlZC4gV2l0aG91dCB0aGlzLCBhIGxhdGVyIHRhYmxlRXhpc3RzKClcbiAgICAgICAgICAvLyBjaGVjayBjYW4gcmVwb3J0IGEgdGFibGUgdGhhdCB0aGUgcm9sbGJhY2sgYWxyZWFkeSByZW1vdmVkLCBzbyBjYWxsZXJzXG4gICAgICAgICAgLy8gc2tpcCByZWNyZWF0aW5nIGl0IGFuZCB0aGVuIGZhaWwgd2l0aCBcIm5vIHN1Y2ggdGFibGVcIi5cbiAgICAgICAgICB0aGlzLmNsZWFyU2NoZW1hQ2FjaGUoKVxuICAgICAgICB9XG4gICAgICB9KVxuICAgIH0sIG9wdGlvbnMub3BlcmF0aW9uT3duZXIpXG4gIH1cblxuICAvKipcbiAgICogUnVucyByb2xsYmFjayB0cmFuc2FjdGlvbiBhY3Rpb24uXG4gICAqIEBwYXJhbSB7UGljazxRdWVyeU9wdGlvbnMsIFwib3BlcmF0aW9uT3duZXJcIj59IFtvcHRpb25zXSAtIFRyYW5zYWN0aW9uIG93bmVyc2hpcC5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgd2hlbiBjb21wbGV0ZS5cbiAgICovXG4gIGFzeW5jIF9yb2xsYmFja1RyYW5zYWN0aW9uQWN0aW9uKG9wdGlvbnMgPSB7fSkge1xuICAgIGF3YWl0IHRoaXMucXVlcnkoXCJST0xMQkFDS1wiLCBvcHRpb25zKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZ2VuZXJhdGUgc2F2ZSBwb2ludCBuYW1lLlxuICAgKiBAcmV0dXJucyB7c3RyaW5nfSAtIFRoZSBnZW5lcmF0ZSBzYXZlIHBvaW50IG5hbWUuXG4gICAqL1xuICBnZW5lcmF0ZVNhdmVQb2ludE5hbWUoKSB7XG4gICAgcmV0dXJuIGBzcCR7bmV3IFVVSUQoNCkuZm9ybWF0KCkucmVwbGFjZUFsbChcIi1cIiwgXCJcIil9YFxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgc3RhcnQgc2F2ZSBwb2ludC5cbiAgICogQHBhcmFtIHtzdHJpbmd9IHNhdmVQb2ludE5hbWUgLSBTYXZlIHBvaW50IG5hbWUuXG4gICAqIEBwYXJhbSB7UGljazxRdWVyeU9wdGlvbnMsIFwib3BlcmF0aW9uT3duZXJcIj59IFtvcHRpb25zXSAtIFRyYW5zYWN0aW9uIG93bmVyc2hpcC5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgd2hlbiBjb21wbGV0ZS5cbiAgICovXG4gIGFzeW5jIHN0YXJ0U2F2ZVBvaW50KHNhdmVQb2ludE5hbWUsIG9wdGlvbnMgPSB7fSkge1xuICAgIGF3YWl0IGNvb3JkaW5hdGVTaGFyZWRUcmFuc2FjdGlvbkNvbm5lY3Rpb24odGhpcywgYXN5bmMgKCkgPT4ge1xuICAgICAgYXdhaXQgdGhpcy5fdHJhbnNhY3Rpb25zQWN0aW9uc011dGV4LnN5bmMoYXN5bmMgKCkgPT4ge1xuICAgICAgICBhd2FpdCB0aGlzLl9zdGFydFNhdmVQb2ludEFjdGlvbihzYXZlUG9pbnROYW1lLCBvcHRpb25zKVxuICAgICAgfSlcbiAgICB9LCBvcHRpb25zLm9wZXJhdGlvbk93bmVyKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgc3RhcnQgc2F2ZSBwb2ludCBhY3Rpb24uXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBzYXZlUG9pbnROYW1lIC0gU2F2ZSBwb2ludCBuYW1lLlxuICAgKiBAcGFyYW0ge1BpY2s8UXVlcnlPcHRpb25zLCBcIm9wZXJhdGlvbk93bmVyXCI+fSBbb3B0aW9uc10gLSBUcmFuc2FjdGlvbiBvd25lcnNoaXAuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIHdoZW4gY29tcGxldGUuXG4gICAqL1xuICBhc3luYyBfc3RhcnRTYXZlUG9pbnRBY3Rpb24oc2F2ZVBvaW50TmFtZSwgb3B0aW9ucyA9IHt9KSB7XG4gICAgYXdhaXQgdGhpcy5xdWVyeShgU0FWRVBPSU5UICR7c2F2ZVBvaW50TmFtZX1gLCBvcHRpb25zKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgcmVuYW1lIGNvbHVtbi5cbiAgICogQHBhcmFtIHtzdHJpbmd9IHRhYmxlTmFtZSAtIFRhYmxlIG5hbWUuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBvbGRDb2x1bW5OYW1lIC0gUHJldmlvdXMgY29sdW1uIG5hbWUuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBuZXdDb2x1bW5OYW1lIC0gTmV3IGNvbHVtbiBuYW1lLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyB3aGVuIGNvbXBsZXRlLlxuICAgKi9cbiAgYXN5bmMgcmVuYW1lQ29sdW1uKHRhYmxlTmFtZSwgb2xkQ29sdW1uTmFtZSwgbmV3Q29sdW1uTmFtZSkge1xuICAgIHRoaXMuX2Fzc2VydE5vdFJlYWRPbmx5KClcbiAgICBjb25zdCB0YWJsZUNvbHVtbiA9IG5ldyBUYWJsZUNvbHVtbihvbGRDb2x1bW5OYW1lKVxuXG4gICAgdGFibGVDb2x1bW4uc2V0TmV3TmFtZShuZXdDb2x1bW5OYW1lKVxuXG4gICAgY29uc3QgdGFibGVEYXRhID0gbmV3IFRhYmxlRGF0YSh0YWJsZU5hbWUpXG5cbiAgICB0YWJsZURhdGEuYWRkQ29sdW1uKHRhYmxlQ29sdW1uKVxuXG4gICAgY29uc3QgYWx0ZXJUYWJsZVNRTHMgPSBhd2FpdCB0aGlzLmFsdGVyVGFibGVTUUxzKHRhYmxlRGF0YSlcblxuICAgIGZvciAoY29uc3QgYWx0ZXJUYWJsZVNRTCBvZiBhbHRlclRhYmxlU1FMcykge1xuICAgICAgYXdhaXQgdGhpcy5xdWVyeShhbHRlclRhYmxlU1FMKVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHJlbGVhc2Ugc2F2ZSBwb2ludC5cbiAgICogQHBhcmFtIHtzdHJpbmd9IHNhdmVQb2ludE5hbWUgLSBTYXZlIHBvaW50IG5hbWUuXG4gICAqIEBwYXJhbSB7UGljazxRdWVyeU9wdGlvbnMsIFwib3BlcmF0aW9uT3duZXJcIj59IFtvcHRpb25zXSAtIFRyYW5zYWN0aW9uIG93bmVyc2hpcC5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgd2hlbiBjb21wbGV0ZS5cbiAgICovXG4gIGFzeW5jIHJlbGVhc2VTYXZlUG9pbnQoc2F2ZVBvaW50TmFtZSwgb3B0aW9ucyA9IHt9KSB7XG4gICAgYXdhaXQgY29vcmRpbmF0ZVNoYXJlZFRyYW5zYWN0aW9uQ29ubmVjdGlvbih0aGlzLCBhc3luYyAoKSA9PiB7XG4gICAgICBhd2FpdCB0aGlzLl90cmFuc2FjdGlvbnNBY3Rpb25zTXV0ZXguc3luYyhhc3luYyAoKSA9PiB7XG4gICAgICAgIGF3YWl0IHRoaXMuX3JlbGVhc2VTYXZlUG9pbnRBY3Rpb24oc2F2ZVBvaW50TmFtZSwgb3B0aW9ucylcbiAgICAgIH0pXG4gICAgfSwgb3B0aW9ucy5vcGVyYXRpb25Pd25lcilcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHJlbGVhc2Ugc2F2ZSBwb2ludCBhY3Rpb24uXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBzYXZlUG9pbnROYW1lIC0gU2F2ZSBwb2ludCBuYW1lLlxuICAgKiBAcGFyYW0ge1BpY2s8UXVlcnlPcHRpb25zLCBcIm9wZXJhdGlvbk93bmVyXCI+fSBbb3B0aW9uc10gLSBUcmFuc2FjdGlvbiBvd25lcnNoaXAuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIHdoZW4gY29tcGxldGUuXG4gICAqL1xuICBhc3luYyBfcmVsZWFzZVNhdmVQb2ludEFjdGlvbihzYXZlUG9pbnROYW1lLCBvcHRpb25zID0ge30pIHtcbiAgICB0cnkge1xuICAgICAgYXdhaXQgdGhpcy5xdWVyeShgUkVMRUFTRSBTQVZFUE9JTlQgJHtzYXZlUG9pbnROYW1lfWAsIG9wdGlvbnMpXG4gICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgIGNvbnN0IG1lc3NhZ2UgPSBlcnJvciBpbnN0YW5jZW9mIEVycm9yID8gZXJyb3IubWVzc2FnZSA6IGAke2Vycm9yfWBcblxuICAgICAgLy8gU2F2ZXBvaW50IG1heSBhbHJlYWR5IGJlIGdvbmUgaWYgdGhlIGRhdGFiYXNlIHJvbGxlZCBiYWNrIGF1dG9tYXRpY2FsbHlcbiAgICAgIGlmIChtZXNzYWdlLnRvTG93ZXJDYXNlKCkuaW5jbHVkZXMoXCJzYXZlcG9pbnRcIikgJiYgbWVzc2FnZS50b0xvd2VyQ2FzZSgpLmluY2x1ZGVzKFwiZG9lcyBub3QgZXhpc3RcIikpIHtcbiAgICAgICAgdGhpcy5sb2dnZXIuZGVidWcoYFJlbGVhc2Ugc2F2ZXBvaW50IGlnbm9yZWQgYmVjYXVzZSBpdCBubyBsb25nZXIgZXhpc3RzOiAke3NhdmVQb2ludE5hbWV9YClcbiAgICAgICAgcmV0dXJuXG4gICAgICB9XG5cbiAgICAgIHRocm93IGVycm9yXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgcm9sbGJhY2sgc2F2ZSBwb2ludC5cbiAgICogQHBhcmFtIHtzdHJpbmd9IHNhdmVQb2ludE5hbWUgLSBTYXZlIHBvaW50IG5hbWUuXG4gICAqIEBwYXJhbSB7UGljazxRdWVyeU9wdGlvbnMsIFwib3BlcmF0aW9uT3duZXJcIj59IFtvcHRpb25zXSAtIFRyYW5zYWN0aW9uIG93bmVyc2hpcC5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgd2hlbiBjb21wbGV0ZS5cbiAgICovXG4gIGFzeW5jIHJvbGxiYWNrU2F2ZVBvaW50KHNhdmVQb2ludE5hbWUsIG9wdGlvbnMgPSB7fSkge1xuICAgIGF3YWl0IGNvb3JkaW5hdGVTaGFyZWRUcmFuc2FjdGlvbkNvbm5lY3Rpb24odGhpcywgYXN5bmMgKCkgPT4ge1xuICAgICAgYXdhaXQgdGhpcy5fdHJhbnNhY3Rpb25zQWN0aW9uc011dGV4LnN5bmMoYXN5bmMgKCkgPT4ge1xuICAgICAgICBhd2FpdCB0aGlzLl9yb2xsYmFja1NhdmVQb2ludEFjdGlvbihzYXZlUG9pbnROYW1lLCBvcHRpb25zKVxuICAgICAgfSlcbiAgICB9LCBvcHRpb25zLm9wZXJhdGlvbk93bmVyKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgcm9sbGJhY2sgc2F2ZSBwb2ludCBhY3Rpb24uXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBzYXZlUG9pbnROYW1lIC0gU2F2ZSBwb2ludCBuYW1lLlxuICAgKiBAcGFyYW0ge1BpY2s8UXVlcnlPcHRpb25zLCBcIm9wZXJhdGlvbk93bmVyXCI+fSBbb3B0aW9uc10gLSBUcmFuc2FjdGlvbiBvd25lcnNoaXAuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIHdoZW4gY29tcGxldGUuXG4gICAqL1xuICBhc3luYyBfcm9sbGJhY2tTYXZlUG9pbnRBY3Rpb24oc2F2ZVBvaW50TmFtZSwgb3B0aW9ucyA9IHt9KSB7XG4gICAgYXdhaXQgdGhpcy5xdWVyeShgUk9MTEJBQ0sgVE8gU0FWRVBPSU5UICR7c2F2ZVBvaW50TmFtZX1gLCBvcHRpb25zKVxuICB9XG5cbiAgLyoqXG4gICAqIFRydW5jYXRlcyB0aGUgZ2l2ZW4gdGFibGUgc25hcHNob3QuIERyaXZlcnMgY2FuIG92ZXJyaWRlIHRoaXMgdG8gaXNzdWUgb25lIGJhdGNoLlxuICAgKiBAcHJvdGVjdGVkXG4gICAqIEBwYXJhbSB7QXJyYXk8aW1wb3J0KFwiLi9iYXNlLXRhYmxlLmpzXCIpLmRlZmF1bHQ+fSB0YWJsZXMgLSBFbGlnaWJsZSB0YWJsZXMgZm9yIHRoaXMgY2xlYW51cCBhdHRlbXB0LlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyB3aGVuIGV2ZXJ5IHRhYmxlIGhhcyBiZWVuIGNsZWFuZWQuXG4gICAqL1xuICBhc3luYyB0cnVuY2F0ZVRhYmxlcyh0YWJsZXMpIHtcbiAgICBjb25zdCB0cnVuY2F0ZUVycm9ycyA9IFtdXG5cbiAgICBmb3IgKGNvbnN0IHRhYmxlIG9mIHRhYmxlcykge1xuICAgICAgdHJ5IHtcbiAgICAgICAgYXdhaXQgdGFibGUudHJ1bmNhdGUoe2Nhc2NhZGU6IHRydWV9KVxuICAgICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgICAgdHJ1bmNhdGVFcnJvcnMucHVzaChlcnJvcilcbiAgICAgIH1cbiAgICB9XG5cbiAgICBpZiAodHJ1bmNhdGVFcnJvcnMubGVuZ3RoID4gMCkgdGhyb3cgdHJ1bmNhdGVFcnJvcnNbMF1cbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHRydW5jYXRlIGFsbCB0YWJsZXMuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIHdoZW4gY29tcGxldGUuXG4gICAqL1xuICBhc3luYyB0cnVuY2F0ZUFsbFRhYmxlcygpIHtcbiAgICB0aGlzLl9hc3NlcnROb3RSZWFkT25seSgpXG4gICAgbGV0IHRhYmxlcyA9IChhd2FpdCB0aGlzLmdldFRhYmxlcygpKS5maWx0ZXIoKHRhYmxlKSA9PiB0YWJsZS5nZXROYW1lKCkgIT0gXCJzY2hlbWFfbWlncmF0aW9uc1wiKVxuXG4gICAgaWYgKHRhYmxlcy5sZW5ndGggPT0gMCkgcmV0dXJuXG5cbiAgICBhd2FpdCB0aGlzLndpdGhEaXNhYmxlZEZvcmVpZ25LZXlzKGFzeW5jICgpID0+IHtcbiAgICAgIGZvciAobGV0IHRyaWVzID0gMTsgdHJpZXMgPD0gNjsgdHJpZXMrKykge1xuICAgICAgICB0cnkge1xuICAgICAgICAgIGF3YWl0IHRoaXMudHJ1bmNhdGVUYWJsZXModGFibGVzKVxuICAgICAgICAgIHJldHVyblxuICAgICAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgICAgIGNvbnNvbGUuZXJyb3IoZXJyb3IpXG5cbiAgICAgICAgICBpZiAodHJpZXMgPT0gNikgdGhyb3cgZXJyb3JcblxuICAgICAgICAgIC8vIEEgdHJ1bmNhdGUgZmFpbGVkIOKAlCB0aGUgc2NoZW1hIGNhY2hlIG1heSBzdGlsbCBsaXN0IGEgdGFibGUgdGhhdCB3YXNcbiAgICAgICAgICAvLyBkcm9wcGVkIG91dCBmcm9tIHVuZGVyIHVzIChlLmcuIGEgZGI6cm9sbGJhY2sgdGVzdCB0aGF0IGxlZnQgdGhlXG4gICAgICAgICAgLy8gc2hhcmVkIERCIHJvbGxlZCBiYWNrKS4gQ2xlYXIgaXQgc28gdGhlIG5leHQgcGFzcyByZS1yZWFkcyB0aGUgbGl2ZVxuICAgICAgICAgIC8vIHRhYmxlIGxpc3QgYW5kIG5vIGxvbmdlciB0cmllcyB0byB0cnVuY2F0ZSBhIHRhYmxlIHRoYXQgaXMgZ29uZS5cbiAgICAgICAgICB0aGlzLmNsZWFyU2NoZW1hQ2FjaGUoKVxuICAgICAgICAgIHRhYmxlcyA9IChhd2FpdCB0aGlzLmdldFRhYmxlcygpKS5maWx0ZXIoKHRhYmxlKSA9PiB0YWJsZS5nZXROYW1lKCkgIT0gXCJzY2hlbWFfbWlncmF0aW9uc1wiKVxuXG4gICAgICAgICAgaWYgKHRhYmxlcy5sZW5ndGggPT0gMCkgcmV0dXJuXG4gICAgICAgIH1cbiAgICAgIH1cbiAgICB9KVxuICAgIGF3YWl0IHRoaXMuZmx1c2hQZW5kaW5nV3JpdGVzKClcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHVwZGF0ZS5cbiAgICogQHBhcmFtIHtVcGRhdGVTcWxBcmdzVHlwZX0gYXJncyAtIE9wdGlvbnMgb2JqZWN0LlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyB3aGVuIGNvbXBsZXRlLlxuICAgKi9cbiAgYXN5bmMgdXBkYXRlKGFyZ3MpIHtcbiAgICB0aGlzLl9hc3NlcnROb3RSZWFkT25seSgpXG4gICAgY29uc3Qgc3FsID0gdGhpcy51cGRhdGVTcWwoYXJncylcblxuICAgIGF3YWl0IHRoaXMucXVlcnkoc3FsKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgdXBkYXRlIHNxbC5cbiAgICogQGFic3RyYWN0XG4gICAqIEBwYXJhbSB7VXBkYXRlU3FsQXJnc1R5cGV9IGFyZ3MgLSBPcHRpb25zIG9iamVjdC5cbiAgICogQHJldHVybnMge3N0cmluZ30gLSBTUUwgc3RyaW5nLlxuICAgKi9cbiAgdXBkYXRlU3FsKGFyZ3MpIHsgLy8gZXNsaW50LWRpc2FibGUtbGluZSBuby11bnVzZWQtdmFyc1xuICAgIHRocm93IG5ldyBFcnJvcihcIidkaXNhYmxlRm9yZWlnbktleXMnIG5vdCBpbXBsZW1lbnRlZFwiKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgdXBzZXJ0IHNxbC5cbiAgICogQGFic3RyYWN0XG4gICAqIEBwYXJhbSB7VXBzZXJ0U3FsQXJnc1R5cGV9IGFyZ3MgLSBPcHRpb25zIG9iamVjdC5cbiAgICogQHJldHVybnMge3N0cmluZ30gLSBTUUwgc3RyaW5nLlxuICAgKi9cbiAgdXBzZXJ0U3FsKGFyZ3MpIHsgLy8gZXNsaW50LWRpc2FibGUtbGluZSBuby11bnVzZWQtdmFyc1xuICAgIHRocm93IG5ldyBFcnJvcihcIid1cHNlcnRTcWwnIG5vdCBpbXBsZW1lbnRlZFwiKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZGlzYWJsZSBmb3JlaWduIGtleXMuXG4gICAqIEBhYnN0cmFjdFxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyB3aGVuIGNvbXBsZXRlLlxuICAgKi9cbiAgZGlzYWJsZUZvcmVpZ25LZXlzKCkge1xuICAgIHRocm93IG5ldyBFcnJvcihcIidkaXNhYmxlRm9yZWlnbktleXMnIG5vdCBpbXBsZW1lbnRlZFwiKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZW5hYmxlIGZvcmVpZ24ga2V5cy5cbiAgICogQGFic3RyYWN0XG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIHdoZW4gY29tcGxldGUuXG4gICAqL1xuICBlbmFibGVGb3JlaWduS2V5cygpIHtcbiAgICB0aHJvdyBuZXcgRXJyb3IoXCInZW5hYmxlRm9yZWlnbktleXMnIG5vdCBpbXBsZW1lbnRlZFwiKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgd2l0aCBkaXNhYmxlZCBmb3JlaWduIGtleXMuXG4gICAqIEBwYXJhbSB7KCkgPT4gdm9pZH0gY2FsbGJhY2sgLSBDYWxsYmFjayBmdW5jdGlvbi5cbiAgICogQHJldHVybnMge1Byb21pc2U8UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSAtIFJlc29sdmVzIHdpdGggdGhlIHdpdGggZGlzYWJsZWQgZm9yZWlnbiBrZXlzLlxuICAgKi9cbiAgYXN5bmMgd2l0aERpc2FibGVkRm9yZWlnbktleXMoY2FsbGJhY2spIHtcbiAgICBhd2FpdCB0aGlzLmRpc2FibGVGb3JlaWduS2V5cygpXG5cbiAgICB0cnkge1xuICAgICAgcmV0dXJuIGF3YWl0IGNhbGxiYWNrKClcbiAgICB9IGZpbmFsbHkge1xuICAgICAgYXdhaXQgdGhpcy5lbmFibGVGb3JlaWduS2V5cygpXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIEJsb2NrcyB1bnRpbCBhIG5hbWVkIGFkdmlzb3J5IGxvY2sgaXMgYWNxdWlyZWQgb24gdGhpcyBjb25uZWN0aW9uLlxuICAgKiBBZHZpc29yeSBsb2NrcyBhcmUgY29ubmVjdGlvbi1zY29wZWQgYW5kIGRvIG5vdCBpbnRlcmFjdCB3aXRoIHJvdyBvclxuICAgKiB0YWJsZSBsb2NrczsgdGhleSBhcmUgcHVyZWx5IGNvb3BlcmF0aXZlIGJldHdlZW4gY2FsbGVycyB0aGF0IHVzZSB0aGVcbiAgICogc2FtZSBuYW1lIGFuZCBsZXQgeW91IHNlcmlhbGl6ZSBmdW5jdGlvbmFsaXR5IHdpdGhvdXQgYmxvY2tpbmcgcmVhZGVyc1xuICAgKiBvciB3cml0ZXJzIHRoYXQgZG8gbm90IHBhcnRpY2lwYXRlIGluIHRoZSBzYW1lIGxvY2suXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBuYW1lIC0gTG9jayBuYW1lLlxuICAgKiBAcGFyYW0ge3t0aW1lb3V0TXM/OiBudW1iZXIgfCBudWxsfX0gW2FyZ3NdIC0gT3B0aW9uYWwgdGltZW91dCBpbiBtaWxsaXNlY29uZHM7IGBudWxsYCBvciB1bmRlZmluZWQgYmxvY2tzIGZvcmV2ZXIuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPGJvb2xlYW4+fSAtIFJlc29sdmVzIHRvIHRydWUgd2hlbiB0aGUgbG9jayBoYXMgYmVlbiBhY3F1aXJlZCwgZmFsc2UgaWYgdGhlIHRpbWVvdXQgZWxhcHNlZC5cbiAgICovXG4gIGFzeW5jIGFjcXVpcmVBZHZpc29yeUxvY2sobmFtZSwgYXJncyA9IHt9KSB7XG4gICAgY29uc3QgYWNxdWlyZWQgPSBhd2FpdCB0aGlzLl9hY3F1aXJlQWR2aXNvcnlMb2NrKG5hbWUsIGFyZ3MpXG5cbiAgICBpZiAoYWNxdWlyZWQpIHRoaXMuX3RyYWNrQWR2aXNvcnlMb2NrKG5hbWUpXG5cbiAgICByZXR1cm4gYWNxdWlyZWRcbiAgfVxuXG4gIC8qKlxuICAgKiBEcml2ZXItc3BlY2lmaWMgYmxvY2tpbmcgYWR2aXNvcnktbG9jayBhY3F1aXNpdGlvbiBob29rLlxuICAgKiBAYWJzdHJhY3RcbiAgICogQHBhcmFtIHtzdHJpbmd9IG5hbWUgLSBMb2NrIG5hbWUuXG4gICAqIEBwYXJhbSB7e3RpbWVvdXRNcz86IG51bWJlciB8IG51bGx9fSBbX2FyZ3NdIC0gTG9jayB0aW1lb3V0IG9wdGlvbnMuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPGJvb2xlYW4+fSAtIFdoZXRoZXIgdGhlIGxvY2sgd2FzIGFjcXVpcmVkLlxuICAgKi9cbiAgX2FjcXVpcmVBZHZpc29yeUxvY2sobmFtZSwgX2FyZ3MgPSB7fSkge1xuICAgIHRocm93IG5ldyBFcnJvcihgJ19hY3F1aXJlQWR2aXNvcnlMb2NrJyBub3QgaW1wbGVtZW50ZWQgZm9yICR7dGhpcy5jb25zdHJ1Y3Rvci5uYW1lfWApXG4gIH1cblxuICAvKipcbiAgICogQXR0ZW1wdHMgdG8gYWNxdWlyZSBhIG5hbWVkIGFkdmlzb3J5IGxvY2sgd2l0aG91dCBibG9ja2luZy5cbiAgICogQHBhcmFtIHtzdHJpbmd9IG5hbWUgLSBMb2NrIG5hbWUuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPGJvb2xlYW4+fSAtIFJlc29sdmVzIHRvIHRydWUgaWYgdGhlIGxvY2sgd2FzIGFjcXVpcmVkLCBmYWxzZSBpZiBpdCB3YXMgYWxyZWFkeSBoZWxkLlxuICAgKi9cbiAgYXN5bmMgdHJ5QWNxdWlyZUFkdmlzb3J5TG9jayhuYW1lKSB7XG4gICAgY29uc3QgYWNxdWlyZWQgPSBhd2FpdCB0aGlzLl90cnlBY3F1aXJlQWR2aXNvcnlMb2NrKG5hbWUpXG5cbiAgICBpZiAoYWNxdWlyZWQpIHRoaXMuX3RyYWNrQWR2aXNvcnlMb2NrKG5hbWUpXG5cbiAgICByZXR1cm4gYWNxdWlyZWRcbiAgfVxuXG4gIC8qKlxuICAgKiBEcml2ZXItc3BlY2lmaWMgbm9uLWJsb2NraW5nIGFkdmlzb3J5LWxvY2sgYWNxdWlzaXRpb24gaG9vay5cbiAgICogQGFic3RyYWN0XG4gICAqIEBwYXJhbSB7c3RyaW5nfSBuYW1lIC0gTG9jayBuYW1lLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxib29sZWFuPn0gLSBXaGV0aGVyIHRoZSBsb2NrIHdhcyBhY3F1aXJlZC5cbiAgICovXG4gIF90cnlBY3F1aXJlQWR2aXNvcnlMb2NrKG5hbWUpIHsgLy8gZXNsaW50LWRpc2FibGUtbGluZSBuby11bnVzZWQtdmFyc1xuICAgIHRocm93IG5ldyBFcnJvcihgJ190cnlBY3F1aXJlQWR2aXNvcnlMb2NrJyBub3QgaW1wbGVtZW50ZWQgZm9yICR7dGhpcy5jb25zdHJ1Y3Rvci5uYW1lfWApXG4gIH1cblxuICAvKipcbiAgICogUmVsZWFzZXMgYSBuYW1lZCBhZHZpc29yeSBsb2NrIHByZXZpb3VzbHkgYWNxdWlyZWQgb24gdGhpcyBjb25uZWN0aW9uLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gbmFtZSAtIExvY2sgbmFtZS5cbiAgICogQHJldHVybnMge1Byb21pc2U8Ym9vbGVhbj59IC0gUmVzb2x2ZXMgdG8gdHJ1ZSBpZiB0aGUgbG9jayB3YXMgaGVsZCBieSB0aGlzIHNlc3Npb24gYW5kIGhhcyBub3cgYmVlbiByZWxlYXNlZC5cbiAgICovXG4gIGFzeW5jIHJlbGVhc2VBZHZpc29yeUxvY2sobmFtZSkge1xuICAgIGNvbnN0IHJlbGVhc2VkID0gYXdhaXQgdGhpcy5fcmVsZWFzZUFkdmlzb3J5TG9jayhuYW1lKVxuXG4gICAgaWYgKHJlbGVhc2VkKSB7XG4gICAgICB0aGlzLl91bnRyYWNrQWR2aXNvcnlMb2NrKG5hbWUpXG4gICAgfSBlbHNlIHtcbiAgICAgIHRoaXMuX2hlbGRBZHZpc29yeUxvY2tzLmRlbGV0ZShuYW1lKVxuICAgIH1cblxuICAgIHJldHVybiByZWxlYXNlZFxuICB9XG5cbiAgLyoqXG4gICAqIERyaXZlci1zcGVjaWZpYyBhZHZpc29yeS1sb2NrIHJlbGVhc2UgaG9vay5cbiAgICogQGFic3RyYWN0XG4gICAqIEBwYXJhbSB7c3RyaW5nfSBuYW1lIC0gTG9jayBuYW1lLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxib29sZWFuPn0gLSBXaGV0aGVyIHRoZSBsb2NrIHdhcyByZWxlYXNlZC5cbiAgICovXG4gIF9yZWxlYXNlQWR2aXNvcnlMb2NrKG5hbWUpIHsgLy8gZXNsaW50LWRpc2FibGUtbGluZSBuby11bnVzZWQtdmFyc1xuICAgIHRocm93IG5ldyBFcnJvcihgJ19yZWxlYXNlQWR2aXNvcnlMb2NrJyBub3QgaW1wbGVtZW50ZWQgZm9yICR7dGhpcy5jb25zdHJ1Y3Rvci5uYW1lfWApXG4gIH1cblxuICAvKipcbiAgICogUmVsZWFzZXMgZXZlcnkgYWR2aXNvcnkgbG9jayBzdGlsbCB0cmFja2VkIG9uIHRoaXMgY29ubmVjdGlvbi5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgd2hlbiBldmVyeSB0cmFja2VkIGxvY2sgaXMgcmVsZWFzZWQuXG4gICAqL1xuICBhc3luYyByZWxlYXNlSGVsZEFkdmlzb3J5TG9ja3MoKSB7XG4gICAgLyoqIEB0eXBlIHtFcnJvcltdfSAqL1xuICAgIGNvbnN0IGVycm9ycyA9IFtdXG5cbiAgICBmb3IgKGNvbnN0IG5hbWUgb2YgWy4uLnRoaXMuX2hlbGRBZHZpc29yeUxvY2tzLmtleXMoKV0pIHtcbiAgICAgIHdoaWxlICh0aGlzLl9oZWxkQWR2aXNvcnlMb2Nrcy5oYXMobmFtZSkpIHtcbiAgICAgICAgdHJ5IHtcbiAgICAgICAgICBhd2FpdCB0aGlzLnJlbGVhc2VBZHZpc29yeUxvY2sobmFtZSlcbiAgICAgICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgICAgICBlcnJvcnMucHVzaChlcnJvciBpbnN0YW5jZW9mIEVycm9yID8gZXJyb3IgOiBuZXcgRXJyb3IoYEZhaWxlZCB0byByZWxlYXNlIGFkdmlzb3J5IGxvY2sgJHtKU09OLnN0cmluZ2lmeShuYW1lKX1gLCB7Y2F1c2U6IGVycm9yfSkpXG4gICAgICAgICAgYnJlYWtcbiAgICAgICAgfVxuICAgICAgfVxuICAgIH1cblxuICAgIGlmIChlcnJvcnMubGVuZ3RoID09IDEpIHRocm93IGVycm9yc1swXVxuICAgIGlmIChlcnJvcnMubGVuZ3RoID4gMSkgdGhyb3cgbmV3IEFnZ3JlZ2F0ZUVycm9yKGVycm9ycywgXCJGYWlsZWQgdG8gcmVsZWFzZSBoZWxkIGFkdmlzb3J5IGxvY2tzXCIpXG4gIH1cblxuICAvKipcbiAgICogUmVjb3JkcyBvbmUgc3VjY2Vzc2Z1bCBhY3F1aXNpdGlvbiwgaW5jbHVkaW5nIHJlLWVudHJhbnQgYWNxdWlzaXRpb25zLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gbmFtZSAtIExvY2sgbmFtZS5cbiAgICogQHJldHVybnMge3ZvaWR9XG4gICAqL1xuICBfdHJhY2tBZHZpc29yeUxvY2sobmFtZSkge1xuICAgIHRoaXMuX2hlbGRBZHZpc29yeUxvY2tzLnNldChuYW1lLCAodGhpcy5faGVsZEFkdmlzb3J5TG9ja3MuZ2V0KG5hbWUpIHx8IDApICsgMSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSZW1vdmVzIG9uZSBzdWNjZXNzZnVsIGFjcXVpc2l0aW9uIGZyb20gdGhlIGNvbm5lY3Rpb24gcmVnaXN0cnkuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBuYW1lIC0gTG9jayBuYW1lLlxuICAgKiBAcmV0dXJucyB7dm9pZH1cbiAgICovXG4gIF91bnRyYWNrQWR2aXNvcnlMb2NrKG5hbWUpIHtcbiAgICBjb25zdCByZW1haW5pbmdDb3VudCA9ICh0aGlzLl9oZWxkQWR2aXNvcnlMb2Nrcy5nZXQobmFtZSkgfHwgMCkgLSAxXG5cbiAgICBpZiAocmVtYWluaW5nQ291bnQgPiAwKSB7XG4gICAgICB0aGlzLl9oZWxkQWR2aXNvcnlMb2Nrcy5zZXQobmFtZSwgcmVtYWluaW5nQ291bnQpXG4gICAgfSBlbHNlIHtcbiAgICAgIHRoaXMuX2hlbGRBZHZpc29yeUxvY2tzLmRlbGV0ZShuYW1lKVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBDaGVja3Mgd2hldGhlciBhIG5hbWVkIGFkdmlzb3J5IGxvY2sgaXMgY3VycmVudGx5IGhlbGQgYnkgYW55IHNlc3Npb24uXG4gICAqIEludGVuZGVkIGFzIGFuIGludHJvc3BlY3Rpb24gaGVscGVyOyBjYWxsZXJzIHdobyBuZWVkIHRvIGFjdCBvbiB0aGVcbiAgICogcmVzdWx0IHNob3VsZCBwcmVmZXIgYHRyeUFjcXVpcmVBZHZpc29yeUxvY2tgIHRvIGF2b2lkIGEgVE9DVE9VIHJhY2UuXG4gICAqIEBhYnN0cmFjdFxuICAgKiBAcGFyYW0ge3N0cmluZ30gbmFtZSAtIExvY2sgbmFtZS5cbiAgICogQHJldHVybnMge1Byb21pc2U8Ym9vbGVhbj59IC0gUmVzb2x2ZXMgdG8gdHJ1ZSBpZiB0aGUgbG9jayBpcyBoZWxkIGJ5ID8gc2Vzc2lvbi5cbiAgICovXG4gIGlzQWR2aXNvcnlMb2NrSGVsZChuYW1lKSB7IC8vIGVzbGludC1kaXNhYmxlLWxpbmUgbm8tdW51c2VkLXZhcnNcbiAgICB0aHJvdyBuZXcgRXJyb3IoYCdpc0Fkdmlzb3J5TG9ja0hlbGQnIG5vdCBpbXBsZW1lbnRlZCBmb3IgJHt0aGlzLmNvbnN0cnVjdG9yLm5hbWV9YClcbiAgfVxufVxuIl19