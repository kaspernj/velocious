const InsertBase = require("../../../../query/insert-base.cjs")

export default class VelociousDatabaseConnectionDriversMysqlSqlInsert extends InsertBase {
  toSql() {
    let sql = `INSERT INTO ${this.getOptions.quoteTableName(this.tableName)} (`
    let count = 0

    for (let columnName of this.data) {
      if (count > 0) sql += ", "
      sql += this.getOptions().quoteColumnName(columnName)
      count++
    }

    sql += ") VALUES ("
    count = 0

    for (let columnName of this.data) {
      if (count > 0) sql += ", "
      sql += this.getOptions().quoteValue(this.data[columnName])
      count++
    }

    return sql
  }
}
