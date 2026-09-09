/**
 * Performs a job class inside its declared database-connection scope.
 * @param {object} args - Performance options.
 * @param {import("../configuration.js").default} args.configuration - Active configuration.
 * @param {typeof import("./platform-job.js").default} args.JobClass - Job class.
 * @param {Array<ReturnType<typeof JSON.parse>>} args.jobArgs - Job arguments.
 * @param {import("./types.js").BackgroundJobOptions} [args.jobOptions] - Resolved runtime options.
 * @param {string} args.name - Connection-scope label.
 * @param {import("./types.js").BackgroundJobPayload} [args.payload] - Persisted runner payload.
 * @returns {Promise<void>} - Resolves after performance.
 */
export default function performBackgroundJob({ configuration, JobClass, jobArgs, jobOptions, name, payload }: {
    configuration: import("../configuration.js").default;
    JobClass: typeof import("./platform-job.js").default;
    jobArgs: Array<ReturnType<typeof JSON.parse>>;
    jobOptions?: import("./types.js").BackgroundJobOptions;
    name: string;
    payload?: import("./types.js").BackgroundJobPayload;
}): Promise<void>;
//# sourceMappingURL=perform-job.d.ts.map