// @ts-check

import timeout from "awaitery/build/timeout.js"
import wait from "awaitery/build/wait.js"
import Logger from "../logger.js"
import normalizeBackgroundJobError from "./normalize-error.js"
import BackgroundJobsSocketRequest from "./socket-request.js"
import { DEFAULT_GENERATION_HANDSHAKE_TIMEOUT_MS, validateGenerationHandshakeTimeoutMs } from "./generation-handshake-timeout-error.js"

class BackgroundJobUpdateError extends Error {}

export default class BackgroundJobsStatusReporter {
  /**
   * Runs constructor.
   * @param {object} args - Options.
   * @param {import("../configuration.js").default} args.configuration - Configuration.
   * @param {string} [args.host] - Host.
   * @param {number} [args.port] - Port.
   * @param {number} [args.attemptTimeoutMs] - Per-attempt socket-request timeout in milliseconds (default: 5000).
   * @param {string} [args.generationId] - Explicit release generation identity.
   * @param {number} [args.generationHandshakeTimeoutMs] - Maximum time to wait for generation acknowledgement (default: 4000).
   */
  constructor({configuration, host, port, attemptTimeoutMs = 5000, generationHandshakeTimeoutMs = DEFAULT_GENERATION_HANDSHAKE_TIMEOUT_MS, generationId}) {
    this.configuration = configuration
    this.host = host
    this.port = port
    this.attemptTimeoutMs = attemptTimeoutMs
    this.generationHandshakeTimeoutMs = validateGenerationHandshakeTimeoutMs(generationHandshakeTimeoutMs)
    this.explicitGenerationId = generationId
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
   * @param {"completed" | "failed" | "rescheduled"} args.status - Status.
   * @param {number} [args.delayMs] - Reschedule delay in milliseconds.
   * @param {ReturnType<typeof JSON.parse>} [args.error] - Error.
   * @param {string} [args.handoffId] - Handoff lease id.
   * @param {number} [args.handedOffAtMs] - Handed off timestamp.
   * @param {string} [args.workerId] - Worker id.
   * @param {import("./types.js").PooledRunnerFailure} [args.runnerFailure] - Pooled-child process failure provenance.
   * @returns {Promise<void>} - Resolves when reported.
   */
  async report({jobId, status, delayMs, error, handoffId, handedOffAtMs, workerId, runnerFailure}) {
    const config = this.configuration.getBackgroundJobsConfig()
    const host = this.host || config.host
    const port = typeof this.port === "number" ? this.port : config.port
    const {generationId} = this.configuration.resolveBackgroundJobsGenerationConfig({
      generationId: this.explicitGenerationId,
      sourceName: "BackgroundJobsStatusReporter"
    })

    await timeout({timeout: this.attemptTimeoutMs}, async ({control}) => {
      const request = new BackgroundJobsSocketRequest({host, port, role: "reporter", generationHandshakeTimeoutMs: this.generationHandshakeTimeoutMs, generationId})

      this._lastRequest = request

      await request.run({
        signal: control.signal,
        onConnect: (jsonSocket) => {
          jsonSocket.send({
            type: status === "completed" ? "job-complete" : status === "rescheduled" ? "job-reschedule" : "job-failed",
            jobId,
            delayMs,
            handoffId,
            workerId,
            handedOffAtMs,
            error: error ? normalizeBackgroundJobError(error) : undefined,
            runnerFailure
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
   * Runs report child accepted.
   * @param {object} args - Options.
   * @param {string} args.jobId - Job id.
   * @param {string} [args.handoffId] - Handoff lease id.
   * @param {string} [args.workerId] - Worker id.
   * @param {number} [args.handedOffAtMs] - Handed off timestamp.
   * @param {number} [args.receivedAtMs] - Epoch ms the runner child received the job.
   * @param {number} [args.startedAtMs] - Epoch ms the job's perform started in the child.
   * @param {string} [args.childInstanceId] - Stable pooled child identity.
   * @param {number} [args.childPid] - Pooled child OS pid.
   * @returns {Promise<void>} - Resolves when reported.
   */
  async reportChildAccepted({jobId, handoffId, workerId, handedOffAtMs, receivedAtMs, startedAtMs, childInstanceId, childPid}) {
    const config = this.configuration.getBackgroundJobsConfig()
    const host = this.host || config.host
    const port = typeof this.port === "number" ? this.port : config.port
    const {generationId} = this.configuration.resolveBackgroundJobsGenerationConfig({
      generationId: this.explicitGenerationId,
      sourceName: "BackgroundJobsStatusReporter"
    })

    await timeout({timeout: this.attemptTimeoutMs}, async ({control}) => {
      const request = new BackgroundJobsSocketRequest({host, port, role: "reporter", generationHandshakeTimeoutMs: this.generationHandshakeTimeoutMs, generationId})

      this._lastRequest = request

      await request.run({
        signal: control.signal,
        onConnect: (jsonSocket) => {
          jsonSocket.send({
            type: "job-accepted",
            jobId,
            handoffId,
            workerId,
            handedOffAtMs,
            receivedAtMs,
            startedAtMs,
            childInstanceId,
            childPid
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
   * Runs report child accepted with retry. Acceptance evidence is diagnostic
   * rather than terminal, so a transient main/DB failure retries only until
   * `maxDurationMs` elapses and then gives up instead of stranding the report.
   * @param {object} args - Options.
   * @param {string} args.jobId - Job id.
   * @param {string} [args.handoffId] - Handoff lease id.
   * @param {string} [args.workerId] - Worker id.
   * @param {number} [args.handedOffAtMs] - Handed off timestamp.
   * @param {number} [args.receivedAtMs] - Epoch ms the runner child received the job.
   * @param {number} [args.startedAtMs] - Epoch ms the job's perform started in the child.
   * @param {string} [args.childInstanceId] - Stable pooled child identity.
   * @param {number} [args.childPid] - Pooled child OS pid.
   * @param {number} args.maxDurationMs - Max duration for retries.
   * @returns {Promise<void>} - Resolves when reported or the budget elapses.
   */
  async reportChildAcceptedWithRetry({jobId, handoffId, workerId, handedOffAtMs, receivedAtMs, startedAtMs, childInstanceId, childPid, maxDurationMs}) {
    let attempt = 0
    const startTime = Date.now()

    while (true) {
      try {
        await this.reportChildAccepted({jobId, handoffId, workerId, handedOffAtMs, receivedAtMs, startedAtMs, childInstanceId, childPid})
        return
      } catch (error) {
        attempt += 1
        const delaySeconds = Math.min(30, 0.5 * attempt)

        this.logger.debug(() => ["Background job child-acceptance report failed, retrying", error])

        if (Date.now() - startTime >= maxDurationMs) {
          this.logger.warn(() => ["Background job child-acceptance report timed out, giving up", error])
          throw error
        }

        await wait(delaySeconds)
      }
    }
  }

  /**
   * Runs report with retry.
   * @param {object} args - Options.
   * @param {string} args.jobId - Job id.
   * @param {"completed" | "failed" | "rescheduled"} args.status - Status.
   * @param {number} [args.delayMs] - Reschedule delay in milliseconds.
   * @param {ReturnType<typeof JSON.parse>} [args.error] - Error.
   * @param {string} [args.handoffId] - Handoff lease id.
   * @param {number} [args.handedOffAtMs] - Handed off timestamp.
   * @param {string} [args.workerId] - Worker id.
   * @param {import("./types.js").PooledRunnerFailure} [args.runnerFailure] - Pooled-child process failure provenance.
   * @param {number} [args.maxDurationMs] - Max duration for retries.
   * @param {boolean} [args.retryPersistErrors] - Retry a `BackgroundJobUpdateError` (main's `job-update-error`, i.e. a transient DB failure while persisting the terminal status) instead of throwing immediately. Off by default so short-lived forked/spawned runners keep failing loudly and exit non-zero to be reclaimed; on for the long-lived worker, which cannot exit to trigger orphan reclaim and would otherwise drop the completion and strand the row in `handed_off`.
   * @returns {Promise<void>} - Resolves when reported.
   */
  async reportWithRetry({jobId, status, delayMs, error, handoffId, handedOffAtMs, workerId, runnerFailure, maxDurationMs, retryPersistErrors = false}) {
    let attempt = 0
    const startTime = Date.now()

    while (true) {
      try {
        await this.report({jobId, status, delayMs, error, handoffId, handedOffAtMs, workerId, runnerFailure})
        return
      } catch (error) {
        // A `BackgroundJobUpdateError` means main answered `job-update-error`, which it
        // only sends when `store.markCompleted`/`markFailed` THROWS — a transient DB
        // failure (deadlock, connection reset, lock-wait timeout, or main's cold
        // connection pool right after a deploy restart). Every logical rejection (job
        // gone, stale handoff lease, already terminal) instead answers `job-updated`,
        // so an update error is always the transient, retryable kind. It is retried
        // only for the long-lived worker (`retryPersistErrors`), which cannot exit to
        // trigger orphan reclaim and would otherwise drop the completion and strand the
        // row in `handed_off` forever — fatal for a `max_concurrency: 1` job such as a
        // build/queue planner, whose single stranded row blocks every future run.
        // Forked/spawned runners keep throwing it so they exit non-zero and are
        // reclaimed instead. Bounded by `maxDurationMs` either way.
        if (error instanceof BackgroundJobUpdateError && !retryPersistErrors) throw error

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
