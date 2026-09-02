export type BackgroundJobExecutionMode = "inline" | "forked" | "pooled" | "spawned";
export type BackgroundJobsGenerationInitialState = "candidate" | "active" | "retired";
export type BackgroundJobsGenerationLifecycleState = "starting" | "candidate" | "active" | "retiring" | "retired" | "stopped";
export type BackgroundJobsGenerationRejectionReason = "missing-generation" | "unexpected-generation" | "malformed-generation" | "generation-mismatch" | "worker-admission-retired" | "worker-has-no-recoverable-handoffs";
export type LocalBackgroundJobsClock = {
    /**
     * - Current epoch milliseconds.
     */
    now: () => number;
    /**
     * - Arms a timer.
     */
    setTimeout: (callback: () => void, delayMs: number) => ReturnType<typeof setTimeout> | number;
    /**
     * - Clears a timer.
     */
    clearTimeout: (timerId: ReturnType<typeof setTimeout> | number) => void;
};
export type ResolvedBackgroundJobConcurrency = {
    /**
     * - Durable cap identity.
     */
    concurrencyKey: string;
    /**
     * - Positive cap.
     */
    maxConcurrency: number;
    /**
     * - Whether queue configuration owns the cap.
     */
    queueDerived: boolean;
};
export type PreparedLocalBackgroundJob = {
    /**
     * - Fixed-width digest of the serialized arguments.
     */
    argsDigest: string;
    /**
     * - Serialized arguments.
     */
    argsJson: string;
    /**
     * - Resolved concurrency.
     */
    concurrency: ResolvedBackgroundJobConcurrency | null;
    /**
     * - Creation timestamp.
     */
    createdAtMs: number;
    /**
     * - Local in-process execution mode.
     */
    executionMode: "inline";
    /**
     * - Durable id.
     */
    jobId: string;
    /**
     * - Registered name.
     */
    jobName: string;
    /**
     * - Retry cap.
     */
    maxRetries: number;
    /**
     * - Queue name.
     */
    queue: string;
    /**
     * - Eligibility timestamp.
     */
    scheduledAtMs: number;
};
export type BackgroundJobsHealth = {
    /**
     * - Whether the adapter can accept and process work.
     */
    ready: boolean;
};
export type BackgroundJobsProducer = {
    /**
     * - Enqueues a job.
     */
    enqueue: (args: {
        jobName: string;
        args: Array<ReturnType<typeof JSON.parse>>;
        options?: BackgroundJobOptions;
    }) => Promise<string>;
    /**
     * - Replaces a stable schedule.
     */
    replaceScheduled: (args: {
        scheduleKey: string;
        jobName: string;
        args: Array<ReturnType<typeof JSON.parse>>;
        options?: BackgroundJobOptions;
    }) => Promise<BackgroundJobReplacementResult>;
    /**
     * - Cancels a stable schedule.
     */
    cancelScheduled: (args: {
        scheduleKey: string;
    }) => Promise<BackgroundJobCancellationResult>;
};
export type BackgroundJobHandoff = {
    /**
     * - Unique handoff lease id.
     */
    handoffId: string;
    /**
     * - Time handed to a worker in ms.
     */
    handedOffAtMs: number;
};
export type BackgroundJobHandoffSnapshot = {
    /**
     * - Job holding the lease.
     */
    jobId: string;
    /**
     * - Exact durable lease id.
     */
    handoffId: string;
    /**
     * - Stable worker id that received the lease.
     */
    workerId: string;
    /**
     * - Time handed to the worker in ms.
     */
    handedOffAtMs: number;
};
export type BackgroundJobHandoffRequest = {
    /**
     * - Job to claim.
     */
    jobId: string;
    /**
     * - Exact caller-selected lease id. Adapters must persist and return this id when supplied; built-in adapters generate one when omitted for legacy direct callers.
     */
    handoffId?: string;
    /**
     * - Worker claiming the job.
     */
    workerId?: string;
};
export type BackgroundJobOptions = {
    /**
     * - How the job should run. Node defaults to `"pooled"` (a warm, reused local runner process). Browser/Expo local dispatch defaults to and only accepts `"inline"`. `"forked"` runs a Node job in a fresh `child_process.fork()` child, and `"spawned"` in a detached CLI runner.
     */
    executionMode?: BackgroundJobExecutionMode;
    /**
     * - Max retries for a failed job before it is marked failed.
     */
    maxRetries?: number;
    /**
     * - Queue name. Defaults to `"default"`. When the queue has a configured cap in `backgroundJobs.queues`, that cap is enforced cluster-wide.
     */
    queue?: string;
    /**
     * - Opaque non-empty key used to share a concurrency cap. Overrides any queue-derived cap.
     */
    concurrencyKey?: string;
    /**
     * - Positive integer cap; must be paired with `concurrencyKey`.
     */
    maxConcurrency?: number;
    /**
     * - When true, skip the enqueue if an identical still-queued job (same job name, args and queue) is scheduled no later than this enqueue, returning the earliest matching job's id. A future retry does not suppress earlier work. Deduplication is independent of `concurrencyKey`, so the job keeps its normal (e.g. queue-derived) concurrency cap. Keeps an interval-scheduled recurring job (e.g. retention pruning) from piling up redundant queued rows when it runs slower than its interval or no worker is free.
     */
    deduplicateWhileQueued?: boolean;
    /**
     * - Durable enqueue identity scoped to the resolved job class name and queue. Exact replay returns the original job id across every state and after job pruning; reuse with different canonical arguments or behavior-affecting options fails. Ownership is independent of `deduplicateWhileQueued` and is retained until an explicit future retention policy removes it.
     */
    idempotencyKey?: string;
    /**
     * - Epoch timestamp in milliseconds when the job becomes eligible for dispatch. Defaults to enqueue time.
     */
    scheduledAtMs?: number;
    /**
     * - Per-job wall-clock timeout for forked and pooled execution. A positive integer up to 2,147,483,647 overrides the worker-level `jobTimeoutMs`; a non-positive finite value disables the timeout for this job.
     */
    timeoutMs?: number;
};
export type BackgroundJobPayload = {
    /**
     * - Job id.
     */
    id?: string;
    /**
     * - Job class name.
     */
    jobName: string;
    /**
     * - Serialized job arguments.
     */
    args?: Array<ReturnType<typeof JSON.parse>>;
    /**
     * - Unique handoff lease id.
     */
    handoffId?: string;
    /**
     * - Worker id handling the job.
     */
    workerId?: string;
    /**
     * - Time handed to a worker in ms.
     */
    handedOffAtMs?: number;
    /**
     * - Runtime options.
     */
    options?: BackgroundJobOptions;
};
export type BackgroundJobContext = {
    /**
     * - Concrete job class.
     */
    jobClass: typeof import("./platform-job.js").default;
    /**
     * - Registered job name.
     */
    jobName: string;
    /**
     * - Serialized job arguments.
     */
    args: Array<ReturnType<typeof JSON.parse>>;
    /**
     * - Resolved enqueue/runtime options.
     */
    options: BackgroundJobOptions;
    /**
     * - Complete persisted runner payload when the job is performing.
     */
    payload?: BackgroundJobPayload;
};
export type BackgroundJobRow = {
    /**
     * - Job id.
     */
    id: string;
    /**
     * - Job class name.
     */
    jobName: string;
    /**
     * - Serialized job arguments.
     */
    args: Array<ReturnType<typeof JSON.parse>>;
    /**
     * - How the job should run.
     */
    executionMode: BackgroundJobExecutionMode;
    /**
     * - Queue name (defaults to `"default"`).
     */
    queue: string;
    /**
     * - Stable logical schedule key retained for history.
     */
    scheduleKey: string | null;
    /**
     * - Current job status.
     */
    status: string;
    /**
     * - Failure attempts count.
     */
    attempts: number | null;
    /**
     * - Max retry attempts.
     */
    maxRetries: number | null;
    /**
     * - Next scheduled time in ms.
     */
    scheduledAtMs: number | null;
    /**
     * - Creation time in ms.
     */
    createdAtMs: number | null;
    /**
     * - Time handed to worker in ms.
     */
    handedOffAtMs: number | null;
    /**
     * - Unique latest handoff lease id.
     */
    handoffId: string | null;
    /**
     * - Completion time in ms.
     */
    completedAtMs: number | null;
    /**
     * - Failure time in ms.
     */
    failedAtMs: number | null;
    /**
     * - Orphaned time in ms.
     */
    orphanedAtMs: number | null;
    /**
     * - Worker id handling the job.
     */
    workerId: string | null;
    /**
     * - Last failure message.
     */
    lastError: string | null;
    /**
     * - Durable concurrency key.
     */
    concurrencyKey: string | null;
    /**
     * - Durable per-key cap.
     */
    maxConcurrency: number | null;
    /**
     * - Per-job wall-clock timeout override, or null when omitted.
     */
    timeoutMs: number | null;
};
export type BackgroundJobReplacementPreviousStatus = "queued" | "handed_off" | null;
export type BackgroundJobReplacementResult = {
    /**
     * - Newly queued job id.
     */
    jobId: string;
    /**
     * - Previous active owner's job id.
     */
    previousJobId: string | null;
    /**
     * - Previous owner's observed state.
     */
    previousStatus: BackgroundJobReplacementPreviousStatus;
};
export type BackgroundJobCancellationOutcome = "cancelled" | "handed_off" | "not_found";
export type BackgroundJobCancellationResult = {
    /**
     * - Detached owner's job id, when one was active.
     */
    jobId: string | null;
    /**
     * - Truthful best-effort outcome.
     */
    outcome: BackgroundJobCancellationOutcome;
};
export type BackgroundJobFailureEvent = {
    /**
     * - Updated job row after failure handling.
     */
    job: BackgroundJobRow;
    /**
     * - Failure error.
     */
    error: ReturnType<typeof JSON.parse>;
    /**
     * - Updated failure attempts count.
     */
    attempts: number | null;
    /**
     * - Whether this failure ended the job.
     */
    terminal: boolean;
    /**
     * - Whether the job was returned to the queue.
     */
    willRetry: boolean;
    /**
     * - Handoff lease id from the worker report.
     */
    handoffId: string | undefined;
    /**
     * - Handoff timestamp from the worker report.
     */
    handedOffAtMs: number | undefined;
    /**
     * - Worker id from the worker report.
     */
    workerId: string | undefined;
};
export type BackgroundJobSocketRole = "worker" | "client" | "reporter";
export type BackgroundJobHelloMessage = {
    type: "hello";
    role: BackgroundJobSocketRole;
    generationId?: string;
    supportsHandoffIdReporting?: boolean;
    supportsHeartbeat?: boolean;
    supportsPooled?: boolean;
    workerId?: string;
};
export type BackgroundJobGenerationAcceptedMessage = {
    type: "generation-accepted";
    generationId: string;
    lifecycleState: BackgroundJobsGenerationLifecycleState;
};
export type BackgroundJobGenerationRejectedMessage = {
    type: "generation-rejected";
    reason: BackgroundJobsGenerationRejectionReason;
};
export type BackgroundJobReadyMessage = {
    type: "ready";
    acceptsForked?: boolean;
    acceptsInline?: boolean;
    acceptsPooled?: boolean;
    acceptsSpawned?: boolean;
    availablePooledSlots?: number;
};
export type BackgroundJobDrainingMessage = {
    type: "draining";
};
export type BackgroundJobHeartbeatMessage = {
    type: "heartbeat";
    workerId?: string;
};
export type BackgroundJobEnqueueMessage = {
    type: "enqueue";
    jobName: string;
    args?: Array<ReturnType<typeof JSON.parse>>;
    options?: BackgroundJobOptions;
};
export type BackgroundJobEnqueuedMessage = {
    type: "enqueued";
    jobId: string;
};
export type BackgroundJobEnqueueErrorMessage = {
    type: "enqueue-error";
    error?: string;
};
export type BackgroundJobReplaceScheduledMessage = {
    type: "replace-scheduled";
    scheduleKey: string;
    jobName: string;
    args?: Array<ReturnType<typeof JSON.parse>>;
    options?: BackgroundJobOptions;
};
export type BackgroundJobScheduleReplacedMessage = {
    type: "schedule-replaced";
    jobId: string;
    previousJobId: string | null;
    previousStatus: BackgroundJobReplacementPreviousStatus;
};
export type BackgroundJobReplaceScheduledErrorMessage = {
    type: "replace-scheduled-error";
    error?: string;
};
export type BackgroundJobCancelScheduledMessage = {
    type: "cancel-scheduled";
    scheduleKey: string;
};
export type BackgroundJobScheduleCancelledMessage = {
    type: "schedule-cancelled";
    jobId: string | null;
    outcome: BackgroundJobCancellationOutcome;
};
export type BackgroundJobCancelScheduledErrorMessage = {
    type: "cancel-scheduled-error";
    error?: string;
};
export type BackgroundJobJobMessage = {
    type: "job";
    payload: BackgroundJobPayload;
};
export type BackgroundJobCompleteMessage = {
    type: "job-complete";
    jobId: string;
    handoffId?: string;
    workerId?: string;
    handedOffAtMs?: number;
};
export type BackgroundJobFailedMessage = {
    type: "job-failed";
    jobId: string;
    error?: ReturnType<typeof JSON.parse>;
    handoffId?: string;
    workerId?: string;
    handedOffAtMs?: number;
};
export type BackgroundJobRescheduleMessage = {
    type: "job-reschedule";
    jobId: string;
    delayMs: number;
    handoffId?: string;
    workerId?: string;
    handedOffAtMs?: number;
};
export type BackgroundJobUpdatedMessage = {
    type: "job-updated";
    jobId: string;
};
export type BackgroundJobUpdateErrorMessage = {
    type: "job-update-error";
    jobId: string;
    error?: string;
};
export type BackgroundJobSocketMessage = BackgroundJobHelloMessage | BackgroundJobGenerationAcceptedMessage | BackgroundJobGenerationRejectedMessage | BackgroundJobReadyMessage | BackgroundJobDrainingMessage | BackgroundJobHeartbeatMessage | BackgroundJobEnqueueMessage | BackgroundJobEnqueuedMessage | BackgroundJobEnqueueErrorMessage | BackgroundJobReplaceScheduledMessage | BackgroundJobScheduleReplacedMessage | BackgroundJobReplaceScheduledErrorMessage | BackgroundJobCancelScheduledMessage | BackgroundJobScheduleCancelledMessage | BackgroundJobCancelScheduledErrorMessage | BackgroundJobJobMessage | BackgroundJobCompleteMessage | BackgroundJobFailedMessage | BackgroundJobRescheduleMessage | BackgroundJobUpdatedMessage | BackgroundJobUpdateErrorMessage;
/**
 * @typedef {"inline" | "forked" | "pooled" | "spawned"} BackgroundJobExecutionMode
 */
/** @typedef {"candidate" | "active" | "retired"} BackgroundJobsGenerationInitialState */
/** @typedef {"starting" | "candidate" | "active" | "retiring" | "retired" | "stopped"} BackgroundJobsGenerationLifecycleState */
/** @typedef {"missing-generation" | "unexpected-generation" | "malformed-generation" | "generation-mismatch" | "worker-admission-retired" | "worker-has-no-recoverable-handoffs"} BackgroundJobsGenerationRejectionReason */
/**
 * @typedef {object} LocalBackgroundJobsClock
 * @property {() => number} now - Current epoch milliseconds.
 * @property {(callback: () => void, delayMs: number) => ReturnType<typeof setTimeout> | number} setTimeout - Arms a timer.
 * @property {(timerId: ReturnType<typeof setTimeout> | number) => void} clearTimeout - Clears a timer.
 */
/**
 * @typedef {object} ResolvedBackgroundJobConcurrency
 * @property {string} concurrencyKey - Durable cap identity.
 * @property {number} maxConcurrency - Positive cap.
 * @property {boolean} queueDerived - Whether queue configuration owns the cap.
 */
/**
 * @typedef {object} PreparedLocalBackgroundJob
 * @property {string} argsDigest - Fixed-width digest of the serialized arguments.
 * @property {string} argsJson - Serialized arguments.
 * @property {ResolvedBackgroundJobConcurrency | null} concurrency - Resolved concurrency.
 * @property {number} createdAtMs - Creation timestamp.
 * @property {"inline"} executionMode - Local in-process execution mode.
 * @property {string} jobId - Durable id.
 * @property {string} jobName - Registered name.
 * @property {number} maxRetries - Retry cap.
 * @property {string} queue - Queue name.
 * @property {number} scheduledAtMs - Eligibility timestamp.
 */
/**
 * @typedef {object} BackgroundJobsHealth
 * @property {boolean} ready - Whether the adapter can accept and process work.
 */
/**
 * @typedef {object} BackgroundJobsProducer
 * @property {(args: {jobName: string, args: Array<ReturnType<typeof JSON.parse>>, options?: BackgroundJobOptions}) => Promise<string>} enqueue - Enqueues a job.
 * @property {(args: {scheduleKey: string, jobName: string, args: Array<ReturnType<typeof JSON.parse>>, options?: BackgroundJobOptions}) => Promise<BackgroundJobReplacementResult>} replaceScheduled - Replaces a stable schedule.
 * @property {(args: {scheduleKey: string}) => Promise<BackgroundJobCancellationResult>} cancelScheduled - Cancels a stable schedule.
 */
/**
 * @typedef {object} BackgroundJobHandoff
 * @property {string} handoffId - Unique handoff lease id.
 * @property {number} handedOffAtMs - Time handed to a worker in ms.
 */
/**
 * @typedef {object} BackgroundJobHandoffSnapshot
 * @property {string} jobId - Job holding the lease.
 * @property {string} handoffId - Exact durable lease id.
 * @property {string} workerId - Stable worker id that received the lease.
 * @property {number} handedOffAtMs - Time handed to the worker in ms.
 */
/**
 * @typedef {object} BackgroundJobHandoffRequest
 * @property {string} jobId - Job to claim.
 * @property {string} [handoffId] - Exact caller-selected lease id. Adapters must persist and return this id when supplied; built-in adapters generate one when omitted for legacy direct callers.
 * @property {string} [workerId] - Worker claiming the job.
 */
/**
 * @typedef {object} BackgroundJobOptions
 * @property {BackgroundJobExecutionMode} [executionMode] - How the job should run. Node defaults to `"pooled"` (a warm, reused local runner process). Browser/Expo local dispatch defaults to and only accepts `"inline"`. `"forked"` runs a Node job in a fresh `child_process.fork()` child, and `"spawned"` in a detached CLI runner.
 * @property {number} [maxRetries] - Max retries for a failed job before it is marked failed.
 * @property {string} [queue] - Queue name. Defaults to `"default"`. When the queue has a configured cap in `backgroundJobs.queues`, that cap is enforced cluster-wide.
 * @property {string} [concurrencyKey] - Opaque non-empty key used to share a concurrency cap. Overrides any queue-derived cap.
 * @property {number} [maxConcurrency] - Positive integer cap; must be paired with `concurrencyKey`.
 * @property {boolean} [deduplicateWhileQueued] - When true, skip the enqueue if an identical still-queued job (same job name, args and queue) is scheduled no later than this enqueue, returning the earliest matching job's id. A future retry does not suppress earlier work. Deduplication is independent of `concurrencyKey`, so the job keeps its normal (e.g. queue-derived) concurrency cap. Keeps an interval-scheduled recurring job (e.g. retention pruning) from piling up redundant queued rows when it runs slower than its interval or no worker is free.
 * @property {string} [idempotencyKey] - Durable enqueue identity scoped to the resolved job class name and queue. Exact replay returns the original job id across every state and after job pruning; reuse with different canonical arguments or behavior-affecting options fails. Ownership is independent of `deduplicateWhileQueued` and is retained until an explicit future retention policy removes it.
 * @property {number} [scheduledAtMs] - Epoch timestamp in milliseconds when the job becomes eligible for dispatch. Defaults to enqueue time.
 * @property {number} [timeoutMs] - Per-job wall-clock timeout for forked and pooled execution. A positive integer up to 2,147,483,647 overrides the worker-level `jobTimeoutMs`; a non-positive finite value disables the timeout for this job.
 */
/**
 * @typedef {object} BackgroundJobPayload
 * @property {string} [id] - Job id.
 * @property {string} jobName - Job class name.
 * @property {Array<ReturnType<typeof JSON.parse>>} [args] - Serialized job arguments.
 * @property {string} [handoffId] - Unique handoff lease id.
 * @property {string} [workerId] - Worker id handling the job.
 * @property {number} [handedOffAtMs] - Time handed to a worker in ms.
 * @property {BackgroundJobOptions} [options] - Runtime options.
 */
/**
 * @typedef {object} BackgroundJobContext
 * @property {typeof import("./platform-job.js").default} jobClass - Concrete job class.
 * @property {string} jobName - Registered job name.
 * @property {Array<ReturnType<typeof JSON.parse>>} args - Serialized job arguments.
 * @property {BackgroundJobOptions} options - Resolved enqueue/runtime options.
 * @property {BackgroundJobPayload} [payload] - Complete persisted runner payload when the job is performing.
 */
/**
 * @typedef {object} BackgroundJobRow
 * @property {string} id - Job id.
 * @property {string} jobName - Job class name.
 * @property {Array<ReturnType<typeof JSON.parse>>} args - Serialized job arguments.
 * @property {BackgroundJobExecutionMode} executionMode - How the job should run.
 * @property {string} queue - Queue name (defaults to `"default"`).
 * @property {string | null} scheduleKey - Stable logical schedule key retained for history.
 * @property {string} status - Current job status.
 * @property {number | null} attempts - Failure attempts count.
 * @property {number | null} maxRetries - Max retry attempts.
 * @property {number | null} scheduledAtMs - Next scheduled time in ms.
 * @property {number | null} createdAtMs - Creation time in ms.
 * @property {number | null} handedOffAtMs - Time handed to worker in ms.
 * @property {string | null} handoffId - Unique latest handoff lease id.
 * @property {number | null} completedAtMs - Completion time in ms.
 * @property {number | null} failedAtMs - Failure time in ms.
 * @property {number | null} orphanedAtMs - Orphaned time in ms.
 * @property {string | null} workerId - Worker id handling the job.
 * @property {string | null} lastError - Last failure message.
 * @property {string | null} concurrencyKey - Durable concurrency key.
 * @property {number | null} maxConcurrency - Durable per-key cap.
 * @property {number | null} timeoutMs - Per-job wall-clock timeout override, or null when omitted.
 */
/**
 * @typedef {"queued" | "handed_off" | null} BackgroundJobReplacementPreviousStatus
 */
/**
 * @typedef {object} BackgroundJobReplacementResult
 * @property {string} jobId - Newly queued job id.
 * @property {string | null} previousJobId - Previous active owner's job id.
 * @property {BackgroundJobReplacementPreviousStatus} previousStatus - Previous owner's observed state.
 */
/**
 * @typedef {"cancelled" | "handed_off" | "not_found"} BackgroundJobCancellationOutcome
 */
/**
 * @typedef {object} BackgroundJobCancellationResult
 * @property {string | null} jobId - Detached owner's job id, when one was active.
 * @property {BackgroundJobCancellationOutcome} outcome - Truthful best-effort outcome.
 */
/**
 * @typedef {object} BackgroundJobFailureEvent
 * @property {BackgroundJobRow} job - Updated job row after failure handling.
 * @property {ReturnType<typeof JSON.parse>} error - Failure error.
 * @property {number | null} attempts - Updated failure attempts count.
 * @property {boolean} terminal - Whether this failure ended the job.
 * @property {boolean} willRetry - Whether the job was returned to the queue.
 * @property {string | undefined} handoffId - Handoff lease id from the worker report.
 * @property {number | undefined} handedOffAtMs - Handoff timestamp from the worker report.
 * @property {string | undefined} workerId - Worker id from the worker report.
 */
/**
 * @typedef {"worker" | "client" | "reporter"} BackgroundJobSocketRole
 */
/**
 * @typedef {{type: "hello", role: BackgroundJobSocketRole, generationId?: string, supportsHandoffIdReporting?: boolean, supportsHeartbeat?: boolean, supportsPooled?: boolean, workerId?: string}} BackgroundJobHelloMessage
 * @typedef {{type: "generation-accepted", generationId: string, lifecycleState: BackgroundJobsGenerationLifecycleState}} BackgroundJobGenerationAcceptedMessage
 * @typedef {{type: "generation-rejected", reason: BackgroundJobsGenerationRejectionReason}} BackgroundJobGenerationRejectedMessage
 * @typedef {{type: "ready", acceptsForked?: boolean, acceptsInline?: boolean, acceptsPooled?: boolean, acceptsSpawned?: boolean, availablePooledSlots?: number}} BackgroundJobReadyMessage
 * @typedef {{type: "draining"}} BackgroundJobDrainingMessage
 * @typedef {{type: "heartbeat", workerId?: string}} BackgroundJobHeartbeatMessage
 * @typedef {{type: "enqueue", jobName: string, args?: Array<ReturnType<typeof JSON.parse>>, options?: BackgroundJobOptions}} BackgroundJobEnqueueMessage
 * @typedef {{type: "enqueued", jobId: string}} BackgroundJobEnqueuedMessage
 * @typedef {{type: "enqueue-error", error?: string}} BackgroundJobEnqueueErrorMessage
 * @typedef {{type: "replace-scheduled", scheduleKey: string, jobName: string, args?: Array<ReturnType<typeof JSON.parse>>, options?: BackgroundJobOptions}} BackgroundJobReplaceScheduledMessage
 * @typedef {{type: "schedule-replaced", jobId: string, previousJobId: string | null, previousStatus: BackgroundJobReplacementPreviousStatus}} BackgroundJobScheduleReplacedMessage
 * @typedef {{type: "replace-scheduled-error", error?: string}} BackgroundJobReplaceScheduledErrorMessage
 * @typedef {{type: "cancel-scheduled", scheduleKey: string}} BackgroundJobCancelScheduledMessage
 * @typedef {{type: "schedule-cancelled", jobId: string | null, outcome: BackgroundJobCancellationOutcome}} BackgroundJobScheduleCancelledMessage
 * @typedef {{type: "cancel-scheduled-error", error?: string}} BackgroundJobCancelScheduledErrorMessage
 * @typedef {{type: "job", payload: BackgroundJobPayload}} BackgroundJobJobMessage
 * @typedef {{type: "job-complete", jobId: string, handoffId?: string, workerId?: string, handedOffAtMs?: number}} BackgroundJobCompleteMessage
 * @typedef {{type: "job-failed", jobId: string, error?: ReturnType<typeof JSON.parse>, handoffId?: string, workerId?: string, handedOffAtMs?: number}} BackgroundJobFailedMessage
 * @typedef {{type: "job-reschedule", jobId: string, delayMs: number, handoffId?: string, workerId?: string, handedOffAtMs?: number}} BackgroundJobRescheduleMessage
 * @typedef {{type: "job-updated", jobId: string}} BackgroundJobUpdatedMessage
 * @typedef {{type: "job-update-error", jobId: string, error?: string}} BackgroundJobUpdateErrorMessage
 */
/**
 * @typedef {BackgroundJobHelloMessage | BackgroundJobGenerationAcceptedMessage | BackgroundJobGenerationRejectedMessage | BackgroundJobReadyMessage | BackgroundJobDrainingMessage | BackgroundJobHeartbeatMessage | BackgroundJobEnqueueMessage | BackgroundJobEnqueuedMessage | BackgroundJobEnqueueErrorMessage | BackgroundJobReplaceScheduledMessage | BackgroundJobScheduleReplacedMessage | BackgroundJobReplaceScheduledErrorMessage | BackgroundJobCancelScheduledMessage | BackgroundJobScheduleCancelledMessage | BackgroundJobCancelScheduledErrorMessage | BackgroundJobJobMessage | BackgroundJobCompleteMessage | BackgroundJobFailedMessage | BackgroundJobRescheduleMessage | BackgroundJobUpdatedMessage | BackgroundJobUpdateErrorMessage} BackgroundJobSocketMessage
 */
export declare const nothing: {};
//# sourceMappingURL=types.d.ts.map