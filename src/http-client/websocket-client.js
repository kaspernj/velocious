// @ts-check

import SnapReqWebSocketClient from "snapreq/websocket"
import {deserializeFrontendModelTransportValue} from "../frontend-models/transport-serialization.js"

const DEFAULT_URL = "ws://127.0.0.1:3006/websocket"

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
