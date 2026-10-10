// @ts-check
import { randomUUID } from "node:crypto";
import net from "node:net";
import timeout from "awaitery/build/timeout.js";
import JsonSocket from "./json-socket.js";
const DEFAULT_REQUEST_TIMEOUT_MS = 10000;
export const MAX_LIFECYCLE_REQUEST_TIMEOUT_MS = 120000;
const LIFECYCLE_CONNECT_RETRY_DELAY_MS = 50;
const TRANSIENT_CONNECT_ERROR_CODES = new Set(["ECONNABORTED", "ECONNREFUSED", "ENOENT"]);
/**
 * Whether a lifecycle request failure is a transient "endpoint not ready yet"
 * connect failure (the coordinator's control socket opens asynchronously after
 * its process starts) rather than a definitive protocol or state rejection.
 * @param {unknown} error - The rejection reason.
 * @returns {boolean} - Whether the request may be retried.
 */
function isTransientConnectError(error) {
    if (typeof error !== "object" || error === null)
        return false;
    const code = /** @type {{code?: unknown}} */ (error).code;
    return typeof code === "string" && TRANSIENT_CONNECT_ERROR_CODES.has(code);
}
/**
 * Waits before the next lifecycle connect retry, rejecting with the signal
 * reason when the caller-owned deadline fires mid-wait.
 * @param {number} delayMs - Wait between attempts.
 * @param {AbortSignal} signal - Caller-owned deadline signal.
 * @returns {Promise<void>} - Resolves after the delay, or rejects on abort.
 */
async function waitBeforeNextAttempt(delayMs, signal) {
    await new Promise((resolve, reject) => {
        if (signal.aborted) {
            reject(signal.reason);
            return;
        }
        const timer = setTimeout(() => {
            signal.removeEventListener("abort", onAbort);
            resolve(undefined);
        }, delayMs);
        const onAbort = () => {
            clearTimeout(timer);
            reject(signal.reason);
        };
        signal.addEventListener("abort", onAbort);
    });
}
/** One-request acknowledged lifecycle client. */
export default class BackgroundJobsLifecycleClient {
    /**
     * Creates a lifecycle client.
     * @param {object} args - Client options.
     * @param {import("../configuration.js").default} args.configuration - Configuration.
     * @param {string} [args.generationId] - Explicit generation identity.
     * @param {string} [args.socketPath] - Explicit control socket path.
     * @param {number} [args.requestTimeoutMs] - Request deadline below the supervisor hook timeout (default: 10000).
     */
    constructor({ configuration, generationId, socketPath, requestTimeoutMs = DEFAULT_REQUEST_TIMEOUT_MS }) {
        const generationConfig = configuration.resolveBackgroundJobsGenerationConfig({
            generationId,
            lifecycleSocketPath: socketPath,
            sourceName: "BackgroundJobsLifecycleClient"
        });
        this.generationId = generationConfig.generationId;
        this.socketPath = generationConfig.lifecycleSocketPath;
        if (!Number.isInteger(requestTimeoutMs) || requestTimeoutMs < 1 || requestTimeoutMs > MAX_LIFECYCLE_REQUEST_TIMEOUT_MS) {
            throw new TypeError(`requestTimeoutMs must be an integer between 1 and ${MAX_LIFECYCLE_REQUEST_TIMEOUT_MS}`);
        }
        this.requestTimeoutMs = requestTimeoutMs;
        if (!this.generationId)
            throw new Error("Background jobs lifecycle client requires generationId");
        if (!this.socketPath)
            throw new Error("Background jobs lifecycle client requires lifecycleSocketPath");
    }
    /**
     * Activates the generation.
     * @returns {Promise<import("./types.js").BackgroundJobsGenerationLifecycleState>} - Resulting state.
     */
    async activate() { return await this._request("activate"); }
    /**
     * Retires the generation.
     * @returns {Promise<import("./types.js").BackgroundJobsGenerationLifecycleState>} - Resulting state.
     */
    async retire() { return await this._request("retire"); }
    /**
     * Sends exactly one lifecycle request.
     * @param {"activate" | "retire"} action - Lifecycle action.
     * @returns {Promise<import("./types.js").BackgroundJobsGenerationLifecycleState>} - Resulting state.
     */
    async _request(action) {
        return await timeout({
            errorMessage: `Background jobs ${action} request for ${this.generationId} timed out after ${this.requestTimeoutMs}ms at ${this.socketPath}`,
            timeout: this.requestTimeoutMs
        }, async ({ control }) => await this._runRequest({ action, signal: control.signal }));
    }
    /**
     * Sends the lifecycle request under its caller-owned deadline. Retries
     * transient "endpoint not ready yet" connect failures (the coordinator opens
     * its control socket asynchronously after its process starts) until the
     * deadline; any definitive protocol or state rejection fails immediately.
     * @param {object} args - Request details.
     * @param {"activate" | "retire"} args.action - Lifecycle action.
     * @param {AbortSignal} args.signal - Request deadline signal.
     * @returns {Promise<import("./types.js").BackgroundJobsGenerationLifecycleState>} - Resulting state.
     */
    async _runRequest({ action, signal }) {
        while (true) {
            try {
                return await this._attemptRequest(action, randomUUID(), signal);
            }
            catch (error) {
                if (!isTransientConnectError(error))
                    throw error;
                if (signal.aborted)
                    throw signal.reason;
                await waitBeforeNextAttempt(LIFECYCLE_CONNECT_RETRY_DELAY_MS, signal);
            }
        }
    }
    /**
     * Performs one lifecycle request attempt against the control socket.
     * @param {"activate" | "retire"} action - Lifecycle action.
     * @param {string} requestId - Request identity for acknowledgement matching.
     * @param {AbortSignal} signal - Request deadline signal.
     * @returns {Promise<import("./types.js").BackgroundJobsGenerationLifecycleState>} - Resulting state.
     */
    async _attemptRequest(action, requestId, signal) {
        const socket = net.createConnection(this.socketPath);
        const jsonSocket = new JsonSocket(socket);
        return await new Promise((resolve, reject) => {
            let finished = false;
            /**
             * Settles the request once.
             * @param {object} options - Teardown options.
             * @param {boolean} [options.destroy] - Destroy instead of closing.
             * @param {() => void} callback - Settlement callback.
             */
            const finish = ({ destroy = false }, callback) => {
                if (finished)
                    return;
                finished = true;
                signal.removeEventListener("abort", onAbort);
                socket.removeListener("connect", onConnect);
                jsonSocket.removeAllListeners();
                if (destroy)
                    jsonSocket.destroy();
                else
                    jsonSocket.close();
                callback();
            };
            const onAbort = () => finish({ destroy: true }, () => reject(signal.reason instanceof Error ? signal.reason : new Error("Background jobs lifecycle request aborted")));
            const onConnect = () => {
                jsonSocket.send({
                    type: "background-jobs-lifecycle",
                    action,
                    generationId: this.generationId,
                    requestId
                });
            };
            signal.addEventListener("abort", onAbort);
            jsonSocket.on("error", (error) => finish({}, () => reject(error)));
            jsonSocket.on("close", () => finish({ destroy: true }, () => reject(new Error("Background jobs lifecycle socket closed before acknowledgement"))));
            jsonSocket.on("message", (message) => {
                if (message?.requestId !== requestId || message.action !== action) {
                    finish({}, () => reject(new Error("Background jobs lifecycle response did not match its request")));
                    return;
                }
                if (message.type === "background-jobs-lifecycle-error") {
                    const error = new Error(message.error?.message || "Background jobs lifecycle request failed");
                    if (typeof message.error?.name === "string")
                        error.name = message.error.name;
                    if (typeof message.error?.stack === "string")
                        error.stack = message.error.stack;
                    finish({}, () => reject(error));
                    return;
                }
                if (message.type !== "background-jobs-lifecycle-ack" || message.generationId !== this.generationId) {
                    finish({}, () => reject(new Error("Invalid background jobs lifecycle acknowledgement")));
                    return;
                }
                finish({}, () => resolve(message.lifecycleState));
            });
            socket.once("connect", onConnect);
            if (signal.aborted)
                onAbort();
        });
    }
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoibGlmZWN5Y2xlLWNsaWVudC5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uLy4uLy4uL3NyYy9iYWNrZ3JvdW5kLWpvYnMvbGlmZWN5Y2xlLWNsaWVudC5qcyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiQUFBQSxZQUFZO0FBRVosT0FBTyxFQUFFLFVBQVUsRUFBRSxNQUFNLGFBQWEsQ0FBQTtBQUN4QyxPQUFPLEdBQUcsTUFBTSxVQUFVLENBQUE7QUFDMUIsT0FBTyxPQUFPLE1BQU0sMkJBQTJCLENBQUE7QUFDL0MsT0FBTyxVQUFVLE1BQU0sa0JBQWtCLENBQUE7QUFFekMsTUFBTSwwQkFBMEIsR0FBRyxLQUFLLENBQUE7QUFDeEMsTUFBTSxDQUFDLE1BQU0sZ0NBQWdDLEdBQUcsTUFBTSxDQUFBO0FBQ3RELE1BQU0sZ0NBQWdDLEdBQUcsRUFBRSxDQUFBO0FBQzNDLE1BQU0sNkJBQTZCLEdBQUcsSUFBSSxHQUFHLENBQUMsQ0FBQyxjQUFjLEVBQUUsY0FBYyxFQUFFLFFBQVEsQ0FBQyxDQUFDLENBQUE7QUFFekY7Ozs7OztHQU1HO0FBQ0gsU0FBUyx1QkFBdUIsQ0FBQyxLQUFLO0lBQ3BDLElBQUksT0FBTyxLQUFLLEtBQUssUUFBUSxJQUFJLEtBQUssS0FBSyxJQUFJO1FBQUUsT0FBTyxLQUFLLENBQUE7SUFDN0QsTUFBTSxJQUFJLEdBQUcsK0JBQStCLENBQUMsQ0FBQyxLQUFLLENBQUMsQ0FBQyxJQUFJLENBQUE7SUFFekQsT0FBTyxPQUFPLElBQUksS0FBSyxRQUFRLElBQUksNkJBQTZCLENBQUMsR0FBRyxDQUFDLElBQUksQ0FBQyxDQUFBO0FBQzVFLENBQUM7QUFFRDs7Ozs7O0dBTUc7QUFDSCxLQUFLLFVBQVUscUJBQXFCLENBQUMsT0FBTyxFQUFFLE1BQU07SUFDbEQsTUFBTSxJQUFJLE9BQU8sQ0FBQyxDQUFDLE9BQU8sRUFBRSxNQUFNLEVBQUUsRUFBRTtRQUNwQyxJQUFJLE1BQU0sQ0FBQyxPQUFPLEVBQUUsQ0FBQztZQUNuQixN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QUFTLEVBQUUsU0FBUyxDQUFDLENBQUE7WUFDakMsSUFBSSxNQUFNLENBQUMsT0FBTztnQkFBRSxPQUFPLEVBQUUsQ0FBQTtRQUMvQixDQUFDLENBQUMsQ0FBQTtJQUNKLENBQUM7Q0FDRiIsInNvdXJjZXNDb250ZW50IjpbIi8vIEB0cy1jaGVja1xuXG5pbXBvcnQgeyByYW5kb21VVUlEIH0gZnJvbSBcIm5vZGU6Y3J5cHRvXCJcbmltcG9ydCBuZXQgZnJvbSBcIm5vZGU6bmV0XCJcbmltcG9ydCB0aW1lb3V0IGZyb20gXCJhd2FpdGVyeS9idWlsZC90aW1lb3V0LmpzXCJcbmltcG9ydCBKc29uU29ja2V0IGZyb20gXCIuL2pzb24tc29ja2V0LmpzXCJcblxuY29uc3QgREVGQVVMVF9SRVFVRVNUX1RJTUVPVVRfTVMgPSAxMDAwMFxuZXhwb3J0IGNvbnN0IE1BWF9MSUZFQ1lDTEVfUkVRVUVTVF9USU1FT1VUX01TID0gMTIwMDAwXG5jb25zdCBMSUZFQ1lDTEVfQ09OTkVDVF9SRVRSWV9ERUxBWV9NUyA9IDUwXG5jb25zdCBUUkFOU0lFTlRfQ09OTkVDVF9FUlJPUl9DT0RFUyA9IG5ldyBTZXQoW1wiRUNPTk5BQk9SVEVEXCIsIFwiRUNPTk5SRUZVU0VEXCIsIFwiRU5PRU5UXCJdKVxuXG4vKipcbiAqIFdoZXRoZXIgYSBsaWZlY3ljbGUgcmVxdWVzdCBmYWlsdXJlIGlzIGEgdHJhbnNpZW50IFwiZW5kcG9pbnQgbm90IHJlYWR5IHlldFwiXG4gKiBjb25uZWN0IGZhaWx1cmUgKHRoZSBjb29yZGluYXRvcidzIGNvbnRyb2wgc29ja2V0IG9wZW5zIGFzeW5jaHJvbm91c2x5IGFmdGVyXG4gKiBpdHMgcHJvY2VzcyBzdGFydHMpIHJhdGhlciB0aGFuIGEgZGVmaW5pdGl2ZSBwcm90b2NvbCBvciBzdGF0ZSByZWplY3Rpb24uXG4gKiBAcGFyYW0ge3Vua25vd259IGVycm9yIC0gVGhlIHJlamVjdGlvbiByZWFzb24uXG4gKiBAcmV0dXJucyB7Ym9vbGVhbn0gLSBXaGV0aGVyIHRoZSByZXF1ZXN0IG1heSBiZSByZXRyaWVkLlxuICovXG5mdW5jdGlvbiBpc1RyYW5zaWVudENvbm5lY3RFcnJvcihlcnJvcikge1xuICBpZiAodHlwZW9mIGVycm9yICE9PSBcIm9iamVjdFwiIHx8IGVycm9yID09PSBudWxsKSByZXR1cm4gZmFsc2VcbiAgY29uc3QgY29kZSA9IC8qKiBAdHlwZSB7e2NvZGU/OiB1bmtub3dufX0gKi8gKGVycm9yKS5jb2RlXG5cbiAgcmV0dXJuIHR5cGVvZiBjb2RlID09PSBcInN0cmluZ1wiICYmIFRSQU5TSUVOVF9DT05ORUNUX0VSUk9SX0NPREVTLmhhcyhjb2RlKVxufVxuXG4vKipcbiAqIFdhaXRzIGJlZm9yZSB0aGUgbmV4dCBsaWZlY3ljbGUgY29ubmVjdCByZXRyeSwgcmVqZWN0aW5nIHdpdGggdGhlIHNpZ25hbFxuICogcmVhc29uIHdoZW4gdGhlIGNhbGxlci1vd25lZCBkZWFkbGluZSBmaXJlcyBtaWQtd2FpdC5cbiAqIEBwYXJhbSB7bnVtYmVyfSBkZWxheU1zIC0gV2FpdCBiZXR3ZWVuIGF0dGVtcHRzLlxuICogQHBhcmFtIHtBYm9ydFNpZ25hbH0gc2lnbmFsIC0gQ2FsbGVyLW93bmVkIGRlYWRsaW5lIHNpZ25hbC5cbiAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIGFmdGVyIHRoZSBkZWxheSwgb3IgcmVqZWN0cyBvbiBhYm9ydC5cbiAqL1xuYXN5bmMgZnVuY3Rpb24gd2FpdEJlZm9yZU5leHRBdHRlbXB0KGRlbGF5TXMsIHNpZ25hbCkge1xuICBhd2FpdCBuZXcgUHJvbWlzZSgocmVzb2x2ZSwgcmVqZWN0KSA9PiB7XG4gICAgaWYgKHNpZ25hbC5hYm9ydGVkKSB7XG4gICAgICByZWplY3Qoc2lnbmFsLnJlYXNvbilcblxuICAgICAgcmV0dXJuXG4gICAgfVxuICAgIGNvbnN0IHRpbWVyID0gc2V0VGltZW91dCgoKSA9PiB7XG4gICAgICBzaWduYWwucmVtb3ZlRXZlbnRMaXN0ZW5lcihcImFib3J0XCIsIG9uQWJvcnQpXG4gICAgICByZXNvbHZlKHVuZGVmaW5lZClcbiAgICB9LCBkZWxheU1zKVxuICAgIGNvbnN0IG9uQWJvcnQgPSAoKSA9PiB7XG4gICAgICBjbGVhclRpbWVvdXQodGltZXIpXG4gICAgICByZWplY3Qoc2lnbmFsLnJlYXNvbilcbiAgICB9XG5cbiAgICBzaWduYWwuYWRkRXZlbnRMaXN0ZW5lcihcImFib3J0XCIsIG9uQWJvcnQpXG4gIH0pXG59XG5cbi8qKiBPbmUtcmVxdWVzdCBhY2tub3dsZWRnZWQgbGlmZWN5Y2xlIGNsaWVudC4gKi9cbmV4cG9ydCBkZWZhdWx0IGNsYXNzIEJhY2tncm91bmRKb2JzTGlmZWN5Y2xlQ2xpZW50IHtcbiAgLyoqXG4gICAqIENyZWF0ZXMgYSBsaWZlY3ljbGUgY2xpZW50LlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIENsaWVudCBvcHRpb25zLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL2NvbmZpZ3VyYXRpb24uanNcIikuZGVmYXVsdH0gYXJncy5jb25maWd1cmF0aW9uIC0gQ29uZmlndXJhdGlvbi5cbiAgICogQHBhcmFtIHtzdHJpbmd9IFthcmdzLmdlbmVyYXRpb25JZF0gLSBFeHBsaWNpdCBnZW5lcmF0aW9uIGlkZW50aXR5LlxuICAgKiBAcGFyYW0ge3N0cmluZ30gW2FyZ3Muc29ja2V0UGF0aF0gLSBFeHBsaWNpdCBjb250cm9sIHNvY2tldCBwYXRoLlxuICAgKiBAcGFyYW0ge251bWJlcn0gW2FyZ3MucmVxdWVzdFRpbWVvdXRNc10gLSBSZXF1ZXN0IGRlYWRsaW5lIGJlbG93IHRoZSBzdXBlcnZpc29yIGhvb2sgdGltZW91dCAoZGVmYXVsdDogMTAwMDApLlxuICAgKi9cbiAgY29uc3RydWN0b3Ioe2NvbmZpZ3VyYXRpb24sIGdlbmVyYXRpb25JZCwgc29ja2V0UGF0aCwgcmVxdWVzdFRpbWVvdXRNcyA9IERFRkFVTFRfUkVRVUVTVF9USU1FT1VUX01TfSkge1xuICAgIGNvbnN0IGdlbmVyYXRpb25Db25maWcgPSBjb25maWd1cmF0aW9uLnJlc29sdmVCYWNrZ3JvdW5kSm9ic0dlbmVyYXRpb25Db25maWcoe1xuICAgICAgZ2VuZXJhdGlvbklkLFxuICAgICAgbGlmZWN5Y2xlU29ja2V0UGF0aDogc29ja2V0UGF0aCxcbiAgICAgIHNvdXJjZU5hbWU6IFwiQmFja2dyb3VuZEpvYnNMaWZlY3ljbGVDbGllbnRcIlxuICAgIH0pXG4gICAgdGhpcy5nZW5lcmF0aW9uSWQgPSBnZW5lcmF0aW9uQ29uZmlnLmdlbmVyYXRpb25JZFxuICAgIHRoaXMuc29ja2V0UGF0aCA9IGdlbmVyYXRpb25Db25maWcubGlmZWN5Y2xlU29ja2V0UGF0aFxuICAgIGlmICghTnVtYmVyLmlzSW50ZWdlcihyZXF1ZXN0VGltZW91dE1zKSB8fCByZXF1ZXN0VGltZW91dE1zIDwgMSB8fCByZXF1ZXN0VGltZW91dE1zID4gTUFYX0xJRkVDWUNMRV9SRVFVRVNUX1RJTUVPVVRfTVMpIHtcbiAgICAgIHRocm93IG5ldyBUeXBlRXJyb3IoYHJlcXVlc3RUaW1lb3V0TXMgbXVzdCBiZSBhbiBpbnRlZ2VyIGJldHdlZW4gMSBhbmQgJHtNQVhfTElGRUNZQ0xFX1JFUVVFU1RfVElNRU9VVF9NU31gKVxuICAgIH1cbiAgICB0aGlzLnJlcXVlc3RUaW1lb3V0TXMgPSByZXF1ZXN0VGltZW91dE1zXG4gICAgaWYgKCF0aGlzLmdlbmVyYXRpb25JZCkgdGhyb3cgbmV3IEVycm9yKFwiQmFja2dyb3VuZCBqb2JzIGxpZmVjeWNsZSBjbGllbnQgcmVxdWlyZXMgZ2VuZXJhdGlvbklkXCIpXG4gICAgaWYgKCF0aGlzLnNvY2tldFBhdGgpIHRocm93IG5ldyBFcnJvcihcIkJhY2tncm91bmQgam9icyBsaWZlY3ljbGUgY2xpZW50IHJlcXVpcmVzIGxpZmVjeWNsZVNvY2tldFBhdGhcIilcbiAgfVxuXG4gIC8qKlxuICAgKiBBY3RpdmF0ZXMgdGhlIGdlbmVyYXRpb24uXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPGltcG9ydChcIi4vdHlwZXMuanNcIikuQmFja2dyb3VuZEpvYnNHZW5lcmF0aW9uTGlmZWN5Y2xlU3RhdGU+fSAtIFJlc3VsdGluZyBzdGF0ZS5cbiAgICovXG4gIGFzeW5jIGFjdGl2YXRlKCkgeyByZXR1cm4gYXdhaXQgdGhpcy5fcmVxdWVzdChcImFjdGl2YXRlXCIpIH1cblxuICAvKipcbiAgICogUmV0aXJlcyB0aGUgZ2VuZXJhdGlvbi5cbiAgICogQHJldHVybnMge1Byb21pc2U8aW1wb3J0KFwiLi90eXBlcy5qc1wiKS5CYWNrZ3JvdW5kSm9ic0dlbmVyYXRpb25MaWZlY3ljbGVTdGF0ZT59IC0gUmVzdWx0aW5nIHN0YXRlLlxuICAgKi9cbiAgYXN5bmMgcmV0aXJlKCkgeyByZXR1cm4gYXdhaXQgdGhpcy5fcmVxdWVzdChcInJldGlyZVwiKSB9XG5cbiAgLyoqXG4gICAqIFNlbmRzIGV4YWN0bHkgb25lIGxpZmVjeWNsZSByZXF1ZXN0LlxuICAgKiBAcGFyYW0ge1wiYWN0aXZhdGVcIiB8IFwicmV0aXJlXCJ9IGFjdGlvbiAtIExpZmVjeWNsZSBhY3Rpb24uXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPGltcG9ydChcIi4vdHlwZXMuanNcIikuQmFja2dyb3VuZEpvYnNHZW5lcmF0aW9uTGlmZWN5Y2xlU3RhdGU+fSAtIFJlc3VsdGluZyBzdGF0ZS5cbiAgICovXG4gIGFzeW5jIF9yZXF1ZXN0KGFjdGlvbikge1xuICAgIHJldHVybiBhd2FpdCB0aW1lb3V0KHtcbiAgICAgIGVycm9yTWVzc2FnZTogYEJhY2tncm91bmQgam9icyAke2FjdGlvbn0gcmVxdWVzdCBmb3IgJHt0aGlzLmdlbmVyYXRpb25JZH0gdGltZWQgb3V0IGFmdGVyICR7dGhpcy5yZXF1ZXN0VGltZW91dE1zfW1zIGF0ICR7dGhpcy5zb2NrZXRQYXRofWAsXG4gICAgICB0aW1lb3V0OiB0aGlzLnJlcXVlc3RUaW1lb3V0TXNcbiAgICB9LCBhc3luYyAoe2NvbnRyb2x9KSA9PiBhd2FpdCB0aGlzLl9ydW5SZXF1ZXN0KHthY3Rpb24sIHNpZ25hbDogY29udHJvbC5zaWduYWx9KSlcbiAgfVxuXG4gIC8qKlxuICAgKiBTZW5kcyB0aGUgbGlmZWN5Y2xlIHJlcXVlc3QgdW5kZXIgaXRzIGNhbGxlci1vd25lZCBkZWFkbGluZS4gUmV0cmllc1xuICAgKiB0cmFuc2llbnQgXCJlbmRwb2ludCBub3QgcmVhZHkgeWV0XCIgY29ubmVjdCBmYWlsdXJlcyAodGhlIGNvb3JkaW5hdG9yIG9wZW5zXG4gICAqIGl0cyBjb250cm9sIHNvY2tldCBhc3luY2hyb25vdXNseSBhZnRlciBpdHMgcHJvY2VzcyBzdGFydHMpIHVudGlsIHRoZVxuICAgKiBkZWFkbGluZTsgYW55IGRlZmluaXRpdmUgcHJvdG9jb2wgb3Igc3RhdGUgcmVqZWN0aW9uIGZhaWxzIGltbWVkaWF0ZWx5LlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIFJlcXVlc3QgZGV0YWlscy5cbiAgICogQHBhcmFtIHtcImFjdGl2YXRlXCIgfCBcInJldGlyZVwifSBhcmdzLmFjdGlvbiAtIExpZmVjeWNsZSBhY3Rpb24uXG4gICAqIEBwYXJhbSB7QWJvcnRTaWduYWx9IGFyZ3Muc2lnbmFsIC0gUmVxdWVzdCBkZWFkbGluZSBzaWduYWwuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPGltcG9ydChcIi4vdHlwZXMuanNcIikuQmFja2dyb3VuZEpvYnNHZW5lcmF0aW9uTGlmZWN5Y2xlU3RhdGU+fSAtIFJlc3VsdGluZyBzdGF0ZS5cbiAgICovXG4gIGFzeW5jIF9ydW5SZXF1ZXN0KHthY3Rpb24sIHNpZ25hbH0pIHtcbiAgICB3aGlsZSAodHJ1ZSkge1xuICAgICAgdHJ5IHtcbiAgICAgICAgcmV0dXJuIGF3YWl0IHRoaXMuX2F0dGVtcHRSZXF1ZXN0KGFjdGlvbiwgcmFuZG9tVVVJRCgpLCBzaWduYWwpXG4gICAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgICBpZiAoIWlzVHJhbnNpZW50Q29ubmVjdEVycm9yKGVycm9yKSkgdGhyb3cgZXJyb3JcbiAgICAgICAgaWYgKHNpZ25hbC5hYm9ydGVkKSB0aHJvdyBzaWduYWwucmVhc29uXG4gICAgICAgIGF3YWl0IHdhaXRCZWZvcmVOZXh0QXR0ZW1wdChMSUZFQ1lDTEVfQ09OTkVDVF9SRVRSWV9ERUxBWV9NUywgc2lnbmFsKVxuICAgICAgfVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBQZXJmb3JtcyBvbmUgbGlmZWN5Y2xlIHJlcXVlc3QgYXR0ZW1wdCBhZ2FpbnN0IHRoZSBjb250cm9sIHNvY2tldC5cbiAgICogQHBhcmFtIHtcImFjdGl2YXRlXCIgfCBcInJldGlyZVwifSBhY3Rpb24gLSBMaWZlY3ljbGUgYWN0aW9uLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gcmVxdWVzdElkIC0gUmVxdWVzdCBpZGVudGl0eSBmb3IgYWNrbm93bGVkZ2VtZW50IG1hdGNoaW5nLlxuICAgKiBAcGFyYW0ge0Fib3J0U2lnbmFsfSBzaWduYWwgLSBSZXF1ZXN0IGRlYWRsaW5lIHNpZ25hbC5cbiAgICogQHJldHVybnMge1Byb21pc2U8aW1wb3J0KFwiLi90eXBlcy5qc1wiKS5CYWNrZ3JvdW5kSm9ic0dlbmVyYXRpb25MaWZlY3ljbGVTdGF0ZT59IC0gUmVzdWx0aW5nIHN0YXRlLlxuICAgKi9cbiAgYXN5bmMgX2F0dGVtcHRSZXF1ZXN0KGFjdGlvbiwgcmVxdWVzdElkLCBzaWduYWwpIHtcbiAgICBjb25zdCBzb2NrZXQgPSBuZXQuY3JlYXRlQ29ubmVjdGlvbih0aGlzLnNvY2tldFBhdGgpXG4gICAgY29uc3QganNvblNvY2tldCA9IG5ldyBKc29uU29ja2V0KHNvY2tldClcblxuICAgIHJldHVybiBhd2FpdCBuZXcgUHJvbWlzZSgocmVzb2x2ZSwgcmVqZWN0KSA9PiB7XG4gICAgICBsZXQgZmluaXNoZWQgPSBmYWxzZVxuICAgICAgLyoqXG4gICAgICAgKiBTZXR0bGVzIHRoZSByZXF1ZXN0IG9uY2UuXG4gICAgICAgKiBAcGFyYW0ge29iamVjdH0gb3B0aW9ucyAtIFRlYXJkb3duIG9wdGlvbnMuXG4gICAgICAgKiBAcGFyYW0ge2Jvb2xlYW59IFtvcHRpb25zLmRlc3Ryb3ldIC0gRGVzdHJveSBpbnN0ZWFkIG9mIGNsb3NpbmcuXG4gICAgICAgKiBAcGFyYW0geygpID0+IHZvaWR9IGNhbGxiYWNrIC0gU2V0dGxlbWVudCBjYWxsYmFjay5cbiAgICAgICAqL1xuICAgICAgY29uc3QgZmluaXNoID0gKHtkZXN0cm95ID0gZmFsc2V9LCBjYWxsYmFjaykgPT4ge1xuICAgICAgICBpZiAoZmluaXNoZWQpIHJldHVyblxuICAgICAgICBmaW5pc2hlZCA9IHRydWVcbiAgICAgICAgc2lnbmFsLnJlbW92ZUV2ZW50TGlzdGVuZXIoXCJhYm9ydFwiLCBvbkFib3J0KVxuICAgICAgICBzb2NrZXQucmVtb3ZlTGlzdGVuZXIoXCJjb25uZWN0XCIsIG9uQ29ubmVjdClcbiAgICAgICAganNvblNvY2tldC5yZW1vdmVBbGxMaXN0ZW5lcnMoKVxuICAgICAgICBpZiAoZGVzdHJveSkganNvblNvY2tldC5kZXN0cm95KClcbiAgICAgICAgZWxzZSBqc29uU29ja2V0LmNsb3NlKClcbiAgICAgICAgY2FsbGJhY2soKVxuICAgICAgfVxuXG4gICAgICBjb25zdCBvbkFib3J0ID0gKCkgPT4gZmluaXNoKHtkZXN0cm95OiB0cnVlfSwgKCkgPT4gcmVqZWN0KHNpZ25hbC5yZWFzb24gaW5zdGFuY2VvZiBFcnJvciA/IHNpZ25hbC5yZWFzb24gOiBuZXcgRXJyb3IoXCJCYWNrZ3JvdW5kIGpvYnMgbGlmZWN5Y2xlIHJlcXVlc3QgYWJvcnRlZFwiKSkpXG4gICAgICBjb25zdCBvbkNvbm5lY3QgPSAoKSA9PiB7XG4gICAgICAgIGpzb25Tb2NrZXQuc2VuZCh7XG4gICAgICAgICAgdHlwZTogXCJiYWNrZ3JvdW5kLWpvYnMtbGlmZWN5Y2xlXCIsXG4gICAgICAgICAgYWN0aW9uLFxuICAgICAgICAgIGdlbmVyYXRpb25JZDogdGhpcy5nZW5lcmF0aW9uSWQsXG4gICAgICAgICAgcmVxdWVzdElkXG4gICAgICAgIH0pXG4gICAgICB9XG5cbiAgICAgIHNpZ25hbC5hZGRFdmVudExpc3RlbmVyKFwiYWJvcnRcIiwgb25BYm9ydClcbiAgICAgIGpzb25Tb2NrZXQub24oXCJlcnJvclwiLCAoZXJyb3IpID0+IGZpbmlzaCh7fSwgKCkgPT4gcmVqZWN0KGVycm9yKSkpXG4gICAgICBqc29uU29ja2V0Lm9uKFwiY2xvc2VcIiwgKCkgPT4gZmluaXNoKHtkZXN0cm95OiB0cnVlfSwgKCkgPT4gcmVqZWN0KG5ldyBFcnJvcihcIkJhY2tncm91bmQgam9icyBsaWZlY3ljbGUgc29ja2V0IGNsb3NlZCBiZWZvcmUgYWNrbm93bGVkZ2VtZW50XCIpKSkpXG4gICAgICBqc29uU29ja2V0Lm9uKFwibWVzc2FnZVwiLCAobWVzc2FnZSkgPT4ge1xuICAgICAgICBpZiAobWVzc2FnZT8ucmVxdWVzdElkICE9PSByZXF1ZXN0SWQgfHwgbWVzc2FnZS5hY3Rpb24gIT09IGFjdGlvbikge1xuICAgICAgICAgIGZpbmlzaCh7fSwgKCkgPT4gcmVqZWN0KG5ldyBFcnJvcihcIkJhY2tncm91bmQgam9icyBsaWZlY3ljbGUgcmVzcG9uc2UgZGlkIG5vdCBtYXRjaCBpdHMgcmVxdWVzdFwiKSkpXG4gICAgICAgICAgcmV0dXJuXG4gICAgICAgIH1cbiAgICAgICAgaWYgKG1lc3NhZ2UudHlwZSA9PT0gXCJiYWNrZ3JvdW5kLWpvYnMtbGlmZWN5Y2xlLWVycm9yXCIpIHtcbiAgICAgICAgICBjb25zdCBlcnJvciA9IG5ldyBFcnJvcihtZXNzYWdlLmVycm9yPy5tZXNzYWdlIHx8IFwiQmFja2dyb3VuZCBqb2JzIGxpZmVjeWNsZSByZXF1ZXN0IGZhaWxlZFwiKVxuICAgICAgICAgIGlmICh0eXBlb2YgbWVzc2FnZS5lcnJvcj8ubmFtZSA9PT0gXCJzdHJpbmdcIikgZXJyb3IubmFtZSA9IG1lc3NhZ2UuZXJyb3IubmFtZVxuICAgICAgICAgIGlmICh0eXBlb2YgbWVzc2FnZS5lcnJvcj8uc3RhY2sgPT09IFwic3RyaW5nXCIpIGVycm9yLnN0YWNrID0gbWVzc2FnZS5lcnJvci5zdGFja1xuICAgICAgICAgIGZpbmlzaCh7fSwgKCkgPT4gcmVqZWN0KGVycm9yKSlcbiAgICAgICAgICByZXR1cm5cbiAgICAgICAgfVxuICAgICAgICBpZiAobWVzc2FnZS50eXBlICE9PSBcImJhY2tncm91bmQtam9icy1saWZlY3ljbGUtYWNrXCIgfHwgbWVzc2FnZS5nZW5lcmF0aW9uSWQgIT09IHRoaXMuZ2VuZXJhdGlvbklkKSB7XG4gICAgICAgICAgZmluaXNoKHt9LCAoKSA9PiByZWplY3QobmV3IEVycm9yKFwiSW52YWxpZCBiYWNrZ3JvdW5kIGpvYnMgbGlmZWN5Y2xlIGFja25vd2xlZGdlbWVudFwiKSkpXG4gICAgICAgICAgcmV0dXJuXG4gICAgICAgIH1cbiAgICAgICAgZmluaXNoKHt9LCAoKSA9PiByZXNvbHZlKG1lc3NhZ2UubGlmZWN5Y2xlU3RhdGUpKVxuICAgICAgfSlcbiAgICAgIHNvY2tldC5vbmNlKFwiY29ubmVjdFwiLCBvbkNvbm5lY3QpXG4gICAgICBpZiAoc2lnbmFsLmFib3J0ZWQpIG9uQWJvcnQoKVxuICAgIH0pXG4gIH1cbn1cbiJdfQ==