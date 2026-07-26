// @ts-check

import {describe, expect, it} from "../../src/testing/test.js"
import dummyConfiguration from "../dummy/src/config/configuration.js"
import {VelociousHttpServerWebsocketEventsHost} from "../../src/http-server/websocket-events-host.js"

describe("HttpServer - websocket events host", {databaseCleaning: {transaction: true}}, () => {
  it("keeps broadcast handlers separate from subscription debug state", () => {
    const host = new VelociousHttpServerWebsocketEventsHost()
    const subscription = {debugSnapshot: () => ({topic: "debug"})}
    const handler = {
      configuration: dummyConfiguration,
      dispatchWebsocketV2Broadcast: () => {},
      websocketV2BroadcastDispatchKey: () => dummyConfiguration
    }

    dummyConfiguration._registerWebsocketChannelSubscription("RegistrySeparation", /** @type {?} */ (subscription))
    const unregister = host.register(/** @type {?} */ (handler))

    expect(dummyConfiguration._websocketChannelSubscriptions.get("RegistrySeparation")).toEqual(new Set([subscription]))
    expect(host.broadcastHandlersByConfiguration.get(dummyConfiguration)).toEqual(new Set([handler]))
    expect(dummyConfiguration.getLocalDebugSnapshot().websockets.subscriptions.find(({channel}) => channel === "RegistrySeparation")).toEqual({
      channel: "RegistrySeparation",
      count: 1,
      details: [{count: 1, details: {topic: "debug"}}]
    })

    unregister()
    dummyConfiguration._unregisterWebsocketChannelSubscription("RegistrySeparation", /** @type {?} */ (subscription))
    expect(host.broadcastHandlersByConfiguration.has(dummyConfiguration)).toEqual(false)
  })

  it("isolates configuration-local broadcasts and deduplicates shared in-process handlers", async () => {
    const host = new VelociousHttpServerWebsocketEventsHost()
    const configurationA = {
      withoutCurrentConnectionContexts: async (callback) => await callback()
    }
    const configurationB = {
      withoutCurrentConnectionContexts: async (callback) => await callback()
    }
    const deliveries = []

    for (const mountContext of ["a-1", "a-2"]) {
      host.register({
        configuration: configurationA,
        dispatchWebsocketV2Broadcast: ({body}) => deliveries.push({body, configuration: "A", mountContext}),
        websocketV2BroadcastDispatchKey: () => configurationA
      })
    }

    host.register({
      configuration: configurationB,
      dispatchWebsocketV2Broadcast: ({body}) => deliveries.push({body, configuration: "B", mountContext: "b-1"}),
      websocketV2BroadcastDispatchKey: () => configurationB
    })

    host.broadcastV2({
      body: {count: 1},
      broadcastParams: {subscription: "shared"},
      channel: "Counter",
      configuration: configurationA
    })
    host.broadcastV2({
      body: {count: 2},
      broadcastParams: {subscription: "shared"},
      channel: "Counter",
      configuration: configurationB
    })
    await host.awaitPendingBroadcasts()

    expect(deliveries).toEqual([
      {body: {count: 1}, configuration: "A", mountContext: "a-1"},
      {body: {count: 2}, configuration: "B", mountContext: "b-1"}
    ])
  })
})
