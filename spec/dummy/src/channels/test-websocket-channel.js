// @ts-check

import WebsocketChannel from "../../../../src/http-server/websocket-channel.js"

export default class TestWebsocketChannel extends WebsocketChannel {
  async subscribed() {
    const params = this.params()
    const token = params.token
    const subscribe = params.subscribe

    if (token !== "allow") {
      this.websocketSession.sendGoodbye(this.client)
      return
    }
    if (!subscribe) return

    await this.streamFrom(`channel:${subscribe}`)
    await this.websocketSession.sendEvent(`channel:${subscribe}`, {headline: "from-channel"})
  }
}
