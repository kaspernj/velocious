// @ts-check

import {describe, expect, it} from "../../src/testing/test.js"
import Dummy from "../dummy/index.js"
import WebsocketClient from "../../src/http-client/websocket-client.js"
import dummyConfiguration from "../dummy/src/config/configuration.js"

/**
 * @param {number} ms
 * @returns {Promise<void>}
 */
function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * @param {() => boolean} predicate
 * @param {number} [timeoutMs]
 * @returns {Promise<void>}
 */
async function waitFor(predicate, timeoutMs = 2000) {
  const deadline = Date.now() + timeoutMs

  while (Date.now() < deadline) {
    if (predicate()) return
    await wait(20)
  }

  throw new Error(`waitFor timeout after ${timeoutMs}ms`)
}

describe("WebsocketChannelV2 ()", () => {
  it("queues channel subscriptions until the network monitor reports online", async () => {
    await Dummy.run(async () => {
      let isOnline = false
      /** @type {Set<(isOnline: boolean) => void>} */
      const listeners = new Set()
      const client = new WebsocketClient({
        autoReconnect: true,
        networkMonitor: {
          getIsOnline: () => isOnline,
          subscribe: (callback) => {
            listeners.add(callback)
            return () => listeners.delete(callback)
          }
        },
        reconnectDelays: [50]
      })

      try {
        /** @type {any[]} */
        const received = []
        const subscription = client.subscribeChannel("Counter", {
          params: {allow: true, topic: "queued"},
          onMessage: (body) => received.push(body)
        })
        await client.connect({waitForOnline: true})
        await wait(100)

        expect(client.isOpen()).toBe(false)

        isOnline = true
        for (const listener of listeners) listener(true)

        await subscription.ready
        await waitFor(() => received.length >= 1)
        expect(subscription.isSubscribed()).toBe(true)
        expect(received[0]).toEqual({welcome: "queued"})
      } finally {
        await client.disconnectAndStopReconnect()
      }
    })
  })

  it("preserves lastEventId for queued channel subscriptions", async () => {
    await Dummy.run(async () => {
      let isOnline = false
      /** @type {Set<(isOnline: boolean) => void>} */
      const listeners = new Set()
      const client = new WebsocketClient({
        networkMonitor: {
          getIsOnline: () => isOnline,
          subscribe: (callback) => {
            listeners.add(callback)
            return () => listeners.delete(callback)
          }
        },
        reconnectDelays: [50]
      })

      try {
        /** @type {Record<string, any>[]} */
        const sentMessages = []
        const originalSendMessage = client._sendMessage.bind(client)
        client._sendMessage = (payload) => {
          sentMessages.push(payload)
          return originalSendMessage(payload)
        }

        const subscription = client.subscribeChannel("Counter", {
          lastEventId: "event-42",
          params: {allow: true, topic: "queued-checkpoint"}
        })

        await client.connect({waitForOnline: true})
        expect(client.isOpen()).toBe(false)

        isOnline = true
        for (const listener of listeners) listener(true)

        await subscription.ready

        const subscribeMessage = sentMessages.find((message) => message.type === "channel-subscribe" && message.subscriptionId === subscription.subscriptionId)
        expect(subscribeMessage?.lastEventId).toEqual("event-42")
      } finally {
        await client.disconnectAndStopReconnect()
      }
    })
  })

  it("rejects subscribe when canSubscribe returns false (default deny)", async () => {
    await Dummy.run(async () => {
      const client = new WebsocketClient()

      try {
        await client.connect()

        /** @type {string[]} */
        const closeReasons = []
        const subscription = client.subscribeChannel("Counter", {
          params: {topic: "a"}, // missing allow: true → default deny path
          onClose: (reason) => closeReasons.push(reason)
        })

        let rejected = false

        await subscription.ready.catch(() => { rejected = true })

        expect(rejected).toBe(true)
        expect(closeReasons.length).toBe(1)
        expect(closeReasons[0].startsWith("error:")).toBe(true)
      } finally {
        await client.close()
      }
    })
  })

  it("accepts subscribe when canSubscribe returns true and delivers welcome on subscribed()", async () => {
    await Dummy.run(async () => {
      const client = new WebsocketClient()

      try {
        await client.connect()

        /** @type {any[]} */
        const received = []
        const subscription = client.subscribeChannel("Counter", {
          params: {allow: true, topic: "alpha"},
          onMessage: (body) => received.push(body)
        })

        await subscription.ready
        expect(subscription.isSubscribed()).toBe(true)

        await waitFor(() => received.length >= 1)
        expect(received[0]).toEqual({welcome: "alpha"})
      } finally {
        await client.close()
      }
    })
  })

  it("routes broadcasts to matching subscribers only", async () => {
    await Dummy.run(async () => {
      const clientA = new WebsocketClient()
      const clientB = new WebsocketClient()

      try {
        await clientA.connect()
        await clientB.connect()

        /** @type {any[]} */
        const receivedA = []
        /** @type {any[]} */
        const receivedB = []

        const subA = clientA.subscribeChannel("Counter", {
          params: {allow: true, topic: "alpha"},
          onMessage: (body) => receivedA.push(body)
        })
        const subB = clientB.subscribeChannel("Counter", {
          params: {allow: true, topic: "beta"},
          onMessage: (body) => receivedB.push(body)
        })

        await Promise.all([subA.ready, subB.ready])
        // Drain the welcome messages before the real assertions.
        await waitFor(() => receivedA.length >= 1 && receivedB.length >= 1)
        receivedA.length = 0
        receivedB.length = 0

        // Publish directly against the configuration — in real apps
        // this would be the backend's event-emitter or a resource
        // save hook.
        dummyConfiguration.broadcastToChannel("Counter", {topic: "alpha"}, {count: 1})
        dummyConfiguration.broadcastToChannel("Counter", {topic: "beta"}, {count: 2})
        dummyConfiguration.broadcastToChannel("Counter", {topic: "alpha"}, {count: 3})

        await waitFor(() => receivedA.length >= 2 && receivedB.length >= 1)

        expect(receivedA.map((m) => m.count)).toEqual([1, 3])
        expect(receivedB.map((m) => m.count)).toEqual([2])
      } finally {
        await clientA.close()
        await clientB.close()
      }
    })
  })

  it("stops delivering after the client unsubscribes", async () => {
    await Dummy.run(async () => {
      const client = new WebsocketClient()

      try {
        await client.connect()

        /** @type {any[]} */
        const received = []
        /** @type {string[]} */
        const closeReasons = []
        const subscription = client.subscribeChannel("Counter", {
          params: {allow: true, topic: "gamma"},
          onMessage: (body) => received.push(body),
          onClose: (reason) => closeReasons.push(reason)
        })

        await subscription.ready
        await waitFor(() => received.length >= 1)  // welcome
        received.length = 0

        dummyConfiguration.broadcastToChannel("Counter", {topic: "gamma"}, {n: 1})
        await waitFor(() => received.length >= 1)

        subscription.close()
        expect(subscription.isClosed()).toBe(true)
        expect(closeReasons).toEqual(["client_unsubscribe"])

        // Broadcasts after close should be ignored.
        dummyConfiguration.broadcastToChannel("Counter", {topic: "gamma"}, {n: 2})
        await wait(100)
        expect(received.length).toBe(1)
      } finally {
        await client.close()
      }
    })
  })

  it("fires onClose(session_destroyed) on all live subscriptions when the socket drops", async () => {
    await Dummy.run(async () => {
      const client = new WebsocketClient()

      await client.connect()

      /** @type {string[]} */
      const closeReasons = []
      const subscription = client.subscribeChannel("Counter", {
        params: {allow: true, topic: "delta"},
        onClose: (reason) => closeReasons.push(reason)
      })

      await subscription.ready
      await client.close()

      await waitFor(() => subscription.isClosed())
      expect(closeReasons).toEqual(["session_destroyed"])
    })
  })

  it("waits for the network monitor to report online before resuming a dropped subscription", async () => {
    await Dummy.run(async () => {
      let isOnline = true
      /** @type {Set<(isOnline: boolean) => void>} */
      const listeners = new Set()
      const client = new WebsocketClient({
        autoReconnect: true,
        networkMonitor: {
          getIsOnline: () => isOnline,
          subscribe: (callback) => {
            listeners.add(callback)
            return () => listeners.delete(callback)
          }
        },
        reconnectDelays: [50]
      })

      try {
        /** @type {string[]} */
        const events = []
        const subscription = client.subscribeChannel("Counter", {
          params: {allow: true, topic: "resume-on-network"},
          onDisconnect: () => events.push("disconnect"),
          onResume: () => events.push("resume")
        })

        await client.connect()
        await subscription.ready

        isOnline = false
        for (const listener of listeners) listener(false)

        await waitFor(() => events.includes("disconnect"), 3000)
        await wait(150)
        expect(events.includes("resume")).toBe(false)

        isOnline = true
        for (const listener of listeners) listener(true)

        await waitFor(() => events.includes("resume"), 5000)
      } finally {
        await client.disconnectAndStopReconnect()
      }
    })
  })

  it("returns connection-error for unknown channel type", async () => {
    await Dummy.run(async () => {
      const client = new WebsocketClient()

      try {
        await client.connect()

        /** @type {string[]} */
        const closeReasons = []
        const subscription = client.subscribeChannel("Nonexistent", {
          params: {allow: true},
          onClose: (reason) => closeReasons.push(reason)
        })

        let rejected = false

        await subscription.ready.catch(() => { rejected = true })

        expect(rejected).toBe(true)
        expect(closeReasons.length).toBe(1)
        expect(closeReasons[0]).toContain("Unknown channel type")
      } finally {
        await client.close()
      }
    })
  })
})
