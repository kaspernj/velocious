// @ts-check

export default class VelocuiousDatabaseQueryParserLimitParser {
  /**
   * @param {object} args - Options object.
   * @param {boolean} args.pretty - Whether pretty.
   * @param {import("../query/index.js").default} args.query - Query instance.
   */
  constructor({pretty, query}) {
    this.pretty = pretty
    this.query = query
  }

  toSql() {
    const {pretty, query} = this
    const driver = query.driver
    const options = this.query.getOptions()
    let sql = ""
    const limit = query._limit
    const offset = query._offset
    const databaseType = driver.getType()
    const isMssql = databaseType == "mssql"
    const hasLimit = limit !== null
    const hasOffset = offset !== null

    if (!hasLimit && !hasOffset) return sql

    if (pretty) {
      sql += "\n\n"
    } else {
      sql += " "
    }

    if (pretty) {
      sql += "\n  "
    } else {
      sql += " "
    }

    if (isMssql) {
      if (query._orders.length === 0) {
        sql += "ORDER BY (SELECT NULL) "
      }

      sql += `OFFSET ${options.quote(offset === null ? 0 : offset)} ROWS`

      if (hasLimit) {
        sql += ` FETCH NEXT ${options.quote(limit)} ROWS ONLY`
      }
    } else {
      sql += "LIMIT "

      if (hasLimit) {
        sql += options.quote(limit)
      } else if (databaseType == "pgsql") {
        sql += "ALL"
      } else if (databaseType == "sqlite") {
        sql += "-1"
      } else {
        sql += "18446744073709551615"
      }

      if (hasOffset) {
        if (pretty) {
          sql += "\n  "
        } else {
          sql += " "
        }

        sql += `OFFSET ${options.quote(offset)}`
      }
    }

    return sql
  }
}
