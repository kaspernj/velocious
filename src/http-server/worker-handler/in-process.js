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

  /**
   * @param {object} args - Options object.
   * @param {string} args.channel - Channel name.
   * @param {string} [args.createdAt] - Event creation time.
   * @param {string} [args.eventId] - Event identifier.
   * @param {any} args.payload - Payload data.
   * @returns {void}
   */
  /**
   * In-process handler path for V2 channel broadcasts. No worker
   * boundary to cross — dispatch directly to any matching live
   * subscriptions on the shared configuration.
   *
   * @param {object} args - Options object.
   * @param {string} args.channel - Channel name.
   * @param {Record<string, any>} args.broadcastParams - Routing filter params.
   * @param {any} args.body - Message body.
   * @param {string} [args.eventId] - Persisted event id for replay.
   * @returns {void}
   */
  dispatchWebsocketV2Broadcast({body, broadcastParams, channel, eventId}) {
    if (!this.configuration) return

    /** @type {any} */ (this.configuration)._broadcastToChannelLocal(channel, broadcastParams, body, {eventId})
  }

  /**
   * @param {object} args - Options object.
   * @param {string} args.channel - Channel name.
   * @param {string} [args.createdAt] - Event creation time.
   * @param {string} [args.eventId] - Event identifier.
   * @param {any} args.payload - Payload data.
   * @returns {void}
   */
  dispatchWebsocketEvent({channel, createdAt, eventId, payload}) {
    for (const {httpClient} of Object.values(this.clients)) {
      const session = httpClient.websocketSession

      if (!session) continue

      void session.sendEvent(channel, payload, {createdAt, eventId})
    }

    if (this.configuration) {
      const configuration = this.configuration

      // Isolate subscriber failures from breaking the in-process handler,
      // but still surface them to the framework error events so bug
      // reporters can pick them up.
      void configuration.getWebsocketChannelSubscribers()
        .dispatch({channel, createdAt, eventId, payload})
        .catch((error) => {
          this.logger.error(() => [`Channel subscriber dispatch failed for ${channel}`, error])

          const errorPayload = {
            context: {channel, createdAt, eventId, source: "websocket-channel-subscribers"},
            error
          }

          configuration.getErrorEvents().emit("framework-error", errorPayload)
          configuration.getErrorEvents().emit("all-error", {...errorPayload, errorType: "framework-error"})
        })
    }
  }
}
