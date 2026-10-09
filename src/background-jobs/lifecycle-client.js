// @ts-check

import { randomUUID } from "node:crypto"
import net from "node:net"
import timeout from "awaitery/build/timeout.js"
import JsonSocket from "./json-socket.js"

const DEFAULT_REQUEST_TIMEOUT_MS = 10000
export const MAX_LIFECYCLE_REQUEST_TIMEOUT_MS = 120000
const LIFECYCLE_CONNECT_RETRY_DELAY_MS = 50
const TRANSIENT_CONNECT_ERROR_CODES = new Set(["ECONNABORTED", "ECONNREFUSED", "ENOENT"])

/**
 * Whether a lifecycle request failure is a transient "endpoint not ready yet"
 * connect failure (the coordinator's control socket opens asynchronously after
 * its process starts) rather than a definitive protocol or state rejection.
 * @param {unknown} error - The rejection reason.
 * @returns {boolean} - Whether the request may be retried.
 */
function isTransientConnectError(error) {
  if (typeof error !== "object" || error === null) return false
  const code = /** @type {{code?: unknown}} */ (error).code

  return typeof code === "string" && TRANSIENT_CONNECT_ERROR_CODES.has(code)
}

/**
 * Waits before the next lifecycle connect retry, rejecting with the signal
 * reason when the caller-owned deadline fires mid-wait.
 * @param {number} delayMs - Wait between attempts.
 * @param {AbortSignal} signal - Caller-owned deadline signal.
 * @returns {Promise<void>} - Resolves after the delay, or rejects on abort.
 */
async function waitBeforeNextAttempt(delayMs, signal) {
  await new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(signal.reason)

      return
    }
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort)
      resolve(undefined)
    }, delayMs)
    const onAbort = () => {
      clearTimeout(timer)
      reject(signal.reason)
    }

    signal.addEventListener("abort", onAbort)
  })
}

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
    if (!Number.isInteger(requestTimeoutMs) || requestTimeoutMs < 1 || requestTimeoutMs > MAX_LIFECYCLE_REQUEST_TIMEOUT_MS) {
      throw new TypeError(`requestTimeoutMs must be an integer between 1 and ${MAX_LIFECYCLE_REQUEST_TIMEOUT_MS}`)
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
   * Sends the lifecycle request under its caller-owned deadline. Retries
   * transient "endpoint not ready yet" connect failures (the coordinator opens
   * its control socket asynchronously after its process starts) until the
   * deadline; any definitive protocol or state rejection fails immediately.
   * @param {object} args - Request details.
   * @param {"activate" | "retire"} args.action - Lifecycle action.
   * @param {AbortSignal} args.signal - Request deadline signal.
   * @returns {Promise<import("./types.js").BackgroundJobsGenerationLifecycleState>} - Resulting state.
   */
  async _runRequest({action, signal}) {
    while (true) {
      try {
        return await this._attemptRequest(action, randomUUID(), signal)
      } catch (error) {
        if (!isTransientConnectError(error)) throw error
        if (signal.aborted) throw signal.reason
        await waitBeforeNextAttempt(LIFECYCLE_CONNECT_RETRY_DELAY_MS, signal)
      }
    }
  }

  /**
   * Performs one lifecycle request attempt against the control socket.
   * @param {"activate" | "retire"} action - Lifecycle action.
   * @param {string} requestId - Request identity for acknowledgement matching.
   * @param {AbortSignal} signal - Request deadline signal.
   * @returns {Promise<import("./types.js").BackgroundJobsGenerationLifecycleState>} - Resulting state.
   */
  async _attemptRequest(action, requestId, signal) {
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
