// @ts-check

import SharedTransactionBroker from "./shared-transaction-broker.js"
import { runWithSharedTransactionBrokerConfig, sharedTransactionBrokerContextMatches } from "./shared-transaction-proxy-driver.js"

/** @typedef {{connection: import("../database/drivers/base.js").default, databaseIdentifier: string, release: () => Promise<void>, reuseKey: string}} Enrollment */

/**
 * Backend-owned, capability-scoped transaction set for long-lived test services.
 * Join coordinates are intentionally obtainable only as a live control message.
 */
export default class TestTransactionSession {
  /**
   * Creates an unstarted transaction session.
   * @param {import("../configuration.js").default} [configuration] - Backend configuration owning enrolled pools.
   */
  constructor(configuration) {
    this.configuration = configuration
    /** @type {SharedTransactionBroker | undefined} */
    this.broker = undefined
    /** @type {Map<string, Enrollment>} */
    this.enrollments = new Map()
    /** @type {Map<string, {pool: import("../database/pool/base.js").default, registration: import("../database/pool/base.js").TestSharedConnectionRegistration}>} */
    this.sharedConnectionRegistrations = new Map()
    /** @type {Promise<void> | undefined} */
    this.cleanupPromise = undefined
    /** @type {Promise<void> | undefined} */
    this.rollbackPromise = undefined
  }

  /**
   * Begins a test transaction session.
   * @param {{configuration?: import("../configuration.js").default}} [args] - Backend owner.
   * @returns {Promise<TestTransactionSession>} - Begun session.
   */
  static async begin({configuration} = {}) {
    const session = new TestTransactionSession(configuration)
    session.broker = await SharedTransactionBroker.start({connections: {}})
    return session
  }

  /**
   * Joins one request/job callback from a live backend control message.
   * @template T
   * @param {{address: string, capability: string}} message - Ephemeral coordinates received over live IPC.
   * @param {() => T} callback - Backend request or worker work.
   * @returns {T} - Callback result.
   */
  static join(message, callback) {
    return runWithSharedTransactionBrokerConfig({...message, allowDynamicIdentities: true, databaseIdentifiers: [], expected: true}, callback)
  }

  /**
   * Lazily adds an exact physical connection to the common rollback set.
   * @param {Enrollment} enrollment - Checked-out physical connection and owner release hook.
   */
  async enroll(enrollment) {
    const broker = this.requiredBroker()
    const identity = `${enrollment.databaseIdentifier}\0${enrollment.reuseKey}`
    const existing = this.enrollments.get(identity)
    if (existing) {
      if (existing.connection !== enrollment.connection) throw new Error(`Test transaction physical identity already enrolled: ${enrollment.databaseIdentifier}`)
      return
    }
    await enrollment.connection.startTransaction()
    try {
      broker.enrollConnection(enrollment)
      this.enrollments.set(identity, enrollment)
    } catch (error) {
      await this.rollbackAndRelease(enrollment)
      throw error
    }
  }

  /**
   * Lazily checks out and enrolls the physical database selected by a tenant descriptor.
   * @param {{databaseIdentifier: string, tenant?: object}} args - Logical and tenant identity.
   */
  async enrollDatabase({databaseIdentifier, tenant}) {
    if (!this.configuration) throw new Error("Test transaction session requires a configuration to enroll a database")
    const pool = this.configuration.getDatabasePool(databaseIdentifier)
    const databaseConfiguration = this.configuration.resolveDatabaseConfiguration(databaseIdentifier, tenant)
    const reuseKey = pool.getConfigurationReuseKey(databaseConfiguration)
    const identity = `${databaseIdentifier}\0${reuseKey}`
    if (this.enrollments.has(identity)) return
    const connection = await this.configuration.runWithTenant(tenant, async () => {
      return await pool.checkout({name: "Test transaction session"})
    })
    await this.enroll({
      connection,
      databaseIdentifier,
      release: async () => { await pool.checkin(connection) },
      reuseKey
    })
    this.installSharedConnectionProvider(databaseIdentifier, pool)
  }

  /**
   * Makes in-process request/Scoundrel checkouts resolve by current physical identity.
   * @param {string} databaseIdentifier - Logical database identifier.
   * @param {import("../database/pool/base.js").default} pool - Owning pool.
   */
  installSharedConnectionProvider(databaseIdentifier, pool) {
    if (this.sharedConnectionRegistrations.has(databaseIdentifier)) return
    const broker = this.requiredBroker()
    const sessionIdentity = {address: broker.address(), capability: broker.capability()}
    const registration = pool.registerTestSharedConnectionProvider({
      matches: () => sharedTransactionBrokerContextMatches(sessionIdentity),
      provider: () => {
        const reuseKey = pool.getConfigurationReuseKey()
        return /** @type {import("../database/drivers/base.js").default | undefined} */ (this.enrollments.get(`${databaseIdentifier}\0${reuseKey}`)?.connection)
      }
    })
    if (registration) this.sharedConnectionRegistrations.set(databaseIdentifier, {pool, registration})
  }

  /**
   * Returns ephemeral coordinates for one live IPC/control message.
   * @returns {{address: string, capability: string}} - Non-durable join coordinates.
   */
  joinMessage() {
    const broker = this.requiredBroker()
    if (!broker.accepting) throw new Error("Test transaction session capability has been revoked")
    return {address: broker.address(), capability: broker.capability()}
  }

  /** Stops admission to the capability. */
  revoke() { this.requiredBroker().revoke() }

  /** Drains work accepted before revocation. */
  async drain() { await this.requiredBroker().drain() }

  /**
   * Rolls back and releases the complete enrolled set after admission stops.
   * @returns {Promise<void>} - Resolves after rollback and release.
   */
  async rollback() {
    if (this.rollbackPromise) return await this.rollbackPromise
    this.rollbackPromise = this.rollbackActual()
    return await this.rollbackPromise
  }

  /**
   * Performs rollback and release once.
   * @returns {Promise<void>} - Resolves after actual rollback and release.
   */
  async rollbackActual() {
    const broker = this.requiredBroker()
    if (broker.accepting) throw new Error("Test transaction session must be revoked before rollback")
    /** @type {Array<Error>} */
    const errors = []
    try { await broker.close() } catch (error) { errors.push(this.normalizeError(error)) }
    for (const {pool, registration} of this.sharedConnectionRegistrations.values()) {
      pool.clearTestSharedConnection(registration)
    }
    this.sharedConnectionRegistrations.clear()
    for (const enrollment of this.enrollments.values()) {
      try { await this.rollbackAndRelease(enrollment) } catch (error) { errors.push(this.normalizeError(error)) }
    }
    this.enrollments.clear()
    if (errors.length > 0) throw new AggregateError(errors, "Test transaction session rollback failed")
  }

  /**
   * Revokes, drains, rolls back, and releases every enrolled physical connection exactly once.
   * @returns {Promise<void>} - Resolves after idempotent cleanup.
   */
  async cleanup() {
    if (this.cleanupPromise) return await this.cleanupPromise
    this.cleanupPromise = this.cleanupActual()
    return await this.cleanupPromise
  }

  /**
   * Performs idempotent cleanup once.
   * @returns {Promise<void>} - Resolves after actual cleanup.
   */
  async cleanupActual() {
    this.revoke()
    await this.rollback()
  }

  /**
   * Returns capability-free session diagnostics.
   * @returns {{accepting: boolean, enrollmentCount: number}} - Capability-free diagnostics.
   */
  debugSnapshot() {
    return {accepting: this.broker?.accepting === true, enrollmentCount: this.enrollments.size}
  }

  /**
   * Returns the begun broker.
   * @returns {SharedTransactionBroker} - Begun broker.
   */
  requiredBroker() {
    if (!this.broker) throw new Error("Test transaction session has not begun")
    return this.broker
  }

  /**
   * Rolls back and releases one owned physical connection.
   * @param {Enrollment} enrollment - Owned physical connection.
   * @returns {Promise<void>} - Resolves after rollback and release.
   */
  async rollbackAndRelease(enrollment) {
    /** @type {Array<Error>} */
    const errors = []
    try { await enrollment.connection.rollbackTransaction() } catch (error) { errors.push(this.normalizeError(error)) }
    try { await enrollment.release() } catch (error) { errors.push(this.normalizeError(error)) }
    if (errors.length > 0) throw new AggregateError(errors, "Test transaction enrollment cleanup failed")
  }

  /**
   * Normalizes a thrown cleanup value.
   * @param {unknown} error - Opaque thrown cleanup value narrowed at this boundary.
   * @returns {Error} - Error instance.
   */
  normalizeError(error) { return error instanceof Error ? error : new Error(String(error)) }
}
