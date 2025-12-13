// @ts-check

export default class VelocuiousDatabaseQueryParserWhereParser {
  /**
   * @param {object} args
   * @param {boolean} args.pretty
   * @param {import("../query/index.js").default} args.query
   */
  constructor({pretty, query}) {
    this.pretty = pretty
    this.query = query
  }

  toSql() {
    const {pretty, query} = this
    let sql = ""

    if (query._wheres.length == 0) return sql

    if (pretty) {
      sql += "\n\n"
    } else {
      sql += " "
    }

    sql += "WHERE"

    let count = 0

    for (const where of query._wheres) {
      if (count > 0) sql += " AND"

      if (pretty) {
        sql += "\n  "
      } else {
        sql += " "
      }

      sql += where.toSql()
      count++
    }

    return sql
  }
}
