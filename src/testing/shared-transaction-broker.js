// @ts-check

import { randomBytes, timingSafeEqual } from "node:crypto"
import { createServer } from "node:http"
import { EventEmitter } from "node:events"
import { WebSocketServer } from "ws"
import { decodeBrokerValue, encodeBrokerValue } from "./shared-transaction-codec.js"

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
  "getConnectionScopedValue"
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
    /** @type {Map<object, Promise<void>>} */
    this.connectionQueues = new Map()
    /** @type {Set<import("ws").WebSocket>} */
    this.sessions = new Set()
    this.httpServer = createServer()
    this.websocketServer = new WebSocketServer({server: this.httpServer, maxPayload: 16 * 1024 * 1024})
    this.websocketServer.on("connection", (socket) => {
      this.sessions.add(socket)
      socket.once("close", () => this.sessions.delete(socket))
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
      const result = await this.serialize(connection, async () => {
        if (!this.accepting) throw new Error("Shared transaction broker capability has been revoked")
        const connectionMethods = /** @type {Record<string, (...methodArgs: Array<ReturnType<typeof JSON.parse>>) => ReturnType<typeof JSON.parse>>} */ (connection)
        const method = connectionMethods[request.method]
        if (typeof method !== "function") throw new Error(`Connection does not support shared transaction method: ${request.method}`)
        return await method.apply(connection, args)
      })
      if (socket.readyState === socket.OPEN) socket.send(JSON.stringify({requestId, result: encodeBrokerValue(result)}))
    } catch (error) {
      const normalized = error instanceof Error ? error : new Error(String(error))
      if (socket.readyState === socket.OPEN) socket.send(JSON.stringify({requestId, error: encodeBrokerValue(normalized)}))
    }
  }

  /**
   * Serializes work by physical connection across all sessions and identifiers.
   * @template T
   * @param {object} connection - Parent-owned physical connection.
   * @param {() => Promise<T>} callback - Work.
   * @returns {Promise<T>} - Serialized result.
   */
  async serialize(connection, callback) {
    const previous = this.connectionQueues.get(connection) || Promise.resolve()
    /**
     * Resolves the current queue entry.
     * @type {(value?: void) => void}
     */
    let release = () => {}
    const current = new Promise((resolve) => { release = resolve })
    const queued = previous.then(() => current)
    this.connectionQueues.set(connection, queued)
    await previous
    try {
      return await callback()
    } finally {
      release()
      if (this.connectionQueues.get(connection) === queued) this.connectionQueues.delete(connection)
    }
  }

  /**
   * Stops admission, revokes capability, rejects clients, and drains active work.
   * @returns {Promise<void>} - Resolves after transport shutdown.
   */
  async close() {
    if (!this.accepting) return
    this.accepting = false
    this.secret = randomBytes(32).toString("base64url")
    for (const socket of this.sessions) socket.close(1001, "Shared transaction broker closed")
    await Promise.all(Array.from(this.connectionQueues.values()))
    await new Promise((resolve) => this.websocketServer.close(() => resolve(undefined)))
    await new Promise((resolve) => this.httpServer.close(() => resolve(undefined)))
  }
}
