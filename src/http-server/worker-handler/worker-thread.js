// @ts-check

import Application from "../../application.js"
import Client from "../client/index.js"
import dispatchChannelSubscribers from "./channel-subscriber-dispatch.js"
import {digg} from "diggerize"
import errorLogger from "../../error-logger.js"
import Logger from "../../logger.js"
import toImportSpecifier from "../../utils/to-import-specifier.js"
import WebsocketEvents from "../websocket-events.js"

/**
 * Runs summarize client write chunk.
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
   * Runs constructor.
   * @param {object} args - Options object.
   * @param {import("worker_threads").parentPort} args.parentPort - Parent port.
   * @param {{debug: boolean, directory: string, environment: string, workerCount: number}} args.workerData - Worker configuration details.
   */
  constructor({parentPort, workerData}) {
    if (!parentPort) throw new Error("parentPort is required")

    const {workerCount} = workerData

    /**
     * Narrows the runtime value to the documented type.
     * @type {Record<number, Client>} */
    this.clients = {}

    this.logger = new Logger(this)
    this.parentPort = parentPort
    this.workerData = workerData
    this.workerCount = workerCount
    this.fileTransferCount = 0

    /** @type {Map<number, {clientCount: number, settle: (result: "completed" | "aborted") => Promise<void>}>} */
    this.fileTransfers = new Map()

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
   * Runs initialize.
   * @returns {Promise<void>} - Resolves when complete.
   */
  async initialize() {
    const {debug, directory, environment} = this.workerData
    const configurationPath = `${directory}/src/config/configuration.js`
    const configurationImport = await import(toImportSpecifier(configurationPath))

    /**
     * Narrows the runtime value to the documented type.
     * @type {import("../../configuration.js").default} */
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
   * On command.
   * @param {object} data - Data payload.
   * @param {string} data.command - Command.
   * @param {Buffer | Uint8Array | string} [data.chunk] - Chunk.
   * @param {string} [data.remoteAddress] - Remote address.
   * @param {number} [data.clientCount] - Client count.
   * @param {string} [data.channel] - Channel name.
   * @param {string} [data.createdAt] - Event creation time.
   * @param {string} [data.eventId] - Event identifier.
   * @param {number} [data.requestId] - Debug request id.
   * @param {number} [data.transferId] - File transfer id.
   * @param {"completed" | "aborted"} [data.result] - File transfer result.
   * @param {?} [data.payload] - Payload data.
   * @param {Record<string, ?>} [data.broadcastParams] - V2 broadcast filter params.
   * @param {?} [data.body] - V2 broadcast body.
   */
  onCommand = async (data) => {
    await this.logger.debugLowLevel(() => [`Worker ${this.workerCount} received command`, data])

    const command = data.command

    if (command == "newClient") {
      this.handleNewClient(data)
    } else if (command == "clientWrite") {
      await this.handleClientWrite(data)
    } else if (command == "clientFileResult") {
      await this.handleClientFileResult(data)
    } else if (command == "clientAbort") {
      await this.handleClientAbort(data)
    } else if (command == "websocketEvent") {
      await this.handleWebsocketEvent(data)
    } else if (command == "websocketV2Broadcast") {
      this.handleWebsocketV2Broadcast(data)
    } else if (command == "debugSnapshot") {
      this.handleDebugSnapshot(data)
    } else if (command == "shutdown") {
      await this.handleShutdown()
    } else {
      throw new Error(`Unknown command: ${command}`)
    }
  }

  /**
   * Runs handle new client.
   * @param {object} data - Data payload.
   * @param {number} [data.clientCount] - Client count.
   * @param {string} [data.remoteAddress] - Remote address.
   * @returns {void}
   */
  handleNewClient(data) {
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

    client.events.on("file", ({filePath, sendBody, settle}) => {
      const transferId = ++this.fileTransferCount

      this.fileTransfers.set(transferId, {clientCount, settle})
      this.parentPort.postMessage({command: "clientFile", clientCount, filePath, sendBody, transferId})
    })

    client.events.on("close", (output) => {
      this.logger.debugLowLevel(() => "Close received from client in worker - forwarding to worker parent")
      this.parentPort.postMessage({command: "clientClose", clientCount, output})
    })

    this.clients[clientCount] = client
  }

  /**
   * Settles a file response after the parent finishes socket delivery.
   * @param {object} data - File result message.
   * @param {number} [data.transferId] - File transfer id.
   * @param {"completed" | "aborted"} [data.result] - File transfer result.
   * @returns {Promise<void>} - Resolves after the worker-side completion callback settles.
   */
  async handleClientFileResult(data) {
    const {result, transferId} = data

    if (typeof transferId !== "number") throw new Error("transferId must be a number")
    if (result !== "completed" && result !== "aborted") throw new Error(`Unknown file transfer result: ${result}`)

    const transfer = this.fileTransfers.get(transferId)

    if (!transfer) return

    this.fileTransfers.delete(transferId)
    await transfer.settle(result)
  }

  /**
   * Aborts file responses belonging to a closed parent-side socket.
   * @param {object} data - Client abort message.
   * @param {number} [data.clientCount] - Client count.
   * @returns {Promise<void>} - Resolves after pending completion callbacks settle.
   */
  async handleClientAbort(data) {
    const {clientCount} = data

    if (typeof clientCount !== "number") throw new Error("clientCount must be a number")

    const settlements = []
    const client = this.clients[clientCount]

    if (client) settlements.push(client.abortPendingFileResponses())

    for (const [transferId, transfer] of this.fileTransfers) {
      if (transfer.clientCount !== clientCount) continue

      this.fileTransfers.delete(transferId)
      settlements.push(transfer.settle("aborted"))
    }

    delete this.clients[clientCount]
    await Promise.all(settlements)
  }

  /**
   * Runs handle client write.
   * @param {object} data - Data payload.
   * @param {Buffer | Uint8Array | string} [data.chunk] - Chunk.
   * @param {number} [data.clientCount] - Client count.
   * @returns {Promise<void>} Resolves when the client write is dispatched.
   */
  async handleClientWrite(data) {
    await this.logger.debugLowLevel("Looking up client")

    const {chunk, clientCount} = data
    if (!chunk) throw new Error("No chunk given")
    const client = /** @type {Client | undefined} */ (digg(this.clients, clientCount))

    if (!client) throw new Error(`Client not found for clientWrite: ${clientCount}`)

    const clientChunk = typeof chunk === "string" ? Buffer.from(chunk) : Buffer.from(chunk)

    await this.logger.debug(() => ["Sending clientWrite to parser", {clientCount, ...summarizeClientWriteChunk(clientChunk)}])

    client.onWrite(clientChunk)
  }

  /**
   * Runs handle websocket event.
   * @param {object} data - Data payload.
   * @param {string} [data.channel] - Channel name.
   * @param {string} [data.createdAt] - Event creation time.
   * @param {string} [data.eventId] - Event identifier.
   * @param {?} [data.payload] - Payload data.
   * @returns {Promise<void>} Resolves when the websocket event is dispatched.
   */
  async handleWebsocketEvent(data) {
    const {channel, createdAt, eventId, payload} = data

    if (typeof channel !== "string") throw new Error("No channel given")

    await this.broadcastWebsocketEvent({channel, createdAt, eventId, payload})
  }

  /**
   * Runs handle websocket v2 broadcast.
   * @param {object} data - Data payload.
   * @param {Record<string, ?>} [data.broadcastParams] - V2 broadcast filter params.
   * @param {?} [data.body] - V2 broadcast body.
   * @param {string} [data.channel] - Channel name.
   * @param {string} [data.eventId] - Event identifier.
   * @returns {void}
   */
  handleWebsocketV2Broadcast(data) {
    const {body, broadcastParams, channel, eventId} = data

    if (typeof channel !== "string") throw new Error("No channel given")
    if (!this.configuration) throw new Error("Configuration not initialized")

    this.configuration._broadcastToChannelLocal(channel, broadcastParams || {}, body, {eventId})
  }

  /**
   * Runs handle debug snapshot.
   * @param {object} data - Data payload.
   * @param {number} [data.requestId] - Debug request id.
   * @returns {void}
   */
  handleDebugSnapshot(data) {
    const {requestId} = data

    if (typeof requestId !== "number") throw new Error("debugSnapshot requestId must be a number")
    if (!this.configuration) throw new Error("Configuration not initialized")

    this.parentPort.postMessage({
      command: "debugSnapshot",
      requestId,
      snapshot: this.configuration.getLocalDebugSnapshot()
    })
  }

  /**
   * Runs handle shutdown.
   * @returns {Promise<void>} Resolves after worker shutdown has been requested.
   */
  async handleShutdown() {
    await Promise.all(Object.values(this.clients).map((client) => client.abortPendingFileResponses()))
    this.fileTransfers.clear()

    if (this.configuration?.closeDatabaseConnections) {
      await this.configuration.closeDatabaseConnections()
    }

    this.parentPort.postMessage({command: "shutdownComplete"})
    process.exit(0)
  }

  /**
   * Runs broadcast websocket event.
   * @param {object} args - Options object.
   * @param {string} args.channel - Channel name.
   * @param {string | undefined} args.createdAt - Event creation time.
   * @param {string | undefined} args.eventId - Event identifier.
   * @param {?} args.payload - Payload data.
   * @returns {Promise<void>} - Resolves when complete.
   */
  async broadcastWebsocketEvent({channel, createdAt, eventId, payload}) {
    const sendTasks = []

    for (const clientKey of Object.keys(this.clients)) {
      const client = this.clients[Number(clientKey)]
      if (!client) continue
      const session = client.websocketSession

      if (!session) continue

      sendTasks.push(session.sendEvent(channel, payload, {
        createdAt,
        eventId
      }))
    }

    if (this.configuration) {
      // Isolate channel subscriber failures so a buggy in-process callback
      // cannot reject this command and crash the worker thread, but still
      // surface the error to the framework error events so bug reporters
      // can pick it up.
      sendTasks.push(dispatchChannelSubscribers({channel, configuration: this.configuration, createdAt, eventId, logger: this.logger, payload}))
    }

    await Promise.all(sendTasks)
  }
}
