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
import { DEFAULT_ADVISORY_LOCK_ACQUIRE_TIMEOUT_MS } from "../advisory-lock-bound.js";
import { advisoryLockTelemetryThresholds, emitAdvisoryLockTelemetryReport } from "../advisory-lock-telemetry.js";
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
/** First backoff between retries of a schema-metadata read blocked by concurrent online DDL. */
const SCHEMA_METADATA_RETRY_INITIAL_DELAY_MS = 250;
/** Largest backoff between retries of a schema-metadata read blocked by concurrent online DDL. */
const SCHEMA_METADATA_RETRY_MAX_DELAY_MS = 2000;
/** Default bounded deadline for outlasting a concurrent online-DDL metadata skip. */
const SCHEMA_METADATA_RETRY_DEADLINE_MS = 60000;
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
     * When each tracked advisory lock was first acquired, so the final release can
     * report a hold that outlived `advisoryLockTelemetry.slowHoldMs`.
     * @type {Map<string, number>}
     */
    _advisoryLockAcquiredAtByName = new Map();
    /**
     * Stable per-connection holder identity used by advisory-lock telemetry when
     * the tier can only name local holders.
     * @type {string | undefined}
     */
    _advisoryLockHolderId = undefined;
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
     * Runs schema metadata retry deadline ms.
     * @returns {number} - Bounded deadline for outlasting transient schema-metadata contention.
     */
    _schemaMetadataRetryDeadlineMs() {
        const configured = this.getArgs().schemaMetadataRetryDeadlineMs;
        return typeof configured === "number" ? configured : SCHEMA_METADATA_RETRY_DEADLINE_MS;
    }
    /**
     * Whether an error raised by a schema-metadata read is transient contention that a bounded
     * retry can outlast. Drivers override this for their own contention signatures; the default
     * treats every failure as final so only drivers that prove the transient shape retry it.
     * @param {unknown} _error - Error raised by a schema-metadata read.
     * @returns {boolean} - Whether the read may be retried.
     */
    _isTransientSchemaMetadataError(_error) {
        return false;
    }
    /**
     * Runs a schema-metadata read, retrying transient concurrent-DDL contention until the bounded
     * deadline. Non-transient failures and exhausted deadlines propagate the original error.
     * @template T
     * @param {() => Promise<T>} callback - Cache-miss schema read.
     * @returns {Promise<T>} - Resolves with the read result.
     */
    async _withSchemaMetadataDdlRetry(callback) {
        const deadlineMs = this._schemaMetadataRetryDeadlineMs();
        const startedAt = Date.now();
        let delayMs = SCHEMA_METADATA_RETRY_INITIAL_DELAY_MS;
        for (;;) {
            try {
                return await callback();
            }
            catch (error) {
                if (!this._isTransientSchemaMetadataError(error))
                    throw error;
                if (Date.now() - startedAt + delayMs > deadlineMs)
                    throw error;
                await wait(delayMs);
                delayMs = Math.min(delayMs * 2, SCHEMA_METADATA_RETRY_MAX_DELAY_MS);
            }
        }
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
            return await this._withSchemaMetadataDdlRetry(callback);
        const existingPromise = this._schemaCache.get(cacheKey);
        if (existingPromise) {
            return /** @type {T} */ (this._schemaCacheReturnValue(await existingPromise));
        }
        const promise = (async () => await this._withSchemaMetadataDdlRetry(callback))();
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
        const tables = (await this.getTables()).filter((table) => table.getName() != "schema_migrations");
        if (tables.length == 0)
            return;
        await this._truncateAllTables(tables);
        await this.flushPendingWrites();
    }
    /**
     * Owns the foreign-key boundary around every cleanup retry. Drivers that
     * require one physical request for the full operation may override it.
     * @protected
     * @param {Array<import("./base-table.js").default>} tables - Eligible tables.
     * @returns {Promise<void>} - Resolves after cleanup succeeds.
     */
    async _truncateAllTables(tables) {
        await this.withDisabledForeignKeys(async () => {
            await this._truncateAllTablesWithRetries(tables);
        });
    }
    /**
     * Retries cleanup against refreshed schema snapshots. Drivers may override
     * `_truncateAllTablesAttempt` to own a complete driver-specific attempt.
     * @protected
     * @param {Array<import("./base-table.js").default>} initialTables - Initial eligible tables.
     * @returns {Promise<void>} - Resolves after one cleanup attempt succeeds.
     */
    async _truncateAllTablesWithRetries(initialTables) {
        let tables = initialTables;
        for (let tries = 1; tries <= 6; tries++) {
            try {
                await this._truncateAllTablesAttempt(tables);
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
    }
    /**
     * Runs one cleanup attempt while the default owner has constraints disabled.
     * @protected
     * @param {Array<import("./base-table.js").default>} tables - Current eligible tables.
     * @returns {Promise<void>} - Resolves when the attempt completes.
     */
    async _truncateAllTablesAttempt(tables) {
        await this.truncateTables(tables);
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
     * @param {{timeoutMs?: number | null}} [args] - Optional timeout in milliseconds; `null` blocks forever, and an omitted value uses the database's `advisoryLockAcquireTimeoutMs` or the framework default.
     * @returns {Promise<boolean>} - Resolves to true when the lock has been acquired, false if the timeout elapsed.
     */
    async acquireAdvisoryLock(name, args = {}) {
        const timeoutMs = this.advisoryLockAcquireTimeoutMs(args);
        const startedAt = Date.now();
        const acquired = await this._acquireAdvisoryLock(name, { timeoutMs });
        const durationMs = Date.now() - startedAt;
        if (acquired) {
            this._trackAdvisoryLock(name);
            const slowAcquireMs = advisoryLockTelemetryThresholds(this.getArgs()).slowAcquireMs;
            if (slowAcquireMs !== null && durationMs > slowAcquireMs) {
                await this._reportAdvisoryLockTelemetry({ event: "advisory-lock-slow-acquire", lockName: name, durationMs, outcome: "acquired", timeoutMs });
            }
        }
        else {
            // The wait exceeded its bound: attribute the lock to the holder that
            // blocked it, captured at this moment on this tier.
            await this._reportAdvisoryLockTelemetry({ event: "advisory-lock-acquire-timeout", lockName: name, durationMs, outcome: "timeout", timeoutMs, captureHolder: true });
        }
        return acquired;
    }
    /**
     * Resolves the wait bound for one advisory-lock acquisition.
     * An explicit `timeoutMs` — including an explicit `null` opt-out — always
     * wins. Otherwise the database configuration's `advisoryLockAcquireTimeoutMs`
     * applies, and a null there opts out too. Only when neither is configured does
     * the framework default bound the wait.
     * @param {{timeoutMs?: number | null}} [args] - Acquisition options from the caller.
     * @returns {number | null} - Wait bound in milliseconds, or `null` for an indefinite wait.
     */
    advisoryLockAcquireTimeoutMs(args = {}) {
        if (args.timeoutMs !== undefined)
            return args.timeoutMs;
        const configured = this.getArgs()?.advisoryLockAcquireTimeoutMs;
        if (configured === null)
            return null;
        if (typeof configured === "number" && configured >= 0)
            return configured;
        return DEFAULT_ADVISORY_LOCK_ACQUIRE_TIMEOUT_MS;
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
        if (!this._heldAdvisoryLocks.has(name)) {
            const acquiredAt = this._advisoryLockAcquiredAtByName.get(name);
            this._advisoryLockAcquiredAtByName.delete(name);
            if (acquiredAt !== undefined) {
                const holdDurationMs = Date.now() - acquiredAt;
                const slowHoldMs = advisoryLockTelemetryThresholds(this.getArgs()).slowHoldMs;
                if (slowHoldMs !== null && holdDurationMs > slowHoldMs) {
                    await this._reportAdvisoryLockTelemetry({ event: "advisory-lock-slow-hold", lockName: name, durationMs: holdDurationMs, outcome: null, timeoutMs: null });
                }
            }
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
        if (!this._advisoryLockAcquiredAtByName.has(name))
            this._advisoryLockAcquiredAtByName.set(name, Date.now());
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
    /**
     * Which advisory-lock backend tier this connection serves (STC-210 chain
     * naming). The base driver is the driver-native tier; the SQLite drivers
     * override to `process-local` / `file`.
     * @returns {string} - Tier name reported on telemetry payloads.
     */
    advisoryLockBackendTier() {
        return "driver-native";
    }
    /**
     * Stable identity of this connection as a lock holder, reported on
     * telemetry payloads so a slow acquire/hold is attributable to the reporting
     * connection itself.
     * @returns {string} - Holder id.
     */
    advisoryLockHolderId() {
        if (!this._advisoryLockHolderId)
            this._advisoryLockHolderId = `advisory-lock-holder:${new UUID(4).format()}`;
        return this._advisoryLockHolderId;
    }
    /**
     * Best-effort identity of the connection currently holding the named lock,
     * captured on the tier that served the acquisition. The base driver has no
     * portable server-side lookup; MySQL/PostgreSQL/SQL Server/Node-SQLite
     * override with their tier's holder attribution.
     * @param {string} name - Lock name.
     * @returns {Promise<string | null>} - Holder connection identity, or null when the tier cannot attribute it.
     */
    async advisoryLockHolderConnectionId(name) {
        return null;
    }
    /**
     * Emit one event-driven advisory-lock telemetry report (slow acquire,
     * acquire timeout with holder attribution, slow hold). The holder lookup is
     * best-effort: a failed lookup is recorded on the report and never affects
     * the acquisition that already settled.
     * @param {{event: "advisory-lock-slow-acquire" | "advisory-lock-acquire-timeout" | "advisory-lock-slow-hold", lockName: string, durationMs: number, outcome: "acquired" | "timeout" | null, timeoutMs: number | null, captureHolder?: boolean}} args - Report args.
     * @returns {Promise<void>} - Resolves after the report is emitted.
     */
    async _reportAdvisoryLockTelemetry(args) {
        /** @type {import("../advisory-lock-telemetry.js").AdvisoryLockTelemetryReport} */
        const report = {
            event: args.event,
            lockName: args.lockName,
            backendTier: this.advisoryLockBackendTier(),
            durationMs: args.durationMs,
            outcome: args.outcome,
            timeoutMs: args.timeoutMs,
            holderId: this.advisoryLockHolderId(),
            holderConnectionId: null,
            holderLookupError: null
        };
        if (args.captureHolder) {
            try {
                report.holderConnectionId = await this.advisoryLockHolderConnectionId(args.lockName);
            }
            catch (error) {
                report.holderLookupError = error instanceof Error ? error.message : String(error);
            }
        }
        emitAdvisoryLockTelemetryReport(this.configuration, report);
    }
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiYmFzZS5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uLy4uLy4uLy4uL3NyYy9kYXRhYmFzZS9kcml2ZXJzL2Jhc2UuanMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6IkFBQUEsWUFBWTtBQUVaOzs7Ozs7OztHQVFHO0FBQ0g7Ozs7O0dBS0c7QUFDSDs7Ozs7R0FLRztBQUNIOzs7OztHQUtHO0FBQ0g7Ozs7Ozs7OztHQVNHO0FBQ0g7Ozs7R0FJRztBQUNIOzs7OztHQUtHO0FBQ0g7Ozs7Ozs7OztHQVNHO0FBQ0g7Ozs7Ozs7Ozs7Ozs7R0FhRztBQUVIOzs7Ozs7Ozs7Ozs7Ozs7OztHQWlCRztBQUVIOzs7Ozs7R0FNRztBQUVIOzs7Ozs7OztHQVFHO0FBRUg7Ozs7Ozs7Ozs7O0dBV0c7QUFFSDs7Ozs7OztHQU9HO0FBRUg7Ozs7OztHQU1HO0FBQ0g7Ozs7Ozs7R0FPRztBQUVIOzs7Ozs7R0FNRztBQUVILE9BQU8sZ0JBQWdCLE1BQU0sa0NBQWtDLENBQUE7QUFDL0QsT0FBTyxFQUFFLHNCQUFzQixFQUFFLE1BQU0sbUJBQW1CLENBQUE7QUFDMUQsT0FBTyxFQUFFLHFCQUFxQixFQUFFLE1BQU0sd0JBQXdCLENBQUE7QUFDOUQsT0FBTyxNQUFNLE1BQU0sd0JBQXdCLENBQUE7QUFDM0MsT0FBTyxFQUFDLHdDQUF3QyxFQUFDLE1BQU0sMkJBQTJCLENBQUE7QUFDbEYsT0FBTyxFQUFDLCtCQUErQixFQUFFLCtCQUErQixFQUFDLE1BQU0sK0JBQStCLENBQUE7QUFDOUcsT0FBTyxNQUFNLE1BQU0saUJBQWlCLENBQUE7QUFDcEMsT0FBTyxLQUFLLE1BQU0sbUJBQW1CLENBQUE7QUFDckMsT0FBTyxpQkFBaUIsTUFBTSwyQkFBMkIsQ0FBQTtBQUN6RCxPQUFPLE9BQU8sTUFBTSxlQUFlLENBQUE7QUFDbkMsT0FBTyxFQUFFLGNBQWMsRUFBRSxNQUFNLGlDQUFpQyxDQUFBO0FBQ2hFLE9BQU8sS0FBSyxNQUFNLDJCQUEyQixDQUFBO0FBQzdDLE9BQU8sSUFB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dkIsV0FBVyxFQUFFLElBQUksQ0FBQyx1QkFBdUIsRUFBRTtZQUMzQyxVQUFVLEVBQUUsSUFBSSxDQUFDLFVBQVU7WUFDM0IsT0FBTyxFQUFFLElBQUksQ0FBQyxPQUFPO1lBQ3JCLFNBQVMsRUFBRSxJQUFJLENBQUMsU0FBUztZQUN6QixRQUFRLEVBQUUsSUFBSSxDQUFDLG9CQUFvQixFQUFFO1lBQ3JDLGtCQUFrQixFQUFFLElBQUk7WUFDeEIsaUJBQWlCLEVBQUUsSUFBSTtTQUN4QixDQUFBO1FBRUQsSUFBSSxJQUFJLENBQUMsYUFBYSxFQUFFLENBQUM7WUFDdkIsSUFBSSxDQUFDO2dCQUNILE1BQU0sQ0FBQyxrQkFBa0IsR0FBRyxNQUFNLElBQUksQ0FBQyw4QkFBOEIsQ0FBQyxJQUFJLENBQUMsUUFBUSxDQUFDLENBQUE7WUFDdEYsQ0FBQztZQUFDLE9BQU8sS0FBSyxFQUFFLENBQUM7Z0JBQ2YsTUFBTSxDQUFDLGlCQUFpQixHQUFHLEtBQUssWUFBWSxLQUFLLENBQUMsQ0FBQyxDQUFDLEtBQUssQ0FBQyxPQUFPLENBQUMsQ0FBQyxDQUFDLE1BQU0sQ0FBQyxLQUFLLENBQUMsQ0FBQTtZQUNuRixDQUFDO1FBQ0gsQ0FBQztRQUVELCtCQUErQixDQUFDLElBQUksQ0FBQyxhQUFhLEVBQUUsTUFBTSxDQUFDLENBQUE7SUFDN0QsQ0FBQztDQUNGIiwic291cmNlc0NvbnRlbnQiOlsiLy8gQHRzLWNoZWNrXG5cbi8qKlxuICogQ3JlYXRlSW5kZXhTcWxBcmdzIHR5cGUuXG4gKiBAdHlwZWRlZiB7b2JqZWN0fSBDcmVhdGVJbmRleFNxbEFyZ3NcbiAqIEBwcm9wZXJ0eSB7QXJyYXk8c3RyaW5nIHwgaW1wb3J0KFwiLi8uLi90YWJsZS1kYXRhL3RhYmxlLWNvbHVtbi5qc1wiKS5kZWZhdWx0Pn0gY29sdW1ucyAtIENvbHVtbnMgdG8gaW5jbHVkZSBpbiB0aGUgaW5kZXguXG4gKiBAcHJvcGVydHkge2Jvb2xlYW59IFtpZk5vdEV4aXN0c10gLSBTa2lwIGNyZWF0aW9uIGlmIHRoZSBpbmRleCBhbHJlYWR5IGV4aXN0cy5cbiAqIEBwcm9wZXJ0eSB7c3RyaW5nfSBbbmFtZV0gLSBFeHBsaWNpdCBpbmRleCBuYW1lIHRvIHVzZS5cbiAqIEBwcm9wZXJ0eSB7Ym9vbGVhbn0gW3VuaXF1ZV0gLSBXaGV0aGVyIHRoZSBpbmRleCBzaG91bGQgZW5mb3JjZSB1bmlxdWVuZXNzLlxuICogQHByb3BlcnR5IHtzdHJpbmd9IHRhYmxlTmFtZSAtIE5hbWUgb2YgdGhlIHRhYmxlIHRvIGFkZCB0aGUgaW5kZXggdG8uXG4gKi9cbi8qKlxuICogUmVtb3ZlSW5kZXhTcWxBcmdzIHR5cGUuXG4gKiBAdHlwZWRlZiB7b2JqZWN0fSBSZW1vdmVJbmRleFNxbEFyZ3NcbiAqIEBwcm9wZXJ0eSB7c3RyaW5nfSBuYW1lIC0gSW5kZXggbmFtZSB0byBkcm9wLlxuICogQHByb3BlcnR5IHtzdHJpbmd9IHRhYmxlTmFtZSAtIE5hbWUgb2YgdGhlIHRhYmxlIHRoZSBpbmRleCBiZWxvbmdzIHRvLlxuICovXG4vKipcbiAqIERyb3BUYWJsZVNxbEFyZ3NUeXBlIHR5cGUuXG4gKiBAdHlwZWRlZiB7b2JqZWN0fSBEcm9wVGFibGVTcWxBcmdzVHlwZVxuICogQHByb3BlcnR5IHtib29sZWFufSBbY2FzY2FkZV0gLSBXaGV0aGVyIGRlcGVuZGVudCBvYmplY3RzIHNob3VsZCBiZSBkcm9wcGVkIHRvby5cbiAqIEBwcm9wZXJ0eSB7Ym9vbGVhbn0gW2lmRXhpc3RzXSAtIFNraXAgZHJvcHBpbmcgaWYgdGhlIHRhYmxlIGRvZXMgbm90IGV4aXN0LlxuICovXG4vKipcbiAqIERlbGV0ZVNxbEFyZ3NUeXBlIHR5cGUuXG4gKiBAdHlwZWRlZiB7b2JqZWN0fSBEZWxldGVTcWxBcmdzVHlwZVxuICogQHByb3BlcnR5IHtzdHJpbmd9IHRhYmxlTmFtZSAtIFRhYmxlIG5hbWUgdG8gZGVsZXRlIGZyb20uXG4gKiBAcHJvcGVydHkge3tba2V5OiBzdHJpbmddOiBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn19IGNvbmRpdGlvbnMgLSBDb25kaXRpb25zIHVzZWQgdG8gYnVpbGQgdGhlIGRlbGV0ZSBXSEVSRSBjbGF1c2UuXG4gKi9cbi8qKlxuICogSW5zZXJ0U3FsQXJnc1R5cGUgdHlwZS5cbiAqIEB0eXBlZGVmIHtvYmplY3R9IEluc2VydFNxbEFyZ3NUeXBlXG4gKiBAcHJvcGVydHkge3N0cmluZ1tdfSBbY29sdW1uc10gLSBDb2x1bW4gbmFtZXMgZm9yIGByb3dzYCBpbnNlcnRzLlxuICogQHByb3BlcnR5IHt7W2tleTogc3RyaW5nXTogUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59fSBbZGF0YV0gLSBDb2x1bW4vdmFsdWUgcGFpcnMgZm9yIGEgc2luZ2xlLXJvdyBpbnNlcnQuXG4gKiBAcHJvcGVydHkge2Jvb2xlYW59IFttdWx0aXBsZV0gLSBXaGV0aGVyIHRoaXMgaW5zZXJ0IHNob3VsZCBiZSB0cmVhdGVkIGFzIG11bHRpLXJvdy5cbiAqIEBwcm9wZXJ0eSB7c3RyaW5nW119IFtyZXR1cm5MYXN0SW5zZXJ0ZWRDb2x1bW5OYW1lc10gLSBDb2x1bW4gbmFtZXMgdG8gcmV0dXJuIGFmdGVyIGluc2VydC5cbiAqIEBwcm9wZXJ0eSB7QXJyYXk8QXJyYXk8UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+Pn0gW3Jvd3NdIC0gUm93IHZhbHVlcyBmb3IgYSBtdWx0aS1yb3cgaW5zZXJ0LlxuICogQHByb3BlcnR5IHtzdHJpbmd9IHRhYmxlTmFtZSAtIFRhYmxlIG5hbWUgdG8gaW5zZXJ0IGludG8uXG4gKi9cbi8qKlxuICogUXVlcnlSb3dUeXBlIHR5cGUuXG4gKiBAdHlwZWRlZiB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSBRdWVyeVJvd1R5cGVcbiAqIEB0eXBlZGVmIHtBcnJheTxRdWVyeVJvd1R5cGU+fSBRdWVyeVJlc3VsdFR5cGVcbiAqL1xuLyoqXG4gKiBUcmFuc2FjdGlvbkNhbGxiYWNrRnJhbWUgdHlwZS5cbiAqIEB0eXBlZGVmIHtvYmplY3R9IFRyYW5zYWN0aW9uQ2FsbGJhY2tGcmFtZVxuICogQHByb3BlcnR5IHtBcnJheTwoKSA9PiB2b2lkIHwgUHJvbWlzZTx2b2lkPj59IGFmdGVyQ29tbWl0Q2FsbGJhY2tzIC0gQ2FsbGJhY2tzIHRvIG1lcmdlIG9yIHJ1biBhZnRlciBjb21taXQuXG4gKiBAcHJvcGVydHkge0FycmF5PCgpID0+IHZvaWQgfCBQcm9taXNlPHZvaWQ+Pn0gYmVmb3JlQ29tbWl0Q2FsbGJhY2tzIC0gR3VhcmRzIHRvIHJ1biBiZWZvcmUgdGhpcyBmcmFtZSBjb21wbGV0ZXMuXG4gKi9cbi8qKlxuICogUmV0cnlhYmxlRGF0YWJhc2VFcnJvclJlc3VsdCB0eXBlLlxuICogQHR5cGVkZWYge29iamVjdH0gUmV0cnlhYmxlRGF0YWJhc2VFcnJvclJlc3VsdFxuICogQHByb3BlcnR5IHtib29sZWFufSByZXRyeSAtIFdoZXRoZXIgdGhlIGVycm9yIHNob3VsZCBiZSByZXRyaWVkLlxuICogQHByb3BlcnR5IHtib29sZWFufSByZWNvbm5lY3QgLSBXaGV0aGVyIHRvIHJlY29ubmVjdCBiZWZvcmUgcmV0cnlpbmcuXG4gKiBAcHJvcGVydHkge2Jvb2xlYW59IFtkZWFkbG9ja10gLSBXaGV0aGVyIHRoZSBlcnJvciBpcyBhIHRyYW5zYWN0aW9uIGRlYWRsb2NrL2xvY2std2FpdC10aW1lb3V0IHRoYXQgc2hvdWxkIHJldHJ5IHRoZSB3aG9sZSB0cmFuc2FjdGlvbi5cbiAqIEBwcm9wZXJ0eSB7XCJkZWFkbG9ja1wiIHwgXCJsb2NrLXdhaXQtdGltZW91dFwifSBbY29udGVudGlvbktpbmRdIC0gQ2xhc3NpZmllZCB0cmFuc2FjdGlvbiBjb250ZW50aW9uIGtpbmQuXG4gKiBAcHJvcGVydHkge251bWJlcn0gW21heFRyaWVzXSAtIE92ZXJyaWRlIHRoZSBtYXggcmV0cnkgYXR0ZW1wdHMuXG4gKiBAcHJvcGVydHkge251bWJlcn0gW3dhaXRNc10gLSBXYWl0IHRpbWUgYmVmb3JlIHJldHJ5aW5nIGluIG1pbGxpc2Vjb25kcy5cbiAqL1xuLyoqXG4gKiBRdWVyeU9wdGlvbnMgdHlwZS5cbiAqIEB0eXBlZGVmIHtvYmplY3R9IFF1ZXJ5T3B0aW9uc1xuICogQHByb3BlcnR5IHtzdHJpbmd9IFtsb2dOYW1lXSAtIFF1ZXJ5IGxvZyBzdWJqZWN0LlxuICogQHByb3BlcnR5IHtib29sZWFufSBbbG9nUXVlcnldIC0gV2hldGhlciB0byBsb2cgdGhlIHF1ZXJ5LlxuICogQHByb3BlcnR5IHtib29sZWFufSBbcHJvY2Vzc0xpc3RDb21tZW50XSAtIFdoZXRoZXIgdG8gYWRkIHByb2Nlc3MtbGlzdCBjb21tZW50cyB0byB0aGUgcXVlcnkuXG4gKiBAcHJvcGVydHkge251bWJlcn0gW3JlcXVlc3RUaW1lb3V0TXNdIC0gUGVyLXJlcXVlc3QgZHJpdmVyIHRpbWVvdXQgaW4gbWlsbGlzZWNvbmRzOyB6ZXJvIGRpc2FibGVzIHRoZSBkZWFkbGluZSBvbiBzdXBwb3J0aW5nIGRyaXZlcnMuXG4gKiBAcHJvcGVydHkge2Jvb2xlYW59IFtyZXRyeV0gLSBXaGV0aGVyIHJldHJ5YWJsZSBlcnJvcnMgbWF5IHJldHJ5IHRoZSBxdWVyeTsgZGVmYXVsdHMgdG8gdHJ1ZS5cbiAqIEBwcm9wZXJ0eSB7Ym9vbGVhbn0gW3Nlc3Npb25UaW1lWm9uZV0gLSBXaGV0aGVyIHRvIGVuc3VyZSB0aGUgY29uZmlndXJlZCBkYXRhYmFzZSBzZXNzaW9uIHRpbWUgem9uZSBiZWZvcmUgdGhlIHF1ZXJ5LlxuICogQHByb3BlcnR5IHtib29sZWFufSBbc3FsaXRlU2NyaXB0XSAtIEludGVybmFsIFNRTGl0ZSBmbGFnIHNlbGVjdGluZyBuYXRpdmUgbXVsdGktc3RhdGVtZW50IHNjcmlwdCBleGVjdXRpb24uXG4gKiBAcHJvcGVydHkge0Fib3J0U2lnbmFsfSBbc2lnbmFsXSAtIEFib3J0cyB0aGUgaW4tZmxpZ2h0IHF1ZXJ5IChkZXN0cm95aW5nIGl0cyBjb25uZWN0aW9uKSB3aGVuIGl0IGZpcmVzLlxuICogQHByb3BlcnR5IHtzdHJpbmd9IFtzb3VyY2VTdGFja10gLSBTdGFjayBjYXB0dXJlZCBhdCB0aGUgY2FsbGVyIGJvdW5kYXJ5LlxuICogQHByb3BlcnR5IHtzeW1ib2x9IFtvcGVyYXRpb25Pd25lcl0gLSBPcGFxdWUgb3duZXIgZm9yIGFuIG9wZXJhdGlvbi1sZWFzZWQgY29ubmVjdGlvbi5cbiAqL1xuXG4vKipcbiAqIERlYWRsb2NrUmV0cnlEaWFnbm9zdGljU25hcHNob3QgdHlwZS5cbiAqIEB0eXBlZGVmIHtvYmplY3R9IERlYWRsb2NrUmV0cnlEaWFnbm9zdGljU25hcHNob3RcbiAqIEBwcm9wZXJ0eSB7bnVtYmVyfSBhdHRlbXB0IC0gT25lLWJhc2VkIHRyYW5zYWN0aW9uIGF0dGVtcHQuXG4gKiBAcHJvcGVydHkge1wiZGVhZGxvY2tcIiB8IFwibG9jay13YWl0LXRpbWVvdXRcIn0gY29udGVudGlvbktpbmQgLSBDbGFzc2lmaWVkIGNvbnRlbnRpb24ga2luZC5cbiAqIEBwcm9wZXJ0eSB7c3RyaW5nfSBbZGF0YWJhc2VJZGVudGlmaWVyXSAtIFJlZGFjdGVkIGxvZ2ljYWwgZGF0YWJhc2UgcG9vbCBpZGVudGlmaWVyIG1hcmtlci5cbiAqIEBwcm9wZXJ0eSB7c3RyaW5nfSBbZGF0YWJhc2VJZGVudGlmaWVyRmluZ2VycHJpbnRdIC0gT3BhcXVlIGxvZ2ljYWwgZGF0YWJhc2UgcG9vbCBpZGVudGl0eS5cbiAqIEBwcm9wZXJ0eSB7c3RyaW5nfSBbZGF0YWJhc2VJZGVudGl0eUZpbmdlcnByaW50XSAtIE9wYXF1ZSBwaHlzaWNhbCBkYXRhYmFzZSBpZGVudGl0eS5cbiAqIEBwcm9wZXJ0eSB7c3RyaW5nfSBkcml2ZXJUeXBlIC0gRHJpdmVyIHR5cGUuXG4gKiBAcHJvcGVydHkge251bWJlcn0gbWF4QXR0ZW1wdHMgLSBDb25maWd1cmVkIHRyYW5zYWN0aW9uIGF0dGVtcHQgYnVkZ2V0LlxuICogQHByb3BlcnR5IHtzdHJpbmd9IFtvcGVyYXRpb25OYW1lXSAtIFJlZGFjdGVkIG9wZXJhdGlvbi1uYW1lIG1hcmtlci5cbiAqIEBwcm9wZXJ0eSB7c3RyaW5nfSBbb3BlcmF0aW9uTmFtZUZpbmdlcnByaW50XSAtIE9wYXF1ZSBvcGVyYXRpb24tbmFtZSBpZGVudGl0eS5cbiAqIEBwcm9wZXJ0eSB7c3RyaW5nfSBbc3FsRmluZ2VycHJpbnRdIC0gTm9ybWFsaXplZCBTUUwtc2hhcGUgZmluZ2VycHJpbnQuXG4gKiBAcHJvcGVydHkge3N0cmluZ30gW3NxbE9wZXJhdGlvbl0gLSBTUUwgdmVyYi5cbiAqIEBwcm9wZXJ0eSB7c3RyaW5nfSBzdGFnZSAtIEVycm9yLWV2ZW50IHN0YWdlLlxuICogQHByb3BlcnR5IHtudW1iZXJ9IHRyYW5zYWN0aW9uQXR0ZW1wdER1cmF0aW9uTXMgLSBEdXJhdGlvbiBvZiB0aGUgZmFpbGVkIG91dGVyIGF0dGVtcHQuXG4gKiBAcHJvcGVydHkge2Jvb2xlYW59IHdpbGxSZXRyeSAtIFdoZXRoZXIgYW5vdGhlciBvdXRlciB0cmFuc2FjdGlvbiBhdHRlbXB0IHdpbGwgcnVuLlxuICovXG5cbi8qKlxuICogVGVzdFByb2ZpbGVRdWVyeUF0dGVtcHQgdHlwZS5cbiAqIEB0eXBlZGVmIHtvYmplY3R9IFRlc3RQcm9maWxlUXVlcnlBdHRlbXB0XG4gKiBAcHJvcGVydHkge2ltcG9ydChcIi4uLy4uL3Rlc3RpbmcvdGVzdC1wcm9maWxlci5qc1wiKS5UZXN0UHJvZmlsZUFzeW5jQ29udGV4dH0gY29udGV4dCAtIENhcHR1cmVkIGFzeW5jIGF0dHJpYnV0aW9uLlxuICogQHByb3BlcnR5IHt7c3FsRmluZ2VycHJpbnQ6IHN0cmluZywgc3FsT3BlcmF0aW9uOiBzdHJpbmd9fSBkaWFnbm9zdGljIC0gUmVkYWN0ZWQgc3RhdGVtZW50IGRpYWdub3N0aWMuXG4gKiBAcHJvcGVydHkge251bWJlcn0gc3RhcnRlZEF0TXMgLSBQaHlzaWNhbCBhdHRlbXB0IHN0YXJ0IHRpbWUuXG4gKi9cblxuLyoqXG4gKiBBY3RpdmVRdWVyeURlYnVnU25hcHNob3QgdHlwZS5cbiAqIEB0eXBlZGVmIHtvYmplY3R9IEFjdGl2ZVF1ZXJ5RGVidWdTbmFwc2hvdFxuICogQHByb3BlcnR5IHtzdHJpbmdbXX0gYW5ub3RhdGlvbnMgLSBEYXRhYmFzZSBhbm5vdGF0aW9ucyBhY3RpdmUgd2hlbiB0aGUgcXVlcnkgc3RhcnRlZC5cbiAqIEBwcm9wZXJ0eSB7c3RyaW5nfSBsb2dOYW1lIC0gUXVlcnkgbG9nIG5hbWUuXG4gKiBAcHJvcGVydHkge251bWJlcn0gc3RhcnRlZEF0VW5peE1zIC0gUXVlcnkgc3RhcnQgdGltZXN0YW1wLlxuICogQHByb3BlcnR5IHtudW1iZXJ9IHJ1bm5pbmdNcyAtIFF1ZXJ5IHJ1bnRpbWUgaW4gbWlsbGlzZWNvbmRzLlxuICogQHByb3BlcnR5IHtzdHJpbmd9IHNxbFByZXZpZXcgLSBUcnVuY2F0ZWQgU1FMIHByZXZpZXcuXG4gKi9cblxuLyoqXG4gKiBEYXRhYmFzZUNvbm5lY3Rpb25EZWJ1Z1NuYXBzaG90IHR5cGUuXG4gKiBAdHlwZWRlZiB7b2JqZWN0fSBEYXRhYmFzZUNvbm5lY3Rpb25EZWJ1Z1NuYXBzaG90XG4gKiBAcHJvcGVydHkge0FjdGl2ZVF1ZXJ5RGVidWdTbmFwc2hvdCB8IG51bGx9IGFjdGl2ZVF1ZXJ5IC0gQ3VycmVudGx5IHJ1bm5pbmcgcXVlcnksIGlmIGFueS5cbiAqIEBwcm9wZXJ0eSB7bnVtYmVyIHwgdW5kZWZpbmVkfSBjaGVja2VkT3V0QXRVbml4TXMgLSBDaGVja291dCBzdGFydCB0aW1lc3RhbXAgZm9yIGFjdGl2ZSBjaGVja291dHMuXG4gKiBAcHJvcGVydHkge251bWJlciB8IHVuZGVmaW5lZH0gY2hlY2tvdXRBZ2VNcyAtIEFjdGl2ZSBjaGVja291dCBhZ2UgaW4gbWlsbGlzZWNvbmRzLlxuICogQHByb3BlcnR5IHtzdHJpbmcgfCB1bmRlZmluZWR9IGNoZWNrb3V0TmFtZSAtIEh1bWFuLXJlYWRhYmxlIGNoZWNrb3V0IG5hbWUuXG4gKiBAcHJvcGVydHkge3N0cmluZ30gZHJpdmVyQ2xhc3MgLSBEcml2ZXIgY2xhc3MgbmFtZS5cbiAqIEBwcm9wZXJ0eSB7bnVtYmVyIHwgdW5kZWZpbmVkfSBpZFNlcSAtIFBvb2wgY2hlY2tvdXQgSUQgc2VxdWVuY2UuXG4gKiBAcHJvcGVydHkge251bWJlcn0gb3BlblRyYW5zYWN0aW9ucyAtIE51bWJlciBvZiBvcGVuIHRyYW5zYWN0aW9uIGZyYW1lcy5cbiAqIEBwcm9wZXJ0eSB7bnVtYmVyfSBzY2hlbWFDYWNoZUVudHJpZXMgLSBOdW1iZXIgb2YgY2FjaGVkIHNjaGVtYSBtZXRhZGF0YSBlbnRyaWVzLlxuICovXG5cbi8qKlxuICogQWN0aXZlUXVlcnlTdGF0ZSB0eXBlLlxuICogQHR5cGVkZWYge29iamVjdH0gQWN0aXZlUXVlcnlTdGF0ZVxuICogQHByb3BlcnR5IHtzdHJpbmdbXX0gYW5ub3RhdGlvbnMgLSBEYXRhYmFzZSBhbm5vdGF0aW9ucyBhY3RpdmUgd2hlbiB0aGUgcXVlcnkgc3RhcnRlZC5cbiAqIEBwcm9wZXJ0eSB7c3RyaW5nfSBsb2dOYW1lIC0gUXVlcnkgbG9nIG5hbWUuXG4gKiBAcHJvcGVydHkge251bWJlcn0gc3RhcnRlZEF0VW5peE1zIC0gUXVlcnkgc3RhcnQgdGltZXN0YW1wLlxuICogQHByb3BlcnR5IHtzdHJpbmd9IHNxbFByZXZpZXcgLSBUcnVuY2F0ZWQgU1FMIHByZXZpZXcuXG4gKi9cblxuLyoqXG4gKiBVcGRhdGVTcWxBcmdzVHlwZSB0eXBlLlxuICogQHR5cGVkZWYge29iamVjdH1VcGRhdGVTcWxBcmdzVHlwZVxuICogQHByb3BlcnR5IHtvYmplY3R9IGNvbmRpdGlvbnMgLSBDb25kaXRpb25zIHVzZWQgdG8gYnVpbGQgdGhlIHVwZGF0ZSBXSEVSRSBjbGF1c2UuXG4gKiBAcHJvcGVydHkge29iamVjdH0gZGF0YSAtIENvbHVtbi92YWx1ZSBwYWlycyB0byB1cGRhdGUuXG4gKiBAcHJvcGVydHkge3N0cmluZ30gdGFibGVOYW1lIC0gVGFibGUgbmFtZSB0byB1cGRhdGUuXG4gKi9cbi8qKlxuICogVXBzZXJ0U3FsQXJnc1R5cGUgdHlwZS5cbiAqIEB0eXBlZGVmIHtvYmplY3R9VXBzZXJ0U3FsQXJnc1R5cGVcbiAqIEBwcm9wZXJ0eSB7c3RyaW5nW119IGNvbmZsaWN0Q29sdW1ucyAtIENvbHVtbnMgdGhhdCBkZWZpbmUgYSBjb25mbGljdC5cbiAqIEBwcm9wZXJ0eSB7b2JqZWN0fSBkYXRhIC0gQ29sdW1uL3ZhbHVlIHBhaXJzIHRvIGluc2VydC5cbiAqIEBwcm9wZXJ0eSB7c3RyaW5nfSB0YWJsZU5hbWUgLSBUYWJsZSBuYW1lIHRvIHVwc2VydCBpbnRvLlxuICogQHByb3BlcnR5IHtzdHJpbmdbXX0gdXBkYXRlQ29sdW1ucyAtIENvbHVtbnMgdG8gdXBkYXRlIG9uIGNvbmZsaWN0LlxuICovXG5cbi8qKlxuICogU3FsVG9rZW5SZXN1bHQgdHlwZS5cbiAqIEB0eXBlZGVmIHtvYmplY3R9IFNxbFRva2VuUmVzdWx0XG4gKiBAcHJvcGVydHkge2Jvb2xlYW59IGluY29tcGxldGUgLSBXaGV0aGVyIHRoZSBzY2FuIGhpdCBpdHMgYm91bmQgYmVmb3JlIGZpbmlzaGluZyB0cml2aWEvdG9rZW4gcGFyc2luZy5cbiAqIEBwcm9wZXJ0eSB7c3RyaW5nIHwgdW5kZWZpbmVkfSB0b2tlbiAtIExvd2VyY2FzZWQgdG9rZW4gd2hlbiBwYXJzaW5nIGNvbXBsZXRlZDsgdW5kZWZpbmVkIHdoZW4gbm8gdG9rZW4gd2FzIGZvdW5kLlxuICogQHByb3BlcnR5IHtudW1iZXJ9IGluZGV4IC0gSW5kZXggaW1tZWRpYXRlbHkgYWZ0ZXIgdGhlIHBhcnNlZCB0b2tlbiBvciB0cml2aWEuXG4gKi9cblxuaW1wb3J0IEJhY2t0cmFjZUNsZWFuZXIgZnJvbSBcIi4uLy4uL3V0aWxzL2JhY2t0cmFjZS1jbGVhbmVyLmpzXCJcbmltcG9ydCB7IGdldERhdGFiYXNlQW5ub3RhdGlvbnMgfSBmcm9tIFwiLi4vYW5ub3RhdGlvbnMuanNcIlxuaW1wb3J0IHsgZm9ybWF0RGF0ZUZvckRhdGFiYXNlIH0gZnJvbSBcIi4uL2RhdGV0aW1lLXN0b3JhZ2UuanNcIlxuaW1wb3J0IGlzRGF0ZSBmcm9tIFwiLi4vLi4vdXRpbHMvaXMtZGF0ZS5qc1wiXG5pbXBvcnQge0RFRkFVTFRfQURWSVNPUllfTE9DS19BQ1FVSVJFX1RJTUVPVVRfTVN9IGZyb20gXCIuLi9hZHZpc29yeS1sb2NrLWJvdW5kLmpzXCJcbmltcG9ydCB7YWR2aXNvcnlMb2NrVGVsZW1ldHJ5VGhyZXNob2xkcywgZW1pdEFkdmlzb3J5TG9ja1RlbGVtZXRyeVJlcG9ydH0gZnJvbSBcIi4uL2Fkdmlzb3J5LWxvY2stdGVsZW1ldHJ5LmpzXCJcbmltcG9ydCBMb2dnZXIgZnJvbSBcIi4uLy4uL2xvZ2dlci5qc1wiXG5pbXBvcnQgUXVlcnkgZnJvbSBcIi4uL3F1ZXJ5L2luZGV4LmpzXCJcbmltcG9ydCBRdWVyeUFib3J0ZWRFcnJvciBmcm9tIFwiLi4vcXVlcnktYWJvcnRlZC1lcnJvci5qc1wiXG5pbXBvcnQgSGFuZGxlciBmcm9tIFwiLi4vaGFuZGxlci5qc1wiXG5pbXBvcnQgeyB1dGY4Qnl0ZUxlbmd0aCB9IGZyb20gXCIuLi8uLi91dGlscy91dGY4LWJ5dGUtbGVuZ3RoLmpzXCJcbmltcG9ydCBNdXRleCBmcm9tIFwiZXBpYy1sb2Nrcy9idWlsZC9tdXRleC5qc1wiXG5pbXBvcnQgVVVJRCBmcm9tIFwicHVyZS11dWlkXCJcbmltcG9ydCBUYWJsZURhdGEgZnJvbSBcIi4uL3RhYmxlLWRhdGEvaW5kZXguanNcIlxuaW1wb3J0IFRhYmxlQ29sdW1uIGZyb20gXCIuLi90YWJsZS1kYXRhL3RhYmxlLWNvbHVtbi5qc1wiXG5pbXBvcnQgVGFibGVGb3JlaWduS2V5IGZyb20gXCIuLi90YWJsZS1kYXRhL3RhYmxlLWZvcmVpZ24ta2V5LmpzXCJcbmltcG9ydCB3YWl0IGZyb20gXCJhd2FpdGVyeS9idWlsZC93YWl0LmpzXCJcbmltcG9ydCB7IGVuc3VyZUVycm9yLCBvcHRpb25hbFBvc2l0aXZlSW50ZWdlciB9IGZyb20gXCJ0eXBhbmljXCJcbmltcG9ydCB7Y29vcmRpbmF0ZVNoYXJlZFRyYW5zYWN0aW9uQ29ubmVjdGlvbiwgcnVuV2l0aG91dFNoYXJlZFRyYW5zYWN0aW9uQ29vcmRpbmF0b3JPd25lcn0gZnJvbSBcIi4uLy4uL3Rlc3Rpbmcvc2hhcmVkLXRyYW5zYWN0aW9uLWNvbm5lY3Rpb24tY29vcmRpbmF0b3IuanNcIlxuaW1wb3J0IHsgY3VycmVudFRlc3RQcm9maWxlQ29udGV4dCB9IGZyb20gXCIuLi8uLi90ZXN0aW5nL3Rlc3QtcHJvZmlsZS1jb250ZXh0LmpzXCJcbmltcG9ydCBzaGEyNTZIZXggZnJvbSBcIi4uLy4uL3V0aWxzL3NoYTI1Ni1oZXguanNcIlxuXG4vKiogTWF4aW11bSBjaGFyYWN0ZXJzIGluc3BlY3RlZCB3aGVuIGJ1aWxkaW5nIHRoZSBkZWJ1ZyBTUUwgcHJldmlldy4gKi9cbmNvbnN0IFNRTF9QUkVWSUVXX1NDQU5fTElNSVQgPSA0MDk2XG4vKiogTWF4aW11bSBjaGFyYWN0ZXJzIGluc3BlY3RlZCB3aGVuIGRlY2lkaW5nIHdoZXRoZXIgYSBzdGF0ZW1lbnQgaW52YWxpZGF0ZXMgc2NoZW1hIG1ldGFkYXRhLiAqL1xuY29uc3QgU0NIRU1BX0lOVkFMSURBVElPTl9TQ0FOX0xJTUlUID0gODE5MlxuLyoqIE1heGltdW0gY2hlY2tvdXQtbmFtZSBjaGFyYWN0ZXJzIGluc3BlY3RlZCBieSByZXRyeSBkaWFnbm9zdGljcy4gKi9cbmNvbnN0IE9QRVJBVElPTl9OQU1FX1NDQU5fTElNSVQgPSAxMDI0XG5jb25zdCBSRURBQ1RFRF9ESUFHTk9TVElDX0xBQkVMID0gXCJbUkVEQUNURURdXCJcbi8qKiBGaXJzdCBiYWNrb2ZmIGJldHdlZW4gcmV0cmllcyBvZiBhIHNjaGVtYS1tZXRhZGF0YSByZWFkIGJsb2NrZWQgYnkgY29uY3VycmVudCBvbmxpbmUgRERMLiAqL1xuY29uc3QgU0NIRU1BX01FVEFEQVRBX1JFVFJZX0lOSVRJQUxfREVMQVlfTVMgPSAyNTBcbi8qKiBMYXJnZXN0IGJhY2tvZmYgYmV0d2VlbiByZXRyaWVzIG9mIGEgc2NoZW1hLW1ldGFkYXRhIHJlYWQgYmxvY2tlZCBieSBjb25jdXJyZW50IG9ubGluZSBEREwuICovXG5jb25zdCBTQ0hFTUFfTUVUQURBVEFfUkVUUllfTUFYX0RFTEFZX01TID0gMjAwMFxuLyoqIERlZmF1bHQgYm91bmRlZCBkZWFkbGluZSBmb3Igb3V0bGFzdGluZyBhIGNvbmN1cnJlbnQgb25saW5lLURETCBtZXRhZGF0YSBza2lwLiAqL1xuY29uc3QgU0NIRU1BX01FVEFEQVRBX1JFVFJZX0RFQURMSU5FX01TID0gNjAwMDBcblxuLyoqXG4gKiBCdWlsZHMgYSBub24tcmV2ZXJzaWJsZSwgc3RhYmxlIFNRTCBmaW5nZXJwcmludCB3aXRob3V0IHJldGFpbmluZyBTUUwgdGV4dC4gTGl0ZXJhbCBzcGVsbGluZyBpc1xuICogbm9ybWFsaXplZCBmaXJzdCBzbyB0aGUgc2FtZSBzdGF0ZW1lbnQgc2hhcGUgcHJvZHVjZXMgdGhlIHNhbWUgZmluZ2VycHJpbnQgYWNyb3NzIHZhbHVlcy5cbiAqIEBwYXJhbSB7c3RyaW5nfSBzcWwgLSBTUUwgdG8gZmluZ2VycHJpbnQuXG4gKiBAcmV0dXJucyB7e3NxbEZpbmdlcnByaW50OiBzdHJpbmcsIHNxbE9wZXJhdGlvbjogc3RyaW5nfX0gLSBCb3VuZGVkIHF1ZXJ5IGRpYWdub3N0aWMuXG4gKi9cbmZ1bmN0aW9uIHNxbERpYWdub3N0aWMoc3FsKSB7XG4gIGxldCBmaW5nZXJwcmludElucHV0ID0gXCJcIlxuXG4gIGZvciAobGV0IGluZGV4ID0gMDsgaW5kZXggPCBzcWwubGVuZ3RoOykge1xuICAgIGNvbnN0IGNoYXJhY3RlciA9IHNxbFtpbmRleF1cbiAgICBjb25zdCBuZXh0Q2hhcmFjdGVyID0gc3FsW2luZGV4ICsgMV1cblxuICAgIGlmIChjaGFyYWN0ZXIgPT0gXCInXCIgfHwgY2hhcmFjdGVyID09ICdcIicpIHtcbiAgICAgIGNvbnN0IHF1b3RlID0gY2hhcmFjdGVyXG4gICAgICBmaW5nZXJwcmludElucHV0ICs9IFwiP1wiXG4gICAgICBpbmRleCsrXG5cbiAgICAgIHdoaWxlIChpbmRleCA8IHNxbC5sZW5ndGgpIHtcbiAgICAgICAgaWYgKHNxbFtpbmRleF0gPT0gXCJcXFxcXCIpIHtcbiAgICAgICAgICBpbmRleCArPSAyXG4gICAgICAgIH0gZWxzZSBpZiAoc3FsW2luZGV4XSA9PSBxdW90ZSAmJiBzcWxbaW5kZXggKyAxXSA9PSBxdW90ZSkge1xuICAgICAgICAgIGluZGV4ICs9IDJcbiAgICAgICAgfSBlbHNlIGlmIChzcWxbaW5kZXhdID09IHF1b3RlKSB7XG4gICAgICAgICAgaW5kZXgrK1xuICAgICAgICAgIGJyZWFrXG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgaW5kZXgrK1xuICAgICAgICB9XG4gICAgICB9XG4gICAgfSBlbHNlIGlmIChjaGFyYWN0ZXIgPT0gXCIvXCIgJiYgbmV4dENoYXJhY3RlciA9PSBcIipcIikge1xuICAgICAgY29uc3QgY29tbWVudEVuZCA9IHNxbC5pbmRleE9mKFwiKi9cIiwgaW5kZXggKyAyKVxuICAgICAgZmluZ2VycHJpbnRJbnB1dCArPSBcIiBcIlxuICAgICAgaW5kZXggPSBjb21tZW50RW5kID09IC0xID8gc3FsLmxlbmd0aCA6IGNvbW1lbnRFbmQgKyAyXG4gICAgfSBlbHNlIGlmICgoY2hhcmFjdGVyID09IFwiLVwiICYmIG5leHRDaGFyYWN0ZXIgPT0gXCItXCIpIHx8IGNoYXJhY3RlciA9PSBcIiNcIikge1xuICAgICAgY29uc3QgbGluZUVuZCA9IHNxbC5pbmRleE9mKFwiXFxuXCIsIGluZGV4ICsgMSlcbiAgICAgIGZpbmdlcnByaW50SW5wdXQgKz0gXCIgXCJcbiAgICAgIGluZGV4ID0gbGluZUVuZCA9PSAtMSA/IHNxbC5sZW5ndGggOiBsaW5lRW5kICsgMVxuICAgIH0gZWxzZSB7XG4gICAgICBmaW5nZXJwcmludElucHV0ICs9IGNoYXJhY3RlclxuICAgICAgaW5kZXgrK1xuICAgIH1cbiAgfVxuXG4gIGNvbnN0IG5vcm1hbGl6ZWQgPSBmaW5nZXJwcmludElucHV0XG4gICAgLnJlcGxhY2UoL1xcYig/OjB4WzAtOWEtZl0rfFxcZCsoPzpcXC5cXGQrKT8oPzplWystXT9cXGQrKT8pXFxiL2dpLCBcIj9cIilcbiAgICAucmVwbGFjZSgvXFxzKy9nLCBcIiBcIilcbiAgICAudHJpbSgpXG4gICAgLnRvTG93ZXJDYXNlKClcbiAgbGV0IGhhc2ggPSAweGNiZjI5Y2U0ODQyMjIzMjVuXG5cbiAgZm9yIChsZXQgaW5kZXggPSAwOyBpbmRleCA8IG5vcm1hbGl6ZWQubGVuZ3RoOyBpbmRleCsrKSB7XG4gICAgaGFzaCBePSBCaWdJbnQobm9ybWFsaXplZC5jaGFyQ29kZUF0KGluZGV4KSlcbiAgICBoYXNoID0gQmlnSW50LmFzVWludE4oNjQsIGhhc2ggKiAweDEwMDAwMDAwMWIzbilcbiAgfVxuXG4gIGNvbnN0IG9wZXJhdGlvbk1hdGNoID0gL14oW2Etel0rKS8uZXhlYyhub3JtYWxpemVkKVxuXG4gIHJldHVybiB7XG4gICAgc3FsRmluZ2VycHJpbnQ6IGBmbnYxYTY0OiR7aGFzaC50b1N0cmluZygxNikucGFkU3RhcnQoMTYsIFwiMFwiKX1gLFxuICAgIHNxbE9wZXJhdGlvbjogb3BlcmF0aW9uTWF0Y2ggPyBvcGVyYXRpb25NYXRjaFsxXS50b1VwcGVyQ2FzZSgpIDogXCJVTktOT1dOXCJcbiAgfVxufVxuXG4vKipcbiAqIE1hcmtzIGEgY2FsbGJhY2sgZmFpbHVyZSB0aGF0IGhhcHBlbmVkIGFmdGVyIHRoZSBvd25pbmcgdHJhbnNhY3Rpb24gd2FzIGR1cmFibHkgY29tbWl0dGVkLlxuICogVGhlIHB1YmxpYyB0cmFuc2FjdGlvbiBib3VuZGFyeSB1bndyYXBzIGl0IGJlZm9yZSBkZWFkbG9jayBjbGFzc2lmaWNhdGlvbi5cbiAqL1xuY2xhc3MgVmVsb2Npb3VzRGF0YWJhc2VBZnRlckNvbW1pdENhbGxiYWNrRXJyb3IgZXh0ZW5kcyBFcnJvciB7XG4gIC8qKlxuICAgKiBSdW5zIGNvbnN0cnVjdG9yLlxuICAgKiBAcGFyYW0ge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSBjYWxsYmFja0Vycm9yIC0gT3JpZ2luYWwgY2FsbGJhY2sgZmFpbHVyZS5cbiAgICovXG4gIGNvbnN0cnVjdG9yKGNhbGxiYWNrRXJyb3IpIHtcbiAgICBzdXBlcihcIkRhdGFiYXNlIGFmdGVyQ29tbWl0IGNhbGxiYWNrIGZhaWxlZFwiKVxuICAgIHRoaXMuY2FsbGJhY2tFcnJvciA9IGNhbGxiYWNrRXJyb3JcbiAgfVxufVxuXG4vKipcbiAqIFJ1bnMgbm93IG1zLlxuICogQHJldHVybnMge251bWJlcn0gLSBDdXJyZW50IGhpZ2gtcmVzb2x1dGlvbi1pc2ggdGltZXN0YW1wIGluIG1pbGxpc2Vjb25kcy5cbiAqL1xuZnVuY3Rpb24gbm93TXMoKSB7XG4gIGlmIChnbG9iYWxUaGlzLnBlcmZvcm1hbmNlICYmIHR5cGVvZiBnbG9iYWxUaGlzLnBlcmZvcm1hbmNlLm5vdyA9PSBcImZ1bmN0aW9uXCIpIHtcbiAgICByZXR1cm4gZ2xvYmFsVGhpcy5wZXJmb3JtYW5jZS5ub3coKVxuICB9XG5cbiAgcmV0dXJuIERhdGUubm93KClcbn1cblxuLyoqXG4gKiBSdW5zIGZvcm1hdCBlbGFwc2VkIG1zLlxuICogQHBhcmFtIHtudW1iZXJ9IGVsYXBzZWRNcyAtIEVsYXBzZWQgbWlsbGlzZWNvbmRzLlxuICogQHJldHVybnMge3N0cmluZ30gLSBGb3JtYXR0ZWQgZWxhcHNlZCBtaWxsaXNlY29uZHMuXG4gKi9cbmZ1bmN0aW9uIGZvcm1hdEVsYXBzZWRNcyhlbGFwc2VkTXMpIHtcbiAgcmV0dXJuIGAke01hdGgubWF4KGVsYXBzZWRNcywgMCkudG9GaXhlZCgxKX1tc2Bcbn1cblxuZXhwb3J0IGRlZmF1bHQgY2xhc3MgVmVsb2Npb3VzRGF0YWJhc2VEcml2ZXJzQmFzZSB7XG4gIC8qKlxuICAgKiBJZCBzZXEuXG4gICAqIEB0eXBlIHtudW1iZXIgfCB1bmRlZmluZWR9ICovXG4gIGlkU2VxID0gdW5kZWZpbmVkXG4gIC8qKlxuICAgKiBOYXJyb3dzIHRoZSBydW50aW1lIHZhbHVlIHRvIHRoZSBkb2N1bWVudGVkIHR5cGUuXG4gICAqIEB0eXBlIHtUcmFuc2FjdGlvbkNhbGxiYWNrRnJhbWVbXX0gKi9cbiAgX3RyYW5zYWN0aW9uQ2FsbGJhY2tGcmFtZXNcbiAgLyoqIEB0eXBlIHtQcm9taXNlPHZvaWQ+fSAqL1xuICBfdHJhbnNhY3Rpb25Db21wbGV0aW9uUHJvbWlzZVxuICAvKiogQHR5cGUgeygoKSA9PiB2b2lkKSB8IHVuZGVmaW5lZH0gKi9cbiAgX3Jlc29sdmVUcmFuc2FjdGlvbkNvbXBsZXRpb25cbiAgLyoqXG4gICAqIE5hcnJvd3MgdGhlIHJ1bnRpbWUgdmFsdWUgdG8gdGhlIGRvY3VtZW50ZWQgdHlwZS5cbiAgICogQHR5cGUge01hcDxzdHJpbmcsIFByb21pc2U8UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+Pn0gKi9cbiAgX3NjaGVtYUNhY2hlXG4gIC8qKlxuICAgKiBOYXJyb3dzIHRoZSBydW50aW1lIHZhbHVlIHRvIHRoZSBkb2N1bWVudGVkIHR5cGUuXG4gICAqIEB0eXBlIHsoKCkgPT4gdm9pZCkgfCB1bmRlZmluZWR9ICovXG4gIF9zY2hlbWFDYWNoZUludmFsaWRhdG9yXG4gIC8qKlxuICAgKiBOYXJyb3dzIHRoZSBydW50aW1lIHZhbHVlIHRvIHRoZSBkb2N1bWVudGVkIHR5cGUuXG4gICAqIEB0eXBlIHtzdHJpbmcgfCB1bmRlZmluZWR9ICovXG4gIF9jb25uZWN0aW9uQ2hlY2tvdXROYW1lXG4gIC8qKiBAdHlwZSB7c3RyaW5nIHwgdW5kZWZpbmVkfSAqL1xuICBfZGF0YWJhc2VJZGVudGlmaWVyXG4gIC8qKiBAdHlwZSB7c3RyaW5nIHwgdW5kZWZpbmVkfSAqL1xuICBfZGF0YWJhc2VJZGVudGl0eUZpbmdlcnByaW50XG4gIC8qKlxuICAgKiBBY3RpdmUgcXVlcnkuXG4gICAqIEB0eXBlIHtBY3RpdmVRdWVyeVN0YXRlIHwgbnVsbH0gKi9cbiAgX2FjdGl2ZVF1ZXJ5ID0gbnVsbFxuICAvKiogQHR5cGUge1dlYWtNYXA8RXJyb3IsIHtzcWxGaW5nZXJwcmludDogc3RyaW5nLCBzcWxPcGVyYXRpb246IHN0cmluZ30+fSAqL1xuICBfZmFpbGVkUXVlcnlEaWFnbm9zdGljcyA9IG5ldyBXZWFrTWFwKClcbiAgLyoqIEB0eXBlIHtNYXA8c3RyaW5nLCBudW1iZXI+fSAqL1xuICBfaGVsZEFkdmlzb3J5TG9ja3MgPSBuZXcgTWFwKClcbiAgLyoqXG4gICAqIFdoZW4gZWFjaCB0cmFja2VkIGFkdmlzb3J5IGxvY2sgd2FzIGZpcnN0IGFjcXVpcmVkLCBzbyB0aGUgZmluYWwgcmVsZWFzZSBjYW5cbiAgICogcmVwb3J0IGEgaG9sZCB0aGF0IG91dGxpdmVkIGBhZHZpc29yeUxvY2tUZWxlbWV0cnkuc2xvd0hvbGRNc2AuXG4gICAqIEB0eXBlIHtNYXA8c3RyaW5nLCBudW1iZXI+fVxuICAgKi9cbiAgX2Fkdmlzb3J5TG9ja0FjcXVpcmVkQXRCeU5hbWUgPSBuZXcgTWFwKClcbiAgLyoqXG4gICAqIFN0YWJsZSBwZXItY29ubmVjdGlvbiBob2xkZXIgaWRlbnRpdHkgdXNlZCBieSBhZHZpc29yeS1sb2NrIHRlbGVtZXRyeSB3aGVuXG4gICAqIHRoZSB0aWVyIGNhbiBvbmx5IG5hbWUgbG9jYWwgaG9sZGVycy5cbiAgICogQHR5cGUge3N0cmluZyB8IHVuZGVmaW5lZH1cbiAgICovXG4gIF9hZHZpc29yeUxvY2tIb2xkZXJJZCA9IHVuZGVmaW5lZFxuICAvKipcbiAgICogRXhjbHVzaXZlIG9wZXJhdGlvbiBsZWFzZSBpbnN0YWxsZWQgYnkgYSBzaW5nbGUtbXVsdGktdXNlIHBvb2wuXG4gICAqIEB0eXBlIHtpbXBvcnQoXCIuLi9vcGVyYXRpb24tbGVhc2UuanNcIikuZGVmYXVsdCB8IHVuZGVmaW5lZH1cbiAgICovXG4gIF9vcGVyYXRpb25MZWFzZSA9IHVuZGVmaW5lZFxuXG4gIC8qKlxuICAgKiBSdW5zIGNvbnN0cnVjdG9yLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uLy4uL2NvbmZpZ3VyYXRpb24tdHlwZXMuanNcIikuRGF0YWJhc2VDb25maWd1cmF0aW9uVHlwZX0gY29uZmlnIC0gQ29uZmlndXJhdGlvbiBvYmplY3QuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vLi4vY29uZmlndXJhdGlvbi5qc1wiKS5kZWZhdWx0fSBjb25maWd1cmF0aW9uIC0gQ29uZmlndXJhdGlvbiBpbnN0YW5jZS5cbiAgICovXG4gIGNvbnN0cnVjdG9yKGNvbmZpZywgY29uZmlndXJhdGlvbikge1xuICAgIHRoaXMuX2FyZ3MgPSBjb25maWdcbiAgICB0aGlzLmNvbmZpZ3VyYXRpb24gPSBjb25maWd1cmF0aW9uXG4gICAgdGhpcy5tdXRleCA9IG5ldyBNdXRleCgpIC8vIENhbiBiZSB1c2VkIHRvIGxvY2sgdGhpcyBpbnN0YW5jZSBmb3IgZXhjbHVzaXZlIHVzZVxuICAgIHRoaXMubG9nZ2VyID0gbmV3IExvZ2dlcih0aGlzKVxuICAgIHRoaXMuX3RyYW5zYWN0aW9uQ2FsbGJhY2tGcmFtZXMgPSBbXVxuICAgIHRoaXMuX3RyYW5zYWN0aW9uc0NvdW50ID0gMFxuICAgIHRoaXMuX3RyYW5zYWN0aW9uQ29tcGxldGlvblByb21pc2UgPSBQcm9taXNlLnJlc29sdmUoKVxuICAgIHRoaXMuX3Jlc29sdmVUcmFuc2FjdGlvbkNvbXBsZXRpb24gPSB1bmRlZmluZWRcbiAgICB0aGlzLl90cmFuc2FjdGlvbnNBY3Rpb25zTXV0ZXggPSBuZXcgTXV0ZXgoKVxuICAgIHRoaXMuX3BoeXNpY2FsQ29ubmVjdGlvbk11dGV4ID0gbmV3IE11dGV4KClcbiAgICB0aGlzLl9zY2hlbWFDYWNoZSA9IG5ldyBNYXAoKVxuICB9XG5cbiAgLyoqXG4gICAqIFNlcmlhbGl6ZXMgYWNjZXNzIHRvIG9uZSBwaHlzaWNhbCBkYXRhYmFzZSBzZXNzaW9uLlxuICAgKiBAdGVtcGxhdGUgVFxuICAgKiBAcGFyYW0geygpID0+IFByb21pc2U8VD59IGNhbGxiYWNrIC0gUGh5c2ljYWwgZHJpdmVyIG9wZXJhdGlvbi5cbiAgICogQHJldHVybnMge1Byb21pc2U8VD59IC0gT3BlcmF0aW9uIHJlc3VsdC5cbiAgICovXG4gIGFzeW5jIF9ydW5QaHlzaWNhbENvbm5lY3Rpb25SZXF1ZXN0KGNhbGxiYWNrKSB7XG4gICAgcmV0dXJuIGF3YWl0IHRoaXMuX3BoeXNpY2FsQ29ubmVjdGlvbk11dGV4LnN5bmMoYXN5bmMgKCkgPT4ge1xuICAgICAgcmV0dXJuIGF3YWl0IHJ1bldpdGhvdXRTaGFyZWRUcmFuc2FjdGlvbkNvb3JkaW5hdG9yT3duZXIodGhpcywgY2FsbGJhY2spXG4gICAgfSlcbiAgfVxuXG4gIC8qKlxuICAgKiBDbGVhbnMgZHJpdmVyLXNwZWNpZmljIHNlc3Npb24gc3RhdGUgYmVmb3JlIHRoaXMgbG9naWNhbCBjb25uZWN0aW9uIGlzIHJldXNhYmxlLlxuICAgKiBEcml2ZXJzIHdob3NlIHBoeXNpY2FsIHNlc3Npb25zIGNhbm5vdCBiZSBzYWZlbHkgcmVzZXQgc2hvdWxkIGRpc3Bvc2UgdGhlbSBoZXJlLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyB3aGVuIHRoZSBuZXh0IGNoZWNrb3V0IGNhbm5vdCBvYnNlcnZlIHByaW9yIHNlc3Npb24gc3RhdGUuXG4gICAqL1xuICBhc3luYyBjbGVhbnVwU2Vzc2lvblN0YXRlQWZ0ZXJDaGVja291dCgpIHt9XG5cbiAgLyoqXG4gICAqIFJ1bnMgYWRkIGZvcmVpZ24ga2V5LlxuICAgKiBAcGFyYW0ge3N0cmluZ30gdGFibGVOYW1lIC0gVGFibGUgbmFtZS5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGNvbHVtbk5hbWUgLSBDb2x1bW4gbmFtZS5cbiAgICogQHBhcmFtIHtzdHJpbmd9IHJlZmVyZW5jZWRUYWJsZU5hbWUgLSBSZWZlcmVuY2VkIHRhYmxlIG5hbWUuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSByZWZlcmVuY2VkQ29sdW1uTmFtZSAtIFJlZmVyZW5jZWQgY29sdW1uIG5hbWUuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gT3B0aW9ucyBvYmplY3QuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIHdoZW4gY29tcGxldGUuXG4gICAqL1xuICBhc3luYyBhZGRGb3JlaWduS2V5KHRhYmxlTmFtZSwgY29sdW1uTmFtZSwgcmVmZXJlbmNlZFRhYmxlTmFtZSwgcmVmZXJlbmNlZENvbHVtbk5hbWUsIGFyZ3MpIHtcbiAgICB0aGlzLl9hc3NlcnROb3RSZWFkT25seSgpXG4gICAgY29uc3QgdGFibGVGb3JlaWduS2V5QXJncyA9IE9iamVjdC5hc3NpZ24oXG4gICAgICB7XG4gICAgICAgIGNvbHVtbk5hbWUsXG4gICAgICAgIHRhYmxlTmFtZSxcbiAgICAgICAgcmVmZXJlbmNlZENvbHVtbk5hbWUsXG4gICAgICAgIHJlZmVyZW5jZWRUYWJsZU5hbWVcbiAgICAgIH0sXG4gICAgICBhcmdzXG4gICAgKVxuICAgIGNvbnN0IHRhYmxlRm9yZWlnbktleSA9IG5ldyBUYWJsZUZvcmVpZ25LZXkodGFibGVGb3JlaWduS2V5QXJncylcbiAgICBjb25zdCB0YWJsZURhdGEgPSBuZXcgVGFibGVEYXRhKHRhYmxlTmFtZSlcblxuICAgIHRhYmxlRGF0YS5hZGRGb3JlaWduS2V5KHRhYmxlRm9yZWlnbktleSlcblxuICAgIGNvbnN0IGFsdGVyVGFibGVTUUxzID0gYXdhaXQgdGhpcy5hbHRlclRhYmxlU1FMcyh0YWJsZURhdGEpXG5cbiAgICBmb3IgKGNvbnN0IGFsdGVyVGFibGVTUUwgb2YgYWx0ZXJUYWJsZVNRTHMpIHtcbiAgICAgIGF3YWl0IHRoaXMucXVlcnkoYWx0ZXJUYWJsZVNRTClcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogUnVucyByZW1vdmUgZm9yZWlnbiBrZXkuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSB0YWJsZU5hbWUgLSBUYWJsZSBuYW1lLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vYmFzZS1mb3JlaWduLWtleS5qc1wiKS5kZWZhdWx0fSBmb3JlaWduS2V5TWV0YWRhdGEgLSBGb3JlaWduIGtleSBtZXRhZGF0YS5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgd2hlbiBjb21wbGV0ZS5cbiAgICovXG4gIGFzeW5jIHJlbW92ZUZvcmVpZ25LZXkodGFibGVOYW1lLCBmb3JlaWduS2V5TWV0YWRhdGEpIHtcbiAgICB0aGlzLl9hc3NlcnROb3RSZWFkT25seSgpXG5cbiAgICBjb25zdCB0YWJsZUZvcmVpZ25LZXkgPSBuZXcgVGFibGVGb3JlaWduS2V5KHtcbiAgICAgIGNvbHVtbk5hbWU6IGZvcmVpZ25LZXlNZXRhZGF0YS5nZXRDb2x1bW5OYW1lKCksXG4gICAgICBkcm9wRm9yZWlnbktleTogdHJ1ZSxcbiAgICAgIG5hbWU6IGZvcmVpZ25LZXlNZXRhZGF0YS5nZXROYW1lKCksXG4gICAgICByZWZlcmVuY2VkQ29sdW1uTmFtZTogZm9yZWlnbktleU1ldGFkYXRhLmdldFJlZmVyZW5jZWRDb2x1bW5OYW1lKCksXG4gICAgICByZWZlcmVuY2VkVGFibGVOYW1lOiBmb3JlaWduS2V5TWV0YWRhdGEuZ2V0UmVmZXJlbmNlZFRhYmxlTmFtZSgpLFxuICAgICAgdGFibGVOYW1lXG4gICAgfSlcbiAgICBjb25zdCB0YWJsZURhdGEgPSBuZXcgVGFibGVEYXRhKHRhYmxlTmFtZSlcblxuICAgIHRhYmxlRGF0YS5hZGRGb3JlaWduS2V5KHRhYmxlRm9yZWlnbktleSlcblxuICAgIGNvbnN0IGFsdGVyVGFibGVTUUxzID0gYXdhaXQgdGhpcy5hbHRlclRhYmxlU1FMcyh0YWJsZURhdGEpXG5cbiAgICBmb3IgKGNvbnN0IGFsdGVyVGFibGVTUUwgb2YgYWx0ZXJUYWJsZVNRTHMpIHtcbiAgICAgIGF3YWl0IHRoaXMucXVlcnkoYWx0ZXJUYWJsZVNRTClcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogUnVucyBhbHRlciB0YWJsZSBzcWxzLlxuICAgKiBAYWJzdHJhY3RcbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi90YWJsZS1kYXRhL2luZGV4LmpzXCIpLmRlZmF1bHR9IF90YWJsZURhdGEgLSBUYWJsZSBkYXRhLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxzdHJpbmdbXT59IC0gUmVzb2x2ZXMgd2l0aCBTUUwgc3RhdGVtZW50cy5cbiAgICovXG4gIGFsdGVyVGFibGVTUUxzKF90YWJsZURhdGEpIHtcbiAgICB0aHJvdyBuZXcgRXJyb3IoXCJhbHRlclRhYmxlU1FMcyBub3QgaW1wbGVtZW50ZWRcIilcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGNvbm5lY3QuXG4gICAqIEBhYnN0cmFjdFxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyB3aGVuIGNvbXBsZXRlLlxuICAgKi9cbiAgY29ubmVjdCgpIHtcbiAgICB0aHJvdyBuZXcgRXJyb3IoXCInY29ubmVjdCcgbm90IGltcGxlbWVudGVkXCIpXG4gIH1cblxuICAvKipcbiAgICogUmVsZWFzZXMgdHJhY2tlZCBhZHZpc29yeSBsb2NrcyBhbmQgY2xvc2VzIHRoZSBwaHlzaWNhbCBkYXRhYmFzZSBjb25uZWN0aW9uLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyB3aGVuIGNsZWFudXAgYW5kIGNsb3NlIGNvbXBsZXRlLlxuICAgKi9cbiAgYXN5bmMgY2xvc2UoKSB7XG4gICAgLyoqIEB0eXBlIHtFcnJvciB8IHVuZGVmaW5lZH0gKi9cbiAgICBsZXQgYWR2aXNvcnlMb2NrRXJyb3JcblxuICAgIHRyeSB7XG4gICAgICBhd2FpdCB0aGlzLnJlbGVhc2VIZWxkQWR2aXNvcnlMb2NrcygpXG4gICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgIGFkdmlzb3J5TG9ja0Vycm9yID0gZXJyb3IgaW5zdGFuY2VvZiBFcnJvciA/IGVycm9yIDogbmV3IEVycm9yKFwiRmFpbGVkIHRvIHJlbGVhc2UgaGVsZCBhZHZpc29yeSBsb2Nrc1wiLCB7Y2F1c2U6IGVycm9yfSlcbiAgICB9XG5cbiAgICB0cnkge1xuICAgICAgYXdhaXQgdGhpcy5fY2xvc2UoKVxuICAgICAgdGhpcy5faGVsZEFkdmlzb3J5TG9ja3MuY2xlYXIoKVxuICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICBjb25zdCBjbG9zZUVycm9yID0gZXJyb3IgaW5zdGFuY2VvZiBFcnJvciA/IGVycm9yIDogbmV3IEVycm9yKFwiRmFpbGVkIHRvIGNsb3NlIGRhdGFiYXNlIGNvbm5lY3Rpb25cIiwge2NhdXNlOiBlcnJvcn0pXG5cbiAgICAgIGlmIChhZHZpc29yeUxvY2tFcnJvcikge1xuICAgICAgICB0aHJvdyBuZXcgQWdncmVnYXRlRXJyb3IoW2Fkdmlzb3J5TG9ja0Vycm9yLCBjbG9zZUVycm9yXSwgXCJGYWlsZWQgdG8gcmVsZWFzZSBhZHZpc29yeSBsb2NrcyBhbmQgY2xvc2UgZGF0YWJhc2UgY29ubmVjdGlvblwiLCB7Y2F1c2U6IGVycm9yfSlcbiAgICAgIH1cblxuICAgICAgdGhyb3cgY2xvc2VFcnJvclxuICAgIH1cblxuICAgIGlmIChhZHZpc29yeUxvY2tFcnJvcikgdGhyb3cgYWR2aXNvcnlMb2NrRXJyb3JcbiAgfVxuXG4gIC8qKlxuICAgKiBEcml2ZXItc3BlY2lmaWMgcGh5c2ljYWwgY2xvc2UgaG9vay5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgd2hlbiB0aGUgdW5kZXJseWluZyBjb25uZWN0aW9uIGNsb3Nlcy5cbiAgICovXG4gIGFzeW5jIF9jbG9zZSgpIHtcbiAgICAvLyBOby1vcCBieSBkZWZhdWx0XG4gIH1cblxuICAvKipcbiAgICogRmx1c2hlcyBwZW5kaW5nIHdyaXRlcyB0aGF0IHRoZSBkcml2ZXIgZGVsYXllZCBmb3IgcGVyc2lzdGVuY2UuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIHdoZW4gcGVuZGluZyB3cml0ZXMgYXJlIGR1cmFibGUuXG4gICAqL1xuICBhc3luYyBmbHVzaFBlbmRpbmdXcml0ZXMoKSB7XG4gICAgLy8gTm8tb3AgYnkgZGVmYXVsdFxuICB9XG5cbiAgLyoqXG4gICAqIFJldHVybnMgd2hldGhlciBkZWxheWVkIHBlcnNpc3RlbmNlIHdyaXRlcyByZW1haW4uXG4gICAqIEByZXR1cm5zIHtib29sZWFufSAtIFdoZXRoZXIgd3JpdGVzIHJlbWFpbi5cbiAgICovXG4gIGhhc1BlbmRpbmdXcml0ZXMoKSB7IHJldHVybiBmYWxzZSB9XG5cbiAgLyoqXG4gICAqIERlbGV0ZXMgdGhpcyBkcml2ZXIncyBwaHlzaWNhbCBkYXRhYmFzZSBzdG9yYWdlIHdpdGhvdXQgb3BlbmluZyBpdC5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgYWZ0ZXIgZGVsZXRpb24uXG4gICAqL1xuICBhc3luYyBkZWxldGVEYXRhYmFzZVN0b3JhZ2UoKSB7IHRocm93IG5ldyBFcnJvcihgRGF0YWJhc2Ugc3RvcmFnZSBkZWxldGlvbiBpcyBub3Qgc3VwcG9ydGVkIGJ5ICR7dGhpcy5jb25zdHJ1Y3Rvci5uYW1lfWApIH1cblxuICAvKipcbiAgICogUnVucyBzZXQgY29ubmVjdGlvbiBjaGVja291dCBuYW1lLlxuICAgKiBAcGFyYW0ge3N0cmluZyB8IHVuZGVmaW5lZH0gbmFtZSAtIEh1bWFuLXJlYWRhYmxlIG5hbWUgZm9yIHRoaXMgYWN0aXZlIGNoZWNrb3V0LlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyB3aGVuIGNvbXBsZXRlLlxuICAgKi9cbiAgYXN5bmMgc2V0Q29ubmVjdGlvbkNoZWNrb3V0TmFtZShuYW1lKSB7XG4gICAgdGhpcy5fY29ubmVjdGlvbkNoZWNrb3V0TmFtZSA9IG5hbWVcbiAgICB0aGlzLl9jb25uZWN0aW9uQ2hlY2tlZE91dEF0VW5peE1zID0gRGF0ZS5ub3coKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgY2xlYXIgY29ubmVjdGlvbiBjaGVja291dCBuYW1lLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyB3aGVuIGNvbXBsZXRlLlxuICAgKi9cbiAgYXN5bmMgY2xlYXJDb25uZWN0aW9uQ2hlY2tvdXROYW1lKCkge1xuICAgIHRoaXMuX2Nvbm5lY3Rpb25DaGVja291dE5hbWUgPSB1bmRlZmluZWRcbiAgICB0aGlzLl9jb25uZWN0aW9uQ2hlY2tlZE91dEF0VW5peE1zID0gdW5kZWZpbmVkXG4gIH1cblxuICAvKipcbiAgICogU2V0cyB0aGUgcG9vbC1vd25lZCBpZGVudGl0eSB1c2VkIGJ5IHNhZmUgZGF0YWJhc2UgZGlhZ25vc3RpY3MuXG4gICAqIEBwYXJhbSB7e2RhdGFiYXNlSWRlbnRpZmllcjogc3RyaW5nLCBkYXRhYmFzZUlkZW50aXR5RmluZ2VycHJpbnQ6IHN0cmluZ319IGlkZW50aXR5IC0gUG9vbC1zdGFtcGVkIGlkZW50aXR5IHJlZGFjdGVkIGF0IGRpYWdub3N0aWMgc25hcHNob3QgdGltZS5cbiAgICogQHJldHVybnMge3ZvaWR9XG4gICAqL1xuICBzZXRQb29sRGlhZ25vc3RpY0lkZW50aXR5KHtkYXRhYmFzZUlkZW50aWZpZXIsIGRhdGFiYXNlSWRlbnRpdHlGaW5nZXJwcmludH0pIHtcbiAgICB0aGlzLl9kYXRhYmFzZUlkZW50aWZpZXIgPSBkYXRhYmFzZUlkZW50aWZpZXJcbiAgICB0aGlzLl9kYXRhYmFzZUlkZW50aXR5RmluZ2VycHJpbnQgPSBkYXRhYmFzZUlkZW50aXR5RmluZ2VycHJpbnRcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHJlY29ubmVjdC5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgd2hlbiBjb21wbGV0ZS5cbiAgICovXG4gIGFzeW5jIHJlY29ubmVjdCgpIHtcbiAgICB0aGlzLmNsZWFyU2NoZW1hQ2FjaGUoKVxuICAgIGF3YWl0IHRoaXMuY2xvc2UoKVxuICAgIGF3YWl0IHRoaXMuY29ubmVjdCgpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBjcmVhdGUgZGF0YWJhc2Ugc3FsLlxuICAgKiBAYWJzdHJhY3RcbiAgICogQHBhcmFtIHtzdHJpbmd9IGRhdGFiYXNlTmFtZSAtIERhdGFiYXNlIG5hbWUuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBbYXJnc10gLSBPcHRpb25zIG9iamVjdC5cbiAgICogQHBhcmFtIHtib29sZWFufSBbYXJncy5pZk5vdEV4aXN0c10gLSBXaGV0aGVyIGlmIG5vdCBleGlzdHMuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBbYXJncy5kYXRhYmFzZUNoYXJzZXRdIC0gRGF0YWJhc2UtZGVmYXVsdCBjaGFyYWN0ZXIgc2V0IChkcml2ZXItc3BlY2lmaWM7IG15c3FsL21hcmlhZGIpLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gW2FyZ3MuZGF0YWJhc2VDb2xsYXRpb25dIC0gRGF0YWJhc2UtZGVmYXVsdCBjb2xsYXRpb24gKGRyaXZlci1zcGVjaWZpYzsgbXlzcWwvbWFyaWFkYikuXG4gICAqIEByZXR1cm5zIHtzdHJpbmdbXX0gLSBTUUwgc3RhdGVtZW50cy5cbiAgICovXG4gIGNyZWF0ZURhdGFiYXNlU3FsKGRhdGFiYXNlTmFtZSwgYXJncykgeyB0aHJvdyBuZXcgRXJyb3IoXCInY3JlYXRlRGF0YWJhc2VTcWwnIG5vdCBpbXBsZW1lbnRlZFwiKSB9IC8vIGVzbGludC1kaXNhYmxlLWxpbmUgbm8tdW51c2VkLXZhcnNcblxuICAvKipcbiAgICogUnVucyBkcm9wIGRhdGFiYXNlIHNxbC5cbiAgICogQGFic3RyYWN0XG4gICAqIEBwYXJhbSB7c3RyaW5nfSBkYXRhYmFzZU5hbWUgLSBEYXRhYmFzZSBuYW1lLlxuICAgKiBAcGFyYW0ge29iamVjdH0gW2FyZ3NdIC0gT3B0aW9ucyBvYmplY3QuXG4gICAqIEBwYXJhbSB7Ym9vbGVhbn0gW2FyZ3MuaWZFeGlzdHNdIC0gV2hldGhlciBpZiBleGlzdHMuXG4gICAqIEByZXR1cm5zIHtzdHJpbmdbXX0gLSBTUUwgc3RhdGVtZW50cy5cbiAgICovXG4gIGRyb3BEYXRhYmFzZVNxbChkYXRhYmFzZU5hbWUsIGFyZ3MpIHsgdGhyb3cgbmV3IEVycm9yKFwiJ2Ryb3BEYXRhYmFzZVNxbCcgbm90IGltcGxlbWVudGVkXCIpIH0gLy8gZXNsaW50LWRpc2FibGUtbGluZSBuby11bnVzZWQtdmFyc1xuXG4gIC8qKlxuICAgKiBSdW5zIGNyZWF0ZSBpbmRleCBzcWxzLlxuICAgKiBAYWJzdHJhY3RcbiAgICogQHBhcmFtIHtDcmVhdGVJbmRleFNxbEFyZ3N9IGluZGV4RGF0YSAtIEluZGV4IGRhdGEuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHN0cmluZ1tdPn0gLSBSZXNvbHZlcyB3aXRoIFNRTCBzdGF0ZW1lbnRzLlxuICAgKi9cbiAgYXN5bmMgY3JlYXRlSW5kZXhTUUxzKGluZGV4RGF0YSkgeyAvLyBlc2xpbnQtZGlzYWJsZS1saW5lIG5vLXVudXNlZC12YXJzXG4gICAgdGhyb3cgbmV3IEVycm9yKFwiJ2NyZWF0ZUluZGV4U1FMcycgbm90IGltcGxlbWVudGVkXCIpXG4gIH1cblxuICAvKipcbiAgICogUnVucyByZW1vdmUgaW5kZXggc3Fscy5cbiAgICogQGFic3RyYWN0XG4gICAqIEBwYXJhbSB7UmVtb3ZlSW5kZXhTcWxBcmdzfSBpbmRleERhdGEgLSBJbmRleCBkYXRhLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxzdHJpbmdbXT59IC0gUmVzb2x2ZXMgd2l0aCBTUUwgc3RhdGVtZW50cy5cbiAgICovXG4gIGFzeW5jIHJlbW92ZUluZGV4U1FMcyhpbmRleERhdGEpIHsgLy8gZXNsaW50LWRpc2FibGUtbGluZSBuby11bnVzZWQtdmFyc1xuICAgIHRocm93IG5ldyBFcnJvcihcIidyZW1vdmVJbmRleFNRTHMnIG5vdCBpbXBsZW1lbnRlZFwiKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgY3JlYXRlIHRhYmxlLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL3RhYmxlLWRhdGEvaW5kZXguanNcIikuZGVmYXVsdH0gdGFibGVEYXRhIC0gVGFibGUgZGF0YS5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgd2hlbiBjb21wbGV0ZS5cbiAgICovXG4gIGFzeW5jIGNyZWF0ZVRhYmxlKHRhYmxlRGF0YSkge1xuICAgIHRoaXMuX2Fzc2VydE5vdFJlYWRPbmx5KClcbiAgICBjb25zdCBzcWxzID0gYXdhaXQgdGhpcy5jcmVhdGVUYWJsZVNxbCh0YWJsZURhdGEpXG5cbiAgICBmb3IgKGNvbnN0IHNxbCBvZiBzcWxzKSB7XG4gICAgICBhd2FpdCB0aGlzLnF1ZXJ5KHNxbClcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogUnVucyBjcmVhdGUgdGFibGUgc3FsLlxuICAgKiBAYWJzdHJhY3RcbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi90YWJsZS1kYXRhL2luZGV4LmpzXCIpLmRlZmF1bHR9IHRhYmxlRGF0YSAtIFRhYmxlIGRhdGEuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHN0cmluZ1tdPn0gLSBSZXNvbHZlcyB3aXRoIFNRTCBzdGF0ZW1lbnRzLlxuICAgKi9cbiAgYXN5bmMgY3JlYXRlVGFibGVTcWwodGFibGVEYXRhKSB7IC8vIGVzbGludC1kaXNhYmxlLWxpbmUgbm8tdW51c2VkLXZhcnNcbiAgICB0aHJvdyBuZXcgRXJyb3IoXCInY3JlYXRlVGFibGVTcWwnIG5vdCBpbXBsZW1lbnRlZFwiKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZGVsZXRlLlxuICAgKiBAcGFyYW0ge0RlbGV0ZVNxbEFyZ3NUeXBlfSBhcmdzIC0gT3B0aW9ucyBvYmplY3QuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIHdoZW4gY29tcGxldGUuXG4gICAqL1xuICBhc3luYyBkZWxldGUoYXJncykge1xuICAgIHRoaXMuX2Fzc2VydE5vdFJlYWRPbmx5KClcbiAgICBjb25zdCBzcWwgPSB0aGlzLmRlbGV0ZVNxbChhcmdzKVxuXG4gICAgYXdhaXQgdGhpcy5xdWVyeShzcWwpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBkZWxldGUgc3FsLlxuICAgKiBAYWJzdHJhY3RcbiAgICogQHBhcmFtIHtEZWxldGVTcWxBcmdzVHlwZX0gYXJncyAtIE9wdGlvbnMgb2JqZWN0LlxuICAgKiBAcmV0dXJucyB7c3RyaW5nfSAtIFNRTCBzdHJpbmcuXG4gICAqL1xuICBkZWxldGVTcWwoYXJncykgeyAvLyBlc2xpbnQtZGlzYWJsZS1saW5lIG5vLXVudXNlZC12YXJzXG4gICAgdGhyb3cgbmV3IEVycm9yKGAnZGVsZXRlU3FsJyBub3QgaW1wbGVtZW50ZWRgKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZHJvcCB0YWJsZS5cbiAgICogQHBhcmFtIHtzdHJpbmd9IHRhYmxlTmFtZSAtIFRhYmxlIG5hbWUuXG4gICAqIEBwYXJhbSB7RHJvcFRhYmxlU3FsQXJnc1R5cGV9IFthcmdzXSAtIE9wdGlvbnMgb2JqZWN0LlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyB3aGVuIGNvbXBsZXRlLlxuICAgKi9cbiAgYXN5bmMgZHJvcFRhYmxlKHRhYmxlTmFtZSwgYXJncykge1xuICAgIHRoaXMuX2Fzc2VydE5vdFJlYWRPbmx5KClcbiAgICBjb25zdCBzcWxzID0gYXdhaXQgdGhpcy5kcm9wVGFibGVTUUxzKHRhYmxlTmFtZSwgYXJncylcblxuICAgIGZvciAoY29uc3Qgc3FsIG9mIHNxbHMpIHtcbiAgICAgIGF3YWl0IHRoaXMucXVlcnkoc3FsKVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGRyb3AgdGFibGUgc3Fscy5cbiAgICogQGFic3RyYWN0XG4gICAqIEBwYXJhbSB7c3RyaW5nfSB0YWJsZU5hbWUgLSBUYWJsZSBuYW1lLlxuICAgKiBAcGFyYW0ge0Ryb3BUYWJsZVNxbEFyZ3NUeXBlfSBbYXJnc10gLSBPcHRpb25zIG9iamVjdC5cbiAgICogQHJldHVybnMge1Byb21pc2U8c3RyaW5nW10+fSAtIFJlc29sdmVzIHdpdGggU1FMIHN0YXRlbWVudHMuXG4gICAqL1xuICBhc3luYyBkcm9wVGFibGVTUUxzKHRhYmxlTmFtZSwgYXJncykgeyAvLyBlc2xpbnQtZGlzYWJsZS1saW5lIG5vLXVudXNlZC12YXJzXG4gICAgdGhyb3cgbmV3IEVycm9yKFwiZHJvcFRhYmxlU1FMcyBub3QgaW1wbGVtZW50ZWRcIilcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGVzY2FwZS5cbiAgICogQGFic3RyYWN0XG4gICAqIEBwYXJhbSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59IHZhbHVlIC0gVmFsdWUgdG8gdXNlLlxuICAgKiBAcmV0dXJucyB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59IC0gVGhlIGVzY2FwZS5cbiAgICovXG4gIGVzY2FwZSh2YWx1ZSkgeyAvLyBlc2xpbnQtZGlzYWJsZS1saW5lIG5vLXVudXNlZC12YXJzXG4gICAgdGhyb3cgbmV3IEVycm9yKFwiJ2VzY2FwZScgbm90IGltcGxlbWVudGVkXCIpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBnZXQgYXJncy5cbiAgICogQHJldHVybnMge2ltcG9ydChcIi4uLy4uL2NvbmZpZ3VyYXRpb24tdHlwZXMuanNcIikuRGF0YWJhc2VDb25maWd1cmF0aW9uVHlwZX0gLSBUaGUgYXJncy5cbiAgICovXG4gIGdldEFyZ3MoKSB7XG4gICAgcmV0dXJuIHRoaXMuX2FyZ3NcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGdldCBjb25maWd1cmF0aW9uLlxuICAgKiBAcmV0dXJucyB7aW1wb3J0KFwiLi4vLi4vY29uZmlndXJhdGlvbi5qc1wiKS5kZWZhdWx0fSAtIFRoZSBjb25maWd1cmF0aW9uLlxuICAgKi9cbiAgZ2V0Q29uZmlndXJhdGlvbigpIHtcbiAgICBpZiAoIXRoaXMuY29uZmlndXJhdGlvbikgdGhyb3cgbmV3IEVycm9yKFwiTm8gY29uZmlndXJhdGlvbiBzZXRcIilcblxuICAgIHJldHVybiB0aGlzLmNvbmZpZ3VyYXRpb25cbiAgfVxuXG4gIC8qKlxuICAgKiBJbnN0YWxscyBhbiBvcGVyYXRpb24gbGVhc2UgYXRvbWljYWxseSB3aXRoIG9yZGluYXJ5IHRyYW5zYWN0aW9uIGFkbWlzc2lvbi5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9vcGVyYXRpb24tbGVhc2UuanNcIikuZGVmYXVsdH0gb3BlcmF0aW9uTGVhc2UgLSBBY3RpdmUgbGVhc2UuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIG9uY2UgdGhlIGxlYXNlIG93bnMgdHJhbnNhY3Rpb24gYWRtaXNzaW9uLlxuICAgKi9cbiAgYXN5bmMgc2V0T3BlcmF0aW9uTGVhc2Uob3BlcmF0aW9uTGVhc2UpIHtcbiAgICBhd2FpdCB0aGlzLl90cmFuc2FjdGlvbnNBY3Rpb25zTXV0ZXguc3luYyhhc3luYyAoKSA9PiB7XG4gICAgICBpZiAodGhpcy5fb3BlcmF0aW9uTGVhc2UpIHRocm93IG5ldyBFcnJvcihcIkEgZGF0YWJhc2Ugb3BlcmF0aW9uIGxlYXNlIGlzIGFscmVhZHkgYWN0aXZlXCIpXG4gICAgICBpZiAodGhpcy5fdHJhbnNhY3Rpb25zQ291bnQgPiAwKSB7XG4gICAgICAgIHRocm93IG5ldyBFcnJvcihcIkNhbm5vdCBzdGFydCBhIGRhdGFiYXNlIG9wZXJhdGlvbiB3aGlsZSBhbiB1bnJlbGF0ZWQgb3JkaW5hcnkgdHJhbnNhY3Rpb24gaXMgYWxyZWFkeSBhY3RpdmVcIilcbiAgICAgIH1cblxuICAgICAgdGhpcy5fb3BlcmF0aW9uTGVhc2UgPSBvcGVyYXRpb25MZWFzZVxuICAgIH0pXG4gIH1cblxuICAvKipcbiAgICogQ2xlYXJzIHRoZSBtYXRjaGluZyBvcGVyYXRpb24gbGVhc2UuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vb3BlcmF0aW9uLWxlYXNlLmpzXCIpLmRlZmF1bHR9IG9wZXJhdGlvbkxlYXNlIC0gTGVhc2UgdG8gY2xlYXIuXG4gICAqIEByZXR1cm5zIHt2b2lkfVxuICAgKi9cbiAgY2xlYXJPcGVyYXRpb25MZWFzZShvcGVyYXRpb25MZWFzZSkge1xuICAgIGlmICh0aGlzLl9vcGVyYXRpb25MZWFzZSAhPT0gb3BlcmF0aW9uTGVhc2UpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihcIkNhbm5vdCBjbGVhciBhIGRhdGFiYXNlIG9wZXJhdGlvbiBsZWFzZSBvd25lZCBieSBhbm90aGVyIG9wZXJhdGlvblwiKVxuICAgIH1cblxuICAgIHRoaXMuX29wZXJhdGlvbkxlYXNlID0gdW5kZWZpbmVkXG4gIH1cblxuICAvKipcbiAgICogV2FpdHMgZm9yIGFuIHVucmVsYXRlZCBvcGVyYXRpb24gbGVhc2UgdG8gcmVsZWFzZS5cbiAgICogQHBhcmFtIHtzeW1ib2wgfCB1bmRlZmluZWR9IG9wZXJhdGlvbk93bmVyIC0gQ2FuZGlkYXRlIG9wZXJhdGlvbiBvd25lci5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59XG4gICAqL1xuICBhc3luYyBfd2FpdEZvck9wZXJhdGlvbkxlYXNlKG9wZXJhdGlvbk93bmVyKSB7XG4gICAgY29uc3Qgb3BlcmF0aW9uTGVhc2UgPSB0aGlzLl9vcGVyYXRpb25MZWFzZVxuXG4gICAgaWYgKG9wZXJhdGlvbkxlYXNlKSBhd2FpdCBvcGVyYXRpb25MZWFzZS53YWl0KG9wZXJhdGlvbk93bmVyKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZ2V0IGlkIHNlcS5cbiAgICogQHJldHVybnMge251bWJlciB8IHVuZGVmaW5lZH0gLSBUaGUgaWQgc2VxLlxuICAgKi9cbiAgZ2V0SWRTZXEoKSB7XG4gICAgcmV0dXJuIHRoaXMuaWRTZXFcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHByaW1hcnkga2V5IHR5cGUuXG4gICAqIEByZXR1cm5zIHtzdHJpbmd9IC0gQ29uZmlndXJlZCBwcmltYXJ5IGtleSB0eXBlLCBkZWZhdWx0aW5nIHRvIFVVSUQuXG4gICAqL1xuICBwcmltYXJ5S2V5VHlwZSgpIHtcbiAgICByZXR1cm4gdGhpcy5nZXRBcmdzKCkucHJpbWFyeUtleVR5cGUgfHwgXCJ1dWlkXCJcbiAgfVxuXG4gIC8qKlxuICAgKiBDbGVhcnMgY2FjaGVkIHNjaGVtYSBtZXRhZGF0YSBmb3IgdGhpcyBkcml2ZXIgaW5zdGFuY2UuXG4gICAqIEByZXR1cm5zIHt2b2lkfSAtIE5vIHJldHVybiB2YWx1ZS5cbiAgICovXG4gIGNsZWFyU2NoZW1hQ2FjaGUoKSB7XG4gICAgaWYgKHRoaXMuX3NjaGVtYUNhY2hlSW52YWxpZGF0b3IpIHtcbiAgICAgIHRoaXMuX3NjaGVtYUNhY2hlSW52YWxpZGF0b3IoKVxuICAgICAgcmV0dXJuXG4gICAgfVxuXG4gICAgdGhpcy5fY2xlYXJMb2NhbFNjaGVtYUNhY2hlKClcbiAgfVxuXG4gIC8qKlxuICAgKiBDbGVhcnMgb25seSB0aGUgbWV0YWRhdGEgY2FjaGVkIG9uIHRoaXMgZHJpdmVyIGluc3RhbmNlLlxuICAgKiBAcmV0dXJucyB7dm9pZH0gLSBObyByZXR1cm4gdmFsdWUuXG4gICAqL1xuICBfY2xlYXJMb2NhbFNjaGVtYUNhY2hlKCkge1xuICAgIHRoaXMuX3NjaGVtYUNhY2hlLmNsZWFyKClcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHNldCBzY2hlbWEgY2FjaGUgaW52YWxpZGF0b3IuXG4gICAqIEBwYXJhbSB7KCkgPT4gdm9pZH0gaW52YWxpZGF0b3IgLSBDYWxsYmFjayB1c2VkIHRvIGNsZWFyIHNjaGVtYSBjYWNoZXMgdGhhdCBzaGFyZSB0aGlzIGRyaXZlciBwb29sLlxuICAgKiBAcmV0dXJucyB7dm9pZH0gLSBObyByZXR1cm4gdmFsdWUuXG4gICAqL1xuICBzZXRTY2hlbWFDYWNoZUludmFsaWRhdG9yKGludmFsaWRhdG9yKSB7XG4gICAgdGhpcy5fc2NoZW1hQ2FjaGVJbnZhbGlkYXRvciA9IGludmFsaWRhdG9yXG4gIH1cblxuICAvKipcbiAgICogUnVucyBzY2hlbWEgY2FjaGUgZW5hYmxlZC5cbiAgICogQHJldHVybnMge2Jvb2xlYW59IC0gV2hldGhlciBzY2hlbWEgbWV0YWRhdGEgY2FjaGluZyBpcyBlbmFibGVkLlxuICAgKi9cbiAgX3NjaGVtYUNhY2hlRW5hYmxlZCgpIHtcbiAgICByZXR1cm4gdGhpcy5nZXRBcmdzKCkuc2NoZW1hQ2FjaGUgIT09IGZhbHNlXG4gIH1cblxuICAvKipcbiAgICogUnVucyBzY2hlbWEgbWV0YWRhdGEgcmV0cnkgZGVhZGxpbmUgbXMuXG4gICAqIEByZXR1cm5zIHtudW1iZXJ9IC0gQm91bmRlZCBkZWFkbGluZSBmb3Igb3V0bGFzdGluZyB0cmFuc2llbnQgc2NoZW1hLW1ldGFkYXRhIGNvbnRlbnRpb24uXG4gICAqL1xuICBfc2NoZW1hTWV0YWRhdGFSZXRyeURlYWRsaW5lTXMoKSB7XG4gICAgY29uc3QgY29uZmlndXJlZCA9IHRoaXMuZ2V0QXJncygpLnNjaGVtYU1ldGFkYXRhUmV0cnlEZWFkbGluZU1zXG5cbiAgICByZXR1cm4gdHlwZW9mIGNvbmZpZ3VyZWQgPT09IFwibnVtYmVyXCIgPyBjb25maWd1cmVkIDogU0NIRU1BX01FVEFEQVRBX1JFVFJZX0RFQURMSU5FX01TXG4gIH1cblxuICAvKipcbiAgICogV2hldGhlciBhbiBlcnJvciByYWlzZWQgYnkgYSBzY2hlbWEtbWV0YWRhdGEgcmVhZCBpcyB0cmFuc2llbnQgY29udGVudGlvbiB0aGF0IGEgYm91bmRlZFxuICAgKiByZXRyeSBjYW4gb3V0bGFzdC4gRHJpdmVycyBvdmVycmlkZSB0aGlzIGZvciB0aGVpciBvd24gY29udGVudGlvbiBzaWduYXR1cmVzOyB0aGUgZGVmYXVsdFxuICAgKiB0cmVhdHMgZXZlcnkgZmFpbHVyZSBhcyBmaW5hbCBzbyBvbmx5IGRyaXZlcnMgdGhhdCBwcm92ZSB0aGUgdHJhbnNpZW50IHNoYXBlIHJldHJ5IGl0LlxuICAgKiBAcGFyYW0ge3Vua25vd259IF9lcnJvciAtIEVycm9yIHJhaXNlZCBieSBhIHNjaGVtYS1tZXRhZGF0YSByZWFkLlxuICAgKiBAcmV0dXJucyB7Ym9vbGVhbn0gLSBXaGV0aGVyIHRoZSByZWFkIG1heSBiZSByZXRyaWVkLlxuICAgKi9cbiAgX2lzVHJhbnNpZW50U2NoZW1hTWV0YWRhdGFFcnJvcihfZXJyb3IpIHtcbiAgICByZXR1cm4gZmFsc2VcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGEgc2NoZW1hLW1ldGFkYXRhIHJlYWQsIHJldHJ5aW5nIHRyYW5zaWVudCBjb25jdXJyZW50LURETCBjb250ZW50aW9uIHVudGlsIHRoZSBib3VuZGVkXG4gICAqIGRlYWRsaW5lLiBOb24tdHJhbnNpZW50IGZhaWx1cmVzIGFuZCBleGhhdXN0ZWQgZGVhZGxpbmVzIHByb3BhZ2F0ZSB0aGUgb3JpZ2luYWwgZXJyb3IuXG4gICAqIEB0ZW1wbGF0ZSBUXG4gICAqIEBwYXJhbSB7KCkgPT4gUHJvbWlzZTxUPn0gY2FsbGJhY2sgLSBDYWNoZS1taXNzIHNjaGVtYSByZWFkLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxUPn0gLSBSZXNvbHZlcyB3aXRoIHRoZSByZWFkIHJlc3VsdC5cbiAgICovXG4gIGFzeW5jIF93aXRoU2NoZW1hTWV0YWRhdGFEZGxSZXRyeShjYWxsYmFjaykge1xuICAgIGNvbnN0IGRlYWRsaW5lTXMgPSB0aGlzLl9zY2hlbWFNZXRhZGF0YVJldHJ5RGVhZGxpbmVNcygpXG4gICAgY29uc3Qgc3RhcnRlZEF0ID0gRGF0ZS5ub3coKVxuICAgIGxldCBkZWxheU1zID0gU0NIRU1BX01FVEFEQVRBX1JFVFJZX0lOSVRJQUxfREVMQVlfTVNcblxuICAgIGZvciAoOzspIHtcbiAgICAgIHRyeSB7XG4gICAgICAgIHJldHVybiBhd2FpdCBjYWxsYmFjaygpXG4gICAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgICBpZiAoIXRoaXMuX2lzVHJhbnNpZW50U2NoZW1hTWV0YWRhdGFFcnJvcihlcnJvcikpIHRocm93IGVycm9yXG4gICAgICAgIGlmIChEYXRlLm5vdygpIC0gc3RhcnRlZEF0ICsgZGVsYXlNcyA+IGRlYWRsaW5lTXMpIHRocm93IGVycm9yXG5cbiAgICAgICAgYXdhaXQgd2FpdChkZWxheU1zKVxuICAgICAgICBkZWxheU1zID0gTWF0aC5taW4oZGVsYXlNcyAqIDIsIFNDSEVNQV9NRVRBREFUQV9SRVRSWV9NQVhfREVMQVlfTVMpXG4gICAgICB9XG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgY2FjaGVkIHNjaGVtYSBtZXRhZGF0YS5cbiAgICogQHRlbXBsYXRlIFRcbiAgICogQHBhcmFtIHtzdHJpbmd9IGNhY2hlS2V5IC0gU2NoZW1hIGNhY2hlIGtleS5cbiAgICogQHBhcmFtIHsoKSA9PiBQcm9taXNlPFQ+fSBjYWxsYmFjayAtIENhY2hlIG1pc3MgY2FsbGJhY2suXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPFQ+fSAtIFJlc29sdmVzIHdpdGggdGhlIGNhY2hlZCBtZXRhZGF0YS5cbiAgICovXG4gIGFzeW5jIF9jYWNoZWRTY2hlbWFNZXRhZGF0YShjYWNoZUtleSwgY2FsbGJhY2spIHtcbiAgICBpZiAoIXRoaXMuX3NjaGVtYUNhY2hlRW5hYmxlZCgpKSByZXR1cm4gYXdhaXQgdGhpcy5fd2l0aFNjaGVtYU1ldGFkYXRhRGRsUmV0cnkoY2FsbGJhY2spXG5cbiAgICBjb25zdCBleGlzdGluZ1Byb21pc2UgPSB0aGlzLl9zY2hlbWFDYWNoZS5nZXQoY2FjaGVLZXkpXG5cbiAgICBpZiAoZXhpc3RpbmdQcm9taXNlKSB7XG4gICAgICByZXR1cm4gLyoqIEB0eXBlIHtUfSAqLyAodGhpcy5fc2NoZW1hQ2FjaGVSZXR1cm5WYWx1ZShhd2FpdCBleGlzdGluZ1Byb21pc2UpKVxuICAgIH1cblxuICAgIGNvbnN0IHByb21pc2UgPSAoYXN5bmMgKCkgPT4gYXdhaXQgdGhpcy5fd2l0aFNjaGVtYU1ldGFkYXRhRGRsUmV0cnkoY2FsbGJhY2spKSgpXG5cbiAgICB0aGlzLl9zY2hlbWFDYWNoZS5zZXQoY2FjaGVLZXksIHByb21pc2UpXG5cbiAgICB0cnkge1xuICAgICAgcmV0dXJuIC8qKiBAdHlwZSB7VH0gKi8gKHRoaXMuX3NjaGVtYUNhY2hlUmV0dXJuVmFsdWUoYXdhaXQgcHJvbWlzZSkpXG4gICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgIGlmICh0aGlzLl9zY2hlbWFDYWNoZS5nZXQoY2FjaGVLZXkpID09PSBwcm9taXNlKSB7XG4gICAgICAgIHRoaXMuX3NjaGVtYUNhY2hlLmRlbGV0ZShjYWNoZUtleSlcbiAgICAgIH1cblxuICAgICAgdGhyb3cgZXJyb3JcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogUnVucyBjYWNoZWQgdGFibGUgc2NoZW1hIG1ldGFkYXRhLlxuICAgKiBAdGVtcGxhdGUgVFxuICAgKiBAcGFyYW0ge3N0cmluZ30gdGFibGVOYW1lIC0gVGFibGUgbmFtZS5cbiAgICogQHBhcmFtIHtzdHJpbmd9IG1ldGFkYXRhTmFtZSAtIE1ldGFkYXRhIG5hbWUuXG4gICAqIEBwYXJhbSB7KCkgPT4gUHJvbWlzZTxUPn0gY2FsbGJhY2sgLSBDYWNoZSBtaXNzIGNhbGxiYWNrLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxUPn0gLSBSZXNvbHZlcyB3aXRoIHRoZSBjYWNoZWQgdGFibGUgbWV0YWRhdGEuXG4gICAqL1xuICBhc3luYyBfY2FjaGVkVGFibGVTY2hlbWFNZXRhZGF0YSh0YWJsZU5hbWUsIG1ldGFkYXRhTmFtZSwgY2FsbGJhY2spIHtcbiAgICByZXR1cm4gYXdhaXQgdGhpcy5fY2FjaGVkU2NoZW1hTWV0YWRhdGEoYHRhYmxlOiR7dGFibGVOYW1lfToke21ldGFkYXRhTmFtZX1gLCBjYWxsYmFjaylcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHNjaGVtYSBjYWNoZSByZXR1cm4gdmFsdWUuXG4gICAqIEBwYXJhbSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59IHZhbHVlIC0gQ2FjaGVkIHZhbHVlLlxuICAgKiBAcmV0dXJucyB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59IC0gVmFsdWUgcmV0dXJuZWQgdG8gY2FsbGVycy5cbiAgICovXG4gIF9zY2hlbWFDYWNoZVJldHVyblZhbHVlKHZhbHVlKSB7XG4gICAgaWYgKEFycmF5LmlzQXJyYXkodmFsdWUpKSByZXR1cm4gdmFsdWUuc2xpY2UoKVxuXG4gICAgcmV0dXJuIHZhbHVlXG4gIH1cblxuICAvKipcbiAgICogUnVucyBnZXQgdGFibGVzLlxuICAgKiBAYWJzdHJhY3RcbiAgICogQHJldHVybnMge1Byb21pc2U8QXJyYXk8aW1wb3J0KFwiLi9iYXNlLXRhYmxlLmpzXCIpLmRlZmF1bHQ+Pn0gLSBSZXNvbHZlcyB3aXRoIHRoZSB0YWJsZXMuXG4gICAqL1xuICBnZXRUYWJsZXMoKSB7XG4gICAgdGhyb3cgbmV3IEVycm9yKGAke3RoaXMuY29uc3RydWN0b3IubmFtZX0jZ2V0VGFibGVzIG5vdCBpbXBsZW1lbnRlZGApXG4gIH1cblxuICAvKipcbiAgICogUnVucyBzdHJ1Y3R1cmUgc3FsLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxzdHJpbmcgfCBudWxsPn0gLSBSZXNvbHZlcyB3aXRoIFNRTCBzdHJpbmcuXG4gICAqL1xuICBhc3luYyBzdHJ1Y3R1cmVTcWwoKSB7XG4gICAgcmV0dXJuIG51bGxcbiAgfVxuXG4gIC8qKlxuICAgKiBFeGVjdXRlcyBhIHdob2xlIG11bHRpLXN0YXRlbWVudCBzdHJ1Y3R1cmUgU1FMIHNjcmlwdCBpbiBhIHNpbmdsZSByb3VuZC10cmlwIHdoZW5cbiAgICogdGhlIGRyaXZlciBzdXBwb3J0cyBpdCwgcnVubmluZyBvbiB0aGlzIGNvbm5lY3Rpb24gKHNvIHRoZSBjYWxsZXIncyBmb3JlaWduLWtleVxuICAgKiBoYW5kbGluZyBhcHBsaWVzKS4gUmV0dXJucyB0cnVlIGlmIGl0IHJhbiB0aGUgd2hvbGUgc2NyaXB0OyBmYWxzZSB3aGVuIHRoZSBjYWxsZXJcbiAgICogc2hvdWxkIHJ1biB0aGUgc3RhdGVtZW50cyBpbmRpdmlkdWFsbHkuIFRoZSBiYXNlIGRyaXZlciBoYXMgbm8gYmF0Y2ggcGF0aC5cbiAgICogQHBhcmFtIHtzdHJpbmd9IF9zdHJ1Y3R1cmVTcWwgLSBGdWxsIG11bHRpLXN0YXRlbWVudCBzdHJ1Y3R1cmUgU1FMLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxib29sZWFuPn0gLSBXaGV0aGVyIHRoZSBzY3JpcHQgd2FzIGV4ZWN1dGVkIGFzIG9uZSBiYXRjaC5cbiAgICovXG4gIGFzeW5jIGV4ZWNTdHJ1Y3R1cmVTY3JpcHQoX3N0cnVjdHVyZVNxbCkge1xuICAgIHJldHVybiBmYWxzZVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZ2V0IHRhYmxlIGJ5IG5hbWUuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBuYW1lIC0gTmFtZS5cbiAgICogQHBhcmFtIHtvYmplY3R9IFthcmdzXSAtIE9wdGlvbnMgb2JqZWN0LlxuICAgKiBAcGFyYW0ge2Jvb2xlYW59IGFyZ3MudGhyb3dFcnJvciAtIFdoZXRoZXIgdGhyb3cgZXJyb3IuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPGltcG9ydChcIi4vYmFzZS10YWJsZS5qc1wiKS5kZWZhdWx0IHwgdW5kZWZpbmVkPn0gLSBSZXNvbHZlcyB3aXRoIHRoZSB0YWJsZSBieSBuYW1lLlxuICAgKi9cbiAgYXN5bmMgZ2V0VGFibGVCeU5hbWUobmFtZSwgYXJncykge1xuICAgIGNvbnN0IHRhYmxlcyA9IGF3YWl0IHRoaXMuZ2V0VGFibGVzKClcbiAgICBjb25zdCB0YWJsZU5hbWVzID0gW11cbiAgICBsZXQgdGFibGVcblxuICAgIGZvciAoY29uc3QgY2FuZGlkYXRlIG9mIHRhYmxlcykge1xuICAgICAgY29uc3QgY2FuZGlkYXRlTmFtZSA9IGNhbmRpZGF0ZS5nZXROYW1lKClcblxuICAgICAgaWYgKGNhbmRpZGF0ZU5hbWUgPT0gbmFtZSkge1xuICAgICAgICB0YWJsZSA9IGNhbmRpZGF0ZVxuICAgICAgICBicmVha1xuICAgICAgfVxuXG4gICAgICB0YWJsZU5hbWVzLnB1c2goY2FuZGlkYXRlTmFtZSlcbiAgICB9XG5cbiAgICBpZiAoIXRhYmxlICYmIGFyZ3M/LnRocm93RXJyb3IgIT09IGZhbHNlKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IodGhpcy5fbWlzc2luZ1RhYmxlRXJyb3JNZXNzYWdlKG5hbWUsIHRhYmxlTmFtZXMpKVxuICAgIH1cblxuICAgIHJldHVybiB0YWJsZVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgbWlzc2luZyB0YWJsZSBlcnJvciBtZXNzYWdlLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gbmFtZSAtIFRhYmxlIG5hbWUuXG4gICAqIEBwYXJhbSB7c3RyaW5nW119IHRhYmxlTmFtZXMgLSBBdmFpbGFibGUgdGFibGUgbmFtZXMuXG4gICAqIEByZXR1cm5zIHtzdHJpbmd9IC0gRXJyb3IgbWVzc2FnZS5cbiAgICovXG4gIF9taXNzaW5nVGFibGVFcnJvck1lc3NhZ2UobmFtZSwgdGFibGVOYW1lcykge1xuICAgIGNvbnN0IGVudmlyb25tZW50ID0gdGhpcy5nZXRDb25maWd1cmF0aW9uKCkuZ2V0RW52aXJvbm1lbnQoKVxuICAgIGNvbnN0IGFyZ3MgPSB0aGlzLmdldEFyZ3MoKVxuICAgIGNvbnN0IGRhdGFiYXNlTmFtZSA9IGFyZ3M/LmRhdGFiYXNlIHx8IGFyZ3M/Lm5hbWUgfHwgYXJncz8udXNlRGF0YWJhc2UgfHwgXCJ1bmtub3duXCJcblxuICAgIHJldHVybiBgQ291bGRuJ3QgZmluZCBhIHRhYmxlIGJ5IHRoYXQgbmFtZSBcIiR7bmFtZX1cIiBpbjogJHt0YWJsZU5hbWVzLmpvaW4oXCIsIFwiKX0gKGVudmlyb25tZW50OiAke2Vudmlyb25tZW50fSwgZGF0YWJhc2U6ICR7ZGF0YWJhc2VOYW1lfSlgXG4gIH1cblxuICAvKipcbiAgICogUnVucyBnZXQgdGFibGUgYnkgbmFtZSBvciBmYWlsLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gbmFtZSAtIE5hbWUuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPGltcG9ydChcIi4vYmFzZS10YWJsZS5qc1wiKS5kZWZhdWx0Pn0gLSBSZXNvbHZlcyB3aXRoIHRoZSB0YWJsZSBieSBuYW1lIG9yIGZhaWwuXG4gICAqL1xuICBhc3luYyBnZXRUYWJsZUJ5TmFtZU9yRmFpbChuYW1lKSB7XG4gICAgcmV0dXJuIC8qKiBAdHlwZSB7aW1wb3J0KFwiLi9iYXNlLXRhYmxlLmpzXCIpLmRlZmF1bHR9ICovIChhd2FpdCB0aGlzLmdldFRhYmxlQnlOYW1lKG5hbWUsIHt0aHJvd0Vycm9yOiB0cnVlfSkpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBnZXQgdHlwZS5cbiAgICogQGFic3RyYWN0XG4gICAqIEByZXR1cm5zIHtzdHJpbmd9IC0gVGhlIHR5cGUuXG4gICAqL1xuICBnZXRUeXBlKCkge1xuICAgIHRocm93IG5ldyBFcnJvcihcIid0eXBlJyBub3QgaW1wbGVtZW50ZWRcIilcbiAgfVxuXG4gIC8qKlxuICAgKiBXaGV0aGVyIHRoaXMgZHJpdmVyIGNhbiBjb21iaW5lIHVucmVsYXRlZCBhbHRlci10YWJsZSBvcGVyYXRpb25zIGludG8gYVxuICAgKiBzaW5nbGUgYEFMVEVSIFRBQkxFYCBzdGF0ZW1lbnQgKFJhaWxzJyBgc3VwcG9ydHNfYnVsa19hbHRlcmApLlxuICAgKiBAcmV0dXJucyB7Ym9vbGVhbn0gLSBXaGV0aGVyIGJ1bGsgYWx0ZXIgaXMgc3VwcG9ydGVkLlxuICAgKi9cbiAgc3VwcG9ydHNCdWxrQWx0ZXIoKSB7XG4gICAgcmV0dXJuIGZhbHNlXG4gIH1cblxuICAvKipcbiAgICogV2hldGhlciBhIGJ1bGsgYEFMVEVSIFRBQkxFYCBzdGF0ZW1lbnQgY2FuIGFsc28gY2FycnkgYEFERCBJTkRFWGAgY2xhdXNlcy5cbiAgICogT25seSBkcml2ZXJzIHRoYXQgc3VwcG9ydCB0aGlzIGtlZXAgaW5kZXggYWRkcyBpbnNpZGUgdGhlIGNvbWJpbmVkIGJhdGNoO1xuICAgKiB0aGUgcmVzdCBleGVjdXRlIGVhY2ggaW5kZXggYXMgaXRzIG93biBzdGF0ZW1lbnQuXG4gICAqIEByZXR1cm5zIHtib29sZWFufSAtIFdoZXRoZXIgaW5kZXhlcyBjYW4gYmUgYWRkZWQgaW5zaWRlIGEgYnVsayBhbHRlci5cbiAgICovXG4gIHN1cHBvcnRzQnVsa0FsdGVySW5kZXhlcygpIHtcbiAgICByZXR1cm4gZmFsc2VcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGluc2VydC5cbiAgICogQHBhcmFtIHtJbnNlcnRTcWxBcmdzVHlwZX0gYXJncyAtIE9wdGlvbnMgb2JqZWN0LlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyB3aGVuIGNvbXBsZXRlLlxuICAgKi9cbiAgYXN5bmMgaW5zZXJ0KGFyZ3MpIHtcbiAgICB0aGlzLl9hc3NlcnROb3RSZWFkT25seSgpXG4gICAgY29uc3Qgc3FsID0gdGhpcy5pbnNlcnRTcWwoYXJncylcblxuICAgIGF3YWl0IHRoaXMucXVlcnkoc3FsKVxuICB9XG5cbiAgLyoqXG4gICAqIE1heGltdW0gcm93cyBwZXIgYElOU0VSVCAuLi4gVkFMVUVTICguLi4pLCAoLi4uKSwgLi4uYCBzdGF0ZW1lbnQuIERyaXZlcnNcbiAgICogdGhhdCBidWlsZCBtdWx0aS12YWx1ZSBpbnNlcnRzIG11c3Qgc3RheSBiZWxvdyBkYXRhYmFzZS1zcGVjaWZpYyBsaW1pdHNcbiAgICogKFNRTGl0ZSdzIGBNQVhfVkFSSUFCTEVfTlVNQkVSYCwgU1FMIFNlcnZlcidzIDIxMDAgcGFyYW1ldGVycywgUG9zdGdyZVNRTCdzXG4gICAqIDY1NTM1IHBhcmFtZXRlcnMsIGFuZCBzbyBvbikuIDUwMCByb3dzIGlzIHNhZmVseSB1bmRlciBldmVyeSBtYWpvciBlbmdpbmVcbiAgICogZm9yIHRhYmxlcyB3aXRoIGEgbW9kZXJhdGUgbnVtYmVyIG9mIGNvbHVtbnMgYW5kIGtlZXBzIGdlbmVyYXRlZCBTUUwgc21hbGwuXG4gICAqXG4gICAqIE92ZXJyaWRlIHZpYSBgbWF4Um93c1Blckluc2VydGAgaW4gdGhlIGRhdGFiYXNlIGNvbmZpZ3VyYXRpb24uXG4gICAqIEByZXR1cm5zIHtudW1iZXJ9IC0gTWF4aW11bSByb3dzIHBlciBpbnNlcnQgc3RhdGVtZW50LlxuICAgKi9cbiAgbWF4Um93c1Blckluc2VydCgpIHtcbiAgICByZXR1cm4gb3B0aW9uYWxQb3NpdGl2ZUludGVnZXIodGhpcy5nZXRBcmdzKCkubWF4Um93c1Blckluc2VydCwgXCJtYXhSb3dzUGVySW5zZXJ0XCIpID8/IDUwMFxuICB9XG5cbiAgLyoqXG4gICAqIE1heGltdW0gc2VyaWFsaXplZCBTUUwgc2l6ZSwgaW4gYnl0ZXMsIGZvciBhIHNpbmdsZSBgSU5TRVJUIC4uLiBWQUxVRVNgXG4gICAqIHN0YXRlbWVudC4gTGFyZ2UgdGV4dC9KU09OIHBheWxvYWRzIGNhbiBwdXNoIGEgbW9kZXN0IHJvdyBjb3VudCB3ZWxsIGJleW9uZFxuICAgKiBkYXRhYmFzZSB3aXJlL3Byb3RvY29sIGxpbWl0cywgc28gY2h1bmtpbmcgYWxzbyBzdG9wcyB3aGVuIHRoZSBuZXh0IHJvd1xuICAgKiB3b3VsZCBwdXNoIHRoZSBnZW5lcmF0ZWQgc3RyaW5nIG92ZXIgdGhpcyB0aHJlc2hvbGQuXG4gICAqXG4gICAqIE92ZXJyaWRlIHZpYSBgbWF4SW5zZXJ0U3FsQnl0ZXNgIGluIHRoZSBkYXRhYmFzZSBjb25maWd1cmF0aW9uLlxuICAgKiBAcmV0dXJucyB7bnVtYmVyfSAtIE1heGltdW0gYnl0ZXMgcGVyIGluc2VydCBzdGF0ZW1lbnQuXG4gICAqL1xuICBtYXhJbnNlcnRTcWxCeXRlcygpIHtcbiAgICByZXR1cm4gb3B0aW9uYWxQb3NpdGl2ZUludGVnZXIodGhpcy5nZXRBcmdzKCkubWF4SW5zZXJ0U3FsQnl0ZXMsIFwibWF4SW5zZXJ0U3FsQnl0ZXNcIikgPz8gMTA0ODU3NlxuICB9XG5cbiAgLyoqXG4gICAqIE1heGltdW0gdmFsdWVzIGluIGEgc2luZ2xlIGBJTiAoLi4uKWAgY29ob3J0IHVzZWQgYnkgcHJlbG9hZHMsIGFzc29jaWF0aW9uXG4gICAqIGNvdW50cywgYW5kIHF1ZXJ5RGF0YSBhZ2dyZWdhdGVzLiBUaGUgZGVmYXVsdCBzdGF5cyB1bmRlciBTUUxpdGUncyBkZWZhdWx0XG4gICAqIGBNQVhfVkFSSUFCTEVfTlVNQkVSYCBjb21waWxlLXRpbWUgbGltaXQuXG4gICAqXG4gICAqIE92ZXJyaWRlIHZpYSBgbWF4SW5DbGF1c2VWYWx1ZXNgIGluIHRoZSBkYXRhYmFzZSBjb25maWd1cmF0aW9uLlxuICAgKiBAcmV0dXJucyB7bnVtYmVyfSAtIE1heGltdW0gdmFsdWVzIHBlciBJTiBjbGF1c2UgY29ob3J0LlxuICAgKi9cbiAgbWF4SW5DbGF1c2VWYWx1ZXMoKSB7XG4gICAgcmV0dXJuIG9wdGlvbmFsUG9zaXRpdmVJbnRlZ2VyKHRoaXMuZ2V0QXJncygpLm1heEluQ2xhdXNlVmFsdWVzLCBcIm1heEluQ2xhdXNlVmFsdWVzXCIpID8/IDk5OVxuICB9XG5cbiAgLyoqXG4gICAqIE1heGltdW0gc2VyaWFsaXplZCBTUUwgc2l6ZSwgaW4gYnl0ZXMsIGZvciBhIHNpbmdsZSBjb2hvcnQgcXVlcnkgdXNlZCBieVxuICAgKiBwcmVsb2FkcywgYXNzb2NpYXRpb24gY291bnRzLCBhbmQgcXVlcnlEYXRhIGFnZ3JlZ2F0ZXMuIENvaG9ydCBjaHVua2luZ1xuICAgKiBzdG9wcyB3aGVuIHRoZSBuZXh0IHZhbHVlIHdvdWxkIHB1c2ggdGhlIGdlbmVyYXRlZCBzdHJpbmcgb3ZlciB0aGlzIHRocmVzaG9sZC5cbiAgICpcbiAgICogT3ZlcnJpZGUgdmlhIGBtYXhRdWVyeVNxbEJ5dGVzYCBpbiB0aGUgZGF0YWJhc2UgY29uZmlndXJhdGlvbi5cbiAgICogQHJldHVybnMge251bWJlcn0gLSBNYXhpbXVtIGJ5dGVzIHBlciBjb2hvcnQgcXVlcnkuXG4gICAqL1xuICBtYXhRdWVyeVNxbEJ5dGVzKCkge1xuICAgIHJldHVybiBvcHRpb25hbFBvc2l0aXZlSW50ZWdlcih0aGlzLmdldEFyZ3MoKS5tYXhRdWVyeVNxbEJ5dGVzLCBcIm1heFF1ZXJ5U3FsQnl0ZXNcIikgPz8gMTA0ODU3NlxuICB9XG5cbiAgLyoqXG4gICAqIFNwbGl0cyBgdmFsdWVzYCBpbnRvIGNvaG9ydCBjaHVua3MgdGhhdCBzdGF5IHdpdGhpbiBib3RoIGBtYXhDb3VudGAgYW5kXG4gICAqIGBtYXhCeXRlc2Agd2hpbGUgcHJlc2VydmluZyBvcmRlci5cbiAgICpcbiAgICogQSBjaHVuayBhbHdheXMgY29udGFpbnMgYXQgbGVhc3Qgb25lIHZhbHVlLCBldmVuIGlmIHRoYXQgc2luZ2xlIHZhbHVlIGV4Y2VlZHNcbiAgICogdGhlIGJ5dGUgbGltaXQsIHNvIHByb2dyZXNzIGlzIGd1YXJhbnRlZWQuXG4gICAqIEB0ZW1wbGF0ZSBUXG4gICAqIEBwYXJhbSB7QXJyYXk8VD59IHZhbHVlcyAtIFZhbHVlcyB0byBjaHVuay5cbiAgICogQHBhcmFtIHsodmFsdWVzOiBBcnJheTxUPikgPT4gc3RyaW5nfSBidWlsZFNxbCAtIEZ1bmN0aW9uIHRoYXQgYnVpbGRzIHRoZSBmdWxsIFNRTCBmb3IgYSBjYW5kaWRhdGUgY2h1bmsuXG4gICAqIEBwYXJhbSB7e21heENvdW50PzogbnVtYmVyLCBtYXhCeXRlcz86IG51bWJlcn19IFtvcHRpb25zXSAtIENodW5raW5nIGJvdW5kcy5cbiAgICogQHJldHVybnMge0FycmF5PEFycmF5PFQ+Pn0gLSBWYWx1ZSBjb2hvcnRzLlxuICAgKi9cbiAgY2h1bmtWYWx1ZXModmFsdWVzLCBidWlsZFNxbCwge21heENvdW50ID0gdGhpcy5tYXhJbkNsYXVzZVZhbHVlcygpLCBtYXhCeXRlcyA9IHRoaXMubWF4UXVlcnlTcWxCeXRlcygpfSA9IHt9KSB7XG4gICAgaWYgKHZhbHVlcy5sZW5ndGggPT09IDApIHJldHVybiBbXVxuXG4gICAgLyoqXG4gICAgICogQ2h1bmtzLlxuICAgICAqIEB0eXBlIHtBcnJheTxBcnJheTxUPj59ICovXG4gICAgY29uc3QgY2h1bmtzID0gW11cbiAgICAvKipcbiAgICAgKiBDdXJyZW50IGNodW5rLlxuICAgICAqIEB0eXBlIHtBcnJheTxUPn0gKi9cbiAgICBsZXQgY3VycmVudENodW5rID0gW11cblxuICAgIGZvciAoY29uc3QgdmFsdWUgb2YgdmFsdWVzKSB7XG4gICAgICBjb25zdCBjYW5kaWRhdGUgPSBbLi4uY3VycmVudENodW5rLCB2YWx1ZV1cbiAgICAgIGNvbnN0IGNhbmRpZGF0ZUJ5dGVzID0gdXRmOEJ5dGVMZW5ndGgoYnVpbGRTcWwoY2FuZGlkYXRlKSlcblxuICAgICAgaWYgKGN1cnJlbnRDaHVuay5sZW5ndGggPiAwICYmIChjYW5kaWRhdGUubGVuZ3RoID4gbWF4Q291bnQgfHwgY2FuZGlkYXRlQnl0ZXMgPiBtYXhCeXRlcykpIHtcbiAgICAgICAgY2h1bmtzLnB1c2goY3VycmVudENodW5rKVxuICAgICAgICBjdXJyZW50Q2h1bmsgPSBbdmFsdWVdXG4gICAgICB9IGVsc2Uge1xuICAgICAgICBjdXJyZW50Q2h1bmsgPSBjYW5kaWRhdGVcbiAgICAgIH1cbiAgICB9XG5cbiAgICBpZiAoY3VycmVudENodW5rLmxlbmd0aCA+IDApIHtcbiAgICAgIGNodW5rcy5wdXNoKGN1cnJlbnRDaHVuaylcbiAgICB9XG5cbiAgICByZXR1cm4gY2h1bmtzXG4gIH1cblxuICAvKipcbiAgICogU3BsaXRzIGByb3dzYCBpbnRvIGNodW5rcyB0aGF0IHN0YXkgd2l0aGluIGJvdGgge0BsaW5rIG1heFJvd3NQZXJJbnNlcnR9XG4gICAqIGFuZCB7QGxpbmsgbWF4SW5zZXJ0U3FsQnl0ZXN9IHdoaWxlIHByZXNlcnZpbmcgb3JkZXIuXG4gICAqXG4gICAqIEJ5dGUgYWNjb3VudGluZyBpcyBpbmNyZW1lbnRhbDogYGJ1aWxkU3FsYCBpcyBjYWxsZWQgb25jZSB3aXRoIGBbXWAgdG9cbiAgICogbWVhc3VyZSB0aGUgc3RhdGVtZW50IHByZWZpeCBhbmQgb25jZSBwZXIgcm93IHdpdGggYFtyb3ddYCB0byBtZWFzdXJlIHRoZVxuICAgKiByb3cncyB2YWx1ZXMgdHVwbGUuIFRoaXMga2VlcHMgY2h1bmtpbmcgbGluZWFyIGluIHRoZSBudW1iZXIgb2Ygcm93c1xuICAgKiBpbnN0ZWFkIG9mIHJlYnVpbGRpbmcgdGhlIGZ1bGwgbXVsdGktcm93IFNRTCBmb3IgZXZlcnkgY2FuZGlkYXRlLlxuICAgKlxuICAgKiBBIGNodW5rIGFsd2F5cyBjb250YWlucyBhdCBsZWFzdCBvbmUgcm93LCBldmVuIGlmIHRoYXQgc2luZ2xlIHJvdyBleGNlZWRzXG4gICAqIHRoZSBieXRlIGxpbWl0LCBzbyBwcm9ncmVzcyBpcyBndWFyYW50ZWVkLlxuICAgKiBAcGFyYW0ge0FycmF5PEFycmF5PFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pj59IHJvd3MgLSBSb3dzIHRvIGluc2VydC5cbiAgICogQHBhcmFtIHsocm93czogQXJyYXk8QXJyYXk8UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+PikgPT4gc3RyaW5nfSBidWlsZFNxbCAtIEZ1bmN0aW9uIHRoYXQgYnVpbGRzIHRoZSBmdWxsIFNRTCBmb3IgYSBjYW5kaWRhdGUgY2h1bms7IGNhbGxlZCB3aXRoIGBbXWAgdG8gbWVhc3VyZSB0aGUgc3RhdGVtZW50IHByZWZpeCBhbmQgd2l0aCBgW3Jvd11gIHRvIG1lYXN1cmUgZWFjaCByb3cncyB2YWx1ZXMgdHVwbGUuXG4gICAqIEByZXR1cm5zIHtBcnJheTxBcnJheTxBcnJheTxSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj4+Pn0gLSBSb3cgY2h1bmtzLlxuICAgKi9cbiAgX2luc2VydE11bHRpcGxlQ2h1bmtzKHJvd3MsIGJ1aWxkU3FsKSB7XG4gICAgY29uc3QgY2h1bmtzID0gW11cbiAgICBjb25zdCBtYXhSb3dzID0gdGhpcy5tYXhSb3dzUGVySW5zZXJ0KClcbiAgICBjb25zdCBtYXhCeXRlcyA9IHRoaXMubWF4SW5zZXJ0U3FsQnl0ZXMoKVxuICAgIGNvbnN0IGVtcHR5U3FsID0gYnVpbGRTcWwoW10pXG4gICAgY29uc3QgcHJlZml4ID0gYCR7ZW1wdHlTcWx9IFZBTFVFUyBgXG4gICAgY29uc3QgYmFzZUJ5dGVMZW5ndGggPSB1dGY4Qnl0ZUxlbmd0aChwcmVmaXgpXG5cbiAgICAvKipcbiAgICAgKiBDdXJyZW50IGNodW5rLlxuICAgICAqIEB0eXBlIHtBcnJheTxBcnJheTxSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj4+fSAqL1xuICAgIGxldCBjdXJyZW50Q2h1bmsgPSBbXVxuICAgIGxldCBjdXJyZW50Qnl0ZXMgPSAwXG5cbiAgICBmb3IgKGNvbnN0IHJvdyBvZiByb3dzKSB7XG4gICAgICBjb25zdCBzaW5nbGVSb3dTcWwgPSBidWlsZFNxbChbcm93XSlcbiAgICAgIGNvbnN0IHJvd1ZhbHVlc1NxbCA9IHNpbmdsZVJvd1NxbC5zbGljZShwcmVmaXgubGVuZ3RoKVxuICAgICAgY29uc3Qgcm93VmFsdWVzU3FsQnl0ZXMgPSB1dGY4Qnl0ZUxlbmd0aChyb3dWYWx1ZXNTcWwpXG5cbiAgICAgIGlmIChjdXJyZW50Q2h1bmsubGVuZ3RoID4gMCkge1xuICAgICAgICBjb25zdCBjYW5kaWRhdGVSb3dzID0gY3VycmVudENodW5rLmxlbmd0aCArIDFcbiAgICAgICAgY29uc3QgY2FuZGlkYXRlQnl0ZXMgPSBjdXJyZW50Qnl0ZXMgKyAyICsgcm93VmFsdWVzU3FsQnl0ZXMgLy8gXCIsIFwiIHNlcGFyYXRvclxuXG4gICAgICAgIGlmIChjYW5kaWRhdGVSb3dzID4gbWF4Um93cyB8fCBjYW5kaWRhdGVCeXRlcyA+IG1heEJ5dGVzKSB7XG4gICAgICAgICAgY2h1bmtzLnB1c2goY3VycmVudENodW5rKVxuICAgICAgICAgIGN1cnJlbnRDaHVuayA9IFtdXG4gICAgICAgICAgY3VycmVudEJ5dGVzID0gMFxuICAgICAgICB9XG4gICAgICB9XG5cbiAgICAgIGlmIChjdXJyZW50Q2h1bmsubGVuZ3RoID09PSAwKSB7XG4gICAgICAgIGN1cnJlbnRCeXRlcyA9IGJhc2VCeXRlTGVuZ3RoICsgcm93VmFsdWVzU3FsQnl0ZXNcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIGN1cnJlbnRCeXRlcyArPSAyICsgcm93VmFsdWVzU3FsQnl0ZXNcbiAgICAgIH1cblxuICAgICAgY3VycmVudENodW5rLnB1c2gocm93KVxuICAgIH1cblxuICAgIGlmIChjdXJyZW50Q2h1bmsubGVuZ3RoID4gMCkge1xuICAgICAgY2h1bmtzLnB1c2goY3VycmVudENodW5rKVxuICAgIH1cblxuICAgIHJldHVybiBjaHVua3NcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGluc2VydCBtdWx0aXBsZS5cbiAgICpcbiAgICogTGFyZ2Ugcm93IHNldHMgYXJlIHNwbGl0IGludG8gbXVsdGlwbGUgc3RhdGVtZW50cyB0aGF0IGVhY2ggc3RheSB3aXRoaW5cbiAgICoge0BsaW5rIG1heFJvd3NQZXJJbnNlcnR9IHJvd3MgYW5kIHtAbGluayBtYXhJbnNlcnRTcWxCeXRlc30gc2VyaWFsaXplZFxuICAgKiBieXRlcyBzbyB0aGUgZ2VuZXJhdGVkIFNRTCBzdGF5cyB3aXRoaW4gZGF0YWJhc2UgcGFyYW1ldGVyIGFuZCB3aXJlIGxpbWl0cy5cbiAgICogV2hlbiBjYWxsZWQgb3V0c2lkZSBhIHRyYW5zYWN0aW9uIGVhY2ggY2h1bmsgY29tbWl0cyBpbmRlcGVuZGVudGx5OyBjYWxsZXJzXG4gICAqIHRoYXQgbmVlZCBhbGwtb3Itbm90aGluZyBzZW1hbnRpY3Mgc2hvdWxkIHdyYXAgdGhlIGNhbGwgaW4ge0BsaW5rIHRyYW5zYWN0aW9ufS5cbiAgICogQHBhcmFtIHtzdHJpbmd9IHRhYmxlTmFtZSAtIFRhYmxlIG5hbWUuXG4gICAqIEBwYXJhbSB7QXJyYXk8c3RyaW5nPn0gY29sdW1ucyAtIENvbHVtbiBuYW1lcy5cbiAgICogQHBhcmFtIHtBcnJheTxBcnJheTxSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj4+fSByb3dzIC0gUm93cyB0byBpbnNlcnQuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIHdoZW4gY29tcGxldGUuXG4gICAqL1xuICBhc3luYyBpbnNlcnRNdWx0aXBsZSh0YWJsZU5hbWUsIGNvbHVtbnMsIHJvd3MpIHtcbiAgICB0aGlzLl9hc3NlcnROb3RSZWFkT25seSgpXG5cbiAgICBjb25zdCBjaHVua3MgPSB0aGlzLl9pbnNlcnRNdWx0aXBsZUNodW5rcyhyb3dzLCAoY2h1bmtSb3dzKSA9PiB0aGlzLmluc2VydFNxbCh7Y29sdW1ucywgdGFibGVOYW1lLCByb3dzOiBjaHVua1Jvd3N9KSlcblxuICAgIGZvciAoY29uc3QgY2h1bmsgb2YgY2h1bmtzKSB7XG4gICAgICBjb25zdCBzcWwgPSB0aGlzLmluc2VydFNxbCh7Y29sdW1ucywgdGFibGVOYW1lLCByb3dzOiBjaHVua30pXG5cbiAgICAgIGF3YWl0IHRoaXMucXVlcnkoc3FsKVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGluc2VydCBzcWwuXG4gICAqIEBhYnN0cmFjdFxuICAgKiBAcGFyYW0ge0luc2VydFNxbEFyZ3NUeXBlfSBhcmdzIC0gT3B0aW9ucyBvYmplY3QuXG4gICAqIEByZXR1cm5zIHtzdHJpbmd9IC0gU1FMIHN0cmluZy5cbiAgICovXG4gIGluc2VydFNxbChhcmdzKSB7IC8vIGVzbGludC1kaXNhYmxlLWxpbmUgbm8tdW51c2VkLXZhcnNcbiAgICB0aHJvdyBuZXcgRXJyb3IoXCInaW5zZXJ0U3FsJyBub3QgaW1wbGVtZW50ZWRcIilcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHVwc2VydC5cbiAgICogQHBhcmFtIHtVcHNlcnRTcWxBcmdzVHlwZX0gYXJncyAtIE9wdGlvbnMgb2JqZWN0LlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyB3aGVuIGNvbXBsZXRlLlxuICAgKi9cbiAgYXN5bmMgdXBzZXJ0KGFyZ3MpIHtcbiAgICB0aGlzLl9hc3NlcnROb3RSZWFkT25seSgpXG4gICAgY29uc3Qgc3FsID0gdGhpcy51cHNlcnRTcWwoYXJncylcblxuICAgIGF3YWl0IHRoaXMucXVlcnkoc3FsKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgbGFzdCBpbnNlcnQgaWQuXG4gICAqIEBhYnN0cmFjdFxuICAgKiBAcGFyYW0ge1F1ZXJ5T3B0aW9uc30gW19vcHRpb25zXSAtIFF1ZXJ5IG93bmVyc2hpcCBvcHRpb25zLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxudW1iZXI+fSAtIFJlc29sdmVzIHdpdGggdGhlIGxhc3QgaW5zZXJ0IGlkLlxuICAgKi9cbiAgbGFzdEluc2VydElEKF9vcHRpb25zID0ge30pIHtcbiAgICB0aHJvdyBuZXcgRXJyb3IoYCR7dGhpcy5jb25zdHJ1Y3Rvci5uYW1lfSNsYXN0SW5zZXJ0SUQgbm90IGltcGxlbWVudGVkYClcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGNvbnZlcnQgdmFsdWUuXG4gICAqIEBwYXJhbSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59IHZhbHVlIC0gVmFsdWUgdG8gdXNlLlxuICAgKiBAcmV0dXJucyB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59IC0gVGhlIGNvbnZlcnQgdmFsdWUuXG4gICAqL1xuICBfY29udmVydFZhbHVlKHZhbHVlKSB7XG4gICAgaWYgKHR5cGVvZiB2YWx1ZSA9PT0gXCJib29sZWFuXCIpIHtcbiAgICAgIHJldHVybiB2YWx1ZSA/IDEgOiAwXG4gICAgfVxuXG4gICAgLy8gaXNEYXRlIGluc3RlYWQgb2YgaW5zdGFuY2VvZjogYSBEYXRlIGNyZWF0ZWQgaW4gYW5vdGhlciByZWFsbSAoZS5nLiB0aGUgY29uc29sZSBSRVBMKSB3b3VsZFxuICAgIC8vIGZhaWwgaW5zdGFuY2VvZiwgc2tpcCB0aGlzIGNvbnZlcnNpb24sIGFuZCBzZXJpYWxpemUgYXMgYW4gZW1wdHkgU1FMIHZhbHVlIGRvd25zdHJlYW0uXG4gICAgaWYgKGlzRGF0ZSh2YWx1ZSkpIHtcbiAgICAgIHJldHVybiBmb3JtYXREYXRlRm9yRGF0YWJhc2UodmFsdWUsIHtkYXRhYmFzZVR5cGU6IHRoaXMuZ2V0VHlwZSgpfSlcbiAgICB9XG5cbiAgICAvLyBKU09OLWVuY29kZSBwbGFpbiBvYmplY3RzL2FycmF5cyBzbyB0aGV5IGxhbmQgaW4gSlNPTi90ZXh0IGNvbHVtbnMgYXMgdmFsaWRcbiAgICAvLyBKU09OLiBXaXRob3V0IHRoaXMsIGRyaXZlcnMgbGlrZSBteXNxbCdzIGVzY2FwZSgpIHR1cm4gYW4gb2JqZWN0IGludG9cbiAgICAvLyBga2V5YCA9IHZhbHVlIGFzc2lnbm1lbnQgcGFpcnMgKGl0cyBgU0VUID9gIGZvcm0pLCBwcm9kdWNpbmcgaW52YWxpZCBTUUwgaW5cbiAgICAvLyBhIHZhbHVlIHBvc2l0aW9uLiBPbmx5IFBMQUlOIG9iamVjdHMgYW5kIGFycmF5cyBhcmUgZW5jb2RlZCDigJQgY2xhc3NcbiAgICAvLyBpbnN0YW5jZXMgKGUuZy4gbW9kZWwgcmVjb3Jkcywgd2hpY2ggYXJlIGNpcmN1bGFyIHZpYSBfY2hhbmdlcykgYW5kIEJ1ZmZlcnNcbiAgICAvLyBwYXNzIHRocm91Z2ggdW50b3VjaGVkLCBzaW5jZSBKU09OLnN0cmluZ2lmeSBvbiBhIHJlY29yZCB0aHJvd3Mgb24gaXRzXG4gICAgLy8gY2lyY3VsYXIgc3RydWN0dXJlIGFuZCBhIHJlY29yZCBpcyBuZXZlciBhIHZhbGlkIGNvbHVtbiB2YWx1ZSB0byBzZXJpYWxpemUuXG4gICAgaWYgKHRoaXMuX2lzSnNvbkVuY29kYWJsZVZhbHVlKHZhbHVlKSkge1xuICAgICAgcmV0dXJuIEpTT04uc3RyaW5naWZ5KHZhbHVlKVxuICAgIH1cblxuICAgIHJldHVybiB2YWx1ZVxuICB9XG5cbiAgLyoqXG4gICAqIFdoZXRoZXIgYSB2YWx1ZSBpcyBhIHBsYWluIG9iamVjdCBvciBhcnJheSB0aGF0IHNob3VsZCBiZSBKU09OLWVuY29kZWQgZm9yIGFcbiAgICogSlNPTi90ZXh0IGNvbHVtbi4gRXhjbHVkZXMgQnVmZmVycyBhbmQgY2xhc3MgaW5zdGFuY2VzIChlLmcuIG1vZGVsIHJlY29yZHMpLlxuICAgKiBAcGFyYW0ge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSB2YWx1ZSAtIFZhbHVlIHRvIHRlc3QuXG4gICAqIEByZXR1cm5zIHtib29sZWFufSAtIFdoZXRoZXIgdG8gSlNPTi1lbmNvZGUgdGhlIHZhbHVlLlxuICAgKi9cbiAgX2lzSnNvbkVuY29kYWJsZVZhbHVlKHZhbHVlKSB7XG4gICAgaWYgKHZhbHVlID09PSBudWxsIHx8IHR5cGVvZiB2YWx1ZSAhPT0gXCJvYmplY3RcIikgcmV0dXJuIGZhbHNlXG4gICAgaWYgKHR5cGVvZiBCdWZmZXIgIT09IFwidW5kZWZpbmVkXCIgJiYgQnVmZmVyLmlzQnVmZmVyKHZhbHVlKSkgcmV0dXJuIGZhbHNlXG4gICAgaWYgKEFycmF5LmlzQXJyYXkodmFsdWUpKSByZXR1cm4gdHJ1ZVxuXG4gICAgY29uc3QgcHJvdG90eXBlID0gT2JqZWN0LmdldFByb3RvdHlwZU9mKHZhbHVlKVxuXG4gICAgcmV0dXJuIHByb3RvdHlwZSA9PT0gT2JqZWN0LnByb3RvdHlwZSB8fCBwcm90b3R5cGUgPT09IG51bGxcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIG9wdGlvbnMuXG4gICAqIEBhYnN0cmFjdFxuICAgKiBAcmV0dXJucyB7aW1wb3J0KFwiLi4vcXVlcnktcGFyc2VyL29wdGlvbnMuanNcIikuZGVmYXVsdH0gLSBUaGUgb3B0aW9ucyBvcHRpb25zLlxuICAgKi9cbiAgb3B0aW9ucygpIHtcbiAgICB0aHJvdyBuZXcgRXJyb3IoXCInb3B0aW9ucycgbm90IGltcGxlbWVudGVkLlwiKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgcXVvdGUuXG4gICAqIEBwYXJhbSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59IHZhbHVlIC0gVmFsdWUgdG8gdXNlLlxuICAgKiBAcmV0dXJucyB7bnVtYmVyIHwgc3RyaW5nfSAtIFRoZSBxdW90ZS5cbiAgICovXG4gIHF1b3RlKHZhbHVlKSB7XG4gICAgaWYgKHR5cGVvZiB2YWx1ZSA9PSBcIm51bWJlclwiKSByZXR1cm4gdmFsdWVcblxuICAgIGNvbnN0IGVzY2FwZWRWYWx1ZSA9IHRoaXMuZXNjYXBlKHZhbHVlKVxuICAgIGNvbnN0IHJlc3VsdCA9IGBcIiR7ZXNjYXBlZFZhbHVlfVwiYFxuXG4gICAgcmV0dXJuIHJlc3VsdFxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgcXVvdGUgY29sdW1uLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gY29sdW1uTmFtZSAtIENvbHVtbiBuYW1lLlxuICAgKiBAcmV0dXJucyB7c3RyaW5nfSAtIFRoZSBxdW90ZSBjb2x1bW4uXG4gICAqL1xuICBxdW90ZUNvbHVtbihjb2x1bW5OYW1lKSB7XG4gICAgcmV0dXJuIHRoaXMub3B0aW9ucygpLnF1b3RlQ29sdW1uTmFtZShjb2x1bW5OYW1lKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgcXVvdGUgaW5kZXguXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBjb2x1bW5OYW1lIC0gQ29sdW1uIG5hbWUuXG4gICAqIEByZXR1cm5zIHtzdHJpbmd9IC0gVGhlIHF1b3RlIGluZGV4LlxuICAgKi9cbiAgcXVvdGVJbmRleChjb2x1bW5OYW1lKSB7XG4gICAgcmV0dXJuIHRoaXMub3B0aW9ucygpLnF1b3RlSW5kZXhOYW1lKGNvbHVtbk5hbWUpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBxdW90ZSB0YWJsZS5cbiAgICogQHBhcmFtIHtzdHJpbmd9IHRhYmxlTmFtZSAtIFRhYmxlIG5hbWUuXG4gICAqIEByZXR1cm5zIHtzdHJpbmd9IC0gVGhlIHF1b3RlIHRhYmxlLlxuICAgKi9cbiAgcXVvdGVUYWJsZSh0YWJsZU5hbWUpIHtcbiAgICByZXR1cm4gdGhpcy5vcHRpb25zKCkucXVvdGVUYWJsZU5hbWUodGFibGVOYW1lKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgbmV3IHF1ZXJ5LlxuICAgKiBAcmV0dXJucyB7UXVlcnl9IC0gVGhlIG5ldyBxdWVyeS5cbiAgICovXG4gIG5ld1F1ZXJ5KCkge1xuICAgIGNvbnN0IGhhbmRsZXIgPSBuZXcgSGFuZGxlcigpXG5cbiAgICByZXR1cm4gbmV3IFF1ZXJ5KHtcbiAgICAgIGRyaXZlcjogdGhpcyxcbiAgICAgIGhhbmRsZXJcbiAgICB9KVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgc2VsZWN0LlxuICAgKiBAcGFyYW0ge3N0cmluZ30gdGFibGVOYW1lIC0gVGFibGUgbmFtZS5cbiAgICogQHJldHVybnMge1Byb21pc2U8UXVlcnlSZXN1bHRUeXBlPn0gLSBSZXNvbHZlcyB3aXRoIHRoZSBzZWxlY3QuXG4gICAqL1xuICBhc3luYyBzZWxlY3QodGFibGVOYW1lKSB7XG4gICAgY29uc3QgcXVlcnkgPSB0aGlzLm5ld1F1ZXJ5KClcblxuICAgIGNvbnN0IHNxbCA9IHF1ZXJ5XG4gICAgICAuZnJvbSh0YWJsZU5hbWUpXG4gICAgICAudG9TcWwoKVxuXG4gICAgcmV0dXJuIGF3YWl0IHRoaXMucXVlcnkoc3FsKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgc2V0IGlkIHNlcS5cbiAgICogQHBhcmFtIHtudW1iZXIgfCB1bmRlZmluZWR9IG5ld0lkU2VxIC0gTmV3IGlkIHNlcS5cbiAgICogQHJldHVybnMge3ZvaWR9IC0gTm8gcmV0dXJuIHZhbHVlLlxuICAgKi9cbiAgc2V0SWRTZXEobmV3SWRTZXEpIHtcbiAgICB0aGlzLmlkU2VxID0gbmV3SWRTZXFcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHNob3VsZCBzZXQgYXV0byBpbmNyZW1lbnQgd2hlbiBwcmltYXJ5IGtleS5cbiAgICogQGFic3RyYWN0XG4gICAqIEByZXR1cm5zIHtib29sZWFufSAtIFdoZXRoZXIgc2V0IGF1dG8gaW5jcmVtZW50IHdoZW4gcHJpbWFyeSBrZXkuXG4gICAqL1xuICBzaG91bGRTZXRBdXRvSW5jcmVtZW50V2hlblByaW1hcnlLZXkoKSB7XG4gICAgdGhyb3cgbmV3IEVycm9yKGAnc2hvdWxkU2V0QXV0b0luY3JlbWVudFdoZW5QcmltYXJ5S2V5JyBub3QgaW1wbGVtZW50ZWRgKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgc3VwcG9ydHMgZGVmYXVsdCBwcmltYXJ5IGtleSB1dWlkLlxuICAgKiBAcmV0dXJucyB7Ym9vbGVhbn0gLSBXaGV0aGVyIHN1cHBvcnRzIGRlZmF1bHQgcHJpbWFyeSBrZXkgdXVpZC5cbiAgICovXG4gIHN1cHBvcnRzRGVmYXVsdFByaW1hcnlLZXlVVUlEKCkgeyByZXR1cm4gZmFsc2UgfVxuXG4gIC8qKlxuICAgKiBFeGVjdXRlcyBhbiBpbnNlcnQgdGhhdCBjYXJyaWVzIGFuIGV4cGxpY2l0IHByaW1hcnkta2V5IHZhbHVlXG4gICAqIChjbGllbnQtZ2VuZXJhdGVkIG9mZmxpbmUtc3luYyBpZHMpLiBEcml2ZXJzIHdob3NlIGF1dG8taW5jcmVtZW50IGNvbHVtbnNcbiAgICogcmVqZWN0IGV4cGxpY2l0IHZhbHVlcyAoTVNTUUwgSURFTlRJVFkpIG92ZXJyaWRlIHRoaXMgdG8gcnVuIHRoZSBpbnNlcnRcbiAgICogd2l0aCBpZGVudGl0eSBpbnNlcnQgZW5hYmxlZCBpbiBhIHNpbmdsZSByZXF1ZXN0LlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIE9wdGlvbnMgb2JqZWN0LlxuICAgKiBAcGFyYW0ge1F1ZXJ5T3B0aW9uc30gYXJncy5vcHRpb25zIC0gUXVlcnkgb3B0aW9ucyBmb3IgdGhlIHN0YW5kYXJkIHF1ZXJ5IHBhdGguXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBhcmdzLnNxbCAtIEdlbmVyYXRlZCBpbnNlcnQgU1FMLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gYXJncy50YWJsZU5hbWUgLSBUYWJsZSBiZWluZyBpbnNlcnRlZCBpbnRvLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxRdWVyeVJlc3VsdFR5cGU+fSAtIEluc2VydCByZXN1bHQuXG4gICAqL1xuICBhc3luYyBpbnNlcnRXaXRoRXhwbGljaXRQcmltYXJ5S2V5KHtvcHRpb25zLCBzcWwsIHRhYmxlTmFtZX0pIHtcbiAgICB2b2lkIHRhYmxlTmFtZVxuXG4gICAgcmV0dXJuIGF3YWl0IHRoaXMucXVlcnkoc3FsLCBvcHRpb25zKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgc3VwcG9ydHMgaW5zZXJ0IGludG8gcmV0dXJuaW5nLlxuICAgKiBAYWJzdHJhY3RcbiAgICogQHJldHVybnMge2Jvb2xlYW59IC0gV2hldGhlciBzdXBwb3J0cyBpbnNlcnQgaW50byByZXR1cm5pbmcuXG4gICAqL1xuICBzdXBwb3J0c0luc2VydEludG9SZXR1cm5pbmcoKSB7IHJldHVybiBmYWxzZSB9XG5cbiAgLyoqXG4gICAqIFdoZXRoZXIgYSBzaW5nbGUgY29ubmVjdGlvbiBjYW4gcmVmZXJlbmNlIHRhYmxlcyBpbiBhbm90aGVyIGRhdGFiYXNlIG9uIHRoZSBzYW1lIHNlcnZlciB2aWEgYVxuICAgKiB0d28tcGFydCBgZGF0YWJhc2VgLmB0YWJsZWAgaWRlbnRpZmllci4gV2hlbiB0cnVlLCBhIHF1ZXJ5IHNwYW5uaW5nIHNldmVyYWwgZGF0YWJhc2VzIG9uIHRoaXNcbiAgICogc2VydmVyIGNhbiBiZSBleHByZXNzZWQgYXMgb25lIHN0YXRlbWVudCAoYSBjcm9zcy10ZW5hbnQgYFVOSU9OIEFMTGApOyB3aGVuIGZhbHNlLCBlYWNoIGRhdGFiYXNlXG4gICAqIGlzIHF1ZXJpZWQgb24gaXRzIG93biBjb25uZWN0aW9uIGFuZCB0aGUgcmVzdWx0cyBtZXJnZWQgaW4gdGhlIGNhbGxlci4gT25seSBNeVNRTC9NYXJpYURCIHJldHVyblxuICAgKiB0cnVlOiBQb3N0Z3JlU1FMIChvbmUgZGF0YWJhc2UgcGVyIGNvbm5lY3Rpb24pIGFuZCBTUUxpdGUgKG9uZSBhdHRhY2hlZCBmaWxlIHBlciBjb25uZWN0aW9uKVxuICAgKiBjYW5ub3QsIGFuZCBNU1NRTCBpcyBleGNsdWRlZCBiZWNhdXNlIGl0IHJlYWRzIGEgdHdvLXBhcnQgbmFtZSBhcyBgc2NoZW1hLnRhYmxlYCAoY3Jvc3MtZGF0YWJhc2VcbiAgICogYWNjZXNzIG5lZWRzIGEgdGhyZWUtcGFydCBgZGF0YWJhc2Uuc2NoZW1hLnRhYmxlYCksIHNvIGl0IHN0YXlzIG9uIHRoZSBhbHdheXMtY29ycmVjdCBmYW4tb3V0XG4gICAqIHBhdGguIENvbnN1bWVkIGJ5IGBUZW5hbnQuYWdncmVnYXRlQWNyb3NzYC5cbiAgICogQHJldHVybnMge2Jvb2xlYW59IC0gV2hldGhlciB0d28tcGFydCBjcm9zcy1kYXRhYmFzZSByZWZlcmVuY2VzIGFyZSBzdXBwb3J0ZWQuXG4gICAqL1xuICBzdXBwb3J0c0Nyb3NzRGF0YWJhc2VSZWZlcmVuY2VzKCkgeyByZXR1cm4gZmFsc2UgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHRhYmxlIGV4aXN0cy5cbiAgICogQHBhcmFtIHtzdHJpbmd9IHRhYmxlTmFtZSAtIFRhYmxlIG5hbWUuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPGJvb2xlYW4+fSAtIFJlc29sdmVzIHdpdGggV2hldGhlciB0YWJsZSBleGlzdHMuXG4gICAqL1xuICBhc3luYyB0YWJsZUV4aXN0cyh0YWJsZU5hbWUpIHtcbiAgICBjb25zdCB0YWJsZXMgPSBhd2FpdCB0aGlzLmdldFRhYmxlcygpXG4gICAgY29uc3QgdGFibGUgPSB0YWJsZXMuZmluZCgodGFibGUpID0+IHRhYmxlLmdldE5hbWUoKSA9PSB0YWJsZU5hbWUpXG5cbiAgICBpZiAodGFibGUpIHJldHVybiB0cnVlXG5cbiAgICByZXR1cm4gZmFsc2VcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGEgY2FsbGJhY2sgaW5zaWRlIGEgZGF0YWJhc2UgdHJhbnNhY3Rpb24gKG9yIGEgc2F2ZXBvaW50IHdoZW4gYWxyZWFkeSBpbnNpZGUgb25lKS5cbiAgICogVGhlIG91dGVybW9zdCB0cmFuc2FjdGlvbiByZXRyaWVzIHRoZSB3aG9sZSBjYWxsYmFjayBvbiBhIGRlYWRsb2NrIC8gbG9jay13YWl0LXRpbWVvdXQsXG4gICAqIGJlY2F1c2Ugc3VjaCBlcnJvcnMgcm9sbCB0aGUgZW50aXJlIHRyYW5zYWN0aW9uIGJhY2sgYW5kIHRoZSBzdGFuZGFyZCByZWNvdmVyeSBpcyB0b1xuICAgKiByZXN0YXJ0IGl0LiBOZXN0ZWQgc2F2ZXBvaW50cyBsZXQgdGhlIGRlYWRsb2NrIGJ1YmJsZSB1cCB0byB0aGlzIG91dGVyIHJldHJ5LlxuICAgKiBAdGVtcGxhdGUgVFxuICAgKiBAcGFyYW0geygpID0+IFByb21pc2U8VD59IGNhbGxiYWNrIC0gQ2FsbGJhY2sgZnVuY3Rpb24uXG4gICAqIEBwYXJhbSB7UGljazxRdWVyeU9wdGlvbnMsIFwib3BlcmF0aW9uT3duZXJcIj59IFtvcHRpb25zXSAtIFRyYW5zYWN0aW9uIG93bmVyc2hpcC5cbiAgICogQHJldHVybnMge1Byb21pc2U8VD59IC0gUmVzb2x2ZXMgd2l0aCB0aGUgdHJhbnNhY3Rpb24gcmVzdWx0LlxuICAgKi9cbiAgYXN5bmMgdHJhbnNhY3Rpb24oY2FsbGJhY2ssIG9wdGlvbnMgPSB7fSkge1xuICAgIGF3YWl0IHRoaXMuX3dhaXRGb3JPcGVyYXRpb25MZWFzZShvcHRpb25zLm9wZXJhdGlvbk93bmVyKVxuXG4gICAgcmV0dXJuIGF3YWl0IGNvb3JkaW5hdGVTaGFyZWRUcmFuc2FjdGlvbkNvbm5lY3Rpb24odGhpcywgYXN5bmMgKCkgPT4ge1xuICAgICAgaWYgKHRoaXMuX3RyYW5zYWN0aW9uc0NvdW50ID4gMCkge1xuICAgICAgICByZXR1cm4gYXdhaXQgdGhpcy5fcnVuVHJhbnNhY3Rpb25BdHRlbXB0KGNhbGxiYWNrLCBvcHRpb25zKVxuICAgICAgfVxuXG4gICAgICBjb25zdCBhcmdzID0gdGhpcy5nZXRBcmdzKClcbiAgICAgIGNvbnN0IG1heEF0dGVtcHRzID0gb3B0aW9uYWxQb3NpdGl2ZUludGVnZXIoYXJncy5kZWFkbG9ja01heFJldHJpZXMsIFwiZGVhZGxvY2tNYXhSZXRyaWVzXCIpID8/IDhcbiAgICAgIGNvbnN0IGNvbmZpZ3VyZWRCYXNlV2FpdE1zID0gb3B0aW9uYWxQb3NpdGl2ZUludGVnZXIoYXJncy5kZWFkbG9ja0Jhc2VXYWl0TXMsIFwiZGVhZGxvY2tCYXNlV2FpdE1zXCIpXG4gICAgICBjb25zdCBkZWFkbG9ja01heFdhaXRNcyA9IG9wdGlvbmFsUG9zaXRpdmVJbnRlZ2VyKGFyZ3MuZGVhZGxvY2tNYXhXYWl0TXMsIFwiZGVhZGxvY2tNYXhXYWl0TXNcIikgPz8gMTAwMFxuICAgICAgbGV0IGF0dGVtcHQgPSAwXG5cbiAgICAgIHdoaWxlICh0cnVlKSB7XG4gICAgICAgIGF0dGVtcHQrK1xuICAgICAgICBjb25zdCBhdHRlbXB0U3RhcnRlZEF0TXMgPSB0aGlzLl9ub3dNcygpXG5cbiAgICAgICAgdHJ5IHtcbiAgICAgICAgICByZXR1cm4gYXdhaXQgdGhpcy5fcnVuVHJhbnNhY3Rpb25BdHRlbXB0KGNhbGxiYWNrLCBvcHRpb25zKVxuICAgICAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgICAgIGlmIChlcnJvciBpbnN0YW5jZW9mIFZlbG9jaW91c0RhdGFiYXNlQWZ0ZXJDb21taXRDYWxsYmFja0Vycm9yKSB0aHJvdyBlcnJvci5jYWxsYmFja0Vycm9yXG4gICAgICAgICAgaWYgKCEoZXJyb3IgaW5zdGFuY2VvZiBFcnJvcikpIHRocm93IGVycm9yXG5cbiAgICAgICAgICBjb25zdCByZXRyeUluZm8gPSB0aGlzLnJldHJ5YWJsZURhdGFiYXNlRXJyb3IoZXJyb3IpXG4gICAgICAgICAgY29uc3Qgd2lsbFJldHJ5ID0gQm9vbGVhbihyZXRyeUluZm8uZGVhZGxvY2sgJiYgYXR0ZW1wdCA8IG1heEF0dGVtcHRzICYmIHRoaXMuX3RyYW5zYWN0aW9uc0NvdW50ID09IDApXG5cbiAgICAgICAgICBpZiAod2lsbFJldHJ5KSB7XG4gICAgICAgICAgICB0aGlzLl9yZXBvcnREZWFkbG9ja1JldHJ5RGlhZ25vc3RpYyh7XG4gICAgICAgICAgICAgIGF0dGVtcHQsXG4gICAgICAgICAgICAgIGNvbnRlbnRpb25LaW5kOiByZXRyeUluZm8uY29udGVudGlvbktpbmQgfHwgXCJkZWFkbG9ja1wiLFxuICAgICAgICAgICAgICBlcnJvcixcbiAgICAgICAgICAgICAgbWF4QXR0ZW1wdHMsXG4gICAgICAgICAgICAgIHRyYW5zYWN0aW9uQXR0ZW1wdER1cmF0aW9uTXM6IE1hdGgubWF4KDAsIHRoaXMuX25vd01zKCkgLSBhdHRlbXB0U3RhcnRlZEF0TXMpLFxuICAgICAgICAgICAgICB3aWxsUmV0cnlcbiAgICAgICAgICAgIH0pXG5cbiAgICAgICAgICAgIC8vIEFuIGV4cGxpY2l0bHktY29uZmlndXJlZCBiYXNlIHdpbnMgc28gdGhlIHR1bmluZyBrbm9iIGlzIGVmZmVjdGl2ZSBldmVuIG9uIGRyaXZlcnNcbiAgICAgICAgICAgIC8vIHdob3NlIGNsYXNzaWZpZXIgc3VwcGxpZXMgaXRzIG93biBgd2FpdE1zYCAoTXlTUUwvTWFyaWFEQiByZXR1cm4gYSBmaXhlZCA1MG1zIGZvclxuICAgICAgICAgICAgLy8gZGVhZGxvY2tzKTsgb3RoZXJ3aXNlIGhvbm9yIHRoYXQgY2xhc3NpZmllciBoaW50LCB0aGVuIGZhbGwgYmFjayB0byA1MG1zLlxuICAgICAgICAgICAgY29uc3QgYmFzZVdhaXRNcyA9IGNvbmZpZ3VyZWRCYXNlV2FpdE1zID8/ICh0eXBlb2YgcmV0cnlJbmZvLndhaXRNcyA9PSBcIm51bWJlclwiICYmIHJldHJ5SW5mby53YWl0TXMgPiAwID8gcmV0cnlJbmZvLndhaXRNcyA6IDUwKVxuXG4gICAgICAgICAgICAvLyBGdWxsLWppdHRlciBleHBvbmVudGlhbCBiYWNrb2ZmOiB3YWl0IGEgdW5pZm9ybS1yYW5kb20gZHVyYXRpb24gaW5cbiAgICAgICAgICAgIC8vIFswLCBtaW4oYmFzZSAqIDJeKGF0dGVtcHQtMSksIGNhcCldLiBUaGUgZG91YmxpbmcgY2VpbGluZyBzcHJlYWRzIHJldHJpZXMgb3V0IGFzXG4gICAgICAgICAgICAvLyBjb250ZW50aW9uIHBlcnNpc3RzLCBhbmQgdGhlIGppdHRlciBkZS1jb3JyZWxhdGVzIHRyYW5zYWN0aW9ucyB0aGF0IGRlYWRsb2NrZWQgaW5cbiAgICAgICAgICAgIC8vIGxvY2tzdGVwIHNvIHRoZXkgc3RvcCByZS1jb2xsaWRpbmcgb24gdGhlIHNhbWUgd2FpdCAodGhlIGxpbmVhciBgYmFzZSAqIGF0dGVtcHRgXG4gICAgICAgICAgICAvLyB0aGlzIHJlcGxhY2VzIGhhZCBldmVyeSB2aWN0aW0gcmV0cnkgYWZ0ZXIgYW4gaWRlbnRpY2FsIGRlbGF5KS4gYGF0dGVtcHRgIGlzXG4gICAgICAgICAgICAvLyAxLWJhc2VkIGhlcmUsIHNvIDJeKGF0dGVtcHQtMSkgaXMgMSwgMiwgNCwgLi4uIFRoZSBjYXAga2VlcHMgdGhlIHRhaWwgc3ViLXNlY29uZC5cbiAgICAgICAgICAgIGNvbnN0IGNlaWxpbmdXYWl0TXMgPSBNYXRoLm1pbihiYXNlV2FpdE1zICogKDIgKiogKGF0dGVtcHQgLSAxKSksIGRlYWRsb2NrTWF4V2FpdE1zKVxuICAgICAgICAgICAgY29uc3Qgaml0dGVyZWRXYWl0TXMgPSBNYXRoLmZsb29yKE1hdGgucmFuZG9tKCkgKiAoY2VpbGluZ1dhaXRNcyArIDEpKVxuXG4gICAgICAgICAgICBjb25zdCBsb2dnZWRDb250ZW50aW9uS2luZCA9IHJldHJ5SW5mby5jb250ZW50aW9uS2luZCB8fCBcInRyYW5zYWN0aW9uIGNvbnRlbnRpb25cIlxuXG4gICAgICAgICAgICB0aGlzLmxvZ2dlci53YXJuKGBSZXRyeWluZyB0cmFuc2FjdGlvbiBhZnRlciAke2xvZ2dlZENvbnRlbnRpb25LaW5kfSAoYXR0ZW1wdCAke2F0dGVtcHR9LyR7bWF4QXR0ZW1wdHN9KWApXG4gICAgICAgICAgICBhd2FpdCB0aGlzLl93YWl0TXMoaml0dGVyZWRXYWl0TXMpXG4gICAgICAgICAgICBjb250aW51ZVxuICAgICAgICAgIH1cblxuICAgICAgICAgIHRocm93IGVycm9yXG4gICAgICAgIH1cbiAgICAgIH1cbiAgICB9LCBvcHRpb25zLm9wZXJhdGlvbk93bmVyKVxuICB9XG5cbiAgLyoqXG4gICAqIFdhaXRzIGBtc2AgbWlsbGlzZWNvbmRzLiBJc29sYXRlZCBpbiBpdHMgb3duIG1ldGhvZCBzbyB0ZXN0cyBjYW4gb2JzZXJ2ZSAoYW5kIHNraXApIHRoZVxuICAgKiBkZWFkbG9jay1yZXRyeSBiYWNrb2ZmIHdpdGhvdXQgYSByZWFsIHRpbWVyLlxuICAgKiBAcGFyYW0ge251bWJlcn0gbXMgLSBNaWxsaXNlY29uZHMgdG8gd2FpdC5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgYWZ0ZXIgdGhlIGRlbGF5LlxuICAgKi9cbiAgYXN5bmMgX3dhaXRNcyhtcykge1xuICAgIGF3YWl0IHdhaXQobXMpXG4gIH1cblxuICAvKipcbiAgICogUmV0dXJucyB0aGUgY2xvY2sgdXNlZCBmb3IgdHJhbnNhY3Rpb24tYXR0ZW1wdCBkaWFnbm9zdGljcy5cbiAgICogQHJldHVybnMge251bWJlcn0gLSBNb25vdG9uaWMgbWlsbGlzZWNvbmRzIHdoZXJlIGF2YWlsYWJsZS5cbiAgICovXG4gIF9ub3dNcygpIHtcbiAgICByZXR1cm4gbm93TXMoKVxuICB9XG5cbiAgLyoqXG4gICAqIFN0YXJ0cyBiZXN0LWVmZm9ydCBkZWFkbG9jayBkaWFnbm9zdGljcyB3aXRob3V0IGpvaW5pbmcgdGhlIHJldHJ5IGNvbnRyb2wgZmxvdy4gU3ViY2xhc3NlcyBtYXlcbiAgICogYWRkIGJvdW5kZWQgZHJpdmVyLXNwZWNpZmljIGNvbnRleHQ7IGNhcHR1cmUgYW5kIGV2ZW50LWxpc3RlbmVyIGZhaWx1cmVzIGNhbm5vdCBhZmZlY3QgcmV0cnkuXG4gICAqIEBwYXJhbSB7e2F0dGVtcHQ6IG51bWJlciwgY29udGVudGlvbktpbmQ6IFwiZGVhZGxvY2tcIiB8IFwibG9jay13YWl0LXRpbWVvdXRcIiwgZXJyb3I6IEVycm9yLCBtYXhBdHRlbXB0czogbnVtYmVyLCB0cmFuc2FjdGlvbkF0dGVtcHREdXJhdGlvbk1zOiBudW1iZXIsIHdpbGxSZXRyeTogYm9vbGVhbn19IGFyZ3MgLSBSZXRyeSBtZXRhZGF0YS5cbiAgICogQHJldHVybnMge3ZvaWR9XG4gICAqL1xuICBfcmVwb3J0RGVhZGxvY2tSZXRyeURpYWdub3N0aWMoe2F0dGVtcHQsIGNvbnRlbnRpb25LaW5kLCBlcnJvciwgbWF4QXR0ZW1wdHMsIHRyYW5zYWN0aW9uQXR0ZW1wdER1cmF0aW9uTXMsIHdpbGxSZXRyeX0pIHtcbiAgICBsZXQgc25hcHNob3RcblxuICAgIHRyeSB7XG4gICAgICBjb25zdCBxdWVyeURpYWdub3N0aWMgPSB0aGlzLl9mYWlsZWRRdWVyeURpYWdub3N0aWNzLmdldChlcnJvcilcblxuICAgICAgc25hcHNob3QgPSBPYmplY3QuZnJlZXplKHtcbiAgICAgICAgYXR0ZW1wdCxcbiAgICAgICAgY29udGVudGlvbktpbmQsXG4gICAgICAgIGRyaXZlclR5cGU6IHRoaXMuZ2V0VHlwZSgpLFxuICAgICAgICBtYXhBdHRlbXB0cyxcbiAgICAgICAgc3RhZ2U6IFwiZGF0YWJhc2UtZGVhZGxvY2stcmV0cnlcIixcbiAgICAgICAgdHJhbnNhY3Rpb25BdHRlbXB0RHVyYXRpb25NcyxcbiAgICAgICAgd2lsbFJldHJ5LFxuICAgICAgICAuLi50aGlzLl9wb29sRGlhZ25vc3RpY0lkZW50aXR5Q29udGV4dCgpLFxuICAgICAgICAuLi50aGlzLl9vcGVyYXRpb25EaWFnbm9zdGljQ29udGV4dCgpLFxuICAgICAgICAuLi5xdWVyeURpYWdub3N0aWNcbiAgICAgIH0pXG4gICAgfSBjYXRjaCAoZGlhZ25vc3RpY0Vycm9yKSB7XG4gICAgICB0aGlzLl9yZXBvcnREZWFkbG9ja0RpYWdub3N0aWNQaXBlbGluZUZhaWx1cmUoZGlhZ25vc3RpY0Vycm9yKVxuICAgICAgcmV0dXJuXG4gICAgfVxuXG4gICAgbGV0IGRyaXZlckNvbnRleHRSZXN1bHRcblxuICAgIHRyeSB7XG4gICAgICBkcml2ZXJDb250ZXh0UmVzdWx0ID0gdGhpcy5fZGVhZGxvY2tEaWFnbm9zdGljQ29udGV4dChzbmFwc2hvdClcbiAgICB9IGNhdGNoIChkaWFnbm9zdGljRXJyb3IpIHtcbiAgICAgIHRoaXMuX3JlcG9ydERlYWRsb2NrRGlhZ25vc3RpY1BpcGVsaW5lRmFpbHVyZShkaWFnbm9zdGljRXJyb3IpXG4gICAgICByZXR1cm5cbiAgICB9XG5cbiAgICBjb25zdCBoYXNQcm9taXNlQ29udHJhY3QgPSBkcml2ZXJDb250ZXh0UmVzdWx0IGluc3RhbmNlb2YgUHJvbWlzZVxuXG4gICAgdm9pZCBQcm9taXNlLnJlc29sdmUoZHJpdmVyQ29udGV4dFJlc3VsdClcbiAgICAgIC50aGVuKChkcml2ZXJDb250ZXh0KSA9PiB7XG4gICAgICAgIGlmICghaGFzUHJvbWlzZUNvbnRyYWN0KSB0aHJvdyBuZXcgRXJyb3IoXCJEYXRhYmFzZSBkZWFkbG9jayBkaWFnbm9zdGljIGNvbnRleHQgbXVzdCByZXR1cm4gYSBQcm9taXNlXCIpXG5cbiAgICAgICAgY29uc3QgY29udGV4dCA9IHtcbiAgICAgICAgICAuLi5zbmFwc2hvdCxcbiAgICAgICAgICAuLi5kcml2ZXJDb250ZXh0XG4gICAgICAgIH1cbiAgICAgICAgY29uc3QgcGF5bG9hZCA9IHtcbiAgICAgICAgICBjb250ZXh0LFxuICAgICAgICAgIGVycm9yOiBuZXcgRXJyb3Iod2lsbFJldHJ5XG4gICAgICAgICAgICA/IGBEYXRhYmFzZSB0cmFuc2FjdGlvbiAke2NvbnRlbnRpb25LaW5kfSB3aWxsIGJlIHJldHJpZWRgXG4gICAgICAgICAgICA6IGBEYXRhYmFzZSB0cmFuc2FjdGlvbiAke2NvbnRlbnRpb25LaW5kfSBleGhhdXN0ZWQgaXRzIHJldHJ5IGJ1ZGdldGApXG4gICAgICAgIH1cbiAgICAgICAgY29uc3QgZXJyb3JFdmVudHMgPSB0aGlzLmNvbmZpZ3VyYXRpb24uZ2V0RXJyb3JFdmVudHMoKVxuXG4gICAgICAgIHRyeSB7XG4gICAgICAgICAgZXJyb3JFdmVudHMuZW1pdChcImRhdGFiYXNlLWRlYWRsb2NrLXJldHJ5XCIsIHBheWxvYWQpXG4gICAgICAgIH0gY2F0Y2ggKGV2ZW50RXJyb3IpIHtcbiAgICAgICAgICB0aGlzLmxvZ2dlci53YXJuKFwiRGF0YWJhc2UgZGVhZGxvY2sgcmV0cnkgZGlhZ25vc3RpYyBsaXN0ZW5lciBmYWlsZWRcIiwge2Vycm9yOiBldmVudEVycm9yfSlcbiAgICAgICAgfVxuXG4gICAgICAgIHRyeSB7XG4gICAgICAgICAgZXJyb3JFdmVudHMuZW1pdChcImFsbC1lcnJvclwiLCB7Li4ucGF5bG9hZCwgZXJyb3JUeXBlOiBcImRhdGFiYXNlLWRlYWRsb2NrLXJldHJ5XCJ9KVxuICAgICAgICB9IGNhdGNoIChldmVudEVycm9yKSB7XG4gICAgICAgICAgdGhpcy5sb2dnZXIud2FybihcIkRhdGFiYXNlIGRlYWRsb2NrIHJldHJ5IGFsbC1lcnJvciBsaXN0ZW5lciBmYWlsZWRcIiwge2Vycm9yOiBldmVudEVycm9yfSlcbiAgICAgICAgfVxuICAgICAgfSlcbiAgICAgIC5jYXRjaCgoZGlhZ25vc3RpY0Vycm9yKSA9PiB0aGlzLl9yZXBvcnREZWFkbG9ja0RpYWdub3N0aWNQaXBlbGluZUZhaWx1cmUoZGlhZ25vc3RpY0Vycm9yKSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSZXR1cm5zIHBvb2wgaWRlbnRpdHkgb25seSB3aGVuIHRoaXMgZHJpdmVyIHdhcyBzdGFtcGVkIGJ5IGEgcG9vbC5cbiAgICogQHJldHVybnMge3tkYXRhYmFzZUlkZW50aWZpZXI/OiBzdHJpbmcsIGRhdGFiYXNlSWRlbnRpZmllckZpbmdlcnByaW50Pzogc3RyaW5nLCBkYXRhYmFzZUlkZW50aXR5RmluZ2VycHJpbnQ/OiBzdHJpbmd9fSAtIFNhZmUgcG9vbCBpZGVudGl0eS5cbiAgICovXG4gIF9wb29sRGlhZ25vc3RpY0lkZW50aXR5Q29udGV4dCgpIHtcbiAgICBpZiAodGhpcy5fZGF0YWJhc2VJZGVudGlmaWVyID09PSB1bmRlZmluZWQgfHwgIXRoaXMuX2RhdGFiYXNlSWRlbnRpdHlGaW5nZXJwcmludCkgcmV0dXJuIHt9XG5cbiAgICBjb25zdCBpZGVudGlmaWVyRmluZ2VycHJpbnRJbnB1dCA9IHR5cGVvZiB0aGlzLl9kYXRhYmFzZUlkZW50aWZpZXIgPT09IFwic3RyaW5nXCJcbiAgICAgID8gdGhpcy5fZGF0YWJhc2VJZGVudGlmaWVyXG4gICAgICA6IGBpbnZhbGlkOiR7dHlwZW9mIHRoaXMuX2RhdGFiYXNlSWRlbnRpZmllcn1gXG4gICAgY29uc3QgZGF0YWJhc2VJZGVudGlmaWVyRmluZ2VycHJpbnQgPSBgc2hhMjU2OiR7c2hhMjU2SGV4KGBkYXRhYmFzZS1sb2dpY2FsLWlkZW50aWZpZXI6djFcXDAke2lkZW50aWZpZXJGaW5nZXJwcmludElucHV0fWApfWBcblxuICAgIHJldHVybiB7XG4gICAgICBkYXRhYmFzZUlkZW50aWZpZXI6IFJFREFDVEVEX0RJQUdOT1NUSUNfTEFCRUwsXG4gICAgICBkYXRhYmFzZUlkZW50aWZpZXJGaW5nZXJwcmludCxcbiAgICAgIGRhdGFiYXNlSWRlbnRpdHlGaW5nZXJwcmludDogdGhpcy5fZGF0YWJhc2VJZGVudGl0eUZpbmdlcnByaW50XG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIEJ1aWxkcyB0aGUgYm91bmRlZCBvcGVyYXRpb24gcG9ydGlvbiBvZiBhbiBpbW11dGFibGUgcmV0cnkgc25hcHNob3QuXG4gICAqIEByZXR1cm5zIHt7b3BlcmF0aW9uTmFtZT86IHN0cmluZywgb3BlcmF0aW9uTmFtZUZpbmdlcnByaW50Pzogc3RyaW5nfX0gLSBTYWZlIG9wZXJhdGlvbiBmaWVsZHMuXG4gICAqL1xuICBfb3BlcmF0aW9uRGlhZ25vc3RpY0NvbnRleHQoKSB7XG4gICAgY29uc3QgcmF3T3BlcmF0aW9uTmFtZSA9IHRoaXMuX2Nvbm5lY3Rpb25DaGVja291dE5hbWVcblxuICAgIGlmIChyYXdPcGVyYXRpb25OYW1lID09PSB1bmRlZmluZWQpIHJldHVybiB7fVxuICAgIGlmICh0eXBlb2YgcmF3T3BlcmF0aW9uTmFtZSAhPT0gXCJzdHJpbmdcIikge1xuICAgICAgcmV0dXJuIHtcbiAgICAgICAgb3BlcmF0aW9uTmFtZTogUkVEQUNURURfRElBR05PU1RJQ19MQUJFTCxcbiAgICAgICAgb3BlcmF0aW9uTmFtZUZpbmdlcnByaW50OiBgc2hhMjU2OiR7c2hhMjU2SGV4KGBkYXRhYmFzZS1vcGVyYXRpb246djFcXDBpbnZhbGlkOiR7dHlwZW9mIHJhd09wZXJhdGlvbk5hbWV9YCl9YFxuICAgICAgfVxuICAgIH1cblxuICAgIGNvbnN0IHNjYW5uZWRPcGVyYXRpb25OYW1lID0gcmF3T3BlcmF0aW9uTmFtZS5zbGljZSgwLCBPUEVSQVRJT05fTkFNRV9TQ0FOX0xJTUlUKVxuICAgIGNvbnN0IG9wZXJhdGlvbk5hbWVGaW5nZXJwcmludCA9IGBzaGEyNTY6JHtzaGEyNTZIZXgoYGRhdGFiYXNlLW9wZXJhdGlvbjp2MVxcMCR7c2Nhbm5lZE9wZXJhdGlvbk5hbWV9XFwwbGVuZ3RoOiR7cmF3T3BlcmF0aW9uTmFtZS5sZW5ndGh9YCl9YFxuXG4gICAgcmV0dXJuIHtcbiAgICAgIG9wZXJhdGlvbk5hbWU6IFJFREFDVEVEX0RJQUdOT1NUSUNfTEFCRUwsXG4gICAgICBvcGVyYXRpb25OYW1lRmluZ2VycHJpbnRcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogUmVwb3J0cyBhbiB1bmV4cGVjdGVkIGRldGFjaGVkIGRpYWdub3N0aWNzIGZhaWx1cmUgd2l0aG91dCBjaGFuZ2luZyB0cmFuc2FjdGlvbiBjb250cm9sIGZsb3cuXG4gICAqIEBwYXJhbSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59IGRpYWdub3N0aWNFcnJvciAtIERpYWdub3N0aWNzIGZhaWx1cmUuXG4gICAqIEByZXR1cm5zIHt2b2lkfVxuICAgKi9cbiAgX3JlcG9ydERlYWRsb2NrRGlhZ25vc3RpY1BpcGVsaW5lRmFpbHVyZShkaWFnbm9zdGljRXJyb3IpIHtcbiAgICBjb25zdCBub3JtYWxpemVkRXJyb3IgPSBkaWFnbm9zdGljRXJyb3IgaW5zdGFuY2VvZiBFcnJvclxuICAgICAgPyBkaWFnbm9zdGljRXJyb3JcbiAgICAgIDogbmV3IEVycm9yKFwiRGF0YWJhc2UgZGVhZGxvY2sgcmV0cnkgZGlhZ25vc3RpYyBmYWlsZWRcIiwge2NhdXNlOiBkaWFnbm9zdGljRXJyb3J9KVxuICAgIGNvbnN0IHBheWxvYWQgPSB7XG4gICAgICBjb250ZXh0OiB7c3RhZ2U6IFwiZGF0YWJhc2UtZGVhZGxvY2stcmV0cnktZGlhZ25vc3RpY1wifSxcbiAgICAgIGVycm9yOiBub3JtYWxpemVkRXJyb3JcbiAgICB9XG4gICAgbGV0IGVycm9yRXZlbnRzXG5cbiAgICB0cnkge1xuICAgICAgZXJyb3JFdmVudHMgPSB0aGlzLmNvbmZpZ3VyYXRpb24uZ2V0RXJyb3JFdmVudHMoKVxuICAgIH0gY2F0Y2ggKHJlcG9ydGluZ0Vycm9yKSB7XG4gICAgICB0aGlzLmxvZ2dlci53YXJuKFwiRGF0YWJhc2UgZGVhZGxvY2sgcmV0cnkgZGlhZ25vc3RpYyBwaXBlbGluZSByZXBvcnRpbmcgZmFpbGVkXCIsIHtlcnJvcjogbm9ybWFsaXplZEVycm9yLCByZXBvcnRpbmdFcnJvcn0pXG4gICAgICByZXR1cm5cbiAgICB9XG5cbiAgICB0cnkge1xuICAgICAgZXJyb3JFdmVudHMuZW1pdChcImZyYW1ld29yay1lcnJvclwiLCBwYXlsb2FkKVxuICAgIH0gY2F0Y2ggKHJlcG9ydGluZ0Vycm9yKSB7XG4gICAgICB0aGlzLmxvZ2dlci53YXJuKFwiRGF0YWJhc2UgZGVhZGxvY2sgcmV0cnkgZnJhbWV3b3JrLWVycm9yIGxpc3RlbmVyIGZhaWxlZFwiLCB7ZXJyb3I6IG5vcm1hbGl6ZWRFcnJvciwgcmVwb3J0aW5nRXJyb3J9KVxuICAgIH1cblxuICAgIHRyeSB7XG4gICAgICBlcnJvckV2ZW50cy5lbWl0KFwiYWxsLWVycm9yXCIsIHsuLi5wYXlsb2FkLCBlcnJvclR5cGU6IFwiZnJhbWV3b3JrLWVycm9yXCJ9KVxuICAgIH0gY2F0Y2ggKHJlcG9ydGluZ0Vycm9yKSB7XG4gICAgICB0aGlzLmxvZ2dlci53YXJuKFwiRGF0YWJhc2UgZGVhZGxvY2sgcmV0cnkgYWxsLWVycm9yIGxpc3RlbmVyIGZhaWxlZFwiLCB7ZXJyb3I6IG5vcm1hbGl6ZWRFcnJvciwgcmVwb3J0aW5nRXJyb3J9KVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBCdWlsZHMgZHJpdmVyLXNwZWNpZmljIGRlYWRsb2NrIGNvbnRleHQuIFRoZSBiYXNlIGRyaXZlciBoYXMgbm8gc2VydmVyIGRpYWdub3N0aWMgc291cmNlLlxuICAgKiBAcGFyYW0ge0RlYWRsb2NrUmV0cnlEaWFnbm9zdGljU25hcHNob3R9IF9zbmFwc2hvdCAtIEltbXV0YWJsZSByZXRyeSBzbmFwc2hvdC5cbiAgICogQHJldHVybnMge1Byb21pc2U8UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+Pn0gLSBTYWZlIGNvbnRleHQgZmllbGRzLlxuICAgKi9cbiAgYXN5bmMgX2RlYWRsb2NrRGlhZ25vc3RpY0NvbnRleHQoX3NuYXBzaG90KSB7XG4gICAgcmV0dXJuIHt9XG4gIH1cblxuICAvKipcbiAgICogUnVucyBhIHNpbmdsZSB0cmFuc2FjdGlvbiBhdHRlbXB0OiBzdGFydHMgYSB0cmFuc2FjdGlvbiAob3IgYSBzYXZlcG9pbnQgd2hlbiBuZXN0ZWQpLCBydW5zXG4gICAqIGBjYWxsYmFja2AsIGFuZCBjb21taXRzIOKAlCByb2xsaW5nIGJhY2sgb24gZXJyb3IuIHtAbGluayB0cmFuc2FjdGlvbn0gd3JhcHMgdGhpcyB3aXRoIGRlYWRsb2NrXG4gICAqIHJldHJ5IGF0IHRoZSBvdXRlcm1vc3QgbGV2ZWwuXG4gICAqIEB0ZW1wbGF0ZSBUXG4gICAqIEBwYXJhbSB7KCkgPT4gUHJvbWlzZTxUPn0gY2FsbGJhY2sgLSBDYWxsYmFjayBmdW5jdGlvbi5cbiAgICogQHBhcmFtIHtQaWNrPFF1ZXJ5T3B0aW9ucywgXCJvcGVyYXRpb25Pd25lclwiPn0gb3B0aW9ucyAtIFRyYW5zYWN0aW9uIG93bmVyc2hpcC5cbiAgICogQHJldHVybnMge1Byb21pc2U8UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSAtIFJlc29sdmVzIHdpdGggdGhlIHRyYW5zYWN0aW9uIHJlc3VsdC5cbiAgICovXG4gIGFzeW5jIF9ydW5UcmFuc2FjdGlvbkF0dGVtcHQoY2FsbGJhY2ssIG9wdGlvbnMpIHtcbiAgICBjb25zdCBzYXZlUG9pbnROYW1lID0gdGhpcy5nZW5lcmF0ZVNhdmVQb2ludE5hbWUoKVxuICAgIC8qKiBAdHlwZSB7VHJhbnNhY3Rpb25DYWxsYmFja0ZyYW1lfSAqL1xuICAgIGNvbnN0IGNhbGxiYWNrRnJhbWUgPSB7XG4gICAgICBhZnRlckNvbW1pdENhbGxiYWNrczogW10sXG4gICAgICBiZWZvcmVDb21taXRDYWxsYmFja3M6IFtdXG4gICAgfVxuICAgIGxldCB0cmFuc2FjdGlvblN0YXJ0ZWQgPSBmYWxzZVxuICAgIGxldCBzYXZlUG9pbnRTdGFydGVkID0gZmFsc2VcblxuICAgIHRoaXMuX3RyYW5zYWN0aW9uQ2FsbGJhY2tGcmFtZXMucHVzaChjYWxsYmFja0ZyYW1lKVxuXG4gICAgdHJ5IHtcbiAgICAgIGlmICh0aGlzLl90cmFuc2FjdGlvbnNDb3VudCA9PSAwKSB7XG4gICAgICAgIHRoaXMubG9nZ2VyLmRlYnVnKFwiU3RhcnQgdHJhbnNhY3Rpb25cIilcbiAgICAgICAgYXdhaXQgdGhpcy5zdGFydFRyYW5zYWN0aW9uKG9wdGlvbnMpXG4gICAgICAgIHRyYW5zYWN0aW9uU3RhcnRlZCA9IHRydWVcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIHRoaXMubG9nZ2VyLmRlYnVnKFwiU3RhcnQgc2F2ZXBvaW50XCIsIHNhdmVQb2ludE5hbWUpXG4gICAgICAgIGF3YWl0IHRoaXMuc3RhcnRTYXZlUG9pbnQoc2F2ZVBvaW50TmFtZSwgb3B0aW9ucylcbiAgICAgICAgc2F2ZVBvaW50U3RhcnRlZCA9IHRydWVcbiAgICAgIH1cbiAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgdGhpcy5fdHJhbnNhY3Rpb25DYWxsYmFja0ZyYW1lcy5wb3AoKVxuICAgICAgdGhyb3cgZXJyb3JcbiAgICB9XG5cbiAgICBsZXQgcmVzdWx0XG5cbiAgICB0cnkge1xuICAgICAgcmVzdWx0ID0gYXdhaXQgY2FsbGJhY2soKVxuICAgICAgYXdhaXQgdGhpcy5fcnVuQmVmb3JlQ29tbWl0Q2FsbGJhY2tzKGNhbGxiYWNrRnJhbWUpXG5cbiAgICAgIGlmIChzYXZlUG9pbnRTdGFydGVkKSB7XG4gICAgICAgIHRoaXMubG9nZ2VyLmRlYnVnKFwiUmVsZWFzZSBzYXZlcG9pbnRcIiwgc2F2ZVBvaW50TmFtZSlcbiAgICAgICAgYXdhaXQgdGhpcy5yZWxlYXNlU2F2ZVBvaW50KHNhdmVQb2ludE5hbWUsIG9wdGlvbnMpXG4gICAgICB9XG5cbiAgICAgIGlmICh0cmFuc2FjdGlvblN0YXJ0ZWQpIHtcbiAgICAgICAgdGhpcy5sb2dnZXIuZGVidWcoXCJDb21taXQgdHJhbnNhY3Rpb25cIilcbiAgICAgICAgYXdhaXQgdGhpcy5jb21taXRUcmFuc2FjdGlvbihvcHRpb25zKVxuICAgICAgfVxuICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICBpZiAoZXJyb3IgaW5zdGFuY2VvZiBFcnJvcikge1xuICAgICAgICB0aGlzLmxvZ2dlci5kZWJ1ZyhcIlRyYW5zYWN0aW9uIGVycm9yXCIsIGVycm9yLm1lc3NhZ2UpXG4gICAgICB9IGVsc2Uge1xuICAgICAgICB0aGlzLmxvZ2dlci5kZWJ1ZyhcIlRyYW5zYWN0aW9uIGVycm9yXCIsIGVycm9yKVxuICAgICAgfVxuXG4gICAgICB0cnkge1xuICAgICAgICBsZXQgdHJhbnNhY3Rpb25Sb2xsZWRCYWNrID0gZmFsc2VcblxuICAgICAgICBpZiAoc2F2ZVBvaW50U3RhcnRlZCkge1xuICAgICAgICAgIHRoaXMubG9nZ2VyLmRlYnVnKFwiUm9sbGJhY2sgc2F2ZXBvaW50XCIsIHNhdmVQb2ludE5hbWUpXG4gICAgICAgICAgdHJ5IHtcbiAgICAgICAgICAgIGF3YWl0IHRoaXMucm9sbGJhY2tTYXZlUG9pbnQoc2F2ZVBvaW50TmFtZSwgb3B0aW9ucylcbiAgICAgICAgICB9IGNhdGNoIChzYXZlUG9pbnRFcnJvcikge1xuICAgICAgICAgICAgY29uc3QgbWVzc2FnZSA9IHNhdmVQb2ludEVycm9yIGluc3RhbmNlb2YgRXJyb3IgPyBzYXZlUG9pbnRFcnJvci5tZXNzYWdlIDogYCR7c2F2ZVBvaW50RXJyb3J9YFxuXG4gICAgICAgICAgICAvLyBNeVNRTCBzb21ldGltZXMgZHJvcHMgc2F2ZXBvaW50cyB1bmV4cGVjdGVkbHk7IGZhbGwgYmFjayB0byByb2xsaW5nIGJhY2sgdGhlIGZ1bGwgdHJhbnNhY3Rpb25cbiAgICAgICAgICAgIGlmIChtZXNzYWdlLmluY2x1ZGVzKFwiU0FWRVBPSU5UXCIpIHx8IG1lc3NhZ2UuaW5jbHVkZXMoXCJFUl9TUF9ET0VTX05PVF9FWElTVFwiKSkge1xuICAgICAgICAgICAgICB0aGlzLmxvZ2dlci5kZWJ1ZyhcIlNhdmVwb2ludCByb2xsYmFjayBmYWlsZWQ7IHJvbGxpbmcgYmFjayBlbnRpcmUgdHJhbnNhY3Rpb24gaW5zdGVhZFwiKVxuICAgICAgICAgICAgICBhd2FpdCB0aGlzLnJvbGxiYWNrVHJhbnNhY3Rpb24ob3B0aW9ucylcbiAgICAgICAgICAgICAgdHJhbnNhY3Rpb25Sb2xsZWRCYWNrID0gdHJ1ZVxuICAgICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgICAgdGhyb3cgc2F2ZVBvaW50RXJyb3JcbiAgICAgICAgICAgIH1cbiAgICAgICAgICB9XG4gICAgICAgIH1cblxuICAgICAgICAvLyBPbmx5IHJvbGwgYmFjayBpZiBhIHRyYW5zYWN0aW9uIGlzIHN0aWxsIG9wZW4uIEEgbmVzdGVkIHNhdmVwb2ludCB3aG9zZSByb2xsYmFjayBmYWlsZWRcbiAgICAgICAgLy8gZmFsbHMgYmFjayB0byByb2xsaW5nIGJhY2sgdGhlIHdob2xlIHRyYW5zYWN0aW9uIChhYm92ZSksIHdoaWNoIGFscmVhZHkgY2xvc2VkIGl0IGFuZFxuICAgICAgICAvLyBkcm9wcGVkIHRoZSBjb3VudCB0byAwOyByb2xsaW5nIGJhY2sgYWdhaW4gaGVyZSB3b3VsZCBpc3N1ZSBhIHNlY29uZCBST0xMQkFDSyBhbmQgZHJpdmVcbiAgICAgICAgLy8gYF90cmFuc2FjdGlvbnNDb3VudGAgYmVsb3cgemVybywgd2hpY2ggd291bGQgdGhlbiBkZWZlYXQgdGhlIG91dGVybW9zdCBkZWFkbG9jay1yZXRyeSBndWFyZC5cbiAgICAgICAgaWYgKHRyYW5zYWN0aW9uU3RhcnRlZCAmJiAhdHJhbnNhY3Rpb25Sb2xsZWRCYWNrICYmIHRoaXMuX3RyYW5zYWN0aW9uc0NvdW50ID4gMCkge1xuICAgICAgICAgIHRoaXMubG9nZ2VyLmRlYnVnKFwiUm9sbGJhY2sgdHJhbnNhY3Rpb25cIilcbiAgICAgICAgICBhd2FpdCB0aGlzLnJvbGxiYWNrVHJhbnNhY3Rpb24ob3B0aW9ucylcbiAgICAgICAgfVxuICAgICAgfSBmaW5hbGx5IHtcbiAgICAgICAgdGhpcy5fdHJhbnNhY3Rpb25DYWxsYmFja0ZyYW1lcy5wb3AoKVxuICAgICAgfVxuXG4gICAgICB0aHJvdyBlcnJvclxuICAgIH1cblxuICAgIHRyeSB7XG4gICAgICBhd2FpdCB0aGlzLl9jb21taXRUcmFuc2FjdGlvbkNhbGxiYWNrRnJhbWUoKVxuICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICB0aHJvdyBuZXcgVmVsb2Npb3VzRGF0YWJhc2VBZnRlckNvbW1pdENhbGxiYWNrRXJyb3IoZXJyb3IpXG4gICAgfVxuXG4gICAgcmV0dXJuIHJlc3VsdFxuICB9XG5cbiAgLyoqXG4gICAqIFJlZ2lzdGVycyBhIGd1YXJkIHRvIHJ1biBhZnRlciB0aGUgY3VycmVudCB0cmFuc2FjdGlvbiBjYWxsYmFjayBzdWNjZWVkcyBhbmQgYmVmb3JlIGl0c1xuICAgKiBvdXRlciBjb21taXQgb3IgbmVzdGVkIHNhdmVwb2ludCByZWxlYXNlLlxuICAgKiBAcGFyYW0geygpID0+IHZvaWQgfCBQcm9taXNlPHZvaWQ+fSBjYWxsYmFjayAtIEd1YXJkIGNhbGxiYWNrLlxuICAgKiBAcGFyYW0ge1BpY2s8UXVlcnlPcHRpb25zLCBcIm9wZXJhdGlvbk93bmVyXCI+fSBbb3B0aW9uc10gLSBDYWxsYmFjayBvd25lcnNoaXAuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIHdoZW4gdGhlIGd1YXJkIGhhcyBiZWVuIHJlZ2lzdGVyZWQuXG4gICAqL1xuICBhc3luYyBiZWZvcmVDb21taXQoY2FsbGJhY2ssIG9wdGlvbnMgPSB7fSkge1xuICAgIGF3YWl0IHRoaXMuX3dhaXRGb3JPcGVyYXRpb25MZWFzZShvcHRpb25zLm9wZXJhdGlvbk93bmVyKVxuXG4gICAgY29uc3QgY3VycmVudEZyYW1lID0gdGhpcy5fdHJhbnNhY3Rpb25DYWxsYmFja0ZyYW1lc1t0aGlzLl90cmFuc2FjdGlvbkNhbGxiYWNrRnJhbWVzLmxlbmd0aCAtIDFdXG5cbiAgICBpZiAoIWN1cnJlbnRGcmFtZSkgdGhyb3cgbmV3IEVycm9yKFwiYmVmb3JlQ29tbWl0IHJlcXVpcmVzIGFuIGFjdGl2ZSB0cmFuc2FjdGlvblwiKVxuXG4gICAgY3VycmVudEZyYW1lLmJlZm9yZUNvbW1pdENhbGxiYWNrcy5wdXNoKGNhbGxiYWNrKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgYSBjYWxsYmFjayBhZnRlciB0aGUgc3Vycm91bmRpbmcgdHJhbnNhY3Rpb24gY29tbWl0cy5cbiAgICogSWYgbm8gdHJhbnNhY3Rpb24gaXMgYWN0aXZlLCB0aGUgY2FsbGJhY2sgcnVucyBpbW1lZGlhdGVseS5cbiAgICogQHBhcmFtIHsoKSA9PiB2b2lkIHwgUHJvbWlzZTx2b2lkPn0gY2FsbGJhY2sgLSBDYWxsYmFjay5cbiAgICogQHBhcmFtIHtQaWNrPFF1ZXJ5T3B0aW9ucywgXCJvcGVyYXRpb25Pd25lclwiPn0gW29wdGlvbnNdIC0gQ2FsbGJhY2sgb3duZXJzaGlwLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyB3aGVuIHRoZSBjYWxsYmFjayBoYXMgYmVlbiByZWdpc3RlcmVkIG9yIHJ1bi5cbiAgICovXG4gIGFzeW5jIGFmdGVyQ29tbWl0KGNhbGxiYWNrLCBvcHRpb25zID0ge30pIHtcbiAgICBhd2FpdCB0aGlzLl93YWl0Rm9yT3BlcmF0aW9uTGVhc2Uob3B0aW9ucy5vcGVyYXRpb25Pd25lcilcblxuICAgIGNvbnN0IGN1cnJlbnRGcmFtZSA9IHRoaXMuX3RyYW5zYWN0aW9uQ2FsbGJhY2tGcmFtZXNbdGhpcy5fdHJhbnNhY3Rpb25DYWxsYmFja0ZyYW1lcy5sZW5ndGggLSAxXVxuXG4gICAgaWYgKCFjdXJyZW50RnJhbWUpIHtcbiAgICAgIGF3YWl0IGNhbGxiYWNrKClcbiAgICAgIHJldHVyblxuICAgIH1cblxuICAgIGN1cnJlbnRGcmFtZS5hZnRlckNvbW1pdENhbGxiYWNrcy5wdXNoKGNhbGxiYWNrKVxuICB9XG5cbiAgLyoqXG4gICAqIFdoZXRoZXIgYSB0cmFuc2FjdGlvbiBpcyBjdXJyZW50bHkgb3BlbiBvbiB0aGlzIGNvbm5lY3Rpb24uXG4gICAqIEByZXR1cm5zIHtib29sZWFufSAtIFdoZXRoZXIgaW5zaWRlIGEgdHJhbnNhY3Rpb24uXG4gICAqL1xuICBpbnNpZGVUcmFuc2FjdGlvbigpIHsgcmV0dXJuIHRoaXMuX3RyYW5zYWN0aW9uc0NvdW50ID4gMCB9XG5cbiAgLyoqXG4gICAqIFJldHVybnMgdGhlIGNvbXBsZXRpb24gcHJvbWlzZSBpZGVudGlmeWluZyB0aGUgY3VycmVudCBvdXRlciB0cmFuc2FjdGlvbi5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IFJlc29sdmVzIGFmdGVyIHRoYXQgdHJhbnNhY3Rpb24gY29tbWl0cyBvciByb2xscyBiYWNrLlxuICAgKi9cbiAgdHJhbnNhY3Rpb25Db21wbGV0aW9uKCkgeyByZXR1cm4gdGhpcy5fdHJhbnNhY3Rpb25Db21wbGV0aW9uUHJvbWlzZSB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgc3RhcnQgdHJhbnNhY3Rpb24uXG4gICAqIEBwYXJhbSB7UGljazxRdWVyeU9wdGlvbnMsIFwib3BlcmF0aW9uT3duZXJcIj59IFtvcHRpb25zXSAtIFRyYW5zYWN0aW9uIG93bmVyc2hpcC5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgd2hlbiBjb21wbGV0ZS5cbiAgICovXG4gIGFzeW5jIHN0YXJ0VHJhbnNhY3Rpb24ob3B0aW9ucyA9IHt9KSB7XG4gICAgYXdhaXQgY29vcmRpbmF0ZVNoYXJlZFRyYW5zYWN0aW9uQ29ubmVjdGlvbih0aGlzLCBhc3luYyAoKSA9PiB7XG4gICAgICB3aGlsZSAodHJ1ZSkge1xuICAgICAgICAvKiogQHR5cGUge2ltcG9ydChcIi4uL29wZXJhdGlvbi1sZWFzZS5qc1wiKS5kZWZhdWx0IHwgdW5kZWZpbmVkfSAqL1xuICAgICAgICBsZXQgYmxvY2tpbmdPcGVyYXRpb25MZWFzZVxuXG4gICAgICAgIGF3YWl0IHRoaXMuX3RyYW5zYWN0aW9uc0FjdGlvbnNNdXRleC5zeW5jKGFzeW5jICgpID0+IHtcbiAgICAgICAgICBjb25zdCBvcGVyYXRpb25MZWFzZSA9IHRoaXMuX29wZXJhdGlvbkxlYXNlXG5cbiAgICAgICAgICBpZiAob3BlcmF0aW9uTGVhc2UgJiYgb3B0aW9ucy5vcGVyYXRpb25Pd25lciAhPT0gb3BlcmF0aW9uTGVhc2Uub3duZXIpIHtcbiAgICAgICAgICAgIGJsb2NraW5nT3BlcmF0aW9uTGVhc2UgPSBvcGVyYXRpb25MZWFzZVxuICAgICAgICAgICAgcmV0dXJuXG4gICAgICAgICAgfVxuXG4gICAgICAgICAgYXdhaXQgdGhpcy5fcnVuUHJvZmlsZWRUcmFuc2FjdGlvbkFjdGlvbihcInN0YXJ0XCIsIGFzeW5jICgpID0+IHtcbiAgICAgICAgICAgIGF3YWl0IHRoaXMuX3N0YXJ0VHJhbnNhY3Rpb25BY3Rpb24ob3B0aW9ucylcbiAgICAgICAgICB9KVxuICAgICAgICAgIHRoaXMuX3RyYW5zYWN0aW9uc0NvdW50KytcblxuICAgICAgICAgIGlmICh0aGlzLl90cmFuc2FjdGlvbnNDb3VudCA9PT0gMSkge1xuICAgICAgICAgICAgdGhpcy5fdHJhbnNhY3Rpb25Db21wbGV0aW9uUHJvbWlzZSA9IG5ldyBQcm9taXNlKChyZXNvbHZlKSA9PiB7XG4gICAgICAgICAgICAgIHRoaXMuX3Jlc29sdmVUcmFuc2FjdGlvbkNvbXBsZXRpb24gPSByZXNvbHZlXG4gICAgICAgICAgICB9KVxuICAgICAgICAgIH1cbiAgICAgICAgfSlcblxuICAgICAgICBpZiAoIWJsb2NraW5nT3BlcmF0aW9uTGVhc2UpIHJldHVyblxuXG4gICAgICAgIGF3YWl0IGJsb2NraW5nT3BlcmF0aW9uTGVhc2Uud2FpdChvcHRpb25zLm9wZXJhdGlvbk93bmVyKVxuICAgICAgfVxuICAgIH0sIG9wdGlvbnMub3BlcmF0aW9uT3duZXIpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBzdGFydCB0cmFuc2FjdGlvbiBhY3Rpb24uXG4gICAqIEBwYXJhbSB7UGljazxRdWVyeU9wdGlvbnMsIFwib3BlcmF0aW9uT3duZXJcIj59IFtvcHRpb25zXSAtIFRyYW5zYWN0aW9uIG93bmVyc2hpcC5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgd2hlbiBjb21wbGV0ZS5cbiAgICovXG4gIGFzeW5jIF9zdGFydFRyYW5zYWN0aW9uQWN0aW9uKG9wdGlvbnMgPSB7fSkge1xuICAgIGF3YWl0IHRoaXMucXVlcnkoXCJCRUdJTiBUUkFOU0FDVElPTlwiLCBvcHRpb25zKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgY29tbWl0IHRyYW5zYWN0aW9uLlxuICAgKiBAcGFyYW0ge1BpY2s8UXVlcnlPcHRpb25zLCBcIm9wZXJhdGlvbk93bmVyXCI+fSBbb3B0aW9uc10gLSBUcmFuc2FjdGlvbiBvd25lcnNoaXAuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIHdoZW4gY29tcGxldGUuXG4gICAqL1xuICBhc3luYyBjb21taXRUcmFuc2FjdGlvbihvcHRpb25zID0ge30pIHtcbiAgICBhd2FpdCBjb29yZGluYXRlU2hhcmVkVHJhbnNhY3Rpb25Db25uZWN0aW9uKHRoaXMsIGFzeW5jICgpID0+IHtcbiAgICAgIGF3YWl0IHRoaXMuX3RyYW5zYWN0aW9uc0FjdGlvbnNNdXRleC5zeW5jKGFzeW5jICgpID0+IHtcbiAgICAgICAgYXdhaXQgdGhpcy5fcnVuUHJvZmlsZWRUcmFuc2FjdGlvbkFjdGlvbihcImNvbW1pdFwiLCBhc3luYyAoKSA9PiB7XG4gICAgICAgICAgYXdhaXQgdGhpcy5fY29tbWl0VHJhbnNhY3Rpb25BY3Rpb24ob3B0aW9ucylcbiAgICAgICAgfSlcbiAgICAgICAgdGhpcy5fdHJhbnNhY3Rpb25zQ291bnQtLVxuICAgICAgICB0aGlzLl9yZXNvbHZlQ29tcGxldGVkVHJhbnNhY3Rpb24oKVxuICAgICAgfSlcbiAgICB9LCBvcHRpb25zLm9wZXJhdGlvbk93bmVyKVxuICB9XG5cbiAgLyoqIFJlc29sdmVzIHRoZSBjdXJyZW50IG91dGVyIHRyYW5zYWN0aW9uIGNvbXBsZXRpb24gd2hlbiBpdCBoYXMgZmluaXNoZWQuICovXG4gIF9yZXNvbHZlQ29tcGxldGVkVHJhbnNhY3Rpb24oKSB7XG4gICAgaWYgKHRoaXMuX3RyYW5zYWN0aW9uc0NvdW50ICE9PSAwKSByZXR1cm5cblxuICAgIGNvbnN0IHJlc29sdmUgPSB0aGlzLl9yZXNvbHZlVHJhbnNhY3Rpb25Db21wbGV0aW9uXG5cbiAgICB0aGlzLl9yZXNvbHZlVHJhbnNhY3Rpb25Db21wbGV0aW9uID0gdW5kZWZpbmVkXG4gICAgaWYgKHJlc29sdmUpIHJlc29sdmUoKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgY29tbWl0IHRyYW5zYWN0aW9uIGFjdGlvbi5cbiAgICogQHBhcmFtIHtQaWNrPFF1ZXJ5T3B0aW9ucywgXCJvcGVyYXRpb25Pd25lclwiPn0gW29wdGlvbnNdIC0gVHJhbnNhY3Rpb24gb3duZXJzaGlwLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyB3aGVuIGNvbXBsZXRlLlxuICAgKi9cbiAgYXN5bmMgX2NvbW1pdFRyYW5zYWN0aW9uQWN0aW9uKG9wdGlvbnMgPSB7fSkge1xuICAgIGF3YWl0IHRoaXMucXVlcnkoXCJDT01NSVRcIiwgb3B0aW9ucylcbiAgfVxuXG4gIC8qKlxuICAgKiBUaW1lcyBhIHBoeXNpY2FsIHRyYW5zYWN0aW9uIGFjdGlvbiBvbmx5IHdoZW4gdGVzdCBwcm9maWxpbmcgaXMgYWN0aXZlLlxuICAgKiBAdGVtcGxhdGUgVFxuICAgKiBAcGFyYW0ge1wic3RhcnRcIiB8IFwiY29tbWl0XCIgfCBcInJvbGxiYWNrXCJ9IGFjdGlvbiAtIFRyYW5zYWN0aW9uIGFjdGlvbi5cbiAgICogQHBhcmFtIHsoKSA9PiBQcm9taXNlPFQ+fSBjYWxsYmFjayAtIFBoeXNpY2FsIGFjdGlvbiBjYWxsYmFjay5cbiAgICogQHJldHVybnMge1Byb21pc2U8VD59IC0gQ2FsbGJhY2sgcmVzdWx0LlxuICAgKi9cbiAgYXN5bmMgX3J1blByb2ZpbGVkVHJhbnNhY3Rpb25BY3Rpb24oYWN0aW9uLCBjYWxsYmFjaykge1xuICAgIGNvbnN0IHByb2ZpbGVDb250ZXh0ID0gY3VycmVudFRlc3RQcm9maWxlQ29udGV4dCh0aGlzLmNvbmZpZ3VyYXRpb24pXG5cbiAgICBpZiAoIXByb2ZpbGVDb250ZXh0KSByZXR1cm4gYXdhaXQgY2FsbGJhY2soKVxuXG4gICAgY29uc3Qgc3RhcnRlZEF0TXMgPSBub3dNcygpXG4gICAgbGV0IGZhaWxlZCA9IHRydWVcblxuICAgIHRyeSB7XG4gICAgICBjb25zdCByZXN1bHQgPSBhd2FpdCBjYWxsYmFjaygpXG5cbiAgICAgIGZhaWxlZCA9IGZhbHNlXG4gICAgICByZXR1cm4gcmVzdWx0XG4gICAgfSBmaW5hbGx5IHtcbiAgICAgIHByb2ZpbGVDb250ZXh0LnByb2ZpbGVyLnJlY29yZERhdGFiYXNlVHJhbnNhY3Rpb24ocHJvZmlsZUNvbnRleHQsIHtcbiAgICAgICAgYWN0aW9uLFxuICAgICAgICBkdXJhdGlvbk1zOiBub3dNcygpIC0gc3RhcnRlZEF0TXMsXG4gICAgICAgIGZhaWxlZFxuICAgICAgfSlcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogU3RhcnRzIGFuIG9wdGlvbmFsIHBoeXNpY2FsLXF1ZXJ5IHByb2ZpbGUgYXR0ZW1wdCB3aXRob3V0IHJldGFpbmluZyBTUUwuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBzcWwgLSBPcmlnaW5hbCBTUUwgdXNlZCBvbmx5IHRvIGRlcml2ZSBpdHMgcmVkYWN0ZWQgZGlhZ25vc3RpYy5cbiAgICogQHJldHVybnMge1Rlc3RQcm9maWxlUXVlcnlBdHRlbXB0IHwgdW5kZWZpbmVkfSAtIEFjdGl2ZSBwcm9maWxlIGhhbmRsZS5cbiAgICovXG4gIF9zdGFydFByb2ZpbGVkUXVlcnlBdHRlbXB0KHNxbCkge1xuICAgIGNvbnN0IGNvbnRleHQgPSBjdXJyZW50VGVzdFByb2ZpbGVDb250ZXh0KHRoaXMuY29uZmlndXJhdGlvbilcblxuICAgIGlmICghY29udGV4dCkgcmV0dXJuIHVuZGVmaW5lZFxuXG4gICAgcmV0dXJuIHtcbiAgICAgIGNvbnRleHQsXG4gICAgICBkaWFnbm9zdGljOiBzcWxEaWFnbm9zdGljKHNxbCksXG4gICAgICBzdGFydGVkQXRNczogbm93TXMoKVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBDb21wbGV0ZXMgYW4gb3B0aW9uYWwgcGh5c2ljYWwtcXVlcnkgcHJvZmlsZSBhdHRlbXB0LlxuICAgKiBAcGFyYW0ge1Rlc3RQcm9maWxlUXVlcnlBdHRlbXB0IHwgdW5kZWZpbmVkfSBhdHRlbXB0IC0gUHJvZmlsZSBoYW5kbGUuXG4gICAqIEBwYXJhbSB7Ym9vbGVhbn0gZmFpbGVkIC0gV2hldGhlciB0aGUgcGh5c2ljYWwgZHJpdmVyIGNhbGwgZmFpbGVkLlxuICAgKiBAcmV0dXJucyB7dm9pZH1cbiAgICovXG4gIF9maW5pc2hQcm9maWxlZFF1ZXJ5QXR0ZW1wdChhdHRlbXB0LCBmYWlsZWQpIHtcbiAgICBpZiAoIWF0dGVtcHQpIHJldHVyblxuXG4gICAgYXR0ZW1wdC5jb250ZXh0LnByb2ZpbGVyLnJlY29yZERhdGFiYXNlUXVlcnkoYXR0ZW1wdC5jb250ZXh0LCB7XG4gICAgICBkdXJhdGlvbk1zOiBub3dNcygpIC0gYXR0ZW1wdC5zdGFydGVkQXRNcyxcbiAgICAgIGZhaWxlZCxcbiAgICAgIC4uLmF0dGVtcHQuZGlhZ25vc3RpY1xuICAgIH0pXG4gIH1cblxuICAvKipcbiAgICogUnVucyBldmVyeSBndWFyZCByZWdpc3RlcmVkIHRvIHRoZSB0cmFuc2FjdGlvbiBmcmFtZS5cbiAgICogQHBhcmFtIHtUcmFuc2FjdGlvbkNhbGxiYWNrRnJhbWV9IGNhbGxiYWNrRnJhbWUgLSBGcmFtZSB3aG9zZSBndWFyZHMgYXJlIGNvbXBsZXRpbmcuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIHdoZW4gZXZlcnkgZ3VhcmQgYWNjZXB0cyB0aGUgY29tbWl0LlxuICAgKi9cbiAgYXN5bmMgX3J1bkJlZm9yZUNvbW1pdENhbGxiYWNrcyhjYWxsYmFja0ZyYW1lKSB7XG4gICAgZm9yIChjb25zdCBjYWxsYmFjayBvZiBjYWxsYmFja0ZyYW1lLmJlZm9yZUNvbW1pdENhbGxiYWNrcykge1xuICAgICAgYXdhaXQgY2FsbGJhY2soKVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBNZXJnZXMgY29tbWl0dGVkIGNhbGxiYWNrcyBpbnRvIHRoZSBwYXJlbnQgdHJhbnNhY3Rpb24gZnJhbWUgb3IgcnVucyB0aGVtIHdoZW4gdGhlIG91dGVybW9zdCBjb21taXQgY29tcGxldGVzLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyB3aGVuIGNvbXBsZXRlLlxuICAgKi9cbiAgYXN5bmMgX2NvbW1pdFRyYW5zYWN0aW9uQ2FsbGJhY2tGcmFtZSgpIHtcbiAgICBjb25zdCBjb21taXR0ZWRGcmFtZSA9IHRoaXMuX3RyYW5zYWN0aW9uQ2FsbGJhY2tGcmFtZXMucG9wKClcblxuICAgIGlmICghY29tbWl0dGVkRnJhbWUgfHwgY29tbWl0dGVkRnJhbWUuYWZ0ZXJDb21taXRDYWxsYmFja3MubGVuZ3RoID09PSAwKSByZXR1cm5cblxuICAgIGNvbnN0IHBhcmVudEZyYW1lID0gdGhpcy5fdHJhbnNhY3Rpb25DYWxsYmFja0ZyYW1lc1t0aGlzLl90cmFuc2FjdGlvbkNhbGxiYWNrRnJhbWVzLmxlbmd0aCAtIDFdXG5cbiAgICBpZiAocGFyZW50RnJhbWUpIHtcbiAgICAgIHBhcmVudEZyYW1lLmFmdGVyQ29tbWl0Q2FsbGJhY2tzLnB1c2goLi4uY29tbWl0dGVkRnJhbWUuYWZ0ZXJDb21taXRDYWxsYmFja3MpXG4gICAgICByZXR1cm5cbiAgICB9XG5cbiAgICBmb3IgKGNvbnN0IGNhbGxiYWNrIG9mIGNvbW1pdHRlZEZyYW1lLmFmdGVyQ29tbWl0Q2FsbGJhY2tzKSB7XG4gICAgICBhd2FpdCBjYWxsYmFjaygpXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIFN0cmVhbXMgdGhlIHJvd3Mgb2YgYHNxbGAgb25lIGF0IGEgdGltZSBpbnN0ZWFkIG9mIGJ1ZmZlcmluZyB0aGUgd2hvbGUgcmVzdWx0IHNldCwgc28gYVxuICAgKiBjYWxsZXIgY2FuIHByb2Nlc3MgYW4gYXJiaXRyYXJpbHkgbGFyZ2UgcmVzdWx0IHdpdGggYm91bmRlZCBtZW1vcnkuIFRoaXMgYmFzZSBpbXBsZW1lbnRhdGlvblxuICAgKiBmYWxscyBiYWNrIHRvIGEgYnVmZmVyZWQge0BsaW5rIHF1ZXJ5fSBhbmQgeWllbGRzIGl0cyByb3dzOyBkcml2ZXJzIGJhY2tlZCBieSBhIGN1cnNvci1jYXBhYmxlXG4gICAqIGNsaWVudCAodGhlIE15U1FMIGRyaXZlcikgb3ZlcnJpZGUgaXQgd2l0aCB0cnVlIHNlcnZlci1zaWRlIHN0cmVhbWluZy5cbiAgICogQHBhcmFtIHtzdHJpbmd9IHNxbCAtIFNRTCBzdHJpbmcgdG8gc3RyZWFtLlxuICAgKiBAcGFyYW0ge1F1ZXJ5T3B0aW9uc30gW29wdGlvbnNdIC0gUXVlcnkgb3B0aW9ucywgYXMgZm9yIHtAbGluayBxdWVyeX0uXG4gICAqIEB5aWVsZHMge1JlY29yZDxzdHJpbmcsIHVua25vd24+fSAtIFRoZSByZXN1bHQgcm93cywgb25lIGF0IGEgdGltZS5cbiAgICovXG4gIGFzeW5jICpxdWVyeVN0cmVhbShzcWwsIG9wdGlvbnMgPSB7fSkge1xuICAgIGNvbnN0IHJvd3MgPSBhd2FpdCB0aGlzLnF1ZXJ5KHNxbCwgb3B0aW9ucylcblxuICAgIGZvciAoY29uc3Qgcm93IG9mIEFycmF5LmlzQXJyYXkocm93cykgPyByb3dzIDogW10pIHtcbiAgICAgIHlpZWxkIHJvd1xuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHF1ZXJ5LlxuICAgKiBAcGFyYW0ge3N0cmluZ30gc3FsIC0gU1FMIHN0cmluZy5cbiAgICogQHBhcmFtIHtRdWVyeU9wdGlvbnN9IFtvcHRpb25zXSAtIFF1ZXJ5IG9wdGlvbnMuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPFF1ZXJ5UmVzdWx0VHlwZT59IC0gUmVzb2x2ZXMgd2l0aCB0aGUgcXVlcnkuXG4gICAqL1xuICBhc3luYyBxdWVyeShzcWwsIG9wdGlvbnMgPSB7fSkge1xuICAgIGF3YWl0IHRoaXMuX3dhaXRGb3JPcGVyYXRpb25MZWFzZShvcHRpb25zLm9wZXJhdGlvbk93bmVyKVxuICAgIHRoaXMuX2Fzc2VydFdyaXRhYmxlUXVlcnkoc3FsKVxuXG4gICAgbGV0IHRyaWVzID0gMFxuICAgIGNvbnN0IG1heFRyaWVzID0gNVxuICAgIGNvbnN0IHJlcXVlc3RUaW1pbmcgPSB0aGlzLmNvbmZpZ3VyYXRpb24uZ2V0Q3VycmVudFJlcXVlc3RUaW1pbmcoKVxuICAgIGNvbnN0IGxvZ1F1ZXJ5ID0gb3B0aW9ucy5sb2dRdWVyeSA/PyB0aGlzLl9xdWVyeUxvZ2dpbmdFbmFibGVkKClcbiAgICBjb25zdCBzb3VyY2VTdGFjayA9IGxvZ1F1ZXJ5ID8gKG9wdGlvbnMuc291cmNlU3RhY2sgfHwgRXJyb3IoKS5zdGFjaykgOiB1bmRlZmluZWRcbiAgICBjb25zdCBxdWVyeVNxbCA9IHRoaXMuX3F1ZXJ5U3FsV2l0aFByb2Nlc3NMaXN0Q29tbWVudChzcWwsIG9wdGlvbnMpXG5cbiAgICB3aGlsZSAodHJpZXMgPCBtYXhUcmllcykge1xuICAgICAgdHJpZXMrK1xuXG4gICAgICB0cnkge1xuICAgICAgICByZXR1cm4gYXdhaXQgdGhpcy5fcXVlcnlBY3R1YWxXaXRoTG9nZ2luZyh7b3JpZ2luYWxTcWw6IHNxbCwgcXVlcnlTcWx9LCB7Li4ub3B0aW9ucywgbG9nUXVlcnksIHNvdXJjZVN0YWNrfSwgcmVxdWVzdFRpbWluZywgdHJpZXMpXG4gICAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgICBpZiAoIShlcnJvciBpbnN0YW5jZW9mIEVycm9yKSkgdGhyb3cgZXJyb3JcblxuICAgICAgICB0aGlzLl9mYWlsZWRRdWVyeURpYWdub3N0aWNzLnNldChlcnJvciwgc3FsRGlhZ25vc3RpYyhzcWwpKVxuXG4gICAgICAgIC8vIEEgZGVsaWJlcmF0ZWx5LWFib3J0ZWQgcXVlcnkgbXVzdCBuZXZlciBiZSBzaWxlbnRseSByZS1ydW4g4oCUIGl0c1xuICAgICAgICAvLyBjb25uZWN0aW9uIHdhcyBkZXN0cm95ZWQgb24gcHVycG9zZSwgc28gdHJlYXQgaXQgYXMgdGVybWluYWwuXG4gICAgICAgIGlmIChlcnJvciBpbnN0YW5jZW9mIFF1ZXJ5QWJvcnRlZEVycm9yKSB0aHJvdyBlcnJvclxuXG4gICAgICAgIGNvbnN0IHJldHJ5SW5mbyA9IHRoaXMucmV0cnlhYmxlRGF0YWJhc2VFcnJvcihlcnJvcilcblxuICAgICAgICBpZiAob3B0aW9ucy5yZXRyeSAhPT0gZmFsc2UgJiYgdHJpZXMgPCBtYXhUcmllcyAmJiByZXRyeUluZm8ucmV0cnkpIHtcbiAgICAgICAgICBpZiAocmV0cnlJbmZvLnJlY29ubmVjdCkge1xuICAgICAgICAgICAgaWYgKHRoaXMuX3RyYW5zYWN0aW9uc0NvdW50ID4gMCkge1xuICAgICAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoYENhbm5vdCByZWNvbm5lY3Qgd2hpbGUgYSB0cmFuc2FjdGlvbiBpcyBhY3RpdmUgKCR7dGhpcy5fdHJhbnNhY3Rpb25zQ291bnR9KS4gT3JpZ2luYWwgZXJyb3I6ICR7ZXJyb3IubWVzc2FnZX1gLCB7Y2F1c2U6IGVycm9yfSlcbiAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgYXdhaXQgdGhpcy5yZWNvbm5lY3QoKVxuICAgICAgICAgIH1cblxuICAgICAgICAgIGNvbnN0IHdhaXRNcyA9IHR5cGVvZiByZXRyeUluZm8ud2FpdE1zID09PSBcIm51bWJlclwiICYmIE51bWJlci5pc0Zpbml0ZShyZXRyeUluZm8ud2FpdE1zKSA/IHJldHJ5SW5mby53YWl0TXMgOiAxMDBcblxuICAgICAgICAgIGlmICh3YWl0TXMgPiAwKSBhd2FpdCB3YWl0KHdhaXRNcylcbiAgICAgICAgICBjb25zdCBzZW5zaXRpdmVWYWx1ZXMgPSByZXF1ZXN0VGltaW5nID8gcmVxdWVzdFRpbWluZy5nZXRMb2dTZW5zaXRpdmVWYWx1ZXMoKSA6IG5ldyBTZXQoKVxuICAgICAgICAgIGNvbnN0IGxvZ2dlZEVycm9yID0gdGhpcy5jb25maWd1cmF0aW9uLmdldExvZ1JlZGFjdG9yKCkucmVkYWN0U3RyaW5nKGVycm9yLnN0YWNrIHx8IGVycm9yLm1lc3NhZ2UsIHNlbnNpdGl2ZVZhbHVlcylcblxuICAgICAgICAgIHRoaXMubG9nZ2VyLndhcm4oYFJldHJ5aW5nIHF1ZXJ5IGJlY2F1c2UgZmFpbGVkIHdpdGg6ICR7bG9nZ2VkRXJyb3J9YClcbiAgICAgICAgICAvLyBSZXRyeVxuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgIHRocm93IGVycm9yXG4gICAgICAgIH1cbiAgICAgIH1cbiAgICB9XG5cbiAgICB0aHJvdyBuZXcgRXJyb3IoXCIncXVlcnknIHVuZXhwZWN0ZWQgY2FtZSBoZXJlXCIpXG4gIH1cblxuICAvKipcbiAgICogRXhlY3V0ZXMgYSBtdXRhdGlvbiBhbmQgcmV0dXJucyB0aGUgbnVtYmVyIG9mIHJvd3MgY2hhbmdlZCBieSB0aGF0IHN0YXRlbWVudC5cbiAgICogQHBhcmFtIHtzdHJpbmd9IHNxbCAtIE11dGF0aW9uIFNRTCBzdHJpbmcuXG4gICAqIEBwYXJhbSB7UXVlcnlPcHRpb25zfSBbb3B0aW9uc10gLSBRdWVyeSBvd25lcnNoaXAgb3B0aW9ucy5cbiAgICogQHJldHVybnMge1Byb21pc2U8bnVtYmVyPn0gLSBBZmZlY3RlZCByb3cgY291bnQuXG4gICAqL1xuICBhc3luYyBhZmZlY3RlZFJvd3Moc3FsLCBvcHRpb25zID0ge30pIHtcbiAgICBhd2FpdCB0aGlzLl93YWl0Rm9yT3BlcmF0aW9uTGVhc2Uob3B0aW9ucy5vcGVyYXRpb25Pd25lcilcbiAgICB0aGlzLl9hc3NlcnRXcml0YWJsZVF1ZXJ5KHNxbClcblxuICAgIHJldHVybiBhd2FpdCBjb29yZGluYXRlU2hhcmVkVHJhbnNhY3Rpb25Db25uZWN0aW9uKHRoaXMsIGFzeW5jICgpID0+IHtcbiAgICAgIGF3YWl0IHRoaXMuYmVmb3JlUXVlcnkoc3FsLCBvcHRpb25zKVxuXG4gICAgICB0cnkge1xuICAgICAgICBjb25zdCBwcm9maWxlQXR0ZW1wdCA9IHRoaXMuX3N0YXJ0UHJvZmlsZWRRdWVyeUF0dGVtcHQoc3FsKVxuICAgICAgICBsZXQgZmFpbGVkID0gdHJ1ZVxuXG4gICAgICAgIHRyeSB7XG4gICAgICAgICAgY29uc3QgYWZmZWN0ZWRSb3dzID0gYXdhaXQgdGhpcy5fcnVuUGh5c2ljYWxDb25uZWN0aW9uUmVxdWVzdChcbiAgICAgICAgICAgIGFzeW5jICgpID0+IGF3YWl0IHRoaXMuX2FmZmVjdGVkUm93c0FjdHVhbChzcWwpXG4gICAgICAgICAgKVxuXG4gICAgICAgICAgZmFpbGVkID0gZmFsc2VcbiAgICAgICAgICByZXR1cm4gYWZmZWN0ZWRSb3dzXG4gICAgICAgIH0gZmluYWxseSB7XG4gICAgICAgICAgdGhpcy5fZmluaXNoUHJvZmlsZWRRdWVyeUF0dGVtcHQocHJvZmlsZUF0dGVtcHQsIGZhaWxlZClcbiAgICAgICAgfVxuICAgICAgfSBmaW5hbGx5IHtcbiAgICAgICAgYXdhaXQgdGhpcy5hZnRlclF1ZXJ5KHNxbCwgb3B0aW9ucylcbiAgICAgIH1cbiAgICB9LCBvcHRpb25zLm9wZXJhdGlvbk93bmVyKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgcXVlcnkgYWN0dWFsIHdpdGggbG9nZ2luZy5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBPcHRpb25zIG9iamVjdC5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGFyZ3Mub3JpZ2luYWxTcWwgLSBPcmlnaW5hbCBTUUwgc3RyaW5nIGJlZm9yZSBwcm9jZXNzLWxpc3QgY29tbWVudHMuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBhcmdzLnF1ZXJ5U3FsIC0gU1FMIHN0cmluZyBzZW50IHRvIHRoZSBkYXRhYmFzZS5cbiAgICogQHBhcmFtIHtRdWVyeU9wdGlvbnN9IG9wdGlvbnMgLSBRdWVyeSBvcHRpb25zLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uLy4uL2h0dHAtc2VydmVyL2NsaWVudC9yZXF1ZXN0LXRpbWluZy5qc1wiKS5kZWZhdWx0IHwgdW5kZWZpbmVkfSByZXF1ZXN0VGltaW5nIC0gUmVxdWVzdCB0aW1pbmcuXG4gICAqIEBwYXJhbSB7bnVtYmVyfSB0cmllcyAtIFF1ZXJ5IGF0dGVtcHQgY291bnQuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPFF1ZXJ5UmVzdWx0VHlwZT59IC0gUmVzb2x2ZXMgd2l0aCB0aGUgcXVlcnkuXG4gICAqL1xuICBhc3luYyBfcXVlcnlBY3R1YWxXaXRoTG9nZ2luZyh7b3JpZ2luYWxTcWwsIHF1ZXJ5U3FsfSwgb3B0aW9ucywgcmVxdWVzdFRpbWluZywgdHJpZXMpIHtcbiAgICBjb25zdCBzdGFydGVkQXRNcyA9IG5vd01zKClcbiAgICBjb25zdCBwcmV2aW91c0FjdGl2ZVF1ZXJ5ID0gdGhpcy5fYWN0aXZlUXVlcnlcbiAgICB0aGlzLl9hY3RpdmVRdWVyeSA9IHtcbiAgICAgIGFubm90YXRpb25zOiBnZXREYXRhYmFzZUFubm90YXRpb25zKCksXG4gICAgICBsb2dOYW1lOiBvcHRpb25zLmxvZ05hbWUgfHwgXCJTUUxcIixcbiAgICAgIHNxbFByZXZpZXc6IHRoaXMuX2RlYnVnU3FsUHJldmlldyhvcmlnaW5hbFNxbCksXG4gICAgICBzdGFydGVkQXRVbml4TXM6IERhdGUubm93KClcbiAgICB9XG4gICAgbGV0IHJlc3VsdFxuXG4gICAgdHJ5IHtcbiAgICAgIHRyeSB7XG4gICAgICAgIGNvbnN0IHJ1blF1ZXJ5QWN0dWFsV2l0aEhvb2tzID0gYXN5bmMgKCkgPT4gYXdhaXQgdGhpcy5fcXVlcnlBY3R1YWxXaXRoSG9va3MocXVlcnlTcWwsIG9wdGlvbnMsIG9yaWdpbmFsU3FsKVxuXG4gICAgICAgIGlmIChyZXF1ZXN0VGltaW5nICYmIHRyaWVzID09PSAxKSB7XG4gICAgICAgICAgcmVzdWx0ID0gYXdhaXQgcmVxdWVzdFRpbWluZy5tZWFzdXJlRGJRdWVyeShydW5RdWVyeUFjdHVhbFdpdGhIb29rcylcbiAgICAgICAgfSBlbHNlIGlmIChyZXF1ZXN0VGltaW5nKSB7XG4gICAgICAgICAgcmVzdWx0ID0gYXdhaXQgcmVxdWVzdFRpbWluZy5tZWFzdXJlKFwiZGJcIiwgcnVuUXVlcnlBY3R1YWxXaXRoSG9va3MpXG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgcmVzdWx0ID0gYXdhaXQgcnVuUXVlcnlBY3R1YWxXaXRoSG9va3MoKVxuICAgICAgICB9XG4gICAgICB9IGZpbmFsbHkge1xuICAgICAgICB0aGlzLl9hY3RpdmVRdWVyeSA9IHByZXZpb3VzQWN0aXZlUXVlcnlcbiAgICAgIH1cbiAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgaWYgKG9wdGlvbnMubG9nUXVlcnkgIT09IGZhbHNlKSB7XG4gICAgICAgIGF3YWl0IHRoaXMuX2xvZ1F1ZXJ5KHtcbiAgICAgICAgICBlbGFwc2VkTXM6IG5vd01zKCkgLSBzdGFydGVkQXRNcyxcbiAgICAgICAgICBlcnJvcjogZW5zdXJlRXJyb3IoZXJyb3IpLFxuICAgICAgICAgIGxvZ05hbWU6IG9wdGlvbnMubG9nTmFtZSB8fCBcIlNRTFwiLFxuICAgICAgICAgIHJlcXVlc3RUaW1pbmcsXG4gICAgICAgICAgc291cmNlU3RhY2s6IG9wdGlvbnMuc291cmNlU3RhY2ssXG4gICAgICAgICAgc3FsOiBvcmlnaW5hbFNxbFxuICAgICAgICB9KVxuICAgICAgfVxuXG4gICAgICB0aHJvdyBlcnJvclxuICAgIH1cblxuICAgIGNvbnN0IGVsYXBzZWRNcyA9IG5vd01zKCkgLSBzdGFydGVkQXRNc1xuXG4gICAgaWYgKG9wdGlvbnMubG9nUXVlcnkgIT09IGZhbHNlKSB7XG4gICAgICBhd2FpdCB0aGlzLl9sb2dRdWVyeSh7XG4gICAgICAgIGVsYXBzZWRNcyxcbiAgICAgICAgbG9nTmFtZTogb3B0aW9ucy5sb2dOYW1lIHx8IFwiU1FMXCIsXG4gICAgICAgIHJlcXVlc3RUaW1pbmcsXG4gICAgICAgIHNvdXJjZVN0YWNrOiBvcHRpb25zLnNvdXJjZVN0YWNrLFxuICAgICAgICBzcWw6IG9yaWdpbmFsU3FsXG4gICAgICB9KVxuICAgIH1cblxuICAgIGlmICh0aGlzLl9zY2hlbWFDYWNoZUludmFsaWRhdGluZ1NxbChvcmlnaW5hbFNxbCkpIHtcbiAgICAgIHRoaXMuY2xlYXJTY2hlbWFDYWNoZSgpXG4gICAgfVxuXG4gICAgcmV0dXJuIHJlc3VsdFxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgcXVlcnkgYWN0dWFsIHdpdGggYmVmb3JlL2FmdGVyIGhvb2tzLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gc3FsIC0gU1FMIHN0cmluZy5cbiAgICogQHBhcmFtIHtRdWVyeU9wdGlvbnN9IG9wdGlvbnMgLSBRdWVyeSBvcHRpb25zLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gb3JpZ2luYWxTcWwgLSBTUUwgYmVmb3JlIHByb2Nlc3MtbGlzdCBjb21tZW50cy5cbiAgICogQHJldHVybnMge1Byb21pc2U8UXVlcnlSZXN1bHRUeXBlPn0gLSBSZXNvbHZlcyB3aXRoIHRoZSBxdWVyeS5cbiAgICovXG4gIGFzeW5jIF9xdWVyeUFjdHVhbFdpdGhIb29rcyhzcWwsIG9wdGlvbnMsIG9yaWdpbmFsU3FsKSB7XG4gICAgcmV0dXJuIGF3YWl0IGNvb3JkaW5hdGVTaGFyZWRUcmFuc2FjdGlvbkNvbm5lY3Rpb24odGhpcywgYXN5bmMgKCkgPT4ge1xuICAgICAgYXdhaXQgdGhpcy5iZWZvcmVRdWVyeShzcWwsIG9wdGlvbnMpXG5cbiAgICAgIHRyeSB7XG4gICAgICAgIGNvbnN0IHByb2ZpbGVBdHRlbXB0ID0gdGhpcy5fc3RhcnRQcm9maWxlZFF1ZXJ5QXR0ZW1wdChvcmlnaW5hbFNxbClcbiAgICAgICAgbGV0IGZhaWxlZCA9IHRydWVcblxuICAgICAgICB0cnkge1xuICAgICAgICAgIGNvbnN0IHJlc3VsdCA9IGF3YWl0IHRoaXMuX3J1blBoeXNpY2FsQ29ubmVjdGlvblJlcXVlc3QoXG4gICAgICAgICAgICBhc3luYyAoKSA9PiBhd2FpdCB0aGlzLl9xdWVyeUFjdHVhbChzcWwsIG9wdGlvbnMpXG4gICAgICAgICAgKVxuXG4gICAgICAgICAgZmFpbGVkID0gZmFsc2VcbiAgICAgICAgICByZXR1cm4gcmVzdWx0XG4gICAgICAgIH0gZmluYWxseSB7XG4gICAgICAgICAgdGhpcy5fZmluaXNoUHJvZmlsZWRRdWVyeUF0dGVtcHQocHJvZmlsZUF0dGVtcHQsIGZhaWxlZClcbiAgICAgICAgfVxuICAgICAgfSBmaW5hbGx5IHtcbiAgICAgICAgYXdhaXQgdGhpcy5hZnRlclF1ZXJ5KHNxbCwgb3B0aW9ucylcbiAgICAgIH1cbiAgICB9LCBvcHRpb25zLm9wZXJhdGlvbk93bmVyKVxuICB9XG5cbiAgLyoqXG4gICAqIEhvb2sgdGhhdCBydW5zIGltbWVkaWF0ZWx5IGJlZm9yZSBhIFNRTCBxdWVyeSBpcyBzZW50IHRvIHRoZSBkcml2ZXIuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBfc3FsIC0gU1FMIHN0cmluZy5cbiAgICogQHBhcmFtIHtRdWVyeU9wdGlvbnN9IF9vcHRpb25zIC0gUXVlcnkgb3B0aW9ucy5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgd2hlbiBjb21wbGV0ZS5cbiAgICovXG4gIGFzeW5jIGJlZm9yZVF1ZXJ5KF9zcWwsIF9vcHRpb25zKSB7XG4gICAgLy8gTm8tb3AgYnkgZGVmYXVsdFxuICB9XG5cbiAgLyoqXG4gICAqIEhvb2sgdGhhdCBydW5zIGltbWVkaWF0ZWx5IGFmdGVyIGEgU1FMIHF1ZXJ5IGhhcyBjb21wbGV0ZWQgb3IgZmFpbGVkLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gX3NxbCAtIFNRTCBzdHJpbmcuXG4gICAqIEBwYXJhbSB7UXVlcnlPcHRpb25zfSBfb3B0aW9ucyAtIFF1ZXJ5IG9wdGlvbnMuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIHdoZW4gY29tcGxldGUuXG4gICAqL1xuICBhc3luYyBhZnRlclF1ZXJ5KF9zcWwsIF9vcHRpb25zKSB7XG4gICAgLy8gTm8tb3AgYnkgZGVmYXVsdFxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZ2V0IGRlYnVnIHNuYXBzaG90LlxuICAgKiBAcmV0dXJucyB7RGF0YWJhc2VDb25uZWN0aW9uRGVidWdTbmFwc2hvdH0gLSBEaWFnbm9zdGljIHNuYXBzaG90IGZvciB0aGlzIGNvbm5lY3Rpb24uXG4gICAqL1xuICBnZXREZWJ1Z1NuYXBzaG90KCkge1xuICAgIGNvbnN0IG5vdyA9IERhdGUubm93KClcbiAgICBjb25zdCBhY3RpdmVRdWVyeSA9IHRoaXMuX2FjdGl2ZVF1ZXJ5XG5cbiAgICByZXR1cm4ge1xuICAgICAgYWN0aXZlUXVlcnk6IGFjdGl2ZVF1ZXJ5ID8gey4uLmFjdGl2ZVF1ZXJ5LCBydW5uaW5nTXM6IE1hdGgubWF4KDAsIG5vdyAtIGFjdGl2ZVF1ZXJ5LnN0YXJ0ZWRBdFVuaXhNcyl9IDogbnVsbCxcbiAgICAgIGNoZWNrb3V0QWdlTXM6IHRoaXMuX2Nvbm5lY3Rpb25DaGVja2VkT3V0QXRVbml4TXMgPyBNYXRoLm1heCgwLCBub3cgLSB0aGlzLl9jb25uZWN0aW9uQ2hlY2tlZE91dEF0VW5peE1zKSA6IHVuZGVmaW5lZCxcbiAgICAgIGNoZWNrZWRPdXRBdFVuaXhNczogdGhpcy5fY29ubmVjdGlvbkNoZWNrZWRPdXRBdFVuaXhNcyxcbiAgICAgIGNoZWNrb3V0TmFtZTogdGhpcy5fY29ubmVjdGlvbkNoZWNrb3V0TmFtZSxcbiAgICAgIGRyaXZlckNsYXNzOiB0aGlzLmNvbnN0cnVjdG9yLm5hbWUsXG4gICAgICBpZFNlcTogdGhpcy5pZFNlcSxcbiAgICAgIG9wZW5UcmFuc2FjdGlvbnM6IHRoaXMuX3RyYW5zYWN0aW9uc0NvdW50LFxuICAgICAgc2NoZW1hQ2FjaGVFbnRyaWVzOiB0aGlzLl9zY2hlbWFDYWNoZS5zaXplXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIFJldHVybnMgYSBib3VuZGVkIHByZWZpeCBvZiBgc3FsYCBmb3IgbGlnaHR3ZWlnaHQgZGlhZ25vc3RpYyBzY2FubmluZy5cbiAgICogQHBhcmFtIHtzdHJpbmd9IHNxbCAtIFNRTCBzdHJpbmcuXG4gICAqIEBwYXJhbSB7bnVtYmVyfSBsaW1pdCAtIE1heGltdW0gY29kZSB1bml0cyB0byBpbnNwZWN0LlxuICAgKiBAcmV0dXJucyB7c3RyaW5nfSAtIFByZWZpeCBvZiBgc3FsYC5cbiAgICovXG4gIF9kaWFnbm9zdGljU3FsUHJlZml4KHNxbCwgbGltaXQpIHtcbiAgICByZXR1cm4gc3FsLmxlbmd0aCA8PSBsaW1pdCA/IHNxbCA6IHNxbC5zbGljZSgwLCBsaW1pdClcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGRlYnVnIHNxbCBwcmV2aWV3LlxuICAgKiBAcGFyYW0ge3N0cmluZ30gc3FsIC0gU1FMIHRvIHByZXZpZXcuXG4gICAqIEByZXR1cm5zIHtzdHJpbmd9IC0gTm9ybWFsaXplZCB0cnVuY2F0ZWQgU1FMIHByZXZpZXcgZm9yIGRpYWdub3N0aWNzLlxuICAgKi9cbiAgX2RlYnVnU3FsUHJldmlldyhzcWwpIHtcbiAgICBjb25zdCBwcmVmaXggPSB0aGlzLl9kaWFnbm9zdGljU3FsUHJlZml4KHNxbCwgU1FMX1BSRVZJRVdfU0NBTl9MSU1JVClcblxuICAgIHJldHVybiBwcmVmaXhcbiAgICAgIC5yZXBsYWNlKC9cXHMrL2csIFwiIFwiKVxuICAgICAgLnRyaW0oKVxuICAgICAgLnNsaWNlKDAsIDUwMClcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHF1ZXJ5IHNxbCB3aXRoIHByb2Nlc3MgbGlzdCBjb21tZW50LlxuICAgKiBAcGFyYW0ge3N0cmluZ30gc3FsIC0gU1FMIHN0cmluZy5cbiAgICogQHBhcmFtIHtRdWVyeU9wdGlvbnN9IG9wdGlvbnMgLSBRdWVyeSBvcHRpb25zLlxuICAgKiBAcmV0dXJucyB7c3RyaW5nfSAtIFNRTCBzdHJpbmcgd2l0aCBhIGxlYWRpbmcgcHJvY2Vzcy1saXN0IGNvbW1lbnQgd2hlbiBhbm5vdGF0aW9ucyBleGlzdC5cbiAgICovXG4gIF9xdWVyeVNxbFdpdGhQcm9jZXNzTGlzdENvbW1lbnQoc3FsLCBvcHRpb25zKSB7XG4gICAgaWYgKG9wdGlvbnMucHJvY2Vzc0xpc3RDb21tZW50ID09PSBmYWxzZSkgcmV0dXJuIHNxbFxuXG4gICAgY29uc3QgcGFydHMgPSBbXVxuXG4gICAgaWYgKHRoaXMuX2Nvbm5lY3Rpb25DaGVja291dE5hbWUpIHtcbiAgICAgIHBhcnRzLnB1c2goYGNoZWNrb3V0PVwiJHt0aGlzLl9wcm9jZXNzTGlzdENvbW1lbnRWYWx1ZSh0aGlzLl9jb25uZWN0aW9uQ2hlY2tvdXROYW1lKX1cImApXG4gICAgfVxuXG4gICAgY29uc3QgYW5ub3RhdGlvbnMgPSBnZXREYXRhYmFzZUFubm90YXRpb25zKClcblxuICAgIGlmIChhbm5vdGF0aW9ucy5sZW5ndGggPiAwKSB7XG4gICAgICBwYXJ0cy5wdXNoKGBhbm5vdGF0aW9ucz1cIiR7dGhpcy5fcHJvY2Vzc0xpc3RDb21tZW50VmFsdWUoYW5ub3RhdGlvbnMuam9pbihcIiA+IFwiKSl9XCJgKVxuICAgIH1cblxuICAgIGlmIChwYXJ0cy5sZW5ndGggPT09IDApIHJldHVybiBzcWxcblxuICAgIHJldHVybiBgLyogdmVsb2Npb3VzICR7cGFydHMuam9pbihcIiBcIil9ICovICR7c3FsfWBcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHByb2Nlc3MgbGlzdCBjb21tZW50IHZhbHVlLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gdmFsdWUgLSBSYXcgcHJvY2Vzcy1saXN0IGNvbW1lbnQgdmFsdWUuXG4gICAqIEByZXR1cm5zIHtzdHJpbmd9IC0gU2FuaXRpemVkIHByb2Nlc3MtbGlzdCBjb21tZW50IHZhbHVlLlxuICAgKi9cbiAgX3Byb2Nlc3NMaXN0Q29tbWVudFZhbHVlKHZhbHVlKSB7XG4gICAgbGV0IHNhbml0aXplZCA9IFwiXCJcblxuICAgIGZvciAoY29uc3QgY2hhcmFjdGVyIG9mIHZhbHVlKSB7XG4gICAgICBjb25zdCBjb2RlUG9pbnQgPSBjaGFyYWN0ZXIuY29kZVBvaW50QXQoMClcblxuICAgICAgc2FuaXRpemVkICs9IGNvZGVQb2ludCAhPT0gdW5kZWZpbmVkICYmIChjb2RlUG9pbnQgPCAzMiB8fCBjb2RlUG9pbnQgPT09IDEyNykgPyBcIiBcIiA6IGNoYXJhY3RlclxuICAgIH1cblxuICAgIHJldHVybiBzYW5pdGl6ZWRcbiAgICAgIC5yZXBsYWNlKC9cXCpcXC8vZywgXCIqIC9cIilcbiAgICAgIC5yZXBsYWNlKC9cXHMrL2csIFwiIFwiKVxuICAgICAgLnRyaW0oKVxuICAgICAgLnNsaWNlKDAsIDIwMClcbiAgICAgIC5yZXBsYWNlKC9cIi9nLCBcIidcIilcbiAgfVxuXG4gIC8qKlxuICAgKiBSZWFkcyB0aGUgbmV4dCBTUUwgdG9rZW4gc3RhcnRpbmcgYXQgYHN0YXJ0SW5kZXhgLCBza2lwcGluZyBsZWFkaW5nIHRyaXZpYVxuICAgKiAoQk9NLCB3aGl0ZXNwYWNlLCBibG9jayBjb21tZW50cywgbGluZSBjb21tZW50cykuIElmIHRoZSBzY2FuIGNhbm5vdCBmaW5pc2hcbiAgICogc2tpcHBpbmcgdHJpdmlhIGJlZm9yZSBgbGltaXRgLCB0aGUgcmVzdWx0IGlzIG1hcmtlZCBpbmNvbXBsZXRlIHNvIGNhbGxlcnNcbiAgICogY2FuIGNvbnNlcnZhdGl2ZWx5IHRyZWF0IHRoZSBzdGF0ZW1lbnQgYXMgc2NoZW1hLWludmFsaWRhdGluZy5cbiAgICogQHBhcmFtIHtzdHJpbmd9IHNxbCAtIFNRTCBzdHJpbmcuXG4gICAqIEBwYXJhbSB7bnVtYmVyfSBzdGFydEluZGV4IC0gSW5kZXggdG8gc3RhcnQgc2Nhbm5pbmcuXG4gICAqIEBwYXJhbSB7bnVtYmVyfSBsaW1pdCAtIE1heGltdW0gYWJzb2x1dGUgaW5kZXggdG8gc2NhbiB3aGlsZSBza2lwcGluZyBsZWFkaW5nIHRyaXZpYS5cbiAgICogQHJldHVybnMge1NxbFRva2VuUmVzdWx0fSAtIFRva2VuIHJlc3VsdC5cbiAgICovXG4gIF9yZWFkU3FsVG9rZW4oc3FsLCBzdGFydEluZGV4LCBsaW1pdCkge1xuICAgIGxldCBpID0gc3RhcnRJbmRleFxuICAgIGNvbnN0IGxlbiA9IHNxbC5sZW5ndGhcblxuICAgIHdoaWxlIChpIDwgbGVuICYmIGkgPCBsaW1pdCkge1xuICAgICAgY29uc3QgY2hhciA9IHNxbFtpXVxuXG4gICAgICBpZiAoY2hhciA9PT0gXCJcXHVmZWZmXCIgfHwgL1xccy8udGVzdChjaGFyKSkge1xuICAgICAgICBpKytcbiAgICAgICAgY29udGludWVcbiAgICAgIH1cblxuICAgICAgaWYgKGNoYXIgPT09IFwiL1wiICYmIHNxbFtpICsgMV0gPT09IFwiKlwiKSB7XG4gICAgICAgIGNvbnN0IGNsb3NlID0gc3FsLmluZGV4T2YoXCIqL1wiLCBpICsgMilcblxuICAgICAgICBpZiAoY2xvc2UgPT09IC0xIHx8IGNsb3NlICsgMiA+IGxpbWl0KSB7XG4gICAgICAgICAgcmV0dXJuIHtpbmNvbXBsZXRlOiB0cnVlLCBpbmRleDogaSwgdG9rZW46IHVuZGVmaW5lZH1cbiAgICAgICAgfVxuXG4gICAgICAgIGkgPSBjbG9zZSArIDJcbiAgICAgICAgY29udGludWVcbiAgICAgIH1cblxuICAgICAgaWYgKGNoYXIgPT09IFwiLVwiICYmIHNxbFtpICsgMV0gPT09IFwiLVwiKSB7XG4gICAgICAgIGNvbnN0IG5ld2xpbmUgPSBzcWwuaW5kZXhPZihcIlxcblwiLCBpICsgMilcblxuICAgICAgICBpZiAobmV3bGluZSA9PT0gLTEpIHtcbiAgICAgICAgICByZXR1cm4ge2luY29tcGxldGU6IGZhbHNlLCBpbmRleDogbGVuLCB0b2tlbjogdW5kZWZpbmVkfVxuICAgICAgICB9XG5cbiAgICAgICAgaWYgKG5ld2xpbmUgKyAxID4gbGltaXQpIHtcbiAgICAgICAgICByZXR1cm4ge2luY29tcGxldGU6IHRydWUsIGluZGV4OiBpLCB0b2tlbjogdW5kZWZpbmVkfVxuICAgICAgICB9XG5cbiAgICAgICAgaSA9IG5ld2xpbmUgKyAxXG4gICAgICAgIGNvbnRpbnVlXG4gICAgICB9XG5cbiAgICAgIGxldCB0b2tlbiA9IFwiXCJcblxuICAgICAgd2hpbGUgKGkgPCBsZW4pIHtcbiAgICAgICAgY29uc3QgYyA9IHNxbFtpXVxuXG4gICAgICAgIGlmICgvXFxzLy50ZXN0KGMpIHx8IGMgPT09IFwiXFx1ZmVmZlwiKSBicmVha1xuICAgICAgICBpZiAoYyA9PT0gXCIvXCIgJiYgc3FsW2kgKyAxXSA9PT0gXCIqXCIpIGJyZWFrXG4gICAgICAgIGlmIChjID09PSBcIi1cIiAmJiBzcWxbaSArIDFdID09PSBcIi1cIikgYnJlYWtcblxuICAgICAgICB0b2tlbiArPSBjXG4gICAgICAgIGkrK1xuICAgICAgfVxuXG4gICAgICByZXR1cm4ge2luY29tcGxldGU6IGZhbHNlLCB0b2tlbjogdG9rZW4udG9Mb3dlckNhc2UoKSwgaW5kZXg6IGl9XG4gICAgfVxuXG4gICAgaWYgKGkgPj0gbGVuKSB7XG4gICAgICByZXR1cm4ge2luY29tcGxldGU6IGZhbHNlLCBpbmRleDogbGVuLCB0b2tlbjogdW5kZWZpbmVkfVxuICAgIH1cblxuICAgIHJldHVybiB7aW5jb21wbGV0ZTogdHJ1ZSwgaW5kZXg6IGksIHRva2VuOiB1bmRlZmluZWR9XG4gIH1cblxuICAvKipcbiAgICogUnVucyBzY2hlbWEgY2FjaGUgaW52YWxpZGF0aW5nIHNxbC5cbiAgICogQHBhcmFtIHtzdHJpbmd9IHNxbCAtIFNRTCBzdHJpbmcuXG4gICAqIEByZXR1cm5zIHtib29sZWFufSAtIFdoZXRoZXIgdGhlIFNRTCBzaG91bGQgaW52YWxpZGF0ZSBzY2hlbWEgbWV0YWRhdGEuXG4gICAqL1xuICBfc2NoZW1hQ2FjaGVJbnZhbGlkYXRpbmdTcWwoc3FsKSB7XG4gICAgY29uc3QgZmlyc3QgPSB0aGlzLl9yZWFkU3FsVG9rZW4oc3FsLCAwLCBTQ0hFTUFfSU5WQUxJREFUSU9OX1NDQU5fTElNSVQpXG5cbiAgICBpZiAoZmlyc3QuaW5jb21wbGV0ZSkgcmV0dXJuIHRydWVcblxuICAgIGNvbnN0IGZpcnN0VG9rZW4gPSBmaXJzdC50b2tlblxuXG4gICAgaWYgKCFmaXJzdFRva2VuKSByZXR1cm4gZmFsc2VcbiAgICBpZiAoL14oY3JlYXRlfGFsdGVyfGRyb3B8cmVuYW1lKSQvLnRlc3QoZmlyc3RUb2tlbikpIHJldHVybiB0cnVlXG5cbiAgICBpZiAoZmlyc3RUb2tlbiA9PT0gXCJjb21tZW50XCIpIHtcbiAgICAgIGNvbnN0IG5leHQgPSB0aGlzLl9yZWFkU3FsVG9rZW4oc3FsLCBmaXJzdC5pbmRleCwgU0NIRU1BX0lOVkFMSURBVElPTl9TQ0FOX0xJTUlUKVxuXG4gICAgICByZXR1cm4gbmV4dC5pbmNvbXBsZXRlIHx8IG5leHQudG9rZW4gPT09IFwib25cIlxuICAgIH1cblxuICAgIGlmIChmaXJzdFRva2VuID09PSBcImV4ZWNcIiB8fCBmaXJzdFRva2VuID09PSBcImV4ZWN1dGVcIikge1xuICAgICAgY29uc3QgbmV4dCA9IHRoaXMuX3JlYWRTcWxUb2tlbihzcWwsIGZpcnN0LmluZGV4LCBTQ0hFTUFfSU5WQUxJREFUSU9OX1NDQU5fTElNSVQpXG5cbiAgICAgIHJldHVybiBuZXh0LmluY29tcGxldGUgfHwgbmV4dC50b2tlbiA9PT0gXCJzcF9yZW5hbWVcIlxuICAgIH1cblxuICAgIGlmIChmaXJzdFRva2VuID09PSBcImlmXCIpIHtcbiAgICAgIGxldCBpbmRleCA9IGZpcnN0LmluZGV4XG5cbiAgICAgIHdoaWxlICh0cnVlKSB7XG4gICAgICAgIGNvbnN0IHJlc3VsdCA9IHRoaXMuX3JlYWRTcWxUb2tlbihzcWwsIGluZGV4LCBTQ0hFTUFfSU5WQUxJREFUSU9OX1NDQU5fTElNSVQpXG5cbiAgICAgICAgaWYgKHJlc3VsdC5pbmNvbXBsZXRlKSByZXR1cm4gdHJ1ZVxuICAgICAgICBpZiAoIXJlc3VsdC50b2tlbikgcmV0dXJuIGZhbHNlXG4gICAgICAgIGlmIChyZXN1bHQudG9rZW4gPT09IFwiYmVnaW5cIikge1xuICAgICAgICAgIGNvbnN0IGRkbFJlc3VsdCA9IHRoaXMuX3JlYWRTcWxUb2tlbihzcWwsIHJlc3VsdC5pbmRleCwgU0NIRU1BX0lOVkFMSURBVElPTl9TQ0FOX0xJTUlUKVxuXG4gICAgICAgICAgcmV0dXJuIGRkbFJlc3VsdC5pbmNvbXBsZXRlIHx8IC9eKGNyZWF0ZXxhbHRlcnxkcm9wfHJlbmFtZSkkLy50ZXN0KGRkbFJlc3VsdC50b2tlbiB8fCBcIlwiKVxuICAgICAgICB9XG5cbiAgICAgICAgaW5kZXggPSByZXN1bHQuaW5kZXhcbiAgICAgIH1cbiAgICB9XG5cbiAgICByZXR1cm4gZmFsc2VcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHF1ZXJ5IGxvZ2dpbmcgZW5hYmxlZC5cbiAgICogQHJldHVybnMge2Jvb2xlYW59IC0gV2hldGhlciBxdWVyeSBsb2dnaW5nIGlzIGVuYWJsZWQgZm9yIHRoaXMgZHJpdmVyLlxuICAgKi9cbiAgX3F1ZXJ5TG9nZ2luZ0VuYWJsZWQoKSB7XG4gICAgaWYgKCF0aGlzLmNvbmZpZ3VyYXRpb24pIHJldHVybiB0cnVlXG4gICAgaWYgKCF0aGlzLmNvbmZpZ3VyYXRpb24uZ2V0UXVlcnlMb2dnaW5nRW5hYmxlZCgpKSByZXR1cm4gZmFsc2VcblxuICAgIGNvbnN0IGxvZ2dlciA9IG5ldyBMb2dnZXIoXCJTUUxcIiwge2NvbmZpZ3VyYXRpb246IHRoaXMuY29uZmlndXJhdGlvbn0pXG5cbiAgICByZXR1cm4gbG9nZ2VyLmlzTGV2ZWxFbmFibGVkKFwiaW5mb1wiKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgbG9nIHF1ZXJ5LlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIE9wdGlvbnMgb2JqZWN0LlxuICAgKiBAcGFyYW0ge251bWJlcn0gYXJncy5lbGFwc2VkTXMgLSBFbGFwc2VkIG1pbGxpc2Vjb25kcy5cbiAgICogQHBhcmFtIHtFcnJvcn0gW2FyZ3MuZXJyb3JdIC0gUXVlcnkgZmFpbHVyZSwgd2hlbiB0aGUgZHJpdmVyIGNhbGwgZmFpbGVkLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gYXJncy5sb2dOYW1lIC0gUXVlcnkgbG9nIHN1YmplY3QuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vLi4vaHR0cC1zZXJ2ZXIvY2xpZW50L3JlcXVlc3QtdGltaW5nLmpzXCIpLmRlZmF1bHQgfCB1bmRlZmluZWR9IGFyZ3MucmVxdWVzdFRpbWluZyAtIFJlcXVlc3QgdGltaW5nLlxuICAgKiBAcGFyYW0ge3N0cmluZyB8IHVuZGVmaW5lZH0gYXJncy5zb3VyY2VTdGFjayAtIFNvdXJjZSBzdGFjay5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGFyZ3Muc3FsIC0gU1FMIHN0cmluZy5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgd2hlbiBjb21wbGV0ZS5cbiAgICovXG4gIGFzeW5jIF9sb2dRdWVyeSh7ZWxhcHNlZE1zLCBlcnJvciwgbG9nTmFtZSwgcmVxdWVzdFRpbWluZywgc291cmNlU3RhY2ssIHNxbH0pIHtcbiAgICBjb25zdCBsb2dnZXIgPSBuZXcgTG9nZ2VyKGxvZ05hbWUsIHtjb25maWd1cmF0aW9uOiB0aGlzLmNvbmZpZ3VyYXRpb259KVxuICAgIGNvbnN0IHNvdXJjZUxpbmUgPSB0aGlzLl9xdWVyeVNvdXJjZUxpbmUoc291cmNlU3RhY2spXG4gICAgY29uc3Qgc2Vuc2l0aXZlVmFsdWVzID0gcmVxdWVzdFRpbWluZyA/IHJlcXVlc3RUaW1pbmcuZ2V0TG9nU2Vuc2l0aXZlVmFsdWVzKCkgOiBuZXcgU2V0KClcbiAgICBjb25zdCByZWRhY3RvciA9IHRoaXMuY29uZmlndXJhdGlvbi5nZXRMb2dSZWRhY3RvcigpXG4gICAgY29uc3QgbG9nZ2VkU3FsID0gcmVkYWN0b3IucmVkYWN0U3RyaW5nKHNxbCwgc2Vuc2l0aXZlVmFsdWVzKVxuICAgIGNvbnN0IGZhaWx1cmUgPSBlcnJvclxuICAgICAgPyBgIEZBSUxFRCAke2Vycm9yLm5hbWV9OiAke3JlZGFjdG9yLnJlZGFjdFN0cmluZyhlcnJvci5tZXNzYWdlLCBzZW5zaXRpdmVWYWx1ZXMpfWBcbiAgICAgIDogXCJcIlxuICAgIGNvbnN0IG1lc3NhZ2UgPSBzb3VyY2VMaW5lXG4gICAgICA/IGAoJHtmb3JtYXRFbGFwc2VkTXMoZWxhcHNlZE1zKX0pJHtmYWlsdXJlfSAgJHtsb2dnZWRTcWx9XFxuICDihrMgJHtzb3VyY2VMaW5lfWBcbiAgICAgIDogYCgke2Zvcm1hdEVsYXBzZWRNcyhlbGFwc2VkTXMpfSkke2ZhaWx1cmV9ICAke2xvZ2dlZFNxbH1gXG5cbiAgICBhd2FpdCBsb2dnZXIuaW5mbyhtZXNzYWdlKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgcXVlcnkgc291cmNlIGxpbmUuXG4gICAqIEBwYXJhbSB7c3RyaW5nIHwgdW5kZWZpbmVkfSBzb3VyY2VTdGFjayAtIFNvdXJjZSBzdGFjay5cbiAgICogQHJldHVybnMge3N0cmluZyB8IHVuZGVmaW5lZH0gLSBTb3VyY2UgbGluZSB3aGVuIGFuIGFwcGxpY2F0aW9uIGZyYW1lIGlzIGF2YWlsYWJsZS5cbiAgICovXG4gIF9xdWVyeVNvdXJjZUxpbmUoc291cmNlU3RhY2spIHtcbiAgICBpZiAoIXNvdXJjZVN0YWNrKSByZXR1cm4gdW5kZWZpbmVkXG5cbiAgICBjb25zdCBhcHBsaWNhdGlvbkRpcmVjdG9yeSA9IHRoaXMuY29uZmlndXJhdGlvblxuICAgICAgPyB0aGlzLmNvbmZpZ3VyYXRpb24uZ2V0RGlyZWN0b3J5SWZBdmFpbGFibGUoKVxuICAgICAgOiB1bmRlZmluZWRcblxuICAgIGlmICghYXBwbGljYXRpb25EaXJlY3RvcnkpIHJldHVybiB1bmRlZmluZWRcblxuICAgIGNvbnN0IGVycm9yID0gbmV3IEVycm9yKFwiUXVlcnkgc291cmNlXCIpXG5cbiAgICBlcnJvci5zdGFjayA9IHNvdXJjZVN0YWNrXG5cbiAgICByZXR1cm4gQmFja3RyYWNlQ2xlYW5lci5nZXRBcHBsaWNhdGlvblNvdXJjZUxpbmUoZXJyb3IsIHtcbiAgICAgIGFwcGxpY2F0aW9uRGlyZWN0b3J5LFxuICAgICAgZnJhbWV3b3JrU291cmNlRGlyZWN0b3J5OiB0aGlzLmNvbmZpZ3VyYXRpb24uZ2V0RW52aXJvbm1lbnRIYW5kbGVyKCkuZ2V0RnJhbWV3b3JrU291cmNlRGlyZWN0b3J5KClcbiAgICB9KVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgcXVlcnkgYWN0dWFsLlxuICAgKiBAYWJzdHJhY3RcbiAgICogQHBhcmFtIHtzdHJpbmd9IHNxbCAtIFNRTCBzdHJpbmcuXG4gICAqIEBwYXJhbSB7UXVlcnlPcHRpb25zfSBbb3B0aW9uc10gLSBRdWVyeSBvcHRpb25zIChjYXJyaWVzIHRoZSBvcHRpb25hbCBhYm9ydCBzaWduYWwpLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxRdWVyeVJlc3VsdFR5cGU+fSAtIFJlc29sdmVzIHdpdGggdGhlIHF1ZXJ5IGFjdHVhbC5cbiAgICovXG4gIF9xdWVyeUFjdHVhbChzcWwsIG9wdGlvbnMpIHsgLy8gZXNsaW50LWRpc2FibGUtbGluZSBuby11bnVzZWQtdmFyc1xuICAgIHRocm93IG5ldyBFcnJvcihgcXVlcnlBY3R1YWwgbm90IGltcGxlbWVudGVkYClcbiAgfVxuXG4gIC8qKlxuICAgKiBFeGVjdXRlcyBhIG11dGF0aW9uIGFuZCByZXR1cm5zIGl0cyBhZmZlY3RlZCByb3cgY291bnQuXG4gICAqIEBhYnN0cmFjdFxuICAgKiBAcGFyYW0ge3N0cmluZ30gc3FsIC0gTXV0YXRpb24gU1FMIHN0cmluZy5cbiAgICogQHJldHVybnMge1Byb21pc2U8bnVtYmVyPn0gLSBBZmZlY3RlZCByb3cgY291bnQuXG4gICAqL1xuICBfYWZmZWN0ZWRSb3dzQWN0dWFsKHNxbCkgeyAvLyBlc2xpbnQtZGlzYWJsZS1saW5lIG5vLXVudXNlZC12YXJzXG4gICAgdGhyb3cgbmV3IEVycm9yKGBhZmZlY3RlZFJvd3NBY3R1YWwgbm90IGltcGxlbWVudGVkYClcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHF1ZXJ5IHRvIHNxbC5cbiAgICogQGFic3RyYWN0XG4gICAqIEBwYXJhbSB7UXVlcnl9IF9xdWVyeSAtIFF1ZXJ5IGluc3RhbmNlLlxuICAgKiBAcmV0dXJucyB7c3RyaW5nfSAtIFNRTCBzdHJpbmcuXG4gICAqL1xuICBxdWVyeVRvU3FsKF9xdWVyeSkgeyB0aHJvdyBuZXcgRXJyb3IoXCJxdWVyeVRvU3FsIG5vdCBpbXBsZW1lbnRlZFwiKSB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgcmV0cnlhYmxlIGRhdGFiYXNlIGVycm9yLlxuICAgKiBAcGFyYW0ge0Vycm9yfSBfZXJyb3IgLSBFcnJvciBpbnN0YW5jZS5cbiAgICogQHJldHVybnMge1JldHJ5YWJsZURhdGFiYXNlRXJyb3JSZXN1bHR9IC0gUmV0cnkgaW5mby5cbiAgICovXG4gIHJldHJ5YWJsZURhdGFiYXNlRXJyb3IoX2Vycm9yKSB7XG4gICAgcmV0dXJuIHtyZXRyeTogZmFsc2UsIHJlY29ubmVjdDogZmFsc2V9XG4gIH1cblxuICAvKipcbiAgICogUnVucyBhc3NlcnQgd3JpdGFibGUgcXVlcnkuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBzcWwgLSBTUUwgc3RyaW5nLlxuICAgKiBAcmV0dXJucyB7dm9pZH0gLSBObyByZXR1cm4gdmFsdWUuXG4gICAqL1xuICBfYXNzZXJ0V3JpdGFibGVRdWVyeShzcWwpIHtcbiAgICBpZiAoIXRoaXMuaXNSZWFkT25seSgpKSByZXR1cm5cbiAgICBpZiAoIXRoaXMuX3NxbExvb2tzTGlrZVdyaXRlKHNxbCkpIHJldHVyblxuXG4gICAgdGhyb3cgbmV3IEVycm9yKFwiRGF0YWJhc2UgaXMgcmVhZC1vbmx5XCIpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBhc3NlcnQgbm90IHJlYWQgb25seS5cbiAgICogQHJldHVybnMge3ZvaWR9IC0gTm8gcmV0dXJuIHZhbHVlLlxuICAgKi9cbiAgX2Fzc2VydE5vdFJlYWRPbmx5KCkge1xuICAgIGlmICh0aGlzLmlzUmVhZE9ubHkoKSkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKFwiRGF0YWJhc2UgaXMgcmVhZC1vbmx5XCIpXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgc3FsIGxvb2tzIGxpa2Ugd3JpdGUuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBzcWwgLSBTUUwgc3RyaW5nLlxuICAgKiBAcmV0dXJucyB7Ym9vbGVhbn0gLSBTUUwgcmVwcmVzZW50YXRpb24uXG4gICAqL1xuICBfc3FsTG9va3NMaWtlV3JpdGUoc3FsKSB7XG4gICAgY29uc3Qgbm9ybWFsaXplZCA9IHNxbC50cmltKCkudG9Mb3dlckNhc2UoKVxuXG4gICAgaWYgKCFub3JtYWxpemVkKSByZXR1cm4gZmFsc2VcblxuICAgIGlmIChcbiAgICAgIG5vcm1hbGl6ZWQuc3RhcnRzV2l0aChcInNlbGVjdFwiKSB8fFxuICAgICAgbm9ybWFsaXplZC5zdGFydHNXaXRoKFwic2hvd1wiKSB8fFxuICAgICAgbm9ybWFsaXplZC5zdGFydHNXaXRoKFwicHJhZ21hXCIpIHx8XG4gICAgICBub3JtYWxpemVkLnN0YXJ0c1dpdGgoXCJleHBsYWluXCIpIHx8XG4gICAgICBub3JtYWxpemVkLnN0YXJ0c1dpdGgoXCJkZXNjcmliZVwiKVxuICAgICkge1xuICAgICAgcmV0dXJuIGZhbHNlXG4gICAgfVxuXG4gICAgaWYgKG5vcm1hbGl6ZWQuc3RhcnRzV2l0aChcIndpdGhcIikpIHtcbiAgICAgIGNvbnN0IHdpdGhNYXRjaCA9IG5vcm1hbGl6ZWQubWF0Y2goL15cXHMqd2l0aFtcXHNcXFNdKz9cXClcXHMqKHNlbGVjdHxpbnNlcnR8dXBkYXRlfGRlbGV0ZXxtZXJnZXxyZXBsYWNlKVxcYi8pXG5cbiAgICAgIGlmICh3aXRoTWF0Y2gpIHtcbiAgICAgICAgcmV0dXJuIHdpdGhNYXRjaFsxXSAhPT0gXCJzZWxlY3RcIlxuICAgICAgfVxuXG4gICAgICByZXR1cm4gZmFsc2VcbiAgICB9XG5cbiAgICBjb25zdCBrZXl3b3JkTWF0Y2ggPSBub3JtYWxpemVkLm1hdGNoKC9eXFxzKihcXHcrKS8pXG4gICAgY29uc3Qga2V5d29yZCA9IGtleXdvcmRNYXRjaCA/IGtleXdvcmRNYXRjaFsxXSA6IFwiXCJcblxuICAgIHJldHVybiBbXG4gICAgICBcImluc2VydFwiLFxuICAgICAgXCJ1cGRhdGVcIixcbiAgICAgIFwiZGVsZXRlXCIsXG4gICAgICBcImNyZWF0ZVwiLFxuICAgICAgXCJhbHRlclwiLFxuICAgICAgXCJkcm9wXCIsXG4gICAgICBcInRydW5jYXRlXCIsXG4gICAgICBcIm1lcmdlXCIsXG4gICAgICBcInJlcGxhY2VcIlxuICAgIF0uaW5jbHVkZXMoa2V5d29yZClcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGlzIHJlYWQgb25seS5cbiAgICogQHJldHVybnMge2Jvb2xlYW59IC0gV2hldGhlciByZWFkIG9ubHkuXG4gICAqL1xuICBpc1JlYWRPbmx5KCkge1xuICAgIHJldHVybiBCb29sZWFuKHRoaXMuZ2V0QXJncygpLnJlYWRPbmx5KVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgcm9sbGJhY2sgdHJhbnNhY3Rpb24uXG4gICAqIEBwYXJhbSB7UGljazxRdWVyeU9wdGlvbnMsIFwib3BlcmF0aW9uT3duZXJcIj59IFtvcHRpb25zXSAtIFRyYW5zYWN0aW9uIG93bmVyc2hpcC5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgd2hlbiBjb21wbGV0ZS5cbiAgICovXG4gIGFzeW5jIHJvbGxiYWNrVHJhbnNhY3Rpb24ob3B0aW9ucyA9IHt9KSB7XG4gICAgYXdhaXQgY29vcmRpbmF0ZVNoYXJlZFRyYW5zYWN0aW9uQ29ubmVjdGlvbih0aGlzLCBhc3luYyAoKSA9PiB7XG4gICAgICBhd2FpdCB0aGlzLl90cmFuc2FjdGlvbnNBY3Rpb25zTXV0ZXguc3luYyhhc3luYyAoKSA9PiB7XG4gICAgICAgIHRyeSB7XG4gICAgICAgICAgYXdhaXQgdGhpcy5fcnVuUHJvZmlsZWRUcmFuc2FjdGlvbkFjdGlvbihcInJvbGxiYWNrXCIsIGFzeW5jICgpID0+IHtcbiAgICAgICAgICAgIGF3YWl0IHRoaXMuX3JvbGxiYWNrVHJhbnNhY3Rpb25BY3Rpb24ob3B0aW9ucylcbiAgICAgICAgICB9KVxuICAgICAgICB9IGZpbmFsbHkge1xuICAgICAgICAgIC8vIERyaXZlciByZWNvdmVyeSBtYXkgbmVlZCB0byBjbGVhciBhIHN0YWxlIHBoeXNpY2FsIHRyYW5zYWN0aW9uIHdoZW5cbiAgICAgICAgICAvLyBubyBsb2dpY2FsIHRyYW5zYWN0aW9uIGlzIGFjdGl2ZS4gTmV2ZXIgbGV0IHRoYXQgY2xlYW51cCB1bmRlcmZsb3dcbiAgICAgICAgICAvLyB0aGUgbG9naWNhbCBkZXB0aCBhbmQgdHVybiB0aGUgbmV4dCByb290IHRyYW5zYWN0aW9uIGludG8gYSBzYXZlcG9pbnQuXG4gICAgICAgICAgaWYgKHRoaXMuX3RyYW5zYWN0aW9uc0NvdW50ID4gMCkgdGhpcy5fdHJhbnNhY3Rpb25zQ291bnQtLVxuICAgICAgICAgIHRoaXMuX3Jlc29sdmVDb21wbGV0ZWRUcmFuc2FjdGlvbigpXG5cbiAgICAgICAgICAvLyBBIHJvbGxlZC1iYWNrIHRyYW5zYWN0aW9uIG1heSBoYXZlIHJldmVydGVkIERETCAoZS5nLiBhIENSRUFURSBUQUJMRVxuICAgICAgICAgIC8vIHJ1biBsYXppbHkgaW5zaWRlIHRoZSB0cmFuc2FjdGlvbiksIHNvIGFueSBjYWNoZWQgc2NoZW1hIG1ldGFkYXRhIGlzXG4gICAgICAgICAgLy8gbm93IHN0YWxlIGFuZCBtdXN0IGJlIGludmFsaWRhdGVkLiBXaXRob3V0IHRoaXMsIGEgbGF0ZXIgdGFibGVFeGlzdHMoKVxuICAgICAgICAgIC8vIGNoZWNrIGNhbiByZXBvcnQgYSB0YWJsZSB0aGF0IHRoZSByb2xsYmFjayBhbHJlYWR5IHJlbW92ZWQsIHNvIGNhbGxlcnNcbiAgICAgICAgICAvLyBza2lwIHJlY3JlYXRpbmcgaXQgYW5kIHRoZW4gZmFpbCB3aXRoIFwibm8gc3VjaCB0YWJsZVwiLlxuICAgICAgICAgIHRoaXMuY2xlYXJTY2hlbWFDYWNoZSgpXG4gICAgICAgIH1cbiAgICAgIH0pXG4gICAgfSwgb3B0aW9ucy5vcGVyYXRpb25Pd25lcilcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHJvbGxiYWNrIHRyYW5zYWN0aW9uIGFjdGlvbi5cbiAgICogQHBhcmFtIHtQaWNrPFF1ZXJ5T3B0aW9ucywgXCJvcGVyYXRpb25Pd25lclwiPn0gW29wdGlvbnNdIC0gVHJhbnNhY3Rpb24gb3duZXJzaGlwLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyB3aGVuIGNvbXBsZXRlLlxuICAgKi9cbiAgYXN5bmMgX3JvbGxiYWNrVHJhbnNhY3Rpb25BY3Rpb24ob3B0aW9ucyA9IHt9KSB7XG4gICAgYXdhaXQgdGhpcy5xdWVyeShcIlJPTExCQUNLXCIsIG9wdGlvbnMpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBnZW5lcmF0ZSBzYXZlIHBvaW50IG5hbWUuXG4gICAqIEByZXR1cm5zIHtzdHJpbmd9IC0gVGhlIGdlbmVyYXRlIHNhdmUgcG9pbnQgbmFtZS5cbiAgICovXG4gIGdlbmVyYXRlU2F2ZVBvaW50TmFtZSgpIHtcbiAgICByZXR1cm4gYHNwJHtuZXcgVVVJRCg0KS5mb3JtYXQoKS5yZXBsYWNlQWxsKFwiLVwiLCBcIlwiKX1gXG4gIH1cblxuICAvKipcbiAgICogUnVucyBzdGFydCBzYXZlIHBvaW50LlxuICAgKiBAcGFyYW0ge3N0cmluZ30gc2F2ZVBvaW50TmFtZSAtIFNhdmUgcG9pbnQgbmFtZS5cbiAgICogQHBhcmFtIHtQaWNrPFF1ZXJ5T3B0aW9ucywgXCJvcGVyYXRpb25Pd25lclwiPn0gW29wdGlvbnNdIC0gVHJhbnNhY3Rpb24gb3duZXJzaGlwLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyB3aGVuIGNvbXBsZXRlLlxuICAgKi9cbiAgYXN5bmMgc3RhcnRTYXZlUG9pbnQoc2F2ZVBvaW50TmFtZSwgb3B0aW9ucyA9IHt9KSB7XG4gICAgYXdhaXQgY29vcmRpbmF0ZVNoYXJlZFRyYW5zYWN0aW9uQ29ubmVjdGlvbih0aGlzLCBhc3luYyAoKSA9PiB7XG4gICAgICBhd2FpdCB0aGlzLl90cmFuc2FjdGlvbnNBY3Rpb25zTXV0ZXguc3luYyhhc3luYyAoKSA9PiB7XG4gICAgICAgIGF3YWl0IHRoaXMuX3N0YXJ0U2F2ZVBvaW50QWN0aW9uKHNhdmVQb2ludE5hbWUsIG9wdGlvbnMpXG4gICAgICB9KVxuICAgIH0sIG9wdGlvbnMub3BlcmF0aW9uT3duZXIpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBzdGFydCBzYXZlIHBvaW50IGFjdGlvbi5cbiAgICogQHBhcmFtIHtzdHJpbmd9IHNhdmVQb2ludE5hbWUgLSBTYXZlIHBvaW50IG5hbWUuXG4gICAqIEBwYXJhbSB7UGljazxRdWVyeU9wdGlvbnMsIFwib3BlcmF0aW9uT3duZXJcIj59IFtvcHRpb25zXSAtIFRyYW5zYWN0aW9uIG93bmVyc2hpcC5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgd2hlbiBjb21wbGV0ZS5cbiAgICovXG4gIGFzeW5jIF9zdGFydFNhdmVQb2ludEFjdGlvbihzYXZlUG9pbnROYW1lLCBvcHRpb25zID0ge30pIHtcbiAgICBhd2FpdCB0aGlzLnF1ZXJ5KGBTQVZFUE9JTlQgJHtzYXZlUG9pbnROYW1lfWAsIG9wdGlvbnMpXG4gIH1cblxuICAvKipcbiAgICogUnVucyByZW5hbWUgY29sdW1uLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gdGFibGVOYW1lIC0gVGFibGUgbmFtZS5cbiAgICogQHBhcmFtIHtzdHJpbmd9IG9sZENvbHVtbk5hbWUgLSBQcmV2aW91cyBjb2x1bW4gbmFtZS5cbiAgICogQHBhcmFtIHtzdHJpbmd9IG5ld0NvbHVtbk5hbWUgLSBOZXcgY29sdW1uIG5hbWUuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIHdoZW4gY29tcGxldGUuXG4gICAqL1xuICBhc3luYyByZW5hbWVDb2x1bW4odGFibGVOYW1lLCBvbGRDb2x1bW5OYW1lLCBuZXdDb2x1bW5OYW1lKSB7XG4gICAgdGhpcy5fYXNzZXJ0Tm90UmVhZE9ubHkoKVxuICAgIGNvbnN0IHRhYmxlQ29sdW1uID0gbmV3IFRhYmxlQ29sdW1uKG9sZENvbHVtbk5hbWUpXG5cbiAgICB0YWJsZUNvbHVtbi5zZXROZXdOYW1lKG5ld0NvbHVtbk5hbWUpXG5cbiAgICBjb25zdCB0YWJsZURhdGEgPSBuZXcgVGFibGVEYXRhKHRhYmxlTmFtZSlcblxuICAgIHRhYmxlRGF0YS5hZGRDb2x1bW4odGFibGVDb2x1bW4pXG5cbiAgICBjb25zdCBhbHRlclRhYmxlU1FMcyA9IGF3YWl0IHRoaXMuYWx0ZXJUYWJsZVNRTHModGFibGVEYXRhKVxuXG4gICAgZm9yIChjb25zdCBhbHRlclRhYmxlU1FMIG9mIGFsdGVyVGFibGVTUUxzKSB7XG4gICAgICBhd2FpdCB0aGlzLnF1ZXJ5KGFsdGVyVGFibGVTUUwpXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgcmVsZWFzZSBzYXZlIHBvaW50LlxuICAgKiBAcGFyYW0ge3N0cmluZ30gc2F2ZVBvaW50TmFtZSAtIFNhdmUgcG9pbnQgbmFtZS5cbiAgICogQHBhcmFtIHtQaWNrPFF1ZXJ5T3B0aW9ucywgXCJvcGVyYXRpb25Pd25lclwiPn0gW29wdGlvbnNdIC0gVHJhbnNhY3Rpb24gb3duZXJzaGlwLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyB3aGVuIGNvbXBsZXRlLlxuICAgKi9cbiAgYXN5bmMgcmVsZWFzZVNhdmVQb2ludChzYXZlUG9pbnROYW1lLCBvcHRpb25zID0ge30pIHtcbiAgICBhd2FpdCBjb29yZGluYXRlU2hhcmVkVHJhbnNhY3Rpb25Db25uZWN0aW9uKHRoaXMsIGFzeW5jICgpID0+IHtcbiAgICAgIGF3YWl0IHRoaXMuX3RyYW5zYWN0aW9uc0FjdGlvbnNNdXRleC5zeW5jKGFzeW5jICgpID0+IHtcbiAgICAgICAgYXdhaXQgdGhpcy5fcmVsZWFzZVNhdmVQb2ludEFjdGlvbihzYXZlUG9pbnROYW1lLCBvcHRpb25zKVxuICAgICAgfSlcbiAgICB9LCBvcHRpb25zLm9wZXJhdGlvbk93bmVyKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgcmVsZWFzZSBzYXZlIHBvaW50IGFjdGlvbi5cbiAgICogQHBhcmFtIHtzdHJpbmd9IHNhdmVQb2ludE5hbWUgLSBTYXZlIHBvaW50IG5hbWUuXG4gICAqIEBwYXJhbSB7UGljazxRdWVyeU9wdGlvbnMsIFwib3BlcmF0aW9uT3duZXJcIj59IFtvcHRpb25zXSAtIFRyYW5zYWN0aW9uIG93bmVyc2hpcC5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgd2hlbiBjb21wbGV0ZS5cbiAgICovXG4gIGFzeW5jIF9yZWxlYXNlU2F2ZVBvaW50QWN0aW9uKHNhdmVQb2ludE5hbWUsIG9wdGlvbnMgPSB7fSkge1xuICAgIHRyeSB7XG4gICAgICBhd2FpdCB0aGlzLnF1ZXJ5KGBSRUxFQVNFIFNBVkVQT0lOVCAke3NhdmVQb2ludE5hbWV9YCwgb3B0aW9ucylcbiAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgY29uc3QgbWVzc2FnZSA9IGVycm9yIGluc3RhbmNlb2YgRXJyb3IgPyBlcnJvci5tZXNzYWdlIDogYCR7ZXJyb3J9YFxuXG4gICAgICAvLyBTYXZlcG9pbnQgbWF5IGFscmVhZHkgYmUgZ29uZSBpZiB0aGUgZGF0YWJhc2Ugcm9sbGVkIGJhY2sgYXV0b21hdGljYWxseVxuICAgICAgaWYgKG1lc3NhZ2UudG9Mb3dlckNhc2UoKS5pbmNsdWRlcyhcInNhdmVwb2ludFwiKSAmJiBtZXNzYWdlLnRvTG93ZXJDYXNlKCkuaW5jbHVkZXMoXCJkb2VzIG5vdCBleGlzdFwiKSkge1xuICAgICAgICB0aGlzLmxvZ2dlci5kZWJ1ZyhgUmVsZWFzZSBzYXZlcG9pbnQgaWdub3JlZCBiZWNhdXNlIGl0IG5vIGxvbmdlciBleGlzdHM6ICR7c2F2ZVBvaW50TmFtZX1gKVxuICAgICAgICByZXR1cm5cbiAgICAgIH1cblxuICAgICAgdGhyb3cgZXJyb3JcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogUnVucyByb2xsYmFjayBzYXZlIHBvaW50LlxuICAgKiBAcGFyYW0ge3N0cmluZ30gc2F2ZVBvaW50TmFtZSAtIFNhdmUgcG9pbnQgbmFtZS5cbiAgICogQHBhcmFtIHtQaWNrPFF1ZXJ5T3B0aW9ucywgXCJvcGVyYXRpb25Pd25lclwiPn0gW29wdGlvbnNdIC0gVHJhbnNhY3Rpb24gb3duZXJzaGlwLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyB3aGVuIGNvbXBsZXRlLlxuICAgKi9cbiAgYXN5bmMgcm9sbGJhY2tTYXZlUG9pbnQoc2F2ZVBvaW50TmFtZSwgb3B0aW9ucyA9IHt9KSB7XG4gICAgYXdhaXQgY29vcmRpbmF0ZVNoYXJlZFRyYW5zYWN0aW9uQ29ubmVjdGlvbih0aGlzLCBhc3luYyAoKSA9PiB7XG4gICAgICBhd2FpdCB0aGlzLl90cmFuc2FjdGlvbnNBY3Rpb25zTXV0ZXguc3luYyhhc3luYyAoKSA9PiB7XG4gICAgICAgIGF3YWl0IHRoaXMuX3JvbGxiYWNrU2F2ZVBvaW50QWN0aW9uKHNhdmVQb2ludE5hbWUsIG9wdGlvbnMpXG4gICAgICB9KVxuICAgIH0sIG9wdGlvbnMub3BlcmF0aW9uT3duZXIpXG4gIH1cblxuICAvKipcbiAgICogUnVucyByb2xsYmFjayBzYXZlIHBvaW50IGFjdGlvbi5cbiAgICogQHBhcmFtIHtzdHJpbmd9IHNhdmVQb2ludE5hbWUgLSBTYXZlIHBvaW50IG5hbWUuXG4gICAqIEBwYXJhbSB7UGljazxRdWVyeU9wdGlvbnMsIFwib3BlcmF0aW9uT3duZXJcIj59IFtvcHRpb25zXSAtIFRyYW5zYWN0aW9uIG93bmVyc2hpcC5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgd2hlbiBjb21wbGV0ZS5cbiAgICovXG4gIGFzeW5jIF9yb2xsYmFja1NhdmVQb2ludEFjdGlvbihzYXZlUG9pbnROYW1lLCBvcHRpb25zID0ge30pIHtcbiAgICBhd2FpdCB0aGlzLnF1ZXJ5KGBST0xMQkFDSyBUTyBTQVZFUE9JTlQgJHtzYXZlUG9pbnROYW1lfWAsIG9wdGlvbnMpXG4gIH1cblxuICAvKipcbiAgICogVHJ1bmNhdGVzIHRoZSBnaXZlbiB0YWJsZSBzbmFwc2hvdC4gRHJpdmVycyBjYW4gb3ZlcnJpZGUgdGhpcyB0byBpc3N1ZSBvbmUgYmF0Y2guXG4gICAqIEBwcm90ZWN0ZWRcbiAgICogQHBhcmFtIHtBcnJheTxpbXBvcnQoXCIuL2Jhc2UtdGFibGUuanNcIikuZGVmYXVsdD59IHRhYmxlcyAtIEVsaWdpYmxlIHRhYmxlcyBmb3IgdGhpcyBjbGVhbnVwIGF0dGVtcHQuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIHdoZW4gZXZlcnkgdGFibGUgaGFzIGJlZW4gY2xlYW5lZC5cbiAgICovXG4gIGFzeW5jIHRydW5jYXRlVGFibGVzKHRhYmxlcykge1xuICAgIGNvbnN0IHRydW5jYXRlRXJyb3JzID0gW11cblxuICAgIGZvciAoY29uc3QgdGFibGUgb2YgdGFibGVzKSB7XG4gICAgICB0cnkge1xuICAgICAgICBhd2FpdCB0YWJsZS50cnVuY2F0ZSh7Y2FzY2FkZTogdHJ1ZX0pXG4gICAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgICB0cnVuY2F0ZUVycm9ycy5wdXNoKGVycm9yKVxuICAgICAgfVxuICAgIH1cblxuICAgIGlmICh0cnVuY2F0ZUVycm9ycy5sZW5ndGggPiAwKSB0aHJvdyB0cnVuY2F0ZUVycm9yc1swXVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgdHJ1bmNhdGUgYWxsIHRhYmxlcy5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgd2hlbiBjb21wbGV0ZS5cbiAgICovXG4gIGFzeW5jIHRydW5jYXRlQWxsVGFibGVzKCkge1xuICAgIHRoaXMuX2Fzc2VydE5vdFJlYWRPbmx5KClcbiAgICBjb25zdCB0YWJsZXMgPSAoYXdhaXQgdGhpcy5nZXRUYWJsZXMoKSkuZmlsdGVyKCh0YWJsZSkgPT4gdGFibGUuZ2V0TmFtZSgpICE9IFwic2NoZW1hX21pZ3JhdGlvbnNcIilcblxuICAgIGlmICh0YWJsZXMubGVuZ3RoID09IDApIHJldHVyblxuXG4gICAgYXdhaXQgdGhpcy5fdHJ1bmNhdGVBbGxUYWJsZXModGFibGVzKVxuICAgIGF3YWl0IHRoaXMuZmx1c2hQZW5kaW5nV3JpdGVzKClcbiAgfVxuXG4gIC8qKlxuICAgKiBPd25zIHRoZSBmb3JlaWduLWtleSBib3VuZGFyeSBhcm91bmQgZXZlcnkgY2xlYW51cCByZXRyeS4gRHJpdmVycyB0aGF0XG4gICAqIHJlcXVpcmUgb25lIHBoeXNpY2FsIHJlcXVlc3QgZm9yIHRoZSBmdWxsIG9wZXJhdGlvbiBtYXkgb3ZlcnJpZGUgaXQuXG4gICAqIEBwcm90ZWN0ZWRcbiAgICogQHBhcmFtIHtBcnJheTxpbXBvcnQoXCIuL2Jhc2UtdGFibGUuanNcIikuZGVmYXVsdD59IHRhYmxlcyAtIEVsaWdpYmxlIHRhYmxlcy5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgYWZ0ZXIgY2xlYW51cCBzdWNjZWVkcy5cbiAgICovXG4gIGFzeW5jIF90cnVuY2F0ZUFsbFRhYmxlcyh0YWJsZXMpIHtcbiAgICBhd2FpdCB0aGlzLndpdGhEaXNhYmxlZEZvcmVpZ25LZXlzKGFzeW5jICgpID0+IHtcbiAgICAgIGF3YWl0IHRoaXMuX3RydW5jYXRlQWxsVGFibGVzV2l0aFJldHJpZXModGFibGVzKVxuICAgIH0pXG4gIH1cblxuICAvKipcbiAgICogUmV0cmllcyBjbGVhbnVwIGFnYWluc3QgcmVmcmVzaGVkIHNjaGVtYSBzbmFwc2hvdHMuIERyaXZlcnMgbWF5IG92ZXJyaWRlXG4gICAqIGBfdHJ1bmNhdGVBbGxUYWJsZXNBdHRlbXB0YCB0byBvd24gYSBjb21wbGV0ZSBkcml2ZXItc3BlY2lmaWMgYXR0ZW1wdC5cbiAgICogQHByb3RlY3RlZFxuICAgKiBAcGFyYW0ge0FycmF5PGltcG9ydChcIi4vYmFzZS10YWJsZS5qc1wiKS5kZWZhdWx0Pn0gaW5pdGlhbFRhYmxlcyAtIEluaXRpYWwgZWxpZ2libGUgdGFibGVzLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyBhZnRlciBvbmUgY2xlYW51cCBhdHRlbXB0IHN1Y2NlZWRzLlxuICAgKi9cbiAgYXN5bmMgX3RydW5jYXRlQWxsVGFibGVzV2l0aFJldHJpZXMoaW5pdGlhbFRhYmxlcykge1xuICAgIGxldCB0YWJsZXMgPSBpbml0aWFsVGFibGVzXG5cbiAgICBmb3IgKGxldCB0cmllcyA9IDE7IHRyaWVzIDw9IDY7IHRyaWVzKyspIHtcbiAgICAgIHRyeSB7XG4gICAgICAgIGF3YWl0IHRoaXMuX3RydW5jYXRlQWxsVGFibGVzQXR0ZW1wdCh0YWJsZXMpXG4gICAgICAgIHJldHVyblxuICAgICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgICAgY29uc29sZS5lcnJvcihlcnJvcilcblxuICAgICAgICBpZiAodHJpZXMgPT0gNikgdGhyb3cgZXJyb3JcblxuICAgICAgICAvLyBBIHRydW5jYXRlIGZhaWxlZCDigJQgdGhlIHNjaGVtYSBjYWNoZSBtYXkgc3RpbGwgbGlzdCBhIHRhYmxlIHRoYXQgd2FzXG4gICAgICAgIC8vIGRyb3BwZWQgb3V0IGZyb20gdW5kZXIgdXMgKGUuZy4gYSBkYjpyb2xsYmFjayB0ZXN0IHRoYXQgbGVmdCB0aGVcbiAgICAgICAgLy8gc2hhcmVkIERCIHJvbGxlZCBiYWNrKS4gQ2xlYXIgaXQgc28gdGhlIG5leHQgcGFzcyByZS1yZWFkcyB0aGUgbGl2ZVxuICAgICAgICAvLyB0YWJsZSBsaXN0IGFuZCBubyBsb25nZXIgdHJpZXMgdG8gdHJ1bmNhdGUgYSB0YWJsZSB0aGF0IGlzIGdvbmUuXG4gICAgICAgIHRoaXMuY2xlYXJTY2hlbWFDYWNoZSgpXG4gICAgICAgIHRhYmxlcyA9IChhd2FpdCB0aGlzLmdldFRhYmxlcygpKS5maWx0ZXIoKHRhYmxlKSA9PiB0YWJsZS5nZXROYW1lKCkgIT0gXCJzY2hlbWFfbWlncmF0aW9uc1wiKVxuXG4gICAgICAgIGlmICh0YWJsZXMubGVuZ3RoID09IDApIHJldHVyblxuICAgICAgfVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIG9uZSBjbGVhbnVwIGF0dGVtcHQgd2hpbGUgdGhlIGRlZmF1bHQgb3duZXIgaGFzIGNvbnN0cmFpbnRzIGRpc2FibGVkLlxuICAgKiBAcHJvdGVjdGVkXG4gICAqIEBwYXJhbSB7QXJyYXk8aW1wb3J0KFwiLi9iYXNlLXRhYmxlLmpzXCIpLmRlZmF1bHQ+fSB0YWJsZXMgLSBDdXJyZW50IGVsaWdpYmxlIHRhYmxlcy5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgd2hlbiB0aGUgYXR0ZW1wdCBjb21wbGV0ZXMuXG4gICAqL1xuICBhc3luYyBfdHJ1bmNhdGVBbGxUYWJsZXNBdHRlbXB0KHRhYmxlcykge1xuICAgIGF3YWl0IHRoaXMudHJ1bmNhdGVUYWJsZXModGFibGVzKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgdXBkYXRlLlxuICAgKiBAcGFyYW0ge1VwZGF0ZVNxbEFyZ3NUeXBlfSBhcmdzIC0gT3B0aW9ucyBvYmplY3QuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIHdoZW4gY29tcGxldGUuXG4gICAqL1xuICBhc3luYyB1cGRhdGUoYXJncykge1xuICAgIHRoaXMuX2Fzc2VydE5vdFJlYWRPbmx5KClcbiAgICBjb25zdCBzcWwgPSB0aGlzLnVwZGF0ZVNxbChhcmdzKVxuXG4gICAgYXdhaXQgdGhpcy5xdWVyeShzcWwpXG4gIH1cblxuICAvKipcbiAgICogUnVucyB1cGRhdGUgc3FsLlxuICAgKiBAYWJzdHJhY3RcbiAgICogQHBhcmFtIHtVcGRhdGVTcWxBcmdzVHlwZX0gYXJncyAtIE9wdGlvbnMgb2JqZWN0LlxuICAgKiBAcmV0dXJucyB7c3RyaW5nfSAtIFNRTCBzdHJpbmcuXG4gICAqL1xuICB1cGRhdGVTcWwoYXJncykgeyAvLyBlc2xpbnQtZGlzYWJsZS1saW5lIG5vLXVudXNlZC12YXJzXG4gICAgdGhyb3cgbmV3IEVycm9yKFwiJ2Rpc2FibGVGb3JlaWduS2V5cycgbm90IGltcGxlbWVudGVkXCIpXG4gIH1cblxuICAvKipcbiAgICogUnVucyB1cHNlcnQgc3FsLlxuICAgKiBAYWJzdHJhY3RcbiAgICogQHBhcmFtIHtVcHNlcnRTcWxBcmdzVHlwZX0gYXJncyAtIE9wdGlvbnMgb2JqZWN0LlxuICAgKiBAcmV0dXJucyB7c3RyaW5nfSAtIFNRTCBzdHJpbmcuXG4gICAqL1xuICB1cHNlcnRTcWwoYXJncykgeyAvLyBlc2xpbnQtZGlzYWJsZS1saW5lIG5vLXVudXNlZC12YXJzXG4gICAgdGhyb3cgbmV3IEVycm9yKFwiJ3Vwc2VydFNxbCcgbm90IGltcGxlbWVudGVkXCIpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBkaXNhYmxlIGZvcmVpZ24ga2V5cy5cbiAgICogQGFic3RyYWN0XG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIHdoZW4gY29tcGxldGUuXG4gICAqL1xuICBkaXNhYmxlRm9yZWlnbktleXMoKSB7XG4gICAgdGhyb3cgbmV3IEVycm9yKFwiJ2Rpc2FibGVGb3JlaWduS2V5cycgbm90IGltcGxlbWVudGVkXCIpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBlbmFibGUgZm9yZWlnbiBrZXlzLlxuICAgKiBAYWJzdHJhY3RcbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgd2hlbiBjb21wbGV0ZS5cbiAgICovXG4gIGVuYWJsZUZvcmVpZ25LZXlzKCkge1xuICAgIHRocm93IG5ldyBFcnJvcihcIidlbmFibGVGb3JlaWduS2V5cycgbm90IGltcGxlbWVudGVkXCIpXG4gIH1cblxuICAvKipcbiAgICogUnVucyB3aXRoIGRpc2FibGVkIGZvcmVpZ24ga2V5cy5cbiAgICogQHBhcmFtIHsoKSA9PiB2b2lkfSBjYWxsYmFjayAtIENhbGxiYWNrIGZ1bmN0aW9uLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59IC0gUmVzb2x2ZXMgd2l0aCB0aGUgd2l0aCBkaXNhYmxlZCBmb3JlaWduIGtleXMuXG4gICAqL1xuICBhc3luYyB3aXRoRGlzYWJsZWRGb3JlaWduS2V5cyhjYWxsYmFjaykge1xuICAgIGF3YWl0IHRoaXMuZGlzYWJsZUZvcmVpZ25LZXlzKClcblxuICAgIHRyeSB7XG4gICAgICByZXR1cm4gYXdhaXQgY2FsbGJhY2soKVxuICAgIH0gZmluYWxseSB7XG4gICAgICBhd2FpdCB0aGlzLmVuYWJsZUZvcmVpZ25LZXlzKClcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogQmxvY2tzIHVudGlsIGEgbmFtZWQgYWR2aXNvcnkgbG9jayBpcyBhY3F1aXJlZCBvbiB0aGlzIGNvbm5lY3Rpb24uXG4gICAqIEFkdmlzb3J5IGxvY2tzIGFyZSBjb25uZWN0aW9uLXNjb3BlZCBhbmQgZG8gbm90IGludGVyYWN0IHdpdGggcm93IG9yXG4gICAqIHRhYmxlIGxvY2tzOyB0aGV5IGFyZSBwdXJlbHkgY29vcGVyYXRpdmUgYmV0d2VlbiBjYWxsZXJzIHRoYXQgdXNlIHRoZVxuICAgKiBzYW1lIG5hbWUgYW5kIGxldCB5b3Ugc2VyaWFsaXplIGZ1bmN0aW9uYWxpdHkgd2l0aG91dCBibG9ja2luZyByZWFkZXJzXG4gICAqIG9yIHdyaXRlcnMgdGhhdCBkbyBub3QgcGFydGljaXBhdGUgaW4gdGhlIHNhbWUgbG9jay5cbiAgICogQHBhcmFtIHtzdHJpbmd9IG5hbWUgLSBMb2NrIG5hbWUuXG4gICAqIEBwYXJhbSB7e3RpbWVvdXRNcz86IG51bWJlciB8IG51bGx9fSBbYXJnc10gLSBPcHRpb25hbCB0aW1lb3V0IGluIG1pbGxpc2Vjb25kczsgYG51bGxgIGJsb2NrcyBmb3JldmVyLCBhbmQgYW4gb21pdHRlZCB2YWx1ZSB1c2VzIHRoZSBkYXRhYmFzZSdzIGBhZHZpc29yeUxvY2tBY3F1aXJlVGltZW91dE1zYCBvciB0aGUgZnJhbWV3b3JrIGRlZmF1bHQuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPGJvb2xlYW4+fSAtIFJlc29sdmVzIHRvIHRydWUgd2hlbiB0aGUgbG9jayBoYXMgYmVlbiBhY3F1aXJlZCwgZmFsc2UgaWYgdGhlIHRpbWVvdXQgZWxhcHNlZC5cbiAgICovXG4gIGFzeW5jIGFjcXVpcmVBZHZpc29yeUxvY2sobmFtZSwgYXJncyA9IHt9KSB7XG4gICAgY29uc3QgdGltZW91dE1zID0gdGhpcy5hZHZpc29yeUxvY2tBY3F1aXJlVGltZW91dE1zKGFyZ3MpXG4gICAgY29uc3Qgc3RhcnRlZEF0ID0gRGF0ZS5ub3coKVxuICAgIGNvbnN0IGFjcXVpcmVkID0gYXdhaXQgdGhpcy5fYWNxdWlyZUFkdmlzb3J5TG9jayhuYW1lLCB7dGltZW91dE1zfSlcbiAgICBjb25zdCBkdXJhdGlvbk1zID0gRGF0ZS5ub3coKSAtIHN0YXJ0ZWRBdFxuXG4gICAgaWYgKGFjcXVpcmVkKSB7XG4gICAgICB0aGlzLl90cmFja0Fkdmlzb3J5TG9jayhuYW1lKVxuXG4gICAgICBjb25zdCBzbG93QWNxdWlyZU1zID0gYWR2aXNvcnlMb2NrVGVsZW1ldHJ5VGhyZXNob2xkcyh0aGlzLmdldEFyZ3MoKSkuc2xvd0FjcXVpcmVNc1xuXG4gICAgICBpZiAoc2xvd0FjcXVpcmVNcyAhPT0gbnVsbCAmJiBkdXJhdGlvbk1zID4gc2xvd0FjcXVpcmVNcykge1xuICAgICAgICBhd2FpdCB0aGlzLl9yZXBvcnRBZHZpc29yeUxvY2tUZWxlbWV0cnkoe2V2ZW50OiBcImFkdmlzb3J5LWxvY2stc2xvdy1hY3F1aXJlXCIsIGxvY2tOYW1lOiBuYW1lLCBkdXJhdGlvbk1zLCBvdXRjb21lOiBcImFjcXVpcmVkXCIsIHRpbWVvdXRNc30pXG4gICAgICB9XG4gICAgfSBlbHNlIHtcbiAgICAgIC8vIFRoZSB3YWl0IGV4Y2VlZGVkIGl0cyBib3VuZDogYXR0cmlidXRlIHRoZSBsb2NrIHRvIHRoZSBob2xkZXIgdGhhdFxuICAgICAgLy8gYmxvY2tlZCBpdCwgY2FwdHVyZWQgYXQgdGhpcyBtb21lbnQgb24gdGhpcyB0aWVyLlxuICAgICAgYXdhaXQgdGhpcy5fcmVwb3J0QWR2aXNvcnlMb2NrVGVsZW1ldHJ5KHtldmVudDogXCJhZHZpc29yeS1sb2NrLWFjcXVpcmUtdGltZW91dFwiLCBsb2NrTmFtZTogbmFtZSwgZHVyYXRpb25Ncywgb3V0Y29tZTogXCJ0aW1lb3V0XCIsIHRpbWVvdXRNcywgY2FwdHVyZUhvbGRlcjogdHJ1ZX0pXG4gICAgfVxuXG4gICAgcmV0dXJuIGFjcXVpcmVkXG4gIH1cblxuICAvKipcbiAgICogUmVzb2x2ZXMgdGhlIHdhaXQgYm91bmQgZm9yIG9uZSBhZHZpc29yeS1sb2NrIGFjcXVpc2l0aW9uLlxuICAgKiBBbiBleHBsaWNpdCBgdGltZW91dE1zYCDigJQgaW5jbHVkaW5nIGFuIGV4cGxpY2l0IGBudWxsYCBvcHQtb3V0IOKAlCBhbHdheXNcbiAgICogd2lucy4gT3RoZXJ3aXNlIHRoZSBkYXRhYmFzZSBjb25maWd1cmF0aW9uJ3MgYGFkdmlzb3J5TG9ja0FjcXVpcmVUaW1lb3V0TXNgXG4gICAqIGFwcGxpZXMsIGFuZCBhIG51bGwgdGhlcmUgb3B0cyBvdXQgdG9vLiBPbmx5IHdoZW4gbmVpdGhlciBpcyBjb25maWd1cmVkIGRvZXNcbiAgICogdGhlIGZyYW1ld29yayBkZWZhdWx0IGJvdW5kIHRoZSB3YWl0LlxuICAgKiBAcGFyYW0ge3t0aW1lb3V0TXM/OiBudW1iZXIgfCBudWxsfX0gW2FyZ3NdIC0gQWNxdWlzaXRpb24gb3B0aW9ucyBmcm9tIHRoZSBjYWxsZXIuXG4gICAqIEByZXR1cm5zIHtudW1iZXIgfCBudWxsfSAtIFdhaXQgYm91bmQgaW4gbWlsbGlzZWNvbmRzLCBvciBgbnVsbGAgZm9yIGFuIGluZGVmaW5pdGUgd2FpdC5cbiAgICovXG4gIGFkdmlzb3J5TG9ja0FjcXVpcmVUaW1lb3V0TXMoYXJncyA9IHt9KSB7XG4gICAgaWYgKGFyZ3MudGltZW91dE1zICE9PSB1bmRlZmluZWQpIHJldHVybiBhcmdzLnRpbWVvdXRNc1xuXG4gICAgY29uc3QgY29uZmlndXJlZCA9IHRoaXMuZ2V0QXJncygpPy5hZHZpc29yeUxvY2tBY3F1aXJlVGltZW91dE1zXG5cbiAgICBpZiAoY29uZmlndXJlZCA9PT0gbnVsbCkgcmV0dXJuIG51bGxcbiAgICBpZiAodHlwZW9mIGNvbmZpZ3VyZWQgPT09IFwibnVtYmVyXCIgJiYgY29uZmlndXJlZCA+PSAwKSByZXR1cm4gY29uZmlndXJlZFxuXG4gICAgcmV0dXJuIERFRkFVTFRfQURWSVNPUllfTE9DS19BQ1FVSVJFX1RJTUVPVVRfTVNcbiAgfVxuXG4gIC8qKlxuICAgKiBEcml2ZXItc3BlY2lmaWMgYmxvY2tpbmcgYWR2aXNvcnktbG9jayBhY3F1aXNpdGlvbiBob29rLlxuICAgKiBAYWJzdHJhY3RcbiAgICogQHBhcmFtIHtzdHJpbmd9IG5hbWUgLSBMb2NrIG5hbWUuXG4gICAqIEBwYXJhbSB7e3RpbWVvdXRNcz86IG51bWJlciB8IG51bGx9fSBbX2FyZ3NdIC0gTG9jayB0aW1lb3V0IG9wdGlvbnMuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPGJvb2xlYW4+fSAtIFdoZXRoZXIgdGhlIGxvY2sgd2FzIGFjcXVpcmVkLlxuICAgKi9cbiAgX2FjcXVpcmVBZHZpc29yeUxvY2sobmFtZSwgX2FyZ3MgPSB7fSkge1xuICAgIHRocm93IG5ldyBFcnJvcihgJ19hY3F1aXJlQWR2aXNvcnlMb2NrJyBub3QgaW1wbGVtZW50ZWQgZm9yICR7dGhpcy5jb25zdHJ1Y3Rvci5uYW1lfWApXG4gIH1cblxuICAvKipcbiAgICogQXR0ZW1wdHMgdG8gYWNxdWlyZSBhIG5hbWVkIGFkdmlzb3J5IGxvY2sgd2l0aG91dCBibG9ja2luZy5cbiAgICogQHBhcmFtIHtzdHJpbmd9IG5hbWUgLSBMb2NrIG5hbWUuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPGJvb2xlYW4+fSAtIFJlc29sdmVzIHRvIHRydWUgaWYgdGhlIGxvY2sgd2FzIGFjcXVpcmVkLCBmYWxzZSBpZiBpdCB3YXMgYWxyZWFkeSBoZWxkLlxuICAgKi9cbiAgYXN5bmMgdHJ5QWNxdWlyZUFkdmlzb3J5TG9jayhuYW1lKSB7XG4gICAgY29uc3QgYWNxdWlyZWQgPSBhd2FpdCB0aGlzLl90cnlBY3F1aXJlQWR2aXNvcnlMb2NrKG5hbWUpXG5cbiAgICBpZiAoYWNxdWlyZWQpIHRoaXMuX3RyYWNrQWR2aXNvcnlMb2NrKG5hbWUpXG5cbiAgICByZXR1cm4gYWNxdWlyZWRcbiAgfVxuXG4gIC8qKlxuICAgKiBEcml2ZXItc3BlY2lmaWMgbm9uLWJsb2NraW5nIGFkdmlzb3J5LWxvY2sgYWNxdWlzaXRpb24gaG9vay5cbiAgICogQGFic3RyYWN0XG4gICAqIEBwYXJhbSB7c3RyaW5nfSBuYW1lIC0gTG9jayBuYW1lLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxib29sZWFuPn0gLSBXaGV0aGVyIHRoZSBsb2NrIHdhcyBhY3F1aXJlZC5cbiAgICovXG4gIF90cnlBY3F1aXJlQWR2aXNvcnlMb2NrKG5hbWUpIHsgLy8gZXNsaW50LWRpc2FibGUtbGluZSBuby11bnVzZWQtdmFyc1xuICAgIHRocm93IG5ldyBFcnJvcihgJ190cnlBY3F1aXJlQWR2aXNvcnlMb2NrJyBub3QgaW1wbGVtZW50ZWQgZm9yICR7dGhpcy5jb25zdHJ1Y3Rvci5uYW1lfWApXG4gIH1cblxuICAvKipcbiAgICogUmVsZWFzZXMgYSBuYW1lZCBhZHZpc29yeSBsb2NrIHByZXZpb3VzbHkgYWNxdWlyZWQgb24gdGhpcyBjb25uZWN0aW9uLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gbmFtZSAtIExvY2sgbmFtZS5cbiAgICogQHJldHVybnMge1Byb21pc2U8Ym9vbGVhbj59IC0gUmVzb2x2ZXMgdG8gdHJ1ZSBpZiB0aGUgbG9jayB3YXMgaGVsZCBieSB0aGlzIHNlc3Npb24gYW5kIGhhcyBub3cgYmVlbiByZWxlYXNlZC5cbiAgICovXG4gIGFzeW5jIHJlbGVhc2VBZHZpc29yeUxvY2sobmFtZSkge1xuICAgIGNvbnN0IHJlbGVhc2VkID0gYXdhaXQgdGhpcy5fcmVsZWFzZUFkdmlzb3J5TG9jayhuYW1lKVxuXG4gICAgaWYgKHJlbGVhc2VkKSB7XG4gICAgICB0aGlzLl91bnRyYWNrQWR2aXNvcnlMb2NrKG5hbWUpXG4gICAgfSBlbHNlIHtcbiAgICAgIHRoaXMuX2hlbGRBZHZpc29yeUxvY2tzLmRlbGV0ZShuYW1lKVxuICAgIH1cblxuICAgIGlmICghdGhpcy5faGVsZEFkdmlzb3J5TG9ja3MuaGFzKG5hbWUpKSB7XG4gICAgICBjb25zdCBhY3F1aXJlZEF0ID0gdGhpcy5fYWR2aXNvcnlMb2NrQWNxdWlyZWRBdEJ5TmFtZS5nZXQobmFtZSlcblxuICAgICAgdGhpcy5fYWR2aXNvcnlMb2NrQWNxdWlyZWRBdEJ5TmFtZS5kZWxldGUobmFtZSlcblxuICAgICAgaWYgKGFjcXVpcmVkQXQgIT09IHVuZGVmaW5lZCkge1xuICAgICAgICBjb25zdCBob2xkRHVyYXRpb25NcyA9IERhdGUubm93KCkgLSBhY3F1aXJlZEF0XG4gICAgICAgIGNvbnN0IHNsb3dIb2xkTXMgPSBhZHZpc29yeUxvY2tUZWxlbWV0cnlUaHJlc2hvbGRzKHRoaXMuZ2V0QXJncygpKS5zbG93SG9sZE1zXG5cbiAgICAgICAgaWYgKHNsb3dIb2xkTXMgIT09IG51bGwgJiYgaG9sZER1cmF0aW9uTXMgPiBzbG93SG9sZE1zKSB7XG4gICAgICAgICAgYXdhaXQgdGhpcy5fcmVwb3J0QWR2aXNvcnlMb2NrVGVsZW1ldHJ5KHtldmVudDogXCJhZHZpc29yeS1sb2NrLXNsb3ctaG9sZFwiLCBsb2NrTmFtZTogbmFtZSwgZHVyYXRpb25NczogaG9sZER1cmF0aW9uTXMsIG91dGNvbWU6IG51bGwsIHRpbWVvdXRNczogbnVsbH0pXG4gICAgICAgIH1cbiAgICAgIH1cbiAgICB9XG5cbiAgICByZXR1cm4gcmVsZWFzZWRcbiAgfVxuXG4gIC8qKlxuICAgKiBEcml2ZXItc3BlY2lmaWMgYWR2aXNvcnktbG9jayByZWxlYXNlIGhvb2suXG4gICAqIEBhYnN0cmFjdFxuICAgKiBAcGFyYW0ge3N0cmluZ30gbmFtZSAtIExvY2sgbmFtZS5cbiAgICogQHJldHVybnMge1Byb21pc2U8Ym9vbGVhbj59IC0gV2hldGhlciB0aGUgbG9jayB3YXMgcmVsZWFzZWQuXG4gICAqL1xuICBfcmVsZWFzZUFkdmlzb3J5TG9jayhuYW1lKSB7IC8vIGVzbGludC1kaXNhYmxlLWxpbmUgbm8tdW51c2VkLXZhcnNcbiAgICB0aHJvdyBuZXcgRXJyb3IoYCdfcmVsZWFzZUFkdmlzb3J5TG9jaycgbm90IGltcGxlbWVudGVkIGZvciAke3RoaXMuY29uc3RydWN0b3IubmFtZX1gKVxuICB9XG5cbiAgLyoqXG4gICAqIFJlbGVhc2VzIGV2ZXJ5IGFkdmlzb3J5IGxvY2sgc3RpbGwgdHJhY2tlZCBvbiB0aGlzIGNvbm5lY3Rpb24uXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIHdoZW4gZXZlcnkgdHJhY2tlZCBsb2NrIGlzIHJlbGVhc2VkLlxuICAgKi9cbiAgYXN5bmMgcmVsZWFzZUhlbGRBZHZpc29yeUxvY2tzKCkge1xuICAgIC8qKiBAdHlwZSB7RXJyb3JbXX0gKi9cbiAgICBjb25zdCBlcnJvcnMgPSBbXVxuXG4gICAgZm9yIChjb25zdCBuYW1lIG9mIFsuLi50aGlzLl9oZWxkQWR2aXNvcnlMb2Nrcy5rZXlzKCldKSB7XG4gICAgICB3aGlsZSAodGhpcy5faGVsZEFkdmlzb3J5TG9ja3MuaGFzKG5hbWUpKSB7XG4gICAgICAgIHRyeSB7XG4gICAgICAgICAgYXdhaXQgdGhpcy5yZWxlYXNlQWR2aXNvcnlMb2NrKG5hbWUpXG4gICAgICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICAgICAgZXJyb3JzLnB1c2goZXJyb3IgaW5zdGFuY2VvZiBFcnJvciA/IGVycm9yIDogbmV3IEVycm9yKGBGYWlsZWQgdG8gcmVsZWFzZSBhZHZpc29yeSBsb2NrICR7SlNPTi5zdHJpbmdpZnkobmFtZSl9YCwge2NhdXNlOiBlcnJvcn0pKVxuICAgICAgICAgIGJyZWFrXG4gICAgICAgIH1cbiAgICAgIH1cbiAgICB9XG5cbiAgICBpZiAoZXJyb3JzLmxlbmd0aCA9PSAxKSB0aHJvdyBlcnJvcnNbMF1cbiAgICBpZiAoZXJyb3JzLmxlbmd0aCA+IDEpIHRocm93IG5ldyBBZ2dyZWdhdGVFcnJvcihlcnJvcnMsIFwiRmFpbGVkIHRvIHJlbGVhc2UgaGVsZCBhZHZpc29yeSBsb2Nrc1wiKVxuICB9XG5cbiAgLyoqXG4gICAqIFJlY29yZHMgb25lIHN1Y2Nlc3NmdWwgYWNxdWlzaXRpb24sIGluY2x1ZGluZyByZS1lbnRyYW50IGFjcXVpc2l0aW9ucy5cbiAgICogQHBhcmFtIHtzdHJpbmd9IG5hbWUgLSBMb2NrIG5hbWUuXG4gICAqIEByZXR1cm5zIHt2b2lkfVxuICAgKi9cbiAgX3RyYWNrQWR2aXNvcnlMb2NrKG5hbWUpIHtcbiAgICB0aGlzLl9oZWxkQWR2aXNvcnlMb2Nrcy5zZXQobmFtZSwgKHRoaXMuX2hlbGRBZHZpc29yeUxvY2tzLmdldChuYW1lKSB8fCAwKSArIDEpXG5cbiAgICBpZiAoIXRoaXMuX2Fkdmlzb3J5TG9ja0FjcXVpcmVkQXRCeU5hbWUuaGFzKG5hbWUpKSB0aGlzLl9hZHZpc29yeUxvY2tBY3F1aXJlZEF0QnlOYW1lLnNldChuYW1lLCBEYXRlLm5vdygpKVxuICB9XG5cbiAgLyoqXG4gICAqIFJlbW92ZXMgb25lIHN1Y2Nlc3NmdWwgYWNxdWlzaXRpb24gZnJvbSB0aGUgY29ubmVjdGlvbiByZWdpc3RyeS5cbiAgICogQHBhcmFtIHtzdHJpbmd9IG5hbWUgLSBMb2NrIG5hbWUuXG4gICAqIEByZXR1cm5zIHt2b2lkfVxuICAgKi9cbiAgX3VudHJhY2tBZHZpc29yeUxvY2sobmFtZSkge1xuICAgIGNvbnN0IHJlbWFpbmluZ0NvdW50ID0gKHRoaXMuX2hlbGRBZHZpc29yeUxvY2tzLmdldChuYW1lKSB8fCAwKSAtIDFcblxuICAgIGlmIChyZW1haW5pbmdDb3VudCA+IDApIHtcbiAgICAgIHRoaXMuX2hlbGRBZHZpc29yeUxvY2tzLnNldChuYW1lLCByZW1haW5pbmdDb3VudClcbiAgICB9IGVsc2Uge1xuICAgICAgdGhpcy5faGVsZEFkdmlzb3J5TG9ja3MuZGVsZXRlKG5hbWUpXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIENoZWNrcyB3aGV0aGVyIGEgbmFtZWQgYWR2aXNvcnkgbG9jayBpcyBjdXJyZW50bHkgaGVsZCBieSBhbnkgc2Vzc2lvbi5cbiAgICogSW50ZW5kZWQgYXMgYW4gaW50cm9zcGVjdGlvbiBoZWxwZXI7IGNhbGxlcnMgd2hvIG5lZWQgdG8gYWN0IG9uIHRoZVxuICAgKiByZXN1bHQgc2hvdWxkIHByZWZlciBgdHJ5QWNxdWlyZUFkdmlzb3J5TG9ja2AgdG8gYXZvaWQgYSBUT0NUT1UgcmFjZS5cbiAgICogQGFic3RyYWN0XG4gICAqIEBwYXJhbSB7c3RyaW5nfSBuYW1lIC0gTG9jayBuYW1lLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxib29sZWFuPn0gLSBSZXNvbHZlcyB0byB0cnVlIGlmIHRoZSBsb2NrIGlzIGhlbGQgYnkgPyBzZXNzaW9uLlxuICAgKi9cbiAgaXNBZHZpc29yeUxvY2tIZWxkKG5hbWUpIHsgLy8gZXNsaW50LWRpc2FibGUtbGluZSBuby11bnVzZWQtdmFyc1xuICAgIHRocm93IG5ldyBFcnJvcihgJ2lzQWR2aXNvcnlMb2NrSGVsZCcgbm90IGltcGxlbWVudGVkIGZvciAke3RoaXMuY29uc3RydWN0b3IubmFtZX1gKVxuICB9XG5cbiAgLyoqXG4gICAqIFdoaWNoIGFkdmlzb3J5LWxvY2sgYmFja2VuZCB0aWVyIHRoaXMgY29ubmVjdGlvbiBzZXJ2ZXMgKFNUQy0yMTAgY2hhaW5cbiAgICogbmFtaW5nKS4gVGhlIGJhc2UgZHJpdmVyIGlzIHRoZSBkcml2ZXItbmF0aXZlIHRpZXI7IHRoZSBTUUxpdGUgZHJpdmVyc1xuICAgKiBvdmVycmlkZSB0byBgcHJvY2Vzcy1sb2NhbGAgLyBgZmlsZWAuXG4gICAqIEByZXR1cm5zIHtzdHJpbmd9IC0gVGllciBuYW1lIHJlcG9ydGVkIG9uIHRlbGVtZXRyeSBwYXlsb2Fkcy5cbiAgICovXG4gIGFkdmlzb3J5TG9ja0JhY2tlbmRUaWVyKCkge1xuICAgIHJldHVybiBcImRyaXZlci1uYXRpdmVcIlxuICB9XG5cbiAgLyoqXG4gICAqIFN0YWJsZSBpZGVudGl0eSBvZiB0aGlzIGNvbm5lY3Rpb24gYXMgYSBsb2NrIGhvbGRlciwgcmVwb3J0ZWQgb25cbiAgICogdGVsZW1ldHJ5IHBheWxvYWRzIHNvIGEgc2xvdyBhY3F1aXJlL2hvbGQgaXMgYXR0cmlidXRhYmxlIHRvIHRoZSByZXBvcnRpbmdcbiAgICogY29ubmVjdGlvbiBpdHNlbGYuXG4gICAqIEByZXR1cm5zIHtzdHJpbmd9IC0gSG9sZGVyIGlkLlxuICAgKi9cbiAgYWR2aXNvcnlMb2NrSG9sZGVySWQoKSB7XG4gICAgaWYgKCF0aGlzLl9hZHZpc29yeUxvY2tIb2xkZXJJZCkgdGhpcy5fYWR2aXNvcnlMb2NrSG9sZGVySWQgPSBgYWR2aXNvcnktbG9jay1ob2xkZXI6JHtuZXcgVVVJRCg0KS5mb3JtYXQoKX1gXG5cbiAgICByZXR1cm4gdGhpcy5fYWR2aXNvcnlMb2NrSG9sZGVySWRcbiAgfVxuXG4gIC8qKlxuICAgKiBCZXN0LWVmZm9ydCBpZGVudGl0eSBvZiB0aGUgY29ubmVjdGlvbiBjdXJyZW50bHkgaG9sZGluZyB0aGUgbmFtZWQgbG9jayxcbiAgICogY2FwdHVyZWQgb24gdGhlIHRpZXIgdGhhdCBzZXJ2ZWQgdGhlIGFjcXVpc2l0aW9uLiBUaGUgYmFzZSBkcml2ZXIgaGFzIG5vXG4gICAqIHBvcnRhYmxlIHNlcnZlci1zaWRlIGxvb2t1cDsgTXlTUUwvUG9zdGdyZVNRTC9TUUwgU2VydmVyL05vZGUtU1FMaXRlXG4gICAqIG92ZXJyaWRlIHdpdGggdGhlaXIgdGllcidzIGhvbGRlciBhdHRyaWJ1dGlvbi5cbiAgICogQHBhcmFtIHtzdHJpbmd9IG5hbWUgLSBMb2NrIG5hbWUuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHN0cmluZyB8IG51bGw+fSAtIEhvbGRlciBjb25uZWN0aW9uIGlkZW50aXR5LCBvciBudWxsIHdoZW4gdGhlIHRpZXIgY2Fubm90IGF0dHJpYnV0ZSBpdC5cbiAgICovXG4gIGFzeW5jIGFkdmlzb3J5TG9ja0hvbGRlckNvbm5lY3Rpb25JZChuYW1lKSB7IC8vIGVzbGludC1kaXNhYmxlLWxpbmUgbm8tdW51c2VkLXZhcnNcbiAgICByZXR1cm4gbnVsbFxuICB9XG5cbiAgLyoqXG4gICAqIEVtaXQgb25lIGV2ZW50LWRyaXZlbiBhZHZpc29yeS1sb2NrIHRlbGVtZXRyeSByZXBvcnQgKHNsb3cgYWNxdWlyZSxcbiAgICogYWNxdWlyZSB0aW1lb3V0IHdpdGggaG9sZGVyIGF0dHJpYnV0aW9uLCBzbG93IGhvbGQpLiBUaGUgaG9sZGVyIGxvb2t1cCBpc1xuICAgKiBiZXN0LWVmZm9ydDogYSBmYWlsZWQgbG9va3VwIGlzIHJlY29yZGVkIG9uIHRoZSByZXBvcnQgYW5kIG5ldmVyIGFmZmVjdHNcbiAgICogdGhlIGFjcXVpc2l0aW9uIHRoYXQgYWxyZWFkeSBzZXR0bGVkLlxuICAgKiBAcGFyYW0ge3tldmVudDogXCJhZHZpc29yeS1sb2NrLXNsb3ctYWNxdWlyZVwiIHwgXCJhZHZpc29yeS1sb2NrLWFjcXVpcmUtdGltZW91dFwiIHwgXCJhZHZpc29yeS1sb2NrLXNsb3ctaG9sZFwiLCBsb2NrTmFtZTogc3RyaW5nLCBkdXJhdGlvbk1zOiBudW1iZXIsIG91dGNvbWU6IFwiYWNxdWlyZWRcIiB8IFwidGltZW91dFwiIHwgbnVsbCwgdGltZW91dE1zOiBudW1iZXIgfCBudWxsLCBjYXB0dXJlSG9sZGVyPzogYm9vbGVhbn19IGFyZ3MgLSBSZXBvcnQgYXJncy5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgYWZ0ZXIgdGhlIHJlcG9ydCBpcyBlbWl0dGVkLlxuICAgKi9cbiAgYXN5bmMgX3JlcG9ydEFkdmlzb3J5TG9ja1RlbGVtZXRyeShhcmdzKSB7XG4gICAgLyoqIEB0eXBlIHtpbXBvcnQoXCIuLi9hZHZpc29yeS1sb2NrLXRlbGVtZXRyeS5qc1wiKS5BZHZpc29yeUxvY2tUZWxlbWV0cnlSZXBvcnR9ICovXG4gICAgY29uc3QgcmVwb3J0ID0ge1xuICAgICAgZXZlbnQ6IGFyZ3MuZXZlbnQsXG4gICAgICBsb2NrTmFtZTogYXJncy5sb2NrTmFtZSxcbiAgICAgIGJhY2tlbmRUaWVyOiB0aGlzLmFkdmlzb3J5TG9ja0JhY2tlbmRUaWVyKCksXG4gICAgICBkdXJhdGlvbk1zOiBhcmdzLmR1cmF0aW9uTXMsXG4gICAgICBvdXRjb21lOiBhcmdzLm91dGNvbWUsXG4gICAgICB0aW1lb3V0TXM6IGFyZ3MudGltZW91dE1zLFxuICAgICAgaG9sZGVySWQ6IHRoaXMuYWR2aXNvcnlMb2NrSG9sZGVySWQoKSxcbiAgICAgIGhvbGRlckNvbm5lY3Rpb25JZDogbnVsbCxcbiAgICAgIGhvbGRlckxvb2t1cEVycm9yOiBudWxsXG4gICAgfVxuXG4gICAgaWYgKGFyZ3MuY2FwdHVyZUhvbGRlcikge1xuICAgICAgdHJ5IHtcbiAgICAgICAgcmVwb3J0LmhvbGRlckNvbm5lY3Rpb25JZCA9IGF3YWl0IHRoaXMuYWR2aXNvcnlMb2NrSG9sZGVyQ29ubmVjdGlvbklkKGFyZ3MubG9ja05hbWUpXG4gICAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgICByZXBvcnQuaG9sZGVyTG9va3VwRXJyb3IgPSBlcnJvciBpbnN0YW5jZW9mIEVycm9yID8gZXJyb3IubWVzc2FnZSA6IFN0cmluZyhlcnJvcilcbiAgICAgIH1cbiAgICB9XG5cbiAgICBlbWl0QWR2aXNvcnlMb2NrVGVsZW1ldHJ5UmVwb3J0KHRoaXMuY29uZmlndXJhdGlvbiwgcmVwb3J0KVxuICB9XG59XG4iXX0=