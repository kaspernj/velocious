// @ts-check

/**
 * Base class for app-defined 1:N pub/sub channels. See
 * `docs/websocket-channels.md` for the full API contract and
 * auth model.
 *
 * Subclasses override:
 *  - `canSubscribe()` — subscribe-time auth (default `false`).
 *  - `subscribed()` / `unsubscribed()` — optional lifecycle hooks.
 *  - `matches(broadcastParams)` — broadcast routing filter.
 *
 * Named `*V2` internally to avoid colliding with the legacy
 * `WebsocketChannel` that powers today's FrontendModel subscriptions.
 * Once Phase 3 migrates those onto this primitive and retires the
 * old class, this will be renamed to just `WebsocketChannel` and
 * the legacy file removed.
 */
export default class VelociousWebsocketChannelV2 {
  /**
   * @param {object} args
   * @param {string} args.subscriptionId - Client-assigned id, unique within the session.
   * @param {Record<string, any>} args.params - Subscribe params.
   * @param {import("./client/websocket-session.js").default} args.session - Owning session.
   */
  constructor({subscriptionId, params, session}) {
    this.subscriptionId = subscriptionId
    this.params = params || {}
    this.session = session
    this._closed = false
  }

  /**
   * Subscribe-time auth. Default is `false` (deny). Channel authors
   * MUST override to allow subscriptions. Returning a Promise defers
   * the `channel-subscribed` confirmation until it resolves.
   *
   * @returns {boolean | Promise<boolean>}
   */
  canSubscribe() { return false }

  /**
   * Optional — called once after `canSubscribe` resolves truthy and
   * before `channel-subscribed` is sent to the client. Use for
   * initial snapshot delivery.
   *
   * @returns {void | Promise<void>}
   */
  subscribed() {}

  /**
   * Optional — called once when the subscription ends. Fires on
   * client-initiated `channel-unsubscribe` or on session teardown.
   *
   * @returns {void | Promise<void>}
   */
  unsubscribed() {}

  /**
   * Called when the underlying socket drops and the session is
   * moved into the paused/grace registry. Either `onResume` fires
   * on successful client reconnect, or `unsubscribed()` fires when
   * the grace window expires.
   *
   * @returns {void | Promise<void>}
   */
  onDisconnect() {}

  /**
   * Called after a client reconnect + `session-resume` rebinds this
   * subscription to a new socket.
   *
   * @returns {void | Promise<void>}
   */
  onResume() {}

  /**
   * Broadcast routing filter. Called by `broadcastToChannel` for
   * each live subscription — returning true delivers the body via
   * `sendMessage`. Default matches all broadcasts regardless of
   * params; override for per-subscriber filtering.
   *
   * @param {...any} _broadcastArgs - Params forwarded from `broadcastToChannel` (ignored by default).
   * @returns {boolean} - True to deliver the broadcast to this subscriber.
   */
  matches(..._broadcastArgs) { return true }

  /**
   * Sends a `channel-message` frame to THIS subscriber only.
   *
   * @param {any} body
   * @returns {void}
   */
  sendMessage(body) {
    if (this._closed) {
      throw new Error(`Cannot sendMessage on closed subscription ${this.subscriptionId}`)
    }

    this.session.sendJson({
      type: "channel-message",
      subscriptionId: this.subscriptionId,
      body
    })
  }

  /** @returns {boolean} */
  isClosed() { return this._closed }
}
