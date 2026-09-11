// @ts-check
import timeout from "awaitery/build/timeout.js";
import configurationResolver from "../configuration-resolver.js";
import isPlainObject from "../utils/plain-object.js";
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
        const acknowledgement = { explicitlyRejected: false, generationFenced: false, requestSent: false };
        /**
         * Sends one enqueue attempt. An owned caller may replay this exact message
         * once when transport acknowledgement remains ambiguous after send.
         * @param {{explicitlyRejected: boolean, generationFenced: boolean, requestSent: boolean} | undefined} attemptAcknowledgement - First-attempt observations.
         * @returns {Promise<string>} - Job id.
         */
        const enqueueAttempt = async (attemptAcknowledgement) => {
            const request = await this._request();
            const requestAbortController = new AbortController();
            const timeoutErrorMessage = `Background job enqueue acknowledgement timed out after ${this.enqueueTimeoutMs}ms`;
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
                    if (attemptAcknowledgement) {
                        attemptAcknowledgement.generationFenced = Boolean(request.generationId);
                        attemptAcknowledgement.requestSent = true;
                    }
                    markRequestSent();
                },
                onMessage: ({ message, resolve, reject }) => {
                    if (message?.type === "enqueued") {
                        resolve(message.jobId);
                        return;
                    }
                    if (message?.type === "enqueue-error") {
                        if (attemptAcknowledgement)
                            attemptAcknowledgement.explicitlyRejected = true;
                        reject(new Error(message.error || "Failed to enqueue job"));
                    }
                }
            });
            await withEnqueueTimeout(async () => await Promise.race([requestSent, requestPromise]));
            return await withEnqueueTimeout(async () => await requestPromise);
        };
        try {
            return await enqueueAttempt(acknowledgement);
        }
        catch (error) {
            if (!producerInvocationId || !producerProof || !acknowledgement.generationFenced || !acknowledgement.requestSent || acknowledgement.explicitlyRejected)
                throw error;
        }
        return await enqueueAttempt(undefined);
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiY2xpZW50LmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiLi4vLi4vLi4vc3JjL2JhY2tncm91bmQtam9icy9jbGllbnQuanMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6IkFBQUEsWUFBWTtBQUVaLE9BQU8sT0FBTyxNQUFNLDJCQUEyQixDQUFBO0FBQy9DLE9BQU8scUJBQXFCLE1BQU0sOEJBQThCLENBQUE7QUFDaEUsT0FBTyxhQUFhLE1BQU0sMEJBQTBCLENBQUE7QUFDcEQsT0FBTywyQkFBMkIsTUFBTSxxQkFBcUIsQ0FBQTtBQUM3RCxPQUFPLEVBQUUsdUNBQXVDLEVBQUUsb0NBQW9DLEVBQUUsTUFBTSx5Q0FBeUMsQ0FBQTtBQUN2SSxPQUFPLEVBQUMsOEJBQThCLEVBQUUsOEJBQThCLEVBQUUsdUJBQXVCLEVBQUUsZ0NBQWdDLEVBQUMsTUFBTSxvQkFBb0IsQ0FBQTtBQUU1SixNQUFNLDBCQUEwQixHQUFHLElBQUksQ0FBQTtBQUN2QyxNQUFNLDRCQUE0QixHQUFHLENBQUMsT0FBTyxFQUFFLGFBQWEsRUFBRSxZQUFZLEVBQUUsV0FBVyxDQUFDLENBQUE7QUFDeEYsTUFBTSxxQ0FBcUMsR0FBRztJQUM1QyxVQUFVO0lBQ1YsVUFBVTtJQUNWLG1CQUFtQjtJQUNuQixrQkFBa0I7SUFDbEIsZUFBZTtJQUNmLGFBQWE7SUFDYixZQUFZO0lBQ1osZUFBZTtJQUNmLGdCQUFnQjtJQUNoQixZQUFZO0lBQ1osY0FBYztJQUNkLGVBQWU7SUFDZixlQUFlO0lBQ2YsV0FBVztDQUNaLENBQUE7QUFDRCxNQUFNLHFDQUFxQyxHQUFHLENBQUMsaUJBQWlCLEVBQUUsZ0JBQWdCLEVBQUUsV0FBVyxFQUFFLFdBQVcsRUFBRSxhQUFhLEVBQUUsVUFBVSxDQUFDLENBQUE7QUFFeEk7Ozs7R0FJRztBQUNILFNBQVMsNkJBQTZCLENBQUMsS0FBSztJQUMxQyxPQUFPLEtBQUssS0FBSyxJQUFJLElBQUksQ0FBQyxPQUFPLEtBQUssS0FBSyxRQUFRLElBQUksTUFBTSxD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QUF1QixDQUFDLGVBQWUsRUFBRSxPQUFPLENBQUMsQ0FBQyxDQUFBO1lBQzNELENBQUM7U0FDRixDQUFDLENBQUE7SUFDSixDQUFDO0NBQ0YiLCJzb3VyY2VzQ29udGVudCI6WyIvLyBAdHMtY2hlY2tcblxuaW1wb3J0IHRpbWVvdXQgZnJvbSBcImF3YWl0ZXJ5L2J1aWxkL3RpbWVvdXQuanNcIlxuaW1wb3J0IGNvbmZpZ3VyYXRpb25SZXNvbHZlciBmcm9tIFwiLi4vY29uZmlndXJhdGlvbi1yZXNvbHZlci5qc1wiXG5pbXBvcnQgaXNQbGFpbk9iamVjdCBmcm9tIFwiLi4vdXRpbHMvcGxhaW4tb2JqZWN0LmpzXCJcbmltcG9ydCBCYWNrZ3JvdW5kSm9ic1NvY2tldFJlcXVlc3QgZnJvbSBcIi4vc29ja2V0LXJlcXVlc3QuanNcIlxuaW1wb3J0IHsgREVGQVVMVF9HRU5FUkFUSU9OX0hBTkRTSEFLRV9USU1FT1VUX01TLCB2YWxpZGF0ZUdlbmVyYXRpb25IYW5kc2hha2VUaW1lb3V0TXMgfSBmcm9tIFwiLi9nZW5lcmF0aW9uLWhhbmRzaGFrZS10aW1lb3V0LWVycm9yLmpzXCJcbmltcG9ydCB7QkFDS0dST1VORF9KT0JfQUNUSVZFX1NUQVRVU0VTLCBCQUNLR1JPVU5EX0pPQl9FWEVDVVRJT05fTU9ERVMsIEJBQ0tHUk9VTkRfSk9CX1NUQVRVU0VTLCBCQUNLR1JPVU5EX0pPQl9URVJNSU5BTF9TVEFUVVNFU30gZnJvbSBcIi4vam9iLXNlbWFudGljcy5qc1wiXG5cbmNvbnN0IERFRkFVTFRfRU5RVUVVRV9USU1FT1VUX01TID0gNTAwMFxuY29uc3QgQkFDS0dST1VORF9KT0JfV0FLRV9PVVRDT01FUyA9IFtcIndva2VuXCIsIFwiYWxyZWFkeV9kdWVcIiwgXCJoYW5kZWRfb2ZmXCIsIFwibm90X2ZvdW5kXCJdXG5jb25zdCBCQUNLR1JPVU5EX0pPQl9OVUxMQUJMRV9OVU1CRVJfRklFTERTID0gW1xuICBcImF0dGVtcHRzXCIsXG4gIFwiY2hpbGRQaWRcIixcbiAgXCJjaGlsZFJlY2VpdmVkQXRNc1wiLFxuICBcImNoaWxkU3RhcnRlZEF0TXNcIixcbiAgXCJjb21wbGV0ZWRBdE1zXCIsXG4gIFwiY3JlYXRlZEF0TXNcIixcbiAgXCJmYWlsZWRBdE1zXCIsXG4gIFwiaGFuZGVkT2ZmQXRNc1wiLFxuICBcIm1heENvbmN1cnJlbmN5XCIsXG4gIFwibWF4UmV0cmllc1wiLFxuICBcIm9ycGhhbmVkQXRNc1wiLFxuICBcInNjaGVkdWxlT3JkZXJcIixcbiAgXCJzY2hlZHVsZWRBdE1zXCIsXG4gIFwidGltZW91dE1zXCJcbl1cbmNvbnN0IEJBQ0tHUk9VTkRfSk9CX05VTExBQkxFX1NUUklOR19GSUVMRFMgPSBbXCJjaGlsZEluc3RhbmNlSWRcIiwgXCJjb25jdXJyZW5jeUtleVwiLCBcImhhbmRvZmZJZFwiLCBcImxhc3RFcnJvclwiLCBcInNjaGVkdWxlS2V5XCIsIFwid29ya2VySWRcIl1cblxuLyoqXG4gKiBDaGVja3MgYSByZXF1aXJlZCBudWxsYWJsZSBudW1iZXIgZnJvbSBhIG5vcm1hbGl6ZWQgd2lyZSByb3cuXG4gKiBAcGFyYW0ge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSB2YWx1ZSAtIEZpZWxkIHZhbHVlLlxuICogQHJldHVybnMge2Jvb2xlYW59IC0gV2hldGhlciB0aGUgZmllbGQgaXMgbnVsbCBvciBhIGZpbml0ZSBudW1iZXIuXG4gKi9cbmZ1bmN0aW9uIGlzTnVsbGFibGVCYWNrZ3JvdW5kSm9iTnVtYmVyKHZhbHVlKSB7XG4gIHJldHVybiB2YWx1ZSA9PT0gbnVsbCB8fCAodHlwZW9mIHZhbHVlID09PSBcIm51bWJlclwiICYmIE51bWJlci5pc0Zpbml0ZSh2YWx1ZSkpXG59XG5cbi8qKlxuICogQ2hlY2tzIGEgcmVxdWlyZWQgbnVsbGFibGUgc3RyaW5nIGZyb20gYSBub3JtYWxpemVkIHdpcmUgcm93LlxuICogQHBhcmFtIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gdmFsdWUgLSBGaWVsZCB2YWx1ZS5cbiAqIEByZXR1cm5zIHtib29sZWFufSAtIFdoZXRoZXIgdGhlIGZpZWxkIGlzIG51bGwgb3IgYSBzdHJpbmcuXG4gKi9cbmZ1bmN0aW9uIGlzTnVsbGFibGVCYWNrZ3JvdW5kSm9iU3RyaW5nKHZhbHVlKSB7XG4gIHJldHVybiB2YWx1ZSA9PT0gbnVsbCB8fCB0eXBlb2YgdmFsdWUgPT09IFwic3RyaW5nXCJcbn1cblxuLyoqXG4gKiBDaGVja3MgdGhhdCBhIHRyYW5zcG9ydCBqb2IgdXNlcyB0aGUgbm9ybWFsaXplZCBwdWJsaWMgY2FtZWwtY2FzZSBzaGFwZS5cbiAqIEBwYXJhbSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59IHZhbHVlIC0gVHJhbnNwb3J0IHZhbHVlLlxuICogQHJldHVybnMge3ZhbHVlIGlzIGltcG9ydChcIi4vdHlwZXMuanNcIikuQmFja2dyb3VuZEpvYlJvd30gLSBXaGV0aGVyIG5vcm1hbGl6ZWQuXG4gKi9cbmZ1bmN0aW9uIGlzTm9ybWFsaXplZEJhY2tncm91bmRKb2IodmFsdWUpIHtcbiAgaWYgKCFpc1BsYWluT2JqZWN0KHZhbHVlKSkgcmV0dXJuIGZhbHNlXG5cbiAgY29uc3Qgam9iID0gdmFsdWVcblxuICByZXR1cm4gdHlwZW9mIGpvYi5pZCA9PT0gXCJzdHJpbmdcIlxuICAgICYmIHR5cGVvZiBqb2Iuam9iTmFtZSA9PT0gXCJzdHJpbmdcIlxuICAgICYmIEFycmF5LmlzQXJyYXkoam9iLmFyZ3MpXG4gICAgJiYgQkFDS0dST1VORF9KT0JfRVhFQ1VUSU9OX01PREVTLnNvbWUoKGV4ZWN1dGlvbk1vZGUpID0+IGV4ZWN1dGlvbk1vZGUgPT09IGpvYi5leGVjdXRpb25Nb2RlKVxuICAgICYmIHR5cGVvZiBqb2IucXVldWUgPT09IFwic3RyaW5nXCJcbiAgICAmJiBCQUNLR1JPVU5EX0pPQl9TVEFUVVNFUy5zb21lKChzdGF0dXMpID0+IHN0YXR1cyA9PT0gam9iLnN0YXR1cylcbiAgICAmJiBCQUNLR1JPVU5EX0pPQl9OVUxMQUJMRV9OVU1CRVJfRklFTERTLmV2ZXJ5KChmaWVsZCkgPT4gaXNOdWxsYWJsZUJhY2tncm91bmRKb2JOdW1iZXIoam9iW2ZpZWxkXSkpXG4gICAgJiYgQkFDS0dST1VORF9KT0JfTlVMTEFCTEVfU1RSSU5HX0ZJRUxEUy5ldmVyeSgoZmllbGQpID0+IGlzTnVsbGFibGVCYWNrZ3JvdW5kSm9iU3RyaW5nKGpvYltmaWVsZF0pKVxufVxuXG4vKipcbiAqIERlc2NyaWJlcyBhbiB1bmV4cGVjdGVkIHByb3RvY29sIHJlc3BvbnNlIHdpdGhvdXQgZWNob2luZyBpdHMgcGF5bG9hZC5cbiAqIEBwYXJhbSB7c3RyaW5nfSBvcGVyYXRpb24gLSBQdWJsaWMgb3BlcmF0aW9uIG5hbWUuXG4gKiBAcGFyYW0ge2ltcG9ydChcIi4vdHlwZXMuanNcIikuQmFja2dyb3VuZEpvYlNvY2tldE1lc3NhZ2V9IG1lc3NhZ2UgLSBSZXNwb25zZS5cbiAqIEByZXR1cm5zIHtFcnJvcn0gLSBQcm90b2NvbCBlcnJvci5cbiAqL1xuZnVuY3Rpb24gdW5leHBlY3RlZFJlc3BvbnNlRXJyb3Iob3BlcmF0aW9uLCBtZXNzYWdlKSB7XG4gIGNvbnN0IHJlc3BvbnNlVHlwZSA9IG1lc3NhZ2UgJiYgdHlwZW9mIG1lc3NhZ2UudHlwZSA9PT0gXCJzdHJpbmdcIiA/IG1lc3NhZ2UudHlwZSA6IFwibWlzc2luZyB0eXBlXCJcblxuICByZXR1cm4gbmV3IEVycm9yKGBVbmV4cGVjdGVkICR7b3BlcmF0aW9ufSByZXNwb25zZTogJHtyZXNwb25zZVR5cGV9YClcbn1cblxuZXhwb3J0IGRlZmF1bHQgY2xhc3MgQmFja2dyb3VuZEpvYnNDbGllbnQge1xuICAvKipcbiAgICogUnVucyBjb25zdHJ1Y3Rvci5cbiAgICogQHBhcmFtIHtvYmplY3R9IFthcmdzXSAtIE9wdGlvbnMuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vY29uZmlndXJhdGlvbi5qc1wiKS5kZWZhdWx0fSBbYXJncy5jb25maWd1cmF0aW9uXSAtIENvbmZpZ3VyYXRpb24uXG4gICAqIEBwYXJhbSB7bnVtYmVyfSBbYXJncy5lbnF1ZXVlVGltZW91dE1zXSAtIE1heGltdW0gdGltZSB0byB3YWl0IGZvciBhbiBlbnF1ZXVlIGFja25vd2xlZGdlbWVudCBpbiBtaWxsaXNlY29uZHMgKGRlZmF1bHQ6IDUwMDApLlxuICAgKiBAcGFyYW0ge251bWJlcn0gW2FyZ3MuZ2VuZXJhdGlvbkhhbmRzaGFrZVRpbWVvdXRNc10gLSBNYXhpbXVtIHRpbWUgdG8gd2FpdCBmb3IgZ2VuZXJhdGlvbiBhY2tub3dsZWRnZW1lbnQgKGRlZmF1bHQ6IDQwMDApLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gW2FyZ3MuZ2VuZXJhdGlvbklkXSAtIEV4cGxpY2l0IHJlbGVhc2UgZ2VuZXJhdGlvbiBpZGVudGl0eS5cbiAgICovXG4gIGNvbnN0cnVjdG9yKHtjb25maWd1cmF0aW9uLCBlbnF1ZXVlVGltZW91dE1zID0gREVGQVVMVF9FTlFVRVVFX1RJTUVPVVRfTVMsIGdlbmVyYXRpb25IYW5kc2hha2VUaW1lb3V0TXMgPSBERUZBVUxUX0dFTkVSQVRJT05fSEFORFNIQUtFX1RJTUVPVVRfTVMsIGdlbmVyYXRpb25JZH0gPSB7fSkge1xuICAgIHRoaXMuY29uZmlndXJhdGlvblByb21pc2UgPSBjb25maWd1cmF0aW9uID8gUHJvbWlzZS5yZXNvbHZlKGNvbmZpZ3VyYXRpb24pIDogY29uZmlndXJhdGlvblJlc29sdmVyKClcbiAgICB0aGlzLmVucXVldWVUaW1lb3V0TXMgPSBlbnF1ZXVlVGltZW91dE1zXG4gICAgdGhpcy5nZW5lcmF0aW9uSGFuZHNoYWtlVGltZW91dE1zID0gdmFsaWRhdGVHZW5lcmF0aW9uSGFuZHNoYWtlVGltZW91dE1zKGdlbmVyYXRpb25IYW5kc2hha2VUaW1lb3V0TXMpXG4gICAgdGhpcy5leHBsaWNpdEdlbmVyYXRpb25JZCA9IGdlbmVyYXRpb25JZFxuICB9XG5cbiAgLyoqXG4gICAqIEJ1aWxkcyBhIG9uZS1zaG90IGNsaWVudCBzb2NrZXQgcmVxdWVzdCBmcm9tIHRoZSByZXNvbHZlZCBjb25maWd1cmF0aW9uLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxCYWNrZ3JvdW5kSm9ic1NvY2tldFJlcXVlc3Q+fSAtIFNvY2tldCByZXF1ZXN0LlxuICAgKi9cbiAgYXN5bmMgX3JlcXVlc3QoKSB7XG4gICAgY29uc3QgY29uZmlndXJhdGlvbiA9IGF3YWl0IHRoaXMuY29uZmlndXJhdGlvblByb21pc2VcbiAgICBjb25zdCB7aG9zdCwgcG9ydH0gPSBjb25maWd1cmF0aW9uLmdldEJhY2tncm91bmRKb2JzQ29uZmlnKClcbiAgICBjb25zdCB7Z2VuZXJhdGlvbklkfSA9IGNvbmZpZ3VyYXRpb24ucmVzb2x2ZUJhY2tncm91bmRKb2JzR2VuZXJhdGlvbkNvbmZpZyh7XG4gICAgICBnZW5lcmF0aW9uSWQ6IHRoaXMuZXhwbGljaXRHZW5lcmF0aW9uSWQsXG4gICAgICBzb3VyY2VOYW1lOiBcIkJhY2tncm91bmRKb2JzQ2xpZW50XCJcbiAgICB9KVxuXG4gICAgcmV0dXJuIG5ldyBCYWNrZ3JvdW5kSm9ic1NvY2tldFJlcXVlc3Qoe2hvc3QsIHBvcnQsIHJvbGU6IFwiY2xpZW50XCIsIGdlbmVyYXRpb25IYW5kc2hha2VUaW1lb3V0TXM6IHRoaXMuZ2VuZXJhdGlvbkhhbmRzaGFrZVRpbWVvdXRNcywgZ2VuZXJhdGlvbklkfSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGVucXVldWUuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gT3B0aW9ucy5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGFyZ3Muam9iTmFtZSAtIEpvYiBuYW1lLlxuICAgKiBAcGFyYW0ge0FycmF5PFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gYXJncy5hcmdzIC0gSm9iIGFyZ3MuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi90eXBlcy5qc1wiKS5CYWNrZ3JvdW5kSm9iT3B0aW9uc30gW2FyZ3Mub3B0aW9uc10gLSBKb2Igb3B0aW9ucy5cbiAgICogQHBhcmFtIHtzdHJpbmd9IFthcmdzLnByb2R1Y2VySW52b2NhdGlvbklkXSAtIFN0YWJsZSBpZGVudGl0eSBmb3Igb25lIG93bmVkIGVucXVldWUgaW52b2NhdGlvbi5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL3R5cGVzLmpzXCIpLkJhY2tncm91bmRKb2JQcm9kdWNlclByb29mfSBbYXJncy5wcm9kdWNlclByb29mXSAtIEV4YWN0IGludGVybmFsIHByb2R1Y2VyIGhhbmRvZmYuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHN0cmluZz59IC0gSm9iIGlkLlxuICAgKi9cbiAgYXN5bmMgZW5xdWV1ZSh7am9iTmFtZSwgYXJncywgb3B0aW9ucywgcHJvZHVjZXJJbnZvY2F0aW9uSWQsIHByb2R1Y2VyUHJvb2Z9KSB7XG4gICAgY29uc3QgbWVzc2FnZSA9IHtcbiAgICAgIHR5cGU6IC8qKiBAdHlwZSB7Y29uc3R9ICovIChcImVucXVldWVcIiksXG4gICAgICBqb2JOYW1lLFxuICAgICAgYXJncyxcbiAgICAgIG9wdGlvbnMsXG4gICAgICAuLi4ocHJvZHVjZXJJbnZvY2F0aW9uSWQgPyB7cHJvZHVjZXJJbnZvY2F0aW9uSWR9IDoge30pLFxuICAgICAgLi4uKHByb2R1Y2VyUHJvb2YgPyB7cHJvZHVjZXJQcm9vZn0gOiB7fSlcbiAgICB9XG4gICAgY29uc3QgYWNrbm93bGVkZ2VtZW50ID0ge2V4cGxpY2l0bHlSZWplY3RlZDogZmFsc2UsIGdlbmVyYXRpb25GZW5jZWQ6IGZhbHNlLCByZXF1ZXN0U2VudDogZmFsc2V9XG4gICAgLyoqXG4gICAgICogU2VuZHMgb25lIGVucXVldWUgYXR0ZW1wdC4gQW4gb3duZWQgY2FsbGVyIG1heSByZXBsYXkgdGhpcyBleGFjdCBtZXNzYWdlXG4gICAgICogb25jZSB3aGVuIHRyYW5zcG9ydCBhY2tub3dsZWRnZW1lbnQgcmVtYWlucyBhbWJpZ3VvdXMgYWZ0ZXIgc2VuZC5cbiAgICAgKiBAcGFyYW0ge3tleHBsaWNpdGx5UmVqZWN0ZWQ6IGJvb2xlYW4sIGdlbmVyYXRpb25GZW5jZWQ6IGJvb2xlYW4sIHJlcXVlc3RTZW50OiBib29sZWFufSB8IHVuZGVmaW5lZH0gYXR0ZW1wdEFja25vd2xlZGdlbWVudCAtIEZpcnN0LWF0dGVtcHQgb2JzZXJ2YXRpb25zLlxuICAgICAqIEByZXR1cm5zIHtQcm9taXNlPHN0cmluZz59IC0gSm9iIGlkLlxuICAgICAqL1xuICAgIGNvbnN0IGVucXVldWVBdHRlbXB0ID0gYXN5bmMgKGF0dGVtcHRBY2tub3dsZWRnZW1lbnQpID0+IHtcbiAgICAgIGNvbnN0IHJlcXVlc3QgPSBhd2FpdCB0aGlzLl9yZXF1ZXN0KClcbiAgICAgIGNvbnN0IHJlcXVlc3RBYm9ydENvbnRyb2xsZXIgPSBuZXcgQWJvcnRDb250cm9sbGVyKClcbiAgICAgIGNvbnN0IHRpbWVvdXRFcnJvck1lc3NhZ2UgPSBgQmFja2dyb3VuZCBqb2IgZW5xdWV1ZSBhY2tub3dsZWRnZW1lbnQgdGltZWQgb3V0IGFmdGVyICR7dGhpcy5lbnF1ZXVlVGltZW91dE1zfW1zYFxuICAgICAgLyoqXG4gICAgICAgKiBSZXNvbHZlcyB0aGUgcHJlLXNlbmQgcGhhc2Ugd2hlbiB0aGUgbXV0YXRpb24gaGFzIGVudGVyZWQgdGhlIHNvY2tldC5cbiAgICAgICAqIEB0eXBlIHsoKSA9PiB2b2lkfVxuICAgICAgICovXG4gICAgICBsZXQgbWFya1JlcXVlc3RTZW50ID0gKCkgPT4ge31cbiAgICAgIGNvbnN0IHJlcXVlc3RTZW50ID0gbmV3IFByb21pc2UoKHJlc29sdmUpID0+IHtcbiAgICAgICAgbWFya1JlcXVlc3RTZW50ID0gKCkgPT4gcmVzb2x2ZSh1bmRlZmluZWQpXG4gICAgICB9KVxuICAgICAgLyoqXG4gICAgICAgKiBBcHBsaWVzIHRoZSBjb25maWd1cmVkIGRlYWRsaW5lIGluZGVwZW5kZW50bHkgdG8gb25lIHJlcXVlc3QgcGhhc2UuXG4gICAgICAgKiBAdGVtcGxhdGUgVFxuICAgICAgICogQHBhcmFtIHsoKSA9PiBQcm9taXNlPFQ+fSBjYWxsYmFjayAtIFBoYXNlIHdvcmsuXG4gICAgICAgKiBAcmV0dXJucyB7UHJvbWlzZTxUPn0gLSBQaGFzZSByZXN1bHQuXG4gICAgICAgKi9cbiAgICAgIGNvbnN0IHdpdGhFbnF1ZXVlVGltZW91dCA9IGFzeW5jIChjYWxsYmFjaykgPT4gYXdhaXQgdGltZW91dCh7XG4gICAgICAgIGVycm9yTWVzc2FnZTogdGltZW91dEVycm9yTWVzc2FnZSxcbiAgICAgICAgdGltZW91dDogdGhpcy5lbnF1ZXVlVGltZW91dE1zXG4gICAgICB9LCBhc3luYyAoe2NvbnRyb2x9KSA9PiB7XG4gICAgICAgIGNvbnN0IGFib3J0UmVxdWVzdCA9ICgpID0+IHJlcXVlc3RBYm9ydENvbnRyb2xsZXIuYWJvcnQoY29udHJvbC5zaWduYWwucmVhc29uKVxuXG4gICAgICAgIGNvbnRyb2wuc2lnbmFsLmFkZEV2ZW50TGlzdGVuZXIoXCJhYm9ydFwiLCBhYm9ydFJlcXVlc3QpXG4gICAgICAgIHRyeSB7XG4gICAgICAgICAgcmV0dXJuIGF3YWl0IGNhbGxiYWNrKClcbiAgICAgICAgfSBmaW5hbGx5IHtcbiAgICAgICAgICBjb250cm9sLnNpZ25hbC5yZW1vdmVFdmVudExpc3RlbmVyKFwiYWJvcnRcIiwgYWJvcnRSZXF1ZXN0KVxuICAgICAgICB9XG4gICAgICB9KVxuICAgICAgY29uc3QgcmVxdWVzdFByb21pc2UgPSByZXF1ZXN0LnJ1bih7XG4gICAgICAgIHNpZ25hbDogcmVxdWVzdEFib3J0Q29udHJvbGxlci5zaWduYWwsXG4gICAgICAgIG9uQ29ubmVjdDogKGpzb25Tb2NrZXQpID0+IHtcbiAgICAgICAgICBqc29uU29ja2V0LnNlbmQobWVzc2FnZSlcbiAgICAgICAgICBpZiAoYXR0ZW1wdEFja25vd2xlZGdlbWVudCkge1xuICAgICAgICAgICAgYXR0ZW1wdEFja25vd2xlZGdlbWVudC5nZW5lcmF0aW9uRmVuY2VkID0gQm9vbGVhbihyZXF1ZXN0LmdlbmVyYXRpb25JZClcbiAgICAgICAgICAgIGF0dGVtcHRBY2tub3dsZWRnZW1lbnQucmVxdWVzdFNlbnQgPSB0cnVlXG4gICAgICAgICAgfVxuICAgICAgICAgIG1hcmtSZXF1ZXN0U2VudCgpXG4gICAgICAgIH0sXG4gICAgICAgIG9uTWVzc2FnZTogKHttZXNzYWdlLCByZXNvbHZlLCByZWplY3R9KSA9PiB7XG4gICAgICAgICAgaWYgKG1lc3NhZ2U/LnR5cGUgPT09IFwiZW5xdWV1ZWRcIikge1xuICAgICAgICAgICAgcmVzb2x2ZShtZXNzYWdlLmpvYklkKVxuICAgICAgICAgICAgcmV0dXJuXG4gICAgICAgICAgfVxuXG4gICAgICAgICAgaWYgKG1lc3NhZ2U/LnR5cGUgPT09IFwiZW5xdWV1ZS1lcnJvclwiKSB7XG4gICAgICAgICAgICBpZiAoYXR0ZW1wdEFja25vd2xlZGdlbWVudCkgYXR0ZW1wdEFja25vd2xlZGdlbWVudC5leHBsaWNpdGx5UmVqZWN0ZWQgPSB0cnVlXG4gICAgICAgICAgICByZWplY3QobmV3IEVycm9yKG1lc3NhZ2UuZXJyb3IgfHwgXCJGYWlsZWQgdG8gZW5xdWV1ZSBqb2JcIikpXG4gICAgICAgICAgfVxuICAgICAgICB9XG4gICAgICB9KVxuXG4gICAgICBhd2FpdCB3aXRoRW5xdWV1ZVRpbWVvdXQoYXN5bmMgKCkgPT4gYXdhaXQgUHJvbWlzZS5yYWNlKFtyZXF1ZXN0U2VudCwgcmVxdWVzdFByb21pc2VdKSlcblxuICAgICAgcmV0dXJuIGF3YWl0IHdpdGhFbnF1ZXVlVGltZW91dChhc3luYyAoKSA9PiBhd2FpdCByZXF1ZXN0UHJvbWlzZSlcbiAgICB9XG5cbiAgICB0cnkge1xuICAgICAgcmV0dXJuIGF3YWl0IGVucXVldWVBdHRlbXB0KGFja25vd2xlZGdlbWVudClcbiAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgaWYgKCFwcm9kdWNlckludm9jYXRpb25JZCB8fCAhcHJvZHVjZXJQcm9vZiB8fCAhYWNrbm93bGVkZ2VtZW50LmdlbmVyYXRpb25GZW5jZWQgfHwgIWFja25vd2xlZGdlbWVudC5yZXF1ZXN0U2VudCB8fCBhY2tub3dsZWRnZW1lbnQuZXhwbGljaXRseVJlamVjdGVkKSB0aHJvdyBlcnJvclxuICAgIH1cblxuICAgIHJldHVybiBhd2FpdCBlbnF1ZXVlQXR0ZW1wdCh1bmRlZmluZWQpXG4gIH1cblxuICAvKipcbiAgICogQXRvbWljYWxseSByZXBsYWNlcyB0aGUgcXVldWVkIG93bmVyIG9mIGEgc3RhYmxlIHNjaGVkdWxlIGtleS5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBPcHRpb25zLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gYXJncy5zY2hlZHVsZUtleSAtIFN0YWJsZSBsb2dpY2FsIHNjaGVkdWxlIGtleS5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGFyZ3Muam9iTmFtZSAtIEpvYiBuYW1lLlxuICAgKiBAcGFyYW0ge0FycmF5PFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gYXJncy5hcmdzIC0gSm9iIGFyZ3MuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi90eXBlcy5qc1wiKS5CYWNrZ3JvdW5kSm9iT3B0aW9uc30gW2FyZ3Mub3B0aW9uc10gLSBKb2Igb3B0aW9ucy5cbiAgICogQHJldHVybnMge1Byb21pc2U8aW1wb3J0KFwiLi90eXBlcy5qc1wiKS5CYWNrZ3JvdW5kSm9iUmVwbGFjZW1lbnRSZXN1bHQ+fSAtIFJlcGxhY2VtZW50IHJlc3VsdC5cbiAgICovXG4gIGFzeW5jIHJlcGxhY2VTY2hlZHVsZWQoe3NjaGVkdWxlS2V5LCBqb2JOYW1lLCBhcmdzLCBvcHRpb25zfSkge1xuICAgIGNvbnN0IHJlcXVlc3QgPSBhd2FpdCB0aGlzLl9yZXF1ZXN0KClcblxuICAgIHJldHVybiBhd2FpdCByZXF1ZXN0LnJ1bih7XG4gICAgICBvbkNvbm5lY3Q6IChqc29uU29ja2V0KSA9PiB7XG4gICAgICAgIGpzb25Tb2NrZXQuc2VuZCh7dHlwZTogXCJyZXBsYWNlLXNjaGVkdWxlZFwiLCBzY2hlZHVsZUtleSwgam9iTmFtZSwgYXJncywgb3B0aW9uc30pXG4gICAgICB9LFxuICAgICAgb25NZXNzYWdlOiAoe21lc3NhZ2UsIHJlc29sdmUsIHJlamVjdH0pID0+IHtcbiAgICAgICAgaWYgKG1lc3NhZ2U/LnR5cGUgPT09IFwic2NoZWR1bGUtcmVwbGFjZWRcIikge1xuICAgICAgICAgIHJlc29sdmUoe1xuICAgICAgICAgICAgam9iSWQ6IG1lc3NhZ2Uuam9iSWQsXG4gICAgICAgICAgICBwcmV2aW91c0pvYklkOiBtZXNzYWdlLnByZXZpb3VzSm9iSWQsXG4gICAgICAgICAgICBwcmV2aW91c1N0YXR1czogbWVzc2FnZS5wcmV2aW91c1N0YXR1c1xuICAgICAgICAgIH0pXG4gICAgICAgICAgcmV0dXJuXG4gICAgICAgIH1cblxuICAgICAgICBpZiAobWVzc2FnZT8udHlwZSA9PT0gXCJyZXBsYWNlLXNjaGVkdWxlZC1lcnJvclwiKSB7XG4gICAgICAgICAgcmVqZWN0KG5ldyBFcnJvcihtZXNzYWdlLmVycm9yIHx8IFwiRmFpbGVkIHRvIHJlcGxhY2Ugc2NoZWR1bGVkIGpvYlwiKSlcbiAgICAgICAgfVxuICAgICAgfVxuICAgIH0pXG4gIH1cblxuICAvKipcbiAgICogQ2FuY2VscyBvciBkZXRhY2hlcyB0aGUgY3VycmVudCBvd25lciBvZiBhIHN0YWJsZSBzY2hlZHVsZSBrZXkuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gT3B0aW9ucy5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGFyZ3Muc2NoZWR1bGVLZXkgLSBTdGFibGUgbG9naWNhbCBzY2hlZHVsZSBrZXkuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPGltcG9ydChcIi4vdHlwZXMuanNcIikuQmFja2dyb3VuZEpvYkNhbmNlbGxhdGlvblJlc3VsdD59IC0gQ2FuY2VsbGF0aW9uIHJlc3VsdC5cbiAgICovXG4gIGFzeW5jIGNhbmNlbFNjaGVkdWxlZCh7c2NoZWR1bGVLZXl9KSB7XG4gICAgY29uc3QgcmVxdWVzdCA9IGF3YWl0IHRoaXMuX3JlcXVlc3QoKVxuXG4gICAgcmV0dXJuIGF3YWl0IHJlcXVlc3QucnVuKHtcbiAgICAgIG9uQ29ubmVjdDogKGpzb25Tb2NrZXQpID0+IHtcbiAgICAgICAganNvblNvY2tldC5zZW5kKHt0eXBlOiBcImNhbmNlbC1zY2hlZHVsZWRcIiwgc2NoZWR1bGVLZXl9KVxuICAgICAgfSxcbiAgICAgIG9uTWVzc2FnZTogKHttZXNzYWdlLCByZXNvbHZlLCByZWplY3R9KSA9PiB7XG4gICAgICAgIGlmIChtZXNzYWdlPy50eXBlID09PSBcInNjaGVkdWxlLWNhbmNlbGxlZFwiKSB7XG4gICAgICAgICAgcmVzb2x2ZSh7am9iSWQ6IG1lc3NhZ2Uuam9iSWQsIG91dGNvbWU6IG1lc3NhZ2Uub3V0Y29tZX0pXG4gICAgICAgICAgcmV0dXJuXG4gICAgICAgIH1cblxuICAgICAgICBpZiAobWVzc2FnZT8udHlwZSA9PT0gXCJjYW5jZWwtc2NoZWR1bGVkLWVycm9yXCIpIHtcbiAgICAgICAgICByZWplY3QobmV3IEVycm9yKG1lc3NhZ2UuZXJyb3IgfHwgXCJGYWlsZWQgdG8gY2FuY2VsIHNjaGVkdWxlZCBqb2JcIikpXG4gICAgICAgIH1cbiAgICAgIH1cbiAgICB9KVxuICB9XG5cbiAgLyoqXG4gICAqIFJlYWRzIGN1cnJlbnQgc3RhYmxlIG93bmVyc2hpcCBhbmQgb3B0aW9uYWwgdGVybWluYWwgaGlzdG9yeS5cbiAgICogQHBhcmFtIHt7c2NoZWR1bGVLZXk6IHN0cmluZywgaW5jbHVkZUxhdGVzdFRlcm1pbmFsPzogYm9vbGVhbn19IGFyZ3MgLSBMb29rdXAgcmVxdWVzdC5cbiAgICogQHJldHVybnMge1Byb21pc2U8aW1wb3J0KFwiLi90eXBlcy5qc1wiKS5CYWNrZ3JvdW5kSm9iU2NoZWR1bGVkTG9va3VwUmVzdWx0Pn0gLSBOb3JtYWxpemVkIHN0YWJsZSBzY2hlZHVsZSBqb2JzLlxuICAgKi9cbiAgYXN5bmMgZ2V0U2NoZWR1bGVkSm9iKHtzY2hlZHVsZUtleSwgaW5jbHVkZUxhdGVzdFRlcm1pbmFsfSkge1xuICAgIGNvbnN0IHJlcXVlc3QgPSBhd2FpdCB0aGlzLl9yZXF1ZXN0KClcblxuICAgIHJldHVybiBhd2FpdCByZXF1ZXN0LnJ1bih7XG4gICAgICBvbkNvbm5lY3Q6IChqc29uU29ja2V0KSA9PiB7XG4gICAgICAgIGpzb25Tb2NrZXQuc2VuZCh7dHlwZTogXCJnZXQtc2NoZWR1bGVkLWpvYlwiLCBzY2hlZHVsZUtleSwgaW5jbHVkZUxhdGVzdFRlcm1pbmFsfSlcbiAgICAgIH0sXG4gICAgICBvbk1lc3NhZ2U6ICh7bWVzc2FnZSwgcmVzb2x2ZSwgcmVqZWN0fSkgPT4ge1xuICAgICAgICBpZiAobWVzc2FnZT8udHlwZSA9PT0gXCJzY2hlZHVsZWQtam9iXCIpIHtcbiAgICAgICAgICBjb25zdCB7Y3VycmVudEpvYiwgbGF0ZXN0VGVybWluYWxKb2J9ID0gbWVzc2FnZVxuICAgICAgICAgIGNvbnN0IGN1cnJlbnRKb2JWYWxpZCA9IGN1cnJlbnRKb2IgPT09IG51bGxcbiAgICAgICAgICAgIHx8IChpc05vcm1hbGl6ZWRCYWNrZ3JvdW5kSm9iKGN1cnJlbnRKb2IpICYmIEJBQ0tHUk9VTkRfSk9CX0FDVElWRV9TVEFUVVNFUy5zb21lKChzdGF0dXMpID0+IHN0YXR1cyA9PT0gY3VycmVudEpvYi5zdGF0dXMpKVxuICAgICAgICAgIGNvbnN0IGxhdGVzdFRlcm1pbmFsSm9iVmFsaWQgPSBsYXRlc3RUZXJtaW5hbEpvYiA9PT0gbnVsbFxuICAgICAgICAgICAgfHwgKGlzTm9ybWFsaXplZEJhY2tncm91bmRKb2IobGF0ZXN0VGVybWluYWxKb2IpICYmIEJBQ0tHUk9VTkRfSk9CX1RFUk1JTkFMX1NUQVRVU0VTLnNvbWUoKHN0YXR1cykgPT4gc3RhdHVzID09PSBsYXRlc3RUZXJtaW5hbEpvYi5zdGF0dXMpKVxuXG4gICAgICAgICAgaWYgKCFjdXJyZW50Sm9iVmFsaWQgfHwgIWxhdGVzdFRlcm1pbmFsSm9iVmFsaWQpIHtcbiAgICAgICAgICAgIHJlamVjdChuZXcgRXJyb3IoXCJJbnZhbGlkIGdldFNjaGVkdWxlZEpvYiByZXNwb25zZTogZXhwZWN0ZWQgbm9ybWFsaXplZCBwdWJsaWMgam9iIHZhbHVlc1wiKSlcbiAgICAgICAgICAgIHJldHVyblxuICAgICAgICAgIH1cblxuICAgICAgICAgIHJlc29sdmUoe2N1cnJlbnRKb2IsIGxhdGVzdFRlcm1pbmFsSm9ifSlcbiAgICAgICAgICByZXR1cm5cbiAgICAgICAgfVxuXG4gICAgICAgIGlmIChtZXNzYWdlPy50eXBlID09PSBcImdldC1zY2hlZHVsZWQtam9iLWVycm9yXCIpIHtcbiAgICAgICAgICByZWplY3QobmV3IEVycm9yKG1lc3NhZ2UuZXJyb3IgfHwgXCJGYWlsZWQgdG8gcmVhZCBzY2hlZHVsZWQgam9iXCIpKVxuICAgICAgICAgIHJldHVyblxuICAgICAgICB9XG5cbiAgICAgICAgcmVqZWN0KHVuZXhwZWN0ZWRSZXNwb25zZUVycm9yKFwiZ2V0U2NoZWR1bGVkSm9iXCIsIG1lc3NhZ2UpKVxuICAgICAgfVxuICAgIH0pXG4gIH1cblxuICAvKipcbiAgICogRXhwZWRpdGVzIGEgZnV0dXJlIHF1ZXVlZCBzdGFibGUgb3duZXIgd2l0aG91dCBjaGFuZ2luZyBqb2IgaWRlbnRpdHkuXG4gICAqIEBwYXJhbSB7e3NjaGVkdWxlS2V5OiBzdHJpbmd9fSBhcmdzIC0gV2FrZSByZXF1ZXN0LlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxpbXBvcnQoXCIuL3R5cGVzLmpzXCIpLkJhY2tncm91bmRKb2JXYWtlUmVzdWx0Pn0gLSBXYWtlIHJlc3VsdC5cbiAgICovXG4gIGFzeW5jIHdha2VTY2hlZHVsZWQoe3NjaGVkdWxlS2V5fSkge1xuICAgIGNvbnN0IHJlcXVlc3QgPSBhd2FpdCB0aGlzLl9yZXF1ZXN0KClcblxuICAgIHJldHVybiBhd2FpdCByZXF1ZXN0LnJ1bih7XG4gICAgICBvbkNvbm5lY3Q6IChqc29uU29ja2V0KSA9PiB7XG4gICAgICAgIGpzb25Tb2NrZXQuc2VuZCh7dHlwZTogXCJ3YWtlLXNjaGVkdWxlZFwiLCBzY2hlZHVsZUtleX0pXG4gICAgICB9LFxuICAgICAgb25NZXNzYWdlOiAoe21lc3NhZ2UsIHJlc29sdmUsIHJlamVjdH0pID0+IHtcbiAgICAgICAgaWYgKG1lc3NhZ2U/LnR5cGUgPT09IFwic2NoZWR1bGUtd29rZW5cIikge1xuICAgICAgICAgIGNvbnN0IG91dGNvbWUgPSBtZXNzYWdlLm91dGNvbWVcbiAgICAgICAgICBjb25zdCBrbm93bk91dGNvbWUgPSBCQUNLR1JPVU5EX0pPQl9XQUtFX09VVENPTUVTLmluY2x1ZGVzKG91dGNvbWUpXG4gICAgICAgICAgY29uc3QgdmFsaWRKb2JJZCA9IG91dGNvbWUgPT09IFwibm90X2ZvdW5kXCIgPyBtZXNzYWdlLmpvYklkID09PSBudWxsIDogdHlwZW9mIG1lc3NhZ2Uuam9iSWQgPT09IFwic3RyaW5nXCIgJiYgbWVzc2FnZS5qb2JJZC5sZW5ndGggPiAwXG5cbiAgICAgICAgICBpZiAoIWtub3duT3V0Y29tZSB8fCAhdmFsaWRKb2JJZCkge1xuICAgICAgICAgICAgcmVqZWN0KG5ldyBFcnJvcihcIkludmFsaWQgd2FrZVNjaGVkdWxlZCByZXNwb25zZVwiKSlcbiAgICAgICAgICAgIHJldHVyblxuICAgICAgICAgIH1cblxuICAgICAgICAgIHJlc29sdmUoe2pvYklkOiBtZXNzYWdlLmpvYklkLCBvdXRjb21lfSlcbiAgICAgICAgICByZXR1cm5cbiAgICAgICAgfVxuXG4gICAgICAgIGlmIChtZXNzYWdlPy50eXBlID09PSBcIndha2Utc2NoZWR1bGVkLWVycm9yXCIpIHtcbiAgICAgICAgICByZWplY3QobmV3IEVycm9yKG1lc3NhZ2UuZXJyb3IgfHwgXCJGYWlsZWQgdG8gd2FrZSBzY2hlZHVsZWQgam9iXCIpKVxuICAgICAgICAgIHJldHVyblxuICAgICAgICB9XG5cbiAgICAgICAgcmVqZWN0KHVuZXhwZWN0ZWRSZXNwb25zZUVycm9yKFwid2FrZVNjaGVkdWxlZFwiLCBtZXNzYWdlKSlcbiAgICAgIH1cbiAgICB9KVxuICB9XG59XG4iXX0=