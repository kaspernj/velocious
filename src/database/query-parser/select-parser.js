import {digs} from "diggerize"
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

      selectValue.setQuery(query)

      sql += selectValue.toSql()

      if (selectKey + 1 < query._selects.length) {
        if (pretty) {
          sql += ","
          sql += "  "
        } else {
          sql += ", "
        }
      }
    }

    if (query.getSelects().length == 0) {
      if (query.modelClass) {
        sql += `${query.modelClass.connection().quoteTable(query.modelClass.tableName())}.*`
      } else {
        sql += "*"
      }
    }

    return sql
  }
}
