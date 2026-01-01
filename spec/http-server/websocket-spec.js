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

  it("subscribes via websocket channels on connect", async () => {
    await Dummy.run(async () => {
      const socket = new WebSocket("ws://127.0.0.1:3006/websocket?channel=test&subscribe=updates&token=allow")
      const openPromise = new Promise((resolve, reject) => {
        socket.addEventListener("open", () => resolve())
        socket.addEventListener("error", (event) => {
          reject(event?.error || new Error("Websocket connection error"))
        })
      })

      const subscribedPromise = new Promise((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error("Timed out waiting for channel subscription")), 2000)

        socket.addEventListener("message", (event) => {
          const raw = typeof event.data === "string" ? event.data : event.data?.toString?.()

          if (!raw) return

          try {
            const msg = JSON.parse(raw)

            if (msg.type === "subscribed" && msg.channel === "channel:updates") {
              clearTimeout(timeout)
              resolve()
            }
          } catch (error) {
            clearTimeout(timeout)
            reject(error)
          }
        })
      })

      try {
        await openPromise
        await subscribedPromise
      } finally {
        socket.close()
      }
    })
  })

  it("does not subscribe when channel authorization fails", async () => {
    await Dummy.run(async () => {
      const socket = new WebSocket("ws://127.0.0.1:3006/websocket?channel=test&subscribe=updates&token=deny")
      const openPromise = new Promise((resolve, reject) => {
        socket.addEventListener("open", () => resolve())
        socket.addEventListener("error", (event) => {
          reject(event?.error || new Error("Websocket connection error"))
        })
      })

      let receivedPayload
      socket.addEventListener("message", (event) => {
        const raw = typeof event.data === "string" ? event.data : event.data?.toString?.()

        if (!raw) return

        try {
          const msg = JSON.parse(raw)

          if (msg.type === "event" && msg.channel === "channel:updates") {
            receivedPayload = msg.payload
          }
        } catch {
          // Ignore invalid payloads for this test
        }
      })

      try {
        await openPromise
        await new Promise((resolve) => setTimeout(resolve, 300))

        expect(receivedPayload).toEqual(undefined)
      } finally {
        socket.close()
      }
    })
  })
})
