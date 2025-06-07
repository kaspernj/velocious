import {digs} from "diggerize"
import QueryBase from "./base.js"

export default class VelociousDatabaseQueryCreateDatabaseBase extends QueryBase {
  constructor({driver, databaseName, ifNotExists}) {
    super({driver})
    this.databaseName = databaseName
    this.ifNotExists = ifNotExists
  }

  toSql() {
    const {databaseName} = this
    const {tableQuote} = digs(this.getOptions(), "tableQuote")
    let sql = "CREATE DATABASE"

    if (this.ifNotExists) sql += " IF NOT EXISTS"

    sql += ` ${tableQuote}${databaseName}${tableQuote}`

    return sql
  }
}
