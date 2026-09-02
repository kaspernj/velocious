export type CreateIndexSqlArgs = {
    /**
     * - Columns to include in the index.
     */
    columns: Array<string | import("./../table-data/table-column.js").default>;
    /**
     * - Skip creation if the index already exists.
     */
    ifNotExists?: boolean;
    /**
     * - Explicit index name to use.
     */
    name?: string;
    /**
     * - Whether the index should enforce uniqueness.
     */
    unique?: boolean;
    /**
     * - Name of the table to add the index to.
     */
    tableName: string;
};
export type RemoveIndexSqlArgs = {
    /**
     * - Index name to drop.
     */
    name: string;
    /**
     * - Name of the table the index belongs to.
     */
    tableName: string;
};
export type DropTableSqlArgsType = {
    /**
     * - Whether dependent objects should be dropped too.
     */
    cascade?: boolean;
    /**
     * - Skip dropping if the table does not exist.
     */
    ifExists?: boolean;
};
export type DeleteSqlArgsType = {
    /**
     * - Table name to delete from.
     */
    tableName: string;
    /**
     * - Conditions used to build the delete WHERE clause.
     */
    conditions: {
        [key: string]: ReturnType<typeof JSON.parse>;
    };
};
export type InsertSqlArgsType = {
    /**
     * - Column names for `rows` inserts.
     */
    columns?: string[];
    /**
     * - Column/value pairs for a single-row insert.
     */
    data?: {
        [key: string]: ReturnType<typeof JSON.parse>;
    };
    /**
     * - Whether this insert should be treated as multi-row.
     */
    multiple?: boolean;
    /**
     * - Column names to return after insert.
     */
    returnLastInsertedColumnNames?: string[];
    /**
     * - Row values for a multi-row insert.
     */
    rows?: Array<Array<ReturnType<typeof JSON.parse>>>;
    /**
     * - Table name to insert into.
     */
    tableName: string;
};
export type QueryRowType = Record<string, ReturnType<typeof JSON.parse>>;
export type QueryResultType = Array<QueryRowType>;
export type TransactionCallbackFrame = {
    /**
     * - Callbacks to merge or run after commit.
     */
    afterCommitCallbacks: Array<() => void | Promise<void>>;
    /**
     * - Guards to run before this frame completes.
     */
    beforeCommitCallbacks: Array<() => void | Promise<void>>;
};
export type RetryableDatabaseErrorResult = {
    /**
     * - Whether the error should be retried.
     */
    retry: boolean;
    /**
     * - Whether to reconnect before retrying.
     */
    reconnect: boolean;
    /**
     * - Whether the error is a transaction deadlock/lock-wait-timeout that should retry the whole transaction.
     */
    deadlock?: boolean;
    /**
     * - Classified transaction contention kind.
     */
    contentionKind?: "deadlock" | "lock-wait-timeout";
    /**
     * - Override the max retry attempts.
     */
    maxTries?: number;
    /**
     * - Wait time before retrying in milliseconds.
     */
    waitMs?: number;
};
export type QueryOptions = {
    /**
     * - Query log subject.
     */
    logName?: string;
    /**
     * - Whether to log the query.
     */
    logQuery?: boolean;
    /**
     * - Whether to add process-list comments to the query.
     */
    processListComment?: boolean;
    /**
     * - Whether retryable errors may retry the query; defaults to true.
     */
    retry?: boolean;
    /**
     * - Whether to ensure the configured database session time zone before the query.
     */
    sessionTimeZone?: boolean;
    /**
     * - Internal SQLite flag selecting native multi-statement script execution.
     */
    sqliteScript?: boolean;
    /**
     * - Aborts the in-flight query (destroying its connection) when it fires.
     */
    signal?: AbortSignal;
    /**
     * - Stack captured at the caller boundary.
     */
    sourceStack?: string;
    /**
     * - Opaque owner for an operation-leased connection.
     */
    operationOwner?: symbol;
};
export type DeadlockRetryDiagnosticSnapshot = {
    /**
     * - One-based transaction attempt.
     */
    attempt: number;
    /**
     * - Classified contention kind.
     */
    contentionKind: "deadlock" | "lock-wait-timeout";
    /**
     * - Redacted logical database pool identifier marker.
     */
    databaseIdentifier?: string;
    /**
     * - Opaque logical database pool identity.
     */
    databaseIdentifierFingerprint?: string;
    /**
     * - Opaque physical database identity.
     */
    databaseIdentityFingerprint?: string;
    /**
     * - Driver type.
     */
    driverType: string;
    /**
     * - Configured transaction attempt budget.
     */
    maxAttempts: number;
    /**
     * - Redacted operation-name marker.
     */
    operationName?: string;
    /**
     * - Opaque operation-name identity.
     */
    operationNameFingerprint?: string;
    /**
     * - Normalized SQL-shape fingerprint.
     */
    sqlFingerprint?: string;
    /**
     * - SQL verb.
     */
    sqlOperation?: string;
    /**
     * - Error-event stage.
     */
    stage: string;
    /**
     * - Duration of the failed outer attempt.
     */
    transactionAttemptDurationMs: number;
    /**
     * - Whether another outer transaction attempt will run.
     */
    willRetry: boolean;
};
export type TestProfileQueryAttempt = {
    /**
     * - Captured async attribution.
     */
    context: import("../../testing/test-profiler.js").TestProfileAsyncContext;
    /**
     * - Redacted statement diagnostic.
     */
    diagnostic: {
        sqlFingerprint: string;
        sqlOperation: string;
    };
    /**
     * - Physical attempt start time.
     */
    startedAtMs: number;
};
export type ActiveQueryDebugSnapshot = {
    /**
     * - Database annotations active when the query started.
     */
    annotations: string[];
    /**
     * - Query log name.
     */
    logName: string;
    /**
     * - Query start timestamp.
     */
    startedAtUnixMs: number;
    /**
     * - Query runtime in milliseconds.
     */
    runningMs: number;
    /**
     * - Truncated SQL preview.
     */
    sqlPreview: string;
};
export type DatabaseConnectionDebugSnapshot = {
    /**
     * - Currently running query, if any.
     */
    activeQuery: ActiveQueryDebugSnapshot | null;
    /**
     * - Checkout start timestamp for active checkouts.
     */
    checkedOutAtUnixMs: number | undefined;
    /**
     * - Active checkout age in milliseconds.
     */
    checkoutAgeMs: number | undefined;
    /**
     * - Human-readable checkout name.
     */
    checkoutName: string | undefined;
    /**
     * - Driver class name.
     */
    driverClass: string;
    /**
     * - Pool checkout ID sequence.
     */
    idSeq: number | undefined;
    /**
     * - Number of open transaction frames.
     */
    openTransactions: number;
    /**
     * - Number of cached schema metadata entries.
     */
    schemaCacheEntries: number;
};
export type ActiveQueryState = {
    /**
     * - Database annotations active when the query started.
     */
    annotations: string[];
    /**
     * - Query log name.
     */
    logName: string;
    /**
     * - Query start timestamp.
     */
    startedAtUnixMs: number;
    /**
     * - Truncated SQL preview.
     */
    sqlPreview: string;
};
export type UpdateSqlArgsType = {
    /**
     * - Conditions used to build the update WHERE clause.
     */
    conditions: object;
    /**
     * - Column/value pairs to update.
     */
    data: object;
    /**
     * - Table name to update.
     */
    tableName: string;
};
export type UpsertSqlArgsType = {
    /**
     * - Columns that define a conflict.
     */
    conflictColumns: string[];
    /**
     * - Column/value pairs to insert.
     */
    data: object;
    /**
     * - Table name to upsert into.
     */
    tableName: string;
    /**
     * - Columns to update on conflict.
     */
    updateColumns: string[];
};
export type SqlTokenResult = {
    /**
     * - Whether the scan hit its bound before finishing trivia/token parsing.
     */
    incomplete: boolean;
    /**
     * - Lowercased token when parsing completed; undefined when no token was found.
     */
    token: string | undefined;
    /**
     * - Index immediately after the parsed token or trivia.
     */
    index: number;
};
import Logger from "../../logger.js";
import Query from "../query/index.js";
import Mutex from "epic-locks/build/mutex.js";
export default class VelociousDatabaseDriversBase {
    _args: import("../../configuration-types.js").DatabaseConfigurationType;
    configuration: import("../../configuration.js").default;
    mutex: Mutex;
    logger: Logger;
    _transactionsCount: number;
    _transactionsActionsMutex: Mutex;
    _physicalConnectionMutex: Mutex;
    _connectionCheckedOutAtUnixMs: number | undefined;
    /**
     * Id seq.
     * @type {number | undefined} */
    idSeq: number | undefined;
    /**
     * Narrows the runtime value to the documented type.
     * @type {TransactionCallbackFrame[]} */
    _transactionCallbackFrames: TransactionCallbackFrame[];
    /** @type {Promise<void>} */
    _transactionCompletionPromise: Promise<void>;
    /** @type {(() => void) | undefined} */
    _resolveTransactionCompletion: (() => void) | undefined;
    /**
     * Narrows the runtime value to the documented type.
     * @type {Map<string, Promise<ReturnType<typeof JSON.parse>>>} */
    _schemaCache: Map<string, Promise<ReturnType<typeof JSON.parse>>>;
    /**
     * Narrows the runtime value to the documented type.
     * @type {(() => void) | undefined} */
    _schemaCacheInvalidator: (() => void) | undefined;
    /**
     * Narrows the runtime value to the documented type.
     * @type {string | undefined} */
    _connectionCheckoutName: string | undefined;
    /** @type {string | undefined} */
    _databaseIdentifier: string | undefined;
    /** @type {string | undefined} */
    _databaseIdentityFingerprint: string | undefined;
    /**
     * Active query.
     * @type {ActiveQueryState | null} */
    _activeQuery: ActiveQueryState | null;
    /** @type {WeakMap<Error, {sqlFingerprint: string, sqlOperation: string}>} */
    _failedQueryDiagnostics: WeakMap<Error, {
        sqlFingerprint: string;
        sqlOperation: string;
    }>;
    /** @type {Map<string, number>} */
    _heldAdvisoryLocks: Map<string, number>;
    /**
     * Exclusive operation lease installed by a single-multi-use pool.
     * @type {import("../operation-lease.js").default | undefined}
     */
    _operationLease: import("../operation-lease.js").default | undefined;
    /**
     * Runs constructor.
     * @param {import("../../configuration-types.js").DatabaseConfigurationType} config - Configuration object.
     * @param {import("../../configuration.js").default} configuration - Configuration instance.
     */
    constructor(config: import("../../configuration-types.js").DatabaseConfigurationType, configuration: import("../../configuration.js").default);
    /**
     * Serializes access to one physical database session.
     * @template T
     * @param {() => Promise<T>} callback - Physical driver operation.
     * @returns {Promise<T>} - Operation result.
     */
    _runPhysicalConnectionRequest<T>(callback: () => Promise<T>): Promise<T>;
    /**
     * Cleans driver-specific session state before this logical connection is reusable.
     * Drivers whose physical sessions cannot be safely reset should dispose them here.
     * @returns {Promise<void>} - Resolves when the next checkout cannot observe prior session state.
     */
    cleanupSessionStateAfterCheckout(): Promise<void>;
    /**
     * Runs add foreign key.
     * @param {string} tableName - Table name.
     * @param {string} columnName - Column name.
     * @param {string} referencedTableName - Referenced table name.
     * @param {string} referencedColumnName - Referenced column name.
     * @param {object} args - Options object.
     * @returns {Promise<void>} - Resolves when complete.
     */
    addForeignKey(tableName: string, columnName: string, referencedTableName: string, referencedColumnName: string, args: object): Promise<void>;
    /**
     * Runs remove foreign key.
     * @param {string} tableName - Table name.
     * @param {import("./base-foreign-key.js").default} foreignKeyMetadata - Foreign key metadata.
     * @returns {Promise<void>} - Resolves when complete.
     */
    removeForeignKey(tableName: string, foreignKeyMetadata: import("./base-foreign-key.js").default): Promise<void>;
    /**
     * Runs alter table sqls.
     * @abstract
     * @param {import("../table-data/index.js").default} _tableData - Table data.
     * @returns {Promise<string[]>} - Resolves with SQL statements.
     */
    alterTableSQLs(_tableData: import("../table-data/index.js").default): Promise<string[]>;
    /**
     * Runs connect.
     * @abstract
     * @returns {Promise<void>} - Resolves when complete.
     */
    connect(): Promise<void>;
    /**
     * Releases tracked advisory locks and closes the physical database connection.
     * @returns {Promise<void>} - Resolves when cleanup and close complete.
     */
    close(): Promise<void>;
    /**
     * Driver-specific physical close hook.
     * @returns {Promise<void>} - Resolves when the underlying connection closes.
     */
    _close(): Promise<void>;
    /**
     * Flushes pending writes that the driver delayed for persistence.
     * @returns {Promise<void>} - Resolves when pending writes are durable.
     */
    flushPendingWrites(): Promise<void>;
    /**
     * Returns whether delayed persistence writes remain.
     * @returns {boolean} - Whether writes remain.
     */
    hasPendingWrites(): boolean;
    /**
     * Deletes this driver's physical database storage without opening it.
     * @returns {Promise<void>} - Resolves after deletion.
     */
    deleteDatabaseStorage(): Promise<void>;
    /**
     * Runs set connection checkout name.
     * @param {string | undefined} name - Human-readable name for this active checkout.
     * @returns {Promise<void>} - Resolves when complete.
     */
    setConnectionCheckoutName(name: string | undefined): Promise<void>;
    /**
     * Runs clear connection checkout name.
     * @returns {Promise<void>} - Resolves when complete.
     */
    clearConnectionCheckoutName(): Promise<void>;
    /**
     * Sets the pool-owned identity used by safe database diagnostics.
     * @param {{databaseIdentifier: string, databaseIdentityFingerprint: string}} identity - Pool-stamped identity redacted at diagnostic snapshot time.
     * @returns {void}
     */
    setPoolDiagnosticIdentity({ databaseIdentifier, databaseIdentityFingerprint }: {
        databaseIdentifier: string;
        databaseIdentityFingerprint: string;
    }): void;
    /**
     * Runs reconnect.
     * @returns {Promise<void>} - Resolves when complete.
     */
    reconnect(): Promise<void>;
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
    createDatabaseSql(databaseName: string, args?: {
        ifNotExists?: boolean;
        databaseCharset?: string;
        databaseCollation?: string;
    }): string[];
    /**
     * Runs drop database sql.
     * @abstract
     * @param {string} databaseName - Database name.
     * @param {object} [args] - Options object.
     * @param {boolean} [args.ifExists] - Whether if exists.
     * @returns {string[]} - SQL statements.
     */
    dropDatabaseSql(databaseName: string, args?: {
        ifExists?: boolean;
    }): string[];
    /**
     * Runs create index sqls.
     * @abstract
     * @param {CreateIndexSqlArgs} indexData - Index data.
     * @returns {Promise<string[]>} - Resolves with SQL statements.
     */
    createIndexSQLs(indexData: CreateIndexSqlArgs): Promise<string[]>;
    /**
     * Runs remove index sqls.
     * @abstract
     * @param {RemoveIndexSqlArgs} indexData - Index data.
     * @returns {Promise<string[]>} - Resolves with SQL statements.
     */
    removeIndexSQLs(indexData: RemoveIndexSqlArgs): Promise<string[]>;
    /**
     * Runs create table.
     * @param {import("../table-data/index.js").default} tableData - Table data.
     * @returns {Promise<void>} - Resolves when complete.
     */
    createTable(tableData: import("../table-data/index.js").default): Promise<void>;
    /**
     * Runs create table sql.
     * @abstract
     * @param {import("../table-data/index.js").default} tableData - Table data.
     * @returns {Promise<string[]>} - Resolves with SQL statements.
     */
    createTableSql(tableData: import("../table-data/index.js").default): Promise<string[]>;
    /**
     * Runs delete.
     * @param {DeleteSqlArgsType} args - Options object.
     * @returns {Promise<void>} - Resolves when complete.
     */
    delete(args: DeleteSqlArgsType): Promise<void>;
    /**
     * Runs delete sql.
     * @abstract
     * @param {DeleteSqlArgsType} args - Options object.
     * @returns {string} - SQL string.
     */
    deleteSql(args: DeleteSqlArgsType): string;
    /**
     * Runs drop table.
     * @param {string} tableName - Table name.
     * @param {DropTableSqlArgsType} [args] - Options object.
     * @returns {Promise<void>} - Resolves when complete.
     */
    dropTable(tableName: string, args?: DropTableSqlArgsType): Promise<void>;
    /**
     * Runs drop table sqls.
     * @abstract
     * @param {string} tableName - Table name.
     * @param {DropTableSqlArgsType} [args] - Options object.
     * @returns {Promise<string[]>} - Resolves with SQL statements.
     */
    dropTableSQLs(tableName: string, args?: DropTableSqlArgsType): Promise<string[]>;
    /**
     * Runs escape.
     * @abstract
     * @param {ReturnType<typeof JSON.parse>} value - Value to use.
     * @returns {ReturnType<typeof JSON.parse>} - The escape.
     */
    escape(value: ReturnType<typeof JSON.parse>): ReturnType<typeof JSON.parse>;
    /**
     * Runs get args.
     * @returns {import("../../configuration-types.js").DatabaseConfigurationType} - The args.
     */
    getArgs(): import("../../configuration-types.js").DatabaseConfigurationType;
    /**
     * Runs get configuration.
     * @returns {import("../../configuration.js").default} - The configuration.
     */
    getConfiguration(): import("../../configuration.js").default;
    /**
     * Installs an operation lease atomically with ordinary transaction admission.
     * @param {import("../operation-lease.js").default} operationLease - Active lease.
     * @returns {Promise<void>} - Resolves once the lease owns transaction admission.
     */
    setOperationLease(operationLease: import("../operation-lease.js").default): Promise<void>;
    /**
     * Clears the matching operation lease.
     * @param {import("../operation-lease.js").default} operationLease - Lease to clear.
     * @returns {void}
     */
    clearOperationLease(operationLease: import("../operation-lease.js").default): void;
    /**
     * Waits for an unrelated operation lease to release.
     * @param {symbol | undefined} operationOwner - Candidate operation owner.
     * @returns {Promise<void>}
     */
    _waitForOperationLease(operationOwner: symbol | undefined): Promise<void>;
    /**
     * Runs get id seq.
     * @returns {number | undefined} - The id seq.
     */
    getIdSeq(): number | undefined;
    /**
     * Runs primary key type.
     * @returns {string} - Configured primary key type, defaulting to UUID.
     */
    primaryKeyType(): string;
    /**
     * Clears cached schema metadata for this driver instance.
     * @returns {void} - No return value.
     */
    clearSchemaCache(): void;
    /**
     * Clears only the metadata cached on this driver instance.
     * @returns {void} - No return value.
     */
    _clearLocalSchemaCache(): void;
    /**
     * Runs set schema cache invalidator.
     * @param {() => void} invalidator - Callback used to clear schema caches that share this driver pool.
     * @returns {void} - No return value.
     */
    setSchemaCacheInvalidator(invalidator: () => void): void;
    /**
     * Runs schema cache enabled.
     * @returns {boolean} - Whether schema metadata caching is enabled.
     */
    _schemaCacheEnabled(): boolean;
    /**
     * Runs cached schema metadata.
     * @template T
     * @param {string} cacheKey - Schema cache key.
     * @param {() => Promise<T>} callback - Cache miss callback.
     * @returns {Promise<T>} - Resolves with the cached metadata.
     */
    _cachedSchemaMetadata<T>(cacheKey: string, callback: () => Promise<T>): Promise<T>;
    /**
     * Runs cached table schema metadata.
     * @template T
     * @param {string} tableName - Table name.
     * @param {string} metadataName - Metadata name.
     * @param {() => Promise<T>} callback - Cache miss callback.
     * @returns {Promise<T>} - Resolves with the cached table metadata.
     */
    _cachedTableSchemaMetadata<T>(tableName: string, metadataName: string, callback: () => Promise<T>): Promise<T>;
    /**
     * Runs schema cache return value.
     * @param {ReturnType<typeof JSON.parse>} value - Cached value.
     * @returns {ReturnType<typeof JSON.parse>} - Value returned to callers.
     */
    _schemaCacheReturnValue(value: ReturnType<typeof JSON.parse>): ReturnType<typeof JSON.parse>;
    /**
     * Runs get tables.
     * @abstract
     * @returns {Promise<Array<import("./base-table.js").default>>} - Resolves with the tables.
     */
    getTables(): Promise<Array<import("./base-table.js").default>>;
    /**
     * Runs structure sql.
     * @returns {Promise<string | null>} - Resolves with SQL string.
     */
    structureSql(): Promise<string | null>;
    /**
     * Executes a whole multi-statement structure SQL script in a single round-trip when
     * the driver supports it, running on this connection (so the caller's foreign-key
     * handling applies). Returns true if it ran the whole script; false when the caller
     * should run the statements individually. The base driver has no batch path.
     * @param {string} _structureSql - Full multi-statement structure SQL.
     * @returns {Promise<boolean>} - Whether the script was executed as one batch.
     */
    execStructureScript(_structureSql: string): Promise<boolean>;
    /**
     * Runs get table by name.
     * @param {string} name - Name.
     * @param {object} [args] - Options object.
     * @param {boolean} args.throwError - Whether throw error.
     * @returns {Promise<import("./base-table.js").default | undefined>} - Resolves with the table by name.
     */
    getTableByName(name: string, args?: {
        throwError: boolean;
    }): Promise<import("./base-table.js").default | undefined>;
    /**
     * Runs missing table error message.
     * @param {string} name - Table name.
     * @param {string[]} tableNames - Available table names.
     * @returns {string} - Error message.
     */
    _missingTableErrorMessage(name: string, tableNames: string[]): string;
    /**
     * Runs get table by name or fail.
     * @param {string} name - Name.
     * @returns {Promise<import("./base-table.js").default>} - Resolves with the table by name or fail.
     */
    getTableByNameOrFail(name: string): Promise<import("./base-table.js").default>;
    /**
     * Runs get type.
     * @abstract
     * @returns {string} - The type.
     */
    getType(): string;
    /**
     * Whether this driver can combine unrelated alter-table operations into a
     * single `ALTER TABLE` statement (Rails' `supports_bulk_alter`).
     * @returns {boolean} - Whether bulk alter is supported.
     */
    supportsBulkAlter(): boolean;
    /**
     * Whether a bulk `ALTER TABLE` statement can also carry `ADD INDEX` clauses.
     * Only drivers that support this keep index adds inside the combined batch;
     * the rest execute each index as its own statement.
     * @returns {boolean} - Whether indexes can be added inside a bulk alter.
     */
    supportsBulkAlterIndexes(): boolean;
    /**
     * Runs insert.
     * @param {InsertSqlArgsType} args - Options object.
     * @returns {Promise<void>} - Resolves when complete.
     */
    insert(args: InsertSqlArgsType): Promise<void>;
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
    maxRowsPerInsert(): number;
    /**
     * Maximum serialized SQL size, in bytes, for a single `INSERT ... VALUES`
     * statement. Large text/JSON payloads can push a modest row count well beyond
     * database wire/protocol limits, so chunking also stops when the next row
     * would push the generated string over this threshold.
     *
     * Override via `maxInsertSqlBytes` in the database configuration.
     * @returns {number} - Maximum bytes per insert statement.
     */
    maxInsertSqlBytes(): number;
    /**
     * Maximum values in a single `IN (...)` cohort used by preloads, association
     * counts, and queryData aggregates. The default stays under SQLite's default
     * `MAX_VARIABLE_NUMBER` compile-time limit.
     *
     * Override via `maxInClauseValues` in the database configuration.
     * @returns {number} - Maximum values per IN clause cohort.
     */
    maxInClauseValues(): number;
    /**
     * Maximum serialized SQL size, in bytes, for a single cohort query used by
     * preloads, association counts, and queryData aggregates. Cohort chunking
     * stops when the next value would push the generated string over this threshold.
     *
     * Override via `maxQuerySqlBytes` in the database configuration.
     * @returns {number} - Maximum bytes per cohort query.
     */
    maxQuerySqlBytes(): number;
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
    chunkValues<T>(values: Array<T>, buildSql: (values: Array<T>) => string, { maxCount, maxBytes }?: {
        maxCount?: number;
        maxBytes?: number;
    }): Array<Array<T>>;
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
    _insertMultipleChunks(rows: Array<Array<ReturnType<typeof JSON.parse>>>, buildSql: (rows: Array<Array<ReturnType<typeof JSON.parse>>>) => string): Array<Array<Array<ReturnType<typeof JSON.parse>>>>;
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
    insertMultiple(tableName: string, columns: Array<string>, rows: Array<Array<ReturnType<typeof JSON.parse>>>): Promise<void>;
    /**
     * Runs insert sql.
     * @abstract
     * @param {InsertSqlArgsType} args - Options object.
     * @returns {string} - SQL string.
     */
    insertSql(args: InsertSqlArgsType): string;
    /**
     * Runs upsert.
     * @param {UpsertSqlArgsType} args - Options object.
     * @returns {Promise<void>} - Resolves when complete.
     */
    upsert(args: UpsertSqlArgsType): Promise<void>;
    /**
     * Runs last insert id.
     * @abstract
     * @param {QueryOptions} [_options] - Query ownership options.
     * @returns {Promise<number>} - Resolves with the last insert id.
     */
    lastInsertID(_options?: QueryOptions): Promise<number>;
    /**
     * Runs convert value.
     * @param {ReturnType<typeof JSON.parse>} value - Value to use.
     * @returns {ReturnType<typeof JSON.parse>} - The convert value.
     */
    _convertValue(value: ReturnType<typeof JSON.parse>): ReturnType<typeof JSON.parse>;
    /**
     * Whether a value is a plain object or array that should be JSON-encoded for a
     * JSON/text column. Excludes Buffers and class instances (e.g. model records).
     * @param {ReturnType<typeof JSON.parse>} value - Value to test.
     * @returns {boolean} - Whether to JSON-encode the value.
     */
    _isJsonEncodableValue(value: ReturnType<typeof JSON.parse>): boolean;
    /**
     * Runs options.
     * @abstract
     * @returns {import("../query-parser/options.js").default} - The options options.
     */
    options(): import("../query-parser/options.js").default;
    /**
     * Runs quote.
     * @param {ReturnType<typeof JSON.parse>} value - Value to use.
     * @returns {number | string} - The quote.
     */
    quote(value: ReturnType<typeof JSON.parse>): number | string;
    /**
     * Runs quote column.
     * @param {string} columnName - Column name.
     * @returns {string} - The quote column.
     */
    quoteColumn(columnName: string): string;
    /**
     * Runs quote index.
     * @param {string} columnName - Column name.
     * @returns {string} - The quote index.
     */
    quoteIndex(columnName: string): string;
    /**
     * Runs quote table.
     * @param {string} tableName - Table name.
     * @returns {string} - The quote table.
     */
    quoteTable(tableName: string): string;
    /**
     * Runs new query.
     * @returns {Query} - The new query.
     */
    newQuery(): Query;
    /**
     * Runs select.
     * @param {string} tableName - Table name.
     * @returns {Promise<QueryResultType>} - Resolves with the select.
     */
    select(tableName: string): Promise<QueryResultType>;
    /**
     * Runs set id seq.
     * @param {number | undefined} newIdSeq - New id seq.
     * @returns {void} - No return value.
     */
    setIdSeq(newIdSeq: number | undefined): void;
    /**
     * Runs should set auto increment when primary key.
     * @abstract
     * @returns {boolean} - Whether set auto increment when primary key.
     */
    shouldSetAutoIncrementWhenPrimaryKey(): boolean;
    /**
     * Runs supports default primary key uuid.
     * @returns {boolean} - Whether supports default primary key uuid.
     */
    supportsDefaultPrimaryKeyUUID(): boolean;
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
    insertWithExplicitPrimaryKey({ options, sql, tableName }: {
        options: QueryOptions;
        sql: string;
        tableName: string;
    }): Promise<QueryResultType>;
    /**
     * Runs supports insert into returning.
     * @abstract
     * @returns {boolean} - Whether supports insert into returning.
     */
    supportsInsertIntoReturning(): boolean;
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
    supportsCrossDatabaseReferences(): boolean;
    /**
     * Runs table exists.
     * @param {string} tableName - Table name.
     * @returns {Promise<boolean>} - Resolves with Whether table exists.
     */
    tableExists(tableName: string): Promise<boolean>;
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
    transaction<T>(callback: () => Promise<T>, options?: Pick<QueryOptions, "operationOwner">): Promise<T>;
    /**
     * Waits `ms` milliseconds. Isolated in its own method so tests can observe (and skip) the
     * deadlock-retry backoff without a real timer.
     * @param {number} ms - Milliseconds to wait.
     * @returns {Promise<void>} - Resolves after the delay.
     */
    _waitMs(ms: number): Promise<void>;
    /**
     * Returns the clock used for transaction-attempt diagnostics.
     * @returns {number} - Monotonic milliseconds where available.
     */
    _nowMs(): number;
    /**
     * Starts best-effort deadlock diagnostics without joining the retry control flow. Subclasses may
     * add bounded driver-specific context; capture and event-listener failures cannot affect retry.
     * @param {{attempt: number, contentionKind: "deadlock" | "lock-wait-timeout", error: Error, maxAttempts: number, transactionAttemptDurationMs: number, willRetry: boolean}} args - Retry metadata.
     * @returns {void}
     */
    _reportDeadlockRetryDiagnostic({ attempt, contentionKind, error, maxAttempts, transactionAttemptDurationMs, willRetry }: {
        attempt: number;
        contentionKind: "deadlock" | "lock-wait-timeout";
        error: Error;
        maxAttempts: number;
        transactionAttemptDurationMs: number;
        willRetry: boolean;
    }): void;
    /**
     * Returns pool identity only when this driver was stamped by a pool.
     * @returns {{databaseIdentifier?: string, databaseIdentifierFingerprint?: string, databaseIdentityFingerprint?: string}} - Safe pool identity.
     */
    _poolDiagnosticIdentityContext(): {
        databaseIdentifier?: string;
        databaseIdentifierFingerprint?: string;
        databaseIdentityFingerprint?: string;
    };
    /**
     * Builds the bounded operation portion of an immutable retry snapshot.
     * @returns {{operationName?: string, operationNameFingerprint?: string}} - Safe operation fields.
     */
    _operationDiagnosticContext(): {
        operationName?: string;
        operationNameFingerprint?: string;
    };
    /**
     * Reports an unexpected detached diagnostics failure without changing transaction control flow.
     * @param {ReturnType<typeof JSON.parse>} diagnosticError - Diagnostics failure.
     * @returns {void}
     */
    _reportDeadlockDiagnosticPipelineFailure(diagnosticError: ReturnType<typeof JSON.parse>): void;
    /**
     * Builds driver-specific deadlock context. The base driver has no server diagnostic source.
     * @param {DeadlockRetryDiagnosticSnapshot} _snapshot - Immutable retry snapshot.
     * @returns {Promise<Record<string, ReturnType<typeof JSON.parse>>>} - Safe context fields.
     */
    _deadlockDiagnosticContext(_snapshot: DeadlockRetryDiagnosticSnapshot): Promise<Record<string, ReturnType<typeof JSON.parse>>>;
    /**
     * Runs a single transaction attempt: starts a transaction (or a savepoint when nested), runs
     * `callback`, and commits — rolling back on error. {@link transaction} wraps this with deadlock
     * retry at the outermost level.
     * @template T
     * @param {() => Promise<T>} callback - Callback function.
     * @param {Pick<QueryOptions, "operationOwner">} options - Transaction ownership.
     * @returns {Promise<ReturnType<typeof JSON.parse>>} - Resolves with the transaction result.
     */
    _runTransactionAttempt<T>(callback: () => Promise<T>, options: Pick<QueryOptions, "operationOwner">): Promise<ReturnType<typeof JSON.parse>>;
    /**
     * Registers a guard to run after the current transaction callback succeeds and before its
     * outer commit or nested savepoint release.
     * @param {() => void | Promise<void>} callback - Guard callback.
     * @param {Pick<QueryOptions, "operationOwner">} [options] - Callback ownership.
     * @returns {Promise<void>} - Resolves when the guard has been registered.
     */
    beforeCommit(callback: () => void | Promise<void>, options?: Pick<QueryOptions, "operationOwner">): Promise<void>;
    /**
     * Runs a callback after the surrounding transaction commits.
     * If no transaction is active, the callback runs immediately.
     * @param {() => void | Promise<void>} callback - Callback.
     * @param {Pick<QueryOptions, "operationOwner">} [options] - Callback ownership.
     * @returns {Promise<void>} - Resolves when the callback has been registered or run.
     */
    afterCommit(callback: () => void | Promise<void>, options?: Pick<QueryOptions, "operationOwner">): Promise<void>;
    /**
     * Whether a transaction is currently open on this connection.
     * @returns {boolean} - Whether inside a transaction.
     */
    insideTransaction(): boolean;
    /**
     * Returns the completion promise identifying the current outer transaction.
     * @returns {Promise<void>} Resolves after that transaction commits or rolls back.
     */
    transactionCompletion(): Promise<void>;
    /**
     * Runs start transaction.
     * @param {Pick<QueryOptions, "operationOwner">} [options] - Transaction ownership.
     * @returns {Promise<void>} - Resolves when complete.
     */
    startTransaction(options?: Pick<QueryOptions, "operationOwner">): Promise<void>;
    /**
     * Runs start transaction action.
     * @param {Pick<QueryOptions, "operationOwner">} [options] - Transaction ownership.
     * @returns {Promise<void>} - Resolves when complete.
     */
    _startTransactionAction(options?: Pick<QueryOptions, "operationOwner">): Promise<void>;
    /**
     * Runs commit transaction.
     * @param {Pick<QueryOptions, "operationOwner">} [options] - Transaction ownership.
     * @returns {Promise<void>} - Resolves when complete.
     */
    commitTransaction(options?: Pick<QueryOptions, "operationOwner">): Promise<void>;
    /** Resolves the current outer transaction completion when it has finished. */
    _resolveCompletedTransaction(): void;
    /**
     * Runs commit transaction action.
     * @param {Pick<QueryOptions, "operationOwner">} [options] - Transaction ownership.
     * @returns {Promise<void>} - Resolves when complete.
     */
    _commitTransactionAction(options?: Pick<QueryOptions, "operationOwner">): Promise<void>;
    /**
     * Times a physical transaction action only when test profiling is active.
     * @template T
     * @param {"start" | "commit" | "rollback"} action - Transaction action.
     * @param {() => Promise<T>} callback - Physical action callback.
     * @returns {Promise<T>} - Callback result.
     */
    _runProfiledTransactionAction<T>(action: "start" | "commit" | "rollback", callback: () => Promise<T>): Promise<T>;
    /**
     * Starts an optional physical-query profile attempt without retaining SQL.
     * @param {string} sql - Original SQL used only to derive its redacted diagnostic.
     * @returns {TestProfileQueryAttempt | undefined} - Active profile handle.
     */
    _startProfiledQueryAttempt(sql: string): TestProfileQueryAttempt | undefined;
    /**
     * Completes an optional physical-query profile attempt.
     * @param {TestProfileQueryAttempt | undefined} attempt - Profile handle.
     * @param {boolean} failed - Whether the physical driver call failed.
     * @returns {void}
     */
    _finishProfiledQueryAttempt(attempt: TestProfileQueryAttempt | undefined, failed: boolean): void;
    /**
     * Runs every guard registered to the transaction frame.
     * @param {TransactionCallbackFrame} callbackFrame - Frame whose guards are completing.
     * @returns {Promise<void>} - Resolves when every guard accepts the commit.
     */
    _runBeforeCommitCallbacks(callbackFrame: TransactionCallbackFrame): Promise<void>;
    /**
     * Merges committed callbacks into the parent transaction frame or runs them when the outermost commit completes.
     * @returns {Promise<void>} - Resolves when complete.
     */
    _commitTransactionCallbackFrame(): Promise<void>;
    /**
     * Streams the rows of `sql` one at a time instead of buffering the whole result set, so a
     * caller can process an arbitrarily large result with bounded memory. This base implementation
     * falls back to a buffered {@link query} and yields its rows; drivers backed by a cursor-capable
     * client (the MySQL driver) override it with true server-side streaming.
     * @param {string} sql - SQL string to stream.
     * @param {QueryOptions} [options] - Query options, as for {@link query}.
     * @yields {Record<string, unknown>} - The result rows, one at a time.
     */
    queryStream(sql: string, options?: QueryOptions): AsyncGenerator<QueryRowType, void, unknown>;
    /**
     * Runs query.
     * @param {string} sql - SQL string.
     * @param {QueryOptions} [options] - Query options.
     * @returns {Promise<QueryResultType>} - Resolves with the query.
     */
    query(sql: string, options?: QueryOptions): Promise<QueryResultType>;
    /**
     * Executes a mutation and returns the number of rows changed by that statement.
     * @param {string} sql - Mutation SQL string.
     * @param {QueryOptions} [options] - Query ownership options.
     * @returns {Promise<number>} - Affected row count.
     */
    affectedRows(sql: string, options?: QueryOptions): Promise<number>;
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
    _queryActualWithLogging({ originalSql, querySql }: {
        originalSql: string;
        querySql: string;
    }, options: QueryOptions, requestTiming: import("../../http-server/client/request-timing.js").default | undefined, tries: number): Promise<QueryResultType>;
    /**
     * Runs query actual with before/after hooks.
     * @param {string} sql - SQL string.
     * @param {QueryOptions} options - Query options.
     * @param {string} originalSql - SQL before process-list comments.
     * @returns {Promise<QueryResultType>} - Resolves with the query.
     */
    _queryActualWithHooks(sql: string, options: QueryOptions, originalSql: string): Promise<QueryResultType>;
    /**
     * Hook that runs immediately before a SQL query is sent to the driver.
     * @param {string} _sql - SQL string.
     * @param {QueryOptions} _options - Query options.
     * @returns {Promise<void>} - Resolves when complete.
     */
    beforeQuery(_sql: string, _options: QueryOptions): Promise<void>;
    /**
     * Hook that runs immediately after a SQL query has completed or failed.
     * @param {string} _sql - SQL string.
     * @param {QueryOptions} _options - Query options.
     * @returns {Promise<void>} - Resolves when complete.
     */
    afterQuery(_sql: string, _options: QueryOptions): Promise<void>;
    /**
     * Runs get debug snapshot.
     * @returns {DatabaseConnectionDebugSnapshot} - Diagnostic snapshot for this connection.
     */
    getDebugSnapshot(): DatabaseConnectionDebugSnapshot;
    /**
     * Returns a bounded prefix of `sql` for lightweight diagnostic scanning.
     * @param {string} sql - SQL string.
     * @param {number} limit - Maximum code units to inspect.
     * @returns {string} - Prefix of `sql`.
     */
    _diagnosticSqlPrefix(sql: string, limit: number): string;
    /**
     * Runs debug sql preview.
     * @param {string} sql - SQL to preview.
     * @returns {string} - Normalized truncated SQL preview for diagnostics.
     */
    _debugSqlPreview(sql: string): string;
    /**
     * Runs query sql with process list comment.
     * @param {string} sql - SQL string.
     * @param {QueryOptions} options - Query options.
     * @returns {string} - SQL string with a leading process-list comment when annotations exist.
     */
    _querySqlWithProcessListComment(sql: string, options: QueryOptions): string;
    /**
     * Runs process list comment value.
     * @param {string} value - Raw process-list comment value.
     * @returns {string} - Sanitized process-list comment value.
     */
    _processListCommentValue(value: string): string;
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
    _readSqlToken(sql: string, startIndex: number, limit: number): SqlTokenResult;
    /**
     * Runs schema cache invalidating sql.
     * @param {string} sql - SQL string.
     * @returns {boolean} - Whether the SQL should invalidate schema metadata.
     */
    _schemaCacheInvalidatingSql(sql: string): boolean;
    /**
     * Runs query logging enabled.
     * @returns {boolean} - Whether query logging is enabled for this driver.
     */
    _queryLoggingEnabled(): boolean;
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
    _logQuery({ elapsedMs, error, logName, requestTiming, sourceStack, sql }: {
        elapsedMs: number;
        error?: Error;
        logName: string;
        requestTiming: import("../../http-server/client/request-timing.js").default | undefined;
        sourceStack: string | undefined;
        sql: string;
    }): Promise<void>;
    /**
     * Runs query source line.
     * @param {string | undefined} sourceStack - Source stack.
     * @returns {string | undefined} - Source line when an application frame is available.
     */
    _querySourceLine(sourceStack: string | undefined): string | undefined;
    /**
     * Runs query actual.
     * @abstract
     * @param {string} sql - SQL string.
     * @param {QueryOptions} [options] - Query options (carries the optional abort signal).
     * @returns {Promise<QueryResultType>} - Resolves with the query actual.
     */
    _queryActual(sql: string, options?: QueryOptions): Promise<QueryResultType>;
    /**
     * Executes a mutation and returns its affected row count.
     * @abstract
     * @param {string} sql - Mutation SQL string.
     * @returns {Promise<number>} - Affected row count.
     */
    _affectedRowsActual(sql: string): Promise<number>;
    /**
     * Runs query to sql.
     * @abstract
     * @param {Query} _query - Query instance.
     * @returns {string} - SQL string.
     */
    queryToSql(_query: Query): string;
    /**
     * Runs retryable database error.
     * @param {Error} _error - Error instance.
     * @returns {RetryableDatabaseErrorResult} - Retry info.
     */
    retryableDatabaseError(_error: Error): RetryableDatabaseErrorResult;
    /**
     * Runs assert writable query.
     * @param {string} sql - SQL string.
     * @returns {void} - No return value.
     */
    _assertWritableQuery(sql: string): void;
    /**
     * Runs assert not read only.
     * @returns {void} - No return value.
     */
    _assertNotReadOnly(): void;
    /**
     * Runs sql looks like write.
     * @param {string} sql - SQL string.
     * @returns {boolean} - SQL representation.
     */
    _sqlLooksLikeWrite(sql: string): boolean;
    /**
     * Runs is read only.
     * @returns {boolean} - Whether read only.
     */
    isReadOnly(): boolean;
    /**
     * Runs rollback transaction.
     * @param {Pick<QueryOptions, "operationOwner">} [options] - Transaction ownership.
     * @returns {Promise<void>} - Resolves when complete.
     */
    rollbackTransaction(options?: Pick<QueryOptions, "operationOwner">): Promise<void>;
    /**
     * Runs rollback transaction action.
     * @param {Pick<QueryOptions, "operationOwner">} [options] - Transaction ownership.
     * @returns {Promise<void>} - Resolves when complete.
     */
    _rollbackTransactionAction(options?: Pick<QueryOptions, "operationOwner">): Promise<void>;
    /**
     * Runs generate save point name.
     * @returns {string} - The generate save point name.
     */
    generateSavePointName(): string;
    /**
     * Runs start save point.
     * @param {string} savePointName - Save point name.
     * @param {Pick<QueryOptions, "operationOwner">} [options] - Transaction ownership.
     * @returns {Promise<void>} - Resolves when complete.
     */
    startSavePoint(savePointName: string, options?: Pick<QueryOptions, "operationOwner">): Promise<void>;
    /**
     * Runs start save point action.
     * @param {string} savePointName - Save point name.
     * @param {Pick<QueryOptions, "operationOwner">} [options] - Transaction ownership.
     * @returns {Promise<void>} - Resolves when complete.
     */
    _startSavePointAction(savePointName: string, options?: Pick<QueryOptions, "operationOwner">): Promise<void>;
    /**
     * Runs rename column.
     * @param {string} tableName - Table name.
     * @param {string} oldColumnName - Previous column name.
     * @param {string} newColumnName - New column name.
     * @returns {Promise<void>} - Resolves when complete.
     */
    renameColumn(tableName: string, oldColumnName: string, newColumnName: string): Promise<void>;
    /**
     * Runs release save point.
     * @param {string} savePointName - Save point name.
     * @param {Pick<QueryOptions, "operationOwner">} [options] - Transaction ownership.
     * @returns {Promise<void>} - Resolves when complete.
     */
    releaseSavePoint(savePointName: string, options?: Pick<QueryOptions, "operationOwner">): Promise<void>;
    /**
     * Runs release save point action.
     * @param {string} savePointName - Save point name.
     * @param {Pick<QueryOptions, "operationOwner">} [options] - Transaction ownership.
     * @returns {Promise<void>} - Resolves when complete.
     */
    _releaseSavePointAction(savePointName: string, options?: Pick<QueryOptions, "operationOwner">): Promise<void>;
    /**
     * Runs rollback save point.
     * @param {string} savePointName - Save point name.
     * @param {Pick<QueryOptions, "operationOwner">} [options] - Transaction ownership.
     * @returns {Promise<void>} - Resolves when complete.
     */
    rollbackSavePoint(savePointName: string, options?: Pick<QueryOptions, "operationOwner">): Promise<void>;
    /**
     * Runs rollback save point action.
     * @param {string} savePointName - Save point name.
     * @param {Pick<QueryOptions, "operationOwner">} [options] - Transaction ownership.
     * @returns {Promise<void>} - Resolves when complete.
     */
    _rollbackSavePointAction(savePointName: string, options?: Pick<QueryOptions, "operationOwner">): Promise<void>;
    /**
     * Truncates the given table snapshot. Drivers can override this to issue one batch.
     * @protected
     * @param {Array<import("./base-table.js").default>} tables - Eligible tables for this cleanup attempt.
     * @returns {Promise<void>} - Resolves when every table has been cleaned.
     */
    protected truncateTables(tables: Array<import("./base-table.js").default>): Promise<void>;
    /**
     * Runs truncate all tables.
     * @returns {Promise<void>} - Resolves when complete.
     */
    truncateAllTables(): Promise<void>;
    /**
     * Runs update.
     * @param {UpdateSqlArgsType} args - Options object.
     * @returns {Promise<void>} - Resolves when complete.
     */
    update(args: UpdateSqlArgsType): Promise<void>;
    /**
     * Runs update sql.
     * @abstract
     * @param {UpdateSqlArgsType} args - Options object.
     * @returns {string} - SQL string.
     */
    updateSql(args: UpdateSqlArgsType): string;
    /**
     * Runs upsert sql.
     * @abstract
     * @param {UpsertSqlArgsType} args - Options object.
     * @returns {string} - SQL string.
     */
    upsertSql(args: UpsertSqlArgsType): string;
    /**
     * Runs disable foreign keys.
     * @abstract
     * @returns {Promise<void>} - Resolves when complete.
     */
    disableForeignKeys(): Promise<void>;
    /**
     * Runs enable foreign keys.
     * @abstract
     * @returns {Promise<void>} - Resolves when complete.
     */
    enableForeignKeys(): Promise<void>;
    /**
     * Runs with disabled foreign keys.
     * @param {() => void} callback - Callback function.
     * @returns {Promise<ReturnType<typeof JSON.parse>>} - Resolves with the with disabled foreign keys.
     */
    withDisabledForeignKeys(callback: () => void): Promise<ReturnType<typeof JSON.parse>>;
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
    acquireAdvisoryLock(name: string, args?: {
        timeoutMs?: number | null;
    }): Promise<boolean>;
    /**
     * Driver-specific blocking advisory-lock acquisition hook.
     * @abstract
     * @param {string} name - Lock name.
     * @param {{timeoutMs?: number | null}} [_args] - Lock timeout options.
     * @returns {Promise<boolean>} - Whether the lock was acquired.
     */
    _acquireAdvisoryLock(name: string, _args?: {
        timeoutMs?: number | null;
    }): Promise<boolean>;
    /**
     * Attempts to acquire a named advisory lock without blocking.
     * @param {string} name - Lock name.
     * @returns {Promise<boolean>} - Resolves to true if the lock was acquired, false if it was already held.
     */
    tryAcquireAdvisoryLock(name: string): Promise<boolean>;
    /**
     * Driver-specific non-blocking advisory-lock acquisition hook.
     * @abstract
     * @param {string} name - Lock name.
     * @returns {Promise<boolean>} - Whether the lock was acquired.
     */
    _tryAcquireAdvisoryLock(name: string): Promise<boolean>;
    /**
     * Releases a named advisory lock previously acquired on this connection.
     * @param {string} name - Lock name.
     * @returns {Promise<boolean>} - Resolves to true if the lock was held by this session and has now been released.
     */
    releaseAdvisoryLock(name: string): Promise<boolean>;
    /**
     * Driver-specific advisory-lock release hook.
     * @abstract
     * @param {string} name - Lock name.
     * @returns {Promise<boolean>} - Whether the lock was released.
     */
    _releaseAdvisoryLock(name: string): Promise<boolean>;
    /**
     * Releases every advisory lock still tracked on this connection.
     * @returns {Promise<void>} - Resolves when every tracked lock is released.
     */
    releaseHeldAdvisoryLocks(): Promise<void>;
    /**
     * Records one successful acquisition, including re-entrant acquisitions.
     * @param {string} name - Lock name.
     * @returns {void}
     */
    _trackAdvisoryLock(name: string): void;
    /**
     * Removes one successful acquisition from the connection registry.
     * @param {string} name - Lock name.
     * @returns {void}
     */
    _untrackAdvisoryLock(name: string): void;
    /**
     * Checks whether a named advisory lock is currently held by any session.
     * Intended as an introspection helper; callers who need to act on the
     * result should prefer `tryAcquireAdvisoryLock` to avoid a TOCTOU race.
     * @abstract
     * @param {string} name - Lock name.
     * @returns {Promise<boolean>} - Resolves to true if the lock is held by ? session.
     */
    isAdvisoryLockHeld(name: string): Promise<boolean>;
}
//# sourceMappingURL=base.d.ts.map