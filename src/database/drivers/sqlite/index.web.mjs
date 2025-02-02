import Base from "../base.mjs"
import CreateTable from "../sqlite/sql/create-table.mjs"
import Delete from "../sqlite/sql/delete.mjs"
import {digg} from "diggerize"
import Insert from "../sqlite/sql/insert.mjs"
import Options from "../sqlite/options.mjs"
import query from "./query"
import QueryParser from "../sqlite/query-parser.mjs"
import Update from "../sqlite/sql/update.mjs"

import initSqlJs from "sql.js"

export default class VelociousDatabaseDriversSqliteWeb extends Base{
  async connect() {
    const SQL = await initSqlJs({
      // Required to load the wasm binary asynchronously. Of course, you can host it wherever you want you can omit locateFile completely when running in Node.
      locateFile: (file) => `https://sql.js.org/dist/${file}`
    })

    const databaseContent = localStorage.getItem(this.localStorageName())

    this.connection = new SQL.Database(databaseContent)
  }

  localStorageName = () => `VelociousDatabaseDriversSqliteWeb---${digg(this.getArgs(), "name")}`
  disconnect = () => this.saveDatabase()
  saveDatabase = () => localStorage.setItem(this.localStorageName(), this.connection.export())

  async close() {
    this.saveDatabase()
    await this.connection.end()
    this.connection = undefined
  }

  createTableSql(tableData) {
    const createArgs = Object.assign({tableData, driver: this})
    const createTable = new CreateTable(createArgs)

    return createTable.toSql()
  }

  query = async (sql) => await query(this.connection, sql)
  queryToSql = (query) => new QueryParser({query}).toSql()

  quote(string) {
    if (!this.connection) throw new Error("Can't escape before connected")

    return this.connection.escape(string)
  }

  quoteColumn = (string) => `\`${string}\``
  deleteSql = ({tableName, conditions}) => new Delete({conditions, driver: this, tableName}).toSql()
  insertSql = ({tableName, data}) => new Insert({driver: this, tableName, data}).toSql()

  options() {
    if (!this._options) {
      this._options = new Options({driver: this})
    }

    return this._options
  }

  updateSql = ({conditions, data, tableName}) => new Update({conditions, data, driver: this, tableName}).toSql()
}
