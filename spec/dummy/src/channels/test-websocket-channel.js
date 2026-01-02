// @ts-check

import Account from "../models/account.js"
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
      await Account.first()
    }

    await this.streamFrom(String(subscribe))
  }
}
