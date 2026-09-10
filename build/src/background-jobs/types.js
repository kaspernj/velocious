// @ts-check
/**
 * @typedef {"inline" | "forked" | "pooled" | "spawned"} BackgroundJobExecutionMode
 */
/** @typedef {"candidate" | "active" | "retired"} BackgroundJobsGenerationInitialState */
/** @typedef {"starting" | "candidate" | "active" | "retiring" | "retired" | "stopped"} BackgroundJobsGenerationLifecycleState */
/** @typedef {"missing-generation" | "unexpected-generation" | "malformed-generation" | "generation-mismatch" | "worker-admission-retired" | "worker-has-no-recoverable-handoffs"} BackgroundJobsGenerationRejectionReason */
/** @typedef {"exit" | "process-error" | "ipc-send"} PooledRunnerFailureOrigin */
/** @typedef {"starting" | "running" | "retiring"} PooledRunnerLifecycleState */
/** @typedef {"unexpected" | "job-timeout" | "worker-shutdown-timeout"} PooledRunnerTerminationReason */
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
 * @property {number | null} exitCode - Child exit code, or null for signal/process errors.
 * @property {string | null} generationId - Release generation identity, or null in legacy mode.
 * @property {boolean | null} oomKilled - False when the observed exit rules OOM out; null when an unexpected SIGKILL cannot be distinguished from an OOM kill without supervisor/kernel evidence.
 * @property {PooledRunnerFailureOrigin} origin - Worker observation that initiated failure handling.
 * @property {number} runnerAgeMs - Child age when failure handling started.
 * @property {number} runnerCreatedAtMs - Child creation timestamp.
 * @property {boolean} runnerDetached - Whether the runner owned a detached process group.
 * @property {number} runnerJobsRun - Previously acknowledged jobs handled by the child.
 * @property {PooledRunnerLifecycleState} runnerLifecycle - Child lifecycle immediately before recovery.
 * @property {number | null} runnerPid - Child process id when available.
 * @property {import("node:child_process").ChildProcess["signalCode"]} signal - Child termination signal when available.
 * @property {PooledRunnerTerminationReason} terminationReason - Why the worker expected or did not expect termination.
 * @property {string | null} timeoutJobId - Job whose timeout initiated child termination, or null.
 * @property {string} workerId - Stable generation-qualified worker id.
 * @property {BackgroundJobsWorkerLifecycleState} workerLifecycle - Parent worker lifecycle immediately before recovery.
 * @property {number} workerPid - Parent worker process id.
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
 * @typedef {{type: "job", payload: BackgroundJobPayload}} BackgroundJobJobMessage
 * @typedef {{type: "job-accepted", jobId: string, handoffId?: string, workerId?: string, handedOffAtMs?: number, receivedAtMs?: number, startedAtMs?: number, childInstanceId?: string, childPid?: number}} BackgroundJobAcceptedMessage
 * @typedef {{type: "job-complete", jobId: string, handoffId?: string, workerId?: string, handedOffAtMs?: number}} BackgroundJobCompleteMessage
 * @typedef {{type: "job-failed", jobId: string, error?: ReturnType<typeof JSON.parse>, handoffId?: string, workerId?: string, handedOffAtMs?: number, runnerFailure?: PooledRunnerFailure}} BackgroundJobFailedMessage
 * @typedef {{type: "job-reschedule", jobId: string, delayMs: number, handoffId?: string, workerId?: string, handedOffAtMs?: number}} BackgroundJobRescheduleMessage
 * @typedef {{type: "job-updated", jobId: string}} BackgroundJobUpdatedMessage
 * @typedef {{type: "job-update-error", jobId: string, error?: string}} BackgroundJobUpdateErrorMessage
 */
/**
 * @typedef {BackgroundJobHelloMessage | BackgroundJobGenerationAcceptedMessage | BackgroundJobGenerationRejectedMessage | BackgroundJobReadyMessage | BackgroundJobDrainingMessage | BackgroundJobHeartbeatMessage | BackgroundJobEnqueueMessage | BackgroundJobEnqueuedMessage | BackgroundJobEnqueueErrorMessage | BackgroundJobReplaceScheduledMessage | BackgroundJobScheduleReplacedMessage | BackgroundJobReplaceScheduledErrorMessage | BackgroundJobCancelScheduledMessage | BackgroundJobScheduleCancelledMessage | BackgroundJobCancelScheduledErrorMessage | BackgroundJobJobMessage | BackgroundJobAcceptedMessage | BackgroundJobCompleteMessage | BackgroundJobFailedMessage | BackgroundJobRescheduleMessage | BackgroundJobUpdatedMessage | BackgroundJobUpdateErrorMessage} BackgroundJobSocketMessage
 */
export const nothing = {};
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoidHlwZXMuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi9zcmMvYmFja2dyb3VuZC1qb2JzL3R5cGVzLmpzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiJBQUFBLFlBQVk7QUFFWjs7R0FFRztBQUNILHlGQUF5RjtBQUN6RixpSUFBaUk7QUFDakksNk5BQTZOO0FBQzdOLGlGQUFpRjtBQUNqRixnRkFBZ0Y7QUFDaEYsd0dBQXdHO0FBQ3hHLHdGQUF3RjtBQUN4Rjs7Ozs7Ozs7R0FRRztBQUNIOzs7Ozs7O0dBT0c7QUFDSDs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7R0FvQkc7QUFDSDs7Ozs7R0FLRztBQUNIOzs7OztHQUtHO0FBQ0g7Ozs7O0dBS0c7QUFDSDs7Ozs7OztHQU9HO0FBQ0g7Ozs7Ozs7Ozs7OztHQVlHO0FBQ0g7OztHQUdHO0FBQ0g7Ozs7O0dBS0c7QUFDSDs7Ozs7R0FLRztBQUNIOzs7Ozs7R0FNRztBQUNIOzs7OztHQUtHO0FBQ0g7Ozs7Ozs7Ozs7O0dBV0c7QUFDSDs7Ozs7Ozs7O0dBU0c7QUFDSDs7Ozs7OztHQU9HO0FBQ0g7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7OztHQTJCRztBQUNIOztHQUVHO0FBQ0g7Ozs7O0dBS0c7QUFDSDs7R0FFRztBQUNIOzs7O0dBSUc7QUFDSDs7Ozs7Ozs7Ozs7R0FXRztBQUNIOztHQUVHO0FBQ0g7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7O0dBdUJHO0FBQ0g7O0dBRUc7QUFFSCxNQUFNLENBQUMsTUFBTSxPQUFPLEdBQUcsRUFBRSxDQUFBIiwic291cmNlc0NvbnRlbnQiOlsiLy8gQHRzLWNoZWNrXG5cbi8qKlxuICogQHR5cGVkZWYge1wiaW5saW5lXCIgfCBcImZvcmtlZFwiIHwgXCJwb29sZWRcIiB8IFwic3Bhd25lZFwifSBCYWNrZ3JvdW5kSm9iRXhlY3V0aW9uTW9kZVxuICovXG4vKiogQHR5cGVkZWYge1wiY2FuZGlkYXRlXCIgfCBcImFjdGl2ZVwiIHwgXCJyZXRpcmVkXCJ9IEJhY2tncm91bmRKb2JzR2VuZXJhdGlvbkluaXRpYWxTdGF0ZSAqL1xuLyoqIEB0eXBlZGVmIHtcInN0YXJ0aW5nXCIgfCBcImNhbmRpZGF0ZVwiIHwgXCJhY3RpdmVcIiB8IFwicmV0aXJpbmdcIiB8IFwicmV0aXJlZFwiIHwgXCJzdG9wcGVkXCJ9IEJhY2tncm91bmRKb2JzR2VuZXJhdGlvbkxpZmVjeWNsZVN0YXRlICovXG4vKiogQHR5cGVkZWYge1wibWlzc2luZy1nZW5lcmF0aW9uXCIgfCBcInVuZXhwZWN0ZWQtZ2VuZXJhdGlvblwiIHwgXCJtYWxmb3JtZWQtZ2VuZXJhdGlvblwiIHwgXCJnZW5lcmF0aW9uLW1pc21hdGNoXCIgfCBcIndvcmtlci1hZG1pc3Npb24tcmV0aXJlZFwiIHwgXCJ3b3JrZXItaGFzLW5vLXJlY292ZXJhYmxlLWhhbmRvZmZzXCJ9IEJhY2tncm91bmRKb2JzR2VuZXJhdGlvblJlamVjdGlvblJlYXNvbiAqL1xuLyoqIEB0eXBlZGVmIHtcImV4aXRcIiB8IFwicHJvY2Vzcy1lcnJvclwiIHwgXCJpcGMtc2VuZFwifSBQb29sZWRSdW5uZXJGYWlsdXJlT3JpZ2luICovXG4vKiogQHR5cGVkZWYge1wic3RhcnRpbmdcIiB8IFwicnVubmluZ1wiIHwgXCJyZXRpcmluZ1wifSBQb29sZWRSdW5uZXJMaWZlY3ljbGVTdGF0ZSAqL1xuLyoqIEB0eXBlZGVmIHtcInVuZXhwZWN0ZWRcIiB8IFwiam9iLXRpbWVvdXRcIiB8IFwid29ya2VyLXNodXRkb3duLXRpbWVvdXRcIn0gUG9vbGVkUnVubmVyVGVybWluYXRpb25SZWFzb24gKi9cbi8qKiBAdHlwZWRlZiB7XCJydW5uaW5nXCIgfCBcInJldGlyaW5nXCIgfCBcInN0b3BwaW5nXCJ9IEJhY2tncm91bmRKb2JzV29ya2VyTGlmZWN5Y2xlU3RhdGUgKi9cbi8qKlxuICogRXhhY3QgZHVyYWJsZSBoYW5kb2ZmIG93bmVyc2hpcCBjYXJyaWVkIGJ5IGFuIGV4ZWN1dGluZyBqb2Igd2hlbiBpdCBwcm9kdWNlc1xuICogZm9sbG93LXVwIHdvcmsuXG4gKiBAdHlwZWRlZiB7b2JqZWN0fSBCYWNrZ3JvdW5kSm9iUHJvZHVjZXJQcm9vZlxuICogQHByb3BlcnR5IHtzdHJpbmd9IGpvYklkIC0gUHJvZHVjaW5nIGpvYiBpZC5cbiAqIEBwcm9wZXJ0eSB7c3RyaW5nfSBoYW5kb2ZmSWQgLSBQcm9kdWNpbmcgaGFuZG9mZiBsZWFzZSBpZC5cbiAqIEBwcm9wZXJ0eSB7c3RyaW5nfSB3b3JrZXJJZCAtIFdvcmtlciBpZGVudGl0eSBwZXJzaXN0ZWQgd2l0aCB0aGUgaGFuZG9mZi5cbiAqIEBwcm9wZXJ0eSB7bnVtYmVyfSBoYW5kZWRPZmZBdE1zIC0gRHVyYWJsZSBoYW5kb2ZmIHRpbWVzdGFtcC5cbiAqL1xuLyoqXG4gKiBAdHlwZWRlZiB7b2JqZWN0fSBQb29sZWRSdW5uZXJBY3RpdmVKb2JcbiAqIEBwcm9wZXJ0eSB7c3RyaW5nIHwgbnVsbH0gaGFuZG9mZklkIC0gRHVyYWJsZSBoYW5kb2ZmIGxlYXNlIGlkLlxuICogQHByb3BlcnR5IHtudW1iZXIgfCBudWxsfSBoYW5kZWRPZmZBdE1zIC0gRHVyYWJsZSBoYW5kb2ZmIHRpbWVzdGFtcC5cbiAqIEBwcm9wZXJ0eSB7c3RyaW5nfSBqb2JJZCAtIER1cmFibGUgYmFja2dyb3VuZCBqb2IgaWQuXG4gKiBAcHJvcGVydHkge3N0cmluZ30gam9iTmFtZSAtIFJlZ2lzdGVyZWQgam9iIGNsYXNzIG5hbWUuXG4gKiBAcHJvcGVydHkge3N0cmluZ30gd29ya2VySWQgLSBXb3JrZXIgaWRlbnRpdHkgcGVyc2lzdGVkIHdpdGggdGhlIGhhbmRvZmYuXG4gKi9cbi8qKlxuICogT25lIHByb2Nlc3MtZmFpbHVyZSBzbmFwc2hvdCBzaGFyZWQgYnkgZXZlcnkgam9iIGxvc3Qgd2l0aCBhIHBvb2xlZCBjaGlsZC5cbiAqIEB0eXBlZGVmIHtvYmplY3R9IFBvb2xlZFJ1bm5lckZhaWx1cmVcbiAqIEBwcm9wZXJ0eSB7UG9vbGVkUnVubmVyQWN0aXZlSm9iW119IGFjdGl2ZUpvYnMgLSBKb2JzIHRoYXQgd2VyZSBpbiBmbGlnaHQgd2hlbiB0aGUgY2hpbGQgZmFpbGVkLCBvcmRlcmVkIGJ5IGpvYiBpZC5cbiAqIEBwcm9wZXJ0eSB7bnVtYmVyIHwgbnVsbH0gZXhpdENvZGUgLSBDaGlsZCBleGl0IGNvZGUsIG9yIG51bGwgZm9yIHNpZ25hbC9wcm9jZXNzIGVycm9ycy5cbiAqIEBwcm9wZXJ0eSB7c3RyaW5nIHwgbnVsbH0gZ2VuZXJhdGlvbklkIC0gUmVsZWFzZSBnZW5lcmF0aW9uIGlkZW50aXR5LCBvciBudWxsIGluIGxlZ2FjeSBtb2RlLlxuICogQHByb3BlcnR5IHtib29sZWFuIHwgbnVsbH0gb29tS2lsbGVkIC0gRmFsc2Ugd2hlbiB0aGUgb2JzZXJ2ZWQgZXhpdCBydWxlcyBPT00gb3V0OyBudWxsIHdoZW4gYW4gdW5leHBlY3RlZCBTSUdLSUxMIGNhbm5vdCBiZSBkaXN0aW5ndWlzaGVkIGZyb20gYW4gT09NIGtpbGwgd2l0aG91dCBzdXBlcnZpc29yL2tlcm5lbCBldmlkZW5jZS5cbiAqIEBwcm9wZXJ0eSB7UG9vbGVkUnVubmVyRmFpbHVyZU9yaWdpbn0gb3JpZ2luIC0gV29ya2VyIG9ic2VydmF0aW9uIHRoYXQgaW5pdGlhdGVkIGZhaWx1cmUgaGFuZGxpbmcuXG4gKiBAcHJvcGVydHkge251bWJlcn0gcnVubmVyQWdlTXMgLSBDaGlsZCBhZ2Ugd2hlbiBmYWlsdXJlIGhhbmRsaW5nIHN0YXJ0ZWQuXG4gKiBAcHJvcGVydHkge251bWJlcn0gcnVubmVyQ3JlYXRlZEF0TXMgLSBDaGlsZCBjcmVhdGlvbiB0aW1lc3RhbXAuXG4gKiBAcHJvcGVydHkge2Jvb2xlYW59IHJ1bm5lckRldGFjaGVkIC0gV2hldGhlciB0aGUgcnVubmVyIG93bmVkIGEgZGV0YWNoZWQgcHJvY2VzcyBncm91cC5cbiAqIEBwcm9wZXJ0eSB7bnVtYmVyfSBydW5uZXJKb2JzUnVuIC0gUHJldmlvdXNseSBhY2tub3dsZWRnZWQgam9icyBoYW5kbGVkIGJ5IHRoZSBjaGlsZC5cbiAqIEBwcm9wZXJ0eSB7UG9vbGVkUnVubmVyTGlmZWN5Y2xlU3RhdGV9IHJ1bm5lckxpZmVjeWNsZSAtIENoaWxkIGxpZmVjeWNsZSBpbW1lZGlhdGVseSBiZWZvcmUgcmVjb3ZlcnkuXG4gKiBAcHJvcGVydHkge251bWJlciB8IG51bGx9IHJ1bm5lclBpZCAtIENoaWxkIHByb2Nlc3MgaWQgd2hlbiBhdmFpbGFibGUuXG4gKiBAcHJvcGVydHkge2ltcG9ydChcIm5vZGU6Y2hpbGRfcHJvY2Vzc1wiKS5DaGlsZFByb2Nlc3NbXCJzaWduYWxDb2RlXCJdfSBzaWduYWwgLSBDaGlsZCB0ZXJtaW5hdGlvbiBzaWduYWwgd2hlbiBhdmFpbGFibGUuXG4gKiBAcHJvcGVydHkge1Bvb2xlZFJ1bm5lclRlcm1pbmF0aW9uUmVhc29ufSB0ZXJtaW5hdGlvblJlYXNvbiAtIFdoeSB0aGUgd29ya2VyIGV4cGVjdGVkIG9yIGRpZCBub3QgZXhwZWN0IHRlcm1pbmF0aW9uLlxuICogQHByb3BlcnR5IHtzdHJpbmcgfCBudWxsfSB0aW1lb3V0Sm9iSWQgLSBKb2Igd2hvc2UgdGltZW91dCBpbml0aWF0ZWQgY2hpbGQgdGVybWluYXRpb24sIG9yIG51bGwuXG4gKiBAcHJvcGVydHkge3N0cmluZ30gd29ya2VySWQgLSBTdGFibGUgZ2VuZXJhdGlvbi1xdWFsaWZpZWQgd29ya2VyIGlkLlxuICogQHByb3BlcnR5IHtCYWNrZ3JvdW5kSm9ic1dvcmtlckxpZmVjeWNsZVN0YXRlfSB3b3JrZXJMaWZlY3ljbGUgLSBQYXJlbnQgd29ya2VyIGxpZmVjeWNsZSBpbW1lZGlhdGVseSBiZWZvcmUgcmVjb3ZlcnkuXG4gKiBAcHJvcGVydHkge251bWJlcn0gd29ya2VyUGlkIC0gUGFyZW50IHdvcmtlciBwcm9jZXNzIGlkLlxuICovXG4vKipcbiAqIEB0eXBlZGVmIHtvYmplY3R9IExvY2FsQmFja2dyb3VuZEpvYnNDbG9ja1xuICogQHByb3BlcnR5IHsoKSA9PiBudW1iZXJ9IG5vdyAtIEN1cnJlbnQgZXBvY2ggbWlsbGlzZWNvbmRzLlxuICogQHByb3BlcnR5IHsoY2FsbGJhY2s6ICgpID0+IHZvaWQsIGRlbGF5TXM6IG51bWJlcikgPT4gUmV0dXJuVHlwZTx0eXBlb2Ygc2V0VGltZW91dD4gfCBudW1iZXJ9IHNldFRpbWVvdXQgLSBBcm1zIGEgdGltZXIuXG4gKiBAcHJvcGVydHkgeyh0aW1lcklkOiBSZXR1cm5UeXBlPHR5cGVvZiBzZXRUaW1lb3V0PiB8IG51bWJlcikgPT4gdm9pZH0gY2xlYXJUaW1lb3V0IC0gQ2xlYXJzIGEgdGltZXIuXG4gKi9cbi8qKlxuICogQHR5cGVkZWYge29iamVjdH0gUmVzb2x2ZWRCYWNrZ3JvdW5kSm9iQ29uY3VycmVuY3lcbiAqIEBwcm9wZXJ0eSB7c3RyaW5nfSBjb25jdXJyZW5jeUtleSAtIER1cmFibGUgY2FwIGlkZW50aXR5LlxuICogQHByb3BlcnR5IHtudW1iZXJ9IG1heENvbmN1cnJlbmN5IC0gUG9zaXRpdmUgY2FwLlxuICogQHByb3BlcnR5IHtib29sZWFufSBxdWV1ZURlcml2ZWQgLSBXaGV0aGVyIHF1ZXVlIGNvbmZpZ3VyYXRpb24gb3ducyB0aGUgY2FwLlxuICovXG4vKipcbiAqIEB0eXBlZGVmIHtvYmplY3R9IEJhY2tncm91bmRKb2JDb25jdXJyZW5jeVJlcGFpclxuICogQHByb3BlcnR5IHtudW1iZXJ9IGFjdGl2ZUNvdW50IC0gRXhhY3QgaGFuZGVkLW9mZiBqb2IgY291bnQgcGVyc2lzdGVkIGJ5IHRoZSByZXBhaXIuXG4gKiBAcHJvcGVydHkge3N0cmluZ30gY29uY3VycmVuY3lLZXkgLSBEdXJhYmxlIGNhcCBpZGVudGl0eS5cbiAqIEBwcm9wZXJ0eSB7bnVtYmVyfSBwcmV2aW91c0FjdGl2ZUNvdW50IC0gUGVyc2lzdGVkIGNvdW50IHJlcGxhY2VkIGJ5IHRoZSByZXBhaXIuXG4gKi9cbi8qKlxuICogQHR5cGVkZWYge29iamVjdH0gQmFja2dyb3VuZEpvYkNvbmN1cnJlbmN5UmVjb25jaWxpYXRpb25cbiAqIEBwcm9wZXJ0eSB7bnVtYmVyfSBjYW5kaWRhdGVDb3VudCAtIFNuYXBzaG90IG1pc21hdGNoZXMgcmVjaGVja2VkIHVuZGVyIHRoZWlyIGNvdW50ZXIgbG9ja3MuXG4gKiBAcHJvcGVydHkge251bWJlcn0gY2hlY2tlZENvdW50IC0gQWN0aXZlIG9yIG5vbnplcm8gZHVyYWJsZSBjb3VudGVycyBjb21wYXJlZCBpbiB0aGUgaW5pdGlhbCBzbmFwc2hvdC5cbiAqIEBwcm9wZXJ0eSB7bnVtYmVyfSByZXBhaXJlZENvdW50IC0gQ291bnRlcnMgd2hvc2UgcGVyc2lzdGVkIHZhbHVlcyB3ZXJlIGNoYW5nZWQuXG4gKiBAcHJvcGVydHkge0JhY2tncm91bmRKb2JDb25jdXJyZW5jeVJlcGFpcltdfSByZXBhaXJzIC0gQm91bmRlZCBkZXRlcm1pbmlzdGljIHNhbXBsZSBvZiBhcHBsaWVkIHJlcGFpcnMuXG4gKiBAcHJvcGVydHkge251bWJlcn0gcmVwYWlyc1RydW5jYXRlZENvdW50IC0gQXBwbGllZCByZXBhaXJzIG9taXR0ZWQgZnJvbSB0aGUgc2FtcGxlLlxuICovXG4vKipcbiAqIEB0eXBlZGVmIHtvYmplY3R9IFByZXBhcmVkTG9jYWxCYWNrZ3JvdW5kSm9iXG4gKiBAcHJvcGVydHkge3N0cmluZ30gYXJnc0RpZ2VzdCAtIEZpeGVkLXdpZHRoIGRpZ2VzdCBvZiB0aGUgc2VyaWFsaXplZCBhcmd1bWVudHMuXG4gKiBAcHJvcGVydHkge3N0cmluZ30gYXJnc0pzb24gLSBTZXJpYWxpemVkIGFyZ3VtZW50cy5cbiAqIEBwcm9wZXJ0eSB7UmVzb2x2ZWRCYWNrZ3JvdW5kSm9iQ29uY3VycmVuY3kgfCBudWxsfSBjb25jdXJyZW5jeSAtIFJlc29sdmVkIGNvbmN1cnJlbmN5LlxuICogQHByb3BlcnR5IHtudW1iZXJ9IGNyZWF0ZWRBdE1zIC0gQ3JlYXRpb24gdGltZXN0YW1wLlxuICogQHByb3BlcnR5IHtcImlubGluZVwifSBleGVjdXRpb25Nb2RlIC0gTG9jYWwgaW4tcHJvY2VzcyBleGVjdXRpb24gbW9kZS5cbiAqIEBwcm9wZXJ0eSB7c3RyaW5nfSBqb2JJZCAtIER1cmFibGUgaWQuXG4gKiBAcHJvcGVydHkge3N0cmluZ30gam9iTmFtZSAtIFJlZ2lzdGVyZWQgbmFtZS5cbiAqIEBwcm9wZXJ0eSB7bnVtYmVyfSBtYXhSZXRyaWVzIC0gUmV0cnkgY2FwLlxuICogQHByb3BlcnR5IHtzdHJpbmd9IHF1ZXVlIC0gUXVldWUgbmFtZS5cbiAqIEBwcm9wZXJ0eSB7bnVtYmVyfSBzY2hlZHVsZWRBdE1zIC0gRWxpZ2liaWxpdHkgdGltZXN0YW1wLlxuICovXG4vKipcbiAqIEB0eXBlZGVmIHtvYmplY3R9IEJhY2tncm91bmRKb2JzSGVhbHRoXG4gKiBAcHJvcGVydHkge2Jvb2xlYW59IHJlYWR5IC0gV2hldGhlciB0aGUgYWRhcHRlciBjYW4gYWNjZXB0IGFuZCBwcm9jZXNzIHdvcmsuXG4gKi9cbi8qKlxuICogQHR5cGVkZWYge29iamVjdH0gQmFja2dyb3VuZEpvYnNQcm9kdWNlclxuICogQHByb3BlcnR5IHsoYXJnczoge2pvYk5hbWU6IHN0cmluZywgYXJnczogQXJyYXk8UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+LCBvcHRpb25zPzogQmFja2dyb3VuZEpvYk9wdGlvbnMsIHByb2R1Y2VySW52b2NhdGlvbklkPzogc3RyaW5nLCBwcm9kdWNlclByb29mPzogQmFja2dyb3VuZEpvYlByb2R1Y2VyUHJvb2Z9KSA9PiBQcm9taXNlPHN0cmluZz59IGVucXVldWUgLSBFbnF1ZXVlcyBhIGpvYi5cbiAqIEBwcm9wZXJ0eSB7KGFyZ3M6IHtzY2hlZHVsZUtleTogc3RyaW5nLCBqb2JOYW1lOiBzdHJpbmcsIGFyZ3M6IEFycmF5PFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Piwgb3B0aW9ucz86IEJhY2tncm91bmRKb2JPcHRpb25zfSkgPT4gUHJvbWlzZTxCYWNrZ3JvdW5kSm9iUmVwbGFjZW1lbnRSZXN1bHQ+fSByZXBsYWNlU2NoZWR1bGVkIC0gUmVwbGFjZXMgYSBzdGFibGUgc2NoZWR1bGUuXG4gKiBAcHJvcGVydHkgeyhhcmdzOiB7c2NoZWR1bGVLZXk6IHN0cmluZ30pID0+IFByb21pc2U8QmFja2dyb3VuZEpvYkNhbmNlbGxhdGlvblJlc3VsdD59IGNhbmNlbFNjaGVkdWxlZCAtIENhbmNlbHMgYSBzdGFibGUgc2NoZWR1bGUuXG4gKi9cbi8qKlxuICogQHR5cGVkZWYge29iamVjdH0gQmFja2dyb3VuZEpvYkhhbmRvZmZcbiAqIEBwcm9wZXJ0eSB7c3RyaW5nfSBoYW5kb2ZmSWQgLSBVbmlxdWUgaGFuZG9mZiBsZWFzZSBpZC5cbiAqIEBwcm9wZXJ0eSB7bnVtYmVyfSBoYW5kZWRPZmZBdE1zIC0gVGltZSBoYW5kZWQgdG8gYSB3b3JrZXIgaW4gbXMuXG4gKiBAcHJvcGVydHkge0JhY2tncm91bmRKb2JSb3d9IFtqb2JdIC0gRXhhY3QgY29tbWl0dGVkIGpvYiBzbmFwc2hvdCB3aGVuIHRoZSBhZGFwdGVyIGNoYW5nZXMgZGlzcGF0Y2ggZGF0YSBkdXJpbmcgdGhlIGNsYWltLlxuICovXG4vKipcbiAqIEB0eXBlZGVmIHtvYmplY3R9IEJhY2tncm91bmRKb2JIYW5kb2ZmU25hcHNob3RcbiAqIEBwcm9wZXJ0eSB7c3RyaW5nfSBqb2JJZCAtIEpvYiBob2xkaW5nIHRoZSBsZWFzZS5cbiAqIEBwcm9wZXJ0eSB7c3RyaW5nfSBoYW5kb2ZmSWQgLSBFeGFjdCBkdXJhYmxlIGxlYXNlIGlkLlxuICogQHByb3BlcnR5IHtzdHJpbmd9IHdvcmtlcklkIC0gU3RhYmxlIHdvcmtlciBpZCB0aGF0IHJlY2VpdmVkIHRoZSBsZWFzZS5cbiAqIEBwcm9wZXJ0eSB7bnVtYmVyfSBoYW5kZWRPZmZBdE1zIC0gVGltZSBoYW5kZWQgdG8gdGhlIHdvcmtlciBpbiBtcy5cbiAqL1xuLyoqXG4gKiBAdHlwZWRlZiB7b2JqZWN0fSBCYWNrZ3JvdW5kSm9iSGFuZG9mZlJlcXVlc3RcbiAqIEBwcm9wZXJ0eSB7c3RyaW5nfSBqb2JJZCAtIEpvYiB0byBjbGFpbS5cbiAqIEBwcm9wZXJ0eSB7c3RyaW5nfSBbaGFuZG9mZklkXSAtIEV4YWN0IGNhbGxlci1zZWxlY3RlZCBsZWFzZSBpZC4gQWRhcHRlcnMgbXVzdCBwZXJzaXN0IGFuZCByZXR1cm4gdGhpcyBpZCB3aGVuIHN1cHBsaWVkOyBidWlsdC1pbiBhZGFwdGVycyBnZW5lcmF0ZSBvbmUgd2hlbiBvbWl0dGVkIGZvciBsZWdhY3kgZGlyZWN0IGNhbGxlcnMuXG4gKiBAcHJvcGVydHkge3N0cmluZ30gW3dvcmtlcklkXSAtIFdvcmtlciBjbGFpbWluZyB0aGUgam9iLlxuICovXG4vKipcbiAqIEB0eXBlZGVmIHtvYmplY3R9IEJhY2tncm91bmRKb2JPcHRpb25zXG4gKiBAcHJvcGVydHkge0JhY2tncm91bmRKb2JFeGVjdXRpb25Nb2RlfSBbZXhlY3V0aW9uTW9kZV0gLSBIb3cgdGhlIGpvYiBzaG91bGQgcnVuLiBOb2RlIGRlZmF1bHRzIHRvIGBcInBvb2xlZFwiYCAoYSB3YXJtLCByZXVzZWQgbG9jYWwgcnVubmVyIHByb2Nlc3MpLiBCcm93c2VyL0V4cG8gbG9jYWwgZGlzcGF0Y2ggZGVmYXVsdHMgdG8gYW5kIG9ubHkgYWNjZXB0cyBgXCJpbmxpbmVcImAuIGBcImZvcmtlZFwiYCBydW5zIGEgTm9kZSBqb2IgaW4gYSBmcmVzaCBgY2hpbGRfcHJvY2Vzcy5mb3JrKClgIGNoaWxkLCBhbmQgYFwic3Bhd25lZFwiYCBpbiBhIGRldGFjaGVkIENMSSBydW5uZXIuXG4gKiBAcHJvcGVydHkge251bWJlcn0gW21heFJldHJpZXNdIC0gTWF4IHJldHJpZXMgZm9yIGEgZmFpbGVkIGpvYiBiZWZvcmUgaXQgaXMgbWFya2VkIGZhaWxlZC5cbiAqIEBwcm9wZXJ0eSB7c3RyaW5nfSBbcXVldWVdIC0gUXVldWUgbmFtZS4gRGVmYXVsdHMgdG8gYFwiZGVmYXVsdFwiYC4gV2hlbiB0aGUgcXVldWUgaGFzIGEgY29uZmlndXJlZCBjYXAgaW4gYGJhY2tncm91bmRKb2JzLnF1ZXVlc2AsIHRoYXQgY2FwIGlzIGVuZm9yY2VkIGNsdXN0ZXItd2lkZS5cbiAqIEBwcm9wZXJ0eSB7c3RyaW5nfSBbY29uY3VycmVuY3lLZXldIC0gT3BhcXVlIG5vbi1lbXB0eSBrZXkgdXNlZCB0byBzaGFyZSBhIGNvbmN1cnJlbmN5IGNhcC4gT3ZlcnJpZGVzIGFueSBxdWV1ZS1kZXJpdmVkIGNhcC5cbiAqIEBwcm9wZXJ0eSB7bnVtYmVyfSBbbWF4Q29uY3VycmVuY3ldIC0gUG9zaXRpdmUgaW50ZWdlciBjYXA7IG11c3QgYmUgcGFpcmVkIHdpdGggYGNvbmN1cnJlbmN5S2V5YC5cbiAqIEBwcm9wZXJ0eSB7Ym9vbGVhbn0gW2RlZHVwbGljYXRlV2hpbGVRdWV1ZWRdIC0gV2hlbiB0cnVlLCBza2lwIHRoZSBlbnF1ZXVlIGlmIGFuIGlkZW50aWNhbCBzdGlsbC1xdWV1ZWQgam9iIChzYW1lIGpvYiBuYW1lLCBhcmdzIGFuZCBxdWV1ZSkgaXMgc2NoZWR1bGVkIG5vIGxhdGVyIHRoYW4gdGhpcyBlbnF1ZXVlLCByZXR1cm5pbmcgdGhlIGVhcmxpZXN0IG1hdGNoaW5nIGpvYidzIGlkLiBBIGZ1dHVyZSByZXRyeSBkb2VzIG5vdCBzdXBwcmVzcyBlYXJsaWVyIHdvcmsuIERlZHVwbGljYXRpb24gaXMgaW5kZXBlbmRlbnQgb2YgYGNvbmN1cnJlbmN5S2V5YCwgc28gdGhlIGpvYiBrZWVwcyBpdHMgbm9ybWFsIChlLmcuIHF1ZXVlLWRlcml2ZWQpIGNvbmN1cnJlbmN5IGNhcC4gS2VlcHMgYW4gaW50ZXJ2YWwtc2NoZWR1bGVkIHJlY3VycmluZyBqb2IgKGUuZy4gcmV0ZW50aW9uIHBydW5pbmcpIGZyb20gcGlsaW5nIHVwIHJlZHVuZGFudCBxdWV1ZWQgcm93cyB3aGVuIGl0IHJ1bnMgc2xvd2VyIHRoYW4gaXRzIGludGVydmFsIG9yIG5vIHdvcmtlciBpcyBmcmVlLlxuICogQHByb3BlcnR5IHtzdHJpbmd9IFtpZGVtcG90ZW5jeUtleV0gLSBEdXJhYmxlIGVucXVldWUgaWRlbnRpdHkgc2NvcGVkIHRvIHRoZSByZXNvbHZlZCBqb2IgY2xhc3MgbmFtZSBhbmQgcXVldWUuIEV4YWN0IHJlcGxheSByZXR1cm5zIHRoZSBvcmlnaW5hbCBqb2IgaWQgYWNyb3NzIGV2ZXJ5IHN0YXRlIGFuZCBhZnRlciBqb2IgcHJ1bmluZzsgcmV1c2Ugd2l0aCBkaWZmZXJlbnQgY2Fub25pY2FsIGFyZ3VtZW50cyBvciBiZWhhdmlvci1hZmZlY3Rpbmcgb3B0aW9ucyBmYWlscy4gT3duZXJzaGlwIGlzIGluZGVwZW5kZW50IG9mIGBkZWR1cGxpY2F0ZVdoaWxlUXVldWVkYCBhbmQgaXMgcmV0YWluZWQgdW50aWwgYW4gZXhwbGljaXQgZnV0dXJlIHJldGVudGlvbiBwb2xpY3kgcmVtb3ZlcyBpdC5cbiAqIEBwcm9wZXJ0eSB7bnVtYmVyfSBbc2NoZWR1bGVkQXRNc10gLSBFcG9jaCB0aW1lc3RhbXAgaW4gbWlsbGlzZWNvbmRzIHdoZW4gdGhlIGpvYiBiZWNvbWVzIGVsaWdpYmxlIGZvciBkaXNwYXRjaC4gRGVmYXVsdHMgdG8gZW5xdWV1ZSB0aW1lLlxuICogQHByb3BlcnR5IHtudW1iZXJ9IFt0aW1lb3V0TXNdIC0gUGVyLWpvYiB3YWxsLWNsb2NrIHRpbWVvdXQgZm9yIGZvcmtlZCBhbmQgcG9vbGVkIGV4ZWN1dGlvbi4gQSBwb3NpdGl2ZSBpbnRlZ2VyIHVwIHRvIDIsMTQ3LDQ4Myw2NDcgb3ZlcnJpZGVzIHRoZSB3b3JrZXItbGV2ZWwgYGpvYlRpbWVvdXRNc2A7IGEgbm9uLXBvc2l0aXZlIGZpbml0ZSB2YWx1ZSBkaXNhYmxlcyB0aGUgdGltZW91dCBmb3IgdGhpcyBqb2IuXG4gKi9cbi8qKlxuICogQHR5cGVkZWYge29iamVjdH0gQmFja2dyb3VuZEpvYlBheWxvYWRcbiAqIEBwcm9wZXJ0eSB7c3RyaW5nfSBbaWRdIC0gSm9iIGlkLlxuICogQHByb3BlcnR5IHtzdHJpbmd9IGpvYk5hbWUgLSBKb2IgY2xhc3MgbmFtZS5cbiAqIEBwcm9wZXJ0eSB7QXJyYXk8UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSBbYXJnc10gLSBTZXJpYWxpemVkIGpvYiBhcmd1bWVudHMuXG4gKiBAcHJvcGVydHkge3N0cmluZ30gW2hhbmRvZmZJZF0gLSBVbmlxdWUgaGFuZG9mZiBsZWFzZSBpZC5cbiAqIEBwcm9wZXJ0eSB7c3RyaW5nfSBbd29ya2VySWRdIC0gV29ya2VyIGlkIGhhbmRsaW5nIHRoZSBqb2IuXG4gKiBAcHJvcGVydHkge251bWJlcn0gW2hhbmRlZE9mZkF0TXNdIC0gVGltZSBoYW5kZWQgdG8gYSB3b3JrZXIgaW4gbXMuXG4gKiBAcHJvcGVydHkge0JhY2tncm91bmRKb2JPcHRpb25zfSBbb3B0aW9uc10gLSBSdW50aW1lIG9wdGlvbnMuXG4gKi9cbi8qKlxuICogQHR5cGVkZWYge29iamVjdH0gQmFja2dyb3VuZEpvYkNvbnRleHRcbiAqIEBwcm9wZXJ0eSB7dHlwZW9mIGltcG9ydChcIi4vcGxhdGZvcm0tam9iLmpzXCIpLmRlZmF1bHR9IGpvYkNsYXNzIC0gQ29uY3JldGUgam9iIGNsYXNzLlxuICogQHByb3BlcnR5IHtzdHJpbmd9IGpvYk5hbWUgLSBSZWdpc3RlcmVkIGpvYiBuYW1lLlxuICogQHByb3BlcnR5IHtBcnJheTxSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59IGFyZ3MgLSBTZXJpYWxpemVkIGpvYiBhcmd1bWVudHMuXG4gKiBAcHJvcGVydHkge0JhY2tncm91bmRKb2JPcHRpb25zfSBvcHRpb25zIC0gUmVzb2x2ZWQgZW5xdWV1ZS9ydW50aW1lIG9wdGlvbnMuXG4gKiBAcHJvcGVydHkge0JhY2tncm91bmRKb2JQYXlsb2FkfSBbcGF5bG9hZF0gLSBDb21wbGV0ZSBwZXJzaXN0ZWQgcnVubmVyIHBheWxvYWQgd2hlbiB0aGUgam9iIGlzIHBlcmZvcm1pbmcuXG4gKi9cbi8qKlxuICogQHR5cGVkZWYge29iamVjdH0gQmFja2dyb3VuZEpvYlJvd1xuICogQHByb3BlcnR5IHtzdHJpbmd9IGlkIC0gSm9iIGlkLlxuICogQHByb3BlcnR5IHtzdHJpbmd9IGpvYk5hbWUgLSBKb2IgY2xhc3MgbmFtZS5cbiAqIEBwcm9wZXJ0eSB7QXJyYXk8UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSBhcmdzIC0gU2VyaWFsaXplZCBqb2IgYXJndW1lbnRzLlxuICogQHByb3BlcnR5IHtCYWNrZ3JvdW5kSm9iRXhlY3V0aW9uTW9kZX0gZXhlY3V0aW9uTW9kZSAtIEhvdyB0aGUgam9iIHNob3VsZCBydW4uXG4gKiBAcHJvcGVydHkge3N0cmluZ30gcXVldWUgLSBRdWV1ZSBuYW1lIChkZWZhdWx0cyB0byBgXCJkZWZhdWx0XCJgKS5cbiAqIEBwcm9wZXJ0eSB7c3RyaW5nIHwgbnVsbH0gc2NoZWR1bGVLZXkgLSBTdGFibGUgbG9naWNhbCBzY2hlZHVsZSBrZXkgcmV0YWluZWQgZm9yIGhpc3RvcnkuXG4gKiBAcHJvcGVydHkge3N0cmluZ30gc3RhdHVzIC0gQ3VycmVudCBqb2Igc3RhdHVzLlxuICogQHByb3BlcnR5IHtudW1iZXIgfCBudWxsfSBhdHRlbXB0cyAtIEZhaWx1cmUgYXR0ZW1wdHMgY291bnQuXG4gKiBAcHJvcGVydHkge251bWJlciB8IG51bGx9IG1heFJldHJpZXMgLSBNYXggcmV0cnkgYXR0ZW1wdHMuXG4gKiBAcHJvcGVydHkge251bWJlciB8IG51bGx9IHNjaGVkdWxlZEF0TXMgLSBOZXh0IHNjaGVkdWxlZCB0aW1lIGluIG1zLlxuICogQHByb3BlcnR5IHtudW1iZXIgfCBudWxsfSBjcmVhdGVkQXRNcyAtIENyZWF0aW9uIHRpbWUgaW4gbXMuXG4gKiBAcHJvcGVydHkge251bWJlciB8IG51bGx9IGhhbmRlZE9mZkF0TXMgLSBUaW1lIGhhbmRlZCB0byB3b3JrZXIgaW4gbXMuXG4gKiBAcHJvcGVydHkge3N0cmluZyB8IG51bGx9IGhhbmRvZmZJZCAtIFVuaXF1ZSBsYXRlc3QgaGFuZG9mZiBsZWFzZSBpZC5cbiAqIEBwcm9wZXJ0eSB7bnVtYmVyIHwgbnVsbH0gY29tcGxldGVkQXRNcyAtIENvbXBsZXRpb24gdGltZSBpbiBtcy5cbiAqIEBwcm9wZXJ0eSB7bnVtYmVyIHwgbnVsbH0gZmFpbGVkQXRNcyAtIEZhaWx1cmUgdGltZSBpbiBtcy5cbiAqIEBwcm9wZXJ0eSB7bnVtYmVyIHwgbnVsbH0gb3JwaGFuZWRBdE1zIC0gT3JwaGFuZWQgdGltZSBpbiBtcy5cbiAqIEBwcm9wZXJ0eSB7c3RyaW5nIHwgbnVsbH0gd29ya2VySWQgLSBXb3JrZXIgaWQgaGFuZGxpbmcgdGhlIGpvYi5cbiAqIEBwcm9wZXJ0eSB7c3RyaW5nIHwgbnVsbH0gbGFzdEVycm9yIC0gTGFzdCBmYWlsdXJlIG1lc3NhZ2UuXG4gKiBAcHJvcGVydHkge3N0cmluZyB8IG51bGx9IGNvbmN1cnJlbmN5S2V5IC0gRHVyYWJsZSBjb25jdXJyZW5jeSBrZXkuXG4gKiBAcHJvcGVydHkge251bWJlciB8IG51bGx9IG1heENvbmN1cnJlbmN5IC0gRHVyYWJsZSBwZXIta2V5IGNhcC5cbiAqIEBwcm9wZXJ0eSB7bnVtYmVyIHwgbnVsbH0gdGltZW91dE1zIC0gUGVyLWpvYiB3YWxsLWNsb2NrIHRpbWVvdXQgb3ZlcnJpZGUsIG9yIG51bGwgd2hlbiBvbWl0dGVkLlxuICogQHByb3BlcnR5IHtudW1iZXIgfCBudWxsfSBjaGlsZFJlY2VpdmVkQXRNcyAtIEVwb2NoIG1zIHdoZW4gdGhlIGV4ZWN1dGluZyBwb29sZWQgY2hpbGQncyBldmVudCBsb29wIHByb2Nlc3NlZCB0aGUgam9iIG1lc3NhZ2UsIG9yIG51bGwgd2hlbiBubyBydW5uZXIgYWNjZXB0ZWQgaXQgeWV0LlxuICogQHByb3BlcnR5IHtudW1iZXIgfCBudWxsfSBjaGlsZFN0YXJ0ZWRBdE1zIC0gRXBvY2ggbXMgd2hlbiB0aGUgam9iJ3MgcGVyZm9ybSBzdGFydGVkIGluIHRoZSBwb29sZWQgY2hpbGQsIG9yIG51bGwgd2hlbiBpdCBuZXZlciBzdGFydGVkLlxuICogQHByb3BlcnR5IHtzdHJpbmcgfCBudWxsfSBjaGlsZEluc3RhbmNlSWQgLSBTdGFibGUgaWRlbnRpdHkgb2YgdGhlIHBvb2xlZCBjaGlsZCBwcm9jZXNzIHRoYXQgYWNjZXB0ZWQgdGhlIGpvYiwgb3IgbnVsbC5cbiAqIEBwcm9wZXJ0eSB7bnVtYmVyIHwgbnVsbH0gY2hpbGRQaWQgLSBPUyBwaWQgb2YgdGhlIHBvb2xlZCBjaGlsZCBwcm9jZXNzIHRoYXQgYWNjZXB0ZWQgdGhlIGpvYiwgb3IgbnVsbC5cbiAqL1xuLyoqXG4gKiBAdHlwZWRlZiB7XCJxdWV1ZWRcIiB8IFwiaGFuZGVkX29mZlwiIHwgbnVsbH0gQmFja2dyb3VuZEpvYlJlcGxhY2VtZW50UHJldmlvdXNTdGF0dXNcbiAqL1xuLyoqXG4gKiBAdHlwZWRlZiB7b2JqZWN0fSBCYWNrZ3JvdW5kSm9iUmVwbGFjZW1lbnRSZXN1bHRcbiAqIEBwcm9wZXJ0eSB7c3RyaW5nfSBqb2JJZCAtIE5ld2x5IHF1ZXVlZCBqb2IgaWQuXG4gKiBAcHJvcGVydHkge3N0cmluZyB8IG51bGx9IHByZXZpb3VzSm9iSWQgLSBQcmV2aW91cyBhY3RpdmUgb3duZXIncyBqb2IgaWQuXG4gKiBAcHJvcGVydHkge0JhY2tncm91bmRKb2JSZXBsYWNlbWVudFByZXZpb3VzU3RhdHVzfSBwcmV2aW91c1N0YXR1cyAtIFByZXZpb3VzIG93bmVyJ3Mgb2JzZXJ2ZWQgc3RhdGUuXG4gKi9cbi8qKlxuICogQHR5cGVkZWYge1wiY2FuY2VsbGVkXCIgfCBcImhhbmRlZF9vZmZcIiB8IFwibm90X2ZvdW5kXCJ9IEJhY2tncm91bmRKb2JDYW5jZWxsYXRpb25PdXRjb21lXG4gKi9cbi8qKlxuICogQHR5cGVkZWYge29iamVjdH0gQmFja2dyb3VuZEpvYkNhbmNlbGxhdGlvblJlc3VsdFxuICogQHByb3BlcnR5IHtzdHJpbmcgfCBudWxsfSBqb2JJZCAtIERldGFjaGVkIG93bmVyJ3Mgam9iIGlkLCB3aGVuIG9uZSB3YXMgYWN0aXZlLlxuICogQHByb3BlcnR5IHtCYWNrZ3JvdW5kSm9iQ2FuY2VsbGF0aW9uT3V0Y29tZX0gb3V0Y29tZSAtIFRydXRoZnVsIGJlc3QtZWZmb3J0IG91dGNvbWUuXG4gKi9cbi8qKlxuICogQHR5cGVkZWYge29iamVjdH0gQmFja2dyb3VuZEpvYkZhaWx1cmVFdmVudFxuICogQHByb3BlcnR5IHtCYWNrZ3JvdW5kSm9iUm93fSBqb2IgLSBVcGRhdGVkIGpvYiByb3cgYWZ0ZXIgZmFpbHVyZSBoYW5kbGluZy5cbiAqIEBwcm9wZXJ0eSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59IGVycm9yIC0gRmFpbHVyZSBlcnJvci5cbiAqIEBwcm9wZXJ0eSB7bnVtYmVyIHwgbnVsbH0gYXR0ZW1wdHMgLSBVcGRhdGVkIGZhaWx1cmUgYXR0ZW1wdHMgY291bnQuXG4gKiBAcHJvcGVydHkge2Jvb2xlYW59IHRlcm1pbmFsIC0gV2hldGhlciB0aGlzIGZhaWx1cmUgZW5kZWQgdGhlIGpvYi5cbiAqIEBwcm9wZXJ0eSB7Ym9vbGVhbn0gd2lsbFJldHJ5IC0gV2hldGhlciB0aGUgam9iIHdhcyByZXR1cm5lZCB0byB0aGUgcXVldWUuXG4gKiBAcHJvcGVydHkge3N0cmluZyB8IHVuZGVmaW5lZH0gaGFuZG9mZklkIC0gSGFuZG9mZiBsZWFzZSBpZCBmcm9tIHRoZSB3b3JrZXIgcmVwb3J0LlxuICogQHByb3BlcnR5IHtudW1iZXIgfCB1bmRlZmluZWR9IGhhbmRlZE9mZkF0TXMgLSBIYW5kb2ZmIHRpbWVzdGFtcCBmcm9tIHRoZSB3b3JrZXIgcmVwb3J0LlxuICogQHByb3BlcnR5IHtzdHJpbmcgfCB1bmRlZmluZWR9IHdvcmtlcklkIC0gV29ya2VyIGlkIGZyb20gdGhlIHdvcmtlciByZXBvcnQuXG4gKiBAcHJvcGVydHkge1Bvb2xlZFJ1bm5lckZhaWx1cmUgfCB1bmRlZmluZWR9IHJ1bm5lckZhaWx1cmUgLSBTaGFyZWQgcG9vbGVkLWNoaWxkIHByb2Nlc3MgZmFpbHVyZSBwcm92ZW5hbmNlLlxuICovXG4vKipcbiAqIEB0eXBlZGVmIHtcIndvcmtlclwiIHwgXCJjbGllbnRcIiB8IFwicmVwb3J0ZXJcIn0gQmFja2dyb3VuZEpvYlNvY2tldFJvbGVcbiAqL1xuLyoqXG4gKiBAdHlwZWRlZiB7e3R5cGU6IFwiaGVsbG9cIiwgcm9sZTogQmFja2dyb3VuZEpvYlNvY2tldFJvbGUsIGdlbmVyYXRpb25JZD86IHN0cmluZywgc3VwcG9ydHNIYW5kb2ZmSWRSZXBvcnRpbmc/OiBib29sZWFuLCBzdXBwb3J0c0hlYXJ0YmVhdD86IGJvb2xlYW4sIHN1cHBvcnRzUG9vbGVkPzogYm9vbGVhbiwgd29ya2VySWQ/OiBzdHJpbmd9fSBCYWNrZ3JvdW5kSm9iSGVsbG9NZXNzYWdlXG4gKiBAdHlwZWRlZiB7e3R5cGU6IFwiZ2VuZXJhdGlvbi1hY2NlcHRlZFwiLCBnZW5lcmF0aW9uSWQ6IHN0cmluZywgbGlmZWN5Y2xlU3RhdGU6IEJhY2tncm91bmRKb2JzR2VuZXJhdGlvbkxpZmVjeWNsZVN0YXRlfX0gQmFja2dyb3VuZEpvYkdlbmVyYXRpb25BY2NlcHRlZE1lc3NhZ2VcbiAqIEB0eXBlZGVmIHt7dHlwZTogXCJnZW5lcmF0aW9uLXJlamVjdGVkXCIsIHJlYXNvbjogQmFja2dyb3VuZEpvYnNHZW5lcmF0aW9uUmVqZWN0aW9uUmVhc29ufX0gQmFja2dyb3VuZEpvYkdlbmVyYXRpb25SZWplY3RlZE1lc3NhZ2VcbiAqIEB0eXBlZGVmIHt7dHlwZTogXCJyZWFkeVwiLCBhY2NlcHRzRm9ya2VkPzogYm9vbGVhbiwgYWNjZXB0c0lubGluZT86IGJvb2xlYW4sIGFjY2VwdHNQb29sZWQ/OiBib29sZWFuLCBhY2NlcHRzU3Bhd25lZD86IGJvb2xlYW4sIGF2YWlsYWJsZVBvb2xlZFNsb3RzPzogbnVtYmVyfX0gQmFja2dyb3VuZEpvYlJlYWR5TWVzc2FnZVxuICogQHR5cGVkZWYge3t0eXBlOiBcImRyYWluaW5nXCJ9fSBCYWNrZ3JvdW5kSm9iRHJhaW5pbmdNZXNzYWdlXG4gKiBAdHlwZWRlZiB7e3R5cGU6IFwiaGVhcnRiZWF0XCIsIHdvcmtlcklkPzogc3RyaW5nfX0gQmFja2dyb3VuZEpvYkhlYXJ0YmVhdE1lc3NhZ2VcbiAqIEB0eXBlZGVmIHt7dHlwZTogXCJlbnF1ZXVlXCIsIGpvYk5hbWU6IHN0cmluZywgYXJncz86IEFycmF5PFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Piwgb3B0aW9ucz86IEJhY2tncm91bmRKb2JPcHRpb25zLCBwcm9kdWNlckludm9jYXRpb25JZD86IHN0cmluZywgcHJvZHVjZXJQcm9vZj86IEJhY2tncm91bmRKb2JQcm9kdWNlclByb29mfX0gQmFja2dyb3VuZEpvYkVucXVldWVNZXNzYWdlXG4gKiBAdHlwZWRlZiB7e3R5cGU6IFwiZW5xdWV1ZWRcIiwgam9iSWQ6IHN0cmluZ319IEJhY2tncm91bmRKb2JFbnF1ZXVlZE1lc3NhZ2VcbiAqIEB0eXBlZGVmIHt7dHlwZTogXCJlbnF1ZXVlLWVycm9yXCIsIGVycm9yPzogc3RyaW5nfX0gQmFja2dyb3VuZEpvYkVucXVldWVFcnJvck1lc3NhZ2VcbiAqIEB0eXBlZGVmIHt7dHlwZTogXCJyZXBsYWNlLXNjaGVkdWxlZFwiLCBzY2hlZHVsZUtleTogc3RyaW5nLCBqb2JOYW1lOiBzdHJpbmcsIGFyZ3M/OiBBcnJheTxSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj4sIG9wdGlvbnM/OiBCYWNrZ3JvdW5kSm9iT3B0aW9uc319IEJhY2tncm91bmRKb2JSZXBsYWNlU2NoZWR1bGVkTWVzc2FnZVxuICogQHR5cGVkZWYge3t0eXBlOiBcInNjaGVkdWxlLXJlcGxhY2VkXCIsIGpvYklkOiBzdHJpbmcsIHByZXZpb3VzSm9iSWQ6IHN0cmluZyB8IG51bGwsIHByZXZpb3VzU3RhdHVzOiBCYWNrZ3JvdW5kSm9iUmVwbGFjZW1lbnRQcmV2aW91c1N0YXR1c319IEJhY2tncm91bmRKb2JTY2hlZHVsZVJlcGxhY2VkTWVzc2FnZVxuICogQHR5cGVkZWYge3t0eXBlOiBcInJlcGxhY2Utc2NoZWR1bGVkLWVycm9yXCIsIGVycm9yPzogc3RyaW5nfX0gQmFja2dyb3VuZEpvYlJlcGxhY2VTY2hlZHVsZWRFcnJvck1lc3NhZ2VcbiAqIEB0eXBlZGVmIHt7dHlwZTogXCJjYW5jZWwtc2NoZWR1bGVkXCIsIHNjaGVkdWxlS2V5OiBzdHJpbmd9fSBCYWNrZ3JvdW5kSm9iQ2FuY2VsU2NoZWR1bGVkTWVzc2FnZVxuICogQHR5cGVkZWYge3t0eXBlOiBcInNjaGVkdWxlLWNhbmNlbGxlZFwiLCBqb2JJZDogc3RyaW5nIHwgbnVsbCwgb3V0Y29tZTogQmFja2dyb3VuZEpvYkNhbmNlbGxhdGlvbk91dGNvbWV9fSBCYWNrZ3JvdW5kSm9iU2NoZWR1bGVDYW5jZWxsZWRNZXNzYWdlXG4gKiBAdHlwZWRlZiB7e3R5cGU6IFwiY2FuY2VsLXNjaGVkdWxlZC1lcnJvclwiLCBlcnJvcj86IHN0cmluZ319IEJhY2tncm91bmRKb2JDYW5jZWxTY2hlZHVsZWRFcnJvck1lc3NhZ2VcbiAqIEB0eXBlZGVmIHt7dHlwZTogXCJqb2JcIiwgcGF5bG9hZDogQmFja2dyb3VuZEpvYlBheWxvYWR9fSBCYWNrZ3JvdW5kSm9iSm9iTWVzc2FnZVxuICogQHR5cGVkZWYge3t0eXBlOiBcImpvYi1hY2NlcHRlZFwiLCBqb2JJZDogc3RyaW5nLCBoYW5kb2ZmSWQ/OiBzdHJpbmcsIHdvcmtlcklkPzogc3RyaW5nLCBoYW5kZWRPZmZBdE1zPzogbnVtYmVyLCByZWNlaXZlZEF0TXM/OiBudW1iZXIsIHN0YXJ0ZWRBdE1zPzogbnVtYmVyLCBjaGlsZEluc3RhbmNlSWQ/OiBzdHJpbmcsIGNoaWxkUGlkPzogbnVtYmVyfX0gQmFja2dyb3VuZEpvYkFjY2VwdGVkTWVzc2FnZVxuICogQHR5cGVkZWYge3t0eXBlOiBcImpvYi1jb21wbGV0ZVwiLCBqb2JJZDogc3RyaW5nLCBoYW5kb2ZmSWQ/OiBzdHJpbmcsIHdvcmtlcklkPzogc3RyaW5nLCBoYW5kZWRPZmZBdE1zPzogbnVtYmVyfX0gQmFja2dyb3VuZEpvYkNvbXBsZXRlTWVzc2FnZVxuICogQHR5cGVkZWYge3t0eXBlOiBcImpvYi1mYWlsZWRcIiwgam9iSWQ6IHN0cmluZywgZXJyb3I/OiBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPiwgaGFuZG9mZklkPzogc3RyaW5nLCB3b3JrZXJJZD86IHN0cmluZywgaGFuZGVkT2ZmQXRNcz86IG51bWJlciwgcnVubmVyRmFpbHVyZT86IFBvb2xlZFJ1bm5lckZhaWx1cmV9fSBCYWNrZ3JvdW5kSm9iRmFpbGVkTWVzc2FnZVxuICogQHR5cGVkZWYge3t0eXBlOiBcImpvYi1yZXNjaGVkdWxlXCIsIGpvYklkOiBzdHJpbmcsIGRlbGF5TXM6IG51bWJlciwgaGFuZG9mZklkPzogc3RyaW5nLCB3b3JrZXJJZD86IHN0cmluZywgaGFuZGVkT2ZmQXRNcz86IG51bWJlcn19IEJhY2tncm91bmRKb2JSZXNjaGVkdWxlTWVzc2FnZVxuICogQHR5cGVkZWYge3t0eXBlOiBcImpvYi11cGRhdGVkXCIsIGpvYklkOiBzdHJpbmd9fSBCYWNrZ3JvdW5kSm9iVXBkYXRlZE1lc3NhZ2VcbiAqIEB0eXBlZGVmIHt7dHlwZTogXCJqb2ItdXBkYXRlLWVycm9yXCIsIGpvYklkOiBzdHJpbmcsIGVycm9yPzogc3RyaW5nfX0gQmFja2dyb3VuZEpvYlVwZGF0ZUVycm9yTWVzc2FnZVxuICovXG4vKipcbiAqIEB0eXBlZGVmIHtCYWNrZ3JvdW5kSm9iSGVsbG9NZXNzYWdlIHwgQmFja2dyb3VuZEpvYkdlbmVyYXRpb25BY2NlcHRlZE1lc3NhZ2UgfCBCYWNrZ3JvdW5kSm9iR2VuZXJhdGlvblJlamVjdGVkTWVzc2FnZSB8IEJhY2tncm91bmRKb2JSZWFkeU1lc3NhZ2UgfCBCYWNrZ3JvdW5kSm9iRHJhaW5pbmdNZXNzYWdlIHwgQmFja2dyb3VuZEpvYkhlYXJ0YmVhdE1lc3NhZ2UgfCBCYWNrZ3JvdW5kSm9iRW5xdWV1ZU1lc3NhZ2UgfCBCYWNrZ3JvdW5kSm9iRW5xdWV1ZWRNZXNzYWdlIHwgQmFja2dyb3VuZEpvYkVucXVldWVFcnJvck1lc3NhZ2UgfCBCYWNrZ3JvdW5kSm9iUmVwbGFjZVNjaGVkdWxlZE1lc3NhZ2UgfCBCYWNrZ3JvdW5kSm9iU2NoZWR1bGVSZXBsYWNlZE1lc3NhZ2UgfCBCYWNrZ3JvdW5kSm9iUmVwbGFjZVNjaGVkdWxlZEVycm9yTWVzc2FnZSB8IEJhY2tncm91bmRKb2JDYW5jZWxTY2hlZHVsZWRNZXNzYWdlIHwgQmFja2dyb3VuZEpvYlNjaGVkdWxlQ2FuY2VsbGVkTWVzc2FnZSB8IEJhY2tncm91bmRKb2JDYW5jZWxTY2hlZHVsZWRFcnJvck1lc3NhZ2UgfCBCYWNrZ3JvdW5kSm9iSm9iTWVzc2FnZSB8IEJhY2tncm91bmRKb2JBY2NlcHRlZE1lc3NhZ2UgfCBCYWNrZ3JvdW5kSm9iQ29tcGxldGVNZXNzYWdlIHwgQmFja2dyb3VuZEpvYkZhaWxlZE1lc3NhZ2UgfCBCYWNrZ3JvdW5kSm9iUmVzY2hlZHVsZU1lc3NhZ2UgfCBCYWNrZ3JvdW5kSm9iVXBkYXRlZE1lc3NhZ2UgfCBCYWNrZ3JvdW5kSm9iVXBkYXRlRXJyb3JNZXNzYWdlfSBCYWNrZ3JvdW5kSm9iU29ja2V0TWVzc2FnZVxuICovXG5cbmV4cG9ydCBjb25zdCBub3RoaW5nID0ge31cbiJdfQ==