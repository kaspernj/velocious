import SelectBase from "./select-base.js"

export default class VelociousDatabaseQuerySelectTableAndColumn extends SelectBase {
  constructor({query, tableName, columnName}) {
    super({query})
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
