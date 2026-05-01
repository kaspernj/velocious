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

    /** @type {Array<{channel: string, broadcastParams: Record<string, any>, body: any}>} */
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

    await publisherConfig.disconnectBeacon()
    await subscriberConfig.disconnectBeacon()
    await beacon.stop()
  })

  it("broadcastToChannel falls back to local-only delivery when no Beacon client is connected", async () => {
    const configuration = buildConfiguration()
    const subscription = makeSubscription()

    configuration._registerWebsocketChannelSubscription("frontend-models", /** @type {any} */ (subscription))

    configuration.broadcastToChannel("frontend-models", {}, {hello: "world"})

    expect(subscription.received).toEqual([{hello: "world"}])
  })
})
