import EventEmitter from "events"
import {Logger} from "../logger.js"

export default class ServerClient {
  events = new EventEmitter()

  constructor({configuration, socket, clientCount}) {
    if (!configuration) throw new Error("No configuration given")

    this.configuration = configuration
    this.logger = new Logger(this)
    this.socket = socket
    this.clientCount = clientCount

    socket.on("end", this.onSocketEnd)
  }

  listen = () => this.socket.on("data", this.onSocketData)

  close() {
    this.socket.destroy()
    this.events.emit("close", this)
  }

  onSocketData = (chunk) => {
    this.logger.debug(() => [`Socket ${this.clientCount}: ${chunk}`])

    this.worker.postMessage({
      command: "clientWrite",
      chunk,
      clientCount: this.clientCount
    })
  }

  onSocketEnd = () => {
    this.logger.debug(`Socket ${this.clientCount} end`)
    this.events.emit("close", this)
  }

  send(data) {
    this.logger.debug("Send", data)
    this.socket.write(data)
  }
}
