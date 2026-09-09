import VelociousJob from "./platform-job.js";
export default class BackgroundJobRegistry {
    configuration: import("../configuration.js").default;
    /**
     * Narrows the runtime value to the documented type.
     * @type {Map<string, typeof VelociousJob>} */
    jobsByName: Map<string, typeof VelociousJob>;
    /**
     * Runs constructor.
     * @param {object} args - Options.
     * @param {import("../configuration.js").default} args.configuration - Configuration.
     */
    constructor({ configuration }: {
        configuration: import("../configuration.js").default;
    });
    /**
     * Runs load.
     * @returns {Promise<void>} - Resolves when complete.
     */
    load(): Promise<void>;
    /**
     * Runs get job by name.
     * @param {string} jobName - Job name.
     * @returns {typeof VelociousJob} - Job class.
     */
    getJobByName(jobName: string): typeof VelociousJob;
    /**
     * Runs load jobs from directory.
     * @param {string} jobsDir - Directory with job files.
     * @param {object} args - Options.
     * @param {boolean} args.skipDuplicates - Whether to skip duplicate job names.
     * @returns {Promise<void>} - Resolves when complete.
     */
    _loadJobsFromDirectory(jobsDir: string, { skipDuplicates }: {
        skipDuplicates: boolean;
    }): Promise<void>;
}
//# sourceMappingURL=job-registry.d.ts.map