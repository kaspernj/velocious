import WhereBase from "./where-base.js"

export default class VelociousDatabaseQueryWhereHash extends WhereBase {
  constructor(query, hash) {
    super()
    this.hash = hash
    this.query = query
  }

  toSql() {
    let sql = "("

    sql += this._whereSQLFromHash(this.hash)
    sql += ")"

    return sql
  }

  _whereSQLFromHash(hash, tableName, index = 0) {
    const options = this.getOptions()
    let sql = ""

    for (const whereKey in hash) {
      const whereValue = hash[whereKey]

      if (index > 0) sql += " AND "

      if (!Array.isArray(whereValue) && whereValue !== null && typeof whereValue == "object") {
        sql += this._whereSQLFromHash(whereValue, whereKey, index)
      } else {
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
