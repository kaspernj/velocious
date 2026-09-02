export type SqliteWebPersistence = {
    /**
     * - Persistence backend name.
     */
    name: "indexeddb" | "localstorage" | "opfs";
    /**
     * - Deletes the persisted database.
     */
    delete: () => Promise<void>;
    /**
     * - Loads persisted database bytes.
     */
    load: () => Promise<Uint8Array | undefined>;
    /**
     * - Saves persisted database bytes.
     */
    save: (content: Uint8Array) => Promise<void>;
};
export type SqliteWebPersistenceEnvironment = {
    /**
     * - IndexedDB global.
     */
    indexedDB?: unknown;
    /**
     * - Navigator global.
     */
    navigator?: unknown;
};
/**
 * Creates the best SQLite web persistence adapter supported by the current browser.
 * @param {object} args - Arguments.
 * @param {string} args.databaseName - Database name.
 * @param {SqliteWebPersistenceEnvironment} [args.environment] - Browser-like environment.
 * @returns {Promise<SqliteWebPersistence>} - Selected persistence adapter.
 */
export declare function createSqliteWebPersistence({ databaseName, environment }: {
    databaseName: string;
    environment?: SqliteWebPersistenceEnvironment;
}): Promise<SqliteWebPersistence>;
/**
 * Deletes SQLite web database bytes from every available persistence backend.
 * @param {object} args - Arguments.
 * @param {string} args.databaseName - Database name.
 * @param {SqliteWebPersistenceEnvironment} [args.environment] - Browser-like environment.
 * @returns {Promise<void>} - Resolves when all available backends were cleared.
 */
export declare function deleteSqliteWebPersistences({ databaseName, environment }: {
    databaseName: string;
    environment?: SqliteWebPersistenceEnvironment;
}): Promise<void>;
/**
 * Returns the legacy SQLite web storage key for a database name.
 * @param {string} databaseName - Database name.
 * @returns {string} - Persistence key.
 */
export declare function sqliteWebPersistenceKey(databaseName: string): string;
//# sourceMappingURL=web-persistence.d.ts.map