// @ts-check

import timeout from "awaitery/build/timeout.js"
import wait from "awaitery/build/wait.js"

import BeaconServer from "../../src/beacon/server.js"
import Configuration from "../../src/configuration.js"
import EnvironmentHandlerNode from "../../src/environment-handlers/node.js"
import {describe, expect, it} from "../../src/testing/test.js"

/**
 * Minimal stub of the configuration's per-process subscription
 * registry entry. We register it via the same private method the
 * websocket session uses (`_registerWebsocketChannelSubscription`) so
 * the integration spec drives the production delivery path end to end.
 *
 * @param {{matches?: (broadcastParams: Record<string, any>) => boolean}} [args] - Options.
 * @returns {{matches: (broadcastParams: Record<string, any>) => boolean, sendMessage: (body: any) => void, isClosed: () => boolean, received: Array<any>, subscriptionId: string}}
 */
function makeSubscription({matches} = {}) {
  /** @type {Array<any>} */
  const received = []

  return {
    subscriptionId: `s-${Math.random().toString(36).slice(2)}`,
    received,
    matches: matches || (() => true),
    deliverBroadcast: (body) => received.push(body),
    sendMessage: (body) => received.push(body),
    isClosed: () => false
  }
}

/**
 * @param {object} [args] - Options.
 * @param {import("../../src/configuration-types.js").BeaconConfiguration} [args.beacon] - Beacon configuration.
 * @returns {import("../../src/configuration.js").default}
 */
function buildConfiguration({beacon} = {}) {
  return new Configuration({
    beacon,
    database: {test: {default: {driver: class {}, poolType: class {static clearGlobalConnections() {}}, type: "fake"}}},
    directory: process.cwd(),
    environment: "test",
    environmentHandler: new EnvironmentHandlerNode(),
    initializeModels: async () => {},
    locale: "en",
    localeFallbacks: {en: ["en"]},
    locales: ["en"]
  })
}

describe("Beacon configuration integration", {databaseCleaning: {transaction: false, truncate: false}}, () => {
  it("getBeaconConfig falls back to env vars and reports enabled when host or port is set", async () => {
    const configuration = buildConfiguration()

    const originalHost = process.env.VELOCIOUS_BEACON_HOST
    const originalPort = process.env.VELOCIOUS_BEACON_PORT

    try {
      delete process.env.VELOCIOUS_BEACON_HOST
      delete process.env.VELOCIOUS_BEACON_PORT
      expect(configuration.getBeaconConfig().enabled).toBe(false)

      process.env.VELOCIOUS_BEACON_HOST = "10.0.0.5"
      process.env.VELOCIOUS_BEACON_PORT = "9999"
      const config = configuration.getBeaconConfig()

      expect(config.enabled).toBe(true)
      expect(config.host).toBe("10.0.0.5")
      expect(config.port).toBe(9999)
    } finally {
      if (originalHost === undefined) delete process.env.VELOCIOUS_BEACON_HOST
      else process.env.VELOCIOUS_BEACON_HOST = originalHost

      if (originalPort === undefined) delete process.env.VELOCIOUS_BEACON_PORT
      else process.env.VELOCIOUS_BEACON_PORT = originalPort
    }
  })

  it("respects an explicit `enabled: false` even when env vars set host/port", async () => {
    const originalHost = process.env.VELOCIOUS_BEACON_HOST

    try {
      process.env.VELOCIOUS_BEACON_HOST = "10.0.0.5"
      const configuration = buildConfiguration({beacon: {enabled: false}})

      expect(configuration.getBeaconConfig().enabled).toBe(false)
    } finally {
      if (originalHost === undefined) delete process.env.VELOCIOUS_BEACON_HOST
      else process.env.VELOCIOUS_BEACON_HOST = originalHost
    }
  })

  it("connectBeacon is a no-op when beacon is not enabled", async () => {
    const configuration = buildConfiguration()
    const client = await configuration.connectBeacon()

    expect(client).toBe(undefined)
    expect(configuration.getBeaconClient()).toBe(undefined)
  })

  it("broadcastToChannel routes through Beacon and delivers to local subscribers in every connected configuration", async () => {
    const beacon = new BeaconServer({configuration: buildConfiguration({beacon: {host: "127.0.0.1", port: 0}}), host: "127.0.0.1", port: 0})
    await beacon.start()

    const port = beacon.getPort()

    const publisherConfig = buildConfiguration({beacon: {host: "127.0.0.1", port}})
    const subscriberConfig = buildConfiguration({beacon: {host: "127.0.0.1", port}})

    await publisherConfig.connectBeacon({peerType: "publisher"})
    await subscriberConfig.connectBeacon({peerType: "subscriber"})

    await timeout({timeout: 1000}, async () => {
      while (beacon.getPeerCount() < 2) await wait(0.01)
    })

    const publisherSub = makeSubscription()
    const subscriberSub = makeSubscription()

    publisherConfig._registerWebsocketChannelSubscription("frontend-models", /** @type {any} */ (publisherSub))
    subscriberConfig._registerWebsocketChannelSubscription("frontend-models", /** @type {any} */ (subscriberSub))

    publisherConfig.broadcastToChannel("frontend-models", {model: "BuildLog"}, {action: "create", id: "abc"})

    await timeout({timeout: 1000}, async () => {
      while (publisherSub.received.length === 0 || subscriberSub.received.length === 0) {
        await wait(0.01)
      }
    })

    expect(publisherSub.received[0]).toEqual({action: "create", id: "abc"})
    expect(subscriberSub.received[0]).toEqual({action: "create", id: "abc"})

    await publisherConfig.disconnectBeacon()
    await subscriberConfig.disconnectBeacon()
    await beacon.stop()
  })

  it("hands Beacon-sourced broadcasts to websocketEvents.broadcastV2 when an HTTP server is hosting the configuration", async () => {
    const beacon = new BeaconServer({configuration: buildConfiguration({beacon: {host: "127.0.0.1", port: 0}}), host: "127.0.0.1", port: 0})
    await beacon.start()

    const port = beacon.getPort()

    const publisherConfig = buildConfiguration({beacon: {host: "127.0.0.1", port}})
    const subscriberConfig = buildConfiguration({beacon: {host: "127.0.0.1", port}})

    /** @type {Array<{channel: string, broadcastParams: Record<string, any>, body: any, configuration: Configuration}>} */
    const captured = []

    /** @type {any} */
    const fakeWebsocketEvents = {
      broadcastV2: (args) => captured.push(args)
    }

    subscriberConfig.setWebsocketEvents(fakeWebsocketEvents)

    await publisherConfig.connectBeacon({peerType: "publisher"})
    await subscriberConfig.connectBeacon({peerType: "subscriber"})

    await timeout({timeout: 1000}, async () => {
      while (beacon.getPeerCount() < 2) await wait(0.01)
    })

    publisherConfig.broadcastToChannel("frontend-models", {model: "Build"}, {action: "update", id: "42"})

    await timeout({timeout: 1000}, async () => {
      while (captured.length === 0) await wait(0.01)
    })

    expect(captured[0].channel).toBe("frontend-models")
    expect(captured[0].broadcastParams).toEqual({model: "Build"})
    expect(captured[0].body).toEqual({action: "update", id: "42"})
    expect(captured[0].configuration).toBe(subscriberConfig)

    await publisherConfig.disconnectBeacon()
    await subscriberConfig.disconnectBeacon()
    await beacon.stop()
  })

  it("broadcastToChannel falls back to local-only delivery when no Beacon client is connected", async () => {
    const configuration = buildConfiguration()
    const subscription = makeSubscription()

    configuration._registerWebsocketChannelSubscription("frontend-models", /** @type {any} */ (subscription))

    configuration.broadcastToChannel("frontend-models", {}, {hello: "world"})

    await wait(0.01)

    expect(subscription.received).toEqual([{hello: "world"}])
  })

  it("continues broadcasting when one subscriber throws synchronously during delivery", async () => {
    const configuration = buildConfiguration()
    const throwingSubscription = {
      ...makeSubscription(),
      deliverBroadcast: () => {
        throw new Error("sync delivery failed")
      }
    }
    const receivingSubscription = makeSubscription()

    configuration._registerWebsocketChannelSubscription("frontend-models", /** @type {import("../../src/http-server/websocket-channel.js").default} */ (throwingSubscription))
    configuration._registerWebsocketChannelSubscription("frontend-models", /** @type {import("../../src/http-server/websocket-channel.js").default} */ (receivingSubscription))

    configuration.broadcastToChannel("frontend-models", {}, {hello: "after throw"})

    await wait(0.01)

    expect(receivingSubscription.received).toEqual([{hello: "after throw"}])
  })

  it("does not settle the pending broadcast barrier until snapshotted local subscriber deliveries settle, while leaving later work unawaited", async () => {
    const configuration = buildConfiguration()
    /** @type {Array<{body: Record<string, any>, release: (error?: Error) => void}>} */
    const gatedDeliveries = []
    const makeGatedSubscription = () => {
      const inner = makeSubscription()

      return {
        ...inner,
        deliverBroadcast: (body) => new Promise((resolve, reject) => {
          gatedDeliveries.push({
            body,
            release: (error) => {
              if (error) {
                reject(error)

                return
              }

              inner.received.push(body)
              resolve()
            }
          })
        })
      }
    }
    const slowInFlight = makeGatedSubscription()
    const slowAfterSnapshot = makeGatedSubscription()
    const fastSubscription = makeSubscription()

    configuration._registerWebsocketChannelSubscription("pipeline", /** @type {import("../../src/http-server/websocket-channel.js").default} */ (slowInFlight))
    configuration._registerWebsocketChannelSubscription("pipeline", /** @type {import("../../src/http-server/websocket-channel.js").default} */ (fastSubscription))

    configuration.broadcastToChannel("pipeline", {}, {first: true})

    let barrierSettled = false
    const barrier = configuration.awaitPendingBroadcasts().then(() => {
      barrierSettled = true
    })

    // Let the async delivery chain start and an (incorrect) barrier settle if it
    // were not tracking in-flight local deliveries. No real time passes.
    for (let i = 0; i < 10; i++) await Promise.resolve()

    expect(gatedDeliveries.length).toBe(1)
    expect(gatedDeliveries[0].body).toEqual({first: true})
    expect(fastSubscription.received).toEqual([{first: true}])
    expect(barrierSettled).toBe(false)

    // Work enqueued after the barrier snapshotted must not be awaited by that barrier.
    configuration._registerWebsocketChannelSubscription("pipeline", /** @type {import("../../src/http-server/websocket-channel.js").default} */ (slowAfterSnapshot))
    configuration.broadcastToChannel("pipeline", {}, {after: true})

    for (let i = 0; i < 10; i++) await Promise.resolve()

    // The second broadcast also reaches the slow in-flight subscriber again, so
    // three deliveries gate: the snapshot's slow one and two enqueued after it.
    expect(gatedDeliveries.length).toBe(3)
    expect(slowAfterSnapshot.received.length).toBe(0)

    gatedDeliveries[0].release()

    await barrier
    expect(barrierSettled).toBe(true)
    expect(slowAfterSnapshot.received.length).toBe(0)

    let secondBarrierSettled = false
    const secondBarrier = configuration.awaitPendingBroadcasts().then(() => {
      secondBarrierSettled = true
    })

    gatedDeliveries[1].release()
    gatedDeliveries[2].release()

    await secondBarrier
    expect(secondBarrierSettled).toBe(true)
    expect(slowInFlight.received).toEqual([{first: true}, {after: true}])
    expect(slowAfterSnapshot.received).toEqual([{after: true}])
  })

  it("keeps a rejecting local subscriber delivery isolated and logged while still draining the barrier", async () => {
    const configuration = buildConfiguration()
    const failingSubscription = {
      ...makeSubscription(),
      deliverBroadcast: () => Promise.reject(new Error("delivery exploded"))
    }
    const okSubscription = makeSubscription()

    configuration._registerWebsocketChannelSubscription("pipeline", /** @type {import("../../src/http-server/websocket-channel.js").default} */ (failingSubscription))
    configuration._registerWebsocketChannelSubscription("pipeline", /** @type {import("../../src/http-server/websocket-channel.js").default} */ (okSubscription))

    configuration.broadcastToChannel("pipeline", {}, {message: "isolated"})

    await configuration.awaitPendingBroadcasts()

    expect(okSubscription.received).toEqual([{message: "isolated"}])
    expect(failingSubscription.received).toEqual([])
  })
})
