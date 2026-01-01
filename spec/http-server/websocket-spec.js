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

  it("blocks subscriptions when the subscription filter rejects them", async () => {
    await Dummy.run(async () => {
      const client = new WebsocketClient({url: "ws://127.0.0.1:3006/websocket?token=deny"})

      try {
        await client.connect()

        let receivedPayload
        client.on("protected:news", (payload) => {
          receivedPayload = payload
        })

        await new Promise((resolve) => setTimeout(resolve, 100))

        await client.post("/api/broadcast-event", {channel: "protected:news", payload: {headline: "blocked"}})

        await new Promise((resolve) => setTimeout(resolve, 300))

        expect(receivedPayload).toEqual(undefined)
      } finally {
        await client.close()
      }
    })
  })

  it("filters events per websocket client before sending", async () => {
    await Dummy.run(async () => {
      const allowedClient = new WebsocketClient({url: "ws://127.0.0.1:3006/websocket?eventToken=allow"})
      const blockedClient = new WebsocketClient({url: "ws://127.0.0.1:3006/websocket?eventToken=deny"})

      try {
        await Promise.all([allowedClient.connect(), blockedClient.connect()])

        const allowedEvent = new Promise((resolve, reject) => {
          const timeout = setTimeout(() => reject(new Error("Timed out waiting for allowed event")), 2000)
          const unsubscribe = allowedClient.on("filtered:updates", (payload) => {
            clearTimeout(timeout)
            unsubscribe()
            resolve(payload)
          })
        })

        let blockedPayload
        blockedClient.on("filtered:updates", (payload) => {
          blockedPayload = payload
        })

        await new Promise((resolve) => setTimeout(resolve, 100))

        await allowedClient.post("/api/broadcast-event", {channel: "filtered:updates", payload: {headline: "visible"}})

        const payload = await allowedEvent

        await new Promise((resolve) => setTimeout(resolve, 300))

        expect(payload.headline).toEqual("visible")
        expect(blockedPayload).toEqual(undefined)
      } finally {
        await Promise.all([allowedClient.close(), blockedClient.close()])
      }
    })
  })

  it("subscribes via websocket channels on connect", async () => {
    await Dummy.run(async () => {
      const socket = new WebSocket("ws://127.0.0.1:3006/websocket?channel=test&subscribe=updates&token=allow")
      const openPromise = new Promise((resolve, reject) => {
        socket.addEventListener("open", () => resolve())
        socket.addEventListener("error", (event) => {
          reject(event?.error || new Error("Websocket connection error"))
        })
      })

      const eventPromise = new Promise((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error("Timed out waiting for channel event")), 2000)

        socket.addEventListener("message", (event) => {
          const raw = typeof event.data === "string" ? event.data : event.data?.toString?.()

          if (!raw) return

          try {
            const msg = JSON.parse(raw)

            if (msg.type === "event" && msg.channel === "channel:updates") {
              clearTimeout(timeout)
              resolve(msg.payload)
            }
          } catch (error) {
            clearTimeout(timeout)
            reject(error)
          }
        })
      })

      const client = new WebsocketClient()

      try {
        await openPromise
        await client.connect()

        await client.post("/api/broadcast-event", {channel: "channel:updates", payload: {headline: "from-channel"}})

        const payload = await eventPromise

        expect(payload.headline).toEqual("from-channel")
      } finally {
        socket.close()
        await client.close()
      }
    })
  })
})
