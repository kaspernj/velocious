// @ts-check

import EventEmitter from "../utils/event-emitter.js"
import Logger from "../logger.js"

export default class ServerClient {
  events = new EventEmitter()

  /**
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
  }

  /** @returns {void} - No return value.  */
  listen() {
    this.socket.on("data", this.onSocketData)
  }

  /** @returns {Promise<void>} - Resolves when complete.  */
  end() {
    return new Promise((resolve) => {
      if (this.socket.destroyed || this.socket.writableEnded || this.socket.writable === false) {
        resolve(null)
        return
      }

      this.socket.once("close", () => resolve(null))
      this.socket.end()
    })
  }

  /**
   * @param {Buffer} chunk - Chunk.
   * @returns {void} - No return value.
   */
  onSocketData = (chunk) => {
    this.logger.debugLowLevel(() => `Socket ${this.clientCount}: ${chunk}`)

    if (!this.worker) throw new Error("No worker")

    this.worker.postMessage({
      command: "clientWrite",
      chunk,
      clientCount: this.clientCount
    })
  }

  /** @returns {void} - No return value.  */
  onSocketEnd = () => {
    this.logger.debugLowLevel(() => `Socket ${this.clientCount} end`)
    this.emitClose()
  }

  /** @returns {void} - No return value. */
  onSocketClose = () => {
    this.logger.debugLowLevel(() => `Socket ${this.clientCount} close`)
    this.emitClose()
  }

  /**
   * @param {Error} error - Socket error.
   * @returns {void} - No return value.
   */
  onSocketError = (error) => {
    const errorCode = /** @type {{code?: string}} */ (error).code

    console.error(`Socket ${this.clientCount} error`, error)
    this.logger.error(() => [`Socket ${this.clientCount} error`, errorCode || error.message])
    this.emitClose()

    if (!this.socket.destroyed) {
      this.socket.destroy(error)
    }
  }

  /** @returns {void} - No return value. */
  emitClose() {
    if (this.closeEmitted) return

    this.closeEmitted = true
    this.events.emit("close", this)
  }

  /**
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
      const onWriteError = (error) => {
        const errorCode = /** @type {{code?: string}} */ (error).code

        console.error(`Socket ${this.clientCount} write error`, error)
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
   * @param {import("worker_threads").Worker} newWorker - New worker.
   * @returns {void} - No return value.
   */
  setWorker(newWorker) {
    this.worker = newWorker
  }
}
