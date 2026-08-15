// @ts-check

import BackgroundJobsAdapter from "./adapter.js"
import LocalBackgroundJobsDispatcher from "./local-dispatcher.js"
import LocalBackgroundJobRegistry from "./local-job-registry.js"
import LocalBackgroundJobsStore, {localBackgroundJobsClock} from "./local-store.js"

/** Durable local SQLite adapter with an owned in-process dispatcher. */
export default class LocalBackgroundJobsAdapter extends BackgroundJobsAdapter {
  /**
   * Creates a local adapter for one configuration and database.
   * @param {object} args - Adapter options.
   * @param {import("../configuration.js").default} args.configuration - Owning configuration.
   * @param {import("./types.js").LocalBackgroundJobsClock} [args.clock] - Injectable clock.
   * @param {string} [args.databaseIdentifier] - Local database identifier.
   */
  constructor({configuration, clock = localBackgroundJobsClock(), databaseIdentifier}) {
    super()
    this.clock = clock
    this.configuration = configuration
    this.registry = new LocalBackgroundJobRegistry({jobClasses: configuration.getBackgroundJobClasses()})
    this.store = new LocalBackgroundJobsStore({
      clock,
      configuration,
      databaseIdentifier,
      onCommittedEnqueue: () => this.dispatcher.wake()
    })
    this.dispatcher = new LocalBackgroundJobsDispatcher({clock, configuration, registry: this.registry, store: this.store})
  }

  /**
   * Ensures that local persistence and dispatch are ready.
   * @returns {Promise<void>} - Resolves when local dispatch is ready.
   */
  async ensureReady() { await this.dispatcher.start() }

  /**
   * Stops local dispatch gracefully.
   * @returns {Promise<void>} - Resolves after graceful local shutdown.
   */
  async close() {
    await this.dispatcher.stop()
    this.store.resetReadiness()
  }

  /**
   * Reports local dispatcher health.
   * @returns {Promise<import("./types.js").BackgroundJobsHealth>} - Local adapter health.
   */
  async health() { return {ready: this.dispatcher.isReady()} }

  /**
   * Reconciles configuration-derived queue concurrency caps.
   * @returns {Promise<void>} - Resolves after queue cap reconciliation.
   */
  async reconcileQueueConcurrency() { await this.store.reconcileQueueConcurrency() }

  /**
   * Enqueues one statically registered local job.
   * @param {{jobName: string, args: Array<ReturnType<typeof JSON.parse>>, options?: import("./types.js").BackgroundJobOptions}} args - Enqueue request.
   * @returns {Promise<string>} - Durable local job id.
   */
  async enqueue(args) {
    await this.ensureReady()
    this.registry.resolve(args.jobName)
    return await this.store.enqueue(args)
  }

  /**
   * Rejects stable-key cancellation, which is outside the local adapter contract.
   * @param {string} _scheduleKey - Unsupported stable key.
   * @returns {Promise<import("./types.js").BackgroundJobCancellationResult>} - Never resolves.
   */
  async cancelScheduled(_scheduleKey) { throw new Error("cancelScheduled is not supported by the local background-jobs adapter") }

  /**
   * Rejects stable-key replacement, which is outside the local adapter contract.
   * @param {{scheduleKey: string, jobName: string, args: Array<ReturnType<typeof JSON.parse>>, options?: import("./types.js").BackgroundJobOptions}} _args - Unsupported request.
   * @returns {Promise<import("./types.js").BackgroundJobReplacementResult>} - Never resolves.
   */
  async replaceScheduled(_args) { throw new Error("replaceScheduled is not supported by the local background-jobs adapter") }

  /**
   * Finds the next eligible local job.
   * @returns {Promise<import("./types.js").BackgroundJobRow | null>} - Next eligible job.
   */
  async nextAvailableJob() { return await this.store.nextAvailableJob() }

  /**
   * Finds the next future local job.
   * @returns {Promise<import("./types.js").BackgroundJobRow | null>} - Next future job.
   */
  async nextScheduledJob() { return await this.store.nextScheduledJob() }

  /**
   * Finds a local job by id.
   * @param {string} jobId - Job id.
   * @returns {Promise<import("./types.js").BackgroundJobRow | null>} - Persisted job.
   */
  async getJob(jobId) { return await this.store.getJob(jobId) }

  /**
   * Lists local jobs in insertion order.
   * @returns {Promise<import("./types.js").BackgroundJobRow[]>} - Local jobs.
   */
  async listJobs() { return await this.store.listJobs() }

  /**
   * Claims one queued local job.
   * @param {{jobId: string}} args - Claim request.
   * @returns {Promise<import("./types.js").BackgroundJobHandoff | null>} - Handoff.
   */
  async markHandedOff(args) { return await this.store.markHandedOff(args) }

  /**
   * Acknowledges successful local job completion.
   * @param {{jobId: string, handoffId?: string}} args - Completion report.
   * @returns {Promise<boolean>} - Whether accepted.
   */
  async markCompleted(args) { return await this.store.markCompleted(args) }

  /**
   * Acknowledges an explicit local reschedule.
   * @param {{jobId: string, delayMs: number, handoffId?: string}} args - Reschedule report.
   * @returns {Promise<boolean>} - Whether accepted.
   */
  async markRescheduled(args) { return await this.store.markRescheduled(args) }

  /**
   * Acknowledges a failed local performance.
   * @param {{jobId: string, error: ReturnType<typeof JSON.parse>, handoffId?: string}} args - Failure report.
   * @returns {Promise<import("./types.js").BackgroundJobRow | null>} - Transition.
   */
  async markFailed(args) { return await this.store.markFailed(args) }

  /**
   * Coalesces a dispatcher wake.
   * @returns {void} - No return value.
   */
  wake() { this.dispatcher.wake() }

  /**
   * Waits until current local work has been acknowledged.
   * @returns {Promise<void>} - Resolves after all current work is acknowledged.
   */
  async waitForIdle() { await this.dispatcher.waitForIdle() }
}
