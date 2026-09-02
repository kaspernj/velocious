// @ts-check
import net from "net";
import JsonSocket from "./json-socket.js";
import BackgroundJobsGenerationHandshakeTimeoutError, { DEFAULT_GENERATION_HANDSHAKE_TIMEOUT_MS, validateGenerationHandshakeTimeoutMs } from "./generation-handshake-timeout-error.js";
export default class BackgroundJobsSocketRequest {
    /**
     * Runs constructor.
     * @param {object} args - Options.
     * @param {string} args.host - Host.
     * @param {number} args.port - Port.
     * @param {"client" | "reporter"} args.role - Socket role.
     * @param {string} [args.generationId] - Release generation identity.
     * @param {number} [args.generationHandshakeTimeoutMs] - Generation acknowledgement deadline.
     */
    constructor({ host, port, role, generationHandshakeTimeoutMs = DEFAULT_GENERATION_HANDSHAKE_TIMEOUT_MS, generationId }) {
        this.host = host;
        this.port = port;
        this.role = role;
        this.generationId = generationId;
        this.generationHandshakeTimeoutMs = validateGenerationHandshakeTimeoutMs(generationHandshakeTimeoutMs);
        /**
         * Internal test-only observability reference — NOT public API. Holds the
         * JsonSocket wrapper this request created so the timeout spec can inspect the
         * wrapper's own `destroy()`/`close()` call counters — direct evidence of which
         * teardown method actually ran, not a self-reported flag. Retains the single
         * (already torn-down) wrapper for the request's lifetime. Do not expose or
         * depend on this outside tests.
         * @type {JsonSocket | undefined}
         */
        this._jsonSocket = undefined;
    }
    /**
     * Runs run.
     * @template T
     * @param {object} args - Options.
     * @param {(jsonSocket: JsonSocket) => void} args.onConnect - Called after the socket connects.
     * @param {(args: {message: import("./types.js").BackgroundJobSocketMessage, resolve: (value: T) => void, reject: (error: Error) => void}) => void} args.onMessage - Message handler.
     * @param {AbortSignal} [args.signal] - Aborts the request; on abort the pending socket is destroyed and the promise rejects with the signal reason when it is an Error, otherwise with a generic abort Error.
     * @returns {Promise<T>} - Resolved request value.
     */
    async run({ onConnect, onMessage, signal }) {
        const socket = net.createConnection({ host: this.host, port: this.port });
        const jsonSocket = new JsonSocket(socket);
        this._jsonSocket = jsonSocket;
        return await new Promise((resolve, reject) => {
            let finished = false;
            /** @type {ReturnType<typeof setTimeout> | undefined} */
            let handshakeTimer;
            /**
             * Finish.
             * @param {object} options - Options.
             * @param {boolean} [options.destroy] - Destroy the socket instead of gracefully closing it.
             * @param {() => void} callback - Finish callback.
             */
            const finish = ({ destroy = false } = {}, callback) => {
                if (finished)
                    return;
                finished = true;
                if (handshakeTimer)
                    clearTimeout(handshakeTimer);
                if (signal)
                    signal.removeEventListener("abort", onAbort);
                jsonSocket.removeAllListeners();
                if (destroy) {
                    jsonSocket.destroy();
                }
                else {
                    jsonSocket.close();
                }
                callback();
            };
            /**
             * Handles a cooperative abort: tears down the pending socket and rejects
             * with the signal reason when it is an Error.
             * @returns {void}
             */
            const onAbort = () => {
                const reason = signal?.reason;
                finish({ destroy: true }, () => reject(reason instanceof Error ? reason : new Error("Background job socket request aborted")));
            };
            if (signal) {
                if (signal.aborted) {
                    onAbort();
                    return;
                }
                signal.addEventListener("abort", onAbort);
            }
            jsonSocket.on("error", (error) => {
                finish({}, () => reject(error));
            });
            jsonSocket.on("close", () => {
                finish({ destroy: true }, () => reject(new Error("Background jobs socket closed before the request was acknowledged")));
            });
            /**
             * Handles the socket response message.
             * @param {import("./types.js").BackgroundJobSocketMessage} message - Socket message.
             */
            jsonSocket.on("message", (message) => {
                if (this.generationId && message?.type === "generation-accepted") {
                    if (message.generationId !== this.generationId) {
                        finish({ destroy: true }, () => reject(new Error("Background jobs main acknowledged a different generation")));
                        return;
                    }
                    if (handshakeTimer) {
                        clearTimeout(handshakeTimer);
                        handshakeTimer = undefined;
                    }
                    onConnect(jsonSocket);
                    return;
                }
                if (this.generationId && message?.type === "generation-rejected") {
                    finish({ destroy: true }, () => reject(new Error(`Background jobs generation rejected: ${message.reason}`)));
                    return;
                }
                onMessage({
                    message,
                    resolve: (value) => finish({}, () => resolve(value)),
                    reject: (error) => finish({}, () => reject(error))
                });
            });
            if (this.generationId) {
                handshakeTimer = setTimeout(() => {
                    const error = new BackgroundJobsGenerationHandshakeTimeoutError({
                        endpoint: `${this.host}:${this.port}`,
                        generationId: this.generationId || "",
                        role: this.role,
                        timeoutMs: this.generationHandshakeTimeoutMs
                    });
                    finish({ destroy: true }, () => reject(error));
                }, this.generationHandshakeTimeoutMs);
            }
            socket.on("connect", () => {
                jsonSocket.send({ type: "hello", role: this.role, ...(this.generationId ? { generationId: this.generationId } : {}) });
                if (!this.generationId) {
                    onConnect(jsonSocket);
                }
            });
        });
    }
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoic29ja2V0LXJlcXVlc3QuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi9zcmMvYmFja2dyb3VuZC1qb2JzL3NvY2tldC1yZXF1ZXN0LmpzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiJBQUFBLFlBQVk7QUFFWixPQUFPLEdBQUcsTUFBTSxLQUFLLENBQUE7QUFDckIsT0FBTyxVQUFVLE1BQU0sa0JBQWtCLENBQUE7QUFDekMsT0FBTyw2Q0FBNkMsRUFBRSxFQUFFLHVDQUF1QyxFQUFFLG9DQUFvQyxFQUFFLE1BQU0seUNBQXlDLENBQUE7QUFFdEwsTUFBTSxDQUFDLE9BQU8sT0FBTywyQkFBMkI7SUFDOUM7Ozs7Ozs7O09BUUc7SUFDSCxZQUFZLEVBQUMsSUFBSSxFQUFFLElBQUksRUFBRSxJQUFJLEVBQUUsNEJBQTRCLEdBQUcsdUNBQXVDLEVBQUUsWUFBWSxFQUFDO1FBQ2xILElBQUksQ0FBQyxJQUFJLEdBQUcsSUFBSSxDQUFBO1FBQ2hCLElBQUksQ0FBQyxJQUFJLEdBQUcsSUFBSSxDQUFBO1FBQ2hCLElBQUksQ0FBQyxJQUFJLEdBQUcsSUFBSSxDQUFBO1FBQ2hCLElBQUksQ0FBQyxZQUFZLEdBQUcsWUFBWSxDQUFBO1FBQ2hDLElBQUksQ0FBQyw0QkFBNEIsR0FBRyxvQ0FBb0MsQ0FBQyw0QkFBNEIsQ0FBQyxDQUFBO1FBQ3RHOzs7Ozs7OztXQVFHO1FBQ0gsSUFBSSxDQUFDLFdBQVcsR0FBRyxTQUFTLENBQUE7SUFDOUIsQ0FBQztJQUVEOzs7Ozs7OztPQVFHO0lBQ0gsS0FBSyxDQUFDLEdBQUcsQ0FBQyxFQUFDLFNBQVMsRUFBRSxTQUFTLEVBQUUsTUFBTSxFQUFDO1FBQ3RDLE1BQU0sTUFBTSxHQUFHLEdBQUcsQ0FBQyxnQkFBZ0IsQ0FBQyxFQUFDLElBQUksRUFBRSxJQUFJLENBQUMsSUFBSSxFQUFFLElBQUksRUFBRSxJQUFJLENBQUMsSUFBSSxFQUFDLENBQUMsQ0FBQTtRQUN2RSxNQUFNLFVBQVUsR0FBRyxJQUFJLFVB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QUFPLEVBQUUsSUFBSSxFQUFDLEVBQUUsR0FBRyxFQUFFLENBQUMsTUFBTSxDQUFDLEtBQUssQ0FBQyxDQUFDLENBQUE7Z0JBQzlDLENBQUMsRUFBRSxJQUFJLENBQUMsNEJBQTRCLENBQUMsQ0FBQTtZQUN2QyxDQUFDO1lBRUQsTUFBTSxDQUFDLEVBQUUsQ0FBQyxTQUFTLEVBQUUsR0FBRyxFQUFFO2dCQUN4QixVQUFVLENBQUMsSUFBSSxDQUFDLEVBQUMsSUFBSSxFQUFFLE9BQU8sRUFBRSxJQUFJLEVBQUUsSUFBSSxDQUFDLElBQUksRUFBRSxHQUFHLENBQUMsSUFBSSxDQUFDLFlBQVksQ0FBQyxDQUFDLENBQUMsRUFBQyxZQUFZLEVBQUUsSUFBSSxDQUFDLFlBQVksRUFBQyxDQUFDLENBQUMsQ0FBQyxFQUFFLENBQUMsRUFBQyxDQUFDLENBQUE7Z0JBQ2xILElBQUksQ0FBQyxJQUFJLENBQUMsWUFBWSxFQUFFLENBQUM7b0JBQ3ZCLFNBQVMsQ0FBQyxVQUFVLENBQUMsQ0FBQTtnQkFDdkIsQ0FBQztZQUNILENBQUMsQ0FBQyxDQUFBO1FBQ0osQ0FBQyxDQUFDLENBQUE7SUFDSixDQUFDO0NBQ0YiLCJzb3VyY2VzQ29udGVudCI6WyIvLyBAdHMtY2hlY2tcblxuaW1wb3J0IG5ldCBmcm9tIFwibmV0XCJcbmltcG9ydCBKc29uU29ja2V0IGZyb20gXCIuL2pzb24tc29ja2V0LmpzXCJcbmltcG9ydCBCYWNrZ3JvdW5kSm9ic0dlbmVyYXRpb25IYW5kc2hha2VUaW1lb3V0RXJyb3IsIHsgREVGQVVMVF9HRU5FUkFUSU9OX0hBTkRTSEFLRV9USU1FT1VUX01TLCB2YWxpZGF0ZUdlbmVyYXRpb25IYW5kc2hha2VUaW1lb3V0TXMgfSBmcm9tIFwiLi9nZW5lcmF0aW9uLWhhbmRzaGFrZS10aW1lb3V0LWVycm9yLmpzXCJcblxuZXhwb3J0IGRlZmF1bHQgY2xhc3MgQmFja2dyb3VuZEpvYnNTb2NrZXRSZXF1ZXN0IHtcbiAgLyoqXG4gICAqIFJ1bnMgY29uc3RydWN0b3IuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gT3B0aW9ucy5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGFyZ3MuaG9zdCAtIEhvc3QuXG4gICAqIEBwYXJhbSB7bnVtYmVyfSBhcmdzLnBvcnQgLSBQb3J0LlxuICAgKiBAcGFyYW0ge1wiY2xpZW50XCIgfCBcInJlcG9ydGVyXCJ9IGFyZ3Mucm9sZSAtIFNvY2tldCByb2xlLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gW2FyZ3MuZ2VuZXJhdGlvbklkXSAtIFJlbGVhc2UgZ2VuZXJhdGlvbiBpZGVudGl0eS5cbiAgICogQHBhcmFtIHtudW1iZXJ9IFthcmdzLmdlbmVyYXRpb25IYW5kc2hha2VUaW1lb3V0TXNdIC0gR2VuZXJhdGlvbiBhY2tub3dsZWRnZW1lbnQgZGVhZGxpbmUuXG4gICAqL1xuICBjb25zdHJ1Y3Rvcih7aG9zdCwgcG9ydCwgcm9sZSwgZ2VuZXJhdGlvbkhhbmRzaGFrZVRpbWVvdXRNcyA9IERFRkFVTFRfR0VORVJBVElPTl9IQU5EU0hBS0VfVElNRU9VVF9NUywgZ2VuZXJhdGlvbklkfSkge1xuICAgIHRoaXMuaG9zdCA9IGhvc3RcbiAgICB0aGlzLnBvcnQgPSBwb3J0XG4gICAgdGhpcy5yb2xlID0gcm9sZVxuICAgIHRoaXMuZ2VuZXJhdGlvbklkID0gZ2VuZXJhdGlvbklkXG4gICAgdGhpcy5nZW5lcmF0aW9uSGFuZHNoYWtlVGltZW91dE1zID0gdmFsaWRhdGVHZW5lcmF0aW9uSGFuZHNoYWtlVGltZW91dE1zKGdlbmVyYXRpb25IYW5kc2hha2VUaW1lb3V0TXMpXG4gICAgLyoqXG4gICAgICogSW50ZXJuYWwgdGVzdC1vbmx5IG9ic2VydmFiaWxpdHkgcmVmZXJlbmNlIOKAlCBOT1QgcHVibGljIEFQSS4gSG9sZHMgdGhlXG4gICAgICogSnNvblNvY2tldCB3cmFwcGVyIHRoaXMgcmVxdWVzdCBjcmVhdGVkIHNvIHRoZSB0aW1lb3V0IHNwZWMgY2FuIGluc3BlY3QgdGhlXG4gICAgICogd3JhcHBlcidzIG93biBgZGVzdHJveSgpYC9gY2xvc2UoKWAgY2FsbCBjb3VudGVycyDigJQgZGlyZWN0IGV2aWRlbmNlIG9mIHdoaWNoXG4gICAgICogdGVhcmRvd24gbWV0aG9kIGFjdHVhbGx5IHJhbiwgbm90IGEgc2VsZi1yZXBvcnRlZCBmbGFnLiBSZXRhaW5zIHRoZSBzaW5nbGVcbiAgICAgKiAoYWxyZWFkeSB0b3JuLWRvd24pIHdyYXBwZXIgZm9yIHRoZSByZXF1ZXN0J3MgbGlmZXRpbWUuIERvIG5vdCBleHBvc2Ugb3JcbiAgICAgKiBkZXBlbmQgb24gdGhpcyBvdXRzaWRlIHRlc3RzLlxuICAgICAqIEB0eXBlIHtKc29uU29ja2V0IHwgdW5kZWZpbmVkfVxuICAgICAqL1xuICAgIHRoaXMuX2pzb25Tb2NrZXQgPSB1bmRlZmluZWRcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHJ1bi5cbiAgICogQHRlbXBsYXRlIFRcbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBPcHRpb25zLlxuICAgKiBAcGFyYW0geyhqc29uU29ja2V0OiBKc29uU29ja2V0KSA9PiB2b2lkfSBhcmdzLm9uQ29ubmVjdCAtIENhbGxlZCBhZnRlciB0aGUgc29ja2V0IGNvbm5lY3RzLlxuICAgKiBAcGFyYW0geyhhcmdzOiB7bWVzc2FnZTogaW1wb3J0KFwiLi90eXBlcy5qc1wiKS5CYWNrZ3JvdW5kSm9iU29ja2V0TWVzc2FnZSwgcmVzb2x2ZTogKHZhbHVlOiBUKSA9PiB2b2lkLCByZWplY3Q6IChlcnJvcjogRXJyb3IpID0+IHZvaWR9KSA9PiB2b2lkfSBhcmdzLm9uTWVzc2FnZSAtIE1lc3NhZ2UgaGFuZGxlci5cbiAgICogQHBhcmFtIHtBYm9ydFNpZ25hbH0gW2FyZ3Muc2lnbmFsXSAtIEFib3J0cyB0aGUgcmVxdWVzdDsgb24gYWJvcnQgdGhlIHBlbmRpbmcgc29ja2V0IGlzIGRlc3Ryb3llZCBhbmQgdGhlIHByb21pc2UgcmVqZWN0cyB3aXRoIHRoZSBzaWduYWwgcmVhc29uIHdoZW4gaXQgaXMgYW4gRXJyb3IsIG90aGVyd2lzZSB3aXRoIGEgZ2VuZXJpYyBhYm9ydCBFcnJvci5cbiAgICogQHJldHVybnMge1Byb21pc2U8VD59IC0gUmVzb2x2ZWQgcmVxdWVzdCB2YWx1ZS5cbiAgICovXG4gIGFzeW5jIHJ1bih7b25Db25uZWN0LCBvbk1lc3NhZ2UsIHNpZ25hbH0pIHtcbiAgICBjb25zdCBzb2NrZXQgPSBuZXQuY3JlYXRlQ29ubmVjdGlvbih7aG9zdDogdGhpcy5ob3N0LCBwb3J0OiB0aGlzLnBvcnR9KVxuICAgIGNvbnN0IGpzb25Tb2NrZXQgPSBuZXcgSnNvblNvY2tldChzb2NrZXQpXG5cbiAgICB0aGlzLl9qc29uU29ja2V0ID0ganNvblNvY2tldFxuXG4gICAgcmV0dXJuIGF3YWl0IG5ldyBQcm9taXNlKChyZXNvbHZlLCByZWplY3QpID0+IHtcbiAgICAgIGxldCBmaW5pc2hlZCA9IGZhbHNlXG4gICAgICAvKiogQHR5cGUge1JldHVyblR5cGU8dHlwZW9mIHNldFRpbWVvdXQ+IHwgdW5kZWZpbmVkfSAqL1xuICAgICAgbGV0IGhhbmRzaGFrZVRpbWVyXG4gICAgICAvKipcbiAgICAgICAqIEZpbmlzaC5cbiAgICAgICAqIEBwYXJhbSB7b2JqZWN0fSBvcHRpb25zIC0gT3B0aW9ucy5cbiAgICAgICAqIEBwYXJhbSB7Ym9vbGVhbn0gW29wdGlvbnMuZGVzdHJveV0gLSBEZXN0cm95IHRoZSBzb2NrZXQgaW5zdGVhZCBvZiBncmFjZWZ1bGx5IGNsb3NpbmcgaXQuXG4gICAgICAgKiBAcGFyYW0geygpID0+IHZvaWR9IGNhbGxiYWNrIC0gRmluaXNoIGNhbGxiYWNrLlxuICAgICAgICovXG4gICAgICBjb25zdCBmaW5pc2ggPSAoe2Rlc3Ryb3kgPSBmYWxzZX0gPSB7fSwgY2FsbGJhY2spID0+IHtcbiAgICAgICAgaWYgKGZpbmlzaGVkKSByZXR1cm5cbiAgICAgICAgZmluaXNoZWQgPSB0cnVlXG4gICAgICAgIGlmIChoYW5kc2hha2VUaW1lcikgY2xlYXJUaW1lb3V0KGhhbmRzaGFrZVRpbWVyKVxuICAgICAgICBpZiAoc2lnbmFsKSBzaWduYWwucmVtb3ZlRXZlbnRMaXN0ZW5lcihcImFib3J0XCIsIG9uQWJvcnQpXG4gICAgICAgIGpzb25Tb2NrZXQucmVtb3ZlQWxsTGlzdGVuZXJzKClcblxuICAgICAgICBpZiAoZGVzdHJveSkge1xuICAgICAgICAgIGpzb25Tb2NrZXQuZGVzdHJveSgpXG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAganNvblNvY2tldC5jbG9zZSgpXG4gICAgICAgIH1cblxuICAgICAgICBjYWxsYmFjaygpXG4gICAgICB9XG5cbiAgICAgIC8qKlxuICAgICAgICogSGFuZGxlcyBhIGNvb3BlcmF0aXZlIGFib3J0OiB0ZWFycyBkb3duIHRoZSBwZW5kaW5nIHNvY2tldCBhbmQgcmVqZWN0c1xuICAgICAgICogd2l0aCB0aGUgc2lnbmFsIHJlYXNvbiB3aGVuIGl0IGlzIGFuIEVycm9yLlxuICAgICAgICogQHJldHVybnMge3ZvaWR9XG4gICAgICAgKi9cbiAgICAgIGNvbnN0IG9uQWJvcnQgPSAoKSA9PiB7XG4gICAgICAgIGNvbnN0IHJlYXNvbiA9IHNpZ25hbD8ucmVhc29uXG5cbiAgICAgICAgZmluaXNoKHtkZXN0cm95OiB0cnVlfSwgKCkgPT4gcmVqZWN0KHJlYXNvbiBpbnN0YW5jZW9mIEVycm9yID8gcmVhc29uIDogbmV3IEVycm9yKFwiQmFja2dyb3VuZCBqb2Igc29ja2V0IHJlcXVlc3QgYWJvcnRlZFwiKSkpXG4gICAgICB9XG5cbiAgICAgIGlmIChzaWduYWwpIHtcbiAgICAgICAgaWYgKHNpZ25hbC5hYm9ydGVkKSB7XG4gICAgICAgICAgb25BYm9ydCgpXG4gICAgICAgICAgcmV0dXJuXG4gICAgICAgIH1cblxuICAgICAgICBzaWduYWwuYWRkRXZlbnRMaXN0ZW5lcihcImFib3J0XCIsIG9uQWJvcnQpXG4gICAgICB9XG5cbiAgICAgIGpzb25Tb2NrZXQub24oXCJlcnJvclwiLCAoZXJyb3IpID0+IHtcbiAgICAgICAgZmluaXNoKHt9LCAoKSA9PiByZWplY3QoZXJyb3IpKVxuICAgICAgfSlcblxuICAgICAganNvblNvY2tldC5vbihcImNsb3NlXCIsICgpID0+IHtcbiAgICAgICAgZmluaXNoKHtkZXN0cm95OiB0cnVlfSwgKCkgPT4gcmVqZWN0KG5ldyBFcnJvcihcIkJhY2tncm91bmQgam9icyBzb2NrZXQgY2xvc2VkIGJlZm9yZSB0aGUgcmVxdWVzdCB3YXMgYWNrbm93bGVkZ2VkXCIpKSlcbiAgICAgIH0pXG5cbiAgICAgIC8qKlxuICAgICAgICogSGFuZGxlcyB0aGUgc29ja2V0IHJlc3BvbnNlIG1lc3NhZ2UuXG4gICAgICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vdHlwZXMuanNcIikuQmFja2dyb3VuZEpvYlNvY2tldE1lc3NhZ2V9IG1lc3NhZ2UgLSBTb2NrZXQgbWVzc2FnZS5cbiAgICAgICAqL1xuICAgICAganNvblNvY2tldC5vbihcIm1lc3NhZ2VcIiwgKG1lc3NhZ2UpID0+IHtcbiAgICAgICAgaWYgKHRoaXMuZ2VuZXJhdGlvbklkICYmIG1lc3NhZ2U/LnR5cGUgPT09IFwiZ2VuZXJhdGlvbi1hY2NlcHRlZFwiKSB7XG4gICAgICAgICAgaWYgKG1lc3NhZ2UuZ2VuZXJhdGlvbklkICE9PSB0aGlzLmdlbmVyYXRpb25JZCkge1xuICAgICAgICAgICAgZmluaXNoKHtkZXN0cm95OiB0cnVlfSwgKCkgPT4gcmVqZWN0KG5ldyBFcnJvcihcIkJhY2tncm91bmQgam9icyBtYWluIGFja25vd2xlZGdlZCBhIGRpZmZlcmVudCBnZW5lcmF0aW9uXCIpKSlcbiAgICAgICAgICAgIHJldHVyblxuICAgICAgICAgIH1cblxuICAgICAgICAgIGlmIChoYW5kc2hha2VUaW1lcikge1xuICAgICAgICAgICAgY2xlYXJUaW1lb3V0KGhhbmRzaGFrZVRpbWVyKVxuICAgICAgICAgICAgaGFuZHNoYWtlVGltZXIgPSB1bmRlZmluZWRcbiAgICAgICAgICB9XG4gICAgICAgICAgb25Db25uZWN0KGpzb25Tb2NrZXQpXG4gICAgICAgICAgcmV0dXJuXG4gICAgICAgIH1cblxuICAgICAgICBpZiAodGhpcy5nZW5lcmF0aW9uSWQgJiYgbWVzc2FnZT8udHlwZSA9PT0gXCJnZW5lcmF0aW9uLXJlamVjdGVkXCIpIHtcbiAgICAgICAgICBmaW5pc2goe2Rlc3Ryb3k6IHRydWV9LCAoKSA9PiByZWplY3QobmV3IEVycm9yKGBCYWNrZ3JvdW5kIGpvYnMgZ2VuZXJhdGlvbiByZWplY3RlZDogJHttZXNzYWdlLnJlYXNvbn1gKSkpXG4gICAgICAgICAgcmV0dXJuXG4gICAgICAgIH1cblxuICAgICAgICBvbk1lc3NhZ2Uoe1xuICAgICAgICAgIG1lc3NhZ2UsXG4gICAgICAgICAgcmVzb2x2ZTogKHZhbHVlKSA9PiBmaW5pc2goe30sICgpID0+IHJlc29sdmUodmFsdWUpKSxcbiAgICAgICAgICByZWplY3Q6IChlcnJvcikgPT4gZmluaXNoKHt9LCAoKSA9PiByZWplY3QoZXJyb3IpKVxuICAgICAgICB9KVxuICAgICAgfSlcblxuICAgICAgaWYgKHRoaXMuZ2VuZXJhdGlvbklkKSB7XG4gICAgICAgIGhhbmRzaGFrZVRpbWVyID0gc2V0VGltZW91dCgoKSA9PiB7XG4gICAgICAgICAgY29uc3QgZXJyb3IgPSBuZXcgQmFja2dyb3VuZEpvYnNHZW5lcmF0aW9uSGFuZHNoYWtlVGltZW91dEVycm9yKHtcbiAgICAgICAgICAgIGVuZHBvaW50OiBgJHt0aGlzLmhvc3R9OiR7dGhpcy5wb3J0fWAsXG4gICAgICAgICAgICBnZW5lcmF0aW9uSWQ6IHRoaXMuZ2VuZXJhdGlvbklkIHx8IFwiXCIsXG4gICAgICAgICAgICByb2xlOiB0aGlzLnJvbGUsXG4gICAgICAgICAgICB0aW1lb3V0TXM6IHRoaXMuZ2VuZXJhdGlvbkhhbmRzaGFrZVRpbWVvdXRNc1xuICAgICAgICAgIH0pXG4gICAgICAgICAgZmluaXNoKHtkZXN0cm95OiB0cnVlfSwgKCkgPT4gcmVqZWN0KGVycm9yKSlcbiAgICAgICAgfSwgdGhpcy5nZW5lcmF0aW9uSGFuZHNoYWtlVGltZW91dE1zKVxuICAgICAgfVxuXG4gICAgICBzb2NrZXQub24oXCJjb25uZWN0XCIsICgpID0+IHtcbiAgICAgICAganNvblNvY2tldC5zZW5kKHt0eXBlOiBcImhlbGxvXCIsIHJvbGU6IHRoaXMucm9sZSwgLi4uKHRoaXMuZ2VuZXJhdGlvbklkID8ge2dlbmVyYXRpb25JZDogdGhpcy5nZW5lcmF0aW9uSWR9IDoge30pfSlcbiAgICAgICAgaWYgKCF0aGlzLmdlbmVyYXRpb25JZCkge1xuICAgICAgICAgIG9uQ29ubmVjdChqc29uU29ja2V0KVxuICAgICAgICB9XG4gICAgICB9KVxuICAgIH0pXG4gIH1cbn1cbiJdfQ==