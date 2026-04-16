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
   * @param {(body: any) => void} [args.onMessage]
   * @param {() => void} [args.onDisconnect]
   * @param {() => void} [args.onResume]
   * @param {(reason: string) => void} [args.onClose]
   */
  constructor({client, subscriptionId, channelType, params, onMessage, onDisconnect, onResume, onClose}) {
    this.client = client
    this.subscriptionId = subscriptionId
    this.channelType = channelType
    this.params = params || {}
    this._onMessage = onMessage
    this._onDisconnect = onDisconnect
    this._onResume = onResume
    this._onClose = onClose
    this._subscribed = false
    this._closed = false

    /** @type {Promise<void>} */
    this.ready = new Promise((resolve, reject) => {
      this._resolveReady = resolve
      this._rejectReady = reject
    })
  }

  /** @returns {void} */
  _handleSubscribed() {
    if (this._closed || this._subscribed) return
    this._subscribed = true
    this._resolveReady?.()
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
    this._onDisconnect?.()
  }

  /** @returns {void} */
  _handleResumed() {
    if (this._closed) return
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
      if (!this._subscribed) {
        this._rejectReady?.(new Error(`Subscription closed before acknowledgement: ${reason}`))
      }
    }
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
  isSubscribed() { return this._subscribed && !this._closed }
}
