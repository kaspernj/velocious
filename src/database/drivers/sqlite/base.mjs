import {digg} from "diggerize"

import Base from "../base.mjs"
import CreateIndex from "../sqlite/sql/create-index.mjs"
import CreateTable from "../sqlite/sql/create-table.mjs"
import Delete from "../sqlite/sql/delete.mjs"
import escapeString from "sql-string-escape"
import Insert from "../sqlite/sql/insert.mjs"
import Options from "../sqlite/options.mjs"
import QueryParser from "../sqlite/query-parser.mjs"
import Table from "./table"
import Update from "../sqlite/sql/update.mjs"

export default class VelociousDatabaseDriversSqliteBase extends Base {
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

  deleteSql = ({tableName, conditions}) => new Delete({conditions, driver: this, tableName}).toSql()
  insertSql = ({tableName, data}) => new Insert({driver: this, tableName, data}).toSql()

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

  async lastInsertID() {
    const result = await this.query("SELECT LAST_INSERT_ROWID() AS last_insert_id")

    return digg(result, 0, "last_insert_id")
  }

  options() {
    if (!this._options) {
      this._options = new Options({driver: this})
    }

    return this._options
  }

  queryToSql = (query) => new QueryParser({query}).toSql()

  escape(value) {
    const type = typeof value

    if (type != "string") value = `${value}`

    const resultWithQuotes = escapeString(value)
    const result = resultWithQuotes.substring(1, resultWithQuotes.length - 1)

    return result
  }

  quote(value) {
    const type = typeof value

    if (type == "number") return value
    if (type != "string") value = `${value}`

    return escapeString(value)
  }

  quoteColumn = (string) => {
    if (string.includes("`")) throw new Error(`Possible SQL injection in column name: ${string}`)

    return `\`${string}\``
  }

  quoteTable = (string) => {
    if (string.includes("`")) throw new Error(`Possible SQL injection in table name: ${string}`)

    return `\`${string}\``
  }

  updateSql = ({conditions, data, tableName}) => new Update({conditions, data, driver: this, tableName}).toSql()
}
