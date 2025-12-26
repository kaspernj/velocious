// @ts-check

import SelectBase from "./select-base.js"

export default class VelociousDatabaseQuerySelectTableAndColumn extends SelectBase {
  /**
   * @param {string} tableName - Table name.
   * @param {string} columnName - Column name.
   */
  constructor(tableName, columnName) {
    super()
    this.columnName = columnName
    this.tableName = tableName
  }

  getColumnName() {
    return this.columnName
  }

  getTableName() {
    return this.tableName
  }

  toSql() {
    return `${this.getOptions().quoteTableName(this.tableName)}.${this.getOptions().quoteColumnName(this.columnName)}`
  }
}
