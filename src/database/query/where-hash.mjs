import WhereBase from "./where-base.mjs"

export default class VelociousDatabaseQueryWhereHash extends WhereBase {
  constructor(query, hash) {
    super()
    this.hash = hash
    this.query = query
  }

  toSql() {
    const options = this.getOptions()
    let sql = "("

    for (const whereKey in this.hash) {
      const whereValue = this.hash[whereKey]

      if (whereKey > 0) sql += " && "

      sql += `${options.quoteColumnName(whereKey)} = ${options.quote(whereValue)}`
    }

    sql += ")"

    return sql
  }
}
