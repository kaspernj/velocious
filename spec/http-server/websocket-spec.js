// @ts-check

import {describe, expect, it} from "../../src/testing/test.js"
import Dummy from "../dummy/index.js"
import WebsocketClient from "../../src/http-client/websocket-client.js"

const getMessageText = (event) => {
  if (typeof event.data === "string") return event.data
  if (Buffer.isBuffer(event.data)) return event.data.toString("utf-8")
  if (event.data instanceof ArrayBuffer) return Buffer.from(event.data).toString("utf-8")
  return event.data?.toString?.()
}

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
      const socket = new WebSocket("ws://127.0.0.1:3006/websocket")
      const client = new WebsocketClient()

      try {
        await new Promise((resolve, reject) => {
          socket.addEventListener("open", () => resolve())
          socket.addEventListener("error", (event) => {
            reject(event?.error || new Error("Websocket connection error"))
          })
        })

        const subscribedPromise = new Promise((resolve, reject) => {
          const timeout = setTimeout(() => reject(new Error("Timed out waiting for channel subscription")), 2000)

          socket.addEventListener("message", (event) => {
            const raw = getMessageText(event)

            if (!raw) return

            try {
              const msg = JSON.parse(raw)

              if (msg.type === "subscribed" && msg.channel === "news") {
                clearTimeout(timeout)
                resolve()
              }
            } catch (error) {
              clearTimeout(timeout)
              reject(error)
            }
          })
        })

        socket.send(JSON.stringify({type: "subscribe", channel: "test", params: {subscribe: "news", token: "allow"}}))
        await subscribedPromise
        await client.connect()

        const eventPromise = new Promise((resolve, reject) => {
          const timeout = setTimeout(() => reject(new Error("Timed out waiting for event")), 2000)

          socket.addEventListener("message", (event) => {
            const raw = getMessageText(event)

            if (!raw) return

            try {
              const msg = JSON.parse(raw)

              if (msg.type === "event" && msg.channel === "news") {
                clearTimeout(timeout)
                resolve(msg.payload)
              }
            } catch (error) {
              clearTimeout(timeout)
              reject(error)
            }
          })
        })

        const response = await client.post("/api/broadcast-event", {channel: "news", payload: {headline: "breaking"}})
        const eventPayload = await eventPromise

        expect(response.statusCode).toEqual(200)
        expect(eventPayload.headline).toEqual("breaking")
      } finally {
        socket.close()
        await client.close()
      }
    })
  })

  it("subscribes via websocket channels on connect", async () => {
    await Dummy.run(async () => {
      const socket = new WebSocket("ws://127.0.0.1:3006/websocket")
      const openPromise = new Promise((resolve, reject) => {
        socket.addEventListener("open", () => resolve())
        socket.addEventListener("error", (event) => {
          reject(event?.error || new Error("Websocket connection error"))
        })
      })

      const subscribedPromise = new Promise((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error("Timed out waiting for channel subscription")), 2000)

        socket.addEventListener("message", (event) => {
            const raw = getMessageText(event)

          if (!raw) return

          try {
            const msg = JSON.parse(raw)

            if (msg.type === "subscribed" && msg.channel === "updates") {
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
        socket.send(JSON.stringify({type: "subscribe", channel: "test", params: {subscribe: "updates", token: "allow"}}))
        await subscribedPromise
      } finally {
        socket.close()
      }
    })
  })

  it("provides db connections to channel callbacks", async () => {
    await Dummy.run(async () => {
      const socket = new WebSocket("ws://127.0.0.1:3006/websocket")
      const openPromise = new Promise((resolve, reject) => {
        socket.addEventListener("open", () => resolve())
        socket.addEventListener("error", (event) => {
          reject(event?.error || new Error("Websocket connection error"))
        })
      })

      const subscribedPromise = new Promise((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error("Timed out waiting for channel subscription")), 2000)

        socket.addEventListener("message", (event) => {
            const raw = getMessageText(event)

          if (!raw) return

          try {
            const msg = JSON.parse(raw)

            if (msg.type === "subscribed" && msg.channel === "updates") {
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
        socket.send(JSON.stringify({type: "subscribe", channel: "test", params: {subscribe: "updates", token: "allow", checkDb: true}}))
        await subscribedPromise
      } finally {
        socket.close()
      }
    })
  })

  it("does not subscribe when channel authorization fails", async () => {
    await Dummy.run(async () => {
      const socket = new WebSocket("ws://127.0.0.1:3006/websocket")
      const openPromise = new Promise((resolve, reject) => {
        socket.addEventListener("open", () => resolve())
        socket.addEventListener("error", (event) => {
          reject(event?.error || new Error("Websocket connection error"))
        })
      })

      let receivedPayload
      socket.addEventListener("message", (event) => {
        const raw = getMessageText(event)

        if (!raw) return

        try {
          const msg = JSON.parse(raw)

          if (msg.type === "event" && msg.channel === "updates") {
            receivedPayload = msg.payload
          }
        } catch {
          // Ignore invalid payloads for this test
        }
      })

      try {
        await openPromise
        socket.send(JSON.stringify({type: "subscribe", channel: "test", params: {subscribe: "updates", token: "deny"}}))
        await new Promise((resolve) => setTimeout(resolve, 300))

        expect(receivedPayload).toEqual(undefined)
      } finally {
        socket.close()
      }
    })
  })

  it("handles raw websocket message handlers", async () => {
    await Dummy.run(async () => {
      const socket = new WebSocket("ws://127.0.0.1:3006/raw-socket")

      try {
        await new Promise((resolve, reject) => {
          socket.addEventListener("open", () => resolve())
          socket.addEventListener("error", (event) => {
            reject(event?.error || new Error("Websocket connection error"))
          })
        })

        const welcomePromise = new Promise((resolve, reject) => {
          const timeout = setTimeout(() => reject(new Error("Timed out waiting for welcome message")), 2000)

          socket.addEventListener("message", (event) => {
            const raw = getMessageText(event)

            if (!raw) return

            try {
              const msg = JSON.parse(raw)

              if (msg.type === "welcome") {
                clearTimeout(timeout)
                resolve(msg)
              }
            } catch (error) {
              clearTimeout(timeout)
              reject(error)
            }
          })
        })

        await welcomePromise

        const echoPromise = new Promise((resolve, reject) => {
          const timeout = setTimeout(() => reject(new Error("Timed out waiting for echo message")), 2000)

          socket.addEventListener("message", (event) => {
            const raw = getMessageText(event)

            if (!raw) return

            try {
              const msg = JSON.parse(raw)

              if (msg.type === "echo") {
                clearTimeout(timeout)
                resolve(msg.payload)
              }
            } catch (error) {
              clearTimeout(timeout)
              reject(error)
            }
          })
        })

        const payload = {topic: "raw", value: 42}
        socket.send(JSON.stringify(payload))

        const echoedPayload = await echoPromise
        expect(echoedPayload).toEqual(payload)
      } finally {
        socket.close()
      }
    })
  })
})
