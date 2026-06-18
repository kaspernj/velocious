// @ts-check

import {AsyncLocalStorage} from "async_hooks"
import BasePool, {POOL_CONFIGURATION_KEY} from "./base.js"

export const CLOSED_CONNECTION = Symbol("velociousClosedConnection")
const IDLE_CONNECTION_CHECKED_IN_AT = Symbol("velociousIdleConnectionCheckedInAt")
const CONNECTION_CHECKED_OUT_AT = Symbol("velociousConnectionCheckedOutAt")
const DEFAULT_MAX_CONNECTIONS = 10
const DEFAULT_IDLE_TIMEOUT_MILLIS = 5000
const DEFAULT_CHECKOUT_TIMEOUT_MILLIS = 10000

/**
 * PendingCheckout type.
 * @typedef {object} PendingCheckout
 * @property {import("../../configuration-types.js").DatabaseConfigurationType} databaseConfig - Resolved database configuration needed by the checkout.
 * @property {number} enqueuedAt - Timestamp when the checkout started waiting.
 * @property {import("./base.js").ConnectionCheckoutOptions} options - Checkout options.
 * @property {string} reuseKey - Database configuration reuse key needed by the checkout.
 * @property {(connection: import("../drivers/base.js").default) => void} resolve - Resolves with an activated connection.
 * @property {(error: Error) => void} reject - Rejects when checkout cannot complete.
 * @property {number | null} timeoutAt - Timestamp when the checkout will time out, or null when disabled.
 * @property {number | null} timeoutMillis - Milliseconds to wait before rejecting, or null when disabled.
 * @property {ReturnType<typeof setTimeout> | undefined} timeoutTimer - Timer that rejects the pending checkout.
 */

export default class VelociousDatabasePoolAsyncTrackedMultiConnection extends BasePool {
  /**
   * Global fallback connections keyed by configuration instance and pool identifier.
   * @type {WeakMap<import("../../configuration.js").default, Record<string, import("../drivers/base.js").default>>}
   */
  static globalConnections = new WeakMap()

  asyncLocalStorage = new AsyncLocalStorage()

  /**
   * When set, returned by getCurrentContextConnection when no async context exists.
   * Used by the test runner to share a connection between test code and HTTP handlers
   * running in the same process (in-process test server mode).
   * @type {import("../drivers/base.js").default | undefined}
   */
  _testSharedConnection = undefined

  /**
   * Connections.
   * @type {import("../drivers/base.js").default[]} */
  connections = []

  /**
   * Connections in use.
   * @type {Record<number, import("../drivers/base.js").default>} */
  connectionsInUse = {}

  /**
   * Pending checkouts.
   * @type {PendingCheckout[]} */
  pendingCheckouts = []

  /**
   * Connections being spawned.
   * @type {number} */
  connectionsBeingSpawned = 0

  /**
   * Pending checkout drain promise.
   * @type {Promise<void> | undefined} */
  pendingCheckoutDrainPromise = undefined

  /**
   * Idle connection reaper timer.
   * @type {ReturnType<typeof setTimeout> | undefined} */
  idleConnectionReaperTimer = undefined

  /**
   * In-flight connection-close promises. The idle reaper is armed on check-in
   * and runs fire-and-forget when its timer fires, so a scheduled reap can be
   * closing a connection while an explicit `reapIdleConnections()` (or
   * `clearIdleConnectionReaperTimer()`) runs. Tracking the in-flight closes lets
   * those callers await them, so once a reap resolves the connections it
   * expired are fully closed instead of half-closed mid-`close()`.
   * @type {Set<Promise<void>>}
   */
  inflightConnectionCloses = new Set()

  /**
   * In-flight close promise per connection, so concurrent closes of the same
   * connection await the same close rather than closing the driver handle twice.
   * @type {WeakMap<object, Promise<void>>}
   */
  connectionClosePromises = new WeakMap()

  idSeq = 0

  /**
   * Runs constructor.
   * @param {object} args - Options object.
   * @param {import("../../configuration.js").default} args.configuration - Configuration instance.
   * @param {string} args.identifier - Identifier.
   */
  constructor({configuration, identifier}) {
    super({configuration, identifier})
    /**
     * Runs a callback without the inherited current connection context.
     * @type {(callback: () => ?) => ?}
     */
    const withoutCurrentConnectionContext = (callback) => this.asyncLocalStorage.run(undefined, callback)
    this._withoutCurrentConnectionContext = withoutCurrentConnectionContext
  }

  /**
   * Runs checkin.
   * @param {import("../drivers/base.js").default} connection - Database connection instance.
   * @returns {Promise<void>} - Resolves when the connection is checked in or closed.
   */
  async checkin(connection) {
    const id = connection.getIdSeq()
    const trackedConnection = /** @type {import("../drivers/base.js").default & {[CLOSED_CONNECTION]?: boolean, [CONNECTION_CHECKED_OUT_AT]?: number, [IDLE_CONNECTION_CHECKED_IN_AT]?: number}} */ (connection)

    if (trackedConnection[CLOSED_CONNECTION]) {
      this.untrackConnectionInUse(connection, id)
      await this.drainPendingCheckouts()
      return
    }

    try {
      await this.rollbackLeftOpenTransaction(connection)
      await connection.clearConnectionCheckoutName()
    } catch (error) {
      await this.closeCheckedOutConnectionAfterCheckinFailure(connection, id, error)
      throw error
    }

    this.untrackConnectionInUse(connection, id)
    trackedConnection[IDLE_CONNECTION_CHECKED_IN_AT] = Date.now()
    delete trackedConnection[CONNECTION_CHECKED_OUT_AT]
    this.connections.push(connection)
    await this.drainPendingCheckouts()
    if (this.connections.includes(connection)) await this.handleCheckedInIdleConnection()
  }

  /**
   * Runs close checked out connection after checkin failure.
   * @param {import("../drivers/base.js").default} connection - Connection that failed check-in cleanup.
   * @param {number | undefined} id - Connection checkout id.
   * @param {?} originalError - Error that caused check-in cleanup to fail.
   * @returns {Promise<void>} - Resolves when cleanup has been attempted.
   */
  async closeCheckedOutConnectionAfterCheckinFailure(connection, id, originalError) {
    this.untrackConnectionInUse(connection, id)

    try {
      await this.closeConnection(connection)
    } catch (error) {
      this.logger.warn("Failed to close database connection after check-in cleanup failed", {error, originalError})
    }

    try {
      await this.drainPendingCheckouts()
    } catch (error) {
      this.logger.warn("Failed to drain pending database checkouts after check-in cleanup failed", {error, originalError})
    }
  }

  /**
   * Runs untrack connection in use.
   * @param {import("../drivers/base.js").default} connection - Connection being checked in.
   * @param {number | undefined} id - Connection checkout id.
   * @returns {void}
   */
  untrackConnectionInUse(connection, id) {
    if (typeof id !== "number") {
      throw new Error(`idSeq on connection wasn't set? '${typeof id}' = ${id}`)
    }

    delete this.connectionsInUse[id]
    connection.setIdSeq(undefined)
  }

  /**
   * Runs handle checked in idle connection.
   * @returns {Promise<void>} - Resolves once idle reaping has been scheduled or run.
   */
  async handleCheckedInIdleConnection() {
    if (this.idleTimeoutMillis() === 0) {
      await this.reapIdleConnections()
    } else {
      this.scheduleIdleConnectionReaper()
    }
  }

  /**
   * Runs checkout.
   * @param {import("./base.js").ConnectionCheckoutOptions} [options] - Checkout options.
   * @returns {Promise<import("../drivers/base.js").default>} - Resolves with the checkout.
   */
  async checkout(options = {}) {
    const databaseConfig = this.getConfiguration()
    const reuseKey = this.getConfigurationReuseKey()
    let connection = this.takeIdleConnectionForReuseKey(reuseKey)

    if (connection) return await this.activateConnection(connection, options)

    await this.reapIdleConnections()
    connection = this.takeIdleConnectionForReuseKey(reuseKey)

    if (connection) return await this.activateConnection(connection, options)

    if (this.canSpawnConnection()) {
      // Spawn via spawnConnection() so the tenant-aware configuration is resolved FRESH at
      // spawn time for the current caller. Reusing the databaseConfig captured at the top of
      // checkout() could bind the connection to a stale tenant/database, which breaks
      // per-request isolation (e.g. test truncation appearing not to take effect). The queued
      // path below keeps the waiting caller's captured config via waitForCheckout().
      connection = await this.spawnConnectionForCheckout(this.getConfiguration(), this.getConfigurationReuseKey())

      return await this.activateConnection(connection, options)
    }

    return await this.waitForCheckout(databaseConfig, reuseKey, options)
  }

  /**
   * Runs take idle connection for reuse key.
   * @param {string} reuseKey - Database configuration reuse key.
   * @param {object} [args] - Options.
   * @param {boolean} [args.includeOpenTransactions] - Whether connections with open transactions may be returned.
   * @returns {import("../drivers/base.js").default | undefined} - Matching idle connection.
   */
  takeIdleConnectionForReuseKey(reuseKey, {includeOpenTransactions = true} = {}) {
    const connectionIndex = this.connections.findIndex((queuedConnection) => {
      if (!includeOpenTransactions && this.connectionHasOpenTransaction(queuedConnection)) return false

      return this.connectionMatchesReuseKey(queuedConnection, reuseKey)
    })
    const connection = connectionIndex === -1 ? undefined : this.connections.splice(connectionIndex, 1)[0]

    return connection
  }

  /**
   * Runs connection matches reuse key.
   * @param {import("../drivers/base.js").default} connection - Connection.
   * @param {string} reuseKey - Database configuration reuse key.
   * @returns {boolean} - Whether the connection matches the reuse key.
   */
  connectionMatchesReuseKey(connection, reuseKey) {
    const connectionWithPoolKey = /** @type {import("../drivers/base.js").default & {[POOL_CONFIGURATION_KEY]?: string}} */ (connection)

    return connectionWithPoolKey[POOL_CONFIGURATION_KEY] === reuseKey
  }

  /**
   * Runs activate connection.
   * @param {import("../drivers/base.js").default} connection - Connection.
   * @param {import("./base.js").ConnectionCheckoutOptions} [options] - Checkout options.
   * @returns {Promise<import("../drivers/base.js").default>} - Activated connection.
   */
  async activateConnection(connection, options = {}) {
    if (connection.getIdSeq() !== undefined) throw new Error(`Connection already has an ID-seq - is it in use? ${connection.getIdSeq()}`)

    const id = this.idSeq++

    const trackedConnection = /** @type {import("../drivers/base.js").default & {[CONNECTION_CHECKED_OUT_AT]?: number, [IDLE_CONNECTION_CHECKED_IN_AT]?: number}} */ (connection)
    delete trackedConnection[IDLE_CONNECTION_CHECKED_IN_AT]
    trackedConnection[CONNECTION_CHECKED_OUT_AT] = Date.now()

    connection.setIdSeq(id)
    this.connectionsInUse[id] = connection

    try {
      await connection.setConnectionCheckoutName(options.name)
    } catch (error) {
      delete this.connectionsInUse[id]
      connection.setIdSeq(undefined)
      await this.closeConnection(connection)

      throw error
    }

    return connection
  }

  /**
   * Runs max connections.
   * @returns {number | null} - Configured max live connections.
   */
  maxConnections() {
    const value = this.getConfiguration().pool?.max

    if (value === null) return null
    if (this.validMaxConnections(value)) return value

    return DEFAULT_MAX_CONNECTIONS
  }

  /**
   * Runs checkout timeout millis.
   * @returns {number | null} - Pending checkout timeout in milliseconds, or null when disabled.
   */
  checkoutTimeoutMillis() {
    const value = this.getConfiguration().pool?.checkoutTimeoutMillis

    if (value === null) return null
    if (this.validCheckoutTimeoutMillis(value)) return value

    return DEFAULT_CHECKOUT_TIMEOUT_MILLIS
  }

  /**
   * Runs valid checkout timeout millis.
   * @param {?} value - Candidate checkout timeout.
   * @returns {value is number} - Whether the value is a valid timeout.
   */
  validCheckoutTimeoutMillis(value) {
    return typeof value === "number" && Number.isFinite(value) && value >= 0
  }

  /**
   * Runs valid max connections.
   * @param {?} value - Candidate max connection count.
   * @returns {value is number} - Whether the value is a valid max connection count.
   */
  validMaxConnections(value) {
    return typeof value === "number" && Number.isFinite(value) && value >= 1
  }

  /**
   * Runs live connection count.
   * @returns {number} - Number of live and in-progress connections.
   */
  liveConnectionCount() {
    const connections = new Set([
      ...this.connections,
      ...Object.values(this.connectionsInUse),
      this.getGlobalConnectionForIdentifier()
    ].filter(Boolean))

    return connections.size + this.connectionsBeingSpawned
  }

  /**
   * Runs can spawn connection.
   * @returns {boolean} - Whether a new connection can be spawned.
   */
  canSpawnConnection() {
    const maxConnections = this.maxConnections()

    return maxConnections === null || this.liveConnectionCount() < maxConnections
  }

  /**
   * Runs spawn connection for checkout.
   * @param {import("../../configuration-types.js").DatabaseConfigurationType} databaseConfig - Resolved database config for the checkout.
   * @param {string} reuseKey - Database configuration reuse key for the checkout.
   * @returns {Promise<import("../drivers/base.js").default>} - Spawned connection.
   */
  async spawnConnectionForCheckout(databaseConfig, reuseKey) {
    this.connectionsBeingSpawned++

    try {
      const connection = await this.spawnConnectionWithConfiguration(databaseConfig)
      const connectionWithPoolKey = /** @type {import("../drivers/base.js").default & {[POOL_CONFIGURATION_KEY]?: string}} */ (connection)

      connectionWithPoolKey[POOL_CONFIGURATION_KEY] = reuseKey
      connection.setSchemaCacheInvalidator(() => {
        this.clearSchemaCache()
        this.configuration.clearSchemaCachesForReuseKey(reuseKey)
      })

      return connection
    } finally {
      this.connectionsBeingSpawned--
    }
  }

  /**
   * Runs wait for checkout.
   * @param {import("../../configuration-types.js").DatabaseConfigurationType} databaseConfig - Resolved database config for the checkout.
   * @param {string} reuseKey - Database configuration reuse key.
   * @param {import("./base.js").ConnectionCheckoutOptions} [options] - Checkout options.
   * @returns {Promise<import("../drivers/base.js").default>} - Resolves with an activated connection.
   */
  async waitForCheckout(databaseConfig, reuseKey, options = {}) {
    return await new Promise((resolve, reject) => {
      const enqueuedAt = Date.now()
      const timeoutMillis = this.checkoutTimeoutMillis()
      /** @type {PendingCheckout} */
      const checkout = {
        databaseConfig,
        enqueuedAt,
        options,
        reject,
        resolve,
        reuseKey,
        timeoutAt: timeoutMillis === null ? null : enqueuedAt + timeoutMillis,
        timeoutMillis,
        timeoutTimer: undefined
      }

      checkout.timeoutTimer = this.startPendingCheckoutTimeout(checkout)
      this.pendingCheckouts.push(checkout)
      void this.drainPendingCheckouts().catch((error) => {
        const checkoutError = error instanceof Error ? error : new Error("Failed to drain pending database connection checkouts.", {cause: error})

        this.rejectPendingCheckouts(checkoutError)
      })
    })
  }

  /**
   * Runs drain pending checkouts.
   * @returns {Promise<void>} - Resolves when pending checkouts have been drained as far as possible.
   */
  async drainPendingCheckouts() {
    if (this.pendingCheckoutDrainPromise) {
      await this.pendingCheckoutDrainPromise
      return
    }

    this.pendingCheckoutDrainPromise = this.drainPendingCheckoutsActual()

    try {
      await this.pendingCheckoutDrainPromise
    } finally {
      this.pendingCheckoutDrainPromise = undefined
    }
  }

  /**
   * Runs drain pending checkouts actual.
   * @returns {Promise<void>} - Resolves when pending checkouts have been drained as far as possible.
   */
  async drainPendingCheckoutsActual() {
    while (this.pendingCheckouts.length > 0) {
      if (await this.resolvePendingCheckoutWithMatchingIdleConnection()) continue

      const checkout = this.pendingCheckouts[0]

      if (await this.closeIdleConnectionForPendingCheckoutCapacity(checkout)) continue
      if (!this.pendingCheckouts.includes(checkout)) continue
      if (this.canSpawnConnection()) {
        this.removePendingCheckoutAt(0)
        await this.spawnAndResolvePendingCheckout(checkout)
        continue
      }

      const reapedConnection = await this.idleConnectionForPendingCheckout(checkout)

      if (!this.pendingCheckouts.includes(checkout)) continue
      if (!reapedConnection) return

      this.removePendingCheckoutAt(0)
      await this.resolvePendingCheckout(checkout, reapedConnection)
    }
  }

  /**
   * Runs resolve pending checkout with matching idle connection.
   * @returns {Promise<boolean>} - Whether a pending checkout was resolved with an idle connection.
   */
  async resolvePendingCheckoutWithMatchingIdleConnection() {
    for (let index = 0; index < this.pendingCheckouts.length; index++) {
      const checkout = this.pendingCheckouts[index]
      const connection = this.takeIdleConnectionForReuseKey(checkout.reuseKey, {includeOpenTransactions: false})

      if (!connection) continue

      this.removePendingCheckoutAt(index)
      await this.resolvePendingCheckout(checkout, connection)

      return true
    }

    return false
  }

  /**
   * Runs remove pending checkout at.
   * @param {number} index - Pending checkout index.
   * @returns {PendingCheckout} - Removed checkout.
   */
  removePendingCheckoutAt(index) {
    const checkout = this.pendingCheckouts.splice(index, 1)[0]

    this.clearPendingCheckoutTimeout(checkout)

    return checkout
  }

  /**
   * Runs start pending checkout timeout.
   * @param {PendingCheckout} checkout - Pending checkout to time out.
   * @returns {ReturnType<typeof setTimeout> | undefined} - Timer, if timeout is enabled.
   */
  startPendingCheckoutTimeout(checkout) {
    if (checkout.timeoutMillis === null) return undefined

    const timer = setTimeout(() => {
      this.timeoutPendingCheckout(checkout)
    }, checkout.timeoutMillis)

    return timer
  }

  /**
   * Runs timeout pending checkout.
   * @param {PendingCheckout} checkout - Pending checkout to reject.
   * @returns {void}
   */
  timeoutPendingCheckout(checkout) {
    const index = this.pendingCheckouts.indexOf(checkout)

    if (index === -1) return

    this.removePendingCheckoutAt(index)
    checkout.reject(this.pendingCheckoutTimeoutError(checkout))
  }

  /**
   * Runs pending checkout timeout error.
   * @param {PendingCheckout} checkout - Timed-out checkout.
   * @returns {Error} - Timeout error.
   */
  pendingCheckoutTimeoutError(checkout) {
    const checkoutName = checkout.options.name ? ` Checkout name: ${JSON.stringify(checkout.options.name)}.` : ""
    const diagnostics = this.pendingCheckoutTimeoutDiagnostics(checkout)

    return new Error(`Timed out after ${checkout.timeoutMillis}ms waiting for database connection checkout from pool "${this.identifier}".${checkoutName} ${diagnostics}`)
  }

  /**
   * Builds sanitized diagnostics for a checkout timeout.
   * @param {PendingCheckout} checkout - Timed-out checkout.
   * @returns {string} - Pool state summary.
   */
  pendingCheckoutTimeoutDiagnostics(checkout) {
    const snapshot = this.getDebugSnapshot()
    const connectionSummaries = snapshot.connections
      .map((connection) => this.pendingCheckoutTimeoutConnectionSummary(connection))
      .join(", ")
    const pendingSummaries = (snapshot.pendingCheckouts || [])
      .map((pendingCheckout) => this.pendingCheckoutTimeoutPendingSummary(pendingCheckout))
      .join(", ")
    const waitedForMs = Math.max(0, Date.now() - checkout.enqueuedAt)

    return `Pool state: max=${this.maxConnections() ?? "unbounded"}, inUse=${snapshot.inUseCount}, idle=${snapshot.idleCount}, pending=${snapshot.pendingCheckoutCount}, spawning=${snapshot.connectionsBeingSpawned}, timedOutWaitingForMs=${waitedForMs}, holders=[${connectionSummaries}], waiting=[${pendingSummaries}].`
  }

  /**
   * Builds a sanitized connection summary for checkout timeout diagnostics.
   * @param {Record<string, ?>} connection - Connection debug snapshot.
   * @returns {string} - Sanitized connection state.
   */
  pendingCheckoutTimeoutConnectionSummary(connection) {
    const parts = [`state=${connection.state}`]

    if (connection.checkoutName) parts.push(`checkout=${JSON.stringify(connection.checkoutName)}`)
    if (typeof connection.checkedOutForMs === "number") parts.push(`checkedOutForMs=${connection.checkedOutForMs}`)
    if (typeof connection.idleForMs === "number") parts.push(`idleForMs=${connection.idleForMs}`)
    if (typeof connection.openTransactions === "number") parts.push(`openTransactions=${connection.openTransactions}`)

    const activeQuery = connection.activeQuery

    if (activeQuery && typeof activeQuery === "object" && !Array.isArray(activeQuery)) {
      const runningMs = (/** @type {Record<string, ?>} */ (activeQuery)).runningMs

      if (typeof runningMs === "number") parts.push(`activeQueryMs=${runningMs}`)
    }

    return `{${parts.join(" ")}}`
  }

  /**
   * Builds a sanitized pending checkout summary for checkout timeout diagnostics.
   * @param {import("./base.js").DatabasePoolPendingCheckoutDebugSnapshot} pendingCheckout - Waiting checkout snapshot.
   * @returns {string} - Sanitized pending checkout state.
   */
  pendingCheckoutTimeoutPendingSummary(pendingCheckout) {
    const parts = [`index=${pendingCheckout.index}`, `waitingForMs=${pendingCheckout.waitingForMs}`]

    if (pendingCheckout.checkoutName) parts.push(`checkout=${JSON.stringify(pendingCheckout.checkoutName)}`)
    if (pendingCheckout.remainingTimeoutMs !== null) parts.push(`remainingTimeoutMs=${pendingCheckout.remainingTimeoutMs}`)

    return `{${parts.join(" ")}}`
  }

  /**
   * Runs clear pending checkout timeout.
   * @param {PendingCheckout} checkout - Pending checkout.
   * @returns {void}
   */
  clearPendingCheckoutTimeout(checkout) {
    if (!checkout.timeoutTimer) return

    clearTimeout(checkout.timeoutTimer)
    checkout.timeoutTimer = undefined
  }

  /**
   * Runs close idle connection for pending checkout capacity.
   * @param {PendingCheckout} checkout - Checkout waiting for a connection.
   * @returns {Promise<boolean>} - Whether an idle connection was closed to free capacity.
   */
  async closeIdleConnectionForPendingCheckoutCapacity(checkout) {
    const connection = this.findIdleConnectionForReuseKey(checkout.reuseKey)

    if (connection) return false

    await this.reapIdleConnections()

    if (this.findIdleConnectionForReuseKey(checkout.reuseKey)) return false

    return this.canSpawnConnection() ? false : await this.closeOneIdleConnectionForCapacity()
  }

  /**
   * Runs find idle connection for reuse key.
   * @param {string} reuseKey - Database configuration reuse key.
   * @returns {import("../drivers/base.js").default | undefined} - Matching idle connection, if present.
   */
  findIdleConnectionForReuseKey(reuseKey) {
    return this.connections.find((connection) => !this.connectionHasOpenTransaction(connection) && this.connectionMatchesReuseKey(connection, reuseKey))
  }

  /**
   * Runs idle connection for pending checkout.
   * @param {PendingCheckout} checkout - Checkout waiting for a connection.
   * @returns {Promise<import("../drivers/base.js").default | undefined>} - Matching idle connection, if one can be reused.
   */
  async idleConnectionForPendingCheckout(checkout) {
    let connection = this.takeIdleConnectionForReuseKey(checkout.reuseKey, {includeOpenTransactions: false})

    if (connection) return connection

    await this.reapIdleConnections()
    if (!this.pendingCheckouts.includes(checkout)) return

    connection = this.takeIdleConnectionForReuseKey(checkout.reuseKey, {includeOpenTransactions: false})

    return connection
  }

  /**
   * Runs spawn and resolve pending checkout.
   * @param {PendingCheckout} checkout - Checkout request to resolve.
   * @returns {Promise<void>} - Resolves when the checkout has been handled.
   */
  async spawnAndResolvePendingCheckout(checkout) {
    let connection

    try {
      connection = await this.spawnConnectionForCheckout(checkout.databaseConfig, checkout.reuseKey)
    } catch (error) {
      checkout.reject(error instanceof Error ? error : new Error("Failed to spawn database connection.", {cause: error}))
      return
    }

    await this.resolvePendingCheckout(checkout, connection)
  }

  /**
   * Runs resolve pending checkout.
   * @param {PendingCheckout} checkout - Checkout request to resolve.
   * @param {import("../drivers/base.js").default} connection - Connection to activate.
   * @returns {Promise<void>} - Resolves when the checkout has been handled.
   */
  async resolvePendingCheckout(checkout, connection) {
    try {
      checkout.resolve(await this.activateConnection(connection, checkout.options))
    } catch (error) {
      checkout.reject(error instanceof Error ? error : new Error("Failed to activate database connection.", {cause: error}))
    }
  }

  /**
   * Runs close one idle connection for capacity.
   * @returns {Promise<boolean>} - Whether an idle connection was closed to free capacity.
   */
  async closeOneIdleConnectionForCapacity() {
    const connection = this.connections.find((candidate) => !this.connectionHasOpenTransaction(candidate))

    if (!connection) return false

    this.connections = this.connections.filter((candidate) => candidate !== connection)
    await this.closeConnection(connection)

    return true
  }

  /**
   * Runs with connection.
   * @template T
   * @param {import("./base.js").ConnectionCheckoutOptions | function(import("../drivers/base.js").default) : Promise<T>} optionsOrCallback - Checkout options or callback to invoke with the connection.
   * @param {function(import("../drivers/base.js").default) : Promise<T>} [callback] - Callback to invoke with the connection.
   * @returns {Promise<T>} - Resolves with the callback result.
   */
  async withConnection(optionsOrCallback, callback) {
    const options = typeof optionsOrCallback == "function" ? {} : optionsOrCallback
    const actualCallback = typeof optionsOrCallback == "function" ? optionsOrCallback : callback

    if (!actualCallback) throw new Error("withConnection requires a callback")

    const connection = await this.checkout(options)
    const id = connection.getIdSeq()

    return await this.asyncLocalStorage.run(id, async () => {
      try {
        return await actualCallback(connection)
      } finally {
        await this.checkin(connection)
      }
    })
  }

  /**
   * Runs get current connection.
   * @returns {import("../drivers/base.js").default} - The current connection.
   */
  getCurrentConnection() {
    const id = this.asyncLocalStorage.getStore()

    if (id === undefined) return this.currentFallbackConnectionOrFail()

    this.ensureConnectionIsInUse(id)

    const currentConnection = this.connectionsInUse[id]

    if (!currentConnection) {
      throw new Error(`Couldn't get current connection from that ID: ${id}`)
    }

    return currentConnection
  }

  /**
   * Runs current fallback connection or fail.
   * @returns {import("../drivers/base.js").default} - Fallback connection, if present.
   */
  currentFallbackConnectionOrFail() {
    const fallbackConnection = this.getGlobalConnection()

    if (fallbackConnection) return fallbackConnection

    throw new Error("ID hasn't been set for this async context")
  }

  /**
   * Runs ensure connection is in use.
   * @param {number} id - Checked-out connection id.
   * @returns {void}
   */
  ensureConnectionIsInUse(id) {
    if (!(id in this.connectionsInUse)) {
      throw new Error(`Connection ${id} doesn't exist any more - has it been checked in again?`)
    }
  }

  /**
   * Registers a fallback connection for this pool identifier that will be used when no async context is available.
   * @param {import("../drivers/base.js").default} connection - Connection.
   * @returns {void} - No return value.
   */
  setGlobalConnection(connection) {
    const klass = /** @type {typeof VelociousDatabasePoolAsyncTrackedMultiConnection} */ (this.constructor)
    let mapForConfiguration = klass.globalConnections.get(this.configuration)

    if (!mapForConfiguration) {
      mapForConfiguration = {}
      klass.globalConnections.set(this.configuration, mapForConfiguration)
    }

    mapForConfiguration[this.identifier] = connection
  }

  /**
   * Ensures a global fallback connection exists for this pool identifier and returns it.
   * If one is already set, it is returned and also made available in the pool queue.
   * Otherwise a new connection is spawned, registered, and queued.
   * @returns {Promise<import("../drivers/base.js").default>} - Resolves with the global connection.
   */
  async ensureGlobalConnection() {
    const existing = this.getGlobalConnection()

    if (existing) return existing

    const connection = await this.spawnConnection()

    this.setGlobalConnection(connection)

    return connection
  }

  /**
   * Set a shared connection for test mode so that HTTP handlers running
   * in the same process can reuse the test runner's database connection.
   * @param {import("../drivers/base.js").default} connection - Shared connection.
   * @returns {void}
   */
  setTestSharedConnection(connection) {
    this._testSharedConnection = connection
  }

  /**
   * Runs clear test shared connection.
   * @returns {void} */
  clearTestSharedConnection() {
    this._testSharedConnection = undefined
  }

  /**
   * Returns the connection tied to the current async context, if any.
   * Falls back to the test shared connection when no async context exists.
   * @returns {import("../drivers/base.js").default | undefined} - The current context connection.
   */
  getCurrentContextConnection() {
    const id = this.asyncLocalStorage.getStore()

    if (id === undefined) return this._testSharedConnection

    return this.getCurrentConnection()
  }

  /**
   * Returns whether this pool has a real async context for the current connection.
   * @returns {boolean} - Whether nested code can reuse the current connection context.
   */
  hasCurrentConnectionContext() {
    return this.asyncLocalStorage.getStore() !== undefined
  }

  /**
   * Runs get debug snapshot.
   * @returns {import("./base.js").DatabasePoolDebugSnapshot} - Diagnostic snapshot for this pool.
   */
  getDebugSnapshot() {
    const snapshot = super.getDebugSnapshot()
    const now = Date.now()
    const {connections} = this.debugConnectionSnapshots(now)

    return {
      ...snapshot,
      connections,
      connectionsBeingSpawned: this.connectionsBeingSpawned,
      idleCount: this.connections.length,
      inUseCount: Object.keys(this.connectionsInUse).length,
      pendingCheckouts: this.pendingCheckoutDebugSnapshots(now),
      pendingCheckoutCount: this.pendingCheckouts.length
    }
  }

  /**
   * Runs debug connection snapshots.
   * @param {number} now - Current timestamp.
   * @returns {{connections: Array<Record<string, ?>>, seenConnections: Set<import("../drivers/base.js").default>}} - Connection snapshots and seen set.
   */
  debugConnectionSnapshots(now) {
    /**
     * Connections.
     * @type {Array<Record<string, ?>>} */
    const connections = []
    const seenConnections = new Set()

    this.addInUseDebugConnectionSnapshots({connections, now, seenConnections})
    this.addIdleDebugConnectionSnapshots({connections, now, seenConnections})
    this.addFallbackDebugConnectionSnapshots({connections, seenConnections})

    return {connections, seenConnections}
  }

  /**
   * Runs add in use debug connection snapshots.
   * @param {{connections: Array<Record<string, ?>>, now: number, seenConnections: Set<import("../drivers/base.js").default>}} args - Snapshot collection state.
   * @returns {void}
   */
  addInUseDebugConnectionSnapshots({connections, now, seenConnections}) {
    for (const [id, connection] of Object.entries(this.connectionsInUse)) {
      const trackedConnection = /** @type {import("../drivers/base.js").default & {[CONNECTION_CHECKED_OUT_AT]?: number}} */ (connection)
      const checkedOutAt = trackedConnection[CONNECTION_CHECKED_OUT_AT]
      const checkedOutForMs = typeof checkedOutAt === "number" ? Math.max(0, now - checkedOutAt) : undefined

      seenConnections.add(connection)
      connections.push(this.debugConnectionSnapshot(connection, {checkedOutAt, checkedOutForMs, checkoutId: id, state: "in-use"}))
    }
  }

  /**
   * Runs add idle debug connection snapshots.
   * @param {{connections: Array<Record<string, ?>>, now: number, seenConnections: Set<import("../drivers/base.js").default>}} args - Snapshot collection state.
   * @returns {void}
   */
  addIdleDebugConnectionSnapshots({connections, now, seenConnections}) {
    for (const connection of this.connections) {
      if (seenConnections.has(connection)) continue

      seenConnections.add(connection)

      const trackedConnection = /** @type {import("../drivers/base.js").default & {[IDLE_CONNECTION_CHECKED_IN_AT]?: number}} */ (connection)
      const checkedInAt = trackedConnection[IDLE_CONNECTION_CHECKED_IN_AT]
      const idleForMs = typeof checkedInAt === "number" ? Math.max(0, now - checkedInAt) : undefined

      connections.push(this.debugConnectionSnapshot(connection, {checkedInAt, idleForMs, state: "idle"}))
    }
  }

  /**
   * Runs add fallback debug connection snapshots.
   * @param {{connections: Array<Record<string, ?>>, seenConnections: Set<import("../drivers/base.js").default>}} args - Snapshot collection state.
   * @returns {void}
   */
  addFallbackDebugConnectionSnapshots({connections, seenConnections}) {
    this.addDebugConnectionSnapshotIfUnseen({connection: this.getGlobalConnectionForIdentifier(), connections, reapable: false, seenConnections, state: "global"})
    this.addDebugConnectionSnapshotIfUnseen({connection: this._testSharedConnection, connections, reapable: false, seenConnections, state: "test-shared"})
  }

  /**
   * Runs add debug connection snapshot if unseen.
   * @param {{connection: import("../drivers/base.js").default | undefined, connections: Array<Record<string, ?>>, reapable?: boolean, seenConnections: Set<import("../drivers/base.js").default>, state: string}} args - Snapshot collection state.
   * @returns {void}
   */
  addDebugConnectionSnapshotIfUnseen({connection, connections, reapable, seenConnections, state}) {
    if (!connection || seenConnections.has(connection)) return

    seenConnections.add(connection)
    connections.push(this.debugConnectionSnapshot(connection, {reapable, state}))
  }

  /**
   * Runs pending checkout debug snapshots.
   * @param {number} now - Current timestamp.
   * @returns {import("./base.js").DatabasePoolPendingCheckoutDebugSnapshot[]} - Pending checkout snapshots.
   */
  pendingCheckoutDebugSnapshots(now) {
    return this.pendingCheckouts.map((checkout, index) => ({
      checkoutName: checkout.options.name,
      enqueuedAt: checkout.enqueuedAt,
      index,
      remainingTimeoutMs: checkout.timeoutAt === null ? null : Math.max(0, checkout.timeoutAt - now),
      reuseKey: checkout.reuseKey,
      timeoutAt: checkout.timeoutAt,
      timeoutMillis: checkout.timeoutMillis,
      waitingForMs: Math.max(0, now - checkout.enqueuedAt)
    }))
  }

  /**
   * Runs get global connection.
   * @returns {import("../drivers/base.js").default | undefined} - The global connection.
   */
  getGlobalConnection() {
    const connection = this.getGlobalConnectionForIdentifier()

    if (!connection) return
    if (!this.connectionMatchesCurrentConfiguration(connection)) return

    return connection
  }

  /**
   * Runs get global connection for identifier.
   * @returns {import("../drivers/base.js").default | undefined} - The global connection for this pool identifier.
   */
  getGlobalConnectionForIdentifier() {
    const klass = /** @type {typeof VelociousDatabasePoolAsyncTrackedMultiConnection} */ (this.constructor)
    const mapForConfiguration = klass.globalConnections.get(this.configuration)

    return mapForConfiguration?.[this.identifier]
  }

  /**
   * Runs clear global connection for identifier.
   * @returns {void} - No return value.
   */
  clearGlobalConnectionForIdentifier() {
    const klass = /** @type {typeof VelociousDatabasePoolAsyncTrackedMultiConnection} */ (this.constructor)
    const mapForConfiguration = klass.globalConnections.get(this.configuration)

    if (!mapForConfiguration) return

    delete mapForConfiguration[this.identifier]
  }

  /**
   * Clears schema metadata cached by every live connection owned by this pool.
   * @returns {void} - No return value.
   */
  clearSchemaCache() {
    const connections = new Set([
      ...this.connections,
      ...Object.values(this.connectionsInUse),
      this.getGlobalConnection(),
      this._testSharedConnection
    ].filter(Boolean))

    for (const connection of connections) {
      if (connection) this._clearConnectionSchemaCache(connection)
    }
  }

  /**
   * Runs idle timeout millis.
   * @returns {number | null} - Idle timeout in milliseconds, or null when disabled.
   */
  idleTimeoutMillis() {
    const value = this.getConfiguration().pool?.idleTimeoutMillis

    if (value === null) return null
    if (this.validIdleTimeoutMillis(value)) return value

    return DEFAULT_IDLE_TIMEOUT_MILLIS
  }

  /**
   * Runs valid idle timeout millis.
   * @param {?} value - Candidate idle timeout value.
   * @returns {value is number} - Whether the value is a valid idle timeout.
   */
  validIdleTimeoutMillis(value) {
    return typeof value === "number" && Number.isFinite(value) && value >= 0
  }

  /**
   * Runs schedule idle connection reaper.
   * @returns {void} */
  scheduleIdleConnectionReaper() {
    if (this.idleConnectionReaperTimer) return
    if (!this.hasIdleConnectionsToReap()) return

    const delay = this.nextIdleConnectionReapDelay(/** @type {number} */ (this.idleTimeoutMillis()))

    this.idleConnectionReaperTimer = setTimeout(() => {
      this.idleConnectionReaperTimer = undefined
      void this.reapIdleConnections().catch((error) => {
        this.logger.warn(() => ["Failed to reap idle database connections:", error])
      })
    }, delay)

    if (typeof this.idleConnectionReaperTimer.unref === "function") {
      this.idleConnectionReaperTimer.unref()
    }
  }

  /**
   * Runs has idle connections to reap.
   * @returns {boolean} - Whether an idle reaper timer should be scheduled.
   */
  hasIdleConnectionsToReap() {
    return this.connections.length > 0 && this.idleTimeoutMillis() !== null
  }

  /**
   * Runs next idle connection reap delay.
   * @param {number} idleTimeoutMillis - Idle timeout in milliseconds.
   * @returns {number} - Delay before the next reap.
   */
  nextIdleConnectionReapDelay(idleTimeoutMillis) {
    let delay = idleTimeoutMillis
    const now = Date.now()

    for (const connection of this.connections) {
      if (this.connectionHasOpenTransaction(connection)) continue

      const trackedConnection = /** @type {import("../drivers/base.js").default & {[IDLE_CONNECTION_CHECKED_IN_AT]?: number}} */ (connection)
      const checkedInAt = trackedConnection[IDLE_CONNECTION_CHECKED_IN_AT]

      if (typeof checkedInAt !== "number") continue

      delay = Math.min(delay, Math.max(0, idleTimeoutMillis - (now - checkedInAt)))
    }

    return delay
  }

  /**
   * Closes idle checked-in connections that have exceeded the configured timeout.
   * @returns {Promise<void>} - Resolves when complete.
   */
  async reapIdleConnections() {
    if (this.connections.length === 0) return

    const idleTimeoutMillis = this.idleTimeoutMillis()

    if (idleTimeoutMillis === null) return

    const {expiredConnections, keptConnections} = this.classifyIdleConnectionsForReaping({idleTimeoutMillis, now: Date.now()})

    this.connections = keptConnections
    await this.closeExpiredIdleConnections(expiredConnections)
    await this.awaitInflightConnectionCloses()
    if (this.connections.length > 0) this.scheduleIdleConnectionReaper()
  }

  /**
   * Runs close expired idle connections.
   * @param {import("../drivers/base.js").default[]} expiredConnections - Connections to close.
   * @returns {Promise<void>} - Resolves when closed.
   */
  async closeExpiredIdleConnections(expiredConnections) {
    for (const connection of expiredConnections) {
      await this.closeConnection(connection)
    }
  }

  /**
   * Runs await inflight connection closes.
   * @returns {Promise<void>} - Resolves once in-flight connection closes settle.
   */
  async awaitInflightConnectionCloses() {
    if (this.inflightConnectionCloses.size > 0) {
      await Promise.allSettled([...this.inflightConnectionCloses])
    }
  }

  /**
   * Runs classify idle connections for reaping.
   * @param {{idleTimeoutMillis: number, now: number}} args - Reaper classification inputs.
   * @returns {{expiredConnections: import("../drivers/base.js").default[], keptConnections: import("../drivers/base.js").default[]}} - Classified idle connections.
   */
  classifyIdleConnectionsForReaping({idleTimeoutMillis, now}) {
    /**
     * Kept connections.
     * @type {import("../drivers/base.js").default[]} */
    const keptConnections = []
    /**
     * Expired connections.
     * @type {import("../drivers/base.js").default[]} */
    const expiredConnections = []

    for (const connection of this.connections) {
      this.classifyIdleConnectionForReaping({connection, expiredConnections, idleTimeoutMillis, keptConnections, now})
    }

    return {expiredConnections, keptConnections}
  }

  /**
   * Runs classify idle connection for reaping.
   * @param {{connection: import("../drivers/base.js").default, expiredConnections: import("../drivers/base.js").default[], idleTimeoutMillis: number, keptConnections: import("../drivers/base.js").default[], now: number}} args - Classification state.
   * @returns {void}
   */
  classifyIdleConnectionForReaping({connection, expiredConnections, idleTimeoutMillis, keptConnections, now}) {
    if (this.connectionIsClosed(connection)) return
    if (this.connectionHasOpenTransaction(connection)) {
      keptConnections.push(connection)
      return
    }

    const target = this.idleConnectionExpired({connection, idleTimeoutMillis, now}) ? expiredConnections : keptConnections

    target.push(connection)
  }

  /**
   * Runs connection is closed.
   * @param {import("../drivers/base.js").default} connection - Connection to inspect.
   * @returns {boolean} - Whether the connection is marked closed.
   */
  connectionIsClosed(connection) {
    const trackedConnection = /** @type {import("../drivers/base.js").default & {[CLOSED_CONNECTION]?: boolean}} */ (connection)

    return Boolean(trackedConnection[CLOSED_CONNECTION])
  }

  /**
   * Runs idle connection expired.
   * @param {{connection: import("../drivers/base.js").default, idleTimeoutMillis: number, now: number}} args - Expiry inputs.
   * @returns {boolean} - Whether the idle connection expired.
   */
  idleConnectionExpired({connection, idleTimeoutMillis, now}) {
    const trackedConnection = /** @type {import("../drivers/base.js").default & {[IDLE_CONNECTION_CHECKED_IN_AT]?: number}} */ (connection)
    const checkedInAt = trackedConnection[IDLE_CONNECTION_CHECKED_IN_AT]

    return typeof checkedInAt === "number" && now - checkedInAt >= idleTimeoutMillis
  }

  /**
   * Runs connection has open transaction.
   * @param {import("../drivers/base.js").default} connection - Connection to inspect.
   * @returns {boolean} - Whether the connection has an open transaction.
   */
  connectionHasOpenTransaction(connection) {
    return connection._transactionsCount > 0
  }

  /**
   * Rolls back any transaction a previous holder left open before a connection
   * re-enters the idle pool. A connection returned to the pool with an open
   * transaction would otherwise be handed to an unrelated checkout, whose
   * startTransaction() then fails with "A transaction is already running" and
   * poisons every following caller that reuses it.
   * @param {import("../drivers/base.js").default} connection - Connection being checked in.
   * @returns {Promise<void>} - Resolves when the connection holds no open transaction.
   */
  async rollbackLeftOpenTransaction(connection) {
    if (!this.connectionHasOpenTransaction(connection)) return

    this.logger.warn(() => [`Rolling back a transaction left open on a connection being checked in (identifier=${this.identifier}).`])

    while (this.connectionHasOpenTransaction(connection)) {
      await connection.rollbackTransaction()
    }
  }

  /**
   * Runs close connection.
   * @param {import("../drivers/base.js").default} connection - Connection to close.
   * @returns {Promise<void>} - Resolves when complete.
   */
  async closeConnection(connection) {
    // Idempotent: a fire-and-forget scheduled reap and an explicit reap can both
    // target the same connection. Await the in-flight close instead of closing
    // twice (which can throw on the driver) or returning while the underlying
    // handle is still open.
    const existingClose = this.connectionClosePromises.get(connection)

    if (existingClose) {
      return await existingClose
    }

    const trackedConnection = /** @type {import("../drivers/base.js").default & {[CLOSED_CONNECTION]?: boolean, [CONNECTION_CHECKED_OUT_AT]?: number, [IDLE_CONNECTION_CHECKED_IN_AT]?: number}} */ (connection)

    trackedConnection[CLOSED_CONNECTION] = true
    delete trackedConnection[CONNECTION_CHECKED_OUT_AT]
    delete trackedConnection[IDLE_CONNECTION_CHECKED_IN_AT]

    const closePromise = (async () => {
      await trackedConnection.close()
    })()

    this.connectionClosePromises.set(connection, closePromise)
    this.inflightConnectionCloses.add(closePromise)

    try {
      await closePromise
    } finally {
      this.inflightConnectionCloses.delete(closePromise)
    }
  }

  /**
   * Runs clear idle connection reaper timer.
   * @returns {void} */
  clearIdleConnectionReaperTimer() {
    if (!this.idleConnectionReaperTimer) return

    clearTimeout(this.idleConnectionReaperTimer)
    this.idleConnectionReaperTimer = undefined
  }

  /**
   * Closes all active and cached connections for this pool.
   * @returns {Promise<void>} - Resolves when complete.
   */
  async closeAll() {
    this.clearIdleConnectionReaperTimer()
    this.rejectPendingCheckouts(new Error("Database pool was closed before checkout completed."))

    const connections = new Set([
      ...this.connections,
      ...Object.values(this.connectionsInUse),
      this.getGlobalConnectionForIdentifier(),
      this._testSharedConnection
    ].filter(Boolean))

    this.connections = []
    this.connectionsInUse = {}
    this._testSharedConnection = undefined
    this.clearGlobalConnectionForIdentifier()

    for (const connection of connections) {
      if (!connection) continue

      await this.closeConnection(connection)
    }

  }

  /**
   * Runs reject pending checkouts.
   * @param {Error} error - Error to reject pending checkouts with.
   * @returns {void}
   */
  rejectPendingCheckouts(error) {
    const pendingCheckouts = this.pendingCheckouts

    this.pendingCheckouts = []

    for (const checkout of pendingCheckouts) {
      this.clearPendingCheckoutTimeout(checkout)
      checkout.reject(error)
    }
  }

  /**
   * Replaces all globally registered fallback connections.
   * @param {Record<string, import("../drivers/base.js").default>} [connections] - Connections.
   * @param {import("../../configuration.js").default} [configuration] - Configuration instance.
   * @returns {void} - No return value.
   */
  static setGlobalConnections(connections, configuration) {
    if (!configuration) {
      this.globalConnections = new WeakMap()
      return
    }

    this.globalConnections.set(configuration, connections || {})
  }

  /**
   * Clears globally registered fallback connections for all configurations or a single configuration.
   * @param {import("../../configuration.js").default} [configuration] - Configuration instance.
   * @returns {void} - No return value.
   */
  static clearGlobalConnections(configuration) {
    if (!configuration) {
      this.globalConnections = new WeakMap()
      return
    }

    this.globalConnections.delete(configuration)
  }
}
