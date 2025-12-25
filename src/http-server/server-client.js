// @ts-check

import EventEmitter from "events"
import {Logger} from "../logger.js"

export default class ServerClient {
  events = new EventEmitter()

  /**
   * @param {object} args
   * @param {import("../configuration.js").default} args.configuration
   * @param {import("net").Socket} args.socket
   * @param {number} args.clientCount
   */
  constructor({configuration, socket, clientCount}) {
    if (!configuration) throw new Error("No configuration given")

    this.configuration = configuration
    this.logger = new Logger(this)
    this.socket = socket
    this.clientCount = clientCount
    this.remoteAddress = socket.remoteAddress

    socket.on("end", this.onSocketEnd)
  }

  /** @returns {void} */
  listen() {
    this.socket.on("data", this.onSocketData)
  }

  /** @returns {Promise<void>} */
  end() {
    return new Promise((resolve) => {
      this.socket.once("close", () => resolve(null))
      this.socket.end()
    })
  }

  /**
   * @param {Buffer} chunk
   * @returns {void}
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

  /** @returns {void} */
  onSocketEnd = () => {
    this.logger.debugLowLevel(() => `Socket ${this.clientCount} end`)
    this.events.emit("close", this)
  }

  /**
   * @param {string} data
   * @returns {Promise<void>}
   */
  async send(data) {
    return new Promise((resolve) => {
      this.logger.debugLowLevel(() => `Send ${data}`)
      if (this.socket.destroyed || this.socket.writableEnded || this.socket.writable === false) {
        this.logger.debugLowLevel(() => "Skipping send because socket is closed")
        resolve()
        return
      }

      this.socket.write(data, () => resolve())
    })
  }

  /**
   * @param {import("worker_threads").Worker} newWorker
   * @returns {void}
   */
  setWorker(newWorker) {
    this.worker = newWorker
  }
}
