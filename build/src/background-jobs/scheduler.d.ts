import Logger from "../logger.js";
export type DurationUnit = keyof typeof DURATION_MULTIPLIERS;
/**
 * DurationUnit type.
 * @typedef {keyof typeof DURATION_MULTIPLIERS} DurationUnit */
declare const DURATION_MULTIPLIERS: {
    d: number;
    day: number;
    days: number;
    h: number;
    hour: number;
    hours: number;
    m: number;
    minute: number;
    minutes: number;
    ms: number;
    s: number;
    second: number;
    seconds: number;
    w: number;
    week: number;
    weeks: number;
};
/**
 * Runs the parseScheduledDuration helper.
 * @param {number | string} value - Duration value.
 * @param {string} fieldName - Field name for errors.
 * @returns {number} - Duration in milliseconds.
 */
export declare function parseScheduledDuration(value: number | string, fieldName: string): number;
/** Runs configured recurring background job schedules. */
export default class BackgroundJobsScheduler {
    configuration: import("../configuration.js").default;
    enqueueJob: (args: {
        args: Array<ReturnType<typeof JSON.parse>>;
        jobClass: typeof import("./job.js").default;
        jobKey: string;
        options: import("./types.js").BackgroundJobOptions;
    }) => Promise<void>;
    logger: Logger;
    /** @type {number | null} - Bound (ms) for one scheduled enqueue attempt; `null` disables the bound. */
    scheduledEnqueueTimeoutMs: number | null;
    /**
     * Narrows the runtime value to the documented type.
     * @type {Array<ReturnType<typeof setInterval>>} */
    intervalIds: Array<ReturnType<typeof setInterval>>;
    /**
     * Narrows the runtime value to the documented type.
     * @type {Array<ReturnType<typeof setTimeout>>} */
    timeoutIds: Array<ReturnType<typeof setTimeout>>;
    /** @type {Map<string, Promise<void>>} - In-flight scheduled enqueues by schedule key that shutdown must drain. */
    pendingEnqueuesByJobKey: Map<string, Promise<void>>;
    /**
     * Narrows the runtime value to the documented type.
     * @type {boolean} - True between stop() and the next start(); cron self-rescheduler checks this so a stop() during an in-flight enqueue doesn't immediately re-arm.
     */
    stopped: boolean;
    /**
     * Runs constructor.
     * @param {object} args - Options.
     * @param {import("../configuration.js").default} args.configuration - Configuration.
     * @param {(args: {args: Array<ReturnType<typeof JSON.parse>>, jobClass: typeof import("./job.js").default, jobKey: string, options: import("./types.js").BackgroundJobOptions}) => Promise<void>} args.enqueueJob - Enqueue callback.
     */
    constructor({ configuration, enqueueJob }: {
        configuration: import("../configuration.js").default;
        enqueueJob: (args: {
            args: Array<ReturnType<typeof JSON.parse>>;
            jobClass: typeof import("./job.js").default;
            jobKey: string;
            options: import("./types.js").BackgroundJobOptions;
        }) => Promise<void>;
    });
    /**
     * Runs start.
     * @returns {Promise<void>} */
    start(): Promise<void>;
    /**
     * Runs stop.
     * @returns {Promise<void>} Resolves after in-flight scheduled enqueues finish.
     */
    stop(): Promise<void>;
    /**
     * Runs schedule job.
     * @param {object} args - Options.
     * @param {import("../configuration-types.js").ScheduledBackgroundJobConfiguration} args.jobConfiguration - Job configuration.
     * @param {string} args.jobKey - Job key.
     * @returns {void}
     */
    scheduleJob({ jobConfiguration, jobKey }: {
        jobConfiguration: import("../configuration-types.js").ScheduledBackgroundJobConfiguration;
        jobKey: string;
    }): void;
    /**
     * Runs schedule every job.
     * @param {object} args - Options.
     * @param {import("../configuration-types.js").ScheduledBackgroundJobConfiguration} args.jobConfiguration - Job configuration.
     * @param {string} args.jobKey - Job key.
     * @returns {void}
     */
    scheduleEveryJob({ jobConfiguration, jobKey }: {
        jobConfiguration: import("../configuration-types.js").ScheduledBackgroundJobConfiguration;
        jobKey: string;
    }): void;
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
    scheduleCronJob({ jobConfiguration, jobKey }: {
        jobConfiguration: import("../configuration-types.js").ScheduledBackgroundJobConfiguration;
        jobKey: string;
    }): void;
    /**
     * Tracks a scheduled enqueue so stop() cannot return while it can still mutate the store.
     * @param {object} args - Options.
     * @param {import("../configuration-types.js").ScheduledBackgroundJobConfiguration} args.jobConfiguration - Job configuration.
     * @param {string} args.jobKey - Job key.
     * @returns {Promise<void>} - Resolves after the enqueue attempt finishes.
     */
    runScheduledJob({ jobConfiguration, jobKey }: {
        jobConfiguration: import("../configuration-types.js").ScheduledBackgroundJobConfiguration;
        jobKey: string;
    }): Promise<void>;
    /**
     * Runs enqueue scheduled job.
     * @param {object} args - Options.
     * @param {import("../configuration-types.js").ScheduledBackgroundJobConfiguration} args.jobConfiguration - Job configuration.
     * @param {string} args.jobKey - Job key.
     * @returns {Promise<void>}
     */
    enqueueScheduledJob({ jobConfiguration, jobKey }: {
        jobConfiguration: import("../configuration-types.js").ScheduledBackgroundJobConfiguration;
        jobKey: string;
    }): Promise<void>;
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
    _withScheduledEnqueueTimeout({ jobKey, jobName, run }: {
        jobKey: string;
        jobName: string;
        run: () => Promise<void>;
    }): Promise<void>;
    /**
     * Surfaces a scheduled enqueue whose store call never settled. Without this report the only
     * symptom is a schedule that silently stops enqueueing after one wedged call.
     * @param {object} args - Options.
     * @param {Error} args.error - Timeout error.
     * @param {string} args.jobKey - Schedule key.
     * @returns {void}
     */
    _reportScheduledEnqueueStall({ error, jobKey }: {
        error: Error;
        jobKey: string;
    }): void;
    /**
     * Resolves the scheduled-enqueue bound from configuration.
     * @returns {number | null} - Bound in milliseconds, or `null` for an unbounded wait.
     */
    _resolveScheduledEnqueueTimeoutMs(): number | null;
    /**
     * Runs normalize every.
     * @param {NonNullable<import("../configuration-types.js").ScheduledBackgroundJobConfiguration["every"]>} every - Every config (caller must guarantee not undefined).
     * @returns {{everyValue: number | string, firstInValue?: number | string}} - Normalized interval and first-run delay values.
     */
    normalizeEvery(every: NonNullable<import("../configuration-types.js").ScheduledBackgroundJobConfiguration["every"]>): {
        everyValue: number | string;
        firstInValue?: number | string;
    };
}
export {};
//# sourceMappingURL=scheduler.d.ts.map