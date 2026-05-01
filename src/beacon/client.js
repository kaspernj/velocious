// @ts-check

import {randomUUID} from "node:crypto"
import net from "node:net"

import JsonSocket from "../background-jobs/json-socket.js"
import EventEmitter from "../utils/event-emitter.js"

const DEFAULT_RECONNECT_DELAY_MS = 1000
const MAX_RECONNECT_DELAY_MS = 30_000

/**
 * @typedef {function(import("./types.js").BeaconBroadcastMessage): void} BeaconBroadcastHandler
 */

/**
 * BeaconClient connects to a `velocious beacon` daemon and exchanges
 * broadcasts with all peer processes connected to the same daemon.
 *
 * Lifecycle:
 *   const client = new BeaconClient({host, port, peerType: "server"})
 *   await client.connect()                         // resolves on first successful connect
 *   client.onBroadcast((message) => { ... })       // every fan-out
 *   client.publish({channel, broadcastParams, body})
 *   await client.close()
 *
 * Reconnect: on socket close (without an explicit `close()` call) the
 * client schedules a reconnect with exponential backoff. While the
 * underlying socket is down, `publish(...)` returns false and the
 * caller can fall back to local-only delivery; subsequent reconnects do
 * not replay missed publishes (Beacon is pubsub, not a queue).
 */
export default class BeaconClient extends EventEmitter {
  /**
   * @param {object} args - Options.
   * @param {string} args.host - Beacon host.
   * @param {number} args.port - Beacon port.
   * @param {string} [args.peerType] - Optional human-readable peer label.
   * @param {string} [args.peerId] - Optional explicit peer id (defaults to a random UUID).
   * @param {number} [args.reconnectDelayMs] - Starting reconnect delay in ms.
   * @param {number} [args.maxReconnectDelayMs] - Maximum reconnect delay in ms.
   */
  constructor({host, port, peerType, peerId, reconnectDelayMs, maxReconnectDelayMs}) {
    super()
    this.host = host
    this.port = port
    this.peerType = peerType
    this.peerId = peerId || randomUUID()
    this._initialReconnectDelayMs = reconnectDelayMs ?? DEFAULT_RECONNECT_DELAY_MS
    this._maxReconnectDelayMs = maxReconnectDelayMs ?? MAX_RECONNECT_DELAY_MS
    this._reconnectDelayMs = this._initialReconnectDelayMs
    /** @type {JsonSocket | undefined} */
    this._jsonSocket = undefined
    /** @type {net.Socket | undefined} */
    this._socket = undefined
    this._connected = false
    this._closed = false
    /** @type {NodeJS.Timeout | undefined} */
    this._reconnectTimer = undefined
    /** @type {Promise<void> | undefined} */
    this._connectPromise = undefined
    /**
     * Last socket error observed while connected, surfaced as the disconnect reason.
     * @type {Error | undefined}
     */
    this._lastSocketError = undefined
  }

  /** @returns {string} - The peer id sent on the hello handshake. */
  getPeerId() { return this.peerId }

  /** @returns {boolean} - Whether the underlying socket is currently connected. */
  isConnected() { return this._connected }

  /**
   * Resolves on the first successful connect. Subsequent calls return
   * the same promise. Subsequent reconnects after a drop are silent —
   * use `on("connect")` / `on("disconnect", reason)` to observe them.
   * The `disconnect` listener receives an `Error` reason: either the
   * underlying socket error, or `Error("Beacon broker disconnected")`
   * when the close had no preceding error.
   * @returns {Promise<void>}
   */
  async connect() {
    if (this._closed) throw new Error("BeaconClient has been closed")
    if (this._connectPromise) return await this._connectPromise

    this._connectPromise = new Promise((resolve, reject) => {
      const onConnect = () => {
        this.off("connect", onConnect)
        this.off("connect-error", onError)
        resolve()
      }
      const onError = (/** @type {Error} */ error) => {
        this.off("connect", onConnect)
        this.off("connect-error", onError)
        reject(error)
      }

      this.on("connect", onConnect)
      this.on("connect-error", onError)
    })

    this._openSocket()

    return await this._connectPromise
  }

  /**
   * Publishes a broadcast message to all peers (including this one,
   * unless the daemon is restarted mid-publish).
   * @param {object} args - Broadcast args.
   * @param {string} args.channel - Channel name.
   * @param {Record<string, any>} args.broadcastParams - Routing params.
   * @param {any} args.body - Message body.
   * @returns {boolean} - True if the publish was written to the socket. False if the client is currently disconnected.
   */
  publish({channel, broadcastParams, body}) {
    if (!this._connected || !this._jsonSocket) return false

    /** @type {import("./types.js").BeaconBroadcastMessage} */
    const message = {
      type: "broadcast",
      channel,
      broadcastParams,
      body,
      originPeerId: this.peerId
    }

    try {
      this._jsonSocket.send(message)
      return true
    } catch {
      return false
    }
  }

  /**
   * Registers a handler called once for every `broadcast` message
   * received from the daemon (including echoes of this client's own
   * publishes — synapse-style fan-out).
   * @param {BeaconBroadcastHandler} handler - Handler.
   * @returns {() => void} - Unregister function.
   */
  onBroadcast(handler) {
    this.on("broadcast", handler)
    return () => this.off("broadcast", handler)
  }

  /** @returns {Promise<void>} - Resolves once the socket is closed. */
  async close() {
    this._closed = true

    if (this._reconnectTimer) {
      clearTimeout(this._reconnectTimer)
      this._reconnectTimer = undefined
    }

    if (this._socket) {
      const socket = this._socket

      await new Promise((resolve) => {
        socket.once("close", () => resolve(undefined))
        socket.end()
      })
    }
  }

  /**
   * @returns {void}
   */
  _openSocket() {
    if (this._closed) return

    const socket = net.createConnection({host: this.host, port: this.port})
    this._socket = socket
    const jsonSocket = new JsonSocket(socket)
    this._jsonSocket = jsonSocket

    socket.on("connect", () => {
      this._connected = true
      this._reconnectDelayMs = this._initialReconnectDelayMs

      jsonSocket.send({
        type: "hello",
        role: "client",
        peerId: this.peerId,
        peerType: this.peerType
      })

      this.emit("connect")
    })

    jsonSocket.on("message", (/** @type {import("./types.js").BeaconSocketMessage} */ message) => {
      if (message?.type === "broadcast") {
        this.emit("broadcast", message)
      }
    })

    jsonSocket.on("error", (error) => {
      if (!this._connected) {
        // Initial connect failed — surface to `connect()`'s promise via `connect-error`.
        // No `error` emit: that channel is for established-session errors; the
        // initial-connect path is owned by `connect-error`.
        this.emit("connect-error", error)
      } else {
        // Established session error. Cache so the upcoming `close` event can
        // surface it as the disconnect reason.
        this._lastSocketError = error
        this.emit("error", error)
      }
    })

    jsonSocket.on("close", () => {
      const wasConnected = this._connected

      this._connected = false
      this._jsonSocket = undefined
      this._socket = undefined

      // Explicit close() sets `_closed = true` before ending the socket.
      // Don't surface user-initiated teardown as a disconnect "error" —
      // only network-driven drops should be reported.
      if (wasConnected && !this._closed) {
        const reason = this._lastSocketError || new Error("Beacon broker disconnected")

        this.emit("disconnect", reason)
      }

      this._lastSocketError = undefined

      if (this._closed) return

      this._scheduleReconnect()
    })
  }

  /**
   * @returns {void}
   */
  _scheduleReconnect() {
    if (this._reconnectTimer) return

    const delay = this._reconnectDelayMs

    this._reconnectTimer = setTimeout(() => {
      this._reconnectTimer = undefined
      this._reconnectDelayMs = Math.min(delay * 2, this._maxReconnectDelayMs)
      this._openSocket()
    }, delay)
  }
}
