import QueryBase from "./base.mjs"

export default class VelociousDatabaseQueryCreateTableBase extends QueryBase {
  constructor({columns, driver, ifNotExists, indexes, tableName}) {
    super({driver})
    this.columns = columns
    this.ifNotExists = ifNotExists
    this.indexes = indexes
    this.tableName = tableName
  }

  toSql() {
    const {tableName} = this
    let sql = "CREATE TABLE"

    if (this.ifNotExists) sql += " IF NOT EXISTS"

    sql += ` ${tableName}`

    this.columns.forEach((column) => {
      sql += ` ${column.name}`
    })

    return sql
  }
}
