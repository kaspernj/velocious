import BackgroundJobsAdapter from "./adapter.js";
import LocalBackgroundJobsDispatcher from "./local-dispatcher.js";
import LocalBackgroundJobRegistry from "./local-job-registry.js";
import LocalBackgroundJobsStore from "./local-store.js";
/** Durable local SQLite adapter with an owned in-process dispatcher. */
export default class LocalBackgroundJobsAdapter extends BackgroundJobsAdapter {
    clock: import("./types.js").LocalBackgroundJobsClock;
    configuration: import("../configuration.js").default;
    registry: LocalBackgroundJobRegistry;
    store: LocalBackgroundJobsStore;
    dispatcher: LocalBackgroundJobsDispatcher;
    /**
     * Creates a local adapter for one configuration and database.
     * @param {object} args - Adapter options.
     * @param {import("../configuration.js").default} args.configuration - Owning configuration.
     * @param {import("./types.js").LocalBackgroundJobsClock} [args.clock] - Injectable clock.
     * @param {string} [args.databaseIdentifier] - Local database identifier.
     */
    constructor({ configuration, clock, databaseIdentifier }: {
        configuration: import("../configuration.js").default;
        clock?: import("./types.js").LocalBackgroundJobsClock;
        databaseIdentifier?: string;
    });
    /**
     * Ensures that local persistence and dispatch are ready.
     * @returns {Promise<void>} - Resolves when local dispatch is ready.
     */
    ensureReady(): Promise<void>;
    /**
     * Stops local dispatch gracefully.
     * @returns {Promise<void>} - Resolves after graceful local shutdown.
     */
    close(): Promise<void>;
    /**
     * Reports local dispatcher health.
     * @returns {Promise<import("./types.js").BackgroundJobsHealth>} - Local adapter health.
     */
    health(): Promise<import("./types.js").BackgroundJobsHealth>;
    /**
     * Reconciles configuration-derived queue concurrency caps.
     * @returns {Promise<void>} - Resolves after queue cap reconciliation.
     */
    reconcileQueueConcurrency(): Promise<void>;
    /**
     * Enqueues one statically registered local job.
     * @param {{jobName: string, args: Array<ReturnType<typeof JSON.parse>>, options?: import("./types.js").BackgroundJobOptions}} args - Enqueue request.
     * @returns {Promise<string>} - Durable local job id.
     */
    enqueue(args: {
        jobName: string;
        args: Array<ReturnType<typeof JSON.parse>>;
        options?: import("./types.js").BackgroundJobOptions;
    }): Promise<string>;
    /**
     * Rejects stable-key cancellation, which is outside the local adapter contract.
     * @param {string} _scheduleKey - Unsupported stable key.
     * @returns {Promise<import("./types.js").BackgroundJobCancellationResult>} - Never resolves.
     */
    cancelScheduled(_scheduleKey: string): Promise<import("./types.js").BackgroundJobCancellationResult>;
    /**
     * Rejects stable-key replacement, which is outside the local adapter contract.
     * @param {{scheduleKey: string, jobName: string, args: Array<ReturnType<typeof JSON.parse>>, options?: import("./types.js").BackgroundJobOptions}} _args - Unsupported request.
     * @returns {Promise<import("./types.js").BackgroundJobReplacementResult>} - Never resolves.
     */
    replaceScheduled(_args: {
        scheduleKey: string;
        jobName: string;
        args: Array<ReturnType<typeof JSON.parse>>;
        options?: import("./types.js").BackgroundJobOptions;
    }): Promise<import("./types.js").BackgroundJobReplacementResult>;
    /**
     * Finds the next eligible local job.
     * @returns {Promise<import("./types.js").BackgroundJobRow | null>} - Next eligible job.
     */
    nextAvailableJob(): Promise<import("./types.js").BackgroundJobRow | null>;
    /**
     * Finds the next future local job.
     * @returns {Promise<import("./types.js").BackgroundJobRow | null>} - Next future job.
     */
    nextScheduledJob(): Promise<import("./types.js").BackgroundJobRow | null>;
    /**
     * Finds a local job by id.
     * @param {string} jobId - Job id.
     * @returns {Promise<import("./types.js").BackgroundJobRow | null>} - Persisted job.
     */
    getJob(jobId: string): Promise<import("./types.js").BackgroundJobRow | null>;
    /**
     * Lists local jobs in insertion order.
     * @returns {Promise<import("./types.js").BackgroundJobRow[]>} - Local jobs.
     */
    listJobs(): Promise<import("./types.js").BackgroundJobRow[]>;
    /**
     * Claims one queued local job.
     * @param {import("./types.js").BackgroundJobHandoffRequest} args - Claim request. A supplied handoff id is persisted exactly.
     * @returns {Promise<import("./types.js").BackgroundJobHandoff | null>} - Handoff.
     */
    markHandedOff(args: import("./types.js").BackgroundJobHandoffRequest): Promise<import("./types.js").BackgroundJobHandoff | null>;
    /**
     * Finds active local handoffs owned by one worker.
     * @param {{workerId: string}} args - Worker identity.
     * @returns {Promise<Array<{jobId: string, handoffId: string}>>} - Active worker handoffs.
     */
    handedOffJobsForWorker(args: {
        workerId: string;
    }): Promise<Array<{
        jobId: string;
        handoffId: string;
    }>>;
    /**
     * Returns an exact active local handoff to the queue.
     * @param {{jobId: string, handoffId: string}} args - Handoff release.
     * @returns {Promise<void>} - Resolves after the fenced release.
     */
    markReturnedToQueue(args: {
        jobId: string;
        handoffId: string;
    }): Promise<void>;
    /**
     * Acknowledges successful local job completion.
     * @param {{jobId: string, handoffId?: string}} args - Completion report.
     * @returns {Promise<boolean>} - Whether accepted.
     */
    markCompleted(args: {
        jobId: string;
        handoffId?: string;
    }): Promise<boolean>;
    /**
     * Acknowledges an explicit local reschedule.
     * @param {{jobId: string, delayMs: number, handoffId?: string}} args - Reschedule report.
     * @returns {Promise<boolean>} - Whether accepted.
     */
    markRescheduled(args: {
        jobId: string;
        delayMs: number;
        handoffId?: string;
    }): Promise<boolean>;
    /**
     * Acknowledges a failed local performance.
     * @param {{jobId: string, error: ReturnType<typeof JSON.parse>, handoffId?: string}} args - Failure report.
     * @returns {Promise<import("./types.js").BackgroundJobRow | null>} - Transition.
     */
    markFailed(args: {
        jobId: string;
        error: ReturnType<typeof JSON.parse>;
        handoffId?: string;
    }): Promise<import("./types.js").BackgroundJobRow | null>;
    /**
     * Coalesces a dispatcher wake.
     * @returns {void} - No return value.
     */
    wake(): void;
    /**
     * Waits until current local work has been acknowledged.
     * @returns {Promise<void>} - Resolves after all current work is acknowledged.
     */
    waitForIdle(): Promise<void>;
}
//# sourceMappingURL=local-adapter.d.ts.map