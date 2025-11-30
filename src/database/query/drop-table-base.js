import {digs} from "diggerize"
import QueryBase from "./base.js"
import restArgsError from "../../utils/rest-args-error.js"

export default class VelociousDatabaseQueryDropTableBase extends QueryBase {
  constructor({cascade, driver, ifExists, options, tableName, ...restArgs}) {
    super({driver, options})

    restArgsError(restArgs)

    this.cascade = cascade
    this.ifExists = ifExists
    this.tableName = tableName
  }

  /**
   * @returns {string[]}
   */
  toSql() {
    const databaseType = this.getDatabaseType()
    const options = this.getOptions()
    const {cascade, ifExists, tableName} = digs(this, "cascade", "ifExists", "tableName")
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
