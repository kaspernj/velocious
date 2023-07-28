import QueryBase from "./base.mjs"

export default class VelociousDatabaseQueryCreateDatabaseBase extends QueryBase {
  constructor({driver, databaseName, ifNotExists}) {
    super({driver})
    this.databaseName = databaseName
    this.ifNotExists = ifNotExists
  }

  toSql() {
    const {databaseName} = this
    let sql = "CREATE DATABASE"

    if (this.ifNotExists) sql += " IF NOT EXISTS"

    sql += ` ${databaseName}`

    return sql
  }
}
