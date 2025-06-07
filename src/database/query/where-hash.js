import WhereBase from "./where-base.js"

export default class VelociousDatabaseQueryWhereHash extends WhereBase {
  constructor(query, hash) {
    super()
    this.hash = hash
    this.query = query
  }

  toSql() {
    const options = this.getOptions()
    let sql = "("
    let index = 0

    for (const whereKey in this.hash) {
      const whereValue = this.hash[whereKey]

      if (index > 0) sql += " AND "

      sql += `${options.quoteColumnName(whereKey)}`

      if (Array.isArray(whereValue)) {
        sql += ` IN (${whereValue.map((value) => options.quote(value)).join(", ")})`
      } else {
        sql += ` = ${options.quote(whereValue)}`
      }

      index++
    }

    sql += ")"

    return sql
  }
}
