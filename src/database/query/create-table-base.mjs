import QueryBase from "./base.mjs"

export default class VelociousDatabaseQueryCreateTableBase extends QueryBase {
  constructor({driver, ifNotExists, tableData}) {
    super({driver})
    this.ifNotExists = ifNotExists
    this.tableData = tableData
  }

  toSql() {
    const {tableData} = this
    let sql = "CREATE TABLE"

    if (this.ifNotExists || tableData.getIfNotExists()) sql += " IF NOT EXISTS"

    sql += ` ${tableData.getName()} (`

    let columnCount = 0

    for (const column of tableData.getColumns()) {
      columnCount++

      let maxlength = column.args.maxlength
      let type = column.args.type

      if (type == "string") {
        type = "varchar"
        maxlength ||= 255
      }

      if (columnCount > 1) sql += ", "

      sql += `${this.driver.quoteColumn(column.name)} ${type}`

      if (maxlength !== undefined) sql += `(${maxlength})`

      if (column.args.autoIncrement) sql += " AUTO_INCREMENT"
      if (column.args.primaryKey) sql += " PRIMARY KEY"
    }

    for (const index of tableData.getIndexes()) {
      sql += ","

      if (index.getUnique()) {
        sql += " UNIQUE"
      }

      sql += " INDEX"

      if (index.getName()) {
        sql += ` ${index.getName()}`
      }

      sql += " ("

      index.getColumns().forEach((column, columnIndex) => {
        if (columnIndex > 0) sql += ", "

        sql += this.driver.quoteColumn(column.name)
      })

      sql += ")"
    }

    sql += ")"

    return sql
  }
}
