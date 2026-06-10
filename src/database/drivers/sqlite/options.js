// @ts-check

import QueryParserOptions from "../../query-parser/options.js"

export default class VelociousDatabaseDriversSqliteOptions extends QueryParserOptions {
  /**
   * Runs constructor.
   * @param {import("../base.js").default} driver - Database driver instance.
   */
  constructor(driver) {
    const optionsArgs = {
      driver,
      columnQuote: "`",
      indexQuote: "`",
      stringQuote: "'",
      tableQuote: "`"
    }

    super(optionsArgs)
  }

  /**
   * Runs quote.
   * @param {string} string - String.
   * @returns {number | string} - The quote.
   */
  quote(string) {
    if (!this.driver) throw new Error("Driver not set")

    return this.driver.quote(string)
  }
}
