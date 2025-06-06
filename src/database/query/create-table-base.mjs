import CreateIndexBase from "./create-index-base.mjs"
import QueryBase from "./base.mjs"

export default class VelociousDatabaseQueryCreateTableBase extends QueryBase {
  constructor({driver, ifNotExists, indexInCreateTable = true, tableData}) {
    super({driver})
    this.ifNotExists = ifNotExists
    this.indexInCreateTable = indexInCreateTable
    this.tableData = tableData
  }

  toSql() {
    const {tableData} = this
    const sqls = []

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
      if (column.args.null === false) sql += " NOT NULL"
    }

    if (this.indexInCreateTable) {
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
    }

    sql += ")"

    sqls.push(sql)

    if (!this.indexInCreateTable) {
      for (const index of tableData.getIndexes()) {
        const createIndexArgs = {
          columns: index.getColumns(),
          driver: this.getDriver(),
          tableName: tableData.getName(),
          unique: index.getUnique()
        }
        const sql = new CreateIndexBase(createIndexArgs).toSql()

        sqls.push(sql)
      }
    }

    return [sql]
  }
}
