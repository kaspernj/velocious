// @ts-check

import timeout from "awaitery/build/timeout.js"
import wait from "awaitery/build/wait.js"

import BeaconClient from "../../src/beacon/client.js"
import BeaconServer from "../../src/beacon/server.js"
import Configuration from "../../src/configuration.js"
import EnvironmentHandlerNode from "../../src/environment-handlers/node.js"
import {describe, expect, it} from "../../src/testing/test.js"

/** @returns {import("../../src/configuration.js").default} */
function buildConfiguration() {
  return new Configuration({
    beacon: {host: "127.0.0.1", port: 0},
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

describe("BeaconClient", {databaseCleaning: {transaction: false, truncate: false}}, () => {
  it("returns false from publish before the connection is established", async () => {
    const beacon = new BeaconServer({configuration: buildConfiguration(), host: "127.0.0.1", port: 0})
    await beacon.start()

    const client = new BeaconClient({host: "127.0.0.1", port: beacon.getPort()})

    expect(client.isConnected()).toBe(false)
    expect(client.publish({channel: "c", broadcastParams: {}, body: {}})).toBe(false)

    await client.connect()

    expect(client.isConnected()).toBe(true)
    expect(client.publish({channel: "c", broadcastParams: {}, body: {}})).toBe(true)

    await client.close()
    await beacon.stop()
  })

  it("reconnects after the daemon restarts and resumes delivering broadcasts", async () => {
    const configuration = buildConfiguration()
    const beacon = new BeaconServer({configuration, host: "127.0.0.1", port: 0})
    await beacon.start()
    const port = beacon.getPort()

    const subscriber = new BeaconClient({
      host: "127.0.0.1",
      port,
      peerType: "subscriber",
      reconnectDelayMs: 50,
      maxReconnectDelayMs: 100
    })
    const publisher = new BeaconClient({host: "127.0.0.1", port, peerType: "publisher"})

    /** @type {Array<import("../../src/beacon/types.js").BeaconBroadcastMessage>} */
    const received = []

    subscriber.onBroadcast((message) => received.push(message))

    await subscriber.connect()
    await publisher.connect()

    publisher.publish({channel: "c", broadcastParams: {}, body: {n: 1}})

    await timeout({timeout: 1000}, async () => {
      while (received.length < 1) await wait(0.01)
    })

    await publisher.close()
    await beacon.stop()

    await timeout({timeout: 1000}, async () => {
      while (subscriber.isConnected()) await wait(0.01)
    })

    const reborn = new BeaconServer({configuration, host: "127.0.0.1", port})
    await reborn.start()

    await timeout({timeout: 2000}, async () => {
      while (!subscriber.isConnected()) await wait(0.05)
    })

    const newPublisher = new BeaconClient({host: "127.0.0.1", port, peerType: "publisher2"})
    await newPublisher.connect()
    newPublisher.publish({channel: "c", broadcastParams: {}, body: {n: 2}})

    await timeout({timeout: 1000}, async () => {
      while (received.length < 2) await wait(0.01)
    })

    expect(received[0].body).toEqual({n: 1})
    expect(received[1].body).toEqual({n: 2})

    await newPublisher.close()
    await subscriber.close()
    await reborn.stop()
  })
})
