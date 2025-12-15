// @ts-check

import QueryParserOptions from "../../query-parser/options.js"

export default class VelociousDatabaseDriversMssqlOptions extends QueryParserOptions {
  /**
   * @param {object} args
   * @param {import("../base.js").default} args.driver
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
   * @param {any} string
   * @returns {number | string}
   */
  quote(string) {
    if (!this.driver) throw new Error("Driver not set")

    return this.driver.quote(string)
  }

  /**
   * @param {string} string
   * @returns {string}
   */
  quoteColumnName(string) {
    if (string.includes("[") || string.includes("]")) throw new Error(`Possible SQL injection in column name: ${string}`)

    return `[${string}]`
  }

  /**
   * @param {string} databaseName
   * @returns {string}
   */
  quoteDatabaseName(databaseName) {
    if (typeof databaseName != "string") throw new Error(`Invalid database name given: ${databaseName}`)
    if (databaseName.includes("[") || databaseName.includes("]")) throw new Error(`Possible SQL injection in database name: ${databaseName}`)

    return `[${databaseName}]`
  }

  /**
   * @param {string} string
   * @returns {string}
   */
  quoteIndexName(string) {
    if (string.includes("[") || string.includes("]")) throw new Error(`Possible SQL injection in index name: ${string}`)

    return `[${string}]`
  }

  /**
   * @param {string} string
   * @returns {string}
   */
  quoteTableName(string) {
    if (string.includes("[") || string.includes("]")) throw new Error(`Possible SQL injection in table name: ${string}`)

    return `[${string}]`
  }
}
