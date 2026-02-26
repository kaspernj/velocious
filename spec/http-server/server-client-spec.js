// @ts-check

import EventEmitter from "node:events"

import Configuration from "../../src/configuration.js"
import EnvironmentHandlerNode from "../../src/environment-handlers/node.js"
import ServerClient from "../../src/http-server/server-client.js"
import {describe, expect, it} from "../../src/testing/test.js"

class FakeSocket extends EventEmitter {
  remoteAddress = "127.0.0.1"
  destroyed = false
  writable = true
  writableEnded = false

  /**
   * @param {string | Uint8Array} _data - Data payload.
   * @param {() => void} [callback] - Callback.
   * @returns {boolean} - True.
   */
  write(_data, callback) {
    if (callback) callback()

    return true
  }

  /** @returns {void} - No return value. */
  end() {
    this.writableEnded = true
    this.writable = false
    this.destroyed = true
    this.emit("close")
  }
}

describe("HttpServer - server client", () => {
  it("handles socket errors without crashing and emits close once", async () => {
    const configuration = new Configuration({
      database: {test: {}},
      directory: process.cwd(),
      environment: "test",
      environmentHandler: new EnvironmentHandlerNode(),
      initializeModels: async () => {},
      locale: "en",
      localeFallbacks: {en: ["en"]},
      locales: ["en"],
      logging: {console: false, file: false}
    })
    const socket = new FakeSocket()
    const client = new ServerClient({clientCount: 1, configuration, socket})
    let closeEvents = 0

    client.events.on("close", () => {
      closeEvents += 1
    })

    socket.emit("error", Object.assign(new Error("write ECONNRESET"), {code: "ECONNRESET"}))
    socket.emit("close")
    socket.emit("end")

    expect(closeEvents).toEqual(1)
    await client.send("after-error")
  })
})
