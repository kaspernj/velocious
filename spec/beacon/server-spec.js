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

describe("Beacon server", {databaseCleaning: {transaction: false, truncate: false}}, () => {
  it("fans broadcast messages out to every connected peer", async () => {
    const beacon = new BeaconServer({configuration: buildConfiguration(), host: "127.0.0.1", port: 0})
    await beacon.start()

    const publisher = new BeaconClient({host: "127.0.0.1", port: beacon.getPort(), peerType: "publisher"})
    const subscriberA = new BeaconClient({host: "127.0.0.1", port: beacon.getPort(), peerType: "a"})
    const subscriberB = new BeaconClient({host: "127.0.0.1", port: beacon.getPort(), peerType: "b"})

    /** @type {Array<import("../../src/beacon/types.js").BeaconBroadcastMessage>} */
    const receivedA = []
    /** @type {Array<import("../../src/beacon/types.js").BeaconBroadcastMessage>} */
    const receivedB = []
    /** @type {Array<import("../../src/beacon/types.js").BeaconBroadcastMessage>} */
    const echoedToPublisher = []

    publisher.onBroadcast((message) => echoedToPublisher.push(message))
    subscriberA.onBroadcast((message) => receivedA.push(message))
    subscriberB.onBroadcast((message) => receivedB.push(message))

    await Promise.all([publisher.connect(), subscriberA.connect(), subscriberB.connect()])

    await timeout({timeout: 1000}, async () => {
      while (beacon.getPeerCount() < 3) await wait(0.01)
    })

    publisher.publish({channel: "frontend-models", broadcastParams: {model: "BuildLog"}, body: {action: "create", id: "abc"}})

    await timeout({timeout: 1000}, async () => {
      while (receivedA.length === 0 || receivedB.length === 0 || echoedToPublisher.length === 0) {
        await wait(0.01)
      }
    })

    expect(receivedA[0].channel).toBe("frontend-models")
    expect(receivedA[0].broadcastParams).toEqual({model: "BuildLog"})
    expect(receivedA[0].body).toEqual({action: "create", id: "abc"})
    expect(receivedB[0].channel).toBe("frontend-models")
    expect(echoedToPublisher[0].originPeerId).toBe(publisher.getPeerId())

    await publisher.close()
    await subscriberA.close()
    await subscriberB.close()
    await beacon.stop()
  })

  it("drops disconnected peers from future fan-outs", async () => {
    const beacon = new BeaconServer({configuration: buildConfiguration(), host: "127.0.0.1", port: 0})
    await beacon.start()

    const publisher = new BeaconClient({host: "127.0.0.1", port: beacon.getPort(), peerType: "publisher"})
    const subscriber = new BeaconClient({host: "127.0.0.1", port: beacon.getPort(), peerType: "subscriber"})

    await Promise.all([publisher.connect(), subscriber.connect()])

    await timeout({timeout: 1000}, async () => {
      while (beacon.getPeerCount() < 2) await wait(0.01)
    })

    await subscriber.close()

    await timeout({timeout: 1000}, async () => {
      while (beacon.getPeerCount() > 1) await wait(0.01)
    })

    publisher.publish({channel: "c", broadcastParams: {}, body: {n: 1}})
    await wait(0.05)

    expect(beacon.getPeerCount()).toBe(1)

    await publisher.close()
    await beacon.stop()
  })
})
