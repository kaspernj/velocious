// @ts-check

/**
 * Driver column types that store boolean values. Drivers report storage types,
 * which diverge for booleans (Postgres/SQLite `boolean`, some drivers `bool`,
 * MSSQL `bit`), so cross-driver consumers must match them uniformly.
 * @type {Set<string>}
 */
const BOOLEAN_COLUMN_TYPES = new Set(["bit", "bool", "boolean"])

/**
 * Whether a driver-reported (or cast) column type stores boolean values,
 * uniformly across database drivers.
 * @param {string} columnType - Driver-reported (or cast) column type.
 * @returns {boolean} Whether the column type is boolean-backed.
 */
export function isBooleanColumnType(columnType) {
  return BOOLEAN_COLUMN_TYPES.has(columnType.toLowerCase())
}
