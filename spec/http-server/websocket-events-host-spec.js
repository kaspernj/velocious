// @ts-check

import {describe, expect, it} from "../../src/testing/test.js"
import {VelociousHttpServerWebsocketEventsHost} from "../../src/http-server/websocket-events-host.js"

describe("HttpServer - websocket events host", {databaseCleaning: {transaction: true}}, () => {
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
