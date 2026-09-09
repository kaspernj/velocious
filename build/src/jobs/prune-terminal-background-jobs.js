// @ts-check
import Configuration from "../configuration.js";
import VelociousJob from "../background-jobs/job.js";
/**
 * Built-in job that prunes terminal `background_jobs` rows past their retention
 * window so the table does not grow unbounded. The main process registers this
 * on the normal background-jobs scheduler when `backgroundJobs.retention` is
 * enabled, so it runs as an ordinary scheduled/queued job — visible in the job
 * tables and dispatched to a worker — rather than a hidden in-process timer.
 * @augments {VelociousJob<[]>}
 */
export default class PruneTerminalBackgroundJobsJob extends VelociousJob {
    /** @type {string[]} */
    static databaseIdentifiers = [];
    /**
     * Reserved job name that an application job cannot shadow. The registry loads
     * app `src/jobs` first and skips duplicate built-in names, so if this used the
     * default class-name identity an app class named `PruneTerminalBackgroundJobsJob`
     * would be dispatched instead. A `:`-namespaced name can never collide with a
     * default (class-name) identity, since class names cannot contain `:`.
     * @returns {string} - Reserved job name.
     */
    static jobName() {
        return "velocious:prune-terminal-background-jobs";
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
        const prunesCompleted = typeof retention.completedTtlMs === "number" && retention.completedTtlMs > 0;
        const prunesFailed = typeof retention.failedTtlMs === "number" && retention.failedTtlMs > 0;
        if (!prunesCompleted && !prunesFailed) {
            return null;
        }
        return {
            class: this,
            every: retention.sweepIntervalMs,
            options: { concurrencyKey: "velocious-prune-terminal-background-jobs", maxConcurrency: 1, deduplicateWhileQueued: true }
        };
    }
    /**
     * Prunes terminal job rows past their retention window.
     * @returns {Promise<void>}
     */
    async perform() {
        const configuration = Configuration.current();
        const config = configuration.getBackgroundJobsConfig();
        const adapter = await configuration.acquireReadyBackgroundJobsAdapter();
        await adapter.pruneTerminalJobs({
            completedTtlMs: config.retention.completedTtlMs,
            failedTtlMs: config.retention.failedTtlMs,
            batchSize: config.retention.batchSize
        });
    }
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoicHJ1bmUtdGVybWluYWwtYmFja2dyb3VuZC1qb2JzLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiLi4vLi4vLi4vc3JjL2pvYnMvcHJ1bmUtdGVybWluYWwtYmFja2dyb3VuZC1qb2JzLmpzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiJBQUFBLFlBQVk7QUFFWixPQUFPLGFBQWEsTUFBTSxxQkFBcUIsQ0FBQTtBQUMvQyxPQUFPLFlBQVksTUFBTSwyQkFBMkIsQ0FBQTtBQUVwRDs7Ozs7OztHQU9HO0FBQ0gsTUFBTSxDQUFDLE9BQU8sT0FBTyw4QkFBK0IsU0FBUSxZQUFZO0lBQ3RFLHVCQUF1QjtJQUN2QixNQUFNLENBQUMsbUJBQW1CLEdBQUcsRUFBRSxDQUFBO0lBRS9COzs7Ozs7O09BT0c7SUFDSCxNQUFNLENBQUMsT0FBTztRQUNaLE9BQU8sMENBQTBDLENBQUE7SUFDbkQsQ0FBQztJQUVEOzs7Ozs7OztPQVFHO0lBQ0gsTUFBTSxDQUFDLHFCQUFxQixDQUFDLFNBQVM7UUFDcEMsTUFBTSxlQUFlLEdBQUcsT0FBTyxTQUFTLENBQUMsY0FBYyxLQUFLLFFBQVEsSUFBSSxTQUFTLENBQUMsY0FBYyxHQUFHLENBQUMsQ0FBQTtRQUNwRyxNQUFNLFlBQVksR0FBRyxPQUFPLFNBQVMsQ0FBQyxXQUFXLEtBQUssUUFBUSxJQUFJLFNBQVMsQ0FBQyxXQUFXLEdBQUcsQ0FBQyxDQUFBO1FBRTNGLElBQUksQ0FBQyxlQUFlLElBQUksQ0FBQyxZQUFZLEVBQUUsQ0FBQztZQUN0QyxPQUFPLElBQUksQ0FBQTtRQUNiLENBQUM7UUFFRCxPQUFPO1lBQ0wsS0FBSyxFQUFFLElBQUk7WUFDWCxLQUFLLEVBQUUsU0FBUyxDQUFDLGVBQWU7WUFDaEMsT0FBTyxFQUFFLEVBQUMsY0FBYyxFQUFFLDBDQUEwQyxFQUFFLGNBQWMsRUFBRSxDQUFDLEVBQUUsc0JBQXNCLEVBQUUsSUFBSSxFQUFDO1NBQ3ZILENBQUE7SUFDSCxDQUFDO0lBRUQ7OztPQUdHO0lBQ0gsS0FBSyxDQUFDLE9BQU87UUFDWCxNQUFNLGFBQWEsR0FBRyxhQUFhLENBQUMsT0FBTyxFQUFFLENBQUE7UUFDN0MsTUFBTSxNQUFNLEdBQUcsYUFBYSxDQUFDLHVCQUF1QixFQUFFLENBQUE7UUFDdEQsTUFBTSxPQUFPLEdBQUcsTUFBTSxhQUFhLENBQUMsaUNBQWlDLEVBQUUsQ0FBQTtRQUV2RSxNQUFNLE9BQU8sQ0FBQyxpQkFBaUIsQ0FBQztZQUM5QixjQUFjLEVBQUUsTUFBTSxDQUFDLFNBQVMsQ0FBQyxjQUFjO1lBQy9DLFdBQVcsRUFBRSxNQUFNLENBQUMsU0FBUyxDQUFDLFdBQVc7WUFDekMsU0FBUyxFQUFFLE1BQU0sQ0FBQyxTQUFTLENBQUMsU0FBUztTQUN0QyxDQUFDLENBQUE7SUFDSixDQUFDO0NBQ0YiLCJzb3VyY2VzQ29udGVudCI6WyIvLyBAdHMtY2hlY2tcblxuaW1wb3J0IENvbmZpZ3VyYXRpb24gZnJvbSBcIi4uL2NvbmZpZ3VyYXRpb24uanNcIlxuaW1wb3J0IFZlbG9jaW91c0pvYiBmcm9tIFwiLi4vYmFja2dyb3VuZC1qb2JzL2pvYi5qc1wiXG5cbi8qKlxuICogQnVpbHQtaW4gam9iIHRoYXQgcHJ1bmVzIHRlcm1pbmFsIGBiYWNrZ3JvdW5kX2pvYnNgIHJvd3MgcGFzdCB0aGVpciByZXRlbnRpb25cbiAqIHdpbmRvdyBzbyB0aGUgdGFibGUgZG9lcyBub3QgZ3JvdyB1bmJvdW5kZWQuIFRoZSBtYWluIHByb2Nlc3MgcmVnaXN0ZXJzIHRoaXNcbiAqIG9uIHRoZSBub3JtYWwgYmFja2dyb3VuZC1qb2JzIHNjaGVkdWxlciB3aGVuIGBiYWNrZ3JvdW5kSm9icy5yZXRlbnRpb25gIGlzXG4gKiBlbmFibGVkLCBzbyBpdCBydW5zIGFzIGFuIG9yZGluYXJ5IHNjaGVkdWxlZC9xdWV1ZWQgam9iIOKAlCB2aXNpYmxlIGluIHRoZSBqb2JcbiAqIHRhYmxlcyBhbmQgZGlzcGF0Y2hlZCB0byBhIHdvcmtlciDigJQgcmF0aGVyIHRoYW4gYSBoaWRkZW4gaW4tcHJvY2VzcyB0aW1lci5cbiAqIEBhdWdtZW50cyB7VmVsb2Npb3VzSm9iPFtdPn1cbiAqL1xuZXhwb3J0IGRlZmF1bHQgY2xhc3MgUHJ1bmVUZXJtaW5hbEJhY2tncm91bmRKb2JzSm9iIGV4dGVuZHMgVmVsb2Npb3VzSm9iIHtcbiAgLyoqIEB0eXBlIHtzdHJpbmdbXX0gKi9cbiAgc3RhdGljIGRhdGFiYXNlSWRlbnRpZmllcnMgPSBbXVxuXG4gIC8qKlxuICAgKiBSZXNlcnZlZCBqb2IgbmFtZSB0aGF0IGFuIGFwcGxpY2F0aW9uIGpvYiBjYW5ub3Qgc2hhZG93LiBUaGUgcmVnaXN0cnkgbG9hZHNcbiAgICogYXBwIGBzcmMvam9ic2AgZmlyc3QgYW5kIHNraXBzIGR1cGxpY2F0ZSBidWlsdC1pbiBuYW1lcywgc28gaWYgdGhpcyB1c2VkIHRoZVxuICAgKiBkZWZhdWx0IGNsYXNzLW5hbWUgaWRlbnRpdHkgYW4gYXBwIGNsYXNzIG5hbWVkIGBQcnVuZVRlcm1pbmFsQmFja2dyb3VuZEpvYnNKb2JgXG4gICAqIHdvdWxkIGJlIGRpc3BhdGNoZWQgaW5zdGVhZC4gQSBgOmAtbmFtZXNwYWNlZCBuYW1lIGNhbiBuZXZlciBjb2xsaWRlIHdpdGggYVxuICAgKiBkZWZhdWx0IChjbGFzcy1uYW1lKSBpZGVudGl0eSwgc2luY2UgY2xhc3MgbmFtZXMgY2Fubm90IGNvbnRhaW4gYDpgLlxuICAgKiBAcmV0dXJucyB7c3RyaW5nfSAtIFJlc2VydmVkIGpvYiBuYW1lLlxuICAgKi9cbiAgc3RhdGljIGpvYk5hbWUoKSB7XG4gICAgcmV0dXJuIFwidmVsb2Npb3VzOnBydW5lLXRlcm1pbmFsLWJhY2tncm91bmQtam9ic1wiXG4gIH1cblxuICAvKipcbiAgICogQnVpbGRzIHRoZSBzY2hlZHVsZXIgY29uZmlndXJhdGlvbiBmb3IgdGhpcyBqb2IgZnJvbSBhIHJlc29sdmVkIHJldGVudGlvblxuICAgKiBjb25maWcsIG9yIHJldHVybnMgYG51bGxgIHdoZW4gcmV0ZW50aW9uIGlzIGZ1bGx5IGRpc2FibGVkIChub3RoaW5nIHRvXG4gICAqIHBydW5lLCBzbyBub3RoaW5nIHRvIHNjaGVkdWxlKS4gYG1heENvbmN1cnJlbmN5OiAxYCBrZWVwcyBydW5zIGZyb21cbiAgICogb3ZlcmxhcHBpbmcsIGFuZCBgZGVkdXBsaWNhdGVXaGlsZVF1ZXVlZGAgc3RvcHMgdGhlIGludGVydmFsIHNjaGVkdWxlciBmcm9tXG4gICAqIHBpbGluZyB1cCByZWR1bmRhbnQgcXVldWVkIHJvd3Mgd2hlbiBhIHBydW5lIGlzIHNsb3cgb3Igbm8gd29ya2VyIGlzIGZyZWUuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vY29uZmlndXJhdGlvbi10eXBlcy5qc1wiKS5SZXNvbHZlZEJhY2tncm91bmRKb2JzUmV0ZW50aW9uQ29uZmlndXJhdGlvbn0gcmV0ZW50aW9uIC0gUmVzb2x2ZWQgcmV0ZW50aW9uIGNvbmZpZy5cbiAgICogQHJldHVybnMge2ltcG9ydChcIi4uL2NvbmZpZ3VyYXRpb24tdHlwZXMuanNcIikuU2NoZWR1bGVkQmFja2dyb3VuZEpvYkNvbmZpZ3VyYXRpb24gfCBudWxsfSAtIFNjaGVkdWxlciBjb25maWcgZm9yIHRoZSBwcnVuZSBqb2IsIG9yIG51bGwgd2hlbiByZXRlbnRpb24gaXMgZGlzYWJsZWQuXG4gICAqL1xuICBzdGF0aWMgc2NoZWR1bGVDb25maWd1cmF0aW9uKHJldGVudGlvbikge1xuICAgIGNvbnN0IHBydW5lc0NvbXBsZXRlZCA9IHR5cGVvZiByZXRlbnRpb24uY29tcGxldGVkVHRsTXMgPT09IFwibnVtYmVyXCIgJiYgcmV0ZW50aW9uLmNvbXBsZXRlZFR0bE1zID4gMFxuICAgIGNvbnN0IHBydW5lc0ZhaWxlZCA9IHR5cGVvZiByZXRlbnRpb24uZmFpbGVkVHRsTXMgPT09IFwibnVtYmVyXCIgJiYgcmV0ZW50aW9uLmZhaWxlZFR0bE1zID4gMFxuXG4gICAgaWYgKCFwcnVuZXNDb21wbGV0ZWQgJiYgIXBydW5lc0ZhaWxlZCkge1xuICAgICAgcmV0dXJuIG51bGxcbiAgICB9XG5cbiAgICByZXR1cm4ge1xuICAgICAgY2xhc3M6IHRoaXMsXG4gICAgICBldmVyeTogcmV0ZW50aW9uLnN3ZWVwSW50ZXJ2YWxNcyxcbiAgICAgIG9wdGlvbnM6IHtjb25jdXJyZW5jeUtleTogXCJ2ZWxvY2lvdXMtcHJ1bmUtdGVybWluYWwtYmFja2dyb3VuZC1qb2JzXCIsIG1heENvbmN1cnJlbmN5OiAxLCBkZWR1cGxpY2F0ZVdoaWxlUXVldWVkOiB0cnVlfVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBQcnVuZXMgdGVybWluYWwgam9iIHJvd3MgcGFzdCB0aGVpciByZXRlbnRpb24gd2luZG93LlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn1cbiAgICovXG4gIGFzeW5jIHBlcmZvcm0oKSB7XG4gICAgY29uc3QgY29uZmlndXJhdGlvbiA9IENvbmZpZ3VyYXRpb24uY3VycmVudCgpXG4gICAgY29uc3QgY29uZmlnID0gY29uZmlndXJhdGlvbi5nZXRCYWNrZ3JvdW5kSm9ic0NvbmZpZygpXG4gICAgY29uc3QgYWRhcHRlciA9IGF3YWl0IGNvbmZpZ3VyYXRpb24uYWNxdWlyZVJlYWR5QmFja2dyb3VuZEpvYnNBZGFwdGVyKClcblxuICAgIGF3YWl0IGFkYXB0ZXIucHJ1bmVUZXJtaW5hbEpvYnMoe1xuICAgICAgY29tcGxldGVkVHRsTXM6IGNvbmZpZy5yZXRlbnRpb24uY29tcGxldGVkVHRsTXMsXG4gICAgICBmYWlsZWRUdGxNczogY29uZmlnLnJldGVudGlvbi5mYWlsZWRUdGxNcyxcbiAgICAgIGJhdGNoU2l6ZTogY29uZmlnLnJldGVudGlvbi5iYXRjaFNpemVcbiAgICB9KVxuICB9XG59XG4iXX0=