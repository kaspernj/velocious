// @ts-check

export default class VelociousDatabaseQueryWhereBase {
  /**
   * @returns {import("../query-parser/options.js").default} - The options options.
   */
  getOptions() {
    return this.getQuery().getOptions()
  }

  /**
   * @returns {import("./index.js").default} - The query.
   */
  getQuery() {
    if (!this.query) throw new Error("'query' hasn't been set")

    return this.query
  }

  /**
   * @param {import("./index.js").default} query - Query instance.
   */
  setQuery(query) {
    this.query = query
  }

  /**
   * @abstract
   * @returns {string} - SQL string.
   */
  toSql() {
    throw new Error("'toSql' wasn't implemented")
  }
}
