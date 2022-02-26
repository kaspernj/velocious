const {digg} = require("diggerize")

module.exports = class VelociousDatabaseQueryParserOptions {
  constructor(options) {
    this.columnQuote = digg(options, "columnQuote")
    this.tableQuote = digg(options, "tableQuote")
    this.stringQuote = digg(options, "stringQuote")
  }

  escapeString() {
    throw new Error(`No method to escape string`)
  }

  quoteColumnName(columnName) {
    if (columnName.includes(this.columnQuote)) throw new Error(`Invalid column name: ${columnName}`)

    return `${this.columnQuote}${columnName}${this.columnQuote}`
  }

  quoteTableName(tableName) {
    if (tableName.includes(this.tableQuote)) throw new Error(`Invalid table name: ${tableName}`)

    return `${this.tableQuote}${tableName}${this.tableQuote}`
  }

  quoteString(value) {
    return `${this.stringQuote}${this.escapeString(value)}${this.stringQuote}`
  }

  quoteValue(value) {
    if (typeof value == "number")
      return value

    return this.quoteString(value)
  }
}
