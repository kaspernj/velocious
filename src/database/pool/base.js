// @ts-check

import Configuration from "../../configuration.js"
import {digg} from "diggerize"
import {Logger} from "../../logger.js"
import baseMethodsForward from "./base-methods-forward.js"

/** @type {{currentPool: VelociousDatabasePoolBase | null}} */
const shared = {
  currentPool: null
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
   * @returns {{driver: typeof import("../drivers/base.js").default, type: string}} - Driver class and database type identifier.
   */
  getConfiguration() {
    return digg(this.configuration.getDatabaseConfiguration(), this.identifier)
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

    return connection
  }

  /**
   * @param {object} config - Configuration object.
   * @param {typeof import("../drivers/base.js").default} config.driver - Database driver instance.
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
   * @abstract
   * @param {function(import("../drivers/base.js").default) : void} _callback - Callback function.
   * @returns {Promise<void>} - Resolves when complete.
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
