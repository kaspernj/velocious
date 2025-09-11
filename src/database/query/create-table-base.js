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

  toSql() {
    const databaseType = this.getDatabaseType()
    const driver = this.getDriver()
    const options = this.getOptions()
    const {tableData} = this
    const sqls = []
    const ifNotExists = this.ifNotExists || tableData.getIfNotExists()
    let sql = ""

    if (databaseType == "mssql" && ifNotExists) {
      sql += `IF NOT EXISTS(SELECT * FROM [sysobjects] WHERE [name] = ${options.quote(tableData.getName())} AND [xtype] = 'U') BEGIN `
    }

    sql += "CREATE TABLE"

    if (databaseType != "mssql" && ifNotExists) sql += " IF NOT EXISTS"

    sql += ` ${options.quoteTableName(tableData.getName())} (`

    let columnCount = 0

    for (const column of tableData.getColumns()) {
      columnCount++

      let maxlength = column.getMaxLength()
      let type = column.getType().toUpperCase()

      if (type == "DATETIME" && databaseType == "pgsql") {
        type = "TIMESTAMP"
      }

      if (type == "STRING") {
        type = "VARCHAR"
        maxlength ||= 255
      }

      if (databaseType == "mssql" && type == "BOOLEAN") {
        type = "BIT"
      }

      if (databaseType == "sqlite" && column.getAutoIncrement() && column.getPrimaryKey()) {
        type = "INTEGER"
      }

      if (databaseType == "pgsql" && column.getAutoIncrement() && column.getPrimaryKey()) {
        type = "SERIAL"
      }

      if (columnCount > 1) sql += ", "

      sql += `${options.quoteColumnName(column.getName())} ${type}`

      if (maxlength !== undefined) sql += `(${maxlength})`

      if (column.getAutoIncrement() && driver.shouldSetAutoIncrementWhenPrimaryKey()) {
        if (databaseType == "mssql") {
          sql += " IDENTITY"
        } else if (databaseType == "pgsql") {
          if (column.getAutoIncrement() && column.getPrimaryKey()) {
            // Do nothing
          } else {
            throw new Error("pgsql auto increment must be primary key")
          }
        } else {
          sql += " AUTO_INCREMENT"
        }
      }

      if (typeof column.getDefault() == "function") {
        sql += ` DEFAULT (${column.getDefault()()})`
      } else if (column.getDefault()) {
        sql += ` DEFAULT ${options.quote(column.getDefault())}`
      }

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

        sql += ` REFERENCES ${options.quoteTableName(foreignKeyTable)}(${options.quoteColumnName(foreignKeyColumn)})`
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
          sql += ` ${options.quoteIndexName(index.getName())}`
        }

        sql += " ("

        index.getColumns().forEach((column, columnIndex) => {
          if (columnIndex > 0) sql += ", "

          sql += driver.quoteColumn(column.name)
        })

        sql += ")"
      }
    }

    sql += ")"

    if (databaseType == "mssql" && ifNotExists) {
      sql += " END"
    }

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
