// @ts-check
import { DEFAULT_SCHEDULED_ENQUEUE_TIMEOUT_MS } from "./scheduled-enqueue-bound.js";
import ScheduledBackgroundJobEnqueueTimeoutError from "./scheduled-enqueue-timeout-error.js";
import Logger from "../logger.js";
import { nextCronFireDate, parseCronExpression } from "./cron-expression.js";
/**
 * DurationUnit type.
 * @typedef {keyof typeof DURATION_MULTIPLIERS} DurationUnit */
const DURATION_MULTIPLIERS = {
    d: 24 * 60 * 60 * 1000,
    day: 24 * 60 * 60 * 1000,
    days: 24 * 60 * 60 * 1000,
    h: 60 * 60 * 1000,
    hour: 60 * 60 * 1000,
    hours: 60 * 60 * 1000,
    m: 60 * 1000,
    minute: 60 * 1000,
    minutes: 60 * 1000,
    ms: 1,
    s: 1000,
    second: 1000,
    seconds: 1000,
    w: 7 * 24 * 60 * 60 * 1000,
    week: 7 * 24 * 60 * 60 * 1000,
    weeks: 7 * 24 * 60 * 60 * 1000
};
// The watchdog below is internal machinery, not a schedule timer. Capturing the
// platform timers at module load keeps them out of a caller's schedule-timer
// observation, so bounding an enqueue never appears as an extra scheduled job.
const armWatchdogTimer = globalThis.setTimeout;
const cancelWatchdogTimer = globalThis.clearTimeout;
/**
 * Runs the parseScheduledDuration helper.
 * @param {number | string} value - Duration value.
 * @param {string} fieldName - Field name for errors.
 * @returns {number} - Duration in milliseconds.
 */
export function parseScheduledDuration(value, fieldName) {
    if (typeof value === "number") {
        if (!Number.isFinite(value) || value < 1) {
            throw new Error(`Scheduled background job ${fieldName} must be a positive number of milliseconds.`);
        }
        return value;
    }
    if (typeof value !== "string" || !value.trim()) {
        throw new Error(`Scheduled background job ${fieldName} must be a non-empty string or number.`);
    }
    const normalizedValue = value.trim().toLowerCase();
    const match = normalizedValue.match(/^(\d+(?:\.\d+)?)\s*(ms|s|m|h|d|w|second|seconds|minute|minutes|hour|hours|day|days|week|weeks)$/);
    if (!match) {
        throw new Error(`Invalid scheduled background job ${fieldName}: ${value}`);
    }
    const numericValue = Number(match[1]);
    const multiplier = DURATION_MULTIPLIERS[ /** @type {DurationUnit} */(match[2])];
    if (!multiplier) {
        throw new Error(`Invalid scheduled background job ${fieldName}: ${value}`);
    }
    return Math.round(numericValue * multiplier);
}
/** Runs configured recurring background job schedules. */
export default class BackgroundJobsScheduler {
    /**
     * Runs constructor.
     * @param {object} args - Options.
     * @param {import("../configuration.js").default} args.configuration - Configuration.
     * @param {(args: {args: Array<ReturnType<typeof JSON.parse>>, jobClass: typeof import("./job.js").default, jobKey: string, options: import("./types.js").BackgroundJobOptions}) => Promise<void>} args.enqueueJob - Enqueue callback.
     */
    constructor({ configuration, enqueueJob }) {
        this.configuration = configuration;
        this.enqueueJob = enqueueJob;
        this.logger = new Logger(this);
        /** @type {number | null} - Bound (ms) for one scheduled enqueue attempt; `null` disables the bound. */
        this.scheduledEnqueueTimeoutMs = this._resolveScheduledEnqueueTimeoutMs();
        /**
         * Narrows the runtime value to the documented type.
         * @type {Array<ReturnType<typeof setInterval>>} */
        this.intervalIds = [];
        /**
         * Narrows the runtime value to the documented type.
         * @type {Array<ReturnType<typeof setTimeout>>} */
        this.timeoutIds = [];
        /** @type {Map<string, Promise<void>>} - In-flight scheduled enqueues by schedule key that shutdown must drain. */
        this.pendingEnqueuesByJobKey = new Map();
        /**
         * Narrows the runtime value to the documented type.
         * @type {boolean} - True between stop() and the next start(); cron self-rescheduler checks this so a stop() during an in-flight enqueue doesn't immediately re-arm.
         */
        this.stopped = false;
    }
    /**
     * Runs start.
     * @returns {Promise<void>} */
    async start() {
        this.stopped = false;
        const scheduledBackgroundJobsConfig = await this.configuration.getScheduledBackgroundJobsConfig();
        if (!scheduledBackgroundJobsConfig?.jobs) {
            return;
        }
        for (const jobKey of Object.keys(scheduledBackgroundJobsConfig.jobs)) {
            const jobConfiguration = scheduledBackgroundJobsConfig.jobs[jobKey];
            if (!jobConfiguration || jobConfiguration.enabled === false) {
                continue;
            }
            this.scheduleJob({ jobConfiguration, jobKey });
        }
    }
    /**
     * Runs stop.
     * @returns {Promise<void>} Resolves after in-flight scheduled enqueues finish.
     */
    async stop() {
        this.stopped = true;
        for (const intervalId of this.intervalIds) {
            clearInterval(intervalId);
        }
        for (const timeoutId of this.timeoutIds) {
            clearTimeout(timeoutId);
        }
        this.intervalIds = [];
        this.timeoutIds = [];
        await Promise.all(this.pendingEnqueuesByJobKey.values());
    }
    /**
     * Runs schedule job.
     * @param {object} args - Options.
     * @param {import("../configuration-types.js").ScheduledBackgroundJobConfiguration} args.jobConfiguration - Job configuration.
     * @param {string} args.jobKey - Job key.
     * @returns {void}
     */
    scheduleJob({ jobConfiguration, jobKey }) {
        if (!jobConfiguration.class || typeof jobConfiguration.class.performLaterWithOptions !== "function") {
            throw new Error(`Scheduled background job ${jobKey} must define a job class.`);
        }
        if (jobConfiguration.cron !== undefined && jobConfiguration.every !== undefined) {
            throw new Error(`Scheduled background job ${jobKey} must define either "every" or "cron", not both.`);
        }
        if (jobConfiguration.cron !== undefined) {
            this.scheduleCronJob({ jobConfiguration, jobKey });
            return;
        }
        if (jobConfiguration.every === undefined) {
            throw new Error(`Scheduled background job ${jobKey} must define either "every" or "cron".`);
        }
        this.scheduleEveryJob({ jobConfiguration, jobKey });
    }
    /**
     * Runs schedule every job.
     * @param {object} args - Options.
     * @param {import("../configuration-types.js").ScheduledBackgroundJobConfiguration} args.jobConfiguration - Job configuration.
     * @param {string} args.jobKey - Job key.
     * @returns {void}
     */
    scheduleEveryJob({ jobConfiguration, jobKey }) {
        const everyConfig = /** @type {NonNullable<typeof jobConfiguration.every>} */ (jobConfiguration.every);
        const { everyValue, firstInValue } = this.normalizeEvery(everyConfig);
        const intervalMs = parseScheduledDuration(everyValue, `${jobKey}.every`);
        const firstInMs = firstInValue !== undefined ? parseScheduledDuration(firstInValue, `${jobKey}.firstIn`) : intervalMs;
        if (intervalMs < 1) {
            throw new Error(`Scheduled background job ${jobKey}.every must be at least 1 millisecond.`);
        }
        const timeoutId = setTimeout(() => {
            const scheduledEnqueue = this.runScheduledJob({ jobConfiguration, jobKey });
            const intervalId = setInterval(() => {
                return this.runScheduledJob({ jobConfiguration, jobKey });
            }, intervalMs);
            this.intervalIds.push(intervalId);
            return scheduledEnqueue;
        }, firstInMs);
        this.timeoutIds.push(timeoutId);
    }
    /**
     * Crontab schedules don't have a constant interval (`0 9 * * 1-5`
     * fires once per weekday at 9 AM, with gaps of varying length), so
     * we self-reschedule with `setTimeout` after every fire instead of
     * using `setInterval`.
     * @param {object} args - Options.
     * @param {import("../configuration-types.js").ScheduledBackgroundJobConfiguration} args.jobConfiguration - Job configuration.
     * @param {string} args.jobKey - Job key.
     * @returns {void}
     */
    scheduleCronJob({ jobConfiguration, jobKey }) {
        const cronExpression = jobConfiguration.cron;
        if (typeof cronExpression !== "string") {
            throw new Error(`Scheduled background job ${jobKey}.cron must be a string.`);
        }
        const parsed = parseCronExpression(cronExpression);
        const scheduleNext = () => {
            if (this.stopped)
                return;
            const nextDate = nextCronFireDate(parsed, new Date());
            const delayMs = Math.max(1, nextDate.getTime() - Date.now());
            const timeoutId = setTimeout(async () => {
                if (this.stopped)
                    return;
                await this.runScheduledJob({ jobConfiguration, jobKey });
                // The await above can yield to a stop() call. Re-check before
                // re-arming so we don't keep firing after shutdown.
                if (this.stopped)
                    return;
                scheduleNext();
            }, delayMs);
            this.timeoutIds.push(timeoutId);
        };
        scheduleNext();
    }
    /**
     * Tracks a scheduled enqueue so stop() cannot return while it can still mutate the store.
     * @param {object} args - Options.
     * @param {import("../configuration-types.js").ScheduledBackgroundJobConfiguration} args.jobConfiguration - Job configuration.
     * @param {string} args.jobKey - Job key.
     * @returns {Promise<void>} - Resolves after the enqueue attempt finishes.
     */
    async runScheduledJob({ jobConfiguration, jobKey }) {
        if (this.stopped || this.pendingEnqueuesByJobKey.has(jobKey))
            return;
        const pendingEnqueue = this.enqueueScheduledJob({ jobConfiguration, jobKey });
        this.pendingEnqueuesByJobKey.set(jobKey, pendingEnqueue);
        try {
            await pendingEnqueue;
        }
        finally {
            this.pendingEnqueuesByJobKey.delete(jobKey);
        }
    }
    /**
     * Runs enqueue scheduled job.
     * @param {object} args - Options.
     * @param {import("../configuration-types.js").ScheduledBackgroundJobConfiguration} args.jobConfiguration - Job configuration.
     * @param {string} args.jobKey - Job key.
     * @returns {Promise<void>}
     */
    async enqueueScheduledJob({ jobConfiguration, jobKey }) {
        try {
            // De-duplicate scheduled enqueues by default: a periodic job still pending from an earlier
            // tick is not enqueued again, which is what let the background_jobs table fill with thousands
            // of identical scheduled jobs when the queue backed up. Dedup is by job identity (see the
            // store), so the job keeps its queue-derived concurrency cap. A schedule can opt out with
            // `deduplicateWhileQueued: false`.
            await this._withScheduledEnqueueTimeout({
                jobKey,
                jobName: jobConfiguration.class.jobName(),
                run: async () => {
                    await this.enqueueJob({
                        args: Array.isArray(jobConfiguration.args) ? jobConfiguration.args : [],
                        jobClass: jobConfiguration.class,
                        jobKey,
                        options: { deduplicateWhileQueued: true, ...(jobConfiguration.options || {}) }
                    });
                }
            });
        }
        catch (error) {
            if (error instanceof ScheduledBackgroundJobEnqueueTimeoutError) {
                this._reportScheduledEnqueueStall({ error, jobKey });
                return;
            }
            await this.logger.error(() => ["Failed to enqueue scheduled background job", { jobKey, jobName: jobConfiguration.class.jobName() }, error]);
        }
    }
    /**
     * Runs one durable enqueue attempt under the scheduled-enqueue bound.
     *
     * The bound is applied with a local race rather than `awaitery`'s `timeout()`:
     * that helper starts its callback through `Promise.resolve().then(...)`, which
     * would defer every scheduled enqueue by a microtask and change the tick
     * semantics callers rely on. Here the attempt starts synchronously, and the
     * watchdog uses the module-captured timers so it is never observable as a
     * schedule timer. Only the watchdog raises the typed timeout error, so a
     * timeout raised inside the enqueue itself keeps its own error path.
     * @param {object} args - Options.
     * @param {string} args.jobKey - Schedule key.
     * @param {string} args.jobName - Resolved job class name.
     * @param {() => Promise<void>} args.run - Enqueue attempt.
     * @returns {Promise<void>} - Resolves when the attempt settles within the bound.
     */
    async _withScheduledEnqueueTimeout({ jobKey, jobName, run }) {
        const timeoutMs = this.scheduledEnqueueTimeoutMs;
        /** @type {Promise<void>} */
        let attempt;
        try {
            attempt = Promise.resolve(run());
        }
        catch (error) {
            attempt = Promise.reject(/** @type {Error} */ (error));
        }
        if (timeoutMs === null)
            return await attempt;
        /**
         * Rejects the watchdog promise when the bound expires.
         * @type {(error: Error) => void} */
        let rejectScheduledEnqueueTimeout = () => { };
        const watchdog = new Promise((_, reject) => { rejectScheduledEnqueueTimeout = reject; });
        /**
         * Watchdog timer handle.
         * @type {ReturnType<typeof armWatchdogTimer>} */
        const watchdogId = armWatchdogTimer(() => {
            rejectScheduledEnqueueTimeout(new ScheduledBackgroundJobEnqueueTimeoutError({
                jobKey,
                jobName,
                scheduledEnqueueTimeoutMs: timeoutMs
            }));
        }, timeoutMs);
        try {
            return await Promise.race([attempt, watchdog]);
        }
        finally {
            cancelWatchdogTimer(watchdogId);
        }
    }
    /**
     * Surfaces a scheduled enqueue whose store call never settled. Without this report the only
     * symptom is a schedule that silently stops enqueueing after one wedged call.
     * @param {object} args - Options.
     * @param {Error} args.error - Timeout error.
     * @param {string} args.jobKey - Schedule key.
     * @returns {void}
     */
    _reportScheduledEnqueueStall({ error, jobKey }) {
        const payload = {
            context: {
                jobKey,
                scheduledEnqueueTimeoutMs: this.scheduledEnqueueTimeoutMs,
                stage: "background-jobs-scheduled-enqueue-stall"
            },
            error
        };
        void this.logger.error(() => ["Scheduled background job enqueue stalled", payload.context, error]);
        const errorEvents = typeof this.configuration?.getErrorEvents === "function" ? this.configuration.getErrorEvents() : undefined;
        if (!errorEvents)
            return;
        errorEvents.emit("framework-error", payload);
        errorEvents.emit("all-error", { ...payload, errorType: "framework-error" });
    }
    /**
     * Resolves the scheduled-enqueue bound from configuration.
     * @returns {number | null} - Bound in milliseconds, or `null` for an unbounded wait.
     */
    _resolveScheduledEnqueueTimeoutMs() {
        const backgroundJobsConfig = typeof this.configuration?.getBackgroundJobsConfig === "function" ? this.configuration.getBackgroundJobsConfig() : undefined;
        const configured = backgroundJobsConfig?.scheduledEnqueueTimeoutMs;
        if (configured === null)
            return null;
        if (typeof configured === "number" && configured > 0)
            return configured;
        return DEFAULT_SCHEDULED_ENQUEUE_TIMEOUT_MS;
    }
    /**
     * Runs normalize every.
     * @param {NonNullable<import("../configuration-types.js").ScheduledBackgroundJobConfiguration["every"]>} every - Every config (caller must guarantee not undefined).
     * @returns {{everyValue: number | string, firstInValue?: number | string}} - Normalized interval and first-run delay values.
     */
    normalizeEvery(every) {
        if (Array.isArray(every)) {
            const [everyValue, everyOptions] = every;
            if (!everyOptions || typeof everyOptions !== "object" || Array.isArray(everyOptions)) {
                return { everyValue };
            }
            return { everyValue, firstInValue: everyOptions.firstIn };
        }
        return { everyValue: every };
    }
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoic2NoZWR1bGVyLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiLi4vLi4vLi4vc3JjL2JhY2tncm91bmQtam9icy9zY2hlZHVsZXIuanMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6IkFBQUEsWUFBWTtBQUVaLE9BQU8sRUFBQyxvQ0FBb0MsRUFBQyxNQUFNLDhCQUE4QixDQUFBO0FBQ2pGLE9BQU8seUNBQXlDLE1BQU0sc0NBQXNDLENBQUE7QUFFNUYsT0FBTyxNQUFNLE1BQU0sY0FBYyxDQUFBO0FBQ2pDLE9BQU8sRUFBQyxnQkFBZ0IsRUFBRSxtQkFBbUIsRUFBQyxNQUFNLHNCQUFzQixDQUFBO0FBRTFFOzsrREFFK0Q7QUFDL0QsTUFBTSxvQkFBb0IsR0FBRztJQUMzQixDQUFDLEVBQUUsRUFBRSxHQUFHLEVBQUUsR0FBRyxFQUFFLEdBQUcsSUFBSTtJQUN0QixHQUFHLEVBQUUsRUFBRSxHQUFHLEVBQUUsR0FBRyxFQUFFLEdBQUcsSUFBSTtJQUN4QixJQUFJLEVBQUUsRUFBRSxHQUFHLEVBQUUsR0FBRyxFQUFFLEdBQUcsSUFBSTtJQUN6QixDQUFDLEVBQUUsRUFBRSxHQUFHLEVBQUUsR0FBRyxJQUFJO0lBQ2pCLElBQUksRUFBRSxFQUFFLEdBQUcsRUFBRSxHQUFHLElBQUk7SUFDcEIsS0FBSyxFQUFFLEVBQUUsR0FBRyxFQUFFLEdBQUcsSUFBSTtJQUNyQixDQUFDLEVBQUUsRUFBRSxHQUFHLElBQUk7SUFDWixNQUFNLEVBQUUsRUFBRSxHQUFHLElBQUk7SUFDakIsT0FBTyxFQUFFLEVBQUUsR0FBRyxJQUFJO0lBQ2xCLEVBQUUsRUFBRSxDQUFDO0lBQ0wsQ0FBQyxFQUFFLElBQUk7SUFDUCxNQUFNLEVBQUUsSUFBSTtJQUNaLE9BQU8sRUFBRSxJQUFJO0lBQ2IsQ0FBQyxFQUFFLENBQUMsR0FBRyxFQUFFLEdBQUcsRUFBRSxHQUFHLEVBQUUsR0FBRyxJQUFJO0lBQzFCLElBQUksRUFBRSxDQUFDLEdBQUcsRUFBRSxHQUFHLEVBQUUsR0FBRyxF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QUFNLFVBQVUsR0FBRyxvQkFBb0IsRUFBRSx5QkFBeUIsQ0FBQTtRQUVsRSxJQUFJLFVBQVUsS0FBSyxJQUFJO1lBQUUsT0FBTyxJQUFJLENBQUE7UUFDcEMsSUFBSSxPQUFPLFVBQVUsS0FBSyxRQUFRLElBQUksVUFBVSxHQUFHLENBQUM7WUFBRSxPQUFPLFVBQVUsQ0FBQTtRQUV2RSxPQUFPLG9DQUFvQyxDQUFBO0lBQzdDLENBQUM7SUFFRDs7OztPQUlHO0lBQ0gsY0FBYyxDQUFDLEtBQUs7UUFDbEIsSUFBSSxLQUFLLENBQUMsT0FBTyxDQUFDLEtBQUssQ0FBQyxFQUFFLENBQUM7WUFDekIsTUFBTSxDQUFDLFVBQVUsRUFBRSxZQUFZLENBQUMsR0FBRyxLQUFLLENBQUE7WUFFeEMsSUFBSSxDQUFDLFlBQVksSUFBSSxPQUFPLFlBQVksS0FBSyxRQUFRLElBQUksS0FBSyxDQUFDLE9BQU8sQ0FBQyxZQUFZLENBQUMsRUFBRSxDQUFDO2dCQUNyRixPQUFPLEVBQUMsVUFBVSxFQUFDLENBQUE7WUFDckIsQ0FBQztZQUVELE9BQU8sRUFBQyxVQUFVLEVBQUUsWUFBWSxFQUFFLFlBQVksQ0FBQyxPQUFPLEVBQUMsQ0FBQTtRQUN6RCxDQUFDO1FBRUQsT0FBTyxFQUFDLFVBQVUsRUFBRSxLQUFLLEVBQUMsQ0FBQTtJQUM1QixDQUFDO0NBQ0YiLCJzb3VyY2VzQ29udGVudCI6WyIvLyBAdHMtY2hlY2tcblxuaW1wb3J0IHtERUZBVUxUX1NDSEVEVUxFRF9FTlFVRVVFX1RJTUVPVVRfTVN9IGZyb20gXCIuL3NjaGVkdWxlZC1lbnF1ZXVlLWJvdW5kLmpzXCJcbmltcG9ydCBTY2hlZHVsZWRCYWNrZ3JvdW5kSm9iRW5xdWV1ZVRpbWVvdXRFcnJvciBmcm9tIFwiLi9zY2hlZHVsZWQtZW5xdWV1ZS10aW1lb3V0LWVycm9yLmpzXCJcblxuaW1wb3J0IExvZ2dlciBmcm9tIFwiLi4vbG9nZ2VyLmpzXCJcbmltcG9ydCB7bmV4dENyb25GaXJlRGF0ZSwgcGFyc2VDcm9uRXhwcmVzc2lvbn0gZnJvbSBcIi4vY3Jvbi1leHByZXNzaW9uLmpzXCJcblxuLyoqXG4gKiBEdXJhdGlvblVuaXQgdHlwZS5cbiAqIEB0eXBlZGVmIHtrZXlvZiB0eXBlb2YgRFVSQVRJT05fTVVMVElQTElFUlN9IER1cmF0aW9uVW5pdCAqL1xuY29uc3QgRFVSQVRJT05fTVVMVElQTElFUlMgPSB7XG4gIGQ6IDI0ICogNjAgKiA2MCAqIDEwMDAsXG4gIGRheTogMjQgKiA2MCAqIDYwICogMTAwMCxcbiAgZGF5czogMjQgKiA2MCAqIDYwICogMTAwMCxcbiAgaDogNjAgKiA2MCAqIDEwMDAsXG4gIGhvdXI6IDYwICogNjAgKiAxMDAwLFxuICBob3VyczogNjAgKiA2MCAqIDEwMDAsXG4gIG06IDYwICogMTAwMCxcbiAgbWludXRlOiA2MCAqIDEwMDAsXG4gIG1pbnV0ZXM6IDYwICogMTAwMCxcbiAgbXM6IDEsXG4gIHM6IDEwMDAsXG4gIHNlY29uZDogMTAwMCxcbiAgc2Vjb25kczogMTAwMCxcbiAgdzogNyAqIDI0ICogNjAgKiA2MCAqIDEwMDAsXG4gIHdlZWs6IDcgKiAyNCAqIDYwICogNjAgKiAxMDAwLFxuICB3ZWVrczogNyAqIDI0ICogNjAgKiA2MCAqIDEwMDBcbn1cblxuLy8gVGhlIHdhdGNoZG9nIGJlbG93IGlzIGludGVybmFsIG1hY2hpbmVyeSwgbm90IGEgc2NoZWR1bGUgdGltZXIuIENhcHR1cmluZyB0aGVcbi8vIHBsYXRmb3JtIHRpbWVycyBhdCBtb2R1bGUgbG9hZCBrZWVwcyB0aGVtIG91dCBvZiBhIGNhbGxlcidzIHNjaGVkdWxlLXRpbWVyXG4vLyBvYnNlcnZhdGlvbiwgc28gYm91bmRpbmcgYW4gZW5xdWV1ZSBuZXZlciBhcHBlYXJzIGFzIGFuIGV4dHJhIHNjaGVkdWxlZCBqb2IuXG5jb25zdCBhcm1XYXRjaGRvZ1RpbWVyID0gZ2xvYmFsVGhpcy5zZXRUaW1lb3V0XG5jb25zdCBjYW5jZWxXYXRjaGRvZ1RpbWVyID0gZ2xvYmFsVGhpcy5jbGVhclRpbWVvdXRcblxuLyoqXG4gKiBSdW5zIHRoZSBwYXJzZVNjaGVkdWxlZER1cmF0aW9uIGhlbHBlci5cbiAqIEBwYXJhbSB7bnVtYmVyIHwgc3RyaW5nfSB2YWx1ZSAtIER1cmF0aW9uIHZhbHVlLlxuICogQHBhcmFtIHtzdHJpbmd9IGZpZWxkTmFtZSAtIEZpZWxkIG5hbWUgZm9yIGVycm9ycy5cbiAqIEByZXR1cm5zIHtudW1iZXJ9IC0gRHVyYXRpb24gaW4gbWlsbGlzZWNvbmRzLlxuICovXG5leHBvcnQgZnVuY3Rpb24gcGFyc2VTY2hlZHVsZWREdXJhdGlvbih2YWx1ZSwgZmllbGROYW1lKSB7XG4gIGlmICh0eXBlb2YgdmFsdWUgPT09IFwibnVtYmVyXCIpIHtcbiAgICBpZiAoIU51bWJlci5pc0Zpbml0ZSh2YWx1ZSkgfHwgdmFsdWUgPCAxKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoYFNjaGVkdWxlZCBiYWNrZ3JvdW5kIGpvYiAke2ZpZWxkTmFtZX0gbXVzdCBiZSBhIHBvc2l0aXZlIG51bWJlciBvZiBtaWxsaXNlY29uZHMuYClcbiAgICB9XG5cbiAgICByZXR1cm4gdmFsdWVcbiAgfVxuXG4gIGlmICh0eXBlb2YgdmFsdWUgIT09IFwic3RyaW5nXCIgfHwgIXZhbHVlLnRyaW0oKSkge1xuICAgIHRocm93IG5ldyBFcnJvcihgU2NoZWR1bGVkIGJhY2tncm91bmQgam9iICR7ZmllbGROYW1lfSBtdXN0IGJlIGEgbm9uLWVtcHR5IHN0cmluZyBvciBudW1iZXIuYClcbiAgfVxuXG4gIGNvbnN0IG5vcm1hbGl6ZWRWYWx1ZSA9IHZhbHVlLnRyaW0oKS50b0xvd2VyQ2FzZSgpXG4gIGNvbnN0IG1hdGNoID0gbm9ybWFsaXplZFZhbHVlLm1hdGNoKC9eKFxcZCsoPzpcXC5cXGQrKT8pXFxzKihtc3xzfG18aHxkfHd8c2Vjb25kfHNlY29uZHN8bWludXRlfG1pbnV0ZXN8aG91cnxob3Vyc3xkYXl8ZGF5c3x3ZWVrfHdlZWtzKSQvKVxuXG4gIGlmICghbWF0Y2gpIHtcbiAgICB0aHJvdyBuZXcgRXJyb3IoYEludmFsaWQgc2NoZWR1bGVkIGJhY2tncm91bmQgam9iICR7ZmllbGROYW1lfTogJHt2YWx1ZX1gKVxuICB9XG5cbiAgY29uc3QgbnVtZXJpY1ZhbHVlID0gTnVtYmVyKG1hdGNoWzFdKVxuICBjb25zdCBtdWx0aXBsaWVyID0gRFVSQVRJT05fTVVMVElQTElFUlNbLyoqIEB0eXBlIHtEdXJhdGlvblVuaXR9ICovIChtYXRjaFsyXSldXG5cbiAgaWYgKCFtdWx0aXBsaWVyKSB7XG4gICAgdGhyb3cgbmV3IEVycm9yKGBJbnZhbGlkIHNjaGVkdWxlZCBiYWNrZ3JvdW5kIGpvYiAke2ZpZWxkTmFtZX06ICR7dmFsdWV9YClcbiAgfVxuXG4gIHJldHVybiBNYXRoLnJvdW5kKG51bWVyaWNWYWx1ZSAqIG11bHRpcGxpZXIpXG59XG5cbi8qKiBSdW5zIGNvbmZpZ3VyZWQgcmVjdXJyaW5nIGJhY2tncm91bmQgam9iIHNjaGVkdWxlcy4gKi9cbmV4cG9ydCBkZWZhdWx0IGNsYXNzIEJhY2tncm91bmRKb2JzU2NoZWR1bGVyIHtcbiAgLyoqXG4gICAqIFJ1bnMgY29uc3RydWN0b3IuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gT3B0aW9ucy5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9jb25maWd1cmF0aW9uLmpzXCIpLmRlZmF1bHR9IGFyZ3MuY29uZmlndXJhdGlvbiAtIENvbmZpZ3VyYXRpb24uXG4gICAqIEBwYXJhbSB7KGFyZ3M6IHthcmdzOiBBcnJheTxSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj4sIGpvYkNsYXNzOiB0eXBlb2YgaW1wb3J0KFwiLi9qb2IuanNcIikuZGVmYXVsdCwgam9iS2V5OiBzdHJpbmcsIG9wdGlvbnM6IGltcG9ydChcIi4vdHlwZXMuanNcIikuQmFja2dyb3VuZEpvYk9wdGlvbnN9KSA9PiBQcm9taXNlPHZvaWQ+fSBhcmdzLmVucXVldWVKb2IgLSBFbnF1ZXVlIGNhbGxiYWNrLlxuICAgKi9cbiAgY29uc3RydWN0b3Ioe2NvbmZpZ3VyYXRpb24sIGVucXVldWVKb2J9KSB7XG4gICAgdGhpcy5jb25maWd1cmF0aW9uID0gY29uZmlndXJhdGlvblxuICAgIHRoaXMuZW5xdWV1ZUpvYiA9IGVucXVldWVKb2JcbiAgICB0aGlzLmxvZ2dlciA9IG5ldyBMb2dnZXIodGhpcylcbiAgICAvKiogQHR5cGUge251bWJlciB8IG51bGx9IC0gQm91bmQgKG1zKSBmb3Igb25lIHNjaGVkdWxlZCBlbnF1ZXVlIGF0dGVtcHQ7IGBudWxsYCBkaXNhYmxlcyB0aGUgYm91bmQuICovXG4gICAgdGhpcy5zY2hlZHVsZWRFbnF1ZXVlVGltZW91dE1zID0gdGhpcy5fcmVzb2x2ZVNjaGVkdWxlZEVucXVldWVUaW1lb3V0TXMoKVxuICAgIC8qKlxuICAgICAqIE5hcnJvd3MgdGhlIHJ1bnRpbWUgdmFsdWUgdG8gdGhlIGRvY3VtZW50ZWQgdHlwZS5cbiAgICAgKiBAdHlwZSB7QXJyYXk8UmV0dXJuVHlwZTx0eXBlb2Ygc2V0SW50ZXJ2YWw+Pn0gKi9cbiAgICB0aGlzLmludGVydmFsSWRzID0gW11cbiAgICAvKipcbiAgICAgKiBOYXJyb3dzIHRoZSBydW50aW1lIHZhbHVlIHRvIHRoZSBkb2N1bWVudGVkIHR5cGUuXG4gICAgICogQHR5cGUge0FycmF5PFJldHVyblR5cGU8dHlwZW9mIHNldFRpbWVvdXQ+Pn0gKi9cbiAgICB0aGlzLnRpbWVvdXRJZHMgPSBbXVxuICAgIC8qKiBAdHlwZSB7TWFwPHN0cmluZywgUHJvbWlzZTx2b2lkPj59IC0gSW4tZmxpZ2h0IHNjaGVkdWxlZCBlbnF1ZXVlcyBieSBzY2hlZHVsZSBrZXkgdGhhdCBzaHV0ZG93biBtdXN0IGRyYWluLiAqL1xuICAgIHRoaXMucGVuZGluZ0VucXVldWVzQnlKb2JLZXkgPSBuZXcgTWFwKClcbiAgICAvKipcbiAgICAgKiBOYXJyb3dzIHRoZSBydW50aW1lIHZhbHVlIHRvIHRoZSBkb2N1bWVudGVkIHR5cGUuXG4gICAgICogQHR5cGUge2Jvb2xlYW59IC0gVHJ1ZSBiZXR3ZWVuIHN0b3AoKSBhbmQgdGhlIG5leHQgc3RhcnQoKTsgY3JvbiBzZWxmLXJlc2NoZWR1bGVyIGNoZWNrcyB0aGlzIHNvIGEgc3RvcCgpIGR1cmluZyBhbiBpbi1mbGlnaHQgZW5xdWV1ZSBkb2Vzbid0IGltbWVkaWF0ZWx5IHJlLWFybS5cbiAgICAgKi9cbiAgICB0aGlzLnN0b3BwZWQgPSBmYWxzZVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgc3RhcnQuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAqL1xuICBhc3luYyBzdGFydCgpIHtcbiAgICB0aGlzLnN0b3BwZWQgPSBmYWxzZVxuXG4gICAgY29uc3Qgc2NoZWR1bGVkQmFja2dyb3VuZEpvYnNDb25maWcgPSBhd2FpdCB0aGlzLmNvbmZpZ3VyYXRpb24uZ2V0U2NoZWR1bGVkQmFja2dyb3VuZEpvYnNDb25maWcoKVxuXG4gICAgaWYgKCFzY2hlZHVsZWRCYWNrZ3JvdW5kSm9ic0NvbmZpZz8uam9icykge1xuICAgICAgcmV0dXJuXG4gICAgfVxuXG4gICAgZm9yIChjb25zdCBqb2JLZXkgb2YgT2JqZWN0LmtleXMoc2NoZWR1bGVkQmFja2dyb3VuZEpvYnNDb25maWcuam9icykpIHtcbiAgICAgIGNvbnN0IGpvYkNvbmZpZ3VyYXRpb24gPSBzY2hlZHVsZWRCYWNrZ3JvdW5kSm9ic0NvbmZpZy5qb2JzW2pvYktleV1cblxuICAgICAgaWYgKCFqb2JDb25maWd1cmF0aW9uIHx8IGpvYkNvbmZpZ3VyYXRpb24uZW5hYmxlZCA9PT0gZmFsc2UpIHtcbiAgICAgICAgY29udGludWVcbiAgICAgIH1cblxuICAgICAgdGhpcy5zY2hlZHVsZUpvYih7am9iQ29uZmlndXJhdGlvbiwgam9iS2V5fSlcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogUnVucyBzdG9wLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gUmVzb2x2ZXMgYWZ0ZXIgaW4tZmxpZ2h0IHNjaGVkdWxlZCBlbnF1ZXVlcyBmaW5pc2guXG4gICAqL1xuICBhc3luYyBzdG9wKCkge1xuICAgIHRoaXMuc3RvcHBlZCA9IHRydWVcblxuICAgIGZvciAoY29uc3QgaW50ZXJ2YWxJZCBvZiB0aGlzLmludGVydmFsSWRzKSB7XG4gICAgICBjbGVhckludGVydmFsKGludGVydmFsSWQpXG4gICAgfVxuXG4gICAgZm9yIChjb25zdCB0aW1lb3V0SWQgb2YgdGhpcy50aW1lb3V0SWRzKSB7XG4gICAgICBjbGVhclRpbWVvdXQodGltZW91dElkKVxuICAgIH1cblxuICAgIHRoaXMuaW50ZXJ2YWxJZHMgPSBbXVxuICAgIHRoaXMudGltZW91dElkcyA9IFtdXG5cbiAgICBhd2FpdCBQcm9taXNlLmFsbCh0aGlzLnBlbmRpbmdFbnF1ZXVlc0J5Sm9iS2V5LnZhbHVlcygpKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgc2NoZWR1bGUgam9iLlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIE9wdGlvbnMuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vY29uZmlndXJhdGlvbi10eXBlcy5qc1wiKS5TY2hlZHVsZWRCYWNrZ3JvdW5kSm9iQ29uZmlndXJhdGlvbn0gYXJncy5qb2JDb25maWd1cmF0aW9uIC0gSm9iIGNvbmZpZ3VyYXRpb24uXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBhcmdzLmpvYktleSAtIEpvYiBrZXkuXG4gICAqIEByZXR1cm5zIHt2b2lkfVxuICAgKi9cbiAgc2NoZWR1bGVKb2Ioe2pvYkNvbmZpZ3VyYXRpb24sIGpvYktleX0pIHtcbiAgICBpZiAoIWpvYkNvbmZpZ3VyYXRpb24uY2xhc3MgfHwgdHlwZW9mIGpvYkNvbmZpZ3VyYXRpb24uY2xhc3MucGVyZm9ybUxhdGVyV2l0aE9wdGlvbnMgIT09IFwiZnVuY3Rpb25cIikge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKGBTY2hlZHVsZWQgYmFja2dyb3VuZCBqb2IgJHtqb2JLZXl9IG11c3QgZGVmaW5lIGEgam9iIGNsYXNzLmApXG4gICAgfVxuXG4gICAgaWYgKGpvYkNvbmZpZ3VyYXRpb24uY3JvbiAhPT0gdW5kZWZpbmVkICYmIGpvYkNvbmZpZ3VyYXRpb24uZXZlcnkgIT09IHVuZGVmaW5lZCkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKGBTY2hlZHVsZWQgYmFja2dyb3VuZCBqb2IgJHtqb2JLZXl9IG11c3QgZGVmaW5lIGVpdGhlciBcImV2ZXJ5XCIgb3IgXCJjcm9uXCIsIG5vdCBib3RoLmApXG4gICAgfVxuXG4gICAgaWYgKGpvYkNvbmZpZ3VyYXRpb24uY3JvbiAhPT0gdW5kZWZpbmVkKSB7XG4gICAgICB0aGlzLnNjaGVkdWxlQ3JvbkpvYih7am9iQ29uZmlndXJhdGlvbiwgam9iS2V5fSlcblxuICAgICAgcmV0dXJuXG4gICAgfVxuXG4gICAgaWYgKGpvYkNvbmZpZ3VyYXRpb24uZXZlcnkgPT09IHVuZGVmaW5lZCkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKGBTY2hlZHVsZWQgYmFja2dyb3VuZCBqb2IgJHtqb2JLZXl9IG11c3QgZGVmaW5lIGVpdGhlciBcImV2ZXJ5XCIgb3IgXCJjcm9uXCIuYClcbiAgICB9XG5cbiAgICB0aGlzLnNjaGVkdWxlRXZlcnlKb2Ioe2pvYkNvbmZpZ3VyYXRpb24sIGpvYktleX0pXG4gIH1cblxuICAvKipcbiAgICogUnVucyBzY2hlZHVsZSBldmVyeSBqb2IuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gT3B0aW9ucy5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9jb25maWd1cmF0aW9uLXR5cGVzLmpzXCIpLlNjaGVkdWxlZEJhY2tncm91bmRKb2JDb25maWd1cmF0aW9ufSBhcmdzLmpvYkNvbmZpZ3VyYXRpb24gLSBKb2IgY29uZmlndXJhdGlvbi5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGFyZ3Muam9iS2V5IC0gSm9iIGtleS5cbiAgICogQHJldHVybnMge3ZvaWR9XG4gICAqL1xuICBzY2hlZHVsZUV2ZXJ5Sm9iKHtqb2JDb25maWd1cmF0aW9uLCBqb2JLZXl9KSB7XG4gICAgY29uc3QgZXZlcnlDb25maWcgPSAvKiogQHR5cGUge05vbk51bGxhYmxlPHR5cGVvZiBqb2JDb25maWd1cmF0aW9uLmV2ZXJ5Pn0gKi8gKGpvYkNvbmZpZ3VyYXRpb24uZXZlcnkpXG4gICAgY29uc3Qge2V2ZXJ5VmFsdWUsIGZpcnN0SW5WYWx1ZX0gPSB0aGlzLm5vcm1hbGl6ZUV2ZXJ5KGV2ZXJ5Q29uZmlnKVxuICAgIGNvbnN0IGludGVydmFsTXMgPSBwYXJzZVNjaGVkdWxlZER1cmF0aW9uKGV2ZXJ5VmFsdWUsIGAke2pvYktleX0uZXZlcnlgKVxuICAgIGNvbnN0IGZpcnN0SW5NcyA9IGZpcnN0SW5WYWx1ZSAhPT0gdW5kZWZpbmVkID8gcGFyc2VTY2hlZHVsZWREdXJhdGlvbihmaXJzdEluVmFsdWUsIGAke2pvYktleX0uZmlyc3RJbmApIDogaW50ZXJ2YWxNc1xuXG4gICAgaWYgKGludGVydmFsTXMgPCAxKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoYFNjaGVkdWxlZCBiYWNrZ3JvdW5kIGpvYiAke2pvYktleX0uZXZlcnkgbXVzdCBiZSBhdCBsZWFzdCAxIG1pbGxpc2Vjb25kLmApXG4gICAgfVxuXG4gICAgY29uc3QgdGltZW91dElkID0gc2V0VGltZW91dCgoKSA9PiB7XG4gICAgICBjb25zdCBzY2hlZHVsZWRFbnF1ZXVlID0gdGhpcy5ydW5TY2hlZHVsZWRKb2Ioe2pvYkNvbmZpZ3VyYXRpb24sIGpvYktleX0pXG5cbiAgICAgIGNvbnN0IGludGVydmFsSWQgPSBzZXRJbnRlcnZhbCgoKSA9PiB7XG4gICAgICAgIHJldHVybiB0aGlzLnJ1blNjaGVkdWxlZEpvYih7am9iQ29uZmlndXJhdGlvbiwgam9iS2V5fSlcbiAgICAgIH0sIGludGVydmFsTXMpXG5cbiAgICAgIHRoaXMuaW50ZXJ2YWxJZHMucHVzaChpbnRlcnZhbElkKVxuXG4gICAgICByZXR1cm4gc2NoZWR1bGVkRW5xdWV1ZVxuICAgIH0sIGZpcnN0SW5NcylcblxuICAgIHRoaXMudGltZW91dElkcy5wdXNoKHRpbWVvdXRJZClcbiAgfVxuXG4gIC8qKlxuICAgKiBDcm9udGFiIHNjaGVkdWxlcyBkb24ndCBoYXZlIGEgY29uc3RhbnQgaW50ZXJ2YWwgKGAwIDkgKiAqIDEtNWBcbiAgICogZmlyZXMgb25jZSBwZXIgd2Vla2RheSBhdCA5IEFNLCB3aXRoIGdhcHMgb2YgdmFyeWluZyBsZW5ndGgpLCBzb1xuICAgKiB3ZSBzZWxmLXJlc2NoZWR1bGUgd2l0aCBgc2V0VGltZW91dGAgYWZ0ZXIgZXZlcnkgZmlyZSBpbnN0ZWFkIG9mXG4gICAqIHVzaW5nIGBzZXRJbnRlcnZhbGAuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gT3B0aW9ucy5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9jb25maWd1cmF0aW9uLXR5cGVzLmpzXCIpLlNjaGVkdWxlZEJhY2tncm91bmRKb2JDb25maWd1cmF0aW9ufSBhcmdzLmpvYkNvbmZpZ3VyYXRpb24gLSBKb2IgY29uZmlndXJhdGlvbi5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGFyZ3Muam9iS2V5IC0gSm9iIGtleS5cbiAgICogQHJldHVybnMge3ZvaWR9XG4gICAqL1xuICBzY2hlZHVsZUNyb25Kb2Ioe2pvYkNvbmZpZ3VyYXRpb24sIGpvYktleX0pIHtcbiAgICBjb25zdCBjcm9uRXhwcmVzc2lvbiA9IGpvYkNvbmZpZ3VyYXRpb24uY3JvblxuXG4gICAgaWYgKHR5cGVvZiBjcm9uRXhwcmVzc2lvbiAhPT0gXCJzdHJpbmdcIikge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKGBTY2hlZHVsZWQgYmFja2dyb3VuZCBqb2IgJHtqb2JLZXl9LmNyb24gbXVzdCBiZSBhIHN0cmluZy5gKVxuICAgIH1cblxuICAgIGNvbnN0IHBhcnNlZCA9IHBhcnNlQ3JvbkV4cHJlc3Npb24oY3JvbkV4cHJlc3Npb24pXG4gICAgY29uc3Qgc2NoZWR1bGVOZXh0ID0gKCkgPT4ge1xuICAgICAgaWYgKHRoaXMuc3RvcHBlZCkgcmV0dXJuXG5cbiAgICAgIGNvbnN0IG5leHREYXRlID0gbmV4dENyb25GaXJlRGF0ZShwYXJzZWQsIG5ldyBEYXRlKCkpXG4gICAgICBjb25zdCBkZWxheU1zID0gTWF0aC5tYXgoMSwgbmV4dERhdGUuZ2V0VGltZSgpIC0gRGF0ZS5ub3coKSlcbiAgICAgIGNvbnN0IHRpbWVvdXRJZCA9IHNldFRpbWVvdXQoYXN5bmMgKCkgPT4ge1xuICAgICAgICBpZiAodGhpcy5zdG9wcGVkKSByZXR1cm5cblxuICAgICAgICBhd2FpdCB0aGlzLnJ1blNjaGVkdWxlZEpvYih7am9iQ29uZmlndXJhdGlvbiwgam9iS2V5fSlcblxuICAgICAgICAvLyBUaGUgYXdhaXQgYWJvdmUgY2FuIHlpZWxkIHRvIGEgc3RvcCgpIGNhbGwuIFJlLWNoZWNrIGJlZm9yZVxuICAgICAgICAvLyByZS1hcm1pbmcgc28gd2UgZG9uJ3Qga2VlcCBmaXJpbmcgYWZ0ZXIgc2h1dGRvd24uXG4gICAgICAgIGlmICh0aGlzLnN0b3BwZWQpIHJldHVyblxuXG4gICAgICAgIHNjaGVkdWxlTmV4dCgpXG4gICAgICB9LCBkZWxheU1zKVxuXG4gICAgICB0aGlzLnRpbWVvdXRJZHMucHVzaCh0aW1lb3V0SWQpXG4gICAgfVxuXG4gICAgc2NoZWR1bGVOZXh0KClcbiAgfVxuXG4gIC8qKlxuICAgKiBUcmFja3MgYSBzY2hlZHVsZWQgZW5xdWV1ZSBzbyBzdG9wKCkgY2Fubm90IHJldHVybiB3aGlsZSBpdCBjYW4gc3RpbGwgbXV0YXRlIHRoZSBzdG9yZS5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBPcHRpb25zLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL2NvbmZpZ3VyYXRpb24tdHlwZXMuanNcIikuU2NoZWR1bGVkQmFja2dyb3VuZEpvYkNvbmZpZ3VyYXRpb259IGFyZ3Muam9iQ29uZmlndXJhdGlvbiAtIEpvYiBjb25maWd1cmF0aW9uLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gYXJncy5qb2JLZXkgLSBKb2Iga2V5LlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyBhZnRlciB0aGUgZW5xdWV1ZSBhdHRlbXB0IGZpbmlzaGVzLlxuICAgKi9cbiAgYXN5bmMgcnVuU2NoZWR1bGVkSm9iKHtqb2JDb25maWd1cmF0aW9uLCBqb2JLZXl9KSB7XG4gICAgaWYgKHRoaXMuc3RvcHBlZCB8fCB0aGlzLnBlbmRpbmdFbnF1ZXVlc0J5Sm9iS2V5Lmhhcyhqb2JLZXkpKSByZXR1cm5cblxuICAgIGNvbnN0IHBlbmRpbmdFbnF1ZXVlID0gdGhpcy5lbnF1ZXVlU2NoZWR1bGVkSm9iKHtqb2JDb25maWd1cmF0aW9uLCBqb2JLZXl9KVxuICAgIHRoaXMucGVuZGluZ0VucXVldWVzQnlKb2JLZXkuc2V0KGpvYktleSwgcGVuZGluZ0VucXVldWUpXG5cbiAgICB0cnkge1xuICAgICAgYXdhaXQgcGVuZGluZ0VucXVldWVcbiAgICB9IGZpbmFsbHkge1xuICAgICAgdGhpcy5wZW5kaW5nRW5xdWV1ZXNCeUpvYktleS5kZWxldGUoam9iS2V5KVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGVucXVldWUgc2NoZWR1bGVkIGpvYi5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBPcHRpb25zLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL2NvbmZpZ3VyYXRpb24tdHlwZXMuanNcIikuU2NoZWR1bGVkQmFja2dyb3VuZEpvYkNvbmZpZ3VyYXRpb259IGFyZ3Muam9iQ29uZmlndXJhdGlvbiAtIEpvYiBjb25maWd1cmF0aW9uLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gYXJncy5qb2JLZXkgLSBKb2Iga2V5LlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn1cbiAgICovXG4gIGFzeW5jIGVucXVldWVTY2hlZHVsZWRKb2Ioe2pvYkNvbmZpZ3VyYXRpb24sIGpvYktleX0pIHtcbiAgICB0cnkge1xuICAgICAgLy8gRGUtZHVwbGljYXRlIHNjaGVkdWxlZCBlbnF1ZXVlcyBieSBkZWZhdWx0OiBhIHBlcmlvZGljIGpvYiBzdGlsbCBwZW5kaW5nIGZyb20gYW4gZWFybGllclxuICAgICAgLy8gdGljayBpcyBub3QgZW5xdWV1ZWQgYWdhaW4sIHdoaWNoIGlzIHdoYXQgbGV0IHRoZSBiYWNrZ3JvdW5kX2pvYnMgdGFibGUgZmlsbCB3aXRoIHRob3VzYW5kc1xuICAgICAgLy8gb2YgaWRlbnRpY2FsIHNjaGVkdWxlZCBqb2JzIHdoZW4gdGhlIHF1ZXVlIGJhY2tlZCB1cC4gRGVkdXAgaXMgYnkgam9iIGlkZW50aXR5IChzZWUgdGhlXG4gICAgICAvLyBzdG9yZSksIHNvIHRoZSBqb2Iga2VlcHMgaXRzIHF1ZXVlLWRlcml2ZWQgY29uY3VycmVuY3kgY2FwLiBBIHNjaGVkdWxlIGNhbiBvcHQgb3V0IHdpdGhcbiAgICAgIC8vIGBkZWR1cGxpY2F0ZVdoaWxlUXVldWVkOiBmYWxzZWAuXG4gICAgICBhd2FpdCB0aGlzLl93aXRoU2NoZWR1bGVkRW5xdWV1ZVRpbWVvdXQoe1xuICAgICAgICBqb2JLZXksXG4gICAgICAgIGpvYk5hbWU6IGpvYkNvbmZpZ3VyYXRpb24uY2xhc3Muam9iTmFtZSgpLFxuICAgICAgICBydW46IGFzeW5jICgpID0+IHtcbiAgICAgICAgICBhd2FpdCB0aGlzLmVucXVldWVKb2Ioe1xuICAgICAgICAgICAgYXJnczogQXJyYXkuaXNBcnJheShqb2JDb25maWd1cmF0aW9uLmFyZ3MpID8gam9iQ29uZmlndXJhdGlvbi5hcmdzIDogW10sXG4gICAgICAgICAgICBqb2JDbGFzczogam9iQ29uZmlndXJhdGlvbi5jbGFzcyxcbiAgICAgICAgICAgIGpvYktleSxcbiAgICAgICAgICAgIG9wdGlvbnM6IHtkZWR1cGxpY2F0ZVdoaWxlUXVldWVkOiB0cnVlLCAuLi4oam9iQ29uZmlndXJhdGlvbi5vcHRpb25zIHx8IHt9KX1cbiAgICAgICAgICB9KVxuICAgICAgICB9XG4gICAgICB9KVxuICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICBpZiAoZXJyb3IgaW5zdGFuY2VvZiBTY2hlZHVsZWRCYWNrZ3JvdW5kSm9iRW5xdWV1ZVRpbWVvdXRFcnJvcikge1xuICAgICAgICB0aGlzLl9yZXBvcnRTY2hlZHVsZWRFbnF1ZXVlU3RhbGwoe2Vycm9yLCBqb2JLZXl9KVxuXG4gICAgICAgIHJldHVyblxuICAgICAgfVxuXG4gICAgICBhd2FpdCB0aGlzLmxvZ2dlci5lcnJvcigoKSA9PiBbXCJGYWlsZWQgdG8gZW5xdWV1ZSBzY2hlZHVsZWQgYmFja2dyb3VuZCBqb2JcIiwge2pvYktleSwgam9iTmFtZTogam9iQ29uZmlndXJhdGlvbi5jbGFzcy5qb2JOYW1lKCl9LCBlcnJvcl0pXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgb25lIGR1cmFibGUgZW5xdWV1ZSBhdHRlbXB0IHVuZGVyIHRoZSBzY2hlZHVsZWQtZW5xdWV1ZSBib3VuZC5cbiAgICpcbiAgICogVGhlIGJvdW5kIGlzIGFwcGxpZWQgd2l0aCBhIGxvY2FsIHJhY2UgcmF0aGVyIHRoYW4gYGF3YWl0ZXJ5YCdzIGB0aW1lb3V0KClgOlxuICAgKiB0aGF0IGhlbHBlciBzdGFydHMgaXRzIGNhbGxiYWNrIHRocm91Z2ggYFByb21pc2UucmVzb2x2ZSgpLnRoZW4oLi4uKWAsIHdoaWNoXG4gICAqIHdvdWxkIGRlZmVyIGV2ZXJ5IHNjaGVkdWxlZCBlbnF1ZXVlIGJ5IGEgbWljcm90YXNrIGFuZCBjaGFuZ2UgdGhlIHRpY2tcbiAgICogc2VtYW50aWNzIGNhbGxlcnMgcmVseSBvbi4gSGVyZSB0aGUgYXR0ZW1wdCBzdGFydHMgc3luY2hyb25vdXNseSwgYW5kIHRoZVxuICAgKiB3YXRjaGRvZyB1c2VzIHRoZSBtb2R1bGUtY2FwdHVyZWQgdGltZXJzIHNvIGl0IGlzIG5ldmVyIG9ic2VydmFibGUgYXMgYVxuICAgKiBzY2hlZHVsZSB0aW1lci4gT25seSB0aGUgd2F0Y2hkb2cgcmFpc2VzIHRoZSB0eXBlZCB0aW1lb3V0IGVycm9yLCBzbyBhXG4gICAqIHRpbWVvdXQgcmFpc2VkIGluc2lkZSB0aGUgZW5xdWV1ZSBpdHNlbGYga2VlcHMgaXRzIG93biBlcnJvciBwYXRoLlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIE9wdGlvbnMuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBhcmdzLmpvYktleSAtIFNjaGVkdWxlIGtleS5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGFyZ3Muam9iTmFtZSAtIFJlc29sdmVkIGpvYiBjbGFzcyBuYW1lLlxuICAgKiBAcGFyYW0geygpID0+IFByb21pc2U8dm9pZD59IGFyZ3MucnVuIC0gRW5xdWV1ZSBhdHRlbXB0LlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyB3aGVuIHRoZSBhdHRlbXB0IHNldHRsZXMgd2l0aGluIHRoZSBib3VuZC5cbiAgICovXG4gIGFzeW5jIF93aXRoU2NoZWR1bGVkRW5xdWV1ZVRpbWVvdXQoe2pvYktleSwgam9iTmFtZSwgcnVufSkge1xuICAgIGNvbnN0IHRpbWVvdXRNcyA9IHRoaXMuc2NoZWR1bGVkRW5xdWV1ZVRpbWVvdXRNc1xuICAgIC8qKiBAdHlwZSB7UHJvbWlzZTx2b2lkPn0gKi9cbiAgICBsZXQgYXR0ZW1wdFxuXG4gICAgdHJ5IHtcbiAgICAgIGF0dGVtcHQgPSBQcm9taXNlLnJlc29sdmUocnVuKCkpXG4gICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgIGF0dGVtcHQgPSBQcm9taXNlLnJlamVjdCgvKiogQHR5cGUge0Vycm9yfSAqLyAoZXJyb3IpKVxuICAgIH1cblxuICAgIGlmICh0aW1lb3V0TXMgPT09IG51bGwpIHJldHVybiBhd2FpdCBhdHRlbXB0XG5cbiAgICAvKipcbiAgICAgKiBSZWplY3RzIHRoZSB3YXRjaGRvZyBwcm9taXNlIHdoZW4gdGhlIGJvdW5kIGV4cGlyZXMuXG4gICAgICogQHR5cGUgeyhlcnJvcjogRXJyb3IpID0+IHZvaWR9ICovXG4gICAgbGV0IHJlamVjdFNjaGVkdWxlZEVucXVldWVUaW1lb3V0ID0gKCkgPT4ge31cbiAgICBjb25zdCB3YXRjaGRvZyA9IG5ldyBQcm9taXNlKChfLCByZWplY3QpID0+IHsgcmVqZWN0U2NoZWR1bGVkRW5xdWV1ZVRpbWVvdXQgPSByZWplY3QgfSlcbiAgICAvKipcbiAgICAgKiBXYXRjaGRvZyB0aW1lciBoYW5kbGUuXG4gICAgICogQHR5cGUge1JldHVyblR5cGU8dHlwZW9mIGFybVdhdGNoZG9nVGltZXI+fSAqL1xuICAgIGNvbnN0IHdhdGNoZG9nSWQgPSBhcm1XYXRjaGRvZ1RpbWVyKCgpID0+IHtcbiAgICAgIHJlamVjdFNjaGVkdWxlZEVucXVldWVUaW1lb3V0KG5ldyBTY2hlZHVsZWRCYWNrZ3JvdW5kSm9iRW5xdWV1ZVRpbWVvdXRFcnJvcih7XG4gICAgICAgIGpvYktleSxcbiAgICAgICAgam9iTmFtZSxcbiAgICAgICAgc2NoZWR1bGVkRW5xdWV1ZVRpbWVvdXRNczogdGltZW91dE1zXG4gICAgICB9KSlcbiAgICB9LCB0aW1lb3V0TXMpXG5cbiAgICB0cnkge1xuICAgICAgcmV0dXJuIGF3YWl0IFByb21pc2UucmFjZShbYXR0ZW1wdCwgd2F0Y2hkb2ddKVxuICAgIH0gZmluYWxseSB7XG4gICAgICBjYW5jZWxXYXRjaGRvZ1RpbWVyKHdhdGNoZG9nSWQpXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIFN1cmZhY2VzIGEgc2NoZWR1bGVkIGVucXVldWUgd2hvc2Ugc3RvcmUgY2FsbCBuZXZlciBzZXR0bGVkLiBXaXRob3V0IHRoaXMgcmVwb3J0IHRoZSBvbmx5XG4gICAqIHN5bXB0b20gaXMgYSBzY2hlZHVsZSB0aGF0IHNpbGVudGx5IHN0b3BzIGVucXVldWVpbmcgYWZ0ZXIgb25lIHdlZGdlZCBjYWxsLlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIE9wdGlvbnMuXG4gICAqIEBwYXJhbSB7RXJyb3J9IGFyZ3MuZXJyb3IgLSBUaW1lb3V0IGVycm9yLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gYXJncy5qb2JLZXkgLSBTY2hlZHVsZSBrZXkuXG4gICAqIEByZXR1cm5zIHt2b2lkfVxuICAgKi9cbiAgX3JlcG9ydFNjaGVkdWxlZEVucXVldWVTdGFsbCh7ZXJyb3IsIGpvYktleX0pIHtcbiAgICBjb25zdCBwYXlsb2FkID0ge1xuICAgICAgY29udGV4dDoge1xuICAgICAgICBqb2JLZXksXG4gICAgICAgIHNjaGVkdWxlZEVucXVldWVUaW1lb3V0TXM6IHRoaXMuc2NoZWR1bGVkRW5xdWV1ZVRpbWVvdXRNcyxcbiAgICAgICAgc3RhZ2U6IFwiYmFja2dyb3VuZC1qb2JzLXNjaGVkdWxlZC1lbnF1ZXVlLXN0YWxsXCJcbiAgICAgIH0sXG4gICAgICBlcnJvclxuICAgIH1cblxuICAgIHZvaWQgdGhpcy5sb2dnZXIuZXJyb3IoKCkgPT4gW1wiU2NoZWR1bGVkIGJhY2tncm91bmQgam9iIGVucXVldWUgc3RhbGxlZFwiLCBwYXlsb2FkLmNvbnRleHQsIGVycm9yXSlcblxuICAgIGNvbnN0IGVycm9yRXZlbnRzID0gdHlwZW9mIHRoaXMuY29uZmlndXJhdGlvbj8uZ2V0RXJyb3JFdmVudHMgPT09IFwiZnVuY3Rpb25cIiA/IHRoaXMuY29uZmlndXJhdGlvbi5nZXRFcnJvckV2ZW50cygpIDogdW5kZWZpbmVkXG5cbiAgICBpZiAoIWVycm9yRXZlbnRzKSByZXR1cm5cblxuICAgIGVycm9yRXZlbnRzLmVtaXQoXCJmcmFtZXdvcmstZXJyb3JcIiwgcGF5bG9hZClcbiAgICBlcnJvckV2ZW50cy5lbWl0KFwiYWxsLWVycm9yXCIsIHsuLi5wYXlsb2FkLCBlcnJvclR5cGU6IFwiZnJhbWV3b3JrLWVycm9yXCJ9KVxuICB9XG5cbiAgLyoqXG4gICAqIFJlc29sdmVzIHRoZSBzY2hlZHVsZWQtZW5xdWV1ZSBib3VuZCBmcm9tIGNvbmZpZ3VyYXRpb24uXG4gICAqIEByZXR1cm5zIHtudW1iZXIgfCBudWxsfSAtIEJvdW5kIGluIG1pbGxpc2Vjb25kcywgb3IgYG51bGxgIGZvciBhbiB1bmJvdW5kZWQgd2FpdC5cbiAgICovXG4gIF9yZXNvbHZlU2NoZWR1bGVkRW5xdWV1ZVRpbWVvdXRNcygpIHtcbiAgICBjb25zdCBiYWNrZ3JvdW5kSm9ic0NvbmZpZyA9IHR5cGVvZiB0aGlzLmNvbmZpZ3VyYXRpb24/LmdldEJhY2tncm91bmRKb2JzQ29uZmlnID09PSBcImZ1bmN0aW9uXCIgPyB0aGlzLmNvbmZpZ3VyYXRpb24uZ2V0QmFja2dyb3VuZEpvYnNDb25maWcoKSA6IHVuZGVmaW5lZFxuICAgIGNvbnN0IGNvbmZpZ3VyZWQgPSBiYWNrZ3JvdW5kSm9ic0NvbmZpZz8uc2NoZWR1bGVkRW5xdWV1ZVRpbWVvdXRNc1xuXG4gICAgaWYgKGNvbmZpZ3VyZWQgPT09IG51bGwpIHJldHVybiBudWxsXG4gICAgaWYgKHR5cGVvZiBjb25maWd1cmVkID09PSBcIm51bWJlclwiICYmIGNvbmZpZ3VyZWQgPiAwKSByZXR1cm4gY29uZmlndXJlZFxuXG4gICAgcmV0dXJuIERFRkFVTFRfU0NIRURVTEVEX0VOUVVFVUVfVElNRU9VVF9NU1xuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgbm9ybWFsaXplIGV2ZXJ5LlxuICAgKiBAcGFyYW0ge05vbk51bGxhYmxlPGltcG9ydChcIi4uL2NvbmZpZ3VyYXRpb24tdHlwZXMuanNcIikuU2NoZWR1bGVkQmFja2dyb3VuZEpvYkNvbmZpZ3VyYXRpb25bXCJldmVyeVwiXT59IGV2ZXJ5IC0gRXZlcnkgY29uZmlnIChjYWxsZXIgbXVzdCBndWFyYW50ZWUgbm90IHVuZGVmaW5lZCkuXG4gICAqIEByZXR1cm5zIHt7ZXZlcnlWYWx1ZTogbnVtYmVyIHwgc3RyaW5nLCBmaXJzdEluVmFsdWU/OiBudW1iZXIgfCBzdHJpbmd9fSAtIE5vcm1hbGl6ZWQgaW50ZXJ2YWwgYW5kIGZpcnN0LXJ1biBkZWxheSB2YWx1ZXMuXG4gICAqL1xuICBub3JtYWxpemVFdmVyeShldmVyeSkge1xuICAgIGlmIChBcnJheS5pc0FycmF5KGV2ZXJ5KSkge1xuICAgICAgY29uc3QgW2V2ZXJ5VmFsdWUsIGV2ZXJ5T3B0aW9uc10gPSBldmVyeVxuXG4gICAgICBpZiAoIWV2ZXJ5T3B0aW9ucyB8fCB0eXBlb2YgZXZlcnlPcHRpb25zICE9PSBcIm9iamVjdFwiIHx8IEFycmF5LmlzQXJyYXkoZXZlcnlPcHRpb25zKSkge1xuICAgICAgICByZXR1cm4ge2V2ZXJ5VmFsdWV9XG4gICAgICB9XG5cbiAgICAgIHJldHVybiB7ZXZlcnlWYWx1ZSwgZmlyc3RJblZhbHVlOiBldmVyeU9wdGlvbnMuZmlyc3RJbn1cbiAgICB9XG5cbiAgICByZXR1cm4ge2V2ZXJ5VmFsdWU6IGV2ZXJ5fVxuICB9XG59XG4iXX0=