// @ts-check

import WhereBase from "./where-base.js"

/**
 * @typedef {{[key: string]: any}} WhereHash
 */

export default class VelociousDatabaseQueryWhereHash extends WhereBase {
  /**
   * @param {import("./index.js").default} query
   * @param {WhereHash} hash
   */
  constructor(query, hash) {
    super()
    this.hash = hash
    this.query = query
  }

  /**
   * @returns {string} - SQL string.
   */
  toSql() {
    let sql = "("

    sql += this._whereSQLFromHash(this.hash)
    sql += ")"

    return sql
  }

  /**
   * @param {WhereHash} hash
   * @param {string} [tableName]
   * @param {number} index
   * @returns {string} - SQL string.
   */
  _whereSQLFromHash(hash, tableName, index = 0) {
    const options = this.getOptions()
    let sql = ""

    for (const whereKey in hash) {
      const whereValue = hash[whereKey]

      if (!Array.isArray(whereValue) && whereValue !== null && typeof whereValue == "object") {
        sql += this._whereSQLFromHash(whereValue, whereKey, index)
      } else {
        if (index > 0) sql += " AND "

        if (tableName) {
          sql += `${options.quoteTableName(tableName)}.`
        }

        sql += `${options.quoteColumnName(whereKey)}`

        if (Array.isArray(whereValue)) {
          sql += ` IN (${whereValue.map((value) => options.quote(value)).join(", ")})`
        } else if (whereValue === null) {
          sql += " IS NULL"
        } else {
          sql += ` = ${options.quote(whereValue)}`
        }
      }

      index++
    }

    return sql
  }
}
