import Application from "../../application.js"
import Client from "../client/index.js"
import {digg, digs} from "diggerize"
import errorLogger from "../../error-logger.js"
import logger from "../../logger.js"

export default class VelociousHttpServerWorkerHandlerWorkerThread {
  constructor({parentPort, workerData}) {
    const {workerCount} = digs(workerData, "workerCount")

    this.clients = {}
    this.parentPort = parentPort
    this.workerData = workerData
    this.workerCount = workerCount

    parentPort.on("message", errorLogger(this.onCommand))

    this.initialize().then(() => {
      this.application.initialize().then(() => {
        logger(this, `Worker ${workerCount} started`)
        parentPort.postMessage({command: "started"})
      })
    })
  }

  async initialize() {
    const {debug, directory} = digs(this.workerData, "debug", "directory")
    const configurationPath = `${this.workerData.directory}/src/config/configuration.js`
    const configurationImport = await import(configurationPath)

    this.configuration = configurationImport.default
    this.configuration.setCurrent()

    this.application = new Application({configuration: this.configuration, debug, directory})

    if (this.configuration.isInitialized()) {
      await this.configuration.initialize()
    }
  }

  onCommand = async (data) => {
    await logger(this, () => [`Worker ${this.workerCount} received command`, data])

    const command = data.command

    if (command == "newClient") {
      const {clientCount} = digs(data, "clientCount")
      const client = new Client({
        clientCount,
        configuration: this.configuration
      })

      client.events.on("output", (output) => {
        this.parentPort.postMessage({command: "clientOutput", clientCount, output})
      })

      this.clients[clientCount] = client
    } else if (command == "clientWrite") {
      await logger(this, "Looking up client")

      const {chunk, clientCount} = digs(data, "chunk", "clientCount")
      const client = digg(this.clients, clientCount)

      await logger(this, `Sending to client ${clientCount}`)

      client.onWrite(chunk)
    } else {
      throw new Error(`Unknown command: ${command}`)
    }
  }
}
