// @ts-check

import EventEmitter from "../../utils/event-emitter.js"
import Logger from "../../logger.js"
import RequestRunner from "./request-runner.js"
import WebsocketRequest from "./websocket-request.js"
import WebsocketChannel from "../websocket-channel.js"

const WEBSOCKET_FINAL_FRAME = 0x80
const WEBSOCKET_OPCODE_TEXT = 0x1
const WEBSOCKET_OPCODE_CLOSE = 0x8
const WEBSOCKET_OPCODE_PING = 0x9
const WEBSOCKET_OPCODE_PONG = 0xA

export default class VelociousHttpServerClientWebsocketSession {
  events = new EventEmitter()
  subscriptions = new Set()
  channels = new Set()

  /**
   * @param {object} args - Options object.
   * @param {import("../../configuration.js").default} args.configuration - Configuration instance.
   * @param {import("./index.js").default} args.client - Client instance.
   * @param {import("./request.js").default | import("./websocket-request.js").default} [args.upgradeRequest] - Initial websocket upgrade request.
   * @param {import("../../configuration-types.js").WebsocketMessageHandler} [args.messageHandler] - Optional raw message handler.
   * @param {Promise<import("../../configuration-types.js").WebsocketMessageHandler | void>} [args.messageHandlerPromise] - Optional raw message handler promise.
   */
  constructor({client, configuration, upgradeRequest, messageHandler, messageHandlerPromise}) {
    this.buffer = Buffer.alloc(0)
    this.client = client
    this.configuration = configuration
    this.upgradeRequest = upgradeRequest
    this.messageHandler = messageHandler
    this.messageHandlerPromise = messageHandlerPromise
    this.messageQueue = []
    this.pendingMessageHandler = Boolean(messageHandlerPromise)
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
    void this._teardownChannel()
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
   * @returns {Promise<void>} - Resolves when complete.
   */
  async sendEvent(channel, payload) {
    if (!this.hasSubscription(channel)) return

    this.sendJson({channel, payload, type: "event"})
  }

  /**
   * @returns {Promise<void>} - Resolves when complete.
   */
  async initializeChannel() {
    if (this.messageHandlerPromise) {
      await this._resolveMessageHandlerPromise()

      if (this.messageHandler) return
    }

    if (this.messageHandler) {
      await this._runMessageHandlerOpen()
      return
    }

    const resolver = this.configuration.getWebsocketChannelResolver?.()

    if (!resolver) return

    try {
      const resolved = await resolver({
        client: this.client,
        configuration: this.configuration,
        request: this.upgradeRequest,
        websocketSession: this
      })

      if (!resolved) return

      const channel = typeof resolved === "function"
        ? new resolved({client: this.client, configuration: this.configuration, request: this.upgradeRequest, websocketSession: this})
        : resolved

      if (channel && !(channel instanceof WebsocketChannel)) {
        throw new Error("Resolved websocket channel must extend WebsocketChannel")
      }

      await this._registerChannel(channel)
    } catch (error) {
      this.logger.error(() => ["Failed to initialize websocket channel", error])
    }
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
    if (this.pendingMessageHandler) {
      this.messageQueue.push(message)
      return
    }

    if (this.messageHandler) {
      await this._runMessageHandlerMessage(message)
      return
    }

    if (message.type === "subscribe") {
      const {channel, params} = message

      if (!channel) throw new Error("channel is required for subscribe")
      const resolver = this.configuration.getWebsocketChannelResolver?.()

      if (resolver) {
        await this._handleChannelSubscription({channel, params})
      } else {
        await this.subscribeToChannel(channel, {acknowledge: true})
      }

      return
    }

    if (message.type && message.type !== "request") {
      this.sendJson({error: `Unknown message type: ${message.type}`, type: "error"})
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

      this.sendJson({
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
        this._handleClose()
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
          this.sendJson({error: error.message, type: "error"})
        })
      } catch (error) {
        this.logger.error(() => ["Failed to parse websocket message", error])
        this.sendJson({error: "Invalid websocket message", type: "error"})
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
  sendJson(body) {
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
   * @param {string} channel - Channel name.
   * @param {{acknowledge?: boolean}} [options] - Subscribe options.
   * @returns {Promise<boolean>} - Whether the subscription was added.
   */
  async subscribeToChannel(channel, {acknowledge = true} = {}) {
    this.addSubscription(channel)
    if (acknowledge) {
      this.sendJson({channel, type: "subscribed"})
    }
    return true
  }

  _handleClose() {
    void this._runMessageHandlerClose()
    void this._teardownChannel()
    this.events.emit("close")
  }

  async _teardownChannel() {
    for (const channel of this.channels) {
      await this._teardownSingleChannel(channel)
    }
    this.channels.clear()
  }

  async _teardownSingleChannel(channel) {
    try {
      await this._withConnections(async () => {
        await channel?.unsubscribed?.()
      })
    } catch (error) {
      this.logger.error(() => ["Failed to teardown websocket channel", error])
    }
  }

  async _registerChannel(channel) {
    if (!channel) return

    this.channels.add(channel)
    await this._withConnections(async () => {
      await channel?.subscribed?.()
    })
  }

  async _withConnections(callback) {
    await this.configuration.ensureConnections(async () => {
      await callback()
    })
  }

  async _handleChannelSubscription({channel, params}) {
    const resolver = this.configuration.getWebsocketChannelResolver?.()

    if (!resolver) return

    try {
      const resolved = await resolver({
        client: this.client,
        configuration: this.configuration,
        request: this.upgradeRequest,
        subscription: {channel, params},
        websocketSession: this
      })

      if (!resolved) {
        this.sendJson({channel, error: "Subscription rejected", type: "error"})
        return
      }

      const channelInstance = typeof resolved === "function"
        ? new resolved({
          client: this.client,
          configuration: this.configuration,
          request: this.upgradeRequest,
          subscriptionParams: params,
          websocketSession: this
        })
        : resolved

      if (channelInstance && !(channelInstance instanceof WebsocketChannel)) {
        throw new Error("Resolved websocket channel must extend WebsocketChannel")
      }

      await this._registerChannel(channelInstance)
    } catch (error) {
      this.logger.warn(() => ["Websocket channel subscription failed", error])
      this.sendJson({channel, error: "Subscription rejected", type: "error"})
    }
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

  async _runMessageHandlerOpen() {
    try {
      const handler = this.messageHandler
      const onOpen = handler ? handler.onOpen : null

      if (onOpen) {
        await onOpen({session: this})
      }
    } catch (error) {
      this.logger.error(() => ["Websocket open handler failed", error])
    }
  }

  async _runMessageHandlerMessage(message) {
    try {
      const handler = this.messageHandler
      const onMessage = handler ? handler.onMessage : null

      if (onMessage) {
        await onMessage({message, session: this})
      }
    } catch (error) {
      this.logger.error(() => ["Websocket message handler failed", error])
      const handler = this.messageHandler
      const onError = handler ? handler.onError : null

      if (onError) {
        await onError({error, session: this})
      }
    }
  }

  async _runMessageHandlerClose() {
    try {
      const handler = this.messageHandler
      const onClose = handler ? handler.onClose : null

      if (onClose) {
        await onClose({session: this})
      }
    } catch (error) {
      this.logger.error(() => ["Websocket close handler failed", error])
    }
  }

  /**
   * @param {import("../../configuration-types.js").WebsocketMessageHandler} handler - Handler instance.
   * @returns {void}
   */
  setMessageHandler(handler) {
    this.messageHandler = handler
    void this._runMessageHandlerOpen()
  }

  async _resolveMessageHandlerPromise() {
    if (!this.messageHandlerPromise) return

    try {
      const handler = await this.messageHandlerPromise

      if (handler) {
        this.pendingMessageHandler = false
        this.messageHandlerPromise = undefined
        this.setMessageHandler(handler)
        await this._flushQueuedMessages({useHandler: true})
        return
      }
    } catch (error) {
      this.logger.error(() => ["Websocket message handler resolver failed", error])
    }

    this.pendingMessageHandler = false
    this.messageHandlerPromise = undefined
    await this._flushQueuedMessages({useHandler: false})
  }

  /**
   * @param {{useHandler: boolean}} args - Args.
   * @returns {Promise<void>} - Resolves when complete.
   */
  async _flushQueuedMessages({useHandler}) {
    if (this.messageQueue.length === 0) return

    const queued = this.messageQueue.slice()
    this.messageQueue = []

    for (const message of queued) {
      if (useHandler && this.messageHandler) {
        await this._runMessageHandlerMessage(message)
      } else {
        await this._handleMessage(message)
      }
    }
  }
}
