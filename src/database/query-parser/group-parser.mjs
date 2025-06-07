import {digs} from "diggerize"

export default class VelociousDatabaseQueryParserFromParser {
  constructor({pretty, query}) {
    this.pretty = pretty
    this.query = query
  }

  toSql() {
    const {pretty, query} = digs(this, "pretty", "query")

    if (query._groups.length == 0) {
      return ""
    }

    let sql = " GROUP BY"

    for (const groupKey in query._groups) {
      const group = query._groups[groupKey]

      if (groupKey > 0) {
        sql += ","
      }

      if (pretty) {
        sql += "\n  "
      } else {
        sql += " "
      }

      if (typeof group == "string") {
        sql += group
      } else {
        sql += group.toSql()
      }
    }

    return sql
  }
}
