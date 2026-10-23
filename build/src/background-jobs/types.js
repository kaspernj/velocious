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
/** @typedef {"exit" | "process-error" | "ipc-send" | "child-silence"} PooledRunnerFailureOrigin */
/** @typedef {"starting" | "running" | "retiring"} PooledRunnerLifecycleState */
/** @typedef {"parent_retire_drained" | "job_timeout" | "worker_stop" | "child_silence" | "signal_sigterm" | "signal_sigint" | "signal_sigkill" | "signal_other" | "ipc_disconnect" | "process_error" | "unexpected_exit"} PooledChildShutdownReason */
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
 * @property {number} [priority] - Dispatch priority within the queue: higher runs first, default `0`, retries always run last.
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
 * @property {number} priority - Dispatch priority; `-1` means retried and therefore queued last.
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
 * @property {string | null} runnerHostname - Hostname reported by the pooled child process that accepted the job, or null.
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
 * @typedef {{type: "job-accepted", jobId: string, handoffId?: string, workerId?: string, handedOffAtMs?: number, receivedAtMs?: number, startedAtMs?: number, childInstanceId?: string, childPid?: number, runnerHostname?: string}} BackgroundJobAcceptedMessage
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoidHlwZXMuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi9zcmMvYmFja2dyb3VuZC1qb2JzL3R5cGVzLmpzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiJBQUFBLFlBQVk7QUFFWjs7R0FFRztBQUNILHlGQUF5RjtBQUN6RixpSUFBaUk7QUFDakksNk5BQTZOO0FBQzdOLG1FQUFtRTtBQUNuRSwrRkFBK0Y7QUFDL0YsNkZBQTZGO0FBQzdGLG1HQUFtRztBQUNuRyxnRkFBZ0Y7QUFDaEYsdVBBQXVQO0FBQ3ZQOzs7R0FHRztBQUNILHdGQUF3RjtBQUN4Rjs7Ozs7Ozs7R0FRRztBQUNIOzs7Ozs7O0dBT0c7QUFDSDs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7O0dBMkJHO0FBQ0g7Ozs7Ozs7Ozs7R0FVRztBQUNIOzs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7R0FxQkc7QUFDSDs7Ozs7R0FLRztBQUNIOzs7OztHQUtHO0FBQ0g7Ozs7O0dBS0c7QUFDSDs7Ozs7OztHQU9HO0FBQ0g7Ozs7Ozs7Ozs7OztHQVlHO0FBQ0g7OztHQUdHO0FBQ0g7Ozs7Ozs7R0FPRztBQUNIOzs7OztHQUtHO0FBQ0g7Ozs7OztHQU1HO0FBQ0g7Ozs7O0dBS0c7QUFDSDs7Ozs7Ozs7Ozs7O0dBWUc7QUFDSDs7Ozs7Ozs7O0dBU0c7QUFDSDs7Ozs7OztHQU9HO0FBQ0g7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7OztHQThCRztBQUNIOztHQUVHO0FBQ0g7Ozs7O0dBS0c7QUFDSDs7R0FFRztBQUNIOzs7O0dBSUc7QUFDSDs7OztHQUlHO0FBQ0g7O0dBRUc7QUFDSDs7OztHQUlHO0FBQ0g7Ozs7Ozs7Ozs7O0dBV0c7QUFDSDs7R0FFRztBQUNIOzs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7OztHQTZCRztBQUNIOztHQUVHO0FBRUgsTUFBTSxDQUFDLE1BQU0sT0FBTyxHQUFHLEVBQUUsQ0FBQSIsInNvdXJjZXNDb250ZW50IjpbIi8vIEB0cy1jaGVja1xuXG4vKipcbiAqIEB0eXBlZGVmIHtcImlubGluZVwiIHwgXCJmb3JrZWRcIiB8IFwicG9vbGVkXCIgfCBcInNwYXduZWRcIn0gQmFja2dyb3VuZEpvYkV4ZWN1dGlvbk1vZGVcbiAqL1xuLyoqIEB0eXBlZGVmIHtcImNhbmRpZGF0ZVwiIHwgXCJhY3RpdmVcIiB8IFwicmV0aXJlZFwifSBCYWNrZ3JvdW5kSm9ic0dlbmVyYXRpb25Jbml0aWFsU3RhdGUgKi9cbi8qKiBAdHlwZWRlZiB7XCJzdGFydGluZ1wiIHwgXCJjYW5kaWRhdGVcIiB8IFwiYWN0aXZlXCIgfCBcInJldGlyaW5nXCIgfCBcInJldGlyZWRcIiB8IFwic3RvcHBlZFwifSBCYWNrZ3JvdW5kSm9ic0dlbmVyYXRpb25MaWZlY3ljbGVTdGF0ZSAqL1xuLyoqIEB0eXBlZGVmIHtcIm1pc3NpbmctZ2VuZXJhdGlvblwiIHwgXCJ1bmV4cGVjdGVkLWdlbmVyYXRpb25cIiB8IFwibWFsZm9ybWVkLWdlbmVyYXRpb25cIiB8IFwiZ2VuZXJhdGlvbi1taXNtYXRjaFwiIHwgXCJ3b3JrZXItYWRtaXNzaW9uLXJldGlyZWRcIiB8IFwid29ya2VyLWhhcy1uby1yZWNvdmVyYWJsZS1oYW5kb2Zmc1wifSBCYWNrZ3JvdW5kSm9ic0dlbmVyYXRpb25SZWplY3Rpb25SZWFzb24gKi9cbi8qKiBAdHlwZWRlZiB7XCJxdWV1ZWRcIiB8IFwiaGFuZGVkX29mZlwifSBCYWNrZ3JvdW5kSm9iQWN0aXZlU3RhdHVzICovXG4vKiogQHR5cGVkZWYge1wiY2FuY2VsbGVkXCIgfCBcImNvbXBsZXRlZFwiIHwgXCJmYWlsZWRcIiB8IFwib3JwaGFuZWRcIn0gQmFja2dyb3VuZEpvYlRlcm1pbmFsU3RhdHVzICovXG4vKiogQHR5cGVkZWYge0JhY2tncm91bmRKb2JBY3RpdmVTdGF0dXMgfCBCYWNrZ3JvdW5kSm9iVGVybWluYWxTdGF0dXN9IEJhY2tncm91bmRKb2JTdGF0dXMgKi9cbi8qKiBAdHlwZWRlZiB7XCJleGl0XCIgfCBcInByb2Nlc3MtZXJyb3JcIiB8IFwiaXBjLXNlbmRcIiB8IFwiY2hpbGQtc2lsZW5jZVwifSBQb29sZWRSdW5uZXJGYWlsdXJlT3JpZ2luICovXG4vKiogQHR5cGVkZWYge1wic3RhcnRpbmdcIiB8IFwicnVubmluZ1wiIHwgXCJyZXRpcmluZ1wifSBQb29sZWRSdW5uZXJMaWZlY3ljbGVTdGF0ZSAqL1xuLyoqIEB0eXBlZGVmIHtcInBhcmVudF9yZXRpcmVfZHJhaW5lZFwiIHwgXCJqb2JfdGltZW91dFwiIHwgXCJ3b3JrZXJfc3RvcFwiIHwgXCJjaGlsZF9zaWxlbmNlXCIgfCBcInNpZ25hbF9zaWd0ZXJtXCIgfCBcInNpZ25hbF9zaWdpbnRcIiB8IFwic2lnbmFsX3NpZ2tpbGxcIiB8IFwic2lnbmFsX290aGVyXCIgfCBcImlwY19kaXNjb25uZWN0XCIgfCBcInByb2Nlc3NfZXJyb3JcIiB8IFwidW5leHBlY3RlZF9leGl0XCJ9IFBvb2xlZENoaWxkU2h1dGRvd25SZWFzb24gKi9cbi8qKlxuICogQGRlcHJlY2F0ZWQgVXNlIFBvb2xlZENoaWxkU2h1dGRvd25SZWFzb24gZm9yIGV4YWN0IHNodXRkb3duIHByb3ZlbmFuY2UuXG4gKiBAdHlwZWRlZiB7XCJ1bmV4cGVjdGVkXCIgfCBcImpvYi10aW1lb3V0XCIgfCBcIndvcmtlci1zaHV0ZG93bi10aW1lb3V0XCJ9IFBvb2xlZFJ1bm5lclRlcm1pbmF0aW9uUmVhc29uXG4gKi9cbi8qKiBAdHlwZWRlZiB7XCJydW5uaW5nXCIgfCBcInJldGlyaW5nXCIgfCBcInN0b3BwaW5nXCJ9IEJhY2tncm91bmRKb2JzV29ya2VyTGlmZWN5Y2xlU3RhdGUgKi9cbi8qKlxuICogRXhhY3QgZHVyYWJsZSBoYW5kb2ZmIG93bmVyc2hpcCBjYXJyaWVkIGJ5IGFuIGV4ZWN1dGluZyBqb2Igd2hlbiBpdCBwcm9kdWNlc1xuICogZm9sbG93LXVwIHdvcmsuXG4gKiBAdHlwZWRlZiB7b2JqZWN0fSBCYWNrZ3JvdW5kSm9iUHJvZHVjZXJQcm9vZlxuICogQHByb3BlcnR5IHtzdHJpbmd9IGpvYklkIC0gUHJvZHVjaW5nIGpvYiBpZC5cbiAqIEBwcm9wZXJ0eSB7c3RyaW5nfSBoYW5kb2ZmSWQgLSBQcm9kdWNpbmcgaGFuZG9mZiBsZWFzZSBpZC5cbiAqIEBwcm9wZXJ0eSB7c3RyaW5nfSB3b3JrZXJJZCAtIFdvcmtlciBpZGVudGl0eSBwZXJzaXN0ZWQgd2l0aCB0aGUgaGFuZG9mZi5cbiAqIEBwcm9wZXJ0eSB7bnVtYmVyfSBoYW5kZWRPZmZBdE1zIC0gRHVyYWJsZSBoYW5kb2ZmIHRpbWVzdGFtcC5cbiAqL1xuLyoqXG4gKiBAdHlwZWRlZiB7b2JqZWN0fSBQb29sZWRSdW5uZXJBY3RpdmVKb2JcbiAqIEBwcm9wZXJ0eSB7c3RyaW5nIHwgbnVsbH0gaGFuZG9mZklkIC0gRHVyYWJsZSBoYW5kb2ZmIGxlYXNlIGlkLlxuICogQHByb3BlcnR5IHtudW1iZXIgfCBudWxsfSBoYW5kZWRPZmZBdE1zIC0gRHVyYWJsZSBoYW5kb2ZmIHRpbWVzdGFtcC5cbiAqIEBwcm9wZXJ0eSB7c3RyaW5nfSBqb2JJZCAtIER1cmFibGUgYmFja2dyb3VuZCBqb2IgaWQuXG4gKiBAcHJvcGVydHkge3N0cmluZ30gam9iTmFtZSAtIFJlZ2lzdGVyZWQgam9iIGNsYXNzIG5hbWUuXG4gKiBAcHJvcGVydHkge3N0cmluZ30gd29ya2VySWQgLSBXb3JrZXIgaWRlbnRpdHkgcGVyc2lzdGVkIHdpdGggdGhlIGhhbmRvZmYuXG4gKi9cbi8qKlxuICogT25lIHByb2Nlc3MtZmFpbHVyZSBzbmFwc2hvdCBzaGFyZWQgYnkgZXZlcnkgam9iIGxvc3Qgd2l0aCBhIHBvb2xlZCBjaGlsZC5cbiAqIEB0eXBlZGVmIHtvYmplY3R9IFBvb2xlZFJ1bm5lckZhaWx1cmVcbiAqIEBwcm9wZXJ0eSB7UG9vbGVkUnVubmVyQWN0aXZlSm9iW119IGFjdGl2ZUpvYnMgLSBKb2JzIHRoYXQgd2VyZSBpbiBmbGlnaHQgd2hlbiB0aGUgY2hpbGQgZmFpbGVkLCBvcmRlcmVkIGJ5IGpvYiBpZC5cbiAqIEBwcm9wZXJ0eSB7c3RyaW5nIHwgbnVsbH0gY2hpbGRJbnN0YW5jZUlkIC0gU3RhYmxlIHBvb2xlZC1jaGlsZCBpZGVudGl0eSB3aGVuIGl0cyBzdGFydHVwIG9yIHNodXRkb3duIG9ic2VydmF0aW9uIGFycml2ZWQuXG4gKiBAcHJvcGVydHkge251bWJlciB8IG51bGx9IGV4aXRDb2RlIC0gQ2hpbGQgZXhpdCBjb2RlLCBvciBudWxsIGZvciBzaWduYWwvcHJvY2VzcyBlcnJvcnMuXG4gKiBAcHJvcGVydHkge3N0cmluZyB8IG51bGx9IGdlbmVyYXRpb25JZCAtIFJlbGVhc2UgZ2VuZXJhdGlvbiBpZGVudGl0eSwgb3IgbnVsbCBpbiBsZWdhY3kgbW9kZS5cbiAqIEBwcm9wZXJ0eSB7c3RyaW5nW119IGluZmxpZ2h0Sm9iSWRzIC0gQm91bmRlZCBqb2IgaWRzIGluIGZsaWdodCB3aGVuIGZhaWx1cmUgaGFuZGxpbmcgc3RhcnRlZC5cbiAqIEBwcm9wZXJ0eSB7bnVtYmVyfSBpbmZsaWdodEpvYklkc1RydW5jYXRlZENvdW50IC0gSW4tZmxpZ2h0IGlkcyBvbWl0dGVkIGZyb20gdGhlIGJvdW5kZWQgc25hcHNob3QuXG4gKiBAcHJvcGVydHkge2Jvb2xlYW4gfCBudWxsfSBvb21LaWxsZWQgLSBGYWxzZSB3aGVuIHRoZSBvYnNlcnZlZCBleGl0IHJ1bGVzIE9PTSBvdXQ7IG51bGwgd2hlbiBhbiB1bmV4cGVjdGVkIFNJR0tJTEwgY2Fubm90IGJlIGRpc3Rpbmd1aXNoZWQgZnJvbSBhbiBPT00ga2lsbCB3aXRob3V0IHN1cGVydmlzb3Iva2VybmVsIGV2aWRlbmNlLlxuICogQHByb3BlcnR5IHtQb29sZWRSdW5uZXJGYWlsdXJlT3JpZ2lufSBvcmlnaW4gLSBXb3JrZXIgb2JzZXJ2YXRpb24gdGhhdCBpbml0aWF0ZWQgZmFpbHVyZSBoYW5kbGluZy5cbiAqIEBwcm9wZXJ0eSB7bnVtYmVyfSBydW5uZXJBZ2VNcyAtIENoaWxkIGFnZSB3aGVuIGZhaWx1cmUgaGFuZGxpbmcgc3RhcnRlZC5cbiAqIEBwcm9wZXJ0eSB7bnVtYmVyfSBydW5uZXJDcmVhdGVkQXRNcyAtIENoaWxkIGNyZWF0aW9uIHRpbWVzdGFtcC5cbiAqIEBwcm9wZXJ0eSB7Ym9vbGVhbn0gcnVubmVyRGV0YWNoZWQgLSBXaGV0aGVyIHRoZSBydW5uZXIgb3duZWQgYSBkZXRhY2hlZCBwcm9jZXNzIGdyb3VwLlxuICogQHByb3BlcnR5IHtudW1iZXJ9IHJ1bm5lckpvYnNSdW4gLSBQcmV2aW91c2x5IGFja25vd2xlZGdlZCBqb2JzIGhhbmRsZWQgYnkgdGhlIGNoaWxkLlxuICogQHByb3BlcnR5IHtQb29sZWRSdW5uZXJMaWZlY3ljbGVTdGF0ZX0gcnVubmVyTGlmZWN5Y2xlIC0gQ2hpbGQgbGlmZWN5Y2xlIGltbWVkaWF0ZWx5IGJlZm9yZSByZWNvdmVyeS5cbiAqIEBwcm9wZXJ0eSB7bnVtYmVyIHwgbnVsbH0gcnVubmVyUGlkIC0gQ2hpbGQgcHJvY2VzcyBpZCB3aGVuIGF2YWlsYWJsZS5cbiAqIEBwcm9wZXJ0eSB7aW1wb3J0KFwibm9kZTpjaGlsZF9wcm9jZXNzXCIpLkNoaWxkUHJvY2Vzc1tcInNpZ25hbENvZGVcIl19IHNpZ25hbCAtIENoaWxkIHRlcm1pbmF0aW9uIHNpZ25hbCB3aGVuIGF2YWlsYWJsZS5cbiAqIEBwcm9wZXJ0eSB7bnVtYmVyIHwgbnVsbH0gc2h1dGRvd25PYnNlcnZlZEF0TXMgLSBUaW1lIHRoZSBjaGlsZCBvciBwYXJlbnQgb2JzZXJ2ZWQgc2h1dGRvd24gYmVnaW5uaW5nLlxuICogQHByb3BlcnR5IHtudW1iZXIgfCBudWxsfSBzaHV0ZG93blJlcXVlc3RlZEF0TXMgLSBFeGFjdCBwYXJlbnQgcmVxdWVzdCB0aW1lc3RhbXAsIG9yIG51bGwgZm9yIGV4dGVybmFsL3VucmVxdWVzdGVkIHNodXRkb3duLlxuICogQHByb3BlcnR5IHtQb29sZWRDaGlsZFNodXRkb3duUmVhc29ufSBzaHV0ZG93blJlYXNvbiAtIEV4YWN0IHJlY29yZGVkIHBhcmVudCByZXF1ZXN0IG9yIG9ic2VydmVkIGNoaWxkIHNodXRkb3duIGNhdXNlLlxuICogQHByb3BlcnR5IHtpbXBvcnQoXCJub2RlOmNoaWxkX3Byb2Nlc3NcIikuQ2hpbGRQcm9jZXNzW1wic2lnbmFsQ29kZVwiXX0gc2h1dGRvd25TaWduYWwgLSBQYXJlbnQtcmVxdWVzdGVkIG9yIGNoaWxkLW9ic2VydmVkIHNodXRkb3duIHNpZ25hbCB3aGVuIGF2YWlsYWJsZS5cbiAqIEBwcm9wZXJ0eSB7UG9vbGVkUnVubmVyVGVybWluYXRpb25SZWFzb259IHRlcm1pbmF0aW9uUmVhc29uIC0gRGVwcmVjYXRlZCBjb21wYXRpYmlsaXR5IGNhdGVnb3J5OyB1c2Ugc2h1dGRvd25SZWFzb24gZm9yIGV4YWN0IHByb3ZlbmFuY2UuXG4gKiBAcHJvcGVydHkge3N0cmluZyB8IG51bGx9IHRpbWVvdXRKb2JJZCAtIEpvYiB3aG9zZSB0aW1lb3V0IGluaXRpYXRlZCBjaGlsZCB0ZXJtaW5hdGlvbiwgb3IgbnVsbC5cbiAqIEBwcm9wZXJ0eSB7c3RyaW5nfSB3b3JrZXJJZCAtIFN0YWJsZSBnZW5lcmF0aW9uLXF1YWxpZmllZCB3b3JrZXIgaWQuXG4gKiBAcHJvcGVydHkge0JhY2tncm91bmRKb2JzV29ya2VyTGlmZWN5Y2xlU3RhdGV9IHdvcmtlckxpZmVjeWNsZSAtIFBhcmVudCB3b3JrZXIgbGlmZWN5Y2xlIGltbWVkaWF0ZWx5IGJlZm9yZSByZWNvdmVyeS5cbiAqIEBwcm9wZXJ0eSB7bnVtYmVyfSB3b3JrZXJQaWQgLSBQYXJlbnQgd29ya2VyIHByb2Nlc3MgaWQuXG4gKi9cbi8qKlxuICogQmVzdC1lZmZvcnQgb2JzZXJ2YXRpb24gc2VudCBiZWZvcmUgYSBwb29sZWQgY2hpbGQgY2xvc2VzIGl0cyByZXNvdXJjZXMuXG4gKiBAdHlwZWRlZiB7b2JqZWN0fSBQb29sZWRDaGlsZFNodXRkb3duT2JzZXJ2YXRpb25cbiAqIEBwcm9wZXJ0eSB7c3RyaW5nfSBjaGlsZEluc3RhbmNlSWQgLSBTdGFibGUgcG9vbGVkLWNoaWxkIGlkZW50aXR5LlxuICogQHByb3BlcnR5IHtzdHJpbmdbXX0gaW5mbGlnaHRKb2JJZHMgLSBCb3VuZGVkIGluLWZsaWdodCBkdXJhYmxlIGpvYiBpZHMuXG4gKiBAcHJvcGVydHkge251bWJlcn0gaW5mbGlnaHRKb2JJZHNUcnVuY2F0ZWRDb3VudCAtIEluLWZsaWdodCBpZHMgb21pdHRlZCBmcm9tIHRoZSBib3VuZGVkIHNuYXBzaG90LlxuICogQHByb3BlcnR5IHtQb29sZWRDaGlsZFNodXRkb3duUmVhc29ufSByZWFzb24gLSBTaHV0ZG93biByZWFzb24gb2JzZXJ2ZWQgYnkgdGhlIGNoaWxkLlxuICogQHByb3BlcnR5IHtudW1iZXJ9IHNodXRkb3duT2JzZXJ2ZWRBdE1zIC0gQ2hpbGQgb2JzZXJ2YXRpb24gdGltZXN0YW1wLlxuICogQHByb3BlcnR5IHtudW1iZXIgfCBudWxsfSBzaHV0ZG93blJlcXVlc3RlZEF0TXMgLSBQYXJlbnQgcmVxdWVzdCB0aW1lc3RhbXAgd2hlbiBzdXBwbGllZCBvdmVyIElQQy5cbiAqIEBwcm9wZXJ0eSB7aW1wb3J0KFwibm9kZTpjaGlsZF9wcm9jZXNzXCIpLkNoaWxkUHJvY2Vzc1tcInNpZ25hbENvZGVcIl19IHNpZ25hbCAtIFJlcXVlc3RlZCBvciBvYnNlcnZlZCBzaWduYWwgd2hlbiBhdmFpbGFibGUuXG4gKi9cbi8qKlxuICogQm91bmRlZCBwb29sZWQtY2hpbGQgbWVtb3J5IG9ic2VydmF0aW9uIHNlbnQgb3ZlciB0aGUgY2hpbGQgSVBDIGNoYW5uZWwuXG4gKiBUaGUgcG9vbGVkIGNoaWxkJ3Mgc3RkaW8gaXMgaWdub3JlZCBieSB0aGUgd29ya2VyIGZvcmssIHNvIHRoaXMgb2JzZXJ2YXRpb25cbiAqIChzZW50IHBlcmlvZGljYWxseSB3aGlsZSBqb2JzIHJ1biwgcGx1cyBvbiBkZW1hbmQpIGlzIGhvdyBhIG1lbW9yeSBwcm9ibGVtXG4gKiBpbiBhIHJ1bm5pbmcgY2hpbGQgbmFtZXMgaXRzZWxmLiBgaGVhcFN0YXRpc3RpY3NgIGFuZCBgbWVtb3J5VXNhZ2VgXG4gKiBkaXN0aW5ndWlzaCBWOC1oZWFwIGdyb3d0aCBmcm9tIGV4dGVybmFsL2FycmF5LWJ1ZmZlciAobmF0aXZlIHJlc291cmNlKVxuICogZ3Jvd3RoOyBgYWN0aXZlSm9iSWRzYCB0aWVzIHRoZSBzYW1wbGUgdG8gdGhlIHdvcmsgdGhhdCB3YXMgaW4gZmxpZ2h0LlxuICogQHR5cGVkZWYge29iamVjdH0gUG9vbGVkQ2hpbGRNZW1vcnlPYnNlcnZhdGlvblxuICogQHByb3BlcnR5IHtzdHJpbmdbXX0gYWN0aXZlSm9iSWRzIC0gSW4tZmxpZ2h0IGpvYiBpZHMsIGJvdW5kZWQuXG4gKiBAcHJvcGVydHkge251bWJlcn0gYWN0aXZlSm9iSWRzVHJ1bmNhdGVkQ291bnQgLSBJbi1mbGlnaHQgam9iIGlkcyBvbWl0dGVkIGJ5IHRoZSBib3VuZC5cbiAqIEBwcm9wZXJ0eSB7c3RyaW5nfSBjaGlsZEluc3RhbmNlSWQgLSBTdGFibGUgaWRlbnRpdHkgcmVwb3J0ZWQgYnkgdGhlIGNoaWxkLlxuICogQHByb3BlcnR5IHtudW1iZXJ9IGNoaWxkUGlkIC0gQ2hpbGQgcHJvY2VzcyBpZC5cbiAqIEBwcm9wZXJ0eSB7bnVtYmVyfSBjaGlsZFVwdGltZU1zIC0gQ2hpbGQgcHJvY2VzcyB1cHRpbWUgaW4gbXMuXG4gKiBAcHJvcGVydHkge1JldHVyblR5cGU8dHlwZW9mIGltcG9ydChcIm5vZGU6djhcIikuZ2V0SGVhcFN0YXRpc3RpY3M+fSBoZWFwU3RhdGlzdGljcyAtIFY4IGhlYXAtc3RhdCBicmVha2Rvd24gYXQgdGhlIHNhbXBsZS5cbiAqIEBwcm9wZXJ0eSB7bnVtYmVyfSBqb2JDb3VudCAtIEluLWZsaWdodCBqb2IgY291bnQuXG4gKiBAcHJvcGVydHkge1JldHVyblR5cGU8dHlwZW9mIGltcG9ydChcIm5vZGU6cHJvY2Vzc1wiKS5tZW1vcnlVc2FnZT59IG1lbW9yeVVzYWdlIC0gUHJvY2VzcyBtZW1vcnkgYnJlYWtkb3duIGF0IHRoZSBzYW1wbGUuXG4gKiBAcHJvcGVydHkge251bWJlcn0gb2JzZXJ2ZWRBdE1zIC0gRXBvY2ggbXMgdGhlIGNoaWxkIHNhbXBsZWQuXG4gKiBAcHJvcGVydHkge251bWJlcn0gcGVha1Jzc0J5dGVzIC0gQ2hpbGQtcmVwb3J0ZWQgcGVhayBSU1MgKGtlcm5lbCBgVm1IV01gIGhpZ2gtd2F0ZXIgbWFyaykgaW4gYnl0ZXMsIG1vbm90b25pYyBmb3IgdGhlIGNoaWxkJ3MgbGlmZS5cbiAqIEBwcm9wZXJ0eSB7bnVtYmVyfSByc3NCeXRlcyAtIFJlc2lkZW50IHNldCBzaXplIGluIGJ5dGVzIGF0IHRoZSBzYW1wbGUuXG4gKiBAcHJvcGVydHkge1wicG9vbGVkLWNoaWxkLW1lbW9yeVwifSB0eXBlIC0gRGlzY3JpbWluYXRvci5cbiAqIEBwcm9wZXJ0eSB7bnVtYmVyfSB1cHRpbWVNcyAtIFByb2Nlc3MgdXB0aW1lIGluIG1zLlxuICovXG4vKipcbiAqIEB0eXBlZGVmIHtvYmplY3R9IExvY2FsQmFja2dyb3VuZEpvYnNDbG9ja1xuICogQHByb3BlcnR5IHsoKSA9PiBudW1iZXJ9IG5vdyAtIEN1cnJlbnQgZXBvY2ggbWlsbGlzZWNvbmRzLlxuICogQHByb3BlcnR5IHsoY2FsbGJhY2s6ICgpID0+IHZvaWQsIGRlbGF5TXM6IG51bWJlcikgPT4gUmV0dXJuVHlwZTx0eXBlb2Ygc2V0VGltZW91dD4gfCBudW1iZXJ9IHNldFRpbWVvdXQgLSBBcm1zIGEgdGltZXIuXG4gKiBAcHJvcGVydHkgeyh0aW1lcklkOiBSZXR1cm5UeXBlPHR5cGVvZiBzZXRUaW1lb3V0PiB8IG51bWJlcikgPT4gdm9pZH0gY2xlYXJUaW1lb3V0IC0gQ2xlYXJzIGEgdGltZXIuXG4gKi9cbi8qKlxuICogQHR5cGVkZWYge29iamVjdH0gUmVzb2x2ZWRCYWNrZ3JvdW5kSm9iQ29uY3VycmVuY3lcbiAqIEBwcm9wZXJ0eSB7c3RyaW5nfSBjb25jdXJyZW5jeUtleSAtIER1cmFibGUgY2FwIGlkZW50aXR5LlxuICogQHByb3BlcnR5IHtudW1iZXJ9IG1heENvbmN1cnJlbmN5IC0gUG9zaXRpdmUgY2FwLlxuICogQHByb3BlcnR5IHtib29sZWFufSBxdWV1ZURlcml2ZWQgLSBXaGV0aGVyIHF1ZXVlIGNvbmZpZ3VyYXRpb24gb3ducyB0aGUgY2FwLlxuICovXG4vKipcbiAqIEB0eXBlZGVmIHtvYmplY3R9IEJhY2tncm91bmRKb2JDb25jdXJyZW5jeVJlcGFpclxuICogQHByb3BlcnR5IHtudW1iZXJ9IGFjdGl2ZUNvdW50IC0gRXhhY3QgaGFuZGVkLW9mZiBqb2IgY291bnQgcGVyc2lzdGVkIGJ5IHRoZSByZXBhaXIuXG4gKiBAcHJvcGVydHkge3N0cmluZ30gY29uY3VycmVuY3lLZXkgLSBEdXJhYmxlIGNhcCBpZGVudGl0eS5cbiAqIEBwcm9wZXJ0eSB7bnVtYmVyfSBwcmV2aW91c0FjdGl2ZUNvdW50IC0gUGVyc2lzdGVkIGNvdW50IHJlcGxhY2VkIGJ5IHRoZSByZXBhaXIuXG4gKi9cbi8qKlxuICogQHR5cGVkZWYge29iamVjdH0gQmFja2dyb3VuZEpvYkNvbmN1cnJlbmN5UmVjb25jaWxpYXRpb25cbiAqIEBwcm9wZXJ0eSB7bnVtYmVyfSBjYW5kaWRhdGVDb3VudCAtIFNuYXBzaG90IG1pc21hdGNoZXMgcmVjaGVja2VkIHVuZGVyIHRoZWlyIGNvdW50ZXIgbG9ja3MuXG4gKiBAcHJvcGVydHkge251bWJlcn0gY2hlY2tlZENvdW50IC0gQWN0aXZlIG9yIG5vbnplcm8gZHVyYWJsZSBjb3VudGVycyBjb21wYXJlZCBpbiB0aGUgaW5pdGlhbCBzbmFwc2hvdC5cbiAqIEBwcm9wZXJ0eSB7bnVtYmVyfSByZXBhaXJlZENvdW50IC0gQ291bnRlcnMgd2hvc2UgcGVyc2lzdGVkIHZhbHVlcyB3ZXJlIGNoYW5nZWQuXG4gKiBAcHJvcGVydHkge0JhY2tncm91bmRKb2JDb25jdXJyZW5jeVJlcGFpcltdfSByZXBhaXJzIC0gQm91bmRlZCBkZXRlcm1pbmlzdGljIHNhbXBsZSBvZiBhcHBsaWVkIHJlcGFpcnMuXG4gKiBAcHJvcGVydHkge251bWJlcn0gcmVwYWlyc1RydW5jYXRlZENvdW50IC0gQXBwbGllZCByZXBhaXJzIG9taXR0ZWQgZnJvbSB0aGUgc2FtcGxlLlxuICovXG4vKipcbiAqIEB0eXBlZGVmIHtvYmplY3R9IFByZXBhcmVkTG9jYWxCYWNrZ3JvdW5kSm9iXG4gKiBAcHJvcGVydHkge3N0cmluZ30gYXJnc0RpZ2VzdCAtIEZpeGVkLXdpZHRoIGRpZ2VzdCBvZiB0aGUgc2VyaWFsaXplZCBhcmd1bWVudHMuXG4gKiBAcHJvcGVydHkge3N0cmluZ30gYXJnc0pzb24gLSBTZXJpYWxpemVkIGFyZ3VtZW50cy5cbiAqIEBwcm9wZXJ0eSB7UmVzb2x2ZWRCYWNrZ3JvdW5kSm9iQ29uY3VycmVuY3kgfCBudWxsfSBjb25jdXJyZW5jeSAtIFJlc29sdmVkIGNvbmN1cnJlbmN5LlxuICogQHByb3BlcnR5IHtudW1iZXJ9IGNyZWF0ZWRBdE1zIC0gQ3JlYXRpb24gdGltZXN0YW1wLlxuICogQHByb3BlcnR5IHtcImlubGluZVwifSBleGVjdXRpb25Nb2RlIC0gTG9jYWwgaW4tcHJvY2VzcyBleGVjdXRpb24gbW9kZS5cbiAqIEBwcm9wZXJ0eSB7c3RyaW5nfSBqb2JJZCAtIER1cmFibGUgaWQuXG4gKiBAcHJvcGVydHkge3N0cmluZ30gam9iTmFtZSAtIFJlZ2lzdGVyZWQgbmFtZS5cbiAqIEBwcm9wZXJ0eSB7bnVtYmVyfSBtYXhSZXRyaWVzIC0gUmV0cnkgY2FwLlxuICogQHByb3BlcnR5IHtzdHJpbmd9IHF1ZXVlIC0gUXVldWUgbmFtZS5cbiAqIEBwcm9wZXJ0eSB7bnVtYmVyfSBzY2hlZHVsZWRBdE1zIC0gRWxpZ2liaWxpdHkgdGltZXN0YW1wLlxuICovXG4vKipcbiAqIEB0eXBlZGVmIHtvYmplY3R9IEJhY2tncm91bmRKb2JzSGVhbHRoXG4gKiBAcHJvcGVydHkge2Jvb2xlYW59IHJlYWR5IC0gV2hldGhlciB0aGUgYWRhcHRlciBjYW4gYWNjZXB0IGFuZCBwcm9jZXNzIHdvcmsuXG4gKi9cbi8qKlxuICogQHR5cGVkZWYge29iamVjdH0gQmFja2dyb3VuZEpvYnNQcm9kdWNlclxuICogQHByb3BlcnR5IHsoYXJnczoge2pvYk5hbWU6IHN0cmluZywgYXJnczogQXJyYXk8UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+LCBvcHRpb25zPzogQmFja2dyb3VuZEpvYk9wdGlvbnMsIHByb2R1Y2VySW52b2NhdGlvbklkPzogc3RyaW5nLCBwcm9kdWNlclByb29mPzogQmFja2dyb3VuZEpvYlByb2R1Y2VyUHJvb2Z9KSA9PiBQcm9taXNlPHN0cmluZz59IGVucXVldWUgLSBFbnF1ZXVlcyBhIGpvYi5cbiAqIEBwcm9wZXJ0eSB7KGFyZ3M6IHtzY2hlZHVsZUtleTogc3RyaW5nLCBqb2JOYW1lOiBzdHJpbmcsIGFyZ3M6IEFycmF5PFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Piwgb3B0aW9ucz86IEJhY2tncm91bmRKb2JPcHRpb25zfSkgPT4gUHJvbWlzZTxCYWNrZ3JvdW5kSm9iUmVwbGFjZW1lbnRSZXN1bHQ+fSByZXBsYWNlU2NoZWR1bGVkIC0gUmVwbGFjZXMgYSBzdGFibGUgc2NoZWR1bGUuXG4gKiBAcHJvcGVydHkgeyhhcmdzOiB7c2NoZWR1bGVLZXk6IHN0cmluZ30pID0+IFByb21pc2U8QmFja2dyb3VuZEpvYkNhbmNlbGxhdGlvblJlc3VsdD59IGNhbmNlbFNjaGVkdWxlZCAtIENhbmNlbHMgYSBzdGFibGUgc2NoZWR1bGUuXG4gKiBAcHJvcGVydHkgeyhhcmdzOiB7c2NoZWR1bGVLZXk6IHN0cmluZywgaW5jbHVkZUxhdGVzdFRlcm1pbmFsPzogYm9vbGVhbn0pID0+IFByb21pc2U8QmFja2dyb3VuZEpvYlNjaGVkdWxlZExvb2t1cFJlc3VsdD59IGdldFNjaGVkdWxlZEpvYiAtIFJlYWRzIHN0YWJsZSBzY2hlZHVsZSBvd25lcnNoaXAgYW5kIGhpc3RvcnkuXG4gKiBAcHJvcGVydHkgeyhhcmdzOiB7c2NoZWR1bGVLZXk6IHN0cmluZ30pID0+IFByb21pc2U8QmFja2dyb3VuZEpvYldha2VSZXN1bHQ+fSB3YWtlU2NoZWR1bGVkIC0gRXhwZWRpdGVzIGEgc3RhYmxlIHNjaGVkdWxlIG93bmVyLlxuICovXG4vKipcbiAqIEB0eXBlZGVmIHtvYmplY3R9IEJhY2tncm91bmRKb2JIYW5kb2ZmXG4gKiBAcHJvcGVydHkge3N0cmluZ30gaGFuZG9mZklkIC0gVW5pcXVlIGhhbmRvZmYgbGVhc2UgaWQuXG4gKiBAcHJvcGVydHkge251bWJlcn0gaGFuZGVkT2ZmQXRNcyAtIFRpbWUgaGFuZGVkIHRvIGEgd29ya2VyIGluIG1zLlxuICogQHByb3BlcnR5IHtCYWNrZ3JvdW5kSm9iUm93fSBbam9iXSAtIEV4YWN0IGNvbW1pdHRlZCBqb2Igc25hcHNob3Qgd2hlbiB0aGUgYWRhcHRlciBjaGFuZ2VzIGRpc3BhdGNoIGRhdGEgZHVyaW5nIHRoZSBjbGFpbS5cbiAqL1xuLyoqXG4gKiBAdHlwZWRlZiB7b2JqZWN0fSBCYWNrZ3JvdW5kSm9iSGFuZG9mZlNuYXBzaG90XG4gKiBAcHJvcGVydHkge3N0cmluZ30gam9iSWQgLSBKb2IgaG9sZGluZyB0aGUgbGVhc2UuXG4gKiBAcHJvcGVydHkge3N0cmluZ30gaGFuZG9mZklkIC0gRXhhY3QgZHVyYWJsZSBsZWFzZSBpZC5cbiAqIEBwcm9wZXJ0eSB7c3RyaW5nfSB3b3JrZXJJZCAtIFN0YWJsZSB3b3JrZXIgaWQgdGhhdCByZWNlaXZlZCB0aGUgbGVhc2UuXG4gKiBAcHJvcGVydHkge251bWJlcn0gaGFuZGVkT2ZmQXRNcyAtIFRpbWUgaGFuZGVkIHRvIHRoZSB3b3JrZXIgaW4gbXMuXG4gKi9cbi8qKlxuICogQHR5cGVkZWYge29iamVjdH0gQmFja2dyb3VuZEpvYkhhbmRvZmZSZXF1ZXN0XG4gKiBAcHJvcGVydHkge3N0cmluZ30gam9iSWQgLSBKb2IgdG8gY2xhaW0uXG4gKiBAcHJvcGVydHkge3N0cmluZ30gW2hhbmRvZmZJZF0gLSBFeGFjdCBjYWxsZXItc2VsZWN0ZWQgbGVhc2UgaWQuIEFkYXB0ZXJzIG11c3QgcGVyc2lzdCBhbmQgcmV0dXJuIHRoaXMgaWQgd2hlbiBzdXBwbGllZDsgYnVpbHQtaW4gYWRhcHRlcnMgZ2VuZXJhdGUgb25lIHdoZW4gb21pdHRlZCBmb3IgbGVnYWN5IGRpcmVjdCBjYWxsZXJzLlxuICogQHByb3BlcnR5IHtzdHJpbmd9IFt3b3JrZXJJZF0gLSBXb3JrZXIgY2xhaW1pbmcgdGhlIGpvYi5cbiAqL1xuLyoqXG4gKiBAdHlwZWRlZiB7b2JqZWN0fSBCYWNrZ3JvdW5kSm9iT3B0aW9uc1xuICogQHByb3BlcnR5IHtCYWNrZ3JvdW5kSm9iRXhlY3V0aW9uTW9kZX0gW2V4ZWN1dGlvbk1vZGVdIC0gSG93IHRoZSBqb2Igc2hvdWxkIHJ1bi4gTm9kZSBkZWZhdWx0cyB0byBgXCJwb29sZWRcImAgKGEgd2FybSwgcmV1c2VkIGxvY2FsIHJ1bm5lciBwcm9jZXNzKS4gQnJvd3Nlci9FeHBvIGxvY2FsIGRpc3BhdGNoIGRlZmF1bHRzIHRvIGFuZCBvbmx5IGFjY2VwdHMgYFwiaW5saW5lXCJgLiBgXCJmb3JrZWRcImAgcnVucyBhIE5vZGUgam9iIGluIGEgZnJlc2ggYGNoaWxkX3Byb2Nlc3MuZm9yaygpYCBjaGlsZCwgYW5kIGBcInNwYXduZWRcImAgaW4gYSBkZXRhY2hlZCBDTEkgcnVubmVyLlxuICogQHByb3BlcnR5IHtudW1iZXJ9IFttYXhSZXRyaWVzXSAtIE1heCByZXRyaWVzIGZvciBhIGZhaWxlZCBqb2IgYmVmb3JlIGl0IGlzIG1hcmtlZCBmYWlsZWQuXG4gKiBAcHJvcGVydHkge251bWJlcn0gW3ByaW9yaXR5XSAtIERpc3BhdGNoIHByaW9yaXR5IHdpdGhpbiB0aGUgcXVldWU6IGhpZ2hlciBydW5zIGZpcnN0LCBkZWZhdWx0IGAwYCwgcmV0cmllcyBhbHdheXMgcnVuIGxhc3QuXG4gKiBAcHJvcGVydHkge3N0cmluZ30gW3F1ZXVlXSAtIFF1ZXVlIG5hbWUuIERlZmF1bHRzIHRvIGBcImRlZmF1bHRcImAuIFdoZW4gdGhlIHF1ZXVlIGhhcyBhIGNvbmZpZ3VyZWQgY2FwIGluIGBiYWNrZ3JvdW5kSm9icy5xdWV1ZXNgLCB0aGF0IGNhcCBpcyBlbmZvcmNlZCBjbHVzdGVyLXdpZGUuXG4gKiBAcHJvcGVydHkge3N0cmluZ30gW2NvbmN1cnJlbmN5S2V5XSAtIE9wYXF1ZSBub24tZW1wdHkga2V5IHVzZWQgdG8gc2hhcmUgYSBjb25jdXJyZW5jeSBjYXAuIE92ZXJyaWRlcyBhbnkgcXVldWUtZGVyaXZlZCBjYXAuXG4gKiBAcHJvcGVydHkge251bWJlcn0gW21heENvbmN1cnJlbmN5XSAtIFBvc2l0aXZlIGludGVnZXIgY2FwOyBtdXN0IGJlIHBhaXJlZCB3aXRoIGBjb25jdXJyZW5jeUtleWAuXG4gKiBAcHJvcGVydHkge2Jvb2xlYW59IFtkZWR1cGxpY2F0ZVdoaWxlUXVldWVkXSAtIFdoZW4gdHJ1ZSwgc2tpcCB0aGUgZW5xdWV1ZSBpZiBhbiBpZGVudGljYWwgc3RpbGwtcXVldWVkIGpvYiAoc2FtZSBqb2IgbmFtZSwgYXJncyBhbmQgcXVldWUpIGlzIHNjaGVkdWxlZCBubyBsYXRlciB0aGFuIHRoaXMgZW5xdWV1ZSwgcmV0dXJuaW5nIHRoZSBlYXJsaWVzdCBtYXRjaGluZyBqb2IncyBpZC4gQSBmdXR1cmUgcmV0cnkgZG9lcyBub3Qgc3VwcHJlc3MgZWFybGllciB3b3JrLiBEZWR1cGxpY2F0aW9uIGlzIGluZGVwZW5kZW50IG9mIGBjb25jdXJyZW5jeUtleWAsIHNvIHRoZSBqb2Iga2VlcHMgaXRzIG5vcm1hbCAoZS5nLiBxdWV1ZS1kZXJpdmVkKSBjb25jdXJyZW5jeSBjYXAuIEtlZXBzIGFuIGludGVydmFsLXNjaGVkdWxlZCByZWN1cnJpbmcgam9iIChlLmcuIHJldGVudGlvbiBwcnVuaW5nKSBmcm9tIHBpbGluZyB1cCByZWR1bmRhbnQgcXVldWVkIHJvd3Mgd2hlbiBpdCBydW5zIHNsb3dlciB0aGFuIGl0cyBpbnRlcnZhbCBvciBubyB3b3JrZXIgaXMgZnJlZS5cbiAqIEBwcm9wZXJ0eSB7c3RyaW5nfSBbaWRlbXBvdGVuY3lLZXldIC0gRHVyYWJsZSBlbnF1ZXVlIGlkZW50aXR5IHNjb3BlZCB0byB0aGUgcmVzb2x2ZWQgam9iIGNsYXNzIG5hbWUgYW5kIHF1ZXVlLiBFeGFjdCByZXBsYXkgcmV0dXJucyB0aGUgb3JpZ2luYWwgam9iIGlkIGFjcm9zcyBldmVyeSBzdGF0ZSBhbmQgYWZ0ZXIgam9iIHBydW5pbmc7IHJldXNlIHdpdGggZGlmZmVyZW50IGNhbm9uaWNhbCBhcmd1bWVudHMgb3IgYmVoYXZpb3ItYWZmZWN0aW5nIG9wdGlvbnMgZmFpbHMuIE93bmVyc2hpcCBpcyBpbmRlcGVuZGVudCBvZiBgZGVkdXBsaWNhdGVXaGlsZVF1ZXVlZGAgYW5kIGlzIHJldGFpbmVkIHVudGlsIGFuIGV4cGxpY2l0IGZ1dHVyZSByZXRlbnRpb24gcG9saWN5IHJlbW92ZXMgaXQuXG4gKiBAcHJvcGVydHkge251bWJlcn0gW3NjaGVkdWxlZEF0TXNdIC0gRXBvY2ggdGltZXN0YW1wIGluIG1pbGxpc2Vjb25kcyB3aGVuIHRoZSBqb2IgYmVjb21lcyBlbGlnaWJsZSBmb3IgZGlzcGF0Y2guIERlZmF1bHRzIHRvIGVucXVldWUgdGltZS5cbiAqIEBwcm9wZXJ0eSB7bnVtYmVyfSBbdGltZW91dE1zXSAtIFBlci1qb2Igd2FsbC1jbG9jayB0aW1lb3V0IGZvciBmb3JrZWQgYW5kIHBvb2xlZCBleGVjdXRpb24uIEEgcG9zaXRpdmUgaW50ZWdlciB1cCB0byAyLDE0Nyw0ODMsNjQ3IG92ZXJyaWRlcyB0aGUgd29ya2VyLWxldmVsIGBqb2JUaW1lb3V0TXNgOyBhIG5vbi1wb3NpdGl2ZSBmaW5pdGUgdmFsdWUgZGlzYWJsZXMgdGhlIHRpbWVvdXQgZm9yIHRoaXMgam9iLlxuICovXG4vKipcbiAqIEB0eXBlZGVmIHtvYmplY3R9IEJhY2tncm91bmRKb2JQYXlsb2FkXG4gKiBAcHJvcGVydHkge3N0cmluZ30gW2lkXSAtIEpvYiBpZC5cbiAqIEBwcm9wZXJ0eSB7c3RyaW5nfSBqb2JOYW1lIC0gSm9iIGNsYXNzIG5hbWUuXG4gKiBAcHJvcGVydHkge0FycmF5PFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gW2FyZ3NdIC0gU2VyaWFsaXplZCBqb2IgYXJndW1lbnRzLlxuICogQHByb3BlcnR5IHtzdHJpbmd9IFtoYW5kb2ZmSWRdIC0gVW5pcXVlIGhhbmRvZmYgbGVhc2UgaWQuXG4gKiBAcHJvcGVydHkge3N0cmluZ30gW3dvcmtlcklkXSAtIFdvcmtlciBpZCBoYW5kbGluZyB0aGUgam9iLlxuICogQHByb3BlcnR5IHtudW1iZXJ9IFtoYW5kZWRPZmZBdE1zXSAtIFRpbWUgaGFuZGVkIHRvIGEgd29ya2VyIGluIG1zLlxuICogQHByb3BlcnR5IHtCYWNrZ3JvdW5kSm9iT3B0aW9uc30gW29wdGlvbnNdIC0gUnVudGltZSBvcHRpb25zLlxuICovXG4vKipcbiAqIEB0eXBlZGVmIHtvYmplY3R9IEJhY2tncm91bmRKb2JDb250ZXh0XG4gKiBAcHJvcGVydHkge3R5cGVvZiBpbXBvcnQoXCIuL3BsYXRmb3JtLWpvYi5qc1wiKS5kZWZhdWx0fSBqb2JDbGFzcyAtIENvbmNyZXRlIGpvYiBjbGFzcy5cbiAqIEBwcm9wZXJ0eSB7c3RyaW5nfSBqb2JOYW1lIC0gUmVnaXN0ZXJlZCBqb2IgbmFtZS5cbiAqIEBwcm9wZXJ0eSB7QXJyYXk8UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSBhcmdzIC0gU2VyaWFsaXplZCBqb2IgYXJndW1lbnRzLlxuICogQHByb3BlcnR5IHtCYWNrZ3JvdW5kSm9iT3B0aW9uc30gb3B0aW9ucyAtIFJlc29sdmVkIGVucXVldWUvcnVudGltZSBvcHRpb25zLlxuICogQHByb3BlcnR5IHtCYWNrZ3JvdW5kSm9iUGF5bG9hZH0gW3BheWxvYWRdIC0gQ29tcGxldGUgcGVyc2lzdGVkIHJ1bm5lciBwYXlsb2FkIHdoZW4gdGhlIGpvYiBpcyBwZXJmb3JtaW5nLlxuICovXG4vKipcbiAqIEB0eXBlZGVmIHtvYmplY3R9IEJhY2tncm91bmRKb2JSb3dcbiAqIEBwcm9wZXJ0eSB7c3RyaW5nfSBpZCAtIEpvYiBpZC5cbiAqIEBwcm9wZXJ0eSB7c3RyaW5nfSBqb2JOYW1lIC0gSm9iIGNsYXNzIG5hbWUuXG4gKiBAcHJvcGVydHkge0FycmF5PFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gYXJncyAtIFNlcmlhbGl6ZWQgam9iIGFyZ3VtZW50cy5cbiAqIEBwcm9wZXJ0eSB7QmFja2dyb3VuZEpvYkV4ZWN1dGlvbk1vZGV9IGV4ZWN1dGlvbk1vZGUgLSBIb3cgdGhlIGpvYiBzaG91bGQgcnVuLlxuICogQHByb3BlcnR5IHtzdHJpbmd9IHF1ZXVlIC0gUXVldWUgbmFtZSAoZGVmYXVsdHMgdG8gYFwiZGVmYXVsdFwiYCkuXG4gKiBAcHJvcGVydHkge3N0cmluZyB8IG51bGx9IHNjaGVkdWxlS2V5IC0gU3RhYmxlIGxvZ2ljYWwgc2NoZWR1bGUga2V5IHJldGFpbmVkIGZvciBoaXN0b3J5LlxuICogQHByb3BlcnR5IHtudW1iZXIgfCBudWxsfSBzY2hlZHVsZU9yZGVyIC0gVHJhbnNhY3Rpb24tYXNzaWduZWQgbW9ub3RvbmljIG93bmVyc2hpcCBvcmRlciBmb3IgdGhpcyBzY2hlZHVsZSBrZXk7IE5vZGUgcHJlc2VydmVzIGl0cyBoaWdoLXdhdGVyIG1hcmsgYWNyb3NzIHRlcm1pbmFsLWhpc3RvcnkgcHJ1bmluZy4gTnVsbCBmb3IgbGVnYWN5L25vbi1zY2hlZHVsZWQgcm93cy5cbiAqIEBwcm9wZXJ0eSB7QmFja2dyb3VuZEpvYlN0YXR1c30gc3RhdHVzIC0gQ3VycmVudCBqb2Igc3RhdHVzLlxuICogQHByb3BlcnR5IHtudW1iZXIgfCBudWxsfSBhdHRlbXB0cyAtIEZhaWx1cmUgYXR0ZW1wdHMgY291bnQuXG4gKiBAcHJvcGVydHkge251bWJlciB8IG51bGx9IG1heFJldHJpZXMgLSBNYXggcmV0cnkgYXR0ZW1wdHMuXG4gKiBAcHJvcGVydHkge251bWJlcn0gcHJpb3JpdHkgLSBEaXNwYXRjaCBwcmlvcml0eTsgYC0xYCBtZWFucyByZXRyaWVkIGFuZCB0aGVyZWZvcmUgcXVldWVkIGxhc3QuXG4gKiBAcHJvcGVydHkge251bWJlciB8IG51bGx9IHNjaGVkdWxlZEF0TXMgLSBOZXh0IHNjaGVkdWxlZCB0aW1lIGluIG1zLlxuICogQHByb3BlcnR5IHtudW1iZXIgfCBudWxsfSBjcmVhdGVkQXRNcyAtIENyZWF0aW9uIHRpbWUgaW4gbXMuXG4gKiBAcHJvcGVydHkge251bWJlciB8IG51bGx9IGhhbmRlZE9mZkF0TXMgLSBUaW1lIGhhbmRlZCB0byB3b3JrZXIgaW4gbXMuXG4gKiBAcHJvcGVydHkge3N0cmluZyB8IG51bGx9IGhhbmRvZmZJZCAtIFVuaXF1ZSBsYXRlc3QgaGFuZG9mZiBsZWFzZSBpZC5cbiAqIEBwcm9wZXJ0eSB7bnVtYmVyIHwgbnVsbH0gY29tcGxldGVkQXRNcyAtIENvbXBsZXRpb24gdGltZSBpbiBtcy5cbiAqIEBwcm9wZXJ0eSB7bnVtYmVyIHwgbnVsbH0gZmFpbGVkQXRNcyAtIEZhaWx1cmUgdGltZSBpbiBtcy5cbiAqIEBwcm9wZXJ0eSB7bnVtYmVyIHwgbnVsbH0gb3JwaGFuZWRBdE1zIC0gT3JwaGFuZWQgdGltZSBpbiBtcy5cbiAqIEBwcm9wZXJ0eSB7c3RyaW5nIHwgbnVsbH0gd29ya2VySWQgLSBXb3JrZXIgaWQgaGFuZGxpbmcgdGhlIGpvYi5cbiAqIEBwcm9wZXJ0eSB7c3RyaW5nIHwgbnVsbH0gbGFzdEVycm9yIC0gTGFzdCBmYWlsdXJlIG1lc3NhZ2UuXG4gKiBAcHJvcGVydHkge3N0cmluZyB8IG51bGx9IGNvbmN1cnJlbmN5S2V5IC0gRHVyYWJsZSBjb25jdXJyZW5jeSBrZXkuXG4gKiBAcHJvcGVydHkge251bWJlciB8IG51bGx9IG1heENvbmN1cnJlbmN5IC0gRHVyYWJsZSBwZXIta2V5IGNhcC5cbiAqIEBwcm9wZXJ0eSB7bnVtYmVyIHwgbnVsbH0gdGltZW91dE1zIC0gUGVyLWpvYiB3YWxsLWNsb2NrIHRpbWVvdXQgb3ZlcnJpZGUsIG9yIG51bGwgd2hlbiBvbWl0dGVkLlxuICogQHByb3BlcnR5IHtudW1iZXIgfCBudWxsfSBjaGlsZFJlY2VpdmVkQXRNcyAtIEVwb2NoIG1zIHdoZW4gdGhlIGV4ZWN1dGluZyBwb29sZWQgY2hpbGQncyBldmVudCBsb29wIHByb2Nlc3NlZCB0aGUgam9iIG1lc3NhZ2UsIG9yIG51bGwgd2hlbiBubyBydW5uZXIgYWNjZXB0ZWQgaXQgeWV0LlxuICogQHByb3BlcnR5IHtudW1iZXIgfCBudWxsfSBjaGlsZFN0YXJ0ZWRBdE1zIC0gRXBvY2ggbXMgd2hlbiB0aGUgam9iJ3MgcGVyZm9ybSBzdGFydGVkIGluIHRoZSBwb29sZWQgY2hpbGQsIG9yIG51bGwgd2hlbiBpdCBuZXZlciBzdGFydGVkLlxuICogQHByb3BlcnR5IHtzdHJpbmcgfCBudWxsfSBjaGlsZEluc3RhbmNlSWQgLSBTdGFibGUgaWRlbnRpdHkgb2YgdGhlIHBvb2xlZCBjaGlsZCBwcm9jZXNzIHRoYXQgYWNjZXB0ZWQgdGhlIGpvYiwgb3IgbnVsbC5cbiAqIEBwcm9wZXJ0eSB7bnVtYmVyIHwgbnVsbH0gY2hpbGRQaWQgLSBPUyBwaWQgb2YgdGhlIHBvb2xlZCBjaGlsZCBwcm9jZXNzIHRoYXQgYWNjZXB0ZWQgdGhlIGpvYiwgb3IgbnVsbC5cbiAqIEBwcm9wZXJ0eSB7c3RyaW5nIHwgbnVsbH0gcnVubmVySG9zdG5hbWUgLSBIb3N0bmFtZSByZXBvcnRlZCBieSB0aGUgcG9vbGVkIGNoaWxkIHByb2Nlc3MgdGhhdCBhY2NlcHRlZCB0aGUgam9iLCBvciBudWxsLlxuICovXG4vKipcbiAqIEB0eXBlZGVmIHtcInF1ZXVlZFwiIHwgXCJoYW5kZWRfb2ZmXCIgfCBudWxsfSBCYWNrZ3JvdW5kSm9iUmVwbGFjZW1lbnRQcmV2aW91c1N0YXR1c1xuICovXG4vKipcbiAqIEB0eXBlZGVmIHtvYmplY3R9IEJhY2tncm91bmRKb2JSZXBsYWNlbWVudFJlc3VsdFxuICogQHByb3BlcnR5IHtzdHJpbmd9IGpvYklkIC0gTmV3bHkgcXVldWVkIGpvYiBpZC5cbiAqIEBwcm9wZXJ0eSB7c3RyaW5nIHwgbnVsbH0gcHJldmlvdXNKb2JJZCAtIFByZXZpb3VzIGFjdGl2ZSBvd25lcidzIGpvYiBpZC5cbiAqIEBwcm9wZXJ0eSB7QmFja2dyb3VuZEpvYlJlcGxhY2VtZW50UHJldmlvdXNTdGF0dXN9IHByZXZpb3VzU3RhdHVzIC0gUHJldmlvdXMgb3duZXIncyBvYnNlcnZlZCBzdGF0ZS5cbiAqL1xuLyoqXG4gKiBAdHlwZWRlZiB7XCJjYW5jZWxsZWRcIiB8IFwiaGFuZGVkX29mZlwiIHwgXCJub3RfZm91bmRcIn0gQmFja2dyb3VuZEpvYkNhbmNlbGxhdGlvbk91dGNvbWVcbiAqL1xuLyoqXG4gKiBAdHlwZWRlZiB7b2JqZWN0fSBCYWNrZ3JvdW5kSm9iQ2FuY2VsbGF0aW9uUmVzdWx0XG4gKiBAcHJvcGVydHkge3N0cmluZyB8IG51bGx9IGpvYklkIC0gRGV0YWNoZWQgb3duZXIncyBqb2IgaWQsIHdoZW4gb25lIHdhcyBhY3RpdmUuXG4gKiBAcHJvcGVydHkge0JhY2tncm91bmRKb2JDYW5jZWxsYXRpb25PdXRjb21lfSBvdXRjb21lIC0gVHJ1dGhmdWwgYmVzdC1lZmZvcnQgb3V0Y29tZS5cbiAqL1xuLyoqXG4gKiBAdHlwZWRlZiB7b2JqZWN0fSBCYWNrZ3JvdW5kSm9iU2NoZWR1bGVkTG9va3VwUmVzdWx0XG4gKiBAcHJvcGVydHkge0JhY2tncm91bmRKb2JSb3cgfCBudWxsfSBjdXJyZW50Sm9iIC0gQ3VycmVudCBxdWV1ZWQgb3IgaGFuZGVkLW9mZiBvd25lci5cbiAqIEBwcm9wZXJ0eSB7QmFja2dyb3VuZEpvYlJvdyB8IG51bGx9IGxhdGVzdFRlcm1pbmFsSm9iIC0gTGF0ZXN0IHRlcm1pbmFsIGhpc3Rvcnkgd2hlbiByZXF1ZXN0ZWQuXG4gKi9cbi8qKlxuICogQHR5cGVkZWYge1wid29rZW5cIiB8IFwiYWxyZWFkeV9kdWVcIiB8IFwiaGFuZGVkX29mZlwiIHwgXCJub3RfZm91bmRcIn0gQmFja2dyb3VuZEpvYldha2VPdXRjb21lXG4gKi9cbi8qKlxuICogQHR5cGVkZWYge29iamVjdH0gQmFja2dyb3VuZEpvYldha2VSZXN1bHRcbiAqIEBwcm9wZXJ0eSB7c3RyaW5nIHwgbnVsbH0gam9iSWQgLSBDdXJyZW50IG93bmVyJ3MgZHVyYWJsZSBqb2IgaWQsIHdoZW4gZm91bmQuXG4gKiBAcHJvcGVydHkge0JhY2tncm91bmRKb2JXYWtlT3V0Y29tZX0gb3V0Y29tZSAtIEV4YWN0IHdha2Ugb3V0Y29tZS5cbiAqL1xuLyoqXG4gKiBAdHlwZWRlZiB7b2JqZWN0fSBCYWNrZ3JvdW5kSm9iRmFpbHVyZUV2ZW50XG4gKiBAcHJvcGVydHkge0JhY2tncm91bmRKb2JSb3d9IGpvYiAtIFVwZGF0ZWQgam9iIHJvdyBhZnRlciBmYWlsdXJlIGhhbmRsaW5nLlxuICogQHByb3BlcnR5IHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gZXJyb3IgLSBGYWlsdXJlIGVycm9yLlxuICogQHByb3BlcnR5IHtudW1iZXIgfCBudWxsfSBhdHRlbXB0cyAtIFVwZGF0ZWQgZmFpbHVyZSBhdHRlbXB0cyBjb3VudC5cbiAqIEBwcm9wZXJ0eSB7Ym9vbGVhbn0gdGVybWluYWwgLSBXaGV0aGVyIHRoaXMgZmFpbHVyZSBlbmRlZCB0aGUgam9iLlxuICogQHByb3BlcnR5IHtib29sZWFufSB3aWxsUmV0cnkgLSBXaGV0aGVyIHRoZSBqb2Igd2FzIHJldHVybmVkIHRvIHRoZSBxdWV1ZS5cbiAqIEBwcm9wZXJ0eSB7c3RyaW5nIHwgdW5kZWZpbmVkfSBoYW5kb2ZmSWQgLSBIYW5kb2ZmIGxlYXNlIGlkIGZyb20gdGhlIHdvcmtlciByZXBvcnQuXG4gKiBAcHJvcGVydHkge251bWJlciB8IHVuZGVmaW5lZH0gaGFuZGVkT2ZmQXRNcyAtIEhhbmRvZmYgdGltZXN0YW1wIGZyb20gdGhlIHdvcmtlciByZXBvcnQuXG4gKiBAcHJvcGVydHkge3N0cmluZyB8IHVuZGVmaW5lZH0gd29ya2VySWQgLSBXb3JrZXIgaWQgZnJvbSB0aGUgd29ya2VyIHJlcG9ydC5cbiAqIEBwcm9wZXJ0eSB7UG9vbGVkUnVubmVyRmFpbHVyZSB8IHVuZGVmaW5lZH0gcnVubmVyRmFpbHVyZSAtIFNoYXJlZCBwb29sZWQtY2hpbGQgcHJvY2VzcyBmYWlsdXJlIHByb3ZlbmFuY2UuXG4gKi9cbi8qKlxuICogQHR5cGVkZWYge1wid29ya2VyXCIgfCBcImNsaWVudFwiIHwgXCJyZXBvcnRlclwifSBCYWNrZ3JvdW5kSm9iU29ja2V0Um9sZVxuICovXG4vKipcbiAqIEB0eXBlZGVmIHt7dHlwZTogXCJoZWxsb1wiLCByb2xlOiBCYWNrZ3JvdW5kSm9iU29ja2V0Um9sZSwgZ2VuZXJhdGlvbklkPzogc3RyaW5nLCBzdXBwb3J0c0hhbmRvZmZJZFJlcG9ydGluZz86IGJvb2xlYW4sIHN1cHBvcnRzSGVhcnRiZWF0PzogYm9vbGVhbiwgc3VwcG9ydHNQb29sZWQ/OiBib29sZWFuLCB3b3JrZXJJZD86IHN0cmluZ319IEJhY2tncm91bmRKb2JIZWxsb01lc3NhZ2VcbiAqIEB0eXBlZGVmIHt7dHlwZTogXCJnZW5lcmF0aW9uLWFjY2VwdGVkXCIsIGdlbmVyYXRpb25JZDogc3RyaW5nLCBsaWZlY3ljbGVTdGF0ZTogQmFja2dyb3VuZEpvYnNHZW5lcmF0aW9uTGlmZWN5Y2xlU3RhdGV9fSBCYWNrZ3JvdW5kSm9iR2VuZXJhdGlvbkFjY2VwdGVkTWVzc2FnZVxuICogQHR5cGVkZWYge3t0eXBlOiBcImdlbmVyYXRpb24tcmVqZWN0ZWRcIiwgcmVhc29uOiBCYWNrZ3JvdW5kSm9ic0dlbmVyYXRpb25SZWplY3Rpb25SZWFzb259fSBCYWNrZ3JvdW5kSm9iR2VuZXJhdGlvblJlamVjdGVkTWVzc2FnZVxuICogQHR5cGVkZWYge3t0eXBlOiBcInJlYWR5XCIsIGFjY2VwdHNGb3JrZWQ/OiBib29sZWFuLCBhY2NlcHRzSW5saW5lPzogYm9vbGVhbiwgYWNjZXB0c1Bvb2xlZD86IGJvb2xlYW4sIGFjY2VwdHNTcGF3bmVkPzogYm9vbGVhbiwgYXZhaWxhYmxlUG9vbGVkU2xvdHM/OiBudW1iZXJ9fSBCYWNrZ3JvdW5kSm9iUmVhZHlNZXNzYWdlXG4gKiBAdHlwZWRlZiB7e3R5cGU6IFwiZHJhaW5pbmdcIn19IEJhY2tncm91bmRKb2JEcmFpbmluZ01lc3NhZ2VcbiAqIEB0eXBlZGVmIHt7dHlwZTogXCJoZWFydGJlYXRcIiwgd29ya2VySWQ/OiBzdHJpbmd9fSBCYWNrZ3JvdW5kSm9iSGVhcnRiZWF0TWVzc2FnZVxuICogQHR5cGVkZWYge3t0eXBlOiBcImVucXVldWVcIiwgam9iTmFtZTogc3RyaW5nLCBhcmdzPzogQXJyYXk8UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+LCBvcHRpb25zPzogQmFja2dyb3VuZEpvYk9wdGlvbnMsIHByb2R1Y2VySW52b2NhdGlvbklkPzogc3RyaW5nLCBwcm9kdWNlclByb29mPzogQmFja2dyb3VuZEpvYlByb2R1Y2VyUHJvb2Z9fSBCYWNrZ3JvdW5kSm9iRW5xdWV1ZU1lc3NhZ2VcbiAqIEB0eXBlZGVmIHt7dHlwZTogXCJlbnF1ZXVlZFwiLCBqb2JJZDogc3RyaW5nfX0gQmFja2dyb3VuZEpvYkVucXVldWVkTWVzc2FnZVxuICogQHR5cGVkZWYge3t0eXBlOiBcImVucXVldWUtZXJyb3JcIiwgZXJyb3I/OiBzdHJpbmd9fSBCYWNrZ3JvdW5kSm9iRW5xdWV1ZUVycm9yTWVzc2FnZVxuICogQHR5cGVkZWYge3t0eXBlOiBcInJlcGxhY2Utc2NoZWR1bGVkXCIsIHNjaGVkdWxlS2V5OiBzdHJpbmcsIGpvYk5hbWU6IHN0cmluZywgYXJncz86IEFycmF5PFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Piwgb3B0aW9ucz86IEJhY2tncm91bmRKb2JPcHRpb25zfX0gQmFja2dyb3VuZEpvYlJlcGxhY2VTY2hlZHVsZWRNZXNzYWdlXG4gKiBAdHlwZWRlZiB7e3R5cGU6IFwic2NoZWR1bGUtcmVwbGFjZWRcIiwgam9iSWQ6IHN0cmluZywgcHJldmlvdXNKb2JJZDogc3RyaW5nIHwgbnVsbCwgcHJldmlvdXNTdGF0dXM6IEJhY2tncm91bmRKb2JSZXBsYWNlbWVudFByZXZpb3VzU3RhdHVzfX0gQmFja2dyb3VuZEpvYlNjaGVkdWxlUmVwbGFjZWRNZXNzYWdlXG4gKiBAdHlwZWRlZiB7e3R5cGU6IFwicmVwbGFjZS1zY2hlZHVsZWQtZXJyb3JcIiwgZXJyb3I/OiBzdHJpbmd9fSBCYWNrZ3JvdW5kSm9iUmVwbGFjZVNjaGVkdWxlZEVycm9yTWVzc2FnZVxuICogQHR5cGVkZWYge3t0eXBlOiBcImNhbmNlbC1zY2hlZHVsZWRcIiwgc2NoZWR1bGVLZXk6IHN0cmluZ319IEJhY2tncm91bmRKb2JDYW5jZWxTY2hlZHVsZWRNZXNzYWdlXG4gKiBAdHlwZWRlZiB7e3R5cGU6IFwic2NoZWR1bGUtY2FuY2VsbGVkXCIsIGpvYklkOiBzdHJpbmcgfCBudWxsLCBvdXRjb21lOiBCYWNrZ3JvdW5kSm9iQ2FuY2VsbGF0aW9uT3V0Y29tZX19IEJhY2tncm91bmRKb2JTY2hlZHVsZUNhbmNlbGxlZE1lc3NhZ2VcbiAqIEB0eXBlZGVmIHt7dHlwZTogXCJjYW5jZWwtc2NoZWR1bGVkLWVycm9yXCIsIGVycm9yPzogc3RyaW5nfX0gQmFja2dyb3VuZEpvYkNhbmNlbFNjaGVkdWxlZEVycm9yTWVzc2FnZVxuICogQHR5cGVkZWYge3t0eXBlOiBcImdldC1zY2hlZHVsZWQtam9iXCIsIHNjaGVkdWxlS2V5OiBzdHJpbmcsIGluY2x1ZGVMYXRlc3RUZXJtaW5hbD86IGJvb2xlYW59fSBCYWNrZ3JvdW5kSm9iR2V0U2NoZWR1bGVkTWVzc2FnZVxuICogQHR5cGVkZWYge3t0eXBlOiBcInNjaGVkdWxlZC1qb2JcIiwgY3VycmVudEpvYjogQmFja2dyb3VuZEpvYlJvdyB8IG51bGwsIGxhdGVzdFRlcm1pbmFsSm9iOiBCYWNrZ3JvdW5kSm9iUm93IHwgbnVsbH19IEJhY2tncm91bmRKb2JTY2hlZHVsZWRNZXNzYWdlXG4gKiBAdHlwZWRlZiB7e3R5cGU6IFwiZ2V0LXNjaGVkdWxlZC1qb2ItZXJyb3JcIiwgZXJyb3I/OiBzdHJpbmd9fSBCYWNrZ3JvdW5kSm9iR2V0U2NoZWR1bGVkRXJyb3JNZXNzYWdlXG4gKiBAdHlwZWRlZiB7e3R5cGU6IFwid2FrZS1zY2hlZHVsZWRcIiwgc2NoZWR1bGVLZXk6IHN0cmluZ319IEJhY2tncm91bmRKb2JXYWtlU2NoZWR1bGVkTWVzc2FnZVxuICogQHR5cGVkZWYge3t0eXBlOiBcInNjaGVkdWxlLXdva2VuXCIsIGpvYklkOiBzdHJpbmcgfCBudWxsLCBvdXRjb21lOiBCYWNrZ3JvdW5kSm9iV2FrZU91dGNvbWV9fSBCYWNrZ3JvdW5kSm9iU2NoZWR1bGVXb2tlbk1lc3NhZ2VcbiAqIEB0eXBlZGVmIHt7dHlwZTogXCJ3YWtlLXNjaGVkdWxlZC1lcnJvclwiLCBlcnJvcj86IHN0cmluZ319IEJhY2tncm91bmRKb2JXYWtlU2NoZWR1bGVkRXJyb3JNZXNzYWdlXG4gKiBAdHlwZWRlZiB7e3R5cGU6IFwiam9iXCIsIHBheWxvYWQ6IEJhY2tncm91bmRKb2JQYXlsb2FkfX0gQmFja2dyb3VuZEpvYkpvYk1lc3NhZ2VcbiAqIEB0eXBlZGVmIHt7dHlwZTogXCJqb2ItYWNjZXB0ZWRcIiwgam9iSWQ6IHN0cmluZywgaGFuZG9mZklkPzogc3RyaW5nLCB3b3JrZXJJZD86IHN0cmluZywgaGFuZGVkT2ZmQXRNcz86IG51bWJlciwgcmVjZWl2ZWRBdE1zPzogbnVtYmVyLCBzdGFydGVkQXRNcz86IG51bWJlciwgY2hpbGRJbnN0YW5jZUlkPzogc3RyaW5nLCBjaGlsZFBpZD86IG51bWJlciwgcnVubmVySG9zdG5hbWU/OiBzdHJpbmd9fSBCYWNrZ3JvdW5kSm9iQWNjZXB0ZWRNZXNzYWdlXG4gKiBAdHlwZWRlZiB7e3R5cGU6IFwiam9iLWNvbXBsZXRlXCIsIGpvYklkOiBzdHJpbmcsIGhhbmRvZmZJZD86IHN0cmluZywgd29ya2VySWQ/OiBzdHJpbmcsIGhhbmRlZE9mZkF0TXM/OiBudW1iZXJ9fSBCYWNrZ3JvdW5kSm9iQ29tcGxldGVNZXNzYWdlXG4gKiBAdHlwZWRlZiB7e3R5cGU6IFwiam9iLWZhaWxlZFwiLCBqb2JJZDogc3RyaW5nLCBlcnJvcj86IFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+LCBoYW5kb2ZmSWQ/OiBzdHJpbmcsIHdvcmtlcklkPzogc3RyaW5nLCBoYW5kZWRPZmZBdE1zPzogbnVtYmVyLCBydW5uZXJGYWlsdXJlPzogUG9vbGVkUnVubmVyRmFpbHVyZX19IEJhY2tncm91bmRKb2JGYWlsZWRNZXNzYWdlXG4gKiBAdHlwZWRlZiB7e3R5cGU6IFwiam9iLXJlc2NoZWR1bGVcIiwgam9iSWQ6IHN0cmluZywgZGVsYXlNczogbnVtYmVyLCBoYW5kb2ZmSWQ/OiBzdHJpbmcsIHdvcmtlcklkPzogc3RyaW5nLCBoYW5kZWRPZmZBdE1zPzogbnVtYmVyfX0gQmFja2dyb3VuZEpvYlJlc2NoZWR1bGVNZXNzYWdlXG4gKiBAdHlwZWRlZiB7e3R5cGU6IFwiam9iLXVwZGF0ZWRcIiwgam9iSWQ6IHN0cmluZ319IEJhY2tncm91bmRKb2JVcGRhdGVkTWVzc2FnZVxuICogQHR5cGVkZWYge3t0eXBlOiBcImpvYi11cGRhdGUtZXJyb3JcIiwgam9iSWQ6IHN0cmluZywgZXJyb3I/OiBzdHJpbmd9fSBCYWNrZ3JvdW5kSm9iVXBkYXRlRXJyb3JNZXNzYWdlXG4gKi9cbi8qKlxuICogQHR5cGVkZWYge0JhY2tncm91bmRKb2JIZWxsb01lc3NhZ2UgfCBCYWNrZ3JvdW5kSm9iR2VuZXJhdGlvbkFjY2VwdGVkTWVzc2FnZSB8IEJhY2tncm91bmRKb2JHZW5lcmF0aW9uUmVqZWN0ZWRNZXNzYWdlIHwgQmFja2dyb3VuZEpvYlJlYWR5TWVzc2FnZSB8IEJhY2tncm91bmRKb2JEcmFpbmluZ01lc3NhZ2UgfCBCYWNrZ3JvdW5kSm9iSGVhcnRiZWF0TWVzc2FnZSB8IEJhY2tncm91bmRKb2JFbnF1ZXVlTWVzc2FnZSB8IEJhY2tncm91bmRKb2JFbnF1ZXVlZE1lc3NhZ2UgfCBCYWNrZ3JvdW5kSm9iRW5xdWV1ZUVycm9yTWVzc2FnZSB8IEJhY2tncm91bmRKb2JSZXBsYWNlU2NoZWR1bGVkTWVzc2FnZSB8IEJhY2tncm91bmRKb2JTY2hlZHVsZVJlcGxhY2VkTWVzc2FnZSB8IEJhY2tncm91bmRKb2JSZXBsYWNlU2NoZWR1bGVkRXJyb3JNZXNzYWdlIHwgQmFja2dyb3VuZEpvYkNhbmNlbFNjaGVkdWxlZE1lc3NhZ2UgfCBCYWNrZ3JvdW5kSm9iU2NoZWR1bGVDYW5jZWxsZWRNZXNzYWdlIHwgQmFja2dyb3VuZEpvYkNhbmNlbFNjaGVkdWxlZEVycm9yTWVzc2FnZSB8IEJhY2tncm91bmRKb2JHZXRTY2hlZHVsZWRNZXNzYWdlIHwgQmFja2dyb3VuZEpvYlNjaGVkdWxlZE1lc3NhZ2UgfCBCYWNrZ3JvdW5kSm9iR2V0U2NoZWR1bGVkRXJyb3JNZXNzYWdlIHwgQmFja2dyb3VuZEpvYldha2VTY2hlZHVsZWRNZXNzYWdlIHwgQmFja2dyb3VuZEpvYlNjaGVkdWxlV29rZW5NZXNzYWdlIHwgQmFja2dyb3VuZEpvYldha2VTY2hlZHVsZWRFcnJvck1lc3NhZ2UgfCBCYWNrZ3JvdW5kSm9iSm9iTWVzc2FnZSB8IEJhY2tncm91bmRKb2JBY2NlcHRlZE1lc3NhZ2UgfCBCYWNrZ3JvdW5kSm9iQ29tcGxldGVNZXNzYWdlIHwgQmFja2dyb3VuZEpvYkZhaWxlZE1lc3NhZ2UgfCBCYWNrZ3JvdW5kSm9iUmVzY2hlZHVsZU1lc3NhZ2UgfCBCYWNrZ3JvdW5kSm9iVXBkYXRlZE1lc3NhZ2UgfCBCYWNrZ3JvdW5kSm9iVXBkYXRlRXJyb3JNZXNzYWdlfSBCYWNrZ3JvdW5kSm9iU29ja2V0TWVzc2FnZVxuICovXG5cbmV4cG9ydCBjb25zdCBub3RoaW5nID0ge31cbiJdfQ==