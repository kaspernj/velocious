const {digs} = require("diggerize")

module.exports = class VelocuiousDatabaseQueryParserJoinsParser {
  constructor({pretty, query, queryParserOptions}) {
    this.pretty = pretty
    this.query = query
    this.queryParserOptions = queryParserOptions
  }

  toSql() {
    const {pretty, query} = digs(this, "pretty", "query")

    let sql = ""

    for (const joinKey in query._joins) {
      const join = query._joins[joinKey]

      join.setOptions(this.queryParserOptions)

      if (joinKey == 0) {
        if (pretty) {
          sql += "\n\n"
        } else {
          sql += " "
        }
      }

      sql += join.toSql()
    }

    return sql
  }
}
