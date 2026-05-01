// @ts-check

import net from "net"

import JsonSocket from "../background-jobs/json-socket.js"
import Logger from "../logger.js"

/**
 * Beacon broker daemon.
 *
 * Accepts JsonSocket connections from any number of peer processes and
 * fans every `broadcast` message out to every connected peer.
 * Intentionally stateless — there is no persistence, no replay, no
 * channel-name filtering on the daemon. Per-process subscription
 * matching (already implemented by `_broadcastToChannelLocal`) does the
 * filtering.
 */
export default class BeaconServer {
  /**
   * @param {object} args - Options.
   * @param {import("../configuration.js").default} args.configuration - Configuration.
   * @param {string} [args.host] - Hostname to bind. Defaults to the configured beacon host.
   * @param {number} [args.port] - Port to bind. Defaults to the configured beacon port.
   */
  constructor({configuration, host, port}) {
    this.configuration = configuration
    const config = configuration.getBeaconConfig()
    this.host = host || config.host
    this.port = typeof port === "number" ? port : config.port
    this.logger = new Logger(this)
    /** @type {Set<JsonSocket>} */
    this.peers = new Set()
    /** @type {net.Server | undefined} */
    this.server = undefined
  }

  /**
   * @returns {Promise<void>} - Resolves when listening.
   */
  async start() {
    const server = net.createServer((socket) => this._handleConnection(socket))
    this.server = server

    await new Promise((resolve, reject) => {
      server.once("error", reject)
      server.listen(this.port, this.host, () => resolve(undefined))
    })

    const address = server.address()

    if (address && typeof address === "object") {
      this.port = address.port
    }
  }

  /**
   * @returns {Promise<void>} - Resolves when closed.
   */
  async stop() {
    for (const peer of this.peers) {
      peer.close()
    }

    if (!this.server) return

    const {server} = this

    await new Promise((resolve) => server.close(() => resolve(undefined)))
  }

  /**
   * @returns {number} - Bound port.
   */
  getPort() {
    return this.port
  }

  /**
   * @returns {number} - Number of connected peers.
   */
  getPeerCount() {
    return this.peers.size
  }

  /**
   * @param {import("net").Socket} socket - Socket.
   * @returns {void}
   */
  _handleConnection(socket) {
    const jsonSocket = new JsonSocket(socket)
    /** @type {string | undefined} */
    let peerId

    const cleanup = () => {
      this.peers.delete(jsonSocket)
    }

    jsonSocket.on("close", cleanup)
    jsonSocket.on("error", (error) => {
      this.logger.warn(() => ["Beacon connection error:", error])
      cleanup()
    })

    /** @param {import("./types.js").BeaconSocketMessage} message - Socket message. */
    jsonSocket.on("message", (message) => {
      if (!peerId && message?.type === "hello") {
        peerId = message.peerId
        this.peers.add(jsonSocket)
        return
      }

      if (message?.type === "broadcast") {
        this._fanOut(message)
      }
    })
  }

  /**
   * @param {import("./types.js").BeaconBroadcastMessage} message - Broadcast message.
   * @returns {void}
   */
  _fanOut(message) {
    for (const peer of this.peers) {
      try {
        peer.send(message)
      } catch (error) {
        this.logger.warn(() => ["Beacon fan-out send failed:", error])
      }
    }
  }
}
