// @ts-check

import BackgroundJobsStore from "../background-jobs/store.js"
import Configuration from "../configuration.js"
import VelociousJob from "../background-jobs/job.js"

/**
 * Built-in job that prunes terminal `background_jobs` rows past their retention
 * window so the table does not grow unbounded. The main process registers this
 * on the normal background-jobs scheduler when `backgroundJobs.retention` is
 * enabled, so it runs as an ordinary scheduled/queued job — visible in the job
 * tables and dispatched to a worker — rather than a hidden in-process timer.
 * @augments {VelociousJob<[]>}
 */
export default class PruneTerminalBackgroundJobsJob extends VelociousJob {
  /**
   * Builds the scheduler configuration for this job from a resolved retention
   * config, or returns `null` when retention is fully disabled (nothing to
   * prune, so nothing to schedule). A single `concurrencyKey`/`maxConcurrency`
   * keeps a slow prune from piling up overlapping runs.
   * @param {import("../configuration-types.js").ResolvedBackgroundJobsRetentionConfiguration} retention - Resolved retention config.
   * @returns {import("../configuration-types.js").ScheduledBackgroundJobConfiguration | null} - Scheduler config for the prune job, or null when retention is disabled.
   */
  static scheduleConfiguration(retention) {
    const prunesCompleted = typeof retention.completedTtlMs === "number" && retention.completedTtlMs > 0
    const prunesFailed = typeof retention.failedTtlMs === "number" && retention.failedTtlMs > 0

    if (!prunesCompleted && !prunesFailed) {
      return null
    }

    return {
      class: this,
      every: retention.sweepIntervalMs,
      options: {concurrencyKey: "velocious-prune-terminal-background-jobs", maxConcurrency: 1}
    }
  }

  /**
   * Prunes terminal job rows past their retention window.
   * @returns {Promise<void>}
   */
  async perform() {
    const configuration = Configuration.current()
    const config = configuration.getBackgroundJobsConfig()
    const store = new BackgroundJobsStore({configuration, databaseIdentifier: config.databaseIdentifier})

    await store.pruneTerminalJobs({
      completedTtlMs: config.retention.completedTtlMs,
      failedTtlMs: config.retention.failedTtlMs,
      batchSize: config.retention.batchSize
    })
  }
}
