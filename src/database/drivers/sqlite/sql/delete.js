import DeleteBase from "../../../query/delete-base.js"

export default class VelociousDatabaseConnectionDriversMysqlSqlDelete extends DeleteBase {
  toSql() {
    let sql = `DELETE FROM ${this.getOptions().quoteTableName(this.tableName)} WHERE `
    let count = 0

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
