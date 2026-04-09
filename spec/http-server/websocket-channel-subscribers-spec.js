// @ts-check

import {describe, expect, it} from "../../src/testing/test.js"
import VelociousWebsocketChannelSubscribers from "../../src/http-server/websocket-channel-subscribers.js"

describe("websocket channel subscribers", () => {
  it("dispatches events to subscribed callbacks", async () => {
    const subscribers = new VelociousWebsocketChannelSubscribers()
    const received = []

    subscribers.subscribe("test-channel", (payload, meta) => {
      received.push({payload, meta})
    })

    await subscribers.dispatch({
      channel: "test-channel",
      payload: {foo: "bar"},
      createdAt: "2026-04-09T00:00:00Z",
      eventId: "evt-1"
    })

    expect(received.length).toEqual(1)
    expect(received[0].payload).toEqual({foo: "bar"})
    expect(received[0].meta.channel).toEqual("test-channel")
    expect(received[0].meta.createdAt).toEqual("2026-04-09T00:00:00Z")
    expect(received[0].meta.eventId).toEqual("evt-1")
  })

  it("does not dispatch events to other channels", async () => {
    const subscribers = new VelociousWebsocketChannelSubscribers()
    const received = []

    subscribers.subscribe("channel-a", (payload) => received.push(payload))

    await subscribers.dispatch({channel: "channel-b", payload: {n: 1}})

    expect(received.length).toEqual(0)
  })

  it("supports multiple subscribers on the same channel", async () => {
    const subscribers = new VelociousWebsocketChannelSubscribers()
    const seenA = []
    const seenB = []

    subscribers.subscribe("shared", (payload) => seenA.push(payload))
    subscribers.subscribe("shared", (payload) => seenB.push(payload))

    await subscribers.dispatch({channel: "shared", payload: {n: 1}})
    await subscribers.dispatch({channel: "shared", payload: {n: 2}})

    expect(seenA.length).toEqual(2)
    expect(seenB.length).toEqual(2)
  })

  it("unsubscribe removes the callback", async () => {
    const subscribers = new VelociousWebsocketChannelSubscribers()
    const received = []
    const callback = (payload) => received.push(payload)

    const unsubscribe = subscribers.subscribe("ch", callback)

    await subscribers.dispatch({channel: "ch", payload: {n: 1}})
    expect(received.length).toEqual(1)

    unsubscribe()

    await subscribers.dispatch({channel: "ch", payload: {n: 2}})
    expect(received.length).toEqual(1)
    expect(subscribers.hasSubscribers("ch")).toEqual(false)
  })

  it("awaits async callbacks during dispatch", async () => {
    const subscribers = new VelociousWebsocketChannelSubscribers()
    let asyncDone = false

    subscribers.subscribe("async-ch", async () => {
      await new Promise((resolve) => setTimeout(resolve, 5))
      asyncDone = true
    })

    await subscribers.dispatch({channel: "async-ch", payload: {}})

    expect(asyncDone).toEqual(true)
  })

  it("hasSubscribers returns true while a callback is registered", async () => {
    const subscribers = new VelociousWebsocketChannelSubscribers()
    const callback = () => {}

    expect(subscribers.hasSubscribers("ch")).toEqual(false)
    const unsubscribe = subscribers.subscribe("ch", callback)
    expect(subscribers.hasSubscribers("ch")).toEqual(true)
    unsubscribe()
    expect(subscribers.hasSubscribers("ch")).toEqual(false)
  })

  it("subscribe throws on missing channel or callback", () => {
    const subscribers = new VelociousWebsocketChannelSubscribers()

    expect(() => subscribers.subscribe("", () => {})).toThrowError("channel is required")
    // @ts-expect-error - intentional bad type for runtime check
    expect(() => subscribers.subscribe("ch", null)).toThrowError("callback must be a function")
  })
})
