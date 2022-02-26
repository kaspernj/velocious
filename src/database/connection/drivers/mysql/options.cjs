const QueryParserOptions = require("../../../query-parser/options.cjs")
const queryParserOptions = new QueryParserOptions({
  columnQuote: "`",
  stringQuote: "'",
  tableQuote: "`"
})

module.exports = queryParserOptions
