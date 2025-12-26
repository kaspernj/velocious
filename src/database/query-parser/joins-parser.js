// @ts-check

export default class VelocuiousDatabaseQueryParserJoinsParser {
  /**
   * @param {object} args - Options object.
   * @param {boolean} args.pretty - Whether pretty.
   * @param {import("../query/index.js").default} args.query - Query instance.
   */
  constructor({pretty, query}) {
    this.pretty = pretty
    this.query = query
    this.conn = this.query.driver
  }

  toSql() {
    const {pretty, query} = this
    let sql = ""

    for (const joinKey in query._joins) {
      const join = query._joins[joinKey]

      join.setPretty(pretty)
      join.setQuery(query)

      if (pretty) {
        sql += "\n\n"
      } else {
        sql += " "
      }

      sql += join.toSql()
    }

    return sql
  }
}
