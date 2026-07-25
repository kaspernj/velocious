// @ts-check

import Client from "../client/index.js"
import ClientDeliveryQueue from "../client-delivery-queue.js"
import dispatchChannelSubscribers from "./channel-subscriber-dispatch.js"
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
   * Runs constructor.
   * @param {object} args - Options object.
   * @param {import("../../configuration.js").default} args.configuration - Configuration instance.
   * @param {number} args.workerCount - Worker count.
   */
  constructor({configuration, workerCount}) {
    this.configuration = configuration

    /**
     * Narrows the runtime value to the documented type.
     * @type {Record<number, {deliveryQueue: ClientDeliveryQueue, httpClient: Client, serverClient: import("../server-client.js").default}>} */
    this.clients = {}

    /** @type {Set<Promise<void>>} */
    this.pendingClientCloseCleanups = new Set()

    this.logger = new Logger(this)
    this.workerCount = workerCount
    this.unregisterFromEventsHost = websocketEventsHost.register(/** @type {?} */ (this))
    this._stopping = false
  }

  /**
   * Runs start.
   * @returns {Promise<void>} */
  async start() {
    await this.logger.debug(() => `In-process handler ${this.workerCount} started`)
  }

  /**
   * Runs add socket connection.
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

    const {maxBytes, maxFrames} = this.configuration.getWebsocketOutboundQueueLimits()
    const deliveryQueue = new ClientDeliveryQueue({
      clientCount,
      maxBytes,
      maxFrames,
      onOverflow: (error) => {
        deliveryQueue.destroy()
        serverClient.destroy(error)
        this._reportOutboundQueueOverflow({clientCount, error})
      }
    })

    httpClient.events.on("output", (output, {websocketFrame = false} = {}) => {
      if (output !== null && output !== undefined) {
        const delivery = () => serverClient.send(output)
        const queued = websocketFrame
          ? deliveryQueue.enqueueFrame({
            byteLength: typeof output === "string" ? Buffer.byteLength(output) : output.byteLength,
            delivery
          })
          : deliveryQueue.enqueueControl(delivery)

        void queued.catch((error) => {
          this.logger.error(() => ["Failed to deliver client output", {clientCount}, error])
        })
      }
    })

    httpClient.events.on("file", ({filePath, sendBody, settle}) => {
      void deliveryQueue.enqueueControl(async () => {
        await settle(await serverClient.sendFile(filePath, sendBody))
      }).catch((error) => {
        this.logger.error(() => ["Failed to deliver file response", {clientCount, filePath}, error])
        void settle("aborted")
      })
    })

    httpClient.events.on("close", () => {
      void deliveryQueue.enqueueControl(() => serverClient.end())
        .finally(() => delete this.clients[clientCount])
    })

    serverClient.events.on("close", () => {
      deliveryQueue.destroy()
      const cleanup = httpClient.abortPendingFileResponses()
        .catch((error) => {
          this.logger.warn("Failed to abort file responses after client close", error)
        })
        .finally(() => {
          this.pendingClientCloseCleanups.delete(cleanup)
          delete this.clients[clientCount]
        })

      this.pendingClientCloseCleanups.add(cleanup)
    })

    this.clients[clientCount] = {deliveryQueue, httpClient, serverClient}

    // Create a message-port shim so ServerClient.onSocketData can route data
    // to the in-process HTTP Client without needing a real worker thread.
    const messagePortShim = /** @type {import("worker_threads").Worker} */ (/** @type {?} */ ({
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

  /**
   * Reports a per-client outbound queue overflow.
   * @param {object} args - Overflow details.
   * @param {number} args.clientCount - Affected client.
   * @param {Error} args.error - Overflow error.
   * @returns {void}
   */
  _reportOutboundQueueOverflow({clientCount, error}) {
    const errorPayload = {
      context: {clientCount, websocketOutboundQueueOverflow: true, workerCount: this.workerCount},
      error
    }
    const errorEvents = this.configuration.getErrorEvents()

    errorEvents.emit("framework-error", errorPayload)
    errorEvents.emit("all-error", {...errorPayload, errorType: "framework-error"})
  }

  /**
   * Runs stop.
   * @returns {Promise<void>} */
  async stop() {
    this._stopping = true

    for (const {httpClient, serverClient} of Object.values(this.clients)) {
      await Promise.all([
        httpClient.abortPendingFileResponses().catch((error) => {
          this.logger.warn("Failed to abort file responses during shutdown", error)
        }),
        serverClient.end().catch((error) => {
          this.logger.warn("Failed to close client during shutdown", error)
        })
      ])
    }

    await Promise.all(this.pendingClientCloseCleanups)

    this.clients = {}
    this.unregisterFromEventsHost?.()
  }

  /**
   * In-process handler path for V2 channel broadcasts. No worker
   * boundary to cross — dispatch directly to any matching live
   * subscriptions on the shared configuration.
   * @param {object} args - Options object.
   * @param {string} args.channel - Channel name.
   * @param {Record<string, ?>} args.broadcastParams - Routing filter params.
   * @param {?} args.body - Message body.
   * @param {string} [args.eventId] - Persisted event id for replay.
   * @returns {void}
   */
  dispatchWebsocketV2Broadcast({body, broadcastParams, channel, eventId}) {
    if (!this.configuration) return

    return this.configuration._broadcastToChannelLocal(channel, broadcastParams, body, {eventId})
  }

  /**
   * Gets the configuration-wide V2 broadcast target shared by in-process handlers.
   * @returns {import("../../configuration.js").default} - Shared configuration target.
   */
  websocketV2BroadcastDispatchKey() {
    return this.configuration
  }

  /**
   * Runs dispatch websocket event.
   * @param {object} args - Options object.
   * @param {string} args.channel - Channel name.
   * @param {string} [args.createdAt] - Event creation time.
   * @param {string} [args.eventId] - Event identifier.
   * @param {?} args.payload - Payload data.
   * @returns {void}
   */
  dispatchWebsocketEvent({channel, createdAt, eventId, payload}) {
    for (const {httpClient} of Object.values(this.clients)) {
      const session = httpClient.websocketSession

      if (!session) continue

      void session.sendEvent(channel, payload, {createdAt, eventId})
    }

    if (this.configuration) {
      // Isolate subscriber failures from breaking the in-process handler,
      // but still surface them to the framework error events so bug
      // reporters can pick them up.
      void dispatchChannelSubscribers({channel, configuration: this.configuration, createdAt, eventId, logger: this.logger, payload})
    }
  }
}
