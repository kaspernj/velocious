// @ts-check

import Application from "../../application.js"
import Client from "../client/index.js"
import {digg} from "diggerize"
import errorLogger from "../../error-logger.js"
import Logger from "../../logger.js"
import toImportSpecifier from "../../utils/to-import-specifier.js"
import WebsocketEvents from "../websocket-events.js"

/**
 * @param {Buffer | Uint8Array | string} chunk - Client input payload.
 * @returns {{length: number, preview: string}} - Chunk summary for logging.
 */
function summarizeClientWriteChunk(chunk) {
  const normalizedChunk = typeof chunk === "string" ? Buffer.from(chunk) : Buffer.from(chunk)
  const preview = normalizedChunk.toString("latin1", 0, Math.min(normalizedChunk.length, 160)).replaceAll("\r", "\\r").replaceAll("\n", "\\n")

  return {length: normalizedChunk.length, preview}
}

export default class VelociousHttpServerWorkerHandlerWorkerThread {
  /**
   * @param {object} args - Options object.
   * @param {import("worker_threads").parentPort} args.parentPort - Parent port.
   * @param {{debug: boolean, directory: string, environment: string, workerCount: number}} args.workerData - Worker configuration details.
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
    const {debug, directory, environment} = this.workerData
    const configurationPath = `${directory}/src/config/configuration.js`
    const configurationImport = await import(toImportSpecifier(configurationPath))

    /** @type {import("../../configuration.js").default} */
    this.configuration = configurationImport.default

    if (!this.configuration) throw new Error(`Configuration couldn't be loaded from: ${configurationPath}`)

    const configuration = this.configuration

    configuration.debug = debug === true
    configuration.setEnvironment(environment)
    configuration.setCurrent()
    await this.logger.debug(() => ["Worker thread configuration loaded", {debug: configuration.debug, workerCount: this.workerCount}])
    this.websocketEvents = new WebsocketEvents({parentPort: this.parentPort, workerCount: this.workerCount})
    configuration.setWebsocketEvents(this.websocketEvents)

    this.application = new Application({configuration, type: "worker-handler"})

    if (!configuration.isInitialized()) {
      await configuration.initialize({type: "worker-handler"})
    }
  }

  /**
   * @param {object} data - Data payload.
   * @param {string} data.command - Command.
   * @param {Buffer | Uint8Array | string} [data.chunk] - Chunk.
   * @param {string} [data.remoteAddress] - Remote address.
   * @param {number} [data.clientCount] - Client count.
   * @param {string} [data.channel] - Channel name.
   * @param {any} [data.payload] - Payload data.
   */
  onCommand = async (data) => {
    await this.logger.debugLowLevel(() => [`Worker ${this.workerCount} received command`, data])

    const command = data.command

    if (command == "newClient") {
      if (!this.configuration) throw new Error("Configuration not initialized")

      const {clientCount, remoteAddress} = data

      if (typeof clientCount !== "number") throw new Error("clientCount must be a number")

      const client = new Client({
        clientCount,
        configuration: this.configuration,
        remoteAddress
      })

      client.events.on("output", (output) => {
        this.parentPort.postMessage({command: "clientOutput", clientCount, output})
      })

      client.events.on("close", (output) => {
        this.logger.debugLowLevel(() => "Close received from client in worker - forwarding to worker parent")
        this.parentPort.postMessage({command: "clientClose", clientCount, output})
      })

      this.clients[clientCount] = client
    } else if (command == "clientWrite") {
      await this.logger.debugLowLevel("Looking up client")

      const {chunk, clientCount} = data
      if (!chunk) throw new Error("No chunk given")
      const client = /** @type {Client | undefined} */ (digg(this.clients, clientCount))

      if (!client) throw new Error(`Client not found for clientWrite: ${clientCount}`)

      const clientChunk = typeof chunk === "string" ? Buffer.from(chunk) : Buffer.from(chunk)

      await this.logger.debug(() => ["Sending clientWrite to parser", {clientCount, ...summarizeClientWriteChunk(clientChunk)}])

      client.onWrite(clientChunk)
    } else if (command == "websocketEvent") {
      const {channel, payload} = data

      if (typeof channel !== "string") throw new Error("No channel given")

      await this.broadcastWebsocketEvent({channel, payload})
    } else if (command == "shutdown") {
      if (this.configuration?.closeDatabaseConnections) {
        await this.configuration.closeDatabaseConnections()
      }

      this.parentPort.postMessage({command: "shutdownComplete"})
      process.exit(0)
    } else {
      throw new Error(`Unknown command: ${command}`)
    }
  }

  /**
   * @param {object} args - Options object.
   * @param {string} args.channel - Channel name.
   * @param {any} args.payload - Payload data.
   * @returns {Promise<void>} - Resolves when complete.
   */
  async broadcastWebsocketEvent({channel, payload}) {
    const sendTasks = []

    for (const clientKey of Object.keys(this.clients)) {
      const client = this.clients[Number(clientKey)]
      if (!client) continue
      const session = client.websocketSession

      if (!session) continue

      sendTasks.push(session.sendEvent(channel, payload))
    }

    await Promise.all(sendTasks)
  }
}
