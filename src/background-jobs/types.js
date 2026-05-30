// @ts-check

/**
 * @typedef {object} BackgroundJobOptions
 * @property {boolean} [forked] - Whether the job should run forked. Defaults to true.
 * @property {number} [maxRetries] - Max retries for a failed job before it is marked failed.
 */
/**
 * @typedef {object} BackgroundJobPayload
 * @property {string} [id] - Job id.
 * @property {string} jobName - Job class name.
 * @property {any[]} [args] - Serialized job arguments.
 * @property {string} [workerId] - Worker id handling the job.
 * @property {number} [handedOffAtMs] - Time handed to a worker in ms.
 * @property {BackgroundJobOptions} [options] - Runtime options.
 */
/**
 * @typedef {object} BackgroundJobRow
 * @property {string} id - Job id.
 * @property {string} jobName - Job class name.
 * @property {any[]} args - Serialized job arguments.
 * @property {boolean} forked - Whether the job is forked.
 * @property {string} status - Current job status.
 * @property {number | null} attempts - Failure attempts count.
 * @property {number | null} maxRetries - Max retry attempts.
 * @property {number | null} scheduledAtMs - Next scheduled time in ms.
 * @property {number | null} createdAtMs - Creation time in ms.
 * @property {number | null} handedOffAtMs - Time handed to worker in ms.
 * @property {number | null} completedAtMs - Completion time in ms.
 * @property {number | null} failedAtMs - Failure time in ms.
 * @property {number | null} orphanedAtMs - Orphaned time in ms.
 * @property {string | null} workerId - Worker id handling the job.
 * @property {string | null} lastError - Last failure message.
 */
/**
 * @typedef {object} BackgroundJobFailureEvent
 * @property {BackgroundJobRow} job - Updated job row after failure handling.
 * @property {unknown} error - Failure error.
 * @property {number | null} attempts - Updated failure attempts count.
 * @property {boolean} terminal - Whether this failure ended the job.
 * @property {boolean} willRetry - Whether the job was returned to the queue.
 * @property {number | undefined} handedOffAtMs - Handoff timestamp from the worker report.
 * @property {string | undefined} workerId - Worker id from the worker report.
 */
/**
 * @typedef {"worker" | "client" | "reporter"} BackgroundJobSocketRole
 */
/**
 * @typedef {{type: "hello", role: BackgroundJobSocketRole, workerId?: string}} BackgroundJobHelloMessage
 * @typedef {{type: "ready", acceptsForked?: boolean, acceptsInline?: boolean}} BackgroundJobReadyMessage
 * @typedef {{type: "draining"}} BackgroundJobDrainingMessage
 * @typedef {{type: "enqueue", jobName: string, args?: any[], options?: BackgroundJobOptions}} BackgroundJobEnqueueMessage
 * @typedef {{type: "job", payload: BackgroundJobPayload}} BackgroundJobJobMessage
 * @typedef {{type: "job-complete", jobId: string, workerId?: string, handedOffAtMs?: number}} BackgroundJobCompleteMessage
 * @typedef {{type: "job-failed", jobId: string, error?: unknown, workerId?: string, handedOffAtMs?: number}} BackgroundJobFailedMessage
 * @typedef {{type: "job-updated", jobId: string}} BackgroundJobUpdatedMessage
 * @typedef {{type: "job-update-error", jobId: string, error?: string}} BackgroundJobUpdateErrorMessage
 */
/**
 * @typedef {BackgroundJobHelloMessage | BackgroundJobReadyMessage | BackgroundJobDrainingMessage | BackgroundJobEnqueueMessage | BackgroundJobJobMessage | BackgroundJobCompleteMessage | BackgroundJobFailedMessage | BackgroundJobUpdatedMessage | BackgroundJobUpdateErrorMessage} BackgroundJobSocketMessage
 */

export const nothing = {}
