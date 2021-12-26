const SelectBase = require("./select-base.cjs")

module.exports = class VelociousDatabaseQuerySelectTableAndColumn extends SelectBase {
  constructor({tableName, columnName}) {
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
