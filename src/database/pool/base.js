import Configuration from "../../configuration.js"
import {digg} from "diggerize"

if (!globalThis.velociousDatabasePoolBase) {
  globalThis.velociousDatabasePoolBase = {
    current: null
  }
}

class VelociousDatabasePoolBase {
  static current() {
    if (!globalThis.velociousDatabasePoolBase.current) {
      globalThis.velociousDatabasePoolBase.current = new this()
    }

    return globalThis.velociousDatabasePoolBase.current
  }

  constructor(args = {}) {
    this.configuration = args.configuration || Configuration.current()

    if (!this.configuration) throw new Error("No configuration given")

    this.connections = []
    this.connectionsInUse = {}
  }

  getConfiguration() {
    return digg(this.configuration.getDatabaseConfiguration(), "master")
  }

  setCurrent() {
    globalThis.velociousDatabasePoolBase.current = this
  }

  setDriverClass(driverClass) {
    this.driverClass = driverClass
  }

  async spawnConnection() {
    const defaultConfig = this.getConfiguration()
    const connection = await this.spawnConnectionWithConfiguration(defaultConfig)

    return connection
  }

  async spawnConnectionWithConfiguration(config) {
    const DriverClass = config.driver || this.driverClass

    if (!DriverClass) throw new Error("No driver class set in database pool or in given config")

    const connection = new DriverClass(config, this.configuration)

    await connection.connect()

    return connection
  }
}

const forwardMethods = [
  "alterTable",
  "alterTableSql",
  "createIndex",
  "createIndexSql",
  "createTable",
  "createTableSql",
  "delete",
  "deleteSql",
  "getTables",
  "insert",
  "insertSql",
  "primaryKeyType",
  "query",
  "quote",
  "quoteColumn",
  "quoteTable",
  "select",
  "update",
  "updateSql"
]

for (const forwardMethod of forwardMethods) {
  VelociousDatabasePoolBase.prototype[forwardMethod] = function(...args) {
    const connection = this.getCurrentConnection()
    const connectionMethod = connection[forwardMethod]

    if (!connectionMethod) throw new Error(`${forwardMethod} isn't defined on driver`)

    return connection[forwardMethod](...args)
  }
}

export default VelociousDatabasePoolBase
