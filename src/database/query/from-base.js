// @ts-check

import Query from "./index.js"

export default class VelociousDatabaseQueryFromBase {
  /** @type {Query | null} */
  query = null

  /**
   * @param {import("./index.js").default} query
   * @returns {void}
   */
  setQuery(query) {
    this.query = query
  }

  /**
   * @returns {import("../query-parser/options.js").default}
   */
  getOptions() {
    if (!this.query) throw new Error("'query' hasn't been set")

    return this.query.getOptions()
  }

  /**
   * @abstract
   * @returns {string[]}
   */
  toSql() {
    throw new Error("'toSql' wasn't implemented")
  }
}
