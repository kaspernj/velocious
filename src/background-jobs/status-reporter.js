// @ts-check

import timeout from "awaitery/build/timeout.js"
import wait from "awaitery/build/wait.js"
import Logger from "../logger.js"
import normalizeBackgroundJobError from "./normalize-error.js"
import BackgroundJobsSocketRequest from "./socket-request.js"

class BackgroundJobUpdateError extends Error {}

export default class BackgroundJobsStatusReporter {
  /**
   * Runs constructor.
   * @param {object} args - Options.
   * @param {import("../configuration.js").default} args.configuration - Configuration.
   * @param {string} [args.host] - Host.
   * @param {number} [args.port] - Port.
   * @param {number} [args.attemptTimeoutMs] - Per-attempt socket-request timeout in milliseconds (default: 5000).
   */
  constructor({configuration, host, port, attemptTimeoutMs = 5000}) {
    this.configuration = configuration
    this.host = host
    this.port = port
    this.attemptTimeoutMs = attemptTimeoutMs
    /**
     * Internal test-only observability state — NOT public API. References the most
     * recent socket request so the timeout spec can inspect how its socket was torn
     * down. Do not expose or depend on this outside tests.
     * @type {BackgroundJobsSocketRequest | undefined}
     */
    this._lastRequest = undefined
    this.logger = new Logger(this)
  }

  /**
   * Runs report.
   * @param {object} args - Options.
   * @param {string} args.jobId - Job id.
   * @param {"completed" | "failed"} args.status - Status.
   * @param {?} [args.error] - Error.
   * @param {string} [args.handoffId] - Handoff lease id.
   * @param {number} [args.handedOffAtMs] - Handed off timestamp.
   * @param {string} [args.workerId] - Worker id.
   * @returns {Promise<void>} - Resolves when reported.
   */
  async report({jobId, status, error, handoffId, handedOffAtMs, workerId}) {
    const config = this.configuration.getBackgroundJobsConfig()
    const host = this.host || config.host
    const port = typeof this.port === "number" ? this.port : config.port

    await timeout({timeout: this.attemptTimeoutMs}, async ({control}) => {
      const request = new BackgroundJobsSocketRequest({host, port, role: "reporter"})

      this._lastRequest = request

      await request.run({
        signal: control.signal,
        onConnect: (jsonSocket) => {
          jsonSocket.send({
            type: status === "completed" ? "job-complete" : "job-failed",
            jobId,
            handoffId,
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
            reject(new BackgroundJobUpdateError(message.error || "Job update failed"))
          }
        }
      })
    })
  }

  /**
   * Runs report with retry.
   * @param {object} args - Options.
   * @param {string} args.jobId - Job id.
   * @param {"completed" | "failed"} args.status - Status.
   * @param {?} [args.error] - Error.
   * @param {string} [args.handoffId] - Handoff lease id.
   * @param {number} [args.handedOffAtMs] - Handed off timestamp.
   * @param {string} [args.workerId] - Worker id.
   * @param {number} [args.maxDurationMs] - Max duration for retries.
   * @returns {Promise<void>} - Resolves when reported.
   */
  async reportWithRetry({jobId, status, error, handoffId, handedOffAtMs, workerId, maxDurationMs}) {
    let attempt = 0
    const startTime = Date.now()

    while (true) {
      try {
        await this.report({jobId, status, error, handoffId, handedOffAtMs, workerId})
        return
      } catch (error) {
        if (error instanceof BackgroundJobUpdateError) throw error

        attempt += 1
        const delaySeconds = Math.min(30, 0.5 * attempt)

        this.logger.debug(() => ["Background job status report failed, retrying", error])

        if (maxDurationMs && Date.now() - startTime >= maxDurationMs) {
          this.logger.warn(() => ["Background job status report timed out, giving up", error])
          throw error
        }

        await wait(delaySeconds)
      }
    }
  }

}
