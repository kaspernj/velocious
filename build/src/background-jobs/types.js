// @ts-check
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
export const nothing = {};
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoidHlwZXMuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi9zcmMvYmFja2dyb3VuZC1qb2JzL3R5cGVzLmpzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiJBQUFBLFlBQVk7QUFFWjs7R0FFRztBQUNILHlGQUF5RjtBQUN6RixpSUFBaUk7QUFDakksNk5BQTZOO0FBQzdOOzs7OztHQUtHO0FBQ0g7Ozs7O0dBS0c7QUFDSDs7Ozs7Ozs7Ozs7O0dBWUc7QUFDSDs7O0dBR0c7QUFDSDs7Ozs7R0FLRztBQUNIOzs7O0dBSUc7QUFDSDs7Ozs7O0dBTUc7QUFDSDs7Ozs7R0FLRztBQUNIOzs7Ozs7Ozs7OztHQVdHO0FBQ0g7Ozs7Ozs7OztHQVNHO0FBQ0g7Ozs7Ozs7R0FPRztBQUNIOzs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7OztHQXVCRztBQUNIOztHQUVHO0FBQ0g7Ozs7O0dBS0c7QUFDSDs7R0FFRztBQUNIOzs7O0dBSUc7QUFDSDs7Ozs7Ozs7OztHQVVHO0FBQ0g7O0dBRUc7QUFDSDs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7OztHQXNCRztBQUNIOztHQUVHO0FBRUgsTUFBTSxDQUFDLE1BQU0sT0FBTyxHQUFHLEVBQUUsQ0FBQSIsInNvdXJjZXNDb250ZW50IjpbIi8vIEB0cy1jaGVja1xuXG4vKipcbiAqIEB0eXBlZGVmIHtcImlubGluZVwiIHwgXCJmb3JrZWRcIiB8IFwicG9vbGVkXCIgfCBcInNwYXduZWRcIn0gQmFja2dyb3VuZEpvYkV4ZWN1dGlvbk1vZGVcbiAqL1xuLyoqIEB0eXBlZGVmIHtcImNhbmRpZGF0ZVwiIHwgXCJhY3RpdmVcIiB8IFwicmV0aXJlZFwifSBCYWNrZ3JvdW5kSm9ic0dlbmVyYXRpb25Jbml0aWFsU3RhdGUgKi9cbi8qKiBAdHlwZWRlZiB7XCJzdGFydGluZ1wiIHwgXCJjYW5kaWRhdGVcIiB8IFwiYWN0aXZlXCIgfCBcInJldGlyaW5nXCIgfCBcInJldGlyZWRcIiB8IFwic3RvcHBlZFwifSBCYWNrZ3JvdW5kSm9ic0dlbmVyYXRpb25MaWZlY3ljbGVTdGF0ZSAqL1xuLyoqIEB0eXBlZGVmIHtcIm1pc3NpbmctZ2VuZXJhdGlvblwiIHwgXCJ1bmV4cGVjdGVkLWdlbmVyYXRpb25cIiB8IFwibWFsZm9ybWVkLWdlbmVyYXRpb25cIiB8IFwiZ2VuZXJhdGlvbi1taXNtYXRjaFwiIHwgXCJ3b3JrZXItYWRtaXNzaW9uLXJldGlyZWRcIiB8IFwid29ya2VyLWhhcy1uby1yZWNvdmVyYWJsZS1oYW5kb2Zmc1wifSBCYWNrZ3JvdW5kSm9ic0dlbmVyYXRpb25SZWplY3Rpb25SZWFzb24gKi9cbi8qKlxuICogQHR5cGVkZWYge29iamVjdH0gTG9jYWxCYWNrZ3JvdW5kSm9ic0Nsb2NrXG4gKiBAcHJvcGVydHkgeygpID0+IG51bWJlcn0gbm93IC0gQ3VycmVudCBlcG9jaCBtaWxsaXNlY29uZHMuXG4gKiBAcHJvcGVydHkgeyhjYWxsYmFjazogKCkgPT4gdm9pZCwgZGVsYXlNczogbnVtYmVyKSA9PiBSZXR1cm5UeXBlPHR5cGVvZiBzZXRUaW1lb3V0PiB8IG51bWJlcn0gc2V0VGltZW91dCAtIEFybXMgYSB0aW1lci5cbiAqIEBwcm9wZXJ0eSB7KHRpbWVySWQ6IFJldHVyblR5cGU8dHlwZW9mIHNldFRpbWVvdXQ+IHwgbnVtYmVyKSA9PiB2b2lkfSBjbGVhclRpbWVvdXQgLSBDbGVhcnMgYSB0aW1lci5cbiAqL1xuLyoqXG4gKiBAdHlwZWRlZiB7b2JqZWN0fSBSZXNvbHZlZEJhY2tncm91bmRKb2JDb25jdXJyZW5jeVxuICogQHByb3BlcnR5IHtzdHJpbmd9IGNvbmN1cnJlbmN5S2V5IC0gRHVyYWJsZSBjYXAgaWRlbnRpdHkuXG4gKiBAcHJvcGVydHkge251bWJlcn0gbWF4Q29uY3VycmVuY3kgLSBQb3NpdGl2ZSBjYXAuXG4gKiBAcHJvcGVydHkge2Jvb2xlYW59IHF1ZXVlRGVyaXZlZCAtIFdoZXRoZXIgcXVldWUgY29uZmlndXJhdGlvbiBvd25zIHRoZSBjYXAuXG4gKi9cbi8qKlxuICogQHR5cGVkZWYge29iamVjdH0gUHJlcGFyZWRMb2NhbEJhY2tncm91bmRKb2JcbiAqIEBwcm9wZXJ0eSB7c3RyaW5nfSBhcmdzRGlnZXN0IC0gRml4ZWQtd2lkdGggZGlnZXN0IG9mIHRoZSBzZXJpYWxpemVkIGFyZ3VtZW50cy5cbiAqIEBwcm9wZXJ0eSB7c3RyaW5nfSBhcmdzSnNvbiAtIFNlcmlhbGl6ZWQgYXJndW1lbnRzLlxuICogQHByb3BlcnR5IHtSZXNvbHZlZEJhY2tncm91bmRKb2JDb25jdXJyZW5jeSB8IG51bGx9IGNvbmN1cnJlbmN5IC0gUmVzb2x2ZWQgY29uY3VycmVuY3kuXG4gKiBAcHJvcGVydHkge251bWJlcn0gY3JlYXRlZEF0TXMgLSBDcmVhdGlvbiB0aW1lc3RhbXAuXG4gKiBAcHJvcGVydHkge1wiaW5saW5lXCJ9IGV4ZWN1dGlvbk1vZGUgLSBMb2NhbCBpbi1wcm9jZXNzIGV4ZWN1dGlvbiBtb2RlLlxuICogQHByb3BlcnR5IHtzdHJpbmd9IGpvYklkIC0gRHVyYWJsZSBpZC5cbiAqIEBwcm9wZXJ0eSB7c3RyaW5nfSBqb2JOYW1lIC0gUmVnaXN0ZXJlZCBuYW1lLlxuICogQHByb3BlcnR5IHtudW1iZXJ9IG1heFJldHJpZXMgLSBSZXRyeSBjYXAuXG4gKiBAcHJvcGVydHkge3N0cmluZ30gcXVldWUgLSBRdWV1ZSBuYW1lLlxuICogQHByb3BlcnR5IHtudW1iZXJ9IHNjaGVkdWxlZEF0TXMgLSBFbGlnaWJpbGl0eSB0aW1lc3RhbXAuXG4gKi9cbi8qKlxuICogQHR5cGVkZWYge29iamVjdH0gQmFja2dyb3VuZEpvYnNIZWFsdGhcbiAqIEBwcm9wZXJ0eSB7Ym9vbGVhbn0gcmVhZHkgLSBXaGV0aGVyIHRoZSBhZGFwdGVyIGNhbiBhY2NlcHQgYW5kIHByb2Nlc3Mgd29yay5cbiAqL1xuLyoqXG4gKiBAdHlwZWRlZiB7b2JqZWN0fSBCYWNrZ3JvdW5kSm9ic1Byb2R1Y2VyXG4gKiBAcHJvcGVydHkgeyhhcmdzOiB7am9iTmFtZTogc3RyaW5nLCBhcmdzOiBBcnJheTxSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj4sIG9wdGlvbnM/OiBCYWNrZ3JvdW5kSm9iT3B0aW9uc30pID0+IFByb21pc2U8c3RyaW5nPn0gZW5xdWV1ZSAtIEVucXVldWVzIGEgam9iLlxuICogQHByb3BlcnR5IHsoYXJnczoge3NjaGVkdWxlS2V5OiBzdHJpbmcsIGpvYk5hbWU6IHN0cmluZywgYXJnczogQXJyYXk8UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+LCBvcHRpb25zPzogQmFja2dyb3VuZEpvYk9wdGlvbnN9KSA9PiBQcm9taXNlPEJhY2tncm91bmRKb2JSZXBsYWNlbWVudFJlc3VsdD59IHJlcGxhY2VTY2hlZHVsZWQgLSBSZXBsYWNlcyBhIHN0YWJsZSBzY2hlZHVsZS5cbiAqIEBwcm9wZXJ0eSB7KGFyZ3M6IHtzY2hlZHVsZUtleTogc3RyaW5nfSkgPT4gUHJvbWlzZTxCYWNrZ3JvdW5kSm9iQ2FuY2VsbGF0aW9uUmVzdWx0Pn0gY2FuY2VsU2NoZWR1bGVkIC0gQ2FuY2VscyBhIHN0YWJsZSBzY2hlZHVsZS5cbiAqL1xuLyoqXG4gKiBAdHlwZWRlZiB7b2JqZWN0fSBCYWNrZ3JvdW5kSm9iSGFuZG9mZlxuICogQHByb3BlcnR5IHtzdHJpbmd9IGhhbmRvZmZJZCAtIFVuaXF1ZSBoYW5kb2ZmIGxlYXNlIGlkLlxuICogQHByb3BlcnR5IHtudW1iZXJ9IGhhbmRlZE9mZkF0TXMgLSBUaW1lIGhhbmRlZCB0byBhIHdvcmtlciBpbiBtcy5cbiAqL1xuLyoqXG4gKiBAdHlwZWRlZiB7b2JqZWN0fSBCYWNrZ3JvdW5kSm9iSGFuZG9mZlNuYXBzaG90XG4gKiBAcHJvcGVydHkge3N0cmluZ30gam9iSWQgLSBKb2IgaG9sZGluZyB0aGUgbGVhc2UuXG4gKiBAcHJvcGVydHkge3N0cmluZ30gaGFuZG9mZklkIC0gRXhhY3QgZHVyYWJsZSBsZWFzZSBpZC5cbiAqIEBwcm9wZXJ0eSB7c3RyaW5nfSB3b3JrZXJJZCAtIFN0YWJsZSB3b3JrZXIgaWQgdGhhdCByZWNlaXZlZCB0aGUgbGVhc2UuXG4gKiBAcHJvcGVydHkge251bWJlcn0gaGFuZGVkT2ZmQXRNcyAtIFRpbWUgaGFuZGVkIHRvIHRoZSB3b3JrZXIgaW4gbXMuXG4gKi9cbi8qKlxuICogQHR5cGVkZWYge29iamVjdH0gQmFja2dyb3VuZEpvYkhhbmRvZmZSZXF1ZXN0XG4gKiBAcHJvcGVydHkge3N0cmluZ30gam9iSWQgLSBKb2IgdG8gY2xhaW0uXG4gKiBAcHJvcGVydHkge3N0cmluZ30gW2hhbmRvZmZJZF0gLSBFeGFjdCBjYWxsZXItc2VsZWN0ZWQgbGVhc2UgaWQuIEFkYXB0ZXJzIG11c3QgcGVyc2lzdCBhbmQgcmV0dXJuIHRoaXMgaWQgd2hlbiBzdXBwbGllZDsgYnVpbHQtaW4gYWRhcHRlcnMgZ2VuZXJhdGUgb25lIHdoZW4gb21pdHRlZCBmb3IgbGVnYWN5IGRpcmVjdCBjYWxsZXJzLlxuICogQHByb3BlcnR5IHtzdHJpbmd9IFt3b3JrZXJJZF0gLSBXb3JrZXIgY2xhaW1pbmcgdGhlIGpvYi5cbiAqL1xuLyoqXG4gKiBAdHlwZWRlZiB7b2JqZWN0fSBCYWNrZ3JvdW5kSm9iT3B0aW9uc1xuICogQHByb3BlcnR5IHtCYWNrZ3JvdW5kSm9iRXhlY3V0aW9uTW9kZX0gW2V4ZWN1dGlvbk1vZGVdIC0gSG93IHRoZSBqb2Igc2hvdWxkIHJ1bi4gTm9kZSBkZWZhdWx0cyB0byBgXCJwb29sZWRcImAgKGEgd2FybSwgcmV1c2VkIGxvY2FsIHJ1bm5lciBwcm9jZXNzKS4gQnJvd3Nlci9FeHBvIGxvY2FsIGRpc3BhdGNoIGRlZmF1bHRzIHRvIGFuZCBvbmx5IGFjY2VwdHMgYFwiaW5saW5lXCJgLiBgXCJmb3JrZWRcImAgcnVucyBhIE5vZGUgam9iIGluIGEgZnJlc2ggYGNoaWxkX3Byb2Nlc3MuZm9yaygpYCBjaGlsZCwgYW5kIGBcInNwYXduZWRcImAgaW4gYSBkZXRhY2hlZCBDTEkgcnVubmVyLlxuICogQHByb3BlcnR5IHtudW1iZXJ9IFttYXhSZXRyaWVzXSAtIE1heCByZXRyaWVzIGZvciBhIGZhaWxlZCBqb2IgYmVmb3JlIGl0IGlzIG1hcmtlZCBmYWlsZWQuXG4gKiBAcHJvcGVydHkge3N0cmluZ30gW3F1ZXVlXSAtIFF1ZXVlIG5hbWUuIERlZmF1bHRzIHRvIGBcImRlZmF1bHRcImAuIFdoZW4gdGhlIHF1ZXVlIGhhcyBhIGNvbmZpZ3VyZWQgY2FwIGluIGBiYWNrZ3JvdW5kSm9icy5xdWV1ZXNgLCB0aGF0IGNhcCBpcyBlbmZvcmNlZCBjbHVzdGVyLXdpZGUuXG4gKiBAcHJvcGVydHkge3N0cmluZ30gW2NvbmN1cnJlbmN5S2V5XSAtIE9wYXF1ZSBub24tZW1wdHkga2V5IHVzZWQgdG8gc2hhcmUgYSBjb25jdXJyZW5jeSBjYXAuIE92ZXJyaWRlcyBhbnkgcXVldWUtZGVyaXZlZCBjYXAuXG4gKiBAcHJvcGVydHkge251bWJlcn0gW21heENvbmN1cnJlbmN5XSAtIFBvc2l0aXZlIGludGVnZXIgY2FwOyBtdXN0IGJlIHBhaXJlZCB3aXRoIGBjb25jdXJyZW5jeUtleWAuXG4gKiBAcHJvcGVydHkge2Jvb2xlYW59IFtkZWR1cGxpY2F0ZVdoaWxlUXVldWVkXSAtIFdoZW4gdHJ1ZSwgc2tpcCB0aGUgZW5xdWV1ZSBpZiBhbiBpZGVudGljYWwgc3RpbGwtcXVldWVkIGpvYiAoc2FtZSBqb2IgbmFtZSwgYXJncyBhbmQgcXVldWUpIGlzIHNjaGVkdWxlZCBubyBsYXRlciB0aGFuIHRoaXMgZW5xdWV1ZSwgcmV0dXJuaW5nIHRoZSBlYXJsaWVzdCBtYXRjaGluZyBqb2IncyBpZC4gQSBmdXR1cmUgcmV0cnkgZG9lcyBub3Qgc3VwcHJlc3MgZWFybGllciB3b3JrLiBEZWR1cGxpY2F0aW9uIGlzIGluZGVwZW5kZW50IG9mIGBjb25jdXJyZW5jeUtleWAsIHNvIHRoZSBqb2Iga2VlcHMgaXRzIG5vcm1hbCAoZS5nLiBxdWV1ZS1kZXJpdmVkKSBjb25jdXJyZW5jeSBjYXAuIEtlZXBzIGFuIGludGVydmFsLXNjaGVkdWxlZCByZWN1cnJpbmcgam9iIChlLmcuIHJldGVudGlvbiBwcnVuaW5nKSBmcm9tIHBpbGluZyB1cCByZWR1bmRhbnQgcXVldWVkIHJvd3Mgd2hlbiBpdCBydW5zIHNsb3dlciB0aGFuIGl0cyBpbnRlcnZhbCBvciBubyB3b3JrZXIgaXMgZnJlZS5cbiAqIEBwcm9wZXJ0eSB7c3RyaW5nfSBbaWRlbXBvdGVuY3lLZXldIC0gRHVyYWJsZSBlbnF1ZXVlIGlkZW50aXR5IHNjb3BlZCB0byB0aGUgcmVzb2x2ZWQgam9iIGNsYXNzIG5hbWUgYW5kIHF1ZXVlLiBFeGFjdCByZXBsYXkgcmV0dXJucyB0aGUgb3JpZ2luYWwgam9iIGlkIGFjcm9zcyBldmVyeSBzdGF0ZSBhbmQgYWZ0ZXIgam9iIHBydW5pbmc7IHJldXNlIHdpdGggZGlmZmVyZW50IGNhbm9uaWNhbCBhcmd1bWVudHMgb3IgYmVoYXZpb3ItYWZmZWN0aW5nIG9wdGlvbnMgZmFpbHMuIE93bmVyc2hpcCBpcyBpbmRlcGVuZGVudCBvZiBgZGVkdXBsaWNhdGVXaGlsZVF1ZXVlZGAgYW5kIGlzIHJldGFpbmVkIHVudGlsIGFuIGV4cGxpY2l0IGZ1dHVyZSByZXRlbnRpb24gcG9saWN5IHJlbW92ZXMgaXQuXG4gKiBAcHJvcGVydHkge251bWJlcn0gW3NjaGVkdWxlZEF0TXNdIC0gRXBvY2ggdGltZXN0YW1wIGluIG1pbGxpc2Vjb25kcyB3aGVuIHRoZSBqb2IgYmVjb21lcyBlbGlnaWJsZSBmb3IgZGlzcGF0Y2guIERlZmF1bHRzIHRvIGVucXVldWUgdGltZS5cbiAqIEBwcm9wZXJ0eSB7bnVtYmVyfSBbdGltZW91dE1zXSAtIFBlci1qb2Igd2FsbC1jbG9jayB0aW1lb3V0IGZvciBmb3JrZWQgYW5kIHBvb2xlZCBleGVjdXRpb24uIEEgcG9zaXRpdmUgaW50ZWdlciB1cCB0byAyLDE0Nyw0ODMsNjQ3IG92ZXJyaWRlcyB0aGUgd29ya2VyLWxldmVsIGBqb2JUaW1lb3V0TXNgOyBhIG5vbi1wb3NpdGl2ZSBmaW5pdGUgdmFsdWUgZGlzYWJsZXMgdGhlIHRpbWVvdXQgZm9yIHRoaXMgam9iLlxuICovXG4vKipcbiAqIEB0eXBlZGVmIHtvYmplY3R9IEJhY2tncm91bmRKb2JQYXlsb2FkXG4gKiBAcHJvcGVydHkge3N0cmluZ30gW2lkXSAtIEpvYiBpZC5cbiAqIEBwcm9wZXJ0eSB7c3RyaW5nfSBqb2JOYW1lIC0gSm9iIGNsYXNzIG5hbWUuXG4gKiBAcHJvcGVydHkge0FycmF5PFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gW2FyZ3NdIC0gU2VyaWFsaXplZCBqb2IgYXJndW1lbnRzLlxuICogQHByb3BlcnR5IHtzdHJpbmd9IFtoYW5kb2ZmSWRdIC0gVW5pcXVlIGhhbmRvZmYgbGVhc2UgaWQuXG4gKiBAcHJvcGVydHkge3N0cmluZ30gW3dvcmtlcklkXSAtIFdvcmtlciBpZCBoYW5kbGluZyB0aGUgam9iLlxuICogQHByb3BlcnR5IHtudW1iZXJ9IFtoYW5kZWRPZmZBdE1zXSAtIFRpbWUgaGFuZGVkIHRvIGEgd29ya2VyIGluIG1zLlxuICogQHByb3BlcnR5IHtCYWNrZ3JvdW5kSm9iT3B0aW9uc30gW29wdGlvbnNdIC0gUnVudGltZSBvcHRpb25zLlxuICovXG4vKipcbiAqIEB0eXBlZGVmIHtvYmplY3R9IEJhY2tncm91bmRKb2JDb250ZXh0XG4gKiBAcHJvcGVydHkge3R5cGVvZiBpbXBvcnQoXCIuL3BsYXRmb3JtLWpvYi5qc1wiKS5kZWZhdWx0fSBqb2JDbGFzcyAtIENvbmNyZXRlIGpvYiBjbGFzcy5cbiAqIEBwcm9wZXJ0eSB7c3RyaW5nfSBqb2JOYW1lIC0gUmVnaXN0ZXJlZCBqb2IgbmFtZS5cbiAqIEBwcm9wZXJ0eSB7QXJyYXk8UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSBhcmdzIC0gU2VyaWFsaXplZCBqb2IgYXJndW1lbnRzLlxuICogQHByb3BlcnR5IHtCYWNrZ3JvdW5kSm9iT3B0aW9uc30gb3B0aW9ucyAtIFJlc29sdmVkIGVucXVldWUvcnVudGltZSBvcHRpb25zLlxuICogQHByb3BlcnR5IHtCYWNrZ3JvdW5kSm9iUGF5bG9hZH0gW3BheWxvYWRdIC0gQ29tcGxldGUgcGVyc2lzdGVkIHJ1bm5lciBwYXlsb2FkIHdoZW4gdGhlIGpvYiBpcyBwZXJmb3JtaW5nLlxuICovXG4vKipcbiAqIEB0eXBlZGVmIHtvYmplY3R9IEJhY2tncm91bmRKb2JSb3dcbiAqIEBwcm9wZXJ0eSB7c3RyaW5nfSBpZCAtIEpvYiBpZC5cbiAqIEBwcm9wZXJ0eSB7c3RyaW5nfSBqb2JOYW1lIC0gSm9iIGNsYXNzIG5hbWUuXG4gKiBAcHJvcGVydHkge0FycmF5PFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gYXJncyAtIFNlcmlhbGl6ZWQgam9iIGFyZ3VtZW50cy5cbiAqIEBwcm9wZXJ0eSB7QmFja2dyb3VuZEpvYkV4ZWN1dGlvbk1vZGV9IGV4ZWN1dGlvbk1vZGUgLSBIb3cgdGhlIGpvYiBzaG91bGQgcnVuLlxuICogQHByb3BlcnR5IHtzdHJpbmd9IHF1ZXVlIC0gUXVldWUgbmFtZSAoZGVmYXVsdHMgdG8gYFwiZGVmYXVsdFwiYCkuXG4gKiBAcHJvcGVydHkge3N0cmluZyB8IG51bGx9IHNjaGVkdWxlS2V5IC0gU3RhYmxlIGxvZ2ljYWwgc2NoZWR1bGUga2V5IHJldGFpbmVkIGZvciBoaXN0b3J5LlxuICogQHByb3BlcnR5IHtzdHJpbmd9IHN0YXR1cyAtIEN1cnJlbnQgam9iIHN0YXR1cy5cbiAqIEBwcm9wZXJ0eSB7bnVtYmVyIHwgbnVsbH0gYXR0ZW1wdHMgLSBGYWlsdXJlIGF0dGVtcHRzIGNvdW50LlxuICogQHByb3BlcnR5IHtudW1iZXIgfCBudWxsfSBtYXhSZXRyaWVzIC0gTWF4IHJldHJ5IGF0dGVtcHRzLlxuICogQHByb3BlcnR5IHtudW1iZXIgfCBudWxsfSBzY2hlZHVsZWRBdE1zIC0gTmV4dCBzY2hlZHVsZWQgdGltZSBpbiBtcy5cbiAqIEBwcm9wZXJ0eSB7bnVtYmVyIHwgbnVsbH0gY3JlYXRlZEF0TXMgLSBDcmVhdGlvbiB0aW1lIGluIG1zLlxuICogQHByb3BlcnR5IHtudW1iZXIgfCBudWxsfSBoYW5kZWRPZmZBdE1zIC0gVGltZSBoYW5kZWQgdG8gd29ya2VyIGluIG1zLlxuICogQHByb3BlcnR5IHtzdHJpbmcgfCBudWxsfSBoYW5kb2ZmSWQgLSBVbmlxdWUgbGF0ZXN0IGhhbmRvZmYgbGVhc2UgaWQuXG4gKiBAcHJvcGVydHkge251bWJlciB8IG51bGx9IGNvbXBsZXRlZEF0TXMgLSBDb21wbGV0aW9uIHRpbWUgaW4gbXMuXG4gKiBAcHJvcGVydHkge251bWJlciB8IG51bGx9IGZhaWxlZEF0TXMgLSBGYWlsdXJlIHRpbWUgaW4gbXMuXG4gKiBAcHJvcGVydHkge251bWJlciB8IG51bGx9IG9ycGhhbmVkQXRNcyAtIE9ycGhhbmVkIHRpbWUgaW4gbXMuXG4gKiBAcHJvcGVydHkge3N0cmluZyB8IG51bGx9IHdvcmtlcklkIC0gV29ya2VyIGlkIGhhbmRsaW5nIHRoZSBqb2IuXG4gKiBAcHJvcGVydHkge3N0cmluZyB8IG51bGx9IGxhc3RFcnJvciAtIExhc3QgZmFpbHVyZSBtZXNzYWdlLlxuICogQHByb3BlcnR5IHtzdHJpbmcgfCBudWxsfSBjb25jdXJyZW5jeUtleSAtIER1cmFibGUgY29uY3VycmVuY3kga2V5LlxuICogQHByb3BlcnR5IHtudW1iZXIgfCBudWxsfSBtYXhDb25jdXJyZW5jeSAtIER1cmFibGUgcGVyLWtleSBjYXAuXG4gKiBAcHJvcGVydHkge251bWJlciB8IG51bGx9IHRpbWVvdXRNcyAtIFBlci1qb2Igd2FsbC1jbG9jayB0aW1lb3V0IG92ZXJyaWRlLCBvciBudWxsIHdoZW4gb21pdHRlZC5cbiAqL1xuLyoqXG4gKiBAdHlwZWRlZiB7XCJxdWV1ZWRcIiB8IFwiaGFuZGVkX29mZlwiIHwgbnVsbH0gQmFja2dyb3VuZEpvYlJlcGxhY2VtZW50UHJldmlvdXNTdGF0dXNcbiAqL1xuLyoqXG4gKiBAdHlwZWRlZiB7b2JqZWN0fSBCYWNrZ3JvdW5kSm9iUmVwbGFjZW1lbnRSZXN1bHRcbiAqIEBwcm9wZXJ0eSB7c3RyaW5nfSBqb2JJZCAtIE5ld2x5IHF1ZXVlZCBqb2IgaWQuXG4gKiBAcHJvcGVydHkge3N0cmluZyB8IG51bGx9IHByZXZpb3VzSm9iSWQgLSBQcmV2aW91cyBhY3RpdmUgb3duZXIncyBqb2IgaWQuXG4gKiBAcHJvcGVydHkge0JhY2tncm91bmRKb2JSZXBsYWNlbWVudFByZXZpb3VzU3RhdHVzfSBwcmV2aW91c1N0YXR1cyAtIFByZXZpb3VzIG93bmVyJ3Mgb2JzZXJ2ZWQgc3RhdGUuXG4gKi9cbi8qKlxuICogQHR5cGVkZWYge1wiY2FuY2VsbGVkXCIgfCBcImhhbmRlZF9vZmZcIiB8IFwibm90X2ZvdW5kXCJ9IEJhY2tncm91bmRKb2JDYW5jZWxsYXRpb25PdXRjb21lXG4gKi9cbi8qKlxuICogQHR5cGVkZWYge29iamVjdH0gQmFja2dyb3VuZEpvYkNhbmNlbGxhdGlvblJlc3VsdFxuICogQHByb3BlcnR5IHtzdHJpbmcgfCBudWxsfSBqb2JJZCAtIERldGFjaGVkIG93bmVyJ3Mgam9iIGlkLCB3aGVuIG9uZSB3YXMgYWN0aXZlLlxuICogQHByb3BlcnR5IHtCYWNrZ3JvdW5kSm9iQ2FuY2VsbGF0aW9uT3V0Y29tZX0gb3V0Y29tZSAtIFRydXRoZnVsIGJlc3QtZWZmb3J0IG91dGNvbWUuXG4gKi9cbi8qKlxuICogQHR5cGVkZWYge29iamVjdH0gQmFja2dyb3VuZEpvYkZhaWx1cmVFdmVudFxuICogQHByb3BlcnR5IHtCYWNrZ3JvdW5kSm9iUm93fSBqb2IgLSBVcGRhdGVkIGpvYiByb3cgYWZ0ZXIgZmFpbHVyZSBoYW5kbGluZy5cbiAqIEBwcm9wZXJ0eSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59IGVycm9yIC0gRmFpbHVyZSBlcnJvci5cbiAqIEBwcm9wZXJ0eSB7bnVtYmVyIHwgbnVsbH0gYXR0ZW1wdHMgLSBVcGRhdGVkIGZhaWx1cmUgYXR0ZW1wdHMgY291bnQuXG4gKiBAcHJvcGVydHkge2Jvb2xlYW59IHRlcm1pbmFsIC0gV2hldGhlciB0aGlzIGZhaWx1cmUgZW5kZWQgdGhlIGpvYi5cbiAqIEBwcm9wZXJ0eSB7Ym9vbGVhbn0gd2lsbFJldHJ5IC0gV2hldGhlciB0aGUgam9iIHdhcyByZXR1cm5lZCB0byB0aGUgcXVldWUuXG4gKiBAcHJvcGVydHkge3N0cmluZyB8IHVuZGVmaW5lZH0gaGFuZG9mZklkIC0gSGFuZG9mZiBsZWFzZSBpZCBmcm9tIHRoZSB3b3JrZXIgcmVwb3J0LlxuICogQHByb3BlcnR5IHtudW1iZXIgfCB1bmRlZmluZWR9IGhhbmRlZE9mZkF0TXMgLSBIYW5kb2ZmIHRpbWVzdGFtcCBmcm9tIHRoZSB3b3JrZXIgcmVwb3J0LlxuICogQHByb3BlcnR5IHtzdHJpbmcgfCB1bmRlZmluZWR9IHdvcmtlcklkIC0gV29ya2VyIGlkIGZyb20gdGhlIHdvcmtlciByZXBvcnQuXG4gKi9cbi8qKlxuICogQHR5cGVkZWYge1wid29ya2VyXCIgfCBcImNsaWVudFwiIHwgXCJyZXBvcnRlclwifSBCYWNrZ3JvdW5kSm9iU29ja2V0Um9sZVxuICovXG4vKipcbiAqIEB0eXBlZGVmIHt7dHlwZTogXCJoZWxsb1wiLCByb2xlOiBCYWNrZ3JvdW5kSm9iU29ja2V0Um9sZSwgZ2VuZXJhdGlvbklkPzogc3RyaW5nLCBzdXBwb3J0c0hhbmRvZmZJZFJlcG9ydGluZz86IGJvb2xlYW4sIHN1cHBvcnRzSGVhcnRiZWF0PzogYm9vbGVhbiwgc3VwcG9ydHNQb29sZWQ/OiBib29sZWFuLCB3b3JrZXJJZD86IHN0cmluZ319IEJhY2tncm91bmRKb2JIZWxsb01lc3NhZ2VcbiAqIEB0eXBlZGVmIHt7dHlwZTogXCJnZW5lcmF0aW9uLWFjY2VwdGVkXCIsIGdlbmVyYXRpb25JZDogc3RyaW5nLCBsaWZlY3ljbGVTdGF0ZTogQmFja2dyb3VuZEpvYnNHZW5lcmF0aW9uTGlmZWN5Y2xlU3RhdGV9fSBCYWNrZ3JvdW5kSm9iR2VuZXJhdGlvbkFjY2VwdGVkTWVzc2FnZVxuICogQHR5cGVkZWYge3t0eXBlOiBcImdlbmVyYXRpb24tcmVqZWN0ZWRcIiwgcmVhc29uOiBCYWNrZ3JvdW5kSm9ic0dlbmVyYXRpb25SZWplY3Rpb25SZWFzb259fSBCYWNrZ3JvdW5kSm9iR2VuZXJhdGlvblJlamVjdGVkTWVzc2FnZVxuICogQHR5cGVkZWYge3t0eXBlOiBcInJlYWR5XCIsIGFjY2VwdHNGb3JrZWQ/OiBib29sZWFuLCBhY2NlcHRzSW5saW5lPzogYm9vbGVhbiwgYWNjZXB0c1Bvb2xlZD86IGJvb2xlYW4sIGFjY2VwdHNTcGF3bmVkPzogYm9vbGVhbiwgYXZhaWxhYmxlUG9vbGVkU2xvdHM/OiBudW1iZXJ9fSBCYWNrZ3JvdW5kSm9iUmVhZHlNZXNzYWdlXG4gKiBAdHlwZWRlZiB7e3R5cGU6IFwiZHJhaW5pbmdcIn19IEJhY2tncm91bmRKb2JEcmFpbmluZ01lc3NhZ2VcbiAqIEB0eXBlZGVmIHt7dHlwZTogXCJoZWFydGJlYXRcIiwgd29ya2VySWQ/OiBzdHJpbmd9fSBCYWNrZ3JvdW5kSm9iSGVhcnRiZWF0TWVzc2FnZVxuICogQHR5cGVkZWYge3t0eXBlOiBcImVucXVldWVcIiwgam9iTmFtZTogc3RyaW5nLCBhcmdzPzogQXJyYXk8UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+LCBvcHRpb25zPzogQmFja2dyb3VuZEpvYk9wdGlvbnN9fSBCYWNrZ3JvdW5kSm9iRW5xdWV1ZU1lc3NhZ2VcbiAqIEB0eXBlZGVmIHt7dHlwZTogXCJlbnF1ZXVlZFwiLCBqb2JJZDogc3RyaW5nfX0gQmFja2dyb3VuZEpvYkVucXVldWVkTWVzc2FnZVxuICogQHR5cGVkZWYge3t0eXBlOiBcImVucXVldWUtZXJyb3JcIiwgZXJyb3I/OiBzdHJpbmd9fSBCYWNrZ3JvdW5kSm9iRW5xdWV1ZUVycm9yTWVzc2FnZVxuICogQHR5cGVkZWYge3t0eXBlOiBcInJlcGxhY2Utc2NoZWR1bGVkXCIsIHNjaGVkdWxlS2V5OiBzdHJpbmcsIGpvYk5hbWU6IHN0cmluZywgYXJncz86IEFycmF5PFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Piwgb3B0aW9ucz86IEJhY2tncm91bmRKb2JPcHRpb25zfX0gQmFja2dyb3VuZEpvYlJlcGxhY2VTY2hlZHVsZWRNZXNzYWdlXG4gKiBAdHlwZWRlZiB7e3R5cGU6IFwic2NoZWR1bGUtcmVwbGFjZWRcIiwgam9iSWQ6IHN0cmluZywgcHJldmlvdXNKb2JJZDogc3RyaW5nIHwgbnVsbCwgcHJldmlvdXNTdGF0dXM6IEJhY2tncm91bmRKb2JSZXBsYWNlbWVudFByZXZpb3VzU3RhdHVzfX0gQmFja2dyb3VuZEpvYlNjaGVkdWxlUmVwbGFjZWRNZXNzYWdlXG4gKiBAdHlwZWRlZiB7e3R5cGU6IFwicmVwbGFjZS1zY2hlZHVsZWQtZXJyb3JcIiwgZXJyb3I/OiBzdHJpbmd9fSBCYWNrZ3JvdW5kSm9iUmVwbGFjZVNjaGVkdWxlZEVycm9yTWVzc2FnZVxuICogQHR5cGVkZWYge3t0eXBlOiBcImNhbmNlbC1zY2hlZHVsZWRcIiwgc2NoZWR1bGVLZXk6IHN0cmluZ319IEJhY2tncm91bmRKb2JDYW5jZWxTY2hlZHVsZWRNZXNzYWdlXG4gKiBAdHlwZWRlZiB7e3R5cGU6IFwic2NoZWR1bGUtY2FuY2VsbGVkXCIsIGpvYklkOiBzdHJpbmcgfCBudWxsLCBvdXRjb21lOiBCYWNrZ3JvdW5kSm9iQ2FuY2VsbGF0aW9uT3V0Y29tZX19IEJhY2tncm91bmRKb2JTY2hlZHVsZUNhbmNlbGxlZE1lc3NhZ2VcbiAqIEB0eXBlZGVmIHt7dHlwZTogXCJjYW5jZWwtc2NoZWR1bGVkLWVycm9yXCIsIGVycm9yPzogc3RyaW5nfX0gQmFja2dyb3VuZEpvYkNhbmNlbFNjaGVkdWxlZEVycm9yTWVzc2FnZVxuICogQHR5cGVkZWYge3t0eXBlOiBcImpvYlwiLCBwYXlsb2FkOiBCYWNrZ3JvdW5kSm9iUGF5bG9hZH19IEJhY2tncm91bmRKb2JKb2JNZXNzYWdlXG4gKiBAdHlwZWRlZiB7e3R5cGU6IFwiam9iLWNvbXBsZXRlXCIsIGpvYklkOiBzdHJpbmcsIGhhbmRvZmZJZD86IHN0cmluZywgd29ya2VySWQ/OiBzdHJpbmcsIGhhbmRlZE9mZkF0TXM/OiBudW1iZXJ9fSBCYWNrZ3JvdW5kSm9iQ29tcGxldGVNZXNzYWdlXG4gKiBAdHlwZWRlZiB7e3R5cGU6IFwiam9iLWZhaWxlZFwiLCBqb2JJZDogc3RyaW5nLCBlcnJvcj86IFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+LCBoYW5kb2ZmSWQ/OiBzdHJpbmcsIHdvcmtlcklkPzogc3RyaW5nLCBoYW5kZWRPZmZBdE1zPzogbnVtYmVyfX0gQmFja2dyb3VuZEpvYkZhaWxlZE1lc3NhZ2VcbiAqIEB0eXBlZGVmIHt7dHlwZTogXCJqb2ItcmVzY2hlZHVsZVwiLCBqb2JJZDogc3RyaW5nLCBkZWxheU1zOiBudW1iZXIsIGhhbmRvZmZJZD86IHN0cmluZywgd29ya2VySWQ/OiBzdHJpbmcsIGhhbmRlZE9mZkF0TXM/OiBudW1iZXJ9fSBCYWNrZ3JvdW5kSm9iUmVzY2hlZHVsZU1lc3NhZ2VcbiAqIEB0eXBlZGVmIHt7dHlwZTogXCJqb2ItdXBkYXRlZFwiLCBqb2JJZDogc3RyaW5nfX0gQmFja2dyb3VuZEpvYlVwZGF0ZWRNZXNzYWdlXG4gKiBAdHlwZWRlZiB7e3R5cGU6IFwiam9iLXVwZGF0ZS1lcnJvclwiLCBqb2JJZDogc3RyaW5nLCBlcnJvcj86IHN0cmluZ319IEJhY2tncm91bmRKb2JVcGRhdGVFcnJvck1lc3NhZ2VcbiAqL1xuLyoqXG4gKiBAdHlwZWRlZiB7QmFja2dyb3VuZEpvYkhlbGxvTWVzc2FnZSB8IEJhY2tncm91bmRKb2JHZW5lcmF0aW9uQWNjZXB0ZWRNZXNzYWdlIHwgQmFja2dyb3VuZEpvYkdlbmVyYXRpb25SZWplY3RlZE1lc3NhZ2UgfCBCYWNrZ3JvdW5kSm9iUmVhZHlNZXNzYWdlIHwgQmFja2dyb3VuZEpvYkRyYWluaW5nTWVzc2FnZSB8IEJhY2tncm91bmRKb2JIZWFydGJlYXRNZXNzYWdlIHwgQmFja2dyb3VuZEpvYkVucXVldWVNZXNzYWdlIHwgQmFja2dyb3VuZEpvYkVucXVldWVkTWVzc2FnZSB8IEJhY2tncm91bmRKb2JFbnF1ZXVlRXJyb3JNZXNzYWdlIHwgQmFja2dyb3VuZEpvYlJlcGxhY2VTY2hlZHVsZWRNZXNzYWdlIHwgQmFja2dyb3VuZEpvYlNjaGVkdWxlUmVwbGFjZWRNZXNzYWdlIHwgQmFja2dyb3VuZEpvYlJlcGxhY2VTY2hlZHVsZWRFcnJvck1lc3NhZ2UgfCBCYWNrZ3JvdW5kSm9iQ2FuY2VsU2NoZWR1bGVkTWVzc2FnZSB8IEJhY2tncm91bmRKb2JTY2hlZHVsZUNhbmNlbGxlZE1lc3NhZ2UgfCBCYWNrZ3JvdW5kSm9iQ2FuY2VsU2NoZWR1bGVkRXJyb3JNZXNzYWdlIHwgQmFja2dyb3VuZEpvYkpvYk1lc3NhZ2UgfCBCYWNrZ3JvdW5kSm9iQ29tcGxldGVNZXNzYWdlIHwgQmFja2dyb3VuZEpvYkZhaWxlZE1lc3NhZ2UgfCBCYWNrZ3JvdW5kSm9iUmVzY2hlZHVsZU1lc3NhZ2UgfCBCYWNrZ3JvdW5kSm9iVXBkYXRlZE1lc3NhZ2UgfCBCYWNrZ3JvdW5kSm9iVXBkYXRlRXJyb3JNZXNzYWdlfSBCYWNrZ3JvdW5kSm9iU29ja2V0TWVzc2FnZVxuICovXG5cbmV4cG9ydCBjb25zdCBub3RoaW5nID0ge31cbiJdfQ==