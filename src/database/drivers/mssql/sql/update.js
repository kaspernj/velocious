import UpdateBase from "../../../query/update-base.js"

export default class VelociousDatabaseConnectionDriversMssqlSqlUpdate extends UpdateBase {
  toSql() {
    let sql = `UPDATE ${this.getOptions().quoteTableName(this.tableName)} SET `
    let count = 0

    for (let columnName in this.data) {
      if (count > 0) sql += ", "

      sql += this.getOptions().quoteColumnName(columnName)
      sql += " = "
      sql += this.formatValue(this.data[columnName])
      count++
    }

    sql += " WHERE "
    count = 0

    for (let columnName in this.conditions) {
      if (count > 0) sql += " AND "

      sql += this.getOptions().quoteColumnName(columnName)
      sql += " = "
      sql += this.formatValue(this.conditions[columnName])
      count++
    }

    return sql
  }
}
