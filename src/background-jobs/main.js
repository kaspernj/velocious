// @ts-check

import net from "net"
import JsonSocket from "./json-socket.js"
import BackgroundJobsScheduler from "./scheduler.js"
import BackgroundJobsStore from "./store.js"
import Logger from "../logger.js"

/**
 * Channel used by `background-jobs-main` to coordinate dispatch wake-ups
 * across processes via Beacon. Workers do NOT subscribe to this channel
 * — they already receive job-handoff messages on their JsonSocket to
 * main; this channel exists so cross-process enqueues (or future
 * multi-main deployments) can poke an idle main to drain.
 */
const DISPATCH_CHANNEL = "velocious-background-jobs-dispatch"

/**
 * `setTimeout` is implemented with 32-bit signed delays on Node; passing
 * anything larger silently clamps to 1ms and fires immediately. Cap the
 * scheduled-job timer here and re-arm when it expires.
 */
const MAX_TIMER_MS = 2_147_483_647 // ~24.8 days

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
    this.dispatchStrategy = config.dispatchStrategy
    this.pollIntervalMs = config.pollIntervalMs
    this.store = new BackgroundJobsStore({configuration, databaseIdentifier: config.databaseIdentifier})
    this.logger = new Logger(this)
    /** @type {Set<JsonSocket>} */
    this.workers = new Set()
    /** @type {Set<JsonSocket>} */
    this.readyWorkers = new Set()
    /** @type {net.Server | undefined} */
    this.server = undefined
    /** @type {NodeJS.Timeout | undefined} */
    this._pollTimer = undefined
    /** @type {NodeJS.Timeout | undefined} */
    this._scheduledTimer = undefined
    /** @type {NodeJS.Timeout | undefined} */
    this._errorRetryTimer = undefined
    /** @type {NodeJS.Timeout | undefined} */
    this._orphanTimer = undefined
    /** @type {BackgroundJobsScheduler | undefined} */
    this.scheduler = undefined
    this._draining = false
    this._redrainQueued = false
    this._stopped = false
    /** @type {(() => void) | undefined} */
    this._unsubscribeBeacon = undefined
    /** @type {((...args: any[]) => void) | undefined} */
    this._beaconConnectHandler = undefined
    /** @type {import("../beacon/client.js").default | import("../beacon/in-process-client.js").default | undefined} */
    this._beaconClient = undefined
  }

  /**
   * @returns {Promise<void>} - Resolves when listening.
   */
  async start() {
    this._stopped = false
    this.configuration.setCurrent()
    await this.configuration.initialize({type: "background-jobs-main"})
    await this.configuration.connectBeacon({peerType: "background-jobs-main"})
    await this.store.ensureReady()
    const server = net.createServer((socket) => this._handleConnection(socket))
    this.server = server

    try {
      await new Promise((resolve, reject) => {
        server.once("error", reject)
        server.listen(this.port, this.host, () => resolve(undefined))
      })

      const address = server.address()
      if (address && typeof address === "object") {
        this.port = address.port
      }

      this._setupDispatchTriggers()

      this._orphanTimer = setInterval(() => {
        void this._sweepOrphans()
      }, 60000)

      this.scheduler = new BackgroundJobsScheduler({
        configuration: this.configuration,
        enqueueJob: async ({args, jobClass, options}) => {
          await this.store.enqueue({
            jobName: jobClass.jobName(),
            args,
            options
          })
          this._notifyEnqueued()
          await this._drain()
        }
      })
      await this.scheduler.start()

      // Startup catch-up: drain anything that was waiting before this
      // process came up. In beacon mode this is also the safety net for
      // races between attaching the connect listener and the initial
      // connect firing (the listener could miss the very first connect,
      // but this drain covers it).
      await this._drain()
    } catch (error) {
      await this.stop()
      throw error
    }
  }

  /**
   * @returns {Promise<void>} - Resolves when closed.
   */
  async stop() {
    this._stopped = true

    for (const worker of this.workers) {
      worker.close()
    }

    if (this._pollTimer) clearInterval(this._pollTimer)
    if (this._scheduledTimer) clearTimeout(this._scheduledTimer)
    if (this._errorRetryTimer) clearTimeout(this._errorRetryTimer)
    if (this._orphanTimer) clearInterval(this._orphanTimer)
    this._pollTimer = undefined
    this._scheduledTimer = undefined
    this._errorRetryTimer = undefined
    this._orphanTimer = undefined

    if (this._unsubscribeBeacon) {
      this._unsubscribeBeacon()
      this._unsubscribeBeacon = undefined
    }

    if (this._beaconClient && this._beaconConnectHandler) {
      this._beaconClient.off("connect", this._beaconConnectHandler)
    }
    this._beaconConnectHandler = undefined
    this._beaconClient = undefined

    this.scheduler?.stop()

    try {
      await this.configuration.disconnectBeacon()
    } finally {
      try {
        if (this.server) {
          const {server} = this
          this.server = undefined
          await new Promise((resolve) => server.close(() => resolve(undefined)))
        }
      } finally {
        await this.configuration.closeDatabaseConnections()
      }
    }
  }

  /**
   * @returns {number} - Bound port.
   */
  getPort() {
    return this.port
  }

  /**
   * Wires up the dispatch-triggering signal sources for the configured
   * strategy. In `"beacon"` mode (default) this means subscribing to the
   * `velocious-background-jobs-dispatch` channel for cross-process
   * wake-ups, listening for Beacon (re)connects to catch up on missed
   * work, and relying on direct in-process calls from `_handleEnqueue`,
   * `_handleJobComplete`/`Failed`, worker hello/ready, and the
   * scheduled-job `setTimeout`. In `"polling"` mode we restore the
   * legacy fixed-interval poll for users who want the previous behavior.
   * @returns {void}
   */
  _setupDispatchTriggers() {
    if (this.dispatchStrategy === "polling") {
      this._pollTimer = setInterval(() => {
        void this._drain()
      }, this.pollIntervalMs)
      return
    }

    const beaconClient = this.configuration.getBeaconClient()
    if (!beaconClient) return

    this._beaconClient = beaconClient

    this._unsubscribeBeacon = beaconClient.onBroadcast((message) => {
      if (message?.channel !== DISPATCH_CHANNEL) return
      void this._drain()
    })

    // Drain on every (re)connect to catch up on jobs enqueued while the
    // bus was unreachable. The DB is the durable log; Beacon is just the
    // wake-up signal.
    this._beaconConnectHandler = () => {
      void this._drain()
    }
    beaconClient.on("connect", this._beaconConnectHandler)
  }

  /**
   * Publishes a dispatch wake-up on the Beacon channel. No-op in polling
   * mode or when Beacon is not connected; in those cases the direct
   * in-process `_drain()` call in the enqueue/handle paths is sufficient
   * (there are no other processes to notify).
   * @returns {void}
   */
  _notifyEnqueued() {
    if (this.dispatchStrategy === "polling") return

    const beaconClient = this.configuration.getBeaconClient()
    if (!beaconClient || !beaconClient.isConnected()) return

    try {
      beaconClient.publish({
        channel: DISPATCH_CHANNEL,
        broadcastParams: {},
        body: {action: "wake"}
      })
    } catch (error) {
      this.logger.warn(() => ["Failed to publish background jobs wake broadcast:", error])
    }
  }

  /**
   * @param {import("net").Socket} socket - Socket.
   * @returns {void}
   */
  _handleConnection(socket) {
    const jsonSocket = new JsonSocket(socket)
    /** @type {import("./types.js").BackgroundJobSocketRole | null} */
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

    /** @param {import("./types.js").BackgroundJobSocketMessage} message - Socket message. */
    jsonSocket.on("message", (message) => {
      if (!role && message?.type === "hello") {
        role = message.role

        if (role === "worker") {
          jsonSocket.workerId = message.workerId
          this.workers.add(jsonSocket)
        }

        return
      }

      if (role === "client" && message?.type === "enqueue") {
        this._handleEnqueue({jsonSocket, message})
        return
      }

      if (role === "worker" && message?.type === "ready") {
        jsonSocket.acceptsForkedJobs = message.acceptsForked !== false
        jsonSocket.acceptsInlineJobs = message.acceptsInline !== false
        this.readyWorkers.add(jsonSocket)
        void this._drain()
        return
      }

      if (role === "worker" && message?.type === "draining") {
        // The worker is shutting down gracefully. Stop dispatching new jobs
        // to it but keep the connection in `workers` so any in-flight job
        // it's still draining can report its result.
        this.readyWorkers.delete(jsonSocket)
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

  /**
   * @param {object} args - Options.
   * @param {JsonSocket} args.jsonSocket - JSON socket.
   * @param {import("./types.js").BackgroundJobEnqueueMessage} args.message - Message.
   * @returns {Promise<void>} - Resolves when handled.
   */
  async _handleEnqueue({jsonSocket, message}) {
    try {
      const jobId = await this.store.enqueue({
        jobName: message.jobName,
        args: message.args || [],
        options: message.options || {}
      })

      jsonSocket.send({type: "enqueued", jobId})
      this._notifyEnqueued()
      await this._drain()
    } catch (error) {
      this.logger.error(() => ["Failed to enqueue background job:", error])
      jsonSocket.send({type: "enqueue-error", error: "Failed to enqueue job"})
    }
  }

  /**
   * @param {object} args - Options.
   * @param {JsonSocket} args.jsonSocket - JSON socket.
   * @param {import("./types.js").BackgroundJobCompleteMessage} args.message - Message.
   * @returns {Promise<void>} - Resolves when handled.
   */
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

  /**
   * @param {object} args - Options.
   * @param {JsonSocket} args.jsonSocket - JSON socket.
   * @param {import("./types.js").BackgroundJobFailedMessage} args.message - Message.
   * @returns {Promise<void>} - Resolves when handled.
   */
  async _handleJobFailed({jsonSocket, message}) {
    try {
      const failedJob = await this.store.markFailed({
        jobId: message.jobId,
        error: message.error,
        workerId: message.workerId,
        handedOffAtMs: message.handedOffAtMs
      })

      if (failedJob) {
        this._emitBackgroundJobFailed({
          error: message.error,
          handedOffAtMs: message.handedOffAtMs,
          job: failedJob,
          workerId: message.workerId
        })
      }

      jsonSocket.send({type: "job-updated", jobId: message.jobId})
      // A failed job may have been re-queued (with backoff) for retry —
      // poke the dispatcher so the retry timer is armed.
      this._notifyEnqueued()
      await this._drain()
    } catch (error) {
      this.logger.error(() => ["Failed to update job failure:", error])
      jsonSocket.send({type: "job-update-error", jobId: message.jobId, error: "Failed to update job"})
    }
  }

  /**
   * @param {{error: unknown, handedOffAtMs?: number, job: import("./types.js").BackgroundJobRow, workerId?: string}} args - Failure event data.
   * @returns {void}
   */
  _emitBackgroundJobFailed({error, handedOffAtMs, job, workerId}) {
    const normalizedError = this._normalizeFailureError(error)
    const payload = {
      context: {
        attempts: job.attempts,
        handedOffAtMs,
        jobArgs: job.args,
        jobId: job.id,
        jobName: job.jobName,
        maxRetries: job.maxRetries,
        stage: "background-job-failed",
        status: job.status,
        terminal: job.status === "failed" || job.status === "orphaned",
        willRetry: job.status === "queued",
        workerId
      },
      error: normalizedError
    }
    const errorEvents = this.configuration.getErrorEvents()

    errorEvents.emit("background-job-failed", payload)
    errorEvents.emit("all-error", {...payload, errorType: "background-job-failed"})
  }

  /**
   * @param {unknown} error - Reported failure value.
   * @returns {Error} Normalized error.
   */
  _normalizeFailureError(error) {
    if (error instanceof Error) return error

    const message = typeof error === "string" && error.trim()
      ? error.trim().split("\n")[0]
      : String(error || "Background job failed")
    const normalizedError = new Error(message)

    if (typeof error === "string" && error.trim()) {
      normalizedError.stack = error
    }

    return normalizedError
  }

  /**
   * Drains all dispatchable jobs to ready workers, then arms the
   * scheduled-job timer for the next future `scheduled_at_ms`. Coalesces
   * concurrent triggers: a wake-up that lands while a drain is in
   * flight just sets a re-drain flag and lets the in-flight drain
   * re-loop after it finishes, so no signal is dropped but no two
   * drains run in parallel.
   *
   * Resilience: in beacon mode this is the sole wake-up path for
   * already-queued work, so a transient DB error during the drain (e.g.
   * `nextAvailableJob()` rejecting) must not strand the queue until the
   * next external signal. On any error we log it and arm a one-shot
   * retry via `_scheduleErrorRetry` using `pollIntervalMs` as the
   * cadence; on success the retry timer is cleared. Polling-mode runs
   * `_drain` from its own interval, so the retry timer is a no-op there.
   * @returns {Promise<void>}
   */
  async _drain() {
    if (this._stopped) return

    if (this._draining) {
      this._redrainQueued = true
      return
    }

    this._draining = true
    let errored = false

    try {
      do {
        this._redrainQueued = false
        try {
          await this._drainOnce()
        } catch (error) {
          errored = true
          this.logger.error(() => ["Background jobs drain failed:", error])
          break
        }
      } while (this._redrainQueued && !this._stopped)
    } finally {
      this._draining = false
    }

    if (this._stopped) return

    if (errored) {
      this._scheduleErrorRetry()
      return
    }

    try {
      await this._armScheduledTimer()
    } catch (error) {
      this.logger.error(() => ["Background jobs scheduled-timer arming failed:", error])
      this._scheduleErrorRetry()
      return
    }

    if (this._errorRetryTimer) {
      clearTimeout(this._errorRetryTimer)
      this._errorRetryTimer = undefined
    }
  }

  /**
   * Arms a one-shot `setTimeout` to retry `_drain` after a transient
   * failure. Idempotent — repeated calls while a retry is already
   * pending are no-ops. Polling mode already retries via its own
   * interval, so this is a no-op in that mode.
   * @returns {void}
   */
  _scheduleErrorRetry() {
    if (this._stopped) return
    if (this._errorRetryTimer) return
    if (this.dispatchStrategy === "polling") return

    this._errorRetryTimer = setTimeout(() => {
      this._errorRetryTimer = undefined
      void this._drain()
    }, this.pollIntervalMs)
  }

  /**
   * Inner drain loop: pulls eligible queued jobs and hands them off to
   * ready workers until one of them runs out.
   * @returns {Promise<void>}
   */
  async _drainOnce() {
    while (this.readyWorkers.size > 0 && !this._stopped) {
      const job = await this.nextAvailableJobForReadyWorkers()
      if (!job) return

      const worker = this.readyWorkerForJob(job)
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
  }

  /**
   * @returns {Promise<import("./types.js").BackgroundJobRow | null>} - Next queued job matching ready worker capacity.
   */
  async nextAvailableJobForReadyWorkers() {
    const acceptsForked = this.readyWorkersAcceptForkedJobs()
    const acceptsInline = this.readyWorkersAcceptInlineJobs()

    if (!acceptsForked && !acceptsInline) return null
    if (acceptsForked && acceptsInline) return await this.store.nextAvailableJob()
    if (acceptsForked) return await this.store.nextAvailableJob({forked: true})

    return await this.store.nextAvailableJob({forked: false})
  }

  /** @returns {boolean} - Whether any ready worker can accept forked jobs. */
  readyWorkersAcceptForkedJobs() {
    for (const worker of this.readyWorkers) {
      if (worker.acceptsForkedJobs !== false) return true
    }

    return false
  }

  /** @returns {boolean} - Whether any ready worker can accept inline jobs. */
  readyWorkersAcceptInlineJobs() {
    for (const worker of this.readyWorkers) {
      if (worker.acceptsInlineJobs !== false) return true
    }

    return false
  }

  /**
   * @param {import("./types.js").BackgroundJobRow} job - Job being handed off.
   * @returns {JsonSocket | undefined} - Ready worker for the job type.
   */
  readyWorkerForJob(job) {
    for (const worker of this.readyWorkers) {
      if (job.forked && worker.acceptsForkedJobs !== false) return worker
      if (!job.forked && worker.acceptsInlineJobs !== false) return worker
    }
  }

  /**
   * Arms a single `setTimeout` for the soonest future-scheduled job's
   * `scheduled_at_ms`. Replaces the second responsibility of the legacy
   * 1-second poll (becoming-eligible scheduled jobs). The timer is
   * idempotently re-armed at the end of every drain.
   * @returns {Promise<void>}
   */
  async _armScheduledTimer() {
    if (this._scheduledTimer) {
      clearTimeout(this._scheduledTimer)
      this._scheduledTimer = undefined
    }

    if (this._stopped) return
    if (this.dispatchStrategy === "polling") return

    const next = await this.store.nextScheduledJob()
    if (!next || typeof next.scheduledAtMs !== "number") return

    const delay = Math.max(0, Math.min(next.scheduledAtMs - Date.now(), MAX_TIMER_MS))

    this._scheduledTimer = setTimeout(() => {
      this._scheduledTimer = undefined
      void this._drain()
    }, delay)
  }

  async _sweepOrphans() {
    try {
      const count = await this.store.markOrphanedJobs()

      if (count > 0) {
        this.logger.warn(() => ["Marked orphaned background jobs", count])
        // Reclaimed orphans become `queued` again — wake the dispatcher
        // so they aren't stranded until the next external signal.
        this._notifyEnqueued()
        await this._drain()
      }
    } catch (error) {
      this.logger.error(() => ["Failed to mark orphaned jobs:", error])
    }
  }
}
