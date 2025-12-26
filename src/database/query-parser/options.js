// @ts-check

/**
 * @typedef {object} OptionsObjectArgsType
 * @property {string} columnQuote - Quote character for column names.
 * @property {string} indexQuote - Quote character for index names.
 * @property {import("../drivers/base.js").default} driver - Database driver instance.
 * @property {string} tableQuote - Quote character for table names.
 * @property {string} stringQuote - Quote character for string literals.
 */

export default class VelociousDatabaseQueryParserOptions {
  /**
   * @param {OptionsObjectArgsType} options - Options object.
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
   * @param {any} value - Value to use.
   * @returns {number | string} - The quote.
   */
  quote(value) {
    if (typeof value == "number") return value

    return this.quoteString(value)
  }

  /**
   * @param {string} databaseName - Database name.
   * @returns {string} - The quote database name.
   */
  quoteDatabaseName(databaseName) {
    if (databaseName.includes(this.tableQuote)) throw new Error(`Possible SQL injection in database name: ${databaseName}`)

    return `${this.tableQuote}${databaseName}${this.tableQuote}`
  }

  /**
   * @param {string} columnName - Column name.
   * @returns {string} - The quote column name.
   */
  quoteColumnName(columnName) {
    if (!columnName) throw new Error("No column name was given")
    if (columnName.includes(this.columnQuote)) throw new Error(`Invalid column name: ${columnName}`)

    return `${this.columnQuote}${columnName}${this.columnQuote}`
  }

  /**
   * @param {string} indexName - Index name.
   * @returns {string} - The quote index name.
   */
  quoteIndexName(indexName) {
    if (!indexName || indexName.includes(this.columnQuote)) throw new Error(`Invalid column name: ${indexName}`)

    return `${this.columnQuote}${indexName}${this.columnQuote}`
  }

  /**
   * @abstract
   * @param {any} string - String.
   * @returns {string} - The quote string.
   */
  quoteString(string) { // eslint-disable-line no-unused-vars
    throw new Error("quoteString not implemented")
  }

  /**
   * @param {string} tableName - Table name.
   * @returns {string} - The quote table name.
   */
  quoteTableName(tableName) {
    if (!tableName || tableName.includes(this.tableQuote)) throw new Error(`Invalid table name: ${tableName}`)

    return `${this.tableQuote}${tableName}${this.tableQuote}`
  }
}
