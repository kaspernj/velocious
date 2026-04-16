// @ts-check

import Logger from "../../logger.js"
import {Worker} from "worker_threads"
import ensureError from "../../utils/ensure-error.js"
import websocketEventsHost from "../websocket-events-host.js"

/**
 * @param {object} data - Worker message payload.
 * @param {string} data.command - Command name.
 * @param {number} [data.clientCount] - Client count.
 * @param {string | Uint8Array} [data.output] - Output chunk.
 * @returns {object} - Log-safe message details.
 */
function summarizeWorkerMessage(data) {
  const {output, ...rest} = data

  if (output === undefined) {
    return rest
  }

  const outputType = typeof output
  const outputLength = typeof output === "string"
    ? output.length
    : (output instanceof Uint8Array ? output.byteLength : undefined)

  return {
    ...rest,
    output: {
      length: outputLength,
      type: outputType
    }
  }
}

export default class VelociousHttpServerWorker {
  /**
   * @param {object} args - Options object.
   * @param {import("../../configuration.js").default} args.configuration - Configuration instance.
   * @param {number} args.workerCount - Worker count.
   */
  constructor({configuration, workerCount}) {
    this.configuration = configuration

    /** @type {Record<number, import("../server-client.js").default>} */
    this.clients = {}

    this.logger = new Logger(this)
    this.workerCount = workerCount
    this.unregisterFromEventsHost = websocketEventsHost.register(this)
    this._stopping = false
  }

  start() {
    return new Promise((resolve) => {
      this.onStartCallback = resolve
      this._spawnWorker()
    })
  }

  async _spawnWorker() {
    const debug = this.configuration.debug
    const directory = this.configuration.getDirectory()
    const velociousPath = await this.configuration.getEnvironmentHandler().getVelociousPath()

    this.worker = new Worker(`${velociousPath}/src/http-server/worker-handler/worker-script.js`, {
      workerData: {
        debug,
        directory,
        environment: this.configuration.getEnvironment(),
        workerCount: this.workerCount
      }
    })
    this.worker.on("error", this.onWorkerError)
    this.worker.on("exit", this.onWorkerExit)
    this.worker.on("message", this.onWorkerMessage)
  }

  /**
   * @param {import("../server-client.js").default} client - Client instance.
   * @returns {void} - No return value.
   */
  addSocketConnection(client) {
    const clientCount = client.clientCount

    if (!this.worker) throw new Error("Worker not initialized")

    client.setWorker(this.worker)
    client.listen()

    this.clients[clientCount] = client
    this.worker.postMessage({command: "newClient", clientCount, remoteAddress: client.remoteAddress})
  }

  /**
   * @param {any} error - Error instance.
   */
  onWorkerError = (error) => {
    this.logger.error(`Velocious worker ${this.workerCount} error`, error)
    void this._closeAllClients()
    throw ensureError(error) // Throws original error with backtrace and everything into the console
  }

  /**
   * @param {number} code - Code.
   * @returns {void} - No return value.
   */
  onWorkerExit = (code) => {
    this._hasExited = true

    if (code !== 0 && !this._stopping) {
      this.logger.error(`Velocious worker ${this.workerCount} exited unexpectedly with code ${code}`)
      void this._closeAllClients()
      throw new Error(`Client worker stopped with exit code ${code}`)
    } else {
      this.logger.debug(() => `Client worker stopped with exit code ${code}`)
    }

    this.unregisterFromEventsHost?.()
    this._stopResolve?.()
    this._stopResolve = null
  }

  /**
   * @returns {void} - No return value.
   */
  _closeAllClients() {
    const clients = Object.values(this.clients)
    this.clients = {}

    for (const client of clients) {
      try {
        void client.end()
      } catch (error) {
        this.logger.warn("Failed to close client after worker exit", error)
      }
    }
  }

  /**
   * @param {object} data - Data payload.
   * @param {string} data.command - Command.
   * @param {number} [data.clientCount] - Client count.
   * @param {string | Uint8Array} [data.output] - Output.
   * @param {string} [data.channel] - Channel name.
   * @param {any} [data.payload] - Payload data.
   * @param {Record<string, any>} [data.broadcastParams] - V2 broadcast filter params.
   * @param {any} [data.body] - V2 broadcast body.
   * @returns {void} - No return value.
   */
  onWorkerMessage = (data) => {
    this.logger.debug("Worker message", summarizeWorkerMessage(data))

    const {command} = data


    if (command == "started") {
      if (this.onStartCallback) {
        this.onStartCallback(null)
      }

      this.onStartCallback = null
    } else if (command == "clientOutput") {
      this.logger.debug("CLIENT OUTPUT", summarizeWorkerMessage(data))

      const {clientCount, output} = data
      const client = typeof clientCount === "number" ? this.clients[clientCount] : undefined

      if (!client) {
        this.logger.warn(() => [`Velocious worker ${this.workerCount} produced output for missing client ${clientCount}`, data])
        return
      }

      if (output !== null && output !== undefined) {
        const outputLength = typeof output === "string" ? output.length : output.byteLength

        void client.send(output).then(() => {
          this.logger.debug(() => ["Client output delivered", {
            clientCount,
            outputLength,
            workerCount: this.workerCount
          }])
        }).catch((error) => {
          this.logger.error(() => ["Failed to deliver client output", {
            clientCount,
            workerCount: this.workerCount
          }, error])
        })
      }
    } else if (command == "clientClose") {
      const {clientCount} = data
      const client = typeof clientCount === "number" ? this.clients[clientCount] : undefined

      if (!client) {
        this.logger.error(() => [`Velocious worker ${this.workerCount} requested close for missing client ${clientCount}`, data])
        return
      }

      void client.end()

      if (typeof clientCount === "number") {
        delete this.clients[clientCount]
      }
    } else if (command == "shutdownComplete") {
      this._stopResolve?.()
      this._stopResolve = null
    } else if (command == "websocketPublish") {
      const {channel, payload} = data

      if (typeof channel !== "string") {
        throw new Error("Worker websocket publish channel must be a string")
      }

      websocketEventsHost.publish({channel, payload})
    } else if (command == "websocketV2Broadcast") {
      const {body, broadcastParams, channel} = data

      if (typeof channel !== "string") {
        throw new Error("Worker websocket v2-broadcast channel must be a string")
      }

      websocketEventsHost.broadcastV2({body, broadcastParams: broadcastParams || {}, channel})
    } else {
      throw new Error(`Unknown command: ${command}`)
    }
  }

  /**
   * @returns {Promise<void>} - Resolves when stopped.
   */
  stop() {
    if (!this.worker) return Promise.resolve()
    if (this._hasExited) return Promise.resolve()

    this._stopping = true
    const worker = this.worker

    if (!worker) return Promise.resolve()

    return new Promise((resolve) => {
      this._stopResolve = resolve
      worker.postMessage({command: "shutdown"})
    })
  }

  /**
   * @param {object} args - Options object.
   * @param {string} args.channel - Channel name.
   * @param {string} [args.createdAt] - Event creation time.
   * @param {string} [args.eventId] - Event identifier.
   * @param {any} args.payload - Payload data.
   * @returns {void} - No return value.
   */
  dispatchWebsocketEvent({channel, createdAt, eventId, payload}) {
    // Test and shutdown paths can leave a registered handler without a live worker-thread transport.
    if (!this.worker || typeof this.worker.postMessage !== "function") return

    this.worker.postMessage({channel, command: "websocketEvent", createdAt, eventId, payload})
  }

  /**
   * Forwards a V2 channel broadcast to this worker's thread so it can
   * dispatch to any locally-registered V2 subscriptions.
   *
   * @param {object} args - Options object.
   * @param {string} args.channel - Channel name.
   * @param {Record<string, any>} args.broadcastParams - Routing filter params.
   * @param {any} args.body - Message body.
   * @returns {void}
   */
  dispatchWebsocketV2Broadcast({body, broadcastParams, channel}) {
    if (!this.worker || typeof this.worker.postMessage !== "function") return

    this.worker.postMessage({body, broadcastParams, channel, command: "websocketV2Broadcast"})
  }
}
