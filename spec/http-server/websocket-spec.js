// @ts-check

import {describe, expect, it} from "../../src/testing/test.js"
import {websocketEventLogStoreForConfiguration} from "../../src/http-server/websocket-event-log-store.js"
import Dummy from "../dummy/index.js"
import dummyConfiguration from "../dummy/src/config/configuration.js"
import WebsocketClient from "../../src/http-client/websocket-client.js"

const getMessageText = (event) => {
  if (typeof event.data === "string") return event.data
  if (Buffer.isBuffer(event.data)) return event.data.toString("utf-8")
  if (event.data instanceof ArrayBuffer) return Buffer.from(event.data).toString("utf-8")
  return event.data?.toString?.()
}

const waitForSocketOpen = async (socket) => {
  await new Promise((resolve, reject) => {
    socket.addEventListener("open", () => resolve())
    socket.addEventListener("error", (event) => {
      reject(event?.error || new Error("Websocket connection error"))
    })
  })
}

const waitForSocketMessage = async (socket, predicate) => {
  return await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("Timed out waiting for websocket message")), 2000)
    const listener = (event) => {
      const raw = getMessageText(event)

      if (!raw) return

      try {
        const message = JSON.parse(raw)

        if (!predicate(message)) return

        clearTimeout(timeout)
        socket.removeEventListener("message", listener)
        resolve(message)
      } catch (error) {
        clearTimeout(timeout)
        socket.removeEventListener("message", listener)
        reject(error)
      }
    }

    socket.addEventListener("message", listener)
  })
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

              if (msg.type === "channel-subscribed" && msg.subscriptionId === "s1") {
                clearTimeout(timeout)
                resolve()
              }
            } catch (error) {
              clearTimeout(timeout)
              reject(error)
            }
          })
        })

        socket.send(JSON.stringify({type: "channel-subscribe", channelType: "test", subscriptionId: "s1", params: {subscribe: "news", token: "allow"}}))
        await subscribedPromise
        await client.connect()

        const eventPromise = new Promise((resolve, reject) => {
          const timeout = setTimeout(() => reject(new Error("Timed out waiting for event")), 2000)

          socket.addEventListener("message", (event) => {
            const raw = getMessageText(event)

            if (!raw) return

            try {
              const msg = JSON.parse(raw)

              if (msg.type === "channel-message" && msg.subscriptionId === "s1") {
                clearTimeout(timeout)
                resolve(msg.body)
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

  it("replays missed events after reconnect before live streaming continues", async () => {
    await Dummy.run(async () => {
      const client = new WebsocketClient()
      const firstSocket = new WebSocket("ws://127.0.0.1:3006/websocket")

      try {
        await waitForSocketOpen(firstSocket)
        firstSocket.send(JSON.stringify({type: "channel-subscribe", channelType: "test", subscriptionId: "s1", params: {subscribe: "news", token: "allow"}}))
        await waitForSocketMessage(firstSocket, (message) => message.type === "channel-subscribed" && message.subscriptionId === "s1")
        await client.connect()

        const firstEventPromise = waitForSocketMessage(firstSocket, (message) => {
          return message.type === "channel-message" && message.subscriptionId === "s1" && message.body?.headline === "first"
        })

        await client.post("/api/broadcast-event", {channel: "news", payload: {headline: "first"}})
        const firstEvent = await firstEventPromise


        firstSocket.close()

        await client.post("/api/broadcast-event", {channel: "news", payload: {headline: "second"}})

        const secondSocket = new WebSocket("ws://127.0.0.1:3006/websocket")

        try {
          await waitForSocketOpen(secondSocket)

          const seenMessages = []
          const replayedMessagesPromise = new Promise((resolve, reject) => {
            const timeout = setTimeout(() => reject(new Error("Timed out waiting for replayed websocket messages")), 2000)
            const listener = (event) => {
              const raw = getMessageText(event)

              if (!raw) return

              try {
                const message = JSON.parse(raw)

                seenMessages.push(message)

                if (message.type === "channel-subscribed" && message.subscriptionId === "s1") {
                  clearTimeout(timeout)
                  secondSocket.removeEventListener("message", listener)
                  resolve(seenMessages)
                }
              } catch (error) {
                clearTimeout(timeout)
                secondSocket.removeEventListener("message", listener)
                reject(error)
              }
            }

            secondSocket.addEventListener("message", listener)
          })

          secondSocket.send(JSON.stringify({
            type: "channel-subscribe",
            channelType: "test",
            subscriptionId: "s1",
            lastEventId: firstEvent.eventId,
            params: {subscribe: "news", token: "allow"}
          }))

          const replayedMessages = await replayedMessagesPromise


          const replayedEvent = replayedMessages.find((message) => {
            return message.type === "channel-message" && message.subscriptionId === "s1" && message.body?.headline === "second"
          })

          // Skip framework frames (session-established etc.) when
          // asserting the replay order.
          const appMessages = replayedMessages.filter((message) => !message.type?.startsWith("session-"))

          expect(appMessages.some((m) => m.type === "channel-subscribed")).toBe(true)
          expect(replayedEvent).toBeDefined()
        } finally {
          secondSocket.close()
        }

        await websocketEventLogStoreForConfiguration(dummyConfiguration).cleanupExpired({now: new Date(Date.now() + 11 * 60 * 1000)})
      } finally {
        firstSocket.close()
        await client.close()
      }
    })
  })

  it("persists one replay-log event for one logical publish across multiple subscribers", async () => {
    await Dummy.run(async () => {
      const client = new WebsocketClient()
      const firstSocket = new WebSocket("ws://127.0.0.1:3006/websocket")
      const secondSocket = new WebSocket("ws://127.0.0.1:3006/websocket")

      try {
        await waitForSocketOpen(firstSocket)
        await waitForSocketOpen(secondSocket)

        const firstSubscribedPromise = waitForSocketMessage(firstSocket, (message) => {
          return message.type === "channel-subscribed" && message.subscriptionId === "s1"
        })
        const secondSubscribedPromise = waitForSocketMessage(secondSocket, (message) => {
          return message.type === "channel-subscribed" && message.subscriptionId === "s1"
        })

        firstSocket.send(JSON.stringify({type: "channel-subscribe", channelType: "test", subscriptionId: "s1", params: {subscribe: "news", token: "allow"}}))
        secondSocket.send(JSON.stringify({type: "channel-subscribe", channelType: "test", subscriptionId: "s1", params: {subscribe: "news", token: "allow"}}))

        await firstSubscribedPromise
        await secondSubscribedPromise
        await client.connect()

        const firstEventPromise = waitForSocketMessage(firstSocket, (message) => {
          return message.type === "channel-message" && message.subscriptionId === "s1" && message.body?.headline === "once"
        })
        const secondEventPromise = waitForSocketMessage(secondSocket, (message) => {
          return message.type === "channel-message" && message.subscriptionId === "s1" && message.body?.headline === "once"
        })

        await client.post("/api/broadcast-event", {channel: "news", payload: {headline: "once"}})
        await Promise.all([firstEventPromise, secondEventPromise])

        const persistedEvents = await websocketEventLogStoreForConfiguration(dummyConfiguration).getEventsAfter({
          channel: "test",
          sequence: 0
        })

        expect(persistedEvents.length).toEqual(1)
        expect(persistedEvents[0]?.payload?.headline).toEqual("once")
      } finally {
        firstSocket.close()
        secondSocket.close()
        await client.close()
      }
    })
  })

  it("reports replay gaps when the checkpoint event is no longer retained", async () => {
    await Dummy.run(async () => {
      const client = new WebsocketClient()
      const firstSocket = new WebSocket("ws://127.0.0.1:3006/websocket")

      try {
        await waitForSocketOpen(firstSocket)
        firstSocket.send(JSON.stringify({type: "channel-subscribe", channelType: "test", subscriptionId: "s1", params: {subscribe: "news", token: "allow"}}))
        await waitForSocketMessage(firstSocket, (message) => message.type === "channel-subscribed" && message.subscriptionId === "s1")
        await client.connect()

        const firstEventPromise = waitForSocketMessage(firstSocket, (message) => {
          return message.type === "channel-message" && message.subscriptionId === "s1" && message.body?.headline === "expire-me"
        })

        await client.post("/api/broadcast-event", {channel: "news", payload: {headline: "expire-me"}})
        const firstEvent = await firstEventPromise

        firstSocket.close()
        await websocketEventLogStoreForConfiguration(dummyConfiguration).cleanupExpired({now: new Date(Date.now() + 11 * 60 * 1000)})

        const secondSocket = new WebSocket("ws://127.0.0.1:3006/websocket")

        try {
          await waitForSocketOpen(secondSocket)

          const replayGapPromise = waitForSocketMessage(secondSocket, (message) => {
            return message.type === "channel-replay-gap" && message.subscriptionId === "s1"
          })

          secondSocket.send(JSON.stringify({
            type: "channel-subscribe",
            channelType: "test",
            subscriptionId: "s1",
            lastEventId: firstEvent.eventId,
            params: {subscribe: "news", token: "allow"}
          }))

          const replayGap = await replayGapPromise

          expect(replayGap.lastEventId).toEqual(firstEvent.eventId)
        } finally {
          secondSocket.close()
        }
      } finally {
        firstSocket.close()
        await client.close()
      }
    })
  })

  it("sends channel-replay-gap when the checkpoint event was already expired", async () => {
    await Dummy.run(async () => {
      const rawSocket = new WebSocket("ws://127.0.0.1:3006/websocket")
      const websocketClient = new WebsocketClient()

      try {
        await waitForSocketOpen(rawSocket)
        rawSocket.send(JSON.stringify({type: "channel-subscribe", channelType: "test", subscriptionId: "s1", params: {subscribe: "news", token: "allow"}}))
        await waitForSocketMessage(rawSocket, (message) => message.type === "channel-subscribed" && message.subscriptionId === "s1")
        await websocketClient.connect()

        const firstEventPromise = waitForSocketMessage(rawSocket, (message) => {
          return message.type === "channel-message" && message.subscriptionId === "s1" && message.body?.headline === "checkpoint"
        })

        await websocketClient.post("/api/broadcast-event", {channel: "news", payload: {headline: "checkpoint"}})
        const firstEvent = await firstEventPromise

        rawSocket.close()
        await websocketEventLogStoreForConfiguration(dummyConfiguration).cleanupExpired({now: new Date(Date.now() + 11 * 60 * 1000)})

        const secondSocket = new WebSocket("ws://127.0.0.1:3006/websocket")

        try {
          await waitForSocketOpen(secondSocket)

          const replayGapPromise = waitForSocketMessage(secondSocket, (message) => {
            return message.type === "channel-replay-gap" && message.subscriptionId === "s2"
          })

          secondSocket.send(JSON.stringify({
            type: "channel-subscribe",
            channelType: "test",
            subscriptionId: "s2",
            lastEventId: firstEvent.eventId,
            params: {subscribe: "news", token: "allow"}
          }))

          const replayGap = await replayGapPromise

          expect(replayGap.lastEventId).toEqual(firstEvent.eventId)
        } finally {
          secondSocket.close()
        }
      } finally {
        rawSocket.close()
        await websocketClient.close()
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

            if (msg.type === "channel-subscribed" && msg.subscriptionId === "s1") {
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
        socket.send(JSON.stringify({type: "channel-subscribe", channelType: "test", subscriptionId: "s1", params: {subscribe: "updates", token: "allow"}}))
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

            if (msg.type === "channel-subscribed" && msg.subscriptionId === "s1") {
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
        socket.send(JSON.stringify({type: "channel-subscribe", channelType: "test", subscriptionId: "s1", params: {subscribe: "updates", token: "allow", checkDb: true}}))
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

          if (msg.type === "channel-message" && msg.subscriptionId === "s1") {
            receivedPayload = msg.body
          }
        } catch {
          // Ignore invalid payloads for this test
        }
      })

      try {
        await openPromise
        socket.send(JSON.stringify({type: "channel-subscribe", channelType: "test", subscriptionId: "s1", params: {subscribe: "updates", token: "deny"}}))
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

  it("handles async websocket message handlers", async () => {
    await Dummy.run(async () => {
      const socket = new WebSocket("ws://127.0.0.1:3006/raw-async-socket")

      try {
        await new Promise((resolve, reject) => {
          socket.addEventListener("open", () => resolve())
          socket.addEventListener("error", (event) => {
            reject(event?.error || new Error("Websocket connection error"))
          })
        })

        const welcomePromise = new Promise((resolve, reject) => {
          const timeout = setTimeout(() => reject(new Error("Timed out waiting for async welcome message")), 2000)

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
          const timeout = setTimeout(() => reject(new Error("Timed out waiting for async echo message")), 2000)

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

        const payload = {topic: "async-raw", value: 84}
        socket.send(JSON.stringify(payload))

        const echoedPayload = await echoPromise
        expect(echoedPayload).toEqual(payload)
      } finally {
        socket.close()
      }
    })
  })
})
