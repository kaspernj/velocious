// @ts-check

import {Logger} from "../../logger.js"
import {Worker} from "worker_threads"
import ensureError from "../../utils/ensure-error.js"
import websocketEventsHost from "../websocket-events-host.js"

export default class VelociousHttpServerWorker {
  /**
   * @param {object} args
   * @param {import("../../configuration.js").default} args.configuration
   * @param {number} args.workerCount
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
   * @param {import("../server-client.js").default} client
   * @returns {void}
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
   * @param {any} error
   */
  onWorkerError = (error) => {
    throw ensureError(error) // Throws original error with backtrace and everything into the console
  }

  /**
   * @param {number} code
   * @returns {void}
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
   * @param {object} data
   * @param {string} data.command
   * @param {number} [data.clientCount]
   * @param {string} [data.output]
   * @param {string} [data.channel]
   * @param {any} [data.payload]
   * @returns {void}
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
   * @param {object} args
   * @param {string} args.channel
   * @param {any} args.payload
   * @returns {void}
   */
  dispatchWebsocketEvent({channel, payload}) {
    if (!this.worker) return

    this.worker.postMessage({channel, command: "websocketEvent", payload})
  }
}
