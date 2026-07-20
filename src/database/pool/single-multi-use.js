// @ts-check

import BasePool from "./base.js"

export default class VelociousDatabasePoolSingleMultiUser extends BasePool {
  activeCheckoutCount = 0
  suppressedConnectionContextCount = 0

  /**
   * Runs checkin.
   * @param {import("../drivers/base.js").default} connection - Connection.
   * @returns {Promise<void>} - Resolves when complete.
   */
  async checkin(connection) {
    if (this.connection === connection && this.activeCheckoutCount > 0) {
      this.activeCheckoutCount--

      if (this.activeCheckoutCount > 0) return
    }

    try {
      await connection.releaseHeldAdvisoryLocks()
      await connection.clearConnectionCheckoutName()
    } catch (error) {
      if (this.connection === connection) {
        this.activeCheckoutCount = 0
        this.connection = undefined
      }

      try {
        await connection.close()
      } catch (closeError) {
        const cleanupError = error instanceof Error ? error : new Error("Failed to clean checked-in database connection", {cause: error})
        const connectionCloseError = closeError instanceof Error ? closeError : new Error("Failed to close database connection after check-in cleanup failed", {cause: closeError})

        throw new AggregateError([cleanupError, connectionCloseError], "Failed to clean and close checked-in database connection", {cause: closeError})
      }

      throw error
    }
  }

  /**
   * Runs checkout.
   * @param {import("./base.js").ConnectionCheckoutOptions} [options] - Checkout options.
   * @returns {Promise<import("../drivers/base.js").default>} - Resolves with the checkout.
   */
  async checkout(options = {}) {
    if (this.connection && !this.connectionMatchesCurrentConfiguration(this.connection)) {
      const previousConnection = this.connection

      this.activeCheckoutCount = 0
      this.connection = undefined

      await previousConnection.close()
    }

    if (!this.connection) {
      this.connection = await this.spawnConnection()
    }

    await this.connection.setConnectionCheckoutName(options.name)
    this.activeCheckoutCount++

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
   * Runs without current connection context.
   * @template T
   * @param {() => T} callback - Callback to run without the shared current connection.
   * @returns {T} - Callback result.
   */
  withoutCurrentConnectionContext(callback) {
    this.suppressedConnectionContextCount += 1

    try {
      const result = callback()

      if (result instanceof Promise) {
        return /** @type {T} */ (result.finally(() => {
          this.suppressedConnectionContextCount -= 1
        }))
      }

      this.suppressedConnectionContextCount -= 1
      return result
    } catch (error) {
      this.suppressedConnectionContextCount -= 1
      throw error
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

    this.activeCheckoutCount = 0
    this.connection = undefined

    await connection.close()
  }

  /**
   * Runs get current connection.
   * @returns {import("../drivers/base.js").default} - The current connection.
   */
  getCurrentConnection() {
    if (!this.connection) {
      throw new Error("A connection hasn't been made yet")
    }

    return this.connection
  }

  /**
   * Runs get current context connection.
   * @returns {import("../drivers/base.js").default | undefined} - The current context connection.
   */
  getCurrentContextConnection() {
    if (this.suppressedConnectionContextCount > 0) return undefined

    return this.connection
  }

  /**
   * Returns whether the shared connection is available to the current execution context.
   * @returns {boolean} - Whether nested code can reuse the shared connection.
   */
  hasCurrentConnectionContext() {
    return this.suppressedConnectionContextCount === 0
  }

  /**
   * Runs get debug snapshot.
   * @returns {import("./base.js").DatabasePoolDebugSnapshot} - Diagnostic snapshot for this pool.
   */
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
