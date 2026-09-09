// @ts-check

/** Platform-neutral producer client for a configured adapter. */
export default class BackgroundJobsAdapterClient {
  /**
   * Creates an adapter-backed producer.
   * @param {{configuration: import("../configuration.js").default}} args - Client options.
   */
  constructor({configuration}) {
    this.configuration = configuration
  }

  /**
   * Enqueues a job through the configured adapter.
   * @param {{jobName: string, args: Array<ReturnType<typeof JSON.parse>>, options?: import("./types.js").BackgroundJobOptions}} args - Job request.
   * @returns {Promise<string>} - Job id.
   */
  async enqueue(args) {
    const adapter = await this.configuration.acquireReadyBackgroundJobsAdapter()

    return await adapter.enqueue(args)
  }

  /**
   * Replaces a stable schedule through the configured adapter.
   * @param {{scheduleKey: string, jobName: string, args: Array<ReturnType<typeof JSON.parse>>, options?: import("./types.js").BackgroundJobOptions}} args - Replacement request.
   * @returns {Promise<import("./types.js").BackgroundJobReplacementResult>} - Replacement result.
   */
  async replaceScheduled(args) {
    const adapter = await this.configuration.acquireReadyBackgroundJobsAdapter()

    return await adapter.replaceScheduled(args)
  }

  /**
   * Cancels a stable schedule through the configured adapter.
   * @param {{scheduleKey: string}} args - Cancellation request.
   * @returns {Promise<import("./types.js").BackgroundJobCancellationResult>} - Cancellation result.
   */
  async cancelScheduled({scheduleKey}) {
    const adapter = await this.configuration.acquireReadyBackgroundJobsAdapter()

    return await adapter.cancelScheduled(scheduleKey)
  }
}
