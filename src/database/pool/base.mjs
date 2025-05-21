import Configuration from "../../configuration.mjs"
import {digg} from "diggerize"

class VelociousDatabasePoolBase {
  constructor(args = {}) {
    this.configuration = args.configuration || Configuration.current()
    this.connections = []
    this.connectionsInUse = {}
  }

  getConfiguration = () => digg(this, "configuration", "database", "default", "master")

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

    const connection = new DriverClass(config)

    await connection.connect()

    return connection
  }
}

const forwardMethods = [
  "createTable",
  "createTableSql",
  "delete",
  "deleteSql",
  "getTables",
  "insert",
  "insertSql",
  "query",
  "quote",
  "select",
  "update",
  "updateSql"
]

for (const forwardMethod of forwardMethods) {
  VelociousDatabasePoolBase.prototype[forwardMethod] = function(...args) {
    const connection = this.getCurrentConnection()

    return connection[forwardMethod](...args)
  }
}

export default VelociousDatabasePoolBase
