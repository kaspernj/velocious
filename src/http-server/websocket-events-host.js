// @ts-check

import {websocketEventLogStoreForConfiguration} from "./websocket-event-log-store.js"

export class VelociousHttpServerWebsocketEventsHost {
  constructor() {
    /**
     * Narrows the runtime value to the documented type.
     * @type {Set<import("./worker-handler/index.js").default>} */
    this.handlers = new Set()
    /**
     * Broadcast handlers grouped by the configuration that owns them.
     * @type {Map<import("../configuration.js").default, Set<import("./worker-handler/index.js").default>>} */
    this.broadcastHandlersByConfiguration = new Map()
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
    let configurationHandlers = this.broadcastHandlersByConfiguration.get(handler.configuration)

    if (!configurationHandlers) {
      configurationHandlers = new Set()
      this.broadcastHandlersByConfiguration.set(handler.configuration, configurationHandlers)
    }

    configurationHandlers.add(handler)

    return () => {
      this.handlers.delete(handler)
      configurationHandlers.delete(handler)

      if (configurationHandlers.size === 0) {
        this.broadcastHandlersByConfiguration.delete(handler.configuration)
      }
    }
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
      : /** @type {{channel: string, payload: ?}} */ (channelOrArgs)
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
   * @param {import("../configuration.js").default} args.configuration - Originating configuration.
   * @returns {void}
   */
  broadcastV2({body, broadcastParams, channel, configuration}) {
    // Chain onto publishQueue so persistence completes before
    // the next broadcast — without this, a subscriber that connects
    // immediately after a broadcast could miss the just-persisted
    // event when replaying from lastEventId on a slow DB.
    this._queuePublish(async () => {
      const persistedEvent = await this._persistV2EventIfNeeded({body, channel, configuration})
      const dispatchedTargets = new Set()

      for (const handler of this.broadcastHandlersByConfiguration.get(configuration) || []) {
        const dispatchKey = handler.websocketV2BroadcastDispatchKey()

        if (dispatchedTargets.has(dispatchKey)) continue

        dispatchedTargets.add(dispatchKey)
        handler.dispatchWebsocketV2Broadcast({
          body,
          broadcastParams,
          channel,
          eventId: persistedEvent?.id,
          createdAt: persistedEvent?.createdAt
        })
      }
    }, "Failed to persist/broadcast V2 event", configuration)
  }

  /**
   * Runs queue publish.
   * @param {() => Promise<void>} callback - Publish work to run in order.
   * @param {string} errorMessage - Message logged when publish work fails.
   * @param {import("../configuration.js").default} [originatingConfiguration] - Configuration whose context owns the work.
   * @returns {void}
   */
  _queuePublish(callback, errorMessage, originatingConfiguration) {
    const handler = this.handlers.values().next().value
    const configuration = originatingConfiguration || handler?.configuration

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
   * @param {import("../configuration.js").default} args.configuration - Originating configuration.
   * @returns {Promise<{createdAt: string, id: string} | null>} - Persisted event metadata when storage is enabled.
   */
  async _persistV2EventIfNeeded({body, channel, configuration}) {
    return await this._persistChannelEventIfNeeded({channel, payload: body, configuration})
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
   * @param {import("../configuration.js").default} [args.configuration] - Configuration owning the event store.
   * @returns {Promise<{createdAt: string, id: string} | null>} - Persisted event metadata.
   */
  async _persistChannelEventIfNeeded({channel, payload, configuration}) {
    const handler = this.handlers.values().next().value
    const eventConfiguration = configuration || handler?.configuration

    if (!eventConfiguration) return null

    const websocketEventLogStore = websocketEventLogStoreForConfiguration(eventConfiguration)
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
