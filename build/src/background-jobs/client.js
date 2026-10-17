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
const BACKGROUND_JOB_NULLABLE_STRING_FIELDS = ["childInstanceId", "concurrencyKey", "handoffId", "lastError", "runnerHostname", "scheduleKey", "workerId"];
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiY2xpZW50LmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiLi4vLi4vLi4vc3JjL2JhY2tncm91bmQtam9icy9jbGllbnQuanMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6IkFBQUEsWUFBWTtBQUVaLE9BQU8sT0FBTyxFQUFFLEVBQUUsWUFBWSxFQUFFLE1BQU0sMkJBQTJCLENBQUE7QUFDakUsT0FBTyxxQkFBcUIsTUFBTSw4QkFBOEIsQ0FBQTtBQUNoRSxPQUFPLGFBQWEsTUFBTSwwQkFBMEIsQ0FBQTtBQUNwRCxPQUFPLCtDQUErQyxNQUFNLDRDQUE0QyxDQUFBO0FBQ3hHLE9BQU8sMkJBQTJCLE1BQU0scUJBQXFCLENBQUE7QUFDN0QsT0FBTyxFQUFFLHVDQUF1QyxFQUFFLG9DQUFvQyxFQUFFLE1BQU0seUNBQXlDLENBQUE7QUFDdkksT0FBTyxFQUFFLDhCQUE4QixFQUFFLDhCQUE4QixFQUFFLHVCQUF1QixFQUFFLGdDQUFnQyxFQUFFLE1BQU0sb0JBQW9CLENBQUE7QUFFOUosTUFBTSwwQkFBMEIsR0FBRyxJQUFJLENBQUE7QUFDdkMsTUFBTSw0QkFBNEIsR0FBRyxDQUFDLE9BQU8sRUFBRSxhQUFhLEVBQUUsWUFBWSxFQUFFLFdBQVcsQ0FBQyxDQUFBO0FBQ3hGLE1BQU0scUNBQXFDLEdBQUc7SUFDNUMsVUFBVTtJQUNWLFVBQVU7SUFDVixtQkFBbUI7SUFDbkIsa0JBQWtCO0lBQ2xCLGVBQWU7SUFDZixhQUFhO0lBQ2IsWUFBWTtJQUNaLGVBQWU7SUFDZixnQkFBZ0I7SUFDaEIsWUFBWTtJQUNaLGNBQWM7SUFDZCxlQUFlO0lBQ2YsZUFBZTtJQUNmLFdBQVc7Q0FDWixDQUFBO0FBQ0QsTUFBTSxxQ0FBcUMsR0FBRyxDQUFDLGlCQUFpQixFQUFFLGdCQUFnQixFQUFFLFdBQVcsRUFBRSxXQUFXLEVBQUUsZ0JBQWdCLEVBQUUsYUFBYSxFQUFFLFVBQVUsQ0FBQyxDQUFBO0FBRTFKOzs7O0dBSUc7QUFDSCxTQUFTLDZCQUE2QixDQUFDLEtBQUs7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SyxLQUFLLFFBQVEsSUFBSSxPQUFPLENBQUMsS0FBSyxDQUFDLE1BQU0sR0FBRyxDQUFDLENBQUE7b0JBRW5JLElBQUksQ0FBQyxZQUFZLElBQUksQ0FBQyxVQUFVLEVBQUUsQ0FBQzt3QkFDakMsTUFBTSxDQUFDLElBQUksS0FBSyxDQUFDLGdDQUFnQyxDQUFDLENBQUMsQ0FBQTt3QkFDbkQsT0FBTTtvQkFDUixDQUFDO29CQUVELE9BQU8sQ0FBQyxFQUFDLEtBQUssRUFBRSxPQUFPLENBQUMsS0FBSyxFQUFFLE9BQU8sRUFBQyxDQUFDLENBQUE7b0JBQ3hDLE9BQU07Z0JBQ1IsQ0FBQztnQkFFRCxJQUFJLE9BQU8sRUFBRSxJQUFJLEtBQUssc0JBQXNCLEVBQUUsQ0FBQztvQkFDN0MsTUFBTSxDQUFDLElBQUksS0FBSyxDQUFDLE9BQU8sQ0FBQyxLQUFLLElBQUksOEJBQThCLENBQUMsQ0FBQyxDQUFBO29CQUNsRSxPQUFNO2dCQUNSLENBQUM7Z0JBRUQsTUFBTSxDQUFDLHVCQUF1QixDQUFDLGVBQWUsRUFBRSxPQUFPLENBQUMsQ0FBQyxDQUFBO1lBQzNELENBQUM7U0FDRixDQUFDLENBQUE7SUFDSixDQUFDO0NBQ0YiLCJzb3VyY2VzQ29udGVudCI6WyIvLyBAdHMtY2hlY2tcblxuaW1wb3J0IHRpbWVvdXQsIHsgVGltZW91dEVycm9yIH0gZnJvbSBcImF3YWl0ZXJ5L2J1aWxkL3RpbWVvdXQuanNcIlxuaW1wb3J0IGNvbmZpZ3VyYXRpb25SZXNvbHZlciBmcm9tIFwiLi4vY29uZmlndXJhdGlvbi1yZXNvbHZlci5qc1wiXG5pbXBvcnQgaXNQbGFpbk9iamVjdCBmcm9tIFwiLi4vdXRpbHMvcGxhaW4tb2JqZWN0LmpzXCJcbmltcG9ydCBCYWNrZ3JvdW5kSm9iRW5xdWV1ZUFja25vd2xlZGdlbWVudFRpbWVvdXRFcnJvciBmcm9tIFwiLi9lbnF1ZXVlLWFja25vd2xlZGdlbWVudC10aW1lb3V0LWVycm9yLmpzXCJcbmltcG9ydCBCYWNrZ3JvdW5kSm9ic1NvY2tldFJlcXVlc3QgZnJvbSBcIi4vc29ja2V0LXJlcXVlc3QuanNcIlxuaW1wb3J0IHsgREVGQVVMVF9HRU5FUkFUSU9OX0hBTkRTSEFLRV9USU1FT1VUX01TLCB2YWxpZGF0ZUdlbmVyYXRpb25IYW5kc2hha2VUaW1lb3V0TXMgfSBmcm9tIFwiLi9nZW5lcmF0aW9uLWhhbmRzaGFrZS10aW1lb3V0LWVycm9yLmpzXCJcbmltcG9ydCB7IEJBQ0tHUk9VTkRfSk9CX0FDVElWRV9TVEFUVVNFUywgQkFDS0dST1VORF9KT0JfRVhFQ1VUSU9OX01PREVTLCBCQUNLR1JPVU5EX0pPQl9TVEFUVVNFUywgQkFDS0dST1VORF9KT0JfVEVSTUlOQUxfU1RBVFVTRVMgfSBmcm9tIFwiLi9qb2Itc2VtYW50aWNzLmpzXCJcblxuY29uc3QgREVGQVVMVF9FTlFVRVVFX1RJTUVPVVRfTVMgPSA1MDAwXG5jb25zdCBCQUNLR1JPVU5EX0pPQl9XQUtFX09VVENPTUVTID0gW1wid29rZW5cIiwgXCJhbHJlYWR5X2R1ZVwiLCBcImhhbmRlZF9vZmZcIiwgXCJub3RfZm91bmRcIl1cbmNvbnN0IEJBQ0tHUk9VTkRfSk9CX05VTExBQkxFX05VTUJFUl9GSUVMRFMgPSBbXG4gIFwiYXR0ZW1wdHNcIixcbiAgXCJjaGlsZFBpZFwiLFxuICBcImNoaWxkUmVjZWl2ZWRBdE1zXCIsXG4gIFwiY2hpbGRTdGFydGVkQXRNc1wiLFxuICBcImNvbXBsZXRlZEF0TXNcIixcbiAgXCJjcmVhdGVkQXRNc1wiLFxuICBcImZhaWxlZEF0TXNcIixcbiAgXCJoYW5kZWRPZmZBdE1zXCIsXG4gIFwibWF4Q29uY3VycmVuY3lcIixcbiAgXCJtYXhSZXRyaWVzXCIsXG4gIFwib3JwaGFuZWRBdE1zXCIsXG4gIFwic2NoZWR1bGVPcmRlclwiLFxuICBcInNjaGVkdWxlZEF0TXNcIixcbiAgXCJ0aW1lb3V0TXNcIlxuXVxuY29uc3QgQkFDS0dST1VORF9KT0JfTlVMTEFCTEVfU1RSSU5HX0ZJRUxEUyA9IFtcImNoaWxkSW5zdGFuY2VJZFwiLCBcImNvbmN1cnJlbmN5S2V5XCIsIFwiaGFuZG9mZklkXCIsIFwibGFzdEVycm9yXCIsIFwicnVubmVySG9zdG5hbWVcIiwgXCJzY2hlZHVsZUtleVwiLCBcIndvcmtlcklkXCJdXG5cbi8qKlxuICogQ2hlY2tzIGEgcmVxdWlyZWQgbnVsbGFibGUgbnVtYmVyIGZyb20gYSBub3JtYWxpemVkIHdpcmUgcm93LlxuICogQHBhcmFtIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gdmFsdWUgLSBGaWVsZCB2YWx1ZS5cbiAqIEByZXR1cm5zIHtib29sZWFufSAtIFdoZXRoZXIgdGhlIGZpZWxkIGlzIG51bGwgb3IgYSBmaW5pdGUgbnVtYmVyLlxuICovXG5mdW5jdGlvbiBpc051bGxhYmxlQmFja2dyb3VuZEpvYk51bWJlcih2YWx1ZSkge1xuICByZXR1cm4gdmFsdWUgPT09IG51bGwgfHwgKHR5cGVvZiB2YWx1ZSA9PT0gXCJudW1iZXJcIiAmJiBOdW1iZXIuaXNGaW5pdGUodmFsdWUpKVxufVxuXG4vKipcbiAqIENoZWNrcyBhIHJlcXVpcmVkIG51bGxhYmxlIHN0cmluZyBmcm9tIGEgbm9ybWFsaXplZCB3aXJlIHJvdy5cbiAqIEBwYXJhbSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59IHZhbHVlIC0gRmllbGQgdmFsdWUuXG4gKiBAcmV0dXJucyB7Ym9vbGVhbn0gLSBXaGV0aGVyIHRoZSBmaWVsZCBpcyBudWxsIG9yIGEgc3RyaW5nLlxuICovXG5mdW5jdGlvbiBpc051bGxhYmxlQmFja2dyb3VuZEpvYlN0cmluZyh2YWx1ZSkge1xuICByZXR1cm4gdmFsdWUgPT09IG51bGwgfHwgdHlwZW9mIHZhbHVlID09PSBcInN0cmluZ1wiXG59XG5cbi8qKlxuICogQ2hlY2tzIHRoYXQgYSB0cmFuc3BvcnQgam9iIHVzZXMgdGhlIG5vcm1hbGl6ZWQgcHVibGljIGNhbWVsLWNhc2Ugc2hhcGUuXG4gKiBAcGFyYW0ge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSB2YWx1ZSAtIFRyYW5zcG9ydCB2YWx1ZS5cbiAqIEByZXR1cm5zIHt2YWx1ZSBpcyBpbXBvcnQoXCIuL3R5cGVzLmpzXCIpLkJhY2tncm91bmRKb2JSb3d9IC0gV2hldGhlciBub3JtYWxpemVkLlxuICovXG5mdW5jdGlvbiBpc05vcm1hbGl6ZWRCYWNrZ3JvdW5kSm9iKHZhbHVlKSB7XG4gIGlmICghaXNQbGFpbk9iamVjdCh2YWx1ZSkpIHJldHVybiBmYWxzZVxuXG4gIGNvbnN0IGpvYiA9IHZhbHVlXG5cbiAgcmV0dXJuIHR5cGVvZiBqb2IuaWQgPT09IFwic3RyaW5nXCJcbiAgICAmJiB0eXBlb2Ygam9iLmpvYk5hbWUgPT09IFwic3RyaW5nXCJcbiAgICAmJiBBcnJheS5pc0FycmF5KGpvYi5hcmdzKVxuICAgICYmIEJBQ0tHUk9VTkRfSk9CX0VYRUNVVElPTl9NT0RFUy5zb21lKChleGVjdXRpb25Nb2RlKSA9PiBleGVjdXRpb25Nb2RlID09PSBqb2IuZXhlY3V0aW9uTW9kZSlcbiAgICAmJiB0eXBlb2Ygam9iLnF1ZXVlID09PSBcInN0cmluZ1wiXG4gICAgJiYgQkFDS0dST1VORF9KT0JfU1RBVFVTRVMuc29tZSgoc3RhdHVzKSA9PiBzdGF0dXMgPT09IGpvYi5zdGF0dXMpXG4gICAgJiYgQkFDS0dST1VORF9KT0JfTlVMTEFCTEVfTlVNQkVSX0ZJRUxEUy5ldmVyeSgoZmllbGQpID0+IGlzTnVsbGFibGVCYWNrZ3JvdW5kSm9iTnVtYmVyKGpvYltmaWVsZF0pKVxuICAgICYmIEJBQ0tHUk9VTkRfSk9CX05VTExBQkxFX1NUUklOR19GSUVMRFMuZXZlcnkoKGZpZWxkKSA9PiBpc051bGxhYmxlQmFja2dyb3VuZEpvYlN0cmluZyhqb2JbZmllbGRdKSlcbn1cblxuLyoqXG4gKiBEZXNjcmliZXMgYW4gdW5leHBlY3RlZCBwcm90b2NvbCByZXNwb25zZSB3aXRob3V0IGVjaG9pbmcgaXRzIHBheWxvYWQuXG4gKiBAcGFyYW0ge3N0cmluZ30gb3BlcmF0aW9uIC0gUHVibGljIG9wZXJhdGlvbiBuYW1lLlxuICogQHBhcmFtIHtpbXBvcnQoXCIuL3R5cGVzLmpzXCIpLkJhY2tncm91bmRKb2JTb2NrZXRNZXNzYWdlfSBtZXNzYWdlIC0gUmVzcG9uc2UuXG4gKiBAcmV0dXJucyB7RXJyb3J9IC0gUHJvdG9jb2wgZXJyb3IuXG4gKi9cbmZ1bmN0aW9uIHVuZXhwZWN0ZWRSZXNwb25zZUVycm9yKG9wZXJhdGlvbiwgbWVzc2FnZSkge1xuICBjb25zdCByZXNwb25zZVR5cGUgPSBtZXNzYWdlICYmIHR5cGVvZiBtZXNzYWdlLnR5cGUgPT09IFwic3RyaW5nXCIgPyBtZXNzYWdlLnR5cGUgOiBcIm1pc3NpbmcgdHlwZVwiXG5cbiAgcmV0dXJuIG5ldyBFcnJvcihgVW5leHBlY3RlZCAke29wZXJhdGlvbn0gcmVzcG9uc2U6ICR7cmVzcG9uc2VUeXBlfWApXG59XG5cbmV4cG9ydCBkZWZhdWx0IGNsYXNzIEJhY2tncm91bmRKb2JzQ2xpZW50IHtcbiAgLyoqXG4gICAqIFJ1bnMgY29uc3RydWN0b3IuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBbYXJnc10gLSBPcHRpb25zLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL2NvbmZpZ3VyYXRpb24uanNcIikuZGVmYXVsdH0gW2FyZ3MuY29uZmlndXJhdGlvbl0gLSBDb25maWd1cmF0aW9uLlxuICAgKiBAcGFyYW0ge251bWJlcn0gW2FyZ3MuZW5xdWV1ZVRpbWVvdXRNc10gLSBNYXhpbXVtIHRpbWUgdG8gd2FpdCBmb3IgYW4gZW5xdWV1ZSBhY2tub3dsZWRnZW1lbnQgaW4gbWlsbGlzZWNvbmRzIChkZWZhdWx0OiA1MDAwKS5cbiAgICogQHBhcmFtIHtudW1iZXJ9IFthcmdzLmdlbmVyYXRpb25IYW5kc2hha2VUaW1lb3V0TXNdIC0gTWF4aW11bSB0aW1lIHRvIHdhaXQgZm9yIGdlbmVyYXRpb24gYWNrbm93bGVkZ2VtZW50IChkZWZhdWx0OiA0MDAwKS5cbiAgICogQHBhcmFtIHtzdHJpbmd9IFthcmdzLmdlbmVyYXRpb25JZF0gLSBFeHBsaWNpdCByZWxlYXNlIGdlbmVyYXRpb24gaWRlbnRpdHkuXG4gICAqL1xuICBjb25zdHJ1Y3Rvcih7Y29uZmlndXJhdGlvbiwgZW5xdWV1ZVRpbWVvdXRNcyA9IERFRkFVTFRfRU5RVUVVRV9USU1FT1VUX01TLCBnZW5lcmF0aW9uSGFuZHNoYWtlVGltZW91dE1zID0gREVGQVVMVF9HRU5FUkFUSU9OX0hBTkRTSEFLRV9USU1FT1VUX01TLCBnZW5lcmF0aW9uSWR9ID0ge30pIHtcbiAgICB0aGlzLmNvbmZpZ3VyYXRpb25Qcm9taXNlID0gY29uZmlndXJhdGlvbiA/IFByb21pc2UucmVzb2x2ZShjb25maWd1cmF0aW9uKSA6IGNvbmZpZ3VyYXRpb25SZXNvbHZlcigpXG4gICAgdGhpcy5lbnF1ZXVlVGltZW91dE1zID0gZW5xdWV1ZVRpbWVvdXRNc1xuICAgIHRoaXMuZ2VuZXJhdGlvbkhhbmRzaGFrZVRpbWVvdXRNcyA9IHZhbGlkYXRlR2VuZXJhdGlvbkhhbmRzaGFrZVRpbWVvdXRNcyhnZW5lcmF0aW9uSGFuZHNoYWtlVGltZW91dE1zKVxuICAgIHRoaXMuZXhwbGljaXRHZW5lcmF0aW9uSWQgPSBnZW5lcmF0aW9uSWRcbiAgfVxuXG4gIC8qKlxuICAgKiBCdWlsZHMgYSBvbmUtc2hvdCBjbGllbnQgc29ja2V0IHJlcXVlc3QgZnJvbSB0aGUgcmVzb2x2ZWQgY29uZmlndXJhdGlvbi5cbiAgICogQHJldHVybnMge1Byb21pc2U8QmFja2dyb3VuZEpvYnNTb2NrZXRSZXF1ZXN0Pn0gLSBTb2NrZXQgcmVxdWVzdC5cbiAgICovXG4gIGFzeW5jIF9yZXF1ZXN0KCkge1xuICAgIGNvbnN0IGNvbmZpZ3VyYXRpb24gPSBhd2FpdCB0aGlzLmNvbmZpZ3VyYXRpb25Qcm9taXNlXG4gICAgY29uc3Qge2hvc3QsIHBvcnR9ID0gY29uZmlndXJhdGlvbi5nZXRCYWNrZ3JvdW5kSm9ic0NvbmZpZygpXG4gICAgY29uc3Qge2dlbmVyYXRpb25JZH0gPSBjb25maWd1cmF0aW9uLnJlc29sdmVCYWNrZ3JvdW5kSm9ic0dlbmVyYXRpb25Db25maWcoe1xuICAgICAgZ2VuZXJhdGlvbklkOiB0aGlzLmV4cGxpY2l0R2VuZXJhdGlvbklkLFxuICAgICAgc291cmNlTmFtZTogXCJCYWNrZ3JvdW5kSm9ic0NsaWVudFwiXG4gICAgfSlcblxuICAgIHJldHVybiBuZXcgQmFja2dyb3VuZEpvYnNTb2NrZXRSZXF1ZXN0KHtob3N0LCBwb3J0LCByb2xlOiBcImNsaWVudFwiLCBnZW5lcmF0aW9uSGFuZHNoYWtlVGltZW91dE1zOiB0aGlzLmdlbmVyYXRpb25IYW5kc2hha2VUaW1lb3V0TXMsIGdlbmVyYXRpb25JZH0pXG4gIH1cblxuICAvKipcbiAgICogUnVucyBlbnF1ZXVlLlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIE9wdGlvbnMuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBhcmdzLmpvYk5hbWUgLSBKb2IgbmFtZS5cbiAgICogQHBhcmFtIHtBcnJheTxSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59IGFyZ3MuYXJncyAtIEpvYiBhcmdzLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vdHlwZXMuanNcIikuQmFja2dyb3VuZEpvYk9wdGlvbnN9IFthcmdzLm9wdGlvbnNdIC0gSm9iIG9wdGlvbnMuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBbYXJncy5wcm9kdWNlckludm9jYXRpb25JZF0gLSBTdGFibGUgaWRlbnRpdHkgZm9yIG9uZSBvd25lZCBlbnF1ZXVlIGludm9jYXRpb24uXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi90eXBlcy5qc1wiKS5CYWNrZ3JvdW5kSm9iUHJvZHVjZXJQcm9vZn0gW2FyZ3MucHJvZHVjZXJQcm9vZl0gLSBFeGFjdCBpbnRlcm5hbCBwcm9kdWNlciBoYW5kb2ZmLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxzdHJpbmc+fSAtIEpvYiBpZC5cbiAgICovXG4gIGFzeW5jIGVucXVldWUoe2pvYk5hbWUsIGFyZ3MsIG9wdGlvbnMsIHByb2R1Y2VySW52b2NhdGlvbklkLCBwcm9kdWNlclByb29mfSkge1xuICAgIGNvbnN0IG1lc3NhZ2UgPSB7XG4gICAgICB0eXBlOiAvKiogQHR5cGUge2NvbnN0fSAqLyAoXCJlbnF1ZXVlXCIpLFxuICAgICAgam9iTmFtZSxcbiAgICAgIGFyZ3MsXG4gICAgICBvcHRpb25zLFxuICAgICAgLi4uKHByb2R1Y2VySW52b2NhdGlvbklkID8ge3Byb2R1Y2VySW52b2NhdGlvbklkfSA6IHt9KSxcbiAgICAgIC4uLihwcm9kdWNlclByb29mID8ge3Byb2R1Y2VyUHJvb2Z9IDoge30pXG4gICAgfVxuICAgIC8qKlxuICAgICAqIENyZWF0ZXMgc2FmZSBvYnNlcnZhdGlvbnMgZm9yIG9uZSBhdHRlbXB0IHdpdGhvdXQgcmV0YWluaW5nIHJlcXVlc3QgZGF0YS5cbiAgICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIEF0dGVtcHQgaWRlbnRpdHkuXG4gICAgICogQHBhcmFtIHtcImluaXRpYWxcIiB8IFwib3duZWRfcmVwbGF5XCJ9IGFyZ3MuYXR0ZW1wdEtpbmQgLSBJbml0aWFsIGF0dGVtcHQgb3Igb3duZWQgcmVwbGF5LlxuICAgICAqIEBwYXJhbSB7bnVtYmVyfSBhcmdzLmF0dGVtcHROdW1iZXIgLSBPbmUtYmFzZWQgYXR0ZW1wdCBudW1iZXIuXG4gICAgICogQHJldHVybnMge2ltcG9ydChcIi4vZW5xdWV1ZS1hY2tub3dsZWRnZW1lbnQtdGltZW91dC1lcnJvci5qc1wiKS5CYWNrZ3JvdW5kSm9iRW5xdWV1ZUF0dGVtcHR9IC0gTXV0YWJsZSBhdHRlbXB0IG9ic2VydmF0aW9ucy5cbiAgICAgKi9cbiAgICBjb25zdCBuZXdBdHRlbXB0T2JzZXJ2YXRpb24gPSAoe2F0dGVtcHRLaW5kLCBhdHRlbXB0TnVtYmVyfSkgPT4gKHtcbiAgICAgIGFja25vd2xlZGdlbWVudFdhaXRFbGFwc2VkTXM6IDAsXG4gICAgICBhdHRlbXB0RWxhcHNlZE1zOiAwLFxuICAgICAgYXR0ZW1wdEtpbmQsXG4gICAgICBhdHRlbXB0TnVtYmVyLFxuICAgICAgZXhwbGljaXRseVJlamVjdGVkOiBmYWxzZSxcbiAgICAgIGdlbmVyYXRpb25GZW5jZWQ6IGZhbHNlLFxuICAgICAgcmVxdWVzdFNlbnQ6IGZhbHNlXG4gICAgfSlcbiAgICAvKipcbiAgICAgKiBTZW5kcyBvbmUgZW5xdWV1ZSBhdHRlbXB0LiBBbiBvd25lZCBjYWxsZXIgbWF5IHJlcGxheSB0aGlzIGV4YWN0IG1lc3NhZ2VcbiAgICAgKiBvbmNlIHdoZW4gdHJhbnNwb3J0IGFja25vd2xlZGdlbWVudCByZW1haW5zIGFtYmlndW91cyBhZnRlciBzZW5kLlxuICAgICAqIEBwYXJhbSB7aW1wb3J0KFwiLi9lbnF1ZXVlLWFja25vd2xlZGdlbWVudC10aW1lb3V0LWVycm9yLmpzXCIpLkJhY2tncm91bmRKb2JFbnF1ZXVlQXR0ZW1wdH0gYXR0ZW1wdE9ic2VydmF0aW9uIC0gTXV0YWJsZSBhdHRlbXB0IG9ic2VydmF0aW9ucy5cbiAgICAgKiBAcGFyYW0ge1JlYWRvbmx5PEFycmF5PGltcG9ydChcIi4vZW5xdWV1ZS1hY2tub3dsZWRnZW1lbnQtdGltZW91dC1lcnJvci5qc1wiKS5CYWNrZ3JvdW5kSm9iRW5xdWV1ZUF0dGVtcHQ+Pn0gcHJldmlvdXNBdHRlbXB0cyAtIEVhcmxpZXIgdGltZWQtb3V0IGF0dGVtcHRzLlxuICAgICAqIEByZXR1cm5zIHtQcm9taXNlPHN0cmluZz59IC0gSm9iIGlkLlxuICAgICAqL1xuICAgIGNvbnN0IGVucXVldWVBdHRlbXB0ID0gYXN5bmMgKGF0dGVtcHRPYnNlcnZhdGlvbiwgcHJldmlvdXNBdHRlbXB0cykgPT4ge1xuICAgICAgY29uc3QgYXR0ZW1wdFN0YXJ0ZWRBdE1zID0gRGF0ZS5ub3coKVxuICAgICAgY29uc3QgcmVxdWVzdCA9IGF3YWl0IHRoaXMuX3JlcXVlc3QoKVxuICAgICAgY29uc3QgcmVxdWVzdEFib3J0Q29udHJvbGxlciA9IG5ldyBBYm9ydENvbnRyb2xsZXIoKVxuICAgICAgY29uc3QgdGltZW91dEVycm9yTWVzc2FnZSA9IGBCYWNrZ3JvdW5kIGpvYiBlbnF1ZXVlIGFja25vd2xlZGdlbWVudCB0aW1lZCBvdXQgYWZ0ZXIgJHt0aGlzLmVucXVldWVUaW1lb3V0TXN9bXNgXG4gICAgICAvKiogQHR5cGUge251bWJlciB8IHVuZGVmaW5lZH0gKi9cbiAgICAgIGxldCByZXF1ZXN0U2VudEF0TXNcbiAgICAgIC8qKlxuICAgICAgICogUmVzb2x2ZXMgdGhlIHByZS1zZW5kIHBoYXNlIHdoZW4gdGhlIG11dGF0aW9uIGhhcyBlbnRlcmVkIHRoZSBzb2NrZXQuXG4gICAgICAgKiBAdHlwZSB7KCkgPT4gdm9pZH1cbiAgICAgICAqL1xuICAgICAgbGV0IG1hcmtSZXF1ZXN0U2VudCA9ICgpID0+IHt9XG4gICAgICBjb25zdCByZXF1ZXN0U2VudCA9IG5ldyBQcm9taXNlKChyZXNvbHZlKSA9PiB7XG4gICAgICAgIG1hcmtSZXF1ZXN0U2VudCA9ICgpID0+IHJlc29sdmUodW5kZWZpbmVkKVxuICAgICAgfSlcbiAgICAgIC8qKlxuICAgICAgICogQXBwbGllcyB0aGUgY29uZmlndXJlZCBkZWFkbGluZSBpbmRlcGVuZGVudGx5IHRvIG9uZSByZXF1ZXN0IHBoYXNlLlxuICAgICAgICogQHRlbXBsYXRlIFRcbiAgICAgICAqIEBwYXJhbSB7KCkgPT4gUHJvbWlzZTxUPn0gY2FsbGJhY2sgLSBQaGFzZSB3b3JrLlxuICAgICAgICogQHJldHVybnMge1Byb21pc2U8VD59IC0gUGhhc2UgcmVzdWx0LlxuICAgICAgICovXG4gICAgICBjb25zdCB3aXRoRW5xdWV1ZVRpbWVvdXQgPSBhc3luYyAoY2FsbGJhY2spID0+IGF3YWl0IHRpbWVvdXQoe1xuICAgICAgICBlcnJvck1lc3NhZ2U6IHRpbWVvdXRFcnJvck1lc3NhZ2UsXG4gICAgICAgIHRpbWVvdXQ6IHRoaXMuZW5xdWV1ZVRpbWVvdXRNc1xuICAgICAgfSwgYXN5bmMgKHtjb250cm9sfSkgPT4ge1xuICAgICAgICBjb25zdCBhYm9ydFJlcXVlc3QgPSAoKSA9PiByZXF1ZXN0QWJvcnRDb250cm9sbGVyLmFib3J0KGNvbnRyb2wuc2lnbmFsLnJlYXNvbilcblxuICAgICAgICBjb250cm9sLnNpZ25hbC5hZGRFdmVudExpc3RlbmVyKFwiYWJvcnRcIiwgYWJvcnRSZXF1ZXN0KVxuICAgICAgICB0cnkge1xuICAgICAgICAgIHJldHVybiBhd2FpdCBjYWxsYmFjaygpXG4gICAgICAgIH0gZmluYWxseSB7XG4gICAgICAgICAgY29udHJvbC5zaWduYWwucmVtb3ZlRXZlbnRMaXN0ZW5lcihcImFib3J0XCIsIGFib3J0UmVxdWVzdClcbiAgICAgICAgfVxuICAgICAgfSlcbiAgICAgIGNvbnN0IHJlcXVlc3RQcm9taXNlID0gcmVxdWVzdC5ydW4oe1xuICAgICAgICBzaWduYWw6IHJlcXVlc3RBYm9ydENvbnRyb2xsZXIuc2lnbmFsLFxuICAgICAgICBvbkNvbm5lY3Q6IChqc29uU29ja2V0KSA9PiB7XG4gICAgICAgICAganNvblNvY2tldC5zZW5kKG1lc3NhZ2UpXG4gICAgICAgICAgYXR0ZW1wdE9ic2VydmF0aW9uLmdlbmVyYXRpb25GZW5jZWQgPSBCb29sZWFuKHJlcXVlc3QuZ2VuZXJhdGlvbklkKVxuICAgICAgICAgIGF0dGVtcHRPYnNlcnZhdGlvbi5yZXF1ZXN0U2VudCA9IHRydWVcbiAgICAgICAgICByZXF1ZXN0U2VudEF0TXMgPSBEYXRlLm5vdygpXG4gICAgICAgICAgbWFya1JlcXVlc3RTZW50KClcbiAgICAgICAgfSxcbiAgICAgICAgb25NZXNzYWdlOiAoe21lc3NhZ2UsIHJlc29sdmUsIHJlamVjdH0pID0+IHtcbiAgICAgICAgICBpZiAobWVzc2FnZT8udHlwZSA9PT0gXCJlbnF1ZXVlZFwiKSB7XG4gICAgICAgICAgICByZXNvbHZlKG1lc3NhZ2Uuam9iSWQpXG4gICAgICAgICAgICByZXR1cm5cbiAgICAgICAgICB9XG5cbiAgICAgICAgICBpZiAobWVzc2FnZT8udHlwZSA9PT0gXCJlbnF1ZXVlLWVycm9yXCIpIHtcbiAgICAgICAgICAgIGF0dGVtcHRPYnNlcnZhdGlvbi5leHBsaWNpdGx5UmVqZWN0ZWQgPSB0cnVlXG4gICAgICAgICAgICByZWplY3QobmV3IEVycm9yKG1lc3NhZ2UuZXJyb3IgfHwgXCJGYWlsZWQgdG8gZW5xdWV1ZSBqb2JcIikpXG4gICAgICAgICAgfVxuICAgICAgICB9XG4gICAgICB9KVxuXG4gICAgICBhd2FpdCB3aXRoRW5xdWV1ZVRpbWVvdXQoYXN5bmMgKCkgPT4gYXdhaXQgUHJvbWlzZS5yYWNlKFtyZXF1ZXN0U2VudCwgcmVxdWVzdFByb21pc2VdKSlcblxuICAgICAgdHJ5IHtcbiAgICAgICAgcmV0dXJuIGF3YWl0IHdpdGhFbnF1ZXVlVGltZW91dChhc3luYyAoKSA9PiBhd2FpdCByZXF1ZXN0UHJvbWlzZSlcbiAgICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICAgIGlmICghKGVycm9yIGluc3RhbmNlb2YgVGltZW91dEVycm9yKSkgdGhyb3cgZXJyb3JcbiAgICAgICAgaWYgKHJlcXVlc3RTZW50QXRNcyA9PT0gdW5kZWZpbmVkKSB0aHJvdyBuZXcgRXJyb3IoXCJCYWNrZ3JvdW5kIGpvYiBlbnF1ZXVlIGFja25vd2xlZGdlbWVudCB3YWl0IHN0YXJ0ZWQgYmVmb3JlIHRoZSByZXF1ZXN0IHdhcyBzZW50XCIsIHtjYXVzZTogZXJyb3J9KVxuXG4gICAgICAgIGNvbnN0IHRpbWVkT3V0QXRNcyA9IERhdGUubm93KClcbiAgICAgICAgLy8gVGhlIGZpcmVkIHRpbWVyIHByb3ZlcyBpdHMgbG9naWNhbCBkZWFkbGluZSBldmVuIHdoZW4gdGhlIGFkanVzdGFibGUgd2FsbCBjbG9jayByZXBvcnRzIGEgc2hvcnRlciBpbnRlcnZhbC5cbiAgICAgICAgY29uc3QgYWNrbm93bGVkZ2VtZW50V2FpdEVsYXBzZWRNcyA9IE1hdGgubWF4KHRoaXMuZW5xdWV1ZVRpbWVvdXRNcywgdGltZWRPdXRBdE1zIC0gcmVxdWVzdFNlbnRBdE1zKVxuXG4gICAgICAgIGF0dGVtcHRPYnNlcnZhdGlvbi5hY2tub3dsZWRnZW1lbnRXYWl0RWxhcHNlZE1zID0gYWNrbm93bGVkZ2VtZW50V2FpdEVsYXBzZWRNc1xuICAgICAgICBhdHRlbXB0T2JzZXJ2YXRpb24uYXR0ZW1wdEVsYXBzZWRNcyA9IE1hdGgubWF4KGFja25vd2xlZGdlbWVudFdhaXRFbGFwc2VkTXMsIHRpbWVkT3V0QXRNcyAtIGF0dGVtcHRTdGFydGVkQXRNcylcblxuICAgICAgICB0aHJvdyBuZXcgQmFja2dyb3VuZEpvYkVucXVldWVBY2tub3dsZWRnZW1lbnRUaW1lb3V0RXJyb3Ioe1xuICAgICAgICAgIGFja25vd2xlZGdlbWVudFRpbWVvdXRNczogdGhpcy5lbnF1ZXVlVGltZW91dE1zLFxuICAgICAgICAgIGF0dGVtcHRIaXN0b3J5OiBbLi4ucHJldmlvdXNBdHRlbXB0cywgYXR0ZW1wdE9ic2VydmF0aW9uXSxcbiAgICAgICAgICBjYXVzZTogZXJyb3IsXG4gICAgICAgICAgZ2VuZXJhdGlvbklkOiByZXF1ZXN0LmdlbmVyYXRpb25JZCxcbiAgICAgICAgICBqb2JOYW1lLFxuICAgICAgICAgIHByb2R1Y2VySW52b2NhdGlvbklkLFxuICAgICAgICAgIHByb2R1Y2VyUHJvb2ZQcmVzZW50OiBCb29sZWFuKHByb2R1Y2VyUHJvb2YpXG4gICAgICAgIH0pXG4gICAgICB9XG4gICAgfVxuXG4gICAgY29uc3QgaW5pdGlhbEF0dGVtcHQgPSBuZXdBdHRlbXB0T2JzZXJ2YXRpb24oe2F0dGVtcHRLaW5kOiBcImluaXRpYWxcIiwgYXR0ZW1wdE51bWJlcjogMX0pXG5cbiAgICB0cnkge1xuICAgICAgcmV0dXJuIGF3YWl0IGVucXVldWVBdHRlbXB0KGluaXRpYWxBdHRlbXB0LCBbXSlcbiAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgaWYgKCFwcm9kdWNlckludm9jYXRpb25JZCB8fCAhcHJvZHVjZXJQcm9vZiB8fCAhaW5pdGlhbEF0dGVtcHQuZ2VuZXJhdGlvbkZlbmNlZCB8fCAhaW5pdGlhbEF0dGVtcHQucmVxdWVzdFNlbnQgfHwgaW5pdGlhbEF0dGVtcHQuZXhwbGljaXRseVJlamVjdGVkKSB0aHJvdyBlcnJvclxuXG4gICAgICBjb25zdCBwcmV2aW91c0F0dGVtcHRzID0gZXJyb3IgaW5zdGFuY2VvZiBCYWNrZ3JvdW5kSm9iRW5xdWV1ZUFja25vd2xlZGdlbWVudFRpbWVvdXRFcnJvciA/IGVycm9yLmF0dGVtcHRIaXN0b3J5IDogW11cbiAgICAgIGNvbnN0IHJlcGxheUF0dGVtcHQgPSBuZXdBdHRlbXB0T2JzZXJ2YXRpb24oe2F0dGVtcHRLaW5kOiBcIm93bmVkX3JlcGxheVwiLCBhdHRlbXB0TnVtYmVyOiAyfSlcblxuICAgICAgcmV0dXJuIGF3YWl0IGVucXVldWVBdHRlbXB0KHJlcGxheUF0dGVtcHQsIHByZXZpb3VzQXR0ZW1wdHMpXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIEF0b21pY2FsbHkgcmVwbGFjZXMgdGhlIHF1ZXVlZCBvd25lciBvZiBhIHN0YWJsZSBzY2hlZHVsZSBrZXkuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gT3B0aW9ucy5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGFyZ3Muc2NoZWR1bGVLZXkgLSBTdGFibGUgbG9naWNhbCBzY2hlZHVsZSBrZXkuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBhcmdzLmpvYk5hbWUgLSBKb2IgbmFtZS5cbiAgICogQHBhcmFtIHtBcnJheTxSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59IGFyZ3MuYXJncyAtIEpvYiBhcmdzLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vdHlwZXMuanNcIikuQmFja2dyb3VuZEpvYk9wdGlvbnN9IFthcmdzLm9wdGlvbnNdIC0gSm9iIG9wdGlvbnMuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPGltcG9ydChcIi4vdHlwZXMuanNcIikuQmFja2dyb3VuZEpvYlJlcGxhY2VtZW50UmVzdWx0Pn0gLSBSZXBsYWNlbWVudCByZXN1bHQuXG4gICAqL1xuICBhc3luYyByZXBsYWNlU2NoZWR1bGVkKHtzY2hlZHVsZUtleSwgam9iTmFtZSwgYXJncywgb3B0aW9uc30pIHtcbiAgICBjb25zdCByZXF1ZXN0ID0gYXdhaXQgdGhpcy5fcmVxdWVzdCgpXG5cbiAgICByZXR1cm4gYXdhaXQgcmVxdWVzdC5ydW4oe1xuICAgICAgb25Db25uZWN0OiAoanNvblNvY2tldCkgPT4ge1xuICAgICAgICBqc29uU29ja2V0LnNlbmQoe3R5cGU6IFwicmVwbGFjZS1zY2hlZHVsZWRcIiwgc2NoZWR1bGVLZXksIGpvYk5hbWUsIGFyZ3MsIG9wdGlvbnN9KVxuICAgICAgfSxcbiAgICAgIG9uTWVzc2FnZTogKHttZXNzYWdlLCByZXNvbHZlLCByZWplY3R9KSA9PiB7XG4gICAgICAgIGlmIChtZXNzYWdlPy50eXBlID09PSBcInNjaGVkdWxlLXJlcGxhY2VkXCIpIHtcbiAgICAgICAgICByZXNvbHZlKHtcbiAgICAgICAgICAgIGpvYklkOiBtZXNzYWdlLmpvYklkLFxuICAgICAgICAgICAgcHJldmlvdXNKb2JJZDogbWVzc2FnZS5wcmV2aW91c0pvYklkLFxuICAgICAgICAgICAgcHJldmlvdXNTdGF0dXM6IG1lc3NhZ2UucHJldmlvdXNTdGF0dXNcbiAgICAgICAgICB9KVxuICAgICAgICAgIHJldHVyblxuICAgICAgICB9XG5cbiAgICAgICAgaWYgKG1lc3NhZ2U/LnR5cGUgPT09IFwicmVwbGFjZS1zY2hlZHVsZWQtZXJyb3JcIikge1xuICAgICAgICAgIHJlamVjdChuZXcgRXJyb3IobWVzc2FnZS5lcnJvciB8fCBcIkZhaWxlZCB0byByZXBsYWNlIHNjaGVkdWxlZCBqb2JcIikpXG4gICAgICAgIH1cbiAgICAgIH1cbiAgICB9KVxuICB9XG5cbiAgLyoqXG4gICAqIENhbmNlbHMgb3IgZGV0YWNoZXMgdGhlIGN1cnJlbnQgb3duZXIgb2YgYSBzdGFibGUgc2NoZWR1bGUga2V5LlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIE9wdGlvbnMuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBhcmdzLnNjaGVkdWxlS2V5IC0gU3RhYmxlIGxvZ2ljYWwgc2NoZWR1bGUga2V5LlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxpbXBvcnQoXCIuL3R5cGVzLmpzXCIpLkJhY2tncm91bmRKb2JDYW5jZWxsYXRpb25SZXN1bHQ+fSAtIENhbmNlbGxhdGlvbiByZXN1bHQuXG4gICAqL1xuICBhc3luYyBjYW5jZWxTY2hlZHVsZWQoe3NjaGVkdWxlS2V5fSkge1xuICAgIGNvbnN0IHJlcXVlc3QgPSBhd2FpdCB0aGlzLl9yZXF1ZXN0KClcblxuICAgIHJldHVybiBhd2FpdCByZXF1ZXN0LnJ1bih7XG4gICAgICBvbkNvbm5lY3Q6IChqc29uU29ja2V0KSA9PiB7XG4gICAgICAgIGpzb25Tb2NrZXQuc2VuZCh7dHlwZTogXCJjYW5jZWwtc2NoZWR1bGVkXCIsIHNjaGVkdWxlS2V5fSlcbiAgICAgIH0sXG4gICAgICBvbk1lc3NhZ2U6ICh7bWVzc2FnZSwgcmVzb2x2ZSwgcmVqZWN0fSkgPT4ge1xuICAgICAgICBpZiAobWVzc2FnZT8udHlwZSA9PT0gXCJzY2hlZHVsZS1jYW5jZWxsZWRcIikge1xuICAgICAgICAgIHJlc29sdmUoe2pvYklkOiBtZXNzYWdlLmpvYklkLCBvdXRjb21lOiBtZXNzYWdlLm91dGNvbWV9KVxuICAgICAgICAgIHJldHVyblxuICAgICAgICB9XG5cbiAgICAgICAgaWYgKG1lc3NhZ2U/LnR5cGUgPT09IFwiY2FuY2VsLXNjaGVkdWxlZC1lcnJvclwiKSB7XG4gICAgICAgICAgcmVqZWN0KG5ldyBFcnJvcihtZXNzYWdlLmVycm9yIHx8IFwiRmFpbGVkIHRvIGNhbmNlbCBzY2hlZHVsZWQgam9iXCIpKVxuICAgICAgICB9XG4gICAgICB9XG4gICAgfSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSZWFkcyBjdXJyZW50IHN0YWJsZSBvd25lcnNoaXAgYW5kIG9wdGlvbmFsIHRlcm1pbmFsIGhpc3RvcnkuXG4gICAqIEBwYXJhbSB7e3NjaGVkdWxlS2V5OiBzdHJpbmcsIGluY2x1ZGVMYXRlc3RUZXJtaW5hbD86IGJvb2xlYW59fSBhcmdzIC0gTG9va3VwIHJlcXVlc3QuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPGltcG9ydChcIi4vdHlwZXMuanNcIikuQmFja2dyb3VuZEpvYlNjaGVkdWxlZExvb2t1cFJlc3VsdD59IC0gTm9ybWFsaXplZCBzdGFibGUgc2NoZWR1bGUgam9icy5cbiAgICovXG4gIGFzeW5jIGdldFNjaGVkdWxlZEpvYih7c2NoZWR1bGVLZXksIGluY2x1ZGVMYXRlc3RUZXJtaW5hbH0pIHtcbiAgICBjb25zdCByZXF1ZXN0ID0gYXdhaXQgdGhpcy5fcmVxdWVzdCgpXG5cbiAgICByZXR1cm4gYXdhaXQgcmVxdWVzdC5ydW4oe1xuICAgICAgb25Db25uZWN0OiAoanNvblNvY2tldCkgPT4ge1xuICAgICAgICBqc29uU29ja2V0LnNlbmQoe3R5cGU6IFwiZ2V0LXNjaGVkdWxlZC1qb2JcIiwgc2NoZWR1bGVLZXksIGluY2x1ZGVMYXRlc3RUZXJtaW5hbH0pXG4gICAgICB9LFxuICAgICAgb25NZXNzYWdlOiAoe21lc3NhZ2UsIHJlc29sdmUsIHJlamVjdH0pID0+IHtcbiAgICAgICAgaWYgKG1lc3NhZ2U/LnR5cGUgPT09IFwic2NoZWR1bGVkLWpvYlwiKSB7XG4gICAgICAgICAgY29uc3Qge2N1cnJlbnRKb2IsIGxhdGVzdFRlcm1pbmFsSm9ifSA9IG1lc3NhZ2VcbiAgICAgICAgICBjb25zdCBjdXJyZW50Sm9iVmFsaWQgPSBjdXJyZW50Sm9iID09PSBudWxsXG4gICAgICAgICAgICB8fCAoaXNOb3JtYWxpemVkQmFja2dyb3VuZEpvYihjdXJyZW50Sm9iKSAmJiBCQUNLR1JPVU5EX0pPQl9BQ1RJVkVfU1RBVFVTRVMuc29tZSgoc3RhdHVzKSA9PiBzdGF0dXMgPT09IGN1cnJlbnRKb2Iuc3RhdHVzKSlcbiAgICAgICAgICBjb25zdCBsYXRlc3RUZXJtaW5hbEpvYlZhbGlkID0gbGF0ZXN0VGVybWluYWxKb2IgPT09IG51bGxcbiAgICAgICAgICAgIHx8IChpc05vcm1hbGl6ZWRCYWNrZ3JvdW5kSm9iKGxhdGVzdFRlcm1pbmFsSm9iKSAmJiBCQUNLR1JPVU5EX0pPQl9URVJNSU5BTF9TVEFUVVNFUy5zb21lKChzdGF0dXMpID0+IHN0YXR1cyA9PT0gbGF0ZXN0VGVybWluYWxKb2Iuc3RhdHVzKSlcblxuICAgICAgICAgIGlmICghY3VycmVudEpvYlZhbGlkIHx8ICFsYXRlc3RUZXJtaW5hbEpvYlZhbGlkKSB7XG4gICAgICAgICAgICByZWplY3QobmV3IEVycm9yKFwiSW52YWxpZCBnZXRTY2hlZHVsZWRKb2IgcmVzcG9uc2U6IGV4cGVjdGVkIG5vcm1hbGl6ZWQgcHVibGljIGpvYiB2YWx1ZXNcIikpXG4gICAgICAgICAgICByZXR1cm5cbiAgICAgICAgICB9XG5cbiAgICAgICAgICByZXNvbHZlKHtjdXJyZW50Sm9iLCBsYXRlc3RUZXJtaW5hbEpvYn0pXG4gICAgICAgICAgcmV0dXJuXG4gICAgICAgIH1cblxuICAgICAgICBpZiAobWVzc2FnZT8udHlwZSA9PT0gXCJnZXQtc2NoZWR1bGVkLWpvYi1lcnJvclwiKSB7XG4gICAgICAgICAgcmVqZWN0KG5ldyBFcnJvcihtZXNzYWdlLmVycm9yIHx8IFwiRmFpbGVkIHRvIHJlYWQgc2NoZWR1bGVkIGpvYlwiKSlcbiAgICAgICAgICByZXR1cm5cbiAgICAgICAgfVxuXG4gICAgICAgIHJlamVjdCh1bmV4cGVjdGVkUmVzcG9uc2VFcnJvcihcImdldFNjaGVkdWxlZEpvYlwiLCBtZXNzYWdlKSlcbiAgICAgIH1cbiAgICB9KVxuICB9XG5cbiAgLyoqXG4gICAqIEV4cGVkaXRlcyBhIGZ1dHVyZSBxdWV1ZWQgc3RhYmxlIG93bmVyIHdpdGhvdXQgY2hhbmdpbmcgam9iIGlkZW50aXR5LlxuICAgKiBAcGFyYW0ge3tzY2hlZHVsZUtleTogc3RyaW5nfX0gYXJncyAtIFdha2UgcmVxdWVzdC5cbiAgICogQHJldHVybnMge1Byb21pc2U8aW1wb3J0KFwiLi90eXBlcy5qc1wiKS5CYWNrZ3JvdW5kSm9iV2FrZVJlc3VsdD59IC0gV2FrZSByZXN1bHQuXG4gICAqL1xuICBhc3luYyB3YWtlU2NoZWR1bGVkKHtzY2hlZHVsZUtleX0pIHtcbiAgICBjb25zdCByZXF1ZXN0ID0gYXdhaXQgdGhpcy5fcmVxdWVzdCgpXG5cbiAgICByZXR1cm4gYXdhaXQgcmVxdWVzdC5ydW4oe1xuICAgICAgb25Db25uZWN0OiAoanNvblNvY2tldCkgPT4ge1xuICAgICAgICBqc29uU29ja2V0LnNlbmQoe3R5cGU6IFwid2FrZS1zY2hlZHVsZWRcIiwgc2NoZWR1bGVLZXl9KVxuICAgICAgfSxcbiAgICAgIG9uTWVzc2FnZTogKHttZXNzYWdlLCByZXNvbHZlLCByZWplY3R9KSA9PiB7XG4gICAgICAgIGlmIChtZXNzYWdlPy50eXBlID09PSBcInNjaGVkdWxlLXdva2VuXCIpIHtcbiAgICAgICAgICBjb25zdCBvdXRjb21lID0gbWVzc2FnZS5vdXRjb21lXG4gICAgICAgICAgY29uc3Qga25vd25PdXRjb21lID0gQkFDS0dST1VORF9KT0JfV0FLRV9PVVRDT01FUy5pbmNsdWRlcyhvdXRjb21lKVxuICAgICAgICAgIGNvbnN0IHZhbGlkSm9iSWQgPSBvdXRjb21lID09PSBcIm5vdF9mb3VuZFwiID8gbWVzc2FnZS5qb2JJZCA9PT0gbnVsbCA6IHR5cGVvZiBtZXNzYWdlLmpvYklkID09PSBcInN0cmluZ1wiICYmIG1lc3NhZ2Uuam9iSWQubGVuZ3RoID4gMFxuXG4gICAgICAgICAgaWYgKCFrbm93bk91dGNvbWUgfHwgIXZhbGlkSm9iSWQpIHtcbiAgICAgICAgICAgIHJlamVjdChuZXcgRXJyb3IoXCJJbnZhbGlkIHdha2VTY2hlZHVsZWQgcmVzcG9uc2VcIikpXG4gICAgICAgICAgICByZXR1cm5cbiAgICAgICAgICB9XG5cbiAgICAgICAgICByZXNvbHZlKHtqb2JJZDogbWVzc2FnZS5qb2JJZCwgb3V0Y29tZX0pXG4gICAgICAgICAgcmV0dXJuXG4gICAgICAgIH1cblxuICAgICAgICBpZiAobWVzc2FnZT8udHlwZSA9PT0gXCJ3YWtlLXNjaGVkdWxlZC1lcnJvclwiKSB7XG4gICAgICAgICAgcmVqZWN0KG5ldyBFcnJvcihtZXNzYWdlLmVycm9yIHx8IFwiRmFpbGVkIHRvIHdha2Ugc2NoZWR1bGVkIGpvYlwiKSlcbiAgICAgICAgICByZXR1cm5cbiAgICAgICAgfVxuXG4gICAgICAgIHJlamVjdCh1bmV4cGVjdGVkUmVzcG9uc2VFcnJvcihcIndha2VTY2hlZHVsZWRcIiwgbWVzc2FnZSkpXG4gICAgICB9XG4gICAgfSlcbiAgfVxufVxuIl19