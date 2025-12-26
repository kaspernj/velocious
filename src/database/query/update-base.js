// @ts-check

export default class VelociousDatabaseQueryUpdateBase {
  /**
   * @param {object} args
   * @param {Record<string, any>} args.conditions
   * @param {Record<string, any>} args.data
   * @param {import("../drivers/base.js").default} args.driver
   * @param {string} args.tableName
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
