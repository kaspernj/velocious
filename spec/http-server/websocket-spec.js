// @ts-check

import {describe, expect, it} from "../../src/testing/test.js"
import Dummy from "../dummy/index.js"
import WebsocketClient from "../../src/http-client/websocket-client.js"

describe("HttpServer - websocket", {databaseCleaning: {transaction: false, truncate: true}}, async () => {
  it("delegates websocket requests through controllers", async () => {
    await Dummy.run(async () => {
      const client = new WebsocketClient()

      try {
        await client.connect()

        const response = await client.post("/api/version")
        const parsedBody = response.json()

        expect(response.statusCode).toEqual(200)
        expect(parsedBody.version).toEqual("2.1")
      } finally {
        await client.close()
      }
    })
  })

  it("broadcasts published events to websocket subscribers", async () => {
    await Dummy.run(async () => {
      const client = new WebsocketClient()

      try {
        await client.connect()

        const eventPromise = new Promise((resolve, reject) => {
          const timeout = setTimeout(() => reject(new Error("Timed out waiting for event")), 2000)
          const unsubscribe = client.on("news", (payload) => {
            clearTimeout(timeout)
            unsubscribe()
            resolve(payload)
          })
        })

        const response = await client.post("/api/broadcast-event", {channel: "news", payload: {headline: "breaking"}})
        const eventPayload = await eventPromise

        expect(response.statusCode).toEqual(200)
        expect(eventPayload.headline).toEqual("breaking")
      } finally {
        await client.close()
      }
    })
  })
})
