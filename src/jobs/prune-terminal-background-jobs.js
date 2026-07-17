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
   * Reserved job name that an application job cannot shadow. The registry loads
   * app `src/jobs` first and skips duplicate built-in names, so if this used the
   * default class-name identity an app class named `PruneTerminalBackgroundJobsJob`
   * would be dispatched instead. A `:`-namespaced name can never collide with a
   * default (class-name) identity, since class names cannot contain `:`.
   * @returns {string} - Reserved job name.
   */
  static jobName() {
    return "velocious:prune-terminal-background-jobs"
  }

  /**
   * Builds the scheduler configuration for this job from a resolved retention
   * config, or returns `null` when retention is fully disabled (nothing to
   * prune, so nothing to schedule). `maxConcurrency: 1` keeps runs from
   * overlapping, and `deduplicateWhileQueued` stops the interval scheduler from
   * piling up redundant queued rows when a prune is slow or no worker is free.
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
      options: {concurrencyKey: "velocious-prune-terminal-background-jobs", maxConcurrency: 1, deduplicateWhileQueued: true}
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
