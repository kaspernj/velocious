import Mutex from "epic-locks/build/mutex.js";
export default class VelociousDatabaseDriversSqliteConnectionSqlJs {
    connection: import("sql.js").Database;
    databaseSaveDeferred: boolean;
    databaseSaveMutex: Mutex;
    databaseTransactionStarting: boolean;
    driver: import("../base.js").default;
    persistence: import("./web-persistence.js").SqliteWebPersistence;
    /**
     * Runs constructor.
     * @param {import("../base.js").default} driver - Database driver instance.
     * @param {import("sql.js").Database} connection - Connection.
     * @param {import("./web-persistence.js").SqliteWebPersistence} persistence - Database persistence adapter.
     */
    constructor(driver: import("../base.js").default, connection: import("sql.js").Database, persistence: import("./web-persistence.js").SqliteWebPersistence);
    close(): Promise<void>;
    /**
     * Flushes any debounced database save and waits until persistence is complete.
     * @returns {Promise<void>} - Resolves when the current database bytes are stored.
     */
    flushDatabaseSave(): Promise<void>;
    /**
     * Flushes only when a mutation save is pending or was deferred by a transaction.
     * @returns {Promise<void>} - Resolves when pending database bytes are stored.
     */
    flushPendingDatabaseSave(): Promise<void>;
    hasPendingDatabaseSave(): boolean;
    /**
     * Drains active and queued persistence before atomically starting an outer transaction.
     * @param {() => Promise<void>} callback - Starts the SQL transaction.
     * @returns {Promise<void>} - Resolves after BEGIN succeeds.
     */
    withTransactionStart(callback: () => Promise<void>): Promise<void>;
    /**
     * Marks successful outer transaction admission complete after driver state is updated.
     * @returns {void}
     */
    completeTransactionStart(): void;
    /**
     * Runs query.
     * @param {string} sql - SQL string.
     * @param {{mutation?: boolean}} [options] - Internal query classification options.
     * @returns {Promise<Record<string, ReturnType<typeof JSON.parse>>[]>} - Resolves with the query.
     */
    query(sql: string, { mutation }?: {
        mutation?: boolean;
    }): Promise<Record<string, ReturnType<typeof JSON.parse>>[]>;
    /**
     * Executes a mutation with affected-row metadata.
     * @param {string} sql - Mutation SQL.
     * @returns {Promise<number>} - Affected row count.
     */
    affectedRows(sql: string): Promise<number>;
    saveDatabase: () => Promise<void>;
    saveDatabaseDebounce: import("debounce").DebouncedFunction<() => Promise<void>>;
}
//# sourceMappingURL=connection-sql-js.d.ts.map