// @ts-check

import Application from "../../src/application.js"
import Configuration from "../../src/configuration.js"
import Controller from "../../src/controller.js"
import EnvironmentHandlerNode from "../../src/environment-handlers/node.js"
import net from "node:net"
import {fileURLToPath} from "node:url"
import {describe, expect, it} from "../../src/testing/test.js"

class DatabaseFreeConfiguration {
  database = false
  databasePoolInitializations = 0
  httpServer = {}

  /** @returns {{importApplicationRoutes: () => Promise<{routes: Record<string, never>}>}} */
  getEnvironmentHandler() {
    return {importApplicationRoutes: async () => ({routes: {}})}
  }

  /** @returns {{api: undefined}} */
  getSyncConfiguration() { return {api: undefined} }

  /** @returns {Record<string, never>} */
  getModelClasses() { return {} }

  /** @param {{type: string}} _args */
  async initialize(_args) {}

  /** @param {Record<string, never>} routes */
  setRoutes(routes) { this.routes = routes }

  /** @returns {boolean} */
  isDatabasePoolInitialized() { return false }

  /** @returns {void} */
  initializeDatabasePool() { this.databasePoolInitializations++ }
}

describe("Application database-free initialization", {databaseCleaning: {transaction: false, truncate: false}}, () => {
  it("initializes an explicitly database-free application without creating a pool", async () => {
    const configuration = new DatabaseFreeConfiguration()
    const application = new Application({
      configuration: /** @type {import("../../src/configuration.js").default} */ (/** @type {unknown} */ (configuration)),
      type: "server"
    })

    await application.initialize()

    expect(configuration.databasePoolInitializations).toEqual(0)
    expect(configuration.routes).toEqual({})
  })

  it("serves shared mutable in-process state and stops cleanly without a database", async () => {
    let requestCount = 0

    class StateController extends Controller {
      async index() {
        requestCount++
        await this.render({json: {requestCount}})
      }
    }

    const configuration = new Configuration({
      database: false,
      directory: fileURLToPath(new URL("../dummy", import.meta.url)),
      environment: "test",
      environmentHandler: new EnvironmentHandlerNode(),
      httpServer: {
        host: "127.0.0.1",
        inProcess: true,
        maxBufferedResponseBodyBytes: 1024,
        maxRequestBodyBytes: 1024,
        port: 0,
        workers: 1
      },
      initializeModels: async () => {},
      locale: "en",
      localeFallbacks: {en: ["en"]},
      locales: ["en"],
      logging: {console: false, file: false}
    })

    configuration.addRouteResolverHook(({currentPath}) => {
      if (currentPath !== "/state") return

      return {
        action: "index",
        controller: "state",
        controllerClass: StateController,
        skipAbilityResolution: true,
        skipControllerConnections: true,
        skipTenantResolution: true
      }
    })

    const application = new Application({configuration, type: "test-runner"})

    try {
      await application.initialize()
      await application.startHttpServer()

      const httpServer = application.httpServer
      const address = httpServer?.netServer?.address()

      if (typeof address?.port !== "number") throw new Error("Expected database-free HTTP server to bind a TCP port")

      /** @type {() => Promise<string>} */
      const requestState = async () => await new Promise((resolve, reject) => {
        const socket = net.connect(address.port, "127.0.0.1", () => {
          socket.write("GET /state HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n")
        })
        /** @type {Buffer[]} */
        const chunks = []

        socket.on("data", (chunk) => chunks.push(chunk))
        socket.on("error", reject)
        socket.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")))
      })

      expect(await requestState()).toContain('{"requestCount":1}')
      expect(await requestState()).toContain('{"requestCount":2}')
      expect(requestCount).toEqual(2)
    } finally {
      await application.stop()
    }

    expect(application.isActive()).toEqual(false)
    expect(configuration.isDatabasePoolInitialized()).toEqual(false)
  })
})
