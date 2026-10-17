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
     * Process-wide state for the **process-local advisory-lock pre-filter
     * tier** shared by every driver (SQLite, MySQL/MariaDB, PostgreSQL,
     * MSSQL). It serializes concurrent acquisitions of the same lock name
     * inside this process through a FIFO waiter queue before any caller
     * contacts the driver-native tier, so a contended same-process waiter
     * never parks a pooled database connection in a driver lock state
     * (MariaDB `User lock`, `sp_getapplock` session hold, ...).
     *
     * This tier is a pre-filter, **never the authority**: a grant here only
     * means "you are next in this process." Cross-process/cross-host
     * exclusion is confirmed by the driver-native tier (or, once the
     * STC-210 backend chain lands, the configured cross-host backend)
     * before the acquisition succeeds.
     *
     * `ownersByName` maps each held lock name to the driver instance that
     * acquired it so `releaseAdvisoryLock` can reject releases from drivers
     * that do not own the lock.
     * @type {{ownersByName: Map<string, VelociousDatabaseDriversBase>, waitersByName: Map<string, Array<() => void>>}}
     */
    static _advisoryLockState = {
        ownersByName: new Map(),
        waitersByName: new Map()
    };
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
     * or writers that do not participate in the same named lock.
     *
     * Acquisition runs as a two-tier chain:
     * 1. The **process-local pre-filter tier** (this class' FIFO waiter
     *    queue) serializes same-process callers for the lock name without
     *    issuing any driver-native lock query and without parking a
     *    connection in a driver lock state. A queued caller never reaches
     *    tier 2 until the in-process holder releases.
     * 2. The **driver-native tier** (`_acquireAdvisoryLock`: MariaDB
     *    `GET_LOCK`, PostgreSQL `pg_advisory_lock`, SQL Server
     *    `sp_getapplock`, SQLite filesystem lock on Node) confirms the
     *    cross-process/cross-host exclusion.
     *
     * The process-local tier is a pre-filter, **never the authority**: a
     * lock name that other processes or hosts can request is only granted
     * after the driver-native tier (or, once the STC-210 backend chain
     * lands, the configured cross-host backend) confirms it. If the native
     * tier denies or times out, the in-process hold is rolled back.
     * @param {string} name - Lock name.
     * @param {{timeoutMs?: number | null}} [args] - Optional timeout in milliseconds; `null` blocks forever, and an omitted value uses the database's `advisoryLockAcquireTimeoutMs` or the framework default. The bound covers the whole two-tier acquisition.
     * @returns {Promise<boolean>} - Resolves to true when the lock has been acquired, false if the timeout elapsed.
     */
    async acquireAdvisoryLock(name, args = {}) {
        const timeoutMs = this.advisoryLockAcquireTimeoutMs(args);
        const deadlineMs = typeof timeoutMs === "number" && timeoutMs >= 0 ? Date.now() + timeoutMs : null;
        const localAcquisition = await this._acquireProcessLocalAdvisoryLock(name, { timeoutMs });
        if (!localAcquisition.acquired)
            return false;
        if (!this.supportsDriverNativeAdvisoryLock()) {
            // No driver-native tier exists for this driver (plain SQLite): the
            // process-local tier is the whole implementation, and callers must
            // not read it as a cross-process guarantee.
            this._trackAdvisoryLock(name);
            return true;
        }
        // Only a caller that actually queued in the process-local tier spends
        // part of the acquire budget; an uncontended acquisition passes the
        // full bound on to the driver-native tier.
        const nativeTimeoutMs = localAcquisition.waited && deadlineMs !== null
            ? Math.max(0, deadlineMs - Date.now())
            : timeoutMs;
        const startedAt = Date.now();
        /** @type {boolean} */
        let nativeAcquired;
        try {
            nativeAcquired = await this._acquireAdvisoryLock(name, { timeoutMs: nativeTimeoutMs });
        }
        catch (error) {
            this._releaseProcessLocalAdvisoryLock(name);
            throw error;
        }
        const durationMs = Date.now() - startedAt;
        if (nativeAcquired) {
            this._trackAdvisoryLock(name);
            const slowAcquireMs = advisoryLockTelemetryThresholds(this.getArgs()).slowAcquireMs;
            if (slowAcquireMs !== null && durationMs > slowAcquireMs) {
                await this._reportAdvisoryLockTelemetry({ event: "advisory-lock-slow-acquire", lockName: name, durationMs, outcome: "acquired", timeoutMs });
            }
            return true;
        }
        this._releaseProcessLocalAdvisoryLock(name);
        // The wait exceeded its bound: attribute the lock to the holder that
        // blocked it, captured at this moment on this tier.
        await this._reportAdvisoryLockTelemetry({ event: "advisory-lock-acquire-timeout", lockName: name, durationMs, outcome: "timeout", timeoutMs, captureHolder: true });
        return false;
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
     * Whether this driver has a driver-native advisory-lock tier behind the
     * process-local pre-filter. MariaDB (`GET_LOCK`), PostgreSQL
     * (`pg_advisory_lock`) and SQL Server (`sp_getapplock`) do; SQLite has
     * no native primitive (the Node SQLite driver substitutes its
     * filesystem lock directory, the web/native builds have nothing), so
     * for plain SQLite the process-local tier IS the whole implementation
     * and callers must not read it as a cross-process guarantee.
     * @returns {boolean} - Whether the driver-native tier exists.
     */
    supportsDriverNativeAdvisoryLock() {
        return true;
    }
    /**
     * Whether the driver's native tier is re-entrant within the same
     * session. `GET_LOCK`, `pg_advisory_lock` and `sp_getapplock` grant the
     * same session repeatedly, so the process-local tier must let a
     * re-acquisition by its own owner pass through to the native tier.
     * SQLite's emulation (including the Node filesystem lock) is not
     * re-entrant, so the tier keeps treating a re-acquisition as contention
     * exactly as the SQLite emulation always has.
     * @returns {boolean} - Whether same-instance re-acquisition is honored.
     */
    supportsReentrantAdvisoryLock() {
        return true;
    }
    /**
     * Process-local pre-filter tier: FIFO waiter queue for one lock name
     * inside this process. This is the promoted SQLite emulation from
     * STC-211 — it now runs in front of **every** driver's native tier so a
     * same-process waiter never issues a driver-native lock query and never
     * parks a pooled connection in a driver lock state while queued.
     *
     * A grant here means only "you are the next caller in this process."
     * It is never the authority for cross-process/cross-host exclusion; the
     * caller must still pass the driver-native tier before the lock counts
     * as held. A re-entrant acquisition by the owning driver instance is
     * granted immediately, mirroring the session-scoped re-entrancy of
     * `GET_LOCK` / `pg_advisory_lock` / `sp_getapplock`.
     * @param {string} name - Lock name.
     * @param {{timeoutMs?: number | null}} [args] - Optional timeout in milliseconds; `null`, `undefined`, or negative blocks forever.
     * @returns {Promise<{acquired: boolean, waited: boolean}>} - Whether the tier granted this caller, and whether it had to queue for it.
     */
    async _acquireProcessLocalAdvisoryLock(name, { timeoutMs } = {}) {
        const state = VelociousDatabaseDriversBase._advisoryLockState;
        let waited = false;
        while (state.ownersByName.has(name)) {
            if (state.ownersByName.get(name) === this && this.supportsReentrantAdvisoryLock())
                break;
            waited = true;
            let remainingMs = null;
            if (typeof timeoutMs === "number" && timeoutMs >= 0) {
                remainingMs = timeoutMs;
                if (remainingMs <= 0)
                    return { acquired: false, waited };
            }
            await new Promise((resolve) => {
                const waiters = state.waitersByName.get(name) || [];
                /**
                 * Timeout handle.
                 * @type {ReturnType<typeof setTimeout> | null} */
                let timeoutHandle = null;
                /**
                 * Remove and resolve.
                 * @type {(() => void) | null} */
                let removeAndResolve = null;
                removeAndResolve = () => {
                    if (timeoutHandle)
                        clearTimeout(timeoutHandle);
                    const current = state.waitersByName.get(name) || [];
                    const index = current.indexOf(/** @type {() => void} */ (removeAndResolve));
                    if (index >= 0)
                        current.splice(index, 1);
                    if (current.length === 0)
                        state.waitersByName.delete(name);
                    resolve(undefined);
                };
                waiters.push(removeAndResolve);
                state.waitersByName.set(name, waiters);
                if (remainingMs !== null) {
                    timeoutHandle = setTimeout(() => {
                        if (removeAndResolve)
                            removeAndResolve();
                    }, remainingMs);
                }
            });
            if (typeof timeoutMs === "number" && timeoutMs >= 0 && state.ownersByName.has(name) && !(state.ownersByName.get(name) === this && this.supportsReentrantAdvisoryLock())) {
                return { acquired: false, waited };
            }
        }
        state.ownersByName.set(name, this);
        return { acquired: true, waited };
    }
    /**
     * Hands the process-local tier for one lock name to the next FIFO waiter,
     * but only when **this** driver instance currently owns it. A release by
     * a non-owner is a no-op, matching the "you can only release locks you
     * own" contract of `RELEASE_LOCK` / `pg_advisory_unlock`.
     * @param {string} name - Lock name.
     * @returns {boolean} - Whether this instance owned the tier and released it.
     */
    _releaseProcessLocalAdvisoryLock(name) {
        const state = VelociousDatabaseDriversBase._advisoryLockState;
        const owner = state.ownersByName.get(name);
        if (owner !== this)
            return false;
        state.ownersByName.delete(name);
        const waiters = state.waitersByName.get(name);
        if (waiters && waiters.length > 0) {
            const nextWaiter = waiters.shift();
            if (waiters.length === 0)
                state.waitersByName.delete(name);
            if (nextWaiter)
                nextWaiter();
        }
        return true;
    }
    /**
     * Driver-specific blocking advisory-lock acquisition hook.
     * This is the **driver-native tier** of the acquisition chain: MariaDB
     * `GET_LOCK`, PostgreSQL `pg_advisory_lock`, SQL Server `sp_getapplock`,
     * the Node SQLite filesystem lock. It runs only after the process-local
     * pre-filter tier has granted this caller its turn, and its result is
     * what actually confirms cross-process/cross-host exclusion.
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
     *
     * Same two-tier chain as `acquireAdvisoryLock`: the process-local tier
     * short-circuits contention between callers in this process (a queued
     * name never reaches the driver-native hook), and the driver-native tier
     * confirms cross-process/cross-host exclusion. A free in-process tier is
     * NOT a grant — the native tier still has to agree.
     * @param {string} name - Lock name.
     * @returns {Promise<boolean>} - Resolves to true if the lock was acquired, false if it was already held.
     */
    async tryAcquireAdvisoryLock(name) {
        const owner = VelociousDatabaseDriversBase._advisoryLockState.ownersByName.get(name);
        if (owner !== undefined && owner !== this)
            return false;
        // Same-instance re-acquisition mirrors the re-entrant semantics of the
        // session-scoped driver-native locks; a non-re-entrant driver (SQLite)
        // keeps treating it as contention, exactly as the emulation always did.
        const reentrant = owner === this;
        if (reentrant && !this.supportsReentrantAdvisoryLock())
            return false;
        if (!reentrant)
            VelociousDatabaseDriversBase._advisoryLockState.ownersByName.set(name, this);
        if (!this.supportsDriverNativeAdvisoryLock()) {
            this._trackAdvisoryLock(name);
            return true;
        }
        /** @type {boolean} */
        let acquired;
        try {
            acquired = await this._tryAcquireAdvisoryLock(name);
        }
        catch (error) {
            if (!reentrant)
                this._releaseProcessLocalAdvisoryLock(name);
            throw error;
        }
        if (!acquired) {
            if (!reentrant)
                this._releaseProcessLocalAdvisoryLock(name);
            return false;
        }
        this._trackAdvisoryLock(name);
        return true;
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
     * The driver-native release runs first; the process-local tier is handed
     * to the next waiter only once this connection's counted registry no
     * longer holds the name, so re-entrant acquisitions release one level at
     * a time exactly like the session-scoped driver locks.
     * @param {string} name - Lock name.
     * @returns {Promise<boolean>} - Resolves to true if the lock was held by this session and has now been released.
     */
    async releaseAdvisoryLock(name) {
        const owner = VelociousDatabaseDriversBase._advisoryLockState.ownersByName.get(name);
        // Another driver instance in this process owns the tier for this name,
        // so this connection can never be the native holder either — refuse
        // before issuing a release statement that could disturb the owner.
        if (owner !== undefined && owner !== this)
            return false;
        if (!this.supportsDriverNativeAdvisoryLock()) {
            // Plain SQLite: the process-local tier IS the lock, so the first
            // release by the owner releases it fully, exactly as the SQLite
            // emulation always has.
            const released = this._releaseProcessLocalAdvisoryLock(name);
            if (released) {
                this._untrackAdvisoryLock(name);
            }
            else {
                this._heldAdvisoryLocks.delete(name);
            }
            return released;
        }
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
            // Last connection-level release: hand the process-local tier to the
            // next queued caller in this process.
            this._releaseProcessLocalAdvisoryLock(name);
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
     *
     * The process-local tier answers first (a same-process holder is a
     * holder, full stop); otherwise the question goes to the driver-native
     * tier's introspection (`IS_USED_LOCK` / `pg_locks` / `APPLOCK_TEST`).
     * @param {string} name - Lock name.
     * @returns {Promise<boolean>} - Resolves to true if the lock is held by any session.
     */
    async isAdvisoryLockHeld(name) {
        if (VelociousDatabaseDriversBase._advisoryLockState.ownersByName.has(name))
            return true;
        if (!this.supportsDriverNativeAdvisoryLock())
            return false;
        return await this._isAdvisoryLockHeldNative(name);
    }
    /**
     * Driver-native advisory-lock introspection hook behind
     * `isAdvisoryLockHeld`.
     * @abstract
     * @param {string} name - Lock name.
     * @returns {Promise<boolean>} - Resolves to true if the native tier reports the lock held.
     */
    _isAdvisoryLockHeldNative(name) {
        throw new Error(`'_isAdvisoryLockHeldNative' not implemented for ${this.constructor.name}`);
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiYmFzZS5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uLy4uLy4uLy4uL3NyYy9kYXRhYmFzZS9kcml2ZXJzL2Jhc2UuanMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6IkFBQUEsWUFBWTtBQUVaOzs7Ozs7OztHQVFHO0FBQ0g7Ozs7O0dBS0c7QUFDSDs7Ozs7R0FLRztBQUNIOzs7OztHQUtHO0FBQ0g7Ozs7Ozs7OztHQVNHO0FBQ0g7Ozs7R0FJRztBQUNIOzs7OztHQUtHO0FBQ0g7Ozs7Ozs7OztHQVNHO0FBQ0g7Ozs7Ozs7Ozs7Ozs7R0FhRztBQUVIOzs7Ozs7Ozs7Ozs7Ozs7OztHQWlCRztBQUVIOzs7Ozs7R0FNRztBQUVIOzs7Ozs7OztHQVFHO0FBRUg7Ozs7Ozs7Ozs7O0dBV0c7QUFFSDs7Ozs7OztHQU9HO0FBRUg7Ozs7OztHQU1HO0FBQ0g7Ozs7Ozs7R0FPRztBQUVIOzs7Ozs7R0FNRztBQUVILE9BQU8sZ0JBQWdCLE1BQU0sa0NBQWtDLENBQUE7QUFDL0QsT0FBTyxFQUFFLHNCQUFzQixFQUFFLE1BQU0sbUJBQW1CLENBQUE7QUFDMUQsT0FBTyxFQUFFLHFCQUFxQixFQUFFLE1BQU0sd0JBQXdCLENBQUE7QUFDOUQsT0FBTyxNQUFNLE1BQU0sd0JBQXdCLENBQUE7QUFDM0MsT0FBTyxFQUFDLHdDQUF3QyxFQUFDLE1BQU0sMkJBQTJCLENBQUE7QUFDbEYsT0FBTyxFQUFDLCtCQUErQixFQUFFLCtCQUErQixFQUFDLE1BQU0sK0JBQStCLENBQUE7QUFDOUcsT0FBTyxNQUFNLE1BQU0saUJBQWlCLENBQUE7QUFDcEMsT0FBTyxLQUFLLE1BQU0sbUJBQW1CLENBQUE7QUFDckMsT0FBTyxpQkFBaUIsTUFBTSwyQkFBMkIsQ0FBQTtBQUN6RCxPQUFPLE9BQU8sTUFBTSxlQUFlLENBQUE7QUFDbkMsT0FBTyxFQUFFLGNBQWMsRUFBRSxNQUFNLGlDQUFpQyxDQUFBO0FBQ2hFLE9BQU8sS0FBSyxNQUFNLDJCQUEyQixDQUFBO0FBQzdDLE9BQU8sSUFB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QUFFO1lBQ3JDLGtCQUFrQixFQUFFLElBQUk7WUFDeEIsaUJBQWlCLEVBQUUsSUFBSTtTQUN4QixDQUFBO1FBRUQsSUFBSSxJQUFJLENBQUMsYUFBYSxFQUFFLENBQUM7WUFDdkIsSUFBSSxDQUFDO2dCQUNILE1BQU0sQ0FBQyxrQkFBa0IsR0FBRyxNQUFNLElBQUksQ0FBQyw4QkFBOEIsQ0FBQyxJQUFJLENBQUMsUUFBUSxDQUFDLENBQUE7WUFDdEYsQ0FBQztZQUFDLE9BQU8sS0FBSyxFQUFFLENBQUM7Z0JBQ2YsTUFBTSxDQUFDLGlCQUFpQixHQUFHLEtBQUssWUFBWSxLQUFLLENBQUMsQ0FBQyxDQUFDLEtBQUssQ0FBQyxPQUFPLENBQUMsQ0FBQyxDQUFDLE1BQU0sQ0FBQyxLQUFLLENBQUMsQ0FBQTtZQUNuRixDQUFDO1FBQ0gsQ0FBQztRQUVELCtCQUErQixDQUFDLElBQUksQ0FBQyxhQUFhLEVBQUUsTUFBTSxDQUFDLENBQUE7SUFDN0QsQ0FBQztDQUNGIiwic291cmNlc0NvbnRlbnQiOlsiLy8gQHRzLWNoZWNrXG5cbi8qKlxuICogQ3JlYXRlSW5kZXhTcWxBcmdzIHR5cGUuXG4gKiBAdHlwZWRlZiB7b2JqZWN0fSBDcmVhdGVJbmRleFNxbEFyZ3NcbiAqIEBwcm9wZXJ0eSB7QXJyYXk8c3RyaW5nIHwgaW1wb3J0KFwiLi8uLi90YWJsZS1kYXRhL3RhYmxlLWNvbHVtbi5qc1wiKS5kZWZhdWx0Pn0gY29sdW1ucyAtIENvbHVtbnMgdG8gaW5jbHVkZSBpbiB0aGUgaW5kZXguXG4gKiBAcHJvcGVydHkge2Jvb2xlYW59IFtpZk5vdEV4aXN0c10gLSBTa2lwIGNyZWF0aW9uIGlmIHRoZSBpbmRleCBhbHJlYWR5IGV4aXN0cy5cbiAqIEBwcm9wZXJ0eSB7c3RyaW5nfSBbbmFtZV0gLSBFeHBsaWNpdCBpbmRleCBuYW1lIHRvIHVzZS5cbiAqIEBwcm9wZXJ0eSB7Ym9vbGVhbn0gW3VuaXF1ZV0gLSBXaGV0aGVyIHRoZSBpbmRleCBzaG91bGQgZW5mb3JjZSB1bmlxdWVuZXNzLlxuICogQHByb3BlcnR5IHtzdHJpbmd9IHRhYmxlTmFtZSAtIE5hbWUgb2YgdGhlIHRhYmxlIHRvIGFkZCB0aGUgaW5kZXggdG8uXG4gKi9cbi8qKlxuICogUmVtb3ZlSW5kZXhTcWxBcmdzIHR5cGUuXG4gKiBAdHlwZWRlZiB7b2JqZWN0fSBSZW1vdmVJbmRleFNxbEFyZ3NcbiAqIEBwcm9wZXJ0eSB7c3RyaW5nfSBuYW1lIC0gSW5kZXggbmFtZSB0byBkcm9wLlxuICogQHByb3BlcnR5IHtzdHJpbmd9IHRhYmxlTmFtZSAtIE5hbWUgb2YgdGhlIHRhYmxlIHRoZSBpbmRleCBiZWxvbmdzIHRvLlxuICovXG4vKipcbiAqIERyb3BUYWJsZVNxbEFyZ3NUeXBlIHR5cGUuXG4gKiBAdHlwZWRlZiB7b2JqZWN0fSBEcm9wVGFibGVTcWxBcmdzVHlwZVxuICogQHByb3BlcnR5IHtib29sZWFufSBbY2FzY2FkZV0gLSBXaGV0aGVyIGRlcGVuZGVudCBvYmplY3RzIHNob3VsZCBiZSBkcm9wcGVkIHRvby5cbiAqIEBwcm9wZXJ0eSB7Ym9vbGVhbn0gW2lmRXhpc3RzXSAtIFNraXAgZHJvcHBpbmcgaWYgdGhlIHRhYmxlIGRvZXMgbm90IGV4aXN0LlxuICovXG4vKipcbiAqIERlbGV0ZVNxbEFyZ3NUeXBlIHR5cGUuXG4gKiBAdHlwZWRlZiB7b2JqZWN0fSBEZWxldGVTcWxBcmdzVHlwZVxuICogQHByb3BlcnR5IHtzdHJpbmd9IHRhYmxlTmFtZSAtIFRhYmxlIG5hbWUgdG8gZGVsZXRlIGZyb20uXG4gKiBAcHJvcGVydHkge3tba2V5OiBzdHJpbmddOiBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn19IGNvbmRpdGlvbnMgLSBDb25kaXRpb25zIHVzZWQgdG8gYnVpbGQgdGhlIGRlbGV0ZSBXSEVSRSBjbGF1c2UuXG4gKi9cbi8qKlxuICogSW5zZXJ0U3FsQXJnc1R5cGUgdHlwZS5cbiAqIEB0eXBlZGVmIHtvYmplY3R9IEluc2VydFNxbEFyZ3NUeXBlXG4gKiBAcHJvcGVydHkge3N0cmluZ1tdfSBbY29sdW1uc10gLSBDb2x1bW4gbmFtZXMgZm9yIGByb3dzYCBpbnNlcnRzLlxuICogQHByb3BlcnR5IHt7W2tleTogc3RyaW5nXTogUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59fSBbZGF0YV0gLSBDb2x1bW4vdmFsdWUgcGFpcnMgZm9yIGEgc2luZ2xlLXJvdyBpbnNlcnQuXG4gKiBAcHJvcGVydHkge2Jvb2xlYW59IFttdWx0aXBsZV0gLSBXaGV0aGVyIHRoaXMgaW5zZXJ0IHNob3VsZCBiZSB0cmVhdGVkIGFzIG11bHRpLXJvdy5cbiAqIEBwcm9wZXJ0eSB7c3RyaW5nW119IFtyZXR1cm5MYXN0SW5zZXJ0ZWRDb2x1bW5OYW1lc10gLSBDb2x1bW4gbmFtZXMgdG8gcmV0dXJuIGFmdGVyIGluc2VydC5cbiAqIEBwcm9wZXJ0eSB7QXJyYXk8QXJyYXk8UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+Pn0gW3Jvd3NdIC0gUm93IHZhbHVlcyBmb3IgYSBtdWx0aS1yb3cgaW5zZXJ0LlxuICogQHByb3BlcnR5IHtzdHJpbmd9IHRhYmxlTmFtZSAtIFRhYmxlIG5hbWUgdG8gaW5zZXJ0IGludG8uXG4gKi9cbi8qKlxuICogUXVlcnlSb3dUeXBlIHR5cGUuXG4gKiBAdHlwZWRlZiB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSBRdWVyeVJvd1R5cGVcbiAqIEB0eXBlZGVmIHtBcnJheTxRdWVyeVJvd1R5cGU+fSBRdWVyeVJlc3VsdFR5cGVcbiAqL1xuLyoqXG4gKiBUcmFuc2FjdGlvbkNhbGxiYWNrRnJhbWUgdHlwZS5cbiAqIEB0eXBlZGVmIHtvYmplY3R9IFRyYW5zYWN0aW9uQ2FsbGJhY2tGcmFtZVxuICogQHByb3BlcnR5IHtBcnJheTwoKSA9PiB2b2lkIHwgUHJvbWlzZTx2b2lkPj59IGFmdGVyQ29tbWl0Q2FsbGJhY2tzIC0gQ2FsbGJhY2tzIHRvIG1lcmdlIG9yIHJ1biBhZnRlciBjb21taXQuXG4gKiBAcHJvcGVydHkge0FycmF5PCgpID0+IHZvaWQgfCBQcm9taXNlPHZvaWQ+Pn0gYmVmb3JlQ29tbWl0Q2FsbGJhY2tzIC0gR3VhcmRzIHRvIHJ1biBiZWZvcmUgdGhpcyBmcmFtZSBjb21wbGV0ZXMuXG4gKi9cbi8qKlxuICogUmV0cnlhYmxlRGF0YWJhc2VFcnJvclJlc3VsdCB0eXBlLlxuICogQHR5cGVkZWYge29iamVjdH0gUmV0cnlhYmxlRGF0YWJhc2VFcnJvclJlc3VsdFxuICogQHByb3BlcnR5IHtib29sZWFufSByZXRyeSAtIFdoZXRoZXIgdGhlIGVycm9yIHNob3VsZCBiZSByZXRyaWVkLlxuICogQHByb3BlcnR5IHtib29sZWFufSByZWNvbm5lY3QgLSBXaGV0aGVyIHRvIHJlY29ubmVjdCBiZWZvcmUgcmV0cnlpbmcuXG4gKiBAcHJvcGVydHkge2Jvb2xlYW59IFtkZWFkbG9ja10gLSBXaGV0aGVyIHRoZSBlcnJvciBpcyBhIHRyYW5zYWN0aW9uIGRlYWRsb2NrL2xvY2std2FpdC10aW1lb3V0IHRoYXQgc2hvdWxkIHJldHJ5IHRoZSB3aG9sZSB0cmFuc2FjdGlvbi5cbiAqIEBwcm9wZXJ0eSB7XCJkZWFkbG9ja1wiIHwgXCJsb2NrLXdhaXQtdGltZW91dFwifSBbY29udGVudGlvbktpbmRdIC0gQ2xhc3NpZmllZCB0cmFuc2FjdGlvbiBjb250ZW50aW9uIGtpbmQuXG4gKiBAcHJvcGVydHkge251bWJlcn0gW21heFRyaWVzXSAtIE92ZXJyaWRlIHRoZSBtYXggcmV0cnkgYXR0ZW1wdHMuXG4gKiBAcHJvcGVydHkge251bWJlcn0gW3dhaXRNc10gLSBXYWl0IHRpbWUgYmVmb3JlIHJldHJ5aW5nIGluIG1pbGxpc2Vjb25kcy5cbiAqL1xuLyoqXG4gKiBRdWVyeU9wdGlvbnMgdHlwZS5cbiAqIEB0eXBlZGVmIHtvYmplY3R9IFF1ZXJ5T3B0aW9uc1xuICogQHByb3BlcnR5IHtzdHJpbmd9IFtsb2dOYW1lXSAtIFF1ZXJ5IGxvZyBzdWJqZWN0LlxuICogQHByb3BlcnR5IHtib29sZWFufSBbbG9nUXVlcnldIC0gV2hldGhlciB0byBsb2cgdGhlIHF1ZXJ5LlxuICogQHByb3BlcnR5IHtib29sZWFufSBbcHJvY2Vzc0xpc3RDb21tZW50XSAtIFdoZXRoZXIgdG8gYWRkIHByb2Nlc3MtbGlzdCBjb21tZW50cyB0byB0aGUgcXVlcnkuXG4gKiBAcHJvcGVydHkge251bWJlcn0gW3JlcXVlc3RUaW1lb3V0TXNdIC0gUGVyLXJlcXVlc3QgZHJpdmVyIHRpbWVvdXQgaW4gbWlsbGlzZWNvbmRzOyB6ZXJvIGRpc2FibGVzIHRoZSBkZWFkbGluZSBvbiBzdXBwb3J0aW5nIGRyaXZlcnMuXG4gKiBAcHJvcGVydHkge2Jvb2xlYW59IFtyZXRyeV0gLSBXaGV0aGVyIHJldHJ5YWJsZSBlcnJvcnMgbWF5IHJldHJ5IHRoZSBxdWVyeTsgZGVmYXVsdHMgdG8gdHJ1ZS5cbiAqIEBwcm9wZXJ0eSB7Ym9vbGVhbn0gW3Nlc3Npb25UaW1lWm9uZV0gLSBXaGV0aGVyIHRvIGVuc3VyZSB0aGUgY29uZmlndXJlZCBkYXRhYmFzZSBzZXNzaW9uIHRpbWUgem9uZSBiZWZvcmUgdGhlIHF1ZXJ5LlxuICogQHByb3BlcnR5IHtib29sZWFufSBbc3FsaXRlU2NyaXB0XSAtIEludGVybmFsIFNRTGl0ZSBmbGFnIHNlbGVjdGluZyBuYXRpdmUgbXVsdGktc3RhdGVtZW50IHNjcmlwdCBleGVjdXRpb24uXG4gKiBAcHJvcGVydHkge0Fib3J0U2lnbmFsfSBbc2lnbmFsXSAtIEFib3J0cyB0aGUgaW4tZmxpZ2h0IHF1ZXJ5IChkZXN0cm95aW5nIGl0cyBjb25uZWN0aW9uKSB3aGVuIGl0IGZpcmVzLlxuICogQHByb3BlcnR5IHtzdHJpbmd9IFtzb3VyY2VTdGFja10gLSBTdGFjayBjYXB0dXJlZCBhdCB0aGUgY2FsbGVyIGJvdW5kYXJ5LlxuICogQHByb3BlcnR5IHtzeW1ib2x9IFtvcGVyYXRpb25Pd25lcl0gLSBPcGFxdWUgb3duZXIgZm9yIGFuIG9wZXJhdGlvbi1sZWFzZWQgY29ubmVjdGlvbi5cbiAqL1xuXG4vKipcbiAqIERlYWRsb2NrUmV0cnlEaWFnbm9zdGljU25hcHNob3QgdHlwZS5cbiAqIEB0eXBlZGVmIHtvYmplY3R9IERlYWRsb2NrUmV0cnlEaWFnbm9zdGljU25hcHNob3RcbiAqIEBwcm9wZXJ0eSB7bnVtYmVyfSBhdHRlbXB0IC0gT25lLWJhc2VkIHRyYW5zYWN0aW9uIGF0dGVtcHQuXG4gKiBAcHJvcGVydHkge1wiZGVhZGxvY2tcIiB8IFwibG9jay13YWl0LXRpbWVvdXRcIn0gY29udGVudGlvbktpbmQgLSBDbGFzc2lmaWVkIGNvbnRlbnRpb24ga2luZC5cbiAqIEBwcm9wZXJ0eSB7c3RyaW5nfSBbZGF0YWJhc2VJZGVudGlmaWVyXSAtIFJlZGFjdGVkIGxvZ2ljYWwgZGF0YWJhc2UgcG9vbCBpZGVudGlmaWVyIG1hcmtlci5cbiAqIEBwcm9wZXJ0eSB7c3RyaW5nfSBbZGF0YWJhc2VJZGVudGlmaWVyRmluZ2VycHJpbnRdIC0gT3BhcXVlIGxvZ2ljYWwgZGF0YWJhc2UgcG9vbCBpZGVudGl0eS5cbiAqIEBwcm9wZXJ0eSB7c3RyaW5nfSBbZGF0YWJhc2VJZGVudGl0eUZpbmdlcnByaW50XSAtIE9wYXF1ZSBwaHlzaWNhbCBkYXRhYmFzZSBpZGVudGl0eS5cbiAqIEBwcm9wZXJ0eSB7c3RyaW5nfSBkcml2ZXJUeXBlIC0gRHJpdmVyIHR5cGUuXG4gKiBAcHJvcGVydHkge251bWJlcn0gbWF4QXR0ZW1wdHMgLSBDb25maWd1cmVkIHRyYW5zYWN0aW9uIGF0dGVtcHQgYnVkZ2V0LlxuICogQHByb3BlcnR5IHtzdHJpbmd9IFtvcGVyYXRpb25OYW1lXSAtIFJlZGFjdGVkIG9wZXJhdGlvbi1uYW1lIG1hcmtlci5cbiAqIEBwcm9wZXJ0eSB7c3RyaW5nfSBbb3BlcmF0aW9uTmFtZUZpbmdlcnByaW50XSAtIE9wYXF1ZSBvcGVyYXRpb24tbmFtZSBpZGVudGl0eS5cbiAqIEBwcm9wZXJ0eSB7c3RyaW5nfSBbc3FsRmluZ2VycHJpbnRdIC0gTm9ybWFsaXplZCBTUUwtc2hhcGUgZmluZ2VycHJpbnQuXG4gKiBAcHJvcGVydHkge3N0cmluZ30gW3NxbE9wZXJhdGlvbl0gLSBTUUwgdmVyYi5cbiAqIEBwcm9wZXJ0eSB7c3RyaW5nfSBzdGFnZSAtIEVycm9yLWV2ZW50IHN0YWdlLlxuICogQHByb3BlcnR5IHtudW1iZXJ9IHRyYW5zYWN0aW9uQXR0ZW1wdER1cmF0aW9uTXMgLSBEdXJhdGlvbiBvZiB0aGUgZmFpbGVkIG91dGVyIGF0dGVtcHQuXG4gKiBAcHJvcGVydHkge2Jvb2xlYW59IHdpbGxSZXRyeSAtIFdoZXRoZXIgYW5vdGhlciBvdXRlciB0cmFuc2FjdGlvbiBhdHRlbXB0IHdpbGwgcnVuLlxuICovXG5cbi8qKlxuICogVGVzdFByb2ZpbGVRdWVyeUF0dGVtcHQgdHlwZS5cbiAqIEB0eXBlZGVmIHtvYmplY3R9IFRlc3RQcm9maWxlUXVlcnlBdHRlbXB0XG4gKiBAcHJvcGVydHkge2ltcG9ydChcIi4uLy4uL3Rlc3RpbmcvdGVzdC1wcm9maWxlci5qc1wiKS5UZXN0UHJvZmlsZUFzeW5jQ29udGV4dH0gY29udGV4dCAtIENhcHR1cmVkIGFzeW5jIGF0dHJpYnV0aW9uLlxuICogQHByb3BlcnR5IHt7c3FsRmluZ2VycHJpbnQ6IHN0cmluZywgc3FsT3BlcmF0aW9uOiBzdHJpbmd9fSBkaWFnbm9zdGljIC0gUmVkYWN0ZWQgc3RhdGVtZW50IGRpYWdub3N0aWMuXG4gKiBAcHJvcGVydHkge251bWJlcn0gc3RhcnRlZEF0TXMgLSBQaHlzaWNhbCBhdHRlbXB0IHN0YXJ0IHRpbWUuXG4gKi9cblxuLyoqXG4gKiBBY3RpdmVRdWVyeURlYnVnU25hcHNob3QgdHlwZS5cbiAqIEB0eXBlZGVmIHtvYmplY3R9IEFjdGl2ZVF1ZXJ5RGVidWdTbmFwc2hvdFxuICogQHByb3BlcnR5IHtzdHJpbmdbXX0gYW5ub3RhdGlvbnMgLSBEYXRhYmFzZSBhbm5vdGF0aW9ucyBhY3RpdmUgd2hlbiB0aGUgcXVlcnkgc3RhcnRlZC5cbiAqIEBwcm9wZXJ0eSB7c3RyaW5nfSBsb2dOYW1lIC0gUXVlcnkgbG9nIG5hbWUuXG4gKiBAcHJvcGVydHkge251bWJlcn0gc3RhcnRlZEF0VW5peE1zIC0gUXVlcnkgc3RhcnQgdGltZXN0YW1wLlxuICogQHByb3BlcnR5IHtudW1iZXJ9IHJ1bm5pbmdNcyAtIFF1ZXJ5IHJ1bnRpbWUgaW4gbWlsbGlzZWNvbmRzLlxuICogQHByb3BlcnR5IHtzdHJpbmd9IHNxbFByZXZpZXcgLSBUcnVuY2F0ZWQgU1FMIHByZXZpZXcuXG4gKi9cblxuLyoqXG4gKiBEYXRhYmFzZUNvbm5lY3Rpb25EZWJ1Z1NuYXBzaG90IHR5cGUuXG4gKiBAdHlwZWRlZiB7b2JqZWN0fSBEYXRhYmFzZUNvbm5lY3Rpb25EZWJ1Z1NuYXBzaG90XG4gKiBAcHJvcGVydHkge0FjdGl2ZVF1ZXJ5RGVidWdTbmFwc2hvdCB8IG51bGx9IGFjdGl2ZVF1ZXJ5IC0gQ3VycmVudGx5IHJ1bm5pbmcgcXVlcnksIGlmIGFueS5cbiAqIEBwcm9wZXJ0eSB7bnVtYmVyIHwgdW5kZWZpbmVkfSBjaGVja2VkT3V0QXRVbml4TXMgLSBDaGVja291dCBzdGFydCB0aW1lc3RhbXAgZm9yIGFjdGl2ZSBjaGVja291dHMuXG4gKiBAcHJvcGVydHkge251bWJlciB8IHVuZGVmaW5lZH0gY2hlY2tvdXRBZ2VNcyAtIEFjdGl2ZSBjaGVja291dCBhZ2UgaW4gbWlsbGlzZWNvbmRzLlxuICogQHByb3BlcnR5IHtzdHJpbmcgfCB1bmRlZmluZWR9IGNoZWNrb3V0TmFtZSAtIEh1bWFuLXJlYWRhYmxlIGNoZWNrb3V0IG5hbWUuXG4gKiBAcHJvcGVydHkge3N0cmluZ30gZHJpdmVyQ2xhc3MgLSBEcml2ZXIgY2xhc3MgbmFtZS5cbiAqIEBwcm9wZXJ0eSB7bnVtYmVyIHwgdW5kZWZpbmVkfSBpZFNlcSAtIFBvb2wgY2hlY2tvdXQgSUQgc2VxdWVuY2UuXG4gKiBAcHJvcGVydHkge251bWJlcn0gb3BlblRyYW5zYWN0aW9ucyAtIE51bWJlciBvZiBvcGVuIHRyYW5zYWN0aW9uIGZyYW1lcy5cbiAqIEBwcm9wZXJ0eSB7bnVtYmVyfSBzY2hlbWFDYWNoZUVudHJpZXMgLSBOdW1iZXIgb2YgY2FjaGVkIHNjaGVtYSBtZXRhZGF0YSBlbnRyaWVzLlxuICovXG5cbi8qKlxuICogQWN0aXZlUXVlcnlTdGF0ZSB0eXBlLlxuICogQHR5cGVkZWYge29iamVjdH0gQWN0aXZlUXVlcnlTdGF0ZVxuICogQHByb3BlcnR5IHtzdHJpbmdbXX0gYW5ub3RhdGlvbnMgLSBEYXRhYmFzZSBhbm5vdGF0aW9ucyBhY3RpdmUgd2hlbiB0aGUgcXVlcnkgc3RhcnRlZC5cbiAqIEBwcm9wZXJ0eSB7c3RyaW5nfSBsb2dOYW1lIC0gUXVlcnkgbG9nIG5hbWUuXG4gKiBAcHJvcGVydHkge251bWJlcn0gc3RhcnRlZEF0VW5peE1zIC0gUXVlcnkgc3RhcnQgdGltZXN0YW1wLlxuICogQHByb3BlcnR5IHtzdHJpbmd9IHNxbFByZXZpZXcgLSBUcnVuY2F0ZWQgU1FMIHByZXZpZXcuXG4gKi9cblxuLyoqXG4gKiBVcGRhdGVTcWxBcmdzVHlwZSB0eXBlLlxuICogQHR5cGVkZWYge29iamVjdH1VcGRhdGVTcWxBcmdzVHlwZVxuICogQHByb3BlcnR5IHtvYmplY3R9IGNvbmRpdGlvbnMgLSBDb25kaXRpb25zIHVzZWQgdG8gYnVpbGQgdGhlIHVwZGF0ZSBXSEVSRSBjbGF1c2UuXG4gKiBAcHJvcGVydHkge29iamVjdH0gZGF0YSAtIENvbHVtbi92YWx1ZSBwYWlycyB0byB1cGRhdGUuXG4gKiBAcHJvcGVydHkge3N0cmluZ30gdGFibGVOYW1lIC0gVGFibGUgbmFtZSB0byB1cGRhdGUuXG4gKi9cbi8qKlxuICogVXBzZXJ0U3FsQXJnc1R5cGUgdHlwZS5cbiAqIEB0eXBlZGVmIHtvYmplY3R9VXBzZXJ0U3FsQXJnc1R5cGVcbiAqIEBwcm9wZXJ0eSB7c3RyaW5nW119IGNvbmZsaWN0Q29sdW1ucyAtIENvbHVtbnMgdGhhdCBkZWZpbmUgYSBjb25mbGljdC5cbiAqIEBwcm9wZXJ0eSB7b2JqZWN0fSBkYXRhIC0gQ29sdW1uL3ZhbHVlIHBhaXJzIHRvIGluc2VydC5cbiAqIEBwcm9wZXJ0eSB7c3RyaW5nfSB0YWJsZU5hbWUgLSBUYWJsZSBuYW1lIHRvIHVwc2VydCBpbnRvLlxuICogQHByb3BlcnR5IHtzdHJpbmdbXX0gdXBkYXRlQ29sdW1ucyAtIENvbHVtbnMgdG8gdXBkYXRlIG9uIGNvbmZsaWN0LlxuICovXG5cbi8qKlxuICogU3FsVG9rZW5SZXN1bHQgdHlwZS5cbiAqIEB0eXBlZGVmIHtvYmplY3R9IFNxbFRva2VuUmVzdWx0XG4gKiBAcHJvcGVydHkge2Jvb2xlYW59IGluY29tcGxldGUgLSBXaGV0aGVyIHRoZSBzY2FuIGhpdCBpdHMgYm91bmQgYmVmb3JlIGZpbmlzaGluZyB0cml2aWEvdG9rZW4gcGFyc2luZy5cbiAqIEBwcm9wZXJ0eSB7c3RyaW5nIHwgdW5kZWZpbmVkfSB0b2tlbiAtIExvd2VyY2FzZWQgdG9rZW4gd2hlbiBwYXJzaW5nIGNvbXBsZXRlZDsgdW5kZWZpbmVkIHdoZW4gbm8gdG9rZW4gd2FzIGZvdW5kLlxuICogQHByb3BlcnR5IHtudW1iZXJ9IGluZGV4IC0gSW5kZXggaW1tZWRpYXRlbHkgYWZ0ZXIgdGhlIHBhcnNlZCB0b2tlbiBvciB0cml2aWEuXG4gKi9cblxuaW1wb3J0IEJhY2t0cmFjZUNsZWFuZXIgZnJvbSBcIi4uLy4uL3V0aWxzL2JhY2t0cmFjZS1jbGVhbmVyLmpzXCJcbmltcG9ydCB7IGdldERhdGFiYXNlQW5ub3RhdGlvbnMgfSBmcm9tIFwiLi4vYW5ub3RhdGlvbnMuanNcIlxuaW1wb3J0IHsgZm9ybWF0RGF0ZUZvckRhdGFiYXNlIH0gZnJvbSBcIi4uL2RhdGV0aW1lLXN0b3JhZ2UuanNcIlxuaW1wb3J0IGlzRGF0ZSBmcm9tIFwiLi4vLi4vdXRpbHMvaXMtZGF0ZS5qc1wiXG5pbXBvcnQge0RFRkFVTFRfQURWSVNPUllfTE9DS19BQ1FVSVJFX1RJTUVPVVRfTVN9IGZyb20gXCIuLi9hZHZpc29yeS1sb2NrLWJvdW5kLmpzXCJcbmltcG9ydCB7YWR2aXNvcnlMb2NrVGVsZW1ldHJ5VGhyZXNob2xkcywgZW1pdEFkdmlzb3J5TG9ja1RlbGVtZXRyeVJlcG9ydH0gZnJvbSBcIi4uL2Fkdmlzb3J5LWxvY2stdGVsZW1ldHJ5LmpzXCJcbmltcG9ydCBMb2dnZXIgZnJvbSBcIi4uLy4uL2xvZ2dlci5qc1wiXG5pbXBvcnQgUXVlcnkgZnJvbSBcIi4uL3F1ZXJ5L2luZGV4LmpzXCJcbmltcG9ydCBRdWVyeUFib3J0ZWRFcnJvciBmcm9tIFwiLi4vcXVlcnktYWJvcnRlZC1lcnJvci5qc1wiXG5pbXBvcnQgSGFuZGxlciBmcm9tIFwiLi4vaGFuZGxlci5qc1wiXG5pbXBvcnQgeyB1dGY4Qnl0ZUxlbmd0aCB9IGZyb20gXCIuLi8uLi91dGlscy91dGY4LWJ5dGUtbGVuZ3RoLmpzXCJcbmltcG9ydCBNdXRleCBmcm9tIFwiZXBpYy1sb2Nrcy9idWlsZC9tdXRleC5qc1wiXG5pbXBvcnQgVVVJRCBmcm9tIFwicHVyZS11dWlkXCJcbmltcG9ydCBUYWJsZURhdGEgZnJvbSBcIi4uL3RhYmxlLWRhdGEvaW5kZXguanNcIlxuaW1wb3J0IFRhYmxlQ29sdW1uIGZyb20gXCIuLi90YWJsZS1kYXRhL3RhYmxlLWNvbHVtbi5qc1wiXG5pbXBvcnQgVGFibGVGb3JlaWduS2V5IGZyb20gXCIuLi90YWJsZS1kYXRhL3RhYmxlLWZvcmVpZ24ta2V5LmpzXCJcbmltcG9ydCB3YWl0IGZyb20gXCJhd2FpdGVyeS9idWlsZC93YWl0LmpzXCJcbmltcG9ydCB7IGVuc3VyZUVycm9yLCBvcHRpb25hbFBvc2l0aXZlSW50ZWdlciB9IGZyb20gXCJ0eXBhbmljXCJcbmltcG9ydCB7Y29vcmRpbmF0ZVNoYXJlZFRyYW5zYWN0aW9uQ29ubmVjdGlvbiwgcnVuV2l0aG91dFNoYXJlZFRyYW5zYWN0aW9uQ29vcmRpbmF0b3JPd25lcn0gZnJvbSBcIi4uLy4uL3Rlc3Rpbmcvc2hhcmVkLXRyYW5zYWN0aW9uLWNvbm5lY3Rpb24tY29vcmRpbmF0b3IuanNcIlxuaW1wb3J0IHsgY3VycmVudFRlc3RQcm9maWxlQ29udGV4dCB9IGZyb20gXCIuLi8uLi90ZXN0aW5nL3Rlc3QtcHJvZmlsZS1jb250ZXh0LmpzXCJcbmltcG9ydCBzaGEyNTZIZXggZnJvbSBcIi4uLy4uL3V0aWxzL3NoYTI1Ni1oZXguanNcIlxuXG4vKiogTWF4aW11bSBjaGFyYWN0ZXJzIGluc3BlY3RlZCB3aGVuIGJ1aWxkaW5nIHRoZSBkZWJ1ZyBTUUwgcHJldmlldy4gKi9cbmNvbnN0IFNRTF9QUkVWSUVXX1NDQU5fTElNSVQgPSA0MDk2XG4vKiogTWF4aW11bSBjaGFyYWN0ZXJzIGluc3BlY3RlZCB3aGVuIGRlY2lkaW5nIHdoZXRoZXIgYSBzdGF0ZW1lbnQgaW52YWxpZGF0ZXMgc2NoZW1hIG1ldGFkYXRhLiAqL1xuY29uc3QgU0NIRU1BX0lOVkFMSURBVElPTl9TQ0FOX0xJTUlUID0gODE5MlxuLyoqIE1heGltdW0gY2hlY2tvdXQtbmFtZSBjaGFyYWN0ZXJzIGluc3BlY3RlZCBieSByZXRyeSBkaWFnbm9zdGljcy4gKi9cbmNvbnN0IE9QRVJBVElPTl9OQU1FX1NDQU5fTElNSVQgPSAxMDI0XG5jb25zdCBSRURBQ1RFRF9ESUFHTk9TVElDX0xBQkVMID0gXCJbUkVEQUNURURdXCJcbi8qKiBGaXJzdCBiYWNrb2ZmIGJldHdlZW4gcmV0cmllcyBvZiBhIHNjaGVtYS1tZXRhZGF0YSByZWFkIGJsb2NrZWQgYnkgY29uY3VycmVudCBvbmxpbmUgRERMLiAqL1xuY29uc3QgU0NIRU1BX01FVEFEQVRBX1JFVFJZX0lOSVRJQUxfREVMQVlfTVMgPSAyNTBcbi8qKiBMYXJnZXN0IGJhY2tvZmYgYmV0d2VlbiByZXRyaWVzIG9mIGEgc2NoZW1hLW1ldGFkYXRhIHJlYWQgYmxvY2tlZCBieSBjb25jdXJyZW50IG9ubGluZSBEREwuICovXG5jb25zdCBTQ0hFTUFfTUVUQURBVEFfUkVUUllfTUFYX0RFTEFZX01TID0gMjAwMFxuLyoqIERlZmF1bHQgYm91bmRlZCBkZWFkbGluZSBmb3Igb3V0bGFzdGluZyBhIGNvbmN1cnJlbnQgb25saW5lLURETCBtZXRhZGF0YSBza2lwLiAqL1xuY29uc3QgU0NIRU1BX01FVEFEQVRBX1JFVFJZX0RFQURMSU5FX01TID0gNjAwMDBcblxuLyoqXG4gKiBCdWlsZHMgYSBub24tcmV2ZXJzaWJsZSwgc3RhYmxlIFNRTCBmaW5nZXJwcmludCB3aXRob3V0IHJldGFpbmluZyBTUUwgdGV4dC4gTGl0ZXJhbCBzcGVsbGluZyBpc1xuICogbm9ybWFsaXplZCBmaXJzdCBzbyB0aGUgc2FtZSBzdGF0ZW1lbnQgc2hhcGUgcHJvZHVjZXMgdGhlIHNhbWUgZmluZ2VycHJpbnQgYWNyb3NzIHZhbHVlcy5cbiAqIEBwYXJhbSB7c3RyaW5nfSBzcWwgLSBTUUwgdG8gZmluZ2VycHJpbnQuXG4gKiBAcmV0dXJucyB7e3NxbEZpbmdlcnByaW50OiBzdHJpbmcsIHNxbE9wZXJhdGlvbjogc3RyaW5nfX0gLSBCb3VuZGVkIHF1ZXJ5IGRpYWdub3N0aWMuXG4gKi9cbmZ1bmN0aW9uIHNxbERpYWdub3N0aWMoc3FsKSB7XG4gIGxldCBmaW5nZXJwcmludElucHV0ID0gXCJcIlxuXG4gIGZvciAobGV0IGluZGV4ID0gMDsgaW5kZXggPCBzcWwubGVuZ3RoOykge1xuICAgIGNvbnN0IGNoYXJhY3RlciA9IHNxbFtpbmRleF1cbiAgICBjb25zdCBuZXh0Q2hhcmFjdGVyID0gc3FsW2luZGV4ICsgMV1cblxuICAgIGlmIChjaGFyYWN0ZXIgPT0gXCInXCIgfHwgY2hhcmFjdGVyID09ICdcIicpIHtcbiAgICAgIGNvbnN0IHF1b3RlID0gY2hhcmFjdGVyXG4gICAgICBmaW5nZXJwcmludElucHV0ICs9IFwiP1wiXG4gICAgICBpbmRleCsrXG5cbiAgICAgIHdoaWxlIChpbmRleCA8IHNxbC5sZW5ndGgpIHtcbiAgICAgICAgaWYgKHNxbFtpbmRleF0gPT0gXCJcXFxcXCIpIHtcbiAgICAgICAgICBpbmRleCArPSAyXG4gICAgICAgIH0gZWxzZSBpZiAoc3FsW2luZGV4XSA9PSBxdW90ZSAmJiBzcWxbaW5kZXggKyAxXSA9PSBxdW90ZSkge1xuICAgICAgICAgIGluZGV4ICs9IDJcbiAgICAgICAgfSBlbHNlIGlmIChzcWxbaW5kZXhdID09IHF1b3RlKSB7XG4gICAgICAgICAgaW5kZXgrK1xuICAgICAgICAgIGJyZWFrXG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgaW5kZXgrK1xuICAgICAgICB9XG4gICAgICB9XG4gICAgfSBlbHNlIGlmIChjaGFyYWN0ZXIgPT0gXCIvXCIgJiYgbmV4dENoYXJhY3RlciA9PSBcIipcIikge1xuICAgICAgY29uc3QgY29tbWVudEVuZCA9IHNxbC5pbmRleE9mKFwiKi9cIiwgaW5kZXggKyAyKVxuICAgICAgZmluZ2VycHJpbnRJbnB1dCArPSBcIiBcIlxuICAgICAgaW5kZXggPSBjb21tZW50RW5kID09IC0xID8gc3FsLmxlbmd0aCA6IGNvbW1lbnRFbmQgKyAyXG4gICAgfSBlbHNlIGlmICgoY2hhcmFjdGVyID09IFwiLVwiICYmIG5leHRDaGFyYWN0ZXIgPT0gXCItXCIpIHx8IGNoYXJhY3RlciA9PSBcIiNcIikge1xuICAgICAgY29uc3QgbGluZUVuZCA9IHNxbC5pbmRleE9mKFwiXFxuXCIsIGluZGV4ICsgMSlcbiAgICAgIGZpbmdlcnByaW50SW5wdXQgKz0gXCIgXCJcbiAgICAgIGluZGV4ID0gbGluZUVuZCA9PSAtMSA/IHNxbC5sZW5ndGggOiBsaW5lRW5kICsgMVxuICAgIH0gZWxzZSB7XG4gICAgICBmaW5nZXJwcmludElucHV0ICs9IGNoYXJhY3RlclxuICAgICAgaW5kZXgrK1xuICAgIH1cbiAgfVxuXG4gIGNvbnN0IG5vcm1hbGl6ZWQgPSBmaW5nZXJwcmludElucHV0XG4gICAgLnJlcGxhY2UoL1xcYig/OjB4WzAtOWEtZl0rfFxcZCsoPzpcXC5cXGQrKT8oPzplWystXT9cXGQrKT8pXFxiL2dpLCBcIj9cIilcbiAgICAucmVwbGFjZSgvXFxzKy9nLCBcIiBcIilcbiAgICAudHJpbSgpXG4gICAgLnRvTG93ZXJDYXNlKClcbiAgbGV0IGhhc2ggPSAweGNiZjI5Y2U0ODQyMjIzMjVuXG5cbiAgZm9yIChsZXQgaW5kZXggPSAwOyBpbmRleCA8IG5vcm1hbGl6ZWQubGVuZ3RoOyBpbmRleCsrKSB7XG4gICAgaGFzaCBePSBCaWdJbnQobm9ybWFsaXplZC5jaGFyQ29kZUF0KGluZGV4KSlcbiAgICBoYXNoID0gQmlnSW50LmFzVWludE4oNjQsIGhhc2ggKiAweDEwMDAwMDAwMWIzbilcbiAgfVxuXG4gIGNvbnN0IG9wZXJhdGlvbk1hdGNoID0gL14oW2Etel0rKS8uZXhlYyhub3JtYWxpemVkKVxuXG4gIHJldHVybiB7XG4gICAgc3FsRmluZ2VycHJpbnQ6IGBmbnYxYTY0OiR7aGFzaC50b1N0cmluZygxNikucGFkU3RhcnQoMTYsIFwiMFwiKX1gLFxuICAgIHNxbE9wZXJhdGlvbjogb3BlcmF0aW9uTWF0Y2ggPyBvcGVyYXRpb25NYXRjaFsxXS50b1VwcGVyQ2FzZSgpIDogXCJVTktOT1dOXCJcbiAgfVxufVxuXG4vKipcbiAqIE1hcmtzIGEgY2FsbGJhY2sgZmFpbHVyZSB0aGF0IGhhcHBlbmVkIGFmdGVyIHRoZSBvd25pbmcgdHJhbnNhY3Rpb24gd2FzIGR1cmFibHkgY29tbWl0dGVkLlxuICogVGhlIHB1YmxpYyB0cmFuc2FjdGlvbiBib3VuZGFyeSB1bndyYXBzIGl0IGJlZm9yZSBkZWFkbG9jayBjbGFzc2lmaWNhdGlvbi5cbiAqL1xuY2xhc3MgVmVsb2Npb3VzRGF0YWJhc2VBZnRlckNvbW1pdENhbGxiYWNrRXJyb3IgZXh0ZW5kcyBFcnJvciB7XG4gIC8qKlxuICAgKiBSdW5zIGNvbnN0cnVjdG9yLlxuICAgKiBAcGFyYW0ge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSBjYWxsYmFja0Vycm9yIC0gT3JpZ2luYWwgY2FsbGJhY2sgZmFpbHVyZS5cbiAgICovXG4gIGNvbnN0cnVjdG9yKGNhbGxiYWNrRXJyb3IpIHtcbiAgICBzdXBlcihcIkRhdGFiYXNlIGFmdGVyQ29tbWl0IGNhbGxiYWNrIGZhaWxlZFwiKVxuICAgIHRoaXMuY2FsbGJhY2tFcnJvciA9IGNhbGxiYWNrRXJyb3JcbiAgfVxufVxuXG4vKipcbiAqIFJ1bnMgbm93IG1zLlxuICogQHJldHVybnMge251bWJlcn0gLSBDdXJyZW50IGhpZ2gtcmVzb2x1dGlvbi1pc2ggdGltZXN0YW1wIGluIG1pbGxpc2Vjb25kcy5cbiAqL1xuZnVuY3Rpb24gbm93TXMoKSB7XG4gIGlmIChnbG9iYWxUaGlzLnBlcmZvcm1hbmNlICYmIHR5cGVvZiBnbG9iYWxUaGlzLnBlcmZvcm1hbmNlLm5vdyA9PSBcImZ1bmN0aW9uXCIpIHtcbiAgICByZXR1cm4gZ2xvYmFsVGhpcy5wZXJmb3JtYW5jZS5ub3coKVxuICB9XG5cbiAgcmV0dXJuIERhdGUubm93KClcbn1cblxuLyoqXG4gKiBSdW5zIGZvcm1hdCBlbGFwc2VkIG1zLlxuICogQHBhcmFtIHtudW1iZXJ9IGVsYXBzZWRNcyAtIEVsYXBzZWQgbWlsbGlzZWNvbmRzLlxuICogQHJldHVybnMge3N0cmluZ30gLSBGb3JtYXR0ZWQgZWxhcHNlZCBtaWxsaXNlY29uZHMuXG4gKi9cbmZ1bmN0aW9uIGZvcm1hdEVsYXBzZWRNcyhlbGFwc2VkTXMpIHtcbiAgcmV0dXJuIGAke01hdGgubWF4KGVsYXBzZWRNcywgMCkudG9GaXhlZCgxKX1tc2Bcbn1cblxuZXhwb3J0IGRlZmF1bHQgY2xhc3MgVmVsb2Npb3VzRGF0YWJhc2VEcml2ZXJzQmFzZSB7XG4gIC8qKlxuICAgKiBQcm9jZXNzLXdpZGUgc3RhdGUgZm9yIHRoZSAqKnByb2Nlc3MtbG9jYWwgYWR2aXNvcnktbG9jayBwcmUtZmlsdGVyXG4gICAqIHRpZXIqKiBzaGFyZWQgYnkgZXZlcnkgZHJpdmVyIChTUUxpdGUsIE15U1FML01hcmlhREIsIFBvc3RncmVTUUwsXG4gICAqIE1TU1FMKS4gSXQgc2VyaWFsaXplcyBjb25jdXJyZW50IGFjcXVpc2l0aW9ucyBvZiB0aGUgc2FtZSBsb2NrIG5hbWVcbiAgICogaW5zaWRlIHRoaXMgcHJvY2VzcyB0aHJvdWdoIGEgRklGTyB3YWl0ZXIgcXVldWUgYmVmb3JlIGFueSBjYWxsZXJcbiAgICogY29udGFjdHMgdGhlIGRyaXZlci1uYXRpdmUgdGllciwgc28gYSBjb250ZW5kZWQgc2FtZS1wcm9jZXNzIHdhaXRlclxuICAgKiBuZXZlciBwYXJrcyBhIHBvb2xlZCBkYXRhYmFzZSBjb25uZWN0aW9uIGluIGEgZHJpdmVyIGxvY2sgc3RhdGVcbiAgICogKE1hcmlhREIgYFVzZXIgbG9ja2AsIGBzcF9nZXRhcHBsb2NrYCBzZXNzaW9uIGhvbGQsIC4uLikuXG4gICAqXG4gICAqIFRoaXMgdGllciBpcyBhIHByZS1maWx0ZXIsICoqbmV2ZXIgdGhlIGF1dGhvcml0eSoqOiBhIGdyYW50IGhlcmUgb25seVxuICAgKiBtZWFucyBcInlvdSBhcmUgbmV4dCBpbiB0aGlzIHByb2Nlc3MuXCIgQ3Jvc3MtcHJvY2Vzcy9jcm9zcy1ob3N0XG4gICAqIGV4Y2x1c2lvbiBpcyBjb25maXJtZWQgYnkgdGhlIGRyaXZlci1uYXRpdmUgdGllciAob3IsIG9uY2UgdGhlXG4gICAqIFNUQy0yMTAgYmFja2VuZCBjaGFpbiBsYW5kcywgdGhlIGNvbmZpZ3VyZWQgY3Jvc3MtaG9zdCBiYWNrZW5kKVxuICAgKiBiZWZvcmUgdGhlIGFjcXVpc2l0aW9uIHN1Y2NlZWRzLlxuICAgKlxuICAgKiBgb3duZXJzQnlOYW1lYCBtYXBzIGVhY2ggaGVsZCBsb2NrIG5hbWUgdG8gdGhlIGRyaXZlciBpbnN0YW5jZSB0aGF0XG4gICAqIGFjcXVpcmVkIGl0IHNvIGByZWxlYXNlQWR2aXNvcnlMb2NrYCBjYW4gcmVqZWN0IHJlbGVhc2VzIGZyb20gZHJpdmVyc1xuICAgKiB0aGF0IGRvIG5vdCBvd24gdGhlIGxvY2suXG4gICAqIEB0eXBlIHt7b3duZXJzQnlOYW1lOiBNYXA8c3RyaW5nLCBWZWxvY2lvdXNEYXRhYmFzZURyaXZlcnNCYXNlPiwgd2FpdGVyc0J5TmFtZTogTWFwPHN0cmluZywgQXJyYXk8KCkgPT4gdm9pZD4+fX1cbiAgICovXG4gIHN0YXRpYyBfYWR2aXNvcnlMb2NrU3RhdGUgPSB7XG4gICAgb3duZXJzQnlOYW1lOiBuZXcgTWFwKCksXG4gICAgd2FpdGVyc0J5TmFtZTogbmV3IE1hcCgpXG4gIH1cblxuICAvKipcbiAgICogSWQgc2VxLlxuICAgKiBAdHlwZSB7bnVtYmVyIHwgdW5kZWZpbmVkfSAqL1xuICBpZFNlcSA9IHVuZGVmaW5lZFxuICAvKipcbiAgICogTmFycm93cyB0aGUgcnVudGltZSB2YWx1ZSB0byB0aGUgZG9jdW1lbnRlZCB0eXBlLlxuICAgKiBAdHlwZSB7VHJhbnNhY3Rpb25DYWxsYmFja0ZyYW1lW119ICovXG4gIF90cmFuc2FjdGlvbkNhbGxiYWNrRnJhbWVzXG4gIC8qKiBAdHlwZSB7UHJvbWlzZTx2b2lkPn0gKi9cbiAgX3RyYW5zYWN0aW9uQ29tcGxldGlvblByb21pc2VcbiAgLyoqIEB0eXBlIHsoKCkgPT4gdm9pZCkgfCB1bmRlZmluZWR9ICovXG4gIF9yZXNvbHZlVHJhbnNhY3Rpb25Db21wbGV0aW9uXG4gIC8qKlxuICAgKiBOYXJyb3dzIHRoZSBydW50aW1lIHZhbHVlIHRvIHRoZSBkb2N1bWVudGVkIHR5cGUuXG4gICAqIEB0eXBlIHtNYXA8c3RyaW5nLCBQcm9taXNlPFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pj59ICovXG4gIF9zY2hlbWFDYWNoZVxuICAvKipcbiAgICogTmFycm93cyB0aGUgcnVudGltZSB2YWx1ZSB0byB0aGUgZG9jdW1lbnRlZCB0eXBlLlxuICAgKiBAdHlwZSB7KCgpID0+IHZvaWQpIHwgdW5kZWZpbmVkfSAqL1xuICBfc2NoZW1hQ2FjaGVJbnZhbGlkYXRvclxuICAvKipcbiAgICogTmFycm93cyB0aGUgcnVudGltZSB2YWx1ZSB0byB0aGUgZG9jdW1lbnRlZCB0eXBlLlxuICAgKiBAdHlwZSB7c3RyaW5nIHwgdW5kZWZpbmVkfSAqL1xuICBfY29ubmVjdGlvbkNoZWNrb3V0TmFtZVxuICAvKiogQHR5cGUge3N0cmluZyB8IHVuZGVmaW5lZH0gKi9cbiAgX2RhdGFiYXNlSWRlbnRpZmllclxuICAvKiogQHR5cGUge3N0cmluZyB8IHVuZGVmaW5lZH0gKi9cbiAgX2RhdGFiYXNlSWRlbnRpdHlGaW5nZXJwcmludFxuICAvKipcbiAgICogQWN0aXZlIHF1ZXJ5LlxuICAgKiBAdHlwZSB7QWN0aXZlUXVlcnlTdGF0ZSB8IG51bGx9ICovXG4gIF9hY3RpdmVRdWVyeSA9IG51bGxcbiAgLyoqIEB0eXBlIHtXZWFrTWFwPEVycm9yLCB7c3FsRmluZ2VycHJpbnQ6IHN0cmluZywgc3FsT3BlcmF0aW9uOiBzdHJpbmd9Pn0gKi9cbiAgX2ZhaWxlZFF1ZXJ5RGlhZ25vc3RpY3MgPSBuZXcgV2Vha01hcCgpXG4gIC8qKiBAdHlwZSB7TWFwPHN0cmluZywgbnVtYmVyPn0gKi9cbiAgX2hlbGRBZHZpc29yeUxvY2tzID0gbmV3IE1hcCgpXG4gIC8qKlxuICAgKiBXaGVuIGVhY2ggdHJhY2tlZCBhZHZpc29yeSBsb2NrIHdhcyBmaXJzdCBhY3F1aXJlZCwgc28gdGhlIGZpbmFsIHJlbGVhc2UgY2FuXG4gICAqIHJlcG9ydCBhIGhvbGQgdGhhdCBvdXRsaXZlZCBgYWR2aXNvcnlMb2NrVGVsZW1ldHJ5LnNsb3dIb2xkTXNgLlxuICAgKiBAdHlwZSB7TWFwPHN0cmluZywgbnVtYmVyPn1cbiAgICovXG4gIF9hZHZpc29yeUxvY2tBY3F1aXJlZEF0QnlOYW1lID0gbmV3IE1hcCgpXG4gIC8qKlxuICAgKiBTdGFibGUgcGVyLWNvbm5lY3Rpb24gaG9sZGVyIGlkZW50aXR5IHVzZWQgYnkgYWR2aXNvcnktbG9jayB0ZWxlbWV0cnkgd2hlblxuICAgKiB0aGUgdGllciBjYW4gb25seSBuYW1lIGxvY2FsIGhvbGRlcnMuXG4gICAqIEB0eXBlIHtzdHJpbmcgfCB1bmRlZmluZWR9XG4gICAqL1xuICBfYWR2aXNvcnlMb2NrSG9sZGVySWQgPSB1bmRlZmluZWRcbiAgLyoqXG4gICAqIEV4Y2x1c2l2ZSBvcGVyYXRpb24gbGVhc2UgaW5zdGFsbGVkIGJ5IGEgc2luZ2xlLW11bHRpLXVzZSBwb29sLlxuICAgKiBAdHlwZSB7aW1wb3J0KFwiLi4vb3BlcmF0aW9uLWxlYXNlLmpzXCIpLmRlZmF1bHQgfCB1bmRlZmluZWR9XG4gICAqL1xuICBfb3BlcmF0aW9uTGVhc2UgPSB1bmRlZmluZWRcblxuICAvKipcbiAgICogUnVucyBjb25zdHJ1Y3Rvci5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi8uLi9jb25maWd1cmF0aW9uLXR5cGVzLmpzXCIpLkRhdGFiYXNlQ29uZmlndXJhdGlvblR5cGV9IGNvbmZpZyAtIENvbmZpZ3VyYXRpb24gb2JqZWN0LlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uLy4uL2NvbmZpZ3VyYXRpb24uanNcIikuZGVmYXVsdH0gY29uZmlndXJhdGlvbiAtIENvbmZpZ3VyYXRpb24gaW5zdGFuY2UuXG4gICAqL1xuICBjb25zdHJ1Y3Rvcihjb25maWcsIGNvbmZpZ3VyYXRpb24pIHtcbiAgICB0aGlzLl9hcmdzID0gY29uZmlnXG4gICAgdGhpcy5jb25maWd1cmF0aW9uID0gY29uZmlndXJhdGlvblxuICAgIHRoaXMubXV0ZXggPSBuZXcgTXV0ZXgoKSAvLyBDYW4gYmUgdXNlZCB0byBsb2NrIHRoaXMgaW5zdGFuY2UgZm9yIGV4Y2x1c2l2ZSB1c2VcbiAgICB0aGlzLmxvZ2dlciA9IG5ldyBMb2dnZXIodGhpcylcbiAgICB0aGlzLl90cmFuc2FjdGlvbkNhbGxiYWNrRnJhbWVzID0gW11cbiAgICB0aGlzLl90cmFuc2FjdGlvbnNDb3VudCA9IDBcbiAgICB0aGlzLl90cmFuc2FjdGlvbkNvbXBsZXRpb25Qcm9taXNlID0gUHJvbWlzZS5yZXNvbHZlKClcbiAgICB0aGlzLl9yZXNvbHZlVHJhbnNhY3Rpb25Db21wbGV0aW9uID0gdW5kZWZpbmVkXG4gICAgdGhpcy5fdHJhbnNhY3Rpb25zQWN0aW9uc011dGV4ID0gbmV3IE11dGV4KClcbiAgICB0aGlzLl9waHlzaWNhbENvbm5lY3Rpb25NdXRleCA9IG5ldyBNdXRleCgpXG4gICAgdGhpcy5fc2NoZW1hQ2FjaGUgPSBuZXcgTWFwKClcbiAgfVxuXG4gIC8qKlxuICAgKiBTZXJpYWxpemVzIGFjY2VzcyB0byBvbmUgcGh5c2ljYWwgZGF0YWJhc2Ugc2Vzc2lvbi5cbiAgICogQHRlbXBsYXRlIFRcbiAgICogQHBhcmFtIHsoKSA9PiBQcm9taXNlPFQ+fSBjYWxsYmFjayAtIFBoeXNpY2FsIGRyaXZlciBvcGVyYXRpb24uXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPFQ+fSAtIE9wZXJhdGlvbiByZXN1bHQuXG4gICAqL1xuICBhc3luYyBfcnVuUGh5c2ljYWxDb25uZWN0aW9uUmVxdWVzdChjYWxsYmFjaykge1xuICAgIHJldHVybiBhd2FpdCB0aGlzLl9waHlzaWNhbENvbm5lY3Rpb25NdXRleC5zeW5jKGFzeW5jICgpID0+IHtcbiAgICAgIHJldHVybiBhd2FpdCBydW5XaXRob3V0U2hhcmVkVHJhbnNhY3Rpb25Db29yZGluYXRvck93bmVyKHRoaXMsIGNhbGxiYWNrKVxuICAgIH0pXG4gIH1cblxuICAvKipcbiAgICogQ2xlYW5zIGRyaXZlci1zcGVjaWZpYyBzZXNzaW9uIHN0YXRlIGJlZm9yZSB0aGlzIGxvZ2ljYWwgY29ubmVjdGlvbiBpcyByZXVzYWJsZS5cbiAgICogRHJpdmVycyB3aG9zZSBwaHlzaWNhbCBzZXNzaW9ucyBjYW5ub3QgYmUgc2FmZWx5IHJlc2V0IHNob3VsZCBkaXNwb3NlIHRoZW0gaGVyZS5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgd2hlbiB0aGUgbmV4dCBjaGVja291dCBjYW5ub3Qgb2JzZXJ2ZSBwcmlvciBzZXNzaW9uIHN0YXRlLlxuICAgKi9cbiAgYXN5bmMgY2xlYW51cFNlc3Npb25TdGF0ZUFmdGVyQ2hlY2tvdXQoKSB7fVxuXG4gIC8qKlxuICAgKiBSdW5zIGFkZCBmb3JlaWduIGtleS5cbiAgICogQHBhcmFtIHtzdHJpbmd9IHRhYmxlTmFtZSAtIFRhYmxlIG5hbWUuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBjb2x1bW5OYW1lIC0gQ29sdW1uIG5hbWUuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSByZWZlcmVuY2VkVGFibGVOYW1lIC0gUmVmZXJlbmNlZCB0YWJsZSBuYW1lLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gcmVmZXJlbmNlZENvbHVtbk5hbWUgLSBSZWZlcmVuY2VkIGNvbHVtbiBuYW1lLlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIE9wdGlvbnMgb2JqZWN0LlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyB3aGVuIGNvbXBsZXRlLlxuICAgKi9cbiAgYXN5bmMgYWRkRm9yZWlnbktleSh0YWJsZU5hbWUsIGNvbHVtbk5hbWUsIHJlZmVyZW5jZWRUYWJsZU5hbWUsIHJlZmVyZW5jZWRDb2x1bW5OYW1lLCBhcmdzKSB7XG4gICAgdGhpcy5fYXNzZXJ0Tm90UmVhZE9ubHkoKVxuICAgIGNvbnN0IHRhYmxlRm9yZWlnbktleUFyZ3MgPSBPYmplY3QuYXNzaWduKFxuICAgICAge1xuICAgICAgICBjb2x1bW5OYW1lLFxuICAgICAgICB0YWJsZU5hbWUsXG4gICAgICAgIHJlZmVyZW5jZWRDb2x1bW5OYW1lLFxuICAgICAgICByZWZlcmVuY2VkVGFibGVOYW1lXG4gICAgICB9LFxuICAgICAgYXJnc1xuICAgIClcbiAgICBjb25zdCB0YWJsZUZvcmVpZ25LZXkgPSBuZXcgVGFibGVGb3JlaWduS2V5KHRhYmxlRm9yZWlnbktleUFyZ3MpXG4gICAgY29uc3QgdGFibGVEYXRhID0gbmV3IFRhYmxlRGF0YSh0YWJsZU5hbWUpXG5cbiAgICB0YWJsZURhdGEuYWRkRm9yZWlnbktleSh0YWJsZUZvcmVpZ25LZXkpXG5cbiAgICBjb25zdCBhbHRlclRhYmxlU1FMcyA9IGF3YWl0IHRoaXMuYWx0ZXJUYWJsZVNRTHModGFibGVEYXRhKVxuXG4gICAgZm9yIChjb25zdCBhbHRlclRhYmxlU1FMIG9mIGFsdGVyVGFibGVTUUxzKSB7XG4gICAgICBhd2FpdCB0aGlzLnF1ZXJ5KGFsdGVyVGFibGVTUUwpXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgcmVtb3ZlIGZvcmVpZ24ga2V5LlxuICAgKiBAcGFyYW0ge3N0cmluZ30gdGFibGVOYW1lIC0gVGFibGUgbmFtZS5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL2Jhc2UtZm9yZWlnbi1rZXkuanNcIikuZGVmYXVsdH0gZm9yZWlnbktleU1ldGFkYXRhIC0gRm9yZWlnbiBrZXkgbWV0YWRhdGEuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIHdoZW4gY29tcGxldGUuXG4gICAqL1xuICBhc3luYyByZW1vdmVGb3JlaWduS2V5KHRhYmxlTmFtZSwgZm9yZWlnbktleU1ldGFkYXRhKSB7XG4gICAgdGhpcy5fYXNzZXJ0Tm90UmVhZE9ubHkoKVxuXG4gICAgY29uc3QgdGFibGVGb3JlaWduS2V5ID0gbmV3IFRhYmxlRm9yZWlnbktleSh7XG4gICAgICBjb2x1bW5OYW1lOiBmb3JlaWduS2V5TWV0YWRhdGEuZ2V0Q29sdW1uTmFtZSgpLFxuICAgICAgZHJvcEZvcmVpZ25LZXk6IHRydWUsXG4gICAgICBuYW1lOiBmb3JlaWduS2V5TWV0YWRhdGEuZ2V0TmFtZSgpLFxuICAgICAgcmVmZXJlbmNlZENvbHVtbk5hbWU6IGZvcmVpZ25LZXlNZXRhZGF0YS5nZXRSZWZlcmVuY2VkQ29sdW1uTmFtZSgpLFxuICAgICAgcmVmZXJlbmNlZFRhYmxlTmFtZTogZm9yZWlnbktleU1ldGFkYXRhLmdldFJlZmVyZW5jZWRUYWJsZU5hbWUoKSxcbiAgICAgIHRhYmxlTmFtZVxuICAgIH0pXG4gICAgY29uc3QgdGFibGVEYXRhID0gbmV3IFRhYmxlRGF0YSh0YWJsZU5hbWUpXG5cbiAgICB0YWJsZURhdGEuYWRkRm9yZWlnbktleSh0YWJsZUZvcmVpZ25LZXkpXG5cbiAgICBjb25zdCBhbHRlclRhYmxlU1FMcyA9IGF3YWl0IHRoaXMuYWx0ZXJUYWJsZVNRTHModGFibGVEYXRhKVxuXG4gICAgZm9yIChjb25zdCBhbHRlclRhYmxlU1FMIG9mIGFsdGVyVGFibGVTUUxzKSB7XG4gICAgICBhd2FpdCB0aGlzLnF1ZXJ5KGFsdGVyVGFibGVTUUwpXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgYWx0ZXIgdGFibGUgc3Fscy5cbiAgICogQGFic3RyYWN0XG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vdGFibGUtZGF0YS9pbmRleC5qc1wiKS5kZWZhdWx0fSBfdGFibGVEYXRhIC0gVGFibGUgZGF0YS5cbiAgICogQHJldHVybnMge1Byb21pc2U8c3RyaW5nW10+fSAtIFJlc29sdmVzIHdpdGggU1FMIHN0YXRlbWVudHMuXG4gICAqL1xuICBhbHRlclRhYmxlU1FMcyhfdGFibGVEYXRhKSB7XG4gICAgdGhyb3cgbmV3IEVycm9yKFwiYWx0ZXJUYWJsZVNRTHMgbm90IGltcGxlbWVudGVkXCIpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBjb25uZWN0LlxuICAgKiBAYWJzdHJhY3RcbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgd2hlbiBjb21wbGV0ZS5cbiAgICovXG4gIGNvbm5lY3QoKSB7XG4gICAgdGhyb3cgbmV3IEVycm9yKFwiJ2Nvbm5lY3QnIG5vdCBpbXBsZW1lbnRlZFwiKVxuICB9XG5cbiAgLyoqXG4gICAqIFJlbGVhc2VzIHRyYWNrZWQgYWR2aXNvcnkgbG9ja3MgYW5kIGNsb3NlcyB0aGUgcGh5c2ljYWwgZGF0YWJhc2UgY29ubmVjdGlvbi5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgd2hlbiBjbGVhbnVwIGFuZCBjbG9zZSBjb21wbGV0ZS5cbiAgICovXG4gIGFzeW5jIGNsb3NlKCkge1xuICAgIC8qKiBAdHlwZSB7RXJyb3IgfCB1bmRlZmluZWR9ICovXG4gICAgbGV0IGFkdmlzb3J5TG9ja0Vycm9yXG5cbiAgICB0cnkge1xuICAgICAgYXdhaXQgdGhpcy5yZWxlYXNlSGVsZEFkdmlzb3J5TG9ja3MoKVxuICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICBhZHZpc29yeUxvY2tFcnJvciA9IGVycm9yIGluc3RhbmNlb2YgRXJyb3IgPyBlcnJvciA6IG5ldyBFcnJvcihcIkZhaWxlZCB0byByZWxlYXNlIGhlbGQgYWR2aXNvcnkgbG9ja3NcIiwge2NhdXNlOiBlcnJvcn0pXG4gICAgfVxuXG4gICAgdHJ5IHtcbiAgICAgIGF3YWl0IHRoaXMuX2Nsb3NlKClcbiAgICAgIHRoaXMuX2hlbGRBZHZpc29yeUxvY2tzLmNsZWFyKClcbiAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgY29uc3QgY2xvc2VFcnJvciA9IGVycm9yIGluc3RhbmNlb2YgRXJyb3IgPyBlcnJvciA6IG5ldyBFcnJvcihcIkZhaWxlZCB0byBjbG9zZSBkYXRhYmFzZSBjb25uZWN0aW9uXCIsIHtjYXVzZTogZXJyb3J9KVxuXG4gICAgICBpZiAoYWR2aXNvcnlMb2NrRXJyb3IpIHtcbiAgICAgICAgdGhyb3cgbmV3IEFnZ3JlZ2F0ZUVycm9yKFthZHZpc29yeUxvY2tFcnJvciwgY2xvc2VFcnJvcl0sIFwiRmFpbGVkIHRvIHJlbGVhc2UgYWR2aXNvcnkgbG9ja3MgYW5kIGNsb3NlIGRhdGFiYXNlIGNvbm5lY3Rpb25cIiwge2NhdXNlOiBlcnJvcn0pXG4gICAgICB9XG5cbiAgICAgIHRocm93IGNsb3NlRXJyb3JcbiAgICB9XG5cbiAgICBpZiAoYWR2aXNvcnlMb2NrRXJyb3IpIHRocm93IGFkdmlzb3J5TG9ja0Vycm9yXG4gIH1cblxuICAvKipcbiAgICogRHJpdmVyLXNwZWNpZmljIHBoeXNpY2FsIGNsb3NlIGhvb2suXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIHdoZW4gdGhlIHVuZGVybHlpbmcgY29ubmVjdGlvbiBjbG9zZXMuXG4gICAqL1xuICBhc3luYyBfY2xvc2UoKSB7XG4gICAgLy8gTm8tb3AgYnkgZGVmYXVsdFxuICB9XG5cbiAgLyoqXG4gICAqIEZsdXNoZXMgcGVuZGluZyB3cml0ZXMgdGhhdCB0aGUgZHJpdmVyIGRlbGF5ZWQgZm9yIHBlcnNpc3RlbmNlLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyB3aGVuIHBlbmRpbmcgd3JpdGVzIGFyZSBkdXJhYmxlLlxuICAgKi9cbiAgYXN5bmMgZmx1c2hQZW5kaW5nV3JpdGVzKCkge1xuICAgIC8vIE5vLW9wIGJ5IGRlZmF1bHRcbiAgfVxuXG4gIC8qKlxuICAgKiBSZXR1cm5zIHdoZXRoZXIgZGVsYXllZCBwZXJzaXN0ZW5jZSB3cml0ZXMgcmVtYWluLlxuICAgKiBAcmV0dXJucyB7Ym9vbGVhbn0gLSBXaGV0aGVyIHdyaXRlcyByZW1haW4uXG4gICAqL1xuICBoYXNQZW5kaW5nV3JpdGVzKCkgeyByZXR1cm4gZmFsc2UgfVxuXG4gIC8qKlxuICAgKiBEZWxldGVzIHRoaXMgZHJpdmVyJ3MgcGh5c2ljYWwgZGF0YWJhc2Ugc3RvcmFnZSB3aXRob3V0IG9wZW5pbmcgaXQuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIGFmdGVyIGRlbGV0aW9uLlxuICAgKi9cbiAgYXN5bmMgZGVsZXRlRGF0YWJhc2VTdG9yYWdlKCkgeyB0aHJvdyBuZXcgRXJyb3IoYERhdGFiYXNlIHN0b3JhZ2UgZGVsZXRpb24gaXMgbm90IHN1cHBvcnRlZCBieSAke3RoaXMuY29uc3RydWN0b3IubmFtZX1gKSB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgc2V0IGNvbm5lY3Rpb24gY2hlY2tvdXQgbmFtZS5cbiAgICogQHBhcmFtIHtzdHJpbmcgfCB1bmRlZmluZWR9IG5hbWUgLSBIdW1hbi1yZWFkYWJsZSBuYW1lIGZvciB0aGlzIGFjdGl2ZSBjaGVja291dC5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgd2hlbiBjb21wbGV0ZS5cbiAgICovXG4gIGFzeW5jIHNldENvbm5lY3Rpb25DaGVja291dE5hbWUobmFtZSkge1xuICAgIHRoaXMuX2Nvbm5lY3Rpb25DaGVja291dE5hbWUgPSBuYW1lXG4gICAgdGhpcy5fY29ubmVjdGlvbkNoZWNrZWRPdXRBdFVuaXhNcyA9IERhdGUubm93KClcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGNsZWFyIGNvbm5lY3Rpb24gY2hlY2tvdXQgbmFtZS5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgd2hlbiBjb21wbGV0ZS5cbiAgICovXG4gIGFzeW5jIGNsZWFyQ29ubmVjdGlvbkNoZWNrb3V0TmFtZSgpIHtcbiAgICB0aGlzLl9jb25uZWN0aW9uQ2hlY2tvdXROYW1lID0gdW5kZWZpbmVkXG4gICAgdGhpcy5fY29ubmVjdGlvbkNoZWNrZWRPdXRBdFVuaXhNcyA9IHVuZGVmaW5lZFxuICB9XG5cbiAgLyoqXG4gICAqIFNldHMgdGhlIHBvb2wtb3duZWQgaWRlbnRpdHkgdXNlZCBieSBzYWZlIGRhdGFiYXNlIGRpYWdub3N0aWNzLlxuICAgKiBAcGFyYW0ge3tkYXRhYmFzZUlkZW50aWZpZXI6IHN0cmluZywgZGF0YWJhc2VJZGVudGl0eUZpbmdlcnByaW50OiBzdHJpbmd9fSBpZGVudGl0eSAtIFBvb2wtc3RhbXBlZCBpZGVudGl0eSByZWRhY3RlZCBhdCBkaWFnbm9zdGljIHNuYXBzaG90IHRpbWUuXG4gICAqIEByZXR1cm5zIHt2b2lkfVxuICAgKi9cbiAgc2V0UG9vbERpYWdub3N0aWNJZGVudGl0eSh7ZGF0YWJhc2VJZGVudGlmaWVyLCBkYXRhYmFzZUlkZW50aXR5RmluZ2VycHJpbnR9KSB7XG4gICAgdGhpcy5fZGF0YWJhc2VJZGVudGlmaWVyID0gZGF0YWJhc2VJZGVudGlmaWVyXG4gICAgdGhpcy5fZGF0YWJhc2VJZGVudGl0eUZpbmdlcnByaW50ID0gZGF0YWJhc2VJZGVudGl0eUZpbmdlcnByaW50XG4gIH1cblxuICAvKipcbiAgICogUnVucyByZWNvbm5lY3QuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIHdoZW4gY29tcGxldGUuXG4gICAqL1xuICBhc3luYyByZWNvbm5lY3QoKSB7XG4gICAgdGhpcy5jbGVhclNjaGVtYUNhY2hlKClcbiAgICBhd2FpdCB0aGlzLmNsb3NlKClcbiAgICBhd2FpdCB0aGlzLmNvbm5lY3QoKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgY3JlYXRlIGRhdGFiYXNlIHNxbC5cbiAgICogQGFic3RyYWN0XG4gICAqIEBwYXJhbSB7c3RyaW5nfSBkYXRhYmFzZU5hbWUgLSBEYXRhYmFzZSBuYW1lLlxuICAgKiBAcGFyYW0ge29iamVjdH0gW2FyZ3NdIC0gT3B0aW9ucyBvYmplY3QuXG4gICAqIEBwYXJhbSB7Ym9vbGVhbn0gW2FyZ3MuaWZOb3RFeGlzdHNdIC0gV2hldGhlciBpZiBub3QgZXhpc3RzLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gW2FyZ3MuZGF0YWJhc2VDaGFyc2V0XSAtIERhdGFiYXNlLWRlZmF1bHQgY2hhcmFjdGVyIHNldCAoZHJpdmVyLXNwZWNpZmljOyBteXNxbC9tYXJpYWRiKS5cbiAgICogQHBhcmFtIHtzdHJpbmd9IFthcmdzLmRhdGFiYXNlQ29sbGF0aW9uXSAtIERhdGFiYXNlLWRlZmF1bHQgY29sbGF0aW9uIChkcml2ZXItc3BlY2lmaWM7IG15c3FsL21hcmlhZGIpLlxuICAgKiBAcmV0dXJucyB7c3RyaW5nW119IC0gU1FMIHN0YXRlbWVudHMuXG4gICAqL1xuICBjcmVhdGVEYXRhYmFzZVNxbChkYXRhYmFzZU5hbWUsIGFyZ3MpIHsgdGhyb3cgbmV3IEVycm9yKFwiJ2NyZWF0ZURhdGFiYXNlU3FsJyBub3QgaW1wbGVtZW50ZWRcIikgfSAvLyBlc2xpbnQtZGlzYWJsZS1saW5lIG5vLXVudXNlZC12YXJzXG5cbiAgLyoqXG4gICAqIFJ1bnMgZHJvcCBkYXRhYmFzZSBzcWwuXG4gICAqIEBhYnN0cmFjdFxuICAgKiBAcGFyYW0ge3N0cmluZ30gZGF0YWJhc2VOYW1lIC0gRGF0YWJhc2UgbmFtZS5cbiAgICogQHBhcmFtIHtvYmplY3R9IFthcmdzXSAtIE9wdGlvbnMgb2JqZWN0LlxuICAgKiBAcGFyYW0ge2Jvb2xlYW59IFthcmdzLmlmRXhpc3RzXSAtIFdoZXRoZXIgaWYgZXhpc3RzLlxuICAgKiBAcmV0dXJucyB7c3RyaW5nW119IC0gU1FMIHN0YXRlbWVudHMuXG4gICAqL1xuICBkcm9wRGF0YWJhc2VTcWwoZGF0YWJhc2VOYW1lLCBhcmdzKSB7IHRocm93IG5ldyBFcnJvcihcIidkcm9wRGF0YWJhc2VTcWwnIG5vdCBpbXBsZW1lbnRlZFwiKSB9IC8vIGVzbGludC1kaXNhYmxlLWxpbmUgbm8tdW51c2VkLXZhcnNcblxuICAvKipcbiAgICogUnVucyBjcmVhdGUgaW5kZXggc3Fscy5cbiAgICogQGFic3RyYWN0XG4gICAqIEBwYXJhbSB7Q3JlYXRlSW5kZXhTcWxBcmdzfSBpbmRleERhdGEgLSBJbmRleCBkYXRhLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxzdHJpbmdbXT59IC0gUmVzb2x2ZXMgd2l0aCBTUUwgc3RhdGVtZW50cy5cbiAgICovXG4gIGFzeW5jIGNyZWF0ZUluZGV4U1FMcyhpbmRleERhdGEpIHsgLy8gZXNsaW50LWRpc2FibGUtbGluZSBuby11bnVzZWQtdmFyc1xuICAgIHRocm93IG5ldyBFcnJvcihcIidjcmVhdGVJbmRleFNRTHMnIG5vdCBpbXBsZW1lbnRlZFwiKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgcmVtb3ZlIGluZGV4IHNxbHMuXG4gICAqIEBhYnN0cmFjdFxuICAgKiBAcGFyYW0ge1JlbW92ZUluZGV4U3FsQXJnc30gaW5kZXhEYXRhIC0gSW5kZXggZGF0YS5cbiAgICogQHJldHVybnMge1Byb21pc2U8c3RyaW5nW10+fSAtIFJlc29sdmVzIHdpdGggU1FMIHN0YXRlbWVudHMuXG4gICAqL1xuICBhc3luYyByZW1vdmVJbmRleFNRTHMoaW5kZXhEYXRhKSB7IC8vIGVzbGludC1kaXNhYmxlLWxpbmUgbm8tdW51c2VkLXZhcnNcbiAgICB0aHJvdyBuZXcgRXJyb3IoXCIncmVtb3ZlSW5kZXhTUUxzJyBub3QgaW1wbGVtZW50ZWRcIilcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGNyZWF0ZSB0YWJsZS5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi90YWJsZS1kYXRhL2luZGV4LmpzXCIpLmRlZmF1bHR9IHRhYmxlRGF0YSAtIFRhYmxlIGRhdGEuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIHdoZW4gY29tcGxldGUuXG4gICAqL1xuICBhc3luYyBjcmVhdGVUYWJsZSh0YWJsZURhdGEpIHtcbiAgICB0aGlzLl9hc3NlcnROb3RSZWFkT25seSgpXG4gICAgY29uc3Qgc3FscyA9IGF3YWl0IHRoaXMuY3JlYXRlVGFibGVTcWwodGFibGVEYXRhKVxuXG4gICAgZm9yIChjb25zdCBzcWwgb2Ygc3Fscykge1xuICAgICAgYXdhaXQgdGhpcy5xdWVyeShzcWwpXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgY3JlYXRlIHRhYmxlIHNxbC5cbiAgICogQGFic3RyYWN0XG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vdGFibGUtZGF0YS9pbmRleC5qc1wiKS5kZWZhdWx0fSB0YWJsZURhdGEgLSBUYWJsZSBkYXRhLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxzdHJpbmdbXT59IC0gUmVzb2x2ZXMgd2l0aCBTUUwgc3RhdGVtZW50cy5cbiAgICovXG4gIGFzeW5jIGNyZWF0ZVRhYmxlU3FsKHRhYmxlRGF0YSkgeyAvLyBlc2xpbnQtZGlzYWJsZS1saW5lIG5vLXVudXNlZC12YXJzXG4gICAgdGhyb3cgbmV3IEVycm9yKFwiJ2NyZWF0ZVRhYmxlU3FsJyBub3QgaW1wbGVtZW50ZWRcIilcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGRlbGV0ZS5cbiAgICogQHBhcmFtIHtEZWxldGVTcWxBcmdzVHlwZX0gYXJncyAtIE9wdGlvbnMgb2JqZWN0LlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyB3aGVuIGNvbXBsZXRlLlxuICAgKi9cbiAgYXN5bmMgZGVsZXRlKGFyZ3MpIHtcbiAgICB0aGlzLl9hc3NlcnROb3RSZWFkT25seSgpXG4gICAgY29uc3Qgc3FsID0gdGhpcy5kZWxldGVTcWwoYXJncylcblxuICAgIGF3YWl0IHRoaXMucXVlcnkoc3FsKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZGVsZXRlIHNxbC5cbiAgICogQGFic3RyYWN0XG4gICAqIEBwYXJhbSB7RGVsZXRlU3FsQXJnc1R5cGV9IGFyZ3MgLSBPcHRpb25zIG9iamVjdC5cbiAgICogQHJldHVybnMge3N0cmluZ30gLSBTUUwgc3RyaW5nLlxuICAgKi9cbiAgZGVsZXRlU3FsKGFyZ3MpIHsgLy8gZXNsaW50LWRpc2FibGUtbGluZSBuby11bnVzZWQtdmFyc1xuICAgIHRocm93IG5ldyBFcnJvcihgJ2RlbGV0ZVNxbCcgbm90IGltcGxlbWVudGVkYClcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGRyb3AgdGFibGUuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSB0YWJsZU5hbWUgLSBUYWJsZSBuYW1lLlxuICAgKiBAcGFyYW0ge0Ryb3BUYWJsZVNxbEFyZ3NUeXBlfSBbYXJnc10gLSBPcHRpb25zIG9iamVjdC5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgd2hlbiBjb21wbGV0ZS5cbiAgICovXG4gIGFzeW5jIGRyb3BUYWJsZSh0YWJsZU5hbWUsIGFyZ3MpIHtcbiAgICB0aGlzLl9hc3NlcnROb3RSZWFkT25seSgpXG4gICAgY29uc3Qgc3FscyA9IGF3YWl0IHRoaXMuZHJvcFRhYmxlU1FMcyh0YWJsZU5hbWUsIGFyZ3MpXG5cbiAgICBmb3IgKGNvbnN0IHNxbCBvZiBzcWxzKSB7XG4gICAgICBhd2FpdCB0aGlzLnF1ZXJ5KHNxbClcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogUnVucyBkcm9wIHRhYmxlIHNxbHMuXG4gICAqIEBhYnN0cmFjdFxuICAgKiBAcGFyYW0ge3N0cmluZ30gdGFibGVOYW1lIC0gVGFibGUgbmFtZS5cbiAgICogQHBhcmFtIHtEcm9wVGFibGVTcWxBcmdzVHlwZX0gW2FyZ3NdIC0gT3B0aW9ucyBvYmplY3QuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHN0cmluZ1tdPn0gLSBSZXNvbHZlcyB3aXRoIFNRTCBzdGF0ZW1lbnRzLlxuICAgKi9cbiAgYXN5bmMgZHJvcFRhYmxlU1FMcyh0YWJsZU5hbWUsIGFyZ3MpIHsgLy8gZXNsaW50LWRpc2FibGUtbGluZSBuby11bnVzZWQtdmFyc1xuICAgIHRocm93IG5ldyBFcnJvcihcImRyb3BUYWJsZVNRTHMgbm90IGltcGxlbWVudGVkXCIpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBlc2NhcGUuXG4gICAqIEBhYnN0cmFjdFxuICAgKiBAcGFyYW0ge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSB2YWx1ZSAtIFZhbHVlIHRvIHVzZS5cbiAgICogQHJldHVybnMge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSAtIFRoZSBlc2NhcGUuXG4gICAqL1xuICBlc2NhcGUodmFsdWUpIHsgLy8gZXNsaW50LWRpc2FibGUtbGluZSBuby11bnVzZWQtdmFyc1xuICAgIHRocm93IG5ldyBFcnJvcihcIidlc2NhcGUnIG5vdCBpbXBsZW1lbnRlZFwiKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZ2V0IGFyZ3MuXG4gICAqIEByZXR1cm5zIHtpbXBvcnQoXCIuLi8uLi9jb25maWd1cmF0aW9uLXR5cGVzLmpzXCIpLkRhdGFiYXNlQ29uZmlndXJhdGlvblR5cGV9IC0gVGhlIGFyZ3MuXG4gICAqL1xuICBnZXRBcmdzKCkge1xuICAgIHJldHVybiB0aGlzLl9hcmdzXG4gIH1cblxuICAvKipcbiAgICogUnVucyBnZXQgY29uZmlndXJhdGlvbi5cbiAgICogQHJldHVybnMge2ltcG9ydChcIi4uLy4uL2NvbmZpZ3VyYXRpb24uanNcIikuZGVmYXVsdH0gLSBUaGUgY29uZmlndXJhdGlvbi5cbiAgICovXG4gIGdldENvbmZpZ3VyYXRpb24oKSB7XG4gICAgaWYgKCF0aGlzLmNvbmZpZ3VyYXRpb24pIHRocm93IG5ldyBFcnJvcihcIk5vIGNvbmZpZ3VyYXRpb24gc2V0XCIpXG5cbiAgICByZXR1cm4gdGhpcy5jb25maWd1cmF0aW9uXG4gIH1cblxuICAvKipcbiAgICogSW5zdGFsbHMgYW4gb3BlcmF0aW9uIGxlYXNlIGF0b21pY2FsbHkgd2l0aCBvcmRpbmFyeSB0cmFuc2FjdGlvbiBhZG1pc3Npb24uXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vb3BlcmF0aW9uLWxlYXNlLmpzXCIpLmRlZmF1bHR9IG9wZXJhdGlvbkxlYXNlIC0gQWN0aXZlIGxlYXNlLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyBvbmNlIHRoZSBsZWFzZSBvd25zIHRyYW5zYWN0aW9uIGFkbWlzc2lvbi5cbiAgICovXG4gIGFzeW5jIHNldE9wZXJhdGlvbkxlYXNlKG9wZXJhdGlvbkxlYXNlKSB7XG4gICAgYXdhaXQgdGhpcy5fdHJhbnNhY3Rpb25zQWN0aW9uc011dGV4LnN5bmMoYXN5bmMgKCkgPT4ge1xuICAgICAgaWYgKHRoaXMuX29wZXJhdGlvbkxlYXNlKSB0aHJvdyBuZXcgRXJyb3IoXCJBIGRhdGFiYXNlIG9wZXJhdGlvbiBsZWFzZSBpcyBhbHJlYWR5IGFjdGl2ZVwiKVxuICAgICAgaWYgKHRoaXMuX3RyYW5zYWN0aW9uc0NvdW50ID4gMCkge1xuICAgICAgICB0aHJvdyBuZXcgRXJyb3IoXCJDYW5ub3Qgc3RhcnQgYSBkYXRhYmFzZSBvcGVyYXRpb24gd2hpbGUgYW4gdW5yZWxhdGVkIG9yZGluYXJ5IHRyYW5zYWN0aW9uIGlzIGFscmVhZHkgYWN0aXZlXCIpXG4gICAgICB9XG5cbiAgICAgIHRoaXMuX29wZXJhdGlvbkxlYXNlID0gb3BlcmF0aW9uTGVhc2VcbiAgICB9KVxuICB9XG5cbiAgLyoqXG4gICAqIENsZWFycyB0aGUgbWF0Y2hpbmcgb3BlcmF0aW9uIGxlYXNlLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL29wZXJhdGlvbi1sZWFzZS5qc1wiKS5kZWZhdWx0fSBvcGVyYXRpb25MZWFzZSAtIExlYXNlIHRvIGNsZWFyLlxuICAgKiBAcmV0dXJucyB7dm9pZH1cbiAgICovXG4gIGNsZWFyT3BlcmF0aW9uTGVhc2Uob3BlcmF0aW9uTGVhc2UpIHtcbiAgICBpZiAodGhpcy5fb3BlcmF0aW9uTGVhc2UgIT09IG9wZXJhdGlvbkxlYXNlKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoXCJDYW5ub3QgY2xlYXIgYSBkYXRhYmFzZSBvcGVyYXRpb24gbGVhc2Ugb3duZWQgYnkgYW5vdGhlciBvcGVyYXRpb25cIilcbiAgICB9XG5cbiAgICB0aGlzLl9vcGVyYXRpb25MZWFzZSA9IHVuZGVmaW5lZFxuICB9XG5cbiAgLyoqXG4gICAqIFdhaXRzIGZvciBhbiB1bnJlbGF0ZWQgb3BlcmF0aW9uIGxlYXNlIHRvIHJlbGVhc2UuXG4gICAqIEBwYXJhbSB7c3ltYm9sIHwgdW5kZWZpbmVkfSBvcGVyYXRpb25Pd25lciAtIENhbmRpZGF0ZSBvcGVyYXRpb24gb3duZXIuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fVxuICAgKi9cbiAgYXN5bmMgX3dhaXRGb3JPcGVyYXRpb25MZWFzZShvcGVyYXRpb25Pd25lcikge1xuICAgIGNvbnN0IG9wZXJhdGlvbkxlYXNlID0gdGhpcy5fb3BlcmF0aW9uTGVhc2VcblxuICAgIGlmIChvcGVyYXRpb25MZWFzZSkgYXdhaXQgb3BlcmF0aW9uTGVhc2Uud2FpdChvcGVyYXRpb25Pd25lcilcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGdldCBpZCBzZXEuXG4gICAqIEByZXR1cm5zIHtudW1iZXIgfCB1bmRlZmluZWR9IC0gVGhlIGlkIHNlcS5cbiAgICovXG4gIGdldElkU2VxKCkge1xuICAgIHJldHVybiB0aGlzLmlkU2VxXG4gIH1cblxuICAvKipcbiAgICogUnVucyBwcmltYXJ5IGtleSB0eXBlLlxuICAgKiBAcmV0dXJucyB7c3RyaW5nfSAtIENvbmZpZ3VyZWQgcHJpbWFyeSBrZXkgdHlwZSwgZGVmYXVsdGluZyB0byBVVUlELlxuICAgKi9cbiAgcHJpbWFyeUtleVR5cGUoKSB7XG4gICAgcmV0dXJuIHRoaXMuZ2V0QXJncygpLnByaW1hcnlLZXlUeXBlIHx8IFwidXVpZFwiXG4gIH1cblxuICAvKipcbiAgICogQ2xlYXJzIGNhY2hlZCBzY2hlbWEgbWV0YWRhdGEgZm9yIHRoaXMgZHJpdmVyIGluc3RhbmNlLlxuICAgKiBAcmV0dXJucyB7dm9pZH0gLSBObyByZXR1cm4gdmFsdWUuXG4gICAqL1xuICBjbGVhclNjaGVtYUNhY2hlKCkge1xuICAgIGlmICh0aGlzLl9zY2hlbWFDYWNoZUludmFsaWRhdG9yKSB7XG4gICAgICB0aGlzLl9zY2hlbWFDYWNoZUludmFsaWRhdG9yKClcbiAgICAgIHJldHVyblxuICAgIH1cblxuICAgIHRoaXMuX2NsZWFyTG9jYWxTY2hlbWFDYWNoZSgpXG4gIH1cblxuICAvKipcbiAgICogQ2xlYXJzIG9ubHkgdGhlIG1ldGFkYXRhIGNhY2hlZCBvbiB0aGlzIGRyaXZlciBpbnN0YW5jZS5cbiAgICogQHJldHVybnMge3ZvaWR9IC0gTm8gcmV0dXJuIHZhbHVlLlxuICAgKi9cbiAgX2NsZWFyTG9jYWxTY2hlbWFDYWNoZSgpIHtcbiAgICB0aGlzLl9zY2hlbWFDYWNoZS5jbGVhcigpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBzZXQgc2NoZW1hIGNhY2hlIGludmFsaWRhdG9yLlxuICAgKiBAcGFyYW0geygpID0+IHZvaWR9IGludmFsaWRhdG9yIC0gQ2FsbGJhY2sgdXNlZCB0byBjbGVhciBzY2hlbWEgY2FjaGVzIHRoYXQgc2hhcmUgdGhpcyBkcml2ZXIgcG9vbC5cbiAgICogQHJldHVybnMge3ZvaWR9IC0gTm8gcmV0dXJuIHZhbHVlLlxuICAgKi9cbiAgc2V0U2NoZW1hQ2FjaGVJbnZhbGlkYXRvcihpbnZhbGlkYXRvcikge1xuICAgIHRoaXMuX3NjaGVtYUNhY2hlSW52YWxpZGF0b3IgPSBpbnZhbGlkYXRvclxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgc2NoZW1hIGNhY2hlIGVuYWJsZWQuXG4gICAqIEByZXR1cm5zIHtib29sZWFufSAtIFdoZXRoZXIgc2NoZW1hIG1ldGFkYXRhIGNhY2hpbmcgaXMgZW5hYmxlZC5cbiAgICovXG4gIF9zY2hlbWFDYWNoZUVuYWJsZWQoKSB7XG4gICAgcmV0dXJuIHRoaXMuZ2V0QXJncygpLnNjaGVtYUNhY2hlICE9PSBmYWxzZVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgc2NoZW1hIG1ldGFkYXRhIHJldHJ5IGRlYWRsaW5lIG1zLlxuICAgKiBAcmV0dXJucyB7bnVtYmVyfSAtIEJvdW5kZWQgZGVhZGxpbmUgZm9yIG91dGxhc3RpbmcgdHJhbnNpZW50IHNjaGVtYS1tZXRhZGF0YSBjb250ZW50aW9uLlxuICAgKi9cbiAgX3NjaGVtYU1ldGFkYXRhUmV0cnlEZWFkbGluZU1zKCkge1xuICAgIGNvbnN0IGNvbmZpZ3VyZWQgPSB0aGlzLmdldEFyZ3MoKS5zY2hlbWFNZXRhZGF0YVJldHJ5RGVhZGxpbmVNc1xuXG4gICAgcmV0dXJuIHR5cGVvZiBjb25maWd1cmVkID09PSBcIm51bWJlclwiID8gY29uZmlndXJlZCA6IFNDSEVNQV9NRVRBREFUQV9SRVRSWV9ERUFETElORV9NU1xuICB9XG5cbiAgLyoqXG4gICAqIFdoZXRoZXIgYW4gZXJyb3IgcmFpc2VkIGJ5IGEgc2NoZW1hLW1ldGFkYXRhIHJlYWQgaXMgdHJhbnNpZW50IGNvbnRlbnRpb24gdGhhdCBhIGJvdW5kZWRcbiAgICogcmV0cnkgY2FuIG91dGxhc3QuIERyaXZlcnMgb3ZlcnJpZGUgdGhpcyBmb3IgdGhlaXIgb3duIGNvbnRlbnRpb24gc2lnbmF0dXJlczsgdGhlIGRlZmF1bHRcbiAgICogdHJlYXRzIGV2ZXJ5IGZhaWx1cmUgYXMgZmluYWwgc28gb25seSBkcml2ZXJzIHRoYXQgcHJvdmUgdGhlIHRyYW5zaWVudCBzaGFwZSByZXRyeSBpdC5cbiAgICogQHBhcmFtIHt1bmtub3dufSBfZXJyb3IgLSBFcnJvciByYWlzZWQgYnkgYSBzY2hlbWEtbWV0YWRhdGEgcmVhZC5cbiAgICogQHJldHVybnMge2Jvb2xlYW59IC0gV2hldGhlciB0aGUgcmVhZCBtYXkgYmUgcmV0cmllZC5cbiAgICovXG4gIF9pc1RyYW5zaWVudFNjaGVtYU1ldGFkYXRhRXJyb3IoX2Vycm9yKSB7XG4gICAgcmV0dXJuIGZhbHNlXG4gIH1cblxuICAvKipcbiAgICogUnVucyBhIHNjaGVtYS1tZXRhZGF0YSByZWFkLCByZXRyeWluZyB0cmFuc2llbnQgY29uY3VycmVudC1EREwgY29udGVudGlvbiB1bnRpbCB0aGUgYm91bmRlZFxuICAgKiBkZWFkbGluZS4gTm9uLXRyYW5zaWVudCBmYWlsdXJlcyBhbmQgZXhoYXVzdGVkIGRlYWRsaW5lcyBwcm9wYWdhdGUgdGhlIG9yaWdpbmFsIGVycm9yLlxuICAgKiBAdGVtcGxhdGUgVFxuICAgKiBAcGFyYW0geygpID0+IFByb21pc2U8VD59IGNhbGxiYWNrIC0gQ2FjaGUtbWlzcyBzY2hlbWEgcmVhZC5cbiAgICogQHJldHVybnMge1Byb21pc2U8VD59IC0gUmVzb2x2ZXMgd2l0aCB0aGUgcmVhZCByZXN1bHQuXG4gICAqL1xuICBhc3luYyBfd2l0aFNjaGVtYU1ldGFkYXRhRGRsUmV0cnkoY2FsbGJhY2spIHtcbiAgICBjb25zdCBkZWFkbGluZU1zID0gdGhpcy5fc2NoZW1hTWV0YWRhdGFSZXRyeURlYWRsaW5lTXMoKVxuICAgIGNvbnN0IHN0YXJ0ZWRBdCA9IERhdGUubm93KClcbiAgICBsZXQgZGVsYXlNcyA9IFNDSEVNQV9NRVRBREFUQV9SRVRSWV9JTklUSUFMX0RFTEFZX01TXG5cbiAgICBmb3IgKDs7KSB7XG4gICAgICB0cnkge1xuICAgICAgICByZXR1cm4gYXdhaXQgY2FsbGJhY2soKVxuICAgICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgICAgaWYgKCF0aGlzLl9pc1RyYW5zaWVudFNjaGVtYU1ldGFkYXRhRXJyb3IoZXJyb3IpKSB0aHJvdyBlcnJvclxuICAgICAgICBpZiAoRGF0ZS5ub3coKSAtIHN0YXJ0ZWRBdCArIGRlbGF5TXMgPiBkZWFkbGluZU1zKSB0aHJvdyBlcnJvclxuXG4gICAgICAgIGF3YWl0IHdhaXQoZGVsYXlNcylcbiAgICAgICAgZGVsYXlNcyA9IE1hdGgubWluKGRlbGF5TXMgKiAyLCBTQ0hFTUFfTUVUQURBVEFfUkVUUllfTUFYX0RFTEFZX01TKVxuICAgICAgfVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGNhY2hlZCBzY2hlbWEgbWV0YWRhdGEuXG4gICAqIEB0ZW1wbGF0ZSBUXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBjYWNoZUtleSAtIFNjaGVtYSBjYWNoZSBrZXkuXG4gICAqIEBwYXJhbSB7KCkgPT4gUHJvbWlzZTxUPn0gY2FsbGJhY2sgLSBDYWNoZSBtaXNzIGNhbGxiYWNrLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxUPn0gLSBSZXNvbHZlcyB3aXRoIHRoZSBjYWNoZWQgbWV0YWRhdGEuXG4gICAqL1xuICBhc3luYyBfY2FjaGVkU2NoZW1hTWV0YWRhdGEoY2FjaGVLZXksIGNhbGxiYWNrKSB7XG4gICAgaWYgKCF0aGlzLl9zY2hlbWFDYWNoZUVuYWJsZWQoKSkgcmV0dXJuIGF3YWl0IHRoaXMuX3dpdGhTY2hlbWFNZXRhZGF0YURkbFJldHJ5KGNhbGxiYWNrKVxuXG4gICAgY29uc3QgZXhpc3RpbmdQcm9taXNlID0gdGhpcy5fc2NoZW1hQ2FjaGUuZ2V0KGNhY2hlS2V5KVxuXG4gICAgaWYgKGV4aXN0aW5nUHJvbWlzZSkge1xuICAgICAgcmV0dXJuIC8qKiBAdHlwZSB7VH0gKi8gKHRoaXMuX3NjaGVtYUNhY2hlUmV0dXJuVmFsdWUoYXdhaXQgZXhpc3RpbmdQcm9taXNlKSlcbiAgICB9XG5cbiAgICBjb25zdCBwcm9taXNlID0gKGFzeW5jICgpID0+IGF3YWl0IHRoaXMuX3dpdGhTY2hlbWFNZXRhZGF0YURkbFJldHJ5KGNhbGxiYWNrKSkoKVxuXG4gICAgdGhpcy5fc2NoZW1hQ2FjaGUuc2V0KGNhY2hlS2V5LCBwcm9taXNlKVxuXG4gICAgdHJ5IHtcbiAgICAgIHJldHVybiAvKiogQHR5cGUge1R9ICovICh0aGlzLl9zY2hlbWFDYWNoZVJldHVyblZhbHVlKGF3YWl0IHByb21pc2UpKVxuICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICBpZiAodGhpcy5fc2NoZW1hQ2FjaGUuZ2V0KGNhY2hlS2V5KSA9PT0gcHJvbWlzZSkge1xuICAgICAgICB0aGlzLl9zY2hlbWFDYWNoZS5kZWxldGUoY2FjaGVLZXkpXG4gICAgICB9XG5cbiAgICAgIHRocm93IGVycm9yXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgY2FjaGVkIHRhYmxlIHNjaGVtYSBtZXRhZGF0YS5cbiAgICogQHRlbXBsYXRlIFRcbiAgICogQHBhcmFtIHtzdHJpbmd9IHRhYmxlTmFtZSAtIFRhYmxlIG5hbWUuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBtZXRhZGF0YU5hbWUgLSBNZXRhZGF0YSBuYW1lLlxuICAgKiBAcGFyYW0geygpID0+IFByb21pc2U8VD59IGNhbGxiYWNrIC0gQ2FjaGUgbWlzcyBjYWxsYmFjay5cbiAgICogQHJldHVybnMge1Byb21pc2U8VD59IC0gUmVzb2x2ZXMgd2l0aCB0aGUgY2FjaGVkIHRhYmxlIG1ldGFkYXRhLlxuICAgKi9cbiAgYXN5bmMgX2NhY2hlZFRhYmxlU2NoZW1hTWV0YWRhdGEodGFibGVOYW1lLCBtZXRhZGF0YU5hbWUsIGNhbGxiYWNrKSB7XG4gICAgcmV0dXJuIGF3YWl0IHRoaXMuX2NhY2hlZFNjaGVtYU1ldGFkYXRhKGB0YWJsZToke3RhYmxlTmFtZX06JHttZXRhZGF0YU5hbWV9YCwgY2FsbGJhY2spXG4gIH1cblxuICAvKipcbiAgICogUnVucyBzY2hlbWEgY2FjaGUgcmV0dXJuIHZhbHVlLlxuICAgKiBAcGFyYW0ge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSB2YWx1ZSAtIENhY2hlZCB2YWx1ZS5cbiAgICogQHJldHVybnMge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSAtIFZhbHVlIHJldHVybmVkIHRvIGNhbGxlcnMuXG4gICAqL1xuICBfc2NoZW1hQ2FjaGVSZXR1cm5WYWx1ZSh2YWx1ZSkge1xuICAgIGlmIChBcnJheS5pc0FycmF5KHZhbHVlKSkgcmV0dXJuIHZhbHVlLnNsaWNlKClcblxuICAgIHJldHVybiB2YWx1ZVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZ2V0IHRhYmxlcy5cbiAgICogQGFic3RyYWN0XG4gICAqIEByZXR1cm5zIHtQcm9taXNlPEFycmF5PGltcG9ydChcIi4vYmFzZS10YWJsZS5qc1wiKS5kZWZhdWx0Pj59IC0gUmVzb2x2ZXMgd2l0aCB0aGUgdGFibGVzLlxuICAgKi9cbiAgZ2V0VGFibGVzKCkge1xuICAgIHRocm93IG5ldyBFcnJvcihgJHt0aGlzLmNvbnN0cnVjdG9yLm5hbWV9I2dldFRhYmxlcyBub3QgaW1wbGVtZW50ZWRgKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgc3RydWN0dXJlIHNxbC5cbiAgICogQHJldHVybnMge1Byb21pc2U8c3RyaW5nIHwgbnVsbD59IC0gUmVzb2x2ZXMgd2l0aCBTUUwgc3RyaW5nLlxuICAgKi9cbiAgYXN5bmMgc3RydWN0dXJlU3FsKCkge1xuICAgIHJldHVybiBudWxsXG4gIH1cblxuICAvKipcbiAgICogRXhlY3V0ZXMgYSB3aG9sZSBtdWx0aS1zdGF0ZW1lbnQgc3RydWN0dXJlIFNRTCBzY3JpcHQgaW4gYSBzaW5nbGUgcm91bmQtdHJpcCB3aGVuXG4gICAqIHRoZSBkcml2ZXIgc3VwcG9ydHMgaXQsIHJ1bm5pbmcgb24gdGhpcyBjb25uZWN0aW9uIChzbyB0aGUgY2FsbGVyJ3MgZm9yZWlnbi1rZXlcbiAgICogaGFuZGxpbmcgYXBwbGllcykuIFJldHVybnMgdHJ1ZSBpZiBpdCByYW4gdGhlIHdob2xlIHNjcmlwdDsgZmFsc2Ugd2hlbiB0aGUgY2FsbGVyXG4gICAqIHNob3VsZCBydW4gdGhlIHN0YXRlbWVudHMgaW5kaXZpZHVhbGx5LiBUaGUgYmFzZSBkcml2ZXIgaGFzIG5vIGJhdGNoIHBhdGguXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBfc3RydWN0dXJlU3FsIC0gRnVsbCBtdWx0aS1zdGF0ZW1lbnQgc3RydWN0dXJlIFNRTC5cbiAgICogQHJldHVybnMge1Byb21pc2U8Ym9vbGVhbj59IC0gV2hldGhlciB0aGUgc2NyaXB0IHdhcyBleGVjdXRlZCBhcyBvbmUgYmF0Y2guXG4gICAqL1xuICBhc3luYyBleGVjU3RydWN0dXJlU2NyaXB0KF9zdHJ1Y3R1cmVTcWwpIHtcbiAgICByZXR1cm4gZmFsc2VcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGdldCB0YWJsZSBieSBuYW1lLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gbmFtZSAtIE5hbWUuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBbYXJnc10gLSBPcHRpb25zIG9iamVjdC5cbiAgICogQHBhcmFtIHtib29sZWFufSBhcmdzLnRocm93RXJyb3IgLSBXaGV0aGVyIHRocm93IGVycm9yLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxpbXBvcnQoXCIuL2Jhc2UtdGFibGUuanNcIikuZGVmYXVsdCB8IHVuZGVmaW5lZD59IC0gUmVzb2x2ZXMgd2l0aCB0aGUgdGFibGUgYnkgbmFtZS5cbiAgICovXG4gIGFzeW5jIGdldFRhYmxlQnlOYW1lKG5hbWUsIGFyZ3MpIHtcbiAgICBjb25zdCB0YWJsZXMgPSBhd2FpdCB0aGlzLmdldFRhYmxlcygpXG4gICAgY29uc3QgdGFibGVOYW1lcyA9IFtdXG4gICAgbGV0IHRhYmxlXG5cbiAgICBmb3IgKGNvbnN0IGNhbmRpZGF0ZSBvZiB0YWJsZXMpIHtcbiAgICAgIGNvbnN0IGNhbmRpZGF0ZU5hbWUgPSBjYW5kaWRhdGUuZ2V0TmFtZSgpXG5cbiAgICAgIGlmIChjYW5kaWRhdGVOYW1lID09IG5hbWUpIHtcbiAgICAgICAgdGFibGUgPSBjYW5kaWRhdGVcbiAgICAgICAgYnJlYWtcbiAgICAgIH1cblxuICAgICAgdGFibGVOYW1lcy5wdXNoKGNhbmRpZGF0ZU5hbWUpXG4gICAgfVxuXG4gICAgaWYgKCF0YWJsZSAmJiBhcmdzPy50aHJvd0Vycm9yICE9PSBmYWxzZSkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKHRoaXMuX21pc3NpbmdUYWJsZUVycm9yTWVzc2FnZShuYW1lLCB0YWJsZU5hbWVzKSlcbiAgICB9XG5cbiAgICByZXR1cm4gdGFibGVcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIG1pc3NpbmcgdGFibGUgZXJyb3IgbWVzc2FnZS5cbiAgICogQHBhcmFtIHtzdHJpbmd9IG5hbWUgLSBUYWJsZSBuYW1lLlxuICAgKiBAcGFyYW0ge3N0cmluZ1tdfSB0YWJsZU5hbWVzIC0gQXZhaWxhYmxlIHRhYmxlIG5hbWVzLlxuICAgKiBAcmV0dXJucyB7c3RyaW5nfSAtIEVycm9yIG1lc3NhZ2UuXG4gICAqL1xuICBfbWlzc2luZ1RhYmxlRXJyb3JNZXNzYWdlKG5hbWUsIHRhYmxlTmFtZXMpIHtcbiAgICBjb25zdCBlbnZpcm9ubWVudCA9IHRoaXMuZ2V0Q29uZmlndXJhdGlvbigpLmdldEVudmlyb25tZW50KClcbiAgICBjb25zdCBhcmdzID0gdGhpcy5nZXRBcmdzKClcbiAgICBjb25zdCBkYXRhYmFzZU5hbWUgPSBhcmdzPy5kYXRhYmFzZSB8fCBhcmdzPy5uYW1lIHx8IGFyZ3M/LnVzZURhdGFiYXNlIHx8IFwidW5rbm93blwiXG5cbiAgICByZXR1cm4gYENvdWxkbid0IGZpbmQgYSB0YWJsZSBieSB0aGF0IG5hbWUgXCIke25hbWV9XCIgaW46ICR7dGFibGVOYW1lcy5qb2luKFwiLCBcIil9IChlbnZpcm9ubWVudDogJHtlbnZpcm9ubWVudH0sIGRhdGFiYXNlOiAke2RhdGFiYXNlTmFtZX0pYFxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZ2V0IHRhYmxlIGJ5IG5hbWUgb3IgZmFpbC5cbiAgICogQHBhcmFtIHtzdHJpbmd9IG5hbWUgLSBOYW1lLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxpbXBvcnQoXCIuL2Jhc2UtdGFibGUuanNcIikuZGVmYXVsdD59IC0gUmVzb2x2ZXMgd2l0aCB0aGUgdGFibGUgYnkgbmFtZSBvciBmYWlsLlxuICAgKi9cbiAgYXN5bmMgZ2V0VGFibGVCeU5hbWVPckZhaWwobmFtZSkge1xuICAgIHJldHVybiAvKiogQHR5cGUge2ltcG9ydChcIi4vYmFzZS10YWJsZS5qc1wiKS5kZWZhdWx0fSAqLyAoYXdhaXQgdGhpcy5nZXRUYWJsZUJ5TmFtZShuYW1lLCB7dGhyb3dFcnJvcjogdHJ1ZX0pKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZ2V0IHR5cGUuXG4gICAqIEBhYnN0cmFjdFxuICAgKiBAcmV0dXJucyB7c3RyaW5nfSAtIFRoZSB0eXBlLlxuICAgKi9cbiAgZ2V0VHlwZSgpIHtcbiAgICB0aHJvdyBuZXcgRXJyb3IoXCIndHlwZScgbm90IGltcGxlbWVudGVkXCIpXG4gIH1cblxuICAvKipcbiAgICogV2hldGhlciB0aGlzIGRyaXZlciBjYW4gY29tYmluZSB1bnJlbGF0ZWQgYWx0ZXItdGFibGUgb3BlcmF0aW9ucyBpbnRvIGFcbiAgICogc2luZ2xlIGBBTFRFUiBUQUJMRWAgc3RhdGVtZW50IChSYWlscycgYHN1cHBvcnRzX2J1bGtfYWx0ZXJgKS5cbiAgICogQHJldHVybnMge2Jvb2xlYW59IC0gV2hldGhlciBidWxrIGFsdGVyIGlzIHN1cHBvcnRlZC5cbiAgICovXG4gIHN1cHBvcnRzQnVsa0FsdGVyKCkge1xuICAgIHJldHVybiBmYWxzZVxuICB9XG5cbiAgLyoqXG4gICAqIFdoZXRoZXIgYSBidWxrIGBBTFRFUiBUQUJMRWAgc3RhdGVtZW50IGNhbiBhbHNvIGNhcnJ5IGBBREQgSU5ERVhgIGNsYXVzZXMuXG4gICAqIE9ubHkgZHJpdmVycyB0aGF0IHN1cHBvcnQgdGhpcyBrZWVwIGluZGV4IGFkZHMgaW5zaWRlIHRoZSBjb21iaW5lZCBiYXRjaDtcbiAgICogdGhlIHJlc3QgZXhlY3V0ZSBlYWNoIGluZGV4IGFzIGl0cyBvd24gc3RhdGVtZW50LlxuICAgKiBAcmV0dXJucyB7Ym9vbGVhbn0gLSBXaGV0aGVyIGluZGV4ZXMgY2FuIGJlIGFkZGVkIGluc2lkZSBhIGJ1bGsgYWx0ZXIuXG4gICAqL1xuICBzdXBwb3J0c0J1bGtBbHRlckluZGV4ZXMoKSB7XG4gICAgcmV0dXJuIGZhbHNlXG4gIH1cblxuICAvKipcbiAgICogUnVucyBpbnNlcnQuXG4gICAqIEBwYXJhbSB7SW5zZXJ0U3FsQXJnc1R5cGV9IGFyZ3MgLSBPcHRpb25zIG9iamVjdC5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgd2hlbiBjb21wbGV0ZS5cbiAgICovXG4gIGFzeW5jIGluc2VydChhcmdzKSB7XG4gICAgdGhpcy5fYXNzZXJ0Tm90UmVhZE9ubHkoKVxuICAgIGNvbnN0IHNxbCA9IHRoaXMuaW5zZXJ0U3FsKGFyZ3MpXG5cbiAgICBhd2FpdCB0aGlzLnF1ZXJ5KHNxbClcbiAgfVxuXG4gIC8qKlxuICAgKiBNYXhpbXVtIHJvd3MgcGVyIGBJTlNFUlQgLi4uIFZBTFVFUyAoLi4uKSwgKC4uLiksIC4uLmAgc3RhdGVtZW50LiBEcml2ZXJzXG4gICAqIHRoYXQgYnVpbGQgbXVsdGktdmFsdWUgaW5zZXJ0cyBtdXN0IHN0YXkgYmVsb3cgZGF0YWJhc2Utc3BlY2lmaWMgbGltaXRzXG4gICAqIChTUUxpdGUncyBgTUFYX1ZBUklBQkxFX05VTUJFUmAsIFNRTCBTZXJ2ZXIncyAyMTAwIHBhcmFtZXRlcnMsIFBvc3RncmVTUUwnc1xuICAgKiA2NTUzNSBwYXJhbWV0ZXJzLCBhbmQgc28gb24pLiA1MDAgcm93cyBpcyBzYWZlbHkgdW5kZXIgZXZlcnkgbWFqb3IgZW5naW5lXG4gICAqIGZvciB0YWJsZXMgd2l0aCBhIG1vZGVyYXRlIG51bWJlciBvZiBjb2x1bW5zIGFuZCBrZWVwcyBnZW5lcmF0ZWQgU1FMIHNtYWxsLlxuICAgKlxuICAgKiBPdmVycmlkZSB2aWEgYG1heFJvd3NQZXJJbnNlcnRgIGluIHRoZSBkYXRhYmFzZSBjb25maWd1cmF0aW9uLlxuICAgKiBAcmV0dXJucyB7bnVtYmVyfSAtIE1heGltdW0gcm93cyBwZXIgaW5zZXJ0IHN0YXRlbWVudC5cbiAgICovXG4gIG1heFJvd3NQZXJJbnNlcnQoKSB7XG4gICAgcmV0dXJuIG9wdGlvbmFsUG9zaXRpdmVJbnRlZ2VyKHRoaXMuZ2V0QXJncygpLm1heFJvd3NQZXJJbnNlcnQsIFwibWF4Um93c1Blckluc2VydFwiKSA/PyA1MDBcbiAgfVxuXG4gIC8qKlxuICAgKiBNYXhpbXVtIHNlcmlhbGl6ZWQgU1FMIHNpemUsIGluIGJ5dGVzLCBmb3IgYSBzaW5nbGUgYElOU0VSVCAuLi4gVkFMVUVTYFxuICAgKiBzdGF0ZW1lbnQuIExhcmdlIHRleHQvSlNPTiBwYXlsb2FkcyBjYW4gcHVzaCBhIG1vZGVzdCByb3cgY291bnQgd2VsbCBiZXlvbmRcbiAgICogZGF0YWJhc2Ugd2lyZS9wcm90b2NvbCBsaW1pdHMsIHNvIGNodW5raW5nIGFsc28gc3RvcHMgd2hlbiB0aGUgbmV4dCByb3dcbiAgICogd291bGQgcHVzaCB0aGUgZ2VuZXJhdGVkIHN0cmluZyBvdmVyIHRoaXMgdGhyZXNob2xkLlxuICAgKlxuICAgKiBPdmVycmlkZSB2aWEgYG1heEluc2VydFNxbEJ5dGVzYCBpbiB0aGUgZGF0YWJhc2UgY29uZmlndXJhdGlvbi5cbiAgICogQHJldHVybnMge251bWJlcn0gLSBNYXhpbXVtIGJ5dGVzIHBlciBpbnNlcnQgc3RhdGVtZW50LlxuICAgKi9cbiAgbWF4SW5zZXJ0U3FsQnl0ZXMoKSB7XG4gICAgcmV0dXJuIG9wdGlvbmFsUG9zaXRpdmVJbnRlZ2VyKHRoaXMuZ2V0QXJncygpLm1heEluc2VydFNxbEJ5dGVzLCBcIm1heEluc2VydFNxbEJ5dGVzXCIpID8/IDEwNDg1NzZcbiAgfVxuXG4gIC8qKlxuICAgKiBNYXhpbXVtIHZhbHVlcyBpbiBhIHNpbmdsZSBgSU4gKC4uLilgIGNvaG9ydCB1c2VkIGJ5IHByZWxvYWRzLCBhc3NvY2lhdGlvblxuICAgKiBjb3VudHMsIGFuZCBxdWVyeURhdGEgYWdncmVnYXRlcy4gVGhlIGRlZmF1bHQgc3RheXMgdW5kZXIgU1FMaXRlJ3MgZGVmYXVsdFxuICAgKiBgTUFYX1ZBUklBQkxFX05VTUJFUmAgY29tcGlsZS10aW1lIGxpbWl0LlxuICAgKlxuICAgKiBPdmVycmlkZSB2aWEgYG1heEluQ2xhdXNlVmFsdWVzYCBpbiB0aGUgZGF0YWJhc2UgY29uZmlndXJhdGlvbi5cbiAgICogQHJldHVybnMge251bWJlcn0gLSBNYXhpbXVtIHZhbHVlcyBwZXIgSU4gY2xhdXNlIGNvaG9ydC5cbiAgICovXG4gIG1heEluQ2xhdXNlVmFsdWVzKCkge1xuICAgIHJldHVybiBvcHRpb25hbFBvc2l0aXZlSW50ZWdlcih0aGlzLmdldEFyZ3MoKS5tYXhJbkNsYXVzZVZhbHVlcywgXCJtYXhJbkNsYXVzZVZhbHVlc1wiKSA/PyA5OTlcbiAgfVxuXG4gIC8qKlxuICAgKiBNYXhpbXVtIHNlcmlhbGl6ZWQgU1FMIHNpemUsIGluIGJ5dGVzLCBmb3IgYSBzaW5nbGUgY29ob3J0IHF1ZXJ5IHVzZWQgYnlcbiAgICogcHJlbG9hZHMsIGFzc29jaWF0aW9uIGNvdW50cywgYW5kIHF1ZXJ5RGF0YSBhZ2dyZWdhdGVzLiBDb2hvcnQgY2h1bmtpbmdcbiAgICogc3RvcHMgd2hlbiB0aGUgbmV4dCB2YWx1ZSB3b3VsZCBwdXNoIHRoZSBnZW5lcmF0ZWQgc3RyaW5nIG92ZXIgdGhpcyB0aHJlc2hvbGQuXG4gICAqXG4gICAqIE92ZXJyaWRlIHZpYSBgbWF4UXVlcnlTcWxCeXRlc2AgaW4gdGhlIGRhdGFiYXNlIGNvbmZpZ3VyYXRpb24uXG4gICAqIEByZXR1cm5zIHtudW1iZXJ9IC0gTWF4aW11bSBieXRlcyBwZXIgY29ob3J0IHF1ZXJ5LlxuICAgKi9cbiAgbWF4UXVlcnlTcWxCeXRlcygpIHtcbiAgICByZXR1cm4gb3B0aW9uYWxQb3NpdGl2ZUludGVnZXIodGhpcy5nZXRBcmdzKCkubWF4UXVlcnlTcWxCeXRlcywgXCJtYXhRdWVyeVNxbEJ5dGVzXCIpID8/IDEwNDg1NzZcbiAgfVxuXG4gIC8qKlxuICAgKiBTcGxpdHMgYHZhbHVlc2AgaW50byBjb2hvcnQgY2h1bmtzIHRoYXQgc3RheSB3aXRoaW4gYm90aCBgbWF4Q291bnRgIGFuZFxuICAgKiBgbWF4Qnl0ZXNgIHdoaWxlIHByZXNlcnZpbmcgb3JkZXIuXG4gICAqXG4gICAqIEEgY2h1bmsgYWx3YXlzIGNvbnRhaW5zIGF0IGxlYXN0IG9uZSB2YWx1ZSwgZXZlbiBpZiB0aGF0IHNpbmdsZSB2YWx1ZSBleGNlZWRzXG4gICAqIHRoZSBieXRlIGxpbWl0LCBzbyBwcm9ncmVzcyBpcyBndWFyYW50ZWVkLlxuICAgKiBAdGVtcGxhdGUgVFxuICAgKiBAcGFyYW0ge0FycmF5PFQ+fSB2YWx1ZXMgLSBWYWx1ZXMgdG8gY2h1bmsuXG4gICAqIEBwYXJhbSB7KHZhbHVlczogQXJyYXk8VD4pID0+IHN0cmluZ30gYnVpbGRTcWwgLSBGdW5jdGlvbiB0aGF0IGJ1aWxkcyB0aGUgZnVsbCBTUUwgZm9yIGEgY2FuZGlkYXRlIGNodW5rLlxuICAgKiBAcGFyYW0ge3ttYXhDb3VudD86IG51bWJlciwgbWF4Qnl0ZXM/OiBudW1iZXJ9fSBbb3B0aW9uc10gLSBDaHVua2luZyBib3VuZHMuXG4gICAqIEByZXR1cm5zIHtBcnJheTxBcnJheTxUPj59IC0gVmFsdWUgY29ob3J0cy5cbiAgICovXG4gIGNodW5rVmFsdWVzKHZhbHVlcywgYnVpbGRTcWwsIHttYXhDb3VudCA9IHRoaXMubWF4SW5DbGF1c2VWYWx1ZXMoKSwgbWF4Qnl0ZXMgPSB0aGlzLm1heFF1ZXJ5U3FsQnl0ZXMoKX0gPSB7fSkge1xuICAgIGlmICh2YWx1ZXMubGVuZ3RoID09PSAwKSByZXR1cm4gW11cblxuICAgIC8qKlxuICAgICAqIENodW5rcy5cbiAgICAgKiBAdHlwZSB7QXJyYXk8QXJyYXk8VD4+fSAqL1xuICAgIGNvbnN0IGNodW5rcyA9IFtdXG4gICAgLyoqXG4gICAgICogQ3VycmVudCBjaHVuay5cbiAgICAgKiBAdHlwZSB7QXJyYXk8VD59ICovXG4gICAgbGV0IGN1cnJlbnRDaHVuayA9IFtdXG5cbiAgICBmb3IgKGNvbnN0IHZhbHVlIG9mIHZhbHVlcykge1xuICAgICAgY29uc3QgY2FuZGlkYXRlID0gWy4uLmN1cnJlbnRDaHVuaywgdmFsdWVdXG4gICAgICBjb25zdCBjYW5kaWRhdGVCeXRlcyA9IHV0ZjhCeXRlTGVuZ3RoKGJ1aWxkU3FsKGNhbmRpZGF0ZSkpXG5cbiAgICAgIGlmIChjdXJyZW50Q2h1bmsubGVuZ3RoID4gMCAmJiAoY2FuZGlkYXRlLmxlbmd0aCA+IG1heENvdW50IHx8IGNhbmRpZGF0ZUJ5dGVzID4gbWF4Qnl0ZXMpKSB7XG4gICAgICAgIGNodW5rcy5wdXNoKGN1cnJlbnRDaHVuaylcbiAgICAgICAgY3VycmVudENodW5rID0gW3ZhbHVlXVxuICAgICAgfSBlbHNlIHtcbiAgICAgICAgY3VycmVudENodW5rID0gY2FuZGlkYXRlXG4gICAgICB9XG4gICAgfVxuXG4gICAgaWYgKGN1cnJlbnRDaHVuay5sZW5ndGggPiAwKSB7XG4gICAgICBjaHVua3MucHVzaChjdXJyZW50Q2h1bmspXG4gICAgfVxuXG4gICAgcmV0dXJuIGNodW5rc1xuICB9XG5cbiAgLyoqXG4gICAqIFNwbGl0cyBgcm93c2AgaW50byBjaHVua3MgdGhhdCBzdGF5IHdpdGhpbiBib3RoIHtAbGluayBtYXhSb3dzUGVySW5zZXJ0fVxuICAgKiBhbmQge0BsaW5rIG1heEluc2VydFNxbEJ5dGVzfSB3aGlsZSBwcmVzZXJ2aW5nIG9yZGVyLlxuICAgKlxuICAgKiBCeXRlIGFjY291bnRpbmcgaXMgaW5jcmVtZW50YWw6IGBidWlsZFNxbGAgaXMgY2FsbGVkIG9uY2Ugd2l0aCBgW11gIHRvXG4gICAqIG1lYXN1cmUgdGhlIHN0YXRlbWVudCBwcmVmaXggYW5kIG9uY2UgcGVyIHJvdyB3aXRoIGBbcm93XWAgdG8gbWVhc3VyZSB0aGVcbiAgICogcm93J3MgdmFsdWVzIHR1cGxlLiBUaGlzIGtlZXBzIGNodW5raW5nIGxpbmVhciBpbiB0aGUgbnVtYmVyIG9mIHJvd3NcbiAgICogaW5zdGVhZCBvZiByZWJ1aWxkaW5nIHRoZSBmdWxsIG11bHRpLXJvdyBTUUwgZm9yIGV2ZXJ5IGNhbmRpZGF0ZS5cbiAgICpcbiAgICogQSBjaHVuayBhbHdheXMgY29udGFpbnMgYXQgbGVhc3Qgb25lIHJvdywgZXZlbiBpZiB0aGF0IHNpbmdsZSByb3cgZXhjZWVkc1xuICAgKiB0aGUgYnl0ZSBsaW1pdCwgc28gcHJvZ3Jlc3MgaXMgZ3VhcmFudGVlZC5cbiAgICogQHBhcmFtIHtBcnJheTxBcnJheTxSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj4+fSByb3dzIC0gUm93cyB0byBpbnNlcnQuXG4gICAqIEBwYXJhbSB7KHJvd3M6IEFycmF5PEFycmF5PFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pj4pID0+IHN0cmluZ30gYnVpbGRTcWwgLSBGdW5jdGlvbiB0aGF0IGJ1aWxkcyB0aGUgZnVsbCBTUUwgZm9yIGEgY2FuZGlkYXRlIGNodW5rOyBjYWxsZWQgd2l0aCBgW11gIHRvIG1lYXN1cmUgdGhlIHN0YXRlbWVudCBwcmVmaXggYW5kIHdpdGggYFtyb3ddYCB0byBtZWFzdXJlIGVhY2ggcm93J3MgdmFsdWVzIHR1cGxlLlxuICAgKiBAcmV0dXJucyB7QXJyYXk8QXJyYXk8QXJyYXk8UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+Pj59IC0gUm93IGNodW5rcy5cbiAgICovXG4gIF9pbnNlcnRNdWx0aXBsZUNodW5rcyhyb3dzLCBidWlsZFNxbCkge1xuICAgIGNvbnN0IGNodW5rcyA9IFtdXG4gICAgY29uc3QgbWF4Um93cyA9IHRoaXMubWF4Um93c1Blckluc2VydCgpXG4gICAgY29uc3QgbWF4Qnl0ZXMgPSB0aGlzLm1heEluc2VydFNxbEJ5dGVzKClcbiAgICBjb25zdCBlbXB0eVNxbCA9IGJ1aWxkU3FsKFtdKVxuICAgIGNvbnN0IHByZWZpeCA9IGAke2VtcHR5U3FsfSBWQUxVRVMgYFxuICAgIGNvbnN0IGJhc2VCeXRlTGVuZ3RoID0gdXRmOEJ5dGVMZW5ndGgocHJlZml4KVxuXG4gICAgLyoqXG4gICAgICogQ3VycmVudCBjaHVuay5cbiAgICAgKiBAdHlwZSB7QXJyYXk8QXJyYXk8UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+Pn0gKi9cbiAgICBsZXQgY3VycmVudENodW5rID0gW11cbiAgICBsZXQgY3VycmVudEJ5dGVzID0gMFxuXG4gICAgZm9yIChjb25zdCByb3cgb2Ygcm93cykge1xuICAgICAgY29uc3Qgc2luZ2xlUm93U3FsID0gYnVpbGRTcWwoW3Jvd10pXG4gICAgICBjb25zdCByb3dWYWx1ZXNTcWwgPSBzaW5nbGVSb3dTcWwuc2xpY2UocHJlZml4Lmxlbmd0aClcbiAgICAgIGNvbnN0IHJvd1ZhbHVlc1NxbEJ5dGVzID0gdXRmOEJ5dGVMZW5ndGgocm93VmFsdWVzU3FsKVxuXG4gICAgICBpZiAoY3VycmVudENodW5rLmxlbmd0aCA+IDApIHtcbiAgICAgICAgY29uc3QgY2FuZGlkYXRlUm93cyA9IGN1cnJlbnRDaHVuay5sZW5ndGggKyAxXG4gICAgICAgIGNvbnN0IGNhbmRpZGF0ZUJ5dGVzID0gY3VycmVudEJ5dGVzICsgMiArIHJvd1ZhbHVlc1NxbEJ5dGVzIC8vIFwiLCBcIiBzZXBhcmF0b3JcblxuICAgICAgICBpZiAoY2FuZGlkYXRlUm93cyA+IG1heFJvd3MgfHwgY2FuZGlkYXRlQnl0ZXMgPiBtYXhCeXRlcykge1xuICAgICAgICAgIGNodW5rcy5wdXNoKGN1cnJlbnRDaHVuaylcbiAgICAgICAgICBjdXJyZW50Q2h1bmsgPSBbXVxuICAgICAgICAgIGN1cnJlbnRCeXRlcyA9IDBcbiAgICAgICAgfVxuICAgICAgfVxuXG4gICAgICBpZiAoY3VycmVudENodW5rLmxlbmd0aCA9PT0gMCkge1xuICAgICAgICBjdXJyZW50Qnl0ZXMgPSBiYXNlQnl0ZUxlbmd0aCArIHJvd1ZhbHVlc1NxbEJ5dGVzXG4gICAgICB9IGVsc2Uge1xuICAgICAgICBjdXJyZW50Qnl0ZXMgKz0gMiArIHJvd1ZhbHVlc1NxbEJ5dGVzXG4gICAgICB9XG5cbiAgICAgIGN1cnJlbnRDaHVuay5wdXNoKHJvdylcbiAgICB9XG5cbiAgICBpZiAoY3VycmVudENodW5rLmxlbmd0aCA+IDApIHtcbiAgICAgIGNodW5rcy5wdXNoKGN1cnJlbnRDaHVuaylcbiAgICB9XG5cbiAgICByZXR1cm4gY2h1bmtzXG4gIH1cblxuICAvKipcbiAgICogUnVucyBpbnNlcnQgbXVsdGlwbGUuXG4gICAqXG4gICAqIExhcmdlIHJvdyBzZXRzIGFyZSBzcGxpdCBpbnRvIG11bHRpcGxlIHN0YXRlbWVudHMgdGhhdCBlYWNoIHN0YXkgd2l0aGluXG4gICAqIHtAbGluayBtYXhSb3dzUGVySW5zZXJ0fSByb3dzIGFuZCB7QGxpbmsgbWF4SW5zZXJ0U3FsQnl0ZXN9IHNlcmlhbGl6ZWRcbiAgICogYnl0ZXMgc28gdGhlIGdlbmVyYXRlZCBTUUwgc3RheXMgd2l0aGluIGRhdGFiYXNlIHBhcmFtZXRlciBhbmQgd2lyZSBsaW1pdHMuXG4gICAqIFdoZW4gY2FsbGVkIG91dHNpZGUgYSB0cmFuc2FjdGlvbiBlYWNoIGNodW5rIGNvbW1pdHMgaW5kZXBlbmRlbnRseTsgY2FsbGVyc1xuICAgKiB0aGF0IG5lZWQgYWxsLW9yLW5vdGhpbmcgc2VtYW50aWNzIHNob3VsZCB3cmFwIHRoZSBjYWxsIGluIHtAbGluayB0cmFuc2FjdGlvbn0uXG4gICAqIEBwYXJhbSB7c3RyaW5nfSB0YWJsZU5hbWUgLSBUYWJsZSBuYW1lLlxuICAgKiBAcGFyYW0ge0FycmF5PHN0cmluZz59IGNvbHVtbnMgLSBDb2x1bW4gbmFtZXMuXG4gICAqIEBwYXJhbSB7QXJyYXk8QXJyYXk8UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+Pn0gcm93cyAtIFJvd3MgdG8gaW5zZXJ0LlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyB3aGVuIGNvbXBsZXRlLlxuICAgKi9cbiAgYXN5bmMgaW5zZXJ0TXVsdGlwbGUodGFibGVOYW1lLCBjb2x1bW5zLCByb3dzKSB7XG4gICAgdGhpcy5fYXNzZXJ0Tm90UmVhZE9ubHkoKVxuXG4gICAgY29uc3QgY2h1bmtzID0gdGhpcy5faW5zZXJ0TXVsdGlwbGVDaHVua3Mocm93cywgKGNodW5rUm93cykgPT4gdGhpcy5pbnNlcnRTcWwoe2NvbHVtbnMsIHRhYmxlTmFtZSwgcm93czogY2h1bmtSb3dzfSkpXG5cbiAgICBmb3IgKGNvbnN0IGNodW5rIG9mIGNodW5rcykge1xuICAgICAgY29uc3Qgc3FsID0gdGhpcy5pbnNlcnRTcWwoe2NvbHVtbnMsIHRhYmxlTmFtZSwgcm93czogY2h1bmt9KVxuXG4gICAgICBhd2FpdCB0aGlzLnF1ZXJ5KHNxbClcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogUnVucyBpbnNlcnQgc3FsLlxuICAgKiBAYWJzdHJhY3RcbiAgICogQHBhcmFtIHtJbnNlcnRTcWxBcmdzVHlwZX0gYXJncyAtIE9wdGlvbnMgb2JqZWN0LlxuICAgKiBAcmV0dXJucyB7c3RyaW5nfSAtIFNRTCBzdHJpbmcuXG4gICAqL1xuICBpbnNlcnRTcWwoYXJncykgeyAvLyBlc2xpbnQtZGlzYWJsZS1saW5lIG5vLXVudXNlZC12YXJzXG4gICAgdGhyb3cgbmV3IEVycm9yKFwiJ2luc2VydFNxbCcgbm90IGltcGxlbWVudGVkXCIpXG4gIH1cblxuICAvKipcbiAgICogUnVucyB1cHNlcnQuXG4gICAqIEBwYXJhbSB7VXBzZXJ0U3FsQXJnc1R5cGV9IGFyZ3MgLSBPcHRpb25zIG9iamVjdC5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgd2hlbiBjb21wbGV0ZS5cbiAgICovXG4gIGFzeW5jIHVwc2VydChhcmdzKSB7XG4gICAgdGhpcy5fYXNzZXJ0Tm90UmVhZE9ubHkoKVxuICAgIGNvbnN0IHNxbCA9IHRoaXMudXBzZXJ0U3FsKGFyZ3MpXG5cbiAgICBhd2FpdCB0aGlzLnF1ZXJ5KHNxbClcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGxhc3QgaW5zZXJ0IGlkLlxuICAgKiBAYWJzdHJhY3RcbiAgICogQHBhcmFtIHtRdWVyeU9wdGlvbnN9IFtfb3B0aW9uc10gLSBRdWVyeSBvd25lcnNoaXAgb3B0aW9ucy5cbiAgICogQHJldHVybnMge1Byb21pc2U8bnVtYmVyPn0gLSBSZXNvbHZlcyB3aXRoIHRoZSBsYXN0IGluc2VydCBpZC5cbiAgICovXG4gIGxhc3RJbnNlcnRJRChfb3B0aW9ucyA9IHt9KSB7XG4gICAgdGhyb3cgbmV3IEVycm9yKGAke3RoaXMuY29uc3RydWN0b3IubmFtZX0jbGFzdEluc2VydElEIG5vdCBpbXBsZW1lbnRlZGApXG4gIH1cblxuICAvKipcbiAgICogUnVucyBjb252ZXJ0IHZhbHVlLlxuICAgKiBAcGFyYW0ge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSB2YWx1ZSAtIFZhbHVlIHRvIHVzZS5cbiAgICogQHJldHVybnMge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSAtIFRoZSBjb252ZXJ0IHZhbHVlLlxuICAgKi9cbiAgX2NvbnZlcnRWYWx1ZSh2YWx1ZSkge1xuICAgIGlmICh0eXBlb2YgdmFsdWUgPT09IFwiYm9vbGVhblwiKSB7XG4gICAgICByZXR1cm4gdmFsdWUgPyAxIDogMFxuICAgIH1cblxuICAgIC8vIGlzRGF0ZSBpbnN0ZWFkIG9mIGluc3RhbmNlb2Y6IGEgRGF0ZSBjcmVhdGVkIGluIGFub3RoZXIgcmVhbG0gKGUuZy4gdGhlIGNvbnNvbGUgUkVQTCkgd291bGRcbiAgICAvLyBmYWlsIGluc3RhbmNlb2YsIHNraXAgdGhpcyBjb252ZXJzaW9uLCBhbmQgc2VyaWFsaXplIGFzIGFuIGVtcHR5IFNRTCB2YWx1ZSBkb3duc3RyZWFtLlxuICAgIGlmIChpc0RhdGUodmFsdWUpKSB7XG4gICAgICByZXR1cm4gZm9ybWF0RGF0ZUZvckRhdGFiYXNlKHZhbHVlLCB7ZGF0YWJhc2VUeXBlOiB0aGlzLmdldFR5cGUoKX0pXG4gICAgfVxuXG4gICAgLy8gSlNPTi1lbmNvZGUgcGxhaW4gb2JqZWN0cy9hcnJheXMgc28gdGhleSBsYW5kIGluIEpTT04vdGV4dCBjb2x1bW5zIGFzIHZhbGlkXG4gICAgLy8gSlNPTi4gV2l0aG91dCB0aGlzLCBkcml2ZXJzIGxpa2UgbXlzcWwncyBlc2NhcGUoKSB0dXJuIGFuIG9iamVjdCBpbnRvXG4gICAgLy8gYGtleWAgPSB2YWx1ZSBhc3NpZ25tZW50IHBhaXJzIChpdHMgYFNFVCA/YCBmb3JtKSwgcHJvZHVjaW5nIGludmFsaWQgU1FMIGluXG4gICAgLy8gYSB2YWx1ZSBwb3NpdGlvbi4gT25seSBQTEFJTiBvYmplY3RzIGFuZCBhcnJheXMgYXJlIGVuY29kZWQg4oCUIGNsYXNzXG4gICAgLy8gaW5zdGFuY2VzIChlLmcuIG1vZGVsIHJlY29yZHMsIHdoaWNoIGFyZSBjaXJjdWxhciB2aWEgX2NoYW5nZXMpIGFuZCBCdWZmZXJzXG4gICAgLy8gcGFzcyB0aHJvdWdoIHVudG91Y2hlZCwgc2luY2UgSlNPTi5zdHJpbmdpZnkgb24gYSByZWNvcmQgdGhyb3dzIG9uIGl0c1xuICAgIC8vIGNpcmN1bGFyIHN0cnVjdHVyZSBhbmQgYSByZWNvcmQgaXMgbmV2ZXIgYSB2YWxpZCBjb2x1bW4gdmFsdWUgdG8gc2VyaWFsaXplLlxuICAgIGlmICh0aGlzLl9pc0pzb25FbmNvZGFibGVWYWx1ZSh2YWx1ZSkpIHtcbiAgICAgIHJldHVybiBKU09OLnN0cmluZ2lmeSh2YWx1ZSlcbiAgICB9XG5cbiAgICByZXR1cm4gdmFsdWVcbiAgfVxuXG4gIC8qKlxuICAgKiBXaGV0aGVyIGEgdmFsdWUgaXMgYSBwbGFpbiBvYmplY3Qgb3IgYXJyYXkgdGhhdCBzaG91bGQgYmUgSlNPTi1lbmNvZGVkIGZvciBhXG4gICAqIEpTT04vdGV4dCBjb2x1bW4uIEV4Y2x1ZGVzIEJ1ZmZlcnMgYW5kIGNsYXNzIGluc3RhbmNlcyAoZS5nLiBtb2RlbCByZWNvcmRzKS5cbiAgICogQHBhcmFtIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gdmFsdWUgLSBWYWx1ZSB0byB0ZXN0LlxuICAgKiBAcmV0dXJucyB7Ym9vbGVhbn0gLSBXaGV0aGVyIHRvIEpTT04tZW5jb2RlIHRoZSB2YWx1ZS5cbiAgICovXG4gIF9pc0pzb25FbmNvZGFibGVWYWx1ZSh2YWx1ZSkge1xuICAgIGlmICh2YWx1ZSA9PT0gbnVsbCB8fCB0eXBlb2YgdmFsdWUgIT09IFwib2JqZWN0XCIpIHJldHVybiBmYWxzZVxuICAgIGlmICh0eXBlb2YgQnVmZmVyICE9PSBcInVuZGVmaW5lZFwiICYmIEJ1ZmZlci5pc0J1ZmZlcih2YWx1ZSkpIHJldHVybiBmYWxzZVxuICAgIGlmIChBcnJheS5pc0FycmF5KHZhbHVlKSkgcmV0dXJuIHRydWVcblxuICAgIGNvbnN0IHByb3RvdHlwZSA9IE9iamVjdC5nZXRQcm90b3R5cGVPZih2YWx1ZSlcblxuICAgIHJldHVybiBwcm90b3R5cGUgPT09IE9iamVjdC5wcm90b3R5cGUgfHwgcHJvdG90eXBlID09PSBudWxsXG4gIH1cblxuICAvKipcbiAgICogUnVucyBvcHRpb25zLlxuICAgKiBAYWJzdHJhY3RcbiAgICogQHJldHVybnMge2ltcG9ydChcIi4uL3F1ZXJ5LXBhcnNlci9vcHRpb25zLmpzXCIpLmRlZmF1bHR9IC0gVGhlIG9wdGlvbnMgb3B0aW9ucy5cbiAgICovXG4gIG9wdGlvbnMoKSB7XG4gICAgdGhyb3cgbmV3IEVycm9yKFwiJ29wdGlvbnMnIG5vdCBpbXBsZW1lbnRlZC5cIilcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHF1b3RlLlxuICAgKiBAcGFyYW0ge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSB2YWx1ZSAtIFZhbHVlIHRvIHVzZS5cbiAgICogQHJldHVybnMge251bWJlciB8IHN0cmluZ30gLSBUaGUgcXVvdGUuXG4gICAqL1xuICBxdW90ZSh2YWx1ZSkge1xuICAgIGlmICh0eXBlb2YgdmFsdWUgPT0gXCJudW1iZXJcIikgcmV0dXJuIHZhbHVlXG5cbiAgICBjb25zdCBlc2NhcGVkVmFsdWUgPSB0aGlzLmVzY2FwZSh2YWx1ZSlcbiAgICBjb25zdCByZXN1bHQgPSBgXCIke2VzY2FwZWRWYWx1ZX1cImBcblxuICAgIHJldHVybiByZXN1bHRcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHF1b3RlIGNvbHVtbi5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGNvbHVtbk5hbWUgLSBDb2x1bW4gbmFtZS5cbiAgICogQHJldHVybnMge3N0cmluZ30gLSBUaGUgcXVvdGUgY29sdW1uLlxuICAgKi9cbiAgcXVvdGVDb2x1bW4oY29sdW1uTmFtZSkge1xuICAgIHJldHVybiB0aGlzLm9wdGlvbnMoKS5xdW90ZUNvbHVtbk5hbWUoY29sdW1uTmFtZSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHF1b3RlIGluZGV4LlxuICAgKiBAcGFyYW0ge3N0cmluZ30gY29sdW1uTmFtZSAtIENvbHVtbiBuYW1lLlxuICAgKiBAcmV0dXJucyB7c3RyaW5nfSAtIFRoZSBxdW90ZSBpbmRleC5cbiAgICovXG4gIHF1b3RlSW5kZXgoY29sdW1uTmFtZSkge1xuICAgIHJldHVybiB0aGlzLm9wdGlvbnMoKS5xdW90ZUluZGV4TmFtZShjb2x1bW5OYW1lKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgcXVvdGUgdGFibGUuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSB0YWJsZU5hbWUgLSBUYWJsZSBuYW1lLlxuICAgKiBAcmV0dXJucyB7c3RyaW5nfSAtIFRoZSBxdW90ZSB0YWJsZS5cbiAgICovXG4gIHF1b3RlVGFibGUodGFibGVOYW1lKSB7XG4gICAgcmV0dXJuIHRoaXMub3B0aW9ucygpLnF1b3RlVGFibGVOYW1lKHRhYmxlTmFtZSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIG5ldyBxdWVyeS5cbiAgICogQHJldHVybnMge1F1ZXJ5fSAtIFRoZSBuZXcgcXVlcnkuXG4gICAqL1xuICBuZXdRdWVyeSgpIHtcbiAgICBjb25zdCBoYW5kbGVyID0gbmV3IEhhbmRsZXIoKVxuXG4gICAgcmV0dXJuIG5ldyBRdWVyeSh7XG4gICAgICBkcml2ZXI6IHRoaXMsXG4gICAgICBoYW5kbGVyXG4gICAgfSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHNlbGVjdC5cbiAgICogQHBhcmFtIHtzdHJpbmd9IHRhYmxlTmFtZSAtIFRhYmxlIG5hbWUuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPFF1ZXJ5UmVzdWx0VHlwZT59IC0gUmVzb2x2ZXMgd2l0aCB0aGUgc2VsZWN0LlxuICAgKi9cbiAgYXN5bmMgc2VsZWN0KHRhYmxlTmFtZSkge1xuICAgIGNvbnN0IHF1ZXJ5ID0gdGhpcy5uZXdRdWVyeSgpXG5cbiAgICBjb25zdCBzcWwgPSBxdWVyeVxuICAgICAgLmZyb20odGFibGVOYW1lKVxuICAgICAgLnRvU3FsKClcblxuICAgIHJldHVybiBhd2FpdCB0aGlzLnF1ZXJ5KHNxbClcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHNldCBpZCBzZXEuXG4gICAqIEBwYXJhbSB7bnVtYmVyIHwgdW5kZWZpbmVkfSBuZXdJZFNlcSAtIE5ldyBpZCBzZXEuXG4gICAqIEByZXR1cm5zIHt2b2lkfSAtIE5vIHJldHVybiB2YWx1ZS5cbiAgICovXG4gIHNldElkU2VxKG5ld0lkU2VxKSB7XG4gICAgdGhpcy5pZFNlcSA9IG5ld0lkU2VxXG4gIH1cblxuICAvKipcbiAgICogUnVucyBzaG91bGQgc2V0IGF1dG8gaW5jcmVtZW50IHdoZW4gcHJpbWFyeSBrZXkuXG4gICAqIEBhYnN0cmFjdFxuICAgKiBAcmV0dXJucyB7Ym9vbGVhbn0gLSBXaGV0aGVyIHNldCBhdXRvIGluY3JlbWVudCB3aGVuIHByaW1hcnkga2V5LlxuICAgKi9cbiAgc2hvdWxkU2V0QXV0b0luY3JlbWVudFdoZW5QcmltYXJ5S2V5KCkge1xuICAgIHRocm93IG5ldyBFcnJvcihgJ3Nob3VsZFNldEF1dG9JbmNyZW1lbnRXaGVuUHJpbWFyeUtleScgbm90IGltcGxlbWVudGVkYClcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHN1cHBvcnRzIGRlZmF1bHQgcHJpbWFyeSBrZXkgdXVpZC5cbiAgICogQHJldHVybnMge2Jvb2xlYW59IC0gV2hldGhlciBzdXBwb3J0cyBkZWZhdWx0IHByaW1hcnkga2V5IHV1aWQuXG4gICAqL1xuICBzdXBwb3J0c0RlZmF1bHRQcmltYXJ5S2V5VVVJRCgpIHsgcmV0dXJuIGZhbHNlIH1cblxuICAvKipcbiAgICogRXhlY3V0ZXMgYW4gaW5zZXJ0IHRoYXQgY2FycmllcyBhbiBleHBsaWNpdCBwcmltYXJ5LWtleSB2YWx1ZVxuICAgKiAoY2xpZW50LWdlbmVyYXRlZCBvZmZsaW5lLXN5bmMgaWRzKS4gRHJpdmVycyB3aG9zZSBhdXRvLWluY3JlbWVudCBjb2x1bW5zXG4gICAqIHJlamVjdCBleHBsaWNpdCB2YWx1ZXMgKE1TU1FMIElERU5USVRZKSBvdmVycmlkZSB0aGlzIHRvIHJ1biB0aGUgaW5zZXJ0XG4gICAqIHdpdGggaWRlbnRpdHkgaW5zZXJ0IGVuYWJsZWQgaW4gYSBzaW5nbGUgcmVxdWVzdC5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBPcHRpb25zIG9iamVjdC5cbiAgICogQHBhcmFtIHtRdWVyeU9wdGlvbnN9IGFyZ3Mub3B0aW9ucyAtIFF1ZXJ5IG9wdGlvbnMgZm9yIHRoZSBzdGFuZGFyZCBxdWVyeSBwYXRoLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gYXJncy5zcWwgLSBHZW5lcmF0ZWQgaW5zZXJ0IFNRTC5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGFyZ3MudGFibGVOYW1lIC0gVGFibGUgYmVpbmcgaW5zZXJ0ZWQgaW50by5cbiAgICogQHJldHVybnMge1Byb21pc2U8UXVlcnlSZXN1bHRUeXBlPn0gLSBJbnNlcnQgcmVzdWx0LlxuICAgKi9cbiAgYXN5bmMgaW5zZXJ0V2l0aEV4cGxpY2l0UHJpbWFyeUtleSh7b3B0aW9ucywgc3FsLCB0YWJsZU5hbWV9KSB7XG4gICAgdm9pZCB0YWJsZU5hbWVcblxuICAgIHJldHVybiBhd2FpdCB0aGlzLnF1ZXJ5KHNxbCwgb3B0aW9ucylcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHN1cHBvcnRzIGluc2VydCBpbnRvIHJldHVybmluZy5cbiAgICogQGFic3RyYWN0XG4gICAqIEByZXR1cm5zIHtib29sZWFufSAtIFdoZXRoZXIgc3VwcG9ydHMgaW5zZXJ0IGludG8gcmV0dXJuaW5nLlxuICAgKi9cbiAgc3VwcG9ydHNJbnNlcnRJbnRvUmV0dXJuaW5nKCkgeyByZXR1cm4gZmFsc2UgfVxuXG4gIC8qKlxuICAgKiBXaGV0aGVyIGEgc2luZ2xlIGNvbm5lY3Rpb24gY2FuIHJlZmVyZW5jZSB0YWJsZXMgaW4gYW5vdGhlciBkYXRhYmFzZSBvbiB0aGUgc2FtZSBzZXJ2ZXIgdmlhIGFcbiAgICogdHdvLXBhcnQgYGRhdGFiYXNlYC5gdGFibGVgIGlkZW50aWZpZXIuIFdoZW4gdHJ1ZSwgYSBxdWVyeSBzcGFubmluZyBzZXZlcmFsIGRhdGFiYXNlcyBvbiB0aGlzXG4gICAqIHNlcnZlciBjYW4gYmUgZXhwcmVzc2VkIGFzIG9uZSBzdGF0ZW1lbnQgKGEgY3Jvc3MtdGVuYW50IGBVTklPTiBBTExgKTsgd2hlbiBmYWxzZSwgZWFjaCBkYXRhYmFzZVxuICAgKiBpcyBxdWVyaWVkIG9uIGl0cyBvd24gY29ubmVjdGlvbiBhbmQgdGhlIHJlc3VsdHMgbWVyZ2VkIGluIHRoZSBjYWxsZXIuIE9ubHkgTXlTUUwvTWFyaWFEQiByZXR1cm5cbiAgICogdHJ1ZTogUG9zdGdyZVNRTCAob25lIGRhdGFiYXNlIHBlciBjb25uZWN0aW9uKSBhbmQgU1FMaXRlIChvbmUgYXR0YWNoZWQgZmlsZSBwZXIgY29ubmVjdGlvbilcbiAgICogY2Fubm90LCBhbmQgTVNTUUwgaXMgZXhjbHVkZWQgYmVjYXVzZSBpdCByZWFkcyBhIHR3by1wYXJ0IG5hbWUgYXMgYHNjaGVtYS50YWJsZWAgKGNyb3NzLWRhdGFiYXNlXG4gICAqIGFjY2VzcyBuZWVkcyBhIHRocmVlLXBhcnQgYGRhdGFiYXNlLnNjaGVtYS50YWJsZWApLCBzbyBpdCBzdGF5cyBvbiB0aGUgYWx3YXlzLWNvcnJlY3QgZmFuLW91dFxuICAgKiBwYXRoLiBDb25zdW1lZCBieSBgVGVuYW50LmFnZ3JlZ2F0ZUFjcm9zc2AuXG4gICAqIEByZXR1cm5zIHtib29sZWFufSAtIFdoZXRoZXIgdHdvLXBhcnQgY3Jvc3MtZGF0YWJhc2UgcmVmZXJlbmNlcyBhcmUgc3VwcG9ydGVkLlxuICAgKi9cbiAgc3VwcG9ydHNDcm9zc0RhdGFiYXNlUmVmZXJlbmNlcygpIHsgcmV0dXJuIGZhbHNlIH1cblxuICAvKipcbiAgICogUnVucyB0YWJsZSBleGlzdHMuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSB0YWJsZU5hbWUgLSBUYWJsZSBuYW1lLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxib29sZWFuPn0gLSBSZXNvbHZlcyB3aXRoIFdoZXRoZXIgdGFibGUgZXhpc3RzLlxuICAgKi9cbiAgYXN5bmMgdGFibGVFeGlzdHModGFibGVOYW1lKSB7XG4gICAgY29uc3QgdGFibGVzID0gYXdhaXQgdGhpcy5nZXRUYWJsZXMoKVxuICAgIGNvbnN0IHRhYmxlID0gdGFibGVzLmZpbmQoKHRhYmxlKSA9PiB0YWJsZS5nZXROYW1lKCkgPT0gdGFibGVOYW1lKVxuXG4gICAgaWYgKHRhYmxlKSByZXR1cm4gdHJ1ZVxuXG4gICAgcmV0dXJuIGZhbHNlXG4gIH1cblxuICAvKipcbiAgICogUnVucyBhIGNhbGxiYWNrIGluc2lkZSBhIGRhdGFiYXNlIHRyYW5zYWN0aW9uIChvciBhIHNhdmVwb2ludCB3aGVuIGFscmVhZHkgaW5zaWRlIG9uZSkuXG4gICAqIFRoZSBvdXRlcm1vc3QgdHJhbnNhY3Rpb24gcmV0cmllcyB0aGUgd2hvbGUgY2FsbGJhY2sgb24gYSBkZWFkbG9jayAvIGxvY2std2FpdC10aW1lb3V0LFxuICAgKiBiZWNhdXNlIHN1Y2ggZXJyb3JzIHJvbGwgdGhlIGVudGlyZSB0cmFuc2FjdGlvbiBiYWNrIGFuZCB0aGUgc3RhbmRhcmQgcmVjb3ZlcnkgaXMgdG9cbiAgICogcmVzdGFydCBpdC4gTmVzdGVkIHNhdmVwb2ludHMgbGV0IHRoZSBkZWFkbG9jayBidWJibGUgdXAgdG8gdGhpcyBvdXRlciByZXRyeS5cbiAgICogQHRlbXBsYXRlIFRcbiAgICogQHBhcmFtIHsoKSA9PiBQcm9taXNlPFQ+fSBjYWxsYmFjayAtIENhbGxiYWNrIGZ1bmN0aW9uLlxuICAgKiBAcGFyYW0ge1BpY2s8UXVlcnlPcHRpb25zLCBcIm9wZXJhdGlvbk93bmVyXCI+fSBbb3B0aW9uc10gLSBUcmFuc2FjdGlvbiBvd25lcnNoaXAuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPFQ+fSAtIFJlc29sdmVzIHdpdGggdGhlIHRyYW5zYWN0aW9uIHJlc3VsdC5cbiAgICovXG4gIGFzeW5jIHRyYW5zYWN0aW9uKGNhbGxiYWNrLCBvcHRpb25zID0ge30pIHtcbiAgICBhd2FpdCB0aGlzLl93YWl0Rm9yT3BlcmF0aW9uTGVhc2Uob3B0aW9ucy5vcGVyYXRpb25Pd25lcilcblxuICAgIHJldHVybiBhd2FpdCBjb29yZGluYXRlU2hhcmVkVHJhbnNhY3Rpb25Db25uZWN0aW9uKHRoaXMsIGFzeW5jICgpID0+IHtcbiAgICAgIGlmICh0aGlzLl90cmFuc2FjdGlvbnNDb3VudCA+IDApIHtcbiAgICAgICAgcmV0dXJuIGF3YWl0IHRoaXMuX3J1blRyYW5zYWN0aW9uQXR0ZW1wdChjYWxsYmFjaywgb3B0aW9ucylcbiAgICAgIH1cblxuICAgICAgY29uc3QgYXJncyA9IHRoaXMuZ2V0QXJncygpXG4gICAgICBjb25zdCBtYXhBdHRlbXB0cyA9IG9wdGlvbmFsUG9zaXRpdmVJbnRlZ2VyKGFyZ3MuZGVhZGxvY2tNYXhSZXRyaWVzLCBcImRlYWRsb2NrTWF4UmV0cmllc1wiKSA/PyA4XG4gICAgICBjb25zdCBjb25maWd1cmVkQmFzZVdhaXRNcyA9IG9wdGlvbmFsUG9zaXRpdmVJbnRlZ2VyKGFyZ3MuZGVhZGxvY2tCYXNlV2FpdE1zLCBcImRlYWRsb2NrQmFzZVdhaXRNc1wiKVxuICAgICAgY29uc3QgZGVhZGxvY2tNYXhXYWl0TXMgPSBvcHRpb25hbFBvc2l0aXZlSW50ZWdlcihhcmdzLmRlYWRsb2NrTWF4V2FpdE1zLCBcImRlYWRsb2NrTWF4V2FpdE1zXCIpID8/IDEwMDBcbiAgICAgIGxldCBhdHRlbXB0ID0gMFxuXG4gICAgICB3aGlsZSAodHJ1ZSkge1xuICAgICAgICBhdHRlbXB0KytcbiAgICAgICAgY29uc3QgYXR0ZW1wdFN0YXJ0ZWRBdE1zID0gdGhpcy5fbm93TXMoKVxuXG4gICAgICAgIHRyeSB7XG4gICAgICAgICAgcmV0dXJuIGF3YWl0IHRoaXMuX3J1blRyYW5zYWN0aW9uQXR0ZW1wdChjYWxsYmFjaywgb3B0aW9ucylcbiAgICAgICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgICAgICBpZiAoZXJyb3IgaW5zdGFuY2VvZiBWZWxvY2lvdXNEYXRhYmFzZUFmdGVyQ29tbWl0Q2FsbGJhY2tFcnJvcikgdGhyb3cgZXJyb3IuY2FsbGJhY2tFcnJvclxuICAgICAgICAgIGlmICghKGVycm9yIGluc3RhbmNlb2YgRXJyb3IpKSB0aHJvdyBlcnJvclxuXG4gICAgICAgICAgY29uc3QgcmV0cnlJbmZvID0gdGhpcy5yZXRyeWFibGVEYXRhYmFzZUVycm9yKGVycm9yKVxuICAgICAgICAgIGNvbnN0IHdpbGxSZXRyeSA9IEJvb2xlYW4ocmV0cnlJbmZvLmRlYWRsb2NrICYmIGF0dGVtcHQgPCBtYXhBdHRlbXB0cyAmJiB0aGlzLl90cmFuc2FjdGlvbnNDb3VudCA9PSAwKVxuXG4gICAgICAgICAgaWYgKHdpbGxSZXRyeSkge1xuICAgICAgICAgICAgdGhpcy5fcmVwb3J0RGVhZGxvY2tSZXRyeURpYWdub3N0aWMoe1xuICAgICAgICAgICAgICBhdHRlbXB0LFxuICAgICAgICAgICAgICBjb250ZW50aW9uS2luZDogcmV0cnlJbmZvLmNvbnRlbnRpb25LaW5kIHx8IFwiZGVhZGxvY2tcIixcbiAgICAgICAgICAgICAgZXJyb3IsXG4gICAgICAgICAgICAgIG1heEF0dGVtcHRzLFxuICAgICAgICAgICAgICB0cmFuc2FjdGlvbkF0dGVtcHREdXJhdGlvbk1zOiBNYXRoLm1heCgwLCB0aGlzLl9ub3dNcygpIC0gYXR0ZW1wdFN0YXJ0ZWRBdE1zKSxcbiAgICAgICAgICAgICAgd2lsbFJldHJ5XG4gICAgICAgICAgICB9KVxuXG4gICAgICAgICAgICAvLyBBbiBleHBsaWNpdGx5LWNvbmZpZ3VyZWQgYmFzZSB3aW5zIHNvIHRoZSB0dW5pbmcga25vYiBpcyBlZmZlY3RpdmUgZXZlbiBvbiBkcml2ZXJzXG4gICAgICAgICAgICAvLyB3aG9zZSBjbGFzc2lmaWVyIHN1cHBsaWVzIGl0cyBvd24gYHdhaXRNc2AgKE15U1FML01hcmlhREIgcmV0dXJuIGEgZml4ZWQgNTBtcyBmb3JcbiAgICAgICAgICAgIC8vIGRlYWRsb2Nrcyk7IG90aGVyd2lzZSBob25vciB0aGF0IGNsYXNzaWZpZXIgaGludCwgdGhlbiBmYWxsIGJhY2sgdG8gNTBtcy5cbiAgICAgICAgICAgIGNvbnN0IGJhc2VXYWl0TXMgPSBjb25maWd1cmVkQmFzZVdhaXRNcyA/PyAodHlwZW9mIHJldHJ5SW5mby53YWl0TXMgPT0gXCJudW1iZXJcIiAmJiByZXRyeUluZm8ud2FpdE1zID4gMCA/IHJldHJ5SW5mby53YWl0TXMgOiA1MClcblxuICAgICAgICAgICAgLy8gRnVsbC1qaXR0ZXIgZXhwb25lbnRpYWwgYmFja29mZjogd2FpdCBhIHVuaWZvcm0tcmFuZG9tIGR1cmF0aW9uIGluXG4gICAgICAgICAgICAvLyBbMCwgbWluKGJhc2UgKiAyXihhdHRlbXB0LTEpLCBjYXApXS4gVGhlIGRvdWJsaW5nIGNlaWxpbmcgc3ByZWFkcyByZXRyaWVzIG91dCBhc1xuICAgICAgICAgICAgLy8gY29udGVudGlvbiBwZXJzaXN0cywgYW5kIHRoZSBqaXR0ZXIgZGUtY29ycmVsYXRlcyB0cmFuc2FjdGlvbnMgdGhhdCBkZWFkbG9ja2VkIGluXG4gICAgICAgICAgICAvLyBsb2Nrc3RlcCBzbyB0aGV5IHN0b3AgcmUtY29sbGlkaW5nIG9uIHRoZSBzYW1lIHdhaXQgKHRoZSBsaW5lYXIgYGJhc2UgKiBhdHRlbXB0YFxuICAgICAgICAgICAgLy8gdGhpcyByZXBsYWNlcyBoYWQgZXZlcnkgdmljdGltIHJldHJ5IGFmdGVyIGFuIGlkZW50aWNhbCBkZWxheSkuIGBhdHRlbXB0YCBpc1xuICAgICAgICAgICAgLy8gMS1iYXNlZCBoZXJlLCBzbyAyXihhdHRlbXB0LTEpIGlzIDEsIDIsIDQsIC4uLiBUaGUgY2FwIGtlZXBzIHRoZSB0YWlsIHN1Yi1zZWNvbmQuXG4gICAgICAgICAgICBjb25zdCBjZWlsaW5nV2FpdE1zID0gTWF0aC5taW4oYmFzZVdhaXRNcyAqICgyICoqIChhdHRlbXB0IC0gMSkpLCBkZWFkbG9ja01heFdhaXRNcylcbiAgICAgICAgICAgIGNvbnN0IGppdHRlcmVkV2FpdE1zID0gTWF0aC5mbG9vcihNYXRoLnJhbmRvbSgpICogKGNlaWxpbmdXYWl0TXMgKyAxKSlcblxuICAgICAgICAgICAgY29uc3QgbG9nZ2VkQ29udGVudGlvbktpbmQgPSByZXRyeUluZm8uY29udGVudGlvbktpbmQgfHwgXCJ0cmFuc2FjdGlvbiBjb250ZW50aW9uXCJcblxuICAgICAgICAgICAgdGhpcy5sb2dnZXIud2FybihgUmV0cnlpbmcgdHJhbnNhY3Rpb24gYWZ0ZXIgJHtsb2dnZWRDb250ZW50aW9uS2luZH0gKGF0dGVtcHQgJHthdHRlbXB0fS8ke21heEF0dGVtcHRzfSlgKVxuICAgICAgICAgICAgYXdhaXQgdGhpcy5fd2FpdE1zKGppdHRlcmVkV2FpdE1zKVxuICAgICAgICAgICAgY29udGludWVcbiAgICAgICAgICB9XG5cbiAgICAgICAgICB0aHJvdyBlcnJvclxuICAgICAgICB9XG4gICAgICB9XG4gICAgfSwgb3B0aW9ucy5vcGVyYXRpb25Pd25lcilcbiAgfVxuXG4gIC8qKlxuICAgKiBXYWl0cyBgbXNgIG1pbGxpc2Vjb25kcy4gSXNvbGF0ZWQgaW4gaXRzIG93biBtZXRob2Qgc28gdGVzdHMgY2FuIG9ic2VydmUgKGFuZCBza2lwKSB0aGVcbiAgICogZGVhZGxvY2stcmV0cnkgYmFja29mZiB3aXRob3V0IGEgcmVhbCB0aW1lci5cbiAgICogQHBhcmFtIHtudW1iZXJ9IG1zIC0gTWlsbGlzZWNvbmRzIHRvIHdhaXQuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIGFmdGVyIHRoZSBkZWxheS5cbiAgICovXG4gIGFzeW5jIF93YWl0TXMobXMpIHtcbiAgICBhd2FpdCB3YWl0KG1zKVxuICB9XG5cbiAgLyoqXG4gICAqIFJldHVybnMgdGhlIGNsb2NrIHVzZWQgZm9yIHRyYW5zYWN0aW9uLWF0dGVtcHQgZGlhZ25vc3RpY3MuXG4gICAqIEByZXR1cm5zIHtudW1iZXJ9IC0gTW9ub3RvbmljIG1pbGxpc2Vjb25kcyB3aGVyZSBhdmFpbGFibGUuXG4gICAqL1xuICBfbm93TXMoKSB7XG4gICAgcmV0dXJuIG5vd01zKClcbiAgfVxuXG4gIC8qKlxuICAgKiBTdGFydHMgYmVzdC1lZmZvcnQgZGVhZGxvY2sgZGlhZ25vc3RpY3Mgd2l0aG91dCBqb2luaW5nIHRoZSByZXRyeSBjb250cm9sIGZsb3cuIFN1YmNsYXNzZXMgbWF5XG4gICAqIGFkZCBib3VuZGVkIGRyaXZlci1zcGVjaWZpYyBjb250ZXh0OyBjYXB0dXJlIGFuZCBldmVudC1saXN0ZW5lciBmYWlsdXJlcyBjYW5ub3QgYWZmZWN0IHJldHJ5LlxuICAgKiBAcGFyYW0ge3thdHRlbXB0OiBudW1iZXIsIGNvbnRlbnRpb25LaW5kOiBcImRlYWRsb2NrXCIgfCBcImxvY2std2FpdC10aW1lb3V0XCIsIGVycm9yOiBFcnJvciwgbWF4QXR0ZW1wdHM6IG51bWJlciwgdHJhbnNhY3Rpb25BdHRlbXB0RHVyYXRpb25NczogbnVtYmVyLCB3aWxsUmV0cnk6IGJvb2xlYW59fSBhcmdzIC0gUmV0cnkgbWV0YWRhdGEuXG4gICAqIEByZXR1cm5zIHt2b2lkfVxuICAgKi9cbiAgX3JlcG9ydERlYWRsb2NrUmV0cnlEaWFnbm9zdGljKHthdHRlbXB0LCBjb250ZW50aW9uS2luZCwgZXJyb3IsIG1heEF0dGVtcHRzLCB0cmFuc2FjdGlvbkF0dGVtcHREdXJhdGlvbk1zLCB3aWxsUmV0cnl9KSB7XG4gICAgbGV0IHNuYXBzaG90XG5cbiAgICB0cnkge1xuICAgICAgY29uc3QgcXVlcnlEaWFnbm9zdGljID0gdGhpcy5fZmFpbGVkUXVlcnlEaWFnbm9zdGljcy5nZXQoZXJyb3IpXG5cbiAgICAgIHNuYXBzaG90ID0gT2JqZWN0LmZyZWV6ZSh7XG4gICAgICAgIGF0dGVtcHQsXG4gICAgICAgIGNvbnRlbnRpb25LaW5kLFxuICAgICAgICBkcml2ZXJUeXBlOiB0aGlzLmdldFR5cGUoKSxcbiAgICAgICAgbWF4QXR0ZW1wdHMsXG4gICAgICAgIHN0YWdlOiBcImRhdGFiYXNlLWRlYWRsb2NrLXJldHJ5XCIsXG4gICAgICAgIHRyYW5zYWN0aW9uQXR0ZW1wdER1cmF0aW9uTXMsXG4gICAgICAgIHdpbGxSZXRyeSxcbiAgICAgICAgLi4udGhpcy5fcG9vbERpYWdub3N0aWNJZGVudGl0eUNvbnRleHQoKSxcbiAgICAgICAgLi4udGhpcy5fb3BlcmF0aW9uRGlhZ25vc3RpY0NvbnRleHQoKSxcbiAgICAgICAgLi4ucXVlcnlEaWFnbm9zdGljXG4gICAgICB9KVxuICAgIH0gY2F0Y2ggKGRpYWdub3N0aWNFcnJvcikge1xuICAgICAgdGhpcy5fcmVwb3J0RGVhZGxvY2tEaWFnbm9zdGljUGlwZWxpbmVGYWlsdXJlKGRpYWdub3N0aWNFcnJvcilcbiAgICAgIHJldHVyblxuICAgIH1cblxuICAgIGxldCBkcml2ZXJDb250ZXh0UmVzdWx0XG5cbiAgICB0cnkge1xuICAgICAgZHJpdmVyQ29udGV4dFJlc3VsdCA9IHRoaXMuX2RlYWRsb2NrRGlhZ25vc3RpY0NvbnRleHQoc25hcHNob3QpXG4gICAgfSBjYXRjaCAoZGlhZ25vc3RpY0Vycm9yKSB7XG4gICAgICB0aGlzLl9yZXBvcnREZWFkbG9ja0RpYWdub3N0aWNQaXBlbGluZUZhaWx1cmUoZGlhZ25vc3RpY0Vycm9yKVxuICAgICAgcmV0dXJuXG4gICAgfVxuXG4gICAgY29uc3QgaGFzUHJvbWlzZUNvbnRyYWN0ID0gZHJpdmVyQ29udGV4dFJlc3VsdCBpbnN0YW5jZW9mIFByb21pc2VcblxuICAgIHZvaWQgUHJvbWlzZS5yZXNvbHZlKGRyaXZlckNvbnRleHRSZXN1bHQpXG4gICAgICAudGhlbigoZHJpdmVyQ29udGV4dCkgPT4ge1xuICAgICAgICBpZiAoIWhhc1Byb21pc2VDb250cmFjdCkgdGhyb3cgbmV3IEVycm9yKFwiRGF0YWJhc2UgZGVhZGxvY2sgZGlhZ25vc3RpYyBjb250ZXh0IG11c3QgcmV0dXJuIGEgUHJvbWlzZVwiKVxuXG4gICAgICAgIGNvbnN0IGNvbnRleHQgPSB7XG4gICAgICAgICAgLi4uc25hcHNob3QsXG4gICAgICAgICAgLi4uZHJpdmVyQ29udGV4dFxuICAgICAgICB9XG4gICAgICAgIGNvbnN0IHBheWxvYWQgPSB7XG4gICAgICAgICAgY29udGV4dCxcbiAgICAgICAgICBlcnJvcjogbmV3IEVycm9yKHdpbGxSZXRyeVxuICAgICAgICAgICAgPyBgRGF0YWJhc2UgdHJhbnNhY3Rpb24gJHtjb250ZW50aW9uS2luZH0gd2lsbCBiZSByZXRyaWVkYFxuICAgICAgICAgICAgOiBgRGF0YWJhc2UgdHJhbnNhY3Rpb24gJHtjb250ZW50aW9uS2luZH0gZXhoYXVzdGVkIGl0cyByZXRyeSBidWRnZXRgKVxuICAgICAgICB9XG4gICAgICAgIGNvbnN0IGVycm9yRXZlbnRzID0gdGhpcy5jb25maWd1cmF0aW9uLmdldEVycm9yRXZlbnRzKClcblxuICAgICAgICB0cnkge1xuICAgICAgICAgIGVycm9yRXZlbnRzLmVtaXQoXCJkYXRhYmFzZS1kZWFkbG9jay1yZXRyeVwiLCBwYXlsb2FkKVxuICAgICAgICB9IGNhdGNoIChldmVudEVycm9yKSB7XG4gICAgICAgICAgdGhpcy5sb2dnZXIud2FybihcIkRhdGFiYXNlIGRlYWRsb2NrIHJldHJ5IGRpYWdub3N0aWMgbGlzdGVuZXIgZmFpbGVkXCIsIHtlcnJvcjogZXZlbnRFcnJvcn0pXG4gICAgICAgIH1cblxuICAgICAgICB0cnkge1xuICAgICAgICAgIGVycm9yRXZlbnRzLmVtaXQoXCJhbGwtZXJyb3JcIiwgey4uLnBheWxvYWQsIGVycm9yVHlwZTogXCJkYXRhYmFzZS1kZWFkbG9jay1yZXRyeVwifSlcbiAgICAgICAgfSBjYXRjaCAoZXZlbnRFcnJvcikge1xuICAgICAgICAgIHRoaXMubG9nZ2VyLndhcm4oXCJEYXRhYmFzZSBkZWFkbG9jayByZXRyeSBhbGwtZXJyb3IgbGlzdGVuZXIgZmFpbGVkXCIsIHtlcnJvcjogZXZlbnRFcnJvcn0pXG4gICAgICAgIH1cbiAgICAgIH0pXG4gICAgICAuY2F0Y2goKGRpYWdub3N0aWNFcnJvcikgPT4gdGhpcy5fcmVwb3J0RGVhZGxvY2tEaWFnbm9zdGljUGlwZWxpbmVGYWlsdXJlKGRpYWdub3N0aWNFcnJvcikpXG4gIH1cblxuICAvKipcbiAgICogUmV0dXJucyBwb29sIGlkZW50aXR5IG9ubHkgd2hlbiB0aGlzIGRyaXZlciB3YXMgc3RhbXBlZCBieSBhIHBvb2wuXG4gICAqIEByZXR1cm5zIHt7ZGF0YWJhc2VJZGVudGlmaWVyPzogc3RyaW5nLCBkYXRhYmFzZUlkZW50aWZpZXJGaW5nZXJwcmludD86IHN0cmluZywgZGF0YWJhc2VJZGVudGl0eUZpbmdlcnByaW50Pzogc3RyaW5nfX0gLSBTYWZlIHBvb2wgaWRlbnRpdHkuXG4gICAqL1xuICBfcG9vbERpYWdub3N0aWNJZGVudGl0eUNvbnRleHQoKSB7XG4gICAgaWYgKHRoaXMuX2RhdGFiYXNlSWRlbnRpZmllciA9PT0gdW5kZWZpbmVkIHx8ICF0aGlzLl9kYXRhYmFzZUlkZW50aXR5RmluZ2VycHJpbnQpIHJldHVybiB7fVxuXG4gICAgY29uc3QgaWRlbnRpZmllckZpbmdlcnByaW50SW5wdXQgPSB0eXBlb2YgdGhpcy5fZGF0YWJhc2VJZGVudGlmaWVyID09PSBcInN0cmluZ1wiXG4gICAgICA/IHRoaXMuX2RhdGFiYXNlSWRlbnRpZmllclxuICAgICAgOiBgaW52YWxpZDoke3R5cGVvZiB0aGlzLl9kYXRhYmFzZUlkZW50aWZpZXJ9YFxuICAgIGNvbnN0IGRhdGFiYXNlSWRlbnRpZmllckZpbmdlcnByaW50ID0gYHNoYTI1Njoke3NoYTI1NkhleChgZGF0YWJhc2UtbG9naWNhbC1pZGVudGlmaWVyOnYxXFwwJHtpZGVudGlmaWVyRmluZ2VycHJpbnRJbnB1dH1gKX1gXG5cbiAgICByZXR1cm4ge1xuICAgICAgZGF0YWJhc2VJZGVudGlmaWVyOiBSRURBQ1RFRF9ESUFHTk9TVElDX0xBQkVMLFxuICAgICAgZGF0YWJhc2VJZGVudGlmaWVyRmluZ2VycHJpbnQsXG4gICAgICBkYXRhYmFzZUlkZW50aXR5RmluZ2VycHJpbnQ6IHRoaXMuX2RhdGFiYXNlSWRlbnRpdHlGaW5nZXJwcmludFxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBCdWlsZHMgdGhlIGJvdW5kZWQgb3BlcmF0aW9uIHBvcnRpb24gb2YgYW4gaW1tdXRhYmxlIHJldHJ5IHNuYXBzaG90LlxuICAgKiBAcmV0dXJucyB7e29wZXJhdGlvbk5hbWU/OiBzdHJpbmcsIG9wZXJhdGlvbk5hbWVGaW5nZXJwcmludD86IHN0cmluZ319IC0gU2FmZSBvcGVyYXRpb24gZmllbGRzLlxuICAgKi9cbiAgX29wZXJhdGlvbkRpYWdub3N0aWNDb250ZXh0KCkge1xuICAgIGNvbnN0IHJhd09wZXJhdGlvbk5hbWUgPSB0aGlzLl9jb25uZWN0aW9uQ2hlY2tvdXROYW1lXG5cbiAgICBpZiAocmF3T3BlcmF0aW9uTmFtZSA9PT0gdW5kZWZpbmVkKSByZXR1cm4ge31cbiAgICBpZiAodHlwZW9mIHJhd09wZXJhdGlvbk5hbWUgIT09IFwic3RyaW5nXCIpIHtcbiAgICAgIHJldHVybiB7XG4gICAgICAgIG9wZXJhdGlvbk5hbWU6IFJFREFDVEVEX0RJQUdOT1NUSUNfTEFCRUwsXG4gICAgICAgIG9wZXJhdGlvbk5hbWVGaW5nZXJwcmludDogYHNoYTI1Njoke3NoYTI1NkhleChgZGF0YWJhc2Utb3BlcmF0aW9uOnYxXFwwaW52YWxpZDoke3R5cGVvZiByYXdPcGVyYXRpb25OYW1lfWApfWBcbiAgICAgIH1cbiAgICB9XG5cbiAgICBjb25zdCBzY2FubmVkT3BlcmF0aW9uTmFtZSA9IHJhd09wZXJhdGlvbk5hbWUuc2xpY2UoMCwgT1BFUkFUSU9OX05BTUVfU0NBTl9MSU1JVClcbiAgICBjb25zdCBvcGVyYXRpb25OYW1lRmluZ2VycHJpbnQgPSBgc2hhMjU2OiR7c2hhMjU2SGV4KGBkYXRhYmFzZS1vcGVyYXRpb246djFcXDAke3NjYW5uZWRPcGVyYXRpb25OYW1lfVxcMGxlbmd0aDoke3Jhd09wZXJhdGlvbk5hbWUubGVuZ3RofWApfWBcblxuICAgIHJldHVybiB7XG4gICAgICBvcGVyYXRpb25OYW1lOiBSRURBQ1RFRF9ESUFHTk9TVElDX0xBQkVMLFxuICAgICAgb3BlcmF0aW9uTmFtZUZpbmdlcnByaW50XG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIFJlcG9ydHMgYW4gdW5leHBlY3RlZCBkZXRhY2hlZCBkaWFnbm9zdGljcyBmYWlsdXJlIHdpdGhvdXQgY2hhbmdpbmcgdHJhbnNhY3Rpb24gY29udHJvbCBmbG93LlxuICAgKiBAcGFyYW0ge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSBkaWFnbm9zdGljRXJyb3IgLSBEaWFnbm9zdGljcyBmYWlsdXJlLlxuICAgKiBAcmV0dXJucyB7dm9pZH1cbiAgICovXG4gIF9yZXBvcnREZWFkbG9ja0RpYWdub3N0aWNQaXBlbGluZUZhaWx1cmUoZGlhZ25vc3RpY0Vycm9yKSB7XG4gICAgY29uc3Qgbm9ybWFsaXplZEVycm9yID0gZGlhZ25vc3RpY0Vycm9yIGluc3RhbmNlb2YgRXJyb3JcbiAgICAgID8gZGlhZ25vc3RpY0Vycm9yXG4gICAgICA6IG5ldyBFcnJvcihcIkRhdGFiYXNlIGRlYWRsb2NrIHJldHJ5IGRpYWdub3N0aWMgZmFpbGVkXCIsIHtjYXVzZTogZGlhZ25vc3RpY0Vycm9yfSlcbiAgICBjb25zdCBwYXlsb2FkID0ge1xuICAgICAgY29udGV4dDoge3N0YWdlOiBcImRhdGFiYXNlLWRlYWRsb2NrLXJldHJ5LWRpYWdub3N0aWNcIn0sXG4gICAgICBlcnJvcjogbm9ybWFsaXplZEVycm9yXG4gICAgfVxuICAgIGxldCBlcnJvckV2ZW50c1xuXG4gICAgdHJ5IHtcbiAgICAgIGVycm9yRXZlbnRzID0gdGhpcy5jb25maWd1cmF0aW9uLmdldEVycm9yRXZlbnRzKClcbiAgICB9IGNhdGNoIChyZXBvcnRpbmdFcnJvcikge1xuICAgICAgdGhpcy5sb2dnZXIud2FybihcIkRhdGFiYXNlIGRlYWRsb2NrIHJldHJ5IGRpYWdub3N0aWMgcGlwZWxpbmUgcmVwb3J0aW5nIGZhaWxlZFwiLCB7ZXJyb3I6IG5vcm1hbGl6ZWRFcnJvciwgcmVwb3J0aW5nRXJyb3J9KVxuICAgICAgcmV0dXJuXG4gICAgfVxuXG4gICAgdHJ5IHtcbiAgICAgIGVycm9yRXZlbnRzLmVtaXQoXCJmcmFtZXdvcmstZXJyb3JcIiwgcGF5bG9hZClcbiAgICB9IGNhdGNoIChyZXBvcnRpbmdFcnJvcikge1xuICAgICAgdGhpcy5sb2dnZXIud2FybihcIkRhdGFiYXNlIGRlYWRsb2NrIHJldHJ5IGZyYW1ld29yay1lcnJvciBsaXN0ZW5lciBmYWlsZWRcIiwge2Vycm9yOiBub3JtYWxpemVkRXJyb3IsIHJlcG9ydGluZ0Vycm9yfSlcbiAgICB9XG5cbiAgICB0cnkge1xuICAgICAgZXJyb3JFdmVudHMuZW1pdChcImFsbC1lcnJvclwiLCB7Li4ucGF5bG9hZCwgZXJyb3JUeXBlOiBcImZyYW1ld29yay1lcnJvclwifSlcbiAgICB9IGNhdGNoIChyZXBvcnRpbmdFcnJvcikge1xuICAgICAgdGhpcy5sb2dnZXIud2FybihcIkRhdGFiYXNlIGRlYWRsb2NrIHJldHJ5IGFsbC1lcnJvciBsaXN0ZW5lciBmYWlsZWRcIiwge2Vycm9yOiBub3JtYWxpemVkRXJyb3IsIHJlcG9ydGluZ0Vycm9yfSlcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogQnVpbGRzIGRyaXZlci1zcGVjaWZpYyBkZWFkbG9jayBjb250ZXh0LiBUaGUgYmFzZSBkcml2ZXIgaGFzIG5vIHNlcnZlciBkaWFnbm9zdGljIHNvdXJjZS5cbiAgICogQHBhcmFtIHtEZWFkbG9ja1JldHJ5RGlhZ25vc3RpY1NuYXBzaG90fSBfc25hcHNob3QgLSBJbW11dGFibGUgcmV0cnkgc25hcHNob3QuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPFJlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pj59IC0gU2FmZSBjb250ZXh0IGZpZWxkcy5cbiAgICovXG4gIGFzeW5jIF9kZWFkbG9ja0RpYWdub3N0aWNDb250ZXh0KF9zbmFwc2hvdCkge1xuICAgIHJldHVybiB7fVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgYSBzaW5nbGUgdHJhbnNhY3Rpb24gYXR0ZW1wdDogc3RhcnRzIGEgdHJhbnNhY3Rpb24gKG9yIGEgc2F2ZXBvaW50IHdoZW4gbmVzdGVkKSwgcnVuc1xuICAgKiBgY2FsbGJhY2tgLCBhbmQgY29tbWl0cyDigJQgcm9sbGluZyBiYWNrIG9uIGVycm9yLiB7QGxpbmsgdHJhbnNhY3Rpb259IHdyYXBzIHRoaXMgd2l0aCBkZWFkbG9ja1xuICAgKiByZXRyeSBhdCB0aGUgb3V0ZXJtb3N0IGxldmVsLlxuICAgKiBAdGVtcGxhdGUgVFxuICAgKiBAcGFyYW0geygpID0+IFByb21pc2U8VD59IGNhbGxiYWNrIC0gQ2FsbGJhY2sgZnVuY3Rpb24uXG4gICAqIEBwYXJhbSB7UGljazxRdWVyeU9wdGlvbnMsIFwib3BlcmF0aW9uT3duZXJcIj59IG9wdGlvbnMgLSBUcmFuc2FjdGlvbiBvd25lcnNoaXAuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gLSBSZXNvbHZlcyB3aXRoIHRoZSB0cmFuc2FjdGlvbiByZXN1bHQuXG4gICAqL1xuICBhc3luYyBfcnVuVHJhbnNhY3Rpb25BdHRlbXB0KGNhbGxiYWNrLCBvcHRpb25zKSB7XG4gICAgY29uc3Qgc2F2ZVBvaW50TmFtZSA9IHRoaXMuZ2VuZXJhdGVTYXZlUG9pbnROYW1lKClcbiAgICAvKiogQHR5cGUge1RyYW5zYWN0aW9uQ2FsbGJhY2tGcmFtZX0gKi9cbiAgICBjb25zdCBjYWxsYmFja0ZyYW1lID0ge1xuICAgICAgYWZ0ZXJDb21taXRDYWxsYmFja3M6IFtdLFxuICAgICAgYmVmb3JlQ29tbWl0Q2FsbGJhY2tzOiBbXVxuICAgIH1cbiAgICBsZXQgdHJhbnNhY3Rpb25TdGFydGVkID0gZmFsc2VcbiAgICBsZXQgc2F2ZVBvaW50U3RhcnRlZCA9IGZhbHNlXG5cbiAgICB0aGlzLl90cmFuc2FjdGlvbkNhbGxiYWNrRnJhbWVzLnB1c2goY2FsbGJhY2tGcmFtZSlcblxuICAgIHRyeSB7XG4gICAgICBpZiAodGhpcy5fdHJhbnNhY3Rpb25zQ291bnQgPT0gMCkge1xuICAgICAgICB0aGlzLmxvZ2dlci5kZWJ1ZyhcIlN0YXJ0IHRyYW5zYWN0aW9uXCIpXG4gICAgICAgIGF3YWl0IHRoaXMuc3RhcnRUcmFuc2FjdGlvbihvcHRpb25zKVxuICAgICAgICB0cmFuc2FjdGlvblN0YXJ0ZWQgPSB0cnVlXG4gICAgICB9IGVsc2Uge1xuICAgICAgICB0aGlzLmxvZ2dlci5kZWJ1ZyhcIlN0YXJ0IHNhdmVwb2ludFwiLCBzYXZlUG9pbnROYW1lKVxuICAgICAgICBhd2FpdCB0aGlzLnN0YXJ0U2F2ZVBvaW50KHNhdmVQb2ludE5hbWUsIG9wdGlvbnMpXG4gICAgICAgIHNhdmVQb2ludFN0YXJ0ZWQgPSB0cnVlXG4gICAgICB9XG4gICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgIHRoaXMuX3RyYW5zYWN0aW9uQ2FsbGJhY2tGcmFtZXMucG9wKClcbiAgICAgIHRocm93IGVycm9yXG4gICAgfVxuXG4gICAgbGV0IHJlc3VsdFxuXG4gICAgdHJ5IHtcbiAgICAgIHJlc3VsdCA9IGF3YWl0IGNhbGxiYWNrKClcbiAgICAgIGF3YWl0IHRoaXMuX3J1bkJlZm9yZUNvbW1pdENhbGxiYWNrcyhjYWxsYmFja0ZyYW1lKVxuXG4gICAgICBpZiAoc2F2ZVBvaW50U3RhcnRlZCkge1xuICAgICAgICB0aGlzLmxvZ2dlci5kZWJ1ZyhcIlJlbGVhc2Ugc2F2ZXBvaW50XCIsIHNhdmVQb2ludE5hbWUpXG4gICAgICAgIGF3YWl0IHRoaXMucmVsZWFzZVNhdmVQb2ludChzYXZlUG9pbnROYW1lLCBvcHRpb25zKVxuICAgICAgfVxuXG4gICAgICBpZiAodHJhbnNhY3Rpb25TdGFydGVkKSB7XG4gICAgICAgIHRoaXMubG9nZ2VyLmRlYnVnKFwiQ29tbWl0IHRyYW5zYWN0aW9uXCIpXG4gICAgICAgIGF3YWl0IHRoaXMuY29tbWl0VHJhbnNhY3Rpb24ob3B0aW9ucylcbiAgICAgIH1cbiAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgaWYgKGVycm9yIGluc3RhbmNlb2YgRXJyb3IpIHtcbiAgICAgICAgdGhpcy5sb2dnZXIuZGVidWcoXCJUcmFuc2FjdGlvbiBlcnJvclwiLCBlcnJvci5tZXNzYWdlKVxuICAgICAgfSBlbHNlIHtcbiAgICAgICAgdGhpcy5sb2dnZXIuZGVidWcoXCJUcmFuc2FjdGlvbiBlcnJvclwiLCBlcnJvcilcbiAgICAgIH1cblxuICAgICAgdHJ5IHtcbiAgICAgICAgbGV0IHRyYW5zYWN0aW9uUm9sbGVkQmFjayA9IGZhbHNlXG5cbiAgICAgICAgaWYgKHNhdmVQb2ludFN0YXJ0ZWQpIHtcbiAgICAgICAgICB0aGlzLmxvZ2dlci5kZWJ1ZyhcIlJvbGxiYWNrIHNhdmVwb2ludFwiLCBzYXZlUG9pbnROYW1lKVxuICAgICAgICAgIHRyeSB7XG4gICAgICAgICAgICBhd2FpdCB0aGlzLnJvbGxiYWNrU2F2ZVBvaW50KHNhdmVQb2ludE5hbWUsIG9wdGlvbnMpXG4gICAgICAgICAgfSBjYXRjaCAoc2F2ZVBvaW50RXJyb3IpIHtcbiAgICAgICAgICAgIGNvbnN0IG1lc3NhZ2UgPSBzYXZlUG9pbnRFcnJvciBpbnN0YW5jZW9mIEVycm9yID8gc2F2ZVBvaW50RXJyb3IubWVzc2FnZSA6IGAke3NhdmVQb2ludEVycm9yfWBcblxuICAgICAgICAgICAgLy8gTXlTUUwgc29tZXRpbWVzIGRyb3BzIHNhdmVwb2ludHMgdW5leHBlY3RlZGx5OyBmYWxsIGJhY2sgdG8gcm9sbGluZyBiYWNrIHRoZSBmdWxsIHRyYW5zYWN0aW9uXG4gICAgICAgICAgICBpZiAobWVzc2FnZS5pbmNsdWRlcyhcIlNBVkVQT0lOVFwiKSB8fCBtZXNzYWdlLmluY2x1ZGVzKFwiRVJfU1BfRE9FU19OT1RfRVhJU1RcIikpIHtcbiAgICAgICAgICAgICAgdGhpcy5sb2dnZXIuZGVidWcoXCJTYXZlcG9pbnQgcm9sbGJhY2sgZmFpbGVkOyByb2xsaW5nIGJhY2sgZW50aXJlIHRyYW5zYWN0aW9uIGluc3RlYWRcIilcbiAgICAgICAgICAgICAgYXdhaXQgdGhpcy5yb2xsYmFja1RyYW5zYWN0aW9uKG9wdGlvbnMpXG4gICAgICAgICAgICAgIHRyYW5zYWN0aW9uUm9sbGVkQmFjayA9IHRydWVcbiAgICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICAgIHRocm93IHNhdmVQb2ludEVycm9yXG4gICAgICAgICAgICB9XG4gICAgICAgICAgfVxuICAgICAgICB9XG5cbiAgICAgICAgLy8gT25seSByb2xsIGJhY2sgaWYgYSB0cmFuc2FjdGlvbiBpcyBzdGlsbCBvcGVuLiBBIG5lc3RlZCBzYXZlcG9pbnQgd2hvc2Ugcm9sbGJhY2sgZmFpbGVkXG4gICAgICAgIC8vIGZhbGxzIGJhY2sgdG8gcm9sbGluZyBiYWNrIHRoZSB3aG9sZSB0cmFuc2FjdGlvbiAoYWJvdmUpLCB3aGljaCBhbHJlYWR5IGNsb3NlZCBpdCBhbmRcbiAgICAgICAgLy8gZHJvcHBlZCB0aGUgY291bnQgdG8gMDsgcm9sbGluZyBiYWNrIGFnYWluIGhlcmUgd291bGQgaXNzdWUgYSBzZWNvbmQgUk9MTEJBQ0sgYW5kIGRyaXZlXG4gICAgICAgIC8vIGBfdHJhbnNhY3Rpb25zQ291bnRgIGJlbG93IHplcm8sIHdoaWNoIHdvdWxkIHRoZW4gZGVmZWF0IHRoZSBvdXRlcm1vc3QgZGVhZGxvY2stcmV0cnkgZ3VhcmQuXG4gICAgICAgIGlmICh0cmFuc2FjdGlvblN0YXJ0ZWQgJiYgIXRyYW5zYWN0aW9uUm9sbGVkQmFjayAmJiB0aGlzLl90cmFuc2FjdGlvbnNDb3VudCA+IDApIHtcbiAgICAgICAgICB0aGlzLmxvZ2dlci5kZWJ1ZyhcIlJvbGxiYWNrIHRyYW5zYWN0aW9uXCIpXG4gICAgICAgICAgYXdhaXQgdGhpcy5yb2xsYmFja1RyYW5zYWN0aW9uKG9wdGlvbnMpXG4gICAgICAgIH1cbiAgICAgIH0gZmluYWxseSB7XG4gICAgICAgIHRoaXMuX3RyYW5zYWN0aW9uQ2FsbGJhY2tGcmFtZXMucG9wKClcbiAgICAgIH1cblxuICAgICAgdGhyb3cgZXJyb3JcbiAgICB9XG5cbiAgICB0cnkge1xuICAgICAgYXdhaXQgdGhpcy5fY29tbWl0VHJhbnNhY3Rpb25DYWxsYmFja0ZyYW1lKClcbiAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgdGhyb3cgbmV3IFZlbG9jaW91c0RhdGFiYXNlQWZ0ZXJDb21taXRDYWxsYmFja0Vycm9yKGVycm9yKVxuICAgIH1cblxuICAgIHJldHVybiByZXN1bHRcbiAgfVxuXG4gIC8qKlxuICAgKiBSZWdpc3RlcnMgYSBndWFyZCB0byBydW4gYWZ0ZXIgdGhlIGN1cnJlbnQgdHJhbnNhY3Rpb24gY2FsbGJhY2sgc3VjY2VlZHMgYW5kIGJlZm9yZSBpdHNcbiAgICogb3V0ZXIgY29tbWl0IG9yIG5lc3RlZCBzYXZlcG9pbnQgcmVsZWFzZS5cbiAgICogQHBhcmFtIHsoKSA9PiB2b2lkIHwgUHJvbWlzZTx2b2lkPn0gY2FsbGJhY2sgLSBHdWFyZCBjYWxsYmFjay5cbiAgICogQHBhcmFtIHtQaWNrPFF1ZXJ5T3B0aW9ucywgXCJvcGVyYXRpb25Pd25lclwiPn0gW29wdGlvbnNdIC0gQ2FsbGJhY2sgb3duZXJzaGlwLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyB3aGVuIHRoZSBndWFyZCBoYXMgYmVlbiByZWdpc3RlcmVkLlxuICAgKi9cbiAgYXN5bmMgYmVmb3JlQ29tbWl0KGNhbGxiYWNrLCBvcHRpb25zID0ge30pIHtcbiAgICBhd2FpdCB0aGlzLl93YWl0Rm9yT3BlcmF0aW9uTGVhc2Uob3B0aW9ucy5vcGVyYXRpb25Pd25lcilcblxuICAgIGNvbnN0IGN1cnJlbnRGcmFtZSA9IHRoaXMuX3RyYW5zYWN0aW9uQ2FsbGJhY2tGcmFtZXNbdGhpcy5fdHJhbnNhY3Rpb25DYWxsYmFja0ZyYW1lcy5sZW5ndGggLSAxXVxuXG4gICAgaWYgKCFjdXJyZW50RnJhbWUpIHRocm93IG5ldyBFcnJvcihcImJlZm9yZUNvbW1pdCByZXF1aXJlcyBhbiBhY3RpdmUgdHJhbnNhY3Rpb25cIilcblxuICAgIGN1cnJlbnRGcmFtZS5iZWZvcmVDb21taXRDYWxsYmFja3MucHVzaChjYWxsYmFjaylcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGEgY2FsbGJhY2sgYWZ0ZXIgdGhlIHN1cnJvdW5kaW5nIHRyYW5zYWN0aW9uIGNvbW1pdHMuXG4gICAqIElmIG5vIHRyYW5zYWN0aW9uIGlzIGFjdGl2ZSwgdGhlIGNhbGxiYWNrIHJ1bnMgaW1tZWRpYXRlbHkuXG4gICAqIEBwYXJhbSB7KCkgPT4gdm9pZCB8IFByb21pc2U8dm9pZD59IGNhbGxiYWNrIC0gQ2FsbGJhY2suXG4gICAqIEBwYXJhbSB7UGljazxRdWVyeU9wdGlvbnMsIFwib3BlcmF0aW9uT3duZXJcIj59IFtvcHRpb25zXSAtIENhbGxiYWNrIG93bmVyc2hpcC5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgd2hlbiB0aGUgY2FsbGJhY2sgaGFzIGJlZW4gcmVnaXN0ZXJlZCBvciBydW4uXG4gICAqL1xuICBhc3luYyBhZnRlckNvbW1pdChjYWxsYmFjaywgb3B0aW9ucyA9IHt9KSB7XG4gICAgYXdhaXQgdGhpcy5fd2FpdEZvck9wZXJhdGlvbkxlYXNlKG9wdGlvbnMub3BlcmF0aW9uT3duZXIpXG5cbiAgICBjb25zdCBjdXJyZW50RnJhbWUgPSB0aGlzLl90cmFuc2FjdGlvbkNhbGxiYWNrRnJhbWVzW3RoaXMuX3RyYW5zYWN0aW9uQ2FsbGJhY2tGcmFtZXMubGVuZ3RoIC0gMV1cblxuICAgIGlmICghY3VycmVudEZyYW1lKSB7XG4gICAgICBhd2FpdCBjYWxsYmFjaygpXG4gICAgICByZXR1cm5cbiAgICB9XG5cbiAgICBjdXJyZW50RnJhbWUuYWZ0ZXJDb21taXRDYWxsYmFja3MucHVzaChjYWxsYmFjaylcbiAgfVxuXG4gIC8qKlxuICAgKiBXaGV0aGVyIGEgdHJhbnNhY3Rpb24gaXMgY3VycmVudGx5IG9wZW4gb24gdGhpcyBjb25uZWN0aW9uLlxuICAgKiBAcmV0dXJucyB7Ym9vbGVhbn0gLSBXaGV0aGVyIGluc2lkZSBhIHRyYW5zYWN0aW9uLlxuICAgKi9cbiAgaW5zaWRlVHJhbnNhY3Rpb24oKSB7IHJldHVybiB0aGlzLl90cmFuc2FjdGlvbnNDb3VudCA+IDAgfVxuXG4gIC8qKlxuICAgKiBSZXR1cm5zIHRoZSBjb21wbGV0aW9uIHByb21pc2UgaWRlbnRpZnlpbmcgdGhlIGN1cnJlbnQgb3V0ZXIgdHJhbnNhY3Rpb24uXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSBSZXNvbHZlcyBhZnRlciB0aGF0IHRyYW5zYWN0aW9uIGNvbW1pdHMgb3Igcm9sbHMgYmFjay5cbiAgICovXG4gIHRyYW5zYWN0aW9uQ29tcGxldGlvbigpIHsgcmV0dXJuIHRoaXMuX3RyYW5zYWN0aW9uQ29tcGxldGlvblByb21pc2UgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHN0YXJ0IHRyYW5zYWN0aW9uLlxuICAgKiBAcGFyYW0ge1BpY2s8UXVlcnlPcHRpb25zLCBcIm9wZXJhdGlvbk93bmVyXCI+fSBbb3B0aW9uc10gLSBUcmFuc2FjdGlvbiBvd25lcnNoaXAuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIHdoZW4gY29tcGxldGUuXG4gICAqL1xuICBhc3luYyBzdGFydFRyYW5zYWN0aW9uKG9wdGlvbnMgPSB7fSkge1xuICAgIGF3YWl0IGNvb3JkaW5hdGVTaGFyZWRUcmFuc2FjdGlvbkNvbm5lY3Rpb24odGhpcywgYXN5bmMgKCkgPT4ge1xuICAgICAgd2hpbGUgKHRydWUpIHtcbiAgICAgICAgLyoqIEB0eXBlIHtpbXBvcnQoXCIuLi9vcGVyYXRpb24tbGVhc2UuanNcIikuZGVmYXVsdCB8IHVuZGVmaW5lZH0gKi9cbiAgICAgICAgbGV0IGJsb2NraW5nT3BlcmF0aW9uTGVhc2VcblxuICAgICAgICBhd2FpdCB0aGlzLl90cmFuc2FjdGlvbnNBY3Rpb25zTXV0ZXguc3luYyhhc3luYyAoKSA9PiB7XG4gICAgICAgICAgY29uc3Qgb3BlcmF0aW9uTGVhc2UgPSB0aGlzLl9vcGVyYXRpb25MZWFzZVxuXG4gICAgICAgICAgaWYgKG9wZXJhdGlvbkxlYXNlICYmIG9wdGlvbnMub3BlcmF0aW9uT3duZXIgIT09IG9wZXJhdGlvbkxlYXNlLm93bmVyKSB7XG4gICAgICAgICAgICBibG9ja2luZ09wZXJhdGlvbkxlYXNlID0gb3BlcmF0aW9uTGVhc2VcbiAgICAgICAgICAgIHJldHVyblxuICAgICAgICAgIH1cblxuICAgICAgICAgIGF3YWl0IHRoaXMuX3J1blByb2ZpbGVkVHJhbnNhY3Rpb25BY3Rpb24oXCJzdGFydFwiLCBhc3luYyAoKSA9PiB7XG4gICAgICAgICAgICBhd2FpdCB0aGlzLl9zdGFydFRyYW5zYWN0aW9uQWN0aW9uKG9wdGlvbnMpXG4gICAgICAgICAgfSlcbiAgICAgICAgICB0aGlzLl90cmFuc2FjdGlvbnNDb3VudCsrXG5cbiAgICAgICAgICBpZiAodGhpcy5fdHJhbnNhY3Rpb25zQ291bnQgPT09IDEpIHtcbiAgICAgICAgICAgIHRoaXMuX3RyYW5zYWN0aW9uQ29tcGxldGlvblByb21pc2UgPSBuZXcgUHJvbWlzZSgocmVzb2x2ZSkgPT4ge1xuICAgICAgICAgICAgICB0aGlzLl9yZXNvbHZlVHJhbnNhY3Rpb25Db21wbGV0aW9uID0gcmVzb2x2ZVxuICAgICAgICAgICAgfSlcbiAgICAgICAgICB9XG4gICAgICAgIH0pXG5cbiAgICAgICAgaWYgKCFibG9ja2luZ09wZXJhdGlvbkxlYXNlKSByZXR1cm5cblxuICAgICAgICBhd2FpdCBibG9ja2luZ09wZXJhdGlvbkxlYXNlLndhaXQob3B0aW9ucy5vcGVyYXRpb25Pd25lcilcbiAgICAgIH1cbiAgICB9LCBvcHRpb25zLm9wZXJhdGlvbk93bmVyKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgc3RhcnQgdHJhbnNhY3Rpb24gYWN0aW9uLlxuICAgKiBAcGFyYW0ge1BpY2s8UXVlcnlPcHRpb25zLCBcIm9wZXJhdGlvbk93bmVyXCI+fSBbb3B0aW9uc10gLSBUcmFuc2FjdGlvbiBvd25lcnNoaXAuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIHdoZW4gY29tcGxldGUuXG4gICAqL1xuICBhc3luYyBfc3RhcnRUcmFuc2FjdGlvbkFjdGlvbihvcHRpb25zID0ge30pIHtcbiAgICBhd2FpdCB0aGlzLnF1ZXJ5KFwiQkVHSU4gVFJBTlNBQ1RJT05cIiwgb3B0aW9ucylcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGNvbW1pdCB0cmFuc2FjdGlvbi5cbiAgICogQHBhcmFtIHtQaWNrPFF1ZXJ5T3B0aW9ucywgXCJvcGVyYXRpb25Pd25lclwiPn0gW29wdGlvbnNdIC0gVHJhbnNhY3Rpb24gb3duZXJzaGlwLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyB3aGVuIGNvbXBsZXRlLlxuICAgKi9cbiAgYXN5bmMgY29tbWl0VHJhbnNhY3Rpb24ob3B0aW9ucyA9IHt9KSB7XG4gICAgYXdhaXQgY29vcmRpbmF0ZVNoYXJlZFRyYW5zYWN0aW9uQ29ubmVjdGlvbih0aGlzLCBhc3luYyAoKSA9PiB7XG4gICAgICBhd2FpdCB0aGlzLl90cmFuc2FjdGlvbnNBY3Rpb25zTXV0ZXguc3luYyhhc3luYyAoKSA9PiB7XG4gICAgICAgIGF3YWl0IHRoaXMuX3J1blByb2ZpbGVkVHJhbnNhY3Rpb25BY3Rpb24oXCJjb21taXRcIiwgYXN5bmMgKCkgPT4ge1xuICAgICAgICAgIGF3YWl0IHRoaXMuX2NvbW1pdFRyYW5zYWN0aW9uQWN0aW9uKG9wdGlvbnMpXG4gICAgICAgIH0pXG4gICAgICAgIHRoaXMuX3RyYW5zYWN0aW9uc0NvdW50LS1cbiAgICAgICAgdGhpcy5fcmVzb2x2ZUNvbXBsZXRlZFRyYW5zYWN0aW9uKClcbiAgICAgIH0pXG4gICAgfSwgb3B0aW9ucy5vcGVyYXRpb25Pd25lcilcbiAgfVxuXG4gIC8qKiBSZXNvbHZlcyB0aGUgY3VycmVudCBvdXRlciB0cmFuc2FjdGlvbiBjb21wbGV0aW9uIHdoZW4gaXQgaGFzIGZpbmlzaGVkLiAqL1xuICBfcmVzb2x2ZUNvbXBsZXRlZFRyYW5zYWN0aW9uKCkge1xuICAgIGlmICh0aGlzLl90cmFuc2FjdGlvbnNDb3VudCAhPT0gMCkgcmV0dXJuXG5cbiAgICBjb25zdCByZXNvbHZlID0gdGhpcy5fcmVzb2x2ZVRyYW5zYWN0aW9uQ29tcGxldGlvblxuXG4gICAgdGhpcy5fcmVzb2x2ZVRyYW5zYWN0aW9uQ29tcGxldGlvbiA9IHVuZGVmaW5lZFxuICAgIGlmIChyZXNvbHZlKSByZXNvbHZlKClcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGNvbW1pdCB0cmFuc2FjdGlvbiBhY3Rpb24uXG4gICAqIEBwYXJhbSB7UGljazxRdWVyeU9wdGlvbnMsIFwib3BlcmF0aW9uT3duZXJcIj59IFtvcHRpb25zXSAtIFRyYW5zYWN0aW9uIG93bmVyc2hpcC5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgd2hlbiBjb21wbGV0ZS5cbiAgICovXG4gIGFzeW5jIF9jb21taXRUcmFuc2FjdGlvbkFjdGlvbihvcHRpb25zID0ge30pIHtcbiAgICBhd2FpdCB0aGlzLnF1ZXJ5KFwiQ09NTUlUXCIsIG9wdGlvbnMpXG4gIH1cblxuICAvKipcbiAgICogVGltZXMgYSBwaHlzaWNhbCB0cmFuc2FjdGlvbiBhY3Rpb24gb25seSB3aGVuIHRlc3QgcHJvZmlsaW5nIGlzIGFjdGl2ZS5cbiAgICogQHRlbXBsYXRlIFRcbiAgICogQHBhcmFtIHtcInN0YXJ0XCIgfCBcImNvbW1pdFwiIHwgXCJyb2xsYmFja1wifSBhY3Rpb24gLSBUcmFuc2FjdGlvbiBhY3Rpb24uXG4gICAqIEBwYXJhbSB7KCkgPT4gUHJvbWlzZTxUPn0gY2FsbGJhY2sgLSBQaHlzaWNhbCBhY3Rpb24gY2FsbGJhY2suXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPFQ+fSAtIENhbGxiYWNrIHJlc3VsdC5cbiAgICovXG4gIGFzeW5jIF9ydW5Qcm9maWxlZFRyYW5zYWN0aW9uQWN0aW9uKGFjdGlvbiwgY2FsbGJhY2spIHtcbiAgICBjb25zdCBwcm9maWxlQ29udGV4dCA9IGN1cnJlbnRUZXN0UHJvZmlsZUNvbnRleHQodGhpcy5jb25maWd1cmF0aW9uKVxuXG4gICAgaWYgKCFwcm9maWxlQ29udGV4dCkgcmV0dXJuIGF3YWl0IGNhbGxiYWNrKClcblxuICAgIGNvbnN0IHN0YXJ0ZWRBdE1zID0gbm93TXMoKVxuICAgIGxldCBmYWlsZWQgPSB0cnVlXG5cbiAgICB0cnkge1xuICAgICAgY29uc3QgcmVzdWx0ID0gYXdhaXQgY2FsbGJhY2soKVxuXG4gICAgICBmYWlsZWQgPSBmYWxzZVxuICAgICAgcmV0dXJuIHJlc3VsdFxuICAgIH0gZmluYWxseSB7XG4gICAgICBwcm9maWxlQ29udGV4dC5wcm9maWxlci5yZWNvcmREYXRhYmFzZVRyYW5zYWN0aW9uKHByb2ZpbGVDb250ZXh0LCB7XG4gICAgICAgIGFjdGlvbixcbiAgICAgICAgZHVyYXRpb25Nczogbm93TXMoKSAtIHN0YXJ0ZWRBdE1zLFxuICAgICAgICBmYWlsZWRcbiAgICAgIH0pXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIFN0YXJ0cyBhbiBvcHRpb25hbCBwaHlzaWNhbC1xdWVyeSBwcm9maWxlIGF0dGVtcHQgd2l0aG91dCByZXRhaW5pbmcgU1FMLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gc3FsIC0gT3JpZ2luYWwgU1FMIHVzZWQgb25seSB0byBkZXJpdmUgaXRzIHJlZGFjdGVkIGRpYWdub3N0aWMuXG4gICAqIEByZXR1cm5zIHtUZXN0UHJvZmlsZVF1ZXJ5QXR0ZW1wdCB8IHVuZGVmaW5lZH0gLSBBY3RpdmUgcHJvZmlsZSBoYW5kbGUuXG4gICAqL1xuICBfc3RhcnRQcm9maWxlZFF1ZXJ5QXR0ZW1wdChzcWwpIHtcbiAgICBjb25zdCBjb250ZXh0ID0gY3VycmVudFRlc3RQcm9maWxlQ29udGV4dCh0aGlzLmNvbmZpZ3VyYXRpb24pXG5cbiAgICBpZiAoIWNvbnRleHQpIHJldHVybiB1bmRlZmluZWRcblxuICAgIHJldHVybiB7XG4gICAgICBjb250ZXh0LFxuICAgICAgZGlhZ25vc3RpYzogc3FsRGlhZ25vc3RpYyhzcWwpLFxuICAgICAgc3RhcnRlZEF0TXM6IG5vd01zKClcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogQ29tcGxldGVzIGFuIG9wdGlvbmFsIHBoeXNpY2FsLXF1ZXJ5IHByb2ZpbGUgYXR0ZW1wdC5cbiAgICogQHBhcmFtIHtUZXN0UHJvZmlsZVF1ZXJ5QXR0ZW1wdCB8IHVuZGVmaW5lZH0gYXR0ZW1wdCAtIFByb2ZpbGUgaGFuZGxlLlxuICAgKiBAcGFyYW0ge2Jvb2xlYW59IGZhaWxlZCAtIFdoZXRoZXIgdGhlIHBoeXNpY2FsIGRyaXZlciBjYWxsIGZhaWxlZC5cbiAgICogQHJldHVybnMge3ZvaWR9XG4gICAqL1xuICBfZmluaXNoUHJvZmlsZWRRdWVyeUF0dGVtcHQoYXR0ZW1wdCwgZmFpbGVkKSB7XG4gICAgaWYgKCFhdHRlbXB0KSByZXR1cm5cblxuICAgIGF0dGVtcHQuY29udGV4dC5wcm9maWxlci5yZWNvcmREYXRhYmFzZVF1ZXJ5KGF0dGVtcHQuY29udGV4dCwge1xuICAgICAgZHVyYXRpb25Nczogbm93TXMoKSAtIGF0dGVtcHQuc3RhcnRlZEF0TXMsXG4gICAgICBmYWlsZWQsXG4gICAgICAuLi5hdHRlbXB0LmRpYWdub3N0aWNcbiAgICB9KVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZXZlcnkgZ3VhcmQgcmVnaXN0ZXJlZCB0byB0aGUgdHJhbnNhY3Rpb24gZnJhbWUuXG4gICAqIEBwYXJhbSB7VHJhbnNhY3Rpb25DYWxsYmFja0ZyYW1lfSBjYWxsYmFja0ZyYW1lIC0gRnJhbWUgd2hvc2UgZ3VhcmRzIGFyZSBjb21wbGV0aW5nLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyB3aGVuIGV2ZXJ5IGd1YXJkIGFjY2VwdHMgdGhlIGNvbW1pdC5cbiAgICovXG4gIGFzeW5jIF9ydW5CZWZvcmVDb21taXRDYWxsYmFja3MoY2FsbGJhY2tGcmFtZSkge1xuICAgIGZvciAoY29uc3QgY2FsbGJhY2sgb2YgY2FsbGJhY2tGcmFtZS5iZWZvcmVDb21taXRDYWxsYmFja3MpIHtcbiAgICAgIGF3YWl0IGNhbGxiYWNrKClcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogTWVyZ2VzIGNvbW1pdHRlZCBjYWxsYmFja3MgaW50byB0aGUgcGFyZW50IHRyYW5zYWN0aW9uIGZyYW1lIG9yIHJ1bnMgdGhlbSB3aGVuIHRoZSBvdXRlcm1vc3QgY29tbWl0IGNvbXBsZXRlcy5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgd2hlbiBjb21wbGV0ZS5cbiAgICovXG4gIGFzeW5jIF9jb21taXRUcmFuc2FjdGlvbkNhbGxiYWNrRnJhbWUoKSB7XG4gICAgY29uc3QgY29tbWl0dGVkRnJhbWUgPSB0aGlzLl90cmFuc2FjdGlvbkNhbGxiYWNrRnJhbWVzLnBvcCgpXG5cbiAgICBpZiAoIWNvbW1pdHRlZEZyYW1lIHx8IGNvbW1pdHRlZEZyYW1lLmFmdGVyQ29tbWl0Q2FsbGJhY2tzLmxlbmd0aCA9PT0gMCkgcmV0dXJuXG5cbiAgICBjb25zdCBwYXJlbnRGcmFtZSA9IHRoaXMuX3RyYW5zYWN0aW9uQ2FsbGJhY2tGcmFtZXNbdGhpcy5fdHJhbnNhY3Rpb25DYWxsYmFja0ZyYW1lcy5sZW5ndGggLSAxXVxuXG4gICAgaWYgKHBhcmVudEZyYW1lKSB7XG4gICAgICBwYXJlbnRGcmFtZS5hZnRlckNvbW1pdENhbGxiYWNrcy5wdXNoKC4uLmNvbW1pdHRlZEZyYW1lLmFmdGVyQ29tbWl0Q2FsbGJhY2tzKVxuICAgICAgcmV0dXJuXG4gICAgfVxuXG4gICAgZm9yIChjb25zdCBjYWxsYmFjayBvZiBjb21taXR0ZWRGcmFtZS5hZnRlckNvbW1pdENhbGxiYWNrcykge1xuICAgICAgYXdhaXQgY2FsbGJhY2soKVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBTdHJlYW1zIHRoZSByb3dzIG9mIGBzcWxgIG9uZSBhdCBhIHRpbWUgaW5zdGVhZCBvZiBidWZmZXJpbmcgdGhlIHdob2xlIHJlc3VsdCBzZXQsIHNvIGFcbiAgICogY2FsbGVyIGNhbiBwcm9jZXNzIGFuIGFyYml0cmFyaWx5IGxhcmdlIHJlc3VsdCB3aXRoIGJvdW5kZWQgbWVtb3J5LiBUaGlzIGJhc2UgaW1wbGVtZW50YXRpb25cbiAgICogZmFsbHMgYmFjayB0byBhIGJ1ZmZlcmVkIHtAbGluayBxdWVyeX0gYW5kIHlpZWxkcyBpdHMgcm93czsgZHJpdmVycyBiYWNrZWQgYnkgYSBjdXJzb3ItY2FwYWJsZVxuICAgKiBjbGllbnQgKHRoZSBNeVNRTCBkcml2ZXIpIG92ZXJyaWRlIGl0IHdpdGggdHJ1ZSBzZXJ2ZXItc2lkZSBzdHJlYW1pbmcuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBzcWwgLSBTUUwgc3RyaW5nIHRvIHN0cmVhbS5cbiAgICogQHBhcmFtIHtRdWVyeU9wdGlvbnN9IFtvcHRpb25zXSAtIFF1ZXJ5IG9wdGlvbnMsIGFzIGZvciB7QGxpbmsgcXVlcnl9LlxuICAgKiBAeWllbGRzIHtSZWNvcmQ8c3RyaW5nLCB1bmtub3duPn0gLSBUaGUgcmVzdWx0IHJvd3MsIG9uZSBhdCBhIHRpbWUuXG4gICAqL1xuICBhc3luYyAqcXVlcnlTdHJlYW0oc3FsLCBvcHRpb25zID0ge30pIHtcbiAgICBjb25zdCByb3dzID0gYXdhaXQgdGhpcy5xdWVyeShzcWwsIG9wdGlvbnMpXG5cbiAgICBmb3IgKGNvbnN0IHJvdyBvZiBBcnJheS5pc0FycmF5KHJvd3MpID8gcm93cyA6IFtdKSB7XG4gICAgICB5aWVsZCByb3dcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogUnVucyBxdWVyeS5cbiAgICogQHBhcmFtIHtzdHJpbmd9IHNxbCAtIFNRTCBzdHJpbmcuXG4gICAqIEBwYXJhbSB7UXVlcnlPcHRpb25zfSBbb3B0aW9uc10gLSBRdWVyeSBvcHRpb25zLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxRdWVyeVJlc3VsdFR5cGU+fSAtIFJlc29sdmVzIHdpdGggdGhlIHF1ZXJ5LlxuICAgKi9cbiAgYXN5bmMgcXVlcnkoc3FsLCBvcHRpb25zID0ge30pIHtcbiAgICBhd2FpdCB0aGlzLl93YWl0Rm9yT3BlcmF0aW9uTGVhc2Uob3B0aW9ucy5vcGVyYXRpb25Pd25lcilcbiAgICB0aGlzLl9hc3NlcnRXcml0YWJsZVF1ZXJ5KHNxbClcblxuICAgIGxldCB0cmllcyA9IDBcbiAgICBjb25zdCBtYXhUcmllcyA9IDVcbiAgICBjb25zdCByZXF1ZXN0VGltaW5nID0gdGhpcy5jb25maWd1cmF0aW9uLmdldEN1cnJlbnRSZXF1ZXN0VGltaW5nKClcbiAgICBjb25zdCBsb2dRdWVyeSA9IG9wdGlvbnMubG9nUXVlcnkgPz8gdGhpcy5fcXVlcnlMb2dnaW5nRW5hYmxlZCgpXG4gICAgY29uc3Qgc291cmNlU3RhY2sgPSBsb2dRdWVyeSA/IChvcHRpb25zLnNvdXJjZVN0YWNrIHx8IEVycm9yKCkuc3RhY2spIDogdW5kZWZpbmVkXG4gICAgY29uc3QgcXVlcnlTcWwgPSB0aGlzLl9xdWVyeVNxbFdpdGhQcm9jZXNzTGlzdENvbW1lbnQoc3FsLCBvcHRpb25zKVxuXG4gICAgd2hpbGUgKHRyaWVzIDwgbWF4VHJpZXMpIHtcbiAgICAgIHRyaWVzKytcblxuICAgICAgdHJ5IHtcbiAgICAgICAgcmV0dXJuIGF3YWl0IHRoaXMuX3F1ZXJ5QWN0dWFsV2l0aExvZ2dpbmcoe29yaWdpbmFsU3FsOiBzcWwsIHF1ZXJ5U3FsfSwgey4uLm9wdGlvbnMsIGxvZ1F1ZXJ5LCBzb3VyY2VTdGFja30sIHJlcXVlc3RUaW1pbmcsIHRyaWVzKVxuICAgICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgICAgaWYgKCEoZXJyb3IgaW5zdGFuY2VvZiBFcnJvcikpIHRocm93IGVycm9yXG5cbiAgICAgICAgdGhpcy5fZmFpbGVkUXVlcnlEaWFnbm9zdGljcy5zZXQoZXJyb3IsIHNxbERpYWdub3N0aWMoc3FsKSlcblxuICAgICAgICAvLyBBIGRlbGliZXJhdGVseS1hYm9ydGVkIHF1ZXJ5IG11c3QgbmV2ZXIgYmUgc2lsZW50bHkgcmUtcnVuIOKAlCBpdHNcbiAgICAgICAgLy8gY29ubmVjdGlvbiB3YXMgZGVzdHJveWVkIG9uIHB1cnBvc2UsIHNvIHRyZWF0IGl0IGFzIHRlcm1pbmFsLlxuICAgICAgICBpZiAoZXJyb3IgaW5zdGFuY2VvZiBRdWVyeUFib3J0ZWRFcnJvcikgdGhyb3cgZXJyb3JcblxuICAgICAgICBjb25zdCByZXRyeUluZm8gPSB0aGlzLnJldHJ5YWJsZURhdGFiYXNlRXJyb3IoZXJyb3IpXG5cbiAgICAgICAgaWYgKG9wdGlvbnMucmV0cnkgIT09IGZhbHNlICYmIHRyaWVzIDwgbWF4VHJpZXMgJiYgcmV0cnlJbmZvLnJldHJ5KSB7XG4gICAgICAgICAgaWYgKHJldHJ5SW5mby5yZWNvbm5lY3QpIHtcbiAgICAgICAgICAgIGlmICh0aGlzLl90cmFuc2FjdGlvbnNDb3VudCA+IDApIHtcbiAgICAgICAgICAgICAgdGhyb3cgbmV3IEVycm9yKGBDYW5ub3QgcmVjb25uZWN0IHdoaWxlIGEgdHJhbnNhY3Rpb24gaXMgYWN0aXZlICgke3RoaXMuX3RyYW5zYWN0aW9uc0NvdW50fSkuIE9yaWdpbmFsIGVycm9yOiAke2Vycm9yLm1lc3NhZ2V9YCwge2NhdXNlOiBlcnJvcn0pXG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIGF3YWl0IHRoaXMucmVjb25uZWN0KClcbiAgICAgICAgICB9XG5cbiAgICAgICAgICBjb25zdCB3YWl0TXMgPSB0eXBlb2YgcmV0cnlJbmZvLndhaXRNcyA9PT0gXCJudW1iZXJcIiAmJiBOdW1iZXIuaXNGaW5pdGUocmV0cnlJbmZvLndhaXRNcykgPyByZXRyeUluZm8ud2FpdE1zIDogMTAwXG5cbiAgICAgICAgICBpZiAod2FpdE1zID4gMCkgYXdhaXQgd2FpdCh3YWl0TXMpXG4gICAgICAgICAgY29uc3Qgc2Vuc2l0aXZlVmFsdWVzID0gcmVxdWVzdFRpbWluZyA/IHJlcXVlc3RUaW1pbmcuZ2V0TG9nU2Vuc2l0aXZlVmFsdWVzKCkgOiBuZXcgU2V0KClcbiAgICAgICAgICBjb25zdCBsb2dnZWRFcnJvciA9IHRoaXMuY29uZmlndXJhdGlvbi5nZXRMb2dSZWRhY3RvcigpLnJlZGFjdFN0cmluZyhlcnJvci5zdGFjayB8fCBlcnJvci5tZXNzYWdlLCBzZW5zaXRpdmVWYWx1ZXMpXG5cbiAgICAgICAgICB0aGlzLmxvZ2dlci53YXJuKGBSZXRyeWluZyBxdWVyeSBiZWNhdXNlIGZhaWxlZCB3aXRoOiAke2xvZ2dlZEVycm9yfWApXG4gICAgICAgICAgLy8gUmV0cnlcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICB0aHJvdyBlcnJvclxuICAgICAgICB9XG4gICAgICB9XG4gICAgfVxuXG4gICAgdGhyb3cgbmV3IEVycm9yKFwiJ3F1ZXJ5JyB1bmV4cGVjdGVkIGNhbWUgaGVyZVwiKVxuICB9XG5cbiAgLyoqXG4gICAqIEV4ZWN1dGVzIGEgbXV0YXRpb24gYW5kIHJldHVybnMgdGhlIG51bWJlciBvZiByb3dzIGNoYW5nZWQgYnkgdGhhdCBzdGF0ZW1lbnQuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBzcWwgLSBNdXRhdGlvbiBTUUwgc3RyaW5nLlxuICAgKiBAcGFyYW0ge1F1ZXJ5T3B0aW9uc30gW29wdGlvbnNdIC0gUXVlcnkgb3duZXJzaGlwIG9wdGlvbnMuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPG51bWJlcj59IC0gQWZmZWN0ZWQgcm93IGNvdW50LlxuICAgKi9cbiAgYXN5bmMgYWZmZWN0ZWRSb3dzKHNxbCwgb3B0aW9ucyA9IHt9KSB7XG4gICAgYXdhaXQgdGhpcy5fd2FpdEZvck9wZXJhdGlvbkxlYXNlKG9wdGlvbnMub3BlcmF0aW9uT3duZXIpXG4gICAgdGhpcy5fYXNzZXJ0V3JpdGFibGVRdWVyeShzcWwpXG5cbiAgICByZXR1cm4gYXdhaXQgY29vcmRpbmF0ZVNoYXJlZFRyYW5zYWN0aW9uQ29ubmVjdGlvbih0aGlzLCBhc3luYyAoKSA9PiB7XG4gICAgICBhd2FpdCB0aGlzLmJlZm9yZVF1ZXJ5KHNxbCwgb3B0aW9ucylcblxuICAgICAgdHJ5IHtcbiAgICAgICAgY29uc3QgcHJvZmlsZUF0dGVtcHQgPSB0aGlzLl9zdGFydFByb2ZpbGVkUXVlcnlBdHRlbXB0KHNxbClcbiAgICAgICAgbGV0IGZhaWxlZCA9IHRydWVcblxuICAgICAgICB0cnkge1xuICAgICAgICAgIGNvbnN0IGFmZmVjdGVkUm93cyA9IGF3YWl0IHRoaXMuX3J1blBoeXNpY2FsQ29ubmVjdGlvblJlcXVlc3QoXG4gICAgICAgICAgICBhc3luYyAoKSA9PiBhd2FpdCB0aGlzLl9hZmZlY3RlZFJvd3NBY3R1YWwoc3FsKVxuICAgICAgICAgIClcblxuICAgICAgICAgIGZhaWxlZCA9IGZhbHNlXG4gICAgICAgICAgcmV0dXJuIGFmZmVjdGVkUm93c1xuICAgICAgICB9IGZpbmFsbHkge1xuICAgICAgICAgIHRoaXMuX2ZpbmlzaFByb2ZpbGVkUXVlcnlBdHRlbXB0KHByb2ZpbGVBdHRlbXB0LCBmYWlsZWQpXG4gICAgICAgIH1cbiAgICAgIH0gZmluYWxseSB7XG4gICAgICAgIGF3YWl0IHRoaXMuYWZ0ZXJRdWVyeShzcWwsIG9wdGlvbnMpXG4gICAgICB9XG4gICAgfSwgb3B0aW9ucy5vcGVyYXRpb25Pd25lcilcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHF1ZXJ5IGFjdHVhbCB3aXRoIGxvZ2dpbmcuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gT3B0aW9ucyBvYmplY3QuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBhcmdzLm9yaWdpbmFsU3FsIC0gT3JpZ2luYWwgU1FMIHN0cmluZyBiZWZvcmUgcHJvY2Vzcy1saXN0IGNvbW1lbnRzLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gYXJncy5xdWVyeVNxbCAtIFNRTCBzdHJpbmcgc2VudCB0byB0aGUgZGF0YWJhc2UuXG4gICAqIEBwYXJhbSB7UXVlcnlPcHRpb25zfSBvcHRpb25zIC0gUXVlcnkgb3B0aW9ucy5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi8uLi9odHRwLXNlcnZlci9jbGllbnQvcmVxdWVzdC10aW1pbmcuanNcIikuZGVmYXVsdCB8IHVuZGVmaW5lZH0gcmVxdWVzdFRpbWluZyAtIFJlcXVlc3QgdGltaW5nLlxuICAgKiBAcGFyYW0ge251bWJlcn0gdHJpZXMgLSBRdWVyeSBhdHRlbXB0IGNvdW50LlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxRdWVyeVJlc3VsdFR5cGU+fSAtIFJlc29sdmVzIHdpdGggdGhlIHF1ZXJ5LlxuICAgKi9cbiAgYXN5bmMgX3F1ZXJ5QWN0dWFsV2l0aExvZ2dpbmcoe29yaWdpbmFsU3FsLCBxdWVyeVNxbH0sIG9wdGlvbnMsIHJlcXVlc3RUaW1pbmcsIHRyaWVzKSB7XG4gICAgY29uc3Qgc3RhcnRlZEF0TXMgPSBub3dNcygpXG4gICAgY29uc3QgcHJldmlvdXNBY3RpdmVRdWVyeSA9IHRoaXMuX2FjdGl2ZVF1ZXJ5XG4gICAgdGhpcy5fYWN0aXZlUXVlcnkgPSB7XG4gICAgICBhbm5vdGF0aW9uczogZ2V0RGF0YWJhc2VBbm5vdGF0aW9ucygpLFxuICAgICAgbG9nTmFtZTogb3B0aW9ucy5sb2dOYW1lIHx8IFwiU1FMXCIsXG4gICAgICBzcWxQcmV2aWV3OiB0aGlzLl9kZWJ1Z1NxbFByZXZpZXcob3JpZ2luYWxTcWwpLFxuICAgICAgc3RhcnRlZEF0VW5peE1zOiBEYXRlLm5vdygpXG4gICAgfVxuICAgIGxldCByZXN1bHRcblxuICAgIHRyeSB7XG4gICAgICB0cnkge1xuICAgICAgICBjb25zdCBydW5RdWVyeUFjdHVhbFdpdGhIb29rcyA9IGFzeW5jICgpID0+IGF3YWl0IHRoaXMuX3F1ZXJ5QWN0dWFsV2l0aEhvb2tzKHF1ZXJ5U3FsLCBvcHRpb25zLCBvcmlnaW5hbFNxbClcblxuICAgICAgICBpZiAocmVxdWVzdFRpbWluZyAmJiB0cmllcyA9PT0gMSkge1xuICAgICAgICAgIHJlc3VsdCA9IGF3YWl0IHJlcXVlc3RUaW1pbmcubWVhc3VyZURiUXVlcnkocnVuUXVlcnlBY3R1YWxXaXRoSG9va3MpXG4gICAgICAgIH0gZWxzZSBpZiAocmVxdWVzdFRpbWluZykge1xuICAgICAgICAgIHJlc3VsdCA9IGF3YWl0IHJlcXVlc3RUaW1pbmcubWVhc3VyZShcImRiXCIsIHJ1blF1ZXJ5QWN0dWFsV2l0aEhvb2tzKVxuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgIHJlc3VsdCA9IGF3YWl0IHJ1blF1ZXJ5QWN0dWFsV2l0aEhvb2tzKClcbiAgICAgICAgfVxuICAgICAgfSBmaW5hbGx5IHtcbiAgICAgICAgdGhpcy5fYWN0aXZlUXVlcnkgPSBwcmV2aW91c0FjdGl2ZVF1ZXJ5XG4gICAgICB9XG4gICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgIGlmIChvcHRpb25zLmxvZ1F1ZXJ5ICE9PSBmYWxzZSkge1xuICAgICAgICBhd2FpdCB0aGlzLl9sb2dRdWVyeSh7XG4gICAgICAgICAgZWxhcHNlZE1zOiBub3dNcygpIC0gc3RhcnRlZEF0TXMsXG4gICAgICAgICAgZXJyb3I6IGVuc3VyZUVycm9yKGVycm9yKSxcbiAgICAgICAgICBsb2dOYW1lOiBvcHRpb25zLmxvZ05hbWUgfHwgXCJTUUxcIixcbiAgICAgICAgICByZXF1ZXN0VGltaW5nLFxuICAgICAgICAgIHNvdXJjZVN0YWNrOiBvcHRpb25zLnNvdXJjZVN0YWNrLFxuICAgICAgICAgIHNxbDogb3JpZ2luYWxTcWxcbiAgICAgICAgfSlcbiAgICAgIH1cblxuICAgICAgdGhyb3cgZXJyb3JcbiAgICB9XG5cbiAgICBjb25zdCBlbGFwc2VkTXMgPSBub3dNcygpIC0gc3RhcnRlZEF0TXNcblxuICAgIGlmIChvcHRpb25zLmxvZ1F1ZXJ5ICE9PSBmYWxzZSkge1xuICAgICAgYXdhaXQgdGhpcy5fbG9nUXVlcnkoe1xuICAgICAgICBlbGFwc2VkTXMsXG4gICAgICAgIGxvZ05hbWU6IG9wdGlvbnMubG9nTmFtZSB8fCBcIlNRTFwiLFxuICAgICAgICByZXF1ZXN0VGltaW5nLFxuICAgICAgICBzb3VyY2VTdGFjazogb3B0aW9ucy5zb3VyY2VTdGFjayxcbiAgICAgICAgc3FsOiBvcmlnaW5hbFNxbFxuICAgICAgfSlcbiAgICB9XG5cbiAgICBpZiAodGhpcy5fc2NoZW1hQ2FjaGVJbnZhbGlkYXRpbmdTcWwob3JpZ2luYWxTcWwpKSB7XG4gICAgICB0aGlzLmNsZWFyU2NoZW1hQ2FjaGUoKVxuICAgIH1cblxuICAgIHJldHVybiByZXN1bHRcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHF1ZXJ5IGFjdHVhbCB3aXRoIGJlZm9yZS9hZnRlciBob29rcy5cbiAgICogQHBhcmFtIHtzdHJpbmd9IHNxbCAtIFNRTCBzdHJpbmcuXG4gICAqIEBwYXJhbSB7UXVlcnlPcHRpb25zfSBvcHRpb25zIC0gUXVlcnkgb3B0aW9ucy5cbiAgICogQHBhcmFtIHtzdHJpbmd9IG9yaWdpbmFsU3FsIC0gU1FMIGJlZm9yZSBwcm9jZXNzLWxpc3QgY29tbWVudHMuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPFF1ZXJ5UmVzdWx0VHlwZT59IC0gUmVzb2x2ZXMgd2l0aCB0aGUgcXVlcnkuXG4gICAqL1xuICBhc3luYyBfcXVlcnlBY3R1YWxXaXRoSG9va3Moc3FsLCBvcHRpb25zLCBvcmlnaW5hbFNxbCkge1xuICAgIHJldHVybiBhd2FpdCBjb29yZGluYXRlU2hhcmVkVHJhbnNhY3Rpb25Db25uZWN0aW9uKHRoaXMsIGFzeW5jICgpID0+IHtcbiAgICAgIGF3YWl0IHRoaXMuYmVmb3JlUXVlcnkoc3FsLCBvcHRpb25zKVxuXG4gICAgICB0cnkge1xuICAgICAgICBjb25zdCBwcm9maWxlQXR0ZW1wdCA9IHRoaXMuX3N0YXJ0UHJvZmlsZWRRdWVyeUF0dGVtcHQob3JpZ2luYWxTcWwpXG4gICAgICAgIGxldCBmYWlsZWQgPSB0cnVlXG5cbiAgICAgICAgdHJ5IHtcbiAgICAgICAgICBjb25zdCByZXN1bHQgPSBhd2FpdCB0aGlzLl9ydW5QaHlzaWNhbENvbm5lY3Rpb25SZXF1ZXN0KFxuICAgICAgICAgICAgYXN5bmMgKCkgPT4gYXdhaXQgdGhpcy5fcXVlcnlBY3R1YWwoc3FsLCBvcHRpb25zKVxuICAgICAgICAgIClcblxuICAgICAgICAgIGZhaWxlZCA9IGZhbHNlXG4gICAgICAgICAgcmV0dXJuIHJlc3VsdFxuICAgICAgICB9IGZpbmFsbHkge1xuICAgICAgICAgIHRoaXMuX2ZpbmlzaFByb2ZpbGVkUXVlcnlBdHRlbXB0KHByb2ZpbGVBdHRlbXB0LCBmYWlsZWQpXG4gICAgICAgIH1cbiAgICAgIH0gZmluYWxseSB7XG4gICAgICAgIGF3YWl0IHRoaXMuYWZ0ZXJRdWVyeShzcWwsIG9wdGlvbnMpXG4gICAgICB9XG4gICAgfSwgb3B0aW9ucy5vcGVyYXRpb25Pd25lcilcbiAgfVxuXG4gIC8qKlxuICAgKiBIb29rIHRoYXQgcnVucyBpbW1lZGlhdGVseSBiZWZvcmUgYSBTUUwgcXVlcnkgaXMgc2VudCB0byB0aGUgZHJpdmVyLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gX3NxbCAtIFNRTCBzdHJpbmcuXG4gICAqIEBwYXJhbSB7UXVlcnlPcHRpb25zfSBfb3B0aW9ucyAtIFF1ZXJ5IG9wdGlvbnMuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIHdoZW4gY29tcGxldGUuXG4gICAqL1xuICBhc3luYyBiZWZvcmVRdWVyeShfc3FsLCBfb3B0aW9ucykge1xuICAgIC8vIE5vLW9wIGJ5IGRlZmF1bHRcbiAgfVxuXG4gIC8qKlxuICAgKiBIb29rIHRoYXQgcnVucyBpbW1lZGlhdGVseSBhZnRlciBhIFNRTCBxdWVyeSBoYXMgY29tcGxldGVkIG9yIGZhaWxlZC5cbiAgICogQHBhcmFtIHtzdHJpbmd9IF9zcWwgLSBTUUwgc3RyaW5nLlxuICAgKiBAcGFyYW0ge1F1ZXJ5T3B0aW9uc30gX29wdGlvbnMgLSBRdWVyeSBvcHRpb25zLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyB3aGVuIGNvbXBsZXRlLlxuICAgKi9cbiAgYXN5bmMgYWZ0ZXJRdWVyeShfc3FsLCBfb3B0aW9ucykge1xuICAgIC8vIE5vLW9wIGJ5IGRlZmF1bHRcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGdldCBkZWJ1ZyBzbmFwc2hvdC5cbiAgICogQHJldHVybnMge0RhdGFiYXNlQ29ubmVjdGlvbkRlYnVnU25hcHNob3R9IC0gRGlhZ25vc3RpYyBzbmFwc2hvdCBmb3IgdGhpcyBjb25uZWN0aW9uLlxuICAgKi9cbiAgZ2V0RGVidWdTbmFwc2hvdCgpIHtcbiAgICBjb25zdCBub3cgPSBEYXRlLm5vdygpXG4gICAgY29uc3QgYWN0aXZlUXVlcnkgPSB0aGlzLl9hY3RpdmVRdWVyeVxuXG4gICAgcmV0dXJuIHtcbiAgICAgIGFjdGl2ZVF1ZXJ5OiBhY3RpdmVRdWVyeSA/IHsuLi5hY3RpdmVRdWVyeSwgcnVubmluZ01zOiBNYXRoLm1heCgwLCBub3cgLSBhY3RpdmVRdWVyeS5zdGFydGVkQXRVbml4TXMpfSA6IG51bGwsXG4gICAgICBjaGVja291dEFnZU1zOiB0aGlzLl9jb25uZWN0aW9uQ2hlY2tlZE91dEF0VW5peE1zID8gTWF0aC5tYXgoMCwgbm93IC0gdGhpcy5fY29ubmVjdGlvbkNoZWNrZWRPdXRBdFVuaXhNcykgOiB1bmRlZmluZWQsXG4gICAgICBjaGVja2VkT3V0QXRVbml4TXM6IHRoaXMuX2Nvbm5lY3Rpb25DaGVja2VkT3V0QXRVbml4TXMsXG4gICAgICBjaGVja291dE5hbWU6IHRoaXMuX2Nvbm5lY3Rpb25DaGVja291dE5hbWUsXG4gICAgICBkcml2ZXJDbGFzczogdGhpcy5jb25zdHJ1Y3Rvci5uYW1lLFxuICAgICAgaWRTZXE6IHRoaXMuaWRTZXEsXG4gICAgICBvcGVuVHJhbnNhY3Rpb25zOiB0aGlzLl90cmFuc2FjdGlvbnNDb3VudCxcbiAgICAgIHNjaGVtYUNhY2hlRW50cmllczogdGhpcy5fc2NoZW1hQ2FjaGUuc2l6ZVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBSZXR1cm5zIGEgYm91bmRlZCBwcmVmaXggb2YgYHNxbGAgZm9yIGxpZ2h0d2VpZ2h0IGRpYWdub3N0aWMgc2Nhbm5pbmcuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBzcWwgLSBTUUwgc3RyaW5nLlxuICAgKiBAcGFyYW0ge251bWJlcn0gbGltaXQgLSBNYXhpbXVtIGNvZGUgdW5pdHMgdG8gaW5zcGVjdC5cbiAgICogQHJldHVybnMge3N0cmluZ30gLSBQcmVmaXggb2YgYHNxbGAuXG4gICAqL1xuICBfZGlhZ25vc3RpY1NxbFByZWZpeChzcWwsIGxpbWl0KSB7XG4gICAgcmV0dXJuIHNxbC5sZW5ndGggPD0gbGltaXQgPyBzcWwgOiBzcWwuc2xpY2UoMCwgbGltaXQpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBkZWJ1ZyBzcWwgcHJldmlldy5cbiAgICogQHBhcmFtIHtzdHJpbmd9IHNxbCAtIFNRTCB0byBwcmV2aWV3LlxuICAgKiBAcmV0dXJucyB7c3RyaW5nfSAtIE5vcm1hbGl6ZWQgdHJ1bmNhdGVkIFNRTCBwcmV2aWV3IGZvciBkaWFnbm9zdGljcy5cbiAgICovXG4gIF9kZWJ1Z1NxbFByZXZpZXcoc3FsKSB7XG4gICAgY29uc3QgcHJlZml4ID0gdGhpcy5fZGlhZ25vc3RpY1NxbFByZWZpeChzcWwsIFNRTF9QUkVWSUVXX1NDQU5fTElNSVQpXG5cbiAgICByZXR1cm4gcHJlZml4XG4gICAgICAucmVwbGFjZSgvXFxzKy9nLCBcIiBcIilcbiAgICAgIC50cmltKClcbiAgICAgIC5zbGljZSgwLCA1MDApXG4gIH1cblxuICAvKipcbiAgICogUnVucyBxdWVyeSBzcWwgd2l0aCBwcm9jZXNzIGxpc3QgY29tbWVudC5cbiAgICogQHBhcmFtIHtzdHJpbmd9IHNxbCAtIFNRTCBzdHJpbmcuXG4gICAqIEBwYXJhbSB7UXVlcnlPcHRpb25zfSBvcHRpb25zIC0gUXVlcnkgb3B0aW9ucy5cbiAgICogQHJldHVybnMge3N0cmluZ30gLSBTUUwgc3RyaW5nIHdpdGggYSBsZWFkaW5nIHByb2Nlc3MtbGlzdCBjb21tZW50IHdoZW4gYW5ub3RhdGlvbnMgZXhpc3QuXG4gICAqL1xuICBfcXVlcnlTcWxXaXRoUHJvY2Vzc0xpc3RDb21tZW50KHNxbCwgb3B0aW9ucykge1xuICAgIGlmIChvcHRpb25zLnByb2Nlc3NMaXN0Q29tbWVudCA9PT0gZmFsc2UpIHJldHVybiBzcWxcblxuICAgIGNvbnN0IHBhcnRzID0gW11cblxuICAgIGlmICh0aGlzLl9jb25uZWN0aW9uQ2hlY2tvdXROYW1lKSB7XG4gICAgICBwYXJ0cy5wdXNoKGBjaGVja291dD1cIiR7dGhpcy5fcHJvY2Vzc0xpc3RDb21tZW50VmFsdWUodGhpcy5fY29ubmVjdGlvbkNoZWNrb3V0TmFtZSl9XCJgKVxuICAgIH1cblxuICAgIGNvbnN0IGFubm90YXRpb25zID0gZ2V0RGF0YWJhc2VBbm5vdGF0aW9ucygpXG5cbiAgICBpZiAoYW5ub3RhdGlvbnMubGVuZ3RoID4gMCkge1xuICAgICAgcGFydHMucHVzaChgYW5ub3RhdGlvbnM9XCIke3RoaXMuX3Byb2Nlc3NMaXN0Q29tbWVudFZhbHVlKGFubm90YXRpb25zLmpvaW4oXCIgPiBcIikpfVwiYClcbiAgICB9XG5cbiAgICBpZiAocGFydHMubGVuZ3RoID09PSAwKSByZXR1cm4gc3FsXG5cbiAgICByZXR1cm4gYC8qIHZlbG9jaW91cyAke3BhcnRzLmpvaW4oXCIgXCIpfSAqLyAke3NxbH1gXG4gIH1cblxuICAvKipcbiAgICogUnVucyBwcm9jZXNzIGxpc3QgY29tbWVudCB2YWx1ZS5cbiAgICogQHBhcmFtIHtzdHJpbmd9IHZhbHVlIC0gUmF3IHByb2Nlc3MtbGlzdCBjb21tZW50IHZhbHVlLlxuICAgKiBAcmV0dXJucyB7c3RyaW5nfSAtIFNhbml0aXplZCBwcm9jZXNzLWxpc3QgY29tbWVudCB2YWx1ZS5cbiAgICovXG4gIF9wcm9jZXNzTGlzdENvbW1lbnRWYWx1ZSh2YWx1ZSkge1xuICAgIGxldCBzYW5pdGl6ZWQgPSBcIlwiXG5cbiAgICBmb3IgKGNvbnN0IGNoYXJhY3RlciBvZiB2YWx1ZSkge1xuICAgICAgY29uc3QgY29kZVBvaW50ID0gY2hhcmFjdGVyLmNvZGVQb2ludEF0KDApXG5cbiAgICAgIHNhbml0aXplZCArPSBjb2RlUG9pbnQgIT09IHVuZGVmaW5lZCAmJiAoY29kZVBvaW50IDwgMzIgfHwgY29kZVBvaW50ID09PSAxMjcpID8gXCIgXCIgOiBjaGFyYWN0ZXJcbiAgICB9XG5cbiAgICByZXR1cm4gc2FuaXRpemVkXG4gICAgICAucmVwbGFjZSgvXFwqXFwvL2csIFwiKiAvXCIpXG4gICAgICAucmVwbGFjZSgvXFxzKy9nLCBcIiBcIilcbiAgICAgIC50cmltKClcbiAgICAgIC5zbGljZSgwLCAyMDApXG4gICAgICAucmVwbGFjZSgvXCIvZywgXCInXCIpXG4gIH1cblxuICAvKipcbiAgICogUmVhZHMgdGhlIG5leHQgU1FMIHRva2VuIHN0YXJ0aW5nIGF0IGBzdGFydEluZGV4YCwgc2tpcHBpbmcgbGVhZGluZyB0cml2aWFcbiAgICogKEJPTSwgd2hpdGVzcGFjZSwgYmxvY2sgY29tbWVudHMsIGxpbmUgY29tbWVudHMpLiBJZiB0aGUgc2NhbiBjYW5ub3QgZmluaXNoXG4gICAqIHNraXBwaW5nIHRyaXZpYSBiZWZvcmUgYGxpbWl0YCwgdGhlIHJlc3VsdCBpcyBtYXJrZWQgaW5jb21wbGV0ZSBzbyBjYWxsZXJzXG4gICAqIGNhbiBjb25zZXJ2YXRpdmVseSB0cmVhdCB0aGUgc3RhdGVtZW50IGFzIHNjaGVtYS1pbnZhbGlkYXRpbmcuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBzcWwgLSBTUUwgc3RyaW5nLlxuICAgKiBAcGFyYW0ge251bWJlcn0gc3RhcnRJbmRleCAtIEluZGV4IHRvIHN0YXJ0IHNjYW5uaW5nLlxuICAgKiBAcGFyYW0ge251bWJlcn0gbGltaXQgLSBNYXhpbXVtIGFic29sdXRlIGluZGV4IHRvIHNjYW4gd2hpbGUgc2tpcHBpbmcgbGVhZGluZyB0cml2aWEuXG4gICAqIEByZXR1cm5zIHtTcWxUb2tlblJlc3VsdH0gLSBUb2tlbiByZXN1bHQuXG4gICAqL1xuICBfcmVhZFNxbFRva2VuKHNxbCwgc3RhcnRJbmRleCwgbGltaXQpIHtcbiAgICBsZXQgaSA9IHN0YXJ0SW5kZXhcbiAgICBjb25zdCBsZW4gPSBzcWwubGVuZ3RoXG5cbiAgICB3aGlsZSAoaSA8IGxlbiAmJiBpIDwgbGltaXQpIHtcbiAgICAgIGNvbnN0IGNoYXIgPSBzcWxbaV1cblxuICAgICAgaWYgKGNoYXIgPT09IFwiXFx1ZmVmZlwiIHx8IC9cXHMvLnRlc3QoY2hhcikpIHtcbiAgICAgICAgaSsrXG4gICAgICAgIGNvbnRpbnVlXG4gICAgICB9XG5cbiAgICAgIGlmIChjaGFyID09PSBcIi9cIiAmJiBzcWxbaSArIDFdID09PSBcIipcIikge1xuICAgICAgICBjb25zdCBjbG9zZSA9IHNxbC5pbmRleE9mKFwiKi9cIiwgaSArIDIpXG5cbiAgICAgICAgaWYgKGNsb3NlID09PSAtMSB8fCBjbG9zZSArIDIgPiBsaW1pdCkge1xuICAgICAgICAgIHJldHVybiB7aW5jb21wbGV0ZTogdHJ1ZSwgaW5kZXg6IGksIHRva2VuOiB1bmRlZmluZWR9XG4gICAgICAgIH1cblxuICAgICAgICBpID0gY2xvc2UgKyAyXG4gICAgICAgIGNvbnRpbnVlXG4gICAgICB9XG5cbiAgICAgIGlmIChjaGFyID09PSBcIi1cIiAmJiBzcWxbaSArIDFdID09PSBcIi1cIikge1xuICAgICAgICBjb25zdCBuZXdsaW5lID0gc3FsLmluZGV4T2YoXCJcXG5cIiwgaSArIDIpXG5cbiAgICAgICAgaWYgKG5ld2xpbmUgPT09IC0xKSB7XG4gICAgICAgICAgcmV0dXJuIHtpbmNvbXBsZXRlOiBmYWxzZSwgaW5kZXg6IGxlbiwgdG9rZW46IHVuZGVmaW5lZH1cbiAgICAgICAgfVxuXG4gICAgICAgIGlmIChuZXdsaW5lICsgMSA+IGxpbWl0KSB7XG4gICAgICAgICAgcmV0dXJuIHtpbmNvbXBsZXRlOiB0cnVlLCBpbmRleDogaSwgdG9rZW46IHVuZGVmaW5lZH1cbiAgICAgICAgfVxuXG4gICAgICAgIGkgPSBuZXdsaW5lICsgMVxuICAgICAgICBjb250aW51ZVxuICAgICAgfVxuXG4gICAgICBsZXQgdG9rZW4gPSBcIlwiXG5cbiAgICAgIHdoaWxlIChpIDwgbGVuKSB7XG4gICAgICAgIGNvbnN0IGMgPSBzcWxbaV1cblxuICAgICAgICBpZiAoL1xccy8udGVzdChjKSB8fCBjID09PSBcIlxcdWZlZmZcIikgYnJlYWtcbiAgICAgICAgaWYgKGMgPT09IFwiL1wiICYmIHNxbFtpICsgMV0gPT09IFwiKlwiKSBicmVha1xuICAgICAgICBpZiAoYyA9PT0gXCItXCIgJiYgc3FsW2kgKyAxXSA9PT0gXCItXCIpIGJyZWFrXG5cbiAgICAgICAgdG9rZW4gKz0gY1xuICAgICAgICBpKytcbiAgICAgIH1cblxuICAgICAgcmV0dXJuIHtpbmNvbXBsZXRlOiBmYWxzZSwgdG9rZW46IHRva2VuLnRvTG93ZXJDYXNlKCksIGluZGV4OiBpfVxuICAgIH1cblxuICAgIGlmIChpID49IGxlbikge1xuICAgICAgcmV0dXJuIHtpbmNvbXBsZXRlOiBmYWxzZSwgaW5kZXg6IGxlbiwgdG9rZW46IHVuZGVmaW5lZH1cbiAgICB9XG5cbiAgICByZXR1cm4ge2luY29tcGxldGU6IHRydWUsIGluZGV4OiBpLCB0b2tlbjogdW5kZWZpbmVkfVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgc2NoZW1hIGNhY2hlIGludmFsaWRhdGluZyBzcWwuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBzcWwgLSBTUUwgc3RyaW5nLlxuICAgKiBAcmV0dXJucyB7Ym9vbGVhbn0gLSBXaGV0aGVyIHRoZSBTUUwgc2hvdWxkIGludmFsaWRhdGUgc2NoZW1hIG1ldGFkYXRhLlxuICAgKi9cbiAgX3NjaGVtYUNhY2hlSW52YWxpZGF0aW5nU3FsKHNxbCkge1xuICAgIGNvbnN0IGZpcnN0ID0gdGhpcy5fcmVhZFNxbFRva2VuKHNxbCwgMCwgU0NIRU1BX0lOVkFMSURBVElPTl9TQ0FOX0xJTUlUKVxuXG4gICAgaWYgKGZpcnN0LmluY29tcGxldGUpIHJldHVybiB0cnVlXG5cbiAgICBjb25zdCBmaXJzdFRva2VuID0gZmlyc3QudG9rZW5cblxuICAgIGlmICghZmlyc3RUb2tlbikgcmV0dXJuIGZhbHNlXG4gICAgaWYgKC9eKGNyZWF0ZXxhbHRlcnxkcm9wfHJlbmFtZSkkLy50ZXN0KGZpcnN0VG9rZW4pKSByZXR1cm4gdHJ1ZVxuXG4gICAgaWYgKGZpcnN0VG9rZW4gPT09IFwiY29tbWVudFwiKSB7XG4gICAgICBjb25zdCBuZXh0ID0gdGhpcy5fcmVhZFNxbFRva2VuKHNxbCwgZmlyc3QuaW5kZXgsIFNDSEVNQV9JTlZBTElEQVRJT05fU0NBTl9MSU1JVClcblxuICAgICAgcmV0dXJuIG5leHQuaW5jb21wbGV0ZSB8fCBuZXh0LnRva2VuID09PSBcIm9uXCJcbiAgICB9XG5cbiAgICBpZiAoZmlyc3RUb2tlbiA9PT0gXCJleGVjXCIgfHwgZmlyc3RUb2tlbiA9PT0gXCJleGVjdXRlXCIpIHtcbiAgICAgIGNvbnN0IG5leHQgPSB0aGlzLl9yZWFkU3FsVG9rZW4oc3FsLCBmaXJzdC5pbmRleCwgU0NIRU1BX0lOVkFMSURBVElPTl9TQ0FOX0xJTUlUKVxuXG4gICAgICByZXR1cm4gbmV4dC5pbmNvbXBsZXRlIHx8IG5leHQudG9rZW4gPT09IFwic3BfcmVuYW1lXCJcbiAgICB9XG5cbiAgICBpZiAoZmlyc3RUb2tlbiA9PT0gXCJpZlwiKSB7XG4gICAgICBsZXQgaW5kZXggPSBmaXJzdC5pbmRleFxuXG4gICAgICB3aGlsZSAodHJ1ZSkge1xuICAgICAgICBjb25zdCByZXN1bHQgPSB0aGlzLl9yZWFkU3FsVG9rZW4oc3FsLCBpbmRleCwgU0NIRU1BX0lOVkFMSURBVElPTl9TQ0FOX0xJTUlUKVxuXG4gICAgICAgIGlmIChyZXN1bHQuaW5jb21wbGV0ZSkgcmV0dXJuIHRydWVcbiAgICAgICAgaWYgKCFyZXN1bHQudG9rZW4pIHJldHVybiBmYWxzZVxuICAgICAgICBpZiAocmVzdWx0LnRva2VuID09PSBcImJlZ2luXCIpIHtcbiAgICAgICAgICBjb25zdCBkZGxSZXN1bHQgPSB0aGlzLl9yZWFkU3FsVG9rZW4oc3FsLCByZXN1bHQuaW5kZXgsIFNDSEVNQV9JTlZBTElEQVRJT05fU0NBTl9MSU1JVClcblxuICAgICAgICAgIHJldHVybiBkZGxSZXN1bHQuaW5jb21wbGV0ZSB8fCAvXihjcmVhdGV8YWx0ZXJ8ZHJvcHxyZW5hbWUpJC8udGVzdChkZGxSZXN1bHQudG9rZW4gfHwgXCJcIilcbiAgICAgICAgfVxuXG4gICAgICAgIGluZGV4ID0gcmVzdWx0LmluZGV4XG4gICAgICB9XG4gICAgfVxuXG4gICAgcmV0dXJuIGZhbHNlXG4gIH1cblxuICAvKipcbiAgICogUnVucyBxdWVyeSBsb2dnaW5nIGVuYWJsZWQuXG4gICAqIEByZXR1cm5zIHtib29sZWFufSAtIFdoZXRoZXIgcXVlcnkgbG9nZ2luZyBpcyBlbmFibGVkIGZvciB0aGlzIGRyaXZlci5cbiAgICovXG4gIF9xdWVyeUxvZ2dpbmdFbmFibGVkKCkge1xuICAgIGlmICghdGhpcy5jb25maWd1cmF0aW9uKSByZXR1cm4gdHJ1ZVxuICAgIGlmICghdGhpcy5jb25maWd1cmF0aW9uLmdldFF1ZXJ5TG9nZ2luZ0VuYWJsZWQoKSkgcmV0dXJuIGZhbHNlXG5cbiAgICBjb25zdCBsb2dnZXIgPSBuZXcgTG9nZ2VyKFwiU1FMXCIsIHtjb25maWd1cmF0aW9uOiB0aGlzLmNvbmZpZ3VyYXRpb259KVxuXG4gICAgcmV0dXJuIGxvZ2dlci5pc0xldmVsRW5hYmxlZChcImluZm9cIilcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGxvZyBxdWVyeS5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBPcHRpb25zIG9iamVjdC5cbiAgICogQHBhcmFtIHtudW1iZXJ9IGFyZ3MuZWxhcHNlZE1zIC0gRWxhcHNlZCBtaWxsaXNlY29uZHMuXG4gICAqIEBwYXJhbSB7RXJyb3J9IFthcmdzLmVycm9yXSAtIFF1ZXJ5IGZhaWx1cmUsIHdoZW4gdGhlIGRyaXZlciBjYWxsIGZhaWxlZC5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGFyZ3MubG9nTmFtZSAtIFF1ZXJ5IGxvZyBzdWJqZWN0LlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uLy4uL2h0dHAtc2VydmVyL2NsaWVudC9yZXF1ZXN0LXRpbWluZy5qc1wiKS5kZWZhdWx0IHwgdW5kZWZpbmVkfSBhcmdzLnJlcXVlc3RUaW1pbmcgLSBSZXF1ZXN0IHRpbWluZy5cbiAgICogQHBhcmFtIHtzdHJpbmcgfCB1bmRlZmluZWR9IGFyZ3Muc291cmNlU3RhY2sgLSBTb3VyY2Ugc3RhY2suXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBhcmdzLnNxbCAtIFNRTCBzdHJpbmcuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIHdoZW4gY29tcGxldGUuXG4gICAqL1xuICBhc3luYyBfbG9nUXVlcnkoe2VsYXBzZWRNcywgZXJyb3IsIGxvZ05hbWUsIHJlcXVlc3RUaW1pbmcsIHNvdXJjZVN0YWNrLCBzcWx9KSB7XG4gICAgY29uc3QgbG9nZ2VyID0gbmV3IExvZ2dlcihsb2dOYW1lLCB7Y29uZmlndXJhdGlvbjogdGhpcy5jb25maWd1cmF0aW9ufSlcbiAgICBjb25zdCBzb3VyY2VMaW5lID0gdGhpcy5fcXVlcnlTb3VyY2VMaW5lKHNvdXJjZVN0YWNrKVxuICAgIGNvbnN0IHNlbnNpdGl2ZVZhbHVlcyA9IHJlcXVlc3RUaW1pbmcgPyByZXF1ZXN0VGltaW5nLmdldExvZ1NlbnNpdGl2ZVZhbHVlcygpIDogbmV3IFNldCgpXG4gICAgY29uc3QgcmVkYWN0b3IgPSB0aGlzLmNvbmZpZ3VyYXRpb24uZ2V0TG9nUmVkYWN0b3IoKVxuICAgIGNvbnN0IGxvZ2dlZFNxbCA9IHJlZGFjdG9yLnJlZGFjdFN0cmluZyhzcWwsIHNlbnNpdGl2ZVZhbHVlcylcbiAgICBjb25zdCBmYWlsdXJlID0gZXJyb3JcbiAgICAgID8gYCBGQUlMRUQgJHtlcnJvci5uYW1lfTogJHtyZWRhY3Rvci5yZWRhY3RTdHJpbmcoZXJyb3IubWVzc2FnZSwgc2Vuc2l0aXZlVmFsdWVzKX1gXG4gICAgICA6IFwiXCJcbiAgICBjb25zdCBtZXNzYWdlID0gc291cmNlTGluZVxuICAgICAgPyBgKCR7Zm9ybWF0RWxhcHNlZE1zKGVsYXBzZWRNcyl9KSR7ZmFpbHVyZX0gICR7bG9nZ2VkU3FsfVxcbiAg4oazICR7c291cmNlTGluZX1gXG4gICAgICA6IGAoJHtmb3JtYXRFbGFwc2VkTXMoZWxhcHNlZE1zKX0pJHtmYWlsdXJlfSAgJHtsb2dnZWRTcWx9YFxuXG4gICAgYXdhaXQgbG9nZ2VyLmluZm8obWVzc2FnZSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHF1ZXJ5IHNvdXJjZSBsaW5lLlxuICAgKiBAcGFyYW0ge3N0cmluZyB8IHVuZGVmaW5lZH0gc291cmNlU3RhY2sgLSBTb3VyY2Ugc3RhY2suXG4gICAqIEByZXR1cm5zIHtzdHJpbmcgfCB1bmRlZmluZWR9IC0gU291cmNlIGxpbmUgd2hlbiBhbiBhcHBsaWNhdGlvbiBmcmFtZSBpcyBhdmFpbGFibGUuXG4gICAqL1xuICBfcXVlcnlTb3VyY2VMaW5lKHNvdXJjZVN0YWNrKSB7XG4gICAgaWYgKCFzb3VyY2VTdGFjaykgcmV0dXJuIHVuZGVmaW5lZFxuXG4gICAgY29uc3QgYXBwbGljYXRpb25EaXJlY3RvcnkgPSB0aGlzLmNvbmZpZ3VyYXRpb25cbiAgICAgID8gdGhpcy5jb25maWd1cmF0aW9uLmdldERpcmVjdG9yeUlmQXZhaWxhYmxlKClcbiAgICAgIDogdW5kZWZpbmVkXG5cbiAgICBpZiAoIWFwcGxpY2F0aW9uRGlyZWN0b3J5KSByZXR1cm4gdW5kZWZpbmVkXG5cbiAgICBjb25zdCBlcnJvciA9IG5ldyBFcnJvcihcIlF1ZXJ5IHNvdXJjZVwiKVxuXG4gICAgZXJyb3Iuc3RhY2sgPSBzb3VyY2VTdGFja1xuXG4gICAgcmV0dXJuIEJhY2t0cmFjZUNsZWFuZXIuZ2V0QXBwbGljYXRpb25Tb3VyY2VMaW5lKGVycm9yLCB7XG4gICAgICBhcHBsaWNhdGlvbkRpcmVjdG9yeSxcbiAgICAgIGZyYW1ld29ya1NvdXJjZURpcmVjdG9yeTogdGhpcy5jb25maWd1cmF0aW9uLmdldEVudmlyb25tZW50SGFuZGxlcigpLmdldEZyYW1ld29ya1NvdXJjZURpcmVjdG9yeSgpXG4gICAgfSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHF1ZXJ5IGFjdHVhbC5cbiAgICogQGFic3RyYWN0XG4gICAqIEBwYXJhbSB7c3RyaW5nfSBzcWwgLSBTUUwgc3RyaW5nLlxuICAgKiBAcGFyYW0ge1F1ZXJ5T3B0aW9uc30gW29wdGlvbnNdIC0gUXVlcnkgb3B0aW9ucyAoY2FycmllcyB0aGUgb3B0aW9uYWwgYWJvcnQgc2lnbmFsKS5cbiAgICogQHJldHVybnMge1Byb21pc2U8UXVlcnlSZXN1bHRUeXBlPn0gLSBSZXNvbHZlcyB3aXRoIHRoZSBxdWVyeSBhY3R1YWwuXG4gICAqL1xuICBfcXVlcnlBY3R1YWwoc3FsLCBvcHRpb25zKSB7IC8vIGVzbGludC1kaXNhYmxlLWxpbmUgbm8tdW51c2VkLXZhcnNcbiAgICB0aHJvdyBuZXcgRXJyb3IoYHF1ZXJ5QWN0dWFsIG5vdCBpbXBsZW1lbnRlZGApXG4gIH1cblxuICAvKipcbiAgICogRXhlY3V0ZXMgYSBtdXRhdGlvbiBhbmQgcmV0dXJucyBpdHMgYWZmZWN0ZWQgcm93IGNvdW50LlxuICAgKiBAYWJzdHJhY3RcbiAgICogQHBhcmFtIHtzdHJpbmd9IHNxbCAtIE11dGF0aW9uIFNRTCBzdHJpbmcuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPG51bWJlcj59IC0gQWZmZWN0ZWQgcm93IGNvdW50LlxuICAgKi9cbiAgX2FmZmVjdGVkUm93c0FjdHVhbChzcWwpIHsgLy8gZXNsaW50LWRpc2FibGUtbGluZSBuby11bnVzZWQtdmFyc1xuICAgIHRocm93IG5ldyBFcnJvcihgYWZmZWN0ZWRSb3dzQWN0dWFsIG5vdCBpbXBsZW1lbnRlZGApXG4gIH1cblxuICAvKipcbiAgICogUnVucyBxdWVyeSB0byBzcWwuXG4gICAqIEBhYnN0cmFjdFxuICAgKiBAcGFyYW0ge1F1ZXJ5fSBfcXVlcnkgLSBRdWVyeSBpbnN0YW5jZS5cbiAgICogQHJldHVybnMge3N0cmluZ30gLSBTUUwgc3RyaW5nLlxuICAgKi9cbiAgcXVlcnlUb1NxbChfcXVlcnkpIHsgdGhyb3cgbmV3IEVycm9yKFwicXVlcnlUb1NxbCBub3QgaW1wbGVtZW50ZWRcIikgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHJldHJ5YWJsZSBkYXRhYmFzZSBlcnJvci5cbiAgICogQHBhcmFtIHtFcnJvcn0gX2Vycm9yIC0gRXJyb3IgaW5zdGFuY2UuXG4gICAqIEByZXR1cm5zIHtSZXRyeWFibGVEYXRhYmFzZUVycm9yUmVzdWx0fSAtIFJldHJ5IGluZm8uXG4gICAqL1xuICByZXRyeWFibGVEYXRhYmFzZUVycm9yKF9lcnJvcikge1xuICAgIHJldHVybiB7cmV0cnk6IGZhbHNlLCByZWNvbm5lY3Q6IGZhbHNlfVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgYXNzZXJ0IHdyaXRhYmxlIHF1ZXJ5LlxuICAgKiBAcGFyYW0ge3N0cmluZ30gc3FsIC0gU1FMIHN0cmluZy5cbiAgICogQHJldHVybnMge3ZvaWR9IC0gTm8gcmV0dXJuIHZhbHVlLlxuICAgKi9cbiAgX2Fzc2VydFdyaXRhYmxlUXVlcnkoc3FsKSB7XG4gICAgaWYgKCF0aGlzLmlzUmVhZE9ubHkoKSkgcmV0dXJuXG4gICAgaWYgKCF0aGlzLl9zcWxMb29rc0xpa2VXcml0ZShzcWwpKSByZXR1cm5cblxuICAgIHRocm93IG5ldyBFcnJvcihcIkRhdGFiYXNlIGlzIHJlYWQtb25seVwiKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgYXNzZXJ0IG5vdCByZWFkIG9ubHkuXG4gICAqIEByZXR1cm5zIHt2b2lkfSAtIE5vIHJldHVybiB2YWx1ZS5cbiAgICovXG4gIF9hc3NlcnROb3RSZWFkT25seSgpIHtcbiAgICBpZiAodGhpcy5pc1JlYWRPbmx5KCkpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihcIkRhdGFiYXNlIGlzIHJlYWQtb25seVwiKVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHNxbCBsb29rcyBsaWtlIHdyaXRlLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gc3FsIC0gU1FMIHN0cmluZy5cbiAgICogQHJldHVybnMge2Jvb2xlYW59IC0gU1FMIHJlcHJlc2VudGF0aW9uLlxuICAgKi9cbiAgX3NxbExvb2tzTGlrZVdyaXRlKHNxbCkge1xuICAgIGNvbnN0IG5vcm1hbGl6ZWQgPSBzcWwudHJpbSgpLnRvTG93ZXJDYXNlKClcblxuICAgIGlmICghbm9ybWFsaXplZCkgcmV0dXJuIGZhbHNlXG5cbiAgICBpZiAoXG4gICAgICBub3JtYWxpemVkLnN0YXJ0c1dpdGgoXCJzZWxlY3RcIikgfHxcbiAgICAgIG5vcm1hbGl6ZWQuc3RhcnRzV2l0aChcInNob3dcIikgfHxcbiAgICAgIG5vcm1hbGl6ZWQuc3RhcnRzV2l0aChcInByYWdtYVwiKSB8fFxuICAgICAgbm9ybWFsaXplZC5zdGFydHNXaXRoKFwiZXhwbGFpblwiKSB8fFxuICAgICAgbm9ybWFsaXplZC5zdGFydHNXaXRoKFwiZGVzY3JpYmVcIilcbiAgICApIHtcbiAgICAgIHJldHVybiBmYWxzZVxuICAgIH1cblxuICAgIGlmIChub3JtYWxpemVkLnN0YXJ0c1dpdGgoXCJ3aXRoXCIpKSB7XG4gICAgICBjb25zdCB3aXRoTWF0Y2ggPSBub3JtYWxpemVkLm1hdGNoKC9eXFxzKndpdGhbXFxzXFxTXSs/XFwpXFxzKihzZWxlY3R8aW5zZXJ0fHVwZGF0ZXxkZWxldGV8bWVyZ2V8cmVwbGFjZSlcXGIvKVxuXG4gICAgICBpZiAod2l0aE1hdGNoKSB7XG4gICAgICAgIHJldHVybiB3aXRoTWF0Y2hbMV0gIT09IFwic2VsZWN0XCJcbiAgICAgIH1cblxuICAgICAgcmV0dXJuIGZhbHNlXG4gICAgfVxuXG4gICAgY29uc3Qga2V5d29yZE1hdGNoID0gbm9ybWFsaXplZC5tYXRjaCgvXlxccyooXFx3KykvKVxuICAgIGNvbnN0IGtleXdvcmQgPSBrZXl3b3JkTWF0Y2ggPyBrZXl3b3JkTWF0Y2hbMV0gOiBcIlwiXG5cbiAgICByZXR1cm4gW1xuICAgICAgXCJpbnNlcnRcIixcbiAgICAgIFwidXBkYXRlXCIsXG4gICAgICBcImRlbGV0ZVwiLFxuICAgICAgXCJjcmVhdGVcIixcbiAgICAgIFwiYWx0ZXJcIixcbiAgICAgIFwiZHJvcFwiLFxuICAgICAgXCJ0cnVuY2F0ZVwiLFxuICAgICAgXCJtZXJnZVwiLFxuICAgICAgXCJyZXBsYWNlXCJcbiAgICBdLmluY2x1ZGVzKGtleXdvcmQpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBpcyByZWFkIG9ubHkuXG4gICAqIEByZXR1cm5zIHtib29sZWFufSAtIFdoZXRoZXIgcmVhZCBvbmx5LlxuICAgKi9cbiAgaXNSZWFkT25seSgpIHtcbiAgICByZXR1cm4gQm9vbGVhbih0aGlzLmdldEFyZ3MoKS5yZWFkT25seSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHJvbGxiYWNrIHRyYW5zYWN0aW9uLlxuICAgKiBAcGFyYW0ge1BpY2s8UXVlcnlPcHRpb25zLCBcIm9wZXJhdGlvbk93bmVyXCI+fSBbb3B0aW9uc10gLSBUcmFuc2FjdGlvbiBvd25lcnNoaXAuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIHdoZW4gY29tcGxldGUuXG4gICAqL1xuICBhc3luYyByb2xsYmFja1RyYW5zYWN0aW9uKG9wdGlvbnMgPSB7fSkge1xuICAgIGF3YWl0IGNvb3JkaW5hdGVTaGFyZWRUcmFuc2FjdGlvbkNvbm5lY3Rpb24odGhpcywgYXN5bmMgKCkgPT4ge1xuICAgICAgYXdhaXQgdGhpcy5fdHJhbnNhY3Rpb25zQWN0aW9uc011dGV4LnN5bmMoYXN5bmMgKCkgPT4ge1xuICAgICAgICB0cnkge1xuICAgICAgICAgIGF3YWl0IHRoaXMuX3J1blByb2ZpbGVkVHJhbnNhY3Rpb25BY3Rpb24oXCJyb2xsYmFja1wiLCBhc3luYyAoKSA9PiB7XG4gICAgICAgICAgICBhd2FpdCB0aGlzLl9yb2xsYmFja1RyYW5zYWN0aW9uQWN0aW9uKG9wdGlvbnMpXG4gICAgICAgICAgfSlcbiAgICAgICAgfSBmaW5hbGx5IHtcbiAgICAgICAgICAvLyBEcml2ZXIgcmVjb3ZlcnkgbWF5IG5lZWQgdG8gY2xlYXIgYSBzdGFsZSBwaHlzaWNhbCB0cmFuc2FjdGlvbiB3aGVuXG4gICAgICAgICAgLy8gbm8gbG9naWNhbCB0cmFuc2FjdGlvbiBpcyBhY3RpdmUuIE5ldmVyIGxldCB0aGF0IGNsZWFudXAgdW5kZXJmbG93XG4gICAgICAgICAgLy8gdGhlIGxvZ2ljYWwgZGVwdGggYW5kIHR1cm4gdGhlIG5leHQgcm9vdCB0cmFuc2FjdGlvbiBpbnRvIGEgc2F2ZXBvaW50LlxuICAgICAgICAgIGlmICh0aGlzLl90cmFuc2FjdGlvbnNDb3VudCA+IDApIHRoaXMuX3RyYW5zYWN0aW9uc0NvdW50LS1cbiAgICAgICAgICB0aGlzLl9yZXNvbHZlQ29tcGxldGVkVHJhbnNhY3Rpb24oKVxuXG4gICAgICAgICAgLy8gQSByb2xsZWQtYmFjayB0cmFuc2FjdGlvbiBtYXkgaGF2ZSByZXZlcnRlZCBEREwgKGUuZy4gYSBDUkVBVEUgVEFCTEVcbiAgICAgICAgICAvLyBydW4gbGF6aWx5IGluc2lkZSB0aGUgdHJhbnNhY3Rpb24pLCBzbyBhbnkgY2FjaGVkIHNjaGVtYSBtZXRhZGF0YSBpc1xuICAgICAgICAgIC8vIG5vdyBzdGFsZSBhbmQgbXVzdCBiZSBpbnZhbGlkYXRlZC4gV2l0aG91dCB0aGlzLCBhIGxhdGVyIHRhYmxlRXhpc3RzKClcbiAgICAgICAgICAvLyBjaGVjayBjYW4gcmVwb3J0IGEgdGFibGUgdGhhdCB0aGUgcm9sbGJhY2sgYWxyZWFkeSByZW1vdmVkLCBzbyBjYWxsZXJzXG4gICAgICAgICAgLy8gc2tpcCByZWNyZWF0aW5nIGl0IGFuZCB0aGVuIGZhaWwgd2l0aCBcIm5vIHN1Y2ggdGFibGVcIi5cbiAgICAgICAgICB0aGlzLmNsZWFyU2NoZW1hQ2FjaGUoKVxuICAgICAgICB9XG4gICAgICB9KVxuICAgIH0sIG9wdGlvbnMub3BlcmF0aW9uT3duZXIpXG4gIH1cblxuICAvKipcbiAgICogUnVucyByb2xsYmFjayB0cmFuc2FjdGlvbiBhY3Rpb24uXG4gICAqIEBwYXJhbSB7UGljazxRdWVyeU9wdGlvbnMsIFwib3BlcmF0aW9uT3duZXJcIj59IFtvcHRpb25zXSAtIFRyYW5zYWN0aW9uIG93bmVyc2hpcC5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgd2hlbiBjb21wbGV0ZS5cbiAgICovXG4gIGFzeW5jIF9yb2xsYmFja1RyYW5zYWN0aW9uQWN0aW9uKG9wdGlvbnMgPSB7fSkge1xuICAgIGF3YWl0IHRoaXMucXVlcnkoXCJST0xMQkFDS1wiLCBvcHRpb25zKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZ2VuZXJhdGUgc2F2ZSBwb2ludCBuYW1lLlxuICAgKiBAcmV0dXJucyB7c3RyaW5nfSAtIFRoZSBnZW5lcmF0ZSBzYXZlIHBvaW50IG5hbWUuXG4gICAqL1xuICBnZW5lcmF0ZVNhdmVQb2ludE5hbWUoKSB7XG4gICAgcmV0dXJuIGBzcCR7bmV3IFVVSUQoNCkuZm9ybWF0KCkucmVwbGFjZUFsbChcIi1cIiwgXCJcIil9YFxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgc3RhcnQgc2F2ZSBwb2ludC5cbiAgICogQHBhcmFtIHtzdHJpbmd9IHNhdmVQb2ludE5hbWUgLSBTYXZlIHBvaW50IG5hbWUuXG4gICAqIEBwYXJhbSB7UGljazxRdWVyeU9wdGlvbnMsIFwib3BlcmF0aW9uT3duZXJcIj59IFtvcHRpb25zXSAtIFRyYW5zYWN0aW9uIG93bmVyc2hpcC5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgd2hlbiBjb21wbGV0ZS5cbiAgICovXG4gIGFzeW5jIHN0YXJ0U2F2ZVBvaW50KHNhdmVQb2ludE5hbWUsIG9wdGlvbnMgPSB7fSkge1xuICAgIGF3YWl0IGNvb3JkaW5hdGVTaGFyZWRUcmFuc2FjdGlvbkNvbm5lY3Rpb24odGhpcywgYXN5bmMgKCkgPT4ge1xuICAgICAgYXdhaXQgdGhpcy5fdHJhbnNhY3Rpb25zQWN0aW9uc011dGV4LnN5bmMoYXN5bmMgKCkgPT4ge1xuICAgICAgICBhd2FpdCB0aGlzLl9zdGFydFNhdmVQb2ludEFjdGlvbihzYXZlUG9pbnROYW1lLCBvcHRpb25zKVxuICAgICAgfSlcbiAgICB9LCBvcHRpb25zLm9wZXJhdGlvbk93bmVyKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgc3RhcnQgc2F2ZSBwb2ludCBhY3Rpb24uXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBzYXZlUG9pbnROYW1lIC0gU2F2ZSBwb2ludCBuYW1lLlxuICAgKiBAcGFyYW0ge1BpY2s8UXVlcnlPcHRpb25zLCBcIm9wZXJhdGlvbk93bmVyXCI+fSBbb3B0aW9uc10gLSBUcmFuc2FjdGlvbiBvd25lcnNoaXAuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIHdoZW4gY29tcGxldGUuXG4gICAqL1xuICBhc3luYyBfc3RhcnRTYXZlUG9pbnRBY3Rpb24oc2F2ZVBvaW50TmFtZSwgb3B0aW9ucyA9IHt9KSB7XG4gICAgYXdhaXQgdGhpcy5xdWVyeShgU0FWRVBPSU5UICR7c2F2ZVBvaW50TmFtZX1gLCBvcHRpb25zKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgcmVuYW1lIGNvbHVtbi5cbiAgICogQHBhcmFtIHtzdHJpbmd9IHRhYmxlTmFtZSAtIFRhYmxlIG5hbWUuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBvbGRDb2x1bW5OYW1lIC0gUHJldmlvdXMgY29sdW1uIG5hbWUuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBuZXdDb2x1bW5OYW1lIC0gTmV3IGNvbHVtbiBuYW1lLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyB3aGVuIGNvbXBsZXRlLlxuICAgKi9cbiAgYXN5bmMgcmVuYW1lQ29sdW1uKHRhYmxlTmFtZSwgb2xkQ29sdW1uTmFtZSwgbmV3Q29sdW1uTmFtZSkge1xuICAgIHRoaXMuX2Fzc2VydE5vdFJlYWRPbmx5KClcbiAgICBjb25zdCB0YWJsZUNvbHVtbiA9IG5ldyBUYWJsZUNvbHVtbihvbGRDb2x1bW5OYW1lKVxuXG4gICAgdGFibGVDb2x1bW4uc2V0TmV3TmFtZShuZXdDb2x1bW5OYW1lKVxuXG4gICAgY29uc3QgdGFibGVEYXRhID0gbmV3IFRhYmxlRGF0YSh0YWJsZU5hbWUpXG5cbiAgICB0YWJsZURhdGEuYWRkQ29sdW1uKHRhYmxlQ29sdW1uKVxuXG4gICAgY29uc3QgYWx0ZXJUYWJsZVNRTHMgPSBhd2FpdCB0aGlzLmFsdGVyVGFibGVTUUxzKHRhYmxlRGF0YSlcblxuICAgIGZvciAoY29uc3QgYWx0ZXJUYWJsZVNRTCBvZiBhbHRlclRhYmxlU1FMcykge1xuICAgICAgYXdhaXQgdGhpcy5xdWVyeShhbHRlclRhYmxlU1FMKVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHJlbGVhc2Ugc2F2ZSBwb2ludC5cbiAgICogQHBhcmFtIHtzdHJpbmd9IHNhdmVQb2ludE5hbWUgLSBTYXZlIHBvaW50IG5hbWUuXG4gICAqIEBwYXJhbSB7UGljazxRdWVyeU9wdGlvbnMsIFwib3BlcmF0aW9uT3duZXJcIj59IFtvcHRpb25zXSAtIFRyYW5zYWN0aW9uIG93bmVyc2hpcC5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgd2hlbiBjb21wbGV0ZS5cbiAgICovXG4gIGFzeW5jIHJlbGVhc2VTYXZlUG9pbnQoc2F2ZVBvaW50TmFtZSwgb3B0aW9ucyA9IHt9KSB7XG4gICAgYXdhaXQgY29vcmRpbmF0ZVNoYXJlZFRyYW5zYWN0aW9uQ29ubmVjdGlvbih0aGlzLCBhc3luYyAoKSA9PiB7XG4gICAgICBhd2FpdCB0aGlzLl90cmFuc2FjdGlvbnNBY3Rpb25zTXV0ZXguc3luYyhhc3luYyAoKSA9PiB7XG4gICAgICAgIGF3YWl0IHRoaXMuX3JlbGVhc2VTYXZlUG9pbnRBY3Rpb24oc2F2ZVBvaW50TmFtZSwgb3B0aW9ucylcbiAgICAgIH0pXG4gICAgfSwgb3B0aW9ucy5vcGVyYXRpb25Pd25lcilcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHJlbGVhc2Ugc2F2ZSBwb2ludCBhY3Rpb24uXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBzYXZlUG9pbnROYW1lIC0gU2F2ZSBwb2ludCBuYW1lLlxuICAgKiBAcGFyYW0ge1BpY2s8UXVlcnlPcHRpb25zLCBcIm9wZXJhdGlvbk93bmVyXCI+fSBbb3B0aW9uc10gLSBUcmFuc2FjdGlvbiBvd25lcnNoaXAuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIHdoZW4gY29tcGxldGUuXG4gICAqL1xuICBhc3luYyBfcmVsZWFzZVNhdmVQb2ludEFjdGlvbihzYXZlUG9pbnROYW1lLCBvcHRpb25zID0ge30pIHtcbiAgICB0cnkge1xuICAgICAgYXdhaXQgdGhpcy5xdWVyeShgUkVMRUFTRSBTQVZFUE9JTlQgJHtzYXZlUG9pbnROYW1lfWAsIG9wdGlvbnMpXG4gICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgIGNvbnN0IG1lc3NhZ2UgPSBlcnJvciBpbnN0YW5jZW9mIEVycm9yID8gZXJyb3IubWVzc2FnZSA6IGAke2Vycm9yfWBcblxuICAgICAgLy8gU2F2ZXBvaW50IG1heSBhbHJlYWR5IGJlIGdvbmUgaWYgdGhlIGRhdGFiYXNlIHJvbGxlZCBiYWNrIGF1dG9tYXRpY2FsbHlcbiAgICAgIGlmIChtZXNzYWdlLnRvTG93ZXJDYXNlKCkuaW5jbHVkZXMoXCJzYXZlcG9pbnRcIikgJiYgbWVzc2FnZS50b0xvd2VyQ2FzZSgpLmluY2x1ZGVzKFwiZG9lcyBub3QgZXhpc3RcIikpIHtcbiAgICAgICAgdGhpcy5sb2dnZXIuZGVidWcoYFJlbGVhc2Ugc2F2ZXBvaW50IGlnbm9yZWQgYmVjYXVzZSBpdCBubyBsb25nZXIgZXhpc3RzOiAke3NhdmVQb2ludE5hbWV9YClcbiAgICAgICAgcmV0dXJuXG4gICAgICB9XG5cbiAgICAgIHRocm93IGVycm9yXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgcm9sbGJhY2sgc2F2ZSBwb2ludC5cbiAgICogQHBhcmFtIHtzdHJpbmd9IHNhdmVQb2ludE5hbWUgLSBTYXZlIHBvaW50IG5hbWUuXG4gICAqIEBwYXJhbSB7UGljazxRdWVyeU9wdGlvbnMsIFwib3BlcmF0aW9uT3duZXJcIj59IFtvcHRpb25zXSAtIFRyYW5zYWN0aW9uIG93bmVyc2hpcC5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgd2hlbiBjb21wbGV0ZS5cbiAgICovXG4gIGFzeW5jIHJvbGxiYWNrU2F2ZVBvaW50KHNhdmVQb2ludE5hbWUsIG9wdGlvbnMgPSB7fSkge1xuICAgIGF3YWl0IGNvb3JkaW5hdGVTaGFyZWRUcmFuc2FjdGlvbkNvbm5lY3Rpb24odGhpcywgYXN5bmMgKCkgPT4ge1xuICAgICAgYXdhaXQgdGhpcy5fdHJhbnNhY3Rpb25zQWN0aW9uc011dGV4LnN5bmMoYXN5bmMgKCkgPT4ge1xuICAgICAgICBhd2FpdCB0aGlzLl9yb2xsYmFja1NhdmVQb2ludEFjdGlvbihzYXZlUG9pbnROYW1lLCBvcHRpb25zKVxuICAgICAgfSlcbiAgICB9LCBvcHRpb25zLm9wZXJhdGlvbk93bmVyKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgcm9sbGJhY2sgc2F2ZSBwb2ludCBhY3Rpb24uXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBzYXZlUG9pbnROYW1lIC0gU2F2ZSBwb2ludCBuYW1lLlxuICAgKiBAcGFyYW0ge1BpY2s8UXVlcnlPcHRpb25zLCBcIm9wZXJhdGlvbk93bmVyXCI+fSBbb3B0aW9uc10gLSBUcmFuc2FjdGlvbiBvd25lcnNoaXAuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIHdoZW4gY29tcGxldGUuXG4gICAqL1xuICBhc3luYyBfcm9sbGJhY2tTYXZlUG9pbnRBY3Rpb24oc2F2ZVBvaW50TmFtZSwgb3B0aW9ucyA9IHt9KSB7XG4gICAgYXdhaXQgdGhpcy5xdWVyeShgUk9MTEJBQ0sgVE8gU0FWRVBPSU5UICR7c2F2ZVBvaW50TmFtZX1gLCBvcHRpb25zKVxuICB9XG5cbiAgLyoqXG4gICAqIFRydW5jYXRlcyB0aGUgZ2l2ZW4gdGFibGUgc25hcHNob3QuIERyaXZlcnMgY2FuIG92ZXJyaWRlIHRoaXMgdG8gaXNzdWUgb25lIGJhdGNoLlxuICAgKiBAcHJvdGVjdGVkXG4gICAqIEBwYXJhbSB7QXJyYXk8aW1wb3J0KFwiLi9iYXNlLXRhYmxlLmpzXCIpLmRlZmF1bHQ+fSB0YWJsZXMgLSBFbGlnaWJsZSB0YWJsZXMgZm9yIHRoaXMgY2xlYW51cCBhdHRlbXB0LlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyB3aGVuIGV2ZXJ5IHRhYmxlIGhhcyBiZWVuIGNsZWFuZWQuXG4gICAqL1xuICBhc3luYyB0cnVuY2F0ZVRhYmxlcyh0YWJsZXMpIHtcbiAgICBjb25zdCB0cnVuY2F0ZUVycm9ycyA9IFtdXG5cbiAgICBmb3IgKGNvbnN0IHRhYmxlIG9mIHRhYmxlcykge1xuICAgICAgdHJ5IHtcbiAgICAgICAgYXdhaXQgdGFibGUudHJ1bmNhdGUoe2Nhc2NhZGU6IHRydWV9KVxuICAgICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgICAgdHJ1bmNhdGVFcnJvcnMucHVzaChlcnJvcilcbiAgICAgIH1cbiAgICB9XG5cbiAgICBpZiAodHJ1bmNhdGVFcnJvcnMubGVuZ3RoID4gMCkgdGhyb3cgdHJ1bmNhdGVFcnJvcnNbMF1cbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHRydW5jYXRlIGFsbCB0YWJsZXMuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIHdoZW4gY29tcGxldGUuXG4gICAqL1xuICBhc3luYyB0cnVuY2F0ZUFsbFRhYmxlcygpIHtcbiAgICB0aGlzLl9hc3NlcnROb3RSZWFkT25seSgpXG4gICAgY29uc3QgdGFibGVzID0gKGF3YWl0IHRoaXMuZ2V0VGFibGVzKCkpLmZpbHRlcigodGFibGUpID0+IHRhYmxlLmdldE5hbWUoKSAhPSBcInNjaGVtYV9taWdyYXRpb25zXCIpXG5cbiAgICBpZiAodGFibGVzLmxlbmd0aCA9PSAwKSByZXR1cm5cblxuICAgIGF3YWl0IHRoaXMuX3RydW5jYXRlQWxsVGFibGVzKHRhYmxlcylcbiAgICBhd2FpdCB0aGlzLmZsdXNoUGVuZGluZ1dyaXRlcygpXG4gIH1cblxuICAvKipcbiAgICogT3ducyB0aGUgZm9yZWlnbi1rZXkgYm91bmRhcnkgYXJvdW5kIGV2ZXJ5IGNsZWFudXAgcmV0cnkuIERyaXZlcnMgdGhhdFxuICAgKiByZXF1aXJlIG9uZSBwaHlzaWNhbCByZXF1ZXN0IGZvciB0aGUgZnVsbCBvcGVyYXRpb24gbWF5IG92ZXJyaWRlIGl0LlxuICAgKiBAcHJvdGVjdGVkXG4gICAqIEBwYXJhbSB7QXJyYXk8aW1wb3J0KFwiLi9iYXNlLXRhYmxlLmpzXCIpLmRlZmF1bHQ+fSB0YWJsZXMgLSBFbGlnaWJsZSB0YWJsZXMuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIGFmdGVyIGNsZWFudXAgc3VjY2VlZHMuXG4gICAqL1xuICBhc3luYyBfdHJ1bmNhdGVBbGxUYWJsZXModGFibGVzKSB7XG4gICAgYXdhaXQgdGhpcy53aXRoRGlzYWJsZWRGb3JlaWduS2V5cyhhc3luYyAoKSA9PiB7XG4gICAgICBhd2FpdCB0aGlzLl90cnVuY2F0ZUFsbFRhYmxlc1dpdGhSZXRyaWVzKHRhYmxlcylcbiAgICB9KVxuICB9XG5cbiAgLyoqXG4gICAqIFJldHJpZXMgY2xlYW51cCBhZ2FpbnN0IHJlZnJlc2hlZCBzY2hlbWEgc25hcHNob3RzLiBEcml2ZXJzIG1heSBvdmVycmlkZVxuICAgKiBgX3RydW5jYXRlQWxsVGFibGVzQXR0ZW1wdGAgdG8gb3duIGEgY29tcGxldGUgZHJpdmVyLXNwZWNpZmljIGF0dGVtcHQuXG4gICAqIEBwcm90ZWN0ZWRcbiAgICogQHBhcmFtIHtBcnJheTxpbXBvcnQoXCIuL2Jhc2UtdGFibGUuanNcIikuZGVmYXVsdD59IGluaXRpYWxUYWJsZXMgLSBJbml0aWFsIGVsaWdpYmxlIHRhYmxlcy5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgYWZ0ZXIgb25lIGNsZWFudXAgYXR0ZW1wdCBzdWNjZWVkcy5cbiAgICovXG4gIGFzeW5jIF90cnVuY2F0ZUFsbFRhYmxlc1dpdGhSZXRyaWVzKGluaXRpYWxUYWJsZXMpIHtcbiAgICBsZXQgdGFibGVzID0gaW5pdGlhbFRhYmxlc1xuXG4gICAgZm9yIChsZXQgdHJpZXMgPSAxOyB0cmllcyA8PSA2OyB0cmllcysrKSB7XG4gICAgICB0cnkge1xuICAgICAgICBhd2FpdCB0aGlzLl90cnVuY2F0ZUFsbFRhYmxlc0F0dGVtcHQodGFibGVzKVxuICAgICAgICByZXR1cm5cbiAgICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICAgIGNvbnNvbGUuZXJyb3IoZXJyb3IpXG5cbiAgICAgICAgaWYgKHRyaWVzID09IDYpIHRocm93IGVycm9yXG5cbiAgICAgICAgLy8gQSB0cnVuY2F0ZSBmYWlsZWQg4oCUIHRoZSBzY2hlbWEgY2FjaGUgbWF5IHN0aWxsIGxpc3QgYSB0YWJsZSB0aGF0IHdhc1xuICAgICAgICAvLyBkcm9wcGVkIG91dCBmcm9tIHVuZGVyIHVzIChlLmcuIGEgZGI6cm9sbGJhY2sgdGVzdCB0aGF0IGxlZnQgdGhlXG4gICAgICAgIC8vIHNoYXJlZCBEQiByb2xsZWQgYmFjaykuIENsZWFyIGl0IHNvIHRoZSBuZXh0IHBhc3MgcmUtcmVhZHMgdGhlIGxpdmVcbiAgICAgICAgLy8gdGFibGUgbGlzdCBhbmQgbm8gbG9uZ2VyIHRyaWVzIHRvIHRydW5jYXRlIGEgdGFibGUgdGhhdCBpcyBnb25lLlxuICAgICAgICB0aGlzLmNsZWFyU2NoZW1hQ2FjaGUoKVxuICAgICAgICB0YWJsZXMgPSAoYXdhaXQgdGhpcy5nZXRUYWJsZXMoKSkuZmlsdGVyKCh0YWJsZSkgPT4gdGFibGUuZ2V0TmFtZSgpICE9IFwic2NoZW1hX21pZ3JhdGlvbnNcIilcblxuICAgICAgICBpZiAodGFibGVzLmxlbmd0aCA9PSAwKSByZXR1cm5cbiAgICAgIH1cbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogUnVucyBvbmUgY2xlYW51cCBhdHRlbXB0IHdoaWxlIHRoZSBkZWZhdWx0IG93bmVyIGhhcyBjb25zdHJhaW50cyBkaXNhYmxlZC5cbiAgICogQHByb3RlY3RlZFxuICAgKiBAcGFyYW0ge0FycmF5PGltcG9ydChcIi4vYmFzZS10YWJsZS5qc1wiKS5kZWZhdWx0Pn0gdGFibGVzIC0gQ3VycmVudCBlbGlnaWJsZSB0YWJsZXMuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIHdoZW4gdGhlIGF0dGVtcHQgY29tcGxldGVzLlxuICAgKi9cbiAgYXN5bmMgX3RydW5jYXRlQWxsVGFibGVzQXR0ZW1wdCh0YWJsZXMpIHtcbiAgICBhd2FpdCB0aGlzLnRydW5jYXRlVGFibGVzKHRhYmxlcylcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHVwZGF0ZS5cbiAgICogQHBhcmFtIHtVcGRhdGVTcWxBcmdzVHlwZX0gYXJncyAtIE9wdGlvbnMgb2JqZWN0LlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyB3aGVuIGNvbXBsZXRlLlxuICAgKi9cbiAgYXN5bmMgdXBkYXRlKGFyZ3MpIHtcbiAgICB0aGlzLl9hc3NlcnROb3RSZWFkT25seSgpXG4gICAgY29uc3Qgc3FsID0gdGhpcy51cGRhdGVTcWwoYXJncylcblxuICAgIGF3YWl0IHRoaXMucXVlcnkoc3FsKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgdXBkYXRlIHNxbC5cbiAgICogQGFic3RyYWN0XG4gICAqIEBwYXJhbSB7VXBkYXRlU3FsQXJnc1R5cGV9IGFyZ3MgLSBPcHRpb25zIG9iamVjdC5cbiAgICogQHJldHVybnMge3N0cmluZ30gLSBTUUwgc3RyaW5nLlxuICAgKi9cbiAgdXBkYXRlU3FsKGFyZ3MpIHsgLy8gZXNsaW50LWRpc2FibGUtbGluZSBuby11bnVzZWQtdmFyc1xuICAgIHRocm93IG5ldyBFcnJvcihcIidkaXNhYmxlRm9yZWlnbktleXMnIG5vdCBpbXBsZW1lbnRlZFwiKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgdXBzZXJ0IHNxbC5cbiAgICogQGFic3RyYWN0XG4gICAqIEBwYXJhbSB7VXBzZXJ0U3FsQXJnc1R5cGV9IGFyZ3MgLSBPcHRpb25zIG9iamVjdC5cbiAgICogQHJldHVybnMge3N0cmluZ30gLSBTUUwgc3RyaW5nLlxuICAgKi9cbiAgdXBzZXJ0U3FsKGFyZ3MpIHsgLy8gZXNsaW50LWRpc2FibGUtbGluZSBuby11bnVzZWQtdmFyc1xuICAgIHRocm93IG5ldyBFcnJvcihcIid1cHNlcnRTcWwnIG5vdCBpbXBsZW1lbnRlZFwiKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZGlzYWJsZSBmb3JlaWduIGtleXMuXG4gICAqIEBhYnN0cmFjdFxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyB3aGVuIGNvbXBsZXRlLlxuICAgKi9cbiAgZGlzYWJsZUZvcmVpZ25LZXlzKCkge1xuICAgIHRocm93IG5ldyBFcnJvcihcIidkaXNhYmxlRm9yZWlnbktleXMnIG5vdCBpbXBsZW1lbnRlZFwiKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZW5hYmxlIGZvcmVpZ24ga2V5cy5cbiAgICogQGFic3RyYWN0XG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIHdoZW4gY29tcGxldGUuXG4gICAqL1xuICBlbmFibGVGb3JlaWduS2V5cygpIHtcbiAgICB0aHJvdyBuZXcgRXJyb3IoXCInZW5hYmxlRm9yZWlnbktleXMnIG5vdCBpbXBsZW1lbnRlZFwiKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgd2l0aCBkaXNhYmxlZCBmb3JlaWduIGtleXMuXG4gICAqIEBwYXJhbSB7KCkgPT4gdm9pZH0gY2FsbGJhY2sgLSBDYWxsYmFjayBmdW5jdGlvbi5cbiAgICogQHJldHVybnMge1Byb21pc2U8UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSAtIFJlc29sdmVzIHdpdGggdGhlIHdpdGggZGlzYWJsZWQgZm9yZWlnbiBrZXlzLlxuICAgKi9cbiAgYXN5bmMgd2l0aERpc2FibGVkRm9yZWlnbktleXMoY2FsbGJhY2spIHtcbiAgICBhd2FpdCB0aGlzLmRpc2FibGVGb3JlaWduS2V5cygpXG5cbiAgICB0cnkge1xuICAgICAgcmV0dXJuIGF3YWl0IGNhbGxiYWNrKClcbiAgICB9IGZpbmFsbHkge1xuICAgICAgYXdhaXQgdGhpcy5lbmFibGVGb3JlaWduS2V5cygpXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIEJsb2NrcyB1bnRpbCBhIG5hbWVkIGFkdmlzb3J5IGxvY2sgaXMgYWNxdWlyZWQgb24gdGhpcyBjb25uZWN0aW9uLlxuICAgKiBBZHZpc29yeSBsb2NrcyBhcmUgY29ubmVjdGlvbi1zY29wZWQgYW5kIGRvIG5vdCBpbnRlcmFjdCB3aXRoIHJvdyBvclxuICAgKiB0YWJsZSBsb2NrczsgdGhleSBhcmUgcHVyZWx5IGNvb3BlcmF0aXZlIGJldHdlZW4gY2FsbGVycyB0aGF0IHVzZSB0aGVcbiAgICogc2FtZSBuYW1lIGFuZCBsZXQgeW91IHNlcmlhbGl6ZSBmdW5jdGlvbmFsaXR5IHdpdGhvdXQgYmxvY2tpbmcgcmVhZGVyc1xuICAgKiBvciB3cml0ZXJzIHRoYXQgZG8gbm90IHBhcnRpY2lwYXRlIGluIHRoZSBzYW1lIG5hbWVkIGxvY2suXG4gICAqXG4gICAqIEFjcXVpc2l0aW9uIHJ1bnMgYXMgYSB0d28tdGllciBjaGFpbjpcbiAgICogMS4gVGhlICoqcHJvY2Vzcy1sb2NhbCBwcmUtZmlsdGVyIHRpZXIqKiAodGhpcyBjbGFzcycgRklGTyB3YWl0ZXJcbiAgICogICAgcXVldWUpIHNlcmlhbGl6ZXMgc2FtZS1wcm9jZXNzIGNhbGxlcnMgZm9yIHRoZSBsb2NrIG5hbWUgd2l0aG91dFxuICAgKiAgICBpc3N1aW5nIGFueSBkcml2ZXItbmF0aXZlIGxvY2sgcXVlcnkgYW5kIHdpdGhvdXQgcGFya2luZyBhXG4gICAqICAgIGNvbm5lY3Rpb24gaW4gYSBkcml2ZXIgbG9jayBzdGF0ZS4gQSBxdWV1ZWQgY2FsbGVyIG5ldmVyIHJlYWNoZXNcbiAgICogICAgdGllciAyIHVudGlsIHRoZSBpbi1wcm9jZXNzIGhvbGRlciByZWxlYXNlcy5cbiAgICogMi4gVGhlICoqZHJpdmVyLW5hdGl2ZSB0aWVyKiogKGBfYWNxdWlyZUFkdmlzb3J5TG9ja2A6IE1hcmlhREJcbiAgICogICAgYEdFVF9MT0NLYCwgUG9zdGdyZVNRTCBgcGdfYWR2aXNvcnlfbG9ja2AsIFNRTCBTZXJ2ZXJcbiAgICogICAgYHNwX2dldGFwcGxvY2tgLCBTUUxpdGUgZmlsZXN5c3RlbSBsb2NrIG9uIE5vZGUpIGNvbmZpcm1zIHRoZVxuICAgKiAgICBjcm9zcy1wcm9jZXNzL2Nyb3NzLWhvc3QgZXhjbHVzaW9uLlxuICAgKlxuICAgKiBUaGUgcHJvY2Vzcy1sb2NhbCB0aWVyIGlzIGEgcHJlLWZpbHRlciwgKipuZXZlciB0aGUgYXV0aG9yaXR5Kio6IGFcbiAgICogbG9jayBuYW1lIHRoYXQgb3RoZXIgcHJvY2Vzc2VzIG9yIGhvc3RzIGNhbiByZXF1ZXN0IGlzIG9ubHkgZ3JhbnRlZFxuICAgKiBhZnRlciB0aGUgZHJpdmVyLW5hdGl2ZSB0aWVyIChvciwgb25jZSB0aGUgU1RDLTIxMCBiYWNrZW5kIGNoYWluXG4gICAqIGxhbmRzLCB0aGUgY29uZmlndXJlZCBjcm9zcy1ob3N0IGJhY2tlbmQpIGNvbmZpcm1zIGl0LiBJZiB0aGUgbmF0aXZlXG4gICAqIHRpZXIgZGVuaWVzIG9yIHRpbWVzIG91dCwgdGhlIGluLXByb2Nlc3MgaG9sZCBpcyByb2xsZWQgYmFjay5cbiAgICogQHBhcmFtIHtzdHJpbmd9IG5hbWUgLSBMb2NrIG5hbWUuXG4gICAqIEBwYXJhbSB7e3RpbWVvdXRNcz86IG51bWJlciB8IG51bGx9fSBbYXJnc10gLSBPcHRpb25hbCB0aW1lb3V0IGluIG1pbGxpc2Vjb25kczsgYG51bGxgIGJsb2NrcyBmb3JldmVyLCBhbmQgYW4gb21pdHRlZCB2YWx1ZSB1c2VzIHRoZSBkYXRhYmFzZSdzIGBhZHZpc29yeUxvY2tBY3F1aXJlVGltZW91dE1zYCBvciB0aGUgZnJhbWV3b3JrIGRlZmF1bHQuIFRoZSBib3VuZCBjb3ZlcnMgdGhlIHdob2xlIHR3by10aWVyIGFjcXVpc2l0aW9uLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxib29sZWFuPn0gLSBSZXNvbHZlcyB0byB0cnVlIHdoZW4gdGhlIGxvY2sgaGFzIGJlZW4gYWNxdWlyZWQsIGZhbHNlIGlmIHRoZSB0aW1lb3V0IGVsYXBzZWQuXG4gICAqL1xuICBhc3luYyBhY3F1aXJlQWR2aXNvcnlMb2NrKG5hbWUsIGFyZ3MgPSB7fSkge1xuICAgIGNvbnN0IHRpbWVvdXRNcyA9IHRoaXMuYWR2aXNvcnlMb2NrQWNxdWlyZVRpbWVvdXRNcyhhcmdzKVxuICAgIGNvbnN0IGRlYWRsaW5lTXMgPSB0eXBlb2YgdGltZW91dE1zID09PSBcIm51bWJlclwiICYmIHRpbWVvdXRNcyA+PSAwID8gRGF0ZS5ub3coKSArIHRpbWVvdXRNcyA6IG51bGxcbiAgICBjb25zdCBsb2NhbEFjcXVpc2l0aW9uID0gYXdhaXQgdGhpcy5fYWNxdWlyZVByb2Nlc3NMb2NhbEFkdmlzb3J5TG9jayhuYW1lLCB7dGltZW91dE1zfSlcblxuICAgIGlmICghbG9jYWxBY3F1aXNpdGlvbi5hY3F1aXJlZCkgcmV0dXJuIGZhbHNlXG5cbiAgICBpZiAoIXRoaXMuc3VwcG9ydHNEcml2ZXJOYXRpdmVBZHZpc29yeUxvY2soKSkge1xuICAgICAgLy8gTm8gZHJpdmVyLW5hdGl2ZSB0aWVyIGV4aXN0cyBmb3IgdGhpcyBkcml2ZXIgKHBsYWluIFNRTGl0ZSk6IHRoZVxuICAgICAgLy8gcHJvY2Vzcy1sb2NhbCB0aWVyIGlzIHRoZSB3aG9sZSBpbXBsZW1lbnRhdGlvbiwgYW5kIGNhbGxlcnMgbXVzdFxuICAgICAgLy8gbm90IHJlYWQgaXQgYXMgYSBjcm9zcy1wcm9jZXNzIGd1YXJhbnRlZS5cbiAgICAgIHRoaXMuX3RyYWNrQWR2aXNvcnlMb2NrKG5hbWUpXG5cbiAgICAgIHJldHVybiB0cnVlXG4gICAgfVxuXG4gICAgLy8gT25seSBhIGNhbGxlciB0aGF0IGFjdHVhbGx5IHF1ZXVlZCBpbiB0aGUgcHJvY2Vzcy1sb2NhbCB0aWVyIHNwZW5kc1xuICAgIC8vIHBhcnQgb2YgdGhlIGFjcXVpcmUgYnVkZ2V0OyBhbiB1bmNvbnRlbmRlZCBhY3F1aXNpdGlvbiBwYXNzZXMgdGhlXG4gICAgLy8gZnVsbCBib3VuZCBvbiB0byB0aGUgZHJpdmVyLW5hdGl2ZSB0aWVyLlxuICAgIGNvbnN0IG5hdGl2ZVRpbWVvdXRNcyA9IGxvY2FsQWNxdWlzaXRpb24ud2FpdGVkICYmIGRlYWRsaW5lTXMgIT09IG51bGxcbiAgICAgID8gTWF0aC5tYXgoMCwgZGVhZGxpbmVNcyAtIERhdGUubm93KCkpXG4gICAgICA6IHRpbWVvdXRNc1xuXG4gICAgY29uc3Qgc3RhcnRlZEF0ID0gRGF0ZS5ub3coKVxuXG4gICAgLyoqIEB0eXBlIHtib29sZWFufSAqL1xuICAgIGxldCBuYXRpdmVBY3F1aXJlZFxuXG4gICAgdHJ5IHtcbiAgICAgIG5hdGl2ZUFjcXVpcmVkID0gYXdhaXQgdGhpcy5fYWNxdWlyZUFkdmlzb3J5TG9jayhuYW1lLCB7dGltZW91dE1zOiBuYXRpdmVUaW1lb3V0TXN9KVxuICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICB0aGlzLl9yZWxlYXNlUHJvY2Vzc0xvY2FsQWR2aXNvcnlMb2NrKG5hbWUpXG4gICAgICB0aHJvdyBlcnJvclxuICAgIH1cblxuICAgIGNvbnN0IGR1cmF0aW9uTXMgPSBEYXRlLm5vdygpIC0gc3RhcnRlZEF0XG5cbiAgICBpZiAobmF0aXZlQWNxdWlyZWQpIHtcbiAgICAgIHRoaXMuX3RyYWNrQWR2aXNvcnlMb2NrKG5hbWUpXG5cbiAgICAgIGNvbnN0IHNsb3dBY3F1aXJlTXMgPSBhZHZpc29yeUxvY2tUZWxlbWV0cnlUaHJlc2hvbGRzKHRoaXMuZ2V0QXJncygpKS5zbG93QWNxdWlyZU1zXG5cbiAgICAgIGlmIChzbG93QWNxdWlyZU1zICE9PSBudWxsICYmIGR1cmF0aW9uTXMgPiBzbG93QWNxdWlyZU1zKSB7XG4gICAgICAgIGF3YWl0IHRoaXMuX3JlcG9ydEFkdmlzb3J5TG9ja1RlbGVtZXRyeSh7ZXZlbnQ6IFwiYWR2aXNvcnktbG9jay1zbG93LWFjcXVpcmVcIiwgbG9ja05hbWU6IG5hbWUsIGR1cmF0aW9uTXMsIG91dGNvbWU6IFwiYWNxdWlyZWRcIiwgdGltZW91dE1zfSlcbiAgICAgIH1cblxuICAgICAgcmV0dXJuIHRydWVcbiAgICB9XG5cbiAgICB0aGlzLl9yZWxlYXNlUHJvY2Vzc0xvY2FsQWR2aXNvcnlMb2NrKG5hbWUpXG5cbiAgICAvLyBUaGUgd2FpdCBleGNlZWRlZCBpdHMgYm91bmQ6IGF0dHJpYnV0ZSB0aGUgbG9jayB0byB0aGUgaG9sZGVyIHRoYXRcbiAgICAvLyBibG9ja2VkIGl0LCBjYXB0dXJlZCBhdCB0aGlzIG1vbWVudCBvbiB0aGlzIHRpZXIuXG4gICAgYXdhaXQgdGhpcy5fcmVwb3J0QWR2aXNvcnlMb2NrVGVsZW1ldHJ5KHtldmVudDogXCJhZHZpc29yeS1sb2NrLWFjcXVpcmUtdGltZW91dFwiLCBsb2NrTmFtZTogbmFtZSwgZHVyYXRpb25Ncywgb3V0Y29tZTogXCJ0aW1lb3V0XCIsIHRpbWVvdXRNcywgY2FwdHVyZUhvbGRlcjogdHJ1ZX0pXG5cbiAgICByZXR1cm4gZmFsc2VcbiAgfVxuXG4gIC8qKlxuICAgKiBSZXNvbHZlcyB0aGUgd2FpdCBib3VuZCBmb3Igb25lIGFkdmlzb3J5LWxvY2sgYWNxdWlzaXRpb24uXG4gICAqIEFuIGV4cGxpY2l0IGB0aW1lb3V0TXNgIOKAlCBpbmNsdWRpbmcgYW4gZXhwbGljaXQgYG51bGxgIG9wdC1vdXQg4oCUIGFsd2F5c1xuICAgKiB3aW5zLiBPdGhlcndpc2UgdGhlIGRhdGFiYXNlIGNvbmZpZ3VyYXRpb24ncyBgYWR2aXNvcnlMb2NrQWNxdWlyZVRpbWVvdXRNc2BcbiAgICogYXBwbGllcywgYW5kIGEgbnVsbCB0aGVyZSBvcHRzIG91dCB0b28uIE9ubHkgd2hlbiBuZWl0aGVyIGlzIGNvbmZpZ3VyZWQgZG9lc1xuICAgKiB0aGUgZnJhbWV3b3JrIGRlZmF1bHQgYm91bmQgdGhlIHdhaXQuXG4gICAqIEBwYXJhbSB7e3RpbWVvdXRNcz86IG51bWJlciB8IG51bGx9fSBbYXJnc10gLSBBY3F1aXNpdGlvbiBvcHRpb25zIGZyb20gdGhlIGNhbGxlci5cbiAgICogQHJldHVybnMge251bWJlciB8IG51bGx9IC0gV2FpdCBib3VuZCBpbiBtaWxsaXNlY29uZHMsIG9yIGBudWxsYCBmb3IgYW4gaW5kZWZpbml0ZSB3YWl0LlxuICAgKi9cbiAgYWR2aXNvcnlMb2NrQWNxdWlyZVRpbWVvdXRNcyhhcmdzID0ge30pIHtcbiAgICBpZiAoYXJncy50aW1lb3V0TXMgIT09IHVuZGVmaW5lZCkgcmV0dXJuIGFyZ3MudGltZW91dE1zXG5cbiAgICBjb25zdCBjb25maWd1cmVkID0gdGhpcy5nZXRBcmdzKCk/LmFkdmlzb3J5TG9ja0FjcXVpcmVUaW1lb3V0TXNcblxuICAgIGlmIChjb25maWd1cmVkID09PSBudWxsKSByZXR1cm4gbnVsbFxuICAgIGlmICh0eXBlb2YgY29uZmlndXJlZCA9PT0gXCJudW1iZXJcIiAmJiBjb25maWd1cmVkID49IDApIHJldHVybiBjb25maWd1cmVkXG5cbiAgICByZXR1cm4gREVGQVVMVF9BRFZJU09SWV9MT0NLX0FDUVVJUkVfVElNRU9VVF9NU1xuICB9XG5cbiAgLyoqXG4gICAqIFdoZXRoZXIgdGhpcyBkcml2ZXIgaGFzIGEgZHJpdmVyLW5hdGl2ZSBhZHZpc29yeS1sb2NrIHRpZXIgYmVoaW5kIHRoZVxuICAgKiBwcm9jZXNzLWxvY2FsIHByZS1maWx0ZXIuIE1hcmlhREIgKGBHRVRfTE9DS2ApLCBQb3N0Z3JlU1FMXG4gICAqIChgcGdfYWR2aXNvcnlfbG9ja2ApIGFuZCBTUUwgU2VydmVyIChgc3BfZ2V0YXBwbG9ja2ApIGRvOyBTUUxpdGUgaGFzXG4gICAqIG5vIG5hdGl2ZSBwcmltaXRpdmUgKHRoZSBOb2RlIFNRTGl0ZSBkcml2ZXIgc3Vic3RpdHV0ZXMgaXRzXG4gICAqIGZpbGVzeXN0ZW0gbG9jayBkaXJlY3RvcnksIHRoZSB3ZWIvbmF0aXZlIGJ1aWxkcyBoYXZlIG5vdGhpbmcpLCBzb1xuICAgKiBmb3IgcGxhaW4gU1FMaXRlIHRoZSBwcm9jZXNzLWxvY2FsIHRpZXIgSVMgdGhlIHdob2xlIGltcGxlbWVudGF0aW9uXG4gICAqIGFuZCBjYWxsZXJzIG11c3Qgbm90IHJlYWQgaXQgYXMgYSBjcm9zcy1wcm9jZXNzIGd1YXJhbnRlZS5cbiAgICogQHJldHVybnMge2Jvb2xlYW59IC0gV2hldGhlciB0aGUgZHJpdmVyLW5hdGl2ZSB0aWVyIGV4aXN0cy5cbiAgICovXG4gIHN1cHBvcnRzRHJpdmVyTmF0aXZlQWR2aXNvcnlMb2NrKCkge1xuICAgIHJldHVybiB0cnVlXG4gIH1cblxuICAvKipcbiAgICogV2hldGhlciB0aGUgZHJpdmVyJ3MgbmF0aXZlIHRpZXIgaXMgcmUtZW50cmFudCB3aXRoaW4gdGhlIHNhbWVcbiAgICogc2Vzc2lvbi4gYEdFVF9MT0NLYCwgYHBnX2Fkdmlzb3J5X2xvY2tgIGFuZCBgc3BfZ2V0YXBwbG9ja2AgZ3JhbnQgdGhlXG4gICAqIHNhbWUgc2Vzc2lvbiByZXBlYXRlZGx5LCBzbyB0aGUgcHJvY2Vzcy1sb2NhbCB0aWVyIG11c3QgbGV0IGFcbiAgICogcmUtYWNxdWlzaXRpb24gYnkgaXRzIG93biBvd25lciBwYXNzIHRocm91Z2ggdG8gdGhlIG5hdGl2ZSB0aWVyLlxuICAgKiBTUUxpdGUncyBlbXVsYXRpb24gKGluY2x1ZGluZyB0aGUgTm9kZSBmaWxlc3lzdGVtIGxvY2spIGlzIG5vdFxuICAgKiByZS1lbnRyYW50LCBzbyB0aGUgdGllciBrZWVwcyB0cmVhdGluZyBhIHJlLWFjcXVpc2l0aW9uIGFzIGNvbnRlbnRpb25cbiAgICogZXhhY3RseSBhcyB0aGUgU1FMaXRlIGVtdWxhdGlvbiBhbHdheXMgaGFzLlxuICAgKiBAcmV0dXJucyB7Ym9vbGVhbn0gLSBXaGV0aGVyIHNhbWUtaW5zdGFuY2UgcmUtYWNxdWlzaXRpb24gaXMgaG9ub3JlZC5cbiAgICovXG4gIHN1cHBvcnRzUmVlbnRyYW50QWR2aXNvcnlMb2NrKCkge1xuICAgIHJldHVybiB0cnVlXG4gIH1cblxuICAvKipcbiAgICogUHJvY2Vzcy1sb2NhbCBwcmUtZmlsdGVyIHRpZXI6IEZJRk8gd2FpdGVyIHF1ZXVlIGZvciBvbmUgbG9jayBuYW1lXG4gICAqIGluc2lkZSB0aGlzIHByb2Nlc3MuIFRoaXMgaXMgdGhlIHByb21vdGVkIFNRTGl0ZSBlbXVsYXRpb24gZnJvbVxuICAgKiBTVEMtMjExIOKAlCBpdCBub3cgcnVucyBpbiBmcm9udCBvZiAqKmV2ZXJ5KiogZHJpdmVyJ3MgbmF0aXZlIHRpZXIgc28gYVxuICAgKiBzYW1lLXByb2Nlc3Mgd2FpdGVyIG5ldmVyIGlzc3VlcyBhIGRyaXZlci1uYXRpdmUgbG9jayBxdWVyeSBhbmQgbmV2ZXJcbiAgICogcGFya3MgYSBwb29sZWQgY29ubmVjdGlvbiBpbiBhIGRyaXZlciBsb2NrIHN0YXRlIHdoaWxlIHF1ZXVlZC5cbiAgICpcbiAgICogQSBncmFudCBoZXJlIG1lYW5zIG9ubHkgXCJ5b3UgYXJlIHRoZSBuZXh0IGNhbGxlciBpbiB0aGlzIHByb2Nlc3MuXCJcbiAgICogSXQgaXMgbmV2ZXIgdGhlIGF1dGhvcml0eSBmb3IgY3Jvc3MtcHJvY2Vzcy9jcm9zcy1ob3N0IGV4Y2x1c2lvbjsgdGhlXG4gICAqIGNhbGxlciBtdXN0IHN0aWxsIHBhc3MgdGhlIGRyaXZlci1uYXRpdmUgdGllciBiZWZvcmUgdGhlIGxvY2sgY291bnRzXG4gICAqIGFzIGhlbGQuIEEgcmUtZW50cmFudCBhY3F1aXNpdGlvbiBieSB0aGUgb3duaW5nIGRyaXZlciBpbnN0YW5jZSBpc1xuICAgKiBncmFudGVkIGltbWVkaWF0ZWx5LCBtaXJyb3JpbmcgdGhlIHNlc3Npb24tc2NvcGVkIHJlLWVudHJhbmN5IG9mXG4gICAqIGBHRVRfTE9DS2AgLyBgcGdfYWR2aXNvcnlfbG9ja2AgLyBgc3BfZ2V0YXBwbG9ja2AuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBuYW1lIC0gTG9jayBuYW1lLlxuICAgKiBAcGFyYW0ge3t0aW1lb3V0TXM/OiBudW1iZXIgfCBudWxsfX0gW2FyZ3NdIC0gT3B0aW9uYWwgdGltZW91dCBpbiBtaWxsaXNlY29uZHM7IGBudWxsYCwgYHVuZGVmaW5lZGAsIG9yIG5lZ2F0aXZlIGJsb2NrcyBmb3JldmVyLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx7YWNxdWlyZWQ6IGJvb2xlYW4sIHdhaXRlZDogYm9vbGVhbn0+fSAtIFdoZXRoZXIgdGhlIHRpZXIgZ3JhbnRlZCB0aGlzIGNhbGxlciwgYW5kIHdoZXRoZXIgaXQgaGFkIHRvIHF1ZXVlIGZvciBpdC5cbiAgICovXG4gIGFzeW5jIF9hY3F1aXJlUHJvY2Vzc0xvY2FsQWR2aXNvcnlMb2NrKG5hbWUsIHt0aW1lb3V0TXN9ID0ge30pIHtcbiAgICBjb25zdCBzdGF0ZSA9IFZlbG9jaW91c0RhdGFiYXNlRHJpdmVyc0Jhc2UuX2Fkdmlzb3J5TG9ja1N0YXRlXG4gICAgbGV0IHdhaXRlZCA9IGZhbHNlXG5cbiAgICB3aGlsZSAoc3RhdGUub3duZXJzQnlOYW1lLmhhcyhuYW1lKSkge1xuICAgICAgaWYgKHN0YXRlLm93bmVyc0J5TmFtZS5nZXQobmFtZSkgPT09IHRoaXMgJiYgdGhpcy5zdXBwb3J0c1JlZW50cmFudEFkdmlzb3J5TG9jaygpKSBicmVha1xuXG4gICAgICB3YWl0ZWQgPSB0cnVlXG5cbiAgICAgIGxldCByZW1haW5pbmdNcyA9IG51bGxcblxuICAgICAgaWYgKHR5cGVvZiB0aW1lb3V0TXMgPT09IFwibnVtYmVyXCIgJiYgdGltZW91dE1zID49IDApIHtcbiAgICAgICAgcmVtYWluaW5nTXMgPSB0aW1lb3V0TXNcblxuICAgICAgICBpZiAocmVtYWluaW5nTXMgPD0gMCkgcmV0dXJuIHthY3F1aXJlZDogZmFsc2UsIHdhaXRlZH1cbiAgICAgIH1cblxuICAgICAgYXdhaXQgbmV3IFByb21pc2UoKHJlc29sdmUpID0+IHtcbiAgICAgICAgY29uc3Qgd2FpdGVycyA9IHN0YXRlLndhaXRlcnNCeU5hbWUuZ2V0KG5hbWUpIHx8IFtdXG4gICAgICAgIC8qKlxuICAgICAgICAgKiBUaW1lb3V0IGhhbmRsZS5cbiAgICAgICAgICogQHR5cGUge1JldHVyblR5cGU8dHlwZW9mIHNldFRpbWVvdXQ+IHwgbnVsbH0gKi9cbiAgICAgICAgbGV0IHRpbWVvdXRIYW5kbGUgPSBudWxsXG4gICAgICAgIC8qKlxuICAgICAgICAgKiBSZW1vdmUgYW5kIHJlc29sdmUuXG4gICAgICAgICAqIEB0eXBlIHsoKCkgPT4gdm9pZCkgfCBudWxsfSAqL1xuICAgICAgICBsZXQgcmVtb3ZlQW5kUmVzb2x2ZSA9IG51bGxcblxuICAgICAgICByZW1vdmVBbmRSZXNvbHZlID0gKCkgPT4ge1xuICAgICAgICAgIGlmICh0aW1lb3V0SGFuZGxlKSBjbGVhclRpbWVvdXQodGltZW91dEhhbmRsZSlcblxuICAgICAgICAgIGNvbnN0IGN1cnJlbnQgPSBzdGF0ZS53YWl0ZXJzQnlOYW1lLmdldChuYW1lKSB8fCBbXVxuICAgICAgICAgIGNvbnN0IGluZGV4ID0gY3VycmVudC5pbmRleE9mKC8qKiBAdHlwZSB7KCkgPT4gdm9pZH0gKi8gKHJlbW92ZUFuZFJlc29sdmUpKVxuXG4gICAgICAgICAgaWYgKGluZGV4ID49IDApIGN1cnJlbnQuc3BsaWNlKGluZGV4LCAxKVxuICAgICAgICAgIGlmIChjdXJyZW50Lmxlbmd0aCA9PT0gMCkgc3RhdGUud2FpdGVyc0J5TmFtZS5kZWxldGUobmFtZSlcblxuICAgICAgICAgIHJlc29sdmUodW5kZWZpbmVkKVxuICAgICAgICB9XG5cbiAgICAgICAgd2FpdGVycy5wdXNoKHJlbW92ZUFuZFJlc29sdmUpXG4gICAgICAgIHN0YXRlLndhaXRlcnNCeU5hbWUuc2V0KG5hbWUsIHdhaXRlcnMpXG5cbiAgICAgICAgaWYgKHJlbWFpbmluZ01zICE9PSBudWxsKSB7XG4gICAgICAgICAgdGltZW91dEhhbmRsZSA9IHNldFRpbWVvdXQoKCkgPT4ge1xuICAgICAgICAgICAgaWYgKHJlbW92ZUFuZFJlc29sdmUpIHJlbW92ZUFuZFJlc29sdmUoKVxuICAgICAgICAgIH0sIHJlbWFpbmluZ01zKVxuICAgICAgICB9XG4gICAgICB9KVxuXG4gICAgICBpZiAodHlwZW9mIHRpbWVvdXRNcyA9PT0gXCJudW1iZXJcIiAmJiB0aW1lb3V0TXMgPj0gMCAmJiBzdGF0ZS5vd25lcnNCeU5hbWUuaGFzKG5hbWUpICYmICEoc3RhdGUub3duZXJzQnlOYW1lLmdldChuYW1lKSA9PT0gdGhpcyAmJiB0aGlzLnN1cHBvcnRzUmVlbnRyYW50QWR2aXNvcnlMb2NrKCkpKSB7XG4gICAgICAgIHJldHVybiB7YWNxdWlyZWQ6IGZhbHNlLCB3YWl0ZWR9XG4gICAgICB9XG4gICAgfVxuXG4gICAgc3RhdGUub3duZXJzQnlOYW1lLnNldChuYW1lLCB0aGlzKVxuXG4gICAgcmV0dXJuIHthY3F1aXJlZDogdHJ1ZSwgd2FpdGVkfVxuICB9XG5cbiAgLyoqXG4gICAqIEhhbmRzIHRoZSBwcm9jZXNzLWxvY2FsIHRpZXIgZm9yIG9uZSBsb2NrIG5hbWUgdG8gdGhlIG5leHQgRklGTyB3YWl0ZXIsXG4gICAqIGJ1dCBvbmx5IHdoZW4gKip0aGlzKiogZHJpdmVyIGluc3RhbmNlIGN1cnJlbnRseSBvd25zIGl0LiBBIHJlbGVhc2UgYnlcbiAgICogYSBub24tb3duZXIgaXMgYSBuby1vcCwgbWF0Y2hpbmcgdGhlIFwieW91IGNhbiBvbmx5IHJlbGVhc2UgbG9ja3MgeW91XG4gICAqIG93blwiIGNvbnRyYWN0IG9mIGBSRUxFQVNFX0xPQ0tgIC8gYHBnX2Fkdmlzb3J5X3VubG9ja2AuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBuYW1lIC0gTG9jayBuYW1lLlxuICAgKiBAcmV0dXJucyB7Ym9vbGVhbn0gLSBXaGV0aGVyIHRoaXMgaW5zdGFuY2Ugb3duZWQgdGhlIHRpZXIgYW5kIHJlbGVhc2VkIGl0LlxuICAgKi9cbiAgX3JlbGVhc2VQcm9jZXNzTG9jYWxBZHZpc29yeUxvY2sobmFtZSkge1xuICAgIGNvbnN0IHN0YXRlID0gVmVsb2Npb3VzRGF0YWJhc2VEcml2ZXJzQmFzZS5fYWR2aXNvcnlMb2NrU3RhdGVcbiAgICBjb25zdCBvd25lciA9IHN0YXRlLm93bmVyc0J5TmFtZS5nZXQobmFtZSlcblxuICAgIGlmIChvd25lciAhPT0gdGhpcykgcmV0dXJuIGZhbHNlXG5cbiAgICBzdGF0ZS5vd25lcnNCeU5hbWUuZGVsZXRlKG5hbWUpXG5cbiAgICBjb25zdCB3YWl0ZXJzID0gc3RhdGUud2FpdGVyc0J5TmFtZS5nZXQobmFtZSlcblxuICAgIGlmICh3YWl0ZXJzICYmIHdhaXRlcnMubGVuZ3RoID4gMCkge1xuICAgICAgY29uc3QgbmV4dFdhaXRlciA9IHdhaXRlcnMuc2hpZnQoKVxuXG4gICAgICBpZiAod2FpdGVycy5sZW5ndGggPT09IDApIHN0YXRlLndhaXRlcnNCeU5hbWUuZGVsZXRlKG5hbWUpXG4gICAgICBpZiAobmV4dFdhaXRlcikgbmV4dFdhaXRlcigpXG4gICAgfVxuXG4gICAgcmV0dXJuIHRydWVcbiAgfVxuXG4gIC8qKlxuICAgKiBEcml2ZXItc3BlY2lmaWMgYmxvY2tpbmcgYWR2aXNvcnktbG9jayBhY3F1aXNpdGlvbiBob29rLlxuICAgKiBUaGlzIGlzIHRoZSAqKmRyaXZlci1uYXRpdmUgdGllcioqIG9mIHRoZSBhY3F1aXNpdGlvbiBjaGFpbjogTWFyaWFEQlxuICAgKiBgR0VUX0xPQ0tgLCBQb3N0Z3JlU1FMIGBwZ19hZHZpc29yeV9sb2NrYCwgU1FMIFNlcnZlciBgc3BfZ2V0YXBwbG9ja2AsXG4gICAqIHRoZSBOb2RlIFNRTGl0ZSBmaWxlc3lzdGVtIGxvY2suIEl0IHJ1bnMgb25seSBhZnRlciB0aGUgcHJvY2Vzcy1sb2NhbFxuICAgKiBwcmUtZmlsdGVyIHRpZXIgaGFzIGdyYW50ZWQgdGhpcyBjYWxsZXIgaXRzIHR1cm4sIGFuZCBpdHMgcmVzdWx0IGlzXG4gICAqIHdoYXQgYWN0dWFsbHkgY29uZmlybXMgY3Jvc3MtcHJvY2Vzcy9jcm9zcy1ob3N0IGV4Y2x1c2lvbi5cbiAgICogQGFic3RyYWN0XG4gICAqIEBwYXJhbSB7c3RyaW5nfSBuYW1lIC0gTG9jayBuYW1lLlxuICAgKiBAcGFyYW0ge3t0aW1lb3V0TXM/OiBudW1iZXIgfCBudWxsfX0gW19hcmdzXSAtIExvY2sgdGltZW91dCBvcHRpb25zLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxib29sZWFuPn0gLSBXaGV0aGVyIHRoZSBsb2NrIHdhcyBhY3F1aXJlZC5cbiAgICovXG4gIF9hY3F1aXJlQWR2aXNvcnlMb2NrKG5hbWUsIF9hcmdzID0ge30pIHtcbiAgICB0aHJvdyBuZXcgRXJyb3IoYCdfYWNxdWlyZUFkdmlzb3J5TG9jaycgbm90IGltcGxlbWVudGVkIGZvciAke3RoaXMuY29uc3RydWN0b3IubmFtZX1gKVxuICB9XG5cbiAgLyoqXG4gICAqIEF0dGVtcHRzIHRvIGFjcXVpcmUgYSBuYW1lZCBhZHZpc29yeSBsb2NrIHdpdGhvdXQgYmxvY2tpbmcuXG4gICAqXG4gICAqIFNhbWUgdHdvLXRpZXIgY2hhaW4gYXMgYGFjcXVpcmVBZHZpc29yeUxvY2tgOiB0aGUgcHJvY2Vzcy1sb2NhbCB0aWVyXG4gICAqIHNob3J0LWNpcmN1aXRzIGNvbnRlbnRpb24gYmV0d2VlbiBjYWxsZXJzIGluIHRoaXMgcHJvY2VzcyAoYSBxdWV1ZWRcbiAgICogbmFtZSBuZXZlciByZWFjaGVzIHRoZSBkcml2ZXItbmF0aXZlIGhvb2spLCBhbmQgdGhlIGRyaXZlci1uYXRpdmUgdGllclxuICAgKiBjb25maXJtcyBjcm9zcy1wcm9jZXNzL2Nyb3NzLWhvc3QgZXhjbHVzaW9uLiBBIGZyZWUgaW4tcHJvY2VzcyB0aWVyIGlzXG4gICAqIE5PVCBhIGdyYW50IOKAlCB0aGUgbmF0aXZlIHRpZXIgc3RpbGwgaGFzIHRvIGFncmVlLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gbmFtZSAtIExvY2sgbmFtZS5cbiAgICogQHJldHVybnMge1Byb21pc2U8Ym9vbGVhbj59IC0gUmVzb2x2ZXMgdG8gdHJ1ZSBpZiB0aGUgbG9jayB3YXMgYWNxdWlyZWQsIGZhbHNlIGlmIGl0IHdhcyBhbHJlYWR5IGhlbGQuXG4gICAqL1xuICBhc3luYyB0cnlBY3F1aXJlQWR2aXNvcnlMb2NrKG5hbWUpIHtcbiAgICBjb25zdCBvd25lciA9IFZlbG9jaW91c0RhdGFiYXNlRHJpdmVyc0Jhc2UuX2Fkdmlzb3J5TG9ja1N0YXRlLm93bmVyc0J5TmFtZS5nZXQobmFtZSlcblxuICAgIGlmIChvd25lciAhPT0gdW5kZWZpbmVkICYmIG93bmVyICE9PSB0aGlzKSByZXR1cm4gZmFsc2VcblxuICAgIC8vIFNhbWUtaW5zdGFuY2UgcmUtYWNxdWlzaXRpb24gbWlycm9ycyB0aGUgcmUtZW50cmFudCBzZW1hbnRpY3Mgb2YgdGhlXG4gICAgLy8gc2Vzc2lvbi1zY29wZWQgZHJpdmVyLW5hdGl2ZSBsb2NrczsgYSBub24tcmUtZW50cmFudCBkcml2ZXIgKFNRTGl0ZSlcbiAgICAvLyBrZWVwcyB0cmVhdGluZyBpdCBhcyBjb250ZW50aW9uLCBleGFjdGx5IGFzIHRoZSBlbXVsYXRpb24gYWx3YXlzIGRpZC5cbiAgICBjb25zdCByZWVudHJhbnQgPSBvd25lciA9PT0gdGhpc1xuXG4gICAgaWYgKHJlZW50cmFudCAmJiAhdGhpcy5zdXBwb3J0c1JlZW50cmFudEFkdmlzb3J5TG9jaygpKSByZXR1cm4gZmFsc2VcblxuICAgIGlmICghcmVlbnRyYW50KSBWZWxvY2lvdXNEYXRhYmFzZURyaXZlcnNCYXNlLl9hZHZpc29yeUxvY2tTdGF0ZS5vd25lcnNCeU5hbWUuc2V0KG5hbWUsIHRoaXMpXG5cbiAgICBpZiAoIXRoaXMuc3VwcG9ydHNEcml2ZXJOYXRpdmVBZHZpc29yeUxvY2soKSkge1xuICAgICAgdGhpcy5fdHJhY2tBZHZpc29yeUxvY2sobmFtZSlcblxuICAgICAgcmV0dXJuIHRydWVcbiAgICB9XG5cbiAgICAvKiogQHR5cGUge2Jvb2xlYW59ICovXG4gICAgbGV0IGFjcXVpcmVkXG5cbiAgICB0cnkge1xuICAgICAgYWNxdWlyZWQgPSBhd2FpdCB0aGlzLl90cnlBY3F1aXJlQWR2aXNvcnlMb2NrKG5hbWUpXG4gICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgIGlmICghcmVlbnRyYW50KSB0aGlzLl9yZWxlYXNlUHJvY2Vzc0xvY2FsQWR2aXNvcnlMb2NrKG5hbWUpXG5cbiAgICAgIHRocm93IGVycm9yXG4gICAgfVxuXG4gICAgaWYgKCFhY3F1aXJlZCkge1xuICAgICAgaWYgKCFyZWVudHJhbnQpIHRoaXMuX3JlbGVhc2VQcm9jZXNzTG9jYWxBZHZpc29yeUxvY2sobmFtZSlcblxuICAgICAgcmV0dXJuIGZhbHNlXG4gICAgfVxuXG4gICAgdGhpcy5fdHJhY2tBZHZpc29yeUxvY2sobmFtZSlcblxuICAgIHJldHVybiB0cnVlXG4gIH1cblxuICAvKipcbiAgICogRHJpdmVyLXNwZWNpZmljIG5vbi1ibG9ja2luZyBhZHZpc29yeS1sb2NrIGFjcXVpc2l0aW9uIGhvb2suXG4gICAqIEBhYnN0cmFjdFxuICAgKiBAcGFyYW0ge3N0cmluZ30gbmFtZSAtIExvY2sgbmFtZS5cbiAgICogQHJldHVybnMge1Byb21pc2U8Ym9vbGVhbj59IC0gV2hldGhlciB0aGUgbG9jayB3YXMgYWNxdWlyZWQuXG4gICAqL1xuICBfdHJ5QWNxdWlyZUFkdmlzb3J5TG9jayhuYW1lKSB7IC8vIGVzbGludC1kaXNhYmxlLWxpbmUgbm8tdW51c2VkLXZhcnNcbiAgICB0aHJvdyBuZXcgRXJyb3IoYCdfdHJ5QWNxdWlyZUFkdmlzb3J5TG9jaycgbm90IGltcGxlbWVudGVkIGZvciAke3RoaXMuY29uc3RydWN0b3IubmFtZX1gKVxuICB9XG5cbiAgLyoqXG4gICAqIFJlbGVhc2VzIGEgbmFtZWQgYWR2aXNvcnkgbG9jayBwcmV2aW91c2x5IGFjcXVpcmVkIG9uIHRoaXMgY29ubmVjdGlvbi5cbiAgICogVGhlIGRyaXZlci1uYXRpdmUgcmVsZWFzZSBydW5zIGZpcnN0OyB0aGUgcHJvY2Vzcy1sb2NhbCB0aWVyIGlzIGhhbmRlZFxuICAgKiB0byB0aGUgbmV4dCB3YWl0ZXIgb25seSBvbmNlIHRoaXMgY29ubmVjdGlvbidzIGNvdW50ZWQgcmVnaXN0cnkgbm9cbiAgICogbG9uZ2VyIGhvbGRzIHRoZSBuYW1lLCBzbyByZS1lbnRyYW50IGFjcXVpc2l0aW9ucyByZWxlYXNlIG9uZSBsZXZlbCBhdFxuICAgKiBhIHRpbWUgZXhhY3RseSBsaWtlIHRoZSBzZXNzaW9uLXNjb3BlZCBkcml2ZXIgbG9ja3MuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBuYW1lIC0gTG9jayBuYW1lLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxib29sZWFuPn0gLSBSZXNvbHZlcyB0byB0cnVlIGlmIHRoZSBsb2NrIHdhcyBoZWxkIGJ5IHRoaXMgc2Vzc2lvbiBhbmQgaGFzIG5vdyBiZWVuIHJlbGVhc2VkLlxuICAgKi9cbiAgYXN5bmMgcmVsZWFzZUFkdmlzb3J5TG9jayhuYW1lKSB7XG4gICAgY29uc3Qgb3duZXIgPSBWZWxvY2lvdXNEYXRhYmFzZURyaXZlcnNCYXNlLl9hZHZpc29yeUxvY2tTdGF0ZS5vd25lcnNCeU5hbWUuZ2V0KG5hbWUpXG5cbiAgICAvLyBBbm90aGVyIGRyaXZlciBpbnN0YW5jZSBpbiB0aGlzIHByb2Nlc3Mgb3ducyB0aGUgdGllciBmb3IgdGhpcyBuYW1lLFxuICAgIC8vIHNvIHRoaXMgY29ubmVjdGlvbiBjYW4gbmV2ZXIgYmUgdGhlIG5hdGl2ZSBob2xkZXIgZWl0aGVyIOKAlCByZWZ1c2VcbiAgICAvLyBiZWZvcmUgaXNzdWluZyBhIHJlbGVhc2Ugc3RhdGVtZW50IHRoYXQgY291bGQgZGlzdHVyYiB0aGUgb3duZXIuXG4gICAgaWYgKG93bmVyICE9PSB1bmRlZmluZWQgJiYgb3duZXIgIT09IHRoaXMpIHJldHVybiBmYWxzZVxuXG4gICAgaWYgKCF0aGlzLnN1cHBvcnRzRHJpdmVyTmF0aXZlQWR2aXNvcnlMb2NrKCkpIHtcbiAgICAgIC8vIFBsYWluIFNRTGl0ZTogdGhlIHByb2Nlc3MtbG9jYWwgdGllciBJUyB0aGUgbG9jaywgc28gdGhlIGZpcnN0XG4gICAgICAvLyByZWxlYXNlIGJ5IHRoZSBvd25lciByZWxlYXNlcyBpdCBmdWxseSwgZXhhY3RseSBhcyB0aGUgU1FMaXRlXG4gICAgICAvLyBlbXVsYXRpb24gYWx3YXlzIGhhcy5cbiAgICAgIGNvbnN0IHJlbGVhc2VkID0gdGhpcy5fcmVsZWFzZVByb2Nlc3NMb2NhbEFkdmlzb3J5TG9jayhuYW1lKVxuXG4gICAgICBpZiAocmVsZWFzZWQpIHtcbiAgICAgICAgdGhpcy5fdW50cmFja0Fkdmlzb3J5TG9jayhuYW1lKVxuICAgICAgfSBlbHNlIHtcbiAgICAgICAgdGhpcy5faGVsZEFkdmlzb3J5TG9ja3MuZGVsZXRlKG5hbWUpXG4gICAgICB9XG5cbiAgICAgIHJldHVybiByZWxlYXNlZFxuICAgIH1cblxuICAgIGNvbnN0IHJlbGVhc2VkID0gYXdhaXQgdGhpcy5fcmVsZWFzZUFkdmlzb3J5TG9jayhuYW1lKVxuXG4gICAgaWYgKHJlbGVhc2VkKSB7XG4gICAgICB0aGlzLl91bnRyYWNrQWR2aXNvcnlMb2NrKG5hbWUpXG4gICAgfSBlbHNlIHtcbiAgICAgIHRoaXMuX2hlbGRBZHZpc29yeUxvY2tzLmRlbGV0ZShuYW1lKVxuICAgIH1cblxuICAgIGlmICghdGhpcy5faGVsZEFkdmlzb3J5TG9ja3MuaGFzKG5hbWUpKSB7XG4gICAgICBjb25zdCBhY3F1aXJlZEF0ID0gdGhpcy5fYWR2aXNvcnlMb2NrQWNxdWlyZWRBdEJ5TmFtZS5nZXQobmFtZSlcblxuICAgICAgdGhpcy5fYWR2aXNvcnlMb2NrQWNxdWlyZWRBdEJ5TmFtZS5kZWxldGUobmFtZSlcblxuICAgICAgaWYgKGFjcXVpcmVkQXQgIT09IHVuZGVmaW5lZCkge1xuICAgICAgICBjb25zdCBob2xkRHVyYXRpb25NcyA9IERhdGUubm93KCkgLSBhY3F1aXJlZEF0XG4gICAgICAgIGNvbnN0IHNsb3dIb2xkTXMgPSBhZHZpc29yeUxvY2tUZWxlbWV0cnlUaHJlc2hvbGRzKHRoaXMuZ2V0QXJncygpKS5zbG93SG9sZE1zXG5cbiAgICAgICAgaWYgKHNsb3dIb2xkTXMgIT09IG51bGwgJiYgaG9sZER1cmF0aW9uTXMgPiBzbG93SG9sZE1zKSB7XG4gICAgICAgICAgYXdhaXQgdGhpcy5fcmVwb3J0QWR2aXNvcnlMb2NrVGVsZW1ldHJ5KHtldmVudDogXCJhZHZpc29yeS1sb2NrLXNsb3ctaG9sZFwiLCBsb2NrTmFtZTogbmFtZSwgZHVyYXRpb25NczogaG9sZER1cmF0aW9uTXMsIG91dGNvbWU6IG51bGwsIHRpbWVvdXRNczogbnVsbH0pXG4gICAgICAgIH1cbiAgICAgIH1cblxuICAgICAgLy8gTGFzdCBjb25uZWN0aW9uLWxldmVsIHJlbGVhc2U6IGhhbmQgdGhlIHByb2Nlc3MtbG9jYWwgdGllciB0byB0aGVcbiAgICAgIC8vIG5leHQgcXVldWVkIGNhbGxlciBpbiB0aGlzIHByb2Nlc3MuXG4gICAgICB0aGlzLl9yZWxlYXNlUHJvY2Vzc0xvY2FsQWR2aXNvcnlMb2NrKG5hbWUpXG4gICAgfVxuXG4gICAgcmV0dXJuIHJlbGVhc2VkXG4gIH1cblxuICAvKipcbiAgICogRHJpdmVyLXNwZWNpZmljIGFkdmlzb3J5LWxvY2sgcmVsZWFzZSBob29rLlxuICAgKiBAYWJzdHJhY3RcbiAgICogQHBhcmFtIHtzdHJpbmd9IG5hbWUgLSBMb2NrIG5hbWUuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPGJvb2xlYW4+fSAtIFdoZXRoZXIgdGhlIGxvY2sgd2FzIHJlbGVhc2VkLlxuICAgKi9cbiAgX3JlbGVhc2VBZHZpc29yeUxvY2sobmFtZSkgeyAvLyBlc2xpbnQtZGlzYWJsZS1saW5lIG5vLXVudXNlZC12YXJzXG4gICAgdGhyb3cgbmV3IEVycm9yKGAnX3JlbGVhc2VBZHZpc29yeUxvY2snIG5vdCBpbXBsZW1lbnRlZCBmb3IgJHt0aGlzLmNvbnN0cnVjdG9yLm5hbWV9YClcbiAgfVxuXG4gIC8qKlxuICAgKiBSZWxlYXNlcyBldmVyeSBhZHZpc29yeSBsb2NrIHN0aWxsIHRyYWNrZWQgb24gdGhpcyBjb25uZWN0aW9uLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyB3aGVuIGV2ZXJ5IHRyYWNrZWQgbG9jayBpcyByZWxlYXNlZC5cbiAgICovXG4gIGFzeW5jIHJlbGVhc2VIZWxkQWR2aXNvcnlMb2NrcygpIHtcbiAgICAvKiogQHR5cGUge0Vycm9yW119ICovXG4gICAgY29uc3QgZXJyb3JzID0gW11cblxuICAgIGZvciAoY29uc3QgbmFtZSBvZiBbLi4udGhpcy5faGVsZEFkdmlzb3J5TG9ja3Mua2V5cygpXSkge1xuICAgICAgd2hpbGUgKHRoaXMuX2hlbGRBZHZpc29yeUxvY2tzLmhhcyhuYW1lKSkge1xuICAgICAgICB0cnkge1xuICAgICAgICAgIGF3YWl0IHRoaXMucmVsZWFzZUFkdmlzb3J5TG9jayhuYW1lKVxuICAgICAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgICAgIGVycm9ycy5wdXNoKGVycm9yIGluc3RhbmNlb2YgRXJyb3IgPyBlcnJvciA6IG5ldyBFcnJvcihgRmFpbGVkIHRvIHJlbGVhc2UgYWR2aXNvcnkgbG9jayAke0pTT04uc3RyaW5naWZ5KG5hbWUpfWAsIHtjYXVzZTogZXJyb3J9KSlcbiAgICAgICAgICBicmVha1xuICAgICAgICB9XG4gICAgICB9XG4gICAgfVxuXG4gICAgaWYgKGVycm9ycy5sZW5ndGggPT0gMSkgdGhyb3cgZXJyb3JzWzBdXG4gICAgaWYgKGVycm9ycy5sZW5ndGggPiAxKSB0aHJvdyBuZXcgQWdncmVnYXRlRXJyb3IoZXJyb3JzLCBcIkZhaWxlZCB0byByZWxlYXNlIGhlbGQgYWR2aXNvcnkgbG9ja3NcIilcbiAgfVxuXG4gIC8qKlxuICAgKiBSZWNvcmRzIG9uZSBzdWNjZXNzZnVsIGFjcXVpc2l0aW9uLCBpbmNsdWRpbmcgcmUtZW50cmFudCBhY3F1aXNpdGlvbnMuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBuYW1lIC0gTG9jayBuYW1lLlxuICAgKiBAcmV0dXJucyB7dm9pZH1cbiAgICovXG4gIF90cmFja0Fkdmlzb3J5TG9jayhuYW1lKSB7XG4gICAgdGhpcy5faGVsZEFkdmlzb3J5TG9ja3Muc2V0KG5hbWUsICh0aGlzLl9oZWxkQWR2aXNvcnlMb2Nrcy5nZXQobmFtZSkgfHwgMCkgKyAxKVxuXG4gICAgaWYgKCF0aGlzLl9hZHZpc29yeUxvY2tBY3F1aXJlZEF0QnlOYW1lLmhhcyhuYW1lKSkgdGhpcy5fYWR2aXNvcnlMb2NrQWNxdWlyZWRBdEJ5TmFtZS5zZXQobmFtZSwgRGF0ZS5ub3coKSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSZW1vdmVzIG9uZSBzdWNjZXNzZnVsIGFjcXVpc2l0aW9uIGZyb20gdGhlIGNvbm5lY3Rpb24gcmVnaXN0cnkuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBuYW1lIC0gTG9jayBuYW1lLlxuICAgKiBAcmV0dXJucyB7dm9pZH1cbiAgICovXG4gIF91bnRyYWNrQWR2aXNvcnlMb2NrKG5hbWUpIHtcbiAgICBjb25zdCByZW1haW5pbmdDb3VudCA9ICh0aGlzLl9oZWxkQWR2aXNvcnlMb2Nrcy5nZXQobmFtZSkgfHwgMCkgLSAxXG5cbiAgICBpZiAocmVtYWluaW5nQ291bnQgPiAwKSB7XG4gICAgICB0aGlzLl9oZWxkQWR2aXNvcnlMb2Nrcy5zZXQobmFtZSwgcmVtYWluaW5nQ291bnQpXG4gICAgfSBlbHNlIHtcbiAgICAgIHRoaXMuX2hlbGRBZHZpc29yeUxvY2tzLmRlbGV0ZShuYW1lKVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBDaGVja3Mgd2hldGhlciBhIG5hbWVkIGFkdmlzb3J5IGxvY2sgaXMgY3VycmVudGx5IGhlbGQgYnkgYW55IHNlc3Npb24uXG4gICAqIEludGVuZGVkIGFzIGFuIGludHJvc3BlY3Rpb24gaGVscGVyOyBjYWxsZXJzIHdobyBuZWVkIHRvIGFjdCBvbiB0aGVcbiAgICogcmVzdWx0IHNob3VsZCBwcmVmZXIgYHRyeUFjcXVpcmVBZHZpc29yeUxvY2tgIHRvIGF2b2lkIGEgVE9DVE9VIHJhY2UuXG4gICAqXG4gICAqIFRoZSBwcm9jZXNzLWxvY2FsIHRpZXIgYW5zd2VycyBmaXJzdCAoYSBzYW1lLXByb2Nlc3MgaG9sZGVyIGlzIGFcbiAgICogaG9sZGVyLCBmdWxsIHN0b3ApOyBvdGhlcndpc2UgdGhlIHF1ZXN0aW9uIGdvZXMgdG8gdGhlIGRyaXZlci1uYXRpdmVcbiAgICogdGllcidzIGludHJvc3BlY3Rpb24gKGBJU19VU0VEX0xPQ0tgIC8gYHBnX2xvY2tzYCAvIGBBUFBMT0NLX1RFU1RgKS5cbiAgICogQHBhcmFtIHtzdHJpbmd9IG5hbWUgLSBMb2NrIG5hbWUuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPGJvb2xlYW4+fSAtIFJlc29sdmVzIHRvIHRydWUgaWYgdGhlIGxvY2sgaXMgaGVsZCBieSBhbnkgc2Vzc2lvbi5cbiAgICovXG4gIGFzeW5jIGlzQWR2aXNvcnlMb2NrSGVsZChuYW1lKSB7XG4gICAgaWYgKFZlbG9jaW91c0RhdGFiYXNlRHJpdmVyc0Jhc2UuX2Fkdmlzb3J5TG9ja1N0YXRlLm93bmVyc0J5TmFtZS5oYXMobmFtZSkpIHJldHVybiB0cnVlXG5cbiAgICBpZiAoIXRoaXMuc3VwcG9ydHNEcml2ZXJOYXRpdmVBZHZpc29yeUxvY2soKSkgcmV0dXJuIGZhbHNlXG5cbiAgICByZXR1cm4gYXdhaXQgdGhpcy5faXNBZHZpc29yeUxvY2tIZWxkTmF0aXZlKG5hbWUpXG4gIH1cblxuICAvKipcbiAgICogRHJpdmVyLW5hdGl2ZSBhZHZpc29yeS1sb2NrIGludHJvc3BlY3Rpb24gaG9vayBiZWhpbmRcbiAgICogYGlzQWR2aXNvcnlMb2NrSGVsZGAuXG4gICAqIEBhYnN0cmFjdFxuICAgKiBAcGFyYW0ge3N0cmluZ30gbmFtZSAtIExvY2sgbmFtZS5cbiAgICogQHJldHVybnMge1Byb21pc2U8Ym9vbGVhbj59IC0gUmVzb2x2ZXMgdG8gdHJ1ZSBpZiB0aGUgbmF0aXZlIHRpZXIgcmVwb3J0cyB0aGUgbG9jayBoZWxkLlxuICAgKi9cbiAgX2lzQWR2aXNvcnlMb2NrSGVsZE5hdGl2ZShuYW1lKSB7IC8vIGVzbGludC1kaXNhYmxlLWxpbmUgbm8tdW51c2VkLXZhcnNcbiAgICB0aHJvdyBuZXcgRXJyb3IoYCdfaXNBZHZpc29yeUxvY2tIZWxkTmF0aXZlJyBub3QgaW1wbGVtZW50ZWQgZm9yICR7dGhpcy5jb25zdHJ1Y3Rvci5uYW1lfWApXG4gIH1cblxuICAvKipcbiAgICogV2hpY2ggYWR2aXNvcnktbG9jayBiYWNrZW5kIHRpZXIgdGhpcyBjb25uZWN0aW9uIHNlcnZlcyAoU1RDLTIxMCBjaGFpblxuICAgKiBuYW1pbmcpLiBUaGUgYmFzZSBkcml2ZXIgaXMgdGhlIGRyaXZlci1uYXRpdmUgdGllcjsgdGhlIFNRTGl0ZSBkcml2ZXJzXG4gICAqIG92ZXJyaWRlIHRvIGBwcm9jZXNzLWxvY2FsYCAvIGBmaWxlYC5cbiAgICogQHJldHVybnMge3N0cmluZ30gLSBUaWVyIG5hbWUgcmVwb3J0ZWQgb24gdGVsZW1ldHJ5IHBheWxvYWRzLlxuICAgKi9cbiAgYWR2aXNvcnlMb2NrQmFja2VuZFRpZXIoKSB7XG4gICAgcmV0dXJuIFwiZHJpdmVyLW5hdGl2ZVwiXG4gIH1cblxuICAvKipcbiAgICogU3RhYmxlIGlkZW50aXR5IG9mIHRoaXMgY29ubmVjdGlvbiBhcyBhIGxvY2sgaG9sZGVyLCByZXBvcnRlZCBvblxuICAgKiB0ZWxlbWV0cnkgcGF5bG9hZHMgc28gYSBzbG93IGFjcXVpcmUvaG9sZCBpcyBhdHRyaWJ1dGFibGUgdG8gdGhlIHJlcG9ydGluZ1xuICAgKiBjb25uZWN0aW9uIGl0c2VsZi5cbiAgICogQHJldHVybnMge3N0cmluZ30gLSBIb2xkZXIgaWQuXG4gICAqL1xuICBhZHZpc29yeUxvY2tIb2xkZXJJZCgpIHtcbiAgICBpZiAoIXRoaXMuX2Fkdmlzb3J5TG9ja0hvbGRlcklkKSB0aGlzLl9hZHZpc29yeUxvY2tIb2xkZXJJZCA9IGBhZHZpc29yeS1sb2NrLWhvbGRlcjoke25ldyBVVUlEKDQpLmZvcm1hdCgpfWBcblxuICAgIHJldHVybiB0aGlzLl9hZHZpc29yeUxvY2tIb2xkZXJJZFxuICB9XG5cbiAgLyoqXG4gICAqIEJlc3QtZWZmb3J0IGlkZW50aXR5IG9mIHRoZSBjb25uZWN0aW9uIGN1cnJlbnRseSBob2xkaW5nIHRoZSBuYW1lZCBsb2NrLFxuICAgKiBjYXB0dXJlZCBvbiB0aGUgdGllciB0aGF0IHNlcnZlZCB0aGUgYWNxdWlzaXRpb24uIFRoZSBiYXNlIGRyaXZlciBoYXMgbm9cbiAgICogcG9ydGFibGUgc2VydmVyLXNpZGUgbG9va3VwOyBNeVNRTC9Qb3N0Z3JlU1FML1NRTCBTZXJ2ZXIvTm9kZS1TUUxpdGVcbiAgICogb3ZlcnJpZGUgd2l0aCB0aGVpciB0aWVyJ3MgaG9sZGVyIGF0dHJpYnV0aW9uLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gbmFtZSAtIExvY2sgbmFtZS5cbiAgICogQHJldHVybnMge1Byb21pc2U8c3RyaW5nIHwgbnVsbD59IC0gSG9sZGVyIGNvbm5lY3Rpb24gaWRlbnRpdHksIG9yIG51bGwgd2hlbiB0aGUgdGllciBjYW5ub3QgYXR0cmlidXRlIGl0LlxuICAgKi9cbiAgYXN5bmMgYWR2aXNvcnlMb2NrSG9sZGVyQ29ubmVjdGlvbklkKG5hbWUpIHsgLy8gZXNsaW50LWRpc2FibGUtbGluZSBuby11bnVzZWQtdmFyc1xuICAgIHJldHVybiBudWxsXG4gIH1cblxuICAvKipcbiAgICogRW1pdCBvbmUgZXZlbnQtZHJpdmVuIGFkdmlzb3J5LWxvY2sgdGVsZW1ldHJ5IHJlcG9ydCAoc2xvdyBhY3F1aXJlLFxuICAgKiBhY3F1aXJlIHRpbWVvdXQgd2l0aCBob2xkZXIgYXR0cmlidXRpb24sIHNsb3cgaG9sZCkuIFRoZSBob2xkZXIgbG9va3VwIGlzXG4gICAqIGJlc3QtZWZmb3J0OiBhIGZhaWxlZCBsb29rdXAgaXMgcmVjb3JkZWQgb24gdGhlIHJlcG9ydCBhbmQgbmV2ZXIgYWZmZWN0c1xuICAgKiB0aGUgYWNxdWlzaXRpb24gdGhhdCBhbHJlYWR5IHNldHRsZWQuXG4gICAqIEBwYXJhbSB7e2V2ZW50OiBcImFkdmlzb3J5LWxvY2stc2xvdy1hY3F1aXJlXCIgfCBcImFkdmlzb3J5LWxvY2stYWNxdWlyZS10aW1lb3V0XCIgfCBcImFkdmlzb3J5LWxvY2stc2xvdy1ob2xkXCIsIGxvY2tOYW1lOiBzdHJpbmcsIGR1cmF0aW9uTXM6IG51bWJlciwgb3V0Y29tZTogXCJhY3F1aXJlZFwiIHwgXCJ0aW1lb3V0XCIgfCBudWxsLCB0aW1lb3V0TXM6IG51bWJlciB8IG51bGwsIGNhcHR1cmVIb2xkZXI/OiBib29sZWFufX0gYXJncyAtIFJlcG9ydCBhcmdzLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyBhZnRlciB0aGUgcmVwb3J0IGlzIGVtaXR0ZWQuXG4gICAqL1xuICBhc3luYyBfcmVwb3J0QWR2aXNvcnlMb2NrVGVsZW1ldHJ5KGFyZ3MpIHtcbiAgICAvKiogQHR5cGUge2ltcG9ydChcIi4uL2Fkdmlzb3J5LWxvY2stdGVsZW1ldHJ5LmpzXCIpLkFkdmlzb3J5TG9ja1RlbGVtZXRyeVJlcG9ydH0gKi9cbiAgICBjb25zdCByZXBvcnQgPSB7XG4gICAgICBldmVudDogYXJncy5ldmVudCxcbiAgICAgIGxvY2tOYW1lOiBhcmdzLmxvY2tOYW1lLFxuICAgICAgYmFja2VuZFRpZXI6IHRoaXMuYWR2aXNvcnlMb2NrQmFja2VuZFRpZXIoKSxcbiAgICAgIGR1cmF0aW9uTXM6IGFyZ3MuZHVyYXRpb25NcyxcbiAgICAgIG91dGNvbWU6IGFyZ3Mub3V0Y29tZSxcbiAgICAgIHRpbWVvdXRNczogYXJncy50aW1lb3V0TXMsXG4gICAgICBob2xkZXJJZDogdGhpcy5hZHZpc29yeUxvY2tIb2xkZXJJZCgpLFxuICAgICAgaG9sZGVyQ29ubmVjdGlvbklkOiBudWxsLFxuICAgICAgaG9sZGVyTG9va3VwRXJyb3I6IG51bGxcbiAgICB9XG5cbiAgICBpZiAoYXJncy5jYXB0dXJlSG9sZGVyKSB7XG4gICAgICB0cnkge1xuICAgICAgICByZXBvcnQuaG9sZGVyQ29ubmVjdGlvbklkID0gYXdhaXQgdGhpcy5hZHZpc29yeUxvY2tIb2xkZXJDb25uZWN0aW9uSWQoYXJncy5sb2NrTmFtZSlcbiAgICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICAgIHJlcG9ydC5ob2xkZXJMb29rdXBFcnJvciA9IGVycm9yIGluc3RhbmNlb2YgRXJyb3IgPyBlcnJvci5tZXNzYWdlIDogU3RyaW5nKGVycm9yKVxuICAgICAgfVxuICAgIH1cblxuICAgIGVtaXRBZHZpc29yeUxvY2tUZWxlbWV0cnlSZXBvcnQodGhpcy5jb25maWd1cmF0aW9uLCByZXBvcnQpXG4gIH1cbn1cbiJdfQ==