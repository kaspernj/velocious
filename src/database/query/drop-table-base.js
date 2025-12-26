// @ts-check

import QueryBase from "./base.js"
import restArgsError from "../../utils/rest-args-error.js"

export default class VelociousDatabaseQueryDropTableBase extends QueryBase {
  /**
   * @param {object} args
   * @param {boolean} [args.cascade]
   * @param {import("./../drivers/base.js").default} args.driver
   * @param {boolean} [args.ifExists]
   * @param {string} args.tableName
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
