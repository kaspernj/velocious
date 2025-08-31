import {digs} from "diggerize"

export default class VelocuiousDatabaseQueryParserLimitParser {
  constructor({pretty, query}) {
    this.pretty = pretty
    this.query = query
  }

  toSql() {
    const {pretty, query} = digs(this, "pretty", "query")
    const driver = query.driver
    let sql = ""

    if (query._limits.length == 0) return sql
    if (query._limits.length >= 2) throw new Error(`Multiple limits found: ${query._limits.join(", ")}`)

    if (pretty) {
      sql += "\n\n"
    } else {
      sql += " "
    }

    if (driver.getType() == "mssql") {
      // sql += "BETWEEN"
    } else {
      sql += "LIMIT"
    }

    for (const limitKey in query._limits) {
      const limit = query._limits[limitKey]

      if (limitKey > 0) sql += ","

      if (pretty) {
        sql += "\n  "
      } else {
        sql += " "
      }

      if (driver.getType() == "mssql") {
        sql += `OFFSET 0 ROWS FETCH FIRST ${this.query.getOptions().quote(limit)} ROWS ONLY`
      } else {
        sql += this.query.getOptions().quote(limit)
      }
    }

    return sql
  }
}
