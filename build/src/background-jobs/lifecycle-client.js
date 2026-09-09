// @ts-check
import { randomUUID } from "node:crypto";
import net from "node:net";
import timeout from "awaitery/build/timeout.js";
import JsonSocket from "./json-socket.js";
const DEFAULT_REQUEST_TIMEOUT_MS = 10000;
export const MAX_LIFECYCLE_REQUEST_TIMEOUT_MS = 120000;
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
     * Sends the lifecycle request under its caller-owned deadline.
     * @param {object} args - Request details.
     * @param {"activate" | "retire"} args.action - Lifecycle action.
     * @param {AbortSignal} args.signal - Request deadline signal.
     * @returns {Promise<import("./types.js").BackgroundJobsGenerationLifecycleState>} - Resulting state.
     */
    async _runRequest({ action, signal }) {
        const requestId = randomUUID();
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoibGlmZWN5Y2xlLWNsaWVudC5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uLy4uLy4uL3NyYy9iYWNrZ3JvdW5kLWpvYnMvbGlmZWN5Y2xlLWNsaWVudC5qcyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiQUFBQSxZQUFZO0FBRVosT0FBTyxFQUFFLFVBQVUsRUFBRSxNQUFNLGFBQWEsQ0FBQTtBQUN4QyxPQUFPLEdBQUcsTUFBTSxVQUFVLENBQUE7QUFDMUIsT0FBTyxPQUFPLE1BQU0sMkJBQTJCLENBQUE7QUFDL0MsT0FBTyxVQUFVLE1BQU0sa0JBQWtCLENBQUE7QUFFekMsTUFBTSwwQkFBMEIsR0FBRyxLQUFLLENBQUE7QUFDeEMsTUFBTSxDQUFDLE1BQU0sZ0NBQWdDLEdBQUcsTUFBTSxDQUFBO0FBRXRELGlEQUFpRDtBQUNqRCxNQUFNLENBQUMsT0FBTyxPQUFPLDZCQUE2QjtJQUNoRDs7Ozs7OztPQU9HO0lBQ0gsWUFBWSxFQUFDLGFBQWEsRUFBRSxZQUFZLEVBQUUsVUFBVSxFQUFFLGdCQUFnQixHQUFHLDBCQUEwQixFQUFDO1FBQ2xHLE1BQU0sZ0JBQWdCLEdBQUcsYUFBYSxDQUFDLHFDQUFxQyxDQUFDO1lBQzNFLFlBQVk7WUFDWixtQkFBbUIsRUFBRSxVQUFVO1lBQy9CLFVBQVUsRUFBRSwrQkFBK0I7U0FDNUMsQ0FBQyxDQUFBO1FBQ0YsSUFBSSxDQUFDLFlBQVksR0FBRyxnQkFBZ0IsQ0FBQyxZQUFZLENBQUE7UUFDakQsSUFBSSxDQUFDLFVBQVUsR0FBRyxnQkFBZ0IsQ0FBQyxtQkFBbUIsQ0FBQTtRQUN0RCxJQUFJLENBQUMsTUFBTSxDQUFDLFNBQVMsQ0FBQyxnQkFBZ0IsQ0FBQyxJQUFJLGdCQUFnQixHQUFHLENBQUMsSUFBSSxnQkFBZ0IsR0FBRyxnQ0FBZ0MsRUFBRSxDQUFDO1lBQ3ZILE1BQU0sSUFBSSxTQUFTLENBQUMscURBQXFELGdDQUFnQyxFQUFFLENBQUMsQ0FBQTtRQUM5RyxDQUFDO1FBQ0QsSUFBSSxDQUFDLGdC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Q0FBQyxLQUFLLEdBQUcsT0FBTyxDQUFDLEtBQUssQ0FBQyxLQUFLLENBQUE7b0JBQy9FLE1BQU0sQ0FBQyxFQUFFLEVBQUUsR0FBRyxFQUFFLENBQUMsTUFBTSxDQUFDLEtBQUssQ0FBQyxDQUFDLENBQUE7b0JBQy9CLE9BQU07Z0JBQ1IsQ0FBQztnQkFDRCxJQUFJLE9BQU8sQ0FBQyxJQUFJLEtBQUssK0JBQStCLElBQUksT0FBTyxDQUFDLFlBQVksS0FBSyxJQUFJLENBQUMsWUFBWSxFQUFFLENBQUM7b0JBQ25HLE1BQU0sQ0FBQyxFQUFFLEVBQUUsR0FBRyxFQUFFLENBQUMsTUFBTSxDQUFDLElBQUksS0FBSyxDQUFDLG1EQUFtRCxDQUFDLENBQUMsQ0FBQyxDQUFBO29CQUN4RixPQUFNO2dCQUNSLENBQUM7Z0JBQ0QsTUFBTSxDQUFDLEVBQUUsRUFBRSxHQUFHLEVBQUUsQ0FBQyxPQUFPLENBQUMsT0FBTyxDQUFDLGNBQWMsQ0FBQyxDQUFDLENBQUE7WUFDbkQsQ0FBQyxDQUFDLENBQUE7WUFDRixNQUFNLENBQUMsSUFBSSxDQUFDLFNBQVMsRUFBRSxTQUFTLENBQUMsQ0FBQTtZQUNqQyxJQUFJLE1BQU0sQ0FBQyxPQUFPO2dCQUFFLE9BQU8sRUFBRSxDQUFBO1FBQy9CLENBQUMsQ0FBQyxDQUFBO0lBQ0osQ0FBQztDQUNGIiwic291cmNlc0NvbnRlbnQiOlsiLy8gQHRzLWNoZWNrXG5cbmltcG9ydCB7IHJhbmRvbVVVSUQgfSBmcm9tIFwibm9kZTpjcnlwdG9cIlxuaW1wb3J0IG5ldCBmcm9tIFwibm9kZTpuZXRcIlxuaW1wb3J0IHRpbWVvdXQgZnJvbSBcImF3YWl0ZXJ5L2J1aWxkL3RpbWVvdXQuanNcIlxuaW1wb3J0IEpzb25Tb2NrZXQgZnJvbSBcIi4vanNvbi1zb2NrZXQuanNcIlxuXG5jb25zdCBERUZBVUxUX1JFUVVFU1RfVElNRU9VVF9NUyA9IDEwMDAwXG5leHBvcnQgY29uc3QgTUFYX0xJRkVDWUNMRV9SRVFVRVNUX1RJTUVPVVRfTVMgPSAxMjAwMDBcblxuLyoqIE9uZS1yZXF1ZXN0IGFja25vd2xlZGdlZCBsaWZlY3ljbGUgY2xpZW50LiAqL1xuZXhwb3J0IGRlZmF1bHQgY2xhc3MgQmFja2dyb3VuZEpvYnNMaWZlY3ljbGVDbGllbnQge1xuICAvKipcbiAgICogQ3JlYXRlcyBhIGxpZmVjeWNsZSBjbGllbnQuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gQ2xpZW50IG9wdGlvbnMuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vY29uZmlndXJhdGlvbi5qc1wiKS5kZWZhdWx0fSBhcmdzLmNvbmZpZ3VyYXRpb24gLSBDb25maWd1cmF0aW9uLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gW2FyZ3MuZ2VuZXJhdGlvbklkXSAtIEV4cGxpY2l0IGdlbmVyYXRpb24gaWRlbnRpdHkuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBbYXJncy5zb2NrZXRQYXRoXSAtIEV4cGxpY2l0IGNvbnRyb2wgc29ja2V0IHBhdGguXG4gICAqIEBwYXJhbSB7bnVtYmVyfSBbYXJncy5yZXF1ZXN0VGltZW91dE1zXSAtIFJlcXVlc3QgZGVhZGxpbmUgYmVsb3cgdGhlIHN1cGVydmlzb3IgaG9vayB0aW1lb3V0IChkZWZhdWx0OiAxMDAwMCkuXG4gICAqL1xuICBjb25zdHJ1Y3Rvcih7Y29uZmlndXJhdGlvbiwgZ2VuZXJhdGlvbklkLCBzb2NrZXRQYXRoLCByZXF1ZXN0VGltZW91dE1zID0gREVGQVVMVF9SRVFVRVNUX1RJTUVPVVRfTVN9KSB7XG4gICAgY29uc3QgZ2VuZXJhdGlvbkNvbmZpZyA9IGNvbmZpZ3VyYXRpb24ucmVzb2x2ZUJhY2tncm91bmRKb2JzR2VuZXJhdGlvbkNvbmZpZyh7XG4gICAgICBnZW5lcmF0aW9uSWQsXG4gICAgICBsaWZlY3ljbGVTb2NrZXRQYXRoOiBzb2NrZXRQYXRoLFxuICAgICAgc291cmNlTmFtZTogXCJCYWNrZ3JvdW5kSm9ic0xpZmVjeWNsZUNsaWVudFwiXG4gICAgfSlcbiAgICB0aGlzLmdlbmVyYXRpb25JZCA9IGdlbmVyYXRpb25Db25maWcuZ2VuZXJhdGlvbklkXG4gICAgdGhpcy5zb2NrZXRQYXRoID0gZ2VuZXJhdGlvbkNvbmZpZy5saWZlY3ljbGVTb2NrZXRQYXRoXG4gICAgaWYgKCFOdW1iZXIuaXNJbnRlZ2VyKHJlcXVlc3RUaW1lb3V0TXMpIHx8IHJlcXVlc3RUaW1lb3V0TXMgPCAxIHx8IHJlcXVlc3RUaW1lb3V0TXMgPiBNQVhfTElGRUNZQ0xFX1JFUVVFU1RfVElNRU9VVF9NUykge1xuICAgICAgdGhyb3cgbmV3IFR5cGVFcnJvcihgcmVxdWVzdFRpbWVvdXRNcyBtdXN0IGJlIGFuIGludGVnZXIgYmV0d2VlbiAxIGFuZCAke01BWF9MSUZFQ1lDTEVfUkVRVUVTVF9USU1FT1VUX01TfWApXG4gICAgfVxuICAgIHRoaXMucmVxdWVzdFRpbWVvdXRNcyA9IHJlcXVlc3RUaW1lb3V0TXNcbiAgICBpZiAoIXRoaXMuZ2VuZXJhdGlvbklkKSB0aHJvdyBuZXcgRXJyb3IoXCJCYWNrZ3JvdW5kIGpvYnMgbGlmZWN5Y2xlIGNsaWVudCByZXF1aXJlcyBnZW5lcmF0aW9uSWRcIilcbiAgICBpZiAoIXRoaXMuc29ja2V0UGF0aCkgdGhyb3cgbmV3IEVycm9yKFwiQmFja2dyb3VuZCBqb2JzIGxpZmVjeWNsZSBjbGllbnQgcmVxdWlyZXMgbGlmZWN5Y2xlU29ja2V0UGF0aFwiKVxuICB9XG5cbiAgLyoqXG4gICAqIEFjdGl2YXRlcyB0aGUgZ2VuZXJhdGlvbi5cbiAgICogQHJldHVybnMge1Byb21pc2U8aW1wb3J0KFwiLi90eXBlcy5qc1wiKS5CYWNrZ3JvdW5kSm9ic0dlbmVyYXRpb25MaWZlY3ljbGVTdGF0ZT59IC0gUmVzdWx0aW5nIHN0YXRlLlxuICAgKi9cbiAgYXN5bmMgYWN0aXZhdGUoKSB7IHJldHVybiBhd2FpdCB0aGlzLl9yZXF1ZXN0KFwiYWN0aXZhdGVcIikgfVxuXG4gIC8qKlxuICAgKiBSZXRpcmVzIHRoZSBnZW5lcmF0aW9uLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxpbXBvcnQoXCIuL3R5cGVzLmpzXCIpLkJhY2tncm91bmRKb2JzR2VuZXJhdGlvbkxpZmVjeWNsZVN0YXRlPn0gLSBSZXN1bHRpbmcgc3RhdGUuXG4gICAqL1xuICBhc3luYyByZXRpcmUoKSB7IHJldHVybiBhd2FpdCB0aGlzLl9yZXF1ZXN0KFwicmV0aXJlXCIpIH1cblxuICAvKipcbiAgICogU2VuZHMgZXhhY3RseSBvbmUgbGlmZWN5Y2xlIHJlcXVlc3QuXG4gICAqIEBwYXJhbSB7XCJhY3RpdmF0ZVwiIHwgXCJyZXRpcmVcIn0gYWN0aW9uIC0gTGlmZWN5Y2xlIGFjdGlvbi5cbiAgICogQHJldHVybnMge1Byb21pc2U8aW1wb3J0KFwiLi90eXBlcy5qc1wiKS5CYWNrZ3JvdW5kSm9ic0dlbmVyYXRpb25MaWZlY3ljbGVTdGF0ZT59IC0gUmVzdWx0aW5nIHN0YXRlLlxuICAgKi9cbiAgYXN5bmMgX3JlcXVlc3QoYWN0aW9uKSB7XG4gICAgcmV0dXJuIGF3YWl0IHRpbWVvdXQoe1xuICAgICAgZXJyb3JNZXNzYWdlOiBgQmFja2dyb3VuZCBqb2JzICR7YWN0aW9ufSByZXF1ZXN0IGZvciAke3RoaXMuZ2VuZXJhdGlvbklkfSB0aW1lZCBvdXQgYWZ0ZXIgJHt0aGlzLnJlcXVlc3RUaW1lb3V0TXN9bXMgYXQgJHt0aGlzLnNvY2tldFBhdGh9YCxcbiAgICAgIHRpbWVvdXQ6IHRoaXMucmVxdWVzdFRpbWVvdXRNc1xuICAgIH0sIGFzeW5jICh7Y29udHJvbH0pID0+IGF3YWl0IHRoaXMuX3J1blJlcXVlc3Qoe2FjdGlvbiwgc2lnbmFsOiBjb250cm9sLnNpZ25hbH0pKVxuICB9XG5cbiAgLyoqXG4gICAqIFNlbmRzIHRoZSBsaWZlY3ljbGUgcmVxdWVzdCB1bmRlciBpdHMgY2FsbGVyLW93bmVkIGRlYWRsaW5lLlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIFJlcXVlc3QgZGV0YWlscy5cbiAgICogQHBhcmFtIHtcImFjdGl2YXRlXCIgfCBcInJldGlyZVwifSBhcmdzLmFjdGlvbiAtIExpZmVjeWNsZSBhY3Rpb24uXG4gICAqIEBwYXJhbSB7QWJvcnRTaWduYWx9IGFyZ3Muc2lnbmFsIC0gUmVxdWVzdCBkZWFkbGluZSBzaWduYWwuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPGltcG9ydChcIi4vdHlwZXMuanNcIikuQmFja2dyb3VuZEpvYnNHZW5lcmF0aW9uTGlmZWN5Y2xlU3RhdGU+fSAtIFJlc3VsdGluZyBzdGF0ZS5cbiAgICovXG4gIGFzeW5jIF9ydW5SZXF1ZXN0KHthY3Rpb24sIHNpZ25hbH0pIHtcbiAgICBjb25zdCByZXF1ZXN0SWQgPSByYW5kb21VVUlEKClcbiAgICBjb25zdCBzb2NrZXQgPSBuZXQuY3JlYXRlQ29ubmVjdGlvbih0aGlzLnNvY2tldFBhdGgpXG4gICAgY29uc3QganNvblNvY2tldCA9IG5ldyBKc29uU29ja2V0KHNvY2tldClcblxuICAgIHJldHVybiBhd2FpdCBuZXcgUHJvbWlzZSgocmVzb2x2ZSwgcmVqZWN0KSA9PiB7XG4gICAgICBsZXQgZmluaXNoZWQgPSBmYWxzZVxuICAgICAgLyoqXG4gICAgICAgKiBTZXR0bGVzIHRoZSByZXF1ZXN0IG9uY2UuXG4gICAgICAgKiBAcGFyYW0ge29iamVjdH0gb3B0aW9ucyAtIFRlYXJkb3duIG9wdGlvbnMuXG4gICAgICAgKiBAcGFyYW0ge2Jvb2xlYW59IFtvcHRpb25zLmRlc3Ryb3ldIC0gRGVzdHJveSBpbnN0ZWFkIG9mIGNsb3NpbmcuXG4gICAgICAgKiBAcGFyYW0geygpID0+IHZvaWR9IGNhbGxiYWNrIC0gU2V0dGxlbWVudCBjYWxsYmFjay5cbiAgICAgICAqL1xuICAgICAgY29uc3QgZmluaXNoID0gKHtkZXN0cm95ID0gZmFsc2V9LCBjYWxsYmFjaykgPT4ge1xuICAgICAgICBpZiAoZmluaXNoZWQpIHJldHVyblxuICAgICAgICBmaW5pc2hlZCA9IHRydWVcbiAgICAgICAgc2lnbmFsLnJlbW92ZUV2ZW50TGlzdGVuZXIoXCJhYm9ydFwiLCBvbkFib3J0KVxuICAgICAgICBzb2NrZXQucmVtb3ZlTGlzdGVuZXIoXCJjb25uZWN0XCIsIG9uQ29ubmVjdClcbiAgICAgICAganNvblNvY2tldC5yZW1vdmVBbGxMaXN0ZW5lcnMoKVxuICAgICAgICBpZiAoZGVzdHJveSkganNvblNvY2tldC5kZXN0cm95KClcbiAgICAgICAgZWxzZSBqc29uU29ja2V0LmNsb3NlKClcbiAgICAgICAgY2FsbGJhY2soKVxuICAgICAgfVxuXG4gICAgICBjb25zdCBvbkFib3J0ID0gKCkgPT4gZmluaXNoKHtkZXN0cm95OiB0cnVlfSwgKCkgPT4gcmVqZWN0KHNpZ25hbC5yZWFzb24gaW5zdGFuY2VvZiBFcnJvciA/IHNpZ25hbC5yZWFzb24gOiBuZXcgRXJyb3IoXCJCYWNrZ3JvdW5kIGpvYnMgbGlmZWN5Y2xlIHJlcXVlc3QgYWJvcnRlZFwiKSkpXG4gICAgICBjb25zdCBvbkNvbm5lY3QgPSAoKSA9PiB7XG4gICAgICAgIGpzb25Tb2NrZXQuc2VuZCh7XG4gICAgICAgICAgdHlwZTogXCJiYWNrZ3JvdW5kLWpvYnMtbGlmZWN5Y2xlXCIsXG4gICAgICAgICAgYWN0aW9uLFxuICAgICAgICAgIGdlbmVyYXRpb25JZDogdGhpcy5nZW5lcmF0aW9uSWQsXG4gICAgICAgICAgcmVxdWVzdElkXG4gICAgICAgIH0pXG4gICAgICB9XG5cbiAgICAgIHNpZ25hbC5hZGRFdmVudExpc3RlbmVyKFwiYWJvcnRcIiwgb25BYm9ydClcbiAgICAgIGpzb25Tb2NrZXQub24oXCJlcnJvclwiLCAoZXJyb3IpID0+IGZpbmlzaCh7fSwgKCkgPT4gcmVqZWN0KGVycm9yKSkpXG4gICAgICBqc29uU29ja2V0Lm9uKFwiY2xvc2VcIiwgKCkgPT4gZmluaXNoKHtkZXN0cm95OiB0cnVlfSwgKCkgPT4gcmVqZWN0KG5ldyBFcnJvcihcIkJhY2tncm91bmQgam9icyBsaWZlY3ljbGUgc29ja2V0IGNsb3NlZCBiZWZvcmUgYWNrbm93bGVkZ2VtZW50XCIpKSkpXG4gICAgICBqc29uU29ja2V0Lm9uKFwibWVzc2FnZVwiLCAobWVzc2FnZSkgPT4ge1xuICAgICAgICBpZiAobWVzc2FnZT8ucmVxdWVzdElkICE9PSByZXF1ZXN0SWQgfHwgbWVzc2FnZS5hY3Rpb24gIT09IGFjdGlvbikge1xuICAgICAgICAgIGZpbmlzaCh7fSwgKCkgPT4gcmVqZWN0KG5ldyBFcnJvcihcIkJhY2tncm91bmQgam9icyBsaWZlY3ljbGUgcmVzcG9uc2UgZGlkIG5vdCBtYXRjaCBpdHMgcmVxdWVzdFwiKSkpXG4gICAgICAgICAgcmV0dXJuXG4gICAgICAgIH1cbiAgICAgICAgaWYgKG1lc3NhZ2UudHlwZSA9PT0gXCJiYWNrZ3JvdW5kLWpvYnMtbGlmZWN5Y2xlLWVycm9yXCIpIHtcbiAgICAgICAgICBjb25zdCBlcnJvciA9IG5ldyBFcnJvcihtZXNzYWdlLmVycm9yPy5tZXNzYWdlIHx8IFwiQmFja2dyb3VuZCBqb2JzIGxpZmVjeWNsZSByZXF1ZXN0IGZhaWxlZFwiKVxuICAgICAgICAgIGlmICh0eXBlb2YgbWVzc2FnZS5lcnJvcj8ubmFtZSA9PT0gXCJzdHJpbmdcIikgZXJyb3IubmFtZSA9IG1lc3NhZ2UuZXJyb3IubmFtZVxuICAgICAgICAgIGlmICh0eXBlb2YgbWVzc2FnZS5lcnJvcj8uc3RhY2sgPT09IFwic3RyaW5nXCIpIGVycm9yLnN0YWNrID0gbWVzc2FnZS5lcnJvci5zdGFja1xuICAgICAgICAgIGZpbmlzaCh7fSwgKCkgPT4gcmVqZWN0KGVycm9yKSlcbiAgICAgICAgICByZXR1cm5cbiAgICAgICAgfVxuICAgICAgICBpZiAobWVzc2FnZS50eXBlICE9PSBcImJhY2tncm91bmQtam9icy1saWZlY3ljbGUtYWNrXCIgfHwgbWVzc2FnZS5nZW5lcmF0aW9uSWQgIT09IHRoaXMuZ2VuZXJhdGlvbklkKSB7XG4gICAgICAgICAgZmluaXNoKHt9LCAoKSA9PiByZWplY3QobmV3IEVycm9yKFwiSW52YWxpZCBiYWNrZ3JvdW5kIGpvYnMgbGlmZWN5Y2xlIGFja25vd2xlZGdlbWVudFwiKSkpXG4gICAgICAgICAgcmV0dXJuXG4gICAgICAgIH1cbiAgICAgICAgZmluaXNoKHt9LCAoKSA9PiByZXNvbHZlKG1lc3NhZ2UubGlmZWN5Y2xlU3RhdGUpKVxuICAgICAgfSlcbiAgICAgIHNvY2tldC5vbmNlKFwiY29ubmVjdFwiLCBvbkNvbm5lY3QpXG4gICAgICBpZiAoc2lnbmFsLmFib3J0ZWQpIG9uQWJvcnQoKVxuICAgIH0pXG4gIH1cbn1cbiJdfQ==