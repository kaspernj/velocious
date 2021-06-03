const Client = require("../client/index.cjs")
const {digg, digs} = require("@kaspernj/object-digger")
const errorLogger = require("../../error-logger")
const logger = require("../../logger.cjs")

module.exports = class VelociousHttpServerWorkerHandlerWorkerThread {
  constructor({parentPort, workerData}) {
    const {workerCount} = digs(workerData, "workerCount")

    this.clients = {}
    this.debug = workerData.debug
    this.parentPort = parentPort
    this.workerCount = workerCount

    parentPort.on("message", errorLogger((data) => this.onCommand(data)))

    logger(this, `Worker ${workerCount} started`)

    parentPort.postMessage({command: "started"})
  }

  onCommand(data) {
    logger(this, `Worker ${this.workerCount} received command`, data)

    const {command} = data

    if (command == "newClient") {
      const {clientCount} = digs(data, "clientCount")
      const client = new Client({
        clientCount,
        debug: this.debug
      })

      client.events.on("output", (output) => {
        this.parentPort.postMessage({command: "clientOutput", clientCount, output})
      })

      this.clients[clientCount] = client
    } else if (command == "clientWrite") {
      const {chunk, clientCount} = digs(data, "chunk", "clientCount")
      const client = digg(this.clients, clientCount)

      client.onWrite(chunk)
    } else {
      throw new Error(`Unknown command: ${command}`)
    }
  }
}
