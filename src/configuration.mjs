import {digg} from "diggerize"

export default class VelociousConfiguration {
  static current(throwError = true) {
    if (!this.velociousConfiguration && throwError) throw new Error("A Velocious configuration hasn't been set")

    return this.velociousConfiguration
  }

  constructor({database, debug, directory, locale, locales}) {
    this.database = database
    this.debug = debug
    this._directory = directory
    this.locale = locale
    this.locales = locales
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

  getLocale() {
    if (typeof this.locale == "function") {
      return this.locale()
    } else if (this.locale) {
      return this.locale
    } else {
      return this.getLocales()[0]
    }
  }

  getLocales = () => digg(this, "locales")

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
