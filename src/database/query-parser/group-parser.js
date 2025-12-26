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

  /**
   * @returns {string} - SQL string.
   */
  toSql() {
    const {pretty, query} = this
    const groups = query.getGroups()

    if (groups.length == 0) {
      return ""
    }

    let sql = " GROUP BY"

    for (const groupKey in groups) {
      const group = groups[groupKey]

      if (typeof groupKey == "number" && groupKey > 0) {
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
        throw new Error(`Unsupported group type: ${typeof group}`)
      }
    }

    return sql
  }
}
