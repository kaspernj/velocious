import Application from "../../application.mjs"
import Client from "../client/index.mjs"
import DatabasePool from "../../database/pool/index.mjs"
import {digg, digs} from "diggerize"
import errorLogger from "../../error-logger.mjs"
import logger from "../../logger.mjs"

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
    const configurationPath = `${this.workerData.directory}/src/config/configuration.mjs`
    const configurationImport = await import(configurationPath)
    const configuration = configurationImport.default

    this.application = new Application({configuration, debug, directory})

    this.configuration = configuration
    this.configuration.setCurrent()
  }

  onCommand = (data) => {
    logger(this, `Worker ${this.workerCount} received command`, data)

    const {command} = data

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
      const {chunk, clientCount} = digs(data, "chunk", "clientCount")
      const client = digg(this.clients, clientCount)

      client.onWrite(chunk)
    } else {
      throw new Error(`Unknown command: ${command}`)
    }
  }
}
