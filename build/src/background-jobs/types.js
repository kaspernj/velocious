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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoidHlwZXMuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi9zcmMvYmFja2dyb3VuZC1qb2JzL3R5cGVzLmpzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiJBQUFBLFlBQVk7QUFFWjs7R0FFRztBQUNILHlGQUF5RjtBQUN6RixpSUFBaUk7QUFDakksNk5BQTZOO0FBQzdOLGlGQUFpRjtBQUNqRixnRkFBZ0Y7QUFDaEYsd0dBQXdHO0FBQ3hHLHdGQUF3RjtBQUN4Rjs7Ozs7Ozs7R0FRRztBQUNIOzs7Ozs7O0dBT0c7QUFDSDs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7R0FvQkc7QUFDSDs7Ozs7R0FLRztBQUNIOzs7OztHQUtHO0FBQ0g7Ozs7O0dBS0c7QUFDSDs7Ozs7OztHQU9HO0FBQ0g7Ozs7Ozs7Ozs7OztHQVlHO0FBQ0g7OztHQUdHO0FBQ0g7Ozs7O0dBS0c7QUFDSDs7Ozs7R0FLRztBQUNIOzs7Ozs7R0FNRztBQUNIOzs7OztHQUtHO0FBQ0g7Ozs7Ozs7Ozs7O0dBV0c7QUFDSDs7Ozs7Ozs7O0dBU0c7QUFDSDs7Ozs7OztHQU9HO0FBQ0g7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7O0dBdUJHO0FBQ0g7O0dBRUc7QUFDSDs7Ozs7R0FLRztBQUNIOztHQUVHO0FBQ0g7Ozs7R0FJRztBQUNIOzs7Ozs7Ozs7OztHQVdHO0FBQ0g7O0dBRUc7QUFDSDs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7OztHQXNCRztBQUNIOztHQUVHO0FBRUgsTUFBTSxDQUFDLE1BQU0sT0FBTyxHQUFHLEVBQUUsQ0FBQSIsInNvdXJjZXNDb250ZW50IjpbIi8vIEB0cy1jaGVja1xuXG4vKipcbiAqIEB0eXBlZGVmIHtcImlubGluZVwiIHwgXCJmb3JrZWRcIiB8IFwicG9vbGVkXCIgfCBcInNwYXduZWRcIn0gQmFja2dyb3VuZEpvYkV4ZWN1dGlvbk1vZGVcbiAqL1xuLyoqIEB0eXBlZGVmIHtcImNhbmRpZGF0ZVwiIHwgXCJhY3RpdmVcIiB8IFwicmV0aXJlZFwifSBCYWNrZ3JvdW5kSm9ic0dlbmVyYXRpb25Jbml0aWFsU3RhdGUgKi9cbi8qKiBAdHlwZWRlZiB7XCJzdGFydGluZ1wiIHwgXCJjYW5kaWRhdGVcIiB8IFwiYWN0aXZlXCIgfCBcInJldGlyaW5nXCIgfCBcInJldGlyZWRcIiB8IFwic3RvcHBlZFwifSBCYWNrZ3JvdW5kSm9ic0dlbmVyYXRpb25MaWZlY3ljbGVTdGF0ZSAqL1xuLyoqIEB0eXBlZGVmIHtcIm1pc3NpbmctZ2VuZXJhdGlvblwiIHwgXCJ1bmV4cGVjdGVkLWdlbmVyYXRpb25cIiB8IFwibWFsZm9ybWVkLWdlbmVyYXRpb25cIiB8IFwiZ2VuZXJhdGlvbi1taXNtYXRjaFwiIHwgXCJ3b3JrZXItYWRtaXNzaW9uLXJldGlyZWRcIiB8IFwid29ya2VyLWhhcy1uby1yZWNvdmVyYWJsZS1oYW5kb2Zmc1wifSBCYWNrZ3JvdW5kSm9ic0dlbmVyYXRpb25SZWplY3Rpb25SZWFzb24gKi9cbi8qKiBAdHlwZWRlZiB7XCJleGl0XCIgfCBcInByb2Nlc3MtZXJyb3JcIiB8IFwiaXBjLXNlbmRcIn0gUG9vbGVkUnVubmVyRmFpbHVyZU9yaWdpbiAqL1xuLyoqIEB0eXBlZGVmIHtcInN0YXJ0aW5nXCIgfCBcInJ1bm5pbmdcIiB8IFwicmV0aXJpbmdcIn0gUG9vbGVkUnVubmVyTGlmZWN5Y2xlU3RhdGUgKi9cbi8qKiBAdHlwZWRlZiB7XCJ1bmV4cGVjdGVkXCIgfCBcImpvYi10aW1lb3V0XCIgfCBcIndvcmtlci1zaHV0ZG93bi10aW1lb3V0XCJ9IFBvb2xlZFJ1bm5lclRlcm1pbmF0aW9uUmVhc29uICovXG4vKiogQHR5cGVkZWYge1wicnVubmluZ1wiIHwgXCJyZXRpcmluZ1wiIHwgXCJzdG9wcGluZ1wifSBCYWNrZ3JvdW5kSm9ic1dvcmtlckxpZmVjeWNsZVN0YXRlICovXG4vKipcbiAqIEV4YWN0IGR1cmFibGUgaGFuZG9mZiBvd25lcnNoaXAgY2FycmllZCBieSBhbiBleGVjdXRpbmcgam9iIHdoZW4gaXQgcHJvZHVjZXNcbiAqIGZvbGxvdy11cCB3b3JrLlxuICogQHR5cGVkZWYge29iamVjdH0gQmFja2dyb3VuZEpvYlByb2R1Y2VyUHJvb2ZcbiAqIEBwcm9wZXJ0eSB7c3RyaW5nfSBqb2JJZCAtIFByb2R1Y2luZyBqb2IgaWQuXG4gKiBAcHJvcGVydHkge3N0cmluZ30gaGFuZG9mZklkIC0gUHJvZHVjaW5nIGhhbmRvZmYgbGVhc2UgaWQuXG4gKiBAcHJvcGVydHkge3N0cmluZ30gd29ya2VySWQgLSBXb3JrZXIgaWRlbnRpdHkgcGVyc2lzdGVkIHdpdGggdGhlIGhhbmRvZmYuXG4gKiBAcHJvcGVydHkge251bWJlcn0gaGFuZGVkT2ZmQXRNcyAtIER1cmFibGUgaGFuZG9mZiB0aW1lc3RhbXAuXG4gKi9cbi8qKlxuICogQHR5cGVkZWYge29iamVjdH0gUG9vbGVkUnVubmVyQWN0aXZlSm9iXG4gKiBAcHJvcGVydHkge3N0cmluZyB8IG51bGx9IGhhbmRvZmZJZCAtIER1cmFibGUgaGFuZG9mZiBsZWFzZSBpZC5cbiAqIEBwcm9wZXJ0eSB7bnVtYmVyIHwgbnVsbH0gaGFuZGVkT2ZmQXRNcyAtIER1cmFibGUgaGFuZG9mZiB0aW1lc3RhbXAuXG4gKiBAcHJvcGVydHkge3N0cmluZ30gam9iSWQgLSBEdXJhYmxlIGJhY2tncm91bmQgam9iIGlkLlxuICogQHByb3BlcnR5IHtzdHJpbmd9IGpvYk5hbWUgLSBSZWdpc3RlcmVkIGpvYiBjbGFzcyBuYW1lLlxuICogQHByb3BlcnR5IHtzdHJpbmd9IHdvcmtlcklkIC0gV29ya2VyIGlkZW50aXR5IHBlcnNpc3RlZCB3aXRoIHRoZSBoYW5kb2ZmLlxuICovXG4vKipcbiAqIE9uZSBwcm9jZXNzLWZhaWx1cmUgc25hcHNob3Qgc2hhcmVkIGJ5IGV2ZXJ5IGpvYiBsb3N0IHdpdGggYSBwb29sZWQgY2hpbGQuXG4gKiBAdHlwZWRlZiB7b2JqZWN0fSBQb29sZWRSdW5uZXJGYWlsdXJlXG4gKiBAcHJvcGVydHkge1Bvb2xlZFJ1bm5lckFjdGl2ZUpvYltdfSBhY3RpdmVKb2JzIC0gSm9icyB0aGF0IHdlcmUgaW4gZmxpZ2h0IHdoZW4gdGhlIGNoaWxkIGZhaWxlZCwgb3JkZXJlZCBieSBqb2IgaWQuXG4gKiBAcHJvcGVydHkge251bWJlciB8IG51bGx9IGV4aXRDb2RlIC0gQ2hpbGQgZXhpdCBjb2RlLCBvciBudWxsIGZvciBzaWduYWwvcHJvY2VzcyBlcnJvcnMuXG4gKiBAcHJvcGVydHkge3N0cmluZyB8IG51bGx9IGdlbmVyYXRpb25JZCAtIFJlbGVhc2UgZ2VuZXJhdGlvbiBpZGVudGl0eSwgb3IgbnVsbCBpbiBsZWdhY3kgbW9kZS5cbiAqIEBwcm9wZXJ0eSB7Ym9vbGVhbiB8IG51bGx9IG9vbUtpbGxlZCAtIEZhbHNlIHdoZW4gdGhlIG9ic2VydmVkIGV4aXQgcnVsZXMgT09NIG91dDsgbnVsbCB3aGVuIGFuIHVuZXhwZWN0ZWQgU0lHS0lMTCBjYW5ub3QgYmUgZGlzdGluZ3Vpc2hlZCBmcm9tIGFuIE9PTSBraWxsIHdpdGhvdXQgc3VwZXJ2aXNvci9rZXJuZWwgZXZpZGVuY2UuXG4gKiBAcHJvcGVydHkge1Bvb2xlZFJ1bm5lckZhaWx1cmVPcmlnaW59IG9yaWdpbiAtIFdvcmtlciBvYnNlcnZhdGlvbiB0aGF0IGluaXRpYXRlZCBmYWlsdXJlIGhhbmRsaW5nLlxuICogQHByb3BlcnR5IHtudW1iZXJ9IHJ1bm5lckFnZU1zIC0gQ2hpbGQgYWdlIHdoZW4gZmFpbHVyZSBoYW5kbGluZyBzdGFydGVkLlxuICogQHByb3BlcnR5IHtudW1iZXJ9IHJ1bm5lckNyZWF0ZWRBdE1zIC0gQ2hpbGQgY3JlYXRpb24gdGltZXN0YW1wLlxuICogQHByb3BlcnR5IHtib29sZWFufSBydW5uZXJEZXRhY2hlZCAtIFdoZXRoZXIgdGhlIHJ1bm5lciBvd25lZCBhIGRldGFjaGVkIHByb2Nlc3MgZ3JvdXAuXG4gKiBAcHJvcGVydHkge251bWJlcn0gcnVubmVySm9ic1J1biAtIFByZXZpb3VzbHkgYWNrbm93bGVkZ2VkIGpvYnMgaGFuZGxlZCBieSB0aGUgY2hpbGQuXG4gKiBAcHJvcGVydHkge1Bvb2xlZFJ1bm5lckxpZmVjeWNsZVN0YXRlfSBydW5uZXJMaWZlY3ljbGUgLSBDaGlsZCBsaWZlY3ljbGUgaW1tZWRpYXRlbHkgYmVmb3JlIHJlY292ZXJ5LlxuICogQHByb3BlcnR5IHtudW1iZXIgfCBudWxsfSBydW5uZXJQaWQgLSBDaGlsZCBwcm9jZXNzIGlkIHdoZW4gYXZhaWxhYmxlLlxuICogQHByb3BlcnR5IHtpbXBvcnQoXCJub2RlOmNoaWxkX3Byb2Nlc3NcIikuQ2hpbGRQcm9jZXNzW1wic2lnbmFsQ29kZVwiXX0gc2lnbmFsIC0gQ2hpbGQgdGVybWluYXRpb24gc2lnbmFsIHdoZW4gYXZhaWxhYmxlLlxuICogQHByb3BlcnR5IHtQb29sZWRSdW5uZXJUZXJtaW5hdGlvblJlYXNvbn0gdGVybWluYXRpb25SZWFzb24gLSBXaHkgdGhlIHdvcmtlciBleHBlY3RlZCBvciBkaWQgbm90IGV4cGVjdCB0ZXJtaW5hdGlvbi5cbiAqIEBwcm9wZXJ0eSB7c3RyaW5nIHwgbnVsbH0gdGltZW91dEpvYklkIC0gSm9iIHdob3NlIHRpbWVvdXQgaW5pdGlhdGVkIGNoaWxkIHRlcm1pbmF0aW9uLCBvciBudWxsLlxuICogQHByb3BlcnR5IHtzdHJpbmd9IHdvcmtlcklkIC0gU3RhYmxlIGdlbmVyYXRpb24tcXVhbGlmaWVkIHdvcmtlciBpZC5cbiAqIEBwcm9wZXJ0eSB7QmFja2dyb3VuZEpvYnNXb3JrZXJMaWZlY3ljbGVTdGF0ZX0gd29ya2VyTGlmZWN5Y2xlIC0gUGFyZW50IHdvcmtlciBsaWZlY3ljbGUgaW1tZWRpYXRlbHkgYmVmb3JlIHJlY292ZXJ5LlxuICogQHByb3BlcnR5IHtudW1iZXJ9IHdvcmtlclBpZCAtIFBhcmVudCB3b3JrZXIgcHJvY2VzcyBpZC5cbiAqL1xuLyoqXG4gKiBAdHlwZWRlZiB7b2JqZWN0fSBMb2NhbEJhY2tncm91bmRKb2JzQ2xvY2tcbiAqIEBwcm9wZXJ0eSB7KCkgPT4gbnVtYmVyfSBub3cgLSBDdXJyZW50IGVwb2NoIG1pbGxpc2Vjb25kcy5cbiAqIEBwcm9wZXJ0eSB7KGNhbGxiYWNrOiAoKSA9PiB2b2lkLCBkZWxheU1zOiBudW1iZXIpID0+IFJldHVyblR5cGU8dHlwZW9mIHNldFRpbWVvdXQ+IHwgbnVtYmVyfSBzZXRUaW1lb3V0IC0gQXJtcyBhIHRpbWVyLlxuICogQHByb3BlcnR5IHsodGltZXJJZDogUmV0dXJuVHlwZTx0eXBlb2Ygc2V0VGltZW91dD4gfCBudW1iZXIpID0+IHZvaWR9IGNsZWFyVGltZW91dCAtIENsZWFycyBhIHRpbWVyLlxuICovXG4vKipcbiAqIEB0eXBlZGVmIHtvYmplY3R9IFJlc29sdmVkQmFja2dyb3VuZEpvYkNvbmN1cnJlbmN5XG4gKiBAcHJvcGVydHkge3N0cmluZ30gY29uY3VycmVuY3lLZXkgLSBEdXJhYmxlIGNhcCBpZGVudGl0eS5cbiAqIEBwcm9wZXJ0eSB7bnVtYmVyfSBtYXhDb25jdXJyZW5jeSAtIFBvc2l0aXZlIGNhcC5cbiAqIEBwcm9wZXJ0eSB7Ym9vbGVhbn0gcXVldWVEZXJpdmVkIC0gV2hldGhlciBxdWV1ZSBjb25maWd1cmF0aW9uIG93bnMgdGhlIGNhcC5cbiAqL1xuLyoqXG4gKiBAdHlwZWRlZiB7b2JqZWN0fSBCYWNrZ3JvdW5kSm9iQ29uY3VycmVuY3lSZXBhaXJcbiAqIEBwcm9wZXJ0eSB7bnVtYmVyfSBhY3RpdmVDb3VudCAtIEV4YWN0IGhhbmRlZC1vZmYgam9iIGNvdW50IHBlcnNpc3RlZCBieSB0aGUgcmVwYWlyLlxuICogQHByb3BlcnR5IHtzdHJpbmd9IGNvbmN1cnJlbmN5S2V5IC0gRHVyYWJsZSBjYXAgaWRlbnRpdHkuXG4gKiBAcHJvcGVydHkge251bWJlcn0gcHJldmlvdXNBY3RpdmVDb3VudCAtIFBlcnNpc3RlZCBjb3VudCByZXBsYWNlZCBieSB0aGUgcmVwYWlyLlxuICovXG4vKipcbiAqIEB0eXBlZGVmIHtvYmplY3R9IEJhY2tncm91bmRKb2JDb25jdXJyZW5jeVJlY29uY2lsaWF0aW9uXG4gKiBAcHJvcGVydHkge251bWJlcn0gY2FuZGlkYXRlQ291bnQgLSBTbmFwc2hvdCBtaXNtYXRjaGVzIHJlY2hlY2tlZCB1bmRlciB0aGVpciBjb3VudGVyIGxvY2tzLlxuICogQHByb3BlcnR5IHtudW1iZXJ9IGNoZWNrZWRDb3VudCAtIEFjdGl2ZSBvciBub256ZXJvIGR1cmFibGUgY291bnRlcnMgY29tcGFyZWQgaW4gdGhlIGluaXRpYWwgc25hcHNob3QuXG4gKiBAcHJvcGVydHkge251bWJlcn0gcmVwYWlyZWRDb3VudCAtIENvdW50ZXJzIHdob3NlIHBlcnNpc3RlZCB2YWx1ZXMgd2VyZSBjaGFuZ2VkLlxuICogQHByb3BlcnR5IHtCYWNrZ3JvdW5kSm9iQ29uY3VycmVuY3lSZXBhaXJbXX0gcmVwYWlycyAtIEJvdW5kZWQgZGV0ZXJtaW5pc3RpYyBzYW1wbGUgb2YgYXBwbGllZCByZXBhaXJzLlxuICogQHByb3BlcnR5IHtudW1iZXJ9IHJlcGFpcnNUcnVuY2F0ZWRDb3VudCAtIEFwcGxpZWQgcmVwYWlycyBvbWl0dGVkIGZyb20gdGhlIHNhbXBsZS5cbiAqL1xuLyoqXG4gKiBAdHlwZWRlZiB7b2JqZWN0fSBQcmVwYXJlZExvY2FsQmFja2dyb3VuZEpvYlxuICogQHByb3BlcnR5IHtzdHJpbmd9IGFyZ3NEaWdlc3QgLSBGaXhlZC13aWR0aCBkaWdlc3Qgb2YgdGhlIHNlcmlhbGl6ZWQgYXJndW1lbnRzLlxuICogQHByb3BlcnR5IHtzdHJpbmd9IGFyZ3NKc29uIC0gU2VyaWFsaXplZCBhcmd1bWVudHMuXG4gKiBAcHJvcGVydHkge1Jlc29sdmVkQmFja2dyb3VuZEpvYkNvbmN1cnJlbmN5IHwgbnVsbH0gY29uY3VycmVuY3kgLSBSZXNvbHZlZCBjb25jdXJyZW5jeS5cbiAqIEBwcm9wZXJ0eSB7bnVtYmVyfSBjcmVhdGVkQXRNcyAtIENyZWF0aW9uIHRpbWVzdGFtcC5cbiAqIEBwcm9wZXJ0eSB7XCJpbmxpbmVcIn0gZXhlY3V0aW9uTW9kZSAtIExvY2FsIGluLXByb2Nlc3MgZXhlY3V0aW9uIG1vZGUuXG4gKiBAcHJvcGVydHkge3N0cmluZ30gam9iSWQgLSBEdXJhYmxlIGlkLlxuICogQHByb3BlcnR5IHtzdHJpbmd9IGpvYk5hbWUgLSBSZWdpc3RlcmVkIG5hbWUuXG4gKiBAcHJvcGVydHkge251bWJlcn0gbWF4UmV0cmllcyAtIFJldHJ5IGNhcC5cbiAqIEBwcm9wZXJ0eSB7c3RyaW5nfSBxdWV1ZSAtIFF1ZXVlIG5hbWUuXG4gKiBAcHJvcGVydHkge251bWJlcn0gc2NoZWR1bGVkQXRNcyAtIEVsaWdpYmlsaXR5IHRpbWVzdGFtcC5cbiAqL1xuLyoqXG4gKiBAdHlwZWRlZiB7b2JqZWN0fSBCYWNrZ3JvdW5kSm9ic0hlYWx0aFxuICogQHByb3BlcnR5IHtib29sZWFufSByZWFkeSAtIFdoZXRoZXIgdGhlIGFkYXB0ZXIgY2FuIGFjY2VwdCBhbmQgcHJvY2VzcyB3b3JrLlxuICovXG4vKipcbiAqIEB0eXBlZGVmIHtvYmplY3R9IEJhY2tncm91bmRKb2JzUHJvZHVjZXJcbiAqIEBwcm9wZXJ0eSB7KGFyZ3M6IHtqb2JOYW1lOiBzdHJpbmcsIGFyZ3M6IEFycmF5PFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Piwgb3B0aW9ucz86IEJhY2tncm91bmRKb2JPcHRpb25zLCBwcm9kdWNlckludm9jYXRpb25JZD86IHN0cmluZywgcHJvZHVjZXJQcm9vZj86IEJhY2tncm91bmRKb2JQcm9kdWNlclByb29mfSkgPT4gUHJvbWlzZTxzdHJpbmc+fSBlbnF1ZXVlIC0gRW5xdWV1ZXMgYSBqb2IuXG4gKiBAcHJvcGVydHkgeyhhcmdzOiB7c2NoZWR1bGVLZXk6IHN0cmluZywgam9iTmFtZTogc3RyaW5nLCBhcmdzOiBBcnJheTxSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj4sIG9wdGlvbnM/OiBCYWNrZ3JvdW5kSm9iT3B0aW9uc30pID0+IFByb21pc2U8QmFja2dyb3VuZEpvYlJlcGxhY2VtZW50UmVzdWx0Pn0gcmVwbGFjZVNjaGVkdWxlZCAtIFJlcGxhY2VzIGEgc3RhYmxlIHNjaGVkdWxlLlxuICogQHByb3BlcnR5IHsoYXJnczoge3NjaGVkdWxlS2V5OiBzdHJpbmd9KSA9PiBQcm9taXNlPEJhY2tncm91bmRKb2JDYW5jZWxsYXRpb25SZXN1bHQ+fSBjYW5jZWxTY2hlZHVsZWQgLSBDYW5jZWxzIGEgc3RhYmxlIHNjaGVkdWxlLlxuICovXG4vKipcbiAqIEB0eXBlZGVmIHtvYmplY3R9IEJhY2tncm91bmRKb2JIYW5kb2ZmXG4gKiBAcHJvcGVydHkge3N0cmluZ30gaGFuZG9mZklkIC0gVW5pcXVlIGhhbmRvZmYgbGVhc2UgaWQuXG4gKiBAcHJvcGVydHkge251bWJlcn0gaGFuZGVkT2ZmQXRNcyAtIFRpbWUgaGFuZGVkIHRvIGEgd29ya2VyIGluIG1zLlxuICogQHByb3BlcnR5IHtCYWNrZ3JvdW5kSm9iUm93fSBbam9iXSAtIEV4YWN0IGNvbW1pdHRlZCBqb2Igc25hcHNob3Qgd2hlbiB0aGUgYWRhcHRlciBjaGFuZ2VzIGRpc3BhdGNoIGRhdGEgZHVyaW5nIHRoZSBjbGFpbS5cbiAqL1xuLyoqXG4gKiBAdHlwZWRlZiB7b2JqZWN0fSBCYWNrZ3JvdW5kSm9iSGFuZG9mZlNuYXBzaG90XG4gKiBAcHJvcGVydHkge3N0cmluZ30gam9iSWQgLSBKb2IgaG9sZGluZyB0aGUgbGVhc2UuXG4gKiBAcHJvcGVydHkge3N0cmluZ30gaGFuZG9mZklkIC0gRXhhY3QgZHVyYWJsZSBsZWFzZSBpZC5cbiAqIEBwcm9wZXJ0eSB7c3RyaW5nfSB3b3JrZXJJZCAtIFN0YWJsZSB3b3JrZXIgaWQgdGhhdCByZWNlaXZlZCB0aGUgbGVhc2UuXG4gKiBAcHJvcGVydHkge251bWJlcn0gaGFuZGVkT2ZmQXRNcyAtIFRpbWUgaGFuZGVkIHRvIHRoZSB3b3JrZXIgaW4gbXMuXG4gKi9cbi8qKlxuICogQHR5cGVkZWYge29iamVjdH0gQmFja2dyb3VuZEpvYkhhbmRvZmZSZXF1ZXN0XG4gKiBAcHJvcGVydHkge3N0cmluZ30gam9iSWQgLSBKb2IgdG8gY2xhaW0uXG4gKiBAcHJvcGVydHkge3N0cmluZ30gW2hhbmRvZmZJZF0gLSBFeGFjdCBjYWxsZXItc2VsZWN0ZWQgbGVhc2UgaWQuIEFkYXB0ZXJzIG11c3QgcGVyc2lzdCBhbmQgcmV0dXJuIHRoaXMgaWQgd2hlbiBzdXBwbGllZDsgYnVpbHQtaW4gYWRhcHRlcnMgZ2VuZXJhdGUgb25lIHdoZW4gb21pdHRlZCBmb3IgbGVnYWN5IGRpcmVjdCBjYWxsZXJzLlxuICogQHByb3BlcnR5IHtzdHJpbmd9IFt3b3JrZXJJZF0gLSBXb3JrZXIgY2xhaW1pbmcgdGhlIGpvYi5cbiAqL1xuLyoqXG4gKiBAdHlwZWRlZiB7b2JqZWN0fSBCYWNrZ3JvdW5kSm9iT3B0aW9uc1xuICogQHByb3BlcnR5IHtCYWNrZ3JvdW5kSm9iRXhlY3V0aW9uTW9kZX0gW2V4ZWN1dGlvbk1vZGVdIC0gSG93IHRoZSBqb2Igc2hvdWxkIHJ1bi4gTm9kZSBkZWZhdWx0cyB0byBgXCJwb29sZWRcImAgKGEgd2FybSwgcmV1c2VkIGxvY2FsIHJ1bm5lciBwcm9jZXNzKS4gQnJvd3Nlci9FeHBvIGxvY2FsIGRpc3BhdGNoIGRlZmF1bHRzIHRvIGFuZCBvbmx5IGFjY2VwdHMgYFwiaW5saW5lXCJgLiBgXCJmb3JrZWRcImAgcnVucyBhIE5vZGUgam9iIGluIGEgZnJlc2ggYGNoaWxkX3Byb2Nlc3MuZm9yaygpYCBjaGlsZCwgYW5kIGBcInNwYXduZWRcImAgaW4gYSBkZXRhY2hlZCBDTEkgcnVubmVyLlxuICogQHByb3BlcnR5IHtudW1iZXJ9IFttYXhSZXRyaWVzXSAtIE1heCByZXRyaWVzIGZvciBhIGZhaWxlZCBqb2IgYmVmb3JlIGl0IGlzIG1hcmtlZCBmYWlsZWQuXG4gKiBAcHJvcGVydHkge3N0cmluZ30gW3F1ZXVlXSAtIFF1ZXVlIG5hbWUuIERlZmF1bHRzIHRvIGBcImRlZmF1bHRcImAuIFdoZW4gdGhlIHF1ZXVlIGhhcyBhIGNvbmZpZ3VyZWQgY2FwIGluIGBiYWNrZ3JvdW5kSm9icy5xdWV1ZXNgLCB0aGF0IGNhcCBpcyBlbmZvcmNlZCBjbHVzdGVyLXdpZGUuXG4gKiBAcHJvcGVydHkge3N0cmluZ30gW2NvbmN1cnJlbmN5S2V5XSAtIE9wYXF1ZSBub24tZW1wdHkga2V5IHVzZWQgdG8gc2hhcmUgYSBjb25jdXJyZW5jeSBjYXAuIE92ZXJyaWRlcyBhbnkgcXVldWUtZGVyaXZlZCBjYXAuXG4gKiBAcHJvcGVydHkge251bWJlcn0gW21heENvbmN1cnJlbmN5XSAtIFBvc2l0aXZlIGludGVnZXIgY2FwOyBtdXN0IGJlIHBhaXJlZCB3aXRoIGBjb25jdXJyZW5jeUtleWAuXG4gKiBAcHJvcGVydHkge2Jvb2xlYW59IFtkZWR1cGxpY2F0ZVdoaWxlUXVldWVkXSAtIFdoZW4gdHJ1ZSwgc2tpcCB0aGUgZW5xdWV1ZSBpZiBhbiBpZGVudGljYWwgc3RpbGwtcXVldWVkIGpvYiAoc2FtZSBqb2IgbmFtZSwgYXJncyBhbmQgcXVldWUpIGlzIHNjaGVkdWxlZCBubyBsYXRlciB0aGFuIHRoaXMgZW5xdWV1ZSwgcmV0dXJuaW5nIHRoZSBlYXJsaWVzdCBtYXRjaGluZyBqb2IncyBpZC4gQSBmdXR1cmUgcmV0cnkgZG9lcyBub3Qgc3VwcHJlc3MgZWFybGllciB3b3JrLiBEZWR1cGxpY2F0aW9uIGlzIGluZGVwZW5kZW50IG9mIGBjb25jdXJyZW5jeUtleWAsIHNvIHRoZSBqb2Iga2VlcHMgaXRzIG5vcm1hbCAoZS5nLiBxdWV1ZS1kZXJpdmVkKSBjb25jdXJyZW5jeSBjYXAuIEtlZXBzIGFuIGludGVydmFsLXNjaGVkdWxlZCByZWN1cnJpbmcgam9iIChlLmcuIHJldGVudGlvbiBwcnVuaW5nKSBmcm9tIHBpbGluZyB1cCByZWR1bmRhbnQgcXVldWVkIHJvd3Mgd2hlbiBpdCBydW5zIHNsb3dlciB0aGFuIGl0cyBpbnRlcnZhbCBvciBubyB3b3JrZXIgaXMgZnJlZS5cbiAqIEBwcm9wZXJ0eSB7c3RyaW5nfSBbaWRlbXBvdGVuY3lLZXldIC0gRHVyYWJsZSBlbnF1ZXVlIGlkZW50aXR5IHNjb3BlZCB0byB0aGUgcmVzb2x2ZWQgam9iIGNsYXNzIG5hbWUgYW5kIHF1ZXVlLiBFeGFjdCByZXBsYXkgcmV0dXJucyB0aGUgb3JpZ2luYWwgam9iIGlkIGFjcm9zcyBldmVyeSBzdGF0ZSBhbmQgYWZ0ZXIgam9iIHBydW5pbmc7IHJldXNlIHdpdGggZGlmZmVyZW50IGNhbm9uaWNhbCBhcmd1bWVudHMgb3IgYmVoYXZpb3ItYWZmZWN0aW5nIG9wdGlvbnMgZmFpbHMuIE93bmVyc2hpcCBpcyBpbmRlcGVuZGVudCBvZiBgZGVkdXBsaWNhdGVXaGlsZVF1ZXVlZGAgYW5kIGlzIHJldGFpbmVkIHVudGlsIGFuIGV4cGxpY2l0IGZ1dHVyZSByZXRlbnRpb24gcG9saWN5IHJlbW92ZXMgaXQuXG4gKiBAcHJvcGVydHkge251bWJlcn0gW3NjaGVkdWxlZEF0TXNdIC0gRXBvY2ggdGltZXN0YW1wIGluIG1pbGxpc2Vjb25kcyB3aGVuIHRoZSBqb2IgYmVjb21lcyBlbGlnaWJsZSBmb3IgZGlzcGF0Y2guIERlZmF1bHRzIHRvIGVucXVldWUgdGltZS5cbiAqIEBwcm9wZXJ0eSB7bnVtYmVyfSBbdGltZW91dE1zXSAtIFBlci1qb2Igd2FsbC1jbG9jayB0aW1lb3V0IGZvciBmb3JrZWQgYW5kIHBvb2xlZCBleGVjdXRpb24uIEEgcG9zaXRpdmUgaW50ZWdlciB1cCB0byAyLDE0Nyw0ODMsNjQ3IG92ZXJyaWRlcyB0aGUgd29ya2VyLWxldmVsIGBqb2JUaW1lb3V0TXNgOyBhIG5vbi1wb3NpdGl2ZSBmaW5pdGUgdmFsdWUgZGlzYWJsZXMgdGhlIHRpbWVvdXQgZm9yIHRoaXMgam9iLlxuICovXG4vKipcbiAqIEB0eXBlZGVmIHtvYmplY3R9IEJhY2tncm91bmRKb2JQYXlsb2FkXG4gKiBAcHJvcGVydHkge3N0cmluZ30gW2lkXSAtIEpvYiBpZC5cbiAqIEBwcm9wZXJ0eSB7c3RyaW5nfSBqb2JOYW1lIC0gSm9iIGNsYXNzIG5hbWUuXG4gKiBAcHJvcGVydHkge0FycmF5PFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gW2FyZ3NdIC0gU2VyaWFsaXplZCBqb2IgYXJndW1lbnRzLlxuICogQHByb3BlcnR5IHtzdHJpbmd9IFtoYW5kb2ZmSWRdIC0gVW5pcXVlIGhhbmRvZmYgbGVhc2UgaWQuXG4gKiBAcHJvcGVydHkge3N0cmluZ30gW3dvcmtlcklkXSAtIFdvcmtlciBpZCBoYW5kbGluZyB0aGUgam9iLlxuICogQHByb3BlcnR5IHtudW1iZXJ9IFtoYW5kZWRPZmZBdE1zXSAtIFRpbWUgaGFuZGVkIHRvIGEgd29ya2VyIGluIG1zLlxuICogQHByb3BlcnR5IHtCYWNrZ3JvdW5kSm9iT3B0aW9uc30gW29wdGlvbnNdIC0gUnVudGltZSBvcHRpb25zLlxuICovXG4vKipcbiAqIEB0eXBlZGVmIHtvYmplY3R9IEJhY2tncm91bmRKb2JDb250ZXh0XG4gKiBAcHJvcGVydHkge3R5cGVvZiBpbXBvcnQoXCIuL3BsYXRmb3JtLWpvYi5qc1wiKS5kZWZhdWx0fSBqb2JDbGFzcyAtIENvbmNyZXRlIGpvYiBjbGFzcy5cbiAqIEBwcm9wZXJ0eSB7c3RyaW5nfSBqb2JOYW1lIC0gUmVnaXN0ZXJlZCBqb2IgbmFtZS5cbiAqIEBwcm9wZXJ0eSB7QXJyYXk8UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSBhcmdzIC0gU2VyaWFsaXplZCBqb2IgYXJndW1lbnRzLlxuICogQHByb3BlcnR5IHtCYWNrZ3JvdW5kSm9iT3B0aW9uc30gb3B0aW9ucyAtIFJlc29sdmVkIGVucXVldWUvcnVudGltZSBvcHRpb25zLlxuICogQHByb3BlcnR5IHtCYWNrZ3JvdW5kSm9iUGF5bG9hZH0gW3BheWxvYWRdIC0gQ29tcGxldGUgcGVyc2lzdGVkIHJ1bm5lciBwYXlsb2FkIHdoZW4gdGhlIGpvYiBpcyBwZXJmb3JtaW5nLlxuICovXG4vKipcbiAqIEB0eXBlZGVmIHtvYmplY3R9IEJhY2tncm91bmRKb2JSb3dcbiAqIEBwcm9wZXJ0eSB7c3RyaW5nfSBpZCAtIEpvYiBpZC5cbiAqIEBwcm9wZXJ0eSB7c3RyaW5nfSBqb2JOYW1lIC0gSm9iIGNsYXNzIG5hbWUuXG4gKiBAcHJvcGVydHkge0FycmF5PFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gYXJncyAtIFNlcmlhbGl6ZWQgam9iIGFyZ3VtZW50cy5cbiAqIEBwcm9wZXJ0eSB7QmFja2dyb3VuZEpvYkV4ZWN1dGlvbk1vZGV9IGV4ZWN1dGlvbk1vZGUgLSBIb3cgdGhlIGpvYiBzaG91bGQgcnVuLlxuICogQHByb3BlcnR5IHtzdHJpbmd9IHF1ZXVlIC0gUXVldWUgbmFtZSAoZGVmYXVsdHMgdG8gYFwiZGVmYXVsdFwiYCkuXG4gKiBAcHJvcGVydHkge3N0cmluZyB8IG51bGx9IHNjaGVkdWxlS2V5IC0gU3RhYmxlIGxvZ2ljYWwgc2NoZWR1bGUga2V5IHJldGFpbmVkIGZvciBoaXN0b3J5LlxuICogQHByb3BlcnR5IHtzdHJpbmd9IHN0YXR1cyAtIEN1cnJlbnQgam9iIHN0YXR1cy5cbiAqIEBwcm9wZXJ0eSB7bnVtYmVyIHwgbnVsbH0gYXR0ZW1wdHMgLSBGYWlsdXJlIGF0dGVtcHRzIGNvdW50LlxuICogQHByb3BlcnR5IHtudW1iZXIgfCBudWxsfSBtYXhSZXRyaWVzIC0gTWF4IHJldHJ5IGF0dGVtcHRzLlxuICogQHByb3BlcnR5IHtudW1iZXIgfCBudWxsfSBzY2hlZHVsZWRBdE1zIC0gTmV4dCBzY2hlZHVsZWQgdGltZSBpbiBtcy5cbiAqIEBwcm9wZXJ0eSB7bnVtYmVyIHwgbnVsbH0gY3JlYXRlZEF0TXMgLSBDcmVhdGlvbiB0aW1lIGluIG1zLlxuICogQHByb3BlcnR5IHtudW1iZXIgfCBudWxsfSBoYW5kZWRPZmZBdE1zIC0gVGltZSBoYW5kZWQgdG8gd29ya2VyIGluIG1zLlxuICogQHByb3BlcnR5IHtzdHJpbmcgfCBudWxsfSBoYW5kb2ZmSWQgLSBVbmlxdWUgbGF0ZXN0IGhhbmRvZmYgbGVhc2UgaWQuXG4gKiBAcHJvcGVydHkge251bWJlciB8IG51bGx9IGNvbXBsZXRlZEF0TXMgLSBDb21wbGV0aW9uIHRpbWUgaW4gbXMuXG4gKiBAcHJvcGVydHkge251bWJlciB8IG51bGx9IGZhaWxlZEF0TXMgLSBGYWlsdXJlIHRpbWUgaW4gbXMuXG4gKiBAcHJvcGVydHkge251bWJlciB8IG51bGx9IG9ycGhhbmVkQXRNcyAtIE9ycGhhbmVkIHRpbWUgaW4gbXMuXG4gKiBAcHJvcGVydHkge3N0cmluZyB8IG51bGx9IHdvcmtlcklkIC0gV29ya2VyIGlkIGhhbmRsaW5nIHRoZSBqb2IuXG4gKiBAcHJvcGVydHkge3N0cmluZyB8IG51bGx9IGxhc3RFcnJvciAtIExhc3QgZmFpbHVyZSBtZXNzYWdlLlxuICogQHByb3BlcnR5IHtzdHJpbmcgfCBudWxsfSBjb25jdXJyZW5jeUtleSAtIER1cmFibGUgY29uY3VycmVuY3kga2V5LlxuICogQHByb3BlcnR5IHtudW1iZXIgfCBudWxsfSBtYXhDb25jdXJyZW5jeSAtIER1cmFibGUgcGVyLWtleSBjYXAuXG4gKiBAcHJvcGVydHkge251bWJlciB8IG51bGx9IHRpbWVvdXRNcyAtIFBlci1qb2Igd2FsbC1jbG9jayB0aW1lb3V0IG92ZXJyaWRlLCBvciBudWxsIHdoZW4gb21pdHRlZC5cbiAqL1xuLyoqXG4gKiBAdHlwZWRlZiB7XCJxdWV1ZWRcIiB8IFwiaGFuZGVkX29mZlwiIHwgbnVsbH0gQmFja2dyb3VuZEpvYlJlcGxhY2VtZW50UHJldmlvdXNTdGF0dXNcbiAqL1xuLyoqXG4gKiBAdHlwZWRlZiB7b2JqZWN0fSBCYWNrZ3JvdW5kSm9iUmVwbGFjZW1lbnRSZXN1bHRcbiAqIEBwcm9wZXJ0eSB7c3RyaW5nfSBqb2JJZCAtIE5ld2x5IHF1ZXVlZCBqb2IgaWQuXG4gKiBAcHJvcGVydHkge3N0cmluZyB8IG51bGx9IHByZXZpb3VzSm9iSWQgLSBQcmV2aW91cyBhY3RpdmUgb3duZXIncyBqb2IgaWQuXG4gKiBAcHJvcGVydHkge0JhY2tncm91bmRKb2JSZXBsYWNlbWVudFByZXZpb3VzU3RhdHVzfSBwcmV2aW91c1N0YXR1cyAtIFByZXZpb3VzIG93bmVyJ3Mgb2JzZXJ2ZWQgc3RhdGUuXG4gKi9cbi8qKlxuICogQHR5cGVkZWYge1wiY2FuY2VsbGVkXCIgfCBcImhhbmRlZF9vZmZcIiB8IFwibm90X2ZvdW5kXCJ9IEJhY2tncm91bmRKb2JDYW5jZWxsYXRpb25PdXRjb21lXG4gKi9cbi8qKlxuICogQHR5cGVkZWYge29iamVjdH0gQmFja2dyb3VuZEpvYkNhbmNlbGxhdGlvblJlc3VsdFxuICogQHByb3BlcnR5IHtzdHJpbmcgfCBudWxsfSBqb2JJZCAtIERldGFjaGVkIG93bmVyJ3Mgam9iIGlkLCB3aGVuIG9uZSB3YXMgYWN0aXZlLlxuICogQHByb3BlcnR5IHtCYWNrZ3JvdW5kSm9iQ2FuY2VsbGF0aW9uT3V0Y29tZX0gb3V0Y29tZSAtIFRydXRoZnVsIGJlc3QtZWZmb3J0IG91dGNvbWUuXG4gKi9cbi8qKlxuICogQHR5cGVkZWYge29iamVjdH0gQmFja2dyb3VuZEpvYkZhaWx1cmVFdmVudFxuICogQHByb3BlcnR5IHtCYWNrZ3JvdW5kSm9iUm93fSBqb2IgLSBVcGRhdGVkIGpvYiByb3cgYWZ0ZXIgZmFpbHVyZSBoYW5kbGluZy5cbiAqIEBwcm9wZXJ0eSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59IGVycm9yIC0gRmFpbHVyZSBlcnJvci5cbiAqIEBwcm9wZXJ0eSB7bnVtYmVyIHwgbnVsbH0gYXR0ZW1wdHMgLSBVcGRhdGVkIGZhaWx1cmUgYXR0ZW1wdHMgY291bnQuXG4gKiBAcHJvcGVydHkge2Jvb2xlYW59IHRlcm1pbmFsIC0gV2hldGhlciB0aGlzIGZhaWx1cmUgZW5kZWQgdGhlIGpvYi5cbiAqIEBwcm9wZXJ0eSB7Ym9vbGVhbn0gd2lsbFJldHJ5IC0gV2hldGhlciB0aGUgam9iIHdhcyByZXR1cm5lZCB0byB0aGUgcXVldWUuXG4gKiBAcHJvcGVydHkge3N0cmluZyB8IHVuZGVmaW5lZH0gaGFuZG9mZklkIC0gSGFuZG9mZiBsZWFzZSBpZCBmcm9tIHRoZSB3b3JrZXIgcmVwb3J0LlxuICogQHByb3BlcnR5IHtudW1iZXIgfCB1bmRlZmluZWR9IGhhbmRlZE9mZkF0TXMgLSBIYW5kb2ZmIHRpbWVzdGFtcCBmcm9tIHRoZSB3b3JrZXIgcmVwb3J0LlxuICogQHByb3BlcnR5IHtzdHJpbmcgfCB1bmRlZmluZWR9IHdvcmtlcklkIC0gV29ya2VyIGlkIGZyb20gdGhlIHdvcmtlciByZXBvcnQuXG4gKiBAcHJvcGVydHkge1Bvb2xlZFJ1bm5lckZhaWx1cmUgfCB1bmRlZmluZWR9IHJ1bm5lckZhaWx1cmUgLSBTaGFyZWQgcG9vbGVkLWNoaWxkIHByb2Nlc3MgZmFpbHVyZSBwcm92ZW5hbmNlLlxuICovXG4vKipcbiAqIEB0eXBlZGVmIHtcIndvcmtlclwiIHwgXCJjbGllbnRcIiB8IFwicmVwb3J0ZXJcIn0gQmFja2dyb3VuZEpvYlNvY2tldFJvbGVcbiAqL1xuLyoqXG4gKiBAdHlwZWRlZiB7e3R5cGU6IFwiaGVsbG9cIiwgcm9sZTogQmFja2dyb3VuZEpvYlNvY2tldFJvbGUsIGdlbmVyYXRpb25JZD86IHN0cmluZywgc3VwcG9ydHNIYW5kb2ZmSWRSZXBvcnRpbmc/OiBib29sZWFuLCBzdXBwb3J0c0hlYXJ0YmVhdD86IGJvb2xlYW4sIHN1cHBvcnRzUG9vbGVkPzogYm9vbGVhbiwgd29ya2VySWQ/OiBzdHJpbmd9fSBCYWNrZ3JvdW5kSm9iSGVsbG9NZXNzYWdlXG4gKiBAdHlwZWRlZiB7e3R5cGU6IFwiZ2VuZXJhdGlvbi1hY2NlcHRlZFwiLCBnZW5lcmF0aW9uSWQ6IHN0cmluZywgbGlmZWN5Y2xlU3RhdGU6IEJhY2tncm91bmRKb2JzR2VuZXJhdGlvbkxpZmVjeWNsZVN0YXRlfX0gQmFja2dyb3VuZEpvYkdlbmVyYXRpb25BY2NlcHRlZE1lc3NhZ2VcbiAqIEB0eXBlZGVmIHt7dHlwZTogXCJnZW5lcmF0aW9uLXJlamVjdGVkXCIsIHJlYXNvbjogQmFja2dyb3VuZEpvYnNHZW5lcmF0aW9uUmVqZWN0aW9uUmVhc29ufX0gQmFja2dyb3VuZEpvYkdlbmVyYXRpb25SZWplY3RlZE1lc3NhZ2VcbiAqIEB0eXBlZGVmIHt7dHlwZTogXCJyZWFkeVwiLCBhY2NlcHRzRm9ya2VkPzogYm9vbGVhbiwgYWNjZXB0c0lubGluZT86IGJvb2xlYW4sIGFjY2VwdHNQb29sZWQ/OiBib29sZWFuLCBhY2NlcHRzU3Bhd25lZD86IGJvb2xlYW4sIGF2YWlsYWJsZVBvb2xlZFNsb3RzPzogbnVtYmVyfX0gQmFja2dyb3VuZEpvYlJlYWR5TWVzc2FnZVxuICogQHR5cGVkZWYge3t0eXBlOiBcImRyYWluaW5nXCJ9fSBCYWNrZ3JvdW5kSm9iRHJhaW5pbmdNZXNzYWdlXG4gKiBAdHlwZWRlZiB7e3R5cGU6IFwiaGVhcnRiZWF0XCIsIHdvcmtlcklkPzogc3RyaW5nfX0gQmFja2dyb3VuZEpvYkhlYXJ0YmVhdE1lc3NhZ2VcbiAqIEB0eXBlZGVmIHt7dHlwZTogXCJlbnF1ZXVlXCIsIGpvYk5hbWU6IHN0cmluZywgYXJncz86IEFycmF5PFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Piwgb3B0aW9ucz86IEJhY2tncm91bmRKb2JPcHRpb25zLCBwcm9kdWNlckludm9jYXRpb25JZD86IHN0cmluZywgcHJvZHVjZXJQcm9vZj86IEJhY2tncm91bmRKb2JQcm9kdWNlclByb29mfX0gQmFja2dyb3VuZEpvYkVucXVldWVNZXNzYWdlXG4gKiBAdHlwZWRlZiB7e3R5cGU6IFwiZW5xdWV1ZWRcIiwgam9iSWQ6IHN0cmluZ319IEJhY2tncm91bmRKb2JFbnF1ZXVlZE1lc3NhZ2VcbiAqIEB0eXBlZGVmIHt7dHlwZTogXCJlbnF1ZXVlLWVycm9yXCIsIGVycm9yPzogc3RyaW5nfX0gQmFja2dyb3VuZEpvYkVucXVldWVFcnJvck1lc3NhZ2VcbiAqIEB0eXBlZGVmIHt7dHlwZTogXCJyZXBsYWNlLXNjaGVkdWxlZFwiLCBzY2hlZHVsZUtleTogc3RyaW5nLCBqb2JOYW1lOiBzdHJpbmcsIGFyZ3M/OiBBcnJheTxSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj4sIG9wdGlvbnM/OiBCYWNrZ3JvdW5kSm9iT3B0aW9uc319IEJhY2tncm91bmRKb2JSZXBsYWNlU2NoZWR1bGVkTWVzc2FnZVxuICogQHR5cGVkZWYge3t0eXBlOiBcInNjaGVkdWxlLXJlcGxhY2VkXCIsIGpvYklkOiBzdHJpbmcsIHByZXZpb3VzSm9iSWQ6IHN0cmluZyB8IG51bGwsIHByZXZpb3VzU3RhdHVzOiBCYWNrZ3JvdW5kSm9iUmVwbGFjZW1lbnRQcmV2aW91c1N0YXR1c319IEJhY2tncm91bmRKb2JTY2hlZHVsZVJlcGxhY2VkTWVzc2FnZVxuICogQHR5cGVkZWYge3t0eXBlOiBcInJlcGxhY2Utc2NoZWR1bGVkLWVycm9yXCIsIGVycm9yPzogc3RyaW5nfX0gQmFja2dyb3VuZEpvYlJlcGxhY2VTY2hlZHVsZWRFcnJvck1lc3NhZ2VcbiAqIEB0eXBlZGVmIHt7dHlwZTogXCJjYW5jZWwtc2NoZWR1bGVkXCIsIHNjaGVkdWxlS2V5OiBzdHJpbmd9fSBCYWNrZ3JvdW5kSm9iQ2FuY2VsU2NoZWR1bGVkTWVzc2FnZVxuICogQHR5cGVkZWYge3t0eXBlOiBcInNjaGVkdWxlLWNhbmNlbGxlZFwiLCBqb2JJZDogc3RyaW5nIHwgbnVsbCwgb3V0Y29tZTogQmFja2dyb3VuZEpvYkNhbmNlbGxhdGlvbk91dGNvbWV9fSBCYWNrZ3JvdW5kSm9iU2NoZWR1bGVDYW5jZWxsZWRNZXNzYWdlXG4gKiBAdHlwZWRlZiB7e3R5cGU6IFwiY2FuY2VsLXNjaGVkdWxlZC1lcnJvclwiLCBlcnJvcj86IHN0cmluZ319IEJhY2tncm91bmRKb2JDYW5jZWxTY2hlZHVsZWRFcnJvck1lc3NhZ2VcbiAqIEB0eXBlZGVmIHt7dHlwZTogXCJqb2JcIiwgcGF5bG9hZDogQmFja2dyb3VuZEpvYlBheWxvYWR9fSBCYWNrZ3JvdW5kSm9iSm9iTWVzc2FnZVxuICogQHR5cGVkZWYge3t0eXBlOiBcImpvYi1jb21wbGV0ZVwiLCBqb2JJZDogc3RyaW5nLCBoYW5kb2ZmSWQ/OiBzdHJpbmcsIHdvcmtlcklkPzogc3RyaW5nLCBoYW5kZWRPZmZBdE1zPzogbnVtYmVyfX0gQmFja2dyb3VuZEpvYkNvbXBsZXRlTWVzc2FnZVxuICogQHR5cGVkZWYge3t0eXBlOiBcImpvYi1mYWlsZWRcIiwgam9iSWQ6IHN0cmluZywgZXJyb3I/OiBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPiwgaGFuZG9mZklkPzogc3RyaW5nLCB3b3JrZXJJZD86IHN0cmluZywgaGFuZGVkT2ZmQXRNcz86IG51bWJlciwgcnVubmVyRmFpbHVyZT86IFBvb2xlZFJ1bm5lckZhaWx1cmV9fSBCYWNrZ3JvdW5kSm9iRmFpbGVkTWVzc2FnZVxuICogQHR5cGVkZWYge3t0eXBlOiBcImpvYi1yZXNjaGVkdWxlXCIsIGpvYklkOiBzdHJpbmcsIGRlbGF5TXM6IG51bWJlciwgaGFuZG9mZklkPzogc3RyaW5nLCB3b3JrZXJJZD86IHN0cmluZywgaGFuZGVkT2ZmQXRNcz86IG51bWJlcn19IEJhY2tncm91bmRKb2JSZXNjaGVkdWxlTWVzc2FnZVxuICogQHR5cGVkZWYge3t0eXBlOiBcImpvYi11cGRhdGVkXCIsIGpvYklkOiBzdHJpbmd9fSBCYWNrZ3JvdW5kSm9iVXBkYXRlZE1lc3NhZ2VcbiAqIEB0eXBlZGVmIHt7dHlwZTogXCJqb2ItdXBkYXRlLWVycm9yXCIsIGpvYklkOiBzdHJpbmcsIGVycm9yPzogc3RyaW5nfX0gQmFja2dyb3VuZEpvYlVwZGF0ZUVycm9yTWVzc2FnZVxuICovXG4vKipcbiAqIEB0eXBlZGVmIHtCYWNrZ3JvdW5kSm9iSGVsbG9NZXNzYWdlIHwgQmFja2dyb3VuZEpvYkdlbmVyYXRpb25BY2NlcHRlZE1lc3NhZ2UgfCBCYWNrZ3JvdW5kSm9iR2VuZXJhdGlvblJlamVjdGVkTWVzc2FnZSB8IEJhY2tncm91bmRKb2JSZWFkeU1lc3NhZ2UgfCBCYWNrZ3JvdW5kSm9iRHJhaW5pbmdNZXNzYWdlIHwgQmFja2dyb3VuZEpvYkhlYXJ0YmVhdE1lc3NhZ2UgfCBCYWNrZ3JvdW5kSm9iRW5xdWV1ZU1lc3NhZ2UgfCBCYWNrZ3JvdW5kSm9iRW5xdWV1ZWRNZXNzYWdlIHwgQmFja2dyb3VuZEpvYkVucXVldWVFcnJvck1lc3NhZ2UgfCBCYWNrZ3JvdW5kSm9iUmVwbGFjZVNjaGVkdWxlZE1lc3NhZ2UgfCBCYWNrZ3JvdW5kSm9iU2NoZWR1bGVSZXBsYWNlZE1lc3NhZ2UgfCBCYWNrZ3JvdW5kSm9iUmVwbGFjZVNjaGVkdWxlZEVycm9yTWVzc2FnZSB8IEJhY2tncm91bmRKb2JDYW5jZWxTY2hlZHVsZWRNZXNzYWdlIHwgQmFja2dyb3VuZEpvYlNjaGVkdWxlQ2FuY2VsbGVkTWVzc2FnZSB8IEJhY2tncm91bmRKb2JDYW5jZWxTY2hlZHVsZWRFcnJvck1lc3NhZ2UgfCBCYWNrZ3JvdW5kSm9iSm9iTWVzc2FnZSB8IEJhY2tncm91bmRKb2JDb21wbGV0ZU1lc3NhZ2UgfCBCYWNrZ3JvdW5kSm9iRmFpbGVkTWVzc2FnZSB8IEJhY2tncm91bmRKb2JSZXNjaGVkdWxlTWVzc2FnZSB8IEJhY2tncm91bmRKb2JVcGRhdGVkTWVzc2FnZSB8IEJhY2tncm91bmRKb2JVcGRhdGVFcnJvck1lc3NhZ2V9IEJhY2tncm91bmRKb2JTb2NrZXRNZXNzYWdlXG4gKi9cblxuZXhwb3J0IGNvbnN0IG5vdGhpbmcgPSB7fVxuIl19