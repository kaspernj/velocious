import InsertBase from "../../../query/insert-base.js"

export default class VelociousDatabaseConnectionDriversMysqlSqlInsert extends InsertBase {
  toSql() {
    let sql = `INSERT INTO ${this.getOptions().quoteTableName(this.tableName)} (`
    let count = 0

    for (let columnName in this.data) {
      if (count > 0) sql += ", "

      sql += this.getOptions().quoteColumnName(columnName)
      count++
    }

    sql += ") VALUES ("
    count = 0

    for (let columnName in this.data) {
      if (count > 0) sql += ", "

      sql += this.getOptions().quote(this.data[columnName])
      count++
    }

    sql += ")"

    return sql
  }
}
