import VelociousJob from "../background-jobs/job.js";
/**
 * Built-in job that prunes terminal `background_jobs` rows past their retention
 * window so the table does not grow unbounded. The main process registers this
 * on the normal background-jobs scheduler when `backgroundJobs.retention` is
 * enabled, so it runs as an ordinary scheduled/queued job — visible in the job
 * tables and dispatched to a worker — rather than a hidden in-process timer.
 * @augments {VelociousJob<[]>}
 */
export default class PruneTerminalBackgroundJobsJob extends VelociousJob<[]> {
    /** @type {string[]} */
    static databaseIdentifiers: string[];
    /**
     * Reserved job name that an application job cannot shadow. The registry loads
     * app `src/jobs` first and skips duplicate built-in names, so if this used the
     * default class-name identity an app class named `PruneTerminalBackgroundJobsJob`
     * would be dispatched instead. A `:`-namespaced name can never collide with a
     * default (class-name) identity, since class names cannot contain `:`.
     * @returns {string} - Reserved job name.
     */
    static jobName(): string;
    /**
     * Builds the scheduler configuration for this job from a resolved retention
     * config, or returns `null` when retention is fully disabled (nothing to
     * prune, so nothing to schedule). `maxConcurrency: 1` keeps runs from
     * overlapping, and `deduplicateWhileQueued` stops the interval scheduler from
     * piling up redundant queued rows when a prune is slow or no worker is free.
     * @param {import("../configuration-types.js").ResolvedBackgroundJobsRetentionConfiguration} retention - Resolved retention config.
     * @returns {import("../configuration-types.js").ScheduledBackgroundJobConfiguration | null} - Scheduler config for the prune job, or null when retention is disabled.
     */
    static scheduleConfiguration(retention: import("../configuration-types.js").ResolvedBackgroundJobsRetentionConfiguration): import("../configuration-types.js").ScheduledBackgroundJobConfiguration | null;
    /**
     * Prunes terminal job rows past their retention window.
     * @returns {Promise<void>}
     */
    perform(): Promise<void>;
}
//# sourceMappingURL=prune-terminal-background-jobs.d.ts.map