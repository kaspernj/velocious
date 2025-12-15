// @ts-check

import QueryParserOptions from "../../query-parser/options.js"

export default class VelociousDatabaseDriversMysqlOptions extends QueryParserOptions {
  /**
   * @param {object} args
   * @param {import("../base.js").default} args.driver
   */
  constructor({driver}) {
    const options = {
      driver,
      columnQuote: "`",
      indexQuote: "`",
      stringQuote: "'",
      tableQuote: "`"
    }

    super(options)
  }

  /**
   * @param {any} string
   * @returns {number | string}
   */
  quote(string) {
    if (!this.driver) throw new Error("Driver not set")

    return this.driver.quote(string)
  }
}
