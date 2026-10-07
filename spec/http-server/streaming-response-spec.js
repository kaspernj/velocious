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
 * Reads a raw HTTP/1.1 response over a fresh socket until the socket ends,
 * tracking when the first body byte and the socket end each arrived.
 * @param {number} port
 * @param {string} requestLine
 * @returns {Promise<{raw: string, firstBodyAt: number, endAt: number}>}
 */
const readRawUntilEnd = (port, requestLine) => new Promise((resolve, reject) => {
  const socket = net.connect(port, "127.0.0.1", () => {
    socket.write(requestLine)
    socket.write("Host: localhost\r\n")
    socket.write("Connection: close\r\n\r\n")
  })
  /** @type {Buffer[]} */
  const chunks = []
  /** @type {string} */
  let accumulated = ""
  let firstBodyAt = -1
  socket.on("data", (chunk) => {
    chunks.push(Buffer.from(chunk))
    if (firstBodyAt === -1) {
      accumulated = Buffer.concat(chunks).toString("utf8")
      const markerIndex = accumulated.indexOf("\r\n\r\n")
      if (markerIndex !== -1 && accumulated.length > markerIndex + 4) firstBodyAt = Date.now()
    }
  })
  socket.on("error", reject)
  socket.on("end", () => resolve({
    raw: Buffer.concat(chunks).toString("utf8"),
    firstBodyAt,
    endAt: Date.now()
  }))
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

describe("HttpServer streaming responses", {databaseCleaning: {transaction: false, truncate: false}}, () => {
  it("streams chunks to the client incrementally over a chunked response", async () => {
    class StreamController extends Controller {
      async run() {
        this.response().stream()
        this.response().write("data: one\n\n")
        await wait(40)
        this.response().write("data: two\n\n")
        await wait(40)
        this.response().write("data: three\n\n")
        this.response().end()
      }
    }
    const configuration = configurationFor()
    configuration.addRouteResolverHook(({currentPath}) => {
      if (currentPath !== "/stream") return
      return {action: "run", controller: "stream", controllerClass: StreamController}
    })
    const application = new Application({configuration, type: "test-runner"})
    try {
      const port = await bindPort(application)
      const result = await readRawUntilEnd(port, "GET /stream HTTP/1.1\r\n")
      expect(result.raw).toContain("data: one")
      expect(result.raw).toContain("data: two")
      expect(result.raw).toContain("data: three")
      const indexOfOne = result.raw.indexOf("data: one")
      const indexOfTwo = result.raw.indexOf("data: two")
      const indexOfThree = result.raw.indexOf("data: three")
      expect(indexOfOne < indexOfTwo && indexOfTwo < indexOfThree).toBe(true)
      expect(result.firstBodyAt).toBeGreaterThan(-1)
      expect(result.firstBodyAt).toBeLessThan(result.endAt)
    } finally {
      await application.stop()
    }
  })

  it("keeps the buffered path unchanged and does not stream", async () => {
    class BufferedController extends Controller {
      async run() {
        this.render({json: {ok: true}})
      }
    }
    const configuration = configurationFor()
    configuration.addRouteResolverHook(({currentPath}) => {
      if (currentPath !== "/buffered") return
      return {action: "run", controller: "buffered", controllerClass: BufferedController}
    })
    const application = new Application({configuration, type: "test-runner"})
    try {
      const port = await bindPort(application)
      const result = await readRawUntilEnd(port, "GET /buffered HTTP/1.1\r\n")
      expect(result.raw).toContain('{"ok":true}')
    } finally {
      await application.stop()
    }
  })

  it("notifies the handler when the client disconnects mid-stream", async () => {
    let streamSeenAborted = false
    class DisconnectController extends Controller {
      async run() {
        this.response().stream()
        this.response().write("data: first\n\n")
        while (!this.response().isStreamAborted()) await wait(15)
        streamSeenAborted = this.response().isStreamAborted()
        this.response().end()
      }
    }
    const configuration = configurationFor()
    configuration.addRouteResolverHook(({currentPath}) => {
      if (currentPath !== "/disconnect") return
      return {action: "run", controller: "disconnect", controllerClass: DisconnectController}
    })
    const application = new Application({configuration, type: "test-runner"})
    try {
      const port = await bindPort(application)
      await new Promise((resolve) => {
        const socket = net.connect(port, "127.0.0.1", () => {
          socket.write("GET /disconnect HTTP/1.1\r\n")
          socket.write("Host: localhost\r\n")
          socket.write("Connection: close\r\n\r\n")
        })
        /** @type {Buffer[]} */
        const chunks = []
        socket.on("data", (chunk) => {
          chunks.push(chunk)
          const text = Buffer.concat(chunks).toString("utf8")
          if (text.includes("data: first")) socket.destroy()
        })
        socket.on("error", () => {})
        socket.on("close", () => resolve())
      })
      await wait(60)
      expect(streamSeenAborted).toBe(true)
    } finally {
      await application.stop()
    }
  })

  it("rejects malformed streaming use", async () => {
    class MisuseController extends Controller {
      async run() {
        this.response().setBody("buffered")
        this.response().stream()
      }
    }
    const configuration = configurationFor()
    configuration.addRouteResolverHook(({currentPath}) => {
      if (currentPath !== "/misuse") return
      return {action: "run", controller: "misuse", controllerClass: MisuseController}
    })
    const application = new Application({configuration, type: "test-runner"})
    try {
      const port = await bindPort(application)
      const result = await readRawUntilEnd(port, "GET /misuse HTTP/1.1\r\n")
      expect(result.raw).toContain("500 Internal server error")
      expect(result.raw).toContain("call stream() before setBody() to stream instead")
    } finally {
      await application.stop()
    }
  })
})
