import DatabasePool from "./database/pool/index.mjs"
import {digg} from "diggerize"

export default class VelociousConfiguration {
  static current() {
    if (!global.velociousConfiguration) throw new Error("A Velocious configuration hasn't been set")

    return global.velociousConfiguration
  }

  constructor({database, debug, directory}) {
    if (!directory) directory = process.cwd()
    if (!database) throw new Error("No 'database' was given")

    this.database = database
    this.debug = debug
    this.directory = directory
  }

  async initialize() {
    await this.initializeRoutes()
  }

  getDatabasePool() {
    if (!this.isDatabasePoolInitialized()) this.initializeDatabasePool()

    return this.databasePool
  }

  initializeDatabasePool() {
    if (this.databasePool) throw new Error("DatabasePool has already been initialized")

    this.databasePool = new DatabasePool({configuration: this})
    this.databasePool.setCurrent()
  }

  isDatabasePoolInitialized = () => Boolean(this.databasePool)

  async initializeRoutes() {
    // Every client need to make their own routes because they probably can't be shared across different worker threads
    const routesImport = await import(`${this.directory}/src/config/routes.mjs`)

    this.routes = digg(routesImport, "default", "routes")
  }

  setCurrent() {
    global.velociousConfiguration = this
  }
}
