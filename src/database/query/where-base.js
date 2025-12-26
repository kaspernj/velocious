// @ts-check

export default class VelociousDatabaseQueryWhereBase {
  /**
   * @returns {import("../query-parser/options.js").default} - Result.
   */
  getOptions() {
    return this.getQuery().getOptions()
  }

  /**
   * @returns {import("./index.js").default} - Result.
   */
  getQuery() {
    if (!this.query) throw new Error("'query' hasn't been set")

    return this.query
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
