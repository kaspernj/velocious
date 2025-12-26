// @ts-check

import {Logger} from "../../logger.js"
import {Worker} from "worker_threads"
import ensureError from "../../utils/ensure-error.js"
import websocketEventsHost from "../websocket-events-host.js"

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

    client.socket.on("end", () => {
      this.logger.debug(`Removing ${clientCount} from clients`)
      delete this.clients[clientCount]
    })

    if (!this.worker) throw new Error("Worker not initialized")

    client.setWorker(this.worker)
    client.listen()

    this.clients[clientCount] = client
    this.worker.postMessage({command: "newClient", clientCount, remoteAddress: client.remoteAddress})
  }

  /**
   * @param {unknown} error - Error instance.
   */
  onWorkerError = (error) => {
    throw ensureError(error) // Throws original error with backtrace and everything into the console
  }

  /**
   * @param {number} code - Code.
   * @returns {void} - No return value.
   */
  onWorkerExit = (code) => {
    if (code !== 0) {
      throw new Error(`Client worker stopped with exit code ${code}`)
    } else {
      this.logger.info(() => `Client worker stopped with exit code ${code}`)
    }

    this.unregisterFromEventsHost?.()
  }

  /**
   * @param {object} data - Data payload.
   * @param {string} data.command - Command.
   * @param {number} [data.clientCount] - Client count.
   * @param {string} [data.output] - Output.
   * @param {string} [data.channel] - Channel name.
   * @param {unknown} [data.payload] - Payload data.
   * @returns {void} - No return value.
   */
  onWorkerMessage = (data) => {
    this.logger.debug(`Worker message`, data)

    const {command} = data


    if (command == "started") {
      if (this.onStartCallback) {
        this.onStartCallback(null)
      }

      this.onStartCallback = null
    } else if (command == "clientOutput") {
      this.logger.debug("CLIENT OUTPUT", data)

      const {clientCount, output} = data

      if (output !== null) {
        this.clients[clientCount]?.send(output)
      }
    } else if (command == "clientClose") {
      const {clientCount} = data

      this.clients[clientCount]?.end()
      delete this.clients[clientCount]
    } else if (command == "websocketPublish") {
      const {channel, payload} = data

      websocketEventsHost.publish({channel, payload})
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
  dispatchWebsocketEvent({channel, payload}) {
    if (!this.worker) return

    this.worker.postMessage({channel, command: "websocketEvent", payload})
  }
}
