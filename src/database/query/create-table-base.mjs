import QueryBase from "./base.mjs"

export default class VelociousDatabaseQueryCreateTableBase extends QueryBase {
  constructor({driver, ifNotExists, tableName}) {
    super({driver})
    this.ifNotExists = ifNotExists
    this.tableName = tableName
  }

  toSql() {
    const {tableName} = this
    let sql = "CREATE TABLE"

    if (this.ifNotExists) sql += " IF NOT EXISTS"

    sql += ` ${tableName}`

    throw new Error("stub")
  }
}
