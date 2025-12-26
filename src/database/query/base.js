// @ts-check

import restArgsError from "../../utils/rest-args-error.js"

export default class VelociousDatabaseQueryBase {
  /**
   * @param {object} args
   * @param {import("../drivers/base.js").default} args.driver
   * @param {import("../query-parser/options.js").default} [args.options]
   */
  constructor({driver, options, ...restArgs}) {
    restArgsError(restArgs)

    this._driver = driver
    this._options = options || driver.options()

    if (!this._options) throw new Error("No database options was given or could be gotten from driver")
  }

  getConfiguration() {
    return this.getDriver().getConfiguration()
  }

  getDriver() {
    return this._driver
  }

  /**
   * @returns {import("../query-parser/options.js").default} - Result.
   */
  getOptions() {
    return this._options
  }

  getDatabaseType() {
    return this.getDriver().getType()
  }

  /**
   * @abstract
   * @returns {Promise<string[]>} - Result.
   */
  async toSQLs() {
    throw new Error("'toSQLs' wasn't implemented")
  }
}
