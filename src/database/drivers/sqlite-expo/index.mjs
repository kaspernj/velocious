import Base from "../base.mjs"
import CreateDatabase from "../sqlite/sql/create-database.mjs"
import CreateTable from "../sqlite/sql/create-table.mjs"
import Delete from "../sqlite/sql/delete.mjs"
import {digg} from "diggerize"
import Insert from "../sqlite/sql/insert.mjs"
import Options from "../sqlite/options.mjs"
import query from "./query.mjs"
import QueryParser from "../sqlite/query-parser.mjs"
import * as SQLite from "expo-sqlite"
import Update from "../sqlite/sql/update.mjs"

export default class VelociousDatabaseDriversMysql extends Base{
  async connect() {
    const connection = await SQLite.openDatabaseAsync(digg(this.connectArgs(), "name"))

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

  async query(sql) {
    return await query(this.connection, sql)
  }

  queryToSql(query) {
    return new QueryParser({query}).toSql()
  }

  quote(string) {
    if (!this.connection) throw new Error("Can't escape before connected")

    return this.connection.escape(string)
  }

  quoteColumn(string) {
    return `\`${string}\``
  }

  deleteSql({tableName, conditions}) {
    const deleteInstruction = new Delete({conditions, driver: this, tableName})

    return deleteInstruction.toSql()
  }

  insertSql({tableName, data}) {
    const insert = new Insert({driver: this, tableName, data})

    return insert.toSql()
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
