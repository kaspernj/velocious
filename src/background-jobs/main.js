// @ts-check

import net from "net"
import JsonSocket from "./json-socket.js"
import BackgroundJobsStore from "./store.js"
import Logger from "../logger.js"

export default class BackgroundJobsMain {
  /**
   * @param {object} args - Options.
   * @param {import("../configuration.js").default} args.configuration - Configuration.
   * @param {string} [args.host] - Hostname.
   * @param {number} [args.port] - Port.
   */
  constructor({configuration, host, port}) {
    this.configuration = configuration
    const config = configuration.getBackgroundJobsConfig()
    this.host = host || config.host
    this.port = typeof port === "number" ? port : config.port
    this.store = new BackgroundJobsStore({configuration, databaseIdentifier: config.databaseIdentifier})
    this.logger = new Logger(this)
    /** @type {Set<JsonSocket>} */
    this.workers = new Set()
    /** @type {Set<JsonSocket>} */
    this.readyWorkers = new Set()
    this._dispatching = false
  }

  /**
   * @returns {Promise<void>} - Resolves when listening.
   */
  async start() {
    this.configuration.setCurrent()
    await this.configuration.initialize({type: "background-jobs-main"})
    await this.store.ensureReady()
    this.server = net.createServer((socket) => this._handleConnection(socket))

    await new Promise((resolve, reject) => {
      this.server.once("error", reject)
      this.server.listen(this.port, this.host, () => resolve(undefined))
    })

    const address = this.server.address()
    if (address && typeof address === "object") {
      this.port = address.port
    }

    this._dispatchTimer = setInterval(() => {
      void this._dispatch()
    }, 1000)

    this._orphanTimer = setInterval(() => {
      void this._sweepOrphans()
    }, 60000)
  }

  /**
   * @returns {Promise<void>} - Resolves when closed.
   */
  async stop() {
    for (const worker of this.workers) {
      worker.close()
    }

    if (this._dispatchTimer) clearInterval(this._dispatchTimer)
    if (this._orphanTimer) clearInterval(this._orphanTimer)

    if (!this.server) return

    await new Promise((resolve) => this.server.close(() => resolve(undefined)))
  }

  /**
   * @returns {number} - Bound port.
   */
  getPort() {
    return this.port
  }

  /**
   * @param {import("net").Socket} socket - Socket.
   * @returns {void}
   */
  _handleConnection(socket) {
    const jsonSocket = new JsonSocket(socket)
    let role = null

    const cleanup = () => {
      if (role === "worker") {
        this.workers.delete(jsonSocket)
        this.readyWorkers.delete(jsonSocket)
      }
    }

    jsonSocket.on("close", cleanup)
    jsonSocket.on("error", (error) => {
      this.logger.warn(() => ["Background jobs connection error:", error])
      cleanup()
    })

    jsonSocket.on("message", (message) => {
      if (!role && message?.type === "hello") {
        role = message.role

        if (role === "worker") {
          jsonSocket.workerId = message.workerId
          this.workers.add(jsonSocket)
          this.readyWorkers.add(jsonSocket)
          this._dispatch()
        }

        return
      }

      if (role === "client" && message?.type === "enqueue") {
        this._handleEnqueue({jsonSocket, message})
        return
      }

      if (role === "worker" && message?.type === "ready") {
        this.readyWorkers.add(jsonSocket)
        this._dispatch()
        return
      }

      if ((role === "worker" || role === "reporter") && message?.type === "job-complete") {
        this._handleJobComplete({jsonSocket, message})
        return
      }

      if ((role === "worker" || role === "reporter") && message?.type === "job-failed") {
        this._handleJobFailed({jsonSocket, message})
      }
    })
  }

  async _handleEnqueue({jsonSocket, message}) {
    try {
      const jobId = await this.store.enqueue({
        jobName: message.jobName,
        args: message.args || [],
        options: message.options || {}
      })

      jsonSocket.send({type: "enqueued", jobId})
      await this._dispatch()
    } catch (error) {
      this.logger.error(() => ["Failed to enqueue background job:", error])
      jsonSocket.send({type: "enqueue-error", error: "Failed to enqueue job"})
    }
  }

  async _handleJobComplete({jsonSocket, message}) {
    try {
      await this.store.markCompleted({
        jobId: message.jobId,
        workerId: message.workerId,
        handedOffAtMs: message.handedOffAtMs
      })
      jsonSocket.send({type: "job-updated", jobId: message.jobId})
    } catch (error) {
      this.logger.error(() => ["Failed to update job completion:", error])
      jsonSocket.send({type: "job-update-error", jobId: message.jobId, error: "Failed to update job"})
    }
  }

  async _handleJobFailed({jsonSocket, message}) {
    try {
      await this.store.markFailed({
        jobId: message.jobId,
        error: message.error,
        workerId: message.workerId,
        handedOffAtMs: message.handedOffAtMs
      })
      jsonSocket.send({type: "job-updated", jobId: message.jobId})
      await this._dispatch()
    } catch (error) {
      this.logger.error(() => ["Failed to update job failure:", error])
      jsonSocket.send({type: "job-update-error", jobId: message.jobId, error: "Failed to update job"})
    }
  }

  async _dispatch() {
    if (this._dispatching) return
    if (this.readyWorkers.size === 0) return

    this._dispatching = true

    try {
      while (this.readyWorkers.size > 0) {
        const job = await this.store.nextAvailableJob()
        if (!job) return

        const [worker] = this.readyWorkers
        if (!worker) return

        this.readyWorkers.delete(worker)

        const handedOffAtMs = await this.store.markHandedOff({jobId: job.id, workerId: worker.workerId})

        try {
          worker.send({
            type: "job",
            payload: {
              id: job.id,
              jobName: job.jobName,
              args: job.args,
              workerId: worker.workerId,
              handedOffAtMs,
              options: {
                forked: job.forked
              }
            }
          })
        } catch (error) {
          this.logger.warn(() => ["Failed to send job to worker, re-queueing:", error])
          await this.store.markReturnedToQueue({jobId: job.id})
          this.readyWorkers.add(worker)
        }
      }
    } finally {
      this._dispatching = false
    }
  }

  async _sweepOrphans() {
    try {
      const count = await this.store.markOrphanedJobs()

      if (count > 0) {
        this.logger.warn(() => ["Marked orphaned background jobs", count])
      }
    } catch (error) {
      this.logger.error(() => ["Failed to mark orphaned jobs:", error])
    }
  }
}
