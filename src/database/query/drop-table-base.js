import QueryBase from "./base.js"
import restArgsError from "../../utils/rest-args-error.js"

export default class VelociousDatabaseQueryDropTableBase extends QueryBase {
  constructor({driver, ifExists, options, tableName, ...restArgs}) {
    super({driver, options})

    restArgsError(restArgs)

    this.ifExists = ifExists
    this.tableName = tableName
  }

  toSql() {
    const databaseType = this.getDatabaseType()
    const options = this.getOptions()
    const {ifExists, tableName} = this
    const sqls = []
    let sql = ""

    if (databaseType == "mssql" && ifExists) {
      sql += `IF EXISTS(SELECT * FROM [sysobjects] WHERE [name] = ${options.quote(tableName)} AND [xtype] = 'U') BEGIN `
    }

    sql += "DROP TABLE"

    if (databaseType != "mssql" && ifExists) sql += " IF EXISTS"

    sql += ` ${options.quoteTableName(tableName)}`

    if (databaseType == "mssql" && ifExists) {
      sql += " END"
    }

    sqls.push(sql)

    return [sql]
  }
}
