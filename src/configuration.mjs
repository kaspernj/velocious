import {digg} from "diggerize"

export default class VelociousConfiguration {
  static current(throwError = true) {
    if (!this.velociousConfiguration && throwError) throw new Error("A Velocious configuration hasn't been set")

    return this.velociousConfiguration
  }

  constructor({database, debug, directory}) {
    this.database = database
    this.debug = debug
    this._directory = directory
  }

  getDatabasePool() {
    if (!this.isDatabasePoolInitialized()) {
      this.initializeDatabasePool()
    }

    return this.databasePool
  }

  getDatabasePoolType = () => {
    const poolTypeClass = digg(this, "database", "default", "master", "poolType")

    if (!poolTypeClass) {
      throw new Error("No poolType given in database configuration")
    }

    return poolTypeClass
  }

  getDirectory = () => {
    if (!this._directory) {
      this._directory = process.cwd()
    }

    return this._directory
  }

  initializeDatabasePool() {
    if (!this.database) throw new Error("No 'database' was given")
    if (this.databasePool) throw new Error("DatabasePool has already been initialized")

    const PoolType = this.getDatabasePoolType()

    this.databasePool = new PoolType({configuration: this})
    this.databasePool.setCurrent()
  }

  isDatabasePoolInitialized = () => Boolean(this.databasePool)

  initialize() {
    // Doesn't currently do anything.
  }

  setCurrent() {
    this.constructor.velociousConfiguration = this
  }

  setRoutes(newRoutes) {
    this.routes = newRoutes
  }
}
