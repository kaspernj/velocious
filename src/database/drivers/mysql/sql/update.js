// @ts-check

import UpdateBase from "../../../query/update-base.js"

export default class VelociousDatabaseConnectionDriversMysqlSqlUpdate extends UpdateBase {
  toSql() {
    let sql = `UPDATE ${this.getOptions().quoteTableName(this.tableName)} SET `
    let count = 0

    for (let columnName in this.data) {
      if (count > 0) sql += ", "

      sql += this.getOptions().quoteColumnName(columnName)
      sql += " = "
      sql += this.getOptions().quote(this.data[columnName])
      count++
    }

    sql += " WHERE "
    count = 0

    for (let columnName in this.conditions) {
      if (count > 0) sql += " AND "

      sql += this.getOptions().quoteColumnName(columnName)
      sql += " = "
      sql += this.getOptions().quote(this.conditions[columnName])
      count++
    }

    return sql
  }
}
