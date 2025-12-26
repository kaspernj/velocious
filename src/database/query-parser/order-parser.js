// @ts-check

export default class VelocuiousDatabaseQueryParserOrderParser {
  /**
   * @param {object} args - Options object.
   * @param {boolean} args.pretty - Whether pretty.
   * @param {import("../query/index.js").default} args.query - Query instance.
   */
  constructor({pretty, query}) {
    this.pretty = pretty
    this.query = query
  }

  toSql() {
    const {pretty, query} = this
    let sql = ""

    if (query._orders.length == 0) return sql

    if (pretty) {
      sql += "\n\n"
    } else {
      sql += " "
    }

    sql += "ORDER BY"
    let count = 0

    for (const order of query._orders) {
      if (count > 0) sql += " ,"

      if (pretty) {
        sql += "\n  "
      } else {
        sql += " "
      }

      sql += order.toSql()
      count++
    }

    return sql
  }
}
