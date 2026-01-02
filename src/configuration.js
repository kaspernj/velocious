// @ts-check

/**
 * @typedef {function(Record<string, import("./database/drivers/base.js").default>) : Promise<void>} WithConnectionsCallbackType
 */

import {digg} from "diggerize"
import EventEmitter from "./utils/event-emitter.js"
import restArgsError from "./utils/rest-args-error.js"
import {withTrackedStack} from "./utils/with-tracked-stack.js"

/** @type {{currentConfiguration: VelociousConfiguration | null}} */
const shared = {
  currentConfiguration: null
}

class CurrentConfigurationNotSetError extends Error {}

export {CurrentConfigurationNotSetError}

export default class VelociousConfiguration {
  /** @returns {VelociousConfiguration} - The current.  */
  static current() {
    if (!shared.currentConfiguration) throw new CurrentConfigurationNotSetError("A current configuration hasn't been set")

    return shared.currentConfiguration
  }

  /** @param {import("./configuration-types.js").ConfigurationArgsType} args - Configuration arguments. */
  constructor({cors, database, debug = false, directory, environment, environmentHandler, initializeModels, initializers, locale, localeFallbacks, locales, logging, requestTimeoutMs, testing, timezoneOffsetMinutes, websocketChannelResolver, ...restArgs}) {
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
    this._timezoneOffsetMinutes = timezoneOffsetMinutes
    this._requestTimeoutMs = requestTimeoutMs
    this._websocketEvents = undefined
    this._websocketChannelResolver = websocketChannelResolver
    this._logging = logging
    this._errorEvents = new EventEmitter()

    /** @type {{[key: string]: import("./database/pool/base.js").default}} */
    this.databasePools = {}

    /** @type {{[key: string]: typeof import("./database/record/index.js").default}} */
    this.modelClasses = {}

    this.getEnvironmentHandler().setConfiguration(this)
  }

  /** @returns {import("./configuration-types.js").CorsType | undefined} - The cors.  */
  getCors() {
    return this.cors
  }

  /** @returns {Record<string, import("./configuration-types.js").DatabaseConfigurationType>} - The database configuration.  */
  getDatabaseConfiguration() {
    if (!this.database) throw new Error("No database configuration")

    if (!this.database[this.getEnvironment()]) {
      throw new Error(`No database configuration for environment: ${this.getEnvironment()} - ${Object.keys(this.database).join(", ")}`)
    }

    return digg(this, "database", this.getEnvironment())
  }

  /** @returns {Array<string>} - The database identifiers.  */
  getDatabaseIdentifiers() {
    return Object.keys(this.getDatabaseConfiguration())
  }

  /**
   * @param {string} identifier - Identifier.
   * @returns {import("./database/pool/base.js").default} - The database pool.
   */
  getDatabasePool(identifier = "default") {
    if (!this.isDatabasePoolInitialized(identifier)) {
      this.initializeDatabasePool(identifier)
    }

    return digg(this, "databasePools", identifier)
  }

  /**
   * @param {string} identifier - Identifier.
   * @returns {import("./configuration-types.js").DatabaseConfigurationType})
   */
  getDatabaseIdentifier(identifier) {
    if (!this.getDatabaseConfiguration()[identifier]) throw new Error(`No such database identifier configured: ${identifier}`)

    return this.getDatabaseConfiguration()[identifier]
  }

  /**
   * @param {string} identifier - Identifier.
   * @returns {typeof import("./database/pool/base.js").default} - The database pool type.
   */
  getDatabasePoolType(identifier = "default") {
    const poolTypeClass = digg(this.getDatabaseIdentifier(identifier), "poolType")

    if (!poolTypeClass) {
      throw new Error("No poolType given in database configuration")
    }

    return poolTypeClass
  }

  getDatabaseType(identifier = "default") {
    const databaseType = this.getDatabaseIdentifier(identifier).type

    if (!databaseType) throw new Error("No database type given in database configuration")

    return databaseType
  }

  /**
   * @returns {string} - The directory.
   */
  getDirectory() {
    if (!this._directory) {
      this._directory = process.cwd()
    }

    return this._directory
  }

  /**
   * @returns {string} - The environment.
   */
  getEnvironment() { return digg(this, "_environment") }

  /**
   * @returns {number} - Request timeout in seconds.
   */
  getRequestTimeoutMs() {
    const envValue = process.env.VELOCIOUS_REQUEST_TIMEOUT_MS
    const envTimeout = envValue !== undefined ? Number(envValue) : undefined
    const value = typeof this._requestTimeoutMs === "function"
      ? this._requestTimeoutMs()
      : this._requestTimeoutMs

    if (typeof value === "number") return value
    if (typeof envTimeout === "number" && Number.isFinite(envTimeout)) return envTimeout

    return 60
  }

  /**
   * @param {string} newEnvironment - New environment.
   * @returns {void} - No return value.
   */
  setEnvironment(newEnvironment) { this._environment = newEnvironment }

  /**
   * @param {object} [args] - Options object.
   * @param {boolean} [args.defaultConsole] - Whether default console.
   * @returns {Required<Pick<import("./configuration-types.js").LoggingConfiguration, "console" | "directory" | "file" | "filePath" | "levels">>} - The logging configuration.
   */
  getLoggingConfiguration({defaultConsole} = {}) {
    const environment = this.getEnvironment()
    const environmentHandler = this.getEnvironmentHandler()
    const directory = this._logging?.directory || environmentHandler.getDefaultLogDirectory({configuration: this})
    const filePath = this._logging?.filePath || environmentHandler.getLogFilePath({configuration: this, directory, environment})
    const consoleOverride = this._logging?.console
    const fileLogging = this._logging?.file ?? Boolean(filePath)
    const configuredLevels = this._logging?.levels
    const includeLowLevelDebug = this._logging?.debugLowLevel === true

    const consoleDefault = defaultConsole !== undefined ? defaultConsole : true
    const consoleLogging = consoleOverride !== undefined ? consoleOverride : consoleDefault

    /** @type {Array<"debug-low-level" | "debug" | "info" | "warn" | "error">} */
    const defaultLevels = ["info", "warn", "error"]

    if (includeLowLevelDebug) defaultLevels.unshift("debug-low-level")

    const levels = configuredLevels || defaultLevels

    return {
      console: consoleLogging,
      directory,
      file: fileLogging ?? false,
      filePath,
      levels
    }
  }

  /**
   * Logging configuration tailored for HTTP request logging. Defaults console logging to true and applies the user `logging.console` flag only for request logging.
   * @returns {Required<Pick<import("./configuration-types.js").LoggingConfiguration, "console" | "directory" | "file" | "filePath" | "levels">>} - The http logging configuration.
   */
  getHttpLoggingConfiguration() {
    return this.getLoggingConfiguration({defaultConsole: true})
  }

  /**
   * @returns {import("./environment-handlers/base.js").default} - The environment handler.
   */
  getEnvironmentHandler() {
    if (!this._environmentHandler) throw new Error("No environment handler set")

    return this._environmentHandler
  }

  /**
   * @returns {import("./configuration-types.js").LocaleFallbacksType | undefined} - The locale fallbacks.
   */
  getLocaleFallbacks() { return this.localeFallbacks }

  /**
   * @param {import("./configuration-types.js").LocaleFallbacksType} newLocaleFallbacks - New locale fallbacks.
   * @returns {void} - No return value.
   */
  setLocaleFallbacks(newLocaleFallbacks) { this.localeFallbacks = newLocaleFallbacks }

  /**
   * @returns {string} - The locale.
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

  /** @returns {Array<string>} - The locales.  */
  getLocales() { return digg(this, "locales") }

  /**
   * @param {string} name - Name.
   * @returns {typeof import("./database/record/index.js").default} - The model class.
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

  /**
   * @param {string} [identifier] - Database identifier to initialize.
   * @returns {void} - No return value.
   */
  initializeDatabasePool(identifier = "default") {
    if (!this.database) throw new Error("No 'database' was given")
    if (this.databasePools[identifier]) throw new Error("DatabasePool has already been initialized")

    const PoolType = this.getDatabasePoolType(identifier)

    this.databasePools[identifier] = new PoolType({configuration: this, identifier})
    this.databasePools[identifier].setCurrent()
  }

  /**
   * @param {string} [identifier] - Database identifier to check.
   * @returns {boolean} - Whether database pool initialized.
   */
  isDatabasePoolInitialized(identifier = "default") { return Boolean(this.databasePools[identifier]) }

  /** @returns {boolean} - Whether initialized.  */
  isInitialized() { return this._isInitialized }

  /**
   * @param {object} args - Options object.
   * @param {string} args.type - Type identifier.
   * @returns {Promise<void>} - Resolves when complete.
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
   * Ensures each configured database pool has a global connection available.
   * Useful when `getCurrentConnection` might be called without an async context.
   * @returns {Promise<void>} - Resolves when complete.
   */
  async ensureGlobalConnections() {
    for (const identifier of this.getDatabaseIdentifiers()) {
      const pool = this.getDatabasePool(identifier)

      await pool.ensureGlobalConnection()
    }
  }

  /**
   * @param {object} args - Options object.
   * @param {string} args.type - Type identifier.
   * @returns {Promise<void>} - Resolves when complete.
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
   * @param {typeof import("./database/record/index.js").default} modelClass - Model class.
   * @returns {void} - No return value.
   */
  registerModelClass(modelClass) {
    this.modelClasses[modelClass.name] = modelClass
  }

  /** @returns {void} - No return value.  */
  setCurrent() {
    shared.currentConfiguration = this
  }

  /** @returns {import("./routes/index.js").default | undefined} - The routes.  */
  getRoutes() { return this.routes }

  /**
   * @param {import("./routes/index.js").default} newRoutes - New routes.
   * @returns {void} - No return value.
   */
  setRoutes(newRoutes) { this.routes = newRoutes }

  /**
   * @param {function(string, {defaultValue: string} | undefined) : string} callback - Translator callback.
   * @returns {void} - No return value.
   */
  setTranslator(callback) { this._translator = callback }

  /**
   * @param {string} msgID - Msg id.
   * @param {undefined | {defaultValue: string}} args - Translator options.
   * @returns {string} - The default translator.
   */
  _defaultTranslator(msgID, args) {
    if (args?.defaultValue) return args.defaultValue

    return msgID
  }

  /** @returns {function(string, {defaultValue: string} | undefined) : string} - The translator.  */
  getTranslator() {
    return this._translator || this._defaultTranslator
  }

  /**
   * @returns {number | undefined} - The timezone offset in minutes.
   */
  getTimezoneOffsetMinutes() {
    if (typeof this._timezoneOffsetMinutes === "function") {
      const configuredOffset = this._timezoneOffsetMinutes()

      if (typeof configuredOffset === "number") return configuredOffset
    }

    if (typeof this._timezoneOffsetMinutes === "number") {
      return this._timezoneOffsetMinutes
    }

    return new Date().getTimezoneOffset()
  }

  /** @returns {import("./http-server/websocket-events.js").default | undefined} - The websocket events.  */
  getWebsocketEvents() {
    return this._websocketEvents
  }

  /**
   * @param {import("./http-server/websocket-events.js").default} websocketEvents - Websocket events.
   * @returns {void} - No return value.
   */
  setWebsocketEvents(websocketEvents) {
    this._websocketEvents = websocketEvents
  }

  /** @returns {import("./configuration-types.js").WebsocketChannelResolverType | undefined} - The websocket channel resolver. */
  getWebsocketChannelResolver() {
    return this._websocketChannelResolver
  }

  /**
   * @param {import("./configuration-types.js").WebsocketChannelResolverType} resolver - Resolver.
   * @returns {void} - No return value.
   */
  setWebsocketChannelResolver(resolver) {
    this._websocketChannelResolver = resolver
  }

  /** @returns {import("eventemitter3").EventEmitter} - Framework error events emitter. */
  getErrorEvents() {
    return this._errorEvents
  }

  /**
   * @param {WithConnectionsCallbackType} callback - Callback function.
   * @returns {Promise<void>} - Resolves when complete.
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
        const pool = this.getDatabasePool(identifier)
        const currentConnection = pool.getCurrentContextConnection ? pool.getCurrentContextConnection() : pool.getCurrentConnection()

        if (currentConnection) {
          dbs[identifier] = currentConnection
        }
      } catch (error) {
        if (
          error instanceof Error &&
          (
            error.message == "ID hasn't been set for this async context" ||
            error.message == "A connection hasn't been made yet" ||
            error.message.startsWith("No async context set for database connection") ||
            error.message.startsWith("Connection ") && error.message.includes("doesn't exist any more")
          )
        ) {
          // Ignore
        } else {
          throw error
        }
      }
    }

    return dbs
  }

  /**
   * @param {WithConnectionsCallbackType} callback - Callback function.
   * @returns {Promise<void>} - Resolves when complete.
   */
  async ensureConnections(callback) {
    let dbs = this.getCurrentConnections()

    if (Object.keys(dbs).length > 0) {
      await callback(dbs)
    } else {
      await this.withConnections(callback)
    }
  }

  /**
   * Closes all initialized database pools and clears global connections.
   * @returns {Promise<void>} - Resolves when complete.
   */
  async closeDatabasePools() {
    const constructors = new Set()

    for (const pool of Object.values(this.databasePools)) {
      if (!pool) continue

      if (typeof pool.closeAll === "function") {
        await pool.closeAll()
      }

      const poolConstructor = /** @type {{clearGlobalConnections?: (configuration: VelociousConfiguration) => void}} */ (pool.constructor)

      if (typeof poolConstructor?.clearGlobalConnections === "function") {
        constructors.add(poolConstructor)
      }
    }

    for (const constructor of constructors) {
      constructor.clearGlobalConnections?.(this)
    }
  }
}
