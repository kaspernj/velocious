// @ts-check

import Configuration from "../../configuration.js"
import Logger from "../../logger.js"
import baseMethodsForward from "./base-methods-forward.js"

export const POOL_CONFIGURATION_KEY = Symbol("velociousPoolConfigurationKey")

/**
 * ConnectionCheckoutOptions type.
 * @typedef {object} ConnectionCheckoutOptions
 * @property {string} [name] - Human-readable name for the checked-out connection.
 */

/**
 * DatabasePoolPendingCheckoutDebugSnapshot type.
 * @typedef {object} DatabasePoolPendingCheckoutDebugSnapshot
 * @property {string | undefined} checkoutName - Human-readable checkout name.
 * @property {number} enqueuedAt - Timestamp when the checkout started waiting.
 * @property {number} index - Pending checkout queue index.
 * @property {number | null} remainingTimeoutMs - Milliseconds before the checkout times out, or null when disabled.
 * @property {string} reuseKey - Database configuration reuse key needed by the checkout.
 * @property {number | null} timeoutAt - Timestamp when the checkout will time out, or null when disabled.
 * @property {number | null} timeoutMillis - Timeout configured for the checkout, or null when disabled.
 * @property {number} waitingForMs - Milliseconds already spent waiting.
 */

/**
 * DatabasePoolDebugSnapshot type.
 * @typedef {object} DatabasePoolDebugSnapshot
 * @property {Record<string, ?>} configuration - Sanitized resolved database configuration.
 * @property {Array<Record<string, ?>>} connections - Live connection snapshots.
 * @property {number} connectionsBeingSpawned - Number of in-progress connection spawns.
 * @property {number} idleCount - Number of idle connections.
 * @property {string} identifier - Database identifier.
 * @property {number} inUseCount - Number of checked-out connections.
 * @property {Array<DatabasePoolPendingCheckoutDebugSnapshot>} [pendingCheckouts] - Waiting checkout snapshots.
 * @property {number} pendingCheckoutCount - Number of queued checkout requests.
 * @property {string} poolClass - Pool class name.
 */

/**
 * Shared.
 * @type {{currentPool: VelociousDatabasePoolBase | null}} */
const shared = {
  currentPool: null
}

/**
 * Runs stable stringify.
 * @param {?} value - Value to stringify.
 * @returns {string} - Stable JSON string.
 */
function stableStringify(value) {
  if (Array.isArray(value)) {
    return `[${value.map((entry) => stableStringify(entry)).join(",")}]`
  }

  if (value && typeof value === "object") {
    const entries = Object
      .keys(/**
             * Narrows the runtime value to the documented type.
             * @type {Record<string, ?>} */ (value))
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableStringify(/**
                                                               * Narrows the runtime value to the documented type.
                                                               * @type {Record<string, ?>} */ (value)[key])}`)

    return `{${entries.join(",")}}`
  }

  return JSON.stringify(value)
}

class VelociousDatabasePoolBase {
  /**
   * Without current connection context.
   * @type {undefined | ((callback: () => ?) => ?)} */
  _withoutCurrentConnectionContext = undefined

  /**
   * Runs current.
   * @returns {VelociousDatabasePoolBase} - The current.
   */
  static current() {
    if (!shared.currentPool) throw new Error("A database pool hasn't been set")

    return shared.currentPool
  }

  /**
   * Clears any global connections for the given configuration.
   * @param {import("../../configuration.js").default} configuration - Configuration owning the pool.
   * @returns {void} - No return value.
   */
  static clearGlobalConnections(configuration) { void configuration }

  /**
   * Runs constructor.
   * @param {object} args - Options object.
   * @param {Configuration} args.configuration - Configuration instance.
   * @param {string} args.identifier - Identifier.
   */
  constructor({configuration, identifier}) {
    this.configuration = configuration || Configuration.current()

    if (!this.configuration) throw new Error("No configuration given")
    if (!identifier) throw new Error("No identifier was given")

    this.identifier = identifier
    this.logger = new Logger(this)
  }

  /**
   * Runs checkin.
   * @abstract
   * @param {import("../drivers/base.js").default} _connection - Connection.
   */
  checkin(_connection) {
    throw new Error("'checkin' not implemented")
  }

  /**
   * Runs checkout.
   * @abstract
   * @param {ConnectionCheckoutOptions} [_options] - Checkout options.
   * @returns {Promise<import("../drivers/base.js").default>} - Resolves with the checkout.
   */
  checkout(_options) {
    throw new Error("'checkout' not implemented")
  }

  /**
   * Runs get current connection.
   * @abstract
   * @returns {import("../drivers/base.js").default} - The current connection.
   */
  getCurrentConnection() {
    throw new Error("'getCurrentConnection' not implemented")
  }

  /**
   * Returns the connection pinned to the current context, if any.
   * Default implementation defers to `getCurrentConnection`.
   * @returns {import("../drivers/base.js").default | undefined} - The current context connection.
   */
  getCurrentContextConnection() {
    return this.getCurrentConnection()
  }

  /**
   * Runs without current connection context.
   * @template T
   * @param {() => T} callback - Callback to run without ? current connection context.
   * @returns {T} - Callback result.
   */
  withoutCurrentConnectionContext(callback) {
    if (this._withoutCurrentConnectionContext) return /** @type {T} */ (this._withoutCurrentConnectionContext(callback))

    return callback()
  }

  /**
   * Runs get configuration.
   * @returns {import("../../configuration-types.js").DatabaseConfigurationType} - Resolved database configuration for the pool identifier.
   */
  getConfiguration() {
    return this.configuration.resolveDatabaseConfiguration(this.identifier)
  }

  /**
   * Runs get configuration reuse key.
   * @returns {string} - Reuse key for the currently resolved database configuration.
   */
  getConfigurationReuseKey() {
    const databaseConfiguration = this.getConfiguration()

    return stableStringify({
      database: databaseConfiguration.database,
      host: databaseConfiguration.host,
      name: databaseConfiguration.name,
      port: databaseConfiguration.port,
      schema: databaseConfiguration.schema,
      schemaCache: databaseConfiguration.schemaCache,
      sqlConfig: databaseConfiguration.sqlConfig,
      type: databaseConfiguration.type,
      useDatabase: databaseConfiguration.useDatabase,
      username: databaseConfiguration.username
    })
  }

  /**
   * Runs connection matches current configuration.
   * @param {import("../drivers/base.js").default} connection - Connection.
   * @returns {boolean} - Whether connection matches current resolved configuration.
   */
  connectionMatchesCurrentConfiguration(connection) {
    const connectionWithPoolKey = /**
                                   * Narrows the runtime value to the documented type.
                                   * @type {import("../drivers/base.js").default & {[POOL_CONFIGURATION_KEY]?: string}} */ (connection)

    return connectionWithPoolKey[POOL_CONFIGURATION_KEY] === this.getConfigurationReuseKey()
  }

  /**
   * Clears schema metadata cached by this pool's current connection.
   * Pools that keep multiple connections alive should override this to clear every live connection.
   * @returns {void} - No return value.
   */
  clearSchemaCache() {
    this._clearConnectionSchemaCache(this.getCurrentConnection())
  }

  /**
   * Runs clear connection schema cache.
   * @param {import("../drivers/base.js").default} connection - Connection whose local schema cache should be cleared.
   * @returns {void} - No return value.
   */
  _clearConnectionSchemaCache(connection) {
    connection._clearLocalSchemaCache()
  }

  /**
   * Runs primary key type.
   * @abstract
   * @returns {string} - The primary key type.
   */
  primaryKeyType() {
    throw new Error("'primaryKeyType' not implemented")
  }

  /**
   * Runs set current.
   * @returns {void} - No return value.
   */
  setCurrent() {
    shared.currentPool = this
  }

  /**
   * Runs set driver class.
   * @param {typeof import("../drivers/base.js").default} driverClass - Driver class.
   */
  setDriverClass(driverClass) {
    this.driverClass = driverClass
  }

  /**
   * Runs spawn connection.
   * @returns {Promise<import("../drivers/base.js").default>} - Resolves with the spawn connection.
   */
  async spawnConnection() {
    const databaseConfig = this.getConfiguration()

    this.logger.debug("spawnConnection", {identifier: this.identifier, databaseConfig})

    const connection = await this.spawnConnectionWithConfiguration(databaseConfig)

    const connectionWithPoolKey = /**
                                   * Narrows the runtime value to the documented type.
                                   * @type {import("../drivers/base.js").default & {[POOL_CONFIGURATION_KEY]?: string}} */ (connection)
    connectionWithPoolKey[POOL_CONFIGURATION_KEY] = this.getConfigurationReuseKey()
    connection.setSchemaCacheInvalidator(() => {
      this.clearSchemaCache()
      this.configuration.clearSchemaCachesForReuseKey(this.getConfigurationReuseKey())
    })

    return connection
  }

  /**
   * Runs spawn connection with configuration.
   * @param {import("../../configuration-types.js").DatabaseConfigurationType} config - Configuration object.
   * @returns {Promise<import("../drivers/base.js").default>} - Resolves with the spawn connection with configuration.
   */
  async spawnConnectionWithConfiguration(config) {
    const DriverClass = config.driver || this.driverClass

    if (!DriverClass) throw new Error("No driver class set in database pool or in given config")

    const connection = new DriverClass(config, this.configuration)

    try {
      await connection.connect()
    } catch (error) {
      await this.closeConnectionAfterFailedConnect(connection)
      throw error
    }

    return connection
  }

  /**
   * Runs close connection after failed connect.
   * @param {import("../drivers/base.js").default} connection - Connection to close.
   * @returns {Promise<void>} - Resolves when cleanup has been attempted.
   */
  async closeConnectionAfterFailedConnect(connection) {
    try {
      await connection.close()
    } catch (error) {
      this.logger.warn("Failed to close database connection after connect failed", {error})
    }
  }

  /**
   * Runs with connection.
   * @template T
   * @abstract
   * @param {ConnectionCheckoutOptions | function(import("../drivers/base.js").default) : Promise<T>} _optionsOrCallback - Checkout options or callback function.
   * @param {function(import("../drivers/base.js").default) : Promise<T>} [_callback] - Callback function.
   * @returns {Promise<T>} - Resolves with the callback result.
   */
  withConnection(_optionsOrCallback, _callback) {
    throw new Error("'withConnection' not implemented")
  }

  /**
   * Ensures a reusable connection exists for contexts where AsyncLocalStorage isn't set.
   * Default implementation just checks out a connection.
   * @returns {Promise<import("../drivers/base.js").default>} - Resolves with the global connection.
   */
  async ensureGlobalConnection() {
    return await this.checkout()
  }

  /**
   * Runs get debug snapshot.
   * @returns {DatabasePoolDebugSnapshot} - Diagnostic snapshot for this pool.
   */
  getDebugSnapshot() {
    return {
      configuration: this.debugConfigurationSnapshot(),
      connections: [],
      connectionsBeingSpawned: 0,
      identifier: this.identifier,
      idleCount: 0,
      inUseCount: 0,
      pendingCheckoutCount: 0,
      poolClass: this.constructor.name
    }
  }

  /**
   * Runs debug configuration snapshot.
   * @returns {Record<string, ?>} - Sanitized resolved database configuration.
   */
  debugConfigurationSnapshot() {
    const databaseConfig = this.getConfiguration()
    const poolConfig = databaseConfig.pool

    return {
      database: databaseConfig.database,
      driver: databaseConfig.driver?.name,
      host: databaseConfig.host,
      migrations: databaseConfig.migrations,
      name: databaseConfig.name,
      pool: poolConfig ? {idleTimeoutMillis: poolConfig.idleTimeoutMillis, max: poolConfig.max} : undefined,
      port: databaseConfig.port,
      schema: databaseConfig.schema,
      type: databaseConfig.type,
      useDatabase: databaseConfig.useDatabase,
      username: databaseConfig.username
    }
  }

  /**
   * Runs debug connection snapshot.
   * @param {import("../drivers/base.js").default} connection - Database connection.
   * @param {Record<string, ?>} details - Extra diagnostic fields.
   * @returns {Record<string, ?>} - Connection diagnostic snapshot.
   */
  debugConnectionSnapshot(connection, details = {}) {
    const connectionWithPoolKey = /**
                                   * Narrows the runtime value to the documented type.
                                   * @type {import("../drivers/base.js").default & {[POOL_CONFIGURATION_KEY]?: string}} */ (connection)

    return {
      ...connection.getDebugSnapshot(),
      ...details,
      reuseKey: connectionWithPoolKey[POOL_CONFIGURATION_KEY]
    }
  }

  /**
   * Closes all connections for this pool.
   * @returns {Promise<void>} - Resolves when complete.
   */
  async closeAll() {}
}

baseMethodsForward(VelociousDatabasePoolBase)

export default VelociousDatabasePoolBase
