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
     * Wall-clock bound this job class runs under, in ms. Set e.g.
     * `static timeoutMs = 60 * 60 * 1000` on a job whose work legitimately takes
     * hours so its type carries its own bound instead of relying on one global
     * `backgroundJobs.jobTimeoutMs` tuned for the slowest job in the system. The
     * `{timeoutMs}` enqueue option overrides it. A non-positive value disables the
     * bound for this class. Left undefined, the worker-level value applies.
     * @type {number | undefined}
     */
    static timeoutMs = undefined;
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
     * Folds this job class's static `timeoutMs` into the enqueue options unless the
     * caller already specified one, so a job type carries its own wall-clock bound
     * instead of every job sharing one worker-level value. A class that declares
     * nothing leaves the option absent, and the worker falls back to its own
     * default — the prior behavior.
     * @param {import("./types.js").BackgroundJobOptions | undefined} options - Job options.
     * @returns {import("./types.js").BackgroundJobOptions} - Options including the resolved timeout.
     */
    static _withTimeout(options) {
        const merged = options ? { ...options } : {};
        if (merged.timeoutMs === undefined && typeof this.timeoutMs === "number") {
            merged.timeoutMs = this.timeoutMs;
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
        const options = this._withTimeout(this._withQueue(jobOptions));
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoicGxhdGZvcm0tam9iLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiLi4vLi4vLi4vc3JjL2JhY2tncm91bmQtam9icy9wbGF0Zm9ybS1qb2IuanMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6IkFBQUEsWUFBWTtBQUVaLE9BQU8sNkJBQTZCLE1BQU0sd0JBQXdCLENBQUE7QUFDbEUsT0FBTyxFQUNMLDRCQUE0QixFQUM1QixvQkFBb0IsRUFDcEIseUJBQXlCLEVBQ3pCLDZCQUE2QixFQUM3QiwwQkFBMEIsRUFDM0IsTUFBTSxjQUFjLENBQUE7QUFFckI7Ozs7Ozs7OztHQVNHO0FBQ0gsTUFBTSxDQUFDLE9BQU8sT0FBTyxZQUFZO0lBQy9CO1FBQ0Usb0VBQW9FO1FBQ3BFLElBQUksQ0FBQyxxQkFBcUIsR0FBRyxTQUFTLENBQUE7SUFDeEMsQ0FBQztJQUVEOzs7Ozs7T0FNRztJQUNILE1BQU0sQ0FBQyxtQkFBbUIsR0FBRyxTQUFTLENBQUE7SUFFdEM7Ozs7OztPQU1HO0lBQ0gsTUFBTSxDQUFDLEtBQUssR0FBRyxTQUFTLENBQUE7SUFFeEI7Ozs7Ozs7OztPQVNHO0lBQ0gsTUFBTSxDQUFDLFlBQVksR0FBRyxTQUFTLENBQUE7SUFFL0I7Ozs7Ozs7O09BUUc7SUFDSCxNQUFNLENBQUMsU0FBUyxHQUFHLFNBQVMsQ0FBQTtJQUU1Qjs7Ozs7T0FLRztJQUNILFlBQVksQ0FBQyxPQUFPO1FBQ2xCLElBQUksQ0FBQyxNQUFNLENBQUMsYUFBYSxDQUFDLE9BQU8sQ0FBQyxJQUFJLE9BQU8sR0FBRyxDQUFDLEVBQUUsQ0FBQztZQUNsRCxNQUFNLElBQUksU0FBUyxDQUFDLHVFQUF1RSxDQUFDLENBQUE7UUFDOUYsQ0FBQztRQUVELE1BQU0sSUFBSSw2QkFBNkIsQ0FBQyxPQUFPLENBQUMsQ0FBQTtJQUNsRCxDQUFDO0lBRUQ7OztPQUdHO0lBQ0gsTUFBTSxDQUFDLE9BQU87UUFDWixPQUFPLElBQUksQ0FBQyxJQUFJLENBQUE7SUFDbEIsQ0FBQztJQUVEOzs7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LEtBQUssQ0FBQyxPQUFPLENBQUMsT0FBTyxDQUFDLElBQUksWUFBWSxJQUFJLE9BQU8sQ0FBQTtRQUVqSCxJQUFJLFlBQVksRUFBRSxDQUFDO1lBQ2pCLE1BQU0sRUFBQyxVQUFVLEVBQUMsR0FBRyxzRUFBc0UsQ0FBQyxDQUFDLE9BQU8sQ0FBQyxDQUFBO1lBQ3JHLE9BQU8sRUFBQyxPQUFPLEVBQUUsSUFBSSxDQUFDLEtBQUssQ0FBQyxDQUFDLEVBQUUsQ0FBQyxDQUFDLENBQUMsRUFBRSxVQUFVLEVBQUUsVUFBVSxJQUFJLEVBQUUsRUFBQyxDQUFBO1FBQ25FLENBQUM7UUFFRCxPQUFPLEVBQUMsT0FBTyxFQUFFLElBQUksRUFBRSxVQUFVLEVBQUUsRUFBRSxFQUFDLENBQUE7SUFDeEMsQ0FBQztJQUVEOzs7O09BSUc7SUFDSCxLQUFLLENBQUMsT0FBTyxDQUFDLEdBQUcsS0FBSztRQUNwQixNQUFNLElBQUksS0FBSyxDQUFDLHlCQUF5QixDQUFDLENBQUE7SUFDNUMsQ0FBQztDQUNGIiwic291cmNlc0NvbnRlbnQiOlsiLy8gQHRzLWNoZWNrXG5cbmltcG9ydCBCYWNrZ3JvdW5kSm9iUmVzY2hlZHVsZVNpZ25hbCBmcm9tIFwiLi9yZXNjaGVkdWxlLXNpZ25hbC5qc1wiXG5pbXBvcnQge1xuICBjYW5jZWxTY2hlZHVsZWRCYWNrZ3JvdW5kSm9iLFxuICBlbnF1ZXVlQmFja2dyb3VuZEpvYixcbiAgZ2V0U2NoZWR1bGVkQmFja2dyb3VuZEpvYixcbiAgcmVwbGFjZVNjaGVkdWxlZEJhY2tncm91bmRKb2IsXG4gIHdha2VTY2hlZHVsZWRCYWNrZ3JvdW5kSm9iXG59IGZyb20gXCIuL3J1bnRpbWUuanNcIlxuXG4vKipcbiAqIEJhc2UgY2xhc3MgZm9yIGJhY2tncm91bmQgam9icy5cbiAqXG4gKiBgVEFyZ3NgIGlzIHRoZSB0dXBsZSBvZiBhcmd1bWVudHMgdGhlIHN1YmNsYXNzJ3MgYHBlcmZvcm1gIGFjY2VwdHMsIHNvIGEgam9iIHRoYXRcbiAqIG5lZWRzIGFyZ3VtZW50cyBkZWNsYXJlcyB0aGVtIGFzIHJlcXVpcmVkIGFuZCB0eXBlZCDigJQgZm9yIGV4YW1wbGVcbiAqIGBjbGFzcyBSdW5CdWlsZEpvYiBleHRlbmRzIFZlbG9jaW91c0pvYjxbc3RyaW5nXT5gIHdpdGggYGFzeW5jIHBlcmZvcm0oYnVpbGRJZClgLlxuICogVGhlIGRlZmF1bHQgZW1wdHkgdHVwbGUga2VlcHMgYXJndW1lbnQtbGVzcyBqb2JzIChgZXh0ZW5kcyBWZWxvY2lvdXNKb2JgLFxuICogYGFzeW5jIHBlcmZvcm0oKWApIHdvcmtpbmcgdW5jaGFuZ2VkLlxuICogQHRlbXBsYXRlIHtBcnJheTxSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59IFtUQXJncz1bXV1cbiAqL1xuZXhwb3J0IGRlZmF1bHQgY2xhc3MgVmVsb2Npb3VzSm9iIHtcbiAgY29uc3RydWN0b3IoKSB7XG4gICAgLyoqIEB0eXBlIHtpbXBvcnQoXCIuL3R5cGVzLmpzXCIpLkJhY2tncm91bmRKb2JDb250ZXh0IHwgdW5kZWZpbmVkfSAqL1xuICAgIHRoaXMuX2JhY2tncm91bmRKb2JDb250ZXh0ID0gdW5kZWZpbmVkXG4gIH1cblxuICAvKipcbiAgICogRGF0YWJhc2UgaWRlbnRpZmllcnMgY2hlY2tlZCBvdXQgd2hpbGUgdGhpcyBqb2IgcGVyZm9ybXMuIFNldCBhbiBleHBsaWNpdFxuICAgKiBsaXN0IHRvIGF2b2lkIGhvbGRpbmcgdW5yZWxhdGVkIGNvbmZpZ3VyZWQgZGF0YWJhc2UgY29ubmVjdGlvbnMsIG9yIGBbXWBcbiAgICogd2hlbiB0aGUgam9iIGVzdGFibGlzaGVzIGFueSBjb25uZWN0aW9ucyBpdCBuZWVkcyBpdHNlbGYuIExlZnQgdW5kZWZpbmVkLFxuICAgKiBqb2JzIHJldGFpbiB0aGUgZXhpc3RpbmcgYmVoYXZpb3Igb2YgY2hlY2tpbmcgb3V0IGV2ZXJ5IGFjdGl2ZSBkYXRhYmFzZS5cbiAgICogQHR5cGUge3N0cmluZ1tdIHwgdW5kZWZpbmVkfVxuICAgKi9cbiAgc3RhdGljIGRhdGFiYXNlSWRlbnRpZmllcnMgPSB1bmRlZmluZWRcblxuICAvKipcbiAgICogUXVldWUgdGhpcyBqb2IgY2xhc3MgcnVucyBvbi4gU3ViY2xhc3NlcyBzZXQgZS5nLiBgc3RhdGljIHF1ZXVlID0gXCJidWlsZHNcImBcbiAgICogdG8gcm91dGUgb250byBhIHF1ZXVlIHdpdGggaXRzIG93biBjbHVzdGVyLXdpZGUgY29uY3VycmVuY3kgY2FwIChjb25maWd1cmVkXG4gICAqIHZpYSBgYmFja2dyb3VuZEpvYnMucXVldWVzYCkuIFRoZSBge3F1ZXVlfWAgZW5xdWV1ZSBvcHRpb24gb3ZlcnJpZGVzIGl0LlxuICAgKiBMZWZ0IHVuZGVmaW5lZCwgam9icyBydW4gb24gdGhlIGBcImRlZmF1bHRcImAgcXVldWUuXG4gICAqIEB0eXBlIHtzdHJpbmcgfCB1bmRlZmluZWR9XG4gICAqL1xuICBzdGF0aWMgcXVldWUgPSB1bmRlZmluZWRcblxuICAvKipcbiAgICogT3B0aW9uYWwgcHJvY2VzcyB0aXRsZSBzaG93biBmb3IgdGhlIHJ1bm5lciB3aGlsZSB0aGlzIGpvYiBleGVjdXRlcy5cbiAgICogVmVsb2Npb3VzIHNldHMgYHByb2Nlc3MudGl0bGVgIHRvIHRoaXMgZm9yIHRoZSBkdXJhdGlvbiBvZiB0aGUgam9iIOKAlCBzb1xuICAgKiBgcHNgL2B0b3BgL2BodG9wYCBpZGVudGlmeSB3aGF0IGEgcnVubmVyIGlzIGRvaW5nIOKAlCBhbmQgcmVzdG9yZXMgdGhlXG4gICAqIHJ1bm5lcidzIGJhc2UgdGl0bGUgd2hlbiB0aGUgam9iIGZpbmlzaGVzLiBMZWZ0IHVuZGVmaW5lZCwgdGhlIHJ1bm5lciBmYWxsc1xuICAgKiBiYWNrIHRvIGB2ZWxvY2lvdXMgam9iLXJ1bm5lcjogPEpvYk5hbWU+YC4gU2V0IGUuZy5cbiAgICogYHN0YXRpYyBwcm9jZXNzVGl0bGUgPSBcInZlbG9jaW91cyBtZWRpYSB0cmFuc2NvZGVyXCJgIHRvIGdpdmUgYSBqb2IgYVxuICAgKiBjdXN0b20sIGh1bWFuLXJlYWRhYmxlIHRpdGxlLlxuICAgKiBAdHlwZSB7c3RyaW5nIHwgdW5kZWZpbmVkfVxuICAgKi9cbiAgc3RhdGljIHByb2Nlc3NUaXRsZSA9IHVuZGVmaW5lZFxuXG4gIC8qKlxuICAgKiBXYWxsLWNsb2NrIGJvdW5kIHRoaXMgam9iIGNsYXNzIHJ1bnMgdW5kZXIsIGluIG1zLiBTZXQgZS5nLlxuICAgKiBgc3RhdGljIHRpbWVvdXRNcyA9IDYwICogNjAgKiAxMDAwYCBvbiBhIGpvYiB3aG9zZSB3b3JrIGxlZ2l0aW1hdGVseSB0YWtlc1xuICAgKiBob3VycyBzbyBpdHMgdHlwZSBjYXJyaWVzIGl0cyBvd24gYm91bmQgaW5zdGVhZCBvZiByZWx5aW5nIG9uIG9uZSBnbG9iYWxcbiAgICogYGJhY2tncm91bmRKb2JzLmpvYlRpbWVvdXRNc2AgdHVuZWQgZm9yIHRoZSBzbG93ZXN0IGpvYiBpbiB0aGUgc3lzdGVtLiBUaGVcbiAgICogYHt0aW1lb3V0TXN9YCBlbnF1ZXVlIG9wdGlvbiBvdmVycmlkZXMgaXQuIEEgbm9uLXBvc2l0aXZlIHZhbHVlIGRpc2FibGVzIHRoZVxuICAgKiBib3VuZCBmb3IgdGhpcyBjbGFzcy4gTGVmdCB1bmRlZmluZWQsIHRoZSB3b3JrZXItbGV2ZWwgdmFsdWUgYXBwbGllcy5cbiAgICogQHR5cGUge251bWJlciB8IHVuZGVmaW5lZH1cbiAgICovXG4gIHN0YXRpYyB0aW1lb3V0TXMgPSB1bmRlZmluZWRcblxuICAvKipcbiAgICogU3RvcHMgdGhpcyBwZXJmb3JtYW5jZSBhbmQgcmVzY2hlZHVsZXMgdGhlIHNhbWUgbG9naWNhbCBqb2Igcm93LiBUaGlzIGlzXG4gICAqIG5vcm1hbCBjb250cm9sIGZsb3c6IGl0IGRvZXMgbm90IGNvdW50IGFzIGEgZmFpbHVyZSBvciBjb25zdW1lIGEgcmV0cnkuXG4gICAqIEBwYXJhbSB7bnVtYmVyfSBkZWxheU1zIC0gTm9uLW5lZ2F0aXZlIHNhZmUtaW50ZWdlciBkZWxheSBpbiBtaWxsaXNlY29uZHMuXG4gICAqIEByZXR1cm5zIHtuZXZlcn0gLSBUaGlzIG1ldGhvZCBuZXZlciByZXR1cm5zLlxuICAgKi9cbiAgcmVzY2hlZHVsZUluKGRlbGF5TXMpIHtcbiAgICBpZiAoIU51bWJlci5pc1NhZmVJbnRlZ2VyKGRlbGF5TXMpIHx8IGRlbGF5TXMgPCAwKSB7XG4gICAgICB0aHJvdyBuZXcgVHlwZUVycm9yKFwiYmFja2dyb3VuZCBqb2IgcmVzY2hlZHVsZSBkZWxheU1zIG11c3QgYmUgYSBub24tbmVnYXRpdmUgc2FmZSBpbnRlZ2VyXCIpXG4gICAgfVxuXG4gICAgdGhyb3cgbmV3IEJhY2tncm91bmRKb2JSZXNjaGVkdWxlU2lnbmFsKGRlbGF5TXMpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBqb2IgbmFtZS5cbiAgICogQHJldHVybnMge3N0cmluZ30gLSBKb2IgbmFtZS5cbiAgICovXG4gIHN0YXRpYyBqb2JOYW1lKCkge1xuICAgIHJldHVybiB0aGlzLm5hbWVcbiAgfVxuXG4gIC8qKlxuICAgKiBGb2xkcyB0aGlzIGpvYiBjbGFzcydzIHN0YXRpYyBgcXVldWVgIGludG8gdGhlIGVucXVldWUgb3B0aW9ucyB1bmxlc3MgdGhlXG4gICAqIGNhbGxlciBhbHJlYWR5IHNwZWNpZmllZCBvbmUuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi90eXBlcy5qc1wiKS5CYWNrZ3JvdW5kSm9iT3B0aW9ucyB8IHVuZGVmaW5lZH0gb3B0aW9ucyAtIEpvYiBvcHRpb25zLlxuICAgKiBAcmV0dXJucyB7aW1wb3J0KFwiLi90eXBlcy5qc1wiKS5CYWNrZ3JvdW5kSm9iT3B0aW9uc30gLSBPcHRpb25zIGluY2x1ZGluZyB0aGUgcmVzb2x2ZWQgcXVldWUuXG4gICAqL1xuICBzdGF0aWMgX3dpdGhRdWV1ZShvcHRpb25zKSB7XG4gICAgY29uc3QgbWVyZ2VkID0gb3B0aW9ucyA/IHsuLi5vcHRpb25zfSA6IHt9XG5cbiAgICBpZiAobWVyZ2VkLnF1ZXVlID09PSB1bmRlZmluZWQgJiYgdHlwZW9mIHRoaXMucXVldWUgPT09IFwic3RyaW5nXCIgJiYgdGhpcy5xdWV1ZS5sZW5ndGggPiAwKSB7XG4gICAgICBtZXJnZWQucXVldWUgPSB0aGlzLnF1ZXVlXG4gICAgfVxuXG4gICAgcmV0dXJuIG1lcmdlZFxuICB9XG5cbiAgLyoqXG4gICAqIEZvbGRzIHRoaXMgam9iIGNsYXNzJ3Mgc3RhdGljIGB0aW1lb3V0TXNgIGludG8gdGhlIGVucXVldWUgb3B0aW9ucyB1bmxlc3MgdGhlXG4gICAqIGNhbGxlciBhbHJlYWR5IHNwZWNpZmllZCBvbmUsIHNvIGEgam9iIHR5cGUgY2FycmllcyBpdHMgb3duIHdhbGwtY2xvY2sgYm91bmRcbiAgICogaW5zdGVhZCBvZiBldmVyeSBqb2Igc2hhcmluZyBvbmUgd29ya2VyLWxldmVsIHZhbHVlLiBBIGNsYXNzIHRoYXQgZGVjbGFyZXNcbiAgICogbm90aGluZyBsZWF2ZXMgdGhlIG9wdGlvbiBhYnNlbnQsIGFuZCB0aGUgd29ya2VyIGZhbGxzIGJhY2sgdG8gaXRzIG93blxuICAgKiBkZWZhdWx0IOKAlCB0aGUgcHJpb3IgYmVoYXZpb3IuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi90eXBlcy5qc1wiKS5CYWNrZ3JvdW5kSm9iT3B0aW9ucyB8IHVuZGVmaW5lZH0gb3B0aW9ucyAtIEpvYiBvcHRpb25zLlxuICAgKiBAcmV0dXJucyB7aW1wb3J0KFwiLi90eXBlcy5qc1wiKS5CYWNrZ3JvdW5kSm9iT3B0aW9uc30gLSBPcHRpb25zIGluY2x1ZGluZyB0aGUgcmVzb2x2ZWQgdGltZW91dC5cbiAgICovXG4gIHN0YXRpYyBfd2l0aFRpbWVvdXQob3B0aW9ucykge1xuICAgIGNvbnN0IG1lcmdlZCA9IG9wdGlvbnMgPyB7Li4ub3B0aW9uc30gOiB7fVxuXG4gICAgaWYgKG1lcmdlZC50aW1lb3V0TXMgPT09IHVuZGVmaW5lZCAmJiB0eXBlb2YgdGhpcy50aW1lb3V0TXMgPT09IFwibnVtYmVyXCIpIHtcbiAgICAgIG1lcmdlZC50aW1lb3V0TXMgPSB0aGlzLnRpbWVvdXRNc1xuICAgIH1cblxuICAgIHJldHVybiBtZXJnZWRcbiAgfVxuXG4gIC8qKlxuICAgKiBSZXNvbHZlcyBjbGFzcy1kZXJpdmVkIGVucXVldWUgb3B0aW9ucyBvbiBhIGh5ZHJhdGVkIGpvYiBpbnN0YW5jZS4gRXhwbGljaXRcbiAgICogcGVyLWVucXVldWUgb3B0aW9ucyB0YWtlIHByZWNlZGVuY2Ugb3ZlciB0aGUgaW5zdGFuY2UgY29uY3VycmVuY3kga2V5LlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIEpvYiBjb250ZXh0LlxuICAgKiBAcGFyYW0ge0FycmF5PFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gYXJncy5qb2JBcmdzIC0gSm9iIGFyZ3VtZW50cy5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL3R5cGVzLmpzXCIpLkJhY2tncm91bmRKb2JPcHRpb25zIHwgdW5kZWZpbmVkfSBhcmdzLmpvYk9wdGlvbnMgLSBKb2Igb3B0aW9ucy5cbiAgICogQHJldHVybnMge2ltcG9ydChcIi4vdHlwZXMuanNcIikuQmFja2dyb3VuZEpvYk9wdGlvbnN9IC0gUmVzb2x2ZWQgam9iIG9wdGlvbnMuXG4gICAqL1xuICBzdGF0aWMgX3dpdGhKb2JDb250ZXh0KHtqb2JBcmdzLCBqb2JPcHRpb25zfSkge1xuICAgIGNvbnN0IG9wdGlvbnMgPSB0aGlzLl93aXRoVGltZW91dCh0aGlzLl93aXRoUXVldWUoam9iT3B0aW9ucykpXG5cbiAgICBpZiAob3B0aW9ucy5jb25jdXJyZW5jeUtleSAhPT0gdW5kZWZpbmVkKSByZXR1cm4gb3B0aW9uc1xuXG4gICAgY29uc3Qgam9iSW5zdGFuY2UgPSBuZXcgdGhpcygpXG4gICAgam9iSW5zdGFuY2UuX3NldEJhY2tncm91bmRKb2JDb250ZXh0KHtcbiAgICAgIGFyZ3M6IGpvYkFyZ3MsXG4gICAgICBqb2JDbGFzczogdGhpcyxcbiAgICAgIGpvYk5hbWU6IHRoaXMuam9iTmFtZSgpLFxuICAgICAgb3B0aW9uc1xuICAgIH0pXG4gICAgY29uc3QgY29uY3VycmVuY3lLZXkgPSBqb2JJbnN0YW5jZS5jb25jdXJyZW5jeUtleSgpXG5cbiAgICBpZiAoY29uY3VycmVuY3lLZXkgIT09IHVuZGVmaW5lZCkgb3B0aW9ucy5jb25jdXJyZW5jeUtleSA9IGNvbmN1cnJlbmN5S2V5XG5cbiAgICByZXR1cm4gb3B0aW9uc1xuICB9XG5cbiAgLyoqXG4gICAqIFNldHMgdGhlIGNvbXBsZXRlIGNvbnRleHQgYXZhaWxhYmxlIHRvIHRoaXMgaHlkcmF0ZWQgam9iIGluc3RhbmNlLlxuICAgKiBGcmFtZXdvcmsgZW5xdWV1ZS9ydW5uZXIgYm91bmRhcmllcyBvd24gdGhpcyBtZXRob2QuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi90eXBlcy5qc1wiKS5CYWNrZ3JvdW5kSm9iQ29udGV4dH0gY29udGV4dCAtIEpvYiBjb250ZXh0LlxuICAgKiBAcmV0dXJucyB7dm9pZH1cbiAgICovXG4gIF9zZXRCYWNrZ3JvdW5kSm9iQ29udGV4dChjb250ZXh0KSB7XG4gICAgdGhpcy5fYmFja2dyb3VuZEpvYkNvbnRleHQgPSBjb250ZXh0XG4gIH1cblxuICAvKipcbiAgICogUmV0dXJucyB0aGlzIGh5ZHJhdGVkIGpvYidzIGNvbXBsZXRlIGVucXVldWUgb3IgcnVubmVyIGNvbnRleHQuXG4gICAqIEByZXR1cm5zIHtpbXBvcnQoXCIuL3R5cGVzLmpzXCIpLkJhY2tncm91bmRKb2JDb250ZXh0fSAtIEpvYiBjb250ZXh0LlxuICAgKi9cbiAgYmFja2dyb3VuZEpvYkNvbnRleHQoKSB7XG4gICAgaWYgKCF0aGlzLl9iYWNrZ3JvdW5kSm9iQ29udGV4dCkgdGhyb3cgbmV3IEVycm9yKFwiQmFja2dyb3VuZCBqb2IgY29udGV4dCBpcyBub3QgaHlkcmF0ZWRcIilcblxuICAgIHJldHVybiB0aGlzLl9iYWNrZ3JvdW5kSm9iQ29udGV4dFxuICB9XG5cbiAgLyoqXG4gICAqIE92ZXJyaWRlIHRvIGRlcml2ZSBhIGR1cmFibGUgY29uY3VycmVuY3kga2V5IGZyb20gYGJhY2tncm91bmRKb2JDb250ZXh0KClgLlxuICAgKiBQYWlyIHRoZSBkZXJpdmVkIGtleSB3aXRoIGBtYXhDb25jdXJyZW5jeWAgaW4gZW5xdWV1ZSBvcHRpb25zLiBBbiBleHBsaWNpdFxuICAgKiBwZXItZW5xdWV1ZSBgY29uY3VycmVuY3lLZXlgIHRha2VzIHByZWNlZGVuY2UgYW5kIHNraXBzIHRoaXMgbWV0aG9kLlxuICAgKiBAcmV0dXJucyB7c3RyaW5nIHwgdW5kZWZpbmVkfSAtIERlcml2ZWQgY29uY3VycmVuY3kga2V5LCBvciB1bmRlZmluZWQgZm9yIG5vbmUuXG4gICAqL1xuICBjb25jdXJyZW5jeUtleSgpIHtcbiAgICByZXR1cm4gdW5kZWZpbmVkXG4gIH1cblxuICAvKipcbiAgICogUnVucyBwZXJmb3JtIGxhdGVyLlxuICAgKiBAcGFyYW0gey4uLlJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSBhcmdzIC0gSm9iIGFyZ3MuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHN0cmluZz59IC0gSm9iIGlkLlxuICAgKi9cbiAgc3RhdGljIGFzeW5jIHBlcmZvcm1MYXRlciguLi5hcmdzKSB7XG4gICAgY29uc3Qge2pvYkFyZ3MsIGpvYk9wdGlvbnN9ID0gdGhpcy5fc3BsaXRBcmdzQW5kT3B0aW9ucyhhcmdzKVxuICAgIHJldHVybiBhd2FpdCBlbnF1ZXVlQmFja2dyb3VuZEpvYih7Sm9iQ2xhc3M6IHRoaXMsIGpvYkFyZ3MsIGpvYk9wdGlvbnN9KVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgcGVyZm9ybSBsYXRlciB3aXRoIG9wdGlvbnMuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gT3B0aW9ucy5cbiAgICogQHBhcmFtIHtBcnJheTxSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59IGFyZ3MuYXJncyAtIEpvYiBhcmdzLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vdHlwZXMuanNcIikuQmFja2dyb3VuZEpvYk9wdGlvbnN9IFthcmdzLm9wdGlvbnNdIC0gSm9iIG9wdGlvbnMuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHN0cmluZz59IC0gSm9iIGlkLlxuICAgKi9cbiAgc3RhdGljIGFzeW5jIHBlcmZvcm1MYXRlcldpdGhPcHRpb25zKHthcmdzLCBvcHRpb25zfSkge1xuICAgIHJldHVybiBhd2FpdCBlbnF1ZXVlQmFja2dyb3VuZEpvYih7Sm9iQ2xhc3M6IHRoaXMsIGpvYkFyZ3M6IGFyZ3MsIGpvYk9wdGlvbnM6IG9wdGlvbnN9KVxuICB9XG5cbiAgLyoqXG4gICAqIEF0b21pY2FsbHkgcmVwbGFjZXMgdGhpcyBqb2IgY2xhc3MncyBxdWV1ZWQgb3duZXIgZm9yIGEgc3RhYmxlIHNjaGVkdWxlIGtleS5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBPcHRpb25zLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gYXJncy5zY2hlZHVsZUtleSAtIFN0YWJsZSBsb2dpY2FsIHNjaGVkdWxlIGtleS5cbiAgICogQHBhcmFtIHtBcnJheTxSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59IGFyZ3MuYXJncyAtIEpvYiBhcmdzLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vdHlwZXMuanNcIikuQmFja2dyb3VuZEpvYk9wdGlvbnN9IFthcmdzLm9wdGlvbnNdIC0gSm9iIG9wdGlvbnMuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPGltcG9ydChcIi4vdHlwZXMuanNcIikuQmFja2dyb3VuZEpvYlJlcGxhY2VtZW50UmVzdWx0Pn0gLSBSZXBsYWNlbWVudCByZXN1bHQuXG4gICAqL1xuICBzdGF0aWMgYXN5bmMgcmVwbGFjZVNjaGVkdWxlZCh7c2NoZWR1bGVLZXksIGFyZ3MsIG9wdGlvbnN9KSB7XG4gICAgcmV0dXJuIGF3YWl0IHJlcGxhY2VTY2hlZHVsZWRCYWNrZ3JvdW5kSm9iKHtKb2JDbGFzczogdGhpcywgc2NoZWR1bGVLZXksIGpvYkFyZ3M6IGFyZ3MsIGpvYk9wdGlvbnM6IG9wdGlvbnN9KVxuICB9XG5cbiAgLyoqXG4gICAqIENhbmNlbHMgb3IgZGV0YWNoZXMgdGhlIGN1cnJlbnQgb3duZXIgb2YgYSBzdGFibGUgc2NoZWR1bGUga2V5LlxuICAgKiBAcGFyYW0ge3N0cmluZ30gc2NoZWR1bGVLZXkgLSBTdGFibGUgbG9naWNhbCBzY2hlZHVsZSBrZXkuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPGltcG9ydChcIi4vdHlwZXMuanNcIikuQmFja2dyb3VuZEpvYkNhbmNlbGxhdGlvblJlc3VsdD59IC0gQ2FuY2VsbGF0aW9uIHJlc3VsdC5cbiAgICovXG4gIHN0YXRpYyBhc3luYyBjYW5jZWxTY2hlZHVsZWQoc2NoZWR1bGVLZXkpIHtcbiAgICByZXR1cm4gYXdhaXQgY2FuY2VsU2NoZWR1bGVkQmFja2dyb3VuZEpvYihzY2hlZHVsZUtleSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSZWFkcyBjdXJyZW50IG93bmVyc2hpcCBhbmQgb3B0aW9uYWwgdGVybWluYWwgaGlzdG9yeSBmb3IgYSBzdGFibGUga2V5LlxuICAgKiBAcGFyYW0ge3N0cmluZ30gc2NoZWR1bGVLZXkgLSBTdGFibGUgbG9naWNhbCBzY2hlZHVsZSBrZXkuXG4gICAqIEBwYXJhbSB7e2luY2x1ZGVMYXRlc3RUZXJtaW5hbD86IGJvb2xlYW59fSBbb3B0aW9uc10gLSBMb29rdXAgb3B0aW9ucy5cbiAgICogQHJldHVybnMge1Byb21pc2U8aW1wb3J0KFwiLi90eXBlcy5qc1wiKS5CYWNrZ3JvdW5kSm9iU2NoZWR1bGVkTG9va3VwUmVzdWx0Pn0gLSBOb3JtYWxpemVkIHN0YWJsZSBzY2hlZHVsZSBqb2JzLlxuICAgKi9cbiAgc3RhdGljIGFzeW5jIGdldFNjaGVkdWxlZEpvYihzY2hlZHVsZUtleSwgb3B0aW9ucyA9IHt9KSB7XG4gICAgcmV0dXJuIGF3YWl0IGdldFNjaGVkdWxlZEJhY2tncm91bmRKb2Ioc2NoZWR1bGVLZXksIG9wdGlvbnMpXG4gIH1cblxuICAvKipcbiAgICogRXhwZWRpdGVzIGEgZnV0dXJlIHF1ZXVlZCBvd25lciB3aXRob3V0IGNyZWF0aW5nIGFub3RoZXIgam9iLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gc2NoZWR1bGVLZXkgLSBTdGFibGUgbG9naWNhbCBzY2hlZHVsZSBrZXkuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPGltcG9ydChcIi4vdHlwZXMuanNcIikuQmFja2dyb3VuZEpvYldha2VSZXN1bHQ+fSAtIFdha2UgcmVzdWx0LlxuICAgKi9cbiAgc3RhdGljIGFzeW5jIHdha2VTY2hlZHVsZWQoc2NoZWR1bGVLZXkpIHtcbiAgICByZXR1cm4gYXdhaXQgd2FrZVNjaGVkdWxlZEJhY2tncm91bmRKb2Ioc2NoZWR1bGVLZXkpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBzcGxpdCBhcmdzIGFuZCBvcHRpb25zLlxuICAgKiBAcGFyYW0ge0FycmF5PFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gYXJncyAtIEpvYiBhcmdzLlxuICAgKiBAcmV0dXJucyB7e2pvYkFyZ3M6IEFycmF5PFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Piwgam9iT3B0aW9uczogaW1wb3J0KFwiLi90eXBlcy5qc1wiKS5CYWNrZ3JvdW5kSm9iT3B0aW9uc319IC0gU3BsaXQgYXJncyBhbmQgb3B0aW9ucy5cbiAgICovXG4gIHN0YXRpYyBfc3BsaXRBcmdzQW5kT3B0aW9ucyhhcmdzKSB7XG4gICAgaWYgKGFyZ3MubGVuZ3RoID09PSAwKSB7XG4gICAgICByZXR1cm4ge2pvYkFyZ3M6IFtdLCBqb2JPcHRpb25zOiB7fX1cbiAgICB9XG5cbiAgICBjb25zdCBsYXN0QXJnID0gYXJnc1thcmdzLmxlbmd0aCAtIDFdXG4gICAgY29uc3QgaXNPcHRpb25zQXJnID0gbGFzdEFyZyAmJiB0eXBlb2YgbGFzdEFyZyA9PT0gXCJvYmplY3RcIiAmJiAhQXJyYXkuaXNBcnJheShsYXN0QXJnKSAmJiBcImpvYk9wdGlvbnNcIiBpbiBsYXN0QXJnXG5cbiAgICBpZiAoaXNPcHRpb25zQXJnKSB7XG4gICAgICBjb25zdCB7am9iT3B0aW9uc30gPSAvKiogQHR5cGUge3tqb2JPcHRpb25zOiBpbXBvcnQoXCIuL3R5cGVzLmpzXCIpLkJhY2tncm91bmRKb2JPcHRpb25zfX0gKi8gKGxhc3RBcmcpXG4gICAgICByZXR1cm4ge2pvYkFyZ3M6IGFyZ3Muc2xpY2UoMCwgLTEpLCBqb2JPcHRpb25zOiBqb2JPcHRpb25zIHx8IHt9fVxuICAgIH1cblxuICAgIHJldHVybiB7am9iQXJnczogYXJncywgam9iT3B0aW9uczoge319XG4gIH1cblxuICAvKipcbiAgICogT3ZlcnJpZGUgaW4gc3ViY2xhc3Nlcy5cbiAgICogQHBhcmFtIHtUQXJnc30gX2FyZ3MgLSBKb2IgYXJncyAodGhlIHR1cGxlIHRoaXMgam9iIGNsYXNzIHdhcyBwYXJhbWV0ZXJpemVkIHdpdGgpLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyB3aGVuIGNvbXBsZXRlLlxuICAgKi9cbiAgYXN5bmMgcGVyZm9ybSguLi5fYXJncykge1xuICAgIHRocm93IG5ldyBFcnJvcihcInBlcmZvcm0gbm90IGltcGxlbWVudGVkXCIpXG4gIH1cbn1cbiJdfQ==