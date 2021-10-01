const Base = require("../base.cjs")
const connectConnection = require("./connect-connection.cjs")
const {digg} = require("diggerize")
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
    const forward = ["database", "host", "password", "user"]

    for (const forwardValue of forward) {
      if (forwardValue in args) connectArgs[forwardValue] = digg(args, forwardValue)
    }

    return connectArgs
  }

  async query(sql) {
    return await query(this.connection, sql)
  }
}
