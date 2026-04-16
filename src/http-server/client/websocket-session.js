// @ts-check

import EventEmitter from "../../utils/event-emitter.js"
import Logger from "../../logger.js"
import RequestRunner from "./request-runner.js"
import WebsocketRequest from "./websocket-request.js"
import WebsocketChannel from "../websocket-channel.js"
import {websocketEventLogStoreForConfiguration} from "../websocket-event-log-store.js"

const WEBSOCKET_FINAL_FRAME = 0x80
const WEBSOCKET_OPCODE_TEXT = 0x1
const WEBSOCKET_OPCODE_CLOSE = 0x8
const WEBSOCKET_OPCODE_PING = 0x9
const WEBSOCKET_OPCODE_PONG = 0xA

/**
 * @typedef {{type: "subscribe", channel: string, lastEventId?: string, params?: Record<string, any>} | {type: "metadata", data?: Record<string, any>} | {type?: "request", body?: unknown, headers?: Record<string, any>, id?: string | number | null, method: string, path: string} | Record<string, any>} WebsocketSessionMessage
 */

/**
 * @param {WebsocketSessionMessage} message - Raw websocket message.
 * @returns {{type: "subscribe", channel: string, lastEventId?: string, params?: Record<string, any>} | null} - Subscribe message when matched.
 */
function subscribeMessage(message) {
  return message.type === "subscribe"
    ? /** @type {{type: "subscribe", channel: string, lastEventId?: string, params?: Record<string, any>}} */ (message)
    : null
}

/**
 * @param {WebsocketSessionMessage} message - Raw websocket message.
 * @returns {{type?: "request", body?: unknown, headers?: Record<string, any>, id?: string | number | null, method: string, path: string} | null} - Request message when matched.
 */
function requestMessage(message) {
  if (message.type && message.type !== "request") return null

  return /** @type {{type?: "request", body?: unknown, headers?: Record<string, any>, id?: string | number | null, method: string, path: string}} */ (message)
}

export default class VelociousHttpServerClientWebsocketSession {
  events = new EventEmitter()
  subscriptions = new Set()
  channels = new Set()
  subscriptionHandlers = new Map()
  handlerSubscriptions = new Map()
  channelTenants = new Map()
  channelReplayStates = new Map()
  /** @type {WebsocketSessionMessage[]} */
  messageQueue = []

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
    this.pendingMessageHandler = Boolean(messageHandlerPromise)
    this.logger = new Logger(this)

    /** @type {Record<string, any>} */
    this._metadata = {}

    /**
     * Long-lived per-session state bag. Stable across reconnects once
     * grace-period resumption lands in Phase 2; today it just lives
     * for the duration of the underlying socket.
     * @type {Record<string, any>}
     */
    this.data = {}

    /** @type {Map<string, import("../websocket-connection.js").default>} */
    this._connections = new Map()
  }

  /**
   * Removes a closed connection from the session registry. Called by
   * `VelociousWebsocketConnection.close()` after it sends the final
   * `connection-closed` frame.
   *
   * @param {string} connectionId
   * @returns {void}
   */
  _removeConnection(connectionId) {
    this._connections.delete(connectionId)
  }

  /** @returns {Record<string, any>} - Client-provided metadata (defensive copy). */
  getMetadata() {
    return {...this._metadata}
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
   * @param {{createdAt?: string, eventId?: string, replayed?: boolean, sequence?: number}} [options] - Event metadata.
   * @returns {Promise<void>} - Resolves when complete.
   */
  async sendEvent(channel, payload, options = {}) {
    const channelHandlers = this.subscriptionHandlers.get(channel)
    const hasChannelHandlers = Boolean(channelHandlers && channelHandlers.size > 0)
    const replayState = this.channelReplayStates.get(channel)

    if (replayState?.replaying && !options.replayed) {
      replayState.buffered = true
      return
    }

    if (!this.hasSubscription(channel) && !hasChannelHandlers) return

    if (hasChannelHandlers) {
      await Promise.all(Array.from(channelHandlers).map(async (handler) => {
        const tenant = this.channelTenants.get(handler)

        await this.configuration.runWithTenant(tenant, async () => {
          await this._withConnections(async () => {
            await handler.receivedBroadcast({
              channel,
              createdAt: options.createdAt,
              eventId: options.eventId,
              payload,
              replayed: options.replayed,
              sequence: options.sequence
            })
          })
        })
      }))
      return
    }

    this.sendJson({
      channel,
      createdAt: options.createdAt,
      eventId: options.eventId,
      payload,
      replayed: options.replayed,
      sequence: options.sequence,
      type: "event"
    })
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
      const tenant = await this._resolveTenant({})
      const resolved = await this.configuration.runWithTenant(tenant, async () => {
        return await resolver({
          client: this.client,
          configuration: this.configuration,
          request: this.upgradeRequest,
          websocketSession: this
        })
      })

      if (!resolved) return

      const channel = typeof resolved === "function"
        ? new resolved({client: this.client, configuration: this.configuration, request: this.upgradeRequest, websocketSession: this})
        : resolved

      if (channel && !(channel instanceof WebsocketChannel)) {
        throw new Error("Resolved websocket channel must extend WebsocketChannel")
      }

      await this._registerChannel(channel, tenant)
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
   * @param {WebsocketSessionMessage} message - Message text.
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

    const subscribePayload = subscribeMessage(message)

    if (subscribePayload) {
      const {channel, lastEventId, params} = subscribePayload

      if (!channel) throw new Error("channel is required for subscribe")
      const resolver = this.configuration.getWebsocketChannelResolver?.()

      if (resolver) {
        await this._handleChannelSubscription({channel, lastEventId, params})
      } else {
        await this.subscribeToChannel(channel, {acknowledge: true, lastEventId, params})
      }

      return
    }

    if (message.type === "metadata") {
      const metadataPayload = /** @type {{data?: Record<string, any>}} */ (message)

      this._metadata = metadataPayload.data && typeof metadataPayload.data === "object" ? {...metadataPayload.data} : {}

      for (const channel of this.channels) {
        if (typeof channel.onMetadataChanged === "function") {
          const tenant = this.channelTenants.get(channel)

          await this.configuration.runWithTenant(tenant, async () => {
            await this._withConnections(async () => {
              await channel.onMetadataChanged(this._metadata)
            })
          })
        }
      }

      return
    }

    if (message.type === "connection-open") {
      await this._handleConnectionOpen(message)
      return
    }

    if (message.type === "connection-message") {
      await this._handleConnectionMessage(message)
      return
    }

    if (message.type === "connection-close") {
      await this._handleConnectionClose(message)
      return
    }

    if (message.type && message.type !== "request") {
      this.sendJson({error: `Unknown message type: ${message.type}`, type: "error"})
      return
    }

    const requestPayload = requestMessage(message)

    if (!requestPayload) {
      this.sendJson({error: `Unknown message type: ${message.type}`, type: "error"})
      return
    }

    const {body, headers, id, method, path} = requestPayload

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
   * @param {{acknowledge?: boolean, channelHandler?: import("../websocket-channel.js").default, lastEventId?: string, params?: Record<string, any>, subscriptionChannel?: string}} [options] - Subscribe options.
   * @returns {Promise<boolean>} - Whether the subscription was added.
   */
  async subscribeToChannel(channel, {acknowledge = true, channelHandler, lastEventId, params, subscriptionChannel} = {}) {
    await websocketEventLogStoreForConfiguration(this.configuration).markChannelInterested(channel)

    const replayState = await this._prepareReplayState({
      channel,
      lastEventId,
      subscriptionChannel: subscriptionChannel || channel,
      subscriptionParams: params
    })

    if (replayState === false) return false
    if (replayState) {
      this.channelReplayStates.set(channel, replayState)
    }

    this.addSubscription(channel)

    if (channelHandler) {
      if (!this.subscriptionHandlers.has(channel)) {
        this.subscriptionHandlers.set(channel, new Set())
      }

      this.subscriptionHandlers.get(channel)?.add(channelHandler)

      if (!this.handlerSubscriptions.has(channelHandler)) {
        this.handlerSubscriptions.set(channelHandler, new Set())
      }

      this.handlerSubscriptions.get(channelHandler)?.add(channel)
    }

    if (replayState) {
      try {
        await this._replayChannelEvents({channel, replayState})
      } finally {
        await this._finishReplayState(channel, replayState)
      }
    }

    if (acknowledge) {
      this.sendJson({channel, type: "subscribed"})
    }
    return true
  }

  _handleClose() {
    void this._runMessageHandlerClose()
    void this._teardownChannel()
    void this._teardownConnections("session_destroyed")
    this.events.emit("close")
  }

  /**
   * Fires `onClose(reason)` on every live app-defined connection, then
   * drops them from the registry. No network frame is sent — the
   * socket is already going away.
   *
   * @param {"session_destroyed" | "error"} reason
   * @returns {Promise<void>}
   */
  async _teardownConnections(reason) {
    const connections = [...this._connections.values()]

    this._connections.clear()

    for (const connection of connections) {
      try {
        await connection.onClose(reason)
      } catch (error) {
        this.logger.error(() => [`Failed to tear down connection ${connection.connectionId}`, error])
      }
    }
  }

  /**
   * Handles a `{type: "connection-open"}` message — instantiates the
   * registered connection class, stores it on `_connections`, and
   * fires `onConnect()`. Sends `connection-opened` on success or
   * `connection-error` on failure.
   *
   * @param {Record<string, any>} message
   * @returns {Promise<void>}
   */
  async _handleConnectionOpen(message) {
    const connectionId = message.connectionId
    const connectionType = message.connectionType
    const params = message.params || {}

    if (typeof connectionId !== "string" || !connectionId) {
      this.sendJson({type: "error", error: "connection-open requires connectionId"})
      return
    }

    if (typeof connectionType !== "string" || !connectionType) {
      this.sendJson({type: "connection-error", connectionId, message: "connectionType is required"})
      return
    }

    if (this._connections.has(connectionId)) {
      this.sendJson({type: "connection-error", connectionId, message: "Connection id already in use"})
      return
    }

    const ConnectionClass = this.configuration.getWebsocketConnectionClass?.(connectionType)

    if (!ConnectionClass) {
      this.sendJson({type: "connection-error", connectionId, message: `Unknown connection type: ${connectionType}`})
      return
    }

    const connection = new ConnectionClass({connectionId, params, session: this})

    this._connections.set(connectionId, connection)

    try {
      await this._withConnections(async () => {
        await connection.onConnect()
      })
      this.sendJson({type: "connection-opened", connectionId})
    } catch (error) {
      this._connections.delete(connectionId)
      this.logger.error(() => [`Failed to open connection ${connectionType}:${connectionId}`, error])
      this.sendJson({type: "connection-error", connectionId, message: /** @type {Error} */ (error).message || "Failed to open connection"})
    }
  }

  /**
   * Handles a `{type: "connection-message"}` from the client.
   *
   * @param {Record<string, any>} message
   * @returns {Promise<void>}
   */
  async _handleConnectionMessage(message) {
    const connectionId = message.connectionId
    const connection = typeof connectionId === "string" ? this._connections.get(connectionId) : null

    if (!connection) {
      this.sendJson({type: "connection-error", connectionId, message: "Unknown connection id"})
      return
    }

    try {
      await this._withConnections(async () => {
        await connection.onMessage(message.body)
      })
    } catch (error) {
      this.logger.error(() => [`Failed to handle connection-message for ${connectionId}`, error])
      this.sendJson({type: "connection-error", connectionId, message: /** @type {Error} */ (error).message || "Failed to handle message"})
    }
  }

  /**
   * Handles a `{type: "connection-close"}` from the client — fires
   * `onClose("client_close")` and confirms with `connection-closed`.
   *
   * @param {Record<string, any>} message
   * @returns {Promise<void>}
   */
  async _handleConnectionClose(message) {
    const connectionId = message.connectionId
    const connection = typeof connectionId === "string" ? this._connections.get(connectionId) : null

    if (!connection) return

    this._connections.delete(connectionId)

    try {
      await connection.onClose("client_close")
    } catch (error) {
      this.logger.error(() => [`Failed to tear down connection ${connectionId}`, error])
    }

    this.sendJson({type: "connection-closed", connectionId, reason: "client_close"})
  }

  async _teardownChannel() {
    for (const channel of this.channels) {
      await this._teardownSingleChannel(channel)
    }
    this.channels.clear()
    this.channelReplayStates.clear()
  }

  /**
   * @param {WebsocketChannel} channel - Channel instance.
   * @returns {Promise<void>} - Resolves when complete.
   */
  async _teardownSingleChannel(channel) {
    try {
      const tenant = this.channelTenants.get(channel)

      await this.configuration.runWithTenant(tenant, async () => {
        await this._withConnections(async () => {
          await channel?.unsubscribed?.()
        })
      })
    } catch (error) {
      this.logger.error(() => ["Failed to teardown websocket channel", error])
    }

    const subscriptions = this.handlerSubscriptions.get(channel)

    if (subscriptions) {
      for (const subscriptionChannel of subscriptions) {
        this.subscriptionHandlers.get(subscriptionChannel)?.delete(channel)

        if (this.subscriptionHandlers.get(subscriptionChannel)?.size === 0) {
          this.subscriptionHandlers.delete(subscriptionChannel)
        }
      }

      this.handlerSubscriptions.delete(channel)
    }

    this.channelTenants.delete(channel)
  }

  /**
   * @param {WebsocketChannel | undefined} channel - Channel instance.
   * @param {string | null | undefined} tenant - Tenant key.
   * @returns {Promise<void>} - Resolves when complete.
   */
  async _registerChannel(channel, tenant) {
    if (!channel) return

    this.channels.add(channel)
    this.channelTenants.set(channel, tenant)
    await this.configuration.runWithTenant(tenant, async () => {
      await this._withConnections(async () => {
        await channel?.subscribed?.()
      })
    })
  }

  /**
   * @param {() => Promise<void>} callback - Callback.
   * @returns {Promise<void>} - Resolves when complete.
   */
  async _withConnections(callback) {
    await this.configuration.ensureConnections(async () => {
      await callback()
    })
  }

  /**
   * @param {{channel: string, lastEventId?: string, params?: Record<string, any>}} args - Subscription args.
   * @returns {Promise<void>} - Resolves when complete.
   */
  async _handleChannelSubscription({channel, lastEventId, params}) {
    const resolver = this.configuration.getWebsocketChannelResolver?.()

    if (!resolver) return

    try {
      const tenant = await this._resolveTenant({channel, params})
      const resolved = await this.configuration.runWithTenant(tenant, async () => {
        return await resolver({
          client: this.client,
          configuration: this.configuration,
          request: this.upgradeRequest,
          subscription: {channel, params},
          websocketSession: this
        })
      })

      if (!resolved) {
        this.sendJson({channel, error: "Subscription rejected", type: "error"})
        return
      }

      const channelInstance = typeof resolved === "function"
        ? new resolved({
          client: this.client,
          configuration: this.configuration,
          lastEventId,
          request: this.upgradeRequest,
          subscriptionChannel: channel,
          subscriptionParams: params,
          websocketSession: this
        })
        : resolved

      if (channelInstance && !(channelInstance instanceof WebsocketChannel)) {
        throw new Error("Resolved websocket channel must extend WebsocketChannel")
      }

      await this._registerChannel(channelInstance, tenant)
    } catch (error) {
      this.logger.warn(() => ["Websocket channel subscription failed", error])
      this.sendJson({channel, error: "Subscription rejected", type: "error"})
    }
  }

  /**
   * @param {object} args - Options.
   * @param {string} args.channel - Internal channel name.
   * @param {string | undefined} args.lastEventId - Last received event id.
   * @param {string} args.subscriptionChannel - Client-facing channel name.
   * @param {Record<string, any> | undefined} args.subscriptionParams - Client-facing params.
   * @returns {Promise<false | {buffered: boolean, ceilingSequence: number, checkpointSequence: number, replaying: boolean} | null>} - Replay state.
   */
  async _prepareReplayState({channel, lastEventId, subscriptionChannel, subscriptionParams}) {
    if (!lastEventId) return null

    const store = websocketEventLogStoreForConfiguration(this.configuration)
    const checkpoint = await store.getEventById({channel, id: lastEventId})

    if (!checkpoint) {
      this.sendJson({channel: subscriptionChannel, lastEventId, params: subscriptionParams, type: "replay-gap"})
      return false
    }

    return {
      buffered: false,
      ceilingSequence: (await store.latestSequence(channel)) || checkpoint.sequence,
      checkpointSequence: checkpoint.sequence,
      replaying: true
    }
  }

  /**
   * @param {object} args - Options.
   * @param {string} args.channel - Channel name.
   * @param {{buffered: boolean, ceilingSequence: number, checkpointSequence: number, replaying: boolean}} args.replayState - Replay state.
   * @returns {Promise<void>} - Resolves when replay completes.
   */
  async _replayChannelEvents({channel, replayState}) {
    const store = websocketEventLogStoreForConfiguration(this.configuration)
    const events = await store.getEventsAfter({
      channel,
      sequence: replayState.checkpointSequence,
      upToSequence: replayState.ceilingSequence
    })

    for (const event of events) {
      await this.sendEvent(channel, event.payload, {
        createdAt: event.createdAt,
        eventId: event.id,
        replayed: true,
        sequence: event.sequence
      })
    }
  }

  /**
   * @param {string} channel - Channel name.
   * @param {{buffered: boolean, ceilingSequence: number, checkpointSequence: number, replaying: boolean}} replayState - Replay state.
   * @returns {Promise<void>} - Resolves when buffered events are flushed.
   */
  async _finishReplayState(channel, replayState) {
    const store = websocketEventLogStoreForConfiguration(this.configuration)

    replayState.replaying = false
    this.channelReplayStates.delete(channel)

    if (!replayState.buffered) return

    const liveEvents = await store.getEventsAfter({
      channel,
      sequence: replayState.ceilingSequence
    })

    for (const event of liveEvents) {
      await this.sendEvent(channel, event.payload, {
        createdAt: event.createdAt,
        eventId: event.id,
        sequence: event.sequence
      })
    }
  }

  /**
   * @param {{channel?: string, params?: Record<string, unknown>}} args - Tenant resolution args.
   * @returns {Promise<string | null | undefined>} - Resolved tenant.
   */
  async _resolveTenant({channel, params}) {
    const requestParams = this.upgradeRequest?.params?.()
    const mergedParams = {
      ...(requestParams && typeof requestParams === "object" ? requestParams : {}),
      ...(params && typeof params === "object" ? params : {})
    }

    return /** @type {Promise<string | null | undefined>} */ (this.configuration.resolveTenant({
      params: mergedParams,
      request: this.upgradeRequest,
      response: undefined,
      subscription: channel ? {channel, params} : undefined
    }))
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

  /**
   * @param {WebsocketSessionMessage} message - Incoming websocket message.
   * @returns {Promise<void>} - Resolves when complete.
   */
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
        await onError({error: error instanceof Error ? error : new Error(String(error)), session: this})
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
