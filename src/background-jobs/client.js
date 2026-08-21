// @ts-check

import timeout from "awaitery/build/timeout.js"
import configurationResolver from "../configuration-resolver.js"
import BackgroundJobsSocketRequest from "./socket-request.js"

const DEFAULT_ENQUEUE_TIMEOUT_MS = 5000

export default class BackgroundJobsClient {
  /**
   * Runs constructor.
   * @param {object} [args] - Options.
   * @param {import("../configuration.js").default} [args.configuration] - Configuration.
   * @param {number} [args.enqueueTimeoutMs] - Maximum time to wait for an enqueue acknowledgement in milliseconds (default: 5000).
   */
  constructor({configuration, enqueueTimeoutMs = DEFAULT_ENQUEUE_TIMEOUT_MS} = {}) {
    this.configurationPromise = configuration ? Promise.resolve(configuration) : configurationResolver()
    this.enqueueTimeoutMs = enqueueTimeoutMs
  }

  /**
   * Builds a one-shot client socket request from the resolved configuration.
   * @returns {Promise<BackgroundJobsSocketRequest>} - Socket request.
   */
  async _request() {
    const configuration = await this.configurationPromise
    const {host, port} = configuration.getBackgroundJobsConfig()

    return new BackgroundJobsSocketRequest({host, port, role: "client"})
  }

  /**
   * Runs enqueue.
   * @param {object} args - Options.
   * @param {string} args.jobName - Job name.
   * @param {Array<ReturnType<typeof JSON.parse>>} args.args - Job args.
   * @param {import("./types.js").BackgroundJobOptions} [args.options] - Job options.
   * @returns {Promise<string>} - Job id.
   */
  async enqueue({jobName, args, options}) {
    const request = await this._request()

    return await timeout({
      errorMessage: `Background job enqueue acknowledgement timed out after ${this.enqueueTimeoutMs}ms`,
      timeout: this.enqueueTimeoutMs
    }, async ({control}) => await request.run({
      signal: control.signal,
      onConnect: (jsonSocket) => {
        jsonSocket.send({
          type: "enqueue",
          jobName,
          args,
          options
        })
      },
      onMessage: ({message, resolve, reject}) => {
        if (message?.type === "enqueued") {
          resolve(message.jobId)
          return
        }

        if (message?.type === "enqueue-error") {
          reject(new Error(message.error || "Failed to enqueue job"))
        }
      }
    }))
  }

  /**
   * Atomically replaces the queued owner of a stable schedule key.
   * @param {object} args - Options.
   * @param {string} args.scheduleKey - Stable logical schedule key.
   * @param {string} args.jobName - Job name.
   * @param {Array<ReturnType<typeof JSON.parse>>} args.args - Job args.
   * @param {import("./types.js").BackgroundJobOptions} [args.options] - Job options.
   * @returns {Promise<import("./types.js").BackgroundJobReplacementResult>} - Replacement result.
   */
  async replaceScheduled({scheduleKey, jobName, args, options}) {
    const request = await this._request()

    return await request.run({
      onConnect: (jsonSocket) => {
        jsonSocket.send({type: "replace-scheduled", scheduleKey, jobName, args, options})
      },
      onMessage: ({message, resolve, reject}) => {
        if (message?.type === "schedule-replaced") {
          resolve({
            jobId: message.jobId,
            previousJobId: message.previousJobId,
            previousStatus: message.previousStatus
          })
          return
        }

        if (message?.type === "replace-scheduled-error") {
          reject(new Error(message.error || "Failed to replace scheduled job"))
        }
      }
    })
  }

  /**
   * Cancels or detaches the current owner of a stable schedule key.
   * @param {object} args - Options.
   * @param {string} args.scheduleKey - Stable logical schedule key.
   * @returns {Promise<import("./types.js").BackgroundJobCancellationResult>} - Cancellation result.
   */
  async cancelScheduled({scheduleKey}) {
    const request = await this._request()

    return await request.run({
      onConnect: (jsonSocket) => {
        jsonSocket.send({type: "cancel-scheduled", scheduleKey})
      },
      onMessage: ({message, resolve, reject}) => {
        if (message?.type === "schedule-cancelled") {
          resolve({jobId: message.jobId, outcome: message.outcome})
          return
        }

        if (message?.type === "cancel-scheduled-error") {
          reject(new Error(message.error || "Failed to cancel scheduled job"))
        }
      }
    })
  }
}
