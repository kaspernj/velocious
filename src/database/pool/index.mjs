import Configuration from "../../configuration.mjs"
import {digg} from "diggerize"

export default class VelociousDatabasePool {
  static current() {
    if (!global.velociousDatabasePool) global.velociousDatabasePool = new VelociousDatabasePool()

    return global.velociousDatabasePool
  }

  async connect() {
    if (this.connection) throw new Error("Already connected")

    this.connection = this.spawnConnection()
    await this.connection.connect()
  }

  isConnected() {
    return Boolean(this.connection)
  }

  singleConnection() {
    if (!this.connection) throw new Error("Not connected")

    return this.connection
  }

  spawnConnection() {
    const databaseConfigPath = `${Configuration.current().directory}/src/config/database`
    const {databaseConfiguration} = require(databaseConfigPath)
    const config = databaseConfiguration()
    const defaultConfig = digg(config, "default", "master")
    const driverPath = `../drivers/${digg(defaultConfig, "type")}`
    const DriverClass = require(driverPath)
    const connection = new DriverClass(defaultConfig)

    return connection
  }
}
