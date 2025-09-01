import {digg} from "diggerize"

export default class VelociousDatabaseQueryParserOptions {
  constructor(options) {
    this.columnQuote = digg(options, "columnQuote")
    this.indexQuote = digg(options, "indexQuote")
    this.driver = digg(options, "driver")
    this.tableQuote = digg(options, "tableQuote")
    this.stringQuote = digg(options, "stringQuote")

    if (!this.driver) throw new Error("No driver given to parser options")
  }

  quoteDatabaseName(databaseName) {
    if (databaseName.includes(this.tableQuote)) throw new Error(`Possible SQL injection in database name: ${databaseName}`)

    return `${this.tableQuote}${databaseName}${this.tableQuote}`
  }

  quoteColumnName(columnName) {
    if (!columnName || columnName.includes(this.columnQuote)) throw new Error(`Invalid column name: ${columnName}`)

    return `${this.columnQuote}${columnName}${this.columnQuote}`
  }

  quoteIndexName(indexName) {
    if (!indexName || indexName.includes(this.columnQuote)) throw new Error(`Invalid column name: ${indexName}`)

    return `${this.columnQuote}${indexName}${this.columnQuote}`
  }

  quoteTableName(tableName) {
    if (!tableName || tableName.includes(this.tableQuote)) throw new Error(`Invalid table name: ${tableName}`)

    return `${this.tableQuote}${tableName}${this.tableQuote}`
  }

  quote(value) {
    if (typeof value == "number")
      return value

    return this.quoteString(value)
  }
}
