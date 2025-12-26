// @ts-check

import BasePool from "./base.js"

export default class VelociousDatabasePoolSingleMultiUser extends BasePool {
  /**
   * @param {import("../drivers/base.js").default} _connection
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
    }

    return this.connection
  }

  /**
   * @param {function(import("../drivers/base.js").default) : void} callback
   */
  async withConnection(callback) {
    const connection = await this.checkout()

    await callback(connection)
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
