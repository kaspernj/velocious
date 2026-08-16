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

import BacktraceCleaner from "../../utils/backtrace-cleaner.js"
import { getDatabaseAnnotations } from "../annotations.js"
import { formatDateForDatabase } from "../datetime-storage.js"
import isDate from "../../utils/is-date.js"
import Logger from "../../logger.js"
import Query from "../query/index.js"
import QueryAbortedError from "../query-aborted-error.js"
import Handler from "../handler.js"
import { utf8ByteLength } from "../../utils/utf8-byte-length.js"
import Mutex from "epic-locks/build/mutex.js"
import UUID from "pure-uuid"
import TableData from "../table-data/index.js"
import TableColumn from "../table-data/table-column.js"
import TableForeignKey from "../table-data/table-foreign-key.js"
import wait from "awaitery/build/wait.js"
import { optionalPositiveInteger } from "typanic"
import { coordinateSharedTransactionConnection } from "../../testing/shared-transaction-connection-coordinator.js"
import { currentTestProfileContext } from "../../testing/test-profile-context.js"
import sha256Hex from "../../utils/sha256-hex.js"

/** Maximum characters inspected when building the debug SQL preview. */
const SQL_PREVIEW_SCAN_LIMIT = 4096
/** Maximum characters inspected when deciding whether a statement invalidates schema metadata. */
const SCHEMA_INVALIDATION_SCAN_LIMIT = 8192
/** Maximum checkout-name characters inspected by retry diagnostics. */
const OPERATION_NAME_SCAN_LIMIT = 1024
const REDACTED_DIAGNOSTIC_LABEL = "[REDACTED]"

/**
 * Builds a non-reversible, stable SQL fingerprint without retaining SQL text. Literal spelling is
 * normalized first so the same statement shape produces the same fingerprint across values.
 * @param {string} sql - SQL to fingerprint.
 * @returns {{sqlFingerprint: string, sqlOperation: string}} - Bounded query diagnostic.
 */
function sqlDiagnostic(sql) {
  let fingerprintInput = ""

  for (let index = 0; index < sql.length;) {
    const character = sql[index]
    const nextCharacter = sql[index + 1]

    if (character == "'" || character == '"') {
      const quote = character
      fingerprintInput += "?"
      index++

      while (index < sql.length) {
        if (sql[index] == "\\") {
          index += 2
        } else if (sql[index] == quote && sql[index + 1] == quote) {
          index += 2
        } else if (sql[index] == quote) {
          index++
          break
        } else {
          index++
        }
      }
    } else if (character == "/" && nextCharacter == "*") {
      const commentEnd = sql.indexOf("*/", index + 2)
      fingerprintInput += " "
      index = commentEnd == -1 ? sql.length : commentEnd + 2
    } else if ((character == "-" && nextCharacter == "-") || character == "#") {
      const lineEnd = sql.indexOf("\n", index + 1)
      fingerprintInput += " "
      index = lineEnd == -1 ? sql.length : lineEnd + 1
    } else {
      fingerprintInput += character
      index++
    }
  }

  const normalized = fingerprintInput
    .replace(/\b(?:0x[0-9a-f]+|\d+(?:\.\d+)?(?:e[+-]?\d+)?)\b/gi, "?")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase()
  let hash = 0xcbf29ce484222325n

  for (let index = 0; index < normalized.length; index++) {
    hash ^= BigInt(normalized.charCodeAt(index))
    hash = BigInt.asUintN(64, hash * 0x100000001b3n)
  }

  const operationMatch = /^([a-z]+)/.exec(normalized)

  return {
    sqlFingerprint: `fnv1a64:${hash.toString(16).padStart(16, "0")}`,
    sqlOperation: operationMatch ? operationMatch[1].toUpperCase() : "UNKNOWN"
  }
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
    super("Database afterCommit callback failed")
    this.callbackError = callbackError
  }
}

/**
 * Runs now ms.
 * @returns {number} - Current high-resolution-ish timestamp in milliseconds.
 */
function nowMs() {
  if (globalThis.performance && typeof globalThis.performance.now == "function") {
    return globalThis.performance.now()
  }

  return Date.now()
}

/**
 * Runs format elapsed ms.
 * @param {number} elapsedMs - Elapsed milliseconds.
 * @returns {string} - Formatted elapsed milliseconds.
 */
function formatElapsedMs(elapsedMs) {
  return `${Math.max(elapsedMs, 0).toFixed(1)}ms`
}

export default class VelociousDatabaseDriversBase {
  /**
   * Id seq.
   * @type {number | undefined} */
  idSeq = undefined
  /**
   * Narrows the runtime value to the documented type.
   * @type {TransactionCallbackFrame[]} */
  _transactionCallbackFrames
  /** @type {Promise<void>} */
  _transactionCompletionPromise
  /** @type {(() => void) | undefined} */
  _resolveTransactionCompletion
  /**
   * Narrows the runtime value to the documented type.
   * @type {Map<string, Promise<ReturnType<typeof JSON.parse>>>} */
  _schemaCache
  /**
   * Narrows the runtime value to the documented type.
   * @type {(() => void) | undefined} */
  _schemaCacheInvalidator
  /**
   * Narrows the runtime value to the documented type.
   * @type {string | undefined} */
  _connectionCheckoutName
  /** @type {string | undefined} */
  _databaseIdentifier
  /** @type {string | undefined} */
  _databaseIdentityFingerprint
  /**
   * Active query.
   * @type {ActiveQueryState | null} */
  _activeQuery = null
  /** @type {WeakMap<Error, {sqlFingerprint: string, sqlOperation: string}>} */
  _failedQueryDiagnostics = new WeakMap()
  /** @type {Map<string, number>} */
  _heldAdvisoryLocks = new Map()
  /**
   * Exclusive operation lease installed by a single-multi-use pool.
   * @type {import("../operation-lease.js").default | undefined}
   */
  _operationLease = undefined

  /**
   * Runs constructor.
   * @param {import("../../configuration-types.js").DatabaseConfigurationType} config - Configuration object.
   * @param {import("../../configuration.js").default} configuration - Configuration instance.
   */
  constructor(config, configuration) {
    this._args = config
    this.configuration = configuration
    this.mutex = new Mutex() // Can be used to lock this instance for exclusive use
    this.logger = new Logger(this)
    this._transactionCallbackFrames = []
    this._transactionsCount = 0
    this._transactionCompletionPromise = Promise.resolve()
    this._resolveTransactionCompletion = undefined
    this._transactionsActionsMutex = new Mutex()
    this._schemaCache = new Map()
  }

  /**
   * Cleans driver-specific session state before this logical connection is reusable.
   * Drivers whose physical sessions cannot be safely reset should dispose them here.
   * @returns {Promise<void>} - Resolves when the next checkout cannot observe prior session state.
   */
  async cleanupSessionStateAfterCheckout() {}

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
    this._assertNotReadOnly()
    const tableForeignKeyArgs = Object.assign(
      {
        columnName,
        tableName,
        referencedColumnName,
        referencedTableName
      },
      args
    )
    const tableForeignKey = new TableForeignKey(tableForeignKeyArgs)
    const tableData = new TableData(tableName)

    tableData.addForeignKey(tableForeignKey)

    const alterTableSQLs = await this.alterTableSQLs(tableData)

    for (const alterTableSQL of alterTableSQLs) {
      await this.query(alterTableSQL)
    }
  }

  /**
   * Runs remove foreign key.
   * @param {string} tableName - Table name.
   * @param {import("./base-foreign-key.js").default} foreignKeyMetadata - Foreign key metadata.
   * @returns {Promise<void>} - Resolves when complete.
   */
  async removeForeignKey(tableName, foreignKeyMetadata) {
    this._assertNotReadOnly()

    const tableForeignKey = new TableForeignKey({
      columnName: foreignKeyMetadata.getColumnName(),
      dropForeignKey: true,
      name: foreignKeyMetadata.getName(),
      referencedColumnName: foreignKeyMetadata.getReferencedColumnName(),
      referencedTableName: foreignKeyMetadata.getReferencedTableName(),
      tableName
    })
    const tableData = new TableData(tableName)

    tableData.addForeignKey(tableForeignKey)

    const alterTableSQLs = await this.alterTableSQLs(tableData)

    for (const alterTableSQL of alterTableSQLs) {
      await this.query(alterTableSQL)
    }
  }

  /**
   * Runs alter table sqls.
   * @abstract
   * @param {import("../table-data/index.js").default} _tableData - Table data.
   * @returns {Promise<string[]>} - Resolves with SQL statements.
   */
  alterTableSQLs(_tableData) {
    throw new Error("alterTableSQLs not implemented")
  }

  /**
   * Runs connect.
   * @abstract
   * @returns {Promise<void>} - Resolves when complete.
   */
  connect() {
    throw new Error("'connect' not implemented")
  }

  /**
   * Releases tracked advisory locks and closes the physical database connection.
   * @returns {Promise<void>} - Resolves when cleanup and close complete.
   */
  async close() {
    /** @type {Error | undefined} */
    let advisoryLockError

    try {
      await this.releaseHeldAdvisoryLocks()
    } catch (error) {
      advisoryLockError = error instanceof Error ? error : new Error("Failed to release held advisory locks", {cause: error})
    }

    try {
      await this._close()
      this._heldAdvisoryLocks.clear()
    } catch (error) {
      const closeError = error instanceof Error ? error : new Error("Failed to close database connection", {cause: error})

      if (advisoryLockError) {
        throw new AggregateError([advisoryLockError, closeError], "Failed to release advisory locks and close database connection", {cause: error})
      }

      throw closeError
    }

    if (advisoryLockError) throw advisoryLockError
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
  hasPendingWrites() { return false }

  /**
   * Deletes this driver's physical database storage without opening it.
   * @returns {Promise<void>} - Resolves after deletion.
   */
  async deleteDatabaseStorage() { throw new Error(`Database storage deletion is not supported by ${this.constructor.name}`) }

  /**
   * Runs set connection checkout name.
   * @param {string | undefined} name - Human-readable name for this active checkout.
   * @returns {Promise<void>} - Resolves when complete.
   */
  async setConnectionCheckoutName(name) {
    this._connectionCheckoutName = name
    this._connectionCheckedOutAtUnixMs = Date.now()
  }

  /**
   * Runs clear connection checkout name.
   * @returns {Promise<void>} - Resolves when complete.
   */
  async clearConnectionCheckoutName() {
    this._connectionCheckoutName = undefined
    this._connectionCheckedOutAtUnixMs = undefined
  }

  /**
   * Sets the pool-owned identity used by safe database diagnostics.
   * @param {{databaseIdentifier: string, databaseIdentityFingerprint: string}} identity - Pool-stamped identity redacted at diagnostic snapshot time.
   * @returns {void}
   */
  setPoolDiagnosticIdentity({databaseIdentifier, databaseIdentityFingerprint}) {
    this._databaseIdentifier = databaseIdentifier
    this._databaseIdentityFingerprint = databaseIdentityFingerprint
  }

  /**
   * Runs reconnect.
   * @returns {Promise<void>} - Resolves when complete.
   */
  async reconnect() {
    this.clearSchemaCache()
    await this.close()
    await this.connect()
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
  createDatabaseSql(databaseName, args) { throw new Error("'createDatabaseSql' not implemented") } // eslint-disable-line no-unused-vars

  /**
   * Runs drop database sql.
   * @abstract
   * @param {string} databaseName - Database name.
   * @param {object} [args] - Options object.
   * @param {boolean} [args.ifExists] - Whether if exists.
   * @returns {string[]} - SQL statements.
   */
  dropDatabaseSql(databaseName, args) { throw new Error("'dropDatabaseSql' not implemented") } // eslint-disable-line no-unused-vars

  /**
   * Runs create index sqls.
   * @abstract
   * @param {CreateIndexSqlArgs} indexData - Index data.
   * @returns {Promise<string[]>} - Resolves with SQL statements.
   */
  async createIndexSQLs(indexData) { // eslint-disable-line no-unused-vars
    throw new Error("'createIndexSQLs' not implemented")
  }

  /**
   * Runs remove index sqls.
   * @abstract
   * @param {RemoveIndexSqlArgs} indexData - Index data.
   * @returns {Promise<string[]>} - Resolves with SQL statements.
   */
  async removeIndexSQLs(indexData) { // eslint-disable-line no-unused-vars
    throw new Error("'removeIndexSQLs' not implemented")
  }

  /**
   * Runs create table.
   * @param {import("../table-data/index.js").default} tableData - Table data.
   * @returns {Promise<void>} - Resolves when complete.
   */
  async createTable(tableData) {
    this._assertNotReadOnly()
    const sqls = await this.createTableSql(tableData)

    for (const sql of sqls) {
      await this.query(sql)
    }
  }

  /**
   * Runs create table sql.
   * @abstract
   * @param {import("../table-data/index.js").default} tableData - Table data.
   * @returns {Promise<string[]>} - Resolves with SQL statements.
   */
  async createTableSql(tableData) { // eslint-disable-line no-unused-vars
    throw new Error("'createTableSql' not implemented")
  }

  /**
   * Runs delete.
   * @param {DeleteSqlArgsType} args - Options object.
   * @returns {Promise<void>} - Resolves when complete.
   */
  async delete(args) {
    this._assertNotReadOnly()
    const sql = this.deleteSql(args)

    await this.query(sql)
  }

  /**
   * Runs delete sql.
   * @abstract
   * @param {DeleteSqlArgsType} args - Options object.
   * @returns {string} - SQL string.
   */
  deleteSql(args) { // eslint-disable-line no-unused-vars
    throw new Error(`'deleteSql' not implemented`)
  }

  /**
   * Runs drop table.
   * @param {string} tableName - Table name.
   * @param {DropTableSqlArgsType} [args] - Options object.
   * @returns {Promise<void>} - Resolves when complete.
   */
  async dropTable(tableName, args) {
    this._assertNotReadOnly()
    const sqls = await this.dropTableSQLs(tableName, args)

    for (const sql of sqls) {
      await this.query(sql)
    }
  }

  /**
   * Runs drop table sqls.
   * @abstract
   * @param {string} tableName - Table name.
   * @param {DropTableSqlArgsType} [args] - Options object.
   * @returns {Promise<string[]>} - Resolves with SQL statements.
   */
  async dropTableSQLs(tableName, args) { // eslint-disable-line no-unused-vars
    throw new Error("dropTableSQLs not implemented")
  }

  /**
   * Runs escape.
   * @abstract
   * @param {ReturnType<typeof JSON.parse>} value - Value to use.
   * @returns {ReturnType<typeof JSON.parse>} - The escape.
   */
  escape(value) { // eslint-disable-line no-unused-vars
    throw new Error("'escape' not implemented")
  }

  /**
   * Runs get args.
   * @returns {import("../../configuration-types.js").DatabaseConfigurationType} - The args.
   */
  getArgs() {
    return this._args
  }

  /**
   * Runs get configuration.
   * @returns {import("../../configuration.js").default} - The configuration.
   */
  getConfiguration() {
    if (!this.configuration) throw new Error("No configuration set")

    return this.configuration
  }

  /**
   * Installs an operation lease atomically with ordinary transaction admission.
   * @param {import("../operation-lease.js").default} operationLease - Active lease.
   * @returns {Promise<void>} - Resolves once the lease owns transaction admission.
   */
  async setOperationLease(operationLease) {
    await this._transactionsActionsMutex.sync(async () => {
      if (this._operationLease) throw new Error("A database operation lease is already active")
      if (this._transactionsCount > 0) {
        throw new Error("Cannot start a database operation while an unrelated ordinary transaction is already active")
      }

      this._operationLease = operationLease
    })
  }

  /**
   * Clears the matching operation lease.
   * @param {import("../operation-lease.js").default} operationLease - Lease to clear.
   * @returns {void}
   */
  clearOperationLease(operationLease) {
    if (this._operationLease !== operationLease) {
      throw new Error("Cannot clear a database operation lease owned by another operation")
    }

    this._operationLease = undefined
  }

  /**
   * Waits for an unrelated operation lease to release.
   * @param {symbol | undefined} operationOwner - Candidate operation owner.
   * @returns {Promise<void>}
   */
  async _waitForOperationLease(operationOwner) {
    const operationLease = this._operationLease

    if (operationLease) await operationLease.wait(operationOwner)
  }

  /**
   * Runs get id seq.
   * @returns {number | undefined} - The id seq.
   */
  getIdSeq() {
    return this.idSeq
  }

  /**
   * Runs primary key type.
   * @returns {string} - Configured primary key type, defaulting to UUID.
   */
  primaryKeyType() {
    return this.getArgs().primaryKeyType || "uuid"
  }

  /**
   * Clears cached schema metadata for this driver instance.
   * @returns {void} - No return value.
   */
  clearSchemaCache() {
    if (this._schemaCacheInvalidator) {
      this._schemaCacheInvalidator()
      return
    }

    this._clearLocalSchemaCache()
  }

  /**
   * Clears only the metadata cached on this driver instance.
   * @returns {void} - No return value.
   */
  _clearLocalSchemaCache() {
    this._schemaCache.clear()
  }

  /**
   * Runs set schema cache invalidator.
   * @param {() => void} invalidator - Callback used to clear schema caches that share this driver pool.
   * @returns {void} - No return value.
   */
  setSchemaCacheInvalidator(invalidator) {
    this._schemaCacheInvalidator = invalidator
  }

  /**
   * Runs schema cache enabled.
   * @returns {boolean} - Whether schema metadata caching is enabled.
   */
  _schemaCacheEnabled() {
    return this.getArgs().schemaCache !== false
  }

  /**
   * Runs cached schema metadata.
   * @template T
   * @param {string} cacheKey - Schema cache key.
   * @param {() => Promise<T>} callback - Cache miss callback.
   * @returns {Promise<T>} - Resolves with the cached metadata.
   */
  async _cachedSchemaMetadata(cacheKey, callback) {
    if (!this._schemaCacheEnabled()) return await callback()

    const existingPromise = this._schemaCache.get(cacheKey)

    if (existingPromise) {
      return /** @type {T} */ (this._schemaCacheReturnValue(await existingPromise))
    }

    const promise = (async () => await callback())()

    this._schemaCache.set(cacheKey, promise)

    try {
      return /** @type {T} */ (this._schemaCacheReturnValue(await promise))
    } catch (error) {
      if (this._schemaCache.get(cacheKey) === promise) {
        this._schemaCache.delete(cacheKey)
      }

      throw error
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
    return await this._cachedSchemaMetadata(`table:${tableName}:${metadataName}`, callback)
  }

  /**
   * Runs schema cache return value.
   * @param {ReturnType<typeof JSON.parse>} value - Cached value.
   * @returns {ReturnType<typeof JSON.parse>} - Value returned to callers.
   */
  _schemaCacheReturnValue(value) {
    if (Array.isArray(value)) return value.slice()

    return value
  }

  /**
   * Runs get tables.
   * @abstract
   * @returns {Promise<Array<import("./base-table.js").default>>} - Resolves with the tables.
   */
  getTables() {
    throw new Error(`${this.constructor.name}#getTables not implemented`)
  }

  /**
   * Runs structure sql.
   * @returns {Promise<string | null>} - Resolves with SQL string.
   */
  async structureSql() {
    return null
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
    return false
  }

  /**
   * Runs get table by name.
   * @param {string} name - Name.
   * @param {object} [args] - Options object.
   * @param {boolean} args.throwError - Whether throw error.
   * @returns {Promise<import("./base-table.js").default | undefined>} - Resolves with the table by name.
   */
  async getTableByName(name, args) {
    const tables = await this.getTables()
    const tableNames = []
    let table

    for (const candidate of tables) {
      const candidateName = candidate.getName()

      if (candidateName == name) {
        table = candidate
        break
      }

      tableNames.push(candidateName)
    }

    if (!table && args?.throwError !== false) {
      throw new Error(this._missingTableErrorMessage(name, tableNames))
    }

    return table
  }

  /**
   * Runs missing table error message.
   * @param {string} name - Table name.
   * @param {string[]} tableNames - Available table names.
   * @returns {string} - Error message.
   */
  _missingTableErrorMessage(name, tableNames) {
    const environment = this.getConfiguration().getEnvironment()
    const args = this.getArgs()
    const databaseName = args?.database || args?.name || args?.useDatabase || "unknown"

    return `Couldn't find a table by that name "${name}" in: ${tableNames.join(", ")} (environment: ${environment}, database: ${databaseName})`
  }

  /**
   * Runs get table by name or fail.
   * @param {string} name - Name.
   * @returns {Promise<import("./base-table.js").default>} - Resolves with the table by name or fail.
   */
  async getTableByNameOrFail(name) {
    return /** @type {import("./base-table.js").default} */ (await this.getTableByName(name, {throwError: true}))
  }

  /**
   * Runs get type.
   * @abstract
   * @returns {string} - The type.
   */
  getType() {
    throw new Error("'type' not implemented")
  }

  /**
   * Runs insert.
   * @param {InsertSqlArgsType} args - Options object.
   * @returns {Promise<void>} - Resolves when complete.
   */
  async insert(args) {
    this._assertNotReadOnly()
    const sql = this.insertSql(args)

    await this.query(sql)
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
    return optionalPositiveInteger(this.getArgs().maxRowsPerInsert, "maxRowsPerInsert") ?? 500
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
    return optionalPositiveInteger(this.getArgs().maxInsertSqlBytes, "maxInsertSqlBytes") ?? 1048576
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
    return optionalPositiveInteger(this.getArgs().maxInClauseValues, "maxInClauseValues") ?? 999
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
    return optionalPositiveInteger(this.getArgs().maxQuerySqlBytes, "maxQuerySqlBytes") ?? 1048576
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
  chunkValues(values, buildSql, {maxCount = this.maxInClauseValues(), maxBytes = this.maxQuerySqlBytes()} = {}) {
    if (values.length === 0) return []

    /**
     * Chunks.
     * @type {Array<Array<T>>} */
    const chunks = []
    /**
     * Current chunk.
     * @type {Array<T>} */
    let currentChunk = []

    for (const value of values) {
      const candidate = [...currentChunk, value]
      const candidateBytes = utf8ByteLength(buildSql(candidate))

      if (currentChunk.length > 0 && (candidate.length > maxCount || candidateBytes > maxBytes)) {
        chunks.push(currentChunk)
        currentChunk = [value]
      } else {
        currentChunk = candidate
      }
    }

    if (currentChunk.length > 0) {
      chunks.push(currentChunk)
    }

    return chunks
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
    const chunks = []
    const maxRows = this.maxRowsPerInsert()
    const maxBytes = this.maxInsertSqlBytes()
    const emptySql = buildSql([])
    const prefix = `${emptySql} VALUES `
    const baseByteLength = utf8ByteLength(prefix)

    /**
     * Current chunk.
     * @type {Array<Array<ReturnType<typeof JSON.parse>>>} */
    let currentChunk = []
    let currentBytes = 0

    for (const row of rows) {
      const singleRowSql = buildSql([row])
      const rowValuesSql = singleRowSql.slice(prefix.length)
      const rowValuesSqlBytes = utf8ByteLength(rowValuesSql)

      if (currentChunk.length > 0) {
        const candidateRows = currentChunk.length + 1
        const candidateBytes = currentBytes + 2 + rowValuesSqlBytes // ", " separator

        if (candidateRows > maxRows || candidateBytes > maxBytes) {
          chunks.push(currentChunk)
          currentChunk = []
          currentBytes = 0
        }
      }

      if (currentChunk.length === 0) {
        currentBytes = baseByteLength + rowValuesSqlBytes
      } else {
        currentBytes += 2 + rowValuesSqlBytes
      }

      currentChunk.push(row)
    }

    if (currentChunk.length > 0) {
      chunks.push(currentChunk)
    }

    return chunks
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
    this._assertNotReadOnly()

    const chunks = this._insertMultipleChunks(rows, (chunkRows) => this.insertSql({columns, tableName, rows: chunkRows}))

    for (const chunk of chunks) {
      const sql = this.insertSql({columns, tableName, rows: chunk})

      await this.query(sql)
    }
  }

  /**
   * Runs insert sql.
   * @abstract
   * @param {InsertSqlArgsType} args - Options object.
   * @returns {string} - SQL string.
   */
  insertSql(args) { // eslint-disable-line no-unused-vars
    throw new Error("'insertSql' not implemented")
  }

  /**
   * Runs upsert.
   * @param {UpsertSqlArgsType} args - Options object.
   * @returns {Promise<void>} - Resolves when complete.
   */
  async upsert(args) {
    this._assertNotReadOnly()
    const sql = this.upsertSql(args)

    await this.query(sql)
  }

  /**
   * Runs last insert id.
   * @abstract
   * @param {QueryOptions} [_options] - Query ownership options.
   * @returns {Promise<number>} - Resolves with the last insert id.
   */
  lastInsertID(_options = {}) {
    throw new Error(`${this.constructor.name}#lastInsertID not implemented`)
  }

  /**
   * Runs convert value.
   * @param {ReturnType<typeof JSON.parse>} value - Value to use.
   * @returns {ReturnType<typeof JSON.parse>} - The convert value.
   */
  _convertValue(value) {
    if (typeof value === "boolean") {
      return value ? 1 : 0
    }

    // isDate instead of instanceof: a Date created in another realm (e.g. the console REPL) would
    // fail instanceof, skip this conversion, and serialize as an empty SQL value downstream.
    if (isDate(value)) {
      return formatDateForDatabase(value, {databaseType: this.getType()})
    }

    // JSON-encode plain objects/arrays so they land in JSON/text columns as valid
    // JSON. Without this, drivers like mysql's escape() turn an object into
    // `key` = value assignment pairs (its `SET ?` form), producing invalid SQL in
    // a value position. Only PLAIN objects and arrays are encoded — class
    // instances (e.g. model records, which are circular via _changes) and Buffers
    // pass through untouched, since JSON.stringify on a record throws on its
    // circular structure and a record is never a valid column value to serialize.
    if (this._isJsonEncodableValue(value)) {
      return JSON.stringify(value)
    }

    return value
  }

  /**
   * Whether a value is a plain object or array that should be JSON-encoded for a
   * JSON/text column. Excludes Buffers and class instances (e.g. model records).
   * @param {ReturnType<typeof JSON.parse>} value - Value to test.
   * @returns {boolean} - Whether to JSON-encode the value.
   */
  _isJsonEncodableValue(value) {
    if (value === null || typeof value !== "object") return false
    if (typeof Buffer !== "undefined" && Buffer.isBuffer(value)) return false
    if (Array.isArray(value)) return true

    const prototype = Object.getPrototypeOf(value)

    return prototype === Object.prototype || prototype === null
  }

  /**
   * Runs options.
   * @abstract
   * @returns {import("../query-parser/options.js").default} - The options options.
   */
  options() {
    throw new Error("'options' not implemented.")
  }

  /**
   * Runs quote.
   * @param {ReturnType<typeof JSON.parse>} value - Value to use.
   * @returns {number | string} - The quote.
   */
  quote(value) {
    if (typeof value == "number") return value

    const escapedValue = this.escape(value)
    const result = `"${escapedValue}"`

    return result
  }

  /**
   * Runs quote column.
   * @param {string} columnName - Column name.
   * @returns {string} - The quote column.
   */
  quoteColumn(columnName) {
    return this.options().quoteColumnName(columnName)
  }

  /**
   * Runs quote index.
   * @param {string} columnName - Column name.
   * @returns {string} - The quote index.
   */
  quoteIndex(columnName) {
    return this.options().quoteIndexName(columnName)
  }

  /**
   * Runs quote table.
   * @param {string} tableName - Table name.
   * @returns {string} - The quote table.
   */
  quoteTable(tableName) {
    return this.options().quoteTableName(tableName)
  }

  /**
   * Runs new query.
   * @returns {Query} - The new query.
   */
  newQuery() {
    const handler = new Handler()

    return new Query({
      driver: this,
      handler
    })
  }

  /**
   * Runs select.
   * @param {string} tableName - Table name.
   * @returns {Promise<QueryResultType>} - Resolves with the select.
   */
  async select(tableName) {
    const query = this.newQuery()

    const sql = query
      .from(tableName)
      .toSql()

    return await this.query(sql)
  }

  /**
   * Runs set id seq.
   * @param {number | undefined} newIdSeq - New id seq.
   * @returns {void} - No return value.
   */
  setIdSeq(newIdSeq) {
    this.idSeq = newIdSeq
  }

  /**
   * Runs should set auto increment when primary key.
   * @abstract
   * @returns {boolean} - Whether set auto increment when primary key.
   */
  shouldSetAutoIncrementWhenPrimaryKey() {
    throw new Error(`'shouldSetAutoIncrementWhenPrimaryKey' not implemented`)
  }

  /**
   * Runs supports default primary key uuid.
   * @returns {boolean} - Whether supports default primary key uuid.
   */
  supportsDefaultPrimaryKeyUUID() { return false }

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
  async insertWithExplicitPrimaryKey({options, sql, tableName}) {
    void tableName

    return await this.query(sql, options)
  }

  /**
   * Runs supports insert into returning.
   * @abstract
   * @returns {boolean} - Whether supports insert into returning.
   */
  supportsInsertIntoReturning() { return false }

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
  supportsCrossDatabaseReferences() { return false }

  /**
   * Runs table exists.
   * @param {string} tableName - Table name.
   * @returns {Promise<boolean>} - Resolves with Whether table exists.
   */
  async tableExists(tableName) {
    const tables = await this.getTables()
    const table = tables.find((table) => table.getName() == tableName)

    if (table) return true

    return false
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
    await this._waitForOperationLease(options.operationOwner)

    if (this._transactionsCount > 0) {
      return await this._runTransactionAttempt(callback, options)
    }

    const args = this.getArgs()
    const maxAttempts = optionalPositiveInteger(args.deadlockMaxRetries, "deadlockMaxRetries") ?? 8
    const configuredBaseWaitMs = optionalPositiveInteger(args.deadlockBaseWaitMs, "deadlockBaseWaitMs")
    const deadlockMaxWaitMs = optionalPositiveInteger(args.deadlockMaxWaitMs, "deadlockMaxWaitMs") ?? 1000
    let attempt = 0

    while (true) {
      attempt++
      const attemptStartedAtMs = this._nowMs()

      try {
        return await this._runTransactionAttempt(callback, options)
      } catch (error) {
        if (error instanceof VelociousDatabaseAfterCommitCallbackError) throw error.callbackError
        if (!(error instanceof Error)) throw error

        const retryInfo = this.retryableDatabaseError(error)
        const willRetry = Boolean(retryInfo.deadlock && attempt < maxAttempts && this._transactionsCount == 0)

        if (willRetry) {
          this._reportDeadlockRetryDiagnostic({
            attempt,
            contentionKind: retryInfo.contentionKind || "deadlock",
            error,
            maxAttempts,
            transactionAttemptDurationMs: Math.max(0, this._nowMs() - attemptStartedAtMs),
            willRetry
          })

          // An explicitly-configured base wins so the tuning knob is effective even on drivers
          // whose classifier supplies its own `waitMs` (MySQL/MariaDB return a fixed 50ms for
          // deadlocks); otherwise honor that classifier hint, then fall back to 50ms.
          const baseWaitMs = configuredBaseWaitMs ?? (typeof retryInfo.waitMs == "number" && retryInfo.waitMs > 0 ? retryInfo.waitMs : 50)

          // Full-jitter exponential backoff: wait a uniform-random duration in
          // [0, min(base * 2^(attempt-1), cap)]. The doubling ceiling spreads retries out as
          // contention persists, and the jitter de-correlates transactions that deadlocked in
          // lockstep so they stop re-colliding on the same wait (the linear `base * attempt`
          // this replaces had every victim retry after an identical delay). `attempt` is
          // 1-based here, so 2^(attempt-1) is 1, 2, 4, ... The cap keeps the tail sub-second.
          const ceilingWaitMs = Math.min(baseWaitMs * (2 ** (attempt - 1)), deadlockMaxWaitMs)
          const jitteredWaitMs = Math.floor(Math.random() * (ceilingWaitMs + 1))

          const loggedContentionKind = retryInfo.contentionKind || "transaction contention"

          this.logger.warn(`Retrying transaction after ${loggedContentionKind} (attempt ${attempt}/${maxAttempts})`)
          await this._waitMs(jitteredWaitMs)
          continue
        }

        throw error
      }
    }
  }

  /**
   * Waits `ms` milliseconds. Isolated in its own method so tests can observe (and skip) the
   * deadlock-retry backoff without a real timer.
   * @param {number} ms - Milliseconds to wait.
   * @returns {Promise<void>} - Resolves after the delay.
   */
  async _waitMs(ms) {
    await wait(ms)
  }

  /**
   * Returns the clock used for transaction-attempt diagnostics.
   * @returns {number} - Monotonic milliseconds where available.
   */
  _nowMs() {
    return nowMs()
  }

  /**
   * Starts best-effort deadlock diagnostics without joining the retry control flow. Subclasses may
   * add bounded driver-specific context; capture and event-listener failures cannot affect retry.
   * @param {{attempt: number, contentionKind: "deadlock" | "lock-wait-timeout", error: Error, maxAttempts: number, transactionAttemptDurationMs: number, willRetry: boolean}} args - Retry metadata.
   * @returns {void}
   */
  _reportDeadlockRetryDiagnostic({attempt, contentionKind, error, maxAttempts, transactionAttemptDurationMs, willRetry}) {
    let snapshot

    try {
      const queryDiagnostic = this._failedQueryDiagnostics.get(error)

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
      })
    } catch (diagnosticError) {
      this._reportDeadlockDiagnosticPipelineFailure(diagnosticError)
      return
    }

    let driverContextResult

    try {
      driverContextResult = this._deadlockDiagnosticContext(snapshot)
    } catch (diagnosticError) {
      this._reportDeadlockDiagnosticPipelineFailure(diagnosticError)
      return
    }

    const hasPromiseContract = driverContextResult instanceof Promise

    void Promise.resolve(driverContextResult)
      .then((driverContext) => {
        if (!hasPromiseContract) throw new Error("Database deadlock diagnostic context must return a Promise")

        const context = {
          ...snapshot,
          ...driverContext
        }
        const payload = {
          context,
          error: new Error(willRetry
            ? `Database transaction ${contentionKind} will be retried`
            : `Database transaction ${contentionKind} exhausted its retry budget`)
        }
        const errorEvents = this.configuration.getErrorEvents()

        try {
          errorEvents.emit("database-deadlock-retry", payload)
        } catch (eventError) {
          this.logger.warn("Database deadlock retry diagnostic listener failed", {error: eventError})
        }

        try {
          errorEvents.emit("all-error", {...payload, errorType: "database-deadlock-retry"})
        } catch (eventError) {
          this.logger.warn("Database deadlock retry all-error listener failed", {error: eventError})
        }
      })
      .catch((diagnosticError) => this._reportDeadlockDiagnosticPipelineFailure(diagnosticError))
  }

  /**
   * Returns pool identity only when this driver was stamped by a pool.
   * @returns {{databaseIdentifier?: string, databaseIdentifierFingerprint?: string, databaseIdentityFingerprint?: string}} - Safe pool identity.
   */
  _poolDiagnosticIdentityContext() {
    if (this._databaseIdentifier === undefined || !this._databaseIdentityFingerprint) return {}

    const identifierFingerprintInput = typeof this._databaseIdentifier === "string"
      ? this._databaseIdentifier
      : `invalid:${typeof this._databaseIdentifier}`
    const databaseIdentifierFingerprint = `sha256:${sha256Hex(`database-logical-identifier:v1\0${identifierFingerprintInput}`)}`

    return {
      databaseIdentifier: REDACTED_DIAGNOSTIC_LABEL,
      databaseIdentifierFingerprint,
      databaseIdentityFingerprint: this._databaseIdentityFingerprint
    }
  }

  /**
   * Builds the bounded operation portion of an immutable retry snapshot.
   * @returns {{operationName?: string, operationNameFingerprint?: string}} - Safe operation fields.
   */
  _operationDiagnosticContext() {
    const rawOperationName = this._connectionCheckoutName

    if (rawOperationName === undefined) return {}
    if (typeof rawOperationName !== "string") {
      return {
        operationName: REDACTED_DIAGNOSTIC_LABEL,
        operationNameFingerprint: `sha256:${sha256Hex(`database-operation:v1\0invalid:${typeof rawOperationName}`)}`
      }
    }

    const scannedOperationName = rawOperationName.slice(0, OPERATION_NAME_SCAN_LIMIT)
    const operationNameFingerprint = `sha256:${sha256Hex(`database-operation:v1\0${scannedOperationName}\0length:${rawOperationName.length}`)}`

    return {
      operationName: REDACTED_DIAGNOSTIC_LABEL,
      operationNameFingerprint
    }
  }

  /**
   * Reports an unexpected detached diagnostics failure without changing transaction control flow.
   * @param {ReturnType<typeof JSON.parse>} diagnosticError - Diagnostics failure.
   * @returns {void}
   */
  _reportDeadlockDiagnosticPipelineFailure(diagnosticError) {
    const normalizedError = diagnosticError instanceof Error
      ? diagnosticError
      : new Error("Database deadlock retry diagnostic failed", {cause: diagnosticError})
    const payload = {
      context: {stage: "database-deadlock-retry-diagnostic"},
      error: normalizedError
    }
    let errorEvents

    try {
      errorEvents = this.configuration.getErrorEvents()
    } catch (reportingError) {
      this.logger.warn("Database deadlock retry diagnostic pipeline reporting failed", {error: normalizedError, reportingError})
      return
    }

    try {
      errorEvents.emit("framework-error", payload)
    } catch (reportingError) {
      this.logger.warn("Database deadlock retry framework-error listener failed", {error: normalizedError, reportingError})
    }

    try {
      errorEvents.emit("all-error", {...payload, errorType: "framework-error"})
    } catch (reportingError) {
      this.logger.warn("Database deadlock retry all-error listener failed", {error: normalizedError, reportingError})
    }
  }

  /**
   * Builds driver-specific deadlock context. The base driver has no server diagnostic source.
   * @param {DeadlockRetryDiagnosticSnapshot} _snapshot - Immutable retry snapshot.
   * @returns {Promise<Record<string, ReturnType<typeof JSON.parse>>>} - Safe context fields.
   */
  async _deadlockDiagnosticContext(_snapshot) {
    return {}
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
    const savePointName = this.generateSavePointName()
    /** @type {TransactionCallbackFrame} */
    const callbackFrame = {
      afterCommitCallbacks: [],
      beforeCommitCallbacks: []
    }
    let transactionStarted = false
    let savePointStarted = false

    this._transactionCallbackFrames.push(callbackFrame)

    try {
      if (this._transactionsCount == 0) {
        this.logger.debug("Start transaction")
        await this.startTransaction(options)
        transactionStarted = true
      } else {
        this.logger.debug("Start savepoint", savePointName)
        await this.startSavePoint(savePointName, options)
        savePointStarted = true
      }
    } catch (error) {
      this._transactionCallbackFrames.pop()
      throw error
    }

    let result

    try {
      result = await callback()
      await this._runBeforeCommitCallbacks(callbackFrame)

      if (savePointStarted) {
        this.logger.debug("Release savepoint", savePointName)
        await this.releaseSavePoint(savePointName, options)
      }

      if (transactionStarted) {
        this.logger.debug("Commit transaction")
        await this.commitTransaction(options)
      }
    } catch (error) {
      if (error instanceof Error) {
        this.logger.debug("Transaction error", error.message)
      } else {
        this.logger.debug("Transaction error", error)
      }

      try {
        let transactionRolledBack = false

        if (savePointStarted) {
          this.logger.debug("Rollback savepoint", savePointName)
          try {
            await this.rollbackSavePoint(savePointName, options)
          } catch (savePointError) {
            const message = savePointError instanceof Error ? savePointError.message : `${savePointError}`

            // MySQL sometimes drops savepoints unexpectedly; fall back to rolling back the full transaction
            if (message.includes("SAVEPOINT") || message.includes("ER_SP_DOES_NOT_EXIST")) {
              this.logger.debug("Savepoint rollback failed; rolling back entire transaction instead")
              await this.rollbackTransaction(options)
              transactionRolledBack = true
            } else {
              throw savePointError
            }
          }
        }

        // Only roll back if a transaction is still open. A nested savepoint whose rollback failed
        // falls back to rolling back the whole transaction (above), which already closed it and
        // dropped the count to 0; rolling back again here would issue a second ROLLBACK and drive
        // `_transactionsCount` below zero, which would then defeat the outermost deadlock-retry guard.
        if (transactionStarted && !transactionRolledBack && this._transactionsCount > 0) {
          this.logger.debug("Rollback transaction")
          await this.rollbackTransaction(options)
        }
      } finally {
        this._transactionCallbackFrames.pop()
      }

      throw error
    }

    try {
      await this._commitTransactionCallbackFrame()
    } catch (error) {
      throw new VelociousDatabaseAfterCommitCallbackError(error)
    }

    return result
  }

  /**
   * Registers a guard to run after the current transaction callback succeeds and before its
   * outer commit or nested savepoint release.
   * @param {() => void | Promise<void>} callback - Guard callback.
   * @param {Pick<QueryOptions, "operationOwner">} [options] - Callback ownership.
   * @returns {Promise<void>} - Resolves when the guard has been registered.
   */
  async beforeCommit(callback, options = {}) {
    await this._waitForOperationLease(options.operationOwner)

    const currentFrame = this._transactionCallbackFrames[this._transactionCallbackFrames.length - 1]

    if (!currentFrame) throw new Error("beforeCommit requires an active transaction")

    currentFrame.beforeCommitCallbacks.push(callback)
  }

  /**
   * Runs a callback after the surrounding transaction commits.
   * If no transaction is active, the callback runs immediately.
   * @param {() => void | Promise<void>} callback - Callback.
   * @param {Pick<QueryOptions, "operationOwner">} [options] - Callback ownership.
   * @returns {Promise<void>} - Resolves when the callback has been registered or run.
   */
  async afterCommit(callback, options = {}) {
    await this._waitForOperationLease(options.operationOwner)

    const currentFrame = this._transactionCallbackFrames[this._transactionCallbackFrames.length - 1]

    if (!currentFrame) {
      await callback()
      return
    }

    currentFrame.afterCommitCallbacks.push(callback)
  }

  /**
   * Whether a transaction is currently open on this connection.
   * @returns {boolean} - Whether inside a transaction.
   */
  insideTransaction() { return this._transactionsCount > 0 }

  /**
   * Returns the completion promise identifying the current outer transaction.
   * @returns {Promise<void>} Resolves after that transaction commits or rolls back.
   */
  transactionCompletion() { return this._transactionCompletionPromise }

  /**
   * Runs start transaction.
   * @param {Pick<QueryOptions, "operationOwner">} [options] - Transaction ownership.
   * @returns {Promise<void>} - Resolves when complete.
   */
  async startTransaction(options = {}) {
    while (true) {
      /** @type {import("../operation-lease.js").default | undefined} */
      let blockingOperationLease

      await this._transactionsActionsMutex.sync(async () => {
        const operationLease = this._operationLease

        if (operationLease && options.operationOwner !== operationLease.owner) {
          blockingOperationLease = operationLease
          return
        }

        await this._runProfiledTransactionAction("start", async () => {
          await this._startTransactionAction(options)
        })
        this._transactionsCount++

        if (this._transactionsCount === 1) {
          this._transactionCompletionPromise = new Promise((resolve) => {
            this._resolveTransactionCompletion = resolve
          })
        }
      })

      if (!blockingOperationLease) return

      await blockingOperationLease.wait(options.operationOwner)
    }
  }

  /**
   * Runs start transaction action.
   * @param {Pick<QueryOptions, "operationOwner">} [options] - Transaction ownership.
   * @returns {Promise<void>} - Resolves when complete.
   */
  async _startTransactionAction(options = {}) {
    await this.query("BEGIN TRANSACTION", options)
  }

  /**
   * Runs commit transaction.
   * @param {Pick<QueryOptions, "operationOwner">} [options] - Transaction ownership.
   * @returns {Promise<void>} - Resolves when complete.
   */
  async commitTransaction(options = {}) {
    await this._transactionsActionsMutex.sync(async () => {
      await this._runProfiledTransactionAction("commit", async () => {
        await this._commitTransactionAction(options)
      })
      this._transactionsCount--
      this._resolveCompletedTransaction()
    })
  }

  /** Resolves the current outer transaction completion when it has finished. */
  _resolveCompletedTransaction() {
    if (this._transactionsCount !== 0) return

    const resolve = this._resolveTransactionCompletion

    this._resolveTransactionCompletion = undefined
    if (resolve) resolve()
  }

  /**
   * Runs commit transaction action.
   * @param {Pick<QueryOptions, "operationOwner">} [options] - Transaction ownership.
   * @returns {Promise<void>} - Resolves when complete.
   */
  async _commitTransactionAction(options = {}) {
    await this.query("COMMIT", options)
  }

  /**
   * Times a physical transaction action only when test profiling is active.
   * @template T
   * @param {"start" | "commit" | "rollback"} action - Transaction action.
   * @param {() => Promise<T>} callback - Physical action callback.
   * @returns {Promise<T>} - Callback result.
   */
  async _runProfiledTransactionAction(action, callback) {
    const profileContext = currentTestProfileContext(this.configuration)

    if (!profileContext) return await callback()

    const startedAtMs = nowMs()
    let failed = true

    try {
      const result = await callback()

      failed = false
      return result
    } finally {
      profileContext.profiler.recordDatabaseTransaction(profileContext, {
        action,
        durationMs: nowMs() - startedAtMs,
        failed
      })
    }
  }

  /**
   * Starts an optional physical-query profile attempt without retaining SQL.
   * @param {string} sql - Original SQL used only to derive its redacted diagnostic.
   * @returns {TestProfileQueryAttempt | undefined} - Active profile handle.
   */
  _startProfiledQueryAttempt(sql) {
    const context = currentTestProfileContext(this.configuration)

    if (!context) return undefined

    return {
      context,
      diagnostic: sqlDiagnostic(sql),
      startedAtMs: nowMs()
    }
  }

  /**
   * Completes an optional physical-query profile attempt.
   * @param {TestProfileQueryAttempt | undefined} attempt - Profile handle.
   * @param {boolean} failed - Whether the physical driver call failed.
   * @returns {void}
   */
  _finishProfiledQueryAttempt(attempt, failed) {
    if (!attempt) return

    attempt.context.profiler.recordDatabaseQuery(attempt.context, {
      durationMs: nowMs() - attempt.startedAtMs,
      failed,
      ...attempt.diagnostic
    })
  }

  /**
   * Runs every guard registered to the transaction frame.
   * @param {TransactionCallbackFrame} callbackFrame - Frame whose guards are completing.
   * @returns {Promise<void>} - Resolves when every guard accepts the commit.
   */
  async _runBeforeCommitCallbacks(callbackFrame) {
    for (const callback of callbackFrame.beforeCommitCallbacks) {
      await callback()
    }
  }

  /**
   * Merges committed callbacks into the parent transaction frame or runs them when the outermost commit completes.
   * @returns {Promise<void>} - Resolves when complete.
   */
  async _commitTransactionCallbackFrame() {
    const committedFrame = this._transactionCallbackFrames.pop()

    if (!committedFrame || committedFrame.afterCommitCallbacks.length === 0) return

    const parentFrame = this._transactionCallbackFrames[this._transactionCallbackFrames.length - 1]

    if (parentFrame) {
      parentFrame.afterCommitCallbacks.push(...committedFrame.afterCommitCallbacks)
      return
    }

    for (const callback of committedFrame.afterCommitCallbacks) {
      await callback()
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
    const rows = await this.query(sql, options)

    for (const row of Array.isArray(rows) ? rows : []) {
      yield row
    }
  }

  /**
   * Runs query.
   * @param {string} sql - SQL string.
   * @param {QueryOptions} [options] - Query options.
   * @returns {Promise<QueryResultType>} - Resolves with the query.
   */
  async query(sql, options = {}) {
    await this._waitForOperationLease(options.operationOwner)
    this._assertWritableQuery(sql)

    let tries = 0
    const maxTries = 5
    const requestTiming = this.configuration.getCurrentRequestTiming()
    const logQuery = options.logQuery ?? this._queryLoggingEnabled()
    const sourceStack = logQuery ? (options.sourceStack || Error().stack) : undefined
    const querySql = this._querySqlWithProcessListComment(sql, options)

    while (tries < maxTries) {
      tries++

      try {
        return await this._queryActualWithLogging({originalSql: sql, querySql}, {...options, logQuery, sourceStack}, requestTiming, tries)
      } catch (error) {
        if (!(error instanceof Error)) throw error

        this._failedQueryDiagnostics.set(error, sqlDiagnostic(sql))

        // A deliberately-aborted query must never be silently re-run — its
        // connection was destroyed on purpose, so treat it as terminal.
        if (error instanceof QueryAbortedError) throw error

        const retryInfo = this.retryableDatabaseError(error)

        if (options.retry !== false && tries < maxTries && retryInfo.retry) {
          if (retryInfo.reconnect) {
            if (this._transactionsCount > 0) {
              throw new Error(`Cannot reconnect while a transaction is active (${this._transactionsCount}). Original error: ${error.message}`, {cause: error})
            }

            await this.reconnect()
          }

          const waitMs = typeof retryInfo.waitMs === "number" && Number.isFinite(retryInfo.waitMs) ? retryInfo.waitMs : 100

          if (waitMs > 0) await wait(waitMs)
          this.logger.warn(`Retrying query because failed with: ${error.stack}`)
          // Retry
        } else {
          throw error
        }
      }
    }

    throw new Error("'query' unexpected came here")
  }

  /**
   * Executes a mutation and returns the number of rows changed by that statement.
   * @param {string} sql - Mutation SQL string.
   * @param {QueryOptions} [options] - Query ownership options.
   * @returns {Promise<number>} - Affected row count.
   */
  async affectedRows(sql, options = {}) {
    await this._waitForOperationLease(options.operationOwner)
    this._assertWritableQuery(sql)

    return await coordinateSharedTransactionConnection(this, async () => {
      await this.beforeQuery(sql, options)

      try {
        const profileAttempt = this._startProfiledQueryAttempt(sql)
        let failed = true

        try {
          const affectedRows = await this._affectedRowsActual(sql)

          failed = false
          return affectedRows
        } finally {
          this._finishProfiledQueryAttempt(profileAttempt, failed)
        }
      } finally {
        await this.afterQuery(sql, options)
      }
    }, options.operationOwner)
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
  async _queryActualWithLogging({originalSql, querySql}, options, requestTiming, tries) {
    const startedAtMs = nowMs()
    const previousActiveQuery = this._activeQuery
    this._activeQuery = {
      annotations: getDatabaseAnnotations(),
      logName: options.logName || "SQL",
      sqlPreview: this._debugSqlPreview(originalSql),
      startedAtUnixMs: Date.now()
    }
    let result

    try {
      const runQueryActualWithHooks = async () => await this._queryActualWithHooks(querySql, options, originalSql)

      if (requestTiming && tries === 1) {
        result = await requestTiming.measureDbQuery(runQueryActualWithHooks)
      } else if (requestTiming) {
        result = await requestTiming.measure("db", runQueryActualWithHooks)
      } else {
        result = await runQueryActualWithHooks()
      }
    } finally {
      this._activeQuery = previousActiveQuery
    }

    const elapsedMs = nowMs() - startedAtMs

    if (options.logQuery !== false) {
      await this._logQuery({
        elapsedMs,
        logName: options.logName || "SQL",
        sourceStack: options.sourceStack,
        sql: originalSql
      })
    }

    if (this._schemaCacheInvalidatingSql(originalSql)) {
      this.clearSchemaCache()
    }

    return result
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
      await this.beforeQuery(sql, options)

      try {
        const profileAttempt = this._startProfiledQueryAttempt(originalSql)
        let failed = true

        try {
          const result = await this._queryActual(sql, options)

          failed = false
          return result
        } finally {
          this._finishProfiledQueryAttempt(profileAttempt, failed)
        }
      } finally {
        await this.afterQuery(sql, options)
      }
    }, options.operationOwner)
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
    const now = Date.now()
    const activeQuery = this._activeQuery

    return {
      activeQuery: activeQuery ? {...activeQuery, runningMs: Math.max(0, now - activeQuery.startedAtUnixMs)} : null,
      checkoutAgeMs: this._connectionCheckedOutAtUnixMs ? Math.max(0, now - this._connectionCheckedOutAtUnixMs) : undefined,
      checkedOutAtUnixMs: this._connectionCheckedOutAtUnixMs,
      checkoutName: this._connectionCheckoutName,
      driverClass: this.constructor.name,
      idSeq: this.idSeq,
      openTransactions: this._transactionsCount,
      schemaCacheEntries: this._schemaCache.size
    }
  }

  /**
   * Returns a bounded prefix of `sql` for lightweight diagnostic scanning.
   * @param {string} sql - SQL string.
   * @param {number} limit - Maximum code units to inspect.
   * @returns {string} - Prefix of `sql`.
   */
  _diagnosticSqlPrefix(sql, limit) {
    return sql.length <= limit ? sql : sql.slice(0, limit)
  }

  /**
   * Runs debug sql preview.
   * @param {string} sql - SQL to preview.
   * @returns {string} - Normalized truncated SQL preview for diagnostics.
   */
  _debugSqlPreview(sql) {
    const prefix = this._diagnosticSqlPrefix(sql, SQL_PREVIEW_SCAN_LIMIT)

    return prefix
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 500)
  }

  /**
   * Runs query sql with process list comment.
   * @param {string} sql - SQL string.
   * @param {QueryOptions} options - Query options.
   * @returns {string} - SQL string with a leading process-list comment when annotations exist.
   */
  _querySqlWithProcessListComment(sql, options) {
    if (options.processListComment === false) return sql

    const parts = []

    if (this._connectionCheckoutName) {
      parts.push(`checkout="${this._processListCommentValue(this._connectionCheckoutName)}"`)
    }

    const annotations = getDatabaseAnnotations()

    if (annotations.length > 0) {
      parts.push(`annotations="${this._processListCommentValue(annotations.join(" > "))}"`)
    }

    if (parts.length === 0) return sql

    return `/* velocious ${parts.join(" ")} */ ${sql}`
  }

  /**
   * Runs process list comment value.
   * @param {string} value - Raw process-list comment value.
   * @returns {string} - Sanitized process-list comment value.
   */
  _processListCommentValue(value) {
    let sanitized = ""

    for (const character of value) {
      const codePoint = character.codePointAt(0)

      sanitized += codePoint !== undefined && (codePoint < 32 || codePoint === 127) ? " " : character
    }

    return sanitized
      .replace(/\*\//g, "* /")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 200)
      .replace(/"/g, "'")
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
    let i = startIndex
    const len = sql.length

    while (i < len && i < limit) {
      const char = sql[i]

      if (char === "\ufeff" || /\s/.test(char)) {
        i++
        continue
      }

      if (char === "/" && sql[i + 1] === "*") {
        const close = sql.indexOf("*/", i + 2)

        if (close === -1 || close + 2 > limit) {
          return {incomplete: true, index: i, token: undefined}
        }

        i = close + 2
        continue
      }

      if (char === "-" && sql[i + 1] === "-") {
        const newline = sql.indexOf("\n", i + 2)

        if (newline === -1) {
          return {incomplete: false, index: len, token: undefined}
        }

        if (newline + 1 > limit) {
          return {incomplete: true, index: i, token: undefined}
        }

        i = newline + 1
        continue
      }

      let token = ""

      while (i < len) {
        const c = sql[i]

        if (/\s/.test(c) || c === "\ufeff") break
        if (c === "/" && sql[i + 1] === "*") break
        if (c === "-" && sql[i + 1] === "-") break

        token += c
        i++
      }

      return {incomplete: false, token: token.toLowerCase(), index: i}
    }

    if (i >= len) {
      return {incomplete: false, index: len, token: undefined}
    }

    return {incomplete: true, index: i, token: undefined}
  }

  /**
   * Runs schema cache invalidating sql.
   * @param {string} sql - SQL string.
   * @returns {boolean} - Whether the SQL should invalidate schema metadata.
   */
  _schemaCacheInvalidatingSql(sql) {
    const first = this._readSqlToken(sql, 0, SCHEMA_INVALIDATION_SCAN_LIMIT)

    if (first.incomplete) return true

    const firstToken = first.token

    if (!firstToken) return false
    if (/^(create|alter|drop|rename)$/.test(firstToken)) return true

    if (firstToken === "comment") {
      const next = this._readSqlToken(sql, first.index, SCHEMA_INVALIDATION_SCAN_LIMIT)

      return next.incomplete || next.token === "on"
    }

    if (firstToken === "exec" || firstToken === "execute") {
      const next = this._readSqlToken(sql, first.index, SCHEMA_INVALIDATION_SCAN_LIMIT)

      return next.incomplete || next.token === "sp_rename"
    }

    if (firstToken === "if") {
      let index = first.index

      while (true) {
        const result = this._readSqlToken(sql, index, SCHEMA_INVALIDATION_SCAN_LIMIT)

        if (result.incomplete) return true
        if (!result.token) return false
        if (result.token === "begin") {
          const ddlResult = this._readSqlToken(sql, result.index, SCHEMA_INVALIDATION_SCAN_LIMIT)

          return ddlResult.incomplete || /^(create|alter|drop|rename)$/.test(ddlResult.token || "")
        }

        index = result.index
      }
    }

    return false
  }

  /**
   * Runs query logging enabled.
   * @returns {boolean} - Whether query logging is enabled for this driver.
   */
  _queryLoggingEnabled() {
    if (!this.configuration) return true
    if (!this.configuration.getQueryLoggingEnabled()) return false

    const logger = new Logger("SQL", {configuration: this.configuration})

    return logger.isLevelEnabled("info")
  }

  /**
   * Runs log query.
   * @param {object} args - Options object.
   * @param {number} args.elapsedMs - Elapsed milliseconds.
   * @param {string} args.logName - Query log subject.
   * @param {string | undefined} args.sourceStack - Source stack.
   * @param {string} args.sql - SQL string.
   * @returns {Promise<void>} - Resolves when complete.
   */
  async _logQuery({elapsedMs, logName, sourceStack, sql}) {
    const logger = new Logger(logName, {configuration: this.configuration})
    const sourceLine = this._querySourceLine(sourceStack)
    const message = sourceLine
      ? `(${formatElapsedMs(elapsedMs)})  ${sql}\n  ↳ ${sourceLine}`
      : `(${formatElapsedMs(elapsedMs)})  ${sql}`

    await logger.info(message)
  }

  /**
   * Runs query source line.
   * @param {string | undefined} sourceStack - Source stack.
   * @returns {string | undefined} - Source line when an application frame is available.
   */
  _querySourceLine(sourceStack) {
    if (!sourceStack) return undefined

    const applicationDirectory = this.configuration
      ? this.configuration.getDirectoryIfAvailable()
      : undefined

    if (!applicationDirectory) return undefined

    const error = new Error("Query source")

    error.stack = sourceStack

    return BacktraceCleaner.getApplicationSourceLine(error, {
      applicationDirectory,
      frameworkSourceDirectory: this.configuration.getEnvironmentHandler().getFrameworkSourceDirectory()
    })
  }

  /**
   * Runs query actual.
   * @abstract
   * @param {string} sql - SQL string.
   * @param {QueryOptions} [options] - Query options (carries the optional abort signal).
   * @returns {Promise<QueryResultType>} - Resolves with the query actual.
   */
  _queryActual(sql, options) { // eslint-disable-line no-unused-vars
    throw new Error(`queryActual not implemented`)
  }

  /**
   * Executes a mutation and returns its affected row count.
   * @abstract
   * @param {string} sql - Mutation SQL string.
   * @returns {Promise<number>} - Affected row count.
   */
  _affectedRowsActual(sql) { // eslint-disable-line no-unused-vars
    throw new Error(`affectedRowsActual not implemented`)
  }

  /**
   * Runs query to sql.
   * @abstract
   * @param {Query} _query - Query instance.
   * @returns {string} - SQL string.
   */
  queryToSql(_query) { throw new Error("queryToSql not implemented") }

  /**
   * Runs retryable database error.
   * @param {Error} _error - Error instance.
   * @returns {RetryableDatabaseErrorResult} - Retry info.
   */
  retryableDatabaseError(_error) {
    return {retry: false, reconnect: false}
  }

  /**
   * Runs assert writable query.
   * @param {string} sql - SQL string.
   * @returns {void} - No return value.
   */
  _assertWritableQuery(sql) {
    if (!this.isReadOnly()) return
    if (!this._sqlLooksLikeWrite(sql)) return

    throw new Error("Database is read-only")
  }

  /**
   * Runs assert not read only.
   * @returns {void} - No return value.
   */
  _assertNotReadOnly() {
    if (this.isReadOnly()) {
      throw new Error("Database is read-only")
    }
  }

  /**
   * Runs sql looks like write.
   * @param {string} sql - SQL string.
   * @returns {boolean} - SQL representation.
   */
  _sqlLooksLikeWrite(sql) {
    const normalized = sql.trim().toLowerCase()

    if (!normalized) return false

    if (
      normalized.startsWith("select") ||
      normalized.startsWith("show") ||
      normalized.startsWith("pragma") ||
      normalized.startsWith("explain") ||
      normalized.startsWith("describe")
    ) {
      return false
    }

    if (normalized.startsWith("with")) {
      const withMatch = normalized.match(/^\s*with[\s\S]+?\)\s*(select|insert|update|delete|merge|replace)\b/)

      if (withMatch) {
        return withMatch[1] !== "select"
      }

      return false
    }

    const keywordMatch = normalized.match(/^\s*(\w+)/)
    const keyword = keywordMatch ? keywordMatch[1] : ""

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
    ].includes(keyword)
  }

  /**
   * Runs is read only.
   * @returns {boolean} - Whether read only.
   */
  isReadOnly() {
    return Boolean(this.getArgs().readOnly)
  }

  /**
   * Runs rollback transaction.
   * @param {Pick<QueryOptions, "operationOwner">} [options] - Transaction ownership.
   * @returns {Promise<void>} - Resolves when complete.
   */
  async rollbackTransaction(options = {}) {
    await this._transactionsActionsMutex.sync(async () => {
      try {
        await this._runProfiledTransactionAction("rollback", async () => {
          await this._rollbackTransactionAction(options)
        })
      } finally {
        this._transactionsCount--
        this._resolveCompletedTransaction()

        // A rolled-back transaction may have reverted DDL (e.g. a CREATE TABLE
        // run lazily inside the transaction), so any cached schema metadata is
        // now stale and must be invalidated. Without this, a later tableExists()
        // check can report a table that the rollback already removed, so callers
        // skip recreating it and then fail with "no such table".
        this.clearSchemaCache()
      }
    })
  }

  /**
   * Runs rollback transaction action.
   * @param {Pick<QueryOptions, "operationOwner">} [options] - Transaction ownership.
   * @returns {Promise<void>} - Resolves when complete.
   */
  async _rollbackTransactionAction(options = {}) {
    await this.query("ROLLBACK", options)
  }

  /**
   * Runs generate save point name.
   * @returns {string} - The generate save point name.
   */
  generateSavePointName() {
    return `sp${new UUID(4).format().replaceAll("-", "")}`
  }

  /**
   * Runs start save point.
   * @param {string} savePointName - Save point name.
   * @param {Pick<QueryOptions, "operationOwner">} [options] - Transaction ownership.
   * @returns {Promise<void>} - Resolves when complete.
   */
  async startSavePoint(savePointName, options = {}) {
    await this._transactionsActionsMutex.sync(async () => {
      await this._startSavePointAction(savePointName, options)
    })
  }

  /**
   * Runs start save point action.
   * @param {string} savePointName - Save point name.
   * @param {Pick<QueryOptions, "operationOwner">} [options] - Transaction ownership.
   * @returns {Promise<void>} - Resolves when complete.
   */
  async _startSavePointAction(savePointName, options = {}) {
    await this.query(`SAVEPOINT ${savePointName}`, options)
  }

  /**
   * Runs rename column.
   * @param {string} tableName - Table name.
   * @param {string} oldColumnName - Previous column name.
   * @param {string} newColumnName - New column name.
   * @returns {Promise<void>} - Resolves when complete.
   */
  async renameColumn(tableName, oldColumnName, newColumnName) {
    this._assertNotReadOnly()
    const tableColumn = new TableColumn(oldColumnName)

    tableColumn.setNewName(newColumnName)

    const tableData = new TableData(tableName)

    tableData.addColumn(tableColumn)

    const alterTableSQLs = await this.alterTableSQLs(tableData)

    for (const alterTableSQL of alterTableSQLs) {
      await this.query(alterTableSQL)
    }
  }

  /**
   * Runs release save point.
   * @param {string} savePointName - Save point name.
   * @param {Pick<QueryOptions, "operationOwner">} [options] - Transaction ownership.
   * @returns {Promise<void>} - Resolves when complete.
   */
  async releaseSavePoint(savePointName, options = {}) {
    await this._transactionsActionsMutex.sync(async () => {
      await this._releaseSavePointAction(savePointName, options)
    })
  }

  /**
   * Runs release save point action.
   * @param {string} savePointName - Save point name.
   * @param {Pick<QueryOptions, "operationOwner">} [options] - Transaction ownership.
   * @returns {Promise<void>} - Resolves when complete.
   */
  async _releaseSavePointAction(savePointName, options = {}) {
    try {
      await this.query(`RELEASE SAVEPOINT ${savePointName}`, options)
    } catch (error) {
      const message = error instanceof Error ? error.message : `${error}`

      // Savepoint may already be gone if the database rolled back automatically
      if (message.toLowerCase().includes("savepoint") && message.toLowerCase().includes("does not exist")) {
        this.logger.debug(`Release savepoint ignored because it no longer exists: ${savePointName}`)
        return
      }

      throw error
    }
  }

  /**
   * Runs rollback save point.
   * @param {string} savePointName - Save point name.
   * @param {Pick<QueryOptions, "operationOwner">} [options] - Transaction ownership.
   * @returns {Promise<void>} - Resolves when complete.
   */
  async rollbackSavePoint(savePointName, options = {}) {
    await this._transactionsActionsMutex.sync(async () => {
      await this._rollbackSavePointAction(savePointName, options)
    })
  }

  /**
   * Runs rollback save point action.
   * @param {string} savePointName - Save point name.
   * @param {Pick<QueryOptions, "operationOwner">} [options] - Transaction ownership.
   * @returns {Promise<void>} - Resolves when complete.
   */
  async _rollbackSavePointAction(savePointName, options = {}) {
    await this.query(`ROLLBACK TO SAVEPOINT ${savePointName}`, options)
  }

  /**
   * Truncates the given table snapshot. Drivers can override this to issue one batch.
   * @protected
   * @param {Array<import("./base-table.js").default>} tables - Eligible tables for this cleanup attempt.
   * @returns {Promise<void>} - Resolves when every table has been cleaned.
   */
  async truncateTables(tables) {
    const truncateErrors = []

    for (const table of tables) {
      try {
        await table.truncate({cascade: true})
      } catch (error) {
        truncateErrors.push(error)
      }
    }

    if (truncateErrors.length > 0) throw truncateErrors[0]
  }

  /**
   * Runs truncate all tables.
   * @returns {Promise<void>} - Resolves when complete.
   */
  async truncateAllTables() {
    this._assertNotReadOnly()
    let tables = (await this.getTables()).filter((table) => table.getName() != "schema_migrations")

    if (tables.length == 0) return

    await this.withDisabledForeignKeys(async () => {
      for (let tries = 1; tries <= 6; tries++) {
        try {
          await this.truncateTables(tables)
          return
        } catch (error) {
          console.error(error)

          if (tries == 6) throw error

          // A truncate failed — the schema cache may still list a table that was
          // dropped out from under us (e.g. a db:rollback test that left the
          // shared DB rolled back). Clear it so the next pass re-reads the live
          // table list and no longer tries to truncate a table that is gone.
          this.clearSchemaCache()
          tables = (await this.getTables()).filter((table) => table.getName() != "schema_migrations")

          if (tables.length == 0) return
        }
      }
    })
    await this.flushPendingWrites()
  }

  /**
   * Runs update.
   * @param {UpdateSqlArgsType} args - Options object.
   * @returns {Promise<void>} - Resolves when complete.
   */
  async update(args) {
    this._assertNotReadOnly()
    const sql = this.updateSql(args)

    await this.query(sql)
  }

  /**
   * Runs update sql.
   * @abstract
   * @param {UpdateSqlArgsType} args - Options object.
   * @returns {string} - SQL string.
   */
  updateSql(args) { // eslint-disable-line no-unused-vars
    throw new Error("'disableForeignKeys' not implemented")
  }

  /**
   * Runs upsert sql.
   * @abstract
   * @param {UpsertSqlArgsType} args - Options object.
   * @returns {string} - SQL string.
   */
  upsertSql(args) { // eslint-disable-line no-unused-vars
    throw new Error("'upsertSql' not implemented")
  }

  /**
   * Runs disable foreign keys.
   * @abstract
   * @returns {Promise<void>} - Resolves when complete.
   */
  disableForeignKeys() {
    throw new Error("'disableForeignKeys' not implemented")
  }

  /**
   * Runs enable foreign keys.
   * @abstract
   * @returns {Promise<void>} - Resolves when complete.
   */
  enableForeignKeys() {
    throw new Error("'enableForeignKeys' not implemented")
  }

  /**
   * Runs with disabled foreign keys.
   * @param {() => void} callback - Callback function.
   * @returns {Promise<ReturnType<typeof JSON.parse>>} - Resolves with the with disabled foreign keys.
   */
  async withDisabledForeignKeys(callback) {
    await this.disableForeignKeys()

    try {
      return await callback()
    } finally {
      await this.enableForeignKeys()
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
    const acquired = await this._acquireAdvisoryLock(name, args)

    if (acquired) this._trackAdvisoryLock(name)

    return acquired
  }

  /**
   * Driver-specific blocking advisory-lock acquisition hook.
   * @abstract
   * @param {string} name - Lock name.
   * @param {{timeoutMs?: number | null}} [_args] - Lock timeout options.
   * @returns {Promise<boolean>} - Whether the lock was acquired.
   */
  _acquireAdvisoryLock(name, _args = {}) {
    throw new Error(`'_acquireAdvisoryLock' not implemented for ${this.constructor.name}`)
  }

  /**
   * Attempts to acquire a named advisory lock without blocking.
   * @param {string} name - Lock name.
   * @returns {Promise<boolean>} - Resolves to true if the lock was acquired, false if it was already held.
   */
  async tryAcquireAdvisoryLock(name) {
    const acquired = await this._tryAcquireAdvisoryLock(name)

    if (acquired) this._trackAdvisoryLock(name)

    return acquired
  }

  /**
   * Driver-specific non-blocking advisory-lock acquisition hook.
   * @abstract
   * @param {string} name - Lock name.
   * @returns {Promise<boolean>} - Whether the lock was acquired.
   */
  _tryAcquireAdvisoryLock(name) { // eslint-disable-line no-unused-vars
    throw new Error(`'_tryAcquireAdvisoryLock' not implemented for ${this.constructor.name}`)
  }

  /**
   * Releases a named advisory lock previously acquired on this connection.
   * @param {string} name - Lock name.
   * @returns {Promise<boolean>} - Resolves to true if the lock was held by this session and has now been released.
   */
  async releaseAdvisoryLock(name) {
    const released = await this._releaseAdvisoryLock(name)

    if (released) {
      this._untrackAdvisoryLock(name)
    } else {
      this._heldAdvisoryLocks.delete(name)
    }

    return released
  }

  /**
   * Driver-specific advisory-lock release hook.
   * @abstract
   * @param {string} name - Lock name.
   * @returns {Promise<boolean>} - Whether the lock was released.
   */
  _releaseAdvisoryLock(name) { // eslint-disable-line no-unused-vars
    throw new Error(`'_releaseAdvisoryLock' not implemented for ${this.constructor.name}`)
  }

  /**
   * Releases every advisory lock still tracked on this connection.
   * @returns {Promise<void>} - Resolves when every tracked lock is released.
   */
  async releaseHeldAdvisoryLocks() {
    /** @type {Error[]} */
    const errors = []

    for (const name of [...this._heldAdvisoryLocks.keys()]) {
      while (this._heldAdvisoryLocks.has(name)) {
        try {
          await this.releaseAdvisoryLock(name)
        } catch (error) {
          errors.push(error instanceof Error ? error : new Error(`Failed to release advisory lock ${JSON.stringify(name)}`, {cause: error}))
          break
        }
      }
    }

    if (errors.length == 1) throw errors[0]
    if (errors.length > 1) throw new AggregateError(errors, "Failed to release held advisory locks")
  }

  /**
   * Records one successful acquisition, including re-entrant acquisitions.
   * @param {string} name - Lock name.
   * @returns {void}
   */
  _trackAdvisoryLock(name) {
    this._heldAdvisoryLocks.set(name, (this._heldAdvisoryLocks.get(name) || 0) + 1)
  }

  /**
   * Removes one successful acquisition from the connection registry.
   * @param {string} name - Lock name.
   * @returns {void}
   */
  _untrackAdvisoryLock(name) {
    const remainingCount = (this._heldAdvisoryLocks.get(name) || 0) - 1

    if (remainingCount > 0) {
      this._heldAdvisoryLocks.set(name, remainingCount)
    } else {
      this._heldAdvisoryLocks.delete(name)
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
  isAdvisoryLockHeld(name) { // eslint-disable-line no-unused-vars
    throw new Error(`'isAdvisoryLockHeld' not implemented for ${this.constructor.name}`)
  }
}
