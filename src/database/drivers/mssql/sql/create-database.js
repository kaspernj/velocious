// @ts-check

import CreateDatabaseBase from "../../../query/create-database-base.js"

export default class VelociousDatabaseConnectionDriversMssqlSqlCreateDatabase extends CreateDatabaseBase {
  /**
   * @param {object} args - Options object.
   * @param {import("../../base.js").default} args.driver - Database driver instance.
   * @param {string} args.databaseName - Database name.
   * @param {boolean} [args.ifNotExists] - Whether if not exists.
   */
  constructor({driver, databaseName, ifNotExists}) {
    super({databaseName, driver})
    this.ifNotExists = ifNotExists
  }

  toSql() {
    const {databaseName} = this
    const options = this.getOptions()

    let sql = ""

    if (this.ifNotExists) {
      sql += `IF NOT EXISTS(SELECT * FROM [sys].[databases] WHERE [name] = ${options.quote(databaseName)}) BEGIN `
    }

    sql += `CREATE DATABASE ${options.quoteDatabaseName(databaseName)}`

    if (this.ifNotExists) {
      sql += " END"
    }

    return [sql]
  }
}
