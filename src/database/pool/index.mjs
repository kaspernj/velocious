import Configuration from "../../configuration.mjs"
import {digg} from "diggerize"

export default class VelociousDatabasePool {
  static current() {
    if (!global.velociousDatabasePool) global.velociousDatabasePool = new VelociousDatabasePool()

    return global.velociousDatabasePool
  }

  async connect() {
    if (this.connection) {
      console.warn("DatabasePoool#connect: Already connected")
    } else {
      this.connection = await this.spawnConnection()

      if (!this.connection) throw new Error("spawnConnection didn't set a connection")

      await this.connection.connect()
    }
  }

  isConnected = () => Boolean(this.connection)

  singleConnection() {
    if (!this.connection) throw new Error("Not connected")

    return this.connection
  }

  async spawnConnection() {
    const defaultConfig = digg(Configuration.current(), "database", "default", "master")
    const driverPath = `../drivers/${digg(defaultConfig, "type")}/index.mjs`
    const DriverClassImport = await import(driverPath)
    const DriverClass = DriverClassImport.default
    const connection = new DriverClass(defaultConfig)

    return connection
  }
}
