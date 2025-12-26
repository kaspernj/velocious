// @ts-check

import QueryParserOptions from "../../query-parser/options.js"

export default class VelociousDatabaseDriversPgsqlOptions extends QueryParserOptions {
  /**
   * @param {import("../base.js").default} driver
   */
  constructor(driver) {
    const options = {
      driver,
      columnQuote: "\"",
      indexQuote: "\"",
      stringQuote: "'",
      tableQuote: "\""
    }

    super(options)
  }

  /**
   * @param {string} string
   * @returns {number | string} - The quote.
   */
  quote(string) {
    if (!this.driver) throw new Error("Driver not set")

    return this.driver.quote(string)
  }
}
