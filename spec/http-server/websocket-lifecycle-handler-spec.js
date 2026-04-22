// @ts-check

import {describe, expect, it} from "../../src/testing/test.js"
import Dummy from "../dummy/index.js"
import EventEmitter from "../../src/utils/event-emitter.js"
import WebsocketClient from "../../src/http-client/websocket-client.js"
import WebsocketSession from "../../src/http-server/client/websocket-session.js"
import dummyConfiguration from "../dummy/src/config/configuration.js"

describe("WebsocketSession lifecycle-only message handler", () => {
  it("falls through to default routing for channel-subscribe when handler has no onMessage", async () => {
    const session = new WebsocketSession({
      client: /** @type {any} */ ({events: new EventEmitter(), remoteAddress: "127.0.0.1"}),
      configuration: dummyConfiguration,
      messageHandler: {
        onOpen: () => {},
        onClose: () => {}
      }
    })

    /** @type {any[]} */
    const handledChannelSubscribes = []

    session._handleChannelSubscribe = async (message) => { handledChannelSubscribes.push(message) }

    await session._handleMessage({
      type: "channel-subscribe",
      subscriptionId: "s1",
      channelType: "Counter",
      params: {allow: true}
    })

    expect(handledChannelSubscribes.length).toBe(1)
    expect(handledChannelSubscribes[0]).toMatchObject({
      type: "channel-subscribe",
      subscriptionId: "s1",
      channelType: "Counter"
    })
  })

  it("still routes every message through onMessage when the handler defines one", async () => {
    const session = new WebsocketSession({
      client: /** @type {any} */ ({events: new EventEmitter(), remoteAddress: "127.0.0.1"}),
      configuration: dummyConfiguration,
      messageHandler: {
        onMessage: async ({message}) => { received.push(message) }
      }
    })

    /** @type {any[]} */
    const received = []

    await session._handleMessage({type: "channel-subscribe", subscriptionId: "s1", channelType: "X"})
    await session._handleMessage({type: "metadata", data: {locale: "en"}})

    expect(received.length).toBe(2)
    expect(received[0]).toMatchObject({type: "channel-subscribe", subscriptionId: "s1"})
    expect(received[1]).toMatchObject({type: "metadata"})
    expect(session.getMetadata()).toEqual({})
  })

  it("finishes an async onOpen before replaying queued messages", async () => {
    /** @type {string[]} */
    const callOrder = []

    const session = new WebsocketSession({
      client: /** @type {any} */ ({events: new EventEmitter(), remoteAddress: "127.0.0.1"}),
      configuration: dummyConfiguration,
      messageHandlerPromise: Promise.resolve({
        onOpen: async () => {
          await new Promise((resolve) => setTimeout(resolve, 20))
          callOrder.push("onOpen:done")
        }
      })
    })

    session._handleChannelSubscribe = async () => { callOrder.push("channel-subscribe:dispatched") }

    // Queue a message while the handler is still pending so it
    // lands in messageQueue and is flushed after the promise
    // resolves.
    await session._handleMessage({type: "channel-subscribe", subscriptionId: "s1", channelType: "Counter"})

    await session._resolveMessageHandlerPromise()

    expect(callOrder).toEqual(["onOpen:done", "channel-subscribe:dispatched"])
  })

  it("subscribes via the lifecycle-only socket path when the server only tracks open/close", async () => {
    await Dummy.run(async () => {
      const client = new WebsocketClient({url: "ws://127.0.0.1:3006/lifecycle-only-socket"})

      try {
        const subscription = client.subscribeChannel("Counter", {
          params: {allow: true, topic: "lifecycle-handler"}
        })

        await client.connect()

        await subscription.waitForReady({timeoutMs: 3000})
        expect(subscription.isReady()).toBe(true)
        expect(subscription.isSubscribed()).toBe(true)
      } finally {
        await client.disconnectAndStopReconnect()
      }
    })
  })
})
