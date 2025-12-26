// @ts-check

export default class VelociousHttpServerWebsocketEvents {
  /**
   * @param {object} args
   * @param {import("worker_threads").parentPort} args.parentPort
   * @param {number} args.workerCount
   */
  constructor({parentPort, workerCount}) {
    this.parentPort = parentPort
    this.workerCount = workerCount
  }

  /**
   * @param {string} channel
   * @param {any} payload
   * @returns {void} - No return value.
   */
  publish(channel, payload) {
    if (!channel) throw new Error("channel is required")

    this.parentPort.postMessage({channel, command: "websocketPublish", payload, workerCount: this.workerCount})
  }
}
