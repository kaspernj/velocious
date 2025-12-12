import AlterTable from "./sql/alter-table.js"
import Base from "../base.js"
import CreateDatabase from "./sql/create-database.js"
import CreateIndex from "./sql/create-index.js"
import CreateTable from "./sql/create-table.js"
import Delete from "./sql/delete.js"
import {digg} from "diggerize"
import DropTable from "./sql/drop-table.js"
import Insert from "./sql/insert.js"
import Options from "./options.js"
import mysql from "mysql"
import query from "./query.js"
import QueryParser from "./query-parser.js"
import Table from "./table.js"
import Update from "./sql/update.js"

export default class VelociousDatabaseDriversMysql extends Base{
  /**
   * @returns {Promise<void>}
   */
  async connect() {
    this.pool = mysql.createPool(Object.assign({connectionLimit: 1}, this.connectArgs()))
    this.pool.on("error", this.onPoolError)
  }

  onPoolError = (error) => {
    console.error("Velocious / MySQL driver / Pool error", error)
  }

  /**
   * @returns {Promise<void>}
   */
  async close() {
    await this.pool.end()
    this.pool = undefined
  }

  /**
   * @returns {Record<string, any>}
   */
  connectArgs() {
    const args = this.getArgs()
    const connectArgs = []
    const forward = ["database", "host", "password"]

    for (const forwardValue of forward) {
      if (forwardValue in args) connectArgs[forwardValue] = digg(args, forwardValue)
    }

    if ("username" in args) connectArgs["user"] = args["username"]

    return connectArgs
  }

  /**
   * @returns {Promise<string[]>}
   */
  async alterTableSQLs(tableData) {
    const alterArgs = {tableData, driver: this}
    const alterTable = new AlterTable(alterArgs)

    return await alterTable.toSQLs()
  }

  /**
   * @returns {Promise<string[]>}
   */
  createDatabaseSql(databaseName, args) {
    const createArgs = Object.assign({databaseName, driver: this}, args)
    const createDatabase = new CreateDatabase(createArgs)

    return createDatabase.toSql()
  }

  /**
   * @returns {string}
   */
  createIndexSQLs(indexData) {
    const createArgs = Object.assign({driver: this}, indexData)
    const createIndex = new CreateIndex(createArgs)

    return createIndex.toSql()
  }

  /**
   * @returns {string[]}
   */
  createTableSql(tableData) {
    const createArgs = {tableData, driver: this}
    const createTable = new CreateTable(createArgs)

    return createTable.toSql()
  }

  /**
   * @returns {Promise<string>}
   */
  async currentDatabase() {
    const rows = await this.query("SELECT DATABASE() AS db_name")

    return digg(rows, 0, "db_name")
  }

  /**
   * @returns {Promise<void>}
   */
  async disableForeignKeys() {
    await this.query("SET FOREIGN_KEY_CHECKS = 0")
  }

  /**
   * @returns {Promise<void>}
   */
  async enableForeignKeys() {
    await this.query("SET FOREIGN_KEY_CHECKS = 1")
  }

  /**
   * @returns {string[]}
   */
  dropTableSQLs(tableName, args = {}) {
    const dropArgs = Object.assign({tableName, driver: this}, args)
    const dropTable = new DropTable(dropArgs)

    return dropTable.toSql()
  }

  /**
   * @returns {string}
   */
  getType() { return "mysql" }

  /**
   * @returns {string}
   */
  primaryKeyType() { return "bigint" }

  /**
   * @returns {Array<Record<string, any>>}
   */
  async _queryActual(sql) {
    try {
      return await query(this.pool, sql)
    } catch (error) {
      // Re-throw to un-corrupt stacktrace
      throw new Error(error.message)
    }
  }

  /**
   * @returns {string}
   */
  queryToSql(query) { return new QueryParser({query}).toSql() }

  /**
   * @returns {boolean}
   */
  shouldSetAutoIncrementWhenPrimaryKey() { return true }

  /**
   * @returns {string}
   */
  escape(value) {
    if (!this.pool) throw new Error("Can't escape before connected")

    const escapedValueWithQuotes = this.pool.escape(this._convertValue(value))

    return escapedValueWithQuotes.slice(1, escapedValueWithQuotes.length - 1)
  }

  /**
   * @returns {string}
   */
  quote(value) {
    if (!this.pool) throw new Error("Can't escape before connected")

    return this.pool.escape(this._convertValue(value))
  }

  /**
   * @returns {string}
   */
  deleteSql({tableName, conditions}) {
    const deleteInstruction = new Delete({conditions, driver: this, tableName})

    return deleteInstruction.toSql()
  }

  /**
   * @returns {string}
   */
  insertSql(args) {
    const insertArgs = Object.assign({driver: this}, args)
    const insert = new Insert(insertArgs)

    return insert.toSql()
  }

  /**
   * @returns {Array<Table>}
   */
  async getTables() {
    const result = await this.query("SHOW FULL TABLES")
    const tables = []

    for (const row of result) {
      const table = new Table(this, row)

      tables.push(table)
    }

    return tables
  }

  /**
   * @returns {number}
   */
  async lastInsertID() {
    const result = await this.query("SELECT LAST_INSERT_ID() AS last_insert_id")

    return digg(result, 0, "last_insert_id")
  }

  /**
   * @returns {Options}
   */
  options() {
    if (!this._options) this._options = new Options({driver: this})

    return this._options
  }

  /**
   * @returns {void}
   */
  async _startTransactionAction() {
    await this.query("START TRANSACTION")
  }

  /**
   * @returns {string}
   */
  updateSql({conditions, data, tableName}) {
    const update = new Update({conditions, data, driver: this, tableName})

    return update.toSql()
  }
}
