// @ts-check

import QueryBase from "./base.js"
import restArgsError from "../../utils/rest-args-error.js"

export default class VelociousDatabaseQueryDropTableBase extends QueryBase {
  /**
   * @param {object} args - Options object.
   * @param {boolean} [args.cascade] - Whether cascade.
   * @param {import("./../drivers/base.js").default} args.driver - Database driver instance.
   * @param {boolean} [args.ifExists] - Whether if exists.
   * @param {string} args.tableName - Table name.
   */
  constructor({cascade, driver, ifExists, tableName, ...restArgs}) {
    super({driver})

    restArgsError(restArgs)

    this.cascade = cascade
    this.ifExists = ifExists
    this.tableName = tableName
  }

  /**
   * @returns {Promise<string[]>} - Resolves with SQL statements.
   */
  async toSQLs() {
    const databaseType = this.getDatabaseType()
    const options = this.getOptions()
    const {cascade, ifExists, tableName} = this
    const sqls = []
    let sql = ""

    if (databaseType == "mssql" && ifExists) {
      sql += `IF EXISTS(SELECT * FROM [sysobjects] WHERE [name] = ${options.quote(tableName)} AND [xtype] = 'U') BEGIN `
    }

    sql += "DROP TABLE"

    if (databaseType != "mssql" && ifExists) sql += " IF EXISTS"

    sql += ` ${options.quoteTableName(tableName)}`

    if (cascade && databaseType == "pgsql") {
      sql += " cascade"
    }

    if (databaseType == "mssql" && ifExists) {
      sql += " END"
    }

    sqls.push(sql)

    return sqls
  }
}
