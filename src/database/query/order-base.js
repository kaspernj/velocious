// @ts-check

export default class VelociousDatabaseQueryOrderBase {
  /**
   * @param {import("./index.js").default} query
   */
  constructor(query) {
    this.query = query
  }

  /**
   * @returns {import("../query-parser/options.js").default} - The options options.
   */
  getOptions() {
    return this.query.driver.options()
  }

  /**
   * @abstract
   * @param {boolean} _reverseOrder
   * @returns {void} - No return value.
   */
  setReverseOrder(_reverseOrder) { // eslint-disable-line no-unused-vars
    throw new Error("setReverseOrder not implemented")
  }

  toSql() {
    throw new Error("'toSql' wasn't implemented")
  }
}
