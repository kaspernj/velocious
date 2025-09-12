import {digg} from "diggerize"
import restArgsError from "./utils/rest-args-error.js"
import {withTrackedStack} from "./utils/with-tracked-stack.js"

export default class VelociousConfiguration {
  static current(throwError = true) {
    if (!this.velociousConfiguration && throwError) throw new Error("A Velocious configuration hasn't been set")

    return this.velociousConfiguration
  }

  constructor({cors, database, debug, directory, environment, initializeModels, locale, localeFallbacks, locales, ...restArgs}) {
    restArgsError(restArgs)

    this.cors = cors
    this.database = database
    this.databasePools = {}
    this.debug = debug
    this._environment = environment || process.env.VELOCIOUS_ENV || process.env.NODE_ENV || "development"
    this._directory = directory
    this._initializeModels = initializeModels
    this._isInitialized = false
    this.locale = locale
    this.localeFallbacks = localeFallbacks
    this.locales = locales
    this.modelClasses = {}
  }

  getDatabaseConfiguration() {
    return digg(this, "database", this.getEnvironment())
  }

  getDatabaseIdentifiers() {
    return Object.keys(this.getDatabaseConfiguration())
  }

  getDatabasePool(identifier = "default") {
    if (!this.isDatabasePoolInitialized(identifier)) {
      this.initializeDatabasePool(identifier)
    }

    return digg(this, "databasePools", identifier)
  }

  getDatabaseIdentifier(identifier) {
    if (!this.getDatabaseConfiguration()[identifier]) throw new Error(`No such database identifier configured: ${identifier}`)

    return this.getDatabaseConfiguration()[identifier]
  }

  getDatabasePoolType(identifier = "default") {
    const poolTypeClass = digg(this.getDatabaseIdentifier(identifier), "poolType")

    if (!poolTypeClass) {
      throw new Error("No poolType given in database configuration")
    }

    return poolTypeClass
  }

  getDatabaseType(identifier = "default") {
    const databaseType = digg(this.getDatabaseIdentifier(identifier), "type")

    if (!databaseType) throw new Error("No database type given in database configuration")

    return databaseType
  }

  getDirectory() {
    if (!this._directory) {
      this._directory = process.cwd()
    }

    return this._directory
  }

  getEnvironment() {
    return digg(this, "_environment")
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

  initializeDatabasePool(identifier = "default") {
    if (!this.database) throw new Error("No 'database' was given")
    if (this.databasePools[identifier]) throw new Error("DatabasePool has already been initialized")

    const PoolType = this.getDatabasePoolType(identifier)

    this.databasePools[identifier] = new PoolType({configuration: this, identifier})
    this.databasePools[identifier].setCurrent()
  }

  isDatabasePoolInitialized = (identifier = "default") => Boolean(this.databasePools[identifier])
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

  setTranslator(callback) {
    this._translator = callback
  }

  _defaultTranslator(msgID, args) {
    if (args?.defaultValue) return args.defaultValue

    return msgID
  }

  getTranslator() {
    return this._translator || this._defaultTranslator
  }

  async withConnections(callback) {
    const dbs = {}
    const stack = Error().stack
    const actualCallback = async () => {
      await withTrackedStack(stack, async () => {
        return await callback(dbs)
      })
    }

    let runRequest = actualCallback

    for (const identifier of this.getDatabaseIdentifiers()) {
      let actualRunRequest = runRequest

      const nextRunRequest = async () => {
        return await this.getDatabasePool(identifier).withConnection(async (db) => {
          dbs[identifier] = db

          await actualRunRequest()
        })
      }

      runRequest = nextRunRequest
    }

    await runRequest()
  }

  async getCurrentConnections() {
    const dbs = {}

    for (const identifier of this.getDatabaseIdentifiers()) {
      dbs[identifier] = this.getDatabasePool(identifier).getCurrentConnection()
    }

    return dbs
  }
}
