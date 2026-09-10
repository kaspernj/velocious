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
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiY2xpZW50LmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiLi4vLi4vLi4vc3JjL2JhY2tncm91bmQtam9icy9jbGllbnQuanMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6IkFBQUEsWUFBWTtBQUVaLE9BQU8sT0FBTyxNQUFNLDJCQUEyQixDQUFBO0FBQy9DLE9BQU8scUJBQXFCLE1BQU0sOEJBQThCLENBQUE7QUFDaEUsT0FBTywyQkFBMkIsTUFBTSxxQkFBcUIsQ0FBQTtBQUM3RCxPQUFPLEVBQUUsdUNBQXVDLEVBQUUsb0NBQW9DLEVBQUUsTUFBTSx5Q0FBeUMsQ0FBQTtBQUV2SSxNQUFNLDBCQUEwQixHQUFHLElBQUksQ0FBQTtBQUV2QyxNQUFNLENBQUMsT0FBTyxPQUFPLG9CQUFvQjtJQUN2Qzs7Ozs7OztPQU9HO0lBQ0gsWUFBWSxFQUFDLGFBQWEsRUFBRSxnQkFBZ0IsR0FBRywwQkFBMEIsRUFBRSw0QkFBNEIsR0FBRyx1Q0FBdUMsRUFBRSxZQUFZLEVBQUMsR0FBRyxFQUFFO1FBQ25LLElBQUksQ0FBQyxvQkFBb0IsR0FBRyxhQUFhLENBQUMsQ0FBQyxDQUFDLE9BQU8sQ0FBQyxPQUFPLENBQUMsYUFBYSxDQUFDLENBQUMsQ0FBQyxDQUFDLHFCQUFxQixFQUFFLENBQUE7UUFDcEcsSUFBSSxDQUFDLGdCQUFnQixHQUFHLGdCQUFnQixDQUFBO1FBQ3hDLElBQUksQ0FBQyw0QkFBNEIsR0FBRyxvQ0FBb0MsQ0FBQyw0QkFBNEIsQ0FBQyxDQUFBO1FBQ3RHLElBQUksQ0FBQyxvQkFBb0IsR0FBRyxZQUFZLENBQUE7SUFDMUMsQ0FBQztJQUVEOzs7T0FHRztJQUNILEtBQUssQ0FBQyxRQUFRO1FBQ1osTUFBTSxhQUFhLEdBQUcsTUFBTSxJQUFJLENBQUMsb0JBQW9CLENBQUE7UUFDckQsTUFBTSxFQUFDLElBQUksRUFBRSxJQUFJLEVBQUMsR0FBRyxhQUFhLENBQUMsdUJBQXVCLEVBQUUsQ0FBQTtRQUM1RCxNQUFNLEVBQUMsWUFBWSxFQUFDLEdB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QTtJQUNKLENBQUM7SUFFRDs7Ozs7T0FLRztJQUNILEtBQUssQ0FBQyxlQUFlLENBQUMsRUFBQyxXQUFXLEVBQUM7UUFDakMsTUFBTSxPQUFPLEdBQUcsTUFBTSxJQUFJLENBQUMsUUFBUSxFQUFFLENBQUE7UUFFckMsT0FBTyxNQUFNLE9BQU8sQ0FBQyxHQUFHLENBQUM7WUFDdkIsU0FBUyxFQUFFLENBQUMsVUFBVSxFQUFFLEVBQUU7Z0JBQ3hCLFVBQVUsQ0FBQyxJQUFJLENBQUMsRUFBQyxJQUFJLEVBQUUsa0JBQWtCLEVBQUUsV0FBVyxFQUFDLENBQUMsQ0FBQTtZQUMxRCxDQUFDO1lBQ0QsU0FBUyxFQUFFLENBQUMsRUFBQyxPQUFPLEVBQUUsT0FBTyxFQUFFLE1BQU0sRUFBQyxFQUFFLEVBQUU7Z0JBQ3hDLElBQUksT0FBTyxFQUFFLElBQUksS0FBSyxvQkFBb0IsRUFBRSxDQUFDO29CQUMzQyxPQUFPLENBQUMsRUFBQyxLQUFLLEVBQUUsT0FBTyxDQUFDLEtBQUssRUFBRSxPQUFPLEVBQUUsT0FBTyxDQUFDLE9BQU8sRUFBQyxDQUFDLENBQUE7b0JBQ3pELE9BQU07Z0JBQ1IsQ0FBQztnQkFFRCxJQUFJLE9BQU8sRUFBRSxJQUFJLEtBQUssd0JBQXdCLEVBQUUsQ0FBQztvQkFDL0MsTUFBTSxDQUFDLElBQUksS0FBSyxDQUFDLE9BQU8sQ0FBQyxLQUFLLElBQUksZ0NBQWdDLENBQUMsQ0FBQyxDQUFBO2dCQUN0RSxDQUFDO1lBQ0gsQ0FBQztTQUNGLENBQUMsQ0FBQTtJQUNKLENBQUM7Q0FDRiIsInNvdXJjZXNDb250ZW50IjpbIi8vIEB0cy1jaGVja1xuXG5pbXBvcnQgdGltZW91dCBmcm9tIFwiYXdhaXRlcnkvYnVpbGQvdGltZW91dC5qc1wiXG5pbXBvcnQgY29uZmlndXJhdGlvblJlc29sdmVyIGZyb20gXCIuLi9jb25maWd1cmF0aW9uLXJlc29sdmVyLmpzXCJcbmltcG9ydCBCYWNrZ3JvdW5kSm9ic1NvY2tldFJlcXVlc3QgZnJvbSBcIi4vc29ja2V0LXJlcXVlc3QuanNcIlxuaW1wb3J0IHsgREVGQVVMVF9HRU5FUkFUSU9OX0hBTkRTSEFLRV9USU1FT1VUX01TLCB2YWxpZGF0ZUdlbmVyYXRpb25IYW5kc2hha2VUaW1lb3V0TXMgfSBmcm9tIFwiLi9nZW5lcmF0aW9uLWhhbmRzaGFrZS10aW1lb3V0LWVycm9yLmpzXCJcblxuY29uc3QgREVGQVVMVF9FTlFVRVVFX1RJTUVPVVRfTVMgPSA1MDAwXG5cbmV4cG9ydCBkZWZhdWx0IGNsYXNzIEJhY2tncm91bmRKb2JzQ2xpZW50IHtcbiAgLyoqXG4gICAqIFJ1bnMgY29uc3RydWN0b3IuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBbYXJnc10gLSBPcHRpb25zLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL2NvbmZpZ3VyYXRpb24uanNcIikuZGVmYXVsdH0gW2FyZ3MuY29uZmlndXJhdGlvbl0gLSBDb25maWd1cmF0aW9uLlxuICAgKiBAcGFyYW0ge251bWJlcn0gW2FyZ3MuZW5xdWV1ZVRpbWVvdXRNc10gLSBNYXhpbXVtIHRpbWUgdG8gd2FpdCBmb3IgYW4gZW5xdWV1ZSBhY2tub3dsZWRnZW1lbnQgaW4gbWlsbGlzZWNvbmRzIChkZWZhdWx0OiA1MDAwKS5cbiAgICogQHBhcmFtIHtudW1iZXJ9IFthcmdzLmdlbmVyYXRpb25IYW5kc2hha2VUaW1lb3V0TXNdIC0gTWF4aW11bSB0aW1lIHRvIHdhaXQgZm9yIGdlbmVyYXRpb24gYWNrbm93bGVkZ2VtZW50IChkZWZhdWx0OiA0MDAwKS5cbiAgICogQHBhcmFtIHtzdHJpbmd9IFthcmdzLmdlbmVyYXRpb25JZF0gLSBFeHBsaWNpdCByZWxlYXNlIGdlbmVyYXRpb24gaWRlbnRpdHkuXG4gICAqL1xuICBjb25zdHJ1Y3Rvcih7Y29uZmlndXJhdGlvbiwgZW5xdWV1ZVRpbWVvdXRNcyA9IERFRkFVTFRfRU5RVUVVRV9USU1FT1VUX01TLCBnZW5lcmF0aW9uSGFuZHNoYWtlVGltZW91dE1zID0gREVGQVVMVF9HRU5FUkFUSU9OX0hBTkRTSEFLRV9USU1FT1VUX01TLCBnZW5lcmF0aW9uSWR9ID0ge30pIHtcbiAgICB0aGlzLmNvbmZpZ3VyYXRpb25Qcm9taXNlID0gY29uZmlndXJhdGlvbiA/IFByb21pc2UucmVzb2x2ZShjb25maWd1cmF0aW9uKSA6IGNvbmZpZ3VyYXRpb25SZXNvbHZlcigpXG4gICAgdGhpcy5lbnF1ZXVlVGltZW91dE1zID0gZW5xdWV1ZVRpbWVvdXRNc1xuICAgIHRoaXMuZ2VuZXJhdGlvbkhhbmRzaGFrZVRpbWVvdXRNcyA9IHZhbGlkYXRlR2VuZXJhdGlvbkhhbmRzaGFrZVRpbWVvdXRNcyhnZW5lcmF0aW9uSGFuZHNoYWtlVGltZW91dE1zKVxuICAgIHRoaXMuZXhwbGljaXRHZW5lcmF0aW9uSWQgPSBnZW5lcmF0aW9uSWRcbiAgfVxuXG4gIC8qKlxuICAgKiBCdWlsZHMgYSBvbmUtc2hvdCBjbGllbnQgc29ja2V0IHJlcXVlc3QgZnJvbSB0aGUgcmVzb2x2ZWQgY29uZmlndXJhdGlvbi5cbiAgICogQHJldHVybnMge1Byb21pc2U8QmFja2dyb3VuZEpvYnNTb2NrZXRSZXF1ZXN0Pn0gLSBTb2NrZXQgcmVxdWVzdC5cbiAgICovXG4gIGFzeW5jIF9yZXF1ZXN0KCkge1xuICAgIGNvbnN0IGNvbmZpZ3VyYXRpb24gPSBhd2FpdCB0aGlzLmNvbmZpZ3VyYXRpb25Qcm9taXNlXG4gICAgY29uc3Qge2hvc3QsIHBvcnR9ID0gY29uZmlndXJhdGlvbi5nZXRCYWNrZ3JvdW5kSm9ic0NvbmZpZygpXG4gICAgY29uc3Qge2dlbmVyYXRpb25JZH0gPSBjb25maWd1cmF0aW9uLnJlc29sdmVCYWNrZ3JvdW5kSm9ic0dlbmVyYXRpb25Db25maWcoe1xuICAgICAgZ2VuZXJhdGlvbklkOiB0aGlzLmV4cGxpY2l0R2VuZXJhdGlvbklkLFxuICAgICAgc291cmNlTmFtZTogXCJCYWNrZ3JvdW5kSm9ic0NsaWVudFwiXG4gICAgfSlcblxuICAgIHJldHVybiBuZXcgQmFja2dyb3VuZEpvYnNTb2NrZXRSZXF1ZXN0KHtob3N0LCBwb3J0LCByb2xlOiBcImNsaWVudFwiLCBnZW5lcmF0aW9uSGFuZHNoYWtlVGltZW91dE1zOiB0aGlzLmdlbmVyYXRpb25IYW5kc2hha2VUaW1lb3V0TXMsIGdlbmVyYXRpb25JZH0pXG4gIH1cblxuICAvKipcbiAgICogUnVucyBlbnF1ZXVlLlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIE9wdGlvbnMuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBhcmdzLmpvYk5hbWUgLSBKb2IgbmFtZS5cbiAgICogQHBhcmFtIHtBcnJheTxSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59IGFyZ3MuYXJncyAtIEpvYiBhcmdzLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vdHlwZXMuanNcIikuQmFja2dyb3VuZEpvYk9wdGlvbnN9IFthcmdzLm9wdGlvbnNdIC0gSm9iIG9wdGlvbnMuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBbYXJncy5wcm9kdWNlckludm9jYXRpb25JZF0gLSBTdGFibGUgaWRlbnRpdHkgZm9yIG9uZSBvd25lZCBlbnF1ZXVlIGludm9jYXRpb24uXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi90eXBlcy5qc1wiKS5CYWNrZ3JvdW5kSm9iUHJvZHVjZXJQcm9vZn0gW2FyZ3MucHJvZHVjZXJQcm9vZl0gLSBFeGFjdCBpbnRlcm5hbCBwcm9kdWNlciBoYW5kb2ZmLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxzdHJpbmc+fSAtIEpvYiBpZC5cbiAgICovXG4gIGFzeW5jIGVucXVldWUoe2pvYk5hbWUsIGFyZ3MsIG9wdGlvbnMsIHByb2R1Y2VySW52b2NhdGlvbklkLCBwcm9kdWNlclByb29mfSkge1xuICAgIGNvbnN0IG1lc3NhZ2UgPSB7XG4gICAgICB0eXBlOiAvKiogQHR5cGUge2NvbnN0fSAqLyAoXCJlbnF1ZXVlXCIpLFxuICAgICAgam9iTmFtZSxcbiAgICAgIGFyZ3MsXG4gICAgICBvcHRpb25zLFxuICAgICAgLi4uKHByb2R1Y2VySW52b2NhdGlvbklkID8ge3Byb2R1Y2VySW52b2NhdGlvbklkfSA6IHt9KSxcbiAgICAgIC4uLihwcm9kdWNlclByb29mID8ge3Byb2R1Y2VyUHJvb2Z9IDoge30pXG4gICAgfVxuICAgIGNvbnN0IGFja25vd2xlZGdlbWVudCA9IHtleHBsaWNpdGx5UmVqZWN0ZWQ6IGZhbHNlLCBnZW5lcmF0aW9uRmVuY2VkOiBmYWxzZSwgcmVxdWVzdFNlbnQ6IGZhbHNlfVxuICAgIC8qKlxuICAgICAqIFNlbmRzIG9uZSBlbnF1ZXVlIGF0dGVtcHQuIEFuIG93bmVkIGNhbGxlciBtYXkgcmVwbGF5IHRoaXMgZXhhY3QgbWVzc2FnZVxuICAgICAqIG9uY2Ugd2hlbiB0cmFuc3BvcnQgYWNrbm93bGVkZ2VtZW50IHJlbWFpbnMgYW1iaWd1b3VzIGFmdGVyIHNlbmQuXG4gICAgICogQHBhcmFtIHt7ZXhwbGljaXRseVJlamVjdGVkOiBib29sZWFuLCBnZW5lcmF0aW9uRmVuY2VkOiBib29sZWFuLCByZXF1ZXN0U2VudDogYm9vbGVhbn0gfCB1bmRlZmluZWR9IGF0dGVtcHRBY2tub3dsZWRnZW1lbnQgLSBGaXJzdC1hdHRlbXB0IG9ic2VydmF0aW9ucy5cbiAgICAgKiBAcmV0dXJucyB7UHJvbWlzZTxzdHJpbmc+fSAtIEpvYiBpZC5cbiAgICAgKi9cbiAgICBjb25zdCBlbnF1ZXVlQXR0ZW1wdCA9IGFzeW5jIChhdHRlbXB0QWNrbm93bGVkZ2VtZW50KSA9PiB7XG4gICAgICBjb25zdCByZXF1ZXN0ID0gYXdhaXQgdGhpcy5fcmVxdWVzdCgpXG5cbiAgICAgIHJldHVybiBhd2FpdCB0aW1lb3V0KHtcbiAgICAgICAgZXJyb3JNZXNzYWdlOiBgQmFja2dyb3VuZCBqb2IgZW5xdWV1ZSBhY2tub3dsZWRnZW1lbnQgdGltZWQgb3V0IGFmdGVyICR7dGhpcy5lbnF1ZXVlVGltZW91dE1zfW1zYCxcbiAgICAgICAgdGltZW91dDogdGhpcy5lbnF1ZXVlVGltZW91dE1zXG4gICAgICB9LCBhc3luYyAoe2NvbnRyb2x9KSA9PiBhd2FpdCByZXF1ZXN0LnJ1bih7XG4gICAgICAgIHNpZ25hbDogY29udHJvbC5zaWduYWwsXG4gICAgICAgIG9uQ29ubmVjdDogKGpzb25Tb2NrZXQpID0+IHtcbiAgICAgICAgICBqc29uU29ja2V0LnNlbmQobWVzc2FnZSlcbiAgICAgICAgICBpZiAoYXR0ZW1wdEFja25vd2xlZGdlbWVudCkge1xuICAgICAgICAgICAgYXR0ZW1wdEFja25vd2xlZGdlbWVudC5nZW5lcmF0aW9uRmVuY2VkID0gQm9vbGVhbihyZXF1ZXN0LmdlbmVyYXRpb25JZClcbiAgICAgICAgICAgIGF0dGVtcHRBY2tub3dsZWRnZW1lbnQucmVxdWVzdFNlbnQgPSB0cnVlXG4gICAgICAgICAgfVxuICAgICAgICB9LFxuICAgICAgICBvbk1lc3NhZ2U6ICh7bWVzc2FnZSwgcmVzb2x2ZSwgcmVqZWN0fSkgPT4ge1xuICAgICAgICAgIGlmIChtZXNzYWdlPy50eXBlID09PSBcImVucXVldWVkXCIpIHtcbiAgICAgICAgICAgIHJlc29sdmUobWVzc2FnZS5qb2JJZClcbiAgICAgICAgICAgIHJldHVyblxuICAgICAgICAgIH1cblxuICAgICAgICAgIGlmIChtZXNzYWdlPy50eXBlID09PSBcImVucXVldWUtZXJyb3JcIikge1xuICAgICAgICAgICAgaWYgKGF0dGVtcHRBY2tub3dsZWRnZW1lbnQpIGF0dGVtcHRBY2tub3dsZWRnZW1lbnQuZXhwbGljaXRseVJlamVjdGVkID0gdHJ1ZVxuICAgICAgICAgICAgcmVqZWN0KG5ldyBFcnJvcihtZXNzYWdlLmVycm9yIHx8IFwiRmFpbGVkIHRvIGVucXVldWUgam9iXCIpKVxuICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgICAgfSkpXG4gICAgfVxuXG4gICAgdHJ5IHtcbiAgICAgIHJldHVybiBhd2FpdCBlbnF1ZXVlQXR0ZW1wdChhY2tub3dsZWRnZW1lbnQpXG4gICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgIGlmICghcHJvZHVjZXJJbnZvY2F0aW9uSWQgfHwgIXByb2R1Y2VyUHJvb2YgfHwgIWFja25vd2xlZGdlbWVudC5nZW5lcmF0aW9uRmVuY2VkIHx8ICFhY2tub3dsZWRnZW1lbnQucmVxdWVzdFNlbnQgfHwgYWNrbm93bGVkZ2VtZW50LmV4cGxpY2l0bHlSZWplY3RlZCkgdGhyb3cgZXJyb3JcbiAgICB9XG5cbiAgICByZXR1cm4gYXdhaXQgZW5xdWV1ZUF0dGVtcHQodW5kZWZpbmVkKVxuICB9XG5cbiAgLyoqXG4gICAqIEF0b21pY2FsbHkgcmVwbGFjZXMgdGhlIHF1ZXVlZCBvd25lciBvZiBhIHN0YWJsZSBzY2hlZHVsZSBrZXkuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gT3B0aW9ucy5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGFyZ3Muc2NoZWR1bGVLZXkgLSBTdGFibGUgbG9naWNhbCBzY2hlZHVsZSBrZXkuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBhcmdzLmpvYk5hbWUgLSBKb2IgbmFtZS5cbiAgICogQHBhcmFtIHtBcnJheTxSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59IGFyZ3MuYXJncyAtIEpvYiBhcmdzLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vdHlwZXMuanNcIikuQmFja2dyb3VuZEpvYk9wdGlvbnN9IFthcmdzLm9wdGlvbnNdIC0gSm9iIG9wdGlvbnMuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPGltcG9ydChcIi4vdHlwZXMuanNcIikuQmFja2dyb3VuZEpvYlJlcGxhY2VtZW50UmVzdWx0Pn0gLSBSZXBsYWNlbWVudCByZXN1bHQuXG4gICAqL1xuICBhc3luYyByZXBsYWNlU2NoZWR1bGVkKHtzY2hlZHVsZUtleSwgam9iTmFtZSwgYXJncywgb3B0aW9uc30pIHtcbiAgICBjb25zdCByZXF1ZXN0ID0gYXdhaXQgdGhpcy5fcmVxdWVzdCgpXG5cbiAgICByZXR1cm4gYXdhaXQgcmVxdWVzdC5ydW4oe1xuICAgICAgb25Db25uZWN0OiAoanNvblNvY2tldCkgPT4ge1xuICAgICAgICBqc29uU29ja2V0LnNlbmQoe3R5cGU6IFwicmVwbGFjZS1zY2hlZHVsZWRcIiwgc2NoZWR1bGVLZXksIGpvYk5hbWUsIGFyZ3MsIG9wdGlvbnN9KVxuICAgICAgfSxcbiAgICAgIG9uTWVzc2FnZTogKHttZXNzYWdlLCByZXNvbHZlLCByZWplY3R9KSA9PiB7XG4gICAgICAgIGlmIChtZXNzYWdlPy50eXBlID09PSBcInNjaGVkdWxlLXJlcGxhY2VkXCIpIHtcbiAgICAgICAgICByZXNvbHZlKHtcbiAgICAgICAgICAgIGpvYklkOiBtZXNzYWdlLmpvYklkLFxuICAgICAgICAgICAgcHJldmlvdXNKb2JJZDogbWVzc2FnZS5wcmV2aW91c0pvYklkLFxuICAgICAgICAgICAgcHJldmlvdXNTdGF0dXM6IG1lc3NhZ2UucHJldmlvdXNTdGF0dXNcbiAgICAgICAgICB9KVxuICAgICAgICAgIHJldHVyblxuICAgICAgICB9XG5cbiAgICAgICAgaWYgKG1lc3NhZ2U/LnR5cGUgPT09IFwicmVwbGFjZS1zY2hlZHVsZWQtZXJyb3JcIikge1xuICAgICAgICAgIHJlamVjdChuZXcgRXJyb3IobWVzc2FnZS5lcnJvciB8fCBcIkZhaWxlZCB0byByZXBsYWNlIHNjaGVkdWxlZCBqb2JcIikpXG4gICAgICAgIH1cbiAgICAgIH1cbiAgICB9KVxuICB9XG5cbiAgLyoqXG4gICAqIENhbmNlbHMgb3IgZGV0YWNoZXMgdGhlIGN1cnJlbnQgb3duZXIgb2YgYSBzdGFibGUgc2NoZWR1bGUga2V5LlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIE9wdGlvbnMuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBhcmdzLnNjaGVkdWxlS2V5IC0gU3RhYmxlIGxvZ2ljYWwgc2NoZWR1bGUga2V5LlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxpbXBvcnQoXCIuL3R5cGVzLmpzXCIpLkJhY2tncm91bmRKb2JDYW5jZWxsYXRpb25SZXN1bHQ+fSAtIENhbmNlbGxhdGlvbiByZXN1bHQuXG4gICAqL1xuICBhc3luYyBjYW5jZWxTY2hlZHVsZWQoe3NjaGVkdWxlS2V5fSkge1xuICAgIGNvbnN0IHJlcXVlc3QgPSBhd2FpdCB0aGlzLl9yZXF1ZXN0KClcblxuICAgIHJldHVybiBhd2FpdCByZXF1ZXN0LnJ1bih7XG4gICAgICBvbkNvbm5lY3Q6IChqc29uU29ja2V0KSA9PiB7XG4gICAgICAgIGpzb25Tb2NrZXQuc2VuZCh7dHlwZTogXCJjYW5jZWwtc2NoZWR1bGVkXCIsIHNjaGVkdWxlS2V5fSlcbiAgICAgIH0sXG4gICAgICBvbk1lc3NhZ2U6ICh7bWVzc2FnZSwgcmVzb2x2ZSwgcmVqZWN0fSkgPT4ge1xuICAgICAgICBpZiAobWVzc2FnZT8udHlwZSA9PT0gXCJzY2hlZHVsZS1jYW5jZWxsZWRcIikge1xuICAgICAgICAgIHJlc29sdmUoe2pvYklkOiBtZXNzYWdlLmpvYklkLCBvdXRjb21lOiBtZXNzYWdlLm91dGNvbWV9KVxuICAgICAgICAgIHJldHVyblxuICAgICAgICB9XG5cbiAgICAgICAgaWYgKG1lc3NhZ2U/LnR5cGUgPT09IFwiY2FuY2VsLXNjaGVkdWxlZC1lcnJvclwiKSB7XG4gICAgICAgICAgcmVqZWN0KG5ldyBFcnJvcihtZXNzYWdlLmVycm9yIHx8IFwiRmFpbGVkIHRvIGNhbmNlbCBzY2hlZHVsZWQgam9iXCIpKVxuICAgICAgICB9XG4gICAgICB9XG4gICAgfSlcbiAgfVxufVxuIl19