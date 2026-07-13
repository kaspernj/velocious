// @ts-check

import EventEmitter from "../utils/event-emitter.js"
import {createReadStream} from "node:fs"
import Logger from "../logger.js"

/**
 * Runs summarize socket chunk.
 * @param {Buffer} chunk - Incoming socket data.
 * @returns {object} - Chunk debug metadata.
 */
function summarizeSocketChunk(chunk) {
  const preview = chunk.toString("latin1", 0, Math.min(chunk.length, 160)).replaceAll("\r", "\\r").replaceAll("\n", "\\n")

  return {
    length: chunk.length,
    preview
  }
}

export default class ServerClient {
  events = new EventEmitter()

  /**
   * Runs constructor.
   * @param {object} args - Options object.
   * @param {import("../configuration.js").default} args.configuration - Configuration instance.
   * @param {import("net").Socket} args.socket - Socket instance.
   * @param {number} args.clientCount - Client count.
   */
  constructor({configuration, socket, clientCount}) {
    if (!configuration) throw new Error("No configuration given")

    this.configuration = configuration
    this.logger = new Logger(this)
    this.socket = socket
    this.clientCount = clientCount
    this.remoteAddress = socket.remoteAddress
    this.closeEmitted = false

    socket.on("end", this.onSocketEnd)
    socket.on("error", this.onSocketError)
    socket.on("close", this.onSocketClose)
    socket.on("timeout", this.onSocketTimeout)
    socket.on("drain", this.onSocketDrain)
    socket.on("finish", this.onSocketFinish)
  }

  /**
   * Runs listen.
   * @returns {void} - No return value.
   */
  listen() {
    this.logger.debug(() => ["Socket listen", {
      clientCount: this.clientCount,
      remoteAddress: this.socket.remoteAddress,
      remoteFamily: this.socket.remoteFamily,
      remotePort: this.socket.remotePort
    }])
    this.socket.on("data", this.onSocketData)
  }

  /**
   * Runs end.
   * @returns {Promise<void>} - Resolves when complete.
   */
  end() {
    return new Promise((resolve) => {
      if (this.socket.destroyed || this.socket.writableEnded || this.socket.writable === false) {
        resolve(undefined)
        return
      }

      this.socket.once("close", () => resolve(undefined))
      this.socket.end()
    })
  }

  /**
   * On socket data.
   * @param {Buffer} chunk - Chunk.
   * @returns {void} - No return value.
   */
  onSocketData = (chunk) => {
    this.logger.debugLowLevel(() => `Socket ${this.clientCount}: ${chunk}`)
    this.logger.debug(() => ["Socket data received", {clientCount: this.clientCount, ...summarizeSocketChunk(chunk)}])

    if (!this.worker) throw new Error("No worker")

    this.worker.postMessage({
      command: "clientWrite",
      chunk,
      clientCount: this.clientCount
    })
  }

  /**
   * On socket end.
   * @returns {void} - No return value.
   */
  onSocketEnd = () => {
    this.logger.debugLowLevel(() => `Socket ${this.clientCount} end`)
    this.emitClose()
  }

  /**
   * On socket close.
   * @returns {void} - No return value.
   */
  onSocketClose = () => {
    this.logger.debugLowLevel(() => `Socket ${this.clientCount} close`)
    this.emitClose()
  }

  /**
   * On socket timeout.
   * @returns {void} - No return value.
   */
  onSocketTimeout = () => {
    this.logger.debug(() => ["Socket timeout", {clientCount: this.clientCount}])
  }

  /**
   * On socket drain.
   * @returns {void} - No return value.
   */
  onSocketDrain = () => {
    this.logger.debug(() => ["Socket drain", {clientCount: this.clientCount}])
  }

  /**
   * On socket finish.
   * @returns {void} - No return value.
   */
  onSocketFinish = () => {
    this.logger.debug(() => ["Socket finish", {clientCount: this.clientCount}])
  }


  /**
   * On socket error.
   * @param {Error} error - Socket error.
   * @returns {void} - No return value.
   */
  onSocketError = (error) => {
    const errorCode = /** @type {{code?: string}} */ (error).code

    this.logger.error(() => [`Socket ${this.clientCount} error`, errorCode || error.message])
    this.emitClose()

    if (!this.socket.destroyed) {
      this.socket.destroy(error)
    }
  }

  /**
   * Runs emit close.
   * @returns {void} - No return value.
   */
  emitClose() {
    if (this.closeEmitted) return

    this.closeEmitted = true
    this.events.emit("close", this)
  }

  /**
   * Runs send.
   * @param {string | Uint8Array} data - Data payload.
   * @returns {Promise<void>} - Resolves when complete.
   */
  async send(data) {
    return new Promise((resolve) => {
      this.logger.debugLowLevel(() => `Send ${data}`)
      if (this.socket.destroyed || this.socket.writableEnded || this.socket.writable === false) {
        this.logger.debugLowLevel(() => "Skipping send because socket is closed")
        resolve()
        return
      }

      let done = false

      const finish = () => {
        if (done) return

        done = true
        this.socket.off("error", onWriteError)
        resolve()
      }
      const onWriteError = (/** @type {Error} */ error) => {
        const errorCode = /** @type {{code?: string}} */ (error).code

        this.logger.error(() => [`Socket ${this.clientCount} write error`, errorCode || error.message])
        finish()
      }

      this.socket.once("error", onWriteError)
      this.socket.write(data, (error) => {
        if (error) {
          onWriteError(error)
          return
        }

        finish()
      })
    })
  }

  /**
   * Streams a file to the socket while respecting socket write backpressure.
   * @param {string} filePath - File path.
   * @param {boolean} [sendBody] - Whether to read and send the file body.
   * @returns {Promise<"completed" | "aborted">} - Transfer result.
   */
  async sendFile(filePath, sendBody = true) {
    if (this.socket.destroyed || this.socket.writableEnded || this.socket.writable === false) return "aborted"
    if (!sendBody) return "completed"

    const readStream = createReadStream(filePath)
    let aborted = false
    const abort = () => {
      aborted = true
      readStream.destroy()
    }

    this.socket.once("close", abort)
    this.socket.once("error", abort)

    try {
      for await (const chunk of readStream) {
        if (aborted || !await this.writeFileChunk(chunk)) return "aborted"
      }

      return aborted ? "aborted" : "completed"
    } catch (error) {
      this.logger.error(() => [`Socket ${this.clientCount} file response failed`, filePath, error])
      return "aborted"
    } finally {
      this.socket.off("close", abort)
      this.socket.off("error", abort)
      readStream.destroy()
    }
  }

  /**
   * Writes one file chunk and waits for both write acceptance and drain when required.
   * @param {Buffer | Uint8Array} chunk - File chunk.
   * @returns {Promise<boolean>} - Whether the chunk was accepted before the socket aborted.
   */
  writeFileChunk(chunk) {
    return new Promise((resolve) => {
      let callbackCompleted = false
      let drained = false
      let settled = false

      const cleanup = () => {
        this.socket.off("close", onAbort)
        this.socket.off("error", onAbort)
        this.socket.off("drain", onDrain)
      }
      const finish = (/** @type {boolean} */ result) => {
        if (settled) return

        settled = true
        cleanup()
        resolve(result)
      }
      const finishIfReady = () => {
        if (callbackCompleted && drained) finish(true)
      }
      const onAbort = () => finish(false)
      const onDrain = () => {
        drained = true
        finishIfReady()
      }

      this.socket.once("close", onAbort)
      this.socket.once("error", onAbort)
      this.socket.once("drain", onDrain)

      try {
        const accepted = this.socket.write(chunk, (error) => {
          if (error) {
            finish(false)
            return
          }

          callbackCompleted = true
          finishIfReady()
        })

        drained = accepted
        if (accepted) this.socket.off("drain", onDrain)
        finishIfReady()
      } catch (error) {
        this.logger.error(() => [`Socket ${this.clientCount} file write failed`, error])
        finish(false)
      }
    })
  }

  /**
   * Runs set worker.
   * @param {import("worker_threads").Worker} newWorker - New worker.
   * @returns {void} - No return value.
   */
  setWorker(newWorker) {
    this.worker = newWorker
  }
}
