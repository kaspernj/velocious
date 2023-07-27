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

  constructor(args = {}) {
    this.configuration = args.configuration || Configuration.current()
  }

  isConnected = () => Boolean(this.connection)

  singleConnection() {
    if (!this.connection) throw new Error("Not connected")

    return this.connection
  }

  getConfiguration = () => digg(this, "configuration", "database", "default", "master")

  setCurrent() {
    global.velociousDatabasePool = this
  }

  async spawnConnection() {
    const defaultConfig = this.getConfiguration()

    return await this.spawnConnectionWithConfiguration(defaultConfig)
  }

  async spawnConnectionWithConfiguration(config) {
    const driverPath = `../drivers/${digg(config, "type")}/index.mjs`
    const DriverClassImport = await import(driverPath)
    const DriverClass = DriverClassImport.default
    const connection = new DriverClass(config)

    return connection
  }
}
