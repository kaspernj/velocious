export default class VelociousDatabaseQueryFromBase {
  /**
   * @returns {import("../query-parser/options.js").default}
   */
  getOptions() {
    return this.query.getOptions()
  }

  /**
   * @interface
   * @returns {string[]}
   */
  toSql() {
    throw new Error("'toSql' wasn't implemented")
  }
}
