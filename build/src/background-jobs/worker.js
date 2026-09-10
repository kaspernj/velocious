// @ts-check
import net from "net";
import { fork, spawn } from "node:child_process";
import JsonSocket from "./json-socket.js";
import BackgroundJobRegistry from "./job-registry.js";
import configurationResolver from "../configuration-resolver.js";
import BackgroundJobsStatusReporter from "./status-reporter.js";
import { randomUUID } from "crypto";
import { fileURLToPath } from "node:url";
import shutdownLifecycle, { runShutdownSteps } from "../utils/shutdown-lifecycle.js";
import BackgroundJobRescheduleSignal from "./reschedule-signal.js";
import performBackgroundJob from "./perform-job.js";
import { runWithBackgroundJobPayload } from "./execution-context.js";
import { createGenerationWorkerId } from "./generation-identity.js";
import BackgroundJobsGenerationHandshakeTimeoutError, { DEFAULT_GENERATION_HANDSHAKE_TIMEOUT_MS, validateGenerationHandshakeTimeoutMs } from "./generation-handshake-timeout-error.js";
/**
 * Per-forked-child timeout bookkeeping.
 * @typedef {object} ForkedJobTimeoutState
 * @property {boolean} timedOut - Whether the timeout fired and the child was terminated.
 * @property {number | null} timeoutMs - The armed timeout in ms, or null when disabled.
 * @property {ReturnType<typeof setTimeout> | null} timer - The pending timeout timer, cleared on exit.
 * @property {ReturnType<typeof setTimeout> | null} sigkillTimer - The pending SIGKILL grace timer, cleared on exit.
 */
/**
 * @typedef {object} PooledJobEntry
 * @property {import("./types.js").BackgroundJobPayload & {id: string}} payload - Durable job payload.
 * @property {(value: void) => void} [resolve] - Completion resolver.
 * @property {Promise<void>} [pooledJob] - Tracked pooled-job promise.
 * @property {ReturnType<typeof setTimeout> | null} [timeoutTimer] - Per-job timeout timer.
 */
/**
 * @typedef {object} PooledChildState
 * @property {number} createdAtMs - Child creation timestamp.
 * @property {number} jobsRun - Acknowledged jobs completed by this child.
 * @property {Map<string, PooledJobEntry>} inflight - Jobs currently owned by this child.
 * @property {number} lastDispatchSeq - Round-robin dispatch sequence.
 * @property {boolean} retiring - Whether this child is draining before retirement.
 * @property {boolean} [started] - Whether the child completed its startup handshake.
 * @property {boolean} [settling] - Whether failure handling already owns this child.
 * @property {ReturnType<typeof setTimeout> | null} [timeoutSigkillTimer] - Pending timeout SIGKILL timer.
 * @property {import("./types.js").PooledRunnerTerminationReason} [terminationReason] - Expected termination reason.
 * @property {string} [timeoutJobId] - Job whose timeout initiated termination.
 */
/** Grace period after SIGTERM before a lingering process runner is SIGKILLed. */
const FORKED_CHILD_SIGKILL_GRACE_MS = 5000;
/**
 * Largest delay Node's `setTimeout` accepts without overflowing to a 1ms delay
 * (a 32-bit signed int of ms, ~24.8 days). A `jobTimeoutMs` above this — or a
 * non-finite one like `Infinity` — is clamped/disabled rather than coerced to
 * ~1ms, which would otherwise terminate every forked job almost immediately.
 */
const MAX_FORKED_JOB_TIMEOUT_MS = 2_147_483_647;
const FORKED_RUNNER_ENTRY_PATH = fileURLToPath(new URL("./forked-runner-child.js", import.meta.url));
const POOLED_RUNNER_ENTRY_PATH = fileURLToPath(new URL("./pooled-runner-child.js", import.meta.url));
/** How often the worker sends a liveness heartbeat to the main. */
const HEARTBEAT_INTERVAL_MS = 15000;
/**
 * Max time the worker spends retrying one pooled child's acceptance report
 * before dropping it. Acceptance evidence is diagnostic — a persistent
 * main/DB outage must not hold runner capacity hostage.
 */
const CHILD_ACCEPTANCE_REPORT_MAX_DURATION_MS = 10000;
/** TCP keepalive so a half-open connection to the main surfaces as a close. */
const SOCKET_KEEPALIVE_MS = 10000;
/**
 * Execution modes.
 * @type {import("./types.js").BackgroundJobExecutionMode[]} */
const EXECUTION_MODES = ["inline", "forked", "pooled", "spawned"];
/**
 * Normalizes a candidate pooled-runner count or job limit.
 * @param {number | undefined} value - Candidate positive integer.
 * @returns {number | undefined} - Normalized value.
 */
function positiveInteger(value) {
    return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : undefined;
}
/**
 * Checks whether an IPC value is a pooled child's acceptance observation for
 * one job. The child carries its exact handoff lease so the worker can forward
 * the report without depending on its in-flight entry still existing.
 * @param {ReturnType<typeof JSON.parse>} message - IPC message.
 * @returns {message is {type: "job-received" | "job-started", jobId: string, handoffId?: string, workerId?: string, handedOffAtMs?: number, receivedAtMs?: number, startedAtMs?: number, childInstanceId?: string, childPid?: number}} - Whether this is a valid acceptance message.
 */
function isChildAcceptanceMessage(message) {
    if (!message || typeof message !== "object")
        return false;
    const record = /** @type {Record<string, ReturnType<typeof JSON.parse>>} */ (message);
    return (record.type === "job-received" || record.type === "job-started")
        && typeof record.jobId === "string"
        && (record.handoffId === undefined || typeof record.handoffId === "string")
        && (record.workerId === undefined || typeof record.workerId === "string")
        && (record.handedOffAtMs === undefined || typeof record.handedOffAtMs === "number")
        && (record.receivedAtMs === undefined || typeof record.receivedAtMs === "number")
        && (record.startedAtMs === undefined || typeof record.startedAtMs === "number")
        && (record.childInstanceId === undefined || typeof record.childInstanceId === "string")
        && (record.childPid === undefined || Number.isInteger(record.childPid));
}
/**
 * Normalizes a candidate pooled-runner resource limit.
 * @param {number | undefined} value - Candidate positive number.
 * @returns {number | undefined} - Normalized value.
 */
function positiveNumber(value) {
    return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : undefined;
}
export default class BackgroundJobsWorker {
    /**
     * Runs constructor.
     * @param {object} [args] - Options.
     * @param {import("../configuration.js").default} [args.configuration] - Configuration.
     * @param {string} [args.host] - Hostname.
     * @param {number} [args.port] - Port.
     * @param {string} [args.generationId] - Explicit release generation identity.
     * @param {string} [args.workerInstanceId] - Explicit stable worker UUID.
     * @param {number} [args.maxConcurrentForkedJobs] - Override the process runner concurrency cap from `configuration.getBackgroundJobsConfig()`.
     * @param {number} [args.maxConcurrentInlineJobs] - Override the inline-job concurrency cap from `configuration.getBackgroundJobsConfig()`.
     * @param {number} [args.pooledRunnerCount] - Override the pooled runner count.
     * @param {number} [args.pooledRunnerConcurrency] - Override the per-runner concurrency.
     * @param {number} [args.pooledRunnerMaxJobs] - Override the per-runner recycle job count.
     * @param {number} [args.pooledRunnerMaxRssBytes] - Override the per-runner recycle RSS limit.
     * @param {number} [args.pooledRunnerMaxLifetimeMs] - Override the per-runner recycle lifetime.
     * @param {number} [args.forkedChildSigkillGraceMs] - Override the grace period between SIGTERM and SIGKILL when reaping lingering process runners on stop.
     * @param {number} [args.heartbeatIntervalMs] - Override the liveness heartbeat interval (default 15000ms).
     * @param {number} [args.generationHandshakeTimeoutMs] - Maximum time to wait for generation acknowledgement (default: 4000).
     * @param {number} [args.reconnectDelayMs] - Delay before reconnecting an established worker connection (default: 1000).
     * @param {number} [args.jobTimeoutMs] - Override the wall-clock timeout for forked and pooled jobs from `configuration.getBackgroundJobsConfig()`. `0` disables it.
     * @param {boolean} [args.closeDatabaseConnectionsOnStop] - Whether stop owns closing the configuration's database pools (default true).
     * @param {() => void | Promise<void>} [args.onStopped] - Lifecycle hook invoked after the worker finishes stopping.
     * @param {() => void} [args.onGenerationAccepted] - Explicit generation-acceptance observation hook.
     * @param {() => void} [args.onRetireMessage] - Explicit retire-message observation hook.
     */
    constructor({ configuration, host, port, generationId, workerInstanceId, maxConcurrentForkedJobs, maxConcurrentInlineJobs, pooledRunnerCount, pooledRunnerConcurrency, pooledRunnerMaxJobs, pooledRunnerMaxRssBytes, pooledRunnerMaxLifetimeMs, forkedChildSigkillGraceMs, heartbeatIntervalMs, generationHandshakeTimeoutMs = DEFAULT_GENERATION_HANDSHAKE_TIMEOUT_MS, reconnectDelayMs = 1000, jobTimeoutMs, closeDatabaseConnectionsOnStop = true, onStopped, onGenerationAccepted, onRetireMessage } = {}) {
        /**
         * Narrows the runtime value to the documented type.
         * @type {Promise<import("../configuration.js").default>} */
        this.configurationPromise = configuration ? Promise.resolve(configuration) : configurationResolver();
        /**
         * Narrows the runtime value to the documented type.
         * @type {import("../configuration.js").default | undefined} */
        this.configuration = undefined;
        this.host = host;
        this.port = port;
        this.explicitGenerationId = generationId;
        this.workerInstanceId = workerInstanceId || randomUUID();
        /** @type {string | undefined} */
        this.generationId = undefined;
        this.closeDatabaseConnectionsOnStop = closeDatabaseConnectionsOnStop;
        this.onStopped = onStopped;
        this.onGenerationAccepted = onGenerationAccepted;
        this.onRetireMessage = onRetireMessage;
        /**
         * Constructor override for the inline-job concurrency cap. When unset
         * the cap is read from `configuration.getBackgroundJobsConfig()` in
         * `start()` (default: 4).
         * @type {number | undefined}
         */
        this.maxConcurrentInlineJobsOverride = typeof maxConcurrentInlineJobs === "number" && maxConcurrentInlineJobs >= 1
            ? maxConcurrentInlineJobs
            : undefined;
        /**
         * Narrows the runtime value to the documented type.
         * @type {number | undefined} */
        this.maxConcurrentForkedJobsOverride = typeof maxConcurrentForkedJobs === "number" && maxConcurrentForkedJobs >= 1
            ? maxConcurrentForkedJobs
            : undefined;
        /**
         * Resolved cap for inline-job concurrency. Set in `start()`; defaults to
         * 4 if no configuration value is available.
         * @type {number}
         */
        this.maxConcurrentInlineJobs = this.maxConcurrentInlineJobsOverride || 4;
        /**
         * Narrows the runtime value to the documented type.
         * @type {number} */
        this.maxConcurrentForkedJobs = this.maxConcurrentForkedJobsOverride || 4;
        this.pooledRunnerCountOverride = positiveInteger(pooledRunnerCount);
        this.pooledRunnerConcurrencyOverride = positiveInteger(pooledRunnerConcurrency);
        this.pooledRunnerMaxJobsOverride = positiveInteger(pooledRunnerMaxJobs);
        this.pooledRunnerMaxRssBytesOverride = positiveNumber(pooledRunnerMaxRssBytes);
        this.pooledRunnerMaxLifetimeMsOverride = positiveNumber(pooledRunnerMaxLifetimeMs);
        this.pooledRunnerCount = this.pooledRunnerCountOverride || 4;
        this.pooledRunnerConcurrency = this.pooledRunnerConcurrencyOverride || 1;
        this.pooledRunnerMaxJobs = this.pooledRunnerMaxJobsOverride || 100;
        this.pooledRunnerMaxRssBytes = this.pooledRunnerMaxRssBytesOverride || 512 * 1024 * 1024;
        this.pooledRunnerMaxLifetimeMs = this.pooledRunnerMaxLifetimeMsOverride || 60 * 60 * 1000;
        /**
         * Grace period between SIGTERM and SIGKILL when reaping process runners that
         * outlast a bounded shutdown drain.
         * @type {number}
         */
        this.forkedChildSigkillGraceMs = typeof forkedChildSigkillGraceMs === "number" && forkedChildSigkillGraceMs >= 0
            ? forkedChildSigkillGraceMs
            : FORKED_CHILD_SIGKILL_GRACE_MS;
        /**
         * Constructor override for the forked and pooled wall-clock job timeout. When unset the
         * timeout is read from `configuration.getBackgroundJobsConfig().jobTimeoutMs`
         * at fork time (default: disabled).
         * @type {number | undefined}
         */
        this.jobTimeoutMsOverride = typeof jobTimeoutMs === "number" ? jobTimeoutMs : undefined;
        this.shouldStop = false;
        this.isRetiring = false;
        /** @type {Promise<void> | undefined} */
        this.stopPromise = undefined;
        /**
         * Resolves stop observation.
         * @type {(value?: void) => void}
         */
        this._resolveStopped = () => { };
        /**
         * Rejects stop observation.
         * @type {(error: Error) => void}
         */
        this._rejectStopped = () => { };
        /** @type {Promise<void>} */
        this._stoppedPromise = Promise.resolve();
        this._resetStoppedPromise();
        this.workerId = this.workerInstanceId;
        this._generationAccepted = false;
        this.generationHandshakeTimeoutMs = validateGenerationHandshakeTimeoutMs(generationHandshakeTimeoutMs);
        if (!Number.isInteger(reconnectDelayMs) || reconnectDelayMs < 0 || reconnectDelayMs > MAX_FORKED_JOB_TIMEOUT_MS) {
            throw new TypeError("reconnectDelayMs must be an integer between 0 and 2147483647");
        }
        this.reconnectDelayMs = reconnectDelayMs;
        /** @type {ReturnType<typeof setTimeout> | undefined} */
        this._reconnectTimer = undefined;
        this.heartbeatIntervalMs = typeof heartbeatIntervalMs === "number" && heartbeatIntervalMs >= 1
            ? heartbeatIntervalMs
            : HEARTBEAT_INTERVAL_MS;
        /**
         * Narrows the runtime value to the documented type.
         * @type {ReturnType<typeof setInterval> | undefined} */
        this._heartbeatTimer = undefined;
        /**
         * In-flight job-result reports to the main. Reporting is decoupled from the
         * job/child slot (freeing the slot never waits on a report) and retried
         * durably, so a transient main/DB outage cannot leak slots or lose a
         * terminal report. Tracked so a graceful `stop()` can drain them.
         * @type {Set<Promise<void>>}
         */
        this.inflightReports = new Set();
        /**
         * Narrows the runtime value to the documented type.
         * @type {JsonSocket | undefined} */
        this.jsonSocket = undefined;
        /**
         * Narrows the runtime value to the documented type.
         * @type {BackgroundJobsStatusReporter | undefined} */
        this.statusReporter = undefined;
        /**
         * Up to `this.maxConcurrentInlineJobs` of these run in parallel. They
         * share the worker's process and DB connection pool, so concurrency is
         * about overlapping I/O waits — use forking for memory isolation across
         * long-running jobs and for using more cores.
         * @type {Set<Promise<void>>}
         */
        this.inflightInlineJobs = new Set();
        /**
         * In-flight process runner exit promises. Tracked so process-job handoff
         * stays bounded while running and so a graceful `stop()` can drain them.
         * @type {Set<Promise<void>>}
         */
        this.inflightProcessJobs = new Set();
        /**
         * Live process runner child processes, kept so a graceful `stop()` can
         * terminate any that outlast the shutdown drain instead of orphaning them
         * across a deploy (where they would keep running against deleted release
         * code and holding database connections).
         * @type {Set<import("node:child_process").ChildProcess>}
         */
        this.inflightProcessChildren = new Set();
        /** @type {Set<Promise<void>>} */
        this.inflightPooledJobs = new Set();
        /** @type {Map<string, Array<import("./types.js").BackgroundJobPayload & {id: string}>>} */
        this.pooledJobQueues = new Map();
        /** @type {Map<string, Promise<void>>} - Per-id outer queue trackers. */
        this.pooledJobQueueTrackers = new Map();
        /** @type {Set<import("node:child_process").ChildProcess>} */
        this.pooledChildren = new Set();
        /** @type {Map<import("node:child_process").ChildProcess, PooledChildState>} */
        this.pooledChildStates = new Map();
        /** @type {WeakSet<Promise<void>>} */
        this._pooledStartupFailureJobs = new WeakSet();
        // Monotonic dispatch counter for round-robin child selection: each dispatch stamps
        // the chosen child, and selection prefers the child dispatched least recently.
        this._pooledDispatchSeq = 0;
    }
    /**
     * Runs start.
     * @returns {Promise<void>} - Resolves when connected.
     */
    async start() {
        this.shouldStop = false;
        this.isRetiring = false;
        this.stopPromise = undefined;
        this._resetStoppedPromise();
        this.configuration = await this.configurationPromise;
        this.configuration.setCurrent();
        const resolvedConfig = this.configuration.getBackgroundJobsConfig();
        this.generationId = this.configuration.resolveBackgroundJobsGenerationConfig({
            generationId: this.explicitGenerationId,
            sourceName: "BackgroundJobsWorker"
        }).generationId;
        this.workerId = this.generationId
            ? createGenerationWorkerId({ generationId: this.generationId, workerInstanceId: this.workerInstanceId })
            : this.workerInstanceId;
        this.host ||= resolvedConfig.host;
        if (typeof this.port !== "number")
            this.port = resolvedConfig.port;
        await this.configuration.initialize({ type: "background-jobs-worker" });
        await this.configuration.connectBeacon({ peerType: "background-jobs-worker" });
        // Constructor overrides win; otherwise pick up the configured caps.
        if (typeof this.maxConcurrentInlineJobsOverride !== "number") {
            const config = this.configuration.getBackgroundJobsConfig();
            this.maxConcurrentInlineJobs = config.maxConcurrentInlineJobs || this.maxConcurrentInlineJobs;
        }
        if (typeof this.maxConcurrentForkedJobsOverride !== "number") {
            const config = this.configuration.getBackgroundJobsConfig();
            this.maxConcurrentForkedJobs = config.maxConcurrentForkedJobs || this.maxConcurrentForkedJobs;
        }
        const poolConfig = this.configuration.getBackgroundJobsConfig();
        if (typeof this.pooledRunnerCountOverride !== "number")
            this.pooledRunnerCount = poolConfig.pooledRunnerCount;
        if (typeof this.pooledRunnerConcurrencyOverride !== "number")
            this.pooledRunnerConcurrency = poolConfig.pooledRunnerConcurrency;
        if (typeof this.pooledRunnerMaxJobsOverride !== "number")
            this.pooledRunnerMaxJobs = poolConfig.pooledRunnerMaxJobs;
        if (typeof this.pooledRunnerMaxRssBytesOverride !== "number")
            this.pooledRunnerMaxRssBytes = poolConfig.pooledRunnerMaxRssBytes;
        if (typeof this.pooledRunnerMaxLifetimeMsOverride !== "number")
            this.pooledRunnerMaxLifetimeMs = poolConfig.pooledRunnerMaxLifetimeMs;
        this.statusReporter = new BackgroundJobsStatusReporter({
            configuration: this.configuration,
            host: this.host,
            port: this.port,
            generationHandshakeTimeoutMs: this.generationHandshakeTimeoutMs,
            generationId: this.generationId
        });
        try {
            await this._connect({ allowReconnect: false });
        }
        catch (error) {
            let cleanupError;
            try {
                await this.stop();
            }
            catch (caughtCleanupError) {
                cleanupError = caughtCleanupError;
            }
            if (cleanupError) {
                throw new AggregateError([error, cleanupError], "Background jobs worker startup and cleanup failed", { cause: error });
            }
            throw error;
        }
    }
    /**
     * Gracefully stops the worker: announces draining to the main process so
     * no new jobs are dispatched, waits for in-flight inline jobs and process
     * runners to finish (so their results can be reported), then closes the
     * socket and disconnects from the beacon.
     *
     * Process runners are child processes. When a `timeoutMs` is given (e.g. a
     * deploy draining the old release) any runner still alive after the drain
     * window is terminated (SIGTERM, then SIGKILL) rather than left to orphan
     * across the deploy. With no `timeoutMs` the drain waits for runners to
     * finish on their own.
     * @param {object} [args] - Options.
     * @param {number} [args.timeoutMs] - Max wait for in-flight jobs (per phase) in ms.
     * @returns {Promise<void>} - Resolves when stopped.
     */
    stop({ timeoutMs } = {}) {
        const stopPromise = this.stopPromise || this._stop({ timeoutMs });
        if (!this.stopPromise) {
            this.stopPromise = stopPromise;
            void stopPromise.then(this._resolveStopped, (error) => {
                this._rejectStopped(error instanceof Error ? error : new Error(String(error)));
            });
        }
        return stopPromise;
    }
    /**
     * Waits for automatic or requested stop.
     * @returns {Promise<void>} - Resolves when this worker has fully stopped.
     */
    waitUntilStopped() { return this._stoppedPromise; }
    /** Resets the stop observation promise for a new worker start. */
    _resetStoppedPromise() {
        this._stoppedPromise = new Promise((resolve, reject) => {
            this._resolveStopped = resolve;
            this._rejectStopped = reject;
        });
        void this._stoppedPromise.catch(() => { });
    }
    /**
     * Runs the worker shutdown lifecycle once.
     * @param {object} [args] - Options.
     * @param {number} [args.timeoutMs] - Max wait for in-flight jobs (per phase) in ms.
     * @returns {Promise<void>} - Resolves when stopped.
     */
    async _stop({ timeoutMs } = {}) {
        this.shouldStop = true;
        this.isRetiring = true;
        this._stopHeartbeat();
        if (this._reconnectTimer) {
            clearTimeout(this._reconnectTimer);
            this._reconnectTimer = undefined;
        }
        await shutdownLifecycle({
            onStopped: this.onStopped,
            shutdown: async () => {
                // Announce drain so main stops dispatching but keeps the connection
                // open until we close it ourselves below.
                if (this.jsonSocket) {
                    try {
                        this.jsonSocket.send({ type: "draining" });
                    }
                    catch {
                        // Socket may already be closing; nothing to do.
                    }
                }
                await this._drainInflight(this.inflightInlineJobs, timeoutMs);
                await this._drainInflight(this.inflightPooledJobs, timeoutMs);
                await this._drainInflight(this.inflightProcessJobs, timeoutMs);
                await this._terminateProcessChildren();
                // Give in-flight result reports (now decoupled from job slots) a bounded
                // chance to land before the socket closes.
                await this._drainInflight(this.inflightReports, timeoutMs);
                if (this.jsonSocket)
                    this.jsonSocket.close();
                if (!this.configuration)
                    return;
                await this._closeConfiguration();
            }
        });
    }
    /** Begins generation retirement without revoking liveness during the drain. */
    _beginGenerationRetirement() {
        if (this.stopPromise)
            return;
        this.isRetiring = true;
        const stopPromise = this._stopAfterGenerationDrain();
        this.stopPromise = stopPromise;
        void stopPromise.then(this._resolveStopped, (error) => {
            const normalizedError = error instanceof Error ? error : new Error(String(error));
            this._rejectStopped(normalizedError);
            this._reportLifecycleError(normalizedError);
        });
    }
    /**
     * Drains accepted generation work while retaining the exact connection and
     * heartbeat, then performs the final terminating stop.
     * @returns {Promise<void>} - Resolves after the worker has fully closed.
     */
    async _stopAfterGenerationDrain() {
        if (this.jsonSocket) {
            try {
                this.jsonSocket.send({ type: "draining" });
            }
            catch {
                // The close handler owns exact same-generation reconnect.
            }
        }
        await this._drainInflight(this.inflightInlineJobs);
        await this._drainInflight(this.inflightPooledJobs);
        await this._drainInflight(this.inflightProcessJobs);
        await this._drainInflight(this.inflightReports);
        this.shouldStop = true;
        this._stopHeartbeat();
        if (this._reconnectTimer) {
            clearTimeout(this._reconnectTimer);
            this._reconnectTimer = undefined;
        }
        await this._terminateProcessChildren();
        await shutdownLifecycle({
            onStopped: this.onStopped,
            shutdown: async () => {
                if (this.jsonSocket)
                    this.jsonSocket.close();
                if (!this.configuration)
                    return;
                await this._closeConfiguration();
            }
        });
    }
    /**
     * Closes application resources before framework resources when this worker owns them.
     * @returns {Promise<void>} - Resolves after every owned close succeeds.
     */
    async _closeConfiguration() {
        const configuration = this.configuration;
        if (!configuration)
            return;
        await runShutdownSteps({
            message: "Background jobs worker application and framework shutdown failed",
            steps: [
                ...(this.closeDatabaseConnectionsOnStop
                    ? [async () => await configuration.shutdown()]
                    : []),
                async () => await configuration.disconnectBeacon(),
                ...(this.closeDatabaseConnectionsOnStop
                    ? [async () => await configuration.closeDatabaseConnections()]
                    : [])
            ]
        });
    }
    /**
     * Waits for a set of in-flight job promises to settle, optionally bounded by
     * `timeoutMs`.
     * @param {Set<Promise<void>>} inflight - In-flight job promises.
     * @param {number} [timeoutMs] - Max wait in ms; unbounded when omitted.
     * @returns {Promise<void>} - Resolves when settled or the timeout elapses.
     */
    async _drainInflight(inflight, timeoutMs) {
        if (inflight.size === 0)
            return;
        const drain = Promise.allSettled([...inflight]);
        if (typeof timeoutMs === "number" && timeoutMs >= 0) {
            let timer;
            const timeout = new Promise((resolve) => { timer = setTimeout(resolve, timeoutMs); });
            await Promise.race([drain, timeout]);
            clearTimeout(timer);
        }
        else {
            await drain;
        }
    }
    /**
     * Terminates any process runner children still alive after the drain window so
     * they don't outlive the worker as orphans. SIGTERM lets the runner close its
     * connections cleanly; survivors are SIGKILLed after a short grace.
     * @returns {Promise<void>} - Resolves once survivors have been signalled.
     */
    async _terminateProcessChildren() {
        if (this.inflightProcessChildren.size === 0)
            return;
        for (const child of this.inflightProcessChildren) {
            const pooledState = this.pooledChildStates.get(child);
            if (pooledState && pooledState.inflight.size > 0 && !pooledState.terminationReason) {
                pooledState.terminationReason = "worker-shutdown-timeout";
            }
            try {
                child.kill("SIGTERM");
            }
            catch {
                // Child already exited; nothing to do.
            }
        }
        await new Promise((resolve) => setTimeout(resolve, this.forkedChildSigkillGraceMs));
        for (const child of this.inflightProcessChildren) {
            try {
                child.kill("SIGKILL");
            }
            catch {
                // Child already exited; nothing to do.
            }
        }
    }
    /**
     * Connects to the worker's resolved endpoint and completes its hello fence.
     * @param {object} args - Reconnect policy.
     * @param {boolean} args.allowReconnect - Whether a failed attempt may schedule another connection.
     * @returns {Promise<void>} - Resolves after generation acknowledgement.
     */
    async _connect({ allowReconnect }) {
        const configuration = this.configuration;
        if (!configuration)
            throw new Error("Background jobs worker configuration not initialized");
        const config = configuration.getBackgroundJobsConfig();
        if (this.generationId)
            this._generationAccepted = false;
        const host = this.host || config.host;
        const port = typeof this.port === "number" ? this.port : config.port;
        const socket = net.createConnection({ host, port });
        socket.setKeepAlive(true, SOCKET_KEEPALIVE_MS);
        const jsonSocket = new JsonSocket(socket);
        this.jsonSocket = jsonSocket;
        /**
         * Resolves the generation handshake.
         * @type {() => void}
         */
        let resolveHandshake = () => { };
        /**
         * Rejects the generation handshake.
         * @type {(error: Error) => void}
         */
        let rejectHandshake = () => { };
        let connectionAccepted = false;
        /** @type {ReturnType<typeof setTimeout> | undefined} */
        let handshakeTimer;
        const handshake = new Promise((/** @type {(value: void) => void} */ resolve, reject) => {
            resolveHandshake = resolve;
            rejectHandshake = reject;
        });
        /**
         * Handles a background job socket message.
         * @param {import("./types.js").BackgroundJobSocketMessage} message - Socket message.
         */
        jsonSocket.on("message", async (message) => {
            if (message?.type === "generation-accepted") {
                if (!this.generationId || message.generationId !== this.generationId) {
                    rejectHandshake(new Error("Background jobs main acknowledged a different generation"));
                    jsonSocket.destroy();
                    return;
                }
                this._generationAccepted = true;
                connectionAccepted = true;
                if (handshakeTimer) {
                    clearTimeout(handshakeTimer);
                    handshakeTimer = undefined;
                }
                if (message.lifecycleState === "retiring" || message.lifecycleState === "retired")
                    this.isRetiring = true;
                this.onGenerationAccepted?.();
                this._sendReadyIfRunning();
                this._startHeartbeat();
                resolveHandshake();
                return;
            }
            if (message?.type === "generation-rejected") {
                this.shouldStop = true;
                if (handshakeTimer)
                    clearTimeout(handshakeTimer);
                rejectHandshake(new Error(`Background jobs generation rejected: ${message.reason}`));
                jsonSocket.destroy();
                return;
            }
            if (message?.type === "retire") {
                if (this.generationId && message.generationId === this.generationId) {
                    this.onRetireMessage?.();
                    this._beginGenerationRetirement();
                }
                return;
            }
            if (message?.type === "job") {
                await this._handleJob(message.payload);
            }
        });
        jsonSocket.on("error", (error) => {
            console.error("Background jobs worker socket error:", error);
            if (this.generationId && !this._generationAccepted)
                rejectHandshake(error);
        });
        jsonSocket.on("close", () => {
            if (handshakeTimer)
                clearTimeout(handshakeTimer);
            this._stopHeartbeat();
            if (this.jsonSocket === jsonSocket)
                this.jsonSocket = undefined;
            if (this.generationId && !this._generationAccepted) {
                rejectHandshake(new Error("Background jobs socket closed before generation acknowledgement"));
            }
            if (this.shouldStop)
                return;
            if (connectionAccepted || allowReconnect || !this.generationId)
                this._scheduleReconnect();
        });
        if (this.generationId) {
            handshakeTimer = setTimeout(() => {
                const error = new BackgroundJobsGenerationHandshakeTimeoutError({
                    endpoint: `${host}:${port}`,
                    generationId: this.generationId || "",
                    role: "worker",
                    timeoutMs: this.generationHandshakeTimeoutMs
                });
                rejectHandshake(error);
                jsonSocket.destroy();
            }, this.generationHandshakeTimeoutMs);
        }
        socket.on("connect", () => {
            jsonSocket.send({ type: "hello", role: "worker", ...(this.generationId ? { generationId: this.generationId } : {}), supportsHandoffIdReporting: true, supportsHeartbeat: true, supportsPooled: true, workerId: this.workerId });
            if (!this.generationId) {
                connectionAccepted = true;
                this._sendReadyIfRunning();
                this._startHeartbeat();
                resolveHandshake();
            }
        });
        if (this.generationId)
            await handshake;
    }
    /** Schedules one fenced reconnect to the worker's unchanged endpoint. */
    _scheduleReconnect() {
        if (this.shouldStop || this._reconnectTimer)
            return;
        this._reconnectTimer = setTimeout(() => {
            this._reconnectTimer = undefined;
            if (this.shouldStop)
                return;
            void this._connect({ allowReconnect: true }).catch((error) => {
                if (!this.shouldStop)
                    console.error("Background jobs worker reconnect failed:", error);
            });
        }, this.reconnectDelayMs);
        if (typeof this._reconnectTimer.unref === "function")
            this._reconnectTimer.unref();
    }
    /**
     * Surfaces an unexpected worker lifecycle failure through the framework error
     * channels so a supervisor hook that ignores stdio still has observability.
     * @param {ReturnType<typeof JSON.parse>} error - Worker lifecycle failure.
     */
    _reportLifecycleError(error) {
        const configuration = this.configuration;
        if (!configuration)
            return;
        const normalizedError = error instanceof Error ? error : new Error(String(error));
        const payload = { context: { generationId: this.generationId, stage: "background-jobs-worker-lifecycle" }, error: normalizedError };
        const errorEvents = configuration.getErrorEvents();
        errorEvents.emit("framework-error", payload);
        errorEvents.emit("all-error", { ...payload, errorType: "framework-error" });
    }
    /**
     * Sends periodic liveness heartbeats to the main so a wedged or silent worker
     * can be detected and dropped there (its leases released) instead of freezing
     * the queue until a human notices.
     * @returns {void}
     */
    _startHeartbeat() {
        this._stopHeartbeat();
        this._heartbeatTimer = setInterval(() => this._sendHeartbeat(), this.heartbeatIntervalMs);
        if (typeof this._heartbeatTimer.unref === "function")
            this._heartbeatTimer.unref();
    }
    /** Sends one liveness heartbeat while the worker has not finally stopped. */
    _sendHeartbeat() {
        if (this.shouldStop || !this.jsonSocket)
            return;
        try {
            this.jsonSocket.send({ type: "heartbeat", workerId: this.workerId });
        }
        catch {
            // Socket is closing/closed; the close handler drives reconnect.
        }
    }
    /**
     * Stops the liveness heartbeat timer.
     * @returns {void}
     */
    _stopHeartbeat() {
        if (this._heartbeatTimer) {
            clearInterval(this._heartbeatTimer);
            this._heartbeatTimer = undefined;
        }
    }
    /**
     * Runs handle job.
     * @param {import("./types.js").BackgroundJobPayload} payload - Payload.
     * @returns {Promise<void>} - Resolves when done.
     */
    async _handleJob(payload) {
        if (!payload.id)
            throw new Error("Background job payload missing id");
        /**
         * Identified payload.
         * @type {import("./types.js").BackgroundJobPayload & {id: string}} */
        const identifiedPayload = /** @type {ReturnType<typeof JSON.parse>} */ (payload);
        const executionMode = this._executionModeForPayload(identifiedPayload);
        if (executionMode === "pooled") {
            this._queuePooledJob(identifiedPayload);
            return;
        }
        if (executionMode !== "inline") {
            this._trackProcessJob(this._startProcessJob({ executionMode, payload: identifiedPayload }));
            return;
        }
        this._handleInlineJob(identifiedPayload);
    }
    /**
     * Runs start process job.
     * @param {object} args - Options.
     * @param {import("./types.js").BackgroundJobExecutionMode} args.executionMode - Execution mode.
     * @param {import("./types.js").BackgroundJobPayload & {id: string}} args.payload - Payload.
     * @returns {Promise<void>} - Resolves when the process job exits.
     */
    _startProcessJob({ executionMode, payload }) {
        if (executionMode === "forked")
            return this._forkJob(payload);
        return this._spawnJob(payload);
    }
    /**
     * Runs handle inline job.
     * @param {import("./types.js").BackgroundJobPayload & {id: string}} payload - Payload.
     * @returns {void}
     */
    _handleInlineJob(payload) {
        // Inline jobs share the worker's process and DB pool, but each one
        // is its own async chain — there's no semantic reason to serialize
        // them. We kick off the job, register it with `inflightInlineJobs`
        // for shutdown drain, and signal capacity to main:
        // - If we still have a free slot we ask for the next job right
        //   away, so a slow job (e.g. a docker alive check that waits 15s
        //   on a gone server) no longer starves every other inline job.
        // - When the job finishes, if the worker had been at the cap, we
        //   ask for the next job to refill the slot.
        // The bookkeeping in `finally()` ratchets capacity back up
        // regardless of success or failure.
        /**
         * Defines inflight.
         * @type {Promise<void>} */
        let inflight;
        inflight = this._runInlineJobAndReport(payload).finally(() => {
            this.inflightInlineJobs.delete(inflight);
            // Re-announce on every completion below cap, not just the cap→cap-1 edge —
            // see _trackProcessJob for why the knife-edge condition silently wedges.
            if (!this.shouldStop)
                this._sendReadyIfRunning();
        });
        this.inflightInlineJobs.add(inflight);
        if (this.inflightInlineJobs.size < this.maxConcurrentInlineJobs) {
            this._sendReadyIfRunning();
        }
    }
    /**
     * Runs execution mode for payload.
     * @param {import("./types.js").BackgroundJobPayload} payload - Payload.
     * @returns {import("./types.js").BackgroundJobExecutionMode} - Execution mode.
     */
    _executionModeForPayload(payload) {
        const executionMode = payload.options?.executionMode;
        return executionMode ? this._normalizeExecutionMode(executionMode) : "pooled";
    }
    /**
     * Runs normalize execution mode.
     * @param {string} executionMode - Execution mode.
     * @returns {import("./types.js").BackgroundJobExecutionMode} - Normalized execution mode.
     */
    _normalizeExecutionMode(executionMode) {
        for (const mode of EXECUTION_MODES) {
            if (mode === executionMode)
                return mode;
        }
        throw new Error(`Invalid background job executionMode: ${executionMode}`);
    }
    /**
     * Runs track process job.
     * @param {Promise<void>} processJob - Process job promise.
     * @returns {void}
     */
    _trackProcessJob(processJob) {
        /**
         * Defines inflight.
         * @type {Promise<void>} */
        let inflight;
        inflight = processJob.finally(() => {
            this.inflightProcessJobs.delete(inflight);
            // Re-announce readiness on EVERY completion that leaves us below cap — not
            // just the single cap→cap-1 edge. The main removes a worker from its ready
            // set on each dispatch (`_drainOnce`) and only re-adds it on a fresh
            // "ready"; gating the re-announce on one knife-edge transition means a
            // single missed or lost signal leaves the worker out of the ready set and
            // wedges dispatch cluster-wide. This was the silent-freeze root cause.
            // `_sendReadyIfRunning` self-guards (it sends nothing when the worker is
            // genuinely at capacity), so re-announcing on every freed slot is safe and
            // idempotent on the main.
            if (!this.shouldStop)
                this._sendReadyIfRunning();
        });
        this.inflightProcessJobs.add(inflight);
        this._sendReadyIfRunning();
    }
    /**
     * Runs run inline job and report.
     * @param {import("./types.js").BackgroundJobPayload & {id: string}} payload - Payload with required id.
     * @returns {Promise<void>} - Resolves when complete (success or failure reported).
     */
    async _runInlineJobAndReport(payload) {
        // Report in the background so freeing this inline slot never waits on the
        // report. Reporting is durable (retried until it lands), so a transient
        // main/DB outage neither wedges the slot nor loses the terminal result.
        try {
            await this._runJobInline(payload);
            this._reportJobResultInBackground({
                jobId: payload.id,
                status: "completed",
                handoffId: payload.handoffId,
                handedOffAtMs: payload.handedOffAtMs,
                workerId: payload.workerId || this.workerId
            });
        }
        catch (error) {
            if (error instanceof BackgroundJobRescheduleSignal) {
                this._reportJobResultInBackground({
                    jobId: payload.id,
                    status: "rescheduled",
                    delayMs: error.delayMs,
                    handoffId: payload.handoffId,
                    handedOffAtMs: payload.handedOffAtMs,
                    workerId: payload.workerId || this.workerId
                });
                return;
            }
            this._reportJobResultInBackground({
                jobId: payload.id,
                status: "failed",
                error,
                handoffId: payload.handoffId,
                handedOffAtMs: payload.handedOffAtMs,
                workerId: payload.workerId || this.workerId
            });
        }
    }
    /**
     * Advertises current worker capacity unless the worker is draining.
     * @param {object} [options] - Advertisement options.
     * @param {boolean} [options.revokePooledAdmission] - Revoke pooled credits while preserving other execution modes.
     * @returns {void}
     */
    _sendReadyIfRunning({ revokePooledAdmission = false } = {}) {
        if (this.shouldStop || this.isRetiring)
            return;
        if (!this.jsonSocket)
            return;
        if (this.generationId && !this._generationAccepted)
            return;
        const readyMessage = this._readyMessage({ revokePooledAdmission });
        if (!readyMessage)
            return;
        this.jsonSocket.send(readyMessage);
    }
    /**
     * Runs ready message.
     * @param {object} [options] - Advertisement options.
     * @param {boolean} [options.revokePooledAdmission] - Revoke pooled credits while preserving other execution modes.
     * @returns {import("./types.js").BackgroundJobSocketMessage | null} - Ready message or null when the worker has no capacity.
     */
    _readyMessage({ revokePooledAdmission = false } = {}) {
        const acceptsProcessJob = this.inflightProcessJobs.size < this.maxConcurrentForkedJobs;
        const acceptsInline = this.inflightInlineJobs.size < this.maxConcurrentInlineJobs;
        const availablePooledSlots = revokePooledAdmission ? 0 : this._availablePooledSlots();
        const acceptsPooled = availablePooledSlots > 0;
        if (!revokePooledAdmission && !acceptsProcessJob && !acceptsInline && !acceptsPooled)
            return null;
        return {
            type: "ready",
            acceptsForked: acceptsProcessJob,
            acceptsInline,
            acceptsPooled,
            availablePooledSlots,
            acceptsSpawned: acceptsProcessJob
        };
    }
    /**
     * Tracks a pooled job and re-advertises capacity.
     * @param {Promise<void>} pooledJob - Pooled job promise.
     * @returns {Promise<void>} - The tracked in-flight promise.
     */
    _trackPooledJob(pooledJob) {
        /** @type {Promise<void>} */
        let inflight;
        inflight = pooledJob.finally(() => {
            this.inflightPooledJobs.delete(inflight);
            if (!this.shouldStop && !this._pooledStartupFailureJobs.has(pooledJob) && !this._pooledStartupFailureJobs.has(inflight))
                this._sendReadyIfRunning();
        });
        this.inflightPooledJobs.add(inflight);
        return inflight;
    }
    /**
     * Serializes repeated leases for one durable row while preserving pooled
     * concurrency across different job ids.
     * @param {import("./types.js").BackgroundJobPayload & {id: string}} payload - Pooled job payload.
     * @returns {void}
     */
    _queuePooledJob(payload) {
        const queue = this.pooledJobQueues.get(payload.id);
        if (queue) {
            queue.push(payload);
            return;
        }
        this.pooledJobQueues.set(payload.id, [payload]);
        const tracker = this._trackPooledJob(this._runPooledJobQueue(payload.id));
        this.pooledJobQueueTrackers.set(payload.id, tracker);
    }
    /**
     * Runs admitted leases for one durable job id in arrival order.
     * @param {string} jobId - Durable job id.
     * @returns {Promise<void>} - Resolves after the per-id queue drains.
     */
    async _runPooledJobQueue(jobId) {
        const queue = this.pooledJobQueues.get(jobId);
        if (!queue)
            throw new Error(`Pooled job queue missing for job: ${jobId}`);
        try {
            while (queue.length > 0) {
                const payload = queue.shift();
                if (!payload)
                    throw new Error(`Pooled job queue contained an empty payload for job: ${jobId}`);
                await this._runPooledJob(payload);
            }
        }
        finally {
            const tracker = this.pooledJobQueueTrackers.get(jobId);
            if (tracker) {
                this.inflightPooledJobs.delete(tracker);
                this.pooledJobQueueTrackers.delete(jobId);
            }
            this.pooledJobQueues.delete(jobId);
        }
    }
    /**
     * Free pooled slots across the pool: open slots in non-retiring children plus
     * the slots we could add by spawning more children up to `pooledRunnerCount`.
     * Retiring children (draining before replacement) never contribute capacity.
     * @returns {number} - Number of pooled jobs the worker can accept right now.
     */
    _availablePooledSlots() {
        let openInExisting = 0;
        let nonRetiringChildren = 0;
        let queuedReservations = 0;
        for (const child of this.pooledChildren) {
            const state = this.pooledChildStates.get(child);
            if (!state || state.retiring)
                continue;
            nonRetiringChildren += 1;
            openInExisting += this.pooledRunnerConcurrency - state.inflight.size;
        }
        for (const queue of this.pooledJobQueues.values())
            queuedReservations += queue.length;
        const spawnableChildren = Math.max(0, this.pooledRunnerCount - nonRetiringChildren);
        return Math.max(0, openInExisting + spawnableChildren * this.pooledRunnerConcurrency - queuedReservations);
    }
    /**
     * Runs a payload on a pooled child with a free concurrency slot, spawning a
     * new child when every non-retiring child is full and the pool is below
     * `pooledRunnerCount`. Each child runs up to `pooledRunnerConcurrency` jobs at
     * once on its own event loop.
     * @param {import("./types.js").BackgroundJobPayload & {id: string}} payload - Job payload.
     * @returns {Promise<void>} - Resolves after the durable report.
     */
    _runPooledJob(payload) {
        const child = this._selectPooledChild() || this._createPooledChild();
        const state = this.pooledChildStates.get(child);
        if (!state)
            throw new Error("Pooled runner state missing");
        // Stamp the round-robin cursor so the next dispatch prefers a different child.
        state.lastDispatchSeq = ++this._pooledDispatchSeq;
        /**
         * Resolves the pooled job promise.
         * @type {(value: void) => void}
         */
        let resolvePooledJob = () => { };
        const pooledJob = new Promise((resolve) => { resolvePooledJob = resolve; });
        const timeoutTimer = this._armPooledJobTimeout({ child, payload });
        state.inflight.set(payload.id, { payload, resolve: resolvePooledJob, pooledJob, timeoutTimer });
        try {
            child.send({ type: "job", payload, sharedTransactionBroker: this._pooledJobSharedTransactionBrokerConfig() });
        }
        catch (error) {
            void this._handlePooledChildFailure({ child, error, origin: "ipc-send" });
        }
        return pooledJob;
    }
    /**
     * Captures the current test attempt's broker mode at dispatch time. A warm
     * pooled child must never rely on its immutable fork-time environment.
     * @returns {import("../testing/shared-transaction-proxy-driver.js").SharedTransactionBrokerJobConfig} - Per-job broker configuration.
     */
    _pooledJobSharedTransactionBrokerConfig() {
        const serialized = process.env.VELOCIOUS_TEST_SHARED_TRANSACTION_BROKER;
        if (!serialized)
            return { expected: false };
        const config = JSON.parse(Buffer.from(serialized, "base64url").toString("utf8"));
        return { ...config, expected: true };
    }
    /**
     * Selects a pooled child to run the next job, or undefined when every non-retiring
     * child is already full (the caller then lazily spawns one). Among children with a
     * free concurrency slot, picks the one dispatched least recently — a round-robin that
     * spreads jobs (notably multi-minute RunBuildJobs, each pinning a tenant connection
     * for its whole run) evenly across children instead of first-fit packing the earliest
     * one until it is full. A freshly spawned or replacement child therefore takes its
     * fair share one job at a time as its turn comes up, rather than absorbing a burst to
     * "catch up" to the others.
     * @returns {import("node:child_process").ChildProcess | undefined} - The chosen child, or undefined when all non-retiring children are full.
     */
    _selectPooledChild() {
        /** @type {import("node:child_process").ChildProcess | undefined} */
        let selected;
        let selectedSeq = Infinity;
        for (const child of this.pooledChildren) {
            const state = this.pooledChildStates.get(child);
            if (!state || state.retiring || state.inflight.size >= this.pooledRunnerConcurrency)
                continue;
            if (state.lastDispatchSeq < selectedSeq) {
                selected = child;
                selectedSeq = state.lastDispatchSeq;
            }
        }
        return selected;
    }
    /**
     * Arms a per-job wall-clock backstop for a pooled job. A pooled child hosts many
     * concurrent jobs, so a single genuinely-hung job would otherwise pin its
     * runner's concurrency slot forever — the lifetime recycle only retires a child
     * once its in-flight set drains, which a hung job never does. On overrun the
     * whole child is terminated so the hung job (and its siblings) requeue. Returns
     * the timer, or null when no timeout is configured.
     * @param {object} args - Options.
     * @param {import("node:child_process").ChildProcess} args.child - Pooled child.
     * @param {import("./types.js").BackgroundJobPayload & {id: string}} args.payload - Job payload whose overrun is guarded.
     * @returns {ReturnType<typeof setTimeout> | null} - The armed timer, or null.
     */
    _armPooledJobTimeout({ child, payload }) {
        const timeoutMs = this._resolveJobTimeoutMs(payload.options);
        if (!(typeof timeoutMs === "number" && timeoutMs > 0))
            return null;
        return setTimeout(() => this._onPooledJobTimeout({ child, jobId: payload.id }), timeoutMs);
    }
    /**
     * Fired when a pooled job overruns its timeout. Terminates the child running it
     * (SIGTERM, then SIGKILL after the grace) — a hung JS job cannot be cancelled
     * any other way. The non-clean exit flows through `_handlePooledChildFailure`,
     * which reports every in-flight job on the child failed (so they requeue) and
     * drops it from tracking; the failure path immediately re-advertises the
     * resulting capacity once the runner has completed startup.
     * @param {object} args - Options.
     * @param {import("node:child_process").ChildProcess} args.child - Pooled child.
     * @param {string} args.jobId - Job id that overran.
     * @returns {void}
     */
    _onPooledJobTimeout({ child, jobId }) {
        const state = this.pooledChildStates.get(child);
        // Already settling/gone, or the job finished in the race with this timer.
        if (!state || state.settling || state.terminationReason || !state.inflight.has(jobId))
            return;
        state.terminationReason = "job-timeout";
        state.timeoutJobId = jobId;
        try {
            child.kill("SIGTERM");
        }
        catch {
            // Child already exited; nothing to do.
        }
        state.timeoutSigkillTimer = setTimeout(() => {
            try {
                child.kill("SIGKILL");
            }
            catch {
                // Child already exited; nothing to do.
            }
        }, this.forkedChildSigkillGraceMs);
    }
    /**
     * Creates a reusable pooled child.
     * @returns {import("node:child_process").ChildProcess} - New pooled child.
     */
    _createPooledChild() {
        const configuration = this.configuration;
        if (!configuration)
            throw new Error("Background jobs worker configuration not initialized");
        const child = fork(POOLED_RUNNER_ENTRY_PATH, [], {
            cwd: configuration.getDirectory(), execArgv: [], stdio: ["ignore", "ignore", "ignore", "ipc"],
            env: Object.assign({}, process.env, this._childBackgroundJobsEnvironment())
        });
        this.pooledChildren.add(child);
        this.inflightProcessChildren.add(child);
        this.pooledChildStates.set(child, { createdAtMs: Date.now(), jobsRun: 0, inflight: new Map(), lastDispatchSeq: 0, retiring: false, started: false });
        child.on("message", (message) => this._handlePooledChildMessage({ child, message }));
        child.once("exit", (exitCode, signal) => this._handlePooledChildFailure({
            child,
            error: new Error(`Pooled background job runner exited: code=${exitCode} signal=${signal || "none"}`),
            exitCode,
            origin: "exit",
            signal
        }));
        child.once("error", (error) => this._handlePooledChildFailure({
            child,
            error,
            exitCode: child.exitCode,
            origin: "process-error",
            signal: child.signalCode
        }));
        return child;
    }
    /**
     * Handles a pooled child's per-job durable-report acknowledgement. A child
     * runs jobs concurrently and reports one `job-outcome` per job id.
     * @param {object} args - Message details.
     * @param {import("node:child_process").ChildProcess} args.child - Pooled child.
     * @param {ReturnType<typeof JSON.parse>} args.message - IPC message.
     * @returns {void}
     */
    _handlePooledChildMessage({ child, message }) {
        if (!message || typeof message !== "object")
            return;
        const record = /** @type {{type?: ReturnType<typeof JSON.parse>, jobId?: ReturnType<typeof JSON.parse>, acknowledged?: ReturnType<typeof JSON.parse>, rssBytes?: ReturnType<typeof JSON.parse>, error?: ReturnType<typeof JSON.parse>}} */ (message);
        const state = this.pooledChildStates.get(child);
        if (record.type === "ready") {
            if (state)
                state.started = true;
            return;
        }
        if (isChildAcceptanceMessage(message)) {
            this._reportChildAccepted(message);
            return;
        }
        if (record.type !== "job-outcome" || !state || state.settling || typeof record.jobId !== "string")
            return;
        state.started = true;
        const entry = state.inflight.get(record.jobId);
        if (!entry)
            return;
        if (entry.timeoutTimer)
            clearTimeout(entry.timeoutTimer);
        state.inflight.delete(record.jobId);
        state.jobsRun += 1;
        const resolve = entry.resolve;
        if (record.acknowledged === true) {
            if (resolve)
                resolve(undefined);
        }
        else {
            // The child stayed alive but could not confirm this one job's terminal
            // report; reclaim just this job — its concurrent siblings are unaffected.
            void this._reportJobResult({
                jobId: entry.payload.id,
                status: "failed",
                error: new Error(typeof record.error === "string" ? record.error : "Pooled runner terminal report was not acknowledged"),
                handoffId: entry.payload.handoffId,
                handedOffAtMs: entry.payload.handedOffAtMs,
                workerId: entry.payload.workerId || this.workerId
            }).finally(() => { if (resolve)
                resolve(undefined); });
        }
        const rssBytes = typeof record.rssBytes === "number" ? record.rssBytes : Number.POSITIVE_INFINITY;
        const runnerAgeMs = Date.now() - state.createdAtMs;
        if (!state.retiring && (state.jobsRun >= this.pooledRunnerMaxJobs || rssBytes >= this.pooledRunnerMaxRssBytes || runnerAgeMs >= this.pooledRunnerMaxLifetimeMs || this.shouldStop)) {
            this._beginRetirePooledChild(child);
        }
        this._terminateIfDrained(child);
    }
    /**
     * Forwards one pooled child's acceptance observation to main as a bounded
     * diagnostic report. The child carries its exact handoff lease, so a timeout
     * or outcome that already settled the worker's in-flight entry cannot lose
     * the fencing. A report that never lands degrades phase diagnostics for that
     * job only — it must never block or fail the job itself.
     * @param {{type: "job-received" | "job-started", jobId: string, handoffId?: string, workerId?: string, handedOffAtMs?: number, receivedAtMs?: number, startedAtMs?: number, childInstanceId?: string, childPid?: number}} message - Validated child acceptance message.
     * @returns {void}
     */
    _reportChildAccepted(message) {
        if (!this.statusReporter)
            return;
        void this.statusReporter.reportChildAcceptedWithRetry({
            jobId: message.jobId,
            handoffId: message.handoffId,
            workerId: message.workerId,
            handedOffAtMs: message.handedOffAtMs,
            receivedAtMs: message.receivedAtMs,
            startedAtMs: message.startedAtMs,
            childInstanceId: message.childInstanceId,
            childPid: message.childPid,
            maxDurationMs: CHILD_ACCEPTANCE_REPORT_MAX_DURATION_MS
        }).catch((error) => {
            console.error("Background job child-acceptance reporting failed:", error);
        });
    }
    /**
     * Marks a pooled child for retirement and eagerly spawns a single replacement
     * (1-for-1) so its capacity is restored immediately without waiting for it to
     * finish draining. The retiring child stops receiving new jobs and is
     * terminated only once its in-flight set drains, so a long-running job (e.g. a
     * build) is never cut off.
     * @param {import("node:child_process").ChildProcess} child - Child to retire.
     * @returns {void}
     */
    _beginRetirePooledChild(child) {
        const state = this.pooledChildStates.get(child);
        if (!state || state.retiring)
            return;
        state.retiring = true;
        // Best-effort pre-warm: skip when stopping (no new work) or before the
        // worker is initialized (no configuration to fork a child from).
        if (!this.shouldStop && this.configuration)
            this._createPooledChild();
    }
    /**
     * Terminates a retiring pooled child once it has no in-flight jobs left.
     * @param {import("node:child_process").ChildProcess} child - Child to check.
     * @returns {void}
     */
    _terminateIfDrained(child) {
        const state = this.pooledChildStates.get(child);
        if (!state || !state.retiring || state.inflight.size > 0)
            return;
        this._retirePooledChild(child);
    }
    /**
     * Retires a drained pooled child (removes it from tracking, then SIGTERMs it).
     * @param {import("node:child_process").ChildProcess} child - Child process to retire.
     * @returns {void}
     */
    _retirePooledChild(child) {
        this.pooledChildren.delete(child);
        this.pooledChildStates.delete(child);
        this.inflightProcessChildren.delete(child);
        child.kill("SIGTERM");
    }
    /**
     * Removes an exited/unhealthy pooled child and reports every job that was
     * in-flight on it as failed — a process-level crash's blast radius is the
     * child's whole in-flight set. Once the child has completed startup, its
     * freed capacity is advertised immediately; the replacement itself is still
     * spawned lazily by the next dispatch. A child that exits before its startup
     * handshake does not re-announce, avoiding a tight respawn loop on startup
     * failure.
     * @param {object} args - Failure details.
     * @param {import("node:child_process").ChildProcess} args.child - Pooled child.
     * @param {ReturnType<typeof JSON.parse>} args.error - Failure.
     * @param {number | null} [args.exitCode] - Child exit code when observed.
     * @param {import("./types.js").PooledRunnerFailureOrigin} [args.origin] - Worker observation that initiated recovery.
     * @param {import("node:child_process").ChildProcess["signalCode"]} [args.signal] - Child termination signal when observed.
     * @returns {Promise<void>}
     */
    async _handlePooledChildFailure({ child, error, exitCode = null, origin = "process-error", signal = null }) {
        const state = this.pooledChildStates.get(child);
        if (state?.settling)
            return;
        if (state) {
            state.settling = true;
            // Cancel this child's pending timers before its in-flight set is reported —
            // the SIGKILL grace from a timeout kill, and every armed per-job backstop.
            if (state.timeoutSigkillTimer)
                clearTimeout(state.timeoutSigkillTimer);
            for (const inflightEntry of state.inflight.values()) {
                if (inflightEntry.timeoutTimer)
                    clearTimeout(inflightEntry.timeoutTimer);
            }
        }
        this.pooledChildren.delete(child);
        this.inflightProcessChildren.delete(child);
        const entries = state ? [...state.inflight.values()] : [];
        const runnerFailure = state
            ? this._pooledRunnerFailure({ child, exitCode, origin, signal, state })
            : undefined;
        if (state)
            state.inflight.clear();
        this.pooledChildStates.delete(child);
        const failureReports = entries.map(async (entry) => {
            await this._reportJobResult({
                jobId: entry.payload.id,
                status: "failed",
                error,
                handoffId: entry.payload.handoffId,
                handedOffAtMs: entry.payload.handedOffAtMs,
                runnerFailure,
                workerId: entry.payload.workerId || this.workerId
            });
            if (entry.resolve)
                entry.resolve(undefined);
        });
        // Start every fallback report before announcing capacity so the main cannot
        // observe a replacement slot before the failed jobs' reports are in flight.
        // The report promises remain tracked below; a slow retry must not hold the
        // newly freed runner capacity hostage.
        if (state && state.started !== false) {
            this._sendReadyIfRunning();
        }
        else if (state) {
            for (const entry of entries) {
                if (entry.pooledJob)
                    this._pooledStartupFailureJobs.add(entry.pooledJob);
                const queueTracker = this.pooledJobQueueTrackers.get(entry.payload.id);
                if (queueTracker)
                    this._pooledStartupFailureJobs.add(queueTracker);
            }
            // A previous ready message may still have unconsumed pooled credits at the
            // main. Revoke them authoritatively without suppressing valid inline or
            // process-runner readiness; otherwise queued jobs can trigger a startup
            // crash loop using the stale credits.
            this._sendReadyIfRunning({ revokePooledAdmission: true });
        }
        await Promise.allSettled(failureReports);
    }
    /**
     * Captures one stable process snapshot before the failed child's state is removed.
     * @param {object} args - Failure details.
     * @param {import("node:child_process").ChildProcess} args.child - Failed pooled child.
     * @param {number | null} args.exitCode - Child exit code when observed.
     * @param {import("./types.js").PooledRunnerFailureOrigin} args.origin - Worker observation that initiated recovery.
     * @param {import("node:child_process").ChildProcess["signalCode"]} args.signal - Child termination signal when observed.
     * @param {PooledChildState} args.state - Child state immediately before recovery.
     * @returns {import("./types.js").PooledRunnerFailure} - Shared failure provenance.
     */
    _pooledRunnerFailure({ child, exitCode, origin, signal, state }) {
        const terminationReason = state.terminationReason ?? "unexpected";
        const workerLifecycle = this.shouldStop ? "stopping" : this.isRetiring ? "retiring" : "running";
        const runnerLifecycle = state.started === false ? "starting" : state.retiring ? "retiring" : "running";
        const activeJobs = [...state.inflight.values()]
            .map((entry) => ({
            handoffId: entry.payload.handoffId ?? null,
            handedOffAtMs: entry.payload.handedOffAtMs ?? null,
            jobId: entry.payload.id,
            jobName: entry.payload.jobName,
            workerId: entry.payload.workerId ?? this.workerId
        }))
            .sort((left, right) => left.jobId.localeCompare(right.jobId));
        return Object.freeze({
            activeJobs,
            exitCode,
            generationId: this.generationId ?? null,
            oomKilled: signal === "SIGKILL" && terminationReason === "unexpected" ? null : false,
            origin,
            runnerAgeMs: Math.max(0, Date.now() - state.createdAtMs),
            runnerCreatedAtMs: state.createdAtMs,
            runnerDetached: false,
            runnerJobsRun: state.jobsRun,
            runnerLifecycle,
            runnerPid: child.pid ?? null,
            signal,
            terminationReason,
            timeoutJobId: state.timeoutJobId ?? null,
            workerId: this.workerId,
            workerLifecycle,
            workerPid: process.pid
        });
    }
    /**
     * Runs run job inline.
     * @param {import("./types.js").BackgroundJobPayload} payload - Payload.
     * @returns {Promise<void>} - Resolves when done.
     */
    async _runJobInline(payload) {
        const configuration = this.configuration;
        if (!configuration)
            throw new Error("Background jobs worker configuration not initialized");
        const registry = new BackgroundJobRegistry({ configuration });
        await registry.load();
        const JobClass = registry.getJobByName(payload.jobName);
        await runWithBackgroundJobPayload(payload, async () => {
            await performBackgroundJob({
                configuration,
                JobClass,
                jobArgs: payload.args || [],
                jobOptions: payload.options || {},
                name: `Background job worker inline: ${payload.jobName}`,
                payload
            });
        });
    }
    /**
     * Runs fork job.
     * @param {import("./types.js").BackgroundJobPayload & {id: string}} payload - Payload.
     * @returns {Promise<void>} - Resolves when the forked runner exits or fork fails.
     */
    _forkJob(payload) {
        const child = this._createForkedChild();
        this.inflightProcessChildren.add(child);
        const finished = this._waitForForkedChild({ child, payload });
        this._sendForkedPayload({ child, payload });
        return finished;
    }
    /**
     * Runs create forked child.
     * @returns {import("node:child_process").ChildProcess} - Forked child process.
     */
    _createForkedChild() {
        const configuration = this.configuration;
        if (!configuration)
            throw new Error("Background jobs worker configuration not initialized");
        const directory = configuration.getDirectory();
        return fork(FORKED_RUNNER_ENTRY_PATH, [], {
            cwd: directory,
            execArgv: [],
            stdio: ["ignore", "ignore", "ignore", "ipc"],
            env: Object.assign({}, process.env, this._childBackgroundJobsEnvironment())
        });
    }
    /**
     * Runs wait for forked child.
     * @param {object} args - Options.
     * @param {import("node:child_process").ChildProcess} args.child - Forked child process.
     * @param {import("./types.js").BackgroundJobPayload & {id: string}} args.payload - Payload.
     * @returns {Promise<void>} - Resolves when the child exits.
     */
    _waitForForkedChild({ child, payload }) {
        const timeoutState = this._armForkedJobTimeout({ child, payload });
        return new Promise((resolve) => {
            child.once("exit", (code, signal) => {
                this._clearForkedJobTimeout(timeoutState);
                this._handleForkedChildExit({ child, code, signal, payload, resolve, timeoutState });
            });
            child.once("error", (error) => {
                this._clearForkedJobTimeout(timeoutState);
                this._handleForkedChildError({ child, error, payload, resolve });
            });
        });
    }
    /**
     * Arms a wall-clock backstop for a forked job runner. A forked job still
     * running after `jobTimeoutMs` is terminated (SIGTERM, then SIGKILL after the
     * grace) so a single genuinely-hung runner can't pin a draining worker — and
     * its full-app boot and database connections — indefinitely. Returns a state
     * object the exit/error handlers use to cancel the timer and to report a
     * timeout-specific failure. When no timeout is configured the timer is null
     * and behavior is unchanged.
     * @param {object} args - Options.
     * @param {import("node:child_process").ChildProcess} args.child - Forked child process.
     * @param {import("./types.js").BackgroundJobPayload & {id: string}} args.payload - Job payload.
     * @returns {ForkedJobTimeoutState} - Timeout state.
     */
    _armForkedJobTimeout({ child, payload }) {
        const timeoutMs = this._resolveJobTimeoutMs(payload.options);
        /** @type {ForkedJobTimeoutState} */
        const state = { timedOut: false, timeoutMs, timer: null, sigkillTimer: null };
        if (!(typeof timeoutMs === "number" && timeoutMs > 0))
            return state;
        state.timer = setTimeout(() => this._onForkedJobTimeout({ child, state }), timeoutMs);
        return state;
    }
    /**
     * Resolves the effective wall-clock job timeout in ms (shared by forked and pooled jobs), or null when disabled. The
     * per-job override wins, followed by the constructor override, then the value
     * from the background-jobs configuration. A non-positive value disables the
     * backstop at whichever level supplied it.
     * @param {import("./types.js").BackgroundJobOptions} [jobOptions] - Per-job options.
     * @returns {number | null} - Timeout in ms, or null when disabled.
     */
    _resolveJobTimeoutMs(jobOptions) {
        const raw = typeof jobOptions?.timeoutMs === "number"
            ? jobOptions.timeoutMs
            : (typeof this.jobTimeoutMsOverride === "number"
                ? this.jobTimeoutMsOverride
                : (this.configuration ? this.configuration.getBackgroundJobsConfig().jobTimeoutMs : null));
        // A non-finite (e.g. Infinity) or non-positive value disables the backstop;
        // a finite value beyond Node's timer range is clamped to the max rather than
        // silently coerced to ~1ms (which would kill every forked job immediately).
        if (typeof raw !== "number" || !Number.isFinite(raw) || raw <= 0)
            return null;
        return Math.min(raw, MAX_FORKED_JOB_TIMEOUT_MS);
    }
    /**
     * Fired when a forked runner overruns its timeout. Sends SIGTERM for a clean
     * shutdown, then SIGKILL after the grace for a runner that ignores it. The
     * resulting non-clean exit flows through `_handleForkedChildExit`, which frees
     * the slot and reports the job failed.
     * @param {object} args - Options.
     * @param {import("node:child_process").ChildProcess} args.child - Forked child process.
     * @param {ForkedJobTimeoutState} args.state - Timeout state.
     * @returns {void}
     */
    _onForkedJobTimeout({ child, state }) {
        state.timedOut = true;
        try {
            child.kill("SIGTERM");
        }
        catch {
            // Child already exited; nothing to do.
        }
        state.sigkillTimer = setTimeout(() => {
            try {
                child.kill("SIGKILL");
            }
            catch {
                // Child already exited; nothing to do.
            }
        }, this.forkedChildSigkillGraceMs);
    }
    /**
     * Cancels any pending timeout/SIGKILL timers for a forked runner that has
     * exited (or errored) so they never fire against a gone or reused child.
     * @param {ForkedJobTimeoutState} state - Timeout state.
     * @returns {void}
     */
    _clearForkedJobTimeout(state) {
        if (state.timer) {
            clearTimeout(state.timer);
            state.timer = null;
        }
        if (state.sigkillTimer) {
            clearTimeout(state.sigkillTimer);
            state.sigkillTimer = null;
        }
    }
    /**
     * Runs handle forked child exit.
     * @param {object} args - Options.
     * @param {import("node:child_process").ChildProcess} args.child - Forked child process.
     * @param {number | null} args.code - Exit code.
     * @param {keyof typeof import("node:os").constants.signals | null} args.signal - Exit signal.
     * @param {import("./types.js").BackgroundJobPayload & {id: string}} args.payload - Payload.
     * @param {(value: void) => void} args.resolve - Promise resolver.
     * @param {ForkedJobTimeoutState} [args.timeoutState] - Timeout state, when the runner had a wall-clock backstop.
     * @returns {void}
     */
    _handleForkedChildExit({ child, code, signal, payload, resolve, timeoutState }) {
        this.inflightProcessChildren.delete(child);
        // Free the worker slot as soon as the child is gone — never gate it on the
        // failure report. A hung/slow report must not leak the slot; enough leaked
        // slots drive `acceptsForked` to false and silently wedge the worker.
        resolve(undefined);
        if (this._forkedChildExitedCleanly({ code, signal }))
            return;
        const error = timeoutState?.timedOut
            ? new Error(`Forked background job runner timed out after ${timeoutState.timeoutMs}ms and was terminated: code=${code} signal=${signal || "none"}`)
            : new Error(`Forked background job runner exited before reporting: code=${code} signal=${signal || "none"}`);
        this._reportForkedChildFailure({ payload, error });
    }
    /**
     * Runs forked child exited cleanly.
     * @param {object} args - Options.
     * @param {number | null} args.code - Exit code.
     * @param {keyof typeof import("node:os").constants.signals | null} args.signal - Exit signal.
     * @returns {boolean} - Whether the child exited cleanly.
     */
    _forkedChildExitedCleanly({ code, signal }) {
        return code === 0 && !signal;
    }
    /**
     * Runs handle forked child error.
     * @param {object} args - Options.
     * @param {import("node:child_process").ChildProcess} args.child - Forked child process.
     * @param {Error} args.error - Child process error.
     * @param {import("./types.js").BackgroundJobPayload & {id: string}} args.payload - Payload.
     * @param {(value: void) => void} args.resolve - Promise resolver.
     * @returns {void}
     */
    _handleForkedChildError({ child, error, payload, resolve }) {
        this.inflightProcessChildren.delete(child);
        // Free the slot first (see _handleForkedChildExit) — reporting is best-effort.
        resolve(undefined);
        console.error("Background jobs forked runner error:", error);
        this._reportForkedChildFailure({ payload, error });
    }
    /**
     * Runs send forked payload.
     * @param {object} args - Options.
     * @param {import("node:child_process").ChildProcess} args.child - Forked child process.
     * @param {import("./types.js").BackgroundJobPayload & {id: string}} args.payload - Payload.
     * @returns {void}
     */
    _sendForkedPayload({ child, payload }) {
        try {
            child.send({ type: "job", payload });
        }
        catch (error) {
            child.kill("SIGTERM");
            this._reportForkedChildFailure({ payload, error });
        }
    }
    /**
     * Runs report forked child failure.
     * @param {object} args - Options.
     * @param {import("./types.js").BackgroundJobPayload & {id: string}} args.payload - Payload.
     * @param {ReturnType<typeof JSON.parse>} args.error - Error.
     * @returns {void}
     */
    _reportForkedChildFailure({ payload, error }) {
        this._reportJobResultInBackground({
            jobId: payload.id,
            status: "failed",
            error,
            handoffId: payload.handoffId,
            handedOffAtMs: payload.handedOffAtMs,
            workerId: payload.workerId || this.workerId
        });
    }
    /**
     * Runs spawn job.
     * @param {import("./types.js").BackgroundJobPayload} payload - Payload.
     * @returns {Promise<void>} - Resolves when the spawned runner exits or spawn fails.
     */
    _spawnJob(payload) {
        const configuration = this.configuration;
        if (!configuration)
            throw new Error("Background jobs worker configuration not initialized");
        const directory = configuration.getDirectory();
        const argvCommand = process.argv[1];
        const command = argvCommand ? argvCommand : `${directory}/bin/velocious.js`;
        const encodedPayload = Buffer.from(JSON.stringify(payload)).toString("base64");
        const child = spawn(process.execPath, [command, "background-jobs-runner"], {
            cwd: directory,
            detached: true,
            stdio: "ignore",
            env: Object.assign({}, process.env, this._childBackgroundJobsEnvironment(), { VELOCIOUS_JOB_PAYLOAD: encodedPayload })
        });
        this.inflightProcessChildren.add(child);
        const finished = new Promise((resolve) => {
            child.once("exit", () => {
                this.inflightProcessChildren.delete(child);
                resolve(undefined);
            });
            child.once("error", (error) => {
                this.inflightProcessChildren.delete(child);
                console.error("Background jobs spawned runner error:", error);
                resolve(undefined);
            });
        });
        child.unref();
        return finished;
    }
    /**
     * Builds the exact main endpoint and generation inherited by every child.
     * @returns {Record<string, string>} - Child process environment additions.
     */
    _childBackgroundJobsEnvironment() {
        const configuration = this.configuration;
        if (!configuration)
            throw new Error("Background jobs worker configuration not initialized");
        if (!this.host || typeof this.port !== "number")
            throw new Error("Background jobs worker endpoint not resolved");
        return {
            VELOCIOUS_BACKGROUND_JOB_CHILD: "1",
            VELOCIOUS_ENV: configuration.getEnvironment(),
            VELOCIOUS_BACKGROUND_JOBS_HOST: this.host,
            VELOCIOUS_BACKGROUND_JOBS_PORT: `${this.port}`,
            ...(this.generationId ? { VELOCIOUS_BACKGROUND_JOBS_GENERATION_ID: this.generationId } : {})
        };
    }
    /**
     * Runs report job result.
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
    async _reportJobResult({ jobId, status, delayMs, error, handoffId, handedOffAtMs, workerId, runnerFailure }) {
        if (!this.statusReporter)
            return;
        try {
            // Retry a transient persist failure (`job-update-error`): the worker is
            // long-lived and cannot exit to trigger orphan reclaim, so dropping the
            // completion here would strand the job in `handed_off` forever — fatal for a
            // `max_concurrency: 1` job (a stranded row blocks every future run).
            await this.statusReporter.reportWithRetry({ jobId, status, delayMs, error, handoffId, handedOffAtMs, workerId, runnerFailure, retryPersistErrors: true });
        }
        catch (reportError) {
            console.error("Background job status reporting failed:", reportError);
        }
    }
    /**
     * Fires a durable job-result report without blocking the caller (so freeing a
     * job/child slot never waits on the report). The report is tracked so a
     * graceful `stop()` can drain in-flight reports before closing the socket.
     * @param {object} args - Options.
     * @param {string} args.jobId - Job id.
     * @param {"completed" | "failed" | "rescheduled"} args.status - Status.
     * @param {number} [args.delayMs] - Reschedule delay in milliseconds.
     * @param {ReturnType<typeof JSON.parse>} [args.error] - Error.
     * @param {string} [args.handoffId] - Handoff lease id.
     * @param {number} [args.handedOffAtMs] - Handed off timestamp.
     * @param {string} [args.workerId] - Worker id.
     * @param {import("./types.js").PooledRunnerFailure} [args.runnerFailure] - Pooled-child process failure provenance.
     * @returns {void}
     */
    _reportJobResultInBackground({ jobId, status, delayMs, error, handoffId, handedOffAtMs, workerId, runnerFailure }) {
        /**
         * Defines report.
         * @type {Promise<void>} */
        let report;
        report = this._reportJobResult({ jobId, status, delayMs, error, handoffId, handedOffAtMs, workerId, runnerFailure }).finally(() => {
            this.inflightReports.delete(report);
        });
        this.inflightReports.add(report);
    }
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoid29ya2VyLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiLi4vLi4vLi4vc3JjL2JhY2tncm91bmQtam9icy93b3JrZXIuanMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6IkFBQUEsWUFBWTtBQUVaLE9BQU8sR0FBRyxNQUFNLEtBQUssQ0FBQTtBQUNyQixPQUFPLEVBQUUsSUFBSSxFQUFFLEtBQUssRUFBRSxNQUFNLG9CQUFvQixDQUFBO0FBQ2hELE9BQU8sVUFBVSxNQUFNLGtCQUFrQixDQUFBO0FBQ3pDLE9BQU8scUJBQXFCLE1BQU0sbUJBQW1CLENBQUE7QUFDckQsT0FBTyxxQkFBcUIsTUFBTSw4QkFBOEIsQ0FBQTtBQUNoRSxPQUFPLDRCQUE0QixNQUFNLHNCQUFzQixDQUFBO0FBQy9ELE9BQU8sRUFBRSxVQUFVLEVBQUUsTUFBTSxRQUFRLENBQUE7QUFDbkMsT0FBTyxFQUFFLGFBQWEsRUFBRSxNQUFNLFVBQVUsQ0FBQTtBQUN4QyxPQUFPLGlCQUFpQixFQUFFLEVBQUUsZ0JBQWdCLEVBQUUsTUFBTSxnQ0FBZ0MsQ0FBQTtBQUNwRixPQUFPLDZCQUE2QixNQUFNLHdCQUF3QixDQUFBO0FBQ2xFLE9BQU8sb0JBQW9CLE1BQU0sa0JBQWtCLENBQUE7QUFDbkQsT0FBTyxFQUFFLDJCQUEyQixFQUFFLE1BQU0sd0JBQXdCLENBQUE7QUFDcEUsT0FBTyxFQUFFLHdCQUF3QixFQUFFLE1BQU0sMEJBQTBCLENBQUE7QUFDbkUsT0FBTyw2Q0FBNkMsRUFBRSxFQUFFLHVDQUF1QyxFQUFFLG9DQUFvQyxFQUFFLE1BQU0seUNBQXlDLENBQUE7QUFFdEw7Ozs7Ozs7R0FPRztBQUNIOzs7Ozs7R0FNRztBQUNIOzs7Ozs7Ozs7Ozs7R0FZRztBQUNILGlGQUFpRjtBQUNqRixNQUFNLDZCQUE2QixHQUFHLElBQUksQ0FBQTtBQUMxQzs7Ozs7R0FLRztBQUNILE1BQU0seUJBQXlCLEdBQUcsYUFBYSxDQUFBO0FBQy9DLE1BQU0sd0JBQXdCLEdBQUcsYUFBYSxDQUFD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QUVWLE1BQU0sR0FBRyxJQUFJLENBQUMsZ0JBQWdCLENBQUMsRUFBQyxLQUFLLEVBQUUsTUFBTSxFQUFFLE9BQU8sRUFBRSxLQUFLLEVBQUUsU0FBUyxFQUFFLGFBQWEsRUFBRSxRQUFRLEVBQUUsYUFBYSxFQUFDLENBQUMsQ0FBQyxPQUFPLENBQUMsR0FBRyxFQUFFO1lBQzlILElBQUksQ0FBQyxlQUFlLENBQUMsTUFBTSxDQUFDLE1BQU0sQ0FBQyxDQUFBO1FBQ3JDLENBQUMsQ0FBQyxDQUFBO1FBRUYsSUFBSSxDQUFDLGVBQWUsQ0FBQyxHQUFHLENBQUMsTUFBTSxDQUFDLENBQUE7SUFDbEMsQ0FBQztDQUNGIiwic291cmNlc0NvbnRlbnQiOlsiLy8gQHRzLWNoZWNrXG5cbmltcG9ydCBuZXQgZnJvbSBcIm5ldFwiXG5pbXBvcnQgeyBmb3JrLCBzcGF3biB9IGZyb20gXCJub2RlOmNoaWxkX3Byb2Nlc3NcIlxuaW1wb3J0IEpzb25Tb2NrZXQgZnJvbSBcIi4vanNvbi1zb2NrZXQuanNcIlxuaW1wb3J0IEJhY2tncm91bmRKb2JSZWdpc3RyeSBmcm9tIFwiLi9qb2ItcmVnaXN0cnkuanNcIlxuaW1wb3J0IGNvbmZpZ3VyYXRpb25SZXNvbHZlciBmcm9tIFwiLi4vY29uZmlndXJhdGlvbi1yZXNvbHZlci5qc1wiXG5pbXBvcnQgQmFja2dyb3VuZEpvYnNTdGF0dXNSZXBvcnRlciBmcm9tIFwiLi9zdGF0dXMtcmVwb3J0ZXIuanNcIlxuaW1wb3J0IHsgcmFuZG9tVVVJRCB9IGZyb20gXCJjcnlwdG9cIlxuaW1wb3J0IHsgZmlsZVVSTFRvUGF0aCB9IGZyb20gXCJub2RlOnVybFwiXG5pbXBvcnQgc2h1dGRvd25MaWZlY3ljbGUsIHsgcnVuU2h1dGRvd25TdGVwcyB9IGZyb20gXCIuLi91dGlscy9zaHV0ZG93bi1saWZlY3ljbGUuanNcIlxuaW1wb3J0IEJhY2tncm91bmRKb2JSZXNjaGVkdWxlU2lnbmFsIGZyb20gXCIuL3Jlc2NoZWR1bGUtc2lnbmFsLmpzXCJcbmltcG9ydCBwZXJmb3JtQmFja2dyb3VuZEpvYiBmcm9tIFwiLi9wZXJmb3JtLWpvYi5qc1wiXG5pbXBvcnQgeyBydW5XaXRoQmFja2dyb3VuZEpvYlBheWxvYWQgfSBmcm9tIFwiLi9leGVjdXRpb24tY29udGV4dC5qc1wiXG5pbXBvcnQgeyBjcmVhdGVHZW5lcmF0aW9uV29ya2VySWQgfSBmcm9tIFwiLi9nZW5lcmF0aW9uLWlkZW50aXR5LmpzXCJcbmltcG9ydCBCYWNrZ3JvdW5kSm9ic0dlbmVyYXRpb25IYW5kc2hha2VUaW1lb3V0RXJyb3IsIHsgREVGQVVMVF9HRU5FUkFUSU9OX0hBTkRTSEFLRV9USU1FT1VUX01TLCB2YWxpZGF0ZUdlbmVyYXRpb25IYW5kc2hha2VUaW1lb3V0TXMgfSBmcm9tIFwiLi9nZW5lcmF0aW9uLWhhbmRzaGFrZS10aW1lb3V0LWVycm9yLmpzXCJcblxuLyoqXG4gKiBQZXItZm9ya2VkLWNoaWxkIHRpbWVvdXQgYm9va2tlZXBpbmcuXG4gKiBAdHlwZWRlZiB7b2JqZWN0fSBGb3JrZWRKb2JUaW1lb3V0U3RhdGVcbiAqIEBwcm9wZXJ0eSB7Ym9vbGVhbn0gdGltZWRPdXQgLSBXaGV0aGVyIHRoZSB0aW1lb3V0IGZpcmVkIGFuZCB0aGUgY2hpbGQgd2FzIHRlcm1pbmF0ZWQuXG4gKiBAcHJvcGVydHkge251bWJlciB8IG51bGx9IHRpbWVvdXRNcyAtIFRoZSBhcm1lZCB0aW1lb3V0IGluIG1zLCBvciBudWxsIHdoZW4gZGlzYWJsZWQuXG4gKiBAcHJvcGVydHkge1JldHVyblR5cGU8dHlwZW9mIHNldFRpbWVvdXQ+IHwgbnVsbH0gdGltZXIgLSBUaGUgcGVuZGluZyB0aW1lb3V0IHRpbWVyLCBjbGVhcmVkIG9uIGV4aXQuXG4gKiBAcHJvcGVydHkge1JldHVyblR5cGU8dHlwZW9mIHNldFRpbWVvdXQ+IHwgbnVsbH0gc2lna2lsbFRpbWVyIC0gVGhlIHBlbmRpbmcgU0lHS0lMTCBncmFjZSB0aW1lciwgY2xlYXJlZCBvbiBleGl0LlxuICovXG4vKipcbiAqIEB0eXBlZGVmIHtvYmplY3R9IFBvb2xlZEpvYkVudHJ5XG4gKiBAcHJvcGVydHkge2ltcG9ydChcIi4vdHlwZXMuanNcIikuQmFja2dyb3VuZEpvYlBheWxvYWQgJiB7aWQ6IHN0cmluZ319IHBheWxvYWQgLSBEdXJhYmxlIGpvYiBwYXlsb2FkLlxuICogQHByb3BlcnR5IHsodmFsdWU6IHZvaWQpID0+IHZvaWR9IFtyZXNvbHZlXSAtIENvbXBsZXRpb24gcmVzb2x2ZXIuXG4gKiBAcHJvcGVydHkge1Byb21pc2U8dm9pZD59IFtwb29sZWRKb2JdIC0gVHJhY2tlZCBwb29sZWQtam9iIHByb21pc2UuXG4gKiBAcHJvcGVydHkge1JldHVyblR5cGU8dHlwZW9mIHNldFRpbWVvdXQ+IHwgbnVsbH0gW3RpbWVvdXRUaW1lcl0gLSBQZXItam9iIHRpbWVvdXQgdGltZXIuXG4gKi9cbi8qKlxuICogQHR5cGVkZWYge29iamVjdH0gUG9vbGVkQ2hpbGRTdGF0ZVxuICogQHByb3BlcnR5IHtudW1iZXJ9IGNyZWF0ZWRBdE1zIC0gQ2hpbGQgY3JlYXRpb24gdGltZXN0YW1wLlxuICogQHByb3BlcnR5IHtudW1iZXJ9IGpvYnNSdW4gLSBBY2tub3dsZWRnZWQgam9icyBjb21wbGV0ZWQgYnkgdGhpcyBjaGlsZC5cbiAqIEBwcm9wZXJ0eSB7TWFwPHN0cmluZywgUG9vbGVkSm9iRW50cnk+fSBpbmZsaWdodCAtIEpvYnMgY3VycmVudGx5IG93bmVkIGJ5IHRoaXMgY2hpbGQuXG4gKiBAcHJvcGVydHkge251bWJlcn0gbGFzdERpc3BhdGNoU2VxIC0gUm91bmQtcm9iaW4gZGlzcGF0Y2ggc2VxdWVuY2UuXG4gKiBAcHJvcGVydHkge2Jvb2xlYW59IHJldGlyaW5nIC0gV2hldGhlciB0aGlzIGNoaWxkIGlzIGRyYWluaW5nIGJlZm9yZSByZXRpcmVtZW50LlxuICogQHByb3BlcnR5IHtib29sZWFufSBbc3RhcnRlZF0gLSBXaGV0aGVyIHRoZSBjaGlsZCBjb21wbGV0ZWQgaXRzIHN0YXJ0dXAgaGFuZHNoYWtlLlxuICogQHByb3BlcnR5IHtib29sZWFufSBbc2V0dGxpbmddIC0gV2hldGhlciBmYWlsdXJlIGhhbmRsaW5nIGFscmVhZHkgb3ducyB0aGlzIGNoaWxkLlxuICogQHByb3BlcnR5IHtSZXR1cm5UeXBlPHR5cGVvZiBzZXRUaW1lb3V0PiB8IG51bGx9IFt0aW1lb3V0U2lna2lsbFRpbWVyXSAtIFBlbmRpbmcgdGltZW91dCBTSUdLSUxMIHRpbWVyLlxuICogQHByb3BlcnR5IHtpbXBvcnQoXCIuL3R5cGVzLmpzXCIpLlBvb2xlZFJ1bm5lclRlcm1pbmF0aW9uUmVhc29ufSBbdGVybWluYXRpb25SZWFzb25dIC0gRXhwZWN0ZWQgdGVybWluYXRpb24gcmVhc29uLlxuICogQHByb3BlcnR5IHtzdHJpbmd9IFt0aW1lb3V0Sm9iSWRdIC0gSm9iIHdob3NlIHRpbWVvdXQgaW5pdGlhdGVkIHRlcm1pbmF0aW9uLlxuICovXG4vKiogR3JhY2UgcGVyaW9kIGFmdGVyIFNJR1RFUk0gYmVmb3JlIGEgbGluZ2VyaW5nIHByb2Nlc3MgcnVubmVyIGlzIFNJR0tJTExlZC4gKi9cbmNvbnN0IEZPUktFRF9DSElMRF9TSUdLSUxMX0dSQUNFX01TID0gNTAwMFxuLyoqXG4gKiBMYXJnZXN0IGRlbGF5IE5vZGUncyBgc2V0VGltZW91dGAgYWNjZXB0cyB3aXRob3V0IG92ZXJmbG93aW5nIHRvIGEgMW1zIGRlbGF5XG4gKiAoYSAzMi1iaXQgc2lnbmVkIGludCBvZiBtcywgfjI0LjggZGF5cykuIEEgYGpvYlRpbWVvdXRNc2AgYWJvdmUgdGhpcyDigJQgb3IgYVxuICogbm9uLWZpbml0ZSBvbmUgbGlrZSBgSW5maW5pdHlgIOKAlCBpcyBjbGFtcGVkL2Rpc2FibGVkIHJhdGhlciB0aGFuIGNvZXJjZWQgdG9cbiAqIH4xbXMsIHdoaWNoIHdvdWxkIG90aGVyd2lzZSB0ZXJtaW5hdGUgZXZlcnkgZm9ya2VkIGpvYiBhbG1vc3QgaW1tZWRpYXRlbHkuXG4gKi9cbmNvbnN0IE1BWF9GT1JLRURfSk9CX1RJTUVPVVRfTVMgPSAyXzE0N180ODNfNjQ3XG5jb25zdCBGT1JLRURfUlVOTkVSX0VOVFJZX1BBVEggPSBmaWxlVVJMVG9QYXRoKG5ldyBVUkwoXCIuL2ZvcmtlZC1ydW5uZXItY2hpbGQuanNcIiwgaW1wb3J0Lm1ldGEudXJsKSlcbmNvbnN0IFBPT0xFRF9SVU5ORVJfRU5UUllfUEFUSCA9IGZpbGVVUkxUb1BhdGgobmV3IFVSTChcIi4vcG9vbGVkLXJ1bm5lci1jaGlsZC5qc1wiLCBpbXBvcnQubWV0YS51cmwpKVxuLyoqIEhvdyBvZnRlbiB0aGUgd29ya2VyIHNlbmRzIGEgbGl2ZW5lc3MgaGVhcnRiZWF0IHRvIHRoZSBtYWluLiAqL1xuY29uc3QgSEVBUlRCRUFUX0lOVEVSVkFMX01TID0gMTUwMDBcbi8qKlxuICogTWF4IHRpbWUgdGhlIHdvcmtlciBzcGVuZHMgcmV0cnlpbmcgb25lIHBvb2xlZCBjaGlsZCdzIGFjY2VwdGFuY2UgcmVwb3J0XG4gKiBiZWZvcmUgZHJvcHBpbmcgaXQuIEFjY2VwdGFuY2UgZXZpZGVuY2UgaXMgZGlhZ25vc3RpYyDigJQgYSBwZXJzaXN0ZW50XG4gKiBtYWluL0RCIG91dGFnZSBtdXN0IG5vdCBob2xkIHJ1bm5lciBjYXBhY2l0eSBob3N0YWdlLlxuICovXG5jb25zdCBDSElMRF9BQ0NFUFRBTkNFX1JFUE9SVF9NQVhfRFVSQVRJT05fTVMgPSAxMDAwMFxuLyoqIFRDUCBrZWVwYWxpdmUgc28gYSBoYWxmLW9wZW4gY29ubmVjdGlvbiB0byB0aGUgbWFpbiBzdXJmYWNlcyBhcyBhIGNsb3NlLiAqL1xuY29uc3QgU09DS0VUX0tFRVBBTElWRV9NUyA9IDEwMDAwXG4vKipcbiAqIEV4ZWN1dGlvbiBtb2Rlcy5cbiAqIEB0eXBlIHtpbXBvcnQoXCIuL3R5cGVzLmpzXCIpLkJhY2tncm91bmRKb2JFeGVjdXRpb25Nb2RlW119ICovXG5jb25zdCBFWEVDVVRJT05fTU9ERVMgPSBbXCJpbmxpbmVcIiwgXCJmb3JrZWRcIiwgXCJwb29sZWRcIiwgXCJzcGF3bmVkXCJdXG5cbi8qKlxuICogTm9ybWFsaXplcyBhIGNhbmRpZGF0ZSBwb29sZWQtcnVubmVyIGNvdW50IG9yIGpvYiBsaW1pdC5cbiAqIEBwYXJhbSB7bnVtYmVyIHwgdW5kZWZpbmVkfSB2YWx1ZSAtIENhbmRpZGF0ZSBwb3NpdGl2ZSBpbnRlZ2VyLlxuICogQHJldHVybnMge251bWJlciB8IHVuZGVmaW5lZH0gLSBOb3JtYWxpemVkIHZhbHVlLlxuICovXG5mdW5jdGlvbiBwb3NpdGl2ZUludGVnZXIodmFsdWUpIHtcbiAgcmV0dXJuIHR5cGVvZiB2YWx1ZSA9PT0gXCJudW1iZXJcIiAmJiBOdW1iZXIuaXNJbnRlZ2VyKHZhbHVlKSAmJiB2YWx1ZSA+IDAgPyB2YWx1ZSA6IHVuZGVmaW5lZFxufVxuXG4vKipcbiAqIENoZWNrcyB3aGV0aGVyIGFuIElQQyB2YWx1ZSBpcyBhIHBvb2xlZCBjaGlsZCdzIGFjY2VwdGFuY2Ugb2JzZXJ2YXRpb24gZm9yXG4gKiBvbmUgam9iLiBUaGUgY2hpbGQgY2FycmllcyBpdHMgZXhhY3QgaGFuZG9mZiBsZWFzZSBzbyB0aGUgd29ya2VyIGNhbiBmb3J3YXJkXG4gKiB0aGUgcmVwb3J0IHdpdGhvdXQgZGVwZW5kaW5nIG9uIGl0cyBpbi1mbGlnaHQgZW50cnkgc3RpbGwgZXhpc3RpbmcuXG4gKiBAcGFyYW0ge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSBtZXNzYWdlIC0gSVBDIG1lc3NhZ2UuXG4gKiBAcmV0dXJucyB7bWVzc2FnZSBpcyB7dHlwZTogXCJqb2ItcmVjZWl2ZWRcIiB8IFwiam9iLXN0YXJ0ZWRcIiwgam9iSWQ6IHN0cmluZywgaGFuZG9mZklkPzogc3RyaW5nLCB3b3JrZXJJZD86IHN0cmluZywgaGFuZGVkT2ZmQXRNcz86IG51bWJlciwgcmVjZWl2ZWRBdE1zPzogbnVtYmVyLCBzdGFydGVkQXRNcz86IG51bWJlciwgY2hpbGRJbnN0YW5jZUlkPzogc3RyaW5nLCBjaGlsZFBpZD86IG51bWJlcn19IC0gV2hldGhlciB0aGlzIGlzIGEgdmFsaWQgYWNjZXB0YW5jZSBtZXNzYWdlLlxuICovXG5mdW5jdGlvbiBpc0NoaWxkQWNjZXB0YW5jZU1lc3NhZ2UobWVzc2FnZSkge1xuICBpZiAoIW1lc3NhZ2UgfHwgdHlwZW9mIG1lc3NhZ2UgIT09IFwib2JqZWN0XCIpIHJldHVybiBmYWxzZVxuICBjb25zdCByZWNvcmQgPSAvKiogQHR5cGUge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gKi8gKG1lc3NhZ2UpXG5cbiAgcmV0dXJuIChyZWNvcmQudHlwZSA9PT0gXCJqb2ItcmVjZWl2ZWRcIiB8fCByZWNvcmQudHlwZSA9PT0gXCJqb2Itc3RhcnRlZFwiKVxuICAgICYmIHR5cGVvZiByZWNvcmQuam9iSWQgPT09IFwic3RyaW5nXCJcbiAgICAmJiAocmVjb3JkLmhhbmRvZmZJZCA9PT0gdW5kZWZpbmVkIHx8IHR5cGVvZiByZWNvcmQuaGFuZG9mZklkID09PSBcInN0cmluZ1wiKVxuICAgICYmIChyZWNvcmQud29ya2VySWQgPT09IHVuZGVmaW5lZCB8fCB0eXBlb2YgcmVjb3JkLndvcmtlcklkID09PSBcInN0cmluZ1wiKVxuICAgICYmIChyZWNvcmQuaGFuZGVkT2ZmQXRNcyA9PT0gdW5kZWZpbmVkIHx8IHR5cGVvZiByZWNvcmQuaGFuZGVkT2ZmQXRNcyA9PT0gXCJudW1iZXJcIilcbiAgICAmJiAocmVjb3JkLnJlY2VpdmVkQXRNcyA9PT0gdW5kZWZpbmVkIHx8IHR5cGVvZiByZWNvcmQucmVjZWl2ZWRBdE1zID09PSBcIm51bWJlclwiKVxuICAgICYmIChyZWNvcmQuc3RhcnRlZEF0TXMgPT09IHVuZGVmaW5lZCB8fCB0eXBlb2YgcmVjb3JkLnN0YXJ0ZWRBdE1zID09PSBcIm51bWJlclwiKVxuICAgICYmIChyZWNvcmQuY2hpbGRJbnN0YW5jZUlkID09PSB1bmRlZmluZWQgfHwgdHlwZW9mIHJlY29yZC5jaGlsZEluc3RhbmNlSWQgPT09IFwic3RyaW5nXCIpXG4gICAgJiYgKHJlY29yZC5jaGlsZFBpZCA9PT0gdW5kZWZpbmVkIHx8IE51bWJlci5pc0ludGVnZXIocmVjb3JkLmNoaWxkUGlkKSlcbn1cblxuLyoqXG4gKiBOb3JtYWxpemVzIGEgY2FuZGlkYXRlIHBvb2xlZC1ydW5uZXIgcmVzb3VyY2UgbGltaXQuXG4gKiBAcGFyYW0ge251bWJlciB8IHVuZGVmaW5lZH0gdmFsdWUgLSBDYW5kaWRhdGUgcG9zaXRpdmUgbnVtYmVyLlxuICogQHJldHVybnMge251bWJlciB8IHVuZGVmaW5lZH0gLSBOb3JtYWxpemVkIHZhbHVlLlxuICovXG5mdW5jdGlvbiBwb3NpdGl2ZU51bWJlcih2YWx1ZSkge1xuICByZXR1cm4gdHlwZW9mIHZhbHVlID09PSBcIm51bWJlclwiICYmIE51bWJlci5pc0Zpbml0ZSh2YWx1ZSkgJiYgdmFsdWUgPiAwID8gdmFsdWUgOiB1bmRlZmluZWRcbn1cblxuZXhwb3J0IGRlZmF1bHQgY2xhc3MgQmFja2dyb3VuZEpvYnNXb3JrZXIge1xuICAvKipcbiAgICogUnVucyBjb25zdHJ1Y3Rvci5cbiAgICogQHBhcmFtIHtvYmplY3R9IFthcmdzXSAtIE9wdGlvbnMuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vY29uZmlndXJhdGlvbi5qc1wiKS5kZWZhdWx0fSBbYXJncy5jb25maWd1cmF0aW9uXSAtIENvbmZpZ3VyYXRpb24uXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBbYXJncy5ob3N0XSAtIEhvc3RuYW1lLlxuICAgKiBAcGFyYW0ge251bWJlcn0gW2FyZ3MucG9ydF0gLSBQb3J0LlxuICAgKiBAcGFyYW0ge3N0cmluZ30gW2FyZ3MuZ2VuZXJhdGlvbklkXSAtIEV4cGxpY2l0IHJlbGVhc2UgZ2VuZXJhdGlvbiBpZGVudGl0eS5cbiAgICogQHBhcmFtIHtzdHJpbmd9IFthcmdzLndvcmtlckluc3RhbmNlSWRdIC0gRXhwbGljaXQgc3RhYmxlIHdvcmtlciBVVUlELlxuICAgKiBAcGFyYW0ge251bWJlcn0gW2FyZ3MubWF4Q29uY3VycmVudEZvcmtlZEpvYnNdIC0gT3ZlcnJpZGUgdGhlIHByb2Nlc3MgcnVubmVyIGNvbmN1cnJlbmN5IGNhcCBmcm9tIGBjb25maWd1cmF0aW9uLmdldEJhY2tncm91bmRKb2JzQ29uZmlnKClgLlxuICAgKiBAcGFyYW0ge251bWJlcn0gW2FyZ3MubWF4Q29uY3VycmVudElubGluZUpvYnNdIC0gT3ZlcnJpZGUgdGhlIGlubGluZS1qb2IgY29uY3VycmVuY3kgY2FwIGZyb20gYGNvbmZpZ3VyYXRpb24uZ2V0QmFja2dyb3VuZEpvYnNDb25maWcoKWAuXG4gICAqIEBwYXJhbSB7bnVtYmVyfSBbYXJncy5wb29sZWRSdW5uZXJDb3VudF0gLSBPdmVycmlkZSB0aGUgcG9vbGVkIHJ1bm5lciBjb3VudC5cbiAgICogQHBhcmFtIHtudW1iZXJ9IFthcmdzLnBvb2xlZFJ1bm5lckNvbmN1cnJlbmN5XSAtIE92ZXJyaWRlIHRoZSBwZXItcnVubmVyIGNvbmN1cnJlbmN5LlxuICAgKiBAcGFyYW0ge251bWJlcn0gW2FyZ3MucG9vbGVkUnVubmVyTWF4Sm9ic10gLSBPdmVycmlkZSB0aGUgcGVyLXJ1bm5lciByZWN5Y2xlIGpvYiBjb3VudC5cbiAgICogQHBhcmFtIHtudW1iZXJ9IFthcmdzLnBvb2xlZFJ1bm5lck1heFJzc0J5dGVzXSAtIE92ZXJyaWRlIHRoZSBwZXItcnVubmVyIHJlY3ljbGUgUlNTIGxpbWl0LlxuICAgKiBAcGFyYW0ge251bWJlcn0gW2FyZ3MucG9vbGVkUnVubmVyTWF4TGlmZXRpbWVNc10gLSBPdmVycmlkZSB0aGUgcGVyLXJ1bm5lciByZWN5Y2xlIGxpZmV0aW1lLlxuICAgKiBAcGFyYW0ge251bWJlcn0gW2FyZ3MuZm9ya2VkQ2hpbGRTaWdraWxsR3JhY2VNc10gLSBPdmVycmlkZSB0aGUgZ3JhY2UgcGVyaW9kIGJldHdlZW4gU0lHVEVSTSBhbmQgU0lHS0lMTCB3aGVuIHJlYXBpbmcgbGluZ2VyaW5nIHByb2Nlc3MgcnVubmVycyBvbiBzdG9wLlxuICAgKiBAcGFyYW0ge251bWJlcn0gW2FyZ3MuaGVhcnRiZWF0SW50ZXJ2YWxNc10gLSBPdmVycmlkZSB0aGUgbGl2ZW5lc3MgaGVhcnRiZWF0IGludGVydmFsIChkZWZhdWx0IDE1MDAwbXMpLlxuICAgKiBAcGFyYW0ge251bWJlcn0gW2FyZ3MuZ2VuZXJhdGlvbkhhbmRzaGFrZVRpbWVvdXRNc10gLSBNYXhpbXVtIHRpbWUgdG8gd2FpdCBmb3IgZ2VuZXJhdGlvbiBhY2tub3dsZWRnZW1lbnQgKGRlZmF1bHQ6IDQwMDApLlxuICAgKiBAcGFyYW0ge251bWJlcn0gW2FyZ3MucmVjb25uZWN0RGVsYXlNc10gLSBEZWxheSBiZWZvcmUgcmVjb25uZWN0aW5nIGFuIGVzdGFibGlzaGVkIHdvcmtlciBjb25uZWN0aW9uIChkZWZhdWx0OiAxMDAwKS5cbiAgICogQHBhcmFtIHtudW1iZXJ9IFthcmdzLmpvYlRpbWVvdXRNc10gLSBPdmVycmlkZSB0aGUgd2FsbC1jbG9jayB0aW1lb3V0IGZvciBmb3JrZWQgYW5kIHBvb2xlZCBqb2JzIGZyb20gYGNvbmZpZ3VyYXRpb24uZ2V0QmFja2dyb3VuZEpvYnNDb25maWcoKWAuIGAwYCBkaXNhYmxlcyBpdC5cbiAgICogQHBhcmFtIHtib29sZWFufSBbYXJncy5jbG9zZURhdGFiYXNlQ29ubmVjdGlvbnNPblN0b3BdIC0gV2hldGhlciBzdG9wIG93bnMgY2xvc2luZyB0aGUgY29uZmlndXJhdGlvbidzIGRhdGFiYXNlIHBvb2xzIChkZWZhdWx0IHRydWUpLlxuICAgKiBAcGFyYW0geygpID0+IHZvaWQgfCBQcm9taXNlPHZvaWQ+fSBbYXJncy5vblN0b3BwZWRdIC0gTGlmZWN5Y2xlIGhvb2sgaW52b2tlZCBhZnRlciB0aGUgd29ya2VyIGZpbmlzaGVzIHN0b3BwaW5nLlxuICAgKiBAcGFyYW0geygpID0+IHZvaWR9IFthcmdzLm9uR2VuZXJhdGlvbkFjY2VwdGVkXSAtIEV4cGxpY2l0IGdlbmVyYXRpb24tYWNjZXB0YW5jZSBvYnNlcnZhdGlvbiBob29rLlxuICAgKiBAcGFyYW0geygpID0+IHZvaWR9IFthcmdzLm9uUmV0aXJlTWVzc2FnZV0gLSBFeHBsaWNpdCByZXRpcmUtbWVzc2FnZSBvYnNlcnZhdGlvbiBob29rLlxuICAgKi9cbiAgY29uc3RydWN0b3Ioe2NvbmZpZ3VyYXRpb24sIGhvc3QsIHBvcnQsIGdlbmVyYXRpb25JZCwgd29ya2VySW5zdGFuY2VJZCwgbWF4Q29uY3VycmVudEZvcmtlZEpvYnMsIG1heENvbmN1cnJlbnRJbmxpbmVKb2JzLCBwb29sZWRSdW5uZXJDb3VudCwgcG9vbGVkUnVubmVyQ29uY3VycmVuY3ksIHBvb2xlZFJ1bm5lck1heEpvYnMsIHBvb2xlZFJ1bm5lck1heFJzc0J5dGVzLCBwb29sZWRSdW5uZXJNYXhMaWZldGltZU1zLCBmb3JrZWRDaGlsZFNpZ2tpbGxHcmFjZU1zLCBoZWFydGJlYXRJbnRlcnZhbE1zLCBnZW5lcmF0aW9uSGFuZHNoYWtlVGltZW91dE1zID0gREVGQVVMVF9HRU5FUkFUSU9OX0hBTkRTSEFLRV9USU1FT1VUX01TLCByZWNvbm5lY3REZWxheU1zID0gMTAwMCwgam9iVGltZW91dE1zLCBjbG9zZURhdGFiYXNlQ29ubmVjdGlvbnNPblN0b3AgPSB0cnVlLCBvblN0b3BwZWQsIG9uR2VuZXJhdGlvbkFjY2VwdGVkLCBvblJldGlyZU1lc3NhZ2V9ID0ge30pIHtcbiAgICAvKipcbiAgICAgKiBOYXJyb3dzIHRoZSBydW50aW1lIHZhbHVlIHRvIHRoZSBkb2N1bWVudGVkIHR5cGUuXG4gICAgICogQHR5cGUge1Byb21pc2U8aW1wb3J0KFwiLi4vY29uZmlndXJhdGlvbi5qc1wiKS5kZWZhdWx0Pn0gKi9cbiAgICB0aGlzLmNvbmZpZ3VyYXRpb25Qcm9taXNlID0gY29uZmlndXJhdGlvbiA/IFByb21pc2UucmVzb2x2ZShjb25maWd1cmF0aW9uKSA6IGNvbmZpZ3VyYXRpb25SZXNvbHZlcigpXG4gICAgLyoqXG4gICAgICogTmFycm93cyB0aGUgcnVudGltZSB2YWx1ZSB0byB0aGUgZG9jdW1lbnRlZCB0eXBlLlxuICAgICAqIEB0eXBlIHtpbXBvcnQoXCIuLi9jb25maWd1cmF0aW9uLmpzXCIpLmRlZmF1bHQgfCB1bmRlZmluZWR9ICovXG4gICAgdGhpcy5jb25maWd1cmF0aW9uID0gdW5kZWZpbmVkXG4gICAgdGhpcy5ob3N0ID0gaG9zdFxuICAgIHRoaXMucG9ydCA9IHBvcnRcbiAgICB0aGlzLmV4cGxpY2l0R2VuZXJhdGlvbklkID0gZ2VuZXJhdGlvbklkXG4gICAgdGhpcy53b3JrZXJJbnN0YW5jZUlkID0gd29ya2VySW5zdGFuY2VJZCB8fCByYW5kb21VVUlEKClcbiAgICAvKiogQHR5cGUge3N0cmluZyB8IHVuZGVmaW5lZH0gKi9cbiAgICB0aGlzLmdlbmVyYXRpb25JZCA9IHVuZGVmaW5lZFxuICAgIHRoaXMuY2xvc2VEYXRhYmFzZUNvbm5lY3Rpb25zT25TdG9wID0gY2xvc2VEYXRhYmFzZUNvbm5lY3Rpb25zT25TdG9wXG4gICAgdGhpcy5vblN0b3BwZWQgPSBvblN0b3BwZWRcbiAgICB0aGlzLm9uR2VuZXJhdGlvbkFjY2VwdGVkID0gb25HZW5lcmF0aW9uQWNjZXB0ZWRcbiAgICB0aGlzLm9uUmV0aXJlTWVzc2FnZSA9IG9uUmV0aXJlTWVzc2FnZVxuICAgIC8qKlxuICAgICAqIENvbnN0cnVjdG9yIG92ZXJyaWRlIGZvciB0aGUgaW5saW5lLWpvYiBjb25jdXJyZW5jeSBjYXAuIFdoZW4gdW5zZXRcbiAgICAgKiB0aGUgY2FwIGlzIHJlYWQgZnJvbSBgY29uZmlndXJhdGlvbi5nZXRCYWNrZ3JvdW5kSm9ic0NvbmZpZygpYCBpblxuICAgICAqIGBzdGFydCgpYCAoZGVmYXVsdDogNCkuXG4gICAgICogQHR5cGUge251bWJlciB8IHVuZGVmaW5lZH1cbiAgICAgKi9cbiAgICB0aGlzLm1heENvbmN1cnJlbnRJbmxpbmVKb2JzT3ZlcnJpZGUgPSB0eXBlb2YgbWF4Q29uY3VycmVudElubGluZUpvYnMgPT09IFwibnVtYmVyXCIgJiYgbWF4Q29uY3VycmVudElubGluZUpvYnMgPj0gMVxuICAgICAgPyBtYXhDb25jdXJyZW50SW5saW5lSm9ic1xuICAgICAgOiB1bmRlZmluZWRcbiAgICAvKipcbiAgICAgKiBOYXJyb3dzIHRoZSBydW50aW1lIHZhbHVlIHRvIHRoZSBkb2N1bWVudGVkIHR5cGUuXG4gICAgICogQHR5cGUge251bWJlciB8IHVuZGVmaW5lZH0gKi9cbiAgICB0aGlzLm1heENvbmN1cnJlbnRGb3JrZWRKb2JzT3ZlcnJpZGUgPSB0eXBlb2YgbWF4Q29uY3VycmVudEZvcmtlZEpvYnMgPT09IFwibnVtYmVyXCIgJiYgbWF4Q29uY3VycmVudEZvcmtlZEpvYnMgPj0gMVxuICAgICAgPyBtYXhDb25jdXJyZW50Rm9ya2VkSm9ic1xuICAgICAgOiB1bmRlZmluZWRcbiAgICAvKipcbiAgICAgKiBSZXNvbHZlZCBjYXAgZm9yIGlubGluZS1qb2IgY29uY3VycmVuY3kuIFNldCBpbiBgc3RhcnQoKWA7IGRlZmF1bHRzIHRvXG4gICAgICogNCBpZiBubyBjb25maWd1cmF0aW9uIHZhbHVlIGlzIGF2YWlsYWJsZS5cbiAgICAgKiBAdHlwZSB7bnVtYmVyfVxuICAgICAqL1xuICAgIHRoaXMubWF4Q29uY3VycmVudElubGluZUpvYnMgPSB0aGlzLm1heENvbmN1cnJlbnRJbmxpbmVKb2JzT3ZlcnJpZGUgfHwgNFxuICAgIC8qKlxuICAgICAqIE5hcnJvd3MgdGhlIHJ1bnRpbWUgdmFsdWUgdG8gdGhlIGRvY3VtZW50ZWQgdHlwZS5cbiAgICAgKiBAdHlwZSB7bnVtYmVyfSAqL1xuICAgIHRoaXMubWF4Q29uY3VycmVudEZvcmtlZEpvYnMgPSB0aGlzLm1heENvbmN1cnJlbnRGb3JrZWRKb2JzT3ZlcnJpZGUgfHwgNFxuICAgIHRoaXMucG9vbGVkUnVubmVyQ291bnRPdmVycmlkZSA9IHBvc2l0aXZlSW50ZWdlcihwb29sZWRSdW5uZXJDb3VudClcbiAgICB0aGlzLnBvb2xlZFJ1bm5lckNvbmN1cnJlbmN5T3ZlcnJpZGUgPSBwb3NpdGl2ZUludGVnZXIocG9vbGVkUnVubmVyQ29uY3VycmVuY3kpXG4gICAgdGhpcy5wb29sZWRSdW5uZXJNYXhKb2JzT3ZlcnJpZGUgPSBwb3NpdGl2ZUludGVnZXIocG9vbGVkUnVubmVyTWF4Sm9icylcbiAgICB0aGlzLnBvb2xlZFJ1bm5lck1heFJzc0J5dGVzT3ZlcnJpZGUgPSBwb3NpdGl2ZU51bWJlcihwb29sZWRSdW5uZXJNYXhSc3NCeXRlcylcbiAgICB0aGlzLnBvb2xlZFJ1bm5lck1heExpZmV0aW1lTXNPdmVycmlkZSA9IHBvc2l0aXZlTnVtYmVyKHBvb2xlZFJ1bm5lck1heExpZmV0aW1lTXMpXG4gICAgdGhpcy5wb29sZWRSdW5uZXJDb3VudCA9IHRoaXMucG9vbGVkUnVubmVyQ291bnRPdmVycmlkZSB8fCA0XG4gICAgdGhpcy5wb29sZWRSdW5uZXJDb25jdXJyZW5jeSA9IHRoaXMucG9vbGVkUnVubmVyQ29uY3VycmVuY3lPdmVycmlkZSB8fCAxXG4gICAgdGhpcy5wb29sZWRSdW5uZXJNYXhKb2JzID0gdGhpcy5wb29sZWRSdW5uZXJNYXhKb2JzT3ZlcnJpZGUgfHwgMTAwXG4gICAgdGhpcy5wb29sZWRSdW5uZXJNYXhSc3NCeXRlcyA9IHRoaXMucG9vbGVkUnVubmVyTWF4UnNzQnl0ZXNPdmVycmlkZSB8fCA1MTIgKiAxMDI0ICogMTAyNFxuICAgIHRoaXMucG9vbGVkUnVubmVyTWF4TGlmZXRpbWVNcyA9IHRoaXMucG9vbGVkUnVubmVyTWF4TGlmZXRpbWVNc092ZXJyaWRlIHx8IDYwICogNjAgKiAxMDAwXG4gICAgLyoqXG4gICAgICogR3JhY2UgcGVyaW9kIGJldHdlZW4gU0lHVEVSTSBhbmQgU0lHS0lMTCB3aGVuIHJlYXBpbmcgcHJvY2VzcyBydW5uZXJzIHRoYXRcbiAgICAgKiBvdXRsYXN0IGEgYm91bmRlZCBzaHV0ZG93biBkcmFpbi5cbiAgICAgKiBAdHlwZSB7bnVtYmVyfVxuICAgICAqL1xuICAgIHRoaXMuZm9ya2VkQ2hpbGRTaWdraWxsR3JhY2VNcyA9IHR5cGVvZiBmb3JrZWRDaGlsZFNpZ2tpbGxHcmFjZU1zID09PSBcIm51bWJlclwiICYmIGZvcmtlZENoaWxkU2lna2lsbEdyYWNlTXMgPj0gMFxuICAgICAgPyBmb3JrZWRDaGlsZFNpZ2tpbGxHcmFjZU1zXG4gICAgICA6IEZPUktFRF9DSElMRF9TSUdLSUxMX0dSQUNFX01TXG4gICAgLyoqXG4gICAgICogQ29uc3RydWN0b3Igb3ZlcnJpZGUgZm9yIHRoZSBmb3JrZWQgYW5kIHBvb2xlZCB3YWxsLWNsb2NrIGpvYiB0aW1lb3V0LiBXaGVuIHVuc2V0IHRoZVxuICAgICAqIHRpbWVvdXQgaXMgcmVhZCBmcm9tIGBjb25maWd1cmF0aW9uLmdldEJhY2tncm91bmRKb2JzQ29uZmlnKCkuam9iVGltZW91dE1zYFxuICAgICAqIGF0IGZvcmsgdGltZSAoZGVmYXVsdDogZGlzYWJsZWQpLlxuICAgICAqIEB0eXBlIHtudW1iZXIgfCB1bmRlZmluZWR9XG4gICAgICovXG4gICAgdGhpcy5qb2JUaW1lb3V0TXNPdmVycmlkZSA9IHR5cGVvZiBqb2JUaW1lb3V0TXMgPT09IFwibnVtYmVyXCIgPyBqb2JUaW1lb3V0TXMgOiB1bmRlZmluZWRcbiAgICB0aGlzLnNob3VsZFN0b3AgPSBmYWxzZVxuICAgIHRoaXMuaXNSZXRpcmluZyA9IGZhbHNlXG4gICAgLyoqIEB0eXBlIHtQcm9taXNlPHZvaWQ+IHwgdW5kZWZpbmVkfSAqL1xuICAgIHRoaXMuc3RvcFByb21pc2UgPSB1bmRlZmluZWRcbiAgICAvKipcbiAgICAgKiBSZXNvbHZlcyBzdG9wIG9ic2VydmF0aW9uLlxuICAgICAqIEB0eXBlIHsodmFsdWU/OiB2b2lkKSA9PiB2b2lkfVxuICAgICAqL1xuICAgIHRoaXMuX3Jlc29sdmVTdG9wcGVkID0gKCkgPT4ge31cbiAgICAvKipcbiAgICAgKiBSZWplY3RzIHN0b3Agb2JzZXJ2YXRpb24uXG4gICAgICogQHR5cGUgeyhlcnJvcjogRXJyb3IpID0+IHZvaWR9XG4gICAgICovXG4gICAgdGhpcy5fcmVqZWN0U3RvcHBlZCA9ICgpID0+IHt9XG4gICAgLyoqIEB0eXBlIHtQcm9taXNlPHZvaWQ+fSAqL1xuICAgIHRoaXMuX3N0b3BwZWRQcm9taXNlID0gUHJvbWlzZS5yZXNvbHZlKClcbiAgICB0aGlzLl9yZXNldFN0b3BwZWRQcm9taXNlKClcbiAgICB0aGlzLndvcmtlcklkID0gdGhpcy53b3JrZXJJbnN0YW5jZUlkXG4gICAgdGhpcy5fZ2VuZXJhdGlvbkFjY2VwdGVkID0gZmFsc2VcbiAgICB0aGlzLmdlbmVyYXRpb25IYW5kc2hha2VUaW1lb3V0TXMgPSB2YWxpZGF0ZUdlbmVyYXRpb25IYW5kc2hha2VUaW1lb3V0TXMoZ2VuZXJhdGlvbkhhbmRzaGFrZVRpbWVvdXRNcylcbiAgICBpZiAoIU51bWJlci5pc0ludGVnZXIocmVjb25uZWN0RGVsYXlNcykgfHwgcmVjb25uZWN0RGVsYXlNcyA8IDAgfHwgcmVjb25uZWN0RGVsYXlNcyA+IE1BWF9GT1JLRURfSk9CX1RJTUVPVVRfTVMpIHtcbiAgICAgIHRocm93IG5ldyBUeXBlRXJyb3IoXCJyZWNvbm5lY3REZWxheU1zIG11c3QgYmUgYW4gaW50ZWdlciBiZXR3ZWVuIDAgYW5kIDIxNDc0ODM2NDdcIilcbiAgICB9XG4gICAgdGhpcy5yZWNvbm5lY3REZWxheU1zID0gcmVjb25uZWN0RGVsYXlNc1xuICAgIC8qKiBAdHlwZSB7UmV0dXJuVHlwZTx0eXBlb2Ygc2V0VGltZW91dD4gfCB1bmRlZmluZWR9ICovXG4gICAgdGhpcy5fcmVjb25uZWN0VGltZXIgPSB1bmRlZmluZWRcbiAgICB0aGlzLmhlYXJ0YmVhdEludGVydmFsTXMgPSB0eXBlb2YgaGVhcnRiZWF0SW50ZXJ2YWxNcyA9PT0gXCJudW1iZXJcIiAmJiBoZWFydGJlYXRJbnRlcnZhbE1zID49IDFcbiAgICAgID8gaGVhcnRiZWF0SW50ZXJ2YWxNc1xuICAgICAgOiBIRUFSVEJFQVRfSU5URVJWQUxfTVNcbiAgICAvKipcbiAgICAgKiBOYXJyb3dzIHRoZSBydW50aW1lIHZhbHVlIHRvIHRoZSBkb2N1bWVudGVkIHR5cGUuXG4gICAgICogQHR5cGUge1JldHVyblR5cGU8dHlwZW9mIHNldEludGVydmFsPiB8IHVuZGVmaW5lZH0gKi9cbiAgICB0aGlzLl9oZWFydGJlYXRUaW1lciA9IHVuZGVmaW5lZFxuICAgIC8qKlxuICAgICAqIEluLWZsaWdodCBqb2ItcmVzdWx0IHJlcG9ydHMgdG8gdGhlIG1haW4uIFJlcG9ydGluZyBpcyBkZWNvdXBsZWQgZnJvbSB0aGVcbiAgICAgKiBqb2IvY2hpbGQgc2xvdCAoZnJlZWluZyB0aGUgc2xvdCBuZXZlciB3YWl0cyBvbiBhIHJlcG9ydCkgYW5kIHJldHJpZWRcbiAgICAgKiBkdXJhYmx5LCBzbyBhIHRyYW5zaWVudCBtYWluL0RCIG91dGFnZSBjYW5ub3QgbGVhayBzbG90cyBvciBsb3NlIGFcbiAgICAgKiB0ZXJtaW5hbCByZXBvcnQuIFRyYWNrZWQgc28gYSBncmFjZWZ1bCBgc3RvcCgpYCBjYW4gZHJhaW4gdGhlbS5cbiAgICAgKiBAdHlwZSB7U2V0PFByb21pc2U8dm9pZD4+fVxuICAgICAqL1xuICAgIHRoaXMuaW5mbGlnaHRSZXBvcnRzID0gbmV3IFNldCgpXG4gICAgLyoqXG4gICAgICogTmFycm93cyB0aGUgcnVudGltZSB2YWx1ZSB0byB0aGUgZG9jdW1lbnRlZCB0eXBlLlxuICAgICAqIEB0eXBlIHtKc29uU29ja2V0IHwgdW5kZWZpbmVkfSAqL1xuICAgIHRoaXMuanNvblNvY2tldCA9IHVuZGVmaW5lZFxuICAgIC8qKlxuICAgICAqIE5hcnJvd3MgdGhlIHJ1bnRpbWUgdmFsdWUgdG8gdGhlIGRvY3VtZW50ZWQgdHlwZS5cbiAgICAgKiBAdHlwZSB7QmFja2dyb3VuZEpvYnNTdGF0dXNSZXBvcnRlciB8IHVuZGVmaW5lZH0gKi9cbiAgICB0aGlzLnN0YXR1c1JlcG9ydGVyID0gdW5kZWZpbmVkXG4gICAgLyoqXG4gICAgICogVXAgdG8gYHRoaXMubWF4Q29uY3VycmVudElubGluZUpvYnNgIG9mIHRoZXNlIHJ1biBpbiBwYXJhbGxlbC4gVGhleVxuICAgICAqIHNoYXJlIHRoZSB3b3JrZXIncyBwcm9jZXNzIGFuZCBEQiBjb25uZWN0aW9uIHBvb2wsIHNvIGNvbmN1cnJlbmN5IGlzXG4gICAgICogYWJvdXQgb3ZlcmxhcHBpbmcgSS9PIHdhaXRzIOKAlCB1c2UgZm9ya2luZyBmb3IgbWVtb3J5IGlzb2xhdGlvbiBhY3Jvc3NcbiAgICAgKiBsb25nLXJ1bm5pbmcgam9icyBhbmQgZm9yIHVzaW5nIG1vcmUgY29yZXMuXG4gICAgICogQHR5cGUge1NldDxQcm9taXNlPHZvaWQ+Pn1cbiAgICAgKi9cbiAgICB0aGlzLmluZmxpZ2h0SW5saW5lSm9icyA9IG5ldyBTZXQoKVxuICAgIC8qKlxuICAgICAqIEluLWZsaWdodCBwcm9jZXNzIHJ1bm5lciBleGl0IHByb21pc2VzLiBUcmFja2VkIHNvIHByb2Nlc3Mtam9iIGhhbmRvZmZcbiAgICAgKiBzdGF5cyBib3VuZGVkIHdoaWxlIHJ1bm5pbmcgYW5kIHNvIGEgZ3JhY2VmdWwgYHN0b3AoKWAgY2FuIGRyYWluIHRoZW0uXG4gICAgICogQHR5cGUge1NldDxQcm9taXNlPHZvaWQ+Pn1cbiAgICAgKi9cbiAgICB0aGlzLmluZmxpZ2h0UHJvY2Vzc0pvYnMgPSBuZXcgU2V0KClcbiAgICAvKipcbiAgICAgKiBMaXZlIHByb2Nlc3MgcnVubmVyIGNoaWxkIHByb2Nlc3Nlcywga2VwdCBzbyBhIGdyYWNlZnVsIGBzdG9wKClgIGNhblxuICAgICAqIHRlcm1pbmF0ZSBhbnkgdGhhdCBvdXRsYXN0IHRoZSBzaHV0ZG93biBkcmFpbiBpbnN0ZWFkIG9mIG9ycGhhbmluZyB0aGVtXG4gICAgICogYWNyb3NzIGEgZGVwbG95ICh3aGVyZSB0aGV5IHdvdWxkIGtlZXAgcnVubmluZyBhZ2FpbnN0IGRlbGV0ZWQgcmVsZWFzZVxuICAgICAqIGNvZGUgYW5kIGhvbGRpbmcgZGF0YWJhc2UgY29ubmVjdGlvbnMpLlxuICAgICAqIEB0eXBlIHtTZXQ8aW1wb3J0KFwibm9kZTpjaGlsZF9wcm9jZXNzXCIpLkNoaWxkUHJvY2Vzcz59XG4gICAgICovXG4gICAgdGhpcy5pbmZsaWdodFByb2Nlc3NDaGlsZHJlbiA9IG5ldyBTZXQoKVxuICAgIC8qKiBAdHlwZSB7U2V0PFByb21pc2U8dm9pZD4+fSAqL1xuICAgIHRoaXMuaW5mbGlnaHRQb29sZWRKb2JzID0gbmV3IFNldCgpXG4gICAgLyoqIEB0eXBlIHtNYXA8c3RyaW5nLCBBcnJheTxpbXBvcnQoXCIuL3R5cGVzLmpzXCIpLkJhY2tncm91bmRKb2JQYXlsb2FkICYge2lkOiBzdHJpbmd9Pj59ICovXG4gICAgdGhpcy5wb29sZWRKb2JRdWV1ZXMgPSBuZXcgTWFwKClcbiAgICAvKiogQHR5cGUge01hcDxzdHJpbmcsIFByb21pc2U8dm9pZD4+fSAtIFBlci1pZCBvdXRlciBxdWV1ZSB0cmFja2Vycy4gKi9cbiAgICB0aGlzLnBvb2xlZEpvYlF1ZXVlVHJhY2tlcnMgPSBuZXcgTWFwKClcbiAgICAvKiogQHR5cGUge1NldDxpbXBvcnQoXCJub2RlOmNoaWxkX3Byb2Nlc3NcIikuQ2hpbGRQcm9jZXNzPn0gKi9cbiAgICB0aGlzLnBvb2xlZENoaWxkcmVuID0gbmV3IFNldCgpXG4gICAgLyoqIEB0eXBlIHtNYXA8aW1wb3J0KFwibm9kZTpjaGlsZF9wcm9jZXNzXCIpLkNoaWxkUHJvY2VzcywgUG9vbGVkQ2hpbGRTdGF0ZT59ICovXG4gICAgdGhpcy5wb29sZWRDaGlsZFN0YXRlcyA9IG5ldyBNYXAoKVxuICAgIC8qKiBAdHlwZSB7V2Vha1NldDxQcm9taXNlPHZvaWQ+Pn0gKi9cbiAgICB0aGlzLl9wb29sZWRTdGFydHVwRmFpbHVyZUpvYnMgPSBuZXcgV2Vha1NldCgpXG4gICAgLy8gTW9ub3RvbmljIGRpc3BhdGNoIGNvdW50ZXIgZm9yIHJvdW5kLXJvYmluIGNoaWxkIHNlbGVjdGlvbjogZWFjaCBkaXNwYXRjaCBzdGFtcHNcbiAgICAvLyB0aGUgY2hvc2VuIGNoaWxkLCBhbmQgc2VsZWN0aW9uIHByZWZlcnMgdGhlIGNoaWxkIGRpc3BhdGNoZWQgbGVhc3QgcmVjZW50bHkuXG4gICAgdGhpcy5fcG9vbGVkRGlzcGF0Y2hTZXEgPSAwXG4gIH1cblxuICAvKipcbiAgICogUnVucyBzdGFydC5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgd2hlbiBjb25uZWN0ZWQuXG4gICAqL1xuICBhc3luYyBzdGFydCgpIHtcbiAgICB0aGlzLnNob3VsZFN0b3AgPSBmYWxzZVxuICAgIHRoaXMuaXNSZXRpcmluZyA9IGZhbHNlXG4gICAgdGhpcy5zdG9wUHJvbWlzZSA9IHVuZGVmaW5lZFxuICAgIHRoaXMuX3Jlc2V0U3RvcHBlZFByb21pc2UoKVxuICAgIHRoaXMuY29uZmlndXJhdGlvbiA9IGF3YWl0IHRoaXMuY29uZmlndXJhdGlvblByb21pc2VcbiAgICB0aGlzLmNvbmZpZ3VyYXRpb24uc2V0Q3VycmVudCgpXG4gICAgY29uc3QgcmVzb2x2ZWRDb25maWcgPSB0aGlzLmNvbmZpZ3VyYXRpb24uZ2V0QmFja2dyb3VuZEpvYnNDb25maWcoKVxuICAgIHRoaXMuZ2VuZXJhdGlvbklkID0gdGhpcy5jb25maWd1cmF0aW9uLnJlc29sdmVCYWNrZ3JvdW5kSm9ic0dlbmVyYXRpb25Db25maWcoe1xuICAgICAgZ2VuZXJhdGlvbklkOiB0aGlzLmV4cGxpY2l0R2VuZXJhdGlvbklkLFxuICAgICAgc291cmNlTmFtZTogXCJCYWNrZ3JvdW5kSm9ic1dvcmtlclwiXG4gICAgfSkuZ2VuZXJhdGlvbklkXG4gICAgdGhpcy53b3JrZXJJZCA9IHRoaXMuZ2VuZXJhdGlvbklkXG4gICAgICA/IGNyZWF0ZUdlbmVyYXRpb25Xb3JrZXJJZCh7Z2VuZXJhdGlvbklkOiB0aGlzLmdlbmVyYXRpb25JZCwgd29ya2VySW5zdGFuY2VJZDogdGhpcy53b3JrZXJJbnN0YW5jZUlkfSlcbiAgICAgIDogdGhpcy53b3JrZXJJbnN0YW5jZUlkXG4gICAgdGhpcy5ob3N0IHx8PSByZXNvbHZlZENvbmZpZy5ob3N0XG4gICAgaWYgKHR5cGVvZiB0aGlzLnBvcnQgIT09IFwibnVtYmVyXCIpIHRoaXMucG9ydCA9IHJlc29sdmVkQ29uZmlnLnBvcnRcbiAgICBhd2FpdCB0aGlzLmNvbmZpZ3VyYXRpb24uaW5pdGlhbGl6ZSh7dHlwZTogXCJiYWNrZ3JvdW5kLWpvYnMtd29ya2VyXCJ9KVxuICAgIGF3YWl0IHRoaXMuY29uZmlndXJhdGlvbi5jb25uZWN0QmVhY29uKHtwZWVyVHlwZTogXCJiYWNrZ3JvdW5kLWpvYnMtd29ya2VyXCJ9KVxuXG4gICAgLy8gQ29uc3RydWN0b3Igb3ZlcnJpZGVzIHdpbjsgb3RoZXJ3aXNlIHBpY2sgdXAgdGhlIGNvbmZpZ3VyZWQgY2Fwcy5cbiAgICBpZiAodHlwZW9mIHRoaXMubWF4Q29uY3VycmVudElubGluZUpvYnNPdmVycmlkZSAhPT0gXCJudW1iZXJcIikge1xuICAgICAgY29uc3QgY29uZmlnID0gdGhpcy5jb25maWd1cmF0aW9uLmdldEJhY2tncm91bmRKb2JzQ29uZmlnKClcblxuICAgICAgdGhpcy5tYXhDb25jdXJyZW50SW5saW5lSm9icyA9IGNvbmZpZy5tYXhDb25jdXJyZW50SW5saW5lSm9icyB8fCB0aGlzLm1heENvbmN1cnJlbnRJbmxpbmVKb2JzXG4gICAgfVxuICAgIGlmICh0eXBlb2YgdGhpcy5tYXhDb25jdXJyZW50Rm9ya2VkSm9ic092ZXJyaWRlICE9PSBcIm51bWJlclwiKSB7XG4gICAgICBjb25zdCBjb25maWcgPSB0aGlzLmNvbmZpZ3VyYXRpb24uZ2V0QmFja2dyb3VuZEpvYnNDb25maWcoKVxuXG4gICAgICB0aGlzLm1heENvbmN1cnJlbnRGb3JrZWRKb2JzID0gY29uZmlnLm1heENvbmN1cnJlbnRGb3JrZWRKb2JzIHx8IHRoaXMubWF4Q29uY3VycmVudEZvcmtlZEpvYnNcbiAgICB9XG4gICAgY29uc3QgcG9vbENvbmZpZyA9IHRoaXMuY29uZmlndXJhdGlvbi5nZXRCYWNrZ3JvdW5kSm9ic0NvbmZpZygpXG4gICAgaWYgKHR5cGVvZiB0aGlzLnBvb2xlZFJ1bm5lckNvdW50T3ZlcnJpZGUgIT09IFwibnVtYmVyXCIpIHRoaXMucG9vbGVkUnVubmVyQ291bnQgPSBwb29sQ29uZmlnLnBvb2xlZFJ1bm5lckNvdW50XG4gICAgaWYgKHR5cGVvZiB0aGlzLnBvb2xlZFJ1bm5lckNvbmN1cnJlbmN5T3ZlcnJpZGUgIT09IFwibnVtYmVyXCIpIHRoaXMucG9vbGVkUnVubmVyQ29uY3VycmVuY3kgPSBwb29sQ29uZmlnLnBvb2xlZFJ1bm5lckNvbmN1cnJlbmN5XG4gICAgaWYgKHR5cGVvZiB0aGlzLnBvb2xlZFJ1bm5lck1heEpvYnNPdmVycmlkZSAhPT0gXCJudW1iZXJcIikgdGhpcy5wb29sZWRSdW5uZXJNYXhKb2JzID0gcG9vbENvbmZpZy5wb29sZWRSdW5uZXJNYXhKb2JzXG4gICAgaWYgKHR5cGVvZiB0aGlzLnBvb2xlZFJ1bm5lck1heFJzc0J5dGVzT3ZlcnJpZGUgIT09IFwibnVtYmVyXCIpIHRoaXMucG9vbGVkUnVubmVyTWF4UnNzQnl0ZXMgPSBwb29sQ29uZmlnLnBvb2xlZFJ1bm5lck1heFJzc0J5dGVzXG4gICAgaWYgKHR5cGVvZiB0aGlzLnBvb2xlZFJ1bm5lck1heExpZmV0aW1lTXNPdmVycmlkZSAhPT0gXCJudW1iZXJcIikgdGhpcy5wb29sZWRSdW5uZXJNYXhMaWZldGltZU1zID0gcG9vbENvbmZpZy5wb29sZWRSdW5uZXJNYXhMaWZldGltZU1zXG5cbiAgICB0aGlzLnN0YXR1c1JlcG9ydGVyID0gbmV3IEJhY2tncm91bmRKb2JzU3RhdHVzUmVwb3J0ZXIoe1xuICAgICAgY29uZmlndXJhdGlvbjogdGhpcy5jb25maWd1cmF0aW9uLFxuICAgICAgaG9zdDogdGhpcy5ob3N0LFxuICAgICAgcG9ydDogdGhpcy5wb3J0LFxuICAgICAgZ2VuZXJhdGlvbkhhbmRzaGFrZVRpbWVvdXRNczogdGhpcy5nZW5lcmF0aW9uSGFuZHNoYWtlVGltZW91dE1zLFxuICAgICAgZ2VuZXJhdGlvbklkOiB0aGlzLmdlbmVyYXRpb25JZFxuICAgIH0pXG4gICAgdHJ5IHtcbiAgICAgIGF3YWl0IHRoaXMuX2Nvbm5lY3Qoe2FsbG93UmVjb25uZWN0OiBmYWxzZX0pXG4gICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgIGxldCBjbGVhbnVwRXJyb3JcblxuICAgICAgdHJ5IHtcbiAgICAgICAgYXdhaXQgdGhpcy5zdG9wKClcbiAgICAgIH0gY2F0Y2ggKGNhdWdodENsZWFudXBFcnJvcikge1xuICAgICAgICBjbGVhbnVwRXJyb3IgPSBjYXVnaHRDbGVhbnVwRXJyb3JcbiAgICAgIH1cblxuICAgICAgaWYgKGNsZWFudXBFcnJvcikge1xuICAgICAgICB0aHJvdyBuZXcgQWdncmVnYXRlRXJyb3IoXG4gICAgICAgICAgW2Vycm9yLCBjbGVhbnVwRXJyb3JdLFxuICAgICAgICAgIFwiQmFja2dyb3VuZCBqb2JzIHdvcmtlciBzdGFydHVwIGFuZCBjbGVhbnVwIGZhaWxlZFwiLFxuICAgICAgICAgIHtjYXVzZTogZXJyb3J9XG4gICAgICAgIClcbiAgICAgIH1cblxuICAgICAgdGhyb3cgZXJyb3JcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogR3JhY2VmdWxseSBzdG9wcyB0aGUgd29ya2VyOiBhbm5vdW5jZXMgZHJhaW5pbmcgdG8gdGhlIG1haW4gcHJvY2VzcyBzb1xuICAgKiBubyBuZXcgam9icyBhcmUgZGlzcGF0Y2hlZCwgd2FpdHMgZm9yIGluLWZsaWdodCBpbmxpbmUgam9icyBhbmQgcHJvY2Vzc1xuICAgKiBydW5uZXJzIHRvIGZpbmlzaCAoc28gdGhlaXIgcmVzdWx0cyBjYW4gYmUgcmVwb3J0ZWQpLCB0aGVuIGNsb3NlcyB0aGVcbiAgICogc29ja2V0IGFuZCBkaXNjb25uZWN0cyBmcm9tIHRoZSBiZWFjb24uXG4gICAqXG4gICAqIFByb2Nlc3MgcnVubmVycyBhcmUgY2hpbGQgcHJvY2Vzc2VzLiBXaGVuIGEgYHRpbWVvdXRNc2AgaXMgZ2l2ZW4gKGUuZy4gYVxuICAgKiBkZXBsb3kgZHJhaW5pbmcgdGhlIG9sZCByZWxlYXNlKSBhbnkgcnVubmVyIHN0aWxsIGFsaXZlIGFmdGVyIHRoZSBkcmFpblxuICAgKiB3aW5kb3cgaXMgdGVybWluYXRlZCAoU0lHVEVSTSwgdGhlbiBTSUdLSUxMKSByYXRoZXIgdGhhbiBsZWZ0IHRvIG9ycGhhblxuICAgKiBhY3Jvc3MgdGhlIGRlcGxveS4gV2l0aCBubyBgdGltZW91dE1zYCB0aGUgZHJhaW4gd2FpdHMgZm9yIHJ1bm5lcnMgdG9cbiAgICogZmluaXNoIG9uIHRoZWlyIG93bi5cbiAgICogQHBhcmFtIHtvYmplY3R9IFthcmdzXSAtIE9wdGlvbnMuXG4gICAqIEBwYXJhbSB7bnVtYmVyfSBbYXJncy50aW1lb3V0TXNdIC0gTWF4IHdhaXQgZm9yIGluLWZsaWdodCBqb2JzIChwZXIgcGhhc2UpIGluIG1zLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyB3aGVuIHN0b3BwZWQuXG4gICAqL1xuICBzdG9wKHt0aW1lb3V0TXN9ID0ge30pIHtcbiAgICBjb25zdCBzdG9wUHJvbWlzZSA9IHRoaXMuc3RvcFByb21pc2UgfHwgdGhpcy5fc3RvcCh7dGltZW91dE1zfSlcblxuICAgIGlmICghdGhpcy5zdG9wUHJvbWlzZSkge1xuICAgICAgdGhpcy5zdG9wUHJvbWlzZSA9IHN0b3BQcm9taXNlXG4gICAgICB2b2lkIHN0b3BQcm9taXNlLnRoZW4odGhpcy5fcmVzb2x2ZVN0b3BwZWQsIChlcnJvcikgPT4ge1xuICAgICAgICB0aGlzLl9yZWplY3RTdG9wcGVkKGVycm9yIGluc3RhbmNlb2YgRXJyb3IgPyBlcnJvciA6IG5ldyBFcnJvcihTdHJpbmcoZXJyb3IpKSlcbiAgICAgIH0pXG4gICAgfVxuXG4gICAgcmV0dXJuIHN0b3BQcm9taXNlXG4gIH1cblxuICAvKipcbiAgICogV2FpdHMgZm9yIGF1dG9tYXRpYyBvciByZXF1ZXN0ZWQgc3RvcC5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgd2hlbiB0aGlzIHdvcmtlciBoYXMgZnVsbHkgc3RvcHBlZC5cbiAgICovXG4gIHdhaXRVbnRpbFN0b3BwZWQoKSB7IHJldHVybiB0aGlzLl9zdG9wcGVkUHJvbWlzZSB9XG5cbiAgLyoqIFJlc2V0cyB0aGUgc3RvcCBvYnNlcnZhdGlvbiBwcm9taXNlIGZvciBhIG5ldyB3b3JrZXIgc3RhcnQuICovXG4gIF9yZXNldFN0b3BwZWRQcm9taXNlKCkge1xuICAgIHRoaXMuX3N0b3BwZWRQcm9taXNlID0gbmV3IFByb21pc2UoKHJlc29sdmUsIHJlamVjdCkgPT4ge1xuICAgICAgdGhpcy5fcmVzb2x2ZVN0b3BwZWQgPSByZXNvbHZlXG4gICAgICB0aGlzLl9yZWplY3RTdG9wcGVkID0gcmVqZWN0XG4gICAgfSlcbiAgICB2b2lkIHRoaXMuX3N0b3BwZWRQcm9taXNlLmNhdGNoKCgpID0+IHt9KVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgdGhlIHdvcmtlciBzaHV0ZG93biBsaWZlY3ljbGUgb25jZS5cbiAgICogQHBhcmFtIHtvYmplY3R9IFthcmdzXSAtIE9wdGlvbnMuXG4gICAqIEBwYXJhbSB7bnVtYmVyfSBbYXJncy50aW1lb3V0TXNdIC0gTWF4IHdhaXQgZm9yIGluLWZsaWdodCBqb2JzIChwZXIgcGhhc2UpIGluIG1zLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyB3aGVuIHN0b3BwZWQuXG4gICAqL1xuICBhc3luYyBfc3RvcCh7dGltZW91dE1zfSA9IHt9KSB7XG4gICAgdGhpcy5zaG91bGRTdG9wID0gdHJ1ZVxuICAgIHRoaXMuaXNSZXRpcmluZyA9IHRydWVcbiAgICB0aGlzLl9zdG9wSGVhcnRiZWF0KClcbiAgICBpZiAodGhpcy5fcmVjb25uZWN0VGltZXIpIHtcbiAgICAgIGNsZWFyVGltZW91dCh0aGlzLl9yZWNvbm5lY3RUaW1lcilcbiAgICAgIHRoaXMuX3JlY29ubmVjdFRpbWVyID0gdW5kZWZpbmVkXG4gICAgfVxuXG4gICAgYXdhaXQgc2h1dGRvd25MaWZlY3ljbGUoe1xuICAgICAgb25TdG9wcGVkOiB0aGlzLm9uU3RvcHBlZCxcbiAgICAgIHNodXRkb3duOiBhc3luYyAoKSA9PiB7XG4gICAgICAgIC8vIEFubm91bmNlIGRyYWluIHNvIG1haW4gc3RvcHMgZGlzcGF0Y2hpbmcgYnV0IGtlZXBzIHRoZSBjb25uZWN0aW9uXG4gICAgICAgIC8vIG9wZW4gdW50aWwgd2UgY2xvc2UgaXQgb3Vyc2VsdmVzIGJlbG93LlxuICAgICAgICBpZiAodGhpcy5qc29uU29ja2V0KSB7XG4gICAgICAgICAgdHJ5IHtcbiAgICAgICAgICAgIHRoaXMuanNvblNvY2tldC5zZW5kKHt0eXBlOiBcImRyYWluaW5nXCJ9KVxuICAgICAgICAgIH0gY2F0Y2gge1xuICAgICAgICAgICAgLy8gU29ja2V0IG1heSBhbHJlYWR5IGJlIGNsb3Npbmc7IG5vdGhpbmcgdG8gZG8uXG4gICAgICAgICAgfVxuICAgICAgICB9XG5cbiAgICAgICAgYXdhaXQgdGhpcy5fZHJhaW5JbmZsaWdodCh0aGlzLmluZmxpZ2h0SW5saW5lSm9icywgdGltZW91dE1zKVxuICAgICAgICBhd2FpdCB0aGlzLl9kcmFpbkluZmxpZ2h0KHRoaXMuaW5mbGlnaHRQb29sZWRKb2JzLCB0aW1lb3V0TXMpXG4gICAgICAgIGF3YWl0IHRoaXMuX2RyYWluSW5mbGlnaHQodGhpcy5pbmZsaWdodFByb2Nlc3NKb2JzLCB0aW1lb3V0TXMpXG4gICAgICAgIGF3YWl0IHRoaXMuX3Rlcm1pbmF0ZVByb2Nlc3NDaGlsZHJlbigpXG4gICAgICAgIC8vIEdpdmUgaW4tZmxpZ2h0IHJlc3VsdCByZXBvcnRzIChub3cgZGVjb3VwbGVkIGZyb20gam9iIHNsb3RzKSBhIGJvdW5kZWRcbiAgICAgICAgLy8gY2hhbmNlIHRvIGxhbmQgYmVmb3JlIHRoZSBzb2NrZXQgY2xvc2VzLlxuICAgICAgICBhd2FpdCB0aGlzLl9kcmFpbkluZmxpZ2h0KHRoaXMuaW5mbGlnaHRSZXBvcnRzLCB0aW1lb3V0TXMpXG5cbiAgICAgICAgaWYgKHRoaXMuanNvblNvY2tldCkgdGhpcy5qc29uU29ja2V0LmNsb3NlKClcbiAgICAgICAgaWYgKCF0aGlzLmNvbmZpZ3VyYXRpb24pIHJldHVyblxuXG4gICAgICAgIGF3YWl0IHRoaXMuX2Nsb3NlQ29uZmlndXJhdGlvbigpXG4gICAgICB9XG4gICAgfSlcbiAgfVxuXG4gIC8qKiBCZWdpbnMgZ2VuZXJhdGlvbiByZXRpcmVtZW50IHdpdGhvdXQgcmV2b2tpbmcgbGl2ZW5lc3MgZHVyaW5nIHRoZSBkcmFpbi4gKi9cbiAgX2JlZ2luR2VuZXJhdGlvblJldGlyZW1lbnQoKSB7XG4gICAgaWYgKHRoaXMuc3RvcFByb21pc2UpIHJldHVyblxuXG4gICAgdGhpcy5pc1JldGlyaW5nID0gdHJ1ZVxuICAgIGNvbnN0IHN0b3BQcm9taXNlID0gdGhpcy5fc3RvcEFmdGVyR2VuZXJhdGlvbkRyYWluKClcbiAgICB0aGlzLnN0b3BQcm9taXNlID0gc3RvcFByb21pc2VcbiAgICB2b2lkIHN0b3BQcm9taXNlLnRoZW4odGhpcy5fcmVzb2x2ZVN0b3BwZWQsIChlcnJvcikgPT4ge1xuICAgICAgY29uc3Qgbm9ybWFsaXplZEVycm9yID0gZXJyb3IgaW5zdGFuY2VvZiBFcnJvciA/IGVycm9yIDogbmV3IEVycm9yKFN0cmluZyhlcnJvcikpXG5cbiAgICAgIHRoaXMuX3JlamVjdFN0b3BwZWQobm9ybWFsaXplZEVycm9yKVxuICAgICAgdGhpcy5fcmVwb3J0TGlmZWN5Y2xlRXJyb3Iobm9ybWFsaXplZEVycm9yKVxuICAgIH0pXG4gIH1cblxuICAvKipcbiAgICogRHJhaW5zIGFjY2VwdGVkIGdlbmVyYXRpb24gd29yayB3aGlsZSByZXRhaW5pbmcgdGhlIGV4YWN0IGNvbm5lY3Rpb24gYW5kXG4gICAqIGhlYXJ0YmVhdCwgdGhlbiBwZXJmb3JtcyB0aGUgZmluYWwgdGVybWluYXRpbmcgc3RvcC5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgYWZ0ZXIgdGhlIHdvcmtlciBoYXMgZnVsbHkgY2xvc2VkLlxuICAgKi9cbiAgYXN5bmMgX3N0b3BBZnRlckdlbmVyYXRpb25EcmFpbigpIHtcbiAgICBpZiAodGhpcy5qc29uU29ja2V0KSB7XG4gICAgICB0cnkge1xuICAgICAgICB0aGlzLmpzb25Tb2NrZXQuc2VuZCh7dHlwZTogXCJkcmFpbmluZ1wifSlcbiAgICAgIH0gY2F0Y2gge1xuICAgICAgICAvLyBUaGUgY2xvc2UgaGFuZGxlciBvd25zIGV4YWN0IHNhbWUtZ2VuZXJhdGlvbiByZWNvbm5lY3QuXG4gICAgICB9XG4gICAgfVxuXG4gICAgYXdhaXQgdGhpcy5fZHJhaW5JbmZsaWdodCh0aGlzLmluZmxpZ2h0SW5saW5lSm9icylcbiAgICBhd2FpdCB0aGlzLl9kcmFpbkluZmxpZ2h0KHRoaXMuaW5mbGlnaHRQb29sZWRKb2JzKVxuICAgIGF3YWl0IHRoaXMuX2RyYWluSW5mbGlnaHQodGhpcy5pbmZsaWdodFByb2Nlc3NKb2JzKVxuICAgIGF3YWl0IHRoaXMuX2RyYWluSW5mbGlnaHQodGhpcy5pbmZsaWdodFJlcG9ydHMpXG5cbiAgICB0aGlzLnNob3VsZFN0b3AgPSB0cnVlXG4gICAgdGhpcy5fc3RvcEhlYXJ0YmVhdCgpXG4gICAgaWYgKHRoaXMuX3JlY29ubmVjdFRpbWVyKSB7XG4gICAgICBjbGVhclRpbWVvdXQodGhpcy5fcmVjb25uZWN0VGltZXIpXG4gICAgICB0aGlzLl9yZWNvbm5lY3RUaW1lciA9IHVuZGVmaW5lZFxuICAgIH1cbiAgICBhd2FpdCB0aGlzLl90ZXJtaW5hdGVQcm9jZXNzQ2hpbGRyZW4oKVxuXG4gICAgYXdhaXQgc2h1dGRvd25MaWZlY3ljbGUoe1xuICAgICAgb25TdG9wcGVkOiB0aGlzLm9uU3RvcHBlZCxcbiAgICAgIHNodXRkb3duOiBhc3luYyAoKSA9PiB7XG4gICAgICAgIGlmICh0aGlzLmpzb25Tb2NrZXQpIHRoaXMuanNvblNvY2tldC5jbG9zZSgpXG4gICAgICAgIGlmICghdGhpcy5jb25maWd1cmF0aW9uKSByZXR1cm5cblxuICAgICAgICBhd2FpdCB0aGlzLl9jbG9zZUNvbmZpZ3VyYXRpb24oKVxuICAgICAgfVxuICAgIH0pXG4gIH1cblxuICAvKipcbiAgICogQ2xvc2VzIGFwcGxpY2F0aW9uIHJlc291cmNlcyBiZWZvcmUgZnJhbWV3b3JrIHJlc291cmNlcyB3aGVuIHRoaXMgd29ya2VyIG93bnMgdGhlbS5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgYWZ0ZXIgZXZlcnkgb3duZWQgY2xvc2Ugc3VjY2VlZHMuXG4gICAqL1xuICBhc3luYyBfY2xvc2VDb25maWd1cmF0aW9uKCkge1xuICAgIGNvbnN0IGNvbmZpZ3VyYXRpb24gPSB0aGlzLmNvbmZpZ3VyYXRpb25cblxuICAgIGlmICghY29uZmlndXJhdGlvbikgcmV0dXJuXG5cbiAgICBhd2FpdCBydW5TaHV0ZG93blN0ZXBzKHtcbiAgICAgIG1lc3NhZ2U6IFwiQmFja2dyb3VuZCBqb2JzIHdvcmtlciBhcHBsaWNhdGlvbiBhbmQgZnJhbWV3b3JrIHNodXRkb3duIGZhaWxlZFwiLFxuICAgICAgc3RlcHM6IFtcbiAgICAgICAgLi4uKHRoaXMuY2xvc2VEYXRhYmFzZUNvbm5lY3Rpb25zT25TdG9wXG4gICAgICAgICAgPyBbYXN5bmMgKCkgPT4gYXdhaXQgY29uZmlndXJhdGlvbi5zaHV0ZG93bigpXVxuICAgICAgICAgIDogW10pLFxuICAgICAgICBhc3luYyAoKSA9PiBhd2FpdCBjb25maWd1cmF0aW9uLmRpc2Nvbm5lY3RCZWFjb24oKSxcbiAgICAgICAgLi4uKHRoaXMuY2xvc2VEYXRhYmFzZUNvbm5lY3Rpb25zT25TdG9wXG4gICAgICAgICAgPyBbYXN5bmMgKCkgPT4gYXdhaXQgY29uZmlndXJhdGlvbi5jbG9zZURhdGFiYXNlQ29ubmVjdGlvbnMoKV1cbiAgICAgICAgICA6IFtdKVxuICAgICAgXVxuICAgIH0pXG4gIH1cblxuICAvKipcbiAgICogV2FpdHMgZm9yIGEgc2V0IG9mIGluLWZsaWdodCBqb2IgcHJvbWlzZXMgdG8gc2V0dGxlLCBvcHRpb25hbGx5IGJvdW5kZWQgYnlcbiAgICogYHRpbWVvdXRNc2AuXG4gICAqIEBwYXJhbSB7U2V0PFByb21pc2U8dm9pZD4+fSBpbmZsaWdodCAtIEluLWZsaWdodCBqb2IgcHJvbWlzZXMuXG4gICAqIEBwYXJhbSB7bnVtYmVyfSBbdGltZW91dE1zXSAtIE1heCB3YWl0IGluIG1zOyB1bmJvdW5kZWQgd2hlbiBvbWl0dGVkLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyB3aGVuIHNldHRsZWQgb3IgdGhlIHRpbWVvdXQgZWxhcHNlcy5cbiAgICovXG4gIGFzeW5jIF9kcmFpbkluZmxpZ2h0KGluZmxpZ2h0LCB0aW1lb3V0TXMpIHtcbiAgICBpZiAoaW5mbGlnaHQuc2l6ZSA9PT0gMCkgcmV0dXJuXG5cbiAgICBjb25zdCBkcmFpbiA9IFByb21pc2UuYWxsU2V0dGxlZChbLi4uaW5mbGlnaHRdKVxuXG4gICAgaWYgKHR5cGVvZiB0aW1lb3V0TXMgPT09IFwibnVtYmVyXCIgJiYgdGltZW91dE1zID49IDApIHtcbiAgICAgIGxldCB0aW1lclxuICAgICAgY29uc3QgdGltZW91dCA9IG5ldyBQcm9taXNlKChyZXNvbHZlKSA9PiB7IHRpbWVyID0gc2V0VGltZW91dChyZXNvbHZlLCB0aW1lb3V0TXMpIH0pXG5cbiAgICAgIGF3YWl0IFByb21pc2UucmFjZShbZHJhaW4sIHRpbWVvdXRdKVxuICAgICAgY2xlYXJUaW1lb3V0KHRpbWVyKVxuICAgIH0gZWxzZSB7XG4gICAgICBhd2FpdCBkcmFpblxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBUZXJtaW5hdGVzIGFueSBwcm9jZXNzIHJ1bm5lciBjaGlsZHJlbiBzdGlsbCBhbGl2ZSBhZnRlciB0aGUgZHJhaW4gd2luZG93IHNvXG4gICAqIHRoZXkgZG9uJ3Qgb3V0bGl2ZSB0aGUgd29ya2VyIGFzIG9ycGhhbnMuIFNJR1RFUk0gbGV0cyB0aGUgcnVubmVyIGNsb3NlIGl0c1xuICAgKiBjb25uZWN0aW9ucyBjbGVhbmx5OyBzdXJ2aXZvcnMgYXJlIFNJR0tJTExlZCBhZnRlciBhIHNob3J0IGdyYWNlLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyBvbmNlIHN1cnZpdm9ycyBoYXZlIGJlZW4gc2lnbmFsbGVkLlxuICAgKi9cbiAgYXN5bmMgX3Rlcm1pbmF0ZVByb2Nlc3NDaGlsZHJlbigpIHtcbiAgICBpZiAodGhpcy5pbmZsaWdodFByb2Nlc3NDaGlsZHJlbi5zaXplID09PSAwKSByZXR1cm5cblxuICAgIGZvciAoY29uc3QgY2hpbGQgb2YgdGhpcy5pbmZsaWdodFByb2Nlc3NDaGlsZHJlbikge1xuICAgICAgY29uc3QgcG9vbGVkU3RhdGUgPSB0aGlzLnBvb2xlZENoaWxkU3RhdGVzLmdldChjaGlsZClcbiAgICAgIGlmIChwb29sZWRTdGF0ZSAmJiBwb29sZWRTdGF0ZS5pbmZsaWdodC5zaXplID4gMCAmJiAhcG9vbGVkU3RhdGUudGVybWluYXRpb25SZWFzb24pIHtcbiAgICAgICAgcG9vbGVkU3RhdGUudGVybWluYXRpb25SZWFzb24gPSBcIndvcmtlci1zaHV0ZG93bi10aW1lb3V0XCJcbiAgICAgIH1cblxuICAgICAgdHJ5IHtcbiAgICAgICAgY2hpbGQua2lsbChcIlNJR1RFUk1cIilcbiAgICAgIH0gY2F0Y2gge1xuICAgICAgICAvLyBDaGlsZCBhbHJlYWR5IGV4aXRlZDsgbm90aGluZyB0byBkby5cbiAgICAgIH1cbiAgICB9XG5cbiAgICBhd2FpdCBuZXcgUHJvbWlzZSgocmVzb2x2ZSkgPT4gc2V0VGltZW91dChyZXNvbHZlLCB0aGlzLmZvcmtlZENoaWxkU2lna2lsbEdyYWNlTXMpKVxuXG4gICAgZm9yIChjb25zdCBjaGlsZCBvZiB0aGlzLmluZmxpZ2h0UHJvY2Vzc0NoaWxkcmVuKSB7XG4gICAgICB0cnkge1xuICAgICAgICBjaGlsZC5raWxsKFwiU0lHS0lMTFwiKVxuICAgICAgfSBjYXRjaCB7XG4gICAgICAgIC8vIENoaWxkIGFscmVhZHkgZXhpdGVkOyBub3RoaW5nIHRvIGRvLlxuICAgICAgfVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBDb25uZWN0cyB0byB0aGUgd29ya2VyJ3MgcmVzb2x2ZWQgZW5kcG9pbnQgYW5kIGNvbXBsZXRlcyBpdHMgaGVsbG8gZmVuY2UuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gUmVjb25uZWN0IHBvbGljeS5cbiAgICogQHBhcmFtIHtib29sZWFufSBhcmdzLmFsbG93UmVjb25uZWN0IC0gV2hldGhlciBhIGZhaWxlZCBhdHRlbXB0IG1heSBzY2hlZHVsZSBhbm90aGVyIGNvbm5lY3Rpb24uXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIGFmdGVyIGdlbmVyYXRpb24gYWNrbm93bGVkZ2VtZW50LlxuICAgKi9cbiAgYXN5bmMgX2Nvbm5lY3Qoe2FsbG93UmVjb25uZWN0fSkge1xuICAgIGNvbnN0IGNvbmZpZ3VyYXRpb24gPSB0aGlzLmNvbmZpZ3VyYXRpb25cbiAgICBpZiAoIWNvbmZpZ3VyYXRpb24pIHRocm93IG5ldyBFcnJvcihcIkJhY2tncm91bmQgam9icyB3b3JrZXIgY29uZmlndXJhdGlvbiBub3QgaW5pdGlhbGl6ZWRcIilcblxuICAgIGNvbnN0IGNvbmZpZyA9IGNvbmZpZ3VyYXRpb24uZ2V0QmFja2dyb3VuZEpvYnNDb25maWcoKVxuICAgIGlmICh0aGlzLmdlbmVyYXRpb25JZCkgdGhpcy5fZ2VuZXJhdGlvbkFjY2VwdGVkID0gZmFsc2VcbiAgICBjb25zdCBob3N0ID0gdGhpcy5ob3N0IHx8IGNvbmZpZy5ob3N0XG4gICAgY29uc3QgcG9ydCA9IHR5cGVvZiB0aGlzLnBvcnQgPT09IFwibnVtYmVyXCIgPyB0aGlzLnBvcnQgOiBjb25maWcucG9ydFxuICAgIGNvbnN0IHNvY2tldCA9IG5ldC5jcmVhdGVDb25uZWN0aW9uKHtob3N0LCBwb3J0fSlcbiAgICBzb2NrZXQuc2V0S2VlcEFsaXZlKHRydWUsIFNPQ0tFVF9LRUVQQUxJVkVfTVMpXG4gICAgY29uc3QganNvblNvY2tldCA9IG5ldyBKc29uU29ja2V0KHNvY2tldClcbiAgICB0aGlzLmpzb25Tb2NrZXQgPSBqc29uU29ja2V0XG4gICAgLyoqXG4gICAgICogUmVzb2x2ZXMgdGhlIGdlbmVyYXRpb24gaGFuZHNoYWtlLlxuICAgICAqIEB0eXBlIHsoKSA9PiB2b2lkfVxuICAgICAqL1xuICAgIGxldCByZXNvbHZlSGFuZHNoYWtlID0gKCkgPT4ge31cbiAgICAvKipcbiAgICAgKiBSZWplY3RzIHRoZSBnZW5lcmF0aW9uIGhhbmRzaGFrZS5cbiAgICAgKiBAdHlwZSB7KGVycm9yOiBFcnJvcikgPT4gdm9pZH1cbiAgICAgKi9cbiAgICBsZXQgcmVqZWN0SGFuZHNoYWtlID0gKCkgPT4ge31cbiAgICBsZXQgY29ubmVjdGlvbkFjY2VwdGVkID0gZmFsc2VcbiAgICAvKiogQHR5cGUge1JldHVyblR5cGU8dHlwZW9mIHNldFRpbWVvdXQ+IHwgdW5kZWZpbmVkfSAqL1xuICAgIGxldCBoYW5kc2hha2VUaW1lclxuICAgIGNvbnN0IGhhbmRzaGFrZSA9IG5ldyBQcm9taXNlKCgvKiogQHR5cGUgeyh2YWx1ZTogdm9pZCkgPT4gdm9pZH0gKi8gcmVzb2x2ZSwgcmVqZWN0KSA9PiB7XG4gICAgICByZXNvbHZlSGFuZHNoYWtlID0gcmVzb2x2ZVxuICAgICAgcmVqZWN0SGFuZHNoYWtlID0gcmVqZWN0XG4gICAgfSlcblxuICAgIC8qKlxuICAgICAqIEhhbmRsZXMgYSBiYWNrZ3JvdW5kIGpvYiBzb2NrZXQgbWVzc2FnZS5cbiAgICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vdHlwZXMuanNcIikuQmFja2dyb3VuZEpvYlNvY2tldE1lc3NhZ2V9IG1lc3NhZ2UgLSBTb2NrZXQgbWVzc2FnZS5cbiAgICAgKi9cbiAgICBqc29uU29ja2V0Lm9uKFwibWVzc2FnZVwiLCBhc3luYyAobWVzc2FnZSkgPT4ge1xuICAgICAgaWYgKG1lc3NhZ2U/LnR5cGUgPT09IFwiZ2VuZXJhdGlvbi1hY2NlcHRlZFwiKSB7XG4gICAgICAgIGlmICghdGhpcy5nZW5lcmF0aW9uSWQgfHwgbWVzc2FnZS5nZW5lcmF0aW9uSWQgIT09IHRoaXMuZ2VuZXJhdGlvbklkKSB7XG4gICAgICAgICAgcmVqZWN0SGFuZHNoYWtlKG5ldyBFcnJvcihcIkJhY2tncm91bmQgam9icyBtYWluIGFja25vd2xlZGdlZCBhIGRpZmZlcmVudCBnZW5lcmF0aW9uXCIpKVxuICAgICAgICAgIGpzb25Tb2NrZXQuZGVzdHJveSgpXG4gICAgICAgICAgcmV0dXJuXG4gICAgICAgIH1cblxuICAgICAgICB0aGlzLl9nZW5lcmF0aW9uQWNjZXB0ZWQgPSB0cnVlXG4gICAgICAgIGNvbm5lY3Rpb25BY2NlcHRlZCA9IHRydWVcbiAgICAgICAgaWYgKGhhbmRzaGFrZVRpbWVyKSB7XG4gICAgICAgICAgY2xlYXJUaW1lb3V0KGhhbmRzaGFrZVRpbWVyKVxuICAgICAgICAgIGhhbmRzaGFrZVRpbWVyID0gdW5kZWZpbmVkXG4gICAgICAgIH1cbiAgICAgICAgaWYgKG1lc3NhZ2UubGlmZWN5Y2xlU3RhdGUgPT09IFwicmV0aXJpbmdcIiB8fCBtZXNzYWdlLmxpZmVjeWNsZVN0YXRlID09PSBcInJldGlyZWRcIikgdGhpcy5pc1JldGlyaW5nID0gdHJ1ZVxuICAgICAgICB0aGlzLm9uR2VuZXJhdGlvbkFjY2VwdGVkPy4oKVxuICAgICAgICB0aGlzLl9zZW5kUmVhZHlJZlJ1bm5pbmcoKVxuICAgICAgICB0aGlzLl9zdGFydEhlYXJ0YmVhdCgpXG4gICAgICAgIHJlc29sdmVIYW5kc2hha2UoKVxuICAgICAgICByZXR1cm5cbiAgICAgIH1cblxuICAgICAgaWYgKG1lc3NhZ2U/LnR5cGUgPT09IFwiZ2VuZXJhdGlvbi1yZWplY3RlZFwiKSB7XG4gICAgICAgIHRoaXMuc2hvdWxkU3RvcCA9IHRydWVcbiAgICAgICAgaWYgKGhhbmRzaGFrZVRpbWVyKSBjbGVhclRpbWVvdXQoaGFuZHNoYWtlVGltZXIpXG4gICAgICAgIHJlamVjdEhhbmRzaGFrZShuZXcgRXJyb3IoYEJhY2tncm91bmQgam9icyBnZW5lcmF0aW9uIHJlamVjdGVkOiAke21lc3NhZ2UucmVhc29ufWApKVxuICAgICAgICBqc29uU29ja2V0LmRlc3Ryb3koKVxuICAgICAgICByZXR1cm5cbiAgICAgIH1cblxuICAgICAgaWYgKG1lc3NhZ2U/LnR5cGUgPT09IFwicmV0aXJlXCIpIHtcbiAgICAgICAgaWYgKHRoaXMuZ2VuZXJhdGlvbklkICYmIG1lc3NhZ2UuZ2VuZXJhdGlvbklkID09PSB0aGlzLmdlbmVyYXRpb25JZCkge1xuICAgICAgICAgIHRoaXMub25SZXRpcmVNZXNzYWdlPy4oKVxuICAgICAgICAgIHRoaXMuX2JlZ2luR2VuZXJhdGlvblJldGlyZW1lbnQoKVxuICAgICAgICB9XG4gICAgICAgIHJldHVyblxuICAgICAgfVxuXG4gICAgICBpZiAobWVzc2FnZT8udHlwZSA9PT0gXCJqb2JcIikge1xuICAgICAgICBhd2FpdCB0aGlzLl9oYW5kbGVKb2IobWVzc2FnZS5wYXlsb2FkKVxuICAgICAgfVxuICAgIH0pXG5cbiAgICBqc29uU29ja2V0Lm9uKFwiZXJyb3JcIiwgKGVycm9yKSA9PiB7XG4gICAgICBjb25zb2xlLmVycm9yKFwiQmFja2dyb3VuZCBqb2JzIHdvcmtlciBzb2NrZXQgZXJyb3I6XCIsIGVycm9yKVxuICAgICAgaWYgKHRoaXMuZ2VuZXJhdGlvbklkICYmICF0aGlzLl9nZW5lcmF0aW9uQWNjZXB0ZWQpIHJlamVjdEhhbmRzaGFrZShlcnJvcilcbiAgICB9KVxuXG4gICAganNvblNvY2tldC5vbihcImNsb3NlXCIsICgpID0+IHtcbiAgICAgIGlmIChoYW5kc2hha2VUaW1lcikgY2xlYXJUaW1lb3V0KGhhbmRzaGFrZVRpbWVyKVxuICAgICAgdGhpcy5fc3RvcEhlYXJ0YmVhdCgpXG4gICAgICBpZiAodGhpcy5qc29uU29ja2V0ID09PSBqc29uU29ja2V0KSB0aGlzLmpzb25Tb2NrZXQgPSB1bmRlZmluZWRcbiAgICAgIGlmICh0aGlzLmdlbmVyYXRpb25JZCAmJiAhdGhpcy5fZ2VuZXJhdGlvbkFjY2VwdGVkKSB7XG4gICAgICAgIHJlamVjdEhhbmRzaGFrZShuZXcgRXJyb3IoXCJCYWNrZ3JvdW5kIGpvYnMgc29ja2V0IGNsb3NlZCBiZWZvcmUgZ2VuZXJhdGlvbiBhY2tub3dsZWRnZW1lbnRcIikpXG4gICAgICB9XG4gICAgICBpZiAodGhpcy5zaG91bGRTdG9wKSByZXR1cm5cbiAgICAgIGlmIChjb25uZWN0aW9uQWNjZXB0ZWQgfHwgYWxsb3dSZWNvbm5lY3QgfHwgIXRoaXMuZ2VuZXJhdGlvbklkKSB0aGlzLl9zY2hlZHVsZVJlY29ubmVjdCgpXG4gICAgfSlcblxuICAgIGlmICh0aGlzLmdlbmVyYXRpb25JZCkge1xuICAgICAgaGFuZHNoYWtlVGltZXIgPSBzZXRUaW1lb3V0KCgpID0+IHtcbiAgICAgICAgY29uc3QgZXJyb3IgPSBuZXcgQmFja2dyb3VuZEpvYnNHZW5lcmF0aW9uSGFuZHNoYWtlVGltZW91dEVycm9yKHtcbiAgICAgICAgICBlbmRwb2ludDogYCR7aG9zdH06JHtwb3J0fWAsXG4gICAgICAgICAgZ2VuZXJhdGlvbklkOiB0aGlzLmdlbmVyYXRpb25JZCB8fCBcIlwiLFxuICAgICAgICAgIHJvbGU6IFwid29ya2VyXCIsXG4gICAgICAgICAgdGltZW91dE1zOiB0aGlzLmdlbmVyYXRpb25IYW5kc2hha2VUaW1lb3V0TXNcbiAgICAgICAgfSlcbiAgICAgICAgcmVqZWN0SGFuZHNoYWtlKGVycm9yKVxuICAgICAgICBqc29uU29ja2V0LmRlc3Ryb3koKVxuICAgICAgfSwgdGhpcy5nZW5lcmF0aW9uSGFuZHNoYWtlVGltZW91dE1zKVxuICAgIH1cblxuICAgIHNvY2tldC5vbihcImNvbm5lY3RcIiwgKCkgPT4ge1xuICAgICAganNvblNvY2tldC5zZW5kKHt0eXBlOiBcImhlbGxvXCIsIHJvbGU6IFwid29ya2VyXCIsIC4uLih0aGlzLmdlbmVyYXRpb25JZCA/IHtnZW5lcmF0aW9uSWQ6IHRoaXMuZ2VuZXJhdGlvbklkfSA6IHt9KSwgc3VwcG9ydHNIYW5kb2ZmSWRSZXBvcnRpbmc6IHRydWUsIHN1cHBvcnRzSGVhcnRiZWF0OiB0cnVlLCBzdXBwb3J0c1Bvb2xlZDogdHJ1ZSwgd29ya2VySWQ6IHRoaXMud29ya2VySWR9KVxuICAgICAgaWYgKCF0aGlzLmdlbmVyYXRpb25JZCkge1xuICAgICAgICBjb25uZWN0aW9uQWNjZXB0ZWQgPSB0cnVlXG4gICAgICAgIHRoaXMuX3NlbmRSZWFkeUlmUnVubmluZygpXG4gICAgICAgIHRoaXMuX3N0YXJ0SGVhcnRiZWF0KClcbiAgICAgICAgcmVzb2x2ZUhhbmRzaGFrZSgpXG4gICAgICB9XG4gICAgfSlcblxuICAgIGlmICh0aGlzLmdlbmVyYXRpb25JZCkgYXdhaXQgaGFuZHNoYWtlXG4gIH1cblxuICAvKiogU2NoZWR1bGVzIG9uZSBmZW5jZWQgcmVjb25uZWN0IHRvIHRoZSB3b3JrZXIncyB1bmNoYW5nZWQgZW5kcG9pbnQuICovXG4gIF9zY2hlZHVsZVJlY29ubmVjdCgpIHtcbiAgICBpZiAodGhpcy5zaG91bGRTdG9wIHx8IHRoaXMuX3JlY29ubmVjdFRpbWVyKSByZXR1cm5cblxuICAgIHRoaXMuX3JlY29ubmVjdFRpbWVyID0gc2V0VGltZW91dCgoKSA9PiB7XG4gICAgICB0aGlzLl9yZWNvbm5lY3RUaW1lciA9IHVuZGVmaW5lZFxuICAgICAgaWYgKHRoaXMuc2hvdWxkU3RvcCkgcmV0dXJuXG4gICAgICB2b2lkIHRoaXMuX2Nvbm5lY3Qoe2FsbG93UmVjb25uZWN0OiB0cnVlfSkuY2F0Y2goKGVycm9yKSA9PiB7XG4gICAgICAgIGlmICghdGhpcy5zaG91bGRTdG9wKSBjb25zb2xlLmVycm9yKFwiQmFja2dyb3VuZCBqb2JzIHdvcmtlciByZWNvbm5lY3QgZmFpbGVkOlwiLCBlcnJvcilcbiAgICAgIH0pXG4gICAgfSwgdGhpcy5yZWNvbm5lY3REZWxheU1zKVxuICAgIGlmICh0eXBlb2YgdGhpcy5fcmVjb25uZWN0VGltZXIudW5yZWYgPT09IFwiZnVuY3Rpb25cIikgdGhpcy5fcmVjb25uZWN0VGltZXIudW5yZWYoKVxuICB9XG5cbiAgLyoqXG4gICAqIFN1cmZhY2VzIGFuIHVuZXhwZWN0ZWQgd29ya2VyIGxpZmVjeWNsZSBmYWlsdXJlIHRocm91Z2ggdGhlIGZyYW1ld29yayBlcnJvclxuICAgKiBjaGFubmVscyBzbyBhIHN1cGVydmlzb3IgaG9vayB0aGF0IGlnbm9yZXMgc3RkaW8gc3RpbGwgaGFzIG9ic2VydmFiaWxpdHkuXG4gICAqIEBwYXJhbSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59IGVycm9yIC0gV29ya2VyIGxpZmVjeWNsZSBmYWlsdXJlLlxuICAgKi9cbiAgX3JlcG9ydExpZmVjeWNsZUVycm9yKGVycm9yKSB7XG4gICAgY29uc3QgY29uZmlndXJhdGlvbiA9IHRoaXMuY29uZmlndXJhdGlvblxuICAgIGlmICghY29uZmlndXJhdGlvbikgcmV0dXJuXG4gICAgY29uc3Qgbm9ybWFsaXplZEVycm9yID0gZXJyb3IgaW5zdGFuY2VvZiBFcnJvciA/IGVycm9yIDogbmV3IEVycm9yKFN0cmluZyhlcnJvcikpXG4gICAgY29uc3QgcGF5bG9hZCA9IHtjb250ZXh0OiB7Z2VuZXJhdGlvbklkOiB0aGlzLmdlbmVyYXRpb25JZCwgc3RhZ2U6IFwiYmFja2dyb3VuZC1qb2JzLXdvcmtlci1saWZlY3ljbGVcIn0sIGVycm9yOiBub3JtYWxpemVkRXJyb3J9XG4gICAgY29uc3QgZXJyb3JFdmVudHMgPSBjb25maWd1cmF0aW9uLmdldEVycm9yRXZlbnRzKClcblxuICAgIGVycm9yRXZlbnRzLmVtaXQoXCJmcmFtZXdvcmstZXJyb3JcIiwgcGF5bG9hZClcbiAgICBlcnJvckV2ZW50cy5lbWl0KFwiYWxsLWVycm9yXCIsIHsuLi5wYXlsb2FkLCBlcnJvclR5cGU6IFwiZnJhbWV3b3JrLWVycm9yXCJ9KVxuICB9XG5cbiAgLyoqXG4gICAqIFNlbmRzIHBlcmlvZGljIGxpdmVuZXNzIGhlYXJ0YmVhdHMgdG8gdGhlIG1haW4gc28gYSB3ZWRnZWQgb3Igc2lsZW50IHdvcmtlclxuICAgKiBjYW4gYmUgZGV0ZWN0ZWQgYW5kIGRyb3BwZWQgdGhlcmUgKGl0cyBsZWFzZXMgcmVsZWFzZWQpIGluc3RlYWQgb2YgZnJlZXppbmdcbiAgICogdGhlIHF1ZXVlIHVudGlsIGEgaHVtYW4gbm90aWNlcy5cbiAgICogQHJldHVybnMge3ZvaWR9XG4gICAqL1xuICBfc3RhcnRIZWFydGJlYXQoKSB7XG4gICAgdGhpcy5fc3RvcEhlYXJ0YmVhdCgpXG5cbiAgICB0aGlzLl9oZWFydGJlYXRUaW1lciA9IHNldEludGVydmFsKCgpID0+IHRoaXMuX3NlbmRIZWFydGJlYXQoKSwgdGhpcy5oZWFydGJlYXRJbnRlcnZhbE1zKVxuXG4gICAgaWYgKHR5cGVvZiB0aGlzLl9oZWFydGJlYXRUaW1lci51bnJlZiA9PT0gXCJmdW5jdGlvblwiKSB0aGlzLl9oZWFydGJlYXRUaW1lci51bnJlZigpXG4gIH1cblxuICAvKiogU2VuZHMgb25lIGxpdmVuZXNzIGhlYXJ0YmVhdCB3aGlsZSB0aGUgd29ya2VyIGhhcyBub3QgZmluYWxseSBzdG9wcGVkLiAqL1xuICBfc2VuZEhlYXJ0YmVhdCgpIHtcbiAgICBpZiAodGhpcy5zaG91bGRTdG9wIHx8ICF0aGlzLmpzb25Tb2NrZXQpIHJldHVyblxuXG4gICAgdHJ5IHtcbiAgICAgIHRoaXMuanNvblNvY2tldC5zZW5kKHt0eXBlOiBcImhlYXJ0YmVhdFwiLCB3b3JrZXJJZDogdGhpcy53b3JrZXJJZH0pXG4gICAgfSBjYXRjaCB7XG4gICAgICAvLyBTb2NrZXQgaXMgY2xvc2luZy9jbG9zZWQ7IHRoZSBjbG9zZSBoYW5kbGVyIGRyaXZlcyByZWNvbm5lY3QuXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIFN0b3BzIHRoZSBsaXZlbmVzcyBoZWFydGJlYXQgdGltZXIuXG4gICAqIEByZXR1cm5zIHt2b2lkfVxuICAgKi9cbiAgX3N0b3BIZWFydGJlYXQoKSB7XG4gICAgaWYgKHRoaXMuX2hlYXJ0YmVhdFRpbWVyKSB7XG4gICAgICBjbGVhckludGVydmFsKHRoaXMuX2hlYXJ0YmVhdFRpbWVyKVxuICAgICAgdGhpcy5faGVhcnRiZWF0VGltZXIgPSB1bmRlZmluZWRcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogUnVucyBoYW5kbGUgam9iLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vdHlwZXMuanNcIikuQmFja2dyb3VuZEpvYlBheWxvYWR9IHBheWxvYWQgLSBQYXlsb2FkLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyB3aGVuIGRvbmUuXG4gICAqL1xuICBhc3luYyBfaGFuZGxlSm9iKHBheWxvYWQpIHtcbiAgICBpZiAoIXBheWxvYWQuaWQpIHRocm93IG5ldyBFcnJvcihcIkJhY2tncm91bmQgam9iIHBheWxvYWQgbWlzc2luZyBpZFwiKVxuICAgIC8qKlxuICAgICAqIElkZW50aWZpZWQgcGF5bG9hZC5cbiAgICAgKiBAdHlwZSB7aW1wb3J0KFwiLi90eXBlcy5qc1wiKS5CYWNrZ3JvdW5kSm9iUGF5bG9hZCAmIHtpZDogc3RyaW5nfX0gKi9cbiAgICBjb25zdCBpZGVudGlmaWVkUGF5bG9hZCA9IC8qKiBAdHlwZSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59ICovIChwYXlsb2FkKVxuXG4gICAgY29uc3QgZXhlY3V0aW9uTW9kZSA9IHRoaXMuX2V4ZWN1dGlvbk1vZGVGb3JQYXlsb2FkKGlkZW50aWZpZWRQYXlsb2FkKVxuXG4gICAgaWYgKGV4ZWN1dGlvbk1vZGUgPT09IFwicG9vbGVkXCIpIHtcbiAgICAgIHRoaXMuX3F1ZXVlUG9vbGVkSm9iKGlkZW50aWZpZWRQYXlsb2FkKVxuICAgICAgcmV0dXJuXG4gICAgfVxuXG4gICAgaWYgKGV4ZWN1dGlvbk1vZGUgIT09IFwiaW5saW5lXCIpIHtcbiAgICAgIHRoaXMuX3RyYWNrUHJvY2Vzc0pvYih0aGlzLl9zdGFydFByb2Nlc3NKb2Ioe2V4ZWN1dGlvbk1vZGUsIHBheWxvYWQ6IGlkZW50aWZpZWRQYXlsb2FkfSkpXG4gICAgICByZXR1cm5cbiAgICB9XG5cbiAgICB0aGlzLl9oYW5kbGVJbmxpbmVKb2IoaWRlbnRpZmllZFBheWxvYWQpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBzdGFydCBwcm9jZXNzIGpvYi5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBPcHRpb25zLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vdHlwZXMuanNcIikuQmFja2dyb3VuZEpvYkV4ZWN1dGlvbk1vZGV9IGFyZ3MuZXhlY3V0aW9uTW9kZSAtIEV4ZWN1dGlvbiBtb2RlLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vdHlwZXMuanNcIikuQmFja2dyb3VuZEpvYlBheWxvYWQgJiB7aWQ6IHN0cmluZ319IGFyZ3MucGF5bG9hZCAtIFBheWxvYWQuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIHdoZW4gdGhlIHByb2Nlc3Mgam9iIGV4aXRzLlxuICAgKi9cbiAgX3N0YXJ0UHJvY2Vzc0pvYih7ZXhlY3V0aW9uTW9kZSwgcGF5bG9hZH0pIHtcbiAgICBpZiAoZXhlY3V0aW9uTW9kZSA9PT0gXCJmb3JrZWRcIikgcmV0dXJuIHRoaXMuX2ZvcmtKb2IocGF5bG9hZClcblxuICAgIHJldHVybiB0aGlzLl9zcGF3bkpvYihwYXlsb2FkKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgaGFuZGxlIGlubGluZSBqb2IuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi90eXBlcy5qc1wiKS5CYWNrZ3JvdW5kSm9iUGF5bG9hZCAmIHtpZDogc3RyaW5nfX0gcGF5bG9hZCAtIFBheWxvYWQuXG4gICAqIEByZXR1cm5zIHt2b2lkfVxuICAgKi9cbiAgX2hhbmRsZUlubGluZUpvYihwYXlsb2FkKSB7XG4gICAgLy8gSW5saW5lIGpvYnMgc2hhcmUgdGhlIHdvcmtlcidzIHByb2Nlc3MgYW5kIERCIHBvb2wsIGJ1dCBlYWNoIG9uZVxuICAgIC8vIGlzIGl0cyBvd24gYXN5bmMgY2hhaW4g4oCUIHRoZXJlJ3Mgbm8gc2VtYW50aWMgcmVhc29uIHRvIHNlcmlhbGl6ZVxuICAgIC8vIHRoZW0uIFdlIGtpY2sgb2ZmIHRoZSBqb2IsIHJlZ2lzdGVyIGl0IHdpdGggYGluZmxpZ2h0SW5saW5lSm9ic2BcbiAgICAvLyBmb3Igc2h1dGRvd24gZHJhaW4sIGFuZCBzaWduYWwgY2FwYWNpdHkgdG8gbWFpbjpcbiAgICAvLyAtIElmIHdlIHN0aWxsIGhhdmUgYSBmcmVlIHNsb3Qgd2UgYXNrIGZvciB0aGUgbmV4dCBqb2IgcmlnaHRcbiAgICAvLyAgIGF3YXksIHNvIGEgc2xvdyBqb2IgKGUuZy4gYSBkb2NrZXIgYWxpdmUgY2hlY2sgdGhhdCB3YWl0cyAxNXNcbiAgICAvLyAgIG9uIGEgZ29uZSBzZXJ2ZXIpIG5vIGxvbmdlciBzdGFydmVzIGV2ZXJ5IG90aGVyIGlubGluZSBqb2IuXG4gICAgLy8gLSBXaGVuIHRoZSBqb2IgZmluaXNoZXMsIGlmIHRoZSB3b3JrZXIgaGFkIGJlZW4gYXQgdGhlIGNhcCwgd2VcbiAgICAvLyAgIGFzayBmb3IgdGhlIG5leHQgam9iIHRvIHJlZmlsbCB0aGUgc2xvdC5cbiAgICAvLyBUaGUgYm9va2tlZXBpbmcgaW4gYGZpbmFsbHkoKWAgcmF0Y2hldHMgY2FwYWNpdHkgYmFjayB1cFxuICAgIC8vIHJlZ2FyZGxlc3Mgb2Ygc3VjY2VzcyBvciBmYWlsdXJlLlxuICAgIC8qKlxuICAgICAqIERlZmluZXMgaW5mbGlnaHQuXG4gICAgICogQHR5cGUge1Byb21pc2U8dm9pZD59ICovXG4gICAgbGV0IGluZmxpZ2h0XG5cbiAgICBpbmZsaWdodCA9IHRoaXMuX3J1bklubGluZUpvYkFuZFJlcG9ydChwYXlsb2FkKS5maW5hbGx5KCgpID0+IHtcbiAgICAgIHRoaXMuaW5mbGlnaHRJbmxpbmVKb2JzLmRlbGV0ZShpbmZsaWdodClcblxuICAgICAgLy8gUmUtYW5ub3VuY2Ugb24gZXZlcnkgY29tcGxldGlvbiBiZWxvdyBjYXAsIG5vdCBqdXN0IHRoZSBjYXDihpJjYXAtMSBlZGdlIOKAlFxuICAgICAgLy8gc2VlIF90cmFja1Byb2Nlc3NKb2IgZm9yIHdoeSB0aGUga25pZmUtZWRnZSBjb25kaXRpb24gc2lsZW50bHkgd2VkZ2VzLlxuICAgICAgaWYgKCF0aGlzLnNob3VsZFN0b3ApIHRoaXMuX3NlbmRSZWFkeUlmUnVubmluZygpXG4gICAgfSlcblxuICAgIHRoaXMuaW5mbGlnaHRJbmxpbmVKb2JzLmFkZChpbmZsaWdodClcblxuICAgIGlmICh0aGlzLmluZmxpZ2h0SW5saW5lSm9icy5zaXplIDwgdGhpcy5tYXhDb25jdXJyZW50SW5saW5lSm9icykge1xuICAgICAgdGhpcy5fc2VuZFJlYWR5SWZSdW5uaW5nKClcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogUnVucyBleGVjdXRpb24gbW9kZSBmb3IgcGF5bG9hZC5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL3R5cGVzLmpzXCIpLkJhY2tncm91bmRKb2JQYXlsb2FkfSBwYXlsb2FkIC0gUGF5bG9hZC5cbiAgICogQHJldHVybnMge2ltcG9ydChcIi4vdHlwZXMuanNcIikuQmFja2dyb3VuZEpvYkV4ZWN1dGlvbk1vZGV9IC0gRXhlY3V0aW9uIG1vZGUuXG4gICAqL1xuICBfZXhlY3V0aW9uTW9kZUZvclBheWxvYWQocGF5bG9hZCkge1xuICAgIGNvbnN0IGV4ZWN1dGlvbk1vZGUgPSBwYXlsb2FkLm9wdGlvbnM/LmV4ZWN1dGlvbk1vZGVcblxuICAgIHJldHVybiBleGVjdXRpb25Nb2RlID8gdGhpcy5fbm9ybWFsaXplRXhlY3V0aW9uTW9kZShleGVjdXRpb25Nb2RlKSA6IFwicG9vbGVkXCJcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIG5vcm1hbGl6ZSBleGVjdXRpb24gbW9kZS5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGV4ZWN1dGlvbk1vZGUgLSBFeGVjdXRpb24gbW9kZS5cbiAgICogQHJldHVybnMge2ltcG9ydChcIi4vdHlwZXMuanNcIikuQmFja2dyb3VuZEpvYkV4ZWN1dGlvbk1vZGV9IC0gTm9ybWFsaXplZCBleGVjdXRpb24gbW9kZS5cbiAgICovXG4gIF9ub3JtYWxpemVFeGVjdXRpb25Nb2RlKGV4ZWN1dGlvbk1vZGUpIHtcbiAgICBmb3IgKGNvbnN0IG1vZGUgb2YgRVhFQ1VUSU9OX01PREVTKSB7XG4gICAgICBpZiAobW9kZSA9PT0gZXhlY3V0aW9uTW9kZSkgcmV0dXJuIG1vZGVcbiAgICB9XG5cbiAgICB0aHJvdyBuZXcgRXJyb3IoYEludmFsaWQgYmFja2dyb3VuZCBqb2IgZXhlY3V0aW9uTW9kZTogJHtleGVjdXRpb25Nb2RlfWApXG4gIH1cblxuICAvKipcbiAgICogUnVucyB0cmFjayBwcm9jZXNzIGpvYi5cbiAgICogQHBhcmFtIHtQcm9taXNlPHZvaWQ+fSBwcm9jZXNzSm9iIC0gUHJvY2VzcyBqb2IgcHJvbWlzZS5cbiAgICogQHJldHVybnMge3ZvaWR9XG4gICAqL1xuICBfdHJhY2tQcm9jZXNzSm9iKHByb2Nlc3NKb2IpIHtcbiAgICAvKipcbiAgICAgKiBEZWZpbmVzIGluZmxpZ2h0LlxuICAgICAqIEB0eXBlIHtQcm9taXNlPHZvaWQ+fSAqL1xuICAgIGxldCBpbmZsaWdodFxuXG4gICAgaW5mbGlnaHQgPSBwcm9jZXNzSm9iLmZpbmFsbHkoKCkgPT4ge1xuICAgICAgdGhpcy5pbmZsaWdodFByb2Nlc3NKb2JzLmRlbGV0ZShpbmZsaWdodClcblxuICAgICAgLy8gUmUtYW5ub3VuY2UgcmVhZGluZXNzIG9uIEVWRVJZIGNvbXBsZXRpb24gdGhhdCBsZWF2ZXMgdXMgYmVsb3cgY2FwIOKAlCBub3RcbiAgICAgIC8vIGp1c3QgdGhlIHNpbmdsZSBjYXDihpJjYXAtMSBlZGdlLiBUaGUgbWFpbiByZW1vdmVzIGEgd29ya2VyIGZyb20gaXRzIHJlYWR5XG4gICAgICAvLyBzZXQgb24gZWFjaCBkaXNwYXRjaCAoYF9kcmFpbk9uY2VgKSBhbmQgb25seSByZS1hZGRzIGl0IG9uIGEgZnJlc2hcbiAgICAgIC8vIFwicmVhZHlcIjsgZ2F0aW5nIHRoZSByZS1hbm5vdW5jZSBvbiBvbmUga25pZmUtZWRnZSB0cmFuc2l0aW9uIG1lYW5zIGFcbiAgICAgIC8vIHNpbmdsZSBtaXNzZWQgb3IgbG9zdCBzaWduYWwgbGVhdmVzIHRoZSB3b3JrZXIgb3V0IG9mIHRoZSByZWFkeSBzZXQgYW5kXG4gICAgICAvLyB3ZWRnZXMgZGlzcGF0Y2ggY2x1c3Rlci13aWRlLiBUaGlzIHdhcyB0aGUgc2lsZW50LWZyZWV6ZSByb290IGNhdXNlLlxuICAgICAgLy8gYF9zZW5kUmVhZHlJZlJ1bm5pbmdgIHNlbGYtZ3VhcmRzIChpdCBzZW5kcyBub3RoaW5nIHdoZW4gdGhlIHdvcmtlciBpc1xuICAgICAgLy8gZ2VudWluZWx5IGF0IGNhcGFjaXR5KSwgc28gcmUtYW5ub3VuY2luZyBvbiBldmVyeSBmcmVlZCBzbG90IGlzIHNhZmUgYW5kXG4gICAgICAvLyBpZGVtcG90ZW50IG9uIHRoZSBtYWluLlxuICAgICAgaWYgKCF0aGlzLnNob3VsZFN0b3ApIHRoaXMuX3NlbmRSZWFkeUlmUnVubmluZygpXG4gICAgfSlcblxuICAgIHRoaXMuaW5mbGlnaHRQcm9jZXNzSm9icy5hZGQoaW5mbGlnaHQpXG4gICAgdGhpcy5fc2VuZFJlYWR5SWZSdW5uaW5nKClcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHJ1biBpbmxpbmUgam9iIGFuZCByZXBvcnQuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi90eXBlcy5qc1wiKS5CYWNrZ3JvdW5kSm9iUGF5bG9hZCAmIHtpZDogc3RyaW5nfX0gcGF5bG9hZCAtIFBheWxvYWQgd2l0aCByZXF1aXJlZCBpZC5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgd2hlbiBjb21wbGV0ZSAoc3VjY2VzcyBvciBmYWlsdXJlIHJlcG9ydGVkKS5cbiAgICovXG4gIGFzeW5jIF9ydW5JbmxpbmVKb2JBbmRSZXBvcnQocGF5bG9hZCkge1xuICAgIC8vIFJlcG9ydCBpbiB0aGUgYmFja2dyb3VuZCBzbyBmcmVlaW5nIHRoaXMgaW5saW5lIHNsb3QgbmV2ZXIgd2FpdHMgb24gdGhlXG4gICAgLy8gcmVwb3J0LiBSZXBvcnRpbmcgaXMgZHVyYWJsZSAocmV0cmllZCB1bnRpbCBpdCBsYW5kcyksIHNvIGEgdHJhbnNpZW50XG4gICAgLy8gbWFpbi9EQiBvdXRhZ2UgbmVpdGhlciB3ZWRnZXMgdGhlIHNsb3Qgbm9yIGxvc2VzIHRoZSB0ZXJtaW5hbCByZXN1bHQuXG4gICAgdHJ5IHtcbiAgICAgIGF3YWl0IHRoaXMuX3J1bkpvYklubGluZShwYXlsb2FkKVxuICAgICAgdGhpcy5fcmVwb3J0Sm9iUmVzdWx0SW5CYWNrZ3JvdW5kKHtcbiAgICAgICAgam9iSWQ6IHBheWxvYWQuaWQsXG4gICAgICAgIHN0YXR1czogXCJjb21wbGV0ZWRcIixcbiAgICAgICAgaGFuZG9mZklkOiBwYXlsb2FkLmhhbmRvZmZJZCxcbiAgICAgICAgaGFuZGVkT2ZmQXRNczogcGF5bG9hZC5oYW5kZWRPZmZBdE1zLFxuICAgICAgICB3b3JrZXJJZDogcGF5bG9hZC53b3JrZXJJZCB8fCB0aGlzLndvcmtlcklkXG4gICAgICB9KVxuICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICBpZiAoZXJyb3IgaW5zdGFuY2VvZiBCYWNrZ3JvdW5kSm9iUmVzY2hlZHVsZVNpZ25hbCkge1xuICAgICAgICB0aGlzLl9yZXBvcnRKb2JSZXN1bHRJbkJhY2tncm91bmQoe1xuICAgICAgICAgIGpvYklkOiBwYXlsb2FkLmlkLFxuICAgICAgICAgIHN0YXR1czogXCJyZXNjaGVkdWxlZFwiLFxuICAgICAgICAgIGRlbGF5TXM6IGVycm9yLmRlbGF5TXMsXG4gICAgICAgICAgaGFuZG9mZklkOiBwYXlsb2FkLmhhbmRvZmZJZCxcbiAgICAgICAgICBoYW5kZWRPZmZBdE1zOiBwYXlsb2FkLmhhbmRlZE9mZkF0TXMsXG4gICAgICAgICAgd29ya2VySWQ6IHBheWxvYWQud29ya2VySWQgfHwgdGhpcy53b3JrZXJJZFxuICAgICAgICB9KVxuICAgICAgICByZXR1cm5cbiAgICAgIH1cblxuICAgICAgdGhpcy5fcmVwb3J0Sm9iUmVzdWx0SW5CYWNrZ3JvdW5kKHtcbiAgICAgICAgam9iSWQ6IHBheWxvYWQuaWQsXG4gICAgICAgIHN0YXR1czogXCJmYWlsZWRcIixcbiAgICAgICAgZXJyb3IsXG4gICAgICAgIGhhbmRvZmZJZDogcGF5bG9hZC5oYW5kb2ZmSWQsXG4gICAgICAgIGhhbmRlZE9mZkF0TXM6IHBheWxvYWQuaGFuZGVkT2ZmQXRNcyxcbiAgICAgICAgd29ya2VySWQ6IHBheWxvYWQud29ya2VySWQgfHwgdGhpcy53b3JrZXJJZFxuICAgICAgfSlcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogQWR2ZXJ0aXNlcyBjdXJyZW50IHdvcmtlciBjYXBhY2l0eSB1bmxlc3MgdGhlIHdvcmtlciBpcyBkcmFpbmluZy5cbiAgICogQHBhcmFtIHtvYmplY3R9IFtvcHRpb25zXSAtIEFkdmVydGlzZW1lbnQgb3B0aW9ucy5cbiAgICogQHBhcmFtIHtib29sZWFufSBbb3B0aW9ucy5yZXZva2VQb29sZWRBZG1pc3Npb25dIC0gUmV2b2tlIHBvb2xlZCBjcmVkaXRzIHdoaWxlIHByZXNlcnZpbmcgb3RoZXIgZXhlY3V0aW9uIG1vZGVzLlxuICAgKiBAcmV0dXJucyB7dm9pZH1cbiAgICovXG4gIF9zZW5kUmVhZHlJZlJ1bm5pbmcoe3Jldm9rZVBvb2xlZEFkbWlzc2lvbiA9IGZhbHNlfSA9IHt9KSB7XG4gICAgaWYgKHRoaXMuc2hvdWxkU3RvcCB8fCB0aGlzLmlzUmV0aXJpbmcpIHJldHVyblxuICAgIGlmICghdGhpcy5qc29uU29ja2V0KSByZXR1cm5cbiAgICBpZiAodGhpcy5nZW5lcmF0aW9uSWQgJiYgIXRoaXMuX2dlbmVyYXRpb25BY2NlcHRlZCkgcmV0dXJuXG5cbiAgICBjb25zdCByZWFkeU1lc3NhZ2UgPSB0aGlzLl9yZWFkeU1lc3NhZ2Uoe3Jldm9rZVBvb2xlZEFkbWlzc2lvbn0pXG5cbiAgICBpZiAoIXJlYWR5TWVzc2FnZSkgcmV0dXJuXG4gICAgdGhpcy5qc29uU29ja2V0LnNlbmQocmVhZHlNZXNzYWdlKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgcmVhZHkgbWVzc2FnZS5cbiAgICogQHBhcmFtIHtvYmplY3R9IFtvcHRpb25zXSAtIEFkdmVydGlzZW1lbnQgb3B0aW9ucy5cbiAgICogQHBhcmFtIHtib29sZWFufSBbb3B0aW9ucy5yZXZva2VQb29sZWRBZG1pc3Npb25dIC0gUmV2b2tlIHBvb2xlZCBjcmVkaXRzIHdoaWxlIHByZXNlcnZpbmcgb3RoZXIgZXhlY3V0aW9uIG1vZGVzLlxuICAgKiBAcmV0dXJucyB7aW1wb3J0KFwiLi90eXBlcy5qc1wiKS5CYWNrZ3JvdW5kSm9iU29ja2V0TWVzc2FnZSB8IG51bGx9IC0gUmVhZHkgbWVzc2FnZSBvciBudWxsIHdoZW4gdGhlIHdvcmtlciBoYXMgbm8gY2FwYWNpdHkuXG4gICAqL1xuICBfcmVhZHlNZXNzYWdlKHtyZXZva2VQb29sZWRBZG1pc3Npb24gPSBmYWxzZX0gPSB7fSkge1xuICAgIGNvbnN0IGFjY2VwdHNQcm9jZXNzSm9iID0gdGhpcy5pbmZsaWdodFByb2Nlc3NKb2JzLnNpemUgPCB0aGlzLm1heENvbmN1cnJlbnRGb3JrZWRKb2JzXG4gICAgY29uc3QgYWNjZXB0c0lubGluZSA9IHRoaXMuaW5mbGlnaHRJbmxpbmVKb2JzLnNpemUgPCB0aGlzLm1heENvbmN1cnJlbnRJbmxpbmVKb2JzXG4gICAgY29uc3QgYXZhaWxhYmxlUG9vbGVkU2xvdHMgPSByZXZva2VQb29sZWRBZG1pc3Npb24gPyAwIDogdGhpcy5fYXZhaWxhYmxlUG9vbGVkU2xvdHMoKVxuICAgIGNvbnN0IGFjY2VwdHNQb29sZWQgPSBhdmFpbGFibGVQb29sZWRTbG90cyA+IDBcblxuICAgIGlmICghcmV2b2tlUG9vbGVkQWRtaXNzaW9uICYmICFhY2NlcHRzUHJvY2Vzc0pvYiAmJiAhYWNjZXB0c0lubGluZSAmJiAhYWNjZXB0c1Bvb2xlZCkgcmV0dXJuIG51bGxcblxuICAgIHJldHVybiB7XG4gICAgICB0eXBlOiBcInJlYWR5XCIsXG4gICAgICBhY2NlcHRzRm9ya2VkOiBhY2NlcHRzUHJvY2Vzc0pvYixcbiAgICAgIGFjY2VwdHNJbmxpbmUsXG4gICAgICBhY2NlcHRzUG9vbGVkLFxuICAgICAgYXZhaWxhYmxlUG9vbGVkU2xvdHMsXG4gICAgICBhY2NlcHRzU3Bhd25lZDogYWNjZXB0c1Byb2Nlc3NKb2JcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogVHJhY2tzIGEgcG9vbGVkIGpvYiBhbmQgcmUtYWR2ZXJ0aXNlcyBjYXBhY2l0eS5cbiAgICogQHBhcmFtIHtQcm9taXNlPHZvaWQ+fSBwb29sZWRKb2IgLSBQb29sZWQgam9iIHByb21pc2UuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFRoZSB0cmFja2VkIGluLWZsaWdodCBwcm9taXNlLlxuICAgKi9cbiAgX3RyYWNrUG9vbGVkSm9iKHBvb2xlZEpvYikge1xuICAgIC8qKiBAdHlwZSB7UHJvbWlzZTx2b2lkPn0gKi9cbiAgICBsZXQgaW5mbGlnaHRcbiAgICBpbmZsaWdodCA9IHBvb2xlZEpvYi5maW5hbGx5KCgpID0+IHtcbiAgICAgIHRoaXMuaW5mbGlnaHRQb29sZWRKb2JzLmRlbGV0ZShpbmZsaWdodClcbiAgICAgIGlmICghdGhpcy5zaG91bGRTdG9wICYmICF0aGlzLl9wb29sZWRTdGFydHVwRmFpbHVyZUpvYnMuaGFzKHBvb2xlZEpvYikgJiYgIXRoaXMuX3Bvb2xlZFN0YXJ0dXBGYWlsdXJlSm9icy5oYXMoaW5mbGlnaHQpKSB0aGlzLl9zZW5kUmVhZHlJZlJ1bm5pbmcoKVxuICAgIH0pXG4gICAgdGhpcy5pbmZsaWdodFBvb2xlZEpvYnMuYWRkKGluZmxpZ2h0KVxuICAgIHJldHVybiBpbmZsaWdodFxuICB9XG5cbiAgLyoqXG4gICAqIFNlcmlhbGl6ZXMgcmVwZWF0ZWQgbGVhc2VzIGZvciBvbmUgZHVyYWJsZSByb3cgd2hpbGUgcHJlc2VydmluZyBwb29sZWRcbiAgICogY29uY3VycmVuY3kgYWNyb3NzIGRpZmZlcmVudCBqb2IgaWRzLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vdHlwZXMuanNcIikuQmFja2dyb3VuZEpvYlBheWxvYWQgJiB7aWQ6IHN0cmluZ319IHBheWxvYWQgLSBQb29sZWQgam9iIHBheWxvYWQuXG4gICAqIEByZXR1cm5zIHt2b2lkfVxuICAgKi9cbiAgX3F1ZXVlUG9vbGVkSm9iKHBheWxvYWQpIHtcbiAgICBjb25zdCBxdWV1ZSA9IHRoaXMucG9vbGVkSm9iUXVldWVzLmdldChwYXlsb2FkLmlkKVxuICAgIGlmIChxdWV1ZSkge1xuICAgICAgcXVldWUucHVzaChwYXlsb2FkKVxuICAgICAgcmV0dXJuXG4gICAgfVxuXG4gICAgdGhpcy5wb29sZWRKb2JRdWV1ZXMuc2V0KHBheWxvYWQuaWQsIFtwYXlsb2FkXSlcbiAgICBjb25zdCB0cmFja2VyID0gdGhpcy5fdHJhY2tQb29sZWRKb2IodGhpcy5fcnVuUG9vbGVkSm9iUXVldWUocGF5bG9hZC5pZCkpXG4gICAgdGhpcy5wb29sZWRKb2JRdWV1ZVRyYWNrZXJzLnNldChwYXlsb2FkLmlkLCB0cmFja2VyKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgYWRtaXR0ZWQgbGVhc2VzIGZvciBvbmUgZHVyYWJsZSBqb2IgaWQgaW4gYXJyaXZhbCBvcmRlci5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGpvYklkIC0gRHVyYWJsZSBqb2IgaWQuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIGFmdGVyIHRoZSBwZXItaWQgcXVldWUgZHJhaW5zLlxuICAgKi9cbiAgYXN5bmMgX3J1blBvb2xlZEpvYlF1ZXVlKGpvYklkKSB7XG4gICAgY29uc3QgcXVldWUgPSB0aGlzLnBvb2xlZEpvYlF1ZXVlcy5nZXQoam9iSWQpXG4gICAgaWYgKCFxdWV1ZSkgdGhyb3cgbmV3IEVycm9yKGBQb29sZWQgam9iIHF1ZXVlIG1pc3NpbmcgZm9yIGpvYjogJHtqb2JJZH1gKVxuXG4gICAgdHJ5IHtcbiAgICAgIHdoaWxlIChxdWV1ZS5sZW5ndGggPiAwKSB7XG4gICAgICAgIGNvbnN0IHBheWxvYWQgPSBxdWV1ZS5zaGlmdCgpXG4gICAgICAgIGlmICghcGF5bG9hZCkgdGhyb3cgbmV3IEVycm9yKGBQb29sZWQgam9iIHF1ZXVlIGNvbnRhaW5lZCBhbiBlbXB0eSBwYXlsb2FkIGZvciBqb2I6ICR7am9iSWR9YClcbiAgICAgICAgYXdhaXQgdGhpcy5fcnVuUG9vbGVkSm9iKHBheWxvYWQpXG4gICAgICB9XG4gICAgfSBmaW5hbGx5IHtcbiAgICAgIGNvbnN0IHRyYWNrZXIgPSB0aGlzLnBvb2xlZEpvYlF1ZXVlVHJhY2tlcnMuZ2V0KGpvYklkKVxuICAgICAgaWYgKHRyYWNrZXIpIHtcbiAgICAgICAgdGhpcy5pbmZsaWdodFBvb2xlZEpvYnMuZGVsZXRlKHRyYWNrZXIpXG4gICAgICAgIHRoaXMucG9vbGVkSm9iUXVldWVUcmFja2Vycy5kZWxldGUoam9iSWQpXG4gICAgICB9XG4gICAgICB0aGlzLnBvb2xlZEpvYlF1ZXVlcy5kZWxldGUoam9iSWQpXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIEZyZWUgcG9vbGVkIHNsb3RzIGFjcm9zcyB0aGUgcG9vbDogb3BlbiBzbG90cyBpbiBub24tcmV0aXJpbmcgY2hpbGRyZW4gcGx1c1xuICAgKiB0aGUgc2xvdHMgd2UgY291bGQgYWRkIGJ5IHNwYXduaW5nIG1vcmUgY2hpbGRyZW4gdXAgdG8gYHBvb2xlZFJ1bm5lckNvdW50YC5cbiAgICogUmV0aXJpbmcgY2hpbGRyZW4gKGRyYWluaW5nIGJlZm9yZSByZXBsYWNlbWVudCkgbmV2ZXIgY29udHJpYnV0ZSBjYXBhY2l0eS5cbiAgICogQHJldHVybnMge251bWJlcn0gLSBOdW1iZXIgb2YgcG9vbGVkIGpvYnMgdGhlIHdvcmtlciBjYW4gYWNjZXB0IHJpZ2h0IG5vdy5cbiAgICovXG4gIF9hdmFpbGFibGVQb29sZWRTbG90cygpIHtcbiAgICBsZXQgb3BlbkluRXhpc3RpbmcgPSAwXG4gICAgbGV0IG5vblJldGlyaW5nQ2hpbGRyZW4gPSAwXG4gICAgbGV0IHF1ZXVlZFJlc2VydmF0aW9ucyA9IDBcblxuICAgIGZvciAoY29uc3QgY2hpbGQgb2YgdGhpcy5wb29sZWRDaGlsZHJlbikge1xuICAgICAgY29uc3Qgc3RhdGUgPSB0aGlzLnBvb2xlZENoaWxkU3RhdGVzLmdldChjaGlsZClcbiAgICAgIGlmICghc3RhdGUgfHwgc3RhdGUucmV0aXJpbmcpIGNvbnRpbnVlXG4gICAgICBub25SZXRpcmluZ0NoaWxkcmVuICs9IDFcbiAgICAgIG9wZW5JbkV4aXN0aW5nICs9IHRoaXMucG9vbGVkUnVubmVyQ29uY3VycmVuY3kgLSBzdGF0ZS5pbmZsaWdodC5zaXplXG4gICAgfVxuXG4gICAgZm9yIChjb25zdCBxdWV1ZSBvZiB0aGlzLnBvb2xlZEpvYlF1ZXVlcy52YWx1ZXMoKSkgcXVldWVkUmVzZXJ2YXRpb25zICs9IHF1ZXVlLmxlbmd0aFxuXG4gICAgY29uc3Qgc3Bhd25hYmxlQ2hpbGRyZW4gPSBNYXRoLm1heCgwLCB0aGlzLnBvb2xlZFJ1bm5lckNvdW50IC0gbm9uUmV0aXJpbmdDaGlsZHJlbilcblxuICAgIHJldHVybiBNYXRoLm1heCgwLCBvcGVuSW5FeGlzdGluZyArIHNwYXduYWJsZUNoaWxkcmVuICogdGhpcy5wb29sZWRSdW5uZXJDb25jdXJyZW5jeSAtIHF1ZXVlZFJlc2VydmF0aW9ucylcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGEgcGF5bG9hZCBvbiBhIHBvb2xlZCBjaGlsZCB3aXRoIGEgZnJlZSBjb25jdXJyZW5jeSBzbG90LCBzcGF3bmluZyBhXG4gICAqIG5ldyBjaGlsZCB3aGVuIGV2ZXJ5IG5vbi1yZXRpcmluZyBjaGlsZCBpcyBmdWxsIGFuZCB0aGUgcG9vbCBpcyBiZWxvd1xuICAgKiBgcG9vbGVkUnVubmVyQ291bnRgLiBFYWNoIGNoaWxkIHJ1bnMgdXAgdG8gYHBvb2xlZFJ1bm5lckNvbmN1cnJlbmN5YCBqb2JzIGF0XG4gICAqIG9uY2Ugb24gaXRzIG93biBldmVudCBsb29wLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vdHlwZXMuanNcIikuQmFja2dyb3VuZEpvYlBheWxvYWQgJiB7aWQ6IHN0cmluZ319IHBheWxvYWQgLSBKb2IgcGF5bG9hZC5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgYWZ0ZXIgdGhlIGR1cmFibGUgcmVwb3J0LlxuICAgKi9cbiAgX3J1blBvb2xlZEpvYihwYXlsb2FkKSB7XG4gICAgY29uc3QgY2hpbGQgPSB0aGlzLl9zZWxlY3RQb29sZWRDaGlsZCgpIHx8IHRoaXMuX2NyZWF0ZVBvb2xlZENoaWxkKClcbiAgICBjb25zdCBzdGF0ZSA9IHRoaXMucG9vbGVkQ2hpbGRTdGF0ZXMuZ2V0KGNoaWxkKVxuICAgIGlmICghc3RhdGUpIHRocm93IG5ldyBFcnJvcihcIlBvb2xlZCBydW5uZXIgc3RhdGUgbWlzc2luZ1wiKVxuXG4gICAgLy8gU3RhbXAgdGhlIHJvdW5kLXJvYmluIGN1cnNvciBzbyB0aGUgbmV4dCBkaXNwYXRjaCBwcmVmZXJzIGEgZGlmZmVyZW50IGNoaWxkLlxuICAgIHN0YXRlLmxhc3REaXNwYXRjaFNlcSA9ICsrdGhpcy5fcG9vbGVkRGlzcGF0Y2hTZXFcblxuICAgIC8qKlxuICAgICAqIFJlc29sdmVzIHRoZSBwb29sZWQgam9iIHByb21pc2UuXG4gICAgICogQHR5cGUgeyh2YWx1ZTogdm9pZCkgPT4gdm9pZH1cbiAgICAgKi9cbiAgICBsZXQgcmVzb2x2ZVBvb2xlZEpvYiA9ICgpID0+IHt9XG4gICAgY29uc3QgcG9vbGVkSm9iID0gbmV3IFByb21pc2UoKHJlc29sdmUpID0+IHsgcmVzb2x2ZVBvb2xlZEpvYiA9IHJlc29sdmUgfSlcbiAgICBjb25zdCB0aW1lb3V0VGltZXIgPSB0aGlzLl9hcm1Qb29sZWRKb2JUaW1lb3V0KHtjaGlsZCwgcGF5bG9hZH0pXG5cbiAgICBzdGF0ZS5pbmZsaWdodC5zZXQocGF5bG9hZC5pZCwge3BheWxvYWQsIHJlc29sdmU6IHJlc29sdmVQb29sZWRKb2IsIHBvb2xlZEpvYiwgdGltZW91dFRpbWVyfSlcbiAgICB0cnkge1xuICAgICAgY2hpbGQuc2VuZCh7dHlwZTogXCJqb2JcIiwgcGF5bG9hZCwgc2hhcmVkVHJhbnNhY3Rpb25Ccm9rZXI6IHRoaXMuX3Bvb2xlZEpvYlNoYXJlZFRyYW5zYWN0aW9uQnJva2VyQ29uZmlnKCl9KVxuICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICB2b2lkIHRoaXMuX2hhbmRsZVBvb2xlZENoaWxkRmFpbHVyZSh7Y2hpbGQsIGVycm9yLCBvcmlnaW46IFwiaXBjLXNlbmRcIn0pXG4gICAgfVxuXG4gICAgcmV0dXJuIHBvb2xlZEpvYlxuICB9XG5cbiAgLyoqXG4gICAqIENhcHR1cmVzIHRoZSBjdXJyZW50IHRlc3QgYXR0ZW1wdCdzIGJyb2tlciBtb2RlIGF0IGRpc3BhdGNoIHRpbWUuIEEgd2FybVxuICAgKiBwb29sZWQgY2hpbGQgbXVzdCBuZXZlciByZWx5IG9uIGl0cyBpbW11dGFibGUgZm9yay10aW1lIGVudmlyb25tZW50LlxuICAgKiBAcmV0dXJucyB7aW1wb3J0KFwiLi4vdGVzdGluZy9zaGFyZWQtdHJhbnNhY3Rpb24tcHJveHktZHJpdmVyLmpzXCIpLlNoYXJlZFRyYW5zYWN0aW9uQnJva2VySm9iQ29uZmlnfSAtIFBlci1qb2IgYnJva2VyIGNvbmZpZ3VyYXRpb24uXG4gICAqL1xuICBfcG9vbGVkSm9iU2hhcmVkVHJhbnNhY3Rpb25Ccm9rZXJDb25maWcoKSB7XG4gICAgY29uc3Qgc2VyaWFsaXplZCA9IHByb2Nlc3MuZW52LlZFTE9DSU9VU19URVNUX1NIQVJFRF9UUkFOU0FDVElPTl9CUk9LRVJcbiAgICBpZiAoIXNlcmlhbGl6ZWQpIHJldHVybiB7ZXhwZWN0ZWQ6IGZhbHNlfVxuXG4gICAgY29uc3QgY29uZmlnID0gSlNPTi5wYXJzZShCdWZmZXIuZnJvbShzZXJpYWxpemVkLCBcImJhc2U2NHVybFwiKS50b1N0cmluZyhcInV0ZjhcIikpXG4gICAgcmV0dXJuIHsuLi5jb25maWcsIGV4cGVjdGVkOiB0cnVlfVxuICB9XG5cbiAgLyoqXG4gICAqIFNlbGVjdHMgYSBwb29sZWQgY2hpbGQgdG8gcnVuIHRoZSBuZXh0IGpvYiwgb3IgdW5kZWZpbmVkIHdoZW4gZXZlcnkgbm9uLXJldGlyaW5nXG4gICAqIGNoaWxkIGlzIGFscmVhZHkgZnVsbCAodGhlIGNhbGxlciB0aGVuIGxhemlseSBzcGF3bnMgb25lKS4gQW1vbmcgY2hpbGRyZW4gd2l0aCBhXG4gICAqIGZyZWUgY29uY3VycmVuY3kgc2xvdCwgcGlja3MgdGhlIG9uZSBkaXNwYXRjaGVkIGxlYXN0IHJlY2VudGx5IOKAlCBhIHJvdW5kLXJvYmluIHRoYXRcbiAgICogc3ByZWFkcyBqb2JzIChub3RhYmx5IG11bHRpLW1pbnV0ZSBSdW5CdWlsZEpvYnMsIGVhY2ggcGlubmluZyBhIHRlbmFudCBjb25uZWN0aW9uXG4gICAqIGZvciBpdHMgd2hvbGUgcnVuKSBldmVubHkgYWNyb3NzIGNoaWxkcmVuIGluc3RlYWQgb2YgZmlyc3QtZml0IHBhY2tpbmcgdGhlIGVhcmxpZXN0XG4gICAqIG9uZSB1bnRpbCBpdCBpcyBmdWxsLiBBIGZyZXNobHkgc3Bhd25lZCBvciByZXBsYWNlbWVudCBjaGlsZCB0aGVyZWZvcmUgdGFrZXMgaXRzXG4gICAqIGZhaXIgc2hhcmUgb25lIGpvYiBhdCBhIHRpbWUgYXMgaXRzIHR1cm4gY29tZXMgdXAsIHJhdGhlciB0aGFuIGFic29yYmluZyBhIGJ1cnN0IHRvXG4gICAqIFwiY2F0Y2ggdXBcIiB0byB0aGUgb3RoZXJzLlxuICAgKiBAcmV0dXJucyB7aW1wb3J0KFwibm9kZTpjaGlsZF9wcm9jZXNzXCIpLkNoaWxkUHJvY2VzcyB8IHVuZGVmaW5lZH0gLSBUaGUgY2hvc2VuIGNoaWxkLCBvciB1bmRlZmluZWQgd2hlbiBhbGwgbm9uLXJldGlyaW5nIGNoaWxkcmVuIGFyZSBmdWxsLlxuICAgKi9cbiAgX3NlbGVjdFBvb2xlZENoaWxkKCkge1xuICAgIC8qKiBAdHlwZSB7aW1wb3J0KFwibm9kZTpjaGlsZF9wcm9jZXNzXCIpLkNoaWxkUHJvY2VzcyB8IHVuZGVmaW5lZH0gKi9cbiAgICBsZXQgc2VsZWN0ZWRcbiAgICBsZXQgc2VsZWN0ZWRTZXEgPSBJbmZpbml0eVxuXG4gICAgZm9yIChjb25zdCBjaGlsZCBvZiB0aGlzLnBvb2xlZENoaWxkcmVuKSB7XG4gICAgICBjb25zdCBzdGF0ZSA9IHRoaXMucG9vbGVkQ2hpbGRTdGF0ZXMuZ2V0KGNoaWxkKVxuXG4gICAgICBpZiAoIXN0YXRlIHx8IHN0YXRlLnJldGlyaW5nIHx8IHN0YXRlLmluZmxpZ2h0LnNpemUgPj0gdGhpcy5wb29sZWRSdW5uZXJDb25jdXJyZW5jeSkgY29udGludWVcblxuICAgICAgaWYgKHN0YXRlLmxhc3REaXNwYXRjaFNlcSA8IHNlbGVjdGVkU2VxKSB7XG4gICAgICAgIHNlbGVjdGVkID0gY2hpbGRcbiAgICAgICAgc2VsZWN0ZWRTZXEgPSBzdGF0ZS5sYXN0RGlzcGF0Y2hTZXFcbiAgICAgIH1cbiAgICB9XG5cbiAgICByZXR1cm4gc2VsZWN0ZWRcbiAgfVxuXG4gIC8qKlxuICAgKiBBcm1zIGEgcGVyLWpvYiB3YWxsLWNsb2NrIGJhY2tzdG9wIGZvciBhIHBvb2xlZCBqb2IuIEEgcG9vbGVkIGNoaWxkIGhvc3RzIG1hbnlcbiAgICogY29uY3VycmVudCBqb2JzLCBzbyBhIHNpbmdsZSBnZW51aW5lbHktaHVuZyBqb2Igd291bGQgb3RoZXJ3aXNlIHBpbiBpdHNcbiAgICogcnVubmVyJ3MgY29uY3VycmVuY3kgc2xvdCBmb3JldmVyIOKAlCB0aGUgbGlmZXRpbWUgcmVjeWNsZSBvbmx5IHJldGlyZXMgYSBjaGlsZFxuICAgKiBvbmNlIGl0cyBpbi1mbGlnaHQgc2V0IGRyYWlucywgd2hpY2ggYSBodW5nIGpvYiBuZXZlciBkb2VzLiBPbiBvdmVycnVuIHRoZVxuICAgKiB3aG9sZSBjaGlsZCBpcyB0ZXJtaW5hdGVkIHNvIHRoZSBodW5nIGpvYiAoYW5kIGl0cyBzaWJsaW5ncykgcmVxdWV1ZS4gUmV0dXJuc1xuICAgKiB0aGUgdGltZXIsIG9yIG51bGwgd2hlbiBubyB0aW1lb3V0IGlzIGNvbmZpZ3VyZWQuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gT3B0aW9ucy5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCJub2RlOmNoaWxkX3Byb2Nlc3NcIikuQ2hpbGRQcm9jZXNzfSBhcmdzLmNoaWxkIC0gUG9vbGVkIGNoaWxkLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vdHlwZXMuanNcIikuQmFja2dyb3VuZEpvYlBheWxvYWQgJiB7aWQ6IHN0cmluZ319IGFyZ3MucGF5bG9hZCAtIEpvYiBwYXlsb2FkIHdob3NlIG92ZXJydW4gaXMgZ3VhcmRlZC5cbiAgICogQHJldHVybnMge1JldHVyblR5cGU8dHlwZW9mIHNldFRpbWVvdXQ+IHwgbnVsbH0gLSBUaGUgYXJtZWQgdGltZXIsIG9yIG51bGwuXG4gICAqL1xuICBfYXJtUG9vbGVkSm9iVGltZW91dCh7Y2hpbGQsIHBheWxvYWR9KSB7XG4gICAgY29uc3QgdGltZW91dE1zID0gdGhpcy5fcmVzb2x2ZUpvYlRpbWVvdXRNcyhwYXlsb2FkLm9wdGlvbnMpXG5cbiAgICBpZiAoISh0eXBlb2YgdGltZW91dE1zID09PSBcIm51bWJlclwiICYmIHRpbWVvdXRNcyA+IDApKSByZXR1cm4gbnVsbFxuXG4gICAgcmV0dXJuIHNldFRpbWVvdXQoKCkgPT4gdGhpcy5fb25Qb29sZWRKb2JUaW1lb3V0KHtjaGlsZCwgam9iSWQ6IHBheWxvYWQuaWR9KSwgdGltZW91dE1zKVxuICB9XG5cbiAgLyoqXG4gICAqIEZpcmVkIHdoZW4gYSBwb29sZWQgam9iIG92ZXJydW5zIGl0cyB0aW1lb3V0LiBUZXJtaW5hdGVzIHRoZSBjaGlsZCBydW5uaW5nIGl0XG4gICAqIChTSUdURVJNLCB0aGVuIFNJR0tJTEwgYWZ0ZXIgdGhlIGdyYWNlKSDigJQgYSBodW5nIEpTIGpvYiBjYW5ub3QgYmUgY2FuY2VsbGVkXG4gICAqIGFueSBvdGhlciB3YXkuIFRoZSBub24tY2xlYW4gZXhpdCBmbG93cyB0aHJvdWdoIGBfaGFuZGxlUG9vbGVkQ2hpbGRGYWlsdXJlYCxcbiAgICogd2hpY2ggcmVwb3J0cyBldmVyeSBpbi1mbGlnaHQgam9iIG9uIHRoZSBjaGlsZCBmYWlsZWQgKHNvIHRoZXkgcmVxdWV1ZSkgYW5kXG4gICAqIGRyb3BzIGl0IGZyb20gdHJhY2tpbmc7IHRoZSBmYWlsdXJlIHBhdGggaW1tZWRpYXRlbHkgcmUtYWR2ZXJ0aXNlcyB0aGVcbiAgICogcmVzdWx0aW5nIGNhcGFjaXR5IG9uY2UgdGhlIHJ1bm5lciBoYXMgY29tcGxldGVkIHN0YXJ0dXAuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gT3B0aW9ucy5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCJub2RlOmNoaWxkX3Byb2Nlc3NcIikuQ2hpbGRQcm9jZXNzfSBhcmdzLmNoaWxkIC0gUG9vbGVkIGNoaWxkLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gYXJncy5qb2JJZCAtIEpvYiBpZCB0aGF0IG92ZXJyYW4uXG4gICAqIEByZXR1cm5zIHt2b2lkfVxuICAgKi9cbiAgX29uUG9vbGVkSm9iVGltZW91dCh7Y2hpbGQsIGpvYklkfSkge1xuICAgIGNvbnN0IHN0YXRlID0gdGhpcy5wb29sZWRDaGlsZFN0YXRlcy5nZXQoY2hpbGQpXG5cbiAgICAvLyBBbHJlYWR5IHNldHRsaW5nL2dvbmUsIG9yIHRoZSBqb2IgZmluaXNoZWQgaW4gdGhlIHJhY2Ugd2l0aCB0aGlzIHRpbWVyLlxuICAgIGlmICghc3RhdGUgfHwgc3RhdGUuc2V0dGxpbmcgfHwgc3RhdGUudGVybWluYXRpb25SZWFzb24gfHwgIXN0YXRlLmluZmxpZ2h0Lmhhcyhqb2JJZCkpIHJldHVyblxuXG4gICAgc3RhdGUudGVybWluYXRpb25SZWFzb24gPSBcImpvYi10aW1lb3V0XCJcbiAgICBzdGF0ZS50aW1lb3V0Sm9iSWQgPSBqb2JJZFxuXG4gICAgdHJ5IHtcbiAgICAgIGNoaWxkLmtpbGwoXCJTSUdURVJNXCIpXG4gICAgfSBjYXRjaCB7XG4gICAgICAvLyBDaGlsZCBhbHJlYWR5IGV4aXRlZDsgbm90aGluZyB0byBkby5cbiAgICB9XG5cbiAgICBzdGF0ZS50aW1lb3V0U2lna2lsbFRpbWVyID0gc2V0VGltZW91dCgoKSA9PiB7XG4gICAgICB0cnkge1xuICAgICAgICBjaGlsZC5raWxsKFwiU0lHS0lMTFwiKVxuICAgICAgfSBjYXRjaCB7XG4gICAgICAgIC8vIENoaWxkIGFscmVhZHkgZXhpdGVkOyBub3RoaW5nIHRvIGRvLlxuICAgICAgfVxuICAgIH0sIHRoaXMuZm9ya2VkQ2hpbGRTaWdraWxsR3JhY2VNcylcbiAgfVxuXG4gIC8qKlxuICAgKiBDcmVhdGVzIGEgcmV1c2FibGUgcG9vbGVkIGNoaWxkLlxuICAgKiBAcmV0dXJucyB7aW1wb3J0KFwibm9kZTpjaGlsZF9wcm9jZXNzXCIpLkNoaWxkUHJvY2Vzc30gLSBOZXcgcG9vbGVkIGNoaWxkLlxuICAgKi9cbiAgX2NyZWF0ZVBvb2xlZENoaWxkKCkge1xuICAgIGNvbnN0IGNvbmZpZ3VyYXRpb24gPSB0aGlzLmNvbmZpZ3VyYXRpb25cbiAgICBpZiAoIWNvbmZpZ3VyYXRpb24pIHRocm93IG5ldyBFcnJvcihcIkJhY2tncm91bmQgam9icyB3b3JrZXIgY29uZmlndXJhdGlvbiBub3QgaW5pdGlhbGl6ZWRcIilcbiAgICBjb25zdCBjaGlsZCA9IGZvcmsoUE9PTEVEX1JVTk5FUl9FTlRSWV9QQVRILCBbXSwge1xuICAgICAgY3dkOiBjb25maWd1cmF0aW9uLmdldERpcmVjdG9yeSgpLCBleGVjQXJndjogW10sIHN0ZGlvOiBbXCJpZ25vcmVcIiwgXCJpZ25vcmVcIiwgXCJpZ25vcmVcIiwgXCJpcGNcIl0sXG4gICAgICBlbnY6IE9iamVjdC5hc3NpZ24oe30sIHByb2Nlc3MuZW52LCB0aGlzLl9jaGlsZEJhY2tncm91bmRKb2JzRW52aXJvbm1lbnQoKSlcbiAgICB9KVxuICAgIHRoaXMucG9vbGVkQ2hpbGRyZW4uYWRkKGNoaWxkKVxuICAgIHRoaXMuaW5mbGlnaHRQcm9jZXNzQ2hpbGRyZW4uYWRkKGNoaWxkKVxuICAgIHRoaXMucG9vbGVkQ2hpbGRTdGF0ZXMuc2V0KGNoaWxkLCB7Y3JlYXRlZEF0TXM6IERhdGUubm93KCksIGpvYnNSdW46IDAsIGluZmxpZ2h0OiBuZXcgTWFwKCksIGxhc3REaXNwYXRjaFNlcTogMCwgcmV0aXJpbmc6IGZhbHNlLCBzdGFydGVkOiBmYWxzZX0pXG4gICAgY2hpbGQub24oXCJtZXNzYWdlXCIsIChtZXNzYWdlKSA9PiB0aGlzLl9oYW5kbGVQb29sZWRDaGlsZE1lc3NhZ2Uoe2NoaWxkLCBtZXNzYWdlfSkpXG4gICAgY2hpbGQub25jZShcImV4aXRcIiwgKGV4aXRDb2RlLCBzaWduYWwpID0+IHRoaXMuX2hhbmRsZVBvb2xlZENoaWxkRmFpbHVyZSh7XG4gICAgICBjaGlsZCxcbiAgICAgIGVycm9yOiBuZXcgRXJyb3IoYFBvb2xlZCBiYWNrZ3JvdW5kIGpvYiBydW5uZXIgZXhpdGVkOiBjb2RlPSR7ZXhpdENvZGV9IHNpZ25hbD0ke3NpZ25hbCB8fCBcIm5vbmVcIn1gKSxcbiAgICAgIGV4aXRDb2RlLFxuICAgICAgb3JpZ2luOiBcImV4aXRcIixcbiAgICAgIHNpZ25hbFxuICAgIH0pKVxuICAgIGNoaWxkLm9uY2UoXCJlcnJvclwiLCAoZXJyb3IpID0+IHRoaXMuX2hhbmRsZVBvb2xlZENoaWxkRmFpbHVyZSh7XG4gICAgICBjaGlsZCxcbiAgICAgIGVycm9yLFxuICAgICAgZXhpdENvZGU6IGNoaWxkLmV4aXRDb2RlLFxuICAgICAgb3JpZ2luOiBcInByb2Nlc3MtZXJyb3JcIixcbiAgICAgIHNpZ25hbDogY2hpbGQuc2lnbmFsQ29kZVxuICAgIH0pKVxuICAgIHJldHVybiBjaGlsZFxuICB9XG5cbiAgLyoqXG4gICAqIEhhbmRsZXMgYSBwb29sZWQgY2hpbGQncyBwZXItam9iIGR1cmFibGUtcmVwb3J0IGFja25vd2xlZGdlbWVudC4gQSBjaGlsZFxuICAgKiBydW5zIGpvYnMgY29uY3VycmVudGx5IGFuZCByZXBvcnRzIG9uZSBgam9iLW91dGNvbWVgIHBlciBqb2IgaWQuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gTWVzc2FnZSBkZXRhaWxzLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIm5vZGU6Y2hpbGRfcHJvY2Vzc1wiKS5DaGlsZFByb2Nlc3N9IGFyZ3MuY2hpbGQgLSBQb29sZWQgY2hpbGQuXG4gICAqIEBwYXJhbSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59IGFyZ3MubWVzc2FnZSAtIElQQyBtZXNzYWdlLlxuICAgKiBAcmV0dXJucyB7dm9pZH1cbiAgICovXG4gIF9oYW5kbGVQb29sZWRDaGlsZE1lc3NhZ2Uoe2NoaWxkLCBtZXNzYWdlfSkge1xuICAgIGlmICghbWVzc2FnZSB8fCB0eXBlb2YgbWVzc2FnZSAhPT0gXCJvYmplY3RcIikgcmV0dXJuXG4gICAgY29uc3QgcmVjb3JkID0gLyoqIEB0eXBlIHt7dHlwZT86IFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+LCBqb2JJZD86IFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+LCBhY2tub3dsZWRnZWQ/OiBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPiwgcnNzQnl0ZXM/OiBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPiwgZXJyb3I/OiBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn19ICovIChtZXNzYWdlKVxuICAgIGNvbnN0IHN0YXRlID0gdGhpcy5wb29sZWRDaGlsZFN0YXRlcy5nZXQoY2hpbGQpXG4gICAgaWYgKHJlY29yZC50eXBlID09PSBcInJlYWR5XCIpIHtcbiAgICAgIGlmIChzdGF0ZSkgc3RhdGUuc3RhcnRlZCA9IHRydWVcbiAgICAgIHJldHVyblxuICAgIH1cbiAgICBpZiAoaXNDaGlsZEFjY2VwdGFuY2VNZXNzYWdlKG1lc3NhZ2UpKSB7XG4gICAgICB0aGlzLl9yZXBvcnRDaGlsZEFjY2VwdGVkKG1lc3NhZ2UpXG4gICAgICByZXR1cm5cbiAgICB9XG4gICAgaWYgKHJlY29yZC50eXBlICE9PSBcImpvYi1vdXRjb21lXCIgfHwgIXN0YXRlIHx8IHN0YXRlLnNldHRsaW5nIHx8IHR5cGVvZiByZWNvcmQuam9iSWQgIT09IFwic3RyaW5nXCIpIHJldHVyblxuICAgIHN0YXRlLnN0YXJ0ZWQgPSB0cnVlXG4gICAgY29uc3QgZW50cnkgPSBzdGF0ZS5pbmZsaWdodC5nZXQocmVjb3JkLmpvYklkKVxuICAgIGlmICghZW50cnkpIHJldHVyblxuXG4gICAgaWYgKGVudHJ5LnRpbWVvdXRUaW1lcikgY2xlYXJUaW1lb3V0KGVudHJ5LnRpbWVvdXRUaW1lcilcbiAgICBzdGF0ZS5pbmZsaWdodC5kZWxldGUocmVjb3JkLmpvYklkKVxuICAgIHN0YXRlLmpvYnNSdW4gKz0gMVxuICAgIGNvbnN0IHJlc29sdmUgPSBlbnRyeS5yZXNvbHZlXG5cbiAgICBpZiAocmVjb3JkLmFja25vd2xlZGdlZCA9PT0gdHJ1ZSkge1xuICAgICAgaWYgKHJlc29sdmUpIHJlc29sdmUodW5kZWZpbmVkKVxuICAgIH0gZWxzZSB7XG4gICAgICAvLyBUaGUgY2hpbGQgc3RheWVkIGFsaXZlIGJ1dCBjb3VsZCBub3QgY29uZmlybSB0aGlzIG9uZSBqb2IncyB0ZXJtaW5hbFxuICAgICAgLy8gcmVwb3J0OyByZWNsYWltIGp1c3QgdGhpcyBqb2Ig4oCUIGl0cyBjb25jdXJyZW50IHNpYmxpbmdzIGFyZSB1bmFmZmVjdGVkLlxuICAgICAgdm9pZCB0aGlzLl9yZXBvcnRKb2JSZXN1bHQoe1xuICAgICAgICBqb2JJZDogZW50cnkucGF5bG9hZC5pZCxcbiAgICAgICAgc3RhdHVzOiBcImZhaWxlZFwiLFxuICAgICAgICBlcnJvcjogbmV3IEVycm9yKHR5cGVvZiByZWNvcmQuZXJyb3IgPT09IFwic3RyaW5nXCIgPyByZWNvcmQuZXJyb3IgOiBcIlBvb2xlZCBydW5uZXIgdGVybWluYWwgcmVwb3J0IHdhcyBub3QgYWNrbm93bGVkZ2VkXCIpLFxuICAgICAgICBoYW5kb2ZmSWQ6IGVudHJ5LnBheWxvYWQuaGFuZG9mZklkLFxuICAgICAgICBoYW5kZWRPZmZBdE1zOiBlbnRyeS5wYXlsb2FkLmhhbmRlZE9mZkF0TXMsXG4gICAgICAgIHdvcmtlcklkOiBlbnRyeS5wYXlsb2FkLndvcmtlcklkIHx8IHRoaXMud29ya2VySWRcbiAgICAgIH0pLmZpbmFsbHkoKCkgPT4geyBpZiAocmVzb2x2ZSkgcmVzb2x2ZSh1bmRlZmluZWQpIH0pXG4gICAgfVxuXG4gICAgY29uc3QgcnNzQnl0ZXMgPSB0eXBlb2YgcmVjb3JkLnJzc0J5dGVzID09PSBcIm51bWJlclwiID8gcmVjb3JkLnJzc0J5dGVzIDogTnVtYmVyLlBPU0lUSVZFX0lORklOSVRZXG4gICAgY29uc3QgcnVubmVyQWdlTXMgPSBEYXRlLm5vdygpIC0gc3RhdGUuY3JlYXRlZEF0TXNcbiAgICBpZiAoIXN0YXRlLnJldGlyaW5nICYmIChzdGF0ZS5qb2JzUnVuID49IHRoaXMucG9vbGVkUnVubmVyTWF4Sm9icyB8fCByc3NCeXRlcyA+PSB0aGlzLnBvb2xlZFJ1bm5lck1heFJzc0J5dGVzIHx8IHJ1bm5lckFnZU1zID49IHRoaXMucG9vbGVkUnVubmVyTWF4TGlmZXRpbWVNcyB8fCB0aGlzLnNob3VsZFN0b3ApKSB7XG4gICAgICB0aGlzLl9iZWdpblJldGlyZVBvb2xlZENoaWxkKGNoaWxkKVxuICAgIH1cbiAgICB0aGlzLl90ZXJtaW5hdGVJZkRyYWluZWQoY2hpbGQpXG4gIH1cblxuICAvKipcbiAgICogRm9yd2FyZHMgb25lIHBvb2xlZCBjaGlsZCdzIGFjY2VwdGFuY2Ugb2JzZXJ2YXRpb24gdG8gbWFpbiBhcyBhIGJvdW5kZWRcbiAgICogZGlhZ25vc3RpYyByZXBvcnQuIFRoZSBjaGlsZCBjYXJyaWVzIGl0cyBleGFjdCBoYW5kb2ZmIGxlYXNlLCBzbyBhIHRpbWVvdXRcbiAgICogb3Igb3V0Y29tZSB0aGF0IGFscmVhZHkgc2V0dGxlZCB0aGUgd29ya2VyJ3MgaW4tZmxpZ2h0IGVudHJ5IGNhbm5vdCBsb3NlXG4gICAqIHRoZSBmZW5jaW5nLiBBIHJlcG9ydCB0aGF0IG5ldmVyIGxhbmRzIGRlZ3JhZGVzIHBoYXNlIGRpYWdub3N0aWNzIGZvciB0aGF0XG4gICAqIGpvYiBvbmx5IOKAlCBpdCBtdXN0IG5ldmVyIGJsb2NrIG9yIGZhaWwgdGhlIGpvYiBpdHNlbGYuXG4gICAqIEBwYXJhbSB7e3R5cGU6IFwiam9iLXJlY2VpdmVkXCIgfCBcImpvYi1zdGFydGVkXCIsIGpvYklkOiBzdHJpbmcsIGhhbmRvZmZJZD86IHN0cmluZywgd29ya2VySWQ/OiBzdHJpbmcsIGhhbmRlZE9mZkF0TXM/OiBudW1iZXIsIHJlY2VpdmVkQXRNcz86IG51bWJlciwgc3RhcnRlZEF0TXM/OiBudW1iZXIsIGNoaWxkSW5zdGFuY2VJZD86IHN0cmluZywgY2hpbGRQaWQ/OiBudW1iZXJ9fSBtZXNzYWdlIC0gVmFsaWRhdGVkIGNoaWxkIGFjY2VwdGFuY2UgbWVzc2FnZS5cbiAgICogQHJldHVybnMge3ZvaWR9XG4gICAqL1xuICBfcmVwb3J0Q2hpbGRBY2NlcHRlZChtZXNzYWdlKSB7XG4gICAgaWYgKCF0aGlzLnN0YXR1c1JlcG9ydGVyKSByZXR1cm5cblxuICAgIHZvaWQgdGhpcy5zdGF0dXNSZXBvcnRlci5yZXBvcnRDaGlsZEFjY2VwdGVkV2l0aFJldHJ5KHtcbiAgICAgIGpvYklkOiBtZXNzYWdlLmpvYklkLFxuICAgICAgaGFuZG9mZklkOiBtZXNzYWdlLmhhbmRvZmZJZCxcbiAgICAgIHdvcmtlcklkOiBtZXNzYWdlLndvcmtlcklkLFxuICAgICAgaGFuZGVkT2ZmQXRNczogbWVzc2FnZS5oYW5kZWRPZmZBdE1zLFxuICAgICAgcmVjZWl2ZWRBdE1zOiBtZXNzYWdlLnJlY2VpdmVkQXRNcyxcbiAgICAgIHN0YXJ0ZWRBdE1zOiBtZXNzYWdlLnN0YXJ0ZWRBdE1zLFxuICAgICAgY2hpbGRJbnN0YW5jZUlkOiBtZXNzYWdlLmNoaWxkSW5zdGFuY2VJZCxcbiAgICAgIGNoaWxkUGlkOiBtZXNzYWdlLmNoaWxkUGlkLFxuICAgICAgbWF4RHVyYXRpb25NczogQ0hJTERfQUNDRVBUQU5DRV9SRVBPUlRfTUFYX0RVUkFUSU9OX01TXG4gICAgfSkuY2F0Y2goKGVycm9yKSA9PiB7XG4gICAgICBjb25zb2xlLmVycm9yKFwiQmFja2dyb3VuZCBqb2IgY2hpbGQtYWNjZXB0YW5jZSByZXBvcnRpbmcgZmFpbGVkOlwiLCBlcnJvcilcbiAgICB9KVxuICB9XG5cbiAgLyoqXG4gICAqIE1hcmtzIGEgcG9vbGVkIGNoaWxkIGZvciByZXRpcmVtZW50IGFuZCBlYWdlcmx5IHNwYXducyBhIHNpbmdsZSByZXBsYWNlbWVudFxuICAgKiAoMS1mb3ItMSkgc28gaXRzIGNhcGFjaXR5IGlzIHJlc3RvcmVkIGltbWVkaWF0ZWx5IHdpdGhvdXQgd2FpdGluZyBmb3IgaXQgdG9cbiAgICogZmluaXNoIGRyYWluaW5nLiBUaGUgcmV0aXJpbmcgY2hpbGQgc3RvcHMgcmVjZWl2aW5nIG5ldyBqb2JzIGFuZCBpc1xuICAgKiB0ZXJtaW5hdGVkIG9ubHkgb25jZSBpdHMgaW4tZmxpZ2h0IHNldCBkcmFpbnMsIHNvIGEgbG9uZy1ydW5uaW5nIGpvYiAoZS5nLiBhXG4gICAqIGJ1aWxkKSBpcyBuZXZlciBjdXQgb2ZmLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIm5vZGU6Y2hpbGRfcHJvY2Vzc1wiKS5DaGlsZFByb2Nlc3N9IGNoaWxkIC0gQ2hpbGQgdG8gcmV0aXJlLlxuICAgKiBAcmV0dXJucyB7dm9pZH1cbiAgICovXG4gIF9iZWdpblJldGlyZVBvb2xlZENoaWxkKGNoaWxkKSB7XG4gICAgY29uc3Qgc3RhdGUgPSB0aGlzLnBvb2xlZENoaWxkU3RhdGVzLmdldChjaGlsZClcbiAgICBpZiAoIXN0YXRlIHx8IHN0YXRlLnJldGlyaW5nKSByZXR1cm5cblxuICAgIHN0YXRlLnJldGlyaW5nID0gdHJ1ZVxuICAgIC8vIEJlc3QtZWZmb3J0IHByZS13YXJtOiBza2lwIHdoZW4gc3RvcHBpbmcgKG5vIG5ldyB3b3JrKSBvciBiZWZvcmUgdGhlXG4gICAgLy8gd29ya2VyIGlzIGluaXRpYWxpemVkIChubyBjb25maWd1cmF0aW9uIHRvIGZvcmsgYSBjaGlsZCBmcm9tKS5cbiAgICBpZiAoIXRoaXMuc2hvdWxkU3RvcCAmJiB0aGlzLmNvbmZpZ3VyYXRpb24pIHRoaXMuX2NyZWF0ZVBvb2xlZENoaWxkKClcbiAgfVxuXG4gIC8qKlxuICAgKiBUZXJtaW5hdGVzIGEgcmV0aXJpbmcgcG9vbGVkIGNoaWxkIG9uY2UgaXQgaGFzIG5vIGluLWZsaWdodCBqb2JzIGxlZnQuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwibm9kZTpjaGlsZF9wcm9jZXNzXCIpLkNoaWxkUHJvY2Vzc30gY2hpbGQgLSBDaGlsZCB0byBjaGVjay5cbiAgICogQHJldHVybnMge3ZvaWR9XG4gICAqL1xuICBfdGVybWluYXRlSWZEcmFpbmVkKGNoaWxkKSB7XG4gICAgY29uc3Qgc3RhdGUgPSB0aGlzLnBvb2xlZENoaWxkU3RhdGVzLmdldChjaGlsZClcbiAgICBpZiAoIXN0YXRlIHx8ICFzdGF0ZS5yZXRpcmluZyB8fCBzdGF0ZS5pbmZsaWdodC5zaXplID4gMCkgcmV0dXJuXG5cbiAgICB0aGlzLl9yZXRpcmVQb29sZWRDaGlsZChjaGlsZClcbiAgfVxuXG4gIC8qKlxuICAgKiBSZXRpcmVzIGEgZHJhaW5lZCBwb29sZWQgY2hpbGQgKHJlbW92ZXMgaXQgZnJvbSB0cmFja2luZywgdGhlbiBTSUdURVJNcyBpdCkuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwibm9kZTpjaGlsZF9wcm9jZXNzXCIpLkNoaWxkUHJvY2Vzc30gY2hpbGQgLSBDaGlsZCBwcm9jZXNzIHRvIHJldGlyZS5cbiAgICogQHJldHVybnMge3ZvaWR9XG4gICAqL1xuICBfcmV0aXJlUG9vbGVkQ2hpbGQoY2hpbGQpIHtcbiAgICB0aGlzLnBvb2xlZENoaWxkcmVuLmRlbGV0ZShjaGlsZClcbiAgICB0aGlzLnBvb2xlZENoaWxkU3RhdGVzLmRlbGV0ZShjaGlsZClcbiAgICB0aGlzLmluZmxpZ2h0UHJvY2Vzc0NoaWxkcmVuLmRlbGV0ZShjaGlsZClcbiAgICBjaGlsZC5raWxsKFwiU0lHVEVSTVwiKVxuICB9XG5cbiAgLyoqXG4gICAqIFJlbW92ZXMgYW4gZXhpdGVkL3VuaGVhbHRoeSBwb29sZWQgY2hpbGQgYW5kIHJlcG9ydHMgZXZlcnkgam9iIHRoYXQgd2FzXG4gICAqIGluLWZsaWdodCBvbiBpdCBhcyBmYWlsZWQg4oCUIGEgcHJvY2Vzcy1sZXZlbCBjcmFzaCdzIGJsYXN0IHJhZGl1cyBpcyB0aGVcbiAgICogY2hpbGQncyB3aG9sZSBpbi1mbGlnaHQgc2V0LiBPbmNlIHRoZSBjaGlsZCBoYXMgY29tcGxldGVkIHN0YXJ0dXAsIGl0c1xuICAgKiBmcmVlZCBjYXBhY2l0eSBpcyBhZHZlcnRpc2VkIGltbWVkaWF0ZWx5OyB0aGUgcmVwbGFjZW1lbnQgaXRzZWxmIGlzIHN0aWxsXG4gICAqIHNwYXduZWQgbGF6aWx5IGJ5IHRoZSBuZXh0IGRpc3BhdGNoLiBBIGNoaWxkIHRoYXQgZXhpdHMgYmVmb3JlIGl0cyBzdGFydHVwXG4gICAqIGhhbmRzaGFrZSBkb2VzIG5vdCByZS1hbm5vdW5jZSwgYXZvaWRpbmcgYSB0aWdodCByZXNwYXduIGxvb3Agb24gc3RhcnR1cFxuICAgKiBmYWlsdXJlLlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIEZhaWx1cmUgZGV0YWlscy5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCJub2RlOmNoaWxkX3Byb2Nlc3NcIikuQ2hpbGRQcm9jZXNzfSBhcmdzLmNoaWxkIC0gUG9vbGVkIGNoaWxkLlxuICAgKiBAcGFyYW0ge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSBhcmdzLmVycm9yIC0gRmFpbHVyZS5cbiAgICogQHBhcmFtIHtudW1iZXIgfCBudWxsfSBbYXJncy5leGl0Q29kZV0gLSBDaGlsZCBleGl0IGNvZGUgd2hlbiBvYnNlcnZlZC5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL3R5cGVzLmpzXCIpLlBvb2xlZFJ1bm5lckZhaWx1cmVPcmlnaW59IFthcmdzLm9yaWdpbl0gLSBXb3JrZXIgb2JzZXJ2YXRpb24gdGhhdCBpbml0aWF0ZWQgcmVjb3ZlcnkuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwibm9kZTpjaGlsZF9wcm9jZXNzXCIpLkNoaWxkUHJvY2Vzc1tcInNpZ25hbENvZGVcIl19IFthcmdzLnNpZ25hbF0gLSBDaGlsZCB0ZXJtaW5hdGlvbiBzaWduYWwgd2hlbiBvYnNlcnZlZC5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59XG4gICAqL1xuICBhc3luYyBfaGFuZGxlUG9vbGVkQ2hpbGRGYWlsdXJlKHtjaGlsZCwgZXJyb3IsIGV4aXRDb2RlID0gbnVsbCwgb3JpZ2luID0gXCJwcm9jZXNzLWVycm9yXCIsIHNpZ25hbCA9IG51bGx9KSB7XG4gICAgY29uc3Qgc3RhdGUgPSB0aGlzLnBvb2xlZENoaWxkU3RhdGVzLmdldChjaGlsZClcbiAgICBpZiAoc3RhdGU/LnNldHRsaW5nKSByZXR1cm5cbiAgICBpZiAoc3RhdGUpIHtcbiAgICAgIHN0YXRlLnNldHRsaW5nID0gdHJ1ZVxuICAgICAgLy8gQ2FuY2VsIHRoaXMgY2hpbGQncyBwZW5kaW5nIHRpbWVycyBiZWZvcmUgaXRzIGluLWZsaWdodCBzZXQgaXMgcmVwb3J0ZWQg4oCUXG4gICAgICAvLyB0aGUgU0lHS0lMTCBncmFjZSBmcm9tIGEgdGltZW91dCBraWxsLCBhbmQgZXZlcnkgYXJtZWQgcGVyLWpvYiBiYWNrc3RvcC5cbiAgICAgIGlmIChzdGF0ZS50aW1lb3V0U2lna2lsbFRpbWVyKSBjbGVhclRpbWVvdXQoc3RhdGUudGltZW91dFNpZ2tpbGxUaW1lcilcbiAgICAgIGZvciAoY29uc3QgaW5mbGlnaHRFbnRyeSBvZiBzdGF0ZS5pbmZsaWdodC52YWx1ZXMoKSkge1xuICAgICAgICBpZiAoaW5mbGlnaHRFbnRyeS50aW1lb3V0VGltZXIpIGNsZWFyVGltZW91dChpbmZsaWdodEVudHJ5LnRpbWVvdXRUaW1lcilcbiAgICAgIH1cbiAgICB9XG4gICAgdGhpcy5wb29sZWRDaGlsZHJlbi5kZWxldGUoY2hpbGQpXG4gICAgdGhpcy5pbmZsaWdodFByb2Nlc3NDaGlsZHJlbi5kZWxldGUoY2hpbGQpXG5cbiAgICBjb25zdCBlbnRyaWVzID0gc3RhdGUgPyBbLi4uc3RhdGUuaW5mbGlnaHQudmFsdWVzKCldIDogW11cbiAgICBjb25zdCBydW5uZXJGYWlsdXJlID0gc3RhdGVcbiAgICAgID8gdGhpcy5fcG9vbGVkUnVubmVyRmFpbHVyZSh7Y2hpbGQsIGV4aXRDb2RlLCBvcmlnaW4sIHNpZ25hbCwgc3RhdGV9KVxuICAgICAgOiB1bmRlZmluZWRcbiAgICBpZiAoc3RhdGUpIHN0YXRlLmluZmxpZ2h0LmNsZWFyKClcbiAgICB0aGlzLnBvb2xlZENoaWxkU3RhdGVzLmRlbGV0ZShjaGlsZClcblxuICAgIGNvbnN0IGZhaWx1cmVSZXBvcnRzID0gZW50cmllcy5tYXAoYXN5bmMgKGVudHJ5KSA9PiB7XG4gICAgICBhd2FpdCB0aGlzLl9yZXBvcnRKb2JSZXN1bHQoe1xuICAgICAgICBqb2JJZDogZW50cnkucGF5bG9hZC5pZCxcbiAgICAgICAgc3RhdHVzOiBcImZhaWxlZFwiLFxuICAgICAgICBlcnJvcixcbiAgICAgICAgaGFuZG9mZklkOiBlbnRyeS5wYXlsb2FkLmhhbmRvZmZJZCxcbiAgICAgICAgaGFuZGVkT2ZmQXRNczogZW50cnkucGF5bG9hZC5oYW5kZWRPZmZBdE1zLFxuICAgICAgICBydW5uZXJGYWlsdXJlLFxuICAgICAgICB3b3JrZXJJZDogZW50cnkucGF5bG9hZC53b3JrZXJJZCB8fCB0aGlzLndvcmtlcklkXG4gICAgICB9KVxuICAgICAgaWYgKGVudHJ5LnJlc29sdmUpIGVudHJ5LnJlc29sdmUodW5kZWZpbmVkKVxuICAgIH0pXG5cbiAgICAvLyBTdGFydCBldmVyeSBmYWxsYmFjayByZXBvcnQgYmVmb3JlIGFubm91bmNpbmcgY2FwYWNpdHkgc28gdGhlIG1haW4gY2Fubm90XG4gICAgLy8gb2JzZXJ2ZSBhIHJlcGxhY2VtZW50IHNsb3QgYmVmb3JlIHRoZSBmYWlsZWQgam9icycgcmVwb3J0cyBhcmUgaW4gZmxpZ2h0LlxuICAgIC8vIFRoZSByZXBvcnQgcHJvbWlzZXMgcmVtYWluIHRyYWNrZWQgYmVsb3c7IGEgc2xvdyByZXRyeSBtdXN0IG5vdCBob2xkIHRoZVxuICAgIC8vIG5ld2x5IGZyZWVkIHJ1bm5lciBjYXBhY2l0eSBob3N0YWdlLlxuICAgIGlmIChzdGF0ZSAmJiBzdGF0ZS5zdGFydGVkICE9PSBmYWxzZSkge1xuICAgICAgdGhpcy5fc2VuZFJlYWR5SWZSdW5uaW5nKClcbiAgICB9IGVsc2UgaWYgKHN0YXRlKSB7XG4gICAgICBmb3IgKGNvbnN0IGVudHJ5IG9mIGVudHJpZXMpIHtcbiAgICAgICAgaWYgKGVudHJ5LnBvb2xlZEpvYikgdGhpcy5fcG9vbGVkU3RhcnR1cEZhaWx1cmVKb2JzLmFkZChlbnRyeS5wb29sZWRKb2IpXG4gICAgICAgIGNvbnN0IHF1ZXVlVHJhY2tlciA9IHRoaXMucG9vbGVkSm9iUXVldWVUcmFja2Vycy5nZXQoZW50cnkucGF5bG9hZC5pZClcbiAgICAgICAgaWYgKHF1ZXVlVHJhY2tlcikgdGhpcy5fcG9vbGVkU3RhcnR1cEZhaWx1cmVKb2JzLmFkZChxdWV1ZVRyYWNrZXIpXG4gICAgICB9XG4gICAgICAvLyBBIHByZXZpb3VzIHJlYWR5IG1lc3NhZ2UgbWF5IHN0aWxsIGhhdmUgdW5jb25zdW1lZCBwb29sZWQgY3JlZGl0cyBhdCB0aGVcbiAgICAgIC8vIG1haW4uIFJldm9rZSB0aGVtIGF1dGhvcml0YXRpdmVseSB3aXRob3V0IHN1cHByZXNzaW5nIHZhbGlkIGlubGluZSBvclxuICAgICAgLy8gcHJvY2Vzcy1ydW5uZXIgcmVhZGluZXNzOyBvdGhlcndpc2UgcXVldWVkIGpvYnMgY2FuIHRyaWdnZXIgYSBzdGFydHVwXG4gICAgICAvLyBjcmFzaCBsb29wIHVzaW5nIHRoZSBzdGFsZSBjcmVkaXRzLlxuICAgICAgdGhpcy5fc2VuZFJlYWR5SWZSdW5uaW5nKHtyZXZva2VQb29sZWRBZG1pc3Npb246IHRydWV9KVxuICAgIH1cblxuICAgIGF3YWl0IFByb21pc2UuYWxsU2V0dGxlZChmYWlsdXJlUmVwb3J0cylcbiAgfVxuXG4gIC8qKlxuICAgKiBDYXB0dXJlcyBvbmUgc3RhYmxlIHByb2Nlc3Mgc25hcHNob3QgYmVmb3JlIHRoZSBmYWlsZWQgY2hpbGQncyBzdGF0ZSBpcyByZW1vdmVkLlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIEZhaWx1cmUgZGV0YWlscy5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCJub2RlOmNoaWxkX3Byb2Nlc3NcIikuQ2hpbGRQcm9jZXNzfSBhcmdzLmNoaWxkIC0gRmFpbGVkIHBvb2xlZCBjaGlsZC5cbiAgICogQHBhcmFtIHtudW1iZXIgfCBudWxsfSBhcmdzLmV4aXRDb2RlIC0gQ2hpbGQgZXhpdCBjb2RlIHdoZW4gb2JzZXJ2ZWQuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi90eXBlcy5qc1wiKS5Qb29sZWRSdW5uZXJGYWlsdXJlT3JpZ2lufSBhcmdzLm9yaWdpbiAtIFdvcmtlciBvYnNlcnZhdGlvbiB0aGF0IGluaXRpYXRlZCByZWNvdmVyeS5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCJub2RlOmNoaWxkX3Byb2Nlc3NcIikuQ2hpbGRQcm9jZXNzW1wic2lnbmFsQ29kZVwiXX0gYXJncy5zaWduYWwgLSBDaGlsZCB0ZXJtaW5hdGlvbiBzaWduYWwgd2hlbiBvYnNlcnZlZC5cbiAgICogQHBhcmFtIHtQb29sZWRDaGlsZFN0YXRlfSBhcmdzLnN0YXRlIC0gQ2hpbGQgc3RhdGUgaW1tZWRpYXRlbHkgYmVmb3JlIHJlY292ZXJ5LlxuICAgKiBAcmV0dXJucyB7aW1wb3J0KFwiLi90eXBlcy5qc1wiKS5Qb29sZWRSdW5uZXJGYWlsdXJlfSAtIFNoYXJlZCBmYWlsdXJlIHByb3ZlbmFuY2UuXG4gICAqL1xuICBfcG9vbGVkUnVubmVyRmFpbHVyZSh7Y2hpbGQsIGV4aXRDb2RlLCBvcmlnaW4sIHNpZ25hbCwgc3RhdGV9KSB7XG4gICAgY29uc3QgdGVybWluYXRpb25SZWFzb24gPSBzdGF0ZS50ZXJtaW5hdGlvblJlYXNvbiA/PyBcInVuZXhwZWN0ZWRcIlxuICAgIGNvbnN0IHdvcmtlckxpZmVjeWNsZSA9IHRoaXMuc2hvdWxkU3RvcCA/IFwic3RvcHBpbmdcIiA6IHRoaXMuaXNSZXRpcmluZyA/IFwicmV0aXJpbmdcIiA6IFwicnVubmluZ1wiXG4gICAgY29uc3QgcnVubmVyTGlmZWN5Y2xlID0gc3RhdGUuc3RhcnRlZCA9PT0gZmFsc2UgPyBcInN0YXJ0aW5nXCIgOiBzdGF0ZS5yZXRpcmluZyA/IFwicmV0aXJpbmdcIiA6IFwicnVubmluZ1wiXG4gICAgY29uc3QgYWN0aXZlSm9icyA9IFsuLi5zdGF0ZS5pbmZsaWdodC52YWx1ZXMoKV1cbiAgICAgIC5tYXAoKGVudHJ5KSA9PiAoe1xuICAgICAgICBoYW5kb2ZmSWQ6IGVudHJ5LnBheWxvYWQuaGFuZG9mZklkID8/IG51bGwsXG4gICAgICAgIGhhbmRlZE9mZkF0TXM6IGVudHJ5LnBheWxvYWQuaGFuZGVkT2ZmQXRNcyA/PyBudWxsLFxuICAgICAgICBqb2JJZDogZW50cnkucGF5bG9hZC5pZCxcbiAgICAgICAgam9iTmFtZTogZW50cnkucGF5bG9hZC5qb2JOYW1lLFxuICAgICAgICB3b3JrZXJJZDogZW50cnkucGF5bG9hZC53b3JrZXJJZCA/PyB0aGlzLndvcmtlcklkXG4gICAgICB9KSlcbiAgICAgIC5zb3J0KChsZWZ0LCByaWdodCkgPT4gbGVmdC5qb2JJZC5sb2NhbGVDb21wYXJlKHJpZ2h0LmpvYklkKSlcblxuICAgIHJldHVybiBPYmplY3QuZnJlZXplKHtcbiAgICAgIGFjdGl2ZUpvYnMsXG4gICAgICBleGl0Q29kZSxcbiAgICAgIGdlbmVyYXRpb25JZDogdGhpcy5nZW5lcmF0aW9uSWQgPz8gbnVsbCxcbiAgICAgIG9vbUtpbGxlZDogc2lnbmFsID09PSBcIlNJR0tJTExcIiAmJiB0ZXJtaW5hdGlvblJlYXNvbiA9PT0gXCJ1bmV4cGVjdGVkXCIgPyBudWxsIDogZmFsc2UsXG4gICAgICBvcmlnaW4sXG4gICAgICBydW5uZXJBZ2VNczogTWF0aC5tYXgoMCwgRGF0ZS5ub3coKSAtIHN0YXRlLmNyZWF0ZWRBdE1zKSxcbiAgICAgIHJ1bm5lckNyZWF0ZWRBdE1zOiBzdGF0ZS5jcmVhdGVkQXRNcyxcbiAgICAgIHJ1bm5lckRldGFjaGVkOiBmYWxzZSxcbiAgICAgIHJ1bm5lckpvYnNSdW46IHN0YXRlLmpvYnNSdW4sXG4gICAgICBydW5uZXJMaWZlY3ljbGUsXG4gICAgICBydW5uZXJQaWQ6IGNoaWxkLnBpZCA/PyBudWxsLFxuICAgICAgc2lnbmFsLFxuICAgICAgdGVybWluYXRpb25SZWFzb24sXG4gICAgICB0aW1lb3V0Sm9iSWQ6IHN0YXRlLnRpbWVvdXRKb2JJZCA/PyBudWxsLFxuICAgICAgd29ya2VySWQ6IHRoaXMud29ya2VySWQsXG4gICAgICB3b3JrZXJMaWZlY3ljbGUsXG4gICAgICB3b3JrZXJQaWQ6IHByb2Nlc3MucGlkXG4gICAgfSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHJ1biBqb2IgaW5saW5lLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vdHlwZXMuanNcIikuQmFja2dyb3VuZEpvYlBheWxvYWR9IHBheWxvYWQgLSBQYXlsb2FkLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyB3aGVuIGRvbmUuXG4gICAqL1xuICBhc3luYyBfcnVuSm9iSW5saW5lKHBheWxvYWQpIHtcbiAgICBjb25zdCBjb25maWd1cmF0aW9uID0gdGhpcy5jb25maWd1cmF0aW9uXG4gICAgaWYgKCFjb25maWd1cmF0aW9uKSB0aHJvdyBuZXcgRXJyb3IoXCJCYWNrZ3JvdW5kIGpvYnMgd29ya2VyIGNvbmZpZ3VyYXRpb24gbm90IGluaXRpYWxpemVkXCIpXG5cbiAgICBjb25zdCByZWdpc3RyeSA9IG5ldyBCYWNrZ3JvdW5kSm9iUmVnaXN0cnkoe2NvbmZpZ3VyYXRpb259KVxuICAgIGF3YWl0IHJlZ2lzdHJ5LmxvYWQoKVxuICAgIGNvbnN0IEpvYkNsYXNzID0gcmVnaXN0cnkuZ2V0Sm9iQnlOYW1lKHBheWxvYWQuam9iTmFtZSlcbiAgICBhd2FpdCBydW5XaXRoQmFja2dyb3VuZEpvYlBheWxvYWQocGF5bG9hZCwgYXN5bmMgKCkgPT4ge1xuICAgICAgYXdhaXQgcGVyZm9ybUJhY2tncm91bmRKb2Ioe1xuICAgICAgICBjb25maWd1cmF0aW9uLFxuICAgICAgICBKb2JDbGFzcyxcbiAgICAgICAgam9iQXJnczogcGF5bG9hZC5hcmdzIHx8IFtdLFxuICAgICAgICBqb2JPcHRpb25zOiBwYXlsb2FkLm9wdGlvbnMgfHwge30sXG4gICAgICAgIG5hbWU6IGBCYWNrZ3JvdW5kIGpvYiB3b3JrZXIgaW5saW5lOiAke3BheWxvYWQuam9iTmFtZX1gLFxuICAgICAgICBwYXlsb2FkXG4gICAgICB9KVxuICAgIH0pXG4gIH1cblxuICAvKipcbiAgICogUnVucyBmb3JrIGpvYi5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL3R5cGVzLmpzXCIpLkJhY2tncm91bmRKb2JQYXlsb2FkICYge2lkOiBzdHJpbmd9fSBwYXlsb2FkIC0gUGF5bG9hZC5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgd2hlbiB0aGUgZm9ya2VkIHJ1bm5lciBleGl0cyBvciBmb3JrIGZhaWxzLlxuICAgKi9cbiAgX2ZvcmtKb2IocGF5bG9hZCkge1xuICAgIGNvbnN0IGNoaWxkID0gdGhpcy5fY3JlYXRlRm9ya2VkQ2hpbGQoKVxuXG4gICAgdGhpcy5pbmZsaWdodFByb2Nlc3NDaGlsZHJlbi5hZGQoY2hpbGQpXG5cbiAgICBjb25zdCBmaW5pc2hlZCA9IHRoaXMuX3dhaXRGb3JGb3JrZWRDaGlsZCh7Y2hpbGQsIHBheWxvYWR9KVxuXG4gICAgdGhpcy5fc2VuZEZvcmtlZFBheWxvYWQoe2NoaWxkLCBwYXlsb2FkfSlcblxuICAgIHJldHVybiBmaW5pc2hlZFxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgY3JlYXRlIGZvcmtlZCBjaGlsZC5cbiAgICogQHJldHVybnMge2ltcG9ydChcIm5vZGU6Y2hpbGRfcHJvY2Vzc1wiKS5DaGlsZFByb2Nlc3N9IC0gRm9ya2VkIGNoaWxkIHByb2Nlc3MuXG4gICAqL1xuICBfY3JlYXRlRm9ya2VkQ2hpbGQoKSB7XG4gICAgY29uc3QgY29uZmlndXJhdGlvbiA9IHRoaXMuY29uZmlndXJhdGlvblxuICAgIGlmICghY29uZmlndXJhdGlvbikgdGhyb3cgbmV3IEVycm9yKFwiQmFja2dyb3VuZCBqb2JzIHdvcmtlciBjb25maWd1cmF0aW9uIG5vdCBpbml0aWFsaXplZFwiKVxuXG4gICAgY29uc3QgZGlyZWN0b3J5ID0gY29uZmlndXJhdGlvbi5nZXREaXJlY3RvcnkoKVxuICAgIHJldHVybiBmb3JrKEZPUktFRF9SVU5ORVJfRU5UUllfUEFUSCwgW10sIHtcbiAgICAgIGN3ZDogZGlyZWN0b3J5LFxuICAgICAgZXhlY0FyZ3Y6IFtdLFxuICAgICAgc3RkaW86IFtcImlnbm9yZVwiLCBcImlnbm9yZVwiLCBcImlnbm9yZVwiLCBcImlwY1wiXSxcbiAgICAgIGVudjogT2JqZWN0LmFzc2lnbih7fSwgcHJvY2Vzcy5lbnYsIHRoaXMuX2NoaWxkQmFja2dyb3VuZEpvYnNFbnZpcm9ubWVudCgpKVxuICAgIH0pXG4gIH1cblxuICAvKipcbiAgICogUnVucyB3YWl0IGZvciBmb3JrZWQgY2hpbGQuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gT3B0aW9ucy5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCJub2RlOmNoaWxkX3Byb2Nlc3NcIikuQ2hpbGRQcm9jZXNzfSBhcmdzLmNoaWxkIC0gRm9ya2VkIGNoaWxkIHByb2Nlc3MuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi90eXBlcy5qc1wiKS5CYWNrZ3JvdW5kSm9iUGF5bG9hZCAmIHtpZDogc3RyaW5nfX0gYXJncy5wYXlsb2FkIC0gUGF5bG9hZC5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgd2hlbiB0aGUgY2hpbGQgZXhpdHMuXG4gICAqL1xuICBfd2FpdEZvckZvcmtlZENoaWxkKHtjaGlsZCwgcGF5bG9hZH0pIHtcbiAgICBjb25zdCB0aW1lb3V0U3RhdGUgPSB0aGlzLl9hcm1Gb3JrZWRKb2JUaW1lb3V0KHtjaGlsZCwgcGF5bG9hZH0pXG5cbiAgICByZXR1cm4gbmV3IFByb21pc2UoKHJlc29sdmUpID0+IHtcbiAgICAgIGNoaWxkLm9uY2UoXCJleGl0XCIsIChjb2RlLCBzaWduYWwpID0+IHtcbiAgICAgICAgdGhpcy5fY2xlYXJGb3JrZWRKb2JUaW1lb3V0KHRpbWVvdXRTdGF0ZSlcbiAgICAgICAgdGhpcy5faGFuZGxlRm9ya2VkQ2hpbGRFeGl0KHtjaGlsZCwgY29kZSwgc2lnbmFsLCBwYXlsb2FkLCByZXNvbHZlLCB0aW1lb3V0U3RhdGV9KVxuICAgICAgfSlcbiAgICAgIGNoaWxkLm9uY2UoXCJlcnJvclwiLCAoZXJyb3IpID0+IHtcbiAgICAgICAgdGhpcy5fY2xlYXJGb3JrZWRKb2JUaW1lb3V0KHRpbWVvdXRTdGF0ZSlcbiAgICAgICAgdGhpcy5faGFuZGxlRm9ya2VkQ2hpbGRFcnJvcih7Y2hpbGQsIGVycm9yLCBwYXlsb2FkLCByZXNvbHZlfSlcbiAgICAgIH0pXG4gICAgfSlcbiAgfVxuXG4gIC8qKlxuICAgKiBBcm1zIGEgd2FsbC1jbG9jayBiYWNrc3RvcCBmb3IgYSBmb3JrZWQgam9iIHJ1bm5lci4gQSBmb3JrZWQgam9iIHN0aWxsXG4gICAqIHJ1bm5pbmcgYWZ0ZXIgYGpvYlRpbWVvdXRNc2AgaXMgdGVybWluYXRlZCAoU0lHVEVSTSwgdGhlbiBTSUdLSUxMIGFmdGVyIHRoZVxuICAgKiBncmFjZSkgc28gYSBzaW5nbGUgZ2VudWluZWx5LWh1bmcgcnVubmVyIGNhbid0IHBpbiBhIGRyYWluaW5nIHdvcmtlciDigJQgYW5kXG4gICAqIGl0cyBmdWxsLWFwcCBib290IGFuZCBkYXRhYmFzZSBjb25uZWN0aW9ucyDigJQgaW5kZWZpbml0ZWx5LiBSZXR1cm5zIGEgc3RhdGVcbiAgICogb2JqZWN0IHRoZSBleGl0L2Vycm9yIGhhbmRsZXJzIHVzZSB0byBjYW5jZWwgdGhlIHRpbWVyIGFuZCB0byByZXBvcnQgYVxuICAgKiB0aW1lb3V0LXNwZWNpZmljIGZhaWx1cmUuIFdoZW4gbm8gdGltZW91dCBpcyBjb25maWd1cmVkIHRoZSB0aW1lciBpcyBudWxsXG4gICAqIGFuZCBiZWhhdmlvciBpcyB1bmNoYW5nZWQuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gT3B0aW9ucy5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCJub2RlOmNoaWxkX3Byb2Nlc3NcIikuQ2hpbGRQcm9jZXNzfSBhcmdzLmNoaWxkIC0gRm9ya2VkIGNoaWxkIHByb2Nlc3MuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi90eXBlcy5qc1wiKS5CYWNrZ3JvdW5kSm9iUGF5bG9hZCAmIHtpZDogc3RyaW5nfX0gYXJncy5wYXlsb2FkIC0gSm9iIHBheWxvYWQuXG4gICAqIEByZXR1cm5zIHtGb3JrZWRKb2JUaW1lb3V0U3RhdGV9IC0gVGltZW91dCBzdGF0ZS5cbiAgICovXG4gIF9hcm1Gb3JrZWRKb2JUaW1lb3V0KHtjaGlsZCwgcGF5bG9hZH0pIHtcbiAgICBjb25zdCB0aW1lb3V0TXMgPSB0aGlzLl9yZXNvbHZlSm9iVGltZW91dE1zKHBheWxvYWQub3B0aW9ucylcbiAgICAvKiogQHR5cGUge0ZvcmtlZEpvYlRpbWVvdXRTdGF0ZX0gKi9cbiAgICBjb25zdCBzdGF0ZSA9IHt0aW1lZE91dDogZmFsc2UsIHRpbWVvdXRNcywgdGltZXI6IG51bGwsIHNpZ2tpbGxUaW1lcjogbnVsbH1cblxuICAgIGlmICghKHR5cGVvZiB0aW1lb3V0TXMgPT09IFwibnVtYmVyXCIgJiYgdGltZW91dE1zID4gMCkpIHJldHVybiBzdGF0ZVxuXG4gICAgc3RhdGUudGltZXIgPSBzZXRUaW1lb3V0KCgpID0+IHRoaXMuX29uRm9ya2VkSm9iVGltZW91dCh7Y2hpbGQsIHN0YXRlfSksIHRpbWVvdXRNcylcblxuICAgIHJldHVybiBzdGF0ZVxuICB9XG5cbiAgLyoqXG4gICAqIFJlc29sdmVzIHRoZSBlZmZlY3RpdmUgd2FsbC1jbG9jayBqb2IgdGltZW91dCBpbiBtcyAoc2hhcmVkIGJ5IGZvcmtlZCBhbmQgcG9vbGVkIGpvYnMpLCBvciBudWxsIHdoZW4gZGlzYWJsZWQuIFRoZVxuICAgKiBwZXItam9iIG92ZXJyaWRlIHdpbnMsIGZvbGxvd2VkIGJ5IHRoZSBjb25zdHJ1Y3RvciBvdmVycmlkZSwgdGhlbiB0aGUgdmFsdWVcbiAgICogZnJvbSB0aGUgYmFja2dyb3VuZC1qb2JzIGNvbmZpZ3VyYXRpb24uIEEgbm9uLXBvc2l0aXZlIHZhbHVlIGRpc2FibGVzIHRoZVxuICAgKiBiYWNrc3RvcCBhdCB3aGljaGV2ZXIgbGV2ZWwgc3VwcGxpZWQgaXQuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi90eXBlcy5qc1wiKS5CYWNrZ3JvdW5kSm9iT3B0aW9uc30gW2pvYk9wdGlvbnNdIC0gUGVyLWpvYiBvcHRpb25zLlxuICAgKiBAcmV0dXJucyB7bnVtYmVyIHwgbnVsbH0gLSBUaW1lb3V0IGluIG1zLCBvciBudWxsIHdoZW4gZGlzYWJsZWQuXG4gICAqL1xuICBfcmVzb2x2ZUpvYlRpbWVvdXRNcyhqb2JPcHRpb25zKSB7XG4gICAgY29uc3QgcmF3ID0gdHlwZW9mIGpvYk9wdGlvbnM/LnRpbWVvdXRNcyA9PT0gXCJudW1iZXJcIlxuICAgICAgPyBqb2JPcHRpb25zLnRpbWVvdXRNc1xuICAgICAgOiAodHlwZW9mIHRoaXMuam9iVGltZW91dE1zT3ZlcnJpZGUgPT09IFwibnVtYmVyXCJcbiAgICAgICAgICA/IHRoaXMuam9iVGltZW91dE1zT3ZlcnJpZGVcbiAgICAgICAgICA6ICh0aGlzLmNvbmZpZ3VyYXRpb24gPyB0aGlzLmNvbmZpZ3VyYXRpb24uZ2V0QmFja2dyb3VuZEpvYnNDb25maWcoKS5qb2JUaW1lb3V0TXMgOiBudWxsKSlcblxuICAgIC8vIEEgbm9uLWZpbml0ZSAoZS5nLiBJbmZpbml0eSkgb3Igbm9uLXBvc2l0aXZlIHZhbHVlIGRpc2FibGVzIHRoZSBiYWNrc3RvcDtcbiAgICAvLyBhIGZpbml0ZSB2YWx1ZSBiZXlvbmQgTm9kZSdzIHRpbWVyIHJhbmdlIGlzIGNsYW1wZWQgdG8gdGhlIG1heCByYXRoZXIgdGhhblxuICAgIC8vIHNpbGVudGx5IGNvZXJjZWQgdG8gfjFtcyAod2hpY2ggd291bGQga2lsbCBldmVyeSBmb3JrZWQgam9iIGltbWVkaWF0ZWx5KS5cbiAgICBpZiAodHlwZW9mIHJhdyAhPT0gXCJudW1iZXJcIiB8fCAhTnVtYmVyLmlzRmluaXRlKHJhdykgfHwgcmF3IDw9IDApIHJldHVybiBudWxsXG5cbiAgICByZXR1cm4gTWF0aC5taW4ocmF3LCBNQVhfRk9SS0VEX0pPQl9USU1FT1VUX01TKVxuICB9XG5cbiAgLyoqXG4gICAqIEZpcmVkIHdoZW4gYSBmb3JrZWQgcnVubmVyIG92ZXJydW5zIGl0cyB0aW1lb3V0LiBTZW5kcyBTSUdURVJNIGZvciBhIGNsZWFuXG4gICAqIHNodXRkb3duLCB0aGVuIFNJR0tJTEwgYWZ0ZXIgdGhlIGdyYWNlIGZvciBhIHJ1bm5lciB0aGF0IGlnbm9yZXMgaXQuIFRoZVxuICAgKiByZXN1bHRpbmcgbm9uLWNsZWFuIGV4aXQgZmxvd3MgdGhyb3VnaCBgX2hhbmRsZUZvcmtlZENoaWxkRXhpdGAsIHdoaWNoIGZyZWVzXG4gICAqIHRoZSBzbG90IGFuZCByZXBvcnRzIHRoZSBqb2IgZmFpbGVkLlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIE9wdGlvbnMuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwibm9kZTpjaGlsZF9wcm9jZXNzXCIpLkNoaWxkUHJvY2Vzc30gYXJncy5jaGlsZCAtIEZvcmtlZCBjaGlsZCBwcm9jZXNzLlxuICAgKiBAcGFyYW0ge0ZvcmtlZEpvYlRpbWVvdXRTdGF0ZX0gYXJncy5zdGF0ZSAtIFRpbWVvdXQgc3RhdGUuXG4gICAqIEByZXR1cm5zIHt2b2lkfVxuICAgKi9cbiAgX29uRm9ya2VkSm9iVGltZW91dCh7Y2hpbGQsIHN0YXRlfSkge1xuICAgIHN0YXRlLnRpbWVkT3V0ID0gdHJ1ZVxuXG4gICAgdHJ5IHtcbiAgICAgIGNoaWxkLmtpbGwoXCJTSUdURVJNXCIpXG4gICAgfSBjYXRjaCB7XG4gICAgICAvLyBDaGlsZCBhbHJlYWR5IGV4aXRlZDsgbm90aGluZyB0byBkby5cbiAgICB9XG5cbiAgICBzdGF0ZS5zaWdraWxsVGltZXIgPSBzZXRUaW1lb3V0KCgpID0+IHtcbiAgICAgIHRyeSB7XG4gICAgICAgIGNoaWxkLmtpbGwoXCJTSUdLSUxMXCIpXG4gICAgICB9IGNhdGNoIHtcbiAgICAgICAgLy8gQ2hpbGQgYWxyZWFkeSBleGl0ZWQ7IG5vdGhpbmcgdG8gZG8uXG4gICAgICB9XG4gICAgfSwgdGhpcy5mb3JrZWRDaGlsZFNpZ2tpbGxHcmFjZU1zKVxuICB9XG5cbiAgLyoqXG4gICAqIENhbmNlbHMgYW55IHBlbmRpbmcgdGltZW91dC9TSUdLSUxMIHRpbWVycyBmb3IgYSBmb3JrZWQgcnVubmVyIHRoYXQgaGFzXG4gICAqIGV4aXRlZCAob3IgZXJyb3JlZCkgc28gdGhleSBuZXZlciBmaXJlIGFnYWluc3QgYSBnb25lIG9yIHJldXNlZCBjaGlsZC5cbiAgICogQHBhcmFtIHtGb3JrZWRKb2JUaW1lb3V0U3RhdGV9IHN0YXRlIC0gVGltZW91dCBzdGF0ZS5cbiAgICogQHJldHVybnMge3ZvaWR9XG4gICAqL1xuICBfY2xlYXJGb3JrZWRKb2JUaW1lb3V0KHN0YXRlKSB7XG4gICAgaWYgKHN0YXRlLnRpbWVyKSB7XG4gICAgICBjbGVhclRpbWVvdXQoc3RhdGUudGltZXIpXG4gICAgICBzdGF0ZS50aW1lciA9IG51bGxcbiAgICB9XG5cbiAgICBpZiAoc3RhdGUuc2lna2lsbFRpbWVyKSB7XG4gICAgICBjbGVhclRpbWVvdXQoc3RhdGUuc2lna2lsbFRpbWVyKVxuICAgICAgc3RhdGUuc2lna2lsbFRpbWVyID0gbnVsbFxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGhhbmRsZSBmb3JrZWQgY2hpbGQgZXhpdC5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBPcHRpb25zLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIm5vZGU6Y2hpbGRfcHJvY2Vzc1wiKS5DaGlsZFByb2Nlc3N9IGFyZ3MuY2hpbGQgLSBGb3JrZWQgY2hpbGQgcHJvY2Vzcy5cbiAgICogQHBhcmFtIHtudW1iZXIgfCBudWxsfSBhcmdzLmNvZGUgLSBFeGl0IGNvZGUuXG4gICAqIEBwYXJhbSB7a2V5b2YgdHlwZW9mIGltcG9ydChcIm5vZGU6b3NcIikuY29uc3RhbnRzLnNpZ25hbHMgfCBudWxsfSBhcmdzLnNpZ25hbCAtIEV4aXQgc2lnbmFsLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vdHlwZXMuanNcIikuQmFja2dyb3VuZEpvYlBheWxvYWQgJiB7aWQ6IHN0cmluZ319IGFyZ3MucGF5bG9hZCAtIFBheWxvYWQuXG4gICAqIEBwYXJhbSB7KHZhbHVlOiB2b2lkKSA9PiB2b2lkfSBhcmdzLnJlc29sdmUgLSBQcm9taXNlIHJlc29sdmVyLlxuICAgKiBAcGFyYW0ge0ZvcmtlZEpvYlRpbWVvdXRTdGF0ZX0gW2FyZ3MudGltZW91dFN0YXRlXSAtIFRpbWVvdXQgc3RhdGUsIHdoZW4gdGhlIHJ1bm5lciBoYWQgYSB3YWxsLWNsb2NrIGJhY2tzdG9wLlxuICAgKiBAcmV0dXJucyB7dm9pZH1cbiAgICovXG4gIF9oYW5kbGVGb3JrZWRDaGlsZEV4aXQoe2NoaWxkLCBjb2RlLCBzaWduYWwsIHBheWxvYWQsIHJlc29sdmUsIHRpbWVvdXRTdGF0ZX0pIHtcbiAgICB0aGlzLmluZmxpZ2h0UHJvY2Vzc0NoaWxkcmVuLmRlbGV0ZShjaGlsZClcblxuICAgIC8vIEZyZWUgdGhlIHdvcmtlciBzbG90IGFzIHNvb24gYXMgdGhlIGNoaWxkIGlzIGdvbmUg4oCUIG5ldmVyIGdhdGUgaXQgb24gdGhlXG4gICAgLy8gZmFpbHVyZSByZXBvcnQuIEEgaHVuZy9zbG93IHJlcG9ydCBtdXN0IG5vdCBsZWFrIHRoZSBzbG90OyBlbm91Z2ggbGVha2VkXG4gICAgLy8gc2xvdHMgZHJpdmUgYGFjY2VwdHNGb3JrZWRgIHRvIGZhbHNlIGFuZCBzaWxlbnRseSB3ZWRnZSB0aGUgd29ya2VyLlxuICAgIHJlc29sdmUodW5kZWZpbmVkKVxuXG4gICAgaWYgKHRoaXMuX2ZvcmtlZENoaWxkRXhpdGVkQ2xlYW5seSh7Y29kZSwgc2lnbmFsfSkpIHJldHVyblxuXG4gICAgY29uc3QgZXJyb3IgPSB0aW1lb3V0U3RhdGU/LnRpbWVkT3V0XG4gICAgICA/IG5ldyBFcnJvcihgRm9ya2VkIGJhY2tncm91bmQgam9iIHJ1bm5lciB0aW1lZCBvdXQgYWZ0ZXIgJHt0aW1lb3V0U3RhdGUudGltZW91dE1zfW1zIGFuZCB3YXMgdGVybWluYXRlZDogY29kZT0ke2NvZGV9IHNpZ25hbD0ke3NpZ25hbCB8fCBcIm5vbmVcIn1gKVxuICAgICAgOiBuZXcgRXJyb3IoYEZvcmtlZCBiYWNrZ3JvdW5kIGpvYiBydW5uZXIgZXhpdGVkIGJlZm9yZSByZXBvcnRpbmc6IGNvZGU9JHtjb2RlfSBzaWduYWw9JHtzaWduYWwgfHwgXCJub25lXCJ9YClcblxuICAgIHRoaXMuX3JlcG9ydEZvcmtlZENoaWxkRmFpbHVyZSh7cGF5bG9hZCwgZXJyb3J9KVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZm9ya2VkIGNoaWxkIGV4aXRlZCBjbGVhbmx5LlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIE9wdGlvbnMuXG4gICAqIEBwYXJhbSB7bnVtYmVyIHwgbnVsbH0gYXJncy5jb2RlIC0gRXhpdCBjb2RlLlxuICAgKiBAcGFyYW0ge2tleW9mIHR5cGVvZiBpbXBvcnQoXCJub2RlOm9zXCIpLmNvbnN0YW50cy5zaWduYWxzIHwgbnVsbH0gYXJncy5zaWduYWwgLSBFeGl0IHNpZ25hbC5cbiAgICogQHJldHVybnMge2Jvb2xlYW59IC0gV2hldGhlciB0aGUgY2hpbGQgZXhpdGVkIGNsZWFubHkuXG4gICAqL1xuICBfZm9ya2VkQ2hpbGRFeGl0ZWRDbGVhbmx5KHtjb2RlLCBzaWduYWx9KSB7XG4gICAgcmV0dXJuIGNvZGUgPT09IDAgJiYgIXNpZ25hbFxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgaGFuZGxlIGZvcmtlZCBjaGlsZCBlcnJvci5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBPcHRpb25zLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIm5vZGU6Y2hpbGRfcHJvY2Vzc1wiKS5DaGlsZFByb2Nlc3N9IGFyZ3MuY2hpbGQgLSBGb3JrZWQgY2hpbGQgcHJvY2Vzcy5cbiAgICogQHBhcmFtIHtFcnJvcn0gYXJncy5lcnJvciAtIENoaWxkIHByb2Nlc3MgZXJyb3IuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi90eXBlcy5qc1wiKS5CYWNrZ3JvdW5kSm9iUGF5bG9hZCAmIHtpZDogc3RyaW5nfX0gYXJncy5wYXlsb2FkIC0gUGF5bG9hZC5cbiAgICogQHBhcmFtIHsodmFsdWU6IHZvaWQpID0+IHZvaWR9IGFyZ3MucmVzb2x2ZSAtIFByb21pc2UgcmVzb2x2ZXIuXG4gICAqIEByZXR1cm5zIHt2b2lkfVxuICAgKi9cbiAgX2hhbmRsZUZvcmtlZENoaWxkRXJyb3Ioe2NoaWxkLCBlcnJvciwgcGF5bG9hZCwgcmVzb2x2ZX0pIHtcbiAgICB0aGlzLmluZmxpZ2h0UHJvY2Vzc0NoaWxkcmVuLmRlbGV0ZShjaGlsZClcbiAgICAvLyBGcmVlIHRoZSBzbG90IGZpcnN0IChzZWUgX2hhbmRsZUZvcmtlZENoaWxkRXhpdCkg4oCUIHJlcG9ydGluZyBpcyBiZXN0LWVmZm9ydC5cbiAgICByZXNvbHZlKHVuZGVmaW5lZClcbiAgICBjb25zb2xlLmVycm9yKFwiQmFja2dyb3VuZCBqb2JzIGZvcmtlZCBydW5uZXIgZXJyb3I6XCIsIGVycm9yKVxuICAgIHRoaXMuX3JlcG9ydEZvcmtlZENoaWxkRmFpbHVyZSh7cGF5bG9hZCwgZXJyb3J9KVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgc2VuZCBmb3JrZWQgcGF5bG9hZC5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBPcHRpb25zLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIm5vZGU6Y2hpbGRfcHJvY2Vzc1wiKS5DaGlsZFByb2Nlc3N9IGFyZ3MuY2hpbGQgLSBGb3JrZWQgY2hpbGQgcHJvY2Vzcy5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL3R5cGVzLmpzXCIpLkJhY2tncm91bmRKb2JQYXlsb2FkICYge2lkOiBzdHJpbmd9fSBhcmdzLnBheWxvYWQgLSBQYXlsb2FkLlxuICAgKiBAcmV0dXJucyB7dm9pZH1cbiAgICovXG4gIF9zZW5kRm9ya2VkUGF5bG9hZCh7Y2hpbGQsIHBheWxvYWR9KSB7XG4gICAgdHJ5IHtcbiAgICAgIGNoaWxkLnNlbmQoe3R5cGU6IFwiam9iXCIsIHBheWxvYWR9KVxuICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICBjaGlsZC5raWxsKFwiU0lHVEVSTVwiKVxuICAgICAgdGhpcy5fcmVwb3J0Rm9ya2VkQ2hpbGRGYWlsdXJlKHtwYXlsb2FkLCBlcnJvcn0pXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgcmVwb3J0IGZvcmtlZCBjaGlsZCBmYWlsdXJlLlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIE9wdGlvbnMuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi90eXBlcy5qc1wiKS5CYWNrZ3JvdW5kSm9iUGF5bG9hZCAmIHtpZDogc3RyaW5nfX0gYXJncy5wYXlsb2FkIC0gUGF5bG9hZC5cbiAgICogQHBhcmFtIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gYXJncy5lcnJvciAtIEVycm9yLlxuICAgKiBAcmV0dXJucyB7dm9pZH1cbiAgICovXG4gIF9yZXBvcnRGb3JrZWRDaGlsZEZhaWx1cmUoe3BheWxvYWQsIGVycm9yfSkge1xuICAgIHRoaXMuX3JlcG9ydEpvYlJlc3VsdEluQmFja2dyb3VuZCh7XG4gICAgICBqb2JJZDogcGF5bG9hZC5pZCxcbiAgICAgIHN0YXR1czogXCJmYWlsZWRcIixcbiAgICAgIGVycm9yLFxuICAgICAgaGFuZG9mZklkOiBwYXlsb2FkLmhhbmRvZmZJZCxcbiAgICAgIGhhbmRlZE9mZkF0TXM6IHBheWxvYWQuaGFuZGVkT2ZmQXRNcyxcbiAgICAgIHdvcmtlcklkOiBwYXlsb2FkLndvcmtlcklkIHx8IHRoaXMud29ya2VySWRcbiAgICB9KVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgc3Bhd24gam9iLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vdHlwZXMuanNcIikuQmFja2dyb3VuZEpvYlBheWxvYWR9IHBheWxvYWQgLSBQYXlsb2FkLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyB3aGVuIHRoZSBzcGF3bmVkIHJ1bm5lciBleGl0cyBvciBzcGF3biBmYWlscy5cbiAgICovXG4gIF9zcGF3bkpvYihwYXlsb2FkKSB7XG4gICAgY29uc3QgY29uZmlndXJhdGlvbiA9IHRoaXMuY29uZmlndXJhdGlvblxuICAgIGlmICghY29uZmlndXJhdGlvbikgdGhyb3cgbmV3IEVycm9yKFwiQmFja2dyb3VuZCBqb2JzIHdvcmtlciBjb25maWd1cmF0aW9uIG5vdCBpbml0aWFsaXplZFwiKVxuXG4gICAgY29uc3QgZGlyZWN0b3J5ID0gY29uZmlndXJhdGlvbi5nZXREaXJlY3RvcnkoKVxuICAgIGNvbnN0IGFyZ3ZDb21tYW5kID0gcHJvY2Vzcy5hcmd2WzFdXG4gICAgY29uc3QgY29tbWFuZCA9IGFyZ3ZDb21tYW5kID8gYXJndkNvbW1hbmQgOiBgJHtkaXJlY3Rvcnl9L2Jpbi92ZWxvY2lvdXMuanNgXG4gICAgY29uc3QgZW5jb2RlZFBheWxvYWQgPSBCdWZmZXIuZnJvbShKU09OLnN0cmluZ2lmeShwYXlsb2FkKSkudG9TdHJpbmcoXCJiYXNlNjRcIilcbiAgICBjb25zdCBjaGlsZCA9IHNwYXduKHByb2Nlc3MuZXhlY1BhdGgsIFtjb21tYW5kLCBcImJhY2tncm91bmQtam9icy1ydW5uZXJcIl0sIHtcbiAgICAgIGN3ZDogZGlyZWN0b3J5LFxuICAgICAgZGV0YWNoZWQ6IHRydWUsXG4gICAgICBzdGRpbzogXCJpZ25vcmVcIixcbiAgICAgIGVudjogT2JqZWN0LmFzc2lnbih7fSwgcHJvY2Vzcy5lbnYsIHRoaXMuX2NoaWxkQmFja2dyb3VuZEpvYnNFbnZpcm9ubWVudCgpLCB7VkVMT0NJT1VTX0pPQl9QQVlMT0FEOiBlbmNvZGVkUGF5bG9hZH0pXG4gICAgfSlcblxuICAgIHRoaXMuaW5mbGlnaHRQcm9jZXNzQ2hpbGRyZW4uYWRkKGNoaWxkKVxuXG4gICAgY29uc3QgZmluaXNoZWQgPSBuZXcgUHJvbWlzZSgocmVzb2x2ZSkgPT4ge1xuICAgICAgY2hpbGQub25jZShcImV4aXRcIiwgKCkgPT4ge1xuICAgICAgICB0aGlzLmluZmxpZ2h0UHJvY2Vzc0NoaWxkcmVuLmRlbGV0ZShjaGlsZClcbiAgICAgICAgcmVzb2x2ZSh1bmRlZmluZWQpXG4gICAgICB9KVxuICAgICAgY2hpbGQub25jZShcImVycm9yXCIsIChlcnJvcikgPT4ge1xuICAgICAgICB0aGlzLmluZmxpZ2h0UHJvY2Vzc0NoaWxkcmVuLmRlbGV0ZShjaGlsZClcbiAgICAgICAgY29uc29sZS5lcnJvcihcIkJhY2tncm91bmQgam9icyBzcGF3bmVkIHJ1bm5lciBlcnJvcjpcIiwgZXJyb3IpXG4gICAgICAgIHJlc29sdmUodW5kZWZpbmVkKVxuICAgICAgfSlcbiAgICB9KVxuXG4gICAgY2hpbGQudW5yZWYoKVxuXG4gICAgcmV0dXJuIGZpbmlzaGVkXG4gIH1cblxuICAvKipcbiAgICogQnVpbGRzIHRoZSBleGFjdCBtYWluIGVuZHBvaW50IGFuZCBnZW5lcmF0aW9uIGluaGVyaXRlZCBieSBldmVyeSBjaGlsZC5cbiAgICogQHJldHVybnMge1JlY29yZDxzdHJpbmcsIHN0cmluZz59IC0gQ2hpbGQgcHJvY2VzcyBlbnZpcm9ubWVudCBhZGRpdGlvbnMuXG4gICAqL1xuICBfY2hpbGRCYWNrZ3JvdW5kSm9ic0Vudmlyb25tZW50KCkge1xuICAgIGNvbnN0IGNvbmZpZ3VyYXRpb24gPSB0aGlzLmNvbmZpZ3VyYXRpb25cbiAgICBpZiAoIWNvbmZpZ3VyYXRpb24pIHRocm93IG5ldyBFcnJvcihcIkJhY2tncm91bmQgam9icyB3b3JrZXIgY29uZmlndXJhdGlvbiBub3QgaW5pdGlhbGl6ZWRcIilcbiAgICBpZiAoIXRoaXMuaG9zdCB8fCB0eXBlb2YgdGhpcy5wb3J0ICE9PSBcIm51bWJlclwiKSB0aHJvdyBuZXcgRXJyb3IoXCJCYWNrZ3JvdW5kIGpvYnMgd29ya2VyIGVuZHBvaW50IG5vdCByZXNvbHZlZFwiKVxuXG4gICAgcmV0dXJuIHtcbiAgICAgIFZFTE9DSU9VU19CQUNLR1JPVU5EX0pPQl9DSElMRDogXCIxXCIsXG4gICAgICBWRUxPQ0lPVVNfRU5WOiBjb25maWd1cmF0aW9uLmdldEVudmlyb25tZW50KCksXG4gICAgICBWRUxPQ0lPVVNfQkFDS0dST1VORF9KT0JTX0hPU1Q6IHRoaXMuaG9zdCxcbiAgICAgIFZFTE9DSU9VU19CQUNLR1JPVU5EX0pPQlNfUE9SVDogYCR7dGhpcy5wb3J0fWAsXG4gICAgICAuLi4odGhpcy5nZW5lcmF0aW9uSWQgPyB7VkVMT0NJT1VTX0JBQ0tHUk9VTkRfSk9CU19HRU5FUkFUSU9OX0lEOiB0aGlzLmdlbmVyYXRpb25JZH0gOiB7fSlcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogUnVucyByZXBvcnQgam9iIHJlc3VsdC5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBPcHRpb25zLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gYXJncy5qb2JJZCAtIEpvYiBpZC5cbiAgICogQHBhcmFtIHtcImNvbXBsZXRlZFwiIHwgXCJmYWlsZWRcIiB8IFwicmVzY2hlZHVsZWRcIn0gYXJncy5zdGF0dXMgLSBTdGF0dXMuXG4gICAqIEBwYXJhbSB7bnVtYmVyfSBbYXJncy5kZWxheU1zXSAtIFJlc2NoZWR1bGUgZGVsYXkgaW4gbWlsbGlzZWNvbmRzLlxuICAgKiBAcGFyYW0ge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSBbYXJncy5lcnJvcl0gLSBFcnJvci5cbiAgICogQHBhcmFtIHtzdHJpbmd9IFthcmdzLmhhbmRvZmZJZF0gLSBIYW5kb2ZmIGxlYXNlIGlkLlxuICAgKiBAcGFyYW0ge251bWJlcn0gW2FyZ3MuaGFuZGVkT2ZmQXRNc10gLSBIYW5kZWQgb2ZmIHRpbWVzdGFtcC5cbiAgICogQHBhcmFtIHtzdHJpbmd9IFthcmdzLndvcmtlcklkXSAtIFdvcmtlciBpZC5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL3R5cGVzLmpzXCIpLlBvb2xlZFJ1bm5lckZhaWx1cmV9IFthcmdzLnJ1bm5lckZhaWx1cmVdIC0gUG9vbGVkLWNoaWxkIHByb2Nlc3MgZmFpbHVyZSBwcm92ZW5hbmNlLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyB3aGVuIHJlcG9ydGVkLlxuICAgKi9cbiAgYXN5bmMgX3JlcG9ydEpvYlJlc3VsdCh7am9iSWQsIHN0YXR1cywgZGVsYXlNcywgZXJyb3IsIGhhbmRvZmZJZCwgaGFuZGVkT2ZmQXRNcywgd29ya2VySWQsIHJ1bm5lckZhaWx1cmV9KSB7XG4gICAgaWYgKCF0aGlzLnN0YXR1c1JlcG9ydGVyKSByZXR1cm5cblxuICAgIHRyeSB7XG4gICAgICAvLyBSZXRyeSBhIHRyYW5zaWVudCBwZXJzaXN0IGZhaWx1cmUgKGBqb2ItdXBkYXRlLWVycm9yYCk6IHRoZSB3b3JrZXIgaXNcbiAgICAgIC8vIGxvbmctbGl2ZWQgYW5kIGNhbm5vdCBleGl0IHRvIHRyaWdnZXIgb3JwaGFuIHJlY2xhaW0sIHNvIGRyb3BwaW5nIHRoZVxuICAgICAgLy8gY29tcGxldGlvbiBoZXJlIHdvdWxkIHN0cmFuZCB0aGUgam9iIGluIGBoYW5kZWRfb2ZmYCBmb3JldmVyIOKAlCBmYXRhbCBmb3IgYVxuICAgICAgLy8gYG1heF9jb25jdXJyZW5jeTogMWAgam9iIChhIHN0cmFuZGVkIHJvdyBibG9ja3MgZXZlcnkgZnV0dXJlIHJ1bikuXG4gICAgICBhd2FpdCB0aGlzLnN0YXR1c1JlcG9ydGVyLnJlcG9ydFdpdGhSZXRyeSh7am9iSWQsIHN0YXR1cywgZGVsYXlNcywgZXJyb3IsIGhhbmRvZmZJZCwgaGFuZGVkT2ZmQXRNcywgd29ya2VySWQsIHJ1bm5lckZhaWx1cmUsIHJldHJ5UGVyc2lzdEVycm9yczogdHJ1ZX0pXG4gICAgfSBjYXRjaCAocmVwb3J0RXJyb3IpIHtcbiAgICAgIGNvbnNvbGUuZXJyb3IoXCJCYWNrZ3JvdW5kIGpvYiBzdGF0dXMgcmVwb3J0aW5nIGZhaWxlZDpcIiwgcmVwb3J0RXJyb3IpXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIEZpcmVzIGEgZHVyYWJsZSBqb2ItcmVzdWx0IHJlcG9ydCB3aXRob3V0IGJsb2NraW5nIHRoZSBjYWxsZXIgKHNvIGZyZWVpbmcgYVxuICAgKiBqb2IvY2hpbGQgc2xvdCBuZXZlciB3YWl0cyBvbiB0aGUgcmVwb3J0KS4gVGhlIHJlcG9ydCBpcyB0cmFja2VkIHNvIGFcbiAgICogZ3JhY2VmdWwgYHN0b3AoKWAgY2FuIGRyYWluIGluLWZsaWdodCByZXBvcnRzIGJlZm9yZSBjbG9zaW5nIHRoZSBzb2NrZXQuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gT3B0aW9ucy5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGFyZ3Muam9iSWQgLSBKb2IgaWQuXG4gICAqIEBwYXJhbSB7XCJjb21wbGV0ZWRcIiB8IFwiZmFpbGVkXCIgfCBcInJlc2NoZWR1bGVkXCJ9IGFyZ3Muc3RhdHVzIC0gU3RhdHVzLlxuICAgKiBAcGFyYW0ge251bWJlcn0gW2FyZ3MuZGVsYXlNc10gLSBSZXNjaGVkdWxlIGRlbGF5IGluIG1pbGxpc2Vjb25kcy5cbiAgICogQHBhcmFtIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gW2FyZ3MuZXJyb3JdIC0gRXJyb3IuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBbYXJncy5oYW5kb2ZmSWRdIC0gSGFuZG9mZiBsZWFzZSBpZC5cbiAgICogQHBhcmFtIHtudW1iZXJ9IFthcmdzLmhhbmRlZE9mZkF0TXNdIC0gSGFuZGVkIG9mZiB0aW1lc3RhbXAuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBbYXJncy53b3JrZXJJZF0gLSBXb3JrZXIgaWQuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi90eXBlcy5qc1wiKS5Qb29sZWRSdW5uZXJGYWlsdXJlfSBbYXJncy5ydW5uZXJGYWlsdXJlXSAtIFBvb2xlZC1jaGlsZCBwcm9jZXNzIGZhaWx1cmUgcHJvdmVuYW5jZS5cbiAgICogQHJldHVybnMge3ZvaWR9XG4gICAqL1xuICBfcmVwb3J0Sm9iUmVzdWx0SW5CYWNrZ3JvdW5kKHtqb2JJZCwgc3RhdHVzLCBkZWxheU1zLCBlcnJvciwgaGFuZG9mZklkLCBoYW5kZWRPZmZBdE1zLCB3b3JrZXJJZCwgcnVubmVyRmFpbHVyZX0pIHtcbiAgICAvKipcbiAgICAgKiBEZWZpbmVzIHJlcG9ydC5cbiAgICAgKiBAdHlwZSB7UHJvbWlzZTx2b2lkPn0gKi9cbiAgICBsZXQgcmVwb3J0XG5cbiAgICByZXBvcnQgPSB0aGlzLl9yZXBvcnRKb2JSZXN1bHQoe2pvYklkLCBzdGF0dXMsIGRlbGF5TXMsIGVycm9yLCBoYW5kb2ZmSWQsIGhhbmRlZE9mZkF0TXMsIHdvcmtlcklkLCBydW5uZXJGYWlsdXJlfSkuZmluYWxseSgoKSA9PiB7XG4gICAgICB0aGlzLmluZmxpZ2h0UmVwb3J0cy5kZWxldGUocmVwb3J0KVxuICAgIH0pXG5cbiAgICB0aGlzLmluZmxpZ2h0UmVwb3J0cy5hZGQocmVwb3J0KVxuICB9XG59XG4iXX0=