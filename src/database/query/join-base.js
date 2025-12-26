// @ts-check

export default class VelociousDatabaseQueryJoinBase {
  pretty = false

  /**
   * @returns {import("../query-parser/options.js").default} - The options options.
   */
  getOptions() {
    return this.getQuery().driver.options()
  }

  /**
   * @returns {import("./index.js").default} - The query.
   */
  getQuery() {
    if (!this.query) throw new Error("'query' hasn't been set")

    return this.query
  }

  /**
   * @param {boolean} value - Value to use.
   */
  setPretty(value) {
    this.pretty = value
  }

  /**
   * @param {import("./index.js").default} query - Query instance.
   */
  setQuery(query) {
    this.query = query
  }

  toSql() {
    throw new Error("'toSql' wasn't implemented")
  }
}
