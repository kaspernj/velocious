import QueryBase from "./base.mjs"

export default class VelociousDatabaseQueryDeleteBase extends QueryBase {
  constructor({driver, databaseName}) {
    super({driver})
    this.databaseName = databaseName
  }

  toSql() {
    const {databaseName} = this
    const sql = `CREATE DATABASE ${databaseName}`

    return sql
  }
}
