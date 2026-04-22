// @ts-check

/**
 * Client-side handle for a channel subscription opened via
 * `VelociousWebsocketClient.subscribeChannel()`. Mirrors the server's
 * subscription lifecycle — `subscribed` (resolves `ready`) / `onMessage` /
 * `onClose`.
 *
 * See `docs/websocket-channels.md` for the wire protocol.
 */
export default class VelociousWebsocketClientSubscription {
  /**
   * @param {object} args
   * @param {import("./websocket-client.js").default} args.client
   * @param {string} args.subscriptionId
   * @param {string} args.channelType
   * @param {Record<string, any>} [args.params]
   * @param {string} [args.lastEventId]
   * @param {(body: any) => void} [args.onMessage]
   * @param {() => void} [args.onDisconnect]
   * @param {() => void} [args.onResume]
   * @param {(reason: string) => void} [args.onClose]
   */
  constructor({client, subscriptionId, channelType, params, lastEventId, onMessage, onDisconnect, onResume, onClose}) {
    this.client = client
    this.subscriptionId = subscriptionId
    this.channelType = channelType
    this.params = params || {}
    this.lastEventId = lastEventId
    this._onMessage = onMessage
    this._onDisconnect = onDisconnect
    this._onResume = onResume
    this._onClose = onClose
    this._ready = false
    this._resumeReadyOnResume = false
    this._subscribed = false
    this._subscribeSent = false
    this._closed = false

    this._ensureReadyPromise()
  }

  /** @returns {Promise<void>} */
  _ensureReadyPromise() {
    if (!this.ready || !this._resolveReady || !this._rejectReady) {
      /** @type {Promise<void>} */
      this.ready = new Promise((resolve, reject) => {
        this._resolveReady = resolve
        this._rejectReady = reject
      })
    }

    return this.ready
  }

  /** @returns {void} */
  _resolveReadyState() {
    this._ready = true
    this._resolveReady?.()
    this._resolveReady = null
    this._rejectReady = null
  }

  /** @returns {void} */
  _markNotReady() {
    this._ready = false
  }

  /** @returns {void} */
  _handleSubscribed() {
    if (this._closed || this._subscribed) return
    this._subscribed = true
    this._resolveReadyState()
  }

  /** @returns {void} */
  _markSubscribeSent() {
    this._subscribeSent = true
  }

  /** @returns {boolean} */
  _needsSubscribe() {
    return !this._closed && !this._subscribeSent
  }

  /**
   * @param {any} body
   * @returns {void}
   */
  _handleMessage(body) {
    if (this._closed) return
    this._onMessage?.(body)
  }

  /** @returns {void} */
  _handleDisconnected() {
    if (this._closed) return
    this._resumeReadyOnResume ||= this._subscribed
    this._subscribed = false
    this._markNotReady()
    this._onDisconnect?.()
  }

  /** @returns {void} */
  _handleResumed() {
    if (this._closed) return
    if (this._resumeReadyOnResume) {
      this._subscribed = true
      this._resolveReadyState()
    }
    this._resumeReadyOnResume = false
    this._onResume?.()
  }

  /**
   * @param {string} reason
   * @returns {void}
   */
  _handleClosed(reason) {
    if (this._closed) return
    this._closed = true

    try {
      this._onClose?.(reason)
    } finally {
      this._resumeReadyOnResume = false
      if (!this._ready) {
        this._rejectReady?.(new Error(`Subscription closed before acknowledgement: ${reason}`))
      }

      this._resolveReady = null
      this._rejectReady = null
    }
  }

  /**
   * @param {{timeoutMs?: number}} [params]
   * @returns {Promise<void>}
   */
  async waitForReady({timeoutMs = 5000} = {}) {
    if (this._ready) return

    const readyPromise = this._ensureReadyPromise()
    const timeoutPromise = new Promise((_, reject) => {
      setTimeout(() => reject(new Error(`Subscription not ready after ${timeoutMs}ms`)), timeoutMs)
    })

    await Promise.race([readyPromise, timeoutPromise])
  }

  /** @returns {void} */
  close() {
    if (this._closed) return

    try {
      if (this.client.isOpen()) {
        this.client._sendMessage({type: "channel-unsubscribe", subscriptionId: this.subscriptionId})
      }
    } catch {
      // Socket already gone; server will clean up on session teardown.
    }

    this.client._removeChannelSubscription(this.subscriptionId)
    this._handleClosed("client_unsubscribe")
  }

  /** @returns {boolean} */
  isClosed() { return this._closed }

  /** @returns {boolean} */
  isReady() { return this._ready }

  /** @returns {boolean} */
  isSubscribed() { return this._subscribed && !this._closed }
}
