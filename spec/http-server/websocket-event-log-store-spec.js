// @ts-check

import {describe, expect, it} from "../../src/testing/test.js"
import VelociousHttpServerWebsocketEventLogStore from "../../src/http-server/websocket-event-log-store.js"
import {websocketEventLogStoreForConfiguration} from "../../src/http-server/websocket-event-log-store.js"
import dummyConfiguration from "../dummy/src/config/configuration.js"

describe("websocket event log store", {tags: ["dummy"]}, () => {
  it("returns false from shouldPersistChannel without DB calls when no channels are interested", async () => {
    const store = new VelociousHttpServerWebsocketEventLogStore({configuration: dummyConfiguration})

    expect(store._interestedChannels.size).toEqual(0)
    expect(store._isReady).toEqual(false)

    const result = await store.shouldPersistChannel("test-channel")

    expect(result).toEqual(false)
    expect(store._isReady).toEqual(false)
  })

  it("returns true from shouldPersistChannel after marking a channel interested", async () => {
    const store = websocketEventLogStoreForConfiguration(dummyConfiguration)

    await store.markChannelInterested("persist-test")

    expect(store._interestedChannels.size).toBeGreaterThanOrEqual(1)

    const result = await store.shouldPersistChannel("persist-test")

    expect(result).toEqual(true)
  })

  it("returns false from shouldPersistChannel for an uninterested channel even when other channels are interested", async () => {
    const store = websocketEventLogStoreForConfiguration(dummyConfiguration)

    await store.markChannelInterested("other-channel")

    const result = await store.shouldPersistChannel("unregistered-channel")

    expect(result).toEqual(false)
  })

  it("appends and retrieves events by sequence", async () => {
    const store = websocketEventLogStoreForConfiguration(dummyConfiguration)

    const first = await store.appendEvent({channel: "seq-test", payload: {order: 1}})
    const second = await store.appendEvent({channel: "seq-test", payload: {order: 2}})

    expect(first.id).toBeDefined()
    expect(second.id).toBeDefined()

    const events = await store.getEventsAfter({channel: "seq-test", sequence: 0})
    const payloads = events.map((event) => event.payload.order)

    expect(payloads).toContain(1)
    expect(payloads).toContain(2)
  })

  it("retrieves a single event by id", async () => {
    const store = websocketEventLogStoreForConfiguration(dummyConfiguration)

    const appended = await store.appendEvent({channel: "get-by-id-test", payload: {key: "value"}})
    const retrieved = await store.getEventById({channel: "get-by-id-test", id: appended.id})

    expect(retrieved).toBeDefined()
    expect(retrieved?.id).toEqual(appended.id)
    expect(retrieved?.payload?.key).toEqual("value")
  })

  it("returns the latest sequence for a channel", async () => {
    const store = websocketEventLogStoreForConfiguration(dummyConfiguration)

    await store.appendEvent({channel: "latest-seq-test", payload: {n: 1}})
    await store.appendEvent({channel: "latest-seq-test", payload: {n: 2}})

    const latest = await store.latestSequence("latest-seq-test")

    expect(typeof latest).toEqual("number")
    expect(latest).toBeGreaterThanOrEqual(2)
  })

  it("cleans up expired events and replay channels", async () => {
    const store = websocketEventLogStoreForConfiguration(dummyConfiguration)

    await store.appendEvent({channel: "cleanup-test", payload: {old: true}})

    const futureDate = new Date(Date.now() + store.retentionMs + 60_000)

    await store.cleanupExpired({now: futureDate})

    const remaining = await store.getEventsAfter({channel: "cleanup-test", sequence: 0})
    const cleanupEvents = remaining.filter((event) => event.payload?.old === true)

    expect(cleanupEvents.length).toEqual(0)
  })
})
