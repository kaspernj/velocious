// @ts-check

import restArgsError from "../../utils/rest-args-error.js"

export default class VelociousDatabaseQueryParserSelectParser {
  /**
   * @param {object} args
   * @param {boolean} args.pretty
   * @param {import("../query/index.js").default} args.query
   */
  constructor({pretty, query, ...restArgs}) {
    restArgsError(restArgs)

    this.pretty = pretty
    this.query = query
  }

  toSql() {
    const {pretty, query} = this

    let sql = ""

    sql += "SELECT"

    if (pretty) {
      sql += "\n"
    } else {
      sql += " "
    }

    let count = 0

    for (const selectValue of query._selects) {
      selectValue.setQuery(query)

      sql += selectValue.toSql()

      if (count + 1 < query._selects.length) {
        if (pretty) {
          sql += ","
          sql += "  "
        } else {
          sql += ", "
        }
      }

      count++
    }

    if (query.getSelects().length == 0) {
      // @ts-expect-error
      if (query.constructor.name == "ModelClassQuery" && query.modelClass) {
        // @ts-expect-error
        sql += `${query.modelClass.connection().quoteTable(query.modelClass.tableName())}.*`
      } else {
        sql += "*"
      }
    }

    return sql
  }
}
