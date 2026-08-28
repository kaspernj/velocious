// @ts-check

import { randomUUID } from "node:crypto"
import net from "node:net"
import timeout from "awaitery/build/timeout.js"
import JsonSocket from "./json-socket.js"

const DEFAULT_REQUEST_TIMEOUT_MS = 10000
const MAX_REQUEST_TIMEOUT_MS = 25000

/** One-request acknowledged lifecycle client. */
export default class BackgroundJobsLifecycleClient {
  /**
   * Creates a lifecycle client.
   * @param {object} args - Client options.
   * @param {import("../configuration.js").default} args.configuration - Configuration.
   * @param {string} [args.generationId] - Explicit generation identity.
   * @param {string} [args.socketPath] - Explicit control socket path.
   * @param {number} [args.requestTimeoutMs] - Request deadline below the supervisor hook timeout (default: 10000).
   */
  constructor({configuration, generationId, socketPath, requestTimeoutMs = DEFAULT_REQUEST_TIMEOUT_MS}) {
    const generationConfig = configuration.resolveBackgroundJobsGenerationConfig({
      generationId,
      lifecycleSocketPath: socketPath,
      sourceName: "BackgroundJobsLifecycleClient"
    })
    this.generationId = generationConfig.generationId
    this.socketPath = generationConfig.lifecycleSocketPath
    if (!Number.isInteger(requestTimeoutMs) || requestTimeoutMs < 1 || requestTimeoutMs > MAX_REQUEST_TIMEOUT_MS) {
      throw new TypeError(`requestTimeoutMs must be an integer between 1 and ${MAX_REQUEST_TIMEOUT_MS}`)
    }
    this.requestTimeoutMs = requestTimeoutMs
    if (!this.generationId) throw new Error("Background jobs lifecycle client requires generationId")
    if (!this.socketPath) throw new Error("Background jobs lifecycle client requires lifecycleSocketPath")
  }

  /**
   * Activates the generation.
   * @returns {Promise<import("./types.js").BackgroundJobsGenerationLifecycleState>} - Resulting state.
   */
  async activate() { return await this._request("activate") }

  /**
   * Retires the generation.
   * @returns {Promise<import("./types.js").BackgroundJobsGenerationLifecycleState>} - Resulting state.
   */
  async retire() { return await this._request("retire") }

  /**
   * Sends exactly one lifecycle request.
   * @param {"activate" | "retire"} action - Lifecycle action.
   * @returns {Promise<import("./types.js").BackgroundJobsGenerationLifecycleState>} - Resulting state.
   */
  async _request(action) {
    return await timeout({
      errorMessage: `Background jobs ${action} request for ${this.generationId} timed out after ${this.requestTimeoutMs}ms at ${this.socketPath}`,
      timeout: this.requestTimeoutMs
    }, async ({control}) => await this._runRequest({action, signal: control.signal}))
  }

  /**
   * Sends the lifecycle request under its caller-owned deadline.
   * @param {object} args - Request details.
   * @param {"activate" | "retire"} args.action - Lifecycle action.
   * @param {AbortSignal} args.signal - Request deadline signal.
   * @returns {Promise<import("./types.js").BackgroundJobsGenerationLifecycleState>} - Resulting state.
   */
  async _runRequest({action, signal}) {
    const requestId = randomUUID()
    const socket = net.createConnection(this.socketPath)
    const jsonSocket = new JsonSocket(socket)

    return await new Promise((resolve, reject) => {
      let finished = false
      /**
       * Settles the request once.
       * @param {object} options - Teardown options.
       * @param {boolean} [options.destroy] - Destroy instead of closing.
       * @param {() => void} callback - Settlement callback.
       */
      const finish = ({destroy = false}, callback) => {
        if (finished) return
        finished = true
        signal.removeEventListener("abort", onAbort)
        socket.removeListener("connect", onConnect)
        jsonSocket.removeAllListeners()
        if (destroy) jsonSocket.destroy()
        else jsonSocket.close()
        callback()
      }

      const onAbort = () => finish({destroy: true}, () => reject(signal.reason instanceof Error ? signal.reason : new Error("Background jobs lifecycle request aborted")))
      const onConnect = () => {
        jsonSocket.send({
          type: "background-jobs-lifecycle",
          action,
          generationId: this.generationId,
          requestId
        })
      }

      signal.addEventListener("abort", onAbort)
      jsonSocket.on("error", (error) => finish({}, () => reject(error)))
      jsonSocket.on("close", () => finish({destroy: true}, () => reject(new Error("Background jobs lifecycle socket closed before acknowledgement"))))
      jsonSocket.on("message", (message) => {
        if (message?.requestId !== requestId || message.action !== action) {
          finish({}, () => reject(new Error("Background jobs lifecycle response did not match its request")))
          return
        }
        if (message.type === "background-jobs-lifecycle-error") {
          const error = new Error(message.error?.message || "Background jobs lifecycle request failed")
          if (typeof message.error?.name === "string") error.name = message.error.name
          if (typeof message.error?.stack === "string") error.stack = message.error.stack
          finish({}, () => reject(error))
          return
        }
        if (message.type !== "background-jobs-lifecycle-ack" || message.generationId !== this.generationId) {
          finish({}, () => reject(new Error("Invalid background jobs lifecycle acknowledgement")))
          return
        }
        finish({}, () => resolve(message.lifecycleState))
      })
      socket.once("connect", onConnect)
      if (signal.aborted) onAbort()
    })
  }
}
