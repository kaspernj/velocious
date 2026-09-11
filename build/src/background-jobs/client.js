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
            return await timeout({
                errorMessage: `Background job enqueue acknowledgement timed out after ${this.enqueueTimeoutMs}ms`,
                timeout: this.enqueueTimeoutMs
            }, async ({ control }) => await request.run({
                signal: control.signal,
                onConnect: (jsonSocket) => {
                    jsonSocket.send(message);
                    if (attemptAcknowledgement) {
                        attemptAcknowledgement.generationFenced = Boolean(request.generationId);
                        attemptAcknowledgement.requestSent = true;
                    }
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
            }));
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiY2xpZW50LmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiLi4vLi4vLi4vc3JjL2JhY2tncm91bmQtam9icy9jbGllbnQuanMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6IkFBQUEsWUFBWTtBQUVaLE9BQU8sT0FBTyxNQUFNLDJCQUEyQixDQUFBO0FBQy9DLE9BQU8scUJBQXFCLE1BQU0sOEJBQThCLENBQUE7QUFDaEUsT0FBTyxhQUFhLE1BQU0sMEJBQTBCLENBQUE7QUFDcEQsT0FBTywyQkFBMkIsTUFBTSxxQkFBcUIsQ0FBQTtBQUM3RCxPQUFPLEVBQUUsdUNBQXVDLEVBQUUsb0NBQW9DLEVBQUUsTUFBTSx5Q0FBeUMsQ0FBQTtBQUN2SSxPQUFPLEVBQUMsOEJBQThCLEVBQUUsOEJBQThCLEVBQUUsdUJBQXVCLEVBQUUsZ0NBQWdDLEVBQUMsTUFBTSxvQkFBb0IsQ0FBQTtBQUU1SixNQUFNLDBCQUEwQixHQUFHLElBQUksQ0FBQTtBQUN2QyxNQUFNLDRCQUE0QixHQUFHLENBQUMsT0FBTyxFQUFFLGFBQWEsRUFBRSxZQUFZLEVBQUUsV0FBVyxDQUFDLENBQUE7QUFDeEYsTUFBTSxxQ0FBcUMsR0FBRztJQUM1QyxVQUFVO0lBQ1YsVUFBVTtJQUNWLG1CQUFtQjtJQUNuQixrQkFBa0I7SUFDbEIsZUFBZTtJQUNmLGFBQWE7SUFDYixZQUFZO0lBQ1osZUFBZTtJQUNmLGdCQUFnQjtJQUNoQixZQUFZO0lBQ1osY0FBYztJQUNkLGVBQWU7SUFDZixlQUFlO0lBQ2YsV0FBVztDQUNaLENBQUE7QUFDRCxNQUFNLHFDQUFxQyxHQUFHLENBQUMsaUJBQWlCLEVBQUUsZ0JBQWdCLEVBQUUsV0FBVyxFQUFFLFdBQVcsRUFBRSxhQUFhLEVBQUUsVUFBVSxDQUFDLENBQUE7QUFFeEk7Ozs7R0FJRztBQUNILFNBQVMsNkJBQTZCLENBQUMsS0FBSztJQUMxQyxPQUFPLEtBQUssS0FBSyxJQUFJLElBQUksQ0FBQyxPQUFPLEtBQUssS0FBSyxRQUFRLElBQUksTUFBTSxD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Q0FBQTtvQkFDbEUsT0FBTTtnQkFDUixDQUFDO2dCQUVELE1BQU0sQ0FBQyx1QkFBdUIsQ0FBQyxlQUFlLEVBQUUsT0FBTyxDQUFDLENBQUMsQ0FBQTtZQUMzRCxDQUFDO1NBQ0YsQ0FBQyxDQUFBO0lBQ0osQ0FBQztDQUNGIiwic291cmNlc0NvbnRlbnQiOlsiLy8gQHRzLWNoZWNrXG5cbmltcG9ydCB0aW1lb3V0IGZyb20gXCJhd2FpdGVyeS9idWlsZC90aW1lb3V0LmpzXCJcbmltcG9ydCBjb25maWd1cmF0aW9uUmVzb2x2ZXIgZnJvbSBcIi4uL2NvbmZpZ3VyYXRpb24tcmVzb2x2ZXIuanNcIlxuaW1wb3J0IGlzUGxhaW5PYmplY3QgZnJvbSBcIi4uL3V0aWxzL3BsYWluLW9iamVjdC5qc1wiXG5pbXBvcnQgQmFja2dyb3VuZEpvYnNTb2NrZXRSZXF1ZXN0IGZyb20gXCIuL3NvY2tldC1yZXF1ZXN0LmpzXCJcbmltcG9ydCB7IERFRkFVTFRfR0VORVJBVElPTl9IQU5EU0hBS0VfVElNRU9VVF9NUywgdmFsaWRhdGVHZW5lcmF0aW9uSGFuZHNoYWtlVGltZW91dE1zIH0gZnJvbSBcIi4vZ2VuZXJhdGlvbi1oYW5kc2hha2UtdGltZW91dC1lcnJvci5qc1wiXG5pbXBvcnQge0JBQ0tHUk9VTkRfSk9CX0FDVElWRV9TVEFUVVNFUywgQkFDS0dST1VORF9KT0JfRVhFQ1VUSU9OX01PREVTLCBCQUNLR1JPVU5EX0pPQl9TVEFUVVNFUywgQkFDS0dST1VORF9KT0JfVEVSTUlOQUxfU1RBVFVTRVN9IGZyb20gXCIuL2pvYi1zZW1hbnRpY3MuanNcIlxuXG5jb25zdCBERUZBVUxUX0VOUVVFVUVfVElNRU9VVF9NUyA9IDUwMDBcbmNvbnN0IEJBQ0tHUk9VTkRfSk9CX1dBS0VfT1VUQ09NRVMgPSBbXCJ3b2tlblwiLCBcImFscmVhZHlfZHVlXCIsIFwiaGFuZGVkX29mZlwiLCBcIm5vdF9mb3VuZFwiXVxuY29uc3QgQkFDS0dST1VORF9KT0JfTlVMTEFCTEVfTlVNQkVSX0ZJRUxEUyA9IFtcbiAgXCJhdHRlbXB0c1wiLFxuICBcImNoaWxkUGlkXCIsXG4gIFwiY2hpbGRSZWNlaXZlZEF0TXNcIixcbiAgXCJjaGlsZFN0YXJ0ZWRBdE1zXCIsXG4gIFwiY29tcGxldGVkQXRNc1wiLFxuICBcImNyZWF0ZWRBdE1zXCIsXG4gIFwiZmFpbGVkQXRNc1wiLFxuICBcImhhbmRlZE9mZkF0TXNcIixcbiAgXCJtYXhDb25jdXJyZW5jeVwiLFxuICBcIm1heFJldHJpZXNcIixcbiAgXCJvcnBoYW5lZEF0TXNcIixcbiAgXCJzY2hlZHVsZU9yZGVyXCIsXG4gIFwic2NoZWR1bGVkQXRNc1wiLFxuICBcInRpbWVvdXRNc1wiXG5dXG5jb25zdCBCQUNLR1JPVU5EX0pPQl9OVUxMQUJMRV9TVFJJTkdfRklFTERTID0gW1wiY2hpbGRJbnN0YW5jZUlkXCIsIFwiY29uY3VycmVuY3lLZXlcIiwgXCJoYW5kb2ZmSWRcIiwgXCJsYXN0RXJyb3JcIiwgXCJzY2hlZHVsZUtleVwiLCBcIndvcmtlcklkXCJdXG5cbi8qKlxuICogQ2hlY2tzIGEgcmVxdWlyZWQgbnVsbGFibGUgbnVtYmVyIGZyb20gYSBub3JtYWxpemVkIHdpcmUgcm93LlxuICogQHBhcmFtIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gdmFsdWUgLSBGaWVsZCB2YWx1ZS5cbiAqIEByZXR1cm5zIHtib29sZWFufSAtIFdoZXRoZXIgdGhlIGZpZWxkIGlzIG51bGwgb3IgYSBmaW5pdGUgbnVtYmVyLlxuICovXG5mdW5jdGlvbiBpc051bGxhYmxlQmFja2dyb3VuZEpvYk51bWJlcih2YWx1ZSkge1xuICByZXR1cm4gdmFsdWUgPT09IG51bGwgfHwgKHR5cGVvZiB2YWx1ZSA9PT0gXCJudW1iZXJcIiAmJiBOdW1iZXIuaXNGaW5pdGUodmFsdWUpKVxufVxuXG4vKipcbiAqIENoZWNrcyBhIHJlcXVpcmVkIG51bGxhYmxlIHN0cmluZyBmcm9tIGEgbm9ybWFsaXplZCB3aXJlIHJvdy5cbiAqIEBwYXJhbSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59IHZhbHVlIC0gRmllbGQgdmFsdWUuXG4gKiBAcmV0dXJucyB7Ym9vbGVhbn0gLSBXaGV0aGVyIHRoZSBmaWVsZCBpcyBudWxsIG9yIGEgc3RyaW5nLlxuICovXG5mdW5jdGlvbiBpc051bGxhYmxlQmFja2dyb3VuZEpvYlN0cmluZyh2YWx1ZSkge1xuICByZXR1cm4gdmFsdWUgPT09IG51bGwgfHwgdHlwZW9mIHZhbHVlID09PSBcInN0cmluZ1wiXG59XG5cbi8qKlxuICogQ2hlY2tzIHRoYXQgYSB0cmFuc3BvcnQgam9iIHVzZXMgdGhlIG5vcm1hbGl6ZWQgcHVibGljIGNhbWVsLWNhc2Ugc2hhcGUuXG4gKiBAcGFyYW0ge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSB2YWx1ZSAtIFRyYW5zcG9ydCB2YWx1ZS5cbiAqIEByZXR1cm5zIHt2YWx1ZSBpcyBpbXBvcnQoXCIuL3R5cGVzLmpzXCIpLkJhY2tncm91bmRKb2JSb3d9IC0gV2hldGhlciBub3JtYWxpemVkLlxuICovXG5mdW5jdGlvbiBpc05vcm1hbGl6ZWRCYWNrZ3JvdW5kSm9iKHZhbHVlKSB7XG4gIGlmICghaXNQbGFpbk9iamVjdCh2YWx1ZSkpIHJldHVybiBmYWxzZVxuXG4gIGNvbnN0IGpvYiA9IHZhbHVlXG5cbiAgcmV0dXJuIHR5cGVvZiBqb2IuaWQgPT09IFwic3RyaW5nXCJcbiAgICAmJiB0eXBlb2Ygam9iLmpvYk5hbWUgPT09IFwic3RyaW5nXCJcbiAgICAmJiBBcnJheS5pc0FycmF5KGpvYi5hcmdzKVxuICAgICYmIEJBQ0tHUk9VTkRfSk9CX0VYRUNVVElPTl9NT0RFUy5zb21lKChleGVjdXRpb25Nb2RlKSA9PiBleGVjdXRpb25Nb2RlID09PSBqb2IuZXhlY3V0aW9uTW9kZSlcbiAgICAmJiB0eXBlb2Ygam9iLnF1ZXVlID09PSBcInN0cmluZ1wiXG4gICAgJiYgQkFDS0dST1VORF9KT0JfU1RBVFVTRVMuc29tZSgoc3RhdHVzKSA9PiBzdGF0dXMgPT09IGpvYi5zdGF0dXMpXG4gICAgJiYgQkFDS0dST1VORF9KT0JfTlVMTEFCTEVfTlVNQkVSX0ZJRUxEUy5ldmVyeSgoZmllbGQpID0+IGlzTnVsbGFibGVCYWNrZ3JvdW5kSm9iTnVtYmVyKGpvYltmaWVsZF0pKVxuICAgICYmIEJBQ0tHUk9VTkRfSk9CX05VTExBQkxFX1NUUklOR19GSUVMRFMuZXZlcnkoKGZpZWxkKSA9PiBpc051bGxhYmxlQmFja2dyb3VuZEpvYlN0cmluZyhqb2JbZmllbGRdKSlcbn1cblxuLyoqXG4gKiBEZXNjcmliZXMgYW4gdW5leHBlY3RlZCBwcm90b2NvbCByZXNwb25zZSB3aXRob3V0IGVjaG9pbmcgaXRzIHBheWxvYWQuXG4gKiBAcGFyYW0ge3N0cmluZ30gb3BlcmF0aW9uIC0gUHVibGljIG9wZXJhdGlvbiBuYW1lLlxuICogQHBhcmFtIHtpbXBvcnQoXCIuL3R5cGVzLmpzXCIpLkJhY2tncm91bmRKb2JTb2NrZXRNZXNzYWdlfSBtZXNzYWdlIC0gUmVzcG9uc2UuXG4gKiBAcmV0dXJucyB7RXJyb3J9IC0gUHJvdG9jb2wgZXJyb3IuXG4gKi9cbmZ1bmN0aW9uIHVuZXhwZWN0ZWRSZXNwb25zZUVycm9yKG9wZXJhdGlvbiwgbWVzc2FnZSkge1xuICBjb25zdCByZXNwb25zZVR5cGUgPSBtZXNzYWdlICYmIHR5cGVvZiBtZXNzYWdlLnR5cGUgPT09IFwic3RyaW5nXCIgPyBtZXNzYWdlLnR5cGUgOiBcIm1pc3NpbmcgdHlwZVwiXG5cbiAgcmV0dXJuIG5ldyBFcnJvcihgVW5leHBlY3RlZCAke29wZXJhdGlvbn0gcmVzcG9uc2U6ICR7cmVzcG9uc2VUeXBlfWApXG59XG5cbmV4cG9ydCBkZWZhdWx0IGNsYXNzIEJhY2tncm91bmRKb2JzQ2xpZW50IHtcbiAgLyoqXG4gICAqIFJ1bnMgY29uc3RydWN0b3IuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBbYXJnc10gLSBPcHRpb25zLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL2NvbmZpZ3VyYXRpb24uanNcIikuZGVmYXVsdH0gW2FyZ3MuY29uZmlndXJhdGlvbl0gLSBDb25maWd1cmF0aW9uLlxuICAgKiBAcGFyYW0ge251bWJlcn0gW2FyZ3MuZW5xdWV1ZVRpbWVvdXRNc10gLSBNYXhpbXVtIHRpbWUgdG8gd2FpdCBmb3IgYW4gZW5xdWV1ZSBhY2tub3dsZWRnZW1lbnQgaW4gbWlsbGlzZWNvbmRzIChkZWZhdWx0OiA1MDAwKS5cbiAgICogQHBhcmFtIHtudW1iZXJ9IFthcmdzLmdlbmVyYXRpb25IYW5kc2hha2VUaW1lb3V0TXNdIC0gTWF4aW11bSB0aW1lIHRvIHdhaXQgZm9yIGdlbmVyYXRpb24gYWNrbm93bGVkZ2VtZW50IChkZWZhdWx0OiA0MDAwKS5cbiAgICogQHBhcmFtIHtzdHJpbmd9IFthcmdzLmdlbmVyYXRpb25JZF0gLSBFeHBsaWNpdCByZWxlYXNlIGdlbmVyYXRpb24gaWRlbnRpdHkuXG4gICAqL1xuICBjb25zdHJ1Y3Rvcih7Y29uZmlndXJhdGlvbiwgZW5xdWV1ZVRpbWVvdXRNcyA9IERFRkFVTFRfRU5RVUVVRV9USU1FT1VUX01TLCBnZW5lcmF0aW9uSGFuZHNoYWtlVGltZW91dE1zID0gREVGQVVMVF9HRU5FUkFUSU9OX0hBTkRTSEFLRV9USU1FT1VUX01TLCBnZW5lcmF0aW9uSWR9ID0ge30pIHtcbiAgICB0aGlzLmNvbmZpZ3VyYXRpb25Qcm9taXNlID0gY29uZmlndXJhdGlvbiA/IFByb21pc2UucmVzb2x2ZShjb25maWd1cmF0aW9uKSA6IGNvbmZpZ3VyYXRpb25SZXNvbHZlcigpXG4gICAgdGhpcy5lbnF1ZXVlVGltZW91dE1zID0gZW5xdWV1ZVRpbWVvdXRNc1xuICAgIHRoaXMuZ2VuZXJhdGlvbkhhbmRzaGFrZVRpbWVvdXRNcyA9IHZhbGlkYXRlR2VuZXJhdGlvbkhhbmRzaGFrZVRpbWVvdXRNcyhnZW5lcmF0aW9uSGFuZHNoYWtlVGltZW91dE1zKVxuICAgIHRoaXMuZXhwbGljaXRHZW5lcmF0aW9uSWQgPSBnZW5lcmF0aW9uSWRcbiAgfVxuXG4gIC8qKlxuICAgKiBCdWlsZHMgYSBvbmUtc2hvdCBjbGllbnQgc29ja2V0IHJlcXVlc3QgZnJvbSB0aGUgcmVzb2x2ZWQgY29uZmlndXJhdGlvbi5cbiAgICogQHJldHVybnMge1Byb21pc2U8QmFja2dyb3VuZEpvYnNTb2NrZXRSZXF1ZXN0Pn0gLSBTb2NrZXQgcmVxdWVzdC5cbiAgICovXG4gIGFzeW5jIF9yZXF1ZXN0KCkge1xuICAgIGNvbnN0IGNvbmZpZ3VyYXRpb24gPSBhd2FpdCB0aGlzLmNvbmZpZ3VyYXRpb25Qcm9taXNlXG4gICAgY29uc3Qge2hvc3QsIHBvcnR9ID0gY29uZmlndXJhdGlvbi5nZXRCYWNrZ3JvdW5kSm9ic0NvbmZpZygpXG4gICAgY29uc3Qge2dlbmVyYXRpb25JZH0gPSBjb25maWd1cmF0aW9uLnJlc29sdmVCYWNrZ3JvdW5kSm9ic0dlbmVyYXRpb25Db25maWcoe1xuICAgICAgZ2VuZXJhdGlvbklkOiB0aGlzLmV4cGxpY2l0R2VuZXJhdGlvbklkLFxuICAgICAgc291cmNlTmFtZTogXCJCYWNrZ3JvdW5kSm9ic0NsaWVudFwiXG4gICAgfSlcblxuICAgIHJldHVybiBuZXcgQmFja2dyb3VuZEpvYnNTb2NrZXRSZXF1ZXN0KHtob3N0LCBwb3J0LCByb2xlOiBcImNsaWVudFwiLCBnZW5lcmF0aW9uSGFuZHNoYWtlVGltZW91dE1zOiB0aGlzLmdlbmVyYXRpb25IYW5kc2hha2VUaW1lb3V0TXMsIGdlbmVyYXRpb25JZH0pXG4gIH1cblxuICAvKipcbiAgICogUnVucyBlbnF1ZXVlLlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIE9wdGlvbnMuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBhcmdzLmpvYk5hbWUgLSBKb2IgbmFtZS5cbiAgICogQHBhcmFtIHtBcnJheTxSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59IGFyZ3MuYXJncyAtIEpvYiBhcmdzLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vdHlwZXMuanNcIikuQmFja2dyb3VuZEpvYk9wdGlvbnN9IFthcmdzLm9wdGlvbnNdIC0gSm9iIG9wdGlvbnMuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBbYXJncy5wcm9kdWNlckludm9jYXRpb25JZF0gLSBTdGFibGUgaWRlbnRpdHkgZm9yIG9uZSBvd25lZCBlbnF1ZXVlIGludm9jYXRpb24uXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi90eXBlcy5qc1wiKS5CYWNrZ3JvdW5kSm9iUHJvZHVjZXJQcm9vZn0gW2FyZ3MucHJvZHVjZXJQcm9vZl0gLSBFeGFjdCBpbnRlcm5hbCBwcm9kdWNlciBoYW5kb2ZmLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxzdHJpbmc+fSAtIEpvYiBpZC5cbiAgICovXG4gIGFzeW5jIGVucXVldWUoe2pvYk5hbWUsIGFyZ3MsIG9wdGlvbnMsIHByb2R1Y2VySW52b2NhdGlvbklkLCBwcm9kdWNlclByb29mfSkge1xuICAgIGNvbnN0IG1lc3NhZ2UgPSB7XG4gICAgICB0eXBlOiAvKiogQHR5cGUge2NvbnN0fSAqLyAoXCJlbnF1ZXVlXCIpLFxuICAgICAgam9iTmFtZSxcbiAgICAgIGFyZ3MsXG4gICAgICBvcHRpb25zLFxuICAgICAgLi4uKHByb2R1Y2VySW52b2NhdGlvbklkID8ge3Byb2R1Y2VySW52b2NhdGlvbklkfSA6IHt9KSxcbiAgICAgIC4uLihwcm9kdWNlclByb29mID8ge3Byb2R1Y2VyUHJvb2Z9IDoge30pXG4gICAgfVxuICAgIGNvbnN0IGFja25vd2xlZGdlbWVudCA9IHtleHBsaWNpdGx5UmVqZWN0ZWQ6IGZhbHNlLCBnZW5lcmF0aW9uRmVuY2VkOiBmYWxzZSwgcmVxdWVzdFNlbnQ6IGZhbHNlfVxuICAgIC8qKlxuICAgICAqIFNlbmRzIG9uZSBlbnF1ZXVlIGF0dGVtcHQuIEFuIG93bmVkIGNhbGxlciBtYXkgcmVwbGF5IHRoaXMgZXhhY3QgbWVzc2FnZVxuICAgICAqIG9uY2Ugd2hlbiB0cmFuc3BvcnQgYWNrbm93bGVkZ2VtZW50IHJlbWFpbnMgYW1iaWd1b3VzIGFmdGVyIHNlbmQuXG4gICAgICogQHBhcmFtIHt7ZXhwbGljaXRseVJlamVjdGVkOiBib29sZWFuLCBnZW5lcmF0aW9uRmVuY2VkOiBib29sZWFuLCByZXF1ZXN0U2VudDogYm9vbGVhbn0gfCB1bmRlZmluZWR9IGF0dGVtcHRBY2tub3dsZWRnZW1lbnQgLSBGaXJzdC1hdHRlbXB0IG9ic2VydmF0aW9ucy5cbiAgICAgKiBAcmV0dXJucyB7UHJvbWlzZTxzdHJpbmc+fSAtIEpvYiBpZC5cbiAgICAgKi9cbiAgICBjb25zdCBlbnF1ZXVlQXR0ZW1wdCA9IGFzeW5jIChhdHRlbXB0QWNrbm93bGVkZ2VtZW50KSA9PiB7XG4gICAgICBjb25zdCByZXF1ZXN0ID0gYXdhaXQgdGhpcy5fcmVxdWVzdCgpXG5cbiAgICAgIHJldHVybiBhd2FpdCB0aW1lb3V0KHtcbiAgICAgICAgZXJyb3JNZXNzYWdlOiBgQmFja2dyb3VuZCBqb2IgZW5xdWV1ZSBhY2tub3dsZWRnZW1lbnQgdGltZWQgb3V0IGFmdGVyICR7dGhpcy5lbnF1ZXVlVGltZW91dE1zfW1zYCxcbiAgICAgICAgdGltZW91dDogdGhpcy5lbnF1ZXVlVGltZW91dE1zXG4gICAgICB9LCBhc3luYyAoe2NvbnRyb2x9KSA9PiBhd2FpdCByZXF1ZXN0LnJ1bih7XG4gICAgICAgIHNpZ25hbDogY29udHJvbC5zaWduYWwsXG4gICAgICAgIG9uQ29ubmVjdDogKGpzb25Tb2NrZXQpID0+IHtcbiAgICAgICAgICBqc29uU29ja2V0LnNlbmQobWVzc2FnZSlcbiAgICAgICAgICBpZiAoYXR0ZW1wdEFja25vd2xlZGdlbWVudCkge1xuICAgICAgICAgICAgYXR0ZW1wdEFja25vd2xlZGdlbWVudC5nZW5lcmF0aW9uRmVuY2VkID0gQm9vbGVhbihyZXF1ZXN0LmdlbmVyYXRpb25JZClcbiAgICAgICAgICAgIGF0dGVtcHRBY2tub3dsZWRnZW1lbnQucmVxdWVzdFNlbnQgPSB0cnVlXG4gICAgICAgICAgfVxuICAgICAgICB9LFxuICAgICAgICBvbk1lc3NhZ2U6ICh7bWVzc2FnZSwgcmVzb2x2ZSwgcmVqZWN0fSkgPT4ge1xuICAgICAgICAgIGlmIChtZXNzYWdlPy50eXBlID09PSBcImVucXVldWVkXCIpIHtcbiAgICAgICAgICAgIHJlc29sdmUobWVzc2FnZS5qb2JJZClcbiAgICAgICAgICAgIHJldHVyblxuICAgICAgICAgIH1cblxuICAgICAgICAgIGlmIChtZXNzYWdlPy50eXBlID09PSBcImVucXVldWUtZXJyb3JcIikge1xuICAgICAgICAgICAgaWYgKGF0dGVtcHRBY2tub3dsZWRnZW1lbnQpIGF0dGVtcHRBY2tub3dsZWRnZW1lbnQuZXhwbGljaXRseVJlamVjdGVkID0gdHJ1ZVxuICAgICAgICAgICAgcmVqZWN0KG5ldyBFcnJvcihtZXNzYWdlLmVycm9yIHx8IFwiRmFpbGVkIHRvIGVucXVldWUgam9iXCIpKVxuICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgICAgfSkpXG4gICAgfVxuXG4gICAgdHJ5IHtcbiAgICAgIHJldHVybiBhd2FpdCBlbnF1ZXVlQXR0ZW1wdChhY2tub3dsZWRnZW1lbnQpXG4gICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgIGlmICghcHJvZHVjZXJJbnZvY2F0aW9uSWQgfHwgIXByb2R1Y2VyUHJvb2YgfHwgIWFja25vd2xlZGdlbWVudC5nZW5lcmF0aW9uRmVuY2VkIHx8ICFhY2tub3dsZWRnZW1lbnQucmVxdWVzdFNlbnQgfHwgYWNrbm93bGVkZ2VtZW50LmV4cGxpY2l0bHlSZWplY3RlZCkgdGhyb3cgZXJyb3JcbiAgICB9XG5cbiAgICByZXR1cm4gYXdhaXQgZW5xdWV1ZUF0dGVtcHQodW5kZWZpbmVkKVxuICB9XG5cbiAgLyoqXG4gICAqIEF0b21pY2FsbHkgcmVwbGFjZXMgdGhlIHF1ZXVlZCBvd25lciBvZiBhIHN0YWJsZSBzY2hlZHVsZSBrZXkuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gT3B0aW9ucy5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGFyZ3Muc2NoZWR1bGVLZXkgLSBTdGFibGUgbG9naWNhbCBzY2hlZHVsZSBrZXkuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBhcmdzLmpvYk5hbWUgLSBKb2IgbmFtZS5cbiAgICogQHBhcmFtIHtBcnJheTxSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59IGFyZ3MuYXJncyAtIEpvYiBhcmdzLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vdHlwZXMuanNcIikuQmFja2dyb3VuZEpvYk9wdGlvbnN9IFthcmdzLm9wdGlvbnNdIC0gSm9iIG9wdGlvbnMuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPGltcG9ydChcIi4vdHlwZXMuanNcIikuQmFja2dyb3VuZEpvYlJlcGxhY2VtZW50UmVzdWx0Pn0gLSBSZXBsYWNlbWVudCByZXN1bHQuXG4gICAqL1xuICBhc3luYyByZXBsYWNlU2NoZWR1bGVkKHtzY2hlZHVsZUtleSwgam9iTmFtZSwgYXJncywgb3B0aW9uc30pIHtcbiAgICBjb25zdCByZXF1ZXN0ID0gYXdhaXQgdGhpcy5fcmVxdWVzdCgpXG5cbiAgICByZXR1cm4gYXdhaXQgcmVxdWVzdC5ydW4oe1xuICAgICAgb25Db25uZWN0OiAoanNvblNvY2tldCkgPT4ge1xuICAgICAgICBqc29uU29ja2V0LnNlbmQoe3R5cGU6IFwicmVwbGFjZS1zY2hlZHVsZWRcIiwgc2NoZWR1bGVLZXksIGpvYk5hbWUsIGFyZ3MsIG9wdGlvbnN9KVxuICAgICAgfSxcbiAgICAgIG9uTWVzc2FnZTogKHttZXNzYWdlLCByZXNvbHZlLCByZWplY3R9KSA9PiB7XG4gICAgICAgIGlmIChtZXNzYWdlPy50eXBlID09PSBcInNjaGVkdWxlLXJlcGxhY2VkXCIpIHtcbiAgICAgICAgICByZXNvbHZlKHtcbiAgICAgICAgICAgIGpvYklkOiBtZXNzYWdlLmpvYklkLFxuICAgICAgICAgICAgcHJldmlvdXNKb2JJZDogbWVzc2FnZS5wcmV2aW91c0pvYklkLFxuICAgICAgICAgICAgcHJldmlvdXNTdGF0dXM6IG1lc3NhZ2UucHJldmlvdXNTdGF0dXNcbiAgICAgICAgICB9KVxuICAgICAgICAgIHJldHVyblxuICAgICAgICB9XG5cbiAgICAgICAgaWYgKG1lc3NhZ2U/LnR5cGUgPT09IFwicmVwbGFjZS1zY2hlZHVsZWQtZXJyb3JcIikge1xuICAgICAgICAgIHJlamVjdChuZXcgRXJyb3IobWVzc2FnZS5lcnJvciB8fCBcIkZhaWxlZCB0byByZXBsYWNlIHNjaGVkdWxlZCBqb2JcIikpXG4gICAgICAgIH1cbiAgICAgIH1cbiAgICB9KVxuICB9XG5cbiAgLyoqXG4gICAqIENhbmNlbHMgb3IgZGV0YWNoZXMgdGhlIGN1cnJlbnQgb3duZXIgb2YgYSBzdGFibGUgc2NoZWR1bGUga2V5LlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIE9wdGlvbnMuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBhcmdzLnNjaGVkdWxlS2V5IC0gU3RhYmxlIGxvZ2ljYWwgc2NoZWR1bGUga2V5LlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxpbXBvcnQoXCIuL3R5cGVzLmpzXCIpLkJhY2tncm91bmRKb2JDYW5jZWxsYXRpb25SZXN1bHQ+fSAtIENhbmNlbGxhdGlvbiByZXN1bHQuXG4gICAqL1xuICBhc3luYyBjYW5jZWxTY2hlZHVsZWQoe3NjaGVkdWxlS2V5fSkge1xuICAgIGNvbnN0IHJlcXVlc3QgPSBhd2FpdCB0aGlzLl9yZXF1ZXN0KClcblxuICAgIHJldHVybiBhd2FpdCByZXF1ZXN0LnJ1bih7XG4gICAgICBvbkNvbm5lY3Q6IChqc29uU29ja2V0KSA9PiB7XG4gICAgICAgIGpzb25Tb2NrZXQuc2VuZCh7dHlwZTogXCJjYW5jZWwtc2NoZWR1bGVkXCIsIHNjaGVkdWxlS2V5fSlcbiAgICAgIH0sXG4gICAgICBvbk1lc3NhZ2U6ICh7bWVzc2FnZSwgcmVzb2x2ZSwgcmVqZWN0fSkgPT4ge1xuICAgICAgICBpZiAobWVzc2FnZT8udHlwZSA9PT0gXCJzY2hlZHVsZS1jYW5jZWxsZWRcIikge1xuICAgICAgICAgIHJlc29sdmUoe2pvYklkOiBtZXNzYWdlLmpvYklkLCBvdXRjb21lOiBtZXNzYWdlLm91dGNvbWV9KVxuICAgICAgICAgIHJldHVyblxuICAgICAgICB9XG5cbiAgICAgICAgaWYgKG1lc3NhZ2U/LnR5cGUgPT09IFwiY2FuY2VsLXNjaGVkdWxlZC1lcnJvclwiKSB7XG4gICAgICAgICAgcmVqZWN0KG5ldyBFcnJvcihtZXNzYWdlLmVycm9yIHx8IFwiRmFpbGVkIHRvIGNhbmNlbCBzY2hlZHVsZWQgam9iXCIpKVxuICAgICAgICB9XG4gICAgICB9XG4gICAgfSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSZWFkcyBjdXJyZW50IHN0YWJsZSBvd25lcnNoaXAgYW5kIG9wdGlvbmFsIHRlcm1pbmFsIGhpc3RvcnkuXG4gICAqIEBwYXJhbSB7e3NjaGVkdWxlS2V5OiBzdHJpbmcsIGluY2x1ZGVMYXRlc3RUZXJtaW5hbD86IGJvb2xlYW59fSBhcmdzIC0gTG9va3VwIHJlcXVlc3QuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPGltcG9ydChcIi4vdHlwZXMuanNcIikuQmFja2dyb3VuZEpvYlNjaGVkdWxlZExvb2t1cFJlc3VsdD59IC0gTm9ybWFsaXplZCBzdGFibGUgc2NoZWR1bGUgam9icy5cbiAgICovXG4gIGFzeW5jIGdldFNjaGVkdWxlZEpvYih7c2NoZWR1bGVLZXksIGluY2x1ZGVMYXRlc3RUZXJtaW5hbH0pIHtcbiAgICBjb25zdCByZXF1ZXN0ID0gYXdhaXQgdGhpcy5fcmVxdWVzdCgpXG5cbiAgICByZXR1cm4gYXdhaXQgcmVxdWVzdC5ydW4oe1xuICAgICAgb25Db25uZWN0OiAoanNvblNvY2tldCkgPT4ge1xuICAgICAgICBqc29uU29ja2V0LnNlbmQoe3R5cGU6IFwiZ2V0LXNjaGVkdWxlZC1qb2JcIiwgc2NoZWR1bGVLZXksIGluY2x1ZGVMYXRlc3RUZXJtaW5hbH0pXG4gICAgICB9LFxuICAgICAgb25NZXNzYWdlOiAoe21lc3NhZ2UsIHJlc29sdmUsIHJlamVjdH0pID0+IHtcbiAgICAgICAgaWYgKG1lc3NhZ2U/LnR5cGUgPT09IFwic2NoZWR1bGVkLWpvYlwiKSB7XG4gICAgICAgICAgY29uc3Qge2N1cnJlbnRKb2IsIGxhdGVzdFRlcm1pbmFsSm9ifSA9IG1lc3NhZ2VcbiAgICAgICAgICBjb25zdCBjdXJyZW50Sm9iVmFsaWQgPSBjdXJyZW50Sm9iID09PSBudWxsXG4gICAgICAgICAgICB8fCAoaXNOb3JtYWxpemVkQmFja2dyb3VuZEpvYihjdXJyZW50Sm9iKSAmJiBCQUNLR1JPVU5EX0pPQl9BQ1RJVkVfU1RBVFVTRVMuc29tZSgoc3RhdHVzKSA9PiBzdGF0dXMgPT09IGN1cnJlbnRKb2Iuc3RhdHVzKSlcbiAgICAgICAgICBjb25zdCBsYXRlc3RUZXJtaW5hbEpvYlZhbGlkID0gbGF0ZXN0VGVybWluYWxKb2IgPT09IG51bGxcbiAgICAgICAgICAgIHx8IChpc05vcm1hbGl6ZWRCYWNrZ3JvdW5kSm9iKGxhdGVzdFRlcm1pbmFsSm9iKSAmJiBCQUNLR1JPVU5EX0pPQl9URVJNSU5BTF9TVEFUVVNFUy5zb21lKChzdGF0dXMpID0+IHN0YXR1cyA9PT0gbGF0ZXN0VGVybWluYWxKb2Iuc3RhdHVzKSlcblxuICAgICAgICAgIGlmICghY3VycmVudEpvYlZhbGlkIHx8ICFsYXRlc3RUZXJtaW5hbEpvYlZhbGlkKSB7XG4gICAgICAgICAgICByZWplY3QobmV3IEVycm9yKFwiSW52YWxpZCBnZXRTY2hlZHVsZWRKb2IgcmVzcG9uc2U6IGV4cGVjdGVkIG5vcm1hbGl6ZWQgcHVibGljIGpvYiB2YWx1ZXNcIikpXG4gICAgICAgICAgICByZXR1cm5cbiAgICAgICAgICB9XG5cbiAgICAgICAgICByZXNvbHZlKHtjdXJyZW50Sm9iLCBsYXRlc3RUZXJtaW5hbEpvYn0pXG4gICAgICAgICAgcmV0dXJuXG4gICAgICAgIH1cblxuICAgICAgICBpZiAobWVzc2FnZT8udHlwZSA9PT0gXCJnZXQtc2NoZWR1bGVkLWpvYi1lcnJvclwiKSB7XG4gICAgICAgICAgcmVqZWN0KG5ldyBFcnJvcihtZXNzYWdlLmVycm9yIHx8IFwiRmFpbGVkIHRvIHJlYWQgc2NoZWR1bGVkIGpvYlwiKSlcbiAgICAgICAgICByZXR1cm5cbiAgICAgICAgfVxuXG4gICAgICAgIHJlamVjdCh1bmV4cGVjdGVkUmVzcG9uc2VFcnJvcihcImdldFNjaGVkdWxlZEpvYlwiLCBtZXNzYWdlKSlcbiAgICAgIH1cbiAgICB9KVxuICB9XG5cbiAgLyoqXG4gICAqIEV4cGVkaXRlcyBhIGZ1dHVyZSBxdWV1ZWQgc3RhYmxlIG93bmVyIHdpdGhvdXQgY2hhbmdpbmcgam9iIGlkZW50aXR5LlxuICAgKiBAcGFyYW0ge3tzY2hlZHVsZUtleTogc3RyaW5nfX0gYXJncyAtIFdha2UgcmVxdWVzdC5cbiAgICogQHJldHVybnMge1Byb21pc2U8aW1wb3J0KFwiLi90eXBlcy5qc1wiKS5CYWNrZ3JvdW5kSm9iV2FrZVJlc3VsdD59IC0gV2FrZSByZXN1bHQuXG4gICAqL1xuICBhc3luYyB3YWtlU2NoZWR1bGVkKHtzY2hlZHVsZUtleX0pIHtcbiAgICBjb25zdCByZXF1ZXN0ID0gYXdhaXQgdGhpcy5fcmVxdWVzdCgpXG5cbiAgICByZXR1cm4gYXdhaXQgcmVxdWVzdC5ydW4oe1xuICAgICAgb25Db25uZWN0OiAoanNvblNvY2tldCkgPT4ge1xuICAgICAgICBqc29uU29ja2V0LnNlbmQoe3R5cGU6IFwid2FrZS1zY2hlZHVsZWRcIiwgc2NoZWR1bGVLZXl9KVxuICAgICAgfSxcbiAgICAgIG9uTWVzc2FnZTogKHttZXNzYWdlLCByZXNvbHZlLCByZWplY3R9KSA9PiB7XG4gICAgICAgIGlmIChtZXNzYWdlPy50eXBlID09PSBcInNjaGVkdWxlLXdva2VuXCIpIHtcbiAgICAgICAgICBjb25zdCBvdXRjb21lID0gbWVzc2FnZS5vdXRjb21lXG4gICAgICAgICAgY29uc3Qga25vd25PdXRjb21lID0gQkFDS0dST1VORF9KT0JfV0FLRV9PVVRDT01FUy5pbmNsdWRlcyhvdXRjb21lKVxuICAgICAgICAgIGNvbnN0IHZhbGlkSm9iSWQgPSBvdXRjb21lID09PSBcIm5vdF9mb3VuZFwiID8gbWVzc2FnZS5qb2JJZCA9PT0gbnVsbCA6IHR5cGVvZiBtZXNzYWdlLmpvYklkID09PSBcInN0cmluZ1wiICYmIG1lc3NhZ2Uuam9iSWQubGVuZ3RoID4gMFxuXG4gICAgICAgICAgaWYgKCFrbm93bk91dGNvbWUgfHwgIXZhbGlkSm9iSWQpIHtcbiAgICAgICAgICAgIHJlamVjdChuZXcgRXJyb3IoXCJJbnZhbGlkIHdha2VTY2hlZHVsZWQgcmVzcG9uc2VcIikpXG4gICAgICAgICAgICByZXR1cm5cbiAgICAgICAgICB9XG5cbiAgICAgICAgICByZXNvbHZlKHtqb2JJZDogbWVzc2FnZS5qb2JJZCwgb3V0Y29tZX0pXG4gICAgICAgICAgcmV0dXJuXG4gICAgICAgIH1cblxuICAgICAgICBpZiAobWVzc2FnZT8udHlwZSA9PT0gXCJ3YWtlLXNjaGVkdWxlZC1lcnJvclwiKSB7XG4gICAgICAgICAgcmVqZWN0KG5ldyBFcnJvcihtZXNzYWdlLmVycm9yIHx8IFwiRmFpbGVkIHRvIHdha2Ugc2NoZWR1bGVkIGpvYlwiKSlcbiAgICAgICAgICByZXR1cm5cbiAgICAgICAgfVxuXG4gICAgICAgIHJlamVjdCh1bmV4cGVjdGVkUmVzcG9uc2VFcnJvcihcIndha2VTY2hlZHVsZWRcIiwgbWVzc2FnZSkpXG4gICAgICB9XG4gICAgfSlcbiAgfVxufVxuIl19