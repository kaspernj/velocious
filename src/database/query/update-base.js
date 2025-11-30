export default class VelociousDatabaseQueryUpdateBase {
  constructor({conditions, data, driver, tableName}) {
    this.conditions = conditions
    this.data = data
    this.driver = driver
    this.tableName = tableName
  }

  /**
   * @returns {import("../query-parser/options.js").default}
   */
  getOptions() {
    return this.driver.options()
  }

  toSql() {
    throw new Error("'toSql' wasn't implemented")
  }
}
