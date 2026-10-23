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
import BoundedTaskRunner from "../../utils/bounded-task-runner.js";
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
     * Seeds schema metadata that was loaded in one batch for many tables, so a later
     * per-table read resolves from the cache instead of issuing its own query.
     * @template T
     * @param {string} tableName - Table name.
     * @param {string} metadataName - Metadata name.
     * @param {T} value - Already-resolved metadata.
     * @returns {void}
     */
    seedTableSchemaMetadata(tableName, metadataName, value) {
        if (!this._schemaCacheEnabled())
            return;
        this._schemaCache.set(`table:${tableName}:${metadataName}`, Promise.resolve(value));
    }
    /**
     * Loads column metadata for several tables, combining the reads into one query
     * when the driver can answer for all of them at once and seeding the per-table
     * cache so the models that follow initialize without querying.
     * @param {Array<import("./base-table.js").default>} tables - Tables to load columns for.
     * @param {{concurrency?: number}} [args] - Concurrency for drivers that can only read per table.
     * @returns {Promise<void>}
     */
    async prefetchTableColumns(tables, { concurrency = 8 } = {}) {
        if (!this._schemaCacheEnabled())
            return;
        if (tables.length === 0)
            return;
        const batchedColumns = await this.batchTableColumns(tables);
        if (batchedColumns) {
            for (const [tableName, columns] of batchedColumns) {
                this.seedTableSchemaMetadata(tableName, "columns", columns);
            }
            return;
        }
        await BoundedTaskRunner.run({
            concurrency,
            items: tables,
            worker: async (table) => {
                await table.getColumns();
            }
        });
    }
    /**
     * Batched column metadata for many tables at once. Drivers whose engine cannot
     * answer for several tables in one statement return null, leaving the caller to
     * read them per table.
     * @param {Array<import("./base-table.js").default>} tables - Tables to load columns for.
     * @returns {Promise<Map<string, Array<import("./base-column.js").default>> | null>} - Columns keyed by table name, or null when unsupported.
     */
    async batchTableColumns(tables) {
        void tables;
        return null;
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiYmFzZS5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uLy4uLy4uLy4uL3NyYy9kYXRhYmFzZS9kcml2ZXJzL2Jhc2UuanMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6IkFBQUEsWUFBWTtBQUVaOzs7Ozs7OztHQVFHO0FBQ0g7Ozs7O0dBS0c7QUFDSDs7Ozs7R0FLRztBQUNIOzs7OztHQUtHO0FBQ0g7Ozs7Ozs7OztHQVNHO0FBQ0g7Ozs7R0FJRztBQUNIOzs7OztHQUtHO0FBQ0g7Ozs7Ozs7OztHQVNHO0FBQ0g7Ozs7Ozs7Ozs7Ozs7R0FhRztBQUVIOzs7Ozs7Ozs7Ozs7Ozs7OztHQWlCRztBQUVIOzs7Ozs7R0FNRztBQUVIOzs7Ozs7OztHQVFHO0FBRUg7Ozs7Ozs7Ozs7O0dBV0c7QUFFSDs7Ozs7OztHQU9HO0FBRUg7Ozs7OztHQU1HO0FBQ0g7Ozs7Ozs7R0FPRztBQUVIOzs7Ozs7R0FNRztBQUVILE9BQU8sZ0JBQWdCLE1BQU0sa0NBQWtDLENBQUE7QUFDL0QsT0FBTyxpQkFBaUIsTUFBTSxvQ0FBb0MsQ0FBQTtBQUNsRSxPQUFPLEVBQUUsc0JBQXNCLEVBQUUsTUFBTSxtQkFBbUIsQ0FBQTtBQUMxRCxPQUFPLEVBQUUscUJBQXFCLEVBQUUsTUFBTSx3QkFBd0IsQ0FBQTtBQUM5RCxPQUFPLE1BQU0sTUFBTSx3QkFBd0IsQ0FBQTtBQUMzQyxPQUFPLEVBQUMsd0NBQXdDLEVBQUMsTUFBTSwyQkFBMkIsQ0FBQTtBQUNsRixPQUFPLEVBQUMsK0JBQStCLEVBQUUsK0JBQStCLEVBQUMsTUFBTSwrQkFBK0IsQ0FBQTtBQUM5RyxPQUFPLE1BQU0sTUFBTSxpQkFBaUIsQ0FBQTtBQUNwQyxPQUFPLEtBQUssTUFBTSxtQkFBbUIsQ0FBQTtBQUNyQyxPQUFPLGlCQUFpQixNQUFNLDJCQUEyQixDQUFBO0FBQ3pELE9BQU8sT0FBTyxNQUFNLGVBQWUsQ0FBQTtBQUNuQyxPQUFPLEVBQUUsY0FBYyxFQUFFLE1BQU0saUNBQWlDLENBQUE7QUFDaEUsT0FBTyxL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LFNBQVMsRUFBRSxJQUFJLENBQUMsU0FBUztZQUN6QixRQUFRLEVBQUUsSUFBSSxDQUFDLG9CQUFvQixFQUFFO1lBQ3JDLGtCQUFrQixFQUFFLElBQUk7WUFDeEIsaUJBQWlCLEVBQUUsSUFBSTtTQUN4QixDQUFBO1FBRUQsSUFBSSxJQUFJLENBQUMsYUFBYSxFQUFFLENBQUM7WUFDdkIsSUFBSSxDQUFDO2dCQUNILE1BQU0sQ0FBQyxrQkFBa0IsR0FBRyxNQUFNLElBQUksQ0FBQyw4QkFBOEIsQ0FBQyxJQUFJLENBQUMsUUFBUSxDQUFDLENBQUE7WUFDdEYsQ0FBQztZQUFDLE9BQU8sS0FBSyxFQUFFLENBQUM7Z0JBQ2YsTUFBTSxDQUFDLGlCQUFpQixHQUFHLEtBQUssWUFBWSxLQUFLLENBQUMsQ0FBQyxDQUFDLEtBQUssQ0FBQyxPQUFPLENBQUMsQ0FBQyxDQUFDLE1BQU0sQ0FBQyxLQUFLLENBQUMsQ0FBQTtZQUNuRixDQUFDO1FBQ0gsQ0FBQztRQUVELCtCQUErQixDQUFDLElBQUksQ0FBQyxhQUFhLEVBQUUsTUFBTSxDQUFDLENBQUE7SUFDN0QsQ0FBQztDQUNGIiwic291cmNlc0NvbnRlbnQiOlsiLy8gQHRzLWNoZWNrXG5cbi8qKlxuICogQ3JlYXRlSW5kZXhTcWxBcmdzIHR5cGUuXG4gKiBAdHlwZWRlZiB7b2JqZWN0fSBDcmVhdGVJbmRleFNxbEFyZ3NcbiAqIEBwcm9wZXJ0eSB7QXJyYXk8c3RyaW5nIHwgaW1wb3J0KFwiLi8uLi90YWJsZS1kYXRhL3RhYmxlLWNvbHVtbi5qc1wiKS5kZWZhdWx0Pn0gY29sdW1ucyAtIENvbHVtbnMgdG8gaW5jbHVkZSBpbiB0aGUgaW5kZXguXG4gKiBAcHJvcGVydHkge2Jvb2xlYW59IFtpZk5vdEV4aXN0c10gLSBTa2lwIGNyZWF0aW9uIGlmIHRoZSBpbmRleCBhbHJlYWR5IGV4aXN0cy5cbiAqIEBwcm9wZXJ0eSB7c3RyaW5nfSBbbmFtZV0gLSBFeHBsaWNpdCBpbmRleCBuYW1lIHRvIHVzZS5cbiAqIEBwcm9wZXJ0eSB7Ym9vbGVhbn0gW3VuaXF1ZV0gLSBXaGV0aGVyIHRoZSBpbmRleCBzaG91bGQgZW5mb3JjZSB1bmlxdWVuZXNzLlxuICogQHByb3BlcnR5IHtzdHJpbmd9IHRhYmxlTmFtZSAtIE5hbWUgb2YgdGhlIHRhYmxlIHRvIGFkZCB0aGUgaW5kZXggdG8uXG4gKi9cbi8qKlxuICogUmVtb3ZlSW5kZXhTcWxBcmdzIHR5cGUuXG4gKiBAdHlwZWRlZiB7b2JqZWN0fSBSZW1vdmVJbmRleFNxbEFyZ3NcbiAqIEBwcm9wZXJ0eSB7c3RyaW5nfSBuYW1lIC0gSW5kZXggbmFtZSB0byBkcm9wLlxuICogQHByb3BlcnR5IHtzdHJpbmd9IHRhYmxlTmFtZSAtIE5hbWUgb2YgdGhlIHRhYmxlIHRoZSBpbmRleCBiZWxvbmdzIHRvLlxuICovXG4vKipcbiAqIERyb3BUYWJsZVNxbEFyZ3NUeXBlIHR5cGUuXG4gKiBAdHlwZWRlZiB7b2JqZWN0fSBEcm9wVGFibGVTcWxBcmdzVHlwZVxuICogQHByb3BlcnR5IHtib29sZWFufSBbY2FzY2FkZV0gLSBXaGV0aGVyIGRlcGVuZGVudCBvYmplY3RzIHNob3VsZCBiZSBkcm9wcGVkIHRvby5cbiAqIEBwcm9wZXJ0eSB7Ym9vbGVhbn0gW2lmRXhpc3RzXSAtIFNraXAgZHJvcHBpbmcgaWYgdGhlIHRhYmxlIGRvZXMgbm90IGV4aXN0LlxuICovXG4vKipcbiAqIERlbGV0ZVNxbEFyZ3NUeXBlIHR5cGUuXG4gKiBAdHlwZWRlZiB7b2JqZWN0fSBEZWxldGVTcWxBcmdzVHlwZVxuICogQHByb3BlcnR5IHtzdHJpbmd9IHRhYmxlTmFtZSAtIFRhYmxlIG5hbWUgdG8gZGVsZXRlIGZyb20uXG4gKiBAcHJvcGVydHkge3tba2V5OiBzdHJpbmddOiBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn19IGNvbmRpdGlvbnMgLSBDb25kaXRpb25zIHVzZWQgdG8gYnVpbGQgdGhlIGRlbGV0ZSBXSEVSRSBjbGF1c2UuXG4gKi9cbi8qKlxuICogSW5zZXJ0U3FsQXJnc1R5cGUgdHlwZS5cbiAqIEB0eXBlZGVmIHtvYmplY3R9IEluc2VydFNxbEFyZ3NUeXBlXG4gKiBAcHJvcGVydHkge3N0cmluZ1tdfSBbY29sdW1uc10gLSBDb2x1bW4gbmFtZXMgZm9yIGByb3dzYCBpbnNlcnRzLlxuICogQHByb3BlcnR5IHt7W2tleTogc3RyaW5nXTogUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59fSBbZGF0YV0gLSBDb2x1bW4vdmFsdWUgcGFpcnMgZm9yIGEgc2luZ2xlLXJvdyBpbnNlcnQuXG4gKiBAcHJvcGVydHkge2Jvb2xlYW59IFttdWx0aXBsZV0gLSBXaGV0aGVyIHRoaXMgaW5zZXJ0IHNob3VsZCBiZSB0cmVhdGVkIGFzIG11bHRpLXJvdy5cbiAqIEBwcm9wZXJ0eSB7c3RyaW5nW119IFtyZXR1cm5MYXN0SW5zZXJ0ZWRDb2x1bW5OYW1lc10gLSBDb2x1bW4gbmFtZXMgdG8gcmV0dXJuIGFmdGVyIGluc2VydC5cbiAqIEBwcm9wZXJ0eSB7QXJyYXk8QXJyYXk8UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+Pn0gW3Jvd3NdIC0gUm93IHZhbHVlcyBmb3IgYSBtdWx0aS1yb3cgaW5zZXJ0LlxuICogQHByb3BlcnR5IHtzdHJpbmd9IHRhYmxlTmFtZSAtIFRhYmxlIG5hbWUgdG8gaW5zZXJ0IGludG8uXG4gKi9cbi8qKlxuICogUXVlcnlSb3dUeXBlIHR5cGUuXG4gKiBAdHlwZWRlZiB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSBRdWVyeVJvd1R5cGVcbiAqIEB0eXBlZGVmIHtBcnJheTxRdWVyeVJvd1R5cGU+fSBRdWVyeVJlc3VsdFR5cGVcbiAqL1xuLyoqXG4gKiBUcmFuc2FjdGlvbkNhbGxiYWNrRnJhbWUgdHlwZS5cbiAqIEB0eXBlZGVmIHtvYmplY3R9IFRyYW5zYWN0aW9uQ2FsbGJhY2tGcmFtZVxuICogQHByb3BlcnR5IHtBcnJheTwoKSA9PiB2b2lkIHwgUHJvbWlzZTx2b2lkPj59IGFmdGVyQ29tbWl0Q2FsbGJhY2tzIC0gQ2FsbGJhY2tzIHRvIG1lcmdlIG9yIHJ1biBhZnRlciBjb21taXQuXG4gKiBAcHJvcGVydHkge0FycmF5PCgpID0+IHZvaWQgfCBQcm9taXNlPHZvaWQ+Pn0gYmVmb3JlQ29tbWl0Q2FsbGJhY2tzIC0gR3VhcmRzIHRvIHJ1biBiZWZvcmUgdGhpcyBmcmFtZSBjb21wbGV0ZXMuXG4gKi9cbi8qKlxuICogUmV0cnlhYmxlRGF0YWJhc2VFcnJvclJlc3VsdCB0eXBlLlxuICogQHR5cGVkZWYge29iamVjdH0gUmV0cnlhYmxlRGF0YWJhc2VFcnJvclJlc3VsdFxuICogQHByb3BlcnR5IHtib29sZWFufSByZXRyeSAtIFdoZXRoZXIgdGhlIGVycm9yIHNob3VsZCBiZSByZXRyaWVkLlxuICogQHByb3BlcnR5IHtib29sZWFufSByZWNvbm5lY3QgLSBXaGV0aGVyIHRvIHJlY29ubmVjdCBiZWZvcmUgcmV0cnlpbmcuXG4gKiBAcHJvcGVydHkge2Jvb2xlYW59IFtkZWFkbG9ja10gLSBXaGV0aGVyIHRoZSBlcnJvciBpcyBhIHRyYW5zYWN0aW9uIGRlYWRsb2NrL2xvY2std2FpdC10aW1lb3V0IHRoYXQgc2hvdWxkIHJldHJ5IHRoZSB3aG9sZSB0cmFuc2FjdGlvbi5cbiAqIEBwcm9wZXJ0eSB7XCJkZWFkbG9ja1wiIHwgXCJsb2NrLXdhaXQtdGltZW91dFwifSBbY29udGVudGlvbktpbmRdIC0gQ2xhc3NpZmllZCB0cmFuc2FjdGlvbiBjb250ZW50aW9uIGtpbmQuXG4gKiBAcHJvcGVydHkge251bWJlcn0gW21heFRyaWVzXSAtIE92ZXJyaWRlIHRoZSBtYXggcmV0cnkgYXR0ZW1wdHMuXG4gKiBAcHJvcGVydHkge251bWJlcn0gW3dhaXRNc10gLSBXYWl0IHRpbWUgYmVmb3JlIHJldHJ5aW5nIGluIG1pbGxpc2Vjb25kcy5cbiAqL1xuLyoqXG4gKiBRdWVyeU9wdGlvbnMgdHlwZS5cbiAqIEB0eXBlZGVmIHtvYmplY3R9IFF1ZXJ5T3B0aW9uc1xuICogQHByb3BlcnR5IHtzdHJpbmd9IFtsb2dOYW1lXSAtIFF1ZXJ5IGxvZyBzdWJqZWN0LlxuICogQHByb3BlcnR5IHtib29sZWFufSBbbG9nUXVlcnldIC0gV2hldGhlciB0byBsb2cgdGhlIHF1ZXJ5LlxuICogQHByb3BlcnR5IHtib29sZWFufSBbcHJvY2Vzc0xpc3RDb21tZW50XSAtIFdoZXRoZXIgdG8gYWRkIHByb2Nlc3MtbGlzdCBjb21tZW50cyB0byB0aGUgcXVlcnkuXG4gKiBAcHJvcGVydHkge251bWJlcn0gW3JlcXVlc3RUaW1lb3V0TXNdIC0gUGVyLXJlcXVlc3QgZHJpdmVyIHRpbWVvdXQgaW4gbWlsbGlzZWNvbmRzOyB6ZXJvIGRpc2FibGVzIHRoZSBkZWFkbGluZSBvbiBzdXBwb3J0aW5nIGRyaXZlcnMuXG4gKiBAcHJvcGVydHkge2Jvb2xlYW59IFtyZXRyeV0gLSBXaGV0aGVyIHJldHJ5YWJsZSBlcnJvcnMgbWF5IHJldHJ5IHRoZSBxdWVyeTsgZGVmYXVsdHMgdG8gdHJ1ZS5cbiAqIEBwcm9wZXJ0eSB7Ym9vbGVhbn0gW3Nlc3Npb25UaW1lWm9uZV0gLSBXaGV0aGVyIHRvIGVuc3VyZSB0aGUgY29uZmlndXJlZCBkYXRhYmFzZSBzZXNzaW9uIHRpbWUgem9uZSBiZWZvcmUgdGhlIHF1ZXJ5LlxuICogQHByb3BlcnR5IHtib29sZWFufSBbc3FsaXRlU2NyaXB0XSAtIEludGVybmFsIFNRTGl0ZSBmbGFnIHNlbGVjdGluZyBuYXRpdmUgbXVsdGktc3RhdGVtZW50IHNjcmlwdCBleGVjdXRpb24uXG4gKiBAcHJvcGVydHkge0Fib3J0U2lnbmFsfSBbc2lnbmFsXSAtIEFib3J0cyB0aGUgaW4tZmxpZ2h0IHF1ZXJ5IChkZXN0cm95aW5nIGl0cyBjb25uZWN0aW9uKSB3aGVuIGl0IGZpcmVzLlxuICogQHByb3BlcnR5IHtzdHJpbmd9IFtzb3VyY2VTdGFja10gLSBTdGFjayBjYXB0dXJlZCBhdCB0aGUgY2FsbGVyIGJvdW5kYXJ5LlxuICogQHByb3BlcnR5IHtzeW1ib2x9IFtvcGVyYXRpb25Pd25lcl0gLSBPcGFxdWUgb3duZXIgZm9yIGFuIG9wZXJhdGlvbi1sZWFzZWQgY29ubmVjdGlvbi5cbiAqL1xuXG4vKipcbiAqIERlYWRsb2NrUmV0cnlEaWFnbm9zdGljU25hcHNob3QgdHlwZS5cbiAqIEB0eXBlZGVmIHtvYmplY3R9IERlYWRsb2NrUmV0cnlEaWFnbm9zdGljU25hcHNob3RcbiAqIEBwcm9wZXJ0eSB7bnVtYmVyfSBhdHRlbXB0IC0gT25lLWJhc2VkIHRyYW5zYWN0aW9uIGF0dGVtcHQuXG4gKiBAcHJvcGVydHkge1wiZGVhZGxvY2tcIiB8IFwibG9jay13YWl0LXRpbWVvdXRcIn0gY29udGVudGlvbktpbmQgLSBDbGFzc2lmaWVkIGNvbnRlbnRpb24ga2luZC5cbiAqIEBwcm9wZXJ0eSB7c3RyaW5nfSBbZGF0YWJhc2VJZGVudGlmaWVyXSAtIFJlZGFjdGVkIGxvZ2ljYWwgZGF0YWJhc2UgcG9vbCBpZGVudGlmaWVyIG1hcmtlci5cbiAqIEBwcm9wZXJ0eSB7c3RyaW5nfSBbZGF0YWJhc2VJZGVudGlmaWVyRmluZ2VycHJpbnRdIC0gT3BhcXVlIGxvZ2ljYWwgZGF0YWJhc2UgcG9vbCBpZGVudGl0eS5cbiAqIEBwcm9wZXJ0eSB7c3RyaW5nfSBbZGF0YWJhc2VJZGVudGl0eUZpbmdlcnByaW50XSAtIE9wYXF1ZSBwaHlzaWNhbCBkYXRhYmFzZSBpZGVudGl0eS5cbiAqIEBwcm9wZXJ0eSB7c3RyaW5nfSBkcml2ZXJUeXBlIC0gRHJpdmVyIHR5cGUuXG4gKiBAcHJvcGVydHkge251bWJlcn0gbWF4QXR0ZW1wdHMgLSBDb25maWd1cmVkIHRyYW5zYWN0aW9uIGF0dGVtcHQgYnVkZ2V0LlxuICogQHByb3BlcnR5IHtzdHJpbmd9IFtvcGVyYXRpb25OYW1lXSAtIFJlZGFjdGVkIG9wZXJhdGlvbi1uYW1lIG1hcmtlci5cbiAqIEBwcm9wZXJ0eSB7c3RyaW5nfSBbb3BlcmF0aW9uTmFtZUZpbmdlcnByaW50XSAtIE9wYXF1ZSBvcGVyYXRpb24tbmFtZSBpZGVudGl0eS5cbiAqIEBwcm9wZXJ0eSB7c3RyaW5nfSBbc3FsRmluZ2VycHJpbnRdIC0gTm9ybWFsaXplZCBTUUwtc2hhcGUgZmluZ2VycHJpbnQuXG4gKiBAcHJvcGVydHkge3N0cmluZ30gW3NxbE9wZXJhdGlvbl0gLSBTUUwgdmVyYi5cbiAqIEBwcm9wZXJ0eSB7c3RyaW5nfSBzdGFnZSAtIEVycm9yLWV2ZW50IHN0YWdlLlxuICogQHByb3BlcnR5IHtudW1iZXJ9IHRyYW5zYWN0aW9uQXR0ZW1wdER1cmF0aW9uTXMgLSBEdXJhdGlvbiBvZiB0aGUgZmFpbGVkIG91dGVyIGF0dGVtcHQuXG4gKiBAcHJvcGVydHkge2Jvb2xlYW59IHdpbGxSZXRyeSAtIFdoZXRoZXIgYW5vdGhlciBvdXRlciB0cmFuc2FjdGlvbiBhdHRlbXB0IHdpbGwgcnVuLlxuICovXG5cbi8qKlxuICogVGVzdFByb2ZpbGVRdWVyeUF0dGVtcHQgdHlwZS5cbiAqIEB0eXBlZGVmIHtvYmplY3R9IFRlc3RQcm9maWxlUXVlcnlBdHRlbXB0XG4gKiBAcHJvcGVydHkge2ltcG9ydChcIi4uLy4uL3Rlc3RpbmcvdGVzdC1wcm9maWxlci5qc1wiKS5UZXN0UHJvZmlsZUFzeW5jQ29udGV4dH0gY29udGV4dCAtIENhcHR1cmVkIGFzeW5jIGF0dHJpYnV0aW9uLlxuICogQHByb3BlcnR5IHt7c3FsRmluZ2VycHJpbnQ6IHN0cmluZywgc3FsT3BlcmF0aW9uOiBzdHJpbmd9fSBkaWFnbm9zdGljIC0gUmVkYWN0ZWQgc3RhdGVtZW50IGRpYWdub3N0aWMuXG4gKiBAcHJvcGVydHkge251bWJlcn0gc3RhcnRlZEF0TXMgLSBQaHlzaWNhbCBhdHRlbXB0IHN0YXJ0IHRpbWUuXG4gKi9cblxuLyoqXG4gKiBBY3RpdmVRdWVyeURlYnVnU25hcHNob3QgdHlwZS5cbiAqIEB0eXBlZGVmIHtvYmplY3R9IEFjdGl2ZVF1ZXJ5RGVidWdTbmFwc2hvdFxuICogQHByb3BlcnR5IHtzdHJpbmdbXX0gYW5ub3RhdGlvbnMgLSBEYXRhYmFzZSBhbm5vdGF0aW9ucyBhY3RpdmUgd2hlbiB0aGUgcXVlcnkgc3RhcnRlZC5cbiAqIEBwcm9wZXJ0eSB7c3RyaW5nfSBsb2dOYW1lIC0gUXVlcnkgbG9nIG5hbWUuXG4gKiBAcHJvcGVydHkge251bWJlcn0gc3RhcnRlZEF0VW5peE1zIC0gUXVlcnkgc3RhcnQgdGltZXN0YW1wLlxuICogQHByb3BlcnR5IHtudW1iZXJ9IHJ1bm5pbmdNcyAtIFF1ZXJ5IHJ1bnRpbWUgaW4gbWlsbGlzZWNvbmRzLlxuICogQHByb3BlcnR5IHtzdHJpbmd9IHNxbFByZXZpZXcgLSBUcnVuY2F0ZWQgU1FMIHByZXZpZXcuXG4gKi9cblxuLyoqXG4gKiBEYXRhYmFzZUNvbm5lY3Rpb25EZWJ1Z1NuYXBzaG90IHR5cGUuXG4gKiBAdHlwZWRlZiB7b2JqZWN0fSBEYXRhYmFzZUNvbm5lY3Rpb25EZWJ1Z1NuYXBzaG90XG4gKiBAcHJvcGVydHkge0FjdGl2ZVF1ZXJ5RGVidWdTbmFwc2hvdCB8IG51bGx9IGFjdGl2ZVF1ZXJ5IC0gQ3VycmVudGx5IHJ1bm5pbmcgcXVlcnksIGlmIGFueS5cbiAqIEBwcm9wZXJ0eSB7bnVtYmVyIHwgdW5kZWZpbmVkfSBjaGVja2VkT3V0QXRVbml4TXMgLSBDaGVja291dCBzdGFydCB0aW1lc3RhbXAgZm9yIGFjdGl2ZSBjaGVja291dHMuXG4gKiBAcHJvcGVydHkge251bWJlciB8IHVuZGVmaW5lZH0gY2hlY2tvdXRBZ2VNcyAtIEFjdGl2ZSBjaGVja291dCBhZ2UgaW4gbWlsbGlzZWNvbmRzLlxuICogQHByb3BlcnR5IHtzdHJpbmcgfCB1bmRlZmluZWR9IGNoZWNrb3V0TmFtZSAtIEh1bWFuLXJlYWRhYmxlIGNoZWNrb3V0IG5hbWUuXG4gKiBAcHJvcGVydHkge3N0cmluZ30gZHJpdmVyQ2xhc3MgLSBEcml2ZXIgY2xhc3MgbmFtZS5cbiAqIEBwcm9wZXJ0eSB7bnVtYmVyIHwgdW5kZWZpbmVkfSBpZFNlcSAtIFBvb2wgY2hlY2tvdXQgSUQgc2VxdWVuY2UuXG4gKiBAcHJvcGVydHkge251bWJlcn0gb3BlblRyYW5zYWN0aW9ucyAtIE51bWJlciBvZiBvcGVuIHRyYW5zYWN0aW9uIGZyYW1lcy5cbiAqIEBwcm9wZXJ0eSB7bnVtYmVyfSBzY2hlbWFDYWNoZUVudHJpZXMgLSBOdW1iZXIgb2YgY2FjaGVkIHNjaGVtYSBtZXRhZGF0YSBlbnRyaWVzLlxuICovXG5cbi8qKlxuICogQWN0aXZlUXVlcnlTdGF0ZSB0eXBlLlxuICogQHR5cGVkZWYge29iamVjdH0gQWN0aXZlUXVlcnlTdGF0ZVxuICogQHByb3BlcnR5IHtzdHJpbmdbXX0gYW5ub3RhdGlvbnMgLSBEYXRhYmFzZSBhbm5vdGF0aW9ucyBhY3RpdmUgd2hlbiB0aGUgcXVlcnkgc3RhcnRlZC5cbiAqIEBwcm9wZXJ0eSB7c3RyaW5nfSBsb2dOYW1lIC0gUXVlcnkgbG9nIG5hbWUuXG4gKiBAcHJvcGVydHkge251bWJlcn0gc3RhcnRlZEF0VW5peE1zIC0gUXVlcnkgc3RhcnQgdGltZXN0YW1wLlxuICogQHByb3BlcnR5IHtzdHJpbmd9IHNxbFByZXZpZXcgLSBUcnVuY2F0ZWQgU1FMIHByZXZpZXcuXG4gKi9cblxuLyoqXG4gKiBVcGRhdGVTcWxBcmdzVHlwZSB0eXBlLlxuICogQHR5cGVkZWYge29iamVjdH1VcGRhdGVTcWxBcmdzVHlwZVxuICogQHByb3BlcnR5IHtvYmplY3R9IGNvbmRpdGlvbnMgLSBDb25kaXRpb25zIHVzZWQgdG8gYnVpbGQgdGhlIHVwZGF0ZSBXSEVSRSBjbGF1c2UuXG4gKiBAcHJvcGVydHkge29iamVjdH0gZGF0YSAtIENvbHVtbi92YWx1ZSBwYWlycyB0byB1cGRhdGUuXG4gKiBAcHJvcGVydHkge3N0cmluZ30gdGFibGVOYW1lIC0gVGFibGUgbmFtZSB0byB1cGRhdGUuXG4gKi9cbi8qKlxuICogVXBzZXJ0U3FsQXJnc1R5cGUgdHlwZS5cbiAqIEB0eXBlZGVmIHtvYmplY3R9VXBzZXJ0U3FsQXJnc1R5cGVcbiAqIEBwcm9wZXJ0eSB7c3RyaW5nW119IGNvbmZsaWN0Q29sdW1ucyAtIENvbHVtbnMgdGhhdCBkZWZpbmUgYSBjb25mbGljdC5cbiAqIEBwcm9wZXJ0eSB7b2JqZWN0fSBkYXRhIC0gQ29sdW1uL3ZhbHVlIHBhaXJzIHRvIGluc2VydC5cbiAqIEBwcm9wZXJ0eSB7c3RyaW5nfSB0YWJsZU5hbWUgLSBUYWJsZSBuYW1lIHRvIHVwc2VydCBpbnRvLlxuICogQHByb3BlcnR5IHtzdHJpbmdbXX0gdXBkYXRlQ29sdW1ucyAtIENvbHVtbnMgdG8gdXBkYXRlIG9uIGNvbmZsaWN0LlxuICovXG5cbi8qKlxuICogU3FsVG9rZW5SZXN1bHQgdHlwZS5cbiAqIEB0eXBlZGVmIHtvYmplY3R9IFNxbFRva2VuUmVzdWx0XG4gKiBAcHJvcGVydHkge2Jvb2xlYW59IGluY29tcGxldGUgLSBXaGV0aGVyIHRoZSBzY2FuIGhpdCBpdHMgYm91bmQgYmVmb3JlIGZpbmlzaGluZyB0cml2aWEvdG9rZW4gcGFyc2luZy5cbiAqIEBwcm9wZXJ0eSB7c3RyaW5nIHwgdW5kZWZpbmVkfSB0b2tlbiAtIExvd2VyY2FzZWQgdG9rZW4gd2hlbiBwYXJzaW5nIGNvbXBsZXRlZDsgdW5kZWZpbmVkIHdoZW4gbm8gdG9rZW4gd2FzIGZvdW5kLlxuICogQHByb3BlcnR5IHtudW1iZXJ9IGluZGV4IC0gSW5kZXggaW1tZWRpYXRlbHkgYWZ0ZXIgdGhlIHBhcnNlZCB0b2tlbiBvciB0cml2aWEuXG4gKi9cblxuaW1wb3J0IEJhY2t0cmFjZUNsZWFuZXIgZnJvbSBcIi4uLy4uL3V0aWxzL2JhY2t0cmFjZS1jbGVhbmVyLmpzXCJcbmltcG9ydCBCb3VuZGVkVGFza1J1bm5lciBmcm9tIFwiLi4vLi4vdXRpbHMvYm91bmRlZC10YXNrLXJ1bm5lci5qc1wiXG5pbXBvcnQgeyBnZXREYXRhYmFzZUFubm90YXRpb25zIH0gZnJvbSBcIi4uL2Fubm90YXRpb25zLmpzXCJcbmltcG9ydCB7IGZvcm1hdERhdGVGb3JEYXRhYmFzZSB9IGZyb20gXCIuLi9kYXRldGltZS1zdG9yYWdlLmpzXCJcbmltcG9ydCBpc0RhdGUgZnJvbSBcIi4uLy4uL3V0aWxzL2lzLWRhdGUuanNcIlxuaW1wb3J0IHtERUZBVUxUX0FEVklTT1JZX0xPQ0tfQUNRVUlSRV9USU1FT1VUX01TfSBmcm9tIFwiLi4vYWR2aXNvcnktbG9jay1ib3VuZC5qc1wiXG5pbXBvcnQge2Fkdmlzb3J5TG9ja1RlbGVtZXRyeVRocmVzaG9sZHMsIGVtaXRBZHZpc29yeUxvY2tUZWxlbWV0cnlSZXBvcnR9IGZyb20gXCIuLi9hZHZpc29yeS1sb2NrLXRlbGVtZXRyeS5qc1wiXG5pbXBvcnQgTG9nZ2VyIGZyb20gXCIuLi8uLi9sb2dnZXIuanNcIlxuaW1wb3J0IFF1ZXJ5IGZyb20gXCIuLi9xdWVyeS9pbmRleC5qc1wiXG5pbXBvcnQgUXVlcnlBYm9ydGVkRXJyb3IgZnJvbSBcIi4uL3F1ZXJ5LWFib3J0ZWQtZXJyb3IuanNcIlxuaW1wb3J0IEhhbmRsZXIgZnJvbSBcIi4uL2hhbmRsZXIuanNcIlxuaW1wb3J0IHsgdXRmOEJ5dGVMZW5ndGggfSBmcm9tIFwiLi4vLi4vdXRpbHMvdXRmOC1ieXRlLWxlbmd0aC5qc1wiXG5pbXBvcnQgTXV0ZXggZnJvbSBcImVwaWMtbG9ja3MvYnVpbGQvbXV0ZXguanNcIlxuaW1wb3J0IFVVSUQgZnJvbSBcInB1cmUtdXVpZFwiXG5pbXBvcnQgVGFibGVEYXRhIGZyb20gXCIuLi90YWJsZS1kYXRhL2luZGV4LmpzXCJcbmltcG9ydCBUYWJsZUNvbHVtbiBmcm9tIFwiLi4vdGFibGUtZGF0YS90YWJsZS1jb2x1bW4uanNcIlxuaW1wb3J0IFRhYmxlRm9yZWlnbktleSBmcm9tIFwiLi4vdGFibGUtZGF0YS90YWJsZS1mb3JlaWduLWtleS5qc1wiXG5pbXBvcnQgd2FpdCBmcm9tIFwiYXdhaXRlcnkvYnVpbGQvd2FpdC5qc1wiXG5pbXBvcnQgeyBlbnN1cmVFcnJvciwgb3B0aW9uYWxQb3NpdGl2ZUludGVnZXIgfSBmcm9tIFwidHlwYW5pY1wiXG5pbXBvcnQge2Nvb3JkaW5hdGVTaGFyZWRUcmFuc2FjdGlvbkNvbm5lY3Rpb24sIHJ1bldpdGhvdXRTaGFyZWRUcmFuc2FjdGlvbkNvb3JkaW5hdG9yT3duZXJ9IGZyb20gXCIuLi8uLi90ZXN0aW5nL3NoYXJlZC10cmFuc2FjdGlvbi1jb25uZWN0aW9uLWNvb3JkaW5hdG9yLmpzXCJcbmltcG9ydCB7IGN1cnJlbnRUZXN0UHJvZmlsZUNvbnRleHQgfSBmcm9tIFwiLi4vLi4vdGVzdGluZy90ZXN0LXByb2ZpbGUtY29udGV4dC5qc1wiXG5pbXBvcnQgc2hhMjU2SGV4IGZyb20gXCIuLi8uLi91dGlscy9zaGEyNTYtaGV4LmpzXCJcblxuLyoqIE1heGltdW0gY2hhcmFjdGVycyBpbnNwZWN0ZWQgd2hlbiBidWlsZGluZyB0aGUgZGVidWcgU1FMIHByZXZpZXcuICovXG5jb25zdCBTUUxfUFJFVklFV19TQ0FOX0xJTUlUID0gNDA5NlxuLyoqIE1heGltdW0gY2hhcmFjdGVycyBpbnNwZWN0ZWQgd2hlbiBkZWNpZGluZyB3aGV0aGVyIGEgc3RhdGVtZW50IGludmFsaWRhdGVzIHNjaGVtYSBtZXRhZGF0YS4gKi9cbmNvbnN0IFNDSEVNQV9JTlZBTElEQVRJT05fU0NBTl9MSU1JVCA9IDgxOTJcbi8qKiBNYXhpbXVtIGNoZWNrb3V0LW5hbWUgY2hhcmFjdGVycyBpbnNwZWN0ZWQgYnkgcmV0cnkgZGlhZ25vc3RpY3MuICovXG5jb25zdCBPUEVSQVRJT05fTkFNRV9TQ0FOX0xJTUlUID0gMTAyNFxuY29uc3QgUkVEQUNURURfRElBR05PU1RJQ19MQUJFTCA9IFwiW1JFREFDVEVEXVwiXG4vKiogRmlyc3QgYmFja29mZiBiZXR3ZWVuIHJldHJpZXMgb2YgYSBzY2hlbWEtbWV0YWRhdGEgcmVhZCBibG9ja2VkIGJ5IGNvbmN1cnJlbnQgb25saW5lIERETC4gKi9cbmNvbnN0IFNDSEVNQV9NRVRBREFUQV9SRVRSWV9JTklUSUFMX0RFTEFZX01TID0gMjUwXG4vKiogTGFyZ2VzdCBiYWNrb2ZmIGJldHdlZW4gcmV0cmllcyBvZiBhIHNjaGVtYS1tZXRhZGF0YSByZWFkIGJsb2NrZWQgYnkgY29uY3VycmVudCBvbmxpbmUgRERMLiAqL1xuY29uc3QgU0NIRU1BX01FVEFEQVRBX1JFVFJZX01BWF9ERUxBWV9NUyA9IDIwMDBcbi8qKiBEZWZhdWx0IGJvdW5kZWQgZGVhZGxpbmUgZm9yIG91dGxhc3RpbmcgYSBjb25jdXJyZW50IG9ubGluZS1EREwgbWV0YWRhdGEgc2tpcC4gKi9cbmNvbnN0IFNDSEVNQV9NRVRBREFUQV9SRVRSWV9ERUFETElORV9NUyA9IDYwMDAwXG5cbi8qKlxuICogQnVpbGRzIGEgbm9uLXJldmVyc2libGUsIHN0YWJsZSBTUUwgZmluZ2VycHJpbnQgd2l0aG91dCByZXRhaW5pbmcgU1FMIHRleHQuIExpdGVyYWwgc3BlbGxpbmcgaXNcbiAqIG5vcm1hbGl6ZWQgZmlyc3Qgc28gdGhlIHNhbWUgc3RhdGVtZW50IHNoYXBlIHByb2R1Y2VzIHRoZSBzYW1lIGZpbmdlcnByaW50IGFjcm9zcyB2YWx1ZXMuXG4gKiBAcGFyYW0ge3N0cmluZ30gc3FsIC0gU1FMIHRvIGZpbmdlcnByaW50LlxuICogQHJldHVybnMge3tzcWxGaW5nZXJwcmludDogc3RyaW5nLCBzcWxPcGVyYXRpb246IHN0cmluZ319IC0gQm91bmRlZCBxdWVyeSBkaWFnbm9zdGljLlxuICovXG5mdW5jdGlvbiBzcWxEaWFnbm9zdGljKHNxbCkge1xuICBsZXQgZmluZ2VycHJpbnRJbnB1dCA9IFwiXCJcblxuICBmb3IgKGxldCBpbmRleCA9IDA7IGluZGV4IDwgc3FsLmxlbmd0aDspIHtcbiAgICBjb25zdCBjaGFyYWN0ZXIgPSBzcWxbaW5kZXhdXG4gICAgY29uc3QgbmV4dENoYXJhY3RlciA9IHNxbFtpbmRleCArIDFdXG5cbiAgICBpZiAoY2hhcmFjdGVyID09IFwiJ1wiIHx8IGNoYXJhY3RlciA9PSAnXCInKSB7XG4gICAgICBjb25zdCBxdW90ZSA9IGNoYXJhY3RlclxuICAgICAgZmluZ2VycHJpbnRJbnB1dCArPSBcIj9cIlxuICAgICAgaW5kZXgrK1xuXG4gICAgICB3aGlsZSAoaW5kZXggPCBzcWwubGVuZ3RoKSB7XG4gICAgICAgIGlmIChzcWxbaW5kZXhdID09IFwiXFxcXFwiKSB7XG4gICAgICAgICAgaW5kZXggKz0gMlxuICAgICAgICB9IGVsc2UgaWYgKHNxbFtpbmRleF0gPT0gcXVvdGUgJiYgc3FsW2luZGV4ICsgMV0gPT0gcXVvdGUpIHtcbiAgICAgICAgICBpbmRleCArPSAyXG4gICAgICAgIH0gZWxzZSBpZiAoc3FsW2luZGV4XSA9PSBxdW90ZSkge1xuICAgICAgICAgIGluZGV4KytcbiAgICAgICAgICBicmVha1xuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgIGluZGV4KytcbiAgICAgICAgfVxuICAgICAgfVxuICAgIH0gZWxzZSBpZiAoY2hhcmFjdGVyID09IFwiL1wiICYmIG5leHRDaGFyYWN0ZXIgPT0gXCIqXCIpIHtcbiAgICAgIGNvbnN0IGNvbW1lbnRFbmQgPSBzcWwuaW5kZXhPZihcIiovXCIsIGluZGV4ICsgMilcbiAgICAgIGZpbmdlcnByaW50SW5wdXQgKz0gXCIgXCJcbiAgICAgIGluZGV4ID0gY29tbWVudEVuZCA9PSAtMSA/IHNxbC5sZW5ndGggOiBjb21tZW50RW5kICsgMlxuICAgIH0gZWxzZSBpZiAoKGNoYXJhY3RlciA9PSBcIi1cIiAmJiBuZXh0Q2hhcmFjdGVyID09IFwiLVwiKSB8fCBjaGFyYWN0ZXIgPT0gXCIjXCIpIHtcbiAgICAgIGNvbnN0IGxpbmVFbmQgPSBzcWwuaW5kZXhPZihcIlxcblwiLCBpbmRleCArIDEpXG4gICAgICBmaW5nZXJwcmludElucHV0ICs9IFwiIFwiXG4gICAgICBpbmRleCA9IGxpbmVFbmQgPT0gLTEgPyBzcWwubGVuZ3RoIDogbGluZUVuZCArIDFcbiAgICB9IGVsc2Uge1xuICAgICAgZmluZ2VycHJpbnRJbnB1dCArPSBjaGFyYWN0ZXJcbiAgICAgIGluZGV4KytcbiAgICB9XG4gIH1cblxuICBjb25zdCBub3JtYWxpemVkID0gZmluZ2VycHJpbnRJbnB1dFxuICAgIC5yZXBsYWNlKC9cXGIoPzoweFswLTlhLWZdK3xcXGQrKD86XFwuXFxkKyk/KD86ZVsrLV0/XFxkKyk/KVxcYi9naSwgXCI/XCIpXG4gICAgLnJlcGxhY2UoL1xccysvZywgXCIgXCIpXG4gICAgLnRyaW0oKVxuICAgIC50b0xvd2VyQ2FzZSgpXG4gIGxldCBoYXNoID0gMHhjYmYyOWNlNDg0MjIyMzI1blxuXG4gIGZvciAobGV0IGluZGV4ID0gMDsgaW5kZXggPCBub3JtYWxpemVkLmxlbmd0aDsgaW5kZXgrKykge1xuICAgIGhhc2ggXj0gQmlnSW50KG5vcm1hbGl6ZWQuY2hhckNvZGVBdChpbmRleCkpXG4gICAgaGFzaCA9IEJpZ0ludC5hc1VpbnROKDY0LCBoYXNoICogMHgxMDAwMDAwMDFiM24pXG4gIH1cblxuICBjb25zdCBvcGVyYXRpb25NYXRjaCA9IC9eKFthLXpdKykvLmV4ZWMobm9ybWFsaXplZClcblxuICByZXR1cm4ge1xuICAgIHNxbEZpbmdlcnByaW50OiBgZm52MWE2NDoke2hhc2gudG9TdHJpbmcoMTYpLnBhZFN0YXJ0KDE2LCBcIjBcIil9YCxcbiAgICBzcWxPcGVyYXRpb246IG9wZXJhdGlvbk1hdGNoID8gb3BlcmF0aW9uTWF0Y2hbMV0udG9VcHBlckNhc2UoKSA6IFwiVU5LTk9XTlwiXG4gIH1cbn1cblxuLyoqXG4gKiBNYXJrcyBhIGNhbGxiYWNrIGZhaWx1cmUgdGhhdCBoYXBwZW5lZCBhZnRlciB0aGUgb3duaW5nIHRyYW5zYWN0aW9uIHdhcyBkdXJhYmx5IGNvbW1pdHRlZC5cbiAqIFRoZSBwdWJsaWMgdHJhbnNhY3Rpb24gYm91bmRhcnkgdW53cmFwcyBpdCBiZWZvcmUgZGVhZGxvY2sgY2xhc3NpZmljYXRpb24uXG4gKi9cbmNsYXNzIFZlbG9jaW91c0RhdGFiYXNlQWZ0ZXJDb21taXRDYWxsYmFja0Vycm9yIGV4dGVuZHMgRXJyb3Ige1xuICAvKipcbiAgICogUnVucyBjb25zdHJ1Y3Rvci5cbiAgICogQHBhcmFtIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gY2FsbGJhY2tFcnJvciAtIE9yaWdpbmFsIGNhbGxiYWNrIGZhaWx1cmUuXG4gICAqL1xuICBjb25zdHJ1Y3RvcihjYWxsYmFja0Vycm9yKSB7XG4gICAgc3VwZXIoXCJEYXRhYmFzZSBhZnRlckNvbW1pdCBjYWxsYmFjayBmYWlsZWRcIilcbiAgICB0aGlzLmNhbGxiYWNrRXJyb3IgPSBjYWxsYmFja0Vycm9yXG4gIH1cbn1cblxuLyoqXG4gKiBSdW5zIG5vdyBtcy5cbiAqIEByZXR1cm5zIHtudW1iZXJ9IC0gQ3VycmVudCBoaWdoLXJlc29sdXRpb24taXNoIHRpbWVzdGFtcCBpbiBtaWxsaXNlY29uZHMuXG4gKi9cbmZ1bmN0aW9uIG5vd01zKCkge1xuICBpZiAoZ2xvYmFsVGhpcy5wZXJmb3JtYW5jZSAmJiB0eXBlb2YgZ2xvYmFsVGhpcy5wZXJmb3JtYW5jZS5ub3cgPT0gXCJmdW5jdGlvblwiKSB7XG4gICAgcmV0dXJuIGdsb2JhbFRoaXMucGVyZm9ybWFuY2Uubm93KClcbiAgfVxuXG4gIHJldHVybiBEYXRlLm5vdygpXG59XG5cbi8qKlxuICogUnVucyBmb3JtYXQgZWxhcHNlZCBtcy5cbiAqIEBwYXJhbSB7bnVtYmVyfSBlbGFwc2VkTXMgLSBFbGFwc2VkIG1pbGxpc2Vjb25kcy5cbiAqIEByZXR1cm5zIHtzdHJpbmd9IC0gRm9ybWF0dGVkIGVsYXBzZWQgbWlsbGlzZWNvbmRzLlxuICovXG5mdW5jdGlvbiBmb3JtYXRFbGFwc2VkTXMoZWxhcHNlZE1zKSB7XG4gIHJldHVybiBgJHtNYXRoLm1heChlbGFwc2VkTXMsIDApLnRvRml4ZWQoMSl9bXNgXG59XG5cbmV4cG9ydCBkZWZhdWx0IGNsYXNzIFZlbG9jaW91c0RhdGFiYXNlRHJpdmVyc0Jhc2Uge1xuICAvKipcbiAgICogUHJvY2Vzcy13aWRlIHN0YXRlIGZvciB0aGUgKipwcm9jZXNzLWxvY2FsIGFkdmlzb3J5LWxvY2sgcHJlLWZpbHRlclxuICAgKiB0aWVyKiogc2hhcmVkIGJ5IGV2ZXJ5IGRyaXZlciAoU1FMaXRlLCBNeVNRTC9NYXJpYURCLCBQb3N0Z3JlU1FMLFxuICAgKiBNU1NRTCkuIEl0IHNlcmlhbGl6ZXMgY29uY3VycmVudCBhY3F1aXNpdGlvbnMgb2YgdGhlIHNhbWUgbG9jayBuYW1lXG4gICAqIGluc2lkZSB0aGlzIHByb2Nlc3MgdGhyb3VnaCBhIEZJRk8gd2FpdGVyIHF1ZXVlIGJlZm9yZSBhbnkgY2FsbGVyXG4gICAqIGNvbnRhY3RzIHRoZSBkcml2ZXItbmF0aXZlIHRpZXIsIHNvIGEgY29udGVuZGVkIHNhbWUtcHJvY2VzcyB3YWl0ZXJcbiAgICogbmV2ZXIgcGFya3MgYSBwb29sZWQgZGF0YWJhc2UgY29ubmVjdGlvbiBpbiBhIGRyaXZlciBsb2NrIHN0YXRlXG4gICAqIChNYXJpYURCIGBVc2VyIGxvY2tgLCBgc3BfZ2V0YXBwbG9ja2Agc2Vzc2lvbiBob2xkLCAuLi4pLlxuICAgKlxuICAgKiBUaGlzIHRpZXIgaXMgYSBwcmUtZmlsdGVyLCAqKm5ldmVyIHRoZSBhdXRob3JpdHkqKjogYSBncmFudCBoZXJlIG9ubHlcbiAgICogbWVhbnMgXCJ5b3UgYXJlIG5leHQgaW4gdGhpcyBwcm9jZXNzLlwiIENyb3NzLXByb2Nlc3MvY3Jvc3MtaG9zdFxuICAgKiBleGNsdXNpb24gaXMgY29uZmlybWVkIGJ5IHRoZSBkcml2ZXItbmF0aXZlIHRpZXIgKG9yLCBvbmNlIHRoZVxuICAgKiBTVEMtMjEwIGJhY2tlbmQgY2hhaW4gbGFuZHMsIHRoZSBjb25maWd1cmVkIGNyb3NzLWhvc3QgYmFja2VuZClcbiAgICogYmVmb3JlIHRoZSBhY3F1aXNpdGlvbiBzdWNjZWVkcy5cbiAgICpcbiAgICogYG93bmVyc0J5TmFtZWAgbWFwcyBlYWNoIGhlbGQgbG9jayBuYW1lIHRvIHRoZSBkcml2ZXIgaW5zdGFuY2UgdGhhdFxuICAgKiBhY3F1aXJlZCBpdCBzbyBgcmVsZWFzZUFkdmlzb3J5TG9ja2AgY2FuIHJlamVjdCByZWxlYXNlcyBmcm9tIGRyaXZlcnNcbiAgICogdGhhdCBkbyBub3Qgb3duIHRoZSBsb2NrLlxuICAgKiBAdHlwZSB7e293bmVyc0J5TmFtZTogTWFwPHN0cmluZywgVmVsb2Npb3VzRGF0YWJhc2VEcml2ZXJzQmFzZT4sIHdhaXRlcnNCeU5hbWU6IE1hcDxzdHJpbmcsIEFycmF5PCgpID0+IHZvaWQ+Pn19XG4gICAqL1xuICBzdGF0aWMgX2Fkdmlzb3J5TG9ja1N0YXRlID0ge1xuICAgIG93bmVyc0J5TmFtZTogbmV3IE1hcCgpLFxuICAgIHdhaXRlcnNCeU5hbWU6IG5ldyBNYXAoKVxuICB9XG5cbiAgLyoqXG4gICAqIElkIHNlcS5cbiAgICogQHR5cGUge251bWJlciB8IHVuZGVmaW5lZH0gKi9cbiAgaWRTZXEgPSB1bmRlZmluZWRcbiAgLyoqXG4gICAqIE5hcnJvd3MgdGhlIHJ1bnRpbWUgdmFsdWUgdG8gdGhlIGRvY3VtZW50ZWQgdHlwZS5cbiAgICogQHR5cGUge1RyYW5zYWN0aW9uQ2FsbGJhY2tGcmFtZVtdfSAqL1xuICBfdHJhbnNhY3Rpb25DYWxsYmFja0ZyYW1lc1xuICAvKiogQHR5cGUge1Byb21pc2U8dm9pZD59ICovXG4gIF90cmFuc2FjdGlvbkNvbXBsZXRpb25Qcm9taXNlXG4gIC8qKiBAdHlwZSB7KCgpID0+IHZvaWQpIHwgdW5kZWZpbmVkfSAqL1xuICBfcmVzb2x2ZVRyYW5zYWN0aW9uQ29tcGxldGlvblxuICAvKipcbiAgICogTmFycm93cyB0aGUgcnVudGltZSB2YWx1ZSB0byB0aGUgZG9jdW1lbnRlZCB0eXBlLlxuICAgKiBAdHlwZSB7TWFwPHN0cmluZywgUHJvbWlzZTxSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj4+fSAqL1xuICBfc2NoZW1hQ2FjaGVcbiAgLyoqXG4gICAqIE5hcnJvd3MgdGhlIHJ1bnRpbWUgdmFsdWUgdG8gdGhlIGRvY3VtZW50ZWQgdHlwZS5cbiAgICogQHR5cGUgeygoKSA9PiB2b2lkKSB8IHVuZGVmaW5lZH0gKi9cbiAgX3NjaGVtYUNhY2hlSW52YWxpZGF0b3JcbiAgLyoqXG4gICAqIE5hcnJvd3MgdGhlIHJ1bnRpbWUgdmFsdWUgdG8gdGhlIGRvY3VtZW50ZWQgdHlwZS5cbiAgICogQHR5cGUge3N0cmluZyB8IHVuZGVmaW5lZH0gKi9cbiAgX2Nvbm5lY3Rpb25DaGVja291dE5hbWVcbiAgLyoqIEB0eXBlIHtzdHJpbmcgfCB1bmRlZmluZWR9ICovXG4gIF9kYXRhYmFzZUlkZW50aWZpZXJcbiAgLyoqIEB0eXBlIHtzdHJpbmcgfCB1bmRlZmluZWR9ICovXG4gIF9kYXRhYmFzZUlkZW50aXR5RmluZ2VycHJpbnRcbiAgLyoqXG4gICAqIEFjdGl2ZSBxdWVyeS5cbiAgICogQHR5cGUge0FjdGl2ZVF1ZXJ5U3RhdGUgfCBudWxsfSAqL1xuICBfYWN0aXZlUXVlcnkgPSBudWxsXG4gIC8qKiBAdHlwZSB7V2Vha01hcDxFcnJvciwge3NxbEZpbmdlcnByaW50OiBzdHJpbmcsIHNxbE9wZXJhdGlvbjogc3RyaW5nfT59ICovXG4gIF9mYWlsZWRRdWVyeURpYWdub3N0aWNzID0gbmV3IFdlYWtNYXAoKVxuICAvKiogQHR5cGUge01hcDxzdHJpbmcsIG51bWJlcj59ICovXG4gIF9oZWxkQWR2aXNvcnlMb2NrcyA9IG5ldyBNYXAoKVxuICAvKipcbiAgICogV2hlbiBlYWNoIHRyYWNrZWQgYWR2aXNvcnkgbG9jayB3YXMgZmlyc3QgYWNxdWlyZWQsIHNvIHRoZSBmaW5hbCByZWxlYXNlIGNhblxuICAgKiByZXBvcnQgYSBob2xkIHRoYXQgb3V0bGl2ZWQgYGFkdmlzb3J5TG9ja1RlbGVtZXRyeS5zbG93SG9sZE1zYC5cbiAgICogQHR5cGUge01hcDxzdHJpbmcsIG51bWJlcj59XG4gICAqL1xuICBfYWR2aXNvcnlMb2NrQWNxdWlyZWRBdEJ5TmFtZSA9IG5ldyBNYXAoKVxuICAvKipcbiAgICogU3RhYmxlIHBlci1jb25uZWN0aW9uIGhvbGRlciBpZGVudGl0eSB1c2VkIGJ5IGFkdmlzb3J5LWxvY2sgdGVsZW1ldHJ5IHdoZW5cbiAgICogdGhlIHRpZXIgY2FuIG9ubHkgbmFtZSBsb2NhbCBob2xkZXJzLlxuICAgKiBAdHlwZSB7c3RyaW5nIHwgdW5kZWZpbmVkfVxuICAgKi9cbiAgX2Fkdmlzb3J5TG9ja0hvbGRlcklkID0gdW5kZWZpbmVkXG4gIC8qKlxuICAgKiBFeGNsdXNpdmUgb3BlcmF0aW9uIGxlYXNlIGluc3RhbGxlZCBieSBhIHNpbmdsZS1tdWx0aS11c2UgcG9vbC5cbiAgICogQHR5cGUge2ltcG9ydChcIi4uL29wZXJhdGlvbi1sZWFzZS5qc1wiKS5kZWZhdWx0IHwgdW5kZWZpbmVkfVxuICAgKi9cbiAgX29wZXJhdGlvbkxlYXNlID0gdW5kZWZpbmVkXG5cbiAgLyoqXG4gICAqIFJ1bnMgY29uc3RydWN0b3IuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vLi4vY29uZmlndXJhdGlvbi10eXBlcy5qc1wiKS5EYXRhYmFzZUNvbmZpZ3VyYXRpb25UeXBlfSBjb25maWcgLSBDb25maWd1cmF0aW9uIG9iamVjdC5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi8uLi9jb25maWd1cmF0aW9uLmpzXCIpLmRlZmF1bHR9IGNvbmZpZ3VyYXRpb24gLSBDb25maWd1cmF0aW9uIGluc3RhbmNlLlxuICAgKi9cbiAgY29uc3RydWN0b3IoY29uZmlnLCBjb25maWd1cmF0aW9uKSB7XG4gICAgdGhpcy5fYXJncyA9IGNvbmZpZ1xuICAgIHRoaXMuY29uZmlndXJhdGlvbiA9IGNvbmZpZ3VyYXRpb25cbiAgICB0aGlzLm11dGV4ID0gbmV3IE11dGV4KCkgLy8gQ2FuIGJlIHVzZWQgdG8gbG9jayB0aGlzIGluc3RhbmNlIGZvciBleGNsdXNpdmUgdXNlXG4gICAgdGhpcy5sb2dnZXIgPSBuZXcgTG9nZ2VyKHRoaXMpXG4gICAgdGhpcy5fdHJhbnNhY3Rpb25DYWxsYmFja0ZyYW1lcyA9IFtdXG4gICAgdGhpcy5fdHJhbnNhY3Rpb25zQ291bnQgPSAwXG4gICAgdGhpcy5fdHJhbnNhY3Rpb25Db21wbGV0aW9uUHJvbWlzZSA9IFByb21pc2UucmVzb2x2ZSgpXG4gICAgdGhpcy5fcmVzb2x2ZVRyYW5zYWN0aW9uQ29tcGxldGlvbiA9IHVuZGVmaW5lZFxuICAgIHRoaXMuX3RyYW5zYWN0aW9uc0FjdGlvbnNNdXRleCA9IG5ldyBNdXRleCgpXG4gICAgdGhpcy5fcGh5c2ljYWxDb25uZWN0aW9uTXV0ZXggPSBuZXcgTXV0ZXgoKVxuICAgIHRoaXMuX3NjaGVtYUNhY2hlID0gbmV3IE1hcCgpXG4gIH1cblxuICAvKipcbiAgICogU2VyaWFsaXplcyBhY2Nlc3MgdG8gb25lIHBoeXNpY2FsIGRhdGFiYXNlIHNlc3Npb24uXG4gICAqIEB0ZW1wbGF0ZSBUXG4gICAqIEBwYXJhbSB7KCkgPT4gUHJvbWlzZTxUPn0gY2FsbGJhY2sgLSBQaHlzaWNhbCBkcml2ZXIgb3BlcmF0aW9uLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxUPn0gLSBPcGVyYXRpb24gcmVzdWx0LlxuICAgKi9cbiAgYXN5bmMgX3J1blBoeXNpY2FsQ29ubmVjdGlvblJlcXVlc3QoY2FsbGJhY2spIHtcbiAgICByZXR1cm4gYXdhaXQgdGhpcy5fcGh5c2ljYWxDb25uZWN0aW9uTXV0ZXguc3luYyhhc3luYyAoKSA9PiB7XG4gICAgICByZXR1cm4gYXdhaXQgcnVuV2l0aG91dFNoYXJlZFRyYW5zYWN0aW9uQ29vcmRpbmF0b3JPd25lcih0aGlzLCBjYWxsYmFjaylcbiAgICB9KVxuICB9XG5cbiAgLyoqXG4gICAqIENsZWFucyBkcml2ZXItc3BlY2lmaWMgc2Vzc2lvbiBzdGF0ZSBiZWZvcmUgdGhpcyBsb2dpY2FsIGNvbm5lY3Rpb24gaXMgcmV1c2FibGUuXG4gICAqIERyaXZlcnMgd2hvc2UgcGh5c2ljYWwgc2Vzc2lvbnMgY2Fubm90IGJlIHNhZmVseSByZXNldCBzaG91bGQgZGlzcG9zZSB0aGVtIGhlcmUuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIHdoZW4gdGhlIG5leHQgY2hlY2tvdXQgY2Fubm90IG9ic2VydmUgcHJpb3Igc2Vzc2lvbiBzdGF0ZS5cbiAgICovXG4gIGFzeW5jIGNsZWFudXBTZXNzaW9uU3RhdGVBZnRlckNoZWNrb3V0KCkge31cblxuICAvKipcbiAgICogUnVucyBhZGQgZm9yZWlnbiBrZXkuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSB0YWJsZU5hbWUgLSBUYWJsZSBuYW1lLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gY29sdW1uTmFtZSAtIENvbHVtbiBuYW1lLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gcmVmZXJlbmNlZFRhYmxlTmFtZSAtIFJlZmVyZW5jZWQgdGFibGUgbmFtZS5cbiAgICogQHBhcmFtIHtzdHJpbmd9IHJlZmVyZW5jZWRDb2x1bW5OYW1lIC0gUmVmZXJlbmNlZCBjb2x1bW4gbmFtZS5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBPcHRpb25zIG9iamVjdC5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgd2hlbiBjb21wbGV0ZS5cbiAgICovXG4gIGFzeW5jIGFkZEZvcmVpZ25LZXkodGFibGVOYW1lLCBjb2x1bW5OYW1lLCByZWZlcmVuY2VkVGFibGVOYW1lLCByZWZlcmVuY2VkQ29sdW1uTmFtZSwgYXJncykge1xuICAgIHRoaXMuX2Fzc2VydE5vdFJlYWRPbmx5KClcbiAgICBjb25zdCB0YWJsZUZvcmVpZ25LZXlBcmdzID0gT2JqZWN0LmFzc2lnbihcbiAgICAgIHtcbiAgICAgICAgY29sdW1uTmFtZSxcbiAgICAgICAgdGFibGVOYW1lLFxuICAgICAgICByZWZlcmVuY2VkQ29sdW1uTmFtZSxcbiAgICAgICAgcmVmZXJlbmNlZFRhYmxlTmFtZVxuICAgICAgfSxcbiAgICAgIGFyZ3NcbiAgICApXG4gICAgY29uc3QgdGFibGVGb3JlaWduS2V5ID0gbmV3IFRhYmxlRm9yZWlnbktleSh0YWJsZUZvcmVpZ25LZXlBcmdzKVxuICAgIGNvbnN0IHRhYmxlRGF0YSA9IG5ldyBUYWJsZURhdGEodGFibGVOYW1lKVxuXG4gICAgdGFibGVEYXRhLmFkZEZvcmVpZ25LZXkodGFibGVGb3JlaWduS2V5KVxuXG4gICAgY29uc3QgYWx0ZXJUYWJsZVNRTHMgPSBhd2FpdCB0aGlzLmFsdGVyVGFibGVTUUxzKHRhYmxlRGF0YSlcblxuICAgIGZvciAoY29uc3QgYWx0ZXJUYWJsZVNRTCBvZiBhbHRlclRhYmxlU1FMcykge1xuICAgICAgYXdhaXQgdGhpcy5xdWVyeShhbHRlclRhYmxlU1FMKVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHJlbW92ZSBmb3JlaWduIGtleS5cbiAgICogQHBhcmFtIHtzdHJpbmd9IHRhYmxlTmFtZSAtIFRhYmxlIG5hbWUuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi9iYXNlLWZvcmVpZ24ta2V5LmpzXCIpLmRlZmF1bHR9IGZvcmVpZ25LZXlNZXRhZGF0YSAtIEZvcmVpZ24ga2V5IG1ldGFkYXRhLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyB3aGVuIGNvbXBsZXRlLlxuICAgKi9cbiAgYXN5bmMgcmVtb3ZlRm9yZWlnbktleSh0YWJsZU5hbWUsIGZvcmVpZ25LZXlNZXRhZGF0YSkge1xuICAgIHRoaXMuX2Fzc2VydE5vdFJlYWRPbmx5KClcblxuICAgIGNvbnN0IHRhYmxlRm9yZWlnbktleSA9IG5ldyBUYWJsZUZvcmVpZ25LZXkoe1xuICAgICAgY29sdW1uTmFtZTogZm9yZWlnbktleU1ldGFkYXRhLmdldENvbHVtbk5hbWUoKSxcbiAgICAgIGRyb3BGb3JlaWduS2V5OiB0cnVlLFxuICAgICAgbmFtZTogZm9yZWlnbktleU1ldGFkYXRhLmdldE5hbWUoKSxcbiAgICAgIHJlZmVyZW5jZWRDb2x1bW5OYW1lOiBmb3JlaWduS2V5TWV0YWRhdGEuZ2V0UmVmZXJlbmNlZENvbHVtbk5hbWUoKSxcbiAgICAgIHJlZmVyZW5jZWRUYWJsZU5hbWU6IGZvcmVpZ25LZXlNZXRhZGF0YS5nZXRSZWZlcmVuY2VkVGFibGVOYW1lKCksXG4gICAgICB0YWJsZU5hbWVcbiAgICB9KVxuICAgIGNvbnN0IHRhYmxlRGF0YSA9IG5ldyBUYWJsZURhdGEodGFibGVOYW1lKVxuXG4gICAgdGFibGVEYXRhLmFkZEZvcmVpZ25LZXkodGFibGVGb3JlaWduS2V5KVxuXG4gICAgY29uc3QgYWx0ZXJUYWJsZVNRTHMgPSBhd2FpdCB0aGlzLmFsdGVyVGFibGVTUUxzKHRhYmxlRGF0YSlcblxuICAgIGZvciAoY29uc3QgYWx0ZXJUYWJsZVNRTCBvZiBhbHRlclRhYmxlU1FMcykge1xuICAgICAgYXdhaXQgdGhpcy5xdWVyeShhbHRlclRhYmxlU1FMKVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGFsdGVyIHRhYmxlIHNxbHMuXG4gICAqIEBhYnN0cmFjdFxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL3RhYmxlLWRhdGEvaW5kZXguanNcIikuZGVmYXVsdH0gX3RhYmxlRGF0YSAtIFRhYmxlIGRhdGEuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHN0cmluZ1tdPn0gLSBSZXNvbHZlcyB3aXRoIFNRTCBzdGF0ZW1lbnRzLlxuICAgKi9cbiAgYWx0ZXJUYWJsZVNRTHMoX3RhYmxlRGF0YSkge1xuICAgIHRocm93IG5ldyBFcnJvcihcImFsdGVyVGFibGVTUUxzIG5vdCBpbXBsZW1lbnRlZFwiKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgY29ubmVjdC5cbiAgICogQGFic3RyYWN0XG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIHdoZW4gY29tcGxldGUuXG4gICAqL1xuICBjb25uZWN0KCkge1xuICAgIHRocm93IG5ldyBFcnJvcihcIidjb25uZWN0JyBub3QgaW1wbGVtZW50ZWRcIilcbiAgfVxuXG4gIC8qKlxuICAgKiBSZWxlYXNlcyB0cmFja2VkIGFkdmlzb3J5IGxvY2tzIGFuZCBjbG9zZXMgdGhlIHBoeXNpY2FsIGRhdGFiYXNlIGNvbm5lY3Rpb24uXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIHdoZW4gY2xlYW51cCBhbmQgY2xvc2UgY29tcGxldGUuXG4gICAqL1xuICBhc3luYyBjbG9zZSgpIHtcbiAgICAvKiogQHR5cGUge0Vycm9yIHwgdW5kZWZpbmVkfSAqL1xuICAgIGxldCBhZHZpc29yeUxvY2tFcnJvclxuXG4gICAgdHJ5IHtcbiAgICAgIGF3YWl0IHRoaXMucmVsZWFzZUhlbGRBZHZpc29yeUxvY2tzKClcbiAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgYWR2aXNvcnlMb2NrRXJyb3IgPSBlcnJvciBpbnN0YW5jZW9mIEVycm9yID8gZXJyb3IgOiBuZXcgRXJyb3IoXCJGYWlsZWQgdG8gcmVsZWFzZSBoZWxkIGFkdmlzb3J5IGxvY2tzXCIsIHtjYXVzZTogZXJyb3J9KVxuICAgIH1cblxuICAgIHRyeSB7XG4gICAgICBhd2FpdCB0aGlzLl9jbG9zZSgpXG4gICAgICB0aGlzLl9oZWxkQWR2aXNvcnlMb2Nrcy5jbGVhcigpXG4gICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgIGNvbnN0IGNsb3NlRXJyb3IgPSBlcnJvciBpbnN0YW5jZW9mIEVycm9yID8gZXJyb3IgOiBuZXcgRXJyb3IoXCJGYWlsZWQgdG8gY2xvc2UgZGF0YWJhc2UgY29ubmVjdGlvblwiLCB7Y2F1c2U6IGVycm9yfSlcblxuICAgICAgaWYgKGFkdmlzb3J5TG9ja0Vycm9yKSB7XG4gICAgICAgIHRocm93IG5ldyBBZ2dyZWdhdGVFcnJvcihbYWR2aXNvcnlMb2NrRXJyb3IsIGNsb3NlRXJyb3JdLCBcIkZhaWxlZCB0byByZWxlYXNlIGFkdmlzb3J5IGxvY2tzIGFuZCBjbG9zZSBkYXRhYmFzZSBjb25uZWN0aW9uXCIsIHtjYXVzZTogZXJyb3J9KVxuICAgICAgfVxuXG4gICAgICB0aHJvdyBjbG9zZUVycm9yXG4gICAgfVxuXG4gICAgaWYgKGFkdmlzb3J5TG9ja0Vycm9yKSB0aHJvdyBhZHZpc29yeUxvY2tFcnJvclxuICB9XG5cbiAgLyoqXG4gICAqIERyaXZlci1zcGVjaWZpYyBwaHlzaWNhbCBjbG9zZSBob29rLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyB3aGVuIHRoZSB1bmRlcmx5aW5nIGNvbm5lY3Rpb24gY2xvc2VzLlxuICAgKi9cbiAgYXN5bmMgX2Nsb3NlKCkge1xuICAgIC8vIE5vLW9wIGJ5IGRlZmF1bHRcbiAgfVxuXG4gIC8qKlxuICAgKiBGbHVzaGVzIHBlbmRpbmcgd3JpdGVzIHRoYXQgdGhlIGRyaXZlciBkZWxheWVkIGZvciBwZXJzaXN0ZW5jZS5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgd2hlbiBwZW5kaW5nIHdyaXRlcyBhcmUgZHVyYWJsZS5cbiAgICovXG4gIGFzeW5jIGZsdXNoUGVuZGluZ1dyaXRlcygpIHtcbiAgICAvLyBOby1vcCBieSBkZWZhdWx0XG4gIH1cblxuICAvKipcbiAgICogUmV0dXJucyB3aGV0aGVyIGRlbGF5ZWQgcGVyc2lzdGVuY2Ugd3JpdGVzIHJlbWFpbi5cbiAgICogQHJldHVybnMge2Jvb2xlYW59IC0gV2hldGhlciB3cml0ZXMgcmVtYWluLlxuICAgKi9cbiAgaGFzUGVuZGluZ1dyaXRlcygpIHsgcmV0dXJuIGZhbHNlIH1cblxuICAvKipcbiAgICogRGVsZXRlcyB0aGlzIGRyaXZlcidzIHBoeXNpY2FsIGRhdGFiYXNlIHN0b3JhZ2Ugd2l0aG91dCBvcGVuaW5nIGl0LlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyBhZnRlciBkZWxldGlvbi5cbiAgICovXG4gIGFzeW5jIGRlbGV0ZURhdGFiYXNlU3RvcmFnZSgpIHsgdGhyb3cgbmV3IEVycm9yKGBEYXRhYmFzZSBzdG9yYWdlIGRlbGV0aW9uIGlzIG5vdCBzdXBwb3J0ZWQgYnkgJHt0aGlzLmNvbnN0cnVjdG9yLm5hbWV9YCkgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHNldCBjb25uZWN0aW9uIGNoZWNrb3V0IG5hbWUuXG4gICAqIEBwYXJhbSB7c3RyaW5nIHwgdW5kZWZpbmVkfSBuYW1lIC0gSHVtYW4tcmVhZGFibGUgbmFtZSBmb3IgdGhpcyBhY3RpdmUgY2hlY2tvdXQuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIHdoZW4gY29tcGxldGUuXG4gICAqL1xuICBhc3luYyBzZXRDb25uZWN0aW9uQ2hlY2tvdXROYW1lKG5hbWUpIHtcbiAgICB0aGlzLl9jb25uZWN0aW9uQ2hlY2tvdXROYW1lID0gbmFtZVxuICAgIHRoaXMuX2Nvbm5lY3Rpb25DaGVja2VkT3V0QXRVbml4TXMgPSBEYXRlLm5vdygpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBjbGVhciBjb25uZWN0aW9uIGNoZWNrb3V0IG5hbWUuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIHdoZW4gY29tcGxldGUuXG4gICAqL1xuICBhc3luYyBjbGVhckNvbm5lY3Rpb25DaGVja291dE5hbWUoKSB7XG4gICAgdGhpcy5fY29ubmVjdGlvbkNoZWNrb3V0TmFtZSA9IHVuZGVmaW5lZFxuICAgIHRoaXMuX2Nvbm5lY3Rpb25DaGVja2VkT3V0QXRVbml4TXMgPSB1bmRlZmluZWRcbiAgfVxuXG4gIC8qKlxuICAgKiBTZXRzIHRoZSBwb29sLW93bmVkIGlkZW50aXR5IHVzZWQgYnkgc2FmZSBkYXRhYmFzZSBkaWFnbm9zdGljcy5cbiAgICogQHBhcmFtIHt7ZGF0YWJhc2VJZGVudGlmaWVyOiBzdHJpbmcsIGRhdGFiYXNlSWRlbnRpdHlGaW5nZXJwcmludDogc3RyaW5nfX0gaWRlbnRpdHkgLSBQb29sLXN0YW1wZWQgaWRlbnRpdHkgcmVkYWN0ZWQgYXQgZGlhZ25vc3RpYyBzbmFwc2hvdCB0aW1lLlxuICAgKiBAcmV0dXJucyB7dm9pZH1cbiAgICovXG4gIHNldFBvb2xEaWFnbm9zdGljSWRlbnRpdHkoe2RhdGFiYXNlSWRlbnRpZmllciwgZGF0YWJhc2VJZGVudGl0eUZpbmdlcnByaW50fSkge1xuICAgIHRoaXMuX2RhdGFiYXNlSWRlbnRpZmllciA9IGRhdGFiYXNlSWRlbnRpZmllclxuICAgIHRoaXMuX2RhdGFiYXNlSWRlbnRpdHlGaW5nZXJwcmludCA9IGRhdGFiYXNlSWRlbnRpdHlGaW5nZXJwcmludFxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgcmVjb25uZWN0LlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyB3aGVuIGNvbXBsZXRlLlxuICAgKi9cbiAgYXN5bmMgcmVjb25uZWN0KCkge1xuICAgIHRoaXMuY2xlYXJTY2hlbWFDYWNoZSgpXG4gICAgYXdhaXQgdGhpcy5jbG9zZSgpXG4gICAgYXdhaXQgdGhpcy5jb25uZWN0KClcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGNyZWF0ZSBkYXRhYmFzZSBzcWwuXG4gICAqIEBhYnN0cmFjdFxuICAgKiBAcGFyYW0ge3N0cmluZ30gZGF0YWJhc2VOYW1lIC0gRGF0YWJhc2UgbmFtZS5cbiAgICogQHBhcmFtIHtvYmplY3R9IFthcmdzXSAtIE9wdGlvbnMgb2JqZWN0LlxuICAgKiBAcGFyYW0ge2Jvb2xlYW59IFthcmdzLmlmTm90RXhpc3RzXSAtIFdoZXRoZXIgaWYgbm90IGV4aXN0cy5cbiAgICogQHBhcmFtIHtzdHJpbmd9IFthcmdzLmRhdGFiYXNlQ2hhcnNldF0gLSBEYXRhYmFzZS1kZWZhdWx0IGNoYXJhY3RlciBzZXQgKGRyaXZlci1zcGVjaWZpYzsgbXlzcWwvbWFyaWFkYikuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBbYXJncy5kYXRhYmFzZUNvbGxhdGlvbl0gLSBEYXRhYmFzZS1kZWZhdWx0IGNvbGxhdGlvbiAoZHJpdmVyLXNwZWNpZmljOyBteXNxbC9tYXJpYWRiKS5cbiAgICogQHJldHVybnMge3N0cmluZ1tdfSAtIFNRTCBzdGF0ZW1lbnRzLlxuICAgKi9cbiAgY3JlYXRlRGF0YWJhc2VTcWwoZGF0YWJhc2VOYW1lLCBhcmdzKSB7IHRocm93IG5ldyBFcnJvcihcIidjcmVhdGVEYXRhYmFzZVNxbCcgbm90IGltcGxlbWVudGVkXCIpIH0gLy8gZXNsaW50LWRpc2FibGUtbGluZSBuby11bnVzZWQtdmFyc1xuXG4gIC8qKlxuICAgKiBSdW5zIGRyb3AgZGF0YWJhc2Ugc3FsLlxuICAgKiBAYWJzdHJhY3RcbiAgICogQHBhcmFtIHtzdHJpbmd9IGRhdGFiYXNlTmFtZSAtIERhdGFiYXNlIG5hbWUuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBbYXJnc10gLSBPcHRpb25zIG9iamVjdC5cbiAgICogQHBhcmFtIHtib29sZWFufSBbYXJncy5pZkV4aXN0c10gLSBXaGV0aGVyIGlmIGV4aXN0cy5cbiAgICogQHJldHVybnMge3N0cmluZ1tdfSAtIFNRTCBzdGF0ZW1lbnRzLlxuICAgKi9cbiAgZHJvcERhdGFiYXNlU3FsKGRhdGFiYXNlTmFtZSwgYXJncykgeyB0aHJvdyBuZXcgRXJyb3IoXCInZHJvcERhdGFiYXNlU3FsJyBub3QgaW1wbGVtZW50ZWRcIikgfSAvLyBlc2xpbnQtZGlzYWJsZS1saW5lIG5vLXVudXNlZC12YXJzXG5cbiAgLyoqXG4gICAqIFJ1bnMgY3JlYXRlIGluZGV4IHNxbHMuXG4gICAqIEBhYnN0cmFjdFxuICAgKiBAcGFyYW0ge0NyZWF0ZUluZGV4U3FsQXJnc30gaW5kZXhEYXRhIC0gSW5kZXggZGF0YS5cbiAgICogQHJldHVybnMge1Byb21pc2U8c3RyaW5nW10+fSAtIFJlc29sdmVzIHdpdGggU1FMIHN0YXRlbWVudHMuXG4gICAqL1xuICBhc3luYyBjcmVhdGVJbmRleFNRTHMoaW5kZXhEYXRhKSB7IC8vIGVzbGludC1kaXNhYmxlLWxpbmUgbm8tdW51c2VkLXZhcnNcbiAgICB0aHJvdyBuZXcgRXJyb3IoXCInY3JlYXRlSW5kZXhTUUxzJyBub3QgaW1wbGVtZW50ZWRcIilcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHJlbW92ZSBpbmRleCBzcWxzLlxuICAgKiBAYWJzdHJhY3RcbiAgICogQHBhcmFtIHtSZW1vdmVJbmRleFNxbEFyZ3N9IGluZGV4RGF0YSAtIEluZGV4IGRhdGEuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHN0cmluZ1tdPn0gLSBSZXNvbHZlcyB3aXRoIFNRTCBzdGF0ZW1lbnRzLlxuICAgKi9cbiAgYXN5bmMgcmVtb3ZlSW5kZXhTUUxzKGluZGV4RGF0YSkgeyAvLyBlc2xpbnQtZGlzYWJsZS1saW5lIG5vLXVudXNlZC12YXJzXG4gICAgdGhyb3cgbmV3IEVycm9yKFwiJ3JlbW92ZUluZGV4U1FMcycgbm90IGltcGxlbWVudGVkXCIpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBjcmVhdGUgdGFibGUuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vdGFibGUtZGF0YS9pbmRleC5qc1wiKS5kZWZhdWx0fSB0YWJsZURhdGEgLSBUYWJsZSBkYXRhLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyB3aGVuIGNvbXBsZXRlLlxuICAgKi9cbiAgYXN5bmMgY3JlYXRlVGFibGUodGFibGVEYXRhKSB7XG4gICAgdGhpcy5fYXNzZXJ0Tm90UmVhZE9ubHkoKVxuICAgIGNvbnN0IHNxbHMgPSBhd2FpdCB0aGlzLmNyZWF0ZVRhYmxlU3FsKHRhYmxlRGF0YSlcblxuICAgIGZvciAoY29uc3Qgc3FsIG9mIHNxbHMpIHtcbiAgICAgIGF3YWl0IHRoaXMucXVlcnkoc3FsKVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGNyZWF0ZSB0YWJsZSBzcWwuXG4gICAqIEBhYnN0cmFjdFxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL3RhYmxlLWRhdGEvaW5kZXguanNcIikuZGVmYXVsdH0gdGFibGVEYXRhIC0gVGFibGUgZGF0YS5cbiAgICogQHJldHVybnMge1Byb21pc2U8c3RyaW5nW10+fSAtIFJlc29sdmVzIHdpdGggU1FMIHN0YXRlbWVudHMuXG4gICAqL1xuICBhc3luYyBjcmVhdGVUYWJsZVNxbCh0YWJsZURhdGEpIHsgLy8gZXNsaW50LWRpc2FibGUtbGluZSBuby11bnVzZWQtdmFyc1xuICAgIHRocm93IG5ldyBFcnJvcihcIidjcmVhdGVUYWJsZVNxbCcgbm90IGltcGxlbWVudGVkXCIpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBkZWxldGUuXG4gICAqIEBwYXJhbSB7RGVsZXRlU3FsQXJnc1R5cGV9IGFyZ3MgLSBPcHRpb25zIG9iamVjdC5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgd2hlbiBjb21wbGV0ZS5cbiAgICovXG4gIGFzeW5jIGRlbGV0ZShhcmdzKSB7XG4gICAgdGhpcy5fYXNzZXJ0Tm90UmVhZE9ubHkoKVxuICAgIGNvbnN0IHNxbCA9IHRoaXMuZGVsZXRlU3FsKGFyZ3MpXG5cbiAgICBhd2FpdCB0aGlzLnF1ZXJ5KHNxbClcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGRlbGV0ZSBzcWwuXG4gICAqIEBhYnN0cmFjdFxuICAgKiBAcGFyYW0ge0RlbGV0ZVNxbEFyZ3NUeXBlfSBhcmdzIC0gT3B0aW9ucyBvYmplY3QuXG4gICAqIEByZXR1cm5zIHtzdHJpbmd9IC0gU1FMIHN0cmluZy5cbiAgICovXG4gIGRlbGV0ZVNxbChhcmdzKSB7IC8vIGVzbGludC1kaXNhYmxlLWxpbmUgbm8tdW51c2VkLXZhcnNcbiAgICB0aHJvdyBuZXcgRXJyb3IoYCdkZWxldGVTcWwnIG5vdCBpbXBsZW1lbnRlZGApXG4gIH1cblxuICAvKipcbiAgICogUnVucyBkcm9wIHRhYmxlLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gdGFibGVOYW1lIC0gVGFibGUgbmFtZS5cbiAgICogQHBhcmFtIHtEcm9wVGFibGVTcWxBcmdzVHlwZX0gW2FyZ3NdIC0gT3B0aW9ucyBvYmplY3QuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIHdoZW4gY29tcGxldGUuXG4gICAqL1xuICBhc3luYyBkcm9wVGFibGUodGFibGVOYW1lLCBhcmdzKSB7XG4gICAgdGhpcy5fYXNzZXJ0Tm90UmVhZE9ubHkoKVxuICAgIGNvbnN0IHNxbHMgPSBhd2FpdCB0aGlzLmRyb3BUYWJsZVNRTHModGFibGVOYW1lLCBhcmdzKVxuXG4gICAgZm9yIChjb25zdCBzcWwgb2Ygc3Fscykge1xuICAgICAgYXdhaXQgdGhpcy5xdWVyeShzcWwpXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZHJvcCB0YWJsZSBzcWxzLlxuICAgKiBAYWJzdHJhY3RcbiAgICogQHBhcmFtIHtzdHJpbmd9IHRhYmxlTmFtZSAtIFRhYmxlIG5hbWUuXG4gICAqIEBwYXJhbSB7RHJvcFRhYmxlU3FsQXJnc1R5cGV9IFthcmdzXSAtIE9wdGlvbnMgb2JqZWN0LlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxzdHJpbmdbXT59IC0gUmVzb2x2ZXMgd2l0aCBTUUwgc3RhdGVtZW50cy5cbiAgICovXG4gIGFzeW5jIGRyb3BUYWJsZVNRTHModGFibGVOYW1lLCBhcmdzKSB7IC8vIGVzbGludC1kaXNhYmxlLWxpbmUgbm8tdW51c2VkLXZhcnNcbiAgICB0aHJvdyBuZXcgRXJyb3IoXCJkcm9wVGFibGVTUUxzIG5vdCBpbXBsZW1lbnRlZFwiKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZXNjYXBlLlxuICAgKiBAYWJzdHJhY3RcbiAgICogQHBhcmFtIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gdmFsdWUgLSBWYWx1ZSB0byB1c2UuXG4gICAqIEByZXR1cm5zIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gLSBUaGUgZXNjYXBlLlxuICAgKi9cbiAgZXNjYXBlKHZhbHVlKSB7IC8vIGVzbGludC1kaXNhYmxlLWxpbmUgbm8tdW51c2VkLXZhcnNcbiAgICB0aHJvdyBuZXcgRXJyb3IoXCInZXNjYXBlJyBub3QgaW1wbGVtZW50ZWRcIilcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGdldCBhcmdzLlxuICAgKiBAcmV0dXJucyB7aW1wb3J0KFwiLi4vLi4vY29uZmlndXJhdGlvbi10eXBlcy5qc1wiKS5EYXRhYmFzZUNvbmZpZ3VyYXRpb25UeXBlfSAtIFRoZSBhcmdzLlxuICAgKi9cbiAgZ2V0QXJncygpIHtcbiAgICByZXR1cm4gdGhpcy5fYXJnc1xuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZ2V0IGNvbmZpZ3VyYXRpb24uXG4gICAqIEByZXR1cm5zIHtpbXBvcnQoXCIuLi8uLi9jb25maWd1cmF0aW9uLmpzXCIpLmRlZmF1bHR9IC0gVGhlIGNvbmZpZ3VyYXRpb24uXG4gICAqL1xuICBnZXRDb25maWd1cmF0aW9uKCkge1xuICAgIGlmICghdGhpcy5jb25maWd1cmF0aW9uKSB0aHJvdyBuZXcgRXJyb3IoXCJObyBjb25maWd1cmF0aW9uIHNldFwiKVxuXG4gICAgcmV0dXJuIHRoaXMuY29uZmlndXJhdGlvblxuICB9XG5cbiAgLyoqXG4gICAqIEluc3RhbGxzIGFuIG9wZXJhdGlvbiBsZWFzZSBhdG9taWNhbGx5IHdpdGggb3JkaW5hcnkgdHJhbnNhY3Rpb24gYWRtaXNzaW9uLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL29wZXJhdGlvbi1sZWFzZS5qc1wiKS5kZWZhdWx0fSBvcGVyYXRpb25MZWFzZSAtIEFjdGl2ZSBsZWFzZS5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgb25jZSB0aGUgbGVhc2Ugb3ducyB0cmFuc2FjdGlvbiBhZG1pc3Npb24uXG4gICAqL1xuICBhc3luYyBzZXRPcGVyYXRpb25MZWFzZShvcGVyYXRpb25MZWFzZSkge1xuICAgIGF3YWl0IHRoaXMuX3RyYW5zYWN0aW9uc0FjdGlvbnNNdXRleC5zeW5jKGFzeW5jICgpID0+IHtcbiAgICAgIGlmICh0aGlzLl9vcGVyYXRpb25MZWFzZSkgdGhyb3cgbmV3IEVycm9yKFwiQSBkYXRhYmFzZSBvcGVyYXRpb24gbGVhc2UgaXMgYWxyZWFkeSBhY3RpdmVcIilcbiAgICAgIGlmICh0aGlzLl90cmFuc2FjdGlvbnNDb3VudCA+IDApIHtcbiAgICAgICAgdGhyb3cgbmV3IEVycm9yKFwiQ2Fubm90IHN0YXJ0IGEgZGF0YWJhc2Ugb3BlcmF0aW9uIHdoaWxlIGFuIHVucmVsYXRlZCBvcmRpbmFyeSB0cmFuc2FjdGlvbiBpcyBhbHJlYWR5IGFjdGl2ZVwiKVxuICAgICAgfVxuXG4gICAgICB0aGlzLl9vcGVyYXRpb25MZWFzZSA9IG9wZXJhdGlvbkxlYXNlXG4gICAgfSlcbiAgfVxuXG4gIC8qKlxuICAgKiBDbGVhcnMgdGhlIG1hdGNoaW5nIG9wZXJhdGlvbiBsZWFzZS5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9vcGVyYXRpb24tbGVhc2UuanNcIikuZGVmYXVsdH0gb3BlcmF0aW9uTGVhc2UgLSBMZWFzZSB0byBjbGVhci5cbiAgICogQHJldHVybnMge3ZvaWR9XG4gICAqL1xuICBjbGVhck9wZXJhdGlvbkxlYXNlKG9wZXJhdGlvbkxlYXNlKSB7XG4gICAgaWYgKHRoaXMuX29wZXJhdGlvbkxlYXNlICE9PSBvcGVyYXRpb25MZWFzZSkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKFwiQ2Fubm90IGNsZWFyIGEgZGF0YWJhc2Ugb3BlcmF0aW9uIGxlYXNlIG93bmVkIGJ5IGFub3RoZXIgb3BlcmF0aW9uXCIpXG4gICAgfVxuXG4gICAgdGhpcy5fb3BlcmF0aW9uTGVhc2UgPSB1bmRlZmluZWRcbiAgfVxuXG4gIC8qKlxuICAgKiBXYWl0cyBmb3IgYW4gdW5yZWxhdGVkIG9wZXJhdGlvbiBsZWFzZSB0byByZWxlYXNlLlxuICAgKiBAcGFyYW0ge3N5bWJvbCB8IHVuZGVmaW5lZH0gb3BlcmF0aW9uT3duZXIgLSBDYW5kaWRhdGUgb3BlcmF0aW9uIG93bmVyLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn1cbiAgICovXG4gIGFzeW5jIF93YWl0Rm9yT3BlcmF0aW9uTGVhc2Uob3BlcmF0aW9uT3duZXIpIHtcbiAgICBjb25zdCBvcGVyYXRpb25MZWFzZSA9IHRoaXMuX29wZXJhdGlvbkxlYXNlXG5cbiAgICBpZiAob3BlcmF0aW9uTGVhc2UpIGF3YWl0IG9wZXJhdGlvbkxlYXNlLndhaXQob3BlcmF0aW9uT3duZXIpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBnZXQgaWQgc2VxLlxuICAgKiBAcmV0dXJucyB7bnVtYmVyIHwgdW5kZWZpbmVkfSAtIFRoZSBpZCBzZXEuXG4gICAqL1xuICBnZXRJZFNlcSgpIHtcbiAgICByZXR1cm4gdGhpcy5pZFNlcVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgcHJpbWFyeSBrZXkgdHlwZS5cbiAgICogQHJldHVybnMge3N0cmluZ30gLSBDb25maWd1cmVkIHByaW1hcnkga2V5IHR5cGUsIGRlZmF1bHRpbmcgdG8gVVVJRC5cbiAgICovXG4gIHByaW1hcnlLZXlUeXBlKCkge1xuICAgIHJldHVybiB0aGlzLmdldEFyZ3MoKS5wcmltYXJ5S2V5VHlwZSB8fCBcInV1aWRcIlxuICB9XG5cbiAgLyoqXG4gICAqIENsZWFycyBjYWNoZWQgc2NoZW1hIG1ldGFkYXRhIGZvciB0aGlzIGRyaXZlciBpbnN0YW5jZS5cbiAgICogQHJldHVybnMge3ZvaWR9IC0gTm8gcmV0dXJuIHZhbHVlLlxuICAgKi9cbiAgY2xlYXJTY2hlbWFDYWNoZSgpIHtcbiAgICBpZiAodGhpcy5fc2NoZW1hQ2FjaGVJbnZhbGlkYXRvcikge1xuICAgICAgdGhpcy5fc2NoZW1hQ2FjaGVJbnZhbGlkYXRvcigpXG4gICAgICByZXR1cm5cbiAgICB9XG5cbiAgICB0aGlzLl9jbGVhckxvY2FsU2NoZW1hQ2FjaGUoKVxuICB9XG5cbiAgLyoqXG4gICAqIENsZWFycyBvbmx5IHRoZSBtZXRhZGF0YSBjYWNoZWQgb24gdGhpcyBkcml2ZXIgaW5zdGFuY2UuXG4gICAqIEByZXR1cm5zIHt2b2lkfSAtIE5vIHJldHVybiB2YWx1ZS5cbiAgICovXG4gIF9jbGVhckxvY2FsU2NoZW1hQ2FjaGUoKSB7XG4gICAgdGhpcy5fc2NoZW1hQ2FjaGUuY2xlYXIoKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgc2V0IHNjaGVtYSBjYWNoZSBpbnZhbGlkYXRvci5cbiAgICogQHBhcmFtIHsoKSA9PiB2b2lkfSBpbnZhbGlkYXRvciAtIENhbGxiYWNrIHVzZWQgdG8gY2xlYXIgc2NoZW1hIGNhY2hlcyB0aGF0IHNoYXJlIHRoaXMgZHJpdmVyIHBvb2wuXG4gICAqIEByZXR1cm5zIHt2b2lkfSAtIE5vIHJldHVybiB2YWx1ZS5cbiAgICovXG4gIHNldFNjaGVtYUNhY2hlSW52YWxpZGF0b3IoaW52YWxpZGF0b3IpIHtcbiAgICB0aGlzLl9zY2hlbWFDYWNoZUludmFsaWRhdG9yID0gaW52YWxpZGF0b3JcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHNjaGVtYSBjYWNoZSBlbmFibGVkLlxuICAgKiBAcmV0dXJucyB7Ym9vbGVhbn0gLSBXaGV0aGVyIHNjaGVtYSBtZXRhZGF0YSBjYWNoaW5nIGlzIGVuYWJsZWQuXG4gICAqL1xuICBfc2NoZW1hQ2FjaGVFbmFibGVkKCkge1xuICAgIHJldHVybiB0aGlzLmdldEFyZ3MoKS5zY2hlbWFDYWNoZSAhPT0gZmFsc2VcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHNjaGVtYSBtZXRhZGF0YSByZXRyeSBkZWFkbGluZSBtcy5cbiAgICogQHJldHVybnMge251bWJlcn0gLSBCb3VuZGVkIGRlYWRsaW5lIGZvciBvdXRsYXN0aW5nIHRyYW5zaWVudCBzY2hlbWEtbWV0YWRhdGEgY29udGVudGlvbi5cbiAgICovXG4gIF9zY2hlbWFNZXRhZGF0YVJldHJ5RGVhZGxpbmVNcygpIHtcbiAgICBjb25zdCBjb25maWd1cmVkID0gdGhpcy5nZXRBcmdzKCkuc2NoZW1hTWV0YWRhdGFSZXRyeURlYWRsaW5lTXNcblxuICAgIHJldHVybiB0eXBlb2YgY29uZmlndXJlZCA9PT0gXCJudW1iZXJcIiA/IGNvbmZpZ3VyZWQgOiBTQ0hFTUFfTUVUQURBVEFfUkVUUllfREVBRExJTkVfTVNcbiAgfVxuXG4gIC8qKlxuICAgKiBXaGV0aGVyIGFuIGVycm9yIHJhaXNlZCBieSBhIHNjaGVtYS1tZXRhZGF0YSByZWFkIGlzIHRyYW5zaWVudCBjb250ZW50aW9uIHRoYXQgYSBib3VuZGVkXG4gICAqIHJldHJ5IGNhbiBvdXRsYXN0LiBEcml2ZXJzIG92ZXJyaWRlIHRoaXMgZm9yIHRoZWlyIG93biBjb250ZW50aW9uIHNpZ25hdHVyZXM7IHRoZSBkZWZhdWx0XG4gICAqIHRyZWF0cyBldmVyeSBmYWlsdXJlIGFzIGZpbmFsIHNvIG9ubHkgZHJpdmVycyB0aGF0IHByb3ZlIHRoZSB0cmFuc2llbnQgc2hhcGUgcmV0cnkgaXQuXG4gICAqIEBwYXJhbSB7dW5rbm93bn0gX2Vycm9yIC0gRXJyb3IgcmFpc2VkIGJ5IGEgc2NoZW1hLW1ldGFkYXRhIHJlYWQuXG4gICAqIEByZXR1cm5zIHtib29sZWFufSAtIFdoZXRoZXIgdGhlIHJlYWQgbWF5IGJlIHJldHJpZWQuXG4gICAqL1xuICBfaXNUcmFuc2llbnRTY2hlbWFNZXRhZGF0YUVycm9yKF9lcnJvcikge1xuICAgIHJldHVybiBmYWxzZVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgYSBzY2hlbWEtbWV0YWRhdGEgcmVhZCwgcmV0cnlpbmcgdHJhbnNpZW50IGNvbmN1cnJlbnQtRERMIGNvbnRlbnRpb24gdW50aWwgdGhlIGJvdW5kZWRcbiAgICogZGVhZGxpbmUuIE5vbi10cmFuc2llbnQgZmFpbHVyZXMgYW5kIGV4aGF1c3RlZCBkZWFkbGluZXMgcHJvcGFnYXRlIHRoZSBvcmlnaW5hbCBlcnJvci5cbiAgICogQHRlbXBsYXRlIFRcbiAgICogQHBhcmFtIHsoKSA9PiBQcm9taXNlPFQ+fSBjYWxsYmFjayAtIENhY2hlLW1pc3Mgc2NoZW1hIHJlYWQuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPFQ+fSAtIFJlc29sdmVzIHdpdGggdGhlIHJlYWQgcmVzdWx0LlxuICAgKi9cbiAgYXN5bmMgX3dpdGhTY2hlbWFNZXRhZGF0YURkbFJldHJ5KGNhbGxiYWNrKSB7XG4gICAgY29uc3QgZGVhZGxpbmVNcyA9IHRoaXMuX3NjaGVtYU1ldGFkYXRhUmV0cnlEZWFkbGluZU1zKClcbiAgICBjb25zdCBzdGFydGVkQXQgPSBEYXRlLm5vdygpXG4gICAgbGV0IGRlbGF5TXMgPSBTQ0hFTUFfTUVUQURBVEFfUkVUUllfSU5JVElBTF9ERUxBWV9NU1xuXG4gICAgZm9yICg7Oykge1xuICAgICAgdHJ5IHtcbiAgICAgICAgcmV0dXJuIGF3YWl0IGNhbGxiYWNrKClcbiAgICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICAgIGlmICghdGhpcy5faXNUcmFuc2llbnRTY2hlbWFNZXRhZGF0YUVycm9yKGVycm9yKSkgdGhyb3cgZXJyb3JcbiAgICAgICAgaWYgKERhdGUubm93KCkgLSBzdGFydGVkQXQgKyBkZWxheU1zID4gZGVhZGxpbmVNcykgdGhyb3cgZXJyb3JcblxuICAgICAgICBhd2FpdCB3YWl0KGRlbGF5TXMpXG4gICAgICAgIGRlbGF5TXMgPSBNYXRoLm1pbihkZWxheU1zICogMiwgU0NIRU1BX01FVEFEQVRBX1JFVFJZX01BWF9ERUxBWV9NUylcbiAgICAgIH1cbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogUnVucyBjYWNoZWQgc2NoZW1hIG1ldGFkYXRhLlxuICAgKiBAdGVtcGxhdGUgVFxuICAgKiBAcGFyYW0ge3N0cmluZ30gY2FjaGVLZXkgLSBTY2hlbWEgY2FjaGUga2V5LlxuICAgKiBAcGFyYW0geygpID0+IFByb21pc2U8VD59IGNhbGxiYWNrIC0gQ2FjaGUgbWlzcyBjYWxsYmFjay5cbiAgICogQHJldHVybnMge1Byb21pc2U8VD59IC0gUmVzb2x2ZXMgd2l0aCB0aGUgY2FjaGVkIG1ldGFkYXRhLlxuICAgKi9cbiAgYXN5bmMgX2NhY2hlZFNjaGVtYU1ldGFkYXRhKGNhY2hlS2V5LCBjYWxsYmFjaykge1xuICAgIGlmICghdGhpcy5fc2NoZW1hQ2FjaGVFbmFibGVkKCkpIHJldHVybiBhd2FpdCB0aGlzLl93aXRoU2NoZW1hTWV0YWRhdGFEZGxSZXRyeShjYWxsYmFjaylcblxuICAgIGNvbnN0IGV4aXN0aW5nUHJvbWlzZSA9IHRoaXMuX3NjaGVtYUNhY2hlLmdldChjYWNoZUtleSlcblxuICAgIGlmIChleGlzdGluZ1Byb21pc2UpIHtcbiAgICAgIHJldHVybiAvKiogQHR5cGUge1R9ICovICh0aGlzLl9zY2hlbWFDYWNoZVJldHVyblZhbHVlKGF3YWl0IGV4aXN0aW5nUHJvbWlzZSkpXG4gICAgfVxuXG4gICAgY29uc3QgcHJvbWlzZSA9IChhc3luYyAoKSA9PiBhd2FpdCB0aGlzLl93aXRoU2NoZW1hTWV0YWRhdGFEZGxSZXRyeShjYWxsYmFjaykpKClcblxuICAgIHRoaXMuX3NjaGVtYUNhY2hlLnNldChjYWNoZUtleSwgcHJvbWlzZSlcblxuICAgIHRyeSB7XG4gICAgICByZXR1cm4gLyoqIEB0eXBlIHtUfSAqLyAodGhpcy5fc2NoZW1hQ2FjaGVSZXR1cm5WYWx1ZShhd2FpdCBwcm9taXNlKSlcbiAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgaWYgKHRoaXMuX3NjaGVtYUNhY2hlLmdldChjYWNoZUtleSkgPT09IHByb21pc2UpIHtcbiAgICAgICAgdGhpcy5fc2NoZW1hQ2FjaGUuZGVsZXRlKGNhY2hlS2V5KVxuICAgICAgfVxuXG4gICAgICB0aHJvdyBlcnJvclxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGNhY2hlZCB0YWJsZSBzY2hlbWEgbWV0YWRhdGEuXG4gICAqIEB0ZW1wbGF0ZSBUXG4gICAqIEBwYXJhbSB7c3RyaW5nfSB0YWJsZU5hbWUgLSBUYWJsZSBuYW1lLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gbWV0YWRhdGFOYW1lIC0gTWV0YWRhdGEgbmFtZS5cbiAgICogQHBhcmFtIHsoKSA9PiBQcm9taXNlPFQ+fSBjYWxsYmFjayAtIENhY2hlIG1pc3MgY2FsbGJhY2suXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPFQ+fSAtIFJlc29sdmVzIHdpdGggdGhlIGNhY2hlZCB0YWJsZSBtZXRhZGF0YS5cbiAgICovXG4gIGFzeW5jIF9jYWNoZWRUYWJsZVNjaGVtYU1ldGFkYXRhKHRhYmxlTmFtZSwgbWV0YWRhdGFOYW1lLCBjYWxsYmFjaykge1xuICAgIHJldHVybiBhd2FpdCB0aGlzLl9jYWNoZWRTY2hlbWFNZXRhZGF0YShgdGFibGU6JHt0YWJsZU5hbWV9OiR7bWV0YWRhdGFOYW1lfWAsIGNhbGxiYWNrKVxuICB9XG5cbiAgLyoqXG4gICAqIFNlZWRzIHNjaGVtYSBtZXRhZGF0YSB0aGF0IHdhcyBsb2FkZWQgaW4gb25lIGJhdGNoIGZvciBtYW55IHRhYmxlcywgc28gYSBsYXRlclxuICAgKiBwZXItdGFibGUgcmVhZCByZXNvbHZlcyBmcm9tIHRoZSBjYWNoZSBpbnN0ZWFkIG9mIGlzc3VpbmcgaXRzIG93biBxdWVyeS5cbiAgICogQHRlbXBsYXRlIFRcbiAgICogQHBhcmFtIHtzdHJpbmd9IHRhYmxlTmFtZSAtIFRhYmxlIG5hbWUuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBtZXRhZGF0YU5hbWUgLSBNZXRhZGF0YSBuYW1lLlxuICAgKiBAcGFyYW0ge1R9IHZhbHVlIC0gQWxyZWFkeS1yZXNvbHZlZCBtZXRhZGF0YS5cbiAgICogQHJldHVybnMge3ZvaWR9XG4gICAqL1xuICBzZWVkVGFibGVTY2hlbWFNZXRhZGF0YSh0YWJsZU5hbWUsIG1ldGFkYXRhTmFtZSwgdmFsdWUpIHtcbiAgICBpZiAoIXRoaXMuX3NjaGVtYUNhY2hlRW5hYmxlZCgpKSByZXR1cm5cblxuICAgIHRoaXMuX3NjaGVtYUNhY2hlLnNldChgdGFibGU6JHt0YWJsZU5hbWV9OiR7bWV0YWRhdGFOYW1lfWAsIFByb21pc2UucmVzb2x2ZSh2YWx1ZSkpXG4gIH1cblxuICAvKipcbiAgICogTG9hZHMgY29sdW1uIG1ldGFkYXRhIGZvciBzZXZlcmFsIHRhYmxlcywgY29tYmluaW5nIHRoZSByZWFkcyBpbnRvIG9uZSBxdWVyeVxuICAgKiB3aGVuIHRoZSBkcml2ZXIgY2FuIGFuc3dlciBmb3IgYWxsIG9mIHRoZW0gYXQgb25jZSBhbmQgc2VlZGluZyB0aGUgcGVyLXRhYmxlXG4gICAqIGNhY2hlIHNvIHRoZSBtb2RlbHMgdGhhdCBmb2xsb3cgaW5pdGlhbGl6ZSB3aXRob3V0IHF1ZXJ5aW5nLlxuICAgKiBAcGFyYW0ge0FycmF5PGltcG9ydChcIi4vYmFzZS10YWJsZS5qc1wiKS5kZWZhdWx0Pn0gdGFibGVzIC0gVGFibGVzIHRvIGxvYWQgY29sdW1ucyBmb3IuXG4gICAqIEBwYXJhbSB7e2NvbmN1cnJlbmN5PzogbnVtYmVyfX0gW2FyZ3NdIC0gQ29uY3VycmVuY3kgZm9yIGRyaXZlcnMgdGhhdCBjYW4gb25seSByZWFkIHBlciB0YWJsZS5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59XG4gICAqL1xuICBhc3luYyBwcmVmZXRjaFRhYmxlQ29sdW1ucyh0YWJsZXMsIHtjb25jdXJyZW5jeSA9IDh9ID0ge30pIHtcbiAgICBpZiAoIXRoaXMuX3NjaGVtYUNhY2hlRW5hYmxlZCgpKSByZXR1cm5cbiAgICBpZiAodGFibGVzLmxlbmd0aCA9PT0gMCkgcmV0dXJuXG5cbiAgICBjb25zdCBiYXRjaGVkQ29sdW1ucyA9IGF3YWl0IHRoaXMuYmF0Y2hUYWJsZUNvbHVtbnModGFibGVzKVxuXG4gICAgaWYgKGJhdGNoZWRDb2x1bW5zKSB7XG4gICAgICBmb3IgKGNvbnN0IFt0YWJsZU5hbWUsIGNvbHVtbnNdIG9mIGJhdGNoZWRDb2x1bW5zKSB7XG4gICAgICAgIHRoaXMuc2VlZFRhYmxlU2NoZW1hTWV0YWRhdGEodGFibGVOYW1lLCBcImNvbHVtbnNcIiwgY29sdW1ucylcbiAgICAgIH1cblxuICAgICAgcmV0dXJuXG4gICAgfVxuXG4gICAgYXdhaXQgQm91bmRlZFRhc2tSdW5uZXIucnVuKHtcbiAgICAgIGNvbmN1cnJlbmN5LFxuICAgICAgaXRlbXM6IHRhYmxlcyxcbiAgICAgIHdvcmtlcjogYXN5bmMgKHRhYmxlKSA9PiB7XG4gICAgICAgIGF3YWl0IHRhYmxlLmdldENvbHVtbnMoKVxuICAgICAgfVxuICAgIH0pXG4gIH1cblxuICAvKipcbiAgICogQmF0Y2hlZCBjb2x1bW4gbWV0YWRhdGEgZm9yIG1hbnkgdGFibGVzIGF0IG9uY2UuIERyaXZlcnMgd2hvc2UgZW5naW5lIGNhbm5vdFxuICAgKiBhbnN3ZXIgZm9yIHNldmVyYWwgdGFibGVzIGluIG9uZSBzdGF0ZW1lbnQgcmV0dXJuIG51bGwsIGxlYXZpbmcgdGhlIGNhbGxlciB0b1xuICAgKiByZWFkIHRoZW0gcGVyIHRhYmxlLlxuICAgKiBAcGFyYW0ge0FycmF5PGltcG9ydChcIi4vYmFzZS10YWJsZS5qc1wiKS5kZWZhdWx0Pn0gdGFibGVzIC0gVGFibGVzIHRvIGxvYWQgY29sdW1ucyBmb3IuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPE1hcDxzdHJpbmcsIEFycmF5PGltcG9ydChcIi4vYmFzZS1jb2x1bW4uanNcIikuZGVmYXVsdD4+IHwgbnVsbD59IC0gQ29sdW1ucyBrZXllZCBieSB0YWJsZSBuYW1lLCBvciBudWxsIHdoZW4gdW5zdXBwb3J0ZWQuXG4gICAqL1xuICBhc3luYyBiYXRjaFRhYmxlQ29sdW1ucyh0YWJsZXMpIHtcbiAgICB2b2lkIHRhYmxlc1xuXG4gICAgcmV0dXJuIG51bGxcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHNjaGVtYSBjYWNoZSByZXR1cm4gdmFsdWUuXG4gICAqIEBwYXJhbSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59IHZhbHVlIC0gQ2FjaGVkIHZhbHVlLlxuICAgKiBAcmV0dXJucyB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59IC0gVmFsdWUgcmV0dXJuZWQgdG8gY2FsbGVycy5cbiAgICovXG4gIF9zY2hlbWFDYWNoZVJldHVyblZhbHVlKHZhbHVlKSB7XG4gICAgaWYgKEFycmF5LmlzQXJyYXkodmFsdWUpKSByZXR1cm4gdmFsdWUuc2xpY2UoKVxuXG4gICAgcmV0dXJuIHZhbHVlXG4gIH1cblxuICAvKipcbiAgICogUnVucyBnZXQgdGFibGVzLlxuICAgKiBAYWJzdHJhY3RcbiAgICogQHJldHVybnMge1Byb21pc2U8QXJyYXk8aW1wb3J0KFwiLi9iYXNlLXRhYmxlLmpzXCIpLmRlZmF1bHQ+Pn0gLSBSZXNvbHZlcyB3aXRoIHRoZSB0YWJsZXMuXG4gICAqL1xuICBnZXRUYWJsZXMoKSB7XG4gICAgdGhyb3cgbmV3IEVycm9yKGAke3RoaXMuY29uc3RydWN0b3IubmFtZX0jZ2V0VGFibGVzIG5vdCBpbXBsZW1lbnRlZGApXG4gIH1cblxuICAvKipcbiAgICogUnVucyBzdHJ1Y3R1cmUgc3FsLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxzdHJpbmcgfCBudWxsPn0gLSBSZXNvbHZlcyB3aXRoIFNRTCBzdHJpbmcuXG4gICAqL1xuICBhc3luYyBzdHJ1Y3R1cmVTcWwoKSB7XG4gICAgcmV0dXJuIG51bGxcbiAgfVxuXG4gIC8qKlxuICAgKiBFeGVjdXRlcyBhIHdob2xlIG11bHRpLXN0YXRlbWVudCBzdHJ1Y3R1cmUgU1FMIHNjcmlwdCBpbiBhIHNpbmdsZSByb3VuZC10cmlwIHdoZW5cbiAgICogdGhlIGRyaXZlciBzdXBwb3J0cyBpdCwgcnVubmluZyBvbiB0aGlzIGNvbm5lY3Rpb24gKHNvIHRoZSBjYWxsZXIncyBmb3JlaWduLWtleVxuICAgKiBoYW5kbGluZyBhcHBsaWVzKS4gUmV0dXJucyB0cnVlIGlmIGl0IHJhbiB0aGUgd2hvbGUgc2NyaXB0OyBmYWxzZSB3aGVuIHRoZSBjYWxsZXJcbiAgICogc2hvdWxkIHJ1biB0aGUgc3RhdGVtZW50cyBpbmRpdmlkdWFsbHkuIFRoZSBiYXNlIGRyaXZlciBoYXMgbm8gYmF0Y2ggcGF0aC5cbiAgICogQHBhcmFtIHtzdHJpbmd9IF9zdHJ1Y3R1cmVTcWwgLSBGdWxsIG11bHRpLXN0YXRlbWVudCBzdHJ1Y3R1cmUgU1FMLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxib29sZWFuPn0gLSBXaGV0aGVyIHRoZSBzY3JpcHQgd2FzIGV4ZWN1dGVkIGFzIG9uZSBiYXRjaC5cbiAgICovXG4gIGFzeW5jIGV4ZWNTdHJ1Y3R1cmVTY3JpcHQoX3N0cnVjdHVyZVNxbCkge1xuICAgIHJldHVybiBmYWxzZVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZ2V0IHRhYmxlIGJ5IG5hbWUuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBuYW1lIC0gTmFtZS5cbiAgICogQHBhcmFtIHtvYmplY3R9IFthcmdzXSAtIE9wdGlvbnMgb2JqZWN0LlxuICAgKiBAcGFyYW0ge2Jvb2xlYW59IGFyZ3MudGhyb3dFcnJvciAtIFdoZXRoZXIgdGhyb3cgZXJyb3IuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPGltcG9ydChcIi4vYmFzZS10YWJsZS5qc1wiKS5kZWZhdWx0IHwgdW5kZWZpbmVkPn0gLSBSZXNvbHZlcyB3aXRoIHRoZSB0YWJsZSBieSBuYW1lLlxuICAgKi9cbiAgYXN5bmMgZ2V0VGFibGVCeU5hbWUobmFtZSwgYXJncykge1xuICAgIGNvbnN0IHRhYmxlcyA9IGF3YWl0IHRoaXMuZ2V0VGFibGVzKClcbiAgICBjb25zdCB0YWJsZU5hbWVzID0gW11cbiAgICBsZXQgdGFibGVcblxuICAgIGZvciAoY29uc3QgY2FuZGlkYXRlIG9mIHRhYmxlcykge1xuICAgICAgY29uc3QgY2FuZGlkYXRlTmFtZSA9IGNhbmRpZGF0ZS5nZXROYW1lKClcblxuICAgICAgaWYgKGNhbmRpZGF0ZU5hbWUgPT0gbmFtZSkge1xuICAgICAgICB0YWJsZSA9IGNhbmRpZGF0ZVxuICAgICAgICBicmVha1xuICAgICAgfVxuXG4gICAgICB0YWJsZU5hbWVzLnB1c2goY2FuZGlkYXRlTmFtZSlcbiAgICB9XG5cbiAgICBpZiAoIXRhYmxlICYmIGFyZ3M/LnRocm93RXJyb3IgIT09IGZhbHNlKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IodGhpcy5fbWlzc2luZ1RhYmxlRXJyb3JNZXNzYWdlKG5hbWUsIHRhYmxlTmFtZXMpKVxuICAgIH1cblxuICAgIHJldHVybiB0YWJsZVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgbWlzc2luZyB0YWJsZSBlcnJvciBtZXNzYWdlLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gbmFtZSAtIFRhYmxlIG5hbWUuXG4gICAqIEBwYXJhbSB7c3RyaW5nW119IHRhYmxlTmFtZXMgLSBBdmFpbGFibGUgdGFibGUgbmFtZXMuXG4gICAqIEByZXR1cm5zIHtzdHJpbmd9IC0gRXJyb3IgbWVzc2FnZS5cbiAgICovXG4gIF9taXNzaW5nVGFibGVFcnJvck1lc3NhZ2UobmFtZSwgdGFibGVOYW1lcykge1xuICAgIGNvbnN0IGVudmlyb25tZW50ID0gdGhpcy5nZXRDb25maWd1cmF0aW9uKCkuZ2V0RW52aXJvbm1lbnQoKVxuICAgIGNvbnN0IGFyZ3MgPSB0aGlzLmdldEFyZ3MoKVxuICAgIGNvbnN0IGRhdGFiYXNlTmFtZSA9IGFyZ3M/LmRhdGFiYXNlIHx8IGFyZ3M/Lm5hbWUgfHwgYXJncz8udXNlRGF0YWJhc2UgfHwgXCJ1bmtub3duXCJcblxuICAgIHJldHVybiBgQ291bGRuJ3QgZmluZCBhIHRhYmxlIGJ5IHRoYXQgbmFtZSBcIiR7bmFtZX1cIiBpbjogJHt0YWJsZU5hbWVzLmpvaW4oXCIsIFwiKX0gKGVudmlyb25tZW50OiAke2Vudmlyb25tZW50fSwgZGF0YWJhc2U6ICR7ZGF0YWJhc2VOYW1lfSlgXG4gIH1cblxuICAvKipcbiAgICogUnVucyBnZXQgdGFibGUgYnkgbmFtZSBvciBmYWlsLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gbmFtZSAtIE5hbWUuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPGltcG9ydChcIi4vYmFzZS10YWJsZS5qc1wiKS5kZWZhdWx0Pn0gLSBSZXNvbHZlcyB3aXRoIHRoZSB0YWJsZSBieSBuYW1lIG9yIGZhaWwuXG4gICAqL1xuICBhc3luYyBnZXRUYWJsZUJ5TmFtZU9yRmFpbChuYW1lKSB7XG4gICAgcmV0dXJuIC8qKiBAdHlwZSB7aW1wb3J0KFwiLi9iYXNlLXRhYmxlLmpzXCIpLmRlZmF1bHR9ICovIChhd2FpdCB0aGlzLmdldFRhYmxlQnlOYW1lKG5hbWUsIHt0aHJvd0Vycm9yOiB0cnVlfSkpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBnZXQgdHlwZS5cbiAgICogQGFic3RyYWN0XG4gICAqIEByZXR1cm5zIHtzdHJpbmd9IC0gVGhlIHR5cGUuXG4gICAqL1xuICBnZXRUeXBlKCkge1xuICAgIHRocm93IG5ldyBFcnJvcihcIid0eXBlJyBub3QgaW1wbGVtZW50ZWRcIilcbiAgfVxuXG4gIC8qKlxuICAgKiBXaGV0aGVyIHRoaXMgZHJpdmVyIGNhbiBjb21iaW5lIHVucmVsYXRlZCBhbHRlci10YWJsZSBvcGVyYXRpb25zIGludG8gYVxuICAgKiBzaW5nbGUgYEFMVEVSIFRBQkxFYCBzdGF0ZW1lbnQgKFJhaWxzJyBgc3VwcG9ydHNfYnVsa19hbHRlcmApLlxuICAgKiBAcmV0dXJucyB7Ym9vbGVhbn0gLSBXaGV0aGVyIGJ1bGsgYWx0ZXIgaXMgc3VwcG9ydGVkLlxuICAgKi9cbiAgc3VwcG9ydHNCdWxrQWx0ZXIoKSB7XG4gICAgcmV0dXJuIGZhbHNlXG4gIH1cblxuICAvKipcbiAgICogV2hldGhlciBhIGJ1bGsgYEFMVEVSIFRBQkxFYCBzdGF0ZW1lbnQgY2FuIGFsc28gY2FycnkgYEFERCBJTkRFWGAgY2xhdXNlcy5cbiAgICogT25seSBkcml2ZXJzIHRoYXQgc3VwcG9ydCB0aGlzIGtlZXAgaW5kZXggYWRkcyBpbnNpZGUgdGhlIGNvbWJpbmVkIGJhdGNoO1xuICAgKiB0aGUgcmVzdCBleGVjdXRlIGVhY2ggaW5kZXggYXMgaXRzIG93biBzdGF0ZW1lbnQuXG4gICAqIEByZXR1cm5zIHtib29sZWFufSAtIFdoZXRoZXIgaW5kZXhlcyBjYW4gYmUgYWRkZWQgaW5zaWRlIGEgYnVsayBhbHRlci5cbiAgICovXG4gIHN1cHBvcnRzQnVsa0FsdGVySW5kZXhlcygpIHtcbiAgICByZXR1cm4gZmFsc2VcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGluc2VydC5cbiAgICogQHBhcmFtIHtJbnNlcnRTcWxBcmdzVHlwZX0gYXJncyAtIE9wdGlvbnMgb2JqZWN0LlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyB3aGVuIGNvbXBsZXRlLlxuICAgKi9cbiAgYXN5bmMgaW5zZXJ0KGFyZ3MpIHtcbiAgICB0aGlzLl9hc3NlcnROb3RSZWFkT25seSgpXG4gICAgY29uc3Qgc3FsID0gdGhpcy5pbnNlcnRTcWwoYXJncylcblxuICAgIGF3YWl0IHRoaXMucXVlcnkoc3FsKVxuICB9XG5cbiAgLyoqXG4gICAqIE1heGltdW0gcm93cyBwZXIgYElOU0VSVCAuLi4gVkFMVUVTICguLi4pLCAoLi4uKSwgLi4uYCBzdGF0ZW1lbnQuIERyaXZlcnNcbiAgICogdGhhdCBidWlsZCBtdWx0aS12YWx1ZSBpbnNlcnRzIG11c3Qgc3RheSBiZWxvdyBkYXRhYmFzZS1zcGVjaWZpYyBsaW1pdHNcbiAgICogKFNRTGl0ZSdzIGBNQVhfVkFSSUFCTEVfTlVNQkVSYCwgU1FMIFNlcnZlcidzIDIxMDAgcGFyYW1ldGVycywgUG9zdGdyZVNRTCdzXG4gICAqIDY1NTM1IHBhcmFtZXRlcnMsIGFuZCBzbyBvbikuIDUwMCByb3dzIGlzIHNhZmVseSB1bmRlciBldmVyeSBtYWpvciBlbmdpbmVcbiAgICogZm9yIHRhYmxlcyB3aXRoIGEgbW9kZXJhdGUgbnVtYmVyIG9mIGNvbHVtbnMgYW5kIGtlZXBzIGdlbmVyYXRlZCBTUUwgc21hbGwuXG4gICAqXG4gICAqIE92ZXJyaWRlIHZpYSBgbWF4Um93c1Blckluc2VydGAgaW4gdGhlIGRhdGFiYXNlIGNvbmZpZ3VyYXRpb24uXG4gICAqIEByZXR1cm5zIHtudW1iZXJ9IC0gTWF4aW11bSByb3dzIHBlciBpbnNlcnQgc3RhdGVtZW50LlxuICAgKi9cbiAgbWF4Um93c1Blckluc2VydCgpIHtcbiAgICByZXR1cm4gb3B0aW9uYWxQb3NpdGl2ZUludGVnZXIodGhpcy5nZXRBcmdzKCkubWF4Um93c1Blckluc2VydCwgXCJtYXhSb3dzUGVySW5zZXJ0XCIpID8/IDUwMFxuICB9XG5cbiAgLyoqXG4gICAqIE1heGltdW0gc2VyaWFsaXplZCBTUUwgc2l6ZSwgaW4gYnl0ZXMsIGZvciBhIHNpbmdsZSBgSU5TRVJUIC4uLiBWQUxVRVNgXG4gICAqIHN0YXRlbWVudC4gTGFyZ2UgdGV4dC9KU09OIHBheWxvYWRzIGNhbiBwdXNoIGEgbW9kZXN0IHJvdyBjb3VudCB3ZWxsIGJleW9uZFxuICAgKiBkYXRhYmFzZSB3aXJlL3Byb3RvY29sIGxpbWl0cywgc28gY2h1bmtpbmcgYWxzbyBzdG9wcyB3aGVuIHRoZSBuZXh0IHJvd1xuICAgKiB3b3VsZCBwdXNoIHRoZSBnZW5lcmF0ZWQgc3RyaW5nIG92ZXIgdGhpcyB0aHJlc2hvbGQuXG4gICAqXG4gICAqIE92ZXJyaWRlIHZpYSBgbWF4SW5zZXJ0U3FsQnl0ZXNgIGluIHRoZSBkYXRhYmFzZSBjb25maWd1cmF0aW9uLlxuICAgKiBAcmV0dXJucyB7bnVtYmVyfSAtIE1heGltdW0gYnl0ZXMgcGVyIGluc2VydCBzdGF0ZW1lbnQuXG4gICAqL1xuICBtYXhJbnNlcnRTcWxCeXRlcygpIHtcbiAgICByZXR1cm4gb3B0aW9uYWxQb3NpdGl2ZUludGVnZXIodGhpcy5nZXRBcmdzKCkubWF4SW5zZXJ0U3FsQnl0ZXMsIFwibWF4SW5zZXJ0U3FsQnl0ZXNcIikgPz8gMTA0ODU3NlxuICB9XG5cbiAgLyoqXG4gICAqIE1heGltdW0gdmFsdWVzIGluIGEgc2luZ2xlIGBJTiAoLi4uKWAgY29ob3J0IHVzZWQgYnkgcHJlbG9hZHMsIGFzc29jaWF0aW9uXG4gICAqIGNvdW50cywgYW5kIHF1ZXJ5RGF0YSBhZ2dyZWdhdGVzLiBUaGUgZGVmYXVsdCBzdGF5cyB1bmRlciBTUUxpdGUncyBkZWZhdWx0XG4gICAqIGBNQVhfVkFSSUFCTEVfTlVNQkVSYCBjb21waWxlLXRpbWUgbGltaXQuXG4gICAqXG4gICAqIE92ZXJyaWRlIHZpYSBgbWF4SW5DbGF1c2VWYWx1ZXNgIGluIHRoZSBkYXRhYmFzZSBjb25maWd1cmF0aW9uLlxuICAgKiBAcmV0dXJucyB7bnVtYmVyfSAtIE1heGltdW0gdmFsdWVzIHBlciBJTiBjbGF1c2UgY29ob3J0LlxuICAgKi9cbiAgbWF4SW5DbGF1c2VWYWx1ZXMoKSB7XG4gICAgcmV0dXJuIG9wdGlvbmFsUG9zaXRpdmVJbnRlZ2VyKHRoaXMuZ2V0QXJncygpLm1heEluQ2xhdXNlVmFsdWVzLCBcIm1heEluQ2xhdXNlVmFsdWVzXCIpID8/IDk5OVxuICB9XG5cbiAgLyoqXG4gICAqIE1heGltdW0gc2VyaWFsaXplZCBTUUwgc2l6ZSwgaW4gYnl0ZXMsIGZvciBhIHNpbmdsZSBjb2hvcnQgcXVlcnkgdXNlZCBieVxuICAgKiBwcmVsb2FkcywgYXNzb2NpYXRpb24gY291bnRzLCBhbmQgcXVlcnlEYXRhIGFnZ3JlZ2F0ZXMuIENvaG9ydCBjaHVua2luZ1xuICAgKiBzdG9wcyB3aGVuIHRoZSBuZXh0IHZhbHVlIHdvdWxkIHB1c2ggdGhlIGdlbmVyYXRlZCBzdHJpbmcgb3ZlciB0aGlzIHRocmVzaG9sZC5cbiAgICpcbiAgICogT3ZlcnJpZGUgdmlhIGBtYXhRdWVyeVNxbEJ5dGVzYCBpbiB0aGUgZGF0YWJhc2UgY29uZmlndXJhdGlvbi5cbiAgICogQHJldHVybnMge251bWJlcn0gLSBNYXhpbXVtIGJ5dGVzIHBlciBjb2hvcnQgcXVlcnkuXG4gICAqL1xuICBtYXhRdWVyeVNxbEJ5dGVzKCkge1xuICAgIHJldHVybiBvcHRpb25hbFBvc2l0aXZlSW50ZWdlcih0aGlzLmdldEFyZ3MoKS5tYXhRdWVyeVNxbEJ5dGVzLCBcIm1heFF1ZXJ5U3FsQnl0ZXNcIikgPz8gMTA0ODU3NlxuICB9XG5cbiAgLyoqXG4gICAqIFNwbGl0cyBgdmFsdWVzYCBpbnRvIGNvaG9ydCBjaHVua3MgdGhhdCBzdGF5IHdpdGhpbiBib3RoIGBtYXhDb3VudGAgYW5kXG4gICAqIGBtYXhCeXRlc2Agd2hpbGUgcHJlc2VydmluZyBvcmRlci5cbiAgICpcbiAgICogQSBjaHVuayBhbHdheXMgY29udGFpbnMgYXQgbGVhc3Qgb25lIHZhbHVlLCBldmVuIGlmIHRoYXQgc2luZ2xlIHZhbHVlIGV4Y2VlZHNcbiAgICogdGhlIGJ5dGUgbGltaXQsIHNvIHByb2dyZXNzIGlzIGd1YXJhbnRlZWQuXG4gICAqIEB0ZW1wbGF0ZSBUXG4gICAqIEBwYXJhbSB7QXJyYXk8VD59IHZhbHVlcyAtIFZhbHVlcyB0byBjaHVuay5cbiAgICogQHBhcmFtIHsodmFsdWVzOiBBcnJheTxUPikgPT4gc3RyaW5nfSBidWlsZFNxbCAtIEZ1bmN0aW9uIHRoYXQgYnVpbGRzIHRoZSBmdWxsIFNRTCBmb3IgYSBjYW5kaWRhdGUgY2h1bmsuXG4gICAqIEBwYXJhbSB7e21heENvdW50PzogbnVtYmVyLCBtYXhCeXRlcz86IG51bWJlcn19IFtvcHRpb25zXSAtIENodW5raW5nIGJvdW5kcy5cbiAgICogQHJldHVybnMge0FycmF5PEFycmF5PFQ+Pn0gLSBWYWx1ZSBjb2hvcnRzLlxuICAgKi9cbiAgY2h1bmtWYWx1ZXModmFsdWVzLCBidWlsZFNxbCwge21heENvdW50ID0gdGhpcy5tYXhJbkNsYXVzZVZhbHVlcygpLCBtYXhCeXRlcyA9IHRoaXMubWF4UXVlcnlTcWxCeXRlcygpfSA9IHt9KSB7XG4gICAgaWYgKHZhbHVlcy5sZW5ndGggPT09IDApIHJldHVybiBbXVxuXG4gICAgLyoqXG4gICAgICogQ2h1bmtzLlxuICAgICAqIEB0eXBlIHtBcnJheTxBcnJheTxUPj59ICovXG4gICAgY29uc3QgY2h1bmtzID0gW11cbiAgICAvKipcbiAgICAgKiBDdXJyZW50IGNodW5rLlxuICAgICAqIEB0eXBlIHtBcnJheTxUPn0gKi9cbiAgICBsZXQgY3VycmVudENodW5rID0gW11cblxuICAgIGZvciAoY29uc3QgdmFsdWUgb2YgdmFsdWVzKSB7XG4gICAgICBjb25zdCBjYW5kaWRhdGUgPSBbLi4uY3VycmVudENodW5rLCB2YWx1ZV1cbiAgICAgIGNvbnN0IGNhbmRpZGF0ZUJ5dGVzID0gdXRmOEJ5dGVMZW5ndGgoYnVpbGRTcWwoY2FuZGlkYXRlKSlcblxuICAgICAgaWYgKGN1cnJlbnRDaHVuay5sZW5ndGggPiAwICYmIChjYW5kaWRhdGUubGVuZ3RoID4gbWF4Q291bnQgfHwgY2FuZGlkYXRlQnl0ZXMgPiBtYXhCeXRlcykpIHtcbiAgICAgICAgY2h1bmtzLnB1c2goY3VycmVudENodW5rKVxuICAgICAgICBjdXJyZW50Q2h1bmsgPSBbdmFsdWVdXG4gICAgICB9IGVsc2Uge1xuICAgICAgICBjdXJyZW50Q2h1bmsgPSBjYW5kaWRhdGVcbiAgICAgIH1cbiAgICB9XG5cbiAgICBpZiAoY3VycmVudENodW5rLmxlbmd0aCA+IDApIHtcbiAgICAgIGNodW5rcy5wdXNoKGN1cnJlbnRDaHVuaylcbiAgICB9XG5cbiAgICByZXR1cm4gY2h1bmtzXG4gIH1cblxuICAvKipcbiAgICogU3BsaXRzIGByb3dzYCBpbnRvIGNodW5rcyB0aGF0IHN0YXkgd2l0aGluIGJvdGgge0BsaW5rIG1heFJvd3NQZXJJbnNlcnR9XG4gICAqIGFuZCB7QGxpbmsgbWF4SW5zZXJ0U3FsQnl0ZXN9IHdoaWxlIHByZXNlcnZpbmcgb3JkZXIuXG4gICAqXG4gICAqIEJ5dGUgYWNjb3VudGluZyBpcyBpbmNyZW1lbnRhbDogYGJ1aWxkU3FsYCBpcyBjYWxsZWQgb25jZSB3aXRoIGBbXWAgdG9cbiAgICogbWVhc3VyZSB0aGUgc3RhdGVtZW50IHByZWZpeCBhbmQgb25jZSBwZXIgcm93IHdpdGggYFtyb3ddYCB0byBtZWFzdXJlIHRoZVxuICAgKiByb3cncyB2YWx1ZXMgdHVwbGUuIFRoaXMga2VlcHMgY2h1bmtpbmcgbGluZWFyIGluIHRoZSBudW1iZXIgb2Ygcm93c1xuICAgKiBpbnN0ZWFkIG9mIHJlYnVpbGRpbmcgdGhlIGZ1bGwgbXVsdGktcm93IFNRTCBmb3IgZXZlcnkgY2FuZGlkYXRlLlxuICAgKlxuICAgKiBBIGNodW5rIGFsd2F5cyBjb250YWlucyBhdCBsZWFzdCBvbmUgcm93LCBldmVuIGlmIHRoYXQgc2luZ2xlIHJvdyBleGNlZWRzXG4gICAqIHRoZSBieXRlIGxpbWl0LCBzbyBwcm9ncmVzcyBpcyBndWFyYW50ZWVkLlxuICAgKiBAcGFyYW0ge0FycmF5PEFycmF5PFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pj59IHJvd3MgLSBSb3dzIHRvIGluc2VydC5cbiAgICogQHBhcmFtIHsocm93czogQXJyYXk8QXJyYXk8UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+PikgPT4gc3RyaW5nfSBidWlsZFNxbCAtIEZ1bmN0aW9uIHRoYXQgYnVpbGRzIHRoZSBmdWxsIFNRTCBmb3IgYSBjYW5kaWRhdGUgY2h1bms7IGNhbGxlZCB3aXRoIGBbXWAgdG8gbWVhc3VyZSB0aGUgc3RhdGVtZW50IHByZWZpeCBhbmQgd2l0aCBgW3Jvd11gIHRvIG1lYXN1cmUgZWFjaCByb3cncyB2YWx1ZXMgdHVwbGUuXG4gICAqIEByZXR1cm5zIHtBcnJheTxBcnJheTxBcnJheTxSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj4+Pn0gLSBSb3cgY2h1bmtzLlxuICAgKi9cbiAgX2luc2VydE11bHRpcGxlQ2h1bmtzKHJvd3MsIGJ1aWxkU3FsKSB7XG4gICAgY29uc3QgY2h1bmtzID0gW11cbiAgICBjb25zdCBtYXhSb3dzID0gdGhpcy5tYXhSb3dzUGVySW5zZXJ0KClcbiAgICBjb25zdCBtYXhCeXRlcyA9IHRoaXMubWF4SW5zZXJ0U3FsQnl0ZXMoKVxuICAgIGNvbnN0IGVtcHR5U3FsID0gYnVpbGRTcWwoW10pXG4gICAgY29uc3QgcHJlZml4ID0gYCR7ZW1wdHlTcWx9IFZBTFVFUyBgXG4gICAgY29uc3QgYmFzZUJ5dGVMZW5ndGggPSB1dGY4Qnl0ZUxlbmd0aChwcmVmaXgpXG5cbiAgICAvKipcbiAgICAgKiBDdXJyZW50IGNodW5rLlxuICAgICAqIEB0eXBlIHtBcnJheTxBcnJheTxSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj4+fSAqL1xuICAgIGxldCBjdXJyZW50Q2h1bmsgPSBbXVxuICAgIGxldCBjdXJyZW50Qnl0ZXMgPSAwXG5cbiAgICBmb3IgKGNvbnN0IHJvdyBvZiByb3dzKSB7XG4gICAgICBjb25zdCBzaW5nbGVSb3dTcWwgPSBidWlsZFNxbChbcm93XSlcbiAgICAgIGNvbnN0IHJvd1ZhbHVlc1NxbCA9IHNpbmdsZVJvd1NxbC5zbGljZShwcmVmaXgubGVuZ3RoKVxuICAgICAgY29uc3Qgcm93VmFsdWVzU3FsQnl0ZXMgPSB1dGY4Qnl0ZUxlbmd0aChyb3dWYWx1ZXNTcWwpXG5cbiAgICAgIGlmIChjdXJyZW50Q2h1bmsubGVuZ3RoID4gMCkge1xuICAgICAgICBjb25zdCBjYW5kaWRhdGVSb3dzID0gY3VycmVudENodW5rLmxlbmd0aCArIDFcbiAgICAgICAgY29uc3QgY2FuZGlkYXRlQnl0ZXMgPSBjdXJyZW50Qnl0ZXMgKyAyICsgcm93VmFsdWVzU3FsQnl0ZXMgLy8gXCIsIFwiIHNlcGFyYXRvclxuXG4gICAgICAgIGlmIChjYW5kaWRhdGVSb3dzID4gbWF4Um93cyB8fCBjYW5kaWRhdGVCeXRlcyA+IG1heEJ5dGVzKSB7XG4gICAgICAgICAgY2h1bmtzLnB1c2goY3VycmVudENodW5rKVxuICAgICAgICAgIGN1cnJlbnRDaHVuayA9IFtdXG4gICAgICAgICAgY3VycmVudEJ5dGVzID0gMFxuICAgICAgICB9XG4gICAgICB9XG5cbiAgICAgIGlmIChjdXJyZW50Q2h1bmsubGVuZ3RoID09PSAwKSB7XG4gICAgICAgIGN1cnJlbnRCeXRlcyA9IGJhc2VCeXRlTGVuZ3RoICsgcm93VmFsdWVzU3FsQnl0ZXNcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIGN1cnJlbnRCeXRlcyArPSAyICsgcm93VmFsdWVzU3FsQnl0ZXNcbiAgICAgIH1cblxuICAgICAgY3VycmVudENodW5rLnB1c2gocm93KVxuICAgIH1cblxuICAgIGlmIChjdXJyZW50Q2h1bmsubGVuZ3RoID4gMCkge1xuICAgICAgY2h1bmtzLnB1c2goY3VycmVudENodW5rKVxuICAgIH1cblxuICAgIHJldHVybiBjaHVua3NcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGluc2VydCBtdWx0aXBsZS5cbiAgICpcbiAgICogTGFyZ2Ugcm93IHNldHMgYXJlIHNwbGl0IGludG8gbXVsdGlwbGUgc3RhdGVtZW50cyB0aGF0IGVhY2ggc3RheSB3aXRoaW5cbiAgICoge0BsaW5rIG1heFJvd3NQZXJJbnNlcnR9IHJvd3MgYW5kIHtAbGluayBtYXhJbnNlcnRTcWxCeXRlc30gc2VyaWFsaXplZFxuICAgKiBieXRlcyBzbyB0aGUgZ2VuZXJhdGVkIFNRTCBzdGF5cyB3aXRoaW4gZGF0YWJhc2UgcGFyYW1ldGVyIGFuZCB3aXJlIGxpbWl0cy5cbiAgICogV2hlbiBjYWxsZWQgb3V0c2lkZSBhIHRyYW5zYWN0aW9uIGVhY2ggY2h1bmsgY29tbWl0cyBpbmRlcGVuZGVudGx5OyBjYWxsZXJzXG4gICAqIHRoYXQgbmVlZCBhbGwtb3Itbm90aGluZyBzZW1hbnRpY3Mgc2hvdWxkIHdyYXAgdGhlIGNhbGwgaW4ge0BsaW5rIHRyYW5zYWN0aW9ufS5cbiAgICogQHBhcmFtIHtzdHJpbmd9IHRhYmxlTmFtZSAtIFRhYmxlIG5hbWUuXG4gICAqIEBwYXJhbSB7QXJyYXk8c3RyaW5nPn0gY29sdW1ucyAtIENvbHVtbiBuYW1lcy5cbiAgICogQHBhcmFtIHtBcnJheTxBcnJheTxSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj4+fSByb3dzIC0gUm93cyB0byBpbnNlcnQuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIHdoZW4gY29tcGxldGUuXG4gICAqL1xuICBhc3luYyBpbnNlcnRNdWx0aXBsZSh0YWJsZU5hbWUsIGNvbHVtbnMsIHJvd3MpIHtcbiAgICB0aGlzLl9hc3NlcnROb3RSZWFkT25seSgpXG5cbiAgICBjb25zdCBjaHVua3MgPSB0aGlzLl9pbnNlcnRNdWx0aXBsZUNodW5rcyhyb3dzLCAoY2h1bmtSb3dzKSA9PiB0aGlzLmluc2VydFNxbCh7Y29sdW1ucywgdGFibGVOYW1lLCByb3dzOiBjaHVua1Jvd3N9KSlcblxuICAgIGZvciAoY29uc3QgY2h1bmsgb2YgY2h1bmtzKSB7XG4gICAgICBjb25zdCBzcWwgPSB0aGlzLmluc2VydFNxbCh7Y29sdW1ucywgdGFibGVOYW1lLCByb3dzOiBjaHVua30pXG5cbiAgICAgIGF3YWl0IHRoaXMucXVlcnkoc3FsKVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGluc2VydCBzcWwuXG4gICAqIEBhYnN0cmFjdFxuICAgKiBAcGFyYW0ge0luc2VydFNxbEFyZ3NUeXBlfSBhcmdzIC0gT3B0aW9ucyBvYmplY3QuXG4gICAqIEByZXR1cm5zIHtzdHJpbmd9IC0gU1FMIHN0cmluZy5cbiAgICovXG4gIGluc2VydFNxbChhcmdzKSB7IC8vIGVzbGludC1kaXNhYmxlLWxpbmUgbm8tdW51c2VkLXZhcnNcbiAgICB0aHJvdyBuZXcgRXJyb3IoXCInaW5zZXJ0U3FsJyBub3QgaW1wbGVtZW50ZWRcIilcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHVwc2VydC5cbiAgICogQHBhcmFtIHtVcHNlcnRTcWxBcmdzVHlwZX0gYXJncyAtIE9wdGlvbnMgb2JqZWN0LlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyB3aGVuIGNvbXBsZXRlLlxuICAgKi9cbiAgYXN5bmMgdXBzZXJ0KGFyZ3MpIHtcbiAgICB0aGlzLl9hc3NlcnROb3RSZWFkT25seSgpXG4gICAgY29uc3Qgc3FsID0gdGhpcy51cHNlcnRTcWwoYXJncylcblxuICAgIGF3YWl0IHRoaXMucXVlcnkoc3FsKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgbGFzdCBpbnNlcnQgaWQuXG4gICAqIEBhYnN0cmFjdFxuICAgKiBAcGFyYW0ge1F1ZXJ5T3B0aW9uc30gW19vcHRpb25zXSAtIFF1ZXJ5IG93bmVyc2hpcCBvcHRpb25zLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxudW1iZXI+fSAtIFJlc29sdmVzIHdpdGggdGhlIGxhc3QgaW5zZXJ0IGlkLlxuICAgKi9cbiAgbGFzdEluc2VydElEKF9vcHRpb25zID0ge30pIHtcbiAgICB0aHJvdyBuZXcgRXJyb3IoYCR7dGhpcy5jb25zdHJ1Y3Rvci5uYW1lfSNsYXN0SW5zZXJ0SUQgbm90IGltcGxlbWVudGVkYClcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGNvbnZlcnQgdmFsdWUuXG4gICAqIEBwYXJhbSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59IHZhbHVlIC0gVmFsdWUgdG8gdXNlLlxuICAgKiBAcmV0dXJucyB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59IC0gVGhlIGNvbnZlcnQgdmFsdWUuXG4gICAqL1xuICBfY29udmVydFZhbHVlKHZhbHVlKSB7XG4gICAgaWYgKHR5cGVvZiB2YWx1ZSA9PT0gXCJib29sZWFuXCIpIHtcbiAgICAgIHJldHVybiB2YWx1ZSA/IDEgOiAwXG4gICAgfVxuXG4gICAgLy8gaXNEYXRlIGluc3RlYWQgb2YgaW5zdGFuY2VvZjogYSBEYXRlIGNyZWF0ZWQgaW4gYW5vdGhlciByZWFsbSAoZS5nLiB0aGUgY29uc29sZSBSRVBMKSB3b3VsZFxuICAgIC8vIGZhaWwgaW5zdGFuY2VvZiwgc2tpcCB0aGlzIGNvbnZlcnNpb24sIGFuZCBzZXJpYWxpemUgYXMgYW4gZW1wdHkgU1FMIHZhbHVlIGRvd25zdHJlYW0uXG4gICAgaWYgKGlzRGF0ZSh2YWx1ZSkpIHtcbiAgICAgIHJldHVybiBmb3JtYXREYXRlRm9yRGF0YWJhc2UodmFsdWUsIHtkYXRhYmFzZVR5cGU6IHRoaXMuZ2V0VHlwZSgpfSlcbiAgICB9XG5cbiAgICAvLyBKU09OLWVuY29kZSBwbGFpbiBvYmplY3RzL2FycmF5cyBzbyB0aGV5IGxhbmQgaW4gSlNPTi90ZXh0IGNvbHVtbnMgYXMgdmFsaWRcbiAgICAvLyBKU09OLiBXaXRob3V0IHRoaXMsIGRyaXZlcnMgbGlrZSBteXNxbCdzIGVzY2FwZSgpIHR1cm4gYW4gb2JqZWN0IGludG9cbiAgICAvLyBga2V5YCA9IHZhbHVlIGFzc2lnbm1lbnQgcGFpcnMgKGl0cyBgU0VUID9gIGZvcm0pLCBwcm9kdWNpbmcgaW52YWxpZCBTUUwgaW5cbiAgICAvLyBhIHZhbHVlIHBvc2l0aW9uLiBPbmx5IFBMQUlOIG9iamVjdHMgYW5kIGFycmF5cyBhcmUgZW5jb2RlZCDigJQgY2xhc3NcbiAgICAvLyBpbnN0YW5jZXMgKGUuZy4gbW9kZWwgcmVjb3Jkcywgd2hpY2ggYXJlIGNpcmN1bGFyIHZpYSBfY2hhbmdlcykgYW5kIEJ1ZmZlcnNcbiAgICAvLyBwYXNzIHRocm91Z2ggdW50b3VjaGVkLCBzaW5jZSBKU09OLnN0cmluZ2lmeSBvbiBhIHJlY29yZCB0aHJvd3Mgb24gaXRzXG4gICAgLy8gY2lyY3VsYXIgc3RydWN0dXJlIGFuZCBhIHJlY29yZCBpcyBuZXZlciBhIHZhbGlkIGNvbHVtbiB2YWx1ZSB0byBzZXJpYWxpemUuXG4gICAgaWYgKHRoaXMuX2lzSnNvbkVuY29kYWJsZVZhbHVlKHZhbHVlKSkge1xuICAgICAgcmV0dXJuIEpTT04uc3RyaW5naWZ5KHZhbHVlKVxuICAgIH1cblxuICAgIHJldHVybiB2YWx1ZVxuICB9XG5cbiAgLyoqXG4gICAqIFdoZXRoZXIgYSB2YWx1ZSBpcyBhIHBsYWluIG9iamVjdCBvciBhcnJheSB0aGF0IHNob3VsZCBiZSBKU09OLWVuY29kZWQgZm9yIGFcbiAgICogSlNPTi90ZXh0IGNvbHVtbi4gRXhjbHVkZXMgQnVmZmVycyBhbmQgY2xhc3MgaW5zdGFuY2VzIChlLmcuIG1vZGVsIHJlY29yZHMpLlxuICAgKiBAcGFyYW0ge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSB2YWx1ZSAtIFZhbHVlIHRvIHRlc3QuXG4gICAqIEByZXR1cm5zIHtib29sZWFufSAtIFdoZXRoZXIgdG8gSlNPTi1lbmNvZGUgdGhlIHZhbHVlLlxuICAgKi9cbiAgX2lzSnNvbkVuY29kYWJsZVZhbHVlKHZhbHVlKSB7XG4gICAgaWYgKHZhbHVlID09PSBudWxsIHx8IHR5cGVvZiB2YWx1ZSAhPT0gXCJvYmplY3RcIikgcmV0dXJuIGZhbHNlXG4gICAgaWYgKHR5cGVvZiBCdWZmZXIgIT09IFwidW5kZWZpbmVkXCIgJiYgQnVmZmVyLmlzQnVmZmVyKHZhbHVlKSkgcmV0dXJuIGZhbHNlXG4gICAgaWYgKEFycmF5LmlzQXJyYXkodmFsdWUpKSByZXR1cm4gdHJ1ZVxuXG4gICAgY29uc3QgcHJvdG90eXBlID0gT2JqZWN0LmdldFByb3RvdHlwZU9mKHZhbHVlKVxuXG4gICAgcmV0dXJuIHByb3RvdHlwZSA9PT0gT2JqZWN0LnByb3RvdHlwZSB8fCBwcm90b3R5cGUgPT09IG51bGxcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIG9wdGlvbnMuXG4gICAqIEBhYnN0cmFjdFxuICAgKiBAcmV0dXJucyB7aW1wb3J0KFwiLi4vcXVlcnktcGFyc2VyL29wdGlvbnMuanNcIikuZGVmYXVsdH0gLSBUaGUgb3B0aW9ucyBvcHRpb25zLlxuICAgKi9cbiAgb3B0aW9ucygpIHtcbiAgICB0aHJvdyBuZXcgRXJyb3IoXCInb3B0aW9ucycgbm90IGltcGxlbWVudGVkLlwiKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgcXVvdGUuXG4gICAqIEBwYXJhbSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59IHZhbHVlIC0gVmFsdWUgdG8gdXNlLlxuICAgKiBAcmV0dXJucyB7bnVtYmVyIHwgc3RyaW5nfSAtIFRoZSBxdW90ZS5cbiAgICovXG4gIHF1b3RlKHZhbHVlKSB7XG4gICAgaWYgKHR5cGVvZiB2YWx1ZSA9PSBcIm51bWJlclwiKSByZXR1cm4gdmFsdWVcblxuICAgIGNvbnN0IGVzY2FwZWRWYWx1ZSA9IHRoaXMuZXNjYXBlKHZhbHVlKVxuICAgIGNvbnN0IHJlc3VsdCA9IGBcIiR7ZXNjYXBlZFZhbHVlfVwiYFxuXG4gICAgcmV0dXJuIHJlc3VsdFxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgcXVvdGUgY29sdW1uLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gY29sdW1uTmFtZSAtIENvbHVtbiBuYW1lLlxuICAgKiBAcmV0dXJucyB7c3RyaW5nfSAtIFRoZSBxdW90ZSBjb2x1bW4uXG4gICAqL1xuICBxdW90ZUNvbHVtbihjb2x1bW5OYW1lKSB7XG4gICAgcmV0dXJuIHRoaXMub3B0aW9ucygpLnF1b3RlQ29sdW1uTmFtZShjb2x1bW5OYW1lKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgcXVvdGUgaW5kZXguXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBjb2x1bW5OYW1lIC0gQ29sdW1uIG5hbWUuXG4gICAqIEByZXR1cm5zIHtzdHJpbmd9IC0gVGhlIHF1b3RlIGluZGV4LlxuICAgKi9cbiAgcXVvdGVJbmRleChjb2x1bW5OYW1lKSB7XG4gICAgcmV0dXJuIHRoaXMub3B0aW9ucygpLnF1b3RlSW5kZXhOYW1lKGNvbHVtbk5hbWUpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBxdW90ZSB0YWJsZS5cbiAgICogQHBhcmFtIHtzdHJpbmd9IHRhYmxlTmFtZSAtIFRhYmxlIG5hbWUuXG4gICAqIEByZXR1cm5zIHtzdHJpbmd9IC0gVGhlIHF1b3RlIHRhYmxlLlxuICAgKi9cbiAgcXVvdGVUYWJsZSh0YWJsZU5hbWUpIHtcbiAgICByZXR1cm4gdGhpcy5vcHRpb25zKCkucXVvdGVUYWJsZU5hbWUodGFibGVOYW1lKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgbmV3IHF1ZXJ5LlxuICAgKiBAcmV0dXJucyB7UXVlcnl9IC0gVGhlIG5ldyBxdWVyeS5cbiAgICovXG4gIG5ld1F1ZXJ5KCkge1xuICAgIGNvbnN0IGhhbmRsZXIgPSBuZXcgSGFuZGxlcigpXG5cbiAgICByZXR1cm4gbmV3IFF1ZXJ5KHtcbiAgICAgIGRyaXZlcjogdGhpcyxcbiAgICAgIGhhbmRsZXJcbiAgICB9KVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgc2VsZWN0LlxuICAgKiBAcGFyYW0ge3N0cmluZ30gdGFibGVOYW1lIC0gVGFibGUgbmFtZS5cbiAgICogQHJldHVybnMge1Byb21pc2U8UXVlcnlSZXN1bHRUeXBlPn0gLSBSZXNvbHZlcyB3aXRoIHRoZSBzZWxlY3QuXG4gICAqL1xuICBhc3luYyBzZWxlY3QodGFibGVOYW1lKSB7XG4gICAgY29uc3QgcXVlcnkgPSB0aGlzLm5ld1F1ZXJ5KClcblxuICAgIGNvbnN0IHNxbCA9IHF1ZXJ5XG4gICAgICAuZnJvbSh0YWJsZU5hbWUpXG4gICAgICAudG9TcWwoKVxuXG4gICAgcmV0dXJuIGF3YWl0IHRoaXMucXVlcnkoc3FsKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgc2V0IGlkIHNlcS5cbiAgICogQHBhcmFtIHtudW1iZXIgfCB1bmRlZmluZWR9IG5ld0lkU2VxIC0gTmV3IGlkIHNlcS5cbiAgICogQHJldHVybnMge3ZvaWR9IC0gTm8gcmV0dXJuIHZhbHVlLlxuICAgKi9cbiAgc2V0SWRTZXEobmV3SWRTZXEpIHtcbiAgICB0aGlzLmlkU2VxID0gbmV3SWRTZXFcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHNob3VsZCBzZXQgYXV0byBpbmNyZW1lbnQgd2hlbiBwcmltYXJ5IGtleS5cbiAgICogQGFic3RyYWN0XG4gICAqIEByZXR1cm5zIHtib29sZWFufSAtIFdoZXRoZXIgc2V0IGF1dG8gaW5jcmVtZW50IHdoZW4gcHJpbWFyeSBrZXkuXG4gICAqL1xuICBzaG91bGRTZXRBdXRvSW5jcmVtZW50V2hlblByaW1hcnlLZXkoKSB7XG4gICAgdGhyb3cgbmV3IEVycm9yKGAnc2hvdWxkU2V0QXV0b0luY3JlbWVudFdoZW5QcmltYXJ5S2V5JyBub3QgaW1wbGVtZW50ZWRgKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgc3VwcG9ydHMgZGVmYXVsdCBwcmltYXJ5IGtleSB1dWlkLlxuICAgKiBAcmV0dXJucyB7Ym9vbGVhbn0gLSBXaGV0aGVyIHN1cHBvcnRzIGRlZmF1bHQgcHJpbWFyeSBrZXkgdXVpZC5cbiAgICovXG4gIHN1cHBvcnRzRGVmYXVsdFByaW1hcnlLZXlVVUlEKCkgeyByZXR1cm4gZmFsc2UgfVxuXG4gIC8qKlxuICAgKiBFeGVjdXRlcyBhbiBpbnNlcnQgdGhhdCBjYXJyaWVzIGFuIGV4cGxpY2l0IHByaW1hcnkta2V5IHZhbHVlXG4gICAqIChjbGllbnQtZ2VuZXJhdGVkIG9mZmxpbmUtc3luYyBpZHMpLiBEcml2ZXJzIHdob3NlIGF1dG8taW5jcmVtZW50IGNvbHVtbnNcbiAgICogcmVqZWN0IGV4cGxpY2l0IHZhbHVlcyAoTVNTUUwgSURFTlRJVFkpIG92ZXJyaWRlIHRoaXMgdG8gcnVuIHRoZSBpbnNlcnRcbiAgICogd2l0aCBpZGVudGl0eSBpbnNlcnQgZW5hYmxlZCBpbiBhIHNpbmdsZSByZXF1ZXN0LlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIE9wdGlvbnMgb2JqZWN0LlxuICAgKiBAcGFyYW0ge1F1ZXJ5T3B0aW9uc30gYXJncy5vcHRpb25zIC0gUXVlcnkgb3B0aW9ucyBmb3IgdGhlIHN0YW5kYXJkIHF1ZXJ5IHBhdGguXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBhcmdzLnNxbCAtIEdlbmVyYXRlZCBpbnNlcnQgU1FMLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gYXJncy50YWJsZU5hbWUgLSBUYWJsZSBiZWluZyBpbnNlcnRlZCBpbnRvLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxRdWVyeVJlc3VsdFR5cGU+fSAtIEluc2VydCByZXN1bHQuXG4gICAqL1xuICBhc3luYyBpbnNlcnRXaXRoRXhwbGljaXRQcmltYXJ5S2V5KHtvcHRpb25zLCBzcWwsIHRhYmxlTmFtZX0pIHtcbiAgICB2b2lkIHRhYmxlTmFtZVxuXG4gICAgcmV0dXJuIGF3YWl0IHRoaXMucXVlcnkoc3FsLCBvcHRpb25zKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgc3VwcG9ydHMgaW5zZXJ0IGludG8gcmV0dXJuaW5nLlxuICAgKiBAYWJzdHJhY3RcbiAgICogQHJldHVybnMge2Jvb2xlYW59IC0gV2hldGhlciBzdXBwb3J0cyBpbnNlcnQgaW50byByZXR1cm5pbmcuXG4gICAqL1xuICBzdXBwb3J0c0luc2VydEludG9SZXR1cm5pbmcoKSB7IHJldHVybiBmYWxzZSB9XG5cbiAgLyoqXG4gICAqIFdoZXRoZXIgYSBzaW5nbGUgY29ubmVjdGlvbiBjYW4gcmVmZXJlbmNlIHRhYmxlcyBpbiBhbm90aGVyIGRhdGFiYXNlIG9uIHRoZSBzYW1lIHNlcnZlciB2aWEgYVxuICAgKiB0d28tcGFydCBgZGF0YWJhc2VgLmB0YWJsZWAgaWRlbnRpZmllci4gV2hlbiB0cnVlLCBhIHF1ZXJ5IHNwYW5uaW5nIHNldmVyYWwgZGF0YWJhc2VzIG9uIHRoaXNcbiAgICogc2VydmVyIGNhbiBiZSBleHByZXNzZWQgYXMgb25lIHN0YXRlbWVudCAoYSBjcm9zcy10ZW5hbnQgYFVOSU9OIEFMTGApOyB3aGVuIGZhbHNlLCBlYWNoIGRhdGFiYXNlXG4gICAqIGlzIHF1ZXJpZWQgb24gaXRzIG93biBjb25uZWN0aW9uIGFuZCB0aGUgcmVzdWx0cyBtZXJnZWQgaW4gdGhlIGNhbGxlci4gT25seSBNeVNRTC9NYXJpYURCIHJldHVyblxuICAgKiB0cnVlOiBQb3N0Z3JlU1FMIChvbmUgZGF0YWJhc2UgcGVyIGNvbm5lY3Rpb24pIGFuZCBTUUxpdGUgKG9uZSBhdHRhY2hlZCBmaWxlIHBlciBjb25uZWN0aW9uKVxuICAgKiBjYW5ub3QsIGFuZCBNU1NRTCBpcyBleGNsdWRlZCBiZWNhdXNlIGl0IHJlYWRzIGEgdHdvLXBhcnQgbmFtZSBhcyBgc2NoZW1hLnRhYmxlYCAoY3Jvc3MtZGF0YWJhc2VcbiAgICogYWNjZXNzIG5lZWRzIGEgdGhyZWUtcGFydCBgZGF0YWJhc2Uuc2NoZW1hLnRhYmxlYCksIHNvIGl0IHN0YXlzIG9uIHRoZSBhbHdheXMtY29ycmVjdCBmYW4tb3V0XG4gICAqIHBhdGguIENvbnN1bWVkIGJ5IGBUZW5hbnQuYWdncmVnYXRlQWNyb3NzYC5cbiAgICogQHJldHVybnMge2Jvb2xlYW59IC0gV2hldGhlciB0d28tcGFydCBjcm9zcy1kYXRhYmFzZSByZWZlcmVuY2VzIGFyZSBzdXBwb3J0ZWQuXG4gICAqL1xuICBzdXBwb3J0c0Nyb3NzRGF0YWJhc2VSZWZlcmVuY2VzKCkgeyByZXR1cm4gZmFsc2UgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHRhYmxlIGV4aXN0cy5cbiAgICogQHBhcmFtIHtzdHJpbmd9IHRhYmxlTmFtZSAtIFRhYmxlIG5hbWUuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPGJvb2xlYW4+fSAtIFJlc29sdmVzIHdpdGggV2hldGhlciB0YWJsZSBleGlzdHMuXG4gICAqL1xuICBhc3luYyB0YWJsZUV4aXN0cyh0YWJsZU5hbWUpIHtcbiAgICBjb25zdCB0YWJsZXMgPSBhd2FpdCB0aGlzLmdldFRhYmxlcygpXG4gICAgY29uc3QgdGFibGUgPSB0YWJsZXMuZmluZCgodGFibGUpID0+IHRhYmxlLmdldE5hbWUoKSA9PSB0YWJsZU5hbWUpXG5cbiAgICBpZiAodGFibGUpIHJldHVybiB0cnVlXG5cbiAgICByZXR1cm4gZmFsc2VcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGEgY2FsbGJhY2sgaW5zaWRlIGEgZGF0YWJhc2UgdHJhbnNhY3Rpb24gKG9yIGEgc2F2ZXBvaW50IHdoZW4gYWxyZWFkeSBpbnNpZGUgb25lKS5cbiAgICogVGhlIG91dGVybW9zdCB0cmFuc2FjdGlvbiByZXRyaWVzIHRoZSB3aG9sZSBjYWxsYmFjayBvbiBhIGRlYWRsb2NrIC8gbG9jay13YWl0LXRpbWVvdXQsXG4gICAqIGJlY2F1c2Ugc3VjaCBlcnJvcnMgcm9sbCB0aGUgZW50aXJlIHRyYW5zYWN0aW9uIGJhY2sgYW5kIHRoZSBzdGFuZGFyZCByZWNvdmVyeSBpcyB0b1xuICAgKiByZXN0YXJ0IGl0LiBOZXN0ZWQgc2F2ZXBvaW50cyBsZXQgdGhlIGRlYWRsb2NrIGJ1YmJsZSB1cCB0byB0aGlzIG91dGVyIHJldHJ5LlxuICAgKiBAdGVtcGxhdGUgVFxuICAgKiBAcGFyYW0geygpID0+IFByb21pc2U8VD59IGNhbGxiYWNrIC0gQ2FsbGJhY2sgZnVuY3Rpb24uXG4gICAqIEBwYXJhbSB7UGljazxRdWVyeU9wdGlvbnMsIFwib3BlcmF0aW9uT3duZXJcIj59IFtvcHRpb25zXSAtIFRyYW5zYWN0aW9uIG93bmVyc2hpcC5cbiAgICogQHJldHVybnMge1Byb21pc2U8VD59IC0gUmVzb2x2ZXMgd2l0aCB0aGUgdHJhbnNhY3Rpb24gcmVzdWx0LlxuICAgKi9cbiAgYXN5bmMgdHJhbnNhY3Rpb24oY2FsbGJhY2ssIG9wdGlvbnMgPSB7fSkge1xuICAgIGF3YWl0IHRoaXMuX3dhaXRGb3JPcGVyYXRpb25MZWFzZShvcHRpb25zLm9wZXJhdGlvbk93bmVyKVxuXG4gICAgcmV0dXJuIGF3YWl0IGNvb3JkaW5hdGVTaGFyZWRUcmFuc2FjdGlvbkNvbm5lY3Rpb24odGhpcywgYXN5bmMgKCkgPT4ge1xuICAgICAgaWYgKHRoaXMuX3RyYW5zYWN0aW9uc0NvdW50ID4gMCkge1xuICAgICAgICByZXR1cm4gYXdhaXQgdGhpcy5fcnVuVHJhbnNhY3Rpb25BdHRlbXB0KGNhbGxiYWNrLCBvcHRpb25zKVxuICAgICAgfVxuXG4gICAgICBjb25zdCBhcmdzID0gdGhpcy5nZXRBcmdzKClcbiAgICAgIGNvbnN0IG1heEF0dGVtcHRzID0gb3B0aW9uYWxQb3NpdGl2ZUludGVnZXIoYXJncy5kZWFkbG9ja01heFJldHJpZXMsIFwiZGVhZGxvY2tNYXhSZXRyaWVzXCIpID8/IDhcbiAgICAgIGNvbnN0IGNvbmZpZ3VyZWRCYXNlV2FpdE1zID0gb3B0aW9uYWxQb3NpdGl2ZUludGVnZXIoYXJncy5kZWFkbG9ja0Jhc2VXYWl0TXMsIFwiZGVhZGxvY2tCYXNlV2FpdE1zXCIpXG4gICAgICBjb25zdCBkZWFkbG9ja01heFdhaXRNcyA9IG9wdGlvbmFsUG9zaXRpdmVJbnRlZ2VyKGFyZ3MuZGVhZGxvY2tNYXhXYWl0TXMsIFwiZGVhZGxvY2tNYXhXYWl0TXNcIikgPz8gMTAwMFxuICAgICAgbGV0IGF0dGVtcHQgPSAwXG5cbiAgICAgIHdoaWxlICh0cnVlKSB7XG4gICAgICAgIGF0dGVtcHQrK1xuICAgICAgICBjb25zdCBhdHRlbXB0U3RhcnRlZEF0TXMgPSB0aGlzLl9ub3dNcygpXG5cbiAgICAgICAgdHJ5IHtcbiAgICAgICAgICByZXR1cm4gYXdhaXQgdGhpcy5fcnVuVHJhbnNhY3Rpb25BdHRlbXB0KGNhbGxiYWNrLCBvcHRpb25zKVxuICAgICAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgICAgIGlmIChlcnJvciBpbnN0YW5jZW9mIFZlbG9jaW91c0RhdGFiYXNlQWZ0ZXJDb21taXRDYWxsYmFja0Vycm9yKSB0aHJvdyBlcnJvci5jYWxsYmFja0Vycm9yXG4gICAgICAgICAgaWYgKCEoZXJyb3IgaW5zdGFuY2VvZiBFcnJvcikpIHRocm93IGVycm9yXG5cbiAgICAgICAgICBjb25zdCByZXRyeUluZm8gPSB0aGlzLnJldHJ5YWJsZURhdGFiYXNlRXJyb3IoZXJyb3IpXG4gICAgICAgICAgY29uc3Qgd2lsbFJldHJ5ID0gQm9vbGVhbihyZXRyeUluZm8uZGVhZGxvY2sgJiYgYXR0ZW1wdCA8IG1heEF0dGVtcHRzICYmIHRoaXMuX3RyYW5zYWN0aW9uc0NvdW50ID09IDApXG5cbiAgICAgICAgICBpZiAod2lsbFJldHJ5KSB7XG4gICAgICAgICAgICB0aGlzLl9yZXBvcnREZWFkbG9ja1JldHJ5RGlhZ25vc3RpYyh7XG4gICAgICAgICAgICAgIGF0dGVtcHQsXG4gICAgICAgICAgICAgIGNvbnRlbnRpb25LaW5kOiByZXRyeUluZm8uY29udGVudGlvbktpbmQgfHwgXCJkZWFkbG9ja1wiLFxuICAgICAgICAgICAgICBlcnJvcixcbiAgICAgICAgICAgICAgbWF4QXR0ZW1wdHMsXG4gICAgICAgICAgICAgIHRyYW5zYWN0aW9uQXR0ZW1wdER1cmF0aW9uTXM6IE1hdGgubWF4KDAsIHRoaXMuX25vd01zKCkgLSBhdHRlbXB0U3RhcnRlZEF0TXMpLFxuICAgICAgICAgICAgICB3aWxsUmV0cnlcbiAgICAgICAgICAgIH0pXG5cbiAgICAgICAgICAgIC8vIEFuIGV4cGxpY2l0bHktY29uZmlndXJlZCBiYXNlIHdpbnMgc28gdGhlIHR1bmluZyBrbm9iIGlzIGVmZmVjdGl2ZSBldmVuIG9uIGRyaXZlcnNcbiAgICAgICAgICAgIC8vIHdob3NlIGNsYXNzaWZpZXIgc3VwcGxpZXMgaXRzIG93biBgd2FpdE1zYCAoTXlTUUwvTWFyaWFEQiByZXR1cm4gYSBmaXhlZCA1MG1zIGZvclxuICAgICAgICAgICAgLy8gZGVhZGxvY2tzKTsgb3RoZXJ3aXNlIGhvbm9yIHRoYXQgY2xhc3NpZmllciBoaW50LCB0aGVuIGZhbGwgYmFjayB0byA1MG1zLlxuICAgICAgICAgICAgY29uc3QgYmFzZVdhaXRNcyA9IGNvbmZpZ3VyZWRCYXNlV2FpdE1zID8/ICh0eXBlb2YgcmV0cnlJbmZvLndhaXRNcyA9PSBcIm51bWJlclwiICYmIHJldHJ5SW5mby53YWl0TXMgPiAwID8gcmV0cnlJbmZvLndhaXRNcyA6IDUwKVxuXG4gICAgICAgICAgICAvLyBGdWxsLWppdHRlciBleHBvbmVudGlhbCBiYWNrb2ZmOiB3YWl0IGEgdW5pZm9ybS1yYW5kb20gZHVyYXRpb24gaW5cbiAgICAgICAgICAgIC8vIFswLCBtaW4oYmFzZSAqIDJeKGF0dGVtcHQtMSksIGNhcCldLiBUaGUgZG91YmxpbmcgY2VpbGluZyBzcHJlYWRzIHJldHJpZXMgb3V0IGFzXG4gICAgICAgICAgICAvLyBjb250ZW50aW9uIHBlcnNpc3RzLCBhbmQgdGhlIGppdHRlciBkZS1jb3JyZWxhdGVzIHRyYW5zYWN0aW9ucyB0aGF0IGRlYWRsb2NrZWQgaW5cbiAgICAgICAgICAgIC8vIGxvY2tzdGVwIHNvIHRoZXkgc3RvcCByZS1jb2xsaWRpbmcgb24gdGhlIHNhbWUgd2FpdCAodGhlIGxpbmVhciBgYmFzZSAqIGF0dGVtcHRgXG4gICAgICAgICAgICAvLyB0aGlzIHJlcGxhY2VzIGhhZCBldmVyeSB2aWN0aW0gcmV0cnkgYWZ0ZXIgYW4gaWRlbnRpY2FsIGRlbGF5KS4gYGF0dGVtcHRgIGlzXG4gICAgICAgICAgICAvLyAxLWJhc2VkIGhlcmUsIHNvIDJeKGF0dGVtcHQtMSkgaXMgMSwgMiwgNCwgLi4uIFRoZSBjYXAga2VlcHMgdGhlIHRhaWwgc3ViLXNlY29uZC5cbiAgICAgICAgICAgIGNvbnN0IGNlaWxpbmdXYWl0TXMgPSBNYXRoLm1pbihiYXNlV2FpdE1zICogKDIgKiogKGF0dGVtcHQgLSAxKSksIGRlYWRsb2NrTWF4V2FpdE1zKVxuICAgICAgICAgICAgY29uc3Qgaml0dGVyZWRXYWl0TXMgPSBNYXRoLmZsb29yKE1hdGgucmFuZG9tKCkgKiAoY2VpbGluZ1dhaXRNcyArIDEpKVxuXG4gICAgICAgICAgICBjb25zdCBsb2dnZWRDb250ZW50aW9uS2luZCA9IHJldHJ5SW5mby5jb250ZW50aW9uS2luZCB8fCBcInRyYW5zYWN0aW9uIGNvbnRlbnRpb25cIlxuXG4gICAgICAgICAgICB0aGlzLmxvZ2dlci53YXJuKGBSZXRyeWluZyB0cmFuc2FjdGlvbiBhZnRlciAke2xvZ2dlZENvbnRlbnRpb25LaW5kfSAoYXR0ZW1wdCAke2F0dGVtcHR9LyR7bWF4QXR0ZW1wdHN9KWApXG4gICAgICAgICAgICBhd2FpdCB0aGlzLl93YWl0TXMoaml0dGVyZWRXYWl0TXMpXG4gICAgICAgICAgICBjb250aW51ZVxuICAgICAgICAgIH1cblxuICAgICAgICAgIHRocm93IGVycm9yXG4gICAgICAgIH1cbiAgICAgIH1cbiAgICB9LCBvcHRpb25zLm9wZXJhdGlvbk93bmVyKVxuICB9XG5cbiAgLyoqXG4gICAqIFdhaXRzIGBtc2AgbWlsbGlzZWNvbmRzLiBJc29sYXRlZCBpbiBpdHMgb3duIG1ldGhvZCBzbyB0ZXN0cyBjYW4gb2JzZXJ2ZSAoYW5kIHNraXApIHRoZVxuICAgKiBkZWFkbG9jay1yZXRyeSBiYWNrb2ZmIHdpdGhvdXQgYSByZWFsIHRpbWVyLlxuICAgKiBAcGFyYW0ge251bWJlcn0gbXMgLSBNaWxsaXNlY29uZHMgdG8gd2FpdC5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgYWZ0ZXIgdGhlIGRlbGF5LlxuICAgKi9cbiAgYXN5bmMgX3dhaXRNcyhtcykge1xuICAgIGF3YWl0IHdhaXQobXMpXG4gIH1cblxuICAvKipcbiAgICogUmV0dXJucyB0aGUgY2xvY2sgdXNlZCBmb3IgdHJhbnNhY3Rpb24tYXR0ZW1wdCBkaWFnbm9zdGljcy5cbiAgICogQHJldHVybnMge251bWJlcn0gLSBNb25vdG9uaWMgbWlsbGlzZWNvbmRzIHdoZXJlIGF2YWlsYWJsZS5cbiAgICovXG4gIF9ub3dNcygpIHtcbiAgICByZXR1cm4gbm93TXMoKVxuICB9XG5cbiAgLyoqXG4gICAqIFN0YXJ0cyBiZXN0LWVmZm9ydCBkZWFkbG9jayBkaWFnbm9zdGljcyB3aXRob3V0IGpvaW5pbmcgdGhlIHJldHJ5IGNvbnRyb2wgZmxvdy4gU3ViY2xhc3NlcyBtYXlcbiAgICogYWRkIGJvdW5kZWQgZHJpdmVyLXNwZWNpZmljIGNvbnRleHQ7IGNhcHR1cmUgYW5kIGV2ZW50LWxpc3RlbmVyIGZhaWx1cmVzIGNhbm5vdCBhZmZlY3QgcmV0cnkuXG4gICAqIEBwYXJhbSB7e2F0dGVtcHQ6IG51bWJlciwgY29udGVudGlvbktpbmQ6IFwiZGVhZGxvY2tcIiB8IFwibG9jay13YWl0LXRpbWVvdXRcIiwgZXJyb3I6IEVycm9yLCBtYXhBdHRlbXB0czogbnVtYmVyLCB0cmFuc2FjdGlvbkF0dGVtcHREdXJhdGlvbk1zOiBudW1iZXIsIHdpbGxSZXRyeTogYm9vbGVhbn19IGFyZ3MgLSBSZXRyeSBtZXRhZGF0YS5cbiAgICogQHJldHVybnMge3ZvaWR9XG4gICAqL1xuICBfcmVwb3J0RGVhZGxvY2tSZXRyeURpYWdub3N0aWMoe2F0dGVtcHQsIGNvbnRlbnRpb25LaW5kLCBlcnJvciwgbWF4QXR0ZW1wdHMsIHRyYW5zYWN0aW9uQXR0ZW1wdER1cmF0aW9uTXMsIHdpbGxSZXRyeX0pIHtcbiAgICBsZXQgc25hcHNob3RcblxuICAgIHRyeSB7XG4gICAgICBjb25zdCBxdWVyeURpYWdub3N0aWMgPSB0aGlzLl9mYWlsZWRRdWVyeURpYWdub3N0aWNzLmdldChlcnJvcilcblxuICAgICAgc25hcHNob3QgPSBPYmplY3QuZnJlZXplKHtcbiAgICAgICAgYXR0ZW1wdCxcbiAgICAgICAgY29udGVudGlvbktpbmQsXG4gICAgICAgIGRyaXZlclR5cGU6IHRoaXMuZ2V0VHlwZSgpLFxuICAgICAgICBtYXhBdHRlbXB0cyxcbiAgICAgICAgc3RhZ2U6IFwiZGF0YWJhc2UtZGVhZGxvY2stcmV0cnlcIixcbiAgICAgICAgdHJhbnNhY3Rpb25BdHRlbXB0RHVyYXRpb25NcyxcbiAgICAgICAgd2lsbFJldHJ5LFxuICAgICAgICAuLi50aGlzLl9wb29sRGlhZ25vc3RpY0lkZW50aXR5Q29udGV4dCgpLFxuICAgICAgICAuLi50aGlzLl9vcGVyYXRpb25EaWFnbm9zdGljQ29udGV4dCgpLFxuICAgICAgICAuLi5xdWVyeURpYWdub3N0aWNcbiAgICAgIH0pXG4gICAgfSBjYXRjaCAoZGlhZ25vc3RpY0Vycm9yKSB7XG4gICAgICB0aGlzLl9yZXBvcnREZWFkbG9ja0RpYWdub3N0aWNQaXBlbGluZUZhaWx1cmUoZGlhZ25vc3RpY0Vycm9yKVxuICAgICAgcmV0dXJuXG4gICAgfVxuXG4gICAgbGV0IGRyaXZlckNvbnRleHRSZXN1bHRcblxuICAgIHRyeSB7XG4gICAgICBkcml2ZXJDb250ZXh0UmVzdWx0ID0gdGhpcy5fZGVhZGxvY2tEaWFnbm9zdGljQ29udGV4dChzbmFwc2hvdClcbiAgICB9IGNhdGNoIChkaWFnbm9zdGljRXJyb3IpIHtcbiAgICAgIHRoaXMuX3JlcG9ydERlYWRsb2NrRGlhZ25vc3RpY1BpcGVsaW5lRmFpbHVyZShkaWFnbm9zdGljRXJyb3IpXG4gICAgICByZXR1cm5cbiAgICB9XG5cbiAgICBjb25zdCBoYXNQcm9taXNlQ29udHJhY3QgPSBkcml2ZXJDb250ZXh0UmVzdWx0IGluc3RhbmNlb2YgUHJvbWlzZVxuXG4gICAgdm9pZCBQcm9taXNlLnJlc29sdmUoZHJpdmVyQ29udGV4dFJlc3VsdClcbiAgICAgIC50aGVuKChkcml2ZXJDb250ZXh0KSA9PiB7XG4gICAgICAgIGlmICghaGFzUHJvbWlzZUNvbnRyYWN0KSB0aHJvdyBuZXcgRXJyb3IoXCJEYXRhYmFzZSBkZWFkbG9jayBkaWFnbm9zdGljIGNvbnRleHQgbXVzdCByZXR1cm4gYSBQcm9taXNlXCIpXG5cbiAgICAgICAgY29uc3QgY29udGV4dCA9IHtcbiAgICAgICAgICAuLi5zbmFwc2hvdCxcbiAgICAgICAgICAuLi5kcml2ZXJDb250ZXh0XG4gICAgICAgIH1cbiAgICAgICAgY29uc3QgcGF5bG9hZCA9IHtcbiAgICAgICAgICBjb250ZXh0LFxuICAgICAgICAgIGVycm9yOiBuZXcgRXJyb3Iod2lsbFJldHJ5XG4gICAgICAgICAgICA/IGBEYXRhYmFzZSB0cmFuc2FjdGlvbiAke2NvbnRlbnRpb25LaW5kfSB3aWxsIGJlIHJldHJpZWRgXG4gICAgICAgICAgICA6IGBEYXRhYmFzZSB0cmFuc2FjdGlvbiAke2NvbnRlbnRpb25LaW5kfSBleGhhdXN0ZWQgaXRzIHJldHJ5IGJ1ZGdldGApXG4gICAgICAgIH1cbiAgICAgICAgY29uc3QgZXJyb3JFdmVudHMgPSB0aGlzLmNvbmZpZ3VyYXRpb24uZ2V0RXJyb3JFdmVudHMoKVxuXG4gICAgICAgIHRyeSB7XG4gICAgICAgICAgZXJyb3JFdmVudHMuZW1pdChcImRhdGFiYXNlLWRlYWRsb2NrLXJldHJ5XCIsIHBheWxvYWQpXG4gICAgICAgIH0gY2F0Y2ggKGV2ZW50RXJyb3IpIHtcbiAgICAgICAgICB0aGlzLmxvZ2dlci53YXJuKFwiRGF0YWJhc2UgZGVhZGxvY2sgcmV0cnkgZGlhZ25vc3RpYyBsaXN0ZW5lciBmYWlsZWRcIiwge2Vycm9yOiBldmVudEVycm9yfSlcbiAgICAgICAgfVxuXG4gICAgICAgIHRyeSB7XG4gICAgICAgICAgZXJyb3JFdmVudHMuZW1pdChcImFsbC1lcnJvclwiLCB7Li4ucGF5bG9hZCwgZXJyb3JUeXBlOiBcImRhdGFiYXNlLWRlYWRsb2NrLXJldHJ5XCJ9KVxuICAgICAgICB9IGNhdGNoIChldmVudEVycm9yKSB7XG4gICAgICAgICAgdGhpcy5sb2dnZXIud2FybihcIkRhdGFiYXNlIGRlYWRsb2NrIHJldHJ5IGFsbC1lcnJvciBsaXN0ZW5lciBmYWlsZWRcIiwge2Vycm9yOiBldmVudEVycm9yfSlcbiAgICAgICAgfVxuICAgICAgfSlcbiAgICAgIC5jYXRjaCgoZGlhZ25vc3RpY0Vycm9yKSA9PiB0aGlzLl9yZXBvcnREZWFkbG9ja0RpYWdub3N0aWNQaXBlbGluZUZhaWx1cmUoZGlhZ25vc3RpY0Vycm9yKSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSZXR1cm5zIHBvb2wgaWRlbnRpdHkgb25seSB3aGVuIHRoaXMgZHJpdmVyIHdhcyBzdGFtcGVkIGJ5IGEgcG9vbC5cbiAgICogQHJldHVybnMge3tkYXRhYmFzZUlkZW50aWZpZXI/OiBzdHJpbmcsIGRhdGFiYXNlSWRlbnRpZmllckZpbmdlcnByaW50Pzogc3RyaW5nLCBkYXRhYmFzZUlkZW50aXR5RmluZ2VycHJpbnQ/OiBzdHJpbmd9fSAtIFNhZmUgcG9vbCBpZGVudGl0eS5cbiAgICovXG4gIF9wb29sRGlhZ25vc3RpY0lkZW50aXR5Q29udGV4dCgpIHtcbiAgICBpZiAodGhpcy5fZGF0YWJhc2VJZGVudGlmaWVyID09PSB1bmRlZmluZWQgfHwgIXRoaXMuX2RhdGFiYXNlSWRlbnRpdHlGaW5nZXJwcmludCkgcmV0dXJuIHt9XG5cbiAgICBjb25zdCBpZGVudGlmaWVyRmluZ2VycHJpbnRJbnB1dCA9IHR5cGVvZiB0aGlzLl9kYXRhYmFzZUlkZW50aWZpZXIgPT09IFwic3RyaW5nXCJcbiAgICAgID8gdGhpcy5fZGF0YWJhc2VJZGVudGlmaWVyXG4gICAgICA6IGBpbnZhbGlkOiR7dHlwZW9mIHRoaXMuX2RhdGFiYXNlSWRlbnRpZmllcn1gXG4gICAgY29uc3QgZGF0YWJhc2VJZGVudGlmaWVyRmluZ2VycHJpbnQgPSBgc2hhMjU2OiR7c2hhMjU2SGV4KGBkYXRhYmFzZS1sb2dpY2FsLWlkZW50aWZpZXI6djFcXDAke2lkZW50aWZpZXJGaW5nZXJwcmludElucHV0fWApfWBcblxuICAgIHJldHVybiB7XG4gICAgICBkYXRhYmFzZUlkZW50aWZpZXI6IFJFREFDVEVEX0RJQUdOT1NUSUNfTEFCRUwsXG4gICAgICBkYXRhYmFzZUlkZW50aWZpZXJGaW5nZXJwcmludCxcbiAgICAgIGRhdGFiYXNlSWRlbnRpdHlGaW5nZXJwcmludDogdGhpcy5fZGF0YWJhc2VJZGVudGl0eUZpbmdlcnByaW50XG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIEJ1aWxkcyB0aGUgYm91bmRlZCBvcGVyYXRpb24gcG9ydGlvbiBvZiBhbiBpbW11dGFibGUgcmV0cnkgc25hcHNob3QuXG4gICAqIEByZXR1cm5zIHt7b3BlcmF0aW9uTmFtZT86IHN0cmluZywgb3BlcmF0aW9uTmFtZUZpbmdlcnByaW50Pzogc3RyaW5nfX0gLSBTYWZlIG9wZXJhdGlvbiBmaWVsZHMuXG4gICAqL1xuICBfb3BlcmF0aW9uRGlhZ25vc3RpY0NvbnRleHQoKSB7XG4gICAgY29uc3QgcmF3T3BlcmF0aW9uTmFtZSA9IHRoaXMuX2Nvbm5lY3Rpb25DaGVja291dE5hbWVcblxuICAgIGlmIChyYXdPcGVyYXRpb25OYW1lID09PSB1bmRlZmluZWQpIHJldHVybiB7fVxuICAgIGlmICh0eXBlb2YgcmF3T3BlcmF0aW9uTmFtZSAhPT0gXCJzdHJpbmdcIikge1xuICAgICAgcmV0dXJuIHtcbiAgICAgICAgb3BlcmF0aW9uTmFtZTogUkVEQUNURURfRElBR05PU1RJQ19MQUJFTCxcbiAgICAgICAgb3BlcmF0aW9uTmFtZUZpbmdlcnByaW50OiBgc2hhMjU2OiR7c2hhMjU2SGV4KGBkYXRhYmFzZS1vcGVyYXRpb246djFcXDBpbnZhbGlkOiR7dHlwZW9mIHJhd09wZXJhdGlvbk5hbWV9YCl9YFxuICAgICAgfVxuICAgIH1cblxuICAgIGNvbnN0IHNjYW5uZWRPcGVyYXRpb25OYW1lID0gcmF3T3BlcmF0aW9uTmFtZS5zbGljZSgwLCBPUEVSQVRJT05fTkFNRV9TQ0FOX0xJTUlUKVxuICAgIGNvbnN0IG9wZXJhdGlvbk5hbWVGaW5nZXJwcmludCA9IGBzaGEyNTY6JHtzaGEyNTZIZXgoYGRhdGFiYXNlLW9wZXJhdGlvbjp2MVxcMCR7c2Nhbm5lZE9wZXJhdGlvbk5hbWV9XFwwbGVuZ3RoOiR7cmF3T3BlcmF0aW9uTmFtZS5sZW5ndGh9YCl9YFxuXG4gICAgcmV0dXJuIHtcbiAgICAgIG9wZXJhdGlvbk5hbWU6IFJFREFDVEVEX0RJQUdOT1NUSUNfTEFCRUwsXG4gICAgICBvcGVyYXRpb25OYW1lRmluZ2VycHJpbnRcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogUmVwb3J0cyBhbiB1bmV4cGVjdGVkIGRldGFjaGVkIGRpYWdub3N0aWNzIGZhaWx1cmUgd2l0aG91dCBjaGFuZ2luZyB0cmFuc2FjdGlvbiBjb250cm9sIGZsb3cuXG4gICAqIEBwYXJhbSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59IGRpYWdub3N0aWNFcnJvciAtIERpYWdub3N0aWNzIGZhaWx1cmUuXG4gICAqIEByZXR1cm5zIHt2b2lkfVxuICAgKi9cbiAgX3JlcG9ydERlYWRsb2NrRGlhZ25vc3RpY1BpcGVsaW5lRmFpbHVyZShkaWFnbm9zdGljRXJyb3IpIHtcbiAgICBjb25zdCBub3JtYWxpemVkRXJyb3IgPSBkaWFnbm9zdGljRXJyb3IgaW5zdGFuY2VvZiBFcnJvclxuICAgICAgPyBkaWFnbm9zdGljRXJyb3JcbiAgICAgIDogbmV3IEVycm9yKFwiRGF0YWJhc2UgZGVhZGxvY2sgcmV0cnkgZGlhZ25vc3RpYyBmYWlsZWRcIiwge2NhdXNlOiBkaWFnbm9zdGljRXJyb3J9KVxuICAgIGNvbnN0IHBheWxvYWQgPSB7XG4gICAgICBjb250ZXh0OiB7c3RhZ2U6IFwiZGF0YWJhc2UtZGVhZGxvY2stcmV0cnktZGlhZ25vc3RpY1wifSxcbiAgICAgIGVycm9yOiBub3JtYWxpemVkRXJyb3JcbiAgICB9XG4gICAgbGV0IGVycm9yRXZlbnRzXG5cbiAgICB0cnkge1xuICAgICAgZXJyb3JFdmVudHMgPSB0aGlzLmNvbmZpZ3VyYXRpb24uZ2V0RXJyb3JFdmVudHMoKVxuICAgIH0gY2F0Y2ggKHJlcG9ydGluZ0Vycm9yKSB7XG4gICAgICB0aGlzLmxvZ2dlci53YXJuKFwiRGF0YWJhc2UgZGVhZGxvY2sgcmV0cnkgZGlhZ25vc3RpYyBwaXBlbGluZSByZXBvcnRpbmcgZmFpbGVkXCIsIHtlcnJvcjogbm9ybWFsaXplZEVycm9yLCByZXBvcnRpbmdFcnJvcn0pXG4gICAgICByZXR1cm5cbiAgICB9XG5cbiAgICB0cnkge1xuICAgICAgZXJyb3JFdmVudHMuZW1pdChcImZyYW1ld29yay1lcnJvclwiLCBwYXlsb2FkKVxuICAgIH0gY2F0Y2ggKHJlcG9ydGluZ0Vycm9yKSB7XG4gICAgICB0aGlzLmxvZ2dlci53YXJuKFwiRGF0YWJhc2UgZGVhZGxvY2sgcmV0cnkgZnJhbWV3b3JrLWVycm9yIGxpc3RlbmVyIGZhaWxlZFwiLCB7ZXJyb3I6IG5vcm1hbGl6ZWRFcnJvciwgcmVwb3J0aW5nRXJyb3J9KVxuICAgIH1cblxuICAgIHRyeSB7XG4gICAgICBlcnJvckV2ZW50cy5lbWl0KFwiYWxsLWVycm9yXCIsIHsuLi5wYXlsb2FkLCBlcnJvclR5cGU6IFwiZnJhbWV3b3JrLWVycm9yXCJ9KVxuICAgIH0gY2F0Y2ggKHJlcG9ydGluZ0Vycm9yKSB7XG4gICAgICB0aGlzLmxvZ2dlci53YXJuKFwiRGF0YWJhc2UgZGVhZGxvY2sgcmV0cnkgYWxsLWVycm9yIGxpc3RlbmVyIGZhaWxlZFwiLCB7ZXJyb3I6IG5vcm1hbGl6ZWRFcnJvciwgcmVwb3J0aW5nRXJyb3J9KVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBCdWlsZHMgZHJpdmVyLXNwZWNpZmljIGRlYWRsb2NrIGNvbnRleHQuIFRoZSBiYXNlIGRyaXZlciBoYXMgbm8gc2VydmVyIGRpYWdub3N0aWMgc291cmNlLlxuICAgKiBAcGFyYW0ge0RlYWRsb2NrUmV0cnlEaWFnbm9zdGljU25hcHNob3R9IF9zbmFwc2hvdCAtIEltbXV0YWJsZSByZXRyeSBzbmFwc2hvdC5cbiAgICogQHJldHVybnMge1Byb21pc2U8UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+Pn0gLSBTYWZlIGNvbnRleHQgZmllbGRzLlxuICAgKi9cbiAgYXN5bmMgX2RlYWRsb2NrRGlhZ25vc3RpY0NvbnRleHQoX3NuYXBzaG90KSB7XG4gICAgcmV0dXJuIHt9XG4gIH1cblxuICAvKipcbiAgICogUnVucyBhIHNpbmdsZSB0cmFuc2FjdGlvbiBhdHRlbXB0OiBzdGFydHMgYSB0cmFuc2FjdGlvbiAob3IgYSBzYXZlcG9pbnQgd2hlbiBuZXN0ZWQpLCBydW5zXG4gICAqIGBjYWxsYmFja2AsIGFuZCBjb21taXRzIOKAlCByb2xsaW5nIGJhY2sgb24gZXJyb3IuIHtAbGluayB0cmFuc2FjdGlvbn0gd3JhcHMgdGhpcyB3aXRoIGRlYWRsb2NrXG4gICAqIHJldHJ5IGF0IHRoZSBvdXRlcm1vc3QgbGV2ZWwuXG4gICAqIEB0ZW1wbGF0ZSBUXG4gICAqIEBwYXJhbSB7KCkgPT4gUHJvbWlzZTxUPn0gY2FsbGJhY2sgLSBDYWxsYmFjayBmdW5jdGlvbi5cbiAgICogQHBhcmFtIHtQaWNrPFF1ZXJ5T3B0aW9ucywgXCJvcGVyYXRpb25Pd25lclwiPn0gb3B0aW9ucyAtIFRyYW5zYWN0aW9uIG93bmVyc2hpcC5cbiAgICogQHJldHVybnMge1Byb21pc2U8UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSAtIFJlc29sdmVzIHdpdGggdGhlIHRyYW5zYWN0aW9uIHJlc3VsdC5cbiAgICovXG4gIGFzeW5jIF9ydW5UcmFuc2FjdGlvbkF0dGVtcHQoY2FsbGJhY2ssIG9wdGlvbnMpIHtcbiAgICBjb25zdCBzYXZlUG9pbnROYW1lID0gdGhpcy5nZW5lcmF0ZVNhdmVQb2ludE5hbWUoKVxuICAgIC8qKiBAdHlwZSB7VHJhbnNhY3Rpb25DYWxsYmFja0ZyYW1lfSAqL1xuICAgIGNvbnN0IGNhbGxiYWNrRnJhbWUgPSB7XG4gICAgICBhZnRlckNvbW1pdENhbGxiYWNrczogW10sXG4gICAgICBiZWZvcmVDb21taXRDYWxsYmFja3M6IFtdXG4gICAgfVxuICAgIGxldCB0cmFuc2FjdGlvblN0YXJ0ZWQgPSBmYWxzZVxuICAgIGxldCBzYXZlUG9pbnRTdGFydGVkID0gZmFsc2VcblxuICAgIHRoaXMuX3RyYW5zYWN0aW9uQ2FsbGJhY2tGcmFtZXMucHVzaChjYWxsYmFja0ZyYW1lKVxuXG4gICAgdHJ5IHtcbiAgICAgIGlmICh0aGlzLl90cmFuc2FjdGlvbnNDb3VudCA9PSAwKSB7XG4gICAgICAgIHRoaXMubG9nZ2VyLmRlYnVnKFwiU3RhcnQgdHJhbnNhY3Rpb25cIilcbiAgICAgICAgYXdhaXQgdGhpcy5zdGFydFRyYW5zYWN0aW9uKG9wdGlvbnMpXG4gICAgICAgIHRyYW5zYWN0aW9uU3RhcnRlZCA9IHRydWVcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIHRoaXMubG9nZ2VyLmRlYnVnKFwiU3RhcnQgc2F2ZXBvaW50XCIsIHNhdmVQb2ludE5hbWUpXG4gICAgICAgIGF3YWl0IHRoaXMuc3RhcnRTYXZlUG9pbnQoc2F2ZVBvaW50TmFtZSwgb3B0aW9ucylcbiAgICAgICAgc2F2ZVBvaW50U3RhcnRlZCA9IHRydWVcbiAgICAgIH1cbiAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgdGhpcy5fdHJhbnNhY3Rpb25DYWxsYmFja0ZyYW1lcy5wb3AoKVxuICAgICAgdGhyb3cgZXJyb3JcbiAgICB9XG5cbiAgICBsZXQgcmVzdWx0XG5cbiAgICB0cnkge1xuICAgICAgcmVzdWx0ID0gYXdhaXQgY2FsbGJhY2soKVxuICAgICAgYXdhaXQgdGhpcy5fcnVuQmVmb3JlQ29tbWl0Q2FsbGJhY2tzKGNhbGxiYWNrRnJhbWUpXG5cbiAgICAgIGlmIChzYXZlUG9pbnRTdGFydGVkKSB7XG4gICAgICAgIHRoaXMubG9nZ2VyLmRlYnVnKFwiUmVsZWFzZSBzYXZlcG9pbnRcIiwgc2F2ZVBvaW50TmFtZSlcbiAgICAgICAgYXdhaXQgdGhpcy5yZWxlYXNlU2F2ZVBvaW50KHNhdmVQb2ludE5hbWUsIG9wdGlvbnMpXG4gICAgICB9XG5cbiAgICAgIGlmICh0cmFuc2FjdGlvblN0YXJ0ZWQpIHtcbiAgICAgICAgdGhpcy5sb2dnZXIuZGVidWcoXCJDb21taXQgdHJhbnNhY3Rpb25cIilcbiAgICAgICAgYXdhaXQgdGhpcy5jb21taXRUcmFuc2FjdGlvbihvcHRpb25zKVxuICAgICAgfVxuICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICBpZiAoZXJyb3IgaW5zdGFuY2VvZiBFcnJvcikge1xuICAgICAgICB0aGlzLmxvZ2dlci5kZWJ1ZyhcIlRyYW5zYWN0aW9uIGVycm9yXCIsIGVycm9yLm1lc3NhZ2UpXG4gICAgICB9IGVsc2Uge1xuICAgICAgICB0aGlzLmxvZ2dlci5kZWJ1ZyhcIlRyYW5zYWN0aW9uIGVycm9yXCIsIGVycm9yKVxuICAgICAgfVxuXG4gICAgICB0cnkge1xuICAgICAgICBsZXQgdHJhbnNhY3Rpb25Sb2xsZWRCYWNrID0gZmFsc2VcblxuICAgICAgICBpZiAoc2F2ZVBvaW50U3RhcnRlZCkge1xuICAgICAgICAgIHRoaXMubG9nZ2VyLmRlYnVnKFwiUm9sbGJhY2sgc2F2ZXBvaW50XCIsIHNhdmVQb2ludE5hbWUpXG4gICAgICAgICAgdHJ5IHtcbiAgICAgICAgICAgIGF3YWl0IHRoaXMucm9sbGJhY2tTYXZlUG9pbnQoc2F2ZVBvaW50TmFtZSwgb3B0aW9ucylcbiAgICAgICAgICB9IGNhdGNoIChzYXZlUG9pbnRFcnJvcikge1xuICAgICAgICAgICAgY29uc3QgbWVzc2FnZSA9IHNhdmVQb2ludEVycm9yIGluc3RhbmNlb2YgRXJyb3IgPyBzYXZlUG9pbnRFcnJvci5tZXNzYWdlIDogYCR7c2F2ZVBvaW50RXJyb3J9YFxuXG4gICAgICAgICAgICAvLyBNeVNRTCBzb21ldGltZXMgZHJvcHMgc2F2ZXBvaW50cyB1bmV4cGVjdGVkbHk7IGZhbGwgYmFjayB0byByb2xsaW5nIGJhY2sgdGhlIGZ1bGwgdHJhbnNhY3Rpb25cbiAgICAgICAgICAgIGlmIChtZXNzYWdlLmluY2x1ZGVzKFwiU0FWRVBPSU5UXCIpIHx8IG1lc3NhZ2UuaW5jbHVkZXMoXCJFUl9TUF9ET0VTX05PVF9FWElTVFwiKSkge1xuICAgICAgICAgICAgICB0aGlzLmxvZ2dlci5kZWJ1ZyhcIlNhdmVwb2ludCByb2xsYmFjayBmYWlsZWQ7IHJvbGxpbmcgYmFjayBlbnRpcmUgdHJhbnNhY3Rpb24gaW5zdGVhZFwiKVxuICAgICAgICAgICAgICBhd2FpdCB0aGlzLnJvbGxiYWNrVHJhbnNhY3Rpb24ob3B0aW9ucylcbiAgICAgICAgICAgICAgdHJhbnNhY3Rpb25Sb2xsZWRCYWNrID0gdHJ1ZVxuICAgICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgICAgdGhyb3cgc2F2ZVBvaW50RXJyb3JcbiAgICAgICAgICAgIH1cbiAgICAgICAgICB9XG4gICAgICAgIH1cblxuICAgICAgICAvLyBPbmx5IHJvbGwgYmFjayBpZiBhIHRyYW5zYWN0aW9uIGlzIHN0aWxsIG9wZW4uIEEgbmVzdGVkIHNhdmVwb2ludCB3aG9zZSByb2xsYmFjayBmYWlsZWRcbiAgICAgICAgLy8gZmFsbHMgYmFjayB0byByb2xsaW5nIGJhY2sgdGhlIHdob2xlIHRyYW5zYWN0aW9uIChhYm92ZSksIHdoaWNoIGFscmVhZHkgY2xvc2VkIGl0IGFuZFxuICAgICAgICAvLyBkcm9wcGVkIHRoZSBjb3VudCB0byAwOyByb2xsaW5nIGJhY2sgYWdhaW4gaGVyZSB3b3VsZCBpc3N1ZSBhIHNlY29uZCBST0xMQkFDSyBhbmQgZHJpdmVcbiAgICAgICAgLy8gYF90cmFuc2FjdGlvbnNDb3VudGAgYmVsb3cgemVybywgd2hpY2ggd291bGQgdGhlbiBkZWZlYXQgdGhlIG91dGVybW9zdCBkZWFkbG9jay1yZXRyeSBndWFyZC5cbiAgICAgICAgaWYgKHRyYW5zYWN0aW9uU3RhcnRlZCAmJiAhdHJhbnNhY3Rpb25Sb2xsZWRCYWNrICYmIHRoaXMuX3RyYW5zYWN0aW9uc0NvdW50ID4gMCkge1xuICAgICAgICAgIHRoaXMubG9nZ2VyLmRlYnVnKFwiUm9sbGJhY2sgdHJhbnNhY3Rpb25cIilcbiAgICAgICAgICBhd2FpdCB0aGlzLnJvbGxiYWNrVHJhbnNhY3Rpb24ob3B0aW9ucylcbiAgICAgICAgfVxuICAgICAgfSBmaW5hbGx5IHtcbiAgICAgICAgdGhpcy5fdHJhbnNhY3Rpb25DYWxsYmFja0ZyYW1lcy5wb3AoKVxuICAgICAgfVxuXG4gICAgICB0aHJvdyBlcnJvclxuICAgIH1cblxuICAgIHRyeSB7XG4gICAgICBhd2FpdCB0aGlzLl9jb21taXRUcmFuc2FjdGlvbkNhbGxiYWNrRnJhbWUoKVxuICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICB0aHJvdyBuZXcgVmVsb2Npb3VzRGF0YWJhc2VBZnRlckNvbW1pdENhbGxiYWNrRXJyb3IoZXJyb3IpXG4gICAgfVxuXG4gICAgcmV0dXJuIHJlc3VsdFxuICB9XG5cbiAgLyoqXG4gICAqIFJlZ2lzdGVycyBhIGd1YXJkIHRvIHJ1biBhZnRlciB0aGUgY3VycmVudCB0cmFuc2FjdGlvbiBjYWxsYmFjayBzdWNjZWVkcyBhbmQgYmVmb3JlIGl0c1xuICAgKiBvdXRlciBjb21taXQgb3IgbmVzdGVkIHNhdmVwb2ludCByZWxlYXNlLlxuICAgKiBAcGFyYW0geygpID0+IHZvaWQgfCBQcm9taXNlPHZvaWQ+fSBjYWxsYmFjayAtIEd1YXJkIGNhbGxiYWNrLlxuICAgKiBAcGFyYW0ge1BpY2s8UXVlcnlPcHRpb25zLCBcIm9wZXJhdGlvbk93bmVyXCI+fSBbb3B0aW9uc10gLSBDYWxsYmFjayBvd25lcnNoaXAuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIHdoZW4gdGhlIGd1YXJkIGhhcyBiZWVuIHJlZ2lzdGVyZWQuXG4gICAqL1xuICBhc3luYyBiZWZvcmVDb21taXQoY2FsbGJhY2ssIG9wdGlvbnMgPSB7fSkge1xuICAgIGF3YWl0IHRoaXMuX3dhaXRGb3JPcGVyYXRpb25MZWFzZShvcHRpb25zLm9wZXJhdGlvbk93bmVyKVxuXG4gICAgY29uc3QgY3VycmVudEZyYW1lID0gdGhpcy5fdHJhbnNhY3Rpb25DYWxsYmFja0ZyYW1lc1t0aGlzLl90cmFuc2FjdGlvbkNhbGxiYWNrRnJhbWVzLmxlbmd0aCAtIDFdXG5cbiAgICBpZiAoIWN1cnJlbnRGcmFtZSkgdGhyb3cgbmV3IEVycm9yKFwiYmVmb3JlQ29tbWl0IHJlcXVpcmVzIGFuIGFjdGl2ZSB0cmFuc2FjdGlvblwiKVxuXG4gICAgY3VycmVudEZyYW1lLmJlZm9yZUNvbW1pdENhbGxiYWNrcy5wdXNoKGNhbGxiYWNrKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgYSBjYWxsYmFjayBhZnRlciB0aGUgc3Vycm91bmRpbmcgdHJhbnNhY3Rpb24gY29tbWl0cy5cbiAgICogSWYgbm8gdHJhbnNhY3Rpb24gaXMgYWN0aXZlLCB0aGUgY2FsbGJhY2sgcnVucyBpbW1lZGlhdGVseS5cbiAgICogQHBhcmFtIHsoKSA9PiB2b2lkIHwgUHJvbWlzZTx2b2lkPn0gY2FsbGJhY2sgLSBDYWxsYmFjay5cbiAgICogQHBhcmFtIHtQaWNrPFF1ZXJ5T3B0aW9ucywgXCJvcGVyYXRpb25Pd25lclwiPn0gW29wdGlvbnNdIC0gQ2FsbGJhY2sgb3duZXJzaGlwLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyB3aGVuIHRoZSBjYWxsYmFjayBoYXMgYmVlbiByZWdpc3RlcmVkIG9yIHJ1bi5cbiAgICovXG4gIGFzeW5jIGFmdGVyQ29tbWl0KGNhbGxiYWNrLCBvcHRpb25zID0ge30pIHtcbiAgICBhd2FpdCB0aGlzLl93YWl0Rm9yT3BlcmF0aW9uTGVhc2Uob3B0aW9ucy5vcGVyYXRpb25Pd25lcilcblxuICAgIGNvbnN0IGN1cnJlbnRGcmFtZSA9IHRoaXMuX3RyYW5zYWN0aW9uQ2FsbGJhY2tGcmFtZXNbdGhpcy5fdHJhbnNhY3Rpb25DYWxsYmFja0ZyYW1lcy5sZW5ndGggLSAxXVxuXG4gICAgaWYgKCFjdXJyZW50RnJhbWUpIHtcbiAgICAgIGF3YWl0IGNhbGxiYWNrKClcbiAgICAgIHJldHVyblxuICAgIH1cblxuICAgIGN1cnJlbnRGcmFtZS5hZnRlckNvbW1pdENhbGxiYWNrcy5wdXNoKGNhbGxiYWNrKVxuICB9XG5cbiAgLyoqXG4gICAqIFdoZXRoZXIgYSB0cmFuc2FjdGlvbiBpcyBjdXJyZW50bHkgb3BlbiBvbiB0aGlzIGNvbm5lY3Rpb24uXG4gICAqIEByZXR1cm5zIHtib29sZWFufSAtIFdoZXRoZXIgaW5zaWRlIGEgdHJhbnNhY3Rpb24uXG4gICAqL1xuICBpbnNpZGVUcmFuc2FjdGlvbigpIHsgcmV0dXJuIHRoaXMuX3RyYW5zYWN0aW9uc0NvdW50ID4gMCB9XG5cbiAgLyoqXG4gICAqIFJldHVybnMgdGhlIGNvbXBsZXRpb24gcHJvbWlzZSBpZGVudGlmeWluZyB0aGUgY3VycmVudCBvdXRlciB0cmFuc2FjdGlvbi5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IFJlc29sdmVzIGFmdGVyIHRoYXQgdHJhbnNhY3Rpb24gY29tbWl0cyBvciByb2xscyBiYWNrLlxuICAgKi9cbiAgdHJhbnNhY3Rpb25Db21wbGV0aW9uKCkgeyByZXR1cm4gdGhpcy5fdHJhbnNhY3Rpb25Db21wbGV0aW9uUHJvbWlzZSB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgc3RhcnQgdHJhbnNhY3Rpb24uXG4gICAqIEBwYXJhbSB7UGljazxRdWVyeU9wdGlvbnMsIFwib3BlcmF0aW9uT3duZXJcIj59IFtvcHRpb25zXSAtIFRyYW5zYWN0aW9uIG93bmVyc2hpcC5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgd2hlbiBjb21wbGV0ZS5cbiAgICovXG4gIGFzeW5jIHN0YXJ0VHJhbnNhY3Rpb24ob3B0aW9ucyA9IHt9KSB7XG4gICAgYXdhaXQgY29vcmRpbmF0ZVNoYXJlZFRyYW5zYWN0aW9uQ29ubmVjdGlvbih0aGlzLCBhc3luYyAoKSA9PiB7XG4gICAgICB3aGlsZSAodHJ1ZSkge1xuICAgICAgICAvKiogQHR5cGUge2ltcG9ydChcIi4uL29wZXJhdGlvbi1sZWFzZS5qc1wiKS5kZWZhdWx0IHwgdW5kZWZpbmVkfSAqL1xuICAgICAgICBsZXQgYmxvY2tpbmdPcGVyYXRpb25MZWFzZVxuXG4gICAgICAgIGF3YWl0IHRoaXMuX3RyYW5zYWN0aW9uc0FjdGlvbnNNdXRleC5zeW5jKGFzeW5jICgpID0+IHtcbiAgICAgICAgICBjb25zdCBvcGVyYXRpb25MZWFzZSA9IHRoaXMuX29wZXJhdGlvbkxlYXNlXG5cbiAgICAgICAgICBpZiAob3BlcmF0aW9uTGVhc2UgJiYgb3B0aW9ucy5vcGVyYXRpb25Pd25lciAhPT0gb3BlcmF0aW9uTGVhc2Uub3duZXIpIHtcbiAgICAgICAgICAgIGJsb2NraW5nT3BlcmF0aW9uTGVhc2UgPSBvcGVyYXRpb25MZWFzZVxuICAgICAgICAgICAgcmV0dXJuXG4gICAgICAgICAgfVxuXG4gICAgICAgICAgYXdhaXQgdGhpcy5fcnVuUHJvZmlsZWRUcmFuc2FjdGlvbkFjdGlvbihcInN0YXJ0XCIsIGFzeW5jICgpID0+IHtcbiAgICAgICAgICAgIGF3YWl0IHRoaXMuX3N0YXJ0VHJhbnNhY3Rpb25BY3Rpb24ob3B0aW9ucylcbiAgICAgICAgICB9KVxuICAgICAgICAgIHRoaXMuX3RyYW5zYWN0aW9uc0NvdW50KytcblxuICAgICAgICAgIGlmICh0aGlzLl90cmFuc2FjdGlvbnNDb3VudCA9PT0gMSkge1xuICAgICAgICAgICAgdGhpcy5fdHJhbnNhY3Rpb25Db21wbGV0aW9uUHJvbWlzZSA9IG5ldyBQcm9taXNlKChyZXNvbHZlKSA9PiB7XG4gICAgICAgICAgICAgIHRoaXMuX3Jlc29sdmVUcmFuc2FjdGlvbkNvbXBsZXRpb24gPSByZXNvbHZlXG4gICAgICAgICAgICB9KVxuICAgICAgICAgIH1cbiAgICAgICAgfSlcblxuICAgICAgICBpZiAoIWJsb2NraW5nT3BlcmF0aW9uTGVhc2UpIHJldHVyblxuXG4gICAgICAgIGF3YWl0IGJsb2NraW5nT3BlcmF0aW9uTGVhc2Uud2FpdChvcHRpb25zLm9wZXJhdGlvbk93bmVyKVxuICAgICAgfVxuICAgIH0sIG9wdGlvbnMub3BlcmF0aW9uT3duZXIpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBzdGFydCB0cmFuc2FjdGlvbiBhY3Rpb24uXG4gICAqIEBwYXJhbSB7UGljazxRdWVyeU9wdGlvbnMsIFwib3BlcmF0aW9uT3duZXJcIj59IFtvcHRpb25zXSAtIFRyYW5zYWN0aW9uIG93bmVyc2hpcC5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgd2hlbiBjb21wbGV0ZS5cbiAgICovXG4gIGFzeW5jIF9zdGFydFRyYW5zYWN0aW9uQWN0aW9uKG9wdGlvbnMgPSB7fSkge1xuICAgIGF3YWl0IHRoaXMucXVlcnkoXCJCRUdJTiBUUkFOU0FDVElPTlwiLCBvcHRpb25zKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgY29tbWl0IHRyYW5zYWN0aW9uLlxuICAgKiBAcGFyYW0ge1BpY2s8UXVlcnlPcHRpb25zLCBcIm9wZXJhdGlvbk93bmVyXCI+fSBbb3B0aW9uc10gLSBUcmFuc2FjdGlvbiBvd25lcnNoaXAuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIHdoZW4gY29tcGxldGUuXG4gICAqL1xuICBhc3luYyBjb21taXRUcmFuc2FjdGlvbihvcHRpb25zID0ge30pIHtcbiAgICBhd2FpdCBjb29yZGluYXRlU2hhcmVkVHJhbnNhY3Rpb25Db25uZWN0aW9uKHRoaXMsIGFzeW5jICgpID0+IHtcbiAgICAgIGF3YWl0IHRoaXMuX3RyYW5zYWN0aW9uc0FjdGlvbnNNdXRleC5zeW5jKGFzeW5jICgpID0+IHtcbiAgICAgICAgYXdhaXQgdGhpcy5fcnVuUHJvZmlsZWRUcmFuc2FjdGlvbkFjdGlvbihcImNvbW1pdFwiLCBhc3luYyAoKSA9PiB7XG4gICAgICAgICAgYXdhaXQgdGhpcy5fY29tbWl0VHJhbnNhY3Rpb25BY3Rpb24ob3B0aW9ucylcbiAgICAgICAgfSlcbiAgICAgICAgdGhpcy5fdHJhbnNhY3Rpb25zQ291bnQtLVxuICAgICAgICB0aGlzLl9yZXNvbHZlQ29tcGxldGVkVHJhbnNhY3Rpb24oKVxuICAgICAgfSlcbiAgICB9LCBvcHRpb25zLm9wZXJhdGlvbk93bmVyKVxuICB9XG5cbiAgLyoqIFJlc29sdmVzIHRoZSBjdXJyZW50IG91dGVyIHRyYW5zYWN0aW9uIGNvbXBsZXRpb24gd2hlbiBpdCBoYXMgZmluaXNoZWQuICovXG4gIF9yZXNvbHZlQ29tcGxldGVkVHJhbnNhY3Rpb24oKSB7XG4gICAgaWYgKHRoaXMuX3RyYW5zYWN0aW9uc0NvdW50ICE9PSAwKSByZXR1cm5cblxuICAgIGNvbnN0IHJlc29sdmUgPSB0aGlzLl9yZXNvbHZlVHJhbnNhY3Rpb25Db21wbGV0aW9uXG5cbiAgICB0aGlzLl9yZXNvbHZlVHJhbnNhY3Rpb25Db21wbGV0aW9uID0gdW5kZWZpbmVkXG4gICAgaWYgKHJlc29sdmUpIHJlc29sdmUoKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgY29tbWl0IHRyYW5zYWN0aW9uIGFjdGlvbi5cbiAgICogQHBhcmFtIHtQaWNrPFF1ZXJ5T3B0aW9ucywgXCJvcGVyYXRpb25Pd25lclwiPn0gW29wdGlvbnNdIC0gVHJhbnNhY3Rpb24gb3duZXJzaGlwLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyB3aGVuIGNvbXBsZXRlLlxuICAgKi9cbiAgYXN5bmMgX2NvbW1pdFRyYW5zYWN0aW9uQWN0aW9uKG9wdGlvbnMgPSB7fSkge1xuICAgIGF3YWl0IHRoaXMucXVlcnkoXCJDT01NSVRcIiwgb3B0aW9ucylcbiAgfVxuXG4gIC8qKlxuICAgKiBUaW1lcyBhIHBoeXNpY2FsIHRyYW5zYWN0aW9uIGFjdGlvbiBvbmx5IHdoZW4gdGVzdCBwcm9maWxpbmcgaXMgYWN0aXZlLlxuICAgKiBAdGVtcGxhdGUgVFxuICAgKiBAcGFyYW0ge1wic3RhcnRcIiB8IFwiY29tbWl0XCIgfCBcInJvbGxiYWNrXCJ9IGFjdGlvbiAtIFRyYW5zYWN0aW9uIGFjdGlvbi5cbiAgICogQHBhcmFtIHsoKSA9PiBQcm9taXNlPFQ+fSBjYWxsYmFjayAtIFBoeXNpY2FsIGFjdGlvbiBjYWxsYmFjay5cbiAgICogQHJldHVybnMge1Byb21pc2U8VD59IC0gQ2FsbGJhY2sgcmVzdWx0LlxuICAgKi9cbiAgYXN5bmMgX3J1blByb2ZpbGVkVHJhbnNhY3Rpb25BY3Rpb24oYWN0aW9uLCBjYWxsYmFjaykge1xuICAgIGNvbnN0IHByb2ZpbGVDb250ZXh0ID0gY3VycmVudFRlc3RQcm9maWxlQ29udGV4dCh0aGlzLmNvbmZpZ3VyYXRpb24pXG5cbiAgICBpZiAoIXByb2ZpbGVDb250ZXh0KSByZXR1cm4gYXdhaXQgY2FsbGJhY2soKVxuXG4gICAgY29uc3Qgc3RhcnRlZEF0TXMgPSBub3dNcygpXG4gICAgbGV0IGZhaWxlZCA9IHRydWVcblxuICAgIHRyeSB7XG4gICAgICBjb25zdCByZXN1bHQgPSBhd2FpdCBjYWxsYmFjaygpXG5cbiAgICAgIGZhaWxlZCA9IGZhbHNlXG4gICAgICByZXR1cm4gcmVzdWx0XG4gICAgfSBmaW5hbGx5IHtcbiAgICAgIHByb2ZpbGVDb250ZXh0LnByb2ZpbGVyLnJlY29yZERhdGFiYXNlVHJhbnNhY3Rpb24ocHJvZmlsZUNvbnRleHQsIHtcbiAgICAgICAgYWN0aW9uLFxuICAgICAgICBkdXJhdGlvbk1zOiBub3dNcygpIC0gc3RhcnRlZEF0TXMsXG4gICAgICAgIGZhaWxlZFxuICAgICAgfSlcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogU3RhcnRzIGFuIG9wdGlvbmFsIHBoeXNpY2FsLXF1ZXJ5IHByb2ZpbGUgYXR0ZW1wdCB3aXRob3V0IHJldGFpbmluZyBTUUwuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBzcWwgLSBPcmlnaW5hbCBTUUwgdXNlZCBvbmx5IHRvIGRlcml2ZSBpdHMgcmVkYWN0ZWQgZGlhZ25vc3RpYy5cbiAgICogQHJldHVybnMge1Rlc3RQcm9maWxlUXVlcnlBdHRlbXB0IHwgdW5kZWZpbmVkfSAtIEFjdGl2ZSBwcm9maWxlIGhhbmRsZS5cbiAgICovXG4gIF9zdGFydFByb2ZpbGVkUXVlcnlBdHRlbXB0KHNxbCkge1xuICAgIGNvbnN0IGNvbnRleHQgPSBjdXJyZW50VGVzdFByb2ZpbGVDb250ZXh0KHRoaXMuY29uZmlndXJhdGlvbilcblxuICAgIGlmICghY29udGV4dCkgcmV0dXJuIHVuZGVmaW5lZFxuXG4gICAgcmV0dXJuIHtcbiAgICAgIGNvbnRleHQsXG4gICAgICBkaWFnbm9zdGljOiBzcWxEaWFnbm9zdGljKHNxbCksXG4gICAgICBzdGFydGVkQXRNczogbm93TXMoKVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBDb21wbGV0ZXMgYW4gb3B0aW9uYWwgcGh5c2ljYWwtcXVlcnkgcHJvZmlsZSBhdHRlbXB0LlxuICAgKiBAcGFyYW0ge1Rlc3RQcm9maWxlUXVlcnlBdHRlbXB0IHwgdW5kZWZpbmVkfSBhdHRlbXB0IC0gUHJvZmlsZSBoYW5kbGUuXG4gICAqIEBwYXJhbSB7Ym9vbGVhbn0gZmFpbGVkIC0gV2hldGhlciB0aGUgcGh5c2ljYWwgZHJpdmVyIGNhbGwgZmFpbGVkLlxuICAgKiBAcmV0dXJucyB7dm9pZH1cbiAgICovXG4gIF9maW5pc2hQcm9maWxlZFF1ZXJ5QXR0ZW1wdChhdHRlbXB0LCBmYWlsZWQpIHtcbiAgICBpZiAoIWF0dGVtcHQpIHJldHVyblxuXG4gICAgYXR0ZW1wdC5jb250ZXh0LnByb2ZpbGVyLnJlY29yZERhdGFiYXNlUXVlcnkoYXR0ZW1wdC5jb250ZXh0LCB7XG4gICAgICBkdXJhdGlvbk1zOiBub3dNcygpIC0gYXR0ZW1wdC5zdGFydGVkQXRNcyxcbiAgICAgIGZhaWxlZCxcbiAgICAgIC4uLmF0dGVtcHQuZGlhZ25vc3RpY1xuICAgIH0pXG4gIH1cblxuICAvKipcbiAgICogUnVucyBldmVyeSBndWFyZCByZWdpc3RlcmVkIHRvIHRoZSB0cmFuc2FjdGlvbiBmcmFtZS5cbiAgICogQHBhcmFtIHtUcmFuc2FjdGlvbkNhbGxiYWNrRnJhbWV9IGNhbGxiYWNrRnJhbWUgLSBGcmFtZSB3aG9zZSBndWFyZHMgYXJlIGNvbXBsZXRpbmcuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIHdoZW4gZXZlcnkgZ3VhcmQgYWNjZXB0cyB0aGUgY29tbWl0LlxuICAgKi9cbiAgYXN5bmMgX3J1bkJlZm9yZUNvbW1pdENhbGxiYWNrcyhjYWxsYmFja0ZyYW1lKSB7XG4gICAgZm9yIChjb25zdCBjYWxsYmFjayBvZiBjYWxsYmFja0ZyYW1lLmJlZm9yZUNvbW1pdENhbGxiYWNrcykge1xuICAgICAgYXdhaXQgY2FsbGJhY2soKVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBNZXJnZXMgY29tbWl0dGVkIGNhbGxiYWNrcyBpbnRvIHRoZSBwYXJlbnQgdHJhbnNhY3Rpb24gZnJhbWUgb3IgcnVucyB0aGVtIHdoZW4gdGhlIG91dGVybW9zdCBjb21taXQgY29tcGxldGVzLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyB3aGVuIGNvbXBsZXRlLlxuICAgKi9cbiAgYXN5bmMgX2NvbW1pdFRyYW5zYWN0aW9uQ2FsbGJhY2tGcmFtZSgpIHtcbiAgICBjb25zdCBjb21taXR0ZWRGcmFtZSA9IHRoaXMuX3RyYW5zYWN0aW9uQ2FsbGJhY2tGcmFtZXMucG9wKClcblxuICAgIGlmICghY29tbWl0dGVkRnJhbWUgfHwgY29tbWl0dGVkRnJhbWUuYWZ0ZXJDb21taXRDYWxsYmFja3MubGVuZ3RoID09PSAwKSByZXR1cm5cblxuICAgIGNvbnN0IHBhcmVudEZyYW1lID0gdGhpcy5fdHJhbnNhY3Rpb25DYWxsYmFja0ZyYW1lc1t0aGlzLl90cmFuc2FjdGlvbkNhbGxiYWNrRnJhbWVzLmxlbmd0aCAtIDFdXG5cbiAgICBpZiAocGFyZW50RnJhbWUpIHtcbiAgICAgIHBhcmVudEZyYW1lLmFmdGVyQ29tbWl0Q2FsbGJhY2tzLnB1c2goLi4uY29tbWl0dGVkRnJhbWUuYWZ0ZXJDb21taXRDYWxsYmFja3MpXG4gICAgICByZXR1cm5cbiAgICB9XG5cbiAgICBmb3IgKGNvbnN0IGNhbGxiYWNrIG9mIGNvbW1pdHRlZEZyYW1lLmFmdGVyQ29tbWl0Q2FsbGJhY2tzKSB7XG4gICAgICBhd2FpdCBjYWxsYmFjaygpXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIFN0cmVhbXMgdGhlIHJvd3Mgb2YgYHNxbGAgb25lIGF0IGEgdGltZSBpbnN0ZWFkIG9mIGJ1ZmZlcmluZyB0aGUgd2hvbGUgcmVzdWx0IHNldCwgc28gYVxuICAgKiBjYWxsZXIgY2FuIHByb2Nlc3MgYW4gYXJiaXRyYXJpbHkgbGFyZ2UgcmVzdWx0IHdpdGggYm91bmRlZCBtZW1vcnkuIFRoaXMgYmFzZSBpbXBsZW1lbnRhdGlvblxuICAgKiBmYWxscyBiYWNrIHRvIGEgYnVmZmVyZWQge0BsaW5rIHF1ZXJ5fSBhbmQgeWllbGRzIGl0cyByb3dzOyBkcml2ZXJzIGJhY2tlZCBieSBhIGN1cnNvci1jYXBhYmxlXG4gICAqIGNsaWVudCAodGhlIE15U1FMIGRyaXZlcikgb3ZlcnJpZGUgaXQgd2l0aCB0cnVlIHNlcnZlci1zaWRlIHN0cmVhbWluZy5cbiAgICogQHBhcmFtIHtzdHJpbmd9IHNxbCAtIFNRTCBzdHJpbmcgdG8gc3RyZWFtLlxuICAgKiBAcGFyYW0ge1F1ZXJ5T3B0aW9uc30gW29wdGlvbnNdIC0gUXVlcnkgb3B0aW9ucywgYXMgZm9yIHtAbGluayBxdWVyeX0uXG4gICAqIEB5aWVsZHMge1JlY29yZDxzdHJpbmcsIHVua25vd24+fSAtIFRoZSByZXN1bHQgcm93cywgb25lIGF0IGEgdGltZS5cbiAgICovXG4gIGFzeW5jICpxdWVyeVN0cmVhbShzcWwsIG9wdGlvbnMgPSB7fSkge1xuICAgIGNvbnN0IHJvd3MgPSBhd2FpdCB0aGlzLnF1ZXJ5KHNxbCwgb3B0aW9ucylcblxuICAgIGZvciAoY29uc3Qgcm93IG9mIEFycmF5LmlzQXJyYXkocm93cykgPyByb3dzIDogW10pIHtcbiAgICAgIHlpZWxkIHJvd1xuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHF1ZXJ5LlxuICAgKiBAcGFyYW0ge3N0cmluZ30gc3FsIC0gU1FMIHN0cmluZy5cbiAgICogQHBhcmFtIHtRdWVyeU9wdGlvbnN9IFtvcHRpb25zXSAtIFF1ZXJ5IG9wdGlvbnMuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPFF1ZXJ5UmVzdWx0VHlwZT59IC0gUmVzb2x2ZXMgd2l0aCB0aGUgcXVlcnkuXG4gICAqL1xuICBhc3luYyBxdWVyeShzcWwsIG9wdGlvbnMgPSB7fSkge1xuICAgIGF3YWl0IHRoaXMuX3dhaXRGb3JPcGVyYXRpb25MZWFzZShvcHRpb25zLm9wZXJhdGlvbk93bmVyKVxuICAgIHRoaXMuX2Fzc2VydFdyaXRhYmxlUXVlcnkoc3FsKVxuXG4gICAgbGV0IHRyaWVzID0gMFxuICAgIGNvbnN0IG1heFRyaWVzID0gNVxuICAgIGNvbnN0IHJlcXVlc3RUaW1pbmcgPSB0aGlzLmNvbmZpZ3VyYXRpb24uZ2V0Q3VycmVudFJlcXVlc3RUaW1pbmcoKVxuICAgIGNvbnN0IGxvZ1F1ZXJ5ID0gb3B0aW9ucy5sb2dRdWVyeSA/PyB0aGlzLl9xdWVyeUxvZ2dpbmdFbmFibGVkKClcbiAgICBjb25zdCBzb3VyY2VTdGFjayA9IGxvZ1F1ZXJ5ID8gKG9wdGlvbnMuc291cmNlU3RhY2sgfHwgRXJyb3IoKS5zdGFjaykgOiB1bmRlZmluZWRcbiAgICBjb25zdCBxdWVyeVNxbCA9IHRoaXMuX3F1ZXJ5U3FsV2l0aFByb2Nlc3NMaXN0Q29tbWVudChzcWwsIG9wdGlvbnMpXG5cbiAgICB3aGlsZSAodHJpZXMgPCBtYXhUcmllcykge1xuICAgICAgdHJpZXMrK1xuXG4gICAgICB0cnkge1xuICAgICAgICByZXR1cm4gYXdhaXQgdGhpcy5fcXVlcnlBY3R1YWxXaXRoTG9nZ2luZyh7b3JpZ2luYWxTcWw6IHNxbCwgcXVlcnlTcWx9LCB7Li4ub3B0aW9ucywgbG9nUXVlcnksIHNvdXJjZVN0YWNrfSwgcmVxdWVzdFRpbWluZywgdHJpZXMpXG4gICAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgICBpZiAoIShlcnJvciBpbnN0YW5jZW9mIEVycm9yKSkgdGhyb3cgZXJyb3JcblxuICAgICAgICB0aGlzLl9mYWlsZWRRdWVyeURpYWdub3N0aWNzLnNldChlcnJvciwgc3FsRGlhZ25vc3RpYyhzcWwpKVxuXG4gICAgICAgIC8vIEEgZGVsaWJlcmF0ZWx5LWFib3J0ZWQgcXVlcnkgbXVzdCBuZXZlciBiZSBzaWxlbnRseSByZS1ydW4g4oCUIGl0c1xuICAgICAgICAvLyBjb25uZWN0aW9uIHdhcyBkZXN0cm95ZWQgb24gcHVycG9zZSwgc28gdHJlYXQgaXQgYXMgdGVybWluYWwuXG4gICAgICAgIGlmIChlcnJvciBpbnN0YW5jZW9mIFF1ZXJ5QWJvcnRlZEVycm9yKSB0aHJvdyBlcnJvclxuXG4gICAgICAgIGNvbnN0IHJldHJ5SW5mbyA9IHRoaXMucmV0cnlhYmxlRGF0YWJhc2VFcnJvcihlcnJvcilcblxuICAgICAgICBpZiAob3B0aW9ucy5yZXRyeSAhPT0gZmFsc2UgJiYgdHJpZXMgPCBtYXhUcmllcyAmJiByZXRyeUluZm8ucmV0cnkpIHtcbiAgICAgICAgICBpZiAocmV0cnlJbmZvLnJlY29ubmVjdCkge1xuICAgICAgICAgICAgaWYgKHRoaXMuX3RyYW5zYWN0aW9uc0NvdW50ID4gMCkge1xuICAgICAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoYENhbm5vdCByZWNvbm5lY3Qgd2hpbGUgYSB0cmFuc2FjdGlvbiBpcyBhY3RpdmUgKCR7dGhpcy5fdHJhbnNhY3Rpb25zQ291bnR9KS4gT3JpZ2luYWwgZXJyb3I6ICR7ZXJyb3IubWVzc2FnZX1gLCB7Y2F1c2U6IGVycm9yfSlcbiAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgYXdhaXQgdGhpcy5yZWNvbm5lY3QoKVxuICAgICAgICAgIH1cblxuICAgICAgICAgIGNvbnN0IHdhaXRNcyA9IHR5cGVvZiByZXRyeUluZm8ud2FpdE1zID09PSBcIm51bWJlclwiICYmIE51bWJlci5pc0Zpbml0ZShyZXRyeUluZm8ud2FpdE1zKSA/IHJldHJ5SW5mby53YWl0TXMgOiAxMDBcblxuICAgICAgICAgIGlmICh3YWl0TXMgPiAwKSBhd2FpdCB3YWl0KHdhaXRNcylcbiAgICAgICAgICBjb25zdCBzZW5zaXRpdmVWYWx1ZXMgPSByZXF1ZXN0VGltaW5nID8gcmVxdWVzdFRpbWluZy5nZXRMb2dTZW5zaXRpdmVWYWx1ZXMoKSA6IG5ldyBTZXQoKVxuICAgICAgICAgIGNvbnN0IGxvZ2dlZEVycm9yID0gdGhpcy5jb25maWd1cmF0aW9uLmdldExvZ1JlZGFjdG9yKCkucmVkYWN0U3RyaW5nKGVycm9yLnN0YWNrIHx8IGVycm9yLm1lc3NhZ2UsIHNlbnNpdGl2ZVZhbHVlcylcblxuICAgICAgICAgIHRoaXMubG9nZ2VyLndhcm4oYFJldHJ5aW5nIHF1ZXJ5IGJlY2F1c2UgZmFpbGVkIHdpdGg6ICR7bG9nZ2VkRXJyb3J9YClcbiAgICAgICAgICAvLyBSZXRyeVxuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgIHRocm93IGVycm9yXG4gICAgICAgIH1cbiAgICAgIH1cbiAgICB9XG5cbiAgICB0aHJvdyBuZXcgRXJyb3IoXCIncXVlcnknIHVuZXhwZWN0ZWQgY2FtZSBoZXJlXCIpXG4gIH1cblxuICAvKipcbiAgICogRXhlY3V0ZXMgYSBtdXRhdGlvbiBhbmQgcmV0dXJucyB0aGUgbnVtYmVyIG9mIHJvd3MgY2hhbmdlZCBieSB0aGF0IHN0YXRlbWVudC5cbiAgICogQHBhcmFtIHtzdHJpbmd9IHNxbCAtIE11dGF0aW9uIFNRTCBzdHJpbmcuXG4gICAqIEBwYXJhbSB7UXVlcnlPcHRpb25zfSBbb3B0aW9uc10gLSBRdWVyeSBvd25lcnNoaXAgb3B0aW9ucy5cbiAgICogQHJldHVybnMge1Byb21pc2U8bnVtYmVyPn0gLSBBZmZlY3RlZCByb3cgY291bnQuXG4gICAqL1xuICBhc3luYyBhZmZlY3RlZFJvd3Moc3FsLCBvcHRpb25zID0ge30pIHtcbiAgICBhd2FpdCB0aGlzLl93YWl0Rm9yT3BlcmF0aW9uTGVhc2Uob3B0aW9ucy5vcGVyYXRpb25Pd25lcilcbiAgICB0aGlzLl9hc3NlcnRXcml0YWJsZVF1ZXJ5KHNxbClcblxuICAgIHJldHVybiBhd2FpdCBjb29yZGluYXRlU2hhcmVkVHJhbnNhY3Rpb25Db25uZWN0aW9uKHRoaXMsIGFzeW5jICgpID0+IHtcbiAgICAgIGF3YWl0IHRoaXMuYmVmb3JlUXVlcnkoc3FsLCBvcHRpb25zKVxuXG4gICAgICB0cnkge1xuICAgICAgICBjb25zdCBwcm9maWxlQXR0ZW1wdCA9IHRoaXMuX3N0YXJ0UHJvZmlsZWRRdWVyeUF0dGVtcHQoc3FsKVxuICAgICAgICBsZXQgZmFpbGVkID0gdHJ1ZVxuXG4gICAgICAgIHRyeSB7XG4gICAgICAgICAgY29uc3QgYWZmZWN0ZWRSb3dzID0gYXdhaXQgdGhpcy5fcnVuUGh5c2ljYWxDb25uZWN0aW9uUmVxdWVzdChcbiAgICAgICAgICAgIGFzeW5jICgpID0+IGF3YWl0IHRoaXMuX2FmZmVjdGVkUm93c0FjdHVhbChzcWwpXG4gICAgICAgICAgKVxuXG4gICAgICAgICAgZmFpbGVkID0gZmFsc2VcbiAgICAgICAgICByZXR1cm4gYWZmZWN0ZWRSb3dzXG4gICAgICAgIH0gZmluYWxseSB7XG4gICAgICAgICAgdGhpcy5fZmluaXNoUHJvZmlsZWRRdWVyeUF0dGVtcHQocHJvZmlsZUF0dGVtcHQsIGZhaWxlZClcbiAgICAgICAgfVxuICAgICAgfSBmaW5hbGx5IHtcbiAgICAgICAgYXdhaXQgdGhpcy5hZnRlclF1ZXJ5KHNxbCwgb3B0aW9ucylcbiAgICAgIH1cbiAgICB9LCBvcHRpb25zLm9wZXJhdGlvbk93bmVyKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgcXVlcnkgYWN0dWFsIHdpdGggbG9nZ2luZy5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBPcHRpb25zIG9iamVjdC5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGFyZ3Mub3JpZ2luYWxTcWwgLSBPcmlnaW5hbCBTUUwgc3RyaW5nIGJlZm9yZSBwcm9jZXNzLWxpc3QgY29tbWVudHMuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBhcmdzLnF1ZXJ5U3FsIC0gU1FMIHN0cmluZyBzZW50IHRvIHRoZSBkYXRhYmFzZS5cbiAgICogQHBhcmFtIHtRdWVyeU9wdGlvbnN9IG9wdGlvbnMgLSBRdWVyeSBvcHRpb25zLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uLy4uL2h0dHAtc2VydmVyL2NsaWVudC9yZXF1ZXN0LXRpbWluZy5qc1wiKS5kZWZhdWx0IHwgdW5kZWZpbmVkfSByZXF1ZXN0VGltaW5nIC0gUmVxdWVzdCB0aW1pbmcuXG4gICAqIEBwYXJhbSB7bnVtYmVyfSB0cmllcyAtIFF1ZXJ5IGF0dGVtcHQgY291bnQuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPFF1ZXJ5UmVzdWx0VHlwZT59IC0gUmVzb2x2ZXMgd2l0aCB0aGUgcXVlcnkuXG4gICAqL1xuICBhc3luYyBfcXVlcnlBY3R1YWxXaXRoTG9nZ2luZyh7b3JpZ2luYWxTcWwsIHF1ZXJ5U3FsfSwgb3B0aW9ucywgcmVxdWVzdFRpbWluZywgdHJpZXMpIHtcbiAgICBjb25zdCBzdGFydGVkQXRNcyA9IG5vd01zKClcbiAgICBjb25zdCBwcmV2aW91c0FjdGl2ZVF1ZXJ5ID0gdGhpcy5fYWN0aXZlUXVlcnlcbiAgICB0aGlzLl9hY3RpdmVRdWVyeSA9IHtcbiAgICAgIGFubm90YXRpb25zOiBnZXREYXRhYmFzZUFubm90YXRpb25zKCksXG4gICAgICBsb2dOYW1lOiBvcHRpb25zLmxvZ05hbWUgfHwgXCJTUUxcIixcbiAgICAgIHNxbFByZXZpZXc6IHRoaXMuX2RlYnVnU3FsUHJldmlldyhvcmlnaW5hbFNxbCksXG4gICAgICBzdGFydGVkQXRVbml4TXM6IERhdGUubm93KClcbiAgICB9XG4gICAgbGV0IHJlc3VsdFxuXG4gICAgdHJ5IHtcbiAgICAgIHRyeSB7XG4gICAgICAgIGNvbnN0IHJ1blF1ZXJ5QWN0dWFsV2l0aEhvb2tzID0gYXN5bmMgKCkgPT4gYXdhaXQgdGhpcy5fcXVlcnlBY3R1YWxXaXRoSG9va3MocXVlcnlTcWwsIG9wdGlvbnMsIG9yaWdpbmFsU3FsKVxuXG4gICAgICAgIGlmIChyZXF1ZXN0VGltaW5nICYmIHRyaWVzID09PSAxKSB7XG4gICAgICAgICAgcmVzdWx0ID0gYXdhaXQgcmVxdWVzdFRpbWluZy5tZWFzdXJlRGJRdWVyeShydW5RdWVyeUFjdHVhbFdpdGhIb29rcylcbiAgICAgICAgfSBlbHNlIGlmIChyZXF1ZXN0VGltaW5nKSB7XG4gICAgICAgICAgcmVzdWx0ID0gYXdhaXQgcmVxdWVzdFRpbWluZy5tZWFzdXJlKFwiZGJcIiwgcnVuUXVlcnlBY3R1YWxXaXRoSG9va3MpXG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgcmVzdWx0ID0gYXdhaXQgcnVuUXVlcnlBY3R1YWxXaXRoSG9va3MoKVxuICAgICAgICB9XG4gICAgICB9IGZpbmFsbHkge1xuICAgICAgICB0aGlzLl9hY3RpdmVRdWVyeSA9IHByZXZpb3VzQWN0aXZlUXVlcnlcbiAgICAgIH1cbiAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgaWYgKG9wdGlvbnMubG9nUXVlcnkgIT09IGZhbHNlKSB7XG4gICAgICAgIGF3YWl0IHRoaXMuX2xvZ1F1ZXJ5KHtcbiAgICAgICAgICBlbGFwc2VkTXM6IG5vd01zKCkgLSBzdGFydGVkQXRNcyxcbiAgICAgICAgICBlcnJvcjogZW5zdXJlRXJyb3IoZXJyb3IpLFxuICAgICAgICAgIGxvZ05hbWU6IG9wdGlvbnMubG9nTmFtZSB8fCBcIlNRTFwiLFxuICAgICAgICAgIHJlcXVlc3RUaW1pbmcsXG4gICAgICAgICAgc291cmNlU3RhY2s6IG9wdGlvbnMuc291cmNlU3RhY2ssXG4gICAgICAgICAgc3FsOiBvcmlnaW5hbFNxbFxuICAgICAgICB9KVxuICAgICAgfVxuXG4gICAgICB0aHJvdyBlcnJvclxuICAgIH1cblxuICAgIGNvbnN0IGVsYXBzZWRNcyA9IG5vd01zKCkgLSBzdGFydGVkQXRNc1xuXG4gICAgaWYgKG9wdGlvbnMubG9nUXVlcnkgIT09IGZhbHNlKSB7XG4gICAgICBhd2FpdCB0aGlzLl9sb2dRdWVyeSh7XG4gICAgICAgIGVsYXBzZWRNcyxcbiAgICAgICAgbG9nTmFtZTogb3B0aW9ucy5sb2dOYW1lIHx8IFwiU1FMXCIsXG4gICAgICAgIHJlcXVlc3RUaW1pbmcsXG4gICAgICAgIHNvdXJjZVN0YWNrOiBvcHRpb25zLnNvdXJjZVN0YWNrLFxuICAgICAgICBzcWw6IG9yaWdpbmFsU3FsXG4gICAgICB9KVxuICAgIH1cblxuICAgIGlmICh0aGlzLl9zY2hlbWFDYWNoZUludmFsaWRhdGluZ1NxbChvcmlnaW5hbFNxbCkpIHtcbiAgICAgIHRoaXMuY2xlYXJTY2hlbWFDYWNoZSgpXG4gICAgfVxuXG4gICAgcmV0dXJuIHJlc3VsdFxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgcXVlcnkgYWN0dWFsIHdpdGggYmVmb3JlL2FmdGVyIGhvb2tzLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gc3FsIC0gU1FMIHN0cmluZy5cbiAgICogQHBhcmFtIHtRdWVyeU9wdGlvbnN9IG9wdGlvbnMgLSBRdWVyeSBvcHRpb25zLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gb3JpZ2luYWxTcWwgLSBTUUwgYmVmb3JlIHByb2Nlc3MtbGlzdCBjb21tZW50cy5cbiAgICogQHJldHVybnMge1Byb21pc2U8UXVlcnlSZXN1bHRUeXBlPn0gLSBSZXNvbHZlcyB3aXRoIHRoZSBxdWVyeS5cbiAgICovXG4gIGFzeW5jIF9xdWVyeUFjdHVhbFdpdGhIb29rcyhzcWwsIG9wdGlvbnMsIG9yaWdpbmFsU3FsKSB7XG4gICAgcmV0dXJuIGF3YWl0IGNvb3JkaW5hdGVTaGFyZWRUcmFuc2FjdGlvbkNvbm5lY3Rpb24odGhpcywgYXN5bmMgKCkgPT4ge1xuICAgICAgYXdhaXQgdGhpcy5iZWZvcmVRdWVyeShzcWwsIG9wdGlvbnMpXG5cbiAgICAgIHRyeSB7XG4gICAgICAgIGNvbnN0IHByb2ZpbGVBdHRlbXB0ID0gdGhpcy5fc3RhcnRQcm9maWxlZFF1ZXJ5QXR0ZW1wdChvcmlnaW5hbFNxbClcbiAgICAgICAgbGV0IGZhaWxlZCA9IHRydWVcblxuICAgICAgICB0cnkge1xuICAgICAgICAgIGNvbnN0IHJlc3VsdCA9IGF3YWl0IHRoaXMuX3J1blBoeXNpY2FsQ29ubmVjdGlvblJlcXVlc3QoXG4gICAgICAgICAgICBhc3luYyAoKSA9PiBhd2FpdCB0aGlzLl9xdWVyeUFjdHVhbChzcWwsIG9wdGlvbnMpXG4gICAgICAgICAgKVxuXG4gICAgICAgICAgZmFpbGVkID0gZmFsc2VcbiAgICAgICAgICByZXR1cm4gcmVzdWx0XG4gICAgICAgIH0gZmluYWxseSB7XG4gICAgICAgICAgdGhpcy5fZmluaXNoUHJvZmlsZWRRdWVyeUF0dGVtcHQocHJvZmlsZUF0dGVtcHQsIGZhaWxlZClcbiAgICAgICAgfVxuICAgICAgfSBmaW5hbGx5IHtcbiAgICAgICAgYXdhaXQgdGhpcy5hZnRlclF1ZXJ5KHNxbCwgb3B0aW9ucylcbiAgICAgIH1cbiAgICB9LCBvcHRpb25zLm9wZXJhdGlvbk93bmVyKVxuICB9XG5cbiAgLyoqXG4gICAqIEhvb2sgdGhhdCBydW5zIGltbWVkaWF0ZWx5IGJlZm9yZSBhIFNRTCBxdWVyeSBpcyBzZW50IHRvIHRoZSBkcml2ZXIuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBfc3FsIC0gU1FMIHN0cmluZy5cbiAgICogQHBhcmFtIHtRdWVyeU9wdGlvbnN9IF9vcHRpb25zIC0gUXVlcnkgb3B0aW9ucy5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgd2hlbiBjb21wbGV0ZS5cbiAgICovXG4gIGFzeW5jIGJlZm9yZVF1ZXJ5KF9zcWwsIF9vcHRpb25zKSB7XG4gICAgLy8gTm8tb3AgYnkgZGVmYXVsdFxuICB9XG5cbiAgLyoqXG4gICAqIEhvb2sgdGhhdCBydW5zIGltbWVkaWF0ZWx5IGFmdGVyIGEgU1FMIHF1ZXJ5IGhhcyBjb21wbGV0ZWQgb3IgZmFpbGVkLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gX3NxbCAtIFNRTCBzdHJpbmcuXG4gICAqIEBwYXJhbSB7UXVlcnlPcHRpb25zfSBfb3B0aW9ucyAtIFF1ZXJ5IG9wdGlvbnMuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIHdoZW4gY29tcGxldGUuXG4gICAqL1xuICBhc3luYyBhZnRlclF1ZXJ5KF9zcWwsIF9vcHRpb25zKSB7XG4gICAgLy8gTm8tb3AgYnkgZGVmYXVsdFxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZ2V0IGRlYnVnIHNuYXBzaG90LlxuICAgKiBAcmV0dXJucyB7RGF0YWJhc2VDb25uZWN0aW9uRGVidWdTbmFwc2hvdH0gLSBEaWFnbm9zdGljIHNuYXBzaG90IGZvciB0aGlzIGNvbm5lY3Rpb24uXG4gICAqL1xuICBnZXREZWJ1Z1NuYXBzaG90KCkge1xuICAgIGNvbnN0IG5vdyA9IERhdGUubm93KClcbiAgICBjb25zdCBhY3RpdmVRdWVyeSA9IHRoaXMuX2FjdGl2ZVF1ZXJ5XG5cbiAgICByZXR1cm4ge1xuICAgICAgYWN0aXZlUXVlcnk6IGFjdGl2ZVF1ZXJ5ID8gey4uLmFjdGl2ZVF1ZXJ5LCBydW5uaW5nTXM6IE1hdGgubWF4KDAsIG5vdyAtIGFjdGl2ZVF1ZXJ5LnN0YXJ0ZWRBdFVuaXhNcyl9IDogbnVsbCxcbiAgICAgIGNoZWNrb3V0QWdlTXM6IHRoaXMuX2Nvbm5lY3Rpb25DaGVja2VkT3V0QXRVbml4TXMgPyBNYXRoLm1heCgwLCBub3cgLSB0aGlzLl9jb25uZWN0aW9uQ2hlY2tlZE91dEF0VW5peE1zKSA6IHVuZGVmaW5lZCxcbiAgICAgIGNoZWNrZWRPdXRBdFVuaXhNczogdGhpcy5fY29ubmVjdGlvbkNoZWNrZWRPdXRBdFVuaXhNcyxcbiAgICAgIGNoZWNrb3V0TmFtZTogdGhpcy5fY29ubmVjdGlvbkNoZWNrb3V0TmFtZSxcbiAgICAgIGRyaXZlckNsYXNzOiB0aGlzLmNvbnN0cnVjdG9yLm5hbWUsXG4gICAgICBpZFNlcTogdGhpcy5pZFNlcSxcbiAgICAgIG9wZW5UcmFuc2FjdGlvbnM6IHRoaXMuX3RyYW5zYWN0aW9uc0NvdW50LFxuICAgICAgc2NoZW1hQ2FjaGVFbnRyaWVzOiB0aGlzLl9zY2hlbWFDYWNoZS5zaXplXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIFJldHVybnMgYSBib3VuZGVkIHByZWZpeCBvZiBgc3FsYCBmb3IgbGlnaHR3ZWlnaHQgZGlhZ25vc3RpYyBzY2FubmluZy5cbiAgICogQHBhcmFtIHtzdHJpbmd9IHNxbCAtIFNRTCBzdHJpbmcuXG4gICAqIEBwYXJhbSB7bnVtYmVyfSBsaW1pdCAtIE1heGltdW0gY29kZSB1bml0cyB0byBpbnNwZWN0LlxuICAgKiBAcmV0dXJucyB7c3RyaW5nfSAtIFByZWZpeCBvZiBgc3FsYC5cbiAgICovXG4gIF9kaWFnbm9zdGljU3FsUHJlZml4KHNxbCwgbGltaXQpIHtcbiAgICByZXR1cm4gc3FsLmxlbmd0aCA8PSBsaW1pdCA/IHNxbCA6IHNxbC5zbGljZSgwLCBsaW1pdClcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGRlYnVnIHNxbCBwcmV2aWV3LlxuICAgKiBAcGFyYW0ge3N0cmluZ30gc3FsIC0gU1FMIHRvIHByZXZpZXcuXG4gICAqIEByZXR1cm5zIHtzdHJpbmd9IC0gTm9ybWFsaXplZCB0cnVuY2F0ZWQgU1FMIHByZXZpZXcgZm9yIGRpYWdub3N0aWNzLlxuICAgKi9cbiAgX2RlYnVnU3FsUHJldmlldyhzcWwpIHtcbiAgICBjb25zdCBwcmVmaXggPSB0aGlzLl9kaWFnbm9zdGljU3FsUHJlZml4KHNxbCwgU1FMX1BSRVZJRVdfU0NBTl9MSU1JVClcblxuICAgIHJldHVybiBwcmVmaXhcbiAgICAgIC5yZXBsYWNlKC9cXHMrL2csIFwiIFwiKVxuICAgICAgLnRyaW0oKVxuICAgICAgLnNsaWNlKDAsIDUwMClcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHF1ZXJ5IHNxbCB3aXRoIHByb2Nlc3MgbGlzdCBjb21tZW50LlxuICAgKiBAcGFyYW0ge3N0cmluZ30gc3FsIC0gU1FMIHN0cmluZy5cbiAgICogQHBhcmFtIHtRdWVyeU9wdGlvbnN9IG9wdGlvbnMgLSBRdWVyeSBvcHRpb25zLlxuICAgKiBAcmV0dXJucyB7c3RyaW5nfSAtIFNRTCBzdHJpbmcgd2l0aCBhIGxlYWRpbmcgcHJvY2Vzcy1saXN0IGNvbW1lbnQgd2hlbiBhbm5vdGF0aW9ucyBleGlzdC5cbiAgICovXG4gIF9xdWVyeVNxbFdpdGhQcm9jZXNzTGlzdENvbW1lbnQoc3FsLCBvcHRpb25zKSB7XG4gICAgaWYgKG9wdGlvbnMucHJvY2Vzc0xpc3RDb21tZW50ID09PSBmYWxzZSkgcmV0dXJuIHNxbFxuXG4gICAgY29uc3QgcGFydHMgPSBbXVxuXG4gICAgaWYgKHRoaXMuX2Nvbm5lY3Rpb25DaGVja291dE5hbWUpIHtcbiAgICAgIHBhcnRzLnB1c2goYGNoZWNrb3V0PVwiJHt0aGlzLl9wcm9jZXNzTGlzdENvbW1lbnRWYWx1ZSh0aGlzLl9jb25uZWN0aW9uQ2hlY2tvdXROYW1lKX1cImApXG4gICAgfVxuXG4gICAgY29uc3QgYW5ub3RhdGlvbnMgPSBnZXREYXRhYmFzZUFubm90YXRpb25zKClcblxuICAgIGlmIChhbm5vdGF0aW9ucy5sZW5ndGggPiAwKSB7XG4gICAgICBwYXJ0cy5wdXNoKGBhbm5vdGF0aW9ucz1cIiR7dGhpcy5fcHJvY2Vzc0xpc3RDb21tZW50VmFsdWUoYW5ub3RhdGlvbnMuam9pbihcIiA+IFwiKSl9XCJgKVxuICAgIH1cblxuICAgIGlmIChwYXJ0cy5sZW5ndGggPT09IDApIHJldHVybiBzcWxcblxuICAgIHJldHVybiBgLyogdmVsb2Npb3VzICR7cGFydHMuam9pbihcIiBcIil9ICovICR7c3FsfWBcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHByb2Nlc3MgbGlzdCBjb21tZW50IHZhbHVlLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gdmFsdWUgLSBSYXcgcHJvY2Vzcy1saXN0IGNvbW1lbnQgdmFsdWUuXG4gICAqIEByZXR1cm5zIHtzdHJpbmd9IC0gU2FuaXRpemVkIHByb2Nlc3MtbGlzdCBjb21tZW50IHZhbHVlLlxuICAgKi9cbiAgX3Byb2Nlc3NMaXN0Q29tbWVudFZhbHVlKHZhbHVlKSB7XG4gICAgbGV0IHNhbml0aXplZCA9IFwiXCJcblxuICAgIGZvciAoY29uc3QgY2hhcmFjdGVyIG9mIHZhbHVlKSB7XG4gICAgICBjb25zdCBjb2RlUG9pbnQgPSBjaGFyYWN0ZXIuY29kZVBvaW50QXQoMClcblxuICAgICAgc2FuaXRpemVkICs9IGNvZGVQb2ludCAhPT0gdW5kZWZpbmVkICYmIChjb2RlUG9pbnQgPCAzMiB8fCBjb2RlUG9pbnQgPT09IDEyNykgPyBcIiBcIiA6IGNoYXJhY3RlclxuICAgIH1cblxuICAgIHJldHVybiBzYW5pdGl6ZWRcbiAgICAgIC5yZXBsYWNlKC9cXCpcXC8vZywgXCIqIC9cIilcbiAgICAgIC5yZXBsYWNlKC9cXHMrL2csIFwiIFwiKVxuICAgICAgLnRyaW0oKVxuICAgICAgLnNsaWNlKDAsIDIwMClcbiAgICAgIC5yZXBsYWNlKC9cIi9nLCBcIidcIilcbiAgfVxuXG4gIC8qKlxuICAgKiBSZWFkcyB0aGUgbmV4dCBTUUwgdG9rZW4gc3RhcnRpbmcgYXQgYHN0YXJ0SW5kZXhgLCBza2lwcGluZyBsZWFkaW5nIHRyaXZpYVxuICAgKiAoQk9NLCB3aGl0ZXNwYWNlLCBibG9jayBjb21tZW50cywgbGluZSBjb21tZW50cykuIElmIHRoZSBzY2FuIGNhbm5vdCBmaW5pc2hcbiAgICogc2tpcHBpbmcgdHJpdmlhIGJlZm9yZSBgbGltaXRgLCB0aGUgcmVzdWx0IGlzIG1hcmtlZCBpbmNvbXBsZXRlIHNvIGNhbGxlcnNcbiAgICogY2FuIGNvbnNlcnZhdGl2ZWx5IHRyZWF0IHRoZSBzdGF0ZW1lbnQgYXMgc2NoZW1hLWludmFsaWRhdGluZy5cbiAgICogQHBhcmFtIHtzdHJpbmd9IHNxbCAtIFNRTCBzdHJpbmcuXG4gICAqIEBwYXJhbSB7bnVtYmVyfSBzdGFydEluZGV4IC0gSW5kZXggdG8gc3RhcnQgc2Nhbm5pbmcuXG4gICAqIEBwYXJhbSB7bnVtYmVyfSBsaW1pdCAtIE1heGltdW0gYWJzb2x1dGUgaW5kZXggdG8gc2NhbiB3aGlsZSBza2lwcGluZyBsZWFkaW5nIHRyaXZpYS5cbiAgICogQHJldHVybnMge1NxbFRva2VuUmVzdWx0fSAtIFRva2VuIHJlc3VsdC5cbiAgICovXG4gIF9yZWFkU3FsVG9rZW4oc3FsLCBzdGFydEluZGV4LCBsaW1pdCkge1xuICAgIGxldCBpID0gc3RhcnRJbmRleFxuICAgIGNvbnN0IGxlbiA9IHNxbC5sZW5ndGhcblxuICAgIHdoaWxlIChpIDwgbGVuICYmIGkgPCBsaW1pdCkge1xuICAgICAgY29uc3QgY2hhciA9IHNxbFtpXVxuXG4gICAgICBpZiAoY2hhciA9PT0gXCJcXHVmZWZmXCIgfHwgL1xccy8udGVzdChjaGFyKSkge1xuICAgICAgICBpKytcbiAgICAgICAgY29udGludWVcbiAgICAgIH1cblxuICAgICAgaWYgKGNoYXIgPT09IFwiL1wiICYmIHNxbFtpICsgMV0gPT09IFwiKlwiKSB7XG4gICAgICAgIGNvbnN0IGNsb3NlID0gc3FsLmluZGV4T2YoXCIqL1wiLCBpICsgMilcblxuICAgICAgICBpZiAoY2xvc2UgPT09IC0xIHx8IGNsb3NlICsgMiA+IGxpbWl0KSB7XG4gICAgICAgICAgcmV0dXJuIHtpbmNvbXBsZXRlOiB0cnVlLCBpbmRleDogaSwgdG9rZW46IHVuZGVmaW5lZH1cbiAgICAgICAgfVxuXG4gICAgICAgIGkgPSBjbG9zZSArIDJcbiAgICAgICAgY29udGludWVcbiAgICAgIH1cblxuICAgICAgaWYgKGNoYXIgPT09IFwiLVwiICYmIHNxbFtpICsgMV0gPT09IFwiLVwiKSB7XG4gICAgICAgIGNvbnN0IG5ld2xpbmUgPSBzcWwuaW5kZXhPZihcIlxcblwiLCBpICsgMilcblxuICAgICAgICBpZiAobmV3bGluZSA9PT0gLTEpIHtcbiAgICAgICAgICByZXR1cm4ge2luY29tcGxldGU6IGZhbHNlLCBpbmRleDogbGVuLCB0b2tlbjogdW5kZWZpbmVkfVxuICAgICAgICB9XG5cbiAgICAgICAgaWYgKG5ld2xpbmUgKyAxID4gbGltaXQpIHtcbiAgICAgICAgICByZXR1cm4ge2luY29tcGxldGU6IHRydWUsIGluZGV4OiBpLCB0b2tlbjogdW5kZWZpbmVkfVxuICAgICAgICB9XG5cbiAgICAgICAgaSA9IG5ld2xpbmUgKyAxXG4gICAgICAgIGNvbnRpbnVlXG4gICAgICB9XG5cbiAgICAgIGxldCB0b2tlbiA9IFwiXCJcblxuICAgICAgd2hpbGUgKGkgPCBsZW4pIHtcbiAgICAgICAgY29uc3QgYyA9IHNxbFtpXVxuXG4gICAgICAgIGlmICgvXFxzLy50ZXN0KGMpIHx8IGMgPT09IFwiXFx1ZmVmZlwiKSBicmVha1xuICAgICAgICBpZiAoYyA9PT0gXCIvXCIgJiYgc3FsW2kgKyAxXSA9PT0gXCIqXCIpIGJyZWFrXG4gICAgICAgIGlmIChjID09PSBcIi1cIiAmJiBzcWxbaSArIDFdID09PSBcIi1cIikgYnJlYWtcblxuICAgICAgICB0b2tlbiArPSBjXG4gICAgICAgIGkrK1xuICAgICAgfVxuXG4gICAgICByZXR1cm4ge2luY29tcGxldGU6IGZhbHNlLCB0b2tlbjogdG9rZW4udG9Mb3dlckNhc2UoKSwgaW5kZXg6IGl9XG4gICAgfVxuXG4gICAgaWYgKGkgPj0gbGVuKSB7XG4gICAgICByZXR1cm4ge2luY29tcGxldGU6IGZhbHNlLCBpbmRleDogbGVuLCB0b2tlbjogdW5kZWZpbmVkfVxuICAgIH1cblxuICAgIHJldHVybiB7aW5jb21wbGV0ZTogdHJ1ZSwgaW5kZXg6IGksIHRva2VuOiB1bmRlZmluZWR9XG4gIH1cblxuICAvKipcbiAgICogUnVucyBzY2hlbWEgY2FjaGUgaW52YWxpZGF0aW5nIHNxbC5cbiAgICogQHBhcmFtIHtzdHJpbmd9IHNxbCAtIFNRTCBzdHJpbmcuXG4gICAqIEByZXR1cm5zIHtib29sZWFufSAtIFdoZXRoZXIgdGhlIFNRTCBzaG91bGQgaW52YWxpZGF0ZSBzY2hlbWEgbWV0YWRhdGEuXG4gICAqL1xuICBfc2NoZW1hQ2FjaGVJbnZhbGlkYXRpbmdTcWwoc3FsKSB7XG4gICAgY29uc3QgZmlyc3QgPSB0aGlzLl9yZWFkU3FsVG9rZW4oc3FsLCAwLCBTQ0hFTUFfSU5WQUxJREFUSU9OX1NDQU5fTElNSVQpXG5cbiAgICBpZiAoZmlyc3QuaW5jb21wbGV0ZSkgcmV0dXJuIHRydWVcblxuICAgIGNvbnN0IGZpcnN0VG9rZW4gPSBmaXJzdC50b2tlblxuXG4gICAgaWYgKCFmaXJzdFRva2VuKSByZXR1cm4gZmFsc2VcbiAgICBpZiAoL14oY3JlYXRlfGFsdGVyfGRyb3B8cmVuYW1lKSQvLnRlc3QoZmlyc3RUb2tlbikpIHJldHVybiB0cnVlXG5cbiAgICBpZiAoZmlyc3RUb2tlbiA9PT0gXCJjb21tZW50XCIpIHtcbiAgICAgIGNvbnN0IG5leHQgPSB0aGlzLl9yZWFkU3FsVG9rZW4oc3FsLCBmaXJzdC5pbmRleCwgU0NIRU1BX0lOVkFMSURBVElPTl9TQ0FOX0xJTUlUKVxuXG4gICAgICByZXR1cm4gbmV4dC5pbmNvbXBsZXRlIHx8IG5leHQudG9rZW4gPT09IFwib25cIlxuICAgIH1cblxuICAgIGlmIChmaXJzdFRva2VuID09PSBcImV4ZWNcIiB8fCBmaXJzdFRva2VuID09PSBcImV4ZWN1dGVcIikge1xuICAgICAgY29uc3QgbmV4dCA9IHRoaXMuX3JlYWRTcWxUb2tlbihzcWwsIGZpcnN0LmluZGV4LCBTQ0hFTUFfSU5WQUxJREFUSU9OX1NDQU5fTElNSVQpXG5cbiAgICAgIHJldHVybiBuZXh0LmluY29tcGxldGUgfHwgbmV4dC50b2tlbiA9PT0gXCJzcF9yZW5hbWVcIlxuICAgIH1cblxuICAgIGlmIChmaXJzdFRva2VuID09PSBcImlmXCIpIHtcbiAgICAgIGxldCBpbmRleCA9IGZpcnN0LmluZGV4XG5cbiAgICAgIHdoaWxlICh0cnVlKSB7XG4gICAgICAgIGNvbnN0IHJlc3VsdCA9IHRoaXMuX3JlYWRTcWxUb2tlbihzcWwsIGluZGV4LCBTQ0hFTUFfSU5WQUxJREFUSU9OX1NDQU5fTElNSVQpXG5cbiAgICAgICAgaWYgKHJlc3VsdC5pbmNvbXBsZXRlKSByZXR1cm4gdHJ1ZVxuICAgICAgICBpZiAoIXJlc3VsdC50b2tlbikgcmV0dXJuIGZhbHNlXG4gICAgICAgIGlmIChyZXN1bHQudG9rZW4gPT09IFwiYmVnaW5cIikge1xuICAgICAgICAgIGNvbnN0IGRkbFJlc3VsdCA9IHRoaXMuX3JlYWRTcWxUb2tlbihzcWwsIHJlc3VsdC5pbmRleCwgU0NIRU1BX0lOVkFMSURBVElPTl9TQ0FOX0xJTUlUKVxuXG4gICAgICAgICAgcmV0dXJuIGRkbFJlc3VsdC5pbmNvbXBsZXRlIHx8IC9eKGNyZWF0ZXxhbHRlcnxkcm9wfHJlbmFtZSkkLy50ZXN0KGRkbFJlc3VsdC50b2tlbiB8fCBcIlwiKVxuICAgICAgICB9XG5cbiAgICAgICAgaW5kZXggPSByZXN1bHQuaW5kZXhcbiAgICAgIH1cbiAgICB9XG5cbiAgICByZXR1cm4gZmFsc2VcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHF1ZXJ5IGxvZ2dpbmcgZW5hYmxlZC5cbiAgICogQHJldHVybnMge2Jvb2xlYW59IC0gV2hldGhlciBxdWVyeSBsb2dnaW5nIGlzIGVuYWJsZWQgZm9yIHRoaXMgZHJpdmVyLlxuICAgKi9cbiAgX3F1ZXJ5TG9nZ2luZ0VuYWJsZWQoKSB7XG4gICAgaWYgKCF0aGlzLmNvbmZpZ3VyYXRpb24pIHJldHVybiB0cnVlXG4gICAgaWYgKCF0aGlzLmNvbmZpZ3VyYXRpb24uZ2V0UXVlcnlMb2dnaW5nRW5hYmxlZCgpKSByZXR1cm4gZmFsc2VcblxuICAgIGNvbnN0IGxvZ2dlciA9IG5ldyBMb2dnZXIoXCJTUUxcIiwge2NvbmZpZ3VyYXRpb246IHRoaXMuY29uZmlndXJhdGlvbn0pXG5cbiAgICByZXR1cm4gbG9nZ2VyLmlzTGV2ZWxFbmFibGVkKFwiaW5mb1wiKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgbG9nIHF1ZXJ5LlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIE9wdGlvbnMgb2JqZWN0LlxuICAgKiBAcGFyYW0ge251bWJlcn0gYXJncy5lbGFwc2VkTXMgLSBFbGFwc2VkIG1pbGxpc2Vjb25kcy5cbiAgICogQHBhcmFtIHtFcnJvcn0gW2FyZ3MuZXJyb3JdIC0gUXVlcnkgZmFpbHVyZSwgd2hlbiB0aGUgZHJpdmVyIGNhbGwgZmFpbGVkLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gYXJncy5sb2dOYW1lIC0gUXVlcnkgbG9nIHN1YmplY3QuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vLi4vaHR0cC1zZXJ2ZXIvY2xpZW50L3JlcXVlc3QtdGltaW5nLmpzXCIpLmRlZmF1bHQgfCB1bmRlZmluZWR9IGFyZ3MucmVxdWVzdFRpbWluZyAtIFJlcXVlc3QgdGltaW5nLlxuICAgKiBAcGFyYW0ge3N0cmluZyB8IHVuZGVmaW5lZH0gYXJncy5zb3VyY2VTdGFjayAtIFNvdXJjZSBzdGFjay5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGFyZ3Muc3FsIC0gU1FMIHN0cmluZy5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgd2hlbiBjb21wbGV0ZS5cbiAgICovXG4gIGFzeW5jIF9sb2dRdWVyeSh7ZWxhcHNlZE1zLCBlcnJvciwgbG9nTmFtZSwgcmVxdWVzdFRpbWluZywgc291cmNlU3RhY2ssIHNxbH0pIHtcbiAgICBjb25zdCBsb2dnZXIgPSBuZXcgTG9nZ2VyKGxvZ05hbWUsIHtjb25maWd1cmF0aW9uOiB0aGlzLmNvbmZpZ3VyYXRpb259KVxuICAgIGNvbnN0IHNvdXJjZUxpbmUgPSB0aGlzLl9xdWVyeVNvdXJjZUxpbmUoc291cmNlU3RhY2spXG4gICAgY29uc3Qgc2Vuc2l0aXZlVmFsdWVzID0gcmVxdWVzdFRpbWluZyA/IHJlcXVlc3RUaW1pbmcuZ2V0TG9nU2Vuc2l0aXZlVmFsdWVzKCkgOiBuZXcgU2V0KClcbiAgICBjb25zdCByZWRhY3RvciA9IHRoaXMuY29uZmlndXJhdGlvbi5nZXRMb2dSZWRhY3RvcigpXG4gICAgY29uc3QgbG9nZ2VkU3FsID0gcmVkYWN0b3IucmVkYWN0U3RyaW5nKHNxbCwgc2Vuc2l0aXZlVmFsdWVzKVxuICAgIGNvbnN0IGZhaWx1cmUgPSBlcnJvclxuICAgICAgPyBgIEZBSUxFRCAke2Vycm9yLm5hbWV9OiAke3JlZGFjdG9yLnJlZGFjdFN0cmluZyhlcnJvci5tZXNzYWdlLCBzZW5zaXRpdmVWYWx1ZXMpfWBcbiAgICAgIDogXCJcIlxuICAgIGNvbnN0IG1lc3NhZ2UgPSBzb3VyY2VMaW5lXG4gICAgICA/IGAoJHtmb3JtYXRFbGFwc2VkTXMoZWxhcHNlZE1zKX0pJHtmYWlsdXJlfSAgJHtsb2dnZWRTcWx9XFxuICDihrMgJHtzb3VyY2VMaW5lfWBcbiAgICAgIDogYCgke2Zvcm1hdEVsYXBzZWRNcyhlbGFwc2VkTXMpfSkke2ZhaWx1cmV9ICAke2xvZ2dlZFNxbH1gXG5cbiAgICBhd2FpdCBsb2dnZXIuaW5mbyhtZXNzYWdlKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgcXVlcnkgc291cmNlIGxpbmUuXG4gICAqIEBwYXJhbSB7c3RyaW5nIHwgdW5kZWZpbmVkfSBzb3VyY2VTdGFjayAtIFNvdXJjZSBzdGFjay5cbiAgICogQHJldHVybnMge3N0cmluZyB8IHVuZGVmaW5lZH0gLSBTb3VyY2UgbGluZSB3aGVuIGFuIGFwcGxpY2F0aW9uIGZyYW1lIGlzIGF2YWlsYWJsZS5cbiAgICovXG4gIF9xdWVyeVNvdXJjZUxpbmUoc291cmNlU3RhY2spIHtcbiAgICBpZiAoIXNvdXJjZVN0YWNrKSByZXR1cm4gdW5kZWZpbmVkXG5cbiAgICBjb25zdCBhcHBsaWNhdGlvbkRpcmVjdG9yeSA9IHRoaXMuY29uZmlndXJhdGlvblxuICAgICAgPyB0aGlzLmNvbmZpZ3VyYXRpb24uZ2V0RGlyZWN0b3J5SWZBdmFpbGFibGUoKVxuICAgICAgOiB1bmRlZmluZWRcblxuICAgIGlmICghYXBwbGljYXRpb25EaXJlY3RvcnkpIHJldHVybiB1bmRlZmluZWRcblxuICAgIGNvbnN0IGVycm9yID0gbmV3IEVycm9yKFwiUXVlcnkgc291cmNlXCIpXG5cbiAgICBlcnJvci5zdGFjayA9IHNvdXJjZVN0YWNrXG5cbiAgICByZXR1cm4gQmFja3RyYWNlQ2xlYW5lci5nZXRBcHBsaWNhdGlvblNvdXJjZUxpbmUoZXJyb3IsIHtcbiAgICAgIGFwcGxpY2F0aW9uRGlyZWN0b3J5LFxuICAgICAgZnJhbWV3b3JrU291cmNlRGlyZWN0b3J5OiB0aGlzLmNvbmZpZ3VyYXRpb24uZ2V0RW52aXJvbm1lbnRIYW5kbGVyKCkuZ2V0RnJhbWV3b3JrU291cmNlRGlyZWN0b3J5KClcbiAgICB9KVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgcXVlcnkgYWN0dWFsLlxuICAgKiBAYWJzdHJhY3RcbiAgICogQHBhcmFtIHtzdHJpbmd9IHNxbCAtIFNRTCBzdHJpbmcuXG4gICAqIEBwYXJhbSB7UXVlcnlPcHRpb25zfSBbb3B0aW9uc10gLSBRdWVyeSBvcHRpb25zIChjYXJyaWVzIHRoZSBvcHRpb25hbCBhYm9ydCBzaWduYWwpLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxRdWVyeVJlc3VsdFR5cGU+fSAtIFJlc29sdmVzIHdpdGggdGhlIHF1ZXJ5IGFjdHVhbC5cbiAgICovXG4gIF9xdWVyeUFjdHVhbChzcWwsIG9wdGlvbnMpIHsgLy8gZXNsaW50LWRpc2FibGUtbGluZSBuby11bnVzZWQtdmFyc1xuICAgIHRocm93IG5ldyBFcnJvcihgcXVlcnlBY3R1YWwgbm90IGltcGxlbWVudGVkYClcbiAgfVxuXG4gIC8qKlxuICAgKiBFeGVjdXRlcyBhIG11dGF0aW9uIGFuZCByZXR1cm5zIGl0cyBhZmZlY3RlZCByb3cgY291bnQuXG4gICAqIEBhYnN0cmFjdFxuICAgKiBAcGFyYW0ge3N0cmluZ30gc3FsIC0gTXV0YXRpb24gU1FMIHN0cmluZy5cbiAgICogQHJldHVybnMge1Byb21pc2U8bnVtYmVyPn0gLSBBZmZlY3RlZCByb3cgY291bnQuXG4gICAqL1xuICBfYWZmZWN0ZWRSb3dzQWN0dWFsKHNxbCkgeyAvLyBlc2xpbnQtZGlzYWJsZS1saW5lIG5vLXVudXNlZC12YXJzXG4gICAgdGhyb3cgbmV3IEVycm9yKGBhZmZlY3RlZFJvd3NBY3R1YWwgbm90IGltcGxlbWVudGVkYClcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHF1ZXJ5IHRvIHNxbC5cbiAgICogQGFic3RyYWN0XG4gICAqIEBwYXJhbSB7UXVlcnl9IF9xdWVyeSAtIFF1ZXJ5IGluc3RhbmNlLlxuICAgKiBAcmV0dXJucyB7c3RyaW5nfSAtIFNRTCBzdHJpbmcuXG4gICAqL1xuICBxdWVyeVRvU3FsKF9xdWVyeSkgeyB0aHJvdyBuZXcgRXJyb3IoXCJxdWVyeVRvU3FsIG5vdCBpbXBsZW1lbnRlZFwiKSB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgcmV0cnlhYmxlIGRhdGFiYXNlIGVycm9yLlxuICAgKiBAcGFyYW0ge0Vycm9yfSBfZXJyb3IgLSBFcnJvciBpbnN0YW5jZS5cbiAgICogQHJldHVybnMge1JldHJ5YWJsZURhdGFiYXNlRXJyb3JSZXN1bHR9IC0gUmV0cnkgaW5mby5cbiAgICovXG4gIHJldHJ5YWJsZURhdGFiYXNlRXJyb3IoX2Vycm9yKSB7XG4gICAgcmV0dXJuIHtyZXRyeTogZmFsc2UsIHJlY29ubmVjdDogZmFsc2V9XG4gIH1cblxuICAvKipcbiAgICogUnVucyBhc3NlcnQgd3JpdGFibGUgcXVlcnkuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBzcWwgLSBTUUwgc3RyaW5nLlxuICAgKiBAcmV0dXJucyB7dm9pZH0gLSBObyByZXR1cm4gdmFsdWUuXG4gICAqL1xuICBfYXNzZXJ0V3JpdGFibGVRdWVyeShzcWwpIHtcbiAgICBpZiAoIXRoaXMuaXNSZWFkT25seSgpKSByZXR1cm5cbiAgICBpZiAoIXRoaXMuX3NxbExvb2tzTGlrZVdyaXRlKHNxbCkpIHJldHVyblxuXG4gICAgdGhyb3cgbmV3IEVycm9yKFwiRGF0YWJhc2UgaXMgcmVhZC1vbmx5XCIpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBhc3NlcnQgbm90IHJlYWQgb25seS5cbiAgICogQHJldHVybnMge3ZvaWR9IC0gTm8gcmV0dXJuIHZhbHVlLlxuICAgKi9cbiAgX2Fzc2VydE5vdFJlYWRPbmx5KCkge1xuICAgIGlmICh0aGlzLmlzUmVhZE9ubHkoKSkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKFwiRGF0YWJhc2UgaXMgcmVhZC1vbmx5XCIpXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgc3FsIGxvb2tzIGxpa2Ugd3JpdGUuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBzcWwgLSBTUUwgc3RyaW5nLlxuICAgKiBAcmV0dXJucyB7Ym9vbGVhbn0gLSBTUUwgcmVwcmVzZW50YXRpb24uXG4gICAqL1xuICBfc3FsTG9va3NMaWtlV3JpdGUoc3FsKSB7XG4gICAgY29uc3Qgbm9ybWFsaXplZCA9IHNxbC50cmltKCkudG9Mb3dlckNhc2UoKVxuXG4gICAgaWYgKCFub3JtYWxpemVkKSByZXR1cm4gZmFsc2VcblxuICAgIGlmIChcbiAgICAgIG5vcm1hbGl6ZWQuc3RhcnRzV2l0aChcInNlbGVjdFwiKSB8fFxuICAgICAgbm9ybWFsaXplZC5zdGFydHNXaXRoKFwic2hvd1wiKSB8fFxuICAgICAgbm9ybWFsaXplZC5zdGFydHNXaXRoKFwicHJhZ21hXCIpIHx8XG4gICAgICBub3JtYWxpemVkLnN0YXJ0c1dpdGgoXCJleHBsYWluXCIpIHx8XG4gICAgICBub3JtYWxpemVkLnN0YXJ0c1dpdGgoXCJkZXNjcmliZVwiKVxuICAgICkge1xuICAgICAgcmV0dXJuIGZhbHNlXG4gICAgfVxuXG4gICAgaWYgKG5vcm1hbGl6ZWQuc3RhcnRzV2l0aChcIndpdGhcIikpIHtcbiAgICAgIGNvbnN0IHdpdGhNYXRjaCA9IG5vcm1hbGl6ZWQubWF0Y2goL15cXHMqd2l0aFtcXHNcXFNdKz9cXClcXHMqKHNlbGVjdHxpbnNlcnR8dXBkYXRlfGRlbGV0ZXxtZXJnZXxyZXBsYWNlKVxcYi8pXG5cbiAgICAgIGlmICh3aXRoTWF0Y2gpIHtcbiAgICAgICAgcmV0dXJuIHdpdGhNYXRjaFsxXSAhPT0gXCJzZWxlY3RcIlxuICAgICAgfVxuXG4gICAgICByZXR1cm4gZmFsc2VcbiAgICB9XG5cbiAgICBjb25zdCBrZXl3b3JkTWF0Y2ggPSBub3JtYWxpemVkLm1hdGNoKC9eXFxzKihcXHcrKS8pXG4gICAgY29uc3Qga2V5d29yZCA9IGtleXdvcmRNYXRjaCA/IGtleXdvcmRNYXRjaFsxXSA6IFwiXCJcblxuICAgIHJldHVybiBbXG4gICAgICBcImluc2VydFwiLFxuICAgICAgXCJ1cGRhdGVcIixcbiAgICAgIFwiZGVsZXRlXCIsXG4gICAgICBcImNyZWF0ZVwiLFxuICAgICAgXCJhbHRlclwiLFxuICAgICAgXCJkcm9wXCIsXG4gICAgICBcInRydW5jYXRlXCIsXG4gICAgICBcIm1lcmdlXCIsXG4gICAgICBcInJlcGxhY2VcIlxuICAgIF0uaW5jbHVkZXMoa2V5d29yZClcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGlzIHJlYWQgb25seS5cbiAgICogQHJldHVybnMge2Jvb2xlYW59IC0gV2hldGhlciByZWFkIG9ubHkuXG4gICAqL1xuICBpc1JlYWRPbmx5KCkge1xuICAgIHJldHVybiBCb29sZWFuKHRoaXMuZ2V0QXJncygpLnJlYWRPbmx5KVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgcm9sbGJhY2sgdHJhbnNhY3Rpb24uXG4gICAqIEBwYXJhbSB7UGljazxRdWVyeU9wdGlvbnMsIFwib3BlcmF0aW9uT3duZXJcIj59IFtvcHRpb25zXSAtIFRyYW5zYWN0aW9uIG93bmVyc2hpcC5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgd2hlbiBjb21wbGV0ZS5cbiAgICovXG4gIGFzeW5jIHJvbGxiYWNrVHJhbnNhY3Rpb24ob3B0aW9ucyA9IHt9KSB7XG4gICAgYXdhaXQgY29vcmRpbmF0ZVNoYXJlZFRyYW5zYWN0aW9uQ29ubmVjdGlvbih0aGlzLCBhc3luYyAoKSA9PiB7XG4gICAgICBhd2FpdCB0aGlzLl90cmFuc2FjdGlvbnNBY3Rpb25zTXV0ZXguc3luYyhhc3luYyAoKSA9PiB7XG4gICAgICAgIHRyeSB7XG4gICAgICAgICAgYXdhaXQgdGhpcy5fcnVuUHJvZmlsZWRUcmFuc2FjdGlvbkFjdGlvbihcInJvbGxiYWNrXCIsIGFzeW5jICgpID0+IHtcbiAgICAgICAgICAgIGF3YWl0IHRoaXMuX3JvbGxiYWNrVHJhbnNhY3Rpb25BY3Rpb24ob3B0aW9ucylcbiAgICAgICAgICB9KVxuICAgICAgICB9IGZpbmFsbHkge1xuICAgICAgICAgIC8vIERyaXZlciByZWNvdmVyeSBtYXkgbmVlZCB0byBjbGVhciBhIHN0YWxlIHBoeXNpY2FsIHRyYW5zYWN0aW9uIHdoZW5cbiAgICAgICAgICAvLyBubyBsb2dpY2FsIHRyYW5zYWN0aW9uIGlzIGFjdGl2ZS4gTmV2ZXIgbGV0IHRoYXQgY2xlYW51cCB1bmRlcmZsb3dcbiAgICAgICAgICAvLyB0aGUgbG9naWNhbCBkZXB0aCBhbmQgdHVybiB0aGUgbmV4dCByb290IHRyYW5zYWN0aW9uIGludG8gYSBzYXZlcG9pbnQuXG4gICAgICAgICAgaWYgKHRoaXMuX3RyYW5zYWN0aW9uc0NvdW50ID4gMCkgdGhpcy5fdHJhbnNhY3Rpb25zQ291bnQtLVxuICAgICAgICAgIHRoaXMuX3Jlc29sdmVDb21wbGV0ZWRUcmFuc2FjdGlvbigpXG5cbiAgICAgICAgICAvLyBBIHJvbGxlZC1iYWNrIHRyYW5zYWN0aW9uIG1heSBoYXZlIHJldmVydGVkIERETCAoZS5nLiBhIENSRUFURSBUQUJMRVxuICAgICAgICAgIC8vIHJ1biBsYXppbHkgaW5zaWRlIHRoZSB0cmFuc2FjdGlvbiksIHNvIGFueSBjYWNoZWQgc2NoZW1hIG1ldGFkYXRhIGlzXG4gICAgICAgICAgLy8gbm93IHN0YWxlIGFuZCBtdXN0IGJlIGludmFsaWRhdGVkLiBXaXRob3V0IHRoaXMsIGEgbGF0ZXIgdGFibGVFeGlzdHMoKVxuICAgICAgICAgIC8vIGNoZWNrIGNhbiByZXBvcnQgYSB0YWJsZSB0aGF0IHRoZSByb2xsYmFjayBhbHJlYWR5IHJlbW92ZWQsIHNvIGNhbGxlcnNcbiAgICAgICAgICAvLyBza2lwIHJlY3JlYXRpbmcgaXQgYW5kIHRoZW4gZmFpbCB3aXRoIFwibm8gc3VjaCB0YWJsZVwiLlxuICAgICAgICAgIHRoaXMuY2xlYXJTY2hlbWFDYWNoZSgpXG4gICAgICAgIH1cbiAgICAgIH0pXG4gICAgfSwgb3B0aW9ucy5vcGVyYXRpb25Pd25lcilcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHJvbGxiYWNrIHRyYW5zYWN0aW9uIGFjdGlvbi5cbiAgICogQHBhcmFtIHtQaWNrPFF1ZXJ5T3B0aW9ucywgXCJvcGVyYXRpb25Pd25lclwiPn0gW29wdGlvbnNdIC0gVHJhbnNhY3Rpb24gb3duZXJzaGlwLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyB3aGVuIGNvbXBsZXRlLlxuICAgKi9cbiAgYXN5bmMgX3JvbGxiYWNrVHJhbnNhY3Rpb25BY3Rpb24ob3B0aW9ucyA9IHt9KSB7XG4gICAgYXdhaXQgdGhpcy5xdWVyeShcIlJPTExCQUNLXCIsIG9wdGlvbnMpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBnZW5lcmF0ZSBzYXZlIHBvaW50IG5hbWUuXG4gICAqIEByZXR1cm5zIHtzdHJpbmd9IC0gVGhlIGdlbmVyYXRlIHNhdmUgcG9pbnQgbmFtZS5cbiAgICovXG4gIGdlbmVyYXRlU2F2ZVBvaW50TmFtZSgpIHtcbiAgICByZXR1cm4gYHNwJHtuZXcgVVVJRCg0KS5mb3JtYXQoKS5yZXBsYWNlQWxsKFwiLVwiLCBcIlwiKX1gXG4gIH1cblxuICAvKipcbiAgICogUnVucyBzdGFydCBzYXZlIHBvaW50LlxuICAgKiBAcGFyYW0ge3N0cmluZ30gc2F2ZVBvaW50TmFtZSAtIFNhdmUgcG9pbnQgbmFtZS5cbiAgICogQHBhcmFtIHtQaWNrPFF1ZXJ5T3B0aW9ucywgXCJvcGVyYXRpb25Pd25lclwiPn0gW29wdGlvbnNdIC0gVHJhbnNhY3Rpb24gb3duZXJzaGlwLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyB3aGVuIGNvbXBsZXRlLlxuICAgKi9cbiAgYXN5bmMgc3RhcnRTYXZlUG9pbnQoc2F2ZVBvaW50TmFtZSwgb3B0aW9ucyA9IHt9KSB7XG4gICAgYXdhaXQgY29vcmRpbmF0ZVNoYXJlZFRyYW5zYWN0aW9uQ29ubmVjdGlvbih0aGlzLCBhc3luYyAoKSA9PiB7XG4gICAgICBhd2FpdCB0aGlzLl90cmFuc2FjdGlvbnNBY3Rpb25zTXV0ZXguc3luYyhhc3luYyAoKSA9PiB7XG4gICAgICAgIGF3YWl0IHRoaXMuX3N0YXJ0U2F2ZVBvaW50QWN0aW9uKHNhdmVQb2ludE5hbWUsIG9wdGlvbnMpXG4gICAgICB9KVxuICAgIH0sIG9wdGlvbnMub3BlcmF0aW9uT3duZXIpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBzdGFydCBzYXZlIHBvaW50IGFjdGlvbi5cbiAgICogQHBhcmFtIHtzdHJpbmd9IHNhdmVQb2ludE5hbWUgLSBTYXZlIHBvaW50IG5hbWUuXG4gICAqIEBwYXJhbSB7UGljazxRdWVyeU9wdGlvbnMsIFwib3BlcmF0aW9uT3duZXJcIj59IFtvcHRpb25zXSAtIFRyYW5zYWN0aW9uIG93bmVyc2hpcC5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgd2hlbiBjb21wbGV0ZS5cbiAgICovXG4gIGFzeW5jIF9zdGFydFNhdmVQb2ludEFjdGlvbihzYXZlUG9pbnROYW1lLCBvcHRpb25zID0ge30pIHtcbiAgICBhd2FpdCB0aGlzLnF1ZXJ5KGBTQVZFUE9JTlQgJHtzYXZlUG9pbnROYW1lfWAsIG9wdGlvbnMpXG4gIH1cblxuICAvKipcbiAgICogUnVucyByZW5hbWUgY29sdW1uLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gdGFibGVOYW1lIC0gVGFibGUgbmFtZS5cbiAgICogQHBhcmFtIHtzdHJpbmd9IG9sZENvbHVtbk5hbWUgLSBQcmV2aW91cyBjb2x1bW4gbmFtZS5cbiAgICogQHBhcmFtIHtzdHJpbmd9IG5ld0NvbHVtbk5hbWUgLSBOZXcgY29sdW1uIG5hbWUuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIHdoZW4gY29tcGxldGUuXG4gICAqL1xuICBhc3luYyByZW5hbWVDb2x1bW4odGFibGVOYW1lLCBvbGRDb2x1bW5OYW1lLCBuZXdDb2x1bW5OYW1lKSB7XG4gICAgdGhpcy5fYXNzZXJ0Tm90UmVhZE9ubHkoKVxuICAgIGNvbnN0IHRhYmxlQ29sdW1uID0gbmV3IFRhYmxlQ29sdW1uKG9sZENvbHVtbk5hbWUpXG5cbiAgICB0YWJsZUNvbHVtbi5zZXROZXdOYW1lKG5ld0NvbHVtbk5hbWUpXG5cbiAgICBjb25zdCB0YWJsZURhdGEgPSBuZXcgVGFibGVEYXRhKHRhYmxlTmFtZSlcblxuICAgIHRhYmxlRGF0YS5hZGRDb2x1bW4odGFibGVDb2x1bW4pXG5cbiAgICBjb25zdCBhbHRlclRhYmxlU1FMcyA9IGF3YWl0IHRoaXMuYWx0ZXJUYWJsZVNRTHModGFibGVEYXRhKVxuXG4gICAgZm9yIChjb25zdCBhbHRlclRhYmxlU1FMIG9mIGFsdGVyVGFibGVTUUxzKSB7XG4gICAgICBhd2FpdCB0aGlzLnF1ZXJ5KGFsdGVyVGFibGVTUUwpXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgcmVsZWFzZSBzYXZlIHBvaW50LlxuICAgKiBAcGFyYW0ge3N0cmluZ30gc2F2ZVBvaW50TmFtZSAtIFNhdmUgcG9pbnQgbmFtZS5cbiAgICogQHBhcmFtIHtQaWNrPFF1ZXJ5T3B0aW9ucywgXCJvcGVyYXRpb25Pd25lclwiPn0gW29wdGlvbnNdIC0gVHJhbnNhY3Rpb24gb3duZXJzaGlwLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyB3aGVuIGNvbXBsZXRlLlxuICAgKi9cbiAgYXN5bmMgcmVsZWFzZVNhdmVQb2ludChzYXZlUG9pbnROYW1lLCBvcHRpb25zID0ge30pIHtcbiAgICBhd2FpdCBjb29yZGluYXRlU2hhcmVkVHJhbnNhY3Rpb25Db25uZWN0aW9uKHRoaXMsIGFzeW5jICgpID0+IHtcbiAgICAgIGF3YWl0IHRoaXMuX3RyYW5zYWN0aW9uc0FjdGlvbnNNdXRleC5zeW5jKGFzeW5jICgpID0+IHtcbiAgICAgICAgYXdhaXQgdGhpcy5fcmVsZWFzZVNhdmVQb2ludEFjdGlvbihzYXZlUG9pbnROYW1lLCBvcHRpb25zKVxuICAgICAgfSlcbiAgICB9LCBvcHRpb25zLm9wZXJhdGlvbk93bmVyKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgcmVsZWFzZSBzYXZlIHBvaW50IGFjdGlvbi5cbiAgICogQHBhcmFtIHtzdHJpbmd9IHNhdmVQb2ludE5hbWUgLSBTYXZlIHBvaW50IG5hbWUuXG4gICAqIEBwYXJhbSB7UGljazxRdWVyeU9wdGlvbnMsIFwib3BlcmF0aW9uT3duZXJcIj59IFtvcHRpb25zXSAtIFRyYW5zYWN0aW9uIG93bmVyc2hpcC5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgd2hlbiBjb21wbGV0ZS5cbiAgICovXG4gIGFzeW5jIF9yZWxlYXNlU2F2ZVBvaW50QWN0aW9uKHNhdmVQb2ludE5hbWUsIG9wdGlvbnMgPSB7fSkge1xuICAgIHRyeSB7XG4gICAgICBhd2FpdCB0aGlzLnF1ZXJ5KGBSRUxFQVNFIFNBVkVQT0lOVCAke3NhdmVQb2ludE5hbWV9YCwgb3B0aW9ucylcbiAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgY29uc3QgbWVzc2FnZSA9IGVycm9yIGluc3RhbmNlb2YgRXJyb3IgPyBlcnJvci5tZXNzYWdlIDogYCR7ZXJyb3J9YFxuXG4gICAgICAvLyBTYXZlcG9pbnQgbWF5IGFscmVhZHkgYmUgZ29uZSBpZiB0aGUgZGF0YWJhc2Ugcm9sbGVkIGJhY2sgYXV0b21hdGljYWxseVxuICAgICAgaWYgKG1lc3NhZ2UudG9Mb3dlckNhc2UoKS5pbmNsdWRlcyhcInNhdmVwb2ludFwiKSAmJiBtZXNzYWdlLnRvTG93ZXJDYXNlKCkuaW5jbHVkZXMoXCJkb2VzIG5vdCBleGlzdFwiKSkge1xuICAgICAgICB0aGlzLmxvZ2dlci5kZWJ1ZyhgUmVsZWFzZSBzYXZlcG9pbnQgaWdub3JlZCBiZWNhdXNlIGl0IG5vIGxvbmdlciBleGlzdHM6ICR7c2F2ZVBvaW50TmFtZX1gKVxuICAgICAgICByZXR1cm5cbiAgICAgIH1cblxuICAgICAgdGhyb3cgZXJyb3JcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogUnVucyByb2xsYmFjayBzYXZlIHBvaW50LlxuICAgKiBAcGFyYW0ge3N0cmluZ30gc2F2ZVBvaW50TmFtZSAtIFNhdmUgcG9pbnQgbmFtZS5cbiAgICogQHBhcmFtIHtQaWNrPFF1ZXJ5T3B0aW9ucywgXCJvcGVyYXRpb25Pd25lclwiPn0gW29wdGlvbnNdIC0gVHJhbnNhY3Rpb24gb3duZXJzaGlwLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyB3aGVuIGNvbXBsZXRlLlxuICAgKi9cbiAgYXN5bmMgcm9sbGJhY2tTYXZlUG9pbnQoc2F2ZVBvaW50TmFtZSwgb3B0aW9ucyA9IHt9KSB7XG4gICAgYXdhaXQgY29vcmRpbmF0ZVNoYXJlZFRyYW5zYWN0aW9uQ29ubmVjdGlvbih0aGlzLCBhc3luYyAoKSA9PiB7XG4gICAgICBhd2FpdCB0aGlzLl90cmFuc2FjdGlvbnNBY3Rpb25zTXV0ZXguc3luYyhhc3luYyAoKSA9PiB7XG4gICAgICAgIGF3YWl0IHRoaXMuX3JvbGxiYWNrU2F2ZVBvaW50QWN0aW9uKHNhdmVQb2ludE5hbWUsIG9wdGlvbnMpXG4gICAgICB9KVxuICAgIH0sIG9wdGlvbnMub3BlcmF0aW9uT3duZXIpXG4gIH1cblxuICAvKipcbiAgICogUnVucyByb2xsYmFjayBzYXZlIHBvaW50IGFjdGlvbi5cbiAgICogQHBhcmFtIHtzdHJpbmd9IHNhdmVQb2ludE5hbWUgLSBTYXZlIHBvaW50IG5hbWUuXG4gICAqIEBwYXJhbSB7UGljazxRdWVyeU9wdGlvbnMsIFwib3BlcmF0aW9uT3duZXJcIj59IFtvcHRpb25zXSAtIFRyYW5zYWN0aW9uIG93bmVyc2hpcC5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgd2hlbiBjb21wbGV0ZS5cbiAgICovXG4gIGFzeW5jIF9yb2xsYmFja1NhdmVQb2ludEFjdGlvbihzYXZlUG9pbnROYW1lLCBvcHRpb25zID0ge30pIHtcbiAgICBhd2FpdCB0aGlzLnF1ZXJ5KGBST0xMQkFDSyBUTyBTQVZFUE9JTlQgJHtzYXZlUG9pbnROYW1lfWAsIG9wdGlvbnMpXG4gIH1cblxuICAvKipcbiAgICogVHJ1bmNhdGVzIHRoZSBnaXZlbiB0YWJsZSBzbmFwc2hvdC4gRHJpdmVycyBjYW4gb3ZlcnJpZGUgdGhpcyB0byBpc3N1ZSBvbmUgYmF0Y2guXG4gICAqIEBwcm90ZWN0ZWRcbiAgICogQHBhcmFtIHtBcnJheTxpbXBvcnQoXCIuL2Jhc2UtdGFibGUuanNcIikuZGVmYXVsdD59IHRhYmxlcyAtIEVsaWdpYmxlIHRhYmxlcyBmb3IgdGhpcyBjbGVhbnVwIGF0dGVtcHQuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIHdoZW4gZXZlcnkgdGFibGUgaGFzIGJlZW4gY2xlYW5lZC5cbiAgICovXG4gIGFzeW5jIHRydW5jYXRlVGFibGVzKHRhYmxlcykge1xuICAgIGNvbnN0IHRydW5jYXRlRXJyb3JzID0gW11cblxuICAgIGZvciAoY29uc3QgdGFibGUgb2YgdGFibGVzKSB7XG4gICAgICB0cnkge1xuICAgICAgICBhd2FpdCB0YWJsZS50cnVuY2F0ZSh7Y2FzY2FkZTogdHJ1ZX0pXG4gICAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgICB0cnVuY2F0ZUVycm9ycy5wdXNoKGVycm9yKVxuICAgICAgfVxuICAgIH1cblxuICAgIGlmICh0cnVuY2F0ZUVycm9ycy5sZW5ndGggPiAwKSB0aHJvdyB0cnVuY2F0ZUVycm9yc1swXVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgdHJ1bmNhdGUgYWxsIHRhYmxlcy5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgd2hlbiBjb21wbGV0ZS5cbiAgICovXG4gIGFzeW5jIHRydW5jYXRlQWxsVGFibGVzKCkge1xuICAgIHRoaXMuX2Fzc2VydE5vdFJlYWRPbmx5KClcbiAgICBjb25zdCB0YWJsZXMgPSAoYXdhaXQgdGhpcy5nZXRUYWJsZXMoKSkuZmlsdGVyKCh0YWJsZSkgPT4gdGFibGUuZ2V0TmFtZSgpICE9IFwic2NoZW1hX21pZ3JhdGlvbnNcIilcblxuICAgIGlmICh0YWJsZXMubGVuZ3RoID09IDApIHJldHVyblxuXG4gICAgYXdhaXQgdGhpcy5fdHJ1bmNhdGVBbGxUYWJsZXModGFibGVzKVxuICAgIGF3YWl0IHRoaXMuZmx1c2hQZW5kaW5nV3JpdGVzKClcbiAgfVxuXG4gIC8qKlxuICAgKiBPd25zIHRoZSBmb3JlaWduLWtleSBib3VuZGFyeSBhcm91bmQgZXZlcnkgY2xlYW51cCByZXRyeS4gRHJpdmVycyB0aGF0XG4gICAqIHJlcXVpcmUgb25lIHBoeXNpY2FsIHJlcXVlc3QgZm9yIHRoZSBmdWxsIG9wZXJhdGlvbiBtYXkgb3ZlcnJpZGUgaXQuXG4gICAqIEBwcm90ZWN0ZWRcbiAgICogQHBhcmFtIHtBcnJheTxpbXBvcnQoXCIuL2Jhc2UtdGFibGUuanNcIikuZGVmYXVsdD59IHRhYmxlcyAtIEVsaWdpYmxlIHRhYmxlcy5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgYWZ0ZXIgY2xlYW51cCBzdWNjZWVkcy5cbiAgICovXG4gIGFzeW5jIF90cnVuY2F0ZUFsbFRhYmxlcyh0YWJsZXMpIHtcbiAgICBhd2FpdCB0aGlzLndpdGhEaXNhYmxlZEZvcmVpZ25LZXlzKGFzeW5jICgpID0+IHtcbiAgICAgIGF3YWl0IHRoaXMuX3RydW5jYXRlQWxsVGFibGVzV2l0aFJldHJpZXModGFibGVzKVxuICAgIH0pXG4gIH1cblxuICAvKipcbiAgICogUmV0cmllcyBjbGVhbnVwIGFnYWluc3QgcmVmcmVzaGVkIHNjaGVtYSBzbmFwc2hvdHMuIERyaXZlcnMgbWF5IG92ZXJyaWRlXG4gICAqIGBfdHJ1bmNhdGVBbGxUYWJsZXNBdHRlbXB0YCB0byBvd24gYSBjb21wbGV0ZSBkcml2ZXItc3BlY2lmaWMgYXR0ZW1wdC5cbiAgICogQHByb3RlY3RlZFxuICAgKiBAcGFyYW0ge0FycmF5PGltcG9ydChcIi4vYmFzZS10YWJsZS5qc1wiKS5kZWZhdWx0Pn0gaW5pdGlhbFRhYmxlcyAtIEluaXRpYWwgZWxpZ2libGUgdGFibGVzLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyBhZnRlciBvbmUgY2xlYW51cCBhdHRlbXB0IHN1Y2NlZWRzLlxuICAgKi9cbiAgYXN5bmMgX3RydW5jYXRlQWxsVGFibGVzV2l0aFJldHJpZXMoaW5pdGlhbFRhYmxlcykge1xuICAgIGxldCB0YWJsZXMgPSBpbml0aWFsVGFibGVzXG5cbiAgICBmb3IgKGxldCB0cmllcyA9IDE7IHRyaWVzIDw9IDY7IHRyaWVzKyspIHtcbiAgICAgIHRyeSB7XG4gICAgICAgIGF3YWl0IHRoaXMuX3RydW5jYXRlQWxsVGFibGVzQXR0ZW1wdCh0YWJsZXMpXG4gICAgICAgIHJldHVyblxuICAgICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgICAgY29uc29sZS5lcnJvcihlcnJvcilcblxuICAgICAgICBpZiAodHJpZXMgPT0gNikgdGhyb3cgZXJyb3JcblxuICAgICAgICAvLyBBIHRydW5jYXRlIGZhaWxlZCDigJQgdGhlIHNjaGVtYSBjYWNoZSBtYXkgc3RpbGwgbGlzdCBhIHRhYmxlIHRoYXQgd2FzXG4gICAgICAgIC8vIGRyb3BwZWQgb3V0IGZyb20gdW5kZXIgdXMgKGUuZy4gYSBkYjpyb2xsYmFjayB0ZXN0IHRoYXQgbGVmdCB0aGVcbiAgICAgICAgLy8gc2hhcmVkIERCIHJvbGxlZCBiYWNrKS4gQ2xlYXIgaXQgc28gdGhlIG5leHQgcGFzcyByZS1yZWFkcyB0aGUgbGl2ZVxuICAgICAgICAvLyB0YWJsZSBsaXN0IGFuZCBubyBsb25nZXIgdHJpZXMgdG8gdHJ1bmNhdGUgYSB0YWJsZSB0aGF0IGlzIGdvbmUuXG4gICAgICAgIHRoaXMuY2xlYXJTY2hlbWFDYWNoZSgpXG4gICAgICAgIHRhYmxlcyA9IChhd2FpdCB0aGlzLmdldFRhYmxlcygpKS5maWx0ZXIoKHRhYmxlKSA9PiB0YWJsZS5nZXROYW1lKCkgIT0gXCJzY2hlbWFfbWlncmF0aW9uc1wiKVxuXG4gICAgICAgIGlmICh0YWJsZXMubGVuZ3RoID09IDApIHJldHVyblxuICAgICAgfVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIG9uZSBjbGVhbnVwIGF0dGVtcHQgd2hpbGUgdGhlIGRlZmF1bHQgb3duZXIgaGFzIGNvbnN0cmFpbnRzIGRpc2FibGVkLlxuICAgKiBAcHJvdGVjdGVkXG4gICAqIEBwYXJhbSB7QXJyYXk8aW1wb3J0KFwiLi9iYXNlLXRhYmxlLmpzXCIpLmRlZmF1bHQ+fSB0YWJsZXMgLSBDdXJyZW50IGVsaWdpYmxlIHRhYmxlcy5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgd2hlbiB0aGUgYXR0ZW1wdCBjb21wbGV0ZXMuXG4gICAqL1xuICBhc3luYyBfdHJ1bmNhdGVBbGxUYWJsZXNBdHRlbXB0KHRhYmxlcykge1xuICAgIGF3YWl0IHRoaXMudHJ1bmNhdGVUYWJsZXModGFibGVzKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgdXBkYXRlLlxuICAgKiBAcGFyYW0ge1VwZGF0ZVNxbEFyZ3NUeXBlfSBhcmdzIC0gT3B0aW9ucyBvYmplY3QuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIHdoZW4gY29tcGxldGUuXG4gICAqL1xuICBhc3luYyB1cGRhdGUoYXJncykge1xuICAgIHRoaXMuX2Fzc2VydE5vdFJlYWRPbmx5KClcbiAgICBjb25zdCBzcWwgPSB0aGlzLnVwZGF0ZVNxbChhcmdzKVxuXG4gICAgYXdhaXQgdGhpcy5xdWVyeShzcWwpXG4gIH1cblxuICAvKipcbiAgICogUnVucyB1cGRhdGUgc3FsLlxuICAgKiBAYWJzdHJhY3RcbiAgICogQHBhcmFtIHtVcGRhdGVTcWxBcmdzVHlwZX0gYXJncyAtIE9wdGlvbnMgb2JqZWN0LlxuICAgKiBAcmV0dXJucyB7c3RyaW5nfSAtIFNRTCBzdHJpbmcuXG4gICAqL1xuICB1cGRhdGVTcWwoYXJncykgeyAvLyBlc2xpbnQtZGlzYWJsZS1saW5lIG5vLXVudXNlZC12YXJzXG4gICAgdGhyb3cgbmV3IEVycm9yKFwiJ2Rpc2FibGVGb3JlaWduS2V5cycgbm90IGltcGxlbWVudGVkXCIpXG4gIH1cblxuICAvKipcbiAgICogUnVucyB1cHNlcnQgc3FsLlxuICAgKiBAYWJzdHJhY3RcbiAgICogQHBhcmFtIHtVcHNlcnRTcWxBcmdzVHlwZX0gYXJncyAtIE9wdGlvbnMgb2JqZWN0LlxuICAgKiBAcmV0dXJucyB7c3RyaW5nfSAtIFNRTCBzdHJpbmcuXG4gICAqL1xuICB1cHNlcnRTcWwoYXJncykgeyAvLyBlc2xpbnQtZGlzYWJsZS1saW5lIG5vLXVudXNlZC12YXJzXG4gICAgdGhyb3cgbmV3IEVycm9yKFwiJ3Vwc2VydFNxbCcgbm90IGltcGxlbWVudGVkXCIpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBkaXNhYmxlIGZvcmVpZ24ga2V5cy5cbiAgICogQGFic3RyYWN0XG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIHdoZW4gY29tcGxldGUuXG4gICAqL1xuICBkaXNhYmxlRm9yZWlnbktleXMoKSB7XG4gICAgdGhyb3cgbmV3IEVycm9yKFwiJ2Rpc2FibGVGb3JlaWduS2V5cycgbm90IGltcGxlbWVudGVkXCIpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBlbmFibGUgZm9yZWlnbiBrZXlzLlxuICAgKiBAYWJzdHJhY3RcbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgd2hlbiBjb21wbGV0ZS5cbiAgICovXG4gIGVuYWJsZUZvcmVpZ25LZXlzKCkge1xuICAgIHRocm93IG5ldyBFcnJvcihcIidlbmFibGVGb3JlaWduS2V5cycgbm90IGltcGxlbWVudGVkXCIpXG4gIH1cblxuICAvKipcbiAgICogUnVucyB3aXRoIGRpc2FibGVkIGZvcmVpZ24ga2V5cy5cbiAgICogQHBhcmFtIHsoKSA9PiB2b2lkfSBjYWxsYmFjayAtIENhbGxiYWNrIGZ1bmN0aW9uLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59IC0gUmVzb2x2ZXMgd2l0aCB0aGUgd2l0aCBkaXNhYmxlZCBmb3JlaWduIGtleXMuXG4gICAqL1xuICBhc3luYyB3aXRoRGlzYWJsZWRGb3JlaWduS2V5cyhjYWxsYmFjaykge1xuICAgIGF3YWl0IHRoaXMuZGlzYWJsZUZvcmVpZ25LZXlzKClcblxuICAgIHRyeSB7XG4gICAgICByZXR1cm4gYXdhaXQgY2FsbGJhY2soKVxuICAgIH0gZmluYWxseSB7XG4gICAgICBhd2FpdCB0aGlzLmVuYWJsZUZvcmVpZ25LZXlzKClcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogQmxvY2tzIHVudGlsIGEgbmFtZWQgYWR2aXNvcnkgbG9jayBpcyBhY3F1aXJlZCBvbiB0aGlzIGNvbm5lY3Rpb24uXG4gICAqIEFkdmlzb3J5IGxvY2tzIGFyZSBjb25uZWN0aW9uLXNjb3BlZCBhbmQgZG8gbm90IGludGVyYWN0IHdpdGggcm93IG9yXG4gICAqIHRhYmxlIGxvY2tzOyB0aGV5IGFyZSBwdXJlbHkgY29vcGVyYXRpdmUgYmV0d2VlbiBjYWxsZXJzIHRoYXQgdXNlIHRoZVxuICAgKiBzYW1lIG5hbWUgYW5kIGxldCB5b3Ugc2VyaWFsaXplIGZ1bmN0aW9uYWxpdHkgd2l0aG91dCBibG9ja2luZyByZWFkZXJzXG4gICAqIG9yIHdyaXRlcnMgdGhhdCBkbyBub3QgcGFydGljaXBhdGUgaW4gdGhlIHNhbWUgbmFtZWQgbG9jay5cbiAgICpcbiAgICogQWNxdWlzaXRpb24gcnVucyBhcyBhIHR3by10aWVyIGNoYWluOlxuICAgKiAxLiBUaGUgKipwcm9jZXNzLWxvY2FsIHByZS1maWx0ZXIgdGllcioqICh0aGlzIGNsYXNzJyBGSUZPIHdhaXRlclxuICAgKiAgICBxdWV1ZSkgc2VyaWFsaXplcyBzYW1lLXByb2Nlc3MgY2FsbGVycyBmb3IgdGhlIGxvY2sgbmFtZSB3aXRob3V0XG4gICAqICAgIGlzc3VpbmcgYW55IGRyaXZlci1uYXRpdmUgbG9jayBxdWVyeSBhbmQgd2l0aG91dCBwYXJraW5nIGFcbiAgICogICAgY29ubmVjdGlvbiBpbiBhIGRyaXZlciBsb2NrIHN0YXRlLiBBIHF1ZXVlZCBjYWxsZXIgbmV2ZXIgcmVhY2hlc1xuICAgKiAgICB0aWVyIDIgdW50aWwgdGhlIGluLXByb2Nlc3MgaG9sZGVyIHJlbGVhc2VzLlxuICAgKiAyLiBUaGUgKipkcml2ZXItbmF0aXZlIHRpZXIqKiAoYF9hY3F1aXJlQWR2aXNvcnlMb2NrYDogTWFyaWFEQlxuICAgKiAgICBgR0VUX0xPQ0tgLCBQb3N0Z3JlU1FMIGBwZ19hZHZpc29yeV9sb2NrYCwgU1FMIFNlcnZlclxuICAgKiAgICBgc3BfZ2V0YXBwbG9ja2AsIFNRTGl0ZSBmaWxlc3lzdGVtIGxvY2sgb24gTm9kZSkgY29uZmlybXMgdGhlXG4gICAqICAgIGNyb3NzLXByb2Nlc3MvY3Jvc3MtaG9zdCBleGNsdXNpb24uXG4gICAqXG4gICAqIFRoZSBwcm9jZXNzLWxvY2FsIHRpZXIgaXMgYSBwcmUtZmlsdGVyLCAqKm5ldmVyIHRoZSBhdXRob3JpdHkqKjogYVxuICAgKiBsb2NrIG5hbWUgdGhhdCBvdGhlciBwcm9jZXNzZXMgb3IgaG9zdHMgY2FuIHJlcXVlc3QgaXMgb25seSBncmFudGVkXG4gICAqIGFmdGVyIHRoZSBkcml2ZXItbmF0aXZlIHRpZXIgKG9yLCBvbmNlIHRoZSBTVEMtMjEwIGJhY2tlbmQgY2hhaW5cbiAgICogbGFuZHMsIHRoZSBjb25maWd1cmVkIGNyb3NzLWhvc3QgYmFja2VuZCkgY29uZmlybXMgaXQuIElmIHRoZSBuYXRpdmVcbiAgICogdGllciBkZW5pZXMgb3IgdGltZXMgb3V0LCB0aGUgaW4tcHJvY2VzcyBob2xkIGlzIHJvbGxlZCBiYWNrLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gbmFtZSAtIExvY2sgbmFtZS5cbiAgICogQHBhcmFtIHt7dGltZW91dE1zPzogbnVtYmVyIHwgbnVsbH19IFthcmdzXSAtIE9wdGlvbmFsIHRpbWVvdXQgaW4gbWlsbGlzZWNvbmRzOyBgbnVsbGAgYmxvY2tzIGZvcmV2ZXIsIGFuZCBhbiBvbWl0dGVkIHZhbHVlIHVzZXMgdGhlIGRhdGFiYXNlJ3MgYGFkdmlzb3J5TG9ja0FjcXVpcmVUaW1lb3V0TXNgIG9yIHRoZSBmcmFtZXdvcmsgZGVmYXVsdC4gVGhlIGJvdW5kIGNvdmVycyB0aGUgd2hvbGUgdHdvLXRpZXIgYWNxdWlzaXRpb24uXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPGJvb2xlYW4+fSAtIFJlc29sdmVzIHRvIHRydWUgd2hlbiB0aGUgbG9jayBoYXMgYmVlbiBhY3F1aXJlZCwgZmFsc2UgaWYgdGhlIHRpbWVvdXQgZWxhcHNlZC5cbiAgICovXG4gIGFzeW5jIGFjcXVpcmVBZHZpc29yeUxvY2sobmFtZSwgYXJncyA9IHt9KSB7XG4gICAgY29uc3QgdGltZW91dE1zID0gdGhpcy5hZHZpc29yeUxvY2tBY3F1aXJlVGltZW91dE1zKGFyZ3MpXG4gICAgY29uc3QgZGVhZGxpbmVNcyA9IHR5cGVvZiB0aW1lb3V0TXMgPT09IFwibnVtYmVyXCIgJiYgdGltZW91dE1zID49IDAgPyBEYXRlLm5vdygpICsgdGltZW91dE1zIDogbnVsbFxuICAgIGNvbnN0IGxvY2FsQWNxdWlzaXRpb24gPSBhd2FpdCB0aGlzLl9hY3F1aXJlUHJvY2Vzc0xvY2FsQWR2aXNvcnlMb2NrKG5hbWUsIHt0aW1lb3V0TXN9KVxuXG4gICAgaWYgKCFsb2NhbEFjcXVpc2l0aW9uLmFjcXVpcmVkKSByZXR1cm4gZmFsc2VcblxuICAgIGlmICghdGhpcy5zdXBwb3J0c0RyaXZlck5hdGl2ZUFkdmlzb3J5TG9jaygpKSB7XG4gICAgICAvLyBObyBkcml2ZXItbmF0aXZlIHRpZXIgZXhpc3RzIGZvciB0aGlzIGRyaXZlciAocGxhaW4gU1FMaXRlKTogdGhlXG4gICAgICAvLyBwcm9jZXNzLWxvY2FsIHRpZXIgaXMgdGhlIHdob2xlIGltcGxlbWVudGF0aW9uLCBhbmQgY2FsbGVycyBtdXN0XG4gICAgICAvLyBub3QgcmVhZCBpdCBhcyBhIGNyb3NzLXByb2Nlc3MgZ3VhcmFudGVlLlxuICAgICAgdGhpcy5fdHJhY2tBZHZpc29yeUxvY2sobmFtZSlcblxuICAgICAgcmV0dXJuIHRydWVcbiAgICB9XG5cbiAgICAvLyBPbmx5IGEgY2FsbGVyIHRoYXQgYWN0dWFsbHkgcXVldWVkIGluIHRoZSBwcm9jZXNzLWxvY2FsIHRpZXIgc3BlbmRzXG4gICAgLy8gcGFydCBvZiB0aGUgYWNxdWlyZSBidWRnZXQ7IGFuIHVuY29udGVuZGVkIGFjcXVpc2l0aW9uIHBhc3NlcyB0aGVcbiAgICAvLyBmdWxsIGJvdW5kIG9uIHRvIHRoZSBkcml2ZXItbmF0aXZlIHRpZXIuXG4gICAgY29uc3QgbmF0aXZlVGltZW91dE1zID0gbG9jYWxBY3F1aXNpdGlvbi53YWl0ZWQgJiYgZGVhZGxpbmVNcyAhPT0gbnVsbFxuICAgICAgPyBNYXRoLm1heCgwLCBkZWFkbGluZU1zIC0gRGF0ZS5ub3coKSlcbiAgICAgIDogdGltZW91dE1zXG5cbiAgICBjb25zdCBzdGFydGVkQXQgPSBEYXRlLm5vdygpXG5cbiAgICAvKiogQHR5cGUge2Jvb2xlYW59ICovXG4gICAgbGV0IG5hdGl2ZUFjcXVpcmVkXG5cbiAgICB0cnkge1xuICAgICAgbmF0aXZlQWNxdWlyZWQgPSBhd2FpdCB0aGlzLl9hY3F1aXJlQWR2aXNvcnlMb2NrKG5hbWUsIHt0aW1lb3V0TXM6IG5hdGl2ZVRpbWVvdXRNc30pXG4gICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgIHRoaXMuX3JlbGVhc2VQcm9jZXNzTG9jYWxBZHZpc29yeUxvY2sobmFtZSlcbiAgICAgIHRocm93IGVycm9yXG4gICAgfVxuXG4gICAgY29uc3QgZHVyYXRpb25NcyA9IERhdGUubm93KCkgLSBzdGFydGVkQXRcblxuICAgIGlmIChuYXRpdmVBY3F1aXJlZCkge1xuICAgICAgdGhpcy5fdHJhY2tBZHZpc29yeUxvY2sobmFtZSlcblxuICAgICAgY29uc3Qgc2xvd0FjcXVpcmVNcyA9IGFkdmlzb3J5TG9ja1RlbGVtZXRyeVRocmVzaG9sZHModGhpcy5nZXRBcmdzKCkpLnNsb3dBY3F1aXJlTXNcblxuICAgICAgaWYgKHNsb3dBY3F1aXJlTXMgIT09IG51bGwgJiYgZHVyYXRpb25NcyA+IHNsb3dBY3F1aXJlTXMpIHtcbiAgICAgICAgYXdhaXQgdGhpcy5fcmVwb3J0QWR2aXNvcnlMb2NrVGVsZW1ldHJ5KHtldmVudDogXCJhZHZpc29yeS1sb2NrLXNsb3ctYWNxdWlyZVwiLCBsb2NrTmFtZTogbmFtZSwgZHVyYXRpb25Ncywgb3V0Y29tZTogXCJhY3F1aXJlZFwiLCB0aW1lb3V0TXN9KVxuICAgICAgfVxuXG4gICAgICByZXR1cm4gdHJ1ZVxuICAgIH1cblxuICAgIHRoaXMuX3JlbGVhc2VQcm9jZXNzTG9jYWxBZHZpc29yeUxvY2sobmFtZSlcblxuICAgIC8vIFRoZSB3YWl0IGV4Y2VlZGVkIGl0cyBib3VuZDogYXR0cmlidXRlIHRoZSBsb2NrIHRvIHRoZSBob2xkZXIgdGhhdFxuICAgIC8vIGJsb2NrZWQgaXQsIGNhcHR1cmVkIGF0IHRoaXMgbW9tZW50IG9uIHRoaXMgdGllci5cbiAgICBhd2FpdCB0aGlzLl9yZXBvcnRBZHZpc29yeUxvY2tUZWxlbWV0cnkoe2V2ZW50OiBcImFkdmlzb3J5LWxvY2stYWNxdWlyZS10aW1lb3V0XCIsIGxvY2tOYW1lOiBuYW1lLCBkdXJhdGlvbk1zLCBvdXRjb21lOiBcInRpbWVvdXRcIiwgdGltZW91dE1zLCBjYXB0dXJlSG9sZGVyOiB0cnVlfSlcblxuICAgIHJldHVybiBmYWxzZVxuICB9XG5cbiAgLyoqXG4gICAqIFJlc29sdmVzIHRoZSB3YWl0IGJvdW5kIGZvciBvbmUgYWR2aXNvcnktbG9jayBhY3F1aXNpdGlvbi5cbiAgICogQW4gZXhwbGljaXQgYHRpbWVvdXRNc2Ag4oCUIGluY2x1ZGluZyBhbiBleHBsaWNpdCBgbnVsbGAgb3B0LW91dCDigJQgYWx3YXlzXG4gICAqIHdpbnMuIE90aGVyd2lzZSB0aGUgZGF0YWJhc2UgY29uZmlndXJhdGlvbidzIGBhZHZpc29yeUxvY2tBY3F1aXJlVGltZW91dE1zYFxuICAgKiBhcHBsaWVzLCBhbmQgYSBudWxsIHRoZXJlIG9wdHMgb3V0IHRvby4gT25seSB3aGVuIG5laXRoZXIgaXMgY29uZmlndXJlZCBkb2VzXG4gICAqIHRoZSBmcmFtZXdvcmsgZGVmYXVsdCBib3VuZCB0aGUgd2FpdC5cbiAgICogQHBhcmFtIHt7dGltZW91dE1zPzogbnVtYmVyIHwgbnVsbH19IFthcmdzXSAtIEFjcXVpc2l0aW9uIG9wdGlvbnMgZnJvbSB0aGUgY2FsbGVyLlxuICAgKiBAcmV0dXJucyB7bnVtYmVyIHwgbnVsbH0gLSBXYWl0IGJvdW5kIGluIG1pbGxpc2Vjb25kcywgb3IgYG51bGxgIGZvciBhbiBpbmRlZmluaXRlIHdhaXQuXG4gICAqL1xuICBhZHZpc29yeUxvY2tBY3F1aXJlVGltZW91dE1zKGFyZ3MgPSB7fSkge1xuICAgIGlmIChhcmdzLnRpbWVvdXRNcyAhPT0gdW5kZWZpbmVkKSByZXR1cm4gYXJncy50aW1lb3V0TXNcblxuICAgIGNvbnN0IGNvbmZpZ3VyZWQgPSB0aGlzLmdldEFyZ3MoKT8uYWR2aXNvcnlMb2NrQWNxdWlyZVRpbWVvdXRNc1xuXG4gICAgaWYgKGNvbmZpZ3VyZWQgPT09IG51bGwpIHJldHVybiBudWxsXG4gICAgaWYgKHR5cGVvZiBjb25maWd1cmVkID09PSBcIm51bWJlclwiICYmIGNvbmZpZ3VyZWQgPj0gMCkgcmV0dXJuIGNvbmZpZ3VyZWRcblxuICAgIHJldHVybiBERUZBVUxUX0FEVklTT1JZX0xPQ0tfQUNRVUlSRV9USU1FT1VUX01TXG4gIH1cblxuICAvKipcbiAgICogV2hldGhlciB0aGlzIGRyaXZlciBoYXMgYSBkcml2ZXItbmF0aXZlIGFkdmlzb3J5LWxvY2sgdGllciBiZWhpbmQgdGhlXG4gICAqIHByb2Nlc3MtbG9jYWwgcHJlLWZpbHRlci4gTWFyaWFEQiAoYEdFVF9MT0NLYCksIFBvc3RncmVTUUxcbiAgICogKGBwZ19hZHZpc29yeV9sb2NrYCkgYW5kIFNRTCBTZXJ2ZXIgKGBzcF9nZXRhcHBsb2NrYCkgZG87IFNRTGl0ZSBoYXNcbiAgICogbm8gbmF0aXZlIHByaW1pdGl2ZSAodGhlIE5vZGUgU1FMaXRlIGRyaXZlciBzdWJzdGl0dXRlcyBpdHNcbiAgICogZmlsZXN5c3RlbSBsb2NrIGRpcmVjdG9yeSwgdGhlIHdlYi9uYXRpdmUgYnVpbGRzIGhhdmUgbm90aGluZyksIHNvXG4gICAqIGZvciBwbGFpbiBTUUxpdGUgdGhlIHByb2Nlc3MtbG9jYWwgdGllciBJUyB0aGUgd2hvbGUgaW1wbGVtZW50YXRpb25cbiAgICogYW5kIGNhbGxlcnMgbXVzdCBub3QgcmVhZCBpdCBhcyBhIGNyb3NzLXByb2Nlc3MgZ3VhcmFudGVlLlxuICAgKiBAcmV0dXJucyB7Ym9vbGVhbn0gLSBXaGV0aGVyIHRoZSBkcml2ZXItbmF0aXZlIHRpZXIgZXhpc3RzLlxuICAgKi9cbiAgc3VwcG9ydHNEcml2ZXJOYXRpdmVBZHZpc29yeUxvY2soKSB7XG4gICAgcmV0dXJuIHRydWVcbiAgfVxuXG4gIC8qKlxuICAgKiBXaGV0aGVyIHRoZSBkcml2ZXIncyBuYXRpdmUgdGllciBpcyByZS1lbnRyYW50IHdpdGhpbiB0aGUgc2FtZVxuICAgKiBzZXNzaW9uLiBgR0VUX0xPQ0tgLCBgcGdfYWR2aXNvcnlfbG9ja2AgYW5kIGBzcF9nZXRhcHBsb2NrYCBncmFudCB0aGVcbiAgICogc2FtZSBzZXNzaW9uIHJlcGVhdGVkbHksIHNvIHRoZSBwcm9jZXNzLWxvY2FsIHRpZXIgbXVzdCBsZXQgYVxuICAgKiByZS1hY3F1aXNpdGlvbiBieSBpdHMgb3duIG93bmVyIHBhc3MgdGhyb3VnaCB0byB0aGUgbmF0aXZlIHRpZXIuXG4gICAqIFNRTGl0ZSdzIGVtdWxhdGlvbiAoaW5jbHVkaW5nIHRoZSBOb2RlIGZpbGVzeXN0ZW0gbG9jaykgaXMgbm90XG4gICAqIHJlLWVudHJhbnQsIHNvIHRoZSB0aWVyIGtlZXBzIHRyZWF0aW5nIGEgcmUtYWNxdWlzaXRpb24gYXMgY29udGVudGlvblxuICAgKiBleGFjdGx5IGFzIHRoZSBTUUxpdGUgZW11bGF0aW9uIGFsd2F5cyBoYXMuXG4gICAqIEByZXR1cm5zIHtib29sZWFufSAtIFdoZXRoZXIgc2FtZS1pbnN0YW5jZSByZS1hY3F1aXNpdGlvbiBpcyBob25vcmVkLlxuICAgKi9cbiAgc3VwcG9ydHNSZWVudHJhbnRBZHZpc29yeUxvY2soKSB7XG4gICAgcmV0dXJuIHRydWVcbiAgfVxuXG4gIC8qKlxuICAgKiBQcm9jZXNzLWxvY2FsIHByZS1maWx0ZXIgdGllcjogRklGTyB3YWl0ZXIgcXVldWUgZm9yIG9uZSBsb2NrIG5hbWVcbiAgICogaW5zaWRlIHRoaXMgcHJvY2Vzcy4gVGhpcyBpcyB0aGUgcHJvbW90ZWQgU1FMaXRlIGVtdWxhdGlvbiBmcm9tXG4gICAqIFNUQy0yMTEg4oCUIGl0IG5vdyBydW5zIGluIGZyb250IG9mICoqZXZlcnkqKiBkcml2ZXIncyBuYXRpdmUgdGllciBzbyBhXG4gICAqIHNhbWUtcHJvY2VzcyB3YWl0ZXIgbmV2ZXIgaXNzdWVzIGEgZHJpdmVyLW5hdGl2ZSBsb2NrIHF1ZXJ5IGFuZCBuZXZlclxuICAgKiBwYXJrcyBhIHBvb2xlZCBjb25uZWN0aW9uIGluIGEgZHJpdmVyIGxvY2sgc3RhdGUgd2hpbGUgcXVldWVkLlxuICAgKlxuICAgKiBBIGdyYW50IGhlcmUgbWVhbnMgb25seSBcInlvdSBhcmUgdGhlIG5leHQgY2FsbGVyIGluIHRoaXMgcHJvY2Vzcy5cIlxuICAgKiBJdCBpcyBuZXZlciB0aGUgYXV0aG9yaXR5IGZvciBjcm9zcy1wcm9jZXNzL2Nyb3NzLWhvc3QgZXhjbHVzaW9uOyB0aGVcbiAgICogY2FsbGVyIG11c3Qgc3RpbGwgcGFzcyB0aGUgZHJpdmVyLW5hdGl2ZSB0aWVyIGJlZm9yZSB0aGUgbG9jayBjb3VudHNcbiAgICogYXMgaGVsZC4gQSByZS1lbnRyYW50IGFjcXVpc2l0aW9uIGJ5IHRoZSBvd25pbmcgZHJpdmVyIGluc3RhbmNlIGlzXG4gICAqIGdyYW50ZWQgaW1tZWRpYXRlbHksIG1pcnJvcmluZyB0aGUgc2Vzc2lvbi1zY29wZWQgcmUtZW50cmFuY3kgb2ZcbiAgICogYEdFVF9MT0NLYCAvIGBwZ19hZHZpc29yeV9sb2NrYCAvIGBzcF9nZXRhcHBsb2NrYC5cbiAgICogQHBhcmFtIHtzdHJpbmd9IG5hbWUgLSBMb2NrIG5hbWUuXG4gICAqIEBwYXJhbSB7e3RpbWVvdXRNcz86IG51bWJlciB8IG51bGx9fSBbYXJnc10gLSBPcHRpb25hbCB0aW1lb3V0IGluIG1pbGxpc2Vjb25kczsgYG51bGxgLCBgdW5kZWZpbmVkYCwgb3IgbmVnYXRpdmUgYmxvY2tzIGZvcmV2ZXIuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHthY3F1aXJlZDogYm9vbGVhbiwgd2FpdGVkOiBib29sZWFufT59IC0gV2hldGhlciB0aGUgdGllciBncmFudGVkIHRoaXMgY2FsbGVyLCBhbmQgd2hldGhlciBpdCBoYWQgdG8gcXVldWUgZm9yIGl0LlxuICAgKi9cbiAgYXN5bmMgX2FjcXVpcmVQcm9jZXNzTG9jYWxBZHZpc29yeUxvY2sobmFtZSwge3RpbWVvdXRNc30gPSB7fSkge1xuICAgIGNvbnN0IHN0YXRlID0gVmVsb2Npb3VzRGF0YWJhc2VEcml2ZXJzQmFzZS5fYWR2aXNvcnlMb2NrU3RhdGVcbiAgICBsZXQgd2FpdGVkID0gZmFsc2VcblxuICAgIHdoaWxlIChzdGF0ZS5vd25lcnNCeU5hbWUuaGFzKG5hbWUpKSB7XG4gICAgICBpZiAoc3RhdGUub3duZXJzQnlOYW1lLmdldChuYW1lKSA9PT0gdGhpcyAmJiB0aGlzLnN1cHBvcnRzUmVlbnRyYW50QWR2aXNvcnlMb2NrKCkpIGJyZWFrXG5cbiAgICAgIHdhaXRlZCA9IHRydWVcblxuICAgICAgbGV0IHJlbWFpbmluZ01zID0gbnVsbFxuXG4gICAgICBpZiAodHlwZW9mIHRpbWVvdXRNcyA9PT0gXCJudW1iZXJcIiAmJiB0aW1lb3V0TXMgPj0gMCkge1xuICAgICAgICByZW1haW5pbmdNcyA9IHRpbWVvdXRNc1xuXG4gICAgICAgIGlmIChyZW1haW5pbmdNcyA8PSAwKSByZXR1cm4ge2FjcXVpcmVkOiBmYWxzZSwgd2FpdGVkfVxuICAgICAgfVxuXG4gICAgICBhd2FpdCBuZXcgUHJvbWlzZSgocmVzb2x2ZSkgPT4ge1xuICAgICAgICBjb25zdCB3YWl0ZXJzID0gc3RhdGUud2FpdGVyc0J5TmFtZS5nZXQobmFtZSkgfHwgW11cbiAgICAgICAgLyoqXG4gICAgICAgICAqIFRpbWVvdXQgaGFuZGxlLlxuICAgICAgICAgKiBAdHlwZSB7UmV0dXJuVHlwZTx0eXBlb2Ygc2V0VGltZW91dD4gfCBudWxsfSAqL1xuICAgICAgICBsZXQgdGltZW91dEhhbmRsZSA9IG51bGxcbiAgICAgICAgLyoqXG4gICAgICAgICAqIFJlbW92ZSBhbmQgcmVzb2x2ZS5cbiAgICAgICAgICogQHR5cGUgeygoKSA9PiB2b2lkKSB8IG51bGx9ICovXG4gICAgICAgIGxldCByZW1vdmVBbmRSZXNvbHZlID0gbnVsbFxuXG4gICAgICAgIHJlbW92ZUFuZFJlc29sdmUgPSAoKSA9PiB7XG4gICAgICAgICAgaWYgKHRpbWVvdXRIYW5kbGUpIGNsZWFyVGltZW91dCh0aW1lb3V0SGFuZGxlKVxuXG4gICAgICAgICAgY29uc3QgY3VycmVudCA9IHN0YXRlLndhaXRlcnNCeU5hbWUuZ2V0KG5hbWUpIHx8IFtdXG4gICAgICAgICAgY29uc3QgaW5kZXggPSBjdXJyZW50LmluZGV4T2YoLyoqIEB0eXBlIHsoKSA9PiB2b2lkfSAqLyAocmVtb3ZlQW5kUmVzb2x2ZSkpXG5cbiAgICAgICAgICBpZiAoaW5kZXggPj0gMCkgY3VycmVudC5zcGxpY2UoaW5kZXgsIDEpXG4gICAgICAgICAgaWYgKGN1cnJlbnQubGVuZ3RoID09PSAwKSBzdGF0ZS53YWl0ZXJzQnlOYW1lLmRlbGV0ZShuYW1lKVxuXG4gICAgICAgICAgcmVzb2x2ZSh1bmRlZmluZWQpXG4gICAgICAgIH1cblxuICAgICAgICB3YWl0ZXJzLnB1c2gocmVtb3ZlQW5kUmVzb2x2ZSlcbiAgICAgICAgc3RhdGUud2FpdGVyc0J5TmFtZS5zZXQobmFtZSwgd2FpdGVycylcblxuICAgICAgICBpZiAocmVtYWluaW5nTXMgIT09IG51bGwpIHtcbiAgICAgICAgICB0aW1lb3V0SGFuZGxlID0gc2V0VGltZW91dCgoKSA9PiB7XG4gICAgICAgICAgICBpZiAocmVtb3ZlQW5kUmVzb2x2ZSkgcmVtb3ZlQW5kUmVzb2x2ZSgpXG4gICAgICAgICAgfSwgcmVtYWluaW5nTXMpXG4gICAgICAgIH1cbiAgICAgIH0pXG5cbiAgICAgIGlmICh0eXBlb2YgdGltZW91dE1zID09PSBcIm51bWJlclwiICYmIHRpbWVvdXRNcyA+PSAwICYmIHN0YXRlLm93bmVyc0J5TmFtZS5oYXMobmFtZSkgJiYgIShzdGF0ZS5vd25lcnNCeU5hbWUuZ2V0KG5hbWUpID09PSB0aGlzICYmIHRoaXMuc3VwcG9ydHNSZWVudHJhbnRBZHZpc29yeUxvY2soKSkpIHtcbiAgICAgICAgcmV0dXJuIHthY3F1aXJlZDogZmFsc2UsIHdhaXRlZH1cbiAgICAgIH1cbiAgICB9XG5cbiAgICBzdGF0ZS5vd25lcnNCeU5hbWUuc2V0KG5hbWUsIHRoaXMpXG5cbiAgICByZXR1cm4ge2FjcXVpcmVkOiB0cnVlLCB3YWl0ZWR9XG4gIH1cblxuICAvKipcbiAgICogSGFuZHMgdGhlIHByb2Nlc3MtbG9jYWwgdGllciBmb3Igb25lIGxvY2sgbmFtZSB0byB0aGUgbmV4dCBGSUZPIHdhaXRlcixcbiAgICogYnV0IG9ubHkgd2hlbiAqKnRoaXMqKiBkcml2ZXIgaW5zdGFuY2UgY3VycmVudGx5IG93bnMgaXQuIEEgcmVsZWFzZSBieVxuICAgKiBhIG5vbi1vd25lciBpcyBhIG5vLW9wLCBtYXRjaGluZyB0aGUgXCJ5b3UgY2FuIG9ubHkgcmVsZWFzZSBsb2NrcyB5b3VcbiAgICogb3duXCIgY29udHJhY3Qgb2YgYFJFTEVBU0VfTE9DS2AgLyBgcGdfYWR2aXNvcnlfdW5sb2NrYC5cbiAgICogQHBhcmFtIHtzdHJpbmd9IG5hbWUgLSBMb2NrIG5hbWUuXG4gICAqIEByZXR1cm5zIHtib29sZWFufSAtIFdoZXRoZXIgdGhpcyBpbnN0YW5jZSBvd25lZCB0aGUgdGllciBhbmQgcmVsZWFzZWQgaXQuXG4gICAqL1xuICBfcmVsZWFzZVByb2Nlc3NMb2NhbEFkdmlzb3J5TG9jayhuYW1lKSB7XG4gICAgY29uc3Qgc3RhdGUgPSBWZWxvY2lvdXNEYXRhYmFzZURyaXZlcnNCYXNlLl9hZHZpc29yeUxvY2tTdGF0ZVxuICAgIGNvbnN0IG93bmVyID0gc3RhdGUub3duZXJzQnlOYW1lLmdldChuYW1lKVxuXG4gICAgaWYgKG93bmVyICE9PSB0aGlzKSByZXR1cm4gZmFsc2VcblxuICAgIHN0YXRlLm93bmVyc0J5TmFtZS5kZWxldGUobmFtZSlcblxuICAgIGNvbnN0IHdhaXRlcnMgPSBzdGF0ZS53YWl0ZXJzQnlOYW1lLmdldChuYW1lKVxuXG4gICAgaWYgKHdhaXRlcnMgJiYgd2FpdGVycy5sZW5ndGggPiAwKSB7XG4gICAgICBjb25zdCBuZXh0V2FpdGVyID0gd2FpdGVycy5zaGlmdCgpXG5cbiAgICAgIGlmICh3YWl0ZXJzLmxlbmd0aCA9PT0gMCkgc3RhdGUud2FpdGVyc0J5TmFtZS5kZWxldGUobmFtZSlcbiAgICAgIGlmIChuZXh0V2FpdGVyKSBuZXh0V2FpdGVyKClcbiAgICB9XG5cbiAgICByZXR1cm4gdHJ1ZVxuICB9XG5cbiAgLyoqXG4gICAqIERyaXZlci1zcGVjaWZpYyBibG9ja2luZyBhZHZpc29yeS1sb2NrIGFjcXVpc2l0aW9uIGhvb2suXG4gICAqIFRoaXMgaXMgdGhlICoqZHJpdmVyLW5hdGl2ZSB0aWVyKiogb2YgdGhlIGFjcXVpc2l0aW9uIGNoYWluOiBNYXJpYURCXG4gICAqIGBHRVRfTE9DS2AsIFBvc3RncmVTUUwgYHBnX2Fkdmlzb3J5X2xvY2tgLCBTUUwgU2VydmVyIGBzcF9nZXRhcHBsb2NrYCxcbiAgICogdGhlIE5vZGUgU1FMaXRlIGZpbGVzeXN0ZW0gbG9jay4gSXQgcnVucyBvbmx5IGFmdGVyIHRoZSBwcm9jZXNzLWxvY2FsXG4gICAqIHByZS1maWx0ZXIgdGllciBoYXMgZ3JhbnRlZCB0aGlzIGNhbGxlciBpdHMgdHVybiwgYW5kIGl0cyByZXN1bHQgaXNcbiAgICogd2hhdCBhY3R1YWxseSBjb25maXJtcyBjcm9zcy1wcm9jZXNzL2Nyb3NzLWhvc3QgZXhjbHVzaW9uLlxuICAgKiBAYWJzdHJhY3RcbiAgICogQHBhcmFtIHtzdHJpbmd9IG5hbWUgLSBMb2NrIG5hbWUuXG4gICAqIEBwYXJhbSB7e3RpbWVvdXRNcz86IG51bWJlciB8IG51bGx9fSBbX2FyZ3NdIC0gTG9jayB0aW1lb3V0IG9wdGlvbnMuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPGJvb2xlYW4+fSAtIFdoZXRoZXIgdGhlIGxvY2sgd2FzIGFjcXVpcmVkLlxuICAgKi9cbiAgX2FjcXVpcmVBZHZpc29yeUxvY2sobmFtZSwgX2FyZ3MgPSB7fSkge1xuICAgIHRocm93IG5ldyBFcnJvcihgJ19hY3F1aXJlQWR2aXNvcnlMb2NrJyBub3QgaW1wbGVtZW50ZWQgZm9yICR7dGhpcy5jb25zdHJ1Y3Rvci5uYW1lfWApXG4gIH1cblxuICAvKipcbiAgICogQXR0ZW1wdHMgdG8gYWNxdWlyZSBhIG5hbWVkIGFkdmlzb3J5IGxvY2sgd2l0aG91dCBibG9ja2luZy5cbiAgICpcbiAgICogU2FtZSB0d28tdGllciBjaGFpbiBhcyBgYWNxdWlyZUFkdmlzb3J5TG9ja2A6IHRoZSBwcm9jZXNzLWxvY2FsIHRpZXJcbiAgICogc2hvcnQtY2lyY3VpdHMgY29udGVudGlvbiBiZXR3ZWVuIGNhbGxlcnMgaW4gdGhpcyBwcm9jZXNzIChhIHF1ZXVlZFxuICAgKiBuYW1lIG5ldmVyIHJlYWNoZXMgdGhlIGRyaXZlci1uYXRpdmUgaG9vayksIGFuZCB0aGUgZHJpdmVyLW5hdGl2ZSB0aWVyXG4gICAqIGNvbmZpcm1zIGNyb3NzLXByb2Nlc3MvY3Jvc3MtaG9zdCBleGNsdXNpb24uIEEgZnJlZSBpbi1wcm9jZXNzIHRpZXIgaXNcbiAgICogTk9UIGEgZ3JhbnQg4oCUIHRoZSBuYXRpdmUgdGllciBzdGlsbCBoYXMgdG8gYWdyZWUuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBuYW1lIC0gTG9jayBuYW1lLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxib29sZWFuPn0gLSBSZXNvbHZlcyB0byB0cnVlIGlmIHRoZSBsb2NrIHdhcyBhY3F1aXJlZCwgZmFsc2UgaWYgaXQgd2FzIGFscmVhZHkgaGVsZC5cbiAgICovXG4gIGFzeW5jIHRyeUFjcXVpcmVBZHZpc29yeUxvY2sobmFtZSkge1xuICAgIGNvbnN0IG93bmVyID0gVmVsb2Npb3VzRGF0YWJhc2VEcml2ZXJzQmFzZS5fYWR2aXNvcnlMb2NrU3RhdGUub3duZXJzQnlOYW1lLmdldChuYW1lKVxuXG4gICAgaWYgKG93bmVyICE9PSB1bmRlZmluZWQgJiYgb3duZXIgIT09IHRoaXMpIHJldHVybiBmYWxzZVxuXG4gICAgLy8gU2FtZS1pbnN0YW5jZSByZS1hY3F1aXNpdGlvbiBtaXJyb3JzIHRoZSByZS1lbnRyYW50IHNlbWFudGljcyBvZiB0aGVcbiAgICAvLyBzZXNzaW9uLXNjb3BlZCBkcml2ZXItbmF0aXZlIGxvY2tzOyBhIG5vbi1yZS1lbnRyYW50IGRyaXZlciAoU1FMaXRlKVxuICAgIC8vIGtlZXBzIHRyZWF0aW5nIGl0IGFzIGNvbnRlbnRpb24sIGV4YWN0bHkgYXMgdGhlIGVtdWxhdGlvbiBhbHdheXMgZGlkLlxuICAgIGNvbnN0IHJlZW50cmFudCA9IG93bmVyID09PSB0aGlzXG5cbiAgICBpZiAocmVlbnRyYW50ICYmICF0aGlzLnN1cHBvcnRzUmVlbnRyYW50QWR2aXNvcnlMb2NrKCkpIHJldHVybiBmYWxzZVxuXG4gICAgaWYgKCFyZWVudHJhbnQpIFZlbG9jaW91c0RhdGFiYXNlRHJpdmVyc0Jhc2UuX2Fkdmlzb3J5TG9ja1N0YXRlLm93bmVyc0J5TmFtZS5zZXQobmFtZSwgdGhpcylcblxuICAgIGlmICghdGhpcy5zdXBwb3J0c0RyaXZlck5hdGl2ZUFkdmlzb3J5TG9jaygpKSB7XG4gICAgICB0aGlzLl90cmFja0Fkdmlzb3J5TG9jayhuYW1lKVxuXG4gICAgICByZXR1cm4gdHJ1ZVxuICAgIH1cblxuICAgIC8qKiBAdHlwZSB7Ym9vbGVhbn0gKi9cbiAgICBsZXQgYWNxdWlyZWRcblxuICAgIHRyeSB7XG4gICAgICBhY3F1aXJlZCA9IGF3YWl0IHRoaXMuX3RyeUFjcXVpcmVBZHZpc29yeUxvY2sobmFtZSlcbiAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgaWYgKCFyZWVudHJhbnQpIHRoaXMuX3JlbGVhc2VQcm9jZXNzTG9jYWxBZHZpc29yeUxvY2sobmFtZSlcblxuICAgICAgdGhyb3cgZXJyb3JcbiAgICB9XG5cbiAgICBpZiAoIWFjcXVpcmVkKSB7XG4gICAgICBpZiAoIXJlZW50cmFudCkgdGhpcy5fcmVsZWFzZVByb2Nlc3NMb2NhbEFkdmlzb3J5TG9jayhuYW1lKVxuXG4gICAgICByZXR1cm4gZmFsc2VcbiAgICB9XG5cbiAgICB0aGlzLl90cmFja0Fkdmlzb3J5TG9jayhuYW1lKVxuXG4gICAgcmV0dXJuIHRydWVcbiAgfVxuXG4gIC8qKlxuICAgKiBEcml2ZXItc3BlY2lmaWMgbm9uLWJsb2NraW5nIGFkdmlzb3J5LWxvY2sgYWNxdWlzaXRpb24gaG9vay5cbiAgICogQGFic3RyYWN0XG4gICAqIEBwYXJhbSB7c3RyaW5nfSBuYW1lIC0gTG9jayBuYW1lLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxib29sZWFuPn0gLSBXaGV0aGVyIHRoZSBsb2NrIHdhcyBhY3F1aXJlZC5cbiAgICovXG4gIF90cnlBY3F1aXJlQWR2aXNvcnlMb2NrKG5hbWUpIHsgLy8gZXNsaW50LWRpc2FibGUtbGluZSBuby11bnVzZWQtdmFyc1xuICAgIHRocm93IG5ldyBFcnJvcihgJ190cnlBY3F1aXJlQWR2aXNvcnlMb2NrJyBub3QgaW1wbGVtZW50ZWQgZm9yICR7dGhpcy5jb25zdHJ1Y3Rvci5uYW1lfWApXG4gIH1cblxuICAvKipcbiAgICogUmVsZWFzZXMgYSBuYW1lZCBhZHZpc29yeSBsb2NrIHByZXZpb3VzbHkgYWNxdWlyZWQgb24gdGhpcyBjb25uZWN0aW9uLlxuICAgKiBUaGUgZHJpdmVyLW5hdGl2ZSByZWxlYXNlIHJ1bnMgZmlyc3Q7IHRoZSBwcm9jZXNzLWxvY2FsIHRpZXIgaXMgaGFuZGVkXG4gICAqIHRvIHRoZSBuZXh0IHdhaXRlciBvbmx5IG9uY2UgdGhpcyBjb25uZWN0aW9uJ3MgY291bnRlZCByZWdpc3RyeSBub1xuICAgKiBsb25nZXIgaG9sZHMgdGhlIG5hbWUsIHNvIHJlLWVudHJhbnQgYWNxdWlzaXRpb25zIHJlbGVhc2Ugb25lIGxldmVsIGF0XG4gICAqIGEgdGltZSBleGFjdGx5IGxpa2UgdGhlIHNlc3Npb24tc2NvcGVkIGRyaXZlciBsb2Nrcy5cbiAgICogQHBhcmFtIHtzdHJpbmd9IG5hbWUgLSBMb2NrIG5hbWUuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPGJvb2xlYW4+fSAtIFJlc29sdmVzIHRvIHRydWUgaWYgdGhlIGxvY2sgd2FzIGhlbGQgYnkgdGhpcyBzZXNzaW9uIGFuZCBoYXMgbm93IGJlZW4gcmVsZWFzZWQuXG4gICAqL1xuICBhc3luYyByZWxlYXNlQWR2aXNvcnlMb2NrKG5hbWUpIHtcbiAgICBjb25zdCBvd25lciA9IFZlbG9jaW91c0RhdGFiYXNlRHJpdmVyc0Jhc2UuX2Fkdmlzb3J5TG9ja1N0YXRlLm93bmVyc0J5TmFtZS5nZXQobmFtZSlcblxuICAgIC8vIEFub3RoZXIgZHJpdmVyIGluc3RhbmNlIGluIHRoaXMgcHJvY2VzcyBvd25zIHRoZSB0aWVyIGZvciB0aGlzIG5hbWUsXG4gICAgLy8gc28gdGhpcyBjb25uZWN0aW9uIGNhbiBuZXZlciBiZSB0aGUgbmF0aXZlIGhvbGRlciBlaXRoZXIg4oCUIHJlZnVzZVxuICAgIC8vIGJlZm9yZSBpc3N1aW5nIGEgcmVsZWFzZSBzdGF0ZW1lbnQgdGhhdCBjb3VsZCBkaXN0dXJiIHRoZSBvd25lci5cbiAgICBpZiAob3duZXIgIT09IHVuZGVmaW5lZCAmJiBvd25lciAhPT0gdGhpcykgcmV0dXJuIGZhbHNlXG5cbiAgICBpZiAoIXRoaXMuc3VwcG9ydHNEcml2ZXJOYXRpdmVBZHZpc29yeUxvY2soKSkge1xuICAgICAgLy8gUGxhaW4gU1FMaXRlOiB0aGUgcHJvY2Vzcy1sb2NhbCB0aWVyIElTIHRoZSBsb2NrLCBzbyB0aGUgZmlyc3RcbiAgICAgIC8vIHJlbGVhc2UgYnkgdGhlIG93bmVyIHJlbGVhc2VzIGl0IGZ1bGx5LCBleGFjdGx5IGFzIHRoZSBTUUxpdGVcbiAgICAgIC8vIGVtdWxhdGlvbiBhbHdheXMgaGFzLlxuICAgICAgY29uc3QgcmVsZWFzZWQgPSB0aGlzLl9yZWxlYXNlUHJvY2Vzc0xvY2FsQWR2aXNvcnlMb2NrKG5hbWUpXG5cbiAgICAgIGlmIChyZWxlYXNlZCkge1xuICAgICAgICB0aGlzLl91bnRyYWNrQWR2aXNvcnlMb2NrKG5hbWUpXG4gICAgICB9IGVsc2Uge1xuICAgICAgICB0aGlzLl9oZWxkQWR2aXNvcnlMb2Nrcy5kZWxldGUobmFtZSlcbiAgICAgIH1cblxuICAgICAgcmV0dXJuIHJlbGVhc2VkXG4gICAgfVxuXG4gICAgY29uc3QgcmVsZWFzZWQgPSBhd2FpdCB0aGlzLl9yZWxlYXNlQWR2aXNvcnlMb2NrKG5hbWUpXG5cbiAgICBpZiAocmVsZWFzZWQpIHtcbiAgICAgIHRoaXMuX3VudHJhY2tBZHZpc29yeUxvY2sobmFtZSlcbiAgICB9IGVsc2Uge1xuICAgICAgdGhpcy5faGVsZEFkdmlzb3J5TG9ja3MuZGVsZXRlKG5hbWUpXG4gICAgfVxuXG4gICAgaWYgKCF0aGlzLl9oZWxkQWR2aXNvcnlMb2Nrcy5oYXMobmFtZSkpIHtcbiAgICAgIGNvbnN0IGFjcXVpcmVkQXQgPSB0aGlzLl9hZHZpc29yeUxvY2tBY3F1aXJlZEF0QnlOYW1lLmdldChuYW1lKVxuXG4gICAgICB0aGlzLl9hZHZpc29yeUxvY2tBY3F1aXJlZEF0QnlOYW1lLmRlbGV0ZShuYW1lKVxuXG4gICAgICBpZiAoYWNxdWlyZWRBdCAhPT0gdW5kZWZpbmVkKSB7XG4gICAgICAgIGNvbnN0IGhvbGREdXJhdGlvbk1zID0gRGF0ZS5ub3coKSAtIGFjcXVpcmVkQXRcbiAgICAgICAgY29uc3Qgc2xvd0hvbGRNcyA9IGFkdmlzb3J5TG9ja1RlbGVtZXRyeVRocmVzaG9sZHModGhpcy5nZXRBcmdzKCkpLnNsb3dIb2xkTXNcblxuICAgICAgICBpZiAoc2xvd0hvbGRNcyAhPT0gbnVsbCAmJiBob2xkRHVyYXRpb25NcyA+IHNsb3dIb2xkTXMpIHtcbiAgICAgICAgICBhd2FpdCB0aGlzLl9yZXBvcnRBZHZpc29yeUxvY2tUZWxlbWV0cnkoe2V2ZW50OiBcImFkdmlzb3J5LWxvY2stc2xvdy1ob2xkXCIsIGxvY2tOYW1lOiBuYW1lLCBkdXJhdGlvbk1zOiBob2xkRHVyYXRpb25Ncywgb3V0Y29tZTogbnVsbCwgdGltZW91dE1zOiBudWxsfSlcbiAgICAgICAgfVxuICAgICAgfVxuXG4gICAgICAvLyBMYXN0IGNvbm5lY3Rpb24tbGV2ZWwgcmVsZWFzZTogaGFuZCB0aGUgcHJvY2Vzcy1sb2NhbCB0aWVyIHRvIHRoZVxuICAgICAgLy8gbmV4dCBxdWV1ZWQgY2FsbGVyIGluIHRoaXMgcHJvY2Vzcy5cbiAgICAgIHRoaXMuX3JlbGVhc2VQcm9jZXNzTG9jYWxBZHZpc29yeUxvY2sobmFtZSlcbiAgICB9XG5cbiAgICByZXR1cm4gcmVsZWFzZWRcbiAgfVxuXG4gIC8qKlxuICAgKiBEcml2ZXItc3BlY2lmaWMgYWR2aXNvcnktbG9jayByZWxlYXNlIGhvb2suXG4gICAqIEBhYnN0cmFjdFxuICAgKiBAcGFyYW0ge3N0cmluZ30gbmFtZSAtIExvY2sgbmFtZS5cbiAgICogQHJldHVybnMge1Byb21pc2U8Ym9vbGVhbj59IC0gV2hldGhlciB0aGUgbG9jayB3YXMgcmVsZWFzZWQuXG4gICAqL1xuICBfcmVsZWFzZUFkdmlzb3J5TG9jayhuYW1lKSB7IC8vIGVzbGludC1kaXNhYmxlLWxpbmUgbm8tdW51c2VkLXZhcnNcbiAgICB0aHJvdyBuZXcgRXJyb3IoYCdfcmVsZWFzZUFkdmlzb3J5TG9jaycgbm90IGltcGxlbWVudGVkIGZvciAke3RoaXMuY29uc3RydWN0b3IubmFtZX1gKVxuICB9XG5cbiAgLyoqXG4gICAqIFJlbGVhc2VzIGV2ZXJ5IGFkdmlzb3J5IGxvY2sgc3RpbGwgdHJhY2tlZCBvbiB0aGlzIGNvbm5lY3Rpb24uXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIHdoZW4gZXZlcnkgdHJhY2tlZCBsb2NrIGlzIHJlbGVhc2VkLlxuICAgKi9cbiAgYXN5bmMgcmVsZWFzZUhlbGRBZHZpc29yeUxvY2tzKCkge1xuICAgIC8qKiBAdHlwZSB7RXJyb3JbXX0gKi9cbiAgICBjb25zdCBlcnJvcnMgPSBbXVxuXG4gICAgZm9yIChjb25zdCBuYW1lIG9mIFsuLi50aGlzLl9oZWxkQWR2aXNvcnlMb2Nrcy5rZXlzKCldKSB7XG4gICAgICB3aGlsZSAodGhpcy5faGVsZEFkdmlzb3J5TG9ja3MuaGFzKG5hbWUpKSB7XG4gICAgICAgIHRyeSB7XG4gICAgICAgICAgYXdhaXQgdGhpcy5yZWxlYXNlQWR2aXNvcnlMb2NrKG5hbWUpXG4gICAgICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICAgICAgZXJyb3JzLnB1c2goZXJyb3IgaW5zdGFuY2VvZiBFcnJvciA/IGVycm9yIDogbmV3IEVycm9yKGBGYWlsZWQgdG8gcmVsZWFzZSBhZHZpc29yeSBsb2NrICR7SlNPTi5zdHJpbmdpZnkobmFtZSl9YCwge2NhdXNlOiBlcnJvcn0pKVxuICAgICAgICAgIGJyZWFrXG4gICAgICAgIH1cbiAgICAgIH1cbiAgICB9XG5cbiAgICBpZiAoZXJyb3JzLmxlbmd0aCA9PSAxKSB0aHJvdyBlcnJvcnNbMF1cbiAgICBpZiAoZXJyb3JzLmxlbmd0aCA+IDEpIHRocm93IG5ldyBBZ2dyZWdhdGVFcnJvcihlcnJvcnMsIFwiRmFpbGVkIHRvIHJlbGVhc2UgaGVsZCBhZHZpc29yeSBsb2Nrc1wiKVxuICB9XG5cbiAgLyoqXG4gICAqIFJlY29yZHMgb25lIHN1Y2Nlc3NmdWwgYWNxdWlzaXRpb24sIGluY2x1ZGluZyByZS1lbnRyYW50IGFjcXVpc2l0aW9ucy5cbiAgICogQHBhcmFtIHtzdHJpbmd9IG5hbWUgLSBMb2NrIG5hbWUuXG4gICAqIEByZXR1cm5zIHt2b2lkfVxuICAgKi9cbiAgX3RyYWNrQWR2aXNvcnlMb2NrKG5hbWUpIHtcbiAgICB0aGlzLl9oZWxkQWR2aXNvcnlMb2Nrcy5zZXQobmFtZSwgKHRoaXMuX2hlbGRBZHZpc29yeUxvY2tzLmdldChuYW1lKSB8fCAwKSArIDEpXG5cbiAgICBpZiAoIXRoaXMuX2Fkdmlzb3J5TG9ja0FjcXVpcmVkQXRCeU5hbWUuaGFzKG5hbWUpKSB0aGlzLl9hZHZpc29yeUxvY2tBY3F1aXJlZEF0QnlOYW1lLnNldChuYW1lLCBEYXRlLm5vdygpKVxuICB9XG5cbiAgLyoqXG4gICAqIFJlbW92ZXMgb25lIHN1Y2Nlc3NmdWwgYWNxdWlzaXRpb24gZnJvbSB0aGUgY29ubmVjdGlvbiByZWdpc3RyeS5cbiAgICogQHBhcmFtIHtzdHJpbmd9IG5hbWUgLSBMb2NrIG5hbWUuXG4gICAqIEByZXR1cm5zIHt2b2lkfVxuICAgKi9cbiAgX3VudHJhY2tBZHZpc29yeUxvY2sobmFtZSkge1xuICAgIGNvbnN0IHJlbWFpbmluZ0NvdW50ID0gKHRoaXMuX2hlbGRBZHZpc29yeUxvY2tzLmdldChuYW1lKSB8fCAwKSAtIDFcblxuICAgIGlmIChyZW1haW5pbmdDb3VudCA+IDApIHtcbiAgICAgIHRoaXMuX2hlbGRBZHZpc29yeUxvY2tzLnNldChuYW1lLCByZW1haW5pbmdDb3VudClcbiAgICB9IGVsc2Uge1xuICAgICAgdGhpcy5faGVsZEFkdmlzb3J5TG9ja3MuZGVsZXRlKG5hbWUpXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIENoZWNrcyB3aGV0aGVyIGEgbmFtZWQgYWR2aXNvcnkgbG9jayBpcyBjdXJyZW50bHkgaGVsZCBieSBhbnkgc2Vzc2lvbi5cbiAgICogSW50ZW5kZWQgYXMgYW4gaW50cm9zcGVjdGlvbiBoZWxwZXI7IGNhbGxlcnMgd2hvIG5lZWQgdG8gYWN0IG9uIHRoZVxuICAgKiByZXN1bHQgc2hvdWxkIHByZWZlciBgdHJ5QWNxdWlyZUFkdmlzb3J5TG9ja2AgdG8gYXZvaWQgYSBUT0NUT1UgcmFjZS5cbiAgICpcbiAgICogVGhlIHByb2Nlc3MtbG9jYWwgdGllciBhbnN3ZXJzIGZpcnN0IChhIHNhbWUtcHJvY2VzcyBob2xkZXIgaXMgYVxuICAgKiBob2xkZXIsIGZ1bGwgc3RvcCk7IG90aGVyd2lzZSB0aGUgcXVlc3Rpb24gZ29lcyB0byB0aGUgZHJpdmVyLW5hdGl2ZVxuICAgKiB0aWVyJ3MgaW50cm9zcGVjdGlvbiAoYElTX1VTRURfTE9DS2AgLyBgcGdfbG9ja3NgIC8gYEFQUExPQ0tfVEVTVGApLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gbmFtZSAtIExvY2sgbmFtZS5cbiAgICogQHJldHVybnMge1Byb21pc2U8Ym9vbGVhbj59IC0gUmVzb2x2ZXMgdG8gdHJ1ZSBpZiB0aGUgbG9jayBpcyBoZWxkIGJ5IGFueSBzZXNzaW9uLlxuICAgKi9cbiAgYXN5bmMgaXNBZHZpc29yeUxvY2tIZWxkKG5hbWUpIHtcbiAgICBpZiAoVmVsb2Npb3VzRGF0YWJhc2VEcml2ZXJzQmFzZS5fYWR2aXNvcnlMb2NrU3RhdGUub3duZXJzQnlOYW1lLmhhcyhuYW1lKSkgcmV0dXJuIHRydWVcblxuICAgIGlmICghdGhpcy5zdXBwb3J0c0RyaXZlck5hdGl2ZUFkdmlzb3J5TG9jaygpKSByZXR1cm4gZmFsc2VcblxuICAgIHJldHVybiBhd2FpdCB0aGlzLl9pc0Fkdmlzb3J5TG9ja0hlbGROYXRpdmUobmFtZSlcbiAgfVxuXG4gIC8qKlxuICAgKiBEcml2ZXItbmF0aXZlIGFkdmlzb3J5LWxvY2sgaW50cm9zcGVjdGlvbiBob29rIGJlaGluZFxuICAgKiBgaXNBZHZpc29yeUxvY2tIZWxkYC5cbiAgICogQGFic3RyYWN0XG4gICAqIEBwYXJhbSB7c3RyaW5nfSBuYW1lIC0gTG9jayBuYW1lLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxib29sZWFuPn0gLSBSZXNvbHZlcyB0byB0cnVlIGlmIHRoZSBuYXRpdmUgdGllciByZXBvcnRzIHRoZSBsb2NrIGhlbGQuXG4gICAqL1xuICBfaXNBZHZpc29yeUxvY2tIZWxkTmF0aXZlKG5hbWUpIHsgLy8gZXNsaW50LWRpc2FibGUtbGluZSBuby11bnVzZWQtdmFyc1xuICAgIHRocm93IG5ldyBFcnJvcihgJ19pc0Fkdmlzb3J5TG9ja0hlbGROYXRpdmUnIG5vdCBpbXBsZW1lbnRlZCBmb3IgJHt0aGlzLmNvbnN0cnVjdG9yLm5hbWV9YClcbiAgfVxuXG4gIC8qKlxuICAgKiBXaGljaCBhZHZpc29yeS1sb2NrIGJhY2tlbmQgdGllciB0aGlzIGNvbm5lY3Rpb24gc2VydmVzIChTVEMtMjEwIGNoYWluXG4gICAqIG5hbWluZykuIFRoZSBiYXNlIGRyaXZlciBpcyB0aGUgZHJpdmVyLW5hdGl2ZSB0aWVyOyB0aGUgU1FMaXRlIGRyaXZlcnNcbiAgICogb3ZlcnJpZGUgdG8gYHByb2Nlc3MtbG9jYWxgIC8gYGZpbGVgLlxuICAgKiBAcmV0dXJucyB7c3RyaW5nfSAtIFRpZXIgbmFtZSByZXBvcnRlZCBvbiB0ZWxlbWV0cnkgcGF5bG9hZHMuXG4gICAqL1xuICBhZHZpc29yeUxvY2tCYWNrZW5kVGllcigpIHtcbiAgICByZXR1cm4gXCJkcml2ZXItbmF0aXZlXCJcbiAgfVxuXG4gIC8qKlxuICAgKiBTdGFibGUgaWRlbnRpdHkgb2YgdGhpcyBjb25uZWN0aW9uIGFzIGEgbG9jayBob2xkZXIsIHJlcG9ydGVkIG9uXG4gICAqIHRlbGVtZXRyeSBwYXlsb2FkcyBzbyBhIHNsb3cgYWNxdWlyZS9ob2xkIGlzIGF0dHJpYnV0YWJsZSB0byB0aGUgcmVwb3J0aW5nXG4gICAqIGNvbm5lY3Rpb24gaXRzZWxmLlxuICAgKiBAcmV0dXJucyB7c3RyaW5nfSAtIEhvbGRlciBpZC5cbiAgICovXG4gIGFkdmlzb3J5TG9ja0hvbGRlcklkKCkge1xuICAgIGlmICghdGhpcy5fYWR2aXNvcnlMb2NrSG9sZGVySWQpIHRoaXMuX2Fkdmlzb3J5TG9ja0hvbGRlcklkID0gYGFkdmlzb3J5LWxvY2staG9sZGVyOiR7bmV3IFVVSUQoNCkuZm9ybWF0KCl9YFxuXG4gICAgcmV0dXJuIHRoaXMuX2Fkdmlzb3J5TG9ja0hvbGRlcklkXG4gIH1cblxuICAvKipcbiAgICogQmVzdC1lZmZvcnQgaWRlbnRpdHkgb2YgdGhlIGNvbm5lY3Rpb24gY3VycmVudGx5IGhvbGRpbmcgdGhlIG5hbWVkIGxvY2ssXG4gICAqIGNhcHR1cmVkIG9uIHRoZSB0aWVyIHRoYXQgc2VydmVkIHRoZSBhY3F1aXNpdGlvbi4gVGhlIGJhc2UgZHJpdmVyIGhhcyBub1xuICAgKiBwb3J0YWJsZSBzZXJ2ZXItc2lkZSBsb29rdXA7IE15U1FML1Bvc3RncmVTUUwvU1FMIFNlcnZlci9Ob2RlLVNRTGl0ZVxuICAgKiBvdmVycmlkZSB3aXRoIHRoZWlyIHRpZXIncyBob2xkZXIgYXR0cmlidXRpb24uXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBuYW1lIC0gTG9jayBuYW1lLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxzdHJpbmcgfCBudWxsPn0gLSBIb2xkZXIgY29ubmVjdGlvbiBpZGVudGl0eSwgb3IgbnVsbCB3aGVuIHRoZSB0aWVyIGNhbm5vdCBhdHRyaWJ1dGUgaXQuXG4gICAqL1xuICBhc3luYyBhZHZpc29yeUxvY2tIb2xkZXJDb25uZWN0aW9uSWQobmFtZSkgeyAvLyBlc2xpbnQtZGlzYWJsZS1saW5lIG5vLXVudXNlZC12YXJzXG4gICAgcmV0dXJuIG51bGxcbiAgfVxuXG4gIC8qKlxuICAgKiBFbWl0IG9uZSBldmVudC1kcml2ZW4gYWR2aXNvcnktbG9jayB0ZWxlbWV0cnkgcmVwb3J0IChzbG93IGFjcXVpcmUsXG4gICAqIGFjcXVpcmUgdGltZW91dCB3aXRoIGhvbGRlciBhdHRyaWJ1dGlvbiwgc2xvdyBob2xkKS4gVGhlIGhvbGRlciBsb29rdXAgaXNcbiAgICogYmVzdC1lZmZvcnQ6IGEgZmFpbGVkIGxvb2t1cCBpcyByZWNvcmRlZCBvbiB0aGUgcmVwb3J0IGFuZCBuZXZlciBhZmZlY3RzXG4gICAqIHRoZSBhY3F1aXNpdGlvbiB0aGF0IGFscmVhZHkgc2V0dGxlZC5cbiAgICogQHBhcmFtIHt7ZXZlbnQ6IFwiYWR2aXNvcnktbG9jay1zbG93LWFjcXVpcmVcIiB8IFwiYWR2aXNvcnktbG9jay1hY3F1aXJlLXRpbWVvdXRcIiB8IFwiYWR2aXNvcnktbG9jay1zbG93LWhvbGRcIiwgbG9ja05hbWU6IHN0cmluZywgZHVyYXRpb25NczogbnVtYmVyLCBvdXRjb21lOiBcImFjcXVpcmVkXCIgfCBcInRpbWVvdXRcIiB8IG51bGwsIHRpbWVvdXRNczogbnVtYmVyIHwgbnVsbCwgY2FwdHVyZUhvbGRlcj86IGJvb2xlYW59fSBhcmdzIC0gUmVwb3J0IGFyZ3MuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIGFmdGVyIHRoZSByZXBvcnQgaXMgZW1pdHRlZC5cbiAgICovXG4gIGFzeW5jIF9yZXBvcnRBZHZpc29yeUxvY2tUZWxlbWV0cnkoYXJncykge1xuICAgIC8qKiBAdHlwZSB7aW1wb3J0KFwiLi4vYWR2aXNvcnktbG9jay10ZWxlbWV0cnkuanNcIikuQWR2aXNvcnlMb2NrVGVsZW1ldHJ5UmVwb3J0fSAqL1xuICAgIGNvbnN0IHJlcG9ydCA9IHtcbiAgICAgIGV2ZW50OiBhcmdzLmV2ZW50LFxuICAgICAgbG9ja05hbWU6IGFyZ3MubG9ja05hbWUsXG4gICAgICBiYWNrZW5kVGllcjogdGhpcy5hZHZpc29yeUxvY2tCYWNrZW5kVGllcigpLFxuICAgICAgZHVyYXRpb25NczogYXJncy5kdXJhdGlvbk1zLFxuICAgICAgb3V0Y29tZTogYXJncy5vdXRjb21lLFxuICAgICAgdGltZW91dE1zOiBhcmdzLnRpbWVvdXRNcyxcbiAgICAgIGhvbGRlcklkOiB0aGlzLmFkdmlzb3J5TG9ja0hvbGRlcklkKCksXG4gICAgICBob2xkZXJDb25uZWN0aW9uSWQ6IG51bGwsXG4gICAgICBob2xkZXJMb29rdXBFcnJvcjogbnVsbFxuICAgIH1cblxuICAgIGlmIChhcmdzLmNhcHR1cmVIb2xkZXIpIHtcbiAgICAgIHRyeSB7XG4gICAgICAgIHJlcG9ydC5ob2xkZXJDb25uZWN0aW9uSWQgPSBhd2FpdCB0aGlzLmFkdmlzb3J5TG9ja0hvbGRlckNvbm5lY3Rpb25JZChhcmdzLmxvY2tOYW1lKVxuICAgICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgICAgcmVwb3J0LmhvbGRlckxvb2t1cEVycm9yID0gZXJyb3IgaW5zdGFuY2VvZiBFcnJvciA/IGVycm9yLm1lc3NhZ2UgOiBTdHJpbmcoZXJyb3IpXG4gICAgICB9XG4gICAgfVxuXG4gICAgZW1pdEFkdmlzb3J5TG9ja1RlbGVtZXRyeVJlcG9ydCh0aGlzLmNvbmZpZ3VyYXRpb24sIHJlcG9ydClcbiAgfVxufVxuIl19