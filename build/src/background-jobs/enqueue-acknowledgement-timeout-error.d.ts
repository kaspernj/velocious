import { TimeoutError } from "awaitery/build/timeout.js";
export type BackgroundJobEnqueueAttempt = {
    /**
     * - Time spent waiting for the acknowledgement after send.
     */
    acknowledgementWaitElapsedMs: number;
    /**
     * - Total attempt time including connection and generation fencing.
     */
    attemptElapsedMs: number;
    /**
     * - Initial attempt or the one eligible owned replay.
     */
    attemptKind: "initial" | "owned_replay";
    /**
     * - One-based attempt number.
     */
    attemptNumber: number;
    /**
     * - Whether the main explicitly rejected the enqueue.
     */
    explicitlyRejected: boolean;
    /**
     * - Whether the configured generation accepted the connection before send.
     */
    generationFenced: boolean;
    /**
     * - Whether the enqueue request entered the socket.
     */
    requestSent: boolean;
};
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
    /** @type {"BACKGROUND_JOB_ENQUEUE_ACKNOWLEDGEMENT_TIMEOUT"} */
    code: "BACKGROUND_JOB_ENQUEUE_ACKNOWLEDGEMENT_TIMEOUT";
    acknowledgementTimeoutMs: number;
    attemptHistory: readonly Readonly<{
        acknowledgementWaitElapsedMs: number;
        attemptElapsedMs: number;
        attemptKind: "initial" | "owned_replay";
        attemptNumber: number;
        explicitlyRejected: boolean;
        generationFenced: boolean;
        requestSent: boolean;
    }>[];
    generationId: string | undefined;
    jobName: string;
    producerInvocationId: string | undefined;
    producerProofPresent: boolean;
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
    constructor({ acknowledgementTimeoutMs, attemptHistory, cause, generationId, jobName, producerInvocationId, producerProofPresent }: {
        acknowledgementTimeoutMs: number;
        attemptHistory: Array<BackgroundJobEnqueueAttempt>;
        cause?: TimeoutError;
        generationId?: string;
        jobName: string;
        producerInvocationId?: string;
        producerProofPresent: boolean;
    });
}
//# sourceMappingURL=enqueue-acknowledgement-timeout-error.d.ts.map