export declare class BackgroundJobPerformedFailure extends Error {
    /**
     * Creates a performed-job failure after its terminal report is acknowledged.
     * @param {Error} cause - A job perform error whose failed terminal report was acknowledged.
     */
    constructor(cause: Error);
}
/**
 * Runs run job payload.
 * @param {import("./types.js").BackgroundJobPayload} payload - Payload.
 * @param {object} [options] - Runner options.
 * @param {boolean} [options.closeConnections] - Whether to gracefully close framework connections after the job.
 * @param {boolean} [options.manageProcessTitle] - Whether to set the per-job process title and restore it afterwards. Off for concurrent pooled runners, where interleaved snapshot/restore of the single process-wide `process.title` would corrupt it; the pooled child owns an aggregate title instead.
 * @param {string} [options.processType] - Generic application process type.
 * @returns {Promise<"completed" | "rescheduled">} - Acknowledged outcome.
 */
export default function runJobPayload(payload: import("./types.js").BackgroundJobPayload, { closeConnections, manageProcessTitle, processType }?: {
    closeConnections?: boolean;
    manageProcessTitle?: boolean;
    processType?: string;
}): Promise<"completed" | "rescheduled">;
//# sourceMappingURL=job-runner.d.ts.map