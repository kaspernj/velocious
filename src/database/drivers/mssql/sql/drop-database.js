// @ts-check

import DropDatabaseBase from "../../../query/drop-database-base.js"

export default class VelociousDatabaseConnectionDriversMssqlSqlDropDatabase extends DropDatabaseBase {
  /**
   * @param {object} args - Options object.
   * @param {import("../../base.js").default} args.driver - Database driver instance.
   * @param {string} args.databaseName - Database name.
   * @param {boolean} [args.ifExists] - Whether if exists.
   */
  constructor({driver, databaseName, ifExists}) {
    super({databaseName, driver})
    this.ifExists = ifExists
  }

  toSql() {
    const {databaseName} = this
    const options = this.getOptions()

    let sql = ""

    if (this.ifExists) {
      sql += `IF EXISTS(SELECT * FROM [sys].[databases] WHERE [name] = ${options.quote(databaseName)}) BEGIN `
    }

    sql += `DROP DATABASE ${options.quoteDatabaseName(databaseName)}`

    if (this.ifExists) {
      sql += " END"
    }

    return [sql]
  }
}
