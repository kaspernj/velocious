// @ts-check

import { describe, expect, it } from "../../src/testing/test.js"
import { decodeServerTextFrame } from "../helpers/websocket-frame.js"
import FrontendModelWebsocketChannel from "../../src/frontend-models/websocket-channel.js"
import HttpServerClient from "../../src/http-server/client/index.js"
import WebsocketSession from "../../src/http-server/client/websocket-session.js"
import dummyConfiguration from "../dummy/src/config/configuration.js"
import { websocketEventLogStoreForConfiguration } from "../../src/http-server/websocket-event-log-store.js"

describe("FrontendModelWebsocketChannel replay", {databaseCleaning: {transaction: true}, tags: ["dummy"]}, () => {
  it("reports a replay gap when a destroyed record has no authorization snapshot", async () => {
    const store = websocketEventLogStoreForConfiguration(dummyConfiguration)
    const checkpoint = await store.appendEvent({
      channel: "frontend-models",
      payload: {action: "update", id: "checkpoint-task", model: "Task"}
    })

    await store.appendEvent({
      channel: "frontend-models",
      payload: {action: "destroy", id: "destroyed-task", model: "Task"}
    })

    const client = new HttpServerClient({
      clientCount: 1,
      configuration: dummyConfiguration,
      remoteAddress: "127.0.0.1"
    })
    const session = new WebsocketSession({client, configuration: dummyConfiguration})
    const subscription = new FrontendModelWebsocketChannel({
      params: {model: "Task"},
      session,
      subscriptionId: "frontend-model-replay"
    })
    /** @type {Array<Record<string, ReturnType<typeof JSON.parse>>>} */
    const sentMessages = []

    client.events.on("output", (output) => {
      if (output instanceof Buffer) sentMessages.push(JSON.parse(decodeServerTextFrame(output)))
    })

    try {
      await session._replayChannelEventsForSubscription({
        channelType: "frontend-models",
        lastEventId: checkpoint.id,
        subscription
      })
    } finally {
      session.destroy()
    }

    expect(sentMessages).toEqual([{
      lastEventId: checkpoint.id,
      subscriptionId: "frontend-model-replay",
      type: "channel-replay-gap"
    }])
  })
})
