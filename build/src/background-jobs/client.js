// @ts-check
import timeout from "awaitery/build/timeout.js";
import configurationResolver from "../configuration-resolver.js";
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
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiY2xpZW50LmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiLi4vLi4vLi4vc3JjL2JhY2tncm91bmQtam9icy9jbGllbnQuanMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6IkFBQUEsWUFBWTtBQUVaLE9BQU8sT0FBTyxNQUFNLDJCQUEyQixDQUFBO0FBQy9DLE9BQU8scUJBQXFCLE1BQU0sOEJBQThCLENBQUE7QUFDaEUsT0FBTywyQkFBMkIsTUFBTSxxQkFBcUIsQ0FBQTtBQUM3RCxPQUFPLEVBQUUsdUNBQXVDLEVBQUUsb0NBQW9DLEVBQUUsTUFBTSx5Q0FBeUMsQ0FBQTtBQUV2SSxNQUFNLDBCQUEwQixHQUFHLElBQUksQ0FBQTtBQUV2QyxNQUFNLENBQUMsT0FBTyxPQUFPLG9CQUFvQjtJQUN2Qzs7Ozs7OztPQU9HO0lBQ0gsWUFBWSxFQUFDLGFBQWEsRUFBRSxnQkFBZ0IsR0FBRywwQkFBMEIsRUFBRSw0QkFBNEIsR0FBRyx1Q0FBdUMsRUFBRSxZQUFZLEVBQUMsR0FBRyxFQUFFO1FBQ25LLElBQUksQ0FBQyxvQkFBb0IsR0FBRyxhQUFhLENBQUMsQ0FBQyxDQUFDLE9BQU8sQ0FBQyxPQUFPLENBQUMsYUFBYSxDQUFDLENBQUMsQ0FBQyxDQUFDLHFCQUFxQixFQUFFLENBQUE7UUFDcEcsSUFBSSxDQUFDLGdCQUFnQixHQUFHLGdCQUFnQixDQUFBO1FBQ3hDLElBQUksQ0FBQyw0QkFBNEIsR0FBRyxvQ0FBb0MsQ0FBQyw0QkFBNEIsQ0FBQyxDQUFBO1FBQ3RHLElBQUksQ0FBQyxvQkFBb0IsR0FBRyxZQUFZLENBQUE7SUFDMUMsQ0FBQztJQUVEOzs7T0FHRztJQUNILEtBQUssQ0FBQyxRQUFRO1FBQ1osTUFBTSxhQUFhLEdBQUcsTUFBTSxJQUFJLENBQUMsb0JBQW9CLENBQUE7UUFDckQsTUFBTSxFQUFDLElBQUksRUFBRSxJQUFJLEVBQUMsR0FBRyxhQUFhLENBQUMsdUJBQXVCLEVBQUUsQ0FBQTtRQUM1RCxNQUFNLEVBQUMsWUFBWSxFQUFDLEdB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Q0FBQyxFQUFDLFdBQVcsRUFBQztRQUNqQyxNQUFNLE9BQU8sR0FBRyxNQUFNLElBQUksQ0FBQyxRQUFRLEVBQUUsQ0FBQTtRQUVyQyxPQUFPLE1BQU0sT0FBTyxDQUFDLEdBQUcsQ0FBQztZQUN2QixTQUFTLEVBQUUsQ0FBQyxVQUFVLEVBQUUsRUFBRTtnQkFDeEIsVUFBVSxDQUFDLElBQUksQ0FBQyxFQUFDLElBQUksRUFBRSxrQkFBa0IsRUFBRSxXQUFXLEVBQUMsQ0FBQyxDQUFBO1lBQzFELENBQUM7WUFDRCxTQUFTLEVBQUUsQ0FBQyxFQUFDLE9BQU8sRUFBRSxPQUFPLEVBQUUsTUFBTSxFQUFDLEVBQUUsRUFBRTtnQkFDeEMsSUFBSSxPQUFPLEVBQUUsSUFBSSxLQUFLLG9CQUFvQixFQUFFLENBQUM7b0JBQzNDLE9BQU8sQ0FBQyxFQUFDLEtBQUssRUFBRSxPQUFPLENBQUMsS0FBSyxFQUFFLE9BQU8sRUFBRSxPQUFPLENBQUMsT0FBTyxFQUFDLENBQUMsQ0FBQTtvQkFDekQsT0FBTTtnQkFDUixDQUFDO2dCQUVELElBQUksT0FBTyxFQUFFLElBQUksS0FBSyx3QkFBd0IsRUFBRSxDQUFDO29CQUMvQyxNQUFNLENBQUMsSUFBSSxLQUFLLENBQUMsT0FBTyxDQUFDLEtBQUssSUFBSSxnQ0FBZ0MsQ0FBQyxDQUFDLENBQUE7Z0JBQ3RFLENBQUM7WUFDSCxDQUFDO1NBQ0YsQ0FBQyxDQUFBO0lBQ0osQ0FBQztDQUNGIiwic291cmNlc0NvbnRlbnQiOlsiLy8gQHRzLWNoZWNrXG5cbmltcG9ydCB0aW1lb3V0IGZyb20gXCJhd2FpdGVyeS9idWlsZC90aW1lb3V0LmpzXCJcbmltcG9ydCBjb25maWd1cmF0aW9uUmVzb2x2ZXIgZnJvbSBcIi4uL2NvbmZpZ3VyYXRpb24tcmVzb2x2ZXIuanNcIlxuaW1wb3J0IEJhY2tncm91bmRKb2JzU29ja2V0UmVxdWVzdCBmcm9tIFwiLi9zb2NrZXQtcmVxdWVzdC5qc1wiXG5pbXBvcnQgeyBERUZBVUxUX0dFTkVSQVRJT05fSEFORFNIQUtFX1RJTUVPVVRfTVMsIHZhbGlkYXRlR2VuZXJhdGlvbkhhbmRzaGFrZVRpbWVvdXRNcyB9IGZyb20gXCIuL2dlbmVyYXRpb24taGFuZHNoYWtlLXRpbWVvdXQtZXJyb3IuanNcIlxuXG5jb25zdCBERUZBVUxUX0VOUVVFVUVfVElNRU9VVF9NUyA9IDUwMDBcblxuZXhwb3J0IGRlZmF1bHQgY2xhc3MgQmFja2dyb3VuZEpvYnNDbGllbnQge1xuICAvKipcbiAgICogUnVucyBjb25zdHJ1Y3Rvci5cbiAgICogQHBhcmFtIHtvYmplY3R9IFthcmdzXSAtIE9wdGlvbnMuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vY29uZmlndXJhdGlvbi5qc1wiKS5kZWZhdWx0fSBbYXJncy5jb25maWd1cmF0aW9uXSAtIENvbmZpZ3VyYXRpb24uXG4gICAqIEBwYXJhbSB7bnVtYmVyfSBbYXJncy5lbnF1ZXVlVGltZW91dE1zXSAtIE1heGltdW0gdGltZSB0byB3YWl0IGZvciBhbiBlbnF1ZXVlIGFja25vd2xlZGdlbWVudCBpbiBtaWxsaXNlY29uZHMgKGRlZmF1bHQ6IDUwMDApLlxuICAgKiBAcGFyYW0ge251bWJlcn0gW2FyZ3MuZ2VuZXJhdGlvbkhhbmRzaGFrZVRpbWVvdXRNc10gLSBNYXhpbXVtIHRpbWUgdG8gd2FpdCBmb3IgZ2VuZXJhdGlvbiBhY2tub3dsZWRnZW1lbnQgKGRlZmF1bHQ6IDQwMDApLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gW2FyZ3MuZ2VuZXJhdGlvbklkXSAtIEV4cGxpY2l0IHJlbGVhc2UgZ2VuZXJhdGlvbiBpZGVudGl0eS5cbiAgICovXG4gIGNvbnN0cnVjdG9yKHtjb25maWd1cmF0aW9uLCBlbnF1ZXVlVGltZW91dE1zID0gREVGQVVMVF9FTlFVRVVFX1RJTUVPVVRfTVMsIGdlbmVyYXRpb25IYW5kc2hha2VUaW1lb3V0TXMgPSBERUZBVUxUX0dFTkVSQVRJT05fSEFORFNIQUtFX1RJTUVPVVRfTVMsIGdlbmVyYXRpb25JZH0gPSB7fSkge1xuICAgIHRoaXMuY29uZmlndXJhdGlvblByb21pc2UgPSBjb25maWd1cmF0aW9uID8gUHJvbWlzZS5yZXNvbHZlKGNvbmZpZ3VyYXRpb24pIDogY29uZmlndXJhdGlvblJlc29sdmVyKClcbiAgICB0aGlzLmVucXVldWVUaW1lb3V0TXMgPSBlbnF1ZXVlVGltZW91dE1zXG4gICAgdGhpcy5nZW5lcmF0aW9uSGFuZHNoYWtlVGltZW91dE1zID0gdmFsaWRhdGVHZW5lcmF0aW9uSGFuZHNoYWtlVGltZW91dE1zKGdlbmVyYXRpb25IYW5kc2hha2VUaW1lb3V0TXMpXG4gICAgdGhpcy5leHBsaWNpdEdlbmVyYXRpb25JZCA9IGdlbmVyYXRpb25JZFxuICB9XG5cbiAgLyoqXG4gICAqIEJ1aWxkcyBhIG9uZS1zaG90IGNsaWVudCBzb2NrZXQgcmVxdWVzdCBmcm9tIHRoZSByZXNvbHZlZCBjb25maWd1cmF0aW9uLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxCYWNrZ3JvdW5kSm9ic1NvY2tldFJlcXVlc3Q+fSAtIFNvY2tldCByZXF1ZXN0LlxuICAgKi9cbiAgYXN5bmMgX3JlcXVlc3QoKSB7XG4gICAgY29uc3QgY29uZmlndXJhdGlvbiA9IGF3YWl0IHRoaXMuY29uZmlndXJhdGlvblByb21pc2VcbiAgICBjb25zdCB7aG9zdCwgcG9ydH0gPSBjb25maWd1cmF0aW9uLmdldEJhY2tncm91bmRKb2JzQ29uZmlnKClcbiAgICBjb25zdCB7Z2VuZXJhdGlvbklkfSA9IGNvbmZpZ3VyYXRpb24ucmVzb2x2ZUJhY2tncm91bmRKb2JzR2VuZXJhdGlvbkNvbmZpZyh7XG4gICAgICBnZW5lcmF0aW9uSWQ6IHRoaXMuZXhwbGljaXRHZW5lcmF0aW9uSWQsXG4gICAgICBzb3VyY2VOYW1lOiBcIkJhY2tncm91bmRKb2JzQ2xpZW50XCJcbiAgICB9KVxuXG4gICAgcmV0dXJuIG5ldyBCYWNrZ3JvdW5kSm9ic1NvY2tldFJlcXVlc3Qoe2hvc3QsIHBvcnQsIHJvbGU6IFwiY2xpZW50XCIsIGdlbmVyYXRpb25IYW5kc2hha2VUaW1lb3V0TXM6IHRoaXMuZ2VuZXJhdGlvbkhhbmRzaGFrZVRpbWVvdXRNcywgZ2VuZXJhdGlvbklkfSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGVucXVldWUuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gT3B0aW9ucy5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGFyZ3Muam9iTmFtZSAtIEpvYiBuYW1lLlxuICAgKiBAcGFyYW0ge0FycmF5PFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gYXJncy5hcmdzIC0gSm9iIGFyZ3MuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi90eXBlcy5qc1wiKS5CYWNrZ3JvdW5kSm9iT3B0aW9uc30gW2FyZ3Mub3B0aW9uc10gLSBKb2Igb3B0aW9ucy5cbiAgICogQHBhcmFtIHtzdHJpbmd9IFthcmdzLnByb2R1Y2VySW52b2NhdGlvbklkXSAtIFN0YWJsZSBpZGVudGl0eSBmb3Igb25lIG93bmVkIGVucXVldWUgaW52b2NhdGlvbi5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL3R5cGVzLmpzXCIpLkJhY2tncm91bmRKb2JQcm9kdWNlclByb29mfSBbYXJncy5wcm9kdWNlclByb29mXSAtIEV4YWN0IGludGVybmFsIHByb2R1Y2VyIGhhbmRvZmYuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHN0cmluZz59IC0gSm9iIGlkLlxuICAgKi9cbiAgYXN5bmMgZW5xdWV1ZSh7am9iTmFtZSwgYXJncywgb3B0aW9ucywgcHJvZHVjZXJJbnZvY2F0aW9uSWQsIHByb2R1Y2VyUHJvb2Z9KSB7XG4gICAgY29uc3QgbWVzc2FnZSA9IHtcbiAgICAgIHR5cGU6IC8qKiBAdHlwZSB7Y29uc3R9ICovIChcImVucXVldWVcIiksXG4gICAgICBqb2JOYW1lLFxuICAgICAgYXJncyxcbiAgICAgIG9wdGlvbnMsXG4gICAgICAuLi4ocHJvZHVjZXJJbnZvY2F0aW9uSWQgPyB7cHJvZHVjZXJJbnZvY2F0aW9uSWR9IDoge30pLFxuICAgICAgLi4uKHByb2R1Y2VyUHJvb2YgPyB7cHJvZHVjZXJQcm9vZn0gOiB7fSlcbiAgICB9XG4gICAgY29uc3QgYWNrbm93bGVkZ2VtZW50ID0ge2V4cGxpY2l0bHlSZWplY3RlZDogZmFsc2UsIGdlbmVyYXRpb25GZW5jZWQ6IGZhbHNlLCByZXF1ZXN0U2VudDogZmFsc2V9XG4gICAgLyoqXG4gICAgICogU2VuZHMgb25lIGVucXVldWUgYXR0ZW1wdC4gQW4gb3duZWQgY2FsbGVyIG1heSByZXBsYXkgdGhpcyBleGFjdCBtZXNzYWdlXG4gICAgICogb25jZSB3aGVuIHRyYW5zcG9ydCBhY2tub3dsZWRnZW1lbnQgcmVtYWlucyBhbWJpZ3VvdXMgYWZ0ZXIgc2VuZC5cbiAgICAgKiBAcGFyYW0ge3tleHBsaWNpdGx5UmVqZWN0ZWQ6IGJvb2xlYW4sIGdlbmVyYXRpb25GZW5jZWQ6IGJvb2xlYW4sIHJlcXVlc3RTZW50OiBib29sZWFufSB8IHVuZGVmaW5lZH0gYXR0ZW1wdEFja25vd2xlZGdlbWVudCAtIEZpcnN0LWF0dGVtcHQgb2JzZXJ2YXRpb25zLlxuICAgICAqIEByZXR1cm5zIHtQcm9taXNlPHN0cmluZz59IC0gSm9iIGlkLlxuICAgICAqL1xuICAgIGNvbnN0IGVucXVldWVBdHRlbXB0ID0gYXN5bmMgKGF0dGVtcHRBY2tub3dsZWRnZW1lbnQpID0+IHtcbiAgICAgIGNvbnN0IHJlcXVlc3QgPSBhd2FpdCB0aGlzLl9yZXF1ZXN0KClcbiAgICAgIGNvbnN0IHJlcXVlc3RBYm9ydENvbnRyb2xsZXIgPSBuZXcgQWJvcnRDb250cm9sbGVyKClcbiAgICAgIGNvbnN0IHRpbWVvdXRFcnJvck1lc3NhZ2UgPSBgQmFja2dyb3VuZCBqb2IgZW5xdWV1ZSBhY2tub3dsZWRnZW1lbnQgdGltZWQgb3V0IGFmdGVyICR7dGhpcy5lbnF1ZXVlVGltZW91dE1zfW1zYFxuICAgICAgLyoqXG4gICAgICAgKiBSZXNvbHZlcyB0aGUgcHJlLXNlbmQgcGhhc2Ugd2hlbiB0aGUgbXV0YXRpb24gaGFzIGVudGVyZWQgdGhlIHNvY2tldC5cbiAgICAgICAqIEB0eXBlIHsoKSA9PiB2b2lkfVxuICAgICAgICovXG4gICAgICBsZXQgbWFya1JlcXVlc3RTZW50ID0gKCkgPT4ge31cbiAgICAgIGNvbnN0IHJlcXVlc3RTZW50ID0gbmV3IFByb21pc2UoKHJlc29sdmUpID0+IHtcbiAgICAgICAgbWFya1JlcXVlc3RTZW50ID0gKCkgPT4gcmVzb2x2ZSh1bmRlZmluZWQpXG4gICAgICB9KVxuICAgICAgLyoqXG4gICAgICAgKiBBcHBsaWVzIHRoZSBjb25maWd1cmVkIGRlYWRsaW5lIGluZGVwZW5kZW50bHkgdG8gb25lIHJlcXVlc3QgcGhhc2UuXG4gICAgICAgKiBAdGVtcGxhdGUgVFxuICAgICAgICogQHBhcmFtIHsoKSA9PiBQcm9taXNlPFQ+fSBjYWxsYmFjayAtIFBoYXNlIHdvcmsuXG4gICAgICAgKiBAcmV0dXJucyB7UHJvbWlzZTxUPn0gLSBQaGFzZSByZXN1bHQuXG4gICAgICAgKi9cbiAgICAgIGNvbnN0IHdpdGhFbnF1ZXVlVGltZW91dCA9IGFzeW5jIChjYWxsYmFjaykgPT4gYXdhaXQgdGltZW91dCh7XG4gICAgICAgIGVycm9yTWVzc2FnZTogdGltZW91dEVycm9yTWVzc2FnZSxcbiAgICAgICAgdGltZW91dDogdGhpcy5lbnF1ZXVlVGltZW91dE1zXG4gICAgICB9LCBhc3luYyAoe2NvbnRyb2x9KSA9PiB7XG4gICAgICAgIGNvbnN0IGFib3J0UmVxdWVzdCA9ICgpID0+IHJlcXVlc3RBYm9ydENvbnRyb2xsZXIuYWJvcnQoY29udHJvbC5zaWduYWwucmVhc29uKVxuXG4gICAgICAgIGNvbnRyb2wuc2lnbmFsLmFkZEV2ZW50TGlzdGVuZXIoXCJhYm9ydFwiLCBhYm9ydFJlcXVlc3QpXG4gICAgICAgIHRyeSB7XG4gICAgICAgICAgcmV0dXJuIGF3YWl0IGNhbGxiYWNrKClcbiAgICAgICAgfSBmaW5hbGx5IHtcbiAgICAgICAgICBjb250cm9sLnNpZ25hbC5yZW1vdmVFdmVudExpc3RlbmVyKFwiYWJvcnRcIiwgYWJvcnRSZXF1ZXN0KVxuICAgICAgICB9XG4gICAgICB9KVxuICAgICAgY29uc3QgcmVxdWVzdFByb21pc2UgPSByZXF1ZXN0LnJ1bih7XG4gICAgICAgIHNpZ25hbDogcmVxdWVzdEFib3J0Q29udHJvbGxlci5zaWduYWwsXG4gICAgICAgIG9uQ29ubmVjdDogKGpzb25Tb2NrZXQpID0+IHtcbiAgICAgICAgICBqc29uU29ja2V0LnNlbmQobWVzc2FnZSlcbiAgICAgICAgICBpZiAoYXR0ZW1wdEFja25vd2xlZGdlbWVudCkge1xuICAgICAgICAgICAgYXR0ZW1wdEFja25vd2xlZGdlbWVudC5nZW5lcmF0aW9uRmVuY2VkID0gQm9vbGVhbihyZXF1ZXN0LmdlbmVyYXRpb25JZClcbiAgICAgICAgICAgIGF0dGVtcHRBY2tub3dsZWRnZW1lbnQucmVxdWVzdFNlbnQgPSB0cnVlXG4gICAgICAgICAgfVxuICAgICAgICAgIG1hcmtSZXF1ZXN0U2VudCgpXG4gICAgICAgIH0sXG4gICAgICAgIG9uTWVzc2FnZTogKHttZXNzYWdlLCByZXNvbHZlLCByZWplY3R9KSA9PiB7XG4gICAgICAgICAgaWYgKG1lc3NhZ2U/LnR5cGUgPT09IFwiZW5xdWV1ZWRcIikge1xuICAgICAgICAgICAgcmVzb2x2ZShtZXNzYWdlLmpvYklkKVxuICAgICAgICAgICAgcmV0dXJuXG4gICAgICAgICAgfVxuXG4gICAgICAgICAgaWYgKG1lc3NhZ2U/LnR5cGUgPT09IFwiZW5xdWV1ZS1lcnJvclwiKSB7XG4gICAgICAgICAgICBpZiAoYXR0ZW1wdEFja25vd2xlZGdlbWVudCkgYXR0ZW1wdEFja25vd2xlZGdlbWVudC5leHBsaWNpdGx5UmVqZWN0ZWQgPSB0cnVlXG4gICAgICAgICAgICByZWplY3QobmV3IEVycm9yKG1lc3NhZ2UuZXJyb3IgfHwgXCJGYWlsZWQgdG8gZW5xdWV1ZSBqb2JcIikpXG4gICAgICAgICAgfVxuICAgICAgICB9XG4gICAgICB9KVxuXG4gICAgICBhd2FpdCB3aXRoRW5xdWV1ZVRpbWVvdXQoYXN5bmMgKCkgPT4gYXdhaXQgUHJvbWlzZS5yYWNlKFtyZXF1ZXN0U2VudCwgcmVxdWVzdFByb21pc2VdKSlcblxuICAgICAgcmV0dXJuIGF3YWl0IHdpdGhFbnF1ZXVlVGltZW91dChhc3luYyAoKSA9PiBhd2FpdCByZXF1ZXN0UHJvbWlzZSlcbiAgICB9XG5cbiAgICB0cnkge1xuICAgICAgcmV0dXJuIGF3YWl0IGVucXVldWVBdHRlbXB0KGFja25vd2xlZGdlbWVudClcbiAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgaWYgKCFwcm9kdWNlckludm9jYXRpb25JZCB8fCAhcHJvZHVjZXJQcm9vZiB8fCAhYWNrbm93bGVkZ2VtZW50LmdlbmVyYXRpb25GZW5jZWQgfHwgIWFja25vd2xlZGdlbWVudC5yZXF1ZXN0U2VudCB8fCBhY2tub3dsZWRnZW1lbnQuZXhwbGljaXRseVJlamVjdGVkKSB0aHJvdyBlcnJvclxuICAgIH1cblxuICAgIHJldHVybiBhd2FpdCBlbnF1ZXVlQXR0ZW1wdCh1bmRlZmluZWQpXG4gIH1cblxuICAvKipcbiAgICogQXRvbWljYWxseSByZXBsYWNlcyB0aGUgcXVldWVkIG93bmVyIG9mIGEgc3RhYmxlIHNjaGVkdWxlIGtleS5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBPcHRpb25zLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gYXJncy5zY2hlZHVsZUtleSAtIFN0YWJsZSBsb2dpY2FsIHNjaGVkdWxlIGtleS5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGFyZ3Muam9iTmFtZSAtIEpvYiBuYW1lLlxuICAgKiBAcGFyYW0ge0FycmF5PFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gYXJncy5hcmdzIC0gSm9iIGFyZ3MuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi90eXBlcy5qc1wiKS5CYWNrZ3JvdW5kSm9iT3B0aW9uc30gW2FyZ3Mub3B0aW9uc10gLSBKb2Igb3B0aW9ucy5cbiAgICogQHJldHVybnMge1Byb21pc2U8aW1wb3J0KFwiLi90eXBlcy5qc1wiKS5CYWNrZ3JvdW5kSm9iUmVwbGFjZW1lbnRSZXN1bHQ+fSAtIFJlcGxhY2VtZW50IHJlc3VsdC5cbiAgICovXG4gIGFzeW5jIHJlcGxhY2VTY2hlZHVsZWQoe3NjaGVkdWxlS2V5LCBqb2JOYW1lLCBhcmdzLCBvcHRpb25zfSkge1xuICAgIGNvbnN0IHJlcXVlc3QgPSBhd2FpdCB0aGlzLl9yZXF1ZXN0KClcblxuICAgIHJldHVybiBhd2FpdCByZXF1ZXN0LnJ1bih7XG4gICAgICBvbkNvbm5lY3Q6IChqc29uU29ja2V0KSA9PiB7XG4gICAgICAgIGpzb25Tb2NrZXQuc2VuZCh7dHlwZTogXCJyZXBsYWNlLXNjaGVkdWxlZFwiLCBzY2hlZHVsZUtleSwgam9iTmFtZSwgYXJncywgb3B0aW9uc30pXG4gICAgICB9LFxuICAgICAgb25NZXNzYWdlOiAoe21lc3NhZ2UsIHJlc29sdmUsIHJlamVjdH0pID0+IHtcbiAgICAgICAgaWYgKG1lc3NhZ2U/LnR5cGUgPT09IFwic2NoZWR1bGUtcmVwbGFjZWRcIikge1xuICAgICAgICAgIHJlc29sdmUoe1xuICAgICAgICAgICAgam9iSWQ6IG1lc3NhZ2Uuam9iSWQsXG4gICAgICAgICAgICBwcmV2aW91c0pvYklkOiBtZXNzYWdlLnByZXZpb3VzSm9iSWQsXG4gICAgICAgICAgICBwcmV2aW91c1N0YXR1czogbWVzc2FnZS5wcmV2aW91c1N0YXR1c1xuICAgICAgICAgIH0pXG4gICAgICAgICAgcmV0dXJuXG4gICAgICAgIH1cblxuICAgICAgICBpZiAobWVzc2FnZT8udHlwZSA9PT0gXCJyZXBsYWNlLXNjaGVkdWxlZC1lcnJvclwiKSB7XG4gICAgICAgICAgcmVqZWN0KG5ldyBFcnJvcihtZXNzYWdlLmVycm9yIHx8IFwiRmFpbGVkIHRvIHJlcGxhY2Ugc2NoZWR1bGVkIGpvYlwiKSlcbiAgICAgICAgfVxuICAgICAgfVxuICAgIH0pXG4gIH1cblxuICAvKipcbiAgICogQ2FuY2VscyBvciBkZXRhY2hlcyB0aGUgY3VycmVudCBvd25lciBvZiBhIHN0YWJsZSBzY2hlZHVsZSBrZXkuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gT3B0aW9ucy5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGFyZ3Muc2NoZWR1bGVLZXkgLSBTdGFibGUgbG9naWNhbCBzY2hlZHVsZSBrZXkuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPGltcG9ydChcIi4vdHlwZXMuanNcIikuQmFja2dyb3VuZEpvYkNhbmNlbGxhdGlvblJlc3VsdD59IC0gQ2FuY2VsbGF0aW9uIHJlc3VsdC5cbiAgICovXG4gIGFzeW5jIGNhbmNlbFNjaGVkdWxlZCh7c2NoZWR1bGVLZXl9KSB7XG4gICAgY29uc3QgcmVxdWVzdCA9IGF3YWl0IHRoaXMuX3JlcXVlc3QoKVxuXG4gICAgcmV0dXJuIGF3YWl0IHJlcXVlc3QucnVuKHtcbiAgICAgIG9uQ29ubmVjdDogKGpzb25Tb2NrZXQpID0+IHtcbiAgICAgICAganNvblNvY2tldC5zZW5kKHt0eXBlOiBcImNhbmNlbC1zY2hlZHVsZWRcIiwgc2NoZWR1bGVLZXl9KVxuICAgICAgfSxcbiAgICAgIG9uTWVzc2FnZTogKHttZXNzYWdlLCByZXNvbHZlLCByZWplY3R9KSA9PiB7XG4gICAgICAgIGlmIChtZXNzYWdlPy50eXBlID09PSBcInNjaGVkdWxlLWNhbmNlbGxlZFwiKSB7XG4gICAgICAgICAgcmVzb2x2ZSh7am9iSWQ6IG1lc3NhZ2Uuam9iSWQsIG91dGNvbWU6IG1lc3NhZ2Uub3V0Y29tZX0pXG4gICAgICAgICAgcmV0dXJuXG4gICAgICAgIH1cblxuICAgICAgICBpZiAobWVzc2FnZT8udHlwZSA9PT0gXCJjYW5jZWwtc2NoZWR1bGVkLWVycm9yXCIpIHtcbiAgICAgICAgICByZWplY3QobmV3IEVycm9yKG1lc3NhZ2UuZXJyb3IgfHwgXCJGYWlsZWQgdG8gY2FuY2VsIHNjaGVkdWxlZCBqb2JcIikpXG4gICAgICAgIH1cbiAgICAgIH1cbiAgICB9KVxuICB9XG59XG4iXX0=