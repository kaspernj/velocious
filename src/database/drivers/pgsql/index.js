// @ts-check

import AlterTable from "./sql/alter-table.js"
import Base from "../base.js"
import {Client} from "pg"
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
import StructureSql from "./structure-sql.js"
import Update from "./sql/update.js"

export default class VelociousDatabaseDriversPgsql extends Base{
  async connect() {
    const client = new Client(this.connectArgs())

    try {
      await client.connect()
    } catch (error) {
      // Re-throw to recover real stack trace
      if (error instanceof Error) {
        throw new Error(`Connect to Postgres server failed: ${error.message}`, {cause: error})
      } else {
        throw new Error(`Connect to Postgres server failed: ${error}`, {cause: error})
      }
    }

    this.connection = client
  }

  async disconnect() {
    await this.connection?.end()
    this.connection = undefined
    this._transactionsCount = 0
  }

  connectArgs() {
    const args = this.getArgs()
    const forward = ["database", "host", "password", "port"]

    /** @type {Record<string, any>} */
    const connectArgs = {}

    for (const forwardValue of forward) {
      if (forwardValue in args) connectArgs[forwardValue] = digg(args, forwardValue)
    }

    if ("username" in args) connectArgs["user"] = args["username"]

    return connectArgs
  }

  async close() {
    await this.connection?.end()
    this.connection = undefined
    this._transactionsCount = 0
  }

  /**
   * @param {import("../../table-data/index.js").default} tableData - Table data.
   * @returns {Promise<string[]>} - Resolves with SQL statements.
   */
  async alterTableSQLs(tableData) {
    const alterArgs = {tableData, driver: this}
    const alterTable = new AlterTable(alterArgs)

    return await alterTable.toSQLs()
  }

  /**
   * @param {string} databaseName - Database name.
   * @param {object} [args] - Options object.
   * @param {boolean} [args.ifNotExists] - Whether if not exists.
   * @returns {string[]} - SQL statements.
   */
  createDatabaseSql(databaseName, args) {
    const createArgs = Object.assign({databaseName, driver: this}, args)
    const createDatabase = new CreateDatabase(createArgs)

    return createDatabase.toSql()
  }

  /**
   * @param {import("../base.js").CreateIndexSqlArgs} indexData - Index data.
   * @returns {Promise<string[]>} - Resolves with SQL statements.
   */
  async createIndexSQLs(indexData) {
    const createArgs = Object.assign({driver: this}, indexData)
    const createIndex = new CreateIndex(createArgs)

    return await createIndex.toSQLs()
  }

  /**
   * @param {import("../../table-data/index.js").default} tableData - Table data.
   * @returns {Promise<string[]>} - Resolves with SQL statements.
   */
  async createTableSql(tableData) {
    const createArgs = {tableData, driver: this, indexInCreateTable: false}
    const createTable = new CreateTable(createArgs)

    return await createTable.toSql()
  }

  async currentDatabase() {
    const rows = await this.query("SELECT CURRENT_DATABASE() AS db_name")

    return digg(rows, 0, "db_name")
  }

  async disableForeignKeys() {
    await this.query("SET session_replication_role = 'replica'")
  }

  async enableForeignKeys() {
    await this.query("SET session_replication_role = 'origin'")
  }

  /**
   * @param {string} tableName - Table name.
   * @param {import("../base.js").DropTableSqlArgsType} [args] - Options object.
   * @returns {Promise<string[]>} - Resolves with SQL statements.
   */
  async dropTableSQLs(tableName, args = {}) {
    const dropArgs = Object.assign({tableName, driver: this}, args)
    const dropTable = new DropTable(dropArgs)

    return await dropTable.toSQLs()
  }

  getType() { return "pgsql" }
  primaryKeyType() { return "bigint" }

  /**
   * @param {string} sql - SQL string.
   * @returns {Promise<import("../base.js").QueryResultType>} - Resolves with the query actual.
   */
  async _queryActual(sql) {
    let response

    if (!this.connection) await this.connect()

    try {
      response = await this.connection.query(sql)
    } catch (error) {
      if (error instanceof Error) {
        throw new Error(`Query failed: ${error.message} with SQL: ${sql}`, {cause: error})
      } else {
        throw new Error(`Query failed: ${error} with SQL: ${sql}`, {cause: error})
      }
    }

    return response.rows
  }

  /**
   * @param {import("../../query/index.js").default} query - Query instance.
   * @returns {string} - SQL string.
   */
  queryToSql(query) { return new QueryParser({query}).toSql() }
  shouldSetAutoIncrementWhenPrimaryKey() { return true }
  supportsDefaultPrimaryKeyUUID() { return true }

  /**
   * @param {any} value - Value to use.
   * @returns {any} - The converted value.
   */
  _convertValue(value) {
    if (typeof value === "boolean") {
      return value ? "true" : "false"
    }

    return super._convertValue(value)
  }

  /**
   * @param {any} value - Value to use.
   * @returns {any} - The escape.
   */
  escape(value) {
    if (!this.connection) throw new Error("Can't escape before connected")
    if (typeof value === "number") return value

    const escapedValueWithQuotes = this.connection.escapeLiteral(this._convertValue(value))

    return escapedValueWithQuotes.slice(1, escapedValueWithQuotes.length - 1)
  }

  /**
   * @param {any} value - Value to use.
   * @returns {string | number} - The quoted value.
   */
  quote(value) {
    if (!this.connection) throw new Error("Can't escape before connected")
    if (typeof value === "number") return value

    return this.connection.escapeLiteral(this._convertValue(value))
  }

  /**
   * @param {import("../base.js").DeleteSqlArgsType} args - Options object.
   * @returns {string} - SQL string.
   */
  deleteSql({tableName, conditions}) {
    const deleteInstruction = new Delete({conditions, driver: this, tableName})

    return deleteInstruction.toSql()
  }

  /**
   * @abstract
   * @param {import("../base.js").InsertSqlArgsType} args - Options object.
   * @returns {string} - SQL string.
   */
  insertSql(args) {
    const insertArgs = Object.assign({driver: this}, args)
    const insert = new Insert(insertArgs)

    return insert.toSql()
  }

  async getTables() {
    const result = await this.query("SELECT * FROM information_schema.tables WHERE table_catalog = CURRENT_DATABASE() AND table_schema = 'public'")
    const tables = []

    for (const row of result) {
      const table = new Table(this, /** @type {Record<string, string>} */ (row))

      tables.push(table)
    }

    return tables
  }

  async lastInsertID() {
    const result = await this.query("SELECT LASTVAL() AS last_insert_id")

    return digg(result, 0, "last_insert_id")
  }

  options() {
    if (!this._options) this._options = new Options(this)

    return this._options
  }

  async _startTransactionAction() {
    await this.query("START TRANSACTION")
  }

  /**
   * @abstract
   * @param {import("../base.js").UpdateSqlArgsType} args - Options object.
   * @returns {string} - SQL string.
   */
  updateSql({conditions, data, tableName}) {
    const update = new Update({conditions, data, driver: this, tableName})

    return update.toSql()
  }

  /**
   * @returns {Promise<string | null>} - Resolves with SQL string.
   */
  async structureSql() {
    return await new StructureSql({driver: this}).toSql()
  }
}
