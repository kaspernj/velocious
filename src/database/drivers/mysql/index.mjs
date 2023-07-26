import Base from "../base.mjs"
import connectConnection from "./connect-connection.mjs"
import CreateDatabase from "./sql/create-database.mjs"
import Delete from "./sql/delete.mjs"
import {digg} from "diggerize"
import Insert from "./sql/insert.mjs"
import Options from "./options.mjs"
import mysql from "mysql"
import query from "./query.mjs"
import QueryParser from "./query-parser.mjs"
import Update from "./sql/update.mjs"

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

  createDatabaseSql(databaseName, args) {
    const createArgs = Object.assign({databaseName, driver: this}, args)
    const createDatabase = new CreateDatabase(createArgs)

    return createDatabase.toSql()
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
