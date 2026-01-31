// @ts-check

/**
 * @typedef {function(Record<string, import("./database/drivers/base.js").default>) : Promise<void>} WithConnectionsCallbackType
 */

import {digg} from "diggerize"
import gettextConfig from "gettext-universal/build/src/config.js"
import translate from "gettext-universal/build/src/translate.js"
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
  _closeDatabaseConnectionsPromise = null
  /** @returns {VelociousConfiguration} - The current.  */
  static current() {
    if (!shared.currentConfiguration) throw new CurrentConfigurationNotSetError("A current configuration hasn't been set")

    return shared.currentConfiguration
  }

  /** @param {import("./configuration-types.js").ConfigurationArgsType} args - Configuration arguments. */
  constructor({backgroundJobs, cookieSecret, cors, database, debug = false, directory, environment, environmentHandler, initializeModels, initializers, locale, localeFallbacks, locales, logging, mailerBackend, requestTimeoutMs, structureSql, testing, timezoneOffsetMinutes, websocketChannelResolver, websocketMessageHandlerResolver, ...restArgs}) {
    restArgsError(restArgs)

    this._backgroundJobs = backgroundJobs
    this.cors = cors
    this._cookieSecret = cookieSecret
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
    this._structureSql = structureSql
    this._websocketEvents = undefined
    this._websocketChannelResolver = websocketChannelResolver
    this._websocketMessageHandlerResolver = websocketMessageHandlerResolver
    this._logging = logging
    this._mailerBackend = mailerBackend
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

  /** @returns {string | undefined} - Cookie secret. */
  getCookieSecret() {
    return this._cookieSecret
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
    const identifiers = Object.keys(this.getDatabaseConfiguration())
    const disabledIdentifiers = new Set()
    const disabledIdentifiersRaw = process.env.VELOCIOUS_DISABLED_DATABASE_IDENTIFIERS

    if (disabledIdentifiersRaw) {
      for (const identifier of disabledIdentifiersRaw.split(",")) {
        const trimmed = identifier.trim()

        if (trimmed) disabledIdentifiers.add(trimmed)
      }
    }

    if (process.env.VELOCIOUS_DISABLE_MSSQL === "1") {
      disabledIdentifiers.add("mssql")
    }

    if (disabledIdentifiers.size === 0) return identifiers

    return identifiers.filter((identifier) => !disabledIdentifiers.has(identifier))
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
    const envTimeout = this._parseRequestTimeoutSeconds(process.env.VELOCIOUS_REQUEST_TIMEOUT_MS)
    const value = typeof this._requestTimeoutMs === "function"
      ? this._requestTimeoutMs()
      : this._requestTimeoutMs

    if (typeof value === "number") return value
    if (typeof envTimeout === "number" && Number.isFinite(envTimeout)) return envTimeout

    return 60
  }

  /**
   * @param {string | undefined} rawValue - Env value.
   * @returns {number | undefined} - Timeout in seconds.
   */
  _parseRequestTimeoutSeconds(rawValue) {
    if (rawValue === undefined) return undefined

    const trimmed = rawValue.trim().toLowerCase()

    if (!trimmed) return undefined

    const match = trimmed.match(/^(\d+(?:\.\d+)?)(ms|s)?$/)

    if (!match) return undefined

    const numeric = Number(match[1])

    if (!Number.isFinite(numeric)) return undefined

    const unit = match[2]

    if (unit === "ms") return numeric / 1000
    if (unit === "s") return numeric

    if (trimmed.includes(".")) return numeric
    if (numeric >= 1000) return numeric / 1000

    return numeric
  }

  /**
   * @param {string} newEnvironment - New environment.
   * @returns {void} - No return value.
   */
  setEnvironment(newEnvironment) { this._environment = newEnvironment }

  /**
   * @param {object} [args] - Options object.
   * @param {boolean} [args.defaultConsole] - Whether default console.
   * @returns {Required<Pick<import("./configuration-types.js").LoggingConfiguration, "console" | "directory" | "file" | "filePath" | "levels">> & Partial<Pick<import("./configuration-types.js").LoggingConfiguration, "outputs" | "loggers">>} - The logging configuration.
   */
  getLoggingConfiguration({defaultConsole} = {}) {
    const environment = this.getEnvironment()
    const environmentHandler = this.getEnvironmentHandler()
    const directory = this._logging?.directory || environmentHandler.getDefaultLogDirectory({configuration: this})
    const filePath = this._logging?.filePath || environmentHandler.getLogFilePath({configuration: this, directory, environment})
    const consoleOverride = this._logging?.console
    const hasLoggingConfig = Boolean(this._logging)
    const fileLogging = hasLoggingConfig ? (this._logging?.file ?? Boolean(filePath)) : false
    const configuredLevels = this._logging?.levels
    const includeLowLevelDebug = this._logging?.debugLowLevel === true
    const loggers = this._logging?.loggers

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
      loggers,
      levels,
      outputs: this._logging?.outputs
    }
  }

  /**
   * @returns {Required<import("./configuration-types.js").BackgroundJobsConfiguration>} - Background jobs configuration.
   */
  getBackgroundJobsConfig() {
    const envHost = process.env.VELOCIOUS_BACKGROUND_JOBS_HOST
    const envPortRaw = process.env.VELOCIOUS_BACKGROUND_JOBS_PORT
    const envDatabaseIdentifier = process.env.VELOCIOUS_BACKGROUND_JOBS_DATABASE_IDENTIFIER
    const envPort = envPortRaw ? Number(envPortRaw) : undefined
    const configured = this._backgroundJobs || {}
    const host = configured.host || envHost || "127.0.0.1"
    const port = typeof configured.port === "number"
      ? configured.port
      : (typeof envPort === "number" && Number.isFinite(envPort) ? envPort : 7331)
    const databaseIdentifier = configured.databaseIdentifier || envDatabaseIdentifier || "default"

    return {host, port, databaseIdentifier}
  }

  /**
   * @param {import("./configuration-types.js").BackgroundJobsConfiguration} backgroundJobs - Background jobs config.
   * @returns {void}
   */
  setBackgroundJobsConfig(backgroundJobs) {
    this._backgroundJobs = Object.assign({}, this._backgroundJobs, backgroundJobs)
  }

  /**
   * @returns {import("./configuration-types.js").MailerBackend | undefined} - Mailer backend.
   */
  getMailerBackend() {
    return this._mailerBackend
  }

  /**
   * @param {import("./configuration-types.js").MailerBackend} mailerBackend - Mailer backend.
   * @returns {void} - No return value.
   */
  setMailerBackend(mailerBackend) {
    this._mailerBackend = mailerBackend
  }

  /**
   * Logging configuration tailored for HTTP request logging. Defaults console logging to true and applies the user `logging.console` flag only for request logging.
   * @returns {Required<Pick<import("./configuration-types.js").LoggingConfiguration, "console" | "directory" | "file" | "filePath" | "levels">> & Partial<Pick<import("./configuration-types.js").LoggingConfiguration, "outputs" | "loggers">>} - The http logging configuration.
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

  /** @returns {import("./configuration-types.js").StructureSqlConfiguration | undefined} - Structure SQL config. */
  getStructureSqlConfig() { return this._structureSql }

  /**
   * @returns {boolean} - Whether structure SQL files should be generated for the current environment.
   */
  shouldWriteStructureSql() {
    const config = this.getStructureSqlConfig()
    const disabledEnvironments = config?.disabledEnvironments

    if (Array.isArray(disabledEnvironments) && disabledEnvironments.includes(this.getEnvironment())) {
      return false
    }

    return true
  }

  /**
   * @param {import("./configuration-types.js").StructureSqlConfiguration} structureSql - Structure SQL config.
   * @returns {void} - No return value.
   */
  setStructureSqlConfig(structureSql) {
    this._structureSql = structureSql
  }

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
   * @param {function(string, Record<string, any> | undefined) : string} callback - Translator callback.
   * @returns {void} - No return value.
   */
  setTranslator(callback) { this._translator = callback }

  /**
   * @param {string} msgID - Msg id.
   * @param {Record<string, any> | undefined} args - Translator options and variables.
   * @returns {string} - The default translator.
   */
  _defaultTranslator(msgID, args) {
    this._configureDefaultTranslator()

    const translateArgs = args ? {...args} : undefined
    const defaultValue = translateArgs?.defaultValue
    const locales = translateArgs?.locales

    if (translateArgs) {
      delete translateArgs.defaultValue
      delete translateArgs.locales
    }

    const variables = translateArgs && Object.keys(translateArgs).length > 0 ? translateArgs : undefined

    const locale = this.getLocale()
    const preferredLocales = locales || (locale ? undefined : [])
    const message = translate(msgID, variables, preferredLocales)

    if (message === msgID && defaultValue) return translate(defaultValue, variables, [])

    return message
  }

  /** @returns {function(string, Record<string, any> | undefined) : string} - The translator.  */
  getTranslator() {
    if (this._translator) return this._translator

    if (!this._defaultTranslatorBound) {
      this._defaultTranslatorBound = this._defaultTranslator.bind(this)
    }

    return this._defaultTranslatorBound
  }

  /** @returns {void} - Configure gettext defaults for this configuration. */
  _configureDefaultTranslator() {
    const locale = this.getLocale()

    gettextConfig.setLocale(locale || "")

    const fallbacks = locale ? this.getLocaleFallbacks()?.[locale] : []

    gettextConfig.setFallbacks(fallbacks || [])
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

  /** @returns {import("./configuration-types.js").WebsocketMessageHandlerResolverType | undefined} - The websocket message handler resolver. */
  getWebsocketMessageHandlerResolver() {
    return this._websocketMessageHandlerResolver
  }

  /**
   * @param {import("./configuration-types.js").WebsocketChannelResolverType} resolver - Resolver.
   * @returns {void} - No return value.
   */
  setWebsocketChannelResolver(resolver) {
    this._websocketChannelResolver = resolver
  }

  /**
   * @param {import("./configuration-types.js").WebsocketMessageHandlerResolverType} resolver - Resolver.
   * @returns {void} - No return value.
   */
  setWebsocketMessageHandlerResolver(resolver) {
    this._websocketMessageHandlerResolver = resolver
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
    const dbs = this.getCurrentConnections()
    const identifiers = this.getDatabaseIdentifiers()
    const hasAllConnections = identifiers.every((identifier) => dbs[identifier])

    if (hasAllConnections) {
      await callback(dbs)
    } else {
      await this.withConnections(callback)
    }
  }

  /**
   * Closes active database connections and clears global connections.
   * @returns {Promise<void>} - Resolves when complete.
   */
  async closeDatabaseConnections() {
    if (this._closeDatabaseConnectionsPromise) {
      await this._closeDatabaseConnectionsPromise
      return
    }

    const constructors = new Set()

    this._closeDatabaseConnectionsPromise = (async () => {
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

      // Allow models to be re-initialized after connections are closed.
      this._modelsInitialized = false
    })()

    try {
      await this._closeDatabaseConnectionsPromise
    } finally {
      this._closeDatabaseConnectionsPromise = null
    }
  }
}
