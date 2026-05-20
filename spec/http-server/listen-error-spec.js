// @ts-check

import Net from "node:net"

import HttpServer from "../../src/http-server/index.js"
import {describe, expect, it} from "../../src/testing/test.js"

class TestWorkerHandler {
  /** @type {import("../../src/http-server/server-client.js").default | undefined} */
  client

  /**
   * @param {object} args - Options object.
   * @param {Array<string>} args.stoppedWorkers - Stopped workers.
   * @param {number} args.workerCount - Worker count.
   */
  constructor({stoppedWorkers, workerCount}) {
    this.started = false
    this.stoppedWorkers = stoppedWorkers
    this.workerCount = workerCount
  }

  /** @returns {Promise<void>} - Resolves when started. */
  async start() {
    this.started = true
  }

  /**
   * @param {import("../../src/http-server/server-client.js").default} client - Server client.
   * @returns {void} - No return value.
   */
  addSocketConnection(client) {
    this.client = client
  }

  /** @returns {Promise<void>} - Resolves when stopped. */
  async stop() {
    this.stoppedWorkers.push(`worker-${this.workerCount}`)
  }
}

/** @returns {{debug: boolean, getEnvironment: () => string}} - Test configuration. */
function buildConfiguration() {
  return {
    debug: false,
    getEnvironment: () => "test"
  }
}

/**
 * @param {Net.Server} server - Server to bind.
 * @returns {Promise<number>} - Bound port.
 */
async function listenOnRandomPort(server) {
  await new Promise((resolve, reject) => {
    server.once("error", reject)
    server.listen(0, "127.0.0.1", resolve)
  })

  const address = server.address()
  if (!address || typeof address === "string") throw new Error(`Unexpected server address: ${address}`)

  return address.port
}

describe("HttpServer - listen errors", () => {
  it("rejects startup and stops workers when the port is already in use", async () => {
    const occupiedServer = Net.createServer()
    const port = await listenOnRandomPort(occupiedServer)
    const stoppedWorkers = []

    const server = new HttpServer({
      configuration: buildConfiguration(),
      host: "127.0.0.1",
      port,
      workerHandlerFactory: ({workerCount}) => new TestWorkerHandler({stoppedWorkers, workerCount})
    })

    let startupError
    try {
      await server.start()
    } catch (error) {
      startupError = error
    }

    await new Promise((resolve, reject) => {
      occupiedServer.close((error) => {
        if (error) {
          reject(error)
        } else {
          resolve(undefined)
        }
      })
    })

    expect(startupError.code).toEqual("EADDRINUSE")
    expect(stoppedWorkers).toEqual(["worker-0"])
    expect(server.isActive()).toBeFalse()
  })

  it("rejects repeated starts without tearing down the active server", async () => {
    const stoppedWorkers = []
    const server = new HttpServer({
      configuration: buildConfiguration(),
      host: "127.0.0.1",
      port: 0,
      workerHandlerFactory: ({workerCount}) => new TestWorkerHandler({stoppedWorkers, workerCount})
    })

    await server.start()

    let startupError
    try {
      await server.start()
    } catch (error) {
      startupError = error
    }

    expect(startupError.message).toEqual("Velocious HTTP server is already running")
    expect(stoppedWorkers).toEqual([])
    expect(server.isActive()).toBeTrue()

    await server.stop()

    expect(stoppedWorkers).toEqual(["worker-0"])
  })

  it("preserves explicit port zero for random-port test servers", () => {
    const server = new HttpServer({
      configuration: buildConfiguration(),
      port: 0
    })

    expect(server.port).toEqual(0)
  })
})
