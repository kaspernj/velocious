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
        /** @type {boolean} */
        let nativeAcquired;
        try {
            nativeAcquired = await this._acquireAdvisoryLock(name, { timeoutMs: nativeTimeoutMs });
        }
        catch (error) {
            this._releaseProcessLocalAdvisoryLock(name);
            throw error;
        }
        if (!nativeAcquired) {
            this._releaseProcessLocalAdvisoryLock(name);
            return false;
        }
        this._trackAdvisoryLock(name);
        return true;
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
        if (!this._heldAdvisoryLocks.has(name))
            this._releaseProcessLocalAdvisoryLock(name);
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
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiYmFzZS5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uLy4uLy4uLy4uL3NyYy9kYXRhYmFzZS9kcml2ZXJzL2Jhc2UuanMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6IkFBQUEsWUFBWTtBQUVaOzs7Ozs7OztHQVFHO0FBQ0g7Ozs7O0dBS0c7QUFDSDs7Ozs7R0FLRztBQUNIOzs7OztHQUtHO0FBQ0g7Ozs7Ozs7OztHQVNHO0FBQ0g7Ozs7R0FJRztBQUNIOzs7OztHQUtHO0FBQ0g7Ozs7Ozs7OztHQVNHO0FBQ0g7Ozs7Ozs7Ozs7Ozs7R0FhRztBQUVIOzs7Ozs7Ozs7Ozs7Ozs7OztHQWlCRztBQUVIOzs7Ozs7R0FNRztBQUVIOzs7Ozs7OztHQVFHO0FBRUg7Ozs7Ozs7Ozs7O0dBV0c7QUFFSDs7Ozs7OztHQU9HO0FBRUg7Ozs7OztHQU1HO0FBQ0g7Ozs7Ozs7R0FPRztBQUVIOzs7Ozs7R0FNRztBQUVILE9BQU8sZ0JBQWdCLE1BQU0sa0NBQWtDLENBQUE7QUFDL0QsT0FBTyxFQUFFLHNCQUFzQixFQUFFLE1BQU0sbUJBQW1CLENBQUE7QUFDMUQsT0FBTyxFQUFFLHFCQUFxQixFQUFFLE1BQU0sd0JBQXdCLENBQUE7QUFDOUQsT0FBTyxNQUFNLE1BQU0sd0JBQXdCLENBQUE7QUFDM0MsT0FBTyxFQUFDLHdDQUF3QyxFQUFDLE1BQU0sMkJBQTJCLENBQUE7QUFDbEYsT0FBTyxNQUFNLE1BQU0saUJBQWlCLENBQUE7QUFDcEMsT0FBTyxLQUFLLE1BQU0sbUJBQW1CLENBQUE7QUFDckMsT0FBTyxpQkFBaUIsTUFBTSwyQkFBMkIsQ0FBQTtBQUN6RCxPQUFPLE9BQU8sTUFBTSxlQUFlLENBQUE7QUFDbkMsT0FBTyxFQUFFLGNBQWMsRUFBRSxNQUFNLGlDQUFpQyxDQUFBO0FBQ2hFLE9BQU8sS0FBSyxNQUFNLDJCQUEyQixDQUFBO0FBQzdDLE9BQU8sSUFBSSxNQUFNLFdBQVcsQ0FBQTtBQUM1QixPQUFPLFNBQVMsTUFBTSx3QkFBd0IsQ0FBQTtBQUM5QyxP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QyxJQUFJO1FBQ3ZCLE1BQU0sY0FBYyxHQUFHLENBQUMsSUFBSSxDQUFDLGtCQUFrQixDQUFDLEdBQUcsQ0FBQyxJQUFJLENBQUMsSUFBSSxDQUFDLENBQUMsR0FBRyxDQUFDLENBQUE7UUFFbkUsSUFBSSxjQUFjLEdBQUcsQ0FBQyxFQUFFLENBQUM7WUFDdkIsSUFBSSxDQUFDLGtCQUFrQixDQUFDLEdBQUcsQ0FBQyxJQUFJLEVBQUUsY0FBYyxDQUFDLENBQUE7UUFDbkQsQ0FBQzthQUFNLENBQUM7WUFDTixJQUFJLENBQUMsa0JBQWtCLENBQUMsTUFBTSxDQUFDLElBQUksQ0FBQyxDQUFBO1FBQ3RDLENBQUM7SUFDSCxDQUFDO0lBRUQ7Ozs7Ozs7Ozs7T0FVRztJQUNILEtBQUssQ0FBQyxrQkFBa0IsQ0FBQyxJQUFJO1FBQzNCLElBQUksNEJBQTRCLENBQUMsa0JBQWtCLENBQUMsWUFBWSxDQUFDLEdBQUcsQ0FBQyxJQUFJLENBQUM7WUFBRSxPQUFPLElBQUksQ0FBQTtRQUV2RixJQUFJLENBQUMsSUFBSSxDQUFDLGdDQUFnQyxFQUFFO1lBQUUsT0FBTyxLQUFLLENBQUE7UUFFMUQsT0FBTyxNQUFNLElBQUksQ0FBQyx5QkFBeUIsQ0FBQyxJQUFJLENBQUMsQ0FBQTtJQUNuRCxDQUFDO0lBRUQ7Ozs7OztPQU1HO0lBQ0gseUJBQXlCLENBQUMsSUFBSTtRQUM1QixNQUFNLElBQUksS0FBSyxDQUFDLG1EQUFtRCxJQUFJLENBQUMsV0FBVyxDQUFDLElBQUksRUFBRSxDQUFDLENBQUE7SUFDN0YsQ0FBQztDQUNGIiwic291cmNlc0NvbnRlbnQiOlsiLy8gQHRzLWNoZWNrXG5cbi8qKlxuICogQ3JlYXRlSW5kZXhTcWxBcmdzIHR5cGUuXG4gKiBAdHlwZWRlZiB7b2JqZWN0fSBDcmVhdGVJbmRleFNxbEFyZ3NcbiAqIEBwcm9wZXJ0eSB7QXJyYXk8c3RyaW5nIHwgaW1wb3J0KFwiLi8uLi90YWJsZS1kYXRhL3RhYmxlLWNvbHVtbi5qc1wiKS5kZWZhdWx0Pn0gY29sdW1ucyAtIENvbHVtbnMgdG8gaW5jbHVkZSBpbiB0aGUgaW5kZXguXG4gKiBAcHJvcGVydHkge2Jvb2xlYW59IFtpZk5vdEV4aXN0c10gLSBTa2lwIGNyZWF0aW9uIGlmIHRoZSBpbmRleCBhbHJlYWR5IGV4aXN0cy5cbiAqIEBwcm9wZXJ0eSB7c3RyaW5nfSBbbmFtZV0gLSBFeHBsaWNpdCBpbmRleCBuYW1lIHRvIHVzZS5cbiAqIEBwcm9wZXJ0eSB7Ym9vbGVhbn0gW3VuaXF1ZV0gLSBXaGV0aGVyIHRoZSBpbmRleCBzaG91bGQgZW5mb3JjZSB1bmlxdWVuZXNzLlxuICogQHByb3BlcnR5IHtzdHJpbmd9IHRhYmxlTmFtZSAtIE5hbWUgb2YgdGhlIHRhYmxlIHRvIGFkZCB0aGUgaW5kZXggdG8uXG4gKi9cbi8qKlxuICogUmVtb3ZlSW5kZXhTcWxBcmdzIHR5cGUuXG4gKiBAdHlwZWRlZiB7b2JqZWN0fSBSZW1vdmVJbmRleFNxbEFyZ3NcbiAqIEBwcm9wZXJ0eSB7c3RyaW5nfSBuYW1lIC0gSW5kZXggbmFtZSB0byBkcm9wLlxuICogQHByb3BlcnR5IHtzdHJpbmd9IHRhYmxlTmFtZSAtIE5hbWUgb2YgdGhlIHRhYmxlIHRoZSBpbmRleCBiZWxvbmdzIHRvLlxuICovXG4vKipcbiAqIERyb3BUYWJsZVNxbEFyZ3NUeXBlIHR5cGUuXG4gKiBAdHlwZWRlZiB7b2JqZWN0fSBEcm9wVGFibGVTcWxBcmdzVHlwZVxuICogQHByb3BlcnR5IHtib29sZWFufSBbY2FzY2FkZV0gLSBXaGV0aGVyIGRlcGVuZGVudCBvYmplY3RzIHNob3VsZCBiZSBkcm9wcGVkIHRvby5cbiAqIEBwcm9wZXJ0eSB7Ym9vbGVhbn0gW2lmRXhpc3RzXSAtIFNraXAgZHJvcHBpbmcgaWYgdGhlIHRhYmxlIGRvZXMgbm90IGV4aXN0LlxuICovXG4vKipcbiAqIERlbGV0ZVNxbEFyZ3NUeXBlIHR5cGUuXG4gKiBAdHlwZWRlZiB7b2JqZWN0fSBEZWxldGVTcWxBcmdzVHlwZVxuICogQHByb3BlcnR5IHtzdHJpbmd9IHRhYmxlTmFtZSAtIFRhYmxlIG5hbWUgdG8gZGVsZXRlIGZyb20uXG4gKiBAcHJvcGVydHkge3tba2V5OiBzdHJpbmddOiBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn19IGNvbmRpdGlvbnMgLSBDb25kaXRpb25zIHVzZWQgdG8gYnVpbGQgdGhlIGRlbGV0ZSBXSEVSRSBjbGF1c2UuXG4gKi9cbi8qKlxuICogSW5zZXJ0U3FsQXJnc1R5cGUgdHlwZS5cbiAqIEB0eXBlZGVmIHtvYmplY3R9IEluc2VydFNxbEFyZ3NUeXBlXG4gKiBAcHJvcGVydHkge3N0cmluZ1tdfSBbY29sdW1uc10gLSBDb2x1bW4gbmFtZXMgZm9yIGByb3dzYCBpbnNlcnRzLlxuICogQHByb3BlcnR5IHt7W2tleTogc3RyaW5nXTogUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59fSBbZGF0YV0gLSBDb2x1bW4vdmFsdWUgcGFpcnMgZm9yIGEgc2luZ2xlLXJvdyBpbnNlcnQuXG4gKiBAcHJvcGVydHkge2Jvb2xlYW59IFttdWx0aXBsZV0gLSBXaGV0aGVyIHRoaXMgaW5zZXJ0IHNob3VsZCBiZSB0cmVhdGVkIGFzIG11bHRpLXJvdy5cbiAqIEBwcm9wZXJ0eSB7c3RyaW5nW119IFtyZXR1cm5MYXN0SW5zZXJ0ZWRDb2x1bW5OYW1lc10gLSBDb2x1bW4gbmFtZXMgdG8gcmV0dXJuIGFmdGVyIGluc2VydC5cbiAqIEBwcm9wZXJ0eSB7QXJyYXk8QXJyYXk8UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+Pn0gW3Jvd3NdIC0gUm93IHZhbHVlcyBmb3IgYSBtdWx0aS1yb3cgaW5zZXJ0LlxuICogQHByb3BlcnR5IHtzdHJpbmd9IHRhYmxlTmFtZSAtIFRhYmxlIG5hbWUgdG8gaW5zZXJ0IGludG8uXG4gKi9cbi8qKlxuICogUXVlcnlSb3dUeXBlIHR5cGUuXG4gKiBAdHlwZWRlZiB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSBRdWVyeVJvd1R5cGVcbiAqIEB0eXBlZGVmIHtBcnJheTxRdWVyeVJvd1R5cGU+fSBRdWVyeVJlc3VsdFR5cGVcbiAqL1xuLyoqXG4gKiBUcmFuc2FjdGlvbkNhbGxiYWNrRnJhbWUgdHlwZS5cbiAqIEB0eXBlZGVmIHtvYmplY3R9IFRyYW5zYWN0aW9uQ2FsbGJhY2tGcmFtZVxuICogQHByb3BlcnR5IHtBcnJheTwoKSA9PiB2b2lkIHwgUHJvbWlzZTx2b2lkPj59IGFmdGVyQ29tbWl0Q2FsbGJhY2tzIC0gQ2FsbGJhY2tzIHRvIG1lcmdlIG9yIHJ1biBhZnRlciBjb21taXQuXG4gKiBAcHJvcGVydHkge0FycmF5PCgpID0+IHZvaWQgfCBQcm9taXNlPHZvaWQ+Pn0gYmVmb3JlQ29tbWl0Q2FsbGJhY2tzIC0gR3VhcmRzIHRvIHJ1biBiZWZvcmUgdGhpcyBmcmFtZSBjb21wbGV0ZXMuXG4gKi9cbi8qKlxuICogUmV0cnlhYmxlRGF0YWJhc2VFcnJvclJlc3VsdCB0eXBlLlxuICogQHR5cGVkZWYge29iamVjdH0gUmV0cnlhYmxlRGF0YWJhc2VFcnJvclJlc3VsdFxuICogQHByb3BlcnR5IHtib29sZWFufSByZXRyeSAtIFdoZXRoZXIgdGhlIGVycm9yIHNob3VsZCBiZSByZXRyaWVkLlxuICogQHByb3BlcnR5IHtib29sZWFufSByZWNvbm5lY3QgLSBXaGV0aGVyIHRvIHJlY29ubmVjdCBiZWZvcmUgcmV0cnlpbmcuXG4gKiBAcHJvcGVydHkge2Jvb2xlYW59IFtkZWFkbG9ja10gLSBXaGV0aGVyIHRoZSBlcnJvciBpcyBhIHRyYW5zYWN0aW9uIGRlYWRsb2NrL2xvY2std2FpdC10aW1lb3V0IHRoYXQgc2hvdWxkIHJldHJ5IHRoZSB3aG9sZSB0cmFuc2FjdGlvbi5cbiAqIEBwcm9wZXJ0eSB7XCJkZWFkbG9ja1wiIHwgXCJsb2NrLXdhaXQtdGltZW91dFwifSBbY29udGVudGlvbktpbmRdIC0gQ2xhc3NpZmllZCB0cmFuc2FjdGlvbiBjb250ZW50aW9uIGtpbmQuXG4gKiBAcHJvcGVydHkge251bWJlcn0gW21heFRyaWVzXSAtIE92ZXJyaWRlIHRoZSBtYXggcmV0cnkgYXR0ZW1wdHMuXG4gKiBAcHJvcGVydHkge251bWJlcn0gW3dhaXRNc10gLSBXYWl0IHRpbWUgYmVmb3JlIHJldHJ5aW5nIGluIG1pbGxpc2Vjb25kcy5cbiAqL1xuLyoqXG4gKiBRdWVyeU9wdGlvbnMgdHlwZS5cbiAqIEB0eXBlZGVmIHtvYmplY3R9IFF1ZXJ5T3B0aW9uc1xuICogQHByb3BlcnR5IHtzdHJpbmd9IFtsb2dOYW1lXSAtIFF1ZXJ5IGxvZyBzdWJqZWN0LlxuICogQHByb3BlcnR5IHtib29sZWFufSBbbG9nUXVlcnldIC0gV2hldGhlciB0byBsb2cgdGhlIHF1ZXJ5LlxuICogQHByb3BlcnR5IHtib29sZWFufSBbcHJvY2Vzc0xpc3RDb21tZW50XSAtIFdoZXRoZXIgdG8gYWRkIHByb2Nlc3MtbGlzdCBjb21tZW50cyB0byB0aGUgcXVlcnkuXG4gKiBAcHJvcGVydHkge251bWJlcn0gW3JlcXVlc3RUaW1lb3V0TXNdIC0gUGVyLXJlcXVlc3QgZHJpdmVyIHRpbWVvdXQgaW4gbWlsbGlzZWNvbmRzOyB6ZXJvIGRpc2FibGVzIHRoZSBkZWFkbGluZSBvbiBzdXBwb3J0aW5nIGRyaXZlcnMuXG4gKiBAcHJvcGVydHkge2Jvb2xlYW59IFtyZXRyeV0gLSBXaGV0aGVyIHJldHJ5YWJsZSBlcnJvcnMgbWF5IHJldHJ5IHRoZSBxdWVyeTsgZGVmYXVsdHMgdG8gdHJ1ZS5cbiAqIEBwcm9wZXJ0eSB7Ym9vbGVhbn0gW3Nlc3Npb25UaW1lWm9uZV0gLSBXaGV0aGVyIHRvIGVuc3VyZSB0aGUgY29uZmlndXJlZCBkYXRhYmFzZSBzZXNzaW9uIHRpbWUgem9uZSBiZWZvcmUgdGhlIHF1ZXJ5LlxuICogQHByb3BlcnR5IHtib29sZWFufSBbc3FsaXRlU2NyaXB0XSAtIEludGVybmFsIFNRTGl0ZSBmbGFnIHNlbGVjdGluZyBuYXRpdmUgbXVsdGktc3RhdGVtZW50IHNjcmlwdCBleGVjdXRpb24uXG4gKiBAcHJvcGVydHkge0Fib3J0U2lnbmFsfSBbc2lnbmFsXSAtIEFib3J0cyB0aGUgaW4tZmxpZ2h0IHF1ZXJ5IChkZXN0cm95aW5nIGl0cyBjb25uZWN0aW9uKSB3aGVuIGl0IGZpcmVzLlxuICogQHByb3BlcnR5IHtzdHJpbmd9IFtzb3VyY2VTdGFja10gLSBTdGFjayBjYXB0dXJlZCBhdCB0aGUgY2FsbGVyIGJvdW5kYXJ5LlxuICogQHByb3BlcnR5IHtzeW1ib2x9IFtvcGVyYXRpb25Pd25lcl0gLSBPcGFxdWUgb3duZXIgZm9yIGFuIG9wZXJhdGlvbi1sZWFzZWQgY29ubmVjdGlvbi5cbiAqL1xuXG4vKipcbiAqIERlYWRsb2NrUmV0cnlEaWFnbm9zdGljU25hcHNob3QgdHlwZS5cbiAqIEB0eXBlZGVmIHtvYmplY3R9IERlYWRsb2NrUmV0cnlEaWFnbm9zdGljU25hcHNob3RcbiAqIEBwcm9wZXJ0eSB7bnVtYmVyfSBhdHRlbXB0IC0gT25lLWJhc2VkIHRyYW5zYWN0aW9uIGF0dGVtcHQuXG4gKiBAcHJvcGVydHkge1wiZGVhZGxvY2tcIiB8IFwibG9jay13YWl0LXRpbWVvdXRcIn0gY29udGVudGlvbktpbmQgLSBDbGFzc2lmaWVkIGNvbnRlbnRpb24ga2luZC5cbiAqIEBwcm9wZXJ0eSB7c3RyaW5nfSBbZGF0YWJhc2VJZGVudGlmaWVyXSAtIFJlZGFjdGVkIGxvZ2ljYWwgZGF0YWJhc2UgcG9vbCBpZGVudGlmaWVyIG1hcmtlci5cbiAqIEBwcm9wZXJ0eSB7c3RyaW5nfSBbZGF0YWJhc2VJZGVudGlmaWVyRmluZ2VycHJpbnRdIC0gT3BhcXVlIGxvZ2ljYWwgZGF0YWJhc2UgcG9vbCBpZGVudGl0eS5cbiAqIEBwcm9wZXJ0eSB7c3RyaW5nfSBbZGF0YWJhc2VJZGVudGl0eUZpbmdlcnByaW50XSAtIE9wYXF1ZSBwaHlzaWNhbCBkYXRhYmFzZSBpZGVudGl0eS5cbiAqIEBwcm9wZXJ0eSB7c3RyaW5nfSBkcml2ZXJUeXBlIC0gRHJpdmVyIHR5cGUuXG4gKiBAcHJvcGVydHkge251bWJlcn0gbWF4QXR0ZW1wdHMgLSBDb25maWd1cmVkIHRyYW5zYWN0aW9uIGF0dGVtcHQgYnVkZ2V0LlxuICogQHByb3BlcnR5IHtzdHJpbmd9IFtvcGVyYXRpb25OYW1lXSAtIFJlZGFjdGVkIG9wZXJhdGlvbi1uYW1lIG1hcmtlci5cbiAqIEBwcm9wZXJ0eSB7c3RyaW5nfSBbb3BlcmF0aW9uTmFtZUZpbmdlcnByaW50XSAtIE9wYXF1ZSBvcGVyYXRpb24tbmFtZSBpZGVudGl0eS5cbiAqIEBwcm9wZXJ0eSB7c3RyaW5nfSBbc3FsRmluZ2VycHJpbnRdIC0gTm9ybWFsaXplZCBTUUwtc2hhcGUgZmluZ2VycHJpbnQuXG4gKiBAcHJvcGVydHkge3N0cmluZ30gW3NxbE9wZXJhdGlvbl0gLSBTUUwgdmVyYi5cbiAqIEBwcm9wZXJ0eSB7c3RyaW5nfSBzdGFnZSAtIEVycm9yLWV2ZW50IHN0YWdlLlxuICogQHByb3BlcnR5IHtudW1iZXJ9IHRyYW5zYWN0aW9uQXR0ZW1wdER1cmF0aW9uTXMgLSBEdXJhdGlvbiBvZiB0aGUgZmFpbGVkIG91dGVyIGF0dGVtcHQuXG4gKiBAcHJvcGVydHkge2Jvb2xlYW59IHdpbGxSZXRyeSAtIFdoZXRoZXIgYW5vdGhlciBvdXRlciB0cmFuc2FjdGlvbiBhdHRlbXB0IHdpbGwgcnVuLlxuICovXG5cbi8qKlxuICogVGVzdFByb2ZpbGVRdWVyeUF0dGVtcHQgdHlwZS5cbiAqIEB0eXBlZGVmIHtvYmplY3R9IFRlc3RQcm9maWxlUXVlcnlBdHRlbXB0XG4gKiBAcHJvcGVydHkge2ltcG9ydChcIi4uLy4uL3Rlc3RpbmcvdGVzdC1wcm9maWxlci5qc1wiKS5UZXN0UHJvZmlsZUFzeW5jQ29udGV4dH0gY29udGV4dCAtIENhcHR1cmVkIGFzeW5jIGF0dHJpYnV0aW9uLlxuICogQHByb3BlcnR5IHt7c3FsRmluZ2VycHJpbnQ6IHN0cmluZywgc3FsT3BlcmF0aW9uOiBzdHJpbmd9fSBkaWFnbm9zdGljIC0gUmVkYWN0ZWQgc3RhdGVtZW50IGRpYWdub3N0aWMuXG4gKiBAcHJvcGVydHkge251bWJlcn0gc3RhcnRlZEF0TXMgLSBQaHlzaWNhbCBhdHRlbXB0IHN0YXJ0IHRpbWUuXG4gKi9cblxuLyoqXG4gKiBBY3RpdmVRdWVyeURlYnVnU25hcHNob3QgdHlwZS5cbiAqIEB0eXBlZGVmIHtvYmplY3R9IEFjdGl2ZVF1ZXJ5RGVidWdTbmFwc2hvdFxuICogQHByb3BlcnR5IHtzdHJpbmdbXX0gYW5ub3RhdGlvbnMgLSBEYXRhYmFzZSBhbm5vdGF0aW9ucyBhY3RpdmUgd2hlbiB0aGUgcXVlcnkgc3RhcnRlZC5cbiAqIEBwcm9wZXJ0eSB7c3RyaW5nfSBsb2dOYW1lIC0gUXVlcnkgbG9nIG5hbWUuXG4gKiBAcHJvcGVydHkge251bWJlcn0gc3RhcnRlZEF0VW5peE1zIC0gUXVlcnkgc3RhcnQgdGltZXN0YW1wLlxuICogQHByb3BlcnR5IHtudW1iZXJ9IHJ1bm5pbmdNcyAtIFF1ZXJ5IHJ1bnRpbWUgaW4gbWlsbGlzZWNvbmRzLlxuICogQHByb3BlcnR5IHtzdHJpbmd9IHNxbFByZXZpZXcgLSBUcnVuY2F0ZWQgU1FMIHByZXZpZXcuXG4gKi9cblxuLyoqXG4gKiBEYXRhYmFzZUNvbm5lY3Rpb25EZWJ1Z1NuYXBzaG90IHR5cGUuXG4gKiBAdHlwZWRlZiB7b2JqZWN0fSBEYXRhYmFzZUNvbm5lY3Rpb25EZWJ1Z1NuYXBzaG90XG4gKiBAcHJvcGVydHkge0FjdGl2ZVF1ZXJ5RGVidWdTbmFwc2hvdCB8IG51bGx9IGFjdGl2ZVF1ZXJ5IC0gQ3VycmVudGx5IHJ1bm5pbmcgcXVlcnksIGlmIGFueS5cbiAqIEBwcm9wZXJ0eSB7bnVtYmVyIHwgdW5kZWZpbmVkfSBjaGVja2VkT3V0QXRVbml4TXMgLSBDaGVja291dCBzdGFydCB0aW1lc3RhbXAgZm9yIGFjdGl2ZSBjaGVja291dHMuXG4gKiBAcHJvcGVydHkge251bWJlciB8IHVuZGVmaW5lZH0gY2hlY2tvdXRBZ2VNcyAtIEFjdGl2ZSBjaGVja291dCBhZ2UgaW4gbWlsbGlzZWNvbmRzLlxuICogQHByb3BlcnR5IHtzdHJpbmcgfCB1bmRlZmluZWR9IGNoZWNrb3V0TmFtZSAtIEh1bWFuLXJlYWRhYmxlIGNoZWNrb3V0IG5hbWUuXG4gKiBAcHJvcGVydHkge3N0cmluZ30gZHJpdmVyQ2xhc3MgLSBEcml2ZXIgY2xhc3MgbmFtZS5cbiAqIEBwcm9wZXJ0eSB7bnVtYmVyIHwgdW5kZWZpbmVkfSBpZFNlcSAtIFBvb2wgY2hlY2tvdXQgSUQgc2VxdWVuY2UuXG4gKiBAcHJvcGVydHkge251bWJlcn0gb3BlblRyYW5zYWN0aW9ucyAtIE51bWJlciBvZiBvcGVuIHRyYW5zYWN0aW9uIGZyYW1lcy5cbiAqIEBwcm9wZXJ0eSB7bnVtYmVyfSBzY2hlbWFDYWNoZUVudHJpZXMgLSBOdW1iZXIgb2YgY2FjaGVkIHNjaGVtYSBtZXRhZGF0YSBlbnRyaWVzLlxuICovXG5cbi8qKlxuICogQWN0aXZlUXVlcnlTdGF0ZSB0eXBlLlxuICogQHR5cGVkZWYge29iamVjdH0gQWN0aXZlUXVlcnlTdGF0ZVxuICogQHByb3BlcnR5IHtzdHJpbmdbXX0gYW5ub3RhdGlvbnMgLSBEYXRhYmFzZSBhbm5vdGF0aW9ucyBhY3RpdmUgd2hlbiB0aGUgcXVlcnkgc3RhcnRlZC5cbiAqIEBwcm9wZXJ0eSB7c3RyaW5nfSBsb2dOYW1lIC0gUXVlcnkgbG9nIG5hbWUuXG4gKiBAcHJvcGVydHkge251bWJlcn0gc3RhcnRlZEF0VW5peE1zIC0gUXVlcnkgc3RhcnQgdGltZXN0YW1wLlxuICogQHByb3BlcnR5IHtzdHJpbmd9IHNxbFByZXZpZXcgLSBUcnVuY2F0ZWQgU1FMIHByZXZpZXcuXG4gKi9cblxuLyoqXG4gKiBVcGRhdGVTcWxBcmdzVHlwZSB0eXBlLlxuICogQHR5cGVkZWYge29iamVjdH1VcGRhdGVTcWxBcmdzVHlwZVxuICogQHByb3BlcnR5IHtvYmplY3R9IGNvbmRpdGlvbnMgLSBDb25kaXRpb25zIHVzZWQgdG8gYnVpbGQgdGhlIHVwZGF0ZSBXSEVSRSBjbGF1c2UuXG4gKiBAcHJvcGVydHkge29iamVjdH0gZGF0YSAtIENvbHVtbi92YWx1ZSBwYWlycyB0byB1cGRhdGUuXG4gKiBAcHJvcGVydHkge3N0cmluZ30gdGFibGVOYW1lIC0gVGFibGUgbmFtZSB0byB1cGRhdGUuXG4gKi9cbi8qKlxuICogVXBzZXJ0U3FsQXJnc1R5cGUgdHlwZS5cbiAqIEB0eXBlZGVmIHtvYmplY3R9VXBzZXJ0U3FsQXJnc1R5cGVcbiAqIEBwcm9wZXJ0eSB7c3RyaW5nW119IGNvbmZsaWN0Q29sdW1ucyAtIENvbHVtbnMgdGhhdCBkZWZpbmUgYSBjb25mbGljdC5cbiAqIEBwcm9wZXJ0eSB7b2JqZWN0fSBkYXRhIC0gQ29sdW1uL3ZhbHVlIHBhaXJzIHRvIGluc2VydC5cbiAqIEBwcm9wZXJ0eSB7c3RyaW5nfSB0YWJsZU5hbWUgLSBUYWJsZSBuYW1lIHRvIHVwc2VydCBpbnRvLlxuICogQHByb3BlcnR5IHtzdHJpbmdbXX0gdXBkYXRlQ29sdW1ucyAtIENvbHVtbnMgdG8gdXBkYXRlIG9uIGNvbmZsaWN0LlxuICovXG5cbi8qKlxuICogU3FsVG9rZW5SZXN1bHQgdHlwZS5cbiAqIEB0eXBlZGVmIHtvYmplY3R9IFNxbFRva2VuUmVzdWx0XG4gKiBAcHJvcGVydHkge2Jvb2xlYW59IGluY29tcGxldGUgLSBXaGV0aGVyIHRoZSBzY2FuIGhpdCBpdHMgYm91bmQgYmVmb3JlIGZpbmlzaGluZyB0cml2aWEvdG9rZW4gcGFyc2luZy5cbiAqIEBwcm9wZXJ0eSB7c3RyaW5nIHwgdW5kZWZpbmVkfSB0b2tlbiAtIExvd2VyY2FzZWQgdG9rZW4gd2hlbiBwYXJzaW5nIGNvbXBsZXRlZDsgdW5kZWZpbmVkIHdoZW4gbm8gdG9rZW4gd2FzIGZvdW5kLlxuICogQHByb3BlcnR5IHtudW1iZXJ9IGluZGV4IC0gSW5kZXggaW1tZWRpYXRlbHkgYWZ0ZXIgdGhlIHBhcnNlZCB0b2tlbiBvciB0cml2aWEuXG4gKi9cblxuaW1wb3J0IEJhY2t0cmFjZUNsZWFuZXIgZnJvbSBcIi4uLy4uL3V0aWxzL2JhY2t0cmFjZS1jbGVhbmVyLmpzXCJcbmltcG9ydCB7IGdldERhdGFiYXNlQW5ub3RhdGlvbnMgfSBmcm9tIFwiLi4vYW5ub3RhdGlvbnMuanNcIlxuaW1wb3J0IHsgZm9ybWF0RGF0ZUZvckRhdGFiYXNlIH0gZnJvbSBcIi4uL2RhdGV0aW1lLXN0b3JhZ2UuanNcIlxuaW1wb3J0IGlzRGF0ZSBmcm9tIFwiLi4vLi4vdXRpbHMvaXMtZGF0ZS5qc1wiXG5pbXBvcnQge0RFRkFVTFRfQURWSVNPUllfTE9DS19BQ1FVSVJFX1RJTUVPVVRfTVN9IGZyb20gXCIuLi9hZHZpc29yeS1sb2NrLWJvdW5kLmpzXCJcbmltcG9ydCBMb2dnZXIgZnJvbSBcIi4uLy4uL2xvZ2dlci5qc1wiXG5pbXBvcnQgUXVlcnkgZnJvbSBcIi4uL3F1ZXJ5L2luZGV4LmpzXCJcbmltcG9ydCBRdWVyeUFib3J0ZWRFcnJvciBmcm9tIFwiLi4vcXVlcnktYWJvcnRlZC1lcnJvci5qc1wiXG5pbXBvcnQgSGFuZGxlciBmcm9tIFwiLi4vaGFuZGxlci5qc1wiXG5pbXBvcnQgeyB1dGY4Qnl0ZUxlbmd0aCB9IGZyb20gXCIuLi8uLi91dGlscy91dGY4LWJ5dGUtbGVuZ3RoLmpzXCJcbmltcG9ydCBNdXRleCBmcm9tIFwiZXBpYy1sb2Nrcy9idWlsZC9tdXRleC5qc1wiXG5pbXBvcnQgVVVJRCBmcm9tIFwicHVyZS11dWlkXCJcbmltcG9ydCBUYWJsZURhdGEgZnJvbSBcIi4uL3RhYmxlLWRhdGEvaW5kZXguanNcIlxuaW1wb3J0IFRhYmxlQ29sdW1uIGZyb20gXCIuLi90YWJsZS1kYXRhL3RhYmxlLWNvbHVtbi5qc1wiXG5pbXBvcnQgVGFibGVGb3JlaWduS2V5IGZyb20gXCIuLi90YWJsZS1kYXRhL3RhYmxlLWZvcmVpZ24ta2V5LmpzXCJcbmltcG9ydCB3YWl0IGZyb20gXCJhd2FpdGVyeS9idWlsZC93YWl0LmpzXCJcbmltcG9ydCB7IGVuc3VyZUVycm9yLCBvcHRpb25hbFBvc2l0aXZlSW50ZWdlciB9IGZyb20gXCJ0eXBhbmljXCJcbmltcG9ydCB7Y29vcmRpbmF0ZVNoYXJlZFRyYW5zYWN0aW9uQ29ubmVjdGlvbiwgcnVuV2l0aG91dFNoYXJlZFRyYW5zYWN0aW9uQ29vcmRpbmF0b3JPd25lcn0gZnJvbSBcIi4uLy4uL3Rlc3Rpbmcvc2hhcmVkLXRyYW5zYWN0aW9uLWNvbm5lY3Rpb24tY29vcmRpbmF0b3IuanNcIlxuaW1wb3J0IHsgY3VycmVudFRlc3RQcm9maWxlQ29udGV4dCB9IGZyb20gXCIuLi8uLi90ZXN0aW5nL3Rlc3QtcHJvZmlsZS1jb250ZXh0LmpzXCJcbmltcG9ydCBzaGEyNTZIZXggZnJvbSBcIi4uLy4uL3V0aWxzL3NoYTI1Ni1oZXguanNcIlxuXG4vKiogTWF4aW11bSBjaGFyYWN0ZXJzIGluc3BlY3RlZCB3aGVuIGJ1aWxkaW5nIHRoZSBkZWJ1ZyBTUUwgcHJldmlldy4gKi9cbmNvbnN0IFNRTF9QUkVWSUVXX1NDQU5fTElNSVQgPSA0MDk2XG4vKiogTWF4aW11bSBjaGFyYWN0ZXJzIGluc3BlY3RlZCB3aGVuIGRlY2lkaW5nIHdoZXRoZXIgYSBzdGF0ZW1lbnQgaW52YWxpZGF0ZXMgc2NoZW1hIG1ldGFkYXRhLiAqL1xuY29uc3QgU0NIRU1BX0lOVkFMSURBVElPTl9TQ0FOX0xJTUlUID0gODE5MlxuLyoqIE1heGltdW0gY2hlY2tvdXQtbmFtZSBjaGFyYWN0ZXJzIGluc3BlY3RlZCBieSByZXRyeSBkaWFnbm9zdGljcy4gKi9cbmNvbnN0IE9QRVJBVElPTl9OQU1FX1NDQU5fTElNSVQgPSAxMDI0XG5jb25zdCBSRURBQ1RFRF9ESUFHTk9TVElDX0xBQkVMID0gXCJbUkVEQUNURURdXCJcbi8qKiBGaXJzdCBiYWNrb2ZmIGJldHdlZW4gcmV0cmllcyBvZiBhIHNjaGVtYS1tZXRhZGF0YSByZWFkIGJsb2NrZWQgYnkgY29uY3VycmVudCBvbmxpbmUgRERMLiAqL1xuY29uc3QgU0NIRU1BX01FVEFEQVRBX1JFVFJZX0lOSVRJQUxfREVMQVlfTVMgPSAyNTBcbi8qKiBMYXJnZXN0IGJhY2tvZmYgYmV0d2VlbiByZXRyaWVzIG9mIGEgc2NoZW1hLW1ldGFkYXRhIHJlYWQgYmxvY2tlZCBieSBjb25jdXJyZW50IG9ubGluZSBEREwuICovXG5jb25zdCBTQ0hFTUFfTUVUQURBVEFfUkVUUllfTUFYX0RFTEFZX01TID0gMjAwMFxuLyoqIERlZmF1bHQgYm91bmRlZCBkZWFkbGluZSBmb3Igb3V0bGFzdGluZyBhIGNvbmN1cnJlbnQgb25saW5lLURETCBtZXRhZGF0YSBza2lwLiAqL1xuY29uc3QgU0NIRU1BX01FVEFEQVRBX1JFVFJZX0RFQURMSU5FX01TID0gNjAwMDBcblxuLyoqXG4gKiBCdWlsZHMgYSBub24tcmV2ZXJzaWJsZSwgc3RhYmxlIFNRTCBmaW5nZXJwcmludCB3aXRob3V0IHJldGFpbmluZyBTUUwgdGV4dC4gTGl0ZXJhbCBzcGVsbGluZyBpc1xuICogbm9ybWFsaXplZCBmaXJzdCBzbyB0aGUgc2FtZSBzdGF0ZW1lbnQgc2hhcGUgcHJvZHVjZXMgdGhlIHNhbWUgZmluZ2VycHJpbnQgYWNyb3NzIHZhbHVlcy5cbiAqIEBwYXJhbSB7c3RyaW5nfSBzcWwgLSBTUUwgdG8gZmluZ2VycHJpbnQuXG4gKiBAcmV0dXJucyB7e3NxbEZpbmdlcnByaW50OiBzdHJpbmcsIHNxbE9wZXJhdGlvbjogc3RyaW5nfX0gLSBCb3VuZGVkIHF1ZXJ5IGRpYWdub3N0aWMuXG4gKi9cbmZ1bmN0aW9uIHNxbERpYWdub3N0aWMoc3FsKSB7XG4gIGxldCBmaW5nZXJwcmludElucHV0ID0gXCJcIlxuXG4gIGZvciAobGV0IGluZGV4ID0gMDsgaW5kZXggPCBzcWwubGVuZ3RoOykge1xuICAgIGNvbnN0IGNoYXJhY3RlciA9IHNxbFtpbmRleF1cbiAgICBjb25zdCBuZXh0Q2hhcmFjdGVyID0gc3FsW2luZGV4ICsgMV1cblxuICAgIGlmIChjaGFyYWN0ZXIgPT0gXCInXCIgfHwgY2hhcmFjdGVyID09ICdcIicpIHtcbiAgICAgIGNvbnN0IHF1b3RlID0gY2hhcmFjdGVyXG4gICAgICBmaW5nZXJwcmludElucHV0ICs9IFwiP1wiXG4gICAgICBpbmRleCsrXG5cbiAgICAgIHdoaWxlIChpbmRleCA8IHNxbC5sZW5ndGgpIHtcbiAgICAgICAgaWYgKHNxbFtpbmRleF0gPT0gXCJcXFxcXCIpIHtcbiAgICAgICAgICBpbmRleCArPSAyXG4gICAgICAgIH0gZWxzZSBpZiAoc3FsW2luZGV4XSA9PSBxdW90ZSAmJiBzcWxbaW5kZXggKyAxXSA9PSBxdW90ZSkge1xuICAgICAgICAgIGluZGV4ICs9IDJcbiAgICAgICAgfSBlbHNlIGlmIChzcWxbaW5kZXhdID09IHF1b3RlKSB7XG4gICAgICAgICAgaW5kZXgrK1xuICAgICAgICAgIGJyZWFrXG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgaW5kZXgrK1xuICAgICAgICB9XG4gICAgICB9XG4gICAgfSBlbHNlIGlmIChjaGFyYWN0ZXIgPT0gXCIvXCIgJiYgbmV4dENoYXJhY3RlciA9PSBcIipcIikge1xuICAgICAgY29uc3QgY29tbWVudEVuZCA9IHNxbC5pbmRleE9mKFwiKi9cIiwgaW5kZXggKyAyKVxuICAgICAgZmluZ2VycHJpbnRJbnB1dCArPSBcIiBcIlxuICAgICAgaW5kZXggPSBjb21tZW50RW5kID09IC0xID8gc3FsLmxlbmd0aCA6IGNvbW1lbnRFbmQgKyAyXG4gICAgfSBlbHNlIGlmICgoY2hhcmFjdGVyID09IFwiLVwiICYmIG5leHRDaGFyYWN0ZXIgPT0gXCItXCIpIHx8IGNoYXJhY3RlciA9PSBcIiNcIikge1xuICAgICAgY29uc3QgbGluZUVuZCA9IHNxbC5pbmRleE9mKFwiXFxuXCIsIGluZGV4ICsgMSlcbiAgICAgIGZpbmdlcnByaW50SW5wdXQgKz0gXCIgXCJcbiAgICAgIGluZGV4ID0gbGluZUVuZCA9PSAtMSA/IHNxbC5sZW5ndGggOiBsaW5lRW5kICsgMVxuICAgIH0gZWxzZSB7XG4gICAgICBmaW5nZXJwcmludElucHV0ICs9IGNoYXJhY3RlclxuICAgICAgaW5kZXgrK1xuICAgIH1cbiAgfVxuXG4gIGNvbnN0IG5vcm1hbGl6ZWQgPSBmaW5nZXJwcmludElucHV0XG4gICAgLnJlcGxhY2UoL1xcYig/OjB4WzAtOWEtZl0rfFxcZCsoPzpcXC5cXGQrKT8oPzplWystXT9cXGQrKT8pXFxiL2dpLCBcIj9cIilcbiAgICAucmVwbGFjZSgvXFxzKy9nLCBcIiBcIilcbiAgICAudHJpbSgpXG4gICAgLnRvTG93ZXJDYXNlKClcbiAgbGV0IGhhc2ggPSAweGNiZjI5Y2U0ODQyMjIzMjVuXG5cbiAgZm9yIChsZXQgaW5kZXggPSAwOyBpbmRleCA8IG5vcm1hbGl6ZWQubGVuZ3RoOyBpbmRleCsrKSB7XG4gICAgaGFzaCBePSBCaWdJbnQobm9ybWFsaXplZC5jaGFyQ29kZUF0KGluZGV4KSlcbiAgICBoYXNoID0gQmlnSW50LmFzVWludE4oNjQsIGhhc2ggKiAweDEwMDAwMDAwMWIzbilcbiAgfVxuXG4gIGNvbnN0IG9wZXJhdGlvbk1hdGNoID0gL14oW2Etel0rKS8uZXhlYyhub3JtYWxpemVkKVxuXG4gIHJldHVybiB7XG4gICAgc3FsRmluZ2VycHJpbnQ6IGBmbnYxYTY0OiR7aGFzaC50b1N0cmluZygxNikucGFkU3RhcnQoMTYsIFwiMFwiKX1gLFxuICAgIHNxbE9wZXJhdGlvbjogb3BlcmF0aW9uTWF0Y2ggPyBvcGVyYXRpb25NYXRjaFsxXS50b1VwcGVyQ2FzZSgpIDogXCJVTktOT1dOXCJcbiAgfVxufVxuXG4vKipcbiAqIE1hcmtzIGEgY2FsbGJhY2sgZmFpbHVyZSB0aGF0IGhhcHBlbmVkIGFmdGVyIHRoZSBvd25pbmcgdHJhbnNhY3Rpb24gd2FzIGR1cmFibHkgY29tbWl0dGVkLlxuICogVGhlIHB1YmxpYyB0cmFuc2FjdGlvbiBib3VuZGFyeSB1bndyYXBzIGl0IGJlZm9yZSBkZWFkbG9jayBjbGFzc2lmaWNhdGlvbi5cbiAqL1xuY2xhc3MgVmVsb2Npb3VzRGF0YWJhc2VBZnRlckNvbW1pdENhbGxiYWNrRXJyb3IgZXh0ZW5kcyBFcnJvciB7XG4gIC8qKlxuICAgKiBSdW5zIGNvbnN0cnVjdG9yLlxuICAgKiBAcGFyYW0ge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSBjYWxsYmFja0Vycm9yIC0gT3JpZ2luYWwgY2FsbGJhY2sgZmFpbHVyZS5cbiAgICovXG4gIGNvbnN0cnVjdG9yKGNhbGxiYWNrRXJyb3IpIHtcbiAgICBzdXBlcihcIkRhdGFiYXNlIGFmdGVyQ29tbWl0IGNhbGxiYWNrIGZhaWxlZFwiKVxuICAgIHRoaXMuY2FsbGJhY2tFcnJvciA9IGNhbGxiYWNrRXJyb3JcbiAgfVxufVxuXG4vKipcbiAqIFJ1bnMgbm93IG1zLlxuICogQHJldHVybnMge251bWJlcn0gLSBDdXJyZW50IGhpZ2gtcmVzb2x1dGlvbi1pc2ggdGltZXN0YW1wIGluIG1pbGxpc2Vjb25kcy5cbiAqL1xuZnVuY3Rpb24gbm93TXMoKSB7XG4gIGlmIChnbG9iYWxUaGlzLnBlcmZvcm1hbmNlICYmIHR5cGVvZiBnbG9iYWxUaGlzLnBlcmZvcm1hbmNlLm5vdyA9PSBcImZ1bmN0aW9uXCIpIHtcbiAgICByZXR1cm4gZ2xvYmFsVGhpcy5wZXJmb3JtYW5jZS5ub3coKVxuICB9XG5cbiAgcmV0dXJuIERhdGUubm93KClcbn1cblxuLyoqXG4gKiBSdW5zIGZvcm1hdCBlbGFwc2VkIG1zLlxuICogQHBhcmFtIHtudW1iZXJ9IGVsYXBzZWRNcyAtIEVsYXBzZWQgbWlsbGlzZWNvbmRzLlxuICogQHJldHVybnMge3N0cmluZ30gLSBGb3JtYXR0ZWQgZWxhcHNlZCBtaWxsaXNlY29uZHMuXG4gKi9cbmZ1bmN0aW9uIGZvcm1hdEVsYXBzZWRNcyhlbGFwc2VkTXMpIHtcbiAgcmV0dXJuIGAke01hdGgubWF4KGVsYXBzZWRNcywgMCkudG9GaXhlZCgxKX1tc2Bcbn1cblxuZXhwb3J0IGRlZmF1bHQgY2xhc3MgVmVsb2Npb3VzRGF0YWJhc2VEcml2ZXJzQmFzZSB7XG4gIC8qKlxuICAgKiBQcm9jZXNzLXdpZGUgc3RhdGUgZm9yIHRoZSAqKnByb2Nlc3MtbG9jYWwgYWR2aXNvcnktbG9jayBwcmUtZmlsdGVyXG4gICAqIHRpZXIqKiBzaGFyZWQgYnkgZXZlcnkgZHJpdmVyIChTUUxpdGUsIE15U1FML01hcmlhREIsIFBvc3RncmVTUUwsXG4gICAqIE1TU1FMKS4gSXQgc2VyaWFsaXplcyBjb25jdXJyZW50IGFjcXVpc2l0aW9ucyBvZiB0aGUgc2FtZSBsb2NrIG5hbWVcbiAgICogaW5zaWRlIHRoaXMgcHJvY2VzcyB0aHJvdWdoIGEgRklGTyB3YWl0ZXIgcXVldWUgYmVmb3JlIGFueSBjYWxsZXJcbiAgICogY29udGFjdHMgdGhlIGRyaXZlci1uYXRpdmUgdGllciwgc28gYSBjb250ZW5kZWQgc2FtZS1wcm9jZXNzIHdhaXRlclxuICAgKiBuZXZlciBwYXJrcyBhIHBvb2xlZCBkYXRhYmFzZSBjb25uZWN0aW9uIGluIGEgZHJpdmVyIGxvY2sgc3RhdGVcbiAgICogKE1hcmlhREIgYFVzZXIgbG9ja2AsIGBzcF9nZXRhcHBsb2NrYCBzZXNzaW9uIGhvbGQsIC4uLikuXG4gICAqXG4gICAqIFRoaXMgdGllciBpcyBhIHByZS1maWx0ZXIsICoqbmV2ZXIgdGhlIGF1dGhvcml0eSoqOiBhIGdyYW50IGhlcmUgb25seVxuICAgKiBtZWFucyBcInlvdSBhcmUgbmV4dCBpbiB0aGlzIHByb2Nlc3MuXCIgQ3Jvc3MtcHJvY2Vzcy9jcm9zcy1ob3N0XG4gICAqIGV4Y2x1c2lvbiBpcyBjb25maXJtZWQgYnkgdGhlIGRyaXZlci1uYXRpdmUgdGllciAob3IsIG9uY2UgdGhlXG4gICAqIFNUQy0yMTAgYmFja2VuZCBjaGFpbiBsYW5kcywgdGhlIGNvbmZpZ3VyZWQgY3Jvc3MtaG9zdCBiYWNrZW5kKVxuICAgKiBiZWZvcmUgdGhlIGFjcXVpc2l0aW9uIHN1Y2NlZWRzLlxuICAgKlxuICAgKiBgb3duZXJzQnlOYW1lYCBtYXBzIGVhY2ggaGVsZCBsb2NrIG5hbWUgdG8gdGhlIGRyaXZlciBpbnN0YW5jZSB0aGF0XG4gICAqIGFjcXVpcmVkIGl0IHNvIGByZWxlYXNlQWR2aXNvcnlMb2NrYCBjYW4gcmVqZWN0IHJlbGVhc2VzIGZyb20gZHJpdmVyc1xuICAgKiB0aGF0IGRvIG5vdCBvd24gdGhlIGxvY2suXG4gICAqIEB0eXBlIHt7b3duZXJzQnlOYW1lOiBNYXA8c3RyaW5nLCBWZWxvY2lvdXNEYXRhYmFzZURyaXZlcnNCYXNlPiwgd2FpdGVyc0J5TmFtZTogTWFwPHN0cmluZywgQXJyYXk8KCkgPT4gdm9pZD4+fX1cbiAgICovXG4gIHN0YXRpYyBfYWR2aXNvcnlMb2NrU3RhdGUgPSB7XG4gICAgb3duZXJzQnlOYW1lOiBuZXcgTWFwKCksXG4gICAgd2FpdGVyc0J5TmFtZTogbmV3IE1hcCgpXG4gIH1cblxuICAvKipcbiAgICogSWQgc2VxLlxuICAgKiBAdHlwZSB7bnVtYmVyIHwgdW5kZWZpbmVkfSAqL1xuICBpZFNlcSA9IHVuZGVmaW5lZFxuICAvKipcbiAgICogTmFycm93cyB0aGUgcnVudGltZSB2YWx1ZSB0byB0aGUgZG9jdW1lbnRlZCB0eXBlLlxuICAgKiBAdHlwZSB7VHJhbnNhY3Rpb25DYWxsYmFja0ZyYW1lW119ICovXG4gIF90cmFuc2FjdGlvbkNhbGxiYWNrRnJhbWVzXG4gIC8qKiBAdHlwZSB7UHJvbWlzZTx2b2lkPn0gKi9cbiAgX3RyYW5zYWN0aW9uQ29tcGxldGlvblByb21pc2VcbiAgLyoqIEB0eXBlIHsoKCkgPT4gdm9pZCkgfCB1bmRlZmluZWR9ICovXG4gIF9yZXNvbHZlVHJhbnNhY3Rpb25Db21wbGV0aW9uXG4gIC8qKlxuICAgKiBOYXJyb3dzIHRoZSBydW50aW1lIHZhbHVlIHRvIHRoZSBkb2N1bWVudGVkIHR5cGUuXG4gICAqIEB0eXBlIHtNYXA8c3RyaW5nLCBQcm9taXNlPFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pj59ICovXG4gIF9zY2hlbWFDYWNoZVxuICAvKipcbiAgICogTmFycm93cyB0aGUgcnVudGltZSB2YWx1ZSB0byB0aGUgZG9jdW1lbnRlZCB0eXBlLlxuICAgKiBAdHlwZSB7KCgpID0+IHZvaWQpIHwgdW5kZWZpbmVkfSAqL1xuICBfc2NoZW1hQ2FjaGVJbnZhbGlkYXRvclxuICAvKipcbiAgICogTmFycm93cyB0aGUgcnVudGltZSB2YWx1ZSB0byB0aGUgZG9jdW1lbnRlZCB0eXBlLlxuICAgKiBAdHlwZSB7c3RyaW5nIHwgdW5kZWZpbmVkfSAqL1xuICBfY29ubmVjdGlvbkNoZWNrb3V0TmFtZVxuICAvKiogQHR5cGUge3N0cmluZyB8IHVuZGVmaW5lZH0gKi9cbiAgX2RhdGFiYXNlSWRlbnRpZmllclxuICAvKiogQHR5cGUge3N0cmluZyB8IHVuZGVmaW5lZH0gKi9cbiAgX2RhdGFiYXNlSWRlbnRpdHlGaW5nZXJwcmludFxuICAvKipcbiAgICogQWN0aXZlIHF1ZXJ5LlxuICAgKiBAdHlwZSB7QWN0aXZlUXVlcnlTdGF0ZSB8IG51bGx9ICovXG4gIF9hY3RpdmVRdWVyeSA9IG51bGxcbiAgLyoqIEB0eXBlIHtXZWFrTWFwPEVycm9yLCB7c3FsRmluZ2VycHJpbnQ6IHN0cmluZywgc3FsT3BlcmF0aW9uOiBzdHJpbmd9Pn0gKi9cbiAgX2ZhaWxlZFF1ZXJ5RGlhZ25vc3RpY3MgPSBuZXcgV2Vha01hcCgpXG4gIC8qKiBAdHlwZSB7TWFwPHN0cmluZywgbnVtYmVyPn0gKi9cbiAgX2hlbGRBZHZpc29yeUxvY2tzID0gbmV3IE1hcCgpXG4gIC8qKlxuICAgKiBFeGNsdXNpdmUgb3BlcmF0aW9uIGxlYXNlIGluc3RhbGxlZCBieSBhIHNpbmdsZS1tdWx0aS11c2UgcG9vbC5cbiAgICogQHR5cGUge2ltcG9ydChcIi4uL29wZXJhdGlvbi1sZWFzZS5qc1wiKS5kZWZhdWx0IHwgdW5kZWZpbmVkfVxuICAgKi9cbiAgX29wZXJhdGlvbkxlYXNlID0gdW5kZWZpbmVkXG5cbiAgLyoqXG4gICAqIFJ1bnMgY29uc3RydWN0b3IuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vLi4vY29uZmlndXJhdGlvbi10eXBlcy5qc1wiKS5EYXRhYmFzZUNvbmZpZ3VyYXRpb25UeXBlfSBjb25maWcgLSBDb25maWd1cmF0aW9uIG9iamVjdC5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi8uLi9jb25maWd1cmF0aW9uLmpzXCIpLmRlZmF1bHR9IGNvbmZpZ3VyYXRpb24gLSBDb25maWd1cmF0aW9uIGluc3RhbmNlLlxuICAgKi9cbiAgY29uc3RydWN0b3IoY29uZmlnLCBjb25maWd1cmF0aW9uKSB7XG4gICAgdGhpcy5fYXJncyA9IGNvbmZpZ1xuICAgIHRoaXMuY29uZmlndXJhdGlvbiA9IGNvbmZpZ3VyYXRpb25cbiAgICB0aGlzLm11dGV4ID0gbmV3IE11dGV4KCkgLy8gQ2FuIGJlIHVzZWQgdG8gbG9jayB0aGlzIGluc3RhbmNlIGZvciBleGNsdXNpdmUgdXNlXG4gICAgdGhpcy5sb2dnZXIgPSBuZXcgTG9nZ2VyKHRoaXMpXG4gICAgdGhpcy5fdHJhbnNhY3Rpb25DYWxsYmFja0ZyYW1lcyA9IFtdXG4gICAgdGhpcy5fdHJhbnNhY3Rpb25zQ291bnQgPSAwXG4gICAgdGhpcy5fdHJhbnNhY3Rpb25Db21wbGV0aW9uUHJvbWlzZSA9IFByb21pc2UucmVzb2x2ZSgpXG4gICAgdGhpcy5fcmVzb2x2ZVRyYW5zYWN0aW9uQ29tcGxldGlvbiA9IHVuZGVmaW5lZFxuICAgIHRoaXMuX3RyYW5zYWN0aW9uc0FjdGlvbnNNdXRleCA9IG5ldyBNdXRleCgpXG4gICAgdGhpcy5fcGh5c2ljYWxDb25uZWN0aW9uTXV0ZXggPSBuZXcgTXV0ZXgoKVxuICAgIHRoaXMuX3NjaGVtYUNhY2hlID0gbmV3IE1hcCgpXG4gIH1cblxuICAvKipcbiAgICogU2VyaWFsaXplcyBhY2Nlc3MgdG8gb25lIHBoeXNpY2FsIGRhdGFiYXNlIHNlc3Npb24uXG4gICAqIEB0ZW1wbGF0ZSBUXG4gICAqIEBwYXJhbSB7KCkgPT4gUHJvbWlzZTxUPn0gY2FsbGJhY2sgLSBQaHlzaWNhbCBkcml2ZXIgb3BlcmF0aW9uLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxUPn0gLSBPcGVyYXRpb24gcmVzdWx0LlxuICAgKi9cbiAgYXN5bmMgX3J1blBoeXNpY2FsQ29ubmVjdGlvblJlcXVlc3QoY2FsbGJhY2spIHtcbiAgICByZXR1cm4gYXdhaXQgdGhpcy5fcGh5c2ljYWxDb25uZWN0aW9uTXV0ZXguc3luYyhhc3luYyAoKSA9PiB7XG4gICAgICByZXR1cm4gYXdhaXQgcnVuV2l0aG91dFNoYXJlZFRyYW5zYWN0aW9uQ29vcmRpbmF0b3JPd25lcih0aGlzLCBjYWxsYmFjaylcbiAgICB9KVxuICB9XG5cbiAgLyoqXG4gICAqIENsZWFucyBkcml2ZXItc3BlY2lmaWMgc2Vzc2lvbiBzdGF0ZSBiZWZvcmUgdGhpcyBsb2dpY2FsIGNvbm5lY3Rpb24gaXMgcmV1c2FibGUuXG4gICAqIERyaXZlcnMgd2hvc2UgcGh5c2ljYWwgc2Vzc2lvbnMgY2Fubm90IGJlIHNhZmVseSByZXNldCBzaG91bGQgZGlzcG9zZSB0aGVtIGhlcmUuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIHdoZW4gdGhlIG5leHQgY2hlY2tvdXQgY2Fubm90IG9ic2VydmUgcHJpb3Igc2Vzc2lvbiBzdGF0ZS5cbiAgICovXG4gIGFzeW5jIGNsZWFudXBTZXNzaW9uU3RhdGVBZnRlckNoZWNrb3V0KCkge31cblxuICAvKipcbiAgICogUnVucyBhZGQgZm9yZWlnbiBrZXkuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSB0YWJsZU5hbWUgLSBUYWJsZSBuYW1lLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gY29sdW1uTmFtZSAtIENvbHVtbiBuYW1lLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gcmVmZXJlbmNlZFRhYmxlTmFtZSAtIFJlZmVyZW5jZWQgdGFibGUgbmFtZS5cbiAgICogQHBhcmFtIHtzdHJpbmd9IHJlZmVyZW5jZWRDb2x1bW5OYW1lIC0gUmVmZXJlbmNlZCBjb2x1bW4gbmFtZS5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBPcHRpb25zIG9iamVjdC5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgd2hlbiBjb21wbGV0ZS5cbiAgICovXG4gIGFzeW5jIGFkZEZvcmVpZ25LZXkodGFibGVOYW1lLCBjb2x1bW5OYW1lLCByZWZlcmVuY2VkVGFibGVOYW1lLCByZWZlcmVuY2VkQ29sdW1uTmFtZSwgYXJncykge1xuICAgIHRoaXMuX2Fzc2VydE5vdFJlYWRPbmx5KClcbiAgICBjb25zdCB0YWJsZUZvcmVpZ25LZXlBcmdzID0gT2JqZWN0LmFzc2lnbihcbiAgICAgIHtcbiAgICAgICAgY29sdW1uTmFtZSxcbiAgICAgICAgdGFibGVOYW1lLFxuICAgICAgICByZWZlcmVuY2VkQ29sdW1uTmFtZSxcbiAgICAgICAgcmVmZXJlbmNlZFRhYmxlTmFtZVxuICAgICAgfSxcbiAgICAgIGFyZ3NcbiAgICApXG4gICAgY29uc3QgdGFibGVGb3JlaWduS2V5ID0gbmV3IFRhYmxlRm9yZWlnbktleSh0YWJsZUZvcmVpZ25LZXlBcmdzKVxuICAgIGNvbnN0IHRhYmxlRGF0YSA9IG5ldyBUYWJsZURhdGEodGFibGVOYW1lKVxuXG4gICAgdGFibGVEYXRhLmFkZEZvcmVpZ25LZXkodGFibGVGb3JlaWduS2V5KVxuXG4gICAgY29uc3QgYWx0ZXJUYWJsZVNRTHMgPSBhd2FpdCB0aGlzLmFsdGVyVGFibGVTUUxzKHRhYmxlRGF0YSlcblxuICAgIGZvciAoY29uc3QgYWx0ZXJUYWJsZVNRTCBvZiBhbHRlclRhYmxlU1FMcykge1xuICAgICAgYXdhaXQgdGhpcy5xdWVyeShhbHRlclRhYmxlU1FMKVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHJlbW92ZSBmb3JlaWduIGtleS5cbiAgICogQHBhcmFtIHtzdHJpbmd9IHRhYmxlTmFtZSAtIFRhYmxlIG5hbWUuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi9iYXNlLWZvcmVpZ24ta2V5LmpzXCIpLmRlZmF1bHR9IGZvcmVpZ25LZXlNZXRhZGF0YSAtIEZvcmVpZ24ga2V5IG1ldGFkYXRhLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyB3aGVuIGNvbXBsZXRlLlxuICAgKi9cbiAgYXN5bmMgcmVtb3ZlRm9yZWlnbktleSh0YWJsZU5hbWUsIGZvcmVpZ25LZXlNZXRhZGF0YSkge1xuICAgIHRoaXMuX2Fzc2VydE5vdFJlYWRPbmx5KClcblxuICAgIGNvbnN0IHRhYmxlRm9yZWlnbktleSA9IG5ldyBUYWJsZUZvcmVpZ25LZXkoe1xuICAgICAgY29sdW1uTmFtZTogZm9yZWlnbktleU1ldGFkYXRhLmdldENvbHVtbk5hbWUoKSxcbiAgICAgIGRyb3BGb3JlaWduS2V5OiB0cnVlLFxuICAgICAgbmFtZTogZm9yZWlnbktleU1ldGFkYXRhLmdldE5hbWUoKSxcbiAgICAgIHJlZmVyZW5jZWRDb2x1bW5OYW1lOiBmb3JlaWduS2V5TWV0YWRhdGEuZ2V0UmVmZXJlbmNlZENvbHVtbk5hbWUoKSxcbiAgICAgIHJlZmVyZW5jZWRUYWJsZU5hbWU6IGZvcmVpZ25LZXlNZXRhZGF0YS5nZXRSZWZlcmVuY2VkVGFibGVOYW1lKCksXG4gICAgICB0YWJsZU5hbWVcbiAgICB9KVxuICAgIGNvbnN0IHRhYmxlRGF0YSA9IG5ldyBUYWJsZURhdGEodGFibGVOYW1lKVxuXG4gICAgdGFibGVEYXRhLmFkZEZvcmVpZ25LZXkodGFibGVGb3JlaWduS2V5KVxuXG4gICAgY29uc3QgYWx0ZXJUYWJsZVNRTHMgPSBhd2FpdCB0aGlzLmFsdGVyVGFibGVTUUxzKHRhYmxlRGF0YSlcblxuICAgIGZvciAoY29uc3QgYWx0ZXJUYWJsZVNRTCBvZiBhbHRlclRhYmxlU1FMcykge1xuICAgICAgYXdhaXQgdGhpcy5xdWVyeShhbHRlclRhYmxlU1FMKVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGFsdGVyIHRhYmxlIHNxbHMuXG4gICAqIEBhYnN0cmFjdFxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL3RhYmxlLWRhdGEvaW5kZXguanNcIikuZGVmYXVsdH0gX3RhYmxlRGF0YSAtIFRhYmxlIGRhdGEuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHN0cmluZ1tdPn0gLSBSZXNvbHZlcyB3aXRoIFNRTCBzdGF0ZW1lbnRzLlxuICAgKi9cbiAgYWx0ZXJUYWJsZVNRTHMoX3RhYmxlRGF0YSkge1xuICAgIHRocm93IG5ldyBFcnJvcihcImFsdGVyVGFibGVTUUxzIG5vdCBpbXBsZW1lbnRlZFwiKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgY29ubmVjdC5cbiAgICogQGFic3RyYWN0XG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIHdoZW4gY29tcGxldGUuXG4gICAqL1xuICBjb25uZWN0KCkge1xuICAgIHRocm93IG5ldyBFcnJvcihcIidjb25uZWN0JyBub3QgaW1wbGVtZW50ZWRcIilcbiAgfVxuXG4gIC8qKlxuICAgKiBSZWxlYXNlcyB0cmFja2VkIGFkdmlzb3J5IGxvY2tzIGFuZCBjbG9zZXMgdGhlIHBoeXNpY2FsIGRhdGFiYXNlIGNvbm5lY3Rpb24uXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIHdoZW4gY2xlYW51cCBhbmQgY2xvc2UgY29tcGxldGUuXG4gICAqL1xuICBhc3luYyBjbG9zZSgpIHtcbiAgICAvKiogQHR5cGUge0Vycm9yIHwgdW5kZWZpbmVkfSAqL1xuICAgIGxldCBhZHZpc29yeUxvY2tFcnJvclxuXG4gICAgdHJ5IHtcbiAgICAgIGF3YWl0IHRoaXMucmVsZWFzZUhlbGRBZHZpc29yeUxvY2tzKClcbiAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgYWR2aXNvcnlMb2NrRXJyb3IgPSBlcnJvciBpbnN0YW5jZW9mIEVycm9yID8gZXJyb3IgOiBuZXcgRXJyb3IoXCJGYWlsZWQgdG8gcmVsZWFzZSBoZWxkIGFkdmlzb3J5IGxvY2tzXCIsIHtjYXVzZTogZXJyb3J9KVxuICAgIH1cblxuICAgIHRyeSB7XG4gICAgICBhd2FpdCB0aGlzLl9jbG9zZSgpXG4gICAgICB0aGlzLl9oZWxkQWR2aXNvcnlMb2Nrcy5jbGVhcigpXG4gICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgIGNvbnN0IGNsb3NlRXJyb3IgPSBlcnJvciBpbnN0YW5jZW9mIEVycm9yID8gZXJyb3IgOiBuZXcgRXJyb3IoXCJGYWlsZWQgdG8gY2xvc2UgZGF0YWJhc2UgY29ubmVjdGlvblwiLCB7Y2F1c2U6IGVycm9yfSlcblxuICAgICAgaWYgKGFkdmlzb3J5TG9ja0Vycm9yKSB7XG4gICAgICAgIHRocm93IG5ldyBBZ2dyZWdhdGVFcnJvcihbYWR2aXNvcnlMb2NrRXJyb3IsIGNsb3NlRXJyb3JdLCBcIkZhaWxlZCB0byByZWxlYXNlIGFkdmlzb3J5IGxvY2tzIGFuZCBjbG9zZSBkYXRhYmFzZSBjb25uZWN0aW9uXCIsIHtjYXVzZTogZXJyb3J9KVxuICAgICAgfVxuXG4gICAgICB0aHJvdyBjbG9zZUVycm9yXG4gICAgfVxuXG4gICAgaWYgKGFkdmlzb3J5TG9ja0Vycm9yKSB0aHJvdyBhZHZpc29yeUxvY2tFcnJvclxuICB9XG5cbiAgLyoqXG4gICAqIERyaXZlci1zcGVjaWZpYyBwaHlzaWNhbCBjbG9zZSBob29rLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyB3aGVuIHRoZSB1bmRlcmx5aW5nIGNvbm5lY3Rpb24gY2xvc2VzLlxuICAgKi9cbiAgYXN5bmMgX2Nsb3NlKCkge1xuICAgIC8vIE5vLW9wIGJ5IGRlZmF1bHRcbiAgfVxuXG4gIC8qKlxuICAgKiBGbHVzaGVzIHBlbmRpbmcgd3JpdGVzIHRoYXQgdGhlIGRyaXZlciBkZWxheWVkIGZvciBwZXJzaXN0ZW5jZS5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgd2hlbiBwZW5kaW5nIHdyaXRlcyBhcmUgZHVyYWJsZS5cbiAgICovXG4gIGFzeW5jIGZsdXNoUGVuZGluZ1dyaXRlcygpIHtcbiAgICAvLyBOby1vcCBieSBkZWZhdWx0XG4gIH1cblxuICAvKipcbiAgICogUmV0dXJucyB3aGV0aGVyIGRlbGF5ZWQgcGVyc2lzdGVuY2Ugd3JpdGVzIHJlbWFpbi5cbiAgICogQHJldHVybnMge2Jvb2xlYW59IC0gV2hldGhlciB3cml0ZXMgcmVtYWluLlxuICAgKi9cbiAgaGFzUGVuZGluZ1dyaXRlcygpIHsgcmV0dXJuIGZhbHNlIH1cblxuICAvKipcbiAgICogRGVsZXRlcyB0aGlzIGRyaXZlcidzIHBoeXNpY2FsIGRhdGFiYXNlIHN0b3JhZ2Ugd2l0aG91dCBvcGVuaW5nIGl0LlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyBhZnRlciBkZWxldGlvbi5cbiAgICovXG4gIGFzeW5jIGRlbGV0ZURhdGFiYXNlU3RvcmFnZSgpIHsgdGhyb3cgbmV3IEVycm9yKGBEYXRhYmFzZSBzdG9yYWdlIGRlbGV0aW9uIGlzIG5vdCBzdXBwb3J0ZWQgYnkgJHt0aGlzLmNvbnN0cnVjdG9yLm5hbWV9YCkgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHNldCBjb25uZWN0aW9uIGNoZWNrb3V0IG5hbWUuXG4gICAqIEBwYXJhbSB7c3RyaW5nIHwgdW5kZWZpbmVkfSBuYW1lIC0gSHVtYW4tcmVhZGFibGUgbmFtZSBmb3IgdGhpcyBhY3RpdmUgY2hlY2tvdXQuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIHdoZW4gY29tcGxldGUuXG4gICAqL1xuICBhc3luYyBzZXRDb25uZWN0aW9uQ2hlY2tvdXROYW1lKG5hbWUpIHtcbiAgICB0aGlzLl9jb25uZWN0aW9uQ2hlY2tvdXROYW1lID0gbmFtZVxuICAgIHRoaXMuX2Nvbm5lY3Rpb25DaGVja2VkT3V0QXRVbml4TXMgPSBEYXRlLm5vdygpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBjbGVhciBjb25uZWN0aW9uIGNoZWNrb3V0IG5hbWUuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIHdoZW4gY29tcGxldGUuXG4gICAqL1xuICBhc3luYyBjbGVhckNvbm5lY3Rpb25DaGVja291dE5hbWUoKSB7XG4gICAgdGhpcy5fY29ubmVjdGlvbkNoZWNrb3V0TmFtZSA9IHVuZGVmaW5lZFxuICAgIHRoaXMuX2Nvbm5lY3Rpb25DaGVja2VkT3V0QXRVbml4TXMgPSB1bmRlZmluZWRcbiAgfVxuXG4gIC8qKlxuICAgKiBTZXRzIHRoZSBwb29sLW93bmVkIGlkZW50aXR5IHVzZWQgYnkgc2FmZSBkYXRhYmFzZSBkaWFnbm9zdGljcy5cbiAgICogQHBhcmFtIHt7ZGF0YWJhc2VJZGVudGlmaWVyOiBzdHJpbmcsIGRhdGFiYXNlSWRlbnRpdHlGaW5nZXJwcmludDogc3RyaW5nfX0gaWRlbnRpdHkgLSBQb29sLXN0YW1wZWQgaWRlbnRpdHkgcmVkYWN0ZWQgYXQgZGlhZ25vc3RpYyBzbmFwc2hvdCB0aW1lLlxuICAgKiBAcmV0dXJucyB7dm9pZH1cbiAgICovXG4gIHNldFBvb2xEaWFnbm9zdGljSWRlbnRpdHkoe2RhdGFiYXNlSWRlbnRpZmllciwgZGF0YWJhc2VJZGVudGl0eUZpbmdlcnByaW50fSkge1xuICAgIHRoaXMuX2RhdGFiYXNlSWRlbnRpZmllciA9IGRhdGFiYXNlSWRlbnRpZmllclxuICAgIHRoaXMuX2RhdGFiYXNlSWRlbnRpdHlGaW5nZXJwcmludCA9IGRhdGFiYXNlSWRlbnRpdHlGaW5nZXJwcmludFxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgcmVjb25uZWN0LlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyB3aGVuIGNvbXBsZXRlLlxuICAgKi9cbiAgYXN5bmMgcmVjb25uZWN0KCkge1xuICAgIHRoaXMuY2xlYXJTY2hlbWFDYWNoZSgpXG4gICAgYXdhaXQgdGhpcy5jbG9zZSgpXG4gICAgYXdhaXQgdGhpcy5jb25uZWN0KClcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGNyZWF0ZSBkYXRhYmFzZSBzcWwuXG4gICAqIEBhYnN0cmFjdFxuICAgKiBAcGFyYW0ge3N0cmluZ30gZGF0YWJhc2VOYW1lIC0gRGF0YWJhc2UgbmFtZS5cbiAgICogQHBhcmFtIHtvYmplY3R9IFthcmdzXSAtIE9wdGlvbnMgb2JqZWN0LlxuICAgKiBAcGFyYW0ge2Jvb2xlYW59IFthcmdzLmlmTm90RXhpc3RzXSAtIFdoZXRoZXIgaWYgbm90IGV4aXN0cy5cbiAgICogQHBhcmFtIHtzdHJpbmd9IFthcmdzLmRhdGFiYXNlQ2hhcnNldF0gLSBEYXRhYmFzZS1kZWZhdWx0IGNoYXJhY3RlciBzZXQgKGRyaXZlci1zcGVjaWZpYzsgbXlzcWwvbWFyaWFkYikuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBbYXJncy5kYXRhYmFzZUNvbGxhdGlvbl0gLSBEYXRhYmFzZS1kZWZhdWx0IGNvbGxhdGlvbiAoZHJpdmVyLXNwZWNpZmljOyBteXNxbC9tYXJpYWRiKS5cbiAgICogQHJldHVybnMge3N0cmluZ1tdfSAtIFNRTCBzdGF0ZW1lbnRzLlxuICAgKi9cbiAgY3JlYXRlRGF0YWJhc2VTcWwoZGF0YWJhc2VOYW1lLCBhcmdzKSB7IHRocm93IG5ldyBFcnJvcihcIidjcmVhdGVEYXRhYmFzZVNxbCcgbm90IGltcGxlbWVudGVkXCIpIH0gLy8gZXNsaW50LWRpc2FibGUtbGluZSBuby11bnVzZWQtdmFyc1xuXG4gIC8qKlxuICAgKiBSdW5zIGRyb3AgZGF0YWJhc2Ugc3FsLlxuICAgKiBAYWJzdHJhY3RcbiAgICogQHBhcmFtIHtzdHJpbmd9IGRhdGFiYXNlTmFtZSAtIERhdGFiYXNlIG5hbWUuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBbYXJnc10gLSBPcHRpb25zIG9iamVjdC5cbiAgICogQHBhcmFtIHtib29sZWFufSBbYXJncy5pZkV4aXN0c10gLSBXaGV0aGVyIGlmIGV4aXN0cy5cbiAgICogQHJldHVybnMge3N0cmluZ1tdfSAtIFNRTCBzdGF0ZW1lbnRzLlxuICAgKi9cbiAgZHJvcERhdGFiYXNlU3FsKGRhdGFiYXNlTmFtZSwgYXJncykgeyB0aHJvdyBuZXcgRXJyb3IoXCInZHJvcERhdGFiYXNlU3FsJyBub3QgaW1wbGVtZW50ZWRcIikgfSAvLyBlc2xpbnQtZGlzYWJsZS1saW5lIG5vLXVudXNlZC12YXJzXG5cbiAgLyoqXG4gICAqIFJ1bnMgY3JlYXRlIGluZGV4IHNxbHMuXG4gICAqIEBhYnN0cmFjdFxuICAgKiBAcGFyYW0ge0NyZWF0ZUluZGV4U3FsQXJnc30gaW5kZXhEYXRhIC0gSW5kZXggZGF0YS5cbiAgICogQHJldHVybnMge1Byb21pc2U8c3RyaW5nW10+fSAtIFJlc29sdmVzIHdpdGggU1FMIHN0YXRlbWVudHMuXG4gICAqL1xuICBhc3luYyBjcmVhdGVJbmRleFNRTHMoaW5kZXhEYXRhKSB7IC8vIGVzbGludC1kaXNhYmxlLWxpbmUgbm8tdW51c2VkLXZhcnNcbiAgICB0aHJvdyBuZXcgRXJyb3IoXCInY3JlYXRlSW5kZXhTUUxzJyBub3QgaW1wbGVtZW50ZWRcIilcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHJlbW92ZSBpbmRleCBzcWxzLlxuICAgKiBAYWJzdHJhY3RcbiAgICogQHBhcmFtIHtSZW1vdmVJbmRleFNxbEFyZ3N9IGluZGV4RGF0YSAtIEluZGV4IGRhdGEuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHN0cmluZ1tdPn0gLSBSZXNvbHZlcyB3aXRoIFNRTCBzdGF0ZW1lbnRzLlxuICAgKi9cbiAgYXN5bmMgcmVtb3ZlSW5kZXhTUUxzKGluZGV4RGF0YSkgeyAvLyBlc2xpbnQtZGlzYWJsZS1saW5lIG5vLXVudXNlZC12YXJzXG4gICAgdGhyb3cgbmV3IEVycm9yKFwiJ3JlbW92ZUluZGV4U1FMcycgbm90IGltcGxlbWVudGVkXCIpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBjcmVhdGUgdGFibGUuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vdGFibGUtZGF0YS9pbmRleC5qc1wiKS5kZWZhdWx0fSB0YWJsZURhdGEgLSBUYWJsZSBkYXRhLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyB3aGVuIGNvbXBsZXRlLlxuICAgKi9cbiAgYXN5bmMgY3JlYXRlVGFibGUodGFibGVEYXRhKSB7XG4gICAgdGhpcy5fYXNzZXJ0Tm90UmVhZE9ubHkoKVxuICAgIGNvbnN0IHNxbHMgPSBhd2FpdCB0aGlzLmNyZWF0ZVRhYmxlU3FsKHRhYmxlRGF0YSlcblxuICAgIGZvciAoY29uc3Qgc3FsIG9mIHNxbHMpIHtcbiAgICAgIGF3YWl0IHRoaXMucXVlcnkoc3FsKVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGNyZWF0ZSB0YWJsZSBzcWwuXG4gICAqIEBhYnN0cmFjdFxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL3RhYmxlLWRhdGEvaW5kZXguanNcIikuZGVmYXVsdH0gdGFibGVEYXRhIC0gVGFibGUgZGF0YS5cbiAgICogQHJldHVybnMge1Byb21pc2U8c3RyaW5nW10+fSAtIFJlc29sdmVzIHdpdGggU1FMIHN0YXRlbWVudHMuXG4gICAqL1xuICBhc3luYyBjcmVhdGVUYWJsZVNxbCh0YWJsZURhdGEpIHsgLy8gZXNsaW50LWRpc2FibGUtbGluZSBuby11bnVzZWQtdmFyc1xuICAgIHRocm93IG5ldyBFcnJvcihcIidjcmVhdGVUYWJsZVNxbCcgbm90IGltcGxlbWVudGVkXCIpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBkZWxldGUuXG4gICAqIEBwYXJhbSB7RGVsZXRlU3FsQXJnc1R5cGV9IGFyZ3MgLSBPcHRpb25zIG9iamVjdC5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgd2hlbiBjb21wbGV0ZS5cbiAgICovXG4gIGFzeW5jIGRlbGV0ZShhcmdzKSB7XG4gICAgdGhpcy5fYXNzZXJ0Tm90UmVhZE9ubHkoKVxuICAgIGNvbnN0IHNxbCA9IHRoaXMuZGVsZXRlU3FsKGFyZ3MpXG5cbiAgICBhd2FpdCB0aGlzLnF1ZXJ5KHNxbClcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGRlbGV0ZSBzcWwuXG4gICAqIEBhYnN0cmFjdFxuICAgKiBAcGFyYW0ge0RlbGV0ZVNxbEFyZ3NUeXBlfSBhcmdzIC0gT3B0aW9ucyBvYmplY3QuXG4gICAqIEByZXR1cm5zIHtzdHJpbmd9IC0gU1FMIHN0cmluZy5cbiAgICovXG4gIGRlbGV0ZVNxbChhcmdzKSB7IC8vIGVzbGludC1kaXNhYmxlLWxpbmUgbm8tdW51c2VkLXZhcnNcbiAgICB0aHJvdyBuZXcgRXJyb3IoYCdkZWxldGVTcWwnIG5vdCBpbXBsZW1lbnRlZGApXG4gIH1cblxuICAvKipcbiAgICogUnVucyBkcm9wIHRhYmxlLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gdGFibGVOYW1lIC0gVGFibGUgbmFtZS5cbiAgICogQHBhcmFtIHtEcm9wVGFibGVTcWxBcmdzVHlwZX0gW2FyZ3NdIC0gT3B0aW9ucyBvYmplY3QuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIHdoZW4gY29tcGxldGUuXG4gICAqL1xuICBhc3luYyBkcm9wVGFibGUodGFibGVOYW1lLCBhcmdzKSB7XG4gICAgdGhpcy5fYXNzZXJ0Tm90UmVhZE9ubHkoKVxuICAgIGNvbnN0IHNxbHMgPSBhd2FpdCB0aGlzLmRyb3BUYWJsZVNRTHModGFibGVOYW1lLCBhcmdzKVxuXG4gICAgZm9yIChjb25zdCBzcWwgb2Ygc3Fscykge1xuICAgICAgYXdhaXQgdGhpcy5xdWVyeShzcWwpXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZHJvcCB0YWJsZSBzcWxzLlxuICAgKiBAYWJzdHJhY3RcbiAgICogQHBhcmFtIHtzdHJpbmd9IHRhYmxlTmFtZSAtIFRhYmxlIG5hbWUuXG4gICAqIEBwYXJhbSB7RHJvcFRhYmxlU3FsQXJnc1R5cGV9IFthcmdzXSAtIE9wdGlvbnMgb2JqZWN0LlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxzdHJpbmdbXT59IC0gUmVzb2x2ZXMgd2l0aCBTUUwgc3RhdGVtZW50cy5cbiAgICovXG4gIGFzeW5jIGRyb3BUYWJsZVNRTHModGFibGVOYW1lLCBhcmdzKSB7IC8vIGVzbGludC1kaXNhYmxlLWxpbmUgbm8tdW51c2VkLXZhcnNcbiAgICB0aHJvdyBuZXcgRXJyb3IoXCJkcm9wVGFibGVTUUxzIG5vdCBpbXBsZW1lbnRlZFwiKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZXNjYXBlLlxuICAgKiBAYWJzdHJhY3RcbiAgICogQHBhcmFtIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gdmFsdWUgLSBWYWx1ZSB0byB1c2UuXG4gICAqIEByZXR1cm5zIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gLSBUaGUgZXNjYXBlLlxuICAgKi9cbiAgZXNjYXBlKHZhbHVlKSB7IC8vIGVzbGludC1kaXNhYmxlLWxpbmUgbm8tdW51c2VkLXZhcnNcbiAgICB0aHJvdyBuZXcgRXJyb3IoXCInZXNjYXBlJyBub3QgaW1wbGVtZW50ZWRcIilcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGdldCBhcmdzLlxuICAgKiBAcmV0dXJucyB7aW1wb3J0KFwiLi4vLi4vY29uZmlndXJhdGlvbi10eXBlcy5qc1wiKS5EYXRhYmFzZUNvbmZpZ3VyYXRpb25UeXBlfSAtIFRoZSBhcmdzLlxuICAgKi9cbiAgZ2V0QXJncygpIHtcbiAgICByZXR1cm4gdGhpcy5fYXJnc1xuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZ2V0IGNvbmZpZ3VyYXRpb24uXG4gICAqIEByZXR1cm5zIHtpbXBvcnQoXCIuLi8uLi9jb25maWd1cmF0aW9uLmpzXCIpLmRlZmF1bHR9IC0gVGhlIGNvbmZpZ3VyYXRpb24uXG4gICAqL1xuICBnZXRDb25maWd1cmF0aW9uKCkge1xuICAgIGlmICghdGhpcy5jb25maWd1cmF0aW9uKSB0aHJvdyBuZXcgRXJyb3IoXCJObyBjb25maWd1cmF0aW9uIHNldFwiKVxuXG4gICAgcmV0dXJuIHRoaXMuY29uZmlndXJhdGlvblxuICB9XG5cbiAgLyoqXG4gICAqIEluc3RhbGxzIGFuIG9wZXJhdGlvbiBsZWFzZSBhdG9taWNhbGx5IHdpdGggb3JkaW5hcnkgdHJhbnNhY3Rpb24gYWRtaXNzaW9uLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL29wZXJhdGlvbi1sZWFzZS5qc1wiKS5kZWZhdWx0fSBvcGVyYXRpb25MZWFzZSAtIEFjdGl2ZSBsZWFzZS5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgb25jZSB0aGUgbGVhc2Ugb3ducyB0cmFuc2FjdGlvbiBhZG1pc3Npb24uXG4gICAqL1xuICBhc3luYyBzZXRPcGVyYXRpb25MZWFzZShvcGVyYXRpb25MZWFzZSkge1xuICAgIGF3YWl0IHRoaXMuX3RyYW5zYWN0aW9uc0FjdGlvbnNNdXRleC5zeW5jKGFzeW5jICgpID0+IHtcbiAgICAgIGlmICh0aGlzLl9vcGVyYXRpb25MZWFzZSkgdGhyb3cgbmV3IEVycm9yKFwiQSBkYXRhYmFzZSBvcGVyYXRpb24gbGVhc2UgaXMgYWxyZWFkeSBhY3RpdmVcIilcbiAgICAgIGlmICh0aGlzLl90cmFuc2FjdGlvbnNDb3VudCA+IDApIHtcbiAgICAgICAgdGhyb3cgbmV3IEVycm9yKFwiQ2Fubm90IHN0YXJ0IGEgZGF0YWJhc2Ugb3BlcmF0aW9uIHdoaWxlIGFuIHVucmVsYXRlZCBvcmRpbmFyeSB0cmFuc2FjdGlvbiBpcyBhbHJlYWR5IGFjdGl2ZVwiKVxuICAgICAgfVxuXG4gICAgICB0aGlzLl9vcGVyYXRpb25MZWFzZSA9IG9wZXJhdGlvbkxlYXNlXG4gICAgfSlcbiAgfVxuXG4gIC8qKlxuICAgKiBDbGVhcnMgdGhlIG1hdGNoaW5nIG9wZXJhdGlvbiBsZWFzZS5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9vcGVyYXRpb24tbGVhc2UuanNcIikuZGVmYXVsdH0gb3BlcmF0aW9uTGVhc2UgLSBMZWFzZSB0byBjbGVhci5cbiAgICogQHJldHVybnMge3ZvaWR9XG4gICAqL1xuICBjbGVhck9wZXJhdGlvbkxlYXNlKG9wZXJhdGlvbkxlYXNlKSB7XG4gICAgaWYgKHRoaXMuX29wZXJhdGlvbkxlYXNlICE9PSBvcGVyYXRpb25MZWFzZSkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKFwiQ2Fubm90IGNsZWFyIGEgZGF0YWJhc2Ugb3BlcmF0aW9uIGxlYXNlIG93bmVkIGJ5IGFub3RoZXIgb3BlcmF0aW9uXCIpXG4gICAgfVxuXG4gICAgdGhpcy5fb3BlcmF0aW9uTGVhc2UgPSB1bmRlZmluZWRcbiAgfVxuXG4gIC8qKlxuICAgKiBXYWl0cyBmb3IgYW4gdW5yZWxhdGVkIG9wZXJhdGlvbiBsZWFzZSB0byByZWxlYXNlLlxuICAgKiBAcGFyYW0ge3N5bWJvbCB8IHVuZGVmaW5lZH0gb3BlcmF0aW9uT3duZXIgLSBDYW5kaWRhdGUgb3BlcmF0aW9uIG93bmVyLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn1cbiAgICovXG4gIGFzeW5jIF93YWl0Rm9yT3BlcmF0aW9uTGVhc2Uob3BlcmF0aW9uT3duZXIpIHtcbiAgICBjb25zdCBvcGVyYXRpb25MZWFzZSA9IHRoaXMuX29wZXJhdGlvbkxlYXNlXG5cbiAgICBpZiAob3BlcmF0aW9uTGVhc2UpIGF3YWl0IG9wZXJhdGlvbkxlYXNlLndhaXQob3BlcmF0aW9uT3duZXIpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBnZXQgaWQgc2VxLlxuICAgKiBAcmV0dXJucyB7bnVtYmVyIHwgdW5kZWZpbmVkfSAtIFRoZSBpZCBzZXEuXG4gICAqL1xuICBnZXRJZFNlcSgpIHtcbiAgICByZXR1cm4gdGhpcy5pZFNlcVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgcHJpbWFyeSBrZXkgdHlwZS5cbiAgICogQHJldHVybnMge3N0cmluZ30gLSBDb25maWd1cmVkIHByaW1hcnkga2V5IHR5cGUsIGRlZmF1bHRpbmcgdG8gVVVJRC5cbiAgICovXG4gIHByaW1hcnlLZXlUeXBlKCkge1xuICAgIHJldHVybiB0aGlzLmdldEFyZ3MoKS5wcmltYXJ5S2V5VHlwZSB8fCBcInV1aWRcIlxuICB9XG5cbiAgLyoqXG4gICAqIENsZWFycyBjYWNoZWQgc2NoZW1hIG1ldGFkYXRhIGZvciB0aGlzIGRyaXZlciBpbnN0YW5jZS5cbiAgICogQHJldHVybnMge3ZvaWR9IC0gTm8gcmV0dXJuIHZhbHVlLlxuICAgKi9cbiAgY2xlYXJTY2hlbWFDYWNoZSgpIHtcbiAgICBpZiAodGhpcy5fc2NoZW1hQ2FjaGVJbnZhbGlkYXRvcikge1xuICAgICAgdGhpcy5fc2NoZW1hQ2FjaGVJbnZhbGlkYXRvcigpXG4gICAgICByZXR1cm5cbiAgICB9XG5cbiAgICB0aGlzLl9jbGVhckxvY2FsU2NoZW1hQ2FjaGUoKVxuICB9XG5cbiAgLyoqXG4gICAqIENsZWFycyBvbmx5IHRoZSBtZXRhZGF0YSBjYWNoZWQgb24gdGhpcyBkcml2ZXIgaW5zdGFuY2UuXG4gICAqIEByZXR1cm5zIHt2b2lkfSAtIE5vIHJldHVybiB2YWx1ZS5cbiAgICovXG4gIF9jbGVhckxvY2FsU2NoZW1hQ2FjaGUoKSB7XG4gICAgdGhpcy5fc2NoZW1hQ2FjaGUuY2xlYXIoKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgc2V0IHNjaGVtYSBjYWNoZSBpbnZhbGlkYXRvci5cbiAgICogQHBhcmFtIHsoKSA9PiB2b2lkfSBpbnZhbGlkYXRvciAtIENhbGxiYWNrIHVzZWQgdG8gY2xlYXIgc2NoZW1hIGNhY2hlcyB0aGF0IHNoYXJlIHRoaXMgZHJpdmVyIHBvb2wuXG4gICAqIEByZXR1cm5zIHt2b2lkfSAtIE5vIHJldHVybiB2YWx1ZS5cbiAgICovXG4gIHNldFNjaGVtYUNhY2hlSW52YWxpZGF0b3IoaW52YWxpZGF0b3IpIHtcbiAgICB0aGlzLl9zY2hlbWFDYWNoZUludmFsaWRhdG9yID0gaW52YWxpZGF0b3JcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHNjaGVtYSBjYWNoZSBlbmFibGVkLlxuICAgKiBAcmV0dXJucyB7Ym9vbGVhbn0gLSBXaGV0aGVyIHNjaGVtYSBtZXRhZGF0YSBjYWNoaW5nIGlzIGVuYWJsZWQuXG4gICAqL1xuICBfc2NoZW1hQ2FjaGVFbmFibGVkKCkge1xuICAgIHJldHVybiB0aGlzLmdldEFyZ3MoKS5zY2hlbWFDYWNoZSAhPT0gZmFsc2VcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHNjaGVtYSBtZXRhZGF0YSByZXRyeSBkZWFkbGluZSBtcy5cbiAgICogQHJldHVybnMge251bWJlcn0gLSBCb3VuZGVkIGRlYWRsaW5lIGZvciBvdXRsYXN0aW5nIHRyYW5zaWVudCBzY2hlbWEtbWV0YWRhdGEgY29udGVudGlvbi5cbiAgICovXG4gIF9zY2hlbWFNZXRhZGF0YVJldHJ5RGVhZGxpbmVNcygpIHtcbiAgICBjb25zdCBjb25maWd1cmVkID0gdGhpcy5nZXRBcmdzKCkuc2NoZW1hTWV0YWRhdGFSZXRyeURlYWRsaW5lTXNcblxuICAgIHJldHVybiB0eXBlb2YgY29uZmlndXJlZCA9PT0gXCJudW1iZXJcIiA/IGNvbmZpZ3VyZWQgOiBTQ0hFTUFfTUVUQURBVEFfUkVUUllfREVBRExJTkVfTVNcbiAgfVxuXG4gIC8qKlxuICAgKiBXaGV0aGVyIGFuIGVycm9yIHJhaXNlZCBieSBhIHNjaGVtYS1tZXRhZGF0YSByZWFkIGlzIHRyYW5zaWVudCBjb250ZW50aW9uIHRoYXQgYSBib3VuZGVkXG4gICAqIHJldHJ5IGNhbiBvdXRsYXN0LiBEcml2ZXJzIG92ZXJyaWRlIHRoaXMgZm9yIHRoZWlyIG93biBjb250ZW50aW9uIHNpZ25hdHVyZXM7IHRoZSBkZWZhdWx0XG4gICAqIHRyZWF0cyBldmVyeSBmYWlsdXJlIGFzIGZpbmFsIHNvIG9ubHkgZHJpdmVycyB0aGF0IHByb3ZlIHRoZSB0cmFuc2llbnQgc2hhcGUgcmV0cnkgaXQuXG4gICAqIEBwYXJhbSB7dW5rbm93bn0gX2Vycm9yIC0gRXJyb3IgcmFpc2VkIGJ5IGEgc2NoZW1hLW1ldGFkYXRhIHJlYWQuXG4gICAqIEByZXR1cm5zIHtib29sZWFufSAtIFdoZXRoZXIgdGhlIHJlYWQgbWF5IGJlIHJldHJpZWQuXG4gICAqL1xuICBfaXNUcmFuc2llbnRTY2hlbWFNZXRhZGF0YUVycm9yKF9lcnJvcikge1xuICAgIHJldHVybiBmYWxzZVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgYSBzY2hlbWEtbWV0YWRhdGEgcmVhZCwgcmV0cnlpbmcgdHJhbnNpZW50IGNvbmN1cnJlbnQtRERMIGNvbnRlbnRpb24gdW50aWwgdGhlIGJvdW5kZWRcbiAgICogZGVhZGxpbmUuIE5vbi10cmFuc2llbnQgZmFpbHVyZXMgYW5kIGV4aGF1c3RlZCBkZWFkbGluZXMgcHJvcGFnYXRlIHRoZSBvcmlnaW5hbCBlcnJvci5cbiAgICogQHRlbXBsYXRlIFRcbiAgICogQHBhcmFtIHsoKSA9PiBQcm9taXNlPFQ+fSBjYWxsYmFjayAtIENhY2hlLW1pc3Mgc2NoZW1hIHJlYWQuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPFQ+fSAtIFJlc29sdmVzIHdpdGggdGhlIHJlYWQgcmVzdWx0LlxuICAgKi9cbiAgYXN5bmMgX3dpdGhTY2hlbWFNZXRhZGF0YURkbFJldHJ5KGNhbGxiYWNrKSB7XG4gICAgY29uc3QgZGVhZGxpbmVNcyA9IHRoaXMuX3NjaGVtYU1ldGFkYXRhUmV0cnlEZWFkbGluZU1zKClcbiAgICBjb25zdCBzdGFydGVkQXQgPSBEYXRlLm5vdygpXG4gICAgbGV0IGRlbGF5TXMgPSBTQ0hFTUFfTUVUQURBVEFfUkVUUllfSU5JVElBTF9ERUxBWV9NU1xuXG4gICAgZm9yICg7Oykge1xuICAgICAgdHJ5IHtcbiAgICAgICAgcmV0dXJuIGF3YWl0IGNhbGxiYWNrKClcbiAgICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICAgIGlmICghdGhpcy5faXNUcmFuc2llbnRTY2hlbWFNZXRhZGF0YUVycm9yKGVycm9yKSkgdGhyb3cgZXJyb3JcbiAgICAgICAgaWYgKERhdGUubm93KCkgLSBzdGFydGVkQXQgKyBkZWxheU1zID4gZGVhZGxpbmVNcykgdGhyb3cgZXJyb3JcblxuICAgICAgICBhd2FpdCB3YWl0KGRlbGF5TXMpXG4gICAgICAgIGRlbGF5TXMgPSBNYXRoLm1pbihkZWxheU1zICogMiwgU0NIRU1BX01FVEFEQVRBX1JFVFJZX01BWF9ERUxBWV9NUylcbiAgICAgIH1cbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogUnVucyBjYWNoZWQgc2NoZW1hIG1ldGFkYXRhLlxuICAgKiBAdGVtcGxhdGUgVFxuICAgKiBAcGFyYW0ge3N0cmluZ30gY2FjaGVLZXkgLSBTY2hlbWEgY2FjaGUga2V5LlxuICAgKiBAcGFyYW0geygpID0+IFByb21pc2U8VD59IGNhbGxiYWNrIC0gQ2FjaGUgbWlzcyBjYWxsYmFjay5cbiAgICogQHJldHVybnMge1Byb21pc2U8VD59IC0gUmVzb2x2ZXMgd2l0aCB0aGUgY2FjaGVkIG1ldGFkYXRhLlxuICAgKi9cbiAgYXN5bmMgX2NhY2hlZFNjaGVtYU1ldGFkYXRhKGNhY2hlS2V5LCBjYWxsYmFjaykge1xuICAgIGlmICghdGhpcy5fc2NoZW1hQ2FjaGVFbmFibGVkKCkpIHJldHVybiBhd2FpdCB0aGlzLl93aXRoU2NoZW1hTWV0YWRhdGFEZGxSZXRyeShjYWxsYmFjaylcblxuICAgIGNvbnN0IGV4aXN0aW5nUHJvbWlzZSA9IHRoaXMuX3NjaGVtYUNhY2hlLmdldChjYWNoZUtleSlcblxuICAgIGlmIChleGlzdGluZ1Byb21pc2UpIHtcbiAgICAgIHJldHVybiAvKiogQHR5cGUge1R9ICovICh0aGlzLl9zY2hlbWFDYWNoZVJldHVyblZhbHVlKGF3YWl0IGV4aXN0aW5nUHJvbWlzZSkpXG4gICAgfVxuXG4gICAgY29uc3QgcHJvbWlzZSA9IChhc3luYyAoKSA9PiBhd2FpdCB0aGlzLl93aXRoU2NoZW1hTWV0YWRhdGFEZGxSZXRyeShjYWxsYmFjaykpKClcblxuICAgIHRoaXMuX3NjaGVtYUNhY2hlLnNldChjYWNoZUtleSwgcHJvbWlzZSlcblxuICAgIHRyeSB7XG4gICAgICByZXR1cm4gLyoqIEB0eXBlIHtUfSAqLyAodGhpcy5fc2NoZW1hQ2FjaGVSZXR1cm5WYWx1ZShhd2FpdCBwcm9taXNlKSlcbiAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgaWYgKHRoaXMuX3NjaGVtYUNhY2hlLmdldChjYWNoZUtleSkgPT09IHByb21pc2UpIHtcbiAgICAgICAgdGhpcy5fc2NoZW1hQ2FjaGUuZGVsZXRlKGNhY2hlS2V5KVxuICAgICAgfVxuXG4gICAgICB0aHJvdyBlcnJvclxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGNhY2hlZCB0YWJsZSBzY2hlbWEgbWV0YWRhdGEuXG4gICAqIEB0ZW1wbGF0ZSBUXG4gICAqIEBwYXJhbSB7c3RyaW5nfSB0YWJsZU5hbWUgLSBUYWJsZSBuYW1lLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gbWV0YWRhdGFOYW1lIC0gTWV0YWRhdGEgbmFtZS5cbiAgICogQHBhcmFtIHsoKSA9PiBQcm9taXNlPFQ+fSBjYWxsYmFjayAtIENhY2hlIG1pc3MgY2FsbGJhY2suXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPFQ+fSAtIFJlc29sdmVzIHdpdGggdGhlIGNhY2hlZCB0YWJsZSBtZXRhZGF0YS5cbiAgICovXG4gIGFzeW5jIF9jYWNoZWRUYWJsZVNjaGVtYU1ldGFkYXRhKHRhYmxlTmFtZSwgbWV0YWRhdGFOYW1lLCBjYWxsYmFjaykge1xuICAgIHJldHVybiBhd2FpdCB0aGlzLl9jYWNoZWRTY2hlbWFNZXRhZGF0YShgdGFibGU6JHt0YWJsZU5hbWV9OiR7bWV0YWRhdGFOYW1lfWAsIGNhbGxiYWNrKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgc2NoZW1hIGNhY2hlIHJldHVybiB2YWx1ZS5cbiAgICogQHBhcmFtIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gdmFsdWUgLSBDYWNoZWQgdmFsdWUuXG4gICAqIEByZXR1cm5zIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gLSBWYWx1ZSByZXR1cm5lZCB0byBjYWxsZXJzLlxuICAgKi9cbiAgX3NjaGVtYUNhY2hlUmV0dXJuVmFsdWUodmFsdWUpIHtcbiAgICBpZiAoQXJyYXkuaXNBcnJheSh2YWx1ZSkpIHJldHVybiB2YWx1ZS5zbGljZSgpXG5cbiAgICByZXR1cm4gdmFsdWVcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGdldCB0YWJsZXMuXG4gICAqIEBhYnN0cmFjdFxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxBcnJheTxpbXBvcnQoXCIuL2Jhc2UtdGFibGUuanNcIikuZGVmYXVsdD4+fSAtIFJlc29sdmVzIHdpdGggdGhlIHRhYmxlcy5cbiAgICovXG4gIGdldFRhYmxlcygpIHtcbiAgICB0aHJvdyBuZXcgRXJyb3IoYCR7dGhpcy5jb25zdHJ1Y3Rvci5uYW1lfSNnZXRUYWJsZXMgbm90IGltcGxlbWVudGVkYClcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHN0cnVjdHVyZSBzcWwuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHN0cmluZyB8IG51bGw+fSAtIFJlc29sdmVzIHdpdGggU1FMIHN0cmluZy5cbiAgICovXG4gIGFzeW5jIHN0cnVjdHVyZVNxbCgpIHtcbiAgICByZXR1cm4gbnVsbFxuICB9XG5cbiAgLyoqXG4gICAqIEV4ZWN1dGVzIGEgd2hvbGUgbXVsdGktc3RhdGVtZW50IHN0cnVjdHVyZSBTUUwgc2NyaXB0IGluIGEgc2luZ2xlIHJvdW5kLXRyaXAgd2hlblxuICAgKiB0aGUgZHJpdmVyIHN1cHBvcnRzIGl0LCBydW5uaW5nIG9uIHRoaXMgY29ubmVjdGlvbiAoc28gdGhlIGNhbGxlcidzIGZvcmVpZ24ta2V5XG4gICAqIGhhbmRsaW5nIGFwcGxpZXMpLiBSZXR1cm5zIHRydWUgaWYgaXQgcmFuIHRoZSB3aG9sZSBzY3JpcHQ7IGZhbHNlIHdoZW4gdGhlIGNhbGxlclxuICAgKiBzaG91bGQgcnVuIHRoZSBzdGF0ZW1lbnRzIGluZGl2aWR1YWxseS4gVGhlIGJhc2UgZHJpdmVyIGhhcyBubyBiYXRjaCBwYXRoLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gX3N0cnVjdHVyZVNxbCAtIEZ1bGwgbXVsdGktc3RhdGVtZW50IHN0cnVjdHVyZSBTUUwuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPGJvb2xlYW4+fSAtIFdoZXRoZXIgdGhlIHNjcmlwdCB3YXMgZXhlY3V0ZWQgYXMgb25lIGJhdGNoLlxuICAgKi9cbiAgYXN5bmMgZXhlY1N0cnVjdHVyZVNjcmlwdChfc3RydWN0dXJlU3FsKSB7XG4gICAgcmV0dXJuIGZhbHNlXG4gIH1cblxuICAvKipcbiAgICogUnVucyBnZXQgdGFibGUgYnkgbmFtZS5cbiAgICogQHBhcmFtIHtzdHJpbmd9IG5hbWUgLSBOYW1lLlxuICAgKiBAcGFyYW0ge29iamVjdH0gW2FyZ3NdIC0gT3B0aW9ucyBvYmplY3QuXG4gICAqIEBwYXJhbSB7Ym9vbGVhbn0gYXJncy50aHJvd0Vycm9yIC0gV2hldGhlciB0aHJvdyBlcnJvci5cbiAgICogQHJldHVybnMge1Byb21pc2U8aW1wb3J0KFwiLi9iYXNlLXRhYmxlLmpzXCIpLmRlZmF1bHQgfCB1bmRlZmluZWQ+fSAtIFJlc29sdmVzIHdpdGggdGhlIHRhYmxlIGJ5IG5hbWUuXG4gICAqL1xuICBhc3luYyBnZXRUYWJsZUJ5TmFtZShuYW1lLCBhcmdzKSB7XG4gICAgY29uc3QgdGFibGVzID0gYXdhaXQgdGhpcy5nZXRUYWJsZXMoKVxuICAgIGNvbnN0IHRhYmxlTmFtZXMgPSBbXVxuICAgIGxldCB0YWJsZVxuXG4gICAgZm9yIChjb25zdCBjYW5kaWRhdGUgb2YgdGFibGVzKSB7XG4gICAgICBjb25zdCBjYW5kaWRhdGVOYW1lID0gY2FuZGlkYXRlLmdldE5hbWUoKVxuXG4gICAgICBpZiAoY2FuZGlkYXRlTmFtZSA9PSBuYW1lKSB7XG4gICAgICAgIHRhYmxlID0gY2FuZGlkYXRlXG4gICAgICAgIGJyZWFrXG4gICAgICB9XG5cbiAgICAgIHRhYmxlTmFtZXMucHVzaChjYW5kaWRhdGVOYW1lKVxuICAgIH1cblxuICAgIGlmICghdGFibGUgJiYgYXJncz8udGhyb3dFcnJvciAhPT0gZmFsc2UpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcih0aGlzLl9taXNzaW5nVGFibGVFcnJvck1lc3NhZ2UobmFtZSwgdGFibGVOYW1lcykpXG4gICAgfVxuXG4gICAgcmV0dXJuIHRhYmxlXG4gIH1cblxuICAvKipcbiAgICogUnVucyBtaXNzaW5nIHRhYmxlIGVycm9yIG1lc3NhZ2UuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBuYW1lIC0gVGFibGUgbmFtZS5cbiAgICogQHBhcmFtIHtzdHJpbmdbXX0gdGFibGVOYW1lcyAtIEF2YWlsYWJsZSB0YWJsZSBuYW1lcy5cbiAgICogQHJldHVybnMge3N0cmluZ30gLSBFcnJvciBtZXNzYWdlLlxuICAgKi9cbiAgX21pc3NpbmdUYWJsZUVycm9yTWVzc2FnZShuYW1lLCB0YWJsZU5hbWVzKSB7XG4gICAgY29uc3QgZW52aXJvbm1lbnQgPSB0aGlzLmdldENvbmZpZ3VyYXRpb24oKS5nZXRFbnZpcm9ubWVudCgpXG4gICAgY29uc3QgYXJncyA9IHRoaXMuZ2V0QXJncygpXG4gICAgY29uc3QgZGF0YWJhc2VOYW1lID0gYXJncz8uZGF0YWJhc2UgfHwgYXJncz8ubmFtZSB8fCBhcmdzPy51c2VEYXRhYmFzZSB8fCBcInVua25vd25cIlxuXG4gICAgcmV0dXJuIGBDb3VsZG4ndCBmaW5kIGEgdGFibGUgYnkgdGhhdCBuYW1lIFwiJHtuYW1lfVwiIGluOiAke3RhYmxlTmFtZXMuam9pbihcIiwgXCIpfSAoZW52aXJvbm1lbnQ6ICR7ZW52aXJvbm1lbnR9LCBkYXRhYmFzZTogJHtkYXRhYmFzZU5hbWV9KWBcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGdldCB0YWJsZSBieSBuYW1lIG9yIGZhaWwuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBuYW1lIC0gTmFtZS5cbiAgICogQHJldHVybnMge1Byb21pc2U8aW1wb3J0KFwiLi9iYXNlLXRhYmxlLmpzXCIpLmRlZmF1bHQ+fSAtIFJlc29sdmVzIHdpdGggdGhlIHRhYmxlIGJ5IG5hbWUgb3IgZmFpbC5cbiAgICovXG4gIGFzeW5jIGdldFRhYmxlQnlOYW1lT3JGYWlsKG5hbWUpIHtcbiAgICByZXR1cm4gLyoqIEB0eXBlIHtpbXBvcnQoXCIuL2Jhc2UtdGFibGUuanNcIikuZGVmYXVsdH0gKi8gKGF3YWl0IHRoaXMuZ2V0VGFibGVCeU5hbWUobmFtZSwge3Rocm93RXJyb3I6IHRydWV9KSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGdldCB0eXBlLlxuICAgKiBAYWJzdHJhY3RcbiAgICogQHJldHVybnMge3N0cmluZ30gLSBUaGUgdHlwZS5cbiAgICovXG4gIGdldFR5cGUoKSB7XG4gICAgdGhyb3cgbmV3IEVycm9yKFwiJ3R5cGUnIG5vdCBpbXBsZW1lbnRlZFwiKVxuICB9XG5cbiAgLyoqXG4gICAqIFdoZXRoZXIgdGhpcyBkcml2ZXIgY2FuIGNvbWJpbmUgdW5yZWxhdGVkIGFsdGVyLXRhYmxlIG9wZXJhdGlvbnMgaW50byBhXG4gICAqIHNpbmdsZSBgQUxURVIgVEFCTEVgIHN0YXRlbWVudCAoUmFpbHMnIGBzdXBwb3J0c19idWxrX2FsdGVyYCkuXG4gICAqIEByZXR1cm5zIHtib29sZWFufSAtIFdoZXRoZXIgYnVsayBhbHRlciBpcyBzdXBwb3J0ZWQuXG4gICAqL1xuICBzdXBwb3J0c0J1bGtBbHRlcigpIHtcbiAgICByZXR1cm4gZmFsc2VcbiAgfVxuXG4gIC8qKlxuICAgKiBXaGV0aGVyIGEgYnVsayBgQUxURVIgVEFCTEVgIHN0YXRlbWVudCBjYW4gYWxzbyBjYXJyeSBgQUREIElOREVYYCBjbGF1c2VzLlxuICAgKiBPbmx5IGRyaXZlcnMgdGhhdCBzdXBwb3J0IHRoaXMga2VlcCBpbmRleCBhZGRzIGluc2lkZSB0aGUgY29tYmluZWQgYmF0Y2g7XG4gICAqIHRoZSByZXN0IGV4ZWN1dGUgZWFjaCBpbmRleCBhcyBpdHMgb3duIHN0YXRlbWVudC5cbiAgICogQHJldHVybnMge2Jvb2xlYW59IC0gV2hldGhlciBpbmRleGVzIGNhbiBiZSBhZGRlZCBpbnNpZGUgYSBidWxrIGFsdGVyLlxuICAgKi9cbiAgc3VwcG9ydHNCdWxrQWx0ZXJJbmRleGVzKCkge1xuICAgIHJldHVybiBmYWxzZVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgaW5zZXJ0LlxuICAgKiBAcGFyYW0ge0luc2VydFNxbEFyZ3NUeXBlfSBhcmdzIC0gT3B0aW9ucyBvYmplY3QuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIHdoZW4gY29tcGxldGUuXG4gICAqL1xuICBhc3luYyBpbnNlcnQoYXJncykge1xuICAgIHRoaXMuX2Fzc2VydE5vdFJlYWRPbmx5KClcbiAgICBjb25zdCBzcWwgPSB0aGlzLmluc2VydFNxbChhcmdzKVxuXG4gICAgYXdhaXQgdGhpcy5xdWVyeShzcWwpXG4gIH1cblxuICAvKipcbiAgICogTWF4aW11bSByb3dzIHBlciBgSU5TRVJUIC4uLiBWQUxVRVMgKC4uLiksICguLi4pLCAuLi5gIHN0YXRlbWVudC4gRHJpdmVyc1xuICAgKiB0aGF0IGJ1aWxkIG11bHRpLXZhbHVlIGluc2VydHMgbXVzdCBzdGF5IGJlbG93IGRhdGFiYXNlLXNwZWNpZmljIGxpbWl0c1xuICAgKiAoU1FMaXRlJ3MgYE1BWF9WQVJJQUJMRV9OVU1CRVJgLCBTUUwgU2VydmVyJ3MgMjEwMCBwYXJhbWV0ZXJzLCBQb3N0Z3JlU1FMJ3NcbiAgICogNjU1MzUgcGFyYW1ldGVycywgYW5kIHNvIG9uKS4gNTAwIHJvd3MgaXMgc2FmZWx5IHVuZGVyIGV2ZXJ5IG1ham9yIGVuZ2luZVxuICAgKiBmb3IgdGFibGVzIHdpdGggYSBtb2RlcmF0ZSBudW1iZXIgb2YgY29sdW1ucyBhbmQga2VlcHMgZ2VuZXJhdGVkIFNRTCBzbWFsbC5cbiAgICpcbiAgICogT3ZlcnJpZGUgdmlhIGBtYXhSb3dzUGVySW5zZXJ0YCBpbiB0aGUgZGF0YWJhc2UgY29uZmlndXJhdGlvbi5cbiAgICogQHJldHVybnMge251bWJlcn0gLSBNYXhpbXVtIHJvd3MgcGVyIGluc2VydCBzdGF0ZW1lbnQuXG4gICAqL1xuICBtYXhSb3dzUGVySW5zZXJ0KCkge1xuICAgIHJldHVybiBvcHRpb25hbFBvc2l0aXZlSW50ZWdlcih0aGlzLmdldEFyZ3MoKS5tYXhSb3dzUGVySW5zZXJ0LCBcIm1heFJvd3NQZXJJbnNlcnRcIikgPz8gNTAwXG4gIH1cblxuICAvKipcbiAgICogTWF4aW11bSBzZXJpYWxpemVkIFNRTCBzaXplLCBpbiBieXRlcywgZm9yIGEgc2luZ2xlIGBJTlNFUlQgLi4uIFZBTFVFU2BcbiAgICogc3RhdGVtZW50LiBMYXJnZSB0ZXh0L0pTT04gcGF5bG9hZHMgY2FuIHB1c2ggYSBtb2Rlc3Qgcm93IGNvdW50IHdlbGwgYmV5b25kXG4gICAqIGRhdGFiYXNlIHdpcmUvcHJvdG9jb2wgbGltaXRzLCBzbyBjaHVua2luZyBhbHNvIHN0b3BzIHdoZW4gdGhlIG5leHQgcm93XG4gICAqIHdvdWxkIHB1c2ggdGhlIGdlbmVyYXRlZCBzdHJpbmcgb3ZlciB0aGlzIHRocmVzaG9sZC5cbiAgICpcbiAgICogT3ZlcnJpZGUgdmlhIGBtYXhJbnNlcnRTcWxCeXRlc2AgaW4gdGhlIGRhdGFiYXNlIGNvbmZpZ3VyYXRpb24uXG4gICAqIEByZXR1cm5zIHtudW1iZXJ9IC0gTWF4aW11bSBieXRlcyBwZXIgaW5zZXJ0IHN0YXRlbWVudC5cbiAgICovXG4gIG1heEluc2VydFNxbEJ5dGVzKCkge1xuICAgIHJldHVybiBvcHRpb25hbFBvc2l0aXZlSW50ZWdlcih0aGlzLmdldEFyZ3MoKS5tYXhJbnNlcnRTcWxCeXRlcywgXCJtYXhJbnNlcnRTcWxCeXRlc1wiKSA/PyAxMDQ4NTc2XG4gIH1cblxuICAvKipcbiAgICogTWF4aW11bSB2YWx1ZXMgaW4gYSBzaW5nbGUgYElOICguLi4pYCBjb2hvcnQgdXNlZCBieSBwcmVsb2FkcywgYXNzb2NpYXRpb25cbiAgICogY291bnRzLCBhbmQgcXVlcnlEYXRhIGFnZ3JlZ2F0ZXMuIFRoZSBkZWZhdWx0IHN0YXlzIHVuZGVyIFNRTGl0ZSdzIGRlZmF1bHRcbiAgICogYE1BWF9WQVJJQUJMRV9OVU1CRVJgIGNvbXBpbGUtdGltZSBsaW1pdC5cbiAgICpcbiAgICogT3ZlcnJpZGUgdmlhIGBtYXhJbkNsYXVzZVZhbHVlc2AgaW4gdGhlIGRhdGFiYXNlIGNvbmZpZ3VyYXRpb24uXG4gICAqIEByZXR1cm5zIHtudW1iZXJ9IC0gTWF4aW11bSB2YWx1ZXMgcGVyIElOIGNsYXVzZSBjb2hvcnQuXG4gICAqL1xuICBtYXhJbkNsYXVzZVZhbHVlcygpIHtcbiAgICByZXR1cm4gb3B0aW9uYWxQb3NpdGl2ZUludGVnZXIodGhpcy5nZXRBcmdzKCkubWF4SW5DbGF1c2VWYWx1ZXMsIFwibWF4SW5DbGF1c2VWYWx1ZXNcIikgPz8gOTk5XG4gIH1cblxuICAvKipcbiAgICogTWF4aW11bSBzZXJpYWxpemVkIFNRTCBzaXplLCBpbiBieXRlcywgZm9yIGEgc2luZ2xlIGNvaG9ydCBxdWVyeSB1c2VkIGJ5XG4gICAqIHByZWxvYWRzLCBhc3NvY2lhdGlvbiBjb3VudHMsIGFuZCBxdWVyeURhdGEgYWdncmVnYXRlcy4gQ29ob3J0IGNodW5raW5nXG4gICAqIHN0b3BzIHdoZW4gdGhlIG5leHQgdmFsdWUgd291bGQgcHVzaCB0aGUgZ2VuZXJhdGVkIHN0cmluZyBvdmVyIHRoaXMgdGhyZXNob2xkLlxuICAgKlxuICAgKiBPdmVycmlkZSB2aWEgYG1heFF1ZXJ5U3FsQnl0ZXNgIGluIHRoZSBkYXRhYmFzZSBjb25maWd1cmF0aW9uLlxuICAgKiBAcmV0dXJucyB7bnVtYmVyfSAtIE1heGltdW0gYnl0ZXMgcGVyIGNvaG9ydCBxdWVyeS5cbiAgICovXG4gIG1heFF1ZXJ5U3FsQnl0ZXMoKSB7XG4gICAgcmV0dXJuIG9wdGlvbmFsUG9zaXRpdmVJbnRlZ2VyKHRoaXMuZ2V0QXJncygpLm1heFF1ZXJ5U3FsQnl0ZXMsIFwibWF4UXVlcnlTcWxCeXRlc1wiKSA/PyAxMDQ4NTc2XG4gIH1cblxuICAvKipcbiAgICogU3BsaXRzIGB2YWx1ZXNgIGludG8gY29ob3J0IGNodW5rcyB0aGF0IHN0YXkgd2l0aGluIGJvdGggYG1heENvdW50YCBhbmRcbiAgICogYG1heEJ5dGVzYCB3aGlsZSBwcmVzZXJ2aW5nIG9yZGVyLlxuICAgKlxuICAgKiBBIGNodW5rIGFsd2F5cyBjb250YWlucyBhdCBsZWFzdCBvbmUgdmFsdWUsIGV2ZW4gaWYgdGhhdCBzaW5nbGUgdmFsdWUgZXhjZWVkc1xuICAgKiB0aGUgYnl0ZSBsaW1pdCwgc28gcHJvZ3Jlc3MgaXMgZ3VhcmFudGVlZC5cbiAgICogQHRlbXBsYXRlIFRcbiAgICogQHBhcmFtIHtBcnJheTxUPn0gdmFsdWVzIC0gVmFsdWVzIHRvIGNodW5rLlxuICAgKiBAcGFyYW0geyh2YWx1ZXM6IEFycmF5PFQ+KSA9PiBzdHJpbmd9IGJ1aWxkU3FsIC0gRnVuY3Rpb24gdGhhdCBidWlsZHMgdGhlIGZ1bGwgU1FMIGZvciBhIGNhbmRpZGF0ZSBjaHVuay5cbiAgICogQHBhcmFtIHt7bWF4Q291bnQ/OiBudW1iZXIsIG1heEJ5dGVzPzogbnVtYmVyfX0gW29wdGlvbnNdIC0gQ2h1bmtpbmcgYm91bmRzLlxuICAgKiBAcmV0dXJucyB7QXJyYXk8QXJyYXk8VD4+fSAtIFZhbHVlIGNvaG9ydHMuXG4gICAqL1xuICBjaHVua1ZhbHVlcyh2YWx1ZXMsIGJ1aWxkU3FsLCB7bWF4Q291bnQgPSB0aGlzLm1heEluQ2xhdXNlVmFsdWVzKCksIG1heEJ5dGVzID0gdGhpcy5tYXhRdWVyeVNxbEJ5dGVzKCl9ID0ge30pIHtcbiAgICBpZiAodmFsdWVzLmxlbmd0aCA9PT0gMCkgcmV0dXJuIFtdXG5cbiAgICAvKipcbiAgICAgKiBDaHVua3MuXG4gICAgICogQHR5cGUge0FycmF5PEFycmF5PFQ+Pn0gKi9cbiAgICBjb25zdCBjaHVua3MgPSBbXVxuICAgIC8qKlxuICAgICAqIEN1cnJlbnQgY2h1bmsuXG4gICAgICogQHR5cGUge0FycmF5PFQ+fSAqL1xuICAgIGxldCBjdXJyZW50Q2h1bmsgPSBbXVxuXG4gICAgZm9yIChjb25zdCB2YWx1ZSBvZiB2YWx1ZXMpIHtcbiAgICAgIGNvbnN0IGNhbmRpZGF0ZSA9IFsuLi5jdXJyZW50Q2h1bmssIHZhbHVlXVxuICAgICAgY29uc3QgY2FuZGlkYXRlQnl0ZXMgPSB1dGY4Qnl0ZUxlbmd0aChidWlsZFNxbChjYW5kaWRhdGUpKVxuXG4gICAgICBpZiAoY3VycmVudENodW5rLmxlbmd0aCA+IDAgJiYgKGNhbmRpZGF0ZS5sZW5ndGggPiBtYXhDb3VudCB8fCBjYW5kaWRhdGVCeXRlcyA+IG1heEJ5dGVzKSkge1xuICAgICAgICBjaHVua3MucHVzaChjdXJyZW50Q2h1bmspXG4gICAgICAgIGN1cnJlbnRDaHVuayA9IFt2YWx1ZV1cbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIGN1cnJlbnRDaHVuayA9IGNhbmRpZGF0ZVxuICAgICAgfVxuICAgIH1cblxuICAgIGlmIChjdXJyZW50Q2h1bmsubGVuZ3RoID4gMCkge1xuICAgICAgY2h1bmtzLnB1c2goY3VycmVudENodW5rKVxuICAgIH1cblxuICAgIHJldHVybiBjaHVua3NcbiAgfVxuXG4gIC8qKlxuICAgKiBTcGxpdHMgYHJvd3NgIGludG8gY2h1bmtzIHRoYXQgc3RheSB3aXRoaW4gYm90aCB7QGxpbmsgbWF4Um93c1Blckluc2VydH1cbiAgICogYW5kIHtAbGluayBtYXhJbnNlcnRTcWxCeXRlc30gd2hpbGUgcHJlc2VydmluZyBvcmRlci5cbiAgICpcbiAgICogQnl0ZSBhY2NvdW50aW5nIGlzIGluY3JlbWVudGFsOiBgYnVpbGRTcWxgIGlzIGNhbGxlZCBvbmNlIHdpdGggYFtdYCB0b1xuICAgKiBtZWFzdXJlIHRoZSBzdGF0ZW1lbnQgcHJlZml4IGFuZCBvbmNlIHBlciByb3cgd2l0aCBgW3Jvd11gIHRvIG1lYXN1cmUgdGhlXG4gICAqIHJvdydzIHZhbHVlcyB0dXBsZS4gVGhpcyBrZWVwcyBjaHVua2luZyBsaW5lYXIgaW4gdGhlIG51bWJlciBvZiByb3dzXG4gICAqIGluc3RlYWQgb2YgcmVidWlsZGluZyB0aGUgZnVsbCBtdWx0aS1yb3cgU1FMIGZvciBldmVyeSBjYW5kaWRhdGUuXG4gICAqXG4gICAqIEEgY2h1bmsgYWx3YXlzIGNvbnRhaW5zIGF0IGxlYXN0IG9uZSByb3csIGV2ZW4gaWYgdGhhdCBzaW5nbGUgcm93IGV4Y2VlZHNcbiAgICogdGhlIGJ5dGUgbGltaXQsIHNvIHByb2dyZXNzIGlzIGd1YXJhbnRlZWQuXG4gICAqIEBwYXJhbSB7QXJyYXk8QXJyYXk8UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+Pn0gcm93cyAtIFJvd3MgdG8gaW5zZXJ0LlxuICAgKiBAcGFyYW0geyhyb3dzOiBBcnJheTxBcnJheTxSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj4+KSA9PiBzdHJpbmd9IGJ1aWxkU3FsIC0gRnVuY3Rpb24gdGhhdCBidWlsZHMgdGhlIGZ1bGwgU1FMIGZvciBhIGNhbmRpZGF0ZSBjaHVuazsgY2FsbGVkIHdpdGggYFtdYCB0byBtZWFzdXJlIHRoZSBzdGF0ZW1lbnQgcHJlZml4IGFuZCB3aXRoIGBbcm93XWAgdG8gbWVhc3VyZSBlYWNoIHJvdydzIHZhbHVlcyB0dXBsZS5cbiAgICogQHJldHVybnMge0FycmF5PEFycmF5PEFycmF5PFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pj4+fSAtIFJvdyBjaHVua3MuXG4gICAqL1xuICBfaW5zZXJ0TXVsdGlwbGVDaHVua3Mocm93cywgYnVpbGRTcWwpIHtcbiAgICBjb25zdCBjaHVua3MgPSBbXVxuICAgIGNvbnN0IG1heFJvd3MgPSB0aGlzLm1heFJvd3NQZXJJbnNlcnQoKVxuICAgIGNvbnN0IG1heEJ5dGVzID0gdGhpcy5tYXhJbnNlcnRTcWxCeXRlcygpXG4gICAgY29uc3QgZW1wdHlTcWwgPSBidWlsZFNxbChbXSlcbiAgICBjb25zdCBwcmVmaXggPSBgJHtlbXB0eVNxbH0gVkFMVUVTIGBcbiAgICBjb25zdCBiYXNlQnl0ZUxlbmd0aCA9IHV0ZjhCeXRlTGVuZ3RoKHByZWZpeClcblxuICAgIC8qKlxuICAgICAqIEN1cnJlbnQgY2h1bmsuXG4gICAgICogQHR5cGUge0FycmF5PEFycmF5PFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pj59ICovXG4gICAgbGV0IGN1cnJlbnRDaHVuayA9IFtdXG4gICAgbGV0IGN1cnJlbnRCeXRlcyA9IDBcblxuICAgIGZvciAoY29uc3Qgcm93IG9mIHJvd3MpIHtcbiAgICAgIGNvbnN0IHNpbmdsZVJvd1NxbCA9IGJ1aWxkU3FsKFtyb3ddKVxuICAgICAgY29uc3Qgcm93VmFsdWVzU3FsID0gc2luZ2xlUm93U3FsLnNsaWNlKHByZWZpeC5sZW5ndGgpXG4gICAgICBjb25zdCByb3dWYWx1ZXNTcWxCeXRlcyA9IHV0ZjhCeXRlTGVuZ3RoKHJvd1ZhbHVlc1NxbClcblxuICAgICAgaWYgKGN1cnJlbnRDaHVuay5sZW5ndGggPiAwKSB7XG4gICAgICAgIGNvbnN0IGNhbmRpZGF0ZVJvd3MgPSBjdXJyZW50Q2h1bmsubGVuZ3RoICsgMVxuICAgICAgICBjb25zdCBjYW5kaWRhdGVCeXRlcyA9IGN1cnJlbnRCeXRlcyArIDIgKyByb3dWYWx1ZXNTcWxCeXRlcyAvLyBcIiwgXCIgc2VwYXJhdG9yXG5cbiAgICAgICAgaWYgKGNhbmRpZGF0ZVJvd3MgPiBtYXhSb3dzIHx8IGNhbmRpZGF0ZUJ5dGVzID4gbWF4Qnl0ZXMpIHtcbiAgICAgICAgICBjaHVua3MucHVzaChjdXJyZW50Q2h1bmspXG4gICAgICAgICAgY3VycmVudENodW5rID0gW11cbiAgICAgICAgICBjdXJyZW50Qnl0ZXMgPSAwXG4gICAgICAgIH1cbiAgICAgIH1cblxuICAgICAgaWYgKGN1cnJlbnRDaHVuay5sZW5ndGggPT09IDApIHtcbiAgICAgICAgY3VycmVudEJ5dGVzID0gYmFzZUJ5dGVMZW5ndGggKyByb3dWYWx1ZXNTcWxCeXRlc1xuICAgICAgfSBlbHNlIHtcbiAgICAgICAgY3VycmVudEJ5dGVzICs9IDIgKyByb3dWYWx1ZXNTcWxCeXRlc1xuICAgICAgfVxuXG4gICAgICBjdXJyZW50Q2h1bmsucHVzaChyb3cpXG4gICAgfVxuXG4gICAgaWYgKGN1cnJlbnRDaHVuay5sZW5ndGggPiAwKSB7XG4gICAgICBjaHVua3MucHVzaChjdXJyZW50Q2h1bmspXG4gICAgfVxuXG4gICAgcmV0dXJuIGNodW5rc1xuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgaW5zZXJ0IG11bHRpcGxlLlxuICAgKlxuICAgKiBMYXJnZSByb3cgc2V0cyBhcmUgc3BsaXQgaW50byBtdWx0aXBsZSBzdGF0ZW1lbnRzIHRoYXQgZWFjaCBzdGF5IHdpdGhpblxuICAgKiB7QGxpbmsgbWF4Um93c1Blckluc2VydH0gcm93cyBhbmQge0BsaW5rIG1heEluc2VydFNxbEJ5dGVzfSBzZXJpYWxpemVkXG4gICAqIGJ5dGVzIHNvIHRoZSBnZW5lcmF0ZWQgU1FMIHN0YXlzIHdpdGhpbiBkYXRhYmFzZSBwYXJhbWV0ZXIgYW5kIHdpcmUgbGltaXRzLlxuICAgKiBXaGVuIGNhbGxlZCBvdXRzaWRlIGEgdHJhbnNhY3Rpb24gZWFjaCBjaHVuayBjb21taXRzIGluZGVwZW5kZW50bHk7IGNhbGxlcnNcbiAgICogdGhhdCBuZWVkIGFsbC1vci1ub3RoaW5nIHNlbWFudGljcyBzaG91bGQgd3JhcCB0aGUgY2FsbCBpbiB7QGxpbmsgdHJhbnNhY3Rpb259LlxuICAgKiBAcGFyYW0ge3N0cmluZ30gdGFibGVOYW1lIC0gVGFibGUgbmFtZS5cbiAgICogQHBhcmFtIHtBcnJheTxzdHJpbmc+fSBjb2x1bW5zIC0gQ29sdW1uIG5hbWVzLlxuICAgKiBAcGFyYW0ge0FycmF5PEFycmF5PFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pj59IHJvd3MgLSBSb3dzIHRvIGluc2VydC5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgd2hlbiBjb21wbGV0ZS5cbiAgICovXG4gIGFzeW5jIGluc2VydE11bHRpcGxlKHRhYmxlTmFtZSwgY29sdW1ucywgcm93cykge1xuICAgIHRoaXMuX2Fzc2VydE5vdFJlYWRPbmx5KClcblxuICAgIGNvbnN0IGNodW5rcyA9IHRoaXMuX2luc2VydE11bHRpcGxlQ2h1bmtzKHJvd3MsIChjaHVua1Jvd3MpID0+IHRoaXMuaW5zZXJ0U3FsKHtjb2x1bW5zLCB0YWJsZU5hbWUsIHJvd3M6IGNodW5rUm93c30pKVxuXG4gICAgZm9yIChjb25zdCBjaHVuayBvZiBjaHVua3MpIHtcbiAgICAgIGNvbnN0IHNxbCA9IHRoaXMuaW5zZXJ0U3FsKHtjb2x1bW5zLCB0YWJsZU5hbWUsIHJvd3M6IGNodW5rfSlcblxuICAgICAgYXdhaXQgdGhpcy5xdWVyeShzcWwpXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgaW5zZXJ0IHNxbC5cbiAgICogQGFic3RyYWN0XG4gICAqIEBwYXJhbSB7SW5zZXJ0U3FsQXJnc1R5cGV9IGFyZ3MgLSBPcHRpb25zIG9iamVjdC5cbiAgICogQHJldHVybnMge3N0cmluZ30gLSBTUUwgc3RyaW5nLlxuICAgKi9cbiAgaW5zZXJ0U3FsKGFyZ3MpIHsgLy8gZXNsaW50LWRpc2FibGUtbGluZSBuby11bnVzZWQtdmFyc1xuICAgIHRocm93IG5ldyBFcnJvcihcIidpbnNlcnRTcWwnIG5vdCBpbXBsZW1lbnRlZFwiKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgdXBzZXJ0LlxuICAgKiBAcGFyYW0ge1Vwc2VydFNxbEFyZ3NUeXBlfSBhcmdzIC0gT3B0aW9ucyBvYmplY3QuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIHdoZW4gY29tcGxldGUuXG4gICAqL1xuICBhc3luYyB1cHNlcnQoYXJncykge1xuICAgIHRoaXMuX2Fzc2VydE5vdFJlYWRPbmx5KClcbiAgICBjb25zdCBzcWwgPSB0aGlzLnVwc2VydFNxbChhcmdzKVxuXG4gICAgYXdhaXQgdGhpcy5xdWVyeShzcWwpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBsYXN0IGluc2VydCBpZC5cbiAgICogQGFic3RyYWN0XG4gICAqIEBwYXJhbSB7UXVlcnlPcHRpb25zfSBbX29wdGlvbnNdIC0gUXVlcnkgb3duZXJzaGlwIG9wdGlvbnMuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPG51bWJlcj59IC0gUmVzb2x2ZXMgd2l0aCB0aGUgbGFzdCBpbnNlcnQgaWQuXG4gICAqL1xuICBsYXN0SW5zZXJ0SUQoX29wdGlvbnMgPSB7fSkge1xuICAgIHRocm93IG5ldyBFcnJvcihgJHt0aGlzLmNvbnN0cnVjdG9yLm5hbWV9I2xhc3RJbnNlcnRJRCBub3QgaW1wbGVtZW50ZWRgKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgY29udmVydCB2YWx1ZS5cbiAgICogQHBhcmFtIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gdmFsdWUgLSBWYWx1ZSB0byB1c2UuXG4gICAqIEByZXR1cm5zIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gLSBUaGUgY29udmVydCB2YWx1ZS5cbiAgICovXG4gIF9jb252ZXJ0VmFsdWUodmFsdWUpIHtcbiAgICBpZiAodHlwZW9mIHZhbHVlID09PSBcImJvb2xlYW5cIikge1xuICAgICAgcmV0dXJuIHZhbHVlID8gMSA6IDBcbiAgICB9XG5cbiAgICAvLyBpc0RhdGUgaW5zdGVhZCBvZiBpbnN0YW5jZW9mOiBhIERhdGUgY3JlYXRlZCBpbiBhbm90aGVyIHJlYWxtIChlLmcuIHRoZSBjb25zb2xlIFJFUEwpIHdvdWxkXG4gICAgLy8gZmFpbCBpbnN0YW5jZW9mLCBza2lwIHRoaXMgY29udmVyc2lvbiwgYW5kIHNlcmlhbGl6ZSBhcyBhbiBlbXB0eSBTUUwgdmFsdWUgZG93bnN0cmVhbS5cbiAgICBpZiAoaXNEYXRlKHZhbHVlKSkge1xuICAgICAgcmV0dXJuIGZvcm1hdERhdGVGb3JEYXRhYmFzZSh2YWx1ZSwge2RhdGFiYXNlVHlwZTogdGhpcy5nZXRUeXBlKCl9KVxuICAgIH1cblxuICAgIC8vIEpTT04tZW5jb2RlIHBsYWluIG9iamVjdHMvYXJyYXlzIHNvIHRoZXkgbGFuZCBpbiBKU09OL3RleHQgY29sdW1ucyBhcyB2YWxpZFxuICAgIC8vIEpTT04uIFdpdGhvdXQgdGhpcywgZHJpdmVycyBsaWtlIG15c3FsJ3MgZXNjYXBlKCkgdHVybiBhbiBvYmplY3QgaW50b1xuICAgIC8vIGBrZXlgID0gdmFsdWUgYXNzaWdubWVudCBwYWlycyAoaXRzIGBTRVQgP2AgZm9ybSksIHByb2R1Y2luZyBpbnZhbGlkIFNRTCBpblxuICAgIC8vIGEgdmFsdWUgcG9zaXRpb24uIE9ubHkgUExBSU4gb2JqZWN0cyBhbmQgYXJyYXlzIGFyZSBlbmNvZGVkIOKAlCBjbGFzc1xuICAgIC8vIGluc3RhbmNlcyAoZS5nLiBtb2RlbCByZWNvcmRzLCB3aGljaCBhcmUgY2lyY3VsYXIgdmlhIF9jaGFuZ2VzKSBhbmQgQnVmZmVyc1xuICAgIC8vIHBhc3MgdGhyb3VnaCB1bnRvdWNoZWQsIHNpbmNlIEpTT04uc3RyaW5naWZ5IG9uIGEgcmVjb3JkIHRocm93cyBvbiBpdHNcbiAgICAvLyBjaXJjdWxhciBzdHJ1Y3R1cmUgYW5kIGEgcmVjb3JkIGlzIG5ldmVyIGEgdmFsaWQgY29sdW1uIHZhbHVlIHRvIHNlcmlhbGl6ZS5cbiAgICBpZiAodGhpcy5faXNKc29uRW5jb2RhYmxlVmFsdWUodmFsdWUpKSB7XG4gICAgICByZXR1cm4gSlNPTi5zdHJpbmdpZnkodmFsdWUpXG4gICAgfVxuXG4gICAgcmV0dXJuIHZhbHVlXG4gIH1cblxuICAvKipcbiAgICogV2hldGhlciBhIHZhbHVlIGlzIGEgcGxhaW4gb2JqZWN0IG9yIGFycmF5IHRoYXQgc2hvdWxkIGJlIEpTT04tZW5jb2RlZCBmb3IgYVxuICAgKiBKU09OL3RleHQgY29sdW1uLiBFeGNsdWRlcyBCdWZmZXJzIGFuZCBjbGFzcyBpbnN0YW5jZXMgKGUuZy4gbW9kZWwgcmVjb3JkcykuXG4gICAqIEBwYXJhbSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59IHZhbHVlIC0gVmFsdWUgdG8gdGVzdC5cbiAgICogQHJldHVybnMge2Jvb2xlYW59IC0gV2hldGhlciB0byBKU09OLWVuY29kZSB0aGUgdmFsdWUuXG4gICAqL1xuICBfaXNKc29uRW5jb2RhYmxlVmFsdWUodmFsdWUpIHtcbiAgICBpZiAodmFsdWUgPT09IG51bGwgfHwgdHlwZW9mIHZhbHVlICE9PSBcIm9iamVjdFwiKSByZXR1cm4gZmFsc2VcbiAgICBpZiAodHlwZW9mIEJ1ZmZlciAhPT0gXCJ1bmRlZmluZWRcIiAmJiBCdWZmZXIuaXNCdWZmZXIodmFsdWUpKSByZXR1cm4gZmFsc2VcbiAgICBpZiAoQXJyYXkuaXNBcnJheSh2YWx1ZSkpIHJldHVybiB0cnVlXG5cbiAgICBjb25zdCBwcm90b3R5cGUgPSBPYmplY3QuZ2V0UHJvdG90eXBlT2YodmFsdWUpXG5cbiAgICByZXR1cm4gcHJvdG90eXBlID09PSBPYmplY3QucHJvdG90eXBlIHx8IHByb3RvdHlwZSA9PT0gbnVsbFxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgb3B0aW9ucy5cbiAgICogQGFic3RyYWN0XG4gICAqIEByZXR1cm5zIHtpbXBvcnQoXCIuLi9xdWVyeS1wYXJzZXIvb3B0aW9ucy5qc1wiKS5kZWZhdWx0fSAtIFRoZSBvcHRpb25zIG9wdGlvbnMuXG4gICAqL1xuICBvcHRpb25zKCkge1xuICAgIHRocm93IG5ldyBFcnJvcihcIidvcHRpb25zJyBub3QgaW1wbGVtZW50ZWQuXCIpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBxdW90ZS5cbiAgICogQHBhcmFtIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gdmFsdWUgLSBWYWx1ZSB0byB1c2UuXG4gICAqIEByZXR1cm5zIHtudW1iZXIgfCBzdHJpbmd9IC0gVGhlIHF1b3RlLlxuICAgKi9cbiAgcXVvdGUodmFsdWUpIHtcbiAgICBpZiAodHlwZW9mIHZhbHVlID09IFwibnVtYmVyXCIpIHJldHVybiB2YWx1ZVxuXG4gICAgY29uc3QgZXNjYXBlZFZhbHVlID0gdGhpcy5lc2NhcGUodmFsdWUpXG4gICAgY29uc3QgcmVzdWx0ID0gYFwiJHtlc2NhcGVkVmFsdWV9XCJgXG5cbiAgICByZXR1cm4gcmVzdWx0XG4gIH1cblxuICAvKipcbiAgICogUnVucyBxdW90ZSBjb2x1bW4uXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBjb2x1bW5OYW1lIC0gQ29sdW1uIG5hbWUuXG4gICAqIEByZXR1cm5zIHtzdHJpbmd9IC0gVGhlIHF1b3RlIGNvbHVtbi5cbiAgICovXG4gIHF1b3RlQ29sdW1uKGNvbHVtbk5hbWUpIHtcbiAgICByZXR1cm4gdGhpcy5vcHRpb25zKCkucXVvdGVDb2x1bW5OYW1lKGNvbHVtbk5hbWUpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBxdW90ZSBpbmRleC5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGNvbHVtbk5hbWUgLSBDb2x1bW4gbmFtZS5cbiAgICogQHJldHVybnMge3N0cmluZ30gLSBUaGUgcXVvdGUgaW5kZXguXG4gICAqL1xuICBxdW90ZUluZGV4KGNvbHVtbk5hbWUpIHtcbiAgICByZXR1cm4gdGhpcy5vcHRpb25zKCkucXVvdGVJbmRleE5hbWUoY29sdW1uTmFtZSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHF1b3RlIHRhYmxlLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gdGFibGVOYW1lIC0gVGFibGUgbmFtZS5cbiAgICogQHJldHVybnMge3N0cmluZ30gLSBUaGUgcXVvdGUgdGFibGUuXG4gICAqL1xuICBxdW90ZVRhYmxlKHRhYmxlTmFtZSkge1xuICAgIHJldHVybiB0aGlzLm9wdGlvbnMoKS5xdW90ZVRhYmxlTmFtZSh0YWJsZU5hbWUpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBuZXcgcXVlcnkuXG4gICAqIEByZXR1cm5zIHtRdWVyeX0gLSBUaGUgbmV3IHF1ZXJ5LlxuICAgKi9cbiAgbmV3UXVlcnkoKSB7XG4gICAgY29uc3QgaGFuZGxlciA9IG5ldyBIYW5kbGVyKClcblxuICAgIHJldHVybiBuZXcgUXVlcnkoe1xuICAgICAgZHJpdmVyOiB0aGlzLFxuICAgICAgaGFuZGxlclxuICAgIH0pXG4gIH1cblxuICAvKipcbiAgICogUnVucyBzZWxlY3QuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSB0YWJsZU5hbWUgLSBUYWJsZSBuYW1lLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxRdWVyeVJlc3VsdFR5cGU+fSAtIFJlc29sdmVzIHdpdGggdGhlIHNlbGVjdC5cbiAgICovXG4gIGFzeW5jIHNlbGVjdCh0YWJsZU5hbWUpIHtcbiAgICBjb25zdCBxdWVyeSA9IHRoaXMubmV3UXVlcnkoKVxuXG4gICAgY29uc3Qgc3FsID0gcXVlcnlcbiAgICAgIC5mcm9tKHRhYmxlTmFtZSlcbiAgICAgIC50b1NxbCgpXG5cbiAgICByZXR1cm4gYXdhaXQgdGhpcy5xdWVyeShzcWwpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBzZXQgaWQgc2VxLlxuICAgKiBAcGFyYW0ge251bWJlciB8IHVuZGVmaW5lZH0gbmV3SWRTZXEgLSBOZXcgaWQgc2VxLlxuICAgKiBAcmV0dXJucyB7dm9pZH0gLSBObyByZXR1cm4gdmFsdWUuXG4gICAqL1xuICBzZXRJZFNlcShuZXdJZFNlcSkge1xuICAgIHRoaXMuaWRTZXEgPSBuZXdJZFNlcVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgc2hvdWxkIHNldCBhdXRvIGluY3JlbWVudCB3aGVuIHByaW1hcnkga2V5LlxuICAgKiBAYWJzdHJhY3RcbiAgICogQHJldHVybnMge2Jvb2xlYW59IC0gV2hldGhlciBzZXQgYXV0byBpbmNyZW1lbnQgd2hlbiBwcmltYXJ5IGtleS5cbiAgICovXG4gIHNob3VsZFNldEF1dG9JbmNyZW1lbnRXaGVuUHJpbWFyeUtleSgpIHtcbiAgICB0aHJvdyBuZXcgRXJyb3IoYCdzaG91bGRTZXRBdXRvSW5jcmVtZW50V2hlblByaW1hcnlLZXknIG5vdCBpbXBsZW1lbnRlZGApXG4gIH1cblxuICAvKipcbiAgICogUnVucyBzdXBwb3J0cyBkZWZhdWx0IHByaW1hcnkga2V5IHV1aWQuXG4gICAqIEByZXR1cm5zIHtib29sZWFufSAtIFdoZXRoZXIgc3VwcG9ydHMgZGVmYXVsdCBwcmltYXJ5IGtleSB1dWlkLlxuICAgKi9cbiAgc3VwcG9ydHNEZWZhdWx0UHJpbWFyeUtleVVVSUQoKSB7IHJldHVybiBmYWxzZSB9XG5cbiAgLyoqXG4gICAqIEV4ZWN1dGVzIGFuIGluc2VydCB0aGF0IGNhcnJpZXMgYW4gZXhwbGljaXQgcHJpbWFyeS1rZXkgdmFsdWVcbiAgICogKGNsaWVudC1nZW5lcmF0ZWQgb2ZmbGluZS1zeW5jIGlkcykuIERyaXZlcnMgd2hvc2UgYXV0by1pbmNyZW1lbnQgY29sdW1uc1xuICAgKiByZWplY3QgZXhwbGljaXQgdmFsdWVzIChNU1NRTCBJREVOVElUWSkgb3ZlcnJpZGUgdGhpcyB0byBydW4gdGhlIGluc2VydFxuICAgKiB3aXRoIGlkZW50aXR5IGluc2VydCBlbmFibGVkIGluIGEgc2luZ2xlIHJlcXVlc3QuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gT3B0aW9ucyBvYmplY3QuXG4gICAqIEBwYXJhbSB7UXVlcnlPcHRpb25zfSBhcmdzLm9wdGlvbnMgLSBRdWVyeSBvcHRpb25zIGZvciB0aGUgc3RhbmRhcmQgcXVlcnkgcGF0aC5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGFyZ3Muc3FsIC0gR2VuZXJhdGVkIGluc2VydCBTUUwuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBhcmdzLnRhYmxlTmFtZSAtIFRhYmxlIGJlaW5nIGluc2VydGVkIGludG8uXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPFF1ZXJ5UmVzdWx0VHlwZT59IC0gSW5zZXJ0IHJlc3VsdC5cbiAgICovXG4gIGFzeW5jIGluc2VydFdpdGhFeHBsaWNpdFByaW1hcnlLZXkoe29wdGlvbnMsIHNxbCwgdGFibGVOYW1lfSkge1xuICAgIHZvaWQgdGFibGVOYW1lXG5cbiAgICByZXR1cm4gYXdhaXQgdGhpcy5xdWVyeShzcWwsIG9wdGlvbnMpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBzdXBwb3J0cyBpbnNlcnQgaW50byByZXR1cm5pbmcuXG4gICAqIEBhYnN0cmFjdFxuICAgKiBAcmV0dXJucyB7Ym9vbGVhbn0gLSBXaGV0aGVyIHN1cHBvcnRzIGluc2VydCBpbnRvIHJldHVybmluZy5cbiAgICovXG4gIHN1cHBvcnRzSW5zZXJ0SW50b1JldHVybmluZygpIHsgcmV0dXJuIGZhbHNlIH1cblxuICAvKipcbiAgICogV2hldGhlciBhIHNpbmdsZSBjb25uZWN0aW9uIGNhbiByZWZlcmVuY2UgdGFibGVzIGluIGFub3RoZXIgZGF0YWJhc2Ugb24gdGhlIHNhbWUgc2VydmVyIHZpYSBhXG4gICAqIHR3by1wYXJ0IGBkYXRhYmFzZWAuYHRhYmxlYCBpZGVudGlmaWVyLiBXaGVuIHRydWUsIGEgcXVlcnkgc3Bhbm5pbmcgc2V2ZXJhbCBkYXRhYmFzZXMgb24gdGhpc1xuICAgKiBzZXJ2ZXIgY2FuIGJlIGV4cHJlc3NlZCBhcyBvbmUgc3RhdGVtZW50IChhIGNyb3NzLXRlbmFudCBgVU5JT04gQUxMYCk7IHdoZW4gZmFsc2UsIGVhY2ggZGF0YWJhc2VcbiAgICogaXMgcXVlcmllZCBvbiBpdHMgb3duIGNvbm5lY3Rpb24gYW5kIHRoZSByZXN1bHRzIG1lcmdlZCBpbiB0aGUgY2FsbGVyLiBPbmx5IE15U1FML01hcmlhREIgcmV0dXJuXG4gICAqIHRydWU6IFBvc3RncmVTUUwgKG9uZSBkYXRhYmFzZSBwZXIgY29ubmVjdGlvbikgYW5kIFNRTGl0ZSAob25lIGF0dGFjaGVkIGZpbGUgcGVyIGNvbm5lY3Rpb24pXG4gICAqIGNhbm5vdCwgYW5kIE1TU1FMIGlzIGV4Y2x1ZGVkIGJlY2F1c2UgaXQgcmVhZHMgYSB0d28tcGFydCBuYW1lIGFzIGBzY2hlbWEudGFibGVgIChjcm9zcy1kYXRhYmFzZVxuICAgKiBhY2Nlc3MgbmVlZHMgYSB0aHJlZS1wYXJ0IGBkYXRhYmFzZS5zY2hlbWEudGFibGVgKSwgc28gaXQgc3RheXMgb24gdGhlIGFsd2F5cy1jb3JyZWN0IGZhbi1vdXRcbiAgICogcGF0aC4gQ29uc3VtZWQgYnkgYFRlbmFudC5hZ2dyZWdhdGVBY3Jvc3NgLlxuICAgKiBAcmV0dXJucyB7Ym9vbGVhbn0gLSBXaGV0aGVyIHR3by1wYXJ0IGNyb3NzLWRhdGFiYXNlIHJlZmVyZW5jZXMgYXJlIHN1cHBvcnRlZC5cbiAgICovXG4gIHN1cHBvcnRzQ3Jvc3NEYXRhYmFzZVJlZmVyZW5jZXMoKSB7IHJldHVybiBmYWxzZSB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgdGFibGUgZXhpc3RzLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gdGFibGVOYW1lIC0gVGFibGUgbmFtZS5cbiAgICogQHJldHVybnMge1Byb21pc2U8Ym9vbGVhbj59IC0gUmVzb2x2ZXMgd2l0aCBXaGV0aGVyIHRhYmxlIGV4aXN0cy5cbiAgICovXG4gIGFzeW5jIHRhYmxlRXhpc3RzKHRhYmxlTmFtZSkge1xuICAgIGNvbnN0IHRhYmxlcyA9IGF3YWl0IHRoaXMuZ2V0VGFibGVzKClcbiAgICBjb25zdCB0YWJsZSA9IHRhYmxlcy5maW5kKCh0YWJsZSkgPT4gdGFibGUuZ2V0TmFtZSgpID09IHRhYmxlTmFtZSlcblxuICAgIGlmICh0YWJsZSkgcmV0dXJuIHRydWVcblxuICAgIHJldHVybiBmYWxzZVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgYSBjYWxsYmFjayBpbnNpZGUgYSBkYXRhYmFzZSB0cmFuc2FjdGlvbiAob3IgYSBzYXZlcG9pbnQgd2hlbiBhbHJlYWR5IGluc2lkZSBvbmUpLlxuICAgKiBUaGUgb3V0ZXJtb3N0IHRyYW5zYWN0aW9uIHJldHJpZXMgdGhlIHdob2xlIGNhbGxiYWNrIG9uIGEgZGVhZGxvY2sgLyBsb2NrLXdhaXQtdGltZW91dCxcbiAgICogYmVjYXVzZSBzdWNoIGVycm9ycyByb2xsIHRoZSBlbnRpcmUgdHJhbnNhY3Rpb24gYmFjayBhbmQgdGhlIHN0YW5kYXJkIHJlY292ZXJ5IGlzIHRvXG4gICAqIHJlc3RhcnQgaXQuIE5lc3RlZCBzYXZlcG9pbnRzIGxldCB0aGUgZGVhZGxvY2sgYnViYmxlIHVwIHRvIHRoaXMgb3V0ZXIgcmV0cnkuXG4gICAqIEB0ZW1wbGF0ZSBUXG4gICAqIEBwYXJhbSB7KCkgPT4gUHJvbWlzZTxUPn0gY2FsbGJhY2sgLSBDYWxsYmFjayBmdW5jdGlvbi5cbiAgICogQHBhcmFtIHtQaWNrPFF1ZXJ5T3B0aW9ucywgXCJvcGVyYXRpb25Pd25lclwiPn0gW29wdGlvbnNdIC0gVHJhbnNhY3Rpb24gb3duZXJzaGlwLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxUPn0gLSBSZXNvbHZlcyB3aXRoIHRoZSB0cmFuc2FjdGlvbiByZXN1bHQuXG4gICAqL1xuICBhc3luYyB0cmFuc2FjdGlvbihjYWxsYmFjaywgb3B0aW9ucyA9IHt9KSB7XG4gICAgYXdhaXQgdGhpcy5fd2FpdEZvck9wZXJhdGlvbkxlYXNlKG9wdGlvbnMub3BlcmF0aW9uT3duZXIpXG5cbiAgICByZXR1cm4gYXdhaXQgY29vcmRpbmF0ZVNoYXJlZFRyYW5zYWN0aW9uQ29ubmVjdGlvbih0aGlzLCBhc3luYyAoKSA9PiB7XG4gICAgICBpZiAodGhpcy5fdHJhbnNhY3Rpb25zQ291bnQgPiAwKSB7XG4gICAgICAgIHJldHVybiBhd2FpdCB0aGlzLl9ydW5UcmFuc2FjdGlvbkF0dGVtcHQoY2FsbGJhY2ssIG9wdGlvbnMpXG4gICAgICB9XG5cbiAgICAgIGNvbnN0IGFyZ3MgPSB0aGlzLmdldEFyZ3MoKVxuICAgICAgY29uc3QgbWF4QXR0ZW1wdHMgPSBvcHRpb25hbFBvc2l0aXZlSW50ZWdlcihhcmdzLmRlYWRsb2NrTWF4UmV0cmllcywgXCJkZWFkbG9ja01heFJldHJpZXNcIikgPz8gOFxuICAgICAgY29uc3QgY29uZmlndXJlZEJhc2VXYWl0TXMgPSBvcHRpb25hbFBvc2l0aXZlSW50ZWdlcihhcmdzLmRlYWRsb2NrQmFzZVdhaXRNcywgXCJkZWFkbG9ja0Jhc2VXYWl0TXNcIilcbiAgICAgIGNvbnN0IGRlYWRsb2NrTWF4V2FpdE1zID0gb3B0aW9uYWxQb3NpdGl2ZUludGVnZXIoYXJncy5kZWFkbG9ja01heFdhaXRNcywgXCJkZWFkbG9ja01heFdhaXRNc1wiKSA/PyAxMDAwXG4gICAgICBsZXQgYXR0ZW1wdCA9IDBcblxuICAgICAgd2hpbGUgKHRydWUpIHtcbiAgICAgICAgYXR0ZW1wdCsrXG4gICAgICAgIGNvbnN0IGF0dGVtcHRTdGFydGVkQXRNcyA9IHRoaXMuX25vd01zKClcblxuICAgICAgICB0cnkge1xuICAgICAgICAgIHJldHVybiBhd2FpdCB0aGlzLl9ydW5UcmFuc2FjdGlvbkF0dGVtcHQoY2FsbGJhY2ssIG9wdGlvbnMpXG4gICAgICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICAgICAgaWYgKGVycm9yIGluc3RhbmNlb2YgVmVsb2Npb3VzRGF0YWJhc2VBZnRlckNvbW1pdENhbGxiYWNrRXJyb3IpIHRocm93IGVycm9yLmNhbGxiYWNrRXJyb3JcbiAgICAgICAgICBpZiAoIShlcnJvciBpbnN0YW5jZW9mIEVycm9yKSkgdGhyb3cgZXJyb3JcblxuICAgICAgICAgIGNvbnN0IHJldHJ5SW5mbyA9IHRoaXMucmV0cnlhYmxlRGF0YWJhc2VFcnJvcihlcnJvcilcbiAgICAgICAgICBjb25zdCB3aWxsUmV0cnkgPSBCb29sZWFuKHJldHJ5SW5mby5kZWFkbG9jayAmJiBhdHRlbXB0IDwgbWF4QXR0ZW1wdHMgJiYgdGhpcy5fdHJhbnNhY3Rpb25zQ291bnQgPT0gMClcblxuICAgICAgICAgIGlmICh3aWxsUmV0cnkpIHtcbiAgICAgICAgICAgIHRoaXMuX3JlcG9ydERlYWRsb2NrUmV0cnlEaWFnbm9zdGljKHtcbiAgICAgICAgICAgICAgYXR0ZW1wdCxcbiAgICAgICAgICAgICAgY29udGVudGlvbktpbmQ6IHJldHJ5SW5mby5jb250ZW50aW9uS2luZCB8fCBcImRlYWRsb2NrXCIsXG4gICAgICAgICAgICAgIGVycm9yLFxuICAgICAgICAgICAgICBtYXhBdHRlbXB0cyxcbiAgICAgICAgICAgICAgdHJhbnNhY3Rpb25BdHRlbXB0RHVyYXRpb25NczogTWF0aC5tYXgoMCwgdGhpcy5fbm93TXMoKSAtIGF0dGVtcHRTdGFydGVkQXRNcyksXG4gICAgICAgICAgICAgIHdpbGxSZXRyeVxuICAgICAgICAgICAgfSlcblxuICAgICAgICAgICAgLy8gQW4gZXhwbGljaXRseS1jb25maWd1cmVkIGJhc2Ugd2lucyBzbyB0aGUgdHVuaW5nIGtub2IgaXMgZWZmZWN0aXZlIGV2ZW4gb24gZHJpdmVyc1xuICAgICAgICAgICAgLy8gd2hvc2UgY2xhc3NpZmllciBzdXBwbGllcyBpdHMgb3duIGB3YWl0TXNgIChNeVNRTC9NYXJpYURCIHJldHVybiBhIGZpeGVkIDUwbXMgZm9yXG4gICAgICAgICAgICAvLyBkZWFkbG9ja3MpOyBvdGhlcndpc2UgaG9ub3IgdGhhdCBjbGFzc2lmaWVyIGhpbnQsIHRoZW4gZmFsbCBiYWNrIHRvIDUwbXMuXG4gICAgICAgICAgICBjb25zdCBiYXNlV2FpdE1zID0gY29uZmlndXJlZEJhc2VXYWl0TXMgPz8gKHR5cGVvZiByZXRyeUluZm8ud2FpdE1zID09IFwibnVtYmVyXCIgJiYgcmV0cnlJbmZvLndhaXRNcyA+IDAgPyByZXRyeUluZm8ud2FpdE1zIDogNTApXG5cbiAgICAgICAgICAgIC8vIEZ1bGwtaml0dGVyIGV4cG9uZW50aWFsIGJhY2tvZmY6IHdhaXQgYSB1bmlmb3JtLXJhbmRvbSBkdXJhdGlvbiBpblxuICAgICAgICAgICAgLy8gWzAsIG1pbihiYXNlICogMl4oYXR0ZW1wdC0xKSwgY2FwKV0uIFRoZSBkb3VibGluZyBjZWlsaW5nIHNwcmVhZHMgcmV0cmllcyBvdXQgYXNcbiAgICAgICAgICAgIC8vIGNvbnRlbnRpb24gcGVyc2lzdHMsIGFuZCB0aGUgaml0dGVyIGRlLWNvcnJlbGF0ZXMgdHJhbnNhY3Rpb25zIHRoYXQgZGVhZGxvY2tlZCBpblxuICAgICAgICAgICAgLy8gbG9ja3N0ZXAgc28gdGhleSBzdG9wIHJlLWNvbGxpZGluZyBvbiB0aGUgc2FtZSB3YWl0ICh0aGUgbGluZWFyIGBiYXNlICogYXR0ZW1wdGBcbiAgICAgICAgICAgIC8vIHRoaXMgcmVwbGFjZXMgaGFkIGV2ZXJ5IHZpY3RpbSByZXRyeSBhZnRlciBhbiBpZGVudGljYWwgZGVsYXkpLiBgYXR0ZW1wdGAgaXNcbiAgICAgICAgICAgIC8vIDEtYmFzZWQgaGVyZSwgc28gMl4oYXR0ZW1wdC0xKSBpcyAxLCAyLCA0LCAuLi4gVGhlIGNhcCBrZWVwcyB0aGUgdGFpbCBzdWItc2Vjb25kLlxuICAgICAgICAgICAgY29uc3QgY2VpbGluZ1dhaXRNcyA9IE1hdGgubWluKGJhc2VXYWl0TXMgKiAoMiAqKiAoYXR0ZW1wdCAtIDEpKSwgZGVhZGxvY2tNYXhXYWl0TXMpXG4gICAgICAgICAgICBjb25zdCBqaXR0ZXJlZFdhaXRNcyA9IE1hdGguZmxvb3IoTWF0aC5yYW5kb20oKSAqIChjZWlsaW5nV2FpdE1zICsgMSkpXG5cbiAgICAgICAgICAgIGNvbnN0IGxvZ2dlZENvbnRlbnRpb25LaW5kID0gcmV0cnlJbmZvLmNvbnRlbnRpb25LaW5kIHx8IFwidHJhbnNhY3Rpb24gY29udGVudGlvblwiXG5cbiAgICAgICAgICAgIHRoaXMubG9nZ2VyLndhcm4oYFJldHJ5aW5nIHRyYW5zYWN0aW9uIGFmdGVyICR7bG9nZ2VkQ29udGVudGlvbktpbmR9IChhdHRlbXB0ICR7YXR0ZW1wdH0vJHttYXhBdHRlbXB0c30pYClcbiAgICAgICAgICAgIGF3YWl0IHRoaXMuX3dhaXRNcyhqaXR0ZXJlZFdhaXRNcylcbiAgICAgICAgICAgIGNvbnRpbnVlXG4gICAgICAgICAgfVxuXG4gICAgICAgICAgdGhyb3cgZXJyb3JcbiAgICAgICAgfVxuICAgICAgfVxuICAgIH0sIG9wdGlvbnMub3BlcmF0aW9uT3duZXIpXG4gIH1cblxuICAvKipcbiAgICogV2FpdHMgYG1zYCBtaWxsaXNlY29uZHMuIElzb2xhdGVkIGluIGl0cyBvd24gbWV0aG9kIHNvIHRlc3RzIGNhbiBvYnNlcnZlIChhbmQgc2tpcCkgdGhlXG4gICAqIGRlYWRsb2NrLXJldHJ5IGJhY2tvZmYgd2l0aG91dCBhIHJlYWwgdGltZXIuXG4gICAqIEBwYXJhbSB7bnVtYmVyfSBtcyAtIE1pbGxpc2Vjb25kcyB0byB3YWl0LlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyBhZnRlciB0aGUgZGVsYXkuXG4gICAqL1xuICBhc3luYyBfd2FpdE1zKG1zKSB7XG4gICAgYXdhaXQgd2FpdChtcylcbiAgfVxuXG4gIC8qKlxuICAgKiBSZXR1cm5zIHRoZSBjbG9jayB1c2VkIGZvciB0cmFuc2FjdGlvbi1hdHRlbXB0IGRpYWdub3N0aWNzLlxuICAgKiBAcmV0dXJucyB7bnVtYmVyfSAtIE1vbm90b25pYyBtaWxsaXNlY29uZHMgd2hlcmUgYXZhaWxhYmxlLlxuICAgKi9cbiAgX25vd01zKCkge1xuICAgIHJldHVybiBub3dNcygpXG4gIH1cblxuICAvKipcbiAgICogU3RhcnRzIGJlc3QtZWZmb3J0IGRlYWRsb2NrIGRpYWdub3N0aWNzIHdpdGhvdXQgam9pbmluZyB0aGUgcmV0cnkgY29udHJvbCBmbG93LiBTdWJjbGFzc2VzIG1heVxuICAgKiBhZGQgYm91bmRlZCBkcml2ZXItc3BlY2lmaWMgY29udGV4dDsgY2FwdHVyZSBhbmQgZXZlbnQtbGlzdGVuZXIgZmFpbHVyZXMgY2Fubm90IGFmZmVjdCByZXRyeS5cbiAgICogQHBhcmFtIHt7YXR0ZW1wdDogbnVtYmVyLCBjb250ZW50aW9uS2luZDogXCJkZWFkbG9ja1wiIHwgXCJsb2NrLXdhaXQtdGltZW91dFwiLCBlcnJvcjogRXJyb3IsIG1heEF0dGVtcHRzOiBudW1iZXIsIHRyYW5zYWN0aW9uQXR0ZW1wdER1cmF0aW9uTXM6IG51bWJlciwgd2lsbFJldHJ5OiBib29sZWFufX0gYXJncyAtIFJldHJ5IG1ldGFkYXRhLlxuICAgKiBAcmV0dXJucyB7dm9pZH1cbiAgICovXG4gIF9yZXBvcnREZWFkbG9ja1JldHJ5RGlhZ25vc3RpYyh7YXR0ZW1wdCwgY29udGVudGlvbktpbmQsIGVycm9yLCBtYXhBdHRlbXB0cywgdHJhbnNhY3Rpb25BdHRlbXB0RHVyYXRpb25Ncywgd2lsbFJldHJ5fSkge1xuICAgIGxldCBzbmFwc2hvdFxuXG4gICAgdHJ5IHtcbiAgICAgIGNvbnN0IHF1ZXJ5RGlhZ25vc3RpYyA9IHRoaXMuX2ZhaWxlZFF1ZXJ5RGlhZ25vc3RpY3MuZ2V0KGVycm9yKVxuXG4gICAgICBzbmFwc2hvdCA9IE9iamVjdC5mcmVlemUoe1xuICAgICAgICBhdHRlbXB0LFxuICAgICAgICBjb250ZW50aW9uS2luZCxcbiAgICAgICAgZHJpdmVyVHlwZTogdGhpcy5nZXRUeXBlKCksXG4gICAgICAgIG1heEF0dGVtcHRzLFxuICAgICAgICBzdGFnZTogXCJkYXRhYmFzZS1kZWFkbG9jay1yZXRyeVwiLFxuICAgICAgICB0cmFuc2FjdGlvbkF0dGVtcHREdXJhdGlvbk1zLFxuICAgICAgICB3aWxsUmV0cnksXG4gICAgICAgIC4uLnRoaXMuX3Bvb2xEaWFnbm9zdGljSWRlbnRpdHlDb250ZXh0KCksXG4gICAgICAgIC4uLnRoaXMuX29wZXJhdGlvbkRpYWdub3N0aWNDb250ZXh0KCksXG4gICAgICAgIC4uLnF1ZXJ5RGlhZ25vc3RpY1xuICAgICAgfSlcbiAgICB9IGNhdGNoIChkaWFnbm9zdGljRXJyb3IpIHtcbiAgICAgIHRoaXMuX3JlcG9ydERlYWRsb2NrRGlhZ25vc3RpY1BpcGVsaW5lRmFpbHVyZShkaWFnbm9zdGljRXJyb3IpXG4gICAgICByZXR1cm5cbiAgICB9XG5cbiAgICBsZXQgZHJpdmVyQ29udGV4dFJlc3VsdFxuXG4gICAgdHJ5IHtcbiAgICAgIGRyaXZlckNvbnRleHRSZXN1bHQgPSB0aGlzLl9kZWFkbG9ja0RpYWdub3N0aWNDb250ZXh0KHNuYXBzaG90KVxuICAgIH0gY2F0Y2ggKGRpYWdub3N0aWNFcnJvcikge1xuICAgICAgdGhpcy5fcmVwb3J0RGVhZGxvY2tEaWFnbm9zdGljUGlwZWxpbmVGYWlsdXJlKGRpYWdub3N0aWNFcnJvcilcbiAgICAgIHJldHVyblxuICAgIH1cblxuICAgIGNvbnN0IGhhc1Byb21pc2VDb250cmFjdCA9IGRyaXZlckNvbnRleHRSZXN1bHQgaW5zdGFuY2VvZiBQcm9taXNlXG5cbiAgICB2b2lkIFByb21pc2UucmVzb2x2ZShkcml2ZXJDb250ZXh0UmVzdWx0KVxuICAgICAgLnRoZW4oKGRyaXZlckNvbnRleHQpID0+IHtcbiAgICAgICAgaWYgKCFoYXNQcm9taXNlQ29udHJhY3QpIHRocm93IG5ldyBFcnJvcihcIkRhdGFiYXNlIGRlYWRsb2NrIGRpYWdub3N0aWMgY29udGV4dCBtdXN0IHJldHVybiBhIFByb21pc2VcIilcblxuICAgICAgICBjb25zdCBjb250ZXh0ID0ge1xuICAgICAgICAgIC4uLnNuYXBzaG90LFxuICAgICAgICAgIC4uLmRyaXZlckNvbnRleHRcbiAgICAgICAgfVxuICAgICAgICBjb25zdCBwYXlsb2FkID0ge1xuICAgICAgICAgIGNvbnRleHQsXG4gICAgICAgICAgZXJyb3I6IG5ldyBFcnJvcih3aWxsUmV0cnlcbiAgICAgICAgICAgID8gYERhdGFiYXNlIHRyYW5zYWN0aW9uICR7Y29udGVudGlvbktpbmR9IHdpbGwgYmUgcmV0cmllZGBcbiAgICAgICAgICAgIDogYERhdGFiYXNlIHRyYW5zYWN0aW9uICR7Y29udGVudGlvbktpbmR9IGV4aGF1c3RlZCBpdHMgcmV0cnkgYnVkZ2V0YClcbiAgICAgICAgfVxuICAgICAgICBjb25zdCBlcnJvckV2ZW50cyA9IHRoaXMuY29uZmlndXJhdGlvbi5nZXRFcnJvckV2ZW50cygpXG5cbiAgICAgICAgdHJ5IHtcbiAgICAgICAgICBlcnJvckV2ZW50cy5lbWl0KFwiZGF0YWJhc2UtZGVhZGxvY2stcmV0cnlcIiwgcGF5bG9hZClcbiAgICAgICAgfSBjYXRjaCAoZXZlbnRFcnJvcikge1xuICAgICAgICAgIHRoaXMubG9nZ2VyLndhcm4oXCJEYXRhYmFzZSBkZWFkbG9jayByZXRyeSBkaWFnbm9zdGljIGxpc3RlbmVyIGZhaWxlZFwiLCB7ZXJyb3I6IGV2ZW50RXJyb3J9KVxuICAgICAgICB9XG5cbiAgICAgICAgdHJ5IHtcbiAgICAgICAgICBlcnJvckV2ZW50cy5lbWl0KFwiYWxsLWVycm9yXCIsIHsuLi5wYXlsb2FkLCBlcnJvclR5cGU6IFwiZGF0YWJhc2UtZGVhZGxvY2stcmV0cnlcIn0pXG4gICAgICAgIH0gY2F0Y2ggKGV2ZW50RXJyb3IpIHtcbiAgICAgICAgICB0aGlzLmxvZ2dlci53YXJuKFwiRGF0YWJhc2UgZGVhZGxvY2sgcmV0cnkgYWxsLWVycm9yIGxpc3RlbmVyIGZhaWxlZFwiLCB7ZXJyb3I6IGV2ZW50RXJyb3J9KVxuICAgICAgICB9XG4gICAgICB9KVxuICAgICAgLmNhdGNoKChkaWFnbm9zdGljRXJyb3IpID0+IHRoaXMuX3JlcG9ydERlYWRsb2NrRGlhZ25vc3RpY1BpcGVsaW5lRmFpbHVyZShkaWFnbm9zdGljRXJyb3IpKVxuICB9XG5cbiAgLyoqXG4gICAqIFJldHVybnMgcG9vbCBpZGVudGl0eSBvbmx5IHdoZW4gdGhpcyBkcml2ZXIgd2FzIHN0YW1wZWQgYnkgYSBwb29sLlxuICAgKiBAcmV0dXJucyB7e2RhdGFiYXNlSWRlbnRpZmllcj86IHN0cmluZywgZGF0YWJhc2VJZGVudGlmaWVyRmluZ2VycHJpbnQ/OiBzdHJpbmcsIGRhdGFiYXNlSWRlbnRpdHlGaW5nZXJwcmludD86IHN0cmluZ319IC0gU2FmZSBwb29sIGlkZW50aXR5LlxuICAgKi9cbiAgX3Bvb2xEaWFnbm9zdGljSWRlbnRpdHlDb250ZXh0KCkge1xuICAgIGlmICh0aGlzLl9kYXRhYmFzZUlkZW50aWZpZXIgPT09IHVuZGVmaW5lZCB8fCAhdGhpcy5fZGF0YWJhc2VJZGVudGl0eUZpbmdlcnByaW50KSByZXR1cm4ge31cblxuICAgIGNvbnN0IGlkZW50aWZpZXJGaW5nZXJwcmludElucHV0ID0gdHlwZW9mIHRoaXMuX2RhdGFiYXNlSWRlbnRpZmllciA9PT0gXCJzdHJpbmdcIlxuICAgICAgPyB0aGlzLl9kYXRhYmFzZUlkZW50aWZpZXJcbiAgICAgIDogYGludmFsaWQ6JHt0eXBlb2YgdGhpcy5fZGF0YWJhc2VJZGVudGlmaWVyfWBcbiAgICBjb25zdCBkYXRhYmFzZUlkZW50aWZpZXJGaW5nZXJwcmludCA9IGBzaGEyNTY6JHtzaGEyNTZIZXgoYGRhdGFiYXNlLWxvZ2ljYWwtaWRlbnRpZmllcjp2MVxcMCR7aWRlbnRpZmllckZpbmdlcnByaW50SW5wdXR9YCl9YFxuXG4gICAgcmV0dXJuIHtcbiAgICAgIGRhdGFiYXNlSWRlbnRpZmllcjogUkVEQUNURURfRElBR05PU1RJQ19MQUJFTCxcbiAgICAgIGRhdGFiYXNlSWRlbnRpZmllckZpbmdlcnByaW50LFxuICAgICAgZGF0YWJhc2VJZGVudGl0eUZpbmdlcnByaW50OiB0aGlzLl9kYXRhYmFzZUlkZW50aXR5RmluZ2VycHJpbnRcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogQnVpbGRzIHRoZSBib3VuZGVkIG9wZXJhdGlvbiBwb3J0aW9uIG9mIGFuIGltbXV0YWJsZSByZXRyeSBzbmFwc2hvdC5cbiAgICogQHJldHVybnMge3tvcGVyYXRpb25OYW1lPzogc3RyaW5nLCBvcGVyYXRpb25OYW1lRmluZ2VycHJpbnQ/OiBzdHJpbmd9fSAtIFNhZmUgb3BlcmF0aW9uIGZpZWxkcy5cbiAgICovXG4gIF9vcGVyYXRpb25EaWFnbm9zdGljQ29udGV4dCgpIHtcbiAgICBjb25zdCByYXdPcGVyYXRpb25OYW1lID0gdGhpcy5fY29ubmVjdGlvbkNoZWNrb3V0TmFtZVxuXG4gICAgaWYgKHJhd09wZXJhdGlvbk5hbWUgPT09IHVuZGVmaW5lZCkgcmV0dXJuIHt9XG4gICAgaWYgKHR5cGVvZiByYXdPcGVyYXRpb25OYW1lICE9PSBcInN0cmluZ1wiKSB7XG4gICAgICByZXR1cm4ge1xuICAgICAgICBvcGVyYXRpb25OYW1lOiBSRURBQ1RFRF9ESUFHTk9TVElDX0xBQkVMLFxuICAgICAgICBvcGVyYXRpb25OYW1lRmluZ2VycHJpbnQ6IGBzaGEyNTY6JHtzaGEyNTZIZXgoYGRhdGFiYXNlLW9wZXJhdGlvbjp2MVxcMGludmFsaWQ6JHt0eXBlb2YgcmF3T3BlcmF0aW9uTmFtZX1gKX1gXG4gICAgICB9XG4gICAgfVxuXG4gICAgY29uc3Qgc2Nhbm5lZE9wZXJhdGlvbk5hbWUgPSByYXdPcGVyYXRpb25OYW1lLnNsaWNlKDAsIE9QRVJBVElPTl9OQU1FX1NDQU5fTElNSVQpXG4gICAgY29uc3Qgb3BlcmF0aW9uTmFtZUZpbmdlcnByaW50ID0gYHNoYTI1Njoke3NoYTI1NkhleChgZGF0YWJhc2Utb3BlcmF0aW9uOnYxXFwwJHtzY2FubmVkT3BlcmF0aW9uTmFtZX1cXDBsZW5ndGg6JHtyYXdPcGVyYXRpb25OYW1lLmxlbmd0aH1gKX1gXG5cbiAgICByZXR1cm4ge1xuICAgICAgb3BlcmF0aW9uTmFtZTogUkVEQUNURURfRElBR05PU1RJQ19MQUJFTCxcbiAgICAgIG9wZXJhdGlvbk5hbWVGaW5nZXJwcmludFxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBSZXBvcnRzIGFuIHVuZXhwZWN0ZWQgZGV0YWNoZWQgZGlhZ25vc3RpY3MgZmFpbHVyZSB3aXRob3V0IGNoYW5naW5nIHRyYW5zYWN0aW9uIGNvbnRyb2wgZmxvdy5cbiAgICogQHBhcmFtIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gZGlhZ25vc3RpY0Vycm9yIC0gRGlhZ25vc3RpY3MgZmFpbHVyZS5cbiAgICogQHJldHVybnMge3ZvaWR9XG4gICAqL1xuICBfcmVwb3J0RGVhZGxvY2tEaWFnbm9zdGljUGlwZWxpbmVGYWlsdXJlKGRpYWdub3N0aWNFcnJvcikge1xuICAgIGNvbnN0IG5vcm1hbGl6ZWRFcnJvciA9IGRpYWdub3N0aWNFcnJvciBpbnN0YW5jZW9mIEVycm9yXG4gICAgICA/IGRpYWdub3N0aWNFcnJvclxuICAgICAgOiBuZXcgRXJyb3IoXCJEYXRhYmFzZSBkZWFkbG9jayByZXRyeSBkaWFnbm9zdGljIGZhaWxlZFwiLCB7Y2F1c2U6IGRpYWdub3N0aWNFcnJvcn0pXG4gICAgY29uc3QgcGF5bG9hZCA9IHtcbiAgICAgIGNvbnRleHQ6IHtzdGFnZTogXCJkYXRhYmFzZS1kZWFkbG9jay1yZXRyeS1kaWFnbm9zdGljXCJ9LFxuICAgICAgZXJyb3I6IG5vcm1hbGl6ZWRFcnJvclxuICAgIH1cbiAgICBsZXQgZXJyb3JFdmVudHNcblxuICAgIHRyeSB7XG4gICAgICBlcnJvckV2ZW50cyA9IHRoaXMuY29uZmlndXJhdGlvbi5nZXRFcnJvckV2ZW50cygpXG4gICAgfSBjYXRjaCAocmVwb3J0aW5nRXJyb3IpIHtcbiAgICAgIHRoaXMubG9nZ2VyLndhcm4oXCJEYXRhYmFzZSBkZWFkbG9jayByZXRyeSBkaWFnbm9zdGljIHBpcGVsaW5lIHJlcG9ydGluZyBmYWlsZWRcIiwge2Vycm9yOiBub3JtYWxpemVkRXJyb3IsIHJlcG9ydGluZ0Vycm9yfSlcbiAgICAgIHJldHVyblxuICAgIH1cblxuICAgIHRyeSB7XG4gICAgICBlcnJvckV2ZW50cy5lbWl0KFwiZnJhbWV3b3JrLWVycm9yXCIsIHBheWxvYWQpXG4gICAgfSBjYXRjaCAocmVwb3J0aW5nRXJyb3IpIHtcbiAgICAgIHRoaXMubG9nZ2VyLndhcm4oXCJEYXRhYmFzZSBkZWFkbG9jayByZXRyeSBmcmFtZXdvcmstZXJyb3IgbGlzdGVuZXIgZmFpbGVkXCIsIHtlcnJvcjogbm9ybWFsaXplZEVycm9yLCByZXBvcnRpbmdFcnJvcn0pXG4gICAgfVxuXG4gICAgdHJ5IHtcbiAgICAgIGVycm9yRXZlbnRzLmVtaXQoXCJhbGwtZXJyb3JcIiwgey4uLnBheWxvYWQsIGVycm9yVHlwZTogXCJmcmFtZXdvcmstZXJyb3JcIn0pXG4gICAgfSBjYXRjaCAocmVwb3J0aW5nRXJyb3IpIHtcbiAgICAgIHRoaXMubG9nZ2VyLndhcm4oXCJEYXRhYmFzZSBkZWFkbG9jayByZXRyeSBhbGwtZXJyb3IgbGlzdGVuZXIgZmFpbGVkXCIsIHtlcnJvcjogbm9ybWFsaXplZEVycm9yLCByZXBvcnRpbmdFcnJvcn0pXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIEJ1aWxkcyBkcml2ZXItc3BlY2lmaWMgZGVhZGxvY2sgY29udGV4dC4gVGhlIGJhc2UgZHJpdmVyIGhhcyBubyBzZXJ2ZXIgZGlhZ25vc3RpYyBzb3VyY2UuXG4gICAqIEBwYXJhbSB7RGVhZGxvY2tSZXRyeURpYWdub3N0aWNTbmFwc2hvdH0gX3NuYXBzaG90IC0gSW1tdXRhYmxlIHJldHJ5IHNuYXBzaG90LlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj4+fSAtIFNhZmUgY29udGV4dCBmaWVsZHMuXG4gICAqL1xuICBhc3luYyBfZGVhZGxvY2tEaWFnbm9zdGljQ29udGV4dChfc25hcHNob3QpIHtcbiAgICByZXR1cm4ge31cbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGEgc2luZ2xlIHRyYW5zYWN0aW9uIGF0dGVtcHQ6IHN0YXJ0cyBhIHRyYW5zYWN0aW9uIChvciBhIHNhdmVwb2ludCB3aGVuIG5lc3RlZCksIHJ1bnNcbiAgICogYGNhbGxiYWNrYCwgYW5kIGNvbW1pdHMg4oCUIHJvbGxpbmcgYmFjayBvbiBlcnJvci4ge0BsaW5rIHRyYW5zYWN0aW9ufSB3cmFwcyB0aGlzIHdpdGggZGVhZGxvY2tcbiAgICogcmV0cnkgYXQgdGhlIG91dGVybW9zdCBsZXZlbC5cbiAgICogQHRlbXBsYXRlIFRcbiAgICogQHBhcmFtIHsoKSA9PiBQcm9taXNlPFQ+fSBjYWxsYmFjayAtIENhbGxiYWNrIGZ1bmN0aW9uLlxuICAgKiBAcGFyYW0ge1BpY2s8UXVlcnlPcHRpb25zLCBcIm9wZXJhdGlvbk93bmVyXCI+fSBvcHRpb25zIC0gVHJhbnNhY3Rpb24gb3duZXJzaGlwLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59IC0gUmVzb2x2ZXMgd2l0aCB0aGUgdHJhbnNhY3Rpb24gcmVzdWx0LlxuICAgKi9cbiAgYXN5bmMgX3J1blRyYW5zYWN0aW9uQXR0ZW1wdChjYWxsYmFjaywgb3B0aW9ucykge1xuICAgIGNvbnN0IHNhdmVQb2ludE5hbWUgPSB0aGlzLmdlbmVyYXRlU2F2ZVBvaW50TmFtZSgpXG4gICAgLyoqIEB0eXBlIHtUcmFuc2FjdGlvbkNhbGxiYWNrRnJhbWV9ICovXG4gICAgY29uc3QgY2FsbGJhY2tGcmFtZSA9IHtcbiAgICAgIGFmdGVyQ29tbWl0Q2FsbGJhY2tzOiBbXSxcbiAgICAgIGJlZm9yZUNvbW1pdENhbGxiYWNrczogW11cbiAgICB9XG4gICAgbGV0IHRyYW5zYWN0aW9uU3RhcnRlZCA9IGZhbHNlXG4gICAgbGV0IHNhdmVQb2ludFN0YXJ0ZWQgPSBmYWxzZVxuXG4gICAgdGhpcy5fdHJhbnNhY3Rpb25DYWxsYmFja0ZyYW1lcy5wdXNoKGNhbGxiYWNrRnJhbWUpXG5cbiAgICB0cnkge1xuICAgICAgaWYgKHRoaXMuX3RyYW5zYWN0aW9uc0NvdW50ID09IDApIHtcbiAgICAgICAgdGhpcy5sb2dnZXIuZGVidWcoXCJTdGFydCB0cmFuc2FjdGlvblwiKVxuICAgICAgICBhd2FpdCB0aGlzLnN0YXJ0VHJhbnNhY3Rpb24ob3B0aW9ucylcbiAgICAgICAgdHJhbnNhY3Rpb25TdGFydGVkID0gdHJ1ZVxuICAgICAgfSBlbHNlIHtcbiAgICAgICAgdGhpcy5sb2dnZXIuZGVidWcoXCJTdGFydCBzYXZlcG9pbnRcIiwgc2F2ZVBvaW50TmFtZSlcbiAgICAgICAgYXdhaXQgdGhpcy5zdGFydFNhdmVQb2ludChzYXZlUG9pbnROYW1lLCBvcHRpb25zKVxuICAgICAgICBzYXZlUG9pbnRTdGFydGVkID0gdHJ1ZVxuICAgICAgfVxuICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICB0aGlzLl90cmFuc2FjdGlvbkNhbGxiYWNrRnJhbWVzLnBvcCgpXG4gICAgICB0aHJvdyBlcnJvclxuICAgIH1cblxuICAgIGxldCByZXN1bHRcblxuICAgIHRyeSB7XG4gICAgICByZXN1bHQgPSBhd2FpdCBjYWxsYmFjaygpXG4gICAgICBhd2FpdCB0aGlzLl9ydW5CZWZvcmVDb21taXRDYWxsYmFja3MoY2FsbGJhY2tGcmFtZSlcblxuICAgICAgaWYgKHNhdmVQb2ludFN0YXJ0ZWQpIHtcbiAgICAgICAgdGhpcy5sb2dnZXIuZGVidWcoXCJSZWxlYXNlIHNhdmVwb2ludFwiLCBzYXZlUG9pbnROYW1lKVxuICAgICAgICBhd2FpdCB0aGlzLnJlbGVhc2VTYXZlUG9pbnQoc2F2ZVBvaW50TmFtZSwgb3B0aW9ucylcbiAgICAgIH1cblxuICAgICAgaWYgKHRyYW5zYWN0aW9uU3RhcnRlZCkge1xuICAgICAgICB0aGlzLmxvZ2dlci5kZWJ1ZyhcIkNvbW1pdCB0cmFuc2FjdGlvblwiKVxuICAgICAgICBhd2FpdCB0aGlzLmNvbW1pdFRyYW5zYWN0aW9uKG9wdGlvbnMpXG4gICAgICB9XG4gICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgIGlmIChlcnJvciBpbnN0YW5jZW9mIEVycm9yKSB7XG4gICAgICAgIHRoaXMubG9nZ2VyLmRlYnVnKFwiVHJhbnNhY3Rpb24gZXJyb3JcIiwgZXJyb3IubWVzc2FnZSlcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIHRoaXMubG9nZ2VyLmRlYnVnKFwiVHJhbnNhY3Rpb24gZXJyb3JcIiwgZXJyb3IpXG4gICAgICB9XG5cbiAgICAgIHRyeSB7XG4gICAgICAgIGxldCB0cmFuc2FjdGlvblJvbGxlZEJhY2sgPSBmYWxzZVxuXG4gICAgICAgIGlmIChzYXZlUG9pbnRTdGFydGVkKSB7XG4gICAgICAgICAgdGhpcy5sb2dnZXIuZGVidWcoXCJSb2xsYmFjayBzYXZlcG9pbnRcIiwgc2F2ZVBvaW50TmFtZSlcbiAgICAgICAgICB0cnkge1xuICAgICAgICAgICAgYXdhaXQgdGhpcy5yb2xsYmFja1NhdmVQb2ludChzYXZlUG9pbnROYW1lLCBvcHRpb25zKVxuICAgICAgICAgIH0gY2F0Y2ggKHNhdmVQb2ludEVycm9yKSB7XG4gICAgICAgICAgICBjb25zdCBtZXNzYWdlID0gc2F2ZVBvaW50RXJyb3IgaW5zdGFuY2VvZiBFcnJvciA/IHNhdmVQb2ludEVycm9yLm1lc3NhZ2UgOiBgJHtzYXZlUG9pbnRFcnJvcn1gXG5cbiAgICAgICAgICAgIC8vIE15U1FMIHNvbWV0aW1lcyBkcm9wcyBzYXZlcG9pbnRzIHVuZXhwZWN0ZWRseTsgZmFsbCBiYWNrIHRvIHJvbGxpbmcgYmFjayB0aGUgZnVsbCB0cmFuc2FjdGlvblxuICAgICAgICAgICAgaWYgKG1lc3NhZ2UuaW5jbHVkZXMoXCJTQVZFUE9JTlRcIikgfHwgbWVzc2FnZS5pbmNsdWRlcyhcIkVSX1NQX0RPRVNfTk9UX0VYSVNUXCIpKSB7XG4gICAgICAgICAgICAgIHRoaXMubG9nZ2VyLmRlYnVnKFwiU2F2ZXBvaW50IHJvbGxiYWNrIGZhaWxlZDsgcm9sbGluZyBiYWNrIGVudGlyZSB0cmFuc2FjdGlvbiBpbnN0ZWFkXCIpXG4gICAgICAgICAgICAgIGF3YWl0IHRoaXMucm9sbGJhY2tUcmFuc2FjdGlvbihvcHRpb25zKVxuICAgICAgICAgICAgICB0cmFuc2FjdGlvblJvbGxlZEJhY2sgPSB0cnVlXG4gICAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgICB0aHJvdyBzYXZlUG9pbnRFcnJvclxuICAgICAgICAgICAgfVxuICAgICAgICAgIH1cbiAgICAgICAgfVxuXG4gICAgICAgIC8vIE9ubHkgcm9sbCBiYWNrIGlmIGEgdHJhbnNhY3Rpb24gaXMgc3RpbGwgb3Blbi4gQSBuZXN0ZWQgc2F2ZXBvaW50IHdob3NlIHJvbGxiYWNrIGZhaWxlZFxuICAgICAgICAvLyBmYWxscyBiYWNrIHRvIHJvbGxpbmcgYmFjayB0aGUgd2hvbGUgdHJhbnNhY3Rpb24gKGFib3ZlKSwgd2hpY2ggYWxyZWFkeSBjbG9zZWQgaXQgYW5kXG4gICAgICAgIC8vIGRyb3BwZWQgdGhlIGNvdW50IHRvIDA7IHJvbGxpbmcgYmFjayBhZ2FpbiBoZXJlIHdvdWxkIGlzc3VlIGEgc2Vjb25kIFJPTExCQUNLIGFuZCBkcml2ZVxuICAgICAgICAvLyBgX3RyYW5zYWN0aW9uc0NvdW50YCBiZWxvdyB6ZXJvLCB3aGljaCB3b3VsZCB0aGVuIGRlZmVhdCB0aGUgb3V0ZXJtb3N0IGRlYWRsb2NrLXJldHJ5IGd1YXJkLlxuICAgICAgICBpZiAodHJhbnNhY3Rpb25TdGFydGVkICYmICF0cmFuc2FjdGlvblJvbGxlZEJhY2sgJiYgdGhpcy5fdHJhbnNhY3Rpb25zQ291bnQgPiAwKSB7XG4gICAgICAgICAgdGhpcy5sb2dnZXIuZGVidWcoXCJSb2xsYmFjayB0cmFuc2FjdGlvblwiKVxuICAgICAgICAgIGF3YWl0IHRoaXMucm9sbGJhY2tUcmFuc2FjdGlvbihvcHRpb25zKVxuICAgICAgICB9XG4gICAgICB9IGZpbmFsbHkge1xuICAgICAgICB0aGlzLl90cmFuc2FjdGlvbkNhbGxiYWNrRnJhbWVzLnBvcCgpXG4gICAgICB9XG5cbiAgICAgIHRocm93IGVycm9yXG4gICAgfVxuXG4gICAgdHJ5IHtcbiAgICAgIGF3YWl0IHRoaXMuX2NvbW1pdFRyYW5zYWN0aW9uQ2FsbGJhY2tGcmFtZSgpXG4gICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgIHRocm93IG5ldyBWZWxvY2lvdXNEYXRhYmFzZUFmdGVyQ29tbWl0Q2FsbGJhY2tFcnJvcihlcnJvcilcbiAgICB9XG5cbiAgICByZXR1cm4gcmVzdWx0XG4gIH1cblxuICAvKipcbiAgICogUmVnaXN0ZXJzIGEgZ3VhcmQgdG8gcnVuIGFmdGVyIHRoZSBjdXJyZW50IHRyYW5zYWN0aW9uIGNhbGxiYWNrIHN1Y2NlZWRzIGFuZCBiZWZvcmUgaXRzXG4gICAqIG91dGVyIGNvbW1pdCBvciBuZXN0ZWQgc2F2ZXBvaW50IHJlbGVhc2UuXG4gICAqIEBwYXJhbSB7KCkgPT4gdm9pZCB8IFByb21pc2U8dm9pZD59IGNhbGxiYWNrIC0gR3VhcmQgY2FsbGJhY2suXG4gICAqIEBwYXJhbSB7UGljazxRdWVyeU9wdGlvbnMsIFwib3BlcmF0aW9uT3duZXJcIj59IFtvcHRpb25zXSAtIENhbGxiYWNrIG93bmVyc2hpcC5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgd2hlbiB0aGUgZ3VhcmQgaGFzIGJlZW4gcmVnaXN0ZXJlZC5cbiAgICovXG4gIGFzeW5jIGJlZm9yZUNvbW1pdChjYWxsYmFjaywgb3B0aW9ucyA9IHt9KSB7XG4gICAgYXdhaXQgdGhpcy5fd2FpdEZvck9wZXJhdGlvbkxlYXNlKG9wdGlvbnMub3BlcmF0aW9uT3duZXIpXG5cbiAgICBjb25zdCBjdXJyZW50RnJhbWUgPSB0aGlzLl90cmFuc2FjdGlvbkNhbGxiYWNrRnJhbWVzW3RoaXMuX3RyYW5zYWN0aW9uQ2FsbGJhY2tGcmFtZXMubGVuZ3RoIC0gMV1cblxuICAgIGlmICghY3VycmVudEZyYW1lKSB0aHJvdyBuZXcgRXJyb3IoXCJiZWZvcmVDb21taXQgcmVxdWlyZXMgYW4gYWN0aXZlIHRyYW5zYWN0aW9uXCIpXG5cbiAgICBjdXJyZW50RnJhbWUuYmVmb3JlQ29tbWl0Q2FsbGJhY2tzLnB1c2goY2FsbGJhY2spXG4gIH1cblxuICAvKipcbiAgICogUnVucyBhIGNhbGxiYWNrIGFmdGVyIHRoZSBzdXJyb3VuZGluZyB0cmFuc2FjdGlvbiBjb21taXRzLlxuICAgKiBJZiBubyB0cmFuc2FjdGlvbiBpcyBhY3RpdmUsIHRoZSBjYWxsYmFjayBydW5zIGltbWVkaWF0ZWx5LlxuICAgKiBAcGFyYW0geygpID0+IHZvaWQgfCBQcm9taXNlPHZvaWQ+fSBjYWxsYmFjayAtIENhbGxiYWNrLlxuICAgKiBAcGFyYW0ge1BpY2s8UXVlcnlPcHRpb25zLCBcIm9wZXJhdGlvbk93bmVyXCI+fSBbb3B0aW9uc10gLSBDYWxsYmFjayBvd25lcnNoaXAuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIHdoZW4gdGhlIGNhbGxiYWNrIGhhcyBiZWVuIHJlZ2lzdGVyZWQgb3IgcnVuLlxuICAgKi9cbiAgYXN5bmMgYWZ0ZXJDb21taXQoY2FsbGJhY2ssIG9wdGlvbnMgPSB7fSkge1xuICAgIGF3YWl0IHRoaXMuX3dhaXRGb3JPcGVyYXRpb25MZWFzZShvcHRpb25zLm9wZXJhdGlvbk93bmVyKVxuXG4gICAgY29uc3QgY3VycmVudEZyYW1lID0gdGhpcy5fdHJhbnNhY3Rpb25DYWxsYmFja0ZyYW1lc1t0aGlzLl90cmFuc2FjdGlvbkNhbGxiYWNrRnJhbWVzLmxlbmd0aCAtIDFdXG5cbiAgICBpZiAoIWN1cnJlbnRGcmFtZSkge1xuICAgICAgYXdhaXQgY2FsbGJhY2soKVxuICAgICAgcmV0dXJuXG4gICAgfVxuXG4gICAgY3VycmVudEZyYW1lLmFmdGVyQ29tbWl0Q2FsbGJhY2tzLnB1c2goY2FsbGJhY2spXG4gIH1cblxuICAvKipcbiAgICogV2hldGhlciBhIHRyYW5zYWN0aW9uIGlzIGN1cnJlbnRseSBvcGVuIG9uIHRoaXMgY29ubmVjdGlvbi5cbiAgICogQHJldHVybnMge2Jvb2xlYW59IC0gV2hldGhlciBpbnNpZGUgYSB0cmFuc2FjdGlvbi5cbiAgICovXG4gIGluc2lkZVRyYW5zYWN0aW9uKCkgeyByZXR1cm4gdGhpcy5fdHJhbnNhY3Rpb25zQ291bnQgPiAwIH1cblxuICAvKipcbiAgICogUmV0dXJucyB0aGUgY29tcGxldGlvbiBwcm9taXNlIGlkZW50aWZ5aW5nIHRoZSBjdXJyZW50IG91dGVyIHRyYW5zYWN0aW9uLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gUmVzb2x2ZXMgYWZ0ZXIgdGhhdCB0cmFuc2FjdGlvbiBjb21taXRzIG9yIHJvbGxzIGJhY2suXG4gICAqL1xuICB0cmFuc2FjdGlvbkNvbXBsZXRpb24oKSB7IHJldHVybiB0aGlzLl90cmFuc2FjdGlvbkNvbXBsZXRpb25Qcm9taXNlIH1cblxuICAvKipcbiAgICogUnVucyBzdGFydCB0cmFuc2FjdGlvbi5cbiAgICogQHBhcmFtIHtQaWNrPFF1ZXJ5T3B0aW9ucywgXCJvcGVyYXRpb25Pd25lclwiPn0gW29wdGlvbnNdIC0gVHJhbnNhY3Rpb24gb3duZXJzaGlwLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyB3aGVuIGNvbXBsZXRlLlxuICAgKi9cbiAgYXN5bmMgc3RhcnRUcmFuc2FjdGlvbihvcHRpb25zID0ge30pIHtcbiAgICBhd2FpdCBjb29yZGluYXRlU2hhcmVkVHJhbnNhY3Rpb25Db25uZWN0aW9uKHRoaXMsIGFzeW5jICgpID0+IHtcbiAgICAgIHdoaWxlICh0cnVlKSB7XG4gICAgICAgIC8qKiBAdHlwZSB7aW1wb3J0KFwiLi4vb3BlcmF0aW9uLWxlYXNlLmpzXCIpLmRlZmF1bHQgfCB1bmRlZmluZWR9ICovXG4gICAgICAgIGxldCBibG9ja2luZ09wZXJhdGlvbkxlYXNlXG5cbiAgICAgICAgYXdhaXQgdGhpcy5fdHJhbnNhY3Rpb25zQWN0aW9uc011dGV4LnN5bmMoYXN5bmMgKCkgPT4ge1xuICAgICAgICAgIGNvbnN0IG9wZXJhdGlvbkxlYXNlID0gdGhpcy5fb3BlcmF0aW9uTGVhc2VcblxuICAgICAgICAgIGlmIChvcGVyYXRpb25MZWFzZSAmJiBvcHRpb25zLm9wZXJhdGlvbk93bmVyICE9PSBvcGVyYXRpb25MZWFzZS5vd25lcikge1xuICAgICAgICAgICAgYmxvY2tpbmdPcGVyYXRpb25MZWFzZSA9IG9wZXJhdGlvbkxlYXNlXG4gICAgICAgICAgICByZXR1cm5cbiAgICAgICAgICB9XG5cbiAgICAgICAgICBhd2FpdCB0aGlzLl9ydW5Qcm9maWxlZFRyYW5zYWN0aW9uQWN0aW9uKFwic3RhcnRcIiwgYXN5bmMgKCkgPT4ge1xuICAgICAgICAgICAgYXdhaXQgdGhpcy5fc3RhcnRUcmFuc2FjdGlvbkFjdGlvbihvcHRpb25zKVxuICAgICAgICAgIH0pXG4gICAgICAgICAgdGhpcy5fdHJhbnNhY3Rpb25zQ291bnQrK1xuXG4gICAgICAgICAgaWYgKHRoaXMuX3RyYW5zYWN0aW9uc0NvdW50ID09PSAxKSB7XG4gICAgICAgICAgICB0aGlzLl90cmFuc2FjdGlvbkNvbXBsZXRpb25Qcm9taXNlID0gbmV3IFByb21pc2UoKHJlc29sdmUpID0+IHtcbiAgICAgICAgICAgICAgdGhpcy5fcmVzb2x2ZVRyYW5zYWN0aW9uQ29tcGxldGlvbiA9IHJlc29sdmVcbiAgICAgICAgICAgIH0pXG4gICAgICAgICAgfVxuICAgICAgICB9KVxuXG4gICAgICAgIGlmICghYmxvY2tpbmdPcGVyYXRpb25MZWFzZSkgcmV0dXJuXG5cbiAgICAgICAgYXdhaXQgYmxvY2tpbmdPcGVyYXRpb25MZWFzZS53YWl0KG9wdGlvbnMub3BlcmF0aW9uT3duZXIpXG4gICAgICB9XG4gICAgfSwgb3B0aW9ucy5vcGVyYXRpb25Pd25lcilcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHN0YXJ0IHRyYW5zYWN0aW9uIGFjdGlvbi5cbiAgICogQHBhcmFtIHtQaWNrPFF1ZXJ5T3B0aW9ucywgXCJvcGVyYXRpb25Pd25lclwiPn0gW29wdGlvbnNdIC0gVHJhbnNhY3Rpb24gb3duZXJzaGlwLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyB3aGVuIGNvbXBsZXRlLlxuICAgKi9cbiAgYXN5bmMgX3N0YXJ0VHJhbnNhY3Rpb25BY3Rpb24ob3B0aW9ucyA9IHt9KSB7XG4gICAgYXdhaXQgdGhpcy5xdWVyeShcIkJFR0lOIFRSQU5TQUNUSU9OXCIsIG9wdGlvbnMpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBjb21taXQgdHJhbnNhY3Rpb24uXG4gICAqIEBwYXJhbSB7UGljazxRdWVyeU9wdGlvbnMsIFwib3BlcmF0aW9uT3duZXJcIj59IFtvcHRpb25zXSAtIFRyYW5zYWN0aW9uIG93bmVyc2hpcC5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgd2hlbiBjb21wbGV0ZS5cbiAgICovXG4gIGFzeW5jIGNvbW1pdFRyYW5zYWN0aW9uKG9wdGlvbnMgPSB7fSkge1xuICAgIGF3YWl0IGNvb3JkaW5hdGVTaGFyZWRUcmFuc2FjdGlvbkNvbm5lY3Rpb24odGhpcywgYXN5bmMgKCkgPT4ge1xuICAgICAgYXdhaXQgdGhpcy5fdHJhbnNhY3Rpb25zQWN0aW9uc011dGV4LnN5bmMoYXN5bmMgKCkgPT4ge1xuICAgICAgICBhd2FpdCB0aGlzLl9ydW5Qcm9maWxlZFRyYW5zYWN0aW9uQWN0aW9uKFwiY29tbWl0XCIsIGFzeW5jICgpID0+IHtcbiAgICAgICAgICBhd2FpdCB0aGlzLl9jb21taXRUcmFuc2FjdGlvbkFjdGlvbihvcHRpb25zKVxuICAgICAgICB9KVxuICAgICAgICB0aGlzLl90cmFuc2FjdGlvbnNDb3VudC0tXG4gICAgICAgIHRoaXMuX3Jlc29sdmVDb21wbGV0ZWRUcmFuc2FjdGlvbigpXG4gICAgICB9KVxuICAgIH0sIG9wdGlvbnMub3BlcmF0aW9uT3duZXIpXG4gIH1cblxuICAvKiogUmVzb2x2ZXMgdGhlIGN1cnJlbnQgb3V0ZXIgdHJhbnNhY3Rpb24gY29tcGxldGlvbiB3aGVuIGl0IGhhcyBmaW5pc2hlZC4gKi9cbiAgX3Jlc29sdmVDb21wbGV0ZWRUcmFuc2FjdGlvbigpIHtcbiAgICBpZiAodGhpcy5fdHJhbnNhY3Rpb25zQ291bnQgIT09IDApIHJldHVyblxuXG4gICAgY29uc3QgcmVzb2x2ZSA9IHRoaXMuX3Jlc29sdmVUcmFuc2FjdGlvbkNvbXBsZXRpb25cblxuICAgIHRoaXMuX3Jlc29sdmVUcmFuc2FjdGlvbkNvbXBsZXRpb24gPSB1bmRlZmluZWRcbiAgICBpZiAocmVzb2x2ZSkgcmVzb2x2ZSgpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBjb21taXQgdHJhbnNhY3Rpb24gYWN0aW9uLlxuICAgKiBAcGFyYW0ge1BpY2s8UXVlcnlPcHRpb25zLCBcIm9wZXJhdGlvbk93bmVyXCI+fSBbb3B0aW9uc10gLSBUcmFuc2FjdGlvbiBvd25lcnNoaXAuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIHdoZW4gY29tcGxldGUuXG4gICAqL1xuICBhc3luYyBfY29tbWl0VHJhbnNhY3Rpb25BY3Rpb24ob3B0aW9ucyA9IHt9KSB7XG4gICAgYXdhaXQgdGhpcy5xdWVyeShcIkNPTU1JVFwiLCBvcHRpb25zKVxuICB9XG5cbiAgLyoqXG4gICAqIFRpbWVzIGEgcGh5c2ljYWwgdHJhbnNhY3Rpb24gYWN0aW9uIG9ubHkgd2hlbiB0ZXN0IHByb2ZpbGluZyBpcyBhY3RpdmUuXG4gICAqIEB0ZW1wbGF0ZSBUXG4gICAqIEBwYXJhbSB7XCJzdGFydFwiIHwgXCJjb21taXRcIiB8IFwicm9sbGJhY2tcIn0gYWN0aW9uIC0gVHJhbnNhY3Rpb24gYWN0aW9uLlxuICAgKiBAcGFyYW0geygpID0+IFByb21pc2U8VD59IGNhbGxiYWNrIC0gUGh5c2ljYWwgYWN0aW9uIGNhbGxiYWNrLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxUPn0gLSBDYWxsYmFjayByZXN1bHQuXG4gICAqL1xuICBhc3luYyBfcnVuUHJvZmlsZWRUcmFuc2FjdGlvbkFjdGlvbihhY3Rpb24sIGNhbGxiYWNrKSB7XG4gICAgY29uc3QgcHJvZmlsZUNvbnRleHQgPSBjdXJyZW50VGVzdFByb2ZpbGVDb250ZXh0KHRoaXMuY29uZmlndXJhdGlvbilcblxuICAgIGlmICghcHJvZmlsZUNvbnRleHQpIHJldHVybiBhd2FpdCBjYWxsYmFjaygpXG5cbiAgICBjb25zdCBzdGFydGVkQXRNcyA9IG5vd01zKClcbiAgICBsZXQgZmFpbGVkID0gdHJ1ZVxuXG4gICAgdHJ5IHtcbiAgICAgIGNvbnN0IHJlc3VsdCA9IGF3YWl0IGNhbGxiYWNrKClcblxuICAgICAgZmFpbGVkID0gZmFsc2VcbiAgICAgIHJldHVybiByZXN1bHRcbiAgICB9IGZpbmFsbHkge1xuICAgICAgcHJvZmlsZUNvbnRleHQucHJvZmlsZXIucmVjb3JkRGF0YWJhc2VUcmFuc2FjdGlvbihwcm9maWxlQ29udGV4dCwge1xuICAgICAgICBhY3Rpb24sXG4gICAgICAgIGR1cmF0aW9uTXM6IG5vd01zKCkgLSBzdGFydGVkQXRNcyxcbiAgICAgICAgZmFpbGVkXG4gICAgICB9KVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBTdGFydHMgYW4gb3B0aW9uYWwgcGh5c2ljYWwtcXVlcnkgcHJvZmlsZSBhdHRlbXB0IHdpdGhvdXQgcmV0YWluaW5nIFNRTC5cbiAgICogQHBhcmFtIHtzdHJpbmd9IHNxbCAtIE9yaWdpbmFsIFNRTCB1c2VkIG9ubHkgdG8gZGVyaXZlIGl0cyByZWRhY3RlZCBkaWFnbm9zdGljLlxuICAgKiBAcmV0dXJucyB7VGVzdFByb2ZpbGVRdWVyeUF0dGVtcHQgfCB1bmRlZmluZWR9IC0gQWN0aXZlIHByb2ZpbGUgaGFuZGxlLlxuICAgKi9cbiAgX3N0YXJ0UHJvZmlsZWRRdWVyeUF0dGVtcHQoc3FsKSB7XG4gICAgY29uc3QgY29udGV4dCA9IGN1cnJlbnRUZXN0UHJvZmlsZUNvbnRleHQodGhpcy5jb25maWd1cmF0aW9uKVxuXG4gICAgaWYgKCFjb250ZXh0KSByZXR1cm4gdW5kZWZpbmVkXG5cbiAgICByZXR1cm4ge1xuICAgICAgY29udGV4dCxcbiAgICAgIGRpYWdub3N0aWM6IHNxbERpYWdub3N0aWMoc3FsKSxcbiAgICAgIHN0YXJ0ZWRBdE1zOiBub3dNcygpXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIENvbXBsZXRlcyBhbiBvcHRpb25hbCBwaHlzaWNhbC1xdWVyeSBwcm9maWxlIGF0dGVtcHQuXG4gICAqIEBwYXJhbSB7VGVzdFByb2ZpbGVRdWVyeUF0dGVtcHQgfCB1bmRlZmluZWR9IGF0dGVtcHQgLSBQcm9maWxlIGhhbmRsZS5cbiAgICogQHBhcmFtIHtib29sZWFufSBmYWlsZWQgLSBXaGV0aGVyIHRoZSBwaHlzaWNhbCBkcml2ZXIgY2FsbCBmYWlsZWQuXG4gICAqIEByZXR1cm5zIHt2b2lkfVxuICAgKi9cbiAgX2ZpbmlzaFByb2ZpbGVkUXVlcnlBdHRlbXB0KGF0dGVtcHQsIGZhaWxlZCkge1xuICAgIGlmICghYXR0ZW1wdCkgcmV0dXJuXG5cbiAgICBhdHRlbXB0LmNvbnRleHQucHJvZmlsZXIucmVjb3JkRGF0YWJhc2VRdWVyeShhdHRlbXB0LmNvbnRleHQsIHtcbiAgICAgIGR1cmF0aW9uTXM6IG5vd01zKCkgLSBhdHRlbXB0LnN0YXJ0ZWRBdE1zLFxuICAgICAgZmFpbGVkLFxuICAgICAgLi4uYXR0ZW1wdC5kaWFnbm9zdGljXG4gICAgfSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGV2ZXJ5IGd1YXJkIHJlZ2lzdGVyZWQgdG8gdGhlIHRyYW5zYWN0aW9uIGZyYW1lLlxuICAgKiBAcGFyYW0ge1RyYW5zYWN0aW9uQ2FsbGJhY2tGcmFtZX0gY2FsbGJhY2tGcmFtZSAtIEZyYW1lIHdob3NlIGd1YXJkcyBhcmUgY29tcGxldGluZy5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgd2hlbiBldmVyeSBndWFyZCBhY2NlcHRzIHRoZSBjb21taXQuXG4gICAqL1xuICBhc3luYyBfcnVuQmVmb3JlQ29tbWl0Q2FsbGJhY2tzKGNhbGxiYWNrRnJhbWUpIHtcbiAgICBmb3IgKGNvbnN0IGNhbGxiYWNrIG9mIGNhbGxiYWNrRnJhbWUuYmVmb3JlQ29tbWl0Q2FsbGJhY2tzKSB7XG4gICAgICBhd2FpdCBjYWxsYmFjaygpXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIE1lcmdlcyBjb21taXR0ZWQgY2FsbGJhY2tzIGludG8gdGhlIHBhcmVudCB0cmFuc2FjdGlvbiBmcmFtZSBvciBydW5zIHRoZW0gd2hlbiB0aGUgb3V0ZXJtb3N0IGNvbW1pdCBjb21wbGV0ZXMuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIHdoZW4gY29tcGxldGUuXG4gICAqL1xuICBhc3luYyBfY29tbWl0VHJhbnNhY3Rpb25DYWxsYmFja0ZyYW1lKCkge1xuICAgIGNvbnN0IGNvbW1pdHRlZEZyYW1lID0gdGhpcy5fdHJhbnNhY3Rpb25DYWxsYmFja0ZyYW1lcy5wb3AoKVxuXG4gICAgaWYgKCFjb21taXR0ZWRGcmFtZSB8fCBjb21taXR0ZWRGcmFtZS5hZnRlckNvbW1pdENhbGxiYWNrcy5sZW5ndGggPT09IDApIHJldHVyblxuXG4gICAgY29uc3QgcGFyZW50RnJhbWUgPSB0aGlzLl90cmFuc2FjdGlvbkNhbGxiYWNrRnJhbWVzW3RoaXMuX3RyYW5zYWN0aW9uQ2FsbGJhY2tGcmFtZXMubGVuZ3RoIC0gMV1cblxuICAgIGlmIChwYXJlbnRGcmFtZSkge1xuICAgICAgcGFyZW50RnJhbWUuYWZ0ZXJDb21taXRDYWxsYmFja3MucHVzaCguLi5jb21taXR0ZWRGcmFtZS5hZnRlckNvbW1pdENhbGxiYWNrcylcbiAgICAgIHJldHVyblxuICAgIH1cblxuICAgIGZvciAoY29uc3QgY2FsbGJhY2sgb2YgY29tbWl0dGVkRnJhbWUuYWZ0ZXJDb21taXRDYWxsYmFja3MpIHtcbiAgICAgIGF3YWl0IGNhbGxiYWNrKClcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogU3RyZWFtcyB0aGUgcm93cyBvZiBgc3FsYCBvbmUgYXQgYSB0aW1lIGluc3RlYWQgb2YgYnVmZmVyaW5nIHRoZSB3aG9sZSByZXN1bHQgc2V0LCBzbyBhXG4gICAqIGNhbGxlciBjYW4gcHJvY2VzcyBhbiBhcmJpdHJhcmlseSBsYXJnZSByZXN1bHQgd2l0aCBib3VuZGVkIG1lbW9yeS4gVGhpcyBiYXNlIGltcGxlbWVudGF0aW9uXG4gICAqIGZhbGxzIGJhY2sgdG8gYSBidWZmZXJlZCB7QGxpbmsgcXVlcnl9IGFuZCB5aWVsZHMgaXRzIHJvd3M7IGRyaXZlcnMgYmFja2VkIGJ5IGEgY3Vyc29yLWNhcGFibGVcbiAgICogY2xpZW50ICh0aGUgTXlTUUwgZHJpdmVyKSBvdmVycmlkZSBpdCB3aXRoIHRydWUgc2VydmVyLXNpZGUgc3RyZWFtaW5nLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gc3FsIC0gU1FMIHN0cmluZyB0byBzdHJlYW0uXG4gICAqIEBwYXJhbSB7UXVlcnlPcHRpb25zfSBbb3B0aW9uc10gLSBRdWVyeSBvcHRpb25zLCBhcyBmb3Ige0BsaW5rIHF1ZXJ5fS5cbiAgICogQHlpZWxkcyB7UmVjb3JkPHN0cmluZywgdW5rbm93bj59IC0gVGhlIHJlc3VsdCByb3dzLCBvbmUgYXQgYSB0aW1lLlxuICAgKi9cbiAgYXN5bmMgKnF1ZXJ5U3RyZWFtKHNxbCwgb3B0aW9ucyA9IHt9KSB7XG4gICAgY29uc3Qgcm93cyA9IGF3YWl0IHRoaXMucXVlcnkoc3FsLCBvcHRpb25zKVxuXG4gICAgZm9yIChjb25zdCByb3cgb2YgQXJyYXkuaXNBcnJheShyb3dzKSA/IHJvd3MgOiBbXSkge1xuICAgICAgeWllbGQgcm93XG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgcXVlcnkuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBzcWwgLSBTUUwgc3RyaW5nLlxuICAgKiBAcGFyYW0ge1F1ZXJ5T3B0aW9uc30gW29wdGlvbnNdIC0gUXVlcnkgb3B0aW9ucy5cbiAgICogQHJldHVybnMge1Byb21pc2U8UXVlcnlSZXN1bHRUeXBlPn0gLSBSZXNvbHZlcyB3aXRoIHRoZSBxdWVyeS5cbiAgICovXG4gIGFzeW5jIHF1ZXJ5KHNxbCwgb3B0aW9ucyA9IHt9KSB7XG4gICAgYXdhaXQgdGhpcy5fd2FpdEZvck9wZXJhdGlvbkxlYXNlKG9wdGlvbnMub3BlcmF0aW9uT3duZXIpXG4gICAgdGhpcy5fYXNzZXJ0V3JpdGFibGVRdWVyeShzcWwpXG5cbiAgICBsZXQgdHJpZXMgPSAwXG4gICAgY29uc3QgbWF4VHJpZXMgPSA1XG4gICAgY29uc3QgcmVxdWVzdFRpbWluZyA9IHRoaXMuY29uZmlndXJhdGlvbi5nZXRDdXJyZW50UmVxdWVzdFRpbWluZygpXG4gICAgY29uc3QgbG9nUXVlcnkgPSBvcHRpb25zLmxvZ1F1ZXJ5ID8/IHRoaXMuX3F1ZXJ5TG9nZ2luZ0VuYWJsZWQoKVxuICAgIGNvbnN0IHNvdXJjZVN0YWNrID0gbG9nUXVlcnkgPyAob3B0aW9ucy5zb3VyY2VTdGFjayB8fCBFcnJvcigpLnN0YWNrKSA6IHVuZGVmaW5lZFxuICAgIGNvbnN0IHF1ZXJ5U3FsID0gdGhpcy5fcXVlcnlTcWxXaXRoUHJvY2Vzc0xpc3RDb21tZW50KHNxbCwgb3B0aW9ucylcblxuICAgIHdoaWxlICh0cmllcyA8IG1heFRyaWVzKSB7XG4gICAgICB0cmllcysrXG5cbiAgICAgIHRyeSB7XG4gICAgICAgIHJldHVybiBhd2FpdCB0aGlzLl9xdWVyeUFjdHVhbFdpdGhMb2dnaW5nKHtvcmlnaW5hbFNxbDogc3FsLCBxdWVyeVNxbH0sIHsuLi5vcHRpb25zLCBsb2dRdWVyeSwgc291cmNlU3RhY2t9LCByZXF1ZXN0VGltaW5nLCB0cmllcylcbiAgICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICAgIGlmICghKGVycm9yIGluc3RhbmNlb2YgRXJyb3IpKSB0aHJvdyBlcnJvclxuXG4gICAgICAgIHRoaXMuX2ZhaWxlZFF1ZXJ5RGlhZ25vc3RpY3Muc2V0KGVycm9yLCBzcWxEaWFnbm9zdGljKHNxbCkpXG5cbiAgICAgICAgLy8gQSBkZWxpYmVyYXRlbHktYWJvcnRlZCBxdWVyeSBtdXN0IG5ldmVyIGJlIHNpbGVudGx5IHJlLXJ1biDigJQgaXRzXG4gICAgICAgIC8vIGNvbm5lY3Rpb24gd2FzIGRlc3Ryb3llZCBvbiBwdXJwb3NlLCBzbyB0cmVhdCBpdCBhcyB0ZXJtaW5hbC5cbiAgICAgICAgaWYgKGVycm9yIGluc3RhbmNlb2YgUXVlcnlBYm9ydGVkRXJyb3IpIHRocm93IGVycm9yXG5cbiAgICAgICAgY29uc3QgcmV0cnlJbmZvID0gdGhpcy5yZXRyeWFibGVEYXRhYmFzZUVycm9yKGVycm9yKVxuXG4gICAgICAgIGlmIChvcHRpb25zLnJldHJ5ICE9PSBmYWxzZSAmJiB0cmllcyA8IG1heFRyaWVzICYmIHJldHJ5SW5mby5yZXRyeSkge1xuICAgICAgICAgIGlmIChyZXRyeUluZm8ucmVjb25uZWN0KSB7XG4gICAgICAgICAgICBpZiAodGhpcy5fdHJhbnNhY3Rpb25zQ291bnQgPiAwKSB7XG4gICAgICAgICAgICAgIHRocm93IG5ldyBFcnJvcihgQ2Fubm90IHJlY29ubmVjdCB3aGlsZSBhIHRyYW5zYWN0aW9uIGlzIGFjdGl2ZSAoJHt0aGlzLl90cmFuc2FjdGlvbnNDb3VudH0pLiBPcmlnaW5hbCBlcnJvcjogJHtlcnJvci5tZXNzYWdlfWAsIHtjYXVzZTogZXJyb3J9KVxuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICBhd2FpdCB0aGlzLnJlY29ubmVjdCgpXG4gICAgICAgICAgfVxuXG4gICAgICAgICAgY29uc3Qgd2FpdE1zID0gdHlwZW9mIHJldHJ5SW5mby53YWl0TXMgPT09IFwibnVtYmVyXCIgJiYgTnVtYmVyLmlzRmluaXRlKHJldHJ5SW5mby53YWl0TXMpID8gcmV0cnlJbmZvLndhaXRNcyA6IDEwMFxuXG4gICAgICAgICAgaWYgKHdhaXRNcyA+IDApIGF3YWl0IHdhaXQod2FpdE1zKVxuICAgICAgICAgIGNvbnN0IHNlbnNpdGl2ZVZhbHVlcyA9IHJlcXVlc3RUaW1pbmcgPyByZXF1ZXN0VGltaW5nLmdldExvZ1NlbnNpdGl2ZVZhbHVlcygpIDogbmV3IFNldCgpXG4gICAgICAgICAgY29uc3QgbG9nZ2VkRXJyb3IgPSB0aGlzLmNvbmZpZ3VyYXRpb24uZ2V0TG9nUmVkYWN0b3IoKS5yZWRhY3RTdHJpbmcoZXJyb3Iuc3RhY2sgfHwgZXJyb3IubWVzc2FnZSwgc2Vuc2l0aXZlVmFsdWVzKVxuXG4gICAgICAgICAgdGhpcy5sb2dnZXIud2FybihgUmV0cnlpbmcgcXVlcnkgYmVjYXVzZSBmYWlsZWQgd2l0aDogJHtsb2dnZWRFcnJvcn1gKVxuICAgICAgICAgIC8vIFJldHJ5XG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgdGhyb3cgZXJyb3JcbiAgICAgICAgfVxuICAgICAgfVxuICAgIH1cblxuICAgIHRocm93IG5ldyBFcnJvcihcIidxdWVyeScgdW5leHBlY3RlZCBjYW1lIGhlcmVcIilcbiAgfVxuXG4gIC8qKlxuICAgKiBFeGVjdXRlcyBhIG11dGF0aW9uIGFuZCByZXR1cm5zIHRoZSBudW1iZXIgb2Ygcm93cyBjaGFuZ2VkIGJ5IHRoYXQgc3RhdGVtZW50LlxuICAgKiBAcGFyYW0ge3N0cmluZ30gc3FsIC0gTXV0YXRpb24gU1FMIHN0cmluZy5cbiAgICogQHBhcmFtIHtRdWVyeU9wdGlvbnN9IFtvcHRpb25zXSAtIFF1ZXJ5IG93bmVyc2hpcCBvcHRpb25zLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxudW1iZXI+fSAtIEFmZmVjdGVkIHJvdyBjb3VudC5cbiAgICovXG4gIGFzeW5jIGFmZmVjdGVkUm93cyhzcWwsIG9wdGlvbnMgPSB7fSkge1xuICAgIGF3YWl0IHRoaXMuX3dhaXRGb3JPcGVyYXRpb25MZWFzZShvcHRpb25zLm9wZXJhdGlvbk93bmVyKVxuICAgIHRoaXMuX2Fzc2VydFdyaXRhYmxlUXVlcnkoc3FsKVxuXG4gICAgcmV0dXJuIGF3YWl0IGNvb3JkaW5hdGVTaGFyZWRUcmFuc2FjdGlvbkNvbm5lY3Rpb24odGhpcywgYXN5bmMgKCkgPT4ge1xuICAgICAgYXdhaXQgdGhpcy5iZWZvcmVRdWVyeShzcWwsIG9wdGlvbnMpXG5cbiAgICAgIHRyeSB7XG4gICAgICAgIGNvbnN0IHByb2ZpbGVBdHRlbXB0ID0gdGhpcy5fc3RhcnRQcm9maWxlZFF1ZXJ5QXR0ZW1wdChzcWwpXG4gICAgICAgIGxldCBmYWlsZWQgPSB0cnVlXG5cbiAgICAgICAgdHJ5IHtcbiAgICAgICAgICBjb25zdCBhZmZlY3RlZFJvd3MgPSBhd2FpdCB0aGlzLl9ydW5QaHlzaWNhbENvbm5lY3Rpb25SZXF1ZXN0KFxuICAgICAgICAgICAgYXN5bmMgKCkgPT4gYXdhaXQgdGhpcy5fYWZmZWN0ZWRSb3dzQWN0dWFsKHNxbClcbiAgICAgICAgICApXG5cbiAgICAgICAgICBmYWlsZWQgPSBmYWxzZVxuICAgICAgICAgIHJldHVybiBhZmZlY3RlZFJvd3NcbiAgICAgICAgfSBmaW5hbGx5IHtcbiAgICAgICAgICB0aGlzLl9maW5pc2hQcm9maWxlZFF1ZXJ5QXR0ZW1wdChwcm9maWxlQXR0ZW1wdCwgZmFpbGVkKVxuICAgICAgICB9XG4gICAgICB9IGZpbmFsbHkge1xuICAgICAgICBhd2FpdCB0aGlzLmFmdGVyUXVlcnkoc3FsLCBvcHRpb25zKVxuICAgICAgfVxuICAgIH0sIG9wdGlvbnMub3BlcmF0aW9uT3duZXIpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBxdWVyeSBhY3R1YWwgd2l0aCBsb2dnaW5nLlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIE9wdGlvbnMgb2JqZWN0LlxuICAgKiBAcGFyYW0ge3N0cmluZ30gYXJncy5vcmlnaW5hbFNxbCAtIE9yaWdpbmFsIFNRTCBzdHJpbmcgYmVmb3JlIHByb2Nlc3MtbGlzdCBjb21tZW50cy5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGFyZ3MucXVlcnlTcWwgLSBTUUwgc3RyaW5nIHNlbnQgdG8gdGhlIGRhdGFiYXNlLlxuICAgKiBAcGFyYW0ge1F1ZXJ5T3B0aW9uc30gb3B0aW9ucyAtIFF1ZXJ5IG9wdGlvbnMuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vLi4vaHR0cC1zZXJ2ZXIvY2xpZW50L3JlcXVlc3QtdGltaW5nLmpzXCIpLmRlZmF1bHQgfCB1bmRlZmluZWR9IHJlcXVlc3RUaW1pbmcgLSBSZXF1ZXN0IHRpbWluZy5cbiAgICogQHBhcmFtIHtudW1iZXJ9IHRyaWVzIC0gUXVlcnkgYXR0ZW1wdCBjb3VudC5cbiAgICogQHJldHVybnMge1Byb21pc2U8UXVlcnlSZXN1bHRUeXBlPn0gLSBSZXNvbHZlcyB3aXRoIHRoZSBxdWVyeS5cbiAgICovXG4gIGFzeW5jIF9xdWVyeUFjdHVhbFdpdGhMb2dnaW5nKHtvcmlnaW5hbFNxbCwgcXVlcnlTcWx9LCBvcHRpb25zLCByZXF1ZXN0VGltaW5nLCB0cmllcykge1xuICAgIGNvbnN0IHN0YXJ0ZWRBdE1zID0gbm93TXMoKVxuICAgIGNvbnN0IHByZXZpb3VzQWN0aXZlUXVlcnkgPSB0aGlzLl9hY3RpdmVRdWVyeVxuICAgIHRoaXMuX2FjdGl2ZVF1ZXJ5ID0ge1xuICAgICAgYW5ub3RhdGlvbnM6IGdldERhdGFiYXNlQW5ub3RhdGlvbnMoKSxcbiAgICAgIGxvZ05hbWU6IG9wdGlvbnMubG9nTmFtZSB8fCBcIlNRTFwiLFxuICAgICAgc3FsUHJldmlldzogdGhpcy5fZGVidWdTcWxQcmV2aWV3KG9yaWdpbmFsU3FsKSxcbiAgICAgIHN0YXJ0ZWRBdFVuaXhNczogRGF0ZS5ub3coKVxuICAgIH1cbiAgICBsZXQgcmVzdWx0XG5cbiAgICB0cnkge1xuICAgICAgdHJ5IHtcbiAgICAgICAgY29uc3QgcnVuUXVlcnlBY3R1YWxXaXRoSG9va3MgPSBhc3luYyAoKSA9PiBhd2FpdCB0aGlzLl9xdWVyeUFjdHVhbFdpdGhIb29rcyhxdWVyeVNxbCwgb3B0aW9ucywgb3JpZ2luYWxTcWwpXG5cbiAgICAgICAgaWYgKHJlcXVlc3RUaW1pbmcgJiYgdHJpZXMgPT09IDEpIHtcbiAgICAgICAgICByZXN1bHQgPSBhd2FpdCByZXF1ZXN0VGltaW5nLm1lYXN1cmVEYlF1ZXJ5KHJ1blF1ZXJ5QWN0dWFsV2l0aEhvb2tzKVxuICAgICAgICB9IGVsc2UgaWYgKHJlcXVlc3RUaW1pbmcpIHtcbiAgICAgICAgICByZXN1bHQgPSBhd2FpdCByZXF1ZXN0VGltaW5nLm1lYXN1cmUoXCJkYlwiLCBydW5RdWVyeUFjdHVhbFdpdGhIb29rcylcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICByZXN1bHQgPSBhd2FpdCBydW5RdWVyeUFjdHVhbFdpdGhIb29rcygpXG4gICAgICAgIH1cbiAgICAgIH0gZmluYWxseSB7XG4gICAgICAgIHRoaXMuX2FjdGl2ZVF1ZXJ5ID0gcHJldmlvdXNBY3RpdmVRdWVyeVxuICAgICAgfVxuICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICBpZiAob3B0aW9ucy5sb2dRdWVyeSAhPT0gZmFsc2UpIHtcbiAgICAgICAgYXdhaXQgdGhpcy5fbG9nUXVlcnkoe1xuICAgICAgICAgIGVsYXBzZWRNczogbm93TXMoKSAtIHN0YXJ0ZWRBdE1zLFxuICAgICAgICAgIGVycm9yOiBlbnN1cmVFcnJvcihlcnJvciksXG4gICAgICAgICAgbG9nTmFtZTogb3B0aW9ucy5sb2dOYW1lIHx8IFwiU1FMXCIsXG4gICAgICAgICAgcmVxdWVzdFRpbWluZyxcbiAgICAgICAgICBzb3VyY2VTdGFjazogb3B0aW9ucy5zb3VyY2VTdGFjayxcbiAgICAgICAgICBzcWw6IG9yaWdpbmFsU3FsXG4gICAgICAgIH0pXG4gICAgICB9XG5cbiAgICAgIHRocm93IGVycm9yXG4gICAgfVxuXG4gICAgY29uc3QgZWxhcHNlZE1zID0gbm93TXMoKSAtIHN0YXJ0ZWRBdE1zXG5cbiAgICBpZiAob3B0aW9ucy5sb2dRdWVyeSAhPT0gZmFsc2UpIHtcbiAgICAgIGF3YWl0IHRoaXMuX2xvZ1F1ZXJ5KHtcbiAgICAgICAgZWxhcHNlZE1zLFxuICAgICAgICBsb2dOYW1lOiBvcHRpb25zLmxvZ05hbWUgfHwgXCJTUUxcIixcbiAgICAgICAgcmVxdWVzdFRpbWluZyxcbiAgICAgICAgc291cmNlU3RhY2s6IG9wdGlvbnMuc291cmNlU3RhY2ssXG4gICAgICAgIHNxbDogb3JpZ2luYWxTcWxcbiAgICAgIH0pXG4gICAgfVxuXG4gICAgaWYgKHRoaXMuX3NjaGVtYUNhY2hlSW52YWxpZGF0aW5nU3FsKG9yaWdpbmFsU3FsKSkge1xuICAgICAgdGhpcy5jbGVhclNjaGVtYUNhY2hlKClcbiAgICB9XG5cbiAgICByZXR1cm4gcmVzdWx0XG4gIH1cblxuICAvKipcbiAgICogUnVucyBxdWVyeSBhY3R1YWwgd2l0aCBiZWZvcmUvYWZ0ZXIgaG9va3MuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBzcWwgLSBTUUwgc3RyaW5nLlxuICAgKiBAcGFyYW0ge1F1ZXJ5T3B0aW9uc30gb3B0aW9ucyAtIFF1ZXJ5IG9wdGlvbnMuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBvcmlnaW5hbFNxbCAtIFNRTCBiZWZvcmUgcHJvY2Vzcy1saXN0IGNvbW1lbnRzLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxRdWVyeVJlc3VsdFR5cGU+fSAtIFJlc29sdmVzIHdpdGggdGhlIHF1ZXJ5LlxuICAgKi9cbiAgYXN5bmMgX3F1ZXJ5QWN0dWFsV2l0aEhvb2tzKHNxbCwgb3B0aW9ucywgb3JpZ2luYWxTcWwpIHtcbiAgICByZXR1cm4gYXdhaXQgY29vcmRpbmF0ZVNoYXJlZFRyYW5zYWN0aW9uQ29ubmVjdGlvbih0aGlzLCBhc3luYyAoKSA9PiB7XG4gICAgICBhd2FpdCB0aGlzLmJlZm9yZVF1ZXJ5KHNxbCwgb3B0aW9ucylcblxuICAgICAgdHJ5IHtcbiAgICAgICAgY29uc3QgcHJvZmlsZUF0dGVtcHQgPSB0aGlzLl9zdGFydFByb2ZpbGVkUXVlcnlBdHRlbXB0KG9yaWdpbmFsU3FsKVxuICAgICAgICBsZXQgZmFpbGVkID0gdHJ1ZVxuXG4gICAgICAgIHRyeSB7XG4gICAgICAgICAgY29uc3QgcmVzdWx0ID0gYXdhaXQgdGhpcy5fcnVuUGh5c2ljYWxDb25uZWN0aW9uUmVxdWVzdChcbiAgICAgICAgICAgIGFzeW5jICgpID0+IGF3YWl0IHRoaXMuX3F1ZXJ5QWN0dWFsKHNxbCwgb3B0aW9ucylcbiAgICAgICAgICApXG5cbiAgICAgICAgICBmYWlsZWQgPSBmYWxzZVxuICAgICAgICAgIHJldHVybiByZXN1bHRcbiAgICAgICAgfSBmaW5hbGx5IHtcbiAgICAgICAgICB0aGlzLl9maW5pc2hQcm9maWxlZFF1ZXJ5QXR0ZW1wdChwcm9maWxlQXR0ZW1wdCwgZmFpbGVkKVxuICAgICAgICB9XG4gICAgICB9IGZpbmFsbHkge1xuICAgICAgICBhd2FpdCB0aGlzLmFmdGVyUXVlcnkoc3FsLCBvcHRpb25zKVxuICAgICAgfVxuICAgIH0sIG9wdGlvbnMub3BlcmF0aW9uT3duZXIpXG4gIH1cblxuICAvKipcbiAgICogSG9vayB0aGF0IHJ1bnMgaW1tZWRpYXRlbHkgYmVmb3JlIGEgU1FMIHF1ZXJ5IGlzIHNlbnQgdG8gdGhlIGRyaXZlci5cbiAgICogQHBhcmFtIHtzdHJpbmd9IF9zcWwgLSBTUUwgc3RyaW5nLlxuICAgKiBAcGFyYW0ge1F1ZXJ5T3B0aW9uc30gX29wdGlvbnMgLSBRdWVyeSBvcHRpb25zLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyB3aGVuIGNvbXBsZXRlLlxuICAgKi9cbiAgYXN5bmMgYmVmb3JlUXVlcnkoX3NxbCwgX29wdGlvbnMpIHtcbiAgICAvLyBOby1vcCBieSBkZWZhdWx0XG4gIH1cblxuICAvKipcbiAgICogSG9vayB0aGF0IHJ1bnMgaW1tZWRpYXRlbHkgYWZ0ZXIgYSBTUUwgcXVlcnkgaGFzIGNvbXBsZXRlZCBvciBmYWlsZWQuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBfc3FsIC0gU1FMIHN0cmluZy5cbiAgICogQHBhcmFtIHtRdWVyeU9wdGlvbnN9IF9vcHRpb25zIC0gUXVlcnkgb3B0aW9ucy5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgd2hlbiBjb21wbGV0ZS5cbiAgICovXG4gIGFzeW5jIGFmdGVyUXVlcnkoX3NxbCwgX29wdGlvbnMpIHtcbiAgICAvLyBOby1vcCBieSBkZWZhdWx0XG4gIH1cblxuICAvKipcbiAgICogUnVucyBnZXQgZGVidWcgc25hcHNob3QuXG4gICAqIEByZXR1cm5zIHtEYXRhYmFzZUNvbm5lY3Rpb25EZWJ1Z1NuYXBzaG90fSAtIERpYWdub3N0aWMgc25hcHNob3QgZm9yIHRoaXMgY29ubmVjdGlvbi5cbiAgICovXG4gIGdldERlYnVnU25hcHNob3QoKSB7XG4gICAgY29uc3Qgbm93ID0gRGF0ZS5ub3coKVxuICAgIGNvbnN0IGFjdGl2ZVF1ZXJ5ID0gdGhpcy5fYWN0aXZlUXVlcnlcblxuICAgIHJldHVybiB7XG4gICAgICBhY3RpdmVRdWVyeTogYWN0aXZlUXVlcnkgPyB7Li4uYWN0aXZlUXVlcnksIHJ1bm5pbmdNczogTWF0aC5tYXgoMCwgbm93IC0gYWN0aXZlUXVlcnkuc3RhcnRlZEF0VW5peE1zKX0gOiBudWxsLFxuICAgICAgY2hlY2tvdXRBZ2VNczogdGhpcy5fY29ubmVjdGlvbkNoZWNrZWRPdXRBdFVuaXhNcyA/IE1hdGgubWF4KDAsIG5vdyAtIHRoaXMuX2Nvbm5lY3Rpb25DaGVja2VkT3V0QXRVbml4TXMpIDogdW5kZWZpbmVkLFxuICAgICAgY2hlY2tlZE91dEF0VW5peE1zOiB0aGlzLl9jb25uZWN0aW9uQ2hlY2tlZE91dEF0VW5peE1zLFxuICAgICAgY2hlY2tvdXROYW1lOiB0aGlzLl9jb25uZWN0aW9uQ2hlY2tvdXROYW1lLFxuICAgICAgZHJpdmVyQ2xhc3M6IHRoaXMuY29uc3RydWN0b3IubmFtZSxcbiAgICAgIGlkU2VxOiB0aGlzLmlkU2VxLFxuICAgICAgb3BlblRyYW5zYWN0aW9uczogdGhpcy5fdHJhbnNhY3Rpb25zQ291bnQsXG4gICAgICBzY2hlbWFDYWNoZUVudHJpZXM6IHRoaXMuX3NjaGVtYUNhY2hlLnNpemVcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogUmV0dXJucyBhIGJvdW5kZWQgcHJlZml4IG9mIGBzcWxgIGZvciBsaWdodHdlaWdodCBkaWFnbm9zdGljIHNjYW5uaW5nLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gc3FsIC0gU1FMIHN0cmluZy5cbiAgICogQHBhcmFtIHtudW1iZXJ9IGxpbWl0IC0gTWF4aW11bSBjb2RlIHVuaXRzIHRvIGluc3BlY3QuXG4gICAqIEByZXR1cm5zIHtzdHJpbmd9IC0gUHJlZml4IG9mIGBzcWxgLlxuICAgKi9cbiAgX2RpYWdub3N0aWNTcWxQcmVmaXgoc3FsLCBsaW1pdCkge1xuICAgIHJldHVybiBzcWwubGVuZ3RoIDw9IGxpbWl0ID8gc3FsIDogc3FsLnNsaWNlKDAsIGxpbWl0KVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZGVidWcgc3FsIHByZXZpZXcuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBzcWwgLSBTUUwgdG8gcHJldmlldy5cbiAgICogQHJldHVybnMge3N0cmluZ30gLSBOb3JtYWxpemVkIHRydW5jYXRlZCBTUUwgcHJldmlldyBmb3IgZGlhZ25vc3RpY3MuXG4gICAqL1xuICBfZGVidWdTcWxQcmV2aWV3KHNxbCkge1xuICAgIGNvbnN0IHByZWZpeCA9IHRoaXMuX2RpYWdub3N0aWNTcWxQcmVmaXgoc3FsLCBTUUxfUFJFVklFV19TQ0FOX0xJTUlUKVxuXG4gICAgcmV0dXJuIHByZWZpeFxuICAgICAgLnJlcGxhY2UoL1xccysvZywgXCIgXCIpXG4gICAgICAudHJpbSgpXG4gICAgICAuc2xpY2UoMCwgNTAwKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgcXVlcnkgc3FsIHdpdGggcHJvY2VzcyBsaXN0IGNvbW1lbnQuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBzcWwgLSBTUUwgc3RyaW5nLlxuICAgKiBAcGFyYW0ge1F1ZXJ5T3B0aW9uc30gb3B0aW9ucyAtIFF1ZXJ5IG9wdGlvbnMuXG4gICAqIEByZXR1cm5zIHtzdHJpbmd9IC0gU1FMIHN0cmluZyB3aXRoIGEgbGVhZGluZyBwcm9jZXNzLWxpc3QgY29tbWVudCB3aGVuIGFubm90YXRpb25zIGV4aXN0LlxuICAgKi9cbiAgX3F1ZXJ5U3FsV2l0aFByb2Nlc3NMaXN0Q29tbWVudChzcWwsIG9wdGlvbnMpIHtcbiAgICBpZiAob3B0aW9ucy5wcm9jZXNzTGlzdENvbW1lbnQgPT09IGZhbHNlKSByZXR1cm4gc3FsXG5cbiAgICBjb25zdCBwYXJ0cyA9IFtdXG5cbiAgICBpZiAodGhpcy5fY29ubmVjdGlvbkNoZWNrb3V0TmFtZSkge1xuICAgICAgcGFydHMucHVzaChgY2hlY2tvdXQ9XCIke3RoaXMuX3Byb2Nlc3NMaXN0Q29tbWVudFZhbHVlKHRoaXMuX2Nvbm5lY3Rpb25DaGVja291dE5hbWUpfVwiYClcbiAgICB9XG5cbiAgICBjb25zdCBhbm5vdGF0aW9ucyA9IGdldERhdGFiYXNlQW5ub3RhdGlvbnMoKVxuXG4gICAgaWYgKGFubm90YXRpb25zLmxlbmd0aCA+IDApIHtcbiAgICAgIHBhcnRzLnB1c2goYGFubm90YXRpb25zPVwiJHt0aGlzLl9wcm9jZXNzTGlzdENvbW1lbnRWYWx1ZShhbm5vdGF0aW9ucy5qb2luKFwiID4gXCIpKX1cImApXG4gICAgfVxuXG4gICAgaWYgKHBhcnRzLmxlbmd0aCA9PT0gMCkgcmV0dXJuIHNxbFxuXG4gICAgcmV0dXJuIGAvKiB2ZWxvY2lvdXMgJHtwYXJ0cy5qb2luKFwiIFwiKX0gKi8gJHtzcWx9YFxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgcHJvY2VzcyBsaXN0IGNvbW1lbnQgdmFsdWUuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSB2YWx1ZSAtIFJhdyBwcm9jZXNzLWxpc3QgY29tbWVudCB2YWx1ZS5cbiAgICogQHJldHVybnMge3N0cmluZ30gLSBTYW5pdGl6ZWQgcHJvY2Vzcy1saXN0IGNvbW1lbnQgdmFsdWUuXG4gICAqL1xuICBfcHJvY2Vzc0xpc3RDb21tZW50VmFsdWUodmFsdWUpIHtcbiAgICBsZXQgc2FuaXRpemVkID0gXCJcIlxuXG4gICAgZm9yIChjb25zdCBjaGFyYWN0ZXIgb2YgdmFsdWUpIHtcbiAgICAgIGNvbnN0IGNvZGVQb2ludCA9IGNoYXJhY3Rlci5jb2RlUG9pbnRBdCgwKVxuXG4gICAgICBzYW5pdGl6ZWQgKz0gY29kZVBvaW50ICE9PSB1bmRlZmluZWQgJiYgKGNvZGVQb2ludCA8IDMyIHx8IGNvZGVQb2ludCA9PT0gMTI3KSA/IFwiIFwiIDogY2hhcmFjdGVyXG4gICAgfVxuXG4gICAgcmV0dXJuIHNhbml0aXplZFxuICAgICAgLnJlcGxhY2UoL1xcKlxcLy9nLCBcIiogL1wiKVxuICAgICAgLnJlcGxhY2UoL1xccysvZywgXCIgXCIpXG4gICAgICAudHJpbSgpXG4gICAgICAuc2xpY2UoMCwgMjAwKVxuICAgICAgLnJlcGxhY2UoL1wiL2csIFwiJ1wiKVxuICB9XG5cbiAgLyoqXG4gICAqIFJlYWRzIHRoZSBuZXh0IFNRTCB0b2tlbiBzdGFydGluZyBhdCBgc3RhcnRJbmRleGAsIHNraXBwaW5nIGxlYWRpbmcgdHJpdmlhXG4gICAqIChCT00sIHdoaXRlc3BhY2UsIGJsb2NrIGNvbW1lbnRzLCBsaW5lIGNvbW1lbnRzKS4gSWYgdGhlIHNjYW4gY2Fubm90IGZpbmlzaFxuICAgKiBza2lwcGluZyB0cml2aWEgYmVmb3JlIGBsaW1pdGAsIHRoZSByZXN1bHQgaXMgbWFya2VkIGluY29tcGxldGUgc28gY2FsbGVyc1xuICAgKiBjYW4gY29uc2VydmF0aXZlbHkgdHJlYXQgdGhlIHN0YXRlbWVudCBhcyBzY2hlbWEtaW52YWxpZGF0aW5nLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gc3FsIC0gU1FMIHN0cmluZy5cbiAgICogQHBhcmFtIHtudW1iZXJ9IHN0YXJ0SW5kZXggLSBJbmRleCB0byBzdGFydCBzY2FubmluZy5cbiAgICogQHBhcmFtIHtudW1iZXJ9IGxpbWl0IC0gTWF4aW11bSBhYnNvbHV0ZSBpbmRleCB0byBzY2FuIHdoaWxlIHNraXBwaW5nIGxlYWRpbmcgdHJpdmlhLlxuICAgKiBAcmV0dXJucyB7U3FsVG9rZW5SZXN1bHR9IC0gVG9rZW4gcmVzdWx0LlxuICAgKi9cbiAgX3JlYWRTcWxUb2tlbihzcWwsIHN0YXJ0SW5kZXgsIGxpbWl0KSB7XG4gICAgbGV0IGkgPSBzdGFydEluZGV4XG4gICAgY29uc3QgbGVuID0gc3FsLmxlbmd0aFxuXG4gICAgd2hpbGUgKGkgPCBsZW4gJiYgaSA8IGxpbWl0KSB7XG4gICAgICBjb25zdCBjaGFyID0gc3FsW2ldXG5cbiAgICAgIGlmIChjaGFyID09PSBcIlxcdWZlZmZcIiB8fCAvXFxzLy50ZXN0KGNoYXIpKSB7XG4gICAgICAgIGkrK1xuICAgICAgICBjb250aW51ZVxuICAgICAgfVxuXG4gICAgICBpZiAoY2hhciA9PT0gXCIvXCIgJiYgc3FsW2kgKyAxXSA9PT0gXCIqXCIpIHtcbiAgICAgICAgY29uc3QgY2xvc2UgPSBzcWwuaW5kZXhPZihcIiovXCIsIGkgKyAyKVxuXG4gICAgICAgIGlmIChjbG9zZSA9PT0gLTEgfHwgY2xvc2UgKyAyID4gbGltaXQpIHtcbiAgICAgICAgICByZXR1cm4ge2luY29tcGxldGU6IHRydWUsIGluZGV4OiBpLCB0b2tlbjogdW5kZWZpbmVkfVxuICAgICAgICB9XG5cbiAgICAgICAgaSA9IGNsb3NlICsgMlxuICAgICAgICBjb250aW51ZVxuICAgICAgfVxuXG4gICAgICBpZiAoY2hhciA9PT0gXCItXCIgJiYgc3FsW2kgKyAxXSA9PT0gXCItXCIpIHtcbiAgICAgICAgY29uc3QgbmV3bGluZSA9IHNxbC5pbmRleE9mKFwiXFxuXCIsIGkgKyAyKVxuXG4gICAgICAgIGlmIChuZXdsaW5lID09PSAtMSkge1xuICAgICAgICAgIHJldHVybiB7aW5jb21wbGV0ZTogZmFsc2UsIGluZGV4OiBsZW4sIHRva2VuOiB1bmRlZmluZWR9XG4gICAgICAgIH1cblxuICAgICAgICBpZiAobmV3bGluZSArIDEgPiBsaW1pdCkge1xuICAgICAgICAgIHJldHVybiB7aW5jb21wbGV0ZTogdHJ1ZSwgaW5kZXg6IGksIHRva2VuOiB1bmRlZmluZWR9XG4gICAgICAgIH1cblxuICAgICAgICBpID0gbmV3bGluZSArIDFcbiAgICAgICAgY29udGludWVcbiAgICAgIH1cblxuICAgICAgbGV0IHRva2VuID0gXCJcIlxuXG4gICAgICB3aGlsZSAoaSA8IGxlbikge1xuICAgICAgICBjb25zdCBjID0gc3FsW2ldXG5cbiAgICAgICAgaWYgKC9cXHMvLnRlc3QoYykgfHwgYyA9PT0gXCJcXHVmZWZmXCIpIGJyZWFrXG4gICAgICAgIGlmIChjID09PSBcIi9cIiAmJiBzcWxbaSArIDFdID09PSBcIipcIikgYnJlYWtcbiAgICAgICAgaWYgKGMgPT09IFwiLVwiICYmIHNxbFtpICsgMV0gPT09IFwiLVwiKSBicmVha1xuXG4gICAgICAgIHRva2VuICs9IGNcbiAgICAgICAgaSsrXG4gICAgICB9XG5cbiAgICAgIHJldHVybiB7aW5jb21wbGV0ZTogZmFsc2UsIHRva2VuOiB0b2tlbi50b0xvd2VyQ2FzZSgpLCBpbmRleDogaX1cbiAgICB9XG5cbiAgICBpZiAoaSA+PSBsZW4pIHtcbiAgICAgIHJldHVybiB7aW5jb21wbGV0ZTogZmFsc2UsIGluZGV4OiBsZW4sIHRva2VuOiB1bmRlZmluZWR9XG4gICAgfVxuXG4gICAgcmV0dXJuIHtpbmNvbXBsZXRlOiB0cnVlLCBpbmRleDogaSwgdG9rZW46IHVuZGVmaW5lZH1cbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHNjaGVtYSBjYWNoZSBpbnZhbGlkYXRpbmcgc3FsLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gc3FsIC0gU1FMIHN0cmluZy5cbiAgICogQHJldHVybnMge2Jvb2xlYW59IC0gV2hldGhlciB0aGUgU1FMIHNob3VsZCBpbnZhbGlkYXRlIHNjaGVtYSBtZXRhZGF0YS5cbiAgICovXG4gIF9zY2hlbWFDYWNoZUludmFsaWRhdGluZ1NxbChzcWwpIHtcbiAgICBjb25zdCBmaXJzdCA9IHRoaXMuX3JlYWRTcWxUb2tlbihzcWwsIDAsIFNDSEVNQV9JTlZBTElEQVRJT05fU0NBTl9MSU1JVClcblxuICAgIGlmIChmaXJzdC5pbmNvbXBsZXRlKSByZXR1cm4gdHJ1ZVxuXG4gICAgY29uc3QgZmlyc3RUb2tlbiA9IGZpcnN0LnRva2VuXG5cbiAgICBpZiAoIWZpcnN0VG9rZW4pIHJldHVybiBmYWxzZVxuICAgIGlmICgvXihjcmVhdGV8YWx0ZXJ8ZHJvcHxyZW5hbWUpJC8udGVzdChmaXJzdFRva2VuKSkgcmV0dXJuIHRydWVcblxuICAgIGlmIChmaXJzdFRva2VuID09PSBcImNvbW1lbnRcIikge1xuICAgICAgY29uc3QgbmV4dCA9IHRoaXMuX3JlYWRTcWxUb2tlbihzcWwsIGZpcnN0LmluZGV4LCBTQ0hFTUFfSU5WQUxJREFUSU9OX1NDQU5fTElNSVQpXG5cbiAgICAgIHJldHVybiBuZXh0LmluY29tcGxldGUgfHwgbmV4dC50b2tlbiA9PT0gXCJvblwiXG4gICAgfVxuXG4gICAgaWYgKGZpcnN0VG9rZW4gPT09IFwiZXhlY1wiIHx8IGZpcnN0VG9rZW4gPT09IFwiZXhlY3V0ZVwiKSB7XG4gICAgICBjb25zdCBuZXh0ID0gdGhpcy5fcmVhZFNxbFRva2VuKHNxbCwgZmlyc3QuaW5kZXgsIFNDSEVNQV9JTlZBTElEQVRJT05fU0NBTl9MSU1JVClcblxuICAgICAgcmV0dXJuIG5leHQuaW5jb21wbGV0ZSB8fCBuZXh0LnRva2VuID09PSBcInNwX3JlbmFtZVwiXG4gICAgfVxuXG4gICAgaWYgKGZpcnN0VG9rZW4gPT09IFwiaWZcIikge1xuICAgICAgbGV0IGluZGV4ID0gZmlyc3QuaW5kZXhcblxuICAgICAgd2hpbGUgKHRydWUpIHtcbiAgICAgICAgY29uc3QgcmVzdWx0ID0gdGhpcy5fcmVhZFNxbFRva2VuKHNxbCwgaW5kZXgsIFNDSEVNQV9JTlZBTElEQVRJT05fU0NBTl9MSU1JVClcblxuICAgICAgICBpZiAocmVzdWx0LmluY29tcGxldGUpIHJldHVybiB0cnVlXG4gICAgICAgIGlmICghcmVzdWx0LnRva2VuKSByZXR1cm4gZmFsc2VcbiAgICAgICAgaWYgKHJlc3VsdC50b2tlbiA9PT0gXCJiZWdpblwiKSB7XG4gICAgICAgICAgY29uc3QgZGRsUmVzdWx0ID0gdGhpcy5fcmVhZFNxbFRva2VuKHNxbCwgcmVzdWx0LmluZGV4LCBTQ0hFTUFfSU5WQUxJREFUSU9OX1NDQU5fTElNSVQpXG5cbiAgICAgICAgICByZXR1cm4gZGRsUmVzdWx0LmluY29tcGxldGUgfHwgL14oY3JlYXRlfGFsdGVyfGRyb3B8cmVuYW1lKSQvLnRlc3QoZGRsUmVzdWx0LnRva2VuIHx8IFwiXCIpXG4gICAgICAgIH1cblxuICAgICAgICBpbmRleCA9IHJlc3VsdC5pbmRleFxuICAgICAgfVxuICAgIH1cblxuICAgIHJldHVybiBmYWxzZVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgcXVlcnkgbG9nZ2luZyBlbmFibGVkLlxuICAgKiBAcmV0dXJucyB7Ym9vbGVhbn0gLSBXaGV0aGVyIHF1ZXJ5IGxvZ2dpbmcgaXMgZW5hYmxlZCBmb3IgdGhpcyBkcml2ZXIuXG4gICAqL1xuICBfcXVlcnlMb2dnaW5nRW5hYmxlZCgpIHtcbiAgICBpZiAoIXRoaXMuY29uZmlndXJhdGlvbikgcmV0dXJuIHRydWVcbiAgICBpZiAoIXRoaXMuY29uZmlndXJhdGlvbi5nZXRRdWVyeUxvZ2dpbmdFbmFibGVkKCkpIHJldHVybiBmYWxzZVxuXG4gICAgY29uc3QgbG9nZ2VyID0gbmV3IExvZ2dlcihcIlNRTFwiLCB7Y29uZmlndXJhdGlvbjogdGhpcy5jb25maWd1cmF0aW9ufSlcblxuICAgIHJldHVybiBsb2dnZXIuaXNMZXZlbEVuYWJsZWQoXCJpbmZvXCIpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBsb2cgcXVlcnkuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gT3B0aW9ucyBvYmplY3QuXG4gICAqIEBwYXJhbSB7bnVtYmVyfSBhcmdzLmVsYXBzZWRNcyAtIEVsYXBzZWQgbWlsbGlzZWNvbmRzLlxuICAgKiBAcGFyYW0ge0Vycm9yfSBbYXJncy5lcnJvcl0gLSBRdWVyeSBmYWlsdXJlLCB3aGVuIHRoZSBkcml2ZXIgY2FsbCBmYWlsZWQuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBhcmdzLmxvZ05hbWUgLSBRdWVyeSBsb2cgc3ViamVjdC5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi8uLi9odHRwLXNlcnZlci9jbGllbnQvcmVxdWVzdC10aW1pbmcuanNcIikuZGVmYXVsdCB8IHVuZGVmaW5lZH0gYXJncy5yZXF1ZXN0VGltaW5nIC0gUmVxdWVzdCB0aW1pbmcuXG4gICAqIEBwYXJhbSB7c3RyaW5nIHwgdW5kZWZpbmVkfSBhcmdzLnNvdXJjZVN0YWNrIC0gU291cmNlIHN0YWNrLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gYXJncy5zcWwgLSBTUUwgc3RyaW5nLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyB3aGVuIGNvbXBsZXRlLlxuICAgKi9cbiAgYXN5bmMgX2xvZ1F1ZXJ5KHtlbGFwc2VkTXMsIGVycm9yLCBsb2dOYW1lLCByZXF1ZXN0VGltaW5nLCBzb3VyY2VTdGFjaywgc3FsfSkge1xuICAgIGNvbnN0IGxvZ2dlciA9IG5ldyBMb2dnZXIobG9nTmFtZSwge2NvbmZpZ3VyYXRpb246IHRoaXMuY29uZmlndXJhdGlvbn0pXG4gICAgY29uc3Qgc291cmNlTGluZSA9IHRoaXMuX3F1ZXJ5U291cmNlTGluZShzb3VyY2VTdGFjaylcbiAgICBjb25zdCBzZW5zaXRpdmVWYWx1ZXMgPSByZXF1ZXN0VGltaW5nID8gcmVxdWVzdFRpbWluZy5nZXRMb2dTZW5zaXRpdmVWYWx1ZXMoKSA6IG5ldyBTZXQoKVxuICAgIGNvbnN0IHJlZGFjdG9yID0gdGhpcy5jb25maWd1cmF0aW9uLmdldExvZ1JlZGFjdG9yKClcbiAgICBjb25zdCBsb2dnZWRTcWwgPSByZWRhY3Rvci5yZWRhY3RTdHJpbmcoc3FsLCBzZW5zaXRpdmVWYWx1ZXMpXG4gICAgY29uc3QgZmFpbHVyZSA9IGVycm9yXG4gICAgICA/IGAgRkFJTEVEICR7ZXJyb3IubmFtZX06ICR7cmVkYWN0b3IucmVkYWN0U3RyaW5nKGVycm9yLm1lc3NhZ2UsIHNlbnNpdGl2ZVZhbHVlcyl9YFxuICAgICAgOiBcIlwiXG4gICAgY29uc3QgbWVzc2FnZSA9IHNvdXJjZUxpbmVcbiAgICAgID8gYCgke2Zvcm1hdEVsYXBzZWRNcyhlbGFwc2VkTXMpfSkke2ZhaWx1cmV9ICAke2xvZ2dlZFNxbH1cXG4gIOKGsyAke3NvdXJjZUxpbmV9YFxuICAgICAgOiBgKCR7Zm9ybWF0RWxhcHNlZE1zKGVsYXBzZWRNcyl9KSR7ZmFpbHVyZX0gICR7bG9nZ2VkU3FsfWBcblxuICAgIGF3YWl0IGxvZ2dlci5pbmZvKG1lc3NhZ2UpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBxdWVyeSBzb3VyY2UgbGluZS5cbiAgICogQHBhcmFtIHtzdHJpbmcgfCB1bmRlZmluZWR9IHNvdXJjZVN0YWNrIC0gU291cmNlIHN0YWNrLlxuICAgKiBAcmV0dXJucyB7c3RyaW5nIHwgdW5kZWZpbmVkfSAtIFNvdXJjZSBsaW5lIHdoZW4gYW4gYXBwbGljYXRpb24gZnJhbWUgaXMgYXZhaWxhYmxlLlxuICAgKi9cbiAgX3F1ZXJ5U291cmNlTGluZShzb3VyY2VTdGFjaykge1xuICAgIGlmICghc291cmNlU3RhY2spIHJldHVybiB1bmRlZmluZWRcblxuICAgIGNvbnN0IGFwcGxpY2F0aW9uRGlyZWN0b3J5ID0gdGhpcy5jb25maWd1cmF0aW9uXG4gICAgICA/IHRoaXMuY29uZmlndXJhdGlvbi5nZXREaXJlY3RvcnlJZkF2YWlsYWJsZSgpXG4gICAgICA6IHVuZGVmaW5lZFxuXG4gICAgaWYgKCFhcHBsaWNhdGlvbkRpcmVjdG9yeSkgcmV0dXJuIHVuZGVmaW5lZFxuXG4gICAgY29uc3QgZXJyb3IgPSBuZXcgRXJyb3IoXCJRdWVyeSBzb3VyY2VcIilcblxuICAgIGVycm9yLnN0YWNrID0gc291cmNlU3RhY2tcblxuICAgIHJldHVybiBCYWNrdHJhY2VDbGVhbmVyLmdldEFwcGxpY2F0aW9uU291cmNlTGluZShlcnJvciwge1xuICAgICAgYXBwbGljYXRpb25EaXJlY3RvcnksXG4gICAgICBmcmFtZXdvcmtTb3VyY2VEaXJlY3Rvcnk6IHRoaXMuY29uZmlndXJhdGlvbi5nZXRFbnZpcm9ubWVudEhhbmRsZXIoKS5nZXRGcmFtZXdvcmtTb3VyY2VEaXJlY3RvcnkoKVxuICAgIH0pXG4gIH1cblxuICAvKipcbiAgICogUnVucyBxdWVyeSBhY3R1YWwuXG4gICAqIEBhYnN0cmFjdFxuICAgKiBAcGFyYW0ge3N0cmluZ30gc3FsIC0gU1FMIHN0cmluZy5cbiAgICogQHBhcmFtIHtRdWVyeU9wdGlvbnN9IFtvcHRpb25zXSAtIFF1ZXJ5IG9wdGlvbnMgKGNhcnJpZXMgdGhlIG9wdGlvbmFsIGFib3J0IHNpZ25hbCkuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPFF1ZXJ5UmVzdWx0VHlwZT59IC0gUmVzb2x2ZXMgd2l0aCB0aGUgcXVlcnkgYWN0dWFsLlxuICAgKi9cbiAgX3F1ZXJ5QWN0dWFsKHNxbCwgb3B0aW9ucykgeyAvLyBlc2xpbnQtZGlzYWJsZS1saW5lIG5vLXVudXNlZC12YXJzXG4gICAgdGhyb3cgbmV3IEVycm9yKGBxdWVyeUFjdHVhbCBub3QgaW1wbGVtZW50ZWRgKVxuICB9XG5cbiAgLyoqXG4gICAqIEV4ZWN1dGVzIGEgbXV0YXRpb24gYW5kIHJldHVybnMgaXRzIGFmZmVjdGVkIHJvdyBjb3VudC5cbiAgICogQGFic3RyYWN0XG4gICAqIEBwYXJhbSB7c3RyaW5nfSBzcWwgLSBNdXRhdGlvbiBTUUwgc3RyaW5nLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxudW1iZXI+fSAtIEFmZmVjdGVkIHJvdyBjb3VudC5cbiAgICovXG4gIF9hZmZlY3RlZFJvd3NBY3R1YWwoc3FsKSB7IC8vIGVzbGludC1kaXNhYmxlLWxpbmUgbm8tdW51c2VkLXZhcnNcbiAgICB0aHJvdyBuZXcgRXJyb3IoYGFmZmVjdGVkUm93c0FjdHVhbCBub3QgaW1wbGVtZW50ZWRgKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgcXVlcnkgdG8gc3FsLlxuICAgKiBAYWJzdHJhY3RcbiAgICogQHBhcmFtIHtRdWVyeX0gX3F1ZXJ5IC0gUXVlcnkgaW5zdGFuY2UuXG4gICAqIEByZXR1cm5zIHtzdHJpbmd9IC0gU1FMIHN0cmluZy5cbiAgICovXG4gIHF1ZXJ5VG9TcWwoX3F1ZXJ5KSB7IHRocm93IG5ldyBFcnJvcihcInF1ZXJ5VG9TcWwgbm90IGltcGxlbWVudGVkXCIpIH1cblxuICAvKipcbiAgICogUnVucyByZXRyeWFibGUgZGF0YWJhc2UgZXJyb3IuXG4gICAqIEBwYXJhbSB7RXJyb3J9IF9lcnJvciAtIEVycm9yIGluc3RhbmNlLlxuICAgKiBAcmV0dXJucyB7UmV0cnlhYmxlRGF0YWJhc2VFcnJvclJlc3VsdH0gLSBSZXRyeSBpbmZvLlxuICAgKi9cbiAgcmV0cnlhYmxlRGF0YWJhc2VFcnJvcihfZXJyb3IpIHtcbiAgICByZXR1cm4ge3JldHJ5OiBmYWxzZSwgcmVjb25uZWN0OiBmYWxzZX1cbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGFzc2VydCB3cml0YWJsZSBxdWVyeS5cbiAgICogQHBhcmFtIHtzdHJpbmd9IHNxbCAtIFNRTCBzdHJpbmcuXG4gICAqIEByZXR1cm5zIHt2b2lkfSAtIE5vIHJldHVybiB2YWx1ZS5cbiAgICovXG4gIF9hc3NlcnRXcml0YWJsZVF1ZXJ5KHNxbCkge1xuICAgIGlmICghdGhpcy5pc1JlYWRPbmx5KCkpIHJldHVyblxuICAgIGlmICghdGhpcy5fc3FsTG9va3NMaWtlV3JpdGUoc3FsKSkgcmV0dXJuXG5cbiAgICB0aHJvdyBuZXcgRXJyb3IoXCJEYXRhYmFzZSBpcyByZWFkLW9ubHlcIilcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGFzc2VydCBub3QgcmVhZCBvbmx5LlxuICAgKiBAcmV0dXJucyB7dm9pZH0gLSBObyByZXR1cm4gdmFsdWUuXG4gICAqL1xuICBfYXNzZXJ0Tm90UmVhZE9ubHkoKSB7XG4gICAgaWYgKHRoaXMuaXNSZWFkT25seSgpKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoXCJEYXRhYmFzZSBpcyByZWFkLW9ubHlcIilcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogUnVucyBzcWwgbG9va3MgbGlrZSB3cml0ZS5cbiAgICogQHBhcmFtIHtzdHJpbmd9IHNxbCAtIFNRTCBzdHJpbmcuXG4gICAqIEByZXR1cm5zIHtib29sZWFufSAtIFNRTCByZXByZXNlbnRhdGlvbi5cbiAgICovXG4gIF9zcWxMb29rc0xpa2VXcml0ZShzcWwpIHtcbiAgICBjb25zdCBub3JtYWxpemVkID0gc3FsLnRyaW0oKS50b0xvd2VyQ2FzZSgpXG5cbiAgICBpZiAoIW5vcm1hbGl6ZWQpIHJldHVybiBmYWxzZVxuXG4gICAgaWYgKFxuICAgICAgbm9ybWFsaXplZC5zdGFydHNXaXRoKFwic2VsZWN0XCIpIHx8XG4gICAgICBub3JtYWxpemVkLnN0YXJ0c1dpdGgoXCJzaG93XCIpIHx8XG4gICAgICBub3JtYWxpemVkLnN0YXJ0c1dpdGgoXCJwcmFnbWFcIikgfHxcbiAgICAgIG5vcm1hbGl6ZWQuc3RhcnRzV2l0aChcImV4cGxhaW5cIikgfHxcbiAgICAgIG5vcm1hbGl6ZWQuc3RhcnRzV2l0aChcImRlc2NyaWJlXCIpXG4gICAgKSB7XG4gICAgICByZXR1cm4gZmFsc2VcbiAgICB9XG5cbiAgICBpZiAobm9ybWFsaXplZC5zdGFydHNXaXRoKFwid2l0aFwiKSkge1xuICAgICAgY29uc3Qgd2l0aE1hdGNoID0gbm9ybWFsaXplZC5tYXRjaCgvXlxccyp3aXRoW1xcc1xcU10rP1xcKVxccyooc2VsZWN0fGluc2VydHx1cGRhdGV8ZGVsZXRlfG1lcmdlfHJlcGxhY2UpXFxiLylcblxuICAgICAgaWYgKHdpdGhNYXRjaCkge1xuICAgICAgICByZXR1cm4gd2l0aE1hdGNoWzFdICE9PSBcInNlbGVjdFwiXG4gICAgICB9XG5cbiAgICAgIHJldHVybiBmYWxzZVxuICAgIH1cblxuICAgIGNvbnN0IGtleXdvcmRNYXRjaCA9IG5vcm1hbGl6ZWQubWF0Y2goL15cXHMqKFxcdyspLylcbiAgICBjb25zdCBrZXl3b3JkID0ga2V5d29yZE1hdGNoID8ga2V5d29yZE1hdGNoWzFdIDogXCJcIlxuXG4gICAgcmV0dXJuIFtcbiAgICAgIFwiaW5zZXJ0XCIsXG4gICAgICBcInVwZGF0ZVwiLFxuICAgICAgXCJkZWxldGVcIixcbiAgICAgIFwiY3JlYXRlXCIsXG4gICAgICBcImFsdGVyXCIsXG4gICAgICBcImRyb3BcIixcbiAgICAgIFwidHJ1bmNhdGVcIixcbiAgICAgIFwibWVyZ2VcIixcbiAgICAgIFwicmVwbGFjZVwiXG4gICAgXS5pbmNsdWRlcyhrZXl3b3JkKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgaXMgcmVhZCBvbmx5LlxuICAgKiBAcmV0dXJucyB7Ym9vbGVhbn0gLSBXaGV0aGVyIHJlYWQgb25seS5cbiAgICovXG4gIGlzUmVhZE9ubHkoKSB7XG4gICAgcmV0dXJuIEJvb2xlYW4odGhpcy5nZXRBcmdzKCkucmVhZE9ubHkpXG4gIH1cblxuICAvKipcbiAgICogUnVucyByb2xsYmFjayB0cmFuc2FjdGlvbi5cbiAgICogQHBhcmFtIHtQaWNrPFF1ZXJ5T3B0aW9ucywgXCJvcGVyYXRpb25Pd25lclwiPn0gW29wdGlvbnNdIC0gVHJhbnNhY3Rpb24gb3duZXJzaGlwLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyB3aGVuIGNvbXBsZXRlLlxuICAgKi9cbiAgYXN5bmMgcm9sbGJhY2tUcmFuc2FjdGlvbihvcHRpb25zID0ge30pIHtcbiAgICBhd2FpdCBjb29yZGluYXRlU2hhcmVkVHJhbnNhY3Rpb25Db25uZWN0aW9uKHRoaXMsIGFzeW5jICgpID0+IHtcbiAgICAgIGF3YWl0IHRoaXMuX3RyYW5zYWN0aW9uc0FjdGlvbnNNdXRleC5zeW5jKGFzeW5jICgpID0+IHtcbiAgICAgICAgdHJ5IHtcbiAgICAgICAgICBhd2FpdCB0aGlzLl9ydW5Qcm9maWxlZFRyYW5zYWN0aW9uQWN0aW9uKFwicm9sbGJhY2tcIiwgYXN5bmMgKCkgPT4ge1xuICAgICAgICAgICAgYXdhaXQgdGhpcy5fcm9sbGJhY2tUcmFuc2FjdGlvbkFjdGlvbihvcHRpb25zKVxuICAgICAgICAgIH0pXG4gICAgICAgIH0gZmluYWxseSB7XG4gICAgICAgICAgLy8gRHJpdmVyIHJlY292ZXJ5IG1heSBuZWVkIHRvIGNsZWFyIGEgc3RhbGUgcGh5c2ljYWwgdHJhbnNhY3Rpb24gd2hlblxuICAgICAgICAgIC8vIG5vIGxvZ2ljYWwgdHJhbnNhY3Rpb24gaXMgYWN0aXZlLiBOZXZlciBsZXQgdGhhdCBjbGVhbnVwIHVuZGVyZmxvd1xuICAgICAgICAgIC8vIHRoZSBsb2dpY2FsIGRlcHRoIGFuZCB0dXJuIHRoZSBuZXh0IHJvb3QgdHJhbnNhY3Rpb24gaW50byBhIHNhdmVwb2ludC5cbiAgICAgICAgICBpZiAodGhpcy5fdHJhbnNhY3Rpb25zQ291bnQgPiAwKSB0aGlzLl90cmFuc2FjdGlvbnNDb3VudC0tXG4gICAgICAgICAgdGhpcy5fcmVzb2x2ZUNvbXBsZXRlZFRyYW5zYWN0aW9uKClcblxuICAgICAgICAgIC8vIEEgcm9sbGVkLWJhY2sgdHJhbnNhY3Rpb24gbWF5IGhhdmUgcmV2ZXJ0ZWQgRERMIChlLmcuIGEgQ1JFQVRFIFRBQkxFXG4gICAgICAgICAgLy8gcnVuIGxhemlseSBpbnNpZGUgdGhlIHRyYW5zYWN0aW9uKSwgc28gYW55IGNhY2hlZCBzY2hlbWEgbWV0YWRhdGEgaXNcbiAgICAgICAgICAvLyBub3cgc3RhbGUgYW5kIG11c3QgYmUgaW52YWxpZGF0ZWQuIFdpdGhvdXQgdGhpcywgYSBsYXRlciB0YWJsZUV4aXN0cygpXG4gICAgICAgICAgLy8gY2hlY2sgY2FuIHJlcG9ydCBhIHRhYmxlIHRoYXQgdGhlIHJvbGxiYWNrIGFscmVhZHkgcmVtb3ZlZCwgc28gY2FsbGVyc1xuICAgICAgICAgIC8vIHNraXAgcmVjcmVhdGluZyBpdCBhbmQgdGhlbiBmYWlsIHdpdGggXCJubyBzdWNoIHRhYmxlXCIuXG4gICAgICAgICAgdGhpcy5jbGVhclNjaGVtYUNhY2hlKClcbiAgICAgICAgfVxuICAgICAgfSlcbiAgICB9LCBvcHRpb25zLm9wZXJhdGlvbk93bmVyKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgcm9sbGJhY2sgdHJhbnNhY3Rpb24gYWN0aW9uLlxuICAgKiBAcGFyYW0ge1BpY2s8UXVlcnlPcHRpb25zLCBcIm9wZXJhdGlvbk93bmVyXCI+fSBbb3B0aW9uc10gLSBUcmFuc2FjdGlvbiBvd25lcnNoaXAuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIHdoZW4gY29tcGxldGUuXG4gICAqL1xuICBhc3luYyBfcm9sbGJhY2tUcmFuc2FjdGlvbkFjdGlvbihvcHRpb25zID0ge30pIHtcbiAgICBhd2FpdCB0aGlzLnF1ZXJ5KFwiUk9MTEJBQ0tcIiwgb3B0aW9ucylcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGdlbmVyYXRlIHNhdmUgcG9pbnQgbmFtZS5cbiAgICogQHJldHVybnMge3N0cmluZ30gLSBUaGUgZ2VuZXJhdGUgc2F2ZSBwb2ludCBuYW1lLlxuICAgKi9cbiAgZ2VuZXJhdGVTYXZlUG9pbnROYW1lKCkge1xuICAgIHJldHVybiBgc3Ake25ldyBVVUlEKDQpLmZvcm1hdCgpLnJlcGxhY2VBbGwoXCItXCIsIFwiXCIpfWBcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHN0YXJ0IHNhdmUgcG9pbnQuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBzYXZlUG9pbnROYW1lIC0gU2F2ZSBwb2ludCBuYW1lLlxuICAgKiBAcGFyYW0ge1BpY2s8UXVlcnlPcHRpb25zLCBcIm9wZXJhdGlvbk93bmVyXCI+fSBbb3B0aW9uc10gLSBUcmFuc2FjdGlvbiBvd25lcnNoaXAuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIHdoZW4gY29tcGxldGUuXG4gICAqL1xuICBhc3luYyBzdGFydFNhdmVQb2ludChzYXZlUG9pbnROYW1lLCBvcHRpb25zID0ge30pIHtcbiAgICBhd2FpdCBjb29yZGluYXRlU2hhcmVkVHJhbnNhY3Rpb25Db25uZWN0aW9uKHRoaXMsIGFzeW5jICgpID0+IHtcbiAgICAgIGF3YWl0IHRoaXMuX3RyYW5zYWN0aW9uc0FjdGlvbnNNdXRleC5zeW5jKGFzeW5jICgpID0+IHtcbiAgICAgICAgYXdhaXQgdGhpcy5fc3RhcnRTYXZlUG9pbnRBY3Rpb24oc2F2ZVBvaW50TmFtZSwgb3B0aW9ucylcbiAgICAgIH0pXG4gICAgfSwgb3B0aW9ucy5vcGVyYXRpb25Pd25lcilcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHN0YXJ0IHNhdmUgcG9pbnQgYWN0aW9uLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gc2F2ZVBvaW50TmFtZSAtIFNhdmUgcG9pbnQgbmFtZS5cbiAgICogQHBhcmFtIHtQaWNrPFF1ZXJ5T3B0aW9ucywgXCJvcGVyYXRpb25Pd25lclwiPn0gW29wdGlvbnNdIC0gVHJhbnNhY3Rpb24gb3duZXJzaGlwLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyB3aGVuIGNvbXBsZXRlLlxuICAgKi9cbiAgYXN5bmMgX3N0YXJ0U2F2ZVBvaW50QWN0aW9uKHNhdmVQb2ludE5hbWUsIG9wdGlvbnMgPSB7fSkge1xuICAgIGF3YWl0IHRoaXMucXVlcnkoYFNBVkVQT0lOVCAke3NhdmVQb2ludE5hbWV9YCwgb3B0aW9ucylcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHJlbmFtZSBjb2x1bW4uXG4gICAqIEBwYXJhbSB7c3RyaW5nfSB0YWJsZU5hbWUgLSBUYWJsZSBuYW1lLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gb2xkQ29sdW1uTmFtZSAtIFByZXZpb3VzIGNvbHVtbiBuYW1lLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gbmV3Q29sdW1uTmFtZSAtIE5ldyBjb2x1bW4gbmFtZS5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgd2hlbiBjb21wbGV0ZS5cbiAgICovXG4gIGFzeW5jIHJlbmFtZUNvbHVtbih0YWJsZU5hbWUsIG9sZENvbHVtbk5hbWUsIG5ld0NvbHVtbk5hbWUpIHtcbiAgICB0aGlzLl9hc3NlcnROb3RSZWFkT25seSgpXG4gICAgY29uc3QgdGFibGVDb2x1bW4gPSBuZXcgVGFibGVDb2x1bW4ob2xkQ29sdW1uTmFtZSlcblxuICAgIHRhYmxlQ29sdW1uLnNldE5ld05hbWUobmV3Q29sdW1uTmFtZSlcblxuICAgIGNvbnN0IHRhYmxlRGF0YSA9IG5ldyBUYWJsZURhdGEodGFibGVOYW1lKVxuXG4gICAgdGFibGVEYXRhLmFkZENvbHVtbih0YWJsZUNvbHVtbilcblxuICAgIGNvbnN0IGFsdGVyVGFibGVTUUxzID0gYXdhaXQgdGhpcy5hbHRlclRhYmxlU1FMcyh0YWJsZURhdGEpXG5cbiAgICBmb3IgKGNvbnN0IGFsdGVyVGFibGVTUUwgb2YgYWx0ZXJUYWJsZVNRTHMpIHtcbiAgICAgIGF3YWl0IHRoaXMucXVlcnkoYWx0ZXJUYWJsZVNRTClcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogUnVucyByZWxlYXNlIHNhdmUgcG9pbnQuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBzYXZlUG9pbnROYW1lIC0gU2F2ZSBwb2ludCBuYW1lLlxuICAgKiBAcGFyYW0ge1BpY2s8UXVlcnlPcHRpb25zLCBcIm9wZXJhdGlvbk93bmVyXCI+fSBbb3B0aW9uc10gLSBUcmFuc2FjdGlvbiBvd25lcnNoaXAuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIHdoZW4gY29tcGxldGUuXG4gICAqL1xuICBhc3luYyByZWxlYXNlU2F2ZVBvaW50KHNhdmVQb2ludE5hbWUsIG9wdGlvbnMgPSB7fSkge1xuICAgIGF3YWl0IGNvb3JkaW5hdGVTaGFyZWRUcmFuc2FjdGlvbkNvbm5lY3Rpb24odGhpcywgYXN5bmMgKCkgPT4ge1xuICAgICAgYXdhaXQgdGhpcy5fdHJhbnNhY3Rpb25zQWN0aW9uc011dGV4LnN5bmMoYXN5bmMgKCkgPT4ge1xuICAgICAgICBhd2FpdCB0aGlzLl9yZWxlYXNlU2F2ZVBvaW50QWN0aW9uKHNhdmVQb2ludE5hbWUsIG9wdGlvbnMpXG4gICAgICB9KVxuICAgIH0sIG9wdGlvbnMub3BlcmF0aW9uT3duZXIpXG4gIH1cblxuICAvKipcbiAgICogUnVucyByZWxlYXNlIHNhdmUgcG9pbnQgYWN0aW9uLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gc2F2ZVBvaW50TmFtZSAtIFNhdmUgcG9pbnQgbmFtZS5cbiAgICogQHBhcmFtIHtQaWNrPFF1ZXJ5T3B0aW9ucywgXCJvcGVyYXRpb25Pd25lclwiPn0gW29wdGlvbnNdIC0gVHJhbnNhY3Rpb24gb3duZXJzaGlwLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyB3aGVuIGNvbXBsZXRlLlxuICAgKi9cbiAgYXN5bmMgX3JlbGVhc2VTYXZlUG9pbnRBY3Rpb24oc2F2ZVBvaW50TmFtZSwgb3B0aW9ucyA9IHt9KSB7XG4gICAgdHJ5IHtcbiAgICAgIGF3YWl0IHRoaXMucXVlcnkoYFJFTEVBU0UgU0FWRVBPSU5UICR7c2F2ZVBvaW50TmFtZX1gLCBvcHRpb25zKVxuICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICBjb25zdCBtZXNzYWdlID0gZXJyb3IgaW5zdGFuY2VvZiBFcnJvciA/IGVycm9yLm1lc3NhZ2UgOiBgJHtlcnJvcn1gXG5cbiAgICAgIC8vIFNhdmVwb2ludCBtYXkgYWxyZWFkeSBiZSBnb25lIGlmIHRoZSBkYXRhYmFzZSByb2xsZWQgYmFjayBhdXRvbWF0aWNhbGx5XG4gICAgICBpZiAobWVzc2FnZS50b0xvd2VyQ2FzZSgpLmluY2x1ZGVzKFwic2F2ZXBvaW50XCIpICYmIG1lc3NhZ2UudG9Mb3dlckNhc2UoKS5pbmNsdWRlcyhcImRvZXMgbm90IGV4aXN0XCIpKSB7XG4gICAgICAgIHRoaXMubG9nZ2VyLmRlYnVnKGBSZWxlYXNlIHNhdmVwb2ludCBpZ25vcmVkIGJlY2F1c2UgaXQgbm8gbG9uZ2VyIGV4aXN0czogJHtzYXZlUG9pbnROYW1lfWApXG4gICAgICAgIHJldHVyblxuICAgICAgfVxuXG4gICAgICB0aHJvdyBlcnJvclxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHJvbGxiYWNrIHNhdmUgcG9pbnQuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBzYXZlUG9pbnROYW1lIC0gU2F2ZSBwb2ludCBuYW1lLlxuICAgKiBAcGFyYW0ge1BpY2s8UXVlcnlPcHRpb25zLCBcIm9wZXJhdGlvbk93bmVyXCI+fSBbb3B0aW9uc10gLSBUcmFuc2FjdGlvbiBvd25lcnNoaXAuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIHdoZW4gY29tcGxldGUuXG4gICAqL1xuICBhc3luYyByb2xsYmFja1NhdmVQb2ludChzYXZlUG9pbnROYW1lLCBvcHRpb25zID0ge30pIHtcbiAgICBhd2FpdCBjb29yZGluYXRlU2hhcmVkVHJhbnNhY3Rpb25Db25uZWN0aW9uKHRoaXMsIGFzeW5jICgpID0+IHtcbiAgICAgIGF3YWl0IHRoaXMuX3RyYW5zYWN0aW9uc0FjdGlvbnNNdXRleC5zeW5jKGFzeW5jICgpID0+IHtcbiAgICAgICAgYXdhaXQgdGhpcy5fcm9sbGJhY2tTYXZlUG9pbnRBY3Rpb24oc2F2ZVBvaW50TmFtZSwgb3B0aW9ucylcbiAgICAgIH0pXG4gICAgfSwgb3B0aW9ucy5vcGVyYXRpb25Pd25lcilcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHJvbGxiYWNrIHNhdmUgcG9pbnQgYWN0aW9uLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gc2F2ZVBvaW50TmFtZSAtIFNhdmUgcG9pbnQgbmFtZS5cbiAgICogQHBhcmFtIHtQaWNrPFF1ZXJ5T3B0aW9ucywgXCJvcGVyYXRpb25Pd25lclwiPn0gW29wdGlvbnNdIC0gVHJhbnNhY3Rpb24gb3duZXJzaGlwLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyB3aGVuIGNvbXBsZXRlLlxuICAgKi9cbiAgYXN5bmMgX3JvbGxiYWNrU2F2ZVBvaW50QWN0aW9uKHNhdmVQb2ludE5hbWUsIG9wdGlvbnMgPSB7fSkge1xuICAgIGF3YWl0IHRoaXMucXVlcnkoYFJPTExCQUNLIFRPIFNBVkVQT0lOVCAke3NhdmVQb2ludE5hbWV9YCwgb3B0aW9ucylcbiAgfVxuXG4gIC8qKlxuICAgKiBUcnVuY2F0ZXMgdGhlIGdpdmVuIHRhYmxlIHNuYXBzaG90LiBEcml2ZXJzIGNhbiBvdmVycmlkZSB0aGlzIHRvIGlzc3VlIG9uZSBiYXRjaC5cbiAgICogQHByb3RlY3RlZFxuICAgKiBAcGFyYW0ge0FycmF5PGltcG9ydChcIi4vYmFzZS10YWJsZS5qc1wiKS5kZWZhdWx0Pn0gdGFibGVzIC0gRWxpZ2libGUgdGFibGVzIGZvciB0aGlzIGNsZWFudXAgYXR0ZW1wdC5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgd2hlbiBldmVyeSB0YWJsZSBoYXMgYmVlbiBjbGVhbmVkLlxuICAgKi9cbiAgYXN5bmMgdHJ1bmNhdGVUYWJsZXModGFibGVzKSB7XG4gICAgY29uc3QgdHJ1bmNhdGVFcnJvcnMgPSBbXVxuXG4gICAgZm9yIChjb25zdCB0YWJsZSBvZiB0YWJsZXMpIHtcbiAgICAgIHRyeSB7XG4gICAgICAgIGF3YWl0IHRhYmxlLnRydW5jYXRlKHtjYXNjYWRlOiB0cnVlfSlcbiAgICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICAgIHRydW5jYXRlRXJyb3JzLnB1c2goZXJyb3IpXG4gICAgICB9XG4gICAgfVxuXG4gICAgaWYgKHRydW5jYXRlRXJyb3JzLmxlbmd0aCA+IDApIHRocm93IHRydW5jYXRlRXJyb3JzWzBdXG4gIH1cblxuICAvKipcbiAgICogUnVucyB0cnVuY2F0ZSBhbGwgdGFibGVzLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyB3aGVuIGNvbXBsZXRlLlxuICAgKi9cbiAgYXN5bmMgdHJ1bmNhdGVBbGxUYWJsZXMoKSB7XG4gICAgdGhpcy5fYXNzZXJ0Tm90UmVhZE9ubHkoKVxuICAgIGNvbnN0IHRhYmxlcyA9IChhd2FpdCB0aGlzLmdldFRhYmxlcygpKS5maWx0ZXIoKHRhYmxlKSA9PiB0YWJsZS5nZXROYW1lKCkgIT0gXCJzY2hlbWFfbWlncmF0aW9uc1wiKVxuXG4gICAgaWYgKHRhYmxlcy5sZW5ndGggPT0gMCkgcmV0dXJuXG5cbiAgICBhd2FpdCB0aGlzLl90cnVuY2F0ZUFsbFRhYmxlcyh0YWJsZXMpXG4gICAgYXdhaXQgdGhpcy5mbHVzaFBlbmRpbmdXcml0ZXMoKVxuICB9XG5cbiAgLyoqXG4gICAqIE93bnMgdGhlIGZvcmVpZ24ta2V5IGJvdW5kYXJ5IGFyb3VuZCBldmVyeSBjbGVhbnVwIHJldHJ5LiBEcml2ZXJzIHRoYXRcbiAgICogcmVxdWlyZSBvbmUgcGh5c2ljYWwgcmVxdWVzdCBmb3IgdGhlIGZ1bGwgb3BlcmF0aW9uIG1heSBvdmVycmlkZSBpdC5cbiAgICogQHByb3RlY3RlZFxuICAgKiBAcGFyYW0ge0FycmF5PGltcG9ydChcIi4vYmFzZS10YWJsZS5qc1wiKS5kZWZhdWx0Pn0gdGFibGVzIC0gRWxpZ2libGUgdGFibGVzLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyBhZnRlciBjbGVhbnVwIHN1Y2NlZWRzLlxuICAgKi9cbiAgYXN5bmMgX3RydW5jYXRlQWxsVGFibGVzKHRhYmxlcykge1xuICAgIGF3YWl0IHRoaXMud2l0aERpc2FibGVkRm9yZWlnbktleXMoYXN5bmMgKCkgPT4ge1xuICAgICAgYXdhaXQgdGhpcy5fdHJ1bmNhdGVBbGxUYWJsZXNXaXRoUmV0cmllcyh0YWJsZXMpXG4gICAgfSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSZXRyaWVzIGNsZWFudXAgYWdhaW5zdCByZWZyZXNoZWQgc2NoZW1hIHNuYXBzaG90cy4gRHJpdmVycyBtYXkgb3ZlcnJpZGVcbiAgICogYF90cnVuY2F0ZUFsbFRhYmxlc0F0dGVtcHRgIHRvIG93biBhIGNvbXBsZXRlIGRyaXZlci1zcGVjaWZpYyBhdHRlbXB0LlxuICAgKiBAcHJvdGVjdGVkXG4gICAqIEBwYXJhbSB7QXJyYXk8aW1wb3J0KFwiLi9iYXNlLXRhYmxlLmpzXCIpLmRlZmF1bHQ+fSBpbml0aWFsVGFibGVzIC0gSW5pdGlhbCBlbGlnaWJsZSB0YWJsZXMuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIGFmdGVyIG9uZSBjbGVhbnVwIGF0dGVtcHQgc3VjY2VlZHMuXG4gICAqL1xuICBhc3luYyBfdHJ1bmNhdGVBbGxUYWJsZXNXaXRoUmV0cmllcyhpbml0aWFsVGFibGVzKSB7XG4gICAgbGV0IHRhYmxlcyA9IGluaXRpYWxUYWJsZXNcblxuICAgIGZvciAobGV0IHRyaWVzID0gMTsgdHJpZXMgPD0gNjsgdHJpZXMrKykge1xuICAgICAgdHJ5IHtcbiAgICAgICAgYXdhaXQgdGhpcy5fdHJ1bmNhdGVBbGxUYWJsZXNBdHRlbXB0KHRhYmxlcylcbiAgICAgICAgcmV0dXJuXG4gICAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgICBjb25zb2xlLmVycm9yKGVycm9yKVxuXG4gICAgICAgIGlmICh0cmllcyA9PSA2KSB0aHJvdyBlcnJvclxuXG4gICAgICAgIC8vIEEgdHJ1bmNhdGUgZmFpbGVkIOKAlCB0aGUgc2NoZW1hIGNhY2hlIG1heSBzdGlsbCBsaXN0IGEgdGFibGUgdGhhdCB3YXNcbiAgICAgICAgLy8gZHJvcHBlZCBvdXQgZnJvbSB1bmRlciB1cyAoZS5nLiBhIGRiOnJvbGxiYWNrIHRlc3QgdGhhdCBsZWZ0IHRoZVxuICAgICAgICAvLyBzaGFyZWQgREIgcm9sbGVkIGJhY2spLiBDbGVhciBpdCBzbyB0aGUgbmV4dCBwYXNzIHJlLXJlYWRzIHRoZSBsaXZlXG4gICAgICAgIC8vIHRhYmxlIGxpc3QgYW5kIG5vIGxvbmdlciB0cmllcyB0byB0cnVuY2F0ZSBhIHRhYmxlIHRoYXQgaXMgZ29uZS5cbiAgICAgICAgdGhpcy5jbGVhclNjaGVtYUNhY2hlKClcbiAgICAgICAgdGFibGVzID0gKGF3YWl0IHRoaXMuZ2V0VGFibGVzKCkpLmZpbHRlcigodGFibGUpID0+IHRhYmxlLmdldE5hbWUoKSAhPSBcInNjaGVtYV9taWdyYXRpb25zXCIpXG5cbiAgICAgICAgaWYgKHRhYmxlcy5sZW5ndGggPT0gMCkgcmV0dXJuXG4gICAgICB9XG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgb25lIGNsZWFudXAgYXR0ZW1wdCB3aGlsZSB0aGUgZGVmYXVsdCBvd25lciBoYXMgY29uc3RyYWludHMgZGlzYWJsZWQuXG4gICAqIEBwcm90ZWN0ZWRcbiAgICogQHBhcmFtIHtBcnJheTxpbXBvcnQoXCIuL2Jhc2UtdGFibGUuanNcIikuZGVmYXVsdD59IHRhYmxlcyAtIEN1cnJlbnQgZWxpZ2libGUgdGFibGVzLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyB3aGVuIHRoZSBhdHRlbXB0IGNvbXBsZXRlcy5cbiAgICovXG4gIGFzeW5jIF90cnVuY2F0ZUFsbFRhYmxlc0F0dGVtcHQodGFibGVzKSB7XG4gICAgYXdhaXQgdGhpcy50cnVuY2F0ZVRhYmxlcyh0YWJsZXMpXG4gIH1cblxuICAvKipcbiAgICogUnVucyB1cGRhdGUuXG4gICAqIEBwYXJhbSB7VXBkYXRlU3FsQXJnc1R5cGV9IGFyZ3MgLSBPcHRpb25zIG9iamVjdC5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgd2hlbiBjb21wbGV0ZS5cbiAgICovXG4gIGFzeW5jIHVwZGF0ZShhcmdzKSB7XG4gICAgdGhpcy5fYXNzZXJ0Tm90UmVhZE9ubHkoKVxuICAgIGNvbnN0IHNxbCA9IHRoaXMudXBkYXRlU3FsKGFyZ3MpXG5cbiAgICBhd2FpdCB0aGlzLnF1ZXJ5KHNxbClcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHVwZGF0ZSBzcWwuXG4gICAqIEBhYnN0cmFjdFxuICAgKiBAcGFyYW0ge1VwZGF0ZVNxbEFyZ3NUeXBlfSBhcmdzIC0gT3B0aW9ucyBvYmplY3QuXG4gICAqIEByZXR1cm5zIHtzdHJpbmd9IC0gU1FMIHN0cmluZy5cbiAgICovXG4gIHVwZGF0ZVNxbChhcmdzKSB7IC8vIGVzbGludC1kaXNhYmxlLWxpbmUgbm8tdW51c2VkLXZhcnNcbiAgICB0aHJvdyBuZXcgRXJyb3IoXCInZGlzYWJsZUZvcmVpZ25LZXlzJyBub3QgaW1wbGVtZW50ZWRcIilcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHVwc2VydCBzcWwuXG4gICAqIEBhYnN0cmFjdFxuICAgKiBAcGFyYW0ge1Vwc2VydFNxbEFyZ3NUeXBlfSBhcmdzIC0gT3B0aW9ucyBvYmplY3QuXG4gICAqIEByZXR1cm5zIHtzdHJpbmd9IC0gU1FMIHN0cmluZy5cbiAgICovXG4gIHVwc2VydFNxbChhcmdzKSB7IC8vIGVzbGludC1kaXNhYmxlLWxpbmUgbm8tdW51c2VkLXZhcnNcbiAgICB0aHJvdyBuZXcgRXJyb3IoXCIndXBzZXJ0U3FsJyBub3QgaW1wbGVtZW50ZWRcIilcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGRpc2FibGUgZm9yZWlnbiBrZXlzLlxuICAgKiBAYWJzdHJhY3RcbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgd2hlbiBjb21wbGV0ZS5cbiAgICovXG4gIGRpc2FibGVGb3JlaWduS2V5cygpIHtcbiAgICB0aHJvdyBuZXcgRXJyb3IoXCInZGlzYWJsZUZvcmVpZ25LZXlzJyBub3QgaW1wbGVtZW50ZWRcIilcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGVuYWJsZSBmb3JlaWduIGtleXMuXG4gICAqIEBhYnN0cmFjdFxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyB3aGVuIGNvbXBsZXRlLlxuICAgKi9cbiAgZW5hYmxlRm9yZWlnbktleXMoKSB7XG4gICAgdGhyb3cgbmV3IEVycm9yKFwiJ2VuYWJsZUZvcmVpZ25LZXlzJyBub3QgaW1wbGVtZW50ZWRcIilcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHdpdGggZGlzYWJsZWQgZm9yZWlnbiBrZXlzLlxuICAgKiBAcGFyYW0geygpID0+IHZvaWR9IGNhbGxiYWNrIC0gQ2FsbGJhY2sgZnVuY3Rpb24uXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gLSBSZXNvbHZlcyB3aXRoIHRoZSB3aXRoIGRpc2FibGVkIGZvcmVpZ24ga2V5cy5cbiAgICovXG4gIGFzeW5jIHdpdGhEaXNhYmxlZEZvcmVpZ25LZXlzKGNhbGxiYWNrKSB7XG4gICAgYXdhaXQgdGhpcy5kaXNhYmxlRm9yZWlnbktleXMoKVxuXG4gICAgdHJ5IHtcbiAgICAgIHJldHVybiBhd2FpdCBjYWxsYmFjaygpXG4gICAgfSBmaW5hbGx5IHtcbiAgICAgIGF3YWl0IHRoaXMuZW5hYmxlRm9yZWlnbktleXMoKVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBCbG9ja3MgdW50aWwgYSBuYW1lZCBhZHZpc29yeSBsb2NrIGlzIGFjcXVpcmVkIG9uIHRoaXMgY29ubmVjdGlvbi5cbiAgICogQWR2aXNvcnkgbG9ja3MgYXJlIGNvbm5lY3Rpb24tc2NvcGVkIGFuZCBkbyBub3QgaW50ZXJhY3Qgd2l0aCByb3cgb3JcbiAgICogdGFibGUgbG9ja3M7IHRoZXkgYXJlIHB1cmVseSBjb29wZXJhdGl2ZSBiZXR3ZWVuIGNhbGxlcnMgdGhhdCB1c2UgdGhlXG4gICAqIHNhbWUgbmFtZSBhbmQgbGV0IHlvdSBzZXJpYWxpemUgZnVuY3Rpb25hbGl0eSB3aXRob3V0IGJsb2NraW5nIHJlYWRlcnNcbiAgICogb3Igd3JpdGVycyB0aGF0IGRvIG5vdCBwYXJ0aWNpcGF0ZSBpbiB0aGUgc2FtZSBuYW1lZCBsb2NrLlxuICAgKlxuICAgKiBBY3F1aXNpdGlvbiBydW5zIGFzIGEgdHdvLXRpZXIgY2hhaW46XG4gICAqIDEuIFRoZSAqKnByb2Nlc3MtbG9jYWwgcHJlLWZpbHRlciB0aWVyKiogKHRoaXMgY2xhc3MnIEZJRk8gd2FpdGVyXG4gICAqICAgIHF1ZXVlKSBzZXJpYWxpemVzIHNhbWUtcHJvY2VzcyBjYWxsZXJzIGZvciB0aGUgbG9jayBuYW1lIHdpdGhvdXRcbiAgICogICAgaXNzdWluZyBhbnkgZHJpdmVyLW5hdGl2ZSBsb2NrIHF1ZXJ5IGFuZCB3aXRob3V0IHBhcmtpbmcgYVxuICAgKiAgICBjb25uZWN0aW9uIGluIGEgZHJpdmVyIGxvY2sgc3RhdGUuIEEgcXVldWVkIGNhbGxlciBuZXZlciByZWFjaGVzXG4gICAqICAgIHRpZXIgMiB1bnRpbCB0aGUgaW4tcHJvY2VzcyBob2xkZXIgcmVsZWFzZXMuXG4gICAqIDIuIFRoZSAqKmRyaXZlci1uYXRpdmUgdGllcioqIChgX2FjcXVpcmVBZHZpc29yeUxvY2tgOiBNYXJpYURCXG4gICAqICAgIGBHRVRfTE9DS2AsIFBvc3RncmVTUUwgYHBnX2Fkdmlzb3J5X2xvY2tgLCBTUUwgU2VydmVyXG4gICAqICAgIGBzcF9nZXRhcHBsb2NrYCwgU1FMaXRlIGZpbGVzeXN0ZW0gbG9jayBvbiBOb2RlKSBjb25maXJtcyB0aGVcbiAgICogICAgY3Jvc3MtcHJvY2Vzcy9jcm9zcy1ob3N0IGV4Y2x1c2lvbi5cbiAgICpcbiAgICogVGhlIHByb2Nlc3MtbG9jYWwgdGllciBpcyBhIHByZS1maWx0ZXIsICoqbmV2ZXIgdGhlIGF1dGhvcml0eSoqOiBhXG4gICAqIGxvY2sgbmFtZSB0aGF0IG90aGVyIHByb2Nlc3NlcyBvciBob3N0cyBjYW4gcmVxdWVzdCBpcyBvbmx5IGdyYW50ZWRcbiAgICogYWZ0ZXIgdGhlIGRyaXZlci1uYXRpdmUgdGllciAob3IsIG9uY2UgdGhlIFNUQy0yMTAgYmFja2VuZCBjaGFpblxuICAgKiBsYW5kcywgdGhlIGNvbmZpZ3VyZWQgY3Jvc3MtaG9zdCBiYWNrZW5kKSBjb25maXJtcyBpdC4gSWYgdGhlIG5hdGl2ZVxuICAgKiB0aWVyIGRlbmllcyBvciB0aW1lcyBvdXQsIHRoZSBpbi1wcm9jZXNzIGhvbGQgaXMgcm9sbGVkIGJhY2suXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBuYW1lIC0gTG9jayBuYW1lLlxuICAgKiBAcGFyYW0ge3t0aW1lb3V0TXM/OiBudW1iZXIgfCBudWxsfX0gW2FyZ3NdIC0gT3B0aW9uYWwgdGltZW91dCBpbiBtaWxsaXNlY29uZHM7IGBudWxsYCBibG9ja3MgZm9yZXZlciwgYW5kIGFuIG9taXR0ZWQgdmFsdWUgdXNlcyB0aGUgZGF0YWJhc2UncyBgYWR2aXNvcnlMb2NrQWNxdWlyZVRpbWVvdXRNc2Agb3IgdGhlIGZyYW1ld29yayBkZWZhdWx0LiBUaGUgYm91bmQgY292ZXJzIHRoZSB3aG9sZSB0d28tdGllciBhY3F1aXNpdGlvbi5cbiAgICogQHJldHVybnMge1Byb21pc2U8Ym9vbGVhbj59IC0gUmVzb2x2ZXMgdG8gdHJ1ZSB3aGVuIHRoZSBsb2NrIGhhcyBiZWVuIGFjcXVpcmVkLCBmYWxzZSBpZiB0aGUgdGltZW91dCBlbGFwc2VkLlxuICAgKi9cbiAgYXN5bmMgYWNxdWlyZUFkdmlzb3J5TG9jayhuYW1lLCBhcmdzID0ge30pIHtcbiAgICBjb25zdCB0aW1lb3V0TXMgPSB0aGlzLmFkdmlzb3J5TG9ja0FjcXVpcmVUaW1lb3V0TXMoYXJncylcbiAgICBjb25zdCBkZWFkbGluZU1zID0gdHlwZW9mIHRpbWVvdXRNcyA9PT0gXCJudW1iZXJcIiAmJiB0aW1lb3V0TXMgPj0gMCA/IERhdGUubm93KCkgKyB0aW1lb3V0TXMgOiBudWxsXG4gICAgY29uc3QgbG9jYWxBY3F1aXNpdGlvbiA9IGF3YWl0IHRoaXMuX2FjcXVpcmVQcm9jZXNzTG9jYWxBZHZpc29yeUxvY2sobmFtZSwge3RpbWVvdXRNc30pXG5cbiAgICBpZiAoIWxvY2FsQWNxdWlzaXRpb24uYWNxdWlyZWQpIHJldHVybiBmYWxzZVxuXG4gICAgaWYgKCF0aGlzLnN1cHBvcnRzRHJpdmVyTmF0aXZlQWR2aXNvcnlMb2NrKCkpIHtcbiAgICAgIC8vIE5vIGRyaXZlci1uYXRpdmUgdGllciBleGlzdHMgZm9yIHRoaXMgZHJpdmVyIChwbGFpbiBTUUxpdGUpOiB0aGVcbiAgICAgIC8vIHByb2Nlc3MtbG9jYWwgdGllciBpcyB0aGUgd2hvbGUgaW1wbGVtZW50YXRpb24sIGFuZCBjYWxsZXJzIG11c3RcbiAgICAgIC8vIG5vdCByZWFkIGl0IGFzIGEgY3Jvc3MtcHJvY2VzcyBndWFyYW50ZWUuXG4gICAgICB0aGlzLl90cmFja0Fkdmlzb3J5TG9jayhuYW1lKVxuXG4gICAgICByZXR1cm4gdHJ1ZVxuICAgIH1cblxuICAgIC8vIE9ubHkgYSBjYWxsZXIgdGhhdCBhY3R1YWxseSBxdWV1ZWQgaW4gdGhlIHByb2Nlc3MtbG9jYWwgdGllciBzcGVuZHNcbiAgICAvLyBwYXJ0IG9mIHRoZSBhY3F1aXJlIGJ1ZGdldDsgYW4gdW5jb250ZW5kZWQgYWNxdWlzaXRpb24gcGFzc2VzIHRoZVxuICAgIC8vIGZ1bGwgYm91bmQgb24gdG8gdGhlIGRyaXZlci1uYXRpdmUgdGllci5cbiAgICBjb25zdCBuYXRpdmVUaW1lb3V0TXMgPSBsb2NhbEFjcXVpc2l0aW9uLndhaXRlZCAmJiBkZWFkbGluZU1zICE9PSBudWxsXG4gICAgICA/IE1hdGgubWF4KDAsIGRlYWRsaW5lTXMgLSBEYXRlLm5vdygpKVxuICAgICAgOiB0aW1lb3V0TXNcblxuICAgIC8qKiBAdHlwZSB7Ym9vbGVhbn0gKi9cbiAgICBsZXQgbmF0aXZlQWNxdWlyZWRcblxuICAgIHRyeSB7XG4gICAgICBuYXRpdmVBY3F1aXJlZCA9IGF3YWl0IHRoaXMuX2FjcXVpcmVBZHZpc29yeUxvY2sobmFtZSwge3RpbWVvdXRNczogbmF0aXZlVGltZW91dE1zfSlcbiAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgdGhpcy5fcmVsZWFzZVByb2Nlc3NMb2NhbEFkdmlzb3J5TG9jayhuYW1lKVxuICAgICAgdGhyb3cgZXJyb3JcbiAgICB9XG5cbiAgICBpZiAoIW5hdGl2ZUFjcXVpcmVkKSB7XG4gICAgICB0aGlzLl9yZWxlYXNlUHJvY2Vzc0xvY2FsQWR2aXNvcnlMb2NrKG5hbWUpXG5cbiAgICAgIHJldHVybiBmYWxzZVxuICAgIH1cblxuICAgIHRoaXMuX3RyYWNrQWR2aXNvcnlMb2NrKG5hbWUpXG5cbiAgICByZXR1cm4gdHJ1ZVxuICB9XG5cbiAgLyoqXG4gICAqIFJlc29sdmVzIHRoZSB3YWl0IGJvdW5kIGZvciBvbmUgYWR2aXNvcnktbG9jayBhY3F1aXNpdGlvbi5cbiAgICogQW4gZXhwbGljaXQgYHRpbWVvdXRNc2Ag4oCUIGluY2x1ZGluZyBhbiBleHBsaWNpdCBgbnVsbGAgb3B0LW91dCDigJQgYWx3YXlzXG4gICAqIHdpbnMuIE90aGVyd2lzZSB0aGUgZGF0YWJhc2UgY29uZmlndXJhdGlvbidzIGBhZHZpc29yeUxvY2tBY3F1aXJlVGltZW91dE1zYFxuICAgKiBhcHBsaWVzLCBhbmQgYSBudWxsIHRoZXJlIG9wdHMgb3V0IHRvby4gT25seSB3aGVuIG5laXRoZXIgaXMgY29uZmlndXJlZCBkb2VzXG4gICAqIHRoZSBmcmFtZXdvcmsgZGVmYXVsdCBib3VuZCB0aGUgd2FpdC5cbiAgICogQHBhcmFtIHt7dGltZW91dE1zPzogbnVtYmVyIHwgbnVsbH19IFthcmdzXSAtIEFjcXVpc2l0aW9uIG9wdGlvbnMgZnJvbSB0aGUgY2FsbGVyLlxuICAgKiBAcmV0dXJucyB7bnVtYmVyIHwgbnVsbH0gLSBXYWl0IGJvdW5kIGluIG1pbGxpc2Vjb25kcywgb3IgYG51bGxgIGZvciBhbiBpbmRlZmluaXRlIHdhaXQuXG4gICAqL1xuICBhZHZpc29yeUxvY2tBY3F1aXJlVGltZW91dE1zKGFyZ3MgPSB7fSkge1xuICAgIGlmIChhcmdzLnRpbWVvdXRNcyAhPT0gdW5kZWZpbmVkKSByZXR1cm4gYXJncy50aW1lb3V0TXNcblxuICAgIGNvbnN0IGNvbmZpZ3VyZWQgPSB0aGlzLmdldEFyZ3MoKT8uYWR2aXNvcnlMb2NrQWNxdWlyZVRpbWVvdXRNc1xuXG4gICAgaWYgKGNvbmZpZ3VyZWQgPT09IG51bGwpIHJldHVybiBudWxsXG4gICAgaWYgKHR5cGVvZiBjb25maWd1cmVkID09PSBcIm51bWJlclwiICYmIGNvbmZpZ3VyZWQgPj0gMCkgcmV0dXJuIGNvbmZpZ3VyZWRcblxuICAgIHJldHVybiBERUZBVUxUX0FEVklTT1JZX0xPQ0tfQUNRVUlSRV9USU1FT1VUX01TXG4gIH1cblxuICAvKipcbiAgICogV2hldGhlciB0aGlzIGRyaXZlciBoYXMgYSBkcml2ZXItbmF0aXZlIGFkdmlzb3J5LWxvY2sgdGllciBiZWhpbmQgdGhlXG4gICAqIHByb2Nlc3MtbG9jYWwgcHJlLWZpbHRlci4gTWFyaWFEQiAoYEdFVF9MT0NLYCksIFBvc3RncmVTUUxcbiAgICogKGBwZ19hZHZpc29yeV9sb2NrYCkgYW5kIFNRTCBTZXJ2ZXIgKGBzcF9nZXRhcHBsb2NrYCkgZG87IFNRTGl0ZSBoYXNcbiAgICogbm8gbmF0aXZlIHByaW1pdGl2ZSAodGhlIE5vZGUgU1FMaXRlIGRyaXZlciBzdWJzdGl0dXRlcyBpdHNcbiAgICogZmlsZXN5c3RlbSBsb2NrIGRpcmVjdG9yeSwgdGhlIHdlYi9uYXRpdmUgYnVpbGRzIGhhdmUgbm90aGluZyksIHNvXG4gICAqIGZvciBwbGFpbiBTUUxpdGUgdGhlIHByb2Nlc3MtbG9jYWwgdGllciBJUyB0aGUgd2hvbGUgaW1wbGVtZW50YXRpb25cbiAgICogYW5kIGNhbGxlcnMgbXVzdCBub3QgcmVhZCBpdCBhcyBhIGNyb3NzLXByb2Nlc3MgZ3VhcmFudGVlLlxuICAgKiBAcmV0dXJucyB7Ym9vbGVhbn0gLSBXaGV0aGVyIHRoZSBkcml2ZXItbmF0aXZlIHRpZXIgZXhpc3RzLlxuICAgKi9cbiAgc3VwcG9ydHNEcml2ZXJOYXRpdmVBZHZpc29yeUxvY2soKSB7XG4gICAgcmV0dXJuIHRydWVcbiAgfVxuXG4gIC8qKlxuICAgKiBXaGV0aGVyIHRoZSBkcml2ZXIncyBuYXRpdmUgdGllciBpcyByZS1lbnRyYW50IHdpdGhpbiB0aGUgc2FtZVxuICAgKiBzZXNzaW9uLiBgR0VUX0xPQ0tgLCBgcGdfYWR2aXNvcnlfbG9ja2AgYW5kIGBzcF9nZXRhcHBsb2NrYCBncmFudCB0aGVcbiAgICogc2FtZSBzZXNzaW9uIHJlcGVhdGVkbHksIHNvIHRoZSBwcm9jZXNzLWxvY2FsIHRpZXIgbXVzdCBsZXQgYVxuICAgKiByZS1hY3F1aXNpdGlvbiBieSBpdHMgb3duIG93bmVyIHBhc3MgdGhyb3VnaCB0byB0aGUgbmF0aXZlIHRpZXIuXG4gICAqIFNRTGl0ZSdzIGVtdWxhdGlvbiAoaW5jbHVkaW5nIHRoZSBOb2RlIGZpbGVzeXN0ZW0gbG9jaykgaXMgbm90XG4gICAqIHJlLWVudHJhbnQsIHNvIHRoZSB0aWVyIGtlZXBzIHRyZWF0aW5nIGEgcmUtYWNxdWlzaXRpb24gYXMgY29udGVudGlvblxuICAgKiBleGFjdGx5IGFzIHRoZSBTUUxpdGUgZW11bGF0aW9uIGFsd2F5cyBoYXMuXG4gICAqIEByZXR1cm5zIHtib29sZWFufSAtIFdoZXRoZXIgc2FtZS1pbnN0YW5jZSByZS1hY3F1aXNpdGlvbiBpcyBob25vcmVkLlxuICAgKi9cbiAgc3VwcG9ydHNSZWVudHJhbnRBZHZpc29yeUxvY2soKSB7XG4gICAgcmV0dXJuIHRydWVcbiAgfVxuXG4gIC8qKlxuICAgKiBQcm9jZXNzLWxvY2FsIHByZS1maWx0ZXIgdGllcjogRklGTyB3YWl0ZXIgcXVldWUgZm9yIG9uZSBsb2NrIG5hbWVcbiAgICogaW5zaWRlIHRoaXMgcHJvY2Vzcy4gVGhpcyBpcyB0aGUgcHJvbW90ZWQgU1FMaXRlIGVtdWxhdGlvbiBmcm9tXG4gICAqIFNUQy0yMTEg4oCUIGl0IG5vdyBydW5zIGluIGZyb250IG9mICoqZXZlcnkqKiBkcml2ZXIncyBuYXRpdmUgdGllciBzbyBhXG4gICAqIHNhbWUtcHJvY2VzcyB3YWl0ZXIgbmV2ZXIgaXNzdWVzIGEgZHJpdmVyLW5hdGl2ZSBsb2NrIHF1ZXJ5IGFuZCBuZXZlclxuICAgKiBwYXJrcyBhIHBvb2xlZCBjb25uZWN0aW9uIGluIGEgZHJpdmVyIGxvY2sgc3RhdGUgd2hpbGUgcXVldWVkLlxuICAgKlxuICAgKiBBIGdyYW50IGhlcmUgbWVhbnMgb25seSBcInlvdSBhcmUgdGhlIG5leHQgY2FsbGVyIGluIHRoaXMgcHJvY2Vzcy5cIlxuICAgKiBJdCBpcyBuZXZlciB0aGUgYXV0aG9yaXR5IGZvciBjcm9zcy1wcm9jZXNzL2Nyb3NzLWhvc3QgZXhjbHVzaW9uOyB0aGVcbiAgICogY2FsbGVyIG11c3Qgc3RpbGwgcGFzcyB0aGUgZHJpdmVyLW5hdGl2ZSB0aWVyIGJlZm9yZSB0aGUgbG9jayBjb3VudHNcbiAgICogYXMgaGVsZC4gQSByZS1lbnRyYW50IGFjcXVpc2l0aW9uIGJ5IHRoZSBvd25pbmcgZHJpdmVyIGluc3RhbmNlIGlzXG4gICAqIGdyYW50ZWQgaW1tZWRpYXRlbHksIG1pcnJvcmluZyB0aGUgc2Vzc2lvbi1zY29wZWQgcmUtZW50cmFuY3kgb2ZcbiAgICogYEdFVF9MT0NLYCAvIGBwZ19hZHZpc29yeV9sb2NrYCAvIGBzcF9nZXRhcHBsb2NrYC5cbiAgICogQHBhcmFtIHtzdHJpbmd9IG5hbWUgLSBMb2NrIG5hbWUuXG4gICAqIEBwYXJhbSB7e3RpbWVvdXRNcz86IG51bWJlciB8IG51bGx9fSBbYXJnc10gLSBPcHRpb25hbCB0aW1lb3V0IGluIG1pbGxpc2Vjb25kczsgYG51bGxgLCBgdW5kZWZpbmVkYCwgb3IgbmVnYXRpdmUgYmxvY2tzIGZvcmV2ZXIuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHthY3F1aXJlZDogYm9vbGVhbiwgd2FpdGVkOiBib29sZWFufT59IC0gV2hldGhlciB0aGUgdGllciBncmFudGVkIHRoaXMgY2FsbGVyLCBhbmQgd2hldGhlciBpdCBoYWQgdG8gcXVldWUgZm9yIGl0LlxuICAgKi9cbiAgYXN5bmMgX2FjcXVpcmVQcm9jZXNzTG9jYWxBZHZpc29yeUxvY2sobmFtZSwge3RpbWVvdXRNc30gPSB7fSkge1xuICAgIGNvbnN0IHN0YXRlID0gVmVsb2Npb3VzRGF0YWJhc2VEcml2ZXJzQmFzZS5fYWR2aXNvcnlMb2NrU3RhdGVcbiAgICBsZXQgd2FpdGVkID0gZmFsc2VcblxuICAgIHdoaWxlIChzdGF0ZS5vd25lcnNCeU5hbWUuaGFzKG5hbWUpKSB7XG4gICAgICBpZiAoc3RhdGUub3duZXJzQnlOYW1lLmdldChuYW1lKSA9PT0gdGhpcyAmJiB0aGlzLnN1cHBvcnRzUmVlbnRyYW50QWR2aXNvcnlMb2NrKCkpIGJyZWFrXG5cbiAgICAgIHdhaXRlZCA9IHRydWVcblxuICAgICAgbGV0IHJlbWFpbmluZ01zID0gbnVsbFxuXG4gICAgICBpZiAodHlwZW9mIHRpbWVvdXRNcyA9PT0gXCJudW1iZXJcIiAmJiB0aW1lb3V0TXMgPj0gMCkge1xuICAgICAgICByZW1haW5pbmdNcyA9IHRpbWVvdXRNc1xuXG4gICAgICAgIGlmIChyZW1haW5pbmdNcyA8PSAwKSByZXR1cm4ge2FjcXVpcmVkOiBmYWxzZSwgd2FpdGVkfVxuICAgICAgfVxuXG4gICAgICBhd2FpdCBuZXcgUHJvbWlzZSgocmVzb2x2ZSkgPT4ge1xuICAgICAgICBjb25zdCB3YWl0ZXJzID0gc3RhdGUud2FpdGVyc0J5TmFtZS5nZXQobmFtZSkgfHwgW11cbiAgICAgICAgLyoqXG4gICAgICAgICAqIFRpbWVvdXQgaGFuZGxlLlxuICAgICAgICAgKiBAdHlwZSB7UmV0dXJuVHlwZTx0eXBlb2Ygc2V0VGltZW91dD4gfCBudWxsfSAqL1xuICAgICAgICBsZXQgdGltZW91dEhhbmRsZSA9IG51bGxcbiAgICAgICAgLyoqXG4gICAgICAgICAqIFJlbW92ZSBhbmQgcmVzb2x2ZS5cbiAgICAgICAgICogQHR5cGUgeygoKSA9PiB2b2lkKSB8IG51bGx9ICovXG4gICAgICAgIGxldCByZW1vdmVBbmRSZXNvbHZlID0gbnVsbFxuXG4gICAgICAgIHJlbW92ZUFuZFJlc29sdmUgPSAoKSA9PiB7XG4gICAgICAgICAgaWYgKHRpbWVvdXRIYW5kbGUpIGNsZWFyVGltZW91dCh0aW1lb3V0SGFuZGxlKVxuXG4gICAgICAgICAgY29uc3QgY3VycmVudCA9IHN0YXRlLndhaXRlcnNCeU5hbWUuZ2V0KG5hbWUpIHx8IFtdXG4gICAgICAgICAgY29uc3QgaW5kZXggPSBjdXJyZW50LmluZGV4T2YoLyoqIEB0eXBlIHsoKSA9PiB2b2lkfSAqLyAocmVtb3ZlQW5kUmVzb2x2ZSkpXG5cbiAgICAgICAgICBpZiAoaW5kZXggPj0gMCkgY3VycmVudC5zcGxpY2UoaW5kZXgsIDEpXG4gICAgICAgICAgaWYgKGN1cnJlbnQubGVuZ3RoID09PSAwKSBzdGF0ZS53YWl0ZXJzQnlOYW1lLmRlbGV0ZShuYW1lKVxuXG4gICAgICAgICAgcmVzb2x2ZSh1bmRlZmluZWQpXG4gICAgICAgIH1cblxuICAgICAgICB3YWl0ZXJzLnB1c2gocmVtb3ZlQW5kUmVzb2x2ZSlcbiAgICAgICAgc3RhdGUud2FpdGVyc0J5TmFtZS5zZXQobmFtZSwgd2FpdGVycylcblxuICAgICAgICBpZiAocmVtYWluaW5nTXMgIT09IG51bGwpIHtcbiAgICAgICAgICB0aW1lb3V0SGFuZGxlID0gc2V0VGltZW91dCgoKSA9PiB7XG4gICAgICAgICAgICBpZiAocmVtb3ZlQW5kUmVzb2x2ZSkgcmVtb3ZlQW5kUmVzb2x2ZSgpXG4gICAgICAgICAgfSwgcmVtYWluaW5nTXMpXG4gICAgICAgIH1cbiAgICAgIH0pXG5cbiAgICAgIGlmICh0eXBlb2YgdGltZW91dE1zID09PSBcIm51bWJlclwiICYmIHRpbWVvdXRNcyA+PSAwICYmIHN0YXRlLm93bmVyc0J5TmFtZS5oYXMobmFtZSkgJiYgIShzdGF0ZS5vd25lcnNCeU5hbWUuZ2V0KG5hbWUpID09PSB0aGlzICYmIHRoaXMuc3VwcG9ydHNSZWVudHJhbnRBZHZpc29yeUxvY2soKSkpIHtcbiAgICAgICAgcmV0dXJuIHthY3F1aXJlZDogZmFsc2UsIHdhaXRlZH1cbiAgICAgIH1cbiAgICB9XG5cbiAgICBzdGF0ZS5vd25lcnNCeU5hbWUuc2V0KG5hbWUsIHRoaXMpXG5cbiAgICByZXR1cm4ge2FjcXVpcmVkOiB0cnVlLCB3YWl0ZWR9XG4gIH1cblxuICAvKipcbiAgICogSGFuZHMgdGhlIHByb2Nlc3MtbG9jYWwgdGllciBmb3Igb25lIGxvY2sgbmFtZSB0byB0aGUgbmV4dCBGSUZPIHdhaXRlcixcbiAgICogYnV0IG9ubHkgd2hlbiAqKnRoaXMqKiBkcml2ZXIgaW5zdGFuY2UgY3VycmVudGx5IG93bnMgaXQuIEEgcmVsZWFzZSBieVxuICAgKiBhIG5vbi1vd25lciBpcyBhIG5vLW9wLCBtYXRjaGluZyB0aGUgXCJ5b3UgY2FuIG9ubHkgcmVsZWFzZSBsb2NrcyB5b3VcbiAgICogb3duXCIgY29udHJhY3Qgb2YgYFJFTEVBU0VfTE9DS2AgLyBgcGdfYWR2aXNvcnlfdW5sb2NrYC5cbiAgICogQHBhcmFtIHtzdHJpbmd9IG5hbWUgLSBMb2NrIG5hbWUuXG4gICAqIEByZXR1cm5zIHtib29sZWFufSAtIFdoZXRoZXIgdGhpcyBpbnN0YW5jZSBvd25lZCB0aGUgdGllciBhbmQgcmVsZWFzZWQgaXQuXG4gICAqL1xuICBfcmVsZWFzZVByb2Nlc3NMb2NhbEFkdmlzb3J5TG9jayhuYW1lKSB7XG4gICAgY29uc3Qgc3RhdGUgPSBWZWxvY2lvdXNEYXRhYmFzZURyaXZlcnNCYXNlLl9hZHZpc29yeUxvY2tTdGF0ZVxuICAgIGNvbnN0IG93bmVyID0gc3RhdGUub3duZXJzQnlOYW1lLmdldChuYW1lKVxuXG4gICAgaWYgKG93bmVyICE9PSB0aGlzKSByZXR1cm4gZmFsc2VcblxuICAgIHN0YXRlLm93bmVyc0J5TmFtZS5kZWxldGUobmFtZSlcblxuICAgIGNvbnN0IHdhaXRlcnMgPSBzdGF0ZS53YWl0ZXJzQnlOYW1lLmdldChuYW1lKVxuXG4gICAgaWYgKHdhaXRlcnMgJiYgd2FpdGVycy5sZW5ndGggPiAwKSB7XG4gICAgICBjb25zdCBuZXh0V2FpdGVyID0gd2FpdGVycy5zaGlmdCgpXG5cbiAgICAgIGlmICh3YWl0ZXJzLmxlbmd0aCA9PT0gMCkgc3RhdGUud2FpdGVyc0J5TmFtZS5kZWxldGUobmFtZSlcbiAgICAgIGlmIChuZXh0V2FpdGVyKSBuZXh0V2FpdGVyKClcbiAgICB9XG5cbiAgICByZXR1cm4gdHJ1ZVxuICB9XG5cbiAgLyoqXG4gICAqIERyaXZlci1zcGVjaWZpYyBibG9ja2luZyBhZHZpc29yeS1sb2NrIGFjcXVpc2l0aW9uIGhvb2suXG4gICAqIFRoaXMgaXMgdGhlICoqZHJpdmVyLW5hdGl2ZSB0aWVyKiogb2YgdGhlIGFjcXVpc2l0aW9uIGNoYWluOiBNYXJpYURCXG4gICAqIGBHRVRfTE9DS2AsIFBvc3RncmVTUUwgYHBnX2Fkdmlzb3J5X2xvY2tgLCBTUUwgU2VydmVyIGBzcF9nZXRhcHBsb2NrYCxcbiAgICogdGhlIE5vZGUgU1FMaXRlIGZpbGVzeXN0ZW0gbG9jay4gSXQgcnVucyBvbmx5IGFmdGVyIHRoZSBwcm9jZXNzLWxvY2FsXG4gICAqIHByZS1maWx0ZXIgdGllciBoYXMgZ3JhbnRlZCB0aGlzIGNhbGxlciBpdHMgdHVybiwgYW5kIGl0cyByZXN1bHQgaXNcbiAgICogd2hhdCBhY3R1YWxseSBjb25maXJtcyBjcm9zcy1wcm9jZXNzL2Nyb3NzLWhvc3QgZXhjbHVzaW9uLlxuICAgKiBAYWJzdHJhY3RcbiAgICogQHBhcmFtIHtzdHJpbmd9IG5hbWUgLSBMb2NrIG5hbWUuXG4gICAqIEBwYXJhbSB7e3RpbWVvdXRNcz86IG51bWJlciB8IG51bGx9fSBbX2FyZ3NdIC0gTG9jayB0aW1lb3V0IG9wdGlvbnMuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPGJvb2xlYW4+fSAtIFdoZXRoZXIgdGhlIGxvY2sgd2FzIGFjcXVpcmVkLlxuICAgKi9cbiAgX2FjcXVpcmVBZHZpc29yeUxvY2sobmFtZSwgX2FyZ3MgPSB7fSkge1xuICAgIHRocm93IG5ldyBFcnJvcihgJ19hY3F1aXJlQWR2aXNvcnlMb2NrJyBub3QgaW1wbGVtZW50ZWQgZm9yICR7dGhpcy5jb25zdHJ1Y3Rvci5uYW1lfWApXG4gIH1cblxuICAvKipcbiAgICogQXR0ZW1wdHMgdG8gYWNxdWlyZSBhIG5hbWVkIGFkdmlzb3J5IGxvY2sgd2l0aG91dCBibG9ja2luZy5cbiAgICpcbiAgICogU2FtZSB0d28tdGllciBjaGFpbiBhcyBgYWNxdWlyZUFkdmlzb3J5TG9ja2A6IHRoZSBwcm9jZXNzLWxvY2FsIHRpZXJcbiAgICogc2hvcnQtY2lyY3VpdHMgY29udGVudGlvbiBiZXR3ZWVuIGNhbGxlcnMgaW4gdGhpcyBwcm9jZXNzIChhIHF1ZXVlZFxuICAgKiBuYW1lIG5ldmVyIHJlYWNoZXMgdGhlIGRyaXZlci1uYXRpdmUgaG9vayksIGFuZCB0aGUgZHJpdmVyLW5hdGl2ZSB0aWVyXG4gICAqIGNvbmZpcm1zIGNyb3NzLXByb2Nlc3MvY3Jvc3MtaG9zdCBleGNsdXNpb24uIEEgZnJlZSBpbi1wcm9jZXNzIHRpZXIgaXNcbiAgICogTk9UIGEgZ3JhbnQg4oCUIHRoZSBuYXRpdmUgdGllciBzdGlsbCBoYXMgdG8gYWdyZWUuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBuYW1lIC0gTG9jayBuYW1lLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxib29sZWFuPn0gLSBSZXNvbHZlcyB0byB0cnVlIGlmIHRoZSBsb2NrIHdhcyBhY3F1aXJlZCwgZmFsc2UgaWYgaXQgd2FzIGFscmVhZHkgaGVsZC5cbiAgICovXG4gIGFzeW5jIHRyeUFjcXVpcmVBZHZpc29yeUxvY2sobmFtZSkge1xuICAgIGNvbnN0IG93bmVyID0gVmVsb2Npb3VzRGF0YWJhc2VEcml2ZXJzQmFzZS5fYWR2aXNvcnlMb2NrU3RhdGUub3duZXJzQnlOYW1lLmdldChuYW1lKVxuXG4gICAgaWYgKG93bmVyICE9PSB1bmRlZmluZWQgJiYgb3duZXIgIT09IHRoaXMpIHJldHVybiBmYWxzZVxuXG4gICAgLy8gU2FtZS1pbnN0YW5jZSByZS1hY3F1aXNpdGlvbiBtaXJyb3JzIHRoZSByZS1lbnRyYW50IHNlbWFudGljcyBvZiB0aGVcbiAgICAvLyBzZXNzaW9uLXNjb3BlZCBkcml2ZXItbmF0aXZlIGxvY2tzOyBhIG5vbi1yZS1lbnRyYW50IGRyaXZlciAoU1FMaXRlKVxuICAgIC8vIGtlZXBzIHRyZWF0aW5nIGl0IGFzIGNvbnRlbnRpb24sIGV4YWN0bHkgYXMgdGhlIGVtdWxhdGlvbiBhbHdheXMgZGlkLlxuICAgIGNvbnN0IHJlZW50cmFudCA9IG93bmVyID09PSB0aGlzXG5cbiAgICBpZiAocmVlbnRyYW50ICYmICF0aGlzLnN1cHBvcnRzUmVlbnRyYW50QWR2aXNvcnlMb2NrKCkpIHJldHVybiBmYWxzZVxuXG4gICAgaWYgKCFyZWVudHJhbnQpIFZlbG9jaW91c0RhdGFiYXNlRHJpdmVyc0Jhc2UuX2Fkdmlzb3J5TG9ja1N0YXRlLm93bmVyc0J5TmFtZS5zZXQobmFtZSwgdGhpcylcblxuICAgIGlmICghdGhpcy5zdXBwb3J0c0RyaXZlck5hdGl2ZUFkdmlzb3J5TG9jaygpKSB7XG4gICAgICB0aGlzLl90cmFja0Fkdmlzb3J5TG9jayhuYW1lKVxuXG4gICAgICByZXR1cm4gdHJ1ZVxuICAgIH1cblxuICAgIC8qKiBAdHlwZSB7Ym9vbGVhbn0gKi9cbiAgICBsZXQgYWNxdWlyZWRcblxuICAgIHRyeSB7XG4gICAgICBhY3F1aXJlZCA9IGF3YWl0IHRoaXMuX3RyeUFjcXVpcmVBZHZpc29yeUxvY2sobmFtZSlcbiAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgaWYgKCFyZWVudHJhbnQpIHRoaXMuX3JlbGVhc2VQcm9jZXNzTG9jYWxBZHZpc29yeUxvY2sobmFtZSlcblxuICAgICAgdGhyb3cgZXJyb3JcbiAgICB9XG5cbiAgICBpZiAoIWFjcXVpcmVkKSB7XG4gICAgICBpZiAoIXJlZW50cmFudCkgdGhpcy5fcmVsZWFzZVByb2Nlc3NMb2NhbEFkdmlzb3J5TG9jayhuYW1lKVxuXG4gICAgICByZXR1cm4gZmFsc2VcbiAgICB9XG5cbiAgICB0aGlzLl90cmFja0Fkdmlzb3J5TG9jayhuYW1lKVxuXG4gICAgcmV0dXJuIHRydWVcbiAgfVxuXG4gIC8qKlxuICAgKiBEcml2ZXItc3BlY2lmaWMgbm9uLWJsb2NraW5nIGFkdmlzb3J5LWxvY2sgYWNxdWlzaXRpb24gaG9vay5cbiAgICogQGFic3RyYWN0XG4gICAqIEBwYXJhbSB7c3RyaW5nfSBuYW1lIC0gTG9jayBuYW1lLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxib29sZWFuPn0gLSBXaGV0aGVyIHRoZSBsb2NrIHdhcyBhY3F1aXJlZC5cbiAgICovXG4gIF90cnlBY3F1aXJlQWR2aXNvcnlMb2NrKG5hbWUpIHsgLy8gZXNsaW50LWRpc2FibGUtbGluZSBuby11bnVzZWQtdmFyc1xuICAgIHRocm93IG5ldyBFcnJvcihgJ190cnlBY3F1aXJlQWR2aXNvcnlMb2NrJyBub3QgaW1wbGVtZW50ZWQgZm9yICR7dGhpcy5jb25zdHJ1Y3Rvci5uYW1lfWApXG4gIH1cblxuICAvKipcbiAgICogUmVsZWFzZXMgYSBuYW1lZCBhZHZpc29yeSBsb2NrIHByZXZpb3VzbHkgYWNxdWlyZWQgb24gdGhpcyBjb25uZWN0aW9uLlxuICAgKiBUaGUgZHJpdmVyLW5hdGl2ZSByZWxlYXNlIHJ1bnMgZmlyc3Q7IHRoZSBwcm9jZXNzLWxvY2FsIHRpZXIgaXMgaGFuZGVkXG4gICAqIHRvIHRoZSBuZXh0IHdhaXRlciBvbmx5IG9uY2UgdGhpcyBjb25uZWN0aW9uJ3MgY291bnRlZCByZWdpc3RyeSBub1xuICAgKiBsb25nZXIgaG9sZHMgdGhlIG5hbWUsIHNvIHJlLWVudHJhbnQgYWNxdWlzaXRpb25zIHJlbGVhc2Ugb25lIGxldmVsIGF0XG4gICAqIGEgdGltZSBleGFjdGx5IGxpa2UgdGhlIHNlc3Npb24tc2NvcGVkIGRyaXZlciBsb2Nrcy5cbiAgICogQHBhcmFtIHtzdHJpbmd9IG5hbWUgLSBMb2NrIG5hbWUuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPGJvb2xlYW4+fSAtIFJlc29sdmVzIHRvIHRydWUgaWYgdGhlIGxvY2sgd2FzIGhlbGQgYnkgdGhpcyBzZXNzaW9uIGFuZCBoYXMgbm93IGJlZW4gcmVsZWFzZWQuXG4gICAqL1xuICBhc3luYyByZWxlYXNlQWR2aXNvcnlMb2NrKG5hbWUpIHtcbiAgICBjb25zdCBvd25lciA9IFZlbG9jaW91c0RhdGFiYXNlRHJpdmVyc0Jhc2UuX2Fkdmlzb3J5TG9ja1N0YXRlLm93bmVyc0J5TmFtZS5nZXQobmFtZSlcblxuICAgIC8vIEFub3RoZXIgZHJpdmVyIGluc3RhbmNlIGluIHRoaXMgcHJvY2VzcyBvd25zIHRoZSB0aWVyIGZvciB0aGlzIG5hbWUsXG4gICAgLy8gc28gdGhpcyBjb25uZWN0aW9uIGNhbiBuZXZlciBiZSB0aGUgbmF0aXZlIGhvbGRlciBlaXRoZXIg4oCUIHJlZnVzZVxuICAgIC8vIGJlZm9yZSBpc3N1aW5nIGEgcmVsZWFzZSBzdGF0ZW1lbnQgdGhhdCBjb3VsZCBkaXN0dXJiIHRoZSBvd25lci5cbiAgICBpZiAob3duZXIgIT09IHVuZGVmaW5lZCAmJiBvd25lciAhPT0gdGhpcykgcmV0dXJuIGZhbHNlXG5cbiAgICBpZiAoIXRoaXMuc3VwcG9ydHNEcml2ZXJOYXRpdmVBZHZpc29yeUxvY2soKSkge1xuICAgICAgLy8gUGxhaW4gU1FMaXRlOiB0aGUgcHJvY2Vzcy1sb2NhbCB0aWVyIElTIHRoZSBsb2NrLCBzbyB0aGUgZmlyc3RcbiAgICAgIC8vIHJlbGVhc2UgYnkgdGhlIG93bmVyIHJlbGVhc2VzIGl0IGZ1bGx5LCBleGFjdGx5IGFzIHRoZSBTUUxpdGVcbiAgICAgIC8vIGVtdWxhdGlvbiBhbHdheXMgaGFzLlxuICAgICAgY29uc3QgcmVsZWFzZWQgPSB0aGlzLl9yZWxlYXNlUHJvY2Vzc0xvY2FsQWR2aXNvcnlMb2NrKG5hbWUpXG5cbiAgICAgIGlmIChyZWxlYXNlZCkge1xuICAgICAgICB0aGlzLl91bnRyYWNrQWR2aXNvcnlMb2NrKG5hbWUpXG4gICAgICB9IGVsc2Uge1xuICAgICAgICB0aGlzLl9oZWxkQWR2aXNvcnlMb2Nrcy5kZWxldGUobmFtZSlcbiAgICAgIH1cblxuICAgICAgcmV0dXJuIHJlbGVhc2VkXG4gICAgfVxuXG4gICAgY29uc3QgcmVsZWFzZWQgPSBhd2FpdCB0aGlzLl9yZWxlYXNlQWR2aXNvcnlMb2NrKG5hbWUpXG5cbiAgICBpZiAocmVsZWFzZWQpIHtcbiAgICAgIHRoaXMuX3VudHJhY2tBZHZpc29yeUxvY2sobmFtZSlcbiAgICB9IGVsc2Uge1xuICAgICAgdGhpcy5faGVsZEFkdmlzb3J5TG9ja3MuZGVsZXRlKG5hbWUpXG4gICAgfVxuXG4gICAgaWYgKCF0aGlzLl9oZWxkQWR2aXNvcnlMb2Nrcy5oYXMobmFtZSkpIHRoaXMuX3JlbGVhc2VQcm9jZXNzTG9jYWxBZHZpc29yeUxvY2sobmFtZSlcblxuICAgIHJldHVybiByZWxlYXNlZFxuICB9XG5cbiAgLyoqXG4gICAqIERyaXZlci1zcGVjaWZpYyBhZHZpc29yeS1sb2NrIHJlbGVhc2UgaG9vay5cbiAgICogQGFic3RyYWN0XG4gICAqIEBwYXJhbSB7c3RyaW5nfSBuYW1lIC0gTG9jayBuYW1lLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxib29sZWFuPn0gLSBXaGV0aGVyIHRoZSBsb2NrIHdhcyByZWxlYXNlZC5cbiAgICovXG4gIF9yZWxlYXNlQWR2aXNvcnlMb2NrKG5hbWUpIHsgLy8gZXNsaW50LWRpc2FibGUtbGluZSBuby11bnVzZWQtdmFyc1xuICAgIHRocm93IG5ldyBFcnJvcihgJ19yZWxlYXNlQWR2aXNvcnlMb2NrJyBub3QgaW1wbGVtZW50ZWQgZm9yICR7dGhpcy5jb25zdHJ1Y3Rvci5uYW1lfWApXG4gIH1cblxuICAvKipcbiAgICogUmVsZWFzZXMgZXZlcnkgYWR2aXNvcnkgbG9jayBzdGlsbCB0cmFja2VkIG9uIHRoaXMgY29ubmVjdGlvbi5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgd2hlbiBldmVyeSB0cmFja2VkIGxvY2sgaXMgcmVsZWFzZWQuXG4gICAqL1xuICBhc3luYyByZWxlYXNlSGVsZEFkdmlzb3J5TG9ja3MoKSB7XG4gICAgLyoqIEB0eXBlIHtFcnJvcltdfSAqL1xuICAgIGNvbnN0IGVycm9ycyA9IFtdXG5cbiAgICBmb3IgKGNvbnN0IG5hbWUgb2YgWy4uLnRoaXMuX2hlbGRBZHZpc29yeUxvY2tzLmtleXMoKV0pIHtcbiAgICAgIHdoaWxlICh0aGlzLl9oZWxkQWR2aXNvcnlMb2Nrcy5oYXMobmFtZSkpIHtcbiAgICAgICAgdHJ5IHtcbiAgICAgICAgICBhd2FpdCB0aGlzLnJlbGVhc2VBZHZpc29yeUxvY2sobmFtZSlcbiAgICAgICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgICAgICBlcnJvcnMucHVzaChlcnJvciBpbnN0YW5jZW9mIEVycm9yID8gZXJyb3IgOiBuZXcgRXJyb3IoYEZhaWxlZCB0byByZWxlYXNlIGFkdmlzb3J5IGxvY2sgJHtKU09OLnN0cmluZ2lmeShuYW1lKX1gLCB7Y2F1c2U6IGVycm9yfSkpXG4gICAgICAgICAgYnJlYWtcbiAgICAgICAgfVxuICAgICAgfVxuICAgIH1cblxuICAgIGlmIChlcnJvcnMubGVuZ3RoID09IDEpIHRocm93IGVycm9yc1swXVxuICAgIGlmIChlcnJvcnMubGVuZ3RoID4gMSkgdGhyb3cgbmV3IEFnZ3JlZ2F0ZUVycm9yKGVycm9ycywgXCJGYWlsZWQgdG8gcmVsZWFzZSBoZWxkIGFkdmlzb3J5IGxvY2tzXCIpXG4gIH1cblxuICAvKipcbiAgICogUmVjb3JkcyBvbmUgc3VjY2Vzc2Z1bCBhY3F1aXNpdGlvbiwgaW5jbHVkaW5nIHJlLWVudHJhbnQgYWNxdWlzaXRpb25zLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gbmFtZSAtIExvY2sgbmFtZS5cbiAgICogQHJldHVybnMge3ZvaWR9XG4gICAqL1xuICBfdHJhY2tBZHZpc29yeUxvY2sobmFtZSkge1xuICAgIHRoaXMuX2hlbGRBZHZpc29yeUxvY2tzLnNldChuYW1lLCAodGhpcy5faGVsZEFkdmlzb3J5TG9ja3MuZ2V0KG5hbWUpIHx8IDApICsgMSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSZW1vdmVzIG9uZSBzdWNjZXNzZnVsIGFjcXVpc2l0aW9uIGZyb20gdGhlIGNvbm5lY3Rpb24gcmVnaXN0cnkuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBuYW1lIC0gTG9jayBuYW1lLlxuICAgKiBAcmV0dXJucyB7dm9pZH1cbiAgICovXG4gIF91bnRyYWNrQWR2aXNvcnlMb2NrKG5hbWUpIHtcbiAgICBjb25zdCByZW1haW5pbmdDb3VudCA9ICh0aGlzLl9oZWxkQWR2aXNvcnlMb2Nrcy5nZXQobmFtZSkgfHwgMCkgLSAxXG5cbiAgICBpZiAocmVtYWluaW5nQ291bnQgPiAwKSB7XG4gICAgICB0aGlzLl9oZWxkQWR2aXNvcnlMb2Nrcy5zZXQobmFtZSwgcmVtYWluaW5nQ291bnQpXG4gICAgfSBlbHNlIHtcbiAgICAgIHRoaXMuX2hlbGRBZHZpc29yeUxvY2tzLmRlbGV0ZShuYW1lKVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBDaGVja3Mgd2hldGhlciBhIG5hbWVkIGFkdmlzb3J5IGxvY2sgaXMgY3VycmVudGx5IGhlbGQgYnkgYW55IHNlc3Npb24uXG4gICAqIEludGVuZGVkIGFzIGFuIGludHJvc3BlY3Rpb24gaGVscGVyOyBjYWxsZXJzIHdobyBuZWVkIHRvIGFjdCBvbiB0aGVcbiAgICogcmVzdWx0IHNob3VsZCBwcmVmZXIgYHRyeUFjcXVpcmVBZHZpc29yeUxvY2tgIHRvIGF2b2lkIGEgVE9DVE9VIHJhY2UuXG4gICAqXG4gICAqIFRoZSBwcm9jZXNzLWxvY2FsIHRpZXIgYW5zd2VycyBmaXJzdCAoYSBzYW1lLXByb2Nlc3MgaG9sZGVyIGlzIGFcbiAgICogaG9sZGVyLCBmdWxsIHN0b3ApOyBvdGhlcndpc2UgdGhlIHF1ZXN0aW9uIGdvZXMgdG8gdGhlIGRyaXZlci1uYXRpdmVcbiAgICogdGllcidzIGludHJvc3BlY3Rpb24gKGBJU19VU0VEX0xPQ0tgIC8gYHBnX2xvY2tzYCAvIGBBUFBMT0NLX1RFU1RgKS5cbiAgICogQHBhcmFtIHtzdHJpbmd9IG5hbWUgLSBMb2NrIG5hbWUuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPGJvb2xlYW4+fSAtIFJlc29sdmVzIHRvIHRydWUgaWYgdGhlIGxvY2sgaXMgaGVsZCBieSBhbnkgc2Vzc2lvbi5cbiAgICovXG4gIGFzeW5jIGlzQWR2aXNvcnlMb2NrSGVsZChuYW1lKSB7XG4gICAgaWYgKFZlbG9jaW91c0RhdGFiYXNlRHJpdmVyc0Jhc2UuX2Fkdmlzb3J5TG9ja1N0YXRlLm93bmVyc0J5TmFtZS5oYXMobmFtZSkpIHJldHVybiB0cnVlXG5cbiAgICBpZiAoIXRoaXMuc3VwcG9ydHNEcml2ZXJOYXRpdmVBZHZpc29yeUxvY2soKSkgcmV0dXJuIGZhbHNlXG5cbiAgICByZXR1cm4gYXdhaXQgdGhpcy5faXNBZHZpc29yeUxvY2tIZWxkTmF0aXZlKG5hbWUpXG4gIH1cblxuICAvKipcbiAgICogRHJpdmVyLW5hdGl2ZSBhZHZpc29yeS1sb2NrIGludHJvc3BlY3Rpb24gaG9vayBiZWhpbmRcbiAgICogYGlzQWR2aXNvcnlMb2NrSGVsZGAuXG4gICAqIEBhYnN0cmFjdFxuICAgKiBAcGFyYW0ge3N0cmluZ30gbmFtZSAtIExvY2sgbmFtZS5cbiAgICogQHJldHVybnMge1Byb21pc2U8Ym9vbGVhbj59IC0gUmVzb2x2ZXMgdG8gdHJ1ZSBpZiB0aGUgbmF0aXZlIHRpZXIgcmVwb3J0cyB0aGUgbG9jayBoZWxkLlxuICAgKi9cbiAgX2lzQWR2aXNvcnlMb2NrSGVsZE5hdGl2ZShuYW1lKSB7IC8vIGVzbGludC1kaXNhYmxlLWxpbmUgbm8tdW51c2VkLXZhcnNcbiAgICB0aHJvdyBuZXcgRXJyb3IoYCdfaXNBZHZpc29yeUxvY2tIZWxkTmF0aXZlJyBub3QgaW1wbGVtZW50ZWQgZm9yICR7dGhpcy5jb25zdHJ1Y3Rvci5uYW1lfWApXG4gIH1cbn1cbiJdfQ==