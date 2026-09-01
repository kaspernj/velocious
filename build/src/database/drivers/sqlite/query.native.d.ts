/**
 * Run a query using the native SQLite async API.
 * @param {import("sqlite3").Database & {getAllAsync: (sql: string) => Promise<Record<string, ReturnType<typeof JSON.parse>>[]>}} connection - SQLite connection instance.
 * @param {string} sql - SQL string to execute.
 * @returns {Promise<Record<string, ReturnType<typeof JSON.parse>>[]>} - Resolves with the result rows.
 */
export default function query(connection: import("sqlite3").Database & {
    getAllAsync: (sql: string) => Promise<Record<string, ReturnType<typeof JSON.parse>>[]>;
}, sql: string): Promise<Record<string, ReturnType<typeof JSON.parse>>[]>;
//# sourceMappingURL=query.native.d.ts.map