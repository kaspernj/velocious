// @ts-check

/**
 * @typedef {function(Record<string, import("./database/drivers/base.js").default>) : Promise<void>} WithConnectionsCallbackType
 */

import {digg} from "diggerize"
import restArgsError from "./utils/rest-args-error.js"
import {withTrackedStack} from "./utils/with-tracked-stack.js"

/** @type {{currentConfiguration: VelociousConfiguration | null}} */
const shared = {
  currentConfiguration: null
}

class CurrentConfigurationNotSetError extends Error {}

export {CurrentConfigurationNotSetError}

export default class VelociousConfiguration {
  /** @returns {VelociousConfiguration} */
  static current() {
    if (!shared.currentConfiguration) throw new CurrentConfigurationNotSetError("A current configuration hasn't been set")

    return shared.currentConfiguration
  }

  /** @param {import("./configuration-types.js").ConfigurationArgsType} args */
  constructor({cors, database, debug = false, directory, environment, environmentHandler, initializeModels, initializers, locale, localeFallbacks, locales, testing, ...restArgs}) {
    restArgsError(restArgs)

    this.cors = cors
    this.database = database
    this.debug = debug
    this._environment = environment || process.env.VELOCIOUS_ENV || process.env.NODE_ENV || "development"
    this._environmentHandler = environmentHandler
    this._directory = directory
    this._initializeModels = initializeModels
    this._isInitialized = false
    this.locale = locale
    this.localeFallbacks = localeFallbacks
    this.locales = locales
    this._initializers = initializers
    this._testing = testing

    /** @type {{[key: string]: import("./database/pool/base.js").default}} */
    this.databasePools = {}

    /** @type {{[key: string]: typeof import("./database/record/index.js").default}} */
    this.modelClasses = {}

    this.getEnvironmentHandler().setConfiguration(this)
  }

  /** @returns {import("./configuration-types.js").CorsType | undefined} */
  getCors() {
    return this.cors
  }

  /** @returns {Record<string, any>} */
  getDatabaseConfiguration() {
    if (!this.database) throw new Error("No database configuration")

    if (!this.database[this.getEnvironment()]) {
      throw new Error(`No database configuration for environment: ${this.getEnvironment()} - ${Object.keys(this.database).join(", ")}`)
    }

    return digg(this, "database", this.getEnvironment())
  }

  /** @returns {Array<string>} */
  getDatabaseIdentifiers() {
    return Object.keys(this.getDatabaseConfiguration())
  }

  /**
   * @param {string} identifier
   * @returns {import("./database/pool/base.js").default}
   */
  getDatabasePool(identifier = "default") {
    if (!this.isDatabasePoolInitialized(identifier)) {
      this.initializeDatabasePool(identifier)
    }

    return digg(this, "databasePools", identifier)
  }

  /**
   * @param {string} identifier
   * @returns {import("./configuration-types.js").DatabaseConfigurationType})
   */
  getDatabaseIdentifier(identifier) {
    if (!this.getDatabaseConfiguration()[identifier]) throw new Error(`No such database identifier configured: ${identifier}`)

    return this.getDatabaseConfiguration()[identifier]
  }

  /**
   * @param {string} identifier
   * @returns {typeof import("./database/pool/base.js").default}
   */
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
   * @returns {import("./environment-handlers/base.js").default}
   */
  getEnvironmentHandler() {
    if (!this._environmentHandler) throw new Error("No environment handler set")

    return this._environmentHandler
  }

  /**
   * @returns {import("./configuration-types.js").LocaleFallbacksType | undefined}
   */
  getLocaleFallbacks() { return this.localeFallbacks }

  /**
   * @param {import("./configuration-types.js").LocaleFallbacksType} newLocaleFallbacks
   * @returns {void}
   */
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

  /** @returns {Array<string>} */
  getLocales() { return digg(this, "locales") }

  /**
   * @param {string} name
   * @returns {typeof import("./database/record/index.js").default}
   */
  getModelClass(name) {
    const modelClass = this.modelClasses[name]

    if (!modelClass) throw new Error(`No such model class ${name} in ${Object.keys(this.modelClasses).join(", ")}}`)

    return modelClass
  }

  /**
   * @returns {Record<string, typeof import("./database/record/index.js").default>} A hash of all model classes, keyed by model name, as they were defined in the configuration. This is a direct reference to the model classes, not a copy.
   */
  getModelClasses() {
    return this.modelClasses
  }

  /** @returns {string} The path to a config file that should be used for testing. */
  getTesting() { return this._testing }

  /** @returns {void} */
  initializeDatabasePool(identifier = "default") {
    if (!this.database) throw new Error("No 'database' was given")
    if (this.databasePools[identifier]) throw new Error("DatabasePool has already been initialized")

    const PoolType = this.getDatabasePoolType(identifier)

    this.databasePools[identifier] = new PoolType({configuration: this, identifier})
    this.databasePools[identifier].setCurrent()
  }

  /** @returns {boolean} */
  isDatabasePoolInitialized(identifier = "default") { return Boolean(this.databasePools[identifier]) }

  /** @returns {boolean} */
  isInitialized() { return this._isInitialized }

  /**
   * @param {object} args
   * @param {string} args.type
   * @returns {Promise<void>}
   */
  async initializeModels(args = {type: "server"}) {
    if (!this._modelsInitialized) {
      this._modelsInitialized = true

      if (this._initializeModels) {
        await this._initializeModels({configuration: this, type: args.type})
      }
    }
  }

  /**
   * @param {object} args
   * @param {string} args.type
   * @returns {Promise<void>}
   */
  async initialize({type} = {type: "undefined"}) {
    if (!this.isInitialized()) {
      this._isInitialized = true

      await this.initializeModels({type})

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
   * @param {typeof import("./database/record/index.js").default} modelClass
   * @returns {void}
   */
  registerModelClass(modelClass) {
    this.modelClasses[modelClass.name] = modelClass
  }

  /** @returns {void} */
  setCurrent() {
    shared.currentConfiguration = this
  }

  /** @returns {import("./routes/index.js").default | undefined} */
  getRoutes() { return this.routes }

  /**
   * @param {import("./routes/index.js").default} newRoutes
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
   * @param {undefined | {defaultValue: string}} args
   * @returns {string}
   */
  _defaultTranslator(msgID, args) {
    if (args?.defaultValue) return args.defaultValue

    return msgID
  }

  /** @returns {Function} */
  getTranslator() {
    return this._translator || this._defaultTranslator
  }

  /**
   * @param {WithConnectionsCallbackType} callback
   * @returns {Promise<void>}
   */
  async withConnections(callback) {
    /** @type {{[key: string]: import("./database/drivers/base.js").default}} */
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

  /** @returns {Record<string, import("./database/drivers/base.js").default>} A map of database connections with identifier as key */
  getCurrentConnections() {
    /** @type {{[key: string]: import("./database/drivers/base.js").default}} */
    const dbs = {}

    for (const identifier of this.getDatabaseIdentifiers()) {
      try {
        dbs[identifier] = this.getDatabasePool(identifier).getCurrentConnection()
      } catch (error) {
        if (error instanceof Error && (error.message == "ID hasn't been set for this async context" || error.message == "A connection hasn't been made yet")) {
          // Ignore
        } else {
          throw error
        }
      }
    }

    return dbs
  }

  /**
   * @param {WithConnectionsCallbackType} callback
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
