// @ts-check

import WebSocket from "ws"
import { decodeBrokerValue, encodeBrokerValue } from "./shared-transaction-codec.js"

export default class SharedTransactionBrokerClient {
  /**
   * Creates a broker client.
   * @param {{address: string, capability: string, databaseIdentifier: string}} args - Broker coordinates.
   */
  constructor({address, capability, databaseIdentifier}) {
    this.capability = capability
    this.databaseIdentifier = databaseIdentifier
    this.nextRequestId = 1
    /** @type {Map<number, {reject: (error: Error) => void, resolve: (value: ReturnType<typeof decodeBrokerValue>) => void}>} */
    this.pending = new Map()
    this.socket = new WebSocket(address)
    this.connectionPromise = new Promise((resolve, reject) => {
      this.socket.once("open", resolve)
      this.socket.once("error", reject)
    })
    this.socket.on("message", (data) => this.handleMessage(`${data}`))
    this.socket.once("close", () => this.rejectPending(new Error("Shared transaction broker connection closed")))
    this.socket.on("error", (error) => this.rejectPending(error))
  }

  /**
   * Waits for the websocket to open.
   * @returns {Promise<void>} - Resolves after the websocket opens.
   */
  async connected() { await this.connectionPromise }

  /**
   * Calls one physical connection operation.
   * @param {string} method - Broker operation.
   * @param {Array<ReturnType<typeof JSON.parse>>} args - Operation arguments.
   * @returns {Promise<ReturnType<typeof decodeBrokerValue>>} - Remote result.
   */
  async call(method, args) {
    await this.connected()
    if (this.socket.readyState !== WebSocket.OPEN) throw new Error("Shared transaction broker connection is closed")
    const requestId = this.nextRequestId++
    const response = new Promise((resolve, reject) => this.pending.set(requestId, {resolve, reject}))

    this.socket.send(JSON.stringify({
      requestId,
      capability: this.capability,
      databaseIdentifier: this.databaseIdentifier,
      method,
      args: encodeBrokerValue(args)
    }), (error) => {
      if (!error) return
      const pending = this.pending.get(requestId)
      this.pending.delete(requestId)
      pending?.reject(error)
    })

    return await response
  }

  /**
   * Handles a correlated broker response.
   * @param {string} serialized - Serialized response.
   * @returns {void} - No return value.
   */
  handleMessage(serialized) {
    const response = /** @type {{requestId: number, result?: import("./shared-transaction-codec.js").EncodedBrokerValue, error?: import("./shared-transaction-codec.js").EncodedBrokerValue}} */ (JSON.parse(serialized))
    const pending = this.pending.get(response.requestId)
    if (!pending) return
    this.pending.delete(response.requestId)

    if (response.error) {
      const error = decodeBrokerValue(response.error)
      pending.reject(error instanceof Error ? error : new Error(String(error)))
    } else if (response.result) {
      pending.resolve(decodeBrokerValue(response.result))
    } else {
      pending.reject(new Error("Invalid shared transaction broker response"))
    }
  }

  /**
   * Rejects every pending call after disconnect.
   * @param {Error} error - Disconnect error.
   * @returns {void} - No return value.
   */
  rejectPending(error) {
    for (const {reject} of this.pending.values()) reject(error)
    this.pending.clear()
  }

  /**
   * Closes the client without touching the parent connection.
   * @returns {Promise<void>} - Resolves after the websocket closes.
   */
  async close() {
    if (this.socket.readyState === WebSocket.CLOSED) return
    if (this.socket.readyState === WebSocket.CONNECTING) {
      this.socket.terminate()
      return
    }
    await new Promise((resolve) => {
      this.socket.once("close", resolve)
      this.socket.close()
    })
  }
}
