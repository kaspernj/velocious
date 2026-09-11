// @ts-check

import {TimeoutError} from "awaitery/build/timeout.js"

/**
 * @typedef {object} BackgroundJobEnqueueAttempt
 * @property {number} acknowledgementWaitElapsedMs - Time spent waiting for the acknowledgement after send.
 * @property {number} attemptElapsedMs - Total attempt time including connection and generation fencing.
 * @property {"initial" | "owned_replay"} attemptKind - Initial attempt or the one eligible owned replay.
 * @property {number} attemptNumber - One-based attempt number.
 * @property {boolean} explicitlyRejected - Whether the main explicitly rejected the enqueue.
 * @property {boolean} generationFenced - Whether the configured generation accepted the connection before send.
 * @property {boolean} requestSent - Whether the enqueue request entered the socket.
 */

/** Safe typed failure for an ambiguous post-send enqueue acknowledgement timeout. */
export default class BackgroundJobEnqueueAcknowledgementTimeoutError extends TimeoutError {
  /**
   * Builds an enqueue acknowledgement timeout error without request payload or connection details.
   * @param {object} args - Safe timeout context.
   * @param {number} args.acknowledgementTimeoutMs - Configured post-send acknowledgement deadline.
   * @param {Array<BackgroundJobEnqueueAttempt>} args.attemptHistory - Safe observations for timed-out attempts.
   * @param {TimeoutError} [args.cause] - Original Awaitery timeout.
   * @param {string} [args.generationId] - Accepted release generation identity.
   * @param {string} args.jobName - Resolved job class name.
   * @param {string} [args.producerInvocationId] - Owned enqueue invocation identity.
   * @param {boolean} args.producerProofPresent - Whether the request carried an internal producer proof.
   */
  constructor({acknowledgementTimeoutMs, attemptHistory, cause, generationId, jobName, producerInvocationId, producerProofPresent}) {
    super(`Background job enqueue acknowledgement timed out after ${acknowledgementTimeoutMs}ms`, cause ? {cause} : undefined)

    this.name = "BackgroundJobEnqueueAcknowledgementTimeoutError"
    /** @type {"BACKGROUND_JOB_ENQUEUE_ACKNOWLEDGEMENT_TIMEOUT"} */
    this.code = "BACKGROUND_JOB_ENQUEUE_ACKNOWLEDGEMENT_TIMEOUT"
    this.acknowledgementTimeoutMs = acknowledgementTimeoutMs
    this.attemptHistory = Object.freeze(attemptHistory.map((attempt) => Object.freeze({
      acknowledgementWaitElapsedMs: attempt.acknowledgementWaitElapsedMs,
      attemptElapsedMs: attempt.attemptElapsedMs,
      attemptKind: attempt.attemptKind,
      attemptNumber: attempt.attemptNumber,
      explicitlyRejected: attempt.explicitlyRejected,
      generationFenced: attempt.generationFenced,
      requestSent: attempt.requestSent
    })))
    this.generationId = generationId
    this.jobName = jobName
    this.producerInvocationId = producerInvocationId
    this.producerProofPresent = producerProofPresent
  }
}
