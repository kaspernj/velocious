import PlatformVelociousJob from "./platform-job.js";
/**
 * Node background-job entry. It preserves lazy configuration discovery for
 * fresh producer processes while the explicit platform entry stays free of
 * Node-only configuration resolution.
 * @template {Array<ReturnType<typeof JSON.parse>>} [TArgs=[]]
 * @augments {PlatformVelociousJob<TArgs>}
 */
export default class VelociousJob<TArgs extends Array<ReturnType<typeof JSON.parse>> = []> extends PlatformVelociousJob<TArgs> {
    /**
     * Runs perform later.
     * @param {...ReturnType<typeof JSON.parse>} args - Job args.
     * @returns {Promise<string>} - Job id.
     */
    static performLater(...args: ReturnType<typeof JSON.parse>[]): Promise<string>;
    /**
     * Runs perform later with options.
     * @param {object} args - Options.
     * @param {Array<ReturnType<typeof JSON.parse>>} args.args - Job args.
     * @param {import("./types.js").BackgroundJobOptions} [args.options] - Job options.
     * @returns {Promise<string>} - Job id.
     */
    static performLaterWithOptions({ args, options }: {
        args: Array<ReturnType<typeof JSON.parse>>;
        options?: import("./types.js").BackgroundJobOptions;
    }): Promise<string>;
    /**
     * Atomically replaces this job class's queued owner for a stable schedule key.
     * @param {object} args - Options.
     * @param {string} args.scheduleKey - Stable logical schedule key.
     * @param {Array<ReturnType<typeof JSON.parse>>} args.args - Job args.
     * @param {import("./types.js").BackgroundJobOptions} [args.options] - Job options.
     * @returns {Promise<import("./types.js").BackgroundJobReplacementResult>} - Replacement result.
     */
    static replaceScheduled({ scheduleKey, args, options }: {
        scheduleKey: string;
        args: Array<ReturnType<typeof JSON.parse>>;
        options?: import("./types.js").BackgroundJobOptions;
    }): Promise<import("./types.js").BackgroundJobReplacementResult>;
    /**
     * Cancels or detaches the current owner of a stable schedule key.
     * @param {string} scheduleKey - Stable logical schedule key.
     * @returns {Promise<import("./types.js").BackgroundJobCancellationResult>} - Cancellation result.
     */
    static cancelScheduled(scheduleKey: string): Promise<import("./types.js").BackgroundJobCancellationResult>;
}
//# sourceMappingURL=job.d.ts.map