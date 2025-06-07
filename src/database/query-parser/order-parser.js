import {digs} from "diggerize"

export default class VelocuiousDatabaseQueryParserOrderParser {
  constructor({pretty, query}) {
    this.pretty = pretty
    this.query = query
  }

  toSql() {
    const {pretty, query} = digs(this, "pretty", "query")
    let sql = ""

    if (query._orders.length == 0) return sql

    if (pretty) {
      sql += "\n\n"
    } else {
      sql += " "
    }

    sql += "ORDER BY"

    for (const orderKey in query._orders) {
      const order = query._orders[orderKey]

      if (orderKey > 0) sql += " ,"

      if (pretty) {
        sql += "\n  "
      } else {
        sql += " "
      }

      sql += order.toSql()
    }

    return sql
  }
}
