// @ts-check

import QueryParserOptions from "../../query-parser/options.js"

export default class VelociousDatabaseDriversMssqlOptions extends QueryParserOptions {
  /**
   * @param {object} args - Options object.
   * @param {import("../base.js").default} args.driver - Database driver instance.
   */
  constructor({driver}) {
    const options = {
      driver,
      columnQuote: "\"",
      indexQuote: "\"",
      stringQuote: "'",
      tableQuote: "\""
    }

    super(options)
  }

  /**
   * @param {any} string - String.
   * @returns {number | string} - The quote.
   */
  quote(string) {
    if (!this.driver) throw new Error("Driver not set")

    return this.driver.quote(string)
  }

  /**
   * @param {string} string - String.
   * @returns {string} - The quote column name.
   */
  quoteColumnName(string) {
    if (string.includes("[") || string.includes("]")) throw new Error(`Possible SQL injection in column name: ${string}`)

    return `[${string}]`
  }

  /**
   * @param {string} databaseName - Database name.
   * @returns {string} - The quote database name.
   */
  quoteDatabaseName(databaseName) {
    if (typeof databaseName != "string") throw new Error(`Invalid database name given: ${databaseName}`)
    if (databaseName.includes("[") || databaseName.includes("]")) throw new Error(`Possible SQL injection in database name: ${databaseName}`)

    return `[${databaseName}]`
  }

  /**
   * @param {string} string - String.
   * @returns {string} - The quote index name.
   */
  quoteIndexName(string) {
    if (string.includes("[") || string.includes("]")) throw new Error(`Possible SQL injection in index name: ${string}`)

    return `[${string}]`
  }

  /**
   * @param {string} string - String.
   * @returns {string} - The quote table name.
   */
  quoteTableName(string) {
    if (string.includes("[") || string.includes("]")) throw new Error(`Possible SQL injection in table name: ${string}`)

    return `[${string}]`
  }
}

