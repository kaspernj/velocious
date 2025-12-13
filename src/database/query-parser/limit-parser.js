// @ts-check

export default class VelocuiousDatabaseQueryParserLimitParser {
  /**
   * @param {object} args
   * @param {boolean} args.pretty
   * @param {import("../query/index.js").default} args.query
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

    if (query._limit === null) return sql

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

    const limit = query._limit
    const offset = query._offset

    if (pretty) {
      sql += "\n  "
    } else {
      sql += " "
    }

    if (driver.getType() == "mssql") {
      sql += `OFFSET ${options.quote(offset === null ? 0 : offset)} ROWS FETCH FIRST ${options.quote(limit)} ROWS ONLY`
    } else {
      sql += options.quote(limit)

      if (offset !== null) {
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
