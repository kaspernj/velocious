import QueryParserOptions from "../../query-parser/options.js"

export default class VelociousDatabaseDriversMssqlOptions extends QueryParserOptions {
  constructor(options) {
    options.columnQuote = "\""
    options.indexQuote = "\""
    options.stringQuote = "'"
    options.tableQuote = "\""

    super(options)
  }

  quote(string) {
    if (!this.driver) throw new Error("Driver not set")

    return this.driver.quote(string)
  }

  quoteColumnName = (string) => {
    if (string.includes("[") || string.includes("]")) throw new Error(`Possible SQL injection in column name: ${string}`)

    return `[${string}]`
  }

  quoteTableName = (string) => {
    if (string.includes("[") || string.includes("]")) throw new Error(`Possible SQL injection in column name: ${string}`)

    return `[${string}]`
  }
}
