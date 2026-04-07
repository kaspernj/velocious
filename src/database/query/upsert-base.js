// @ts-check

import restArgsError from "../../utils/rest-args-error.js"

export default class VelociousDatabaseQueryUpsertBase {
  /**
   * @param {object} args - Options object.
   * @param {Array<string>} args.conflictColumns - Columns that identify duplicates.
   * @param {Record<string, any>} args.data - Data payload.
   * @param {import("../drivers/base.js").default} args.driver - Database driver instance.
   * @param {Array<string>} args.updateColumns - Columns to update on conflict.
   * @param {string} args.tableName - Table name.
   */
  constructor({conflictColumns, data, driver, tableName, updateColumns, ...restArgs}) {
    if (!driver) throw new Error("No driver given to upsert base")
    if (!tableName) throw new Error(`Invalid table name given to upsert base: ${tableName}`)
    if (!conflictColumns?.length) throw new Error("No conflictColumns given to upsert base")
    if (!updateColumns?.length) throw new Error("No updateColumns given to upsert base")
    if (!data || Object.keys(data).length <= 0) throw new Error("No data given to upsert base")

    restArgsError(restArgs)

    this.conflictColumns = conflictColumns
    this.data = data
    this.driver = driver
    this.tableName = tableName
    this.updateColumns = updateColumns
  }

  /**
   * @returns {Array<string>} - Column names from the data payload.
   */
  dataColumns() {
    return Object.keys(this.data)
  }

  /**
   * @param {string} columnName - Column name.
   * @returns {string | number} - SQL literal.
   */
  formatColumnValue(columnName) {
    return this.formatValue(this.data[columnName])
  }

  /**
   * @param {any} value - Value to format.
   * @returns {string | number} - SQL literal.
   */
  formatValue(value) {
    if (value === null) return "NULL"

    return this.getOptions().quote(value)
  }

  /**
   * @returns {import("../query-parser/options.js").default} - Driver options.
   */
  getOptions() {
    return this.driver.options()
  }

  /**
   * @param {string} columnName - Column name.
   * @returns {string} - Quoted column name.
   */
  quotedColumn(columnName) {
    return this.getOptions().quoteColumnName(columnName)
  }

  /**
   * @returns {string} - Comma-separated quoted insert columns.
   */
  quotedInsertColumnsSql() {
    return this.dataColumns().map((columnName) => this.quotedColumn(columnName)).join(", ")
  }

  /**
   * @returns {string} - Comma-separated formatted insert values.
   */
  quotedInsertValuesSql() {
    return this.dataColumns().map((columnName) => this.formatColumnValue(columnName)).join(", ")
  }

  /**
   * @returns {string} - Quoted table name.
   */
  quotedTableName() {
    return this.driver.quoteTable(this.tableName)
  }

  toSql() {
    throw new Error("'toSql' wasn't implemented")
  }
}
