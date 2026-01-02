// @ts-check

import BasePool from "./base.js"

export default class VelociousDatabasePoolSingleMultiUser extends BasePool {
  /**
   * @param {import("../drivers/base.js").default} _connection - Connection.
   */
  checkin(_connection) { // eslint-disable-line no-unused-vars
    // Do nothing
  }

  /**
   * @returns {Promise<import("../drivers/base.js").default>} - Resolves with the checkout.
   */
  async checkout() {
    if (!this.connection) {
      this.connection = await this.spawnConnection()
      this.logger.debugLowLevel(() => ["checkoutConnection", {identifier: this.identifier, reused: false}])
    } else {
      this.logger.debugLowLevel(() => ["checkoutConnection", {identifier: this.identifier, reused: true}])
    }

    return this.connection
  }

  /**
   * @param {function(import("../drivers/base.js").default) : void} callback - Callback function.
   */
  async withConnection(callback) {
    const connection = await this.checkout()

    await callback(connection)
  }

  /**
   * Closes the cached connection if it exists.
   * @returns {Promise<void>} - Resolves when complete.
   */
  async closeAll() {
    if (!this.connection) return

    const connection = this.connection

    this.connection = undefined

    if (typeof connection.close === "function") {
      await connection.close()
    } else if (typeof connection.disconnect === "function") {
      await connection.disconnect()
    }
  }

  /** @returns {import("../drivers/base.js").default} - The current connection.  */
  getCurrentConnection() {
    if (!this.connection) {
      throw new Error("A connection hasn't been made yet")
    }

    return this.connection
  }

  /** @returns {import("../drivers/base.js").default | undefined} - The current context connection.  */
  getCurrentContextConnection() {
    return this.connection
  }
}
