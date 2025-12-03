import AlterTable from "./sql/alter-table.js"
import Base from "../base.js"
import connectConnection from "./connect-connection.js"
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
  async connect() {
    this.pool = mysql.createPool(Object.assign({connectionLimit: 1}, this.connectArgs()))
    this.pool.on("error", this.onPoolError)
  }

  onPoolError = (error) => {
    console.error("Velocious / MySQL driver / Pool error", error)
  }

  async close() {
    await this.pool.end()
    this.pool = undefined
  }

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

  async alterTableSql(tableData) {
    const alterArgs = {tableData, driver: this}
    const alterTable = new AlterTable(alterArgs)

    return await alterTable.toSqls()
  }

  createDatabaseSql(databaseName, args) {
    const createArgs = Object.assign({databaseName, driver: this}, args)
    const createDatabase = new CreateDatabase(createArgs)

    return createDatabase.toSql()
  }

  createIndexSql(indexData) {
    const createArgs = Object.assign({driver: this}, indexData)
    const createIndex = new CreateIndex(createArgs)

    return createIndex.toSql()
  }

  createTableSql(tableData) {
    const createArgs = {tableData, driver: this}
    const createTable = new CreateTable(createArgs)

    return createTable.toSql()
  }

  async currentDatabase() {
    const rows = await this.query("SELECT DATABASE() AS db_name")

    return digg(rows, 0, "db_name")
  }

  async disableForeignKeys() {
    await this.query("SET FOREIGN_KEY_CHECKS = 0")
  }

  async enableForeignKeys() {
    await this.query("SET FOREIGN_KEY_CHECKS = 1")
  }

  dropTableSql(tableName, args = {}) {
    const dropArgs = Object.assign({tableName, driver: this}, args)
    const dropTable = new DropTable(dropArgs)

    return dropTable.toSql()
  }

  getType() { return "mysql" }
  primaryKeyType() { return "bigint" }

  async _queryActual(sql) {
    try {
      return await query(this.pool, sql)
    } catch (error) {
      // Re-throw to un-corrupt stacktrace
      throw new Error(error.message)
    }
  }

  queryToSql(query) { return new QueryParser({query}).toSql() }
  shouldSetAutoIncrementWhenPrimaryKey() { return true }

  escape(value) {
    if (!this.pool) throw new Error("Can't escape before connected")

    const escapedValueWithQuotes = this.pool.escape(this._convertValue(value))

    return escapedValueWithQuotes.slice(1, escapedValueWithQuotes.length - 1)
  }

  quote(value) {
    if (!this.pool) throw new Error("Can't escape before connected")

    return this.pool.escape(this._convertValue(value))
  }

  deleteSql({tableName, conditions}) {
    const deleteInstruction = new Delete({conditions, driver: this, tableName})

    return deleteInstruction.toSql()
  }

  insertSql(args) {
    const insertArgs = Object.assign({driver: this}, args)
    const insert = new Insert(insertArgs)

    return insert.toSql()
  }

  async getTables() {
    const result = await this.query("SHOW FULL TABLES")
    const tables = []

    for (const row of result) {
      const table = new Table(this, row)

      tables.push(table)
    }

    return tables
  }

  async lastInsertID() {
    const result = await this.query("SELECT LAST_INSERT_ID() AS last_insert_id")

    return digg(result, 0, "last_insert_id")
  }

  options() {
    if (!this._options) this._options = new Options({driver: this})

    return this._options
  }

  async _startTransactionAction() {
    await this.query("START TRANSACTION")
  }

  updateSql({conditions, data, tableName}) {
    const update = new Update({conditions, data, driver: this, tableName})

    return update.toSql()
  }
}
