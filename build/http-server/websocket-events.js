// @ts-check

export default class VelociousHttpServerWebsocketEvents {
  /**
   * Runs constructor.
   * @param {object} args - Options object.
   * @param {import("node:worker_threads").MessagePort | null} args.parentPort - Parent port.
   * @param {number} args.workerCount - Worker count.
   */
  constructor({parentPort, workerCount}) {
    this.parentPort = parentPort
    this.workerCount = workerCount
  }

  /**
   * Runs publish.
   * @param {string} channel - Channel name.
   * @param {ReturnType<typeof JSON.parse>} payload - Payload data.
   * @returns {void} - No return value.
   */
  publish(channel, payload) {
    if (!channel) throw new Error("channel is required")
    if (!this.parentPort) throw new Error("parentPort is required")

    this.parentPort.postMessage({channel, command: "websocketPublish", payload, workerCount: this.workerCount})
  }

  /**
   * Fan-out entry point for `configuration.broadcastToChannel` on V2
   * channels. The worker posts to the main process, which fans out to
   * every worker so subscribers on any worker receive the broadcast.
   * @param {object} args - Options object.
   * @param {string} args.channel - Channel name.
   * @param {Record<string, ReturnType<typeof JSON.parse>>} args.broadcastParams - Filter params forwarded to `matches()`.
   * @param {ReturnType<typeof JSON.parse>} args.body - Message body delivered via `sendMessage()`.
   * @returns {void}
   */
  publishV2Broadcast({channel, broadcastParams, body}) {
    if (!channel) throw new Error("channel is required")
    if (!this.parentPort) throw new Error("parentPort is required")

    this.parentPort.postMessage({
      body,
      broadcastParams,
      channel,
      command: "websocketV2Broadcast",
      workerCount: this.workerCount
    })
  }
}
