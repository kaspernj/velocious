// @ts-check

import { randomBytes, timingSafeEqual } from "node:crypto"
import { createServer } from "node:http"
import { EventEmitter } from "node:events"
import { WebSocketServer } from "ws"
import { decodeBrokerValue, encodeBrokerValue } from "./shared-transaction-codec.js"
import { clearSharedTransactionCoordinator, setSharedTransactionCoordinator } from "./shared-transaction-connection-coordinator.js"

/** @typedef {{queue: Promise<void>, rootSessions: Set<import("ws").WebSocket>, lease?: {operations: Promise<void>, release: () => void, savePointName: string, socket: import("ws").WebSocket}}} ConnectionState */

const ALLOWED_METHODS = new Set([
  "query",
  "affectedRows",
  "_queryActual",
  "_affectedRowsActual",
  "_startTransactionAction",
  "_commitTransactionAction",
  "_rollbackTransactionAction",
  "startSavePoint",
  "releaseSavePoint",
  "rollbackSavePoint",
  "getConnectionScopedValue",
  "rootTransactionStart",
  "rootTransactionRelease",
  "rootTransactionRollback"
])

/**
 * Compares a presented capability without leaking matching prefix timing.
 * @param {string} provided - Presented capability.
 * @param {string} expected - Active capability.
 * @returns {boolean} - Whether the capabilities match.
 */
function capabilityMatches(provided, expected) {
  const providedBytes = Buffer.from(provided)
  const expectedBytes = Buffer.from(expected)
  return providedBytes.length === expectedBytes.length && timingSafeEqual(providedBytes, expectedBytes)
}

/**
 * Adds broker ownership to decoded driver options.
 * @param {ReturnType<typeof JSON.parse>} value - Decoded options.
 * @param {symbol} operationOwner - Broker coordinator owner.
 * @returns {Record<string, ReturnType<typeof JSON.parse>> & {operationOwner: symbol}} - Owned options.
 */
function ownedOperationOptions(value, operationOwner) {
  if (value === undefined) return {operationOwner}
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("Shared transaction broker driver options must be an object")
  }

  const options = /** @type {Record<string, ReturnType<typeof JSON.parse>>} */ (value)

  return {...options, operationOwner}
}

export default class SharedTransactionBroker extends EventEmitter {
  /**
   * Creates a broker around parent-owned physical connections.
   * @param {{connections: Record<string, object>}} args - Parent-owned physical connections.
   */
  constructor({connections}) {
    super()
    this.connections = connections
    this.secret = randomBytes(32).toString("base64url")
    this.accepting = true
    /** @type {Map<object, ConnectionState>} */
    this.connectionStates = new Map()
    /** @type {Set<import("ws").WebSocket>} */
    this.sessions = new Set()
    /** @type {Map<import("ws").WebSocket, Promise<void>>} */
    this.sessionCleanup = new Map()
    /** @type {Array<Error>} */
    this.cleanupErrors = []
    /** @type {Promise<void> | undefined} */
    this.closePromise = undefined
    /** @type {Map<object, (callback: () => Promise<ReturnType<typeof JSON.parse>>) => Promise<ReturnType<typeof JSON.parse>>>} */
    this.connectionCoordinators = new Map()
    /** @type {Map<object, symbol>} */
    this.connectionCoordinatorOwners = new Map()
    for (const connection of new Set(Object.values(connections))) {
      /**
       * Serializes parent operations with child broker traffic.
       * @param {() => Promise<unknown>} callback - Parent operation.
       * @returns {Promise<unknown>} - Operation result.
       */
      const coordinator = async (callback) => await this.serialize(this.connectionState(connection), callback)
      this.connectionCoordinators.set(connection, coordinator)
      this.connectionCoordinatorOwners.set(connection, setSharedTransactionCoordinator(connection, coordinator))
    }
    this.httpServer = createServer()
    this.websocketServer = new WebSocketServer({server: this.httpServer, maxPayload: 16 * 1024 * 1024})
    this.websocketServer.on("connection", (socket) => {
      this.sessions.add(socket)
      socket.once("close", () => {
        this.sessions.delete(socket)
        this.scheduleSessionCleanup(socket)
      })
      socket.on("message", (data) => void this.handleRequest(socket, `${data}`))
    })
  }

  /**
   * Starts a broker on an ephemeral loopback port.
   * @param {{connections: Record<string, object>}} args - Parent-owned physical connections.
   * @returns {Promise<SharedTransactionBroker>} - Listening broker.
   */
  static async start(args) {
    const broker = new SharedTransactionBroker(args)
    await new Promise((resolve, reject) => {
      broker.httpServer.once("error", reject)
      broker.httpServer.listen({host: "127.0.0.1", port: 0}, () => resolve(undefined))
    })
    return broker
  }

  /**
   * Gets the loopback websocket address.
   * @returns {string} - Loopback websocket address.
   */
  address() {
    const address = this.httpServer.address()
    if (!address || typeof address === "string") throw new Error("Shared transaction broker is not listening")
    return `ws://127.0.0.1:${address.port}`
  }

  /**
   * Gets the per-attempt unguessable capability.
   * @returns {string} - Per-attempt unguessable capability.
   */
  capability() { return this.secret }

  /**
   * Validates and handles one request.
   * @param {import("ws").WebSocket} socket - Calling session.
   * @param {string} serialized - Request JSON.
   * @returns {Promise<void>} - Resolves after responding.
   */
  async handleRequest(socket, serialized) {
    let requestId = 0
    try {
      const request = /** @type {{requestId: number, capability: string, databaseIdentifier: string, method: string, args: import("./shared-transaction-codec.js").EncodedBrokerValue}} */ (JSON.parse(serialized))
      requestId = request.requestId
      if (!this.accepting) throw new Error("Shared transaction broker capability has been revoked")
      if (!capabilityMatches(request.capability, this.secret)) throw new Error("Unknown shared transaction broker capability")
      const connection = this.connections[request.databaseIdentifier]
      if (!connection) throw new Error(`Unknown shared transaction database identifier: ${request.databaseIdentifier}`)
      if (!ALLOWED_METHODS.has(request.method)) throw new Error(`Unsupported shared transaction broker method: ${request.method}`)
      const args = decodeBrokerValue(request.args)
      if (!Array.isArray(args)) throw new TypeError("Shared transaction broker arguments must be an array")
      this.emit("work-queued", {connection, databaseIdentifier: request.databaseIdentifier, method: request.method})
      const result = await this.runConnectionRequest({connection, method: request.method, savePointName: typeof args[0] === "string" ? args[0] : undefined, socket}, async () => {
        if (!this.accepting) throw new Error("Shared transaction broker capability has been revoked")
        if (request.method === "rootTransactionRollback") {
          await this.rollbackRootSavePoint(connection, /** @type {string} */ (args[0]))
          return undefined
        }
        const physicalMethod = request.method === "rootTransactionStart"
          ? "startSavePoint"
          : request.method === "rootTransactionRelease"
            ? "releaseSavePoint"
            : request.method === "rootTransactionRollback"
              ? "rollbackSavePoint"
              : request.method
        const connectionMethods = /** @type {Record<string, (...methodArgs: Array<ReturnType<typeof JSON.parse> | {operationOwner: symbol}>) => ReturnType<typeof JSON.parse>>} */ (connection)
        const method = connectionMethods[physicalMethod]
        if (typeof method !== "function") throw new Error(`Connection does not support shared transaction method: ${request.method}`)
        return await method.apply(connection, this.ownedMethodArgs({args, connection, method: physicalMethod}))
      })
      if (socket.readyState === socket.OPEN) socket.send(JSON.stringify({requestId, result: encodeBrokerValue(result)}))
    } catch (error) {
      const normalized = error instanceof Error ? error : new Error(String(error))
      if (socket.readyState === socket.OPEN) socket.send(JSON.stringify({requestId, error: encodeBrokerValue(normalized)}))
    }
  }

  /**
   * Adds the broker owner to public driver methods that re-enter coordinated query work.
   * @param {{args: Array<ReturnType<typeof JSON.parse>>, connection: object, method: string}} args - Physical invocation.
   * @returns {Array<ReturnType<typeof JSON.parse> | {operationOwner: symbol}>} - Owned method arguments.
   */
  ownedMethodArgs({args, connection, method}) {
    const operationOwner = this.connectionCoordinatorOwners.get(connection)

    if (!operationOwner) throw new Error("Shared transaction broker connection owner is missing")
    if (["_startTransactionAction", "_commitTransactionAction", "_rollbackTransactionAction"].includes(method)) {
      return [ownedOperationOptions(args[0], operationOwner)]
    }
    if (["query", "affectedRows", "startSavePoint", "releaseSavePoint", "rollbackSavePoint"].includes(method)) {
      return [args[0], ownedOperationOptions(args[1], operationOwner)]
    }

    return args
  }

  /**
   * Gets mutable serialization state for one physical connection.
   * @param {object} connection - Physical connection.
   * @returns {ConnectionState} - Connection state.
   */
  connectionState(connection) {
    let state = this.connectionStates.get(connection)
    if (!state) {
      state = {queue: Promise.resolve(), rootSessions: new Set()}
      this.connectionStates.set(connection, state)
    }
    return state
  }

  /**
   * Runs a validated request with root transaction lease semantics.
   * @template T
   * @param {{connection: object, method: string, savePointName: string | undefined, socket: import("ws").WebSocket}} args - Request identity.
   * @param {() => Promise<T>} callback - Physical operation.
   * @returns {Promise<T>} - Operation result.
   */
  async runConnectionRequest({connection, method, savePointName, socket}, callback) {
    const state = this.connectionState(connection)
    if (method === "rootTransactionStart") {
      if (!savePointName) throw new Error("Shared transaction broker root transaction requires a savepoint name")
      return await this.startRootLease({callback, savePointName, state, socket})
    }
    if (method === "rootTransactionRelease" || method === "rootTransactionRollback") {
      return await this.finishRootLease({callback, savePointName, state, socket})
    }
    if (state.lease?.socket === socket) return await this.serializeLease(state.lease, callback)
    return await this.serialize(state, callback)
  }

  /**
   * Acquires the FIFO physical connection lease and holds the queue until end.
   * @template T
   * @param {{callback: () => Promise<T>, savePointName: string, state: ConnectionState, socket: import("ws").WebSocket}} args - Lease request.
   * @returns {Promise<T>} - Root savepoint start result.
   */
  async startRootLease({callback, savePointName, state, socket}) {
    if (state.rootSessions.has(socket)) throw new Error("Shared transaction broker root transaction is already active for this session")
    state.rootSessions.add(socket)
    const previous = state.queue
    /**
     * Resolves the start response.
     * @type {(value: T) => void}
     */
    let resolveStarted = () => {}
    /**
     * Rejects the start response.
     * @type {(error: Error) => void}
     */
    let rejectStarted = () => {}
    const started = new Promise((resolve, reject) => { resolveStarted = resolve; rejectStarted = reject })
    /**
     * Releases the held connection queue.
     * @type {(value?: void) => void}
     */
    let release = () => {}
    const held = new Promise((resolve) => { release = resolve })

    state.queue = previous.then(async () => {
      try {
        if (!this.accepting || socket.readyState !== socket.OPEN) throw new Error("Shared transaction broker root transaction session closed before lease acquisition")
        const result = await callback()
        state.lease = {operations: Promise.resolve(), release, savePointName, socket}
        resolveStarted(result)
        await held
      } catch (error) {
        state.rootSessions.delete(socket)
        rejectStarted(error instanceof Error ? error : new Error(String(error)))
      }
    })
    return await started
  }

  /**
   * Finishes the calling session's root lease.
   * @template T
   * @param {{callback: () => Promise<T>, savePointName: string | undefined, state: ConnectionState, socket: import("ws").WebSocket}} args - Lease end request.
   * @returns {Promise<T>} - Savepoint end result.
   */
  async finishRootLease({callback, savePointName, state, socket}) {
    const lease = state.lease
    if (!lease || lease.socket !== socket) throw new Error("Shared transaction broker session does not own the root transaction lease")
    if (savePointName !== lease.savePointName) throw new Error("Shared transaction broker root transaction savepoint does not match its lease")
    try {
      return await this.serializeLease(lease, callback)
    } finally {
      state.lease = undefined
      state.rootSessions.delete(socket)
      lease.release()
    }
  }

  /**
   * Serializes operations belonging to the active lease holder.
   * @template T
   * @param {{operations: Promise<void>}} lease - Active lease.
   * @param {() => Promise<T>} callback - Operation.
   * @returns {Promise<T>} - Result.
   */
  async serializeLease(lease, callback) {
    const previous = lease.operations
    /**
     * Releases the holder operation queue.
     * @type {(value?: void) => void}
     */
    let release = () => {}
    const current = new Promise((resolve) => { release = resolve })
    lease.operations = previous.then(() => current)
    await previous
    try { return await callback() } finally { release() }
  }

  /**
   * Rolls back leases abandoned by a disconnected session.
   * @param {import("ws").WebSocket} socket - Disconnected session.
   * @returns {Promise<void>} - Resolves after all owned leases release.
   */
  async releaseDisconnectedLeases(socket) {
    /** @type {Array<Error>} */
    const errors = []
    for (const [connection, state] of this.connectionStates) {
      const lease = state.lease
      if (!lease || lease.socket !== socket) continue
      try {
        await this.serializeLease(lease, async () => {
          await this.rollbackRootSavePoint(connection, lease.savePointName)
        })
      } catch (error) {
        errors.push(error instanceof Error ? error : new Error(String(error)))
      } finally {
        state.lease = undefined
        state.rootSessions.delete(socket)
        lease.release()
      }
    }
    if (errors.length > 0) {
      throw new AggregateError(errors, `Shared transaction broker lease cleanup failed: ${errors.map((error) => error.message).join("; ")}`)
    }
  }

  /**
   * Tracks detached socket cleanup and records its failure for close().
   * @param {import("ws").WebSocket} socket - Closed session.
   * @returns {Promise<void>} - Settled tracked cleanup.
   */
  scheduleSessionCleanup(socket) {
    const existing = this.sessionCleanup.get(socket)
    if (existing) return existing
    const cleanup = this.releaseDisconnectedLeases(socket)
      .catch((error) => {
        this.cleanupErrors.push(error instanceof Error ? error : new Error(String(error)))
      })
      .finally(() => this.sessionCleanup.delete(socket))
    this.sessionCleanup.set(socket, cleanup)
    return cleanup
  }

  /**
   * Rolls back and removes a root savepoint so it cannot remain beneath the next lease.
   * @param {object} connection - Parent physical connection.
   * @param {string} savePointName - Root savepoint name.
   * @returns {Promise<void>} - Resolves after rollback and release.
   */
  async rollbackRootSavePoint(connection, savePointName) {
    const methods = /** @type {{releaseSavePoint: (name: string, options?: {operationOwner?: symbol}) => Promise<void>, rollbackSavePoint: (name: string, options?: {operationOwner?: symbol}) => Promise<void>}} */ (connection)
    const operationOwner = this.connectionCoordinatorOwners.get(connection)

    if (!operationOwner) throw new Error("Shared transaction broker connection owner is missing")
    /** @type {Array<Error>} */
    const errors = []
    try {
      await methods.rollbackSavePoint(savePointName, {operationOwner})
    } catch (error) {
      errors.push(error instanceof Error ? error : new Error(String(error)))
    }
    try {
      await methods.releaseSavePoint(savePointName, {operationOwner})
    } catch (error) {
      errors.push(error instanceof Error ? error : new Error(String(error)))
    }
    if (errors.length > 0) {
      throw new AggregateError(errors, `Shared transaction broker could not clean root savepoint ${savePointName}: ${errors.map((error) => error.message).join("; ")}`)
    }
  }

  /**
   * Serializes ordinary non-holder work through the connection FIFO.
   * @template T
   * @param {ConnectionState} state - Connection state.
   * @param {() => Promise<T>} callback - Work.
   * @returns {Promise<T>} - Work result.
   */
  async serialize(state, callback) {
    const previous = state.queue
    /**
     * Resolves the current queue entry.
     * @type {(value?: void) => void}
     */
    let release = () => {}
    const current = new Promise((resolve) => { release = resolve })
    const queued = previous.then(() => current)
    state.queue = queued
    await previous
    try {
      return await callback()
    } finally {
      release()
    }
  }

  /**
   * Stops admission, revokes capability, rejects clients, and drains active work.
   * @returns {Promise<void>} - Resolves after transport shutdown.
   */
  async close() {
    if (this.closePromise) return await this.closePromise
    this.closePromise = this.closeTransport()
    return await this.closePromise
  }

  /**
   * Performs deterministic transport shutdown and reports cleanup failures last.
   * @returns {Promise<void>} - Resolves after shutdown or rejects with cleanup errors.
   */
  async closeTransport() {
    this.accepting = false
    this.secret = randomBytes(32).toString("base64url")
    const closingSessions = Array.from(this.sessions)
    await Promise.all(closingSessions.map(async (socket) => await this.scheduleSessionCleanup(socket)))
    for (const socket of closingSessions) socket.close(1001, "Shared transaction broker closed")
    await Promise.allSettled(Array.from(this.connectionStates.values()).map((state) => state.queue))
    await new Promise((resolve) => this.websocketServer.close(() => resolve(undefined)))
    await new Promise((resolve) => this.httpServer.close(() => resolve(undefined)))
    await Promise.all(Array.from(this.sessionCleanup.values()))
    for (const [connection, coordinator] of this.connectionCoordinators) {
      clearSharedTransactionCoordinator(connection, coordinator)
    }
    if (this.cleanupErrors.length > 0) {
      throw new AggregateError(this.cleanupErrors, `Shared transaction broker cleanup failed: ${this.cleanupErrors.map((error) => error.message).join("; ")}`)
    }
  }
}
