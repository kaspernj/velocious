// @ts-check

export default class VelociousDatabaseQuerySelectBase {
  /**
   * Returns the explicit result alias carried by this select.
   * @returns {string | undefined} - Selected result alias, or undefined when the select has none.
   */
  getAlias() {
    return undefined
  }

  /**
   * Runs get options.
   * @returns {import("../query-parser/options.js").default} - The options options.
   */
  getOptions() {
    if (!this.query) throw new Error("'query' hasn't been set")

    return this.query.driver.options()
  }

  /**
   * Runs set query.
   * @param {import("./index.js").default} query - Query instance.
   */
  setQuery(query) {
    this.query = query
  }

  /**
   * Runs to sql.
   * @abstract
   * @returns {string} - SQL string.
   */
  toSql() {
    throw new Error("'toSql' wasn't implemented")
  }
}
