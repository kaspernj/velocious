// @ts-check

/**
 * Per-process registry of channel subscribers used by worker code that
 * needs to react to events broadcast via `websocketEventsHost.publish(...)`
 * without holding an actual websocket session.
 *
 * Each Velocious worker thread (and the in-process handler used in tests)
 * gets its own instance attached to the configuration via
 * `setWebsocketChannelSubscribers(...)`.
 */
export default class VelociousWebsocketChannelSubscribers {
  constructor() {
    /** @type {Map<string, Set<(payload: any, meta: {channel: string, createdAt?: string, eventId?: string}) => void | Promise<void>>>} */
    this._subscribers = new Map()
  }

  /**
   * @param {string} channel - Channel name to subscribe to.
   * @param {(payload: any, meta: {channel: string, createdAt?: string, eventId?: string}) => void | Promise<void>} callback - Callback invoked for each event on the channel.
   * @returns {() => void} - Unsubscribe function.
   */
  subscribe(channel, callback) {
    if (!channel) throw new Error("channel is required")
    if (typeof callback !== "function") throw new Error("callback must be a function")

    let set = this._subscribers.get(channel)

    if (!set) {
      set = new Set()
      this._subscribers.set(channel, set)
    }

    set.add(callback)

    return () => this.unsubscribe(channel, callback)
  }

  /**
   * @param {string} channel - Channel name.
   * @param {(payload: any, meta: {channel: string, createdAt?: string, eventId?: string}) => void | Promise<void>} callback - Previously registered callback.
   * @returns {void}
   */
  unsubscribe(channel, callback) {
    const set = this._subscribers.get(channel)

    if (!set) return

    set.delete(callback)

    if (set.size === 0) {
      this._subscribers.delete(channel)
    }
  }

  /**
   * @param {string} channel - Channel name.
   * @returns {boolean} - Whether any subscribers exist for the channel.
   */
  hasSubscribers(channel) {
    const set = this._subscribers.get(channel)

    return Boolean(set && set.size > 0)
  }

  /**
   * Dispatch an event to all subscribers of the channel.
   * @param {object} args - Event args.
   * @param {string} args.channel - Channel name.
   * @param {any} args.payload - Event payload.
   * @param {string} [args.createdAt] - Event creation time.
   * @param {string} [args.eventId] - Event identifier.
   * @returns {Promise<void>} - Resolves when all subscribers have completed.
   */
  async dispatch({channel, payload, createdAt, eventId}) {
    const set = this._subscribers.get(channel)

    if (!set || set.size === 0) return

    const meta = {channel, createdAt, eventId}
    const tasks = []

    for (const callback of set) {
      try {
        const result = callback(payload, meta)

        if (result && typeof (/** @type {Promise<void>} */ (result)).then === "function") {
          tasks.push(/** @type {Promise<void>} */ (result))
        }
      } catch (error) {
        // Don't let one subscriber's failure abort the others; surface via the returned promises instead.
        tasks.push(Promise.reject(error))
      }
    }

    await Promise.all(tasks)
  }
}
