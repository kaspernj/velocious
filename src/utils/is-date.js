// @ts-check

/**
 * Whether the value is a Date, including Dates created in another JS realm (e.g. the velocious
 * console REPL context or a node:vm context), where `instanceof Date` is false because the other
 * realm has its own Date constructor. Without this, such a Date bypasses date normalization and SQL
 * value conversion and ends up as an empty value in the generated SQL.
 * @param {?} value - Value to test.
 * @returns {value is Date} - Whether the value is a Date from any realm.
 */
export default function isDate(value) {
  return value instanceof Date || Object.prototype.toString.call(value) === "[object Date]"
}
