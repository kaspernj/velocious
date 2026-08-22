import net from "node:net"
import VelociousJob from "../../../../src/background-jobs/job.js"

export default class SocketBarrierTestJob extends VelociousJob {
  /**
   * Blocks on a test-owned socket until every expected sibling has started.
   * @param {number} port - Loopback barrier port.
   * @returns {Promise<void>} - Resolves when the test releases the barrier.
   */
  async perform(port) {
    await new Promise((resolve, reject) => {
      const socket = net.createConnection({host: "127.0.0.1", port})

      socket.once("data", () => {
        socket.end()
        resolve(undefined)
      })
      socket.once("error", reject)
    })
  }
}
