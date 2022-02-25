const QueryParserOptions = require("../../../query-parser/options.cjs")
const queryParserOptions = new QueryParserOptions({
  columnQuote: "`",
  tableQuote: "`"
})

module.exports = queryParserOptions
