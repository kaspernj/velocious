export declare const DEFAULT_BACKGROUND_JOB_EXECUTION_MODE = "pooled";
export declare const DEFAULT_BACKGROUND_JOB_MAX_RETRIES = 10;
export declare const DEFAULT_BACKGROUND_JOB_QUEUE = "default";
export declare const QUEUE_CONCURRENCY_KEY_PREFIX = "queue:";
/** @type {import("./types.js").BackgroundJobExecutionMode[]} */
export declare const BACKGROUND_JOB_EXECUTION_MODES: import("./types.js").BackgroundJobExecutionMode[];
/**
 * Normalizes a job queue.
 * @param {import("./types.js").BackgroundJobOptions} [options] - Job options.
 * @returns {string} - Queue name.
 */
export declare function normalizeBackgroundJobQueue(options?: import("./types.js").BackgroundJobOptions): string;
/**
 * Normalizes an explicit execution mode while retaining the Node default.
 * @param {Omit<import("./types.js").BackgroundJobOptions, "executionMode"> & {executionMode?: string}} options - Job options.
 * @param {import("./types.js").BackgroundJobExecutionMode} [defaultExecutionMode] - Default mode.
 * @param {import("./types.js").BackgroundJobExecutionMode[]} [supportedExecutionModes] - Modes accepted by the caller.
 * @returns {import("./types.js").BackgroundJobExecutionMode} - Execution mode.
 */
export declare function normalizeBackgroundJobExecutionMode(options?: Omit<import("./types.js").BackgroundJobOptions, "executionMode"> & {
    executionMode?: string;
}, defaultExecutionMode?: import("./types.js").BackgroundJobExecutionMode, supportedExecutionModes?: import("./types.js").BackgroundJobExecutionMode[]): import("./types.js").BackgroundJobExecutionMode;
/**
 * Validates and normalizes a retry cap.
 * @param {number | null | undefined} maxRetries - Requested retry cap.
 * @returns {number} - Retry cap.
 */
export declare function normalizeBackgroundJobMaxRetries(maxRetries: number | null | undefined): number;
/**
 * Validates an enqueue eligibility timestamp.
 * @param {number | undefined} scheduledAtMs - Requested timestamp.
 * @param {number} defaultScheduledAtMs - Default timestamp.
 * @returns {number} - Eligibility timestamp.
 */
export declare function normalizeBackgroundJobScheduledAtMs(scheduledAtMs: number | undefined, defaultScheduledAtMs: number): number;
/**
 * Validates a reschedule delay and resolves it at persistence time.
 * @param {number} delayMs - Requested delay.
 * @param {number} nowMs - Persistence timestamp.
 * @returns {number} - New eligibility timestamp.
 */
export declare function rescheduledBackgroundJobAtMs(delayMs: number, nowMs: number): number;
/**
 * Returns the shared failure backoff.
 * @param {number} retryCount - One-based failed attempt count.
 * @returns {number} - Backoff in milliseconds.
 */
export declare function retryDelayMs(retryCount: number): number;
/**
 * Resolves explicit or queue-derived concurrency.
 * @param {object} args - Resolution arguments.
 * @param {import("./types.js").BackgroundJobOptions} args.options - Job options.
 * @param {string} args.queue - Normalized queue.
 * @param {Record<string, {maxConcurrent?: number, priority?: number}>} args.queues - Queue configuration.
 * @returns {import("./types.js").ResolvedBackgroundJobConcurrency | null} - Concurrency contract.
 */
export declare function normalizeBackgroundJobConcurrency({ options, queue, queues }: {
    options: import("./types.js").BackgroundJobOptions;
    queue: string;
    queues: Record<string, {
        maxConcurrent?: number;
        priority?: number;
    }>;
}): import("./types.js").ResolvedBackgroundJobConcurrency | null;
//# sourceMappingURL=job-semantics.d.ts.map