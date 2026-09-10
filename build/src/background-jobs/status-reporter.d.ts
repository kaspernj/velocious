import Logger from "../logger.js";
import BackgroundJobsSocketRequest from "./socket-request.js";
export default class BackgroundJobsStatusReporter {
    configuration: import("../configuration.js").default;
    host: string | undefined;
    port: number | undefined;
    attemptTimeoutMs: number;
    generationHandshakeTimeoutMs: number;
    explicitGenerationId: string | undefined;
    /**
     * Internal test-only observability state — NOT public API. References the most
     * recent socket request so the timeout spec can inspect how its socket was torn
     * down. Do not expose or depend on this outside tests.
     * @type {BackgroundJobsSocketRequest | undefined}
     */
    _lastRequest: BackgroundJobsSocketRequest | undefined;
    logger: Logger;
    /**
     * Runs constructor.
     * @param {object} args - Options.
     * @param {import("../configuration.js").default} args.configuration - Configuration.
     * @param {string} [args.host] - Host.
     * @param {number} [args.port] - Port.
     * @param {number} [args.attemptTimeoutMs] - Per-attempt socket-request timeout in milliseconds (default: 5000).
     * @param {string} [args.generationId] - Explicit release generation identity.
     * @param {number} [args.generationHandshakeTimeoutMs] - Maximum time to wait for generation acknowledgement (default: 4000).
     */
    constructor({ configuration, host, port, attemptTimeoutMs, generationHandshakeTimeoutMs, generationId }: {
        configuration: import("../configuration.js").default;
        host?: string;
        port?: number;
        attemptTimeoutMs?: number;
        generationId?: string;
        generationHandshakeTimeoutMs?: number;
    });
    /**
     * Runs report.
     * @param {object} args - Options.
     * @param {string} args.jobId - Job id.
     * @param {"completed" | "failed" | "rescheduled"} args.status - Status.
     * @param {number} [args.delayMs] - Reschedule delay in milliseconds.
     * @param {ReturnType<typeof JSON.parse>} [args.error] - Error.
     * @param {string} [args.handoffId] - Handoff lease id.
     * @param {number} [args.handedOffAtMs] - Handed off timestamp.
     * @param {string} [args.workerId] - Worker id.
     * @param {import("./types.js").PooledRunnerFailure} [args.runnerFailure] - Pooled-child process failure provenance.
     * @returns {Promise<void>} - Resolves when reported.
     */
    report({ jobId, status, delayMs, error, handoffId, handedOffAtMs, workerId, runnerFailure }: {
        jobId: string;
        status: "completed" | "failed" | "rescheduled";
        delayMs?: number;
        error?: ReturnType<typeof JSON.parse>;
        handoffId?: string;
        handedOffAtMs?: number;
        workerId?: string;
        runnerFailure?: import("./types.js").PooledRunnerFailure;
    }): Promise<void>;
    /**
     * Runs report child accepted.
     * @param {object} args - Options.
     * @param {string} args.jobId - Job id.
     * @param {string} [args.handoffId] - Handoff lease id.
     * @param {string} [args.workerId] - Worker id.
     * @param {number} [args.handedOffAtMs] - Handed off timestamp.
     * @param {number} [args.receivedAtMs] - Epoch ms the runner child received the job.
     * @param {number} [args.startedAtMs] - Epoch ms the job's perform started in the child.
     * @param {string} [args.childInstanceId] - Stable pooled child identity.
     * @param {number} [args.childPid] - Pooled child OS pid.
     * @returns {Promise<void>} - Resolves when reported.
     */
    reportChildAccepted({ jobId, handoffId, workerId, handedOffAtMs, receivedAtMs, startedAtMs, childInstanceId, childPid }: {
        jobId: string;
        handoffId?: string;
        workerId?: string;
        handedOffAtMs?: number;
        receivedAtMs?: number;
        startedAtMs?: number;
        childInstanceId?: string;
        childPid?: number;
    }): Promise<void>;
    /**
     * Runs report child accepted with retry. Acceptance evidence is diagnostic
     * rather than terminal, so a transient main/DB failure retries only until
     * `maxDurationMs` elapses and then gives up instead of stranding the report.
     * @param {object} args - Options.
     * @param {string} args.jobId - Job id.
     * @param {string} [args.handoffId] - Handoff lease id.
     * @param {string} [args.workerId] - Worker id.
     * @param {number} [args.handedOffAtMs] - Handed off timestamp.
     * @param {number} [args.receivedAtMs] - Epoch ms the runner child received the job.
     * @param {number} [args.startedAtMs] - Epoch ms the job's perform started in the child.
     * @param {string} [args.childInstanceId] - Stable pooled child identity.
     * @param {number} [args.childPid] - Pooled child OS pid.
     * @param {number} args.maxDurationMs - Max duration for retries.
     * @returns {Promise<void>} - Resolves when reported or the budget elapses.
     */
    reportChildAcceptedWithRetry({ jobId, handoffId, workerId, handedOffAtMs, receivedAtMs, startedAtMs, childInstanceId, childPid, maxDurationMs }: {
        jobId: string;
        handoffId?: string;
        workerId?: string;
        handedOffAtMs?: number;
        receivedAtMs?: number;
        startedAtMs?: number;
        childInstanceId?: string;
        childPid?: number;
        maxDurationMs: number;
    }): Promise<void>;
    /**
     * Runs report with retry.
     * @param {object} args - Options.
     * @param {string} args.jobId - Job id.
     * @param {"completed" | "failed" | "rescheduled"} args.status - Status.
     * @param {number} [args.delayMs] - Reschedule delay in milliseconds.
     * @param {ReturnType<typeof JSON.parse>} [args.error] - Error.
     * @param {string} [args.handoffId] - Handoff lease id.
     * @param {number} [args.handedOffAtMs] - Handed off timestamp.
     * @param {string} [args.workerId] - Worker id.
     * @param {import("./types.js").PooledRunnerFailure} [args.runnerFailure] - Pooled-child process failure provenance.
     * @param {number} [args.maxDurationMs] - Max duration for retries.
     * @param {boolean} [args.retryPersistErrors] - Retry a `BackgroundJobUpdateError` (main's `job-update-error`, i.e. a transient DB failure while persisting the terminal status) instead of throwing immediately. Off by default so short-lived forked/spawned runners keep failing loudly and exit non-zero to be reclaimed; on for the long-lived worker, which cannot exit to trigger orphan reclaim and would otherwise drop the completion and strand the row in `handed_off`.
     * @returns {Promise<void>} - Resolves when reported.
     */
    reportWithRetry({ jobId, status, delayMs, error, handoffId, handedOffAtMs, workerId, runnerFailure, maxDurationMs, retryPersistErrors }: {
        jobId: string;
        status: "completed" | "failed" | "rescheduled";
        delayMs?: number;
        error?: ReturnType<typeof JSON.parse>;
        handoffId?: string;
        handedOffAtMs?: number;
        workerId?: string;
        runnerFailure?: import("./types.js").PooledRunnerFailure;
        maxDurationMs?: number;
        retryPersistErrors?: boolean;
    }): Promise<void>;
}
//# sourceMappingURL=status-reporter.d.ts.map