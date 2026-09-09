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
 * @property {(args: {jobName: string, args: Array<ReturnType<typeof JSON.parse>>, options?: BackgroundJobOptions, producerProof?: BackgroundJobProducerProof}) => Promise<string>} enqueue - Enqueues a job.
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
 * @typedef {{type: "enqueue", jobName: string, args?: Array<ReturnType<typeof JSON.parse>>, options?: BackgroundJobOptions, producerProof?: BackgroundJobProducerProof}} BackgroundJobEnqueueMessage
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoidHlwZXMuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi9zcmMvYmFja2dyb3VuZC1qb2JzL3R5cGVzLmpzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiJBQUFBLFlBQVk7QUFFWjs7R0FFRztBQUNILHlGQUF5RjtBQUN6RixpSUFBaUk7QUFDakksNk5BQTZOO0FBQzdOLGlGQUFpRjtBQUNqRixnRkFBZ0Y7QUFDaEYsd0dBQXdHO0FBQ3hHLHdGQUF3RjtBQUN4Rjs7Ozs7Ozs7R0FRRztBQUNIOzs7Ozs7O0dBT0c7QUFDSDs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7R0FvQkc7QUFDSDs7Ozs7R0FLRztBQUNIOzs7OztHQUtHO0FBQ0g7Ozs7O0dBS0c7QUFDSDs7Ozs7OztHQU9HO0FBQ0g7Ozs7Ozs7Ozs7OztHQVlHO0FBQ0g7OztHQUdHO0FBQ0g7Ozs7O0dBS0c7QUFDSDs7Ozs7R0FLRztBQUNIOzs7Ozs7R0FNRztBQUNIOzs7OztHQUtHO0FBQ0g7Ozs7Ozs7Ozs7O0dBV0c7QUFDSDs7Ozs7Ozs7O0dBU0c7QUFDSDs7Ozs7OztHQU9HO0FBQ0g7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7O0dBdUJHO0FBQ0g7O0dBRUc7QUFDSDs7Ozs7R0FLRztBQUNIOztHQUVHO0FBQ0g7Ozs7R0FJRztBQUNIOzs7Ozs7Ozs7OztHQVdHO0FBQ0g7O0dBRUc7QUFDSDs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7OztHQXNCRztBQUNIOztHQUVHO0FBRUgsTUFBTSxDQUFDLE1BQU0sT0FBTyxHQUFHLEVBQUUsQ0FBQSIsInNvdXJjZXNDb250ZW50IjpbIi8vIEB0cy1jaGVja1xuXG4vKipcbiAqIEB0eXBlZGVmIHtcImlubGluZVwiIHwgXCJmb3JrZWRcIiB8IFwicG9vbGVkXCIgfCBcInNwYXduZWRcIn0gQmFja2dyb3VuZEpvYkV4ZWN1dGlvbk1vZGVcbiAqL1xuLyoqIEB0eXBlZGVmIHtcImNhbmRpZGF0ZVwiIHwgXCJhY3RpdmVcIiB8IFwicmV0aXJlZFwifSBCYWNrZ3JvdW5kSm9ic0dlbmVyYXRpb25Jbml0aWFsU3RhdGUgKi9cbi8qKiBAdHlwZWRlZiB7XCJzdGFydGluZ1wiIHwgXCJjYW5kaWRhdGVcIiB8IFwiYWN0aXZlXCIgfCBcInJldGlyaW5nXCIgfCBcInJldGlyZWRcIiB8IFwic3RvcHBlZFwifSBCYWNrZ3JvdW5kSm9ic0dlbmVyYXRpb25MaWZlY3ljbGVTdGF0ZSAqL1xuLyoqIEB0eXBlZGVmIHtcIm1pc3NpbmctZ2VuZXJhdGlvblwiIHwgXCJ1bmV4cGVjdGVkLWdlbmVyYXRpb25cIiB8IFwibWFsZm9ybWVkLWdlbmVyYXRpb25cIiB8IFwiZ2VuZXJhdGlvbi1taXNtYXRjaFwiIHwgXCJ3b3JrZXItYWRtaXNzaW9uLXJldGlyZWRcIiB8IFwid29ya2VyLWhhcy1uby1yZWNvdmVyYWJsZS1oYW5kb2Zmc1wifSBCYWNrZ3JvdW5kSm9ic0dlbmVyYXRpb25SZWplY3Rpb25SZWFzb24gKi9cbi8qKiBAdHlwZWRlZiB7XCJleGl0XCIgfCBcInByb2Nlc3MtZXJyb3JcIiB8IFwiaXBjLXNlbmRcIn0gUG9vbGVkUnVubmVyRmFpbHVyZU9yaWdpbiAqL1xuLyoqIEB0eXBlZGVmIHtcInN0YXJ0aW5nXCIgfCBcInJ1bm5pbmdcIiB8IFwicmV0aXJpbmdcIn0gUG9vbGVkUnVubmVyTGlmZWN5Y2xlU3RhdGUgKi9cbi8qKiBAdHlwZWRlZiB7XCJ1bmV4cGVjdGVkXCIgfCBcImpvYi10aW1lb3V0XCIgfCBcIndvcmtlci1zaHV0ZG93bi10aW1lb3V0XCJ9IFBvb2xlZFJ1bm5lclRlcm1pbmF0aW9uUmVhc29uICovXG4vKiogQHR5cGVkZWYge1wicnVubmluZ1wiIHwgXCJyZXRpcmluZ1wiIHwgXCJzdG9wcGluZ1wifSBCYWNrZ3JvdW5kSm9ic1dvcmtlckxpZmVjeWNsZVN0YXRlICovXG4vKipcbiAqIEV4YWN0IGR1cmFibGUgaGFuZG9mZiBvd25lcnNoaXAgY2FycmllZCBieSBhbiBleGVjdXRpbmcgam9iIHdoZW4gaXQgcHJvZHVjZXNcbiAqIGZvbGxvdy11cCB3b3JrLlxuICogQHR5cGVkZWYge29iamVjdH0gQmFja2dyb3VuZEpvYlByb2R1Y2VyUHJvb2ZcbiAqIEBwcm9wZXJ0eSB7c3RyaW5nfSBqb2JJZCAtIFByb2R1Y2luZyBqb2IgaWQuXG4gKiBAcHJvcGVydHkge3N0cmluZ30gaGFuZG9mZklkIC0gUHJvZHVjaW5nIGhhbmRvZmYgbGVhc2UgaWQuXG4gKiBAcHJvcGVydHkge3N0cmluZ30gd29ya2VySWQgLSBXb3JrZXIgaWRlbnRpdHkgcGVyc2lzdGVkIHdpdGggdGhlIGhhbmRvZmYuXG4gKiBAcHJvcGVydHkge251bWJlcn0gaGFuZGVkT2ZmQXRNcyAtIER1cmFibGUgaGFuZG9mZiB0aW1lc3RhbXAuXG4gKi9cbi8qKlxuICogQHR5cGVkZWYge29iamVjdH0gUG9vbGVkUnVubmVyQWN0aXZlSm9iXG4gKiBAcHJvcGVydHkge3N0cmluZyB8IG51bGx9IGhhbmRvZmZJZCAtIER1cmFibGUgaGFuZG9mZiBsZWFzZSBpZC5cbiAqIEBwcm9wZXJ0eSB7bnVtYmVyIHwgbnVsbH0gaGFuZGVkT2ZmQXRNcyAtIER1cmFibGUgaGFuZG9mZiB0aW1lc3RhbXAuXG4gKiBAcHJvcGVydHkge3N0cmluZ30gam9iSWQgLSBEdXJhYmxlIGJhY2tncm91bmQgam9iIGlkLlxuICogQHByb3BlcnR5IHtzdHJpbmd9IGpvYk5hbWUgLSBSZWdpc3RlcmVkIGpvYiBjbGFzcyBuYW1lLlxuICogQHByb3BlcnR5IHtzdHJpbmd9IHdvcmtlcklkIC0gV29ya2VyIGlkZW50aXR5IHBlcnNpc3RlZCB3aXRoIHRoZSBoYW5kb2ZmLlxuICovXG4vKipcbiAqIE9uZSBwcm9jZXNzLWZhaWx1cmUgc25hcHNob3Qgc2hhcmVkIGJ5IGV2ZXJ5IGpvYiBsb3N0IHdpdGggYSBwb29sZWQgY2hpbGQuXG4gKiBAdHlwZWRlZiB7b2JqZWN0fSBQb29sZWRSdW5uZXJGYWlsdXJlXG4gKiBAcHJvcGVydHkge1Bvb2xlZFJ1bm5lckFjdGl2ZUpvYltdfSBhY3RpdmVKb2JzIC0gSm9icyB0aGF0IHdlcmUgaW4gZmxpZ2h0IHdoZW4gdGhlIGNoaWxkIGZhaWxlZCwgb3JkZXJlZCBieSBqb2IgaWQuXG4gKiBAcHJvcGVydHkge251bWJlciB8IG51bGx9IGV4aXRDb2RlIC0gQ2hpbGQgZXhpdCBjb2RlLCBvciBudWxsIGZvciBzaWduYWwvcHJvY2VzcyBlcnJvcnMuXG4gKiBAcHJvcGVydHkge3N0cmluZyB8IG51bGx9IGdlbmVyYXRpb25JZCAtIFJlbGVhc2UgZ2VuZXJhdGlvbiBpZGVudGl0eSwgb3IgbnVsbCBpbiBsZWdhY3kgbW9kZS5cbiAqIEBwcm9wZXJ0eSB7Ym9vbGVhbiB8IG51bGx9IG9vbUtpbGxlZCAtIEZhbHNlIHdoZW4gdGhlIG9ic2VydmVkIGV4aXQgcnVsZXMgT09NIG91dDsgbnVsbCB3aGVuIGFuIHVuZXhwZWN0ZWQgU0lHS0lMTCBjYW5ub3QgYmUgZGlzdGluZ3Vpc2hlZCBmcm9tIGFuIE9PTSBraWxsIHdpdGhvdXQgc3VwZXJ2aXNvci9rZXJuZWwgZXZpZGVuY2UuXG4gKiBAcHJvcGVydHkge1Bvb2xlZFJ1bm5lckZhaWx1cmVPcmlnaW59IG9yaWdpbiAtIFdvcmtlciBvYnNlcnZhdGlvbiB0aGF0IGluaXRpYXRlZCBmYWlsdXJlIGhhbmRsaW5nLlxuICogQHByb3BlcnR5IHtudW1iZXJ9IHJ1bm5lckFnZU1zIC0gQ2hpbGQgYWdlIHdoZW4gZmFpbHVyZSBoYW5kbGluZyBzdGFydGVkLlxuICogQHByb3BlcnR5IHtudW1iZXJ9IHJ1bm5lckNyZWF0ZWRBdE1zIC0gQ2hpbGQgY3JlYXRpb24gdGltZXN0YW1wLlxuICogQHByb3BlcnR5IHtib29sZWFufSBydW5uZXJEZXRhY2hlZCAtIFdoZXRoZXIgdGhlIHJ1bm5lciBvd25lZCBhIGRldGFjaGVkIHByb2Nlc3MgZ3JvdXAuXG4gKiBAcHJvcGVydHkge251bWJlcn0gcnVubmVySm9ic1J1biAtIFByZXZpb3VzbHkgYWNrbm93bGVkZ2VkIGpvYnMgaGFuZGxlZCBieSB0aGUgY2hpbGQuXG4gKiBAcHJvcGVydHkge1Bvb2xlZFJ1bm5lckxpZmVjeWNsZVN0YXRlfSBydW5uZXJMaWZlY3ljbGUgLSBDaGlsZCBsaWZlY3ljbGUgaW1tZWRpYXRlbHkgYmVmb3JlIHJlY292ZXJ5LlxuICogQHByb3BlcnR5IHtudW1iZXIgfCBudWxsfSBydW5uZXJQaWQgLSBDaGlsZCBwcm9jZXNzIGlkIHdoZW4gYXZhaWxhYmxlLlxuICogQHByb3BlcnR5IHtpbXBvcnQoXCJub2RlOmNoaWxkX3Byb2Nlc3NcIikuQ2hpbGRQcm9jZXNzW1wic2lnbmFsQ29kZVwiXX0gc2lnbmFsIC0gQ2hpbGQgdGVybWluYXRpb24gc2lnbmFsIHdoZW4gYXZhaWxhYmxlLlxuICogQHByb3BlcnR5IHtQb29sZWRSdW5uZXJUZXJtaW5hdGlvblJlYXNvbn0gdGVybWluYXRpb25SZWFzb24gLSBXaHkgdGhlIHdvcmtlciBleHBlY3RlZCBvciBkaWQgbm90IGV4cGVjdCB0ZXJtaW5hdGlvbi5cbiAqIEBwcm9wZXJ0eSB7c3RyaW5nIHwgbnVsbH0gdGltZW91dEpvYklkIC0gSm9iIHdob3NlIHRpbWVvdXQgaW5pdGlhdGVkIGNoaWxkIHRlcm1pbmF0aW9uLCBvciBudWxsLlxuICogQHByb3BlcnR5IHtzdHJpbmd9IHdvcmtlcklkIC0gU3RhYmxlIGdlbmVyYXRpb24tcXVhbGlmaWVkIHdvcmtlciBpZC5cbiAqIEBwcm9wZXJ0eSB7QmFja2dyb3VuZEpvYnNXb3JrZXJMaWZlY3ljbGVTdGF0ZX0gd29ya2VyTGlmZWN5Y2xlIC0gUGFyZW50IHdvcmtlciBsaWZlY3ljbGUgaW1tZWRpYXRlbHkgYmVmb3JlIHJlY292ZXJ5LlxuICogQHByb3BlcnR5IHtudW1iZXJ9IHdvcmtlclBpZCAtIFBhcmVudCB3b3JrZXIgcHJvY2VzcyBpZC5cbiAqL1xuLyoqXG4gKiBAdHlwZWRlZiB7b2JqZWN0fSBMb2NhbEJhY2tncm91bmRKb2JzQ2xvY2tcbiAqIEBwcm9wZXJ0eSB7KCkgPT4gbnVtYmVyfSBub3cgLSBDdXJyZW50IGVwb2NoIG1pbGxpc2Vjb25kcy5cbiAqIEBwcm9wZXJ0eSB7KGNhbGxiYWNrOiAoKSA9PiB2b2lkLCBkZWxheU1zOiBudW1iZXIpID0+IFJldHVyblR5cGU8dHlwZW9mIHNldFRpbWVvdXQ+IHwgbnVtYmVyfSBzZXRUaW1lb3V0IC0gQXJtcyBhIHRpbWVyLlxuICogQHByb3BlcnR5IHsodGltZXJJZDogUmV0dXJuVHlwZTx0eXBlb2Ygc2V0VGltZW91dD4gfCBudW1iZXIpID0+IHZvaWR9IGNsZWFyVGltZW91dCAtIENsZWFycyBhIHRpbWVyLlxuICovXG4vKipcbiAqIEB0eXBlZGVmIHtvYmplY3R9IFJlc29sdmVkQmFja2dyb3VuZEpvYkNvbmN1cnJlbmN5XG4gKiBAcHJvcGVydHkge3N0cmluZ30gY29uY3VycmVuY3lLZXkgLSBEdXJhYmxlIGNhcCBpZGVudGl0eS5cbiAqIEBwcm9wZXJ0eSB7bnVtYmVyfSBtYXhDb25jdXJyZW5jeSAtIFBvc2l0aXZlIGNhcC5cbiAqIEBwcm9wZXJ0eSB7Ym9vbGVhbn0gcXVldWVEZXJpdmVkIC0gV2hldGhlciBxdWV1ZSBjb25maWd1cmF0aW9uIG93bnMgdGhlIGNhcC5cbiAqL1xuLyoqXG4gKiBAdHlwZWRlZiB7b2JqZWN0fSBCYWNrZ3JvdW5kSm9iQ29uY3VycmVuY3lSZXBhaXJcbiAqIEBwcm9wZXJ0eSB7bnVtYmVyfSBhY3RpdmVDb3VudCAtIEV4YWN0IGhhbmRlZC1vZmYgam9iIGNvdW50IHBlcnNpc3RlZCBieSB0aGUgcmVwYWlyLlxuICogQHByb3BlcnR5IHtzdHJpbmd9IGNvbmN1cnJlbmN5S2V5IC0gRHVyYWJsZSBjYXAgaWRlbnRpdHkuXG4gKiBAcHJvcGVydHkge251bWJlcn0gcHJldmlvdXNBY3RpdmVDb3VudCAtIFBlcnNpc3RlZCBjb3VudCByZXBsYWNlZCBieSB0aGUgcmVwYWlyLlxuICovXG4vKipcbiAqIEB0eXBlZGVmIHtvYmplY3R9IEJhY2tncm91bmRKb2JDb25jdXJyZW5jeVJlY29uY2lsaWF0aW9uXG4gKiBAcHJvcGVydHkge251bWJlcn0gY2FuZGlkYXRlQ291bnQgLSBTbmFwc2hvdCBtaXNtYXRjaGVzIHJlY2hlY2tlZCB1bmRlciB0aGVpciBjb3VudGVyIGxvY2tzLlxuICogQHByb3BlcnR5IHtudW1iZXJ9IGNoZWNrZWRDb3VudCAtIEFjdGl2ZSBvciBub256ZXJvIGR1cmFibGUgY291bnRlcnMgY29tcGFyZWQgaW4gdGhlIGluaXRpYWwgc25hcHNob3QuXG4gKiBAcHJvcGVydHkge251bWJlcn0gcmVwYWlyZWRDb3VudCAtIENvdW50ZXJzIHdob3NlIHBlcnNpc3RlZCB2YWx1ZXMgd2VyZSBjaGFuZ2VkLlxuICogQHByb3BlcnR5IHtCYWNrZ3JvdW5kSm9iQ29uY3VycmVuY3lSZXBhaXJbXX0gcmVwYWlycyAtIEJvdW5kZWQgZGV0ZXJtaW5pc3RpYyBzYW1wbGUgb2YgYXBwbGllZCByZXBhaXJzLlxuICogQHByb3BlcnR5IHtudW1iZXJ9IHJlcGFpcnNUcnVuY2F0ZWRDb3VudCAtIEFwcGxpZWQgcmVwYWlycyBvbWl0dGVkIGZyb20gdGhlIHNhbXBsZS5cbiAqL1xuLyoqXG4gKiBAdHlwZWRlZiB7b2JqZWN0fSBQcmVwYXJlZExvY2FsQmFja2dyb3VuZEpvYlxuICogQHByb3BlcnR5IHtzdHJpbmd9IGFyZ3NEaWdlc3QgLSBGaXhlZC13aWR0aCBkaWdlc3Qgb2YgdGhlIHNlcmlhbGl6ZWQgYXJndW1lbnRzLlxuICogQHByb3BlcnR5IHtzdHJpbmd9IGFyZ3NKc29uIC0gU2VyaWFsaXplZCBhcmd1bWVudHMuXG4gKiBAcHJvcGVydHkge1Jlc29sdmVkQmFja2dyb3VuZEpvYkNvbmN1cnJlbmN5IHwgbnVsbH0gY29uY3VycmVuY3kgLSBSZXNvbHZlZCBjb25jdXJyZW5jeS5cbiAqIEBwcm9wZXJ0eSB7bnVtYmVyfSBjcmVhdGVkQXRNcyAtIENyZWF0aW9uIHRpbWVzdGFtcC5cbiAqIEBwcm9wZXJ0eSB7XCJpbmxpbmVcIn0gZXhlY3V0aW9uTW9kZSAtIExvY2FsIGluLXByb2Nlc3MgZXhlY3V0aW9uIG1vZGUuXG4gKiBAcHJvcGVydHkge3N0cmluZ30gam9iSWQgLSBEdXJhYmxlIGlkLlxuICogQHByb3BlcnR5IHtzdHJpbmd9IGpvYk5hbWUgLSBSZWdpc3RlcmVkIG5hbWUuXG4gKiBAcHJvcGVydHkge251bWJlcn0gbWF4UmV0cmllcyAtIFJldHJ5IGNhcC5cbiAqIEBwcm9wZXJ0eSB7c3RyaW5nfSBxdWV1ZSAtIFF1ZXVlIG5hbWUuXG4gKiBAcHJvcGVydHkge251bWJlcn0gc2NoZWR1bGVkQXRNcyAtIEVsaWdpYmlsaXR5IHRpbWVzdGFtcC5cbiAqL1xuLyoqXG4gKiBAdHlwZWRlZiB7b2JqZWN0fSBCYWNrZ3JvdW5kSm9ic0hlYWx0aFxuICogQHByb3BlcnR5IHtib29sZWFufSByZWFkeSAtIFdoZXRoZXIgdGhlIGFkYXB0ZXIgY2FuIGFjY2VwdCBhbmQgcHJvY2VzcyB3b3JrLlxuICovXG4vKipcbiAqIEB0eXBlZGVmIHtvYmplY3R9IEJhY2tncm91bmRKb2JzUHJvZHVjZXJcbiAqIEBwcm9wZXJ0eSB7KGFyZ3M6IHtqb2JOYW1lOiBzdHJpbmcsIGFyZ3M6IEFycmF5PFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Piwgb3B0aW9ucz86IEJhY2tncm91bmRKb2JPcHRpb25zLCBwcm9kdWNlclByb29mPzogQmFja2dyb3VuZEpvYlByb2R1Y2VyUHJvb2Z9KSA9PiBQcm9taXNlPHN0cmluZz59IGVucXVldWUgLSBFbnF1ZXVlcyBhIGpvYi5cbiAqIEBwcm9wZXJ0eSB7KGFyZ3M6IHtzY2hlZHVsZUtleTogc3RyaW5nLCBqb2JOYW1lOiBzdHJpbmcsIGFyZ3M6IEFycmF5PFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Piwgb3B0aW9ucz86IEJhY2tncm91bmRKb2JPcHRpb25zfSkgPT4gUHJvbWlzZTxCYWNrZ3JvdW5kSm9iUmVwbGFjZW1lbnRSZXN1bHQ+fSByZXBsYWNlU2NoZWR1bGVkIC0gUmVwbGFjZXMgYSBzdGFibGUgc2NoZWR1bGUuXG4gKiBAcHJvcGVydHkgeyhhcmdzOiB7c2NoZWR1bGVLZXk6IHN0cmluZ30pID0+IFByb21pc2U8QmFja2dyb3VuZEpvYkNhbmNlbGxhdGlvblJlc3VsdD59IGNhbmNlbFNjaGVkdWxlZCAtIENhbmNlbHMgYSBzdGFibGUgc2NoZWR1bGUuXG4gKi9cbi8qKlxuICogQHR5cGVkZWYge29iamVjdH0gQmFja2dyb3VuZEpvYkhhbmRvZmZcbiAqIEBwcm9wZXJ0eSB7c3RyaW5nfSBoYW5kb2ZmSWQgLSBVbmlxdWUgaGFuZG9mZiBsZWFzZSBpZC5cbiAqIEBwcm9wZXJ0eSB7bnVtYmVyfSBoYW5kZWRPZmZBdE1zIC0gVGltZSBoYW5kZWQgdG8gYSB3b3JrZXIgaW4gbXMuXG4gKiBAcHJvcGVydHkge0JhY2tncm91bmRKb2JSb3d9IFtqb2JdIC0gRXhhY3QgY29tbWl0dGVkIGpvYiBzbmFwc2hvdCB3aGVuIHRoZSBhZGFwdGVyIGNoYW5nZXMgZGlzcGF0Y2ggZGF0YSBkdXJpbmcgdGhlIGNsYWltLlxuICovXG4vKipcbiAqIEB0eXBlZGVmIHtvYmplY3R9IEJhY2tncm91bmRKb2JIYW5kb2ZmU25hcHNob3RcbiAqIEBwcm9wZXJ0eSB7c3RyaW5nfSBqb2JJZCAtIEpvYiBob2xkaW5nIHRoZSBsZWFzZS5cbiAqIEBwcm9wZXJ0eSB7c3RyaW5nfSBoYW5kb2ZmSWQgLSBFeGFjdCBkdXJhYmxlIGxlYXNlIGlkLlxuICogQHByb3BlcnR5IHtzdHJpbmd9IHdvcmtlcklkIC0gU3RhYmxlIHdvcmtlciBpZCB0aGF0IHJlY2VpdmVkIHRoZSBsZWFzZS5cbiAqIEBwcm9wZXJ0eSB7bnVtYmVyfSBoYW5kZWRPZmZBdE1zIC0gVGltZSBoYW5kZWQgdG8gdGhlIHdvcmtlciBpbiBtcy5cbiAqL1xuLyoqXG4gKiBAdHlwZWRlZiB7b2JqZWN0fSBCYWNrZ3JvdW5kSm9iSGFuZG9mZlJlcXVlc3RcbiAqIEBwcm9wZXJ0eSB7c3RyaW5nfSBqb2JJZCAtIEpvYiB0byBjbGFpbS5cbiAqIEBwcm9wZXJ0eSB7c3RyaW5nfSBbaGFuZG9mZklkXSAtIEV4YWN0IGNhbGxlci1zZWxlY3RlZCBsZWFzZSBpZC4gQWRhcHRlcnMgbXVzdCBwZXJzaXN0IGFuZCByZXR1cm4gdGhpcyBpZCB3aGVuIHN1cHBsaWVkOyBidWlsdC1pbiBhZGFwdGVycyBnZW5lcmF0ZSBvbmUgd2hlbiBvbWl0dGVkIGZvciBsZWdhY3kgZGlyZWN0IGNhbGxlcnMuXG4gKiBAcHJvcGVydHkge3N0cmluZ30gW3dvcmtlcklkXSAtIFdvcmtlciBjbGFpbWluZyB0aGUgam9iLlxuICovXG4vKipcbiAqIEB0eXBlZGVmIHtvYmplY3R9IEJhY2tncm91bmRKb2JPcHRpb25zXG4gKiBAcHJvcGVydHkge0JhY2tncm91bmRKb2JFeGVjdXRpb25Nb2RlfSBbZXhlY3V0aW9uTW9kZV0gLSBIb3cgdGhlIGpvYiBzaG91bGQgcnVuLiBOb2RlIGRlZmF1bHRzIHRvIGBcInBvb2xlZFwiYCAoYSB3YXJtLCByZXVzZWQgbG9jYWwgcnVubmVyIHByb2Nlc3MpLiBCcm93c2VyL0V4cG8gbG9jYWwgZGlzcGF0Y2ggZGVmYXVsdHMgdG8gYW5kIG9ubHkgYWNjZXB0cyBgXCJpbmxpbmVcImAuIGBcImZvcmtlZFwiYCBydW5zIGEgTm9kZSBqb2IgaW4gYSBmcmVzaCBgY2hpbGRfcHJvY2Vzcy5mb3JrKClgIGNoaWxkLCBhbmQgYFwic3Bhd25lZFwiYCBpbiBhIGRldGFjaGVkIENMSSBydW5uZXIuXG4gKiBAcHJvcGVydHkge251bWJlcn0gW21heFJldHJpZXNdIC0gTWF4IHJldHJpZXMgZm9yIGEgZmFpbGVkIGpvYiBiZWZvcmUgaXQgaXMgbWFya2VkIGZhaWxlZC5cbiAqIEBwcm9wZXJ0eSB7c3RyaW5nfSBbcXVldWVdIC0gUXVldWUgbmFtZS4gRGVmYXVsdHMgdG8gYFwiZGVmYXVsdFwiYC4gV2hlbiB0aGUgcXVldWUgaGFzIGEgY29uZmlndXJlZCBjYXAgaW4gYGJhY2tncm91bmRKb2JzLnF1ZXVlc2AsIHRoYXQgY2FwIGlzIGVuZm9yY2VkIGNsdXN0ZXItd2lkZS5cbiAqIEBwcm9wZXJ0eSB7c3RyaW5nfSBbY29uY3VycmVuY3lLZXldIC0gT3BhcXVlIG5vbi1lbXB0eSBrZXkgdXNlZCB0byBzaGFyZSBhIGNvbmN1cnJlbmN5IGNhcC4gT3ZlcnJpZGVzIGFueSBxdWV1ZS1kZXJpdmVkIGNhcC5cbiAqIEBwcm9wZXJ0eSB7bnVtYmVyfSBbbWF4Q29uY3VycmVuY3ldIC0gUG9zaXRpdmUgaW50ZWdlciBjYXA7IG11c3QgYmUgcGFpcmVkIHdpdGggYGNvbmN1cnJlbmN5S2V5YC5cbiAqIEBwcm9wZXJ0eSB7Ym9vbGVhbn0gW2RlZHVwbGljYXRlV2hpbGVRdWV1ZWRdIC0gV2hlbiB0cnVlLCBza2lwIHRoZSBlbnF1ZXVlIGlmIGFuIGlkZW50aWNhbCBzdGlsbC1xdWV1ZWQgam9iIChzYW1lIGpvYiBuYW1lLCBhcmdzIGFuZCBxdWV1ZSkgaXMgc2NoZWR1bGVkIG5vIGxhdGVyIHRoYW4gdGhpcyBlbnF1ZXVlLCByZXR1cm5pbmcgdGhlIGVhcmxpZXN0IG1hdGNoaW5nIGpvYidzIGlkLiBBIGZ1dHVyZSByZXRyeSBkb2VzIG5vdCBzdXBwcmVzcyBlYXJsaWVyIHdvcmsuIERlZHVwbGljYXRpb24gaXMgaW5kZXBlbmRlbnQgb2YgYGNvbmN1cnJlbmN5S2V5YCwgc28gdGhlIGpvYiBrZWVwcyBpdHMgbm9ybWFsIChlLmcuIHF1ZXVlLWRlcml2ZWQpIGNvbmN1cnJlbmN5IGNhcC4gS2VlcHMgYW4gaW50ZXJ2YWwtc2NoZWR1bGVkIHJlY3VycmluZyBqb2IgKGUuZy4gcmV0ZW50aW9uIHBydW5pbmcpIGZyb20gcGlsaW5nIHVwIHJlZHVuZGFudCBxdWV1ZWQgcm93cyB3aGVuIGl0IHJ1bnMgc2xvd2VyIHRoYW4gaXRzIGludGVydmFsIG9yIG5vIHdvcmtlciBpcyBmcmVlLlxuICogQHByb3BlcnR5IHtzdHJpbmd9IFtpZGVtcG90ZW5jeUtleV0gLSBEdXJhYmxlIGVucXVldWUgaWRlbnRpdHkgc2NvcGVkIHRvIHRoZSByZXNvbHZlZCBqb2IgY2xhc3MgbmFtZSBhbmQgcXVldWUuIEV4YWN0IHJlcGxheSByZXR1cm5zIHRoZSBvcmlnaW5hbCBqb2IgaWQgYWNyb3NzIGV2ZXJ5IHN0YXRlIGFuZCBhZnRlciBqb2IgcHJ1bmluZzsgcmV1c2Ugd2l0aCBkaWZmZXJlbnQgY2Fub25pY2FsIGFyZ3VtZW50cyBvciBiZWhhdmlvci1hZmZlY3Rpbmcgb3B0aW9ucyBmYWlscy4gT3duZXJzaGlwIGlzIGluZGVwZW5kZW50IG9mIGBkZWR1cGxpY2F0ZVdoaWxlUXVldWVkYCBhbmQgaXMgcmV0YWluZWQgdW50aWwgYW4gZXhwbGljaXQgZnV0dXJlIHJldGVudGlvbiBwb2xpY3kgcmVtb3ZlcyBpdC5cbiAqIEBwcm9wZXJ0eSB7bnVtYmVyfSBbc2NoZWR1bGVkQXRNc10gLSBFcG9jaCB0aW1lc3RhbXAgaW4gbWlsbGlzZWNvbmRzIHdoZW4gdGhlIGpvYiBiZWNvbWVzIGVsaWdpYmxlIGZvciBkaXNwYXRjaC4gRGVmYXVsdHMgdG8gZW5xdWV1ZSB0aW1lLlxuICogQHByb3BlcnR5IHtudW1iZXJ9IFt0aW1lb3V0TXNdIC0gUGVyLWpvYiB3YWxsLWNsb2NrIHRpbWVvdXQgZm9yIGZvcmtlZCBhbmQgcG9vbGVkIGV4ZWN1dGlvbi4gQSBwb3NpdGl2ZSBpbnRlZ2VyIHVwIHRvIDIsMTQ3LDQ4Myw2NDcgb3ZlcnJpZGVzIHRoZSB3b3JrZXItbGV2ZWwgYGpvYlRpbWVvdXRNc2A7IGEgbm9uLXBvc2l0aXZlIGZpbml0ZSB2YWx1ZSBkaXNhYmxlcyB0aGUgdGltZW91dCBmb3IgdGhpcyBqb2IuXG4gKi9cbi8qKlxuICogQHR5cGVkZWYge29iamVjdH0gQmFja2dyb3VuZEpvYlBheWxvYWRcbiAqIEBwcm9wZXJ0eSB7c3RyaW5nfSBbaWRdIC0gSm9iIGlkLlxuICogQHByb3BlcnR5IHtzdHJpbmd9IGpvYk5hbWUgLSBKb2IgY2xhc3MgbmFtZS5cbiAqIEBwcm9wZXJ0eSB7QXJyYXk8UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSBbYXJnc10gLSBTZXJpYWxpemVkIGpvYiBhcmd1bWVudHMuXG4gKiBAcHJvcGVydHkge3N0cmluZ30gW2hhbmRvZmZJZF0gLSBVbmlxdWUgaGFuZG9mZiBsZWFzZSBpZC5cbiAqIEBwcm9wZXJ0eSB7c3RyaW5nfSBbd29ya2VySWRdIC0gV29ya2VyIGlkIGhhbmRsaW5nIHRoZSBqb2IuXG4gKiBAcHJvcGVydHkge251bWJlcn0gW2hhbmRlZE9mZkF0TXNdIC0gVGltZSBoYW5kZWQgdG8gYSB3b3JrZXIgaW4gbXMuXG4gKiBAcHJvcGVydHkge0JhY2tncm91bmRKb2JPcHRpb25zfSBbb3B0aW9uc10gLSBSdW50aW1lIG9wdGlvbnMuXG4gKi9cbi8qKlxuICogQHR5cGVkZWYge29iamVjdH0gQmFja2dyb3VuZEpvYkNvbnRleHRcbiAqIEBwcm9wZXJ0eSB7dHlwZW9mIGltcG9ydChcIi4vcGxhdGZvcm0tam9iLmpzXCIpLmRlZmF1bHR9IGpvYkNsYXNzIC0gQ29uY3JldGUgam9iIGNsYXNzLlxuICogQHByb3BlcnR5IHtzdHJpbmd9IGpvYk5hbWUgLSBSZWdpc3RlcmVkIGpvYiBuYW1lLlxuICogQHByb3BlcnR5IHtBcnJheTxSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59IGFyZ3MgLSBTZXJpYWxpemVkIGpvYiBhcmd1bWVudHMuXG4gKiBAcHJvcGVydHkge0JhY2tncm91bmRKb2JPcHRpb25zfSBvcHRpb25zIC0gUmVzb2x2ZWQgZW5xdWV1ZS9ydW50aW1lIG9wdGlvbnMuXG4gKiBAcHJvcGVydHkge0JhY2tncm91bmRKb2JQYXlsb2FkfSBbcGF5bG9hZF0gLSBDb21wbGV0ZSBwZXJzaXN0ZWQgcnVubmVyIHBheWxvYWQgd2hlbiB0aGUgam9iIGlzIHBlcmZvcm1pbmcuXG4gKi9cbi8qKlxuICogQHR5cGVkZWYge29iamVjdH0gQmFja2dyb3VuZEpvYlJvd1xuICogQHByb3BlcnR5IHtzdHJpbmd9IGlkIC0gSm9iIGlkLlxuICogQHByb3BlcnR5IHtzdHJpbmd9IGpvYk5hbWUgLSBKb2IgY2xhc3MgbmFtZS5cbiAqIEBwcm9wZXJ0eSB7QXJyYXk8UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSBhcmdzIC0gU2VyaWFsaXplZCBqb2IgYXJndW1lbnRzLlxuICogQHByb3BlcnR5IHtCYWNrZ3JvdW5kSm9iRXhlY3V0aW9uTW9kZX0gZXhlY3V0aW9uTW9kZSAtIEhvdyB0aGUgam9iIHNob3VsZCBydW4uXG4gKiBAcHJvcGVydHkge3N0cmluZ30gcXVldWUgLSBRdWV1ZSBuYW1lIChkZWZhdWx0cyB0byBgXCJkZWZhdWx0XCJgKS5cbiAqIEBwcm9wZXJ0eSB7c3RyaW5nIHwgbnVsbH0gc2NoZWR1bGVLZXkgLSBTdGFibGUgbG9naWNhbCBzY2hlZHVsZSBrZXkgcmV0YWluZWQgZm9yIGhpc3RvcnkuXG4gKiBAcHJvcGVydHkge3N0cmluZ30gc3RhdHVzIC0gQ3VycmVudCBqb2Igc3RhdHVzLlxuICogQHByb3BlcnR5IHtudW1iZXIgfCBudWxsfSBhdHRlbXB0cyAtIEZhaWx1cmUgYXR0ZW1wdHMgY291bnQuXG4gKiBAcHJvcGVydHkge251bWJlciB8IG51bGx9IG1heFJldHJpZXMgLSBNYXggcmV0cnkgYXR0ZW1wdHMuXG4gKiBAcHJvcGVydHkge251bWJlciB8IG51bGx9IHNjaGVkdWxlZEF0TXMgLSBOZXh0IHNjaGVkdWxlZCB0aW1lIGluIG1zLlxuICogQHByb3BlcnR5IHtudW1iZXIgfCBudWxsfSBjcmVhdGVkQXRNcyAtIENyZWF0aW9uIHRpbWUgaW4gbXMuXG4gKiBAcHJvcGVydHkge251bWJlciB8IG51bGx9IGhhbmRlZE9mZkF0TXMgLSBUaW1lIGhhbmRlZCB0byB3b3JrZXIgaW4gbXMuXG4gKiBAcHJvcGVydHkge3N0cmluZyB8IG51bGx9IGhhbmRvZmZJZCAtIFVuaXF1ZSBsYXRlc3QgaGFuZG9mZiBsZWFzZSBpZC5cbiAqIEBwcm9wZXJ0eSB7bnVtYmVyIHwgbnVsbH0gY29tcGxldGVkQXRNcyAtIENvbXBsZXRpb24gdGltZSBpbiBtcy5cbiAqIEBwcm9wZXJ0eSB7bnVtYmVyIHwgbnVsbH0gZmFpbGVkQXRNcyAtIEZhaWx1cmUgdGltZSBpbiBtcy5cbiAqIEBwcm9wZXJ0eSB7bnVtYmVyIHwgbnVsbH0gb3JwaGFuZWRBdE1zIC0gT3JwaGFuZWQgdGltZSBpbiBtcy5cbiAqIEBwcm9wZXJ0eSB7c3RyaW5nIHwgbnVsbH0gd29ya2VySWQgLSBXb3JrZXIgaWQgaGFuZGxpbmcgdGhlIGpvYi5cbiAqIEBwcm9wZXJ0eSB7c3RyaW5nIHwgbnVsbH0gbGFzdEVycm9yIC0gTGFzdCBmYWlsdXJlIG1lc3NhZ2UuXG4gKiBAcHJvcGVydHkge3N0cmluZyB8IG51bGx9IGNvbmN1cnJlbmN5S2V5IC0gRHVyYWJsZSBjb25jdXJyZW5jeSBrZXkuXG4gKiBAcHJvcGVydHkge251bWJlciB8IG51bGx9IG1heENvbmN1cnJlbmN5IC0gRHVyYWJsZSBwZXIta2V5IGNhcC5cbiAqIEBwcm9wZXJ0eSB7bnVtYmVyIHwgbnVsbH0gdGltZW91dE1zIC0gUGVyLWpvYiB3YWxsLWNsb2NrIHRpbWVvdXQgb3ZlcnJpZGUsIG9yIG51bGwgd2hlbiBvbWl0dGVkLlxuICovXG4vKipcbiAqIEB0eXBlZGVmIHtcInF1ZXVlZFwiIHwgXCJoYW5kZWRfb2ZmXCIgfCBudWxsfSBCYWNrZ3JvdW5kSm9iUmVwbGFjZW1lbnRQcmV2aW91c1N0YXR1c1xuICovXG4vKipcbiAqIEB0eXBlZGVmIHtvYmplY3R9IEJhY2tncm91bmRKb2JSZXBsYWNlbWVudFJlc3VsdFxuICogQHByb3BlcnR5IHtzdHJpbmd9IGpvYklkIC0gTmV3bHkgcXVldWVkIGpvYiBpZC5cbiAqIEBwcm9wZXJ0eSB7c3RyaW5nIHwgbnVsbH0gcHJldmlvdXNKb2JJZCAtIFByZXZpb3VzIGFjdGl2ZSBvd25lcidzIGpvYiBpZC5cbiAqIEBwcm9wZXJ0eSB7QmFja2dyb3VuZEpvYlJlcGxhY2VtZW50UHJldmlvdXNTdGF0dXN9IHByZXZpb3VzU3RhdHVzIC0gUHJldmlvdXMgb3duZXIncyBvYnNlcnZlZCBzdGF0ZS5cbiAqL1xuLyoqXG4gKiBAdHlwZWRlZiB7XCJjYW5jZWxsZWRcIiB8IFwiaGFuZGVkX29mZlwiIHwgXCJub3RfZm91bmRcIn0gQmFja2dyb3VuZEpvYkNhbmNlbGxhdGlvbk91dGNvbWVcbiAqL1xuLyoqXG4gKiBAdHlwZWRlZiB7b2JqZWN0fSBCYWNrZ3JvdW5kSm9iQ2FuY2VsbGF0aW9uUmVzdWx0XG4gKiBAcHJvcGVydHkge3N0cmluZyB8IG51bGx9IGpvYklkIC0gRGV0YWNoZWQgb3duZXIncyBqb2IgaWQsIHdoZW4gb25lIHdhcyBhY3RpdmUuXG4gKiBAcHJvcGVydHkge0JhY2tncm91bmRKb2JDYW5jZWxsYXRpb25PdXRjb21lfSBvdXRjb21lIC0gVHJ1dGhmdWwgYmVzdC1lZmZvcnQgb3V0Y29tZS5cbiAqL1xuLyoqXG4gKiBAdHlwZWRlZiB7b2JqZWN0fSBCYWNrZ3JvdW5kSm9iRmFpbHVyZUV2ZW50XG4gKiBAcHJvcGVydHkge0JhY2tncm91bmRKb2JSb3d9IGpvYiAtIFVwZGF0ZWQgam9iIHJvdyBhZnRlciBmYWlsdXJlIGhhbmRsaW5nLlxuICogQHByb3BlcnR5IHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gZXJyb3IgLSBGYWlsdXJlIGVycm9yLlxuICogQHByb3BlcnR5IHtudW1iZXIgfCBudWxsfSBhdHRlbXB0cyAtIFVwZGF0ZWQgZmFpbHVyZSBhdHRlbXB0cyBjb3VudC5cbiAqIEBwcm9wZXJ0eSB7Ym9vbGVhbn0gdGVybWluYWwgLSBXaGV0aGVyIHRoaXMgZmFpbHVyZSBlbmRlZCB0aGUgam9iLlxuICogQHByb3BlcnR5IHtib29sZWFufSB3aWxsUmV0cnkgLSBXaGV0aGVyIHRoZSBqb2Igd2FzIHJldHVybmVkIHRvIHRoZSBxdWV1ZS5cbiAqIEBwcm9wZXJ0eSB7c3RyaW5nIHwgdW5kZWZpbmVkfSBoYW5kb2ZmSWQgLSBIYW5kb2ZmIGxlYXNlIGlkIGZyb20gdGhlIHdvcmtlciByZXBvcnQuXG4gKiBAcHJvcGVydHkge251bWJlciB8IHVuZGVmaW5lZH0gaGFuZGVkT2ZmQXRNcyAtIEhhbmRvZmYgdGltZXN0YW1wIGZyb20gdGhlIHdvcmtlciByZXBvcnQuXG4gKiBAcHJvcGVydHkge3N0cmluZyB8IHVuZGVmaW5lZH0gd29ya2VySWQgLSBXb3JrZXIgaWQgZnJvbSB0aGUgd29ya2VyIHJlcG9ydC5cbiAqIEBwcm9wZXJ0eSB7UG9vbGVkUnVubmVyRmFpbHVyZSB8IHVuZGVmaW5lZH0gcnVubmVyRmFpbHVyZSAtIFNoYXJlZCBwb29sZWQtY2hpbGQgcHJvY2VzcyBmYWlsdXJlIHByb3ZlbmFuY2UuXG4gKi9cbi8qKlxuICogQHR5cGVkZWYge1wid29ya2VyXCIgfCBcImNsaWVudFwiIHwgXCJyZXBvcnRlclwifSBCYWNrZ3JvdW5kSm9iU29ja2V0Um9sZVxuICovXG4vKipcbiAqIEB0eXBlZGVmIHt7dHlwZTogXCJoZWxsb1wiLCByb2xlOiBCYWNrZ3JvdW5kSm9iU29ja2V0Um9sZSwgZ2VuZXJhdGlvbklkPzogc3RyaW5nLCBzdXBwb3J0c0hhbmRvZmZJZFJlcG9ydGluZz86IGJvb2xlYW4sIHN1cHBvcnRzSGVhcnRiZWF0PzogYm9vbGVhbiwgc3VwcG9ydHNQb29sZWQ/OiBib29sZWFuLCB3b3JrZXJJZD86IHN0cmluZ319IEJhY2tncm91bmRKb2JIZWxsb01lc3NhZ2VcbiAqIEB0eXBlZGVmIHt7dHlwZTogXCJnZW5lcmF0aW9uLWFjY2VwdGVkXCIsIGdlbmVyYXRpb25JZDogc3RyaW5nLCBsaWZlY3ljbGVTdGF0ZTogQmFja2dyb3VuZEpvYnNHZW5lcmF0aW9uTGlmZWN5Y2xlU3RhdGV9fSBCYWNrZ3JvdW5kSm9iR2VuZXJhdGlvbkFjY2VwdGVkTWVzc2FnZVxuICogQHR5cGVkZWYge3t0eXBlOiBcImdlbmVyYXRpb24tcmVqZWN0ZWRcIiwgcmVhc29uOiBCYWNrZ3JvdW5kSm9ic0dlbmVyYXRpb25SZWplY3Rpb25SZWFzb259fSBCYWNrZ3JvdW5kSm9iR2VuZXJhdGlvblJlamVjdGVkTWVzc2FnZVxuICogQHR5cGVkZWYge3t0eXBlOiBcInJlYWR5XCIsIGFjY2VwdHNGb3JrZWQ/OiBib29sZWFuLCBhY2NlcHRzSW5saW5lPzogYm9vbGVhbiwgYWNjZXB0c1Bvb2xlZD86IGJvb2xlYW4sIGFjY2VwdHNTcGF3bmVkPzogYm9vbGVhbiwgYXZhaWxhYmxlUG9vbGVkU2xvdHM/OiBudW1iZXJ9fSBCYWNrZ3JvdW5kSm9iUmVhZHlNZXNzYWdlXG4gKiBAdHlwZWRlZiB7e3R5cGU6IFwiZHJhaW5pbmdcIn19IEJhY2tncm91bmRKb2JEcmFpbmluZ01lc3NhZ2VcbiAqIEB0eXBlZGVmIHt7dHlwZTogXCJoZWFydGJlYXRcIiwgd29ya2VySWQ/OiBzdHJpbmd9fSBCYWNrZ3JvdW5kSm9iSGVhcnRiZWF0TWVzc2FnZVxuICogQHR5cGVkZWYge3t0eXBlOiBcImVucXVldWVcIiwgam9iTmFtZTogc3RyaW5nLCBhcmdzPzogQXJyYXk8UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+LCBvcHRpb25zPzogQmFja2dyb3VuZEpvYk9wdGlvbnMsIHByb2R1Y2VyUHJvb2Y/OiBCYWNrZ3JvdW5kSm9iUHJvZHVjZXJQcm9vZn19IEJhY2tncm91bmRKb2JFbnF1ZXVlTWVzc2FnZVxuICogQHR5cGVkZWYge3t0eXBlOiBcImVucXVldWVkXCIsIGpvYklkOiBzdHJpbmd9fSBCYWNrZ3JvdW5kSm9iRW5xdWV1ZWRNZXNzYWdlXG4gKiBAdHlwZWRlZiB7e3R5cGU6IFwiZW5xdWV1ZS1lcnJvclwiLCBlcnJvcj86IHN0cmluZ319IEJhY2tncm91bmRKb2JFbnF1ZXVlRXJyb3JNZXNzYWdlXG4gKiBAdHlwZWRlZiB7e3R5cGU6IFwicmVwbGFjZS1zY2hlZHVsZWRcIiwgc2NoZWR1bGVLZXk6IHN0cmluZywgam9iTmFtZTogc3RyaW5nLCBhcmdzPzogQXJyYXk8UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+LCBvcHRpb25zPzogQmFja2dyb3VuZEpvYk9wdGlvbnN9fSBCYWNrZ3JvdW5kSm9iUmVwbGFjZVNjaGVkdWxlZE1lc3NhZ2VcbiAqIEB0eXBlZGVmIHt7dHlwZTogXCJzY2hlZHVsZS1yZXBsYWNlZFwiLCBqb2JJZDogc3RyaW5nLCBwcmV2aW91c0pvYklkOiBzdHJpbmcgfCBudWxsLCBwcmV2aW91c1N0YXR1czogQmFja2dyb3VuZEpvYlJlcGxhY2VtZW50UHJldmlvdXNTdGF0dXN9fSBCYWNrZ3JvdW5kSm9iU2NoZWR1bGVSZXBsYWNlZE1lc3NhZ2VcbiAqIEB0eXBlZGVmIHt7dHlwZTogXCJyZXBsYWNlLXNjaGVkdWxlZC1lcnJvclwiLCBlcnJvcj86IHN0cmluZ319IEJhY2tncm91bmRKb2JSZXBsYWNlU2NoZWR1bGVkRXJyb3JNZXNzYWdlXG4gKiBAdHlwZWRlZiB7e3R5cGU6IFwiY2FuY2VsLXNjaGVkdWxlZFwiLCBzY2hlZHVsZUtleTogc3RyaW5nfX0gQmFja2dyb3VuZEpvYkNhbmNlbFNjaGVkdWxlZE1lc3NhZ2VcbiAqIEB0eXBlZGVmIHt7dHlwZTogXCJzY2hlZHVsZS1jYW5jZWxsZWRcIiwgam9iSWQ6IHN0cmluZyB8IG51bGwsIG91dGNvbWU6IEJhY2tncm91bmRKb2JDYW5jZWxsYXRpb25PdXRjb21lfX0gQmFja2dyb3VuZEpvYlNjaGVkdWxlQ2FuY2VsbGVkTWVzc2FnZVxuICogQHR5cGVkZWYge3t0eXBlOiBcImNhbmNlbC1zY2hlZHVsZWQtZXJyb3JcIiwgZXJyb3I/OiBzdHJpbmd9fSBCYWNrZ3JvdW5kSm9iQ2FuY2VsU2NoZWR1bGVkRXJyb3JNZXNzYWdlXG4gKiBAdHlwZWRlZiB7e3R5cGU6IFwiam9iXCIsIHBheWxvYWQ6IEJhY2tncm91bmRKb2JQYXlsb2FkfX0gQmFja2dyb3VuZEpvYkpvYk1lc3NhZ2VcbiAqIEB0eXBlZGVmIHt7dHlwZTogXCJqb2ItY29tcGxldGVcIiwgam9iSWQ6IHN0cmluZywgaGFuZG9mZklkPzogc3RyaW5nLCB3b3JrZXJJZD86IHN0cmluZywgaGFuZGVkT2ZmQXRNcz86IG51bWJlcn19IEJhY2tncm91bmRKb2JDb21wbGV0ZU1lc3NhZ2VcbiAqIEB0eXBlZGVmIHt7dHlwZTogXCJqb2ItZmFpbGVkXCIsIGpvYklkOiBzdHJpbmcsIGVycm9yPzogUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4sIGhhbmRvZmZJZD86IHN0cmluZywgd29ya2VySWQ/OiBzdHJpbmcsIGhhbmRlZE9mZkF0TXM/OiBudW1iZXIsIHJ1bm5lckZhaWx1cmU/OiBQb29sZWRSdW5uZXJGYWlsdXJlfX0gQmFja2dyb3VuZEpvYkZhaWxlZE1lc3NhZ2VcbiAqIEB0eXBlZGVmIHt7dHlwZTogXCJqb2ItcmVzY2hlZHVsZVwiLCBqb2JJZDogc3RyaW5nLCBkZWxheU1zOiBudW1iZXIsIGhhbmRvZmZJZD86IHN0cmluZywgd29ya2VySWQ/OiBzdHJpbmcsIGhhbmRlZE9mZkF0TXM/OiBudW1iZXJ9fSBCYWNrZ3JvdW5kSm9iUmVzY2hlZHVsZU1lc3NhZ2VcbiAqIEB0eXBlZGVmIHt7dHlwZTogXCJqb2ItdXBkYXRlZFwiLCBqb2JJZDogc3RyaW5nfX0gQmFja2dyb3VuZEpvYlVwZGF0ZWRNZXNzYWdlXG4gKiBAdHlwZWRlZiB7e3R5cGU6IFwiam9iLXVwZGF0ZS1lcnJvclwiLCBqb2JJZDogc3RyaW5nLCBlcnJvcj86IHN0cmluZ319IEJhY2tncm91bmRKb2JVcGRhdGVFcnJvck1lc3NhZ2VcbiAqL1xuLyoqXG4gKiBAdHlwZWRlZiB7QmFja2dyb3VuZEpvYkhlbGxvTWVzc2FnZSB8IEJhY2tncm91bmRKb2JHZW5lcmF0aW9uQWNjZXB0ZWRNZXNzYWdlIHwgQmFja2dyb3VuZEpvYkdlbmVyYXRpb25SZWplY3RlZE1lc3NhZ2UgfCBCYWNrZ3JvdW5kSm9iUmVhZHlNZXNzYWdlIHwgQmFja2dyb3VuZEpvYkRyYWluaW5nTWVzc2FnZSB8IEJhY2tncm91bmRKb2JIZWFydGJlYXRNZXNzYWdlIHwgQmFja2dyb3VuZEpvYkVucXVldWVNZXNzYWdlIHwgQmFja2dyb3VuZEpvYkVucXVldWVkTWVzc2FnZSB8IEJhY2tncm91bmRKb2JFbnF1ZXVlRXJyb3JNZXNzYWdlIHwgQmFja2dyb3VuZEpvYlJlcGxhY2VTY2hlZHVsZWRNZXNzYWdlIHwgQmFja2dyb3VuZEpvYlNjaGVkdWxlUmVwbGFjZWRNZXNzYWdlIHwgQmFja2dyb3VuZEpvYlJlcGxhY2VTY2hlZHVsZWRFcnJvck1lc3NhZ2UgfCBCYWNrZ3JvdW5kSm9iQ2FuY2VsU2NoZWR1bGVkTWVzc2FnZSB8IEJhY2tncm91bmRKb2JTY2hlZHVsZUNhbmNlbGxlZE1lc3NhZ2UgfCBCYWNrZ3JvdW5kSm9iQ2FuY2VsU2NoZWR1bGVkRXJyb3JNZXNzYWdlIHwgQmFja2dyb3VuZEpvYkpvYk1lc3NhZ2UgfCBCYWNrZ3JvdW5kSm9iQ29tcGxldGVNZXNzYWdlIHwgQmFja2dyb3VuZEpvYkZhaWxlZE1lc3NhZ2UgfCBCYWNrZ3JvdW5kSm9iUmVzY2hlZHVsZU1lc3NhZ2UgfCBCYWNrZ3JvdW5kSm9iVXBkYXRlZE1lc3NhZ2UgfCBCYWNrZ3JvdW5kSm9iVXBkYXRlRXJyb3JNZXNzYWdlfSBCYWNrZ3JvdW5kSm9iU29ja2V0TWVzc2FnZVxuICovXG5cbmV4cG9ydCBjb25zdCBub3RoaW5nID0ge31cbiJdfQ==