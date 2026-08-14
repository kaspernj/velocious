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
    this.admissionQueue = Promise.resolve()
  }

  /**
   * Gets the current prepared identity.
   * @returns {string | undefined} - Current prepared identity.
   */
  current() { return this.activeIdentity }

  /**
   * Prepares one identity, sharing an in-flight same-identity rotation.
   * @param {import("../testing/shared-transaction-proxy-driver.js").SharedTransactionBrokerJobConfig} config - Dispatch configuration.
   * @returns {Promise<void>} - Resolves after stale connections close.
   */
  async prepare(config) {
    const identity = JSON.stringify(config)
    if (this.pending) {
      if (this.pending.identity !== identity) throw new Error("Pooled runner cannot mix shared transaction broker capabilities concurrently")
      return await this.pending.promise
    }
    if (this.activeIdentity === identity) return
    if (this.activeUsers > 0) throw new Error("Pooled runner cannot mix shared transaction broker capabilities concurrently")
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
    const previousAdmission = this.admissionQueue
    /**
     * Releases the serialized admission turn.
     * @type {() => void}
     */
    let releaseAdmission = () => {}
    const admission = new Promise((resolve) => { releaseAdmission = () => resolve(undefined) })

    this.admissionQueue = previousAdmission.then(async () => await admission)
    await previousAdmission

    try {
      await this.prepare(config)
      this.activeUsers++
    } finally {
      releaseAdmission()
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
