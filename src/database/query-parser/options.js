// @ts-check

/**
 * @typedef {object} OptionsObjectArgsType
 * @property {string} columnQuote
 * @property {string} indexQuote
 * @property {import("../drivers/base.js").default} driver
 * @property {string} tableQuote
 * @property {string} stringQuote
 */

export default class VelociousDatabaseQueryParserOptions {
  /**
   * @param {OptionsObjectArgsType} options
   */
  constructor(options) {
    this.columnQuote = options.columnQuote
    this.indexQuote = options.indexQuote
    this.driver = options.driver
    this.tableQuote = options.tableQuote
    this.stringQuote = options.stringQuote

    if (!this.driver) throw new Error("No driver given to parser options")
  }

  /**
   * @param {any} value
   * @returns {number | string} - Result.
   */
  quote(value) {
    if (typeof value == "number") return value

    return this.quoteString(value)
  }

  /**
   * @param {string} databaseName
   * @returns {string} - Result.
   */
  quoteDatabaseName(databaseName) {
    if (databaseName.includes(this.tableQuote)) throw new Error(`Possible SQL injection in database name: ${databaseName}`)

    return `${this.tableQuote}${databaseName}${this.tableQuote}`
  }

  /**
   * @param {string} columnName
   * @returns {string} - Result.
   */
  quoteColumnName(columnName) {
    if (!columnName) throw new Error("No column name was given")
    if (columnName.includes(this.columnQuote)) throw new Error(`Invalid column name: ${columnName}`)

    return `${this.columnQuote}${columnName}${this.columnQuote}`
  }

  /**
   * @param {string} indexName
   * @returns {string} - Result.
   */
  quoteIndexName(indexName) {
    if (!indexName || indexName.includes(this.columnQuote)) throw new Error(`Invalid column name: ${indexName}`)

    return `${this.columnQuote}${indexName}${this.columnQuote}`
  }

  /**
   * @abstract
   * @param {any} string
   * @returns {string} - Result.
   */
  quoteString(string) { // eslint-disable-line no-unused-vars
    throw new Error("quoteString not implemented")
  }

  /**
   * @param {string} tableName
   * @returns {string} - Result.
   */
  quoteTableName(tableName) {
    if (!tableName || tableName.includes(this.tableQuote)) throw new Error(`Invalid table name: ${tableName}`)

    return `${this.tableQuote}${tableName}${this.tableQuote}`
  }
}
