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
 * @property {(args: {jobName: string, args: Array<ReturnType<typeof JSON.parse>>, options?: BackgroundJobOptions}) => Promise<string>} enqueue - Enqueues a job.
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
 * @typedef {{type: "job-failed", jobId: string, error?: ReturnType<typeof JSON.parse>, handoffId?: string, workerId?: string, handedOffAtMs?: number, runnerFailure?: PooledRunnerFailure}} BackgroundJobFailedMessage
 * @typedef {{type: "job-reschedule", jobId: string, delayMs: number, handoffId?: string, workerId?: string, handedOffAtMs?: number}} BackgroundJobRescheduleMessage
 * @typedef {{type: "job-updated", jobId: string}} BackgroundJobUpdatedMessage
 * @typedef {{type: "job-update-error", jobId: string, error?: string}} BackgroundJobUpdateErrorMessage
 */
/**
 * @typedef {BackgroundJobHelloMessage | BackgroundJobGenerationAcceptedMessage | BackgroundJobGenerationRejectedMessage | BackgroundJobReadyMessage | BackgroundJobDrainingMessage | BackgroundJobHeartbeatMessage | BackgroundJobEnqueueMessage | BackgroundJobEnqueuedMessage | BackgroundJobEnqueueErrorMessage | BackgroundJobReplaceScheduledMessage | BackgroundJobScheduleReplacedMessage | BackgroundJobReplaceScheduledErrorMessage | BackgroundJobCancelScheduledMessage | BackgroundJobScheduleCancelledMessage | BackgroundJobCancelScheduledErrorMessage | BackgroundJobJobMessage | BackgroundJobCompleteMessage | BackgroundJobFailedMessage | BackgroundJobRescheduleMessage | BackgroundJobUpdatedMessage | BackgroundJobUpdateErrorMessage} BackgroundJobSocketMessage
 */
export const nothing = {};
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoidHlwZXMuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi9zcmMvYmFja2dyb3VuZC1qb2JzL3R5cGVzLmpzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiJBQUFBLFlBQVk7QUFFWjs7R0FFRztBQUNILHlGQUF5RjtBQUN6RixpSUFBaUk7QUFDakksNk5BQTZOO0FBQzdOLGlGQUFpRjtBQUNqRixnRkFBZ0Y7QUFDaEYsd0dBQXdHO0FBQ3hHLHdGQUF3RjtBQUN4Rjs7Ozs7OztHQU9HO0FBQ0g7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7O0dBb0JHO0FBQ0g7Ozs7O0dBS0c7QUFDSDs7Ozs7R0FLRztBQUNIOzs7OztHQUtHO0FBQ0g7Ozs7Ozs7R0FPRztBQUNIOzs7Ozs7Ozs7Ozs7R0FZRztBQUNIOzs7R0FHRztBQUNIOzs7OztHQUtHO0FBQ0g7Ozs7O0dBS0c7QUFDSDs7Ozs7O0dBTUc7QUFDSDs7Ozs7R0FLRztBQUNIOzs7Ozs7Ozs7OztHQVdHO0FBQ0g7Ozs7Ozs7OztHQVNHO0FBQ0g7Ozs7Ozs7R0FPRztBQUNIOzs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7OztHQXVCRztBQUNIOztHQUVHO0FBQ0g7Ozs7O0dBS0c7QUFDSDs7R0FFRztBQUNIOzs7O0dBSUc7QUFDSDs7Ozs7Ozs7Ozs7R0FXRztBQUNIOztHQUVHO0FBQ0g7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7R0FzQkc7QUFDSDs7R0FFRztBQUVILE1BQU0sQ0FBQyxNQUFNLE9BQU8sR0FBRyxFQUFFLENBQUEiLCJzb3VyY2VzQ29udGVudCI6WyIvLyBAdHMtY2hlY2tcblxuLyoqXG4gKiBAdHlwZWRlZiB7XCJpbmxpbmVcIiB8IFwiZm9ya2VkXCIgfCBcInBvb2xlZFwiIHwgXCJzcGF3bmVkXCJ9IEJhY2tncm91bmRKb2JFeGVjdXRpb25Nb2RlXG4gKi9cbi8qKiBAdHlwZWRlZiB7XCJjYW5kaWRhdGVcIiB8IFwiYWN0aXZlXCIgfCBcInJldGlyZWRcIn0gQmFja2dyb3VuZEpvYnNHZW5lcmF0aW9uSW5pdGlhbFN0YXRlICovXG4vKiogQHR5cGVkZWYge1wic3RhcnRpbmdcIiB8IFwiY2FuZGlkYXRlXCIgfCBcImFjdGl2ZVwiIHwgXCJyZXRpcmluZ1wiIHwgXCJyZXRpcmVkXCIgfCBcInN0b3BwZWRcIn0gQmFja2dyb3VuZEpvYnNHZW5lcmF0aW9uTGlmZWN5Y2xlU3RhdGUgKi9cbi8qKiBAdHlwZWRlZiB7XCJtaXNzaW5nLWdlbmVyYXRpb25cIiB8IFwidW5leHBlY3RlZC1nZW5lcmF0aW9uXCIgfCBcIm1hbGZvcm1lZC1nZW5lcmF0aW9uXCIgfCBcImdlbmVyYXRpb24tbWlzbWF0Y2hcIiB8IFwid29ya2VyLWFkbWlzc2lvbi1yZXRpcmVkXCIgfCBcIndvcmtlci1oYXMtbm8tcmVjb3ZlcmFibGUtaGFuZG9mZnNcIn0gQmFja2dyb3VuZEpvYnNHZW5lcmF0aW9uUmVqZWN0aW9uUmVhc29uICovXG4vKiogQHR5cGVkZWYge1wiZXhpdFwiIHwgXCJwcm9jZXNzLWVycm9yXCIgfCBcImlwYy1zZW5kXCJ9IFBvb2xlZFJ1bm5lckZhaWx1cmVPcmlnaW4gKi9cbi8qKiBAdHlwZWRlZiB7XCJzdGFydGluZ1wiIHwgXCJydW5uaW5nXCIgfCBcInJldGlyaW5nXCJ9IFBvb2xlZFJ1bm5lckxpZmVjeWNsZVN0YXRlICovXG4vKiogQHR5cGVkZWYge1widW5leHBlY3RlZFwiIHwgXCJqb2ItdGltZW91dFwiIHwgXCJ3b3JrZXItc2h1dGRvd24tdGltZW91dFwifSBQb29sZWRSdW5uZXJUZXJtaW5hdGlvblJlYXNvbiAqL1xuLyoqIEB0eXBlZGVmIHtcInJ1bm5pbmdcIiB8IFwicmV0aXJpbmdcIiB8IFwic3RvcHBpbmdcIn0gQmFja2dyb3VuZEpvYnNXb3JrZXJMaWZlY3ljbGVTdGF0ZSAqL1xuLyoqXG4gKiBAdHlwZWRlZiB7b2JqZWN0fSBQb29sZWRSdW5uZXJBY3RpdmVKb2JcbiAqIEBwcm9wZXJ0eSB7c3RyaW5nIHwgbnVsbH0gaGFuZG9mZklkIC0gRHVyYWJsZSBoYW5kb2ZmIGxlYXNlIGlkLlxuICogQHByb3BlcnR5IHtudW1iZXIgfCBudWxsfSBoYW5kZWRPZmZBdE1zIC0gRHVyYWJsZSBoYW5kb2ZmIHRpbWVzdGFtcC5cbiAqIEBwcm9wZXJ0eSB7c3RyaW5nfSBqb2JJZCAtIER1cmFibGUgYmFja2dyb3VuZCBqb2IgaWQuXG4gKiBAcHJvcGVydHkge3N0cmluZ30gam9iTmFtZSAtIFJlZ2lzdGVyZWQgam9iIGNsYXNzIG5hbWUuXG4gKiBAcHJvcGVydHkge3N0cmluZ30gd29ya2VySWQgLSBXb3JrZXIgaWRlbnRpdHkgcGVyc2lzdGVkIHdpdGggdGhlIGhhbmRvZmYuXG4gKi9cbi8qKlxuICogT25lIHByb2Nlc3MtZmFpbHVyZSBzbmFwc2hvdCBzaGFyZWQgYnkgZXZlcnkgam9iIGxvc3Qgd2l0aCBhIHBvb2xlZCBjaGlsZC5cbiAqIEB0eXBlZGVmIHtvYmplY3R9IFBvb2xlZFJ1bm5lckZhaWx1cmVcbiAqIEBwcm9wZXJ0eSB7UG9vbGVkUnVubmVyQWN0aXZlSm9iW119IGFjdGl2ZUpvYnMgLSBKb2JzIHRoYXQgd2VyZSBpbiBmbGlnaHQgd2hlbiB0aGUgY2hpbGQgZmFpbGVkLCBvcmRlcmVkIGJ5IGpvYiBpZC5cbiAqIEBwcm9wZXJ0eSB7bnVtYmVyIHwgbnVsbH0gZXhpdENvZGUgLSBDaGlsZCBleGl0IGNvZGUsIG9yIG51bGwgZm9yIHNpZ25hbC9wcm9jZXNzIGVycm9ycy5cbiAqIEBwcm9wZXJ0eSB7c3RyaW5nIHwgbnVsbH0gZ2VuZXJhdGlvbklkIC0gUmVsZWFzZSBnZW5lcmF0aW9uIGlkZW50aXR5LCBvciBudWxsIGluIGxlZ2FjeSBtb2RlLlxuICogQHByb3BlcnR5IHtib29sZWFuIHwgbnVsbH0gb29tS2lsbGVkIC0gRmFsc2Ugd2hlbiB0aGUgb2JzZXJ2ZWQgZXhpdCBydWxlcyBPT00gb3V0OyBudWxsIHdoZW4gYW4gdW5leHBlY3RlZCBTSUdLSUxMIGNhbm5vdCBiZSBkaXN0aW5ndWlzaGVkIGZyb20gYW4gT09NIGtpbGwgd2l0aG91dCBzdXBlcnZpc29yL2tlcm5lbCBldmlkZW5jZS5cbiAqIEBwcm9wZXJ0eSB7UG9vbGVkUnVubmVyRmFpbHVyZU9yaWdpbn0gb3JpZ2luIC0gV29ya2VyIG9ic2VydmF0aW9uIHRoYXQgaW5pdGlhdGVkIGZhaWx1cmUgaGFuZGxpbmcuXG4gKiBAcHJvcGVydHkge251bWJlcn0gcnVubmVyQWdlTXMgLSBDaGlsZCBhZ2Ugd2hlbiBmYWlsdXJlIGhhbmRsaW5nIHN0YXJ0ZWQuXG4gKiBAcHJvcGVydHkge251bWJlcn0gcnVubmVyQ3JlYXRlZEF0TXMgLSBDaGlsZCBjcmVhdGlvbiB0aW1lc3RhbXAuXG4gKiBAcHJvcGVydHkge2Jvb2xlYW59IHJ1bm5lckRldGFjaGVkIC0gV2hldGhlciB0aGUgcnVubmVyIG93bmVkIGEgZGV0YWNoZWQgcHJvY2VzcyBncm91cC5cbiAqIEBwcm9wZXJ0eSB7bnVtYmVyfSBydW5uZXJKb2JzUnVuIC0gUHJldmlvdXNseSBhY2tub3dsZWRnZWQgam9icyBoYW5kbGVkIGJ5IHRoZSBjaGlsZC5cbiAqIEBwcm9wZXJ0eSB7UG9vbGVkUnVubmVyTGlmZWN5Y2xlU3RhdGV9IHJ1bm5lckxpZmVjeWNsZSAtIENoaWxkIGxpZmVjeWNsZSBpbW1lZGlhdGVseSBiZWZvcmUgcmVjb3ZlcnkuXG4gKiBAcHJvcGVydHkge251bWJlciB8IG51bGx9IHJ1bm5lclBpZCAtIENoaWxkIHByb2Nlc3MgaWQgd2hlbiBhdmFpbGFibGUuXG4gKiBAcHJvcGVydHkge2ltcG9ydChcIm5vZGU6Y2hpbGRfcHJvY2Vzc1wiKS5DaGlsZFByb2Nlc3NbXCJzaWduYWxDb2RlXCJdfSBzaWduYWwgLSBDaGlsZCB0ZXJtaW5hdGlvbiBzaWduYWwgd2hlbiBhdmFpbGFibGUuXG4gKiBAcHJvcGVydHkge1Bvb2xlZFJ1bm5lclRlcm1pbmF0aW9uUmVhc29ufSB0ZXJtaW5hdGlvblJlYXNvbiAtIFdoeSB0aGUgd29ya2VyIGV4cGVjdGVkIG9yIGRpZCBub3QgZXhwZWN0IHRlcm1pbmF0aW9uLlxuICogQHByb3BlcnR5IHtzdHJpbmcgfCBudWxsfSB0aW1lb3V0Sm9iSWQgLSBKb2Igd2hvc2UgdGltZW91dCBpbml0aWF0ZWQgY2hpbGQgdGVybWluYXRpb24sIG9yIG51bGwuXG4gKiBAcHJvcGVydHkge3N0cmluZ30gd29ya2VySWQgLSBTdGFibGUgZ2VuZXJhdGlvbi1xdWFsaWZpZWQgd29ya2VyIGlkLlxuICogQHByb3BlcnR5IHtCYWNrZ3JvdW5kSm9ic1dvcmtlckxpZmVjeWNsZVN0YXRlfSB3b3JrZXJMaWZlY3ljbGUgLSBQYXJlbnQgd29ya2VyIGxpZmVjeWNsZSBpbW1lZGlhdGVseSBiZWZvcmUgcmVjb3ZlcnkuXG4gKiBAcHJvcGVydHkge251bWJlcn0gd29ya2VyUGlkIC0gUGFyZW50IHdvcmtlciBwcm9jZXNzIGlkLlxuICovXG4vKipcbiAqIEB0eXBlZGVmIHtvYmplY3R9IExvY2FsQmFja2dyb3VuZEpvYnNDbG9ja1xuICogQHByb3BlcnR5IHsoKSA9PiBudW1iZXJ9IG5vdyAtIEN1cnJlbnQgZXBvY2ggbWlsbGlzZWNvbmRzLlxuICogQHByb3BlcnR5IHsoY2FsbGJhY2s6ICgpID0+IHZvaWQsIGRlbGF5TXM6IG51bWJlcikgPT4gUmV0dXJuVHlwZTx0eXBlb2Ygc2V0VGltZW91dD4gfCBudW1iZXJ9IHNldFRpbWVvdXQgLSBBcm1zIGEgdGltZXIuXG4gKiBAcHJvcGVydHkgeyh0aW1lcklkOiBSZXR1cm5UeXBlPHR5cGVvZiBzZXRUaW1lb3V0PiB8IG51bWJlcikgPT4gdm9pZH0gY2xlYXJUaW1lb3V0IC0gQ2xlYXJzIGEgdGltZXIuXG4gKi9cbi8qKlxuICogQHR5cGVkZWYge29iamVjdH0gUmVzb2x2ZWRCYWNrZ3JvdW5kSm9iQ29uY3VycmVuY3lcbiAqIEBwcm9wZXJ0eSB7c3RyaW5nfSBjb25jdXJyZW5jeUtleSAtIER1cmFibGUgY2FwIGlkZW50aXR5LlxuICogQHByb3BlcnR5IHtudW1iZXJ9IG1heENvbmN1cnJlbmN5IC0gUG9zaXRpdmUgY2FwLlxuICogQHByb3BlcnR5IHtib29sZWFufSBxdWV1ZURlcml2ZWQgLSBXaGV0aGVyIHF1ZXVlIGNvbmZpZ3VyYXRpb24gb3ducyB0aGUgY2FwLlxuICovXG4vKipcbiAqIEB0eXBlZGVmIHtvYmplY3R9IEJhY2tncm91bmRKb2JDb25jdXJyZW5jeVJlcGFpclxuICogQHByb3BlcnR5IHtudW1iZXJ9IGFjdGl2ZUNvdW50IC0gRXhhY3QgaGFuZGVkLW9mZiBqb2IgY291bnQgcGVyc2lzdGVkIGJ5IHRoZSByZXBhaXIuXG4gKiBAcHJvcGVydHkge3N0cmluZ30gY29uY3VycmVuY3lLZXkgLSBEdXJhYmxlIGNhcCBpZGVudGl0eS5cbiAqIEBwcm9wZXJ0eSB7bnVtYmVyfSBwcmV2aW91c0FjdGl2ZUNvdW50IC0gUGVyc2lzdGVkIGNvdW50IHJlcGxhY2VkIGJ5IHRoZSByZXBhaXIuXG4gKi9cbi8qKlxuICogQHR5cGVkZWYge29iamVjdH0gQmFja2dyb3VuZEpvYkNvbmN1cnJlbmN5UmVjb25jaWxpYXRpb25cbiAqIEBwcm9wZXJ0eSB7bnVtYmVyfSBjYW5kaWRhdGVDb3VudCAtIFNuYXBzaG90IG1pc21hdGNoZXMgcmVjaGVja2VkIHVuZGVyIHRoZWlyIGNvdW50ZXIgbG9ja3MuXG4gKiBAcHJvcGVydHkge251bWJlcn0gY2hlY2tlZENvdW50IC0gQWN0aXZlIG9yIG5vbnplcm8gZHVyYWJsZSBjb3VudGVycyBjb21wYXJlZCBpbiB0aGUgaW5pdGlhbCBzbmFwc2hvdC5cbiAqIEBwcm9wZXJ0eSB7bnVtYmVyfSByZXBhaXJlZENvdW50IC0gQ291bnRlcnMgd2hvc2UgcGVyc2lzdGVkIHZhbHVlcyB3ZXJlIGNoYW5nZWQuXG4gKiBAcHJvcGVydHkge0JhY2tncm91bmRKb2JDb25jdXJyZW5jeVJlcGFpcltdfSByZXBhaXJzIC0gQm91bmRlZCBkZXRlcm1pbmlzdGljIHNhbXBsZSBvZiBhcHBsaWVkIHJlcGFpcnMuXG4gKiBAcHJvcGVydHkge251bWJlcn0gcmVwYWlyc1RydW5jYXRlZENvdW50IC0gQXBwbGllZCByZXBhaXJzIG9taXR0ZWQgZnJvbSB0aGUgc2FtcGxlLlxuICovXG4vKipcbiAqIEB0eXBlZGVmIHtvYmplY3R9IFByZXBhcmVkTG9jYWxCYWNrZ3JvdW5kSm9iXG4gKiBAcHJvcGVydHkge3N0cmluZ30gYXJnc0RpZ2VzdCAtIEZpeGVkLXdpZHRoIGRpZ2VzdCBvZiB0aGUgc2VyaWFsaXplZCBhcmd1bWVudHMuXG4gKiBAcHJvcGVydHkge3N0cmluZ30gYXJnc0pzb24gLSBTZXJpYWxpemVkIGFyZ3VtZW50cy5cbiAqIEBwcm9wZXJ0eSB7UmVzb2x2ZWRCYWNrZ3JvdW5kSm9iQ29uY3VycmVuY3kgfCBudWxsfSBjb25jdXJyZW5jeSAtIFJlc29sdmVkIGNvbmN1cnJlbmN5LlxuICogQHByb3BlcnR5IHtudW1iZXJ9IGNyZWF0ZWRBdE1zIC0gQ3JlYXRpb24gdGltZXN0YW1wLlxuICogQHByb3BlcnR5IHtcImlubGluZVwifSBleGVjdXRpb25Nb2RlIC0gTG9jYWwgaW4tcHJvY2VzcyBleGVjdXRpb24gbW9kZS5cbiAqIEBwcm9wZXJ0eSB7c3RyaW5nfSBqb2JJZCAtIER1cmFibGUgaWQuXG4gKiBAcHJvcGVydHkge3N0cmluZ30gam9iTmFtZSAtIFJlZ2lzdGVyZWQgbmFtZS5cbiAqIEBwcm9wZXJ0eSB7bnVtYmVyfSBtYXhSZXRyaWVzIC0gUmV0cnkgY2FwLlxuICogQHByb3BlcnR5IHtzdHJpbmd9IHF1ZXVlIC0gUXVldWUgbmFtZS5cbiAqIEBwcm9wZXJ0eSB7bnVtYmVyfSBzY2hlZHVsZWRBdE1zIC0gRWxpZ2liaWxpdHkgdGltZXN0YW1wLlxuICovXG4vKipcbiAqIEB0eXBlZGVmIHtvYmplY3R9IEJhY2tncm91bmRKb2JzSGVhbHRoXG4gKiBAcHJvcGVydHkge2Jvb2xlYW59IHJlYWR5IC0gV2hldGhlciB0aGUgYWRhcHRlciBjYW4gYWNjZXB0IGFuZCBwcm9jZXNzIHdvcmsuXG4gKi9cbi8qKlxuICogQHR5cGVkZWYge29iamVjdH0gQmFja2dyb3VuZEpvYnNQcm9kdWNlclxuICogQHByb3BlcnR5IHsoYXJnczoge2pvYk5hbWU6IHN0cmluZywgYXJnczogQXJyYXk8UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+LCBvcHRpb25zPzogQmFja2dyb3VuZEpvYk9wdGlvbnN9KSA9PiBQcm9taXNlPHN0cmluZz59IGVucXVldWUgLSBFbnF1ZXVlcyBhIGpvYi5cbiAqIEBwcm9wZXJ0eSB7KGFyZ3M6IHtzY2hlZHVsZUtleTogc3RyaW5nLCBqb2JOYW1lOiBzdHJpbmcsIGFyZ3M6IEFycmF5PFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Piwgb3B0aW9ucz86IEJhY2tncm91bmRKb2JPcHRpb25zfSkgPT4gUHJvbWlzZTxCYWNrZ3JvdW5kSm9iUmVwbGFjZW1lbnRSZXN1bHQ+fSByZXBsYWNlU2NoZWR1bGVkIC0gUmVwbGFjZXMgYSBzdGFibGUgc2NoZWR1bGUuXG4gKiBAcHJvcGVydHkgeyhhcmdzOiB7c2NoZWR1bGVLZXk6IHN0cmluZ30pID0+IFByb21pc2U8QmFja2dyb3VuZEpvYkNhbmNlbGxhdGlvblJlc3VsdD59IGNhbmNlbFNjaGVkdWxlZCAtIENhbmNlbHMgYSBzdGFibGUgc2NoZWR1bGUuXG4gKi9cbi8qKlxuICogQHR5cGVkZWYge29iamVjdH0gQmFja2dyb3VuZEpvYkhhbmRvZmZcbiAqIEBwcm9wZXJ0eSB7c3RyaW5nfSBoYW5kb2ZmSWQgLSBVbmlxdWUgaGFuZG9mZiBsZWFzZSBpZC5cbiAqIEBwcm9wZXJ0eSB7bnVtYmVyfSBoYW5kZWRPZmZBdE1zIC0gVGltZSBoYW5kZWQgdG8gYSB3b3JrZXIgaW4gbXMuXG4gKiBAcHJvcGVydHkge0JhY2tncm91bmRKb2JSb3d9IFtqb2JdIC0gRXhhY3QgY29tbWl0dGVkIGpvYiBzbmFwc2hvdCB3aGVuIHRoZSBhZGFwdGVyIGNoYW5nZXMgZGlzcGF0Y2ggZGF0YSBkdXJpbmcgdGhlIGNsYWltLlxuICovXG4vKipcbiAqIEB0eXBlZGVmIHtvYmplY3R9IEJhY2tncm91bmRKb2JIYW5kb2ZmU25hcHNob3RcbiAqIEBwcm9wZXJ0eSB7c3RyaW5nfSBqb2JJZCAtIEpvYiBob2xkaW5nIHRoZSBsZWFzZS5cbiAqIEBwcm9wZXJ0eSB7c3RyaW5nfSBoYW5kb2ZmSWQgLSBFeGFjdCBkdXJhYmxlIGxlYXNlIGlkLlxuICogQHByb3BlcnR5IHtzdHJpbmd9IHdvcmtlcklkIC0gU3RhYmxlIHdvcmtlciBpZCB0aGF0IHJlY2VpdmVkIHRoZSBsZWFzZS5cbiAqIEBwcm9wZXJ0eSB7bnVtYmVyfSBoYW5kZWRPZmZBdE1zIC0gVGltZSBoYW5kZWQgdG8gdGhlIHdvcmtlciBpbiBtcy5cbiAqL1xuLyoqXG4gKiBAdHlwZWRlZiB7b2JqZWN0fSBCYWNrZ3JvdW5kSm9iSGFuZG9mZlJlcXVlc3RcbiAqIEBwcm9wZXJ0eSB7c3RyaW5nfSBqb2JJZCAtIEpvYiB0byBjbGFpbS5cbiAqIEBwcm9wZXJ0eSB7c3RyaW5nfSBbaGFuZG9mZklkXSAtIEV4YWN0IGNhbGxlci1zZWxlY3RlZCBsZWFzZSBpZC4gQWRhcHRlcnMgbXVzdCBwZXJzaXN0IGFuZCByZXR1cm4gdGhpcyBpZCB3aGVuIHN1cHBsaWVkOyBidWlsdC1pbiBhZGFwdGVycyBnZW5lcmF0ZSBvbmUgd2hlbiBvbWl0dGVkIGZvciBsZWdhY3kgZGlyZWN0IGNhbGxlcnMuXG4gKiBAcHJvcGVydHkge3N0cmluZ30gW3dvcmtlcklkXSAtIFdvcmtlciBjbGFpbWluZyB0aGUgam9iLlxuICovXG4vKipcbiAqIEB0eXBlZGVmIHtvYmplY3R9IEJhY2tncm91bmRKb2JPcHRpb25zXG4gKiBAcHJvcGVydHkge0JhY2tncm91bmRKb2JFeGVjdXRpb25Nb2RlfSBbZXhlY3V0aW9uTW9kZV0gLSBIb3cgdGhlIGpvYiBzaG91bGQgcnVuLiBOb2RlIGRlZmF1bHRzIHRvIGBcInBvb2xlZFwiYCAoYSB3YXJtLCByZXVzZWQgbG9jYWwgcnVubmVyIHByb2Nlc3MpLiBCcm93c2VyL0V4cG8gbG9jYWwgZGlzcGF0Y2ggZGVmYXVsdHMgdG8gYW5kIG9ubHkgYWNjZXB0cyBgXCJpbmxpbmVcImAuIGBcImZvcmtlZFwiYCBydW5zIGEgTm9kZSBqb2IgaW4gYSBmcmVzaCBgY2hpbGRfcHJvY2Vzcy5mb3JrKClgIGNoaWxkLCBhbmQgYFwic3Bhd25lZFwiYCBpbiBhIGRldGFjaGVkIENMSSBydW5uZXIuXG4gKiBAcHJvcGVydHkge251bWJlcn0gW21heFJldHJpZXNdIC0gTWF4IHJldHJpZXMgZm9yIGEgZmFpbGVkIGpvYiBiZWZvcmUgaXQgaXMgbWFya2VkIGZhaWxlZC5cbiAqIEBwcm9wZXJ0eSB7c3RyaW5nfSBbcXVldWVdIC0gUXVldWUgbmFtZS4gRGVmYXVsdHMgdG8gYFwiZGVmYXVsdFwiYC4gV2hlbiB0aGUgcXVldWUgaGFzIGEgY29uZmlndXJlZCBjYXAgaW4gYGJhY2tncm91bmRKb2JzLnF1ZXVlc2AsIHRoYXQgY2FwIGlzIGVuZm9yY2VkIGNsdXN0ZXItd2lkZS5cbiAqIEBwcm9wZXJ0eSB7c3RyaW5nfSBbY29uY3VycmVuY3lLZXldIC0gT3BhcXVlIG5vbi1lbXB0eSBrZXkgdXNlZCB0byBzaGFyZSBhIGNvbmN1cnJlbmN5IGNhcC4gT3ZlcnJpZGVzIGFueSBxdWV1ZS1kZXJpdmVkIGNhcC5cbiAqIEBwcm9wZXJ0eSB7bnVtYmVyfSBbbWF4Q29uY3VycmVuY3ldIC0gUG9zaXRpdmUgaW50ZWdlciBjYXA7IG11c3QgYmUgcGFpcmVkIHdpdGggYGNvbmN1cnJlbmN5S2V5YC5cbiAqIEBwcm9wZXJ0eSB7Ym9vbGVhbn0gW2RlZHVwbGljYXRlV2hpbGVRdWV1ZWRdIC0gV2hlbiB0cnVlLCBza2lwIHRoZSBlbnF1ZXVlIGlmIGFuIGlkZW50aWNhbCBzdGlsbC1xdWV1ZWQgam9iIChzYW1lIGpvYiBuYW1lLCBhcmdzIGFuZCBxdWV1ZSkgaXMgc2NoZWR1bGVkIG5vIGxhdGVyIHRoYW4gdGhpcyBlbnF1ZXVlLCByZXR1cm5pbmcgdGhlIGVhcmxpZXN0IG1hdGNoaW5nIGpvYidzIGlkLiBBIGZ1dHVyZSByZXRyeSBkb2VzIG5vdCBzdXBwcmVzcyBlYXJsaWVyIHdvcmsuIERlZHVwbGljYXRpb24gaXMgaW5kZXBlbmRlbnQgb2YgYGNvbmN1cnJlbmN5S2V5YCwgc28gdGhlIGpvYiBrZWVwcyBpdHMgbm9ybWFsIChlLmcuIHF1ZXVlLWRlcml2ZWQpIGNvbmN1cnJlbmN5IGNhcC4gS2VlcHMgYW4gaW50ZXJ2YWwtc2NoZWR1bGVkIHJlY3VycmluZyBqb2IgKGUuZy4gcmV0ZW50aW9uIHBydW5pbmcpIGZyb20gcGlsaW5nIHVwIHJlZHVuZGFudCBxdWV1ZWQgcm93cyB3aGVuIGl0IHJ1bnMgc2xvd2VyIHRoYW4gaXRzIGludGVydmFsIG9yIG5vIHdvcmtlciBpcyBmcmVlLlxuICogQHByb3BlcnR5IHtzdHJpbmd9IFtpZGVtcG90ZW5jeUtleV0gLSBEdXJhYmxlIGVucXVldWUgaWRlbnRpdHkgc2NvcGVkIHRvIHRoZSByZXNvbHZlZCBqb2IgY2xhc3MgbmFtZSBhbmQgcXVldWUuIEV4YWN0IHJlcGxheSByZXR1cm5zIHRoZSBvcmlnaW5hbCBqb2IgaWQgYWNyb3NzIGV2ZXJ5IHN0YXRlIGFuZCBhZnRlciBqb2IgcHJ1bmluZzsgcmV1c2Ugd2l0aCBkaWZmZXJlbnQgY2Fub25pY2FsIGFyZ3VtZW50cyBvciBiZWhhdmlvci1hZmZlY3Rpbmcgb3B0aW9ucyBmYWlscy4gT3duZXJzaGlwIGlzIGluZGVwZW5kZW50IG9mIGBkZWR1cGxpY2F0ZVdoaWxlUXVldWVkYCBhbmQgaXMgcmV0YWluZWQgdW50aWwgYW4gZXhwbGljaXQgZnV0dXJlIHJldGVudGlvbiBwb2xpY3kgcmVtb3ZlcyBpdC5cbiAqIEBwcm9wZXJ0eSB7bnVtYmVyfSBbc2NoZWR1bGVkQXRNc10gLSBFcG9jaCB0aW1lc3RhbXAgaW4gbWlsbGlzZWNvbmRzIHdoZW4gdGhlIGpvYiBiZWNvbWVzIGVsaWdpYmxlIGZvciBkaXNwYXRjaC4gRGVmYXVsdHMgdG8gZW5xdWV1ZSB0aW1lLlxuICogQHByb3BlcnR5IHtudW1iZXJ9IFt0aW1lb3V0TXNdIC0gUGVyLWpvYiB3YWxsLWNsb2NrIHRpbWVvdXQgZm9yIGZvcmtlZCBhbmQgcG9vbGVkIGV4ZWN1dGlvbi4gQSBwb3NpdGl2ZSBpbnRlZ2VyIHVwIHRvIDIsMTQ3LDQ4Myw2NDcgb3ZlcnJpZGVzIHRoZSB3b3JrZXItbGV2ZWwgYGpvYlRpbWVvdXRNc2A7IGEgbm9uLXBvc2l0aXZlIGZpbml0ZSB2YWx1ZSBkaXNhYmxlcyB0aGUgdGltZW91dCBmb3IgdGhpcyBqb2IuXG4gKi9cbi8qKlxuICogQHR5cGVkZWYge29iamVjdH0gQmFja2dyb3VuZEpvYlBheWxvYWRcbiAqIEBwcm9wZXJ0eSB7c3RyaW5nfSBbaWRdIC0gSm9iIGlkLlxuICogQHByb3BlcnR5IHtzdHJpbmd9IGpvYk5hbWUgLSBKb2IgY2xhc3MgbmFtZS5cbiAqIEBwcm9wZXJ0eSB7QXJyYXk8UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSBbYXJnc10gLSBTZXJpYWxpemVkIGpvYiBhcmd1bWVudHMuXG4gKiBAcHJvcGVydHkge3N0cmluZ30gW2hhbmRvZmZJZF0gLSBVbmlxdWUgaGFuZG9mZiBsZWFzZSBpZC5cbiAqIEBwcm9wZXJ0eSB7c3RyaW5nfSBbd29ya2VySWRdIC0gV29ya2VyIGlkIGhhbmRsaW5nIHRoZSBqb2IuXG4gKiBAcHJvcGVydHkge251bWJlcn0gW2hhbmRlZE9mZkF0TXNdIC0gVGltZSBoYW5kZWQgdG8gYSB3b3JrZXIgaW4gbXMuXG4gKiBAcHJvcGVydHkge0JhY2tncm91bmRKb2JPcHRpb25zfSBbb3B0aW9uc10gLSBSdW50aW1lIG9wdGlvbnMuXG4gKi9cbi8qKlxuICogQHR5cGVkZWYge29iamVjdH0gQmFja2dyb3VuZEpvYkNvbnRleHRcbiAqIEBwcm9wZXJ0eSB7dHlwZW9mIGltcG9ydChcIi4vcGxhdGZvcm0tam9iLmpzXCIpLmRlZmF1bHR9IGpvYkNsYXNzIC0gQ29uY3JldGUgam9iIGNsYXNzLlxuICogQHByb3BlcnR5IHtzdHJpbmd9IGpvYk5hbWUgLSBSZWdpc3RlcmVkIGpvYiBuYW1lLlxuICogQHByb3BlcnR5IHtBcnJheTxSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59IGFyZ3MgLSBTZXJpYWxpemVkIGpvYiBhcmd1bWVudHMuXG4gKiBAcHJvcGVydHkge0JhY2tncm91bmRKb2JPcHRpb25zfSBvcHRpb25zIC0gUmVzb2x2ZWQgZW5xdWV1ZS9ydW50aW1lIG9wdGlvbnMuXG4gKiBAcHJvcGVydHkge0JhY2tncm91bmRKb2JQYXlsb2FkfSBbcGF5bG9hZF0gLSBDb21wbGV0ZSBwZXJzaXN0ZWQgcnVubmVyIHBheWxvYWQgd2hlbiB0aGUgam9iIGlzIHBlcmZvcm1pbmcuXG4gKi9cbi8qKlxuICogQHR5cGVkZWYge29iamVjdH0gQmFja2dyb3VuZEpvYlJvd1xuICogQHByb3BlcnR5IHtzdHJpbmd9IGlkIC0gSm9iIGlkLlxuICogQHByb3BlcnR5IHtzdHJpbmd9IGpvYk5hbWUgLSBKb2IgY2xhc3MgbmFtZS5cbiAqIEBwcm9wZXJ0eSB7QXJyYXk8UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSBhcmdzIC0gU2VyaWFsaXplZCBqb2IgYXJndW1lbnRzLlxuICogQHByb3BlcnR5IHtCYWNrZ3JvdW5kSm9iRXhlY3V0aW9uTW9kZX0gZXhlY3V0aW9uTW9kZSAtIEhvdyB0aGUgam9iIHNob3VsZCBydW4uXG4gKiBAcHJvcGVydHkge3N0cmluZ30gcXVldWUgLSBRdWV1ZSBuYW1lIChkZWZhdWx0cyB0byBgXCJkZWZhdWx0XCJgKS5cbiAqIEBwcm9wZXJ0eSB7c3RyaW5nIHwgbnVsbH0gc2NoZWR1bGVLZXkgLSBTdGFibGUgbG9naWNhbCBzY2hlZHVsZSBrZXkgcmV0YWluZWQgZm9yIGhpc3RvcnkuXG4gKiBAcHJvcGVydHkge3N0cmluZ30gc3RhdHVzIC0gQ3VycmVudCBqb2Igc3RhdHVzLlxuICogQHByb3BlcnR5IHtudW1iZXIgfCBudWxsfSBhdHRlbXB0cyAtIEZhaWx1cmUgYXR0ZW1wdHMgY291bnQuXG4gKiBAcHJvcGVydHkge251bWJlciB8IG51bGx9IG1heFJldHJpZXMgLSBNYXggcmV0cnkgYXR0ZW1wdHMuXG4gKiBAcHJvcGVydHkge251bWJlciB8IG51bGx9IHNjaGVkdWxlZEF0TXMgLSBOZXh0IHNjaGVkdWxlZCB0aW1lIGluIG1zLlxuICogQHByb3BlcnR5IHtudW1iZXIgfCBudWxsfSBjcmVhdGVkQXRNcyAtIENyZWF0aW9uIHRpbWUgaW4gbXMuXG4gKiBAcHJvcGVydHkge251bWJlciB8IG51bGx9IGhhbmRlZE9mZkF0TXMgLSBUaW1lIGhhbmRlZCB0byB3b3JrZXIgaW4gbXMuXG4gKiBAcHJvcGVydHkge3N0cmluZyB8IG51bGx9IGhhbmRvZmZJZCAtIFVuaXF1ZSBsYXRlc3QgaGFuZG9mZiBsZWFzZSBpZC5cbiAqIEBwcm9wZXJ0eSB7bnVtYmVyIHwgbnVsbH0gY29tcGxldGVkQXRNcyAtIENvbXBsZXRpb24gdGltZSBpbiBtcy5cbiAqIEBwcm9wZXJ0eSB7bnVtYmVyIHwgbnVsbH0gZmFpbGVkQXRNcyAtIEZhaWx1cmUgdGltZSBpbiBtcy5cbiAqIEBwcm9wZXJ0eSB7bnVtYmVyIHwgbnVsbH0gb3JwaGFuZWRBdE1zIC0gT3JwaGFuZWQgdGltZSBpbiBtcy5cbiAqIEBwcm9wZXJ0eSB7c3RyaW5nIHwgbnVsbH0gd29ya2VySWQgLSBXb3JrZXIgaWQgaGFuZGxpbmcgdGhlIGpvYi5cbiAqIEBwcm9wZXJ0eSB7c3RyaW5nIHwgbnVsbH0gbGFzdEVycm9yIC0gTGFzdCBmYWlsdXJlIG1lc3NhZ2UuXG4gKiBAcHJvcGVydHkge3N0cmluZyB8IG51bGx9IGNvbmN1cnJlbmN5S2V5IC0gRHVyYWJsZSBjb25jdXJyZW5jeSBrZXkuXG4gKiBAcHJvcGVydHkge251bWJlciB8IG51bGx9IG1heENvbmN1cnJlbmN5IC0gRHVyYWJsZSBwZXIta2V5IGNhcC5cbiAqIEBwcm9wZXJ0eSB7bnVtYmVyIHwgbnVsbH0gdGltZW91dE1zIC0gUGVyLWpvYiB3YWxsLWNsb2NrIHRpbWVvdXQgb3ZlcnJpZGUsIG9yIG51bGwgd2hlbiBvbWl0dGVkLlxuICovXG4vKipcbiAqIEB0eXBlZGVmIHtcInF1ZXVlZFwiIHwgXCJoYW5kZWRfb2ZmXCIgfCBudWxsfSBCYWNrZ3JvdW5kSm9iUmVwbGFjZW1lbnRQcmV2aW91c1N0YXR1c1xuICovXG4vKipcbiAqIEB0eXBlZGVmIHtvYmplY3R9IEJhY2tncm91bmRKb2JSZXBsYWNlbWVudFJlc3VsdFxuICogQHByb3BlcnR5IHtzdHJpbmd9IGpvYklkIC0gTmV3bHkgcXVldWVkIGpvYiBpZC5cbiAqIEBwcm9wZXJ0eSB7c3RyaW5nIHwgbnVsbH0gcHJldmlvdXNKb2JJZCAtIFByZXZpb3VzIGFjdGl2ZSBvd25lcidzIGpvYiBpZC5cbiAqIEBwcm9wZXJ0eSB7QmFja2dyb3VuZEpvYlJlcGxhY2VtZW50UHJldmlvdXNTdGF0dXN9IHByZXZpb3VzU3RhdHVzIC0gUHJldmlvdXMgb3duZXIncyBvYnNlcnZlZCBzdGF0ZS5cbiAqL1xuLyoqXG4gKiBAdHlwZWRlZiB7XCJjYW5jZWxsZWRcIiB8IFwiaGFuZGVkX29mZlwiIHwgXCJub3RfZm91bmRcIn0gQmFja2dyb3VuZEpvYkNhbmNlbGxhdGlvbk91dGNvbWVcbiAqL1xuLyoqXG4gKiBAdHlwZWRlZiB7b2JqZWN0fSBCYWNrZ3JvdW5kSm9iQ2FuY2VsbGF0aW9uUmVzdWx0XG4gKiBAcHJvcGVydHkge3N0cmluZyB8IG51bGx9IGpvYklkIC0gRGV0YWNoZWQgb3duZXIncyBqb2IgaWQsIHdoZW4gb25lIHdhcyBhY3RpdmUuXG4gKiBAcHJvcGVydHkge0JhY2tncm91bmRKb2JDYW5jZWxsYXRpb25PdXRjb21lfSBvdXRjb21lIC0gVHJ1dGhmdWwgYmVzdC1lZmZvcnQgb3V0Y29tZS5cbiAqL1xuLyoqXG4gKiBAdHlwZWRlZiB7b2JqZWN0fSBCYWNrZ3JvdW5kSm9iRmFpbHVyZUV2ZW50XG4gKiBAcHJvcGVydHkge0JhY2tncm91bmRKb2JSb3d9IGpvYiAtIFVwZGF0ZWQgam9iIHJvdyBhZnRlciBmYWlsdXJlIGhhbmRsaW5nLlxuICogQHByb3BlcnR5IHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gZXJyb3IgLSBGYWlsdXJlIGVycm9yLlxuICogQHByb3BlcnR5IHtudW1iZXIgfCBudWxsfSBhdHRlbXB0cyAtIFVwZGF0ZWQgZmFpbHVyZSBhdHRlbXB0cyBjb3VudC5cbiAqIEBwcm9wZXJ0eSB7Ym9vbGVhbn0gdGVybWluYWwgLSBXaGV0aGVyIHRoaXMgZmFpbHVyZSBlbmRlZCB0aGUgam9iLlxuICogQHByb3BlcnR5IHtib29sZWFufSB3aWxsUmV0cnkgLSBXaGV0aGVyIHRoZSBqb2Igd2FzIHJldHVybmVkIHRvIHRoZSBxdWV1ZS5cbiAqIEBwcm9wZXJ0eSB7c3RyaW5nIHwgdW5kZWZpbmVkfSBoYW5kb2ZmSWQgLSBIYW5kb2ZmIGxlYXNlIGlkIGZyb20gdGhlIHdvcmtlciByZXBvcnQuXG4gKiBAcHJvcGVydHkge251bWJlciB8IHVuZGVmaW5lZH0gaGFuZGVkT2ZmQXRNcyAtIEhhbmRvZmYgdGltZXN0YW1wIGZyb20gdGhlIHdvcmtlciByZXBvcnQuXG4gKiBAcHJvcGVydHkge3N0cmluZyB8IHVuZGVmaW5lZH0gd29ya2VySWQgLSBXb3JrZXIgaWQgZnJvbSB0aGUgd29ya2VyIHJlcG9ydC5cbiAqIEBwcm9wZXJ0eSB7UG9vbGVkUnVubmVyRmFpbHVyZSB8IHVuZGVmaW5lZH0gcnVubmVyRmFpbHVyZSAtIFNoYXJlZCBwb29sZWQtY2hpbGQgcHJvY2VzcyBmYWlsdXJlIHByb3ZlbmFuY2UuXG4gKi9cbi8qKlxuICogQHR5cGVkZWYge1wid29ya2VyXCIgfCBcImNsaWVudFwiIHwgXCJyZXBvcnRlclwifSBCYWNrZ3JvdW5kSm9iU29ja2V0Um9sZVxuICovXG4vKipcbiAqIEB0eXBlZGVmIHt7dHlwZTogXCJoZWxsb1wiLCByb2xlOiBCYWNrZ3JvdW5kSm9iU29ja2V0Um9sZSwgZ2VuZXJhdGlvbklkPzogc3RyaW5nLCBzdXBwb3J0c0hhbmRvZmZJZFJlcG9ydGluZz86IGJvb2xlYW4sIHN1cHBvcnRzSGVhcnRiZWF0PzogYm9vbGVhbiwgc3VwcG9ydHNQb29sZWQ/OiBib29sZWFuLCB3b3JrZXJJZD86IHN0cmluZ319IEJhY2tncm91bmRKb2JIZWxsb01lc3NhZ2VcbiAqIEB0eXBlZGVmIHt7dHlwZTogXCJnZW5lcmF0aW9uLWFjY2VwdGVkXCIsIGdlbmVyYXRpb25JZDogc3RyaW5nLCBsaWZlY3ljbGVTdGF0ZTogQmFja2dyb3VuZEpvYnNHZW5lcmF0aW9uTGlmZWN5Y2xlU3RhdGV9fSBCYWNrZ3JvdW5kSm9iR2VuZXJhdGlvbkFjY2VwdGVkTWVzc2FnZVxuICogQHR5cGVkZWYge3t0eXBlOiBcImdlbmVyYXRpb24tcmVqZWN0ZWRcIiwgcmVhc29uOiBCYWNrZ3JvdW5kSm9ic0dlbmVyYXRpb25SZWplY3Rpb25SZWFzb259fSBCYWNrZ3JvdW5kSm9iR2VuZXJhdGlvblJlamVjdGVkTWVzc2FnZVxuICogQHR5cGVkZWYge3t0eXBlOiBcInJlYWR5XCIsIGFjY2VwdHNGb3JrZWQ/OiBib29sZWFuLCBhY2NlcHRzSW5saW5lPzogYm9vbGVhbiwgYWNjZXB0c1Bvb2xlZD86IGJvb2xlYW4sIGFjY2VwdHNTcGF3bmVkPzogYm9vbGVhbiwgYXZhaWxhYmxlUG9vbGVkU2xvdHM/OiBudW1iZXJ9fSBCYWNrZ3JvdW5kSm9iUmVhZHlNZXNzYWdlXG4gKiBAdHlwZWRlZiB7e3R5cGU6IFwiZHJhaW5pbmdcIn19IEJhY2tncm91bmRKb2JEcmFpbmluZ01lc3NhZ2VcbiAqIEB0eXBlZGVmIHt7dHlwZTogXCJoZWFydGJlYXRcIiwgd29ya2VySWQ/OiBzdHJpbmd9fSBCYWNrZ3JvdW5kSm9iSGVhcnRiZWF0TWVzc2FnZVxuICogQHR5cGVkZWYge3t0eXBlOiBcImVucXVldWVcIiwgam9iTmFtZTogc3RyaW5nLCBhcmdzPzogQXJyYXk8UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+LCBvcHRpb25zPzogQmFja2dyb3VuZEpvYk9wdGlvbnN9fSBCYWNrZ3JvdW5kSm9iRW5xdWV1ZU1lc3NhZ2VcbiAqIEB0eXBlZGVmIHt7dHlwZTogXCJlbnF1ZXVlZFwiLCBqb2JJZDogc3RyaW5nfX0gQmFja2dyb3VuZEpvYkVucXVldWVkTWVzc2FnZVxuICogQHR5cGVkZWYge3t0eXBlOiBcImVucXVldWUtZXJyb3JcIiwgZXJyb3I/OiBzdHJpbmd9fSBCYWNrZ3JvdW5kSm9iRW5xdWV1ZUVycm9yTWVzc2FnZVxuICogQHR5cGVkZWYge3t0eXBlOiBcInJlcGxhY2Utc2NoZWR1bGVkXCIsIHNjaGVkdWxlS2V5OiBzdHJpbmcsIGpvYk5hbWU6IHN0cmluZywgYXJncz86IEFycmF5PFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Piwgb3B0aW9ucz86IEJhY2tncm91bmRKb2JPcHRpb25zfX0gQmFja2dyb3VuZEpvYlJlcGxhY2VTY2hlZHVsZWRNZXNzYWdlXG4gKiBAdHlwZWRlZiB7e3R5cGU6IFwic2NoZWR1bGUtcmVwbGFjZWRcIiwgam9iSWQ6IHN0cmluZywgcHJldmlvdXNKb2JJZDogc3RyaW5nIHwgbnVsbCwgcHJldmlvdXNTdGF0dXM6IEJhY2tncm91bmRKb2JSZXBsYWNlbWVudFByZXZpb3VzU3RhdHVzfX0gQmFja2dyb3VuZEpvYlNjaGVkdWxlUmVwbGFjZWRNZXNzYWdlXG4gKiBAdHlwZWRlZiB7e3R5cGU6IFwicmVwbGFjZS1zY2hlZHVsZWQtZXJyb3JcIiwgZXJyb3I/OiBzdHJpbmd9fSBCYWNrZ3JvdW5kSm9iUmVwbGFjZVNjaGVkdWxlZEVycm9yTWVzc2FnZVxuICogQHR5cGVkZWYge3t0eXBlOiBcImNhbmNlbC1zY2hlZHVsZWRcIiwgc2NoZWR1bGVLZXk6IHN0cmluZ319IEJhY2tncm91bmRKb2JDYW5jZWxTY2hlZHVsZWRNZXNzYWdlXG4gKiBAdHlwZWRlZiB7e3R5cGU6IFwic2NoZWR1bGUtY2FuY2VsbGVkXCIsIGpvYklkOiBzdHJpbmcgfCBudWxsLCBvdXRjb21lOiBCYWNrZ3JvdW5kSm9iQ2FuY2VsbGF0aW9uT3V0Y29tZX19IEJhY2tncm91bmRKb2JTY2hlZHVsZUNhbmNlbGxlZE1lc3NhZ2VcbiAqIEB0eXBlZGVmIHt7dHlwZTogXCJjYW5jZWwtc2NoZWR1bGVkLWVycm9yXCIsIGVycm9yPzogc3RyaW5nfX0gQmFja2dyb3VuZEpvYkNhbmNlbFNjaGVkdWxlZEVycm9yTWVzc2FnZVxuICogQHR5cGVkZWYge3t0eXBlOiBcImpvYlwiLCBwYXlsb2FkOiBCYWNrZ3JvdW5kSm9iUGF5bG9hZH19IEJhY2tncm91bmRKb2JKb2JNZXNzYWdlXG4gKiBAdHlwZWRlZiB7e3R5cGU6IFwiam9iLWNvbXBsZXRlXCIsIGpvYklkOiBzdHJpbmcsIGhhbmRvZmZJZD86IHN0cmluZywgd29ya2VySWQ/OiBzdHJpbmcsIGhhbmRlZE9mZkF0TXM/OiBudW1iZXJ9fSBCYWNrZ3JvdW5kSm9iQ29tcGxldGVNZXNzYWdlXG4gKiBAdHlwZWRlZiB7e3R5cGU6IFwiam9iLWZhaWxlZFwiLCBqb2JJZDogc3RyaW5nLCBlcnJvcj86IFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+LCBoYW5kb2ZmSWQ/OiBzdHJpbmcsIHdvcmtlcklkPzogc3RyaW5nLCBoYW5kZWRPZmZBdE1zPzogbnVtYmVyLCBydW5uZXJGYWlsdXJlPzogUG9vbGVkUnVubmVyRmFpbHVyZX19IEJhY2tncm91bmRKb2JGYWlsZWRNZXNzYWdlXG4gKiBAdHlwZWRlZiB7e3R5cGU6IFwiam9iLXJlc2NoZWR1bGVcIiwgam9iSWQ6IHN0cmluZywgZGVsYXlNczogbnVtYmVyLCBoYW5kb2ZmSWQ/OiBzdHJpbmcsIHdvcmtlcklkPzogc3RyaW5nLCBoYW5kZWRPZmZBdE1zPzogbnVtYmVyfX0gQmFja2dyb3VuZEpvYlJlc2NoZWR1bGVNZXNzYWdlXG4gKiBAdHlwZWRlZiB7e3R5cGU6IFwiam9iLXVwZGF0ZWRcIiwgam9iSWQ6IHN0cmluZ319IEJhY2tncm91bmRKb2JVcGRhdGVkTWVzc2FnZVxuICogQHR5cGVkZWYge3t0eXBlOiBcImpvYi11cGRhdGUtZXJyb3JcIiwgam9iSWQ6IHN0cmluZywgZXJyb3I/OiBzdHJpbmd9fSBCYWNrZ3JvdW5kSm9iVXBkYXRlRXJyb3JNZXNzYWdlXG4gKi9cbi8qKlxuICogQHR5cGVkZWYge0JhY2tncm91bmRKb2JIZWxsb01lc3NhZ2UgfCBCYWNrZ3JvdW5kSm9iR2VuZXJhdGlvbkFjY2VwdGVkTWVzc2FnZSB8IEJhY2tncm91bmRKb2JHZW5lcmF0aW9uUmVqZWN0ZWRNZXNzYWdlIHwgQmFja2dyb3VuZEpvYlJlYWR5TWVzc2FnZSB8IEJhY2tncm91bmRKb2JEcmFpbmluZ01lc3NhZ2UgfCBCYWNrZ3JvdW5kSm9iSGVhcnRiZWF0TWVzc2FnZSB8IEJhY2tncm91bmRKb2JFbnF1ZXVlTWVzc2FnZSB8IEJhY2tncm91bmRKb2JFbnF1ZXVlZE1lc3NhZ2UgfCBCYWNrZ3JvdW5kSm9iRW5xdWV1ZUVycm9yTWVzc2FnZSB8IEJhY2tncm91bmRKb2JSZXBsYWNlU2NoZWR1bGVkTWVzc2FnZSB8IEJhY2tncm91bmRKb2JTY2hlZHVsZVJlcGxhY2VkTWVzc2FnZSB8IEJhY2tncm91bmRKb2JSZXBsYWNlU2NoZWR1bGVkRXJyb3JNZXNzYWdlIHwgQmFja2dyb3VuZEpvYkNhbmNlbFNjaGVkdWxlZE1lc3NhZ2UgfCBCYWNrZ3JvdW5kSm9iU2NoZWR1bGVDYW5jZWxsZWRNZXNzYWdlIHwgQmFja2dyb3VuZEpvYkNhbmNlbFNjaGVkdWxlZEVycm9yTWVzc2FnZSB8IEJhY2tncm91bmRKb2JKb2JNZXNzYWdlIHwgQmFja2dyb3VuZEpvYkNvbXBsZXRlTWVzc2FnZSB8IEJhY2tncm91bmRKb2JGYWlsZWRNZXNzYWdlIHwgQmFja2dyb3VuZEpvYlJlc2NoZWR1bGVNZXNzYWdlIHwgQmFja2dyb3VuZEpvYlVwZGF0ZWRNZXNzYWdlIHwgQmFja2dyb3VuZEpvYlVwZGF0ZUVycm9yTWVzc2FnZX0gQmFja2dyb3VuZEpvYlNvY2tldE1lc3NhZ2VcbiAqL1xuXG5leHBvcnQgY29uc3Qgbm90aGluZyA9IHt9XG4iXX0=