// @ts-check

/** @typedef {string | number | boolean | null} InValue */

export default class WhereIn {
  /**
   * Validates an explicit membership descriptor at a column boundary.
   * @param {unknown} condition - Untrusted column condition, narrowed before use.
   * @returns {InValue[]} - Validated members in a new array.
   */
  static values(condition) {
    if (condition === null || typeof condition !== "object" ||
      !Object.hasOwn(condition, "in") || !("in" in condition) ||
      Reflect.ownKeys(condition).length !== 1 || !Array.isArray(condition.in)) {
      throw new Error("Invalid IN condition: expected an object with only an own 'in' array")
    }

    /** @type {InValue[]} */
    const values = []

    for (const value of condition.in) {
      if (value !== null && typeof value !== "string" && typeof value !== "boolean" &&
        !(typeof value === "number" && Number.isFinite(value))) {
        throw new Error("Invalid IN condition: members must be strings, finite numbers, booleans or null")
      }

      values.push(value)
    }

    return values
  }

  /**
   * Renders membership without letting its null branch escape sibling filters.
   * @param {{columnSql: string, inColumnSql?: string, values: InValue[], options: import("../query-parser/options.js").default}} args - Quoted column operands, normalized members and driver quoting.
   * @returns {string} - Complete membership predicate.
   */
  static toSql({columnSql, inColumnSql = columnSql, values, options}) {
    const nonNullValues = values.filter((value) => value !== null)
    const includesNull = values.includes(null)

    if (nonNullValues.length === 0) return includesNull ? `${columnSql} IS NULL` : "1=0"

    const membershipSql = `${inColumnSql} IN (${nonNullValues.map((value) => options.quote(value)).join(", ")})`

    return includesNull ? `(${membershipSql} OR ${columnSql} IS NULL)` : membershipSql
  }
}
