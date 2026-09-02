/**
 * Runs query.
 * @param {import("sqlite").Database} connection - Connection.
 * @param {string} sql - SQL string.
 * @returns {Promise<Record<string, ReturnType<typeof JSON.parse>>[]>} - Resolves with string value.
 */
export default function query(connection: import("sqlite").Database, sql: string): Promise<Record<string, ReturnType<typeof JSON.parse>>[]>;
//# sourceMappingURL=query.d.ts.map