// @ts-check

import {randomUUID} from "node:crypto"

import EventEmitter from "../utils/event-emitter.js"
import {publishToInProcessPeers, registerInProcessPeer} from "./in-process-broker.js"

/**
 * @typedef {function(import("./types.js").BeaconBroadcastMessage): void} BeaconBroadcastHandler
 */

/**
 * In-process counterpart to `BeaconClient`. Registers with the
 * module-level `in-process-broker` singleton so peers in the same
 * process exchange broadcasts without ever touching TCP. Implements the
 * same external surface as `BeaconClient` (`connect`, `publish`,
 * `onBroadcast`, `isConnected`, `getPeerId`, `close`) so
 * `Configuration` can use either client interchangeably.
 *
 * Lifecycle differs from `BeaconClient` in two intentional ways:
 *   - `connect()` resolves immediately; there is no broker to wait for.
 *   - There is no reconnect loop and no `connect-error` / `disconnect`
 *     event surface, because nothing can fail.
 */
export default class InProcessBeaconClient extends EventEmitter {
  /**
   * @param {object} [args] - Options.
   * @param {string} [args.peerType] - Optional human-readable peer label.
   * @param {string} [args.peerId] - Optional explicit peer id (defaults to a random UUID).
   */
  constructor({peerType, peerId} = {}) {
    super()
    this.peerType = peerType
    this.peerId = peerId || randomUUID()
    this._connected = false
    /** @type {(() => void) | undefined} */
    this._unregister = undefined
  }

  /** @returns {string} - Peer id. */
  getPeerId() { return this.peerId }

  /** @returns {boolean} - Whether the peer is registered with the broker. */
  isConnected() { return this._connected }

  /**
   * Registers with the in-process broker. Idempotent.
   * @returns {Promise<void>}
   */
  async connect() {
    if (this._connected) return

    this._unregister = registerInProcessPeer(this)
    this._connected = true
    this.emit("connect")
  }

  /**
   * Publishes a broadcast to every registered peer (including this
   * one). Returns false if `connect()` hasn't been called yet, matching
   * `BeaconClient` semantics.
   * @param {object} args - Broadcast args.
   * @param {string} args.channel - Channel name.
   * @param {Record<string, any>} args.broadcastParams - Routing params.
   * @param {any} args.body - Message body.
   * @returns {boolean} - True when the broadcast was queued.
   */
  publish({channel, broadcastParams, body}) {
    if (!this._connected) return false

    /** @type {import("./types.js").BeaconBroadcastMessage} */
    const message = {
      type: "broadcast",
      channel,
      broadcastParams,
      body,
      originPeerId: this.peerId
    }

    publishToInProcessPeers(message)

    return true
  }

  /**
   * Registers a handler called once for every broadcast received.
   * @param {BeaconBroadcastHandler} handler - Handler.
   * @returns {() => void} - Unregister function.
   */
  onBroadcast(handler) {
    this.on("broadcast", handler)
    return () => this.off("broadcast", handler)
  }

  /**
   * Receives a broadcast from the broker. Called by `in-process-broker`.
   * @param {import("./types.js").BeaconBroadcastMessage} message - Broadcast message.
   * @returns {void}
   */
  _receiveBroadcast(message) {
    this.emit("broadcast", message)
  }

  /** @returns {Promise<void>} - Unregisters from the broker. */
  async close() {
    if (this._unregister) this._unregister()
    this._unregister = undefined
    this._connected = false
  }
}
