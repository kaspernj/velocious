// @ts-check

import Configuration from "../../configuration.js"
import Logger from "../../logger.js"
import baseMethodsForward from "./base-methods-forward.js"

export const POOL_CONFIGURATION_KEY = Symbol("velociousPoolConfigurationKey")

/** @type {{currentPool: VelociousDatabasePoolBase | null}} */
const shared = {
  currentPool: null
}

/**
 * @param {unknown} value - Value to stringify.
 * @returns {string} - Stable JSON string.
 */
function stableStringify(value) {
  if (Array.isArray(value)) {
    return `[${value.map((entry) => stableStringify(entry)).join(",")}]`
  }

  if (value && typeof value === "object") {
    const entries = Object
      .keys(/** @type {Record<string, unknown>} */ (value))
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableStringify(/** @type {Record<string, unknown>} */ (value)[key])}`)

    return `{${entries.join(",")}}`
  }

  return JSON.stringify(value)
}

class VelociousDatabasePoolBase {
  /**
   * @returns {VelociousDatabasePoolBase} - The current.
   */
  static current() {
    if (!shared.currentPool) throw new Error("A database pool hasn't been set")

    return shared.currentPool
  }

  /**
   * Clears any global connections for the given configuration.
   * @returns {void} - No return value.
   */
  static clearGlobalConnections() {}

  /**
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
   * @abstract
   * @param {import("../drivers/base.js").default} _connection - Connection.
   */
  checkin(_connection) { // eslint-disable-line no-unused-vars
    throw new Error("'checkin' not implemented")
  }

  /**
   * @abstract
   * @returns {Promise<import("../drivers/base.js").default>} - Resolves with the checkout.
   */
  checkout() {
    throw new Error("'checkout' not implemented")
  }

  /**
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
   * @returns {import("../../configuration-types.js").DatabaseConfigurationType} - Resolved database configuration for the pool identifier.
   */
  getConfiguration() {
    return this.configuration.resolveDatabaseConfiguration(this.identifier)
  }

  /**
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
   * @param {import("../drivers/base.js").default} connection - Connection.
   * @returns {boolean} - Whether connection matches current resolved configuration.
   */
  connectionMatchesCurrentConfiguration(connection) {
    const connectionWithPoolKey = /** @type {import("../drivers/base.js").default & {[POOL_CONFIGURATION_KEY]?: string}} */ (connection)

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
   * @param {import("../drivers/base.js").default} connection - Connection whose local schema cache should be cleared.
   * @returns {void} - No return value.
   */
  _clearConnectionSchemaCache(connection) {
    connection._clearLocalSchemaCache()
  }

  /**
   * @abstract
   * @returns {string} - The primary key type.
   */
  primaryKeyType() {
    throw new Error("'primaryKeyType' not implemented")
  }

  /**
   * @returns {void} - No return value.
   */
  setCurrent() {
    shared.currentPool = this
  }

  /**
   * @param {typeof import("../drivers/base.js").default} driverClass - Driver class.
   */
  setDriverClass(driverClass) {
    this.driverClass = driverClass
  }

  /**
   * @returns {Promise<import("../drivers/base.js").default>} - Resolves with the spawn connection.
   */
  async spawnConnection() {
    const databaseConfig = this.getConfiguration()

    this.logger.debug("spawnConnection", {identifier: this.identifier, databaseConfig})

    const connection = await this.spawnConnectionWithConfiguration(databaseConfig)

    const connectionWithPoolKey = /** @type {import("../drivers/base.js").default & {[POOL_CONFIGURATION_KEY]?: string}} */ (connection)
    connectionWithPoolKey[POOL_CONFIGURATION_KEY] = this.getConfigurationReuseKey()
    connection.setSchemaCacheInvalidator(() => this.clearSchemaCache())

    return connection
  }

  /**
   * @param {import("../../configuration-types.js").DatabaseConfigurationType} config - Configuration object.
   * @returns {Promise<import("../drivers/base.js").default>} - Resolves with the spawn connection with configuration.
   */
  async spawnConnectionWithConfiguration(config) {
    const DriverClass = config.driver || this.driverClass

    if (!DriverClass) throw new Error("No driver class set in database pool or in given config")

    const connection = new DriverClass(config, this.configuration)

    await connection.connect()

    return connection
  }

  /**
   * @template T
   * @abstract
   * @param {function(import("../drivers/base.js").default) : Promise<T>} _callback - Callback function.
   * @returns {Promise<T>} - Resolves with the callback result.
   */
  withConnection(_callback) { // eslint-disable-line no-unused-vars
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
   * Closes all connections for this pool.
   * @returns {Promise<void>} - Resolves when complete.
   */
  async closeAll() {}
}

baseMethodsForward(VelociousDatabasePoolBase)

export default VelociousDatabasePoolBase
