import Base from "../base.js"
import {Client, escapeLiteral} from "pg"
import CreateDatabase from "./sql/create-database.js"
import CreateIndex from "./sql/create-index.js"
import CreateTable from "./sql/create-table.js"
import Delete from "./sql/delete.js"
import {digg} from "diggerize"
import DropTable from "./sql/drop-table.js"
import Insert from "./sql/insert.js"
import Options from "./options.js"
import QueryParser from "./query-parser.js"
import Table from "./table.js"
import Update from "./sql/update.js"

export default class VelociousDatabaseDriversPgsql extends Base{
  async connect() {
    const client = new Client(this.connectArgs())

    try {
      await client.connect()
    } catch (error) {
      // Re-throw to recover real stack trace
      throw new Error(`Connect to Postgres server failed: ${error.message}`)
    }

    this.connection = client
  }

  disconnect() {
    this.connection.end()
  }

  connectArgs() {
    const args = this.getArgs()
    const connectArgs = []
    const forward = ["database", "host", "password", "port"]

    for (const forwardValue of forward) {
      if (forwardValue in args) connectArgs[forwardValue] = digg(args, forwardValue)
    }

    if ("username" in args) connectArgs["user"] = args["username"]

    return connectArgs
  }

  async close() {
    await this.connection.end()
    this.connection = undefined
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
    const createArgs = Object.assign({tableData, driver: this, indexInCreateTable: false})
    const createTable = new CreateTable(createArgs)

    return createTable.toSql()
  }

  async disableForeignKeys() {
    await this.query("SET session_replication_role = 'replica'")
  }

  async enableForeignKeys() {
    await this.query("SET session_replication_role = 'origin'")
  }

  dropTableSql(tableName, args = {}) {
    const dropArgs = Object.assign({tableName, driver: this}, args)
    const dropTable = new DropTable(dropArgs)

    return dropTable.toSql()
  }

  getType = () => "pgsql"
  primaryKeyType = () => "bigint"

  async query(sql) {
    let response

    console.log(sql)

    try {
      response = await this.connection.query(sql)
    } catch (error) {
      throw new Error(`Query failed: ${error.message} with SQL: ${sql}`)
    }

    return response.rows
  }

  queryToSql(query) {
    return new QueryParser({query}).toSql()
  }

  shouldSetAutoIncrementWhenPrimaryKey = () => true

  escape(value) {
    if (!this.connection) throw new Error("Can't escape before connected")
    if (typeof value === "number") return value

    const escapedValueWithQuotes = this.connection.escapeLiteral(this._convertValue(value))

    return escapedValueWithQuotes.slice(1, escapedValueWithQuotes.length - 1)
  }

  quote(value) {
    if (!this.connection) throw new Error("Can't escape before connected")
    if (typeof value === "number") return value

    return this.connection.escapeLiteral(this._convertValue(value))
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
    const result = await this.query("SELECT * FROM information_schema.tables WHERE table_catalog = CURRENT_DATABASE() AND table_schema = 'public'")
    const tables = []

    for (const row of result) {
      const table = new Table(this, row)

      tables.push(table)
    }

    return tables
  }

  async lastInsertID() {
    const result = await this.query("SELECT LASTVAL() AS last_insert_id")

    return digg(result, 0, "last_insert_id")
  }

  options() {
    if (!this._options) this._options = new Options({driver: this})

    return this._options
  }

  async startTransaction() {
    return await this.query("START TRANSACTION")
  }

  updateSql({conditions, data, tableName}) {
    const update = new Update({conditions, data, driver: this, tableName})

    return update.toSql()
  }
}
