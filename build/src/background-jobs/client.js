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
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiY2xpZW50LmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiLi4vLi4vLi4vc3JjL2JhY2tncm91bmQtam9icy9jbGllbnQuanMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6IkFBQUEsWUFBWTtBQUVaLE9BQU8sT0FBTyxFQUFFLEVBQUMsWUFBWSxFQUFDLE1BQU0sMkJBQTJCLENBQUE7QUFDL0QsT0FBTyxxQkFBcUIsTUFBTSw4QkFBOEIsQ0FBQTtBQUNoRSxPQUFPLCtDQUErQyxNQUFNLDRDQUE0QyxDQUFBO0FBQ3hHLE9BQU8sMkJBQTJCLE1BQU0scUJBQXFCLENBQUE7QUFDN0QsT0FBTyxFQUFFLHVDQUF1QyxFQUFFLG9DQUFvQyxFQUFFLE1BQU0seUNBQXlDLENBQUE7QUFFdkksTUFBTSwwQkFBMEIsR0FBRyxJQUFJLENBQUE7QUFFdkMsTUFBTSxDQUFDLE9BQU8sT0FBTyxvQkFBb0I7SUFDdkM7Ozs7Ozs7T0FPRztJQUNILFlBQVksRUFBQyxhQUFhLEVBQUUsZ0JBQWdCLEdBQUcsMEJBQTBCLEVBQUUsNEJBQTRCLEdBQUcsdUNBQXVDLEVBQUUsWUFBWSxFQUFDLEdBQUcsRUFBRTtRQUNuSyxJQUFJLENBQUMsb0JBQW9CLEdBQUcsYUFBYSxDQUFDLENBQUMsQ0FBQyxPQUFPLENBQUMsT0FBTyxDQUFDLGFBQWEsQ0FBQyxDQUFDLENBQUMsQ0FBQyxxQkFBcUIsRUFBRSxDQUFBO1FBQ3BHLElBQUksQ0FBQyxnQkFBZ0IsR0FBRyxnQkFBZ0IsQ0FBQTtRQUN4QyxJQUFJLENBQUMsNEJBQTRCLEdBQUcsb0NBQW9DLENBQUMsNEJBQTRCLENBQUMsQ0FBQTtRQUN0RyxJQUFJLENBQUMsb0JBQW9CLEdBQUcsWUFBWSxDQUFBO0lBQzFDLENBQUM7SUFFRDs7O09BR0c7SUFDSCxLQUFLLENBQUMsUUFBUTtRQUNaLE1BQU0sYUFBYSxHQUFHLE1BQU0sSUFBSSxDQUFDLG9CQUFvQixDQUFBO1FBQ3JELE1BQU0sRUFBQyxJQUFJLEVBQUUsSUFBSSxFQUFDLEdBQUcs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QUFFLElBQUksS0FBSyx3QkFBd0IsRUFBRSxDQUFDO29CQUMvQyxNQUFNLENBQUMsSUFBSSxLQUFLLENBQUMsT0FBTyxDQUFDLEtBQUssSUFBSSxnQ0FBZ0MsQ0FBQyxDQUFDLENBQUE7Z0JBQ3RFLENBQUM7WUFDSCxDQUFDO1NBQ0YsQ0FBQyxDQUFBO0lBQ0osQ0FBQztDQUNGIiwic291cmNlc0NvbnRlbnQiOlsiLy8gQHRzLWNoZWNrXG5cbmltcG9ydCB0aW1lb3V0LCB7VGltZW91dEVycm9yfSBmcm9tIFwiYXdhaXRlcnkvYnVpbGQvdGltZW91dC5qc1wiXG5pbXBvcnQgY29uZmlndXJhdGlvblJlc29sdmVyIGZyb20gXCIuLi9jb25maWd1cmF0aW9uLXJlc29sdmVyLmpzXCJcbmltcG9ydCBCYWNrZ3JvdW5kSm9iRW5xdWV1ZUFja25vd2xlZGdlbWVudFRpbWVvdXRFcnJvciBmcm9tIFwiLi9lbnF1ZXVlLWFja25vd2xlZGdlbWVudC10aW1lb3V0LWVycm9yLmpzXCJcbmltcG9ydCBCYWNrZ3JvdW5kSm9ic1NvY2tldFJlcXVlc3QgZnJvbSBcIi4vc29ja2V0LXJlcXVlc3QuanNcIlxuaW1wb3J0IHsgREVGQVVMVF9HRU5FUkFUSU9OX0hBTkRTSEFLRV9USU1FT1VUX01TLCB2YWxpZGF0ZUdlbmVyYXRpb25IYW5kc2hha2VUaW1lb3V0TXMgfSBmcm9tIFwiLi9nZW5lcmF0aW9uLWhhbmRzaGFrZS10aW1lb3V0LWVycm9yLmpzXCJcblxuY29uc3QgREVGQVVMVF9FTlFVRVVFX1RJTUVPVVRfTVMgPSA1MDAwXG5cbmV4cG9ydCBkZWZhdWx0IGNsYXNzIEJhY2tncm91bmRKb2JzQ2xpZW50IHtcbiAgLyoqXG4gICAqIFJ1bnMgY29uc3RydWN0b3IuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBbYXJnc10gLSBPcHRpb25zLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL2NvbmZpZ3VyYXRpb24uanNcIikuZGVmYXVsdH0gW2FyZ3MuY29uZmlndXJhdGlvbl0gLSBDb25maWd1cmF0aW9uLlxuICAgKiBAcGFyYW0ge251bWJlcn0gW2FyZ3MuZW5xdWV1ZVRpbWVvdXRNc10gLSBNYXhpbXVtIHRpbWUgdG8gd2FpdCBmb3IgYW4gZW5xdWV1ZSBhY2tub3dsZWRnZW1lbnQgaW4gbWlsbGlzZWNvbmRzIChkZWZhdWx0OiA1MDAwKS5cbiAgICogQHBhcmFtIHtudW1iZXJ9IFthcmdzLmdlbmVyYXRpb25IYW5kc2hha2VUaW1lb3V0TXNdIC0gTWF4aW11bSB0aW1lIHRvIHdhaXQgZm9yIGdlbmVyYXRpb24gYWNrbm93bGVkZ2VtZW50IChkZWZhdWx0OiA0MDAwKS5cbiAgICogQHBhcmFtIHtzdHJpbmd9IFthcmdzLmdlbmVyYXRpb25JZF0gLSBFeHBsaWNpdCByZWxlYXNlIGdlbmVyYXRpb24gaWRlbnRpdHkuXG4gICAqL1xuICBjb25zdHJ1Y3Rvcih7Y29uZmlndXJhdGlvbiwgZW5xdWV1ZVRpbWVvdXRNcyA9IERFRkFVTFRfRU5RVUVVRV9USU1FT1VUX01TLCBnZW5lcmF0aW9uSGFuZHNoYWtlVGltZW91dE1zID0gREVGQVVMVF9HRU5FUkFUSU9OX0hBTkRTSEFLRV9USU1FT1VUX01TLCBnZW5lcmF0aW9uSWR9ID0ge30pIHtcbiAgICB0aGlzLmNvbmZpZ3VyYXRpb25Qcm9taXNlID0gY29uZmlndXJhdGlvbiA/IFByb21pc2UucmVzb2x2ZShjb25maWd1cmF0aW9uKSA6IGNvbmZpZ3VyYXRpb25SZXNvbHZlcigpXG4gICAgdGhpcy5lbnF1ZXVlVGltZW91dE1zID0gZW5xdWV1ZVRpbWVvdXRNc1xuICAgIHRoaXMuZ2VuZXJhdGlvbkhhbmRzaGFrZVRpbWVvdXRNcyA9IHZhbGlkYXRlR2VuZXJhdGlvbkhhbmRzaGFrZVRpbWVvdXRNcyhnZW5lcmF0aW9uSGFuZHNoYWtlVGltZW91dE1zKVxuICAgIHRoaXMuZXhwbGljaXRHZW5lcmF0aW9uSWQgPSBnZW5lcmF0aW9uSWRcbiAgfVxuXG4gIC8qKlxuICAgKiBCdWlsZHMgYSBvbmUtc2hvdCBjbGllbnQgc29ja2V0IHJlcXVlc3QgZnJvbSB0aGUgcmVzb2x2ZWQgY29uZmlndXJhdGlvbi5cbiAgICogQHJldHVybnMge1Byb21pc2U8QmFja2dyb3VuZEpvYnNTb2NrZXRSZXF1ZXN0Pn0gLSBTb2NrZXQgcmVxdWVzdC5cbiAgICovXG4gIGFzeW5jIF9yZXF1ZXN0KCkge1xuICAgIGNvbnN0IGNvbmZpZ3VyYXRpb24gPSBhd2FpdCB0aGlzLmNvbmZpZ3VyYXRpb25Qcm9taXNlXG4gICAgY29uc3Qge2hvc3QsIHBvcnR9ID0gY29uZmlndXJhdGlvbi5nZXRCYWNrZ3JvdW5kSm9ic0NvbmZpZygpXG4gICAgY29uc3Qge2dlbmVyYXRpb25JZH0gPSBjb25maWd1cmF0aW9uLnJlc29sdmVCYWNrZ3JvdW5kSm9ic0dlbmVyYXRpb25Db25maWcoe1xuICAgICAgZ2VuZXJhdGlvbklkOiB0aGlzLmV4cGxpY2l0R2VuZXJhdGlvbklkLFxuICAgICAgc291cmNlTmFtZTogXCJCYWNrZ3JvdW5kSm9ic0NsaWVudFwiXG4gICAgfSlcblxuICAgIHJldHVybiBuZXcgQmFja2dyb3VuZEpvYnNTb2NrZXRSZXF1ZXN0KHtob3N0LCBwb3J0LCByb2xlOiBcImNsaWVudFwiLCBnZW5lcmF0aW9uSGFuZHNoYWtlVGltZW91dE1zOiB0aGlzLmdlbmVyYXRpb25IYW5kc2hha2VUaW1lb3V0TXMsIGdlbmVyYXRpb25JZH0pXG4gIH1cblxuICAvKipcbiAgICogUnVucyBlbnF1ZXVlLlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIE9wdGlvbnMuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBhcmdzLmpvYk5hbWUgLSBKb2IgbmFtZS5cbiAgICogQHBhcmFtIHtBcnJheTxSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59IGFyZ3MuYXJncyAtIEpvYiBhcmdzLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vdHlwZXMuanNcIikuQmFja2dyb3VuZEpvYk9wdGlvbnN9IFthcmdzLm9wdGlvbnNdIC0gSm9iIG9wdGlvbnMuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBbYXJncy5wcm9kdWNlckludm9jYXRpb25JZF0gLSBTdGFibGUgaWRlbnRpdHkgZm9yIG9uZSBvd25lZCBlbnF1ZXVlIGludm9jYXRpb24uXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi90eXBlcy5qc1wiKS5CYWNrZ3JvdW5kSm9iUHJvZHVjZXJQcm9vZn0gW2FyZ3MucHJvZHVjZXJQcm9vZl0gLSBFeGFjdCBpbnRlcm5hbCBwcm9kdWNlciBoYW5kb2ZmLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxzdHJpbmc+fSAtIEpvYiBpZC5cbiAgICovXG4gIGFzeW5jIGVucXVldWUoe2pvYk5hbWUsIGFyZ3MsIG9wdGlvbnMsIHByb2R1Y2VySW52b2NhdGlvbklkLCBwcm9kdWNlclByb29mfSkge1xuICAgIGNvbnN0IG1lc3NhZ2UgPSB7XG4gICAgICB0eXBlOiAvKiogQHR5cGUge2NvbnN0fSAqLyAoXCJlbnF1ZXVlXCIpLFxuICAgICAgam9iTmFtZSxcbiAgICAgIGFyZ3MsXG4gICAgICBvcHRpb25zLFxuICAgICAgLi4uKHByb2R1Y2VySW52b2NhdGlvbklkID8ge3Byb2R1Y2VySW52b2NhdGlvbklkfSA6IHt9KSxcbiAgICAgIC4uLihwcm9kdWNlclByb29mID8ge3Byb2R1Y2VyUHJvb2Z9IDoge30pXG4gICAgfVxuICAgIC8qKlxuICAgICAqIENyZWF0ZXMgc2FmZSBvYnNlcnZhdGlvbnMgZm9yIG9uZSBhdHRlbXB0IHdpdGhvdXQgcmV0YWluaW5nIHJlcXVlc3QgZGF0YS5cbiAgICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIEF0dGVtcHQgaWRlbnRpdHkuXG4gICAgICogQHBhcmFtIHtcImluaXRpYWxcIiB8IFwib3duZWRfcmVwbGF5XCJ9IGFyZ3MuYXR0ZW1wdEtpbmQgLSBJbml0aWFsIGF0dGVtcHQgb3Igb3duZWQgcmVwbGF5LlxuICAgICAqIEBwYXJhbSB7bnVtYmVyfSBhcmdzLmF0dGVtcHROdW1iZXIgLSBPbmUtYmFzZWQgYXR0ZW1wdCBudW1iZXIuXG4gICAgICogQHJldHVybnMge2ltcG9ydChcIi4vZW5xdWV1ZS1hY2tub3dsZWRnZW1lbnQtdGltZW91dC1lcnJvci5qc1wiKS5CYWNrZ3JvdW5kSm9iRW5xdWV1ZUF0dGVtcHR9IC0gTXV0YWJsZSBhdHRlbXB0IG9ic2VydmF0aW9ucy5cbiAgICAgKi9cbiAgICBjb25zdCBuZXdBdHRlbXB0T2JzZXJ2YXRpb24gPSAoe2F0dGVtcHRLaW5kLCBhdHRlbXB0TnVtYmVyfSkgPT4gKHtcbiAgICAgIGFja25vd2xlZGdlbWVudFdhaXRFbGFwc2VkTXM6IDAsXG4gICAgICBhdHRlbXB0RWxhcHNlZE1zOiAwLFxuICAgICAgYXR0ZW1wdEtpbmQsXG4gICAgICBhdHRlbXB0TnVtYmVyLFxuICAgICAgZXhwbGljaXRseVJlamVjdGVkOiBmYWxzZSxcbiAgICAgIGdlbmVyYXRpb25GZW5jZWQ6IGZhbHNlLFxuICAgICAgcmVxdWVzdFNlbnQ6IGZhbHNlXG4gICAgfSlcbiAgICAvKipcbiAgICAgKiBTZW5kcyBvbmUgZW5xdWV1ZSBhdHRlbXB0LiBBbiBvd25lZCBjYWxsZXIgbWF5IHJlcGxheSB0aGlzIGV4YWN0IG1lc3NhZ2VcbiAgICAgKiBvbmNlIHdoZW4gdHJhbnNwb3J0IGFja25vd2xlZGdlbWVudCByZW1haW5zIGFtYmlndW91cyBhZnRlciBzZW5kLlxuICAgICAqIEBwYXJhbSB7aW1wb3J0KFwiLi9lbnF1ZXVlLWFja25vd2xlZGdlbWVudC10aW1lb3V0LWVycm9yLmpzXCIpLkJhY2tncm91bmRKb2JFbnF1ZXVlQXR0ZW1wdH0gYXR0ZW1wdE9ic2VydmF0aW9uIC0gTXV0YWJsZSBhdHRlbXB0IG9ic2VydmF0aW9ucy5cbiAgICAgKiBAcGFyYW0ge1JlYWRvbmx5PEFycmF5PGltcG9ydChcIi4vZW5xdWV1ZS1hY2tub3dsZWRnZW1lbnQtdGltZW91dC1lcnJvci5qc1wiKS5CYWNrZ3JvdW5kSm9iRW5xdWV1ZUF0dGVtcHQ+Pn0gcHJldmlvdXNBdHRlbXB0cyAtIEVhcmxpZXIgdGltZWQtb3V0IGF0dGVtcHRzLlxuICAgICAqIEByZXR1cm5zIHtQcm9taXNlPHN0cmluZz59IC0gSm9iIGlkLlxuICAgICAqL1xuICAgIGNvbnN0IGVucXVldWVBdHRlbXB0ID0gYXN5bmMgKGF0dGVtcHRPYnNlcnZhdGlvbiwgcHJldmlvdXNBdHRlbXB0cykgPT4ge1xuICAgICAgY29uc3QgYXR0ZW1wdFN0YXJ0ZWRBdE1zID0gRGF0ZS5ub3coKVxuICAgICAgY29uc3QgcmVxdWVzdCA9IGF3YWl0IHRoaXMuX3JlcXVlc3QoKVxuICAgICAgY29uc3QgcmVxdWVzdEFib3J0Q29udHJvbGxlciA9IG5ldyBBYm9ydENvbnRyb2xsZXIoKVxuICAgICAgY29uc3QgdGltZW91dEVycm9yTWVzc2FnZSA9IGBCYWNrZ3JvdW5kIGpvYiBlbnF1ZXVlIGFja25vd2xlZGdlbWVudCB0aW1lZCBvdXQgYWZ0ZXIgJHt0aGlzLmVucXVldWVUaW1lb3V0TXN9bXNgXG4gICAgICAvKiogQHR5cGUge251bWJlciB8IHVuZGVmaW5lZH0gKi9cbiAgICAgIGxldCByZXF1ZXN0U2VudEF0TXNcbiAgICAgIC8qKlxuICAgICAgICogUmVzb2x2ZXMgdGhlIHByZS1zZW5kIHBoYXNlIHdoZW4gdGhlIG11dGF0aW9uIGhhcyBlbnRlcmVkIHRoZSBzb2NrZXQuXG4gICAgICAgKiBAdHlwZSB7KCkgPT4gdm9pZH1cbiAgICAgICAqL1xuICAgICAgbGV0IG1hcmtSZXF1ZXN0U2VudCA9ICgpID0+IHt9XG4gICAgICBjb25zdCByZXF1ZXN0U2VudCA9IG5ldyBQcm9taXNlKChyZXNvbHZlKSA9PiB7XG4gICAgICAgIG1hcmtSZXF1ZXN0U2VudCA9ICgpID0+IHJlc29sdmUodW5kZWZpbmVkKVxuICAgICAgfSlcbiAgICAgIC8qKlxuICAgICAgICogQXBwbGllcyB0aGUgY29uZmlndXJlZCBkZWFkbGluZSBpbmRlcGVuZGVudGx5IHRvIG9uZSByZXF1ZXN0IHBoYXNlLlxuICAgICAgICogQHRlbXBsYXRlIFRcbiAgICAgICAqIEBwYXJhbSB7KCkgPT4gUHJvbWlzZTxUPn0gY2FsbGJhY2sgLSBQaGFzZSB3b3JrLlxuICAgICAgICogQHJldHVybnMge1Byb21pc2U8VD59IC0gUGhhc2UgcmVzdWx0LlxuICAgICAgICovXG4gICAgICBjb25zdCB3aXRoRW5xdWV1ZVRpbWVvdXQgPSBhc3luYyAoY2FsbGJhY2spID0+IGF3YWl0IHRpbWVvdXQoe1xuICAgICAgICBlcnJvck1lc3NhZ2U6IHRpbWVvdXRFcnJvck1lc3NhZ2UsXG4gICAgICAgIHRpbWVvdXQ6IHRoaXMuZW5xdWV1ZVRpbWVvdXRNc1xuICAgICAgfSwgYXN5bmMgKHtjb250cm9sfSkgPT4ge1xuICAgICAgICBjb25zdCBhYm9ydFJlcXVlc3QgPSAoKSA9PiByZXF1ZXN0QWJvcnRDb250cm9sbGVyLmFib3J0KGNvbnRyb2wuc2lnbmFsLnJlYXNvbilcblxuICAgICAgICBjb250cm9sLnNpZ25hbC5hZGRFdmVudExpc3RlbmVyKFwiYWJvcnRcIiwgYWJvcnRSZXF1ZXN0KVxuICAgICAgICB0cnkge1xuICAgICAgICAgIHJldHVybiBhd2FpdCBjYWxsYmFjaygpXG4gICAgICAgIH0gZmluYWxseSB7XG4gICAgICAgICAgY29udHJvbC5zaWduYWwucmVtb3ZlRXZlbnRMaXN0ZW5lcihcImFib3J0XCIsIGFib3J0UmVxdWVzdClcbiAgICAgICAgfVxuICAgICAgfSlcbiAgICAgIGNvbnN0IHJlcXVlc3RQcm9taXNlID0gcmVxdWVzdC5ydW4oe1xuICAgICAgICBzaWduYWw6IHJlcXVlc3RBYm9ydENvbnRyb2xsZXIuc2lnbmFsLFxuICAgICAgICBvbkNvbm5lY3Q6IChqc29uU29ja2V0KSA9PiB7XG4gICAgICAgICAganNvblNvY2tldC5zZW5kKG1lc3NhZ2UpXG4gICAgICAgICAgYXR0ZW1wdE9ic2VydmF0aW9uLmdlbmVyYXRpb25GZW5jZWQgPSBCb29sZWFuKHJlcXVlc3QuZ2VuZXJhdGlvbklkKVxuICAgICAgICAgIGF0dGVtcHRPYnNlcnZhdGlvbi5yZXF1ZXN0U2VudCA9IHRydWVcbiAgICAgICAgICByZXF1ZXN0U2VudEF0TXMgPSBEYXRlLm5vdygpXG4gICAgICAgICAgbWFya1JlcXVlc3RTZW50KClcbiAgICAgICAgfSxcbiAgICAgICAgb25NZXNzYWdlOiAoe21lc3NhZ2UsIHJlc29sdmUsIHJlamVjdH0pID0+IHtcbiAgICAgICAgICBpZiAobWVzc2FnZT8udHlwZSA9PT0gXCJlbnF1ZXVlZFwiKSB7XG4gICAgICAgICAgICByZXNvbHZlKG1lc3NhZ2Uuam9iSWQpXG4gICAgICAgICAgICByZXR1cm5cbiAgICAgICAgICB9XG5cbiAgICAgICAgICBpZiAobWVzc2FnZT8udHlwZSA9PT0gXCJlbnF1ZXVlLWVycm9yXCIpIHtcbiAgICAgICAgICAgIGF0dGVtcHRPYnNlcnZhdGlvbi5leHBsaWNpdGx5UmVqZWN0ZWQgPSB0cnVlXG4gICAgICAgICAgICByZWplY3QobmV3IEVycm9yKG1lc3NhZ2UuZXJyb3IgfHwgXCJGYWlsZWQgdG8gZW5xdWV1ZSBqb2JcIikpXG4gICAgICAgICAgfVxuICAgICAgICB9XG4gICAgICB9KVxuXG4gICAgICBhd2FpdCB3aXRoRW5xdWV1ZVRpbWVvdXQoYXN5bmMgKCkgPT4gYXdhaXQgUHJvbWlzZS5yYWNlKFtyZXF1ZXN0U2VudCwgcmVxdWVzdFByb21pc2VdKSlcblxuICAgICAgdHJ5IHtcbiAgICAgICAgcmV0dXJuIGF3YWl0IHdpdGhFbnF1ZXVlVGltZW91dChhc3luYyAoKSA9PiBhd2FpdCByZXF1ZXN0UHJvbWlzZSlcbiAgICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICAgIGlmICghKGVycm9yIGluc3RhbmNlb2YgVGltZW91dEVycm9yKSkgdGhyb3cgZXJyb3JcbiAgICAgICAgaWYgKHJlcXVlc3RTZW50QXRNcyA9PT0gdW5kZWZpbmVkKSB0aHJvdyBuZXcgRXJyb3IoXCJCYWNrZ3JvdW5kIGpvYiBlbnF1ZXVlIGFja25vd2xlZGdlbWVudCB3YWl0IHN0YXJ0ZWQgYmVmb3JlIHRoZSByZXF1ZXN0IHdhcyBzZW50XCIsIHtjYXVzZTogZXJyb3J9KVxuXG4gICAgICAgIGNvbnN0IHRpbWVkT3V0QXRNcyA9IERhdGUubm93KClcbiAgICAgICAgLy8gVGhlIGZpcmVkIHRpbWVyIHByb3ZlcyBpdHMgbG9naWNhbCBkZWFkbGluZSBldmVuIHdoZW4gdGhlIGFkanVzdGFibGUgd2FsbCBjbG9jayByZXBvcnRzIGEgc2hvcnRlciBpbnRlcnZhbC5cbiAgICAgICAgY29uc3QgYWNrbm93bGVkZ2VtZW50V2FpdEVsYXBzZWRNcyA9IE1hdGgubWF4KHRoaXMuZW5xdWV1ZVRpbWVvdXRNcywgdGltZWRPdXRBdE1zIC0gcmVxdWVzdFNlbnRBdE1zKVxuXG4gICAgICAgIGF0dGVtcHRPYnNlcnZhdGlvbi5hY2tub3dsZWRnZW1lbnRXYWl0RWxhcHNlZE1zID0gYWNrbm93bGVkZ2VtZW50V2FpdEVsYXBzZWRNc1xuICAgICAgICBhdHRlbXB0T2JzZXJ2YXRpb24uYXR0ZW1wdEVsYXBzZWRNcyA9IE1hdGgubWF4KGFja25vd2xlZGdlbWVudFdhaXRFbGFwc2VkTXMsIHRpbWVkT3V0QXRNcyAtIGF0dGVtcHRTdGFydGVkQXRNcylcblxuICAgICAgICB0aHJvdyBuZXcgQmFja2dyb3VuZEpvYkVucXVldWVBY2tub3dsZWRnZW1lbnRUaW1lb3V0RXJyb3Ioe1xuICAgICAgICAgIGFja25vd2xlZGdlbWVudFRpbWVvdXRNczogdGhpcy5lbnF1ZXVlVGltZW91dE1zLFxuICAgICAgICAgIGF0dGVtcHRIaXN0b3J5OiBbLi4ucHJldmlvdXNBdHRlbXB0cywgYXR0ZW1wdE9ic2VydmF0aW9uXSxcbiAgICAgICAgICBjYXVzZTogZXJyb3IsXG4gICAgICAgICAgZ2VuZXJhdGlvbklkOiByZXF1ZXN0LmdlbmVyYXRpb25JZCxcbiAgICAgICAgICBqb2JOYW1lLFxuICAgICAgICAgIHByb2R1Y2VySW52b2NhdGlvbklkLFxuICAgICAgICAgIHByb2R1Y2VyUHJvb2ZQcmVzZW50OiBCb29sZWFuKHByb2R1Y2VyUHJvb2YpXG4gICAgICAgIH0pXG4gICAgICB9XG4gICAgfVxuXG4gICAgY29uc3QgaW5pdGlhbEF0dGVtcHQgPSBuZXdBdHRlbXB0T2JzZXJ2YXRpb24oe2F0dGVtcHRLaW5kOiBcImluaXRpYWxcIiwgYXR0ZW1wdE51bWJlcjogMX0pXG5cbiAgICB0cnkge1xuICAgICAgcmV0dXJuIGF3YWl0IGVucXVldWVBdHRlbXB0KGluaXRpYWxBdHRlbXB0LCBbXSlcbiAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgaWYgKCFwcm9kdWNlckludm9jYXRpb25JZCB8fCAhcHJvZHVjZXJQcm9vZiB8fCAhaW5pdGlhbEF0dGVtcHQuZ2VuZXJhdGlvbkZlbmNlZCB8fCAhaW5pdGlhbEF0dGVtcHQucmVxdWVzdFNlbnQgfHwgaW5pdGlhbEF0dGVtcHQuZXhwbGljaXRseVJlamVjdGVkKSB0aHJvdyBlcnJvclxuXG4gICAgICBjb25zdCBwcmV2aW91c0F0dGVtcHRzID0gZXJyb3IgaW5zdGFuY2VvZiBCYWNrZ3JvdW5kSm9iRW5xdWV1ZUFja25vd2xlZGdlbWVudFRpbWVvdXRFcnJvciA/IGVycm9yLmF0dGVtcHRIaXN0b3J5IDogW11cbiAgICAgIGNvbnN0IHJlcGxheUF0dGVtcHQgPSBuZXdBdHRlbXB0T2JzZXJ2YXRpb24oe2F0dGVtcHRLaW5kOiBcIm93bmVkX3JlcGxheVwiLCBhdHRlbXB0TnVtYmVyOiAyfSlcblxuICAgICAgcmV0dXJuIGF3YWl0IGVucXVldWVBdHRlbXB0KHJlcGxheUF0dGVtcHQsIHByZXZpb3VzQXR0ZW1wdHMpXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIEF0b21pY2FsbHkgcmVwbGFjZXMgdGhlIHF1ZXVlZCBvd25lciBvZiBhIHN0YWJsZSBzY2hlZHVsZSBrZXkuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gT3B0aW9ucy5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGFyZ3Muc2NoZWR1bGVLZXkgLSBTdGFibGUgbG9naWNhbCBzY2hlZHVsZSBrZXkuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBhcmdzLmpvYk5hbWUgLSBKb2IgbmFtZS5cbiAgICogQHBhcmFtIHtBcnJheTxSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59IGFyZ3MuYXJncyAtIEpvYiBhcmdzLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vdHlwZXMuanNcIikuQmFja2dyb3VuZEpvYk9wdGlvbnN9IFthcmdzLm9wdGlvbnNdIC0gSm9iIG9wdGlvbnMuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPGltcG9ydChcIi4vdHlwZXMuanNcIikuQmFja2dyb3VuZEpvYlJlcGxhY2VtZW50UmVzdWx0Pn0gLSBSZXBsYWNlbWVudCByZXN1bHQuXG4gICAqL1xuICBhc3luYyByZXBsYWNlU2NoZWR1bGVkKHtzY2hlZHVsZUtleSwgam9iTmFtZSwgYXJncywgb3B0aW9uc30pIHtcbiAgICBjb25zdCByZXF1ZXN0ID0gYXdhaXQgdGhpcy5fcmVxdWVzdCgpXG5cbiAgICByZXR1cm4gYXdhaXQgcmVxdWVzdC5ydW4oe1xuICAgICAgb25Db25uZWN0OiAoanNvblNvY2tldCkgPT4ge1xuICAgICAgICBqc29uU29ja2V0LnNlbmQoe3R5cGU6IFwicmVwbGFjZS1zY2hlZHVsZWRcIiwgc2NoZWR1bGVLZXksIGpvYk5hbWUsIGFyZ3MsIG9wdGlvbnN9KVxuICAgICAgfSxcbiAgICAgIG9uTWVzc2FnZTogKHttZXNzYWdlLCByZXNvbHZlLCByZWplY3R9KSA9PiB7XG4gICAgICAgIGlmIChtZXNzYWdlPy50eXBlID09PSBcInNjaGVkdWxlLXJlcGxhY2VkXCIpIHtcbiAgICAgICAgICByZXNvbHZlKHtcbiAgICAgICAgICAgIGpvYklkOiBtZXNzYWdlLmpvYklkLFxuICAgICAgICAgICAgcHJldmlvdXNKb2JJZDogbWVzc2FnZS5wcmV2aW91c0pvYklkLFxuICAgICAgICAgICAgcHJldmlvdXNTdGF0dXM6IG1lc3NhZ2UucHJldmlvdXNTdGF0dXNcbiAgICAgICAgICB9KVxuICAgICAgICAgIHJldHVyblxuICAgICAgICB9XG5cbiAgICAgICAgaWYgKG1lc3NhZ2U/LnR5cGUgPT09IFwicmVwbGFjZS1zY2hlZHVsZWQtZXJyb3JcIikge1xuICAgICAgICAgIHJlamVjdChuZXcgRXJyb3IobWVzc2FnZS5lcnJvciB8fCBcIkZhaWxlZCB0byByZXBsYWNlIHNjaGVkdWxlZCBqb2JcIikpXG4gICAgICAgIH1cbiAgICAgIH1cbiAgICB9KVxuICB9XG5cbiAgLyoqXG4gICAqIENhbmNlbHMgb3IgZGV0YWNoZXMgdGhlIGN1cnJlbnQgb3duZXIgb2YgYSBzdGFibGUgc2NoZWR1bGUga2V5LlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIE9wdGlvbnMuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBhcmdzLnNjaGVkdWxlS2V5IC0gU3RhYmxlIGxvZ2ljYWwgc2NoZWR1bGUga2V5LlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxpbXBvcnQoXCIuL3R5cGVzLmpzXCIpLkJhY2tncm91bmRKb2JDYW5jZWxsYXRpb25SZXN1bHQ+fSAtIENhbmNlbGxhdGlvbiByZXN1bHQuXG4gICAqL1xuICBhc3luYyBjYW5jZWxTY2hlZHVsZWQoe3NjaGVkdWxlS2V5fSkge1xuICAgIGNvbnN0IHJlcXVlc3QgPSBhd2FpdCB0aGlzLl9yZXF1ZXN0KClcblxuICAgIHJldHVybiBhd2FpdCByZXF1ZXN0LnJ1bih7XG4gICAgICBvbkNvbm5lY3Q6IChqc29uU29ja2V0KSA9PiB7XG4gICAgICAgIGpzb25Tb2NrZXQuc2VuZCh7dHlwZTogXCJjYW5jZWwtc2NoZWR1bGVkXCIsIHNjaGVkdWxlS2V5fSlcbiAgICAgIH0sXG4gICAgICBvbk1lc3NhZ2U6ICh7bWVzc2FnZSwgcmVzb2x2ZSwgcmVqZWN0fSkgPT4ge1xuICAgICAgICBpZiAobWVzc2FnZT8udHlwZSA9PT0gXCJzY2hlZHVsZS1jYW5jZWxsZWRcIikge1xuICAgICAgICAgIHJlc29sdmUoe2pvYklkOiBtZXNzYWdlLmpvYklkLCBvdXRjb21lOiBtZXNzYWdlLm91dGNvbWV9KVxuICAgICAgICAgIHJldHVyblxuICAgICAgICB9XG5cbiAgICAgICAgaWYgKG1lc3NhZ2U/LnR5cGUgPT09IFwiY2FuY2VsLXNjaGVkdWxlZC1lcnJvclwiKSB7XG4gICAgICAgICAgcmVqZWN0KG5ldyBFcnJvcihtZXNzYWdlLmVycm9yIHx8IFwiRmFpbGVkIHRvIGNhbmNlbCBzY2hlZHVsZWQgam9iXCIpKVxuICAgICAgICB9XG4gICAgICB9XG4gICAgfSlcbiAgfVxufVxuIl19