// @ts-check

import EventEmitter from "../utils/event-emitter.js"
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
    const errorCode = /**
                       * Narrows the runtime value to the documented type.
                        @type {{code?: string}} */ (error).code

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
      const onWriteError = (/**
                             * Narrows the runtime value to the documented type.
                              @type {Error} */ error) => {
        const errorCode = /**
                           * Narrows the runtime value to the documented type.
                            @type {{code?: string}} */ (error).code

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
   * Runs set worker.
   * @param {import("worker_threads").Worker} newWorker - New worker.
   * @returns {void} - No return value.
   */
  setWorker(newWorker) {
    this.worker = newWorker
  }
}
