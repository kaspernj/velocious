import {digg} from "diggerize"
import restArgsError from "./utils/rest-args-error.js"
import {withTrackedStack} from "./utils/with-tracked-stack.js"

export default class VelociousConfiguration {
  /**
   * @returns {VelociousConfiguration}
   */
  static current(throwError = true) {
    if (!this.velociousConfiguration && throwError) throw new Error("A Velocious configuration hasn't been set")

    return this.velociousConfiguration
  }

  constructor({cors, database, debug, directory, environment, environmentHandler, initializeModels, initializers, locale, localeFallbacks, locales, testing, ...restArgs}) {
    restArgsError(restArgs)

    this.cors = cors
    this.database = database
    this.databasePools = {}
    this.debug = debug
    this._environment = environment || process.env.VELOCIOUS_ENV || process.env.NODE_ENV || "development"
    this._environmentHandler = environmentHandler
    this._directory = directory
    this._initializeModels = initializeModels
    this._initializers = initializers
    this._isInitialized = false
    this.locale = locale
    this.localeFallbacks = localeFallbacks
    this.locales = locales
    this.modelClasses = {}
    this._testing = testing

    this.getEnvironmentHandler().setConfiguration(this)
  }

  /**
   * @returns {object}
   */
  getDatabaseConfiguration() {
    if (!this.database) throw new Error("No database configuration")

    return digg(this, "database", this.getEnvironment())
  }

  /**
   * @returns {Array<string>}
   */
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

  /**
   * @returns {string} The database type.
   */
  getDatabaseType(identifier = "default") {
    const databaseType = digg(this.getDatabaseIdentifier(identifier), "type")

    if (!databaseType) throw new Error("No database type given in database configuration")

    return databaseType
  }

  /**
   * @returns {string}
   */
  getDirectory() {
    if (!this._directory) {
      this._directory = process.cwd()
    }

    return this._directory
  }

  /**
   * @returns {string}
   */
  getEnvironment() { return digg(this, "_environment") }

  /**
   * @param {string} newEnvironment
   * @returns {void}
   */
  setEnvironment(newEnvironment) { this._environment = newEnvironment }

  /**
   * @template T extends import("./environment-handlers/base.js").default
   * @returns {T}
   */
  getEnvironmentHandler() {
    if (!this._environmentHandler) throw new Error("No environment handler set")

    return this._environmentHandler
  }

  getLocaleFallbacks() { return this.localeFallbacks }
  setLocaleFallbacks(newLocaleFallbacks) { this.localeFallbacks = newLocaleFallbacks }

  /**
   * @returns {string}
   */
  getLocale() {
    if (typeof this.locale == "function") {
      return this.locale()
    } else if (this.locale) {
      return this.locale
    } else {
      return this.getLocales()[0]
    }
  }

  /**
   * @returns {Array<string>}
   */
  getLocales() { return digg(this, "locales") }

  /**
   * @param {string} name
   * @template T extends import("./database/record/index.js").default
   * @returns {T}
   */
  getModelClass(name) {
    const modelClass = this.modelClasses[name]

    if (!modelClass) throw new Error(`No such model class ${name} in ${Object.keys(this.modelClasses).join(", ")}}`)

    return modelClass
  }

  /**
   * @returns {string} The path to a config file that should be used for testing.
   */
  getTesting() { return this._testing }

  /**
   * @returns {void}
   */
  initializeDatabasePool(identifier = "default") {
    if (!this.database) throw new Error("No 'database' was given")
    if (this.databasePools[identifier]) throw new Error("DatabasePool has already been initialized")

    const PoolType = this.getDatabasePoolType(identifier)

    this.databasePools[identifier] = new PoolType({configuration: this, identifier})
    this.databasePools[identifier].setCurrent()
  }

  isDatabasePoolInitialized(identifier = "default") { return Boolean(this.databasePools[identifier]) }

  /**
   * @returns {boolean}
   */
  isInitialized() { return this._isInitialized }

  async initialize({type} = {}) {
    if (!this.isInitialized()) {
      this._isInitialized = true

      if (this._initializeModels) {
        await this._initializeModels({configuration: this, type})
      }

      if (this._initializers) {
        const initializers = await this._initializers({configuration: this})
        const {requireContext, ...restArgs} = initializers

        restArgsError(restArgs)

        if (requireContext) {
          for (const initializerKey of requireContext.keys()) {
            const InitializerClass = requireContext(initializerKey).default
            const initializerInstance = new InitializerClass({configuration: this, type})

            await initializerInstance.run()
          }
        }
      }
    }
  }

  /**
   * @param {Function} modelClass
   */
  registerModelClass(modelClass) {
    this.modelClasses[modelClass.name] = modelClass
  }

  /**
   * @returns {void}
   */
  setCurrent() {
    this.constructor.velociousConfiguration = this
  }

  /**
   * @returns {void}
   */
  setRoutes(newRoutes) { this.routes = newRoutes }

  /**
   * @param {Function} callback
   * @returns {void}
   */
  setTranslator(callback) { this._translator = callback }

  /**
   * @param {string} msgID
   * @param {Object} args
   * @returns {string}
   */
  _defaultTranslator(msgID, args) {
    if (args?.defaultValue) return args.defaultValue

    return msgID
  }

  /**
   * @returns {Function}
   */
  getTranslator() {
    return this._translator || this._defaultTranslator
  }

  /**
   * @param {Function} callback
   * @returns {Promise<void>}
   */
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

  /**
   * @template T extends import("./database/record/index.js").default
   * @returns {Record<string, T>} A map of database connections with identifier as key
   */
  getCurrentConnections() {
    const dbs = {}

    for (const identifier of this.getDatabaseIdentifiers()) {
      try {
        dbs[identifier] = this.getDatabasePool(identifier).getCurrentConnection()
      } catch (error) {
        if (error.message == "ID hasn't been set for this async context" || error.message == "A connection hasn't been made yet") {
          // Ignore
        } else {
          throw error
        }
      }
    }

    return dbs
  }

  /**
   * @param {Function} callback
   * @returns {Promise<void>}
   */
  async ensureConnections(callback) {
    let dbs = this.getCurrentConnections()

    if (Object.keys(dbs).length > 0) {
      await callback(dbs)
    } else {
      await this.withConnections(callback)
    }
  }
}
