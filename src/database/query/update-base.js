// @ts-check

export default class VelociousDatabaseQueryUpdateBase {
  /**
   * Runs constructor.
   * @param {object} args - Options object.
   * @param {Record<string, ReturnType<typeof JSON.parse>>} args.conditions - Conditions.
   * @param {Record<string, ReturnType<typeof JSON.parse>>} args.data - Data payload.
   * @param {import("../drivers/base.js").default} args.driver - Database driver instance.
   * @param {string} args.tableName - Table name.
   */
  constructor({conditions, data, driver, tableName}) {
    this.conditions = conditions
    this.data = data
    this.driver = driver
    this.tableName = tableName
  }

  /**
   * Runs get options.
   * @returns {import("../query-parser/options.js").default} - The options options.
   */
  getOptions() {
    return this.driver.options()
  }

  /**
   * Runs format value.
   * @param {ReturnType<typeof JSON.parse>} value - Value to format.
   * @returns {string | number} - SQL literal.
   */
  formatValue(value) {
    if (value === null) return "NULL"

    return this.getOptions().quote(value)
  }

  /**
   * Formats one hash condition with SQL null semantics.
   * @param {string} columnName - Column name.
   * @param {ReturnType<typeof JSON.parse>} value - Condition value.
   * @returns {string} - SQL condition.
   */
  formatCondition(columnName, value) {
    const column = this.getOptions().quoteColumnName(columnName)

    if (value === null) return `${column} IS NULL`

    return `${column} = ${this.formatValue(value)}`
  }

  toSql() {
    throw new Error("'toSql' wasn't implemented")
  }
}
