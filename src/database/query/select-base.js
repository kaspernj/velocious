// @ts-check

export default class VelociousDatabaseQuerySelectBase {
  /**
   * @returns {import("../query-parser/options.js").default} - Result.
   */
  getOptions() {
    if (!this.query) throw new Error("'query' hasn't been set")

    return this.query.driver.options()
  }

  /**
   * @param {import("./index.js").default} query
   */
  setQuery(query) {
    this.query = query
  }

  /**
   * @abstract
   * @returns {string} - Result.
   */
  toSql() {
    throw new Error("'toSql' wasn't implemented")
  }
}
