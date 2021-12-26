const {digs} = require("diggerize")

module.exports = class VelociousDatabaseQueryParserFromParser {
  constructor({pretty, query, queryParserOptions}) {
    this.pretty = pretty
    this.query = query
    this.queryParserOptions = queryParserOptions
  }

  toSql() {
    const {pretty, query} = digs(this, "pretty", "query")

    let sql = " FROM"

    for (const fromKey in query._froms) {
      const from = query._froms[fromKey]

      if (fromKey > 0) {
        sql += ","
      }

      if (pretty) {
        sql += "\n  "
      } else {
        sql += " "
      }

      sql += from
    }

    return sql
  }
}
