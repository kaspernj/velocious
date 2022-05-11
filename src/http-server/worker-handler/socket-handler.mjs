import logger from "../../logger.mjs"

export default class VelociousHttpServerWorkerHandlerSocketHandler {
  constructor({configuration, socket, clientCount, worker}) {
    if (!configuration) throw new Error("No configuration given")

    this.configuration = configuration
    this.socket = socket
    this.clientCount = clientCount
    this.worker = worker

    socket.on("data", this.onSocketData)
    socket.on("end", this.onSocketEnd)
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
  }

  send(data) {
    logger(this, "Send", data)

    this.socket.write(data)
  }
}
