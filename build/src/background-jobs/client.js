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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiY2xpZW50LmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiLi4vLi4vLi4vc3JjL2JhY2tncm91bmQtam9icy9jbGllbnQuanMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6IkFBQUEsWUFBWTtBQUVaLE9BQU8sT0FBTyxFQUFFLEVBQUMsWUFBWSxFQUFDLE1BQU0sMkJBQTJCLENBQUE7QUFDL0QsT0FBTyxxQkFBcUIsTUFBTSw4QkFBOEIsQ0FBQTtBQUNoRSxPQUFPLCtDQUErQyxNQUFNLDRDQUE0QyxDQUFBO0FBQ3hHLE9BQU8sMkJBQTJCLE1BQU0scUJBQXFCLENBQUE7QUFDN0QsT0FBTyxFQUFFLHVDQUF1QyxFQUFFLG9DQUFvQyxFQUFFLE1BQU0seUNBQXlDLENBQUE7QUFFdkksTUFBTSwwQkFBMEIsR0FBRyxJQUFJLENBQUE7QUFFdkMsTUFBTSxDQUFDLE9BQU8sT0FBTyxvQkFBb0I7SUFDdkM7Ozs7Ozs7T0FPRztJQUNILFlBQVksRUFBQyxhQUFhLEVBQUUsZ0JBQWdCLEdBQUcsMEJBQTBCLEVBQUUsNEJBQTRCLEdBQUcsdUNBQXVDLEVBQUUsWUFBWSxFQUFDLEdBQUcsRUFBRTtRQUNuSyxJQUFJLENBQUMsb0JBQW9CLEdBQUcsYUFBYSxDQUFDLENBQUMsQ0FBQyxPQUFPLENBQUMsT0FBTyxDQUFDLGFBQWEsQ0FBQyxDQUFDLENBQUMsQ0FBQyxxQkFBcUIsRUFBRSxDQUFBO1FBQ3BHLElBQUksQ0FBQyxnQkFBZ0IsR0FBRyxnQkFBZ0IsQ0FBQTtRQUN4QyxJQUFJLENBQUMsNEJBQTRCLEdBQUcsb0NBQW9DLENBQUMsNEJBQTRCLENBQUMsQ0FBQTtRQUN0RyxJQUFJLENBQUMsb0JBQW9CLEdBQUcsWUFBWSxDQUFBO0lBQzFDLENBQUM7SUFFRDs7O09BR0c7SUFDSCxLQUFLLENBQUMsUUFBUTtRQUNaLE1BQU0sYUFBYSxHQUFHLE1BQU0sSUFBSSxDQUFDLG9CQUFvQixDQUFBO1FBQ3JELE1BQU0sRUFBQyxJQUFJLEVBQUUsSUFBSSxFQUFDLEdBQUcs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QUMsQ0FBQTtJQUNKLENBQUM7Q0FDRiIsInNvdXJjZXNDb250ZW50IjpbIi8vIEB0cy1jaGVja1xuXG5pbXBvcnQgdGltZW91dCwge1RpbWVvdXRFcnJvcn0gZnJvbSBcImF3YWl0ZXJ5L2J1aWxkL3RpbWVvdXQuanNcIlxuaW1wb3J0IGNvbmZpZ3VyYXRpb25SZXNvbHZlciBmcm9tIFwiLi4vY29uZmlndXJhdGlvbi1yZXNvbHZlci5qc1wiXG5pbXBvcnQgQmFja2dyb3VuZEpvYkVucXVldWVBY2tub3dsZWRnZW1lbnRUaW1lb3V0RXJyb3IgZnJvbSBcIi4vZW5xdWV1ZS1hY2tub3dsZWRnZW1lbnQtdGltZW91dC1lcnJvci5qc1wiXG5pbXBvcnQgQmFja2dyb3VuZEpvYnNTb2NrZXRSZXF1ZXN0IGZyb20gXCIuL3NvY2tldC1yZXF1ZXN0LmpzXCJcbmltcG9ydCB7IERFRkFVTFRfR0VORVJBVElPTl9IQU5EU0hBS0VfVElNRU9VVF9NUywgdmFsaWRhdGVHZW5lcmF0aW9uSGFuZHNoYWtlVGltZW91dE1zIH0gZnJvbSBcIi4vZ2VuZXJhdGlvbi1oYW5kc2hha2UtdGltZW91dC1lcnJvci5qc1wiXG5cbmNvbnN0IERFRkFVTFRfRU5RVUVVRV9USU1FT1VUX01TID0gNTAwMFxuXG5leHBvcnQgZGVmYXVsdCBjbGFzcyBCYWNrZ3JvdW5kSm9ic0NsaWVudCB7XG4gIC8qKlxuICAgKiBSdW5zIGNvbnN0cnVjdG9yLlxuICAgKiBAcGFyYW0ge29iamVjdH0gW2FyZ3NdIC0gT3B0aW9ucy5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9jb25maWd1cmF0aW9uLmpzXCIpLmRlZmF1bHR9IFthcmdzLmNvbmZpZ3VyYXRpb25dIC0gQ29uZmlndXJhdGlvbi5cbiAgICogQHBhcmFtIHtudW1iZXJ9IFthcmdzLmVucXVldWVUaW1lb3V0TXNdIC0gTWF4aW11bSB0aW1lIHRvIHdhaXQgZm9yIGFuIGVucXVldWUgYWNrbm93bGVkZ2VtZW50IGluIG1pbGxpc2Vjb25kcyAoZGVmYXVsdDogNTAwMCkuXG4gICAqIEBwYXJhbSB7bnVtYmVyfSBbYXJncy5nZW5lcmF0aW9uSGFuZHNoYWtlVGltZW91dE1zXSAtIE1heGltdW0gdGltZSB0byB3YWl0IGZvciBnZW5lcmF0aW9uIGFja25vd2xlZGdlbWVudCAoZGVmYXVsdDogNDAwMCkuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBbYXJncy5nZW5lcmF0aW9uSWRdIC0gRXhwbGljaXQgcmVsZWFzZSBnZW5lcmF0aW9uIGlkZW50aXR5LlxuICAgKi9cbiAgY29uc3RydWN0b3Ioe2NvbmZpZ3VyYXRpb24sIGVucXVldWVUaW1lb3V0TXMgPSBERUZBVUxUX0VOUVVFVUVfVElNRU9VVF9NUywgZ2VuZXJhdGlvbkhhbmRzaGFrZVRpbWVvdXRNcyA9IERFRkFVTFRfR0VORVJBVElPTl9IQU5EU0hBS0VfVElNRU9VVF9NUywgZ2VuZXJhdGlvbklkfSA9IHt9KSB7XG4gICAgdGhpcy5jb25maWd1cmF0aW9uUHJvbWlzZSA9IGNvbmZpZ3VyYXRpb24gPyBQcm9taXNlLnJlc29sdmUoY29uZmlndXJhdGlvbikgOiBjb25maWd1cmF0aW9uUmVzb2x2ZXIoKVxuICAgIHRoaXMuZW5xdWV1ZVRpbWVvdXRNcyA9IGVucXVldWVUaW1lb3V0TXNcbiAgICB0aGlzLmdlbmVyYXRpb25IYW5kc2hha2VUaW1lb3V0TXMgPSB2YWxpZGF0ZUdlbmVyYXRpb25IYW5kc2hha2VUaW1lb3V0TXMoZ2VuZXJhdGlvbkhhbmRzaGFrZVRpbWVvdXRNcylcbiAgICB0aGlzLmV4cGxpY2l0R2VuZXJhdGlvbklkID0gZ2VuZXJhdGlvbklkXG4gIH1cblxuICAvKipcbiAgICogQnVpbGRzIGEgb25lLXNob3QgY2xpZW50IHNvY2tldCByZXF1ZXN0IGZyb20gdGhlIHJlc29sdmVkIGNvbmZpZ3VyYXRpb24uXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPEJhY2tncm91bmRKb2JzU29ja2V0UmVxdWVzdD59IC0gU29ja2V0IHJlcXVlc3QuXG4gICAqL1xuICBhc3luYyBfcmVxdWVzdCgpIHtcbiAgICBjb25zdCBjb25maWd1cmF0aW9uID0gYXdhaXQgdGhpcy5jb25maWd1cmF0aW9uUHJvbWlzZVxuICAgIGNvbnN0IHtob3N0LCBwb3J0fSA9IGNvbmZpZ3VyYXRpb24uZ2V0QmFja2dyb3VuZEpvYnNDb25maWcoKVxuICAgIGNvbnN0IHtnZW5lcmF0aW9uSWR9ID0gY29uZmlndXJhdGlvbi5yZXNvbHZlQmFja2dyb3VuZEpvYnNHZW5lcmF0aW9uQ29uZmlnKHtcbiAgICAgIGdlbmVyYXRpb25JZDogdGhpcy5leHBsaWNpdEdlbmVyYXRpb25JZCxcbiAgICAgIHNvdXJjZU5hbWU6IFwiQmFja2dyb3VuZEpvYnNDbGllbnRcIlxuICAgIH0pXG5cbiAgICByZXR1cm4gbmV3IEJhY2tncm91bmRKb2JzU29ja2V0UmVxdWVzdCh7aG9zdCwgcG9ydCwgcm9sZTogXCJjbGllbnRcIiwgZ2VuZXJhdGlvbkhhbmRzaGFrZVRpbWVvdXRNczogdGhpcy5nZW5lcmF0aW9uSGFuZHNoYWtlVGltZW91dE1zLCBnZW5lcmF0aW9uSWR9KVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZW5xdWV1ZS5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBPcHRpb25zLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gYXJncy5qb2JOYW1lIC0gSm9iIG5hbWUuXG4gICAqIEBwYXJhbSB7QXJyYXk8UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSBhcmdzLmFyZ3MgLSBKb2IgYXJncy5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL3R5cGVzLmpzXCIpLkJhY2tncm91bmRKb2JPcHRpb25zfSBbYXJncy5vcHRpb25zXSAtIEpvYiBvcHRpb25zLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gW2FyZ3MucHJvZHVjZXJJbnZvY2F0aW9uSWRdIC0gU3RhYmxlIGlkZW50aXR5IGZvciBvbmUgb3duZWQgZW5xdWV1ZSBpbnZvY2F0aW9uLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vdHlwZXMuanNcIikuQmFja2dyb3VuZEpvYlByb2R1Y2VyUHJvb2Z9IFthcmdzLnByb2R1Y2VyUHJvb2ZdIC0gRXhhY3QgaW50ZXJuYWwgcHJvZHVjZXIgaGFuZG9mZi5cbiAgICogQHJldHVybnMge1Byb21pc2U8c3RyaW5nPn0gLSBKb2IgaWQuXG4gICAqL1xuICBhc3luYyBlbnF1ZXVlKHtqb2JOYW1lLCBhcmdzLCBvcHRpb25zLCBwcm9kdWNlckludm9jYXRpb25JZCwgcHJvZHVjZXJQcm9vZn0pIHtcbiAgICBjb25zdCBtZXNzYWdlID0ge1xuICAgICAgdHlwZTogLyoqIEB0eXBlIHtjb25zdH0gKi8gKFwiZW5xdWV1ZVwiKSxcbiAgICAgIGpvYk5hbWUsXG4gICAgICBhcmdzLFxuICAgICAgb3B0aW9ucyxcbiAgICAgIC4uLihwcm9kdWNlckludm9jYXRpb25JZCA/IHtwcm9kdWNlckludm9jYXRpb25JZH0gOiB7fSksXG4gICAgICAuLi4ocHJvZHVjZXJQcm9vZiA/IHtwcm9kdWNlclByb29mfSA6IHt9KVxuICAgIH1cbiAgICAvKipcbiAgICAgKiBDcmVhdGVzIHNhZmUgb2JzZXJ2YXRpb25zIGZvciBvbmUgYXR0ZW1wdCB3aXRob3V0IHJldGFpbmluZyByZXF1ZXN0IGRhdGEuXG4gICAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBBdHRlbXB0IGlkZW50aXR5LlxuICAgICAqIEBwYXJhbSB7XCJpbml0aWFsXCIgfCBcIm93bmVkX3JlcGxheVwifSBhcmdzLmF0dGVtcHRLaW5kIC0gSW5pdGlhbCBhdHRlbXB0IG9yIG93bmVkIHJlcGxheS5cbiAgICAgKiBAcGFyYW0ge251bWJlcn0gYXJncy5hdHRlbXB0TnVtYmVyIC0gT25lLWJhc2VkIGF0dGVtcHQgbnVtYmVyLlxuICAgICAqIEByZXR1cm5zIHtpbXBvcnQoXCIuL2VucXVldWUtYWNrbm93bGVkZ2VtZW50LXRpbWVvdXQtZXJyb3IuanNcIikuQmFja2dyb3VuZEpvYkVucXVldWVBdHRlbXB0fSAtIE11dGFibGUgYXR0ZW1wdCBvYnNlcnZhdGlvbnMuXG4gICAgICovXG4gICAgY29uc3QgbmV3QXR0ZW1wdE9ic2VydmF0aW9uID0gKHthdHRlbXB0S2luZCwgYXR0ZW1wdE51bWJlcn0pID0+ICh7XG4gICAgICBhY2tub3dsZWRnZW1lbnRXYWl0RWxhcHNlZE1zOiAwLFxuICAgICAgYXR0ZW1wdEVsYXBzZWRNczogMCxcbiAgICAgIGF0dGVtcHRLaW5kLFxuICAgICAgYXR0ZW1wdE51bWJlcixcbiAgICAgIGV4cGxpY2l0bHlSZWplY3RlZDogZmFsc2UsXG4gICAgICBnZW5lcmF0aW9uRmVuY2VkOiBmYWxzZSxcbiAgICAgIHJlcXVlc3RTZW50OiBmYWxzZVxuICAgIH0pXG4gICAgLyoqXG4gICAgICogU2VuZHMgb25lIGVucXVldWUgYXR0ZW1wdC4gQW4gb3duZWQgY2FsbGVyIG1heSByZXBsYXkgdGhpcyBleGFjdCBtZXNzYWdlXG4gICAgICogb25jZSB3aGVuIHRyYW5zcG9ydCBhY2tub3dsZWRnZW1lbnQgcmVtYWlucyBhbWJpZ3VvdXMgYWZ0ZXIgc2VuZC5cbiAgICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vZW5xdWV1ZS1hY2tub3dsZWRnZW1lbnQtdGltZW91dC1lcnJvci5qc1wiKS5CYWNrZ3JvdW5kSm9iRW5xdWV1ZUF0dGVtcHR9IGF0dGVtcHRPYnNlcnZhdGlvbiAtIE11dGFibGUgYXR0ZW1wdCBvYnNlcnZhdGlvbnMuXG4gICAgICogQHBhcmFtIHtSZWFkb25seTxBcnJheTxpbXBvcnQoXCIuL2VucXVldWUtYWNrbm93bGVkZ2VtZW50LXRpbWVvdXQtZXJyb3IuanNcIikuQmFja2dyb3VuZEpvYkVucXVldWVBdHRlbXB0Pj59IHByZXZpb3VzQXR0ZW1wdHMgLSBFYXJsaWVyIHRpbWVkLW91dCBhdHRlbXB0cy5cbiAgICAgKiBAcmV0dXJucyB7UHJvbWlzZTxzdHJpbmc+fSAtIEpvYiBpZC5cbiAgICAgKi9cbiAgICBjb25zdCBlbnF1ZXVlQXR0ZW1wdCA9IGFzeW5jIChhdHRlbXB0T2JzZXJ2YXRpb24sIHByZXZpb3VzQXR0ZW1wdHMpID0+IHtcbiAgICAgIGNvbnN0IGF0dGVtcHRTdGFydGVkQXRNcyA9IERhdGUubm93KClcbiAgICAgIGNvbnN0IHJlcXVlc3QgPSBhd2FpdCB0aGlzLl9yZXF1ZXN0KClcbiAgICAgIGNvbnN0IHJlcXVlc3RBYm9ydENvbnRyb2xsZXIgPSBuZXcgQWJvcnRDb250cm9sbGVyKClcbiAgICAgIGNvbnN0IHRpbWVvdXRFcnJvck1lc3NhZ2UgPSBgQmFja2dyb3VuZCBqb2IgZW5xdWV1ZSBhY2tub3dsZWRnZW1lbnQgdGltZWQgb3V0IGFmdGVyICR7dGhpcy5lbnF1ZXVlVGltZW91dE1zfW1zYFxuICAgICAgLyoqIEB0eXBlIHtudW1iZXIgfCB1bmRlZmluZWR9ICovXG4gICAgICBsZXQgcmVxdWVzdFNlbnRBdE1zXG4gICAgICAvKipcbiAgICAgICAqIFJlc29sdmVzIHRoZSBwcmUtc2VuZCBwaGFzZSB3aGVuIHRoZSBtdXRhdGlvbiBoYXMgZW50ZXJlZCB0aGUgc29ja2V0LlxuICAgICAgICogQHR5cGUgeygpID0+IHZvaWR9XG4gICAgICAgKi9cbiAgICAgIGxldCBtYXJrUmVxdWVzdFNlbnQgPSAoKSA9PiB7fVxuICAgICAgY29uc3QgcmVxdWVzdFNlbnQgPSBuZXcgUHJvbWlzZSgocmVzb2x2ZSkgPT4ge1xuICAgICAgICBtYXJrUmVxdWVzdFNlbnQgPSAoKSA9PiByZXNvbHZlKHVuZGVmaW5lZClcbiAgICAgIH0pXG4gICAgICAvKipcbiAgICAgICAqIEFwcGxpZXMgdGhlIGNvbmZpZ3VyZWQgZGVhZGxpbmUgaW5kZXBlbmRlbnRseSB0byBvbmUgcmVxdWVzdCBwaGFzZS5cbiAgICAgICAqIEB0ZW1wbGF0ZSBUXG4gICAgICAgKiBAcGFyYW0geygpID0+IFByb21pc2U8VD59IGNhbGxiYWNrIC0gUGhhc2Ugd29yay5cbiAgICAgICAqIEByZXR1cm5zIHtQcm9taXNlPFQ+fSAtIFBoYXNlIHJlc3VsdC5cbiAgICAgICAqL1xuICAgICAgY29uc3Qgd2l0aEVucXVldWVUaW1lb3V0ID0gYXN5bmMgKGNhbGxiYWNrKSA9PiBhd2FpdCB0aW1lb3V0KHtcbiAgICAgICAgZXJyb3JNZXNzYWdlOiB0aW1lb3V0RXJyb3JNZXNzYWdlLFxuICAgICAgICB0aW1lb3V0OiB0aGlzLmVucXVldWVUaW1lb3V0TXNcbiAgICAgIH0sIGFzeW5jICh7Y29udHJvbH0pID0+IHtcbiAgICAgICAgY29uc3QgYWJvcnRSZXF1ZXN0ID0gKCkgPT4gcmVxdWVzdEFib3J0Q29udHJvbGxlci5hYm9ydChjb250cm9sLnNpZ25hbC5yZWFzb24pXG5cbiAgICAgICAgY29udHJvbC5zaWduYWwuYWRkRXZlbnRMaXN0ZW5lcihcImFib3J0XCIsIGFib3J0UmVxdWVzdClcbiAgICAgICAgdHJ5IHtcbiAgICAgICAgICByZXR1cm4gYXdhaXQgY2FsbGJhY2soKVxuICAgICAgICB9IGZpbmFsbHkge1xuICAgICAgICAgIGNvbnRyb2wuc2lnbmFsLnJlbW92ZUV2ZW50TGlzdGVuZXIoXCJhYm9ydFwiLCBhYm9ydFJlcXVlc3QpXG4gICAgICAgIH1cbiAgICAgIH0pXG4gICAgICBjb25zdCByZXF1ZXN0UHJvbWlzZSA9IHJlcXVlc3QucnVuKHtcbiAgICAgICAgc2lnbmFsOiByZXF1ZXN0QWJvcnRDb250cm9sbGVyLnNpZ25hbCxcbiAgICAgICAgb25Db25uZWN0OiAoanNvblNvY2tldCkgPT4ge1xuICAgICAgICAgIGpzb25Tb2NrZXQuc2VuZChtZXNzYWdlKVxuICAgICAgICAgIGF0dGVtcHRPYnNlcnZhdGlvbi5nZW5lcmF0aW9uRmVuY2VkID0gQm9vbGVhbihyZXF1ZXN0LmdlbmVyYXRpb25JZClcbiAgICAgICAgICBhdHRlbXB0T2JzZXJ2YXRpb24ucmVxdWVzdFNlbnQgPSB0cnVlXG4gICAgICAgICAgcmVxdWVzdFNlbnRBdE1zID0gRGF0ZS5ub3coKVxuICAgICAgICAgIG1hcmtSZXF1ZXN0U2VudCgpXG4gICAgICAgIH0sXG4gICAgICAgIG9uTWVzc2FnZTogKHttZXNzYWdlLCByZXNvbHZlLCByZWplY3R9KSA9PiB7XG4gICAgICAgICAgaWYgKG1lc3NhZ2U/LnR5cGUgPT09IFwiZW5xdWV1ZWRcIikge1xuICAgICAgICAgICAgcmVzb2x2ZShtZXNzYWdlLmpvYklkKVxuICAgICAgICAgICAgcmV0dXJuXG4gICAgICAgICAgfVxuXG4gICAgICAgICAgaWYgKG1lc3NhZ2U/LnR5cGUgPT09IFwiZW5xdWV1ZS1lcnJvclwiKSB7XG4gICAgICAgICAgICBhdHRlbXB0T2JzZXJ2YXRpb24uZXhwbGljaXRseVJlamVjdGVkID0gdHJ1ZVxuICAgICAgICAgICAgcmVqZWN0KG5ldyBFcnJvcihtZXNzYWdlLmVycm9yIHx8IFwiRmFpbGVkIHRvIGVucXVldWUgam9iXCIpKVxuICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgICAgfSlcblxuICAgICAgYXdhaXQgd2l0aEVucXVldWVUaW1lb3V0KGFzeW5jICgpID0+IGF3YWl0IFByb21pc2UucmFjZShbcmVxdWVzdFNlbnQsIHJlcXVlc3RQcm9taXNlXSkpXG5cbiAgICAgIHRyeSB7XG4gICAgICAgIHJldHVybiBhd2FpdCB3aXRoRW5xdWV1ZVRpbWVvdXQoYXN5bmMgKCkgPT4gYXdhaXQgcmVxdWVzdFByb21pc2UpXG4gICAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgICBpZiAoIShlcnJvciBpbnN0YW5jZW9mIFRpbWVvdXRFcnJvcikpIHRocm93IGVycm9yXG4gICAgICAgIGlmIChyZXF1ZXN0U2VudEF0TXMgPT09IHVuZGVmaW5lZCkgdGhyb3cgbmV3IEVycm9yKFwiQmFja2dyb3VuZCBqb2IgZW5xdWV1ZSBhY2tub3dsZWRnZW1lbnQgd2FpdCBzdGFydGVkIGJlZm9yZSB0aGUgcmVxdWVzdCB3YXMgc2VudFwiLCB7Y2F1c2U6IGVycm9yfSlcblxuICAgICAgICBjb25zdCB0aW1lZE91dEF0TXMgPSBEYXRlLm5vdygpXG5cbiAgICAgICAgYXR0ZW1wdE9ic2VydmF0aW9uLmFja25vd2xlZGdlbWVudFdhaXRFbGFwc2VkTXMgPSB0aW1lZE91dEF0TXMgLSByZXF1ZXN0U2VudEF0TXNcbiAgICAgICAgYXR0ZW1wdE9ic2VydmF0aW9uLmF0dGVtcHRFbGFwc2VkTXMgPSB0aW1lZE91dEF0TXMgLSBhdHRlbXB0U3RhcnRlZEF0TXNcblxuICAgICAgICB0aHJvdyBuZXcgQmFja2dyb3VuZEpvYkVucXVldWVBY2tub3dsZWRnZW1lbnRUaW1lb3V0RXJyb3Ioe1xuICAgICAgICAgIGFja25vd2xlZGdlbWVudFRpbWVvdXRNczogdGhpcy5lbnF1ZXVlVGltZW91dE1zLFxuICAgICAgICAgIGF0dGVtcHRIaXN0b3J5OiBbLi4ucHJldmlvdXNBdHRlbXB0cywgYXR0ZW1wdE9ic2VydmF0aW9uXSxcbiAgICAgICAgICBjYXVzZTogZXJyb3IsXG4gICAgICAgICAgZ2VuZXJhdGlvbklkOiByZXF1ZXN0LmdlbmVyYXRpb25JZCxcbiAgICAgICAgICBqb2JOYW1lLFxuICAgICAgICAgIHByb2R1Y2VySW52b2NhdGlvbklkLFxuICAgICAgICAgIHByb2R1Y2VyUHJvb2ZQcmVzZW50OiBCb29sZWFuKHByb2R1Y2VyUHJvb2YpXG4gICAgICAgIH0pXG4gICAgICB9XG4gICAgfVxuXG4gICAgY29uc3QgaW5pdGlhbEF0dGVtcHQgPSBuZXdBdHRlbXB0T2JzZXJ2YXRpb24oe2F0dGVtcHRLaW5kOiBcImluaXRpYWxcIiwgYXR0ZW1wdE51bWJlcjogMX0pXG5cbiAgICB0cnkge1xuICAgICAgcmV0dXJuIGF3YWl0IGVucXVldWVBdHRlbXB0KGluaXRpYWxBdHRlbXB0LCBbXSlcbiAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgaWYgKCFwcm9kdWNlckludm9jYXRpb25JZCB8fCAhcHJvZHVjZXJQcm9vZiB8fCAhaW5pdGlhbEF0dGVtcHQuZ2VuZXJhdGlvbkZlbmNlZCB8fCAhaW5pdGlhbEF0dGVtcHQucmVxdWVzdFNlbnQgfHwgaW5pdGlhbEF0dGVtcHQuZXhwbGljaXRseVJlamVjdGVkKSB0aHJvdyBlcnJvclxuXG4gICAgICBjb25zdCBwcmV2aW91c0F0dGVtcHRzID0gZXJyb3IgaW5zdGFuY2VvZiBCYWNrZ3JvdW5kSm9iRW5xdWV1ZUFja25vd2xlZGdlbWVudFRpbWVvdXRFcnJvciA/IGVycm9yLmF0dGVtcHRIaXN0b3J5IDogW11cbiAgICAgIGNvbnN0IHJlcGxheUF0dGVtcHQgPSBuZXdBdHRlbXB0T2JzZXJ2YXRpb24oe2F0dGVtcHRLaW5kOiBcIm93bmVkX3JlcGxheVwiLCBhdHRlbXB0TnVtYmVyOiAyfSlcblxuICAgICAgcmV0dXJuIGF3YWl0IGVucXVldWVBdHRlbXB0KHJlcGxheUF0dGVtcHQsIHByZXZpb3VzQXR0ZW1wdHMpXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIEF0b21pY2FsbHkgcmVwbGFjZXMgdGhlIHF1ZXVlZCBvd25lciBvZiBhIHN0YWJsZSBzY2hlZHVsZSBrZXkuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gT3B0aW9ucy5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGFyZ3Muc2NoZWR1bGVLZXkgLSBTdGFibGUgbG9naWNhbCBzY2hlZHVsZSBrZXkuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBhcmdzLmpvYk5hbWUgLSBKb2IgbmFtZS5cbiAgICogQHBhcmFtIHtBcnJheTxSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59IGFyZ3MuYXJncyAtIEpvYiBhcmdzLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vdHlwZXMuanNcIikuQmFja2dyb3VuZEpvYk9wdGlvbnN9IFthcmdzLm9wdGlvbnNdIC0gSm9iIG9wdGlvbnMuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPGltcG9ydChcIi4vdHlwZXMuanNcIikuQmFja2dyb3VuZEpvYlJlcGxhY2VtZW50UmVzdWx0Pn0gLSBSZXBsYWNlbWVudCByZXN1bHQuXG4gICAqL1xuICBhc3luYyByZXBsYWNlU2NoZWR1bGVkKHtzY2hlZHVsZUtleSwgam9iTmFtZSwgYXJncywgb3B0aW9uc30pIHtcbiAgICBjb25zdCByZXF1ZXN0ID0gYXdhaXQgdGhpcy5fcmVxdWVzdCgpXG5cbiAgICByZXR1cm4gYXdhaXQgcmVxdWVzdC5ydW4oe1xuICAgICAgb25Db25uZWN0OiAoanNvblNvY2tldCkgPT4ge1xuICAgICAgICBqc29uU29ja2V0LnNlbmQoe3R5cGU6IFwicmVwbGFjZS1zY2hlZHVsZWRcIiwgc2NoZWR1bGVLZXksIGpvYk5hbWUsIGFyZ3MsIG9wdGlvbnN9KVxuICAgICAgfSxcbiAgICAgIG9uTWVzc2FnZTogKHttZXNzYWdlLCByZXNvbHZlLCByZWplY3R9KSA9PiB7XG4gICAgICAgIGlmIChtZXNzYWdlPy50eXBlID09PSBcInNjaGVkdWxlLXJlcGxhY2VkXCIpIHtcbiAgICAgICAgICByZXNvbHZlKHtcbiAgICAgICAgICAgIGpvYklkOiBtZXNzYWdlLmpvYklkLFxuICAgICAgICAgICAgcHJldmlvdXNKb2JJZDogbWVzc2FnZS5wcmV2aW91c0pvYklkLFxuICAgICAgICAgICAgcHJldmlvdXNTdGF0dXM6IG1lc3NhZ2UucHJldmlvdXNTdGF0dXNcbiAgICAgICAgICB9KVxuICAgICAgICAgIHJldHVyblxuICAgICAgICB9XG5cbiAgICAgICAgaWYgKG1lc3NhZ2U/LnR5cGUgPT09IFwicmVwbGFjZS1zY2hlZHVsZWQtZXJyb3JcIikge1xuICAgICAgICAgIHJlamVjdChuZXcgRXJyb3IobWVzc2FnZS5lcnJvciB8fCBcIkZhaWxlZCB0byByZXBsYWNlIHNjaGVkdWxlZCBqb2JcIikpXG4gICAgICAgIH1cbiAgICAgIH1cbiAgICB9KVxuICB9XG5cbiAgLyoqXG4gICAqIENhbmNlbHMgb3IgZGV0YWNoZXMgdGhlIGN1cnJlbnQgb3duZXIgb2YgYSBzdGFibGUgc2NoZWR1bGUga2V5LlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIE9wdGlvbnMuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBhcmdzLnNjaGVkdWxlS2V5IC0gU3RhYmxlIGxvZ2ljYWwgc2NoZWR1bGUga2V5LlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxpbXBvcnQoXCIuL3R5cGVzLmpzXCIpLkJhY2tncm91bmRKb2JDYW5jZWxsYXRpb25SZXN1bHQ+fSAtIENhbmNlbGxhdGlvbiByZXN1bHQuXG4gICAqL1xuICBhc3luYyBjYW5jZWxTY2hlZHVsZWQoe3NjaGVkdWxlS2V5fSkge1xuICAgIGNvbnN0IHJlcXVlc3QgPSBhd2FpdCB0aGlzLl9yZXF1ZXN0KClcblxuICAgIHJldHVybiBhd2FpdCByZXF1ZXN0LnJ1bih7XG4gICAgICBvbkNvbm5lY3Q6IChqc29uU29ja2V0KSA9PiB7XG4gICAgICAgIGpzb25Tb2NrZXQuc2VuZCh7dHlwZTogXCJjYW5jZWwtc2NoZWR1bGVkXCIsIHNjaGVkdWxlS2V5fSlcbiAgICAgIH0sXG4gICAgICBvbk1lc3NhZ2U6ICh7bWVzc2FnZSwgcmVzb2x2ZSwgcmVqZWN0fSkgPT4ge1xuICAgICAgICBpZiAobWVzc2FnZT8udHlwZSA9PT0gXCJzY2hlZHVsZS1jYW5jZWxsZWRcIikge1xuICAgICAgICAgIHJlc29sdmUoe2pvYklkOiBtZXNzYWdlLmpvYklkLCBvdXRjb21lOiBtZXNzYWdlLm91dGNvbWV9KVxuICAgICAgICAgIHJldHVyblxuICAgICAgICB9XG5cbiAgICAgICAgaWYgKG1lc3NhZ2U/LnR5cGUgPT09IFwiY2FuY2VsLXNjaGVkdWxlZC1lcnJvclwiKSB7XG4gICAgICAgICAgcmVqZWN0KG5ldyBFcnJvcihtZXNzYWdlLmVycm9yIHx8IFwiRmFpbGVkIHRvIGNhbmNlbCBzY2hlZHVsZWQgam9iXCIpKVxuICAgICAgICB9XG4gICAgICB9XG4gICAgfSlcbiAgfVxufVxuIl19