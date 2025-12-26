// @ts-check

export default class VelociousDatabaseQueryFromBase {
  /** @type {import("./index.js").default  | null} */
  query = null

  /**
   * @param {import("./index.js").default} query
   * @returns {void} - No return value.
   */
  setQuery(query) {
    this.query = query
  }

  /**
   * @returns {import("../query-parser/options.js").default} - The options options.
   */
  getOptions() {
    if (!this.query) throw new Error("'query' hasn't been set")

    return this.query.getOptions()
  }

  /**
   * @abstract
   * @returns {string[]} - SQL statements.
   */
  toSql() {
    throw new Error("'toSql' wasn't implemented")
  }
}
