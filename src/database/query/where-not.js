// @ts-check

import WhereBase from "./where-base.js"

export default class VelociousDatabaseQueryWhereNot extends WhereBase {
  /**
 * Runs constructor.
   * @param {import("./where-base.js").default} where - Where clause.
   */
  constructor(where) {
    super()
    this.where = where
    this.query = where.getQuery()
  }

  /**
 * Runs to sql.
   * @returns {string} - SQL string.
   */
  toSql() {
    return `NOT (${this.where.toSql()})`
  }
}
