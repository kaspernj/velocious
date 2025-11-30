import restArgsError from "../../utils/rest-args-error.js"

export default class VelociousDatabaseQueryBase {
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
   * @returns {import("../query-parser/options.js").default}
   */
  getOptions() {
    return this._options
  }

  getDatabaseType() {
    return this.getDriver().getType()
  }

  /**
   * @interface
   * @returns {string[]}
   */
  toSql() {
    throw new Error("'toSql' wasn't implemented")
  }
}
