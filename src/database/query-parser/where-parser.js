import {digs} from "diggerize"

export default class VelocuiousDatabaseQueryParserWhereParser {
  constructor({pretty, query}) {
    this.pretty = pretty
    this.query = query
  }

  toSql() {
    const {pretty, query} = digs(this, "pretty", "query")
    let sql = ""

    if (query._wheres.length == 0) return sql

    if (pretty) {
      sql += "\n\n"
    } else {
      sql += " "
    }

    sql += "WHERE"

    for (const whereKey in query._wheres) {
      const where = query._wheres[whereKey]

      if (whereKey > 0) sql += " &&"

      if (pretty) {
        sql += "\n  "
      } else {
        sql += " "
      }

      sql += where.toSql()
    }

    return sql
  }
}
