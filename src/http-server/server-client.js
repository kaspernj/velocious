import EventEmitter from "events"
import logger from "../logger.js"

export default class ServerClient {
  events = new EventEmitter()

  constructor({configuration, socket, clientCount}) {
    if (!configuration) throw new Error("No configuration given")

    this.configuration = configuration
    this.socket = socket
    this.clientCount = clientCount

    socket.on("end", this.onSocketEnd)
  }

  listen = () => this.socket.on("data", this.onSocketData)

  close() {
    return new Promise((resolve, reject) => {
      this.socket.destroy()
      this.events.emit("close", this)
      resolve()
    })
  }

  onSocketData = (chunk) => {
    logger(this, `Socket ${this.clientCount}: ${chunk}`)

    this.worker.postMessage({
      command: "clientWrite",
      chunk,
      clientCount: this.clientCount
    })
  }

  onSocketEnd = () => {
    logger(this, `Socket ${this.clientCount} end`)
    this.events.emit("close", this)
  }

  send(data) {
    logger(this, "Send", data)

    this.socket.write(data)
  }
}
