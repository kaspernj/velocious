/**
 * Runs query.
 * @param {import("sql.js").Database} connection - Connection.
 * @param {string} sql - SQL string.
 * @returns {Promise<Record<string, ReturnType<typeof JSON.parse>>[]>} - Resolves with string value.
 */
export default function query(connection: import("sql.js").Database, sql: string): Promise<Record<string, ReturnType<typeof JSON.parse>>[]>;
//# sourceMappingURL=query.web.d.ts.map