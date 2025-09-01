import CreateDatabaseBase from "../../../query/create-database-base.js"

export default class VelociousDatabaseConnectionDriversMssqlSqlCreateDatabase extends CreateDatabaseBase {
  constructor({driver, databaseName, ifNotExists}) {
    super({driver})
    this.databaseName = databaseName
    this.ifNotExists = ifNotExists
  }

  toSql() {
    const {databaseName} = this
    const options = this.getOptions()

    let sql = ""

    if (this.ifNotExists) {
      sql += `IF NOT EXISTS(SELECT * FROM sys.databases WHERE name = ${options.quote(databaseName)}) BEGIN `
    }

    sql += `CREATE DATABASE ${options.quoteDatabaseName(databaseName)}`

    if (this.ifNotExists) {
      sql += " END"
    }

    return sql
  }
}
