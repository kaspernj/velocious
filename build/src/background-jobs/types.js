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
 * Bounded pooled-child memory observation sent over the child IPC channel.
 * The pooled child's stdio is ignored by the worker fork, so this observation
 * (sent periodically while jobs run, plus on demand) is how a memory problem
 * in a running child names itself. `heapStatistics` and `memoryUsage`
 * distinguish V8-heap growth from external/array-buffer (native resource)
 * growth; `activeJobIds` ties the sample to the work that was in flight.
 * @typedef {object} PooledChildMemoryObservation
 * @property {string[]} activeJobIds - In-flight job ids, bounded.
 * @property {number} activeJobIdsTruncatedCount - In-flight job ids omitted by the bound.
 * @property {string} childInstanceId - Stable identity reported by the child.
 * @property {number} childPid - Child process id.
 * @property {number} childUptimeMs - Child process uptime in ms.
 * @property {ReturnType<typeof import("node:v8").getHeapStatistics>} heapStatistics - V8 heap-stat breakdown at the sample.
 * @property {number} jobCount - In-flight job count.
 * @property {ReturnType<typeof import("node:process").memoryUsage>} memoryUsage - Process memory breakdown at the sample.
 * @property {number} observedAtMs - Epoch ms the child sampled.
 * @property {number} peakRssBytes - Child-reported peak RSS (kernel `VmHWM` high-water mark) in bytes, monotonic for the child's life.
 * @property {number} rssBytes - Resident set size in bytes at the sample.
 * @property {"pooled-child-memory"} type - Discriminator.
 * @property {number} uptimeMs - Process uptime in ms.
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoidHlwZXMuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi9zcmMvYmFja2dyb3VuZC1qb2JzL3R5cGVzLmpzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiJBQUFBLFlBQVk7QUFFWjs7R0FFRztBQUNILHlGQUF5RjtBQUN6RixpSUFBaUk7QUFDakksNk5BQTZOO0FBQzdOLG1FQUFtRTtBQUNuRSwrRkFBK0Y7QUFDL0YsNkZBQTZGO0FBQzdGLGlGQUFpRjtBQUNqRixnRkFBZ0Y7QUFDaEYscU9BQXFPO0FBQ3JPOzs7R0FHRztBQUNILHdGQUF3RjtBQUN4Rjs7Ozs7Ozs7R0FRRztBQUNIOzs7Ozs7O0dBT0c7QUFDSDs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7O0dBMkJHO0FBQ0g7Ozs7Ozs7Ozs7R0FVRztBQUNIOzs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7R0FxQkc7QUFDSDs7Ozs7R0FLRztBQUNIOzs7OztHQUtHO0FBQ0g7Ozs7O0dBS0c7QUFDSDs7Ozs7OztHQU9HO0FBQ0g7Ozs7Ozs7Ozs7OztHQVlHO0FBQ0g7OztHQUdHO0FBQ0g7Ozs7Ozs7R0FPRztBQUNIOzs7OztHQUtHO0FBQ0g7Ozs7OztHQU1HO0FBQ0g7Ozs7O0dBS0c7QUFDSDs7Ozs7Ozs7Ozs7R0FXRztBQUNIOzs7Ozs7Ozs7R0FTRztBQUNIOzs7Ozs7O0dBT0c7QUFDSDs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7OztHQTRCRztBQUNIOztHQUVHO0FBQ0g7Ozs7O0dBS0c7QUFDSDs7R0FFRztBQUNIOzs7O0dBSUc7QUFDSDs7OztHQUlHO0FBQ0g7O0dBRUc7QUFDSDs7OztHQUlHO0FBQ0g7Ozs7Ozs7Ozs7O0dBV0c7QUFDSDs7R0FFRztBQUNIOzs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7OztHQTZCRztBQUNIOztHQUVHO0FBRUgsTUFBTSxDQUFDLE1BQU0sT0FBTyxHQUFHLEVBQUUsQ0FBQSIsInNvdXJjZXNDb250ZW50IjpbIi8vIEB0cy1jaGVja1xuXG4vKipcbiAqIEB0eXBlZGVmIHtcImlubGluZVwiIHwgXCJmb3JrZWRcIiB8IFwicG9vbGVkXCIgfCBcInNwYXduZWRcIn0gQmFja2dyb3VuZEpvYkV4ZWN1dGlvbk1vZGVcbiAqL1xuLyoqIEB0eXBlZGVmIHtcImNhbmRpZGF0ZVwiIHwgXCJhY3RpdmVcIiB8IFwicmV0aXJlZFwifSBCYWNrZ3JvdW5kSm9ic0dlbmVyYXRpb25Jbml0aWFsU3RhdGUgKi9cbi8qKiBAdHlwZWRlZiB7XCJzdGFydGluZ1wiIHwgXCJjYW5kaWRhdGVcIiB8IFwiYWN0aXZlXCIgfCBcInJldGlyaW5nXCIgfCBcInJldGlyZWRcIiB8IFwic3RvcHBlZFwifSBCYWNrZ3JvdW5kSm9ic0dlbmVyYXRpb25MaWZlY3ljbGVTdGF0ZSAqL1xuLyoqIEB0eXBlZGVmIHtcIm1pc3NpbmctZ2VuZXJhdGlvblwiIHwgXCJ1bmV4cGVjdGVkLWdlbmVyYXRpb25cIiB8IFwibWFsZm9ybWVkLWdlbmVyYXRpb25cIiB8IFwiZ2VuZXJhdGlvbi1taXNtYXRjaFwiIHwgXCJ3b3JrZXItYWRtaXNzaW9uLXJldGlyZWRcIiB8IFwid29ya2VyLWhhcy1uby1yZWNvdmVyYWJsZS1oYW5kb2Zmc1wifSBCYWNrZ3JvdW5kSm9ic0dlbmVyYXRpb25SZWplY3Rpb25SZWFzb24gKi9cbi8qKiBAdHlwZWRlZiB7XCJxdWV1ZWRcIiB8IFwiaGFuZGVkX29mZlwifSBCYWNrZ3JvdW5kSm9iQWN0aXZlU3RhdHVzICovXG4vKiogQHR5cGVkZWYge1wiY2FuY2VsbGVkXCIgfCBcImNvbXBsZXRlZFwiIHwgXCJmYWlsZWRcIiB8IFwib3JwaGFuZWRcIn0gQmFja2dyb3VuZEpvYlRlcm1pbmFsU3RhdHVzICovXG4vKiogQHR5cGVkZWYge0JhY2tncm91bmRKb2JBY3RpdmVTdGF0dXMgfCBCYWNrZ3JvdW5kSm9iVGVybWluYWxTdGF0dXN9IEJhY2tncm91bmRKb2JTdGF0dXMgKi9cbi8qKiBAdHlwZWRlZiB7XCJleGl0XCIgfCBcInByb2Nlc3MtZXJyb3JcIiB8IFwiaXBjLXNlbmRcIn0gUG9vbGVkUnVubmVyRmFpbHVyZU9yaWdpbiAqL1xuLyoqIEB0eXBlZGVmIHtcInN0YXJ0aW5nXCIgfCBcInJ1bm5pbmdcIiB8IFwicmV0aXJpbmdcIn0gUG9vbGVkUnVubmVyTGlmZWN5Y2xlU3RhdGUgKi9cbi8qKiBAdHlwZWRlZiB7XCJwYXJlbnRfcmV0aXJlX2RyYWluZWRcIiB8IFwiam9iX3RpbWVvdXRcIiB8IFwid29ya2VyX3N0b3BcIiB8IFwic2lnbmFsX3NpZ3Rlcm1cIiB8IFwic2lnbmFsX3NpZ2ludFwiIHwgXCJzaWduYWxfc2lna2lsbFwiIHwgXCJzaWduYWxfb3RoZXJcIiB8IFwiaXBjX2Rpc2Nvbm5lY3RcIiB8IFwicHJvY2Vzc19lcnJvclwiIHwgXCJ1bmV4cGVjdGVkX2V4aXRcIn0gUG9vbGVkQ2hpbGRTaHV0ZG93blJlYXNvbiAqL1xuLyoqXG4gKiBAZGVwcmVjYXRlZCBVc2UgUG9vbGVkQ2hpbGRTaHV0ZG93blJlYXNvbiBmb3IgZXhhY3Qgc2h1dGRvd24gcHJvdmVuYW5jZS5cbiAqIEB0eXBlZGVmIHtcInVuZXhwZWN0ZWRcIiB8IFwiam9iLXRpbWVvdXRcIiB8IFwid29ya2VyLXNodXRkb3duLXRpbWVvdXRcIn0gUG9vbGVkUnVubmVyVGVybWluYXRpb25SZWFzb25cbiAqL1xuLyoqIEB0eXBlZGVmIHtcInJ1bm5pbmdcIiB8IFwicmV0aXJpbmdcIiB8IFwic3RvcHBpbmdcIn0gQmFja2dyb3VuZEpvYnNXb3JrZXJMaWZlY3ljbGVTdGF0ZSAqL1xuLyoqXG4gKiBFeGFjdCBkdXJhYmxlIGhhbmRvZmYgb3duZXJzaGlwIGNhcnJpZWQgYnkgYW4gZXhlY3V0aW5nIGpvYiB3aGVuIGl0IHByb2R1Y2VzXG4gKiBmb2xsb3ctdXAgd29yay5cbiAqIEB0eXBlZGVmIHtvYmplY3R9IEJhY2tncm91bmRKb2JQcm9kdWNlclByb29mXG4gKiBAcHJvcGVydHkge3N0cmluZ30gam9iSWQgLSBQcm9kdWNpbmcgam9iIGlkLlxuICogQHByb3BlcnR5IHtzdHJpbmd9IGhhbmRvZmZJZCAtIFByb2R1Y2luZyBoYW5kb2ZmIGxlYXNlIGlkLlxuICogQHByb3BlcnR5IHtzdHJpbmd9IHdvcmtlcklkIC0gV29ya2VyIGlkZW50aXR5IHBlcnNpc3RlZCB3aXRoIHRoZSBoYW5kb2ZmLlxuICogQHByb3BlcnR5IHtudW1iZXJ9IGhhbmRlZE9mZkF0TXMgLSBEdXJhYmxlIGhhbmRvZmYgdGltZXN0YW1wLlxuICovXG4vKipcbiAqIEB0eXBlZGVmIHtvYmplY3R9IFBvb2xlZFJ1bm5lckFjdGl2ZUpvYlxuICogQHByb3BlcnR5IHtzdHJpbmcgfCBudWxsfSBoYW5kb2ZmSWQgLSBEdXJhYmxlIGhhbmRvZmYgbGVhc2UgaWQuXG4gKiBAcHJvcGVydHkge251bWJlciB8IG51bGx9IGhhbmRlZE9mZkF0TXMgLSBEdXJhYmxlIGhhbmRvZmYgdGltZXN0YW1wLlxuICogQHByb3BlcnR5IHtzdHJpbmd9IGpvYklkIC0gRHVyYWJsZSBiYWNrZ3JvdW5kIGpvYiBpZC5cbiAqIEBwcm9wZXJ0eSB7c3RyaW5nfSBqb2JOYW1lIC0gUmVnaXN0ZXJlZCBqb2IgY2xhc3MgbmFtZS5cbiAqIEBwcm9wZXJ0eSB7c3RyaW5nfSB3b3JrZXJJZCAtIFdvcmtlciBpZGVudGl0eSBwZXJzaXN0ZWQgd2l0aCB0aGUgaGFuZG9mZi5cbiAqL1xuLyoqXG4gKiBPbmUgcHJvY2Vzcy1mYWlsdXJlIHNuYXBzaG90IHNoYXJlZCBieSBldmVyeSBqb2IgbG9zdCB3aXRoIGEgcG9vbGVkIGNoaWxkLlxuICogQHR5cGVkZWYge29iamVjdH0gUG9vbGVkUnVubmVyRmFpbHVyZVxuICogQHByb3BlcnR5IHtQb29sZWRSdW5uZXJBY3RpdmVKb2JbXX0gYWN0aXZlSm9icyAtIEpvYnMgdGhhdCB3ZXJlIGluIGZsaWdodCB3aGVuIHRoZSBjaGlsZCBmYWlsZWQsIG9yZGVyZWQgYnkgam9iIGlkLlxuICogQHByb3BlcnR5IHtzdHJpbmcgfCBudWxsfSBjaGlsZEluc3RhbmNlSWQgLSBTdGFibGUgcG9vbGVkLWNoaWxkIGlkZW50aXR5IHdoZW4gaXRzIHN0YXJ0dXAgb3Igc2h1dGRvd24gb2JzZXJ2YXRpb24gYXJyaXZlZC5cbiAqIEBwcm9wZXJ0eSB7bnVtYmVyIHwgbnVsbH0gZXhpdENvZGUgLSBDaGlsZCBleGl0IGNvZGUsIG9yIG51bGwgZm9yIHNpZ25hbC9wcm9jZXNzIGVycm9ycy5cbiAqIEBwcm9wZXJ0eSB7c3RyaW5nIHwgbnVsbH0gZ2VuZXJhdGlvbklkIC0gUmVsZWFzZSBnZW5lcmF0aW9uIGlkZW50aXR5LCBvciBudWxsIGluIGxlZ2FjeSBtb2RlLlxuICogQHByb3BlcnR5IHtzdHJpbmdbXX0gaW5mbGlnaHRKb2JJZHMgLSBCb3VuZGVkIGpvYiBpZHMgaW4gZmxpZ2h0IHdoZW4gZmFpbHVyZSBoYW5kbGluZyBzdGFydGVkLlxuICogQHByb3BlcnR5IHtudW1iZXJ9IGluZmxpZ2h0Sm9iSWRzVHJ1bmNhdGVkQ291bnQgLSBJbi1mbGlnaHQgaWRzIG9taXR0ZWQgZnJvbSB0aGUgYm91bmRlZCBzbmFwc2hvdC5cbiAqIEBwcm9wZXJ0eSB7Ym9vbGVhbiB8IG51bGx9IG9vbUtpbGxlZCAtIEZhbHNlIHdoZW4gdGhlIG9ic2VydmVkIGV4aXQgcnVsZXMgT09NIG91dDsgbnVsbCB3aGVuIGFuIHVuZXhwZWN0ZWQgU0lHS0lMTCBjYW5ub3QgYmUgZGlzdGluZ3Vpc2hlZCBmcm9tIGFuIE9PTSBraWxsIHdpdGhvdXQgc3VwZXJ2aXNvci9rZXJuZWwgZXZpZGVuY2UuXG4gKiBAcHJvcGVydHkge1Bvb2xlZFJ1bm5lckZhaWx1cmVPcmlnaW59IG9yaWdpbiAtIFdvcmtlciBvYnNlcnZhdGlvbiB0aGF0IGluaXRpYXRlZCBmYWlsdXJlIGhhbmRsaW5nLlxuICogQHByb3BlcnR5IHtudW1iZXJ9IHJ1bm5lckFnZU1zIC0gQ2hpbGQgYWdlIHdoZW4gZmFpbHVyZSBoYW5kbGluZyBzdGFydGVkLlxuICogQHByb3BlcnR5IHtudW1iZXJ9IHJ1bm5lckNyZWF0ZWRBdE1zIC0gQ2hpbGQgY3JlYXRpb24gdGltZXN0YW1wLlxuICogQHByb3BlcnR5IHtib29sZWFufSBydW5uZXJEZXRhY2hlZCAtIFdoZXRoZXIgdGhlIHJ1bm5lciBvd25lZCBhIGRldGFjaGVkIHByb2Nlc3MgZ3JvdXAuXG4gKiBAcHJvcGVydHkge251bWJlcn0gcnVubmVySm9ic1J1biAtIFByZXZpb3VzbHkgYWNrbm93bGVkZ2VkIGpvYnMgaGFuZGxlZCBieSB0aGUgY2hpbGQuXG4gKiBAcHJvcGVydHkge1Bvb2xlZFJ1bm5lckxpZmVjeWNsZVN0YXRlfSBydW5uZXJMaWZlY3ljbGUgLSBDaGlsZCBsaWZlY3ljbGUgaW1tZWRpYXRlbHkgYmVmb3JlIHJlY292ZXJ5LlxuICogQHByb3BlcnR5IHtudW1iZXIgfCBudWxsfSBydW5uZXJQaWQgLSBDaGlsZCBwcm9jZXNzIGlkIHdoZW4gYXZhaWxhYmxlLlxuICogQHByb3BlcnR5IHtpbXBvcnQoXCJub2RlOmNoaWxkX3Byb2Nlc3NcIikuQ2hpbGRQcm9jZXNzW1wic2lnbmFsQ29kZVwiXX0gc2lnbmFsIC0gQ2hpbGQgdGVybWluYXRpb24gc2lnbmFsIHdoZW4gYXZhaWxhYmxlLlxuICogQHByb3BlcnR5IHtudW1iZXIgfCBudWxsfSBzaHV0ZG93bk9ic2VydmVkQXRNcyAtIFRpbWUgdGhlIGNoaWxkIG9yIHBhcmVudCBvYnNlcnZlZCBzaHV0ZG93biBiZWdpbm5pbmcuXG4gKiBAcHJvcGVydHkge251bWJlciB8IG51bGx9IHNodXRkb3duUmVxdWVzdGVkQXRNcyAtIEV4YWN0IHBhcmVudCByZXF1ZXN0IHRpbWVzdGFtcCwgb3IgbnVsbCBmb3IgZXh0ZXJuYWwvdW5yZXF1ZXN0ZWQgc2h1dGRvd24uXG4gKiBAcHJvcGVydHkge1Bvb2xlZENoaWxkU2h1dGRvd25SZWFzb259IHNodXRkb3duUmVhc29uIC0gRXhhY3QgcmVjb3JkZWQgcGFyZW50IHJlcXVlc3Qgb3Igb2JzZXJ2ZWQgY2hpbGQgc2h1dGRvd24gY2F1c2UuXG4gKiBAcHJvcGVydHkge2ltcG9ydChcIm5vZGU6Y2hpbGRfcHJvY2Vzc1wiKS5DaGlsZFByb2Nlc3NbXCJzaWduYWxDb2RlXCJdfSBzaHV0ZG93blNpZ25hbCAtIFBhcmVudC1yZXF1ZXN0ZWQgb3IgY2hpbGQtb2JzZXJ2ZWQgc2h1dGRvd24gc2lnbmFsIHdoZW4gYXZhaWxhYmxlLlxuICogQHByb3BlcnR5IHtQb29sZWRSdW5uZXJUZXJtaW5hdGlvblJlYXNvbn0gdGVybWluYXRpb25SZWFzb24gLSBEZXByZWNhdGVkIGNvbXBhdGliaWxpdHkgY2F0ZWdvcnk7IHVzZSBzaHV0ZG93blJlYXNvbiBmb3IgZXhhY3QgcHJvdmVuYW5jZS5cbiAqIEBwcm9wZXJ0eSB7c3RyaW5nIHwgbnVsbH0gdGltZW91dEpvYklkIC0gSm9iIHdob3NlIHRpbWVvdXQgaW5pdGlhdGVkIGNoaWxkIHRlcm1pbmF0aW9uLCBvciBudWxsLlxuICogQHByb3BlcnR5IHtzdHJpbmd9IHdvcmtlcklkIC0gU3RhYmxlIGdlbmVyYXRpb24tcXVhbGlmaWVkIHdvcmtlciBpZC5cbiAqIEBwcm9wZXJ0eSB7QmFja2dyb3VuZEpvYnNXb3JrZXJMaWZlY3ljbGVTdGF0ZX0gd29ya2VyTGlmZWN5Y2xlIC0gUGFyZW50IHdvcmtlciBsaWZlY3ljbGUgaW1tZWRpYXRlbHkgYmVmb3JlIHJlY292ZXJ5LlxuICogQHByb3BlcnR5IHtudW1iZXJ9IHdvcmtlclBpZCAtIFBhcmVudCB3b3JrZXIgcHJvY2VzcyBpZC5cbiAqL1xuLyoqXG4gKiBCZXN0LWVmZm9ydCBvYnNlcnZhdGlvbiBzZW50IGJlZm9yZSBhIHBvb2xlZCBjaGlsZCBjbG9zZXMgaXRzIHJlc291cmNlcy5cbiAqIEB0eXBlZGVmIHtvYmplY3R9IFBvb2xlZENoaWxkU2h1dGRvd25PYnNlcnZhdGlvblxuICogQHByb3BlcnR5IHtzdHJpbmd9IGNoaWxkSW5zdGFuY2VJZCAtIFN0YWJsZSBwb29sZWQtY2hpbGQgaWRlbnRpdHkuXG4gKiBAcHJvcGVydHkge3N0cmluZ1tdfSBpbmZsaWdodEpvYklkcyAtIEJvdW5kZWQgaW4tZmxpZ2h0IGR1cmFibGUgam9iIGlkcy5cbiAqIEBwcm9wZXJ0eSB7bnVtYmVyfSBpbmZsaWdodEpvYklkc1RydW5jYXRlZENvdW50IC0gSW4tZmxpZ2h0IGlkcyBvbWl0dGVkIGZyb20gdGhlIGJvdW5kZWQgc25hcHNob3QuXG4gKiBAcHJvcGVydHkge1Bvb2xlZENoaWxkU2h1dGRvd25SZWFzb259IHJlYXNvbiAtIFNodXRkb3duIHJlYXNvbiBvYnNlcnZlZCBieSB0aGUgY2hpbGQuXG4gKiBAcHJvcGVydHkge251bWJlcn0gc2h1dGRvd25PYnNlcnZlZEF0TXMgLSBDaGlsZCBvYnNlcnZhdGlvbiB0aW1lc3RhbXAuXG4gKiBAcHJvcGVydHkge251bWJlciB8IG51bGx9IHNodXRkb3duUmVxdWVzdGVkQXRNcyAtIFBhcmVudCByZXF1ZXN0IHRpbWVzdGFtcCB3aGVuIHN1cHBsaWVkIG92ZXIgSVBDLlxuICogQHByb3BlcnR5IHtpbXBvcnQoXCJub2RlOmNoaWxkX3Byb2Nlc3NcIikuQ2hpbGRQcm9jZXNzW1wic2lnbmFsQ29kZVwiXX0gc2lnbmFsIC0gUmVxdWVzdGVkIG9yIG9ic2VydmVkIHNpZ25hbCB3aGVuIGF2YWlsYWJsZS5cbiAqL1xuLyoqXG4gKiBCb3VuZGVkIHBvb2xlZC1jaGlsZCBtZW1vcnkgb2JzZXJ2YXRpb24gc2VudCBvdmVyIHRoZSBjaGlsZCBJUEMgY2hhbm5lbC5cbiAqIFRoZSBwb29sZWQgY2hpbGQncyBzdGRpbyBpcyBpZ25vcmVkIGJ5IHRoZSB3b3JrZXIgZm9yaywgc28gdGhpcyBvYnNlcnZhdGlvblxuICogKHNlbnQgcGVyaW9kaWNhbGx5IHdoaWxlIGpvYnMgcnVuLCBwbHVzIG9uIGRlbWFuZCkgaXMgaG93IGEgbWVtb3J5IHByb2JsZW1cbiAqIGluIGEgcnVubmluZyBjaGlsZCBuYW1lcyBpdHNlbGYuIGBoZWFwU3RhdGlzdGljc2AgYW5kIGBtZW1vcnlVc2FnZWBcbiAqIGRpc3Rpbmd1aXNoIFY4LWhlYXAgZ3Jvd3RoIGZyb20gZXh0ZXJuYWwvYXJyYXktYnVmZmVyIChuYXRpdmUgcmVzb3VyY2UpXG4gKiBncm93dGg7IGBhY3RpdmVKb2JJZHNgIHRpZXMgdGhlIHNhbXBsZSB0byB0aGUgd29yayB0aGF0IHdhcyBpbiBmbGlnaHQuXG4gKiBAdHlwZWRlZiB7b2JqZWN0fSBQb29sZWRDaGlsZE1lbW9yeU9ic2VydmF0aW9uXG4gKiBAcHJvcGVydHkge3N0cmluZ1tdfSBhY3RpdmVKb2JJZHMgLSBJbi1mbGlnaHQgam9iIGlkcywgYm91bmRlZC5cbiAqIEBwcm9wZXJ0eSB7bnVtYmVyfSBhY3RpdmVKb2JJZHNUcnVuY2F0ZWRDb3VudCAtIEluLWZsaWdodCBqb2IgaWRzIG9taXR0ZWQgYnkgdGhlIGJvdW5kLlxuICogQHByb3BlcnR5IHtzdHJpbmd9IGNoaWxkSW5zdGFuY2VJZCAtIFN0YWJsZSBpZGVudGl0eSByZXBvcnRlZCBieSB0aGUgY2hpbGQuXG4gKiBAcHJvcGVydHkge251bWJlcn0gY2hpbGRQaWQgLSBDaGlsZCBwcm9jZXNzIGlkLlxuICogQHByb3BlcnR5IHtudW1iZXJ9IGNoaWxkVXB0aW1lTXMgLSBDaGlsZCBwcm9jZXNzIHVwdGltZSBpbiBtcy5cbiAqIEBwcm9wZXJ0eSB7UmV0dXJuVHlwZTx0eXBlb2YgaW1wb3J0KFwibm9kZTp2OFwiKS5nZXRIZWFwU3RhdGlzdGljcz59IGhlYXBTdGF0aXN0aWNzIC0gVjggaGVhcC1zdGF0IGJyZWFrZG93biBhdCB0aGUgc2FtcGxlLlxuICogQHByb3BlcnR5IHtudW1iZXJ9IGpvYkNvdW50IC0gSW4tZmxpZ2h0IGpvYiBjb3VudC5cbiAqIEBwcm9wZXJ0eSB7UmV0dXJuVHlwZTx0eXBlb2YgaW1wb3J0KFwibm9kZTpwcm9jZXNzXCIpLm1lbW9yeVVzYWdlPn0gbWVtb3J5VXNhZ2UgLSBQcm9jZXNzIG1lbW9yeSBicmVha2Rvd24gYXQgdGhlIHNhbXBsZS5cbiAqIEBwcm9wZXJ0eSB7bnVtYmVyfSBvYnNlcnZlZEF0TXMgLSBFcG9jaCBtcyB0aGUgY2hpbGQgc2FtcGxlZC5cbiAqIEBwcm9wZXJ0eSB7bnVtYmVyfSBwZWFrUnNzQnl0ZXMgLSBDaGlsZC1yZXBvcnRlZCBwZWFrIFJTUyAoa2VybmVsIGBWbUhXTWAgaGlnaC13YXRlciBtYXJrKSBpbiBieXRlcywgbW9ub3RvbmljIGZvciB0aGUgY2hpbGQncyBsaWZlLlxuICogQHByb3BlcnR5IHtudW1iZXJ9IHJzc0J5dGVzIC0gUmVzaWRlbnQgc2V0IHNpemUgaW4gYnl0ZXMgYXQgdGhlIHNhbXBsZS5cbiAqIEBwcm9wZXJ0eSB7XCJwb29sZWQtY2hpbGQtbWVtb3J5XCJ9IHR5cGUgLSBEaXNjcmltaW5hdG9yLlxuICogQHByb3BlcnR5IHtudW1iZXJ9IHVwdGltZU1zIC0gUHJvY2VzcyB1cHRpbWUgaW4gbXMuXG4gKi9cbi8qKlxuICogQHR5cGVkZWYge29iamVjdH0gTG9jYWxCYWNrZ3JvdW5kSm9ic0Nsb2NrXG4gKiBAcHJvcGVydHkgeygpID0+IG51bWJlcn0gbm93IC0gQ3VycmVudCBlcG9jaCBtaWxsaXNlY29uZHMuXG4gKiBAcHJvcGVydHkgeyhjYWxsYmFjazogKCkgPT4gdm9pZCwgZGVsYXlNczogbnVtYmVyKSA9PiBSZXR1cm5UeXBlPHR5cGVvZiBzZXRUaW1lb3V0PiB8IG51bWJlcn0gc2V0VGltZW91dCAtIEFybXMgYSB0aW1lci5cbiAqIEBwcm9wZXJ0eSB7KHRpbWVySWQ6IFJldHVyblR5cGU8dHlwZW9mIHNldFRpbWVvdXQ+IHwgbnVtYmVyKSA9PiB2b2lkfSBjbGVhclRpbWVvdXQgLSBDbGVhcnMgYSB0aW1lci5cbiAqL1xuLyoqXG4gKiBAdHlwZWRlZiB7b2JqZWN0fSBSZXNvbHZlZEJhY2tncm91bmRKb2JDb25jdXJyZW5jeVxuICogQHByb3BlcnR5IHtzdHJpbmd9IGNvbmN1cnJlbmN5S2V5IC0gRHVyYWJsZSBjYXAgaWRlbnRpdHkuXG4gKiBAcHJvcGVydHkge251bWJlcn0gbWF4Q29uY3VycmVuY3kgLSBQb3NpdGl2ZSBjYXAuXG4gKiBAcHJvcGVydHkge2Jvb2xlYW59IHF1ZXVlRGVyaXZlZCAtIFdoZXRoZXIgcXVldWUgY29uZmlndXJhdGlvbiBvd25zIHRoZSBjYXAuXG4gKi9cbi8qKlxuICogQHR5cGVkZWYge29iamVjdH0gQmFja2dyb3VuZEpvYkNvbmN1cnJlbmN5UmVwYWlyXG4gKiBAcHJvcGVydHkge251bWJlcn0gYWN0aXZlQ291bnQgLSBFeGFjdCBoYW5kZWQtb2ZmIGpvYiBjb3VudCBwZXJzaXN0ZWQgYnkgdGhlIHJlcGFpci5cbiAqIEBwcm9wZXJ0eSB7c3RyaW5nfSBjb25jdXJyZW5jeUtleSAtIER1cmFibGUgY2FwIGlkZW50aXR5LlxuICogQHByb3BlcnR5IHtudW1iZXJ9IHByZXZpb3VzQWN0aXZlQ291bnQgLSBQZXJzaXN0ZWQgY291bnQgcmVwbGFjZWQgYnkgdGhlIHJlcGFpci5cbiAqL1xuLyoqXG4gKiBAdHlwZWRlZiB7b2JqZWN0fSBCYWNrZ3JvdW5kSm9iQ29uY3VycmVuY3lSZWNvbmNpbGlhdGlvblxuICogQHByb3BlcnR5IHtudW1iZXJ9IGNhbmRpZGF0ZUNvdW50IC0gU25hcHNob3QgbWlzbWF0Y2hlcyByZWNoZWNrZWQgdW5kZXIgdGhlaXIgY291bnRlciBsb2Nrcy5cbiAqIEBwcm9wZXJ0eSB7bnVtYmVyfSBjaGVja2VkQ291bnQgLSBBY3RpdmUgb3Igbm9uemVybyBkdXJhYmxlIGNvdW50ZXJzIGNvbXBhcmVkIGluIHRoZSBpbml0aWFsIHNuYXBzaG90LlxuICogQHByb3BlcnR5IHtudW1iZXJ9IHJlcGFpcmVkQ291bnQgLSBDb3VudGVycyB3aG9zZSBwZXJzaXN0ZWQgdmFsdWVzIHdlcmUgY2hhbmdlZC5cbiAqIEBwcm9wZXJ0eSB7QmFja2dyb3VuZEpvYkNvbmN1cnJlbmN5UmVwYWlyW119IHJlcGFpcnMgLSBCb3VuZGVkIGRldGVybWluaXN0aWMgc2FtcGxlIG9mIGFwcGxpZWQgcmVwYWlycy5cbiAqIEBwcm9wZXJ0eSB7bnVtYmVyfSByZXBhaXJzVHJ1bmNhdGVkQ291bnQgLSBBcHBsaWVkIHJlcGFpcnMgb21pdHRlZCBmcm9tIHRoZSBzYW1wbGUuXG4gKi9cbi8qKlxuICogQHR5cGVkZWYge29iamVjdH0gUHJlcGFyZWRMb2NhbEJhY2tncm91bmRKb2JcbiAqIEBwcm9wZXJ0eSB7c3RyaW5nfSBhcmdzRGlnZXN0IC0gRml4ZWQtd2lkdGggZGlnZXN0IG9mIHRoZSBzZXJpYWxpemVkIGFyZ3VtZW50cy5cbiAqIEBwcm9wZXJ0eSB7c3RyaW5nfSBhcmdzSnNvbiAtIFNlcmlhbGl6ZWQgYXJndW1lbnRzLlxuICogQHByb3BlcnR5IHtSZXNvbHZlZEJhY2tncm91bmRKb2JDb25jdXJyZW5jeSB8IG51bGx9IGNvbmN1cnJlbmN5IC0gUmVzb2x2ZWQgY29uY3VycmVuY3kuXG4gKiBAcHJvcGVydHkge251bWJlcn0gY3JlYXRlZEF0TXMgLSBDcmVhdGlvbiB0aW1lc3RhbXAuXG4gKiBAcHJvcGVydHkge1wiaW5saW5lXCJ9IGV4ZWN1dGlvbk1vZGUgLSBMb2NhbCBpbi1wcm9jZXNzIGV4ZWN1dGlvbiBtb2RlLlxuICogQHByb3BlcnR5IHtzdHJpbmd9IGpvYklkIC0gRHVyYWJsZSBpZC5cbiAqIEBwcm9wZXJ0eSB7c3RyaW5nfSBqb2JOYW1lIC0gUmVnaXN0ZXJlZCBuYW1lLlxuICogQHByb3BlcnR5IHtudW1iZXJ9IG1heFJldHJpZXMgLSBSZXRyeSBjYXAuXG4gKiBAcHJvcGVydHkge3N0cmluZ30gcXVldWUgLSBRdWV1ZSBuYW1lLlxuICogQHByb3BlcnR5IHtudW1iZXJ9IHNjaGVkdWxlZEF0TXMgLSBFbGlnaWJpbGl0eSB0aW1lc3RhbXAuXG4gKi9cbi8qKlxuICogQHR5cGVkZWYge29iamVjdH0gQmFja2dyb3VuZEpvYnNIZWFsdGhcbiAqIEBwcm9wZXJ0eSB7Ym9vbGVhbn0gcmVhZHkgLSBXaGV0aGVyIHRoZSBhZGFwdGVyIGNhbiBhY2NlcHQgYW5kIHByb2Nlc3Mgd29yay5cbiAqL1xuLyoqXG4gKiBAdHlwZWRlZiB7b2JqZWN0fSBCYWNrZ3JvdW5kSm9ic1Byb2R1Y2VyXG4gKiBAcHJvcGVydHkgeyhhcmdzOiB7am9iTmFtZTogc3RyaW5nLCBhcmdzOiBBcnJheTxSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj4sIG9wdGlvbnM/OiBCYWNrZ3JvdW5kSm9iT3B0aW9ucywgcHJvZHVjZXJJbnZvY2F0aW9uSWQ/OiBzdHJpbmcsIHByb2R1Y2VyUHJvb2Y/OiBCYWNrZ3JvdW5kSm9iUHJvZHVjZXJQcm9vZn0pID0+IFByb21pc2U8c3RyaW5nPn0gZW5xdWV1ZSAtIEVucXVldWVzIGEgam9iLlxuICogQHByb3BlcnR5IHsoYXJnczoge3NjaGVkdWxlS2V5OiBzdHJpbmcsIGpvYk5hbWU6IHN0cmluZywgYXJnczogQXJyYXk8UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+LCBvcHRpb25zPzogQmFja2dyb3VuZEpvYk9wdGlvbnN9KSA9PiBQcm9taXNlPEJhY2tncm91bmRKb2JSZXBsYWNlbWVudFJlc3VsdD59IHJlcGxhY2VTY2hlZHVsZWQgLSBSZXBsYWNlcyBhIHN0YWJsZSBzY2hlZHVsZS5cbiAqIEBwcm9wZXJ0eSB7KGFyZ3M6IHtzY2hlZHVsZUtleTogc3RyaW5nfSkgPT4gUHJvbWlzZTxCYWNrZ3JvdW5kSm9iQ2FuY2VsbGF0aW9uUmVzdWx0Pn0gY2FuY2VsU2NoZWR1bGVkIC0gQ2FuY2VscyBhIHN0YWJsZSBzY2hlZHVsZS5cbiAqIEBwcm9wZXJ0eSB7KGFyZ3M6IHtzY2hlZHVsZUtleTogc3RyaW5nLCBpbmNsdWRlTGF0ZXN0VGVybWluYWw/OiBib29sZWFufSkgPT4gUHJvbWlzZTxCYWNrZ3JvdW5kSm9iU2NoZWR1bGVkTG9va3VwUmVzdWx0Pn0gZ2V0U2NoZWR1bGVkSm9iIC0gUmVhZHMgc3RhYmxlIHNjaGVkdWxlIG93bmVyc2hpcCBhbmQgaGlzdG9yeS5cbiAqIEBwcm9wZXJ0eSB7KGFyZ3M6IHtzY2hlZHVsZUtleTogc3RyaW5nfSkgPT4gUHJvbWlzZTxCYWNrZ3JvdW5kSm9iV2FrZVJlc3VsdD59IHdha2VTY2hlZHVsZWQgLSBFeHBlZGl0ZXMgYSBzdGFibGUgc2NoZWR1bGUgb3duZXIuXG4gKi9cbi8qKlxuICogQHR5cGVkZWYge29iamVjdH0gQmFja2dyb3VuZEpvYkhhbmRvZmZcbiAqIEBwcm9wZXJ0eSB7c3RyaW5nfSBoYW5kb2ZmSWQgLSBVbmlxdWUgaGFuZG9mZiBsZWFzZSBpZC5cbiAqIEBwcm9wZXJ0eSB7bnVtYmVyfSBoYW5kZWRPZmZBdE1zIC0gVGltZSBoYW5kZWQgdG8gYSB3b3JrZXIgaW4gbXMuXG4gKiBAcHJvcGVydHkge0JhY2tncm91bmRKb2JSb3d9IFtqb2JdIC0gRXhhY3QgY29tbWl0dGVkIGpvYiBzbmFwc2hvdCB3aGVuIHRoZSBhZGFwdGVyIGNoYW5nZXMgZGlzcGF0Y2ggZGF0YSBkdXJpbmcgdGhlIGNsYWltLlxuICovXG4vKipcbiAqIEB0eXBlZGVmIHtvYmplY3R9IEJhY2tncm91bmRKb2JIYW5kb2ZmU25hcHNob3RcbiAqIEBwcm9wZXJ0eSB7c3RyaW5nfSBqb2JJZCAtIEpvYiBob2xkaW5nIHRoZSBsZWFzZS5cbiAqIEBwcm9wZXJ0eSB7c3RyaW5nfSBoYW5kb2ZmSWQgLSBFeGFjdCBkdXJhYmxlIGxlYXNlIGlkLlxuICogQHByb3BlcnR5IHtzdHJpbmd9IHdvcmtlcklkIC0gU3RhYmxlIHdvcmtlciBpZCB0aGF0IHJlY2VpdmVkIHRoZSBsZWFzZS5cbiAqIEBwcm9wZXJ0eSB7bnVtYmVyfSBoYW5kZWRPZmZBdE1zIC0gVGltZSBoYW5kZWQgdG8gdGhlIHdvcmtlciBpbiBtcy5cbiAqL1xuLyoqXG4gKiBAdHlwZWRlZiB7b2JqZWN0fSBCYWNrZ3JvdW5kSm9iSGFuZG9mZlJlcXVlc3RcbiAqIEBwcm9wZXJ0eSB7c3RyaW5nfSBqb2JJZCAtIEpvYiB0byBjbGFpbS5cbiAqIEBwcm9wZXJ0eSB7c3RyaW5nfSBbaGFuZG9mZklkXSAtIEV4YWN0IGNhbGxlci1zZWxlY3RlZCBsZWFzZSBpZC4gQWRhcHRlcnMgbXVzdCBwZXJzaXN0IGFuZCByZXR1cm4gdGhpcyBpZCB3aGVuIHN1cHBsaWVkOyBidWlsdC1pbiBhZGFwdGVycyBnZW5lcmF0ZSBvbmUgd2hlbiBvbWl0dGVkIGZvciBsZWdhY3kgZGlyZWN0IGNhbGxlcnMuXG4gKiBAcHJvcGVydHkge3N0cmluZ30gW3dvcmtlcklkXSAtIFdvcmtlciBjbGFpbWluZyB0aGUgam9iLlxuICovXG4vKipcbiAqIEB0eXBlZGVmIHtvYmplY3R9IEJhY2tncm91bmRKb2JPcHRpb25zXG4gKiBAcHJvcGVydHkge0JhY2tncm91bmRKb2JFeGVjdXRpb25Nb2RlfSBbZXhlY3V0aW9uTW9kZV0gLSBIb3cgdGhlIGpvYiBzaG91bGQgcnVuLiBOb2RlIGRlZmF1bHRzIHRvIGBcInBvb2xlZFwiYCAoYSB3YXJtLCByZXVzZWQgbG9jYWwgcnVubmVyIHByb2Nlc3MpLiBCcm93c2VyL0V4cG8gbG9jYWwgZGlzcGF0Y2ggZGVmYXVsdHMgdG8gYW5kIG9ubHkgYWNjZXB0cyBgXCJpbmxpbmVcImAuIGBcImZvcmtlZFwiYCBydW5zIGEgTm9kZSBqb2IgaW4gYSBmcmVzaCBgY2hpbGRfcHJvY2Vzcy5mb3JrKClgIGNoaWxkLCBhbmQgYFwic3Bhd25lZFwiYCBpbiBhIGRldGFjaGVkIENMSSBydW5uZXIuXG4gKiBAcHJvcGVydHkge251bWJlcn0gW21heFJldHJpZXNdIC0gTWF4IHJldHJpZXMgZm9yIGEgZmFpbGVkIGpvYiBiZWZvcmUgaXQgaXMgbWFya2VkIGZhaWxlZC5cbiAqIEBwcm9wZXJ0eSB7c3RyaW5nfSBbcXVldWVdIC0gUXVldWUgbmFtZS4gRGVmYXVsdHMgdG8gYFwiZGVmYXVsdFwiYC4gV2hlbiB0aGUgcXVldWUgaGFzIGEgY29uZmlndXJlZCBjYXAgaW4gYGJhY2tncm91bmRKb2JzLnF1ZXVlc2AsIHRoYXQgY2FwIGlzIGVuZm9yY2VkIGNsdXN0ZXItd2lkZS5cbiAqIEBwcm9wZXJ0eSB7c3RyaW5nfSBbY29uY3VycmVuY3lLZXldIC0gT3BhcXVlIG5vbi1lbXB0eSBrZXkgdXNlZCB0byBzaGFyZSBhIGNvbmN1cnJlbmN5IGNhcC4gT3ZlcnJpZGVzIGFueSBxdWV1ZS1kZXJpdmVkIGNhcC5cbiAqIEBwcm9wZXJ0eSB7bnVtYmVyfSBbbWF4Q29uY3VycmVuY3ldIC0gUG9zaXRpdmUgaW50ZWdlciBjYXA7IG11c3QgYmUgcGFpcmVkIHdpdGggYGNvbmN1cnJlbmN5S2V5YC5cbiAqIEBwcm9wZXJ0eSB7Ym9vbGVhbn0gW2RlZHVwbGljYXRlV2hpbGVRdWV1ZWRdIC0gV2hlbiB0cnVlLCBza2lwIHRoZSBlbnF1ZXVlIGlmIGFuIGlkZW50aWNhbCBzdGlsbC1xdWV1ZWQgam9iIChzYW1lIGpvYiBuYW1lLCBhcmdzIGFuZCBxdWV1ZSkgaXMgc2NoZWR1bGVkIG5vIGxhdGVyIHRoYW4gdGhpcyBlbnF1ZXVlLCByZXR1cm5pbmcgdGhlIGVhcmxpZXN0IG1hdGNoaW5nIGpvYidzIGlkLiBBIGZ1dHVyZSByZXRyeSBkb2VzIG5vdCBzdXBwcmVzcyBlYXJsaWVyIHdvcmsuIERlZHVwbGljYXRpb24gaXMgaW5kZXBlbmRlbnQgb2YgYGNvbmN1cnJlbmN5S2V5YCwgc28gdGhlIGpvYiBrZWVwcyBpdHMgbm9ybWFsIChlLmcuIHF1ZXVlLWRlcml2ZWQpIGNvbmN1cnJlbmN5IGNhcC4gS2VlcHMgYW4gaW50ZXJ2YWwtc2NoZWR1bGVkIHJlY3VycmluZyBqb2IgKGUuZy4gcmV0ZW50aW9uIHBydW5pbmcpIGZyb20gcGlsaW5nIHVwIHJlZHVuZGFudCBxdWV1ZWQgcm93cyB3aGVuIGl0IHJ1bnMgc2xvd2VyIHRoYW4gaXRzIGludGVydmFsIG9yIG5vIHdvcmtlciBpcyBmcmVlLlxuICogQHByb3BlcnR5IHtzdHJpbmd9IFtpZGVtcG90ZW5jeUtleV0gLSBEdXJhYmxlIGVucXVldWUgaWRlbnRpdHkgc2NvcGVkIHRvIHRoZSByZXNvbHZlZCBqb2IgY2xhc3MgbmFtZSBhbmQgcXVldWUuIEV4YWN0IHJlcGxheSByZXR1cm5zIHRoZSBvcmlnaW5hbCBqb2IgaWQgYWNyb3NzIGV2ZXJ5IHN0YXRlIGFuZCBhZnRlciBqb2IgcHJ1bmluZzsgcmV1c2Ugd2l0aCBkaWZmZXJlbnQgY2Fub25pY2FsIGFyZ3VtZW50cyBvciBiZWhhdmlvci1hZmZlY3Rpbmcgb3B0aW9ucyBmYWlscy4gT3duZXJzaGlwIGlzIGluZGVwZW5kZW50IG9mIGBkZWR1cGxpY2F0ZVdoaWxlUXVldWVkYCBhbmQgaXMgcmV0YWluZWQgdW50aWwgYW4gZXhwbGljaXQgZnV0dXJlIHJldGVudGlvbiBwb2xpY3kgcmVtb3ZlcyBpdC5cbiAqIEBwcm9wZXJ0eSB7bnVtYmVyfSBbc2NoZWR1bGVkQXRNc10gLSBFcG9jaCB0aW1lc3RhbXAgaW4gbWlsbGlzZWNvbmRzIHdoZW4gdGhlIGpvYiBiZWNvbWVzIGVsaWdpYmxlIGZvciBkaXNwYXRjaC4gRGVmYXVsdHMgdG8gZW5xdWV1ZSB0aW1lLlxuICogQHByb3BlcnR5IHtudW1iZXJ9IFt0aW1lb3V0TXNdIC0gUGVyLWpvYiB3YWxsLWNsb2NrIHRpbWVvdXQgZm9yIGZvcmtlZCBhbmQgcG9vbGVkIGV4ZWN1dGlvbi4gQSBwb3NpdGl2ZSBpbnRlZ2VyIHVwIHRvIDIsMTQ3LDQ4Myw2NDcgb3ZlcnJpZGVzIHRoZSB3b3JrZXItbGV2ZWwgYGpvYlRpbWVvdXRNc2A7IGEgbm9uLXBvc2l0aXZlIGZpbml0ZSB2YWx1ZSBkaXNhYmxlcyB0aGUgdGltZW91dCBmb3IgdGhpcyBqb2IuXG4gKi9cbi8qKlxuICogQHR5cGVkZWYge29iamVjdH0gQmFja2dyb3VuZEpvYlBheWxvYWRcbiAqIEBwcm9wZXJ0eSB7c3RyaW5nfSBbaWRdIC0gSm9iIGlkLlxuICogQHByb3BlcnR5IHtzdHJpbmd9IGpvYk5hbWUgLSBKb2IgY2xhc3MgbmFtZS5cbiAqIEBwcm9wZXJ0eSB7QXJyYXk8UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSBbYXJnc10gLSBTZXJpYWxpemVkIGpvYiBhcmd1bWVudHMuXG4gKiBAcHJvcGVydHkge3N0cmluZ30gW2hhbmRvZmZJZF0gLSBVbmlxdWUgaGFuZG9mZiBsZWFzZSBpZC5cbiAqIEBwcm9wZXJ0eSB7c3RyaW5nfSBbd29ya2VySWRdIC0gV29ya2VyIGlkIGhhbmRsaW5nIHRoZSBqb2IuXG4gKiBAcHJvcGVydHkge251bWJlcn0gW2hhbmRlZE9mZkF0TXNdIC0gVGltZSBoYW5kZWQgdG8gYSB3b3JrZXIgaW4gbXMuXG4gKiBAcHJvcGVydHkge0JhY2tncm91bmRKb2JPcHRpb25zfSBbb3B0aW9uc10gLSBSdW50aW1lIG9wdGlvbnMuXG4gKi9cbi8qKlxuICogQHR5cGVkZWYge29iamVjdH0gQmFja2dyb3VuZEpvYkNvbnRleHRcbiAqIEBwcm9wZXJ0eSB7dHlwZW9mIGltcG9ydChcIi4vcGxhdGZvcm0tam9iLmpzXCIpLmRlZmF1bHR9IGpvYkNsYXNzIC0gQ29uY3JldGUgam9iIGNsYXNzLlxuICogQHByb3BlcnR5IHtzdHJpbmd9IGpvYk5hbWUgLSBSZWdpc3RlcmVkIGpvYiBuYW1lLlxuICogQHByb3BlcnR5IHtBcnJheTxSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59IGFyZ3MgLSBTZXJpYWxpemVkIGpvYiBhcmd1bWVudHMuXG4gKiBAcHJvcGVydHkge0JhY2tncm91bmRKb2JPcHRpb25zfSBvcHRpb25zIC0gUmVzb2x2ZWQgZW5xdWV1ZS9ydW50aW1lIG9wdGlvbnMuXG4gKiBAcHJvcGVydHkge0JhY2tncm91bmRKb2JQYXlsb2FkfSBbcGF5bG9hZF0gLSBDb21wbGV0ZSBwZXJzaXN0ZWQgcnVubmVyIHBheWxvYWQgd2hlbiB0aGUgam9iIGlzIHBlcmZvcm1pbmcuXG4gKi9cbi8qKlxuICogQHR5cGVkZWYge29iamVjdH0gQmFja2dyb3VuZEpvYlJvd1xuICogQHByb3BlcnR5IHtzdHJpbmd9IGlkIC0gSm9iIGlkLlxuICogQHByb3BlcnR5IHtzdHJpbmd9IGpvYk5hbWUgLSBKb2IgY2xhc3MgbmFtZS5cbiAqIEBwcm9wZXJ0eSB7QXJyYXk8UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSBhcmdzIC0gU2VyaWFsaXplZCBqb2IgYXJndW1lbnRzLlxuICogQHByb3BlcnR5IHtCYWNrZ3JvdW5kSm9iRXhlY3V0aW9uTW9kZX0gZXhlY3V0aW9uTW9kZSAtIEhvdyB0aGUgam9iIHNob3VsZCBydW4uXG4gKiBAcHJvcGVydHkge3N0cmluZ30gcXVldWUgLSBRdWV1ZSBuYW1lIChkZWZhdWx0cyB0byBgXCJkZWZhdWx0XCJgKS5cbiAqIEBwcm9wZXJ0eSB7c3RyaW5nIHwgbnVsbH0gc2NoZWR1bGVLZXkgLSBTdGFibGUgbG9naWNhbCBzY2hlZHVsZSBrZXkgcmV0YWluZWQgZm9yIGhpc3RvcnkuXG4gKiBAcHJvcGVydHkge251bWJlciB8IG51bGx9IHNjaGVkdWxlT3JkZXIgLSBUcmFuc2FjdGlvbi1hc3NpZ25lZCBtb25vdG9uaWMgb3duZXJzaGlwIG9yZGVyIGZvciB0aGlzIHNjaGVkdWxlIGtleTsgTm9kZSBwcmVzZXJ2ZXMgaXRzIGhpZ2gtd2F0ZXIgbWFyayBhY3Jvc3MgdGVybWluYWwtaGlzdG9yeSBwcnVuaW5nLiBOdWxsIGZvciBsZWdhY3kvbm9uLXNjaGVkdWxlZCByb3dzLlxuICogQHByb3BlcnR5IHtCYWNrZ3JvdW5kSm9iU3RhdHVzfSBzdGF0dXMgLSBDdXJyZW50IGpvYiBzdGF0dXMuXG4gKiBAcHJvcGVydHkge251bWJlciB8IG51bGx9IGF0dGVtcHRzIC0gRmFpbHVyZSBhdHRlbXB0cyBjb3VudC5cbiAqIEBwcm9wZXJ0eSB7bnVtYmVyIHwgbnVsbH0gbWF4UmV0cmllcyAtIE1heCByZXRyeSBhdHRlbXB0cy5cbiAqIEBwcm9wZXJ0eSB7bnVtYmVyIHwgbnVsbH0gc2NoZWR1bGVkQXRNcyAtIE5leHQgc2NoZWR1bGVkIHRpbWUgaW4gbXMuXG4gKiBAcHJvcGVydHkge251bWJlciB8IG51bGx9IGNyZWF0ZWRBdE1zIC0gQ3JlYXRpb24gdGltZSBpbiBtcy5cbiAqIEBwcm9wZXJ0eSB7bnVtYmVyIHwgbnVsbH0gaGFuZGVkT2ZmQXRNcyAtIFRpbWUgaGFuZGVkIHRvIHdvcmtlciBpbiBtcy5cbiAqIEBwcm9wZXJ0eSB7c3RyaW5nIHwgbnVsbH0gaGFuZG9mZklkIC0gVW5pcXVlIGxhdGVzdCBoYW5kb2ZmIGxlYXNlIGlkLlxuICogQHByb3BlcnR5IHtudW1iZXIgfCBudWxsfSBjb21wbGV0ZWRBdE1zIC0gQ29tcGxldGlvbiB0aW1lIGluIG1zLlxuICogQHByb3BlcnR5IHtudW1iZXIgfCBudWxsfSBmYWlsZWRBdE1zIC0gRmFpbHVyZSB0aW1lIGluIG1zLlxuICogQHByb3BlcnR5IHtudW1iZXIgfCBudWxsfSBvcnBoYW5lZEF0TXMgLSBPcnBoYW5lZCB0aW1lIGluIG1zLlxuICogQHByb3BlcnR5IHtzdHJpbmcgfCBudWxsfSB3b3JrZXJJZCAtIFdvcmtlciBpZCBoYW5kbGluZyB0aGUgam9iLlxuICogQHByb3BlcnR5IHtzdHJpbmcgfCBudWxsfSBsYXN0RXJyb3IgLSBMYXN0IGZhaWx1cmUgbWVzc2FnZS5cbiAqIEBwcm9wZXJ0eSB7c3RyaW5nIHwgbnVsbH0gY29uY3VycmVuY3lLZXkgLSBEdXJhYmxlIGNvbmN1cnJlbmN5IGtleS5cbiAqIEBwcm9wZXJ0eSB7bnVtYmVyIHwgbnVsbH0gbWF4Q29uY3VycmVuY3kgLSBEdXJhYmxlIHBlci1rZXkgY2FwLlxuICogQHByb3BlcnR5IHtudW1iZXIgfCBudWxsfSB0aW1lb3V0TXMgLSBQZXItam9iIHdhbGwtY2xvY2sgdGltZW91dCBvdmVycmlkZSwgb3IgbnVsbCB3aGVuIG9taXR0ZWQuXG4gKiBAcHJvcGVydHkge251bWJlciB8IG51bGx9IGNoaWxkUmVjZWl2ZWRBdE1zIC0gRXBvY2ggbXMgd2hlbiB0aGUgZXhlY3V0aW5nIHBvb2xlZCBjaGlsZCdzIGV2ZW50IGxvb3AgcHJvY2Vzc2VkIHRoZSBqb2IgbWVzc2FnZSwgb3IgbnVsbCB3aGVuIG5vIHJ1bm5lciBhY2NlcHRlZCBpdCB5ZXQuXG4gKiBAcHJvcGVydHkge251bWJlciB8IG51bGx9IGNoaWxkU3RhcnRlZEF0TXMgLSBFcG9jaCBtcyB3aGVuIHRoZSBqb2IncyBwZXJmb3JtIHN0YXJ0ZWQgaW4gdGhlIHBvb2xlZCBjaGlsZCwgb3IgbnVsbCB3aGVuIGl0IG5ldmVyIHN0YXJ0ZWQuXG4gKiBAcHJvcGVydHkge3N0cmluZyB8IG51bGx9IGNoaWxkSW5zdGFuY2VJZCAtIFN0YWJsZSBpZGVudGl0eSBvZiB0aGUgcG9vbGVkIGNoaWxkIHByb2Nlc3MgdGhhdCBhY2NlcHRlZCB0aGUgam9iLCBvciBudWxsLlxuICogQHByb3BlcnR5IHtudW1iZXIgfCBudWxsfSBjaGlsZFBpZCAtIE9TIHBpZCBvZiB0aGUgcG9vbGVkIGNoaWxkIHByb2Nlc3MgdGhhdCBhY2NlcHRlZCB0aGUgam9iLCBvciBudWxsLlxuICovXG4vKipcbiAqIEB0eXBlZGVmIHtcInF1ZXVlZFwiIHwgXCJoYW5kZWRfb2ZmXCIgfCBudWxsfSBCYWNrZ3JvdW5kSm9iUmVwbGFjZW1lbnRQcmV2aW91c1N0YXR1c1xuICovXG4vKipcbiAqIEB0eXBlZGVmIHtvYmplY3R9IEJhY2tncm91bmRKb2JSZXBsYWNlbWVudFJlc3VsdFxuICogQHByb3BlcnR5IHtzdHJpbmd9IGpvYklkIC0gTmV3bHkgcXVldWVkIGpvYiBpZC5cbiAqIEBwcm9wZXJ0eSB7c3RyaW5nIHwgbnVsbH0gcHJldmlvdXNKb2JJZCAtIFByZXZpb3VzIGFjdGl2ZSBvd25lcidzIGpvYiBpZC5cbiAqIEBwcm9wZXJ0eSB7QmFja2dyb3VuZEpvYlJlcGxhY2VtZW50UHJldmlvdXNTdGF0dXN9IHByZXZpb3VzU3RhdHVzIC0gUHJldmlvdXMgb3duZXIncyBvYnNlcnZlZCBzdGF0ZS5cbiAqL1xuLyoqXG4gKiBAdHlwZWRlZiB7XCJjYW5jZWxsZWRcIiB8IFwiaGFuZGVkX29mZlwiIHwgXCJub3RfZm91bmRcIn0gQmFja2dyb3VuZEpvYkNhbmNlbGxhdGlvbk91dGNvbWVcbiAqL1xuLyoqXG4gKiBAdHlwZWRlZiB7b2JqZWN0fSBCYWNrZ3JvdW5kSm9iQ2FuY2VsbGF0aW9uUmVzdWx0XG4gKiBAcHJvcGVydHkge3N0cmluZyB8IG51bGx9IGpvYklkIC0gRGV0YWNoZWQgb3duZXIncyBqb2IgaWQsIHdoZW4gb25lIHdhcyBhY3RpdmUuXG4gKiBAcHJvcGVydHkge0JhY2tncm91bmRKb2JDYW5jZWxsYXRpb25PdXRjb21lfSBvdXRjb21lIC0gVHJ1dGhmdWwgYmVzdC1lZmZvcnQgb3V0Y29tZS5cbiAqL1xuLyoqXG4gKiBAdHlwZWRlZiB7b2JqZWN0fSBCYWNrZ3JvdW5kSm9iU2NoZWR1bGVkTG9va3VwUmVzdWx0XG4gKiBAcHJvcGVydHkge0JhY2tncm91bmRKb2JSb3cgfCBudWxsfSBjdXJyZW50Sm9iIC0gQ3VycmVudCBxdWV1ZWQgb3IgaGFuZGVkLW9mZiBvd25lci5cbiAqIEBwcm9wZXJ0eSB7QmFja2dyb3VuZEpvYlJvdyB8IG51bGx9IGxhdGVzdFRlcm1pbmFsSm9iIC0gTGF0ZXN0IHRlcm1pbmFsIGhpc3Rvcnkgd2hlbiByZXF1ZXN0ZWQuXG4gKi9cbi8qKlxuICogQHR5cGVkZWYge1wid29rZW5cIiB8IFwiYWxyZWFkeV9kdWVcIiB8IFwiaGFuZGVkX29mZlwiIHwgXCJub3RfZm91bmRcIn0gQmFja2dyb3VuZEpvYldha2VPdXRjb21lXG4gKi9cbi8qKlxuICogQHR5cGVkZWYge29iamVjdH0gQmFja2dyb3VuZEpvYldha2VSZXN1bHRcbiAqIEBwcm9wZXJ0eSB7c3RyaW5nIHwgbnVsbH0gam9iSWQgLSBDdXJyZW50IG93bmVyJ3MgZHVyYWJsZSBqb2IgaWQsIHdoZW4gZm91bmQuXG4gKiBAcHJvcGVydHkge0JhY2tncm91bmRKb2JXYWtlT3V0Y29tZX0gb3V0Y29tZSAtIEV4YWN0IHdha2Ugb3V0Y29tZS5cbiAqL1xuLyoqXG4gKiBAdHlwZWRlZiB7b2JqZWN0fSBCYWNrZ3JvdW5kSm9iRmFpbHVyZUV2ZW50XG4gKiBAcHJvcGVydHkge0JhY2tncm91bmRKb2JSb3d9IGpvYiAtIFVwZGF0ZWQgam9iIHJvdyBhZnRlciBmYWlsdXJlIGhhbmRsaW5nLlxuICogQHByb3BlcnR5IHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gZXJyb3IgLSBGYWlsdXJlIGVycm9yLlxuICogQHByb3BlcnR5IHtudW1iZXIgfCBudWxsfSBhdHRlbXB0cyAtIFVwZGF0ZWQgZmFpbHVyZSBhdHRlbXB0cyBjb3VudC5cbiAqIEBwcm9wZXJ0eSB7Ym9vbGVhbn0gdGVybWluYWwgLSBXaGV0aGVyIHRoaXMgZmFpbHVyZSBlbmRlZCB0aGUgam9iLlxuICogQHByb3BlcnR5IHtib29sZWFufSB3aWxsUmV0cnkgLSBXaGV0aGVyIHRoZSBqb2Igd2FzIHJldHVybmVkIHRvIHRoZSBxdWV1ZS5cbiAqIEBwcm9wZXJ0eSB7c3RyaW5nIHwgdW5kZWZpbmVkfSBoYW5kb2ZmSWQgLSBIYW5kb2ZmIGxlYXNlIGlkIGZyb20gdGhlIHdvcmtlciByZXBvcnQuXG4gKiBAcHJvcGVydHkge251bWJlciB8IHVuZGVmaW5lZH0gaGFuZGVkT2ZmQXRNcyAtIEhhbmRvZmYgdGltZXN0YW1wIGZyb20gdGhlIHdvcmtlciByZXBvcnQuXG4gKiBAcHJvcGVydHkge3N0cmluZyB8IHVuZGVmaW5lZH0gd29ya2VySWQgLSBXb3JrZXIgaWQgZnJvbSB0aGUgd29ya2VyIHJlcG9ydC5cbiAqIEBwcm9wZXJ0eSB7UG9vbGVkUnVubmVyRmFpbHVyZSB8IHVuZGVmaW5lZH0gcnVubmVyRmFpbHVyZSAtIFNoYXJlZCBwb29sZWQtY2hpbGQgcHJvY2VzcyBmYWlsdXJlIHByb3ZlbmFuY2UuXG4gKi9cbi8qKlxuICogQHR5cGVkZWYge1wid29ya2VyXCIgfCBcImNsaWVudFwiIHwgXCJyZXBvcnRlclwifSBCYWNrZ3JvdW5kSm9iU29ja2V0Um9sZVxuICovXG4vKipcbiAqIEB0eXBlZGVmIHt7dHlwZTogXCJoZWxsb1wiLCByb2xlOiBCYWNrZ3JvdW5kSm9iU29ja2V0Um9sZSwgZ2VuZXJhdGlvbklkPzogc3RyaW5nLCBzdXBwb3J0c0hhbmRvZmZJZFJlcG9ydGluZz86IGJvb2xlYW4sIHN1cHBvcnRzSGVhcnRiZWF0PzogYm9vbGVhbiwgc3VwcG9ydHNQb29sZWQ/OiBib29sZWFuLCB3b3JrZXJJZD86IHN0cmluZ319IEJhY2tncm91bmRKb2JIZWxsb01lc3NhZ2VcbiAqIEB0eXBlZGVmIHt7dHlwZTogXCJnZW5lcmF0aW9uLWFjY2VwdGVkXCIsIGdlbmVyYXRpb25JZDogc3RyaW5nLCBsaWZlY3ljbGVTdGF0ZTogQmFja2dyb3VuZEpvYnNHZW5lcmF0aW9uTGlmZWN5Y2xlU3RhdGV9fSBCYWNrZ3JvdW5kSm9iR2VuZXJhdGlvbkFjY2VwdGVkTWVzc2FnZVxuICogQHR5cGVkZWYge3t0eXBlOiBcImdlbmVyYXRpb24tcmVqZWN0ZWRcIiwgcmVhc29uOiBCYWNrZ3JvdW5kSm9ic0dlbmVyYXRpb25SZWplY3Rpb25SZWFzb259fSBCYWNrZ3JvdW5kSm9iR2VuZXJhdGlvblJlamVjdGVkTWVzc2FnZVxuICogQHR5cGVkZWYge3t0eXBlOiBcInJlYWR5XCIsIGFjY2VwdHNGb3JrZWQ/OiBib29sZWFuLCBhY2NlcHRzSW5saW5lPzogYm9vbGVhbiwgYWNjZXB0c1Bvb2xlZD86IGJvb2xlYW4sIGFjY2VwdHNTcGF3bmVkPzogYm9vbGVhbiwgYXZhaWxhYmxlUG9vbGVkU2xvdHM/OiBudW1iZXJ9fSBCYWNrZ3JvdW5kSm9iUmVhZHlNZXNzYWdlXG4gKiBAdHlwZWRlZiB7e3R5cGU6IFwiZHJhaW5pbmdcIn19IEJhY2tncm91bmRKb2JEcmFpbmluZ01lc3NhZ2VcbiAqIEB0eXBlZGVmIHt7dHlwZTogXCJoZWFydGJlYXRcIiwgd29ya2VySWQ/OiBzdHJpbmd9fSBCYWNrZ3JvdW5kSm9iSGVhcnRiZWF0TWVzc2FnZVxuICogQHR5cGVkZWYge3t0eXBlOiBcImVucXVldWVcIiwgam9iTmFtZTogc3RyaW5nLCBhcmdzPzogQXJyYXk8UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+LCBvcHRpb25zPzogQmFja2dyb3VuZEpvYk9wdGlvbnMsIHByb2R1Y2VySW52b2NhdGlvbklkPzogc3RyaW5nLCBwcm9kdWNlclByb29mPzogQmFja2dyb3VuZEpvYlByb2R1Y2VyUHJvb2Z9fSBCYWNrZ3JvdW5kSm9iRW5xdWV1ZU1lc3NhZ2VcbiAqIEB0eXBlZGVmIHt7dHlwZTogXCJlbnF1ZXVlZFwiLCBqb2JJZDogc3RyaW5nfX0gQmFja2dyb3VuZEpvYkVucXVldWVkTWVzc2FnZVxuICogQHR5cGVkZWYge3t0eXBlOiBcImVucXVldWUtZXJyb3JcIiwgZXJyb3I/OiBzdHJpbmd9fSBCYWNrZ3JvdW5kSm9iRW5xdWV1ZUVycm9yTWVzc2FnZVxuICogQHR5cGVkZWYge3t0eXBlOiBcInJlcGxhY2Utc2NoZWR1bGVkXCIsIHNjaGVkdWxlS2V5OiBzdHJpbmcsIGpvYk5hbWU6IHN0cmluZywgYXJncz86IEFycmF5PFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Piwgb3B0aW9ucz86IEJhY2tncm91bmRKb2JPcHRpb25zfX0gQmFja2dyb3VuZEpvYlJlcGxhY2VTY2hlZHVsZWRNZXNzYWdlXG4gKiBAdHlwZWRlZiB7e3R5cGU6IFwic2NoZWR1bGUtcmVwbGFjZWRcIiwgam9iSWQ6IHN0cmluZywgcHJldmlvdXNKb2JJZDogc3RyaW5nIHwgbnVsbCwgcHJldmlvdXNTdGF0dXM6IEJhY2tncm91bmRKb2JSZXBsYWNlbWVudFByZXZpb3VzU3RhdHVzfX0gQmFja2dyb3VuZEpvYlNjaGVkdWxlUmVwbGFjZWRNZXNzYWdlXG4gKiBAdHlwZWRlZiB7e3R5cGU6IFwicmVwbGFjZS1zY2hlZHVsZWQtZXJyb3JcIiwgZXJyb3I/OiBzdHJpbmd9fSBCYWNrZ3JvdW5kSm9iUmVwbGFjZVNjaGVkdWxlZEVycm9yTWVzc2FnZVxuICogQHR5cGVkZWYge3t0eXBlOiBcImNhbmNlbC1zY2hlZHVsZWRcIiwgc2NoZWR1bGVLZXk6IHN0cmluZ319IEJhY2tncm91bmRKb2JDYW5jZWxTY2hlZHVsZWRNZXNzYWdlXG4gKiBAdHlwZWRlZiB7e3R5cGU6IFwic2NoZWR1bGUtY2FuY2VsbGVkXCIsIGpvYklkOiBzdHJpbmcgfCBudWxsLCBvdXRjb21lOiBCYWNrZ3JvdW5kSm9iQ2FuY2VsbGF0aW9uT3V0Y29tZX19IEJhY2tncm91bmRKb2JTY2hlZHVsZUNhbmNlbGxlZE1lc3NhZ2VcbiAqIEB0eXBlZGVmIHt7dHlwZTogXCJjYW5jZWwtc2NoZWR1bGVkLWVycm9yXCIsIGVycm9yPzogc3RyaW5nfX0gQmFja2dyb3VuZEpvYkNhbmNlbFNjaGVkdWxlZEVycm9yTWVzc2FnZVxuICogQHR5cGVkZWYge3t0eXBlOiBcImdldC1zY2hlZHVsZWQtam9iXCIsIHNjaGVkdWxlS2V5OiBzdHJpbmcsIGluY2x1ZGVMYXRlc3RUZXJtaW5hbD86IGJvb2xlYW59fSBCYWNrZ3JvdW5kSm9iR2V0U2NoZWR1bGVkTWVzc2FnZVxuICogQHR5cGVkZWYge3t0eXBlOiBcInNjaGVkdWxlZC1qb2JcIiwgY3VycmVudEpvYjogQmFja2dyb3VuZEpvYlJvdyB8IG51bGwsIGxhdGVzdFRlcm1pbmFsSm9iOiBCYWNrZ3JvdW5kSm9iUm93IHwgbnVsbH19IEJhY2tncm91bmRKb2JTY2hlZHVsZWRNZXNzYWdlXG4gKiBAdHlwZWRlZiB7e3R5cGU6IFwiZ2V0LXNjaGVkdWxlZC1qb2ItZXJyb3JcIiwgZXJyb3I/OiBzdHJpbmd9fSBCYWNrZ3JvdW5kSm9iR2V0U2NoZWR1bGVkRXJyb3JNZXNzYWdlXG4gKiBAdHlwZWRlZiB7e3R5cGU6IFwid2FrZS1zY2hlZHVsZWRcIiwgc2NoZWR1bGVLZXk6IHN0cmluZ319IEJhY2tncm91bmRKb2JXYWtlU2NoZWR1bGVkTWVzc2FnZVxuICogQHR5cGVkZWYge3t0eXBlOiBcInNjaGVkdWxlLXdva2VuXCIsIGpvYklkOiBzdHJpbmcgfCBudWxsLCBvdXRjb21lOiBCYWNrZ3JvdW5kSm9iV2FrZU91dGNvbWV9fSBCYWNrZ3JvdW5kSm9iU2NoZWR1bGVXb2tlbk1lc3NhZ2VcbiAqIEB0eXBlZGVmIHt7dHlwZTogXCJ3YWtlLXNjaGVkdWxlZC1lcnJvclwiLCBlcnJvcj86IHN0cmluZ319IEJhY2tncm91bmRKb2JXYWtlU2NoZWR1bGVkRXJyb3JNZXNzYWdlXG4gKiBAdHlwZWRlZiB7e3R5cGU6IFwiam9iXCIsIHBheWxvYWQ6IEJhY2tncm91bmRKb2JQYXlsb2FkfX0gQmFja2dyb3VuZEpvYkpvYk1lc3NhZ2VcbiAqIEB0eXBlZGVmIHt7dHlwZTogXCJqb2ItYWNjZXB0ZWRcIiwgam9iSWQ6IHN0cmluZywgaGFuZG9mZklkPzogc3RyaW5nLCB3b3JrZXJJZD86IHN0cmluZywgaGFuZGVkT2ZmQXRNcz86IG51bWJlciwgcmVjZWl2ZWRBdE1zPzogbnVtYmVyLCBzdGFydGVkQXRNcz86IG51bWJlciwgY2hpbGRJbnN0YW5jZUlkPzogc3RyaW5nLCBjaGlsZFBpZD86IG51bWJlcn19IEJhY2tncm91bmRKb2JBY2NlcHRlZE1lc3NhZ2VcbiAqIEB0eXBlZGVmIHt7dHlwZTogXCJqb2ItY29tcGxldGVcIiwgam9iSWQ6IHN0cmluZywgaGFuZG9mZklkPzogc3RyaW5nLCB3b3JrZXJJZD86IHN0cmluZywgaGFuZGVkT2ZmQXRNcz86IG51bWJlcn19IEJhY2tncm91bmRKb2JDb21wbGV0ZU1lc3NhZ2VcbiAqIEB0eXBlZGVmIHt7dHlwZTogXCJqb2ItZmFpbGVkXCIsIGpvYklkOiBzdHJpbmcsIGVycm9yPzogUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4sIGhhbmRvZmZJZD86IHN0cmluZywgd29ya2VySWQ/OiBzdHJpbmcsIGhhbmRlZE9mZkF0TXM/OiBudW1iZXIsIHJ1bm5lckZhaWx1cmU/OiBQb29sZWRSdW5uZXJGYWlsdXJlfX0gQmFja2dyb3VuZEpvYkZhaWxlZE1lc3NhZ2VcbiAqIEB0eXBlZGVmIHt7dHlwZTogXCJqb2ItcmVzY2hlZHVsZVwiLCBqb2JJZDogc3RyaW5nLCBkZWxheU1zOiBudW1iZXIsIGhhbmRvZmZJZD86IHN0cmluZywgd29ya2VySWQ/OiBzdHJpbmcsIGhhbmRlZE9mZkF0TXM/OiBudW1iZXJ9fSBCYWNrZ3JvdW5kSm9iUmVzY2hlZHVsZU1lc3NhZ2VcbiAqIEB0eXBlZGVmIHt7dHlwZTogXCJqb2ItdXBkYXRlZFwiLCBqb2JJZDogc3RyaW5nfX0gQmFja2dyb3VuZEpvYlVwZGF0ZWRNZXNzYWdlXG4gKiBAdHlwZWRlZiB7e3R5cGU6IFwiam9iLXVwZGF0ZS1lcnJvclwiLCBqb2JJZDogc3RyaW5nLCBlcnJvcj86IHN0cmluZ319IEJhY2tncm91bmRKb2JVcGRhdGVFcnJvck1lc3NhZ2VcbiAqL1xuLyoqXG4gKiBAdHlwZWRlZiB7QmFja2dyb3VuZEpvYkhlbGxvTWVzc2FnZSB8IEJhY2tncm91bmRKb2JHZW5lcmF0aW9uQWNjZXB0ZWRNZXNzYWdlIHwgQmFja2dyb3VuZEpvYkdlbmVyYXRpb25SZWplY3RlZE1lc3NhZ2UgfCBCYWNrZ3JvdW5kSm9iUmVhZHlNZXNzYWdlIHwgQmFja2dyb3VuZEpvYkRyYWluaW5nTWVzc2FnZSB8IEJhY2tncm91bmRKb2JIZWFydGJlYXRNZXNzYWdlIHwgQmFja2dyb3VuZEpvYkVucXVldWVNZXNzYWdlIHwgQmFja2dyb3VuZEpvYkVucXVldWVkTWVzc2FnZSB8IEJhY2tncm91bmRKb2JFbnF1ZXVlRXJyb3JNZXNzYWdlIHwgQmFja2dyb3VuZEpvYlJlcGxhY2VTY2hlZHVsZWRNZXNzYWdlIHwgQmFja2dyb3VuZEpvYlNjaGVkdWxlUmVwbGFjZWRNZXNzYWdlIHwgQmFja2dyb3VuZEpvYlJlcGxhY2VTY2hlZHVsZWRFcnJvck1lc3NhZ2UgfCBCYWNrZ3JvdW5kSm9iQ2FuY2VsU2NoZWR1bGVkTWVzc2FnZSB8IEJhY2tncm91bmRKb2JTY2hlZHVsZUNhbmNlbGxlZE1lc3NhZ2UgfCBCYWNrZ3JvdW5kSm9iQ2FuY2VsU2NoZWR1bGVkRXJyb3JNZXNzYWdlIHwgQmFja2dyb3VuZEpvYkdldFNjaGVkdWxlZE1lc3NhZ2UgfCBCYWNrZ3JvdW5kSm9iU2NoZWR1bGVkTWVzc2FnZSB8IEJhY2tncm91bmRKb2JHZXRTY2hlZHVsZWRFcnJvck1lc3NhZ2UgfCBCYWNrZ3JvdW5kSm9iV2FrZVNjaGVkdWxlZE1lc3NhZ2UgfCBCYWNrZ3JvdW5kSm9iU2NoZWR1bGVXb2tlbk1lc3NhZ2UgfCBCYWNrZ3JvdW5kSm9iV2FrZVNjaGVkdWxlZEVycm9yTWVzc2FnZSB8IEJhY2tncm91bmRKb2JKb2JNZXNzYWdlIHwgQmFja2dyb3VuZEpvYkFjY2VwdGVkTWVzc2FnZSB8IEJhY2tncm91bmRKb2JDb21wbGV0ZU1lc3NhZ2UgfCBCYWNrZ3JvdW5kSm9iRmFpbGVkTWVzc2FnZSB8IEJhY2tncm91bmRKb2JSZXNjaGVkdWxlTWVzc2FnZSB8IEJhY2tncm91bmRKb2JVcGRhdGVkTWVzc2FnZSB8IEJhY2tncm91bmRKb2JVcGRhdGVFcnJvck1lc3NhZ2V9IEJhY2tncm91bmRKb2JTb2NrZXRNZXNzYWdlXG4gKi9cblxuZXhwb3J0IGNvbnN0IG5vdGhpbmcgPSB7fVxuIl19