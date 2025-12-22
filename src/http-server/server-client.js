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
    this.logger.debug(() => [`Socket ${this.clientCount}: ${chunk}`])

    if (!this.worker) throw new Error("No worker")

    this.worker.postMessage({
      command: "clientWrite",
      chunk,
      clientCount: this.clientCount
    })
  }

  /** @returns {void} */
  onSocketEnd = () => {
    this.logger.debug(`Socket ${this.clientCount} end`)
    this.events.emit("close", this)
  }

  /**
   * @param {string} data
   * @returns {Promise<void>}
   */
  async send(data) {
    return new Promise((resolve) => {
      this.logger.debug("Send", data)
      this.socket.write(data, () => {
        resolve()
      })
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
