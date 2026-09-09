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
     * @param {import("./types.js").PooledRunnerFailure} [args.runnerFailure] - Pooled-child process failure provenance.
     * @returns {Promise<void>} - Resolves when reported.
     */
    async report({ jobId, status, delayMs, error, handoffId, handedOffAtMs, workerId, runnerFailure }) {
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
                        error: error ? normalizeBackgroundJobError(error) : undefined,
                        runnerFailure
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
     * @param {import("./types.js").PooledRunnerFailure} [args.runnerFailure] - Pooled-child process failure provenance.
     * @param {number} [args.maxDurationMs] - Max duration for retries.
     * @param {boolean} [args.retryPersistErrors] - Retry a `BackgroundJobUpdateError` (main's `job-update-error`, i.e. a transient DB failure while persisting the terminal status) instead of throwing immediately. Off by default so short-lived forked/spawned runners keep failing loudly and exit non-zero to be reclaimed; on for the long-lived worker, which cannot exit-to-reclaim and would otherwise strand the job in `handed_off`.
     * @returns {Promise<void>} - Resolves when reported.
     */
    async reportWithRetry({ jobId, status, delayMs, error, handoffId, handedOffAtMs, workerId, runnerFailure, maxDurationMs, retryPersistErrors = false }) {
        let attempt = 0;
        const startTime = Date.now();
        while (true) {
            try {
                await this.report({ jobId, status, delayMs, error, handoffId, handedOffAtMs, workerId, runnerFailure });
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoic3RhdHVzLXJlcG9ydGVyLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiLi4vLi4vLi4vc3JjL2JhY2tncm91bmQtam9icy9zdGF0dXMtcmVwb3J0ZXIuanMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6IkFBQUEsWUFBWTtBQUVaLE9BQU8sT0FBTyxNQUFNLDJCQUEyQixDQUFBO0FBQy9DLE9BQU8sSUFBSSxNQUFNLHdCQUF3QixDQUFBO0FBQ3pDLE9BQU8sTUFBTSxNQUFNLGNBQWMsQ0FBQTtBQUNqQyxPQUFPLDJCQUEyQixNQUFNLHNCQUFzQixDQUFBO0FBQzlELE9BQU8sMkJBQTJCLE1BQU0scUJBQXFCLENBQUE7QUFDN0QsT0FBTyxFQUFFLHVDQUF1QyxFQUFFLG9DQUFvQyxFQUFFLE1BQU0seUNBQXlDLENBQUE7QUFFdkksTUFBTSx3QkFBeUIsU0FBUSxLQUFLO0NBQUc7QUFFL0MsTUFBTSxDQUFDLE9BQU8sT0FBTyw0QkFBNEI7SUFDL0M7Ozs7Ozs7OztPQVNHO0lBQ0gsWUFBWSxFQUFDLGFBQWEsRUFBRSxJQUFJLEVBQUUsSUFBSSxFQUFFLGdCQUFnQixHQUFHLElBQUksRUFBRSw0QkFBNEIsR0FBRyx1Q0FBdUMsRUFBRSxZQUFZLEVBQUM7UUFDcEosSUFBSSxDQUFDLGFBQWEsR0FBRyxhQUFhLENBQUE7UUFDbEMsSUFBSSxDQUFDLElBQUksR0FBRyxJQUFJLENBQUE7UUFDaEIsSUFBSSxDQUFDLElBQUksR0FBRyxJQUFJLENBQUE7UUFDaEIsSUFBSSxDQUFDLGdCQUFnQixHQUFHLGdCQUFnQixDQUFBO1FBQ3hDLElBQUksQ0FBQyw0QkFBNEIsR0FBRyxvQ0FBb0MsQ0FBQyw0QkFBNEIsQ0FBQyxDQUFBO1FBQ3RHLElBQUksQ0FBQyxvQkFBb0IsR0FBRyxZQUFZLENBQUE7UUFDeEM7Ozs7O1dBS0c7UUFDSCxJQUFJLENBQUMsWUFBWSxHQUFHLFNBQVMsQ0FBQTtRQUM3QixJQUFJLENBQUMsTUFBTSxHQUFHLElBQUksTUFBTSxDQUFDLElBQUks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QkFDYixDQUFDO2dCQUVELE1BQU0sSUFBSSxDQUFDLFlBQVksQ0FBQyxDQUFBO1lBQzFCLENBQUM7UUFDSCxDQUFDO0lBQ0gsQ0FBQztDQUVGIiwic291cmNlc0NvbnRlbnQiOlsiLy8gQHRzLWNoZWNrXG5cbmltcG9ydCB0aW1lb3V0IGZyb20gXCJhd2FpdGVyeS9idWlsZC90aW1lb3V0LmpzXCJcbmltcG9ydCB3YWl0IGZyb20gXCJhd2FpdGVyeS9idWlsZC93YWl0LmpzXCJcbmltcG9ydCBMb2dnZXIgZnJvbSBcIi4uL2xvZ2dlci5qc1wiXG5pbXBvcnQgbm9ybWFsaXplQmFja2dyb3VuZEpvYkVycm9yIGZyb20gXCIuL25vcm1hbGl6ZS1lcnJvci5qc1wiXG5pbXBvcnQgQmFja2dyb3VuZEpvYnNTb2NrZXRSZXF1ZXN0IGZyb20gXCIuL3NvY2tldC1yZXF1ZXN0LmpzXCJcbmltcG9ydCB7IERFRkFVTFRfR0VORVJBVElPTl9IQU5EU0hBS0VfVElNRU9VVF9NUywgdmFsaWRhdGVHZW5lcmF0aW9uSGFuZHNoYWtlVGltZW91dE1zIH0gZnJvbSBcIi4vZ2VuZXJhdGlvbi1oYW5kc2hha2UtdGltZW91dC1lcnJvci5qc1wiXG5cbmNsYXNzIEJhY2tncm91bmRKb2JVcGRhdGVFcnJvciBleHRlbmRzIEVycm9yIHt9XG5cbmV4cG9ydCBkZWZhdWx0IGNsYXNzIEJhY2tncm91bmRKb2JzU3RhdHVzUmVwb3J0ZXIge1xuICAvKipcbiAgICogUnVucyBjb25zdHJ1Y3Rvci5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBPcHRpb25zLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL2NvbmZpZ3VyYXRpb24uanNcIikuZGVmYXVsdH0gYXJncy5jb25maWd1cmF0aW9uIC0gQ29uZmlndXJhdGlvbi5cbiAgICogQHBhcmFtIHtzdHJpbmd9IFthcmdzLmhvc3RdIC0gSG9zdC5cbiAgICogQHBhcmFtIHtudW1iZXJ9IFthcmdzLnBvcnRdIC0gUG9ydC5cbiAgICogQHBhcmFtIHtudW1iZXJ9IFthcmdzLmF0dGVtcHRUaW1lb3V0TXNdIC0gUGVyLWF0dGVtcHQgc29ja2V0LXJlcXVlc3QgdGltZW91dCBpbiBtaWxsaXNlY29uZHMgKGRlZmF1bHQ6IDUwMDApLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gW2FyZ3MuZ2VuZXJhdGlvbklkXSAtIEV4cGxpY2l0IHJlbGVhc2UgZ2VuZXJhdGlvbiBpZGVudGl0eS5cbiAgICogQHBhcmFtIHtudW1iZXJ9IFthcmdzLmdlbmVyYXRpb25IYW5kc2hha2VUaW1lb3V0TXNdIC0gTWF4aW11bSB0aW1lIHRvIHdhaXQgZm9yIGdlbmVyYXRpb24gYWNrbm93bGVkZ2VtZW50IChkZWZhdWx0OiA0MDAwKS5cbiAgICovXG4gIGNvbnN0cnVjdG9yKHtjb25maWd1cmF0aW9uLCBob3N0LCBwb3J0LCBhdHRlbXB0VGltZW91dE1zID0gNTAwMCwgZ2VuZXJhdGlvbkhhbmRzaGFrZVRpbWVvdXRNcyA9IERFRkFVTFRfR0VORVJBVElPTl9IQU5EU0hBS0VfVElNRU9VVF9NUywgZ2VuZXJhdGlvbklkfSkge1xuICAgIHRoaXMuY29uZmlndXJhdGlvbiA9IGNvbmZpZ3VyYXRpb25cbiAgICB0aGlzLmhvc3QgPSBob3N0XG4gICAgdGhpcy5wb3J0ID0gcG9ydFxuICAgIHRoaXMuYXR0ZW1wdFRpbWVvdXRNcyA9IGF0dGVtcHRUaW1lb3V0TXNcbiAgICB0aGlzLmdlbmVyYXRpb25IYW5kc2hha2VUaW1lb3V0TXMgPSB2YWxpZGF0ZUdlbmVyYXRpb25IYW5kc2hha2VUaW1lb3V0TXMoZ2VuZXJhdGlvbkhhbmRzaGFrZVRpbWVvdXRNcylcbiAgICB0aGlzLmV4cGxpY2l0R2VuZXJhdGlvbklkID0gZ2VuZXJhdGlvbklkXG4gICAgLyoqXG4gICAgICogSW50ZXJuYWwgdGVzdC1vbmx5IG9ic2VydmFiaWxpdHkgc3RhdGUg4oCUIE5PVCBwdWJsaWMgQVBJLiBSZWZlcmVuY2VzIHRoZSBtb3N0XG4gICAgICogcmVjZW50IHNvY2tldCByZXF1ZXN0IHNvIHRoZSB0aW1lb3V0IHNwZWMgY2FuIGluc3BlY3QgaG93IGl0cyBzb2NrZXQgd2FzIHRvcm5cbiAgICAgKiBkb3duLiBEbyBub3QgZXhwb3NlIG9yIGRlcGVuZCBvbiB0aGlzIG91dHNpZGUgdGVzdHMuXG4gICAgICogQHR5cGUge0JhY2tncm91bmRKb2JzU29ja2V0UmVxdWVzdCB8IHVuZGVmaW5lZH1cbiAgICAgKi9cbiAgICB0aGlzLl9sYXN0UmVxdWVzdCA9IHVuZGVmaW5lZFxuICAgIHRoaXMubG9nZ2VyID0gbmV3IExvZ2dlcih0aGlzKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgcmVwb3J0LlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIE9wdGlvbnMuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBhcmdzLmpvYklkIC0gSm9iIGlkLlxuICAgKiBAcGFyYW0ge1wiY29tcGxldGVkXCIgfCBcImZhaWxlZFwiIHwgXCJyZXNjaGVkdWxlZFwifSBhcmdzLnN0YXR1cyAtIFN0YXR1cy5cbiAgICogQHBhcmFtIHtudW1iZXJ9IFthcmdzLmRlbGF5TXNdIC0gUmVzY2hlZHVsZSBkZWxheSBpbiBtaWxsaXNlY29uZHMuXG4gICAqIEBwYXJhbSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59IFthcmdzLmVycm9yXSAtIEVycm9yLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gW2FyZ3MuaGFuZG9mZklkXSAtIEhhbmRvZmYgbGVhc2UgaWQuXG4gICAqIEBwYXJhbSB7bnVtYmVyfSBbYXJncy5oYW5kZWRPZmZBdE1zXSAtIEhhbmRlZCBvZmYgdGltZXN0YW1wLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gW2FyZ3Mud29ya2VySWRdIC0gV29ya2VyIGlkLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vdHlwZXMuanNcIikuUG9vbGVkUnVubmVyRmFpbHVyZX0gW2FyZ3MucnVubmVyRmFpbHVyZV0gLSBQb29sZWQtY2hpbGQgcHJvY2VzcyBmYWlsdXJlIHByb3ZlbmFuY2UuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIHdoZW4gcmVwb3J0ZWQuXG4gICAqL1xuICBhc3luYyByZXBvcnQoe2pvYklkLCBzdGF0dXMsIGRlbGF5TXMsIGVycm9yLCBoYW5kb2ZmSWQsIGhhbmRlZE9mZkF0TXMsIHdvcmtlcklkLCBydW5uZXJGYWlsdXJlfSkge1xuICAgIGNvbnN0IGNvbmZpZyA9IHRoaXMuY29uZmlndXJhdGlvbi5nZXRCYWNrZ3JvdW5kSm9ic0NvbmZpZygpXG4gICAgY29uc3QgaG9zdCA9IHRoaXMuaG9zdCB8fCBjb25maWcuaG9zdFxuICAgIGNvbnN0IHBvcnQgPSB0eXBlb2YgdGhpcy5wb3J0ID09PSBcIm51bWJlclwiID8gdGhpcy5wb3J0IDogY29uZmlnLnBvcnRcbiAgICBjb25zdCB7Z2VuZXJhdGlvbklkfSA9IHRoaXMuY29uZmlndXJhdGlvbi5yZXNvbHZlQmFja2dyb3VuZEpvYnNHZW5lcmF0aW9uQ29uZmlnKHtcbiAgICAgIGdlbmVyYXRpb25JZDogdGhpcy5leHBsaWNpdEdlbmVyYXRpb25JZCxcbiAgICAgIHNvdXJjZU5hbWU6IFwiQmFja2dyb3VuZEpvYnNTdGF0dXNSZXBvcnRlclwiXG4gICAgfSlcblxuICAgIGF3YWl0IHRpbWVvdXQoe3RpbWVvdXQ6IHRoaXMuYXR0ZW1wdFRpbWVvdXRNc30sIGFzeW5jICh7Y29udHJvbH0pID0+IHtcbiAgICAgIGNvbnN0IHJlcXVlc3QgPSBuZXcgQmFja2dyb3VuZEpvYnNTb2NrZXRSZXF1ZXN0KHtob3N0LCBwb3J0LCByb2xlOiBcInJlcG9ydGVyXCIsIGdlbmVyYXRpb25IYW5kc2hha2VUaW1lb3V0TXM6IHRoaXMuZ2VuZXJhdGlvbkhhbmRzaGFrZVRpbWVvdXRNcywgZ2VuZXJhdGlvbklkfSlcblxuICAgICAgdGhpcy5fbGFzdFJlcXVlc3QgPSByZXF1ZXN0XG5cbiAgICAgIGF3YWl0IHJlcXVlc3QucnVuKHtcbiAgICAgICAgc2lnbmFsOiBjb250cm9sLnNpZ25hbCxcbiAgICAgICAgb25Db25uZWN0OiAoanNvblNvY2tldCkgPT4ge1xuICAgICAgICAgIGpzb25Tb2NrZXQuc2VuZCh7XG4gICAgICAgICAgICB0eXBlOiBzdGF0dXMgPT09IFwiY29tcGxldGVkXCIgPyBcImpvYi1jb21wbGV0ZVwiIDogc3RhdHVzID09PSBcInJlc2NoZWR1bGVkXCIgPyBcImpvYi1yZXNjaGVkdWxlXCIgOiBcImpvYi1mYWlsZWRcIixcbiAgICAgICAgICAgIGpvYklkLFxuICAgICAgICAgICAgZGVsYXlNcyxcbiAgICAgICAgICAgIGhhbmRvZmZJZCxcbiAgICAgICAgICAgIHdvcmtlcklkLFxuICAgICAgICAgICAgaGFuZGVkT2ZmQXRNcyxcbiAgICAgICAgICAgIGVycm9yOiBlcnJvciA/IG5vcm1hbGl6ZUJhY2tncm91bmRKb2JFcnJvcihlcnJvcikgOiB1bmRlZmluZWQsXG4gICAgICAgICAgICBydW5uZXJGYWlsdXJlXG4gICAgICAgICAgfSlcbiAgICAgICAgfSxcbiAgICAgICAgb25NZXNzYWdlOiAoe21lc3NhZ2UsIHJlc29sdmUsIHJlamVjdH0pID0+IHtcbiAgICAgICAgICBpZiAobWVzc2FnZT8udHlwZSA9PT0gXCJqb2ItdXBkYXRlZFwiICYmIG1lc3NhZ2Uuam9iSWQgPT09IGpvYklkKSB7XG4gICAgICAgICAgICByZXNvbHZlKHVuZGVmaW5lZClcbiAgICAgICAgICAgIHJldHVyblxuICAgICAgICAgIH1cblxuICAgICAgICAgIGlmIChtZXNzYWdlPy50eXBlID09PSBcImpvYi11cGRhdGUtZXJyb3JcIiAmJiBtZXNzYWdlLmpvYklkID09PSBqb2JJZCkge1xuICAgICAgICAgICAgcmVqZWN0KG5ldyBCYWNrZ3JvdW5kSm9iVXBkYXRlRXJyb3IobWVzc2FnZS5lcnJvciB8fCBcIkpvYiB1cGRhdGUgZmFpbGVkXCIpKVxuICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgICAgfSlcbiAgICB9KVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgcmVwb3J0IHdpdGggcmV0cnkuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gT3B0aW9ucy5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGFyZ3Muam9iSWQgLSBKb2IgaWQuXG4gICAqIEBwYXJhbSB7XCJjb21wbGV0ZWRcIiB8IFwiZmFpbGVkXCIgfCBcInJlc2NoZWR1bGVkXCJ9IGFyZ3Muc3RhdHVzIC0gU3RhdHVzLlxuICAgKiBAcGFyYW0ge251bWJlcn0gW2FyZ3MuZGVsYXlNc10gLSBSZXNjaGVkdWxlIGRlbGF5IGluIG1pbGxpc2Vjb25kcy5cbiAgICogQHBhcmFtIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gW2FyZ3MuZXJyb3JdIC0gRXJyb3IuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBbYXJncy5oYW5kb2ZmSWRdIC0gSGFuZG9mZiBsZWFzZSBpZC5cbiAgICogQHBhcmFtIHtudW1iZXJ9IFthcmdzLmhhbmRlZE9mZkF0TXNdIC0gSGFuZGVkIG9mZiB0aW1lc3RhbXAuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBbYXJncy53b3JrZXJJZF0gLSBXb3JrZXIgaWQuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi90eXBlcy5qc1wiKS5Qb29sZWRSdW5uZXJGYWlsdXJlfSBbYXJncy5ydW5uZXJGYWlsdXJlXSAtIFBvb2xlZC1jaGlsZCBwcm9jZXNzIGZhaWx1cmUgcHJvdmVuYW5jZS5cbiAgICogQHBhcmFtIHtudW1iZXJ9IFthcmdzLm1heER1cmF0aW9uTXNdIC0gTWF4IGR1cmF0aW9uIGZvciByZXRyaWVzLlxuICAgKiBAcGFyYW0ge2Jvb2xlYW59IFthcmdzLnJldHJ5UGVyc2lzdEVycm9yc10gLSBSZXRyeSBhIGBCYWNrZ3JvdW5kSm9iVXBkYXRlRXJyb3JgIChtYWluJ3MgYGpvYi11cGRhdGUtZXJyb3JgLCBpLmUuIGEgdHJhbnNpZW50IERCIGZhaWx1cmUgd2hpbGUgcGVyc2lzdGluZyB0aGUgdGVybWluYWwgc3RhdHVzKSBpbnN0ZWFkIG9mIHRocm93aW5nIGltbWVkaWF0ZWx5LiBPZmYgYnkgZGVmYXVsdCBzbyBzaG9ydC1saXZlZCBmb3JrZWQvc3Bhd25lZCBydW5uZXJzIGtlZXAgZmFpbGluZyBsb3VkbHkgYW5kIGV4aXQgbm9uLXplcm8gdG8gYmUgcmVjbGFpbWVkOyBvbiBmb3IgdGhlIGxvbmctbGl2ZWQgd29ya2VyLCB3aGljaCBjYW5ub3QgZXhpdC10by1yZWNsYWltIGFuZCB3b3VsZCBvdGhlcndpc2Ugc3RyYW5kIHRoZSBqb2IgaW4gYGhhbmRlZF9vZmZgLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyB3aGVuIHJlcG9ydGVkLlxuICAgKi9cbiAgYXN5bmMgcmVwb3J0V2l0aFJldHJ5KHtqb2JJZCwgc3RhdHVzLCBkZWxheU1zLCBlcnJvciwgaGFuZG9mZklkLCBoYW5kZWRPZmZBdE1zLCB3b3JrZXJJZCwgcnVubmVyRmFpbHVyZSwgbWF4RHVyYXRpb25NcywgcmV0cnlQZXJzaXN0RXJyb3JzID0gZmFsc2V9KSB7XG4gICAgbGV0IGF0dGVtcHQgPSAwXG4gICAgY29uc3Qgc3RhcnRUaW1lID0gRGF0ZS5ub3coKVxuXG4gICAgd2hpbGUgKHRydWUpIHtcbiAgICAgIHRyeSB7XG4gICAgICAgIGF3YWl0IHRoaXMucmVwb3J0KHtqb2JJZCwgc3RhdHVzLCBkZWxheU1zLCBlcnJvciwgaGFuZG9mZklkLCBoYW5kZWRPZmZBdE1zLCB3b3JrZXJJZCwgcnVubmVyRmFpbHVyZX0pXG4gICAgICAgIHJldHVyblxuICAgICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgICAgLy8gQSBgQmFja2dyb3VuZEpvYlVwZGF0ZUVycm9yYCBtZWFucyBtYWluIGFuc3dlcmVkIGBqb2ItdXBkYXRlLWVycm9yYCwgd2hpY2ggaXRcbiAgICAgICAgLy8gb25seSBzZW5kcyB3aGVuIGBzdG9yZS5tYXJrQ29tcGxldGVkYC9gbWFya0ZhaWxlZGAgVEhST1dTIOKAlCBhIHRyYW5zaWVudCBEQlxuICAgICAgICAvLyBmYWlsdXJlIChkZWFkbG9jaywgY29ubmVjdGlvbiByZXNldCwgbG9jay13YWl0IHRpbWVvdXQsIG9yIG1haW4ncyBjb2xkXG4gICAgICAgIC8vIGNvbm5lY3Rpb24gcG9vbCByaWdodCBhZnRlciBhIGRlcGxveSByZXN0YXJ0KS4gRXZlcnkgbG9naWNhbCByZWplY3Rpb24gKGpvYlxuICAgICAgICAvLyBnb25lLCBzdGFsZSBoYW5kb2ZmIGxlYXNlLCBhbHJlYWR5IHRlcm1pbmFsKSBpbnN0ZWFkIGFuc3dlcnMgYGpvYi11cGRhdGVkYCxcbiAgICAgICAgLy8gc28gYW4gdXBkYXRlIGVycm9yIGlzIGFsd2F5cyB0aGUgdHJhbnNpZW50LCByZXRyeWFibGUga2luZC4gSXQgaXMgcmV0cmllZFxuICAgICAgICAvLyBvbmx5IGZvciB0aGUgbG9uZy1saXZlZCB3b3JrZXIgKGByZXRyeVBlcnNpc3RFcnJvcnNgKSwgd2hpY2ggY2Fubm90IGV4aXQgdG9cbiAgICAgICAgLy8gdHJpZ2dlciBvcnBoYW4gcmVjbGFpbSBhbmQgd291bGQgb3RoZXJ3aXNlIGRyb3AgdGhlIGNvbXBsZXRpb24gYW5kIHN0cmFuZCB0aGVcbiAgICAgICAgLy8gcm93IGluIGBoYW5kZWRfb2ZmYCBmb3JldmVyIOKAlCBmYXRhbCBmb3IgYSBgbWF4X2NvbmN1cnJlbmN5OiAxYCBqb2Igc3VjaCBhcyBhXG4gICAgICAgIC8vIGJ1aWxkL3F1ZXVlIHBsYW5uZXIsIHdob3NlIHNpbmdsZSBzdHJhbmRlZCByb3cgYmxvY2tzIGV2ZXJ5IGZ1dHVyZSBydW4uXG4gICAgICAgIC8vIEZvcmtlZC9zcGF3bmVkIHJ1bm5lcnMga2VlcCB0aHJvd2luZyBpdCBzbyB0aGV5IGV4aXQgbm9uLXplcm8gYW5kIGFyZVxuICAgICAgICAvLyByZWNsYWltZWQgaW5zdGVhZC4gQm91bmRlZCBieSBgbWF4RHVyYXRpb25Nc2AgZWl0aGVyIHdheS5cbiAgICAgICAgaWYgKGVycm9yIGluc3RhbmNlb2YgQmFja2dyb3VuZEpvYlVwZGF0ZUVycm9yICYmICFyZXRyeVBlcnNpc3RFcnJvcnMpIHRocm93IGVycm9yXG5cbiAgICAgICAgYXR0ZW1wdCArPSAxXG4gICAgICAgIGNvbnN0IGRlbGF5U2Vjb25kcyA9IE1hdGgubWluKDMwLCAwLjUgKiBhdHRlbXB0KVxuXG4gICAgICAgIHRoaXMubG9nZ2VyLmRlYnVnKCgpID0+IFtcIkJhY2tncm91bmQgam9iIHN0YXR1cyByZXBvcnQgZmFpbGVkLCByZXRyeWluZ1wiLCBlcnJvcl0pXG5cbiAgICAgICAgaWYgKG1heER1cmF0aW9uTXMgJiYgRGF0ZS5ub3coKSAtIHN0YXJ0VGltZSA+PSBtYXhEdXJhdGlvbk1zKSB7XG4gICAgICAgICAgdGhpcy5sb2dnZXIud2FybigoKSA9PiBbXCJCYWNrZ3JvdW5kIGpvYiBzdGF0dXMgcmVwb3J0IHRpbWVkIG91dCwgZ2l2aW5nIHVwXCIsIGVycm9yXSlcbiAgICAgICAgICB0aHJvdyBlcnJvclxuICAgICAgICB9XG5cbiAgICAgICAgYXdhaXQgd2FpdChkZWxheVNlY29uZHMpXG4gICAgICB9XG4gICAgfVxuICB9XG5cbn1cbiJdfQ==