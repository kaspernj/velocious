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
   * @returns {VelociousDatabasePoolBase}
   */
  static current() {
    if (!shared.currentPool) throw new Error("A database pool hasn't been set")

    return shared.currentPool
  }

  /**
   * @param {object} args
   * @param {Configuration} args.configuration
   * @param {string} args.identifier
   */
  constructor({configuration, identifier}) {
    this.configuration = configuration || Configuration.current()

    if (!this.configuration) throw new Error("No configuration given")
    if (!identifier) throw new Error("No identifier was given")

    this.identifier = identifier
    this.logger = new Logger(this)
  }

  /**
   * @interface
   * @param {import("../drivers/base.js").default} _connection
   */
  checkin(_connection) { // eslint-disable-line no-unused-vars
    throw new Error("'checkin' not implemented")
  }

  /**
   * @interface
   * @returns {Promise<import("../drivers/base.js").default>}
   */
  checkout() {
    throw new Error("'checkout' not implemented")
  }

  /**
   * @interface
   * @returns {import("../drivers/base.js").default}
   */
  getCurrentConnection() {
    throw new Error("'getCurrentConnection' not implemented")
  }

  /**
   * @returns {{driver: typeof import("../drivers/base.js").default, type: string}}
   */
  getConfiguration() {
    return digg(this.configuration.getDatabaseConfiguration(), this.identifier)
  }

  /**
   * @interface
   * @returns {string}
   */
  primaryKeyType() {
    throw new Error("'primaryKeyType' not implemented")
  }

  /**
   * @returns {void}
   */
  setCurrent() {
    shared.currentPool = this
  }

  /**
   * @param {typeof import("../drivers/base.js").default} driverClass
   */
  setDriverClass(driverClass) {
    this.driverClass = driverClass
  }

  /**
   * @returns {Promise<import("../drivers/base.js").default>}
   */
  async spawnConnection() {
    const databaseConfig = this.getConfiguration()

    this.logger.debug("spawnConnection", {identifier: this.identifier, databaseConfig})

    const connection = await this.spawnConnectionWithConfiguration(databaseConfig)

    return connection
  }

  /**
   * @param {object} config
   * @param {typeof import("../drivers/base.js").default} config.driver
   * @returns {Promise<import("../drivers/base.js").default>}
   */
  async spawnConnectionWithConfiguration(config) {
    const DriverClass = config.driver || this.driverClass

    if (!DriverClass) throw new Error("No driver class set in database pool or in given config")

    const connection = new DriverClass(config, this.configuration)

    await connection.connect()

    return connection
  }

  /**
   * @interface
   * @param {function(import("../drivers/base.js").default) : void} _callback
   * @returns {Promise<void>}
   */
  withConnection(_callback) { // eslint-disable-line no-unused-vars
    throw new Error("'withConnection' not implemented")
  }
}

baseMethodsForward(VelociousDatabasePoolBase)

export default VelociousDatabasePoolBase
