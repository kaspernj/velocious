// @ts-check
import timeout from "awaitery/build/timeout.js";
import wait from "awaitery/build/wait.js";
import Logger from "../logger.js";
import normalizeBackgroundJobError from "./normalize-error.js";
import BackgroundJobsSocketRequest from "./socket-request.js";
import { DEFAULT_GENERATION_HANDSHAKE_TIMEOUT_MS, validateGenerationHandshakeTimeoutMs } from "./generation-handshake-timeout-error.js";
class BackgroundJobUpdateError extends Error {
}
export default class BackgroundJobsStatusReporter {
    /**
     * Runs constructor.
     * @param {object} args - Options.
     * @param {import("../configuration.js").default} args.configuration - Configuration.
     * @param {string} [args.host] - Host.
     * @param {number} [args.port] - Port.
     * @param {number} [args.attemptTimeoutMs] - Per-attempt socket-request timeout in milliseconds (default: 5000).
     * @param {string} [args.generationId] - Explicit release generation identity.
     * @param {number} [args.generationHandshakeTimeoutMs] - Maximum time to wait for generation acknowledgement (default: 4000).
     */
    constructor({ configuration, host, port, attemptTimeoutMs = 5000, generationHandshakeTimeoutMs = DEFAULT_GENERATION_HANDSHAKE_TIMEOUT_MS, generationId }) {
        this.configuration = configuration;
        this.host = host;
        this.port = port;
        this.attemptTimeoutMs = attemptTimeoutMs;
        this.generationHandshakeTimeoutMs = validateGenerationHandshakeTimeoutMs(generationHandshakeTimeoutMs);
        this.explicitGenerationId = generationId;
        /**
         * Internal test-only observability state — NOT public API. References the most
         * recent socket request so the timeout spec can inspect how its socket was torn
         * down. Do not expose or depend on this outside tests.
         * @type {BackgroundJobsSocketRequest | undefined}
         */
        this._lastRequest = undefined;
        this.logger = new Logger(this);
    }
    /**
     * Runs report.
     * @param {object} args - Options.
     * @param {string} args.jobId - Job id.
     * @param {"completed" | "failed" | "rescheduled"} args.status - Status.
     * @param {number} [args.delayMs] - Reschedule delay in milliseconds.
     * @param {ReturnType<typeof JSON.parse>} [args.error] - Error.
     * @param {string} [args.handoffId] - Handoff lease id.
     * @param {number} [args.handedOffAtMs] - Handed off timestamp.
     * @param {string} [args.workerId] - Worker id.
     * @returns {Promise<void>} - Resolves when reported.
     */
    async report({ jobId, status, delayMs, error, handoffId, handedOffAtMs, workerId }) {
        const config = this.configuration.getBackgroundJobsConfig();
        const host = this.host || config.host;
        const port = typeof this.port === "number" ? this.port : config.port;
        const { generationId } = this.configuration.resolveBackgroundJobsGenerationConfig({
            generationId: this.explicitGenerationId,
            sourceName: "BackgroundJobsStatusReporter"
        });
        await timeout({ timeout: this.attemptTimeoutMs }, async ({ control }) => {
            const request = new BackgroundJobsSocketRequest({ host, port, role: "reporter", generationHandshakeTimeoutMs: this.generationHandshakeTimeoutMs, generationId });
            this._lastRequest = request;
            await request.run({
                signal: control.signal,
                onConnect: (jsonSocket) => {
                    jsonSocket.send({
                        type: status === "completed" ? "job-complete" : status === "rescheduled" ? "job-reschedule" : "job-failed",
                        jobId,
                        delayMs,
                        handoffId,
                        workerId,
                        handedOffAtMs,
                        error: error ? normalizeBackgroundJobError(error) : undefined
                    });
                },
                onMessage: ({ message, resolve, reject }) => {
                    if (message?.type === "job-updated" && message.jobId === jobId) {
                        resolve(undefined);
                        return;
                    }
                    if (message?.type === "job-update-error" && message.jobId === jobId) {
                        reject(new BackgroundJobUpdateError(message.error || "Job update failed"));
                    }
                }
            });
        });
    }
    /**
     * Runs report with retry.
     * @param {object} args - Options.
     * @param {string} args.jobId - Job id.
     * @param {"completed" | "failed" | "rescheduled"} args.status - Status.
     * @param {number} [args.delayMs] - Reschedule delay in milliseconds.
     * @param {ReturnType<typeof JSON.parse>} [args.error] - Error.
     * @param {string} [args.handoffId] - Handoff lease id.
     * @param {number} [args.handedOffAtMs] - Handed off timestamp.
     * @param {string} [args.workerId] - Worker id.
     * @param {number} [args.maxDurationMs] - Max duration for retries.
     * @param {boolean} [args.retryPersistErrors] - Retry a `BackgroundJobUpdateError` (main's `job-update-error`, i.e. a transient DB failure while persisting the terminal status) instead of throwing immediately. Off by default so short-lived forked/spawned runners keep failing loudly and exit non-zero to be reclaimed; on for the long-lived worker, which cannot exit-to-reclaim and would otherwise strand the job in `handed_off`.
     * @returns {Promise<void>} - Resolves when reported.
     */
    async reportWithRetry({ jobId, status, delayMs, error, handoffId, handedOffAtMs, workerId, maxDurationMs, retryPersistErrors = false }) {
        let attempt = 0;
        const startTime = Date.now();
        while (true) {
            try {
                await this.report({ jobId, status, delayMs, error, handoffId, handedOffAtMs, workerId });
                return;
            }
            catch (error) {
                // A `BackgroundJobUpdateError` means main answered `job-update-error`, which it
                // only sends when `store.markCompleted`/`markFailed` THROWS — a transient DB
                // failure (deadlock, connection reset, lock-wait timeout, or main's cold
                // connection pool right after a deploy restart). Every logical rejection (job
                // gone, stale handoff lease, already terminal) instead answers `job-updated`,
                // so an update error is always the transient, retryable kind. It is retried
                // only for the long-lived worker (`retryPersistErrors`), which cannot exit to
                // trigger orphan reclaim and would otherwise drop the completion and strand the
                // row in `handed_off` forever — fatal for a `max_concurrency: 1` job such as a
                // build/queue planner, whose single stranded row blocks every future run.
                // Forked/spawned runners keep throwing it so they exit non-zero and are
                // reclaimed instead. Bounded by `maxDurationMs` either way.
                if (error instanceof BackgroundJobUpdateError && !retryPersistErrors)
                    throw error;
                attempt += 1;
                const delaySeconds = Math.min(30, 0.5 * attempt);
                this.logger.debug(() => ["Background job status report failed, retrying", error]);
                if (maxDurationMs && Date.now() - startTime >= maxDurationMs) {
                    this.logger.warn(() => ["Background job status report timed out, giving up", error]);
                    throw error;
                }
                await wait(delaySeconds);
            }
        }
    }
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoic3RhdHVzLXJlcG9ydGVyLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiLi4vLi4vLi4vc3JjL2JhY2tncm91bmQtam9icy9zdGF0dXMtcmVwb3J0ZXIuanMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6IkFBQUEsWUFBWTtBQUVaLE9BQU8sT0FBTyxNQUFNLDJCQUEyQixDQUFBO0FBQy9DLE9BQU8sSUFBSSxNQUFNLHdCQUF3QixDQUFBO0FBQ3pDLE9BQU8sTUFBTSxNQUFNLGNBQWMsQ0FBQTtBQUNqQyxPQUFPLDJCQUEyQixNQUFNLHNCQUFzQixDQUFBO0FBQzlELE9BQU8sMkJBQTJCLE1BQU0scUJBQXFCLENBQUE7QUFDN0QsT0FBTyxFQUFFLHVDQUF1QyxFQUFFLG9DQUFvQyxFQUFFLE1BQU0seUNBQXlDLENBQUE7QUFFdkksTUFBTSx3QkFBeUIsU0FBUSxLQUFLO0NBQUc7QUFFL0MsTUFBTSxDQUFDLE9BQU8sT0FBTyw0QkFBNEI7SUFDL0M7Ozs7Ozs7OztPQVNHO0lBQ0gsWUFBWSxFQUFDLGFBQWEsRUFBRSxJQUFJLEVBQUUsSUFBSSxFQUFFLGdCQUFnQixHQUFHLElBQUksRUFBRSw0QkFBNEIsR0FBRyx1Q0FBdUMsRUFBRSxZQUFZLEVBQUM7UUFDcEosSUFBSSxDQUFDLGFBQWEsR0FBRyxhQUFhLENBQUE7UUFDbEMsSUFBSSxDQUFDLElBQUksR0FBRyxJQUFJLENBQUE7UUFDaEIsSUFBSSxDQUFDLElBQUksR0FBRyxJQUFJLENBQUE7UUFDaEIsSUFBSSxDQUFDLGdCQUFnQixHQUFHLGdCQUFnQixDQUFBO1FBQ3hDLElBQUksQ0FBQyw0QkFBNEIsR0FBRyxvQ0FBb0MsQ0FBQyw0QkFBNEIsQ0FBQyxDQUFBO1FBQ3RHLElBQUksQ0FBQyxvQkFBb0IsR0FBRyxZQUFZLENBQUE7UUFDeEM7Ozs7O1dBS0c7UUFDSCxJQUFJLENBQUMsWUFBWSxHQUFHLFNBQVMsQ0FBQTtRQUM3QixJQUFJLENBQUMsTUFBTSxHQUFHLElBQUksTUFBTSxDQUFDLElBQUks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QUE7WUFDMUIsQ0FBQztRQUNILENBQUM7SUFDSCxDQUFDO0NBRUYiLCJzb3VyY2VzQ29udGVudCI6WyIvLyBAdHMtY2hlY2tcblxuaW1wb3J0IHRpbWVvdXQgZnJvbSBcImF3YWl0ZXJ5L2J1aWxkL3RpbWVvdXQuanNcIlxuaW1wb3J0IHdhaXQgZnJvbSBcImF3YWl0ZXJ5L2J1aWxkL3dhaXQuanNcIlxuaW1wb3J0IExvZ2dlciBmcm9tIFwiLi4vbG9nZ2VyLmpzXCJcbmltcG9ydCBub3JtYWxpemVCYWNrZ3JvdW5kSm9iRXJyb3IgZnJvbSBcIi4vbm9ybWFsaXplLWVycm9yLmpzXCJcbmltcG9ydCBCYWNrZ3JvdW5kSm9ic1NvY2tldFJlcXVlc3QgZnJvbSBcIi4vc29ja2V0LXJlcXVlc3QuanNcIlxuaW1wb3J0IHsgREVGQVVMVF9HRU5FUkFUSU9OX0hBTkRTSEFLRV9USU1FT1VUX01TLCB2YWxpZGF0ZUdlbmVyYXRpb25IYW5kc2hha2VUaW1lb3V0TXMgfSBmcm9tIFwiLi9nZW5lcmF0aW9uLWhhbmRzaGFrZS10aW1lb3V0LWVycm9yLmpzXCJcblxuY2xhc3MgQmFja2dyb3VuZEpvYlVwZGF0ZUVycm9yIGV4dGVuZHMgRXJyb3Ige31cblxuZXhwb3J0IGRlZmF1bHQgY2xhc3MgQmFja2dyb3VuZEpvYnNTdGF0dXNSZXBvcnRlciB7XG4gIC8qKlxuICAgKiBSdW5zIGNvbnN0cnVjdG9yLlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIE9wdGlvbnMuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vY29uZmlndXJhdGlvbi5qc1wiKS5kZWZhdWx0fSBhcmdzLmNvbmZpZ3VyYXRpb24gLSBDb25maWd1cmF0aW9uLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gW2FyZ3MuaG9zdF0gLSBIb3N0LlxuICAgKiBAcGFyYW0ge251bWJlcn0gW2FyZ3MucG9ydF0gLSBQb3J0LlxuICAgKiBAcGFyYW0ge251bWJlcn0gW2FyZ3MuYXR0ZW1wdFRpbWVvdXRNc10gLSBQZXItYXR0ZW1wdCBzb2NrZXQtcmVxdWVzdCB0aW1lb3V0IGluIG1pbGxpc2Vjb25kcyAoZGVmYXVsdDogNTAwMCkuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBbYXJncy5nZW5lcmF0aW9uSWRdIC0gRXhwbGljaXQgcmVsZWFzZSBnZW5lcmF0aW9uIGlkZW50aXR5LlxuICAgKiBAcGFyYW0ge251bWJlcn0gW2FyZ3MuZ2VuZXJhdGlvbkhhbmRzaGFrZVRpbWVvdXRNc10gLSBNYXhpbXVtIHRpbWUgdG8gd2FpdCBmb3IgZ2VuZXJhdGlvbiBhY2tub3dsZWRnZW1lbnQgKGRlZmF1bHQ6IDQwMDApLlxuICAgKi9cbiAgY29uc3RydWN0b3Ioe2NvbmZpZ3VyYXRpb24sIGhvc3QsIHBvcnQsIGF0dGVtcHRUaW1lb3V0TXMgPSA1MDAwLCBnZW5lcmF0aW9uSGFuZHNoYWtlVGltZW91dE1zID0gREVGQVVMVF9HRU5FUkFUSU9OX0hBTkRTSEFLRV9USU1FT1VUX01TLCBnZW5lcmF0aW9uSWR9KSB7XG4gICAgdGhpcy5jb25maWd1cmF0aW9uID0gY29uZmlndXJhdGlvblxuICAgIHRoaXMuaG9zdCA9IGhvc3RcbiAgICB0aGlzLnBvcnQgPSBwb3J0XG4gICAgdGhpcy5hdHRlbXB0VGltZW91dE1zID0gYXR0ZW1wdFRpbWVvdXRNc1xuICAgIHRoaXMuZ2VuZXJhdGlvbkhhbmRzaGFrZVRpbWVvdXRNcyA9IHZhbGlkYXRlR2VuZXJhdGlvbkhhbmRzaGFrZVRpbWVvdXRNcyhnZW5lcmF0aW9uSGFuZHNoYWtlVGltZW91dE1zKVxuICAgIHRoaXMuZXhwbGljaXRHZW5lcmF0aW9uSWQgPSBnZW5lcmF0aW9uSWRcbiAgICAvKipcbiAgICAgKiBJbnRlcm5hbCB0ZXN0LW9ubHkgb2JzZXJ2YWJpbGl0eSBzdGF0ZSDigJQgTk9UIHB1YmxpYyBBUEkuIFJlZmVyZW5jZXMgdGhlIG1vc3RcbiAgICAgKiByZWNlbnQgc29ja2V0IHJlcXVlc3Qgc28gdGhlIHRpbWVvdXQgc3BlYyBjYW4gaW5zcGVjdCBob3cgaXRzIHNvY2tldCB3YXMgdG9yblxuICAgICAqIGRvd24uIERvIG5vdCBleHBvc2Ugb3IgZGVwZW5kIG9uIHRoaXMgb3V0c2lkZSB0ZXN0cy5cbiAgICAgKiBAdHlwZSB7QmFja2dyb3VuZEpvYnNTb2NrZXRSZXF1ZXN0IHwgdW5kZWZpbmVkfVxuICAgICAqL1xuICAgIHRoaXMuX2xhc3RSZXF1ZXN0ID0gdW5kZWZpbmVkXG4gICAgdGhpcy5sb2dnZXIgPSBuZXcgTG9nZ2VyKHRoaXMpXG4gIH1cblxuICAvKipcbiAgICogUnVucyByZXBvcnQuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gT3B0aW9ucy5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGFyZ3Muam9iSWQgLSBKb2IgaWQuXG4gICAqIEBwYXJhbSB7XCJjb21wbGV0ZWRcIiB8IFwiZmFpbGVkXCIgfCBcInJlc2NoZWR1bGVkXCJ9IGFyZ3Muc3RhdHVzIC0gU3RhdHVzLlxuICAgKiBAcGFyYW0ge251bWJlcn0gW2FyZ3MuZGVsYXlNc10gLSBSZXNjaGVkdWxlIGRlbGF5IGluIG1pbGxpc2Vjb25kcy5cbiAgICogQHBhcmFtIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gW2FyZ3MuZXJyb3JdIC0gRXJyb3IuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBbYXJncy5oYW5kb2ZmSWRdIC0gSGFuZG9mZiBsZWFzZSBpZC5cbiAgICogQHBhcmFtIHtudW1iZXJ9IFthcmdzLmhhbmRlZE9mZkF0TXNdIC0gSGFuZGVkIG9mZiB0aW1lc3RhbXAuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBbYXJncy53b3JrZXJJZF0gLSBXb3JrZXIgaWQuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIHdoZW4gcmVwb3J0ZWQuXG4gICAqL1xuICBhc3luYyByZXBvcnQoe2pvYklkLCBzdGF0dXMsIGRlbGF5TXMsIGVycm9yLCBoYW5kb2ZmSWQsIGhhbmRlZE9mZkF0TXMsIHdvcmtlcklkfSkge1xuICAgIGNvbnN0IGNvbmZpZyA9IHRoaXMuY29uZmlndXJhdGlvbi5nZXRCYWNrZ3JvdW5kSm9ic0NvbmZpZygpXG4gICAgY29uc3QgaG9zdCA9IHRoaXMuaG9zdCB8fCBjb25maWcuaG9zdFxuICAgIGNvbnN0IHBvcnQgPSB0eXBlb2YgdGhpcy5wb3J0ID09PSBcIm51bWJlclwiID8gdGhpcy5wb3J0IDogY29uZmlnLnBvcnRcbiAgICBjb25zdCB7Z2VuZXJhdGlvbklkfSA9IHRoaXMuY29uZmlndXJhdGlvbi5yZXNvbHZlQmFja2dyb3VuZEpvYnNHZW5lcmF0aW9uQ29uZmlnKHtcbiAgICAgIGdlbmVyYXRpb25JZDogdGhpcy5leHBsaWNpdEdlbmVyYXRpb25JZCxcbiAgICAgIHNvdXJjZU5hbWU6IFwiQmFja2dyb3VuZEpvYnNTdGF0dXNSZXBvcnRlclwiXG4gICAgfSlcblxuICAgIGF3YWl0IHRpbWVvdXQoe3RpbWVvdXQ6IHRoaXMuYXR0ZW1wdFRpbWVvdXRNc30sIGFzeW5jICh7Y29udHJvbH0pID0+IHtcbiAgICAgIGNvbnN0IHJlcXVlc3QgPSBuZXcgQmFja2dyb3VuZEpvYnNTb2NrZXRSZXF1ZXN0KHtob3N0LCBwb3J0LCByb2xlOiBcInJlcG9ydGVyXCIsIGdlbmVyYXRpb25IYW5kc2hha2VUaW1lb3V0TXM6IHRoaXMuZ2VuZXJhdGlvbkhhbmRzaGFrZVRpbWVvdXRNcywgZ2VuZXJhdGlvbklkfSlcblxuICAgICAgdGhpcy5fbGFzdFJlcXVlc3QgPSByZXF1ZXN0XG5cbiAgICAgIGF3YWl0IHJlcXVlc3QucnVuKHtcbiAgICAgICAgc2lnbmFsOiBjb250cm9sLnNpZ25hbCxcbiAgICAgICAgb25Db25uZWN0OiAoanNvblNvY2tldCkgPT4ge1xuICAgICAgICAgIGpzb25Tb2NrZXQuc2VuZCh7XG4gICAgICAgICAgICB0eXBlOiBzdGF0dXMgPT09IFwiY29tcGxldGVkXCIgPyBcImpvYi1jb21wbGV0ZVwiIDogc3RhdHVzID09PSBcInJlc2NoZWR1bGVkXCIgPyBcImpvYi1yZXNjaGVkdWxlXCIgOiBcImpvYi1mYWlsZWRcIixcbiAgICAgICAgICAgIGpvYklkLFxuICAgICAgICAgICAgZGVsYXlNcyxcbiAgICAgICAgICAgIGhhbmRvZmZJZCxcbiAgICAgICAgICAgIHdvcmtlcklkLFxuICAgICAgICAgICAgaGFuZGVkT2ZmQXRNcyxcbiAgICAgICAgICAgIGVycm9yOiBlcnJvciA/IG5vcm1hbGl6ZUJhY2tncm91bmRKb2JFcnJvcihlcnJvcikgOiB1bmRlZmluZWRcbiAgICAgICAgICB9KVxuICAgICAgICB9LFxuICAgICAgICBvbk1lc3NhZ2U6ICh7bWVzc2FnZSwgcmVzb2x2ZSwgcmVqZWN0fSkgPT4ge1xuICAgICAgICAgIGlmIChtZXNzYWdlPy50eXBlID09PSBcImpvYi11cGRhdGVkXCIgJiYgbWVzc2FnZS5qb2JJZCA9PT0gam9iSWQpIHtcbiAgICAgICAgICAgIHJlc29sdmUodW5kZWZpbmVkKVxuICAgICAgICAgICAgcmV0dXJuXG4gICAgICAgICAgfVxuXG4gICAgICAgICAgaWYgKG1lc3NhZ2U/LnR5cGUgPT09IFwiam9iLXVwZGF0ZS1lcnJvclwiICYmIG1lc3NhZ2Uuam9iSWQgPT09IGpvYklkKSB7XG4gICAgICAgICAgICByZWplY3QobmV3IEJhY2tncm91bmRKb2JVcGRhdGVFcnJvcihtZXNzYWdlLmVycm9yIHx8IFwiSm9iIHVwZGF0ZSBmYWlsZWRcIikpXG4gICAgICAgICAgfVxuICAgICAgICB9XG4gICAgICB9KVxuICAgIH0pXG4gIH1cblxuICAvKipcbiAgICogUnVucyByZXBvcnQgd2l0aCByZXRyeS5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBPcHRpb25zLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gYXJncy5qb2JJZCAtIEpvYiBpZC5cbiAgICogQHBhcmFtIHtcImNvbXBsZXRlZFwiIHwgXCJmYWlsZWRcIiB8IFwicmVzY2hlZHVsZWRcIn0gYXJncy5zdGF0dXMgLSBTdGF0dXMuXG4gICAqIEBwYXJhbSB7bnVtYmVyfSBbYXJncy5kZWxheU1zXSAtIFJlc2NoZWR1bGUgZGVsYXkgaW4gbWlsbGlzZWNvbmRzLlxuICAgKiBAcGFyYW0ge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSBbYXJncy5lcnJvcl0gLSBFcnJvci5cbiAgICogQHBhcmFtIHtzdHJpbmd9IFthcmdzLmhhbmRvZmZJZF0gLSBIYW5kb2ZmIGxlYXNlIGlkLlxuICAgKiBAcGFyYW0ge251bWJlcn0gW2FyZ3MuaGFuZGVkT2ZmQXRNc10gLSBIYW5kZWQgb2ZmIHRpbWVzdGFtcC5cbiAgICogQHBhcmFtIHtzdHJpbmd9IFthcmdzLndvcmtlcklkXSAtIFdvcmtlciBpZC5cbiAgICogQHBhcmFtIHtudW1iZXJ9IFthcmdzLm1heER1cmF0aW9uTXNdIC0gTWF4IGR1cmF0aW9uIGZvciByZXRyaWVzLlxuICAgKiBAcGFyYW0ge2Jvb2xlYW59IFthcmdzLnJldHJ5UGVyc2lzdEVycm9yc10gLSBSZXRyeSBhIGBCYWNrZ3JvdW5kSm9iVXBkYXRlRXJyb3JgIChtYWluJ3MgYGpvYi11cGRhdGUtZXJyb3JgLCBpLmUuIGEgdHJhbnNpZW50IERCIGZhaWx1cmUgd2hpbGUgcGVyc2lzdGluZyB0aGUgdGVybWluYWwgc3RhdHVzKSBpbnN0ZWFkIG9mIHRocm93aW5nIGltbWVkaWF0ZWx5LiBPZmYgYnkgZGVmYXVsdCBzbyBzaG9ydC1saXZlZCBmb3JrZWQvc3Bhd25lZCBydW5uZXJzIGtlZXAgZmFpbGluZyBsb3VkbHkgYW5kIGV4aXQgbm9uLXplcm8gdG8gYmUgcmVjbGFpbWVkOyBvbiBmb3IgdGhlIGxvbmctbGl2ZWQgd29ya2VyLCB3aGljaCBjYW5ub3QgZXhpdC10by1yZWNsYWltIGFuZCB3b3VsZCBvdGhlcndpc2Ugc3RyYW5kIHRoZSBqb2IgaW4gYGhhbmRlZF9vZmZgLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyB3aGVuIHJlcG9ydGVkLlxuICAgKi9cbiAgYXN5bmMgcmVwb3J0V2l0aFJldHJ5KHtqb2JJZCwgc3RhdHVzLCBkZWxheU1zLCBlcnJvciwgaGFuZG9mZklkLCBoYW5kZWRPZmZBdE1zLCB3b3JrZXJJZCwgbWF4RHVyYXRpb25NcywgcmV0cnlQZXJzaXN0RXJyb3JzID0gZmFsc2V9KSB7XG4gICAgbGV0IGF0dGVtcHQgPSAwXG4gICAgY29uc3Qgc3RhcnRUaW1lID0gRGF0ZS5ub3coKVxuXG4gICAgd2hpbGUgKHRydWUpIHtcbiAgICAgIHRyeSB7XG4gICAgICAgIGF3YWl0IHRoaXMucmVwb3J0KHtqb2JJZCwgc3RhdHVzLCBkZWxheU1zLCBlcnJvciwgaGFuZG9mZklkLCBoYW5kZWRPZmZBdE1zLCB3b3JrZXJJZH0pXG4gICAgICAgIHJldHVyblxuICAgICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgICAgLy8gQSBgQmFja2dyb3VuZEpvYlVwZGF0ZUVycm9yYCBtZWFucyBtYWluIGFuc3dlcmVkIGBqb2ItdXBkYXRlLWVycm9yYCwgd2hpY2ggaXRcbiAgICAgICAgLy8gb25seSBzZW5kcyB3aGVuIGBzdG9yZS5tYXJrQ29tcGxldGVkYC9gbWFya0ZhaWxlZGAgVEhST1dTIOKAlCBhIHRyYW5zaWVudCBEQlxuICAgICAgICAvLyBmYWlsdXJlIChkZWFkbG9jaywgY29ubmVjdGlvbiByZXNldCwgbG9jay13YWl0IHRpbWVvdXQsIG9yIG1haW4ncyBjb2xkXG4gICAgICAgIC8vIGNvbm5lY3Rpb24gcG9vbCByaWdodCBhZnRlciBhIGRlcGxveSByZXN0YXJ0KS4gRXZlcnkgbG9naWNhbCByZWplY3Rpb24gKGpvYlxuICAgICAgICAvLyBnb25lLCBzdGFsZSBoYW5kb2ZmIGxlYXNlLCBhbHJlYWR5IHRlcm1pbmFsKSBpbnN0ZWFkIGFuc3dlcnMgYGpvYi11cGRhdGVkYCxcbiAgICAgICAgLy8gc28gYW4gdXBkYXRlIGVycm9yIGlzIGFsd2F5cyB0aGUgdHJhbnNpZW50LCByZXRyeWFibGUga2luZC4gSXQgaXMgcmV0cmllZFxuICAgICAgICAvLyBvbmx5IGZvciB0aGUgbG9uZy1saXZlZCB3b3JrZXIgKGByZXRyeVBlcnNpc3RFcnJvcnNgKSwgd2hpY2ggY2Fubm90IGV4aXQgdG9cbiAgICAgICAgLy8gdHJpZ2dlciBvcnBoYW4gcmVjbGFpbSBhbmQgd291bGQgb3RoZXJ3aXNlIGRyb3AgdGhlIGNvbXBsZXRpb24gYW5kIHN0cmFuZCB0aGVcbiAgICAgICAgLy8gcm93IGluIGBoYW5kZWRfb2ZmYCBmb3JldmVyIOKAlCBmYXRhbCBmb3IgYSBgbWF4X2NvbmN1cnJlbmN5OiAxYCBqb2Igc3VjaCBhcyBhXG4gICAgICAgIC8vIGJ1aWxkL3F1ZXVlIHBsYW5uZXIsIHdob3NlIHNpbmdsZSBzdHJhbmRlZCByb3cgYmxvY2tzIGV2ZXJ5IGZ1dHVyZSBydW4uXG4gICAgICAgIC8vIEZvcmtlZC9zcGF3bmVkIHJ1bm5lcnMga2VlcCB0aHJvd2luZyBpdCBzbyB0aGV5IGV4aXQgbm9uLXplcm8gYW5kIGFyZVxuICAgICAgICAvLyByZWNsYWltZWQgaW5zdGVhZC4gQm91bmRlZCBieSBgbWF4RHVyYXRpb25Nc2AgZWl0aGVyIHdheS5cbiAgICAgICAgaWYgKGVycm9yIGluc3RhbmNlb2YgQmFja2dyb3VuZEpvYlVwZGF0ZUVycm9yICYmICFyZXRyeVBlcnNpc3RFcnJvcnMpIHRocm93IGVycm9yXG5cbiAgICAgICAgYXR0ZW1wdCArPSAxXG4gICAgICAgIGNvbnN0IGRlbGF5U2Vjb25kcyA9IE1hdGgubWluKDMwLCAwLjUgKiBhdHRlbXB0KVxuXG4gICAgICAgIHRoaXMubG9nZ2VyLmRlYnVnKCgpID0+IFtcIkJhY2tncm91bmQgam9iIHN0YXR1cyByZXBvcnQgZmFpbGVkLCByZXRyeWluZ1wiLCBlcnJvcl0pXG5cbiAgICAgICAgaWYgKG1heER1cmF0aW9uTXMgJiYgRGF0ZS5ub3coKSAtIHN0YXJ0VGltZSA+PSBtYXhEdXJhdGlvbk1zKSB7XG4gICAgICAgICAgdGhpcy5sb2dnZXIud2FybigoKSA9PiBbXCJCYWNrZ3JvdW5kIGpvYiBzdGF0dXMgcmVwb3J0IHRpbWVkIG91dCwgZ2l2aW5nIHVwXCIsIGVycm9yXSlcbiAgICAgICAgICB0aHJvdyBlcnJvclxuICAgICAgICB9XG5cbiAgICAgICAgYXdhaXQgd2FpdChkZWxheVNlY29uZHMpXG4gICAgICB9XG4gICAgfVxuICB9XG5cbn1cbiJdfQ==