// @ts-check

import timeout from "awaitery/build/timeout.js"
import wait from "awaitery/build/wait.js"

import Configuration from "../../src/configuration.js"
import EnvironmentHandlerNode from "../../src/environment-handlers/node.js"
import {getInProcessPeerCount} from "../../src/beacon/in-process-broker.js"
import InProcessBeaconClient from "../../src/beacon/in-process-client.js"
import {describe, expect, it} from "../../src/testing/test.js"

/**
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
 * @param {import("../../src/configuration-types.js").BeaconConfiguration} [beacon] - Beacon configuration.
 * @returns {import("../../src/configuration.js").default}
 */
function buildConfiguration(beacon) {
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

describe("Beacon in-process mode", {databaseCleaning: {transaction: false, truncate: false}}, () => {
  it("getBeaconConfig rejects mixing inProcess with host or port", async () => {
    const configuration = buildConfiguration({inProcess: true, host: "127.0.0.1"})

    await expect(() => configuration.getBeaconConfig()).toThrow(/mutually exclusive/)
  })

  it("getBeaconConfig reports inProcess true and ignores env-var host when inProcess is set", async () => {
    const originalHost = process.env.VELOCIOUS_BEACON_HOST

    try {
      process.env.VELOCIOUS_BEACON_HOST = "10.0.0.5"

      const configuration = buildConfiguration({inProcess: true})
      const config = configuration.getBeaconConfig()

      expect(config.enabled).toBe(true)
      expect(config.inProcess).toBe(true)
      expect(config.host).toBe("127.0.0.1")
    } finally {
      if (originalHost === undefined) delete process.env.VELOCIOUS_BEACON_HOST
      else process.env.VELOCIOUS_BEACON_HOST = originalHost
    }
  })

  it("delivers broadcasts across two configurations sharing the in-process singleton", async () => {
    const initialPeerCount = getInProcessPeerCount()
    const publisherConfig = buildConfiguration({inProcess: true})
    const subscriberConfig = buildConfiguration({inProcess: true})

    await publisherConfig.connectBeacon({peerType: "publisher"})
    await subscriberConfig.connectBeacon({peerType: "subscriber"})

    expect(getInProcessPeerCount()).toBe(initialPeerCount + 2)

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

    expect(getInProcessPeerCount()).toBe(initialPeerCount)
  })

  it("InProcessBeaconClient.publish returns false before connect()", async () => {
    const initialPeerCount = getInProcessPeerCount()
    const client = new InProcessBeaconClient({peerType: "test"})

    expect(client.isConnected()).toBe(false)
    expect(client.publish({channel: "c", broadcastParams: {}, body: {}})).toBe(false)
    expect(getInProcessPeerCount()).toBe(initialPeerCount)

    await client.connect()
    expect(client.isConnected()).toBe(true)
    expect(client.publish({channel: "c", broadcastParams: {}, body: {}})).toBe(true)

    await client.close()
    expect(getInProcessPeerCount()).toBe(initialPeerCount)
  })

  it("disconnectBeacon removes the peer from the singleton broker", async () => {
    const initialPeerCount = getInProcessPeerCount()
    const configuration = buildConfiguration({inProcess: true})

    await configuration.connectBeacon({peerType: "test"})
    expect(getInProcessPeerCount()).toBe(initialPeerCount + 1)

    await configuration.disconnectBeacon()
    expect(getInProcessPeerCount()).toBe(initialPeerCount)
  })
})
