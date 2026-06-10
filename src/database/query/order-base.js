// @ts-check

export default class VelociousDatabaseQueryOrderBase {
  /**
   * Runs constructor.
   * @param {import("./index.js").default} query - Query instance.
   */
  constructor(query) {
    this.query = query
  }

  /**
   * Runs get options.
   * @returns {import("../query-parser/options.js").default} - The options options.
   */
  getOptions() {
    return this.query.driver.options()
  }

  /**
   * Runs set reverse order.
   * @abstract
   * @param {boolean} _reverseOrder - Whether reverse order.
   * @returns {void} - No return value.
   */
  setReverseOrder(_reverseOrder) {
    throw new Error("setReverseOrder not implemented")
  }

  toSql() {
    throw new Error("'toSql' wasn't implemented")
  }
}
