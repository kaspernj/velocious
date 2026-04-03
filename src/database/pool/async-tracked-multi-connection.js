// @ts-check

import {AsyncLocalStorage} from "async_hooks"
import BasePool from "./base.js"

export const CLOSED_CONNECTION = Symbol("velociousClosedConnection")

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

  /** @type {import("../drivers/base.js").default[]} */
  connections = []

  /** @type {Record<number, import("../drivers/base.js").default>} */
  connectionsInUse = {}

  idSeq = 0

  /**
   * @param {object} args - Options object.
   * @param {import("../../configuration.js").default} args.configuration - Configuration instance.
   * @param {string} args.identifier - Identifier.
   */
  constructor({configuration, identifier}) {
    super({configuration, identifier})
  }

  /** @param {import("../drivers/base.js").default} connection - Database connection instance. */
  checkin(connection) {
    const id = connection.getIdSeq()

    if (typeof id !== "number") {
      throw new Error(`idSeq on connection wasn't set? '${typeof id}' = ${id}`)
    }

    if (id in this.connectionsInUse) {
      delete this.connectionsInUse[id]
    }

    connection.setIdSeq(undefined)

    const trackedConnection = /** @type {import("../drivers/base.js").default & {[CLOSED_CONNECTION]?: boolean}} */ (connection)

    if (trackedConnection[CLOSED_CONNECTION]) return

    this.connections.push(connection)

  }

  /** @returns {Promise<import("../drivers/base.js").default>} - Resolves with the checkout.  */
  async checkout() {
    const connectionIndex = this.connections.findIndex((queuedConnection) => this.connectionMatchesCurrentConfiguration(queuedConnection))
    let connection = connectionIndex === -1 ? undefined : this.connections.splice(connectionIndex, 1)[0]

    if (!connection) {
      connection = await this.spawnConnection()
    }

    if (connection.getIdSeq() !== undefined) throw new Error(`Connection already has an ID-seq - is it in use? ${connection.getIdSeq()}`)

    const id = this.idSeq++

    connection.setIdSeq(id)
    this.connectionsInUse[id] = connection

    return connection
  }

  /**
   * @template T
   * @param {function(import("../drivers/base.js").default) : Promise<T>} callback - Callback to invoke with the connection.
   * @returns {Promise<T>} - Resolves with the callback result.
   */
  async withConnection(callback) {
    const connection = await this.checkout()
    const id = connection.getIdSeq()

    return await this.asyncLocalStorage.run(id, async () => {
      try {
        return await callback(connection)
      } finally {
        this.checkin(connection)
      }
    })
  }

  /** @returns {import("../drivers/base.js").default} - The current connection.  */
  getCurrentConnection() {
    const id = this.asyncLocalStorage.getStore()

    if (id === undefined) {
      const fallbackConnection = this.getGlobalConnection()

      if (fallbackConnection) {
        return fallbackConnection
      }

      throw new Error("ID hasn't been set for this async context")
    }

    if (!(id in this.connectionsInUse)) {
      throw new Error(`Connection ${id} doesn't exist any more - has it been checked in again?`)
    }

    const currentConnection = this.connectionsInUse[id]

    if (!currentConnection) {
      throw new Error(`Couldn't get current connection from that ID: ${id}`)
    }

    return currentConnection
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

  /** @returns {void} */
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
   * @returns {import("../drivers/base.js").default | undefined} - The global connection.
   */
  getGlobalConnection() {
    const klass = /** @type {typeof VelociousDatabasePoolAsyncTrackedMultiConnection} */ (this.constructor)
    const mapForConfiguration = klass.globalConnections.get(this.configuration)
    const connection = mapForConfiguration?.[this.identifier]

    if (!connection) return
    if (!this.connectionMatchesCurrentConfiguration(connection)) return

    return connection
  }

  /**
   * Closes all active and cached connections for this pool.
   * @returns {Promise<void>} - Resolves when complete.
   */
  async closeAll() {
    const connections = new Set([
      ...this.connections,
      ...Object.values(this.connectionsInUse),
      this.getGlobalConnection()
    ].filter(Boolean))

    this.connections = []
    this.connectionsInUse = {}

    for (const connection of connections) {
      if (!connection) continue

      const trackedConnection = /** @type {import("../drivers/base.js").default & {[CLOSED_CONNECTION]?: boolean}} */ (connection)
      trackedConnection[CLOSED_CONNECTION] = true

      if (typeof trackedConnection.close === "function") {
        await trackedConnection.close()
      } else if (typeof trackedConnection.disconnect === "function") {
        await trackedConnection.disconnect()
      }
    }

  }

  /**
   * Replaces all globally registered fallback connections.
   * @param {Record<string, import("../drivers/base.js").default>} [connections] - Connections.
   * @param {import("../../configuration.js").default} [configuration] - Configuration instance.
   * @returns {void} - No return value.
   */
  static setGlobalConnections(connections, configuration) {
    if (!connections && !configuration) {
      this.globalConnections = new WeakMap()
      return
    }

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
