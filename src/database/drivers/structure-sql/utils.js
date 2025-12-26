// @ts-check

/**
 * @param {string} statement
 * @returns {string} - SQL string.
 */
export function normalizeSqlStatement(statement) {
  const trimmed = statement.trim()

  if (!trimmed) return ""

  if (trimmed.endsWith(";")) return trimmed

  return `${trimmed};`
}

/**
 * @param {object} args
 * @param {import("../base.js").default} args.db
 * @param {string} args.objectName
 * @param {string} args.statement
 * @param {string} args.type
 * @returns {string} - The create statement.
 */
export function normalizeCreateStatement({db, objectName, statement, type}) {
  const trimmed = statement.trim()

  if (!trimmed) return trimmed

  if (trimmed.toLowerCase().startsWith("create ")) return trimmed

  return `CREATE ${type} ${db.quoteTable(objectName)} AS ${trimmed}`
}
