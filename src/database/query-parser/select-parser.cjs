const {digs} = require("diggerize")

module.exports = class VelociousDatabaseQueryParserSelectParser {
  constructor({pretty, query}) {
    this.pretty = pretty
    this.query = query
  }

  toSql() {
    const {pretty, query} = digs(this, "pretty", "query")

    let sql = ""

    sql += "SELECT"

    if (pretty) {
      sql += "\n"
    } else {
      sql += " "
    }

    for (const selectKey in query._selects) {
      const selectValue = query._selects[selectKey]

      sql += selectValue

      if (selectKey + 1 < query._selects.length) {
        sql += ","

        if (pretty) {
          sql += "  "
        }
      }
    }

    return sql
  }
}
