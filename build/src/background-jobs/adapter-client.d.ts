/** Platform-neutral producer client for a configured adapter. */
export default class BackgroundJobsAdapterClient {
    configuration: import("../configuration.js").default;
    /**
     * Creates an adapter-backed producer.
     * @param {{configuration: import("../configuration.js").default}} args - Client options.
     */
    constructor({ configuration }: {
        configuration: import("../configuration.js").default;
    });
    /**
     * Enqueues a job through the configured adapter.
     * @param {{jobName: string, args: Array<ReturnType<typeof JSON.parse>>, options?: import("./types.js").BackgroundJobOptions}} args - Job request.
     * @returns {Promise<string>} - Job id.
     */
    enqueue(args: {
        jobName: string;
        args: Array<ReturnType<typeof JSON.parse>>;
        options?: import("./types.js").BackgroundJobOptions;
    }): Promise<string>;
    /**
     * Replaces a stable schedule through the configured adapter.
     * @param {{scheduleKey: string, jobName: string, args: Array<ReturnType<typeof JSON.parse>>, options?: import("./types.js").BackgroundJobOptions}} args - Replacement request.
     * @returns {Promise<import("./types.js").BackgroundJobReplacementResult>} - Replacement result.
     */
    replaceScheduled(args: {
        scheduleKey: string;
        jobName: string;
        args: Array<ReturnType<typeof JSON.parse>>;
        options?: import("./types.js").BackgroundJobOptions;
    }): Promise<import("./types.js").BackgroundJobReplacementResult>;
    /**
     * Cancels a stable schedule through the configured adapter.
     * @param {{scheduleKey: string}} args - Cancellation request.
     * @returns {Promise<import("./types.js").BackgroundJobCancellationResult>} - Cancellation result.
     */
    cancelScheduled({ scheduleKey }: {
        scheduleKey: string;
    }): Promise<import("./types.js").BackgroundJobCancellationResult>;
    /**
     * Reads a stable schedule through the configured adapter.
     * @param {{scheduleKey: string, includeLatestTerminal?: boolean}} args - Lookup request.
     * @returns {Promise<import("./types.js").BackgroundJobScheduledLookupResult>} - Normalized stable schedule jobs.
     */
    getScheduledJob({ scheduleKey, includeLatestTerminal }: {
        scheduleKey: string;
        includeLatestTerminal?: boolean;
    }): Promise<import("./types.js").BackgroundJobScheduledLookupResult>;
    /**
     * Wakes a stable schedule through the configured adapter.
     * @param {{scheduleKey: string}} args - Wake request.
     * @returns {Promise<import("./types.js").BackgroundJobWakeResult>} - Wake result.
     */
    wakeScheduled({ scheduleKey }: {
        scheduleKey: string;
    }): Promise<import("./types.js").BackgroundJobWakeResult>;
}
//# sourceMappingURL=adapter-client.d.ts.map