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

  it("waitForReady resolves the initial subscribe and reports ready state", async () => {
    await Dummy.run(async () => {
      const client = new WebsocketClient()

      try {
        await client.connect()

        const subscription = client.subscribeChannel("Counter", {
          params: {allow: true, topic: "wait-for-ready"}
        })

        expect(subscription.isReady()).toBe(false)
        await subscription.waitForReady({timeoutMs: 3000})
        expect(subscription.isReady()).toBe(true)
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

  it("waitForReady waits for the next ready cycle after disconnect", async () => {
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
        const subscription = client.subscribeChannel("Counter", {
          params: {allow: true, topic: "ready-cycle-resume"}
        })

        await client.connect()
        await subscription.waitForReady({timeoutMs: 3000})
        expect(subscription.isReady()).toBe(true)

        isOnline = false
        for (const listener of listeners) listener(false)

        await waitFor(() => subscription.isReady() === false, 3000)

        const waitForResume = subscription.waitForReady({timeoutMs: 5000})
        await wait(100)

        isOnline = true
        for (const listener of listeners) listener(true)

        await waitForResume
        expect(subscription.isReady()).toBe(true)
      } finally {
        await client.disconnectAndStopReconnect()
      }
    })
  })

  it("does not mark queued subscriptions ready on session resume before channel acknowledgement", async () => {
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
        const existingSubscription = client.subscribeChannel("Counter", {
          params: {allow: true, topic: "existing-before-resume"}
        })

        await client.connect()
        await existingSubscription.waitForReady({timeoutMs: 3000})

        isOnline = false
        for (const listener of listeners) listener(false)

        await waitFor(() => existingSubscription.isReady() === false, 3000)

        const queuedSubscription = client.subscribeChannel("Counter", {
          params: {allow: true, topic: "queued-during-disconnect"}
        })

        expect(queuedSubscription.isReady()).toBe(false)

        isOnline = true
        for (const listener of listeners) listener(true)

        await waitFor(() => existingSubscription.isReady() === true, 5000)
        expect(queuedSubscription.isReady()).toBe(false)

        await queuedSubscription.waitForReady({timeoutMs: 5000})
        expect(queuedSubscription.isReady()).toBe(true)
      } finally {
        await client.disconnectAndStopReconnect()
      }
    })
  })

  it("retries a subscribe after a transient send failure on reconnect", async () => {
    await Dummy.run(async () => {
      const client = new WebsocketClient({autoReconnect: true, reconnectDelays: [50]})

      try {
        await client.connect()

        const subscription = client.subscribeChannel("Counter", {
          params: {allow: true, topic: "send-failure-recovery"}
        })

        await subscription.waitForReady({timeoutMs: 3000})
        expect(subscription.isReady()).toBe(true)

        // Simulate the closed-socket race: `isOpen()` returns true at
        // the guard, then the socket closes before `send()` lands and
        // `_sendMessage` throws. Prior to the fix, `_markSubscribeSent()`
        // ran before `_sendMessage` so a throw would leave
        // `_subscribeSent = true` and the reconnect path's
        // `_sendPendingChannelSubscriptions()` would skip it forever.
        const queuedSubscription = client.subscribeChannel("Counter", {
          params: {allow: true, topic: "after-send-throw"}
        })

        queuedSubscription._subscribed = false
        queuedSubscription._subscribeSent = false

        const originalSend = client._sendMessage.bind(client)
        const originalIsOpen = client.isOpen.bind(client)
        let socketDroppedDuringSend = false

        client.isOpen = () => {
          if (socketDroppedDuringSend) return false
          return originalIsOpen()
        }
        client._sendMessage = () => {
          socketDroppedDuringSend = true
          throw new Error("Websocket is not open")
        }

        expect(() => client._sendChannelSubscribe(queuedSubscription)).toThrow()
        expect(queuedSubscription._subscribeSent).toBe(false)
        expect(queuedSubscription.isClosed()).toBe(false)

        client._sendMessage = originalSend
        client.isOpen = originalIsOpen
        client._sendPendingChannelSubscriptions()
        await queuedSubscription.waitForReady({timeoutMs: 3000})
        expect(queuedSubscription.isReady()).toBe(true)
      } finally {
        await client.disconnectAndStopReconnect()
      }
    })
  })

  it("closes a subscription when the send fails with a non-recoverable error", async () => {
    await Dummy.run(async () => {
      const client = new WebsocketClient({autoReconnect: false})

      try {
        await client.connect()

        const healthySubscription = client.subscribeChannel("Counter", {
          params: {allow: true, topic: "healthy"}
        })

        await healthySubscription.waitForReady({timeoutMs: 3000})

        // Simulate a permanent send failure on an open socket (e.g.
        // JSON.stringify on a BigInt/cyclic param). The subscription
        // must be closed and removed from the registry so it can't
        // keep throwing on every `_sendPendingChannelSubscriptions()`
        // loop and block unrelated subscriptions from resubscribing.
        const poisoned = client.subscribeChannel("Counter", {
          params: {allow: true, topic: "poisoned"}
        })

        poisoned._subscribed = false
        poisoned._subscribeSent = false

        const originalSend = client._sendMessage.bind(client)
        let closeReason = null

        poisoned._onClose = (reason) => { closeReason = reason }
        client._sendMessage = () => {
          throw new TypeError("Do not know how to serialize a BigInt")
        }

        client._sendChannelSubscribe(poisoned)

        expect(poisoned.isClosed()).toBe(true)
        expect(closeReason).toContain("send_failed")
        expect(closeReason).toContain("BigInt")
        expect(client._channelSubscriptions.has(poisoned.subscriptionId)).toBe(false)

        // Verify the poisoned entry cannot re-enter the loop and
        // other subscriptions continue to work normally.
        client._sendMessage = originalSend
        expect(() => client._sendPendingChannelSubscriptions()).not.toThrow()
        expect(healthySubscription.isReady()).toBe(true)
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
