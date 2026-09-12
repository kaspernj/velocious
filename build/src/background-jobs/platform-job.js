// @ts-check
import BackgroundJobRescheduleSignal from "./reschedule-signal.js";
import { cancelScheduledBackgroundJob, enqueueBackgroundJob, getScheduledBackgroundJob, replaceScheduledBackgroundJob, wakeScheduledBackgroundJob } from "./runtime.js";
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
     * Reads current ownership and optional terminal history for a stable key.
     * @param {string} scheduleKey - Stable logical schedule key.
     * @param {{includeLatestTerminal?: boolean}} [options] - Lookup options.
     * @returns {Promise<import("./types.js").BackgroundJobScheduledLookupResult>} - Normalized stable schedule jobs.
     */
    static async getScheduledJob(scheduleKey, options = {}) {
        return await getScheduledBackgroundJob(scheduleKey, options);
    }
    /**
     * Expedites a future queued owner without creating another job.
     * @param {string} scheduleKey - Stable logical schedule key.
     * @returns {Promise<import("./types.js").BackgroundJobWakeResult>} - Wake result.
     */
    static async wakeScheduled(scheduleKey) {
        return await wakeScheduledBackgroundJob(scheduleKey);
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoicGxhdGZvcm0tam9iLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiLi4vLi4vLi4vc3JjL2JhY2tncm91bmQtam9icy9wbGF0Zm9ybS1qb2IuanMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6IkFBQUEsWUFBWTtBQUVaLE9BQU8sNkJBQTZCLE1BQU0sd0JBQXdCLENBQUE7QUFDbEUsT0FBTyxFQUNMLDRCQUE0QixFQUM1QixvQkFBb0IsRUFDcEIseUJBQXlCLEVBQ3pCLDZCQUE2QixFQUM3QiwwQkFBMEIsRUFDM0IsTUFBTSxjQUFjLENBQUE7QUFFckI7Ozs7Ozs7OztHQVNHO0FBQ0gsTUFBTSxDQUFDLE9BQU8sT0FBTyxZQUFZO0lBQy9CO1FBQ0Usb0VBQW9FO1FBQ3BFLElBQUksQ0FBQyxxQkFBcUIsR0FBRyxTQUFTLENBQUE7SUFDeEMsQ0FBQztJQUVEOzs7Ozs7T0FNRztJQUNILE1BQU0sQ0FBQyxtQkFBbUIsR0FBRyxTQUFTLENBQUE7SUFFdEM7Ozs7OztPQU1HO0lBQ0gsTUFBTSxDQUFDLEtBQUssR0FBRyxTQUFTLENBQUE7SUFFeEI7Ozs7Ozs7OztPQVNHO0lBQ0gsTUFBTSxDQUFDLFlBQVksR0FBRyxTQUFTLENBQUE7SUFFL0I7Ozs7O09BS0c7SUFDSCxZQUFZLENBQUMsT0FBTztRQUNsQixJQUFJLENBQUMsTUFBTSxDQUFDLGFBQWEsQ0FBQyxPQUFPLENBQUMsSUFBSSxPQUFPLEdBQUcsQ0FBQyxFQUFFLENBQUM7WUFDbEQsTUFBTSxJQUFJLFNBQVMsQ0FBQyx1RUFBdUUsQ0FBQyxDQUFBO1FBQzlGLENBQUM7UUFFRCxNQUFNLElBQUksNkJBQTZCLENBQUMsT0FBTyxDQUFDLENBQUE7SUFDbEQsQ0FBQztJQUVEOzs7T0FHRztJQUNILE1BQU0sQ0FBQyxPQUFPO1FBQ1osT0FBTyxJQUFJLENBQUMsSUFBSSxDQUFBO0lBQ2xCLENBQUM7SUFFRDs7Ozs7T0FLRztJQUNILE1BQU0sQ0FBQyxVQUFVLENBQUMsT0FBTztRQUN2QixNQUFNLE1BQU0s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RyxLQUFLO1FBQ3BCLE1BQU0sSUFBSSxLQUFLLENBQUMseUJBQXlCLENBQUMsQ0FBQTtJQUM1QyxDQUFDO0NBQ0YiLCJzb3VyY2VzQ29udGVudCI6WyIvLyBAdHMtY2hlY2tcblxuaW1wb3J0IEJhY2tncm91bmRKb2JSZXNjaGVkdWxlU2lnbmFsIGZyb20gXCIuL3Jlc2NoZWR1bGUtc2lnbmFsLmpzXCJcbmltcG9ydCB7XG4gIGNhbmNlbFNjaGVkdWxlZEJhY2tncm91bmRKb2IsXG4gIGVucXVldWVCYWNrZ3JvdW5kSm9iLFxuICBnZXRTY2hlZHVsZWRCYWNrZ3JvdW5kSm9iLFxuICByZXBsYWNlU2NoZWR1bGVkQmFja2dyb3VuZEpvYixcbiAgd2FrZVNjaGVkdWxlZEJhY2tncm91bmRKb2Jcbn0gZnJvbSBcIi4vcnVudGltZS5qc1wiXG5cbi8qKlxuICogQmFzZSBjbGFzcyBmb3IgYmFja2dyb3VuZCBqb2JzLlxuICpcbiAqIGBUQXJnc2AgaXMgdGhlIHR1cGxlIG9mIGFyZ3VtZW50cyB0aGUgc3ViY2xhc3MncyBgcGVyZm9ybWAgYWNjZXB0cywgc28gYSBqb2IgdGhhdFxuICogbmVlZHMgYXJndW1lbnRzIGRlY2xhcmVzIHRoZW0gYXMgcmVxdWlyZWQgYW5kIHR5cGVkIOKAlCBmb3IgZXhhbXBsZVxuICogYGNsYXNzIFJ1bkJ1aWxkSm9iIGV4dGVuZHMgVmVsb2Npb3VzSm9iPFtzdHJpbmddPmAgd2l0aCBgYXN5bmMgcGVyZm9ybShidWlsZElkKWAuXG4gKiBUaGUgZGVmYXVsdCBlbXB0eSB0dXBsZSBrZWVwcyBhcmd1bWVudC1sZXNzIGpvYnMgKGBleHRlbmRzIFZlbG9jaW91c0pvYmAsXG4gKiBgYXN5bmMgcGVyZm9ybSgpYCkgd29ya2luZyB1bmNoYW5nZWQuXG4gKiBAdGVtcGxhdGUge0FycmF5PFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gW1RBcmdzPVtdXVxuICovXG5leHBvcnQgZGVmYXVsdCBjbGFzcyBWZWxvY2lvdXNKb2Ige1xuICBjb25zdHJ1Y3RvcigpIHtcbiAgICAvKiogQHR5cGUge2ltcG9ydChcIi4vdHlwZXMuanNcIikuQmFja2dyb3VuZEpvYkNvbnRleHQgfCB1bmRlZmluZWR9ICovXG4gICAgdGhpcy5fYmFja2dyb3VuZEpvYkNvbnRleHQgPSB1bmRlZmluZWRcbiAgfVxuXG4gIC8qKlxuICAgKiBEYXRhYmFzZSBpZGVudGlmaWVycyBjaGVja2VkIG91dCB3aGlsZSB0aGlzIGpvYiBwZXJmb3Jtcy4gU2V0IGFuIGV4cGxpY2l0XG4gICAqIGxpc3QgdG8gYXZvaWQgaG9sZGluZyB1bnJlbGF0ZWQgY29uZmlndXJlZCBkYXRhYmFzZSBjb25uZWN0aW9ucywgb3IgYFtdYFxuICAgKiB3aGVuIHRoZSBqb2IgZXN0YWJsaXNoZXMgYW55IGNvbm5lY3Rpb25zIGl0IG5lZWRzIGl0c2VsZi4gTGVmdCB1bmRlZmluZWQsXG4gICAqIGpvYnMgcmV0YWluIHRoZSBleGlzdGluZyBiZWhhdmlvciBvZiBjaGVja2luZyBvdXQgZXZlcnkgYWN0aXZlIGRhdGFiYXNlLlxuICAgKiBAdHlwZSB7c3RyaW5nW10gfCB1bmRlZmluZWR9XG4gICAqL1xuICBzdGF0aWMgZGF0YWJhc2VJZGVudGlmaWVycyA9IHVuZGVmaW5lZFxuXG4gIC8qKlxuICAgKiBRdWV1ZSB0aGlzIGpvYiBjbGFzcyBydW5zIG9uLiBTdWJjbGFzc2VzIHNldCBlLmcuIGBzdGF0aWMgcXVldWUgPSBcImJ1aWxkc1wiYFxuICAgKiB0byByb3V0ZSBvbnRvIGEgcXVldWUgd2l0aCBpdHMgb3duIGNsdXN0ZXItd2lkZSBjb25jdXJyZW5jeSBjYXAgKGNvbmZpZ3VyZWRcbiAgICogdmlhIGBiYWNrZ3JvdW5kSm9icy5xdWV1ZXNgKS4gVGhlIGB7cXVldWV9YCBlbnF1ZXVlIG9wdGlvbiBvdmVycmlkZXMgaXQuXG4gICAqIExlZnQgdW5kZWZpbmVkLCBqb2JzIHJ1biBvbiB0aGUgYFwiZGVmYXVsdFwiYCBxdWV1ZS5cbiAgICogQHR5cGUge3N0cmluZyB8IHVuZGVmaW5lZH1cbiAgICovXG4gIHN0YXRpYyBxdWV1ZSA9IHVuZGVmaW5lZFxuXG4gIC8qKlxuICAgKiBPcHRpb25hbCBwcm9jZXNzIHRpdGxlIHNob3duIGZvciB0aGUgcnVubmVyIHdoaWxlIHRoaXMgam9iIGV4ZWN1dGVzLlxuICAgKiBWZWxvY2lvdXMgc2V0cyBgcHJvY2Vzcy50aXRsZWAgdG8gdGhpcyBmb3IgdGhlIGR1cmF0aW9uIG9mIHRoZSBqb2Ig4oCUIHNvXG4gICAqIGBwc2AvYHRvcGAvYGh0b3BgIGlkZW50aWZ5IHdoYXQgYSBydW5uZXIgaXMgZG9pbmcg4oCUIGFuZCByZXN0b3JlcyB0aGVcbiAgICogcnVubmVyJ3MgYmFzZSB0aXRsZSB3aGVuIHRoZSBqb2IgZmluaXNoZXMuIExlZnQgdW5kZWZpbmVkLCB0aGUgcnVubmVyIGZhbGxzXG4gICAqIGJhY2sgdG8gYHZlbG9jaW91cyBqb2ItcnVubmVyOiA8Sm9iTmFtZT5gLiBTZXQgZS5nLlxuICAgKiBgc3RhdGljIHByb2Nlc3NUaXRsZSA9IFwidmVsb2Npb3VzIG1lZGlhIHRyYW5zY29kZXJcImAgdG8gZ2l2ZSBhIGpvYiBhXG4gICAqIGN1c3RvbSwgaHVtYW4tcmVhZGFibGUgdGl0bGUuXG4gICAqIEB0eXBlIHtzdHJpbmcgfCB1bmRlZmluZWR9XG4gICAqL1xuICBzdGF0aWMgcHJvY2Vzc1RpdGxlID0gdW5kZWZpbmVkXG5cbiAgLyoqXG4gICAqIFN0b3BzIHRoaXMgcGVyZm9ybWFuY2UgYW5kIHJlc2NoZWR1bGVzIHRoZSBzYW1lIGxvZ2ljYWwgam9iIHJvdy4gVGhpcyBpc1xuICAgKiBub3JtYWwgY29udHJvbCBmbG93OiBpdCBkb2VzIG5vdCBjb3VudCBhcyBhIGZhaWx1cmUgb3IgY29uc3VtZSBhIHJldHJ5LlxuICAgKiBAcGFyYW0ge251bWJlcn0gZGVsYXlNcyAtIE5vbi1uZWdhdGl2ZSBzYWZlLWludGVnZXIgZGVsYXkgaW4gbWlsbGlzZWNvbmRzLlxuICAgKiBAcmV0dXJucyB7bmV2ZXJ9IC0gVGhpcyBtZXRob2QgbmV2ZXIgcmV0dXJucy5cbiAgICovXG4gIHJlc2NoZWR1bGVJbihkZWxheU1zKSB7XG4gICAgaWYgKCFOdW1iZXIuaXNTYWZlSW50ZWdlcihkZWxheU1zKSB8fCBkZWxheU1zIDwgMCkge1xuICAgICAgdGhyb3cgbmV3IFR5cGVFcnJvcihcImJhY2tncm91bmQgam9iIHJlc2NoZWR1bGUgZGVsYXlNcyBtdXN0IGJlIGEgbm9uLW5lZ2F0aXZlIHNhZmUgaW50ZWdlclwiKVxuICAgIH1cblxuICAgIHRocm93IG5ldyBCYWNrZ3JvdW5kSm9iUmVzY2hlZHVsZVNpZ25hbChkZWxheU1zKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgam9iIG5hbWUuXG4gICAqIEByZXR1cm5zIHtzdHJpbmd9IC0gSm9iIG5hbWUuXG4gICAqL1xuICBzdGF0aWMgam9iTmFtZSgpIHtcbiAgICByZXR1cm4gdGhpcy5uYW1lXG4gIH1cblxuICAvKipcbiAgICogRm9sZHMgdGhpcyBqb2IgY2xhc3MncyBzdGF0aWMgYHF1ZXVlYCBpbnRvIHRoZSBlbnF1ZXVlIG9wdGlvbnMgdW5sZXNzIHRoZVxuICAgKiBjYWxsZXIgYWxyZWFkeSBzcGVjaWZpZWQgb25lLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vdHlwZXMuanNcIikuQmFja2dyb3VuZEpvYk9wdGlvbnMgfCB1bmRlZmluZWR9IG9wdGlvbnMgLSBKb2Igb3B0aW9ucy5cbiAgICogQHJldHVybnMge2ltcG9ydChcIi4vdHlwZXMuanNcIikuQmFja2dyb3VuZEpvYk9wdGlvbnN9IC0gT3B0aW9ucyBpbmNsdWRpbmcgdGhlIHJlc29sdmVkIHF1ZXVlLlxuICAgKi9cbiAgc3RhdGljIF93aXRoUXVldWUob3B0aW9ucykge1xuICAgIGNvbnN0IG1lcmdlZCA9IG9wdGlvbnMgPyB7Li4ub3B0aW9uc30gOiB7fVxuXG4gICAgaWYgKG1lcmdlZC5xdWV1ZSA9PT0gdW5kZWZpbmVkICYmIHR5cGVvZiB0aGlzLnF1ZXVlID09PSBcInN0cmluZ1wiICYmIHRoaXMucXVldWUubGVuZ3RoID4gMCkge1xuICAgICAgbWVyZ2VkLnF1ZXVlID0gdGhpcy5xdWV1ZVxuICAgIH1cblxuICAgIHJldHVybiBtZXJnZWRcbiAgfVxuXG4gIC8qKlxuICAgKiBSZXNvbHZlcyBjbGFzcy1kZXJpdmVkIGVucXVldWUgb3B0aW9ucyBvbiBhIGh5ZHJhdGVkIGpvYiBpbnN0YW5jZS4gRXhwbGljaXRcbiAgICogcGVyLWVucXVldWUgb3B0aW9ucyB0YWtlIHByZWNlZGVuY2Ugb3ZlciB0aGUgaW5zdGFuY2UgY29uY3VycmVuY3kga2V5LlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIEpvYiBjb250ZXh0LlxuICAgKiBAcGFyYW0ge0FycmF5PFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gYXJncy5qb2JBcmdzIC0gSm9iIGFyZ3VtZW50cy5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL3R5cGVzLmpzXCIpLkJhY2tncm91bmRKb2JPcHRpb25zIHwgdW5kZWZpbmVkfSBhcmdzLmpvYk9wdGlvbnMgLSBKb2Igb3B0aW9ucy5cbiAgICogQHJldHVybnMge2ltcG9ydChcIi4vdHlwZXMuanNcIikuQmFja2dyb3VuZEpvYk9wdGlvbnN9IC0gUmVzb2x2ZWQgam9iIG9wdGlvbnMuXG4gICAqL1xuICBzdGF0aWMgX3dpdGhKb2JDb250ZXh0KHtqb2JBcmdzLCBqb2JPcHRpb25zfSkge1xuICAgIGNvbnN0IG9wdGlvbnMgPSB0aGlzLl93aXRoUXVldWUoam9iT3B0aW9ucylcblxuICAgIGlmIChvcHRpb25zLmNvbmN1cnJlbmN5S2V5ICE9PSB1bmRlZmluZWQpIHJldHVybiBvcHRpb25zXG5cbiAgICBjb25zdCBqb2JJbnN0YW5jZSA9IG5ldyB0aGlzKClcbiAgICBqb2JJbnN0YW5jZS5fc2V0QmFja2dyb3VuZEpvYkNvbnRleHQoe1xuICAgICAgYXJnczogam9iQXJncyxcbiAgICAgIGpvYkNsYXNzOiB0aGlzLFxuICAgICAgam9iTmFtZTogdGhpcy5qb2JOYW1lKCksXG4gICAgICBvcHRpb25zXG4gICAgfSlcbiAgICBjb25zdCBjb25jdXJyZW5jeUtleSA9IGpvYkluc3RhbmNlLmNvbmN1cnJlbmN5S2V5KClcblxuICAgIGlmIChjb25jdXJyZW5jeUtleSAhPT0gdW5kZWZpbmVkKSBvcHRpb25zLmNvbmN1cnJlbmN5S2V5ID0gY29uY3VycmVuY3lLZXlcblxuICAgIHJldHVybiBvcHRpb25zXG4gIH1cblxuICAvKipcbiAgICogU2V0cyB0aGUgY29tcGxldGUgY29udGV4dCBhdmFpbGFibGUgdG8gdGhpcyBoeWRyYXRlZCBqb2IgaW5zdGFuY2UuXG4gICAqIEZyYW1ld29yayBlbnF1ZXVlL3J1bm5lciBib3VuZGFyaWVzIG93biB0aGlzIG1ldGhvZC5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL3R5cGVzLmpzXCIpLkJhY2tncm91bmRKb2JDb250ZXh0fSBjb250ZXh0IC0gSm9iIGNvbnRleHQuXG4gICAqIEByZXR1cm5zIHt2b2lkfVxuICAgKi9cbiAgX3NldEJhY2tncm91bmRKb2JDb250ZXh0KGNvbnRleHQpIHtcbiAgICB0aGlzLl9iYWNrZ3JvdW5kSm9iQ29udGV4dCA9IGNvbnRleHRcbiAgfVxuXG4gIC8qKlxuICAgKiBSZXR1cm5zIHRoaXMgaHlkcmF0ZWQgam9iJ3MgY29tcGxldGUgZW5xdWV1ZSBvciBydW5uZXIgY29udGV4dC5cbiAgICogQHJldHVybnMge2ltcG9ydChcIi4vdHlwZXMuanNcIikuQmFja2dyb3VuZEpvYkNvbnRleHR9IC0gSm9iIGNvbnRleHQuXG4gICAqL1xuICBiYWNrZ3JvdW5kSm9iQ29udGV4dCgpIHtcbiAgICBpZiAoIXRoaXMuX2JhY2tncm91bmRKb2JDb250ZXh0KSB0aHJvdyBuZXcgRXJyb3IoXCJCYWNrZ3JvdW5kIGpvYiBjb250ZXh0IGlzIG5vdCBoeWRyYXRlZFwiKVxuXG4gICAgcmV0dXJuIHRoaXMuX2JhY2tncm91bmRKb2JDb250ZXh0XG4gIH1cblxuICAvKipcbiAgICogT3ZlcnJpZGUgdG8gZGVyaXZlIGEgZHVyYWJsZSBjb25jdXJyZW5jeSBrZXkgZnJvbSBgYmFja2dyb3VuZEpvYkNvbnRleHQoKWAuXG4gICAqIFBhaXIgdGhlIGRlcml2ZWQga2V5IHdpdGggYG1heENvbmN1cnJlbmN5YCBpbiBlbnF1ZXVlIG9wdGlvbnMuIEFuIGV4cGxpY2l0XG4gICAqIHBlci1lbnF1ZXVlIGBjb25jdXJyZW5jeUtleWAgdGFrZXMgcHJlY2VkZW5jZSBhbmQgc2tpcHMgdGhpcyBtZXRob2QuXG4gICAqIEByZXR1cm5zIHtzdHJpbmcgfCB1bmRlZmluZWR9IC0gRGVyaXZlZCBjb25jdXJyZW5jeSBrZXksIG9yIHVuZGVmaW5lZCBmb3Igbm9uZS5cbiAgICovXG4gIGNvbmN1cnJlbmN5S2V5KCkge1xuICAgIHJldHVybiB1bmRlZmluZWRcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHBlcmZvcm0gbGF0ZXIuXG4gICAqIEBwYXJhbSB7Li4uUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59IGFyZ3MgLSBKb2IgYXJncy5cbiAgICogQHJldHVybnMge1Byb21pc2U8c3RyaW5nPn0gLSBKb2IgaWQuXG4gICAqL1xuICBzdGF0aWMgYXN5bmMgcGVyZm9ybUxhdGVyKC4uLmFyZ3MpIHtcbiAgICBjb25zdCB7am9iQXJncywgam9iT3B0aW9uc30gPSB0aGlzLl9zcGxpdEFyZ3NBbmRPcHRpb25zKGFyZ3MpXG4gICAgcmV0dXJuIGF3YWl0IGVucXVldWVCYWNrZ3JvdW5kSm9iKHtKb2JDbGFzczogdGhpcywgam9iQXJncywgam9iT3B0aW9uc30pXG4gIH1cblxuICAvKipcbiAgICogUnVucyBwZXJmb3JtIGxhdGVyIHdpdGggb3B0aW9ucy5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBPcHRpb25zLlxuICAgKiBAcGFyYW0ge0FycmF5PFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gYXJncy5hcmdzIC0gSm9iIGFyZ3MuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi90eXBlcy5qc1wiKS5CYWNrZ3JvdW5kSm9iT3B0aW9uc30gW2FyZ3Mub3B0aW9uc10gLSBKb2Igb3B0aW9ucy5cbiAgICogQHJldHVybnMge1Byb21pc2U8c3RyaW5nPn0gLSBKb2IgaWQuXG4gICAqL1xuICBzdGF0aWMgYXN5bmMgcGVyZm9ybUxhdGVyV2l0aE9wdGlvbnMoe2FyZ3MsIG9wdGlvbnN9KSB7XG4gICAgcmV0dXJuIGF3YWl0IGVucXVldWVCYWNrZ3JvdW5kSm9iKHtKb2JDbGFzczogdGhpcywgam9iQXJnczogYXJncywgam9iT3B0aW9uczogb3B0aW9uc30pXG4gIH1cblxuICAvKipcbiAgICogQXRvbWljYWxseSByZXBsYWNlcyB0aGlzIGpvYiBjbGFzcydzIHF1ZXVlZCBvd25lciBmb3IgYSBzdGFibGUgc2NoZWR1bGUga2V5LlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIE9wdGlvbnMuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBhcmdzLnNjaGVkdWxlS2V5IC0gU3RhYmxlIGxvZ2ljYWwgc2NoZWR1bGUga2V5LlxuICAgKiBAcGFyYW0ge0FycmF5PFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gYXJncy5hcmdzIC0gSm9iIGFyZ3MuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi90eXBlcy5qc1wiKS5CYWNrZ3JvdW5kSm9iT3B0aW9uc30gW2FyZ3Mub3B0aW9uc10gLSBKb2Igb3B0aW9ucy5cbiAgICogQHJldHVybnMge1Byb21pc2U8aW1wb3J0KFwiLi90eXBlcy5qc1wiKS5CYWNrZ3JvdW5kSm9iUmVwbGFjZW1lbnRSZXN1bHQ+fSAtIFJlcGxhY2VtZW50IHJlc3VsdC5cbiAgICovXG4gIHN0YXRpYyBhc3luYyByZXBsYWNlU2NoZWR1bGVkKHtzY2hlZHVsZUtleSwgYXJncywgb3B0aW9uc30pIHtcbiAgICByZXR1cm4gYXdhaXQgcmVwbGFjZVNjaGVkdWxlZEJhY2tncm91bmRKb2Ioe0pvYkNsYXNzOiB0aGlzLCBzY2hlZHVsZUtleSwgam9iQXJnczogYXJncywgam9iT3B0aW9uczogb3B0aW9uc30pXG4gIH1cblxuICAvKipcbiAgICogQ2FuY2VscyBvciBkZXRhY2hlcyB0aGUgY3VycmVudCBvd25lciBvZiBhIHN0YWJsZSBzY2hlZHVsZSBrZXkuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBzY2hlZHVsZUtleSAtIFN0YWJsZSBsb2dpY2FsIHNjaGVkdWxlIGtleS5cbiAgICogQHJldHVybnMge1Byb21pc2U8aW1wb3J0KFwiLi90eXBlcy5qc1wiKS5CYWNrZ3JvdW5kSm9iQ2FuY2VsbGF0aW9uUmVzdWx0Pn0gLSBDYW5jZWxsYXRpb24gcmVzdWx0LlxuICAgKi9cbiAgc3RhdGljIGFzeW5jIGNhbmNlbFNjaGVkdWxlZChzY2hlZHVsZUtleSkge1xuICAgIHJldHVybiBhd2FpdCBjYW5jZWxTY2hlZHVsZWRCYWNrZ3JvdW5kSm9iKHNjaGVkdWxlS2V5KVxuICB9XG5cbiAgLyoqXG4gICAqIFJlYWRzIGN1cnJlbnQgb3duZXJzaGlwIGFuZCBvcHRpb25hbCB0ZXJtaW5hbCBoaXN0b3J5IGZvciBhIHN0YWJsZSBrZXkuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBzY2hlZHVsZUtleSAtIFN0YWJsZSBsb2dpY2FsIHNjaGVkdWxlIGtleS5cbiAgICogQHBhcmFtIHt7aW5jbHVkZUxhdGVzdFRlcm1pbmFsPzogYm9vbGVhbn19IFtvcHRpb25zXSAtIExvb2t1cCBvcHRpb25zLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxpbXBvcnQoXCIuL3R5cGVzLmpzXCIpLkJhY2tncm91bmRKb2JTY2hlZHVsZWRMb29rdXBSZXN1bHQ+fSAtIE5vcm1hbGl6ZWQgc3RhYmxlIHNjaGVkdWxlIGpvYnMuXG4gICAqL1xuICBzdGF0aWMgYXN5bmMgZ2V0U2NoZWR1bGVkSm9iKHNjaGVkdWxlS2V5LCBvcHRpb25zID0ge30pIHtcbiAgICByZXR1cm4gYXdhaXQgZ2V0U2NoZWR1bGVkQmFja2dyb3VuZEpvYihzY2hlZHVsZUtleSwgb3B0aW9ucylcbiAgfVxuXG4gIC8qKlxuICAgKiBFeHBlZGl0ZXMgYSBmdXR1cmUgcXVldWVkIG93bmVyIHdpdGhvdXQgY3JlYXRpbmcgYW5vdGhlciBqb2IuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBzY2hlZHVsZUtleSAtIFN0YWJsZSBsb2dpY2FsIHNjaGVkdWxlIGtleS5cbiAgICogQHJldHVybnMge1Byb21pc2U8aW1wb3J0KFwiLi90eXBlcy5qc1wiKS5CYWNrZ3JvdW5kSm9iV2FrZVJlc3VsdD59IC0gV2FrZSByZXN1bHQuXG4gICAqL1xuICBzdGF0aWMgYXN5bmMgd2FrZVNjaGVkdWxlZChzY2hlZHVsZUtleSkge1xuICAgIHJldHVybiBhd2FpdCB3YWtlU2NoZWR1bGVkQmFja2dyb3VuZEpvYihzY2hlZHVsZUtleSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHNwbGl0IGFyZ3MgYW5kIG9wdGlvbnMuXG4gICAqIEBwYXJhbSB7QXJyYXk8UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSBhcmdzIC0gSm9iIGFyZ3MuXG4gICAqIEByZXR1cm5zIHt7am9iQXJnczogQXJyYXk8UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+LCBqb2JPcHRpb25zOiBpbXBvcnQoXCIuL3R5cGVzLmpzXCIpLkJhY2tncm91bmRKb2JPcHRpb25zfX0gLSBTcGxpdCBhcmdzIGFuZCBvcHRpb25zLlxuICAgKi9cbiAgc3RhdGljIF9zcGxpdEFyZ3NBbmRPcHRpb25zKGFyZ3MpIHtcbiAgICBpZiAoYXJncy5sZW5ndGggPT09IDApIHtcbiAgICAgIHJldHVybiB7am9iQXJnczogW10sIGpvYk9wdGlvbnM6IHt9fVxuICAgIH1cblxuICAgIGNvbnN0IGxhc3RBcmcgPSBhcmdzW2FyZ3MubGVuZ3RoIC0gMV1cbiAgICBjb25zdCBpc09wdGlvbnNBcmcgPSBsYXN0QXJnICYmIHR5cGVvZiBsYXN0QXJnID09PSBcIm9iamVjdFwiICYmICFBcnJheS5pc0FycmF5KGxhc3RBcmcpICYmIFwiam9iT3B0aW9uc1wiIGluIGxhc3RBcmdcblxuICAgIGlmIChpc09wdGlvbnNBcmcpIHtcbiAgICAgIGNvbnN0IHtqb2JPcHRpb25zfSA9IC8qKiBAdHlwZSB7e2pvYk9wdGlvbnM6IGltcG9ydChcIi4vdHlwZXMuanNcIikuQmFja2dyb3VuZEpvYk9wdGlvbnN9fSAqLyAobGFzdEFyZylcbiAgICAgIHJldHVybiB7am9iQXJnczogYXJncy5zbGljZSgwLCAtMSksIGpvYk9wdGlvbnM6IGpvYk9wdGlvbnMgfHwge319XG4gICAgfVxuXG4gICAgcmV0dXJuIHtqb2JBcmdzOiBhcmdzLCBqb2JPcHRpb25zOiB7fX1cbiAgfVxuXG4gIC8qKlxuICAgKiBPdmVycmlkZSBpbiBzdWJjbGFzc2VzLlxuICAgKiBAcGFyYW0ge1RBcmdzfSBfYXJncyAtIEpvYiBhcmdzICh0aGUgdHVwbGUgdGhpcyBqb2IgY2xhc3Mgd2FzIHBhcmFtZXRlcml6ZWQgd2l0aCkuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIHdoZW4gY29tcGxldGUuXG4gICAqL1xuICBhc3luYyBwZXJmb3JtKC4uLl9hcmdzKSB7XG4gICAgdGhyb3cgbmV3IEVycm9yKFwicGVyZm9ybSBub3QgaW1wbGVtZW50ZWRcIilcbiAgfVxufVxuIl19