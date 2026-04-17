// @ts-check

/**
 * Base class for app-defined 1:N pub/sub channels.
 *
 * Subclasses override:
 *  - `canSubscribe()` — subscribe-time auth (default `false`).
 *  - `subscribed()` / `unsubscribed()` — optional lifecycle hooks.
 *  - `matches(broadcastParams)` — broadcast routing filter.
 */
export default class VelociousWebsocketChannel {
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
   * Called when the client sends updated metadata (e.g. after
   * sign-in / locale change). Override to react to session-level
   * metadata updates.
   *
   * @param {Record<string, any>} _metadata - Updated metadata.
   * @returns {void | Promise<void>}
   */
  onMetadataChanged(_metadata) {}

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
   * When `meta.eventId` is provided, the client receives it so it
   * can track its checkpoint for `lastEventId` replay on reconnect.
   *
   * @param {any} body
   * @param {{eventId?: string}} [meta] - Optional event metadata.
   * @returns {void}
   */
  sendMessage(body, meta) {
    if (this._closed) {
      throw new Error(`Cannot sendMessage on closed subscription ${this.subscriptionId}`)
    }

    this.session.sendJson({
      type: "channel-message",
      subscriptionId: this.subscriptionId,
      body,
      ...(meta?.eventId ? {eventId: meta.eventId} : {})
    })
  }

  /** @returns {boolean} */
  isClosed() { return this._closed }
}
