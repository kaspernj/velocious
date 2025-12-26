// @ts-check

import restArgsError from "../../utils/rest-args-error.js"

export default class VelociousDatabaseQueryParserFromParser {
  /**
   * @param {object} args - Options object.
   * @param {boolean} args.pretty - Whether pretty.
   * @param {import("../query/index.js").default} args.query - Query instance.
   */
  constructor({pretty, query, ...restArgs}) {
    restArgsError(restArgs)

    this.pretty = pretty
    this.query = query
  }

  /** @returns {string} - SQL string.  */
  toSql() {
    const {pretty, query} = this
    const froms = query.getFroms()

    let sql = " FROM"

    for (const fromKey in froms) {
      const from = froms[fromKey]

      if (typeof fromKey == "number" && fromKey > 0) {
        sql += ","
      }

      if (pretty) {
        sql += "\n  "
      } else {
        sql += " "
      }

      from.setQuery(query)

      sql += from.toSql()
    }

    return sql
  }
}
