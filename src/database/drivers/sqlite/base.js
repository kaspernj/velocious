import {digg} from "diggerize"

import AlterTable from "./sql/alter-table.js"
import Base from "../base.js"
import CreateIndex from "./sql/create-index.js"
import CreateTable from "./sql/create-table.js"
import Delete from "./sql/delete.js"
import DropTable from "./sql/drop-table.js"
import escapeString from "sql-escape-string"
import Insert from "./sql/insert.js"
import Options from "./options.js"
import QueryParser from "./query-parser.js"
import Table from "./table.js"
import Update from "./sql/update.js"

export default class VelociousDatabaseDriversSqliteBase extends Base {
  alterTableSql(columnData) {
    const createArgs = Object.assign({driver: this}, columnData)
    const alterTable = new AlterTable(createArgs)

    return alterTable.toSqls()
  }

  createIndexSql(indexData) {
    const createArgs = Object.assign({driver: this}, indexData)
    const createIndex = new CreateIndex(createArgs)

    return createIndex.toSql()
  }

  createTableSql(tableData) {
    const createArgs = Object.assign({tableData, driver: this, indexInCreateTable: false})
    const createTable = new CreateTable(createArgs)

    return createTable.toSql()
  }

  async disableForeignKeys() {
    await this.query("PRAGMA foreign_keys = 0")
  }

  async enableForeignKeys() {
    await this.query("PRAGMA foreign_keys = 1")
  }

  dropTableSql(tableName, args = {}) {
    const dropArgs = Object.assign({tableName, driver: this}, args)
    const dropTable = new DropTable(dropArgs)

    return dropTable.toSql()
  }

  deleteSql = (args) => new Delete(Object.assign({driver: this}, args)).toSql()
  getType = () => "sqlite"
  insertSql = (args) => new Insert(Object.assign({driver: this}, args)).toSql()

  async getTableByName(tableName) {
    const result = await this.query(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = ${this.quote(tableName)} LIMIT 1`)
    const row = result[0]

    if (!row) {
      const tables = await this.getTables()
      const tableNames = tables.map((table) => table.getName())

      throw new Error(`No table by that name: ${tableName} in ${tableNames.join(", ")}`)
    }

    return new Table({driver: this, row})
  }

  async getTables() {
    const result = await this.query("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
    const tables = []

    for (const row of result) {
      const table = new Table({driver: this, row})

      tables.push(table)
    }

    return tables
  }

  async insertMultiple(...args) {
    await this.registerVersion()

    if (this.supportsMultipleInsertValues()) {
      return await this.insertMultipleWithSingleInsert(...args)
    } else {
      return await this.insertMultipleWithTransaction(...args)
    }
  }

  supportsMultipleInsertValues() {
    if (this.versionMajor >= 4) return true
    if (this.versionMajor == 3 && this.versionMinor >= 8) return true
    if (this.versionMajor == 3 && this.versionMinor == 7 && this.versionPatch >= 11) return true

    return false
  }

  async insertMultipleWithSingleInsert(tableName, columns, rows) {
    const sql = new Insert({columns, driver: this, rows, tableName}).toSql()

    return await this.query(sql)
  }

  async insertMultipleWithTransaction(tableName, columns, rows) {
    const sqls = []

    for (const row of rows) {
      const data = []

      for (const columnIndex in columns) {
        const columnName = columns[columnIndex]
        const value = row[columnIndex]

        data[columnName] = value
      }

      const insertSql = this.insertSql({tableName, data})

      sqls.push(insertSql)
    }

    await this.transaction(async () => {
      for (const sql of sqls) {
        await this.query(sql)
      }
    })
  }

  async lastInsertID() {
    const result = await this.query("SELECT LAST_INSERT_ROWID() AS last_insert_id")

    return digg(result, 0, "last_insert_id")
  }

  options() {
    if (!this._options) this._options = new Options({driver: this})

    return this._options
  }

  primaryKeyType = () => "integer" // Because bigint on SQLite doesn't support auto increment
  queryToSql = (query) => new QueryParser({query}).toSql()

  async registerVersion() {
    if (this.versionMajor || this.versionMinor) {
      return
    }

    const versionResult = await this.query("SELECT sqlite_version() AS version")

    this.version = versionResult[0].version

    const versionParts = this.version.split(".")

    this.versionMajor = versionParts[0]
    this.versionMinor = versionParts[1]
    this.versionPatch = versionParts[2]
  }

  shouldSetAutoIncrementWhenPrimaryKey = () => false

  escape(value) {
    value = this._convertValue(value)

    const type = typeof value

    if (type != "string") value = `${value}`

    const resultWithQuotes = escapeString(value)
    const result = resultWithQuotes.substring(1, resultWithQuotes.length - 1)

    return result
  }

  quote(value) {
    value = this._convertValue(value)

    const type = typeof value

    if (type == "number") return value
    if (type != "string") value = `${value}`

    return escapeString(value)
  }

  updateSql = ({conditions, data, tableName}) => new Update({conditions, data, driver: this, tableName}).toSql()
}
