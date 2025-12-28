// @ts-check

import WhereBase from "./where-base.js"

/**
 * @typedef {{[key: string]: string | number | boolean | null | Array<string | number | boolean | null> | WhereHash}} WhereHash
 */

export default class VelociousDatabaseQueryWhereHash extends WhereBase {
  /**
   * @param {import("./index.js").default} query - Query instance.
   * @param {WhereHash} hash - Hash.
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
   * @param {WhereHash} hash - Hash.
   * @param {string} [tableName] - Table name.
   * @param {number} index - Index value.
   * @returns {string} - SQL string.
   */
  _whereSQLFromHash(hash, tableName, index = 0) {
    const options = this.getOptions()
    let sql = ""

    for (const whereKey in hash) {
      const whereValue = hash[whereKey]

      if (Array.isArray(whereValue) && whereValue.length === 0) {
        if (index > 0) sql += " AND "
        sql += "1=0"
      } else if (!Array.isArray(whereValue) && whereValue !== null && typeof whereValue == "object") {
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
