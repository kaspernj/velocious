// @ts-check

import User from "../models/user.js"
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
    if (params.checkDb) {
      await User.first()
    }

    await this.streamFrom(String(subscribe))
  }
}
