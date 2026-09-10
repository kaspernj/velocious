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
        const acknowledgement = { explicitlyRejected: false, requestSent: false };
        /**
         * Sends one enqueue attempt. An owned caller may replay this exact message
         * once when transport acknowledgement remains ambiguous after send.
         * @param {{explicitlyRejected: boolean, requestSent: boolean} | undefined} attemptAcknowledgement - First-attempt observations.
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
                    if (attemptAcknowledgement)
                        attemptAcknowledgement.requestSent = true;
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
            if (!producerInvocationId || !producerProof || !acknowledgement.requestSent || acknowledgement.explicitlyRejected)
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiY2xpZW50LmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiLi4vLi4vLi4vc3JjL2JhY2tncm91bmQtam9icy9jbGllbnQuanMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6IkFBQUEsWUFBWTtBQUVaLE9BQU8sT0FBTyxNQUFNLDJCQUEyQixDQUFBO0FBQy9DLE9BQU8scUJBQXFCLE1BQU0sOEJBQThCLENBQUE7QUFDaEUsT0FBTywyQkFBMkIsTUFBTSxxQkFBcUIsQ0FBQTtBQUM3RCxPQUFPLEVBQUUsdUNBQXVDLEVBQUUsb0NBQW9DLEVBQUUsTUFBTSx5Q0FBeUMsQ0FBQTtBQUV2SSxNQUFNLDBCQUEwQixHQUFHLElBQUksQ0FBQTtBQUV2QyxNQUFNLENBQUMsT0FBTyxPQUFPLG9CQUFvQjtJQUN2Qzs7Ozs7OztPQU9HO0lBQ0gsWUFBWSxFQUFDLGFBQWEsRUFBRSxnQkFBZ0IsR0FBRywwQkFBMEIsRUFBRSw0QkFBNEIsR0FBRyx1Q0FBdUMsRUFBRSxZQUFZLEVBQUMsR0FBRyxFQUFFO1FBQ25LLElBQUksQ0FBQyxvQkFBb0IsR0FBRyxhQUFhLENBQUMsQ0FBQyxDQUFDLE9BQU8sQ0FBQyxPQUFPLENBQUMsYUFBYSxDQUFDLENBQUMsQ0FBQyxDQUFDLHFCQUFxQixFQUFFLENBQUE7UUFDcEcsSUFBSSxDQUFDLGdCQUFnQixHQUFHLGdCQUFnQixDQUFBO1FBQ3hDLElBQUksQ0FBQyw0QkFBNEIsR0FBRyxvQ0FBb0MsQ0FBQyw0QkFBNEIsQ0FBQyxDQUFBO1FBQ3RHLElBQUksQ0FBQyxvQkFBb0IsR0FBRyxZQUFZLENBQUE7SUFDMUMsQ0FBQztJQUVEOzs7T0FHRztJQUNILEtBQUssQ0FBQyxRQUFRO1FBQ1osTUFBTSxhQUFhLEdBQUcsTUFBTSxJQUFJLENBQUMsb0JBQW9CLENBQUE7UUFDckQsTUFBTSxFQUFDLElBQUksRUFBRSxJQUFJLEVBQUMsR0FBRyxhQUFhLENBQUMsdUJBQXVCLEVBQUUsQ0FBQTtRQUM1RCxNQUFNLEVBQUMsWUFBWSxFQUFDLEdB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LENBQUMsR0FBRyxDQUFDO1lBQ3ZCLFNBQVMsRUFBRSxDQUFDLFVBQVUsRUFBRSxFQUFFO2dCQUN4QixVQUFVLENBQUMsSUFBSSxDQUFDLEVBQUMsSUFBSSxFQUFFLGtCQUFrQixFQUFFLFdBQVcsRUFBQyxDQUFDLENBQUE7WUFDMUQsQ0FBQztZQUNELFNBQVMsRUFBRSxDQUFDLEVBQUMsT0FBTyxFQUFFLE9BQU8sRUFBRSxNQUFNLEVBQUMsRUFBRSxFQUFFO2dCQUN4QyxJQUFJLE9BQU8sRUFBRSxJQUFJLEtBQUssb0JBQW9CLEVBQUUsQ0FBQztvQkFDM0MsT0FBTyxDQUFDLEVBQUMsS0FBSyxFQUFFLE9BQU8sQ0FBQyxLQUFLLEVBQUUsT0FBTyxFQUFFLE9BQU8sQ0FBQyxPQUFPLEVBQUMsQ0FBQyxDQUFBO29CQUN6RCxPQUFNO2dCQUNSLENBQUM7Z0JBRUQsSUFBSSxPQUFPLEVBQUUsSUFBSSxLQUFLLHdCQUF3QixFQUFFLENBQUM7b0JBQy9DLE1BQU0sQ0FBQyxJQUFJLEtBQUssQ0FBQyxPQUFPLENBQUMsS0FBSyxJQUFJLGdDQUFnQyxDQUFDLENBQUMsQ0FBQTtnQkFDdEUsQ0FBQztZQUNILENBQUM7U0FDRixDQUFDLENBQUE7SUFDSixDQUFDO0NBQ0YiLCJzb3VyY2VzQ29udGVudCI6WyIvLyBAdHMtY2hlY2tcblxuaW1wb3J0IHRpbWVvdXQgZnJvbSBcImF3YWl0ZXJ5L2J1aWxkL3RpbWVvdXQuanNcIlxuaW1wb3J0IGNvbmZpZ3VyYXRpb25SZXNvbHZlciBmcm9tIFwiLi4vY29uZmlndXJhdGlvbi1yZXNvbHZlci5qc1wiXG5pbXBvcnQgQmFja2dyb3VuZEpvYnNTb2NrZXRSZXF1ZXN0IGZyb20gXCIuL3NvY2tldC1yZXF1ZXN0LmpzXCJcbmltcG9ydCB7IERFRkFVTFRfR0VORVJBVElPTl9IQU5EU0hBS0VfVElNRU9VVF9NUywgdmFsaWRhdGVHZW5lcmF0aW9uSGFuZHNoYWtlVGltZW91dE1zIH0gZnJvbSBcIi4vZ2VuZXJhdGlvbi1oYW5kc2hha2UtdGltZW91dC1lcnJvci5qc1wiXG5cbmNvbnN0IERFRkFVTFRfRU5RVUVVRV9USU1FT1VUX01TID0gNTAwMFxuXG5leHBvcnQgZGVmYXVsdCBjbGFzcyBCYWNrZ3JvdW5kSm9ic0NsaWVudCB7XG4gIC8qKlxuICAgKiBSdW5zIGNvbnN0cnVjdG9yLlxuICAgKiBAcGFyYW0ge29iamVjdH0gW2FyZ3NdIC0gT3B0aW9ucy5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9jb25maWd1cmF0aW9uLmpzXCIpLmRlZmF1bHR9IFthcmdzLmNvbmZpZ3VyYXRpb25dIC0gQ29uZmlndXJhdGlvbi5cbiAgICogQHBhcmFtIHtudW1iZXJ9IFthcmdzLmVucXVldWVUaW1lb3V0TXNdIC0gTWF4aW11bSB0aW1lIHRvIHdhaXQgZm9yIGFuIGVucXVldWUgYWNrbm93bGVkZ2VtZW50IGluIG1pbGxpc2Vjb25kcyAoZGVmYXVsdDogNTAwMCkuXG4gICAqIEBwYXJhbSB7bnVtYmVyfSBbYXJncy5nZW5lcmF0aW9uSGFuZHNoYWtlVGltZW91dE1zXSAtIE1heGltdW0gdGltZSB0byB3YWl0IGZvciBnZW5lcmF0aW9uIGFja25vd2xlZGdlbWVudCAoZGVmYXVsdDogNDAwMCkuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBbYXJncy5nZW5lcmF0aW9uSWRdIC0gRXhwbGljaXQgcmVsZWFzZSBnZW5lcmF0aW9uIGlkZW50aXR5LlxuICAgKi9cbiAgY29uc3RydWN0b3Ioe2NvbmZpZ3VyYXRpb24sIGVucXVldWVUaW1lb3V0TXMgPSBERUZBVUxUX0VOUVVFVUVfVElNRU9VVF9NUywgZ2VuZXJhdGlvbkhhbmRzaGFrZVRpbWVvdXRNcyA9IERFRkFVTFRfR0VORVJBVElPTl9IQU5EU0hBS0VfVElNRU9VVF9NUywgZ2VuZXJhdGlvbklkfSA9IHt9KSB7XG4gICAgdGhpcy5jb25maWd1cmF0aW9uUHJvbWlzZSA9IGNvbmZpZ3VyYXRpb24gPyBQcm9taXNlLnJlc29sdmUoY29uZmlndXJhdGlvbikgOiBjb25maWd1cmF0aW9uUmVzb2x2ZXIoKVxuICAgIHRoaXMuZW5xdWV1ZVRpbWVvdXRNcyA9IGVucXVldWVUaW1lb3V0TXNcbiAgICB0aGlzLmdlbmVyYXRpb25IYW5kc2hha2VUaW1lb3V0TXMgPSB2YWxpZGF0ZUdlbmVyYXRpb25IYW5kc2hha2VUaW1lb3V0TXMoZ2VuZXJhdGlvbkhhbmRzaGFrZVRpbWVvdXRNcylcbiAgICB0aGlzLmV4cGxpY2l0R2VuZXJhdGlvbklkID0gZ2VuZXJhdGlvbklkXG4gIH1cblxuICAvKipcbiAgICogQnVpbGRzIGEgb25lLXNob3QgY2xpZW50IHNvY2tldCByZXF1ZXN0IGZyb20gdGhlIHJlc29sdmVkIGNvbmZpZ3VyYXRpb24uXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPEJhY2tncm91bmRKb2JzU29ja2V0UmVxdWVzdD59IC0gU29ja2V0IHJlcXVlc3QuXG4gICAqL1xuICBhc3luYyBfcmVxdWVzdCgpIHtcbiAgICBjb25zdCBjb25maWd1cmF0aW9uID0gYXdhaXQgdGhpcy5jb25maWd1cmF0aW9uUHJvbWlzZVxuICAgIGNvbnN0IHtob3N0LCBwb3J0fSA9IGNvbmZpZ3VyYXRpb24uZ2V0QmFja2dyb3VuZEpvYnNDb25maWcoKVxuICAgIGNvbnN0IHtnZW5lcmF0aW9uSWR9ID0gY29uZmlndXJhdGlvbi5yZXNvbHZlQmFja2dyb3VuZEpvYnNHZW5lcmF0aW9uQ29uZmlnKHtcbiAgICAgIGdlbmVyYXRpb25JZDogdGhpcy5leHBsaWNpdEdlbmVyYXRpb25JZCxcbiAgICAgIHNvdXJjZU5hbWU6IFwiQmFja2dyb3VuZEpvYnNDbGllbnRcIlxuICAgIH0pXG5cbiAgICByZXR1cm4gbmV3IEJhY2tncm91bmRKb2JzU29ja2V0UmVxdWVzdCh7aG9zdCwgcG9ydCwgcm9sZTogXCJjbGllbnRcIiwgZ2VuZXJhdGlvbkhhbmRzaGFrZVRpbWVvdXRNczogdGhpcy5nZW5lcmF0aW9uSGFuZHNoYWtlVGltZW91dE1zLCBnZW5lcmF0aW9uSWR9KVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZW5xdWV1ZS5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBPcHRpb25zLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gYXJncy5qb2JOYW1lIC0gSm9iIG5hbWUuXG4gICAqIEBwYXJhbSB7QXJyYXk8UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSBhcmdzLmFyZ3MgLSBKb2IgYXJncy5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL3R5cGVzLmpzXCIpLkJhY2tncm91bmRKb2JPcHRpb25zfSBbYXJncy5vcHRpb25zXSAtIEpvYiBvcHRpb25zLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gW2FyZ3MucHJvZHVjZXJJbnZvY2F0aW9uSWRdIC0gU3RhYmxlIGlkZW50aXR5IGZvciBvbmUgb3duZWQgZW5xdWV1ZSBpbnZvY2F0aW9uLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vdHlwZXMuanNcIikuQmFja2dyb3VuZEpvYlByb2R1Y2VyUHJvb2Z9IFthcmdzLnByb2R1Y2VyUHJvb2ZdIC0gRXhhY3QgaW50ZXJuYWwgcHJvZHVjZXIgaGFuZG9mZi5cbiAgICogQHJldHVybnMge1Byb21pc2U8c3RyaW5nPn0gLSBKb2IgaWQuXG4gICAqL1xuICBhc3luYyBlbnF1ZXVlKHtqb2JOYW1lLCBhcmdzLCBvcHRpb25zLCBwcm9kdWNlckludm9jYXRpb25JZCwgcHJvZHVjZXJQcm9vZn0pIHtcbiAgICBjb25zdCBtZXNzYWdlID0ge1xuICAgICAgdHlwZTogLyoqIEB0eXBlIHtjb25zdH0gKi8gKFwiZW5xdWV1ZVwiKSxcbiAgICAgIGpvYk5hbWUsXG4gICAgICBhcmdzLFxuICAgICAgb3B0aW9ucyxcbiAgICAgIC4uLihwcm9kdWNlckludm9jYXRpb25JZCA/IHtwcm9kdWNlckludm9jYXRpb25JZH0gOiB7fSksXG4gICAgICAuLi4ocHJvZHVjZXJQcm9vZiA/IHtwcm9kdWNlclByb29mfSA6IHt9KVxuICAgIH1cbiAgICBjb25zdCBhY2tub3dsZWRnZW1lbnQgPSB7ZXhwbGljaXRseVJlamVjdGVkOiBmYWxzZSwgcmVxdWVzdFNlbnQ6IGZhbHNlfVxuICAgIC8qKlxuICAgICAqIFNlbmRzIG9uZSBlbnF1ZXVlIGF0dGVtcHQuIEFuIG93bmVkIGNhbGxlciBtYXkgcmVwbGF5IHRoaXMgZXhhY3QgbWVzc2FnZVxuICAgICAqIG9uY2Ugd2hlbiB0cmFuc3BvcnQgYWNrbm93bGVkZ2VtZW50IHJlbWFpbnMgYW1iaWd1b3VzIGFmdGVyIHNlbmQuXG4gICAgICogQHBhcmFtIHt7ZXhwbGljaXRseVJlamVjdGVkOiBib29sZWFuLCByZXF1ZXN0U2VudDogYm9vbGVhbn0gfCB1bmRlZmluZWR9IGF0dGVtcHRBY2tub3dsZWRnZW1lbnQgLSBGaXJzdC1hdHRlbXB0IG9ic2VydmF0aW9ucy5cbiAgICAgKiBAcmV0dXJucyB7UHJvbWlzZTxzdHJpbmc+fSAtIEpvYiBpZC5cbiAgICAgKi9cbiAgICBjb25zdCBlbnF1ZXVlQXR0ZW1wdCA9IGFzeW5jIChhdHRlbXB0QWNrbm93bGVkZ2VtZW50KSA9PiB7XG4gICAgICBjb25zdCByZXF1ZXN0ID0gYXdhaXQgdGhpcy5fcmVxdWVzdCgpXG5cbiAgICAgIHJldHVybiBhd2FpdCB0aW1lb3V0KHtcbiAgICAgICAgZXJyb3JNZXNzYWdlOiBgQmFja2dyb3VuZCBqb2IgZW5xdWV1ZSBhY2tub3dsZWRnZW1lbnQgdGltZWQgb3V0IGFmdGVyICR7dGhpcy5lbnF1ZXVlVGltZW91dE1zfW1zYCxcbiAgICAgICAgdGltZW91dDogdGhpcy5lbnF1ZXVlVGltZW91dE1zXG4gICAgICB9LCBhc3luYyAoe2NvbnRyb2x9KSA9PiBhd2FpdCByZXF1ZXN0LnJ1bih7XG4gICAgICAgIHNpZ25hbDogY29udHJvbC5zaWduYWwsXG4gICAgICAgIG9uQ29ubmVjdDogKGpzb25Tb2NrZXQpID0+IHtcbiAgICAgICAgICBqc29uU29ja2V0LnNlbmQobWVzc2FnZSlcbiAgICAgICAgICBpZiAoYXR0ZW1wdEFja25vd2xlZGdlbWVudCkgYXR0ZW1wdEFja25vd2xlZGdlbWVudC5yZXF1ZXN0U2VudCA9IHRydWVcbiAgICAgICAgfSxcbiAgICAgICAgb25NZXNzYWdlOiAoe21lc3NhZ2UsIHJlc29sdmUsIHJlamVjdH0pID0+IHtcbiAgICAgICAgICBpZiAobWVzc2FnZT8udHlwZSA9PT0gXCJlbnF1ZXVlZFwiKSB7XG4gICAgICAgICAgICByZXNvbHZlKG1lc3NhZ2Uuam9iSWQpXG4gICAgICAgICAgICByZXR1cm5cbiAgICAgICAgICB9XG5cbiAgICAgICAgICBpZiAobWVzc2FnZT8udHlwZSA9PT0gXCJlbnF1ZXVlLWVycm9yXCIpIHtcbiAgICAgICAgICAgIGlmIChhdHRlbXB0QWNrbm93bGVkZ2VtZW50KSBhdHRlbXB0QWNrbm93bGVkZ2VtZW50LmV4cGxpY2l0bHlSZWplY3RlZCA9IHRydWVcbiAgICAgICAgICAgIHJlamVjdChuZXcgRXJyb3IobWVzc2FnZS5lcnJvciB8fCBcIkZhaWxlZCB0byBlbnF1ZXVlIGpvYlwiKSlcbiAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICAgIH0pKVxuICAgIH1cblxuICAgIHRyeSB7XG4gICAgICByZXR1cm4gYXdhaXQgZW5xdWV1ZUF0dGVtcHQoYWNrbm93bGVkZ2VtZW50KVxuICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICBpZiAoIXByb2R1Y2VySW52b2NhdGlvbklkIHx8ICFwcm9kdWNlclByb29mIHx8ICFhY2tub3dsZWRnZW1lbnQucmVxdWVzdFNlbnQgfHwgYWNrbm93bGVkZ2VtZW50LmV4cGxpY2l0bHlSZWplY3RlZCkgdGhyb3cgZXJyb3JcbiAgICB9XG5cbiAgICByZXR1cm4gYXdhaXQgZW5xdWV1ZUF0dGVtcHQodW5kZWZpbmVkKVxuICB9XG5cbiAgLyoqXG4gICAqIEF0b21pY2FsbHkgcmVwbGFjZXMgdGhlIHF1ZXVlZCBvd25lciBvZiBhIHN0YWJsZSBzY2hlZHVsZSBrZXkuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gT3B0aW9ucy5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGFyZ3Muc2NoZWR1bGVLZXkgLSBTdGFibGUgbG9naWNhbCBzY2hlZHVsZSBrZXkuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBhcmdzLmpvYk5hbWUgLSBKb2IgbmFtZS5cbiAgICogQHBhcmFtIHtBcnJheTxSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59IGFyZ3MuYXJncyAtIEpvYiBhcmdzLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vdHlwZXMuanNcIikuQmFja2dyb3VuZEpvYk9wdGlvbnN9IFthcmdzLm9wdGlvbnNdIC0gSm9iIG9wdGlvbnMuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPGltcG9ydChcIi4vdHlwZXMuanNcIikuQmFja2dyb3VuZEpvYlJlcGxhY2VtZW50UmVzdWx0Pn0gLSBSZXBsYWNlbWVudCByZXN1bHQuXG4gICAqL1xuICBhc3luYyByZXBsYWNlU2NoZWR1bGVkKHtzY2hlZHVsZUtleSwgam9iTmFtZSwgYXJncywgb3B0aW9uc30pIHtcbiAgICBjb25zdCByZXF1ZXN0ID0gYXdhaXQgdGhpcy5fcmVxdWVzdCgpXG5cbiAgICByZXR1cm4gYXdhaXQgcmVxdWVzdC5ydW4oe1xuICAgICAgb25Db25uZWN0OiAoanNvblNvY2tldCkgPT4ge1xuICAgICAgICBqc29uU29ja2V0LnNlbmQoe3R5cGU6IFwicmVwbGFjZS1zY2hlZHVsZWRcIiwgc2NoZWR1bGVLZXksIGpvYk5hbWUsIGFyZ3MsIG9wdGlvbnN9KVxuICAgICAgfSxcbiAgICAgIG9uTWVzc2FnZTogKHttZXNzYWdlLCByZXNvbHZlLCByZWplY3R9KSA9PiB7XG4gICAgICAgIGlmIChtZXNzYWdlPy50eXBlID09PSBcInNjaGVkdWxlLXJlcGxhY2VkXCIpIHtcbiAgICAgICAgICByZXNvbHZlKHtcbiAgICAgICAgICAgIGpvYklkOiBtZXNzYWdlLmpvYklkLFxuICAgICAgICAgICAgcHJldmlvdXNKb2JJZDogbWVzc2FnZS5wcmV2aW91c0pvYklkLFxuICAgICAgICAgICAgcHJldmlvdXNTdGF0dXM6IG1lc3NhZ2UucHJldmlvdXNTdGF0dXNcbiAgICAgICAgICB9KVxuICAgICAgICAgIHJldHVyblxuICAgICAgICB9XG5cbiAgICAgICAgaWYgKG1lc3NhZ2U/LnR5cGUgPT09IFwicmVwbGFjZS1zY2hlZHVsZWQtZXJyb3JcIikge1xuICAgICAgICAgIHJlamVjdChuZXcgRXJyb3IobWVzc2FnZS5lcnJvciB8fCBcIkZhaWxlZCB0byByZXBsYWNlIHNjaGVkdWxlZCBqb2JcIikpXG4gICAgICAgIH1cbiAgICAgIH1cbiAgICB9KVxuICB9XG5cbiAgLyoqXG4gICAqIENhbmNlbHMgb3IgZGV0YWNoZXMgdGhlIGN1cnJlbnQgb3duZXIgb2YgYSBzdGFibGUgc2NoZWR1bGUga2V5LlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIE9wdGlvbnMuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBhcmdzLnNjaGVkdWxlS2V5IC0gU3RhYmxlIGxvZ2ljYWwgc2NoZWR1bGUga2V5LlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxpbXBvcnQoXCIuL3R5cGVzLmpzXCIpLkJhY2tncm91bmRKb2JDYW5jZWxsYXRpb25SZXN1bHQ+fSAtIENhbmNlbGxhdGlvbiByZXN1bHQuXG4gICAqL1xuICBhc3luYyBjYW5jZWxTY2hlZHVsZWQoe3NjaGVkdWxlS2V5fSkge1xuICAgIGNvbnN0IHJlcXVlc3QgPSBhd2FpdCB0aGlzLl9yZXF1ZXN0KClcblxuICAgIHJldHVybiBhd2FpdCByZXF1ZXN0LnJ1bih7XG4gICAgICBvbkNvbm5lY3Q6IChqc29uU29ja2V0KSA9PiB7XG4gICAgICAgIGpzb25Tb2NrZXQuc2VuZCh7dHlwZTogXCJjYW5jZWwtc2NoZWR1bGVkXCIsIHNjaGVkdWxlS2V5fSlcbiAgICAgIH0sXG4gICAgICBvbk1lc3NhZ2U6ICh7bWVzc2FnZSwgcmVzb2x2ZSwgcmVqZWN0fSkgPT4ge1xuICAgICAgICBpZiAobWVzc2FnZT8udHlwZSA9PT0gXCJzY2hlZHVsZS1jYW5jZWxsZWRcIikge1xuICAgICAgICAgIHJlc29sdmUoe2pvYklkOiBtZXNzYWdlLmpvYklkLCBvdXRjb21lOiBtZXNzYWdlLm91dGNvbWV9KVxuICAgICAgICAgIHJldHVyblxuICAgICAgICB9XG5cbiAgICAgICAgaWYgKG1lc3NhZ2U/LnR5cGUgPT09IFwiY2FuY2VsLXNjaGVkdWxlZC1lcnJvclwiKSB7XG4gICAgICAgICAgcmVqZWN0KG5ldyBFcnJvcihtZXNzYWdlLmVycm9yIHx8IFwiRmFpbGVkIHRvIGNhbmNlbCBzY2hlZHVsZWQgam9iXCIpKVxuICAgICAgICB9XG4gICAgICB9XG4gICAgfSlcbiAgfVxufVxuIl19