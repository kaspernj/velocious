// @ts-check

export default class VelociousDatabaseQueryFromBase {
  /**
   * Query.
   * @type {import("./index.js").default  | null} */
  query = null

  /**
   * Runs set query.
   * @param {import("./index.js").default} query - Query instance.
   * @returns {void} - No return value.
   */
  setQuery(query) {
    this.query = query
  }

  /**
   * Runs get options.
   * @returns {import("../query-parser/options.js").default} - The options options.
   */
  getOptions() {
    if (!this.query) throw new Error("'query' hasn't been set")

    return this.query.getOptions()
  }

  /**
   * Runs to sql.
   * @abstract
   * @returns {string[]} - SQL statements.
   */
  toSql() {
    throw new Error("'toSql' wasn't implemented")
  }
}
