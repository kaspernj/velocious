import Configuration from "../../configuration.mjs"
import {digg} from "diggerize"

export default class VelociousDatabasePool {
  static current() {
    if (!global.velociousDatabasePool) global.velociousDatabasePool = new VelociousDatabasePool()

    return global.velociousDatabasePool
  }

  async connect() {
    if (this.connection) throw new Error("Already connected")

    this.connection = await this.spawnConnection()
    await this.connection.connect()
  }

  isConnected() {
    return Boolean(this.connection)
  }

  singleConnection() {
    if (!this.connection) throw new Error("Not connected")

    return this.connection
  }

  async spawnConnection() {
    const databaseConfigPath = `${Configuration.current().directory}/src/config/database.mjs`
    const {databaseConfiguration} = await import(databaseConfigPath)
    const config = databaseConfiguration()
    const defaultConfig = digg(config, "default", "master")
    const driverPath = `../drivers/${digg(defaultConfig, "type")}/index.mjs`
    const DriverClassImport = await import(driverPath)
    const DriverClass = DriverClassImport.default
    const connection = new DriverClass(defaultConfig)

    return connection
  }
}
