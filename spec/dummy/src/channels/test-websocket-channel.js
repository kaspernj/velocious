// @ts-check

import User from "../models/user.js"
import WebsocketChannel from "../../../../src/http-server/websocket-channel.js"

/** Test channel for websocket specs. Subscribes to a named broadcast. */
export default class TestWebsocketChannel extends WebsocketChannel {
  /** @returns {Promise<boolean>} */
  async canSubscribe() {
    return this.params?.token === "allow"
  }

  /** @returns {Promise<void>} */
  async subscribed() {
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
}
