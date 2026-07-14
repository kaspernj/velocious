// @ts-check

import {ensureError} from "typanic"
import Logger from "../../logger.js"
import {Worker} from "worker_threads"
import websocketEventsHost from "../websocket-events-host.js"

/**
 * Runs summarize worker message.
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
   * Runs constructor.
   * @param {object} args - Options object.
   * @param {import("../../configuration.js").default} args.configuration - Configuration instance.
   * @param {number} args.workerCount - Worker count.
   */
  constructor({configuration, workerCount}) {
    this.configuration = configuration

    /**
     * Narrows the runtime value to the documented type.
     * @type {Record<number, import("../server-client.js").default>} */
    this.clients = {}

    this.logger = new Logger(this)
    this.workerCount = workerCount
    this.workerStarted = false
    this._stopping = false
    this._debugRequestId = 0
    /**
     * Narrows the runtime value to the documented type.
     * @type {Map<number, {resolve: (snapshot: Record<string, ?>) => void}>} */
    this._debugSnapshotRequests = new Map()

    /** @type {Map<number, Promise<void>>} */
    this._clientDeliveryQueues = new Map()
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
   * Runs add socket connection.
   * @param {import("../server-client.js").default} client - Client instance.
   * @returns {void} - No return value.
   */
  addSocketConnection(client) {
    const clientCount = client.clientCount

    if (!this.worker) throw new Error("Worker not initialized")

    client.setWorker(this.worker)
    client.listen()

    this.clients[clientCount] = client
    client.events.on("close", () => {
      this.handleClientAbort(clientCount)
    })
    this.worker.postMessage({command: "newClient", clientCount, remoteAddress: client.remoteAddress})
  }

  /**
   * Propagates a parent-side socket close and clears all parent state for the client.
   * @param {number} clientCount - Client count.
   * @returns {void}
   */
  handleClientAbort(clientCount) {
    if (!this.clients[clientCount] && !this._clientDeliveryQueues.has(clientCount)) return

    delete this.clients[clientCount]
    this._clientDeliveryQueues.delete(clientCount)
    this.worker?.postMessage({command: "clientAbort", clientCount})
  }

  /**
   * On worker error.
   * @param {?} error - Error instance.
   */
  onWorkerError = (error) => {
    this.logger.error(`Velocious worker ${this.workerCount} error`, error)
    void this._closeAllClients()
    // Preserve Error instances for the original backtrace while wrapping non-Error throwables.
    throw ensureError(error)
  }

  /**
   * On worker exit.
   * @param {number} code - Code.
   * @returns {void} - No return value.
   */
  onWorkerExit = (code) => {
    this._hasExited = true
    this.workerStarted = false
    this._closeAllClients()

    if (code !== 0 && !this._stopping) {
      this.logger.error(`Velocious worker ${this.workerCount} exited unexpectedly with code ${code}`)
      throw new Error(`Client worker stopped with exit code ${code}`)
    } else {
      this.logger.debug(() => `Client worker stopped with exit code ${code}`)
    }

    this.unregisterFromEventsHostIfNeeded()
    if (this._stopResolve) {
      this._stopResolve()
    }
    this._stopResolve = null
  }

  /**
   * Runs close all clients.
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
   * On worker message.
   * @param {object} data - Data payload.
   * @param {string} data.command - Command.
   * @param {number} [data.clientCount] - Client count.
   * @param {string | Uint8Array} [data.output] - Output.
   * @param {string} [data.filePath] - File path.
   * @param {boolean} [data.sendBody] - Whether to send the file body.
   * @param {number} [data.transferId] - File transfer id.
   * @param {string} [data.channel] - Channel name.
   * @param {number} [data.requestId] - Debug request id.
   * @param {Record<string, ?>} [data.snapshot] - Worker debug snapshot.
   * @param {?} [data.payload] - Payload data.
   * @param {Record<string, ?>} [data.broadcastParams] - V2 broadcast filter params.
   * @param {?} [data.body] - V2 broadcast body.
   * @returns {void} - No return value.
   */
  onWorkerMessage = (data) => {
    this.logger.debug("Worker message", summarizeWorkerMessage(data))

    const {command} = data


    if (command == "started") {
      this.workerStarted = true
      this.registerWithEventsHost()

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

        void this.enqueueClientDelivery(client.clientCount, () => client.send(output)).then(() => {
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
    } else if (command == "clientFile") {
      const {clientCount, filePath, sendBody, transferId} = data
      const client = typeof clientCount === "number" ? this.clients[clientCount] : undefined

      if (typeof transferId !== "number") throw new Error("clientFile transferId must be a number")

      if (!client || typeof filePath !== "string") {
        this.worker?.postMessage({command: "clientFileResult", result: "aborted", transferId})
        return
      }

      void this.enqueueClientDelivery(client.clientCount, async () => {
        const result = await client.sendFile(filePath, sendBody !== false)

        this.worker?.postMessage({command: "clientFileResult", result, transferId})
      }).catch((error) => {
        this.logger.error(() => ["Failed to deliver file response", {clientCount: client.clientCount, filePath}, error])
        this.worker?.postMessage({command: "clientFileResult", result: "aborted", transferId})
      })
    } else if (command == "clientClose") {
      const {clientCount} = data
      const client = typeof clientCount === "number" ? this.clients[clientCount] : undefined

      if (!client) {
        this.logger.error(() => [`Velocious worker ${this.workerCount} requested close for missing client ${clientCount}`, data])
        return
      }

      void this.enqueueClientDelivery(client.clientCount, () => client.end())
        .finally(() => delete this.clients[client.clientCount])
    } else if (command == "debugSnapshot") {
      const {requestId, snapshot} = data
      if (typeof requestId !== "number") throw new Error("debugSnapshot requestId must be a number")
      const request = this._debugSnapshotRequests.get(requestId)

      if (request) {
        this._debugSnapshotRequests.delete(requestId)
        request.resolve(snapshot || {})
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
   * Preserves socket output ordering for one client.
   * @param {number} clientCount - Client count.
   * @param {() => Promise<void>} delivery - Delivery operation.
   * @returns {Promise<void>} - Queued delivery.
   */
  enqueueClientDelivery(clientCount, delivery) {
    const previous = this._clientDeliveryQueues.get(clientCount) || Promise.resolve()
    const queued = previous
      .catch(() => {})
      .then(delivery)

    this._clientDeliveryQueues.set(clientCount, queued)
    const clearQueue = () => {
      if (this._clientDeliveryQueues.get(clientCount) === queued) this._clientDeliveryQueues.delete(clientCount)
    }

    void queued.then(clearQueue, clearQueue)

    return queued
  }

  /**
   * Runs get debug snapshot.
   * @returns {Promise<Record<string, ?>>} - Worker-local debug snapshot.
   */
  getDebugSnapshot() {
    if (!this.workerStarted || !this.worker) {
      return Promise.resolve({active: false, workerCount: this.workerCount})
    }

    const requestId = ++this._debugRequestId

    return new Promise((resolve) => {
      const timeout = setTimeout(() => {
        this._debugSnapshotRequests.delete(requestId)
        resolve({active: true, error: "Timed out waiting for worker debug snapshot", workerCount: this.workerCount})
      }, 2000)

      if (typeof timeout.unref === "function") timeout.unref()

      const worker = this.worker

      if (!worker) {
        clearTimeout(timeout)
        resolve({active: false, workerCount: this.workerCount})
        return
      }

      this._debugSnapshotRequests.set(requestId, {
        resolve: (snapshot) => {
          clearTimeout(timeout)
          resolve({active: true, snapshot, workerCount: this.workerCount})
        }
      })
      worker.postMessage({command: "debugSnapshot", requestId})
    })
  }

  /**
   * Runs stop.
   * @returns {Promise<void>} - Resolves when stopped.
   */
  stop() {
    if (!this.worker) return Promise.resolve()
    if (this._hasExited) return Promise.resolve()

    this._stopping = true
    this.workerStarted = false
    this.unregisterFromEventsHostIfNeeded()
    const worker = this.worker

    if (!worker) return Promise.resolve()

    return new Promise((resolve) => {
      this._stopResolve = resolve
      worker.postMessage({command: "shutdown"})
    })
  }

  /**
   * Runs dispatch websocket event.
   * @param {object} args - Options object.
   * @param {string} args.channel - Channel name.
   * @param {string} [args.createdAt] - Event creation time.
   * @param {string} [args.eventId] - Event identifier.
   * @param {?} args.payload - Payload data.
   * @returns {void} - No return value.
   */
  dispatchWebsocketEvent({channel, createdAt, eventId, payload}) {
    // Test and shutdown paths can leave a registered handler without a live worker-thread transport.
    if (!this.workerStarted) return
    if (!this.worker || typeof this.worker.postMessage !== "function") return

    this.worker.postMessage({channel, command: "websocketEvent", createdAt, eventId, payload})
  }

  /**
   * Forwards a V2 channel broadcast to this worker's thread so it can
   * dispatch to any locally-registered V2 subscriptions.
   * @param {object} args - Options object.
   * @param {string} args.channel - Channel name.
   * @param {Record<string, ?>} args.broadcastParams - Routing filter params.
   * @param {?} args.body - Message body.
   * @param {string} [args.eventId] - Persisted event id for replay.
   * @param {string} [args.createdAt] - Event creation timestamp.
   * @returns {void}
   */
  dispatchWebsocketV2Broadcast({body, broadcastParams, channel, eventId, createdAt}) {
    if (!this.workerStarted) return
    if (!this.worker || typeof this.worker.postMessage !== "function") return

    this.worker.postMessage({body, broadcastParams, channel, command: "websocketV2Broadcast", eventId, createdAt})
  }

  /**
   * Runs register with events host.
   * @returns {void} */
  registerWithEventsHost() {
    if (this.unregisterFromEventsHost) return

    this.unregisterFromEventsHost = websocketEventsHost.register(this)
  }

  /**
   * Runs unregister from events host if needed.
   * @returns {void} */
  unregisterFromEventsHostIfNeeded() {
    if (!this.unregisterFromEventsHost) return

    this.unregisterFromEventsHost()
    this.unregisterFromEventsHost = null
  }
}
