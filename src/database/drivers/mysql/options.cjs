const QueryParserOptions = require("../../query-parser/options.cjs")

module.exports = class VelociousDatabaseDriversMysqlOptions extends QueryParserOptions {
  constructor(options) {
    options.columnQuote = "`"
    options.stringQuote = "'"
    options.tableQuote = "`"

    super(options)
  }

  quote(string) {
    if (!this.driver) throw new Error("Driver not set")

    return this.driver.quote(string)
  }
}
