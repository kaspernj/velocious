const Base = require("../base.cjs")
const connectConnection = require("./connect-connection.cjs")
const {digg} = require("diggerize")
const Insert = require("./sql/insert.cjs")
const Options = require("./options.cjs")
const mysql = require("mysql")
const query = require("./query.cjs")

module.exports = class VelociousDatabaseDriversMysql extends Base{
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
