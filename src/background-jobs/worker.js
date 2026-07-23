// @ts-check

import net from "net"
import {fork, spawn} from "node:child_process"
import JsonSocket from "./json-socket.js"
import BackgroundJobRegistry from "./job-registry.js"
import configurationResolver from "../configuration-resolver.js"
import BackgroundJobsStatusReporter from "./status-reporter.js"
import {randomUUID} from "crypto"
import {fileURLToPath} from "node:url"

/** Grace period after SIGTERM before a lingering process runner is SIGKILLed. */
const FORKED_CHILD_SIGKILL_GRACE_MS = 5000
/**
 * Largest delay Node's `setTimeout` accepts without overflowing to a 1ms delay
 * (a 32-bit signed int of ms, ~24.8 days). A `jobTimeoutMs` above this — or a
 * non-finite one like `Infinity` — is clamped/disabled rather than coerced to
 * ~1ms, which would otherwise terminate every forked job almost immediately.
 */
const MAX_FORKED_JOB_TIMEOUT_MS = 2_147_483_647
const FORKED_RUNNER_ENTRY_PATH = fileURLToPath(new URL("./forked-runner-child.js", import.meta.url))
const POOLED_RUNNER_ENTRY_PATH = fileURLToPath(new URL("./pooled-runner-child.js", import.meta.url))
/** How often the worker sends a liveness heartbeat to the main. */
const HEARTBEAT_INTERVAL_MS = 15000
/** TCP keepalive so a half-open connection to the main surfaces as a close. */
const SOCKET_KEEPALIVE_MS = 10000
/**
 * Execution modes.
 * @type {import("./types.js").BackgroundJobExecutionMode[]} */
const EXECUTION_MODES = ["inline", "forked", "pooled", "spawned"]

/**
 * Normalizes a candidate pooled-runner count or job limit.
 * @param {number | undefined} value - Candidate positive integer.
 * @returns {number | undefined} - Normalized value.
 */
function positiveInteger(value) {
  return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : undefined
}

/**
 * Normalizes a candidate pooled-runner resource limit.
 * @param {number | undefined} value - Candidate positive number.
 * @returns {number | undefined} - Normalized value.
 */
function positiveNumber(value) {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : undefined
}

/**
 * Per-forked-child timeout bookkeeping.
 * @typedef {object} ForkedJobTimeoutState
 * @property {boolean} timedOut - Whether the timeout fired and the child was terminated.
 * @property {number | null} timeoutMs - The armed timeout in ms, or null when disabled.
 * @property {ReturnType<typeof setTimeout> | null} timer - The pending timeout timer, cleared on exit.
 * @property {ReturnType<typeof setTimeout> | null} sigkillTimer - The pending SIGKILL grace timer, cleared on exit.
 */

export default class BackgroundJobsWorker {
  /**
   * Runs constructor.
   * @param {object} [args] - Options.
   * @param {import("../configuration.js").default} [args.configuration] - Configuration.
   * @param {string} [args.host] - Hostname.
   * @param {number} [args.port] - Port.
   * @param {number} [args.maxConcurrentForkedJobs] - Override the process runner concurrency cap from `configuration.getBackgroundJobsConfig()`.
   * @param {number} [args.maxConcurrentInlineJobs] - Override the inline-job concurrency cap from `configuration.getBackgroundJobsConfig()`.
   * @param {number} [args.pooledRunnerCount] - Override the pooled runner count.
   * @param {number} [args.pooledRunnerConcurrency] - Override the per-runner concurrency.
   * @param {number} [args.pooledRunnerMaxJobs] - Override the per-runner recycle job count.
   * @param {number} [args.pooledRunnerMaxRssBytes] - Override the per-runner recycle RSS limit.
   * @param {number} [args.pooledRunnerMaxLifetimeMs] - Override the per-runner recycle lifetime.
   * @param {number} [args.forkedChildSigkillGraceMs] - Override the grace period between SIGTERM and SIGKILL when reaping lingering process runners on stop.
   * @param {number} [args.heartbeatIntervalMs] - Override the liveness heartbeat interval (default 15000ms).
   * @param {number} [args.jobTimeoutMs] - Override the wall-clock timeout for forked and pooled jobs from `configuration.getBackgroundJobsConfig()`. `0` disables it.
   * @param {boolean} [args.closeDatabaseConnectionsOnStop] - Whether stop owns closing the configuration's database pools (default true).
   */
  constructor({configuration, host, port, maxConcurrentForkedJobs, maxConcurrentInlineJobs, pooledRunnerCount, pooledRunnerConcurrency, pooledRunnerMaxJobs, pooledRunnerMaxRssBytes, pooledRunnerMaxLifetimeMs, forkedChildSigkillGraceMs, heartbeatIntervalMs, jobTimeoutMs, closeDatabaseConnectionsOnStop = true} = {}) {
    /**
     * Narrows the runtime value to the documented type.
     * @type {Promise<import("../configuration.js").default>} */
    this.configurationPromise = configuration ? Promise.resolve(configuration) : configurationResolver()
    /**
     * Narrows the runtime value to the documented type.
     * @type {import("../configuration.js").default | undefined} */
    this.configuration = undefined
    this.host = host
    this.port = port
    this.closeDatabaseConnectionsOnStop = closeDatabaseConnectionsOnStop
    /**
     * Constructor override for the inline-job concurrency cap. When unset
     * the cap is read from `configuration.getBackgroundJobsConfig()` in
     * `start()` (default: 4).
     * @type {number | undefined}
     */
    this.maxConcurrentInlineJobsOverride = typeof maxConcurrentInlineJobs === "number" && maxConcurrentInlineJobs >= 1
      ? maxConcurrentInlineJobs
      : undefined
    /**
     * Narrows the runtime value to the documented type.
     * @type {number | undefined} */
    this.maxConcurrentForkedJobsOverride = typeof maxConcurrentForkedJobs === "number" && maxConcurrentForkedJobs >= 1
      ? maxConcurrentForkedJobs
      : undefined
    /**
     * Resolved cap for inline-job concurrency. Set in `start()`; defaults to
     * 4 if no configuration value is available.
     * @type {number}
     */
    this.maxConcurrentInlineJobs = this.maxConcurrentInlineJobsOverride || 4
    /**
     * Narrows the runtime value to the documented type.
     * @type {number} */
    this.maxConcurrentForkedJobs = this.maxConcurrentForkedJobsOverride || 4
    this.pooledRunnerCountOverride = positiveInteger(pooledRunnerCount)
    this.pooledRunnerConcurrencyOverride = positiveInteger(pooledRunnerConcurrency)
    this.pooledRunnerMaxJobsOverride = positiveInteger(pooledRunnerMaxJobs)
    this.pooledRunnerMaxRssBytesOverride = positiveNumber(pooledRunnerMaxRssBytes)
    this.pooledRunnerMaxLifetimeMsOverride = positiveNumber(pooledRunnerMaxLifetimeMs)
    this.pooledRunnerCount = this.pooledRunnerCountOverride || 4
    this.pooledRunnerConcurrency = this.pooledRunnerConcurrencyOverride || 1
    this.pooledRunnerMaxJobs = this.pooledRunnerMaxJobsOverride || 100
    this.pooledRunnerMaxRssBytes = this.pooledRunnerMaxRssBytesOverride || 512 * 1024 * 1024
    this.pooledRunnerMaxLifetimeMs = this.pooledRunnerMaxLifetimeMsOverride || 60 * 60 * 1000
    /**
     * Grace period between SIGTERM and SIGKILL when reaping process runners that
     * outlast a bounded shutdown drain.
     * @type {number}
     */
    this.forkedChildSigkillGraceMs = typeof forkedChildSigkillGraceMs === "number" && forkedChildSigkillGraceMs >= 0
      ? forkedChildSigkillGraceMs
      : FORKED_CHILD_SIGKILL_GRACE_MS
    /**
     * Constructor override for the forked and pooled wall-clock job timeout. When unset the
     * timeout is read from `configuration.getBackgroundJobsConfig().jobTimeoutMs`
     * at fork time (default: disabled).
     * @type {number | undefined}
     */
    this.jobTimeoutMsOverride = typeof jobTimeoutMs === "number" ? jobTimeoutMs : undefined
    this.shouldStop = false
    this.workerId = randomUUID()
    this.heartbeatIntervalMs = typeof heartbeatIntervalMs === "number" && heartbeatIntervalMs >= 1
      ? heartbeatIntervalMs
      : HEARTBEAT_INTERVAL_MS
    /**
     * Narrows the runtime value to the documented type.
     * @type {ReturnType<typeof setInterval> | undefined} */
    this._heartbeatTimer = undefined
    /**
     * In-flight job-result reports to the main. Reporting is decoupled from the
     * job/child slot (freeing the slot never waits on a report) and retried
     * durably, so a transient main/DB outage cannot leak slots or lose a
     * terminal report. Tracked so a graceful `stop()` can drain them.
     * @type {Set<Promise<void>>}
     */
    this.inflightReports = new Set()
    /**
     * Narrows the runtime value to the documented type.
     * @type {JsonSocket | undefined} */
    this.jsonSocket = undefined
    /**
     * Narrows the runtime value to the documented type.
     * @type {BackgroundJobsStatusReporter | undefined} */
    this.statusReporter = undefined
    /**
     * Up to `this.maxConcurrentInlineJobs` of these run in parallel. They
     * share the worker's process and DB connection pool, so concurrency is
     * about overlapping I/O waits — use forking for memory isolation across
     * long-running jobs and for using more cores.
     * @type {Set<Promise<void>>}
     */
    this.inflightInlineJobs = new Set()
    /**
     * In-flight process runner exit promises. Tracked so process-job handoff
     * stays bounded while running and so a graceful `stop()` can drain them.
     * @type {Set<Promise<void>>}
     */
    this.inflightProcessJobs = new Set()
    /**
     * Live process runner child processes, kept so a graceful `stop()` can
     * terminate any that outlast the shutdown drain instead of orphaning them
     * across a deploy (where they would keep running against deleted release
     * code and holding database connections).
     * @type {Set<import("node:child_process").ChildProcess>}
     */
    this.inflightProcessChildren = new Set()
    /** @type {Set<Promise<void>>} */
    this.inflightPooledJobs = new Set()
    /** @type {Set<import("node:child_process").ChildProcess>} */
    this.pooledChildren = new Set()
    /** @type {Map<import("node:child_process").ChildProcess, {createdAtMs: number, jobsRun: number, inflight: Map<string, {payload: import("./types.js").BackgroundJobPayload & {id: string}, resolve?: (value: void) => void, timeoutTimer?: ReturnType<typeof setTimeout> | null}>, lastDispatchSeq: number, retiring: boolean, settling?: boolean, timeoutSigkillTimer?: ReturnType<typeof setTimeout> | null}>} */
    this.pooledChildStates = new Map()
    // Monotonic dispatch counter for round-robin child selection: each dispatch stamps
    // the chosen child, and selection prefers the child dispatched least recently.
    this._pooledDispatchSeq = 0
  }

  /**
   * Runs start.
   * @returns {Promise<void>} - Resolves when connected.
   */
  async start() {
    this.configuration = await this.configurationPromise
    this.configuration.setCurrent()
    await this.configuration.initialize({type: "background-jobs-worker"})
    await this.configuration.connectBeacon({peerType: "background-jobs-worker"})

    // Constructor overrides win; otherwise pick up the configured caps.
    if (typeof this.maxConcurrentInlineJobsOverride !== "number") {
      const config = this.configuration.getBackgroundJobsConfig()

      this.maxConcurrentInlineJobs = config.maxConcurrentInlineJobs || this.maxConcurrentInlineJobs
    }
    if (typeof this.maxConcurrentForkedJobsOverride !== "number") {
      const config = this.configuration.getBackgroundJobsConfig()

      this.maxConcurrentForkedJobs = config.maxConcurrentForkedJobs || this.maxConcurrentForkedJobs
    }
    const poolConfig = this.configuration.getBackgroundJobsConfig()
    if (typeof this.pooledRunnerCountOverride !== "number") this.pooledRunnerCount = poolConfig.pooledRunnerCount
    if (typeof this.pooledRunnerConcurrencyOverride !== "number") this.pooledRunnerConcurrency = poolConfig.pooledRunnerConcurrency
    if (typeof this.pooledRunnerMaxJobsOverride !== "number") this.pooledRunnerMaxJobs = poolConfig.pooledRunnerMaxJobs
    if (typeof this.pooledRunnerMaxRssBytesOverride !== "number") this.pooledRunnerMaxRssBytes = poolConfig.pooledRunnerMaxRssBytes
    if (typeof this.pooledRunnerMaxLifetimeMsOverride !== "number") this.pooledRunnerMaxLifetimeMs = poolConfig.pooledRunnerMaxLifetimeMs

    this.statusReporter = new BackgroundJobsStatusReporter({
      configuration: this.configuration,
      host: this.host,
      port: this.port
    })
    await this._connect()
  }

  /**
   * Gracefully stops the worker: announces draining to the main process so
   * no new jobs are dispatched, waits for in-flight inline jobs and process
   * runners to finish (so their results can be reported), then closes the
   * socket and disconnects from the beacon.
   *
   * Process runners are child processes. When a `timeoutMs` is given (e.g. a
   * deploy draining the old release) any runner still alive after the drain
   * window is terminated (SIGTERM, then SIGKILL) rather than left to orphan
   * across the deploy. With no `timeoutMs` the drain waits for runners to
   * finish on their own.
   * @param {object} [args] - Options.
   * @param {number} [args.timeoutMs] - Max wait for in-flight jobs (per phase) in ms.
   * @returns {Promise<void>} - Resolves when stopped.
   */
  async stop({timeoutMs} = {}) {
    if (this.shouldStop) return
    this.shouldStop = true
    this._stopHeartbeat()

    // Announce drain so main stops dispatching but keeps the connection
    // open until we close it ourselves below.
    if (this.jsonSocket) {
      try {
        this.jsonSocket.send({type: "draining"})
      } catch {
        // Socket may already be closing; nothing to do.
      }
    }

    await this._drainInflight(this.inflightInlineJobs, timeoutMs)
    await this._drainInflight(this.inflightPooledJobs, timeoutMs)
    await this._drainInflight(this.inflightProcessJobs, timeoutMs)
    await this._terminateProcessChildren()
    // Give in-flight result reports (now decoupled from job slots) a bounded
    // chance to land before the socket closes.
    await this._drainInflight(this.inflightReports, timeoutMs)

    if (this.jsonSocket) this.jsonSocket.close()
    if (this.configuration) {
      try {
        await this.configuration.disconnectBeacon()
      } finally {
        if (this.closeDatabaseConnectionsOnStop) await this.configuration.closeDatabaseConnections()
      }
    }
  }

  /**
   * Waits for a set of in-flight job promises to settle, optionally bounded by
   * `timeoutMs`.
   * @param {Set<Promise<void>>} inflight - In-flight job promises.
   * @param {number} [timeoutMs] - Max wait in ms; unbounded when omitted.
   * @returns {Promise<void>} - Resolves when settled or the timeout elapses.
   */
  async _drainInflight(inflight, timeoutMs) {
    if (inflight.size === 0) return

    const drain = Promise.allSettled([...inflight])

    if (typeof timeoutMs === "number" && timeoutMs >= 0) {
      let timer
      const timeout = new Promise((resolve) => { timer = setTimeout(resolve, timeoutMs) })

      await Promise.race([drain, timeout])
      clearTimeout(timer)
    } else {
      await drain
    }
  }

  /**
   * Terminates any process runner children still alive after the drain window so
   * they don't outlive the worker as orphans. SIGTERM lets the runner close its
   * connections cleanly; survivors are SIGKILLed after a short grace.
   * @returns {Promise<void>} - Resolves once survivors have been signalled.
   */
  async _terminateProcessChildren() {
    if (this.inflightProcessChildren.size === 0) return

    for (const child of this.inflightProcessChildren) {
      try {
        child.kill("SIGTERM")
      } catch {
        // Child already exited; nothing to do.
      }
    }

    await new Promise((resolve) => setTimeout(resolve, this.forkedChildSigkillGraceMs))

    for (const child of this.inflightProcessChildren) {
      try {
        child.kill("SIGKILL")
      } catch {
        // Child already exited; nothing to do.
      }
    }
  }

  async _connect() {
    const configuration = this.configuration
    if (!configuration) throw new Error("Background jobs worker configuration not initialized")

    const config = configuration.getBackgroundJobsConfig()
    const host = this.host || config.host
    const port = typeof this.port === "number" ? this.port : config.port
    const socket = net.createConnection({host, port})
    socket.setKeepAlive(true, SOCKET_KEEPALIVE_MS)
    const jsonSocket = new JsonSocket(socket)
    this.jsonSocket = jsonSocket

    /**
     * Handles a background job socket message.
     * @param {import("./types.js").BackgroundJobSocketMessage} message - Socket message.
     */
    jsonSocket.on("message", async (message) => {
      if (message?.type === "job") {
        await this._handleJob(message.payload)
      }
    })

    jsonSocket.on("error", (error) => {
      console.error("Background jobs worker socket error:", error)
    })

    jsonSocket.on("close", () => {
      this._stopHeartbeat()
      if (this.shouldStop) return
      setTimeout(() => { void this._connect() }, 1000)
    })

    socket.on("connect", () => {
      jsonSocket.send({type: "hello", role: "worker", supportsHandoffIdReporting: true, supportsHeartbeat: true, supportsPooled: true, workerId: this.workerId})
      this._sendReadyIfRunning()
      this._startHeartbeat()
    })
  }

  /**
   * Sends periodic liveness heartbeats to the main so a wedged or silent worker
   * can be detected and dropped there (its leases released) instead of freezing
   * the queue until a human notices.
   * @returns {void}
   */
  _startHeartbeat() {
    this._stopHeartbeat()

    this._heartbeatTimer = setInterval(() => {
      if (this.shouldStop || !this.jsonSocket) return

      try {
        this.jsonSocket.send({type: "heartbeat", workerId: this.workerId})
      } catch {
        // Socket is closing/closed; the close handler drives reconnect.
      }
    }, this.heartbeatIntervalMs)

    if (typeof this._heartbeatTimer.unref === "function") this._heartbeatTimer.unref()
  }

  /**
   * Stops the liveness heartbeat timer.
   * @returns {void}
   */
  _stopHeartbeat() {
    if (this._heartbeatTimer) {
      clearInterval(this._heartbeatTimer)
      this._heartbeatTimer = undefined
    }
  }

  /**
   * Runs handle job.
   * @param {import("./types.js").BackgroundJobPayload} payload - Payload.
   * @returns {Promise<void>} - Resolves when done.
   */
  async _handleJob(payload) {
    if (!payload.id) throw new Error("Background job payload missing id")
    /**
     * Identified payload.
     * @type {import("./types.js").BackgroundJobPayload & {id: string}} */
    const identifiedPayload = /** @type {?} */ (payload)

    const executionMode = this._executionModeForPayload(identifiedPayload)

    if (executionMode === "pooled") {
      this._trackPooledJob(this._runPooledJob(identifiedPayload))
      return
    }

    if (executionMode !== "inline") {
      this._trackProcessJob(this._startProcessJob({executionMode, payload: identifiedPayload}))
      return
    }

    this._handleInlineJob(identifiedPayload)
  }

  /**
   * Runs start process job.
   * @param {object} args - Options.
   * @param {import("./types.js").BackgroundJobExecutionMode} args.executionMode - Execution mode.
   * @param {import("./types.js").BackgroundJobPayload & {id: string}} args.payload - Payload.
   * @returns {Promise<void>} - Resolves when the process job exits.
   */
  _startProcessJob({executionMode, payload}) {
    if (executionMode === "forked") return this._forkJob(payload)

    return this._spawnJob(payload)
  }

  /**
   * Runs handle inline job.
   * @param {import("./types.js").BackgroundJobPayload & {id: string}} payload - Payload.
   * @returns {void}
   */
  _handleInlineJob(payload) {
    // Inline jobs share the worker's process and DB pool, but each one
    // is its own async chain — there's no semantic reason to serialize
    // them. We kick off the job, register it with `inflightInlineJobs`
    // for shutdown drain, and signal capacity to main:
    // - If we still have a free slot we ask for the next job right
    //   away, so a slow job (e.g. a docker alive check that waits 15s
    //   on a gone server) no longer starves every other inline job.
    // - When the job finishes, if the worker had been at the cap, we
    //   ask for the next job to refill the slot.
    // The bookkeeping in `finally()` ratchets capacity back up
    // regardless of success or failure.
    /**
     * Defines inflight.
     * @type {Promise<void>} */
    let inflight

    inflight = this._runInlineJobAndReport(payload).finally(() => {
      this.inflightInlineJobs.delete(inflight)

      // Re-announce on every completion below cap, not just the cap→cap-1 edge —
      // see _trackProcessJob for why the knife-edge condition silently wedges.
      if (!this.shouldStop) this._sendReadyIfRunning()
    })

    this.inflightInlineJobs.add(inflight)

    if (this.inflightInlineJobs.size < this.maxConcurrentInlineJobs) {
      this._sendReadyIfRunning()
    }
  }

  /**
   * Runs execution mode for payload.
   * @param {import("./types.js").BackgroundJobPayload} payload - Payload.
   * @returns {import("./types.js").BackgroundJobExecutionMode} - Execution mode.
   */
  _executionModeForPayload(payload) {
    const executionMode = payload.options?.executionMode

    return executionMode ? this._normalizeExecutionMode(executionMode) : "pooled"
  }

  /**
   * Runs normalize execution mode.
   * @param {string} executionMode - Execution mode.
   * @returns {import("./types.js").BackgroundJobExecutionMode} - Normalized execution mode.
   */
  _normalizeExecutionMode(executionMode) {
    for (const mode of EXECUTION_MODES) {
      if (mode === executionMode) return mode
    }

    throw new Error(`Invalid background job executionMode: ${executionMode}`)
  }

  /**
   * Runs track process job.
   * @param {Promise<void>} processJob - Process job promise.
   * @returns {void}
   */
  _trackProcessJob(processJob) {
    /**
     * Defines inflight.
     * @type {Promise<void>} */
    let inflight

    inflight = processJob.finally(() => {
      this.inflightProcessJobs.delete(inflight)

      // Re-announce readiness on EVERY completion that leaves us below cap — not
      // just the single cap→cap-1 edge. The main removes a worker from its ready
      // set on each dispatch (`_drainOnce`) and only re-adds it on a fresh
      // "ready"; gating the re-announce on one knife-edge transition means a
      // single missed or lost signal leaves the worker out of the ready set and
      // wedges dispatch cluster-wide. This was the silent-freeze root cause.
      // `_sendReadyIfRunning` self-guards (it sends nothing when the worker is
      // genuinely at capacity), so re-announcing on every freed slot is safe and
      // idempotent on the main.
      if (!this.shouldStop) this._sendReadyIfRunning()
    })

    this.inflightProcessJobs.add(inflight)
    this._sendReadyIfRunning()
  }

  /**
   * Runs run inline job and report.
   * @param {import("./types.js").BackgroundJobPayload & {id: string}} payload - Payload with required id.
   * @returns {Promise<void>} - Resolves when complete (success or failure reported).
   */
  async _runInlineJobAndReport(payload) {
    // Report in the background so freeing this inline slot never waits on the
    // report. Reporting is durable (retried until it lands), so a transient
    // main/DB outage neither wedges the slot nor loses the terminal result.
    try {
      await this._runJobInline(payload)
      this._reportJobResultInBackground({
        jobId: payload.id,
        status: "completed",
        handoffId: payload.handoffId,
        handedOffAtMs: payload.handedOffAtMs,
        workerId: payload.workerId || this.workerId
      })
    } catch (error) {
      this._reportJobResultInBackground({
        jobId: payload.id,
        status: "failed",
        error,
        handoffId: payload.handoffId,
        handedOffAtMs: payload.handedOffAtMs,
        workerId: payload.workerId || this.workerId
      })
    }
  }

  /**
   * Tells main we're ready for the next job — but only if we haven't been
   * asked to drain. Once we've sent `draining` we don't want to take more
   * work.
   * @returns {void}
   */
  _sendReadyIfRunning() {
    if (this.shouldStop) return
    if (!this.jsonSocket) return

    const readyMessage = this._readyMessage()

    if (!readyMessage) return
    this.jsonSocket.send(readyMessage)
  }

  /**
   * Runs ready message.
   * @returns {import("./types.js").BackgroundJobSocketMessage | null} - Ready message or null when the worker has no capacity.
   */
  _readyMessage() {
    const acceptsProcessJob = this.inflightProcessJobs.size < this.maxConcurrentForkedJobs
    const acceptsInline = this.inflightInlineJobs.size < this.maxConcurrentInlineJobs
    const acceptsPooled = this._availablePooledSlots() > 0

    if (!acceptsProcessJob && !acceptsInline && !acceptsPooled) return null

    return {
      type: "ready",
      acceptsForked: acceptsProcessJob,
      acceptsInline,
      acceptsPooled,
      acceptsSpawned: acceptsProcessJob
    }
  }

  /**
   * Tracks a pooled job and re-advertises capacity.
   * @param {Promise<void>} pooledJob - Pooled job promise.
   * @returns {void}
   */
  _trackPooledJob(pooledJob) {
    /** @type {Promise<void>} */
    let inflight
    inflight = pooledJob.finally(() => {
      this.inflightPooledJobs.delete(inflight)
      if (!this.shouldStop) this._sendReadyIfRunning()
    })
    this.inflightPooledJobs.add(inflight)
    this._sendReadyIfRunning()
  }

  /**
   * Free pooled slots across the pool: open slots in non-retiring children plus
   * the slots we could add by spawning more children up to `pooledRunnerCount`.
   * Retiring children (draining before replacement) never contribute capacity.
   * @returns {number} - Number of pooled jobs the worker can accept right now.
   */
  _availablePooledSlots() {
    let openInExisting = 0
    let nonRetiringChildren = 0

    for (const child of this.pooledChildren) {
      const state = this.pooledChildStates.get(child)
      if (!state || state.retiring) continue
      nonRetiringChildren += 1
      openInExisting += this.pooledRunnerConcurrency - state.inflight.size
    }

    const spawnableChildren = Math.max(0, this.pooledRunnerCount - nonRetiringChildren)

    return openInExisting + spawnableChildren * this.pooledRunnerConcurrency
  }

  /**
   * Runs a payload on a pooled child with a free concurrency slot, spawning a
   * new child when every non-retiring child is full and the pool is below
   * `pooledRunnerCount`. Each child runs up to `pooledRunnerConcurrency` jobs at
   * once on its own event loop.
   * @param {import("./types.js").BackgroundJobPayload & {id: string}} payload - Job payload.
   * @returns {Promise<void>} - Resolves after the durable report.
   */
  _runPooledJob(payload) {
    const child = this._selectPooledChild() || this._createPooledChild()
    const state = this.pooledChildStates.get(child)
    if (!state) throw new Error("Pooled runner state missing")

    // Stamp the round-robin cursor so the next dispatch prefers a different child.
    state.lastDispatchSeq = ++this._pooledDispatchSeq

    return new Promise((resolve) => {
      const timeoutTimer = this._armPooledJobTimeout({child, jobId: payload.id})

      state.inflight.set(payload.id, {payload, resolve, timeoutTimer})
      try {
        child.send({type: "job", payload})
      } catch (error) {
        void this._handlePooledChildFailure({child, error})
      }
    })
  }

  /**
   * Selects a pooled child to run the next job, or undefined when every non-retiring
   * child is already full (the caller then lazily spawns one). Among children with a
   * free concurrency slot, picks the one dispatched least recently — a round-robin that
   * spreads jobs (notably multi-minute RunBuildJobs, each pinning a tenant connection
   * for its whole run) evenly across children instead of first-fit packing the earliest
   * one until it is full. A freshly spawned or replacement child therefore takes its
   * fair share one job at a time as its turn comes up, rather than absorbing a burst to
   * "catch up" to the others.
   * @returns {import("node:child_process").ChildProcess | undefined} - The chosen child, or undefined when all non-retiring children are full.
   */
  _selectPooledChild() {
    /** @type {import("node:child_process").ChildProcess | undefined} */
    let selected
    let selectedSeq = Infinity

    for (const child of this.pooledChildren) {
      const state = this.pooledChildStates.get(child)

      if (!state || state.retiring || state.inflight.size >= this.pooledRunnerConcurrency) continue

      if (state.lastDispatchSeq < selectedSeq) {
        selected = child
        selectedSeq = state.lastDispatchSeq
      }
    }

    return selected
  }

  /**
   * Arms a per-job wall-clock backstop for a pooled job. A pooled child hosts many
   * concurrent jobs, so a single genuinely-hung job would otherwise pin its
   * runner's concurrency slot forever — the lifetime recycle only retires a child
   * once its in-flight set drains, which a hung job never does. On overrun the
   * whole child is terminated so the hung job (and its siblings) requeue. Returns
   * the timer, or null when no timeout is configured.
   * @param {object} args - Options.
   * @param {import("node:child_process").ChildProcess} args.child - Pooled child.
   * @param {string} args.jobId - Job id whose overrun is guarded.
   * @returns {ReturnType<typeof setTimeout> | null} - The armed timer, or null.
   */
  _armPooledJobTimeout({child, jobId}) {
    const timeoutMs = this._resolveJobTimeoutMs()

    if (!(typeof timeoutMs === "number" && timeoutMs > 0)) return null

    return setTimeout(() => this._onPooledJobTimeout({child, jobId}), timeoutMs)
  }

  /**
   * Fired when a pooled job overruns its timeout. Terminates the child running it
   * (SIGTERM, then SIGKILL after the grace) — a hung JS job cannot be cancelled
   * any other way. The non-clean exit flows through `_handlePooledChildFailure`,
   * which reports every in-flight job on the child failed (so they requeue) and
   * drops it from tracking; capacity is refilled on the next dispatch.
   * @param {object} args - Options.
   * @param {import("node:child_process").ChildProcess} args.child - Pooled child.
   * @param {string} args.jobId - Job id that overran.
   * @returns {void}
   */
  _onPooledJobTimeout({child, jobId}) {
    const state = this.pooledChildStates.get(child)

    // Already settling/gone, or the job finished in the race with this timer.
    if (!state || state.settling || !state.inflight.has(jobId)) return

    try {
      child.kill("SIGTERM")
    } catch {
      // Child already exited; nothing to do.
    }

    state.timeoutSigkillTimer = setTimeout(() => {
      try {
        child.kill("SIGKILL")
      } catch {
        // Child already exited; nothing to do.
      }
    }, this.forkedChildSigkillGraceMs)
  }

  /**
   * Creates a reusable pooled child.
   * @returns {import("node:child_process").ChildProcess} - New pooled child.
   */
  _createPooledChild() {
    const configuration = this.configuration
    if (!configuration) throw new Error("Background jobs worker configuration not initialized")
    const config = configuration.getBackgroundJobsConfig()
    const child = fork(POOLED_RUNNER_ENTRY_PATH, [], {
      cwd: configuration.getDirectory(), execArgv: [], stdio: ["ignore", "ignore", "ignore", "ipc"],
      env: Object.assign({}, process.env, {VELOCIOUS_ENV: configuration.getEnvironment(), VELOCIOUS_BACKGROUND_JOBS_HOST: config.host, VELOCIOUS_BACKGROUND_JOBS_PORT: `${config.port}`})
    })
    this.pooledChildren.add(child)
    this.inflightProcessChildren.add(child)
    this.pooledChildStates.set(child, {createdAtMs: Date.now(), jobsRun: 0, inflight: new Map(), lastDispatchSeq: 0, retiring: false})
    child.on("message", (message) => this._handlePooledChildMessage({child, message}))
    child.once("exit", (code, signal) => this._handlePooledChildFailure({child, error: new Error(`Pooled background job runner exited: code=${code} signal=${signal || "none"}`)}))
    child.once("error", (error) => this._handlePooledChildFailure({child, error}))
    return child
  }

  /**
   * Handles a pooled child's per-job durable-report acknowledgement. A child
   * runs jobs concurrently and reports one `job-outcome` per job id.
   * @param {object} args - Message details.
   * @param {import("node:child_process").ChildProcess} args.child - Pooled child.
   * @param {?} args.message - IPC message.
   * @returns {void}
   */
  _handlePooledChildMessage({child, message}) {
    if (!message || typeof message !== "object") return
    const record = /** @type {{type?: ?, jobId?: ?, acknowledged?: ?, rssBytes?: ?, error?: ?}} */ (message)
    const state = this.pooledChildStates.get(child)
    if (record.type !== "job-outcome" || !state || state.settling || typeof record.jobId !== "string") return
    const entry = state.inflight.get(record.jobId)
    if (!entry) return

    if (entry.timeoutTimer) clearTimeout(entry.timeoutTimer)
    state.inflight.delete(record.jobId)
    state.jobsRun += 1
    const resolve = entry.resolve

    if (record.acknowledged === true) {
      if (resolve) resolve(undefined)
    } else {
      // The child stayed alive but could not confirm this one job's terminal
      // report; reclaim just this job — its concurrent siblings are unaffected.
      void this._reportJobResult({
        jobId: entry.payload.id,
        status: "failed",
        error: new Error(typeof record.error === "string" ? record.error : "Pooled runner terminal report was not acknowledged"),
        handoffId: entry.payload.handoffId,
        handedOffAtMs: entry.payload.handedOffAtMs,
        workerId: entry.payload.workerId || this.workerId
      }).finally(() => { if (resolve) resolve(undefined) })
    }

    const rssBytes = typeof record.rssBytes === "number" ? record.rssBytes : Number.POSITIVE_INFINITY
    const runnerAgeMs = Date.now() - state.createdAtMs
    if (!state.retiring && (state.jobsRun >= this.pooledRunnerMaxJobs || rssBytes >= this.pooledRunnerMaxRssBytes || runnerAgeMs >= this.pooledRunnerMaxLifetimeMs || this.shouldStop)) {
      this._beginRetirePooledChild(child)
    }
    this._terminateIfDrained(child)
  }

  /**
   * Marks a pooled child for retirement and eagerly spawns a single replacement
   * (1-for-1) so its capacity is restored immediately without waiting for it to
   * finish draining. The retiring child stops receiving new jobs and is
   * terminated only once its in-flight set drains, so a long-running job (e.g. a
   * build) is never cut off.
   * @param {import("node:child_process").ChildProcess} child - Child to retire.
   * @returns {void}
   */
  _beginRetirePooledChild(child) {
    const state = this.pooledChildStates.get(child)
    if (!state || state.retiring) return

    state.retiring = true
    // Best-effort pre-warm: skip when stopping (no new work) or before the
    // worker is initialized (no configuration to fork a child from).
    if (!this.shouldStop && this.configuration) this._createPooledChild()
  }

  /**
   * Terminates a retiring pooled child once it has no in-flight jobs left.
   * @param {import("node:child_process").ChildProcess} child - Child to check.
   * @returns {void}
   */
  _terminateIfDrained(child) {
    const state = this.pooledChildStates.get(child)
    if (!state || !state.retiring || state.inflight.size > 0) return

    this._retirePooledChild(child)
  }

  /**
   * Retires a drained pooled child (removes it from tracking, then SIGTERMs it).
   * @param {import("node:child_process").ChildProcess} child - Child process to retire.
   * @returns {void}
   */
  _retirePooledChild(child) {
    this.pooledChildren.delete(child)
    this.pooledChildStates.delete(child)
    this.inflightProcessChildren.delete(child)
    child.kill("SIGTERM")
  }

  /**
   * Removes an exited/unhealthy pooled child and reports every job that was
   * in-flight on it as failed — a process-level crash's blast radius is the
   * child's whole in-flight set. Capacity is refilled lazily on the next
   * dispatch (a spawnable slot is still advertised), avoiding a tight respawn
   * loop when a child crashes on startup.
   * @param {object} args - Failure details.
   * @param {import("node:child_process").ChildProcess} args.child - Pooled child.
   * @param {?} args.error - Failure.
   * @returns {Promise<void>}
   */
  async _handlePooledChildFailure({child, error}) {
    const state = this.pooledChildStates.get(child)
    if (state?.settling) return
    if (state) {
      state.settling = true
      // Cancel this child's pending timers before its in-flight set is reported —
      // the SIGKILL grace from a timeout kill, and every armed per-job backstop.
      if (state.timeoutSigkillTimer) clearTimeout(state.timeoutSigkillTimer)
      for (const inflightEntry of state.inflight.values()) {
        if (inflightEntry.timeoutTimer) clearTimeout(inflightEntry.timeoutTimer)
      }
    }
    this.pooledChildren.delete(child)
    this.inflightProcessChildren.delete(child)

    const entries = state ? [...state.inflight.values()] : []
    if (state) state.inflight.clear()
    this.pooledChildStates.delete(child)

    await Promise.allSettled(entries.map(async (entry) => {
      await this._reportJobResult({
        jobId: entry.payload.id,
        status: "failed",
        error,
        handoffId: entry.payload.handoffId,
        handedOffAtMs: entry.payload.handedOffAtMs,
        workerId: entry.payload.workerId || this.workerId
      })
      if (entry.resolve) entry.resolve(undefined)
    }))
  }

  /**
   * Runs run job inline.
   * @param {import("./types.js").BackgroundJobPayload} payload - Payload.
   * @returns {Promise<void>} - Resolves when done.
   */
  async _runJobInline(payload) {
    const configuration = this.configuration
    if (!configuration) throw new Error("Background jobs worker configuration not initialized")

    const registry = new BackgroundJobRegistry({configuration})
    await registry.load()
    const JobClass = registry.getJobByName(payload.jobName)
    const jobInstance = new JobClass()
    /**
     * Perform.
     * @type {(...args: Array<?>) => Promise<void>} */
    const perform = jobInstance.perform

    await configuration.withConnections({databaseIdentifiers: JobClass.databaseIdentifiers, name: `Background job worker inline: ${payload.jobName}`}, async () => {
      await perform.apply(jobInstance, payload.args || [])
    })
  }

  /**
   * Runs fork job.
   * @param {import("./types.js").BackgroundJobPayload & {id: string}} payload - Payload.
   * @returns {Promise<void>} - Resolves when the forked runner exits or fork fails.
   */
  _forkJob(payload) {
    const child = this._createForkedChild()

    this.inflightProcessChildren.add(child)

    const finished = this._waitForForkedChild({child, payload})

    this._sendForkedPayload({child, payload})

    return finished
  }

  /**
   * Runs create forked child.
   * @returns {import("node:child_process").ChildProcess} - Forked child process.
   */
  _createForkedChild() {
    const configuration = this.configuration
    if (!configuration) throw new Error("Background jobs worker configuration not initialized")

    const directory = configuration.getDirectory()
    const backgroundJobsConfig = configuration.getBackgroundJobsConfig()

    return fork(FORKED_RUNNER_ENTRY_PATH, [], {
      cwd: directory,
      execArgv: [],
      stdio: ["ignore", "ignore", "ignore", "ipc"],
      env: Object.assign({}, process.env, {
        VELOCIOUS_ENV: configuration.getEnvironment(),
        VELOCIOUS_BACKGROUND_JOBS_HOST: backgroundJobsConfig.host,
        VELOCIOUS_BACKGROUND_JOBS_PORT: `${backgroundJobsConfig.port}`
      })
    })
  }

  /**
   * Runs wait for forked child.
   * @param {object} args - Options.
   * @param {import("node:child_process").ChildProcess} args.child - Forked child process.
   * @param {import("./types.js").BackgroundJobPayload & {id: string}} args.payload - Payload.
   * @returns {Promise<void>} - Resolves when the child exits.
   */
  _waitForForkedChild({child, payload}) {
    const timeoutState = this._armForkedJobTimeout({child})

    return new Promise((resolve) => {
      child.once("exit", (code, signal) => {
        this._clearForkedJobTimeout(timeoutState)
        this._handleForkedChildExit({child, code, signal, payload, resolve, timeoutState})
      })
      child.once("error", (error) => {
        this._clearForkedJobTimeout(timeoutState)
        this._handleForkedChildError({child, error, payload, resolve})
      })
    })
  }

  /**
   * Arms a wall-clock backstop for a forked job runner. A forked job still
   * running after `jobTimeoutMs` is terminated (SIGTERM, then SIGKILL after the
   * grace) so a single genuinely-hung runner can't pin a draining worker — and
   * its full-app boot and database connections — indefinitely. Returns a state
   * object the exit/error handlers use to cancel the timer and to report a
   * timeout-specific failure. When no timeout is configured the timer is null
   * and behavior is unchanged.
   * @param {object} args - Options.
   * @param {import("node:child_process").ChildProcess} args.child - Forked child process.
   * @returns {ForkedJobTimeoutState} - Timeout state.
   */
  _armForkedJobTimeout({child}) {
    const timeoutMs = this._resolveJobTimeoutMs()
    /** @type {ForkedJobTimeoutState} */
    const state = {timedOut: false, timeoutMs, timer: null, sigkillTimer: null}

    if (!(typeof timeoutMs === "number" && timeoutMs > 0)) return state

    state.timer = setTimeout(() => this._onForkedJobTimeout({child, state}), timeoutMs)

    return state
  }

  /**
   * Resolves the effective wall-clock job timeout in ms (shared by forked and pooled jobs), or null when disabled. The
   * constructor override wins; otherwise the value comes from the background-jobs
   * configuration. A non-positive value disables the backstop.
   * @returns {number | null} - Timeout in ms, or null when disabled.
   */
  _resolveJobTimeoutMs() {
    const raw = typeof this.jobTimeoutMsOverride === "number"
      ? this.jobTimeoutMsOverride
      : (this.configuration ? this.configuration.getBackgroundJobsConfig().jobTimeoutMs : null)

    // A non-finite (e.g. Infinity) or non-positive value disables the backstop;
    // a finite value beyond Node's timer range is clamped to the max rather than
    // silently coerced to ~1ms (which would kill every forked job immediately).
    if (typeof raw !== "number" || !Number.isFinite(raw) || raw <= 0) return null

    return Math.min(raw, MAX_FORKED_JOB_TIMEOUT_MS)
  }

  /**
   * Fired when a forked runner overruns its timeout. Sends SIGTERM for a clean
   * shutdown, then SIGKILL after the grace for a runner that ignores it. The
   * resulting non-clean exit flows through `_handleForkedChildExit`, which frees
   * the slot and reports the job failed.
   * @param {object} args - Options.
   * @param {import("node:child_process").ChildProcess} args.child - Forked child process.
   * @param {ForkedJobTimeoutState} args.state - Timeout state.
   * @returns {void}
   */
  _onForkedJobTimeout({child, state}) {
    state.timedOut = true

    try {
      child.kill("SIGTERM")
    } catch {
      // Child already exited; nothing to do.
    }

    state.sigkillTimer = setTimeout(() => {
      try {
        child.kill("SIGKILL")
      } catch {
        // Child already exited; nothing to do.
      }
    }, this.forkedChildSigkillGraceMs)
  }

  /**
   * Cancels any pending timeout/SIGKILL timers for a forked runner that has
   * exited (or errored) so they never fire against a gone or reused child.
   * @param {ForkedJobTimeoutState} state - Timeout state.
   * @returns {void}
   */
  _clearForkedJobTimeout(state) {
    if (state.timer) {
      clearTimeout(state.timer)
      state.timer = null
    }

    if (state.sigkillTimer) {
      clearTimeout(state.sigkillTimer)
      state.sigkillTimer = null
    }
  }

  /**
   * Runs handle forked child exit.
   * @param {object} args - Options.
   * @param {import("node:child_process").ChildProcess} args.child - Forked child process.
   * @param {number | null} args.code - Exit code.
   * @param {keyof typeof import("node:os").constants.signals | null} args.signal - Exit signal.
   * @param {import("./types.js").BackgroundJobPayload & {id: string}} args.payload - Payload.
   * @param {(value: void) => void} args.resolve - Promise resolver.
   * @param {ForkedJobTimeoutState} [args.timeoutState] - Timeout state, when the runner had a wall-clock backstop.
   * @returns {void}
   */
  _handleForkedChildExit({child, code, signal, payload, resolve, timeoutState}) {
    this.inflightProcessChildren.delete(child)

    // Free the worker slot as soon as the child is gone — never gate it on the
    // failure report. A hung/slow report must not leak the slot; enough leaked
    // slots drive `acceptsForked` to false and silently wedge the worker.
    resolve(undefined)

    if (this._forkedChildExitedCleanly({code, signal})) return

    const error = timeoutState?.timedOut
      ? new Error(`Forked background job runner timed out after ${timeoutState.timeoutMs}ms and was terminated: code=${code} signal=${signal || "none"}`)
      : new Error(`Forked background job runner exited before reporting: code=${code} signal=${signal || "none"}`)

    this._reportForkedChildFailure({payload, error})
  }

  /**
   * Runs forked child exited cleanly.
   * @param {object} args - Options.
   * @param {number | null} args.code - Exit code.
   * @param {keyof typeof import("node:os").constants.signals | null} args.signal - Exit signal.
   * @returns {boolean} - Whether the child exited cleanly.
   */
  _forkedChildExitedCleanly({code, signal}) {
    return code === 0 && !signal
  }

  /**
   * Runs handle forked child error.
   * @param {object} args - Options.
   * @param {import("node:child_process").ChildProcess} args.child - Forked child process.
   * @param {Error} args.error - Child process error.
   * @param {import("./types.js").BackgroundJobPayload & {id: string}} args.payload - Payload.
   * @param {(value: void) => void} args.resolve - Promise resolver.
   * @returns {void}
   */
  _handleForkedChildError({child, error, payload, resolve}) {
    this.inflightProcessChildren.delete(child)
    // Free the slot first (see _handleForkedChildExit) — reporting is best-effort.
    resolve(undefined)
    console.error("Background jobs forked runner error:", error)
    this._reportForkedChildFailure({payload, error})
  }

  /**
   * Runs send forked payload.
   * @param {object} args - Options.
   * @param {import("node:child_process").ChildProcess} args.child - Forked child process.
   * @param {import("./types.js").BackgroundJobPayload & {id: string}} args.payload - Payload.
   * @returns {void}
   */
  _sendForkedPayload({child, payload}) {
    try {
      child.send({type: "job", payload})
    } catch (error) {
      child.kill("SIGTERM")
      this._reportForkedChildFailure({payload, error})
    }
  }

  /**
   * Runs report forked child failure.
   * @param {object} args - Options.
   * @param {import("./types.js").BackgroundJobPayload & {id: string}} args.payload - Payload.
   * @param {?} args.error - Error.
   * @returns {void}
   */
  _reportForkedChildFailure({payload, error}) {
    this._reportJobResultInBackground({
      jobId: payload.id,
      status: "failed",
      error,
      handoffId: payload.handoffId,
      handedOffAtMs: payload.handedOffAtMs,
      workerId: payload.workerId || this.workerId
    })
  }

  /**
   * Runs spawn job.
   * @param {import("./types.js").BackgroundJobPayload} payload - Payload.
   * @returns {Promise<void>} - Resolves when the spawned runner exits or spawn fails.
   */
  _spawnJob(payload) {
    const configuration = this.configuration
    if (!configuration) throw new Error("Background jobs worker configuration not initialized")

    const directory = configuration.getDirectory()
    const argvCommand = process.argv[1]
    const command = argvCommand ? argvCommand : `${directory}/bin/velocious.js`
    const encodedPayload = Buffer.from(JSON.stringify(payload)).toString("base64")
    const backgroundJobsConfig = configuration.getBackgroundJobsConfig()
    const child = spawn(process.execPath, [command, "background-jobs-runner"], {
      cwd: directory,
      detached: true,
      stdio: "ignore",
      env: Object.assign({}, process.env, {
        VELOCIOUS_ENV: configuration.getEnvironment(),
        VELOCIOUS_BACKGROUND_JOBS_HOST: backgroundJobsConfig.host,
        VELOCIOUS_BACKGROUND_JOBS_PORT: `${backgroundJobsConfig.port}`,
        VELOCIOUS_JOB_PAYLOAD: encodedPayload
      })
    })

    this.inflightProcessChildren.add(child)

    const finished = new Promise((resolve) => {
      child.once("exit", () => {
        this.inflightProcessChildren.delete(child)
        resolve(undefined)
      })
      child.once("error", (error) => {
        this.inflightProcessChildren.delete(child)
        console.error("Background jobs spawned runner error:", error)
        resolve(undefined)
      })
    })

    child.unref()

    return finished
  }

  /**
   * Runs report job result.
   * @param {object} args - Options.
   * @param {string} args.jobId - Job id.
   * @param {"completed" | "failed"} args.status - Status.
   * @param {?} [args.error] - Error.
   * @param {string} [args.handoffId] - Handoff lease id.
   * @param {number} [args.handedOffAtMs] - Handed off timestamp.
   * @param {string} [args.workerId] - Worker id.
   * @returns {Promise<void>} - Resolves when reported.
   */
  async _reportJobResult({jobId, status, error, handoffId, handedOffAtMs, workerId}) {
    if (!this.statusReporter) return

    try {
      // Retry a transient persist failure (`job-update-error`): the worker is
      // long-lived and cannot exit to trigger orphan reclaim, so dropping the
      // completion here would strand the job in `handed_off` forever — fatal for a
      // `max_concurrency: 1` job (a stranded row blocks every future run).
      await this.statusReporter.reportWithRetry({jobId, status, error, handoffId, handedOffAtMs, workerId, retryPersistErrors: true})
    } catch (reportError) {
      console.error("Background job status reporting failed:", reportError)
    }
  }

  /**
   * Fires a durable job-result report without blocking the caller (so freeing a
   * job/child slot never waits on the report). The report is tracked so a
   * graceful `stop()` can drain in-flight reports before closing the socket.
   * @param {object} args - Options.
   * @param {string} args.jobId - Job id.
   * @param {"completed" | "failed"} args.status - Status.
   * @param {?} [args.error] - Error.
   * @param {string} [args.handoffId] - Handoff lease id.
   * @param {number} [args.handedOffAtMs] - Handed off timestamp.
   * @param {string} [args.workerId] - Worker id.
   * @returns {void}
   */
  _reportJobResultInBackground({jobId, status, error, handoffId, handedOffAtMs, workerId}) {
    /**
     * Defines report.
     * @type {Promise<void>} */
    let report

    report = this._reportJobResult({jobId, status, error, handoffId, handedOffAtMs, workerId}).finally(() => {
      this.inflightReports.delete(report)
    })

    this.inflightReports.add(report)
  }
}
