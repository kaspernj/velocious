import CreateIndexBase from "./create-index-base.js"
import * as inflection from "inflection"
import QueryBase from "./base.js"

export default class VelociousDatabaseQueryCreateTableBase extends QueryBase {
  constructor({driver, ifNotExists, indexInCreateTable = true, tableData}) {
    super({driver})
    this.ifNotExists = ifNotExists
    this.indexInCreateTable = indexInCreateTable
    this.tableData = tableData
  }

  getConfiguration = () => this.driver.getConfiguration()

  toSql() {
    const databaseType = this.getConfiguration().getDatabaseType()
    const {tableData} = this
    const sqls = []

    let sql = "CREATE TABLE"

    if (this.ifNotExists || tableData.getIfNotExists()) sql += " IF NOT EXISTS"

    sql += ` ${tableData.getName()} (`

    let columnCount = 0

    for (const column of tableData.getColumns()) {
      columnCount++

      let maxlength = column.getMaxLength()
      let type = column.getType().toUpperCase()

      if (type == "STRING") {
        type = "VARCHAR"
        maxlength ||= 255
      }

      if (databaseType == "sqlite" && column.getAutoIncrement() && column.getPrimaryKey()) {
        type = "INTEGER"
      }

      if (columnCount > 1) sql += ", "

      sql += `${this.driver.quoteColumn(column.getName())} ${type}`

      if (maxlength !== undefined) sql += `(${maxlength})`

      if (column.getAutoIncrement() && this.driver.shouldSetAutoIncrementWhenPrimaryKey()) sql += " AUTO_INCREMENT"
      if (column.getPrimaryKey()) sql += " PRIMARY KEY"
      if (column.getNull() === false) sql += " NOT NULL"

      if (column.getForeignKey()) {
        let foreignKeyTable, foreignKeyColumn

        if (column.getForeignKey() === true) {
          foreignKeyColumn = "id"
          foreignKeyTable = inflection.pluralize(column.getName().replace(/_id$/, ""))
        } else {
          throw new Error(`Unknown foreign key type given: ${column.getForeignKey()} (${typeof column.getForeignKey()})`)
        }

        sql += ` REFERENCES ${this.driver.quoteTable(foreignKeyTable)}(${this.driver.quoteColumn(foreignKeyColumn)})`
      }
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
