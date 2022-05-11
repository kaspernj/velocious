const {digg} = require("diggerize")

module.exports = class VelociousDatabaseQueryParserOptions {
  constructor(options) {
    this.columnQuote = digg(options, "columnQuote")
    this.driver = digg(options, "driver")
    this.tableQuote = digg(options, "tableQuote")
    this.stringQuote = digg(options, "stringQuote")

    if (!this.driver) throw new Error("No driver given")
  }

  quoteColumnName(columnName) {
    if (columnName.includes(this.columnQuote)) throw new Error(`Invalid column name: ${columnName}`)

    return `${this.columnQuote}${columnName}${this.columnQuote}`
  }

  quoteTableName(tableName) {
    if (tableName.includes(this.tableQuote)) throw new Error(`Invalid table name: ${tableName}`)

    return `${this.tableQuote}${tableName}${this.tableQuote}`
  }

  quote(value) {
    if (typeof value == "number")
      return value

    return this.quoteString(value)
  }
}
