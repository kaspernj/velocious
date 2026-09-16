// @ts-check

import {describe, expect, it} from "../../src/testing/test.js"
import WebsocketClient from "../../src/http-client/websocket-client.js"
import {websocketEventLogStoreForConfiguration} from "../../src/http-server/websocket-event-log-store.js"
import Dummy from "../dummy/index.js"
import dummyConfiguration from "../dummy/src/config/configuration.js"

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

const closeSocket = async (socket) => {
  if (socket.readyState === WebSocket.CLOSED) return

  const closed = new Promise((resolve) => {
    socket.addEventListener("close", () => resolve(), {once: true})
  })

  socket.close(1000)
  await closed
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

/**
 * Collects every socket message until `predicate` matches, then resolves
 * with the full collection.
 * @param {WebSocket} socket - Socket to watch.
 * @param {(message: Record<string, ReturnType<typeof JSON.parse>>) => boolean} predicate - Stop condition.
 * @returns {Promise<Array<Record<string, ReturnType<typeof JSON.parse>>>>} - Messages seen until the stop condition.
 */
const collectMessagesUntil = async (socket, predicate) => {
  return await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("Timed out waiting for websocket message")), 2000)
    /** @type {Array<Record<string, ReturnType<typeof JSON.parse>>>} */
    const messages = []
    const listener = (event) => {
      const raw = getMessageText(event)

      if (!raw) return

      try {
        const message = JSON.parse(raw)

        messages.push(message)

        if (!predicate(message)) return

        clearTimeout(timeout)
        socket.removeEventListener("message", listener)
        resolve(messages)
      } catch (error) {
        clearTimeout(timeout)
        socket.removeEventListener("message", listener)
        reject(error)
      }
    }

    socket.addEventListener("message", listener)
  })
}

describe("HttpServer - websocket stream replay", {databaseCleaning: {transaction: false, truncate: true}}, async () => {
  it("replays only the subscriber's own stream after reconnect", async () => {
    const websocketSnapshotBefore = dummyConfiguration._debugWebsocketSnapshot()

    await Dummy.run(async () => {
      const client = new WebsocketClient()
      const newsSocket = new WebSocket("ws://127.0.0.1:3006/websocket")
      const sportsSocket = new WebSocket("ws://127.0.0.1:3006/websocket")

      try {
        await waitForSocketOpen(newsSocket)
        await waitForSocketOpen(sportsSocket)
        await client.connect()

        /** @type {Array<Record<string, ReturnType<typeof JSON.parse>>>} */
        const sportsMessages = []
        const sportsListener = (event) => {
          const raw = getMessageText(event)

          if (!raw) return

          sportsMessages.push(JSON.parse(raw))
        }

        sportsSocket.addEventListener("message", sportsListener)

        const newsSubscribedPromise = waitForSocketMessage(newsSocket, (message) => message.type === "channel-subscribed" && message.subscriptionId === "news-1")

        newsSocket.send(JSON.stringify({type: "channel-subscribe", channelType: "test", subscriptionId: "news-1", params: {subscribe: "news", token: "allow"}}))
        await newsSubscribedPromise

        const sportsSubscribedPromise = waitForSocketMessage(sportsSocket, (message) => message.type === "channel-subscribed" && message.subscriptionId === "sports-1")

        sportsSocket.send(JSON.stringify({type: "channel-subscribe", channelType: "test", subscriptionId: "sports-1", params: {subscribe: "sports", token: "allow"}}))
        await sportsSubscribedPromise

        const firstNewsPromise = waitForSocketMessage(newsSocket, (message) => {
          return message.type === "channel-message" && message.subscriptionId === "news-1" && message.body?.headline === "news-one"
        })

        await client.post("/api/broadcast-event", {channel: "news", payload: {headline: "news-one"}})
        const firstNewsEvent = await firstNewsPromise

        expect(firstNewsEvent.eventId).toBeDefined()

        const firstSportsPromise = waitForSocketMessage(sportsSocket, (message) => {
          return message.type === "channel-message" && message.subscriptionId === "sports-1" && message.body?.headline === "sports-one"
        })

        await client.post("/api/broadcast-event", {channel: "sports", payload: {headline: "sports-one"}})
        await firstSportsPromise

        // The news stream drops while both streams publish new events.
        await closeSocket(newsSocket)
        const sportsTwoPromise = waitForSocketMessage(sportsSocket, (message) => {
          return message.type === "channel-message" && message.subscriptionId === "sports-1" && message.body?.headline === "sports-two"
        })

        await client.post("/api/broadcast-event", {channel: "news", payload: {headline: "news-two"}})
        await client.post("/api/broadcast-event", {channel: "sports", payload: {headline: "sports-two"}})
        await sportsTwoPromise

        const replaySocket = new WebSocket("ws://127.0.0.1:3006/websocket")

        try {
          await waitForSocketOpen(replaySocket)

          const seenMessagesPromise = collectMessagesUntil(replaySocket, (message) => {
            return message.type === "channel-subscribed" && message.subscriptionId === "news-2"
          })

          replaySocket.send(JSON.stringify({
            type: "channel-subscribe",
            channelType: "test",
            subscriptionId: "news-2",
            lastEventId: firstNewsEvent.eventId,
            params: {markDelivery: true, subscribe: "news", token: "allow"}
          }))

          const seenMessages = await seenMessagesPromise
          const replayed = seenMessages.filter((message) => message.type === "channel-message" && message.subscriptionId === "news-2")
          const headlines = replayed.map((message) => message.body?.headline)

          expect(headlines).toContain("news-two")
          expect(headlines).not.toContain("sports-two")
          expect(replayed.every((message) => message.body?.deliveredByChannel === true)).toBe(true)
        } finally {
          await closeSocket(replaySocket)
        }

        expect(sportsMessages.some((message) => message.type === "channel-message" && message.body?.headline === "news-two")).toBe(false)
      } finally {
        await closeSocket(newsSocket)
        await closeSocket(sportsSocket)
        await client.close()
        await websocketEventLogStoreForConfiguration(dummyConfiguration).cleanupExpired({now: new Date(Date.now() + 11 * 60 * 1000)})
      }
    })

    const websocketSnapshotAfter = dummyConfiguration._debugWebsocketSnapshot()

    expect(websocketSnapshotAfter.pausedSessions).toEqual(websocketSnapshotBefore.pausedSessions)
    expect(websocketSnapshotAfter.sessionCount).toEqual(websocketSnapshotBefore.sessionCount)
  })

  it("reports a replay gap when the checkpoint event belongs to a different stream", async () => {
    const websocketSnapshotBefore = dummyConfiguration._debugWebsocketSnapshot()

    await Dummy.run(async () => {
      const client = new WebsocketClient()
      const newsSocket = new WebSocket("ws://127.0.0.1:3006/websocket")
      const sportsSocket = new WebSocket("ws://127.0.0.1:3006/websocket")

      try {
        await waitForSocketOpen(newsSocket)
        await waitForSocketOpen(sportsSocket)
        await client.connect()

        const newsSubscribedPromise = waitForSocketMessage(newsSocket, (message) => message.type === "channel-subscribed" && message.subscriptionId === "news-1")

        newsSocket.send(JSON.stringify({type: "channel-subscribe", channelType: "test", subscriptionId: "news-1", params: {subscribe: "news", token: "allow"}}))
        await newsSubscribedPromise

        const sportsSubscribedPromise = waitForSocketMessage(sportsSocket, (message) => message.type === "channel-subscribed" && message.subscriptionId === "sports-1")

        sportsSocket.send(JSON.stringify({type: "channel-subscribe", channelType: "test", subscriptionId: "sports-1", params: {subscribe: "sports", token: "allow"}}))
        await sportsSubscribedPromise

        const sportsEventPromise = waitForSocketMessage(sportsSocket, (message) => {
          return message.type === "channel-message" && message.subscriptionId === "sports-1" && message.body?.headline === "sports-checkpoint"
        })

        await client.post("/api/broadcast-event", {channel: "sports", payload: {headline: "sports-checkpoint"}})
        const sportsEvent = await sportsEventPromise

        expect(sportsEvent.eventId).toBeDefined()

        await closeSocket(newsSocket)

        const replaySocket = new WebSocket("ws://127.0.0.1:3006/websocket")

        try {
          await waitForSocketOpen(replaySocket)

          const replayGapPromise = waitForSocketMessage(replaySocket, (message) => {
            return message.type === "channel-replay-gap" && message.subscriptionId === "news-2"
          })

          replaySocket.send(JSON.stringify({
            type: "channel-subscribe",
            channelType: "test",
            subscriptionId: "news-2",
            lastEventId: sportsEvent.eventId,
            params: {subscribe: "news", token: "allow"}
          }))

          const replayGap = await replayGapPromise

          expect(replayGap.lastEventId).toEqual(sportsEvent.eventId)
        } finally {
          await closeSocket(replaySocket)
        }
      } finally {
        await closeSocket(newsSocket)
        await closeSocket(sportsSocket)
        await client.close()
        await websocketEventLogStoreForConfiguration(dummyConfiguration).cleanupExpired({now: new Date(Date.now() + 11 * 60 * 1000)})
      }
    })

    const websocketSnapshotAfter = dummyConfiguration._debugWebsocketSnapshot()

    expect(websocketSnapshotAfter.pausedSessions).toEqual(websocketSnapshotBefore.pausedSessions)
    expect(websocketSnapshotAfter.sessionCount).toEqual(websocketSnapshotBefore.sessionCount)
  })
})
