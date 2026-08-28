// @ts-check

import { randomUUID } from "node:crypto"
import net from "node:net"
import JsonSocket from "./json-socket.js"
import { resolveGenerationId, resolveLifecycleSocketPath } from "./generation-identity.js"

/** One-request acknowledged lifecycle client. */
export default class BackgroundJobsLifecycleClient {
  /**
   * Creates a lifecycle client.
   * @param {object} args - Client options.
   * @param {import("../configuration.js").default} args.configuration - Configuration.
   * @param {string} [args.generationId] - Explicit generation identity.
   * @param {string} [args.socketPath] - Explicit control socket path.
   */
  constructor({configuration, generationId, socketPath}) {
    const config = configuration.getBackgroundJobsConfig()
    this.generationId = resolveGenerationId([
      {name: "backgroundJobs.generationId", present: config.generationId !== undefined, value: config.generationId},
      {name: "BackgroundJobsLifecycleClient generationId", present: generationId !== undefined, value: generationId}
    ])
    this.socketPath = resolveLifecycleSocketPath([
      {name: "backgroundJobs.lifecycleSocketPath", present: config.lifecycleSocketPath !== undefined, value: config.lifecycleSocketPath},
      {name: "BackgroundJobsLifecycleClient socketPath", present: socketPath !== undefined, value: socketPath}
    ], this.generationId)
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
    const requestId = randomUUID()
    const socket = net.createConnection(this.socketPath)
    const jsonSocket = new JsonSocket(socket)

    return await new Promise((resolve, reject) => {
      let finished = false
      /**
       * Settles the request once.
       * @param {() => void} callback - Settlement callback.
       */
      const finish = (callback) => {
        if (finished) return
        finished = true
        jsonSocket.removeAllListeners()
        jsonSocket.close()
        callback()
      }

      jsonSocket.on("error", (error) => finish(() => reject(error)))
      jsonSocket.on("close", () => finish(() => reject(new Error("Background jobs lifecycle socket closed before acknowledgement"))))
      jsonSocket.on("message", (message) => {
        if (message?.requestId !== requestId || message.action !== action) {
          finish(() => reject(new Error("Background jobs lifecycle response did not match its request")))
          return
        }
        if (message.type === "background-jobs-lifecycle-error") {
          const error = new Error(message.error?.message || "Background jobs lifecycle request failed")
          if (typeof message.error?.name === "string") error.name = message.error.name
          if (typeof message.error?.stack === "string") error.stack = message.error.stack
          finish(() => reject(error))
          return
        }
        if (message.type !== "background-jobs-lifecycle-ack" || message.generationId !== this.generationId) {
          finish(() => reject(new Error("Invalid background jobs lifecycle acknowledgement")))
          return
        }
        finish(() => resolve(message.lifecycleState))
      })
      socket.once("connect", () => {
        jsonSocket.send({
          type: "background-jobs-lifecycle",
          action,
          generationId: this.generationId,
          requestId
        })
      })
    })
  }
}
