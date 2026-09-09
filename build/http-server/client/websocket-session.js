// @ts-check

import { randomUUID } from "node:crypto"
import { ensureError } from "typanic"

import { ValidationError } from "../../database/record/index.js"
import Logger from "../../logger.js"
import EventEmitter from "../../utils/event-emitter.js"
import isPlainObject from "../../utils/plain-object.js"
import VelociousError from "../../velocious-error.js"
import WebsocketChannel from "../websocket-channel.js"
import { websocketEventLogStoreForConfiguration } from "../websocket-event-log-store.js"
import RequestRunner from "./request-runner.js"
import RequestTiming from "./request-timing.js"
import WebsocketRequest from "./websocket-request.js"

/**
 * Defines this typedef.
 * @typedef {{type: "subscribe", channel: string, lastEventId?: string, params?: Record<string, ReturnType<typeof JSON.parse>>} | {type: "metadata", data?: Record<string, ReturnType<typeof JSON.parse>>} | {type?: "request", body?: ReturnType<typeof JSON.parse>, headers?: Record<string, ReturnType<typeof JSON.parse>>, id?: string | number | null, method: string, path: string} | Record<string, ReturnType<typeof JSON.parse>>} WebsocketSessionMessage
 */

/**
 * @typedef {object} InboundMessageAdmission
 * @property {number} byteLength - Exact raw text payload bytes charged to this admission.
 * @property {number} generation - Accounting generation active when admitted.
 * @property {boolean} released - Whether this admission has already been released.
 */

/**
 * @typedef {object} InboundMessageWork
 * @property {InboundMessageAdmission} admission - Admission ownership.
 * @property {WebsocketSessionMessage} message - Decoded client message.
 */

const WEBSOCKET_FINAL_FRAME = 0x80
const WEBSOCKET_OPCODE_CONTINUATION = 0x0
const WEBSOCKET_OPCODE_TEXT = 0x1
const WEBSOCKET_OPCODE_BINARY = 0x2
const WEBSOCKET_OPCODE_CLOSE = 0x8
const WEBSOCKET_OPCODE_PING = 0x9
const WEBSOCKET_OPCODE_PONG = 0xA

const WEBSOCKET_CLOSE_NORMAL = 1000
const WEBSOCKET_CLOSE_POLICY_VIOLATION = 1008
const WEBSOCKET_INBOUND_BACKLOG_CLOSE_REASON = "Inbound message backlog exceeded"
const WEBSOCKET_MAX_CLOSE_REASON_BYTES = 123

/** Cap on the paused outbound queue; oldest frames drop on overflow. */
const WEBSOCKET_PAUSED_QUEUE_CAP = 1000

/** Cap on total bytes buffered for a single fragmented message. */
const WEBSOCKET_MAX_FRAGMENTED_MESSAGE_BYTES = 16 * 1024 * 1024

/** Cap on payload bytes buffered for a single final data frame. */
const WEBSOCKET_MAX_FINAL_FRAME_BYTES = WEBSOCKET_MAX_FRAGMENTED_MESSAGE_BYTES

const WEBSOCKET_MAX_INBOUND_FRAME_BYTES_BIGINT = BigInt(WEBSOCKET_MAX_FINAL_FRAME_BYTES)

/** Cap on fragment count for a single fragmented message. */
const WEBSOCKET_MAX_FRAGMENTED_MESSAGE_FRAGMENTS = 1024

/**
 * Runs subscribe message.
 * @param {WebsocketSessionMessage} message - Raw websocket message.
 * @returns {{type: "subscribe", channel: string, lastEventId?: string, params?: Record<string, ReturnType<typeof JSON.parse>>} | null} - Subscribe message when matched.
 */
function subscribeMessage(message) {
  return message.type === "subscribe"
    ? /** @type {{type: "subscribe", channel: string, lastEventId?: string, params?: Record<string, ReturnType<typeof JSON.parse>>}} */ (message)
    : null
}

/**
 * Runs request message.
 * @param {WebsocketSessionMessage} message - Raw websocket message.
 * @returns {{type?: "request", body?: ReturnType<typeof JSON.parse>, headers?: Record<string, ReturnType<typeof JSON.parse>>, id?: string | number | null, method: string, path: string} | null} - Request message when matched.
 */
function requestMessage(message) {
  if (message.type && message.type !== "request") return null

  return /** @type {{type?: "request", body?: ReturnType<typeof JSON.parse>, headers?: Record<string, ReturnType<typeof JSON.parse>>, id?: string | number | null, method: string, path: string}} */ (message)
}

/**
 * Compares two identity values from `getWebsocketSessionIdentityResolver`.
 * Nullish values compare equal to each other but not to a real identity.
 * Plain objects are compared via JSON round-trip so apps can return a
 * `{userId, tenantId}`-style object without building their own equality.
 * @param {ReturnType<typeof JSON.parse>} a - Paused-time identity.
 * @param {ReturnType<typeof JSON.parse>} b - Resume-time identity.
 * @returns {boolean} - True when the two identities are considered the same caller.
 */
function identitiesMatch(a, b) {
  if (a === b) return true
  if (a == null || b == null) return false
  if (typeof a !== "object" || typeof b !== "object") return false

  try {
    return JSON.stringify(a) === JSON.stringify(b)
  } catch {
    return false
  }
}

export default class VelociousHttpServerClientWebsocketSession {
  events = new EventEmitter()
  subscriptions = new Set()
  channels = new Set()
  subscriptionHandlers = new Map()
  handlerSubscriptions = new Map()
  channelTenants = new Map()
  channelReplayStates = new Map()
  /**
   * Message queue.
   * @type {InboundMessageWork[]} */
  messageQueue = []

  /**
   * Runs constructor.
   * @param {object} args - Options object.
   * @param {import("../../configuration.js").default} args.configuration - Configuration instance.
   * @param {import("./index.js").default} args.client - Client instance.
   * @param {import("./request.js").default | import("./websocket-request.js").default} [args.upgradeRequest] - Initial websocket upgrade request.
   * @param {import("../../configuration-types.js").WebsocketMessageHandler} [args.messageHandler] - Optional raw message handler.
   * @param {Promise<import("../../configuration-types.js").WebsocketMessageHandler | void>} [args.messageHandlerPromise] - Optional raw message handler promise.
   */
  constructor({client, configuration, upgradeRequest, messageHandler, messageHandlerPromise}) {
    /** @type {Buffer[]} */
    this._bufferChunks = []
    this._bufferChunkIndex = 0
    this._bufferChunkOffset = 0
    this._bufferedBytes = 0
    this._bufferedFrameCopyBytes = 0
    this.client = client
    this.configuration = configuration
    this.upgradeRequest = upgradeRequest
    this.messageHandler = messageHandler
    this.messageHandlerPromise = messageHandlerPromise
    this.pendingMessageHandler = Boolean(messageHandlerPromise)
    this.logger = new Logger(this)
    const inboundQueueLimits = this.configuration.getWebsocketInboundQueueLimits()

    this._inboundMaxPendingBytes = inboundQueueLimits.maxBytes
    this._inboundMaxPendingMessages = inboundQueueLimits.maxMessages
    this._inboundPendingBytes = 0
    this._inboundPendingMessages = 0
    this._inboundAccountingGeneration = 0
    this._inboundClosed = false
    this._inboundBacklogOverloaded = false

    /**
     * Narrows the runtime value to the documented type.
     * @type {Record<string, ReturnType<typeof JSON.parse>>} */
    this._metadata = {}

    /**
     * Long-lived per-session state bag. Stable across reconnects once
     * grace-period resumption lands in Phase 2; today it just lives
     * for the duration of the underlying socket.
     * @type {Record<string, ReturnType<typeof JSON.parse>>}
     */
    this.data = {}

    /**
     * Narrows the runtime value to the documented type.
     * @type {Map<string, import("../websocket-connection.js").default>} */
    this._connections = new Map()

    /**
     * Narrows the runtime value to the documented type.
     * @type {Map<string, {channelType: string, subscription: import("../websocket-channel.js").default}>} */
    this._channelSubscriptions = new Map()

    /**
     * Unique id assigned to this session on first connect. Sent to the
     * client via `session-established`; the client echoes it back via
     * `session-resume` after a WS drop to reattach to this session
     * within the grace period.
     * @type {string}
     */
    this.sessionId = randomUUID()

    /**
     * Narrows the runtime value to the documented type.
     * @type {boolean} - true after `_handleClose` pauses instead of tearing down.
     */
    this._paused = false

    /**
     * Narrows the runtime value to the documented type.
     * @type {Array<ReturnType<typeof JSON.parse>>} - frames produced while paused; flushed on resume.
     */
    this._outboundQueue = []

    /**
     * Narrows the runtime value to the documented type.
     * @type {import("./index.js").default | null} */
    this.socket = null

    /**
     * Tail of a per-session promise chain that serializes message
     * handling. Prevents races where message B reads `session.data`
     * before message A's handler finishes writing it (e.g. a
     * connection-message setting the locale vs. a subsequent request
     * whose aroundRequest wrapper reads it).
     * @type {Promise<void>}
     */
    this._messageChain = Promise.resolve()

    /**
     * Promise that resolves to the auth identity captured at pause
     * time by `getWebsocketSessionIdentityResolver`. Awaited at resume
     * time to compare against the fresh caller's identity. Undefined
     * on a live (non-paused) session.
     * @type {Promise<ReturnType<typeof JSON.parse>> | undefined}
     */
    this._resumeIdentityPromise = undefined

    /** @type {string | null} */
    this._claimedSessionId = null

    /**
     * Accumulates payloads for a fragmented websocket message per
     * RFC 6455. Non-null while mid-fragment; cleared when the frame
     * with FIN=1 completes and the message is dispatched.
     * @type {Buffer[] | null}
     */
    this._fragmentedPayloads = null

    /**
     * Opcode (TEXT/BINARY) captured from the first frame of a
     * fragmented message. Continuation frames (opcode 0) inherit it
     * at reassembly time.
     * @type {number | null}
     */
    this._fragmentedOpcode = null

    /**
     * Running byte total for `_fragmentedPayloads`. Used to enforce
     * `WEBSOCKET_MAX_FRAGMENTED_MESSAGE_BYTES` so a peer cannot
     * exhaust memory by streaming non-final fragments indefinitely.
     * @type {number}
     */
    this._fragmentedBytes = 0

    this.configuration._websocketSessions.add(this)

    /**
     * Heartbeat liveness flag. Set true on every inbound frame
     * (including the client's auto-pong) and cleared each time a ping
     * is sent; a still-false flag at the next tick means the socket
     * has gone silent.
     * @type {boolean}
     */
    this._heartbeatAlive = true

    /**
     * Per-session heartbeat interval handle. Started from
     * `sendSessionEstablished` once the socket is live, not at
     * construction, so directly-constructed sessions in tests don't
     * spin up a background timer.
     * @type {ReturnType<typeof setInterval> | null}
     */
    this._heartbeatTimer = null
  }

  /**
   * Sends the client its sessionId + grace window. Called by
   * `VelociousHttpServerClient` after the WS upgrade completes.
   * @returns {void}
   */
  sendSessionEstablished() {
    this._claimOwnership()
    this.sendJson({
      type: "session-established",
      sessionId: this.sessionId,
      graceSeconds: this.configuration.getWebsocketSessionGraceSeconds?.() || 300
    })

    // The socket is live now, so begin reaping it if it goes silent.
    this._startHeartbeat()
  }

  /**
   * Removes a closed connection from the session registry. Called by
   * `VelociousWebsocketConnection.close()` after it sends the final
   * `connection-closed` frame.
   * @param {string} connectionId - Closed connection identifier to remove.
   * @returns {void}
   */
  _removeConnection(connectionId) {
    this._connections.delete(connectionId)
  }

  /**
   * Runs get metadata.
   * @returns {Record<string, ReturnType<typeof JSON.parse>>} - Client-provided metadata (defensive copy).
   */
  getMetadata() {
    return {...this._metadata}
  }

  /**
   * Runs is paused.
   * @returns {boolean} - true while the session is in the paused/grace registry.
   */
  isPaused() {
    return this._paused
  }

  /**
   * Runs add subscription.
   * @param {string} channel - Channel name.
   * @returns {void} - No return value.
   */
  addSubscription(channel) {
    this.subscriptions.add(channel)
  }

  destroy() {
    this._releaseOwnership()
    this._stopHeartbeat()
    this._resetFragmentBuffer()
    this._clearBufferedFrameChunks()
    this._abandonInboundMessages()
    this.configuration._websocketSessions.delete(this)
    this._paused = false
    void this._teardownChannel()
    void this._teardownConnections("session_destroyed")
    void this._teardownChannelSubscriptions()
    this.events.removeAllListeners()
  }

  /** Claims this session id for host-side reconnect routing. */
  _claimOwnership() {
    if (this._claimedSessionId === this.sessionId) return
    if (this._claimedSessionId) this._releaseOwnership()

    this._claimedSessionId = this.sessionId
    this.events.emit("ownershipClaimed", {sessionId: this.sessionId})
  }

  /** Releases the currently claimed session id exactly once. */
  _releaseOwnership() {
    const sessionId = this._claimedSessionId

    if (!sessionId) return

    this._claimedSessionId = null
    this.events.emit("ownershipReleased", {sessionId})
  }

  /**
   * Runs has subscription.
   * @param {string} channel - Channel name.
   * @returns {boolean} - Whether it has subscription.
   */
  hasSubscription(channel) {
    return this.subscriptions.has(channel)
  }

  /**
   * Runs on data.
   * @param {Buffer} data - Data payload.
   * @returns {void} - No return value.
   */
  onData(data) {
    // Any inbound bytes — a data frame, the auto-pong answering our
    // heartbeat, or a partial frame still being uploaded — prove the
    // socket is alive. Mark it here, before `_processBuffer` may return
    // early waiting for the rest of an incomplete frame.
    this._heartbeatAlive = true
    if (this._inboundClosed || data.length === 0) return

    this._bufferChunks.push(data)
    this._bufferedBytes += data.length
    this._processBuffer()
  }

  /**
   * Runs send event.
   * @param {string} channel - Channel name.
   * @param {ReturnType<typeof JSON.parse>} payload - Payload data.
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
   * Runs initialize channel.
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
    } catch (caughtError) {
      const error = this._reportUnexpectedDispatchError(caughtError, {
        stage: "websocket-channel-initialize"
      })

      this.logger.error(() => ["Failed to initialize websocket channel", error])
    }
  }

  /**
   * Runs send goodbye.
   * @param {import("./index.js").default} client - Client instance.
   * @param {{code?: number, reason?: string}} [options] - Optional close status.
   * @returns {void} - No return value.
   */
  sendGoodbye(client, {code, reason = ""} = {}) {
    let payload

    if (code === undefined) {
      payload = Buffer.alloc(0)
    } else {
      const reasonBytes = Buffer.from(reason, "utf-8")

      if (reasonBytes.length > WEBSOCKET_MAX_CLOSE_REASON_BYTES) {
        throw new RangeError("WebSocket close reason must not exceed 123 UTF-8 bytes")
      }

      payload = Buffer.allocUnsafe(2 + reasonBytes.length)
      payload.writeUInt16BE(code, 0)
      reasonBytes.copy(payload, 2)
    }

    const frame = Buffer.concat([
      Buffer.from([WEBSOCKET_FINAL_FRAME | WEBSOCKET_OPCODE_CLOSE, payload.length]),
      payload
    ])

    client.events.emit("output", frame, {websocketFrame: true})
  }

  /**
   * Whether a caught dispatch error is an expected client-flow failure.
   * @param {Error} error - Normalized dispatch error.
   * @returns {boolean} - Whether framework error reporters should ignore it.
   */
  _expectedClientError(error) {
    if (error instanceof ValidationError) return true
    if (error instanceof VelociousError && error.safeToExpose) return true

    const annotatedError = /** @type {Error & {errorType?: string, velocious?: Record<string, ReturnType<typeof JSON.parse>>}} */ (error)

    if (isPlainObject(annotatedError.velocious)) return true

    return typeof annotatedError.errorType === "string" && annotatedError.errorType.length > 0
  }

  /**
   * Reports one unexpected WebSocket dispatch failure and returns its redacted Error diagnostic.
   * @param {ReturnType<typeof JSON.parse>} caughtError - Caught dispatch failure.
   * @param {Record<string, ReturnType<typeof JSON.parse>>} context - Structured dispatch context.
   * @returns {Error} - Redacted error for logs and framework error events.
   */
  _reportUnexpectedDispatchError(caughtError, context) {
    const error = ensureError(caughtError)
    const redactor = this.configuration.getLogRedactor()
    const requestTiming = this.configuration.getCurrentRequestTiming()
    let sensitiveValues = requestTiming ? requestTiming.getLogSensitiveValues() : new Set()

    if (this.upgradeRequest) {
      sensitiveValues = redactor.requestSensitiveValues(this.upgradeRequest, sensitiveValues)
    }

    const redactedError = redactor.redactError(error, sensitiveValues)
    const redactedContext = /** @type {Record<string, ReturnType<typeof JSON.parse>>} */ (
      redactor.redactStructured(context, sensitiveValues)
    )

    if (this._expectedClientError(error)) return redactedError

    const errorPayload = {
      context: redactedContext,
      error: redactedError,
      request: this.upgradeRequest
    }
    const errorEvents = this.configuration.getErrorEvents()

    errorEvents.emit("framework-error", errorPayload)
    errorEvents.emit("all-error", {...errorPayload, errorType: "framework-error"})

    return redactedError
  }

  /**
   * Runs handle message.
   * @param {WebsocketSessionMessage} message - Message text.
   * @returns {Promise<void>} - Resolves when complete.
   */
  async _handleMessage(message) {
    const admission = this._admitInboundMessage(0)

    if (!admission) return
    await this._handleMessageWork({admission, message})
  }

  /**
   * Appends an admitted message to the per-session FIFO chain.
   * @param {InboundMessageWork} work - Admitted decoded message.
   * @returns {Promise<void>} - Resolves when complete.
   */
  async _handleMessageWork(work) {
    // Serialize per-session: chain onto `_messageChain` so messages
    // are processed one at a time. Without this, fire-and-forget
    // dispatch from `_processBuffer` lets message B read
    // `session.data` before A has finished writing it.
    const previous = this._messageChain
    const next = previous.then(() => this._runMessageWork(work))

    this._messageChain = next.catch(() => {})
    await next
  }

  /**
   * Dispatches or transfers one admitted message while retaining its accounting.
   * @param {InboundMessageWork} work - Admitted decoded message.
   * @returns {Promise<void>} - Resolves after dispatch or resolver-queue transfer.
   */
  async _runMessageWork(work) {
    if (this._inboundClosed) {
      this._releaseInboundAdmission(work.admission)
      return
    }

    if (this.pendingMessageHandler) {
      this.messageQueue.push(work)
      return
    }

    try {
      await this._dispatchMessage(work.message)
    } finally {
      this._releaseInboundAdmission(work.admission)
    }
  }

  /**
   * Runs dispatch message.
   * @param {WebsocketSessionMessage} message - Message text.
   * @returns {Promise<void>} - Resolves when complete.
   */
  async _dispatchMessage(message) {
    await this._runWithMessageLogContext(message, async () => {
      const wrapper = this.configuration.getWebsocketAroundRequest?.()

      if (wrapper) {
        await wrapper(this, () => this._handleMessageInner(message))
        return
      }

      await this._handleMessageInner(message)
    })
  }

  /**
   * Runs one decoded message in its own request timing and sensitive-value context.
   * @param {WebsocketSessionMessage} message - Decoded client message.
   * @param {() => Promise<void>} callback - Message dispatch callback.
   * @returns {Promise<void>} - Resolves after the message finishes.
   */
  async _runWithMessageLogContext(message, callback) {
    const requestTiming = new RequestTiming()
    const redactor = this.configuration.getLogRedactor()
    let sensitiveValues = redactor.sensitiveValues(message)

    sensitiveValues = redactor.sensitiveValues(this.getMetadata(), sensitiveValues)

    if (this.upgradeRequest) {
      sensitiveValues = redactor.requestSensitiveValues(this.upgradeRequest, sensitiveValues)
    }

    requestTiming.registerLogSensitiveValues(sensitiveValues)

    await this.configuration.runWithRequestTiming(requestTiming, callback)
  }

  /**
   * The actual message dispatch, extracted so
   * `configuration.getWebsocketAroundRequest()` can wrap it in any
   * per-request context (AsyncLocalStorage, tracing, etc.).
   * @param {WebsocketSessionMessage} message - Decoded client frame to dispatch by message type.
   * @returns {Promise<void>}
   */
  async _handleMessageInner(message) {
    // The messageHandler short-circuits default routing only when the
    // app actually declared an `onMessage` hook. Apps that only want
    // session-lifecycle tracking (`onOpen`/`onClose`) still need the
    // built-in subscribe/connection/channel-subscribe routing below,
    // otherwise every incoming message is silently dropped.
    if (this.messageHandler && typeof this.messageHandler.onMessage === "function") {
      await this._runMessageHandlerMessage(message)
      return
    }

    const subscribePayload = subscribeMessage(message)

    if (subscribePayload) {
      const {channel, lastEventId, params} = subscribePayload

      if (!channel) throw VelociousError.safe("channel is required for subscribe")
      const resolver = this.configuration.getWebsocketChannelResolver?.()

      if (resolver) {
        await this._handleChannelSubscription({channel, lastEventId, params})
      } else {
        await this.subscribeToChannel(channel, {acknowledge: true, lastEventId, params})
      }

      return
    }

    if (message.type === "metadata") {
      const metadataPayload = /** @type {{data?: Record<string, ReturnType<typeof JSON.parse>>}} */ (message)

      this._metadata = metadataPayload.data && typeof metadataPayload.data === "object" ? {...metadataPayload.data} : {}

      for (const {subscription} of this._channelSubscriptions.values()) {
        if (typeof subscription.onMetadataChanged === "function") {
          await this._withConnections(async () => {
            await subscription.onMetadataChanged(this._metadata)
          })
        }
      }

      return
    }

    if (message.type === "session-resume") {
      await this._handleSessionResume(message)
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

    if (message.type === "channel-subscribe") {
      await this._handleChannelSubscribe(message)
      return
    }

    if (message.type === "channel-unsubscribe") {
      await this._handleChannelUnsubscribe(message)
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

    if (!method) throw VelociousError.safe("method is required")
    if (!path) throw VelociousError.safe("path is required")

    const request = new WebsocketRequest({
      body,
      headers,
      metadata: this.getMetadata(),
      method,
      path,
      remoteAddress: this.remoteAddress()
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
      void requestRunner.logCompletedRequest().catch((error) => {
        this.logger.warn("Failed to log completed request", error)
      })
    })

    await requestRunner.run()
  }

  /**
   * Runs process buffer.
   * @returns {void} - No return value.
   */
  _processBuffer() {
    while (this._bufferedBytes >= 2) {
      const initialHeader = this._peekBufferedBytes(2)
      const firstByte = initialHeader[0]
      const secondByte = initialHeader[1]
      const isFinal = (firstByte & WEBSOCKET_FINAL_FRAME) === WEBSOCKET_FINAL_FRAME
      const opcode = firstByte & 0x0F
      const isMasked = (secondByte & 0x80) === 0x80
      let payloadLength = secondByte & 0x7F
      let offset = 2

      if (payloadLength === 126) {
        if (this._bufferedBytes < offset + 2) return
        payloadLength = this._peekBufferedBytes(offset + 2).readUInt16BE(offset)
        offset += 2
      } else if (payloadLength === 127) {
        if (this._bufferedBytes < offset + 8) return
        const bigLength = this._peekBufferedBytes(offset + 8).readBigUInt64BE(offset)

        if (bigLength > WEBSOCKET_MAX_INBOUND_FRAME_BYTES_BIGINT) {
          this.logger.warn(() => [
            "Websocket frame exceeded byte cap; closing connection",
            {frameBytes: bigLength.toString(), maxBytes: WEBSOCKET_MAX_FINAL_FRAME_BYTES}
          ])
          this._closeForInboundLimit()
          return
        }

        payloadLength = Number(bigLength)
        offset += 8
      }

      const maskLength = isMasked ? 4 : 0

      const frameLength = offset + maskLength + payloadLength

      if (this._bufferedBytes < frameLength) return

      const frame = this._consumeBufferedBytes(frameLength)

      /** @type {Buffer} */
      let payload = frame.subarray(offset + maskLength, frameLength)

      if (isMasked) {
        const mask = frame.subarray(offset, offset + maskLength)
        this._unmaskPayload(payload, mask)
      }

      // Control frames (opcode >= 0x8) must not be fragmented per
      // RFC 6455 and can arrive interleaved with a fragmented data
      // message. Handle them first without touching the fragment
      // accumulator.
      if (opcode === WEBSOCKET_OPCODE_PING) {
        this._sendControlFrame(WEBSOCKET_OPCODE_PONG, payload)
        continue
      }

      if (opcode === WEBSOCKET_OPCODE_CLOSE) {
        const allowResume = payload.length < 2 || payload.readUInt16BE(0) !== WEBSOCKET_CLOSE_NORMAL

        this.sendGoodbye(this.client)
        this._handleClose({allowResume})
        continue
      }

      if (opcode === WEBSOCKET_OPCODE_PONG) {
        // Answer to a heartbeat ping; liveness is recorded in onData.
        continue
      }

      if (opcode >= 0x8) {
        this.logger.warn(`Unsupported websocket control opcode: ${opcode}`)
        continue
      }

      // Data frame (TEXT/BINARY/CONTINUATION). Reassemble fragments
      // before dispatching. Browsers (Chrome) legitimately fragment
      // longer client→server text frames; a prior version dropped
      // every fragmented message silently, so any payload large
      // enough to hit the browser's fragmentation threshold
      // (e.g. a channel-subscribe with an auth token) never reached
      // the handler.
      if (opcode === WEBSOCKET_OPCODE_CONTINUATION) {
        if (this._fragmentedPayloads === null) {
          this.logger.warn("Received continuation frame with no fragmented message in progress")
          continue
        }

        if (!this._appendFragment(payload)) return

        if (!isFinal) continue
      } else if (opcode === WEBSOCKET_OPCODE_TEXT || opcode === WEBSOCKET_OPCODE_BINARY) {
        if (this._fragmentedPayloads !== null) {
          this.logger.warn("Received new data frame while a fragmented message was in progress; discarding prior fragments")
          this._resetFragmentBuffer()
        }

        if (!isFinal) {
          this._fragmentedPayloads = [payload]
          this._fragmentedOpcode = opcode
          this._fragmentedBytes = payload.length

          if (!this._enforceFragmentLimits()) return

          continue
        }
      } else {
        this.logger.warn(`Unsupported websocket data opcode: ${opcode}`)
        continue
      }

      /**
       * Defines finalPayload.
       * @type {Buffer} */
      let finalPayload
      /**
       * Defines finalOpcode.
       * @type {number} */
      let finalOpcode

      if (this._fragmentedPayloads !== null) {
        if (opcode === WEBSOCKET_OPCODE_CONTINUATION) {
          finalPayload = Buffer.concat(this._fragmentedPayloads)
          finalOpcode = this._fragmentedOpcode ?? WEBSOCKET_OPCODE_TEXT
        } else {
          finalPayload = payload
          finalOpcode = opcode
        }
        this._resetFragmentBuffer()
      } else {
        finalPayload = payload
        finalOpcode = opcode
      }

      if (finalOpcode !== WEBSOCKET_OPCODE_TEXT) {
        this.logger.warn(`Unsupported websocket data opcode after reassembly: ${finalOpcode}`)
        continue
      }

      const admission = this._admitInboundMessage(finalPayload.length)

      if (!admission) return

      try {
        const message = JSON.parse(finalPayload.toString("utf-8"))

        this._handleMessageWork({admission, message}).catch((caughtError) => {
          const clientErrorMessage = caughtError instanceof Error ? caughtError.message : String(caughtError)
          const error = this._reportUnexpectedDispatchError(caughtError, {
            stage: "websocket-message-dispatch"
          })

          this.logger.error(() => ["Websocket message handler failed", error])
          this.sendJson({
            error: clientErrorMessage,
            type: "error"
          })
        })
      } catch (error) {
        this._releaseInboundAdmission(admission)
        this.logger.error(() => ["Failed to parse websocket message", error])
        this.sendJson({error: "Invalid websocket message", type: "error"})
      }
    }
  }

  /**
   * Copies the leading buffered bytes without consuming them. Header
   * inspection is bounded to the websocket header size.
   * @param {number} byteCount - Number of leading bytes to inspect.
   * @returns {Buffer} - Copied prefix.
   */
  _peekBufferedBytes(byteCount) {
    const prefix = Buffer.allocUnsafe(byteCount)
    let copiedBytes = 0
    let chunkOffset = this._bufferChunkOffset

    for (let chunkIndex = this._bufferChunkIndex; chunkIndex < this._bufferChunks.length; chunkIndex += 1) {
      const chunk = this._bufferChunks[chunkIndex]
      const bytesFromChunk = Math.min(chunk.length - chunkOffset, byteCount - copiedBytes)

      chunk.copy(prefix, copiedBytes, chunkOffset, chunkOffset + bytesFromChunk)
      copiedBytes += bytesFromChunk
      chunkOffset = 0
      if (copiedBytes === byteCount) break
    }

    return prefix
  }

  /**
   * Consumes a complete frame from the chunk queue with one bounded copy.
   * @param {number} byteCount - Complete frame byte count.
   * @returns {Buffer} - Contiguous frame bytes.
   */
  _consumeBufferedBytes(byteCount) {
    const result = Buffer.allocUnsafe(byteCount)
    let copiedBytes = 0

    while (copiedBytes < byteCount) {
      const chunk = this._bufferChunks[this._bufferChunkIndex]
      const bytesFromChunk = Math.min(chunk.length - this._bufferChunkOffset, byteCount - copiedBytes)

      chunk.copy(
        result,
        copiedBytes,
        this._bufferChunkOffset,
        this._bufferChunkOffset + bytesFromChunk
      )
      copiedBytes += bytesFromChunk
      this._bufferChunkOffset += bytesFromChunk

      if (this._bufferChunkOffset === chunk.length) {
        this._bufferChunkIndex += 1
        this._bufferChunkOffset = 0
      }
    }

    if (this._bufferChunkIndex === this._bufferChunks.length) {
      this._bufferChunks = []
      this._bufferChunkIndex = 0
    } else if (
      this._bufferChunkIndex >= 64 &&
      this._bufferChunkIndex * 2 >= this._bufferChunks.length
    ) {
      this._bufferChunks = this._bufferChunks.slice(this._bufferChunkIndex)
      this._bufferChunkIndex = 0
    }

    this._bufferedBytes -= byteCount
    this._bufferedFrameCopyBytes += byteCount

    return result
  }

  /**
   * Drops all incomplete frame chunks.
   * @returns {void}
   */
  _clearBufferedFrameChunks() {
    this._bufferChunks = []
    this._bufferChunkIndex = 0
    this._bufferChunkOffset = 0
    this._bufferedBytes = 0
  }

  /**
   * Tentatively admits one complete text message before decoding it.
   * @param {number} byteLength - Exact complete raw text payload bytes.
   * @returns {InboundMessageAdmission | null} - Admission ownership, or null after overload/close.
   */
  _admitInboundMessage(byteLength) {
    if (this._inboundClosed) return null

    if (
      this._inboundPendingMessages + 1 > this._inboundMaxPendingMessages ||
      this._inboundPendingBytes + byteLength > this._inboundMaxPendingBytes
    ) {
      this._closeForInboundBacklog(byteLength)
      return null
    }

    this._inboundPendingMessages += 1
    this._inboundPendingBytes += byteLength

    return {
      byteLength,
      generation: this._inboundAccountingGeneration,
      released: false
    }
  }

  /**
   * Releases one admission exactly once.
   * @param {InboundMessageAdmission} admission - Admission ownership.
   * @returns {void}
   */
  _releaseInboundAdmission(admission) {
    if (admission.released) return

    admission.released = true
    if (admission.generation !== this._inboundAccountingGeneration) return

    this._inboundPendingMessages -= 1
    this._inboundPendingBytes -= admission.byteLength
  }

  /**
   * Abandons all admitted input and invalidates late settlements.
   * @returns {void}
   */
  _abandonInboundMessages() {
    this._inboundClosed = true
    this._inboundAccountingGeneration += 1
    this._inboundPendingBytes = 0
    this._inboundPendingMessages = 0
    this.messageQueue = []
  }

  /**
   * Permanently closes a session whose next message exceeded its backlog budget.
   * @param {number} rejectedBytes - Raw payload bytes rejected at admission.
   * @returns {void}
   */
  _closeForInboundBacklog(rejectedBytes) {
    if (this._inboundBacklogOverloaded || this._inboundClosed) return

    this._inboundBacklogOverloaded = true
    this.logger.warn(() => [
      "Inbound websocket message backlog exceeded; closing connection",
      {
        maxBytes: this._inboundMaxPendingBytes,
        maxMessages: this._inboundMaxPendingMessages,
        pendingBytes: this._inboundPendingBytes,
        pendingMessages: this._inboundPendingMessages,
        rejectedBytes
      }
    ])
    this.sendGoodbye(this.client, {
      code: WEBSOCKET_CLOSE_POLICY_VIOLATION,
      reason: WEBSOCKET_INBOUND_BACKLOG_CLOSE_REASON
    })
    this._handleClose({allowResume: false})
  }

  /**
   * Closes after an inbound buffering limit and releases all parser-owned input.
   * @returns {void}
   */
  _closeForInboundLimit() {
    this._resetFragmentBuffer()
    this._clearBufferedFrameChunks()
    this.sendGoodbye(this.client)
    this._handleClose()
  }

  /**
   * Appends a continuation-frame payload to the in-progress
   * fragmented message. Returns true when the fragment was accepted
   * and false when the per-message cap was hit and the socket has
   * been closed.
   * @param {Buffer} payload - Continuation-frame bytes to append.
   * @returns {boolean} - Whether the fragment was accepted.
   */
  _appendFragment(payload) {
    // Guard pushing first so `_enforceFragmentLimits` sees the final
    // state; on overflow the reset inside the enforcer drops the
    // buffered fragments.
    this._fragmentedPayloads?.push(payload)
    this._fragmentedBytes += payload.length

    return this._enforceFragmentLimits()
  }

  /**
   * Verifies the fragmented message has not exceeded the byte or
   * fragment-count caps. On overflow, clears the buffer, sends a
   * close frame, and tears the session down. Returns true when the
   * caller can continue processing, false when the session is being
   * closed.
   * @returns {boolean} - Whether fragment processing may continue.
   */
  _enforceFragmentLimits() {
    if (this._fragmentedPayloads === null) return true

    const fragmentCount = this._fragmentedPayloads.length
    const overBytes = this._fragmentedBytes > WEBSOCKET_MAX_FRAGMENTED_MESSAGE_BYTES
    const overFragments = fragmentCount > WEBSOCKET_MAX_FRAGMENTED_MESSAGE_FRAGMENTS

    if (!overBytes && !overFragments) return true

    this.logger.warn(() => [
      "Fragmented websocket message exceeded caps; closing connection",
      {
        fragmentBytes: this._fragmentedBytes,
        fragmentCount,
        maxBytes: WEBSOCKET_MAX_FRAGMENTED_MESSAGE_BYTES,
        maxFragments: WEBSOCKET_MAX_FRAGMENTED_MESSAGE_FRAGMENTS
      }
    ])

    this._closeForInboundLimit()

    return false
  }

  /**
   * Runs reset fragment buffer.
   * @returns {void} */
  _resetFragmentBuffer() {
    this._fragmentedPayloads = null
    this._fragmentedOpcode = null
    this._fragmentedBytes = 0
  }

  /**
   * Starts the per-session heartbeat. Each tick pings the client and
   * reaps the session if the previous ping went unanswered, so a
   * half-open socket (client gone without a TCP FIN / close frame)
   * cannot linger forever holding channel subscriptions. Disabled when
   * the configured interval is 0.
   * @returns {void}
   */
  _startHeartbeat() {
    const intervalSeconds = this.configuration.getWebsocketSessionHeartbeatSeconds()

    if (!intervalSeconds || intervalSeconds <= 0) return

    this._heartbeatTimer = setInterval(() => this._heartbeatTick(), intervalSeconds * 1000)

    // Don't let the heartbeat timer keep the process alive.
    if (typeof this._heartbeatTimer.unref === "function") this._heartbeatTimer.unref()
  }

  /**
   * One heartbeat cycle. Reaps the session via the normal close path
   * when the previous ping was not answered; otherwise marks it
   * pending and pings again. Browsers and React Native sockets answer
   * server pings with an automatic pong, which lands in `_processBuffer`
   * and re-marks the session alive.
   * @returns {void}
   */
  _heartbeatTick() {
    if (this._paused || !this.client?.events) return

    if (!this._heartbeatAlive) {
      // No frame arrived since the last ping — the socket is dead.
      // Route through `_handleClose` so resumable state still pauses
      // for the grace window and everything else is torn down.
      this._stopHeartbeat()
      this._handleClose()
      return
    }

    this._heartbeatAlive = false
    this._sendControlFrame(WEBSOCKET_OPCODE_PING, Buffer.alloc(0))
  }

  /**
   * Stops the per-session heartbeat timer, if any.
   * @returns {void}
   */
  _stopHeartbeat() {
    if (this._heartbeatTimer) {
      clearInterval(this._heartbeatTimer)
      this._heartbeatTimer = null
    }
  }

  /**
   * Runs send control frame.
   * @param {number} opcode - Opcode.
   * @param {Buffer} payload - Payload data.
   * @returns {void} - No return value.
   */
  _sendControlFrame(opcode, payload) {
    const header = Buffer.alloc(2)

    header[0] = WEBSOCKET_FINAL_FRAME | opcode
    header[1] = payload.length

    this.client.events.emit("output", Buffer.concat([header, payload]), {websocketFrame: true})
  }

  /**
   * Runs send json.
   * @param {object} body - Request body.
   * @returns {void} - No return value.
   */
  sendJson(body) {
    // While paused (waiting for a resume), stash frames in an
    // outbound queue and flush them in order on resume. Capped to
    // prevent runaway memory use while the client is offline.
    if (this._paused) {
      this._outboundQueue ||= []

      if (this._outboundQueue.length >= WEBSOCKET_PAUSED_QUEUE_CAP) {
        // Drop oldest so the most recent activity wins on resume.
        this._outboundQueue.shift()
      }

      this._outboundQueue.push(body)
      return
    }

    if (!this.client?.events) return

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

    this.client.events.emit("output", Buffer.concat([header, payload]), {websocketFrame: true})
  }

  /**
   * Flushes the paused outbound queue over the current socket.
   * Called during resume after `session-resumed` has been sent on
   * the NEW session's socket (not this session's).
   * @returns {void}
   */
  _flushOutboundQueue() {
    const queue = this._outboundQueue || []

    this._outboundQueue = []

    for (const body of queue) {
      this.sendJson(body)
    }
  }

  /**
   * Runs subscribe to channel.
   * @param {string} channel - Channel name.
   * @param {{acknowledge?: boolean, channelHandler?: import("../websocket-channel.js").default, lastEventId?: string, params?: Record<string, ReturnType<typeof JSON.parse>>, subscriptionChannel?: string}} [options] - Subscribe options.
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

  /**
   * Handles socket closure and optionally retains resumable state.
   * @param {{allowResume?: boolean}} [options] - Closure behavior.
   * @returns {void}
   */
  _handleClose({allowResume = true} = {}) {
    this._resetFragmentBuffer()
    this._clearBufferedFrameChunks()
    this._abandonInboundMessages()

    // If the session has resumable state (live Connection or
    // ChannelV2 subscription), move it into the paused registry
    // instead of tearing down; a new socket presenting the sessionId
    // via `session-resume` within the grace window will reattach.
    const hasResumableState = this._connections.size > 0 || this._channelSubscriptions.size > 0

    if (allowResume && hasResumableState && !this._paused) {
      // Paused sessions have no live socket to ping; the grace timer
      // owns their eventual teardown from here.
      this._stopHeartbeat()
      this._paused = true
      this.socket = null
      // Kick off auth-identity capture for resume verification. Runs
      // in the background — `_handleSessionResume` awaits
      // `_resumeIdentityPromise` before comparing. Pause registration
      // is synchronous so a resume arriving immediately still finds
      // the session.
      this._resumeIdentityPromise = this._captureResumeIdentity()
      void this._fireOnDisconnect()
      this.configuration._pauseWebsocketSession(this)
      this.events.emit("close")
      return
    }

    this._stopHeartbeat()
    this._releaseOwnership()
    this.configuration._websocketSessions.delete(this)
    void this._runMessageHandlerClose()
    void this._teardownChannel()
    void this._teardownConnections("session_destroyed")
    void this._teardownChannelSubscriptions()
    this.events.emit("close")
  }

  /**
   * Called by the grace timer when the paused period expires without
   * a resume. Tears down all live Connections + Channel subs and
   * drops the session.
   * @returns {void}
   */
  _finalizeGraceExpiry() {
    this._stopHeartbeat()
    this._releaseOwnership()
    this._resetFragmentBuffer()
    this._clearBufferedFrameChunks()
    this._abandonInboundMessages()
    this.configuration._websocketSessions.delete(this)
    void this._runMessageHandlerClose()
    void this._teardownChannel()
    void this._teardownConnections("grace_expired")
    void this._teardownChannelSubscriptions()
    this.events.emit("close")
  }

  /**
   * Runs the configured identity resolver against this session.
   * The returned promise is stored at pause time and awaited at
   * resume time so we can reject resume attempts from a different
   * authenticated caller (signed out, swapped user, expired cookie).
   * @returns {Promise<ReturnType<typeof JSON.parse>>} - Captured authenticated identity for resume validation.
   */
  async _captureResumeIdentity() {
    const resolver = this.configuration.getWebsocketSessionIdentityResolver?.()

    if (typeof resolver !== "function") return undefined

    try {
      return await resolver(this)
    } catch (caughtError) {
      const error = this._reportUnexpectedDispatchError(caughtError, {
        stage: "websocket-session-identity-pause"
      })

      this.logger.error(() => ["Websocket session identity resolver failed at pause", error])
      return undefined
    }
  }

  /**
   * Fires `onDisconnect` on every live Connection and Channel sub so
   * apps can pause per-instance work while the session is paused.
   * Errors are logged, not rethrown — one broken handler must not
   * block the rest.
   * @returns {Promise<void>}
   */
  async _fireOnDisconnect() {
    await this._fireLifecycleCallback("onDisconnect")
  }

  /**
   * Fires `onResume` on every live Connection and Channel sub after
   * a successful `session-resume` handoff.
   * @returns {Promise<void>}
   */
  async _fireOnResume() {
    await this._fireLifecycleCallback("onResume")
  }

  /**
   * Runs fire lifecycle callback.
   * @param {"onDisconnect" | "onResume"} callbackName Lifecycle callback to fire.
   * @returns {Promise<void>} Resolves when every live handler has been attempted.
   */
  async _fireLifecycleCallback(callbackName) {
    for (const connection of this._connections.values()) {
      try {
        await connection[callbackName]?.()
      } catch (caughtError) {
        const error = this._reportUnexpectedDispatchError(caughtError, {
          callbackName,
          connectionId: connection.connectionId,
          stage: "websocket-connection-lifecycle"
        })

        this.logger.error(() => [`${callbackName} failed for ${connection.connectionId}`, error])
      }
    }

    for (const {subscription} of this._channelSubscriptions.values()) {
      try {
        await subscription[callbackName]?.()
      } catch (caughtError) {
        const error = this._reportUnexpectedDispatchError(caughtError, {
          callbackName,
          stage: "websocket-channel-lifecycle",
          subscriptionId: subscription.subscriptionId
        })

        this.logger.error(() => [`${callbackName} failed for channel sub ${subscription.subscriptionId}`, error])
      }
    }
  }

  /**
   * Handles `{type: "session-resume"}`. This session (the newly-
   * created one whose socket just connected) transfers state from
   * the paused session and instructs the client via
   * `session-resumed` or `session-gone`.
   * @param {Record<string, ReturnType<typeof JSON.parse>>} message - Session-resume frame containing the paused session identifier.
   * @returns {Promise<void>}
   */
  async _handleSessionResume(message) {
    const resumeSessionId = message.sessionId

    if (typeof resumeSessionId !== "string" || !resumeSessionId) {
      this.sendJson({type: "session-gone"})
      return
    }

    const paused = this.configuration._findPausedWebsocketSession(resumeSessionId)

    if (!paused) {
      this.sendJson({type: "session-gone"})
      return
    }

    // Auth re-verify: compare the fresh caller's identity against the
    // one captured at pause. Mismatch means a different user (or a
    // signed-out session) is trying to reclaim state that isn't
    // theirs — destroy the paused session outright.
    const resolver = this.configuration.getWebsocketSessionIdentityResolver?.()

    if (typeof resolver === "function") {
      const pausedIdentity = await paused._resumeIdentityPromise
      let freshIdentity

      try {
        freshIdentity = await resolver(this)
      } catch (caughtError) {
        const error = this._reportUnexpectedDispatchError(caughtError, {
          stage: "websocket-session-identity-resume"
        })

        this.logger.error(() => ["Websocket session identity resolver failed at resume", error])
        freshIdentity = undefined
      }

      if (!identitiesMatch(pausedIdentity, freshIdentity)) {
        this.configuration._clearPausedWebsocketSession(resumeSessionId)
        paused._finalizeGraceExpiry()
        this.sendJson({type: "session-gone"})
        return
      }
    }

    this.configuration._clearPausedWebsocketSession(resumeSessionId)

    this._releaseOwnership()
    paused._releaseOwnership()

    // Transfer resumable state onto this (live) session. The paused
    // session shell is discarded after the transfer.
    for (const [connectionId, connection] of paused._connections) {
      connection.session = this
      this._connections.set(connectionId, connection)
    }

    for (const [subId, entry] of paused._channelSubscriptions) {
      entry.subscription.session = this
      this._channelSubscriptions.set(subId, entry)
    }

    this._metadata = {...paused._metadata}
    this.data = paused.data
    this.sessionId = resumeSessionId

    // Transfer any frames queued while the paused session had no
    // socket. They flush AFTER session-resumed so the client knows
    // which session they belong to.
    const queued = paused._outboundQueue || []

    paused._outboundQueue = []
    paused._connections.clear()
    paused._channelSubscriptions.clear()
    paused._paused = false
    paused.destroy()

    this._claimOwnership()
    this.sendJson({type: "session-resumed", sessionId: resumeSessionId})
    for (const body of queued) this.sendJson(body)
    await this._fireOnResume()
  }

  /**
   * Fires `onClose(reason)` on every live app-defined connection, then
   * drops them from the registry. No network frame is sent — the
   * socket is already going away.
   * @param {"session_destroyed" | "grace_expired" | "error"} reason - Permanent teardown reason passed to each connection.
   * @returns {Promise<void>}
   */
  async _teardownConnections(reason) {
    const connections = [...this._connections.values()]

    this._connections.clear()

    for (const connection of connections) {
      connection._closed = true

      try {
        await this._withConnections(async () => {
          await connection.onClose(reason)
        })
      } catch (caughtError) {
        const error = this._reportUnexpectedDispatchError(caughtError, {
          connectionId: connection.connectionId,
          reason,
          stage: "websocket-connection-teardown"
        })

        this.logger.error(() => [`Failed to tear down connection ${connection.connectionId}`, error])
      }
    }
  }

  /**
   * Handles a `{type: "connection-open"}` message — instantiates the
   * registered connection class, stores it on `_connections`, and
   * fires `onConnect()`. Sends `connection-opened` on success or
   * `connection-error` on failure.
   * @param {Record<string, ReturnType<typeof JSON.parse>>} message - Connection-open frame naming the connection type and identifier.
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

    try {
      await this._withConnections(async () => {
        await connection.onConnect()
      })
      // Register only after onConnect resolves so a connection-message
      // can never be routed to a partially initialized connection.
      this._connections.set(connectionId, connection)
      this.sendJson({type: "connection-opened", connectionId})
    } catch (caughtError) {
      const clientErrorMessage = caughtError instanceof Error ? caughtError.message : ""
      const error = this._reportUnexpectedDispatchError(caughtError, {
        connectionId,
        connectionType,
        stage: "websocket-connection-open"
      })

      this.logger.error(() => [`Failed to open connection ${connectionType}:${connectionId}`, error])
      this.sendJson({type: "connection-error", connectionId, message: clientErrorMessage || "Failed to open connection"})
    }
  }

  /**
   * Handles a `{type: "connection-message"}` from the client.
   * @param {Record<string, ReturnType<typeof JSON.parse>>} message - Connection-message frame containing the target identifier and body.
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
    } catch (caughtError) {
      const clientErrorMessage = caughtError instanceof Error ? caughtError.message : ""
      const error = this._reportUnexpectedDispatchError(caughtError, {
        connectionId,
        stage: "websocket-connection-message"
      })

      this.logger.error(() => [`Failed to handle connection-message for ${connectionId}`, error])
      this.sendJson({type: "connection-error", connectionId, message: clientErrorMessage || "Failed to handle message"})
    }
  }

  /**
   * Handles a `{type: "connection-close"}` from the client — fires
   * `onClose("client_close")` and confirms with `connection-closed`.
   * @param {Record<string, ReturnType<typeof JSON.parse>>} message - Connection-close frame containing the target identifier.
   * @returns {Promise<void>}
   */
  async _handleConnectionClose(message) {
    const connectionId = message.connectionId
    const connection = typeof connectionId === "string" ? this._connections.get(connectionId) : null

    if (!connection) return

    this._connections.delete(connectionId)
    // Mark closed before firing onClose so app code holding the
    // handle sees `isClosed() === true` and can't re-enter sendMessage.
    connection._closed = true

    try {
      await this._withConnections(async () => {
        await connection.onClose("client_close")
      })
    } catch (caughtError) {
      const error = this._reportUnexpectedDispatchError(caughtError, {
        connectionId,
        stage: "websocket-connection-close"
      })

      this.logger.error(() => [`Failed to tear down connection ${connectionId}`, error])
    }

    this.sendJson({type: "connection-closed", connectionId, reason: "client_close"})
  }

  /**
   * Handles `{type: "channel-subscribe"}` — runs `canSubscribe()`,
   * registers with the Configuration's global routing registry on
   * success, and sends `channel-subscribed` or `channel-error`.
   * @param {Record<string, ReturnType<typeof JSON.parse>>} message - Channel-subscribe frame describing the requested subscription.
   * @returns {Promise<void>}
   */
  async _handleChannelSubscribe(message) {
    const subscriptionId = message.subscriptionId
    const channelType = message.channelType
    const params = message.params || {}
    const lastEventId = message.lastEventId

    if (typeof subscriptionId !== "string" || !subscriptionId) {
      this.sendJson({type: "error", error: "channel-subscribe requires subscriptionId"})
      return
    }

    if (typeof channelType !== "string" || !channelType) {
      this.sendJson({type: "channel-error", subscriptionId, message: "channelType is required"})
      return
    }

    if (this._channelSubscriptions.has(subscriptionId)) {
      this.sendJson({type: "channel-error", subscriptionId, message: "Subscription id already in use"})
      return
    }

    const ChannelClass = this.configuration.getWebsocketChannelClass?.(channelType)

    if (!ChannelClass) {
      this.sendJson({type: "channel-error", subscriptionId, message: `Unknown channel type: ${channelType}`})
      return
    }

    const subscription = new ChannelClass({subscriptionId, params, session: this})

    try {
      // Resolving the tenant can run database queries (e.g. looking up the
      // record's project and the caller's access), so it must happen inside a
      // connection scope. Without this the resolver borrows a connection that
      // is checked back in before/while it queries, intermittently surfacing as
      // "Connection … doesn't exist any more" or a falsely unauthorized
      // subscription.
      let tenant
      await this._withConnections(async () => {
        tenant = await this._resolveTenant({channel: channelType, params})
      })

      await this.configuration.runWithTenant(tenant, async () => {
        let allowed = false

        await this._withConnections(async () => {
          allowed = Boolean(await subscription.canSubscribe())
        })

        if (!allowed) {
          this.sendJson({type: "channel-error", subscriptionId, message: "Subscription not authorized"})
          return
        }

        this._channelSubscriptions.set(subscriptionId, {channelType, subscription})
        this.configuration._registerWebsocketChannelSubscription(channelType, subscription)

        await this._withConnections(async () => await subscription.subscribed())

        // Replay missed events BEFORE sending channel-subscribed so
        // the client knows: everything before the confirmation is
        // replayed, everything after is live.
        if (typeof lastEventId === "string" && lastEventId.length > 0) {
          await this._replayChannelEventsForSubscription({channelType, lastEventId, subscription})
        }

        this.sendJson({type: "channel-subscribed", subscriptionId})
      })
    } catch (caughtError) {
      const clientErrorMessage = caughtError instanceof Error ? caughtError.message : ""

      this._channelSubscriptions.delete(subscriptionId)
      this.configuration._unregisterWebsocketChannelSubscription(channelType, subscription)
      const error = this._reportUnexpectedDispatchError(caughtError, {
        channelType,
        stage: "websocket-channel-subscribe",
        subscriptionId
      })

      this.logger.error(() => [`Failed to subscribe channel ${channelType}:${subscriptionId}`, error])
      this.sendJson({type: "channel-error", subscriptionId, message: clientErrorMessage || "Failed to subscribe"})
    }
  }

  /**
   * Replays missed events from the persistent event-log store for a
   * channel subscription that provided `lastEventId`. Sends each
   * missed event as a `channel-message` with `replayed: true`.
   * @param {object} args - Options.
   * @param {string} args.channelType - Channel type name (event-log key).
   * @param {string} args.lastEventId - Client's last-seen event id.
   * @param {import("../websocket-channel.js").default} args.subscription - Live subscription.
   * @returns {Promise<void>}
   */
  async _replayChannelEventsForSubscription({channelType, lastEventId, subscription}) {
    const store = websocketEventLogStoreForConfiguration(this.configuration)

    await this.configuration.awaitPendingBroadcasts()

    const checkpoint = await store.getEventById({channel: channelType, id: lastEventId})

    if (!checkpoint) {
      this.sendJson({
        type: "channel-replay-gap",
        subscriptionId: subscription.subscriptionId,
        lastEventId
      })
      return
    }

    const ceiling = await store.latestSequence(channelType)

    if (!ceiling || ceiling <= checkpoint.sequence) return

    const events = await store.getEventsAfter({
      channel: channelType,
      sequence: checkpoint.sequence,
      upToSequence: ceiling
    })

    for (const event of events) {
      if (subscription.isClosed()) break

      if (await subscription._requiresReplayGap(event.payload)) {
        this.sendJson({
          type: "channel-replay-gap",
          subscriptionId: subscription.subscriptionId,
          lastEventId
        })
        return
      }

      await subscription.deliverBroadcast(
        /** @type {import("../websocket-channel.js").WebsocketJsonValue} */ (event.payload),
        {eventId: event.id}
      )
    }
  }

  /**
   * Handles `{type: "channel-unsubscribe"}` from the client — calls
   * `unsubscribed()` and sends `channel-unsubscribed`.
   * @param {Record<string, ReturnType<typeof JSON.parse>>} message - Channel-unsubscribe frame containing the subscription identifier.
   * @returns {Promise<void>}
   */
  async _handleChannelUnsubscribe(message) {
    const subscriptionId = message.subscriptionId

    if (typeof subscriptionId !== "string") return

    const entry = this._channelSubscriptions.get(subscriptionId)

    if (!entry) return

    this._channelSubscriptions.delete(subscriptionId)
    this.configuration._unregisterWebsocketChannelSubscription(entry.channelType, entry.subscription)
    entry.subscription._closed = true

    try {
      await this._withConnections(async () => await entry.subscription.unsubscribed())
    } catch (caughtError) {
      const error = this._reportUnexpectedDispatchError(caughtError, {
        channelType: entry.channelType,
        stage: "websocket-channel-unsubscribe",
        subscriptionId
      })

      this.logger.error(() => [`Failed to unsubscribe channel ${entry.channelType}:${subscriptionId}`, error])
    }

    this.sendJson({type: "channel-unsubscribed", subscriptionId})
  }

  /**
   * Fires `unsubscribed()` on every live channel-v2 subscription,
   * removes them from the Configuration's global registry, and
   * drops the session's own map. No network frames — the socket
   * is already going away.
   * @returns {Promise<void>}
   */
  async _teardownChannelSubscriptions() {
    const entries = [...this._channelSubscriptions.values()]

    this._channelSubscriptions.clear()

    for (const {channelType, subscription} of entries) {
      this.configuration._unregisterWebsocketChannelSubscription(channelType, subscription)
      subscription._closed = true

      try {
        await this._withConnections(async () => await subscription.unsubscribed())
      } catch (caughtError) {
        const error = this._reportUnexpectedDispatchError(caughtError, {
          channelType,
          stage: "websocket-channel-teardown",
          subscriptionId: subscription.subscriptionId
        })

        this.logger.error(() => [`Failed to tear down channel-v2 ${channelType}:${subscription.subscriptionId}`, error])
      }
    }
  }

  async _teardownChannel() {
    for (const channel of this.channels) {
      await this._teardownSingleChannel(channel)
    }
    this.channels.clear()
    this.channelReplayStates.clear()
  }

  /**
   * Runs teardown single channel.
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
    } catch (caughtError) {
      const error = this._reportUnexpectedDispatchError(caughtError, {
        stage: "websocket-channel-teardown"
      })

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
   * Runs register channel.
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
   * Runs with connections.
   * @param {() => Promise<void>} callback - Callback.
   * @returns {Promise<void>} - Resolves when complete.
   */
  async _withConnections(callback) {
    await this.configuration.ensureConnections({name: "Websocket session"}, async () => {
      await callback()
    })
  }

  /**
   * Runs handle channel subscription.
   * @param {{channel: string, lastEventId?: string, params?: Record<string, ReturnType<typeof JSON.parse>>}} args - Subscription args.
   * @returns {Promise<void>} - Resolves when complete.
   */
  async _handleChannelSubscription({channel, lastEventId, params}) {
    const resolver = this.configuration.getWebsocketChannelResolver?.()

    if (!resolver) return

    try {
      // Tenant resolution can run database queries, so it must happen inside a
      // connection scope (see _handleChannelSubscribe).
      let tenant
      await this._withConnections(async () => {
        tenant = await this._resolveTenant({channel, params})
      })
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
    } catch (caughtError) {
      const error = this._reportUnexpectedDispatchError(caughtError, {
        channel,
        stage: "websocket-channel-subscription"
      })

      this.logger.warn(() => ["Websocket channel subscription failed", error])
      this.sendJson({channel, error: "Subscription rejected", type: "error"})
    }
  }

  /**
   * Runs prepare replay state.
   * @param {object} args - Options.
   * @param {string} args.channel - Internal channel name.
   * @param {string | undefined} args.lastEventId - Last received event id.
   * @param {string} args.subscriptionChannel - Client-facing channel name.
   * @param {Record<string, ReturnType<typeof JSON.parse>> | undefined} args.subscriptionParams - Client-facing params.
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
   * Runs replay channel events.
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
   * Runs finish replay state.
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
   * Runs resolve tenant.
   * @param {{channel?: string, params?: Record<string, ReturnType<typeof JSON.parse>>}} args - Tenant resolution args.
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
   * Runs unmask payload.
   * @param {Buffer} payload - Payload data.
   * @param {Buffer} mask - Mask.
   * @returns {void} - No return value.
   */
  _unmaskPayload(payload, mask) {
    for (let i = 0; i < payload.length; i++) {
      payload[i] ^= mask[i % 4]
    }
  }

  async _runMessageHandlerOpen() {
    try {
      const handler = this.messageHandler
      const onOpen = handler ? handler.onOpen : null

      if (onOpen) {
        await onOpen({session: this})
      }
    } catch (caughtError) {
      const error = this._reportUnexpectedDispatchError(caughtError, {
        stage: "websocket-message-handler-open"
      })

      this.logger.error(() => ["Websocket open handler failed", error])
    }
  }

  /**
   * Runs run message handler message.
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
    } catch (caughtError) {
      const handler = this.messageHandler
      const onError = handler ? handler.onError : null
      const handlerError = ensureError(caughtError)
      const error = this._reportUnexpectedDispatchError(handlerError, {
        stage: "websocket-message-handler"
      })

      this.logger.error(() => ["Websocket message handler failed", error])
      if (!onError) return

      try {
        await onError({error: handlerError, session: this})
      } catch (onErrorCaughtError) {
        const clientErrorMessage = onErrorCaughtError instanceof Error
          ? onErrorCaughtError.message
          : String(onErrorCaughtError)
        const onErrorError = this._reportUnexpectedDispatchError(onErrorCaughtError, {
          stage: "websocket-message-handler-error"
        })

        this.logger.error(() => ["Websocket message error handler failed", onErrorError])
        this.sendJson({
          error: clientErrorMessage,
          type: "error"
        })
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
    } catch (caughtError) {
      const error = this._reportUnexpectedDispatchError(caughtError, {
        stage: "websocket-message-handler-close"
      })

      this.logger.error(() => ["Websocket close handler failed", error])
    }
  }

  /**
   * Runs remote address.
   * @returns {string | undefined} - Remote address resolved from the websocket upgrade request.
   */
  remoteAddress() {
    return this.upgradeRequest?.remoteAddress() || this.client.remoteAddress
  }

  /**
   * Runs set message handler.
   * @param {import("../../configuration-types.js").WebsocketMessageHandler} handler - Handler instance.
   * @returns {void}
   */
  setMessageHandler(handler) {
    this.messageHandler = handler
    void this._runMessageHandlerOpen()
  }

  async _resolveMessageHandlerPromise() {
    if (!this.messageHandlerPromise) return

    /** @type {import("../../configuration-types.js").WebsocketMessageHandler | void} */
    let handler

    try {
      handler = await this.messageHandlerPromise
    } catch (caughtError) {
      const error = this._reportUnexpectedDispatchError(caughtError, {
        stage: "websocket-message-handler-resolver"
      })

      this.logger.error(() => ["Websocket message handler resolver failed", error])
      this.messageHandlerPromise = undefined
      await this._finishMessageHandlerResolution({useHandler: false})
      return
    }

    this.messageHandlerPromise = undefined
    if (!handler) {
      await this._finishMessageHandlerResolution({useHandler: false})
      return
    }

    if (this._inboundClosed) {
      this.pendingMessageHandler = false
      return
    }

    // Install handler and drain onOpen before replaying queued
    // messages. setMessageHandler() fires onOpen as fire-and-forget;
    // awaiting _runMessageHandlerOpen() directly here closes the
    // race where queued subscribe/connection-* frames would
    // dispatch while an async onOpen is still setting up session
    // state.
    this.messageHandler = handler
    await this._runMessageHandlerOpen()
    await this._finishMessageHandlerResolution({
      useHandler: typeof handler.onMessage === "function"
    })
  }

  /**
   * Inserts resolver completion into the FIFO chain before allowing new dispatch.
   * @param {{useHandler: boolean}} args - Resolver result.
   * @returns {Promise<void>} - Resolves after queued messages drain.
   */
  async _finishMessageHandlerResolution({useHandler}) {
    const previous = this._messageChain
    const drain = previous.then(async () => {
      this.pendingMessageHandler = false
      if (this._inboundClosed) {
        this.messageQueue = []
        return
      }

      await this._flushQueuedMessages({useHandler})
    })

    this._messageChain = drain.catch(() => {})
    await drain
  }

  /**
   * Runs flush queued messages.
   * @param {{useHandler: boolean}} args - Args.
   * @returns {Promise<void>} - Resolves when complete.
   */
  async _flushQueuedMessages({useHandler}) {
    if (this.messageQueue.length === 0) return

    const queued = this.messageQueue
    this.messageQueue = []

    for (const work of queued) {
      if (this._inboundClosed) {
        this._releaseInboundAdmission(work.admission)
        continue
      }

      try {
        if (useHandler && this.messageHandler) {
          await this._runWithMessageLogContext(work.message, async () => {
            await this._runMessageHandlerMessage(work.message)
          })
        } else {
          await this._dispatchMessage(work.message)
        }
      } catch (caughtError) {
        const clientErrorMessage = caughtError instanceof Error ? caughtError.message : String(caughtError)
        const error = this._reportUnexpectedDispatchError(caughtError, {
          stage: "websocket-message-dispatch"
        })

        this.logger.error(() => ["Websocket message handler failed", error])
        this.sendJson({
          error: clientErrorMessage,
          type: "error"
        })
      } finally {
        this._releaseInboundAdmission(work.admission)
      }
    }
  }
}
