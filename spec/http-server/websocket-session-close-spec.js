// @ts-check

import {describe, expect, it} from "../../src/testing/test.js"
import EventEmitter from "../../src/utils/event-emitter.js"
import WebsocketChannel from "../../src/http-server/websocket-channel.js"
import WebsocketRequest from "../../src/http-server/client/websocket-request.js"
import WebsocketSession from "../../src/http-server/client/websocket-session.js"
import dummyConfiguration from "../dummy/src/config/configuration.js"

class ResumableChannel extends WebsocketChannel {
  /** @returns {boolean} */
  canSubscribe() { return true }
}

describe("WebsocketSession close handling", () => {
  it("emits the websocket goodbye frame before the resumable session close event", async () => {
    /** @type {string[]} */
    const eventOrder = []
    const clientEvents = new EventEmitter()
    const session = new WebsocketSession({
      client: /** @type {any} */ ({events: clientEvents, remoteAddress: "127.0.0.1"}),
      configuration: dummyConfiguration,
      upgradeRequest: new WebsocketRequest({method: "GET", path: "/websocket", remoteAddress: "127.0.0.1"})
    })

    session.events.on("close", () => {
      eventOrder.push("close")
    })

    clientEvents.on("output", () => {
      eventOrder.push("output")
    })

    session._channelSubscriptions.set("s1", {
      channelType: "test",
      subscription: new ResumableChannel({params: {}, session, subscriptionId: "s1"})
    })

    session.onData(Buffer.from([0x88, 0x00]))

    expect(eventOrder).toEqual(["output", "close"])

    dummyConfiguration._clearPausedWebsocketSession(session.sessionId)
  })
})
