// @ts-check

import BackgroundJobRescheduleSignal from "./reschedule-signal.js"
import performBackgroundJob from "./perform-job.js"

const MAX_TIMER_MS = 2_147_483_647
const ERROR_RECOVERY_DELAY_MS = 1_000

/** Configuration-owned, event-driven in-process local dispatcher. */
export default class LocalBackgroundJobsDispatcher {
  /**
   * Creates a dispatcher owned by one configuration and local store.
   * @param {object} args - Dispatcher options.
   * @param {import("../configuration.js").default} args.configuration - Owning configuration.
   * @param {import("./types.js").LocalBackgroundJobsClock} args.clock - Dispatcher clock.
   * @param {import("./local-job-registry.js").default} args.registry - Static job registry.
   * @param {import("./local-store.js").default} args.store - Durable local store.
   */
  constructor({configuration, clock, registry, store}) {
    this.clock = clock
    this.configuration = configuration
    this.registry = registry
    this.store = store
    this._accepting = false
    this._started = false
    /** @type {Promise<void> | null} */
    this._startPromise = null
    /** @type {Promise<void> | null} */
    this._drainPromise = null
    this._redrain = false
    this._wakeQueued = false
    /** @type {Set<Promise<void>>} */
    this._inFlight = new Set()
    /** @type {Set<() => void>} */
    this._idleWaiters = new Set()
    /** @type {ReturnType<typeof setTimeout> | number | undefined} */
    this._scheduledTimer = undefined
    /** @type {ReturnType<typeof setTimeout> | number | undefined} */
    this._recoveryTimer = undefined
  }

  /**
   * Starts, recovers, and catches up the local dispatcher.
   * @returns {Promise<void>} - Resolves after admission starts.
   */
  async start() {
    if (this._started) return
    if (this._startPromise) return await this._startPromise

    this._startPromise = (async () => {
      this.configuration.setCurrent()
      this.registry.ensureReady()
      await this.configuration.initialize({type: "local-background-jobs"})
      await this.store.ensureReady()
      await this.store.reconcileQueueConcurrency()

      const recoveredJobs = await this.store.recoverHandedOffJobs()

      for (const job of recoveredJobs) {
        this._emitBackgroundJobFailed({
          error: new Error(job.lastError || "Local background job recovered after an interrupted dispatcher"),
          job
        })
      }

      this._accepting = true
      this._started = true
      this.wake()
    })()

    try {
      await this._startPromise
    } catch (error) {
      this._reportFrameworkError({error, stage: "local-background-jobs-start"})
      throw error
    } finally {
      this._startPromise = null
    }
  }

  /**
   * Coalesces a dispatcher wake onto one tracked microtask.
   * @returns {void} - No return value.
   */
  wake() {
    if (!this._accepting) return

    if (this._drainPromise || this._wakeQueued) {
      this._redrain = true
      return
    }

    this._wakeQueued = true
    const drain = Promise.resolve().then(async () => {
      this._wakeQueued = false
      await this._drain()
    })
    const drainPromise = drain
      .catch((error) => {
        this._reportFrameworkError({error, stage: "local-background-jobs-drain"})
        this._armRecoveryTimer()
      })
      .finally(() => {
        if (this._drainPromise === drainPromise) this._drainPromise = null

        if (this._redrain && this._accepting) {
          this._redrain = false
          this.wake()
        } else {
          this._resolveIdleWaiters()
        }
      })

    this._drainPromise = drainPromise
  }

  /**
   * Fills local capacity with short durable claims.
   * @returns {Promise<void>} - Resolves after one stable drain pass.
   */
  async _drain() {
    while (this._accepting && this._inFlight.size < this._maxConcurrentJobs()) {
      const job = await this.store.nextAvailableJob()

      if (!job) break

      const handoff = await this.store.markHandedOff({jobId: job.id})

      if (!handoff) {
        this._redrain = true
        break
      }

      this._startPerformance({handoff, job})
    }

    await this._armScheduledTimer()
  }

  /**
   * Runs one claimed performance without retaining its claim transaction connection.
   * @param {{handoff: import("./types.js").BackgroundJobHandoff, job: import("./types.js").BackgroundJobRow}} args - Claimed job.
   * @returns {void} - No return value.
   */
  _startPerformance({handoff, job}) {
    const performance = this._perform({handoff, job})

    this._inFlight.add(performance)
    void performance
      .catch((error) => this._reportFrameworkError({error, stage: "local-background-jobs-acknowledgement"}))
      .finally(() => {
        this._inFlight.delete(performance)
        if (this._accepting) this.wake()
        this._resolveIdleWaiters()
      })
  }

  /**
   * Performs and acknowledges one durable handoff.
   * @param {{handoff: import("./types.js").BackgroundJobHandoff, job: import("./types.js").BackgroundJobRow}} args - Claimed job.
   * @returns {Promise<void>} - Resolves after acknowledgement.
   */
  async _perform({handoff, job}) {
    try {
      const JobClass = this.registry.resolve(job.jobName)

      await performBackgroundJob({
        configuration: this.configuration,
        JobClass,
        jobArgs: job.args,
        name: `Local background job: ${job.jobName}`
      })
    } catch (error) {
      if (error instanceof BackgroundJobRescheduleSignal) {
        await this.store.markRescheduled({delayMs: error.delayMs, handoffId: handoff.handoffId, jobId: job.id})
        return
      }

      const updatedJob = await this.store.markFailed({error, handoffId: handoff.handoffId, jobId: job.id})

      if (updatedJob) this._emitBackgroundJobFailed({error, job: updatedJob})
      return
    }

    await this.store.markCompleted({handoffId: handoff.handoffId, jobId: job.id})
  }

  /**
   * Arms the exact next future job timer, chunking platform-sized delays.
   * @returns {Promise<void>} - Resolves after timer reconciliation.
   */
  async _armScheduledTimer() {
    if (this._scheduledTimer !== undefined) {
      this.clock.clearTimeout(this._scheduledTimer)
      this._scheduledTimer = undefined
    }
    if (!this._accepting) return

    const nextJob = await this.store.nextScheduledJob()

    if (!nextJob || nextJob.scheduledAtMs === null) return

    const delayMs = Math.max(0, Math.min(nextJob.scheduledAtMs - this.clock.now(), MAX_TIMER_MS))

    this._scheduledTimer = this.clock.setTimeout(() => {
      this._scheduledTimer = undefined
      this.wake()
    }, delayMs)
  }

  /**
   * Arms one bounded retry after an unexpected drain failure.
   * @returns {void} - No return value.
   */
  _armRecoveryTimer() {
    if (!this._accepting || this._recoveryTimer !== undefined) return

    this._recoveryTimer = this.clock.setTimeout(() => {
      this._recoveryTimer = undefined
      this.wake()
    }, ERROR_RECOVERY_DELAY_MS)
  }

  /**
   * Waits for admission and every in-flight acknowledgement without polling.
   * @returns {Promise<void>} - Resolves when idle.
   */
  async waitForIdle() {
    if (this._isIdle()) return

    await new Promise((resolve) => this._idleWaiters.add(() => resolve(undefined)))
  }

  /**
   * Stops claims and waits for in-flight acknowledgement.
   * @returns {Promise<void>} - Resolves after a graceful stop.
   */
  async stop() {
    this._accepting = false
    this._redrain = false

    if (this._scheduledTimer !== undefined) {
      this.clock.clearTimeout(this._scheduledTimer)
      this._scheduledTimer = undefined
    }
    if (this._recoveryTimer !== undefined) {
      this.clock.clearTimeout(this._recoveryTimer)
      this._recoveryTimer = undefined
    }

    if (this._drainPromise) await this._drainPromise
    if (this._inFlight.size > 0) await Promise.all([...this._inFlight])

    this._wakeQueued = false
    this._started = false
    this._resolveIdleWaiters()
  }

  /**
   * Reports whether dispatcher admission has started.
   * @returns {boolean} - Whether dispatcher admission has started.
   */
  isReady() { return this._started && this._accepting }

  /**
   * Reads the configuration-owned in-process performance cap.
   * @returns {number} - Configuration-owned in-process performance cap.
   */
  _maxConcurrentJobs() { return this.configuration.getBackgroundJobsConfig().maxConcurrentInlineJobs }

  /**
   * Reports whether no admission or acknowledgement work remains.
   * @returns {boolean} - Whether the dispatcher is idle.
   */
  _isIdle() { return !this._wakeQueued && !this._drainPromise && this._inFlight.size === 0 }

  /**
   * Resolves event-based idle waiters at a stable idle boundary.
   * @returns {void} - No return value.
   */
  _resolveIdleWaiters() {
    if (!this._isIdle()) return

    const waiters = [...this._idleWaiters]

    this._idleWaiters.clear()
    for (const resolve of waiters) resolve()
  }

  /**
   * Emits an expected job failure through the standard job/all-error channels.
   * @param {{error: ReturnType<typeof JSON.parse>, job: import("./types.js").BackgroundJobRow}} args - Failure transition.
   * @returns {void} - No return value.
   */
  _emitBackgroundJobFailed({error, job}) {
    const normalizedError = error instanceof Error ? error : new Error(String(error))
    const payload = {
      context: {
        attempts: job.attempts,
        jobArgs: job.args,
        jobId: job.id,
        jobName: job.jobName,
        maxRetries: job.maxRetries,
        stage: "background-job-failed",
        status: job.status,
        terminal: job.status === "failed",
        willRetry: job.status === "queued",
        workerId: "local"
      },
      error: normalizedError
    }
    const errorEvents = this.configuration.getErrorEvents()

    errorEvents.emit("background-job-failed", payload)
    errorEvents.emit("all-error", {...payload, errorType: "background-job-failed"})
  }

  /**
   * Reports an unexpected dispatcher failure through framework channels.
   * @param {{error: ReturnType<typeof JSON.parse>, stage: string}} args - Unexpected failure.
   * @returns {void} - No return value.
   */
  _reportFrameworkError({error, stage}) {
    const normalizedError = error instanceof Error ? error : new Error(String(error))
    const payload = {context: {stage}, error: normalizedError}
    const errorEvents = this.configuration.getErrorEvents()

    errorEvents.emit("framework-error", payload)
    errorEvents.emit("all-error", {...payload, errorType: "framework-error"})
  }
}
