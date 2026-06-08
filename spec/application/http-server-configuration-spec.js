// @ts-check

import Application from "../../src/application.js"
import {describe, expect, it} from "../../src/testing/test.js"

class HttpServerConfigurationTestConfiguration {
  debug = false
  websocketEvents = null

  /** @param {{httpServer?: import("../../src/configuration-types.js").HttpServerConfiguration}} args */
  constructor({httpServer = {}} = {}) {
    this.httpServer = httpServer
  }

  /** @returns {string} */
  getEnvironment() {
    return "test"
  }

  /** @returns {unknown} */
  getWebsocketEvents() {
    return this.websocketEvents
  }

  /** @param {unknown} websocketEvents */
  setWebsocketEvents(websocketEvents) {
    this.websocketEvents = websocketEvents
  }

  /** @returns {Promise<void>} */
  async connectBeacon() {}

  /** @returns {Promise<void>} */
  async disconnectBeacon() {}

  /** @returns {Promise<void>} */
  async closeDatabaseConnections() {}
}

/**
 * @param {Application} application - Application to start.
 * @param {object} expected - Expected HTTP server values.
 * @param {string} expected.host - Expected host.
 * @param {boolean} expected.inProcess - Whether in-process workers are expected.
 * @param {number} expected.port - Expected port.
 * @param {number} expected.workers - Expected worker count.
 * @returns {Promise<void>}
 */
async function expectStartedHttpServer(application, expected) {
  try {
    await application.startHttpServer()

    const {httpServer} = application
    if (!httpServer) throw new Error("Expected application to start an HTTP server")

    expect(httpServer.host).toEqual(expected.host)
    expect(httpServer.inProcess).toEqual(expected.inProcess)
    expect(httpServer.port).toEqual(expected.port)
    expect(httpServer.workers).toEqual(expected.workers)
    expect(httpServer.workerHandlers).toHaveLength(expected.workers)
  } finally {
    await application.stop()
  }
}

describe("Application HTTP server configuration", {databaseCleaning: {transaction: true}}, () => {
  it("uses configuration httpServer defaults", async () => {
    const configuration = new HttpServerConfigurationTestConfiguration({
      httpServer: {
        host: "127.0.0.1",
        inProcess: true,
        port: 0,
        workers: 2
      }
    })
    const application = new Application({
      configuration: /** @type {import("../../src/configuration.js").default} */ (/** @type {unknown} */ (configuration)),
      type: "test"
    })

    await expectStartedHttpServer(application, {
      host: "127.0.0.1",
      inProcess: true,
      port: 0,
      workers: 2
    })
  })

  it("lets direct application httpServer args override configuration defaults", async () => {
    const configuration = new HttpServerConfigurationTestConfiguration({
      httpServer: {
        host: "127.0.0.1",
        inProcess: true,
        port: 31006,
        workers: 2
      }
    })
    const application = new Application({
      configuration: /** @type {import("../../src/configuration.js").default} */ (/** @type {unknown} */ (configuration)),
      httpServer: {
        port: 0,
        workers: 1
      },
      type: "test"
    })

    await expectStartedHttpServer(application, {
      host: "127.0.0.1",
      inProcess: true,
      port: 0,
      workers: 1
    })
  })
})
