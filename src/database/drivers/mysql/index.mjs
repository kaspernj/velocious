import Base from "../base.mjs"
import connectConnection from "./connect-connection.mjs"
import {digg} from "diggerize"
import Insert from "./sql/insert.mjs"
import Options from "./options.mjs"
import mysql from "mysql"
import query from "./query.mjs"

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

  quote(string) {
    if (!this.connection) throw new Error("Can't escape before connected")

    return this.connection.escape(string)
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

  async query(sql) {
    return await query(this.connection, sql)
  }
}
