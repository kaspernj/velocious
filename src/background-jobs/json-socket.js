// @ts-check

import EventEmitter from "../utils/event-emitter.js"

export default class JsonSocket extends EventEmitter {
  /**
   * @param {import("net").Socket} socket - Socket instance.
   */
  constructor(socket) {
    super()
    this.socket = socket
    /** @type {string | undefined} */
    this.workerId = undefined
    this.buffer = ""
    this.socket.setEncoding("utf8")
    this.socket.on("data", (chunk) => this._onData(String(chunk)))
    this.socket.on("close", () => this.emit("close"))
    this.socket.on("error", (error) => this.emit("error", error))
  }

  /**
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
   * @param {unknown} message - Message to send.
   * @returns {void}
   */
  send(message) {
    this.socket.write(`${JSON.stringify(message)}\n`)
  }

  /**
   * @returns {void}
   */
  close() {
    this.socket.end()
  }
}
