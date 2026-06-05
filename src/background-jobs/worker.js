// @ts-check

import net from "net"
import {spawn} from "node:child_process"
import JsonSocket from "./json-socket.js"
import BackgroundJobRegistry from "./job-registry.js"
import configurationResolver from "../configuration-resolver.js"
import BackgroundJobsStatusReporter from "./status-reporter.js"
import {randomUUID} from "crypto"

/** Grace period after SIGTERM before a lingering forked runner is SIGKILLed. */
const FORKED_CHILD_SIGKILL_GRACE_MS = 5000

export default class BackgroundJobsWorker {
  /**
   * @param {object} [args] - Options.
   * @param {import("../configuration.js").default} [args.configuration] - Configuration.
   * @param {string} [args.host] - Hostname.
   * @param {number} [args.port] - Port.
   * @param {number} [args.maxConcurrentForkedJobs] - Override the forked runner concurrency cap from `configuration.getBackgroundJobsConfig()`.
   * @param {number} [args.maxConcurrentInlineJobs] - Override the inline-job concurrency cap from `configuration.getBackgroundJobsConfig()`.
   * @param {number} [args.forkedChildSigkillGraceMs] - Override the grace period between SIGTERM and SIGKILL when reaping lingering forked runners on stop.
   */
  constructor({configuration, host, port, maxConcurrentForkedJobs, maxConcurrentInlineJobs, forkedChildSigkillGraceMs} = {}) {
    /** @type {Promise<import("../configuration.js").default>} */
    this.configurationPromise = configuration ? Promise.resolve(configuration) : configurationResolver()
    /** @type {import("../configuration.js").default | undefined} */
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
    /** @type {number | undefined} */
    this.maxConcurrentForkedJobsOverride = typeof maxConcurrentForkedJobs === "number" && maxConcurrentForkedJobs >= 1
      ? maxConcurrentForkedJobs
      : undefined
    /**
     * Resolved cap for inline-job concurrency. Set in `start()`; defaults to
     * 4 if no configuration value is available.
     * @type {number}
     */
    this.maxConcurrentInlineJobs = this.maxConcurrentInlineJobsOverride || 4
    /** @type {number} */
    this.maxConcurrentForkedJobs = this.maxConcurrentForkedJobsOverride || 4
    /**
     * Grace period between SIGTERM and SIGKILL when reaping forked runners that
     * outlast a bounded shutdown drain.
     * @type {number}
     */
    this.forkedChildSigkillGraceMs = typeof forkedChildSigkillGraceMs === "number" && forkedChildSigkillGraceMs >= 0
      ? forkedChildSigkillGraceMs
      : FORKED_CHILD_SIGKILL_GRACE_MS
    this.shouldStop = false
    this.workerId = randomUUID()
    /** @type {JsonSocket | undefined} */
    this.jsonSocket = undefined
    /** @type {BackgroundJobsStatusReporter | undefined} */
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
     * In-flight detached runner exit promises. Tracked so forked-job handoff
     * stays bounded while running and so a graceful `stop()` can drain them.
     * @type {Set<Promise<void>>}
     */
    this.inflightForkedJobs = new Set()
    /**
     * Live forked runner child processes, kept so a graceful `stop()` can
     * terminate any that outlast the shutdown drain instead of orphaning them
     * across a deploy (where they would keep running against deleted release
     * code and holding database connections).
     * @type {Set<import("node:child_process").ChildProcess>}
     */
    this.inflightForkedChildren = new Set()
  }

  /**
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
   * no new jobs are dispatched, waits for in-flight inline jobs and forked
   * runners to finish (so their results can be reported), then closes the
   * socket and disconnects from the beacon.
   *
   * Forked runners are detached child processes. When a `timeoutMs` is given
   * (e.g. a deploy draining the old release) any runner still alive after the
   * drain window is terminated (SIGTERM, then SIGKILL) rather than left to
   * orphan across the deploy — otherwise it would keep running against deleted
   * release code and holding database connections. With no `timeoutMs` the
   * drain waits for runners to finish on their own.
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
    await this._drainInflight(this.inflightForkedJobs, timeoutMs)
    await this._terminateForkedChildren()

    if (this.jsonSocket) this.jsonSocket.close()
    if (this.configuration) await this.configuration.disconnectBeacon()
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
   * Terminates any forked runner children still alive after the drain window so
   * they don't outlive the worker as orphans. SIGTERM lets the runner close its
   * connections cleanly; survivors are SIGKILLed after a short grace.
   * @returns {Promise<void>} - Resolves once survivors have been signalled.
   */
  async _terminateForkedChildren() {
    if (this.inflightForkedChildren.size === 0) return

    for (const child of this.inflightForkedChildren) {
      try {
        child.kill("SIGTERM")
      } catch {
        // Child already exited; nothing to do.
      }
    }

    await new Promise((resolve) => setTimeout(resolve, this.forkedChildSigkillGraceMs))

    for (const child of this.inflightForkedChildren) {
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

    /** @param {import("./types.js").BackgroundJobSocketMessage} message - Socket message. */
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
   * @param {import("./types.js").BackgroundJobPayload} payload - Payload.
   * @returns {Promise<void>} - Resolves when done.
   */
  async _handleJob(payload) {
    if (!payload.id) throw new Error("Background job payload missing id")
    /** @type {import("./types.js").BackgroundJobPayload & {id: string}} */
    const identifiedPayload = /** @type {any} */ (payload)

    const options = identifiedPayload.options || {}
    const shouldFork = options.forked !== false

    if (shouldFork) {
      /** @type {Promise<void>} */
      let inflight

      inflight = this._spawnDetachedJob(identifiedPayload).finally(() => {
        this.inflightForkedJobs.delete(inflight)

        if (!this.shouldStop && this.inflightForkedJobs.size === this.maxConcurrentForkedJobs - 1) {
          this._sendReadyIfRunning()
        }
      })

      this.inflightForkedJobs.add(inflight)
      this._sendReadyIfRunning()
      return
    }

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
    /** @type {Promise<void>} */
    let inflight

    inflight = this._runInlineJobAndReport(identifiedPayload).finally(() => {
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

    const acceptsForked = this.inflightForkedJobs.size < this.maxConcurrentForkedJobs
    const acceptsInline = this.inflightInlineJobs.size < this.maxConcurrentInlineJobs

    if (!acceptsForked && !acceptsInline) return

    this.jsonSocket.send({
      type: "ready",
      acceptsForked,
      acceptsInline
    })
  }

  /**
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
    /** @type {(...args: any[]) => Promise<void>} */
    const perform = jobInstance.perform

    await configuration.withConnections({name: `Background job worker inline: ${payload.jobName}`}, async () => {
      await perform.apply(jobInstance, payload.args || [])
    })
  }

  /**
   * @param {import("./types.js").BackgroundJobPayload} payload - Payload.
   * @returns {Promise<void>} - Resolves when the detached runner exits or spawn fails.
   */
  _spawnDetachedJob(payload) {
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

    this.inflightForkedChildren.add(child)

    const finished = new Promise((resolve) => {
      child.once("exit", () => {
        this.inflightForkedChildren.delete(child)
        resolve(undefined)
      })
      child.once("error", (error) => {
        this.inflightForkedChildren.delete(child)
        console.error("Background jobs forked runner spawn error:", error)
        resolve(undefined)
      })
    })

    child.unref()

    return finished
  }

  /**
   * @param {object} args - Options.
   * @param {string} args.jobId - Job id.
   * @param {"completed" | "failed"} args.status - Status.
   * @param {unknown} [args.error] - Error.
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
