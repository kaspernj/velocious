import Base from "../base.js"
import connectConnection from "./connect-connection.js"
import CreateDatabase from "./sql/create-database.js"
import CreateTable from "./sql/create-table.js"
import Delete from "./sql/delete.js"
import {digg} from "diggerize"
import Insert from "./sql/insert.js"
import Options from "./options.js"
import mysql from "mysql"
import query from "./query.js"
import QueryParser from "./query-parser.js"
import Table from "./table.js"
import Update from "./sql/update.js"

export default class VelociousDatabaseDriversMysql extends Base{
  async connect() {
    const connection = mysql.createConnection(this.connectArgs())

    await connectConnection(connection)
    this.connection = connection
  }

  disconnect() {
    this.connection.end()
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

  async close() {
    await this.connection.end()
    this.connection = undefined
  }

  createDatabaseSql(databaseName, args) {
    const createArgs = Object.assign({databaseName, driver: this}, args)
    const createDatabase = new CreateDatabase(createArgs)

    return createDatabase.toSql()
  }

  createTableSql(tableData) {
    const createArgs = Object.assign({tableData, driver: this})
    const createTable = new CreateTable(createArgs)

    return createTable.toSql()
  }

  primaryKeyType = () => "bigint"

  async query(sql) {
    return await query(this.connection, sql)
  }

  queryToSql(query) {
    return new QueryParser({query}).toSql()
  }

  shouldSetAutoIncrementWhenPrimaryKey = () => true

  escape(string) {
    if (!this.connection) throw new Error("Can't escape before connected")

    return this.connection.escape(string)
  }

  quote(string) {
    return `${this.escape(string)}`
  }

  quoteColumn = (string) => {
    if (string.includes("`")) throw new Error(`Possible SQL injection in column name: ${string}`)

    return `\`${string}\``
  }

  quoteTable = (string) => {
    if (string.includes("`")) throw new Error(`Possible SQL injection in table name: ${string}`)

    return `\`${string}\``
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
    if (!this._options) {
      this._options = new Options({driver: this})
    }

    return this._options
  }

  updateSql({conditions, data, tableName}) {
    const update = new Update({conditions, data, driver: this, tableName})

    return update.toSql()
  }
}
