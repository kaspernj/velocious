import {digg} from "diggerize"
import restArgsError from "./utils/rest-args-error.js"

export default class VelociousConfiguration {
  static current(throwError = true) {
    if (!this.velociousConfiguration && throwError) throw new Error("A Velocious configuration hasn't been set")

    return this.velociousConfiguration
  }

  constructor({database, debug, directory, initializeModels, locale, localeFallbacks, locales, ...restArgs}) {
    restArgsError(restArgs)

    this.database = database
    this.debug = debug
    this._directory = directory
    this._initializeModels = initializeModels
    this._isInitialized = false
    this.locale = locale
    this.localeFallbacks = localeFallbacks
    this.locales = locales
    this.modelClasses = {}
  }

  getDatabasePool() {
    if (!this.isDatabasePoolInitialized()) {
      this.initializeDatabasePool()
    }

    return this.databasePool
  }

  getDatabasePoolType() {
    const poolTypeClass = digg(this, "database", "default", "master", "poolType")

    if (!poolTypeClass) {
      throw new Error("No poolType given in database configuration")
    }

    return poolTypeClass
  }

  getDatabaseType() {
    const databaseType = digg(this, "database", "default", "master", "type")

    if (!databaseType) {
      throw new Error("No database type given in database configuration")
    }

    return databaseType
  }

  getDirectory() {
    if (!this._directory) {
      this._directory = process.cwd()
    }

    return this._directory
  }

  getLocaleFallbacks = () => this.localeFallbacks
  setLocaleFallbacks(newLocaleFallbacks) {
    this.localeFallbacks = newLocaleFallbacks
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

  getModelClass(name) {
    const modelClass = this.modelClasses[name]

    if (!modelClass) throw new Error(`No such model class ${name} in ${Object.keys(this.modelClasses).join(", ")}}`)

    return modelClass
  }

  initializeDatabasePool() {
    if (!this.database) throw new Error("No 'database' was given")
    if (this.databasePool) throw new Error("DatabasePool has already been initialized")

    const PoolType = this.getDatabasePoolType()

    this.databasePool = new PoolType({configuration: this})
    this.databasePool.setCurrent()
  }

  isDatabasePoolInitialized = () => Boolean(this.databasePool)
  isInitialized = () => this._isInitialized

  async initialize() {
    if (!this.isInitialized()) {
      if (this._initializeModels) {
        await this._initializeModels({configuration: this})
      }

      this._isInitialized = true
    }
  }

  registerModelClass(modelClass) {
    this.modelClasses[modelClass.name] = modelClass
  }

  setCurrent() {
    this.constructor.velociousConfiguration = this
  }

  setRoutes(newRoutes) {
    this.routes = newRoutes
  }
}
