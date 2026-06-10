// @ts-check

export default class VelociousDatabaseQueryJoinBase {
  pretty = false

  /**
 * Runs get options.
   * @returns {import("../query-parser/options.js").default} - The options options.
   */
  getOptions() {
    return this.getQuery().driver.options()
  }

  /**
 * Runs get query.
   * @returns {import("./index.js").default} - The query.
   */
  getQuery() {
    if (!this.query) throw new Error("'query' hasn't been set")

    return this.query
  }

  /**
 * Runs set pretty.
   * @param {boolean} value - Value to use.
   */
  setPretty(value) {
    this.pretty = value
  }

  /**
 * Runs set query.
   * @param {import("./index.js").default} query - Query instance.
   */
  setQuery(query) {
    this.query = query
  }

  toSql() {
    throw new Error("'toSql' wasn't implemented")
  }
}
