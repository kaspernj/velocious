// @ts-check
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
            await this.enqueueJob({
                args: Array.isArray(jobConfiguration.args) ? jobConfiguration.args : [],
                jobClass: jobConfiguration.class,
                jobKey,
                options: { deduplicateWhileQueued: true, ...(jobConfiguration.options || {}) }
            });
        }
        catch (error) {
            await this.logger.error(() => ["Failed to enqueue scheduled background job", { jobKey, jobName: jobConfiguration.class.jobName() }, error]);
        }
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoic2NoZWR1bGVyLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiLi4vLi4vLi4vc3JjL2JhY2tncm91bmQtam9icy9zY2hlZHVsZXIuanMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6IkFBQUEsWUFBWTtBQUVaLE9BQU8sTUFBTSxNQUFNLGNBQWMsQ0FBQTtBQUNqQyxPQUFPLEVBQUMsZ0JBQWdCLEVBQUUsbUJBQW1CLEVBQUMsTUFBTSxzQkFBc0IsQ0FBQTtBQUUxRTs7K0RBRStEO0FBQy9ELE1BQU0sb0JBQW9CLEdBQUc7SUFDM0IsQ0FBQyxFQUFFLEVBQUUsR0FBRyxFQUFFLEdBQUcsRUFBRSxHQUFHLElBQUk7SUFDdEIsR0FBRyxFQUFFLEVBQUUsR0FBRyxFQUFFLEdBQUcsRUFBRSxHQUFHLElBQUk7SUFDeEIsSUFBSSxFQUFFLEVBQUUsR0FBRyxFQUFFLEdBQUcsRUFBRSxHQUFHLElBQUk7SUFDekIsQ0FBQyxFQUFFLEVBQUUsR0FBRyxFQUFFLEdBQUcsSUFBSTtJQUNqQixJQUFJLEVBQUUsRUFBRSxHQUFHLEVBQUUsR0FBRyxJQUFJO0lBQ3BCLEtBQUssRUFBRSxFQUFFLEdBQUcsRUFBRSxHQUFHLElBQUk7SUFDckIsQ0FBQyxFQUFFLEVBQUUsR0FBRyxJQUFJO0lBQ1osTUFBTSxFQUFFLEVBQUUsR0FBRyxJQUFJO0lBQ2pCLE9BQU8sRUFBRSxFQUFFLEdBQUcsSUFBSTtJQUNsQixFQUFFLEVBQUUsQ0FBQztJQUNMLENBQUMsRUFBRSxJQUFJO0lBQ1AsTUFBTSxFQUFFLElBQUk7SUFDWixPQUFPLEVBQUUsSUFBSTtJQUNiLENBQUMsRUFBRSxDQUFDLEdBQUcsRUFBRSxHQUFHLEVBQUUsR0FBRyxFQUFFLEdBQUcsSUFBSTtJQUMxQixJQUFJLEVBQUUsQ0FBQyxHQUFHLEVBQUUsR0FBRyxFQUFFLEdBQUcsRUFBRSxHQUFHLElBQUk7SUFDN0IsS0FBSyxFQUFFLENBQUMsR0FBRyxFQUFFLEdBQUcsRUFBRSxHQUFHLEVBQUUsR0FBRyxJQUFJO0NBQy9C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Z2dlci5qc1wiXG5pbXBvcnQge25leHRDcm9uRmlyZURhdGUsIHBhcnNlQ3JvbkV4cHJlc3Npb259IGZyb20gXCIuL2Nyb24tZXhwcmVzc2lvbi5qc1wiXG5cbi8qKlxuICogRHVyYXRpb25Vbml0IHR5cGUuXG4gKiBAdHlwZWRlZiB7a2V5b2YgdHlwZW9mIERVUkFUSU9OX01VTFRJUExJRVJTfSBEdXJhdGlvblVuaXQgKi9cbmNvbnN0IERVUkFUSU9OX01VTFRJUExJRVJTID0ge1xuICBkOiAyNCAqIDYwICogNjAgKiAxMDAwLFxuICBkYXk6IDI0ICogNjAgKiA2MCAqIDEwMDAsXG4gIGRheXM6IDI0ICogNjAgKiA2MCAqIDEwMDAsXG4gIGg6IDYwICogNjAgKiAxMDAwLFxuICBob3VyOiA2MCAqIDYwICogMTAwMCxcbiAgaG91cnM6IDYwICogNjAgKiAxMDAwLFxuICBtOiA2MCAqIDEwMDAsXG4gIG1pbnV0ZTogNjAgKiAxMDAwLFxuICBtaW51dGVzOiA2MCAqIDEwMDAsXG4gIG1zOiAxLFxuICBzOiAxMDAwLFxuICBzZWNvbmQ6IDEwMDAsXG4gIHNlY29uZHM6IDEwMDAsXG4gIHc6IDcgKiAyNCAqIDYwICogNjAgKiAxMDAwLFxuICB3ZWVrOiA3ICogMjQgKiA2MCAqIDYwICogMTAwMCxcbiAgd2Vla3M6IDcgKiAyNCAqIDYwICogNjAgKiAxMDAwXG59XG5cbi8qKlxuICogUnVucyB0aGUgcGFyc2VTY2hlZHVsZWREdXJhdGlvbiBoZWxwZXIuXG4gKiBAcGFyYW0ge251bWJlciB8IHN0cmluZ30gdmFsdWUgLSBEdXJhdGlvbiB2YWx1ZS5cbiAqIEBwYXJhbSB7c3RyaW5nfSBmaWVsZE5hbWUgLSBGaWVsZCBuYW1lIGZvciBlcnJvcnMuXG4gKiBAcmV0dXJucyB7bnVtYmVyfSAtIER1cmF0aW9uIGluIG1pbGxpc2Vjb25kcy5cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIHBhcnNlU2NoZWR1bGVkRHVyYXRpb24odmFsdWUsIGZpZWxkTmFtZSkge1xuICBpZiAodHlwZW9mIHZhbHVlID09PSBcIm51bWJlclwiKSB7XG4gICAgaWYgKCFOdW1iZXIuaXNGaW5pdGUodmFsdWUpIHx8IHZhbHVlIDwgMSkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKGBTY2hlZHVsZWQgYmFja2dyb3VuZCBqb2IgJHtmaWVsZE5hbWV9IG11c3QgYmUgYSBwb3NpdGl2ZSBudW1iZXIgb2YgbWlsbGlzZWNvbmRzLmApXG4gICAgfVxuXG4gICAgcmV0dXJuIHZhbHVlXG4gIH1cblxuICBpZiAodHlwZW9mIHZhbHVlICE9PSBcInN0cmluZ1wiIHx8ICF2YWx1ZS50cmltKCkpIHtcbiAgICB0aHJvdyBuZXcgRXJyb3IoYFNjaGVkdWxlZCBiYWNrZ3JvdW5kIGpvYiAke2ZpZWxkTmFtZX0gbXVzdCBiZSBhIG5vbi1lbXB0eSBzdHJpbmcgb3IgbnVtYmVyLmApXG4gIH1cblxuICBjb25zdCBub3JtYWxpemVkVmFsdWUgPSB2YWx1ZS50cmltKCkudG9Mb3dlckNhc2UoKVxuICBjb25zdCBtYXRjaCA9IG5vcm1hbGl6ZWRWYWx1ZS5tYXRjaCgvXihcXGQrKD86XFwuXFxkKyk/KVxccyoobXN8c3xtfGh8ZHx3fHNlY29uZHxzZWNvbmRzfG1pbnV0ZXxtaW51dGVzfGhvdXJ8aG91cnN8ZGF5fGRheXN8d2Vla3x3ZWVrcykkLylcblxuICBpZiAoIW1hdGNoKSB7XG4gICAgdGhyb3cgbmV3IEVycm9yKGBJbnZhbGlkIHNjaGVkdWxlZCBiYWNrZ3JvdW5kIGpvYiAke2ZpZWxkTmFtZX06ICR7dmFsdWV9YClcbiAgfVxuXG4gIGNvbnN0IG51bWVyaWNWYWx1ZSA9IE51bWJlcihtYXRjaFsxXSlcbiAgY29uc3QgbXVsdGlwbGllciA9IERVUkFUSU9OX01VTFRJUExJRVJTWy8qKiBAdHlwZSB7RHVyYXRpb25Vbml0fSAqLyAobWF0Y2hbMl0pXVxuXG4gIGlmICghbXVsdGlwbGllcikge1xuICAgIHRocm93IG5ldyBFcnJvcihgSW52YWxpZCBzY2hlZHVsZWQgYmFja2dyb3VuZCBqb2IgJHtmaWVsZE5hbWV9OiAke3ZhbHVlfWApXG4gIH1cblxuICByZXR1cm4gTWF0aC5yb3VuZChudW1lcmljVmFsdWUgKiBtdWx0aXBsaWVyKVxufVxuXG4vKiogUnVucyBjb25maWd1cmVkIHJlY3VycmluZyBiYWNrZ3JvdW5kIGpvYiBzY2hlZHVsZXMuICovXG5leHBvcnQgZGVmYXVsdCBjbGFzcyBCYWNrZ3JvdW5kSm9ic1NjaGVkdWxlciB7XG4gIC8qKlxuICAgKiBSdW5zIGNvbnN0cnVjdG9yLlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIE9wdGlvbnMuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vY29uZmlndXJhdGlvbi5qc1wiKS5kZWZhdWx0fSBhcmdzLmNvbmZpZ3VyYXRpb24gLSBDb25maWd1cmF0aW9uLlxuICAgKiBAcGFyYW0geyhhcmdzOiB7YXJnczogQXJyYXk8UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+LCBqb2JDbGFzczogdHlwZW9mIGltcG9ydChcIi4vam9iLmpzXCIpLmRlZmF1bHQsIGpvYktleTogc3RyaW5nLCBvcHRpb25zOiBpbXBvcnQoXCIuL3R5cGVzLmpzXCIpLkJhY2tncm91bmRKb2JPcHRpb25zfSkgPT4gUHJvbWlzZTx2b2lkPn0gYXJncy5lbnF1ZXVlSm9iIC0gRW5xdWV1ZSBjYWxsYmFjay5cbiAgICovXG4gIGNvbnN0cnVjdG9yKHtjb25maWd1cmF0aW9uLCBlbnF1ZXVlSm9ifSkge1xuICAgIHRoaXMuY29uZmlndXJhdGlvbiA9IGNvbmZpZ3VyYXRpb25cbiAgICB0aGlzLmVucXVldWVKb2IgPSBlbnF1ZXVlSm9iXG4gICAgdGhpcy5sb2dnZXIgPSBuZXcgTG9nZ2VyKHRoaXMpXG4gICAgLyoqXG4gICAgICogTmFycm93cyB0aGUgcnVudGltZSB2YWx1ZSB0byB0aGUgZG9jdW1lbnRlZCB0eXBlLlxuICAgICAqIEB0eXBlIHtBcnJheTxSZXR1cm5UeXBlPHR5cGVvZiBzZXRJbnRlcnZhbD4+fSAqL1xuICAgIHRoaXMuaW50ZXJ2YWxJZHMgPSBbXVxuICAgIC8qKlxuICAgICAqIE5hcnJvd3MgdGhlIHJ1bnRpbWUgdmFsdWUgdG8gdGhlIGRvY3VtZW50ZWQgdHlwZS5cbiAgICAgKiBAdHlwZSB7QXJyYXk8UmV0dXJuVHlwZTx0eXBlb2Ygc2V0VGltZW91dD4+fSAqL1xuICAgIHRoaXMudGltZW91dElkcyA9IFtdXG4gICAgLyoqIEB0eXBlIHtNYXA8c3RyaW5nLCBQcm9taXNlPHZvaWQ+Pn0gLSBJbi1mbGlnaHQgc2NoZWR1bGVkIGVucXVldWVzIGJ5IHNjaGVkdWxlIGtleSB0aGF0IHNodXRkb3duIG11c3QgZHJhaW4uICovXG4gICAgdGhpcy5wZW5kaW5nRW5xdWV1ZXNCeUpvYktleSA9IG5ldyBNYXAoKVxuICAgIC8qKlxuICAgICAqIE5hcnJvd3MgdGhlIHJ1bnRpbWUgdmFsdWUgdG8gdGhlIGRvY3VtZW50ZWQgdHlwZS5cbiAgICAgKiBAdHlwZSB7Ym9vbGVhbn0gLSBUcnVlIGJldHdlZW4gc3RvcCgpIGFuZCB0aGUgbmV4dCBzdGFydCgpOyBjcm9uIHNlbGYtcmVzY2hlZHVsZXIgY2hlY2tzIHRoaXMgc28gYSBzdG9wKCkgZHVyaW5nIGFuIGluLWZsaWdodCBlbnF1ZXVlIGRvZXNuJ3QgaW1tZWRpYXRlbHkgcmUtYXJtLlxuICAgICAqL1xuICAgIHRoaXMuc3RvcHBlZCA9IGZhbHNlXG4gIH1cblxuICAvKipcbiAgICogUnVucyBzdGFydC5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59ICovXG4gIGFzeW5jIHN0YXJ0KCkge1xuICAgIHRoaXMuc3RvcHBlZCA9IGZhbHNlXG5cbiAgICBjb25zdCBzY2hlZHVsZWRCYWNrZ3JvdW5kSm9ic0NvbmZpZyA9IGF3YWl0IHRoaXMuY29uZmlndXJhdGlvbi5nZXRTY2hlZHVsZWRCYWNrZ3JvdW5kSm9ic0NvbmZpZygpXG5cbiAgICBpZiAoIXNjaGVkdWxlZEJhY2tncm91bmRKb2JzQ29uZmlnPy5qb2JzKSB7XG4gICAgICByZXR1cm5cbiAgICB9XG5cbiAgICBmb3IgKGNvbnN0IGpvYktleSBvZiBPYmplY3Qua2V5cyhzY2hlZHVsZWRCYWNrZ3JvdW5kSm9ic0NvbmZpZy5qb2JzKSkge1xuICAgICAgY29uc3Qgam9iQ29uZmlndXJhdGlvbiA9IHNjaGVkdWxlZEJhY2tncm91bmRKb2JzQ29uZmlnLmpvYnNbam9iS2V5XVxuXG4gICAgICBpZiAoIWpvYkNvbmZpZ3VyYXRpb24gfHwgam9iQ29uZmlndXJhdGlvbi5lbmFibGVkID09PSBmYWxzZSkge1xuICAgICAgICBjb250aW51ZVxuICAgICAgfVxuXG4gICAgICB0aGlzLnNjaGVkdWxlSm9iKHtqb2JDb25maWd1cmF0aW9uLCBqb2JLZXl9KVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHN0b3AuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSBSZXNvbHZlcyBhZnRlciBpbi1mbGlnaHQgc2NoZWR1bGVkIGVucXVldWVzIGZpbmlzaC5cbiAgICovXG4gIGFzeW5jIHN0b3AoKSB7XG4gICAgdGhpcy5zdG9wcGVkID0gdHJ1ZVxuXG4gICAgZm9yIChjb25zdCBpbnRlcnZhbElkIG9mIHRoaXMuaW50ZXJ2YWxJZHMpIHtcbiAgICAgIGNsZWFySW50ZXJ2YWwoaW50ZXJ2YWxJZClcbiAgICB9XG5cbiAgICBmb3IgKGNvbnN0IHRpbWVvdXRJZCBvZiB0aGlzLnRpbWVvdXRJZHMpIHtcbiAgICAgIGNsZWFyVGltZW91dCh0aW1lb3V0SWQpXG4gICAgfVxuXG4gICAgdGhpcy5pbnRlcnZhbElkcyA9IFtdXG4gICAgdGhpcy50aW1lb3V0SWRzID0gW11cblxuICAgIGF3YWl0IFByb21pc2UuYWxsKHRoaXMucGVuZGluZ0VucXVldWVzQnlKb2JLZXkudmFsdWVzKCkpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBzY2hlZHVsZSBqb2IuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gT3B0aW9ucy5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9jb25maWd1cmF0aW9uLXR5cGVzLmpzXCIpLlNjaGVkdWxlZEJhY2tncm91bmRKb2JDb25maWd1cmF0aW9ufSBhcmdzLmpvYkNvbmZpZ3VyYXRpb24gLSBKb2IgY29uZmlndXJhdGlvbi5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGFyZ3Muam9iS2V5IC0gSm9iIGtleS5cbiAgICogQHJldHVybnMge3ZvaWR9XG4gICAqL1xuICBzY2hlZHVsZUpvYih7am9iQ29uZmlndXJhdGlvbiwgam9iS2V5fSkge1xuICAgIGlmICgham9iQ29uZmlndXJhdGlvbi5jbGFzcyB8fCB0eXBlb2Ygam9iQ29uZmlndXJhdGlvbi5jbGFzcy5wZXJmb3JtTGF0ZXJXaXRoT3B0aW9ucyAhPT0gXCJmdW5jdGlvblwiKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoYFNjaGVkdWxlZCBiYWNrZ3JvdW5kIGpvYiAke2pvYktleX0gbXVzdCBkZWZpbmUgYSBqb2IgY2xhc3MuYClcbiAgICB9XG5cbiAgICBpZiAoam9iQ29uZmlndXJhdGlvbi5jcm9uICE9PSB1bmRlZmluZWQgJiYgam9iQ29uZmlndXJhdGlvbi5ldmVyeSAhPT0gdW5kZWZpbmVkKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoYFNjaGVkdWxlZCBiYWNrZ3JvdW5kIGpvYiAke2pvYktleX0gbXVzdCBkZWZpbmUgZWl0aGVyIFwiZXZlcnlcIiBvciBcImNyb25cIiwgbm90IGJvdGguYClcbiAgICB9XG5cbiAgICBpZiAoam9iQ29uZmlndXJhdGlvbi5jcm9uICE9PSB1bmRlZmluZWQpIHtcbiAgICAgIHRoaXMuc2NoZWR1bGVDcm9uSm9iKHtqb2JDb25maWd1cmF0aW9uLCBqb2JLZXl9KVxuXG4gICAgICByZXR1cm5cbiAgICB9XG5cbiAgICBpZiAoam9iQ29uZmlndXJhdGlvbi5ldmVyeSA9PT0gdW5kZWZpbmVkKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoYFNjaGVkdWxlZCBiYWNrZ3JvdW5kIGpvYiAke2pvYktleX0gbXVzdCBkZWZpbmUgZWl0aGVyIFwiZXZlcnlcIiBvciBcImNyb25cIi5gKVxuICAgIH1cblxuICAgIHRoaXMuc2NoZWR1bGVFdmVyeUpvYih7am9iQ29uZmlndXJhdGlvbiwgam9iS2V5fSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHNjaGVkdWxlIGV2ZXJ5IGpvYi5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBPcHRpb25zLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL2NvbmZpZ3VyYXRpb24tdHlwZXMuanNcIikuU2NoZWR1bGVkQmFja2dyb3VuZEpvYkNvbmZpZ3VyYXRpb259IGFyZ3Muam9iQ29uZmlndXJhdGlvbiAtIEpvYiBjb25maWd1cmF0aW9uLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gYXJncy5qb2JLZXkgLSBKb2Iga2V5LlxuICAgKiBAcmV0dXJucyB7dm9pZH1cbiAgICovXG4gIHNjaGVkdWxlRXZlcnlKb2Ioe2pvYkNvbmZpZ3VyYXRpb24sIGpvYktleX0pIHtcbiAgICBjb25zdCBldmVyeUNvbmZpZyA9IC8qKiBAdHlwZSB7Tm9uTnVsbGFibGU8dHlwZW9mIGpvYkNvbmZpZ3VyYXRpb24uZXZlcnk+fSAqLyAoam9iQ29uZmlndXJhdGlvbi5ldmVyeSlcbiAgICBjb25zdCB7ZXZlcnlWYWx1ZSwgZmlyc3RJblZhbHVlfSA9IHRoaXMubm9ybWFsaXplRXZlcnkoZXZlcnlDb25maWcpXG4gICAgY29uc3QgaW50ZXJ2YWxNcyA9IHBhcnNlU2NoZWR1bGVkRHVyYXRpb24oZXZlcnlWYWx1ZSwgYCR7am9iS2V5fS5ldmVyeWApXG4gICAgY29uc3QgZmlyc3RJbk1zID0gZmlyc3RJblZhbHVlICE9PSB1bmRlZmluZWQgPyBwYXJzZVNjaGVkdWxlZER1cmF0aW9uKGZpcnN0SW5WYWx1ZSwgYCR7am9iS2V5fS5maXJzdEluYCkgOiBpbnRlcnZhbE1zXG5cbiAgICBpZiAoaW50ZXJ2YWxNcyA8IDEpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihgU2NoZWR1bGVkIGJhY2tncm91bmQgam9iICR7am9iS2V5fS5ldmVyeSBtdXN0IGJlIGF0IGxlYXN0IDEgbWlsbGlzZWNvbmQuYClcbiAgICB9XG5cbiAgICBjb25zdCB0aW1lb3V0SWQgPSBzZXRUaW1lb3V0KCgpID0+IHtcbiAgICAgIGNvbnN0IHNjaGVkdWxlZEVucXVldWUgPSB0aGlzLnJ1blNjaGVkdWxlZEpvYih7am9iQ29uZmlndXJhdGlvbiwgam9iS2V5fSlcblxuICAgICAgY29uc3QgaW50ZXJ2YWxJZCA9IHNldEludGVydmFsKCgpID0+IHtcbiAgICAgICAgcmV0dXJuIHRoaXMucnVuU2NoZWR1bGVkSm9iKHtqb2JDb25maWd1cmF0aW9uLCBqb2JLZXl9KVxuICAgICAgfSwgaW50ZXJ2YWxNcylcblxuICAgICAgdGhpcy5pbnRlcnZhbElkcy5wdXNoKGludGVydmFsSWQpXG5cbiAgICAgIHJldHVybiBzY2hlZHVsZWRFbnF1ZXVlXG4gICAgfSwgZmlyc3RJbk1zKVxuXG4gICAgdGhpcy50aW1lb3V0SWRzLnB1c2godGltZW91dElkKVxuICB9XG5cbiAgLyoqXG4gICAqIENyb250YWIgc2NoZWR1bGVzIGRvbid0IGhhdmUgYSBjb25zdGFudCBpbnRlcnZhbCAoYDAgOSAqICogMS01YFxuICAgKiBmaXJlcyBvbmNlIHBlciB3ZWVrZGF5IGF0IDkgQU0sIHdpdGggZ2FwcyBvZiB2YXJ5aW5nIGxlbmd0aCksIHNvXG4gICAqIHdlIHNlbGYtcmVzY2hlZHVsZSB3aXRoIGBzZXRUaW1lb3V0YCBhZnRlciBldmVyeSBmaXJlIGluc3RlYWQgb2ZcbiAgICogdXNpbmcgYHNldEludGVydmFsYC5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBPcHRpb25zLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL2NvbmZpZ3VyYXRpb24tdHlwZXMuanNcIikuU2NoZWR1bGVkQmFja2dyb3VuZEpvYkNvbmZpZ3VyYXRpb259IGFyZ3Muam9iQ29uZmlndXJhdGlvbiAtIEpvYiBjb25maWd1cmF0aW9uLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gYXJncy5qb2JLZXkgLSBKb2Iga2V5LlxuICAgKiBAcmV0dXJucyB7dm9pZH1cbiAgICovXG4gIHNjaGVkdWxlQ3JvbkpvYih7am9iQ29uZmlndXJhdGlvbiwgam9iS2V5fSkge1xuICAgIGNvbnN0IGNyb25FeHByZXNzaW9uID0gam9iQ29uZmlndXJhdGlvbi5jcm9uXG5cbiAgICBpZiAodHlwZW9mIGNyb25FeHByZXNzaW9uICE9PSBcInN0cmluZ1wiKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoYFNjaGVkdWxlZCBiYWNrZ3JvdW5kIGpvYiAke2pvYktleX0uY3JvbiBtdXN0IGJlIGEgc3RyaW5nLmApXG4gICAgfVxuXG4gICAgY29uc3QgcGFyc2VkID0gcGFyc2VDcm9uRXhwcmVzc2lvbihjcm9uRXhwcmVzc2lvbilcbiAgICBjb25zdCBzY2hlZHVsZU5leHQgPSAoKSA9PiB7XG4gICAgICBpZiAodGhpcy5zdG9wcGVkKSByZXR1cm5cblxuICAgICAgY29uc3QgbmV4dERhdGUgPSBuZXh0Q3JvbkZpcmVEYXRlKHBhcnNlZCwgbmV3IERhdGUoKSlcbiAgICAgIGNvbnN0IGRlbGF5TXMgPSBNYXRoLm1heCgxLCBuZXh0RGF0ZS5nZXRUaW1lKCkgLSBEYXRlLm5vdygpKVxuICAgICAgY29uc3QgdGltZW91dElkID0gc2V0VGltZW91dChhc3luYyAoKSA9PiB7XG4gICAgICAgIGlmICh0aGlzLnN0b3BwZWQpIHJldHVyblxuXG4gICAgICAgIGF3YWl0IHRoaXMucnVuU2NoZWR1bGVkSm9iKHtqb2JDb25maWd1cmF0aW9uLCBqb2JLZXl9KVxuXG4gICAgICAgIC8vIFRoZSBhd2FpdCBhYm92ZSBjYW4geWllbGQgdG8gYSBzdG9wKCkgY2FsbC4gUmUtY2hlY2sgYmVmb3JlXG4gICAgICAgIC8vIHJlLWFybWluZyBzbyB3ZSBkb24ndCBrZWVwIGZpcmluZyBhZnRlciBzaHV0ZG93bi5cbiAgICAgICAgaWYgKHRoaXMuc3RvcHBlZCkgcmV0dXJuXG5cbiAgICAgICAgc2NoZWR1bGVOZXh0KClcbiAgICAgIH0sIGRlbGF5TXMpXG5cbiAgICAgIHRoaXMudGltZW91dElkcy5wdXNoKHRpbWVvdXRJZClcbiAgICB9XG5cbiAgICBzY2hlZHVsZU5leHQoKVxuICB9XG5cbiAgLyoqXG4gICAqIFRyYWNrcyBhIHNjaGVkdWxlZCBlbnF1ZXVlIHNvIHN0b3AoKSBjYW5ub3QgcmV0dXJuIHdoaWxlIGl0IGNhbiBzdGlsbCBtdXRhdGUgdGhlIHN0b3JlLlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIE9wdGlvbnMuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vY29uZmlndXJhdGlvbi10eXBlcy5qc1wiKS5TY2hlZHVsZWRCYWNrZ3JvdW5kSm9iQ29uZmlndXJhdGlvbn0gYXJncy5qb2JDb25maWd1cmF0aW9uIC0gSm9iIGNvbmZpZ3VyYXRpb24uXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBhcmdzLmpvYktleSAtIEpvYiBrZXkuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIGFmdGVyIHRoZSBlbnF1ZXVlIGF0dGVtcHQgZmluaXNoZXMuXG4gICAqL1xuICBhc3luYyBydW5TY2hlZHVsZWRKb2Ioe2pvYkNvbmZpZ3VyYXRpb24sIGpvYktleX0pIHtcbiAgICBpZiAodGhpcy5zdG9wcGVkIHx8IHRoaXMucGVuZGluZ0VucXVldWVzQnlKb2JLZXkuaGFzKGpvYktleSkpIHJldHVyblxuXG4gICAgY29uc3QgcGVuZGluZ0VucXVldWUgPSB0aGlzLmVucXVldWVTY2hlZHVsZWRKb2Ioe2pvYkNvbmZpZ3VyYXRpb24sIGpvYktleX0pXG4gICAgdGhpcy5wZW5kaW5nRW5xdWV1ZXNCeUpvYktleS5zZXQoam9iS2V5LCBwZW5kaW5nRW5xdWV1ZSlcblxuICAgIHRyeSB7XG4gICAgICBhd2FpdCBwZW5kaW5nRW5xdWV1ZVxuICAgIH0gZmluYWxseSB7XG4gICAgICB0aGlzLnBlbmRpbmdFbnF1ZXVlc0J5Sm9iS2V5LmRlbGV0ZShqb2JLZXkpXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZW5xdWV1ZSBzY2hlZHVsZWQgam9iLlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIE9wdGlvbnMuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vY29uZmlndXJhdGlvbi10eXBlcy5qc1wiKS5TY2hlZHVsZWRCYWNrZ3JvdW5kSm9iQ29uZmlndXJhdGlvbn0gYXJncy5qb2JDb25maWd1cmF0aW9uIC0gSm9iIGNvbmZpZ3VyYXRpb24uXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBhcmdzLmpvYktleSAtIEpvYiBrZXkuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fVxuICAgKi9cbiAgYXN5bmMgZW5xdWV1ZVNjaGVkdWxlZEpvYih7am9iQ29uZmlndXJhdGlvbiwgam9iS2V5fSkge1xuICAgIHRyeSB7XG4gICAgICAvLyBEZS1kdXBsaWNhdGUgc2NoZWR1bGVkIGVucXVldWVzIGJ5IGRlZmF1bHQ6IGEgcGVyaW9kaWMgam9iIHN0aWxsIHBlbmRpbmcgZnJvbSBhbiBlYXJsaWVyXG4gICAgICAvLyB0aWNrIGlzIG5vdCBlbnF1ZXVlZCBhZ2Fpbiwgd2hpY2ggaXMgd2hhdCBsZXQgdGhlIGJhY2tncm91bmRfam9icyB0YWJsZSBmaWxsIHdpdGggdGhvdXNhbmRzXG4gICAgICAvLyBvZiBpZGVudGljYWwgc2NoZWR1bGVkIGpvYnMgd2hlbiB0aGUgcXVldWUgYmFja2VkIHVwLiBEZWR1cCBpcyBieSBqb2IgaWRlbnRpdHkgKHNlZSB0aGVcbiAgICAgIC8vIHN0b3JlKSwgc28gdGhlIGpvYiBrZWVwcyBpdHMgcXVldWUtZGVyaXZlZCBjb25jdXJyZW5jeSBjYXAuIEEgc2NoZWR1bGUgY2FuIG9wdCBvdXQgd2l0aFxuICAgICAgLy8gYGRlZHVwbGljYXRlV2hpbGVRdWV1ZWQ6IGZhbHNlYC5cbiAgICAgIGF3YWl0IHRoaXMuZW5xdWV1ZUpvYih7XG4gICAgICAgIGFyZ3M6IEFycmF5LmlzQXJyYXkoam9iQ29uZmlndXJhdGlvbi5hcmdzKSA/IGpvYkNvbmZpZ3VyYXRpb24uYXJncyA6IFtdLFxuICAgICAgICBqb2JDbGFzczogam9iQ29uZmlndXJhdGlvbi5jbGFzcyxcbiAgICAgICAgam9iS2V5LFxuICAgICAgICBvcHRpb25zOiB7ZGVkdXBsaWNhdGVXaGlsZVF1ZXVlZDogdHJ1ZSwgLi4uKGpvYkNvbmZpZ3VyYXRpb24ub3B0aW9ucyB8fCB7fSl9XG4gICAgICB9KVxuICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICBhd2FpdCB0aGlzLmxvZ2dlci5lcnJvcigoKSA9PiBbXCJGYWlsZWQgdG8gZW5xdWV1ZSBzY2hlZHVsZWQgYmFja2dyb3VuZCBqb2JcIiwge2pvYktleSwgam9iTmFtZTogam9iQ29uZmlndXJhdGlvbi5jbGFzcy5qb2JOYW1lKCl9LCBlcnJvcl0pXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgbm9ybWFsaXplIGV2ZXJ5LlxuICAgKiBAcGFyYW0ge05vbk51bGxhYmxlPGltcG9ydChcIi4uL2NvbmZpZ3VyYXRpb24tdHlwZXMuanNcIikuU2NoZWR1bGVkQmFja2dyb3VuZEpvYkNvbmZpZ3VyYXRpb25bXCJldmVyeVwiXT59IGV2ZXJ5IC0gRXZlcnkgY29uZmlnIChjYWxsZXIgbXVzdCBndWFyYW50ZWUgbm90IHVuZGVmaW5lZCkuXG4gICAqIEByZXR1cm5zIHt7ZXZlcnlWYWx1ZTogbnVtYmVyIHwgc3RyaW5nLCBmaXJzdEluVmFsdWU/OiBudW1iZXIgfCBzdHJpbmd9fSAtIE5vcm1hbGl6ZWQgaW50ZXJ2YWwgYW5kIGZpcnN0LXJ1biBkZWxheSB2YWx1ZXMuXG4gICAqL1xuICBub3JtYWxpemVFdmVyeShldmVyeSkge1xuICAgIGlmIChBcnJheS5pc0FycmF5KGV2ZXJ5KSkge1xuICAgICAgY29uc3QgW2V2ZXJ5VmFsdWUsIGV2ZXJ5T3B0aW9uc10gPSBldmVyeVxuXG4gICAgICBpZiAoIWV2ZXJ5T3B0aW9ucyB8fCB0eXBlb2YgZXZlcnlPcHRpb25zICE9PSBcIm9iamVjdFwiIHx8IEFycmF5LmlzQXJyYXkoZXZlcnlPcHRpb25zKSkge1xuICAgICAgICByZXR1cm4ge2V2ZXJ5VmFsdWV9XG4gICAgICB9XG5cbiAgICAgIHJldHVybiB7ZXZlcnlWYWx1ZSwgZmlyc3RJblZhbHVlOiBldmVyeU9wdGlvbnMuZmlyc3RJbn1cbiAgICB9XG5cbiAgICByZXR1cm4ge2V2ZXJ5VmFsdWU6IGV2ZXJ5fVxuICB9XG59XG4iXX0=