// @ts-check

import {describe, expect, it} from "../../src/testing/test.js"
import WebsocketClient from "../../src/http-client/websocket-client.js"
import {websocketEventLogStoreForConfiguration} from "../../src/http-server/websocket-event-log-store.js"
import Dummy from "../dummy/index.js"
import dummyConfiguration from "../dummy/src/config/configuration.js"
import waitFor from "../helpers/wait-for.js"

/**
 * Counts every row in the websocket event log regardless of channel.
 * @returns {Promise<number>} - Row count.
 */
async function countEventLogRows() {
  return await dummyConfiguration.ensureConnections({databaseIdentifiers: ["default"], name: "Live-only spec event log"}, async (dbs) => {
    const db = dbs.default

    if (!db) throw new Error("No default database connection available")

    const rows = await db.newQuery().from("websocket_channel_events").results()

    return rows.length
  })
}

describe("HttpServer - websocket live-only channels", {databaseCleaning: {transaction: false, truncate: true}}, async () => {
  it("refuses to mark a live-only channel interested in replay persistence", async () => {
    await Dummy.run(async () => {
      const store = websocketEventLogStoreForConfiguration(dummyConfiguration)

      await expect(async () => await store.markChannelInterested("live-only")).toThrow(/live-only/)
      expect(store._interestedChannels.has("live-only")).toBe(false)
    })
  })

  it("persists nothing for live-only channel broadcasts even after a refused interest marking", async () => {
    await Dummy.run(async () => {
      const store = websocketEventLogStoreForConfiguration(dummyConfiguration)

      await expect(async () => await store.markChannelInterested("live-only")).toThrow()

      dummyConfiguration.broadcastToChannel("live-only", {subscribe: "live-only"}, {headline: "never-persisted"})
      await dummyConfiguration.awaitPendingBroadcasts()

      expect(await store.shouldPersistChannel("live-only")).toEqual(false)
      const events = await store.getEventsAfter({channel: "live-only", sequence: 0})

      expect(events).toEqual([])
    })
  })

  it("never persists inbound websocket write traffic", async () => {
    await Dummy.run(async () => {
      const client = new WebsocketClient()
      const store = websocketEventLogStoreForConfiguration(dummyConfiguration)

      try {
        await store.ensureReady()
        await client.connect()

        // HTTP-over-websocket request traffic.
        const versionResponse = await client.post("/api/version")

        expect(versionResponse.statusCode).toEqual(200)

        // 1:1 connection-message traffic on the registered Echo connection.
        /** @type {Array<Record<string, ReturnType<typeof JSON.parse>>>} */
        const received = []
        const connection = client.openConnection("Echo", {onMessage: (body) => received.push(body)})

        await connection.ready
        await waitFor(() => received.length >= 1)
        received.length = 0

        connection.sendMessage({ping: "live-only-check"})
        await waitFor(() => received.some((body) => body.echo?.ping === "live-only-check"))

        connection.close()

        await dummyConfiguration.awaitPendingBroadcasts()

        expect(await countEventLogRows()).toEqual(0)
      } finally {
        await client.close()
      }
    })
  })
})
