// @ts-check
import timeout, { TimeoutError } from "awaitery/build/timeout.js";
import configurationResolver from "../configuration-resolver.js";
import BackgroundJobEnqueueAcknowledgementTimeoutError from "./enqueue-acknowledgement-timeout-error.js";
import BackgroundJobsSocketRequest from "./socket-request.js";
import { DEFAULT_GENERATION_HANDSHAKE_TIMEOUT_MS, validateGenerationHandshakeTimeoutMs } from "./generation-handshake-timeout-error.js";
const DEFAULT_ENQUEUE_TIMEOUT_MS = 5000;
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
         * @param {Array<import("./enqueue-acknowledgement-timeout-error.js").BackgroundJobEnqueueAttempt>} previousAttempts - Earlier timed-out attempts.
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
                attemptObservation.acknowledgementWaitElapsedMs = timedOutAtMs - requestSentAtMs;
                attemptObservation.attemptElapsedMs = timedOutAtMs - attemptStartedAtMs;
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
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiY2xpZW50LmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiLi4vLi4vLi4vc3JjL2JhY2tncm91bmQtam9icy9jbGllbnQuanMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6IkFBQUEsWUFBWTtBQUVaLE9BQU8sT0FBTyxFQUFFLEVBQUMsWUFBWSxFQUFDLE1BQU0sMkJBQTJCLENBQUE7QUFDL0QsT0FBTyxxQkFBcUIsTUFBTSw4QkFBOEIsQ0FBQTtBQUNoRSxPQUFPLCtDQUErQyxNQUFNLDRDQUE0QyxDQUFBO0FBQ3hHLE9BQU8sMkJBQTJCLE1BQU0scUJBQXFCLENBQUE7QUFDN0QsT0FBTyxFQUFFLHVDQUF1QyxFQUFFLG9DQUFvQyxFQUFFLE1BQU0seUNBQXlDLENBQUE7QUFFdkksTUFBTSwwQkFBMEIsR0FBRyxJQUFJLENBQUE7QUFFdkMsTUFBTSxDQUFDLE9BQU8sT0FBTyxvQkFBb0I7SUFDdkM7Ozs7Ozs7T0FPRztJQUNILFlBQVksRUFBQyxhQUFhLEVBQUUsZ0JBQWdCLEdBQUcsMEJBQTBCLEVBQUUsNEJBQTRCLEdBQUcsdUNBQXVDLEVBQUUsWUFBWSxFQUFDLEdBQUcsRUFBRTtRQUNuSyxJQUFJLENBQUMsb0JBQW9CLEdBQUcsYUFBYSxDQUFDLENBQUMsQ0FBQyxPQUFPLENBQUMsT0FBTyxDQUFDLGFBQWEsQ0FBQyxDQUFDLENBQUMsQ0FBQyxxQkFBcUIsRUFBRSxDQUFBO1FBQ3BHLElBQUksQ0FBQyxnQkFBZ0IsR0FBRyxnQkFBZ0IsQ0FBQTtRQUN4QyxJQUFJLENBQUMsNEJBQTRCLEdBQUcsb0NBQW9DLENBQUMsNEJBQTRCLENBQUMsQ0FBQTtRQUN0RyxJQUFJLENBQUMsb0JBQW9CLEdBQUcsWUFBWSxDQUFBO0lBQzFDLENBQUM7SUFFRDs7O09BR0c7SUFDSCxLQUFLLENBQUMsUUFBUTtRQUNaLE1BQU0sYUFBYSxHQUFHLE1BQU0sSUFBSSxDQUFDLG9CQUFvQixDQUFBO1FBQ3JELE1BQU0sRUFBQyxJQUFJLEVBQUUsSUFBSSxFQUFDLEdBQUcs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QUMsQ0FBQTtJQUNKLENBQUM7Q0FDRiIsInNvdXJjZXNDb250ZW50IjpbIi8vIEB0cy1jaGVja1xuXG5pbXBvcnQgdGltZW91dCwge1RpbWVvdXRFcnJvcn0gZnJvbSBcImF3YWl0ZXJ5L2J1aWxkL3RpbWVvdXQuanNcIlxuaW1wb3J0IGNvbmZpZ3VyYXRpb25SZXNvbHZlciBmcm9tIFwiLi4vY29uZmlndXJhdGlvbi1yZXNvbHZlci5qc1wiXG5pbXBvcnQgQmFja2dyb3VuZEpvYkVucXVldWVBY2tub3dsZWRnZW1lbnRUaW1lb3V0RXJyb3IgZnJvbSBcIi4vZW5xdWV1ZS1hY2tub3dsZWRnZW1lbnQtdGltZW91dC1lcnJvci5qc1wiXG5pbXBvcnQgQmFja2dyb3VuZEpvYnNTb2NrZXRSZXF1ZXN0IGZyb20gXCIuL3NvY2tldC1yZXF1ZXN0LmpzXCJcbmltcG9ydCB7IERFRkFVTFRfR0VORVJBVElPTl9IQU5EU0hBS0VfVElNRU9VVF9NUywgdmFsaWRhdGVHZW5lcmF0aW9uSGFuZHNoYWtlVGltZW91dE1zIH0gZnJvbSBcIi4vZ2VuZXJhdGlvbi1oYW5kc2hha2UtdGltZW91dC1lcnJvci5qc1wiXG5cbmNvbnN0IERFRkFVTFRfRU5RVUVVRV9USU1FT1VUX01TID0gNTAwMFxuXG5leHBvcnQgZGVmYXVsdCBjbGFzcyBCYWNrZ3JvdW5kSm9ic0NsaWVudCB7XG4gIC8qKlxuICAgKiBSdW5zIGNvbnN0cnVjdG9yLlxuICAgKiBAcGFyYW0ge29iamVjdH0gW2FyZ3NdIC0gT3B0aW9ucy5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9jb25maWd1cmF0aW9uLmpzXCIpLmRlZmF1bHR9IFthcmdzLmNvbmZpZ3VyYXRpb25dIC0gQ29uZmlndXJhdGlvbi5cbiAgICogQHBhcmFtIHtudW1iZXJ9IFthcmdzLmVucXVldWVUaW1lb3V0TXNdIC0gTWF4aW11bSB0aW1lIHRvIHdhaXQgZm9yIGFuIGVucXVldWUgYWNrbm93bGVkZ2VtZW50IGluIG1pbGxpc2Vjb25kcyAoZGVmYXVsdDogNTAwMCkuXG4gICAqIEBwYXJhbSB7bnVtYmVyfSBbYXJncy5nZW5lcmF0aW9uSGFuZHNoYWtlVGltZW91dE1zXSAtIE1heGltdW0gdGltZSB0byB3YWl0IGZvciBnZW5lcmF0aW9uIGFja25vd2xlZGdlbWVudCAoZGVmYXVsdDogNDAwMCkuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBbYXJncy5nZW5lcmF0aW9uSWRdIC0gRXhwbGljaXQgcmVsZWFzZSBnZW5lcmF0aW9uIGlkZW50aXR5LlxuICAgKi9cbiAgY29uc3RydWN0b3Ioe2NvbmZpZ3VyYXRpb24sIGVucXVldWVUaW1lb3V0TXMgPSBERUZBVUxUX0VOUVVFVUVfVElNRU9VVF9NUywgZ2VuZXJhdGlvbkhhbmRzaGFrZVRpbWVvdXRNcyA9IERFRkFVTFRfR0VORVJBVElPTl9IQU5EU0hBS0VfVElNRU9VVF9NUywgZ2VuZXJhdGlvbklkfSA9IHt9KSB7XG4gICAgdGhpcy5jb25maWd1cmF0aW9uUHJvbWlzZSA9IGNvbmZpZ3VyYXRpb24gPyBQcm9taXNlLnJlc29sdmUoY29uZmlndXJhdGlvbikgOiBjb25maWd1cmF0aW9uUmVzb2x2ZXIoKVxuICAgIHRoaXMuZW5xdWV1ZVRpbWVvdXRNcyA9IGVucXVldWVUaW1lb3V0TXNcbiAgICB0aGlzLmdlbmVyYXRpb25IYW5kc2hha2VUaW1lb3V0TXMgPSB2YWxpZGF0ZUdlbmVyYXRpb25IYW5kc2hha2VUaW1lb3V0TXMoZ2VuZXJhdGlvbkhhbmRzaGFrZVRpbWVvdXRNcylcbiAgICB0aGlzLmV4cGxpY2l0R2VuZXJhdGlvbklkID0gZ2VuZXJhdGlvbklkXG4gIH1cblxuICAvKipcbiAgICogQnVpbGRzIGEgb25lLXNob3QgY2xpZW50IHNvY2tldCByZXF1ZXN0IGZyb20gdGhlIHJlc29sdmVkIGNvbmZpZ3VyYXRpb24uXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPEJhY2tncm91bmRKb2JzU29ja2V0UmVxdWVzdD59IC0gU29ja2V0IHJlcXVlc3QuXG4gICAqL1xuICBhc3luYyBfcmVxdWVzdCgpIHtcbiAgICBjb25zdCBjb25maWd1cmF0aW9uID0gYXdhaXQgdGhpcy5jb25maWd1cmF0aW9uUHJvbWlzZVxuICAgIGNvbnN0IHtob3N0LCBwb3J0fSA9IGNvbmZpZ3VyYXRpb24uZ2V0QmFja2dyb3VuZEpvYnNDb25maWcoKVxuICAgIGNvbnN0IHtnZW5lcmF0aW9uSWR9ID0gY29uZmlndXJhdGlvbi5yZXNvbHZlQmFja2dyb3VuZEpvYnNHZW5lcmF0aW9uQ29uZmlnKHtcbiAgICAgIGdlbmVyYXRpb25JZDogdGhpcy5leHBsaWNpdEdlbmVyYXRpb25JZCxcbiAgICAgIHNvdXJjZU5hbWU6IFwiQmFja2dyb3VuZEpvYnNDbGllbnRcIlxuICAgIH0pXG5cbiAgICByZXR1cm4gbmV3IEJhY2tncm91bmRKb2JzU29ja2V0UmVxdWVzdCh7aG9zdCwgcG9ydCwgcm9sZTogXCJjbGllbnRcIiwgZ2VuZXJhdGlvbkhhbmRzaGFrZVRpbWVvdXRNczogdGhpcy5nZW5lcmF0aW9uSGFuZHNoYWtlVGltZW91dE1zLCBnZW5lcmF0aW9uSWR9KVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZW5xdWV1ZS5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBPcHRpb25zLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gYXJncy5qb2JOYW1lIC0gSm9iIG5hbWUuXG4gICAqIEBwYXJhbSB7QXJyYXk8UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSBhcmdzLmFyZ3MgLSBKb2IgYXJncy5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL3R5cGVzLmpzXCIpLkJhY2tncm91bmRKb2JPcHRpb25zfSBbYXJncy5vcHRpb25zXSAtIEpvYiBvcHRpb25zLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gW2FyZ3MucHJvZHVjZXJJbnZvY2F0aW9uSWRdIC0gU3RhYmxlIGlkZW50aXR5IGZvciBvbmUgb3duZWQgZW5xdWV1ZSBpbnZvY2F0aW9uLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vdHlwZXMuanNcIikuQmFja2dyb3VuZEpvYlByb2R1Y2VyUHJvb2Z9IFthcmdzLnByb2R1Y2VyUHJvb2ZdIC0gRXhhY3QgaW50ZXJuYWwgcHJvZHVjZXIgaGFuZG9mZi5cbiAgICogQHJldHVybnMge1Byb21pc2U8c3RyaW5nPn0gLSBKb2IgaWQuXG4gICAqL1xuICBhc3luYyBlbnF1ZXVlKHtqb2JOYW1lLCBhcmdzLCBvcHRpb25zLCBwcm9kdWNlckludm9jYXRpb25JZCwgcHJvZHVjZXJQcm9vZn0pIHtcbiAgICBjb25zdCBtZXNzYWdlID0ge1xuICAgICAgdHlwZTogLyoqIEB0eXBlIHtjb25zdH0gKi8gKFwiZW5xdWV1ZVwiKSxcbiAgICAgIGpvYk5hbWUsXG4gICAgICBhcmdzLFxuICAgICAgb3B0aW9ucyxcbiAgICAgIC4uLihwcm9kdWNlckludm9jYXRpb25JZCA/IHtwcm9kdWNlckludm9jYXRpb25JZH0gOiB7fSksXG4gICAgICAuLi4ocHJvZHVjZXJQcm9vZiA/IHtwcm9kdWNlclByb29mfSA6IHt9KVxuICAgIH1cbiAgICAvKipcbiAgICAgKiBDcmVhdGVzIHNhZmUgb2JzZXJ2YXRpb25zIGZvciBvbmUgYXR0ZW1wdCB3aXRob3V0IHJldGFpbmluZyByZXF1ZXN0IGRhdGEuXG4gICAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBBdHRlbXB0IGlkZW50aXR5LlxuICAgICAqIEBwYXJhbSB7XCJpbml0aWFsXCIgfCBcIm93bmVkX3JlcGxheVwifSBhcmdzLmF0dGVtcHRLaW5kIC0gSW5pdGlhbCBhdHRlbXB0IG9yIG93bmVkIHJlcGxheS5cbiAgICAgKiBAcGFyYW0ge251bWJlcn0gYXJncy5hdHRlbXB0TnVtYmVyIC0gT25lLWJhc2VkIGF0dGVtcHQgbnVtYmVyLlxuICAgICAqIEByZXR1cm5zIHtpbXBvcnQoXCIuL2VucXVldWUtYWNrbm93bGVkZ2VtZW50LXRpbWVvdXQtZXJyb3IuanNcIikuQmFja2dyb3VuZEpvYkVucXVldWVBdHRlbXB0fSAtIE11dGFibGUgYXR0ZW1wdCBvYnNlcnZhdGlvbnMuXG4gICAgICovXG4gICAgY29uc3QgbmV3QXR0ZW1wdE9ic2VydmF0aW9uID0gKHthdHRlbXB0S2luZCwgYXR0ZW1wdE51bWJlcn0pID0+ICh7XG4gICAgICBhY2tub3dsZWRnZW1lbnRXYWl0RWxhcHNlZE1zOiAwLFxuICAgICAgYXR0ZW1wdEVsYXBzZWRNczogMCxcbiAgICAgIGF0dGVtcHRLaW5kLFxuICAgICAgYXR0ZW1wdE51bWJlcixcbiAgICAgIGV4cGxpY2l0bHlSZWplY3RlZDogZmFsc2UsXG4gICAgICBnZW5lcmF0aW9uRmVuY2VkOiBmYWxzZSxcbiAgICAgIHJlcXVlc3RTZW50OiBmYWxzZVxuICAgIH0pXG4gICAgLyoqXG4gICAgICogU2VuZHMgb25lIGVucXVldWUgYXR0ZW1wdC4gQW4gb3duZWQgY2FsbGVyIG1heSByZXBsYXkgdGhpcyBleGFjdCBtZXNzYWdlXG4gICAgICogb25jZSB3aGVuIHRyYW5zcG9ydCBhY2tub3dsZWRnZW1lbnQgcmVtYWlucyBhbWJpZ3VvdXMgYWZ0ZXIgc2VuZC5cbiAgICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vZW5xdWV1ZS1hY2tub3dsZWRnZW1lbnQtdGltZW91dC1lcnJvci5qc1wiKS5CYWNrZ3JvdW5kSm9iRW5xdWV1ZUF0dGVtcHR9IGF0dGVtcHRPYnNlcnZhdGlvbiAtIE11dGFibGUgYXR0ZW1wdCBvYnNlcnZhdGlvbnMuXG4gICAgICogQHBhcmFtIHtBcnJheTxpbXBvcnQoXCIuL2VucXVldWUtYWNrbm93bGVkZ2VtZW50LXRpbWVvdXQtZXJyb3IuanNcIikuQmFja2dyb3VuZEpvYkVucXVldWVBdHRlbXB0Pn0gcHJldmlvdXNBdHRlbXB0cyAtIEVhcmxpZXIgdGltZWQtb3V0IGF0dGVtcHRzLlxuICAgICAqIEByZXR1cm5zIHtQcm9taXNlPHN0cmluZz59IC0gSm9iIGlkLlxuICAgICAqL1xuICAgIGNvbnN0IGVucXVldWVBdHRlbXB0ID0gYXN5bmMgKGF0dGVtcHRPYnNlcnZhdGlvbiwgcHJldmlvdXNBdHRlbXB0cykgPT4ge1xuICAgICAgY29uc3QgYXR0ZW1wdFN0YXJ0ZWRBdE1zID0gRGF0ZS5ub3coKVxuICAgICAgY29uc3QgcmVxdWVzdCA9IGF3YWl0IHRoaXMuX3JlcXVlc3QoKVxuICAgICAgY29uc3QgcmVxdWVzdEFib3J0Q29udHJvbGxlciA9IG5ldyBBYm9ydENvbnRyb2xsZXIoKVxuICAgICAgY29uc3QgdGltZW91dEVycm9yTWVzc2FnZSA9IGBCYWNrZ3JvdW5kIGpvYiBlbnF1ZXVlIGFja25vd2xlZGdlbWVudCB0aW1lZCBvdXQgYWZ0ZXIgJHt0aGlzLmVucXVldWVUaW1lb3V0TXN9bXNgXG4gICAgICAvKiogQHR5cGUge251bWJlciB8IHVuZGVmaW5lZH0gKi9cbiAgICAgIGxldCByZXF1ZXN0U2VudEF0TXNcbiAgICAgIC8qKlxuICAgICAgICogUmVzb2x2ZXMgdGhlIHByZS1zZW5kIHBoYXNlIHdoZW4gdGhlIG11dGF0aW9uIGhhcyBlbnRlcmVkIHRoZSBzb2NrZXQuXG4gICAgICAgKiBAdHlwZSB7KCkgPT4gdm9pZH1cbiAgICAgICAqL1xuICAgICAgbGV0IG1hcmtSZXF1ZXN0U2VudCA9ICgpID0+IHt9XG4gICAgICBjb25zdCByZXF1ZXN0U2VudCA9IG5ldyBQcm9taXNlKChyZXNvbHZlKSA9PiB7XG4gICAgICAgIG1hcmtSZXF1ZXN0U2VudCA9ICgpID0+IHJlc29sdmUodW5kZWZpbmVkKVxuICAgICAgfSlcbiAgICAgIC8qKlxuICAgICAgICogQXBwbGllcyB0aGUgY29uZmlndXJlZCBkZWFkbGluZSBpbmRlcGVuZGVudGx5IHRvIG9uZSByZXF1ZXN0IHBoYXNlLlxuICAgICAgICogQHRlbXBsYXRlIFRcbiAgICAgICAqIEBwYXJhbSB7KCkgPT4gUHJvbWlzZTxUPn0gY2FsbGJhY2sgLSBQaGFzZSB3b3JrLlxuICAgICAgICogQHJldHVybnMge1Byb21pc2U8VD59IC0gUGhhc2UgcmVzdWx0LlxuICAgICAgICovXG4gICAgICBjb25zdCB3aXRoRW5xdWV1ZVRpbWVvdXQgPSBhc3luYyAoY2FsbGJhY2spID0+IGF3YWl0IHRpbWVvdXQoe1xuICAgICAgICBlcnJvck1lc3NhZ2U6IHRpbWVvdXRFcnJvck1lc3NhZ2UsXG4gICAgICAgIHRpbWVvdXQ6IHRoaXMuZW5xdWV1ZVRpbWVvdXRNc1xuICAgICAgfSwgYXN5bmMgKHtjb250cm9sfSkgPT4ge1xuICAgICAgICBjb25zdCBhYm9ydFJlcXVlc3QgPSAoKSA9PiByZXF1ZXN0QWJvcnRDb250cm9sbGVyLmFib3J0KGNvbnRyb2wuc2lnbmFsLnJlYXNvbilcblxuICAgICAgICBjb250cm9sLnNpZ25hbC5hZGRFdmVudExpc3RlbmVyKFwiYWJvcnRcIiwgYWJvcnRSZXF1ZXN0KVxuICAgICAgICB0cnkge1xuICAgICAgICAgIHJldHVybiBhd2FpdCBjYWxsYmFjaygpXG4gICAgICAgIH0gZmluYWxseSB7XG4gICAgICAgICAgY29udHJvbC5zaWduYWwucmVtb3ZlRXZlbnRMaXN0ZW5lcihcImFib3J0XCIsIGFib3J0UmVxdWVzdClcbiAgICAgICAgfVxuICAgICAgfSlcbiAgICAgIGNvbnN0IHJlcXVlc3RQcm9taXNlID0gcmVxdWVzdC5ydW4oe1xuICAgICAgICBzaWduYWw6IHJlcXVlc3RBYm9ydENvbnRyb2xsZXIuc2lnbmFsLFxuICAgICAgICBvbkNvbm5lY3Q6IChqc29uU29ja2V0KSA9PiB7XG4gICAgICAgICAganNvblNvY2tldC5zZW5kKG1lc3NhZ2UpXG4gICAgICAgICAgYXR0ZW1wdE9ic2VydmF0aW9uLmdlbmVyYXRpb25GZW5jZWQgPSBCb29sZWFuKHJlcXVlc3QuZ2VuZXJhdGlvbklkKVxuICAgICAgICAgIGF0dGVtcHRPYnNlcnZhdGlvbi5yZXF1ZXN0U2VudCA9IHRydWVcbiAgICAgICAgICByZXF1ZXN0U2VudEF0TXMgPSBEYXRlLm5vdygpXG4gICAgICAgICAgbWFya1JlcXVlc3RTZW50KClcbiAgICAgICAgfSxcbiAgICAgICAgb25NZXNzYWdlOiAoe21lc3NhZ2UsIHJlc29sdmUsIHJlamVjdH0pID0+IHtcbiAgICAgICAgICBpZiAobWVzc2FnZT8udHlwZSA9PT0gXCJlbnF1ZXVlZFwiKSB7XG4gICAgICAgICAgICByZXNvbHZlKG1lc3NhZ2Uuam9iSWQpXG4gICAgICAgICAgICByZXR1cm5cbiAgICAgICAgICB9XG5cbiAgICAgICAgICBpZiAobWVzc2FnZT8udHlwZSA9PT0gXCJlbnF1ZXVlLWVycm9yXCIpIHtcbiAgICAgICAgICAgIGF0dGVtcHRPYnNlcnZhdGlvbi5leHBsaWNpdGx5UmVqZWN0ZWQgPSB0cnVlXG4gICAgICAgICAgICByZWplY3QobmV3IEVycm9yKG1lc3NhZ2UuZXJyb3IgfHwgXCJGYWlsZWQgdG8gZW5xdWV1ZSBqb2JcIikpXG4gICAgICAgICAgfVxuICAgICAgICB9XG4gICAgICB9KVxuXG4gICAgICBhd2FpdCB3aXRoRW5xdWV1ZVRpbWVvdXQoYXN5bmMgKCkgPT4gYXdhaXQgUHJvbWlzZS5yYWNlKFtyZXF1ZXN0U2VudCwgcmVxdWVzdFByb21pc2VdKSlcblxuICAgICAgdHJ5IHtcbiAgICAgICAgcmV0dXJuIGF3YWl0IHdpdGhFbnF1ZXVlVGltZW91dChhc3luYyAoKSA9PiBhd2FpdCByZXF1ZXN0UHJvbWlzZSlcbiAgICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICAgIGlmICghKGVycm9yIGluc3RhbmNlb2YgVGltZW91dEVycm9yKSkgdGhyb3cgZXJyb3JcbiAgICAgICAgaWYgKHJlcXVlc3RTZW50QXRNcyA9PT0gdW5kZWZpbmVkKSB0aHJvdyBuZXcgRXJyb3IoXCJCYWNrZ3JvdW5kIGpvYiBlbnF1ZXVlIGFja25vd2xlZGdlbWVudCB3YWl0IHN0YXJ0ZWQgYmVmb3JlIHRoZSByZXF1ZXN0IHdhcyBzZW50XCIsIHtjYXVzZTogZXJyb3J9KVxuXG4gICAgICAgIGNvbnN0IHRpbWVkT3V0QXRNcyA9IERhdGUubm93KClcblxuICAgICAgICBhdHRlbXB0T2JzZXJ2YXRpb24uYWNrbm93bGVkZ2VtZW50V2FpdEVsYXBzZWRNcyA9IHRpbWVkT3V0QXRNcyAtIHJlcXVlc3RTZW50QXRNc1xuICAgICAgICBhdHRlbXB0T2JzZXJ2YXRpb24uYXR0ZW1wdEVsYXBzZWRNcyA9IHRpbWVkT3V0QXRNcyAtIGF0dGVtcHRTdGFydGVkQXRNc1xuXG4gICAgICAgIHRocm93IG5ldyBCYWNrZ3JvdW5kSm9iRW5xdWV1ZUFja25vd2xlZGdlbWVudFRpbWVvdXRFcnJvcih7XG4gICAgICAgICAgYWNrbm93bGVkZ2VtZW50VGltZW91dE1zOiB0aGlzLmVucXVldWVUaW1lb3V0TXMsXG4gICAgICAgICAgYXR0ZW1wdEhpc3Rvcnk6IFsuLi5wcmV2aW91c0F0dGVtcHRzLCBhdHRlbXB0T2JzZXJ2YXRpb25dLFxuICAgICAgICAgIGNhdXNlOiBlcnJvcixcbiAgICAgICAgICBnZW5lcmF0aW9uSWQ6IHJlcXVlc3QuZ2VuZXJhdGlvbklkLFxuICAgICAgICAgIGpvYk5hbWUsXG4gICAgICAgICAgcHJvZHVjZXJJbnZvY2F0aW9uSWQsXG4gICAgICAgICAgcHJvZHVjZXJQcm9vZlByZXNlbnQ6IEJvb2xlYW4ocHJvZHVjZXJQcm9vZilcbiAgICAgICAgfSlcbiAgICAgIH1cbiAgICB9XG5cbiAgICBjb25zdCBpbml0aWFsQXR0ZW1wdCA9IG5ld0F0dGVtcHRPYnNlcnZhdGlvbih7YXR0ZW1wdEtpbmQ6IFwiaW5pdGlhbFwiLCBhdHRlbXB0TnVtYmVyOiAxfSlcblxuICAgIHRyeSB7XG4gICAgICByZXR1cm4gYXdhaXQgZW5xdWV1ZUF0dGVtcHQoaW5pdGlhbEF0dGVtcHQsIFtdKVxuICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICBpZiAoIXByb2R1Y2VySW52b2NhdGlvbklkIHx8ICFwcm9kdWNlclByb29mIHx8ICFpbml0aWFsQXR0ZW1wdC5nZW5lcmF0aW9uRmVuY2VkIHx8ICFpbml0aWFsQXR0ZW1wdC5yZXF1ZXN0U2VudCB8fCBpbml0aWFsQXR0ZW1wdC5leHBsaWNpdGx5UmVqZWN0ZWQpIHRocm93IGVycm9yXG5cbiAgICAgIGNvbnN0IHByZXZpb3VzQXR0ZW1wdHMgPSBlcnJvciBpbnN0YW5jZW9mIEJhY2tncm91bmRKb2JFbnF1ZXVlQWNrbm93bGVkZ2VtZW50VGltZW91dEVycm9yID8gZXJyb3IuYXR0ZW1wdEhpc3RvcnkgOiBbXVxuICAgICAgY29uc3QgcmVwbGF5QXR0ZW1wdCA9IG5ld0F0dGVtcHRPYnNlcnZhdGlvbih7YXR0ZW1wdEtpbmQ6IFwib3duZWRfcmVwbGF5XCIsIGF0dGVtcHROdW1iZXI6IDJ9KVxuXG4gICAgICByZXR1cm4gYXdhaXQgZW5xdWV1ZUF0dGVtcHQocmVwbGF5QXR0ZW1wdCwgcHJldmlvdXNBdHRlbXB0cylcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogQXRvbWljYWxseSByZXBsYWNlcyB0aGUgcXVldWVkIG93bmVyIG9mIGEgc3RhYmxlIHNjaGVkdWxlIGtleS5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBPcHRpb25zLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gYXJncy5zY2hlZHVsZUtleSAtIFN0YWJsZSBsb2dpY2FsIHNjaGVkdWxlIGtleS5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGFyZ3Muam9iTmFtZSAtIEpvYiBuYW1lLlxuICAgKiBAcGFyYW0ge0FycmF5PFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gYXJncy5hcmdzIC0gSm9iIGFyZ3MuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi90eXBlcy5qc1wiKS5CYWNrZ3JvdW5kSm9iT3B0aW9uc30gW2FyZ3Mub3B0aW9uc10gLSBKb2Igb3B0aW9ucy5cbiAgICogQHJldHVybnMge1Byb21pc2U8aW1wb3J0KFwiLi90eXBlcy5qc1wiKS5CYWNrZ3JvdW5kSm9iUmVwbGFjZW1lbnRSZXN1bHQ+fSAtIFJlcGxhY2VtZW50IHJlc3VsdC5cbiAgICovXG4gIGFzeW5jIHJlcGxhY2VTY2hlZHVsZWQoe3NjaGVkdWxlS2V5LCBqb2JOYW1lLCBhcmdzLCBvcHRpb25zfSkge1xuICAgIGNvbnN0IHJlcXVlc3QgPSBhd2FpdCB0aGlzLl9yZXF1ZXN0KClcblxuICAgIHJldHVybiBhd2FpdCByZXF1ZXN0LnJ1bih7XG4gICAgICBvbkNvbm5lY3Q6IChqc29uU29ja2V0KSA9PiB7XG4gICAgICAgIGpzb25Tb2NrZXQuc2VuZCh7dHlwZTogXCJyZXBsYWNlLXNjaGVkdWxlZFwiLCBzY2hlZHVsZUtleSwgam9iTmFtZSwgYXJncywgb3B0aW9uc30pXG4gICAgICB9LFxuICAgICAgb25NZXNzYWdlOiAoe21lc3NhZ2UsIHJlc29sdmUsIHJlamVjdH0pID0+IHtcbiAgICAgICAgaWYgKG1lc3NhZ2U/LnR5cGUgPT09IFwic2NoZWR1bGUtcmVwbGFjZWRcIikge1xuICAgICAgICAgIHJlc29sdmUoe1xuICAgICAgICAgICAgam9iSWQ6IG1lc3NhZ2Uuam9iSWQsXG4gICAgICAgICAgICBwcmV2aW91c0pvYklkOiBtZXNzYWdlLnByZXZpb3VzSm9iSWQsXG4gICAgICAgICAgICBwcmV2aW91c1N0YXR1czogbWVzc2FnZS5wcmV2aW91c1N0YXR1c1xuICAgICAgICAgIH0pXG4gICAgICAgICAgcmV0dXJuXG4gICAgICAgIH1cblxuICAgICAgICBpZiAobWVzc2FnZT8udHlwZSA9PT0gXCJyZXBsYWNlLXNjaGVkdWxlZC1lcnJvclwiKSB7XG4gICAgICAgICAgcmVqZWN0KG5ldyBFcnJvcihtZXNzYWdlLmVycm9yIHx8IFwiRmFpbGVkIHRvIHJlcGxhY2Ugc2NoZWR1bGVkIGpvYlwiKSlcbiAgICAgICAgfVxuICAgICAgfVxuICAgIH0pXG4gIH1cblxuICAvKipcbiAgICogQ2FuY2VscyBvciBkZXRhY2hlcyB0aGUgY3VycmVudCBvd25lciBvZiBhIHN0YWJsZSBzY2hlZHVsZSBrZXkuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gT3B0aW9ucy5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGFyZ3Muc2NoZWR1bGVLZXkgLSBTdGFibGUgbG9naWNhbCBzY2hlZHVsZSBrZXkuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPGltcG9ydChcIi4vdHlwZXMuanNcIikuQmFja2dyb3VuZEpvYkNhbmNlbGxhdGlvblJlc3VsdD59IC0gQ2FuY2VsbGF0aW9uIHJlc3VsdC5cbiAgICovXG4gIGFzeW5jIGNhbmNlbFNjaGVkdWxlZCh7c2NoZWR1bGVLZXl9KSB7XG4gICAgY29uc3QgcmVxdWVzdCA9IGF3YWl0IHRoaXMuX3JlcXVlc3QoKVxuXG4gICAgcmV0dXJuIGF3YWl0IHJlcXVlc3QucnVuKHtcbiAgICAgIG9uQ29ubmVjdDogKGpzb25Tb2NrZXQpID0+IHtcbiAgICAgICAganNvblNvY2tldC5zZW5kKHt0eXBlOiBcImNhbmNlbC1zY2hlZHVsZWRcIiwgc2NoZWR1bGVLZXl9KVxuICAgICAgfSxcbiAgICAgIG9uTWVzc2FnZTogKHttZXNzYWdlLCByZXNvbHZlLCByZWplY3R9KSA9PiB7XG4gICAgICAgIGlmIChtZXNzYWdlPy50eXBlID09PSBcInNjaGVkdWxlLWNhbmNlbGxlZFwiKSB7XG4gICAgICAgICAgcmVzb2x2ZSh7am9iSWQ6IG1lc3NhZ2Uuam9iSWQsIG91dGNvbWU6IG1lc3NhZ2Uub3V0Y29tZX0pXG4gICAgICAgICAgcmV0dXJuXG4gICAgICAgIH1cblxuICAgICAgICBpZiAobWVzc2FnZT8udHlwZSA9PT0gXCJjYW5jZWwtc2NoZWR1bGVkLWVycm9yXCIpIHtcbiAgICAgICAgICByZWplY3QobmV3IEVycm9yKG1lc3NhZ2UuZXJyb3IgfHwgXCJGYWlsZWQgdG8gY2FuY2VsIHNjaGVkdWxlZCBqb2JcIikpXG4gICAgICAgIH1cbiAgICAgIH1cbiAgICB9KVxuICB9XG59XG4iXX0=