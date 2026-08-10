// @ts-check

import BasePool from "./base.js"
import OperationLease from "../operation-lease.js"

/**
 * SinglePoolConnectionEntry type.
 * @typedef {object} SinglePoolConnectionEntry
 * @property {number} activeCheckoutCount - Active users of the connection.
 * @property {string[]} checkoutNames - Nested checkout names.
 * @property {import("../drivers/base.js").default} connection - Owned driver.
 * @property {boolean} lifecycleRetained - Whether frontend tenant lifecycle ownership retains this entry.
 * @property {boolean} retained - Whether normal ambient use retains this idle entry.
 * @property {string} reuseKey - Physical configuration reuse key.
 */
/**
 * SinglePoolPendingCheckout type.
 * @typedef {object} SinglePoolPendingCheckout
 * @property {string | undefined} checkoutName - Checkout name.
 * @property {Promise<void>} [closePromise] - Rejects if closeAll owns cancellation.
 * @property {number} enqueuedAt - Enqueue timestamp.
 * @property {(error: Error) => void} reject - Rejects a capacity waiter during closeAll.
 * @property {string} reuseKey - Physical configuration reuse key.
 * @property {number | null} timeoutAt - Timeout timestamp.
 * @property {number | null} timeoutMillis - Configured timeout.
 */

const DEFAULT_MAX_CONNECTIONS = 10
const DEFAULT_CHECKOUT_TIMEOUT_MILLIS = 10000

export default class VelociousDatabasePoolSingleMultiUser extends BasePool {
  activeCheckoutCount = 0
  suppressedConnectionContextCount = 0
  operationLeaseQueue = Promise.resolve()
  connectionsBeingSpawned = 0

  /** @type {Map<string, SinglePoolConnectionEntry>} */
  connectionEntries = new Map()
  /** @type {Map<string, Promise<SinglePoolConnectionEntry>>} */
  connectionEntrySpawnPromises = new Map()
  /** @type {Map<string, Promise<void>>} */
  capturedOperationQueues = new Map()
  /** @type {SinglePoolPendingCheckout[]} */
  pendingCheckouts = []
  /** @type {Set<() => boolean>} */
  capacityWaiters = new Set()
  closeGeneration = 0

  /**
   * Checks a connection back into its keyed physical entry.
   * @param {import("../drivers/base.js").default} connection - Connection.
   * @returns {Promise<void>} - Resolves when cleanup completes.
   */
  async checkin(connection) {
    const entry = this.entryForConnection(connection)

    if (!entry || entry.activeCheckoutCount < 1) return

    entry.activeCheckoutCount--
    entry.checkoutNames.pop()
    this.activeCheckoutCount--

    if (entry.activeCheckoutCount > 0) {
      await connection.setConnectionCheckoutName(entry.checkoutNames[entry.checkoutNames.length - 1])
      return
    }

    try {
      await connection.releaseHeldAdvisoryLocks()
      await connection.clearConnectionCheckoutName()
    } catch (error) {
      try {
        await this.removeAndCloseEntry(entry)
      } catch (closeError) {
        throw new AggregateError([error, closeError], "Database checkout cleanup and connection close both failed", {cause: closeError})
      }
      throw error
    }

    if (!entry.lifecycleRetained && (!entry.retained || this.capacityWaiters.size > 0)) await this.removeAndCloseEntry(entry)
  }

  /**
   * Checks out the ambient configuration and retains it as the single mutable
   * browser fallback connection.
   * @param {import("./base.js").ConnectionCheckoutOptions} [options] - Checkout options.
   * @returns {Promise<import("../drivers/base.js").default>} - Checked-out connection.
   */
  async checkout(options = {}) {
    return await this.checkoutForConfiguration(this.getConfiguration(), options, {retain: true})
  }

  /**
   * Checks out an explicitly captured physical configuration.
   * @param {import("../../configuration-types.js").DatabaseConfigurationType} databaseConfiguration - Captured configuration.
   * @param {import("./base.js").ConnectionCheckoutOptions} options - Checkout options.
   * @param {{retain: boolean}} args - Whether this becomes the ambient retained connection.
   * @returns {Promise<import("../drivers/base.js").default>} - Checked-out connection.
   */
  async checkoutForConfiguration(databaseConfiguration, options, {retain}) {
    const reuseKey = this.getConfigurationReuseKey(databaseConfiguration)
    let entry = this.connectionEntries.get(reuseKey)

    if (!entry) {
      let spawnPromise = this.connectionEntrySpawnPromises.get(reuseKey)
      let waitedForCapacityReservation = false

      if (!spawnPromise) {
        if (this.capacityWaiters.size === 0 && this.tryReserveConnectionCapacity(databaseConfiguration)) {
          spawnPromise = this.spawnConnectionEntry(databaseConfiguration, reuseKey, this.closeGeneration)
          this.connectionEntrySpawnPromises.set(reuseKey, spawnPromise)
        } else {
          await this.reserveConnectionCapacity(databaseConfiguration, {name: options.name, reuseKey})
          waitedForCapacityReservation = true
        }

        entry = this.connectionEntries.get(reuseKey)
        spawnPromise = this.connectionEntrySpawnPromises.get(reuseKey)

        if (!entry && !spawnPromise) {
          spawnPromise = this.spawnConnectionEntry(databaseConfiguration, reuseKey, this.closeGeneration)
          this.connectionEntrySpawnPromises.set(reuseKey, spawnPromise)
        } else if (waitedForCapacityReservation) {
          this.releaseConnectionCapacityReservation()
        }
      }

      if (!entry && spawnPromise) {
        try {
          entry = await spawnPromise
        } finally {
          if (this.connectionEntrySpawnPromises.get(reuseKey) === spawnPromise) {
            this.connectionEntrySpawnPromises.delete(reuseKey)
          }
        }
      }
    }
    if (!entry) throw new Error("Database connection entry was not created")

    if (retain) {
      const previousConnection = this.connection

      entry.retained = true
      this.connection = entry.connection

      if (previousConnection && previousConnection !== entry.connection) {
        const previousEntry = this.entryForConnection(previousConnection)

        if (previousEntry) {
          previousEntry.retained = false
          if (previousEntry.activeCheckoutCount === 0 && !previousEntry.lifecycleRetained) await this.removeAndCloseEntry(previousEntry)
        }
      }
    }

    entry.checkoutNames.push(options.name || "")
    await entry.connection.setConnectionCheckoutName(options.name)
    entry.activeCheckoutCount++
    this.activeCheckoutCount++

    return entry.connection
  }

  /**
   * Ensures capacity exists for another physical connection.
   * @param {import("../../configuration-types.js").DatabaseConfigurationType} databaseConfiguration - Requested configuration.
   * @param {{name?: string, reuseKey: string}} options - Pending checkout identity.
   * @returns {Promise<void>} - Resolves when capacity is available.
   */
  async reserveConnectionCapacity(databaseConfiguration, options) {
    while (true) {
      const idleEntry = [...this.connectionEntries.values()].find((entry) => entry.activeCheckoutCount === 0 && !entry.lifecycleRetained)

      if (idleEntry) {
        await this.removeAndCloseEntry(idleEntry)
        continue
      }

      await this.waitForCapacity(databaseConfiguration, options)
      return
    }
  }

  /**
   * Waits for pool capacity with normal timeout and closeAll ownership.
   * @param {import("../../configuration-types.js").DatabaseConfigurationType} databaseConfiguration - Requested configuration.
   * @param {{name?: string, reuseKey: string}} options - Pending checkout identity.
   * @returns {Promise<void>} - Resolves on a capacity change.
   */
  async waitForCapacity(databaseConfiguration, options) {
    const timeoutMillis = this.checkoutTimeoutMillis(databaseConfiguration)
    const enqueuedAt = Date.now()

    await new Promise((resolve, reject) => {
      /** @type {ReturnType<typeof setTimeout> | undefined} */
      let timer
      const finish = () => {
        if (timer) clearTimeout(timer)
        this.capacityWaiters.delete(capacityAvailable)
        this.removePendingCheckout(pending)
      }
      const capacityAvailable = () => {
        if (!this.tryReserveConnectionCapacity(databaseConfiguration)) return false

        finish()
        resolve(undefined)

        return true
      }
      /** @type {SinglePoolPendingCheckout} */
      const pending = {
        checkoutName: options.name,
        enqueuedAt,
        reject: (error) => {
          finish()
          reject(error)
        },
        reuseKey: options.reuseKey,
        timeoutAt: timeoutMillis === null ? null : enqueuedAt + timeoutMillis,
        timeoutMillis
      }

      this.pendingCheckouts.push(pending)
      this.capacityWaiters.add(capacityAvailable)

      if (timeoutMillis !== null) {
        timer = setTimeout(() => {
          pending.reject(new Error(`Timed out waiting for database connection checkout after ${timeoutMillis}ms.`))
        }, timeoutMillis)
      }
    })
  }

  /**
   * Runs with connection.
   * @template T
   * @param {import("./base.js").ConnectionCheckoutOptions | ((arg: import("../drivers/base.js").default) => Promise<T>)} optionsOrCallback - Options or callback.
   * @param {(arg: import("../drivers/base.js").default) => Promise<T>} [callback] - Callback.
   * @returns {Promise<T>} - Callback result.
   */
  async withConnection(optionsOrCallback, callback) {
    const options = typeof optionsOrCallback == "function" ? {} : optionsOrCallback
    const actualCallback = typeof optionsOrCallback == "function" ? optionsOrCallback : callback

    if (!actualCallback) throw new Error("withConnection requires a callback")

    const connection = await this.checkout(options)

    try {
      return await actualCallback(connection)
    } finally {
      await this.checkin(connection)
    }
  }

  async openCapturedConnection(/** @type {import("../../configuration-types.js").DatabaseConfigurationType} */ databaseConfiguration) {
    const connection = await this.checkoutForConfiguration(databaseConfiguration, {name: "Frontend tenant SQLite open"}, {retain: false})
    const entry = this.entryForConnection(connection)
    if (!entry) throw new Error("Frontend tenant SQLite connection entry disappeared during open")
    entry.lifecycleRetained = true
    await this.checkin(connection)
  }

  async flushCapturedConnection(/** @type {import("../../configuration-types.js").DatabaseConfigurationType} */ databaseConfiguration) {
    const entry = this.connectionEntries.get(this.getConfigurationReuseKey(databaseConfiguration))
    if (entry) await entry.connection.flushPendingWrites()
  }

  async closeCapturedConnection(/** @type {import("../../configuration-types.js").DatabaseConfigurationType} */ databaseConfiguration) {
    const entry = this.connectionEntries.get(this.getConfigurationReuseKey(databaseConfiguration))
    if (!entry) return
    if (entry.activeCheckoutCount > 0) throw new Error("Cannot close an in-use frontend tenant SQLite handle")
    await this.removeAndCloseEntry(entry)
  }

  async deleteCapturedDatabase(/** @type {import("../../configuration-types.js").DatabaseConfigurationType} */ databaseConfiguration) {
    await this.closeCapturedConnection(databaseConfiguration)
    const DriverClass = databaseConfiguration.driver || this.driverClass
    if (!DriverClass) throw new Error("No driver class configured for frontend tenant SQLite deletion")
    const driver = new DriverClass(databaseConfiguration, this.configuration)
    await driver.deleteDatabaseStorage()
  }

  capturedConnectionInUse(/** @type {import("../../configuration-types.js").DatabaseConfigurationType} */ databaseConfiguration) {
    const entry = this.connectionEntries.get(this.getConfigurationReuseKey(databaseConfiguration))
    return Boolean(entry && entry.activeCheckoutCount > 0)
  }

  capturedConnectionHasPendingWrites(/** @type {import("../../configuration-types.js").DatabaseConfigurationType} */ databaseConfiguration) {
    const entry = this.connectionEntries.get(this.getConfigurationReuseKey(databaseConfiguration))
    return Boolean(entry?.connection.hasPendingWrites())
  }

  /**
   * Runs a legacy ambient operation under one pool-wide FIFO lease.
   * @template T
   * @param {import("./base.js").ConnectionCheckoutOptions} options - Checkout options.
   * @param {(connection: import("../drivers/base.js").default, owner: symbol) => Promise<T>} callback - Callback.
   * @returns {Promise<T>} - Callback result.
   */
  async withOperationConnection(options, callback) {
    const previousLease = this.operationLeaseQueue
    let releaseQueue = () => {}
    const queueTurn = new Promise((resolve) => { releaseQueue = () => resolve(undefined) })

    this.operationLeaseQueue = previousLease.then(async () => await queueTurn)
    await previousLease

    try {
      const databaseConfiguration = this.getConfiguration()

      return await this.runOwnedOperation(databaseConfiguration, options, {retain: true}, callback)
    } finally {
      releaseQueue()
    }
  }

  /**
   * Runs a captured operation under a FIFO lease scoped only to its physical
   * database identity, so unrelated tenant databases remain concurrent.
   * @template T
   * @param {import("./base.js").CapturedConnectionOptions} options - Captured options.
   * @param {(connection: import("../drivers/base.js").default, owner: symbol) => Promise<T>} callback - Callback.
   * @returns {Promise<T>} - Callback result.
   */
  async withCapturedOperationConnection({databaseConfiguration, name}, callback) {
    const reuseKey = this.getConfigurationReuseKey(databaseConfiguration)
    const previousTurn = this.capturedOperationQueues.get(reuseKey) || Promise.resolve()
    let releaseTurn = () => {}
    const turn = new Promise((resolve) => { releaseTurn = () => resolve(undefined) })
    const queueTail = previousTurn.then(async () => await turn)
    const wasQueued = this.capturedOperationQueues.has(reuseKey)
    const pending = wasQueued ? this.addOperationPendingCheckout(databaseConfiguration, {name, reuseKey}) : undefined

    this.capturedOperationQueues.set(reuseKey, queueTail)

    try {
      await this.waitForOperationTurn(previousTurn, pending)

      return await this.runOwnedOperation(databaseConfiguration, {name}, {retain: false}, callback)
    } finally {
      if (pending) this.removePendingCheckout(pending)
      releaseTurn()
      void queueTail.finally(() => {
        if (this.capturedOperationQueues.get(reuseKey) === queueTail) this.capturedOperationQueues.delete(reuseKey)
      })
    }
  }

  /**
   * Runs one callback with an installed driver operation lease.
   * @template T
   * @param {import("../../configuration-types.js").DatabaseConfigurationType} databaseConfiguration - Physical configuration.
   * @param {import("./base.js").ConnectionCheckoutOptions} options - Checkout options.
   * @param {{retain: boolean}} checkoutArgs - Checkout retention.
   * @param {(connection: import("../drivers/base.js").default, owner: symbol) => Promise<T>} callback - Callback.
   * @returns {Promise<T>} - Callback result.
   */
  async runOwnedOperation(databaseConfiguration, options, checkoutArgs, callback) {
    const owner = Symbol("single-pool-operation-owner")
    const operationLease = new OperationLease(owner)
    const connection = await this.checkoutForConfiguration(databaseConfiguration, options, checkoutArgs)
    let operationLeaseInstalled = false

    try {
      await connection.setOperationLease(operationLease)
      operationLeaseInstalled = true

      return await callback(connection, owner)
    } finally {
      operationLease.release()

      try {
        if (operationLeaseInstalled) connection.clearOperationLease(operationLease)
      } finally {
        await this.checkin(connection)
      }
    }
  }

  /**
   * Waits for a same-physical-database operation queue turn.
   * @param {Promise<void>} previousTurn - Previous queue tail.
   * @param {SinglePoolPendingCheckout | undefined} pending - Pending debug entry.
   * @returns {Promise<void>} - Resolves when the previous turn releases.
   */
  async waitForOperationTurn(previousTurn, pending) {
    if (!pending) {
      await previousTurn
      return
    }

    if (pending.timeoutMillis === null) {
      await new Promise((resolve, reject) => {
        previousTurn.then(resolve, reject)
        pending.closePromise?.catch(reject)
      })
      return
    }

    const timeoutMillis = pending.timeoutMillis

    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`Timed out waiting for database connection checkout after ${timeoutMillis}ms.`)), timeoutMillis)

      previousTurn.then(() => {
        clearTimeout(timer)
        resolve(undefined)
      }, (error) => {
        clearTimeout(timer)
        reject(error)
      })
      pending.closePromise?.catch((error) => {
        clearTimeout(timer)
        reject(error)
      })
    })
  }

  /**
   * Runs without current connection context.
   * @template T
   * @param {() => T} callback - Callback.
   * @returns {T} - Callback result.
   */
  withoutCurrentConnectionContext(callback) {
    this.suppressedConnectionContextCount += 1

    try {
      const result = callback()

      if (result instanceof Promise) {
        return /** @type {T} */ (result.finally(() => { this.suppressedConnectionContextCount -= 1 }))
      }

      this.suppressedConnectionContextCount -= 1
      return result
    } catch (error) {
      this.suppressedConnectionContextCount -= 1
      throw error
    }
  }

  /** Clears schema metadata on every live physical connection. */
  clearSchemaCache() {
    for (const entry of this.connectionEntries.values()) this._clearConnectionSchemaCache(entry.connection)
  }

  /** Closes every pool-owned connection and rejects queued capacity requests. */
  async closeAll() {
    const closeError = new Error("Database pool was closed before checkout completed.")

    this.closeGeneration++

    for (const pending of [...this.pendingCheckouts]) pending.reject(closeError)
    this.notifyCapacityWaiters()
    await Promise.allSettled([...this.connectionEntrySpawnPromises.values()])

    const entries = [...this.connectionEntries.values()]

    this.connectionEntries.clear()
    this.connectionEntrySpawnPromises.clear()
    this.connection = undefined
    this.activeCheckoutCount = 0

    for (const entry of entries) await entry.connection.close()
  }

  /**
   * Returns the mutable ambient fallback connection.
   * @returns {import("../drivers/base.js").default} - Mutable ambient fallback connection.
   */
  getCurrentConnection() {
    if (!this.connection) throw new Error("A connection hasn't been made yet")

    return this.connection
  }

  /**
   * Returns the current context fallback connection when it is not suppressed.
   * @returns {import("../drivers/base.js").default | undefined} - Current fallback connection.
   */
  getCurrentContextConnection() {
    if (this.suppressedConnectionContextCount > 0) return undefined

    return this.connection
  }

  /**
   * Returns whether fallback context is available.
   * @returns {boolean} - Whether fallback context is available.
   */
  hasCurrentConnectionContext() {
    return this.suppressedConnectionContextCount === 0
  }

  /**
   * Returns pool diagnostics for retained and temporary keyed connections.
   * @returns {import("./base.js").DatabasePoolDebugSnapshot} - Pool diagnostics.
   */
  getDebugSnapshot() {
    const connections = [...this.connectionEntries.values()].map((entry) => this.debugConnectionSnapshot(entry.connection, {
      activeCheckoutCount: entry.activeCheckoutCount,
      state: entry.activeCheckoutCount > 0 ? "in-use" : entry.lifecycleRetained ? "lifecycle-retained" : entry.retained ? "shared" : "idle"
    }))
    const now = Date.now()

    return {
      ...super.getDebugSnapshot(),
      connections,
      connectionsBeingSpawned: this.connectionsBeingSpawned,
      idleCount: [...this.connectionEntries.values()].filter((entry) => entry.activeCheckoutCount === 0).length,
      inUseCount: [...this.connectionEntries.values()].filter((entry) => entry.activeCheckoutCount > 0).length,
      pendingCheckouts: this.pendingCheckouts.map((pending, index) => ({
        checkoutName: pending.checkoutName,
        enqueuedAt: pending.enqueuedAt,
        index,
        remainingTimeoutMs: pending.timeoutAt === null ? null : Math.max(0, pending.timeoutAt - now),
        reuseKey: pending.reuseKey,
        timeoutAt: pending.timeoutAt,
        timeoutMillis: pending.timeoutMillis,
        waitingForMs: Math.max(0, now - pending.enqueuedAt)
      })),
      pendingCheckoutCount: this.pendingCheckouts.length
    }
  }

  /**
   * Returns the configured connection maximum.
   * @param {import("../../configuration-types.js").DatabaseConfigurationType} databaseConfiguration - Physical configuration.
   * @returns {number | null} - Configured connection maximum.
   */
  maxConnections(databaseConfiguration) {
    const value = databaseConfiguration.pool?.max

    if (value === null) return null
    if (typeof value === "number" && Number.isFinite(value) && value >= 1) return value

    return DEFAULT_MAX_CONNECTIONS
  }

  /**
   * Returns the configured checkout timeout.
   * @param {import("../../configuration-types.js").DatabaseConfigurationType} databaseConfiguration - Physical configuration.
   * @returns {number | null} - Configured checkout timeout.
   */
  checkoutTimeoutMillis(databaseConfiguration) {
    const value = databaseConfiguration.pool?.checkoutTimeoutMillis

    if (value === null) return null
    if (typeof value === "number" && Number.isFinite(value) && value >= 0) return value

    return DEFAULT_CHECKOUT_TIMEOUT_MILLIS
  }

  /**
   * Returns whether another physical connection may be spawned.
   * @param {import("../../configuration-types.js").DatabaseConfigurationType} databaseConfiguration - Physical configuration.
   * @returns {boolean} - Whether another physical connection may be spawned.
   */
  canSpawnConnection(databaseConfiguration) {
    const max = this.maxConnections(databaseConfiguration)

    return max === null || this.connectionEntries.size + this.connectionsBeingSpawned < max
  }

  /**
   * Atomically claims one connection slot without yielding.
   * @param {import("../../configuration-types.js").DatabaseConfigurationType} databaseConfiguration - Physical configuration whose maximum applies.
   * @returns {boolean} - Whether a slot was reserved.
   */
  tryReserveConnectionCapacity(databaseConfiguration) {
    if (!this.canSpawnConnection(databaseConfiguration)) return false

    this.connectionsBeingSpawned++

    return true
  }

  /** Releases one previously claimed connection slot. */
  releaseConnectionCapacityReservation() {
    if (this.connectionsBeingSpawned < 1) {
      throw new Error("Cannot release an unreserved database connection slot")
    }

    this.connectionsBeingSpawned--
    this.notifyCapacityWaiters()
  }

  /**
   * Spawns and tracks a physical connection entry.
   * @param {import("../../configuration-types.js").DatabaseConfigurationType} databaseConfiguration - Physical configuration.
   * @param {string} reuseKey - Physical reuse key.
   * @param {number} closeGeneration - Pool lifecycle generation at spawn start.
   * @returns {Promise<SinglePoolConnectionEntry>} - New entry.
   */
  async spawnConnectionEntry(databaseConfiguration, reuseKey, closeGeneration) {
    try {
      const connection = await this.spawnConnectionForConfiguration(databaseConfiguration)

      if (this.closeGeneration !== closeGeneration) {
        await connection.close()
        throw new Error("Database pool was closed before checkout completed.")
      }

      /** @type {SinglePoolConnectionEntry} */
      const entry = {activeCheckoutCount: 0, checkoutNames: [], connection, lifecycleRetained: false, retained: false, reuseKey}

      this.connectionEntries.set(reuseKey, entry)

      return entry
    } finally {
      this.releaseConnectionCapacityReservation()
    }
  }

  /**
   * Removes and closes an entry.
   * @param {import("../drivers/base.js").default} connection - Connection.
   * @returns {SinglePoolConnectionEntry | undefined} - Entry owning a connection.
   */
  entryForConnection(connection) {
    return [...this.connectionEntries.values()].find((entry) => entry.connection === connection)
  }

  /**
   * Adds a same-key operation pending entry.
   * @param {SinglePoolConnectionEntry} entry - Entry to close.
   * @returns {Promise<void>} - Resolves after close.
   */
  async removeAndCloseEntry(entry) {
    if (this.connectionEntries.get(entry.reuseKey) !== entry) return

    this.connectionEntries.delete(entry.reuseKey)
    if (this.connection === entry.connection) this.connection = undefined
    await entry.connection.close()
    this.notifyCapacityWaiters()
  }

  /** Wakes all capacity waiters to re-check the bounded pool. */
  notifyCapacityWaiters() {
    for (const reserveAndResolve of this.capacityWaiters) {
      if (reserveAndResolve()) return
    }
  }

  /**
   * Adds a same-key operation pending entry.
   * @param {import("../../configuration-types.js").DatabaseConfigurationType} databaseConfiguration - Physical configuration.
   * @param {{name?: string, reuseKey: string}} options - Pending identity.
   * @returns {SinglePoolPendingCheckout} - Added same-key operation pending entry.
   */
  addOperationPendingCheckout(databaseConfiguration, {name, reuseKey}) {
    const timeoutMillis = this.checkoutTimeoutMillis(databaseConfiguration)
    const enqueuedAt = Date.now()
    /**
     * Rejects the close-owned promise.
     * @type {(error: Error) => void}
     */
    let rejectClose = () => {}
    const closePromise = new Promise((resolve, reject) => {
      void resolve
      rejectClose = reject
    })
    const pending = {
      checkoutName: name,
      closePromise,
      enqueuedAt,
      reject: rejectClose,
      reuseKey,
      timeoutAt: timeoutMillis === null ? null : enqueuedAt + timeoutMillis,
      timeoutMillis
    }

    this.pendingCheckouts.push(pending)

    return pending
  }

  /**
   * Removes a pending checkout debug entry.
   * @param {SinglePoolPendingCheckout} pending - Pending entry.
   * @returns {void}
   */
  removePendingCheckout(pending) {
    const index = this.pendingCheckouts.indexOf(pending)

    if (index !== -1) this.pendingCheckouts.splice(index, 1)
  }
}
