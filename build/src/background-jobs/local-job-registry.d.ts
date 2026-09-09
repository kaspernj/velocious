import VelociousJob from "./platform-job.js";
/** Static, bundler-safe local background-job registry. */
export default class LocalBackgroundJobRegistry {
    jobClasses: (typeof VelociousJob)[];
    /** @type {Map<string, typeof VelociousJob> | undefined} */
    jobsByName: Map<string, typeof VelociousJob> | undefined;
    /**
     * Creates a registry from the configuration's statically imported job classes.
     * @param {{jobClasses: Array<typeof VelociousJob>}} args - Registry options.
     */
    constructor({ jobClasses }: {
        jobClasses: Array<typeof VelociousJob>;
    });
    /**
     * Validates and indexes the configured job classes.
     * @returns {void} - No return value.
     */
    ensureReady(): void;
    /**
     * Resolves a registered class.
     * @param {string} jobName - Persisted job name.
     * @returns {typeof VelociousJob} - Registered class.
     */
    resolve(jobName: string): typeof VelociousJob;
}
//# sourceMappingURL=local-job-registry.d.ts.map