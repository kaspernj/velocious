// @ts-check

/**
 * @param {string} statement - Statement.
 * @returns {string} - SQL string.
 */
export function normalizeSqlStatement(statement) {
  const trimmed = statement.trim()

  if (!trimmed) return ""

  if (trimmed.endsWith(";")) return trimmed

  return `${trimmed};`
}

/**
 * @param {object} args - Options object.
 * @param {import("../base.js").default} args.db - Database connection.
 * @param {string} args.objectName - Object name.
 * @param {string} args.statement - Statement.
 * @param {string} args.type - Type identifier.
 * @returns {string} - The create statement.
 */
export function normalizeCreateStatement({db, objectName, statement, type}) {
  const trimmed = statement.trim()

  if (!trimmed) return trimmed

  if (trimmed.toLowerCase().startsWith("create ")) return trimmed

  return `CREATE ${type} ${db.quoteTable(objectName)} AS ${trimmed}`
}
