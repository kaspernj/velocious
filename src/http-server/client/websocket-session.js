// @ts-check

import EventEmitter from "../../utils/event-emitter.js"
import {Logger} from "../../logger.js"
import RequestRunner from "./request-runner.js"
import WebsocketRequest from "./websocket-request.js"

const WEBSOCKET_FINAL_FRAME = 0x80
const WEBSOCKET_OPCODE_TEXT = 0x1
const WEBSOCKET_OPCODE_CLOSE = 0x8
const WEBSOCKET_OPCODE_PING = 0x9
const WEBSOCKET_OPCODE_PONG = 0xA

export default class VelociousHttpServerClientWebsocketSession {
  events = new EventEmitter()
  subscriptions = new Set()

  /**
   * @param {object} args - Options object.
   * @param {import("../../configuration.js").default} args.configuration - Configuration instance.
   * @param {import("./index.js").default} args.client - Client instance.
   */
  constructor({client, configuration}) {
    this.buffer = Buffer.alloc(0)
    this.client = client
    this.configuration = configuration
    this.logger = new Logger(this)
  }

  /**
   * @param {string} channel - Channel name.
   * @returns {void} - No return value.
   */
  addSubscription(channel) {
    this.subscriptions.add(channel)
  }

  destroy() {
    this.events.removeAllListeners()
  }

  /**
   * @param {string} channel - Channel name.
   * @returns {boolean} - Whether it has subscription.
   */
  hasSubscription(channel) {
    return this.subscriptions.has(channel)
  }

  /**
   * @param {Buffer} data - Data payload.
   * @returns {void} - No return value.
   */
  onData(data) {
    this.buffer = Buffer.concat([this.buffer, data])
    this._processBuffer()
  }

  /**
   * @param {string} channel - Channel name.
   * @param {any} payload - Payload data.
   * @returns {void} - No return value.
   */
  sendEvent(channel, payload) {
    if (!this.hasSubscription(channel)) return

    this._sendJson({channel, payload, type: "event"})
  }

  /**
   * @param {import("./index.js").default} client - Client instance.
   * @returns {void} - No return value.
   */
  sendGoodbye(client) {
    const frame = Buffer.from([WEBSOCKET_FINAL_FRAME | WEBSOCKET_OPCODE_CLOSE, 0x00])

    client.events.emit("output", frame)
  }

  /**
   * @param {object} message - Message text.
   * @returns {Promise<void>} - Resolves when complete.
   */
  async _handleMessage(message) {
    if (message.type === "subscribe") {
      const {channel} = message

      if (!channel) throw new Error("channel is required for subscribe")

      this.addSubscription(channel)
      this._sendJson({channel, type: "subscribed"})

      return
    }

    if (message.type && message.type !== "request") {
      this._sendJson({error: `Unknown message type: ${message.type}`, type: "error"})
      return
    }

    const {body, headers, id, method, path} = message

    if (!method) throw new Error("method is required")
    if (!path) throw new Error("path is required")

    const request = new WebsocketRequest({
      body,
      headers,
      method,
      path,
      remoteAddress: this.client.remoteAddress
    })
    const requestRunner = new RequestRunner({
      configuration: this.configuration,
      request
    })

    requestRunner.events.on("done", () => {
      const response = requestRunner.response
      const body = response.getBody()
      const headers = response.headers

      this._sendJson({
        body,
        headers,
        id,
        statusCode: response.getStatusCode(),
        statusMessage: response.getStatusMessage(),
        type: "response"
      })
    })

    await requestRunner.run()
  }

  /**
   * @returns {void} - No return value.
   */
  _processBuffer() {
    while (this.buffer.length >= 2) {
      const firstByte = this.buffer[0]
      const secondByte = this.buffer[1]
      const isFinal = (firstByte & WEBSOCKET_FINAL_FRAME) === WEBSOCKET_FINAL_FRAME
      const opcode = firstByte & 0x0F
      const isMasked = (secondByte & 0x80) === 0x80
      let payloadLength = secondByte & 0x7F
      let offset = 2

      if (payloadLength === 126) {
        if (this.buffer.length < offset + 2) return
        payloadLength = this.buffer.readUInt16BE(offset)
        offset += 2
      } else if (payloadLength === 127) {
        if (this.buffer.length < offset + 8) return
        const bigLength = this.buffer.readBigUInt64BE(offset)

        payloadLength = Number(bigLength)
        offset += 8
      }

      const maskLength = isMasked ? 4 : 0

      if (this.buffer.length < offset + maskLength + payloadLength) return

      /** @type {Buffer} */
      let payload = this.buffer.slice(offset + maskLength, offset + maskLength + payloadLength)

      if (isMasked) {
        const mask = this.buffer.slice(offset, offset + maskLength)
        payload = this._unmaskPayload(payload, mask)
      }

      this.buffer = this.buffer.slice(offset + maskLength + payloadLength)

      if (!isFinal) {
        this.logger.warn("Fragmented frames are not supported yet")
        continue
      }

      if (opcode === WEBSOCKET_OPCODE_PING) {
        this._sendControlFrame(WEBSOCKET_OPCODE_PONG, payload)
        continue
      }

      if (opcode === WEBSOCKET_OPCODE_CLOSE) {
        this.events.emit("close")
        this.sendGoodbye(this.client)
        continue
      }

      if (opcode !== WEBSOCKET_OPCODE_TEXT) {
        this.logger.warn(`Unsupported websocket opcode: ${opcode}`)
        continue
      }

      try {
        const message = JSON.parse(payload.toString("utf-8"))

        this._handleMessage(message).catch((error) => {
          this.logger.error(() => ["Websocket message handler failed", error])
          this._sendJson({error: error.message, type: "error"})
        })
      } catch (error) {
        this.logger.error(() => ["Failed to parse websocket message", error])
        this._sendJson({error: "Invalid websocket message", type: "error"})
      }
    }
  }

  /**
   * @param {number} opcode - Opcode.
   * @param {Buffer} payload - Payload data.
   * @returns {void} - No return value.
   */
  _sendControlFrame(opcode, payload) {
    const header = Buffer.alloc(2)

    header[0] = WEBSOCKET_FINAL_FRAME | opcode
    header[1] = payload.length

    this.client.events.emit("output", Buffer.concat([header, payload]))
  }

  /**
   * @param {object} body - Request body.
   * @returns {void} - No return value.
   */
  _sendJson(body) {
    const json = JSON.stringify(body)
    const payload = Buffer.from(json, "utf-8")
    let header

    if (payload.length < 126) {
      header = Buffer.alloc(2)
      header[1] = payload.length
    } else if (payload.length < 65536) {
      header = Buffer.alloc(4)
      header[1] = 126
      header.writeUInt16BE(payload.length, 2)
    } else {
      header = Buffer.alloc(10)
      header[1] = 127
      header.writeBigUInt64BE(BigInt(payload.length), 2)
    }

    header[0] = WEBSOCKET_FINAL_FRAME | WEBSOCKET_OPCODE_TEXT

    this.client.events.emit("output", Buffer.concat([header, payload]))
  }

  /**
   * @param {Buffer} payload - Payload data.
   * @param {Buffer} mask - Mask.
   * @returns {Buffer} - The unmask payload.
   */
  _unmaskPayload(payload, mask) {
    /** @type {Buffer} */
    const result = Buffer.alloc(payload.length)

    for (let i = 0; i < payload.length; i++) {
      result[i] = payload[i] ^ mask[i % 4]
    }

    return result
  }
}
