import QueryBase from "./base.mjs"

export default class VelociousDatabaseQueryCreateTableBase extends QueryBase {
  constructor({columns, driver, ifNotExists, indexes, tableName}) {
    super({driver})
    this.columns = columns
    this.ifNotExists = ifNotExists
    this.indexes = indexes
    this.tableName = tableName
  }

  toSql() {
    const {tableName} = this
    let sql = "CREATE TABLE"

    if (this.ifNotExists) sql += " IF NOT EXISTS"

    sql += ` ${tableName} (`

    this.columns.forEach((column, columnIndex) => {
      let maxlength = column.args.maxlength
      let type = column.args.type

      if (type == "string") {
        type = "varchar"
        maxlength ||= 255
      }

      if (columnIndex > 0) sql += ", "

      sql += `${this.driver.quoteColumn(column.name)} ${type}`

      if (maxlength !== undefined) sql += `(${maxlength})`
    })

    sql += ")"

    console.log(sql)

    return sql
  }
}
