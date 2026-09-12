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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoidHlwZXMuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi9zcmMvYmFja2dyb3VuZC1qb2JzL3R5cGVzLmpzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiJBQUFBLFlBQVk7QUFFWjs7R0FFRztBQUNILHlGQUF5RjtBQUN6RixpSUFBaUk7QUFDakksNk5BQTZOO0FBQzdOLG1FQUFtRTtBQUNuRSwrRkFBK0Y7QUFDL0YsNkZBQTZGO0FBQzdGLGlGQUFpRjtBQUNqRixnRkFBZ0Y7QUFDaEYsd0dBQXdHO0FBQ3hHLHdGQUF3RjtBQUN4Rjs7Ozs7Ozs7R0FRRztBQUNIOzs7Ozs7O0dBT0c7QUFDSDs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7R0FvQkc7QUFDSDs7Ozs7R0FLRztBQUNIOzs7OztHQUtHO0FBQ0g7Ozs7O0dBS0c7QUFDSDs7Ozs7OztHQU9HO0FBQ0g7Ozs7Ozs7Ozs7OztHQVlHO0FBQ0g7OztHQUdHO0FBQ0g7Ozs7Ozs7R0FPRztBQUNIOzs7OztHQUtHO0FBQ0g7Ozs7OztHQU1HO0FBQ0g7Ozs7O0dBS0c7QUFDSDs7Ozs7Ozs7Ozs7R0FXRztBQUNIOzs7Ozs7Ozs7R0FTRztBQUNIOzs7Ozs7O0dBT0c7QUFDSDs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7OztHQTRCRztBQUNIOztHQUVHO0FBQ0g7Ozs7O0dBS0c7QUFDSDs7R0FFRztBQUNIOzs7O0dBSUc7QUFDSDs7OztHQUlHO0FBQ0g7O0dBRUc7QUFDSDs7OztHQUlHO0FBQ0g7Ozs7Ozs7Ozs7O0dBV0c7QUFDSDs7R0FFRztBQUNIOzs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7OztHQTZCRztBQUNIOztHQUVHO0FBRUgsTUFBTSxDQUFDLE1BQU0sT0FBTyxHQUFHLEVBQUUsQ0FBQSIsInNvdXJjZXNDb250ZW50IjpbIi8vIEB0cy1jaGVja1xuXG4vKipcbiAqIEB0eXBlZGVmIHtcImlubGluZVwiIHwgXCJmb3JrZWRcIiB8IFwicG9vbGVkXCIgfCBcInNwYXduZWRcIn0gQmFja2dyb3VuZEpvYkV4ZWN1dGlvbk1vZGVcbiAqL1xuLyoqIEB0eXBlZGVmIHtcImNhbmRpZGF0ZVwiIHwgXCJhY3RpdmVcIiB8IFwicmV0aXJlZFwifSBCYWNrZ3JvdW5kSm9ic0dlbmVyYXRpb25Jbml0aWFsU3RhdGUgKi9cbi8qKiBAdHlwZWRlZiB7XCJzdGFydGluZ1wiIHwgXCJjYW5kaWRhdGVcIiB8IFwiYWN0aXZlXCIgfCBcInJldGlyaW5nXCIgfCBcInJldGlyZWRcIiB8IFwic3RvcHBlZFwifSBCYWNrZ3JvdW5kSm9ic0dlbmVyYXRpb25MaWZlY3ljbGVTdGF0ZSAqL1xuLyoqIEB0eXBlZGVmIHtcIm1pc3NpbmctZ2VuZXJhdGlvblwiIHwgXCJ1bmV4cGVjdGVkLWdlbmVyYXRpb25cIiB8IFwibWFsZm9ybWVkLWdlbmVyYXRpb25cIiB8IFwiZ2VuZXJhdGlvbi1taXNtYXRjaFwiIHwgXCJ3b3JrZXItYWRtaXNzaW9uLXJldGlyZWRcIiB8IFwid29ya2VyLWhhcy1uby1yZWNvdmVyYWJsZS1oYW5kb2Zmc1wifSBCYWNrZ3JvdW5kSm9ic0dlbmVyYXRpb25SZWplY3Rpb25SZWFzb24gKi9cbi8qKiBAdHlwZWRlZiB7XCJxdWV1ZWRcIiB8IFwiaGFuZGVkX29mZlwifSBCYWNrZ3JvdW5kSm9iQWN0aXZlU3RhdHVzICovXG4vKiogQHR5cGVkZWYge1wiY2FuY2VsbGVkXCIgfCBcImNvbXBsZXRlZFwiIHwgXCJmYWlsZWRcIiB8IFwib3JwaGFuZWRcIn0gQmFja2dyb3VuZEpvYlRlcm1pbmFsU3RhdHVzICovXG4vKiogQHR5cGVkZWYge0JhY2tncm91bmRKb2JBY3RpdmVTdGF0dXMgfCBCYWNrZ3JvdW5kSm9iVGVybWluYWxTdGF0dXN9IEJhY2tncm91bmRKb2JTdGF0dXMgKi9cbi8qKiBAdHlwZWRlZiB7XCJleGl0XCIgfCBcInByb2Nlc3MtZXJyb3JcIiB8IFwiaXBjLXNlbmRcIn0gUG9vbGVkUnVubmVyRmFpbHVyZU9yaWdpbiAqL1xuLyoqIEB0eXBlZGVmIHtcInN0YXJ0aW5nXCIgfCBcInJ1bm5pbmdcIiB8IFwicmV0aXJpbmdcIn0gUG9vbGVkUnVubmVyTGlmZWN5Y2xlU3RhdGUgKi9cbi8qKiBAdHlwZWRlZiB7XCJ1bmV4cGVjdGVkXCIgfCBcImpvYi10aW1lb3V0XCIgfCBcIndvcmtlci1zaHV0ZG93bi10aW1lb3V0XCJ9IFBvb2xlZFJ1bm5lclRlcm1pbmF0aW9uUmVhc29uICovXG4vKiogQHR5cGVkZWYge1wicnVubmluZ1wiIHwgXCJyZXRpcmluZ1wiIHwgXCJzdG9wcGluZ1wifSBCYWNrZ3JvdW5kSm9ic1dvcmtlckxpZmVjeWNsZVN0YXRlICovXG4vKipcbiAqIEV4YWN0IGR1cmFibGUgaGFuZG9mZiBvd25lcnNoaXAgY2FycmllZCBieSBhbiBleGVjdXRpbmcgam9iIHdoZW4gaXQgcHJvZHVjZXNcbiAqIGZvbGxvdy11cCB3b3JrLlxuICogQHR5cGVkZWYge29iamVjdH0gQmFja2dyb3VuZEpvYlByb2R1Y2VyUHJvb2ZcbiAqIEBwcm9wZXJ0eSB7c3RyaW5nfSBqb2JJZCAtIFByb2R1Y2luZyBqb2IgaWQuXG4gKiBAcHJvcGVydHkge3N0cmluZ30gaGFuZG9mZklkIC0gUHJvZHVjaW5nIGhhbmRvZmYgbGVhc2UgaWQuXG4gKiBAcHJvcGVydHkge3N0cmluZ30gd29ya2VySWQgLSBXb3JrZXIgaWRlbnRpdHkgcGVyc2lzdGVkIHdpdGggdGhlIGhhbmRvZmYuXG4gKiBAcHJvcGVydHkge251bWJlcn0gaGFuZGVkT2ZmQXRNcyAtIER1cmFibGUgaGFuZG9mZiB0aW1lc3RhbXAuXG4gKi9cbi8qKlxuICogQHR5cGVkZWYge29iamVjdH0gUG9vbGVkUnVubmVyQWN0aXZlSm9iXG4gKiBAcHJvcGVydHkge3N0cmluZyB8IG51bGx9IGhhbmRvZmZJZCAtIER1cmFibGUgaGFuZG9mZiBsZWFzZSBpZC5cbiAqIEBwcm9wZXJ0eSB7bnVtYmVyIHwgbnVsbH0gaGFuZGVkT2ZmQXRNcyAtIER1cmFibGUgaGFuZG9mZiB0aW1lc3RhbXAuXG4gKiBAcHJvcGVydHkge3N0cmluZ30gam9iSWQgLSBEdXJhYmxlIGJhY2tncm91bmQgam9iIGlkLlxuICogQHByb3BlcnR5IHtzdHJpbmd9IGpvYk5hbWUgLSBSZWdpc3RlcmVkIGpvYiBjbGFzcyBuYW1lLlxuICogQHByb3BlcnR5IHtzdHJpbmd9IHdvcmtlcklkIC0gV29ya2VyIGlkZW50aXR5IHBlcnNpc3RlZCB3aXRoIHRoZSBoYW5kb2ZmLlxuICovXG4vKipcbiAqIE9uZSBwcm9jZXNzLWZhaWx1cmUgc25hcHNob3Qgc2hhcmVkIGJ5IGV2ZXJ5IGpvYiBsb3N0IHdpdGggYSBwb29sZWQgY2hpbGQuXG4gKiBAdHlwZWRlZiB7b2JqZWN0fSBQb29sZWRSdW5uZXJGYWlsdXJlXG4gKiBAcHJvcGVydHkge1Bvb2xlZFJ1bm5lckFjdGl2ZUpvYltdfSBhY3RpdmVKb2JzIC0gSm9icyB0aGF0IHdlcmUgaW4gZmxpZ2h0IHdoZW4gdGhlIGNoaWxkIGZhaWxlZCwgb3JkZXJlZCBieSBqb2IgaWQuXG4gKiBAcHJvcGVydHkge251bWJlciB8IG51bGx9IGV4aXRDb2RlIC0gQ2hpbGQgZXhpdCBjb2RlLCBvciBudWxsIGZvciBzaWduYWwvcHJvY2VzcyBlcnJvcnMuXG4gKiBAcHJvcGVydHkge3N0cmluZyB8IG51bGx9IGdlbmVyYXRpb25JZCAtIFJlbGVhc2UgZ2VuZXJhdGlvbiBpZGVudGl0eSwgb3IgbnVsbCBpbiBsZWdhY3kgbW9kZS5cbiAqIEBwcm9wZXJ0eSB7Ym9vbGVhbiB8IG51bGx9IG9vbUtpbGxlZCAtIEZhbHNlIHdoZW4gdGhlIG9ic2VydmVkIGV4aXQgcnVsZXMgT09NIG91dDsgbnVsbCB3aGVuIGFuIHVuZXhwZWN0ZWQgU0lHS0lMTCBjYW5ub3QgYmUgZGlzdGluZ3Vpc2hlZCBmcm9tIGFuIE9PTSBraWxsIHdpdGhvdXQgc3VwZXJ2aXNvci9rZXJuZWwgZXZpZGVuY2UuXG4gKiBAcHJvcGVydHkge1Bvb2xlZFJ1bm5lckZhaWx1cmVPcmlnaW59IG9yaWdpbiAtIFdvcmtlciBvYnNlcnZhdGlvbiB0aGF0IGluaXRpYXRlZCBmYWlsdXJlIGhhbmRsaW5nLlxuICogQHByb3BlcnR5IHtudW1iZXJ9IHJ1bm5lckFnZU1zIC0gQ2hpbGQgYWdlIHdoZW4gZmFpbHVyZSBoYW5kbGluZyBzdGFydGVkLlxuICogQHByb3BlcnR5IHtudW1iZXJ9IHJ1bm5lckNyZWF0ZWRBdE1zIC0gQ2hpbGQgY3JlYXRpb24gdGltZXN0YW1wLlxuICogQHByb3BlcnR5IHtib29sZWFufSBydW5uZXJEZXRhY2hlZCAtIFdoZXRoZXIgdGhlIHJ1bm5lciBvd25lZCBhIGRldGFjaGVkIHByb2Nlc3MgZ3JvdXAuXG4gKiBAcHJvcGVydHkge251bWJlcn0gcnVubmVySm9ic1J1biAtIFByZXZpb3VzbHkgYWNrbm93bGVkZ2VkIGpvYnMgaGFuZGxlZCBieSB0aGUgY2hpbGQuXG4gKiBAcHJvcGVydHkge1Bvb2xlZFJ1bm5lckxpZmVjeWNsZVN0YXRlfSBydW5uZXJMaWZlY3ljbGUgLSBDaGlsZCBsaWZlY3ljbGUgaW1tZWRpYXRlbHkgYmVmb3JlIHJlY292ZXJ5LlxuICogQHByb3BlcnR5IHtudW1iZXIgfCBudWxsfSBydW5uZXJQaWQgLSBDaGlsZCBwcm9jZXNzIGlkIHdoZW4gYXZhaWxhYmxlLlxuICogQHByb3BlcnR5IHtpbXBvcnQoXCJub2RlOmNoaWxkX3Byb2Nlc3NcIikuQ2hpbGRQcm9jZXNzW1wic2lnbmFsQ29kZVwiXX0gc2lnbmFsIC0gQ2hpbGQgdGVybWluYXRpb24gc2lnbmFsIHdoZW4gYXZhaWxhYmxlLlxuICogQHByb3BlcnR5IHtQb29sZWRSdW5uZXJUZXJtaW5hdGlvblJlYXNvbn0gdGVybWluYXRpb25SZWFzb24gLSBXaHkgdGhlIHdvcmtlciBleHBlY3RlZCBvciBkaWQgbm90IGV4cGVjdCB0ZXJtaW5hdGlvbi5cbiAqIEBwcm9wZXJ0eSB7c3RyaW5nIHwgbnVsbH0gdGltZW91dEpvYklkIC0gSm9iIHdob3NlIHRpbWVvdXQgaW5pdGlhdGVkIGNoaWxkIHRlcm1pbmF0aW9uLCBvciBudWxsLlxuICogQHByb3BlcnR5IHtzdHJpbmd9IHdvcmtlcklkIC0gU3RhYmxlIGdlbmVyYXRpb24tcXVhbGlmaWVkIHdvcmtlciBpZC5cbiAqIEBwcm9wZXJ0eSB7QmFja2dyb3VuZEpvYnNXb3JrZXJMaWZlY3ljbGVTdGF0ZX0gd29ya2VyTGlmZWN5Y2xlIC0gUGFyZW50IHdvcmtlciBsaWZlY3ljbGUgaW1tZWRpYXRlbHkgYmVmb3JlIHJlY292ZXJ5LlxuICogQHByb3BlcnR5IHtudW1iZXJ9IHdvcmtlclBpZCAtIFBhcmVudCB3b3JrZXIgcHJvY2VzcyBpZC5cbiAqL1xuLyoqXG4gKiBAdHlwZWRlZiB7b2JqZWN0fSBMb2NhbEJhY2tncm91bmRKb2JzQ2xvY2tcbiAqIEBwcm9wZXJ0eSB7KCkgPT4gbnVtYmVyfSBub3cgLSBDdXJyZW50IGVwb2NoIG1pbGxpc2Vjb25kcy5cbiAqIEBwcm9wZXJ0eSB7KGNhbGxiYWNrOiAoKSA9PiB2b2lkLCBkZWxheU1zOiBudW1iZXIpID0+IFJldHVyblR5cGU8dHlwZW9mIHNldFRpbWVvdXQ+IHwgbnVtYmVyfSBzZXRUaW1lb3V0IC0gQXJtcyBhIHRpbWVyLlxuICogQHByb3BlcnR5IHsodGltZXJJZDogUmV0dXJuVHlwZTx0eXBlb2Ygc2V0VGltZW91dD4gfCBudW1iZXIpID0+IHZvaWR9IGNsZWFyVGltZW91dCAtIENsZWFycyBhIHRpbWVyLlxuICovXG4vKipcbiAqIEB0eXBlZGVmIHtvYmplY3R9IFJlc29sdmVkQmFja2dyb3VuZEpvYkNvbmN1cnJlbmN5XG4gKiBAcHJvcGVydHkge3N0cmluZ30gY29uY3VycmVuY3lLZXkgLSBEdXJhYmxlIGNhcCBpZGVudGl0eS5cbiAqIEBwcm9wZXJ0eSB7bnVtYmVyfSBtYXhDb25jdXJyZW5jeSAtIFBvc2l0aXZlIGNhcC5cbiAqIEBwcm9wZXJ0eSB7Ym9vbGVhbn0gcXVldWVEZXJpdmVkIC0gV2hldGhlciBxdWV1ZSBjb25maWd1cmF0aW9uIG93bnMgdGhlIGNhcC5cbiAqL1xuLyoqXG4gKiBAdHlwZWRlZiB7b2JqZWN0fSBCYWNrZ3JvdW5kSm9iQ29uY3VycmVuY3lSZXBhaXJcbiAqIEBwcm9wZXJ0eSB7bnVtYmVyfSBhY3RpdmVDb3VudCAtIEV4YWN0IGhhbmRlZC1vZmYgam9iIGNvdW50IHBlcnNpc3RlZCBieSB0aGUgcmVwYWlyLlxuICogQHByb3BlcnR5IHtzdHJpbmd9IGNvbmN1cnJlbmN5S2V5IC0gRHVyYWJsZSBjYXAgaWRlbnRpdHkuXG4gKiBAcHJvcGVydHkge251bWJlcn0gcHJldmlvdXNBY3RpdmVDb3VudCAtIFBlcnNpc3RlZCBjb3VudCByZXBsYWNlZCBieSB0aGUgcmVwYWlyLlxuICovXG4vKipcbiAqIEB0eXBlZGVmIHtvYmplY3R9IEJhY2tncm91bmRKb2JDb25jdXJyZW5jeVJlY29uY2lsaWF0aW9uXG4gKiBAcHJvcGVydHkge251bWJlcn0gY2FuZGlkYXRlQ291bnQgLSBTbmFwc2hvdCBtaXNtYXRjaGVzIHJlY2hlY2tlZCB1bmRlciB0aGVpciBjb3VudGVyIGxvY2tzLlxuICogQHByb3BlcnR5IHtudW1iZXJ9IGNoZWNrZWRDb3VudCAtIEFjdGl2ZSBvciBub256ZXJvIGR1cmFibGUgY291bnRlcnMgY29tcGFyZWQgaW4gdGhlIGluaXRpYWwgc25hcHNob3QuXG4gKiBAcHJvcGVydHkge251bWJlcn0gcmVwYWlyZWRDb3VudCAtIENvdW50ZXJzIHdob3NlIHBlcnNpc3RlZCB2YWx1ZXMgd2VyZSBjaGFuZ2VkLlxuICogQHByb3BlcnR5IHtCYWNrZ3JvdW5kSm9iQ29uY3VycmVuY3lSZXBhaXJbXX0gcmVwYWlycyAtIEJvdW5kZWQgZGV0ZXJtaW5pc3RpYyBzYW1wbGUgb2YgYXBwbGllZCByZXBhaXJzLlxuICogQHByb3BlcnR5IHtudW1iZXJ9IHJlcGFpcnNUcnVuY2F0ZWRDb3VudCAtIEFwcGxpZWQgcmVwYWlycyBvbWl0dGVkIGZyb20gdGhlIHNhbXBsZS5cbiAqL1xuLyoqXG4gKiBAdHlwZWRlZiB7b2JqZWN0fSBQcmVwYXJlZExvY2FsQmFja2dyb3VuZEpvYlxuICogQHByb3BlcnR5IHtzdHJpbmd9IGFyZ3NEaWdlc3QgLSBGaXhlZC13aWR0aCBkaWdlc3Qgb2YgdGhlIHNlcmlhbGl6ZWQgYXJndW1lbnRzLlxuICogQHByb3BlcnR5IHtzdHJpbmd9IGFyZ3NKc29uIC0gU2VyaWFsaXplZCBhcmd1bWVudHMuXG4gKiBAcHJvcGVydHkge1Jlc29sdmVkQmFja2dyb3VuZEpvYkNvbmN1cnJlbmN5IHwgbnVsbH0gY29uY3VycmVuY3kgLSBSZXNvbHZlZCBjb25jdXJyZW5jeS5cbiAqIEBwcm9wZXJ0eSB7bnVtYmVyfSBjcmVhdGVkQXRNcyAtIENyZWF0aW9uIHRpbWVzdGFtcC5cbiAqIEBwcm9wZXJ0eSB7XCJpbmxpbmVcIn0gZXhlY3V0aW9uTW9kZSAtIExvY2FsIGluLXByb2Nlc3MgZXhlY3V0aW9uIG1vZGUuXG4gKiBAcHJvcGVydHkge3N0cmluZ30gam9iSWQgLSBEdXJhYmxlIGlkLlxuICogQHByb3BlcnR5IHtzdHJpbmd9IGpvYk5hbWUgLSBSZWdpc3RlcmVkIG5hbWUuXG4gKiBAcHJvcGVydHkge251bWJlcn0gbWF4UmV0cmllcyAtIFJldHJ5IGNhcC5cbiAqIEBwcm9wZXJ0eSB7c3RyaW5nfSBxdWV1ZSAtIFF1ZXVlIG5hbWUuXG4gKiBAcHJvcGVydHkge251bWJlcn0gc2NoZWR1bGVkQXRNcyAtIEVsaWdpYmlsaXR5IHRpbWVzdGFtcC5cbiAqL1xuLyoqXG4gKiBAdHlwZWRlZiB7b2JqZWN0fSBCYWNrZ3JvdW5kSm9ic0hlYWx0aFxuICogQHByb3BlcnR5IHtib29sZWFufSByZWFkeSAtIFdoZXRoZXIgdGhlIGFkYXB0ZXIgY2FuIGFjY2VwdCBhbmQgcHJvY2VzcyB3b3JrLlxuICovXG4vKipcbiAqIEB0eXBlZGVmIHtvYmplY3R9IEJhY2tncm91bmRKb2JzUHJvZHVjZXJcbiAqIEBwcm9wZXJ0eSB7KGFyZ3M6IHtqb2JOYW1lOiBzdHJpbmcsIGFyZ3M6IEFycmF5PFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Piwgb3B0aW9ucz86IEJhY2tncm91bmRKb2JPcHRpb25zLCBwcm9kdWNlckludm9jYXRpb25JZD86IHN0cmluZywgcHJvZHVjZXJQcm9vZj86IEJhY2tncm91bmRKb2JQcm9kdWNlclByb29mfSkgPT4gUHJvbWlzZTxzdHJpbmc+fSBlbnF1ZXVlIC0gRW5xdWV1ZXMgYSBqb2IuXG4gKiBAcHJvcGVydHkgeyhhcmdzOiB7c2NoZWR1bGVLZXk6IHN0cmluZywgam9iTmFtZTogc3RyaW5nLCBhcmdzOiBBcnJheTxSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj4sIG9wdGlvbnM/OiBCYWNrZ3JvdW5kSm9iT3B0aW9uc30pID0+IFByb21pc2U8QmFja2dyb3VuZEpvYlJlcGxhY2VtZW50UmVzdWx0Pn0gcmVwbGFjZVNjaGVkdWxlZCAtIFJlcGxhY2VzIGEgc3RhYmxlIHNjaGVkdWxlLlxuICogQHByb3BlcnR5IHsoYXJnczoge3NjaGVkdWxlS2V5OiBzdHJpbmd9KSA9PiBQcm9taXNlPEJhY2tncm91bmRKb2JDYW5jZWxsYXRpb25SZXN1bHQ+fSBjYW5jZWxTY2hlZHVsZWQgLSBDYW5jZWxzIGEgc3RhYmxlIHNjaGVkdWxlLlxuICogQHByb3BlcnR5IHsoYXJnczoge3NjaGVkdWxlS2V5OiBzdHJpbmcsIGluY2x1ZGVMYXRlc3RUZXJtaW5hbD86IGJvb2xlYW59KSA9PiBQcm9taXNlPEJhY2tncm91bmRKb2JTY2hlZHVsZWRMb29rdXBSZXN1bHQ+fSBnZXRTY2hlZHVsZWRKb2IgLSBSZWFkcyBzdGFibGUgc2NoZWR1bGUgb3duZXJzaGlwIGFuZCBoaXN0b3J5LlxuICogQHByb3BlcnR5IHsoYXJnczoge3NjaGVkdWxlS2V5OiBzdHJpbmd9KSA9PiBQcm9taXNlPEJhY2tncm91bmRKb2JXYWtlUmVzdWx0Pn0gd2FrZVNjaGVkdWxlZCAtIEV4cGVkaXRlcyBhIHN0YWJsZSBzY2hlZHVsZSBvd25lci5cbiAqL1xuLyoqXG4gKiBAdHlwZWRlZiB7b2JqZWN0fSBCYWNrZ3JvdW5kSm9iSGFuZG9mZlxuICogQHByb3BlcnR5IHtzdHJpbmd9IGhhbmRvZmZJZCAtIFVuaXF1ZSBoYW5kb2ZmIGxlYXNlIGlkLlxuICogQHByb3BlcnR5IHtudW1iZXJ9IGhhbmRlZE9mZkF0TXMgLSBUaW1lIGhhbmRlZCB0byBhIHdvcmtlciBpbiBtcy5cbiAqIEBwcm9wZXJ0eSB7QmFja2dyb3VuZEpvYlJvd30gW2pvYl0gLSBFeGFjdCBjb21taXR0ZWQgam9iIHNuYXBzaG90IHdoZW4gdGhlIGFkYXB0ZXIgY2hhbmdlcyBkaXNwYXRjaCBkYXRhIGR1cmluZyB0aGUgY2xhaW0uXG4gKi9cbi8qKlxuICogQHR5cGVkZWYge29iamVjdH0gQmFja2dyb3VuZEpvYkhhbmRvZmZTbmFwc2hvdFxuICogQHByb3BlcnR5IHtzdHJpbmd9IGpvYklkIC0gSm9iIGhvbGRpbmcgdGhlIGxlYXNlLlxuICogQHByb3BlcnR5IHtzdHJpbmd9IGhhbmRvZmZJZCAtIEV4YWN0IGR1cmFibGUgbGVhc2UgaWQuXG4gKiBAcHJvcGVydHkge3N0cmluZ30gd29ya2VySWQgLSBTdGFibGUgd29ya2VyIGlkIHRoYXQgcmVjZWl2ZWQgdGhlIGxlYXNlLlxuICogQHByb3BlcnR5IHtudW1iZXJ9IGhhbmRlZE9mZkF0TXMgLSBUaW1lIGhhbmRlZCB0byB0aGUgd29ya2VyIGluIG1zLlxuICovXG4vKipcbiAqIEB0eXBlZGVmIHtvYmplY3R9IEJhY2tncm91bmRKb2JIYW5kb2ZmUmVxdWVzdFxuICogQHByb3BlcnR5IHtzdHJpbmd9IGpvYklkIC0gSm9iIHRvIGNsYWltLlxuICogQHByb3BlcnR5IHtzdHJpbmd9IFtoYW5kb2ZmSWRdIC0gRXhhY3QgY2FsbGVyLXNlbGVjdGVkIGxlYXNlIGlkLiBBZGFwdGVycyBtdXN0IHBlcnNpc3QgYW5kIHJldHVybiB0aGlzIGlkIHdoZW4gc3VwcGxpZWQ7IGJ1aWx0LWluIGFkYXB0ZXJzIGdlbmVyYXRlIG9uZSB3aGVuIG9taXR0ZWQgZm9yIGxlZ2FjeSBkaXJlY3QgY2FsbGVycy5cbiAqIEBwcm9wZXJ0eSB7c3RyaW5nfSBbd29ya2VySWRdIC0gV29ya2VyIGNsYWltaW5nIHRoZSBqb2IuXG4gKi9cbi8qKlxuICogQHR5cGVkZWYge29iamVjdH0gQmFja2dyb3VuZEpvYk9wdGlvbnNcbiAqIEBwcm9wZXJ0eSB7QmFja2dyb3VuZEpvYkV4ZWN1dGlvbk1vZGV9IFtleGVjdXRpb25Nb2RlXSAtIEhvdyB0aGUgam9iIHNob3VsZCBydW4uIE5vZGUgZGVmYXVsdHMgdG8gYFwicG9vbGVkXCJgIChhIHdhcm0sIHJldXNlZCBsb2NhbCBydW5uZXIgcHJvY2VzcykuIEJyb3dzZXIvRXhwbyBsb2NhbCBkaXNwYXRjaCBkZWZhdWx0cyB0byBhbmQgb25seSBhY2NlcHRzIGBcImlubGluZVwiYC4gYFwiZm9ya2VkXCJgIHJ1bnMgYSBOb2RlIGpvYiBpbiBhIGZyZXNoIGBjaGlsZF9wcm9jZXNzLmZvcmsoKWAgY2hpbGQsIGFuZCBgXCJzcGF3bmVkXCJgIGluIGEgZGV0YWNoZWQgQ0xJIHJ1bm5lci5cbiAqIEBwcm9wZXJ0eSB7bnVtYmVyfSBbbWF4UmV0cmllc10gLSBNYXggcmV0cmllcyBmb3IgYSBmYWlsZWQgam9iIGJlZm9yZSBpdCBpcyBtYXJrZWQgZmFpbGVkLlxuICogQHByb3BlcnR5IHtzdHJpbmd9IFtxdWV1ZV0gLSBRdWV1ZSBuYW1lLiBEZWZhdWx0cyB0byBgXCJkZWZhdWx0XCJgLiBXaGVuIHRoZSBxdWV1ZSBoYXMgYSBjb25maWd1cmVkIGNhcCBpbiBgYmFja2dyb3VuZEpvYnMucXVldWVzYCwgdGhhdCBjYXAgaXMgZW5mb3JjZWQgY2x1c3Rlci13aWRlLlxuICogQHByb3BlcnR5IHtzdHJpbmd9IFtjb25jdXJyZW5jeUtleV0gLSBPcGFxdWUgbm9uLWVtcHR5IGtleSB1c2VkIHRvIHNoYXJlIGEgY29uY3VycmVuY3kgY2FwLiBPdmVycmlkZXMgYW55IHF1ZXVlLWRlcml2ZWQgY2FwLlxuICogQHByb3BlcnR5IHtudW1iZXJ9IFttYXhDb25jdXJyZW5jeV0gLSBQb3NpdGl2ZSBpbnRlZ2VyIGNhcDsgbXVzdCBiZSBwYWlyZWQgd2l0aCBgY29uY3VycmVuY3lLZXlgLlxuICogQHByb3BlcnR5IHtib29sZWFufSBbZGVkdXBsaWNhdGVXaGlsZVF1ZXVlZF0gLSBXaGVuIHRydWUsIHNraXAgdGhlIGVucXVldWUgaWYgYW4gaWRlbnRpY2FsIHN0aWxsLXF1ZXVlZCBqb2IgKHNhbWUgam9iIG5hbWUsIGFyZ3MgYW5kIHF1ZXVlKSBpcyBzY2hlZHVsZWQgbm8gbGF0ZXIgdGhhbiB0aGlzIGVucXVldWUsIHJldHVybmluZyB0aGUgZWFybGllc3QgbWF0Y2hpbmcgam9iJ3MgaWQuIEEgZnV0dXJlIHJldHJ5IGRvZXMgbm90IHN1cHByZXNzIGVhcmxpZXIgd29yay4gRGVkdXBsaWNhdGlvbiBpcyBpbmRlcGVuZGVudCBvZiBgY29uY3VycmVuY3lLZXlgLCBzbyB0aGUgam9iIGtlZXBzIGl0cyBub3JtYWwgKGUuZy4gcXVldWUtZGVyaXZlZCkgY29uY3VycmVuY3kgY2FwLiBLZWVwcyBhbiBpbnRlcnZhbC1zY2hlZHVsZWQgcmVjdXJyaW5nIGpvYiAoZS5nLiByZXRlbnRpb24gcHJ1bmluZykgZnJvbSBwaWxpbmcgdXAgcmVkdW5kYW50IHF1ZXVlZCByb3dzIHdoZW4gaXQgcnVucyBzbG93ZXIgdGhhbiBpdHMgaW50ZXJ2YWwgb3Igbm8gd29ya2VyIGlzIGZyZWUuXG4gKiBAcHJvcGVydHkge3N0cmluZ30gW2lkZW1wb3RlbmN5S2V5XSAtIER1cmFibGUgZW5xdWV1ZSBpZGVudGl0eSBzY29wZWQgdG8gdGhlIHJlc29sdmVkIGpvYiBjbGFzcyBuYW1lIGFuZCBxdWV1ZS4gRXhhY3QgcmVwbGF5IHJldHVybnMgdGhlIG9yaWdpbmFsIGpvYiBpZCBhY3Jvc3MgZXZlcnkgc3RhdGUgYW5kIGFmdGVyIGpvYiBwcnVuaW5nOyByZXVzZSB3aXRoIGRpZmZlcmVudCBjYW5vbmljYWwgYXJndW1lbnRzIG9yIGJlaGF2aW9yLWFmZmVjdGluZyBvcHRpb25zIGZhaWxzLiBPd25lcnNoaXAgaXMgaW5kZXBlbmRlbnQgb2YgYGRlZHVwbGljYXRlV2hpbGVRdWV1ZWRgIGFuZCBpcyByZXRhaW5lZCB1bnRpbCBhbiBleHBsaWNpdCBmdXR1cmUgcmV0ZW50aW9uIHBvbGljeSByZW1vdmVzIGl0LlxuICogQHByb3BlcnR5IHtudW1iZXJ9IFtzY2hlZHVsZWRBdE1zXSAtIEVwb2NoIHRpbWVzdGFtcCBpbiBtaWxsaXNlY29uZHMgd2hlbiB0aGUgam9iIGJlY29tZXMgZWxpZ2libGUgZm9yIGRpc3BhdGNoLiBEZWZhdWx0cyB0byBlbnF1ZXVlIHRpbWUuXG4gKiBAcHJvcGVydHkge251bWJlcn0gW3RpbWVvdXRNc10gLSBQZXItam9iIHdhbGwtY2xvY2sgdGltZW91dCBmb3IgZm9ya2VkIGFuZCBwb29sZWQgZXhlY3V0aW9uLiBBIHBvc2l0aXZlIGludGVnZXIgdXAgdG8gMiwxNDcsNDgzLDY0NyBvdmVycmlkZXMgdGhlIHdvcmtlci1sZXZlbCBgam9iVGltZW91dE1zYDsgYSBub24tcG9zaXRpdmUgZmluaXRlIHZhbHVlIGRpc2FibGVzIHRoZSB0aW1lb3V0IGZvciB0aGlzIGpvYi5cbiAqL1xuLyoqXG4gKiBAdHlwZWRlZiB7b2JqZWN0fSBCYWNrZ3JvdW5kSm9iUGF5bG9hZFxuICogQHByb3BlcnR5IHtzdHJpbmd9IFtpZF0gLSBKb2IgaWQuXG4gKiBAcHJvcGVydHkge3N0cmluZ30gam9iTmFtZSAtIEpvYiBjbGFzcyBuYW1lLlxuICogQHByb3BlcnR5IHtBcnJheTxSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59IFthcmdzXSAtIFNlcmlhbGl6ZWQgam9iIGFyZ3VtZW50cy5cbiAqIEBwcm9wZXJ0eSB7c3RyaW5nfSBbaGFuZG9mZklkXSAtIFVuaXF1ZSBoYW5kb2ZmIGxlYXNlIGlkLlxuICogQHByb3BlcnR5IHtzdHJpbmd9IFt3b3JrZXJJZF0gLSBXb3JrZXIgaWQgaGFuZGxpbmcgdGhlIGpvYi5cbiAqIEBwcm9wZXJ0eSB7bnVtYmVyfSBbaGFuZGVkT2ZmQXRNc10gLSBUaW1lIGhhbmRlZCB0byBhIHdvcmtlciBpbiBtcy5cbiAqIEBwcm9wZXJ0eSB7QmFja2dyb3VuZEpvYk9wdGlvbnN9IFtvcHRpb25zXSAtIFJ1bnRpbWUgb3B0aW9ucy5cbiAqL1xuLyoqXG4gKiBAdHlwZWRlZiB7b2JqZWN0fSBCYWNrZ3JvdW5kSm9iQ29udGV4dFxuICogQHByb3BlcnR5IHt0eXBlb2YgaW1wb3J0KFwiLi9wbGF0Zm9ybS1qb2IuanNcIikuZGVmYXVsdH0gam9iQ2xhc3MgLSBDb25jcmV0ZSBqb2IgY2xhc3MuXG4gKiBAcHJvcGVydHkge3N0cmluZ30gam9iTmFtZSAtIFJlZ2lzdGVyZWQgam9iIG5hbWUuXG4gKiBAcHJvcGVydHkge0FycmF5PFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gYXJncyAtIFNlcmlhbGl6ZWQgam9iIGFyZ3VtZW50cy5cbiAqIEBwcm9wZXJ0eSB7QmFja2dyb3VuZEpvYk9wdGlvbnN9IG9wdGlvbnMgLSBSZXNvbHZlZCBlbnF1ZXVlL3J1bnRpbWUgb3B0aW9ucy5cbiAqIEBwcm9wZXJ0eSB7QmFja2dyb3VuZEpvYlBheWxvYWR9IFtwYXlsb2FkXSAtIENvbXBsZXRlIHBlcnNpc3RlZCBydW5uZXIgcGF5bG9hZCB3aGVuIHRoZSBqb2IgaXMgcGVyZm9ybWluZy5cbiAqL1xuLyoqXG4gKiBAdHlwZWRlZiB7b2JqZWN0fSBCYWNrZ3JvdW5kSm9iUm93XG4gKiBAcHJvcGVydHkge3N0cmluZ30gaWQgLSBKb2IgaWQuXG4gKiBAcHJvcGVydHkge3N0cmluZ30gam9iTmFtZSAtIEpvYiBjbGFzcyBuYW1lLlxuICogQHByb3BlcnR5IHtBcnJheTxSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59IGFyZ3MgLSBTZXJpYWxpemVkIGpvYiBhcmd1bWVudHMuXG4gKiBAcHJvcGVydHkge0JhY2tncm91bmRKb2JFeGVjdXRpb25Nb2RlfSBleGVjdXRpb25Nb2RlIC0gSG93IHRoZSBqb2Igc2hvdWxkIHJ1bi5cbiAqIEBwcm9wZXJ0eSB7c3RyaW5nfSBxdWV1ZSAtIFF1ZXVlIG5hbWUgKGRlZmF1bHRzIHRvIGBcImRlZmF1bHRcImApLlxuICogQHByb3BlcnR5IHtzdHJpbmcgfCBudWxsfSBzY2hlZHVsZUtleSAtIFN0YWJsZSBsb2dpY2FsIHNjaGVkdWxlIGtleSByZXRhaW5lZCBmb3IgaGlzdG9yeS5cbiAqIEBwcm9wZXJ0eSB7bnVtYmVyIHwgbnVsbH0gc2NoZWR1bGVPcmRlciAtIFRyYW5zYWN0aW9uLWFzc2lnbmVkIG1vbm90b25pYyBvd25lcnNoaXAgb3JkZXIgZm9yIHRoaXMgc2NoZWR1bGUga2V5OyBOb2RlIHByZXNlcnZlcyBpdHMgaGlnaC13YXRlciBtYXJrIGFjcm9zcyB0ZXJtaW5hbC1oaXN0b3J5IHBydW5pbmcuIE51bGwgZm9yIGxlZ2FjeS9ub24tc2NoZWR1bGVkIHJvd3MuXG4gKiBAcHJvcGVydHkge0JhY2tncm91bmRKb2JTdGF0dXN9IHN0YXR1cyAtIEN1cnJlbnQgam9iIHN0YXR1cy5cbiAqIEBwcm9wZXJ0eSB7bnVtYmVyIHwgbnVsbH0gYXR0ZW1wdHMgLSBGYWlsdXJlIGF0dGVtcHRzIGNvdW50LlxuICogQHByb3BlcnR5IHtudW1iZXIgfCBudWxsfSBtYXhSZXRyaWVzIC0gTWF4IHJldHJ5IGF0dGVtcHRzLlxuICogQHByb3BlcnR5IHtudW1iZXIgfCBudWxsfSBzY2hlZHVsZWRBdE1zIC0gTmV4dCBzY2hlZHVsZWQgdGltZSBpbiBtcy5cbiAqIEBwcm9wZXJ0eSB7bnVtYmVyIHwgbnVsbH0gY3JlYXRlZEF0TXMgLSBDcmVhdGlvbiB0aW1lIGluIG1zLlxuICogQHByb3BlcnR5IHtudW1iZXIgfCBudWxsfSBoYW5kZWRPZmZBdE1zIC0gVGltZSBoYW5kZWQgdG8gd29ya2VyIGluIG1zLlxuICogQHByb3BlcnR5IHtzdHJpbmcgfCBudWxsfSBoYW5kb2ZmSWQgLSBVbmlxdWUgbGF0ZXN0IGhhbmRvZmYgbGVhc2UgaWQuXG4gKiBAcHJvcGVydHkge251bWJlciB8IG51bGx9IGNvbXBsZXRlZEF0TXMgLSBDb21wbGV0aW9uIHRpbWUgaW4gbXMuXG4gKiBAcHJvcGVydHkge251bWJlciB8IG51bGx9IGZhaWxlZEF0TXMgLSBGYWlsdXJlIHRpbWUgaW4gbXMuXG4gKiBAcHJvcGVydHkge251bWJlciB8IG51bGx9IG9ycGhhbmVkQXRNcyAtIE9ycGhhbmVkIHRpbWUgaW4gbXMuXG4gKiBAcHJvcGVydHkge3N0cmluZyB8IG51bGx9IHdvcmtlcklkIC0gV29ya2VyIGlkIGhhbmRsaW5nIHRoZSBqb2IuXG4gKiBAcHJvcGVydHkge3N0cmluZyB8IG51bGx9IGxhc3RFcnJvciAtIExhc3QgZmFpbHVyZSBtZXNzYWdlLlxuICogQHByb3BlcnR5IHtzdHJpbmcgfCBudWxsfSBjb25jdXJyZW5jeUtleSAtIER1cmFibGUgY29uY3VycmVuY3kga2V5LlxuICogQHByb3BlcnR5IHtudW1iZXIgfCBudWxsfSBtYXhDb25jdXJyZW5jeSAtIER1cmFibGUgcGVyLWtleSBjYXAuXG4gKiBAcHJvcGVydHkge251bWJlciB8IG51bGx9IHRpbWVvdXRNcyAtIFBlci1qb2Igd2FsbC1jbG9jayB0aW1lb3V0IG92ZXJyaWRlLCBvciBudWxsIHdoZW4gb21pdHRlZC5cbiAqIEBwcm9wZXJ0eSB7bnVtYmVyIHwgbnVsbH0gY2hpbGRSZWNlaXZlZEF0TXMgLSBFcG9jaCBtcyB3aGVuIHRoZSBleGVjdXRpbmcgcG9vbGVkIGNoaWxkJ3MgZXZlbnQgbG9vcCBwcm9jZXNzZWQgdGhlIGpvYiBtZXNzYWdlLCBvciBudWxsIHdoZW4gbm8gcnVubmVyIGFjY2VwdGVkIGl0IHlldC5cbiAqIEBwcm9wZXJ0eSB7bnVtYmVyIHwgbnVsbH0gY2hpbGRTdGFydGVkQXRNcyAtIEVwb2NoIG1zIHdoZW4gdGhlIGpvYidzIHBlcmZvcm0gc3RhcnRlZCBpbiB0aGUgcG9vbGVkIGNoaWxkLCBvciBudWxsIHdoZW4gaXQgbmV2ZXIgc3RhcnRlZC5cbiAqIEBwcm9wZXJ0eSB7c3RyaW5nIHwgbnVsbH0gY2hpbGRJbnN0YW5jZUlkIC0gU3RhYmxlIGlkZW50aXR5IG9mIHRoZSBwb29sZWQgY2hpbGQgcHJvY2VzcyB0aGF0IGFjY2VwdGVkIHRoZSBqb2IsIG9yIG51bGwuXG4gKiBAcHJvcGVydHkge251bWJlciB8IG51bGx9IGNoaWxkUGlkIC0gT1MgcGlkIG9mIHRoZSBwb29sZWQgY2hpbGQgcHJvY2VzcyB0aGF0IGFjY2VwdGVkIHRoZSBqb2IsIG9yIG51bGwuXG4gKi9cbi8qKlxuICogQHR5cGVkZWYge1wicXVldWVkXCIgfCBcImhhbmRlZF9vZmZcIiB8IG51bGx9IEJhY2tncm91bmRKb2JSZXBsYWNlbWVudFByZXZpb3VzU3RhdHVzXG4gKi9cbi8qKlxuICogQHR5cGVkZWYge29iamVjdH0gQmFja2dyb3VuZEpvYlJlcGxhY2VtZW50UmVzdWx0XG4gKiBAcHJvcGVydHkge3N0cmluZ30gam9iSWQgLSBOZXdseSBxdWV1ZWQgam9iIGlkLlxuICogQHByb3BlcnR5IHtzdHJpbmcgfCBudWxsfSBwcmV2aW91c0pvYklkIC0gUHJldmlvdXMgYWN0aXZlIG93bmVyJ3Mgam9iIGlkLlxuICogQHByb3BlcnR5IHtCYWNrZ3JvdW5kSm9iUmVwbGFjZW1lbnRQcmV2aW91c1N0YXR1c30gcHJldmlvdXNTdGF0dXMgLSBQcmV2aW91cyBvd25lcidzIG9ic2VydmVkIHN0YXRlLlxuICovXG4vKipcbiAqIEB0eXBlZGVmIHtcImNhbmNlbGxlZFwiIHwgXCJoYW5kZWRfb2ZmXCIgfCBcIm5vdF9mb3VuZFwifSBCYWNrZ3JvdW5kSm9iQ2FuY2VsbGF0aW9uT3V0Y29tZVxuICovXG4vKipcbiAqIEB0eXBlZGVmIHtvYmplY3R9IEJhY2tncm91bmRKb2JDYW5jZWxsYXRpb25SZXN1bHRcbiAqIEBwcm9wZXJ0eSB7c3RyaW5nIHwgbnVsbH0gam9iSWQgLSBEZXRhY2hlZCBvd25lcidzIGpvYiBpZCwgd2hlbiBvbmUgd2FzIGFjdGl2ZS5cbiAqIEBwcm9wZXJ0eSB7QmFja2dyb3VuZEpvYkNhbmNlbGxhdGlvbk91dGNvbWV9IG91dGNvbWUgLSBUcnV0aGZ1bCBiZXN0LWVmZm9ydCBvdXRjb21lLlxuICovXG4vKipcbiAqIEB0eXBlZGVmIHtvYmplY3R9IEJhY2tncm91bmRKb2JTY2hlZHVsZWRMb29rdXBSZXN1bHRcbiAqIEBwcm9wZXJ0eSB7QmFja2dyb3VuZEpvYlJvdyB8IG51bGx9IGN1cnJlbnRKb2IgLSBDdXJyZW50IHF1ZXVlZCBvciBoYW5kZWQtb2ZmIG93bmVyLlxuICogQHByb3BlcnR5IHtCYWNrZ3JvdW5kSm9iUm93IHwgbnVsbH0gbGF0ZXN0VGVybWluYWxKb2IgLSBMYXRlc3QgdGVybWluYWwgaGlzdG9yeSB3aGVuIHJlcXVlc3RlZC5cbiAqL1xuLyoqXG4gKiBAdHlwZWRlZiB7XCJ3b2tlblwiIHwgXCJhbHJlYWR5X2R1ZVwiIHwgXCJoYW5kZWRfb2ZmXCIgfCBcIm5vdF9mb3VuZFwifSBCYWNrZ3JvdW5kSm9iV2FrZU91dGNvbWVcbiAqL1xuLyoqXG4gKiBAdHlwZWRlZiB7b2JqZWN0fSBCYWNrZ3JvdW5kSm9iV2FrZVJlc3VsdFxuICogQHByb3BlcnR5IHtzdHJpbmcgfCBudWxsfSBqb2JJZCAtIEN1cnJlbnQgb3duZXIncyBkdXJhYmxlIGpvYiBpZCwgd2hlbiBmb3VuZC5cbiAqIEBwcm9wZXJ0eSB7QmFja2dyb3VuZEpvYldha2VPdXRjb21lfSBvdXRjb21lIC0gRXhhY3Qgd2FrZSBvdXRjb21lLlxuICovXG4vKipcbiAqIEB0eXBlZGVmIHtvYmplY3R9IEJhY2tncm91bmRKb2JGYWlsdXJlRXZlbnRcbiAqIEBwcm9wZXJ0eSB7QmFja2dyb3VuZEpvYlJvd30gam9iIC0gVXBkYXRlZCBqb2Igcm93IGFmdGVyIGZhaWx1cmUgaGFuZGxpbmcuXG4gKiBAcHJvcGVydHkge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSBlcnJvciAtIEZhaWx1cmUgZXJyb3IuXG4gKiBAcHJvcGVydHkge251bWJlciB8IG51bGx9IGF0dGVtcHRzIC0gVXBkYXRlZCBmYWlsdXJlIGF0dGVtcHRzIGNvdW50LlxuICogQHByb3BlcnR5IHtib29sZWFufSB0ZXJtaW5hbCAtIFdoZXRoZXIgdGhpcyBmYWlsdXJlIGVuZGVkIHRoZSBqb2IuXG4gKiBAcHJvcGVydHkge2Jvb2xlYW59IHdpbGxSZXRyeSAtIFdoZXRoZXIgdGhlIGpvYiB3YXMgcmV0dXJuZWQgdG8gdGhlIHF1ZXVlLlxuICogQHByb3BlcnR5IHtzdHJpbmcgfCB1bmRlZmluZWR9IGhhbmRvZmZJZCAtIEhhbmRvZmYgbGVhc2UgaWQgZnJvbSB0aGUgd29ya2VyIHJlcG9ydC5cbiAqIEBwcm9wZXJ0eSB7bnVtYmVyIHwgdW5kZWZpbmVkfSBoYW5kZWRPZmZBdE1zIC0gSGFuZG9mZiB0aW1lc3RhbXAgZnJvbSB0aGUgd29ya2VyIHJlcG9ydC5cbiAqIEBwcm9wZXJ0eSB7c3RyaW5nIHwgdW5kZWZpbmVkfSB3b3JrZXJJZCAtIFdvcmtlciBpZCBmcm9tIHRoZSB3b3JrZXIgcmVwb3J0LlxuICogQHByb3BlcnR5IHtQb29sZWRSdW5uZXJGYWlsdXJlIHwgdW5kZWZpbmVkfSBydW5uZXJGYWlsdXJlIC0gU2hhcmVkIHBvb2xlZC1jaGlsZCBwcm9jZXNzIGZhaWx1cmUgcHJvdmVuYW5jZS5cbiAqL1xuLyoqXG4gKiBAdHlwZWRlZiB7XCJ3b3JrZXJcIiB8IFwiY2xpZW50XCIgfCBcInJlcG9ydGVyXCJ9IEJhY2tncm91bmRKb2JTb2NrZXRSb2xlXG4gKi9cbi8qKlxuICogQHR5cGVkZWYge3t0eXBlOiBcImhlbGxvXCIsIHJvbGU6IEJhY2tncm91bmRKb2JTb2NrZXRSb2xlLCBnZW5lcmF0aW9uSWQ/OiBzdHJpbmcsIHN1cHBvcnRzSGFuZG9mZklkUmVwb3J0aW5nPzogYm9vbGVhbiwgc3VwcG9ydHNIZWFydGJlYXQ/OiBib29sZWFuLCBzdXBwb3J0c1Bvb2xlZD86IGJvb2xlYW4sIHdvcmtlcklkPzogc3RyaW5nfX0gQmFja2dyb3VuZEpvYkhlbGxvTWVzc2FnZVxuICogQHR5cGVkZWYge3t0eXBlOiBcImdlbmVyYXRpb24tYWNjZXB0ZWRcIiwgZ2VuZXJhdGlvbklkOiBzdHJpbmcsIGxpZmVjeWNsZVN0YXRlOiBCYWNrZ3JvdW5kSm9ic0dlbmVyYXRpb25MaWZlY3ljbGVTdGF0ZX19IEJhY2tncm91bmRKb2JHZW5lcmF0aW9uQWNjZXB0ZWRNZXNzYWdlXG4gKiBAdHlwZWRlZiB7e3R5cGU6IFwiZ2VuZXJhdGlvbi1yZWplY3RlZFwiLCByZWFzb246IEJhY2tncm91bmRKb2JzR2VuZXJhdGlvblJlamVjdGlvblJlYXNvbn19IEJhY2tncm91bmRKb2JHZW5lcmF0aW9uUmVqZWN0ZWRNZXNzYWdlXG4gKiBAdHlwZWRlZiB7e3R5cGU6IFwicmVhZHlcIiwgYWNjZXB0c0ZvcmtlZD86IGJvb2xlYW4sIGFjY2VwdHNJbmxpbmU/OiBib29sZWFuLCBhY2NlcHRzUG9vbGVkPzogYm9vbGVhbiwgYWNjZXB0c1NwYXduZWQ/OiBib29sZWFuLCBhdmFpbGFibGVQb29sZWRTbG90cz86IG51bWJlcn19IEJhY2tncm91bmRKb2JSZWFkeU1lc3NhZ2VcbiAqIEB0eXBlZGVmIHt7dHlwZTogXCJkcmFpbmluZ1wifX0gQmFja2dyb3VuZEpvYkRyYWluaW5nTWVzc2FnZVxuICogQHR5cGVkZWYge3t0eXBlOiBcImhlYXJ0YmVhdFwiLCB3b3JrZXJJZD86IHN0cmluZ319IEJhY2tncm91bmRKb2JIZWFydGJlYXRNZXNzYWdlXG4gKiBAdHlwZWRlZiB7e3R5cGU6IFwiZW5xdWV1ZVwiLCBqb2JOYW1lOiBzdHJpbmcsIGFyZ3M/OiBBcnJheTxSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj4sIG9wdGlvbnM/OiBCYWNrZ3JvdW5kSm9iT3B0aW9ucywgcHJvZHVjZXJJbnZvY2F0aW9uSWQ/OiBzdHJpbmcsIHByb2R1Y2VyUHJvb2Y/OiBCYWNrZ3JvdW5kSm9iUHJvZHVjZXJQcm9vZn19IEJhY2tncm91bmRKb2JFbnF1ZXVlTWVzc2FnZVxuICogQHR5cGVkZWYge3t0eXBlOiBcImVucXVldWVkXCIsIGpvYklkOiBzdHJpbmd9fSBCYWNrZ3JvdW5kSm9iRW5xdWV1ZWRNZXNzYWdlXG4gKiBAdHlwZWRlZiB7e3R5cGU6IFwiZW5xdWV1ZS1lcnJvclwiLCBlcnJvcj86IHN0cmluZ319IEJhY2tncm91bmRKb2JFbnF1ZXVlRXJyb3JNZXNzYWdlXG4gKiBAdHlwZWRlZiB7e3R5cGU6IFwicmVwbGFjZS1zY2hlZHVsZWRcIiwgc2NoZWR1bGVLZXk6IHN0cmluZywgam9iTmFtZTogc3RyaW5nLCBhcmdzPzogQXJyYXk8UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+LCBvcHRpb25zPzogQmFja2dyb3VuZEpvYk9wdGlvbnN9fSBCYWNrZ3JvdW5kSm9iUmVwbGFjZVNjaGVkdWxlZE1lc3NhZ2VcbiAqIEB0eXBlZGVmIHt7dHlwZTogXCJzY2hlZHVsZS1yZXBsYWNlZFwiLCBqb2JJZDogc3RyaW5nLCBwcmV2aW91c0pvYklkOiBzdHJpbmcgfCBudWxsLCBwcmV2aW91c1N0YXR1czogQmFja2dyb3VuZEpvYlJlcGxhY2VtZW50UHJldmlvdXNTdGF0dXN9fSBCYWNrZ3JvdW5kSm9iU2NoZWR1bGVSZXBsYWNlZE1lc3NhZ2VcbiAqIEB0eXBlZGVmIHt7dHlwZTogXCJyZXBsYWNlLXNjaGVkdWxlZC1lcnJvclwiLCBlcnJvcj86IHN0cmluZ319IEJhY2tncm91bmRKb2JSZXBsYWNlU2NoZWR1bGVkRXJyb3JNZXNzYWdlXG4gKiBAdHlwZWRlZiB7e3R5cGU6IFwiY2FuY2VsLXNjaGVkdWxlZFwiLCBzY2hlZHVsZUtleTogc3RyaW5nfX0gQmFja2dyb3VuZEpvYkNhbmNlbFNjaGVkdWxlZE1lc3NhZ2VcbiAqIEB0eXBlZGVmIHt7dHlwZTogXCJzY2hlZHVsZS1jYW5jZWxsZWRcIiwgam9iSWQ6IHN0cmluZyB8IG51bGwsIG91dGNvbWU6IEJhY2tncm91bmRKb2JDYW5jZWxsYXRpb25PdXRjb21lfX0gQmFja2dyb3VuZEpvYlNjaGVkdWxlQ2FuY2VsbGVkTWVzc2FnZVxuICogQHR5cGVkZWYge3t0eXBlOiBcImNhbmNlbC1zY2hlZHVsZWQtZXJyb3JcIiwgZXJyb3I/OiBzdHJpbmd9fSBCYWNrZ3JvdW5kSm9iQ2FuY2VsU2NoZWR1bGVkRXJyb3JNZXNzYWdlXG4gKiBAdHlwZWRlZiB7e3R5cGU6IFwiZ2V0LXNjaGVkdWxlZC1qb2JcIiwgc2NoZWR1bGVLZXk6IHN0cmluZywgaW5jbHVkZUxhdGVzdFRlcm1pbmFsPzogYm9vbGVhbn19IEJhY2tncm91bmRKb2JHZXRTY2hlZHVsZWRNZXNzYWdlXG4gKiBAdHlwZWRlZiB7e3R5cGU6IFwic2NoZWR1bGVkLWpvYlwiLCBjdXJyZW50Sm9iOiBCYWNrZ3JvdW5kSm9iUm93IHwgbnVsbCwgbGF0ZXN0VGVybWluYWxKb2I6IEJhY2tncm91bmRKb2JSb3cgfCBudWxsfX0gQmFja2dyb3VuZEpvYlNjaGVkdWxlZE1lc3NhZ2VcbiAqIEB0eXBlZGVmIHt7dHlwZTogXCJnZXQtc2NoZWR1bGVkLWpvYi1lcnJvclwiLCBlcnJvcj86IHN0cmluZ319IEJhY2tncm91bmRKb2JHZXRTY2hlZHVsZWRFcnJvck1lc3NhZ2VcbiAqIEB0eXBlZGVmIHt7dHlwZTogXCJ3YWtlLXNjaGVkdWxlZFwiLCBzY2hlZHVsZUtleTogc3RyaW5nfX0gQmFja2dyb3VuZEpvYldha2VTY2hlZHVsZWRNZXNzYWdlXG4gKiBAdHlwZWRlZiB7e3R5cGU6IFwic2NoZWR1bGUtd29rZW5cIiwgam9iSWQ6IHN0cmluZyB8IG51bGwsIG91dGNvbWU6IEJhY2tncm91bmRKb2JXYWtlT3V0Y29tZX19IEJhY2tncm91bmRKb2JTY2hlZHVsZVdva2VuTWVzc2FnZVxuICogQHR5cGVkZWYge3t0eXBlOiBcIndha2Utc2NoZWR1bGVkLWVycm9yXCIsIGVycm9yPzogc3RyaW5nfX0gQmFja2dyb3VuZEpvYldha2VTY2hlZHVsZWRFcnJvck1lc3NhZ2VcbiAqIEB0eXBlZGVmIHt7dHlwZTogXCJqb2JcIiwgcGF5bG9hZDogQmFja2dyb3VuZEpvYlBheWxvYWR9fSBCYWNrZ3JvdW5kSm9iSm9iTWVzc2FnZVxuICogQHR5cGVkZWYge3t0eXBlOiBcImpvYi1hY2NlcHRlZFwiLCBqb2JJZDogc3RyaW5nLCBoYW5kb2ZmSWQ/OiBzdHJpbmcsIHdvcmtlcklkPzogc3RyaW5nLCBoYW5kZWRPZmZBdE1zPzogbnVtYmVyLCByZWNlaXZlZEF0TXM/OiBudW1iZXIsIHN0YXJ0ZWRBdE1zPzogbnVtYmVyLCBjaGlsZEluc3RhbmNlSWQ/OiBzdHJpbmcsIGNoaWxkUGlkPzogbnVtYmVyfX0gQmFja2dyb3VuZEpvYkFjY2VwdGVkTWVzc2FnZVxuICogQHR5cGVkZWYge3t0eXBlOiBcImpvYi1jb21wbGV0ZVwiLCBqb2JJZDogc3RyaW5nLCBoYW5kb2ZmSWQ/OiBzdHJpbmcsIHdvcmtlcklkPzogc3RyaW5nLCBoYW5kZWRPZmZBdE1zPzogbnVtYmVyfX0gQmFja2dyb3VuZEpvYkNvbXBsZXRlTWVzc2FnZVxuICogQHR5cGVkZWYge3t0eXBlOiBcImpvYi1mYWlsZWRcIiwgam9iSWQ6IHN0cmluZywgZXJyb3I/OiBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPiwgaGFuZG9mZklkPzogc3RyaW5nLCB3b3JrZXJJZD86IHN0cmluZywgaGFuZGVkT2ZmQXRNcz86IG51bWJlciwgcnVubmVyRmFpbHVyZT86IFBvb2xlZFJ1bm5lckZhaWx1cmV9fSBCYWNrZ3JvdW5kSm9iRmFpbGVkTWVzc2FnZVxuICogQHR5cGVkZWYge3t0eXBlOiBcImpvYi1yZXNjaGVkdWxlXCIsIGpvYklkOiBzdHJpbmcsIGRlbGF5TXM6IG51bWJlciwgaGFuZG9mZklkPzogc3RyaW5nLCB3b3JrZXJJZD86IHN0cmluZywgaGFuZGVkT2ZmQXRNcz86IG51bWJlcn19IEJhY2tncm91bmRKb2JSZXNjaGVkdWxlTWVzc2FnZVxuICogQHR5cGVkZWYge3t0eXBlOiBcImpvYi11cGRhdGVkXCIsIGpvYklkOiBzdHJpbmd9fSBCYWNrZ3JvdW5kSm9iVXBkYXRlZE1lc3NhZ2VcbiAqIEB0eXBlZGVmIHt7dHlwZTogXCJqb2ItdXBkYXRlLWVycm9yXCIsIGpvYklkOiBzdHJpbmcsIGVycm9yPzogc3RyaW5nfX0gQmFja2dyb3VuZEpvYlVwZGF0ZUVycm9yTWVzc2FnZVxuICovXG4vKipcbiAqIEB0eXBlZGVmIHtCYWNrZ3JvdW5kSm9iSGVsbG9NZXNzYWdlIHwgQmFja2dyb3VuZEpvYkdlbmVyYXRpb25BY2NlcHRlZE1lc3NhZ2UgfCBCYWNrZ3JvdW5kSm9iR2VuZXJhdGlvblJlamVjdGVkTWVzc2FnZSB8IEJhY2tncm91bmRKb2JSZWFkeU1lc3NhZ2UgfCBCYWNrZ3JvdW5kSm9iRHJhaW5pbmdNZXNzYWdlIHwgQmFja2dyb3VuZEpvYkhlYXJ0YmVhdE1lc3NhZ2UgfCBCYWNrZ3JvdW5kSm9iRW5xdWV1ZU1lc3NhZ2UgfCBCYWNrZ3JvdW5kSm9iRW5xdWV1ZWRNZXNzYWdlIHwgQmFja2dyb3VuZEpvYkVucXVldWVFcnJvck1lc3NhZ2UgfCBCYWNrZ3JvdW5kSm9iUmVwbGFjZVNjaGVkdWxlZE1lc3NhZ2UgfCBCYWNrZ3JvdW5kSm9iU2NoZWR1bGVSZXBsYWNlZE1lc3NhZ2UgfCBCYWNrZ3JvdW5kSm9iUmVwbGFjZVNjaGVkdWxlZEVycm9yTWVzc2FnZSB8IEJhY2tncm91bmRKb2JDYW5jZWxTY2hlZHVsZWRNZXNzYWdlIHwgQmFja2dyb3VuZEpvYlNjaGVkdWxlQ2FuY2VsbGVkTWVzc2FnZSB8IEJhY2tncm91bmRKb2JDYW5jZWxTY2hlZHVsZWRFcnJvck1lc3NhZ2UgfCBCYWNrZ3JvdW5kSm9iR2V0U2NoZWR1bGVkTWVzc2FnZSB8IEJhY2tncm91bmRKb2JTY2hlZHVsZWRNZXNzYWdlIHwgQmFja2dyb3VuZEpvYkdldFNjaGVkdWxlZEVycm9yTWVzc2FnZSB8IEJhY2tncm91bmRKb2JXYWtlU2NoZWR1bGVkTWVzc2FnZSB8IEJhY2tncm91bmRKb2JTY2hlZHVsZVdva2VuTWVzc2FnZSB8IEJhY2tncm91bmRKb2JXYWtlU2NoZWR1bGVkRXJyb3JNZXNzYWdlIHwgQmFja2dyb3VuZEpvYkpvYk1lc3NhZ2UgfCBCYWNrZ3JvdW5kSm9iQWNjZXB0ZWRNZXNzYWdlIHwgQmFja2dyb3VuZEpvYkNvbXBsZXRlTWVzc2FnZSB8IEJhY2tncm91bmRKb2JGYWlsZWRNZXNzYWdlIHwgQmFja2dyb3VuZEpvYlJlc2NoZWR1bGVNZXNzYWdlIHwgQmFja2dyb3VuZEpvYlVwZGF0ZWRNZXNzYWdlIHwgQmFja2dyb3VuZEpvYlVwZGF0ZUVycm9yTWVzc2FnZX0gQmFja2dyb3VuZEpvYlNvY2tldE1lc3NhZ2VcbiAqL1xuXG5leHBvcnQgY29uc3Qgbm90aGluZyA9IHt9XG4iXX0=