// @ts-check

export default class VelociousDatabaseQueryUpdateBase {
  /**
   * @param {object} args - Options object.
   * @param {Record<string, any>} args.conditions - Conditions.
   * @param {Record<string, any>} args.data - Data payload.
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
   * @returns {import("../query-parser/options.js").default} - The options options.
   */
  getOptions() {
    return this.driver.options()
  }

  toSql() {
    throw new Error("'toSql' wasn't implemented")
  }
}
