/**
 * Recreates an in-memory SQL.js test database from a captured schema baseline
 * after a quarantined connection is closed.
 */
export default class SqljsTestDatabase {
    createDatabase: (data?: Uint8Array) => import("sql.js").Database;
    /** @type {Uint8Array | undefined} */
    baseline: Uint8Array | undefined;
    /** @type {import("sql.js").Database | undefined} */
    currentDatabase: import("sql.js").Database | undefined;
    /** @type {{query: (sql: string) => Promise<Record<string, unknown>[]>, affectedRows: (sql: string) => Promise<number>, close: () => Promise<void>} | undefined} */
    currentConnection: {
        query: (sql: string) => Promise<Record<string, unknown>[]>;
        affectedRows: (sql: string) => Promise<number>;
        close: () => Promise<void>;
    } | undefined;
    /**
     * Runs constructor.
     * @param {{createDatabase: (data?: Uint8Array) => import("sql.js").Database}} args - Database factory.
     */
    constructor({ createDatabase }: {
        createDatabase: (data?: Uint8Array) => import("sql.js").Database;
    });
    /**
     * Gets the current database.
     * @returns {import("sql.js").Database} - Current database.
     */
    database(): import("sql.js").Database;
    /** Captures the current migrated database as the recreation baseline. */
    captureBaseline(): void;
    /**
     * Gets the current connection, recreating it from the schema baseline after quarantine.
     * @returns {{query: (sql: string) => Promise<Record<string, unknown>[]>, affectedRows: (sql: string) => Promise<number>, close: () => Promise<void>}} - Connection wrapper.
     */
    connection(): {
        query: (sql: string) => Promise<Record<string, unknown>[]>;
        affectedRows: (sql: string) => Promise<number>;
        close: () => Promise<void>;
    };
}
//# sourceMappingURL=sqljs-test-database.d.ts.map