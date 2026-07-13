// @ts-check

import EventEmitter from "node:events"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import {waitFor} from "awaitery"

import Configuration from "../../src/configuration.js"
import EnvironmentHandlerNode from "../../src/environment-handlers/node.js"
import ServerClient from "../../src/http-server/server-client.js"
import {describe, expect, it} from "../../src/testing/test.js"

class FakeSocket extends EventEmitter {
  remoteAddress = "127.0.0.1"
  destroyed = false
  destroyCalls = 0
  emitWriteError = false
  writable = true
  writableEnded = false

  /**
   * @param {string | Uint8Array} _data - Data payload.
   * @param {(error?: Error) => void} [callback] - Callback.
   * @returns {boolean} - True.
   */
  write(_data, callback) {
    if (this.emitWriteError) {
      this.emit("error", Object.assign(new Error("write ECONNRESET"), {code: "ECONNRESET"}))
      return true
    }

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

  /**
   * @param {Error} _error - Error.
   * @returns {void} - No return value.
   */
  destroy(_error) {
    this.destroyCalls += 1
    this.writableEnded = true
    this.writable = false
    this.destroyed = true
    this.emit("close")
  }
}

class SlowFakeSocket extends FakeSocket {
  writes = []
  backpressured = true

  /**
   * @param {string | Uint8Array} data - Data payload.
   * @param {(error?: Error) => void} [callback] - Callback.
   * @returns {boolean} - Whether the socket accepted more data.
   */
  write(data, callback) {
    this.writes.push(Buffer.from(data))
    callback?.()

    return !this.backpressured
  }
}

/** @returns {Configuration} - Minimal server-client test configuration. */
function buildConfiguration() {
  return new Configuration({
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
}

describe("HttpServer - server client", {databaseCleaning: {transaction: true}}, () => {
  it("handles socket errors without crashing and emits close once", async () => {
    const configuration = buildConfiguration()
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
    expect(socket.destroyCalls).toEqual(1)
    await client.send("after-error")
  })

  it("resolves send when socket emits error during write", async () => {
    const configuration = buildConfiguration()
    const socket = new FakeSocket()
    const client = new ServerClient({clientCount: 2, configuration, socket})

    socket.emitWriteError = true
    await client.send("should-not-hang")
  })

  it("resolves end immediately for already closed sockets", async () => {
    const configuration = buildConfiguration()
    const socket = new FakeSocket()
    const client = new ServerClient({clientCount: 3, configuration, socket})

    socket.destroyed = true
    socket.writable = false
    socket.writableEnded = true

    await client.end()
  })

  it("pauses file reads until a backpressured socket drains", async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), "velocious-file-response-"))
    const filePath = path.join(directory, "large.bin")

    try {
      await fs.writeFile(filePath, Buffer.alloc(192 * 1024, 1))

      const socket = new SlowFakeSocket()
      const client = new ServerClient({clientCount: 4, configuration: buildConfiguration(), socket})
      const transfer = client.sendFile(filePath)

      await waitFor(() => expect(socket.writes.length).toEqual(1))
      expect(socket.writes[0]?.length).toEqual(64 * 1024)

      socket.backpressured = false
      socket.emit("drain")

      expect(await transfer).toEqual("completed")
      expect(socket.writes.length).toEqual(3)
    } finally {
      await fs.rm(directory, {force: true, recursive: true})
    }
  })

  it("reports file delivery aborts on socket close and read failure", async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), "velocious-file-response-"))
    const filePath = path.join(directory, "large.bin")

    try {
      await fs.writeFile(filePath, Buffer.alloc(128 * 1024, 1))

      const socket = new SlowFakeSocket()
      const client = new ServerClient({clientCount: 5, configuration: buildConfiguration(), socket})
      const transfer = client.sendFile(filePath)

      await waitFor(() => expect(socket.writes.length).toEqual(1))
      socket.emit("close")

      expect(await transfer).toEqual("aborted")
      expect(await client.sendFile(path.join(directory, "missing.bin"))).toEqual("aborted")
    } finally {
      await fs.rm(directory, {force: true, recursive: true})
    }
  })
})
