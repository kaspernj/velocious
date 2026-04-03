// @ts-check

import Client from "../client/index.js"
import Logger from "../../logger.js"
import websocketEventsHost from "../websocket-events-host.js"

/**
 * In-process worker handler that processes HTTP requests in the main thread
 * instead of spawning a Worker thread. This allows the test runner's database
 * connection context to be shared with HTTP request handlers, so model-created
 * records in tests are visible to HTTP endpoints.
 */
export default class VelociousHttpServerInProcessHandler {
  /**
   * @param {object} args - Options object.
   * @param {import("../../configuration.js").default} args.configuration - Configuration instance.
   * @param {number} args.workerCount - Worker count.
   */
  constructor({configuration, workerCount}) {
    this.configuration = configuration

    /** @type {Record<number, {httpClient: Client, serverClient: import("../server-client.js").default}>} */
    this.clients = {}

    this.logger = new Logger(this)
    this.workerCount = workerCount
    this.unregisterFromEventsHost = websocketEventsHost.register(/** @type {any} */ (this))
    this._stopping = false
  }

  /** @returns {Promise<void>} */
  async start() {
    await this.logger.debug(() => `In-process handler ${this.workerCount} started`)
  }

  /**
   * @param {import("../server-client.js").default} serverClient - Server client instance.
   * @returns {void}
   */
  addSocketConnection(serverClient) {
    const clientCount = serverClient.clientCount

    const httpClient = new Client({
      clientCount,
      configuration: this.configuration,
      remoteAddress: serverClient.remoteAddress
    })

    httpClient.events.on("output", (output) => {
      if (output !== null && output !== undefined) {
        void serverClient.send(output).catch((error) => {
          this.logger.error(() => ["Failed to deliver client output", {clientCount}, error])
        })
      }
    })

    httpClient.events.on("close", () => {
      void serverClient.end()
      delete this.clients[clientCount]
    })

    this.clients[clientCount] = {httpClient, serverClient}

    // Create a message-port shim so ServerClient.onSocketData can route data
    // to the in-process HTTP Client without needing a real worker thread.
    const messagePortShim = /** @type {import("worker_threads").Worker} */ (/** @type {unknown} */ ({
      postMessage: (/** @type {{command: string, chunk?: Buffer | Uint8Array | string, clientCount?: number}} */ data) => {
        if (data.command === "clientWrite" && data.chunk) {
          const chunk = typeof data.chunk === "string" ? Buffer.from(data.chunk) : Buffer.from(data.chunk)

          httpClient.onWrite(chunk)
        }
      }
    }))

    serverClient.setWorker(messagePortShim)
    serverClient.listen()
  }

  /** @returns {Promise<void>} */
  async stop() {
    this._stopping = true

    for (const {serverClient} of Object.values(this.clients)) {
      try {
        void serverClient.end()
      } catch (error) {
        this.logger.warn("Failed to close client during shutdown", error)
      }
    }

    this.clients = {}
    this.unregisterFromEventsHost?.()
  }

  /** @returns {void} */
  dispatchWebsocketEvent() {
    // No-op for in-process handler — websocket events not supported in test mode
  }
}
