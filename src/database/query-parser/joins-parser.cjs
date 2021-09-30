const {digs} = require("diggerize")

module.exports = class VelocuiousDatabaseQueryParserJoinsParser {
  constructor({pretty, query}) {
    this.pretty = pretty
    this.query = query
  }

  toSql() {
    const {pretty, query} = digs(this, "pretty", "query")

    let sql = ""

    for (const joinKey in query._joins) {
      const join = query._joins[joinKey]

      if (joinKey == 0) {
        if (pretty) {
          sql += "\n\n"
        } else {
          sql += " "
        }
      }

      if (typeof join == "string") {
        sql += join
      } else {
        throw new Error(`Unhandled type: ${typeof join}`)
      }
    }

    return sql
  }
}
