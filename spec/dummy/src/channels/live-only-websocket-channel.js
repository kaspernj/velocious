// @ts-check

import WebsocketChannel from "../../../../src/http-server/websocket-channel.js"

/**
 * Test channel registered with `{liveOnly: true}` so specs can prove the
 * event-log store refuses to persist it and that its broadcasts never
 * reach `websocket_channel_events`.
 */
export default class LiveOnlyWebsocketChannel extends WebsocketChannel {
  /** @returns {Promise<boolean>} */
  async canSubscribe() {
    return this.params?.token === "allow"
  }

  /**
   * @param {import("../../../../src/http-server/websocket-channel.js").WebsocketParams} broadcastParams
   * @returns {boolean}
   */
  matches(broadcastParams) {
    return broadcastParams?.channel === this.params?.subscribe
  }
}
