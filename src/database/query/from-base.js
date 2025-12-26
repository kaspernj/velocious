// @ts-check

export default class VelociousDatabaseQueryFromBase {
  /** @type {import("./index.js").default  | null} */
  query = null

  /**
   * @param {import("./index.js").default} query
   * @returns {void} - Result.
   */
  setQuery(query) {
    this.query = query
  }

  /**
   * @returns {import("../query-parser/options.js").default} - Result.
   */
  getOptions() {
    if (!this.query) throw new Error("'query' hasn't been set")

    return this.query.getOptions()
  }

  /**
   * @abstract
   * @returns {string[]} - Result.
   */
  toSql() {
    throw new Error("'toSql' wasn't implemented")
  }
}
