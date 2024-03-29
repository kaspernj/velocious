import {digs} from "diggerize"

export default class VelocuiousDatabaseQueryParserJoinsParser {
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

      sql += join.toSql()
    }

    return sql
  }
}
