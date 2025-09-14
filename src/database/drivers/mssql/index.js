import Base from "../base.js"
import CreateDatabase from "./sql/create-database.js"
import CreateIndex from "./sql/create-index.js"
import CreateTable from "./sql/create-table.js"
import Delete from "./sql/delete.js"
import DropTable from "./sql/drop-table.js"
import {digg} from "diggerize"
import escapeString from "sql-escape-string"
import Insert from "./sql/insert.js"
import Options from "./options.js"
import mssql from "mssql"
import QueryParser from "./query-parser.js"
import Table from "./table.js"
import Update from "./sql/update.js"
import UUID from "pure-uuid"

export default class VelociousDatabaseDriversMssql extends Base{
  async connect() {
    const args = this.getArgs()
    const sqlConfig = digg(args, "sqlConfig")

    try {
      this.connection = await mssql.connect(sqlConfig)
    } catch (error) {
      throw new Error(`Couldn't connect to database: ${error.message}`) // Re-throw to fix unuseable stack trace.
    }
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
    const createArgs = Object.assign({tableData, driver: this, indexInCreateTable: false})
    const createTable = new CreateTable(createArgs)

    return createTable.toSql()
  }

  async disableForeignKeys() {
    await this.query("EXEC sp_MSforeachtable \"ALTER TABLE ? NOCHECK CONSTRAINT all\"")
  }

  async enableForeignKeys() {
    await this.query("EXEC sp_MSforeachtable @command1=\"print '?'\", @command2=\"ALTER TABLE ? WITH CHECK CHECK CONSTRAINT all\"")
  }

  dropTableSql(tableName, args = {}) {
    const dropArgs = Object.assign({tableName, driver: this}, args)
    const dropTable = new DropTable(dropArgs)

    return dropTable.toSql()
  }

  getType = () => "mssql"
  primaryKeyType = () => "bigint"

  async query(sql) {
    let result, request, tries = 0

    if (this._currentTransaction) {
      request = new mssql.Request(this._currentTransaction)
    } else {
      request = mssql
    }

    while (true) {
      tries++

      try {
        result = await request.query(sql)
        break
      } catch (error) {
        if (error.message == "No connection is specified for that request." && tries <= 3) {
          this.logger.log("Reconnecting to database")
          await this.connect()
          // Retry
        } else {
          // Re-throw error because the stack-trace is broken and can't be used for app-development.
          throw new Error(`Query failed '${error.message}': ${sql}`)
        }
      }
    }

    return result.recordsets[0]
  }

  queryToSql(query) {
    return new QueryParser({query}).toSql()
  }

  shouldSetAutoIncrementWhenPrimaryKey = () => true



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
    const result = await this.query(`SELECT [TABLE_NAME] FROM [INFORMATION_SCHEMA].[TABLES] WHERE [TABLE_CATALOG] = DB_NAME() AND [TABLE_SCHEMA] = 'dbo'`)
    const tables = []

    for (const row of result) {
      const table = new Table(this, row)

      tables.push(table)
    }

    return tables
  }

  async getTableByName(tableName, args) {
    const result = await this.query(`SELECT [TABLE_NAME] FROM [INFORMATION_SCHEMA].[TABLES] WHERE [TABLE_CATALOG] = DB_NAME() AND [TABLE_SCHEMA] = 'dbo' AND [TABLE_NAME] = ${this.quote(tableName)}`)

    if (result[0]) {
      return new Table(this, result[0])
    }

    if (args?.throwError !== false) throw new Error(`Couldn't find a table by that name: ${tableName}`)
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
    if (!this.connection) throw new Error("No connection")
    if (this._currentTransaction) throw new Error("A transaction is already running")

    this._currentTransaction = new mssql.Transaction(this.connection)

    await this._currentTransaction.begin()
    this._transactionsCount++
  }

  async commitTransaction() {
    if (!this._currentTransaction) throw new Error("A transaction isn't running")

    await this._currentTransaction.commit()
    this._currentTransaction = null
    this._transactionsCount--
  }

  async rollbackTransaction() {
    if (!this._currentTransaction) throw new Error("A transaction isn't running")

    await this._currentTransaction.rollback()

    this._currentTransaction = null
    this._transactionsCount--
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
    return `sp${new UUID(4).format().replaceAll("-", "")}`.substring(0, 32)
  }

  updateSql({conditions, data, tableName}) {
    const update = new Update({conditions, data, driver: this, tableName})

    return update.toSql()
  }
}
