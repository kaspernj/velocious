const QueryParserOptions = require("../../query-parser/options.cjs")

module.exports = class VelociousDatabaseDriversMysqlOptions extends QueryParserOptions {
  constructor(options) {
    options.columnQuote = "`"
    options.stringQuote = "'"
    options.tableQuote = "`"

    super(options)
  }

  escapeString(string) {
    this.connection.escape(string)
  }
}
