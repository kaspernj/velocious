// @ts-check

import net from "net"
import timeout from "awaitery/build/timeout.js"
import wait from "awaitery/build/wait.js"
import JsonSocket from "./json-socket.js"
import {Logger} from "../logger.js"

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
   * @returns {Promise<void>} - Resolves when reported.
   */
  async report({jobId, status, error}) {
    const config = this.configuration.getBackgroundJobsConfig()
    const host = this.host || config.host
    const port = typeof this.port === "number" ? this.port : config.port

    await timeout({timeout: 5}, async () => {
      await new Promise((resolve, reject) => {
        const socket = net.createConnection({host, port})
        const jsonSocket = new JsonSocket(socket)

        const cleanup = () => {
          jsonSocket.removeAllListeners()
        }

        jsonSocket.on("error", (err) => {
          cleanup()
          reject(err)
        })

        jsonSocket.on("message", (message) => {
          if (message?.type === "job-updated" && message.jobId === jobId) {
            cleanup()
            jsonSocket.close()
            resolve(undefined)
            return
          }

          if (message?.type === "job-update-error" && message.jobId === jobId) {
            cleanup()
            jsonSocket.close()
            reject(new Error(message.error || "Job update failed"))
          }
        })

        socket.on("connect", () => {
          jsonSocket.send({type: "hello", role: "reporter"})
          jsonSocket.send({
            type: status === "completed" ? "job-complete" : "job-failed",
            jobId,
            error: error ? this._normalizeError(error) : undefined
          })
        })
      })
    })
  }

  /**
   * @param {object} args - Options.
   * @param {string} args.jobId - Job id.
   * @param {"completed" | "failed"} args.status - Status.
   * @param {unknown} [args.error] - Error.
   * @returns {Promise<void>} - Resolves when reported.
   */
  async reportWithRetry({jobId, status, error}) {
    let attempt = 0

    while (true) {
      try {
        await this.report({jobId, status, error})
        return
      } catch (err) {
        attempt += 1
        const delaySeconds = Math.min(30, 0.5 * attempt)

        this.logger.debug(() => ["Background job status report failed, retrying", err])

        await wait(delaySeconds)
      }
    }
  }

  _normalizeError(error) {
    if (error instanceof Error) return error.stack || error.message
    if (typeof error === "string") return error

    try {
      return JSON.stringify(error)
    } catch {
      return String(error)
    }
  }
}
