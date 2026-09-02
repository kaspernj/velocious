// @ts-check

export default class PooledRunnerBrokerIdentity {
  /**
   * Creates a pooled runner identity coordinator.
   * @param {{closeConnections: () => Promise<void>}} args - Connection cleanup hook.
   */
  constructor({closeConnections}) {
    this.closeConnections = closeConnections
    /** @type {string | undefined} */
    this.activeIdentity = undefined
    /** @type {{identity: string, promise: Promise<void>} | undefined} */
    this.pending = undefined
    this.activeUsers = 0
  }

  /**
   * Gets the current prepared identity.
   * @returns {string | undefined} - Current prepared identity.
   */
  current() { return this.activeIdentity }

  /**
   * Prepares one identity, sharing an in-flight same-identity rotation.
   * @param {import("../testing/shared-transaction-proxy-driver.js").SharedTransactionBrokerJobConfig} config - Dispatch configuration.
   * @param {boolean} [admissionReserved] - Whether the caller already reserved its active-user slot.
   * @returns {Promise<void>} - Resolves after stale connections close.
   */
  async prepare(config, admissionReserved = false) {
    const identity = JSON.stringify(config)
    if (this.pending) {
      if (this.pending.identity !== identity) throw new Error("Pooled runner cannot mix shared transaction broker capabilities concurrently")
      return await this.pending.promise
    }
    if (this.activeIdentity === identity) return
    const otherActiveUsers = this.activeUsers - (admissionReserved ? 1 : 0)
    if (otherActiveUsers > 0) throw new Error("Pooled runner cannot mix shared transaction broker capabilities concurrently")
    if (this.activeIdentity === undefined) {
      this.activeIdentity = identity
      return
    }

    const promise = this.rotate(identity)
    this.pending = {identity, promise}
    try {
      await promise
    } finally {
      this.pending = undefined
    }
  }

  /**
   * Runs work while preventing a different identity from replacing its connections.
   * @template T
   * @param {import("../testing/shared-transaction-proxy-driver.js").SharedTransactionBrokerJobConfig} config - Dispatch configuration.
   * @param {() => Promise<T>} callback - Job callback.
   * @returns {Promise<T>} - Job result.
   */
  async run(config, callback) {
    await this.admit(config)
    try {
      return await callback()
    } finally {
      this.activeUsers--
    }
  }

  /**
   * Atomically prepares an attempt identity and reserves its active user. Without
   * this admission turn, another capability can rotate connections after `prepare`
   * resolves but before `run` increments `activeUsers`.
   * @param {import("../testing/shared-transaction-proxy-driver.js").SharedTransactionBrokerJobConfig} config - Dispatch configuration.
   * @returns {Promise<void>} - Resolves after admission is reserved.
   */
  async admit(config) {
    this.activeUsers++
    try {
      await this.prepare(config, true)
    } catch (error) {
      this.activeUsers--
      throw error
    }
  }

  /**
   * Rotates retained connection state to an identity.
   * @param {string} identity - Target identity.
   * @returns {Promise<void>} - Resolves after rotation.
   */
  async rotate(identity) {
    await this.closeConnections()
    this.activeIdentity = identity
  }
}
