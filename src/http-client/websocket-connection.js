// @ts-check

/**
 * Client-side handle for a `WebsocketConnection` opened via
 * `VelociousWebsocketClient.openConnection()`. Mirrors the server's
 * `VelociousWebsocketConnection` lifecycle — `onConnect` /
 * `onMessage` / `onClose` plus `sendMessage` / `close`.
 *
 * See `docs/websocket-connections.md` for the wire protocol.
 */
export default class VelociousWebsocketClientConnection {
  /**
   * @param {object} args
   * @param {import("./websocket-client.js").default} args.client - Owning client.
   * @param {string} args.connectionId - Generated id unique within the session.
   * @param {string} args.connectionType - Name the server registered the class under.
   * @param {Record<string, any>} [args.params] - Opaque params forwarded to the server.
   * @param {() => void} [args.onConnect] - Fired after the server confirms `connection-opened`.
   * @param {(body: any) => void} [args.onMessage] - Fired on each `connection-message` from the server.
   * @param {(reason: string) => void} [args.onClose] - Fired exactly once when the handle closes.
   */
  constructor({client, connectionId, connectionType, params, onConnect, onMessage, onClose}) {
    this.client = client
    this.connectionId = connectionId
    this.connectionType = connectionType
    this.params = params || {}
    this._onConnect = onConnect
    this._onMessage = onMessage
    this._onClose = onClose
    this._connected = false
    this._closed = false

    /** @type {Promise<void>} - Resolves once the server sends `connection-opened`. */
    this.ready = new Promise((resolve, reject) => {
      this._resolveReady = resolve
      this._rejectReady = reject
    })
  }

  /**
   * Called by the client dispatcher when `{type: "connection-opened"}`
   * arrives. Fires the user's `onConnect` and resolves `ready`.
   *
   * @returns {void}
   */
  _handleOpened() {
    if (this._closed || this._connected) return
    this._connected = true

    try {
      this._onConnect?.()
    } finally {
      this._resolveReady?.()
    }
  }

  /**
   * Called by the client dispatcher for each `connection-message`
   * targeted at this connection id.
   *
   * @param {any} body
   * @returns {void}
   */
  _handleMessage(body) {
    if (this._closed) return
    this._onMessage?.(body)
  }

  /**
   * Called by the client dispatcher when `{type: "connection-closed"}`
   * or `{type: "connection-error"}` arrives, or when the underlying
   * socket drops. Fires `onClose(reason)` at most once.
   *
   * @param {string} reason
   * @returns {void}
   */
  _handleClosed(reason) {
    if (this._closed) return
    this._closed = true

    try {
      this._onClose?.(reason)
    } finally {
      if (!this._connected) {
        this._rejectReady?.(new Error(`Connection closed before open: ${reason}`))
      }
    }
  }

  /**
   * Sends a message to the server side of this connection. No-op if
   * the connection is already closed — fires unhandled-rejection
   * guards are the caller's responsibility if they want to wait
   * (`handle.ready` resolves once the server confirms `connection-opened`).
   *
   * @param {any} body
   * @returns {void}
   */
  sendMessage(body) {
    if (this._closed) {
      throw new Error(`Cannot sendMessage on closed connection ${this.connectionId}`)
    }

    this.client._sendMessage({
      type: "connection-message",
      connectionId: this.connectionId,
      body
    })
  }

  /**
   * Closes the connection from the client side. Fires `onClose("client_close")`
   * locally (immediate) and notifies the server with `{type: "connection-close"}`.
   * No-op if already closed.
   *
   * @returns {void}
   */
  close() {
    if (this._closed) return

    // Send the close frame BEFORE flipping _closed so _sendMessage
    // doesn't refuse — and guard against a socket that's already
    // gone so the local teardown still runs.
    try {
      if (this.client.isOpen()) {
        this.client._sendMessage({type: "connection-close", connectionId: this.connectionId})
      }
    } catch {
      // Socket may have closed between our check and the send; the
      // server will see the session destroy and clean up regardless.
    }

    this.client._removeConnection(this.connectionId)
    this._handleClosed("client_close")
  }

  /** @returns {boolean} */
  isClosed() { return this._closed }

  /** @returns {boolean} */
  isConnected() { return this._connected && !this._closed }
}
