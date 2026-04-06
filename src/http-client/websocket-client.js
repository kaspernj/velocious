// @ts-check

const DEFAULT_RECONNECT_DELAYS = [1000, 2000, 4000, 8000, 15000]

/**
 * A small websocket client that mirrors simple HTTP-style calls and channel subscriptions.
 * Supports optional auto-reconnect with exponential backoff and listener re-subscription.
 */
export default class VelociousWebsocketClient {
  /** @type {Map<string, {reject: (error: unknown) => void, resolve: (response: VelociousWebsocketResponse) => void}>} */
  pendingRequests
  /** @type {Map<string, {reject: (error: unknown) => void, resolve: (value?: void) => void}>} */
  pendingSubscriptions
  /** @type {Map<string, {callbacks: Set<(payload: any) => void>, channel: string, params: Record<string, any> | undefined, ready: Promise<void>}>} */
  listeners

  /**
   * @param {object} [args] - Options object.
   * @param {boolean} [args.autoReconnect] - Enable auto-reconnect with exponential backoff.
   * @param {boolean} [args.debug] - Whether debug.
   * @param {number[]} [args.reconnectDelays] - Backoff delays in ms (default: [1000, 2000, 4000, 8000, 15000]).
   * @param {string} [args.url] Full websocket URL (default: ws://127.0.0.1:3006/websocket)
   */
  constructor({autoReconnect = false, debug = false, reconnectDelays, url} = {}) {
    if (!globalThis.WebSocket) throw new Error("WebSocket global is not available")

    /** @type {boolean} */
    this.autoReconnect = false
    /** @type {boolean} */
    this.autoReconnectEnabled = autoReconnect
    this.debug = debug
    /** @type {number | null} */
    this.disconnectedSince = null
    this.pendingRequests = new Map()
    this.pendingSubscriptions = new Map()
    /** @type {number} */
    this.reconnectAttempt = 0
    /** @type {number[]} */
    this.reconnectDelays = reconnectDelays || DEFAULT_RECONNECT_DELAYS
    /** @type {ReturnType<typeof setTimeout> | null} */
    this.reconnectTimer = null
    this.url = url || "ws://127.0.0.1:3006/websocket"
    this.listeners = new Map()
    this.nextID = 1
    /** @type {(() => void | Promise<void>) | null} */
    this.onReconnect = null
  }

  /**
   * Ensure a websocket connection is open.
   * @returns {Promise<void>} - Resolves when complete.
   */
  async connect() {
    if (this.socket && this.socket.readyState === this.socket.OPEN) return
    if (this.connectPromise) return this.connectPromise

    this.connectPromise = new Promise((resolve, reject) => {
      this.socket = new WebSocket(this.url)

      const cleanup = () => {
        this.socket?.removeEventListener("open", onOpen)
        this.socket?.removeEventListener("error", onError)
      }

      const onOpen = () => {
        cleanup()
        resolve(undefined)
      }
      const onError = (/** @type {Event & {error?: unknown}} */ event) => {
        cleanup()
        const error = event?.error || new Error("Websocket connection error")
        reject(error)
      }

      this.socket.addEventListener("open", onOpen)
      this.socket.addEventListener("error", onError)
      this.socket.addEventListener("message", this.onMessage)
      this.socket.addEventListener("close", this.onClose)
    })

    return this.connectPromise
  }

  /**
   * Connect and enable auto-reconnect. Resets reconnect state.
   * @returns {Promise<void>} - Resolves when connected.
   */
  async connectWithReconnect() {
    this.autoReconnect = true
    this.reconnectAttempt = 0
    this._cancelPendingReconnect()
    await this.connect()
    this.disconnectedSince = null
  }

  /**
   * Close the websocket and clear pending state.
   * @returns {Promise<void>} - Resolves when complete.
   */
  async close() {
    if (!this.socket) return

    await new Promise((resolve) => {
      this.socket?.addEventListener("close", () => resolve(undefined))
      this.socket?.close()
    })

    this.socket = undefined
    this.connectPromise = undefined
  }

  /**
   * Disable auto-reconnect and close the websocket.
   * @returns {Promise<void>} - Resolves when closed.
   */
  async disconnectAndStopReconnect() {
    this.autoReconnect = false
    this._cancelPendingReconnect()
    await this.close()
  }

  /**
   * Close the raw socket without disabling auto-reconnect. Used by tests to
   * simulate an unexpected network drop and verify reconnection behavior.
   * @returns {Promise<void>} - Resolves when the socket has closed.
   */
  async dropConnection() {
    if (!this.socket) return

    await new Promise((resolve) => {
      this.socket?.addEventListener("close", () => resolve(undefined))
      this.socket?.close()
    })

    this.connectPromise = undefined
  }

  /**
   * Perform a POST request over the websocket.
   * @param {string} path - Path.
   * @param {any} [body] - Request body.
   * @param {{headers?: Record<string, string>}} [options] - Request options such as headers.
   * @returns {Promise<VelociousWebsocketResponse>} - Resolves with the post.
   */
  async post(path, body, options = {}) {
    return await this.request("POST", path, {...options, body})
  }

  /**
   * Perform a GET request over the websocket.
   * @param {string} path - Path.
   * @param {{headers?: Record<string, string>}} [options] - Request options such as headers.
   * @returns {Promise<VelociousWebsocketResponse>} - Resolves with the get.
   */
  async get(path, options = {}) {
    return await this.request("GET", path, options)
  }

  /**
   * Subscribe to a channel for server-sent events.
   * @param {string} channel - Channel name.
   * @param {(payload: any) => void} callback - Callback function.
   * @returns {() => void} unsubscribe function
   */
  on(channel, callback) {
    return this.subscribe(channel, {}, callback)
  }

  /**
   * Returns a snapshot of the client's connection state.
   * @returns {{disconnectedSince: number | null, isOpen: boolean, listenerCount: number}}
   */
  state() {
    return {
      disconnectedSince: this.disconnectedSince,
      isOpen: !!this.socket && this.socket.readyState === this.socket.OPEN,
      listenerCount: this.listeners.size
    }
  }

  /**
   * Subscribe to a channel for server-sent events with optional params.
   * @param {string} channel - Channel name.
   * @param {{params?: Record<string, any>}} options - Subscription options.
   * @param {(payload: any) => void} callback - Callback function.
   * @returns {(() => void) & {ready: Promise<void>}} - Unsubscribe function with readiness promise.
   */
  subscribe(channel, options, callback) {
    const params = options?.params
    const subscriptionKey = this._subscriptionKey(channel, params)

    if (!this.listeners.has(subscriptionKey)) {
      /** @type {(() => void) | undefined} */
      /** @type {((value?: void) => void) | undefined} */
      let resolveReady
      /** @type {((error: unknown) => void) | undefined} */
      let rejectReady
      const ready = new Promise((resolve, reject) => {
        resolveReady = resolve
        rejectReady = reject
      })

      this.listeners.set(subscriptionKey, {
        callbacks: new Set(),
        channel,
        params,
        ready
      })
      this.pendingSubscriptions.set(subscriptionKey, {
        reject: rejectReady || (() => {}),
        resolve: resolveReady || (() => {})
      })

      void this.connect().then(() => {
        this._sendMessage({channel, params, type: "subscribe"})
      }).catch((error) => this._debug("Subscribe failed", error))
    }

    const listenerEntry = this.listeners.get(subscriptionKey)

    if (!listenerEntry) throw new Error("Listeners map not initialized")

    listenerEntry.callbacks.add(callback)

    const unsubscribe = () => {
      listenerEntry.callbacks.delete(callback)

      if (listenerEntry.callbacks.size === 0) {
        this.listeners.delete(subscriptionKey)
      }
    }

    unsubscribe.ready = listenerEntry.ready

    return unsubscribe
  }

  /**
   * Subscribe to a channel and wait until the server acknowledges the subscription.
   * @param {string} channel - Channel name.
   * @param {{params?: Record<string, any>}} options - Subscription options.
   * @param {(payload: any) => void} callback - Callback function.
   * @returns {Promise<(() => void) & {ready: Promise<void>}>} - Ready unsubscribe handle.
   */
  async subscribeAndWait(channel, options, callback) {
    const unsubscribe = this.subscribe(channel, options, callback)

    await unsubscribe.ready

    return unsubscribe
  }

  /**
   * @private
   * @param {string} method - HTTP method.
   * @param {string} path - Path.
   * @param {object} [options] - Options object.
   * @param {any} [options.body] - Request body.
   * @param {Record<string, string>} [options.headers] - Header list.
   * @returns {Promise<VelociousWebsocketResponse>} - Resolves with the request.
   */
  async request(method, path, {body, headers} = {}) {
    await this.connect()

    const id = `ws-${this.nextID++}`
    const payload = {
      body,
      headers,
      id,
      method,
      path,
      type: "request"
    }

    return await new Promise((resolve, reject) => {
      this.pendingRequests.set(id, {resolve, reject})
      this._sendMessage(payload)
    })
  }

  /**
   * @private
   * @param {MessageEvent<any>} event - Event payload.
   */
  onMessage = (event) => {
    const raw = typeof event.data === "string" ? event.data : event.data?.toString?.()

    if (!raw) return

    /** @type {Record<string, any>} */
    let message

    try {
      message = JSON.parse(raw)
    } catch (error) {
      this._debug("Failed to parse websocket message", error)
      return
    }

    const {type} = message

    if (type === "response") {
      const {id} = message
      const pending = id ? this.pendingRequests.get(id) : undefined

      if (pending) {
        this.pendingRequests.delete(id)
        pending.resolve(new VelociousWebsocketResponse(message))
      } else {
        this._debug(`No pending request for response id ${id}`)
      }
    } else if (type === "subscribed") {
      const subscriptionKey = this._subscriptionKey(message.channel, message.params)
      const pendingSubscription = this.pendingSubscriptions.get(subscriptionKey)

      if (pendingSubscription) {
        this.pendingSubscriptions.delete(subscriptionKey)
        pendingSubscription.resolve()
      }
    } else if (type === "event") {
      const {channel, payload} = message
      for (const listenerEntry of this.listeners.values()) {
        if (listenerEntry.channel !== channel) continue

        listenerEntry.callbacks.forEach((/** @type {(payload: any) => void} */ callback) => {
          try {
            callback(payload)
          } catch (error) {
            this._debug("Listener error", error)
          }
        })
      }
    } else if (type === "error" && message.id) {
      const pending = this.pendingRequests.get(message.id)

      if (pending) {
        this.pendingRequests.delete(message.id)
        pending.reject(new Error(message.error || "Unknown websocket error"))
      }
    }
  }

  /**
   * @private
   * @param {string} channel - Channel name.
   * @param {Record<string, any> | undefined} params - Subscription params.
   * @returns {string} - Stable subscription key.
   */
  _subscriptionKey(channel, params) {
    return JSON.stringify([channel, params || null])
  }

  /**
   * Reject all pending requests when the socket closes. Schedules reconnect if enabled.
   * @private
   */
  onClose = () => {
    this.disconnectedSince ||= Date.now()

    for (const [id, {reject}] of this.pendingRequests.entries()) {
      reject(new Error(`Websocket closed before response for ${id}`))
    }

    for (const {reject} of this.pendingSubscriptions.values()) {
      reject(new Error("Websocket closed before subscription acknowledgement"))
    }

    this.pendingRequests.clear()
    this.pendingSubscriptions.clear()
    this.connectPromise = undefined

    if (this.autoReconnect) {
      this._scheduleReconnect()
    }
  }

  /**
   * @private
   * @param {Record<string, any>} payload - Payload data.
   */
  _sendMessage(payload) {
    if (!this.socket || this.socket.readyState !== this.socket.OPEN) {
      throw new Error("Websocket is not open")
    }

    const json = JSON.stringify(payload)

    this._debug("Sending", json)
    this.socket.send(json)
  }

  /** @returns {void} */
  _cancelPendingReconnect() {
    if (this.reconnectTimer) {
      globalThis.clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }
  }

  /** @returns {void} */
  _scheduleReconnect() {
    this._cancelPendingReconnect()

    const delay = this.reconnectDelays[Math.min(this.reconnectAttempt, this.reconnectDelays.length - 1)]

    this.reconnectTimer = globalThis.setTimeout(() => {
      this.reconnectTimer = null
      void this._attemptReconnect()
    }, delay)

    this.reconnectAttempt += 1
  }

  /** @returns {Promise<void>} */
  async _attemptReconnect() {
    if (!this.autoReconnect) return

    try {
      await this.connect()
      this.reconnectAttempt = 0
      this.disconnectedSince = null
      this._resubscribeActiveListeners()

      if (typeof this.onReconnect === "function") {
        await this.onReconnect()
      }
    } catch (error) {
      this._debug("Reconnect attempt failed:", error)

      if (this.autoReconnect) {
        this._scheduleReconnect()
      }
    }
  }

  /**
   * Re-sends subscribe messages for all active listeners after reconnection.
   * @returns {void}
   */
  _resubscribeActiveListeners() {
    for (const [, listenerEntry] of this.listeners) {
      try {
        this._sendMessage({
          channel: listenerEntry.channel,
          params: listenerEntry.params,
          type: "subscribe"
        })
      } catch (error) {
        this._debug("Re-subscribe failed:", error)
      }
    }
  }

  /**
   * @private
   * @param  {...any} args - Options object.
   * @returns {void} - No return value.
   */
  _debug(...args) {
    if (!this.debug) return

    console.debug("[VelociousWebsocketClient]", ...args)
  }
}

class VelociousWebsocketResponse {
  /**
   * @param {object} message - Message text.
   */
  constructor(message) {
    const responseMessage = /** @type {{body?: any, headers?: Record<string, any>, id?: string | number | null, statusCode?: number, statusMessage?: string, type?: string}} */ (message)

    this.body = responseMessage.body
    this.headers = responseMessage.headers || {}
    this.id = responseMessage.id
    this.statusCode = responseMessage.statusCode || 200
    this.statusMessage = responseMessage.statusMessage || "OK"
    this.type = responseMessage.type
  }

  /** @returns {any} - The json.  */
  json() {
    if (typeof this.body !== "string") {
      throw new Error("Response body is not a string")
    }

    return JSON.parse(this.body)
  }
}
