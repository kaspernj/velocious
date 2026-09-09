/**
 * Enqueues durably in background mode or performs immediately in inline mode.
 * @param {object} args - Enqueue request.
 * @param {typeof import("./platform-job.js").default} args.JobClass - Job class.
 * @param {Array<ReturnType<typeof JSON.parse>>} args.jobArgs - Job arguments.
 * @param {import("./types.js").BackgroundJobOptions | undefined} args.jobOptions - Job options.
 * @returns {Promise<string>} - Durable job id or ephemeral inline performance id.
 */
export declare function enqueueBackgroundJob({ JobClass, jobArgs, jobOptions }: {
    JobClass: typeof import("./platform-job.js").default;
    jobArgs: Array<ReturnType<typeof JSON.parse>>;
    jobOptions: import("./types.js").BackgroundJobOptions | undefined;
}): Promise<string>;
/**
 * Enqueues using an explicitly resolved configuration.
 * @param {object} args - Enqueue request.
 * @param {import("../configuration.js").default} args.configuration - Configuration.
 * @param {typeof import("./platform-job.js").default} args.JobClass - Job class.
 * @param {Array<ReturnType<typeof JSON.parse>>} args.jobArgs - Job arguments.
 * @param {import("./types.js").BackgroundJobOptions | undefined} args.jobOptions - Job options.
 * @returns {Promise<string>} - Durable job id or ephemeral inline performance id.
 */
export declare function enqueueBackgroundJobForConfiguration({ configuration, JobClass, jobArgs, jobOptions }: {
    configuration: import("../configuration.js").default;
    JobClass: typeof import("./platform-job.js").default;
    jobArgs: Array<ReturnType<typeof JSON.parse>>;
    jobOptions: import("./types.js").BackgroundJobOptions | undefined;
}): Promise<string>;
/**
 * Replaces a stable durable schedule in background mode.
 * @param {object} args - Replacement request.
 * @param {typeof import("./platform-job.js").default} args.JobClass - Job class.
 * @param {string} args.scheduleKey - Stable schedule key.
 * @param {Array<ReturnType<typeof JSON.parse>>} args.jobArgs - Job arguments.
 * @param {import("./types.js").BackgroundJobOptions | undefined} args.jobOptions - Job options.
 * @returns {Promise<import("./types.js").BackgroundJobReplacementResult>} - Replacement result.
 */
export declare function replaceScheduledBackgroundJob({ JobClass, scheduleKey, jobArgs, jobOptions }: {
    JobClass: typeof import("./platform-job.js").default;
    scheduleKey: string;
    jobArgs: Array<ReturnType<typeof JSON.parse>>;
    jobOptions: import("./types.js").BackgroundJobOptions | undefined;
}): Promise<import("./types.js").BackgroundJobReplacementResult>;
/**
 * Replaces a stable schedule using an explicitly resolved configuration.
 * @param {object} args - Replacement request.
 * @param {import("../configuration.js").default} args.configuration - Configuration.
 * @param {typeof import("./platform-job.js").default} args.JobClass - Job class.
 * @param {string} args.scheduleKey - Stable schedule key.
 * @param {Array<ReturnType<typeof JSON.parse>>} args.jobArgs - Job arguments.
 * @param {import("./types.js").BackgroundJobOptions | undefined} args.jobOptions - Job options.
 * @returns {Promise<import("./types.js").BackgroundJobReplacementResult>} - Replacement result.
 */
export declare function replaceScheduledBackgroundJobForConfiguration({ configuration, JobClass, scheduleKey, jobArgs, jobOptions }: {
    configuration: import("../configuration.js").default;
    JobClass: typeof import("./platform-job.js").default;
    scheduleKey: string;
    jobArgs: Array<ReturnType<typeof JSON.parse>>;
    jobOptions: import("./types.js").BackgroundJobOptions | undefined;
}): Promise<import("./types.js").BackgroundJobReplacementResult>;
/**
 * Cancels a stable durable schedule in background mode.
 * @param {string} scheduleKey - Stable schedule key.
 * @returns {Promise<import("./types.js").BackgroundJobCancellationResult>} - Cancellation result.
 */
export declare function cancelScheduledBackgroundJob(scheduleKey: string): Promise<import("./types.js").BackgroundJobCancellationResult>;
/**
 * Cancels a stable schedule using an explicitly resolved configuration.
 * @param {object} args - Cancellation request.
 * @param {import("../configuration.js").default} args.configuration - Configuration.
 * @param {string} args.scheduleKey - Stable logical schedule key.
 * @returns {Promise<import("./types.js").BackgroundJobCancellationResult>} - Cancellation result.
 */
export declare function cancelScheduledBackgroundJobForConfiguration({ configuration, scheduleKey }: {
    configuration: import("../configuration.js").default;
    scheduleKey: string;
}): Promise<import("./types.js").BackgroundJobCancellationResult>;
//# sourceMappingURL=runtime.d.ts.map