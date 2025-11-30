export default class VelociousDatabaseQueryOrderBase {
  /**
   * @returns {import("../query-parser/options.js").default}
   */
  getOptions() {
    return this.query.driver.options()
  }

  toSql() {
    throw new Error("'toSql' wasn't implemented")
  }
}
