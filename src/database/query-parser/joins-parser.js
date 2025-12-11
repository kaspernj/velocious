// @ts-check

export default class VelocuiousDatabaseQueryParserJoinsParser {
  /**
   * @param {object} args
   * @param {boolean} args.pretty
   * @param {import("../query/index.js").default} args.query
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
