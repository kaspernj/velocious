import CreateIndexBase from "./create-index-base.js"
import {digs} from "diggerize"
import QueryBase from "./base.js"
import restArgsError from "../../utils/rest-args-error.js"
import TableData from "../table-data/index.js"

export default class VelociousDatabaseQueryCreateTableBase extends QueryBase {
  constructor({driver, ifNotExists, indexInCreateTable = true, tableData}) {
    if (!(tableData instanceof TableData)) throw new Error("Invalid table data was given")

    super({driver})
    this.ifNotExists = ifNotExists
    this.indexInCreateTable = indexInCreateTable
    this.tableData = tableData
  }

  toSql() {
    const databaseType = this.getDatabaseType()
    const driver = this.getDriver()
    const options = this.getOptions()
    const {tableData} = digs(this, "tableData")
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

      if (columnCount > 1) sql += ", "

      sql += column.getSQL({driver, forAlterTable: false})
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

      // Create indexes for all columns with the index argument
      for (const column of tableData.getColumns()) {
        if (!column.getIndex()) continue

        const indexName = `index_on_`

        if (databaseType == "sqlite") sql += `${tableData.getName()}_`

        indexName += column.getName()

        sql += ","

        const {unique, ...restIndexArgs} = column.getIndex()

        restArgsError(restIndexArgs)

        if (unique) {
          sql += " UNIQUE"
        }

        sql += ` INDEX ${options.quoteIndexName(indexName)} (${options.quoteColumnName(column.getName())})`
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
          name: index.getName(),
          tableName: tableData.getName(),
          unique: index.getUnique()
        }
        const sql = new CreateIndexBase(createIndexArgs).toSql()

        sqls.push(sql)
      }

      // Create indexes for all columns with the index argument
      for (const column of tableData.getColumns()) {
        if (!column.getIndex()) continue

        const {unique, ...restIndexArgs} = column.getIndex()

        restArgsError(restIndexArgs)

        let indexName = `index_on_`

        if (databaseType == "sqlite") indexName += `${tableData.getName()}_`

        indexName += column.getName()

        const createIndexArgs = {
          columns: [column.getName()],
          driver: this.getDriver(),
          name: indexName,
          tableName: tableData.getName(),
          unique
        }
        const sql = new CreateIndexBase(createIndexArgs).toSql()

        sqls.push(sql)
      }
    }

    return sqls
  }
}
