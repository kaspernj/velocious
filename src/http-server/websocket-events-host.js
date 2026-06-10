// @ts-check

import {websocketEventLogStoreForConfiguration} from "./websocket-event-log-store.js"

export class VelociousHttpServerWebsocketEventsHost {
  constructor() {
    /**
     * Narrows the runtime value to the documented type.
      @type {Set<import("./worker-handler/index.js").default>} */
    this.handlers = new Set()
    this.publishQueue = Promise.resolve()
  }

  /**
   * Returns a promise that resolves when all pending publish/broadcast
   * operations have completed (including event-log persistence). Useful
   * when a request handler needs to guarantee its broadcast is persisted
   * before responding — without this, the HTTP response can return before
   * the async event-log write finishes.
   * @returns {Promise<void>}
   */
  async awaitPendingBroadcasts() {
    await this.publishQueue
  }

  /**
   * Runs register.
   * @param {import("./worker-handler/index.js").default} handler - Handler instance.
   * @returns {() => void} - The register.
   */
  register(handler) {
    this.handlers.add(handler)

    return () => this.handlers.delete(handler)
  }

  /**
   * Runs publish.
   * @param {object | string} channelOrArgs - Channel name or options object.
   * @param {?} [payloadArg] - Payload data when channel is passed separately.
   * @returns {void} - No return value.
   */
  publish(channelOrArgs, payloadArg) {
    const publishArgs = typeof channelOrArgs === "string"
      ? {channel: channelOrArgs, payload: payloadArg}
      : /**
         * Narrows the runtime value to the documented type.
          @type {{channel: string, payload: ?}} */ (channelOrArgs)
    const channel = publishArgs.channel
    const payload = publishArgs.payload

    this._queuePublish(async () => {
      const persistedEvent = await this._persistEventIfNeeded({channel, payload})

      for (const handler of this.handlers) {
        handler.dispatchWebsocketEvent({
          channel,
          createdAt: persistedEvent?.createdAt,
          eventId: persistedEvent?.id,
          payload
        })
      }
    }, "Failed to publish websocket event")
  }

  /**
   * Fan a V2 channel broadcast out to every registered worker handler.
   * Persists the event to the event-log store (if the channel is marked
   * interested) so clients can resume from a `lastEventId` checkpoint.
   * @param {object} args - Options object.
   * @param {string} args.channel - Channel name.
   * @param {Record<string, ?>} args.broadcastParams - Routing filter params.
   * @param {?} args.body - Message body.
   * @returns {void}
   */
  broadcastV2({body, broadcastParams, channel}) {
    // Chain onto publishQueue so persistence completes before
    // the next broadcast — without this, a subscriber that connects
    // immediately after a broadcast could miss the just-persisted
    // event when replaying from lastEventId on a slow DB.
    this._queuePublish(async () => {
      const persistedEvent = await this._persistV2EventIfNeeded({body, channel})

      for (const handler of this.handlers) {
        handler.dispatchWebsocketV2Broadcast({
          body,
          broadcastParams,
          channel,
          eventId: persistedEvent?.id,
          createdAt: persistedEvent?.createdAt
        })
      }
    }, "Failed to persist/broadcast V2 event")
  }

  /**
   * Runs queue publish.
   * @param {() => Promise<void>} callback - Publish work to run in order.
   * @param {string} errorMessage - Message logged when publish work fails.
   * @returns {void}
   */
  _queuePublish(callback, errorMessage) {
    const handler = this.handlers.values().next().value
    const configuration = handler?.configuration

    this.publishQueue = this.publishQueue
      .then(async () => {
        if (configuration) {
          return await configuration.withoutCurrentConnectionContexts(callback)
        }

        return await callback()
      })
      .catch((error) => {
        console.error(errorMessage, error)
        throw error
      })
  }

  /**
   * Runs persist v2 event if needed.
   * @param {object} args - Options.
   * @param {?} args.body - Event body.
   * @param {string} args.channel - Channel name.
   * @returns {Promise<{createdAt: string, id: string} | null>}
   */
  async _persistV2EventIfNeeded({body, channel}) {
    return await this._persistChannelEventIfNeeded({channel, payload: body})
  }

  /**
   * Runs persist event if needed.
   * @param {object} args - Options object.
   * @param {string} args.channel - Channel name.
   * @param {?} args.payload - Payload data.
   * @returns {Promise<{createdAt: string, id: string} | null>} - Persisted event metadata.
   */
  async _persistEventIfNeeded({channel, payload}) {
    return await this._persistChannelEventIfNeeded({channel, payload})
  }

  /**
   * Runs persist channel event if needed.
   * @param {object} args - Options object.
   * @param {string} args.channel - Channel name.
   * @param {?} args.payload - Payload data.
   * @returns {Promise<{createdAt: string, id: string} | null>} - Persisted event metadata.
   */
  async _persistChannelEventIfNeeded({channel, payload}) {
    const handler = this.handlers.values().next().value

    if (!handler?.configuration) return null

    const websocketEventLogStore = websocketEventLogStoreForConfiguration(handler.configuration)
    const shouldPersist = await websocketEventLogStore.shouldPersistChannel(channel)

    if (!shouldPersist) return null

    const persistedEvent = await websocketEventLogStore.appendEvent({channel, payload})

    return {
      createdAt: persistedEvent.createdAt,
      id: persistedEvent.id
    }
  }
}

const websocketEventsHost = new VelociousHttpServerWebsocketEventsHost()

export default websocketEventsHost
