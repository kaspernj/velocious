// @ts-check

import User from "../models/user.js"
import WebsocketChannel from "../../../../src/http-server/websocket-channel.js"
import {websocketEventLogStoreForConfiguration} from "../../../../src/http-server/websocket-event-log-store.js"

/** Test channel for websocket specs. Subscribes to a named broadcast. */
export default class TestWebsocketChannel extends WebsocketChannel {
  /** @returns {Promise<boolean>} */
  async canSubscribe() {
    return this.params?.token === "allow"
  }

  /** @returns {Promise<void>} */
  async subscribed() {
    // Mark "test" as interested in the event-log store so replay tests
    // have persisted events to resume from.
    const store = websocketEventLogStoreForConfiguration(this.session.configuration)

    await store.markChannelInterested("test")

    if (this.params?.checkDb) {
      await User.count()
    }
  }

  /**
   * @param {Record<string, any>} broadcastParams
   * @returns {boolean}
   */
  matches(broadcastParams) {
    return broadcastParams?.channel === this.params?.subscribe
  }

  /**
   * Marks deliveries when a websocket spec needs to prove replay uses the channel gate.
   * @param {import("../../../../src/http-server/websocket-channel.js").WebsocketJsonValue} body - Broadcast body.
   * @param {{eventId?: string}} [meta] - Broadcast metadata.
   * @returns {void}
   */
  deliverBroadcast(body, meta) {
    if (this.params?.markDelivery && body && typeof body === "object") {
      this.sendMessage({...body, deliveredByChannel: true}, meta)
      return
    }

    super.deliverBroadcast(body, meta)
  }
}
