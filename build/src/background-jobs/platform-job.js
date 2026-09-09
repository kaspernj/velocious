// @ts-check
import BackgroundJobRescheduleSignal from "./reschedule-signal.js";
import { cancelScheduledBackgroundJob, enqueueBackgroundJob, replaceScheduledBackgroundJob } from "./runtime.js";
/**
 * Base class for background jobs.
 *
 * `TArgs` is the tuple of arguments the subclass's `perform` accepts, so a job that
 * needs arguments declares them as required and typed — for example
 * `class RunBuildJob extends VelociousJob<[string]>` with `async perform(buildId)`.
 * The default empty tuple keeps argument-less jobs (`extends VelociousJob`,
 * `async perform()`) working unchanged.
 * @template {Array<ReturnType<typeof JSON.parse>>} [TArgs=[]]
 */
export default class VelociousJob {
    constructor() {
        /** @type {import("./types.js").BackgroundJobContext | undefined} */
        this._backgroundJobContext = undefined;
    }
    /**
     * Database identifiers checked out while this job performs. Set an explicit
     * list to avoid holding unrelated configured database connections, or `[]`
     * when the job establishes any connections it needs itself. Left undefined,
     * jobs retain the existing behavior of checking out every active database.
     * @type {string[] | undefined}
     */
    static databaseIdentifiers = undefined;
    /**
     * Queue this job class runs on. Subclasses set e.g. `static queue = "builds"`
     * to route onto a queue with its own cluster-wide concurrency cap (configured
     * via `backgroundJobs.queues`). The `{queue}` enqueue option overrides it.
     * Left undefined, jobs run on the `"default"` queue.
     * @type {string | undefined}
     */
    static queue = undefined;
    /**
     * Optional process title shown for the runner while this job executes.
     * Velocious sets `process.title` to this for the duration of the job — so
     * `ps`/`top`/`htop` identify what a runner is doing — and restores the
     * runner's base title when the job finishes. Left undefined, the runner falls
     * back to `velocious job-runner: <JobName>`. Set e.g.
     * `static processTitle = "velocious media transcoder"` to give a job a
     * custom, human-readable title.
     * @type {string | undefined}
     */
    static processTitle = undefined;
    /**
     * Stops this performance and reschedules the same logical job row. This is
     * normal control flow: it does not count as a failure or consume a retry.
     * @param {number} delayMs - Non-negative safe-integer delay in milliseconds.
     * @returns {never} - This method never returns.
     */
    rescheduleIn(delayMs) {
        if (!Number.isSafeInteger(delayMs) || delayMs < 0) {
            throw new TypeError("background job reschedule delayMs must be a non-negative safe integer");
        }
        throw new BackgroundJobRescheduleSignal(delayMs);
    }
    /**
     * Runs job name.
     * @returns {string} - Job name.
     */
    static jobName() {
        return this.name;
    }
    /**
     * Folds this job class's static `queue` into the enqueue options unless the
     * caller already specified one.
     * @param {import("./types.js").BackgroundJobOptions | undefined} options - Job options.
     * @returns {import("./types.js").BackgroundJobOptions} - Options including the resolved queue.
     */
    static _withQueue(options) {
        const merged = options ? { ...options } : {};
        if (merged.queue === undefined && typeof this.queue === "string" && this.queue.length > 0) {
            merged.queue = this.queue;
        }
        return merged;
    }
    /**
     * Resolves class-derived enqueue options on a hydrated job instance. Explicit
     * per-enqueue options take precedence over the instance concurrency key.
     * @param {object} args - Job context.
     * @param {Array<ReturnType<typeof JSON.parse>>} args.jobArgs - Job arguments.
     * @param {import("./types.js").BackgroundJobOptions | undefined} args.jobOptions - Job options.
     * @returns {import("./types.js").BackgroundJobOptions} - Resolved job options.
     */
    static _withJobContext({ jobArgs, jobOptions }) {
        const options = this._withQueue(jobOptions);
        if (options.concurrencyKey !== undefined)
            return options;
        const jobInstance = new this();
        jobInstance._setBackgroundJobContext({
            args: jobArgs,
            jobClass: this,
            jobName: this.jobName(),
            options
        });
        const concurrencyKey = jobInstance.concurrencyKey();
        if (concurrencyKey !== undefined)
            options.concurrencyKey = concurrencyKey;
        return options;
    }
    /**
     * Sets the complete context available to this hydrated job instance.
     * Framework enqueue/runner boundaries own this method.
     * @param {import("./types.js").BackgroundJobContext} context - Job context.
     * @returns {void}
     */
    _setBackgroundJobContext(context) {
        this._backgroundJobContext = context;
    }
    /**
     * Returns this hydrated job's complete enqueue or runner context.
     * @returns {import("./types.js").BackgroundJobContext} - Job context.
     */
    backgroundJobContext() {
        if (!this._backgroundJobContext)
            throw new Error("Background job context is not hydrated");
        return this._backgroundJobContext;
    }
    /**
     * Override to derive a durable concurrency key from `backgroundJobContext()`.
     * Pair the derived key with `maxConcurrency` in enqueue options. An explicit
     * per-enqueue `concurrencyKey` takes precedence and skips this method.
     * @returns {string | undefined} - Derived concurrency key, or undefined for none.
     */
    concurrencyKey() {
        return undefined;
    }
    /**
     * Runs perform later.
     * @param {...ReturnType<typeof JSON.parse>} args - Job args.
     * @returns {Promise<string>} - Job id.
     */
    static async performLater(...args) {
        const { jobArgs, jobOptions } = this._splitArgsAndOptions(args);
        return await enqueueBackgroundJob({ JobClass: this, jobArgs, jobOptions });
    }
    /**
     * Runs perform later with options.
     * @param {object} args - Options.
     * @param {Array<ReturnType<typeof JSON.parse>>} args.args - Job args.
     * @param {import("./types.js").BackgroundJobOptions} [args.options] - Job options.
     * @returns {Promise<string>} - Job id.
     */
    static async performLaterWithOptions({ args, options }) {
        return await enqueueBackgroundJob({ JobClass: this, jobArgs: args, jobOptions: options });
    }
    /**
     * Atomically replaces this job class's queued owner for a stable schedule key.
     * @param {object} args - Options.
     * @param {string} args.scheduleKey - Stable logical schedule key.
     * @param {Array<ReturnType<typeof JSON.parse>>} args.args - Job args.
     * @param {import("./types.js").BackgroundJobOptions} [args.options] - Job options.
     * @returns {Promise<import("./types.js").BackgroundJobReplacementResult>} - Replacement result.
     */
    static async replaceScheduled({ scheduleKey, args, options }) {
        return await replaceScheduledBackgroundJob({ JobClass: this, scheduleKey, jobArgs: args, jobOptions: options });
    }
    /**
     * Cancels or detaches the current owner of a stable schedule key.
     * @param {string} scheduleKey - Stable logical schedule key.
     * @returns {Promise<import("./types.js").BackgroundJobCancellationResult>} - Cancellation result.
     */
    static async cancelScheduled(scheduleKey) {
        return await cancelScheduledBackgroundJob(scheduleKey);
    }
    /**
     * Runs split args and options.
     * @param {Array<ReturnType<typeof JSON.parse>>} args - Job args.
     * @returns {{jobArgs: Array<ReturnType<typeof JSON.parse>>, jobOptions: import("./types.js").BackgroundJobOptions}} - Split args and options.
     */
    static _splitArgsAndOptions(args) {
        if (args.length === 0) {
            return { jobArgs: [], jobOptions: {} };
        }
        const lastArg = args[args.length - 1];
        const isOptionsArg = lastArg && typeof lastArg === "object" && !Array.isArray(lastArg) && "jobOptions" in lastArg;
        if (isOptionsArg) {
            const { jobOptions } = /** @type {{jobOptions: import("./types.js").BackgroundJobOptions}} */ (lastArg);
            return { jobArgs: args.slice(0, -1), jobOptions: jobOptions || {} };
        }
        return { jobArgs: args, jobOptions: {} };
    }
    /**
     * Override in subclasses.
     * @param {TArgs} _args - Job args (the tuple this job class was parameterized with).
     * @returns {Promise<void>} - Resolves when complete.
     */
    async perform(..._args) {
        throw new Error("perform not implemented");
    }
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoicGxhdGZvcm0tam9iLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiLi4vLi4vLi4vc3JjL2JhY2tncm91bmQtam9icy9wbGF0Zm9ybS1qb2IuanMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6IkFBQUEsWUFBWTtBQUVaLE9BQU8sNkJBQTZCLE1BQU0sd0JBQXdCLENBQUE7QUFDbEUsT0FBTyxFQUFDLDRCQUE0QixFQUFFLG9CQUFvQixFQUFFLDZCQUE2QixFQUFDLE1BQU0sY0FBYyxDQUFBO0FBRTlHOzs7Ozs7Ozs7R0FTRztBQUNILE1BQU0sQ0FBQyxPQUFPLE9BQU8sWUFBWTtJQUMvQjtRQUNFLG9FQUFvRTtRQUNwRSxJQUFJLENBQUMscUJBQXFCLEdBQUcsU0FBUyxDQUFBO0lBQ3hDLENBQUM7SUFFRDs7Ozs7O09BTUc7SUFDSCxNQUFNLENBQUMsbUJBQW1CLEdBQUcsU0FBUyxDQUFBO0lBRXRDOzs7Ozs7T0FNRztJQUNILE1BQU0sQ0FBQyxLQUFLLEdBQUcsU0FBUyxDQUFBO0lBRXhCOzs7Ozs7Ozs7T0FTRztJQUNILE1BQU0sQ0FBQyxZQUFZLEdBQUcsU0FBUyxDQUFBO0lBRS9COzs7OztPQUtHO0lBQ0gsWUFBWSxDQUFDLE9BQU87UUFDbEIsSUFBSSxDQUFDLE1BQU0sQ0FBQyxhQUFhLENBQUMsT0FBTyxDQUFDLElBQUksT0FBTyxHQUFHLENBQUMsRUFBRSxDQUFDO1lBQ2xELE1BQU0sSUFBSSxTQUFTLENBQUMsdUVBQXVFLENBQUMsQ0FBQTtRQUM5RixDQUFDO1FBRUQsTUFBTSxJQUFJLDZCQUE2QixDQUFDLE9BQU8sQ0FBQyxDQUFBO0lBQ2xELENBQUM7SUFFRDs7O09BR0c7SUFDSCxNQUFNLENBQUMsT0FBTztRQUNaLE9BQU8sSUFBSSxDQUFDLElBQUksQ0FBQTtJQUNsQixDQUFDO0lBRUQ7Ozs7O09BS0c7SUFDSCxNQUFNLENBQUMsVUFBVSxDQUFDLE9BQU87UUFDdkIsTUFBTSxNQUFNLEdBQUcsT0FBTyxDQUFDLENBQUMsQ0FBQyxFQUFD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QUFJO1FBQzlCLElBQUksSUFBSSxDQUFDLE1BQU0sS0FBSyxDQUFDLEVBQUUsQ0FBQztZQUN0QixPQUFPLEVBQUMsT0FBTyxFQUFFLEVBQUUsRUFBRSxVQUFVLEVBQUUsRUFBRSxFQUFDLENBQUE7UUFDdEMsQ0FBQztRQUVELE1BQU0sT0FBTyxHQUFHLElBQUksQ0FBQyxJQUFJLENBQUMsTUFBTSxHQUFHLENBQUMsQ0FBQyxDQUFBO1FBQ3JDLE1BQU0sWUFBWSxHQUFHLE9BQU8sSUFBSSxPQUFPLE9BQU8sS0FBSyxRQUFRLElBQUksQ0FBQyxLQUFLLENBQUMsT0FBTyxDQUFDLE9BQU8sQ0FBQyxJQUFJLFlBQVksSUFBSSxPQUFPLENBQUE7UUFFakgsSUFBSSxZQUFZLEVBQUUsQ0FBQztZQUNqQixNQUFNLEVBQUMsVUFBVSxFQUFDLEdBQUcsc0VBQXNFLENBQUMsQ0FBQyxPQUFPLENBQUMsQ0FBQTtZQUNyRyxPQUFPLEVBQUMsT0FBTyxFQUFFLElBQUksQ0FBQyxLQUFLLENBQUMsQ0FBQyxFQUFFLENBQUMsQ0FBQyxDQUFDLEVBQUUsVUFBVSxFQUFFLFVBQVUsSUFBSSxFQUFFLEVBQUMsQ0FBQTtRQUNuRSxDQUFDO1FBRUQsT0FBTyxFQUFDLE9BQU8sRUFBRSxJQUFJLEVBQUUsVUFBVSxFQUFFLEVBQUUsRUFBQyxDQUFBO0lBQ3hDLENBQUM7SUFFRDs7OztPQUlHO0lBQ0gsS0FBSyxDQUFDLE9BQU8sQ0FBQyxHQUFHLEtBQUs7UUFDcEIsTUFBTSxJQUFJLEtBQUssQ0FBQyx5QkFBeUIsQ0FBQyxDQUFBO0lBQzVDLENBQUM7Q0FDRiIsInNvdXJjZXNDb250ZW50IjpbIi8vIEB0cy1jaGVja1xuXG5pbXBvcnQgQmFja2dyb3VuZEpvYlJlc2NoZWR1bGVTaWduYWwgZnJvbSBcIi4vcmVzY2hlZHVsZS1zaWduYWwuanNcIlxuaW1wb3J0IHtjYW5jZWxTY2hlZHVsZWRCYWNrZ3JvdW5kSm9iLCBlbnF1ZXVlQmFja2dyb3VuZEpvYiwgcmVwbGFjZVNjaGVkdWxlZEJhY2tncm91bmRKb2J9IGZyb20gXCIuL3J1bnRpbWUuanNcIlxuXG4vKipcbiAqIEJhc2UgY2xhc3MgZm9yIGJhY2tncm91bmQgam9icy5cbiAqXG4gKiBgVEFyZ3NgIGlzIHRoZSB0dXBsZSBvZiBhcmd1bWVudHMgdGhlIHN1YmNsYXNzJ3MgYHBlcmZvcm1gIGFjY2VwdHMsIHNvIGEgam9iIHRoYXRcbiAqIG5lZWRzIGFyZ3VtZW50cyBkZWNsYXJlcyB0aGVtIGFzIHJlcXVpcmVkIGFuZCB0eXBlZCDigJQgZm9yIGV4YW1wbGVcbiAqIGBjbGFzcyBSdW5CdWlsZEpvYiBleHRlbmRzIFZlbG9jaW91c0pvYjxbc3RyaW5nXT5gIHdpdGggYGFzeW5jIHBlcmZvcm0oYnVpbGRJZClgLlxuICogVGhlIGRlZmF1bHQgZW1wdHkgdHVwbGUga2VlcHMgYXJndW1lbnQtbGVzcyBqb2JzIChgZXh0ZW5kcyBWZWxvY2lvdXNKb2JgLFxuICogYGFzeW5jIHBlcmZvcm0oKWApIHdvcmtpbmcgdW5jaGFuZ2VkLlxuICogQHRlbXBsYXRlIHtBcnJheTxSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59IFtUQXJncz1bXV1cbiAqL1xuZXhwb3J0IGRlZmF1bHQgY2xhc3MgVmVsb2Npb3VzSm9iIHtcbiAgY29uc3RydWN0b3IoKSB7XG4gICAgLyoqIEB0eXBlIHtpbXBvcnQoXCIuL3R5cGVzLmpzXCIpLkJhY2tncm91bmRKb2JDb250ZXh0IHwgdW5kZWZpbmVkfSAqL1xuICAgIHRoaXMuX2JhY2tncm91bmRKb2JDb250ZXh0ID0gdW5kZWZpbmVkXG4gIH1cblxuICAvKipcbiAgICogRGF0YWJhc2UgaWRlbnRpZmllcnMgY2hlY2tlZCBvdXQgd2hpbGUgdGhpcyBqb2IgcGVyZm9ybXMuIFNldCBhbiBleHBsaWNpdFxuICAgKiBsaXN0IHRvIGF2b2lkIGhvbGRpbmcgdW5yZWxhdGVkIGNvbmZpZ3VyZWQgZGF0YWJhc2UgY29ubmVjdGlvbnMsIG9yIGBbXWBcbiAgICogd2hlbiB0aGUgam9iIGVzdGFibGlzaGVzIGFueSBjb25uZWN0aW9ucyBpdCBuZWVkcyBpdHNlbGYuIExlZnQgdW5kZWZpbmVkLFxuICAgKiBqb2JzIHJldGFpbiB0aGUgZXhpc3RpbmcgYmVoYXZpb3Igb2YgY2hlY2tpbmcgb3V0IGV2ZXJ5IGFjdGl2ZSBkYXRhYmFzZS5cbiAgICogQHR5cGUge3N0cmluZ1tdIHwgdW5kZWZpbmVkfVxuICAgKi9cbiAgc3RhdGljIGRhdGFiYXNlSWRlbnRpZmllcnMgPSB1bmRlZmluZWRcblxuICAvKipcbiAgICogUXVldWUgdGhpcyBqb2IgY2xhc3MgcnVucyBvbi4gU3ViY2xhc3NlcyBzZXQgZS5nLiBgc3RhdGljIHF1ZXVlID0gXCJidWlsZHNcImBcbiAgICogdG8gcm91dGUgb250byBhIHF1ZXVlIHdpdGggaXRzIG93biBjbHVzdGVyLXdpZGUgY29uY3VycmVuY3kgY2FwIChjb25maWd1cmVkXG4gICAqIHZpYSBgYmFja2dyb3VuZEpvYnMucXVldWVzYCkuIFRoZSBge3F1ZXVlfWAgZW5xdWV1ZSBvcHRpb24gb3ZlcnJpZGVzIGl0LlxuICAgKiBMZWZ0IHVuZGVmaW5lZCwgam9icyBydW4gb24gdGhlIGBcImRlZmF1bHRcImAgcXVldWUuXG4gICAqIEB0eXBlIHtzdHJpbmcgfCB1bmRlZmluZWR9XG4gICAqL1xuICBzdGF0aWMgcXVldWUgPSB1bmRlZmluZWRcblxuICAvKipcbiAgICogT3B0aW9uYWwgcHJvY2VzcyB0aXRsZSBzaG93biBmb3IgdGhlIHJ1bm5lciB3aGlsZSB0aGlzIGpvYiBleGVjdXRlcy5cbiAgICogVmVsb2Npb3VzIHNldHMgYHByb2Nlc3MudGl0bGVgIHRvIHRoaXMgZm9yIHRoZSBkdXJhdGlvbiBvZiB0aGUgam9iIOKAlCBzb1xuICAgKiBgcHNgL2B0b3BgL2BodG9wYCBpZGVudGlmeSB3aGF0IGEgcnVubmVyIGlzIGRvaW5nIOKAlCBhbmQgcmVzdG9yZXMgdGhlXG4gICAqIHJ1bm5lcidzIGJhc2UgdGl0bGUgd2hlbiB0aGUgam9iIGZpbmlzaGVzLiBMZWZ0IHVuZGVmaW5lZCwgdGhlIHJ1bm5lciBmYWxsc1xuICAgKiBiYWNrIHRvIGB2ZWxvY2lvdXMgam9iLXJ1bm5lcjogPEpvYk5hbWU+YC4gU2V0IGUuZy5cbiAgICogYHN0YXRpYyBwcm9jZXNzVGl0bGUgPSBcInZlbG9jaW91cyBtZWRpYSB0cmFuc2NvZGVyXCJgIHRvIGdpdmUgYSBqb2IgYVxuICAgKiBjdXN0b20sIGh1bWFuLXJlYWRhYmxlIHRpdGxlLlxuICAgKiBAdHlwZSB7c3RyaW5nIHwgdW5kZWZpbmVkfVxuICAgKi9cbiAgc3RhdGljIHByb2Nlc3NUaXRsZSA9IHVuZGVmaW5lZFxuXG4gIC8qKlxuICAgKiBTdG9wcyB0aGlzIHBlcmZvcm1hbmNlIGFuZCByZXNjaGVkdWxlcyB0aGUgc2FtZSBsb2dpY2FsIGpvYiByb3cuIFRoaXMgaXNcbiAgICogbm9ybWFsIGNvbnRyb2wgZmxvdzogaXQgZG9lcyBub3QgY291bnQgYXMgYSBmYWlsdXJlIG9yIGNvbnN1bWUgYSByZXRyeS5cbiAgICogQHBhcmFtIHtudW1iZXJ9IGRlbGF5TXMgLSBOb24tbmVnYXRpdmUgc2FmZS1pbnRlZ2VyIGRlbGF5IGluIG1pbGxpc2Vjb25kcy5cbiAgICogQHJldHVybnMge25ldmVyfSAtIFRoaXMgbWV0aG9kIG5ldmVyIHJldHVybnMuXG4gICAqL1xuICByZXNjaGVkdWxlSW4oZGVsYXlNcykge1xuICAgIGlmICghTnVtYmVyLmlzU2FmZUludGVnZXIoZGVsYXlNcykgfHwgZGVsYXlNcyA8IDApIHtcbiAgICAgIHRocm93IG5ldyBUeXBlRXJyb3IoXCJiYWNrZ3JvdW5kIGpvYiByZXNjaGVkdWxlIGRlbGF5TXMgbXVzdCBiZSBhIG5vbi1uZWdhdGl2ZSBzYWZlIGludGVnZXJcIilcbiAgICB9XG5cbiAgICB0aHJvdyBuZXcgQmFja2dyb3VuZEpvYlJlc2NoZWR1bGVTaWduYWwoZGVsYXlNcylcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGpvYiBuYW1lLlxuICAgKiBAcmV0dXJucyB7c3RyaW5nfSAtIEpvYiBuYW1lLlxuICAgKi9cbiAgc3RhdGljIGpvYk5hbWUoKSB7XG4gICAgcmV0dXJuIHRoaXMubmFtZVxuICB9XG5cbiAgLyoqXG4gICAqIEZvbGRzIHRoaXMgam9iIGNsYXNzJ3Mgc3RhdGljIGBxdWV1ZWAgaW50byB0aGUgZW5xdWV1ZSBvcHRpb25zIHVubGVzcyB0aGVcbiAgICogY2FsbGVyIGFscmVhZHkgc3BlY2lmaWVkIG9uZS5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL3R5cGVzLmpzXCIpLkJhY2tncm91bmRKb2JPcHRpb25zIHwgdW5kZWZpbmVkfSBvcHRpb25zIC0gSm9iIG9wdGlvbnMuXG4gICAqIEByZXR1cm5zIHtpbXBvcnQoXCIuL3R5cGVzLmpzXCIpLkJhY2tncm91bmRKb2JPcHRpb25zfSAtIE9wdGlvbnMgaW5jbHVkaW5nIHRoZSByZXNvbHZlZCBxdWV1ZS5cbiAgICovXG4gIHN0YXRpYyBfd2l0aFF1ZXVlKG9wdGlvbnMpIHtcbiAgICBjb25zdCBtZXJnZWQgPSBvcHRpb25zID8gey4uLm9wdGlvbnN9IDoge31cblxuICAgIGlmIChtZXJnZWQucXVldWUgPT09IHVuZGVmaW5lZCAmJiB0eXBlb2YgdGhpcy5xdWV1ZSA9PT0gXCJzdHJpbmdcIiAmJiB0aGlzLnF1ZXVlLmxlbmd0aCA+IDApIHtcbiAgICAgIG1lcmdlZC5xdWV1ZSA9IHRoaXMucXVldWVcbiAgICB9XG5cbiAgICByZXR1cm4gbWVyZ2VkXG4gIH1cblxuICAvKipcbiAgICogUmVzb2x2ZXMgY2xhc3MtZGVyaXZlZCBlbnF1ZXVlIG9wdGlvbnMgb24gYSBoeWRyYXRlZCBqb2IgaW5zdGFuY2UuIEV4cGxpY2l0XG4gICAqIHBlci1lbnF1ZXVlIG9wdGlvbnMgdGFrZSBwcmVjZWRlbmNlIG92ZXIgdGhlIGluc3RhbmNlIGNvbmN1cnJlbmN5IGtleS5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBKb2IgY29udGV4dC5cbiAgICogQHBhcmFtIHtBcnJheTxSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59IGFyZ3Muam9iQXJncyAtIEpvYiBhcmd1bWVudHMuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi90eXBlcy5qc1wiKS5CYWNrZ3JvdW5kSm9iT3B0aW9ucyB8IHVuZGVmaW5lZH0gYXJncy5qb2JPcHRpb25zIC0gSm9iIG9wdGlvbnMuXG4gICAqIEByZXR1cm5zIHtpbXBvcnQoXCIuL3R5cGVzLmpzXCIpLkJhY2tncm91bmRKb2JPcHRpb25zfSAtIFJlc29sdmVkIGpvYiBvcHRpb25zLlxuICAgKi9cbiAgc3RhdGljIF93aXRoSm9iQ29udGV4dCh7am9iQXJncywgam9iT3B0aW9uc30pIHtcbiAgICBjb25zdCBvcHRpb25zID0gdGhpcy5fd2l0aFF1ZXVlKGpvYk9wdGlvbnMpXG5cbiAgICBpZiAob3B0aW9ucy5jb25jdXJyZW5jeUtleSAhPT0gdW5kZWZpbmVkKSByZXR1cm4gb3B0aW9uc1xuXG4gICAgY29uc3Qgam9iSW5zdGFuY2UgPSBuZXcgdGhpcygpXG4gICAgam9iSW5zdGFuY2UuX3NldEJhY2tncm91bmRKb2JDb250ZXh0KHtcbiAgICAgIGFyZ3M6IGpvYkFyZ3MsXG4gICAgICBqb2JDbGFzczogdGhpcyxcbiAgICAgIGpvYk5hbWU6IHRoaXMuam9iTmFtZSgpLFxuICAgICAgb3B0aW9uc1xuICAgIH0pXG4gICAgY29uc3QgY29uY3VycmVuY3lLZXkgPSBqb2JJbnN0YW5jZS5jb25jdXJyZW5jeUtleSgpXG5cbiAgICBpZiAoY29uY3VycmVuY3lLZXkgIT09IHVuZGVmaW5lZCkgb3B0aW9ucy5jb25jdXJyZW5jeUtleSA9IGNvbmN1cnJlbmN5S2V5XG5cbiAgICByZXR1cm4gb3B0aW9uc1xuICB9XG5cbiAgLyoqXG4gICAqIFNldHMgdGhlIGNvbXBsZXRlIGNvbnRleHQgYXZhaWxhYmxlIHRvIHRoaXMgaHlkcmF0ZWQgam9iIGluc3RhbmNlLlxuICAgKiBGcmFtZXdvcmsgZW5xdWV1ZS9ydW5uZXIgYm91bmRhcmllcyBvd24gdGhpcyBtZXRob2QuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi90eXBlcy5qc1wiKS5CYWNrZ3JvdW5kSm9iQ29udGV4dH0gY29udGV4dCAtIEpvYiBjb250ZXh0LlxuICAgKiBAcmV0dXJucyB7dm9pZH1cbiAgICovXG4gIF9zZXRCYWNrZ3JvdW5kSm9iQ29udGV4dChjb250ZXh0KSB7XG4gICAgdGhpcy5fYmFja2dyb3VuZEpvYkNvbnRleHQgPSBjb250ZXh0XG4gIH1cblxuICAvKipcbiAgICogUmV0dXJucyB0aGlzIGh5ZHJhdGVkIGpvYidzIGNvbXBsZXRlIGVucXVldWUgb3IgcnVubmVyIGNvbnRleHQuXG4gICAqIEByZXR1cm5zIHtpbXBvcnQoXCIuL3R5cGVzLmpzXCIpLkJhY2tncm91bmRKb2JDb250ZXh0fSAtIEpvYiBjb250ZXh0LlxuICAgKi9cbiAgYmFja2dyb3VuZEpvYkNvbnRleHQoKSB7XG4gICAgaWYgKCF0aGlzLl9iYWNrZ3JvdW5kSm9iQ29udGV4dCkgdGhyb3cgbmV3IEVycm9yKFwiQmFja2dyb3VuZCBqb2IgY29udGV4dCBpcyBub3QgaHlkcmF0ZWRcIilcblxuICAgIHJldHVybiB0aGlzLl9iYWNrZ3JvdW5kSm9iQ29udGV4dFxuICB9XG5cbiAgLyoqXG4gICAqIE92ZXJyaWRlIHRvIGRlcml2ZSBhIGR1cmFibGUgY29uY3VycmVuY3kga2V5IGZyb20gYGJhY2tncm91bmRKb2JDb250ZXh0KClgLlxuICAgKiBQYWlyIHRoZSBkZXJpdmVkIGtleSB3aXRoIGBtYXhDb25jdXJyZW5jeWAgaW4gZW5xdWV1ZSBvcHRpb25zLiBBbiBleHBsaWNpdFxuICAgKiBwZXItZW5xdWV1ZSBgY29uY3VycmVuY3lLZXlgIHRha2VzIHByZWNlZGVuY2UgYW5kIHNraXBzIHRoaXMgbWV0aG9kLlxuICAgKiBAcmV0dXJucyB7c3RyaW5nIHwgdW5kZWZpbmVkfSAtIERlcml2ZWQgY29uY3VycmVuY3kga2V5LCBvciB1bmRlZmluZWQgZm9yIG5vbmUuXG4gICAqL1xuICBjb25jdXJyZW5jeUtleSgpIHtcbiAgICByZXR1cm4gdW5kZWZpbmVkXG4gIH1cblxuICAvKipcbiAgICogUnVucyBwZXJmb3JtIGxhdGVyLlxuICAgKiBAcGFyYW0gey4uLlJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSBhcmdzIC0gSm9iIGFyZ3MuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHN0cmluZz59IC0gSm9iIGlkLlxuICAgKi9cbiAgc3RhdGljIGFzeW5jIHBlcmZvcm1MYXRlciguLi5hcmdzKSB7XG4gICAgY29uc3Qge2pvYkFyZ3MsIGpvYk9wdGlvbnN9ID0gdGhpcy5fc3BsaXRBcmdzQW5kT3B0aW9ucyhhcmdzKVxuICAgIHJldHVybiBhd2FpdCBlbnF1ZXVlQmFja2dyb3VuZEpvYih7Sm9iQ2xhc3M6IHRoaXMsIGpvYkFyZ3MsIGpvYk9wdGlvbnN9KVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgcGVyZm9ybSBsYXRlciB3aXRoIG9wdGlvbnMuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gT3B0aW9ucy5cbiAgICogQHBhcmFtIHtBcnJheTxSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59IGFyZ3MuYXJncyAtIEpvYiBhcmdzLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vdHlwZXMuanNcIikuQmFja2dyb3VuZEpvYk9wdGlvbnN9IFthcmdzLm9wdGlvbnNdIC0gSm9iIG9wdGlvbnMuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHN0cmluZz59IC0gSm9iIGlkLlxuICAgKi9cbiAgc3RhdGljIGFzeW5jIHBlcmZvcm1MYXRlcldpdGhPcHRpb25zKHthcmdzLCBvcHRpb25zfSkge1xuICAgIHJldHVybiBhd2FpdCBlbnF1ZXVlQmFja2dyb3VuZEpvYih7Sm9iQ2xhc3M6IHRoaXMsIGpvYkFyZ3M6IGFyZ3MsIGpvYk9wdGlvbnM6IG9wdGlvbnN9KVxuICB9XG5cbiAgLyoqXG4gICAqIEF0b21pY2FsbHkgcmVwbGFjZXMgdGhpcyBqb2IgY2xhc3MncyBxdWV1ZWQgb3duZXIgZm9yIGEgc3RhYmxlIHNjaGVkdWxlIGtleS5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBPcHRpb25zLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gYXJncy5zY2hlZHVsZUtleSAtIFN0YWJsZSBsb2dpY2FsIHNjaGVkdWxlIGtleS5cbiAgICogQHBhcmFtIHtBcnJheTxSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59IGFyZ3MuYXJncyAtIEpvYiBhcmdzLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vdHlwZXMuanNcIikuQmFja2dyb3VuZEpvYk9wdGlvbnN9IFthcmdzLm9wdGlvbnNdIC0gSm9iIG9wdGlvbnMuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPGltcG9ydChcIi4vdHlwZXMuanNcIikuQmFja2dyb3VuZEpvYlJlcGxhY2VtZW50UmVzdWx0Pn0gLSBSZXBsYWNlbWVudCByZXN1bHQuXG4gICAqL1xuICBzdGF0aWMgYXN5bmMgcmVwbGFjZVNjaGVkdWxlZCh7c2NoZWR1bGVLZXksIGFyZ3MsIG9wdGlvbnN9KSB7XG4gICAgcmV0dXJuIGF3YWl0IHJlcGxhY2VTY2hlZHVsZWRCYWNrZ3JvdW5kSm9iKHtKb2JDbGFzczogdGhpcywgc2NoZWR1bGVLZXksIGpvYkFyZ3M6IGFyZ3MsIGpvYk9wdGlvbnM6IG9wdGlvbnN9KVxuICB9XG5cbiAgLyoqXG4gICAqIENhbmNlbHMgb3IgZGV0YWNoZXMgdGhlIGN1cnJlbnQgb3duZXIgb2YgYSBzdGFibGUgc2NoZWR1bGUga2V5LlxuICAgKiBAcGFyYW0ge3N0cmluZ30gc2NoZWR1bGVLZXkgLSBTdGFibGUgbG9naWNhbCBzY2hlZHVsZSBrZXkuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPGltcG9ydChcIi4vdHlwZXMuanNcIikuQmFja2dyb3VuZEpvYkNhbmNlbGxhdGlvblJlc3VsdD59IC0gQ2FuY2VsbGF0aW9uIHJlc3VsdC5cbiAgICovXG4gIHN0YXRpYyBhc3luYyBjYW5jZWxTY2hlZHVsZWQoc2NoZWR1bGVLZXkpIHtcbiAgICByZXR1cm4gYXdhaXQgY2FuY2VsU2NoZWR1bGVkQmFja2dyb3VuZEpvYihzY2hlZHVsZUtleSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHNwbGl0IGFyZ3MgYW5kIG9wdGlvbnMuXG4gICAqIEBwYXJhbSB7QXJyYXk8UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSBhcmdzIC0gSm9iIGFyZ3MuXG4gICAqIEByZXR1cm5zIHt7am9iQXJnczogQXJyYXk8UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+LCBqb2JPcHRpb25zOiBpbXBvcnQoXCIuL3R5cGVzLmpzXCIpLkJhY2tncm91bmRKb2JPcHRpb25zfX0gLSBTcGxpdCBhcmdzIGFuZCBvcHRpb25zLlxuICAgKi9cbiAgc3RhdGljIF9zcGxpdEFyZ3NBbmRPcHRpb25zKGFyZ3MpIHtcbiAgICBpZiAoYXJncy5sZW5ndGggPT09IDApIHtcbiAgICAgIHJldHVybiB7am9iQXJnczogW10sIGpvYk9wdGlvbnM6IHt9fVxuICAgIH1cblxuICAgIGNvbnN0IGxhc3RBcmcgPSBhcmdzW2FyZ3MubGVuZ3RoIC0gMV1cbiAgICBjb25zdCBpc09wdGlvbnNBcmcgPSBsYXN0QXJnICYmIHR5cGVvZiBsYXN0QXJnID09PSBcIm9iamVjdFwiICYmICFBcnJheS5pc0FycmF5KGxhc3RBcmcpICYmIFwiam9iT3B0aW9uc1wiIGluIGxhc3RBcmdcblxuICAgIGlmIChpc09wdGlvbnNBcmcpIHtcbiAgICAgIGNvbnN0IHtqb2JPcHRpb25zfSA9IC8qKiBAdHlwZSB7e2pvYk9wdGlvbnM6IGltcG9ydChcIi4vdHlwZXMuanNcIikuQmFja2dyb3VuZEpvYk9wdGlvbnN9fSAqLyAobGFzdEFyZylcbiAgICAgIHJldHVybiB7am9iQXJnczogYXJncy5zbGljZSgwLCAtMSksIGpvYk9wdGlvbnM6IGpvYk9wdGlvbnMgfHwge319XG4gICAgfVxuXG4gICAgcmV0dXJuIHtqb2JBcmdzOiBhcmdzLCBqb2JPcHRpb25zOiB7fX1cbiAgfVxuXG4gIC8qKlxuICAgKiBPdmVycmlkZSBpbiBzdWJjbGFzc2VzLlxuICAgKiBAcGFyYW0ge1RBcmdzfSBfYXJncyAtIEpvYiBhcmdzICh0aGUgdHVwbGUgdGhpcyBqb2IgY2xhc3Mgd2FzIHBhcmFtZXRlcml6ZWQgd2l0aCkuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIHdoZW4gY29tcGxldGUuXG4gICAqL1xuICBhc3luYyBwZXJmb3JtKC4uLl9hcmdzKSB7XG4gICAgdGhyb3cgbmV3IEVycm9yKFwicGVyZm9ybSBub3QgaW1wbGVtZW50ZWRcIilcbiAgfVxufVxuIl19