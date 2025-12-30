// @ts-check

export default class VelociousHttpServerWebsocketEvents {
  /**
   * @param {object} args - Options object.
   * @param {import("worker_threads").parentPort} args.parentPort - Parent port.
   * @param {number} args.workerCount - Worker count.
   */
  constructor({parentPort, workerCount}) {
    this.parentPort = parentPort
    this.workerCount = workerCount
  }

  /**
   * @param {string} channel - Channel name.
   * @param {any} payload - Payload data.
   * @returns {void} - No return value.
   */
  publish(channel, payload) {
    if (!channel) throw new Error("channel is required")

    this.parentPort.postMessage({channel, command: "websocketPublish", payload, workerCount: this.workerCount})
  }
}

