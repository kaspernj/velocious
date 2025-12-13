// @ts-check

import QueryParserOptions from "../../query-parser/options.js"

export default class VelociousDatabaseDriversSqliteOptions extends QueryParserOptions {
  /**
   * @param {import("../../query-parser/options.js").OptionsObjectArgsType} options
   */
  constructor(options) {
    options.columnQuote = "`"
    options.indexQuote = "`"
    options.stringQuote = "'"
    options.tableQuote = "`"

    super(options)
  }

  /**
   * @param {string} string
   * @returns {number | string}
   */
  quote(string) {
    if (!this.driver) throw new Error("Driver not set")

    return this.driver.quote(string)
  }
}
