// @ts-check

import net from "net"
import JsonSocket from "./json-socket.js"
import BackgroundJobsScheduler from "./scheduler.js"
import BackgroundJobsStore from "./store.js"
import Logger from "../logger.js"
import PruneTerminalBackgroundJobsJob from "../jobs/prune-terminal-background-jobs.js"
import VelociousError from "../velocious-error.js"

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
/** A worker silent (no heartbeat/ready/report) longer than this is dropped. */
const WORKER_STALE_TIMEOUT_MS = 60000
/** How often the main scans workers for staleness. */
const WORKER_LIVENESS_SWEEP_MS = 15000
/**
 * WorkerExecutionModeCapability type.
 * @typedef {object} WorkerExecutionModeCapability
 * @property {import("./types.js").BackgroundJobExecutionMode} executionMode - Execution mode.
 * @property {(worker: JsonSocket) => boolean} accepts - Whether the worker accepts this mode.
 */
/**
 * Worker execution mode capabilities.
 * @type {WorkerExecutionModeCapability[]} */
const WORKER_EXECUTION_MODE_CAPABILITIES = [
  {executionMode: "inline", accepts: (worker) => worker.acceptsInlineJobs !== false},
  {executionMode: "forked", accepts: (worker) => worker.acceptsForkedJobs !== false},
  {executionMode: "spawned", accepts: (worker) => worker.acceptsSpawnedJobs !== false}
]
const WORKER_EXECUTION_MODE_CAPABILITIES_BY_MODE = new Map(
  WORKER_EXECUTION_MODE_CAPABILITIES.map((capability) => [capability.executionMode, capability])
)

export default class BackgroundJobsMain {
  /**
   * Runs constructor.
   * @param {object} args - Options.
   * @param {import("../configuration.js").default} args.configuration - Configuration.
   * @param {string} [args.host] - Hostname.
   * @param {number} [args.port] - Port.
   * @param {number} [args.workerStaleTimeoutMs] - Override how long a silent worker may go before being dropped (default 60000ms).
   * @param {number} [args.workerLivenessSweepMs] - Override how often stale workers are swept for (default 15000ms).
   */
  constructor({configuration, host, port, workerStaleTimeoutMs, workerLivenessSweepMs}) {
    this.configuration = configuration
    const config = configuration.getBackgroundJobsConfig()
    this.host = host || config.host
    this.port = typeof port === "number" ? port : config.port
    this.dispatchStrategy = config.dispatchStrategy
    this.pollIntervalMs = config.pollIntervalMs
    this.retention = config.retention
    // A worker that stops sending anything (heartbeat/ready/report) for this
    // long is treated as wedged/dead: its leases are released and it is dropped.
    this.workerStaleTimeoutMs = typeof workerStaleTimeoutMs === "number" && workerStaleTimeoutMs >= 1 ? workerStaleTimeoutMs : WORKER_STALE_TIMEOUT_MS
    this.workerLivenessSweepMs = typeof workerLivenessSweepMs === "number" && workerLivenessSweepMs >= 1 ? workerLivenessSweepMs : WORKER_LIVENESS_SWEEP_MS
    this.store = new BackgroundJobsStore({configuration, databaseIdentifier: config.databaseIdentifier})
    this.logger = new Logger(this)
    /**
     * Narrows the runtime value to the documented type.
     * @type {Set<JsonSocket>} */
    this.workers = new Set()
    /**
     * Narrows the runtime value to the documented type.
     * @type {Set<JsonSocket>} */
    this.readyWorkers = new Set()
    /**
     * Active durable handoffs keyed by the exact worker socket that received them.
     * @type {Map<JsonSocket, Map<string, string>>} */
    this.workerHandoffs = new Map()
    /**
     * Narrows the runtime value to the documented type.
     * @type {net.Server | undefined} */
    this.server = undefined
    /**
     * Narrows the runtime value to the documented type.
     * @type {ReturnType<typeof setTimeout> | undefined} */
    this._pollTimer = undefined
    /**
     * Narrows the runtime value to the documented type.
     * @type {ReturnType<typeof setTimeout> | undefined} */
    this._scheduledTimer = undefined
    /**
     * Narrows the runtime value to the documented type.
     * @type {ReturnType<typeof setTimeout> | undefined} */
    this._errorRetryTimer = undefined
    /**
     * Narrows the runtime value to the documented type.
     * @type {ReturnType<typeof setTimeout> | undefined} */
    this._orphanTimer = undefined
    /**
     * Narrows the runtime value to the documented type.
     * @type {ReturnType<typeof setInterval> | undefined} */
    this._workerStaleTimer = undefined
    /**
     * Narrows the runtime value to the documented type.
     * @type {BackgroundJobsScheduler | undefined} */
    this.scheduler = undefined
    this._draining = false
    this._redrainQueued = false
    this._stopped = false
    /**
     * Narrows the runtime value to the documented type.
     * @type {(() => void) | undefined} */
    this._unsubscribeBeacon = undefined
    /**
     * Narrows the runtime value to the documented type.
     * @type {((...args: Array<?>) => void) | undefined} */
    this._beaconConnectHandler = undefined
    /**
     * Narrows the runtime value to the documented type.
     * @type {import("../beacon/client.js").default | import("../beacon/in-process-client.js").default | undefined} */
    this._beaconClient = undefined
  }

  /**
   * Runs start.
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

      this._workerStaleTimer = setInterval(() => {
        void this._sweepStaleWorkers()
      }, this.workerLivenessSweepMs)

      this.scheduler = new BackgroundJobsScheduler({
        configuration: this.configuration,
        enqueueJob: async ({args, jobClass, options}) => {
          await this.store.enqueue({
            jobName: jobClass.jobName(),
            args,
            // Fold in the job class's static `queue` (as performLater* do) so a
            // scheduled job with `static queue = "..."` lands on its queue and
            // honors the configured cap without every schedule repeating it.
            options: jobClass._withQueue(options)
          })
          this._notifyEnqueued()
          await this._drain()
        }
      })
      await this.scheduler.start()

      // Retention pruning runs as an ordinary scheduled job on the normal
      // scheduler (so it is visible in the job tables and dispatched to a
      // worker), rather than a hidden in-process timer. Skipped when retention
      // is disabled. The scheduler owns the timer, so scheduler.stop() clears it.
      const retentionSchedule = PruneTerminalBackgroundJobsJob.scheduleConfiguration(this.retention)

      if (retentionSchedule) {
        this.scheduler.scheduleJob({jobConfiguration: retentionSchedule, jobKey: "velociousPruneTerminalBackgroundJobs"})
      }

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
   * Runs stop.
   * @returns {Promise<void>} - Resolves when closed.
   */
  async stop() {
    this._stopped = true

    this._closeWorkers()
    this._clearTimers()
    this._disconnectBeaconHandlers()
    this.scheduler?.stop()

    await this._stopBeaconAndServer()
  }

  /**
   * Runs close workers.
   * @returns {void} */
  _closeWorkers() {
    for (const worker of this.workers) {
      worker.close()
    }
  }

  /**
   * Runs clear timers.
   * @returns {void} */
  _clearTimers() {
    if (this._pollTimer) clearInterval(this._pollTimer)
    if (this._scheduledTimer) clearTimeout(this._scheduledTimer)
    if (this._errorRetryTimer) clearTimeout(this._errorRetryTimer)
    if (this._orphanTimer) clearInterval(this._orphanTimer)
    if (this._workerStaleTimer) clearInterval(this._workerStaleTimer)
    this._pollTimer = undefined
    this._scheduledTimer = undefined
    this._errorRetryTimer = undefined
    this._orphanTimer = undefined
    this._workerStaleTimer = undefined
  }

  /**
   * Runs disconnect beacon handlers.
   * @returns {void} */
  _disconnectBeaconHandlers() {
    if (this._unsubscribeBeacon) {
      this._unsubscribeBeacon()
      this._unsubscribeBeacon = undefined
    }

    if (this._beaconClient && this._beaconConnectHandler) {
      this._beaconClient.off("connect", this._beaconConnectHandler)
    }
    this._beaconConnectHandler = undefined
    this._beaconClient = undefined
  }

  /**
   * Runs stop beacon and server.
   * @returns {Promise<void>} */
  async _stopBeaconAndServer() {
    try {
      await this.configuration.disconnectBeacon()
    } finally {
      await this._closeServerAndDatabaseConnections()
    }
  }

  /**
   * Runs close server and database connections.
   * @returns {Promise<void>} */
  async _closeServerAndDatabaseConnections() {
    try {
      await this._closeServer()
    } finally {
      await this.configuration.closeDatabaseConnections()
    }
  }

  /**
   * Runs close server.
   * @returns {Promise<void>} */
  async _closeServer() {
    if (!this.server) return

    const {server} = this
    this.server = undefined
    await new Promise((resolve) => server.close(() => resolve(undefined)))
  }

  /**
   * Runs get port.
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
        void this._retryAfterError()
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
   * Runs handle connection.
   * @param {import("net").Socket} socket - Socket.
   * @returns {void}
   */
  _handleConnection(socket) {
    const jsonSocket = new JsonSocket(socket)
    /**
     * Role.
     * @type {import("./types.js").BackgroundJobSocketRole | null} */
    let role = null

    let cleanedUp = false
    const cleanup = () => {
      if (cleanedUp) return
      cleanedUp = true

      if (role === "worker") void this._handleWorkerSocketClosed(jsonSocket)
    }

    jsonSocket.on("close", cleanup)
    jsonSocket.on("error", (error) => {
      this.logger.warn(() => ["Background jobs connection error:", error])
      cleanup()
    })

    jsonSocket.on("message", (message) => {
      role = this._handleSocketMessage({jsonSocket, message, role})
    })
  }

  /**
   * Runs handle socket message.
   * @param {object} args - Options.
   * @param {JsonSocket} args.jsonSocket - JSON socket.
   * @param {import("./types.js").BackgroundJobSocketMessage} args.message - Socket message.
   * @param {import("./types.js").BackgroundJobSocketRole | null} args.role - Current socket role.
   * @returns {import("./types.js").BackgroundJobSocketRole | null} - Updated socket role.
   */
  _handleSocketMessage({jsonSocket, message, role}) {
    if (!role) return this._handleRolelessSocketMessage({jsonSocket, message})
    if (role === "client") this._handleClientSocketMessage({jsonSocket, message})
    if (role === "worker") this._handleWorkerSocketMessage({jsonSocket, message})
    if (role === "reporter") this._handleReporterSocketMessage({jsonSocket, message})

    return role
  }

  /**
   * Runs handle roleless socket message.
   * @param {object} args - Options.
   * @param {JsonSocket} args.jsonSocket - JSON socket.
   * @param {import("./types.js").BackgroundJobSocketMessage} args.message - Socket message.
   * @returns {import("./types.js").BackgroundJobSocketRole | null} - New socket role.
   */
  _handleRolelessSocketMessage({jsonSocket, message}) {
    if (message?.type !== "hello") return null

    if (message.role === "worker") {
      jsonSocket.workerId = message.workerId
      jsonSocket.supportsHandoffIdReporting = message.supportsHandoffIdReporting === true
      jsonSocket.supportsHeartbeat = message.supportsHeartbeat === true
      jsonSocket.lastSeenAt = Date.now()
      this.workers.add(jsonSocket)
      this.workerHandoffs.set(jsonSocket, new Map())
      void this._adoptWorkerHandoffs(jsonSocket)
    }

    return message.role
  }

  /**
   * Adopts a reconnecting worker's still-active `handed_off` jobs into its new
   * socket's handoff map. A fresh main (e.g. after a deploy restart) holds no
   * in-memory leases, so a worker that reconnects with its stable id would
   * otherwise have its pre-restart jobs tracked nowhere — if it then died, those
   * leases (and their concurrency reservations) would sit stuck until the
   * hours-long orphan sweep. Adopting them means `_handleWorkerSocketClosed`
   * releases them on the worker's next disconnect, while a still-running worker
   * (including one gracefully draining) keeps executing them untouched. No
   * time-based reclaim is used, so a draining worker whose jobs outlive the old
   * main is never wrongly requeued into a duplicate attempt.
   * @param {JsonSocket} jsonSocket - The reconnected worker socket.
   * @returns {Promise<void>}
   */
  async _adoptWorkerHandoffs(jsonSocket) {
    const workerId = jsonSocket.workerId

    if (typeof workerId !== "string" || workerId.length === 0) return

    try {
      const handoffs = await this.store.handedOffJobsForWorker({workerId})
      const map = this.workerHandoffs.get(jsonSocket)

      // The socket may have closed while the query was in flight; its map is then
      // gone and the jobs are left for the orphan sweep rather than resurrected.
      if (!map || !this.workers.has(jsonSocket)) return

      for (const {jobId, handoffId} of handoffs) {
        map.set(jobId, handoffId)
      }
    } catch (error) {
      this._reportHandoffAdoptError(error)
    }
  }

  /**
   * Runs handle client socket message.
   * @param {object} args - Options.
   * @param {JsonSocket} args.jsonSocket - JSON socket.
   * @param {import("./types.js").BackgroundJobSocketMessage} args.message - Socket message.
   * @returns {void}
   */
  _handleClientSocketMessage({jsonSocket, message}) {
    if (message?.type === "enqueue") {
      this._handleEnqueue({jsonSocket, message})
    }
  }

  /**
   * Runs handle worker socket message.
   * @param {object} args - Options.
   * @param {JsonSocket} args.jsonSocket - JSON socket.
   * @param {import("./types.js").BackgroundJobSocketMessage} args.message - Socket message.
   * @returns {void}
   */
  _handleWorkerSocketMessage({jsonSocket, message}) {
    // Any message from the worker proves it is alive; the liveness sweep uses
    // this to detect a wedged/silent worker.
    jsonSocket.lastSeenAt = Date.now()

    if (message?.type === "heartbeat") {
      return
    }

    if (message?.type === "ready") {
      this._handleWorkerReady({jsonSocket, message})
      return
    }

    if (message?.type === "draining") {
      this._handleWorkerDraining({jsonSocket})
      return
    }

    this._handleReporterSocketMessage({jsonSocket, message})
  }

  /**
   * Runs handle reporter socket message.
   * @param {object} args - Options.
   * @param {JsonSocket} args.jsonSocket - JSON socket.
   * @param {import("./types.js").BackgroundJobSocketMessage} args.message - Socket message.
   * @returns {void}
   */
  _handleReporterSocketMessage({jsonSocket, message}) {
    if (message?.type === "job-complete") {
      this._handleJobComplete({jsonSocket, message})
      return
    }

    if (message?.type === "job-failed") {
      this._handleJobFailed({jsonSocket, message})
    }
  }

  /**
   * Runs handle worker ready.
   * @param {object} args - Options.
   * @param {JsonSocket} args.jsonSocket - JSON socket.
   * @param {import("./types.js").BackgroundJobReadyMessage} args.message - Ready message.
   * @returns {void}
   */
  _handleWorkerReady({jsonSocket, message}) {
    jsonSocket.acceptsSpawnedJobs = message.acceptsSpawned !== false && message.acceptsForked !== false
    jsonSocket.acceptsForkedJobs = message.acceptsForked !== false
    jsonSocket.acceptsInlineJobs = message.acceptsInline !== false
    if (jsonSocket.supportsHandoffIdReporting) {
      this.readyWorkers.add(jsonSocket)
    } else {
      this.readyWorkers.delete(jsonSocket)
    }
    void this._drain()
  }

  /**
   * Runs handle worker draining.
   * @param {object} args - Options.
   * @param {JsonSocket} args.jsonSocket - JSON socket.
   * @returns {void}
   */
  _handleWorkerDraining({jsonSocket}) {
    // The worker is shutting down gracefully. Stop dispatching new jobs
    // to it but keep the connection in `workers` so any in-flight job
    // it's still draining can report its result.
    this.readyWorkers.delete(jsonSocket)
  }

  /**
   * Removes a lost worker socket and releases only leases dispatched through it.
   * @param {JsonSocket} worker - Disconnected worker socket.
   * @returns {Promise<void>} - Resolves after its active leases are released.
   */
  async _handleWorkerSocketClosed(worker) {
    this.workers.delete(worker)
    this.readyWorkers.delete(worker)

    if (this._stopped) {
      this.workerHandoffs.delete(worker)
      return
    }

    try {
      await this._releaseWorkerHandoffs(worker)
    } catch (error) {
      this._reportHandoffReleaseError(error)
      this._scheduleErrorRetry()
    }
  }

  /**
   * Releases all leases still owned by one exact worker socket.
   * @param {JsonSocket} worker - Worker socket.
   * @returns {Promise<void>} - Resolves after fenced releases and dispatch wake-up.
   */
  async _releaseWorkerHandoffs(worker) {
    const handoffs = this.workerHandoffs.get(worker)

    if (!handoffs || handoffs.size === 0) {
      this.workerHandoffs.delete(worker)
      return
    }

    for (const [jobId, handoffId] of handoffs) {
      await this._releaseHandoff({handoffId, jobId, worker})
    }

    this.workerHandoffs.delete(worker)
    this._notifyEnqueued()
    await this._drain()
  }

  /**
   * Runs one idempotent conditional lease release.
   * @param {object} args - Options.
   * @param {string} args.handoffId - Handoff lease id.
   * @param {string} args.jobId - Job id.
   * @param {JsonSocket} args.worker - Socket that received the lease.
   * @returns {Promise<void>} - Resolves after the fenced transition.
   */
  async _releaseHandoff({handoffId, jobId, worker}) {
    await this.store.markReturnedToQueue({handoffId, jobId})

    const handoffs = this.workerHandoffs.get(worker)

    if (handoffs?.get(jobId) === handoffId) handoffs.delete(jobId)
  }

  /**
   * Forgets a successfully reported lease without relying on worker ids.
   * @param {object} args - Options.
   * @param {string} args.handoffId - Handoff lease id.
   * @param {string} args.jobId - Job id.
   * @returns {void}
   */
  _forgetHandoff({handoffId, jobId}) {
    for (const [worker, handoffs] of this.workerHandoffs) {
      if (handoffs.get(jobId) !== handoffId) continue

      handoffs.delete(jobId)
      if (handoffs.size === 0 && !this.workers.has(worker)) this.workerHandoffs.delete(worker)
      return
    }
  }

  /**
   * Reports an unexpected lease-release failure on framework error channels.
   * @param {?} error - Release failure.
   * @returns {void}
   */
  _reportHandoffReleaseError(error) {
    const normalizedError = error instanceof Error ? error : new Error(String(error))
    const payload = {context: {stage: "background-job-handoff-release"}, error: normalizedError}
    const errorEvents = this.configuration.getErrorEvents()

    this.logger.error(() => ["Failed to release disconnected worker handoffs:", normalizedError])
    errorEvents.emit("framework-error", payload)
    errorEvents.emit("all-error", {...payload, errorType: "framework-error"})
  }

  /**
   * Reports an unexpected worker-handoff adoption failure on framework error
   * channels. A failed adoption is not fatal (the worker's jobs remain and are
   * reclaimed by the orphan sweep), but must surface rather than be swallowed.
   * @param {?} error - Adoption failure.
   * @returns {void}
   */
  _reportHandoffAdoptError(error) {
    const normalizedError = error instanceof Error ? error : new Error(String(error))
    const payload = {context: {stage: "background-job-handoff-adopt"}, error: normalizedError}
    const errorEvents = this.configuration.getErrorEvents()

    this.logger.error(() => ["Failed to adopt reconnected worker handoffs:", normalizedError])
    errorEvents.emit("framework-error", payload)
    errorEvents.emit("all-error", {...payload, errorType: "framework-error"})
  }

  /**
   * Runs handle enqueue.
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
      if (error instanceof VelociousError && error.safeToExpose) {
        jsonSocket.send({type: "enqueue-error", error: error.message})
        return
      }

      const normalizedError = error instanceof Error ? error : new Error(String(error))
      const payload = {
        context: {jobName: message.jobName, stage: "background-job-enqueue"},
        error: normalizedError
      }
      const errorEvents = this.configuration.getErrorEvents()

      this.logger.error(() => ["Failed to enqueue background job:", normalizedError])
      errorEvents.emit("framework-error", payload)
      errorEvents.emit("all-error", {...payload, errorType: "framework-error"})
      jsonSocket.send({type: "enqueue-error", error: "Failed to enqueue job"})
    }
  }

  /**
   * Runs handle job complete.
   * @param {object} args - Options.
   * @param {JsonSocket} args.jsonSocket - JSON socket.
   * @param {import("./types.js").BackgroundJobCompleteMessage} args.message - Message.
   * @returns {Promise<void>} - Resolves when handled.
   */
  async _handleJobComplete({jsonSocket, message}) {
    try {
      const accepted = await this.store.markCompleted({
        jobId: message.jobId,
        handoffId: message.handoffId,
        workerId: message.workerId,
        handedOffAtMs: message.handedOffAtMs
      })
      if (accepted && message.handoffId) {
        this._forgetHandoff({handoffId: message.handoffId, jobId: message.jobId})
      }
      jsonSocket.send({type: "job-updated", jobId: message.jobId})
    } catch (error) {
      this.logger.error(() => ["Failed to update job completion:", error])
      jsonSocket.send({type: "job-update-error", jobId: message.jobId, error: "Failed to update job"})
    }
  }

  /**
   * Runs handle job failed.
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
        handoffId: message.handoffId,
        workerId: message.workerId,
        handedOffAtMs: message.handedOffAtMs
      })

      if (failedJob) {
        if (message.handoffId) {
          this._forgetHandoff({handoffId: message.handoffId, jobId: message.jobId})
        }
        this._emitBackgroundJobFailed({
          error: message.error,
          handoffId: message.handoffId,
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
   * Runs emit background job failed.
   * @param {{error: ?, handoffId?: string, handedOffAtMs?: number, job: import("./types.js").BackgroundJobRow, workerId?: string}} args - Failure event data.
   * @returns {void}
   */
  _emitBackgroundJobFailed({error, handoffId, handedOffAtMs, job, workerId}) {
    const normalizedError = this._normalizeFailureError(error)
    const payload = {
      context: {
        attempts: job.attempts,
        handoffId,
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
   * Emits `background-job-orphaned` (mirrored to `all-error`) for a job the time-based orphan sweep
   * reclaimed after its worker died mid-run. Unlike `background-job-failed`, which fires on a
   * worker's failure report, this fires from the main process's sweep, so applications can react to
   * a dead worker's specific job — recover the work it left behind — without polling. `willRetry`
   * reflects whether the reclaim returned the job to the queue for another attempt.
   * @param {{job: import("./types.js").BackgroundJobRow}} args - The orphaned job.
   * @returns {void}
   */
  _emitBackgroundJobOrphaned({job}) {
    const normalizedError = this._normalizeFailureError(job.lastError ?? "Job orphaned after timeout")
    const payload = {
      context: {
        attempts: job.attempts,
        jobArgs: job.args,
        jobId: job.id,
        jobName: job.jobName,
        maxRetries: job.maxRetries,
        stage: "background-job-orphaned",
        status: job.status,
        terminal: job.status === "failed" || job.status === "orphaned",
        willRetry: job.status === "queued"
      },
      error: normalizedError
    }
    const errorEvents = this.configuration.getErrorEvents()

    errorEvents.emit("background-job-orphaned", payload)
    errorEvents.emit("all-error", {...payload, errorType: "background-job-orphaned"})
  }

  /**
   * Runs normalize failure error.
   * @param {?} error - Reported failure value.
   * @returns {Error} Normalized error.
   */
  _normalizeFailureError(error) {
    if (error instanceof Error) return error

    return this._errorFromUnknownFailure(error)
  }

  /**
   * Runs error from unknown failure.
   * @param {?} error - Reported failure value.
   * @returns {Error} Normalized error.
   */
  _errorFromUnknownFailure(error) {
    const message = this._messageFromUnknownFailure(error)
    const normalizedError = new Error(message)

    this._copyStringFailureStack({error, normalizedError})

    return normalizedError
  }

  /**
   * Runs message from unknown failure.
   * @param {?} error - Reported failure value.
   * @returns {string} Error message.
   */
  _messageFromUnknownFailure(error) {
    if (this._hasStringFailure(error)) return error.trim().split("\n")[0]

    return String(error || "Background job failed")
  }

  /**
   * Runs has string failure.
   * @param {?} error - Reported failure value.
   * @returns {error is string} Whether the value is a non-empty string.
   */
  _hasStringFailure(error) {
    return typeof error === "string" && error.trim().length > 0
  }

  /**
   * Runs copy string failure stack.
   * @param {object} args - Options.
   * @param {?} args.error - Reported failure value.
   * @param {Error} args.normalizedError - Normalized error.
   * @returns {void}
   */
  _copyStringFailureStack({error, normalizedError}) {
    if (this._hasStringFailure(error)) normalizedError.stack = error
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
    if (!this._startDrain()) return

    const errored = await this._drainUntilIdle()

    await this._finishDrain({errored})
  }

  /**
   * Runs start drain.
   * @returns {boolean} - Whether the drain should continue.
   */
  _startDrain() {
    if (this._stopped) return false
    if (this._queueDrainIfAlreadyRunning()) return false

    this._draining = true
    return true
  }

  /**
   * Runs finish drain.
   * @param {object} args - Options.
   * @param {boolean} args.errored - Whether the drain hit an error.
   * @returns {Promise<void>} - Resolves after follow-up timers are handled.
   */
  async _finishDrain({errored}) {
    if (this._stopped) return
    if (errored) return this._scheduleErrorRetry()

    await this._armScheduledTimerOrRetry()
  }

  /**
   * Runs arm scheduled timer or retry.
   * @returns {Promise<void>} - Resolves after scheduled timer handling.
   */
  async _armScheduledTimerOrRetry() {
    try {
      await this._armScheduledTimer()
    } catch (error) {
      this.logger.error(() => ["Background jobs scheduled-timer arming failed:", error])
      this._scheduleErrorRetry()
      return
    }

    this._clearErrorRetryTimer()
  }

  /**
   * Runs clear error retry timer.
   * @returns {void} */
  _clearErrorRetryTimer() {
    for (const worker of this.workerHandoffs.keys()) {
      if (!this.workers.has(worker)) return
    }

    if (this._errorRetryTimer) {
      clearTimeout(this._errorRetryTimer)
      this._errorRetryTimer = undefined
    }
  }

  /**
   * Runs queue drain if already running.
   * @returns {boolean} - Whether another drain is already in progress.
   */
  _queueDrainIfAlreadyRunning() {
    if (!this._draining) return false

    this._redrainQueued = true
    return true
  }

  /**
   * Runs drain until idle.
   * @returns {Promise<boolean>} - Whether the drain hit an error.
   */
  async _drainUntilIdle() {
    try {
      return await this._runDrainLoop()
    } finally {
      this._draining = false
    }
  }

  /**
   * Runs run drain loop.
   * @returns {Promise<boolean>} - Whether the drain hit an error.
   */
  async _runDrainLoop() {
    do {
      this._redrainQueued = false
      const errored = await this._drainOnceWithErrorReport()

      if (errored) return true
    } while (this._redrainQueued && !this._stopped)

    return false
  }

  /**
   * Runs drain once with error report.
   * @returns {Promise<boolean>} - Whether one drain pass failed.
   */
  async _drainOnceWithErrorReport() {
    try {
      await this._drainOnce()
      return false
    } catch (error) {
      this.logger.error(() => ["Background jobs drain failed:", error])
      return true
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
      void this._retryAfterError()
    }, this.pollIntervalMs)
  }

  /**
   * Retries failed disconnected-socket releases before draining queued work.
   * @returns {Promise<void>} - Resolves after retry work.
   */
  async _retryAfterError() {
    if (this._stopped) return

    try {
      for (const worker of this.workerHandoffs.keys()) {
        if (!this.workers.has(worker)) await this._releaseWorkerHandoffs(worker)
      }
    } catch (error) {
      this._reportHandoffReleaseError(error)
      this._scheduleErrorRetry()
      return
    }

    await this._drain()
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

      const handoff = await this.store.markHandedOff({jobId: job.id, workerId: worker.workerId})

      if (!handoff) {
        if (this.workers.has(worker)) this.readyWorkers.add(worker)
        continue
      }

      const handoffs = this.workerHandoffs.get(worker)

      if (!handoffs || !this.workers.has(worker)) {
        await this.store.markReturnedToQueue({handoffId: handoff.handoffId, jobId: job.id})
        this._notifyEnqueued()
        await this._drain()
        continue
      }

      handoffs.set(job.id, handoff.handoffId)

      try {
        worker.send({
          type: "job",
          payload: {
            id: job.id,
            jobName: job.jobName,
            args: job.args,
            handoffId: handoff.handoffId,
            workerId: worker.workerId,
            handedOffAtMs: handoff.handedOffAtMs,
            options: {
              executionMode: job.executionMode,
              forked: job.forked
            }
          }
        })
      } catch (error) {
        this.logger.warn(() => ["Failed to send job to worker, re-queueing:", error])
        try {
          worker.close()
        } catch (closeError) {
          this.logger.warn(() => ["Failed to close worker after job send failure:", closeError])
        }
        await this._handleWorkerSocketClosed(worker)
      }
    }
  }

  /**
   * Runs next available job for ready workers.
   * @returns {Promise<import("./types.js").BackgroundJobRow | null>} - Next queued job matching ready worker capacity.
   */
  async nextAvailableJobForReadyWorkers() {
    const executionModes = this.readyWorkerExecutionModes()

    if (executionModes.length === 0) return null
    if (executionModes.length === 3) return await this.store.nextAvailableJob()

    return await this.store.nextAvailableJob({executionMode: executionModes})
  }

  /**
   * Runs ready worker execution modes.
   * @returns {import("./types.js").BackgroundJobExecutionMode[]} - Execution modes currently accepted by ready workers.
   */
  readyWorkerExecutionModes() {
    const executionModes = new Set()

    for (const worker of this.readyWorkers) {
      this._addAcceptedExecutionModes({executionModes, worker})
    }

    return /** @type {import("./types.js").BackgroundJobExecutionMode[]} */ ([...executionModes])
  }

  /**
   * Runs add accepted execution modes.
   * @param {object} args - Options.
   * @param {Set<import("./types.js").BackgroundJobExecutionMode>} args.executionModes - Accepted modes.
   * @param {JsonSocket} args.worker - Worker socket.
   * @returns {void}
   */
  _addAcceptedExecutionModes({executionModes, worker}) {
    if (!worker.supportsHandoffIdReporting) return

    for (const capability of WORKER_EXECUTION_MODE_CAPABILITIES) {
      if (capability.accepts(worker)) executionModes.add(capability.executionMode)
    }
  }

  /**
   * Runs ready worker for job.
   * @param {import("./types.js").BackgroundJobRow} job - Job being handed off.
   * @returns {JsonSocket | undefined} - Ready worker for the job type.
   */
  readyWorkerForJob(job) {
    for (const worker of this.readyWorkers) {
      if (this._workerAcceptsJob({job, worker})) return worker
    }
  }

  /**
   * Runs worker accepts job.
   * @param {object} args - Options.
   * @param {import("./types.js").BackgroundJobRow} args.job - Job being handed off.
   * @param {JsonSocket} args.worker - Worker socket.
   * @returns {boolean} - Whether the worker accepts the job mode.
   */
  _workerAcceptsJob({job, worker}) {
    if (!worker.supportsHandoffIdReporting) return false

    const capability = WORKER_EXECUTION_MODE_CAPABILITIES_BY_MODE.get(job.executionMode)

    if (!capability) return false

    return capability.accepts(worker)
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
      const orphanedJobs = await this.store.markOrphanedJobs()

      if (orphanedJobs.length > 0) {
        this.logger.warn(() => ["Marked orphaned background jobs", orphanedJobs.length])
        // Reclaimed orphans become `queued` again — wake the dispatcher first so
        // an application event handler that throws below cannot strand them
        // queued until the next external enqueue/reconnect.
        this._notifyEnqueued()
        await this._drain()
        // Emit an event per orphaned job so applications can react to a dead
        // worker's specific job (e.g. targeted recovery) instead of only polling
        // for its aftermath. Isolate each so one throwing handler can't suppress
        // the events for the rest.
        for (const job of orphanedJobs) {
          try {
            this._emitBackgroundJobOrphaned({job})
          } catch (error) {
            this.logger.error(() => ["A background-job-orphaned event handler threw:", error])
          }
        }
      }
    } catch (error) {
      this.logger.error(() => ["Failed to mark orphaned jobs:", error])
    }
  }

  /**
   * Drops workers that have gone silent past `workerStaleTimeoutMs` (no
   * heartbeat, ready, or report). A wedged worker keeps its socket open, so the
   * `close`-based cleanup never fires and its in-flight leases — and the whole
   * queue — stay stuck until a human notices. Releasing the lost worker's
   * leases lets its jobs run elsewhere and stops dispatch to it; the worker's
   * own process lifecycle is the supervisor's concern.
   * @returns {Promise<void>} - Resolves after the sweep.
   */
  async _sweepStaleWorkers() {
    if (this._stopped) return

    const cutoff = Date.now() - this.workerStaleTimeoutMs
    /** @type {JsonSocket[]} */
    const stale = []

    for (const worker of this.workers) {
      // Only evict heartbeat-capable workers. A legacy worker (e.g. one from the
      // previous release during a rolling deploy) never heartbeats, so evicting
      // it on silence would wrongly release the leases of a job it is still
      // running. Its disconnect is still handled by the socket `close` path.
      if (!worker.supportsHeartbeat) continue

      const lastSeenAt = typeof worker.lastSeenAt === "number" ? worker.lastSeenAt : 0

      if (lastSeenAt <= cutoff) stale.push(worker)
    }

    for (const worker of stale) {
      this.logger.warn(() => ["Dropping stale background jobs worker", {workerId: worker.workerId, lastSeenAt: worker.lastSeenAt}])

      try {
        worker.close()
      } catch {
        // Already closing; the lease release below is what matters.
      }

      await this._handleWorkerSocketClosed(worker)
    }
  }
}
