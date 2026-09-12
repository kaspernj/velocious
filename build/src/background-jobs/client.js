// @ts-check
import timeout, { TimeoutError } from "awaitery/build/timeout.js";
import configurationResolver from "../configuration-resolver.js";
import isPlainObject from "../utils/plain-object.js";
import BackgroundJobEnqueueAcknowledgementTimeoutError from "./enqueue-acknowledgement-timeout-error.js";
import BackgroundJobsSocketRequest from "./socket-request.js";
import { DEFAULT_GENERATION_HANDSHAKE_TIMEOUT_MS, validateGenerationHandshakeTimeoutMs } from "./generation-handshake-timeout-error.js";
import { BACKGROUND_JOB_ACTIVE_STATUSES, BACKGROUND_JOB_EXECUTION_MODES, BACKGROUND_JOB_STATUSES, BACKGROUND_JOB_TERMINAL_STATUSES } from "./job-semantics.js";
const DEFAULT_ENQUEUE_TIMEOUT_MS = 5000;
const BACKGROUND_JOB_WAKE_OUTCOMES = ["woken", "already_due", "handed_off", "not_found"];
const BACKGROUND_JOB_NULLABLE_NUMBER_FIELDS = [
    "attempts",
    "childPid",
    "childReceivedAtMs",
    "childStartedAtMs",
    "completedAtMs",
    "createdAtMs",
    "failedAtMs",
    "handedOffAtMs",
    "maxConcurrency",
    "maxRetries",
    "orphanedAtMs",
    "scheduleOrder",
    "scheduledAtMs",
    "timeoutMs"
];
const BACKGROUND_JOB_NULLABLE_STRING_FIELDS = ["childInstanceId", "concurrencyKey", "handoffId", "lastError", "scheduleKey", "workerId"];
/**
 * Checks a required nullable number from a normalized wire row.
 * @param {ReturnType<typeof JSON.parse>} value - Field value.
 * @returns {boolean} - Whether the field is null or a finite number.
 */
function isNullableBackgroundJobNumber(value) {
    return value === null || (typeof value === "number" && Number.isFinite(value));
}
/**
 * Checks a required nullable string from a normalized wire row.
 * @param {ReturnType<typeof JSON.parse>} value - Field value.
 * @returns {boolean} - Whether the field is null or a string.
 */
function isNullableBackgroundJobString(value) {
    return value === null || typeof value === "string";
}
/**
 * Checks that a transport job uses the normalized public camel-case shape.
 * @param {ReturnType<typeof JSON.parse>} value - Transport value.
 * @returns {value is import("./types.js").BackgroundJobRow} - Whether normalized.
 */
function isNormalizedBackgroundJob(value) {
    if (!isPlainObject(value))
        return false;
    const job = value;
    return typeof job.id === "string"
        && typeof job.jobName === "string"
        && Array.isArray(job.args)
        && BACKGROUND_JOB_EXECUTION_MODES.some((executionMode) => executionMode === job.executionMode)
        && typeof job.queue === "string"
        && BACKGROUND_JOB_STATUSES.some((status) => status === job.status)
        && BACKGROUND_JOB_NULLABLE_NUMBER_FIELDS.every((field) => isNullableBackgroundJobNumber(job[field]))
        && BACKGROUND_JOB_NULLABLE_STRING_FIELDS.every((field) => isNullableBackgroundJobString(job[field]));
}
/**
 * Describes an unexpected protocol response without echoing its payload.
 * @param {string} operation - Public operation name.
 * @param {import("./types.js").BackgroundJobSocketMessage} message - Response.
 * @returns {Error} - Protocol error.
 */
function unexpectedResponseError(operation, message) {
    const responseType = message && typeof message.type === "string" ? message.type : "missing type";
    return new Error(`Unexpected ${operation} response: ${responseType}`);
}
export default class BackgroundJobsClient {
    /**
     * Runs constructor.
     * @param {object} [args] - Options.
     * @param {import("../configuration.js").default} [args.configuration] - Configuration.
     * @param {number} [args.enqueueTimeoutMs] - Maximum time to wait for an enqueue acknowledgement in milliseconds (default: 5000).
     * @param {number} [args.generationHandshakeTimeoutMs] - Maximum time to wait for generation acknowledgement (default: 4000).
     * @param {string} [args.generationId] - Explicit release generation identity.
     */
    constructor({ configuration, enqueueTimeoutMs = DEFAULT_ENQUEUE_TIMEOUT_MS, generationHandshakeTimeoutMs = DEFAULT_GENERATION_HANDSHAKE_TIMEOUT_MS, generationId } = {}) {
        this.configurationPromise = configuration ? Promise.resolve(configuration) : configurationResolver();
        this.enqueueTimeoutMs = enqueueTimeoutMs;
        this.generationHandshakeTimeoutMs = validateGenerationHandshakeTimeoutMs(generationHandshakeTimeoutMs);
        this.explicitGenerationId = generationId;
    }
    /**
     * Builds a one-shot client socket request from the resolved configuration.
     * @returns {Promise<BackgroundJobsSocketRequest>} - Socket request.
     */
    async _request() {
        const configuration = await this.configurationPromise;
        const { host, port } = configuration.getBackgroundJobsConfig();
        const { generationId } = configuration.resolveBackgroundJobsGenerationConfig({
            generationId: this.explicitGenerationId,
            sourceName: "BackgroundJobsClient"
        });
        return new BackgroundJobsSocketRequest({ host, port, role: "client", generationHandshakeTimeoutMs: this.generationHandshakeTimeoutMs, generationId });
    }
    /**
     * Runs enqueue.
     * @param {object} args - Options.
     * @param {string} args.jobName - Job name.
     * @param {Array<ReturnType<typeof JSON.parse>>} args.args - Job args.
     * @param {import("./types.js").BackgroundJobOptions} [args.options] - Job options.
     * @param {string} [args.producerInvocationId] - Stable identity for one owned enqueue invocation.
     * @param {import("./types.js").BackgroundJobProducerProof} [args.producerProof] - Exact internal producer handoff.
     * @returns {Promise<string>} - Job id.
     */
    async enqueue({ jobName, args, options, producerInvocationId, producerProof }) {
        const message = {
            type: /** @type {const} */ ("enqueue"),
            jobName,
            args,
            options,
            ...(producerInvocationId ? { producerInvocationId } : {}),
            ...(producerProof ? { producerProof } : {})
        };
        /**
         * Creates safe observations for one attempt without retaining request data.
         * @param {object} args - Attempt identity.
         * @param {"initial" | "owned_replay"} args.attemptKind - Initial attempt or owned replay.
         * @param {number} args.attemptNumber - One-based attempt number.
         * @returns {import("./enqueue-acknowledgement-timeout-error.js").BackgroundJobEnqueueAttempt} - Mutable attempt observations.
         */
        const newAttemptObservation = ({ attemptKind, attemptNumber }) => ({
            acknowledgementWaitElapsedMs: 0,
            attemptElapsedMs: 0,
            attemptKind,
            attemptNumber,
            explicitlyRejected: false,
            generationFenced: false,
            requestSent: false
        });
        /**
         * Sends one enqueue attempt. An owned caller may replay this exact message
         * once when transport acknowledgement remains ambiguous after send.
         * @param {import("./enqueue-acknowledgement-timeout-error.js").BackgroundJobEnqueueAttempt} attemptObservation - Mutable attempt observations.
         * @param {Readonly<Array<import("./enqueue-acknowledgement-timeout-error.js").BackgroundJobEnqueueAttempt>>} previousAttempts - Earlier timed-out attempts.
         * @returns {Promise<string>} - Job id.
         */
        const enqueueAttempt = async (attemptObservation, previousAttempts) => {
            const attemptStartedAtMs = Date.now();
            const request = await this._request();
            const requestAbortController = new AbortController();
            const timeoutErrorMessage = `Background job enqueue acknowledgement timed out after ${this.enqueueTimeoutMs}ms`;
            /** @type {number | undefined} */
            let requestSentAtMs;
            /**
             * Resolves the pre-send phase when the mutation has entered the socket.
             * @type {() => void}
             */
            let markRequestSent = () => { };
            const requestSent = new Promise((resolve) => {
                markRequestSent = () => resolve(undefined);
            });
            /**
             * Applies the configured deadline independently to one request phase.
             * @template T
             * @param {() => Promise<T>} callback - Phase work.
             * @returns {Promise<T>} - Phase result.
             */
            const withEnqueueTimeout = async (callback) => await timeout({
                errorMessage: timeoutErrorMessage,
                timeout: this.enqueueTimeoutMs
            }, async ({ control }) => {
                const abortRequest = () => requestAbortController.abort(control.signal.reason);
                control.signal.addEventListener("abort", abortRequest);
                try {
                    return await callback();
                }
                finally {
                    control.signal.removeEventListener("abort", abortRequest);
                }
            });
            const requestPromise = request.run({
                signal: requestAbortController.signal,
                onConnect: (jsonSocket) => {
                    jsonSocket.send(message);
                    attemptObservation.generationFenced = Boolean(request.generationId);
                    attemptObservation.requestSent = true;
                    requestSentAtMs = Date.now();
                    markRequestSent();
                },
                onMessage: ({ message, resolve, reject }) => {
                    if (message?.type === "enqueued") {
                        resolve(message.jobId);
                        return;
                    }
                    if (message?.type === "enqueue-error") {
                        attemptObservation.explicitlyRejected = true;
                        reject(new Error(message.error || "Failed to enqueue job"));
                    }
                }
            });
            await withEnqueueTimeout(async () => await Promise.race([requestSent, requestPromise]));
            try {
                return await withEnqueueTimeout(async () => await requestPromise);
            }
            catch (error) {
                if (!(error instanceof TimeoutError))
                    throw error;
                if (requestSentAtMs === undefined)
                    throw new Error("Background job enqueue acknowledgement wait started before the request was sent", { cause: error });
                const timedOutAtMs = Date.now();
                // The fired timer proves its logical deadline even when the adjustable wall clock reports a shorter interval.
                const acknowledgementWaitElapsedMs = Math.max(this.enqueueTimeoutMs, timedOutAtMs - requestSentAtMs);
                attemptObservation.acknowledgementWaitElapsedMs = acknowledgementWaitElapsedMs;
                attemptObservation.attemptElapsedMs = Math.max(acknowledgementWaitElapsedMs, timedOutAtMs - attemptStartedAtMs);
                throw new BackgroundJobEnqueueAcknowledgementTimeoutError({
                    acknowledgementTimeoutMs: this.enqueueTimeoutMs,
                    attemptHistory: [...previousAttempts, attemptObservation],
                    cause: error,
                    generationId: request.generationId,
                    jobName,
                    producerInvocationId,
                    producerProofPresent: Boolean(producerProof)
                });
            }
        };
        const initialAttempt = newAttemptObservation({ attemptKind: "initial", attemptNumber: 1 });
        try {
            return await enqueueAttempt(initialAttempt, []);
        }
        catch (error) {
            if (!producerInvocationId || !producerProof || !initialAttempt.generationFenced || !initialAttempt.requestSent || initialAttempt.explicitlyRejected)
                throw error;
            const previousAttempts = error instanceof BackgroundJobEnqueueAcknowledgementTimeoutError ? error.attemptHistory : [];
            const replayAttempt = newAttemptObservation({ attemptKind: "owned_replay", attemptNumber: 2 });
            return await enqueueAttempt(replayAttempt, previousAttempts);
        }
    }
    /**
     * Atomically replaces the queued owner of a stable schedule key.
     * @param {object} args - Options.
     * @param {string} args.scheduleKey - Stable logical schedule key.
     * @param {string} args.jobName - Job name.
     * @param {Array<ReturnType<typeof JSON.parse>>} args.args - Job args.
     * @param {import("./types.js").BackgroundJobOptions} [args.options] - Job options.
     * @returns {Promise<import("./types.js").BackgroundJobReplacementResult>} - Replacement result.
     */
    async replaceScheduled({ scheduleKey, jobName, args, options }) {
        const request = await this._request();
        return await request.run({
            onConnect: (jsonSocket) => {
                jsonSocket.send({ type: "replace-scheduled", scheduleKey, jobName, args, options });
            },
            onMessage: ({ message, resolve, reject }) => {
                if (message?.type === "schedule-replaced") {
                    resolve({
                        jobId: message.jobId,
                        previousJobId: message.previousJobId,
                        previousStatus: message.previousStatus
                    });
                    return;
                }
                if (message?.type === "replace-scheduled-error") {
                    reject(new Error(message.error || "Failed to replace scheduled job"));
                }
            }
        });
    }
    /**
     * Cancels or detaches the current owner of a stable schedule key.
     * @param {object} args - Options.
     * @param {string} args.scheduleKey - Stable logical schedule key.
     * @returns {Promise<import("./types.js").BackgroundJobCancellationResult>} - Cancellation result.
     */
    async cancelScheduled({ scheduleKey }) {
        const request = await this._request();
        return await request.run({
            onConnect: (jsonSocket) => {
                jsonSocket.send({ type: "cancel-scheduled", scheduleKey });
            },
            onMessage: ({ message, resolve, reject }) => {
                if (message?.type === "schedule-cancelled") {
                    resolve({ jobId: message.jobId, outcome: message.outcome });
                    return;
                }
                if (message?.type === "cancel-scheduled-error") {
                    reject(new Error(message.error || "Failed to cancel scheduled job"));
                }
            }
        });
    }
    /**
     * Reads current stable ownership and optional terminal history.
     * @param {{scheduleKey: string, includeLatestTerminal?: boolean}} args - Lookup request.
     * @returns {Promise<import("./types.js").BackgroundJobScheduledLookupResult>} - Normalized stable schedule jobs.
     */
    async getScheduledJob({ scheduleKey, includeLatestTerminal }) {
        const request = await this._request();
        return await request.run({
            onConnect: (jsonSocket) => {
                jsonSocket.send({ type: "get-scheduled-job", scheduleKey, includeLatestTerminal });
            },
            onMessage: ({ message, resolve, reject }) => {
                if (message?.type === "scheduled-job") {
                    const { currentJob, latestTerminalJob } = message;
                    const currentJobValid = currentJob === null
                        || (isNormalizedBackgroundJob(currentJob) && BACKGROUND_JOB_ACTIVE_STATUSES.some((status) => status === currentJob.status));
                    const latestTerminalJobValid = latestTerminalJob === null
                        || (isNormalizedBackgroundJob(latestTerminalJob) && BACKGROUND_JOB_TERMINAL_STATUSES.some((status) => status === latestTerminalJob.status));
                    if (!currentJobValid || !latestTerminalJobValid) {
                        reject(new Error("Invalid getScheduledJob response: expected normalized public job values"));
                        return;
                    }
                    resolve({ currentJob, latestTerminalJob });
                    return;
                }
                if (message?.type === "get-scheduled-job-error") {
                    reject(new Error(message.error || "Failed to read scheduled job"));
                    return;
                }
                reject(unexpectedResponseError("getScheduledJob", message));
            }
        });
    }
    /**
     * Expedites a future queued stable owner without changing job identity.
     * @param {{scheduleKey: string}} args - Wake request.
     * @returns {Promise<import("./types.js").BackgroundJobWakeResult>} - Wake result.
     */
    async wakeScheduled({ scheduleKey }) {
        const request = await this._request();
        return await request.run({
            onConnect: (jsonSocket) => {
                jsonSocket.send({ type: "wake-scheduled", scheduleKey });
            },
            onMessage: ({ message, resolve, reject }) => {
                if (message?.type === "schedule-woken") {
                    const outcome = message.outcome;
                    const knownOutcome = BACKGROUND_JOB_WAKE_OUTCOMES.includes(outcome);
                    const validJobId = outcome === "not_found" ? message.jobId === null : typeof message.jobId === "string" && message.jobId.length > 0;
                    if (!knownOutcome || !validJobId) {
                        reject(new Error("Invalid wakeScheduled response"));
                        return;
                    }
                    resolve({ jobId: message.jobId, outcome });
                    return;
                }
                if (message?.type === "wake-scheduled-error") {
                    reject(new Error(message.error || "Failed to wake scheduled job"));
                    return;
                }
                reject(unexpectedResponseError("wakeScheduled", message));
            }
        });
    }
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiY2xpZW50LmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiLi4vLi4vLi4vc3JjL2JhY2tncm91bmQtam9icy9jbGllbnQuanMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6IkFBQUEsWUFBWTtBQUVaLE9BQU8sT0FBTyxFQUFFLEVBQUUsWUFBWSxFQUFFLE1BQU0sMkJBQTJCLENBQUE7QUFDakUsT0FBTyxxQkFBcUIsTUFBTSw4QkFBOEIsQ0FBQTtBQUNoRSxPQUFPLGFBQWEsTUFBTSwwQkFBMEIsQ0FBQTtBQUNwRCxPQUFPLCtDQUErQyxNQUFNLDRDQUE0QyxDQUFBO0FBQ3hHLE9BQU8sMkJBQTJCLE1BQU0scUJBQXFCLENBQUE7QUFDN0QsT0FBTyxFQUFFLHVDQUF1QyxFQUFFLG9DQUFvQyxFQUFFLE1BQU0seUNBQXlDLENBQUE7QUFDdkksT0FBTyxFQUFFLDhCQUE4QixFQUFFLDhCQUE4QixFQUFFLHVCQUF1QixFQUFFLGdDQUFnQyxFQUFFLE1BQU0sb0JBQW9CLENBQUE7QUFFOUosTUFBTSwwQkFBMEIsR0FBRyxJQUFJLENBQUE7QUFDdkMsTUFBTSw0QkFBNEIsR0FBRyxDQUFDLE9BQU8sRUFBRSxhQUFhLEVBQUUsWUFBWSxFQUFFLFdBQVcsQ0FBQyxDQUFBO0FBQ3hGLE1BQU0scUNBQXFDLEdBQUc7SUFDNUMsVUFBVTtJQUNWLFVBQVU7SUFDVixtQkFBbUI7SUFDbkIsa0JBQWtCO0lBQ2xCLGVBQWU7SUFDZixhQUFhO0lBQ2IsWUFBWTtJQUNaLGVBQWU7SUFDZixnQkFBZ0I7SUFDaEIsWUFBWTtJQUNaLGNBQWM7SUFDZCxlQUFlO0lBQ2YsZUFBZTtJQUNmLFdBQVc7Q0FDWixDQUFBO0FBQ0QsTUFBTSxxQ0FBcUMsR0FBRyxDQUFDLGlCQUFpQixFQUFFLGdCQUFnQixFQUFFLFdBQVcsRUFBRSxXQUFXLEVBQUUsYUFBYSxFQUFFLFVBQVUsQ0FBQyxDQUFBO0FBRXhJOzs7O0dBSUc7QUFDSCxTQUFTLDZCQUE2QixDQUFDLEtBQUs7SUFDMUMsT0FBTyxL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SUFBSSxPQUFPLENBQUMsS0FBSyxDQUFDLE1BQU0sR0FBRyxDQUFDLENBQUE7b0JBRW5JLElBQUksQ0FBQyxZQUFZLElBQUksQ0FBQyxVQUFVLEVBQUUsQ0FBQzt3QkFDakMsTUFBTSxDQUFDLElBQUksS0FBSyxDQUFDLGdDQUFnQyxDQUFDLENBQUMsQ0FBQTt3QkFDbkQsT0FBTTtvQkFDUixDQUFDO29CQUVELE9BQU8sQ0FBQyxFQUFDLEtBQUssRUFBRSxPQUFPLENBQUMsS0FBSyxFQUFFLE9BQU8sRUFBQyxDQUFDLENBQUE7b0JBQ3hDLE9BQU07Z0JBQ1IsQ0FBQztnQkFFRCxJQUFJLE9BQU8sRUFBRSxJQUFJLEtBQUssc0JBQXNCLEVBQUUsQ0FBQztvQkFDN0MsTUFBTSxDQUFDLElBQUksS0FBSyxDQUFDLE9BQU8sQ0FBQyxLQUFLLElBQUksOEJBQThCLENBQUMsQ0FBQyxDQUFBO29CQUNsRSxPQUFNO2dCQUNSLENBQUM7Z0JBRUQsTUFBTSxDQUFDLHVCQUF1QixDQUFDLGVBQWUsRUFBRSxPQUFPLENBQUMsQ0FBQyxDQUFBO1lBQzNELENBQUM7U0FDRixDQUFDLENBQUE7SUFDSixDQUFDO0NBQ0YiLCJzb3VyY2VzQ29udGVudCI6WyIvLyBAdHMtY2hlY2tcblxuaW1wb3J0IHRpbWVvdXQsIHsgVGltZW91dEVycm9yIH0gZnJvbSBcImF3YWl0ZXJ5L2J1aWxkL3RpbWVvdXQuanNcIlxuaW1wb3J0IGNvbmZpZ3VyYXRpb25SZXNvbHZlciBmcm9tIFwiLi4vY29uZmlndXJhdGlvbi1yZXNvbHZlci5qc1wiXG5pbXBvcnQgaXNQbGFpbk9iamVjdCBmcm9tIFwiLi4vdXRpbHMvcGxhaW4tb2JqZWN0LmpzXCJcbmltcG9ydCBCYWNrZ3JvdW5kSm9iRW5xdWV1ZUFja25vd2xlZGdlbWVudFRpbWVvdXRFcnJvciBmcm9tIFwiLi9lbnF1ZXVlLWFja25vd2xlZGdlbWVudC10aW1lb3V0LWVycm9yLmpzXCJcbmltcG9ydCBCYWNrZ3JvdW5kSm9ic1NvY2tldFJlcXVlc3QgZnJvbSBcIi4vc29ja2V0LXJlcXVlc3QuanNcIlxuaW1wb3J0IHsgREVGQVVMVF9HRU5FUkFUSU9OX0hBTkRTSEFLRV9USU1FT1VUX01TLCB2YWxpZGF0ZUdlbmVyYXRpb25IYW5kc2hha2VUaW1lb3V0TXMgfSBmcm9tIFwiLi9nZW5lcmF0aW9uLWhhbmRzaGFrZS10aW1lb3V0LWVycm9yLmpzXCJcbmltcG9ydCB7IEJBQ0tHUk9VTkRfSk9CX0FDVElWRV9TVEFUVVNFUywgQkFDS0dST1VORF9KT0JfRVhFQ1VUSU9OX01PREVTLCBCQUNLR1JPVU5EX0pPQl9TVEFUVVNFUywgQkFDS0dST1VORF9KT0JfVEVSTUlOQUxfU1RBVFVTRVMgfSBmcm9tIFwiLi9qb2Itc2VtYW50aWNzLmpzXCJcblxuY29uc3QgREVGQVVMVF9FTlFVRVVFX1RJTUVPVVRfTVMgPSA1MDAwXG5jb25zdCBCQUNLR1JPVU5EX0pPQl9XQUtFX09VVENPTUVTID0gW1wid29rZW5cIiwgXCJhbHJlYWR5X2R1ZVwiLCBcImhhbmRlZF9vZmZcIiwgXCJub3RfZm91bmRcIl1cbmNvbnN0IEJBQ0tHUk9VTkRfSk9CX05VTExBQkxFX05VTUJFUl9GSUVMRFMgPSBbXG4gIFwiYXR0ZW1wdHNcIixcbiAgXCJjaGlsZFBpZFwiLFxuICBcImNoaWxkUmVjZWl2ZWRBdE1zXCIsXG4gIFwiY2hpbGRTdGFydGVkQXRNc1wiLFxuICBcImNvbXBsZXRlZEF0TXNcIixcbiAgXCJjcmVhdGVkQXRNc1wiLFxuICBcImZhaWxlZEF0TXNcIixcbiAgXCJoYW5kZWRPZmZBdE1zXCIsXG4gIFwibWF4Q29uY3VycmVuY3lcIixcbiAgXCJtYXhSZXRyaWVzXCIsXG4gIFwib3JwaGFuZWRBdE1zXCIsXG4gIFwic2NoZWR1bGVPcmRlclwiLFxuICBcInNjaGVkdWxlZEF0TXNcIixcbiAgXCJ0aW1lb3V0TXNcIlxuXVxuY29uc3QgQkFDS0dST1VORF9KT0JfTlVMTEFCTEVfU1RSSU5HX0ZJRUxEUyA9IFtcImNoaWxkSW5zdGFuY2VJZFwiLCBcImNvbmN1cnJlbmN5S2V5XCIsIFwiaGFuZG9mZklkXCIsIFwibGFzdEVycm9yXCIsIFwic2NoZWR1bGVLZXlcIiwgXCJ3b3JrZXJJZFwiXVxuXG4vKipcbiAqIENoZWNrcyBhIHJlcXVpcmVkIG51bGxhYmxlIG51bWJlciBmcm9tIGEgbm9ybWFsaXplZCB3aXJlIHJvdy5cbiAqIEBwYXJhbSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59IHZhbHVlIC0gRmllbGQgdmFsdWUuXG4gKiBAcmV0dXJucyB7Ym9vbGVhbn0gLSBXaGV0aGVyIHRoZSBmaWVsZCBpcyBudWxsIG9yIGEgZmluaXRlIG51bWJlci5cbiAqL1xuZnVuY3Rpb24gaXNOdWxsYWJsZUJhY2tncm91bmRKb2JOdW1iZXIodmFsdWUpIHtcbiAgcmV0dXJuIHZhbHVlID09PSBudWxsIHx8ICh0eXBlb2YgdmFsdWUgPT09IFwibnVtYmVyXCIgJiYgTnVtYmVyLmlzRmluaXRlKHZhbHVlKSlcbn1cblxuLyoqXG4gKiBDaGVja3MgYSByZXF1aXJlZCBudWxsYWJsZSBzdHJpbmcgZnJvbSBhIG5vcm1hbGl6ZWQgd2lyZSByb3cuXG4gKiBAcGFyYW0ge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSB2YWx1ZSAtIEZpZWxkIHZhbHVlLlxuICogQHJldHVybnMge2Jvb2xlYW59IC0gV2hldGhlciB0aGUgZmllbGQgaXMgbnVsbCBvciBhIHN0cmluZy5cbiAqL1xuZnVuY3Rpb24gaXNOdWxsYWJsZUJhY2tncm91bmRKb2JTdHJpbmcodmFsdWUpIHtcbiAgcmV0dXJuIHZhbHVlID09PSBudWxsIHx8IHR5cGVvZiB2YWx1ZSA9PT0gXCJzdHJpbmdcIlxufVxuXG4vKipcbiAqIENoZWNrcyB0aGF0IGEgdHJhbnNwb3J0IGpvYiB1c2VzIHRoZSBub3JtYWxpemVkIHB1YmxpYyBjYW1lbC1jYXNlIHNoYXBlLlxuICogQHBhcmFtIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gdmFsdWUgLSBUcmFuc3BvcnQgdmFsdWUuXG4gKiBAcmV0dXJucyB7dmFsdWUgaXMgaW1wb3J0KFwiLi90eXBlcy5qc1wiKS5CYWNrZ3JvdW5kSm9iUm93fSAtIFdoZXRoZXIgbm9ybWFsaXplZC5cbiAqL1xuZnVuY3Rpb24gaXNOb3JtYWxpemVkQmFja2dyb3VuZEpvYih2YWx1ZSkge1xuICBpZiAoIWlzUGxhaW5PYmplY3QodmFsdWUpKSByZXR1cm4gZmFsc2VcblxuICBjb25zdCBqb2IgPSB2YWx1ZVxuXG4gIHJldHVybiB0eXBlb2Ygam9iLmlkID09PSBcInN0cmluZ1wiXG4gICAgJiYgdHlwZW9mIGpvYi5qb2JOYW1lID09PSBcInN0cmluZ1wiXG4gICAgJiYgQXJyYXkuaXNBcnJheShqb2IuYXJncylcbiAgICAmJiBCQUNLR1JPVU5EX0pPQl9FWEVDVVRJT05fTU9ERVMuc29tZSgoZXhlY3V0aW9uTW9kZSkgPT4gZXhlY3V0aW9uTW9kZSA9PT0gam9iLmV4ZWN1dGlvbk1vZGUpXG4gICAgJiYgdHlwZW9mIGpvYi5xdWV1ZSA9PT0gXCJzdHJpbmdcIlxuICAgICYmIEJBQ0tHUk9VTkRfSk9CX1NUQVRVU0VTLnNvbWUoKHN0YXR1cykgPT4gc3RhdHVzID09PSBqb2Iuc3RhdHVzKVxuICAgICYmIEJBQ0tHUk9VTkRfSk9CX05VTExBQkxFX05VTUJFUl9GSUVMRFMuZXZlcnkoKGZpZWxkKSA9PiBpc051bGxhYmxlQmFja2dyb3VuZEpvYk51bWJlcihqb2JbZmllbGRdKSlcbiAgICAmJiBCQUNLR1JPVU5EX0pPQl9OVUxMQUJMRV9TVFJJTkdfRklFTERTLmV2ZXJ5KChmaWVsZCkgPT4gaXNOdWxsYWJsZUJhY2tncm91bmRKb2JTdHJpbmcoam9iW2ZpZWxkXSkpXG59XG5cbi8qKlxuICogRGVzY3JpYmVzIGFuIHVuZXhwZWN0ZWQgcHJvdG9jb2wgcmVzcG9uc2Ugd2l0aG91dCBlY2hvaW5nIGl0cyBwYXlsb2FkLlxuICogQHBhcmFtIHtzdHJpbmd9IG9wZXJhdGlvbiAtIFB1YmxpYyBvcGVyYXRpb24gbmFtZS5cbiAqIEBwYXJhbSB7aW1wb3J0KFwiLi90eXBlcy5qc1wiKS5CYWNrZ3JvdW5kSm9iU29ja2V0TWVzc2FnZX0gbWVzc2FnZSAtIFJlc3BvbnNlLlxuICogQHJldHVybnMge0Vycm9yfSAtIFByb3RvY29sIGVycm9yLlxuICovXG5mdW5jdGlvbiB1bmV4cGVjdGVkUmVzcG9uc2VFcnJvcihvcGVyYXRpb24sIG1lc3NhZ2UpIHtcbiAgY29uc3QgcmVzcG9uc2VUeXBlID0gbWVzc2FnZSAmJiB0eXBlb2YgbWVzc2FnZS50eXBlID09PSBcInN0cmluZ1wiID8gbWVzc2FnZS50eXBlIDogXCJtaXNzaW5nIHR5cGVcIlxuXG4gIHJldHVybiBuZXcgRXJyb3IoYFVuZXhwZWN0ZWQgJHtvcGVyYXRpb259IHJlc3BvbnNlOiAke3Jlc3BvbnNlVHlwZX1gKVxufVxuXG5leHBvcnQgZGVmYXVsdCBjbGFzcyBCYWNrZ3JvdW5kSm9ic0NsaWVudCB7XG4gIC8qKlxuICAgKiBSdW5zIGNvbnN0cnVjdG9yLlxuICAgKiBAcGFyYW0ge29iamVjdH0gW2FyZ3NdIC0gT3B0aW9ucy5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9jb25maWd1cmF0aW9uLmpzXCIpLmRlZmF1bHR9IFthcmdzLmNvbmZpZ3VyYXRpb25dIC0gQ29uZmlndXJhdGlvbi5cbiAgICogQHBhcmFtIHtudW1iZXJ9IFthcmdzLmVucXVldWVUaW1lb3V0TXNdIC0gTWF4aW11bSB0aW1lIHRvIHdhaXQgZm9yIGFuIGVucXVldWUgYWNrbm93bGVkZ2VtZW50IGluIG1pbGxpc2Vjb25kcyAoZGVmYXVsdDogNTAwMCkuXG4gICAqIEBwYXJhbSB7bnVtYmVyfSBbYXJncy5nZW5lcmF0aW9uSGFuZHNoYWtlVGltZW91dE1zXSAtIE1heGltdW0gdGltZSB0byB3YWl0IGZvciBnZW5lcmF0aW9uIGFja25vd2xlZGdlbWVudCAoZGVmYXVsdDogNDAwMCkuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBbYXJncy5nZW5lcmF0aW9uSWRdIC0gRXhwbGljaXQgcmVsZWFzZSBnZW5lcmF0aW9uIGlkZW50aXR5LlxuICAgKi9cbiAgY29uc3RydWN0b3Ioe2NvbmZpZ3VyYXRpb24sIGVucXVldWVUaW1lb3V0TXMgPSBERUZBVUxUX0VOUVVFVUVfVElNRU9VVF9NUywgZ2VuZXJhdGlvbkhhbmRzaGFrZVRpbWVvdXRNcyA9IERFRkFVTFRfR0VORVJBVElPTl9IQU5EU0hBS0VfVElNRU9VVF9NUywgZ2VuZXJhdGlvbklkfSA9IHt9KSB7XG4gICAgdGhpcy5jb25maWd1cmF0aW9uUHJvbWlzZSA9IGNvbmZpZ3VyYXRpb24gPyBQcm9taXNlLnJlc29sdmUoY29uZmlndXJhdGlvbikgOiBjb25maWd1cmF0aW9uUmVzb2x2ZXIoKVxuICAgIHRoaXMuZW5xdWV1ZVRpbWVvdXRNcyA9IGVucXVldWVUaW1lb3V0TXNcbiAgICB0aGlzLmdlbmVyYXRpb25IYW5kc2hha2VUaW1lb3V0TXMgPSB2YWxpZGF0ZUdlbmVyYXRpb25IYW5kc2hha2VUaW1lb3V0TXMoZ2VuZXJhdGlvbkhhbmRzaGFrZVRpbWVvdXRNcylcbiAgICB0aGlzLmV4cGxpY2l0R2VuZXJhdGlvbklkID0gZ2VuZXJhdGlvbklkXG4gIH1cblxuICAvKipcbiAgICogQnVpbGRzIGEgb25lLXNob3QgY2xpZW50IHNvY2tldCByZXF1ZXN0IGZyb20gdGhlIHJlc29sdmVkIGNvbmZpZ3VyYXRpb24uXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPEJhY2tncm91bmRKb2JzU29ja2V0UmVxdWVzdD59IC0gU29ja2V0IHJlcXVlc3QuXG4gICAqL1xuICBhc3luYyBfcmVxdWVzdCgpIHtcbiAgICBjb25zdCBjb25maWd1cmF0aW9uID0gYXdhaXQgdGhpcy5jb25maWd1cmF0aW9uUHJvbWlzZVxuICAgIGNvbnN0IHtob3N0LCBwb3J0fSA9IGNvbmZpZ3VyYXRpb24uZ2V0QmFja2dyb3VuZEpvYnNDb25maWcoKVxuICAgIGNvbnN0IHtnZW5lcmF0aW9uSWR9ID0gY29uZmlndXJhdGlvbi5yZXNvbHZlQmFja2dyb3VuZEpvYnNHZW5lcmF0aW9uQ29uZmlnKHtcbiAgICAgIGdlbmVyYXRpb25JZDogdGhpcy5leHBsaWNpdEdlbmVyYXRpb25JZCxcbiAgICAgIHNvdXJjZU5hbWU6IFwiQmFja2dyb3VuZEpvYnNDbGllbnRcIlxuICAgIH0pXG5cbiAgICByZXR1cm4gbmV3IEJhY2tncm91bmRKb2JzU29ja2V0UmVxdWVzdCh7aG9zdCwgcG9ydCwgcm9sZTogXCJjbGllbnRcIiwgZ2VuZXJhdGlvbkhhbmRzaGFrZVRpbWVvdXRNczogdGhpcy5nZW5lcmF0aW9uSGFuZHNoYWtlVGltZW91dE1zLCBnZW5lcmF0aW9uSWR9KVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZW5xdWV1ZS5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBPcHRpb25zLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gYXJncy5qb2JOYW1lIC0gSm9iIG5hbWUuXG4gICAqIEBwYXJhbSB7QXJyYXk8UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSBhcmdzLmFyZ3MgLSBKb2IgYXJncy5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL3R5cGVzLmpzXCIpLkJhY2tncm91bmRKb2JPcHRpb25zfSBbYXJncy5vcHRpb25zXSAtIEpvYiBvcHRpb25zLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gW2FyZ3MucHJvZHVjZXJJbnZvY2F0aW9uSWRdIC0gU3RhYmxlIGlkZW50aXR5IGZvciBvbmUgb3duZWQgZW5xdWV1ZSBpbnZvY2F0aW9uLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vdHlwZXMuanNcIikuQmFja2dyb3VuZEpvYlByb2R1Y2VyUHJvb2Z9IFthcmdzLnByb2R1Y2VyUHJvb2ZdIC0gRXhhY3QgaW50ZXJuYWwgcHJvZHVjZXIgaGFuZG9mZi5cbiAgICogQHJldHVybnMge1Byb21pc2U8c3RyaW5nPn0gLSBKb2IgaWQuXG4gICAqL1xuICBhc3luYyBlbnF1ZXVlKHtqb2JOYW1lLCBhcmdzLCBvcHRpb25zLCBwcm9kdWNlckludm9jYXRpb25JZCwgcHJvZHVjZXJQcm9vZn0pIHtcbiAgICBjb25zdCBtZXNzYWdlID0ge1xuICAgICAgdHlwZTogLyoqIEB0eXBlIHtjb25zdH0gKi8gKFwiZW5xdWV1ZVwiKSxcbiAgICAgIGpvYk5hbWUsXG4gICAgICBhcmdzLFxuICAgICAgb3B0aW9ucyxcbiAgICAgIC4uLihwcm9kdWNlckludm9jYXRpb25JZCA/IHtwcm9kdWNlckludm9jYXRpb25JZH0gOiB7fSksXG4gICAgICAuLi4ocHJvZHVjZXJQcm9vZiA/IHtwcm9kdWNlclByb29mfSA6IHt9KVxuICAgIH1cbiAgICAvKipcbiAgICAgKiBDcmVhdGVzIHNhZmUgb2JzZXJ2YXRpb25zIGZvciBvbmUgYXR0ZW1wdCB3aXRob3V0IHJldGFpbmluZyByZXF1ZXN0IGRhdGEuXG4gICAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBBdHRlbXB0IGlkZW50aXR5LlxuICAgICAqIEBwYXJhbSB7XCJpbml0aWFsXCIgfCBcIm93bmVkX3JlcGxheVwifSBhcmdzLmF0dGVtcHRLaW5kIC0gSW5pdGlhbCBhdHRlbXB0IG9yIG93bmVkIHJlcGxheS5cbiAgICAgKiBAcGFyYW0ge251bWJlcn0gYXJncy5hdHRlbXB0TnVtYmVyIC0gT25lLWJhc2VkIGF0dGVtcHQgbnVtYmVyLlxuICAgICAqIEByZXR1cm5zIHtpbXBvcnQoXCIuL2VucXVldWUtYWNrbm93bGVkZ2VtZW50LXRpbWVvdXQtZXJyb3IuanNcIikuQmFja2dyb3VuZEpvYkVucXVldWVBdHRlbXB0fSAtIE11dGFibGUgYXR0ZW1wdCBvYnNlcnZhdGlvbnMuXG4gICAgICovXG4gICAgY29uc3QgbmV3QXR0ZW1wdE9ic2VydmF0aW9uID0gKHthdHRlbXB0S2luZCwgYXR0ZW1wdE51bWJlcn0pID0+ICh7XG4gICAgICBhY2tub3dsZWRnZW1lbnRXYWl0RWxhcHNlZE1zOiAwLFxuICAgICAgYXR0ZW1wdEVsYXBzZWRNczogMCxcbiAgICAgIGF0dGVtcHRLaW5kLFxuICAgICAgYXR0ZW1wdE51bWJlcixcbiAgICAgIGV4cGxpY2l0bHlSZWplY3RlZDogZmFsc2UsXG4gICAgICBnZW5lcmF0aW9uRmVuY2VkOiBmYWxzZSxcbiAgICAgIHJlcXVlc3RTZW50OiBmYWxzZVxuICAgIH0pXG4gICAgLyoqXG4gICAgICogU2VuZHMgb25lIGVucXVldWUgYXR0ZW1wdC4gQW4gb3duZWQgY2FsbGVyIG1heSByZXBsYXkgdGhpcyBleGFjdCBtZXNzYWdlXG4gICAgICogb25jZSB3aGVuIHRyYW5zcG9ydCBhY2tub3dsZWRnZW1lbnQgcmVtYWlucyBhbWJpZ3VvdXMgYWZ0ZXIgc2VuZC5cbiAgICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vZW5xdWV1ZS1hY2tub3dsZWRnZW1lbnQtdGltZW91dC1lcnJvci5qc1wiKS5CYWNrZ3JvdW5kSm9iRW5xdWV1ZUF0dGVtcHR9IGF0dGVtcHRPYnNlcnZhdGlvbiAtIE11dGFibGUgYXR0ZW1wdCBvYnNlcnZhdGlvbnMuXG4gICAgICogQHBhcmFtIHtSZWFkb25seTxBcnJheTxpbXBvcnQoXCIuL2VucXVldWUtYWNrbm93bGVkZ2VtZW50LXRpbWVvdXQtZXJyb3IuanNcIikuQmFja2dyb3VuZEpvYkVucXVldWVBdHRlbXB0Pj59IHByZXZpb3VzQXR0ZW1wdHMgLSBFYXJsaWVyIHRpbWVkLW91dCBhdHRlbXB0cy5cbiAgICAgKiBAcmV0dXJucyB7UHJvbWlzZTxzdHJpbmc+fSAtIEpvYiBpZC5cbiAgICAgKi9cbiAgICBjb25zdCBlbnF1ZXVlQXR0ZW1wdCA9IGFzeW5jIChhdHRlbXB0T2JzZXJ2YXRpb24sIHByZXZpb3VzQXR0ZW1wdHMpID0+IHtcbiAgICAgIGNvbnN0IGF0dGVtcHRTdGFydGVkQXRNcyA9IERhdGUubm93KClcbiAgICAgIGNvbnN0IHJlcXVlc3QgPSBhd2FpdCB0aGlzLl9yZXF1ZXN0KClcbiAgICAgIGNvbnN0IHJlcXVlc3RBYm9ydENvbnRyb2xsZXIgPSBuZXcgQWJvcnRDb250cm9sbGVyKClcbiAgICAgIGNvbnN0IHRpbWVvdXRFcnJvck1lc3NhZ2UgPSBgQmFja2dyb3VuZCBqb2IgZW5xdWV1ZSBhY2tub3dsZWRnZW1lbnQgdGltZWQgb3V0IGFmdGVyICR7dGhpcy5lbnF1ZXVlVGltZW91dE1zfW1zYFxuICAgICAgLyoqIEB0eXBlIHtudW1iZXIgfCB1bmRlZmluZWR9ICovXG4gICAgICBsZXQgcmVxdWVzdFNlbnRBdE1zXG4gICAgICAvKipcbiAgICAgICAqIFJlc29sdmVzIHRoZSBwcmUtc2VuZCBwaGFzZSB3aGVuIHRoZSBtdXRhdGlvbiBoYXMgZW50ZXJlZCB0aGUgc29ja2V0LlxuICAgICAgICogQHR5cGUgeygpID0+IHZvaWR9XG4gICAgICAgKi9cbiAgICAgIGxldCBtYXJrUmVxdWVzdFNlbnQgPSAoKSA9PiB7fVxuICAgICAgY29uc3QgcmVxdWVzdFNlbnQgPSBuZXcgUHJvbWlzZSgocmVzb2x2ZSkgPT4ge1xuICAgICAgICBtYXJrUmVxdWVzdFNlbnQgPSAoKSA9PiByZXNvbHZlKHVuZGVmaW5lZClcbiAgICAgIH0pXG4gICAgICAvKipcbiAgICAgICAqIEFwcGxpZXMgdGhlIGNvbmZpZ3VyZWQgZGVhZGxpbmUgaW5kZXBlbmRlbnRseSB0byBvbmUgcmVxdWVzdCBwaGFzZS5cbiAgICAgICAqIEB0ZW1wbGF0ZSBUXG4gICAgICAgKiBAcGFyYW0geygpID0+IFByb21pc2U8VD59IGNhbGxiYWNrIC0gUGhhc2Ugd29yay5cbiAgICAgICAqIEByZXR1cm5zIHtQcm9taXNlPFQ+fSAtIFBoYXNlIHJlc3VsdC5cbiAgICAgICAqL1xuICAgICAgY29uc3Qgd2l0aEVucXVldWVUaW1lb3V0ID0gYXN5bmMgKGNhbGxiYWNrKSA9PiBhd2FpdCB0aW1lb3V0KHtcbiAgICAgICAgZXJyb3JNZXNzYWdlOiB0aW1lb3V0RXJyb3JNZXNzYWdlLFxuICAgICAgICB0aW1lb3V0OiB0aGlzLmVucXVldWVUaW1lb3V0TXNcbiAgICAgIH0sIGFzeW5jICh7Y29udHJvbH0pID0+IHtcbiAgICAgICAgY29uc3QgYWJvcnRSZXF1ZXN0ID0gKCkgPT4gcmVxdWVzdEFib3J0Q29udHJvbGxlci5hYm9ydChjb250cm9sLnNpZ25hbC5yZWFzb24pXG5cbiAgICAgICAgY29udHJvbC5zaWduYWwuYWRkRXZlbnRMaXN0ZW5lcihcImFib3J0XCIsIGFib3J0UmVxdWVzdClcbiAgICAgICAgdHJ5IHtcbiAgICAgICAgICByZXR1cm4gYXdhaXQgY2FsbGJhY2soKVxuICAgICAgICB9IGZpbmFsbHkge1xuICAgICAgICAgIGNvbnRyb2wuc2lnbmFsLnJlbW92ZUV2ZW50TGlzdGVuZXIoXCJhYm9ydFwiLCBhYm9ydFJlcXVlc3QpXG4gICAgICAgIH1cbiAgICAgIH0pXG4gICAgICBjb25zdCByZXF1ZXN0UHJvbWlzZSA9IHJlcXVlc3QucnVuKHtcbiAgICAgICAgc2lnbmFsOiByZXF1ZXN0QWJvcnRDb250cm9sbGVyLnNpZ25hbCxcbiAgICAgICAgb25Db25uZWN0OiAoanNvblNvY2tldCkgPT4ge1xuICAgICAgICAgIGpzb25Tb2NrZXQuc2VuZChtZXNzYWdlKVxuICAgICAgICAgIGF0dGVtcHRPYnNlcnZhdGlvbi5nZW5lcmF0aW9uRmVuY2VkID0gQm9vbGVhbihyZXF1ZXN0LmdlbmVyYXRpb25JZClcbiAgICAgICAgICBhdHRlbXB0T2JzZXJ2YXRpb24ucmVxdWVzdFNlbnQgPSB0cnVlXG4gICAgICAgICAgcmVxdWVzdFNlbnRBdE1zID0gRGF0ZS5ub3coKVxuICAgICAgICAgIG1hcmtSZXF1ZXN0U2VudCgpXG4gICAgICAgIH0sXG4gICAgICAgIG9uTWVzc2FnZTogKHttZXNzYWdlLCByZXNvbHZlLCByZWplY3R9KSA9PiB7XG4gICAgICAgICAgaWYgKG1lc3NhZ2U/LnR5cGUgPT09IFwiZW5xdWV1ZWRcIikge1xuICAgICAgICAgICAgcmVzb2x2ZShtZXNzYWdlLmpvYklkKVxuICAgICAgICAgICAgcmV0dXJuXG4gICAgICAgICAgfVxuXG4gICAgICAgICAgaWYgKG1lc3NhZ2U/LnR5cGUgPT09IFwiZW5xdWV1ZS1lcnJvclwiKSB7XG4gICAgICAgICAgICBhdHRlbXB0T2JzZXJ2YXRpb24uZXhwbGljaXRseVJlamVjdGVkID0gdHJ1ZVxuICAgICAgICAgICAgcmVqZWN0KG5ldyBFcnJvcihtZXNzYWdlLmVycm9yIHx8IFwiRmFpbGVkIHRvIGVucXVldWUgam9iXCIpKVxuICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgICAgfSlcblxuICAgICAgYXdhaXQgd2l0aEVucXVldWVUaW1lb3V0KGFzeW5jICgpID0+IGF3YWl0IFByb21pc2UucmFjZShbcmVxdWVzdFNlbnQsIHJlcXVlc3RQcm9taXNlXSkpXG5cbiAgICAgIHRyeSB7XG4gICAgICAgIHJldHVybiBhd2FpdCB3aXRoRW5xdWV1ZVRpbWVvdXQoYXN5bmMgKCkgPT4gYXdhaXQgcmVxdWVzdFByb21pc2UpXG4gICAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgICBpZiAoIShlcnJvciBpbnN0YW5jZW9mIFRpbWVvdXRFcnJvcikpIHRocm93IGVycm9yXG4gICAgICAgIGlmIChyZXF1ZXN0U2VudEF0TXMgPT09IHVuZGVmaW5lZCkgdGhyb3cgbmV3IEVycm9yKFwiQmFja2dyb3VuZCBqb2IgZW5xdWV1ZSBhY2tub3dsZWRnZW1lbnQgd2FpdCBzdGFydGVkIGJlZm9yZSB0aGUgcmVxdWVzdCB3YXMgc2VudFwiLCB7Y2F1c2U6IGVycm9yfSlcblxuICAgICAgICBjb25zdCB0aW1lZE91dEF0TXMgPSBEYXRlLm5vdygpXG4gICAgICAgIC8vIFRoZSBmaXJlZCB0aW1lciBwcm92ZXMgaXRzIGxvZ2ljYWwgZGVhZGxpbmUgZXZlbiB3aGVuIHRoZSBhZGp1c3RhYmxlIHdhbGwgY2xvY2sgcmVwb3J0cyBhIHNob3J0ZXIgaW50ZXJ2YWwuXG4gICAgICAgIGNvbnN0IGFja25vd2xlZGdlbWVudFdhaXRFbGFwc2VkTXMgPSBNYXRoLm1heCh0aGlzLmVucXVldWVUaW1lb3V0TXMsIHRpbWVkT3V0QXRNcyAtIHJlcXVlc3RTZW50QXRNcylcblxuICAgICAgICBhdHRlbXB0T2JzZXJ2YXRpb24uYWNrbm93bGVkZ2VtZW50V2FpdEVsYXBzZWRNcyA9IGFja25vd2xlZGdlbWVudFdhaXRFbGFwc2VkTXNcbiAgICAgICAgYXR0ZW1wdE9ic2VydmF0aW9uLmF0dGVtcHRFbGFwc2VkTXMgPSBNYXRoLm1heChhY2tub3dsZWRnZW1lbnRXYWl0RWxhcHNlZE1zLCB0aW1lZE91dEF0TXMgLSBhdHRlbXB0U3RhcnRlZEF0TXMpXG5cbiAgICAgICAgdGhyb3cgbmV3IEJhY2tncm91bmRKb2JFbnF1ZXVlQWNrbm93bGVkZ2VtZW50VGltZW91dEVycm9yKHtcbiAgICAgICAgICBhY2tub3dsZWRnZW1lbnRUaW1lb3V0TXM6IHRoaXMuZW5xdWV1ZVRpbWVvdXRNcyxcbiAgICAgICAgICBhdHRlbXB0SGlzdG9yeTogWy4uLnByZXZpb3VzQXR0ZW1wdHMsIGF0dGVtcHRPYnNlcnZhdGlvbl0sXG4gICAgICAgICAgY2F1c2U6IGVycm9yLFxuICAgICAgICAgIGdlbmVyYXRpb25JZDogcmVxdWVzdC5nZW5lcmF0aW9uSWQsXG4gICAgICAgICAgam9iTmFtZSxcbiAgICAgICAgICBwcm9kdWNlckludm9jYXRpb25JZCxcbiAgICAgICAgICBwcm9kdWNlclByb29mUHJlc2VudDogQm9vbGVhbihwcm9kdWNlclByb29mKVxuICAgICAgICB9KVxuICAgICAgfVxuICAgIH1cblxuICAgIGNvbnN0IGluaXRpYWxBdHRlbXB0ID0gbmV3QXR0ZW1wdE9ic2VydmF0aW9uKHthdHRlbXB0S2luZDogXCJpbml0aWFsXCIsIGF0dGVtcHROdW1iZXI6IDF9KVxuXG4gICAgdHJ5IHtcbiAgICAgIHJldHVybiBhd2FpdCBlbnF1ZXVlQXR0ZW1wdChpbml0aWFsQXR0ZW1wdCwgW10pXG4gICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgIGlmICghcHJvZHVjZXJJbnZvY2F0aW9uSWQgfHwgIXByb2R1Y2VyUHJvb2YgfHwgIWluaXRpYWxBdHRlbXB0LmdlbmVyYXRpb25GZW5jZWQgfHwgIWluaXRpYWxBdHRlbXB0LnJlcXVlc3RTZW50IHx8IGluaXRpYWxBdHRlbXB0LmV4cGxpY2l0bHlSZWplY3RlZCkgdGhyb3cgZXJyb3JcblxuICAgICAgY29uc3QgcHJldmlvdXNBdHRlbXB0cyA9IGVycm9yIGluc3RhbmNlb2YgQmFja2dyb3VuZEpvYkVucXVldWVBY2tub3dsZWRnZW1lbnRUaW1lb3V0RXJyb3IgPyBlcnJvci5hdHRlbXB0SGlzdG9yeSA6IFtdXG4gICAgICBjb25zdCByZXBsYXlBdHRlbXB0ID0gbmV3QXR0ZW1wdE9ic2VydmF0aW9uKHthdHRlbXB0S2luZDogXCJvd25lZF9yZXBsYXlcIiwgYXR0ZW1wdE51bWJlcjogMn0pXG5cbiAgICAgIHJldHVybiBhd2FpdCBlbnF1ZXVlQXR0ZW1wdChyZXBsYXlBdHRlbXB0LCBwcmV2aW91c0F0dGVtcHRzKVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBBdG9taWNhbGx5IHJlcGxhY2VzIHRoZSBxdWV1ZWQgb3duZXIgb2YgYSBzdGFibGUgc2NoZWR1bGUga2V5LlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIE9wdGlvbnMuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBhcmdzLnNjaGVkdWxlS2V5IC0gU3RhYmxlIGxvZ2ljYWwgc2NoZWR1bGUga2V5LlxuICAgKiBAcGFyYW0ge3N0cmluZ30gYXJncy5qb2JOYW1lIC0gSm9iIG5hbWUuXG4gICAqIEBwYXJhbSB7QXJyYXk8UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSBhcmdzLmFyZ3MgLSBKb2IgYXJncy5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL3R5cGVzLmpzXCIpLkJhY2tncm91bmRKb2JPcHRpb25zfSBbYXJncy5vcHRpb25zXSAtIEpvYiBvcHRpb25zLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxpbXBvcnQoXCIuL3R5cGVzLmpzXCIpLkJhY2tncm91bmRKb2JSZXBsYWNlbWVudFJlc3VsdD59IC0gUmVwbGFjZW1lbnQgcmVzdWx0LlxuICAgKi9cbiAgYXN5bmMgcmVwbGFjZVNjaGVkdWxlZCh7c2NoZWR1bGVLZXksIGpvYk5hbWUsIGFyZ3MsIG9wdGlvbnN9KSB7XG4gICAgY29uc3QgcmVxdWVzdCA9IGF3YWl0IHRoaXMuX3JlcXVlc3QoKVxuXG4gICAgcmV0dXJuIGF3YWl0IHJlcXVlc3QucnVuKHtcbiAgICAgIG9uQ29ubmVjdDogKGpzb25Tb2NrZXQpID0+IHtcbiAgICAgICAganNvblNvY2tldC5zZW5kKHt0eXBlOiBcInJlcGxhY2Utc2NoZWR1bGVkXCIsIHNjaGVkdWxlS2V5LCBqb2JOYW1lLCBhcmdzLCBvcHRpb25zfSlcbiAgICAgIH0sXG4gICAgICBvbk1lc3NhZ2U6ICh7bWVzc2FnZSwgcmVzb2x2ZSwgcmVqZWN0fSkgPT4ge1xuICAgICAgICBpZiAobWVzc2FnZT8udHlwZSA9PT0gXCJzY2hlZHVsZS1yZXBsYWNlZFwiKSB7XG4gICAgICAgICAgcmVzb2x2ZSh7XG4gICAgICAgICAgICBqb2JJZDogbWVzc2FnZS5qb2JJZCxcbiAgICAgICAgICAgIHByZXZpb3VzSm9iSWQ6IG1lc3NhZ2UucHJldmlvdXNKb2JJZCxcbiAgICAgICAgICAgIHByZXZpb3VzU3RhdHVzOiBtZXNzYWdlLnByZXZpb3VzU3RhdHVzXG4gICAgICAgICAgfSlcbiAgICAgICAgICByZXR1cm5cbiAgICAgICAgfVxuXG4gICAgICAgIGlmIChtZXNzYWdlPy50eXBlID09PSBcInJlcGxhY2Utc2NoZWR1bGVkLWVycm9yXCIpIHtcbiAgICAgICAgICByZWplY3QobmV3IEVycm9yKG1lc3NhZ2UuZXJyb3IgfHwgXCJGYWlsZWQgdG8gcmVwbGFjZSBzY2hlZHVsZWQgam9iXCIpKVxuICAgICAgICB9XG4gICAgICB9XG4gICAgfSlcbiAgfVxuXG4gIC8qKlxuICAgKiBDYW5jZWxzIG9yIGRldGFjaGVzIHRoZSBjdXJyZW50IG93bmVyIG9mIGEgc3RhYmxlIHNjaGVkdWxlIGtleS5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBPcHRpb25zLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gYXJncy5zY2hlZHVsZUtleSAtIFN0YWJsZSBsb2dpY2FsIHNjaGVkdWxlIGtleS5cbiAgICogQHJldHVybnMge1Byb21pc2U8aW1wb3J0KFwiLi90eXBlcy5qc1wiKS5CYWNrZ3JvdW5kSm9iQ2FuY2VsbGF0aW9uUmVzdWx0Pn0gLSBDYW5jZWxsYXRpb24gcmVzdWx0LlxuICAgKi9cbiAgYXN5bmMgY2FuY2VsU2NoZWR1bGVkKHtzY2hlZHVsZUtleX0pIHtcbiAgICBjb25zdCByZXF1ZXN0ID0gYXdhaXQgdGhpcy5fcmVxdWVzdCgpXG5cbiAgICByZXR1cm4gYXdhaXQgcmVxdWVzdC5ydW4oe1xuICAgICAgb25Db25uZWN0OiAoanNvblNvY2tldCkgPT4ge1xuICAgICAgICBqc29uU29ja2V0LnNlbmQoe3R5cGU6IFwiY2FuY2VsLXNjaGVkdWxlZFwiLCBzY2hlZHVsZUtleX0pXG4gICAgICB9LFxuICAgICAgb25NZXNzYWdlOiAoe21lc3NhZ2UsIHJlc29sdmUsIHJlamVjdH0pID0+IHtcbiAgICAgICAgaWYgKG1lc3NhZ2U/LnR5cGUgPT09IFwic2NoZWR1bGUtY2FuY2VsbGVkXCIpIHtcbiAgICAgICAgICByZXNvbHZlKHtqb2JJZDogbWVzc2FnZS5qb2JJZCwgb3V0Y29tZTogbWVzc2FnZS5vdXRjb21lfSlcbiAgICAgICAgICByZXR1cm5cbiAgICAgICAgfVxuXG4gICAgICAgIGlmIChtZXNzYWdlPy50eXBlID09PSBcImNhbmNlbC1zY2hlZHVsZWQtZXJyb3JcIikge1xuICAgICAgICAgIHJlamVjdChuZXcgRXJyb3IobWVzc2FnZS5lcnJvciB8fCBcIkZhaWxlZCB0byBjYW5jZWwgc2NoZWR1bGVkIGpvYlwiKSlcbiAgICAgICAgfVxuICAgICAgfVxuICAgIH0pXG4gIH1cblxuICAvKipcbiAgICogUmVhZHMgY3VycmVudCBzdGFibGUgb3duZXJzaGlwIGFuZCBvcHRpb25hbCB0ZXJtaW5hbCBoaXN0b3J5LlxuICAgKiBAcGFyYW0ge3tzY2hlZHVsZUtleTogc3RyaW5nLCBpbmNsdWRlTGF0ZXN0VGVybWluYWw/OiBib29sZWFufX0gYXJncyAtIExvb2t1cCByZXF1ZXN0LlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxpbXBvcnQoXCIuL3R5cGVzLmpzXCIpLkJhY2tncm91bmRKb2JTY2hlZHVsZWRMb29rdXBSZXN1bHQ+fSAtIE5vcm1hbGl6ZWQgc3RhYmxlIHNjaGVkdWxlIGpvYnMuXG4gICAqL1xuICBhc3luYyBnZXRTY2hlZHVsZWRKb2Ioe3NjaGVkdWxlS2V5LCBpbmNsdWRlTGF0ZXN0VGVybWluYWx9KSB7XG4gICAgY29uc3QgcmVxdWVzdCA9IGF3YWl0IHRoaXMuX3JlcXVlc3QoKVxuXG4gICAgcmV0dXJuIGF3YWl0IHJlcXVlc3QucnVuKHtcbiAgICAgIG9uQ29ubmVjdDogKGpzb25Tb2NrZXQpID0+IHtcbiAgICAgICAganNvblNvY2tldC5zZW5kKHt0eXBlOiBcImdldC1zY2hlZHVsZWQtam9iXCIsIHNjaGVkdWxlS2V5LCBpbmNsdWRlTGF0ZXN0VGVybWluYWx9KVxuICAgICAgfSxcbiAgICAgIG9uTWVzc2FnZTogKHttZXNzYWdlLCByZXNvbHZlLCByZWplY3R9KSA9PiB7XG4gICAgICAgIGlmIChtZXNzYWdlPy50eXBlID09PSBcInNjaGVkdWxlZC1qb2JcIikge1xuICAgICAgICAgIGNvbnN0IHtjdXJyZW50Sm9iLCBsYXRlc3RUZXJtaW5hbEpvYn0gPSBtZXNzYWdlXG4gICAgICAgICAgY29uc3QgY3VycmVudEpvYlZhbGlkID0gY3VycmVudEpvYiA9PT0gbnVsbFxuICAgICAgICAgICAgfHwgKGlzTm9ybWFsaXplZEJhY2tncm91bmRKb2IoY3VycmVudEpvYikgJiYgQkFDS0dST1VORF9KT0JfQUNUSVZFX1NUQVRVU0VTLnNvbWUoKHN0YXR1cykgPT4gc3RhdHVzID09PSBjdXJyZW50Sm9iLnN0YXR1cykpXG4gICAgICAgICAgY29uc3QgbGF0ZXN0VGVybWluYWxKb2JWYWxpZCA9IGxhdGVzdFRlcm1pbmFsSm9iID09PSBudWxsXG4gICAgICAgICAgICB8fCAoaXNOb3JtYWxpemVkQmFja2dyb3VuZEpvYihsYXRlc3RUZXJtaW5hbEpvYikgJiYgQkFDS0dST1VORF9KT0JfVEVSTUlOQUxfU1RBVFVTRVMuc29tZSgoc3RhdHVzKSA9PiBzdGF0dXMgPT09IGxhdGVzdFRlcm1pbmFsSm9iLnN0YXR1cykpXG5cbiAgICAgICAgICBpZiAoIWN1cnJlbnRKb2JWYWxpZCB8fCAhbGF0ZXN0VGVybWluYWxKb2JWYWxpZCkge1xuICAgICAgICAgICAgcmVqZWN0KG5ldyBFcnJvcihcIkludmFsaWQgZ2V0U2NoZWR1bGVkSm9iIHJlc3BvbnNlOiBleHBlY3RlZCBub3JtYWxpemVkIHB1YmxpYyBqb2IgdmFsdWVzXCIpKVxuICAgICAgICAgICAgcmV0dXJuXG4gICAgICAgICAgfVxuXG4gICAgICAgICAgcmVzb2x2ZSh7Y3VycmVudEpvYiwgbGF0ZXN0VGVybWluYWxKb2J9KVxuICAgICAgICAgIHJldHVyblxuICAgICAgICB9XG5cbiAgICAgICAgaWYgKG1lc3NhZ2U/LnR5cGUgPT09IFwiZ2V0LXNjaGVkdWxlZC1qb2ItZXJyb3JcIikge1xuICAgICAgICAgIHJlamVjdChuZXcgRXJyb3IobWVzc2FnZS5lcnJvciB8fCBcIkZhaWxlZCB0byByZWFkIHNjaGVkdWxlZCBqb2JcIikpXG4gICAgICAgICAgcmV0dXJuXG4gICAgICAgIH1cblxuICAgICAgICByZWplY3QodW5leHBlY3RlZFJlc3BvbnNlRXJyb3IoXCJnZXRTY2hlZHVsZWRKb2JcIiwgbWVzc2FnZSkpXG4gICAgICB9XG4gICAgfSlcbiAgfVxuXG4gIC8qKlxuICAgKiBFeHBlZGl0ZXMgYSBmdXR1cmUgcXVldWVkIHN0YWJsZSBvd25lciB3aXRob3V0IGNoYW5naW5nIGpvYiBpZGVudGl0eS5cbiAgICogQHBhcmFtIHt7c2NoZWR1bGVLZXk6IHN0cmluZ319IGFyZ3MgLSBXYWtlIHJlcXVlc3QuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPGltcG9ydChcIi4vdHlwZXMuanNcIikuQmFja2dyb3VuZEpvYldha2VSZXN1bHQ+fSAtIFdha2UgcmVzdWx0LlxuICAgKi9cbiAgYXN5bmMgd2FrZVNjaGVkdWxlZCh7c2NoZWR1bGVLZXl9KSB7XG4gICAgY29uc3QgcmVxdWVzdCA9IGF3YWl0IHRoaXMuX3JlcXVlc3QoKVxuXG4gICAgcmV0dXJuIGF3YWl0IHJlcXVlc3QucnVuKHtcbiAgICAgIG9uQ29ubmVjdDogKGpzb25Tb2NrZXQpID0+IHtcbiAgICAgICAganNvblNvY2tldC5zZW5kKHt0eXBlOiBcIndha2Utc2NoZWR1bGVkXCIsIHNjaGVkdWxlS2V5fSlcbiAgICAgIH0sXG4gICAgICBvbk1lc3NhZ2U6ICh7bWVzc2FnZSwgcmVzb2x2ZSwgcmVqZWN0fSkgPT4ge1xuICAgICAgICBpZiAobWVzc2FnZT8udHlwZSA9PT0gXCJzY2hlZHVsZS13b2tlblwiKSB7XG4gICAgICAgICAgY29uc3Qgb3V0Y29tZSA9IG1lc3NhZ2Uub3V0Y29tZVxuICAgICAgICAgIGNvbnN0IGtub3duT3V0Y29tZSA9IEJBQ0tHUk9VTkRfSk9CX1dBS0VfT1VUQ09NRVMuaW5jbHVkZXMob3V0Y29tZSlcbiAgICAgICAgICBjb25zdCB2YWxpZEpvYklkID0gb3V0Y29tZSA9PT0gXCJub3RfZm91bmRcIiA/IG1lc3NhZ2Uuam9iSWQgPT09IG51bGwgOiB0eXBlb2YgbWVzc2FnZS5qb2JJZCA9PT0gXCJzdHJpbmdcIiAmJiBtZXNzYWdlLmpvYklkLmxlbmd0aCA+IDBcblxuICAgICAgICAgIGlmICgha25vd25PdXRjb21lIHx8ICF2YWxpZEpvYklkKSB7XG4gICAgICAgICAgICByZWplY3QobmV3IEVycm9yKFwiSW52YWxpZCB3YWtlU2NoZWR1bGVkIHJlc3BvbnNlXCIpKVxuICAgICAgICAgICAgcmV0dXJuXG4gICAgICAgICAgfVxuXG4gICAgICAgICAgcmVzb2x2ZSh7am9iSWQ6IG1lc3NhZ2Uuam9iSWQsIG91dGNvbWV9KVxuICAgICAgICAgIHJldHVyblxuICAgICAgICB9XG5cbiAgICAgICAgaWYgKG1lc3NhZ2U/LnR5cGUgPT09IFwid2FrZS1zY2hlZHVsZWQtZXJyb3JcIikge1xuICAgICAgICAgIHJlamVjdChuZXcgRXJyb3IobWVzc2FnZS5lcnJvciB8fCBcIkZhaWxlZCB0byB3YWtlIHNjaGVkdWxlZCBqb2JcIikpXG4gICAgICAgICAgcmV0dXJuXG4gICAgICAgIH1cblxuICAgICAgICByZWplY3QodW5leHBlY3RlZFJlc3BvbnNlRXJyb3IoXCJ3YWtlU2NoZWR1bGVkXCIsIG1lc3NhZ2UpKVxuICAgICAgfVxuICAgIH0pXG4gIH1cbn1cbiJdfQ==