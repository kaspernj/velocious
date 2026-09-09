// @ts-check

import net from "node:net"
import os from "node:os"
import path from "node:path"

import Application from "../../src/application.js"
import Controller from "../../src/controller.js"
import {buildConfiguration} from "../helpers/http-response-compression-test-helper.js"
import {describe, expect, it} from "../../src/testing/test.js"

let testDirectorySequence = 0

/**
 * Body large enough to clear the default 1024-byte compression threshold and
 * repetitive enough to actually shrink under gzip.
 * @type {string}
 */
const COMPRESSIBLE_PAYLOAD = "compression-proof ".repeat(256)

/**
 * Serves COMPRESSIBLE_PAYLOAD as a compressible JSON body so the live round
 * trip exercises real compression negotiation past the size threshold.
 */
class CompressionProbeController extends Controller {
  async index() {
    await this.render({json: {payload: COMPRESSIBLE_PAYLOAD}})
  }
}

class HttpServerConfigurationTestConfiguration {
  debug = false
  shutdownCalls = 0
  websocketEvents = null

  /** @param {{httpServer?: import("../../src/configuration-types.js").HttpServerConfiguration}} args */
  constructor({httpServer = {}} = {}) {
    this.httpServer = httpServer
    testDirectorySequence++
    this.directory = path.join(os.tmpdir(), `velocious-http-server-configuration-${process.pid}-${testDirectorySequence}`)
  }

  /** @returns {string} - Application directory. */
  getDirectory() {
    return this.directory
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

  /** @returns {Promise<void>} */
  async shutdown() {
    this.shutdownCalls++
  }
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

describe("Application HTTP server configuration", {databaseCleaning: {transaction: false, truncate: false}}, () => {
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

    expect(configuration.shutdownCalls).toEqual(1)
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

  it("honors the configured compression in a directly constructed application", async () => {
    /** @type {Application[]} */
    const applications = []

    try {
      for (const [label, compression, expectGzip] of [
        ["defaults", undefined, true],
        ["disabled", false, false]
      ]) {
        // Each application needs its own directory: the HTTP server lock lives at
        // <directory>/tmp/server.lock, and both iterations run in this process, so
        // a shared directory would make the second startup fail the lock check.
        testDirectorySequence++
        const applicationDirectory = path.join(os.tmpdir(), `velocious-http-compression-${process.pid}-${testDirectorySequence}`)
        const configuration = buildConfiguration({compression: compression === undefined ? undefined : /** @type {boolean} */ (compression), directory: applicationDirectory})
        // Serve a real compressible body past the 1024-byte threshold through a
        // route resolver hook so the wire round-trip proves negotiation, not a
        // sub-threshold 404.
        configuration.addRouteResolverHook(({currentPath}) => {
          if (currentPath !== "/compression-probe") return
          return {
            action: "index",
            controller: "compression-probe",
            controllerClass: CompressionProbeController,
            skipAbilityResolution: true,
            skipControllerConnections: true,
            skipTenantResolution: true
          }
        })
        const application = new Application({
          configuration,
          httpServer: {
            host: "127.0.0.1",
            inProcess: true,
            port: 0,
            workers: 1
          },
          type: "test"
        })

        applications.push(application)

        await application.startHttpServer()
        const httpServer = /** @type {import("../../src/http-server/index.js").default} */ (application.httpServer)
        if (!httpServer) throw new Error(`Expected the ${label} application to start an HTTP server`)
        const netServer = httpServer.netServer
        if (!netServer) throw new Error(`Expected the ${label} application to bind a TCP socket`)

        // startHttpServer awaits the net server's listen, so the socket is bound
        // by the time it resolves; read the real bound address. A bound TCP
        // server reports a numeric port (pipe/socket addresses report a path or
        // null and cannot serve HTTP for this test).
        const address = netServer.address()
        if (typeof address?.port !== "number") throw new Error(`Expected the ${label} application to bind a TCP port`)

        const response = await new Promise((resolve, reject) => {
          const socket = net.connect(address.port, "127.0.0.1", () => {
            socket.write([
              "GET /compression-probe HTTP/1.1",
              "Host: localhost",
              "Accept-Encoding: gzip",
              "Connection: close",
              "",
              ""
            ].join("\r\n"))
          })

          /** @type {Buffer[]} */
          const chunks = []

          socket.on("data", (chunk) => {
            chunks.push(chunk)
          })
          socket.on("error", reject)
          socket.on("end", () => {
            resolve(Buffer.concat(chunks).toString("latin1"))
          })
        })
        const headersEnd = response.indexOf("\r\n\r\n")

        if (headersEnd === -1) throw new Error("Expected a complete HTTP response")

        const headers = response.slice(0, headersEnd)

        expect(headers).toContain("HTTP/1.1 200 OK\r\n")

        if (expectGzip) {
          expect(headers).toContain("Content-Encoding: gzip\r\n")
          expect(headers).toContain("Vary: Accept-Encoding\r\n")
        } else {
          expect(headers).not.toContain("Content-Encoding")
          expect(headers).not.toContain("Vary")
        }
      }
    } finally {
      for (const application of applications) {
        await application.stop()
      }
    }
  })
})
