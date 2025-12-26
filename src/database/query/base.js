// @ts-check

import restArgsError from "../../utils/rest-args-error.js"

export default class VelociousDatabaseQueryBase {
  /**
   * @param {object} args - Options object.
   * @param {import("../drivers/base.js").default} args.driver - Database driver instance.
   * @param {import("../query-parser/options.js").default} [args.options] - Options object.
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
   * @returns {import("../query-parser/options.js").default} - The options options.
   */
  getOptions() {
    return this._options
  }

  getDatabaseType() {
    return this.getDriver().getType()
  }

  /**
   * @abstract
   * @returns {Promise<string[]>} - Resolves with SQL statements.
   */
  async toSQLs() {
    throw new Error("'toSQLs' wasn't implemented")
  }
}
