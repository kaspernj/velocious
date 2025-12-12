// @ts-check

import CreateIndexBase from "./create-index-base.js"
import QueryBase from "./base.js"
import restArgsError from "../../utils/rest-args-error.js"
import TableData from "../table-data/index.js"
import TableColumn from "../table-data/table-column.js"

export default class VelociousDatabaseQueryCreateTableBase extends QueryBase {
  /**
   * @param {object} args
   * @param {import("../drivers/base.js").default} args.driver
   * @param {boolean} args.ifNotExists
   * @param {boolean} args.indexInCreateTable
   * @param {TableData} args.tableData
   */
  constructor({driver, ifNotExists, indexInCreateTable = true, tableData}) {
    if (!(tableData instanceof TableData)) throw new Error("Invalid table data was given")

    super({driver})
    this.ifNotExists = ifNotExists
    this.indexInCreateTable = indexInCreateTable
    this.tableData = tableData
  }

  /**
   * @returns {string[]}
   */
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

          if (column instanceof TableColumn) {
            sql += driver.quoteColumn(column.getName())
          } else if (typeof column == "string") {
            sql += driver.quoteColumn(column)
          } else {
            throw new Error(`Unknown column type: ${typeof column}`)
          }
        })

        sql += ")"
      }

      // Create indexes for all columns with the index argument
      for (const column of tableData.getColumns()) {
        if (!column.getIndex()) continue

        let indexName = `index_on_`

        if (databaseType == "sqlite") sql += `${tableData.getName()}_`

        indexName += column.getName()

        sql += ","

        const {unique, ...restIndexArgs} = column.getIndexArgs()

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
          ifNotExists: true,
          name: index.getName(),
          tableName: tableData.getName(),
          unique: index.getUnique()
        }
        const createIndexSQLs = new CreateIndexBase(createIndexArgs).toSqls()

        for (const createIndexSQL of createIndexSQLs) {
          sqls.push(createIndexSQL)
        }
      }

      // Create indexes for all columns with the index argument
      for (const column of tableData.getColumns()) {
        if (!column.getIndex()) continue

        const {unique, ...restIndexArgs} = column.getIndexArgs()

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
        const createIndexSQLs = new CreateIndexBase(createIndexArgs).toSqls()

        for (const createIndexSQL of createIndexSQLs) {
          sqls.push(createIndexSQL)
        }
      }
    }

    return sqls
  }
}
