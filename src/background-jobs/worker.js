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
const FORKED_RUNNER_ENTRY_PATH = fileURLToPath(new URL("./forked-runner-child.js", import.meta.url))
/**
 * Execution modes.
 * @type {import("./types.js").BackgroundJobExecutionMode[]} */
const EXECUTION_MODES = ["inline", "forked", "spawned"]

export default class BackgroundJobsWorker {
  /**
 * Runs constructor.
   * @param {object} [args] - Options.
   * @param {import("../configuration.js").default} [args.configuration] - Configuration.
   * @param {string} [args.host] - Hostname.
   * @param {number} [args.port] - Port.
   * @param {number} [args.maxConcurrentForkedJobs] - Override the process runner concurrency cap from `configuration.getBackgroundJobsConfig()`.
   * @param {number} [args.maxConcurrentInlineJobs] - Override the inline-job concurrency cap from `configuration.getBackgroundJobsConfig()`.
   * @param {number} [args.forkedChildSigkillGraceMs] - Override the grace period between SIGTERM and SIGKILL when reaping lingering process runners on stop.
   */
  constructor({configuration, host, port, maxConcurrentForkedJobs, maxConcurrentInlineJobs, forkedChildSigkillGraceMs} = {}) {
    /**
 * Documents this API.
 * @type {Promise<import("../configuration.js").default>} */
    this.configurationPromise = configuration ? Promise.resolve(configuration) : configurationResolver()
    /**
 * Documents this API.
 * @type {import("../configuration.js").default | undefined} */
    this.configuration = undefined
    this.host = host
    this.port = port
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
 * Documents this API.
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
 * Documents this API.
 * @type {number} */
    this.maxConcurrentForkedJobs = this.maxConcurrentForkedJobsOverride || 4
    /**
     * Grace period between SIGTERM and SIGKILL when reaping process runners that
     * outlast a bounded shutdown drain.
     * @type {number}
     */
    this.forkedChildSigkillGraceMs = typeof forkedChildSigkillGraceMs === "number" && forkedChildSigkillGraceMs >= 0
      ? forkedChildSigkillGraceMs
      : FORKED_CHILD_SIGKILL_GRACE_MS
    this.shouldStop = false
    this.workerId = randomUUID()
    /**
 * Documents this API.
 * @type {JsonSocket | undefined} */
    this.jsonSocket = undefined
    /**
 * Documents this API.
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
    await this._drainInflight(this.inflightProcessJobs, timeoutMs)
    await this._terminateProcessChildren()

    if (this.jsonSocket) this.jsonSocket.close()
    if (this.configuration) {
      try {
        await this.configuration.disconnectBeacon()
      } finally {
        await this.configuration.closeDatabaseConnections()
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
    const jsonSocket = new JsonSocket(socket)
    this.jsonSocket = jsonSocket

    /**
 * Documents this API.
 * @param {import("./types.js").BackgroundJobSocketMessage} message - Socket message. */
    jsonSocket.on("message", async (message) => {
      if (message?.type === "job") {
        await this._handleJob(message.payload)
      }
    })

    jsonSocket.on("error", (error) => {
      console.error("Background jobs worker socket error:", error)
    })

    jsonSocket.on("close", () => {
      if (this.shouldStop) return
      setTimeout(() => { void this._connect() }, 1000)
    })

    socket.on("connect", () => {
      jsonSocket.send({type: "hello", role: "worker", workerId: this.workerId})
      this._sendReadyIfRunning()
    })
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
    const identifiedPayload = /**
 * Documents this API.
 * @type {?} */ (payload)

    const executionMode = this._executionModeForPayload(identifiedPayload)

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
 * Documents this API.
 * @type {Promise<void>} */
    let inflight

    inflight = this._runInlineJobAndReport(payload).finally(() => {
      this.inflightInlineJobs.delete(inflight)

      if (!this.shouldStop && this.inflightInlineJobs.size === this.maxConcurrentInlineJobs - 1) {
        this._sendReadyIfRunning()
      }
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
    const options = payload.options || {}
    const executionMode = options.executionMode

    if (executionMode) return this._normalizeExecutionMode(executionMode)

    return options.forked === false ? "inline" : "forked"
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
 * Documents this API.
 * @type {Promise<void>} */
    let inflight

    inflight = processJob.finally(() => {
      this.inflightProcessJobs.delete(inflight)

      if (!this.shouldStop && this.inflightProcessJobs.size === this.maxConcurrentForkedJobs - 1) {
        this._sendReadyIfRunning()
      }
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
    try {
      await this._runJobInline(payload)
      await this._reportJobResult({
        jobId: payload.id,
        status: "completed",
        handedOffAtMs: payload.handedOffAtMs,
        workerId: payload.workerId || this.workerId
      })
    } catch (error) {
      await this._reportJobResult({
        jobId: payload.id,
        status: "failed",
        error,
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

    if (!acceptsProcessJob && !acceptsInline) return null

    return {
      type: "ready",
      acceptsForked: acceptsProcessJob,
      acceptsInline,
      acceptsSpawned: acceptsProcessJob
    }
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

    await configuration.withConnections({name: `Background job worker inline: ${payload.jobName}`}, async () => {
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
    return new Promise((resolve) => {
      child.once("exit", (code, signal) => {
        void this._handleForkedChildExit({child, code, signal, payload, resolve})
      })
      child.once("error", (error) => {
        void this._handleForkedChildError({child, error, payload, resolve})
      })
    })
  }

  /**
 * Runs handle forked child exit.
   * @param {object} args - Options.
   * @param {import("node:child_process").ChildProcess} args.child - Forked child process.
   * @param {number | null} args.code - Exit code.
   * @param {NodeJS.Signals | null} args.signal - Exit signal.
   * @param {import("./types.js").BackgroundJobPayload & {id: string}} args.payload - Payload.
   * @param {(value: void) => void} args.resolve - Promise resolver.
   * @returns {Promise<void>} - Resolves after failure is reported.
   */
  async _handleForkedChildExit({child, code, signal, payload, resolve}) {
    this.inflightProcessChildren.delete(child)

    if (this._forkedChildExitedCleanly({code, signal})) {
      resolve(undefined)
      return
    }

    await this._reportForkedChildFailure({
      payload,
      error: new Error(`Forked background job runner exited before reporting: code=${code} signal=${signal || "none"}`)
    })

    resolve(undefined)
  }

  /**
 * Runs forked child exited cleanly.
   * @param {object} args - Options.
   * @param {number | null} args.code - Exit code.
   * @param {NodeJS.Signals | null} args.signal - Exit signal.
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
   * @returns {Promise<void>} - Resolves after failure is reported.
   */
  async _handleForkedChildError({child, error, payload, resolve}) {
    this.inflightProcessChildren.delete(child)
    console.error("Background jobs forked runner error:", error)
    await this._reportForkedChildFailure({payload, error})
    resolve(undefined)
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
      void this._reportForkedChildFailure({payload, error})
    }
  }

  /**
 * Runs report forked child failure.
   * @param {object} args - Options.
   * @param {import("./types.js").BackgroundJobPayload & {id: string}} args.payload - Payload.
   * @param {?} args.error - Error.
   * @returns {Promise<void>} - Resolves after failure is reported.
   */
  async _reportForkedChildFailure({payload, error}) {
    await this._reportJobResult({
      jobId: payload.id,
      status: "failed",
      error,
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
   * @param {number} [args.handedOffAtMs] - Handed off timestamp.
   * @param {string} [args.workerId] - Worker id.
   * @returns {Promise<void>} - Resolves when reported.
   */
  async _reportJobResult({jobId, status, error, handedOffAtMs, workerId}) {
    if (!this.statusReporter) return

    try {
      await this.statusReporter.reportWithRetry({jobId, status, error, handedOffAtMs, workerId})
    } catch (reportError) {
      console.error("Background job status reporting failed:", reportError)
    }
  }
}
