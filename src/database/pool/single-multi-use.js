// @ts-check

import BasePool from "./base.js"

export default class VelociousDatabasePoolSingleMultiUser extends BasePool {
  /**
 * Runs checkin.
   * @param {import("../drivers/base.js").default} connection - Connection.
   * @returns {Promise<void>} - Resolves when complete.
   */
  async checkin(connection) {
    await connection.clearConnectionCheckoutName()
  }

  /**
 * Runs checkout.
   * @param {import("./base.js").ConnectionCheckoutOptions} [options] - Checkout options.
   * @returns {Promise<import("../drivers/base.js").default>} - Resolves with the checkout.
   */
  async checkout(options = {}) {
    if (this.connection && !this.connectionMatchesCurrentConfiguration(this.connection)) {
      const previousConnection = this.connection

      this.connection = undefined

      await previousConnection.close()
    }

    if (!this.connection) {
      this.connection = await this.spawnConnection()
    }

    await this.connection.setConnectionCheckoutName(options.name)

    return this.connection
  }

  /**
 * Runs with connection.
   * @template T
   * @param {import("./base.js").ConnectionCheckoutOptions | function(import("../drivers/base.js").default) : Promise<T>} optionsOrCallback - Checkout options or callback function.
   * @param {function(import("../drivers/base.js").default) : Promise<T>} [callback] - Callback function.
   * @returns {Promise<T>} - Resolves with the callback result.
   */
  async withConnection(optionsOrCallback, callback) {
    const options = typeof optionsOrCallback == "function" ? {} : optionsOrCallback

    const connection = await this.checkout(options)

    try {
      if (typeof optionsOrCallback == "function") return await optionsOrCallback(connection)

      if (!callback) throw new Error("withConnection requires a callback")

      return await callback(connection)
    } finally {
      await this.checkin(connection)
    }
  }

  /**
   * Clears schema metadata cached by the reusable connection if it exists.
   * @returns {void} - No return value.
   */
  clearSchemaCache() {
    if (this.connection) this._clearConnectionSchemaCache(this.connection)
  }

  /**
   * Closes the cached connection if it exists.
   * @returns {Promise<void>} - Resolves when complete.
   */
  async closeAll() {
    if (!this.connection) return

    const connection = this.connection

    this.connection = undefined

    await connection.close()
  }

  /**
 * Runs get current connection.
 * @returns {import("../drivers/base.js").default} - The current connection.  */
  getCurrentConnection() {
    if (!this.connection) {
      throw new Error("A connection hasn't been made yet")
    }

    return this.connection
  }

  /**
 * Runs get current context connection.
 * @returns {import("../drivers/base.js").default | undefined} - The current context connection.  */
  getCurrentContextConnection() {
    return this.connection
  }

  /**
 * Runs get debug snapshot.
 * @returns {import("./base.js").DatabasePoolDebugSnapshot} - Diagnostic snapshot for this pool. */
  getDebugSnapshot() {
    const connections = this.connection
      ? [this.debugConnectionSnapshot(this.connection, {state: "shared"})]
      : []

    return {
      ...super.getDebugSnapshot(),
      connections,
      idleCount: this.connection ? 1 : 0
    }
  }
}
