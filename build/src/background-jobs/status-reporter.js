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
     * Runs report child accepted.
     * @param {object} args - Options.
     * @param {string} args.jobId - Job id.
     * @param {string} [args.handoffId] - Handoff lease id.
     * @param {string} [args.workerId] - Worker id.
     * @param {number} [args.handedOffAtMs] - Handed off timestamp.
     * @param {number} [args.receivedAtMs] - Epoch ms the runner child received the job.
     * @param {number} [args.startedAtMs] - Epoch ms the job's perform started in the child.
     * @param {string} [args.childInstanceId] - Stable pooled child identity.
     * @param {number} [args.childPid] - Pooled child OS pid.
     * @returns {Promise<void>} - Resolves when reported.
     */
    async reportChildAccepted({ jobId, handoffId, workerId, handedOffAtMs, receivedAtMs, startedAtMs, childInstanceId, childPid }) {
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
                        type: "job-accepted",
                        jobId,
                        handoffId,
                        workerId,
                        handedOffAtMs,
                        receivedAtMs,
                        startedAtMs,
                        childInstanceId,
                        childPid
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
     * Runs report child accepted with retry. Acceptance evidence is diagnostic
     * rather than terminal, so a transient main/DB failure retries only until
     * `maxDurationMs` elapses and then gives up instead of stranding the report.
     * @param {object} args - Options.
     * @param {string} args.jobId - Job id.
     * @param {string} [args.handoffId] - Handoff lease id.
     * @param {string} [args.workerId] - Worker id.
     * @param {number} [args.handedOffAtMs] - Handed off timestamp.
     * @param {number} [args.receivedAtMs] - Epoch ms the runner child received the job.
     * @param {number} [args.startedAtMs] - Epoch ms the job's perform started in the child.
     * @param {string} [args.childInstanceId] - Stable pooled child identity.
     * @param {number} [args.childPid] - Pooled child OS pid.
     * @param {number} args.maxDurationMs - Max duration for retries.
     * @returns {Promise<void>} - Resolves when reported or the budget elapses.
     */
    async reportChildAcceptedWithRetry({ jobId, handoffId, workerId, handedOffAtMs, receivedAtMs, startedAtMs, childInstanceId, childPid, maxDurationMs }) {
        let attempt = 0;
        const startTime = Date.now();
        while (true) {
            try {
                await this.reportChildAccepted({ jobId, handoffId, workerId, handedOffAtMs, receivedAtMs, startedAtMs, childInstanceId, childPid });
                return;
            }
            catch (error) {
                attempt += 1;
                const delaySeconds = Math.min(30, 0.5 * attempt);
                this.logger.debug(() => ["Background job child-acceptance report failed, retrying", error]);
                if (Date.now() - startTime >= maxDurationMs) {
                    this.logger.warn(() => ["Background job child-acceptance report timed out, giving up", error]);
                    throw error;
                }
                await wait(delaySeconds);
            }
        }
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
     * @param {boolean} [args.retryPersistErrors] - Retry a `BackgroundJobUpdateError` (main's `job-update-error`, i.e. a transient DB failure while persisting the terminal status) instead of throwing immediately. Off by default so short-lived forked/spawned runners keep failing loudly and exit non-zero to be reclaimed; on for the long-lived worker, which cannot exit to trigger orphan reclaim and would otherwise drop the completion and strand the row in `handed_off`.
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoic3RhdHVzLXJlcG9ydGVyLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiLi4vLi4vLi4vc3JjL2JhY2tncm91bmQtam9icy9zdGF0dXMtcmVwb3J0ZXIuanMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6IkFBQUEsWUFBWTtBQUVaLE9BQU8sT0FBTyxNQUFNLDJCQUEyQixDQUFBO0FBQy9DLE9BQU8sSUFBSSxNQUFNLHdCQUF3QixDQUFBO0FBQ3pDLE9BQU8sTUFBTSxNQUFNLGNBQWMsQ0FBQTtBQUNqQyxPQUFPLDJCQUEyQixNQUFNLHNCQUFzQixDQUFBO0FBQzlELE9BQU8sMkJBQTJCLE1BQU0scUJBQXFCLENBQUE7QUFDN0QsT0FBTyxFQUFFLHVDQUF1QyxFQUFFLG9DQUFvQyxFQUFFLE1BQU0seUNBQXlDLENBQUE7QUFFdkksTUFBTSx3QkFBeUIsU0FBUSxLQUFLO0NBQUc7QUFFL0MsTUFBTSxDQUFDLE9BQU8sT0FBTyw0QkFBNEI7SUFDL0M7Ozs7Ozs7OztPQVNHO0lBQ0gsWUFBWSxFQUFDLGFBQWEsRUFBRSxJQUFJLEVBQUUsSUFBSSxFQUFFLGdCQUFnQixHQUFHLElBQUksRUFBRSw0QkFBNEIsR0FBRyx1Q0FBdUMsRUFBRSxZQUFZLEVBQUM7UUFDcEosSUFBSSxDQUFDLGFBQWEsR0FBRyxhQUFhLENBQUE7UUFDbEMsSUFBSSxDQUFDLElBQUksR0FBRyxJQUFJLENBQUE7UUFDaEIsSUFBSSxDQUFDLElBQUksR0FBRyxJQUFJLENBQUE7UUFDaEIsSUFBSSxDQUFDLGdCQUFnQixHQUFHLGdCQUFnQixDQUFBO1FBQ3hDLElBQUksQ0FBQyw0QkFBNEIsR0FBRyxvQ0FBb0MsQ0FBQyw0QkFBNEIsQ0FBQyxDQUFBO1FBQ3RHLElBQUksQ0FBQyxvQkFBb0IsR0FBRyxZQUFZLENBQUE7UUFDeEM7Ozs7O1dBS0c7UUFDSCxJQUFJLENBQUMsWUFBWSxHQUFHLFNBQVMsQ0FBQTtRQUM3QixJQUFJLENBQUMsTUFBTSxHQUFHLElBQUksTUFBTSxDQUFDLElBQUks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OUUsNEVBQTRFO2dCQUM1RSw4RUFBOEU7Z0JBQzlFLGdGQUFnRjtnQkFDaEYsK0VBQStFO2dCQUMvRSwwRUFBMEU7Z0JBQzFFLHdFQUF3RTtnQkFDeEUsNERBQTREO2dCQUM1RCxJQUFJLEtBQUssWUFBWSx3QkFBd0IsSUFBSSxDQUFDLGtCQUFrQjtvQkFBRSxNQUFNLEtBQUssQ0FBQTtnQkFFakYsT0FBTyxJQUFJLENBQUMsQ0FBQTtnQkFDWixNQUFNLFlBQVksR0FBRyxJQUFJLENBQUMsR0FBRyxDQUFDLEVBQUUsRUFBRSxHQUFHLEdBQUcsT0FBTyxDQUFDLENBQUE7Z0JBRWhELElBQUksQ0FBQyxNQUFNLENBQUMsS0FBSyxDQUFDLEdBQUcsRUFBRSxDQUFDLENBQUMsK0NBQStDLEVBQUUsS0FBSyxDQUFDLENBQUMsQ0FBQTtnQkFFakYsSUFBSSxhQUFhLElBQUksSUFBSSxDQUFDLEdBQUcsRUFBRSxHQUFHLFNBQVMsSUFBSSxhQUFhLEVBQUUsQ0FBQztvQkFDN0QsSUFBSSxDQUFDLE1BQU0sQ0FBQyxJQUFJLENBQUMsR0FBRyxFQUFFLENBQUMsQ0FBQyxtREFBbUQsRUFBRSxLQUFLLENBQUMsQ0FBQyxDQUFBO29CQUNwRixNQUFNLEtBQUssQ0FBQTtnQkFDYixDQUFDO2dCQUVELE1BQU0sSUFBSSxDQUFDLFlBQVksQ0FBQyxDQUFBO1lBQzFCLENBQUM7UUFDSCxDQUFDO0lBQ0gsQ0FBQztDQUVGIiwic291cmNlc0NvbnRlbnQiOlsiLy8gQHRzLWNoZWNrXG5cbmltcG9ydCB0aW1lb3V0IGZyb20gXCJhd2FpdGVyeS9idWlsZC90aW1lb3V0LmpzXCJcbmltcG9ydCB3YWl0IGZyb20gXCJhd2FpdGVyeS9idWlsZC93YWl0LmpzXCJcbmltcG9ydCBMb2dnZXIgZnJvbSBcIi4uL2xvZ2dlci5qc1wiXG5pbXBvcnQgbm9ybWFsaXplQmFja2dyb3VuZEpvYkVycm9yIGZyb20gXCIuL25vcm1hbGl6ZS1lcnJvci5qc1wiXG5pbXBvcnQgQmFja2dyb3VuZEpvYnNTb2NrZXRSZXF1ZXN0IGZyb20gXCIuL3NvY2tldC1yZXF1ZXN0LmpzXCJcbmltcG9ydCB7IERFRkFVTFRfR0VORVJBVElPTl9IQU5EU0hBS0VfVElNRU9VVF9NUywgdmFsaWRhdGVHZW5lcmF0aW9uSGFuZHNoYWtlVGltZW91dE1zIH0gZnJvbSBcIi4vZ2VuZXJhdGlvbi1oYW5kc2hha2UtdGltZW91dC1lcnJvci5qc1wiXG5cbmNsYXNzIEJhY2tncm91bmRKb2JVcGRhdGVFcnJvciBleHRlbmRzIEVycm9yIHt9XG5cbmV4cG9ydCBkZWZhdWx0IGNsYXNzIEJhY2tncm91bmRKb2JzU3RhdHVzUmVwb3J0ZXIge1xuICAvKipcbiAgICogUnVucyBjb25zdHJ1Y3Rvci5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBPcHRpb25zLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL2NvbmZpZ3VyYXRpb24uanNcIikuZGVmYXVsdH0gYXJncy5jb25maWd1cmF0aW9uIC0gQ29uZmlndXJhdGlvbi5cbiAgICogQHBhcmFtIHtzdHJpbmd9IFthcmdzLmhvc3RdIC0gSG9zdC5cbiAgICogQHBhcmFtIHtudW1iZXJ9IFthcmdzLnBvcnRdIC0gUG9ydC5cbiAgICogQHBhcmFtIHtudW1iZXJ9IFthcmdzLmF0dGVtcHRUaW1lb3V0TXNdIC0gUGVyLWF0dGVtcHQgc29ja2V0LXJlcXVlc3QgdGltZW91dCBpbiBtaWxsaXNlY29uZHMgKGRlZmF1bHQ6IDUwMDApLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gW2FyZ3MuZ2VuZXJhdGlvbklkXSAtIEV4cGxpY2l0IHJlbGVhc2UgZ2VuZXJhdGlvbiBpZGVudGl0eS5cbiAgICogQHBhcmFtIHtudW1iZXJ9IFthcmdzLmdlbmVyYXRpb25IYW5kc2hha2VUaW1lb3V0TXNdIC0gTWF4aW11bSB0aW1lIHRvIHdhaXQgZm9yIGdlbmVyYXRpb24gYWNrbm93bGVkZ2VtZW50IChkZWZhdWx0OiA0MDAwKS5cbiAgICovXG4gIGNvbnN0cnVjdG9yKHtjb25maWd1cmF0aW9uLCBob3N0LCBwb3J0LCBhdHRlbXB0VGltZW91dE1zID0gNTAwMCwgZ2VuZXJhdGlvbkhhbmRzaGFrZVRpbWVvdXRNcyA9IERFRkFVTFRfR0VORVJBVElPTl9IQU5EU0hBS0VfVElNRU9VVF9NUywgZ2VuZXJhdGlvbklkfSkge1xuICAgIHRoaXMuY29uZmlndXJhdGlvbiA9IGNvbmZpZ3VyYXRpb25cbiAgICB0aGlzLmhvc3QgPSBob3N0XG4gICAgdGhpcy5wb3J0ID0gcG9ydFxuICAgIHRoaXMuYXR0ZW1wdFRpbWVvdXRNcyA9IGF0dGVtcHRUaW1lb3V0TXNcbiAgICB0aGlzLmdlbmVyYXRpb25IYW5kc2hha2VUaW1lb3V0TXMgPSB2YWxpZGF0ZUdlbmVyYXRpb25IYW5kc2hha2VUaW1lb3V0TXMoZ2VuZXJhdGlvbkhhbmRzaGFrZVRpbWVvdXRNcylcbiAgICB0aGlzLmV4cGxpY2l0R2VuZXJhdGlvbklkID0gZ2VuZXJhdGlvbklkXG4gICAgLyoqXG4gICAgICogSW50ZXJuYWwgdGVzdC1vbmx5IG9ic2VydmFiaWxpdHkgc3RhdGUg4oCUIE5PVCBwdWJsaWMgQVBJLiBSZWZlcmVuY2VzIHRoZSBtb3N0XG4gICAgICogcmVjZW50IHNvY2tldCByZXF1ZXN0IHNvIHRoZSB0aW1lb3V0IHNwZWMgY2FuIGluc3BlY3QgaG93IGl0cyBzb2NrZXQgd2FzIHRvcm5cbiAgICAgKiBkb3duLiBEbyBub3QgZXhwb3NlIG9yIGRlcGVuZCBvbiB0aGlzIG91dHNpZGUgdGVzdHMuXG4gICAgICogQHR5cGUge0JhY2tncm91bmRKb2JzU29ja2V0UmVxdWVzdCB8IHVuZGVmaW5lZH1cbiAgICAgKi9cbiAgICB0aGlzLl9sYXN0UmVxdWVzdCA9IHVuZGVmaW5lZFxuICAgIHRoaXMubG9nZ2VyID0gbmV3IExvZ2dlcih0aGlzKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgcmVwb3J0LlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIE9wdGlvbnMuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBhcmdzLmpvYklkIC0gSm9iIGlkLlxuICAgKiBAcGFyYW0ge1wiY29tcGxldGVkXCIgfCBcImZhaWxlZFwiIHwgXCJyZXNjaGVkdWxlZFwifSBhcmdzLnN0YXR1cyAtIFN0YXR1cy5cbiAgICogQHBhcmFtIHtudW1iZXJ9IFthcmdzLmRlbGF5TXNdIC0gUmVzY2hlZHVsZSBkZWxheSBpbiBtaWxsaXNlY29uZHMuXG4gICAqIEBwYXJhbSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59IFthcmdzLmVycm9yXSAtIEVycm9yLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gW2FyZ3MuaGFuZG9mZklkXSAtIEhhbmRvZmYgbGVhc2UgaWQuXG4gICAqIEBwYXJhbSB7bnVtYmVyfSBbYXJncy5oYW5kZWRPZmZBdE1zXSAtIEhhbmRlZCBvZmYgdGltZXN0YW1wLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gW2FyZ3Mud29ya2VySWRdIC0gV29ya2VyIGlkLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vdHlwZXMuanNcIikuUG9vbGVkUnVubmVyRmFpbHVyZX0gW2FyZ3MucnVubmVyRmFpbHVyZV0gLSBQb29sZWQtY2hpbGQgcHJvY2VzcyBmYWlsdXJlIHByb3ZlbmFuY2UuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIHdoZW4gcmVwb3J0ZWQuXG4gICAqL1xuICBhc3luYyByZXBvcnQoe2pvYklkLCBzdGF0dXMsIGRlbGF5TXMsIGVycm9yLCBoYW5kb2ZmSWQsIGhhbmRlZE9mZkF0TXMsIHdvcmtlcklkLCBydW5uZXJGYWlsdXJlfSkge1xuICAgIGNvbnN0IGNvbmZpZyA9IHRoaXMuY29uZmlndXJhdGlvbi5nZXRCYWNrZ3JvdW5kSm9ic0NvbmZpZygpXG4gICAgY29uc3QgaG9zdCA9IHRoaXMuaG9zdCB8fCBjb25maWcuaG9zdFxuICAgIGNvbnN0IHBvcnQgPSB0eXBlb2YgdGhpcy5wb3J0ID09PSBcIm51bWJlclwiID8gdGhpcy5wb3J0IDogY29uZmlnLnBvcnRcbiAgICBjb25zdCB7Z2VuZXJhdGlvbklkfSA9IHRoaXMuY29uZmlndXJhdGlvbi5yZXNvbHZlQmFja2dyb3VuZEpvYnNHZW5lcmF0aW9uQ29uZmlnKHtcbiAgICAgIGdlbmVyYXRpb25JZDogdGhpcy5leHBsaWNpdEdlbmVyYXRpb25JZCxcbiAgICAgIHNvdXJjZU5hbWU6IFwiQmFja2dyb3VuZEpvYnNTdGF0dXNSZXBvcnRlclwiXG4gICAgfSlcblxuICAgIGF3YWl0IHRpbWVvdXQoe3RpbWVvdXQ6IHRoaXMuYXR0ZW1wdFRpbWVvdXRNc30sIGFzeW5jICh7Y29udHJvbH0pID0+IHtcbiAgICAgIGNvbnN0IHJlcXVlc3QgPSBuZXcgQmFja2dyb3VuZEpvYnNTb2NrZXRSZXF1ZXN0KHtob3N0LCBwb3J0LCByb2xlOiBcInJlcG9ydGVyXCIsIGdlbmVyYXRpb25IYW5kc2hha2VUaW1lb3V0TXM6IHRoaXMuZ2VuZXJhdGlvbkhhbmRzaGFrZVRpbWVvdXRNcywgZ2VuZXJhdGlvbklkfSlcblxuICAgICAgdGhpcy5fbGFzdFJlcXVlc3QgPSByZXF1ZXN0XG5cbiAgICAgIGF3YWl0IHJlcXVlc3QucnVuKHtcbiAgICAgICAgc2lnbmFsOiBjb250cm9sLnNpZ25hbCxcbiAgICAgICAgb25Db25uZWN0OiAoanNvblNvY2tldCkgPT4ge1xuICAgICAgICAgIGpzb25Tb2NrZXQuc2VuZCh7XG4gICAgICAgICAgICB0eXBlOiBzdGF0dXMgPT09IFwiY29tcGxldGVkXCIgPyBcImpvYi1jb21wbGV0ZVwiIDogc3RhdHVzID09PSBcInJlc2NoZWR1bGVkXCIgPyBcImpvYi1yZXNjaGVkdWxlXCIgOiBcImpvYi1mYWlsZWRcIixcbiAgICAgICAgICAgIGpvYklkLFxuICAgICAgICAgICAgZGVsYXlNcyxcbiAgICAgICAgICAgIGhhbmRvZmZJZCxcbiAgICAgICAgICAgIHdvcmtlcklkLFxuICAgICAgICAgICAgaGFuZGVkT2ZmQXRNcyxcbiAgICAgICAgICAgIGVycm9yOiBlcnJvciA/IG5vcm1hbGl6ZUJhY2tncm91bmRKb2JFcnJvcihlcnJvcikgOiB1bmRlZmluZWQsXG4gICAgICAgICAgICBydW5uZXJGYWlsdXJlXG4gICAgICAgICAgfSlcbiAgICAgICAgfSxcbiAgICAgICAgb25NZXNzYWdlOiAoe21lc3NhZ2UsIHJlc29sdmUsIHJlamVjdH0pID0+IHtcbiAgICAgICAgICBpZiAobWVzc2FnZT8udHlwZSA9PT0gXCJqb2ItdXBkYXRlZFwiICYmIG1lc3NhZ2Uuam9iSWQgPT09IGpvYklkKSB7XG4gICAgICAgICAgICByZXNvbHZlKHVuZGVmaW5lZClcbiAgICAgICAgICAgIHJldHVyblxuICAgICAgICAgIH1cblxuICAgICAgICAgIGlmIChtZXNzYWdlPy50eXBlID09PSBcImpvYi11cGRhdGUtZXJyb3JcIiAmJiBtZXNzYWdlLmpvYklkID09PSBqb2JJZCkge1xuICAgICAgICAgICAgcmVqZWN0KG5ldyBCYWNrZ3JvdW5kSm9iVXBkYXRlRXJyb3IobWVzc2FnZS5lcnJvciB8fCBcIkpvYiB1cGRhdGUgZmFpbGVkXCIpKVxuICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgICAgfSlcbiAgICB9KVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgcmVwb3J0IGNoaWxkIGFjY2VwdGVkLlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIE9wdGlvbnMuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBhcmdzLmpvYklkIC0gSm9iIGlkLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gW2FyZ3MuaGFuZG9mZklkXSAtIEhhbmRvZmYgbGVhc2UgaWQuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBbYXJncy53b3JrZXJJZF0gLSBXb3JrZXIgaWQuXG4gICAqIEBwYXJhbSB7bnVtYmVyfSBbYXJncy5oYW5kZWRPZmZBdE1zXSAtIEhhbmRlZCBvZmYgdGltZXN0YW1wLlxuICAgKiBAcGFyYW0ge251bWJlcn0gW2FyZ3MucmVjZWl2ZWRBdE1zXSAtIEVwb2NoIG1zIHRoZSBydW5uZXIgY2hpbGQgcmVjZWl2ZWQgdGhlIGpvYi5cbiAgICogQHBhcmFtIHtudW1iZXJ9IFthcmdzLnN0YXJ0ZWRBdE1zXSAtIEVwb2NoIG1zIHRoZSBqb2IncyBwZXJmb3JtIHN0YXJ0ZWQgaW4gdGhlIGNoaWxkLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gW2FyZ3MuY2hpbGRJbnN0YW5jZUlkXSAtIFN0YWJsZSBwb29sZWQgY2hpbGQgaWRlbnRpdHkuXG4gICAqIEBwYXJhbSB7bnVtYmVyfSBbYXJncy5jaGlsZFBpZF0gLSBQb29sZWQgY2hpbGQgT1MgcGlkLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyB3aGVuIHJlcG9ydGVkLlxuICAgKi9cbiAgYXN5bmMgcmVwb3J0Q2hpbGRBY2NlcHRlZCh7am9iSWQsIGhhbmRvZmZJZCwgd29ya2VySWQsIGhhbmRlZE9mZkF0TXMsIHJlY2VpdmVkQXRNcywgc3RhcnRlZEF0TXMsIGNoaWxkSW5zdGFuY2VJZCwgY2hpbGRQaWR9KSB7XG4gICAgY29uc3QgY29uZmlnID0gdGhpcy5jb25maWd1cmF0aW9uLmdldEJhY2tncm91bmRKb2JzQ29uZmlnKClcbiAgICBjb25zdCBob3N0ID0gdGhpcy5ob3N0IHx8IGNvbmZpZy5ob3N0XG4gICAgY29uc3QgcG9ydCA9IHR5cGVvZiB0aGlzLnBvcnQgPT09IFwibnVtYmVyXCIgPyB0aGlzLnBvcnQgOiBjb25maWcucG9ydFxuICAgIGNvbnN0IHtnZW5lcmF0aW9uSWR9ID0gdGhpcy5jb25maWd1cmF0aW9uLnJlc29sdmVCYWNrZ3JvdW5kSm9ic0dlbmVyYXRpb25Db25maWcoe1xuICAgICAgZ2VuZXJhdGlvbklkOiB0aGlzLmV4cGxpY2l0R2VuZXJhdGlvbklkLFxuICAgICAgc291cmNlTmFtZTogXCJCYWNrZ3JvdW5kSm9ic1N0YXR1c1JlcG9ydGVyXCJcbiAgICB9KVxuXG4gICAgYXdhaXQgdGltZW91dCh7dGltZW91dDogdGhpcy5hdHRlbXB0VGltZW91dE1zfSwgYXN5bmMgKHtjb250cm9sfSkgPT4ge1xuICAgICAgY29uc3QgcmVxdWVzdCA9IG5ldyBCYWNrZ3JvdW5kSm9ic1NvY2tldFJlcXVlc3Qoe2hvc3QsIHBvcnQsIHJvbGU6IFwicmVwb3J0ZXJcIiwgZ2VuZXJhdGlvbkhhbmRzaGFrZVRpbWVvdXRNczogdGhpcy5nZW5lcmF0aW9uSGFuZHNoYWtlVGltZW91dE1zLCBnZW5lcmF0aW9uSWR9KVxuXG4gICAgICB0aGlzLl9sYXN0UmVxdWVzdCA9IHJlcXVlc3RcblxuICAgICAgYXdhaXQgcmVxdWVzdC5ydW4oe1xuICAgICAgICBzaWduYWw6IGNvbnRyb2wuc2lnbmFsLFxuICAgICAgICBvbkNvbm5lY3Q6IChqc29uU29ja2V0KSA9PiB7XG4gICAgICAgICAganNvblNvY2tldC5zZW5kKHtcbiAgICAgICAgICAgIHR5cGU6IFwiam9iLWFjY2VwdGVkXCIsXG4gICAgICAgICAgICBqb2JJZCxcbiAgICAgICAgICAgIGhhbmRvZmZJZCxcbiAgICAgICAgICAgIHdvcmtlcklkLFxuICAgICAgICAgICAgaGFuZGVkT2ZmQXRNcyxcbiAgICAgICAgICAgIHJlY2VpdmVkQXRNcyxcbiAgICAgICAgICAgIHN0YXJ0ZWRBdE1zLFxuICAgICAgICAgICAgY2hpbGRJbnN0YW5jZUlkLFxuICAgICAgICAgICAgY2hpbGRQaWRcbiAgICAgICAgICB9KVxuICAgICAgICB9LFxuICAgICAgICBvbk1lc3NhZ2U6ICh7bWVzc2FnZSwgcmVzb2x2ZSwgcmVqZWN0fSkgPT4ge1xuICAgICAgICAgIGlmIChtZXNzYWdlPy50eXBlID09PSBcImpvYi11cGRhdGVkXCIgJiYgbWVzc2FnZS5qb2JJZCA9PT0gam9iSWQpIHtcbiAgICAgICAgICAgIHJlc29sdmUodW5kZWZpbmVkKVxuICAgICAgICAgICAgcmV0dXJuXG4gICAgICAgICAgfVxuXG4gICAgICAgICAgaWYgKG1lc3NhZ2U/LnR5cGUgPT09IFwiam9iLXVwZGF0ZS1lcnJvclwiICYmIG1lc3NhZ2Uuam9iSWQgPT09IGpvYklkKSB7XG4gICAgICAgICAgICByZWplY3QobmV3IEJhY2tncm91bmRKb2JVcGRhdGVFcnJvcihtZXNzYWdlLmVycm9yIHx8IFwiSm9iIHVwZGF0ZSBmYWlsZWRcIikpXG4gICAgICAgICAgfVxuICAgICAgICB9XG4gICAgICB9KVxuICAgIH0pXG4gIH1cblxuICAvKipcbiAgICogUnVucyByZXBvcnQgY2hpbGQgYWNjZXB0ZWQgd2l0aCByZXRyeS4gQWNjZXB0YW5jZSBldmlkZW5jZSBpcyBkaWFnbm9zdGljXG4gICAqIHJhdGhlciB0aGFuIHRlcm1pbmFsLCBzbyBhIHRyYW5zaWVudCBtYWluL0RCIGZhaWx1cmUgcmV0cmllcyBvbmx5IHVudGlsXG4gICAqIGBtYXhEdXJhdGlvbk1zYCBlbGFwc2VzIGFuZCB0aGVuIGdpdmVzIHVwIGluc3RlYWQgb2Ygc3RyYW5kaW5nIHRoZSByZXBvcnQuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gT3B0aW9ucy5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGFyZ3Muam9iSWQgLSBKb2IgaWQuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBbYXJncy5oYW5kb2ZmSWRdIC0gSGFuZG9mZiBsZWFzZSBpZC5cbiAgICogQHBhcmFtIHtzdHJpbmd9IFthcmdzLndvcmtlcklkXSAtIFdvcmtlciBpZC5cbiAgICogQHBhcmFtIHtudW1iZXJ9IFthcmdzLmhhbmRlZE9mZkF0TXNdIC0gSGFuZGVkIG9mZiB0aW1lc3RhbXAuXG4gICAqIEBwYXJhbSB7bnVtYmVyfSBbYXJncy5yZWNlaXZlZEF0TXNdIC0gRXBvY2ggbXMgdGhlIHJ1bm5lciBjaGlsZCByZWNlaXZlZCB0aGUgam9iLlxuICAgKiBAcGFyYW0ge251bWJlcn0gW2FyZ3Muc3RhcnRlZEF0TXNdIC0gRXBvY2ggbXMgdGhlIGpvYidzIHBlcmZvcm0gc3RhcnRlZCBpbiB0aGUgY2hpbGQuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBbYXJncy5jaGlsZEluc3RhbmNlSWRdIC0gU3RhYmxlIHBvb2xlZCBjaGlsZCBpZGVudGl0eS5cbiAgICogQHBhcmFtIHtudW1iZXJ9IFthcmdzLmNoaWxkUGlkXSAtIFBvb2xlZCBjaGlsZCBPUyBwaWQuXG4gICAqIEBwYXJhbSB7bnVtYmVyfSBhcmdzLm1heER1cmF0aW9uTXMgLSBNYXggZHVyYXRpb24gZm9yIHJldHJpZXMuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIHdoZW4gcmVwb3J0ZWQgb3IgdGhlIGJ1ZGdldCBlbGFwc2VzLlxuICAgKi9cbiAgYXN5bmMgcmVwb3J0Q2hpbGRBY2NlcHRlZFdpdGhSZXRyeSh7am9iSWQsIGhhbmRvZmZJZCwgd29ya2VySWQsIGhhbmRlZE9mZkF0TXMsIHJlY2VpdmVkQXRNcywgc3RhcnRlZEF0TXMsIGNoaWxkSW5zdGFuY2VJZCwgY2hpbGRQaWQsIG1heER1cmF0aW9uTXN9KSB7XG4gICAgbGV0IGF0dGVtcHQgPSAwXG4gICAgY29uc3Qgc3RhcnRUaW1lID0gRGF0ZS5ub3coKVxuXG4gICAgd2hpbGUgKHRydWUpIHtcbiAgICAgIHRyeSB7XG4gICAgICAgIGF3YWl0IHRoaXMucmVwb3J0Q2hpbGRBY2NlcHRlZCh7am9iSWQsIGhhbmRvZmZJZCwgd29ya2VySWQsIGhhbmRlZE9mZkF0TXMsIHJlY2VpdmVkQXRNcywgc3RhcnRlZEF0TXMsIGNoaWxkSW5zdGFuY2VJZCwgY2hpbGRQaWR9KVxuICAgICAgICByZXR1cm5cbiAgICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICAgIGF0dGVtcHQgKz0gMVxuICAgICAgICBjb25zdCBkZWxheVNlY29uZHMgPSBNYXRoLm1pbigzMCwgMC41ICogYXR0ZW1wdClcblxuICAgICAgICB0aGlzLmxvZ2dlci5kZWJ1ZygoKSA9PiBbXCJCYWNrZ3JvdW5kIGpvYiBjaGlsZC1hY2NlcHRhbmNlIHJlcG9ydCBmYWlsZWQsIHJldHJ5aW5nXCIsIGVycm9yXSlcblxuICAgICAgICBpZiAoRGF0ZS5ub3coKSAtIHN0YXJ0VGltZSA+PSBtYXhEdXJhdGlvbk1zKSB7XG4gICAgICAgICAgdGhpcy5sb2dnZXIud2FybigoKSA9PiBbXCJCYWNrZ3JvdW5kIGpvYiBjaGlsZC1hY2NlcHRhbmNlIHJlcG9ydCB0aW1lZCBvdXQsIGdpdmluZyB1cFwiLCBlcnJvcl0pXG4gICAgICAgICAgdGhyb3cgZXJyb3JcbiAgICAgICAgfVxuXG4gICAgICAgIGF3YWl0IHdhaXQoZGVsYXlTZWNvbmRzKVxuICAgICAgfVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHJlcG9ydCB3aXRoIHJldHJ5LlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIE9wdGlvbnMuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBhcmdzLmpvYklkIC0gSm9iIGlkLlxuICAgKiBAcGFyYW0ge1wiY29tcGxldGVkXCIgfCBcImZhaWxlZFwiIHwgXCJyZXNjaGVkdWxlZFwifSBhcmdzLnN0YXR1cyAtIFN0YXR1cy5cbiAgICogQHBhcmFtIHtudW1iZXJ9IFthcmdzLmRlbGF5TXNdIC0gUmVzY2hlZHVsZSBkZWxheSBpbiBtaWxsaXNlY29uZHMuXG4gICAqIEBwYXJhbSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59IFthcmdzLmVycm9yXSAtIEVycm9yLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gW2FyZ3MuaGFuZG9mZklkXSAtIEhhbmRvZmYgbGVhc2UgaWQuXG4gICAqIEBwYXJhbSB7bnVtYmVyfSBbYXJncy5oYW5kZWRPZmZBdE1zXSAtIEhhbmRlZCBvZmYgdGltZXN0YW1wLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gW2FyZ3Mud29ya2VySWRdIC0gV29ya2VyIGlkLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vdHlwZXMuanNcIikuUG9vbGVkUnVubmVyRmFpbHVyZX0gW2FyZ3MucnVubmVyRmFpbHVyZV0gLSBQb29sZWQtY2hpbGQgcHJvY2VzcyBmYWlsdXJlIHByb3ZlbmFuY2UuXG4gICAqIEBwYXJhbSB7bnVtYmVyfSBbYXJncy5tYXhEdXJhdGlvbk1zXSAtIE1heCBkdXJhdGlvbiBmb3IgcmV0cmllcy5cbiAgICogQHBhcmFtIHtib29sZWFufSBbYXJncy5yZXRyeVBlcnNpc3RFcnJvcnNdIC0gUmV0cnkgYSBgQmFja2dyb3VuZEpvYlVwZGF0ZUVycm9yYCAobWFpbidzIGBqb2ItdXBkYXRlLWVycm9yYCwgaS5lLiBhIHRyYW5zaWVudCBEQiBmYWlsdXJlIHdoaWxlIHBlcnNpc3RpbmcgdGhlIHRlcm1pbmFsIHN0YXR1cykgaW5zdGVhZCBvZiB0aHJvd2luZyBpbW1lZGlhdGVseS4gT2ZmIGJ5IGRlZmF1bHQgc28gc2hvcnQtbGl2ZWQgZm9ya2VkL3NwYXduZWQgcnVubmVycyBrZWVwIGZhaWxpbmcgbG91ZGx5IGFuZCBleGl0IG5vbi16ZXJvIHRvIGJlIHJlY2xhaW1lZDsgb24gZm9yIHRoZSBsb25nLWxpdmVkIHdvcmtlciwgd2hpY2ggY2Fubm90IGV4aXQgdG8gdHJpZ2dlciBvcnBoYW4gcmVjbGFpbSBhbmQgd291bGQgb3RoZXJ3aXNlIGRyb3AgdGhlIGNvbXBsZXRpb24gYW5kIHN0cmFuZCB0aGUgcm93IGluIGBoYW5kZWRfb2ZmYC5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgd2hlbiByZXBvcnRlZC5cbiAgICovXG4gIGFzeW5jIHJlcG9ydFdpdGhSZXRyeSh7am9iSWQsIHN0YXR1cywgZGVsYXlNcywgZXJyb3IsIGhhbmRvZmZJZCwgaGFuZGVkT2ZmQXRNcywgd29ya2VySWQsIHJ1bm5lckZhaWx1cmUsIG1heER1cmF0aW9uTXMsIHJldHJ5UGVyc2lzdEVycm9ycyA9IGZhbHNlfSkge1xuICAgIGxldCBhdHRlbXB0ID0gMFxuICAgIGNvbnN0IHN0YXJ0VGltZSA9IERhdGUubm93KClcblxuICAgIHdoaWxlICh0cnVlKSB7XG4gICAgICB0cnkge1xuICAgICAgICBhd2FpdCB0aGlzLnJlcG9ydCh7am9iSWQsIHN0YXR1cywgZGVsYXlNcywgZXJyb3IsIGhhbmRvZmZJZCwgaGFuZGVkT2ZmQXRNcywgd29ya2VySWQsIHJ1bm5lckZhaWx1cmV9KVxuICAgICAgICByZXR1cm5cbiAgICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICAgIC8vIEEgYEJhY2tncm91bmRKb2JVcGRhdGVFcnJvcmAgbWVhbnMgbWFpbiBhbnN3ZXJlZCBgam9iLXVwZGF0ZS1lcnJvcmAsIHdoaWNoIGl0XG4gICAgICAgIC8vIG9ubHkgc2VuZHMgd2hlbiBgc3RvcmUubWFya0NvbXBsZXRlZGAvYG1hcmtGYWlsZWRgIFRIUk9XUyDigJQgYSB0cmFuc2llbnQgREJcbiAgICAgICAgLy8gZmFpbHVyZSAoZGVhZGxvY2ssIGNvbm5lY3Rpb24gcmVzZXQsIGxvY2std2FpdCB0aW1lb3V0LCBvciBtYWluJ3MgY29sZFxuICAgICAgICAvLyBjb25uZWN0aW9uIHBvb2wgcmlnaHQgYWZ0ZXIgYSBkZXBsb3kgcmVzdGFydCkuIEV2ZXJ5IGxvZ2ljYWwgcmVqZWN0aW9uIChqb2JcbiAgICAgICAgLy8gZ29uZSwgc3RhbGUgaGFuZG9mZiBsZWFzZSwgYWxyZWFkeSB0ZXJtaW5hbCkgaW5zdGVhZCBhbnN3ZXJzIGBqb2ItdXBkYXRlZGAsXG4gICAgICAgIC8vIHNvIGFuIHVwZGF0ZSBlcnJvciBpcyBhbHdheXMgdGhlIHRyYW5zaWVudCwgcmV0cnlhYmxlIGtpbmQuIEl0IGlzIHJldHJpZWRcbiAgICAgICAgLy8gb25seSBmb3IgdGhlIGxvbmctbGl2ZWQgd29ya2VyIChgcmV0cnlQZXJzaXN0RXJyb3JzYCksIHdoaWNoIGNhbm5vdCBleGl0IHRvXG4gICAgICAgIC8vIHRyaWdnZXIgb3JwaGFuIHJlY2xhaW0gYW5kIHdvdWxkIG90aGVyd2lzZSBkcm9wIHRoZSBjb21wbGV0aW9uIGFuZCBzdHJhbmQgdGhlXG4gICAgICAgIC8vIHJvdyBpbiBgaGFuZGVkX29mZmAgZm9yZXZlciDigJQgZmF0YWwgZm9yIGEgYG1heF9jb25jdXJyZW5jeTogMWAgam9iIHN1Y2ggYXMgYVxuICAgICAgICAvLyBidWlsZC9xdWV1ZSBwbGFubmVyLCB3aG9zZSBzaW5nbGUgc3RyYW5kZWQgcm93IGJsb2NrcyBldmVyeSBmdXR1cmUgcnVuLlxuICAgICAgICAvLyBGb3JrZWQvc3Bhd25lZCBydW5uZXJzIGtlZXAgdGhyb3dpbmcgaXQgc28gdGhleSBleGl0IG5vbi16ZXJvIGFuZCBhcmVcbiAgICAgICAgLy8gcmVjbGFpbWVkIGluc3RlYWQuIEJvdW5kZWQgYnkgYG1heER1cmF0aW9uTXNgIGVpdGhlciB3YXkuXG4gICAgICAgIGlmIChlcnJvciBpbnN0YW5jZW9mIEJhY2tncm91bmRKb2JVcGRhdGVFcnJvciAmJiAhcmV0cnlQZXJzaXN0RXJyb3JzKSB0aHJvdyBlcnJvclxuXG4gICAgICAgIGF0dGVtcHQgKz0gMVxuICAgICAgICBjb25zdCBkZWxheVNlY29uZHMgPSBNYXRoLm1pbigzMCwgMC41ICogYXR0ZW1wdClcblxuICAgICAgICB0aGlzLmxvZ2dlci5kZWJ1ZygoKSA9PiBbXCJCYWNrZ3JvdW5kIGpvYiBzdGF0dXMgcmVwb3J0IGZhaWxlZCwgcmV0cnlpbmdcIiwgZXJyb3JdKVxuXG4gICAgICAgIGlmIChtYXhEdXJhdGlvbk1zICYmIERhdGUubm93KCkgLSBzdGFydFRpbWUgPj0gbWF4RHVyYXRpb25Ncykge1xuICAgICAgICAgIHRoaXMubG9nZ2VyLndhcm4oKCkgPT4gW1wiQmFja2dyb3VuZCBqb2Igc3RhdHVzIHJlcG9ydCB0aW1lZCBvdXQsIGdpdmluZyB1cFwiLCBlcnJvcl0pXG4gICAgICAgICAgdGhyb3cgZXJyb3JcbiAgICAgICAgfVxuXG4gICAgICAgIGF3YWl0IHdhaXQoZGVsYXlTZWNvbmRzKVxuICAgICAgfVxuICAgIH1cbiAgfVxuXG59XG4iXX0=