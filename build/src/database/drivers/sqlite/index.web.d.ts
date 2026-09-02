import ConnectionSqlJs from "./connection-sql-js.js";
import Base from "./base.js";
export type SqliteWebConnection = {
    query: (sql: string) => Promise<Record<string, ReturnType<typeof JSON.parse>>[]>;
    affectedRows: (sql: string) => Promise<number>;
    close: () => Promise<void>;
};
/**
 * VelociousDatabaseDriversSqliteWeb class.
 * @typedef {{query: (sql: string) => Promise<Record<string, ReturnType<typeof JSON.parse>>[]>, affectedRows: (sql: string) => Promise<number>, close: () => Promise<void>}} SqliteWebConnection
 */
export default class VelociousDatabaseDriversSqliteWeb extends Base {
    args: import("../../../configuration-types.js").DatabaseConfigurationType | undefined;
    /**
     * Connection.
     * @type {ConnectionSqlJs | undefined} */
    _connection: ConnectionSqlJs | undefined;
    /** @type {SqliteWebConnection | undefined} */
    _externalConnection: SqliteWebConnection | undefined;
    /**
     * Runs sql js locate file.
     * @returns {(file: string) => string} - locateFile callback for sql.js.
     */
    sqlJsLocateFile(): (file: string) => string;
    connect(): Promise<void>;
    _close(): Promise<void>;
    /**
     * Flushes pending SQL.js local persistence writes.
     * @returns {Promise<void>} - Resolves when pending writes are durable.
     */
    flushPendingWrites(): Promise<void>;
    hasPendingWrites(): boolean;
    deleteDatabaseStorage(): Promise<void>;
    /**
     * Starts an outer transaction after draining SQL.js persistence admission.
     * @param {Pick<import("../base.js").QueryOptions, "operationOwner">} [options] - Transaction ownership.
     * @returns {Promise<void>} - Resolves when the transaction starts.
     */
    startTransaction(options?: Pick<import("../base.js").QueryOptions, "operationOwner">): Promise<void>;
    /**
     * Coordinates SQL BEGIN with active and queued persistence exports.
     * @param {Pick<import("../base.js").QueryOptions, "operationOwner">} [options] - Transaction ownership.
     * @returns {Promise<void>} - Resolves when the transaction starts.
     */
    _startTransactionAction(options?: Pick<import("../base.js").QueryOptions, "operationOwner">): Promise<void>;
    /**
     * Commits and persists bytes after the outermost SQL.js transaction closes.
     * @param {Pick<import("../base.js").QueryOptions, "operationOwner">} [options] - Transaction ownership.
     * @returns {Promise<void>} - Resolves when committed bytes are persisted.
     */
    commitTransaction(options?: Pick<import("../base.js").QueryOptions, "operationOwner">): Promise<void>;
    /**
     * Rolls back and persists bytes after the outermost SQL.js transaction closes.
     * @param {Pick<import("../base.js").QueryOptions, "operationOwner">} [options] - Transaction ownership.
     * @returns {Promise<void>} - Resolves when rolled-back bytes are persisted.
     */
    rollbackTransaction(options?: Pick<import("../base.js").QueryOptions, "operationOwner">): Promise<void>;
    /**
     * Runs get connection.
     * @returns {ConnectionSqlJs | SqliteWebConnection} - The connection.
     */
    getConnection(): ConnectionSqlJs | SqliteWebConnection;
    localStorageName(): string;
    /**
     * Returns the configured database name.
     * @returns {string} - Database name.
     */
    databaseName(): string;
    /**
     * Runs query actual.
     * @param {string} sql - SQL string.
     * @param {import("../base.js").QueryOptions} [options] - Query options.
     * @returns {Promise<Record<string, ReturnType<typeof JSON.parse>>[]>} - Resolves with the query actual.
     */
    _queryActual(sql: string, options?: import("../base.js").QueryOptions): Promise<Record<string, ReturnType<typeof JSON.parse>>[]>;
    /**
     * Executes a mutation with affected-row metadata.
     * @param {string} sql - Mutation SQL.
     * @returns {Promise<number>} - Affected row count.
     */
    _affectedRowsActual(sql: string): Promise<number>;
}
//# sourceMappingURL=index.web.d.ts.map