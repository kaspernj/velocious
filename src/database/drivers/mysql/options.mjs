import QueryParserOptions from "../../query-parser/options.mjs"

export default class VelociousDatabaseDriversMysqlOptions extends QueryParserOptions {
  constructor(options) {
    options.columnQuote = "`"
    options.indexQuote = "`"
    options.stringQuote = "'"
    options.tableQuote = "`"

    super(options)
  }

  quote(string) {
    if (!this.driver) throw new Error("Driver not set")

    return this.driver.quote(string)
  }
}
