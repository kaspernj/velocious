// @ts-check

import SnapReqWebSocketClient from "snapreq/websocket"
import {deserializeFrontendModelTransportValue} from "../frontend-models/transport-serialization.js"

const DEFAULT_URL = "ws://127.0.0.1:3006/websocket"
const SESSION_ROUTING_PARAMETER = "velociousSessionId"

/**
 * Velocious's WebSocket client. The cross-platform connection/session/channel
 * machinery lives in snapreq's `SnapReqWebSocketClient`; this thin subclass only
 * pre-wires the two Velocious-specific defaults: the local development websocket
 * URL and frontend-model transport deserialization inside `response.json()`.
 * @augments SnapReqWebSocketClient
 */
export default class VelociousWebsocketClient extends SnapReqWebSocketClient {
  /**
   * Runs constructor.
   * @param {Partial<ConstructorParameters<typeof SnapReqWebSocketClient>[0]>} [args] - Options forwarded to `SnapReqWebSocketClient`.
   */
  constructor(args = {}) {
    super({
      ...args,
      url: args.url ?? DEFAULT_URL,
      deserialize: args.deserialize ?? deserializeFrontendModelTransportValue
    })
    this.reconnectGeneration = 0
    /** @type {Set<Promise<void>>} */
    this.runningReconnectTasks = new Set()
    /** @type {Promise<void> | null} */
    this.gracefulClosePromise = null
    this.routingBaseUrl = this.url
  }

  /**
   * Restores a persisted session before opening the socket so the host can route
   * the HTTP upgrade to the worker that owns its paused state.
   * @returns {Promise<void>}
   */
  async _restoreSessionIdForRouting() {
    // SnapReq initializes these internal session fields in its constructor, but
    // its declaration does not expose that definite-assignment lifecycle here.
    const routingState = /** @type {{_sessionId: string | null, _sessionStore: {get: () => string | null | undefined | Promise<string | null | undefined>} | undefined, _sessionStoreRestored: boolean}} */ (/** @type {unknown} */ (this))

    if (routingState._sessionId || routingState._sessionStoreRestored || !routingState._sessionStore) return

    routingState._sessionStoreRestored = true

    try {
      const storedId = await routingState._sessionStore.get()

      if (typeof storedId === "string" && storedId.length > 0) routingState._sessionId = storedId
    } catch (error) {
      this._debug("sessionStore.get failed", error)
    }
  }

  /**
   * Builds the WebSocket URL carrying only the current resumable session routing hint.
   * @returns {string} - WebSocket URL.
   */
  _sessionRoutingUrl() {
    const url = new URL(this.routingBaseUrl)

    if (this._sessionId) {
      url.searchParams.set(SESSION_ROUTING_PARAMETER, this._sessionId)
    } else {
      url.searchParams.delete(SESSION_ROUTING_PARAMETER)
    }

    return url.toString()
  }

  /**
   * Restores routing state before delegating socket creation to SnapReq.
   * @param {Parameters<SnapReqWebSocketClient["_connect"]>[0]} [options] - Connect options.
   * @returns {Promise<void>} - Resolves when the session is ready.
   */
  async _connect(options) {
    await this._restoreSessionIdForRouting()
    this.url = this._sessionRoutingUrl()
    await super._connect(options)
  }

  /**
   * Ignores an online result resolved after reconnect teardown began.
   * @returns {Promise<boolean>} - Whether this client generation is online.
   */
  async _isOnline() {
    const generation = this.reconnectGeneration
    const isOnline = await super._isOnline()

    return generation === this.reconnectGeneration && isOnline
  }

  /**
   * Tracks automatic reconnect work so teardown can drain stale attempts.
   * @returns {Promise<void>} - Resolves after the reconnect attempt settles.
   */
  async _attemptReconnect() {
    const reconnectTask = super._attemptReconnect()

    this.runningReconnectTasks.add(reconnectTask)

    try {
      await reconnectTask
    } finally {
      this.runningReconnectTasks.delete(reconnectTask)
    }
  }

  /**
   * Closes the WebSocket as a normal shutdown so the server permanently
   * releases resumable session state.
   * @returns {Promise<void>} - Resolves once closed.
   */
  async close() {
    if (this.gracefulClosePromise) return await this.gracefulClosePromise

    this.autoReconnect = false
    const socket = this.socket
    const closePromise = (async () => {
      if (socket && socket.readyState === socket.OPEN) {
        await new Promise((resolve) => {
          socket.addEventListener("close", () => resolve(undefined), {once: true})
          socket.close(1000)
        })
      }

      await super.close()
    })()

    this.gracefulClosePromise = closePromise

    try {
      await closePromise
    } finally {
      if (this.gracefulClosePromise === closePromise) this.gracefulClosePromise = null
    }
  }

  /**
   * Stops reconnect, drains work that already passed SnapReq's reconnect guard,
   * and clears state changed by a stale attempt while it settled.
   * @returns {Promise<void>} - Resolves once no reconnect can resurrect a socket.
   */
  async disconnectAndStopReconnect() {
    this.reconnectGeneration += 1
    await super.disconnectAndStopReconnect()

    if (this.runningReconnectTasks.size === 0) return

    while (this.runningReconnectTasks.size > 0) {
      await Promise.all(this.runningReconnectTasks)
    }

    await super.disconnectAndStopReconnect()
  }
}
