import Mutex from "epic-locks/build/mutex.js";
export type NativeSqliteConnection = {
    /**
     * - Reads rows.
     */
    getAllAsync: (sql: string) => Promise<Array<Record<string, ReturnType<typeof JSON.parse>>>>;
    /**
     * - Runs a mutation.
     */
    runAsync: (sql: string) => Promise<{
        changes: number;
    }>;
    /**
     * - Executes a SQL script.
     */
    execAsync: (sql: string) => Promise<void>;
    /**
     * - Closes the native connection.
     */
    closeAsync: () => Promise<void>;
};
/**
 * Returns the process-wide native query gate for one SQLite database name.
 * expo-sqlite caches native databases by name, so a gate scoped to a driver
 * instance is not enough: two drivers on the same database can still release
 * each other's shared `NativeStatement` objects.
 * @param {string} databaseName - SQLite database name.
 * @returns {Mutex} Mutex serializing native calls for that database.
 */
export declare function nativeDatabaseMutex(databaseName: string): Mutex;
/**
 * Whether an expo-sqlite error means the native database/statement was released.
 * @param {unknown} error - Thrown error.
 * @returns {boolean} Whether the error is the native-handle lifetime failure.
 */
export declare function isNativeHandleError(error: unknown): boolean;
/**
 * Runs one native operation under the per-database gate, reopening once when
 * expo-sqlite reports the shared native handle was released.
 * @template T
 * @param {object} args - Operation args.
 * @param {string} args.databaseName - SQLite database name.
 * @param {() => NativeSqliteConnection | undefined} args.getConnection - Current connection getter.
 * @param {() => Promise<NativeSqliteConnection>} args.reopenConnection - Opens a fresh native connection.
 * @param {(connection: NativeSqliteConnection) => Promise<T>} args.operation - Operation to run.
 * @returns {Promise<T>} Operation result.
 */
export declare function runNativeOperation<T>({ databaseName, getConnection, reopenConnection, operation }: {
    databaseName: string;
    getConnection: () => NativeSqliteConnection | undefined;
    reopenConnection: () => Promise<NativeSqliteConnection>;
    operation: (connection: NativeSqliteConnection) => Promise<T>;
}): Promise<T>;
//# sourceMappingURL=native-query-gate.d.ts.map