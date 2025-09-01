import Base from "../base.js"
import CreateDatabase from "./sql/create-database.js"
import CreateIndex from "./sql/create-index.js"
import CreateTable from "./sql/create-table.js"
import Delete from "./sql/delete.js"
import {digg} from "diggerize"
import escapeString from "sql-escape-string"
import Insert from "./sql/insert.js"
import Options from "./options.js"
import mssql from "mssql"
import QueryParser from "./query-parser.js"
import Table from "./table.js"
import Update from "./sql/update.js"
import {v4 as uuidv4} from "uuid"

export default class VelociousDatabaseDriversMssql extends Base{
  async connect() {
    const args = this.getArgs()
    const sqlConfig = digg(args, "sqlConfig")

    this.currentDatabaseName = digg(sqlConfig, "database")
    this.connection = await mssql.connect(sqlConfig)
  }

  disconnect() {
    this.connection.end()
  }

  async close() {
    await this.connection.close()
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
    const createArgs = Object.assign({tableData, driver: this})
    const createTable = new CreateTable(createArgs)

    return createTable.toSql()
  }

  getType = () => "mssql"
  primaryKeyType = () => "bigint"

  async query(sql) {
    let result, request

    if (this._currentTransaction) {
      request = new mssql.Request(this._currentTransaction)
    } else {
      request = mssql
    }

    try {
      result = await request.query(sql)
    } catch (error) {
      // Re-throw error because the stack-trace is broken and can't be used for app-development.
      throw new Error(`Query failed '${error.message})': ${sql}`)
    }

    return result.recordsets[0]
  }

  queryToSql(query) {
    return new QueryParser({query}).toSql()
  }

  shouldSetAutoIncrementWhenPrimaryKey = () => true

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

  quoteColumn = (string) => this.options().quoteColumnName(string)
  quoteTable = (string) => this.options().quoteTableName(string)

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
    const result = await this.query(`SELECT [TABLE_NAME] FROM [INFORMATION_SCHEMA].[TABLES] WHERE [TABLE_CATALOG] = ${this.quote(this.currentDatabaseName)} AND [TABLE_SCHEMA] = 'dbo'`)
    const tables = []

    for (const row of result) {
      const table = new Table(this, row)

      tables.push(table)
    }

    return tables
  }

  async getTableByName(tableName) {
    const result = await this.query(`SELECT [TABLE_NAME] FROM [INFORMATION_SCHEMA].[TABLES] WHERE [TABLE_CATALOG] = ${this.quote(this.currentDatabaseName)} AND [TABLE_SCHEMA] = 'dbo' AND [TABLE_NAME] = ${this.quote(tableName)}`)

    if (!result[0]) throw new Error(`Couldn't find a table by that name: ${name}`)

    return new Table(this, result[0])
  }

  async lastInsertID() {
    const result = await this.query("SELECT SCOPE_IDENTITY() AS last_insert_id")
    const lastInsertID = digg(result, 0, "last_insert_id")

    if (lastInsertID === null) throw new Error("Couldn't get the last inserted ID")

    return lastInsertID
  }

  options() {
    if (!this._options) this._options = new Options({driver: this})

    return this._options
  }

  async startTransaction() {
    if (this._currentTransaction) throw new Error("A transaction is already running")

    this._currentTransaction = new mssql.Transaction()
    await this._currentTransaction.begin()
  }

  async commitTransaction() {
    if (!this._currentTransaction) throw new Error("A transaction isn't running")

    await this._currentTransaction.commit()
    this._currentTransaction = null
  }

  async rollbackTransaction() {
    if (!this._currentTransaction) throw new Error("A transaction isn't running")

    await this._currentTransaction.rollback()
    this._currentTransaction = null
  }

  async startSavePoint(savePointName) {
    await this.query(`SAVE TRANSACTION [${savePointName}]`)
  }

  async releaseSavePoint(savePointName) {
    // Do nothing in MS-SQL.
  }

  async rollbackSavePoint(savePointName) {
    await this.query(`ROLLBACK TRANSACTION [${savePointName}]`)
  }

  generateSavePointName() {
    return `sp${uuidv4().replaceAll("-", "")}`.substring(0, 32)
  }

  updateSql({conditions, data, tableName}) {
    const update = new Update({conditions, data, driver: this, tableName})

    return update.toSql()
  }
}
