export default class VelociousDatabaseQueryWhereBase {
  /**
   * @returns {import("../query-parser/options.js").default}
   */
  getOptions() {
    return this.query.getOptions()
  }

  toSql() {
    throw new Error("'toSql' wasn't implemented")
  }
}
