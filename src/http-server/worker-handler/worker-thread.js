// @ts-check

import Application from "../../application.js"
import Client from "../client/index.js"
import {digg} from "diggerize"
import errorLogger from "../../error-logger.js"
import {Logger} from "../../logger.js"
import WebsocketEvents from "../websocket-events.js"

export default class VelociousHttpServerWorkerHandlerWorkerThread {
  /**
   * @param {object} args - Options object.
   * @param {import("worker_threads").parentPort} args.parentPort - Parent port.
   * @param {{directory: string, environment: string, workerCount: number}} args.workerData - Worker configuration details.
   */
  constructor({parentPort, workerData}) {
    if (!parentPort) throw new Error("parentPort is required")

    const {workerCount} = workerData

    /** @type {Record<number, Client>} */
    this.clients = {}

    this.logger = new Logger(this)
    this.parentPort = parentPort
    this.workerData = workerData
    this.workerCount = workerCount

    parentPort.on("message", errorLogger(this.onCommand))

    this.initialize().then(() => {
      if (!this.application) throw new Error("Application not initialized")

      this.application.initialize().then(() => {
        this.logger.debugLowLevel(() => `Worker ${workerCount} started`)
        parentPort.postMessage({command: "started"})
      })
    })
  }

  /**
   * @returns {Promise<void>} - Resolves when complete.
   */
  async initialize() {
    const {directory, environment} = this.workerData
    const configurationPath = `${directory}/src/config/configuration.js`
    const configurationImport = await import(configurationPath)

    /** @type {import("../../configuration.js").default} */
    this.configuration = configurationImport.default

    if (!this.configuration) throw new Error(`Configuration couldn't be loaded from: ${configurationPath}`)

    this.configuration.setEnvironment(environment)
    this.configuration.setCurrent()
    this.websocketEvents = new WebsocketEvents({parentPort: this.parentPort, workerCount: this.workerCount})
    this.configuration.setWebsocketEvents(this.websocketEvents)

    this.application = new Application({configuration: this.configuration, type: "worker-handler"})

    if (this.configuration.isInitialized()) {
      await this.configuration.initialize({type: "worker-handler"})
    }
  }

  /**
   * @param {object} data - Data payload.
   * @param {string} data.command - Command.
   * @param {string} [data.chunk] - Chunk.
   * @param {string} [data.remoteAddress] - Remote address.
   * @param {number} [data.clientCount] - Client count.
   * @param {string} [data.channel] - Channel name.
   * @param {unknown} [data.payload] - Payload data.
   */
  onCommand = async (data) => {
    await this.logger.debugLowLevel(() => [`Worker ${this.workerCount} received command`, data])

    const command = data.command

    if (command == "newClient") {
      if (!this.configuration) throw new Error("Configuration not initialized")

      const {clientCount, remoteAddress} = data
      const client = new Client({
        clientCount,
        configuration: this.configuration,
        remoteAddress
      })

      client.events.on("output", (output) => {
        this.parentPort.postMessage({command: "clientOutput", clientCount, output})
      })

      client.events.on("close", (output) => {
        this.logger.info("Close received from client in worker - forwarding to worker parent")
        this.parentPort.postMessage({command: "clientClose", clientCount, output})
      })

      this.clients[clientCount] = client
    } else if (command == "clientWrite") {
      await this.logger.debugLowLevel("Looking up client")

      const {chunk, clientCount} = data
      const client = digg(this.clients, clientCount)

      await this.logger.debugLowLevel(`Sending to client ${clientCount}`)

      client.onWrite(chunk)
    } else if (command == "websocketEvent") {
      const {channel, payload} = data

      this.broadcastWebsocketEvent({channel, payload})
    } else {
      throw new Error(`Unknown command: ${command}`)
    }
  }

  /**
   * @param {object} args - Options object.
   * @param {string} args.channel - Channel name.
   * @param {unknown} args.payload - Payload data.
   * @returns {void} - No return value.
   */
  broadcastWebsocketEvent({channel, payload}) {
    for (const clientKey of Object.keys(this.clients)) {
      const client = this.clients[clientKey]

      client.websocketSession?.sendEvent(channel, payload)
    }
  }
}
