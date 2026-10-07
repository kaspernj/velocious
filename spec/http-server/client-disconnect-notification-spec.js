// @ts-check

import {describe, expect, it} from "../../src/testing/test.js"
import Application from "../../src/application.js"
import Configuration from "../../src/configuration.js"
import Controller from "../../src/controller.js"
import EnvironmentHandlerNode from "../../src/environment-handlers/node.js"
import net from "node:net"
import {fileURLToPath} from "node:url"

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

/**
 * Opens a raw TCP socket, sends one request, waits `destroyAfterMs` (enough
 * for the handler to be running) and tears the socket down — the client
 * disconnect under test.
 * @param {number} port @param {string} requestLine @param {number} destroyAfterMs
 * @returns {Promise<void>}
 */
const connectAndDisconnect = (port, requestLine, destroyAfterMs) => new Promise((resolve, reject) => {
  const socket = net.connect(port, "127.0.0.1", () => {
    socket.write(requestLine)
    socket.write("Host: localhost\r\n")
    socket.write("\r\n")
    setTimeout(() => {
      socket.destroy()
      resolve()
    }, destroyAfterMs).unref?.()
  })
  socket.on("error", reject)
})

/** @returns {Promise<number>} */
const bindPort = async (application) => {
  await application.startHttpServer()
  const address = application.httpServer?.netServer?.address()
  if (typeof address?.port !== "number") throw new Error("Expected HTTP server to bind a TCP port")
  return address.port
}

const configurationFor = () => new Configuration({
  database: false,
  directory: fileURLToPath(new URL("../dummy", import.meta.url)),
  environment: "test",
  environmentHandler: new EnvironmentHandlerNode(),
  httpServer: {host: "127.0.0.1", inProcess: true, port: 0, workers: 1},
  initializeModels: async () => {},
  locale: "en",
  localeFallbacks: {en: ["en"]},
  locales: ["en"],
  logging: {console: false, file: false}
})

describe("HttpServer client disconnect notification", {databaseCleaning: {transaction: false, truncate: false}}, () => {
  it("notifies a running buffered request when the client socket tears down", async () => {
    /** @type {{notified: boolean, lateNotified: boolean, lateReported: boolean | null}} */
    const state = {notified: false, lateNotified: false, lateReported: null}

    class DisconnectController extends Controller {
      async run() {
        this.request().onClientDisconnect(() => { state.notified = true })
        // Simulate a long-running buffered request (e.g. an admission queue
        // wait): the response is still buffered when the socket goes away.
        await wait(400)
        // Late registration, after the socket already tore down: it must
        // fire immediately so a handler that starts watching late still
        // learns the client is gone.
        this.request().onClientDisconnect(() => { state.lateNotified = true })
        state.lateReported = this.request().clientDisconnected
        this.render({json: {ok: true}})
      }
    }

    const configuration = configurationFor()
    configuration.addRouteResolverHook(({currentPath}) => {
      if (currentPath !== "/slow") return
      return {action: "run", controller: "disconnect", controllerClass: DisconnectController}
    })
    const application = new Application({configuration, type: "test-runner"})
    try {
      const port = await bindPort(application)
      await connectAndDisconnect(port, "GET /slow HTTP/1.1\r\n", 60)
      await wait(500)
      expect(state.notified).toBe(true)
      expect(state.lateNotified).toBe(true)
      expect(state.lateReported).toBe(true)
    } finally {
      await application.stop()
    }
  })

  it("fires every registration of a running request exactly once and ignores finished requests", async () => {
    /** @type {Record<string, number>} */
    const fires = {}

    class FastController extends Controller {
      run() {
        this.request().onClientDisconnect(() => { fires.fast = (fires.fast ?? 0) + 1 })
        this.render({json: {fast: true}})
      }
    }

    class SlowController extends Controller {
      async run() {
        this.request().onClientDisconnect(() => { fires.slow = (fires.slow ?? 0) + 1 })
        this.request().onClientDisconnect(() => { fires.slow = (fires.slow ?? 0) + 1 })
        await wait(300)
        this.render({json: {slow: true}})
      }
    }

    const configuration = configurationFor()
    configuration.addRouteResolverHook(({currentPath}) => {
      if (currentPath === "/fast") return {action: "run", controller: "fast", controllerClass: FastController}
      if (currentPath === "/slow") return {action: "run", controller: "slow", controllerClass: SlowController}
    })
    const application = new Application({configuration, type: "test-runner"})
    try {
      const port = await bindPort(application)
      // One keep-alive connection carries BOTH requests: the fast one
      // finishes before the disconnect, the slow one is still running when
      // the socket tears down. Only the running request's callbacks may fire.
      const socket = net.connect(port, "127.0.0.1")
      /** @type {Buffer[]} */
      const received = []
      socket.on("data", (chunk) => { received.push(Buffer.from(chunk)) })
      await new Promise((resolve) => { socket.on("connect", resolve) })
      socket.write("GET /fast HTTP/1.1\r\n")
      socket.write("Host: localhost\r\n")
      socket.write("\r\n")
      // Wait until the finished response has been delivered before pipelining
      // the slow request on the same keep-alive connection.
      const waitForFast = () => Buffer.concat(received).toString("utf8").includes('"fast":true')
      const deadline = Date.now() + 5000
      while (!waitForFast() && Date.now() < deadline) await wait(5)
      expect(waitForFast()).toBe(true)
      socket.write("GET /slow HTTP/1.1\r\n")
      socket.write("Host: localhost\r\n")
      socket.write("\r\n")
      await wait(100)
      socket.destroy()
      await wait(500)
      expect(fires.slow).toBe(2)
      expect(fires.fast ?? 0).toBe(0)
    } finally {
      await application.stop()
    }
  })
})
