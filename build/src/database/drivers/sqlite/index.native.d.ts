import Mutex from "epic-locks/build/mutex.js";
import Base from "./base.js";
export default class VelociousDatabaseDriversSqliteNative extends Base {
    connection: any;
    /**
     * Serializes native queries so concurrent `getAllAsync` calls never race
     * `expo-sqlite`'s shared `NativeStatement` objects (a single connection
     * prepares/executes/finalizes one statement at a time).
     * @type {Mutex}
     */
    _queryMutex: Mutex;
    connect(): Promise<void>;
    connectArgs(): Record<string, any>;
    _close(): Promise<void>;
    deleteDatabaseStorage(): Promise<void>;
    /**
     * Runs query actual.
     * @param {string} sql - SQL string.
     * @param {import("../base.js").QueryOptions} [options] - Query options.
     * @returns {Promise<Record<string, ReturnType<typeof JSON.parse>>[]>} - Query result rows.
     */
    _queryActual(sql: string, options?: import("../base.js").QueryOptions): Promise<Record<string, ReturnType<typeof JSON.parse>>[]>;
    /**
     * Executes a mutation with affected-row metadata.
     * @param {string} sql - Mutation SQL.
     * @returns {Promise<number>} - Affected row count.
     */
    _affectedRowsActual(sql: string): Promise<number>;
}
//# sourceMappingURL=index.native.d.ts.map