// @ts-check

import net from "node:net"

import VelociousJob from "../../../../src/background-jobs/job.js"
import RetiredOwnedFollowUpTestChildJob from "./retired-owned-follow-up-test-child-job.js"

/**
 * @typedef {object} RetiredOwnedFollowUpRequest
 * @property {Array<ReturnType<typeof JSON.parse>>} args - Child arguments.
 * @property {import("../../../../src/background-jobs/types.js").BackgroundJobOptions} options - Child options.
 */

/**
 * Blocks an owned producer handoff until its generation retires, then enqueues
 * one child through the ordinary public job API.
 */
export default class RetiredOwnedFollowUpTestJob extends VelociousJob {
  /**
   * @param {number} barrierPort - Loopback event-barrier port.
   * @param {RetiredOwnedFollowUpRequest[]} [requests] - Child enqueue requests.
   * @returns {Promise<void>} - Resolves after the child enqueue commits.
   */
  async perform(barrierPort, requests = [{args: ["owned follow-up"], options: {executionMode: "inline"}}]) {
    await new Promise((resolve, reject) => {
      const socket = net.createConnection({host: "127.0.0.1", port: barrierPort})

      socket.once("data", () => {
        socket.end()
        resolve(undefined)
      })
      socket.once("error", reject)
    })

    for (const request of requests) {
      await RetiredOwnedFollowUpTestChildJob.performLaterWithOptions(request)
    }
  }
}
