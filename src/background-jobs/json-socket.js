// @ts-check

import EventEmitter from "../utils/event-emitter.js"

export default class JsonSocket extends EventEmitter {
  /**
   * Runs constructor.
   * @param {import("net").Socket} socket - Socket instance.
   */
  constructor(socket) {
    super()
    this.socket = socket
    /**
     * Narrows the runtime value to the documented type.
      @type {string | undefined} */
    this.workerId = undefined
    /**
     * Narrows the runtime value to the documented type.
      @type {boolean} */
    this.acceptsSpawnedJobs = true
    /**
     * Narrows the runtime value to the documented type.
      @type {boolean} */
    this.acceptsForkedJobs = true
    /**
     * Narrows the runtime value to the documented type.
      @type {boolean} */
    this.acceptsInlineJobs = true
    this.buffer = ""
    this.socket.setEncoding("utf8")
    this.socket.on("data", (chunk) => this._onData(String(chunk)))
    this.socket.on("close", () => this.emit("close"))
    this.socket.on("error", (error) => this.emit("error", error))
  }

  /**
   * Runs on data.
   * @param {string} chunk - Data chunk.
   * @returns {void}
   */
  _onData(chunk) {
    this.buffer += chunk

    while (true) {
      const newlineIndex = this.buffer.indexOf("\n")
      if (newlineIndex === -1) break

      const line = this.buffer.slice(0, newlineIndex).trim()
      this.buffer = this.buffer.slice(newlineIndex + 1)

      if (!line) continue

      try {
        const message = JSON.parse(line)
        this.emit("message", message)
      } catch (error) {
        this.emit("error", error)
      }
    }
  }

  /**
   * Runs send.
   * @param {?} message - Message to send.
   * @returns {void}
   */
  send(message) {
    this.socket.write(`${JSON.stringify(message)}\n`)
  }

  /**
   * Runs close.
   * @returns {void}
   */
  close() {
    this.socket.end()
  }
}
