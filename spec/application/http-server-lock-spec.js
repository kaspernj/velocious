// @ts-check

import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"

import Application from "../../src/application.js"
import {describe, expect, it} from "../../src/testing/test.js"

class HttpServerLockTestConfiguration {
  debug = false
  httpServer = {}
  websocketEvents = null
  connectBeaconCalls = 0

  /** @param {string} directory - Application directory. */
  constructor(directory) {
    this.directory = directory
  }

  /** @returns {string} - Application directory. */
  getDirectory() {
    return this.directory
  }

  /** @returns {unknown} - Websocket events host. */
  getWebsocketEvents() {
    return this.websocketEvents
  }

  /**
   * @param {unknown} websocketEvents - Websocket events host.
   * @returns {void} - No return value.
   */
  setWebsocketEvents(websocketEvents) {
    this.websocketEvents = websocketEvents
  }

  /** @returns {Promise<void>} - Resolves after fake Beacon connection. */
  async connectBeacon() {
    this.connectBeaconCalls++
  }

  /** @returns {Promise<void>} - Resolves after fake Beacon disconnection. */
  async disconnectBeacon() {}

  /** @returns {Promise<void>} - Resolves after fake DB cleanup. */
  async closeDatabaseConnections() {}
}

class FakeHttpServerEvents {
  /**
   * @param {string} _eventName - Event name.
   * @param {() => void} _callback - Event callback.
   * @returns {void} - No return value.
   */
  on(_eventName, _callback) {}
}

class FakeHttpServer {
  events = new FakeHttpServerEvents()
  active = false

  /** @param {{startError?: Error}} args - Fake server options. */
  constructor({startError} = {}) {
    this.startError = startError
    this.startCalls = 0
    this.stopCalls = 0
  }

  /** @returns {Promise<void>} - Resolves after fake startup. */
  async start() {
    this.startCalls++
    if (this.startError) throw this.startError

    this.active = true
  }

  /** @returns {Promise<void>} - Resolves after fake shutdown. */
  async stop() {
    this.stopCalls++
    this.active = false
  }

  /** @returns {boolean} - Whether the fake server is active. */
  isActive() {
    return this.active
  }
}

class HttpServerLockTestApplication extends Application {
  /** @type {FakeHttpServer[]} */
  createdServers = []

  /** @param {Error | undefined} startError - Error to throw from fake startup. */
  setStartError(startError) {
    this.startError = startError
  }

  /** @returns {FakeHttpServer} - Fake HTTP server instance. */
  createHttpServer() {
    const server = new FakeHttpServer({startError: this.startError})

    this.createdServers.push(server)

    return /** @type {import("../../src/http-server/index.js").default} */ (/** @type {unknown} */ (server))
  }
}

let tempDirectorySequence = 0

/** @returns {Promise<string>} - Fresh application directory. */
async function createTempApplicationDirectory() {
  tempDirectorySequence++

  return await fs.mkdtemp(path.join(os.tmpdir(), `velocious-http-server-lock-${process.pid}-${tempDirectorySequence}-`))
}

/**
 * @param {string} directory - Application directory.
 * @param {Error | undefined} [startError] - Optional startup error.
 * @param {string} [type] - Application type.
 * @returns {{application: HttpServerLockTestApplication, configuration: HttpServerLockTestConfiguration}} - Test app and config.
 */
function buildApplication(directory, startError, type = "test") {
  const configuration = new HttpServerLockTestConfiguration(directory)
  const application = new HttpServerLockTestApplication({
    configuration: /** @type {import("../../src/configuration.js").default} */ (/** @type {unknown} */ (configuration)),
    type
  })
  application.setStartError(startError)

  return {application, configuration}
}

describe("Application HTTP server lock", {databaseCleaning: {transaction: true}}, () => {
  it("rejects a second server for the same application directory before startup side effects", async () => {
    const directory = await createTempApplicationDirectory()
    const first = buildApplication(directory)
    const second = buildApplication(directory)

    try {
      await first.application.startHttpServer()

      let startupError
      try {
        await second.application.startHttpServer()
      } catch (error) {
        startupError = error
      }

      expect(startupError.message).toContain("already running")
      expect(second.configuration.connectBeaconCalls).toEqual(0)
      expect(second.application.createdServers).toHaveLength(0)
    } finally {
      await first.application.stop()
      await fs.rm(directory, {recursive: true, force: true})
    }
  })

  it("releases the lock when the application stops", async () => {
    const directory = await createTempApplicationDirectory()
    const first = buildApplication(directory)
    const second = buildApplication(directory)

    try {
      await first.application.startHttpServer()
      await first.application.stop()

      await second.application.startHttpServer()

      expect(second.application.createdServers).toHaveLength(1)
    } finally {
      await second.application.stop()
      await fs.rm(directory, {recursive: true, force: true})
    }
  })

  it("releases the lock when startup fails", async () => {
    const directory = await createTempApplicationDirectory()
    const failing = buildApplication(directory, new Error("startup failed"))
    const succeeding = buildApplication(directory)

    try {
      let startupError
      try {
        await failing.application.startHttpServer()
      } catch (error) {
        startupError = error
      }

      expect(startupError.message).toEqual("startup failed")

      await succeeding.application.startHttpServer()

      expect(succeeding.application.createdServers).toHaveLength(1)
    } finally {
      await succeeding.application.stop()
      await fs.rm(directory, {recursive: true, force: true})
    }
  })

  it("reclaims stale locks owned by dead local processes", async () => {
    const directory = await createTempApplicationDirectory()
    const lockDirectory = path.join(directory, "tmp", "server.lock")
    const {application} = buildApplication(directory)

    try {
      await fs.mkdir(lockDirectory, {recursive: true})
      await fs.writeFile(path.join(lockDirectory, "owner.json"), JSON.stringify({
        hostname: os.hostname(),
        pid: 999999999
      }))

      await application.startHttpServer()

      expect(application.createdServers).toHaveLength(1)
    } finally {
      await application.stop()
      await fs.rm(directory, {recursive: true, force: true})
    }
  })

  it("lets the test runner server coexist with dummy app servers", async () => {
    const directory = await createTempApplicationDirectory()
    const testRunner = buildApplication(directory, undefined, "test-runner")
    const dummy = buildApplication(directory)

    try {
      await testRunner.application.startHttpServer()
      await dummy.application.startHttpServer()

      expect(testRunner.application.createdServers).toHaveLength(1)
      expect(dummy.application.createdServers).toHaveLength(1)
    } finally {
      await dummy.application.stop()
      await testRunner.application.stop()
      await fs.rm(directory, {recursive: true, force: true})
    }
  })
})
