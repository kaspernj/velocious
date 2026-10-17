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
     * @param {string} [args.runnerHostname] - Hostname of the machine running the pooled child.
     * @returns {Promise<void>} - Resolves when reported.
     */
    async reportChildAccepted({ jobId, handoffId, workerId, handedOffAtMs, receivedAtMs, startedAtMs, childInstanceId, childPid, runnerHostname }) {
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
                        childPid,
                        runnerHostname
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
     * @param {string} [args.runnerHostname] - Hostname of the machine running the pooled child.
     * @param {number} args.maxDurationMs - Max duration for retries.
     * @returns {Promise<void>} - Resolves when reported or the budget elapses.
     */
    async reportChildAcceptedWithRetry({ jobId, handoffId, workerId, handedOffAtMs, receivedAtMs, startedAtMs, childInstanceId, childPid, runnerHostname, maxDurationMs }) {
        let attempt = 0;
        const startTime = Date.now();
        while (true) {
            try {
                await this.reportChildAccepted({ jobId, handoffId, workerId, handedOffAtMs, receivedAtMs, startedAtMs, childInstanceId, childPid, runnerHostname });
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoic3RhdHVzLXJlcG9ydGVyLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiLi4vLi4vLi4vc3JjL2JhY2tncm91bmQtam9icy9zdGF0dXMtcmVwb3J0ZXIuanMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6IkFBQUEsWUFBWTtBQUVaLE9BQU8sT0FBTyxNQUFNLDJCQUEyQixDQUFBO0FBQy9DLE9BQU8sSUFBSSxNQUFNLHdCQUF3QixDQUFBO0FBQ3pDLE9BQU8sTUFBTSxNQUFNLGNBQWMsQ0FBQTtBQUNqQyxPQUFPLDJCQUEyQixNQUFNLHNCQUFzQixDQUFBO0FBQzlELE9BQU8sMkJBQTJCLE1BQU0scUJBQXFCLENBQUE7QUFDN0QsT0FBTyxFQUFFLHVDQUF1QyxFQUFFLG9DQUFvQyxFQUFFLE1BQU0seUNBQXlDLENBQUE7QUFFdkksTUFBTSx3QkFBeUIsU0FBUSxLQUFLO0NBQUc7QUFFL0MsTUFBTSxDQUFDLE9BQU8sT0FBTyw0QkFBNEI7SUFDL0M7Ozs7Ozs7OztPQVNHO0lBQ0gsWUFBWSxFQUFDLGFBQWEsRUFBRSxJQUFJLEVBQUUsSUFBSSxFQUFFLGdCQUFnQixHQUFHLElBQUksRUFBRSw0QkFBNEIsR0FBRyx1Q0FBdUMsRUFBRSxZQUFZLEVBQUM7UUFDcEosSUFBSSxDQUFDLGFBQWEsR0FBRyxhQUFhLENBQUE7UUFDbEMsSUFBSSxDQUFDLElBQUksR0FBRyxJQUFJLENBQUE7UUFDaEIsSUFBSSxDQUFDLElBQUksR0FBRyxJQUFJLENBQUE7UUFDaEIsSUFBSSxDQUFDLGdCQUFnQixHQUFHLGdCQUFnQixDQUFBO1FBQ3hDLElBQUksQ0FBQyw0QkFBNEIsR0FBRyxvQ0FBb0MsQ0FBQyw0QkFBNEIsQ0FBQyxDQUFBO1FBQ3RHLElBQUksQ0FBQyxvQkFBb0IsR0FBRyxZQUFZLENBQUE7UUFDeEM7Ozs7O1dBS0c7UUFDSCxJQUFJLENBQUMsWUFBWSxHQUFHLFNBQVMsQ0FBQTtRQUM3QixJQUFJLENBQUMsTUFBTSxHQUFHLElBQUksTUFBTSxDQUFDLElBQUks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QUM3RSx5RUFBeUU7Z0JBQ3pFLDhFQUE4RTtnQkFDOUUsOEVBQThFO2dCQUM5RSw0RUFBNEU7Z0JBQzVFLDhFQUE4RTtnQkFDOUUsZ0ZBQWdGO2dCQUNoRiwrRUFBK0U7Z0JBQy9FLDBFQUEwRTtnQkFDMUUsd0VBQXdFO2dCQUN4RSw0REFBNEQ7Z0JBQzVELElBQUksS0FBSyxZQUFZLHdCQUF3QixJQUFJLENBQUMsa0JBQWtCO29CQUFFLE1BQU0sS0FBSyxDQUFBO2dCQUVqRixPQUFPLElBQUksQ0FBQyxDQUFBO2dCQUNaLE1BQU0sWUFBWSxHQUFHLElBQUksQ0FBQyxHQUFHLENBQUMsRUFBRSxFQUFFLEdBQUcsR0FBRyxPQUFPLENBQUMsQ0FBQTtnQkFFaEQsSUFBSSxDQUFDLE1BQU0sQ0FBQyxLQUFLLENBQUMsR0FBRyxFQUFFLENBQUMsQ0FBQywrQ0FBK0MsRUFBRSxLQUFLLENBQUMsQ0FBQyxDQUFBO2dCQUVqRixJQUFJLGFBQWEsSUFBSSxJQUFJLENBQUMsR0FBRyxFQUFFLEdBQUcsU0FBUyxJQUFJLGFBQWEsRUFBRSxDQUFDO29CQUM3RCxJQUFJLENBQUMsTUFBTSxDQUFDLElBQUksQ0FBQyxHQUFHLEVBQUUsQ0FBQyxDQUFDLG1EQUFtRCxFQUFFLEtBQUssQ0FBQyxDQUFDLENBQUE7b0JBQ3BGLE1BQU0sS0FBSyxDQUFBO2dCQUNiLENBQUM7Z0JBRUQsTUFBTSxJQUFJLENBQUMsWUFBWSxDQUFDLENBQUE7WUFDMUIsQ0FBQztRQUNILENBQUM7SUFDSCxDQUFDO0NBRUYiLCJzb3VyY2VzQ29udGVudCI6WyIvLyBAdHMtY2hlY2tcblxuaW1wb3J0IHRpbWVvdXQgZnJvbSBcImF3YWl0ZXJ5L2J1aWxkL3RpbWVvdXQuanNcIlxuaW1wb3J0IHdhaXQgZnJvbSBcImF3YWl0ZXJ5L2J1aWxkL3dhaXQuanNcIlxuaW1wb3J0IExvZ2dlciBmcm9tIFwiLi4vbG9nZ2VyLmpzXCJcbmltcG9ydCBub3JtYWxpemVCYWNrZ3JvdW5kSm9iRXJyb3IgZnJvbSBcIi4vbm9ybWFsaXplLWVycm9yLmpzXCJcbmltcG9ydCBCYWNrZ3JvdW5kSm9ic1NvY2tldFJlcXVlc3QgZnJvbSBcIi4vc29ja2V0LXJlcXVlc3QuanNcIlxuaW1wb3J0IHsgREVGQVVMVF9HRU5FUkFUSU9OX0hBTkRTSEFLRV9USU1FT1VUX01TLCB2YWxpZGF0ZUdlbmVyYXRpb25IYW5kc2hha2VUaW1lb3V0TXMgfSBmcm9tIFwiLi9nZW5lcmF0aW9uLWhhbmRzaGFrZS10aW1lb3V0LWVycm9yLmpzXCJcblxuY2xhc3MgQmFja2dyb3VuZEpvYlVwZGF0ZUVycm9yIGV4dGVuZHMgRXJyb3Ige31cblxuZXhwb3J0IGRlZmF1bHQgY2xhc3MgQmFja2dyb3VuZEpvYnNTdGF0dXNSZXBvcnRlciB7XG4gIC8qKlxuICAgKiBSdW5zIGNvbnN0cnVjdG9yLlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIE9wdGlvbnMuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vY29uZmlndXJhdGlvbi5qc1wiKS5kZWZhdWx0fSBhcmdzLmNvbmZpZ3VyYXRpb24gLSBDb25maWd1cmF0aW9uLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gW2FyZ3MuaG9zdF0gLSBIb3N0LlxuICAgKiBAcGFyYW0ge251bWJlcn0gW2FyZ3MucG9ydF0gLSBQb3J0LlxuICAgKiBAcGFyYW0ge251bWJlcn0gW2FyZ3MuYXR0ZW1wdFRpbWVvdXRNc10gLSBQZXItYXR0ZW1wdCBzb2NrZXQtcmVxdWVzdCB0aW1lb3V0IGluIG1pbGxpc2Vjb25kcyAoZGVmYXVsdDogNTAwMCkuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBbYXJncy5nZW5lcmF0aW9uSWRdIC0gRXhwbGljaXQgcmVsZWFzZSBnZW5lcmF0aW9uIGlkZW50aXR5LlxuICAgKiBAcGFyYW0ge251bWJlcn0gW2FyZ3MuZ2VuZXJhdGlvbkhhbmRzaGFrZVRpbWVvdXRNc10gLSBNYXhpbXVtIHRpbWUgdG8gd2FpdCBmb3IgZ2VuZXJhdGlvbiBhY2tub3dsZWRnZW1lbnQgKGRlZmF1bHQ6IDQwMDApLlxuICAgKi9cbiAgY29uc3RydWN0b3Ioe2NvbmZpZ3VyYXRpb24sIGhvc3QsIHBvcnQsIGF0dGVtcHRUaW1lb3V0TXMgPSA1MDAwLCBnZW5lcmF0aW9uSGFuZHNoYWtlVGltZW91dE1zID0gREVGQVVMVF9HRU5FUkFUSU9OX0hBTkRTSEFLRV9USU1FT1VUX01TLCBnZW5lcmF0aW9uSWR9KSB7XG4gICAgdGhpcy5jb25maWd1cmF0aW9uID0gY29uZmlndXJhdGlvblxuICAgIHRoaXMuaG9zdCA9IGhvc3RcbiAgICB0aGlzLnBvcnQgPSBwb3J0XG4gICAgdGhpcy5hdHRlbXB0VGltZW91dE1zID0gYXR0ZW1wdFRpbWVvdXRNc1xuICAgIHRoaXMuZ2VuZXJhdGlvbkhhbmRzaGFrZVRpbWVvdXRNcyA9IHZhbGlkYXRlR2VuZXJhdGlvbkhhbmRzaGFrZVRpbWVvdXRNcyhnZW5lcmF0aW9uSGFuZHNoYWtlVGltZW91dE1zKVxuICAgIHRoaXMuZXhwbGljaXRHZW5lcmF0aW9uSWQgPSBnZW5lcmF0aW9uSWRcbiAgICAvKipcbiAgICAgKiBJbnRlcm5hbCB0ZXN0LW9ubHkgb2JzZXJ2YWJpbGl0eSBzdGF0ZSDigJQgTk9UIHB1YmxpYyBBUEkuIFJlZmVyZW5jZXMgdGhlIG1vc3RcbiAgICAgKiByZWNlbnQgc29ja2V0IHJlcXVlc3Qgc28gdGhlIHRpbWVvdXQgc3BlYyBjYW4gaW5zcGVjdCBob3cgaXRzIHNvY2tldCB3YXMgdG9yblxuICAgICAqIGRvd24uIERvIG5vdCBleHBvc2Ugb3IgZGVwZW5kIG9uIHRoaXMgb3V0c2lkZSB0ZXN0cy5cbiAgICAgKiBAdHlwZSB7QmFja2dyb3VuZEpvYnNTb2NrZXRSZXF1ZXN0IHwgdW5kZWZpbmVkfVxuICAgICAqL1xuICAgIHRoaXMuX2xhc3RSZXF1ZXN0ID0gdW5kZWZpbmVkXG4gICAgdGhpcy5sb2dnZXIgPSBuZXcgTG9nZ2VyKHRoaXMpXG4gIH1cblxuICAvKipcbiAgICogUnVucyByZXBvcnQuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gT3B0aW9ucy5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGFyZ3Muam9iSWQgLSBKb2IgaWQuXG4gICAqIEBwYXJhbSB7XCJjb21wbGV0ZWRcIiB8IFwiZmFpbGVkXCIgfCBcInJlc2NoZWR1bGVkXCJ9IGFyZ3Muc3RhdHVzIC0gU3RhdHVzLlxuICAgKiBAcGFyYW0ge251bWJlcn0gW2FyZ3MuZGVsYXlNc10gLSBSZXNjaGVkdWxlIGRlbGF5IGluIG1pbGxpc2Vjb25kcy5cbiAgICogQHBhcmFtIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gW2FyZ3MuZXJyb3JdIC0gRXJyb3IuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBbYXJncy5oYW5kb2ZmSWRdIC0gSGFuZG9mZiBsZWFzZSBpZC5cbiAgICogQHBhcmFtIHtudW1iZXJ9IFthcmdzLmhhbmRlZE9mZkF0TXNdIC0gSGFuZGVkIG9mZiB0aW1lc3RhbXAuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBbYXJncy53b3JrZXJJZF0gLSBXb3JrZXIgaWQuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi90eXBlcy5qc1wiKS5Qb29sZWRSdW5uZXJGYWlsdXJlfSBbYXJncy5ydW5uZXJGYWlsdXJlXSAtIFBvb2xlZC1jaGlsZCBwcm9jZXNzIGZhaWx1cmUgcHJvdmVuYW5jZS5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgd2hlbiByZXBvcnRlZC5cbiAgICovXG4gIGFzeW5jIHJlcG9ydCh7am9iSWQsIHN0YXR1cywgZGVsYXlNcywgZXJyb3IsIGhhbmRvZmZJZCwgaGFuZGVkT2ZmQXRNcywgd29ya2VySWQsIHJ1bm5lckZhaWx1cmV9KSB7XG4gICAgY29uc3QgY29uZmlnID0gdGhpcy5jb25maWd1cmF0aW9uLmdldEJhY2tncm91bmRKb2JzQ29uZmlnKClcbiAgICBjb25zdCBob3N0ID0gdGhpcy5ob3N0IHx8IGNvbmZpZy5ob3N0XG4gICAgY29uc3QgcG9ydCA9IHR5cGVvZiB0aGlzLnBvcnQgPT09IFwibnVtYmVyXCIgPyB0aGlzLnBvcnQgOiBjb25maWcucG9ydFxuICAgIGNvbnN0IHtnZW5lcmF0aW9uSWR9ID0gdGhpcy5jb25maWd1cmF0aW9uLnJlc29sdmVCYWNrZ3JvdW5kSm9ic0dlbmVyYXRpb25Db25maWcoe1xuICAgICAgZ2VuZXJhdGlvbklkOiB0aGlzLmV4cGxpY2l0R2VuZXJhdGlvbklkLFxuICAgICAgc291cmNlTmFtZTogXCJCYWNrZ3JvdW5kSm9ic1N0YXR1c1JlcG9ydGVyXCJcbiAgICB9KVxuXG4gICAgYXdhaXQgdGltZW91dCh7dGltZW91dDogdGhpcy5hdHRlbXB0VGltZW91dE1zfSwgYXN5bmMgKHtjb250cm9sfSkgPT4ge1xuICAgICAgY29uc3QgcmVxdWVzdCA9IG5ldyBCYWNrZ3JvdW5kSm9ic1NvY2tldFJlcXVlc3Qoe2hvc3QsIHBvcnQsIHJvbGU6IFwicmVwb3J0ZXJcIiwgZ2VuZXJhdGlvbkhhbmRzaGFrZVRpbWVvdXRNczogdGhpcy5nZW5lcmF0aW9uSGFuZHNoYWtlVGltZW91dE1zLCBnZW5lcmF0aW9uSWR9KVxuXG4gICAgICB0aGlzLl9sYXN0UmVxdWVzdCA9IHJlcXVlc3RcblxuICAgICAgYXdhaXQgcmVxdWVzdC5ydW4oe1xuICAgICAgICBzaWduYWw6IGNvbnRyb2wuc2lnbmFsLFxuICAgICAgICBvbkNvbm5lY3Q6IChqc29uU29ja2V0KSA9PiB7XG4gICAgICAgICAganNvblNvY2tldC5zZW5kKHtcbiAgICAgICAgICAgIHR5cGU6IHN0YXR1cyA9PT0gXCJjb21wbGV0ZWRcIiA/IFwiam9iLWNvbXBsZXRlXCIgOiBzdGF0dXMgPT09IFwicmVzY2hlZHVsZWRcIiA/IFwiam9iLXJlc2NoZWR1bGVcIiA6IFwiam9iLWZhaWxlZFwiLFxuICAgICAgICAgICAgam9iSWQsXG4gICAgICAgICAgICBkZWxheU1zLFxuICAgICAgICAgICAgaGFuZG9mZklkLFxuICAgICAgICAgICAgd29ya2VySWQsXG4gICAgICAgICAgICBoYW5kZWRPZmZBdE1zLFxuICAgICAgICAgICAgZXJyb3I6IGVycm9yID8gbm9ybWFsaXplQmFja2dyb3VuZEpvYkVycm9yKGVycm9yKSA6IHVuZGVmaW5lZCxcbiAgICAgICAgICAgIHJ1bm5lckZhaWx1cmVcbiAgICAgICAgICB9KVxuICAgICAgICB9LFxuICAgICAgICBvbk1lc3NhZ2U6ICh7bWVzc2FnZSwgcmVzb2x2ZSwgcmVqZWN0fSkgPT4ge1xuICAgICAgICAgIGlmIChtZXNzYWdlPy50eXBlID09PSBcImpvYi11cGRhdGVkXCIgJiYgbWVzc2FnZS5qb2JJZCA9PT0gam9iSWQpIHtcbiAgICAgICAgICAgIHJlc29sdmUodW5kZWZpbmVkKVxuICAgICAgICAgICAgcmV0dXJuXG4gICAgICAgICAgfVxuXG4gICAgICAgICAgaWYgKG1lc3NhZ2U/LnR5cGUgPT09IFwiam9iLXVwZGF0ZS1lcnJvclwiICYmIG1lc3NhZ2Uuam9iSWQgPT09IGpvYklkKSB7XG4gICAgICAgICAgICByZWplY3QobmV3IEJhY2tncm91bmRKb2JVcGRhdGVFcnJvcihtZXNzYWdlLmVycm9yIHx8IFwiSm9iIHVwZGF0ZSBmYWlsZWRcIikpXG4gICAgICAgICAgfVxuICAgICAgICB9XG4gICAgICB9KVxuICAgIH0pXG4gIH1cblxuICAvKipcbiAgICogUnVucyByZXBvcnQgY2hpbGQgYWNjZXB0ZWQuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gT3B0aW9ucy5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGFyZ3Muam9iSWQgLSBKb2IgaWQuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBbYXJncy5oYW5kb2ZmSWRdIC0gSGFuZG9mZiBsZWFzZSBpZC5cbiAgICogQHBhcmFtIHtzdHJpbmd9IFthcmdzLndvcmtlcklkXSAtIFdvcmtlciBpZC5cbiAgICogQHBhcmFtIHtudW1iZXJ9IFthcmdzLmhhbmRlZE9mZkF0TXNdIC0gSGFuZGVkIG9mZiB0aW1lc3RhbXAuXG4gICAqIEBwYXJhbSB7bnVtYmVyfSBbYXJncy5yZWNlaXZlZEF0TXNdIC0gRXBvY2ggbXMgdGhlIHJ1bm5lciBjaGlsZCByZWNlaXZlZCB0aGUgam9iLlxuICAgKiBAcGFyYW0ge251bWJlcn0gW2FyZ3Muc3RhcnRlZEF0TXNdIC0gRXBvY2ggbXMgdGhlIGpvYidzIHBlcmZvcm0gc3RhcnRlZCBpbiB0aGUgY2hpbGQuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBbYXJncy5jaGlsZEluc3RhbmNlSWRdIC0gU3RhYmxlIHBvb2xlZCBjaGlsZCBpZGVudGl0eS5cbiAgICogQHBhcmFtIHtudW1iZXJ9IFthcmdzLmNoaWxkUGlkXSAtIFBvb2xlZCBjaGlsZCBPUyBwaWQuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBbYXJncy5ydW5uZXJIb3N0bmFtZV0gLSBIb3N0bmFtZSBvZiB0aGUgbWFjaGluZSBydW5uaW5nIHRoZSBwb29sZWQgY2hpbGQuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIHdoZW4gcmVwb3J0ZWQuXG4gICAqL1xuICBhc3luYyByZXBvcnRDaGlsZEFjY2VwdGVkKHtqb2JJZCwgaGFuZG9mZklkLCB3b3JrZXJJZCwgaGFuZGVkT2ZmQXRNcywgcmVjZWl2ZWRBdE1zLCBzdGFydGVkQXRNcywgY2hpbGRJbnN0YW5jZUlkLCBjaGlsZFBpZCwgcnVubmVySG9zdG5hbWV9KSB7XG4gICAgY29uc3QgY29uZmlnID0gdGhpcy5jb25maWd1cmF0aW9uLmdldEJhY2tncm91bmRKb2JzQ29uZmlnKClcbiAgICBjb25zdCBob3N0ID0gdGhpcy5ob3N0IHx8IGNvbmZpZy5ob3N0XG4gICAgY29uc3QgcG9ydCA9IHR5cGVvZiB0aGlzLnBvcnQgPT09IFwibnVtYmVyXCIgPyB0aGlzLnBvcnQgOiBjb25maWcucG9ydFxuICAgIGNvbnN0IHtnZW5lcmF0aW9uSWR9ID0gdGhpcy5jb25maWd1cmF0aW9uLnJlc29sdmVCYWNrZ3JvdW5kSm9ic0dlbmVyYXRpb25Db25maWcoe1xuICAgICAgZ2VuZXJhdGlvbklkOiB0aGlzLmV4cGxpY2l0R2VuZXJhdGlvbklkLFxuICAgICAgc291cmNlTmFtZTogXCJCYWNrZ3JvdW5kSm9ic1N0YXR1c1JlcG9ydGVyXCJcbiAgICB9KVxuXG4gICAgYXdhaXQgdGltZW91dCh7dGltZW91dDogdGhpcy5hdHRlbXB0VGltZW91dE1zfSwgYXN5bmMgKHtjb250cm9sfSkgPT4ge1xuICAgICAgY29uc3QgcmVxdWVzdCA9IG5ldyBCYWNrZ3JvdW5kSm9ic1NvY2tldFJlcXVlc3Qoe2hvc3QsIHBvcnQsIHJvbGU6IFwicmVwb3J0ZXJcIiwgZ2VuZXJhdGlvbkhhbmRzaGFrZVRpbWVvdXRNczogdGhpcy5nZW5lcmF0aW9uSGFuZHNoYWtlVGltZW91dE1zLCBnZW5lcmF0aW9uSWR9KVxuXG4gICAgICB0aGlzLl9sYXN0UmVxdWVzdCA9IHJlcXVlc3RcblxuICAgICAgYXdhaXQgcmVxdWVzdC5ydW4oe1xuICAgICAgICBzaWduYWw6IGNvbnRyb2wuc2lnbmFsLFxuICAgICAgICBvbkNvbm5lY3Q6IChqc29uU29ja2V0KSA9PiB7XG4gICAgICAgICAganNvblNvY2tldC5zZW5kKHtcbiAgICAgICAgICAgIHR5cGU6IFwiam9iLWFjY2VwdGVkXCIsXG4gICAgICAgICAgICBqb2JJZCxcbiAgICAgICAgICAgIGhhbmRvZmZJZCxcbiAgICAgICAgICAgIHdvcmtlcklkLFxuICAgICAgICAgICAgaGFuZGVkT2ZmQXRNcyxcbiAgICAgICAgICAgIHJlY2VpdmVkQXRNcyxcbiAgICAgICAgICAgIHN0YXJ0ZWRBdE1zLFxuICAgICAgICAgICAgY2hpbGRJbnN0YW5jZUlkLFxuICAgICAgICAgICAgY2hpbGRQaWQsXG4gICAgICAgICAgICBydW5uZXJIb3N0bmFtZVxuICAgICAgICAgIH0pXG4gICAgICAgIH0sXG4gICAgICAgIG9uTWVzc2FnZTogKHttZXNzYWdlLCByZXNvbHZlLCByZWplY3R9KSA9PiB7XG4gICAgICAgICAgaWYgKG1lc3NhZ2U/LnR5cGUgPT09IFwiam9iLXVwZGF0ZWRcIiAmJiBtZXNzYWdlLmpvYklkID09PSBqb2JJZCkge1xuICAgICAgICAgICAgcmVzb2x2ZSh1bmRlZmluZWQpXG4gICAgICAgICAgICByZXR1cm5cbiAgICAgICAgICB9XG5cbiAgICAgICAgICBpZiAobWVzc2FnZT8udHlwZSA9PT0gXCJqb2ItdXBkYXRlLWVycm9yXCIgJiYgbWVzc2FnZS5qb2JJZCA9PT0gam9iSWQpIHtcbiAgICAgICAgICAgIHJlamVjdChuZXcgQmFja2dyb3VuZEpvYlVwZGF0ZUVycm9yKG1lc3NhZ2UuZXJyb3IgfHwgXCJKb2IgdXBkYXRlIGZhaWxlZFwiKSlcbiAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICAgIH0pXG4gICAgfSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHJlcG9ydCBjaGlsZCBhY2NlcHRlZCB3aXRoIHJldHJ5LiBBY2NlcHRhbmNlIGV2aWRlbmNlIGlzIGRpYWdub3N0aWNcbiAgICogcmF0aGVyIHRoYW4gdGVybWluYWwsIHNvIGEgdHJhbnNpZW50IG1haW4vREIgZmFpbHVyZSByZXRyaWVzIG9ubHkgdW50aWxcbiAgICogYG1heER1cmF0aW9uTXNgIGVsYXBzZXMgYW5kIHRoZW4gZ2l2ZXMgdXAgaW5zdGVhZCBvZiBzdHJhbmRpbmcgdGhlIHJlcG9ydC5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBPcHRpb25zLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gYXJncy5qb2JJZCAtIEpvYiBpZC5cbiAgICogQHBhcmFtIHtzdHJpbmd9IFthcmdzLmhhbmRvZmZJZF0gLSBIYW5kb2ZmIGxlYXNlIGlkLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gW2FyZ3Mud29ya2VySWRdIC0gV29ya2VyIGlkLlxuICAgKiBAcGFyYW0ge251bWJlcn0gW2FyZ3MuaGFuZGVkT2ZmQXRNc10gLSBIYW5kZWQgb2ZmIHRpbWVzdGFtcC5cbiAgICogQHBhcmFtIHtudW1iZXJ9IFthcmdzLnJlY2VpdmVkQXRNc10gLSBFcG9jaCBtcyB0aGUgcnVubmVyIGNoaWxkIHJlY2VpdmVkIHRoZSBqb2IuXG4gICAqIEBwYXJhbSB7bnVtYmVyfSBbYXJncy5zdGFydGVkQXRNc10gLSBFcG9jaCBtcyB0aGUgam9iJ3MgcGVyZm9ybSBzdGFydGVkIGluIHRoZSBjaGlsZC5cbiAgICogQHBhcmFtIHtzdHJpbmd9IFthcmdzLmNoaWxkSW5zdGFuY2VJZF0gLSBTdGFibGUgcG9vbGVkIGNoaWxkIGlkZW50aXR5LlxuICAgKiBAcGFyYW0ge251bWJlcn0gW2FyZ3MuY2hpbGRQaWRdIC0gUG9vbGVkIGNoaWxkIE9TIHBpZC5cbiAgICogQHBhcmFtIHtzdHJpbmd9IFthcmdzLnJ1bm5lckhvc3RuYW1lXSAtIEhvc3RuYW1lIG9mIHRoZSBtYWNoaW5lIHJ1bm5pbmcgdGhlIHBvb2xlZCBjaGlsZC5cbiAgICogQHBhcmFtIHtudW1iZXJ9IGFyZ3MubWF4RHVyYXRpb25NcyAtIE1heCBkdXJhdGlvbiBmb3IgcmV0cmllcy5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgd2hlbiByZXBvcnRlZCBvciB0aGUgYnVkZ2V0IGVsYXBzZXMuXG4gICAqL1xuICBhc3luYyByZXBvcnRDaGlsZEFjY2VwdGVkV2l0aFJldHJ5KHtqb2JJZCwgaGFuZG9mZklkLCB3b3JrZXJJZCwgaGFuZGVkT2ZmQXRNcywgcmVjZWl2ZWRBdE1zLCBzdGFydGVkQXRNcywgY2hpbGRJbnN0YW5jZUlkLCBjaGlsZFBpZCwgcnVubmVySG9zdG5hbWUsIG1heER1cmF0aW9uTXN9KSB7XG4gICAgbGV0IGF0dGVtcHQgPSAwXG4gICAgY29uc3Qgc3RhcnRUaW1lID0gRGF0ZS5ub3coKVxuXG4gICAgd2hpbGUgKHRydWUpIHtcbiAgICAgIHRyeSB7XG4gICAgICAgIGF3YWl0IHRoaXMucmVwb3J0Q2hpbGRBY2NlcHRlZCh7am9iSWQsIGhhbmRvZmZJZCwgd29ya2VySWQsIGhhbmRlZE9mZkF0TXMsIHJlY2VpdmVkQXRNcywgc3RhcnRlZEF0TXMsIGNoaWxkSW5zdGFuY2VJZCwgY2hpbGRQaWQsIHJ1bm5lckhvc3RuYW1lfSlcbiAgICAgICAgcmV0dXJuXG4gICAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgICBhdHRlbXB0ICs9IDFcbiAgICAgICAgY29uc3QgZGVsYXlTZWNvbmRzID0gTWF0aC5taW4oMzAsIDAuNSAqIGF0dGVtcHQpXG5cbiAgICAgICAgdGhpcy5sb2dnZXIuZGVidWcoKCkgPT4gW1wiQmFja2dyb3VuZCBqb2IgY2hpbGQtYWNjZXB0YW5jZSByZXBvcnQgZmFpbGVkLCByZXRyeWluZ1wiLCBlcnJvcl0pXG5cbiAgICAgICAgaWYgKERhdGUubm93KCkgLSBzdGFydFRpbWUgPj0gbWF4RHVyYXRpb25Ncykge1xuICAgICAgICAgIHRoaXMubG9nZ2VyLndhcm4oKCkgPT4gW1wiQmFja2dyb3VuZCBqb2IgY2hpbGQtYWNjZXB0YW5jZSByZXBvcnQgdGltZWQgb3V0LCBnaXZpbmcgdXBcIiwgZXJyb3JdKVxuICAgICAgICAgIHRocm93IGVycm9yXG4gICAgICAgIH1cblxuICAgICAgICBhd2FpdCB3YWl0KGRlbGF5U2Vjb25kcylcbiAgICAgIH1cbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogUnVucyByZXBvcnQgd2l0aCByZXRyeS5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBPcHRpb25zLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gYXJncy5qb2JJZCAtIEpvYiBpZC5cbiAgICogQHBhcmFtIHtcImNvbXBsZXRlZFwiIHwgXCJmYWlsZWRcIiB8IFwicmVzY2hlZHVsZWRcIn0gYXJncy5zdGF0dXMgLSBTdGF0dXMuXG4gICAqIEBwYXJhbSB7bnVtYmVyfSBbYXJncy5kZWxheU1zXSAtIFJlc2NoZWR1bGUgZGVsYXkgaW4gbWlsbGlzZWNvbmRzLlxuICAgKiBAcGFyYW0ge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSBbYXJncy5lcnJvcl0gLSBFcnJvci5cbiAgICogQHBhcmFtIHtzdHJpbmd9IFthcmdzLmhhbmRvZmZJZF0gLSBIYW5kb2ZmIGxlYXNlIGlkLlxuICAgKiBAcGFyYW0ge251bWJlcn0gW2FyZ3MuaGFuZGVkT2ZmQXRNc10gLSBIYW5kZWQgb2ZmIHRpbWVzdGFtcC5cbiAgICogQHBhcmFtIHtzdHJpbmd9IFthcmdzLndvcmtlcklkXSAtIFdvcmtlciBpZC5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL3R5cGVzLmpzXCIpLlBvb2xlZFJ1bm5lckZhaWx1cmV9IFthcmdzLnJ1bm5lckZhaWx1cmVdIC0gUG9vbGVkLWNoaWxkIHByb2Nlc3MgZmFpbHVyZSBwcm92ZW5hbmNlLlxuICAgKiBAcGFyYW0ge251bWJlcn0gW2FyZ3MubWF4RHVyYXRpb25Nc10gLSBNYXggZHVyYXRpb24gZm9yIHJldHJpZXMuXG4gICAqIEBwYXJhbSB7Ym9vbGVhbn0gW2FyZ3MucmV0cnlQZXJzaXN0RXJyb3JzXSAtIFJldHJ5IGEgYEJhY2tncm91bmRKb2JVcGRhdGVFcnJvcmAgKG1haW4ncyBgam9iLXVwZGF0ZS1lcnJvcmAsIGkuZS4gYSB0cmFuc2llbnQgREIgZmFpbHVyZSB3aGlsZSBwZXJzaXN0aW5nIHRoZSB0ZXJtaW5hbCBzdGF0dXMpIGluc3RlYWQgb2YgdGhyb3dpbmcgaW1tZWRpYXRlbHkuIE9mZiBieSBkZWZhdWx0IHNvIHNob3J0LWxpdmVkIGZvcmtlZC9zcGF3bmVkIHJ1bm5lcnMga2VlcCBmYWlsaW5nIGxvdWRseSBhbmQgZXhpdCBub24temVybyB0byBiZSByZWNsYWltZWQ7IG9uIGZvciB0aGUgbG9uZy1saXZlZCB3b3JrZXIsIHdoaWNoIGNhbm5vdCBleGl0IHRvIHRyaWdnZXIgb3JwaGFuIHJlY2xhaW0gYW5kIHdvdWxkIG90aGVyd2lzZSBkcm9wIHRoZSBjb21wbGV0aW9uIGFuZCBzdHJhbmQgdGhlIHJvdyBpbiBgaGFuZGVkX29mZmAuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIHdoZW4gcmVwb3J0ZWQuXG4gICAqL1xuICBhc3luYyByZXBvcnRXaXRoUmV0cnkoe2pvYklkLCBzdGF0dXMsIGRlbGF5TXMsIGVycm9yLCBoYW5kb2ZmSWQsIGhhbmRlZE9mZkF0TXMsIHdvcmtlcklkLCBydW5uZXJGYWlsdXJlLCBtYXhEdXJhdGlvbk1zLCByZXRyeVBlcnNpc3RFcnJvcnMgPSBmYWxzZX0pIHtcbiAgICBsZXQgYXR0ZW1wdCA9IDBcbiAgICBjb25zdCBzdGFydFRpbWUgPSBEYXRlLm5vdygpXG5cbiAgICB3aGlsZSAodHJ1ZSkge1xuICAgICAgdHJ5IHtcbiAgICAgICAgYXdhaXQgdGhpcy5yZXBvcnQoe2pvYklkLCBzdGF0dXMsIGRlbGF5TXMsIGVycm9yLCBoYW5kb2ZmSWQsIGhhbmRlZE9mZkF0TXMsIHdvcmtlcklkLCBydW5uZXJGYWlsdXJlfSlcbiAgICAgICAgcmV0dXJuXG4gICAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgICAvLyBBIGBCYWNrZ3JvdW5kSm9iVXBkYXRlRXJyb3JgIG1lYW5zIG1haW4gYW5zd2VyZWQgYGpvYi11cGRhdGUtZXJyb3JgLCB3aGljaCBpdFxuICAgICAgICAvLyBvbmx5IHNlbmRzIHdoZW4gYHN0b3JlLm1hcmtDb21wbGV0ZWRgL2BtYXJrRmFpbGVkYCBUSFJPV1Mg4oCUIGEgdHJhbnNpZW50IERCXG4gICAgICAgIC8vIGZhaWx1cmUgKGRlYWRsb2NrLCBjb25uZWN0aW9uIHJlc2V0LCBsb2NrLXdhaXQgdGltZW91dCwgb3IgbWFpbidzIGNvbGRcbiAgICAgICAgLy8gY29ubmVjdGlvbiBwb29sIHJpZ2h0IGFmdGVyIGEgZGVwbG95IHJlc3RhcnQpLiBFdmVyeSBsb2dpY2FsIHJlamVjdGlvbiAoam9iXG4gICAgICAgIC8vIGdvbmUsIHN0YWxlIGhhbmRvZmYgbGVhc2UsIGFscmVhZHkgdGVybWluYWwpIGluc3RlYWQgYW5zd2VycyBgam9iLXVwZGF0ZWRgLFxuICAgICAgICAvLyBzbyBhbiB1cGRhdGUgZXJyb3IgaXMgYWx3YXlzIHRoZSB0cmFuc2llbnQsIHJldHJ5YWJsZSBraW5kLiBJdCBpcyByZXRyaWVkXG4gICAgICAgIC8vIG9ubHkgZm9yIHRoZSBsb25nLWxpdmVkIHdvcmtlciAoYHJldHJ5UGVyc2lzdEVycm9yc2ApLCB3aGljaCBjYW5ub3QgZXhpdCB0b1xuICAgICAgICAvLyB0cmlnZ2VyIG9ycGhhbiByZWNsYWltIGFuZCB3b3VsZCBvdGhlcndpc2UgZHJvcCB0aGUgY29tcGxldGlvbiBhbmQgc3RyYW5kIHRoZVxuICAgICAgICAvLyByb3cgaW4gYGhhbmRlZF9vZmZgIGZvcmV2ZXIg4oCUIGZhdGFsIGZvciBhIGBtYXhfY29uY3VycmVuY3k6IDFgIGpvYiBzdWNoIGFzIGFcbiAgICAgICAgLy8gYnVpbGQvcXVldWUgcGxhbm5lciwgd2hvc2Ugc2luZ2xlIHN0cmFuZGVkIHJvdyBibG9ja3MgZXZlcnkgZnV0dXJlIHJ1bi5cbiAgICAgICAgLy8gRm9ya2VkL3NwYXduZWQgcnVubmVycyBrZWVwIHRocm93aW5nIGl0IHNvIHRoZXkgZXhpdCBub24temVybyBhbmQgYXJlXG4gICAgICAgIC8vIHJlY2xhaW1lZCBpbnN0ZWFkLiBCb3VuZGVkIGJ5IGBtYXhEdXJhdGlvbk1zYCBlaXRoZXIgd2F5LlxuICAgICAgICBpZiAoZXJyb3IgaW5zdGFuY2VvZiBCYWNrZ3JvdW5kSm9iVXBkYXRlRXJyb3IgJiYgIXJldHJ5UGVyc2lzdEVycm9ycykgdGhyb3cgZXJyb3JcblxuICAgICAgICBhdHRlbXB0ICs9IDFcbiAgICAgICAgY29uc3QgZGVsYXlTZWNvbmRzID0gTWF0aC5taW4oMzAsIDAuNSAqIGF0dGVtcHQpXG5cbiAgICAgICAgdGhpcy5sb2dnZXIuZGVidWcoKCkgPT4gW1wiQmFja2dyb3VuZCBqb2Igc3RhdHVzIHJlcG9ydCBmYWlsZWQsIHJldHJ5aW5nXCIsIGVycm9yXSlcblxuICAgICAgICBpZiAobWF4RHVyYXRpb25NcyAmJiBEYXRlLm5vdygpIC0gc3RhcnRUaW1lID49IG1heER1cmF0aW9uTXMpIHtcbiAgICAgICAgICB0aGlzLmxvZ2dlci53YXJuKCgpID0+IFtcIkJhY2tncm91bmQgam9iIHN0YXR1cyByZXBvcnQgdGltZWQgb3V0LCBnaXZpbmcgdXBcIiwgZXJyb3JdKVxuICAgICAgICAgIHRocm93IGVycm9yXG4gICAgICAgIH1cblxuICAgICAgICBhd2FpdCB3YWl0KGRlbGF5U2Vjb25kcylcbiAgICAgIH1cbiAgICB9XG4gIH1cblxufVxuIl19