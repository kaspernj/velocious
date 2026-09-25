// @ts-check
/**
 * @typedef {"inline" | "forked" | "pooled" | "spawned"} BackgroundJobExecutionMode
 */
/** @typedef {"candidate" | "active" | "retired"} BackgroundJobsGenerationInitialState */
/** @typedef {"starting" | "candidate" | "active" | "retiring" | "retired" | "stopped"} BackgroundJobsGenerationLifecycleState */
/** @typedef {"missing-generation" | "unexpected-generation" | "malformed-generation" | "generation-mismatch" | "worker-admission-retired" | "worker-has-no-recoverable-handoffs"} BackgroundJobsGenerationRejectionReason */
/** @typedef {"queued" | "handed_off"} BackgroundJobActiveStatus */
/** @typedef {"cancelled" | "completed" | "failed" | "orphaned"} BackgroundJobTerminalStatus */
/** @typedef {BackgroundJobActiveStatus | BackgroundJobTerminalStatus} BackgroundJobStatus */
/** @typedef {"exit" | "process-error" | "ipc-send"} PooledRunnerFailureOrigin */
/** @typedef {"starting" | "running" | "retiring"} PooledRunnerLifecycleState */
/** @typedef {"parent_retire_drained" | "job_timeout" | "worker_stop" | "signal_sigterm" | "signal_sigint" | "signal_sigkill" | "signal_other" | "ipc_disconnect" | "process_error" | "unexpected_exit"} PooledChildShutdownReason */
/**
 * @deprecated Use PooledChildShutdownReason for exact shutdown provenance.
 * @typedef {"unexpected" | "job-timeout" | "worker-shutdown-timeout"} PooledRunnerTerminationReason
 */
/** @typedef {"running" | "retiring" | "stopping"} BackgroundJobsWorkerLifecycleState */
/**
 * Exact durable handoff ownership carried by an executing job when it produces
 * follow-up work.
 * @typedef {object} BackgroundJobProducerProof
 * @property {string} jobId - Producing job id.
 * @property {string} handoffId - Producing handoff lease id.
 * @property {string} workerId - Worker identity persisted with the handoff.
 * @property {number} handedOffAtMs - Durable handoff timestamp.
 */
/**
 * @typedef {object} PooledRunnerActiveJob
 * @property {string | null} handoffId - Durable handoff lease id.
 * @property {number | null} handedOffAtMs - Durable handoff timestamp.
 * @property {string} jobId - Durable background job id.
 * @property {string} jobName - Registered job class name.
 * @property {string} workerId - Worker identity persisted with the handoff.
 */
/**
 * One process-failure snapshot shared by every job lost with a pooled child.
 * @typedef {object} PooledRunnerFailure
 * @property {PooledRunnerActiveJob[]} activeJobs - Jobs that were in flight when the child failed, ordered by job id.
 * @property {string | null} childInstanceId - Stable pooled-child identity when its startup or shutdown observation arrived.
 * @property {number | null} exitCode - Child exit code, or null for signal/process errors.
 * @property {string | null} generationId - Release generation identity, or null in legacy mode.
 * @property {string[]} inflightJobIds - Bounded job ids in flight when failure handling started.
 * @property {number} inflightJobIdsTruncatedCount - In-flight ids omitted from the bounded snapshot.
 * @property {boolean | null} oomKilled - False when the observed exit rules OOM out; null when an unexpected SIGKILL cannot be distinguished from an OOM kill without supervisor/kernel evidence.
 * @property {PooledRunnerFailureOrigin} origin - Worker observation that initiated failure handling.
 * @property {number} runnerAgeMs - Child age when failure handling started.
 * @property {number} runnerCreatedAtMs - Child creation timestamp.
 * @property {boolean} runnerDetached - Whether the runner owned a detached process group.
 * @property {number} runnerJobsRun - Previously acknowledged jobs handled by the child.
 * @property {PooledRunnerLifecycleState} runnerLifecycle - Child lifecycle immediately before recovery.
 * @property {number | null} runnerPid - Child process id when available.
 * @property {import("node:child_process").ChildProcess["signalCode"]} signal - Child termination signal when available.
 * @property {number | null} shutdownObservedAtMs - Time the child or parent observed shutdown beginning.
 * @property {number | null} shutdownRequestedAtMs - Exact parent request timestamp, or null for external/unrequested shutdown.
 * @property {PooledChildShutdownReason} shutdownReason - Exact recorded parent request or observed child shutdown cause.
 * @property {import("node:child_process").ChildProcess["signalCode"]} shutdownSignal - Parent-requested or child-observed shutdown signal when available.
 * @property {PooledRunnerTerminationReason} terminationReason - Deprecated compatibility category; use shutdownReason for exact provenance.
 * @property {string | null} timeoutJobId - Job whose timeout initiated child termination, or null.
 * @property {string} workerId - Stable generation-qualified worker id.
 * @property {BackgroundJobsWorkerLifecycleState} workerLifecycle - Parent worker lifecycle immediately before recovery.
 * @property {number} workerPid - Parent worker process id.
 */
/**
 * Best-effort observation sent before a pooled child closes its resources.
 * @typedef {object} PooledChildShutdownObservation
 * @property {string} childInstanceId - Stable pooled-child identity.
 * @property {string[]} inflightJobIds - Bounded in-flight durable job ids.
 * @property {number} inflightJobIdsTruncatedCount - In-flight ids omitted from the bounded snapshot.
 * @property {PooledChildShutdownReason} reason - Shutdown reason observed by the child.
 * @property {number} shutdownObservedAtMs - Child observation timestamp.
 * @property {number | null} shutdownRequestedAtMs - Parent request timestamp when supplied over IPC.
 * @property {import("node:child_process").ChildProcess["signalCode"]} signal - Requested or observed signal when available.
 */
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
 * @typedef {object} BackgroundJobConcurrencyRepair
 * @property {number} activeCount - Exact handed-off job count persisted by the repair.
 * @property {string} concurrencyKey - Durable cap identity.
 * @property {number} previousActiveCount - Persisted count replaced by the repair.
 */
/**
 * @typedef {object} BackgroundJobConcurrencyReconciliation
 * @property {number} candidateCount - Snapshot mismatches rechecked under their counter locks.
 * @property {number} checkedCount - Active or nonzero durable counters compared in the initial snapshot.
 * @property {number} repairedCount - Counters whose persisted values were changed.
 * @property {BackgroundJobConcurrencyRepair[]} repairs - Bounded deterministic sample of applied repairs.
 * @property {number} repairsTruncatedCount - Applied repairs omitted from the sample.
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
 * @property {(args: {jobName: string, args: Array<ReturnType<typeof JSON.parse>>, options?: BackgroundJobOptions, producerInvocationId?: string, producerProof?: BackgroundJobProducerProof}) => Promise<string>} enqueue - Enqueues a job.
 * @property {(args: {scheduleKey: string, jobName: string, args: Array<ReturnType<typeof JSON.parse>>, options?: BackgroundJobOptions}) => Promise<BackgroundJobReplacementResult>} replaceScheduled - Replaces a stable schedule.
 * @property {(args: {scheduleKey: string}) => Promise<BackgroundJobCancellationResult>} cancelScheduled - Cancels a stable schedule.
 * @property {(args: {scheduleKey: string, includeLatestTerminal?: boolean}) => Promise<BackgroundJobScheduledLookupResult>} getScheduledJob - Reads stable schedule ownership and history.
 * @property {(args: {scheduleKey: string}) => Promise<BackgroundJobWakeResult>} wakeScheduled - Expedites a stable schedule owner.
 */
/**
 * @typedef {object} BackgroundJobHandoff
 * @property {string} handoffId - Unique handoff lease id.
 * @property {number} handedOffAtMs - Time handed to a worker in ms.
 * @property {BackgroundJobRow} [job] - Exact committed job snapshot when the adapter changes dispatch data during the claim.
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
 * @property {number | null} scheduleOrder - Transaction-assigned monotonic ownership order for this schedule key; Node preserves its high-water mark across terminal-history pruning. Null for legacy/non-scheduled rows.
 * @property {BackgroundJobStatus} status - Current job status.
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
 * @property {number | null} childReceivedAtMs - Epoch ms when the executing pooled child's event loop processed the job message, or null when no runner accepted it yet.
 * @property {number | null} childStartedAtMs - Epoch ms when the job's perform started in the pooled child, or null when it never started.
 * @property {string | null} childInstanceId - Stable identity of the pooled child process that accepted the job, or null.
 * @property {number | null} childPid - OS pid of the pooled child process that accepted the job, or null.
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
 * @typedef {object} BackgroundJobScheduledLookupResult
 * @property {BackgroundJobRow | null} currentJob - Current queued or handed-off owner.
 * @property {BackgroundJobRow | null} latestTerminalJob - Latest terminal history when requested.
 */
/**
 * @typedef {"woken" | "already_due" | "handed_off" | "not_found"} BackgroundJobWakeOutcome
 */
/**
 * @typedef {object} BackgroundJobWakeResult
 * @property {string | null} jobId - Current owner's durable job id, when found.
 * @property {BackgroundJobWakeOutcome} outcome - Exact wake outcome.
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
 * @property {PooledRunnerFailure | undefined} runnerFailure - Shared pooled-child process failure provenance.
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
 * @typedef {{type: "enqueue", jobName: string, args?: Array<ReturnType<typeof JSON.parse>>, options?: BackgroundJobOptions, producerInvocationId?: string, producerProof?: BackgroundJobProducerProof}} BackgroundJobEnqueueMessage
 * @typedef {{type: "enqueued", jobId: string}} BackgroundJobEnqueuedMessage
 * @typedef {{type: "enqueue-error", error?: string}} BackgroundJobEnqueueErrorMessage
 * @typedef {{type: "replace-scheduled", scheduleKey: string, jobName: string, args?: Array<ReturnType<typeof JSON.parse>>, options?: BackgroundJobOptions}} BackgroundJobReplaceScheduledMessage
 * @typedef {{type: "schedule-replaced", jobId: string, previousJobId: string | null, previousStatus: BackgroundJobReplacementPreviousStatus}} BackgroundJobScheduleReplacedMessage
 * @typedef {{type: "replace-scheduled-error", error?: string}} BackgroundJobReplaceScheduledErrorMessage
 * @typedef {{type: "cancel-scheduled", scheduleKey: string}} BackgroundJobCancelScheduledMessage
 * @typedef {{type: "schedule-cancelled", jobId: string | null, outcome: BackgroundJobCancellationOutcome}} BackgroundJobScheduleCancelledMessage
 * @typedef {{type: "cancel-scheduled-error", error?: string}} BackgroundJobCancelScheduledErrorMessage
 * @typedef {{type: "get-scheduled-job", scheduleKey: string, includeLatestTerminal?: boolean}} BackgroundJobGetScheduledMessage
 * @typedef {{type: "scheduled-job", currentJob: BackgroundJobRow | null, latestTerminalJob: BackgroundJobRow | null}} BackgroundJobScheduledMessage
 * @typedef {{type: "get-scheduled-job-error", error?: string}} BackgroundJobGetScheduledErrorMessage
 * @typedef {{type: "wake-scheduled", scheduleKey: string}} BackgroundJobWakeScheduledMessage
 * @typedef {{type: "schedule-woken", jobId: string | null, outcome: BackgroundJobWakeOutcome}} BackgroundJobScheduleWokenMessage
 * @typedef {{type: "wake-scheduled-error", error?: string}} BackgroundJobWakeScheduledErrorMessage
 * @typedef {{type: "job", payload: BackgroundJobPayload}} BackgroundJobJobMessage
 * @typedef {{type: "job-accepted", jobId: string, handoffId?: string, workerId?: string, handedOffAtMs?: number, receivedAtMs?: number, startedAtMs?: number, childInstanceId?: string, childPid?: number}} BackgroundJobAcceptedMessage
 * @typedef {{type: "job-complete", jobId: string, handoffId?: string, workerId?: string, handedOffAtMs?: number}} BackgroundJobCompleteMessage
 * @typedef {{type: "job-failed", jobId: string, error?: ReturnType<typeof JSON.parse>, handoffId?: string, workerId?: string, handedOffAtMs?: number, runnerFailure?: PooledRunnerFailure}} BackgroundJobFailedMessage
 * @typedef {{type: "job-reschedule", jobId: string, delayMs: number, handoffId?: string, workerId?: string, handedOffAtMs?: number}} BackgroundJobRescheduleMessage
 * @typedef {{type: "job-updated", jobId: string}} BackgroundJobUpdatedMessage
 * @typedef {{type: "job-update-error", jobId: string, error?: string}} BackgroundJobUpdateErrorMessage
 */
/**
 * @typedef {BackgroundJobHelloMessage | BackgroundJobGenerationAcceptedMessage | BackgroundJobGenerationRejectedMessage | BackgroundJobReadyMessage | BackgroundJobDrainingMessage | BackgroundJobHeartbeatMessage | BackgroundJobEnqueueMessage | BackgroundJobEnqueuedMessage | BackgroundJobEnqueueErrorMessage | BackgroundJobReplaceScheduledMessage | BackgroundJobScheduleReplacedMessage | BackgroundJobReplaceScheduledErrorMessage | BackgroundJobCancelScheduledMessage | BackgroundJobScheduleCancelledMessage | BackgroundJobCancelScheduledErrorMessage | BackgroundJobGetScheduledMessage | BackgroundJobScheduledMessage | BackgroundJobGetScheduledErrorMessage | BackgroundJobWakeScheduledMessage | BackgroundJobScheduleWokenMessage | BackgroundJobWakeScheduledErrorMessage | BackgroundJobJobMessage | BackgroundJobAcceptedMessage | BackgroundJobCompleteMessage | BackgroundJobFailedMessage | BackgroundJobRescheduleMessage | BackgroundJobUpdatedMessage | BackgroundJobUpdateErrorMessage} BackgroundJobSocketMessage
 */
export const nothing = {};
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoidHlwZXMuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi9zcmMvYmFja2dyb3VuZC1qb2JzL3R5cGVzLmpzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiJBQUFBLFlBQVk7QUFFWjs7R0FFRztBQUNILHlGQUF5RjtBQUN6RixpSUFBaUk7QUFDakksNk5BQTZOO0FBQzdOLG1FQUFtRTtBQUNuRSwrRkFBK0Y7QUFDL0YsNkZBQTZGO0FBQzdGLGlGQUFpRjtBQUNqRixnRkFBZ0Y7QUFDaEYscU9BQXFPO0FBQ3JPOzs7R0FHRztBQUNILHdGQUF3RjtBQUN4Rjs7Ozs7Ozs7R0FRRztBQUNIOzs7Ozs7O0dBT0c7QUFDSDs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7O0dBMkJHO0FBQ0g7Ozs7Ozs7Ozs7R0FVRztBQUNIOzs7OztHQUtHO0FBQ0g7Ozs7O0dBS0c7QUFDSDs7Ozs7R0FLRztBQUNIOzs7Ozs7O0dBT0c7QUFDSDs7Ozs7Ozs7Ozs7O0dBWUc7QUFDSDs7O0dBR0c7QUFDSDs7Ozs7OztHQU9HO0FBQ0g7Ozs7O0dBS0c7QUFDSDs7Ozs7O0dBTUc7QUFDSDs7Ozs7R0FLRztBQUNIOzs7Ozs7Ozs7OztHQVdHO0FBQ0g7Ozs7Ozs7OztHQVNHO0FBQ0g7Ozs7Ozs7R0FPRztBQUNIOzs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7O0dBNEJHO0FBQ0g7O0dBRUc7QUFDSDs7Ozs7R0FLRztBQUNIOztHQUVHO0FBQ0g7Ozs7R0FJRztBQUNIOzs7O0dBSUc7QUFDSDs7R0FFRztBQUNIOzs7O0dBSUc7QUFDSDs7Ozs7Ozs7Ozs7R0FXRztBQUNIOztHQUVHO0FBQ0g7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7O0dBNkJHO0FBQ0g7O0dBRUc7QUFFSCxNQUFNLENBQUMsTUFBTSxPQUFPLEdBQUcsRUFBRSxDQUFBIiwic291cmNlc0NvbnRlbnQiOlsiLy8gQHRzLWNoZWNrXG5cbi8qKlxuICogQHR5cGVkZWYge1wiaW5saW5lXCIgfCBcImZvcmtlZFwiIHwgXCJwb29sZWRcIiB8IFwic3Bhd25lZFwifSBCYWNrZ3JvdW5kSm9iRXhlY3V0aW9uTW9kZVxuICovXG4vKiogQHR5cGVkZWYge1wiY2FuZGlkYXRlXCIgfCBcImFjdGl2ZVwiIHwgXCJyZXRpcmVkXCJ9IEJhY2tncm91bmRKb2JzR2VuZXJhdGlvbkluaXRpYWxTdGF0ZSAqL1xuLyoqIEB0eXBlZGVmIHtcInN0YXJ0aW5nXCIgfCBcImNhbmRpZGF0ZVwiIHwgXCJhY3RpdmVcIiB8IFwicmV0aXJpbmdcIiB8IFwicmV0aXJlZFwiIHwgXCJzdG9wcGVkXCJ9IEJhY2tncm91bmRKb2JzR2VuZXJhdGlvbkxpZmVjeWNsZVN0YXRlICovXG4vKiogQHR5cGVkZWYge1wibWlzc2luZy1nZW5lcmF0aW9uXCIgfCBcInVuZXhwZWN0ZWQtZ2VuZXJhdGlvblwiIHwgXCJtYWxmb3JtZWQtZ2VuZXJhdGlvblwiIHwgXCJnZW5lcmF0aW9uLW1pc21hdGNoXCIgfCBcIndvcmtlci1hZG1pc3Npb24tcmV0aXJlZFwiIHwgXCJ3b3JrZXItaGFzLW5vLXJlY292ZXJhYmxlLWhhbmRvZmZzXCJ9IEJhY2tncm91bmRKb2JzR2VuZXJhdGlvblJlamVjdGlvblJlYXNvbiAqL1xuLyoqIEB0eXBlZGVmIHtcInF1ZXVlZFwiIHwgXCJoYW5kZWRfb2ZmXCJ9IEJhY2tncm91bmRKb2JBY3RpdmVTdGF0dXMgKi9cbi8qKiBAdHlwZWRlZiB7XCJjYW5jZWxsZWRcIiB8IFwiY29tcGxldGVkXCIgfCBcImZhaWxlZFwiIHwgXCJvcnBoYW5lZFwifSBCYWNrZ3JvdW5kSm9iVGVybWluYWxTdGF0dXMgKi9cbi8qKiBAdHlwZWRlZiB7QmFja2dyb3VuZEpvYkFjdGl2ZVN0YXR1cyB8IEJhY2tncm91bmRKb2JUZXJtaW5hbFN0YXR1c30gQmFja2dyb3VuZEpvYlN0YXR1cyAqL1xuLyoqIEB0eXBlZGVmIHtcImV4aXRcIiB8IFwicHJvY2Vzcy1lcnJvclwiIHwgXCJpcGMtc2VuZFwifSBQb29sZWRSdW5uZXJGYWlsdXJlT3JpZ2luICovXG4vKiogQHR5cGVkZWYge1wic3RhcnRpbmdcIiB8IFwicnVubmluZ1wiIHwgXCJyZXRpcmluZ1wifSBQb29sZWRSdW5uZXJMaWZlY3ljbGVTdGF0ZSAqL1xuLyoqIEB0eXBlZGVmIHtcInBhcmVudF9yZXRpcmVfZHJhaW5lZFwiIHwgXCJqb2JfdGltZW91dFwiIHwgXCJ3b3JrZXJfc3RvcFwiIHwgXCJzaWduYWxfc2lndGVybVwiIHwgXCJzaWduYWxfc2lnaW50XCIgfCBcInNpZ25hbF9zaWdraWxsXCIgfCBcInNpZ25hbF9vdGhlclwiIHwgXCJpcGNfZGlzY29ubmVjdFwiIHwgXCJwcm9jZXNzX2Vycm9yXCIgfCBcInVuZXhwZWN0ZWRfZXhpdFwifSBQb29sZWRDaGlsZFNodXRkb3duUmVhc29uICovXG4vKipcbiAqIEBkZXByZWNhdGVkIFVzZSBQb29sZWRDaGlsZFNodXRkb3duUmVhc29uIGZvciBleGFjdCBzaHV0ZG93biBwcm92ZW5hbmNlLlxuICogQHR5cGVkZWYge1widW5leHBlY3RlZFwiIHwgXCJqb2ItdGltZW91dFwiIHwgXCJ3b3JrZXItc2h1dGRvd24tdGltZW91dFwifSBQb29sZWRSdW5uZXJUZXJtaW5hdGlvblJlYXNvblxuICovXG4vKiogQHR5cGVkZWYge1wicnVubmluZ1wiIHwgXCJyZXRpcmluZ1wiIHwgXCJzdG9wcGluZ1wifSBCYWNrZ3JvdW5kSm9ic1dvcmtlckxpZmVjeWNsZVN0YXRlICovXG4vKipcbiAqIEV4YWN0IGR1cmFibGUgaGFuZG9mZiBvd25lcnNoaXAgY2FycmllZCBieSBhbiBleGVjdXRpbmcgam9iIHdoZW4gaXQgcHJvZHVjZXNcbiAqIGZvbGxvdy11cCB3b3JrLlxuICogQHR5cGVkZWYge29iamVjdH0gQmFja2dyb3VuZEpvYlByb2R1Y2VyUHJvb2ZcbiAqIEBwcm9wZXJ0eSB7c3RyaW5nfSBqb2JJZCAtIFByb2R1Y2luZyBqb2IgaWQuXG4gKiBAcHJvcGVydHkge3N0cmluZ30gaGFuZG9mZklkIC0gUHJvZHVjaW5nIGhhbmRvZmYgbGVhc2UgaWQuXG4gKiBAcHJvcGVydHkge3N0cmluZ30gd29ya2VySWQgLSBXb3JrZXIgaWRlbnRpdHkgcGVyc2lzdGVkIHdpdGggdGhlIGhhbmRvZmYuXG4gKiBAcHJvcGVydHkge251bWJlcn0gaGFuZGVkT2ZmQXRNcyAtIER1cmFibGUgaGFuZG9mZiB0aW1lc3RhbXAuXG4gKi9cbi8qKlxuICogQHR5cGVkZWYge29iamVjdH0gUG9vbGVkUnVubmVyQWN0aXZlSm9iXG4gKiBAcHJvcGVydHkge3N0cmluZyB8IG51bGx9IGhhbmRvZmZJZCAtIER1cmFibGUgaGFuZG9mZiBsZWFzZSBpZC5cbiAqIEBwcm9wZXJ0eSB7bnVtYmVyIHwgbnVsbH0gaGFuZGVkT2ZmQXRNcyAtIER1cmFibGUgaGFuZG9mZiB0aW1lc3RhbXAuXG4gKiBAcHJvcGVydHkge3N0cmluZ30gam9iSWQgLSBEdXJhYmxlIGJhY2tncm91bmQgam9iIGlkLlxuICogQHByb3BlcnR5IHtzdHJpbmd9IGpvYk5hbWUgLSBSZWdpc3RlcmVkIGpvYiBjbGFzcyBuYW1lLlxuICogQHByb3BlcnR5IHtzdHJpbmd9IHdvcmtlcklkIC0gV29ya2VyIGlkZW50aXR5IHBlcnNpc3RlZCB3aXRoIHRoZSBoYW5kb2ZmLlxuICovXG4vKipcbiAqIE9uZSBwcm9jZXNzLWZhaWx1cmUgc25hcHNob3Qgc2hhcmVkIGJ5IGV2ZXJ5IGpvYiBsb3N0IHdpdGggYSBwb29sZWQgY2hpbGQuXG4gKiBAdHlwZWRlZiB7b2JqZWN0fSBQb29sZWRSdW5uZXJGYWlsdXJlXG4gKiBAcHJvcGVydHkge1Bvb2xlZFJ1bm5lckFjdGl2ZUpvYltdfSBhY3RpdmVKb2JzIC0gSm9icyB0aGF0IHdlcmUgaW4gZmxpZ2h0IHdoZW4gdGhlIGNoaWxkIGZhaWxlZCwgb3JkZXJlZCBieSBqb2IgaWQuXG4gKiBAcHJvcGVydHkge3N0cmluZyB8IG51bGx9IGNoaWxkSW5zdGFuY2VJZCAtIFN0YWJsZSBwb29sZWQtY2hpbGQgaWRlbnRpdHkgd2hlbiBpdHMgc3RhcnR1cCBvciBzaHV0ZG93biBvYnNlcnZhdGlvbiBhcnJpdmVkLlxuICogQHByb3BlcnR5IHtudW1iZXIgfCBudWxsfSBleGl0Q29kZSAtIENoaWxkIGV4aXQgY29kZSwgb3IgbnVsbCBmb3Igc2lnbmFsL3Byb2Nlc3MgZXJyb3JzLlxuICogQHByb3BlcnR5IHtzdHJpbmcgfCBudWxsfSBnZW5lcmF0aW9uSWQgLSBSZWxlYXNlIGdlbmVyYXRpb24gaWRlbnRpdHksIG9yIG51bGwgaW4gbGVnYWN5IG1vZGUuXG4gKiBAcHJvcGVydHkge3N0cmluZ1tdfSBpbmZsaWdodEpvYklkcyAtIEJvdW5kZWQgam9iIGlkcyBpbiBmbGlnaHQgd2hlbiBmYWlsdXJlIGhhbmRsaW5nIHN0YXJ0ZWQuXG4gKiBAcHJvcGVydHkge251bWJlcn0gaW5mbGlnaHRKb2JJZHNUcnVuY2F0ZWRDb3VudCAtIEluLWZsaWdodCBpZHMgb21pdHRlZCBmcm9tIHRoZSBib3VuZGVkIHNuYXBzaG90LlxuICogQHByb3BlcnR5IHtib29sZWFuIHwgbnVsbH0gb29tS2lsbGVkIC0gRmFsc2Ugd2hlbiB0aGUgb2JzZXJ2ZWQgZXhpdCBydWxlcyBPT00gb3V0OyBudWxsIHdoZW4gYW4gdW5leHBlY3RlZCBTSUdLSUxMIGNhbm5vdCBiZSBkaXN0aW5ndWlzaGVkIGZyb20gYW4gT09NIGtpbGwgd2l0aG91dCBzdXBlcnZpc29yL2tlcm5lbCBldmlkZW5jZS5cbiAqIEBwcm9wZXJ0eSB7UG9vbGVkUnVubmVyRmFpbHVyZU9yaWdpbn0gb3JpZ2luIC0gV29ya2VyIG9ic2VydmF0aW9uIHRoYXQgaW5pdGlhdGVkIGZhaWx1cmUgaGFuZGxpbmcuXG4gKiBAcHJvcGVydHkge251bWJlcn0gcnVubmVyQWdlTXMgLSBDaGlsZCBhZ2Ugd2hlbiBmYWlsdXJlIGhhbmRsaW5nIHN0YXJ0ZWQuXG4gKiBAcHJvcGVydHkge251bWJlcn0gcnVubmVyQ3JlYXRlZEF0TXMgLSBDaGlsZCBjcmVhdGlvbiB0aW1lc3RhbXAuXG4gKiBAcHJvcGVydHkge2Jvb2xlYW59IHJ1bm5lckRldGFjaGVkIC0gV2hldGhlciB0aGUgcnVubmVyIG93bmVkIGEgZGV0YWNoZWQgcHJvY2VzcyBncm91cC5cbiAqIEBwcm9wZXJ0eSB7bnVtYmVyfSBydW5uZXJKb2JzUnVuIC0gUHJldmlvdXNseSBhY2tub3dsZWRnZWQgam9icyBoYW5kbGVkIGJ5IHRoZSBjaGlsZC5cbiAqIEBwcm9wZXJ0eSB7UG9vbGVkUnVubmVyTGlmZWN5Y2xlU3RhdGV9IHJ1bm5lckxpZmVjeWNsZSAtIENoaWxkIGxpZmVjeWNsZSBpbW1lZGlhdGVseSBiZWZvcmUgcmVjb3ZlcnkuXG4gKiBAcHJvcGVydHkge251bWJlciB8IG51bGx9IHJ1bm5lclBpZCAtIENoaWxkIHByb2Nlc3MgaWQgd2hlbiBhdmFpbGFibGUuXG4gKiBAcHJvcGVydHkge2ltcG9ydChcIm5vZGU6Y2hpbGRfcHJvY2Vzc1wiKS5DaGlsZFByb2Nlc3NbXCJzaWduYWxDb2RlXCJdfSBzaWduYWwgLSBDaGlsZCB0ZXJtaW5hdGlvbiBzaWduYWwgd2hlbiBhdmFpbGFibGUuXG4gKiBAcHJvcGVydHkge251bWJlciB8IG51bGx9IHNodXRkb3duT2JzZXJ2ZWRBdE1zIC0gVGltZSB0aGUgY2hpbGQgb3IgcGFyZW50IG9ic2VydmVkIHNodXRkb3duIGJlZ2lubmluZy5cbiAqIEBwcm9wZXJ0eSB7bnVtYmVyIHwgbnVsbH0gc2h1dGRvd25SZXF1ZXN0ZWRBdE1zIC0gRXhhY3QgcGFyZW50IHJlcXVlc3QgdGltZXN0YW1wLCBvciBudWxsIGZvciBleHRlcm5hbC91bnJlcXVlc3RlZCBzaHV0ZG93bi5cbiAqIEBwcm9wZXJ0eSB7UG9vbGVkQ2hpbGRTaHV0ZG93blJlYXNvbn0gc2h1dGRvd25SZWFzb24gLSBFeGFjdCByZWNvcmRlZCBwYXJlbnQgcmVxdWVzdCBvciBvYnNlcnZlZCBjaGlsZCBzaHV0ZG93biBjYXVzZS5cbiAqIEBwcm9wZXJ0eSB7aW1wb3J0KFwibm9kZTpjaGlsZF9wcm9jZXNzXCIpLkNoaWxkUHJvY2Vzc1tcInNpZ25hbENvZGVcIl19IHNodXRkb3duU2lnbmFsIC0gUGFyZW50LXJlcXVlc3RlZCBvciBjaGlsZC1vYnNlcnZlZCBzaHV0ZG93biBzaWduYWwgd2hlbiBhdmFpbGFibGUuXG4gKiBAcHJvcGVydHkge1Bvb2xlZFJ1bm5lclRlcm1pbmF0aW9uUmVhc29ufSB0ZXJtaW5hdGlvblJlYXNvbiAtIERlcHJlY2F0ZWQgY29tcGF0aWJpbGl0eSBjYXRlZ29yeTsgdXNlIHNodXRkb3duUmVhc29uIGZvciBleGFjdCBwcm92ZW5hbmNlLlxuICogQHByb3BlcnR5IHtzdHJpbmcgfCBudWxsfSB0aW1lb3V0Sm9iSWQgLSBKb2Igd2hvc2UgdGltZW91dCBpbml0aWF0ZWQgY2hpbGQgdGVybWluYXRpb24sIG9yIG51bGwuXG4gKiBAcHJvcGVydHkge3N0cmluZ30gd29ya2VySWQgLSBTdGFibGUgZ2VuZXJhdGlvbi1xdWFsaWZpZWQgd29ya2VyIGlkLlxuICogQHByb3BlcnR5IHtCYWNrZ3JvdW5kSm9ic1dvcmtlckxpZmVjeWNsZVN0YXRlfSB3b3JrZXJMaWZlY3ljbGUgLSBQYXJlbnQgd29ya2VyIGxpZmVjeWNsZSBpbW1lZGlhdGVseSBiZWZvcmUgcmVjb3ZlcnkuXG4gKiBAcHJvcGVydHkge251bWJlcn0gd29ya2VyUGlkIC0gUGFyZW50IHdvcmtlciBwcm9jZXNzIGlkLlxuICovXG4vKipcbiAqIEJlc3QtZWZmb3J0IG9ic2VydmF0aW9uIHNlbnQgYmVmb3JlIGEgcG9vbGVkIGNoaWxkIGNsb3NlcyBpdHMgcmVzb3VyY2VzLlxuICogQHR5cGVkZWYge29iamVjdH0gUG9vbGVkQ2hpbGRTaHV0ZG93bk9ic2VydmF0aW9uXG4gKiBAcHJvcGVydHkge3N0cmluZ30gY2hpbGRJbnN0YW5jZUlkIC0gU3RhYmxlIHBvb2xlZC1jaGlsZCBpZGVudGl0eS5cbiAqIEBwcm9wZXJ0eSB7c3RyaW5nW119IGluZmxpZ2h0Sm9iSWRzIC0gQm91bmRlZCBpbi1mbGlnaHQgZHVyYWJsZSBqb2IgaWRzLlxuICogQHByb3BlcnR5IHtudW1iZXJ9IGluZmxpZ2h0Sm9iSWRzVHJ1bmNhdGVkQ291bnQgLSBJbi1mbGlnaHQgaWRzIG9taXR0ZWQgZnJvbSB0aGUgYm91bmRlZCBzbmFwc2hvdC5cbiAqIEBwcm9wZXJ0eSB7UG9vbGVkQ2hpbGRTaHV0ZG93blJlYXNvbn0gcmVhc29uIC0gU2h1dGRvd24gcmVhc29uIG9ic2VydmVkIGJ5IHRoZSBjaGlsZC5cbiAqIEBwcm9wZXJ0eSB7bnVtYmVyfSBzaHV0ZG93bk9ic2VydmVkQXRNcyAtIENoaWxkIG9ic2VydmF0aW9uIHRpbWVzdGFtcC5cbiAqIEBwcm9wZXJ0eSB7bnVtYmVyIHwgbnVsbH0gc2h1dGRvd25SZXF1ZXN0ZWRBdE1zIC0gUGFyZW50IHJlcXVlc3QgdGltZXN0YW1wIHdoZW4gc3VwcGxpZWQgb3ZlciBJUEMuXG4gKiBAcHJvcGVydHkge2ltcG9ydChcIm5vZGU6Y2hpbGRfcHJvY2Vzc1wiKS5DaGlsZFByb2Nlc3NbXCJzaWduYWxDb2RlXCJdfSBzaWduYWwgLSBSZXF1ZXN0ZWQgb3Igb2JzZXJ2ZWQgc2lnbmFsIHdoZW4gYXZhaWxhYmxlLlxuICovXG4vKipcbiAqIEB0eXBlZGVmIHtvYmplY3R9IExvY2FsQmFja2dyb3VuZEpvYnNDbG9ja1xuICogQHByb3BlcnR5IHsoKSA9PiBudW1iZXJ9IG5vdyAtIEN1cnJlbnQgZXBvY2ggbWlsbGlzZWNvbmRzLlxuICogQHByb3BlcnR5IHsoY2FsbGJhY2s6ICgpID0+IHZvaWQsIGRlbGF5TXM6IG51bWJlcikgPT4gUmV0dXJuVHlwZTx0eXBlb2Ygc2V0VGltZW91dD4gfCBudW1iZXJ9IHNldFRpbWVvdXQgLSBBcm1zIGEgdGltZXIuXG4gKiBAcHJvcGVydHkgeyh0aW1lcklkOiBSZXR1cm5UeXBlPHR5cGVvZiBzZXRUaW1lb3V0PiB8IG51bWJlcikgPT4gdm9pZH0gY2xlYXJUaW1lb3V0IC0gQ2xlYXJzIGEgdGltZXIuXG4gKi9cbi8qKlxuICogQHR5cGVkZWYge29iamVjdH0gUmVzb2x2ZWRCYWNrZ3JvdW5kSm9iQ29uY3VycmVuY3lcbiAqIEBwcm9wZXJ0eSB7c3RyaW5nfSBjb25jdXJyZW5jeUtleSAtIER1cmFibGUgY2FwIGlkZW50aXR5LlxuICogQHByb3BlcnR5IHtudW1iZXJ9IG1heENvbmN1cnJlbmN5IC0gUG9zaXRpdmUgY2FwLlxuICogQHByb3BlcnR5IHtib29sZWFufSBxdWV1ZURlcml2ZWQgLSBXaGV0aGVyIHF1ZXVlIGNvbmZpZ3VyYXRpb24gb3ducyB0aGUgY2FwLlxuICovXG4vKipcbiAqIEB0eXBlZGVmIHtvYmplY3R9IEJhY2tncm91bmRKb2JDb25jdXJyZW5jeVJlcGFpclxuICogQHByb3BlcnR5IHtudW1iZXJ9IGFjdGl2ZUNvdW50IC0gRXhhY3QgaGFuZGVkLW9mZiBqb2IgY291bnQgcGVyc2lzdGVkIGJ5IHRoZSByZXBhaXIuXG4gKiBAcHJvcGVydHkge3N0cmluZ30gY29uY3VycmVuY3lLZXkgLSBEdXJhYmxlIGNhcCBpZGVudGl0eS5cbiAqIEBwcm9wZXJ0eSB7bnVtYmVyfSBwcmV2aW91c0FjdGl2ZUNvdW50IC0gUGVyc2lzdGVkIGNvdW50IHJlcGxhY2VkIGJ5IHRoZSByZXBhaXIuXG4gKi9cbi8qKlxuICogQHR5cGVkZWYge29iamVjdH0gQmFja2dyb3VuZEpvYkNvbmN1cnJlbmN5UmVjb25jaWxpYXRpb25cbiAqIEBwcm9wZXJ0eSB7bnVtYmVyfSBjYW5kaWRhdGVDb3VudCAtIFNuYXBzaG90IG1pc21hdGNoZXMgcmVjaGVja2VkIHVuZGVyIHRoZWlyIGNvdW50ZXIgbG9ja3MuXG4gKiBAcHJvcGVydHkge251bWJlcn0gY2hlY2tlZENvdW50IC0gQWN0aXZlIG9yIG5vbnplcm8gZHVyYWJsZSBjb3VudGVycyBjb21wYXJlZCBpbiB0aGUgaW5pdGlhbCBzbmFwc2hvdC5cbiAqIEBwcm9wZXJ0eSB7bnVtYmVyfSByZXBhaXJlZENvdW50IC0gQ291bnRlcnMgd2hvc2UgcGVyc2lzdGVkIHZhbHVlcyB3ZXJlIGNoYW5nZWQuXG4gKiBAcHJvcGVydHkge0JhY2tncm91bmRKb2JDb25jdXJyZW5jeVJlcGFpcltdfSByZXBhaXJzIC0gQm91bmRlZCBkZXRlcm1pbmlzdGljIHNhbXBsZSBvZiBhcHBsaWVkIHJlcGFpcnMuXG4gKiBAcHJvcGVydHkge251bWJlcn0gcmVwYWlyc1RydW5jYXRlZENvdW50IC0gQXBwbGllZCByZXBhaXJzIG9taXR0ZWQgZnJvbSB0aGUgc2FtcGxlLlxuICovXG4vKipcbiAqIEB0eXBlZGVmIHtvYmplY3R9IFByZXBhcmVkTG9jYWxCYWNrZ3JvdW5kSm9iXG4gKiBAcHJvcGVydHkge3N0cmluZ30gYXJnc0RpZ2VzdCAtIEZpeGVkLXdpZHRoIGRpZ2VzdCBvZiB0aGUgc2VyaWFsaXplZCBhcmd1bWVudHMuXG4gKiBAcHJvcGVydHkge3N0cmluZ30gYXJnc0pzb24gLSBTZXJpYWxpemVkIGFyZ3VtZW50cy5cbiAqIEBwcm9wZXJ0eSB7UmVzb2x2ZWRCYWNrZ3JvdW5kSm9iQ29uY3VycmVuY3kgfCBudWxsfSBjb25jdXJyZW5jeSAtIFJlc29sdmVkIGNvbmN1cnJlbmN5LlxuICogQHByb3BlcnR5IHtudW1iZXJ9IGNyZWF0ZWRBdE1zIC0gQ3JlYXRpb24gdGltZXN0YW1wLlxuICogQHByb3BlcnR5IHtcImlubGluZVwifSBleGVjdXRpb25Nb2RlIC0gTG9jYWwgaW4tcHJvY2VzcyBleGVjdXRpb24gbW9kZS5cbiAqIEBwcm9wZXJ0eSB7c3RyaW5nfSBqb2JJZCAtIER1cmFibGUgaWQuXG4gKiBAcHJvcGVydHkge3N0cmluZ30gam9iTmFtZSAtIFJlZ2lzdGVyZWQgbmFtZS5cbiAqIEBwcm9wZXJ0eSB7bnVtYmVyfSBtYXhSZXRyaWVzIC0gUmV0cnkgY2FwLlxuICogQHByb3BlcnR5IHtzdHJpbmd9IHF1ZXVlIC0gUXVldWUgbmFtZS5cbiAqIEBwcm9wZXJ0eSB7bnVtYmVyfSBzY2hlZHVsZWRBdE1zIC0gRWxpZ2liaWxpdHkgdGltZXN0YW1wLlxuICovXG4vKipcbiAqIEB0eXBlZGVmIHtvYmplY3R9IEJhY2tncm91bmRKb2JzSGVhbHRoXG4gKiBAcHJvcGVydHkge2Jvb2xlYW59IHJlYWR5IC0gV2hldGhlciB0aGUgYWRhcHRlciBjYW4gYWNjZXB0IGFuZCBwcm9jZXNzIHdvcmsuXG4gKi9cbi8qKlxuICogQHR5cGVkZWYge29iamVjdH0gQmFja2dyb3VuZEpvYnNQcm9kdWNlclxuICogQHByb3BlcnR5IHsoYXJnczoge2pvYk5hbWU6IHN0cmluZywgYXJnczogQXJyYXk8UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+LCBvcHRpb25zPzogQmFja2dyb3VuZEpvYk9wdGlvbnMsIHByb2R1Y2VySW52b2NhdGlvbklkPzogc3RyaW5nLCBwcm9kdWNlclByb29mPzogQmFja2dyb3VuZEpvYlByb2R1Y2VyUHJvb2Z9KSA9PiBQcm9taXNlPHN0cmluZz59IGVucXVldWUgLSBFbnF1ZXVlcyBhIGpvYi5cbiAqIEBwcm9wZXJ0eSB7KGFyZ3M6IHtzY2hlZHVsZUtleTogc3RyaW5nLCBqb2JOYW1lOiBzdHJpbmcsIGFyZ3M6IEFycmF5PFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Piwgb3B0aW9ucz86IEJhY2tncm91bmRKb2JPcHRpb25zfSkgPT4gUHJvbWlzZTxCYWNrZ3JvdW5kSm9iUmVwbGFjZW1lbnRSZXN1bHQ+fSByZXBsYWNlU2NoZWR1bGVkIC0gUmVwbGFjZXMgYSBzdGFibGUgc2NoZWR1bGUuXG4gKiBAcHJvcGVydHkgeyhhcmdzOiB7c2NoZWR1bGVLZXk6IHN0cmluZ30pID0+IFByb21pc2U8QmFja2dyb3VuZEpvYkNhbmNlbGxhdGlvblJlc3VsdD59IGNhbmNlbFNjaGVkdWxlZCAtIENhbmNlbHMgYSBzdGFibGUgc2NoZWR1bGUuXG4gKiBAcHJvcGVydHkgeyhhcmdzOiB7c2NoZWR1bGVLZXk6IHN0cmluZywgaW5jbHVkZUxhdGVzdFRlcm1pbmFsPzogYm9vbGVhbn0pID0+IFByb21pc2U8QmFja2dyb3VuZEpvYlNjaGVkdWxlZExvb2t1cFJlc3VsdD59IGdldFNjaGVkdWxlZEpvYiAtIFJlYWRzIHN0YWJsZSBzY2hlZHVsZSBvd25lcnNoaXAgYW5kIGhpc3RvcnkuXG4gKiBAcHJvcGVydHkgeyhhcmdzOiB7c2NoZWR1bGVLZXk6IHN0cmluZ30pID0+IFByb21pc2U8QmFja2dyb3VuZEpvYldha2VSZXN1bHQ+fSB3YWtlU2NoZWR1bGVkIC0gRXhwZWRpdGVzIGEgc3RhYmxlIHNjaGVkdWxlIG93bmVyLlxuICovXG4vKipcbiAqIEB0eXBlZGVmIHtvYmplY3R9IEJhY2tncm91bmRKb2JIYW5kb2ZmXG4gKiBAcHJvcGVydHkge3N0cmluZ30gaGFuZG9mZklkIC0gVW5pcXVlIGhhbmRvZmYgbGVhc2UgaWQuXG4gKiBAcHJvcGVydHkge251bWJlcn0gaGFuZGVkT2ZmQXRNcyAtIFRpbWUgaGFuZGVkIHRvIGEgd29ya2VyIGluIG1zLlxuICogQHByb3BlcnR5IHtCYWNrZ3JvdW5kSm9iUm93fSBbam9iXSAtIEV4YWN0IGNvbW1pdHRlZCBqb2Igc25hcHNob3Qgd2hlbiB0aGUgYWRhcHRlciBjaGFuZ2VzIGRpc3BhdGNoIGRhdGEgZHVyaW5nIHRoZSBjbGFpbS5cbiAqL1xuLyoqXG4gKiBAdHlwZWRlZiB7b2JqZWN0fSBCYWNrZ3JvdW5kSm9iSGFuZG9mZlNuYXBzaG90XG4gKiBAcHJvcGVydHkge3N0cmluZ30gam9iSWQgLSBKb2IgaG9sZGluZyB0aGUgbGVhc2UuXG4gKiBAcHJvcGVydHkge3N0cmluZ30gaGFuZG9mZklkIC0gRXhhY3QgZHVyYWJsZSBsZWFzZSBpZC5cbiAqIEBwcm9wZXJ0eSB7c3RyaW5nfSB3b3JrZXJJZCAtIFN0YWJsZSB3b3JrZXIgaWQgdGhhdCByZWNlaXZlZCB0aGUgbGVhc2UuXG4gKiBAcHJvcGVydHkge251bWJlcn0gaGFuZGVkT2ZmQXRNcyAtIFRpbWUgaGFuZGVkIHRvIHRoZSB3b3JrZXIgaW4gbXMuXG4gKi9cbi8qKlxuICogQHR5cGVkZWYge29iamVjdH0gQmFja2dyb3VuZEpvYkhhbmRvZmZSZXF1ZXN0XG4gKiBAcHJvcGVydHkge3N0cmluZ30gam9iSWQgLSBKb2IgdG8gY2xhaW0uXG4gKiBAcHJvcGVydHkge3N0cmluZ30gW2hhbmRvZmZJZF0gLSBFeGFjdCBjYWxsZXItc2VsZWN0ZWQgbGVhc2UgaWQuIEFkYXB0ZXJzIG11c3QgcGVyc2lzdCBhbmQgcmV0dXJuIHRoaXMgaWQgd2hlbiBzdXBwbGllZDsgYnVpbHQtaW4gYWRhcHRlcnMgZ2VuZXJhdGUgb25lIHdoZW4gb21pdHRlZCBmb3IgbGVnYWN5IGRpcmVjdCBjYWxsZXJzLlxuICogQHByb3BlcnR5IHtzdHJpbmd9IFt3b3JrZXJJZF0gLSBXb3JrZXIgY2xhaW1pbmcgdGhlIGpvYi5cbiAqL1xuLyoqXG4gKiBAdHlwZWRlZiB7b2JqZWN0fSBCYWNrZ3JvdW5kSm9iT3B0aW9uc1xuICogQHByb3BlcnR5IHtCYWNrZ3JvdW5kSm9iRXhlY3V0aW9uTW9kZX0gW2V4ZWN1dGlvbk1vZGVdIC0gSG93IHRoZSBqb2Igc2hvdWxkIHJ1bi4gTm9kZSBkZWZhdWx0cyB0byBgXCJwb29sZWRcImAgKGEgd2FybSwgcmV1c2VkIGxvY2FsIHJ1bm5lciBwcm9jZXNzKS4gQnJvd3Nlci9FeHBvIGxvY2FsIGRpc3BhdGNoIGRlZmF1bHRzIHRvIGFuZCBvbmx5IGFjY2VwdHMgYFwiaW5saW5lXCJgLiBgXCJmb3JrZWRcImAgcnVucyBhIE5vZGUgam9iIGluIGEgZnJlc2ggYGNoaWxkX3Byb2Nlc3MuZm9yaygpYCBjaGlsZCwgYW5kIGBcInNwYXduZWRcImAgaW4gYSBkZXRhY2hlZCBDTEkgcnVubmVyLlxuICogQHByb3BlcnR5IHtudW1iZXJ9IFttYXhSZXRyaWVzXSAtIE1heCByZXRyaWVzIGZvciBhIGZhaWxlZCBqb2IgYmVmb3JlIGl0IGlzIG1hcmtlZCBmYWlsZWQuXG4gKiBAcHJvcGVydHkge3N0cmluZ30gW3F1ZXVlXSAtIFF1ZXVlIG5hbWUuIERlZmF1bHRzIHRvIGBcImRlZmF1bHRcImAuIFdoZW4gdGhlIHF1ZXVlIGhhcyBhIGNvbmZpZ3VyZWQgY2FwIGluIGBiYWNrZ3JvdW5kSm9icy5xdWV1ZXNgLCB0aGF0IGNhcCBpcyBlbmZvcmNlZCBjbHVzdGVyLXdpZGUuXG4gKiBAcHJvcGVydHkge3N0cmluZ30gW2NvbmN1cnJlbmN5S2V5XSAtIE9wYXF1ZSBub24tZW1wdHkga2V5IHVzZWQgdG8gc2hhcmUgYSBjb25jdXJyZW5jeSBjYXAuIE92ZXJyaWRlcyBhbnkgcXVldWUtZGVyaXZlZCBjYXAuXG4gKiBAcHJvcGVydHkge251bWJlcn0gW21heENvbmN1cnJlbmN5XSAtIFBvc2l0aXZlIGludGVnZXIgY2FwOyBtdXN0IGJlIHBhaXJlZCB3aXRoIGBjb25jdXJyZW5jeUtleWAuXG4gKiBAcHJvcGVydHkge2Jvb2xlYW59IFtkZWR1cGxpY2F0ZVdoaWxlUXVldWVkXSAtIFdoZW4gdHJ1ZSwgc2tpcCB0aGUgZW5xdWV1ZSBpZiBhbiBpZGVudGljYWwgc3RpbGwtcXVldWVkIGpvYiAoc2FtZSBqb2IgbmFtZSwgYXJncyBhbmQgcXVldWUpIGlzIHNjaGVkdWxlZCBubyBsYXRlciB0aGFuIHRoaXMgZW5xdWV1ZSwgcmV0dXJuaW5nIHRoZSBlYXJsaWVzdCBtYXRjaGluZyBqb2IncyBpZC4gQSBmdXR1cmUgcmV0cnkgZG9lcyBub3Qgc3VwcHJlc3MgZWFybGllciB3b3JrLiBEZWR1cGxpY2F0aW9uIGlzIGluZGVwZW5kZW50IG9mIGBjb25jdXJyZW5jeUtleWAsIHNvIHRoZSBqb2Iga2VlcHMgaXRzIG5vcm1hbCAoZS5nLiBxdWV1ZS1kZXJpdmVkKSBjb25jdXJyZW5jeSBjYXAuIEtlZXBzIGFuIGludGVydmFsLXNjaGVkdWxlZCByZWN1cnJpbmcgam9iIChlLmcuIHJldGVudGlvbiBwcnVuaW5nKSBmcm9tIHBpbGluZyB1cCByZWR1bmRhbnQgcXVldWVkIHJvd3Mgd2hlbiBpdCBydW5zIHNsb3dlciB0aGFuIGl0cyBpbnRlcnZhbCBvciBubyB3b3JrZXIgaXMgZnJlZS5cbiAqIEBwcm9wZXJ0eSB7c3RyaW5nfSBbaWRlbXBvdGVuY3lLZXldIC0gRHVyYWJsZSBlbnF1ZXVlIGlkZW50aXR5IHNjb3BlZCB0byB0aGUgcmVzb2x2ZWQgam9iIGNsYXNzIG5hbWUgYW5kIHF1ZXVlLiBFeGFjdCByZXBsYXkgcmV0dXJucyB0aGUgb3JpZ2luYWwgam9iIGlkIGFjcm9zcyBldmVyeSBzdGF0ZSBhbmQgYWZ0ZXIgam9iIHBydW5pbmc7IHJldXNlIHdpdGggZGlmZmVyZW50IGNhbm9uaWNhbCBhcmd1bWVudHMgb3IgYmVoYXZpb3ItYWZmZWN0aW5nIG9wdGlvbnMgZmFpbHMuIE93bmVyc2hpcCBpcyBpbmRlcGVuZGVudCBvZiBgZGVkdXBsaWNhdGVXaGlsZVF1ZXVlZGAgYW5kIGlzIHJldGFpbmVkIHVudGlsIGFuIGV4cGxpY2l0IGZ1dHVyZSByZXRlbnRpb24gcG9saWN5IHJlbW92ZXMgaXQuXG4gKiBAcHJvcGVydHkge251bWJlcn0gW3NjaGVkdWxlZEF0TXNdIC0gRXBvY2ggdGltZXN0YW1wIGluIG1pbGxpc2Vjb25kcyB3aGVuIHRoZSBqb2IgYmVjb21lcyBlbGlnaWJsZSBmb3IgZGlzcGF0Y2guIERlZmF1bHRzIHRvIGVucXVldWUgdGltZS5cbiAqIEBwcm9wZXJ0eSB7bnVtYmVyfSBbdGltZW91dE1zXSAtIFBlci1qb2Igd2FsbC1jbG9jayB0aW1lb3V0IGZvciBmb3JrZWQgYW5kIHBvb2xlZCBleGVjdXRpb24uIEEgcG9zaXRpdmUgaW50ZWdlciB1cCB0byAyLDE0Nyw0ODMsNjQ3IG92ZXJyaWRlcyB0aGUgd29ya2VyLWxldmVsIGBqb2JUaW1lb3V0TXNgOyBhIG5vbi1wb3NpdGl2ZSBmaW5pdGUgdmFsdWUgZGlzYWJsZXMgdGhlIHRpbWVvdXQgZm9yIHRoaXMgam9iLlxuICovXG4vKipcbiAqIEB0eXBlZGVmIHtvYmplY3R9IEJhY2tncm91bmRKb2JQYXlsb2FkXG4gKiBAcHJvcGVydHkge3N0cmluZ30gW2lkXSAtIEpvYiBpZC5cbiAqIEBwcm9wZXJ0eSB7c3RyaW5nfSBqb2JOYW1lIC0gSm9iIGNsYXNzIG5hbWUuXG4gKiBAcHJvcGVydHkge0FycmF5PFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gW2FyZ3NdIC0gU2VyaWFsaXplZCBqb2IgYXJndW1lbnRzLlxuICogQHByb3BlcnR5IHtzdHJpbmd9IFtoYW5kb2ZmSWRdIC0gVW5pcXVlIGhhbmRvZmYgbGVhc2UgaWQuXG4gKiBAcHJvcGVydHkge3N0cmluZ30gW3dvcmtlcklkXSAtIFdvcmtlciBpZCBoYW5kbGluZyB0aGUgam9iLlxuICogQHByb3BlcnR5IHtudW1iZXJ9IFtoYW5kZWRPZmZBdE1zXSAtIFRpbWUgaGFuZGVkIHRvIGEgd29ya2VyIGluIG1zLlxuICogQHByb3BlcnR5IHtCYWNrZ3JvdW5kSm9iT3B0aW9uc30gW29wdGlvbnNdIC0gUnVudGltZSBvcHRpb25zLlxuICovXG4vKipcbiAqIEB0eXBlZGVmIHtvYmplY3R9IEJhY2tncm91bmRKb2JDb250ZXh0XG4gKiBAcHJvcGVydHkge3R5cGVvZiBpbXBvcnQoXCIuL3BsYXRmb3JtLWpvYi5qc1wiKS5kZWZhdWx0fSBqb2JDbGFzcyAtIENvbmNyZXRlIGpvYiBjbGFzcy5cbiAqIEBwcm9wZXJ0eSB7c3RyaW5nfSBqb2JOYW1lIC0gUmVnaXN0ZXJlZCBqb2IgbmFtZS5cbiAqIEBwcm9wZXJ0eSB7QXJyYXk8UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSBhcmdzIC0gU2VyaWFsaXplZCBqb2IgYXJndW1lbnRzLlxuICogQHByb3BlcnR5IHtCYWNrZ3JvdW5kSm9iT3B0aW9uc30gb3B0aW9ucyAtIFJlc29sdmVkIGVucXVldWUvcnVudGltZSBvcHRpb25zLlxuICogQHByb3BlcnR5IHtCYWNrZ3JvdW5kSm9iUGF5bG9hZH0gW3BheWxvYWRdIC0gQ29tcGxldGUgcGVyc2lzdGVkIHJ1bm5lciBwYXlsb2FkIHdoZW4gdGhlIGpvYiBpcyBwZXJmb3JtaW5nLlxuICovXG4vKipcbiAqIEB0eXBlZGVmIHtvYmplY3R9IEJhY2tncm91bmRKb2JSb3dcbiAqIEBwcm9wZXJ0eSB7c3RyaW5nfSBpZCAtIEpvYiBpZC5cbiAqIEBwcm9wZXJ0eSB7c3RyaW5nfSBqb2JOYW1lIC0gSm9iIGNsYXNzIG5hbWUuXG4gKiBAcHJvcGVydHkge0FycmF5PFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gYXJncyAtIFNlcmlhbGl6ZWQgam9iIGFyZ3VtZW50cy5cbiAqIEBwcm9wZXJ0eSB7QmFja2dyb3VuZEpvYkV4ZWN1dGlvbk1vZGV9IGV4ZWN1dGlvbk1vZGUgLSBIb3cgdGhlIGpvYiBzaG91bGQgcnVuLlxuICogQHByb3BlcnR5IHtzdHJpbmd9IHF1ZXVlIC0gUXVldWUgbmFtZSAoZGVmYXVsdHMgdG8gYFwiZGVmYXVsdFwiYCkuXG4gKiBAcHJvcGVydHkge3N0cmluZyB8IG51bGx9IHNjaGVkdWxlS2V5IC0gU3RhYmxlIGxvZ2ljYWwgc2NoZWR1bGUga2V5IHJldGFpbmVkIGZvciBoaXN0b3J5LlxuICogQHByb3BlcnR5IHtudW1iZXIgfCBudWxsfSBzY2hlZHVsZU9yZGVyIC0gVHJhbnNhY3Rpb24tYXNzaWduZWQgbW9ub3RvbmljIG93bmVyc2hpcCBvcmRlciBmb3IgdGhpcyBzY2hlZHVsZSBrZXk7IE5vZGUgcHJlc2VydmVzIGl0cyBoaWdoLXdhdGVyIG1hcmsgYWNyb3NzIHRlcm1pbmFsLWhpc3RvcnkgcHJ1bmluZy4gTnVsbCBmb3IgbGVnYWN5L25vbi1zY2hlZHVsZWQgcm93cy5cbiAqIEBwcm9wZXJ0eSB7QmFja2dyb3VuZEpvYlN0YXR1c30gc3RhdHVzIC0gQ3VycmVudCBqb2Igc3RhdHVzLlxuICogQHByb3BlcnR5IHtudW1iZXIgfCBudWxsfSBhdHRlbXB0cyAtIEZhaWx1cmUgYXR0ZW1wdHMgY291bnQuXG4gKiBAcHJvcGVydHkge251bWJlciB8IG51bGx9IG1heFJldHJpZXMgLSBNYXggcmV0cnkgYXR0ZW1wdHMuXG4gKiBAcHJvcGVydHkge251bWJlciB8IG51bGx9IHNjaGVkdWxlZEF0TXMgLSBOZXh0IHNjaGVkdWxlZCB0aW1lIGluIG1zLlxuICogQHByb3BlcnR5IHtudW1iZXIgfCBudWxsfSBjcmVhdGVkQXRNcyAtIENyZWF0aW9uIHRpbWUgaW4gbXMuXG4gKiBAcHJvcGVydHkge251bWJlciB8IG51bGx9IGhhbmRlZE9mZkF0TXMgLSBUaW1lIGhhbmRlZCB0byB3b3JrZXIgaW4gbXMuXG4gKiBAcHJvcGVydHkge3N0cmluZyB8IG51bGx9IGhhbmRvZmZJZCAtIFVuaXF1ZSBsYXRlc3QgaGFuZG9mZiBsZWFzZSBpZC5cbiAqIEBwcm9wZXJ0eSB7bnVtYmVyIHwgbnVsbH0gY29tcGxldGVkQXRNcyAtIENvbXBsZXRpb24gdGltZSBpbiBtcy5cbiAqIEBwcm9wZXJ0eSB7bnVtYmVyIHwgbnVsbH0gZmFpbGVkQXRNcyAtIEZhaWx1cmUgdGltZSBpbiBtcy5cbiAqIEBwcm9wZXJ0eSB7bnVtYmVyIHwgbnVsbH0gb3JwaGFuZWRBdE1zIC0gT3JwaGFuZWQgdGltZSBpbiBtcy5cbiAqIEBwcm9wZXJ0eSB7c3RyaW5nIHwgbnVsbH0gd29ya2VySWQgLSBXb3JrZXIgaWQgaGFuZGxpbmcgdGhlIGpvYi5cbiAqIEBwcm9wZXJ0eSB7c3RyaW5nIHwgbnVsbH0gbGFzdEVycm9yIC0gTGFzdCBmYWlsdXJlIG1lc3NhZ2UuXG4gKiBAcHJvcGVydHkge3N0cmluZyB8IG51bGx9IGNvbmN1cnJlbmN5S2V5IC0gRHVyYWJsZSBjb25jdXJyZW5jeSBrZXkuXG4gKiBAcHJvcGVydHkge251bWJlciB8IG51bGx9IG1heENvbmN1cnJlbmN5IC0gRHVyYWJsZSBwZXIta2V5IGNhcC5cbiAqIEBwcm9wZXJ0eSB7bnVtYmVyIHwgbnVsbH0gdGltZW91dE1zIC0gUGVyLWpvYiB3YWxsLWNsb2NrIHRpbWVvdXQgb3ZlcnJpZGUsIG9yIG51bGwgd2hlbiBvbWl0dGVkLlxuICogQHByb3BlcnR5IHtudW1iZXIgfCBudWxsfSBjaGlsZFJlY2VpdmVkQXRNcyAtIEVwb2NoIG1zIHdoZW4gdGhlIGV4ZWN1dGluZyBwb29sZWQgY2hpbGQncyBldmVudCBsb29wIHByb2Nlc3NlZCB0aGUgam9iIG1lc3NhZ2UsIG9yIG51bGwgd2hlbiBubyBydW5uZXIgYWNjZXB0ZWQgaXQgeWV0LlxuICogQHByb3BlcnR5IHtudW1iZXIgfCBudWxsfSBjaGlsZFN0YXJ0ZWRBdE1zIC0gRXBvY2ggbXMgd2hlbiB0aGUgam9iJ3MgcGVyZm9ybSBzdGFydGVkIGluIHRoZSBwb29sZWQgY2hpbGQsIG9yIG51bGwgd2hlbiBpdCBuZXZlciBzdGFydGVkLlxuICogQHByb3BlcnR5IHtzdHJpbmcgfCBudWxsfSBjaGlsZEluc3RhbmNlSWQgLSBTdGFibGUgaWRlbnRpdHkgb2YgdGhlIHBvb2xlZCBjaGlsZCBwcm9jZXNzIHRoYXQgYWNjZXB0ZWQgdGhlIGpvYiwgb3IgbnVsbC5cbiAqIEBwcm9wZXJ0eSB7bnVtYmVyIHwgbnVsbH0gY2hpbGRQaWQgLSBPUyBwaWQgb2YgdGhlIHBvb2xlZCBjaGlsZCBwcm9jZXNzIHRoYXQgYWNjZXB0ZWQgdGhlIGpvYiwgb3IgbnVsbC5cbiAqL1xuLyoqXG4gKiBAdHlwZWRlZiB7XCJxdWV1ZWRcIiB8IFwiaGFuZGVkX29mZlwiIHwgbnVsbH0gQmFja2dyb3VuZEpvYlJlcGxhY2VtZW50UHJldmlvdXNTdGF0dXNcbiAqL1xuLyoqXG4gKiBAdHlwZWRlZiB7b2JqZWN0fSBCYWNrZ3JvdW5kSm9iUmVwbGFjZW1lbnRSZXN1bHRcbiAqIEBwcm9wZXJ0eSB7c3RyaW5nfSBqb2JJZCAtIE5ld2x5IHF1ZXVlZCBqb2IgaWQuXG4gKiBAcHJvcGVydHkge3N0cmluZyB8IG51bGx9IHByZXZpb3VzSm9iSWQgLSBQcmV2aW91cyBhY3RpdmUgb3duZXIncyBqb2IgaWQuXG4gKiBAcHJvcGVydHkge0JhY2tncm91bmRKb2JSZXBsYWNlbWVudFByZXZpb3VzU3RhdHVzfSBwcmV2aW91c1N0YXR1cyAtIFByZXZpb3VzIG93bmVyJ3Mgb2JzZXJ2ZWQgc3RhdGUuXG4gKi9cbi8qKlxuICogQHR5cGVkZWYge1wiY2FuY2VsbGVkXCIgfCBcImhhbmRlZF9vZmZcIiB8IFwibm90X2ZvdW5kXCJ9IEJhY2tncm91bmRKb2JDYW5jZWxsYXRpb25PdXRjb21lXG4gKi9cbi8qKlxuICogQHR5cGVkZWYge29iamVjdH0gQmFja2dyb3VuZEpvYkNhbmNlbGxhdGlvblJlc3VsdFxuICogQHByb3BlcnR5IHtzdHJpbmcgfCBudWxsfSBqb2JJZCAtIERldGFjaGVkIG93bmVyJ3Mgam9iIGlkLCB3aGVuIG9uZSB3YXMgYWN0aXZlLlxuICogQHByb3BlcnR5IHtCYWNrZ3JvdW5kSm9iQ2FuY2VsbGF0aW9uT3V0Y29tZX0gb3V0Y29tZSAtIFRydXRoZnVsIGJlc3QtZWZmb3J0IG91dGNvbWUuXG4gKi9cbi8qKlxuICogQHR5cGVkZWYge29iamVjdH0gQmFja2dyb3VuZEpvYlNjaGVkdWxlZExvb2t1cFJlc3VsdFxuICogQHByb3BlcnR5IHtCYWNrZ3JvdW5kSm9iUm93IHwgbnVsbH0gY3VycmVudEpvYiAtIEN1cnJlbnQgcXVldWVkIG9yIGhhbmRlZC1vZmYgb3duZXIuXG4gKiBAcHJvcGVydHkge0JhY2tncm91bmRKb2JSb3cgfCBudWxsfSBsYXRlc3RUZXJtaW5hbEpvYiAtIExhdGVzdCB0ZXJtaW5hbCBoaXN0b3J5IHdoZW4gcmVxdWVzdGVkLlxuICovXG4vKipcbiAqIEB0eXBlZGVmIHtcIndva2VuXCIgfCBcImFscmVhZHlfZHVlXCIgfCBcImhhbmRlZF9vZmZcIiB8IFwibm90X2ZvdW5kXCJ9IEJhY2tncm91bmRKb2JXYWtlT3V0Y29tZVxuICovXG4vKipcbiAqIEB0eXBlZGVmIHtvYmplY3R9IEJhY2tncm91bmRKb2JXYWtlUmVzdWx0XG4gKiBAcHJvcGVydHkge3N0cmluZyB8IG51bGx9IGpvYklkIC0gQ3VycmVudCBvd25lcidzIGR1cmFibGUgam9iIGlkLCB3aGVuIGZvdW5kLlxuICogQHByb3BlcnR5IHtCYWNrZ3JvdW5kSm9iV2FrZU91dGNvbWV9IG91dGNvbWUgLSBFeGFjdCB3YWtlIG91dGNvbWUuXG4gKi9cbi8qKlxuICogQHR5cGVkZWYge29iamVjdH0gQmFja2dyb3VuZEpvYkZhaWx1cmVFdmVudFxuICogQHByb3BlcnR5IHtCYWNrZ3JvdW5kSm9iUm93fSBqb2IgLSBVcGRhdGVkIGpvYiByb3cgYWZ0ZXIgZmFpbHVyZSBoYW5kbGluZy5cbiAqIEBwcm9wZXJ0eSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59IGVycm9yIC0gRmFpbHVyZSBlcnJvci5cbiAqIEBwcm9wZXJ0eSB7bnVtYmVyIHwgbnVsbH0gYXR0ZW1wdHMgLSBVcGRhdGVkIGZhaWx1cmUgYXR0ZW1wdHMgY291bnQuXG4gKiBAcHJvcGVydHkge2Jvb2xlYW59IHRlcm1pbmFsIC0gV2hldGhlciB0aGlzIGZhaWx1cmUgZW5kZWQgdGhlIGpvYi5cbiAqIEBwcm9wZXJ0eSB7Ym9vbGVhbn0gd2lsbFJldHJ5IC0gV2hldGhlciB0aGUgam9iIHdhcyByZXR1cm5lZCB0byB0aGUgcXVldWUuXG4gKiBAcHJvcGVydHkge3N0cmluZyB8IHVuZGVmaW5lZH0gaGFuZG9mZklkIC0gSGFuZG9mZiBsZWFzZSBpZCBmcm9tIHRoZSB3b3JrZXIgcmVwb3J0LlxuICogQHByb3BlcnR5IHtudW1iZXIgfCB1bmRlZmluZWR9IGhhbmRlZE9mZkF0TXMgLSBIYW5kb2ZmIHRpbWVzdGFtcCBmcm9tIHRoZSB3b3JrZXIgcmVwb3J0LlxuICogQHByb3BlcnR5IHtzdHJpbmcgfCB1bmRlZmluZWR9IHdvcmtlcklkIC0gV29ya2VyIGlkIGZyb20gdGhlIHdvcmtlciByZXBvcnQuXG4gKiBAcHJvcGVydHkge1Bvb2xlZFJ1bm5lckZhaWx1cmUgfCB1bmRlZmluZWR9IHJ1bm5lckZhaWx1cmUgLSBTaGFyZWQgcG9vbGVkLWNoaWxkIHByb2Nlc3MgZmFpbHVyZSBwcm92ZW5hbmNlLlxuICovXG4vKipcbiAqIEB0eXBlZGVmIHtcIndvcmtlclwiIHwgXCJjbGllbnRcIiB8IFwicmVwb3J0ZXJcIn0gQmFja2dyb3VuZEpvYlNvY2tldFJvbGVcbiAqL1xuLyoqXG4gKiBAdHlwZWRlZiB7e3R5cGU6IFwiaGVsbG9cIiwgcm9sZTogQmFja2dyb3VuZEpvYlNvY2tldFJvbGUsIGdlbmVyYXRpb25JZD86IHN0cmluZywgc3VwcG9ydHNIYW5kb2ZmSWRSZXBvcnRpbmc/OiBib29sZWFuLCBzdXBwb3J0c0hlYXJ0YmVhdD86IGJvb2xlYW4sIHN1cHBvcnRzUG9vbGVkPzogYm9vbGVhbiwgd29ya2VySWQ/OiBzdHJpbmd9fSBCYWNrZ3JvdW5kSm9iSGVsbG9NZXNzYWdlXG4gKiBAdHlwZWRlZiB7e3R5cGU6IFwiZ2VuZXJhdGlvbi1hY2NlcHRlZFwiLCBnZW5lcmF0aW9uSWQ6IHN0cmluZywgbGlmZWN5Y2xlU3RhdGU6IEJhY2tncm91bmRKb2JzR2VuZXJhdGlvbkxpZmVjeWNsZVN0YXRlfX0gQmFja2dyb3VuZEpvYkdlbmVyYXRpb25BY2NlcHRlZE1lc3NhZ2VcbiAqIEB0eXBlZGVmIHt7dHlwZTogXCJnZW5lcmF0aW9uLXJlamVjdGVkXCIsIHJlYXNvbjogQmFja2dyb3VuZEpvYnNHZW5lcmF0aW9uUmVqZWN0aW9uUmVhc29ufX0gQmFja2dyb3VuZEpvYkdlbmVyYXRpb25SZWplY3RlZE1lc3NhZ2VcbiAqIEB0eXBlZGVmIHt7dHlwZTogXCJyZWFkeVwiLCBhY2NlcHRzRm9ya2VkPzogYm9vbGVhbiwgYWNjZXB0c0lubGluZT86IGJvb2xlYW4sIGFjY2VwdHNQb29sZWQ/OiBib29sZWFuLCBhY2NlcHRzU3Bhd25lZD86IGJvb2xlYW4sIGF2YWlsYWJsZVBvb2xlZFNsb3RzPzogbnVtYmVyfX0gQmFja2dyb3VuZEpvYlJlYWR5TWVzc2FnZVxuICogQHR5cGVkZWYge3t0eXBlOiBcImRyYWluaW5nXCJ9fSBCYWNrZ3JvdW5kSm9iRHJhaW5pbmdNZXNzYWdlXG4gKiBAdHlwZWRlZiB7e3R5cGU6IFwiaGVhcnRiZWF0XCIsIHdvcmtlcklkPzogc3RyaW5nfX0gQmFja2dyb3VuZEpvYkhlYXJ0YmVhdE1lc3NhZ2VcbiAqIEB0eXBlZGVmIHt7dHlwZTogXCJlbnF1ZXVlXCIsIGpvYk5hbWU6IHN0cmluZywgYXJncz86IEFycmF5PFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Piwgb3B0aW9ucz86IEJhY2tncm91bmRKb2JPcHRpb25zLCBwcm9kdWNlckludm9jYXRpb25JZD86IHN0cmluZywgcHJvZHVjZXJQcm9vZj86IEJhY2tncm91bmRKb2JQcm9kdWNlclByb29mfX0gQmFja2dyb3VuZEpvYkVucXVldWVNZXNzYWdlXG4gKiBAdHlwZWRlZiB7e3R5cGU6IFwiZW5xdWV1ZWRcIiwgam9iSWQ6IHN0cmluZ319IEJhY2tncm91bmRKb2JFbnF1ZXVlZE1lc3NhZ2VcbiAqIEB0eXBlZGVmIHt7dHlwZTogXCJlbnF1ZXVlLWVycm9yXCIsIGVycm9yPzogc3RyaW5nfX0gQmFja2dyb3VuZEpvYkVucXVldWVFcnJvck1lc3NhZ2VcbiAqIEB0eXBlZGVmIHt7dHlwZTogXCJyZXBsYWNlLXNjaGVkdWxlZFwiLCBzY2hlZHVsZUtleTogc3RyaW5nLCBqb2JOYW1lOiBzdHJpbmcsIGFyZ3M/OiBBcnJheTxSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj4sIG9wdGlvbnM/OiBCYWNrZ3JvdW5kSm9iT3B0aW9uc319IEJhY2tncm91bmRKb2JSZXBsYWNlU2NoZWR1bGVkTWVzc2FnZVxuICogQHR5cGVkZWYge3t0eXBlOiBcInNjaGVkdWxlLXJlcGxhY2VkXCIsIGpvYklkOiBzdHJpbmcsIHByZXZpb3VzSm9iSWQ6IHN0cmluZyB8IG51bGwsIHByZXZpb3VzU3RhdHVzOiBCYWNrZ3JvdW5kSm9iUmVwbGFjZW1lbnRQcmV2aW91c1N0YXR1c319IEJhY2tncm91bmRKb2JTY2hlZHVsZVJlcGxhY2VkTWVzc2FnZVxuICogQHR5cGVkZWYge3t0eXBlOiBcInJlcGxhY2Utc2NoZWR1bGVkLWVycm9yXCIsIGVycm9yPzogc3RyaW5nfX0gQmFja2dyb3VuZEpvYlJlcGxhY2VTY2hlZHVsZWRFcnJvck1lc3NhZ2VcbiAqIEB0eXBlZGVmIHt7dHlwZTogXCJjYW5jZWwtc2NoZWR1bGVkXCIsIHNjaGVkdWxlS2V5OiBzdHJpbmd9fSBCYWNrZ3JvdW5kSm9iQ2FuY2VsU2NoZWR1bGVkTWVzc2FnZVxuICogQHR5cGVkZWYge3t0eXBlOiBcInNjaGVkdWxlLWNhbmNlbGxlZFwiLCBqb2JJZDogc3RyaW5nIHwgbnVsbCwgb3V0Y29tZTogQmFja2dyb3VuZEpvYkNhbmNlbGxhdGlvbk91dGNvbWV9fSBCYWNrZ3JvdW5kSm9iU2NoZWR1bGVDYW5jZWxsZWRNZXNzYWdlXG4gKiBAdHlwZWRlZiB7e3R5cGU6IFwiY2FuY2VsLXNjaGVkdWxlZC1lcnJvclwiLCBlcnJvcj86IHN0cmluZ319IEJhY2tncm91bmRKb2JDYW5jZWxTY2hlZHVsZWRFcnJvck1lc3NhZ2VcbiAqIEB0eXBlZGVmIHt7dHlwZTogXCJnZXQtc2NoZWR1bGVkLWpvYlwiLCBzY2hlZHVsZUtleTogc3RyaW5nLCBpbmNsdWRlTGF0ZXN0VGVybWluYWw/OiBib29sZWFufX0gQmFja2dyb3VuZEpvYkdldFNjaGVkdWxlZE1lc3NhZ2VcbiAqIEB0eXBlZGVmIHt7dHlwZTogXCJzY2hlZHVsZWQtam9iXCIsIGN1cnJlbnRKb2I6IEJhY2tncm91bmRKb2JSb3cgfCBudWxsLCBsYXRlc3RUZXJtaW5hbEpvYjogQmFja2dyb3VuZEpvYlJvdyB8IG51bGx9fSBCYWNrZ3JvdW5kSm9iU2NoZWR1bGVkTWVzc2FnZVxuICogQHR5cGVkZWYge3t0eXBlOiBcImdldC1zY2hlZHVsZWQtam9iLWVycm9yXCIsIGVycm9yPzogc3RyaW5nfX0gQmFja2dyb3VuZEpvYkdldFNjaGVkdWxlZEVycm9yTWVzc2FnZVxuICogQHR5cGVkZWYge3t0eXBlOiBcIndha2Utc2NoZWR1bGVkXCIsIHNjaGVkdWxlS2V5OiBzdHJpbmd9fSBCYWNrZ3JvdW5kSm9iV2FrZVNjaGVkdWxlZE1lc3NhZ2VcbiAqIEB0eXBlZGVmIHt7dHlwZTogXCJzY2hlZHVsZS13b2tlblwiLCBqb2JJZDogc3RyaW5nIHwgbnVsbCwgb3V0Y29tZTogQmFja2dyb3VuZEpvYldha2VPdXRjb21lfX0gQmFja2dyb3VuZEpvYlNjaGVkdWxlV29rZW5NZXNzYWdlXG4gKiBAdHlwZWRlZiB7e3R5cGU6IFwid2FrZS1zY2hlZHVsZWQtZXJyb3JcIiwgZXJyb3I/OiBzdHJpbmd9fSBCYWNrZ3JvdW5kSm9iV2FrZVNjaGVkdWxlZEVycm9yTWVzc2FnZVxuICogQHR5cGVkZWYge3t0eXBlOiBcImpvYlwiLCBwYXlsb2FkOiBCYWNrZ3JvdW5kSm9iUGF5bG9hZH19IEJhY2tncm91bmRKb2JKb2JNZXNzYWdlXG4gKiBAdHlwZWRlZiB7e3R5cGU6IFwiam9iLWFjY2VwdGVkXCIsIGpvYklkOiBzdHJpbmcsIGhhbmRvZmZJZD86IHN0cmluZywgd29ya2VySWQ/OiBzdHJpbmcsIGhhbmRlZE9mZkF0TXM/OiBudW1iZXIsIHJlY2VpdmVkQXRNcz86IG51bWJlciwgc3RhcnRlZEF0TXM/OiBudW1iZXIsIGNoaWxkSW5zdGFuY2VJZD86IHN0cmluZywgY2hpbGRQaWQ/OiBudW1iZXJ9fSBCYWNrZ3JvdW5kSm9iQWNjZXB0ZWRNZXNzYWdlXG4gKiBAdHlwZWRlZiB7e3R5cGU6IFwiam9iLWNvbXBsZXRlXCIsIGpvYklkOiBzdHJpbmcsIGhhbmRvZmZJZD86IHN0cmluZywgd29ya2VySWQ/OiBzdHJpbmcsIGhhbmRlZE9mZkF0TXM/OiBudW1iZXJ9fSBCYWNrZ3JvdW5kSm9iQ29tcGxldGVNZXNzYWdlXG4gKiBAdHlwZWRlZiB7e3R5cGU6IFwiam9iLWZhaWxlZFwiLCBqb2JJZDogc3RyaW5nLCBlcnJvcj86IFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+LCBoYW5kb2ZmSWQ/OiBzdHJpbmcsIHdvcmtlcklkPzogc3RyaW5nLCBoYW5kZWRPZmZBdE1zPzogbnVtYmVyLCBydW5uZXJGYWlsdXJlPzogUG9vbGVkUnVubmVyRmFpbHVyZX19IEJhY2tncm91bmRKb2JGYWlsZWRNZXNzYWdlXG4gKiBAdHlwZWRlZiB7e3R5cGU6IFwiam9iLXJlc2NoZWR1bGVcIiwgam9iSWQ6IHN0cmluZywgZGVsYXlNczogbnVtYmVyLCBoYW5kb2ZmSWQ/OiBzdHJpbmcsIHdvcmtlcklkPzogc3RyaW5nLCBoYW5kZWRPZmZBdE1zPzogbnVtYmVyfX0gQmFja2dyb3VuZEpvYlJlc2NoZWR1bGVNZXNzYWdlXG4gKiBAdHlwZWRlZiB7e3R5cGU6IFwiam9iLXVwZGF0ZWRcIiwgam9iSWQ6IHN0cmluZ319IEJhY2tncm91bmRKb2JVcGRhdGVkTWVzc2FnZVxuICogQHR5cGVkZWYge3t0eXBlOiBcImpvYi11cGRhdGUtZXJyb3JcIiwgam9iSWQ6IHN0cmluZywgZXJyb3I/OiBzdHJpbmd9fSBCYWNrZ3JvdW5kSm9iVXBkYXRlRXJyb3JNZXNzYWdlXG4gKi9cbi8qKlxuICogQHR5cGVkZWYge0JhY2tncm91bmRKb2JIZWxsb01lc3NhZ2UgfCBCYWNrZ3JvdW5kSm9iR2VuZXJhdGlvbkFjY2VwdGVkTWVzc2FnZSB8IEJhY2tncm91bmRKb2JHZW5lcmF0aW9uUmVqZWN0ZWRNZXNzYWdlIHwgQmFja2dyb3VuZEpvYlJlYWR5TWVzc2FnZSB8IEJhY2tncm91bmRKb2JEcmFpbmluZ01lc3NhZ2UgfCBCYWNrZ3JvdW5kSm9iSGVhcnRiZWF0TWVzc2FnZSB8IEJhY2tncm91bmRKb2JFbnF1ZXVlTWVzc2FnZSB8IEJhY2tncm91bmRKb2JFbnF1ZXVlZE1lc3NhZ2UgfCBCYWNrZ3JvdW5kSm9iRW5xdWV1ZUVycm9yTWVzc2FnZSB8IEJhY2tncm91bmRKb2JSZXBsYWNlU2NoZWR1bGVkTWVzc2FnZSB8IEJhY2tncm91bmRKb2JTY2hlZHVsZVJlcGxhY2VkTWVzc2FnZSB8IEJhY2tncm91bmRKb2JSZXBsYWNlU2NoZWR1bGVkRXJyb3JNZXNzYWdlIHwgQmFja2dyb3VuZEpvYkNhbmNlbFNjaGVkdWxlZE1lc3NhZ2UgfCBCYWNrZ3JvdW5kSm9iU2NoZWR1bGVDYW5jZWxsZWRNZXNzYWdlIHwgQmFja2dyb3VuZEpvYkNhbmNlbFNjaGVkdWxlZEVycm9yTWVzc2FnZSB8IEJhY2tncm91bmRKb2JHZXRTY2hlZHVsZWRNZXNzYWdlIHwgQmFja2dyb3VuZEpvYlNjaGVkdWxlZE1lc3NhZ2UgfCBCYWNrZ3JvdW5kSm9iR2V0U2NoZWR1bGVkRXJyb3JNZXNzYWdlIHwgQmFja2dyb3VuZEpvYldha2VTY2hlZHVsZWRNZXNzYWdlIHwgQmFja2dyb3VuZEpvYlNjaGVkdWxlV29rZW5NZXNzYWdlIHwgQmFja2dyb3VuZEpvYldha2VTY2hlZHVsZWRFcnJvck1lc3NhZ2UgfCBCYWNrZ3JvdW5kSm9iSm9iTWVzc2FnZSB8IEJhY2tncm91bmRKb2JBY2NlcHRlZE1lc3NhZ2UgfCBCYWNrZ3JvdW5kSm9iQ29tcGxldGVNZXNzYWdlIHwgQmFja2dyb3VuZEpvYkZhaWxlZE1lc3NhZ2UgfCBCYWNrZ3JvdW5kSm9iUmVzY2hlZHVsZU1lc3NhZ2UgfCBCYWNrZ3JvdW5kSm9iVXBkYXRlZE1lc3NhZ2UgfCBCYWNrZ3JvdW5kSm9iVXBkYXRlRXJyb3JNZXNzYWdlfSBCYWNrZ3JvdW5kSm9iU29ja2V0TWVzc2FnZVxuICovXG5cbmV4cG9ydCBjb25zdCBub3RoaW5nID0ge31cbiJdfQ==