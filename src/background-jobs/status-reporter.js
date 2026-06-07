// @ts-check

import timeout from "awaitery/build/timeout.js"
import wait from "awaitery/build/wait.js"
import Logger from "../logger.js"
import normalizeBackgroundJobError from "./normalize-error.js"
import BackgroundJobsSocketRequest from "./socket-request.js"

export default class BackgroundJobsStatusReporter {
  /**
   * @param {object} args - Options.
   * @param {import("../configuration.js").default} args.configuration - Configuration.
   * @param {string} [args.host] - Host.
   * @param {number} [args.port] - Port.
   */
  constructor({configuration, host, port}) {
    this.configuration = configuration
    this.host = host
    this.port = port
    this.logger = new Logger(this)
  }

  /**
   * @param {object} args - Options.
   * @param {string} args.jobId - Job id.
   * @param {"completed" | "failed"} args.status - Status.
   * @param {unknown} [args.error] - Error.
   * @param {number} [args.handedOffAtMs] - Handed off timestamp.
   * @param {string} [args.workerId] - Worker id.
   * @returns {Promise<void>} - Resolves when reported.
   */
  async report({jobId, status, error, handedOffAtMs, workerId}) {
    const config = this.configuration.getBackgroundJobsConfig()
    const host = this.host || config.host
    const port = typeof this.port === "number" ? this.port : config.port

    await timeout({timeout: 5000}, async () => {
      const request = new BackgroundJobsSocketRequest({host, port, role: "reporter"})

      await request.run({
        onConnect: (jsonSocket) => {
          jsonSocket.send({
            type: status === "completed" ? "job-complete" : "job-failed",
            jobId,
            workerId,
            handedOffAtMs,
            error: error ? normalizeBackgroundJobError(error) : undefined
          })
        },
        onMessage: ({message, resolve, reject}) => {
          if (message?.type === "job-updated" && message.jobId === jobId) {
            resolve(undefined)
            return
          }

          if (message?.type === "job-update-error" && message.jobId === jobId) {
            reject(new Error(message.error || "Job update failed"))
          }
        }
      })
    })
  }

  /**
   * @param {object} args - Options.
   * @param {string} args.jobId - Job id.
   * @param {"completed" | "failed"} args.status - Status.
   * @param {unknown} [args.error] - Error.
   * @param {number} [args.handedOffAtMs] - Handed off timestamp.
   * @param {string} [args.workerId] - Worker id.
   * @param {number} [args.maxDurationMs] - Max duration for retries.
   * @returns {Promise<void>} - Resolves when reported.
   */
  async reportWithRetry({jobId, status, error, handedOffAtMs, workerId, maxDurationMs}) {
    let attempt = 0
    const startTime = Date.now()

    while (true) {
      try {
        await this.report({jobId, status, error, handedOffAtMs, workerId})
        return
      } catch (error) {
        attempt += 1
        const delaySeconds = Math.min(30, 0.5 * attempt)

        this.logger.debug(() => ["Background job status report failed, retrying", error])

        if (maxDurationMs && Date.now() - startTime >= maxDurationMs) {
          this.logger.warn(() => ["Background job status report timed out, giving up", error])
          return
        }

        await wait(delaySeconds)
      }
    }
  }

}
