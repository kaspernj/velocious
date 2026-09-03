// @ts-check

import { randomUUID } from "crypto"
import net from "net"
import JsonSocket from "./json-socket.js"
import BackgroundJobsScheduler from "./scheduler.js"
import Logger from "../logger.js"
import PruneTerminalBackgroundJobsJob from "../jobs/prune-terminal-background-jobs.js"
import VelociousError from "../velocious-error.js"
import shutdownLifecycle, { runShutdownSteps } from "../utils/shutdown-lifecycle.js"
import { validateGenerationId, workerIdBelongsToGeneration } from "./generation-identity.js"
import BackgroundJobsLifecycleControlServer from "./lifecycle-control-server.js"

/**
 * WorkerExecutionModeCapability type.
 * @typedef {object} WorkerExecutionModeCapability
 * @property {import("./types.js").BackgroundJobExecutionMode} executionMode - Execution mode.
 * @property {(worker: JsonSocket) => boolean} accepts - Whether the worker accepts this mode.
 */
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
/** Grace for workers from the previous main generation to reconnect and adopt leases. */
const WORKER_RECONNECT_GRACE_MS = 30000
const GENERATION_ORPHANED_AFTER_MS = 60 * 60 * 1000
const WORKER_RECONNECT_GRACE_VALIDATION_MESSAGE = `workerReconnectGraceMs must be an integer between 0 and ${MAX_TIMER_MS}`

/**
 * Resolves a startup reconnect grace without allowing Node's timer overflow to
 * turn an intentionally long grace into an immediate reclaim.
 * @param {number | undefined} workerReconnectGraceMs - Requested reconnect grace.
 * @returns {number} - Valid timer delay.
 */
function normalizeWorkerReconnectGraceMs(workerReconnectGraceMs) {
  if (workerReconnectGraceMs === undefined) return WORKER_RECONNECT_GRACE_MS
  if (!Number.isInteger(workerReconnectGraceMs) || workerReconnectGraceMs < 0 || workerReconnectGraceMs > MAX_TIMER_MS) {
    throw new TypeError(WORKER_RECONNECT_GRACE_VALIDATION_MESSAGE)
  }

  return workerReconnectGraceMs
}
/**
 * Worker execution mode capabilities.
 * @type {WorkerExecutionModeCapability[]} */
const WORKER_EXECUTION_MODE_CAPABILITIES = [
  {executionMode: "inline", accepts: (worker) => worker.acceptsInlineJobs !== false},
  {executionMode: "forked", accepts: (worker) => worker.acceptsForkedJobs !== false},
  // Pooled is opt-in: only workers that explicitly advertise `acceptsPooled`
  // receive pooled jobs. The `=== true` (rather than `!== false`) check keeps a
  // pre-pooled worker — which never sends the field — out of the pooled-capable
  // set, so the main never dispatches a pooled job to a worker that cannot run
  // one. This is the conservative half of the extended readiness protocol.
  {executionMode: "pooled", accepts: (worker) => worker.acceptsPooledJobs === true && (!worker.usesPooledCapacityCredits || worker.availablePooledSlots > 0)},
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
   * @param {string} [args.generationId] - Explicit release generation identity.
   * @param {import("./types.js").BackgroundJobsGenerationInitialState} [args.initialGenerationState] - Explicit generation boot state.
   * @param {string} [args.lifecycleSocketPath] - Explicit lifecycle socket path.
   * @param {number} [args.workerStaleTimeoutMs] - Override how long a silent worker may go before being dropped (default 60000ms).
   * @param {number} [args.workerLivenessSweepMs] - Override how often stale workers are swept for (default 15000ms).
   * @param {number} [args.workerReconnectGraceMs] - Integer from 0 through 2,147,483,647 overriding how long previous-generation workers may reconnect before exact startup leases are reclaimed (default 30000ms).
   * @param {boolean} [args.closeDatabaseConnectionsOnStop] - Whether stop owns closing the configuration's database pools (default true).
   * @param {() => void | Promise<void>} [args.onStopped] - Lifecycle hook invoked after the main process finishes stopping.
   * @param {(args: {handoff: import("./types.js").BackgroundJobHandoff, job: import("./types.js").BackgroundJobRow}) => void | Promise<void>} [args.afterHandoffClaim] - Explicit handoff-claim observation hook.
   * @param {(worker: JsonSocket) => void} [args.onWorkerReady] - Explicit readiness observation hook.
   * @param {(worker: JsonSocket) => void} [args.onWorkerHeartbeat] - Explicit heartbeat observation hook.
   * @param {(workerId: string) => void} [args.onWorkerDisconnected] - Explicit generation disconnect observation hook.
   * @param {(workerId: string) => void} [args.onWorkerHandoffsReleased] - Explicit grace-expiry observation hook.
   * @param {(jobs: import("./types.js").BackgroundJobRow[]) => void} [args.onStartupHandoffsReclaimed] - Explicit startup reclaim observation hook.
   * @param {(args: {accepted: boolean, jobId: string, status: "completed" | "failed" | "rescheduled"}) => void} [args.onJobUpdated] - Explicit durable report observation hook.
   * @param {{now: () => number, setTimeout?: (callback: () => void, delayMs: number) => ReturnType<typeof setTimeout> | number, clearTimeout?: (timerId: ReturnType<typeof setTimeout> | number) => void}} [args.clock] - Injectable wall clock for deterministic lifecycle tests.
   */
  constructor({configuration, host, port, generationId: explicitGenerationId, initialGenerationState: explicitInitialGenerationState, lifecycleSocketPath: explicitLifecycleSocketPath, workerStaleTimeoutMs, workerLivenessSweepMs, workerReconnectGraceMs, closeDatabaseConnectionsOnStop = true, onStopped, afterHandoffClaim, onWorkerReady, onWorkerHeartbeat, onWorkerDisconnected, onWorkerHandoffsReleased, onStartupHandoffsReclaimed, onJobUpdated, clock}) {
    this.configuration = configuration
    this.closeDatabaseConnectionsOnStop = closeDatabaseConnectionsOnStop
    this.onStopped = onStopped
    this.afterHandoffClaim = afterHandoffClaim
    this.onWorkerReady = onWorkerReady
    this.onWorkerHeartbeat = onWorkerHeartbeat
    this.onWorkerDisconnected = onWorkerDisconnected
    this.onWorkerHandoffsReleased = onWorkerHandoffsReleased
    this.onStartupHandoffsReclaimed = onStartupHandoffsReclaimed
    this.onJobUpdated = onJobUpdated
    this.clock = {
      clearTimeout: clock?.clearTimeout || ((timerId) => clearTimeout(timerId)),
      now: clock?.now || (() => Date.now()),
      setTimeout: clock?.setTimeout || ((callback, delayMs) => setTimeout(callback, delayMs))
    }
    const config = configuration.getBackgroundJobsConfig()
    const generationConfig = configuration.resolveBackgroundJobsGenerationConfig({
      generationId: explicitGenerationId,
      initialGenerationState: explicitInitialGenerationState,
      lifecycleSocketPath: explicitLifecycleSocketPath,
      sourceName: "BackgroundJobsMain"
    })
    this.generationId = generationConfig.generationId
    this.initialGenerationState = generationConfig.initialGenerationState
    this.lifecycleSocketPath = generationConfig.lifecycleSocketPath
    /** @type {import("./types.js").BackgroundJobsGenerationLifecycleState} */
    this.lifecycleState = "starting"
    this._activeOwnershipReady = false
    /** @type {Promise<void> | undefined} */
    this._activationPromise = undefined
    /** @type {Promise<void> | undefined} */
    this._retirementPromise = undefined
    /** @type {Set<JsonSocket>} */
    this.candidateReadyWorkers = new Set()
    /** @type {Map<string, {worker: JsonSocket, timer: ReturnType<typeof setTimeout> | number}>} */
    this.disconnectedWorkers = new Map()
    this._lifecycleRequestLeases = 0
    this._activeNonWorkerRequests = 0
    /**
     * Resolves stop observation.
     * @type {() => void}
     */
    this._resolveStopped = () => {}
    this._stoppedPromise = new Promise((/** @type {(value: void) => void} */ resolve) => { this._resolveStopped = resolve })
    this.host = host || config.host
    this.port = typeof port === "number" ? port : config.port
    this.dispatchStrategy = config.dispatchStrategy
    this.pollIntervalMs = config.pollIntervalMs
    this.retention = config.retention
    // A worker that stops sending anything (heartbeat/ready/report) for this
    // long is treated as wedged/dead: its leases are released and it is dropped.
    this.workerStaleTimeoutMs = typeof workerStaleTimeoutMs === "number" && workerStaleTimeoutMs >= 1 ? workerStaleTimeoutMs : WORKER_STALE_TIMEOUT_MS
    this.workerLivenessSweepMs = typeof workerLivenessSweepMs === "number" && workerLivenessSweepMs >= 1 ? workerLivenessSweepMs : WORKER_LIVENESS_SWEEP_MS
    this.workerReconnectGraceMs = normalizeWorkerReconnectGraceMs(workerReconnectGraceMs)
    /** @type {import("./adapter.js").default | undefined} */
    this.adapter = undefined
    this.logger = new Logger(this)
    /**
     * Narrows the runtime value to the documented type.
     * @type {Set<JsonSocket>} */
    this.workers = new Set()
    /** @type {Set<JsonSocket>} */
    this.connections = new Set()
    /**
     * Narrows the runtime value to the documented type.
     * @type {Set<JsonSocket>} */
    this.readyWorkers = new Set()
    /**
     * Active durable handoffs keyed by the exact worker socket that received them.
     * @type {Map<JsonSocket, Map<string, string>>} */
    this.workerHandoffs = new Map()
    /**
     * Exact caller-generated leases whose claim outcome was ambiguous or whose
     * pre-dispatch release has not yet been acknowledged. Retained until a
     * fenced return succeeds (including an exact no-op).
     * @type {Map<string, string>} */
    this.pendingHandoffRecoveries = new Map()
    /**
     * Handoff-adoption queries started by worker hello messages. Shutdown must
     * wait for these before closing the configuration's database pools.
     * @type {Set<Promise<void>>} */
    this.inflightWorkerHandoffAdoptions = new Set()
    /**
     * Worker ids whose handoffs were successfully adopted by a still-live
     * connection in this main generation.
     * @type {Set<string>}
     */
    this.reconnectedWorkerIds = new Set()
    /** @type {import("./types.js").BackgroundJobHandoffSnapshot[]} */
    this.startupHandoffSnapshot = []
    /** @type {Promise<void>[]} */
    this._startupHandoffAdoptionsAtDeadline = []
    this._startupHandoffGraceElapsed = false
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
    /** @type {ReturnType<typeof setTimeout> | number | undefined} */
    this._startupHandoffReclaimTimer = undefined
    /** @type {Promise<void> | undefined} */
    this._startupHandoffReclaimPromise = undefined
    /**
     * Narrows the runtime value to the documented type.
     * @type {BackgroundJobsScheduler | undefined} */
    this.scheduler = undefined
    this._draining = false
    this._redrainQueued = false
    /** @type {Promise<void> | undefined} */
    this._drainPromise = undefined
    this._stopped = false
    /** @type {Promise<void> | undefined} */
    this.stopPromise = undefined
    /**
     * Narrows the runtime value to the documented type.
     * @type {(() => void) | undefined} */
    this._unsubscribeBeacon = undefined
    /**
     * Narrows the runtime value to the documented type.
     * @type {((...args: Array<ReturnType<typeof JSON.parse>>) => void) | undefined} */
    this._beaconConnectHandler = undefined
    /**
     * Narrows the runtime value to the documented type.
     * @type {import("../beacon/client.js").default | import("../beacon/in-process-client.js").default | undefined} */
    this._beaconClient = undefined
    /** @type {BackgroundJobsLifecycleControlServer | undefined} */
    this.lifecycleControlServer = undefined
  }

  /**
   * Compatibility alias for integrations that inspect the active main store.
   * @returns {import("./adapter.js").default} - Adapter acquired by start.
   */
  get store() {
    if (!this.adapter) throw new Error("Background jobs main has not acquired its adapter")

    return this.adapter
  }

  /**
   * Preserves the historical subclass seam while keeping one adapter reference.
   * @param {import("./adapter.js").default} adapter - Adapter to assign.
   */
  set store(adapter) {
    this.adapter = adapter
  }

  /**
   * Runs start.
   * @returns {Promise<void>} - Resolves when listening.
   */
  async start() {
    this._stopped = false
    this.stopPromise = undefined
    this._activeOwnershipReady = false
    this.lifecycleState = "starting"
    this._stoppedPromise = new Promise((/** @type {(value: void) => void} */ resolve) => { this._resolveStopped = resolve })
    this.reconnectedWorkerIds.clear()
    this.startupHandoffSnapshot = []
    this._startupHandoffAdoptionsAtDeadline = []
    this._startupHandoffGraceElapsed = false
    this._startupHandoffReclaimPromise = undefined
    this.configuration.setCurrent()

    try {
      await this.configuration.initialize({type: "background-jobs-main"})
      await this.configuration.connectBeacon({peerType: "background-jobs-main"})

      if (!this.adapter) {
        this.adapter = await this.configuration.acquireReadyBackgroundJobsAdapter()
      }
      if (this.generationId && !this.adapter.supportsReleaseScopedGenerations()) {
        throw new Error("The configured background jobs adapter does not support release-scoped generations")
      }

      if (!this.generationId || this.initialGenerationState !== "candidate") {
        this.startupHandoffSnapshot = await this._generationOwnedHandoffSnapshot()
      }
      const server = net.createServer((socket) => this._handleConnection(socket))
      this.server = server

      await new Promise((resolve, reject) => {
        server.once("error", reject)
        server.listen(this.port, this.host, () => resolve(undefined))
      })

      const address = server.address()
      if (address && typeof address === "object") {
        this.port = address.port
      }

      this.lifecycleState = this.generationId ? this.initialGenerationState : "active"

      if (this.generationId && this.lifecycleSocketPath) {
        this.lifecycleControlServer = new BackgroundJobsLifecycleControlServer({
          configuration: this.configuration,
          generationId: this.generationId,
          main: this,
          socketPath: this.lifecycleSocketPath
        })
        await this.lifecycleControlServer.start()
      }

      this._workerStaleTimer = setInterval(() => {
        void this._sweepStaleWorkers()
      }, this.workerLivenessSweepMs)

      if (this.lifecycleState === "active") {
        await this._startActiveOwnership()
      } else if (this.lifecycleState === "retired") {
        this._startGenerationRecoveryOwnership()
      }
    } catch (error) {
      let cleanupError

      try {
        await this.stop()
      } catch (caughtCleanupError) {
        cleanupError = caughtCleanupError
      }

      if (cleanupError) {
        throw new AggregateError(
          [error, cleanupError],
          "Background jobs main startup and cleanup failed",
          {cause: error}
        )
      }

      throw error
    }
  }

  /**
   * Runs stop.
   * @returns {Promise<void>} - Resolves when closed.
   */
  stop() {
    if (!this.stopPromise) this.stopPromise = this._stop()

    return this.stopPromise
  }

  /**
   * Runs the main-process shutdown lifecycle once.
   * @returns {Promise<void>} - Resolves when closed.
   */
  async _stop() {
    this._stopped = true

    try {
      await shutdownLifecycle({
        onStopped: this.onStopped,
        shutdown: async () => {
          this._closeWorkers()
          this._clearTimers()
          this._disconnectBeaconHandlers()
          try {
            await this.scheduler?.stop()
            if (this._drainPromise) await this._drainPromise
          } finally {
            try {
              await this._drainWorkerHandoffAdoptions()
            } finally {
              try {
                await this._drainStartupHandoffReclaim()
              } finally {
                await this._stopBeaconAndServer()
              }
            }
          }
        }
      })
    } finally {
      this.adapter = undefined
      this.lifecycleState = "stopped"
      this._resolveStopped()
    }
  }

  /**
   * Runs close workers.
   * @returns {void} */
  _closeWorkers() {
    for (const connection of this.connections) {
      connection.close()
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
    if (this._startupHandoffReclaimTimer) this.clock.clearTimeout(this._startupHandoffReclaimTimer)
    for (const {timer} of this.disconnectedWorkers.values()) this.clock.clearTimeout(timer)
    this.disconnectedWorkers.clear()
    this._pollTimer = undefined
    this._scheduledTimer = undefined
    this._errorRetryTimer = undefined
    this._orphanTimer = undefined
    this._workerStaleTimer = undefined
    this._startupHandoffReclaimTimer = undefined
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
    await runShutdownSteps({
      message: "Background jobs main application and framework shutdown failed",
      steps: [
        async () => {
          try {
            await this.lifecycleControlServer?.close()
          } finally {
            this.lifecycleControlServer = undefined
          }
        },
        ...(this.closeDatabaseConnectionsOnStop
          ? [async () => await this.configuration.shutdown()]
          : []),
        async () => await this.configuration.disconnectBeacon(),
        async () => await this._closeServer(),
        async () => {
          if (this.closeDatabaseConnectionsOnStop) {
            await this.configuration.closeDatabaseConnections()
          } else {
            await this.configuration.closeBackgroundJobsAdapter()
          }
        }
      ]
    })
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
   * Gets the lifecycle state.
   * @returns {import("./types.js").BackgroundJobsGenerationLifecycleState} - Current lifecycle state.
   */
  getLifecycleState() { return this.lifecycleState }

  /**
   * Returns a promise that settles only after the main has fully stopped.
   * @returns {Promise<void>} - Stop completion.
   */
  async waitUntilStopped() { await this._stoppedPromise }

  /**
   * Snapshots only exact durable owners from this release generation.
   * Legacy mode intentionally retains its historical global snapshot.
   * @returns {Promise<import("./types.js").BackgroundJobHandoffSnapshot[]>} - Owned snapshot.
   */
  async _generationOwnedHandoffSnapshot() {
    const handoffs = await this.store.snapshotHandedOffJobs()

    if (!this.generationId) return handoffs
    const generationId = this.generationId

    return handoffs.filter(({workerId}) => workerIdBelongsToGeneration({generationId, workerId}))
  }

  /**
   * Acquires scheduling and dispatch ownership for an active generation.
   * @returns {Promise<void>} - Resolves after active ownership is established.
   */
  async _startActiveOwnership() {
    await this.store.reconcileQueueConcurrency()
    this._setupDispatchTriggers()
    this._setupStartupHandoffReclaim()
    this._startOrphanSweep()
    await this._startScheduler()
    this._activeOwnershipReady = true
    this._creditReadyWorkers()
    await this._drain()
  }

  /** Starts exact recovery duties without acquiring global dispatch ownership. */
  _startGenerationRecoveryOwnership() {
    this._setupStartupHandoffReclaim()
    this._startOrphanSweep()
    this._maybeStopRetired()
  }

  /** Starts the generation-fenced orphan sweep. */
  _startOrphanSweep() {
    if (this._orphanTimer) return

    this._orphanTimer = setInterval(() => { void this._sweepOrphans() }, 60000)
  }

  /**
   * Starts schedule ownership exactly once.
   * @returns {Promise<void>} - Resolves after schedules are loaded.
   */
  async _startScheduler() {
    if (this.scheduler) return

    this.scheduler = new BackgroundJobsScheduler({
      configuration: this.configuration,
      enqueueJob: async ({args, jobClass, options}) => {
        await this.store.enqueue({
          jobName: jobClass.jobName(),
          args,
          options: jobClass._withJobContext({jobArgs: args, jobOptions: options})
        })
        this._notifyEnqueued()
        void this._drain()
      }
    })
    await this.scheduler.start()

    const retentionSchedule = PruneTerminalBackgroundJobsJob.scheduleConfiguration(this.retention)

    if (retentionSchedule) {
      this.scheduler.scheduleJob({jobConfiguration: retentionSchedule, jobKey: "velociousPruneTerminalBackgroundJobs"})
    }
  }

  /** Credits readiness advertisements recorded while dispatch was fenced. */
  _creditReadyWorkers() {
    for (const worker of this.candidateReadyWorkers) {
      if (this.workers.has(worker) && !worker.isDraining && worker.supportsHandoffIdReporting) {
        this.readyWorkers.add(worker)
      }
    }
    this.candidateReadyWorkers.clear()
  }

  /**
   * Activates a candidate after its supervisor has retired the old generation.
   * @returns {Promise<void>} - Resolves after scheduling and dispatch are active.
   */
  activate() {
    if (!this.generationId) throw new Error("Background jobs generation activation requires generation mode")
    if (this.lifecycleState === "active") return Promise.resolve()
    if (this.lifecycleState !== "candidate") throw new Error(`Cannot activate background jobs generation from ${this.lifecycleState}`)
    if (!this._activationPromise) this._activationPromise = this._activate()

    return this._activationPromise
  }

  /**
   * Runs activation.
   * @returns {Promise<void>} - Activation completion.
   */
  async _activate() {
    this.logger.info(() => ["Background jobs generation activation starting", {generationId: this.generationId}])
    await this._startActiveOwnership()
    this.lifecycleState = "active"
    this._creditReadyWorkers()
    this.logger.info(() => ["Background jobs generation activation acknowledged", {generationId: this.generationId}])
    void this._drain().catch((error) => {
      this.logger.error(() => ["Background jobs generation post-activation drain failed", {error, generationId: this.generationId}])
    })
  }

  /**
   * Establishes the synchronous retirement fence and then drains ownership setup.
   * @returns {Promise<void>} - Resolves after the retirement fence is durable in memory.
   */
  retire() {
    if (!this.generationId) throw new Error("Background jobs generation retirement requires generation mode")
    if (this.lifecycleState === "retiring" || this.lifecycleState === "retired") return Promise.resolve()
    if (this.lifecycleState !== "active") throw new Error(`Cannot retire background jobs generation from ${this.lifecycleState}`)

    this.lifecycleState = "retiring"
    this._activeOwnershipReady = false
    this.readyWorkers.clear()
    this.candidateReadyWorkers.clear()
    this._clearDispatchTimers()
    this._disconnectBeaconHandlers()
    this._retirementPromise = this._retire()
    void this._retirementPromise.catch((error) => this._reportConnectionHandlerError(error))

    return Promise.resolve()
  }

  /**
   * Runs retirement after its synchronous fence.
   * @returns {Promise<void>} - Retirement fence completion.
   */
  async _retire() {
    await this.scheduler?.stop()
    this.scheduler = undefined
    if (this._drainPromise) await this._drainPromise
    if (this._stopped) return

    for (const worker of this.workers) {
      worker.isDraining = true
      worker.send({type: "retire", generationId: this.generationId})
    }

    this.lifecycleState = "retired"
    this._startGenerationRecoveryOwnership()
  }

  /** Clears timers that can initiate new global dispatch or schedule work. */
  _clearDispatchTimers() {
    if (this._pollTimer) clearInterval(this._pollTimer)
    if (this._scheduledTimer) clearTimeout(this._scheduledTimer)
    if (this._errorRetryTimer) clearTimeout(this._errorRetryTimer)
    this._pollTimer = undefined
    this._scheduledTimer = undefined
    this._errorRetryTimer = undefined
  }

  /** Holds the main open until a lifecycle response has flushed. */
  acquireLifecycleRequestLease() { this._lifecycleRequestLeases += 1 }

  /** Releases one lifecycle-response lease after its socket write callback. */
  releaseLifecycleRequestLease() {
    if (this._lifecycleRequestLeases < 1) throw new Error("No background jobs lifecycle request lease to release")
    this._lifecycleRequestLeases -= 1
    this._maybeStopRetired()
  }

  /** Stops a retired generation only after its exact ownership has drained. */
  _maybeStopRetired() {
    if (this.lifecycleState !== "retired" || this._stopped || this.stopPromise) return
    if (this._lifecycleRequestLeases > 0 || this._activeNonWorkerRequests > 0 || this.workers.size > 0 || this.disconnectedWorkers.size > 0) return
    if (this.inflightWorkerHandoffAdoptions.size > 0 || this.pendingHandoffRecoveries.size > 0) return
    if (this._drainPromise || this._startupHandoffReclaimPromise || this._startupHandoffReclaimTimer) return
    if (this.startupHandoffSnapshot.length > 0) return

    for (const handoffs of this.workerHandoffs.values()) {
      if (handoffs.size > 0) return
    }

    void this.stop().catch((error) => this._reportConnectionHandlerError(error))
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
   * Arms the bounded adoption grace only when startup found exact persisted
   * handoffs. The timer is unrefed so an otherwise-finished process is never
   * retained solely to perform this cleanup.
   * @returns {void}
   */
  _setupStartupHandoffReclaim() {
    if (this.startupHandoffSnapshot.length === 0) return
    if (this._startupHandoffReclaimTimer || this._startupHandoffReclaimPromise || this._startupHandoffGraceElapsed) return

    this._startupHandoffReclaimTimer = this.clock.setTimeout(() => {
      this._startupHandoffReclaimTimer = undefined
      this._startupHandoffAdoptionsAtDeadline = [...this.inflightWorkerHandoffAdoptions]
      this._startupHandoffGraceElapsed = true
      void this._startStartupHandoffReclaim()
    }, this.workerReconnectGraceMs)
    if (typeof this._startupHandoffReclaimTimer === "object") this._startupHandoffReclaimTimer.unref()
  }

  /**
   * Starts one tracked startup-reclaim pass, coalescing lifecycle and retry
   * callers so shutdown can wait for durable mutation before closing pools.
   * @returns {Promise<void>} - Resolves after this pass settles.
   */
  _startStartupHandoffReclaim() {
    if (this._startupHandoffReclaimPromise) return this._startupHandoffReclaimPromise

    const reclaim = this._reclaimDisconnectedStartupHandoffs()

    this._startupHandoffReclaimPromise = reclaim
    const clearReclaim = () => {
      if (this._startupHandoffReclaimPromise === reclaim) {
        this._startupHandoffReclaimPromise = undefined
      }
    }
    void reclaim.then(clearReclaim, clearReclaim)

    return reclaim
  }

  /**
   * Waits for an already-started startup reclaim before adapter shutdown.
   * @returns {Promise<void>} - Resolves when no pass remains.
   */
  async _drainStartupHandoffReclaim() {
    while (this._startupHandoffReclaimPromise) {
      await this._startupHandoffReclaimPromise
    }
  }

  /**
   * Orphans only startup-snapshotted leases whose stable worker id has not been
   * observed by this main generation. Store fencing rejects completed,
   * returned, replaced, and re-handed-off rows.
   * @returns {Promise<void>} - Resolves after reclaim or retained retry state.
   */
  async _reclaimDisconnectedStartupHandoffs() {
    if (this._stopped || !this._startupHandoffGraceElapsed) return
    if (this.startupHandoffSnapshot.length === 0) return

    await this._waitForStartupHandoffAdoptionsAtDeadline()
    if (this._stopped) return

    const handoffs = this.startupHandoffSnapshot.filter(({workerId}) => !this.reconnectedWorkerIds.has(workerId))

    if (handoffs.length === 0) {
      this.startupHandoffSnapshot = []
      this._maybeStopRetired()
      return
    }

    let orphanedJobs

    try {
      orphanedJobs = await this.store.markOrphanedHandoffs({
        error: "Job orphaned after its pre-restart worker did not reconnect",
        handoffs
      })
    } catch (error) {
      this._reportStartupHandoffReclaimError(error)
      this._scheduleErrorRetry()
      return
    }

    this.startupHandoffSnapshot = []
    await this._handleOrphanedJobs({
      jobs: orphanedJobs,
      warning: "Reclaimed background jobs from workers absent after main restart grace"
    })
    this.onStartupHandoffsReclaimed?.(orphanedJobs)
    this._maybeStopRetired()
  }

  /**
   * Lets adoption queries already running at the reconnect deadline settle
   * before worker ids are filtered. A second bounded grace prevents a stuck
   * adapter query from deferring startup reclaim forever.
   * @returns {Promise<void>} - Resolves when the deadline set settles or times out.
   */
  async _waitForStartupHandoffAdoptionsAtDeadline() {
    const adoptions = this._startupHandoffAdoptionsAtDeadline

    this._startupHandoffAdoptionsAtDeadline = []
    if (adoptions.length === 0) return

    /** @type {ReturnType<typeof setTimeout> | undefined} */
    let timer
    const waitLimit = new Promise((resolve) => {
      // This lifecycle deadline must not keep the main process alive; the
      // generic timeout helper intentionally uses a referenced timer.
      timer = setTimeout(resolve, this.workerReconnectGraceMs)
      timer.unref()
    })

    try {
      await Promise.race([Promise.all(adoptions), waitLimit])
    } finally {
      if (timer) clearTimeout(timer)
    }
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
    this.connections.add(jsonSocket)
    /**
     * Role.
     * @type {import("./types.js").BackgroundJobSocketRole | null} */
    let role = null

    let cleanedUp = false
    const cleanup = () => {
      if (cleanedUp) return
      cleanedUp = true
      this.connections.delete(jsonSocket)

      if (role === "worker") void this._handleWorkerSocketClosed(jsonSocket)
      this._maybeStopRetired()
    }

    jsonSocket.on("close", cleanup)
    jsonSocket.on("error", (error) => {
      this.logger.warn(() => ["Background jobs connection error:", error])
      cleanup()
    })

    let messageHandling = Promise.resolve()
    jsonSocket.on("message", (message) => {
      messageHandling = messageHandling.then(async () => {
        const existingRole = role
        role = await this._handleSocketMessage({jsonSocket, message, role})
        if (existingRole === "client" || existingRole === "reporter") jsonSocket.close()
      }).catch((error) => {
        this._reportConnectionHandlerError(error)
        jsonSocket.close()
      })
    })
  }

  /**
   * Surfaces an unexpected protocol-handler failure.
   * @param {ReturnType<typeof JSON.parse>} error - Handler failure.
   * @returns {void}
   */
  _reportConnectionHandlerError(error) {
    const normalizedError = error instanceof Error ? error : new Error(String(error))
    const payload = {context: {stage: "background-jobs-socket-handler"}, error: normalizedError}
    const errorEvents = this.configuration.getErrorEvents()

    this.logger.error(() => ["Background jobs socket handler failed:", normalizedError])
    errorEvents.emit("framework-error", payload)
    errorEvents.emit("all-error", {...payload, errorType: "framework-error"})
  }

  /**
   * Runs handle socket message.
   * @param {object} args - Options.
   * @param {JsonSocket} args.jsonSocket - JSON socket.
   * @param {import("./types.js").BackgroundJobSocketMessage} args.message - Socket message.
   * @param {import("./types.js").BackgroundJobSocketRole | null} args.role - Current socket role.
   * @returns {Promise<import("./types.js").BackgroundJobSocketRole | null>} - Updated socket role.
   */
  async _handleSocketMessage({jsonSocket, message, role}) {
    if (!role) return await this._handleRolelessSocketMessage({jsonSocket, message})
    if (role === "worker") {
      await this._handleWorkerSocketMessage({jsonSocket, message})
      return role
    }

    this._activeNonWorkerRequests += 1
    try {
      if (role === "client") await this._handleClientSocketMessage({jsonSocket, message})
      if (role === "reporter") await this._handleReporterSocketMessage({jsonSocket, message})
    } finally {
      this._activeNonWorkerRequests -= 1
      this._maybeStopRetired()
    }

    return role
  }

  /**
   * Runs handle roleless socket message.
   * @param {object} args - Options.
   * @param {JsonSocket} args.jsonSocket - JSON socket.
   * @param {import("./types.js").BackgroundJobSocketMessage} args.message - Socket message.
   * @returns {Promise<import("./types.js").BackgroundJobSocketRole | null>} - New socket role.
   */
  async _handleRolelessSocketMessage({jsonSocket, message}) {
    if (message?.type !== "hello") return null

    const rejectionReason = this._generationHelloRejectionReason(message)

    if (rejectionReason) {
      jsonSocket.send({type: "generation-rejected", reason: rejectionReason})
      jsonSocket.close()
      return null
    }

    if (message.role === "worker") {
      if (this._stopped) {
        jsonSocket.close()
        return message.role
      }

      if (!(await this._registerWorker({jsonSocket, message}))) return null
    }

    if (this.generationId) {
      jsonSocket.send({
        type: "generation-accepted",
        generationId: this.generationId,
        lifecycleState: this.lifecycleState
      })
      if (message.role === "worker" && (this.lifecycleState === "retiring" || this.lifecycleState === "retired")) {
        jsonSocket.send({type: "retire", generationId: this.generationId})
      }
    }

    return message.role
  }

  /**
   * Validates the generation fence before assigning a socket role.
   * @param {import("./types.js").BackgroundJobHelloMessage} message - Hello message.
   * @returns {import("./types.js").BackgroundJobsGenerationRejectionReason | null} - Rejection reason.
   */
  _generationHelloRejectionReason(message) {
    const messageHasGeneration = Object.hasOwn(message, "generationId")

    if (!this.generationId) return messageHasGeneration ? "unexpected-generation" : null
    if (!messageHasGeneration) return "missing-generation"

    try {
      validateGenerationId(message.generationId, "hello generationId")
    } catch {
      return "malformed-generation"
    }

    if (message.generationId !== this.generationId) return "generation-mismatch"
    if (message.role === "worker" && !workerIdBelongsToGeneration({generationId: this.generationId, workerId: message.workerId})) {
      return "generation-mismatch"
    }

    return null
  }

  /**
   * Registers a generation-fenced worker and transfers only its exact ownership.
   * @param {object} args - Worker hello.
   * @param {JsonSocket} args.jsonSocket - New socket.
   * @param {import("./types.js").BackgroundJobHelloMessage} args.message - Hello.
   * @returns {Promise<boolean>} - Whether the worker was admitted.
   */
  async _registerWorker({jsonSocket, message}) {
    jsonSocket.workerId = message.workerId
    jsonSocket.supportsHandoffIdReporting = message.supportsHandoffIdReporting === true
    jsonSocket.supportsHeartbeat = message.supportsHeartbeat === true
    jsonSocket.lastSeenAt = this.clock.now()

    const workerId = jsonSocket.workerId
    const disconnected = workerId ? this.disconnectedWorkers.get(workerId) : undefined
    let handoffs = disconnected ? this.workerHandoffs.get(disconnected.worker) : undefined
    const recoveryOnly = this.lifecycleState === "retiring" || this.lifecycleState === "retired"

    if (recoveryOnly && (!handoffs || handoffs.size === 0)) {
      if (!workerId) return false
      const durableHandoffs = await this.store.handedOffJobsForWorker({workerId})

      if (durableHandoffs.length === 0) {
        jsonSocket.send({type: "generation-rejected", reason: "worker-has-no-recoverable-handoffs"})
        jsonSocket.close()
        return false
      }

      handoffs = new Map(durableHandoffs.map(({jobId, handoffId}) => [jobId, handoffId]))
      this.reconnectedWorkerIds.add(workerId)
    }

    if (disconnected) {
      this.clock.clearTimeout(disconnected.timer)
      if (workerId) this.disconnectedWorkers.delete(workerId)
      this.workerHandoffs.delete(disconnected.worker)
    }

    this.workers.add(jsonSocket)
    this.workerHandoffs.set(jsonSocket, handoffs || new Map())
    if (recoveryOnly) jsonSocket.isDraining = true
    if (!handoffs && this.lifecycleState === "active") this._trackWorkerHandoffAdoption(jsonSocket)

    return true
  }

  /**
   * Tracks a worker handoff-adoption query through shutdown.
   * @param {JsonSocket} jsonSocket - Reconnecting worker socket.
   * @returns {void}
   */
  _trackWorkerHandoffAdoption(jsonSocket) {
    const adoption = this._adoptWorkerHandoffs(jsonSocket)
    this.inflightWorkerHandoffAdoptions.add(adoption)
    const removeAdoption = () => {
      this.inflightWorkerHandoffAdoptions.delete(adoption)
      this._maybeStopRetired()
    }
    void adoption.then(removeAdoption, removeAdoption)
  }

  /**
   * Waits for worker handoff-adoption queries to finish.
   * @returns {Promise<void>} - Resolves when no adoption query remains.
   */
  async _drainWorkerHandoffAdoptions() {
    while (this.inflightWorkerHandoffAdoptions.size > 0) {
      await Promise.all([...this.inflightWorkerHandoffAdoptions])
    }
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
      this.reconnectedWorkerIds.add(workerId)
    } catch (error) {
      this._reportHandoffAdoptError(error)
    }
  }

  /**
   * Runs handle client socket message.
   * @param {object} args - Options.
   * @param {JsonSocket} args.jsonSocket - JSON socket.
   * @param {import("./types.js").BackgroundJobSocketMessage} args.message - Socket message.
   * @returns {Promise<void>} - Resolves after the request is acknowledged.
   */
  async _handleClientSocketMessage({jsonSocket, message}) {
    if (this.generationId && (this.lifecycleState === "retiring" || this.lifecycleState === "retired")) {
      if (message?.type === "enqueue") jsonSocket.send({type: "enqueue-error", error: "Background jobs generation is retired"})
      if (message?.type === "replace-scheduled") jsonSocket.send({type: "replace-scheduled-error", error: "Background jobs generation is retired"})
      if (message?.type === "cancel-scheduled") jsonSocket.send({type: "cancel-scheduled-error", error: "Background jobs generation is retired"})
      return
    }

    if (message?.type === "enqueue") {
      await this._handleEnqueue({jsonSocket, message})
      return
    }

    if (message?.type === "replace-scheduled") {
      await this._handleReplaceScheduled({jsonSocket, message})
      return
    }

    if (message?.type === "cancel-scheduled") {
      await this._handleCancelScheduled({jsonSocket, message})
    }
  }

  /**
   * Runs handle worker socket message.
   * @param {object} args - Options.
   * @param {JsonSocket} args.jsonSocket - JSON socket.
   * @param {import("./types.js").BackgroundJobSocketMessage} args.message - Socket message.
   * @returns {Promise<void>} - Resolves after the worker message is handled.
   */
  async _handleWorkerSocketMessage({jsonSocket, message}) {
    // Any message from the worker proves it is alive; the liveness sweep uses
    // this to detect a wedged/silent worker.
    jsonSocket.lastSeenAt = this.clock.now()

    if (message?.type === "heartbeat") {
      this.onWorkerHeartbeat?.(jsonSocket)
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

    await this._handleReporterSocketMessage({jsonSocket, message})
  }

  /**
   * Runs handle reporter socket message.
   * @param {object} args - Options.
   * @param {JsonSocket} args.jsonSocket - JSON socket.
   * @param {import("./types.js").BackgroundJobSocketMessage} args.message - Socket message.
   * @returns {Promise<void>} - Resolves after the report is acknowledged.
   */
  async _handleReporterSocketMessage({jsonSocket, message}) {
    if (this.generationId && this._generationReportIsInvalid(message)) {
      if ("jobId" in message && typeof message.jobId === "string") {
        jsonSocket.send({type: "job-update-error", jobId: message.jobId, error: "Generation ownership rejected"})
      }
      return
    }
    if (message?.type === "job-complete") {
      await this._handleJobComplete({jsonSocket, message})
      return
    }

    if (message?.type === "job-failed") {
      await this._handleJobFailed({jsonSocket, message})
      return
    }

    if (message?.type === "job-reschedule") {
      await this._handleJobReschedule({jsonSocket, message})
    }
  }

  /**
   * Requires the complete durable lease identity before a generation-mode
   * reporter can mutate a job. Legacy reporters keep their permissive protocol.
   * @param {import("./types.js").BackgroundJobSocketMessage} message - Reporter message.
   * @returns {boolean} - Whether the report lacks its exact generation lease.
   */
  _generationReportIsInvalid(message) {
    if (message?.type !== "job-complete" && message?.type !== "job-failed" && message?.type !== "job-reschedule") return false
    const generationId = this.generationId
    if (!generationId) return false

    return typeof message.handoffId !== "string"
      || typeof message.handedOffAtMs !== "number"
      || !workerIdBelongsToGeneration({generationId, workerId: message.workerId})
  }

  /**
   * Runs handle worker ready.
   * @param {object} args - Options.
   * @param {JsonSocket} args.jsonSocket - JSON socket.
   * @param {import("./types.js").BackgroundJobReadyMessage} args.message - Ready message.
   * @returns {void}
   */
  _handleWorkerReady({jsonSocket, message}) {
    if (this.lifecycleState === "retiring" || this.lifecycleState === "retired") {
      this.readyWorkers.delete(jsonSocket)
      this.candidateReadyWorkers.delete(jsonSocket)
      return
    }

    jsonSocket.readinessVersion += 1
    jsonSocket.acceptsSpawnedJobs = message.acceptsSpawned !== false && message.acceptsForked !== false
    jsonSocket.acceptsForkedJobs = message.acceptsForked !== false
    jsonSocket.acceptsPooledJobs = message.acceptsPooled === true
    const availablePooledSlots = message.availablePooledSlots
    jsonSocket.usesPooledCapacityCredits = Number.isInteger(availablePooledSlots)
    jsonSocket.availablePooledSlots = Number.isInteger(availablePooledSlots) && availablePooledSlots !== undefined && availablePooledSlots > 0
      ? availablePooledSlots
      : 0
    jsonSocket.acceptsInlineJobs = message.acceptsInline !== false
    if (this.lifecycleState === "candidate") {
      this.readyWorkers.delete(jsonSocket)
      if (!jsonSocket.isDraining) this.candidateReadyWorkers.add(jsonSocket)
    } else if (this.lifecycleState === "active" && this._activeOwnershipReady && jsonSocket.supportsHandoffIdReporting && !jsonSocket.isDraining) {
      this.readyWorkers.add(jsonSocket)
    } else {
      this.readyWorkers.delete(jsonSocket)
      this.candidateReadyWorkers.delete(jsonSocket)
    }
    this.onWorkerReady?.(jsonSocket)
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
    jsonSocket.isDraining = true
    this.readyWorkers.delete(jsonSocket)
    this.candidateReadyWorkers.delete(jsonSocket)
  }

  /**
   * Removes a lost worker socket and releases only leases dispatched through it.
   * @param {JsonSocket} worker - Disconnected worker socket.
   * @param {object} [args] - Coordination options.
   * @param {boolean} [args.queueRedrain] - Queue another pass instead of awaiting the active drain.
   * @returns {Promise<void>} - Resolves after its active leases are released.
   */
  async _handleWorkerSocketClosed(worker, {queueRedrain = false} = {}) {
    this.workers.delete(worker)
    this.readyWorkers.delete(worker)
    this.candidateReadyWorkers.delete(worker)

    if (this._stopped) {
      this.workerHandoffs.delete(worker)
      return
    }

    const handoffs = this.workerHandoffs.get(worker)
    if (this.generationId && worker.workerId && handoffs && handoffs.size > 0) {
      const existing = this.disconnectedWorkers.get(worker.workerId)
      if (existing?.worker === worker) return
      if (existing) this.clock.clearTimeout(existing.timer)

      const timer = this.clock.setTimeout(() => {
        this.disconnectedWorkers.delete(worker.workerId || "")
        void this._releaseWorkerHandoffs(worker).then(() => {
          if (worker.workerId) this.onWorkerHandoffsReleased?.(worker.workerId)
        }, (error) => {
          this._reportHandoffReleaseError(error)
          this._scheduleErrorRetry()
        })
      }, this.workerReconnectGraceMs)
      if (typeof timer === "object") timer.unref()
      this.disconnectedWorkers.set(worker.workerId, {worker, timer})
      this.onWorkerDisconnected?.(worker.workerId)
      return
    }

    try {
      await this._releaseWorkerHandoffs(worker, {queueRedrain})
    } catch (error) {
      this._reportHandoffReleaseError(error)
      this._scheduleErrorRetry()
    }
    this._maybeStopRetired()
  }

  /**
   * Releases all leases still owned by one exact worker socket.
   * @param {JsonSocket} worker - Worker socket.
   * @param {object} [args] - Coordination options.
   * @param {boolean} [args.queueRedrain] - Queue another pass instead of awaiting the active drain.
   * @returns {Promise<void>} - Resolves after fenced releases and dispatch wake-up.
   */
  async _releaseWorkerHandoffs(worker, {queueRedrain = false} = {}) {
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
    if (queueRedrain) {
      this._redrainQueued = true
    } else {
      if (this.lifecycleState === "active") await this._drain()
    }
    this._maybeStopRetired()
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
      if (handoffs.size === 0 && worker.workerId) {
        const disconnected = this.disconnectedWorkers.get(worker.workerId)
        if (disconnected?.worker === worker) {
          this.clock.clearTimeout(disconnected.timer)
          this.disconnectedWorkers.delete(worker.workerId)
        }
      }
      this._maybeStopRetired()
      return
    }
  }

  /**
   * Reports an unexpected lease-release failure on framework error channels.
   * @param {ReturnType<typeof JSON.parse>} error - Release failure.
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
   * @param {ReturnType<typeof JSON.parse>} error - Adoption failure.
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
   * Reports an unexpected startup-snapshot reclaim failure while retaining the
   * snapshot for the dispatcher's existing transient-error retry lifecycle.
   * @param {ReturnType<typeof JSON.parse>} error - Reclaim failure.
   * @returns {void}
   */
  _reportStartupHandoffReclaimError(error) {
    const normalizedError = error instanceof Error ? error : new Error(String(error))
    const payload = {context: {stage: "background-job-startup-handoff-reclaim"}, error: normalizedError}
    const errorEvents = this.configuration.getErrorEvents()

    this.logger.error(() => ["Failed to reclaim disconnected startup handoffs:", normalizedError])
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
      this._handleClientMutationError({
        context: {jobName: message.jobName, stage: "background-job-enqueue"},
        error,
        fallbackMessage: "Failed to enqueue job",
        jsonSocket,
        logMessage: "Failed to enqueue background job:",
        responseType: "enqueue-error"
      })
    }
  }

  /**
   * Handles a stable-key replacement request and re-arms dispatch afterward.
   * @param {object} args - Options.
   * @param {JsonSocket} args.jsonSocket - JSON socket.
   * @param {import("./types.js").BackgroundJobReplaceScheduledMessage} args.message - Message.
   * @returns {Promise<void>} - Resolves when handled.
   */
  async _handleReplaceScheduled({jsonSocket, message}) {
    try {
      const result = await this.store.replaceScheduled({
        scheduleKey: message.scheduleKey,
        jobName: message.jobName,
        args: message.args || [],
        options: message.options || {}
      })

      this._notifyEnqueued()
      await this._drain()
      jsonSocket.send({type: "schedule-replaced", ...result})
    } catch (error) {
      this._handleClientMutationError({
        context: {jobName: message.jobName, scheduleKey: message.scheduleKey, stage: "background-job-replace-scheduled"},
        error,
        fallbackMessage: "Failed to replace scheduled job",
        jsonSocket,
        logMessage: "Failed to replace scheduled background job:",
        responseType: "replace-scheduled-error"
      })
    }
  }

  /**
   * Handles a stable-key cancellation request and re-arms dispatch afterward.
   * @param {object} args - Options.
   * @param {JsonSocket} args.jsonSocket - JSON socket.
   * @param {import("./types.js").BackgroundJobCancelScheduledMessage} args.message - Message.
   * @returns {Promise<void>} - Resolves when handled.
   */
  async _handleCancelScheduled({jsonSocket, message}) {
    try {
      const result = await this.store.cancelScheduled(message.scheduleKey)

      this._notifyEnqueued()
      await this._drain()
      jsonSocket.send({type: "schedule-cancelled", ...result})
    } catch (error) {
      this._handleClientMutationError({
        context: {scheduleKey: message.scheduleKey, stage: "background-job-cancel-scheduled"},
        error,
        fallbackMessage: "Failed to cancel scheduled job",
        jsonSocket,
        logMessage: "Failed to cancel scheduled background job:",
        responseType: "cancel-scheduled-error"
      })
    }
  }

  /**
   * Returns safe validation failures and reports unexpected client mutations.
   * @param {object} args - Options.
   * @param {Record<string, ReturnType<typeof JSON.parse>>} args.context - Framework-error context.
   * @param {ReturnType<typeof JSON.parse>} args.error - Mutation failure.
   * @param {string} args.fallbackMessage - Client-safe fallback message.
   * @param {JsonSocket} args.jsonSocket - JSON socket.
   * @param {string} args.logMessage - Error log prefix.
   * @param {"enqueue-error" | "replace-scheduled-error" | "cancel-scheduled-error"} args.responseType - Response type.
   * @returns {void}
   */
  _handleClientMutationError({context, error, fallbackMessage, jsonSocket, logMessage, responseType}) {
    if (error instanceof VelociousError && error.safeToExpose) {
      jsonSocket.send({type: responseType, error: error.message})
      return
    }

    const normalizedError = error instanceof Error ? error : new Error(String(error))
    const payload = {context, error: normalizedError}
    const errorEvents = this.configuration.getErrorEvents()

    this.logger.error(() => [logMessage, normalizedError])
    errorEvents.emit("framework-error", payload)
    errorEvents.emit("all-error", {...payload, errorType: "framework-error"})
    jsonSocket.send({type: responseType, error: fallbackMessage})
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
      this.onJobUpdated?.({accepted, jobId: message.jobId, status: "completed"})
      jsonSocket.send({type: "job-updated", jobId: message.jobId})
    } catch (error) {
      this._reportJobUpdateFailure({error, jobId: message.jobId, stage: "background-job-complete"})
      jsonSocket.send({type: "job-update-error", jobId: message.jobId, error: "Failed to update job"})
    }
  }

  /**
   * Surfaces an unexpected durable report failure without exposing it to the
   * reporting peer.
   * @param {object} args - Failure context.
   * @param {ReturnType<typeof JSON.parse>} args.error - Adapter failure.
   * @param {string} args.jobId - Durable job id.
   * @param {string} args.stage - Mutation stage.
   */
  _reportJobUpdateFailure({error, jobId, stage}) {
    const normalizedError = error instanceof Error ? error : new Error(String(error))
    const payload = {context: {generationId: this.generationId, jobId, stage}, error: normalizedError}
    const errorEvents = this.configuration.getErrorEvents()

    this.logger.error(() => ["Failed to update background job:", normalizedError])
    errorEvents.emit("framework-error", payload)
    errorEvents.emit("all-error", {...payload, errorType: "framework-error"})
  }

  /**
   * Persists a normal job reschedule outcome and wakes scheduled dispatch.
   * @param {object} args - Options.
   * @param {JsonSocket} args.jsonSocket - JSON socket.
   * @param {import("./types.js").BackgroundJobRescheduleMessage} args.message - Message.
   * @returns {Promise<void>} - Resolves when handled.
   */
  async _handleJobReschedule({jsonSocket, message}) {
    try {
      const accepted = await this.store.markRescheduled({
        jobId: message.jobId,
        delayMs: message.delayMs,
        handoffId: message.handoffId,
        workerId: message.workerId,
        handedOffAtMs: message.handedOffAtMs
      })
      if (accepted && message.handoffId) {
        this._forgetHandoff({handoffId: message.handoffId, jobId: message.jobId})
      }
      this.onJobUpdated?.({accepted, jobId: message.jobId, status: "rescheduled"})
      jsonSocket.send({type: "job-updated", jobId: message.jobId})
      this._notifyEnqueued()
      await this._drain()
    } catch (error) {
      const normalizedError = error instanceof Error ? error : new Error(String(error))
      const payload = {context: {jobId: message.jobId, stage: "background-job-reschedule"}, error: normalizedError}
      const errorEvents = this.configuration.getErrorEvents()

      this.logger.error(() => ["Failed to update job reschedule:", normalizedError])
      errorEvents.emit("framework-error", payload)
      errorEvents.emit("all-error", {...payload, errorType: "framework-error"})
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
          runnerFailure: message.runnerFailure,
          workerId: message.workerId
        })
      }

      this.onJobUpdated?.({accepted: Boolean(failedJob), jobId: message.jobId, status: "failed"})
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
   * @param {{error: ReturnType<typeof JSON.parse>, handoffId?: string, handedOffAtMs?: number, job: import("./types.js").BackgroundJobRow, runnerFailure?: import("./types.js").PooledRunnerFailure, workerId?: string}} args - Failure event data.
   * @returns {void}
   */
  _emitBackgroundJobFailed({error, handoffId, handedOffAtMs, job, runnerFailure, workerId}) {
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
        runnerFailure,
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
   * @param {ReturnType<typeof JSON.parse>} error - Reported failure value.
   * @returns {Error} Normalized error.
   */
  _normalizeFailureError(error) {
    if (error instanceof Error) return error

    return this._errorFromUnknownFailure(error)
  }

  /**
   * Runs error from unknown failure.
   * @param {ReturnType<typeof JSON.parse>} error - Reported failure value.
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
   * @param {ReturnType<typeof JSON.parse>} error - Reported failure value.
   * @returns {string} Error message.
   */
  _messageFromUnknownFailure(error) {
    if (this._hasStringFailure(error)) return error.trim().split("\n")[0]

    return String(error || "Background job failed")
  }

  /**
   * Runs has string failure.
   * @param {ReturnType<typeof JSON.parse>} error - Reported failure value.
   * @returns {error is string} Whether the value is a non-empty string.
   */
  _hasStringFailure(error) {
    return typeof error === "string" && error.trim().length > 0
  }

  /**
   * Runs copy string failure stack.
   * @param {object} args - Options.
   * @param {ReturnType<typeof JSON.parse>} args.error - Reported failure value.
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
    if (this._stopped || this.lifecycleState !== "active" || !this._activeOwnershipReady) return

    if (this._drainPromise) {
      this._redrainQueued = true
      await this._drainPromise
      return
    }

    const drainPromise = this._drainToCompletion()

    this._drainPromise = drainPromise
    await drainPromise
  }

  /**
   * Runs one serialized drain lifecycle, including timer re-arming.
   * @returns {Promise<void>} - Resolves after every coalesced request is handled.
   */
  async _drainToCompletion() {
    this._draining = true

    try {
      let errored

      do {
        errored = await this._drainUntilIdle()
        await this._finishDrain({errored})
      } while (!errored && this._redrainQueued && !this._stopped && this.lifecycleState === "active")
    } finally {
      this._draining = false
      this._drainPromise = undefined
    }
  }

  /**
   * Runs finish drain.
   * @param {object} args - Options.
   * @param {boolean} args.errored - Whether the drain hit an error.
   * @returns {Promise<void>} - Resolves after follow-up timers are handled.
   */
  async _finishDrain({errored}) {
    if (this._stopped || this.lifecycleState !== "active") return
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
    if (this.pendingHandoffRecoveries.size > 0) return
    if (this._startupHandoffGraceElapsed && this.startupHandoffSnapshot.length > 0) return

    for (const worker of this.workerHandoffs.keys()) {
      if (!this.workers.has(worker)) return
    }

    if (this._errorRetryTimer) {
      clearTimeout(this._errorRetryTimer)
      this._errorRetryTimer = undefined
    }
  }

  /**
   * Runs drain until idle.
   * @returns {Promise<boolean>} - Whether the drain hit an error.
   */
  async _drainUntilIdle() {
    return await this._runDrainLoop()
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
    if (this.dispatchStrategy === "polling" && this.lifecycleState === "active") return

    this._errorRetryTimer = setTimeout(() => {
      this._errorRetryTimer = undefined
      void this._retryAfterError()
    }, this.pollIntervalMs)
  }

  /**
   * Retries failed pre-dispatch and disconnected-socket releases before
   * draining queued work.
   * @returns {Promise<void>} - Resolves after retry work.
   */
  async _retryAfterError() {
    if (this._stopped) return

    if (this._startupHandoffGraceElapsed && this.startupHandoffSnapshot.length > 0) {
      await this._startStartupHandoffReclaim()
      if (this.startupHandoffSnapshot.length > 0) return
    }

    try {
      await this._retryPendingHandoffRecoveries()
    } catch {
      this._scheduleErrorRetry()
      return
    }

    try {
      for (const worker of this.workerHandoffs.keys()) {
        if (!this.workers.has(worker)) await this._releaseWorkerHandoffs(worker)
      }
    } catch (error) {
      this._reportHandoffReleaseError(error)
      this._scheduleErrorRetry()
      return
    }

    if (this.lifecycleState === "active") await this._drain()
    this._maybeStopRetired()
  }

  /**
   * Inner drain loop: pulls eligible queued jobs and hands them off to
   * ready workers until one of them runs out.
   * @returns {Promise<void>}
   */
  async _drainOnce() {
    while (this.readyWorkers.size > 0 && !this._stopped && this.lifecycleState === "active" && this._activeOwnershipReady) {
      const job = await this.nextAvailableJobForReadyWorkers()
      if (!job) return

      const worker = this.readyWorkerForJob(job)
      if (!worker) return

      const admission = this._consumeWorkerAdmission({job, worker})
      const requestedHandoffId = randomUUID()
      let handoff

      try {
        handoff = await this.store.markHandedOff({handoffId: requestedHandoffId, jobId: job.id, workerId: worker.workerId})
      } catch (error) {
        this._rememberHandoffRecovery({handoffId: requestedHandoffId, jobId: job.id})
        this._restoreWorkerAdmission({...admission, worker})

        try {
          await this._recoverHandoff({handoffId: requestedHandoffId, jobId: job.id})
        } catch (recoveryError) {
          this._reportHandoffRecoveryError({error: recoveryError, handoffId: requestedHandoffId, jobId: job.id})
        }

        throw error
      }

      if (!handoff) {
        this._restoreWorkerAdmission({...admission, worker})
        continue
      }

      await this.afterHandoffClaim?.({handoff, job})

      const handoffs = this.workerHandoffs.get(worker)

      if (!handoffs || !this.workers.has(worker) || worker.isDraining || this.lifecycleState !== "active" || !this._activeOwnershipReady) {
        this._rememberHandoffRecovery({handoffId: handoff.handoffId, jobId: job.id})
        try {
          await this._recoverHandoff({handoffId: handoff.handoffId, jobId: job.id})
        } catch (recoveryError) {
          this._reportHandoffRecoveryError({error: recoveryError, handoffId: handoff.handoffId, jobId: job.id})
          throw recoveryError
        }
        this._notifyEnqueued()
        this._redrainQueued = true
        continue
      }

      this._finalizeWorkerAdmission({...admission, job, worker})
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
              concurrencyKey: job.concurrencyKey || undefined,
              executionMode: job.executionMode,
              maxConcurrency: job.maxConcurrency ?? undefined,
              maxRetries: job.maxRetries ?? undefined,
              queue: job.queue,
              scheduledAtMs: job.scheduledAtMs ?? undefined,
              ...(job.timeoutMs === null ? {} : {timeoutMs: job.timeoutMs})
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
        await this._handleWorkerSocketClosed(worker, {queueRedrain: true})
      }
    }
  }

  /**
   * Consumes one advertised worker admission while persistence is in flight.
   * @param {object} args - Admission details.
   * @param {import("./types.js").BackgroundJobRow} args.job - Selected job.
   * @param {JsonSocket} args.worker - Selected worker socket.
   * @returns {{pooledCreditConsumed: boolean, readinessVersion: number}} - Reversible admission debit.
   */
  _consumeWorkerAdmission({job, worker}) {
    let pooledCreditConsumed = false

    this.readyWorkers.delete(worker)

    if (job.executionMode === "pooled" && worker.usesPooledCapacityCredits && worker.availablePooledSlots > 0) {
      pooledCreditConsumed = true
      worker.availablePooledSlots -= 1
      if (worker.availablePooledSlots > 0) this.readyWorkers.add(worker)
    }

    return {pooledCreditConsumed, readinessVersion: worker.readinessVersion}
  }

  /**
   * Restores an admission that never reached a worker. A newer readiness
   * advertisement is already authoritative, so its pooled count is not changed.
   * @param {object} args - Admission details.
   * @param {boolean} args.pooledCreditConsumed - Whether a pooled credit was debited.
   * @param {number} args.readinessVersion - Readiness generation at debit time.
   * @param {JsonSocket} args.worker - Selected worker socket.
   * @returns {void}
   */
  _restoreWorkerAdmission({pooledCreditConsumed, readinessVersion, worker}) {
    if (this._stopped || this.lifecycleState !== "active" || !this._activeOwnershipReady || !this.workers.has(worker) || worker.isDraining) return

    if (pooledCreditConsumed && worker.readinessVersion === readinessVersion) {
      worker.availablePooledSlots += 1
    }

    if (worker.supportsHandoffIdReporting) this.readyWorkers.add(worker)
  }

  /**
   * Applies a successful pooled admission to a readiness advertisement that
   * arrived while persistence was in flight and replaced the earlier debit.
   * @param {object} args - Admission details.
   * @param {import("./types.js").BackgroundJobRow} args.job - Selected job.
   * @param {boolean} args.pooledCreditConsumed - Whether a pooled credit was debited.
   * @param {number} args.readinessVersion - Readiness generation at debit time.
   * @param {JsonSocket} args.worker - Selected worker socket.
   * @returns {void}
   */
  _finalizeWorkerAdmission({job, pooledCreditConsumed, readinessVersion, worker}) {
    if (!pooledCreditConsumed || job.executionMode !== "pooled") return
    if (worker.readinessVersion === readinessVersion || !worker.usesPooledCapacityCredits) return
    if (worker.availablePooledSlots <= 0) return

    worker.availablePooledSlots -= 1
    if (worker.availablePooledSlots === 0) this.readyWorkers.delete(worker)
  }

  /**
   * Retains an exact lease for idempotent pre-dispatch recovery.
   * @param {{handoffId: string, jobId: string}} args - Exact recovery fence.
   * @returns {void}
   */
  _rememberHandoffRecovery({handoffId, jobId}) {
    this.pendingHandoffRecoveries.set(handoffId, jobId)
  }

  /**
   * Returns one exact lease and forgets it only after the adapter acknowledges
   * the fenced transition or confirms it was already absent.
   * @param {{handoffId: string, jobId: string}} args - Exact recovery fence.
   * @returns {Promise<void>} - Resolves after durable recovery settles.
   */
  async _recoverHandoff({handoffId, jobId}) {
    await this.store.markReturnedToQueue({handoffId, jobId})

    if (this.pendingHandoffRecoveries.get(handoffId) === jobId) {
      this.pendingHandoffRecoveries.delete(handoffId)
    }
  }

  /**
   * Replays retained exact-ID recoveries through the dispatcher's existing
   * transient-error retry lifecycle.
   * @returns {Promise<void>} - Resolves after every retained recovery settles.
   */
  async _retryPendingHandoffRecoveries() {
    for (const [handoffId, jobId] of [...this.pendingHandoffRecoveries]) {
      try {
        await this._recoverHandoff({handoffId, jobId})
      } catch (error) {
        this._reportHandoffRecoveryError({error, handoffId, jobId})
        throw error
      }
    }
  }

  /**
   * Surfaces a failed exact-ID recovery without dropping its retry ledger entry.
   * @param {object} args - Recovery failure.
   * @param {ReturnType<typeof JSON.parse>} args.error - Adapter failure.
   * @param {string} args.handoffId - Exact lease fence.
   * @param {string} args.jobId - Job id.
   * @returns {void}
   */
  _reportHandoffRecoveryError({error, handoffId, jobId}) {
    const normalizedError = error instanceof Error ? error : new Error(String(error))
    const payload = {
      context: {handoffId, jobId, stage: "background-job-handoff-admission-recovery"},
      error: normalizedError
    }
    const errorEvents = this.configuration.getErrorEvents()

    this.logger.error(() => ["Failed to recover an ambiguous background job handoff:", normalizedError])
    errorEvents.emit("framework-error", payload)
    errorEvents.emit("all-error", {...payload, errorType: "framework-error"})
  }

  /**
   * Runs next available job for ready workers.
   * @returns {Promise<import("./types.js").BackgroundJobRow | null>} - Next queued job matching ready worker capacity.
   */
  async nextAvailableJobForReadyWorkers() {
    const executionModes = this.readyWorkerExecutionModes()

    if (executionModes.length === 0) return null
    if (executionModes.length === WORKER_EXECUTION_MODE_CAPABILITIES.length) return await this.store.nextAvailableJob()

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

    if (this._stopped || this.lifecycleState !== "active" || !this._activeOwnershipReady) return
    if (this.dispatchStrategy === "polling") return

    const next = await this.store.nextScheduledJob()
    let delay

    if (next && typeof next.scheduledAtMs === "number") {
      delay = Math.max(0, Math.min(next.scheduledAtMs - this.clock.now(), MAX_TIMER_MS))
    }

    // `nextScheduledJob` only returns future jobs, so a job that became
    // eligible after the drain's eligible-job probe is invisible to it. If one
    // is dispatchable now, arm a 0-delay re-drain so it is dispatched
    // immediately instead of being stranded until the next future timer (or
    // external signal) fires.
    if (await this.nextAvailableJobForReadyWorkers()) delay = 0

    if (typeof delay !== "number") return

    this._scheduledTimer = setTimeout(() => {
      this._scheduledTimer = undefined
      void this._drain()
    }, delay)
  }

  async _sweepOrphans() {
    try {
      let orphanedJobs

      if (this.generationId) {
        const connectedWorkerIds = new Set()
        for (const worker of this.workers) {
          if (worker.workerId) connectedWorkerIds.add(worker.workerId)
        }
        for (const workerId of this.disconnectedWorkers.keys()) connectedWorkerIds.add(workerId)

        const cutoff = this.clock.now() - GENERATION_ORPHANED_AFTER_MS
        const handoffs = (await this._generationOwnedHandoffSnapshot()).filter((handoff) => {
          return handoff.handedOffAtMs <= cutoff && !connectedWorkerIds.has(handoff.workerId)
        })
        orphanedJobs = handoffs.length === 0
          ? []
          : await this.store.markOrphanedHandoffs({handoffs, error: "Job orphaned after its generation owner disappeared"})
      } else {
        orphanedJobs = await this.store.markOrphanedJobs()
      }

      await this._handleOrphanedJobs({jobs: orphanedJobs, warning: "Marked orphaned background jobs"})
    } catch (error) {
      const normalizedError = error instanceof Error ? error : new Error(String(error))
      const payload = {context: {generationId: this.generationId, stage: "background-job-orphan-sweep"}, error: normalizedError}
      const errorEvents = this.configuration.getErrorEvents()

      this.logger.error(() => ["Failed to mark orphaned jobs:", normalizedError])
      errorEvents.emit("framework-error", payload)
      errorEvents.emit("all-error", {...payload, errorType: "framework-error"})
    }
  }

  /**
   * Publishes the common post-orphan lifecycle: wake queued retries, emit one
   * isolated event per accepted transition, and drain so released concurrency
   * can immediately admit other work.
   * @param {object} args - Options.
   * @param {import("./types.js").BackgroundJobRow[]} args.jobs - Accepted orphan transitions.
   * @param {string} args.warning - Lifecycle log message.
   * @returns {Promise<void>} - Resolves after the resulting drain.
   */
  async _handleOrphanedJobs({jobs, warning}) {
    if (jobs.length === 0) {
      this._maybeStopRetired()
      return
    }

    this.logger.warn(() => [warning, jobs.length])
    // Reclaimed orphans can become `queued` again — wake the dispatcher first
    // so an application event handler that throws below cannot strand them.
    this._notifyEnqueued()
    // Emit before awaiting the drain so a blocked dispatcher cannot delay
    // application recovery. Isolate handlers so one cannot suppress the rest.
    for (const job of jobs) {
      try {
        this._emitBackgroundJobOrphaned({job})
      } catch (error) {
        this.logger.error(() => ["A background-job-orphaned event handler threw:", error])
      }
    }
    await this._drain()
    this._maybeStopRetired()
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

    const cutoff = this.clock.now() - this.workerStaleTimeoutMs
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
