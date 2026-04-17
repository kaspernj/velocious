// @ts-check

import {websocketEventLogStoreForConfiguration} from "./websocket-event-log-store.js"

export class VelociousHttpServerWebsocketEventsHost {
  constructor() {
    /** @type {Set<import("./worker-handler/index.js").default>} */
    this.handlers = new Set()
    this.publishQueue = Promise.resolve()
  }

  /**
   * @param {import("./worker-handler/index.js").default} handler - Handler instance.
   * @returns {() => void} - The register.
   */
  register(handler) {
    this.handlers.add(handler)

    return () => this.handlers.delete(handler)
  }

  /**
   * @param {object | string} channelOrArgs - Channel name or options object.
   * @param {any} [payloadArg] - Payload data when channel is passed separately.
   * @returns {void} - No return value.
   */
  publish(channelOrArgs, payloadArg) {
    const publishArgs = typeof channelOrArgs === "string"
      ? {channel: channelOrArgs, payload: payloadArg}
      : /** @type {{channel: string, payload: any}} */ (channelOrArgs)
    const channel = publishArgs.channel
    const payload = publishArgs.payload

    this.publishQueue = this.publishQueue
      .then(async () => {
        const persistedEvent = await this._persistEventIfNeeded({channel, payload})

        for (const handler of this.handlers) {
          handler.dispatchWebsocketEvent({
            channel,
            createdAt: persistedEvent?.createdAt,
            eventId: persistedEvent?.id,
            payload
          })
        }
      })
      .catch((error) => {
        console.error("Failed to publish websocket event", error)
      })
  }

  /**
   * Fan a V2 channel broadcast out to every registered worker handler.
   * Persists the event to the event-log store (if the channel is marked
   * interested) so clients can resume from a `lastEventId` checkpoint.
   *
   * @param {object} args - Options object.
   * @param {string} args.channel - Channel name.
   * @param {Record<string, any>} args.broadcastParams - Routing filter params.
   * @param {any} args.body - Message body.
   * @returns {void}
   */
  broadcastV2({body, broadcastParams, channel}) {
    void this._persistV2EventIfNeeded({body, channel}).then((persistedEvent) => {
      for (const handler of this.handlers) {
        handler.dispatchWebsocketV2Broadcast({
          body,
          broadcastParams,
          channel,
          eventId: persistedEvent?.id,
          createdAt: persistedEvent?.createdAt
        })
      }
    }).catch((error) => {
      console.error("Failed to persist/broadcast V2 event", error)
    })
  }

  /**
   * @param {object} args - Options.
   * @param {any} args.body - Event body.
   * @param {string} args.channel - Channel name.
   * @returns {Promise<{createdAt: string, id: string} | null>}
   */
  async _persistV2EventIfNeeded({body, channel}) {
    const handler = this.handlers.values().next().value

    if (!handler?.configuration) return null

    const websocketEventLogStore = websocketEventLogStoreForConfiguration(handler.configuration)
    const shouldPersist = await websocketEventLogStore.shouldPersistChannel(channel)

    if (!shouldPersist) return null

    return await websocketEventLogStore.appendEvent({channel, payload: body})
  }

  /**
   * @param {object} args - Options object.
   * @param {string} args.channel - Channel name.
   * @param {any} args.payload - Payload data.
   * @returns {Promise<{createdAt: string, id: string} | null>} - Persisted event metadata.
   */
  async _persistEventIfNeeded({channel, payload}) {
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
