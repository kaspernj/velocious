// @ts-check

import net from "net"
import timeout from "awaitery/build/timeout.js"
import wait from "awaitery/build/wait.js"

import BeaconClient from "../../src/beacon/client.js"
import BeaconServer from "../../src/beacon/server.js"
import Configuration from "../../src/configuration.js"
import EnvironmentHandlerNode from "../../src/environment-handlers/node.js"
import {describe, expect, it} from "../../src/testing/test.js"

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

/**
 * @returns {Promise<number>} - A port that was bound and immediately released. Useful for "guaranteed unreachable" connect targets.
 */
async function reservedPort() {
  const server = net.createServer()

  await new Promise((resolve, reject) => {
    server.once("error", reject)
    server.listen(0, "127.0.0.1", () => resolve(undefined))
  })

  const address = server.address()
  const port = address && typeof address === "object" ? address.port : 0

  await new Promise((resolve) => server.close(() => resolve(undefined)))

  return port
}

describe("Beacon error reporting", {databaseCleaning: {transaction: false, truncate: false}}, () => {
  it("emits framework-error and all-error when the initial connect fails", async () => {
    const port = await reservedPort()
    const configuration = buildConfiguration({host: "127.0.0.1", port})

    /** @type {Array<{stage: string, error: Error}>} */
    const frameworkErrors = []
    /** @type {Array<{stage: string, errorType: string, error: Error}>} */
    const allErrors = []

    configuration.getErrorEvents().on("framework-error", (payload) => frameworkErrors.push({stage: payload.context.stage, error: payload.error}))
    configuration.getErrorEvents().on("all-error", (payload) => allErrors.push({stage: payload.context.stage, errorType: payload.errorType, error: payload.error}))

    await configuration.connectBeacon({peerType: "test"})

    await timeout({timeout: 1000}, async () => {
      while (frameworkErrors.length === 0) await wait(0.01)
    })

    expect(frameworkErrors[0].stage).toBe("beacon-connect")
    expect(frameworkErrors[0].error).toBeInstanceOf(Error)
    expect(allErrors[0].errorType).toBe("framework-error")
    expect(allErrors[0].stage).toBe("beacon-connect")

    await configuration.disconnectBeacon()
  })

  it("emits framework-error with stage `beacon-disconnect` when the broker drops mid-session", async () => {
    const beacon = new BeaconServer({configuration: buildConfiguration({host: "127.0.0.1", port: 0}), host: "127.0.0.1", port: 0})

    await beacon.start()

    const configuration = buildConfiguration({host: "127.0.0.1", port: beacon.getPort()})

    /** @type {Array<{stage: string, error: Error}>} */
    const errors = []

    configuration.getErrorEvents().on("framework-error", (payload) => errors.push({stage: payload.context.stage, error: payload.error}))

    await configuration.connectBeacon({peerType: "test"})
    expect(configuration.getBeaconClient()?.isConnected()).toBe(true)

    // Wait for the broker to register the peer (it tracks peers only after
    // the hello handshake lands). Otherwise `beacon.stop()` may run before
    // the broker has anything to close, leaving the client connected.
    await timeout({timeout: 1000}, async () => {
      while (beacon.getPeerCount() < 1) await wait(0.01)
    })

    await beacon.stop()

    await timeout({timeout: 2000}, async () => {
      while (!errors.some((entry) => entry.stage === "beacon-disconnect")) {
        await wait(0.01)
      }
    })

    const disconnectError = errors.find((entry) => entry.stage === "beacon-disconnect")

    expect(disconnectError?.error).toBeInstanceOf(Error)

    await configuration.disconnectBeacon()
  })

  it("schedules an unhandled rejection only when no listener is attached to framework-error or all-error", async () => {
    const port = await reservedPort()

    /** @type {Array<{reason: unknown, source: import("../../src/configuration.js").default}>} */
    const unhandled = []
    /** @type {(reason: unknown, promise: Promise<unknown>) => void} */
    const handler = (reason) => unhandled.push({reason, source: configurationWithoutListener})

    process.on("unhandledRejection", handler)

    const configurationWithListener = buildConfiguration({host: "127.0.0.1", port})
    /** @type {Array<unknown>} */
    const heard = []

    configurationWithListener.getErrorEvents().on("framework-error", (payload) => heard.push(payload))

    const configurationWithoutListener = buildConfiguration({host: "127.0.0.1", port})

    await configurationWithListener.connectBeacon({peerType: "with-listener"})
    await configurationWithoutListener.connectBeacon({peerType: "without-listener"})

    await timeout({timeout: 1000}, async () => {
      while (heard.length === 0 || unhandled.length === 0) await wait(0.01)
    })

    // Wait one extra tick to detect any spurious double-rejection from the listener configuration.
    await wait(0.1)

    expect(heard.length).toBeGreaterThan(0)
    expect(unhandled.some((entry) => entry.source === configurationWithoutListener)).toBe(true)

    await configurationWithListener.disconnectBeacon()
    await configurationWithoutListener.disconnectBeacon()
    process.off("unhandledRejection", handler)
  })

  it("does not emit unhandled rejections when only an `all-error` listener is attached", async () => {
    const port = await reservedPort()
    const configuration = buildConfiguration({host: "127.0.0.1", port})

    /** @type {Array<unknown>} */
    const heard = []
    /** @type {Array<unknown>} */
    const unhandled = []
    /** @type {(reason: unknown) => void} */
    const handler = (reason) => unhandled.push(reason)

    configuration.getErrorEvents().on("all-error", (payload) => heard.push(payload))
    process.on("unhandledRejection", handler)

    await configuration.connectBeacon({peerType: "test"})

    await timeout({timeout: 1000}, async () => {
      while (heard.length === 0) await wait(0.01)
    })

    await wait(0.1)

    expect(heard.length).toBeGreaterThan(0)
    expect(unhandled.length).toBe(0)

    await configuration.disconnectBeacon()
    process.off("unhandledRejection", handler)
  })

  it("BeaconClient `disconnect` event fires with an Error reason when the broker drops", async () => {
    const beacon = new BeaconServer({configuration: buildConfiguration({host: "127.0.0.1", port: 0}), host: "127.0.0.1", port: 0})

    await beacon.start()

    const client = new BeaconClient({host: "127.0.0.1", port: beacon.getPort(), peerType: "test"})

    await client.connect()

    /** @type {Array<Error>} */
    const reasons = []

    client.on("disconnect", (reason) => reasons.push(reason))

    await timeout({timeout: 1000}, async () => {
      while (beacon.getPeerCount() < 1) await wait(0.01)
    })

    await beacon.stop()

    await timeout({timeout: 2000}, async () => {
      while (reasons.length === 0) await wait(0.01)
    })

    expect(reasons[0]).toBeInstanceOf(Error)
    expect(typeof reasons[0].message).toBe("string")
    expect(reasons[0].message.length).toBeGreaterThan(0)

    await client.close()
  })

  it("does not emit disconnect when the client is closed by the application", async () => {
    const beacon = new BeaconServer({configuration: buildConfiguration({host: "127.0.0.1", port: 0}), host: "127.0.0.1", port: 0})

    await beacon.start()

    const client = new BeaconClient({host: "127.0.0.1", port: beacon.getPort(), peerType: "test"})

    await client.connect()

    /** @type {Array<Error>} */
    const reasons = []

    client.on("disconnect", (reason) => reasons.push(reason))

    await client.close()
    await wait(0.05)

    expect(reasons.length).toBe(0)

    await beacon.stop()
  })
})
