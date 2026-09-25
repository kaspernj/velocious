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
import { POOLED_RUNNER_INFLIGHT_JOB_ID_LIMIT, boundedPooledRunnerInflightJobIds, isPooledChildShutdownReason, isPooledChildShutdownSignal } from "./pooled-runner-shutdown.js";
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
 * @property {string} [childInstanceId] - Stable identity reported by the child.
 * @property {number} jobsRun - Acknowledged jobs completed by this child.
 * @property {Map<string, PooledJobEntry>} inflight - Jobs currently owned by this child.
 * @property {number} lastDispatchSeq - Round-robin dispatch sequence.
 * @property {boolean} retiring - Whether this child is draining before retirement.
 * @property {boolean} [started] - Whether the child completed its startup handshake.
 * @property {boolean} [settling] - Whether failure handling already owns this child.
 * @property {number} [ipcDisconnectedAtMs] - Parent observation of IPC disconnect.
 * @property {import("./types.js").PooledChildShutdownObservation} [shutdownObservation] - Child observation sent before teardown.
 * @property {import("./types.js").PooledChildShutdownReason} [shutdownReason] - Exact parent-requested shutdown reason.
 * @property {number} [shutdownRequestedAtMs] - Exact parent shutdown-request timestamp.
 * @property {import("node:child_process").ChildProcess["signalCode"]} [shutdownSignal] - Signal selected by the parent request.
 * @property {ReturnType<typeof setTimeout>} [shutdownSignalTimer] - Drained-retirement fallback signal timer.
 * @property {ReturnType<typeof setTimeout> | null} [timeoutSigkillTimer] - Pending timeout SIGKILL timer.
 * @property {string} [timeoutJobId] - Job whose timeout initiated termination.
 */
/** Grace period after SIGTERM before a lingering process runner is SIGKILLed. */
const FORKED_CHILD_SIGKILL_GRACE_MS = 5000;
/** Time a drained retirement gives the child IPC request to begin teardown before SIGTERM fallback. */
const POOLED_RUNNER_SHUTDOWN_REQUEST_GRACE_MS = 250;
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
 * Checks whether an IPC value is the child's bounded pre-teardown observation.
 * @param {ReturnType<typeof JSON.parse>} message - IPC message.
 * @returns {message is import("./types.js").PooledChildShutdownObservation & {type: "shutdown-observation"}} - Whether this is a valid shutdown observation.
 */
function isChildShutdownObservationMessage(message) {
    if (!message || typeof message !== "object")
        return false;
    const record = /** @type {{childInstanceId?: ReturnType<typeof JSON.parse>, inflightJobIds?: ReturnType<typeof JSON.parse>, inflightJobIdsTruncatedCount?: ReturnType<typeof JSON.parse>, reason?: ReturnType<typeof JSON.parse>, shutdownObservedAtMs?: ReturnType<typeof JSON.parse>, shutdownRequestedAtMs?: ReturnType<typeof JSON.parse>, signal?: ReturnType<typeof JSON.parse>, type?: ReturnType<typeof JSON.parse>}} */ (message);
    return record.type === "shutdown-observation"
        && typeof record.childInstanceId === "string"
        && Array.isArray(record.inflightJobIds)
        && record.inflightJobIds.length <= POOLED_RUNNER_INFLIGHT_JOB_ID_LIMIT
        && record.inflightJobIds.every((jobId) => typeof jobId === "string")
        && Number.isInteger(record.inflightJobIdsTruncatedCount)
        && record.inflightJobIdsTruncatedCount >= 0
        && isPooledChildShutdownReason(record.reason)
        && typeof record.shutdownObservedAtMs === "number"
        && Number.isFinite(record.shutdownObservedAtMs)
        && (record.shutdownRequestedAtMs === null || (typeof record.shutdownRequestedAtMs === "number" && Number.isFinite(record.shutdownRequestedAtMs)))
        && isPooledChildShutdownSignal(record.signal);
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
            if (pooledState) {
                this._requestPooledChildShutdown({ child, reason: "worker_stop", signal: "SIGTERM" });
            }
            else {
                try {
                    child.kill("SIGTERM");
                }
                catch {
                    // Child already exited; nothing to do.
                }
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
        if (!state || state.settling || state.shutdownReason || !state.inflight.has(jobId))
            return;
        state.timeoutJobId = jobId;
        this._requestPooledChildShutdown({ child, reason: "job_timeout", signal: "SIGTERM" });
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
        child.once("disconnect", () => {
            const state = this.pooledChildStates.get(child);
            if (state)
                state.ipcDisconnectedAtMs ??= Date.now();
        });
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
        const record = /** @type {{type?: ReturnType<typeof JSON.parse>, childInstanceId?: ReturnType<typeof JSON.parse>, jobId?: ReturnType<typeof JSON.parse>, acknowledged?: ReturnType<typeof JSON.parse>, rssBytes?: ReturnType<typeof JSON.parse>, error?: ReturnType<typeof JSON.parse>}} */ (message);
        const state = this.pooledChildStates.get(child);
        if (record.type === "ready") {
            if (state) {
                state.started = true;
                if (typeof record.childInstanceId === "string")
                    state.childInstanceId = record.childInstanceId;
            }
            return;
        }
        if (isChildShutdownObservationMessage(message)) {
            if (state) {
                state.childInstanceId = message.childInstanceId;
                state.shutdownObservation = message;
                if (state.shutdownSignalTimer) {
                    clearTimeout(state.shutdownSignalTimer);
                    state.shutdownSignalTimer = undefined;
                }
            }
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
        const state = this.pooledChildStates.get(child);
        if (!state)
            throw new Error("Cannot retire pooled child without tracked state");
        if (state.inflight.size > 0) {
            throw new Error(`Cannot retire pooled child while ${state.inflight.size} ${state.inflight.size === 1 ? "job remains" : "jobs remain"} in flight`);
        }
        this.pooledChildren.delete(child);
        state.retiring = true;
        this._requestPooledChildShutdown({ child, reason: "parent_retire_drained", signal: "SIGTERM", waitForObservation: true });
    }
    /**
     * Records an exact parent request before IPC or signal delivery. Drained
     * retirement gets a brief IPC-first grace so its zero-job observation is
     * deterministic; timeout/worker-stop paths signal immediately.
     * @param {object} args - Shutdown request.
     * @param {import("node:child_process").ChildProcess} args.child - Pooled child.
     * @param {import("./types.js").PooledChildShutdownReason} args.reason - Exact parent reason.
     * @param {keyof typeof import("node:os").constants.signals} args.signal - Signal to deliver.
     * @param {boolean} [args.waitForObservation] - Whether IPC observation may precede signal fallback.
     * @returns {void}
     */
    _requestPooledChildShutdown({ child, reason, signal, waitForObservation = false }) {
        const state = this.pooledChildStates.get(child);
        if (!state || state.settling || state.shutdownReason)
            return;
        const shutdownRequestedAtMs = Date.now();
        state.shutdownReason = reason;
        state.shutdownRequestedAtMs = shutdownRequestedAtMs;
        state.shutdownSignal = signal;
        let requestSent = false;
        if (child.connected) {
            try {
                child.send({ type: "shutdown-request", reason, shutdownRequestedAtMs, signal }, (error) => {
                    if (!error || !waitForObservation || state.settling)
                        return;
                    if (state.shutdownSignalTimer) {
                        clearTimeout(state.shutdownSignalTimer);
                        state.shutdownSignalTimer = undefined;
                    }
                    this._signalPooledChild({ child, signal });
                });
                requestSent = true;
            }
            catch {
                // The signal below remains the bounded shutdown mechanism.
            }
        }
        if (waitForObservation && requestSent) {
            state.shutdownSignalTimer = setTimeout(() => {
                state.shutdownSignalTimer = undefined;
                this._signalPooledChild({ child, signal });
            }, POOLED_RUNNER_SHUTDOWN_REQUEST_GRACE_MS);
            state.shutdownSignalTimer.unref();
            return;
        }
        this._signalPooledChild({ child, signal });
    }
    /**
     * Delivers one parent-owned process signal without changing recorded provenance.
     * @param {{child: import("node:child_process").ChildProcess, signal: keyof typeof import("node:os").constants.signals}} args - Signal request.
     * @returns {void}
     */
    _signalPooledChild({ child, signal }) {
        try {
            child.kill(signal);
        }
        catch {
            // Child already exited; its exit/error handler owns state settlement.
        }
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
            if (state.shutdownSignalTimer)
                clearTimeout(state.shutdownSignalTimer);
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
        // A drained retirement already advertised its replacement capacity when
        // the final job completed. Re-advertising here can restore a credit main
        // consumed before its handoff reached the replacement child.
        if (state?.shutdownReason !== "parent_retire_drained") {
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
        const observation = state.shutdownObservation;
        let shutdownReason = state.shutdownReason ?? observation?.reason;
        if (!shutdownReason) {
            if (origin === "process-error" || origin === "ipc-send") {
                shutdownReason = "process_error";
            }
            else if (signal === "SIGTERM") {
                shutdownReason = "signal_sigterm";
            }
            else if (signal === "SIGINT") {
                shutdownReason = "signal_sigint";
            }
            else if (signal === "SIGKILL") {
                shutdownReason = "signal_sigkill";
            }
            else if (signal) {
                shutdownReason = "signal_other";
            }
            else if (state.ipcDisconnectedAtMs && exitCode === 0) {
                shutdownReason = "ipc_disconnect";
            }
            else {
                shutdownReason = "unexpected_exit";
            }
        }
        const terminationReason = shutdownReason === "job_timeout"
            ? "job-timeout"
            : shutdownReason === "worker_stop" ? "worker-shutdown-timeout" : "unexpected";
        const workerLifecycle = this.shouldStop ? "stopping" : this.isRetiring ? "retiring" : "running";
        const runnerLifecycle = state.started === false ? "starting" : state.retiring ? "retiring" : "running";
        const boundedInflight = boundedPooledRunnerInflightJobIds(state.inflight.keys());
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
            childInstanceId: state.childInstanceId ?? observation?.childInstanceId ?? null,
            exitCode,
            generationId: this.generationId ?? null,
            ...boundedInflight,
            oomKilled: signal === "SIGKILL" && shutdownReason === "signal_sigkill" ? null : false,
            origin,
            runnerAgeMs: Math.max(0, Date.now() - state.createdAtMs),
            runnerCreatedAtMs: state.createdAtMs,
            runnerDetached: false,
            runnerJobsRun: state.jobsRun,
            runnerLifecycle,
            runnerPid: child.pid ?? null,
            signal,
            shutdownObservedAtMs: observation?.shutdownObservedAtMs ?? state.ipcDisconnectedAtMs ?? null,
            shutdownRequestedAtMs: state.shutdownRequestedAtMs ?? observation?.shutdownRequestedAtMs ?? null,
            shutdownReason,
            shutdownSignal: state.shutdownSignal ?? observation?.signal ?? signal,
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoid29ya2VyLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiLi4vLi4vLi4vc3JjL2JhY2tncm91bmQtam9icy93b3JrZXIuanMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6IkFBQUEsWUFBWTtBQUVaLE9BQU8sR0FBRyxNQUFNLEtBQUssQ0FBQTtBQUNyQixPQUFPLEVBQUUsSUFBSSxFQUFFLEtBQUssRUFBRSxNQUFNLG9CQUFvQixDQUFBO0FBQ2hELE9BQU8sVUFBVSxNQUFNLGtCQUFrQixDQUFBO0FBQ3pDLE9BQU8scUJBQXFCLE1BQU0sbUJBQW1CLENBQUE7QUFDckQsT0FBTyxxQkFBcUIsTUFBTSw4QkFBOEIsQ0FBQTtBQUNoRSxPQUFPLDRCQUE0QixNQUFNLHNCQUFzQixDQUFBO0FBQy9ELE9BQU8sRUFBRSxVQUFVLEVBQUUsTUFBTSxRQUFRLENBQUE7QUFDbkMsT0FBTyxFQUFFLGFBQWEsRUFBRSxNQUFNLFVBQVUsQ0FBQTtBQUN4QyxPQUFPLGlCQUFpQixFQUFFLEVBQUUsZ0JBQWdCLEVBQUUsTUFBTSxnQ0FBZ0MsQ0FBQTtBQUNwRixPQUFPLDZCQUE2QixNQUFNLHdCQUF3QixDQUFBO0FBQ2xFLE9BQU8sb0JBQW9CLE1BQU0sa0JBQWtCLENBQUE7QUFDbkQsT0FBTyxFQUFFLDJCQUEyQixFQUFFLE1BQU0sd0JBQXdCLENBQUE7QUFDcEUsT0FBTyxFQUFFLHdCQUF3QixFQUFFLE1BQU0sMEJBQTBCLENBQUE7QUFDbkUsT0FBTyw2Q0FBNkMsRUFBRSxFQUFFLHVDQUF1QyxFQUFFLG9DQUFvQyxFQUFFLE1BQU0seUNBQXlDLENBQUE7QUFDdEwsT0FBTyxFQUFFLG1DQUFtQyxFQUFFLGlDQUFpQyxFQUFFLDJCQUEyQixFQUFFLDJCQUEyQixFQUFFLE1BQU0sNkJBQTZCLENBQUE7QUFFOUs7Ozs7Ozs7R0FPRztBQUNIOzs7Ozs7R0FNRztBQUNIOzs7Ozs7Ozs7Ozs7Ozs7Ozs7R0FrQkc7QUFDSCxpRkFBaUY7QUFDakYsTUFBTSw2QkFBNkIsR0FBRyxJ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RUQ7Ozs7Ozs7Ozs7Ozs7O09BY0c7SUFDSCw0QkFBNEIsQ0FBQyxFQUFDLEtBQUssRUFBRSxNQUFNLEVBQUUsT0FBTyxFQUFFLEtBQUssRUFBRSxTQUFTLEVBQUUsYUFBYSxFQUFFLFFBQVEsRUFBRSxhQUFhLEVBQUM7UUFDN0c7O21DQUUyQjtRQUMzQixJQUFJLE1BQU0sQ0FBQTtRQUVWLE1BQU0sR0FBRyxJQUFJLENBQUMsZ0JBQWdCLENBQUMsRUFBQyxLQUFLLEVBQUUsTUFBTSxFQUFFLE9BQU8sRUFBRSxLQUFLLEVBQUUsU0FBUyxFQUFFLGFBQWEsRUFBRSxRQUFRLEVBQUUsYUFBYSxFQUFDLENBQUMsQ0FBQyxPQUFPLENBQUMsR0FBRyxFQUFFO1lBQzlILElBQUksQ0FBQyxlQUFlLENBQUMsTUFBTSxDQUFDLE1BQU0sQ0FBQyxDQUFBO1FBQ3JDLENBQUMsQ0FBQyxDQUFBO1FBRUYsSUFBSSxDQUFDLGVBQWUsQ0FBQyxHQUFHLENBQUMsTUFBTSxDQUFDLENBQUE7SUFDbEMsQ0FBQztDQUNGIiwic291cmNlc0NvbnRlbnQiOlsiLy8gQHRzLWNoZWNrXG5cbmltcG9ydCBuZXQgZnJvbSBcIm5ldFwiXG5pbXBvcnQgeyBmb3JrLCBzcGF3biB9IGZyb20gXCJub2RlOmNoaWxkX3Byb2Nlc3NcIlxuaW1wb3J0IEpzb25Tb2NrZXQgZnJvbSBcIi4vanNvbi1zb2NrZXQuanNcIlxuaW1wb3J0IEJhY2tncm91bmRKb2JSZWdpc3RyeSBmcm9tIFwiLi9qb2ItcmVnaXN0cnkuanNcIlxuaW1wb3J0IGNvbmZpZ3VyYXRpb25SZXNvbHZlciBmcm9tIFwiLi4vY29uZmlndXJhdGlvbi1yZXNvbHZlci5qc1wiXG5pbXBvcnQgQmFja2dyb3VuZEpvYnNTdGF0dXNSZXBvcnRlciBmcm9tIFwiLi9zdGF0dXMtcmVwb3J0ZXIuanNcIlxuaW1wb3J0IHsgcmFuZG9tVVVJRCB9IGZyb20gXCJjcnlwdG9cIlxuaW1wb3J0IHsgZmlsZVVSTFRvUGF0aCB9IGZyb20gXCJub2RlOnVybFwiXG5pbXBvcnQgc2h1dGRvd25MaWZlY3ljbGUsIHsgcnVuU2h1dGRvd25TdGVwcyB9IGZyb20gXCIuLi91dGlscy9zaHV0ZG93bi1saWZlY3ljbGUuanNcIlxuaW1wb3J0IEJhY2tncm91bmRKb2JSZXNjaGVkdWxlU2lnbmFsIGZyb20gXCIuL3Jlc2NoZWR1bGUtc2lnbmFsLmpzXCJcbmltcG9ydCBwZXJmb3JtQmFja2dyb3VuZEpvYiBmcm9tIFwiLi9wZXJmb3JtLWpvYi5qc1wiXG5pbXBvcnQgeyBydW5XaXRoQmFja2dyb3VuZEpvYlBheWxvYWQgfSBmcm9tIFwiLi9leGVjdXRpb24tY29udGV4dC5qc1wiXG5pbXBvcnQgeyBjcmVhdGVHZW5lcmF0aW9uV29ya2VySWQgfSBmcm9tIFwiLi9nZW5lcmF0aW9uLWlkZW50aXR5LmpzXCJcbmltcG9ydCBCYWNrZ3JvdW5kSm9ic0dlbmVyYXRpb25IYW5kc2hha2VUaW1lb3V0RXJyb3IsIHsgREVGQVVMVF9HRU5FUkFUSU9OX0hBTkRTSEFLRV9USU1FT1VUX01TLCB2YWxpZGF0ZUdlbmVyYXRpb25IYW5kc2hha2VUaW1lb3V0TXMgfSBmcm9tIFwiLi9nZW5lcmF0aW9uLWhhbmRzaGFrZS10aW1lb3V0LWVycm9yLmpzXCJcbmltcG9ydCB7IFBPT0xFRF9SVU5ORVJfSU5GTElHSFRfSk9CX0lEX0xJTUlULCBib3VuZGVkUG9vbGVkUnVubmVySW5mbGlnaHRKb2JJZHMsIGlzUG9vbGVkQ2hpbGRTaHV0ZG93blJlYXNvbiwgaXNQb29sZWRDaGlsZFNodXRkb3duU2lnbmFsIH0gZnJvbSBcIi4vcG9vbGVkLXJ1bm5lci1zaHV0ZG93bi5qc1wiXG5cbi8qKlxuICogUGVyLWZvcmtlZC1jaGlsZCB0aW1lb3V0IGJvb2trZWVwaW5nLlxuICogQHR5cGVkZWYge29iamVjdH0gRm9ya2VkSm9iVGltZW91dFN0YXRlXG4gKiBAcHJvcGVydHkge2Jvb2xlYW59IHRpbWVkT3V0IC0gV2hldGhlciB0aGUgdGltZW91dCBmaXJlZCBhbmQgdGhlIGNoaWxkIHdhcyB0ZXJtaW5hdGVkLlxuICogQHByb3BlcnR5IHtudW1iZXIgfCBudWxsfSB0aW1lb3V0TXMgLSBUaGUgYXJtZWQgdGltZW91dCBpbiBtcywgb3IgbnVsbCB3aGVuIGRpc2FibGVkLlxuICogQHByb3BlcnR5IHtSZXR1cm5UeXBlPHR5cGVvZiBzZXRUaW1lb3V0PiB8IG51bGx9IHRpbWVyIC0gVGhlIHBlbmRpbmcgdGltZW91dCB0aW1lciwgY2xlYXJlZCBvbiBleGl0LlxuICogQHByb3BlcnR5IHtSZXR1cm5UeXBlPHR5cGVvZiBzZXRUaW1lb3V0PiB8IG51bGx9IHNpZ2tpbGxUaW1lciAtIFRoZSBwZW5kaW5nIFNJR0tJTEwgZ3JhY2UgdGltZXIsIGNsZWFyZWQgb24gZXhpdC5cbiAqL1xuLyoqXG4gKiBAdHlwZWRlZiB7b2JqZWN0fSBQb29sZWRKb2JFbnRyeVxuICogQHByb3BlcnR5IHtpbXBvcnQoXCIuL3R5cGVzLmpzXCIpLkJhY2tncm91bmRKb2JQYXlsb2FkICYge2lkOiBzdHJpbmd9fSBwYXlsb2FkIC0gRHVyYWJsZSBqb2IgcGF5bG9hZC5cbiAqIEBwcm9wZXJ0eSB7KHZhbHVlOiB2b2lkKSA9PiB2b2lkfSBbcmVzb2x2ZV0gLSBDb21wbGV0aW9uIHJlc29sdmVyLlxuICogQHByb3BlcnR5IHtQcm9taXNlPHZvaWQ+fSBbcG9vbGVkSm9iXSAtIFRyYWNrZWQgcG9vbGVkLWpvYiBwcm9taXNlLlxuICogQHByb3BlcnR5IHtSZXR1cm5UeXBlPHR5cGVvZiBzZXRUaW1lb3V0PiB8IG51bGx9IFt0aW1lb3V0VGltZXJdIC0gUGVyLWpvYiB0aW1lb3V0IHRpbWVyLlxuICovXG4vKipcbiAqIEB0eXBlZGVmIHtvYmplY3R9IFBvb2xlZENoaWxkU3RhdGVcbiAqIEBwcm9wZXJ0eSB7bnVtYmVyfSBjcmVhdGVkQXRNcyAtIENoaWxkIGNyZWF0aW9uIHRpbWVzdGFtcC5cbiAqIEBwcm9wZXJ0eSB7c3RyaW5nfSBbY2hpbGRJbnN0YW5jZUlkXSAtIFN0YWJsZSBpZGVudGl0eSByZXBvcnRlZCBieSB0aGUgY2hpbGQuXG4gKiBAcHJvcGVydHkge251bWJlcn0gam9ic1J1biAtIEFja25vd2xlZGdlZCBqb2JzIGNvbXBsZXRlZCBieSB0aGlzIGNoaWxkLlxuICogQHByb3BlcnR5IHtNYXA8c3RyaW5nLCBQb29sZWRKb2JFbnRyeT59IGluZmxpZ2h0IC0gSm9icyBjdXJyZW50bHkgb3duZWQgYnkgdGhpcyBjaGlsZC5cbiAqIEBwcm9wZXJ0eSB7bnVtYmVyfSBsYXN0RGlzcGF0Y2hTZXEgLSBSb3VuZC1yb2JpbiBkaXNwYXRjaCBzZXF1ZW5jZS5cbiAqIEBwcm9wZXJ0eSB7Ym9vbGVhbn0gcmV0aXJpbmcgLSBXaGV0aGVyIHRoaXMgY2hpbGQgaXMgZHJhaW5pbmcgYmVmb3JlIHJldGlyZW1lbnQuXG4gKiBAcHJvcGVydHkge2Jvb2xlYW59IFtzdGFydGVkXSAtIFdoZXRoZXIgdGhlIGNoaWxkIGNvbXBsZXRlZCBpdHMgc3RhcnR1cCBoYW5kc2hha2UuXG4gKiBAcHJvcGVydHkge2Jvb2xlYW59IFtzZXR0bGluZ10gLSBXaGV0aGVyIGZhaWx1cmUgaGFuZGxpbmcgYWxyZWFkeSBvd25zIHRoaXMgY2hpbGQuXG4gKiBAcHJvcGVydHkge251bWJlcn0gW2lwY0Rpc2Nvbm5lY3RlZEF0TXNdIC0gUGFyZW50IG9ic2VydmF0aW9uIG9mIElQQyBkaXNjb25uZWN0LlxuICogQHByb3BlcnR5IHtpbXBvcnQoXCIuL3R5cGVzLmpzXCIpLlBvb2xlZENoaWxkU2h1dGRvd25PYnNlcnZhdGlvbn0gW3NodXRkb3duT2JzZXJ2YXRpb25dIC0gQ2hpbGQgb2JzZXJ2YXRpb24gc2VudCBiZWZvcmUgdGVhcmRvd24uXG4gKiBAcHJvcGVydHkge2ltcG9ydChcIi4vdHlwZXMuanNcIikuUG9vbGVkQ2hpbGRTaHV0ZG93blJlYXNvbn0gW3NodXRkb3duUmVhc29uXSAtIEV4YWN0IHBhcmVudC1yZXF1ZXN0ZWQgc2h1dGRvd24gcmVhc29uLlxuICogQHByb3BlcnR5IHtudW1iZXJ9IFtzaHV0ZG93blJlcXVlc3RlZEF0TXNdIC0gRXhhY3QgcGFyZW50IHNodXRkb3duLXJlcXVlc3QgdGltZXN0YW1wLlxuICogQHByb3BlcnR5IHtpbXBvcnQoXCJub2RlOmNoaWxkX3Byb2Nlc3NcIikuQ2hpbGRQcm9jZXNzW1wic2lnbmFsQ29kZVwiXX0gW3NodXRkb3duU2lnbmFsXSAtIFNpZ25hbCBzZWxlY3RlZCBieSB0aGUgcGFyZW50IHJlcXVlc3QuXG4gKiBAcHJvcGVydHkge1JldHVyblR5cGU8dHlwZW9mIHNldFRpbWVvdXQ+fSBbc2h1dGRvd25TaWduYWxUaW1lcl0gLSBEcmFpbmVkLXJldGlyZW1lbnQgZmFsbGJhY2sgc2lnbmFsIHRpbWVyLlxuICogQHByb3BlcnR5IHtSZXR1cm5UeXBlPHR5cGVvZiBzZXRUaW1lb3V0PiB8IG51bGx9IFt0aW1lb3V0U2lna2lsbFRpbWVyXSAtIFBlbmRpbmcgdGltZW91dCBTSUdLSUxMIHRpbWVyLlxuICogQHByb3BlcnR5IHtzdHJpbmd9IFt0aW1lb3V0Sm9iSWRdIC0gSm9iIHdob3NlIHRpbWVvdXQgaW5pdGlhdGVkIHRlcm1pbmF0aW9uLlxuICovXG4vKiogR3JhY2UgcGVyaW9kIGFmdGVyIFNJR1RFUk0gYmVmb3JlIGEgbGluZ2VyaW5nIHByb2Nlc3MgcnVubmVyIGlzIFNJR0tJTExlZC4gKi9cbmNvbnN0IEZPUktFRF9DSElMRF9TSUdLSUxMX0dSQUNFX01TID0gNTAwMFxuLyoqIFRpbWUgYSBkcmFpbmVkIHJldGlyZW1lbnQgZ2l2ZXMgdGhlIGNoaWxkIElQQyByZXF1ZXN0IHRvIGJlZ2luIHRlYXJkb3duIGJlZm9yZSBTSUdURVJNIGZhbGxiYWNrLiAqL1xuY29uc3QgUE9PTEVEX1JVTk5FUl9TSFVURE9XTl9SRVFVRVNUX0dSQUNFX01TID0gMjUwXG4vKipcbiAqIExhcmdlc3QgZGVsYXkgTm9kZSdzIGBzZXRUaW1lb3V0YCBhY2NlcHRzIHdpdGhvdXQgb3ZlcmZsb3dpbmcgdG8gYSAxbXMgZGVsYXlcbiAqIChhIDMyLWJpdCBzaWduZWQgaW50IG9mIG1zLCB+MjQuOCBkYXlzKS4gQSBgam9iVGltZW91dE1zYCBhYm92ZSB0aGlzIOKAlCBvciBhXG4gKiBub24tZmluaXRlIG9uZSBsaWtlIGBJbmZpbml0eWAg4oCUIGlzIGNsYW1wZWQvZGlzYWJsZWQgcmF0aGVyIHRoYW4gY29lcmNlZCB0b1xuICogfjFtcywgd2hpY2ggd291bGQgb3RoZXJ3aXNlIHRlcm1pbmF0ZSBldmVyeSBmb3JrZWQgam9iIGFsbW9zdCBpbW1lZGlhdGVseS5cbiAqL1xuY29uc3QgTUFYX0ZPUktFRF9KT0JfVElNRU9VVF9NUyA9IDJfMTQ3XzQ4M182NDdcbmNvbnN0IEZPUktFRF9SVU5ORVJfRU5UUllfUEFUSCA9IGZpbGVVUkxUb1BhdGgobmV3IFVSTChcIi4vZm9ya2VkLXJ1bm5lci1jaGlsZC5qc1wiLCBpbXBvcnQubWV0YS51cmwpKVxuY29uc3QgUE9PTEVEX1JVTk5FUl9FTlRSWV9QQVRIID0gZmlsZVVSTFRvUGF0aChuZXcgVVJMKFwiLi9wb29sZWQtcnVubmVyLWNoaWxkLmpzXCIsIGltcG9ydC5tZXRhLnVybCkpXG4vKiogSG93IG9mdGVuIHRoZSB3b3JrZXIgc2VuZHMgYSBsaXZlbmVzcyBoZWFydGJlYXQgdG8gdGhlIG1haW4uICovXG5jb25zdCBIRUFSVEJFQVRfSU5URVJWQUxfTVMgPSAxNTAwMFxuLyoqXG4gKiBNYXggdGltZSB0aGUgd29ya2VyIHNwZW5kcyByZXRyeWluZyBvbmUgcG9vbGVkIGNoaWxkJ3MgYWNjZXB0YW5jZSByZXBvcnRcbiAqIGJlZm9yZSBkcm9wcGluZyBpdC4gQWNjZXB0YW5jZSBldmlkZW5jZSBpcyBkaWFnbm9zdGljIOKAlCBhIHBlcnNpc3RlbnRcbiAqIG1haW4vREIgb3V0YWdlIG11c3Qgbm90IGhvbGQgcnVubmVyIGNhcGFjaXR5IGhvc3RhZ2UuXG4gKi9cbmNvbnN0IENISUxEX0FDQ0VQVEFOQ0VfUkVQT1JUX01BWF9EVVJBVElPTl9NUyA9IDEwMDAwXG4vKiogVENQIGtlZXBhbGl2ZSBzbyBhIGhhbGYtb3BlbiBjb25uZWN0aW9uIHRvIHRoZSBtYWluIHN1cmZhY2VzIGFzIGEgY2xvc2UuICovXG5jb25zdCBTT0NLRVRfS0VFUEFMSVZFX01TID0gMTAwMDBcbi8qKlxuICogRXhlY3V0aW9uIG1vZGVzLlxuICogQHR5cGUge2ltcG9ydChcIi4vdHlwZXMuanNcIikuQmFja2dyb3VuZEpvYkV4ZWN1dGlvbk1vZGVbXX0gKi9cbmNvbnN0IEVYRUNVVElPTl9NT0RFUyA9IFtcImlubGluZVwiLCBcImZvcmtlZFwiLCBcInBvb2xlZFwiLCBcInNwYXduZWRcIl1cblxuLyoqXG4gKiBOb3JtYWxpemVzIGEgY2FuZGlkYXRlIHBvb2xlZC1ydW5uZXIgY291bnQgb3Igam9iIGxpbWl0LlxuICogQHBhcmFtIHtudW1iZXIgfCB1bmRlZmluZWR9IHZhbHVlIC0gQ2FuZGlkYXRlIHBvc2l0aXZlIGludGVnZXIuXG4gKiBAcmV0dXJucyB7bnVtYmVyIHwgdW5kZWZpbmVkfSAtIE5vcm1hbGl6ZWQgdmFsdWUuXG4gKi9cbmZ1bmN0aW9uIHBvc2l0aXZlSW50ZWdlcih2YWx1ZSkge1xuICByZXR1cm4gdHlwZW9mIHZhbHVlID09PSBcIm51bWJlclwiICYmIE51bWJlci5pc0ludGVnZXIodmFsdWUpICYmIHZhbHVlID4gMCA/IHZhbHVlIDogdW5kZWZpbmVkXG59XG5cbi8qKlxuICogQ2hlY2tzIHdoZXRoZXIgYW4gSVBDIHZhbHVlIGlzIGEgcG9vbGVkIGNoaWxkJ3MgYWNjZXB0YW5jZSBvYnNlcnZhdGlvbiBmb3JcbiAqIG9uZSBqb2IuIFRoZSBjaGlsZCBjYXJyaWVzIGl0cyBleGFjdCBoYW5kb2ZmIGxlYXNlIHNvIHRoZSB3b3JrZXIgY2FuIGZvcndhcmRcbiAqIHRoZSByZXBvcnQgd2l0aG91dCBkZXBlbmRpbmcgb24gaXRzIGluLWZsaWdodCBlbnRyeSBzdGlsbCBleGlzdGluZy5cbiAqIEBwYXJhbSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59IG1lc3NhZ2UgLSBJUEMgbWVzc2FnZS5cbiAqIEByZXR1cm5zIHttZXNzYWdlIGlzIHt0eXBlOiBcImpvYi1yZWNlaXZlZFwiIHwgXCJqb2Itc3RhcnRlZFwiLCBqb2JJZDogc3RyaW5nLCBoYW5kb2ZmSWQ/OiBzdHJpbmcsIHdvcmtlcklkPzogc3RyaW5nLCBoYW5kZWRPZmZBdE1zPzogbnVtYmVyLCByZWNlaXZlZEF0TXM/OiBudW1iZXIsIHN0YXJ0ZWRBdE1zPzogbnVtYmVyLCBjaGlsZEluc3RhbmNlSWQ/OiBzdHJpbmcsIGNoaWxkUGlkPzogbnVtYmVyfX0gLSBXaGV0aGVyIHRoaXMgaXMgYSB2YWxpZCBhY2NlcHRhbmNlIG1lc3NhZ2UuXG4gKi9cbmZ1bmN0aW9uIGlzQ2hpbGRBY2NlcHRhbmNlTWVzc2FnZShtZXNzYWdlKSB7XG4gIGlmICghbWVzc2FnZSB8fCB0eXBlb2YgbWVzc2FnZSAhPT0gXCJvYmplY3RcIikgcmV0dXJuIGZhbHNlXG4gIGNvbnN0IHJlY29yZCA9IC8qKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSAqLyAobWVzc2FnZSlcblxuICByZXR1cm4gKHJlY29yZC50eXBlID09PSBcImpvYi1yZWNlaXZlZFwiIHx8IHJlY29yZC50eXBlID09PSBcImpvYi1zdGFydGVkXCIpXG4gICAgJiYgdHlwZW9mIHJlY29yZC5qb2JJZCA9PT0gXCJzdHJpbmdcIlxuICAgICYmIChyZWNvcmQuaGFuZG9mZklkID09PSB1bmRlZmluZWQgfHwgdHlwZW9mIHJlY29yZC5oYW5kb2ZmSWQgPT09IFwic3RyaW5nXCIpXG4gICAgJiYgKHJlY29yZC53b3JrZXJJZCA9PT0gdW5kZWZpbmVkIHx8IHR5cGVvZiByZWNvcmQud29ya2VySWQgPT09IFwic3RyaW5nXCIpXG4gICAgJiYgKHJlY29yZC5oYW5kZWRPZmZBdE1zID09PSB1bmRlZmluZWQgfHwgdHlwZW9mIHJlY29yZC5oYW5kZWRPZmZBdE1zID09PSBcIm51bWJlclwiKVxuICAgICYmIChyZWNvcmQucmVjZWl2ZWRBdE1zID09PSB1bmRlZmluZWQgfHwgdHlwZW9mIHJlY29yZC5yZWNlaXZlZEF0TXMgPT09IFwibnVtYmVyXCIpXG4gICAgJiYgKHJlY29yZC5zdGFydGVkQXRNcyA9PT0gdW5kZWZpbmVkIHx8IHR5cGVvZiByZWNvcmQuc3RhcnRlZEF0TXMgPT09IFwibnVtYmVyXCIpXG4gICAgJiYgKHJlY29yZC5jaGlsZEluc3RhbmNlSWQgPT09IHVuZGVmaW5lZCB8fCB0eXBlb2YgcmVjb3JkLmNoaWxkSW5zdGFuY2VJZCA9PT0gXCJzdHJpbmdcIilcbiAgICAmJiAocmVjb3JkLmNoaWxkUGlkID09PSB1bmRlZmluZWQgfHwgTnVtYmVyLmlzSW50ZWdlcihyZWNvcmQuY2hpbGRQaWQpKVxufVxuXG4vKipcbiAqIENoZWNrcyB3aGV0aGVyIGFuIElQQyB2YWx1ZSBpcyB0aGUgY2hpbGQncyBib3VuZGVkIHByZS10ZWFyZG93biBvYnNlcnZhdGlvbi5cbiAqIEBwYXJhbSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59IG1lc3NhZ2UgLSBJUEMgbWVzc2FnZS5cbiAqIEByZXR1cm5zIHttZXNzYWdlIGlzIGltcG9ydChcIi4vdHlwZXMuanNcIikuUG9vbGVkQ2hpbGRTaHV0ZG93bk9ic2VydmF0aW9uICYge3R5cGU6IFwic2h1dGRvd24tb2JzZXJ2YXRpb25cIn19IC0gV2hldGhlciB0aGlzIGlzIGEgdmFsaWQgc2h1dGRvd24gb2JzZXJ2YXRpb24uXG4gKi9cbmZ1bmN0aW9uIGlzQ2hpbGRTaHV0ZG93bk9ic2VydmF0aW9uTWVzc2FnZShtZXNzYWdlKSB7XG4gIGlmICghbWVzc2FnZSB8fCB0eXBlb2YgbWVzc2FnZSAhPT0gXCJvYmplY3RcIikgcmV0dXJuIGZhbHNlXG4gIGNvbnN0IHJlY29yZCA9IC8qKiBAdHlwZSB7e2NoaWxkSW5zdGFuY2VJZD86IFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+LCBpbmZsaWdodEpvYklkcz86IFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+LCBpbmZsaWdodEpvYklkc1RydW5jYXRlZENvdW50PzogUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4sIHJlYXNvbj86IFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+LCBzaHV0ZG93bk9ic2VydmVkQXRNcz86IFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+LCBzaHV0ZG93blJlcXVlc3RlZEF0TXM/OiBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPiwgc2lnbmFsPzogUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4sIHR5cGU/OiBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn19ICovIChtZXNzYWdlKVxuXG4gIHJldHVybiByZWNvcmQudHlwZSA9PT0gXCJzaHV0ZG93bi1vYnNlcnZhdGlvblwiXG4gICAgJiYgdHlwZW9mIHJlY29yZC5jaGlsZEluc3RhbmNlSWQgPT09IFwic3RyaW5nXCJcbiAgICAmJiBBcnJheS5pc0FycmF5KHJlY29yZC5pbmZsaWdodEpvYklkcylcbiAgICAmJiByZWNvcmQuaW5mbGlnaHRKb2JJZHMubGVuZ3RoIDw9IFBPT0xFRF9SVU5ORVJfSU5GTElHSFRfSk9CX0lEX0xJTUlUXG4gICAgJiYgcmVjb3JkLmluZmxpZ2h0Sm9iSWRzLmV2ZXJ5KChqb2JJZCkgPT4gdHlwZW9mIGpvYklkID09PSBcInN0cmluZ1wiKVxuICAgICYmIE51bWJlci5pc0ludGVnZXIocmVjb3JkLmluZmxpZ2h0Sm9iSWRzVHJ1bmNhdGVkQ291bnQpXG4gICAgJiYgcmVjb3JkLmluZmxpZ2h0Sm9iSWRzVHJ1bmNhdGVkQ291bnQgPj0gMFxuICAgICYmIGlzUG9vbGVkQ2hpbGRTaHV0ZG93blJlYXNvbihyZWNvcmQucmVhc29uKVxuICAgICYmIHR5cGVvZiByZWNvcmQuc2h1dGRvd25PYnNlcnZlZEF0TXMgPT09IFwibnVtYmVyXCJcbiAgICAmJiBOdW1iZXIuaXNGaW5pdGUocmVjb3JkLnNodXRkb3duT2JzZXJ2ZWRBdE1zKVxuICAgICYmIChyZWNvcmQuc2h1dGRvd25SZXF1ZXN0ZWRBdE1zID09PSBudWxsIHx8ICh0eXBlb2YgcmVjb3JkLnNodXRkb3duUmVxdWVzdGVkQXRNcyA9PT0gXCJudW1iZXJcIiAmJiBOdW1iZXIuaXNGaW5pdGUocmVjb3JkLnNodXRkb3duUmVxdWVzdGVkQXRNcykpKVxuICAgICYmIGlzUG9vbGVkQ2hpbGRTaHV0ZG93blNpZ25hbChyZWNvcmQuc2lnbmFsKVxufVxuXG4vKipcbiAqIE5vcm1hbGl6ZXMgYSBjYW5kaWRhdGUgcG9vbGVkLXJ1bm5lciByZXNvdXJjZSBsaW1pdC5cbiAqIEBwYXJhbSB7bnVtYmVyIHwgdW5kZWZpbmVkfSB2YWx1ZSAtIENhbmRpZGF0ZSBwb3NpdGl2ZSBudW1iZXIuXG4gKiBAcmV0dXJucyB7bnVtYmVyIHwgdW5kZWZpbmVkfSAtIE5vcm1hbGl6ZWQgdmFsdWUuXG4gKi9cbmZ1bmN0aW9uIHBvc2l0aXZlTnVtYmVyKHZhbHVlKSB7XG4gIHJldHVybiB0eXBlb2YgdmFsdWUgPT09IFwibnVtYmVyXCIgJiYgTnVtYmVyLmlzRmluaXRlKHZhbHVlKSAmJiB2YWx1ZSA+IDAgPyB2YWx1ZSA6IHVuZGVmaW5lZFxufVxuXG5leHBvcnQgZGVmYXVsdCBjbGFzcyBCYWNrZ3JvdW5kSm9ic1dvcmtlciB7XG4gIC8qKlxuICAgKiBSdW5zIGNvbnN0cnVjdG9yLlxuICAgKiBAcGFyYW0ge29iamVjdH0gW2FyZ3NdIC0gT3B0aW9ucy5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9jb25maWd1cmF0aW9uLmpzXCIpLmRlZmF1bHR9IFthcmdzLmNvbmZpZ3VyYXRpb25dIC0gQ29uZmlndXJhdGlvbi5cbiAgICogQHBhcmFtIHtzdHJpbmd9IFthcmdzLmhvc3RdIC0gSG9zdG5hbWUuXG4gICAqIEBwYXJhbSB7bnVtYmVyfSBbYXJncy5wb3J0XSAtIFBvcnQuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBbYXJncy5nZW5lcmF0aW9uSWRdIC0gRXhwbGljaXQgcmVsZWFzZSBnZW5lcmF0aW9uIGlkZW50aXR5LlxuICAgKiBAcGFyYW0ge3N0cmluZ30gW2FyZ3Mud29ya2VySW5zdGFuY2VJZF0gLSBFeHBsaWNpdCBzdGFibGUgd29ya2VyIFVVSUQuXG4gICAqIEBwYXJhbSB7bnVtYmVyfSBbYXJncy5tYXhDb25jdXJyZW50Rm9ya2VkSm9ic10gLSBPdmVycmlkZSB0aGUgcHJvY2VzcyBydW5uZXIgY29uY3VycmVuY3kgY2FwIGZyb20gYGNvbmZpZ3VyYXRpb24uZ2V0QmFja2dyb3VuZEpvYnNDb25maWcoKWAuXG4gICAqIEBwYXJhbSB7bnVtYmVyfSBbYXJncy5tYXhDb25jdXJyZW50SW5saW5lSm9ic10gLSBPdmVycmlkZSB0aGUgaW5saW5lLWpvYiBjb25jdXJyZW5jeSBjYXAgZnJvbSBgY29uZmlndXJhdGlvbi5nZXRCYWNrZ3JvdW5kSm9ic0NvbmZpZygpYC5cbiAgICogQHBhcmFtIHtudW1iZXJ9IFthcmdzLnBvb2xlZFJ1bm5lckNvdW50XSAtIE92ZXJyaWRlIHRoZSBwb29sZWQgcnVubmVyIGNvdW50LlxuICAgKiBAcGFyYW0ge251bWJlcn0gW2FyZ3MucG9vbGVkUnVubmVyQ29uY3VycmVuY3ldIC0gT3ZlcnJpZGUgdGhlIHBlci1ydW5uZXIgY29uY3VycmVuY3kuXG4gICAqIEBwYXJhbSB7bnVtYmVyfSBbYXJncy5wb29sZWRSdW5uZXJNYXhKb2JzXSAtIE92ZXJyaWRlIHRoZSBwZXItcnVubmVyIHJlY3ljbGUgam9iIGNvdW50LlxuICAgKiBAcGFyYW0ge251bWJlcn0gW2FyZ3MucG9vbGVkUnVubmVyTWF4UnNzQnl0ZXNdIC0gT3ZlcnJpZGUgdGhlIHBlci1ydW5uZXIgcmVjeWNsZSBSU1MgbGltaXQuXG4gICAqIEBwYXJhbSB7bnVtYmVyfSBbYXJncy5wb29sZWRSdW5uZXJNYXhMaWZldGltZU1zXSAtIE92ZXJyaWRlIHRoZSBwZXItcnVubmVyIHJlY3ljbGUgbGlmZXRpbWUuXG4gICAqIEBwYXJhbSB7bnVtYmVyfSBbYXJncy5mb3JrZWRDaGlsZFNpZ2tpbGxHcmFjZU1zXSAtIE92ZXJyaWRlIHRoZSBncmFjZSBwZXJpb2QgYmV0d2VlbiBTSUdURVJNIGFuZCBTSUdLSUxMIHdoZW4gcmVhcGluZyBsaW5nZXJpbmcgcHJvY2VzcyBydW5uZXJzIG9uIHN0b3AuXG4gICAqIEBwYXJhbSB7bnVtYmVyfSBbYXJncy5oZWFydGJlYXRJbnRlcnZhbE1zXSAtIE92ZXJyaWRlIHRoZSBsaXZlbmVzcyBoZWFydGJlYXQgaW50ZXJ2YWwgKGRlZmF1bHQgMTUwMDBtcykuXG4gICAqIEBwYXJhbSB7bnVtYmVyfSBbYXJncy5nZW5lcmF0aW9uSGFuZHNoYWtlVGltZW91dE1zXSAtIE1heGltdW0gdGltZSB0byB3YWl0IGZvciBnZW5lcmF0aW9uIGFja25vd2xlZGdlbWVudCAoZGVmYXVsdDogNDAwMCkuXG4gICAqIEBwYXJhbSB7bnVtYmVyfSBbYXJncy5yZWNvbm5lY3REZWxheU1zXSAtIERlbGF5IGJlZm9yZSByZWNvbm5lY3RpbmcgYW4gZXN0YWJsaXNoZWQgd29ya2VyIGNvbm5lY3Rpb24gKGRlZmF1bHQ6IDEwMDApLlxuICAgKiBAcGFyYW0ge251bWJlcn0gW2FyZ3Muam9iVGltZW91dE1zXSAtIE92ZXJyaWRlIHRoZSB3YWxsLWNsb2NrIHRpbWVvdXQgZm9yIGZvcmtlZCBhbmQgcG9vbGVkIGpvYnMgZnJvbSBgY29uZmlndXJhdGlvbi5nZXRCYWNrZ3JvdW5kSm9ic0NvbmZpZygpYC4gYDBgIGRpc2FibGVzIGl0LlxuICAgKiBAcGFyYW0ge2Jvb2xlYW59IFthcmdzLmNsb3NlRGF0YWJhc2VDb25uZWN0aW9uc09uU3RvcF0gLSBXaGV0aGVyIHN0b3Agb3ducyBjbG9zaW5nIHRoZSBjb25maWd1cmF0aW9uJ3MgZGF0YWJhc2UgcG9vbHMgKGRlZmF1bHQgdHJ1ZSkuXG4gICAqIEBwYXJhbSB7KCkgPT4gdm9pZCB8IFByb21pc2U8dm9pZD59IFthcmdzLm9uU3RvcHBlZF0gLSBMaWZlY3ljbGUgaG9vayBpbnZva2VkIGFmdGVyIHRoZSB3b3JrZXIgZmluaXNoZXMgc3RvcHBpbmcuXG4gICAqIEBwYXJhbSB7KCkgPT4gdm9pZH0gW2FyZ3Mub25HZW5lcmF0aW9uQWNjZXB0ZWRdIC0gRXhwbGljaXQgZ2VuZXJhdGlvbi1hY2NlcHRhbmNlIG9ic2VydmF0aW9uIGhvb2suXG4gICAqIEBwYXJhbSB7KCkgPT4gdm9pZH0gW2FyZ3Mub25SZXRpcmVNZXNzYWdlXSAtIEV4cGxpY2l0IHJldGlyZS1tZXNzYWdlIG9ic2VydmF0aW9uIGhvb2suXG4gICAqL1xuICBjb25zdHJ1Y3Rvcih7Y29uZmlndXJhdGlvbiwgaG9zdCwgcG9ydCwgZ2VuZXJhdGlvbklkLCB3b3JrZXJJbnN0YW5jZUlkLCBtYXhDb25jdXJyZW50Rm9ya2VkSm9icywgbWF4Q29uY3VycmVudElubGluZUpvYnMsIHBvb2xlZFJ1bm5lckNvdW50LCBwb29sZWRSdW5uZXJDb25jdXJyZW5jeSwgcG9vbGVkUnVubmVyTWF4Sm9icywgcG9vbGVkUnVubmVyTWF4UnNzQnl0ZXMsIHBvb2xlZFJ1bm5lck1heExpZmV0aW1lTXMsIGZvcmtlZENoaWxkU2lna2lsbEdyYWNlTXMsIGhlYXJ0YmVhdEludGVydmFsTXMsIGdlbmVyYXRpb25IYW5kc2hha2VUaW1lb3V0TXMgPSBERUZBVUxUX0dFTkVSQVRJT05fSEFORFNIQUtFX1RJTUVPVVRfTVMsIHJlY29ubmVjdERlbGF5TXMgPSAxMDAwLCBqb2JUaW1lb3V0TXMsIGNsb3NlRGF0YWJhc2VDb25uZWN0aW9uc09uU3RvcCA9IHRydWUsIG9uU3RvcHBlZCwgb25HZW5lcmF0aW9uQWNjZXB0ZWQsIG9uUmV0aXJlTWVzc2FnZX0gPSB7fSkge1xuICAgIC8qKlxuICAgICAqIE5hcnJvd3MgdGhlIHJ1bnRpbWUgdmFsdWUgdG8gdGhlIGRvY3VtZW50ZWQgdHlwZS5cbiAgICAgKiBAdHlwZSB7UHJvbWlzZTxpbXBvcnQoXCIuLi9jb25maWd1cmF0aW9uLmpzXCIpLmRlZmF1bHQ+fSAqL1xuICAgIHRoaXMuY29uZmlndXJhdGlvblByb21pc2UgPSBjb25maWd1cmF0aW9uID8gUHJvbWlzZS5yZXNvbHZlKGNvbmZpZ3VyYXRpb24pIDogY29uZmlndXJhdGlvblJlc29sdmVyKClcbiAgICAvKipcbiAgICAgKiBOYXJyb3dzIHRoZSBydW50aW1lIHZhbHVlIHRvIHRoZSBkb2N1bWVudGVkIHR5cGUuXG4gICAgICogQHR5cGUge2ltcG9ydChcIi4uL2NvbmZpZ3VyYXRpb24uanNcIikuZGVmYXVsdCB8IHVuZGVmaW5lZH0gKi9cbiAgICB0aGlzLmNvbmZpZ3VyYXRpb24gPSB1bmRlZmluZWRcbiAgICB0aGlzLmhvc3QgPSBob3N0XG4gICAgdGhpcy5wb3J0ID0gcG9ydFxuICAgIHRoaXMuZXhwbGljaXRHZW5lcmF0aW9uSWQgPSBnZW5lcmF0aW9uSWRcbiAgICB0aGlzLndvcmtlckluc3RhbmNlSWQgPSB3b3JrZXJJbnN0YW5jZUlkIHx8IHJhbmRvbVVVSUQoKVxuICAgIC8qKiBAdHlwZSB7c3RyaW5nIHwgdW5kZWZpbmVkfSAqL1xuICAgIHRoaXMuZ2VuZXJhdGlvbklkID0gdW5kZWZpbmVkXG4gICAgdGhpcy5jbG9zZURhdGFiYXNlQ29ubmVjdGlvbnNPblN0b3AgPSBjbG9zZURhdGFiYXNlQ29ubmVjdGlvbnNPblN0b3BcbiAgICB0aGlzLm9uU3RvcHBlZCA9IG9uU3RvcHBlZFxuICAgIHRoaXMub25HZW5lcmF0aW9uQWNjZXB0ZWQgPSBvbkdlbmVyYXRpb25BY2NlcHRlZFxuICAgIHRoaXMub25SZXRpcmVNZXNzYWdlID0gb25SZXRpcmVNZXNzYWdlXG4gICAgLyoqXG4gICAgICogQ29uc3RydWN0b3Igb3ZlcnJpZGUgZm9yIHRoZSBpbmxpbmUtam9iIGNvbmN1cnJlbmN5IGNhcC4gV2hlbiB1bnNldFxuICAgICAqIHRoZSBjYXAgaXMgcmVhZCBmcm9tIGBjb25maWd1cmF0aW9uLmdldEJhY2tncm91bmRKb2JzQ29uZmlnKClgIGluXG4gICAgICogYHN0YXJ0KClgIChkZWZhdWx0OiA0KS5cbiAgICAgKiBAdHlwZSB7bnVtYmVyIHwgdW5kZWZpbmVkfVxuICAgICAqL1xuICAgIHRoaXMubWF4Q29uY3VycmVudElubGluZUpvYnNPdmVycmlkZSA9IHR5cGVvZiBtYXhDb25jdXJyZW50SW5saW5lSm9icyA9PT0gXCJudW1iZXJcIiAmJiBtYXhDb25jdXJyZW50SW5saW5lSm9icyA+PSAxXG4gICAgICA/IG1heENvbmN1cnJlbnRJbmxpbmVKb2JzXG4gICAgICA6IHVuZGVmaW5lZFxuICAgIC8qKlxuICAgICAqIE5hcnJvd3MgdGhlIHJ1bnRpbWUgdmFsdWUgdG8gdGhlIGRvY3VtZW50ZWQgdHlwZS5cbiAgICAgKiBAdHlwZSB7bnVtYmVyIHwgdW5kZWZpbmVkfSAqL1xuICAgIHRoaXMubWF4Q29uY3VycmVudEZvcmtlZEpvYnNPdmVycmlkZSA9IHR5cGVvZiBtYXhDb25jdXJyZW50Rm9ya2VkSm9icyA9PT0gXCJudW1iZXJcIiAmJiBtYXhDb25jdXJyZW50Rm9ya2VkSm9icyA+PSAxXG4gICAgICA/IG1heENvbmN1cnJlbnRGb3JrZWRKb2JzXG4gICAgICA6IHVuZGVmaW5lZFxuICAgIC8qKlxuICAgICAqIFJlc29sdmVkIGNhcCBmb3IgaW5saW5lLWpvYiBjb25jdXJyZW5jeS4gU2V0IGluIGBzdGFydCgpYDsgZGVmYXVsdHMgdG9cbiAgICAgKiA0IGlmIG5vIGNvbmZpZ3VyYXRpb24gdmFsdWUgaXMgYXZhaWxhYmxlLlxuICAgICAqIEB0eXBlIHtudW1iZXJ9XG4gICAgICovXG4gICAgdGhpcy5tYXhDb25jdXJyZW50SW5saW5lSm9icyA9IHRoaXMubWF4Q29uY3VycmVudElubGluZUpvYnNPdmVycmlkZSB8fCA0XG4gICAgLyoqXG4gICAgICogTmFycm93cyB0aGUgcnVudGltZSB2YWx1ZSB0byB0aGUgZG9jdW1lbnRlZCB0eXBlLlxuICAgICAqIEB0eXBlIHtudW1iZXJ9ICovXG4gICAgdGhpcy5tYXhDb25jdXJyZW50Rm9ya2VkSm9icyA9IHRoaXMubWF4Q29uY3VycmVudEZvcmtlZEpvYnNPdmVycmlkZSB8fCA0XG4gICAgdGhpcy5wb29sZWRSdW5uZXJDb3VudE92ZXJyaWRlID0gcG9zaXRpdmVJbnRlZ2VyKHBvb2xlZFJ1bm5lckNvdW50KVxuICAgIHRoaXMucG9vbGVkUnVubmVyQ29uY3VycmVuY3lPdmVycmlkZSA9IHBvc2l0aXZlSW50ZWdlcihwb29sZWRSdW5uZXJDb25jdXJyZW5jeSlcbiAgICB0aGlzLnBvb2xlZFJ1bm5lck1heEpvYnNPdmVycmlkZSA9IHBvc2l0aXZlSW50ZWdlcihwb29sZWRSdW5uZXJNYXhKb2JzKVxuICAgIHRoaXMucG9vbGVkUnVubmVyTWF4UnNzQnl0ZXNPdmVycmlkZSA9IHBvc2l0aXZlTnVtYmVyKHBvb2xlZFJ1bm5lck1heFJzc0J5dGVzKVxuICAgIHRoaXMucG9vbGVkUnVubmVyTWF4TGlmZXRpbWVNc092ZXJyaWRlID0gcG9zaXRpdmVOdW1iZXIocG9vbGVkUnVubmVyTWF4TGlmZXRpbWVNcylcbiAgICB0aGlzLnBvb2xlZFJ1bm5lckNvdW50ID0gdGhpcy5wb29sZWRSdW5uZXJDb3VudE92ZXJyaWRlIHx8IDRcbiAgICB0aGlzLnBvb2xlZFJ1bm5lckNvbmN1cnJlbmN5ID0gdGhpcy5wb29sZWRSdW5uZXJDb25jdXJyZW5jeU92ZXJyaWRlIHx8IDFcbiAgICB0aGlzLnBvb2xlZFJ1bm5lck1heEpvYnMgPSB0aGlzLnBvb2xlZFJ1bm5lck1heEpvYnNPdmVycmlkZSB8fCAxMDBcbiAgICB0aGlzLnBvb2xlZFJ1bm5lck1heFJzc0J5dGVzID0gdGhpcy5wb29sZWRSdW5uZXJNYXhSc3NCeXRlc092ZXJyaWRlIHx8IDUxMiAqIDEwMjQgKiAxMDI0XG4gICAgdGhpcy5wb29sZWRSdW5uZXJNYXhMaWZldGltZU1zID0gdGhpcy5wb29sZWRSdW5uZXJNYXhMaWZldGltZU1zT3ZlcnJpZGUgfHwgNjAgKiA2MCAqIDEwMDBcbiAgICAvKipcbiAgICAgKiBHcmFjZSBwZXJpb2QgYmV0d2VlbiBTSUdURVJNIGFuZCBTSUdLSUxMIHdoZW4gcmVhcGluZyBwcm9jZXNzIHJ1bm5lcnMgdGhhdFxuICAgICAqIG91dGxhc3QgYSBib3VuZGVkIHNodXRkb3duIGRyYWluLlxuICAgICAqIEB0eXBlIHtudW1iZXJ9XG4gICAgICovXG4gICAgdGhpcy5mb3JrZWRDaGlsZFNpZ2tpbGxHcmFjZU1zID0gdHlwZW9mIGZvcmtlZENoaWxkU2lna2lsbEdyYWNlTXMgPT09IFwibnVtYmVyXCIgJiYgZm9ya2VkQ2hpbGRTaWdraWxsR3JhY2VNcyA+PSAwXG4gICAgICA/IGZvcmtlZENoaWxkU2lna2lsbEdyYWNlTXNcbiAgICAgIDogRk9SS0VEX0NISUxEX1NJR0tJTExfR1JBQ0VfTVNcbiAgICAvKipcbiAgICAgKiBDb25zdHJ1Y3RvciBvdmVycmlkZSBmb3IgdGhlIGZvcmtlZCBhbmQgcG9vbGVkIHdhbGwtY2xvY2sgam9iIHRpbWVvdXQuIFdoZW4gdW5zZXQgdGhlXG4gICAgICogdGltZW91dCBpcyByZWFkIGZyb20gYGNvbmZpZ3VyYXRpb24uZ2V0QmFja2dyb3VuZEpvYnNDb25maWcoKS5qb2JUaW1lb3V0TXNgXG4gICAgICogYXQgZm9yayB0aW1lIChkZWZhdWx0OiBkaXNhYmxlZCkuXG4gICAgICogQHR5cGUge251bWJlciB8IHVuZGVmaW5lZH1cbiAgICAgKi9cbiAgICB0aGlzLmpvYlRpbWVvdXRNc092ZXJyaWRlID0gdHlwZW9mIGpvYlRpbWVvdXRNcyA9PT0gXCJudW1iZXJcIiA/IGpvYlRpbWVvdXRNcyA6IHVuZGVmaW5lZFxuICAgIHRoaXMuc2hvdWxkU3RvcCA9IGZhbHNlXG4gICAgdGhpcy5pc1JldGlyaW5nID0gZmFsc2VcbiAgICAvKiogQHR5cGUge1Byb21pc2U8dm9pZD4gfCB1bmRlZmluZWR9ICovXG4gICAgdGhpcy5zdG9wUHJvbWlzZSA9IHVuZGVmaW5lZFxuICAgIC8qKlxuICAgICAqIFJlc29sdmVzIHN0b3Agb2JzZXJ2YXRpb24uXG4gICAgICogQHR5cGUgeyh2YWx1ZT86IHZvaWQpID0+IHZvaWR9XG4gICAgICovXG4gICAgdGhpcy5fcmVzb2x2ZVN0b3BwZWQgPSAoKSA9PiB7fVxuICAgIC8qKlxuICAgICAqIFJlamVjdHMgc3RvcCBvYnNlcnZhdGlvbi5cbiAgICAgKiBAdHlwZSB7KGVycm9yOiBFcnJvcikgPT4gdm9pZH1cbiAgICAgKi9cbiAgICB0aGlzLl9yZWplY3RTdG9wcGVkID0gKCkgPT4ge31cbiAgICAvKiogQHR5cGUge1Byb21pc2U8dm9pZD59ICovXG4gICAgdGhpcy5fc3RvcHBlZFByb21pc2UgPSBQcm9taXNlLnJlc29sdmUoKVxuICAgIHRoaXMuX3Jlc2V0U3RvcHBlZFByb21pc2UoKVxuICAgIHRoaXMud29ya2VySWQgPSB0aGlzLndvcmtlckluc3RhbmNlSWRcbiAgICB0aGlzLl9nZW5lcmF0aW9uQWNjZXB0ZWQgPSBmYWxzZVxuICAgIHRoaXMuZ2VuZXJhdGlvbkhhbmRzaGFrZVRpbWVvdXRNcyA9IHZhbGlkYXRlR2VuZXJhdGlvbkhhbmRzaGFrZVRpbWVvdXRNcyhnZW5lcmF0aW9uSGFuZHNoYWtlVGltZW91dE1zKVxuICAgIGlmICghTnVtYmVyLmlzSW50ZWdlcihyZWNvbm5lY3REZWxheU1zKSB8fCByZWNvbm5lY3REZWxheU1zIDwgMCB8fCByZWNvbm5lY3REZWxheU1zID4gTUFYX0ZPUktFRF9KT0JfVElNRU9VVF9NUykge1xuICAgICAgdGhyb3cgbmV3IFR5cGVFcnJvcihcInJlY29ubmVjdERlbGF5TXMgbXVzdCBiZSBhbiBpbnRlZ2VyIGJldHdlZW4gMCBhbmQgMjE0NzQ4MzY0N1wiKVxuICAgIH1cbiAgICB0aGlzLnJlY29ubmVjdERlbGF5TXMgPSByZWNvbm5lY3REZWxheU1zXG4gICAgLyoqIEB0eXBlIHtSZXR1cm5UeXBlPHR5cGVvZiBzZXRUaW1lb3V0PiB8IHVuZGVmaW5lZH0gKi9cbiAgICB0aGlzLl9yZWNvbm5lY3RUaW1lciA9IHVuZGVmaW5lZFxuICAgIHRoaXMuaGVhcnRiZWF0SW50ZXJ2YWxNcyA9IHR5cGVvZiBoZWFydGJlYXRJbnRlcnZhbE1zID09PSBcIm51bWJlclwiICYmIGhlYXJ0YmVhdEludGVydmFsTXMgPj0gMVxuICAgICAgPyBoZWFydGJlYXRJbnRlcnZhbE1zXG4gICAgICA6IEhFQVJUQkVBVF9JTlRFUlZBTF9NU1xuICAgIC8qKlxuICAgICAqIE5hcnJvd3MgdGhlIHJ1bnRpbWUgdmFsdWUgdG8gdGhlIGRvY3VtZW50ZWQgdHlwZS5cbiAgICAgKiBAdHlwZSB7UmV0dXJuVHlwZTx0eXBlb2Ygc2V0SW50ZXJ2YWw+IHwgdW5kZWZpbmVkfSAqL1xuICAgIHRoaXMuX2hlYXJ0YmVhdFRpbWVyID0gdW5kZWZpbmVkXG4gICAgLyoqXG4gICAgICogSW4tZmxpZ2h0IGpvYi1yZXN1bHQgcmVwb3J0cyB0byB0aGUgbWFpbi4gUmVwb3J0aW5nIGlzIGRlY291cGxlZCBmcm9tIHRoZVxuICAgICAqIGpvYi9jaGlsZCBzbG90IChmcmVlaW5nIHRoZSBzbG90IG5ldmVyIHdhaXRzIG9uIGEgcmVwb3J0KSBhbmQgcmV0cmllZFxuICAgICAqIGR1cmFibHksIHNvIGEgdHJhbnNpZW50IG1haW4vREIgb3V0YWdlIGNhbm5vdCBsZWFrIHNsb3RzIG9yIGxvc2UgYVxuICAgICAqIHRlcm1pbmFsIHJlcG9ydC4gVHJhY2tlZCBzbyBhIGdyYWNlZnVsIGBzdG9wKClgIGNhbiBkcmFpbiB0aGVtLlxuICAgICAqIEB0eXBlIHtTZXQ8UHJvbWlzZTx2b2lkPj59XG4gICAgICovXG4gICAgdGhpcy5pbmZsaWdodFJlcG9ydHMgPSBuZXcgU2V0KClcbiAgICAvKipcbiAgICAgKiBOYXJyb3dzIHRoZSBydW50aW1lIHZhbHVlIHRvIHRoZSBkb2N1bWVudGVkIHR5cGUuXG4gICAgICogQHR5cGUge0pzb25Tb2NrZXQgfCB1bmRlZmluZWR9ICovXG4gICAgdGhpcy5qc29uU29ja2V0ID0gdW5kZWZpbmVkXG4gICAgLyoqXG4gICAgICogTmFycm93cyB0aGUgcnVudGltZSB2YWx1ZSB0byB0aGUgZG9jdW1lbnRlZCB0eXBlLlxuICAgICAqIEB0eXBlIHtCYWNrZ3JvdW5kSm9ic1N0YXR1c1JlcG9ydGVyIHwgdW5kZWZpbmVkfSAqL1xuICAgIHRoaXMuc3RhdHVzUmVwb3J0ZXIgPSB1bmRlZmluZWRcbiAgICAvKipcbiAgICAgKiBVcCB0byBgdGhpcy5tYXhDb25jdXJyZW50SW5saW5lSm9ic2Agb2YgdGhlc2UgcnVuIGluIHBhcmFsbGVsLiBUaGV5XG4gICAgICogc2hhcmUgdGhlIHdvcmtlcidzIHByb2Nlc3MgYW5kIERCIGNvbm5lY3Rpb24gcG9vbCwgc28gY29uY3VycmVuY3kgaXNcbiAgICAgKiBhYm91dCBvdmVybGFwcGluZyBJL08gd2FpdHMg4oCUIHVzZSBmb3JraW5nIGZvciBtZW1vcnkgaXNvbGF0aW9uIGFjcm9zc1xuICAgICAqIGxvbmctcnVubmluZyBqb2JzIGFuZCBmb3IgdXNpbmcgbW9yZSBjb3Jlcy5cbiAgICAgKiBAdHlwZSB7U2V0PFByb21pc2U8dm9pZD4+fVxuICAgICAqL1xuICAgIHRoaXMuaW5mbGlnaHRJbmxpbmVKb2JzID0gbmV3IFNldCgpXG4gICAgLyoqXG4gICAgICogSW4tZmxpZ2h0IHByb2Nlc3MgcnVubmVyIGV4aXQgcHJvbWlzZXMuIFRyYWNrZWQgc28gcHJvY2Vzcy1qb2IgaGFuZG9mZlxuICAgICAqIHN0YXlzIGJvdW5kZWQgd2hpbGUgcnVubmluZyBhbmQgc28gYSBncmFjZWZ1bCBgc3RvcCgpYCBjYW4gZHJhaW4gdGhlbS5cbiAgICAgKiBAdHlwZSB7U2V0PFByb21pc2U8dm9pZD4+fVxuICAgICAqL1xuICAgIHRoaXMuaW5mbGlnaHRQcm9jZXNzSm9icyA9IG5ldyBTZXQoKVxuICAgIC8qKlxuICAgICAqIExpdmUgcHJvY2VzcyBydW5uZXIgY2hpbGQgcHJvY2Vzc2VzLCBrZXB0IHNvIGEgZ3JhY2VmdWwgYHN0b3AoKWAgY2FuXG4gICAgICogdGVybWluYXRlIGFueSB0aGF0IG91dGxhc3QgdGhlIHNodXRkb3duIGRyYWluIGluc3RlYWQgb2Ygb3JwaGFuaW5nIHRoZW1cbiAgICAgKiBhY3Jvc3MgYSBkZXBsb3kgKHdoZXJlIHRoZXkgd291bGQga2VlcCBydW5uaW5nIGFnYWluc3QgZGVsZXRlZCByZWxlYXNlXG4gICAgICogY29kZSBhbmQgaG9sZGluZyBkYXRhYmFzZSBjb25uZWN0aW9ucykuXG4gICAgICogQHR5cGUge1NldDxpbXBvcnQoXCJub2RlOmNoaWxkX3Byb2Nlc3NcIikuQ2hpbGRQcm9jZXNzPn1cbiAgICAgKi9cbiAgICB0aGlzLmluZmxpZ2h0UHJvY2Vzc0NoaWxkcmVuID0gbmV3IFNldCgpXG4gICAgLyoqIEB0eXBlIHtTZXQ8UHJvbWlzZTx2b2lkPj59ICovXG4gICAgdGhpcy5pbmZsaWdodFBvb2xlZEpvYnMgPSBuZXcgU2V0KClcbiAgICAvKiogQHR5cGUge01hcDxzdHJpbmcsIEFycmF5PGltcG9ydChcIi4vdHlwZXMuanNcIikuQmFja2dyb3VuZEpvYlBheWxvYWQgJiB7aWQ6IHN0cmluZ30+Pn0gKi9cbiAgICB0aGlzLnBvb2xlZEpvYlF1ZXVlcyA9IG5ldyBNYXAoKVxuICAgIC8qKiBAdHlwZSB7TWFwPHN0cmluZywgUHJvbWlzZTx2b2lkPj59IC0gUGVyLWlkIG91dGVyIHF1ZXVlIHRyYWNrZXJzLiAqL1xuICAgIHRoaXMucG9vbGVkSm9iUXVldWVUcmFja2VycyA9IG5ldyBNYXAoKVxuICAgIC8qKiBAdHlwZSB7U2V0PGltcG9ydChcIm5vZGU6Y2hpbGRfcHJvY2Vzc1wiKS5DaGlsZFByb2Nlc3M+fSAqL1xuICAgIHRoaXMucG9vbGVkQ2hpbGRyZW4gPSBuZXcgU2V0KClcbiAgICAvKiogQHR5cGUge01hcDxpbXBvcnQoXCJub2RlOmNoaWxkX3Byb2Nlc3NcIikuQ2hpbGRQcm9jZXNzLCBQb29sZWRDaGlsZFN0YXRlPn0gKi9cbiAgICB0aGlzLnBvb2xlZENoaWxkU3RhdGVzID0gbmV3IE1hcCgpXG4gICAgLyoqIEB0eXBlIHtXZWFrU2V0PFByb21pc2U8dm9pZD4+fSAqL1xuICAgIHRoaXMuX3Bvb2xlZFN0YXJ0dXBGYWlsdXJlSm9icyA9IG5ldyBXZWFrU2V0KClcbiAgICAvLyBNb25vdG9uaWMgZGlzcGF0Y2ggY291bnRlciBmb3Igcm91bmQtcm9iaW4gY2hpbGQgc2VsZWN0aW9uOiBlYWNoIGRpc3BhdGNoIHN0YW1wc1xuICAgIC8vIHRoZSBjaG9zZW4gY2hpbGQsIGFuZCBzZWxlY3Rpb24gcHJlZmVycyB0aGUgY2hpbGQgZGlzcGF0Y2hlZCBsZWFzdCByZWNlbnRseS5cbiAgICB0aGlzLl9wb29sZWREaXNwYXRjaFNlcSA9IDBcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHN0YXJ0LlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyB3aGVuIGNvbm5lY3RlZC5cbiAgICovXG4gIGFzeW5jIHN0YXJ0KCkge1xuICAgIHRoaXMuc2hvdWxkU3RvcCA9IGZhbHNlXG4gICAgdGhpcy5pc1JldGlyaW5nID0gZmFsc2VcbiAgICB0aGlzLnN0b3BQcm9taXNlID0gdW5kZWZpbmVkXG4gICAgdGhpcy5fcmVzZXRTdG9wcGVkUHJvbWlzZSgpXG4gICAgdGhpcy5jb25maWd1cmF0aW9uID0gYXdhaXQgdGhpcy5jb25maWd1cmF0aW9uUHJvbWlzZVxuICAgIHRoaXMuY29uZmlndXJhdGlvbi5zZXRDdXJyZW50KClcbiAgICBjb25zdCByZXNvbHZlZENvbmZpZyA9IHRoaXMuY29uZmlndXJhdGlvbi5nZXRCYWNrZ3JvdW5kSm9ic0NvbmZpZygpXG4gICAgdGhpcy5nZW5lcmF0aW9uSWQgPSB0aGlzLmNvbmZpZ3VyYXRpb24ucmVzb2x2ZUJhY2tncm91bmRKb2JzR2VuZXJhdGlvbkNvbmZpZyh7XG4gICAgICBnZW5lcmF0aW9uSWQ6IHRoaXMuZXhwbGljaXRHZW5lcmF0aW9uSWQsXG4gICAgICBzb3VyY2VOYW1lOiBcIkJhY2tncm91bmRKb2JzV29ya2VyXCJcbiAgICB9KS5nZW5lcmF0aW9uSWRcbiAgICB0aGlzLndvcmtlcklkID0gdGhpcy5nZW5lcmF0aW9uSWRcbiAgICAgID8gY3JlYXRlR2VuZXJhdGlvbldvcmtlcklkKHtnZW5lcmF0aW9uSWQ6IHRoaXMuZ2VuZXJhdGlvbklkLCB3b3JrZXJJbnN0YW5jZUlkOiB0aGlzLndvcmtlckluc3RhbmNlSWR9KVxuICAgICAgOiB0aGlzLndvcmtlckluc3RhbmNlSWRcbiAgICB0aGlzLmhvc3QgfHw9IHJlc29sdmVkQ29uZmlnLmhvc3RcbiAgICBpZiAodHlwZW9mIHRoaXMucG9ydCAhPT0gXCJudW1iZXJcIikgdGhpcy5wb3J0ID0gcmVzb2x2ZWRDb25maWcucG9ydFxuICAgIGF3YWl0IHRoaXMuY29uZmlndXJhdGlvbi5pbml0aWFsaXplKHt0eXBlOiBcImJhY2tncm91bmQtam9icy13b3JrZXJcIn0pXG4gICAgYXdhaXQgdGhpcy5jb25maWd1cmF0aW9uLmNvbm5lY3RCZWFjb24oe3BlZXJUeXBlOiBcImJhY2tncm91bmQtam9icy13b3JrZXJcIn0pXG5cbiAgICAvLyBDb25zdHJ1Y3RvciBvdmVycmlkZXMgd2luOyBvdGhlcndpc2UgcGljayB1cCB0aGUgY29uZmlndXJlZCBjYXBzLlxuICAgIGlmICh0eXBlb2YgdGhpcy5tYXhDb25jdXJyZW50SW5saW5lSm9ic092ZXJyaWRlICE9PSBcIm51bWJlclwiKSB7XG4gICAgICBjb25zdCBjb25maWcgPSB0aGlzLmNvbmZpZ3VyYXRpb24uZ2V0QmFja2dyb3VuZEpvYnNDb25maWcoKVxuXG4gICAgICB0aGlzLm1heENvbmN1cnJlbnRJbmxpbmVKb2JzID0gY29uZmlnLm1heENvbmN1cnJlbnRJbmxpbmVKb2JzIHx8IHRoaXMubWF4Q29uY3VycmVudElubGluZUpvYnNcbiAgICB9XG4gICAgaWYgKHR5cGVvZiB0aGlzLm1heENvbmN1cnJlbnRGb3JrZWRKb2JzT3ZlcnJpZGUgIT09IFwibnVtYmVyXCIpIHtcbiAgICAgIGNvbnN0IGNvbmZpZyA9IHRoaXMuY29uZmlndXJhdGlvbi5nZXRCYWNrZ3JvdW5kSm9ic0NvbmZpZygpXG5cbiAgICAgIHRoaXMubWF4Q29uY3VycmVudEZvcmtlZEpvYnMgPSBjb25maWcubWF4Q29uY3VycmVudEZvcmtlZEpvYnMgfHwgdGhpcy5tYXhDb25jdXJyZW50Rm9ya2VkSm9ic1xuICAgIH1cbiAgICBjb25zdCBwb29sQ29uZmlnID0gdGhpcy5jb25maWd1cmF0aW9uLmdldEJhY2tncm91bmRKb2JzQ29uZmlnKClcbiAgICBpZiAodHlwZW9mIHRoaXMucG9vbGVkUnVubmVyQ291bnRPdmVycmlkZSAhPT0gXCJudW1iZXJcIikgdGhpcy5wb29sZWRSdW5uZXJDb3VudCA9IHBvb2xDb25maWcucG9vbGVkUnVubmVyQ291bnRcbiAgICBpZiAodHlwZW9mIHRoaXMucG9vbGVkUnVubmVyQ29uY3VycmVuY3lPdmVycmlkZSAhPT0gXCJudW1iZXJcIikgdGhpcy5wb29sZWRSdW5uZXJDb25jdXJyZW5jeSA9IHBvb2xDb25maWcucG9vbGVkUnVubmVyQ29uY3VycmVuY3lcbiAgICBpZiAodHlwZW9mIHRoaXMucG9vbGVkUnVubmVyTWF4Sm9ic092ZXJyaWRlICE9PSBcIm51bWJlclwiKSB0aGlzLnBvb2xlZFJ1bm5lck1heEpvYnMgPSBwb29sQ29uZmlnLnBvb2xlZFJ1bm5lck1heEpvYnNcbiAgICBpZiAodHlwZW9mIHRoaXMucG9vbGVkUnVubmVyTWF4UnNzQnl0ZXNPdmVycmlkZSAhPT0gXCJudW1iZXJcIikgdGhpcy5wb29sZWRSdW5uZXJNYXhSc3NCeXRlcyA9IHBvb2xDb25maWcucG9vbGVkUnVubmVyTWF4UnNzQnl0ZXNcbiAgICBpZiAodHlwZW9mIHRoaXMucG9vbGVkUnVubmVyTWF4TGlmZXRpbWVNc092ZXJyaWRlICE9PSBcIm51bWJlclwiKSB0aGlzLnBvb2xlZFJ1bm5lck1heExpZmV0aW1lTXMgPSBwb29sQ29uZmlnLnBvb2xlZFJ1bm5lck1heExpZmV0aW1lTXNcblxuICAgIHRoaXMuc3RhdHVzUmVwb3J0ZXIgPSBuZXcgQmFja2dyb3VuZEpvYnNTdGF0dXNSZXBvcnRlcih7XG4gICAgICBjb25maWd1cmF0aW9uOiB0aGlzLmNvbmZpZ3VyYXRpb24sXG4gICAgICBob3N0OiB0aGlzLmhvc3QsXG4gICAgICBwb3J0OiB0aGlzLnBvcnQsXG4gICAgICBnZW5lcmF0aW9uSGFuZHNoYWtlVGltZW91dE1zOiB0aGlzLmdlbmVyYXRpb25IYW5kc2hha2VUaW1lb3V0TXMsXG4gICAgICBnZW5lcmF0aW9uSWQ6IHRoaXMuZ2VuZXJhdGlvbklkXG4gICAgfSlcbiAgICB0cnkge1xuICAgICAgYXdhaXQgdGhpcy5fY29ubmVjdCh7YWxsb3dSZWNvbm5lY3Q6IGZhbHNlfSlcbiAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgbGV0IGNsZWFudXBFcnJvclxuXG4gICAgICB0cnkge1xuICAgICAgICBhd2FpdCB0aGlzLnN0b3AoKVxuICAgICAgfSBjYXRjaCAoY2F1Z2h0Q2xlYW51cEVycm9yKSB7XG4gICAgICAgIGNsZWFudXBFcnJvciA9IGNhdWdodENsZWFudXBFcnJvclxuICAgICAgfVxuXG4gICAgICBpZiAoY2xlYW51cEVycm9yKSB7XG4gICAgICAgIHRocm93IG5ldyBBZ2dyZWdhdGVFcnJvcihcbiAgICAgICAgICBbZXJyb3IsIGNsZWFudXBFcnJvcl0sXG4gICAgICAgICAgXCJCYWNrZ3JvdW5kIGpvYnMgd29ya2VyIHN0YXJ0dXAgYW5kIGNsZWFudXAgZmFpbGVkXCIsXG4gICAgICAgICAge2NhdXNlOiBlcnJvcn1cbiAgICAgICAgKVxuICAgICAgfVxuXG4gICAgICB0aHJvdyBlcnJvclxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBHcmFjZWZ1bGx5IHN0b3BzIHRoZSB3b3JrZXI6IGFubm91bmNlcyBkcmFpbmluZyB0byB0aGUgbWFpbiBwcm9jZXNzIHNvXG4gICAqIG5vIG5ldyBqb2JzIGFyZSBkaXNwYXRjaGVkLCB3YWl0cyBmb3IgaW4tZmxpZ2h0IGlubGluZSBqb2JzIGFuZCBwcm9jZXNzXG4gICAqIHJ1bm5lcnMgdG8gZmluaXNoIChzbyB0aGVpciByZXN1bHRzIGNhbiBiZSByZXBvcnRlZCksIHRoZW4gY2xvc2VzIHRoZVxuICAgKiBzb2NrZXQgYW5kIGRpc2Nvbm5lY3RzIGZyb20gdGhlIGJlYWNvbi5cbiAgICpcbiAgICogUHJvY2VzcyBydW5uZXJzIGFyZSBjaGlsZCBwcm9jZXNzZXMuIFdoZW4gYSBgdGltZW91dE1zYCBpcyBnaXZlbiAoZS5nLiBhXG4gICAqIGRlcGxveSBkcmFpbmluZyB0aGUgb2xkIHJlbGVhc2UpIGFueSBydW5uZXIgc3RpbGwgYWxpdmUgYWZ0ZXIgdGhlIGRyYWluXG4gICAqIHdpbmRvdyBpcyB0ZXJtaW5hdGVkIChTSUdURVJNLCB0aGVuIFNJR0tJTEwpIHJhdGhlciB0aGFuIGxlZnQgdG8gb3JwaGFuXG4gICAqIGFjcm9zcyB0aGUgZGVwbG95LiBXaXRoIG5vIGB0aW1lb3V0TXNgIHRoZSBkcmFpbiB3YWl0cyBmb3IgcnVubmVycyB0b1xuICAgKiBmaW5pc2ggb24gdGhlaXIgb3duLlxuICAgKiBAcGFyYW0ge29iamVjdH0gW2FyZ3NdIC0gT3B0aW9ucy5cbiAgICogQHBhcmFtIHtudW1iZXJ9IFthcmdzLnRpbWVvdXRNc10gLSBNYXggd2FpdCBmb3IgaW4tZmxpZ2h0IGpvYnMgKHBlciBwaGFzZSkgaW4gbXMuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIHdoZW4gc3RvcHBlZC5cbiAgICovXG4gIHN0b3Aoe3RpbWVvdXRNc30gPSB7fSkge1xuICAgIGNvbnN0IHN0b3BQcm9taXNlID0gdGhpcy5zdG9wUHJvbWlzZSB8fCB0aGlzLl9zdG9wKHt0aW1lb3V0TXN9KVxuXG4gICAgaWYgKCF0aGlzLnN0b3BQcm9taXNlKSB7XG4gICAgICB0aGlzLnN0b3BQcm9taXNlID0gc3RvcFByb21pc2VcbiAgICAgIHZvaWQgc3RvcFByb21pc2UudGhlbih0aGlzLl9yZXNvbHZlU3RvcHBlZCwgKGVycm9yKSA9PiB7XG4gICAgICAgIHRoaXMuX3JlamVjdFN0b3BwZWQoZXJyb3IgaW5zdGFuY2VvZiBFcnJvciA/IGVycm9yIDogbmV3IEVycm9yKFN0cmluZyhlcnJvcikpKVxuICAgICAgfSlcbiAgICB9XG5cbiAgICByZXR1cm4gc3RvcFByb21pc2VcbiAgfVxuXG4gIC8qKlxuICAgKiBXYWl0cyBmb3IgYXV0b21hdGljIG9yIHJlcXVlc3RlZCBzdG9wLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyB3aGVuIHRoaXMgd29ya2VyIGhhcyBmdWxseSBzdG9wcGVkLlxuICAgKi9cbiAgd2FpdFVudGlsU3RvcHBlZCgpIHsgcmV0dXJuIHRoaXMuX3N0b3BwZWRQcm9taXNlIH1cblxuICAvKiogUmVzZXRzIHRoZSBzdG9wIG9ic2VydmF0aW9uIHByb21pc2UgZm9yIGEgbmV3IHdvcmtlciBzdGFydC4gKi9cbiAgX3Jlc2V0U3RvcHBlZFByb21pc2UoKSB7XG4gICAgdGhpcy5fc3RvcHBlZFByb21pc2UgPSBuZXcgUHJvbWlzZSgocmVzb2x2ZSwgcmVqZWN0KSA9PiB7XG4gICAgICB0aGlzLl9yZXNvbHZlU3RvcHBlZCA9IHJlc29sdmVcbiAgICAgIHRoaXMuX3JlamVjdFN0b3BwZWQgPSByZWplY3RcbiAgICB9KVxuICAgIHZvaWQgdGhpcy5fc3RvcHBlZFByb21pc2UuY2F0Y2goKCkgPT4ge30pXG4gIH1cblxuICAvKipcbiAgICogUnVucyB0aGUgd29ya2VyIHNodXRkb3duIGxpZmVjeWNsZSBvbmNlLlxuICAgKiBAcGFyYW0ge29iamVjdH0gW2FyZ3NdIC0gT3B0aW9ucy5cbiAgICogQHBhcmFtIHtudW1iZXJ9IFthcmdzLnRpbWVvdXRNc10gLSBNYXggd2FpdCBmb3IgaW4tZmxpZ2h0IGpvYnMgKHBlciBwaGFzZSkgaW4gbXMuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIHdoZW4gc3RvcHBlZC5cbiAgICovXG4gIGFzeW5jIF9zdG9wKHt0aW1lb3V0TXN9ID0ge30pIHtcbiAgICB0aGlzLnNob3VsZFN0b3AgPSB0cnVlXG4gICAgdGhpcy5pc1JldGlyaW5nID0gdHJ1ZVxuICAgIHRoaXMuX3N0b3BIZWFydGJlYXQoKVxuICAgIGlmICh0aGlzLl9yZWNvbm5lY3RUaW1lcikge1xuICAgICAgY2xlYXJUaW1lb3V0KHRoaXMuX3JlY29ubmVjdFRpbWVyKVxuICAgICAgdGhpcy5fcmVjb25uZWN0VGltZXIgPSB1bmRlZmluZWRcbiAgICB9XG5cbiAgICBhd2FpdCBzaHV0ZG93bkxpZmVjeWNsZSh7XG4gICAgICBvblN0b3BwZWQ6IHRoaXMub25TdG9wcGVkLFxuICAgICAgc2h1dGRvd246IGFzeW5jICgpID0+IHtcbiAgICAgICAgLy8gQW5ub3VuY2UgZHJhaW4gc28gbWFpbiBzdG9wcyBkaXNwYXRjaGluZyBidXQga2VlcHMgdGhlIGNvbm5lY3Rpb25cbiAgICAgICAgLy8gb3BlbiB1bnRpbCB3ZSBjbG9zZSBpdCBvdXJzZWx2ZXMgYmVsb3cuXG4gICAgICAgIGlmICh0aGlzLmpzb25Tb2NrZXQpIHtcbiAgICAgICAgICB0cnkge1xuICAgICAgICAgICAgdGhpcy5qc29uU29ja2V0LnNlbmQoe3R5cGU6IFwiZHJhaW5pbmdcIn0pXG4gICAgICAgICAgfSBjYXRjaCB7XG4gICAgICAgICAgICAvLyBTb2NrZXQgbWF5IGFscmVhZHkgYmUgY2xvc2luZzsgbm90aGluZyB0byBkby5cbiAgICAgICAgICB9XG4gICAgICAgIH1cblxuICAgICAgICBhd2FpdCB0aGlzLl9kcmFpbkluZmxpZ2h0KHRoaXMuaW5mbGlnaHRJbmxpbmVKb2JzLCB0aW1lb3V0TXMpXG4gICAgICAgIGF3YWl0IHRoaXMuX2RyYWluSW5mbGlnaHQodGhpcy5pbmZsaWdodFBvb2xlZEpvYnMsIHRpbWVvdXRNcylcbiAgICAgICAgYXdhaXQgdGhpcy5fZHJhaW5JbmZsaWdodCh0aGlzLmluZmxpZ2h0UHJvY2Vzc0pvYnMsIHRpbWVvdXRNcylcbiAgICAgICAgYXdhaXQgdGhpcy5fdGVybWluYXRlUHJvY2Vzc0NoaWxkcmVuKClcbiAgICAgICAgLy8gR2l2ZSBpbi1mbGlnaHQgcmVzdWx0IHJlcG9ydHMgKG5vdyBkZWNvdXBsZWQgZnJvbSBqb2Igc2xvdHMpIGEgYm91bmRlZFxuICAgICAgICAvLyBjaGFuY2UgdG8gbGFuZCBiZWZvcmUgdGhlIHNvY2tldCBjbG9zZXMuXG4gICAgICAgIGF3YWl0IHRoaXMuX2RyYWluSW5mbGlnaHQodGhpcy5pbmZsaWdodFJlcG9ydHMsIHRpbWVvdXRNcylcblxuICAgICAgICBpZiAodGhpcy5qc29uU29ja2V0KSB0aGlzLmpzb25Tb2NrZXQuY2xvc2UoKVxuICAgICAgICBpZiAoIXRoaXMuY29uZmlndXJhdGlvbikgcmV0dXJuXG5cbiAgICAgICAgYXdhaXQgdGhpcy5fY2xvc2VDb25maWd1cmF0aW9uKClcbiAgICAgIH1cbiAgICB9KVxuICB9XG5cbiAgLyoqIEJlZ2lucyBnZW5lcmF0aW9uIHJldGlyZW1lbnQgd2l0aG91dCByZXZva2luZyBsaXZlbmVzcyBkdXJpbmcgdGhlIGRyYWluLiAqL1xuICBfYmVnaW5HZW5lcmF0aW9uUmV0aXJlbWVudCgpIHtcbiAgICBpZiAodGhpcy5zdG9wUHJvbWlzZSkgcmV0dXJuXG5cbiAgICB0aGlzLmlzUmV0aXJpbmcgPSB0cnVlXG4gICAgY29uc3Qgc3RvcFByb21pc2UgPSB0aGlzLl9zdG9wQWZ0ZXJHZW5lcmF0aW9uRHJhaW4oKVxuICAgIHRoaXMuc3RvcFByb21pc2UgPSBzdG9wUHJvbWlzZVxuICAgIHZvaWQgc3RvcFByb21pc2UudGhlbih0aGlzLl9yZXNvbHZlU3RvcHBlZCwgKGVycm9yKSA9PiB7XG4gICAgICBjb25zdCBub3JtYWxpemVkRXJyb3IgPSBlcnJvciBpbnN0YW5jZW9mIEVycm9yID8gZXJyb3IgOiBuZXcgRXJyb3IoU3RyaW5nKGVycm9yKSlcblxuICAgICAgdGhpcy5fcmVqZWN0U3RvcHBlZChub3JtYWxpemVkRXJyb3IpXG4gICAgICB0aGlzLl9yZXBvcnRMaWZlY3ljbGVFcnJvcihub3JtYWxpemVkRXJyb3IpXG4gICAgfSlcbiAgfVxuXG4gIC8qKlxuICAgKiBEcmFpbnMgYWNjZXB0ZWQgZ2VuZXJhdGlvbiB3b3JrIHdoaWxlIHJldGFpbmluZyB0aGUgZXhhY3QgY29ubmVjdGlvbiBhbmRcbiAgICogaGVhcnRiZWF0LCB0aGVuIHBlcmZvcm1zIHRoZSBmaW5hbCB0ZXJtaW5hdGluZyBzdG9wLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyBhZnRlciB0aGUgd29ya2VyIGhhcyBmdWxseSBjbG9zZWQuXG4gICAqL1xuICBhc3luYyBfc3RvcEFmdGVyR2VuZXJhdGlvbkRyYWluKCkge1xuICAgIGlmICh0aGlzLmpzb25Tb2NrZXQpIHtcbiAgICAgIHRyeSB7XG4gICAgICAgIHRoaXMuanNvblNvY2tldC5zZW5kKHt0eXBlOiBcImRyYWluaW5nXCJ9KVxuICAgICAgfSBjYXRjaCB7XG4gICAgICAgIC8vIFRoZSBjbG9zZSBoYW5kbGVyIG93bnMgZXhhY3Qgc2FtZS1nZW5lcmF0aW9uIHJlY29ubmVjdC5cbiAgICAgIH1cbiAgICB9XG5cbiAgICBhd2FpdCB0aGlzLl9kcmFpbkluZmxpZ2h0KHRoaXMuaW5mbGlnaHRJbmxpbmVKb2JzKVxuICAgIGF3YWl0IHRoaXMuX2RyYWluSW5mbGlnaHQodGhpcy5pbmZsaWdodFBvb2xlZEpvYnMpXG4gICAgYXdhaXQgdGhpcy5fZHJhaW5JbmZsaWdodCh0aGlzLmluZmxpZ2h0UHJvY2Vzc0pvYnMpXG4gICAgYXdhaXQgdGhpcy5fZHJhaW5JbmZsaWdodCh0aGlzLmluZmxpZ2h0UmVwb3J0cylcblxuICAgIHRoaXMuc2hvdWxkU3RvcCA9IHRydWVcbiAgICB0aGlzLl9zdG9wSGVhcnRiZWF0KClcbiAgICBpZiAodGhpcy5fcmVjb25uZWN0VGltZXIpIHtcbiAgICAgIGNsZWFyVGltZW91dCh0aGlzLl9yZWNvbm5lY3RUaW1lcilcbiAgICAgIHRoaXMuX3JlY29ubmVjdFRpbWVyID0gdW5kZWZpbmVkXG4gICAgfVxuICAgIGF3YWl0IHRoaXMuX3Rlcm1pbmF0ZVByb2Nlc3NDaGlsZHJlbigpXG5cbiAgICBhd2FpdCBzaHV0ZG93bkxpZmVjeWNsZSh7XG4gICAgICBvblN0b3BwZWQ6IHRoaXMub25TdG9wcGVkLFxuICAgICAgc2h1dGRvd246IGFzeW5jICgpID0+IHtcbiAgICAgICAgaWYgKHRoaXMuanNvblNvY2tldCkgdGhpcy5qc29uU29ja2V0LmNsb3NlKClcbiAgICAgICAgaWYgKCF0aGlzLmNvbmZpZ3VyYXRpb24pIHJldHVyblxuXG4gICAgICAgIGF3YWl0IHRoaXMuX2Nsb3NlQ29uZmlndXJhdGlvbigpXG4gICAgICB9XG4gICAgfSlcbiAgfVxuXG4gIC8qKlxuICAgKiBDbG9zZXMgYXBwbGljYXRpb24gcmVzb3VyY2VzIGJlZm9yZSBmcmFtZXdvcmsgcmVzb3VyY2VzIHdoZW4gdGhpcyB3b3JrZXIgb3ducyB0aGVtLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyBhZnRlciBldmVyeSBvd25lZCBjbG9zZSBzdWNjZWVkcy5cbiAgICovXG4gIGFzeW5jIF9jbG9zZUNvbmZpZ3VyYXRpb24oKSB7XG4gICAgY29uc3QgY29uZmlndXJhdGlvbiA9IHRoaXMuY29uZmlndXJhdGlvblxuXG4gICAgaWYgKCFjb25maWd1cmF0aW9uKSByZXR1cm5cblxuICAgIGF3YWl0IHJ1blNodXRkb3duU3RlcHMoe1xuICAgICAgbWVzc2FnZTogXCJCYWNrZ3JvdW5kIGpvYnMgd29ya2VyIGFwcGxpY2F0aW9uIGFuZCBmcmFtZXdvcmsgc2h1dGRvd24gZmFpbGVkXCIsXG4gICAgICBzdGVwczogW1xuICAgICAgICAuLi4odGhpcy5jbG9zZURhdGFiYXNlQ29ubmVjdGlvbnNPblN0b3BcbiAgICAgICAgICA/IFthc3luYyAoKSA9PiBhd2FpdCBjb25maWd1cmF0aW9uLnNodXRkb3duKCldXG4gICAgICAgICAgOiBbXSksXG4gICAgICAgIGFzeW5jICgpID0+IGF3YWl0IGNvbmZpZ3VyYXRpb24uZGlzY29ubmVjdEJlYWNvbigpLFxuICAgICAgICAuLi4odGhpcy5jbG9zZURhdGFiYXNlQ29ubmVjdGlvbnNPblN0b3BcbiAgICAgICAgICA/IFthc3luYyAoKSA9PiBhd2FpdCBjb25maWd1cmF0aW9uLmNsb3NlRGF0YWJhc2VDb25uZWN0aW9ucygpXVxuICAgICAgICAgIDogW10pXG4gICAgICBdXG4gICAgfSlcbiAgfVxuXG4gIC8qKlxuICAgKiBXYWl0cyBmb3IgYSBzZXQgb2YgaW4tZmxpZ2h0IGpvYiBwcm9taXNlcyB0byBzZXR0bGUsIG9wdGlvbmFsbHkgYm91bmRlZCBieVxuICAgKiBgdGltZW91dE1zYC5cbiAgICogQHBhcmFtIHtTZXQ8UHJvbWlzZTx2b2lkPj59IGluZmxpZ2h0IC0gSW4tZmxpZ2h0IGpvYiBwcm9taXNlcy5cbiAgICogQHBhcmFtIHtudW1iZXJ9IFt0aW1lb3V0TXNdIC0gTWF4IHdhaXQgaW4gbXM7IHVuYm91bmRlZCB3aGVuIG9taXR0ZWQuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIHdoZW4gc2V0dGxlZCBvciB0aGUgdGltZW91dCBlbGFwc2VzLlxuICAgKi9cbiAgYXN5bmMgX2RyYWluSW5mbGlnaHQoaW5mbGlnaHQsIHRpbWVvdXRNcykge1xuICAgIGlmIChpbmZsaWdodC5zaXplID09PSAwKSByZXR1cm5cblxuICAgIGNvbnN0IGRyYWluID0gUHJvbWlzZS5hbGxTZXR0bGVkKFsuLi5pbmZsaWdodF0pXG5cbiAgICBpZiAodHlwZW9mIHRpbWVvdXRNcyA9PT0gXCJudW1iZXJcIiAmJiB0aW1lb3V0TXMgPj0gMCkge1xuICAgICAgbGV0IHRpbWVyXG4gICAgICBjb25zdCB0aW1lb3V0ID0gbmV3IFByb21pc2UoKHJlc29sdmUpID0+IHsgdGltZXIgPSBzZXRUaW1lb3V0KHJlc29sdmUsIHRpbWVvdXRNcykgfSlcblxuICAgICAgYXdhaXQgUHJvbWlzZS5yYWNlKFtkcmFpbiwgdGltZW91dF0pXG4gICAgICBjbGVhclRpbWVvdXQodGltZXIpXG4gICAgfSBlbHNlIHtcbiAgICAgIGF3YWl0IGRyYWluXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIFRlcm1pbmF0ZXMgYW55IHByb2Nlc3MgcnVubmVyIGNoaWxkcmVuIHN0aWxsIGFsaXZlIGFmdGVyIHRoZSBkcmFpbiB3aW5kb3cgc29cbiAgICogdGhleSBkb24ndCBvdXRsaXZlIHRoZSB3b3JrZXIgYXMgb3JwaGFucy4gU0lHVEVSTSBsZXRzIHRoZSBydW5uZXIgY2xvc2UgaXRzXG4gICAqIGNvbm5lY3Rpb25zIGNsZWFubHk7IHN1cnZpdm9ycyBhcmUgU0lHS0lMTGVkIGFmdGVyIGEgc2hvcnQgZ3JhY2UuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIG9uY2Ugc3Vydml2b3JzIGhhdmUgYmVlbiBzaWduYWxsZWQuXG4gICAqL1xuICBhc3luYyBfdGVybWluYXRlUHJvY2Vzc0NoaWxkcmVuKCkge1xuICAgIGlmICh0aGlzLmluZmxpZ2h0UHJvY2Vzc0NoaWxkcmVuLnNpemUgPT09IDApIHJldHVyblxuXG4gICAgZm9yIChjb25zdCBjaGlsZCBvZiB0aGlzLmluZmxpZ2h0UHJvY2Vzc0NoaWxkcmVuKSB7XG4gICAgICBjb25zdCBwb29sZWRTdGF0ZSA9IHRoaXMucG9vbGVkQ2hpbGRTdGF0ZXMuZ2V0KGNoaWxkKVxuICAgICAgaWYgKHBvb2xlZFN0YXRlKSB7XG4gICAgICAgIHRoaXMuX3JlcXVlc3RQb29sZWRDaGlsZFNodXRkb3duKHtjaGlsZCwgcmVhc29uOiBcIndvcmtlcl9zdG9wXCIsIHNpZ25hbDogXCJTSUdURVJNXCJ9KVxuICAgICAgfSBlbHNlIHtcbiAgICAgICAgdHJ5IHtcbiAgICAgICAgICBjaGlsZC5raWxsKFwiU0lHVEVSTVwiKVxuICAgICAgICB9IGNhdGNoIHtcbiAgICAgICAgICAvLyBDaGlsZCBhbHJlYWR5IGV4aXRlZDsgbm90aGluZyB0byBkby5cbiAgICAgICAgfVxuICAgICAgfVxuICAgIH1cblxuICAgIGF3YWl0IG5ldyBQcm9taXNlKChyZXNvbHZlKSA9PiBzZXRUaW1lb3V0KHJlc29sdmUsIHRoaXMuZm9ya2VkQ2hpbGRTaWdraWxsR3JhY2VNcykpXG5cbiAgICBmb3IgKGNvbnN0IGNoaWxkIG9mIHRoaXMuaW5mbGlnaHRQcm9jZXNzQ2hpbGRyZW4pIHtcbiAgICAgIHRyeSB7XG4gICAgICAgIGNoaWxkLmtpbGwoXCJTSUdLSUxMXCIpXG4gICAgICB9IGNhdGNoIHtcbiAgICAgICAgLy8gQ2hpbGQgYWxyZWFkeSBleGl0ZWQ7IG5vdGhpbmcgdG8gZG8uXG4gICAgICB9XG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIENvbm5lY3RzIHRvIHRoZSB3b3JrZXIncyByZXNvbHZlZCBlbmRwb2ludCBhbmQgY29tcGxldGVzIGl0cyBoZWxsbyBmZW5jZS5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBSZWNvbm5lY3QgcG9saWN5LlxuICAgKiBAcGFyYW0ge2Jvb2xlYW59IGFyZ3MuYWxsb3dSZWNvbm5lY3QgLSBXaGV0aGVyIGEgZmFpbGVkIGF0dGVtcHQgbWF5IHNjaGVkdWxlIGFub3RoZXIgY29ubmVjdGlvbi5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgYWZ0ZXIgZ2VuZXJhdGlvbiBhY2tub3dsZWRnZW1lbnQuXG4gICAqL1xuICBhc3luYyBfY29ubmVjdCh7YWxsb3dSZWNvbm5lY3R9KSB7XG4gICAgY29uc3QgY29uZmlndXJhdGlvbiA9IHRoaXMuY29uZmlndXJhdGlvblxuICAgIGlmICghY29uZmlndXJhdGlvbikgdGhyb3cgbmV3IEVycm9yKFwiQmFja2dyb3VuZCBqb2JzIHdvcmtlciBjb25maWd1cmF0aW9uIG5vdCBpbml0aWFsaXplZFwiKVxuXG4gICAgY29uc3QgY29uZmlnID0gY29uZmlndXJhdGlvbi5nZXRCYWNrZ3JvdW5kSm9ic0NvbmZpZygpXG4gICAgaWYgKHRoaXMuZ2VuZXJhdGlvbklkKSB0aGlzLl9nZW5lcmF0aW9uQWNjZXB0ZWQgPSBmYWxzZVxuICAgIGNvbnN0IGhvc3QgPSB0aGlzLmhvc3QgfHwgY29uZmlnLmhvc3RcbiAgICBjb25zdCBwb3J0ID0gdHlwZW9mIHRoaXMucG9ydCA9PT0gXCJudW1iZXJcIiA/IHRoaXMucG9ydCA6IGNvbmZpZy5wb3J0XG4gICAgY29uc3Qgc29ja2V0ID0gbmV0LmNyZWF0ZUNvbm5lY3Rpb24oe2hvc3QsIHBvcnR9KVxuICAgIHNvY2tldC5zZXRLZWVwQWxpdmUodHJ1ZSwgU09DS0VUX0tFRVBBTElWRV9NUylcbiAgICBjb25zdCBqc29uU29ja2V0ID0gbmV3IEpzb25Tb2NrZXQoc29ja2V0KVxuICAgIHRoaXMuanNvblNvY2tldCA9IGpzb25Tb2NrZXRcbiAgICAvKipcbiAgICAgKiBSZXNvbHZlcyB0aGUgZ2VuZXJhdGlvbiBoYW5kc2hha2UuXG4gICAgICogQHR5cGUgeygpID0+IHZvaWR9XG4gICAgICovXG4gICAgbGV0IHJlc29sdmVIYW5kc2hha2UgPSAoKSA9PiB7fVxuICAgIC8qKlxuICAgICAqIFJlamVjdHMgdGhlIGdlbmVyYXRpb24gaGFuZHNoYWtlLlxuICAgICAqIEB0eXBlIHsoZXJyb3I6IEVycm9yKSA9PiB2b2lkfVxuICAgICAqL1xuICAgIGxldCByZWplY3RIYW5kc2hha2UgPSAoKSA9PiB7fVxuICAgIGxldCBjb25uZWN0aW9uQWNjZXB0ZWQgPSBmYWxzZVxuICAgIC8qKiBAdHlwZSB7UmV0dXJuVHlwZTx0eXBlb2Ygc2V0VGltZW91dD4gfCB1bmRlZmluZWR9ICovXG4gICAgbGV0IGhhbmRzaGFrZVRpbWVyXG4gICAgY29uc3QgaGFuZHNoYWtlID0gbmV3IFByb21pc2UoKC8qKiBAdHlwZSB7KHZhbHVlOiB2b2lkKSA9PiB2b2lkfSAqLyByZXNvbHZlLCByZWplY3QpID0+IHtcbiAgICAgIHJlc29sdmVIYW5kc2hha2UgPSByZXNvbHZlXG4gICAgICByZWplY3RIYW5kc2hha2UgPSByZWplY3RcbiAgICB9KVxuXG4gICAgLyoqXG4gICAgICogSGFuZGxlcyBhIGJhY2tncm91bmQgam9iIHNvY2tldCBtZXNzYWdlLlxuICAgICAqIEBwYXJhbSB7aW1wb3J0KFwiLi90eXBlcy5qc1wiKS5CYWNrZ3JvdW5kSm9iU29ja2V0TWVzc2FnZX0gbWVzc2FnZSAtIFNvY2tldCBtZXNzYWdlLlxuICAgICAqL1xuICAgIGpzb25Tb2NrZXQub24oXCJtZXNzYWdlXCIsIGFzeW5jIChtZXNzYWdlKSA9PiB7XG4gICAgICBpZiAobWVzc2FnZT8udHlwZSA9PT0gXCJnZW5lcmF0aW9uLWFjY2VwdGVkXCIpIHtcbiAgICAgICAgaWYgKCF0aGlzLmdlbmVyYXRpb25JZCB8fCBtZXNzYWdlLmdlbmVyYXRpb25JZCAhPT0gdGhpcy5nZW5lcmF0aW9uSWQpIHtcbiAgICAgICAgICByZWplY3RIYW5kc2hha2UobmV3IEVycm9yKFwiQmFja2dyb3VuZCBqb2JzIG1haW4gYWNrbm93bGVkZ2VkIGEgZGlmZmVyZW50IGdlbmVyYXRpb25cIikpXG4gICAgICAgICAganNvblNvY2tldC5kZXN0cm95KClcbiAgICAgICAgICByZXR1cm5cbiAgICAgICAgfVxuXG4gICAgICAgIHRoaXMuX2dlbmVyYXRpb25BY2NlcHRlZCA9IHRydWVcbiAgICAgICAgY29ubmVjdGlvbkFjY2VwdGVkID0gdHJ1ZVxuICAgICAgICBpZiAoaGFuZHNoYWtlVGltZXIpIHtcbiAgICAgICAgICBjbGVhclRpbWVvdXQoaGFuZHNoYWtlVGltZXIpXG4gICAgICAgICAgaGFuZHNoYWtlVGltZXIgPSB1bmRlZmluZWRcbiAgICAgICAgfVxuICAgICAgICBpZiAobWVzc2FnZS5saWZlY3ljbGVTdGF0ZSA9PT0gXCJyZXRpcmluZ1wiIHx8IG1lc3NhZ2UubGlmZWN5Y2xlU3RhdGUgPT09IFwicmV0aXJlZFwiKSB0aGlzLmlzUmV0aXJpbmcgPSB0cnVlXG4gICAgICAgIHRoaXMub25HZW5lcmF0aW9uQWNjZXB0ZWQ/LigpXG4gICAgICAgIHRoaXMuX3NlbmRSZWFkeUlmUnVubmluZygpXG4gICAgICAgIHRoaXMuX3N0YXJ0SGVhcnRiZWF0KClcbiAgICAgICAgcmVzb2x2ZUhhbmRzaGFrZSgpXG4gICAgICAgIHJldHVyblxuICAgICAgfVxuXG4gICAgICBpZiAobWVzc2FnZT8udHlwZSA9PT0gXCJnZW5lcmF0aW9uLXJlamVjdGVkXCIpIHtcbiAgICAgICAgdGhpcy5zaG91bGRTdG9wID0gdHJ1ZVxuICAgICAgICBpZiAoaGFuZHNoYWtlVGltZXIpIGNsZWFyVGltZW91dChoYW5kc2hha2VUaW1lcilcbiAgICAgICAgcmVqZWN0SGFuZHNoYWtlKG5ldyBFcnJvcihgQmFja2dyb3VuZCBqb2JzIGdlbmVyYXRpb24gcmVqZWN0ZWQ6ICR7bWVzc2FnZS5yZWFzb259YCkpXG4gICAgICAgIGpzb25Tb2NrZXQuZGVzdHJveSgpXG4gICAgICAgIHJldHVyblxuICAgICAgfVxuXG4gICAgICBpZiAobWVzc2FnZT8udHlwZSA9PT0gXCJyZXRpcmVcIikge1xuICAgICAgICBpZiAodGhpcy5nZW5lcmF0aW9uSWQgJiYgbWVzc2FnZS5nZW5lcmF0aW9uSWQgPT09IHRoaXMuZ2VuZXJhdGlvbklkKSB7XG4gICAgICAgICAgdGhpcy5vblJldGlyZU1lc3NhZ2U/LigpXG4gICAgICAgICAgdGhpcy5fYmVnaW5HZW5lcmF0aW9uUmV0aXJlbWVudCgpXG4gICAgICAgIH1cbiAgICAgICAgcmV0dXJuXG4gICAgICB9XG5cbiAgICAgIGlmIChtZXNzYWdlPy50eXBlID09PSBcImpvYlwiKSB7XG4gICAgICAgIGF3YWl0IHRoaXMuX2hhbmRsZUpvYihtZXNzYWdlLnBheWxvYWQpXG4gICAgICB9XG4gICAgfSlcblxuICAgIGpzb25Tb2NrZXQub24oXCJlcnJvclwiLCAoZXJyb3IpID0+IHtcbiAgICAgIGNvbnNvbGUuZXJyb3IoXCJCYWNrZ3JvdW5kIGpvYnMgd29ya2VyIHNvY2tldCBlcnJvcjpcIiwgZXJyb3IpXG4gICAgICBpZiAodGhpcy5nZW5lcmF0aW9uSWQgJiYgIXRoaXMuX2dlbmVyYXRpb25BY2NlcHRlZCkgcmVqZWN0SGFuZHNoYWtlKGVycm9yKVxuICAgIH0pXG5cbiAgICBqc29uU29ja2V0Lm9uKFwiY2xvc2VcIiwgKCkgPT4ge1xuICAgICAgaWYgKGhhbmRzaGFrZVRpbWVyKSBjbGVhclRpbWVvdXQoaGFuZHNoYWtlVGltZXIpXG4gICAgICB0aGlzLl9zdG9wSGVhcnRiZWF0KClcbiAgICAgIGlmICh0aGlzLmpzb25Tb2NrZXQgPT09IGpzb25Tb2NrZXQpIHRoaXMuanNvblNvY2tldCA9IHVuZGVmaW5lZFxuICAgICAgaWYgKHRoaXMuZ2VuZXJhdGlvbklkICYmICF0aGlzLl9nZW5lcmF0aW9uQWNjZXB0ZWQpIHtcbiAgICAgICAgcmVqZWN0SGFuZHNoYWtlKG5ldyBFcnJvcihcIkJhY2tncm91bmQgam9icyBzb2NrZXQgY2xvc2VkIGJlZm9yZSBnZW5lcmF0aW9uIGFja25vd2xlZGdlbWVudFwiKSlcbiAgICAgIH1cbiAgICAgIGlmICh0aGlzLnNob3VsZFN0b3ApIHJldHVyblxuICAgICAgaWYgKGNvbm5lY3Rpb25BY2NlcHRlZCB8fCBhbGxvd1JlY29ubmVjdCB8fCAhdGhpcy5nZW5lcmF0aW9uSWQpIHRoaXMuX3NjaGVkdWxlUmVjb25uZWN0KClcbiAgICB9KVxuXG4gICAgaWYgKHRoaXMuZ2VuZXJhdGlvbklkKSB7XG4gICAgICBoYW5kc2hha2VUaW1lciA9IHNldFRpbWVvdXQoKCkgPT4ge1xuICAgICAgICBjb25zdCBlcnJvciA9IG5ldyBCYWNrZ3JvdW5kSm9ic0dlbmVyYXRpb25IYW5kc2hha2VUaW1lb3V0RXJyb3Ioe1xuICAgICAgICAgIGVuZHBvaW50OiBgJHtob3N0fToke3BvcnR9YCxcbiAgICAgICAgICBnZW5lcmF0aW9uSWQ6IHRoaXMuZ2VuZXJhdGlvbklkIHx8IFwiXCIsXG4gICAgICAgICAgcm9sZTogXCJ3b3JrZXJcIixcbiAgICAgICAgICB0aW1lb3V0TXM6IHRoaXMuZ2VuZXJhdGlvbkhhbmRzaGFrZVRpbWVvdXRNc1xuICAgICAgICB9KVxuICAgICAgICByZWplY3RIYW5kc2hha2UoZXJyb3IpXG4gICAgICAgIGpzb25Tb2NrZXQuZGVzdHJveSgpXG4gICAgICB9LCB0aGlzLmdlbmVyYXRpb25IYW5kc2hha2VUaW1lb3V0TXMpXG4gICAgfVxuXG4gICAgc29ja2V0Lm9uKFwiY29ubmVjdFwiLCAoKSA9PiB7XG4gICAgICBqc29uU29ja2V0LnNlbmQoe3R5cGU6IFwiaGVsbG9cIiwgcm9sZTogXCJ3b3JrZXJcIiwgLi4uKHRoaXMuZ2VuZXJhdGlvbklkID8ge2dlbmVyYXRpb25JZDogdGhpcy5nZW5lcmF0aW9uSWR9IDoge30pLCBzdXBwb3J0c0hhbmRvZmZJZFJlcG9ydGluZzogdHJ1ZSwgc3VwcG9ydHNIZWFydGJlYXQ6IHRydWUsIHN1cHBvcnRzUG9vbGVkOiB0cnVlLCB3b3JrZXJJZDogdGhpcy53b3JrZXJJZH0pXG4gICAgICBpZiAoIXRoaXMuZ2VuZXJhdGlvbklkKSB7XG4gICAgICAgIGNvbm5lY3Rpb25BY2NlcHRlZCA9IHRydWVcbiAgICAgICAgdGhpcy5fc2VuZFJlYWR5SWZSdW5uaW5nKClcbiAgICAgICAgdGhpcy5fc3RhcnRIZWFydGJlYXQoKVxuICAgICAgICByZXNvbHZlSGFuZHNoYWtlKClcbiAgICAgIH1cbiAgICB9KVxuXG4gICAgaWYgKHRoaXMuZ2VuZXJhdGlvbklkKSBhd2FpdCBoYW5kc2hha2VcbiAgfVxuXG4gIC8qKiBTY2hlZHVsZXMgb25lIGZlbmNlZCByZWNvbm5lY3QgdG8gdGhlIHdvcmtlcidzIHVuY2hhbmdlZCBlbmRwb2ludC4gKi9cbiAgX3NjaGVkdWxlUmVjb25uZWN0KCkge1xuICAgIGlmICh0aGlzLnNob3VsZFN0b3AgfHwgdGhpcy5fcmVjb25uZWN0VGltZXIpIHJldHVyblxuXG4gICAgdGhpcy5fcmVjb25uZWN0VGltZXIgPSBzZXRUaW1lb3V0KCgpID0+IHtcbiAgICAgIHRoaXMuX3JlY29ubmVjdFRpbWVyID0gdW5kZWZpbmVkXG4gICAgICBpZiAodGhpcy5zaG91bGRTdG9wKSByZXR1cm5cbiAgICAgIHZvaWQgdGhpcy5fY29ubmVjdCh7YWxsb3dSZWNvbm5lY3Q6IHRydWV9KS5jYXRjaCgoZXJyb3IpID0+IHtcbiAgICAgICAgaWYgKCF0aGlzLnNob3VsZFN0b3ApIGNvbnNvbGUuZXJyb3IoXCJCYWNrZ3JvdW5kIGpvYnMgd29ya2VyIHJlY29ubmVjdCBmYWlsZWQ6XCIsIGVycm9yKVxuICAgICAgfSlcbiAgICB9LCB0aGlzLnJlY29ubmVjdERlbGF5TXMpXG4gICAgaWYgKHR5cGVvZiB0aGlzLl9yZWNvbm5lY3RUaW1lci51bnJlZiA9PT0gXCJmdW5jdGlvblwiKSB0aGlzLl9yZWNvbm5lY3RUaW1lci51bnJlZigpXG4gIH1cblxuICAvKipcbiAgICogU3VyZmFjZXMgYW4gdW5leHBlY3RlZCB3b3JrZXIgbGlmZWN5Y2xlIGZhaWx1cmUgdGhyb3VnaCB0aGUgZnJhbWV3b3JrIGVycm9yXG4gICAqIGNoYW5uZWxzIHNvIGEgc3VwZXJ2aXNvciBob29rIHRoYXQgaWdub3JlcyBzdGRpbyBzdGlsbCBoYXMgb2JzZXJ2YWJpbGl0eS5cbiAgICogQHBhcmFtIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gZXJyb3IgLSBXb3JrZXIgbGlmZWN5Y2xlIGZhaWx1cmUuXG4gICAqL1xuICBfcmVwb3J0TGlmZWN5Y2xlRXJyb3IoZXJyb3IpIHtcbiAgICBjb25zdCBjb25maWd1cmF0aW9uID0gdGhpcy5jb25maWd1cmF0aW9uXG4gICAgaWYgKCFjb25maWd1cmF0aW9uKSByZXR1cm5cbiAgICBjb25zdCBub3JtYWxpemVkRXJyb3IgPSBlcnJvciBpbnN0YW5jZW9mIEVycm9yID8gZXJyb3IgOiBuZXcgRXJyb3IoU3RyaW5nKGVycm9yKSlcbiAgICBjb25zdCBwYXlsb2FkID0ge2NvbnRleHQ6IHtnZW5lcmF0aW9uSWQ6IHRoaXMuZ2VuZXJhdGlvbklkLCBzdGFnZTogXCJiYWNrZ3JvdW5kLWpvYnMtd29ya2VyLWxpZmVjeWNsZVwifSwgZXJyb3I6IG5vcm1hbGl6ZWRFcnJvcn1cbiAgICBjb25zdCBlcnJvckV2ZW50cyA9IGNvbmZpZ3VyYXRpb24uZ2V0RXJyb3JFdmVudHMoKVxuXG4gICAgZXJyb3JFdmVudHMuZW1pdChcImZyYW1ld29yay1lcnJvclwiLCBwYXlsb2FkKVxuICAgIGVycm9yRXZlbnRzLmVtaXQoXCJhbGwtZXJyb3JcIiwgey4uLnBheWxvYWQsIGVycm9yVHlwZTogXCJmcmFtZXdvcmstZXJyb3JcIn0pXG4gIH1cblxuICAvKipcbiAgICogU2VuZHMgcGVyaW9kaWMgbGl2ZW5lc3MgaGVhcnRiZWF0cyB0byB0aGUgbWFpbiBzbyBhIHdlZGdlZCBvciBzaWxlbnQgd29ya2VyXG4gICAqIGNhbiBiZSBkZXRlY3RlZCBhbmQgZHJvcHBlZCB0aGVyZSAoaXRzIGxlYXNlcyByZWxlYXNlZCkgaW5zdGVhZCBvZiBmcmVlemluZ1xuICAgKiB0aGUgcXVldWUgdW50aWwgYSBodW1hbiBub3RpY2VzLlxuICAgKiBAcmV0dXJucyB7dm9pZH1cbiAgICovXG4gIF9zdGFydEhlYXJ0YmVhdCgpIHtcbiAgICB0aGlzLl9zdG9wSGVhcnRiZWF0KClcblxuICAgIHRoaXMuX2hlYXJ0YmVhdFRpbWVyID0gc2V0SW50ZXJ2YWwoKCkgPT4gdGhpcy5fc2VuZEhlYXJ0YmVhdCgpLCB0aGlzLmhlYXJ0YmVhdEludGVydmFsTXMpXG5cbiAgICBpZiAodHlwZW9mIHRoaXMuX2hlYXJ0YmVhdFRpbWVyLnVucmVmID09PSBcImZ1bmN0aW9uXCIpIHRoaXMuX2hlYXJ0YmVhdFRpbWVyLnVucmVmKClcbiAgfVxuXG4gIC8qKiBTZW5kcyBvbmUgbGl2ZW5lc3MgaGVhcnRiZWF0IHdoaWxlIHRoZSB3b3JrZXIgaGFzIG5vdCBmaW5hbGx5IHN0b3BwZWQuICovXG4gIF9zZW5kSGVhcnRiZWF0KCkge1xuICAgIGlmICh0aGlzLnNob3VsZFN0b3AgfHwgIXRoaXMuanNvblNvY2tldCkgcmV0dXJuXG5cbiAgICB0cnkge1xuICAgICAgdGhpcy5qc29uU29ja2V0LnNlbmQoe3R5cGU6IFwiaGVhcnRiZWF0XCIsIHdvcmtlcklkOiB0aGlzLndvcmtlcklkfSlcbiAgICB9IGNhdGNoIHtcbiAgICAgIC8vIFNvY2tldCBpcyBjbG9zaW5nL2Nsb3NlZDsgdGhlIGNsb3NlIGhhbmRsZXIgZHJpdmVzIHJlY29ubmVjdC5cbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogU3RvcHMgdGhlIGxpdmVuZXNzIGhlYXJ0YmVhdCB0aW1lci5cbiAgICogQHJldHVybnMge3ZvaWR9XG4gICAqL1xuICBfc3RvcEhlYXJ0YmVhdCgpIHtcbiAgICBpZiAodGhpcy5faGVhcnRiZWF0VGltZXIpIHtcbiAgICAgIGNsZWFySW50ZXJ2YWwodGhpcy5faGVhcnRiZWF0VGltZXIpXG4gICAgICB0aGlzLl9oZWFydGJlYXRUaW1lciA9IHVuZGVmaW5lZFxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGhhbmRsZSBqb2IuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi90eXBlcy5qc1wiKS5CYWNrZ3JvdW5kSm9iUGF5bG9hZH0gcGF5bG9hZCAtIFBheWxvYWQuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIHdoZW4gZG9uZS5cbiAgICovXG4gIGFzeW5jIF9oYW5kbGVKb2IocGF5bG9hZCkge1xuICAgIGlmICghcGF5bG9hZC5pZCkgdGhyb3cgbmV3IEVycm9yKFwiQmFja2dyb3VuZCBqb2IgcGF5bG9hZCBtaXNzaW5nIGlkXCIpXG4gICAgLyoqXG4gICAgICogSWRlbnRpZmllZCBwYXlsb2FkLlxuICAgICAqIEB0eXBlIHtpbXBvcnQoXCIuL3R5cGVzLmpzXCIpLkJhY2tncm91bmRKb2JQYXlsb2FkICYge2lkOiBzdHJpbmd9fSAqL1xuICAgIGNvbnN0IGlkZW50aWZpZWRQYXlsb2FkID0gLyoqIEB0eXBlIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gKi8gKHBheWxvYWQpXG5cbiAgICBjb25zdCBleGVjdXRpb25Nb2RlID0gdGhpcy5fZXhlY3V0aW9uTW9kZUZvclBheWxvYWQoaWRlbnRpZmllZFBheWxvYWQpXG5cbiAgICBpZiAoZXhlY3V0aW9uTW9kZSA9PT0gXCJwb29sZWRcIikge1xuICAgICAgdGhpcy5fcXVldWVQb29sZWRKb2IoaWRlbnRpZmllZFBheWxvYWQpXG4gICAgICByZXR1cm5cbiAgICB9XG5cbiAgICBpZiAoZXhlY3V0aW9uTW9kZSAhPT0gXCJpbmxpbmVcIikge1xuICAgICAgdGhpcy5fdHJhY2tQcm9jZXNzSm9iKHRoaXMuX3N0YXJ0UHJvY2Vzc0pvYih7ZXhlY3V0aW9uTW9kZSwgcGF5bG9hZDogaWRlbnRpZmllZFBheWxvYWR9KSlcbiAgICAgIHJldHVyblxuICAgIH1cblxuICAgIHRoaXMuX2hhbmRsZUlubGluZUpvYihpZGVudGlmaWVkUGF5bG9hZClcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHN0YXJ0IHByb2Nlc3Mgam9iLlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIE9wdGlvbnMuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi90eXBlcy5qc1wiKS5CYWNrZ3JvdW5kSm9iRXhlY3V0aW9uTW9kZX0gYXJncy5leGVjdXRpb25Nb2RlIC0gRXhlY3V0aW9uIG1vZGUuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi90eXBlcy5qc1wiKS5CYWNrZ3JvdW5kSm9iUGF5bG9hZCAmIHtpZDogc3RyaW5nfX0gYXJncy5wYXlsb2FkIC0gUGF5bG9hZC5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgd2hlbiB0aGUgcHJvY2VzcyBqb2IgZXhpdHMuXG4gICAqL1xuICBfc3RhcnRQcm9jZXNzSm9iKHtleGVjdXRpb25Nb2RlLCBwYXlsb2FkfSkge1xuICAgIGlmIChleGVjdXRpb25Nb2RlID09PSBcImZvcmtlZFwiKSByZXR1cm4gdGhpcy5fZm9ya0pvYihwYXlsb2FkKVxuXG4gICAgcmV0dXJuIHRoaXMuX3NwYXduSm9iKHBheWxvYWQpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBoYW5kbGUgaW5saW5lIGpvYi5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL3R5cGVzLmpzXCIpLkJhY2tncm91bmRKb2JQYXlsb2FkICYge2lkOiBzdHJpbmd9fSBwYXlsb2FkIC0gUGF5bG9hZC5cbiAgICogQHJldHVybnMge3ZvaWR9XG4gICAqL1xuICBfaGFuZGxlSW5saW5lSm9iKHBheWxvYWQpIHtcbiAgICAvLyBJbmxpbmUgam9icyBzaGFyZSB0aGUgd29ya2VyJ3MgcHJvY2VzcyBhbmQgREIgcG9vbCwgYnV0IGVhY2ggb25lXG4gICAgLy8gaXMgaXRzIG93biBhc3luYyBjaGFpbiDigJQgdGhlcmUncyBubyBzZW1hbnRpYyByZWFzb24gdG8gc2VyaWFsaXplXG4gICAgLy8gdGhlbS4gV2Uga2ljayBvZmYgdGhlIGpvYiwgcmVnaXN0ZXIgaXQgd2l0aCBgaW5mbGlnaHRJbmxpbmVKb2JzYFxuICAgIC8vIGZvciBzaHV0ZG93biBkcmFpbiwgYW5kIHNpZ25hbCBjYXBhY2l0eSB0byBtYWluOlxuICAgIC8vIC0gSWYgd2Ugc3RpbGwgaGF2ZSBhIGZyZWUgc2xvdCB3ZSBhc2sgZm9yIHRoZSBuZXh0IGpvYiByaWdodFxuICAgIC8vICAgYXdheSwgc28gYSBzbG93IGpvYiAoZS5nLiBhIGRvY2tlciBhbGl2ZSBjaGVjayB0aGF0IHdhaXRzIDE1c1xuICAgIC8vICAgb24gYSBnb25lIHNlcnZlcikgbm8gbG9uZ2VyIHN0YXJ2ZXMgZXZlcnkgb3RoZXIgaW5saW5lIGpvYi5cbiAgICAvLyAtIFdoZW4gdGhlIGpvYiBmaW5pc2hlcywgaWYgdGhlIHdvcmtlciBoYWQgYmVlbiBhdCB0aGUgY2FwLCB3ZVxuICAgIC8vICAgYXNrIGZvciB0aGUgbmV4dCBqb2IgdG8gcmVmaWxsIHRoZSBzbG90LlxuICAgIC8vIFRoZSBib29ra2VlcGluZyBpbiBgZmluYWxseSgpYCByYXRjaGV0cyBjYXBhY2l0eSBiYWNrIHVwXG4gICAgLy8gcmVnYXJkbGVzcyBvZiBzdWNjZXNzIG9yIGZhaWx1cmUuXG4gICAgLyoqXG4gICAgICogRGVmaW5lcyBpbmZsaWdodC5cbiAgICAgKiBAdHlwZSB7UHJvbWlzZTx2b2lkPn0gKi9cbiAgICBsZXQgaW5mbGlnaHRcblxuICAgIGluZmxpZ2h0ID0gdGhpcy5fcnVuSW5saW5lSm9iQW5kUmVwb3J0KHBheWxvYWQpLmZpbmFsbHkoKCkgPT4ge1xuICAgICAgdGhpcy5pbmZsaWdodElubGluZUpvYnMuZGVsZXRlKGluZmxpZ2h0KVxuXG4gICAgICAvLyBSZS1hbm5vdW5jZSBvbiBldmVyeSBjb21wbGV0aW9uIGJlbG93IGNhcCwgbm90IGp1c3QgdGhlIGNhcOKGkmNhcC0xIGVkZ2Ug4oCUXG4gICAgICAvLyBzZWUgX3RyYWNrUHJvY2Vzc0pvYiBmb3Igd2h5IHRoZSBrbmlmZS1lZGdlIGNvbmRpdGlvbiBzaWxlbnRseSB3ZWRnZXMuXG4gICAgICBpZiAoIXRoaXMuc2hvdWxkU3RvcCkgdGhpcy5fc2VuZFJlYWR5SWZSdW5uaW5nKClcbiAgICB9KVxuXG4gICAgdGhpcy5pbmZsaWdodElubGluZUpvYnMuYWRkKGluZmxpZ2h0KVxuXG4gICAgaWYgKHRoaXMuaW5mbGlnaHRJbmxpbmVKb2JzLnNpemUgPCB0aGlzLm1heENvbmN1cnJlbnRJbmxpbmVKb2JzKSB7XG4gICAgICB0aGlzLl9zZW5kUmVhZHlJZlJ1bm5pbmcoKVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGV4ZWN1dGlvbiBtb2RlIGZvciBwYXlsb2FkLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vdHlwZXMuanNcIikuQmFja2dyb3VuZEpvYlBheWxvYWR9IHBheWxvYWQgLSBQYXlsb2FkLlxuICAgKiBAcmV0dXJucyB7aW1wb3J0KFwiLi90eXBlcy5qc1wiKS5CYWNrZ3JvdW5kSm9iRXhlY3V0aW9uTW9kZX0gLSBFeGVjdXRpb24gbW9kZS5cbiAgICovXG4gIF9leGVjdXRpb25Nb2RlRm9yUGF5bG9hZChwYXlsb2FkKSB7XG4gICAgY29uc3QgZXhlY3V0aW9uTW9kZSA9IHBheWxvYWQub3B0aW9ucz8uZXhlY3V0aW9uTW9kZVxuXG4gICAgcmV0dXJuIGV4ZWN1dGlvbk1vZGUgPyB0aGlzLl9ub3JtYWxpemVFeGVjdXRpb25Nb2RlKGV4ZWN1dGlvbk1vZGUpIDogXCJwb29sZWRcIlxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgbm9ybWFsaXplIGV4ZWN1dGlvbiBtb2RlLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gZXhlY3V0aW9uTW9kZSAtIEV4ZWN1dGlvbiBtb2RlLlxuICAgKiBAcmV0dXJucyB7aW1wb3J0KFwiLi90eXBlcy5qc1wiKS5CYWNrZ3JvdW5kSm9iRXhlY3V0aW9uTW9kZX0gLSBOb3JtYWxpemVkIGV4ZWN1dGlvbiBtb2RlLlxuICAgKi9cbiAgX25vcm1hbGl6ZUV4ZWN1dGlvbk1vZGUoZXhlY3V0aW9uTW9kZSkge1xuICAgIGZvciAoY29uc3QgbW9kZSBvZiBFWEVDVVRJT05fTU9ERVMpIHtcbiAgICAgIGlmIChtb2RlID09PSBleGVjdXRpb25Nb2RlKSByZXR1cm4gbW9kZVxuICAgIH1cblxuICAgIHRocm93IG5ldyBFcnJvcihgSW52YWxpZCBiYWNrZ3JvdW5kIGpvYiBleGVjdXRpb25Nb2RlOiAke2V4ZWN1dGlvbk1vZGV9YClcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHRyYWNrIHByb2Nlc3Mgam9iLlxuICAgKiBAcGFyYW0ge1Byb21pc2U8dm9pZD59IHByb2Nlc3NKb2IgLSBQcm9jZXNzIGpvYiBwcm9taXNlLlxuICAgKiBAcmV0dXJucyB7dm9pZH1cbiAgICovXG4gIF90cmFja1Byb2Nlc3NKb2IocHJvY2Vzc0pvYikge1xuICAgIC8qKlxuICAgICAqIERlZmluZXMgaW5mbGlnaHQuXG4gICAgICogQHR5cGUge1Byb21pc2U8dm9pZD59ICovXG4gICAgbGV0IGluZmxpZ2h0XG5cbiAgICBpbmZsaWdodCA9IHByb2Nlc3NKb2IuZmluYWxseSgoKSA9PiB7XG4gICAgICB0aGlzLmluZmxpZ2h0UHJvY2Vzc0pvYnMuZGVsZXRlKGluZmxpZ2h0KVxuXG4gICAgICAvLyBSZS1hbm5vdW5jZSByZWFkaW5lc3Mgb24gRVZFUlkgY29tcGxldGlvbiB0aGF0IGxlYXZlcyB1cyBiZWxvdyBjYXAg4oCUIG5vdFxuICAgICAgLy8ganVzdCB0aGUgc2luZ2xlIGNhcOKGkmNhcC0xIGVkZ2UuIFRoZSBtYWluIHJlbW92ZXMgYSB3b3JrZXIgZnJvbSBpdHMgcmVhZHlcbiAgICAgIC8vIHNldCBvbiBlYWNoIGRpc3BhdGNoIChgX2RyYWluT25jZWApIGFuZCBvbmx5IHJlLWFkZHMgaXQgb24gYSBmcmVzaFxuICAgICAgLy8gXCJyZWFkeVwiOyBnYXRpbmcgdGhlIHJlLWFubm91bmNlIG9uIG9uZSBrbmlmZS1lZGdlIHRyYW5zaXRpb24gbWVhbnMgYVxuICAgICAgLy8gc2luZ2xlIG1pc3NlZCBvciBsb3N0IHNpZ25hbCBsZWF2ZXMgdGhlIHdvcmtlciBvdXQgb2YgdGhlIHJlYWR5IHNldCBhbmRcbiAgICAgIC8vIHdlZGdlcyBkaXNwYXRjaCBjbHVzdGVyLXdpZGUuIFRoaXMgd2FzIHRoZSBzaWxlbnQtZnJlZXplIHJvb3QgY2F1c2UuXG4gICAgICAvLyBgX3NlbmRSZWFkeUlmUnVubmluZ2Agc2VsZi1ndWFyZHMgKGl0IHNlbmRzIG5vdGhpbmcgd2hlbiB0aGUgd29ya2VyIGlzXG4gICAgICAvLyBnZW51aW5lbHkgYXQgY2FwYWNpdHkpLCBzbyByZS1hbm5vdW5jaW5nIG9uIGV2ZXJ5IGZyZWVkIHNsb3QgaXMgc2FmZSBhbmRcbiAgICAgIC8vIGlkZW1wb3RlbnQgb24gdGhlIG1haW4uXG4gICAgICBpZiAoIXRoaXMuc2hvdWxkU3RvcCkgdGhpcy5fc2VuZFJlYWR5SWZSdW5uaW5nKClcbiAgICB9KVxuXG4gICAgdGhpcy5pbmZsaWdodFByb2Nlc3NKb2JzLmFkZChpbmZsaWdodClcbiAgICB0aGlzLl9zZW5kUmVhZHlJZlJ1bm5pbmcoKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgcnVuIGlubGluZSBqb2IgYW5kIHJlcG9ydC5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL3R5cGVzLmpzXCIpLkJhY2tncm91bmRKb2JQYXlsb2FkICYge2lkOiBzdHJpbmd9fSBwYXlsb2FkIC0gUGF5bG9hZCB3aXRoIHJlcXVpcmVkIGlkLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyB3aGVuIGNvbXBsZXRlIChzdWNjZXNzIG9yIGZhaWx1cmUgcmVwb3J0ZWQpLlxuICAgKi9cbiAgYXN5bmMgX3J1bklubGluZUpvYkFuZFJlcG9ydChwYXlsb2FkKSB7XG4gICAgLy8gUmVwb3J0IGluIHRoZSBiYWNrZ3JvdW5kIHNvIGZyZWVpbmcgdGhpcyBpbmxpbmUgc2xvdCBuZXZlciB3YWl0cyBvbiB0aGVcbiAgICAvLyByZXBvcnQuIFJlcG9ydGluZyBpcyBkdXJhYmxlIChyZXRyaWVkIHVudGlsIGl0IGxhbmRzKSwgc28gYSB0cmFuc2llbnRcbiAgICAvLyBtYWluL0RCIG91dGFnZSBuZWl0aGVyIHdlZGdlcyB0aGUgc2xvdCBub3IgbG9zZXMgdGhlIHRlcm1pbmFsIHJlc3VsdC5cbiAgICB0cnkge1xuICAgICAgYXdhaXQgdGhpcy5fcnVuSm9iSW5saW5lKHBheWxvYWQpXG4gICAgICB0aGlzLl9yZXBvcnRKb2JSZXN1bHRJbkJhY2tncm91bmQoe1xuICAgICAgICBqb2JJZDogcGF5bG9hZC5pZCxcbiAgICAgICAgc3RhdHVzOiBcImNvbXBsZXRlZFwiLFxuICAgICAgICBoYW5kb2ZmSWQ6IHBheWxvYWQuaGFuZG9mZklkLFxuICAgICAgICBoYW5kZWRPZmZBdE1zOiBwYXlsb2FkLmhhbmRlZE9mZkF0TXMsXG4gICAgICAgIHdvcmtlcklkOiBwYXlsb2FkLndvcmtlcklkIHx8IHRoaXMud29ya2VySWRcbiAgICAgIH0pXG4gICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgIGlmIChlcnJvciBpbnN0YW5jZW9mIEJhY2tncm91bmRKb2JSZXNjaGVkdWxlU2lnbmFsKSB7XG4gICAgICAgIHRoaXMuX3JlcG9ydEpvYlJlc3VsdEluQmFja2dyb3VuZCh7XG4gICAgICAgICAgam9iSWQ6IHBheWxvYWQuaWQsXG4gICAgICAgICAgc3RhdHVzOiBcInJlc2NoZWR1bGVkXCIsXG4gICAgICAgICAgZGVsYXlNczogZXJyb3IuZGVsYXlNcyxcbiAgICAgICAgICBoYW5kb2ZmSWQ6IHBheWxvYWQuaGFuZG9mZklkLFxuICAgICAgICAgIGhhbmRlZE9mZkF0TXM6IHBheWxvYWQuaGFuZGVkT2ZmQXRNcyxcbiAgICAgICAgICB3b3JrZXJJZDogcGF5bG9hZC53b3JrZXJJZCB8fCB0aGlzLndvcmtlcklkXG4gICAgICAgIH0pXG4gICAgICAgIHJldHVyblxuICAgICAgfVxuXG4gICAgICB0aGlzLl9yZXBvcnRKb2JSZXN1bHRJbkJhY2tncm91bmQoe1xuICAgICAgICBqb2JJZDogcGF5bG9hZC5pZCxcbiAgICAgICAgc3RhdHVzOiBcImZhaWxlZFwiLFxuICAgICAgICBlcnJvcixcbiAgICAgICAgaGFuZG9mZklkOiBwYXlsb2FkLmhhbmRvZmZJZCxcbiAgICAgICAgaGFuZGVkT2ZmQXRNczogcGF5bG9hZC5oYW5kZWRPZmZBdE1zLFxuICAgICAgICB3b3JrZXJJZDogcGF5bG9hZC53b3JrZXJJZCB8fCB0aGlzLndvcmtlcklkXG4gICAgICB9KVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBBZHZlcnRpc2VzIGN1cnJlbnQgd29ya2VyIGNhcGFjaXR5IHVubGVzcyB0aGUgd29ya2VyIGlzIGRyYWluaW5nLlxuICAgKiBAcGFyYW0ge29iamVjdH0gW29wdGlvbnNdIC0gQWR2ZXJ0aXNlbWVudCBvcHRpb25zLlxuICAgKiBAcGFyYW0ge2Jvb2xlYW59IFtvcHRpb25zLnJldm9rZVBvb2xlZEFkbWlzc2lvbl0gLSBSZXZva2UgcG9vbGVkIGNyZWRpdHMgd2hpbGUgcHJlc2VydmluZyBvdGhlciBleGVjdXRpb24gbW9kZXMuXG4gICAqIEByZXR1cm5zIHt2b2lkfVxuICAgKi9cbiAgX3NlbmRSZWFkeUlmUnVubmluZyh7cmV2b2tlUG9vbGVkQWRtaXNzaW9uID0gZmFsc2V9ID0ge30pIHtcbiAgICBpZiAodGhpcy5zaG91bGRTdG9wIHx8IHRoaXMuaXNSZXRpcmluZykgcmV0dXJuXG4gICAgaWYgKCF0aGlzLmpzb25Tb2NrZXQpIHJldHVyblxuICAgIGlmICh0aGlzLmdlbmVyYXRpb25JZCAmJiAhdGhpcy5fZ2VuZXJhdGlvbkFjY2VwdGVkKSByZXR1cm5cblxuICAgIGNvbnN0IHJlYWR5TWVzc2FnZSA9IHRoaXMuX3JlYWR5TWVzc2FnZSh7cmV2b2tlUG9vbGVkQWRtaXNzaW9ufSlcblxuICAgIGlmICghcmVhZHlNZXNzYWdlKSByZXR1cm5cbiAgICB0aGlzLmpzb25Tb2NrZXQuc2VuZChyZWFkeU1lc3NhZ2UpXG4gIH1cblxuICAvKipcbiAgICogUnVucyByZWFkeSBtZXNzYWdlLlxuICAgKiBAcGFyYW0ge29iamVjdH0gW29wdGlvbnNdIC0gQWR2ZXJ0aXNlbWVudCBvcHRpb25zLlxuICAgKiBAcGFyYW0ge2Jvb2xlYW59IFtvcHRpb25zLnJldm9rZVBvb2xlZEFkbWlzc2lvbl0gLSBSZXZva2UgcG9vbGVkIGNyZWRpdHMgd2hpbGUgcHJlc2VydmluZyBvdGhlciBleGVjdXRpb24gbW9kZXMuXG4gICAqIEByZXR1cm5zIHtpbXBvcnQoXCIuL3R5cGVzLmpzXCIpLkJhY2tncm91bmRKb2JTb2NrZXRNZXNzYWdlIHwgbnVsbH0gLSBSZWFkeSBtZXNzYWdlIG9yIG51bGwgd2hlbiB0aGUgd29ya2VyIGhhcyBubyBjYXBhY2l0eS5cbiAgICovXG4gIF9yZWFkeU1lc3NhZ2Uoe3Jldm9rZVBvb2xlZEFkbWlzc2lvbiA9IGZhbHNlfSA9IHt9KSB7XG4gICAgY29uc3QgYWNjZXB0c1Byb2Nlc3NKb2IgPSB0aGlzLmluZmxpZ2h0UHJvY2Vzc0pvYnMuc2l6ZSA8IHRoaXMubWF4Q29uY3VycmVudEZvcmtlZEpvYnNcbiAgICBjb25zdCBhY2NlcHRzSW5saW5lID0gdGhpcy5pbmZsaWdodElubGluZUpvYnMuc2l6ZSA8IHRoaXMubWF4Q29uY3VycmVudElubGluZUpvYnNcbiAgICBjb25zdCBhdmFpbGFibGVQb29sZWRTbG90cyA9IHJldm9rZVBvb2xlZEFkbWlzc2lvbiA/IDAgOiB0aGlzLl9hdmFpbGFibGVQb29sZWRTbG90cygpXG4gICAgY29uc3QgYWNjZXB0c1Bvb2xlZCA9IGF2YWlsYWJsZVBvb2xlZFNsb3RzID4gMFxuXG4gICAgaWYgKCFyZXZva2VQb29sZWRBZG1pc3Npb24gJiYgIWFjY2VwdHNQcm9jZXNzSm9iICYmICFhY2NlcHRzSW5saW5lICYmICFhY2NlcHRzUG9vbGVkKSByZXR1cm4gbnVsbFxuXG4gICAgcmV0dXJuIHtcbiAgICAgIHR5cGU6IFwicmVhZHlcIixcbiAgICAgIGFjY2VwdHNGb3JrZWQ6IGFjY2VwdHNQcm9jZXNzSm9iLFxuICAgICAgYWNjZXB0c0lubGluZSxcbiAgICAgIGFjY2VwdHNQb29sZWQsXG4gICAgICBhdmFpbGFibGVQb29sZWRTbG90cyxcbiAgICAgIGFjY2VwdHNTcGF3bmVkOiBhY2NlcHRzUHJvY2Vzc0pvYlxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBUcmFja3MgYSBwb29sZWQgam9iIGFuZCByZS1hZHZlcnRpc2VzIGNhcGFjaXR5LlxuICAgKiBAcGFyYW0ge1Byb21pc2U8dm9pZD59IHBvb2xlZEpvYiAtIFBvb2xlZCBqb2IgcHJvbWlzZS5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gVGhlIHRyYWNrZWQgaW4tZmxpZ2h0IHByb21pc2UuXG4gICAqL1xuICBfdHJhY2tQb29sZWRKb2IocG9vbGVkSm9iKSB7XG4gICAgLyoqIEB0eXBlIHtQcm9taXNlPHZvaWQ+fSAqL1xuICAgIGxldCBpbmZsaWdodFxuICAgIGluZmxpZ2h0ID0gcG9vbGVkSm9iLmZpbmFsbHkoKCkgPT4ge1xuICAgICAgdGhpcy5pbmZsaWdodFBvb2xlZEpvYnMuZGVsZXRlKGluZmxpZ2h0KVxuICAgICAgaWYgKCF0aGlzLnNob3VsZFN0b3AgJiYgIXRoaXMuX3Bvb2xlZFN0YXJ0dXBGYWlsdXJlSm9icy5oYXMocG9vbGVkSm9iKSAmJiAhdGhpcy5fcG9vbGVkU3RhcnR1cEZhaWx1cmVKb2JzLmhhcyhpbmZsaWdodCkpIHRoaXMuX3NlbmRSZWFkeUlmUnVubmluZygpXG4gICAgfSlcbiAgICB0aGlzLmluZmxpZ2h0UG9vbGVkSm9icy5hZGQoaW5mbGlnaHQpXG4gICAgcmV0dXJuIGluZmxpZ2h0XG4gIH1cblxuICAvKipcbiAgICogU2VyaWFsaXplcyByZXBlYXRlZCBsZWFzZXMgZm9yIG9uZSBkdXJhYmxlIHJvdyB3aGlsZSBwcmVzZXJ2aW5nIHBvb2xlZFxuICAgKiBjb25jdXJyZW5jeSBhY3Jvc3MgZGlmZmVyZW50IGpvYiBpZHMuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi90eXBlcy5qc1wiKS5CYWNrZ3JvdW5kSm9iUGF5bG9hZCAmIHtpZDogc3RyaW5nfX0gcGF5bG9hZCAtIFBvb2xlZCBqb2IgcGF5bG9hZC5cbiAgICogQHJldHVybnMge3ZvaWR9XG4gICAqL1xuICBfcXVldWVQb29sZWRKb2IocGF5bG9hZCkge1xuICAgIGNvbnN0IHF1ZXVlID0gdGhpcy5wb29sZWRKb2JRdWV1ZXMuZ2V0KHBheWxvYWQuaWQpXG4gICAgaWYgKHF1ZXVlKSB7XG4gICAgICBxdWV1ZS5wdXNoKHBheWxvYWQpXG4gICAgICByZXR1cm5cbiAgICB9XG5cbiAgICB0aGlzLnBvb2xlZEpvYlF1ZXVlcy5zZXQocGF5bG9hZC5pZCwgW3BheWxvYWRdKVxuICAgIGNvbnN0IHRyYWNrZXIgPSB0aGlzLl90cmFja1Bvb2xlZEpvYih0aGlzLl9ydW5Qb29sZWRKb2JRdWV1ZShwYXlsb2FkLmlkKSlcbiAgICB0aGlzLnBvb2xlZEpvYlF1ZXVlVHJhY2tlcnMuc2V0KHBheWxvYWQuaWQsIHRyYWNrZXIpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBhZG1pdHRlZCBsZWFzZXMgZm9yIG9uZSBkdXJhYmxlIGpvYiBpZCBpbiBhcnJpdmFsIG9yZGVyLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gam9iSWQgLSBEdXJhYmxlIGpvYiBpZC5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgYWZ0ZXIgdGhlIHBlci1pZCBxdWV1ZSBkcmFpbnMuXG4gICAqL1xuICBhc3luYyBfcnVuUG9vbGVkSm9iUXVldWUoam9iSWQpIHtcbiAgICBjb25zdCBxdWV1ZSA9IHRoaXMucG9vbGVkSm9iUXVldWVzLmdldChqb2JJZClcbiAgICBpZiAoIXF1ZXVlKSB0aHJvdyBuZXcgRXJyb3IoYFBvb2xlZCBqb2IgcXVldWUgbWlzc2luZyBmb3Igam9iOiAke2pvYklkfWApXG5cbiAgICB0cnkge1xuICAgICAgd2hpbGUgKHF1ZXVlLmxlbmd0aCA+IDApIHtcbiAgICAgICAgY29uc3QgcGF5bG9hZCA9IHF1ZXVlLnNoaWZ0KClcbiAgICAgICAgaWYgKCFwYXlsb2FkKSB0aHJvdyBuZXcgRXJyb3IoYFBvb2xlZCBqb2IgcXVldWUgY29udGFpbmVkIGFuIGVtcHR5IHBheWxvYWQgZm9yIGpvYjogJHtqb2JJZH1gKVxuICAgICAgICBhd2FpdCB0aGlzLl9ydW5Qb29sZWRKb2IocGF5bG9hZClcbiAgICAgIH1cbiAgICB9IGZpbmFsbHkge1xuICAgICAgY29uc3QgdHJhY2tlciA9IHRoaXMucG9vbGVkSm9iUXVldWVUcmFja2Vycy5nZXQoam9iSWQpXG4gICAgICBpZiAodHJhY2tlcikge1xuICAgICAgICB0aGlzLmluZmxpZ2h0UG9vbGVkSm9icy5kZWxldGUodHJhY2tlcilcbiAgICAgICAgdGhpcy5wb29sZWRKb2JRdWV1ZVRyYWNrZXJzLmRlbGV0ZShqb2JJZClcbiAgICAgIH1cbiAgICAgIHRoaXMucG9vbGVkSm9iUXVldWVzLmRlbGV0ZShqb2JJZClcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogRnJlZSBwb29sZWQgc2xvdHMgYWNyb3NzIHRoZSBwb29sOiBvcGVuIHNsb3RzIGluIG5vbi1yZXRpcmluZyBjaGlsZHJlbiBwbHVzXG4gICAqIHRoZSBzbG90cyB3ZSBjb3VsZCBhZGQgYnkgc3Bhd25pbmcgbW9yZSBjaGlsZHJlbiB1cCB0byBgcG9vbGVkUnVubmVyQ291bnRgLlxuICAgKiBSZXRpcmluZyBjaGlsZHJlbiAoZHJhaW5pbmcgYmVmb3JlIHJlcGxhY2VtZW50KSBuZXZlciBjb250cmlidXRlIGNhcGFjaXR5LlxuICAgKiBAcmV0dXJucyB7bnVtYmVyfSAtIE51bWJlciBvZiBwb29sZWQgam9icyB0aGUgd29ya2VyIGNhbiBhY2NlcHQgcmlnaHQgbm93LlxuICAgKi9cbiAgX2F2YWlsYWJsZVBvb2xlZFNsb3RzKCkge1xuICAgIGxldCBvcGVuSW5FeGlzdGluZyA9IDBcbiAgICBsZXQgbm9uUmV0aXJpbmdDaGlsZHJlbiA9IDBcbiAgICBsZXQgcXVldWVkUmVzZXJ2YXRpb25zID0gMFxuXG4gICAgZm9yIChjb25zdCBjaGlsZCBvZiB0aGlzLnBvb2xlZENoaWxkcmVuKSB7XG4gICAgICBjb25zdCBzdGF0ZSA9IHRoaXMucG9vbGVkQ2hpbGRTdGF0ZXMuZ2V0KGNoaWxkKVxuICAgICAgaWYgKCFzdGF0ZSB8fCBzdGF0ZS5yZXRpcmluZykgY29udGludWVcbiAgICAgIG5vblJldGlyaW5nQ2hpbGRyZW4gKz0gMVxuICAgICAgb3BlbkluRXhpc3RpbmcgKz0gdGhpcy5wb29sZWRSdW5uZXJDb25jdXJyZW5jeSAtIHN0YXRlLmluZmxpZ2h0LnNpemVcbiAgICB9XG5cbiAgICBmb3IgKGNvbnN0IHF1ZXVlIG9mIHRoaXMucG9vbGVkSm9iUXVldWVzLnZhbHVlcygpKSBxdWV1ZWRSZXNlcnZhdGlvbnMgKz0gcXVldWUubGVuZ3RoXG5cbiAgICBjb25zdCBzcGF3bmFibGVDaGlsZHJlbiA9IE1hdGgubWF4KDAsIHRoaXMucG9vbGVkUnVubmVyQ291bnQgLSBub25SZXRpcmluZ0NoaWxkcmVuKVxuXG4gICAgcmV0dXJuIE1hdGgubWF4KDAsIG9wZW5JbkV4aXN0aW5nICsgc3Bhd25hYmxlQ2hpbGRyZW4gKiB0aGlzLnBvb2xlZFJ1bm5lckNvbmN1cnJlbmN5IC0gcXVldWVkUmVzZXJ2YXRpb25zKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgYSBwYXlsb2FkIG9uIGEgcG9vbGVkIGNoaWxkIHdpdGggYSBmcmVlIGNvbmN1cnJlbmN5IHNsb3QsIHNwYXduaW5nIGFcbiAgICogbmV3IGNoaWxkIHdoZW4gZXZlcnkgbm9uLXJldGlyaW5nIGNoaWxkIGlzIGZ1bGwgYW5kIHRoZSBwb29sIGlzIGJlbG93XG4gICAqIGBwb29sZWRSdW5uZXJDb3VudGAuIEVhY2ggY2hpbGQgcnVucyB1cCB0byBgcG9vbGVkUnVubmVyQ29uY3VycmVuY3lgIGpvYnMgYXRcbiAgICogb25jZSBvbiBpdHMgb3duIGV2ZW50IGxvb3AuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi90eXBlcy5qc1wiKS5CYWNrZ3JvdW5kSm9iUGF5bG9hZCAmIHtpZDogc3RyaW5nfX0gcGF5bG9hZCAtIEpvYiBwYXlsb2FkLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyBhZnRlciB0aGUgZHVyYWJsZSByZXBvcnQuXG4gICAqL1xuICBfcnVuUG9vbGVkSm9iKHBheWxvYWQpIHtcbiAgICBjb25zdCBjaGlsZCA9IHRoaXMuX3NlbGVjdFBvb2xlZENoaWxkKCkgfHwgdGhpcy5fY3JlYXRlUG9vbGVkQ2hpbGQoKVxuICAgIGNvbnN0IHN0YXRlID0gdGhpcy5wb29sZWRDaGlsZFN0YXRlcy5nZXQoY2hpbGQpXG4gICAgaWYgKCFzdGF0ZSkgdGhyb3cgbmV3IEVycm9yKFwiUG9vbGVkIHJ1bm5lciBzdGF0ZSBtaXNzaW5nXCIpXG5cbiAgICAvLyBTdGFtcCB0aGUgcm91bmQtcm9iaW4gY3Vyc29yIHNvIHRoZSBuZXh0IGRpc3BhdGNoIHByZWZlcnMgYSBkaWZmZXJlbnQgY2hpbGQuXG4gICAgc3RhdGUubGFzdERpc3BhdGNoU2VxID0gKyt0aGlzLl9wb29sZWREaXNwYXRjaFNlcVxuXG4gICAgLyoqXG4gICAgICogUmVzb2x2ZXMgdGhlIHBvb2xlZCBqb2IgcHJvbWlzZS5cbiAgICAgKiBAdHlwZSB7KHZhbHVlOiB2b2lkKSA9PiB2b2lkfVxuICAgICAqL1xuICAgIGxldCByZXNvbHZlUG9vbGVkSm9iID0gKCkgPT4ge31cbiAgICBjb25zdCBwb29sZWRKb2IgPSBuZXcgUHJvbWlzZSgocmVzb2x2ZSkgPT4geyByZXNvbHZlUG9vbGVkSm9iID0gcmVzb2x2ZSB9KVxuICAgIGNvbnN0IHRpbWVvdXRUaW1lciA9IHRoaXMuX2FybVBvb2xlZEpvYlRpbWVvdXQoe2NoaWxkLCBwYXlsb2FkfSlcblxuICAgIHN0YXRlLmluZmxpZ2h0LnNldChwYXlsb2FkLmlkLCB7cGF5bG9hZCwgcmVzb2x2ZTogcmVzb2x2ZVBvb2xlZEpvYiwgcG9vbGVkSm9iLCB0aW1lb3V0VGltZXJ9KVxuICAgIHRyeSB7XG4gICAgICBjaGlsZC5zZW5kKHt0eXBlOiBcImpvYlwiLCBwYXlsb2FkLCBzaGFyZWRUcmFuc2FjdGlvbkJyb2tlcjogdGhpcy5fcG9vbGVkSm9iU2hhcmVkVHJhbnNhY3Rpb25Ccm9rZXJDb25maWcoKX0pXG4gICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgIHZvaWQgdGhpcy5faGFuZGxlUG9vbGVkQ2hpbGRGYWlsdXJlKHtjaGlsZCwgZXJyb3IsIG9yaWdpbjogXCJpcGMtc2VuZFwifSlcbiAgICB9XG5cbiAgICByZXR1cm4gcG9vbGVkSm9iXG4gIH1cblxuICAvKipcbiAgICogQ2FwdHVyZXMgdGhlIGN1cnJlbnQgdGVzdCBhdHRlbXB0J3MgYnJva2VyIG1vZGUgYXQgZGlzcGF0Y2ggdGltZS4gQSB3YXJtXG4gICAqIHBvb2xlZCBjaGlsZCBtdXN0IG5ldmVyIHJlbHkgb24gaXRzIGltbXV0YWJsZSBmb3JrLXRpbWUgZW52aXJvbm1lbnQuXG4gICAqIEByZXR1cm5zIHtpbXBvcnQoXCIuLi90ZXN0aW5nL3NoYXJlZC10cmFuc2FjdGlvbi1wcm94eS1kcml2ZXIuanNcIikuU2hhcmVkVHJhbnNhY3Rpb25Ccm9rZXJKb2JDb25maWd9IC0gUGVyLWpvYiBicm9rZXIgY29uZmlndXJhdGlvbi5cbiAgICovXG4gIF9wb29sZWRKb2JTaGFyZWRUcmFuc2FjdGlvbkJyb2tlckNvbmZpZygpIHtcbiAgICBjb25zdCBzZXJpYWxpemVkID0gcHJvY2Vzcy5lbnYuVkVMT0NJT1VTX1RFU1RfU0hBUkVEX1RSQU5TQUNUSU9OX0JST0tFUlxuICAgIGlmICghc2VyaWFsaXplZCkgcmV0dXJuIHtleHBlY3RlZDogZmFsc2V9XG5cbiAgICBjb25zdCBjb25maWcgPSBKU09OLnBhcnNlKEJ1ZmZlci5mcm9tKHNlcmlhbGl6ZWQsIFwiYmFzZTY0dXJsXCIpLnRvU3RyaW5nKFwidXRmOFwiKSlcbiAgICByZXR1cm4gey4uLmNvbmZpZywgZXhwZWN0ZWQ6IHRydWV9XG4gIH1cblxuICAvKipcbiAgICogU2VsZWN0cyBhIHBvb2xlZCBjaGlsZCB0byBydW4gdGhlIG5leHQgam9iLCBvciB1bmRlZmluZWQgd2hlbiBldmVyeSBub24tcmV0aXJpbmdcbiAgICogY2hpbGQgaXMgYWxyZWFkeSBmdWxsICh0aGUgY2FsbGVyIHRoZW4gbGF6aWx5IHNwYXducyBvbmUpLiBBbW9uZyBjaGlsZHJlbiB3aXRoIGFcbiAgICogZnJlZSBjb25jdXJyZW5jeSBzbG90LCBwaWNrcyB0aGUgb25lIGRpc3BhdGNoZWQgbGVhc3QgcmVjZW50bHkg4oCUIGEgcm91bmQtcm9iaW4gdGhhdFxuICAgKiBzcHJlYWRzIGpvYnMgKG5vdGFibHkgbXVsdGktbWludXRlIFJ1bkJ1aWxkSm9icywgZWFjaCBwaW5uaW5nIGEgdGVuYW50IGNvbm5lY3Rpb25cbiAgICogZm9yIGl0cyB3aG9sZSBydW4pIGV2ZW5seSBhY3Jvc3MgY2hpbGRyZW4gaW5zdGVhZCBvZiBmaXJzdC1maXQgcGFja2luZyB0aGUgZWFybGllc3RcbiAgICogb25lIHVudGlsIGl0IGlzIGZ1bGwuIEEgZnJlc2hseSBzcGF3bmVkIG9yIHJlcGxhY2VtZW50IGNoaWxkIHRoZXJlZm9yZSB0YWtlcyBpdHNcbiAgICogZmFpciBzaGFyZSBvbmUgam9iIGF0IGEgdGltZSBhcyBpdHMgdHVybiBjb21lcyB1cCwgcmF0aGVyIHRoYW4gYWJzb3JiaW5nIGEgYnVyc3QgdG9cbiAgICogXCJjYXRjaCB1cFwiIHRvIHRoZSBvdGhlcnMuXG4gICAqIEByZXR1cm5zIHtpbXBvcnQoXCJub2RlOmNoaWxkX3Byb2Nlc3NcIikuQ2hpbGRQcm9jZXNzIHwgdW5kZWZpbmVkfSAtIFRoZSBjaG9zZW4gY2hpbGQsIG9yIHVuZGVmaW5lZCB3aGVuIGFsbCBub24tcmV0aXJpbmcgY2hpbGRyZW4gYXJlIGZ1bGwuXG4gICAqL1xuICBfc2VsZWN0UG9vbGVkQ2hpbGQoKSB7XG4gICAgLyoqIEB0eXBlIHtpbXBvcnQoXCJub2RlOmNoaWxkX3Byb2Nlc3NcIikuQ2hpbGRQcm9jZXNzIHwgdW5kZWZpbmVkfSAqL1xuICAgIGxldCBzZWxlY3RlZFxuICAgIGxldCBzZWxlY3RlZFNlcSA9IEluZmluaXR5XG5cbiAgICBmb3IgKGNvbnN0IGNoaWxkIG9mIHRoaXMucG9vbGVkQ2hpbGRyZW4pIHtcbiAgICAgIGNvbnN0IHN0YXRlID0gdGhpcy5wb29sZWRDaGlsZFN0YXRlcy5nZXQoY2hpbGQpXG5cbiAgICAgIGlmICghc3RhdGUgfHwgc3RhdGUucmV0aXJpbmcgfHwgc3RhdGUuaW5mbGlnaHQuc2l6ZSA+PSB0aGlzLnBvb2xlZFJ1bm5lckNvbmN1cnJlbmN5KSBjb250aW51ZVxuXG4gICAgICBpZiAoc3RhdGUubGFzdERpc3BhdGNoU2VxIDwgc2VsZWN0ZWRTZXEpIHtcbiAgICAgICAgc2VsZWN0ZWQgPSBjaGlsZFxuICAgICAgICBzZWxlY3RlZFNlcSA9IHN0YXRlLmxhc3REaXNwYXRjaFNlcVxuICAgICAgfVxuICAgIH1cblxuICAgIHJldHVybiBzZWxlY3RlZFxuICB9XG5cbiAgLyoqXG4gICAqIEFybXMgYSBwZXItam9iIHdhbGwtY2xvY2sgYmFja3N0b3AgZm9yIGEgcG9vbGVkIGpvYi4gQSBwb29sZWQgY2hpbGQgaG9zdHMgbWFueVxuICAgKiBjb25jdXJyZW50IGpvYnMsIHNvIGEgc2luZ2xlIGdlbnVpbmVseS1odW5nIGpvYiB3b3VsZCBvdGhlcndpc2UgcGluIGl0c1xuICAgKiBydW5uZXIncyBjb25jdXJyZW5jeSBzbG90IGZvcmV2ZXIg4oCUIHRoZSBsaWZldGltZSByZWN5Y2xlIG9ubHkgcmV0aXJlcyBhIGNoaWxkXG4gICAqIG9uY2UgaXRzIGluLWZsaWdodCBzZXQgZHJhaW5zLCB3aGljaCBhIGh1bmcgam9iIG5ldmVyIGRvZXMuIE9uIG92ZXJydW4gdGhlXG4gICAqIHdob2xlIGNoaWxkIGlzIHRlcm1pbmF0ZWQgc28gdGhlIGh1bmcgam9iIChhbmQgaXRzIHNpYmxpbmdzKSByZXF1ZXVlLiBSZXR1cm5zXG4gICAqIHRoZSB0aW1lciwgb3IgbnVsbCB3aGVuIG5vIHRpbWVvdXQgaXMgY29uZmlndXJlZC5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBPcHRpb25zLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIm5vZGU6Y2hpbGRfcHJvY2Vzc1wiKS5DaGlsZFByb2Nlc3N9IGFyZ3MuY2hpbGQgLSBQb29sZWQgY2hpbGQuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi90eXBlcy5qc1wiKS5CYWNrZ3JvdW5kSm9iUGF5bG9hZCAmIHtpZDogc3RyaW5nfX0gYXJncy5wYXlsb2FkIC0gSm9iIHBheWxvYWQgd2hvc2Ugb3ZlcnJ1biBpcyBndWFyZGVkLlxuICAgKiBAcmV0dXJucyB7UmV0dXJuVHlwZTx0eXBlb2Ygc2V0VGltZW91dD4gfCBudWxsfSAtIFRoZSBhcm1lZCB0aW1lciwgb3IgbnVsbC5cbiAgICovXG4gIF9hcm1Qb29sZWRKb2JUaW1lb3V0KHtjaGlsZCwgcGF5bG9hZH0pIHtcbiAgICBjb25zdCB0aW1lb3V0TXMgPSB0aGlzLl9yZXNvbHZlSm9iVGltZW91dE1zKHBheWxvYWQub3B0aW9ucylcblxuICAgIGlmICghKHR5cGVvZiB0aW1lb3V0TXMgPT09IFwibnVtYmVyXCIgJiYgdGltZW91dE1zID4gMCkpIHJldHVybiBudWxsXG5cbiAgICByZXR1cm4gc2V0VGltZW91dCgoKSA9PiB0aGlzLl9vblBvb2xlZEpvYlRpbWVvdXQoe2NoaWxkLCBqb2JJZDogcGF5bG9hZC5pZH0pLCB0aW1lb3V0TXMpXG4gIH1cblxuICAvKipcbiAgICogRmlyZWQgd2hlbiBhIHBvb2xlZCBqb2Igb3ZlcnJ1bnMgaXRzIHRpbWVvdXQuIFRlcm1pbmF0ZXMgdGhlIGNoaWxkIHJ1bm5pbmcgaXRcbiAgICogKFNJR1RFUk0sIHRoZW4gU0lHS0lMTCBhZnRlciB0aGUgZ3JhY2UpIOKAlCBhIGh1bmcgSlMgam9iIGNhbm5vdCBiZSBjYW5jZWxsZWRcbiAgICogYW55IG90aGVyIHdheS4gVGhlIG5vbi1jbGVhbiBleGl0IGZsb3dzIHRocm91Z2ggYF9oYW5kbGVQb29sZWRDaGlsZEZhaWx1cmVgLFxuICAgKiB3aGljaCByZXBvcnRzIGV2ZXJ5IGluLWZsaWdodCBqb2Igb24gdGhlIGNoaWxkIGZhaWxlZCAoc28gdGhleSByZXF1ZXVlKSBhbmRcbiAgICogZHJvcHMgaXQgZnJvbSB0cmFja2luZzsgdGhlIGZhaWx1cmUgcGF0aCBpbW1lZGlhdGVseSByZS1hZHZlcnRpc2VzIHRoZVxuICAgKiByZXN1bHRpbmcgY2FwYWNpdHkgb25jZSB0aGUgcnVubmVyIGhhcyBjb21wbGV0ZWQgc3RhcnR1cC5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBPcHRpb25zLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIm5vZGU6Y2hpbGRfcHJvY2Vzc1wiKS5DaGlsZFByb2Nlc3N9IGFyZ3MuY2hpbGQgLSBQb29sZWQgY2hpbGQuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBhcmdzLmpvYklkIC0gSm9iIGlkIHRoYXQgb3ZlcnJhbi5cbiAgICogQHJldHVybnMge3ZvaWR9XG4gICAqL1xuICBfb25Qb29sZWRKb2JUaW1lb3V0KHtjaGlsZCwgam9iSWR9KSB7XG4gICAgY29uc3Qgc3RhdGUgPSB0aGlzLnBvb2xlZENoaWxkU3RhdGVzLmdldChjaGlsZClcblxuICAgIC8vIEFscmVhZHkgc2V0dGxpbmcvZ29uZSwgb3IgdGhlIGpvYiBmaW5pc2hlZCBpbiB0aGUgcmFjZSB3aXRoIHRoaXMgdGltZXIuXG4gICAgaWYgKCFzdGF0ZSB8fCBzdGF0ZS5zZXR0bGluZyB8fCBzdGF0ZS5zaHV0ZG93blJlYXNvbiB8fCAhc3RhdGUuaW5mbGlnaHQuaGFzKGpvYklkKSkgcmV0dXJuXG5cbiAgICBzdGF0ZS50aW1lb3V0Sm9iSWQgPSBqb2JJZFxuICAgIHRoaXMuX3JlcXVlc3RQb29sZWRDaGlsZFNodXRkb3duKHtjaGlsZCwgcmVhc29uOiBcImpvYl90aW1lb3V0XCIsIHNpZ25hbDogXCJTSUdURVJNXCJ9KVxuXG4gICAgc3RhdGUudGltZW91dFNpZ2tpbGxUaW1lciA9IHNldFRpbWVvdXQoKCkgPT4ge1xuICAgICAgdHJ5IHtcbiAgICAgICAgY2hpbGQua2lsbChcIlNJR0tJTExcIilcbiAgICAgIH0gY2F0Y2gge1xuICAgICAgICAvLyBDaGlsZCBhbHJlYWR5IGV4aXRlZDsgbm90aGluZyB0byBkby5cbiAgICAgIH1cbiAgICB9LCB0aGlzLmZvcmtlZENoaWxkU2lna2lsbEdyYWNlTXMpXG4gIH1cblxuICAvKipcbiAgICogQ3JlYXRlcyBhIHJldXNhYmxlIHBvb2xlZCBjaGlsZC5cbiAgICogQHJldHVybnMge2ltcG9ydChcIm5vZGU6Y2hpbGRfcHJvY2Vzc1wiKS5DaGlsZFByb2Nlc3N9IC0gTmV3IHBvb2xlZCBjaGlsZC5cbiAgICovXG4gIF9jcmVhdGVQb29sZWRDaGlsZCgpIHtcbiAgICBjb25zdCBjb25maWd1cmF0aW9uID0gdGhpcy5jb25maWd1cmF0aW9uXG4gICAgaWYgKCFjb25maWd1cmF0aW9uKSB0aHJvdyBuZXcgRXJyb3IoXCJCYWNrZ3JvdW5kIGpvYnMgd29ya2VyIGNvbmZpZ3VyYXRpb24gbm90IGluaXRpYWxpemVkXCIpXG4gICAgY29uc3QgY2hpbGQgPSBmb3JrKFBPT0xFRF9SVU5ORVJfRU5UUllfUEFUSCwgW10sIHtcbiAgICAgIGN3ZDogY29uZmlndXJhdGlvbi5nZXREaXJlY3RvcnkoKSwgZXhlY0FyZ3Y6IFtdLCBzdGRpbzogW1wiaWdub3JlXCIsIFwiaWdub3JlXCIsIFwiaWdub3JlXCIsIFwiaXBjXCJdLFxuICAgICAgZW52OiBPYmplY3QuYXNzaWduKHt9LCBwcm9jZXNzLmVudiwgdGhpcy5fY2hpbGRCYWNrZ3JvdW5kSm9ic0Vudmlyb25tZW50KCkpXG4gICAgfSlcbiAgICB0aGlzLnBvb2xlZENoaWxkcmVuLmFkZChjaGlsZClcbiAgICB0aGlzLmluZmxpZ2h0UHJvY2Vzc0NoaWxkcmVuLmFkZChjaGlsZClcbiAgICB0aGlzLnBvb2xlZENoaWxkU3RhdGVzLnNldChjaGlsZCwge2NyZWF0ZWRBdE1zOiBEYXRlLm5vdygpLCBqb2JzUnVuOiAwLCBpbmZsaWdodDogbmV3IE1hcCgpLCBsYXN0RGlzcGF0Y2hTZXE6IDAsIHJldGlyaW5nOiBmYWxzZSwgc3RhcnRlZDogZmFsc2V9KVxuICAgIGNoaWxkLm9uKFwibWVzc2FnZVwiLCAobWVzc2FnZSkgPT4gdGhpcy5faGFuZGxlUG9vbGVkQ2hpbGRNZXNzYWdlKHtjaGlsZCwgbWVzc2FnZX0pKVxuICAgIGNoaWxkLm9uY2UoXCJleGl0XCIsIChleGl0Q29kZSwgc2lnbmFsKSA9PiB0aGlzLl9oYW5kbGVQb29sZWRDaGlsZEZhaWx1cmUoe1xuICAgICAgY2hpbGQsXG4gICAgICBlcnJvcjogbmV3IEVycm9yKGBQb29sZWQgYmFja2dyb3VuZCBqb2IgcnVubmVyIGV4aXRlZDogY29kZT0ke2V4aXRDb2RlfSBzaWduYWw9JHtzaWduYWwgfHwgXCJub25lXCJ9YCksXG4gICAgICBleGl0Q29kZSxcbiAgICAgIG9yaWdpbjogXCJleGl0XCIsXG4gICAgICBzaWduYWxcbiAgICB9KSlcbiAgICBjaGlsZC5vbmNlKFwiZXJyb3JcIiwgKGVycm9yKSA9PiB0aGlzLl9oYW5kbGVQb29sZWRDaGlsZEZhaWx1cmUoe1xuICAgICAgY2hpbGQsXG4gICAgICBlcnJvcixcbiAgICAgIGV4aXRDb2RlOiBjaGlsZC5leGl0Q29kZSxcbiAgICAgIG9yaWdpbjogXCJwcm9jZXNzLWVycm9yXCIsXG4gICAgICBzaWduYWw6IGNoaWxkLnNpZ25hbENvZGVcbiAgICB9KSlcbiAgICBjaGlsZC5vbmNlKFwiZGlzY29ubmVjdFwiLCAoKSA9PiB7XG4gICAgICBjb25zdCBzdGF0ZSA9IHRoaXMucG9vbGVkQ2hpbGRTdGF0ZXMuZ2V0KGNoaWxkKVxuICAgICAgaWYgKHN0YXRlKSBzdGF0ZS5pcGNEaXNjb25uZWN0ZWRBdE1zID8/PSBEYXRlLm5vdygpXG4gICAgfSlcbiAgICByZXR1cm4gY2hpbGRcbiAgfVxuXG4gIC8qKlxuICAgKiBIYW5kbGVzIGEgcG9vbGVkIGNoaWxkJ3MgcGVyLWpvYiBkdXJhYmxlLXJlcG9ydCBhY2tub3dsZWRnZW1lbnQuIEEgY2hpbGRcbiAgICogcnVucyBqb2JzIGNvbmN1cnJlbnRseSBhbmQgcmVwb3J0cyBvbmUgYGpvYi1vdXRjb21lYCBwZXIgam9iIGlkLlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIE1lc3NhZ2UgZGV0YWlscy5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCJub2RlOmNoaWxkX3Byb2Nlc3NcIikuQ2hpbGRQcm9jZXNzfSBhcmdzLmNoaWxkIC0gUG9vbGVkIGNoaWxkLlxuICAgKiBAcGFyYW0ge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSBhcmdzLm1lc3NhZ2UgLSBJUEMgbWVzc2FnZS5cbiAgICogQHJldHVybnMge3ZvaWR9XG4gICAqL1xuICBfaGFuZGxlUG9vbGVkQ2hpbGRNZXNzYWdlKHtjaGlsZCwgbWVzc2FnZX0pIHtcbiAgICBpZiAoIW1lc3NhZ2UgfHwgdHlwZW9mIG1lc3NhZ2UgIT09IFwib2JqZWN0XCIpIHJldHVyblxuICAgIGNvbnN0IHJlY29yZCA9IC8qKiBAdHlwZSB7e3R5cGU/OiBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPiwgY2hpbGRJbnN0YW5jZUlkPzogUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4sIGpvYklkPzogUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4sIGFja25vd2xlZGdlZD86IFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+LCByc3NCeXRlcz86IFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+LCBlcnJvcj86IFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fX0gKi8gKG1lc3NhZ2UpXG4gICAgY29uc3Qgc3RhdGUgPSB0aGlzLnBvb2xlZENoaWxkU3RhdGVzLmdldChjaGlsZClcbiAgICBpZiAocmVjb3JkLnR5cGUgPT09IFwicmVhZHlcIikge1xuICAgICAgaWYgKHN0YXRlKSB7XG4gICAgICAgIHN0YXRlLnN0YXJ0ZWQgPSB0cnVlXG4gICAgICAgIGlmICh0eXBlb2YgcmVjb3JkLmNoaWxkSW5zdGFuY2VJZCA9PT0gXCJzdHJpbmdcIikgc3RhdGUuY2hpbGRJbnN0YW5jZUlkID0gcmVjb3JkLmNoaWxkSW5zdGFuY2VJZFxuICAgICAgfVxuICAgICAgcmV0dXJuXG4gICAgfVxuICAgIGlmIChpc0NoaWxkU2h1dGRvd25PYnNlcnZhdGlvbk1lc3NhZ2UobWVzc2FnZSkpIHtcbiAgICAgIGlmIChzdGF0ZSkge1xuICAgICAgICBzdGF0ZS5jaGlsZEluc3RhbmNlSWQgPSBtZXNzYWdlLmNoaWxkSW5zdGFuY2VJZFxuICAgICAgICBzdGF0ZS5zaHV0ZG93bk9ic2VydmF0aW9uID0gbWVzc2FnZVxuICAgICAgICBpZiAoc3RhdGUuc2h1dGRvd25TaWduYWxUaW1lcikge1xuICAgICAgICAgIGNsZWFyVGltZW91dChzdGF0ZS5zaHV0ZG93blNpZ25hbFRpbWVyKVxuICAgICAgICAgIHN0YXRlLnNodXRkb3duU2lnbmFsVGltZXIgPSB1bmRlZmluZWRcbiAgICAgICAgfVxuICAgICAgfVxuICAgICAgcmV0dXJuXG4gICAgfVxuICAgIGlmIChpc0NoaWxkQWNjZXB0YW5jZU1lc3NhZ2UobWVzc2FnZSkpIHtcbiAgICAgIHRoaXMuX3JlcG9ydENoaWxkQWNjZXB0ZWQobWVzc2FnZSlcbiAgICAgIHJldHVyblxuICAgIH1cbiAgICBpZiAocmVjb3JkLnR5cGUgIT09IFwiam9iLW91dGNvbWVcIiB8fCAhc3RhdGUgfHwgc3RhdGUuc2V0dGxpbmcgfHwgdHlwZW9mIHJlY29yZC5qb2JJZCAhPT0gXCJzdHJpbmdcIikgcmV0dXJuXG4gICAgc3RhdGUuc3RhcnRlZCA9IHRydWVcbiAgICBjb25zdCBlbnRyeSA9IHN0YXRlLmluZmxpZ2h0LmdldChyZWNvcmQuam9iSWQpXG4gICAgaWYgKCFlbnRyeSkgcmV0dXJuXG5cbiAgICBpZiAoZW50cnkudGltZW91dFRpbWVyKSBjbGVhclRpbWVvdXQoZW50cnkudGltZW91dFRpbWVyKVxuICAgIHN0YXRlLmluZmxpZ2h0LmRlbGV0ZShyZWNvcmQuam9iSWQpXG4gICAgc3RhdGUuam9ic1J1biArPSAxXG4gICAgY29uc3QgcmVzb2x2ZSA9IGVudHJ5LnJlc29sdmVcblxuICAgIGlmIChyZWNvcmQuYWNrbm93bGVkZ2VkID09PSB0cnVlKSB7XG4gICAgICBpZiAocmVzb2x2ZSkgcmVzb2x2ZSh1bmRlZmluZWQpXG4gICAgfSBlbHNlIHtcbiAgICAgIC8vIFRoZSBjaGlsZCBzdGF5ZWQgYWxpdmUgYnV0IGNvdWxkIG5vdCBjb25maXJtIHRoaXMgb25lIGpvYidzIHRlcm1pbmFsXG4gICAgICAvLyByZXBvcnQ7IHJlY2xhaW0ganVzdCB0aGlzIGpvYiDigJQgaXRzIGNvbmN1cnJlbnQgc2libGluZ3MgYXJlIHVuYWZmZWN0ZWQuXG4gICAgICB2b2lkIHRoaXMuX3JlcG9ydEpvYlJlc3VsdCh7XG4gICAgICAgIGpvYklkOiBlbnRyeS5wYXlsb2FkLmlkLFxuICAgICAgICBzdGF0dXM6IFwiZmFpbGVkXCIsXG4gICAgICAgIGVycm9yOiBuZXcgRXJyb3IodHlwZW9mIHJlY29yZC5lcnJvciA9PT0gXCJzdHJpbmdcIiA/IHJlY29yZC5lcnJvciA6IFwiUG9vbGVkIHJ1bm5lciB0ZXJtaW5hbCByZXBvcnQgd2FzIG5vdCBhY2tub3dsZWRnZWRcIiksXG4gICAgICAgIGhhbmRvZmZJZDogZW50cnkucGF5bG9hZC5oYW5kb2ZmSWQsXG4gICAgICAgIGhhbmRlZE9mZkF0TXM6IGVudHJ5LnBheWxvYWQuaGFuZGVkT2ZmQXRNcyxcbiAgICAgICAgd29ya2VySWQ6IGVudHJ5LnBheWxvYWQud29ya2VySWQgfHwgdGhpcy53b3JrZXJJZFxuICAgICAgfSkuZmluYWxseSgoKSA9PiB7IGlmIChyZXNvbHZlKSByZXNvbHZlKHVuZGVmaW5lZCkgfSlcbiAgICB9XG5cbiAgICBjb25zdCByc3NCeXRlcyA9IHR5cGVvZiByZWNvcmQucnNzQnl0ZXMgPT09IFwibnVtYmVyXCIgPyByZWNvcmQucnNzQnl0ZXMgOiBOdW1iZXIuUE9TSVRJVkVfSU5GSU5JVFlcbiAgICBjb25zdCBydW5uZXJBZ2VNcyA9IERhdGUubm93KCkgLSBzdGF0ZS5jcmVhdGVkQXRNc1xuICAgIGlmICghc3RhdGUucmV0aXJpbmcgJiYgKHN0YXRlLmpvYnNSdW4gPj0gdGhpcy5wb29sZWRSdW5uZXJNYXhKb2JzIHx8IHJzc0J5dGVzID49IHRoaXMucG9vbGVkUnVubmVyTWF4UnNzQnl0ZXMgfHwgcnVubmVyQWdlTXMgPj0gdGhpcy5wb29sZWRSdW5uZXJNYXhMaWZldGltZU1zIHx8IHRoaXMuc2hvdWxkU3RvcCkpIHtcbiAgICAgIHRoaXMuX2JlZ2luUmV0aXJlUG9vbGVkQ2hpbGQoY2hpbGQpXG4gICAgfVxuICAgIHRoaXMuX3Rlcm1pbmF0ZUlmRHJhaW5lZChjaGlsZClcbiAgfVxuXG4gIC8qKlxuICAgKiBGb3J3YXJkcyBvbmUgcG9vbGVkIGNoaWxkJ3MgYWNjZXB0YW5jZSBvYnNlcnZhdGlvbiB0byBtYWluIGFzIGEgYm91bmRlZFxuICAgKiBkaWFnbm9zdGljIHJlcG9ydC4gVGhlIGNoaWxkIGNhcnJpZXMgaXRzIGV4YWN0IGhhbmRvZmYgbGVhc2UsIHNvIGEgdGltZW91dFxuICAgKiBvciBvdXRjb21lIHRoYXQgYWxyZWFkeSBzZXR0bGVkIHRoZSB3b3JrZXIncyBpbi1mbGlnaHQgZW50cnkgY2Fubm90IGxvc2VcbiAgICogdGhlIGZlbmNpbmcuIEEgcmVwb3J0IHRoYXQgbmV2ZXIgbGFuZHMgZGVncmFkZXMgcGhhc2UgZGlhZ25vc3RpY3MgZm9yIHRoYXRcbiAgICogam9iIG9ubHkg4oCUIGl0IG11c3QgbmV2ZXIgYmxvY2sgb3IgZmFpbCB0aGUgam9iIGl0c2VsZi5cbiAgICogQHBhcmFtIHt7dHlwZTogXCJqb2ItcmVjZWl2ZWRcIiB8IFwiam9iLXN0YXJ0ZWRcIiwgam9iSWQ6IHN0cmluZywgaGFuZG9mZklkPzogc3RyaW5nLCB3b3JrZXJJZD86IHN0cmluZywgaGFuZGVkT2ZmQXRNcz86IG51bWJlciwgcmVjZWl2ZWRBdE1zPzogbnVtYmVyLCBzdGFydGVkQXRNcz86IG51bWJlciwgY2hpbGRJbnN0YW5jZUlkPzogc3RyaW5nLCBjaGlsZFBpZD86IG51bWJlcn19IG1lc3NhZ2UgLSBWYWxpZGF0ZWQgY2hpbGQgYWNjZXB0YW5jZSBtZXNzYWdlLlxuICAgKiBAcmV0dXJucyB7dm9pZH1cbiAgICovXG4gIF9yZXBvcnRDaGlsZEFjY2VwdGVkKG1lc3NhZ2UpIHtcbiAgICBpZiAoIXRoaXMuc3RhdHVzUmVwb3J0ZXIpIHJldHVyblxuXG4gICAgdm9pZCB0aGlzLnN0YXR1c1JlcG9ydGVyLnJlcG9ydENoaWxkQWNjZXB0ZWRXaXRoUmV0cnkoe1xuICAgICAgam9iSWQ6IG1lc3NhZ2Uuam9iSWQsXG4gICAgICBoYW5kb2ZmSWQ6IG1lc3NhZ2UuaGFuZG9mZklkLFxuICAgICAgd29ya2VySWQ6IG1lc3NhZ2Uud29ya2VySWQsXG4gICAgICBoYW5kZWRPZmZBdE1zOiBtZXNzYWdlLmhhbmRlZE9mZkF0TXMsXG4gICAgICByZWNlaXZlZEF0TXM6IG1lc3NhZ2UucmVjZWl2ZWRBdE1zLFxuICAgICAgc3RhcnRlZEF0TXM6IG1lc3NhZ2Uuc3RhcnRlZEF0TXMsXG4gICAgICBjaGlsZEluc3RhbmNlSWQ6IG1lc3NhZ2UuY2hpbGRJbnN0YW5jZUlkLFxuICAgICAgY2hpbGRQaWQ6IG1lc3NhZ2UuY2hpbGRQaWQsXG4gICAgICBtYXhEdXJhdGlvbk1zOiBDSElMRF9BQ0NFUFRBTkNFX1JFUE9SVF9NQVhfRFVSQVRJT05fTVNcbiAgICB9KS5jYXRjaCgoZXJyb3IpID0+IHtcbiAgICAgIGNvbnNvbGUuZXJyb3IoXCJCYWNrZ3JvdW5kIGpvYiBjaGlsZC1hY2NlcHRhbmNlIHJlcG9ydGluZyBmYWlsZWQ6XCIsIGVycm9yKVxuICAgIH0pXG4gIH1cblxuICAvKipcbiAgICogTWFya3MgYSBwb29sZWQgY2hpbGQgZm9yIHJldGlyZW1lbnQgYW5kIGVhZ2VybHkgc3Bhd25zIGEgc2luZ2xlIHJlcGxhY2VtZW50XG4gICAqICgxLWZvci0xKSBzbyBpdHMgY2FwYWNpdHkgaXMgcmVzdG9yZWQgaW1tZWRpYXRlbHkgd2l0aG91dCB3YWl0aW5nIGZvciBpdCB0b1xuICAgKiBmaW5pc2ggZHJhaW5pbmcuIFRoZSByZXRpcmluZyBjaGlsZCBzdG9wcyByZWNlaXZpbmcgbmV3IGpvYnMgYW5kIGlzXG4gICAqIHRlcm1pbmF0ZWQgb25seSBvbmNlIGl0cyBpbi1mbGlnaHQgc2V0IGRyYWlucywgc28gYSBsb25nLXJ1bm5pbmcgam9iIChlLmcuIGFcbiAgICogYnVpbGQpIGlzIG5ldmVyIGN1dCBvZmYuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwibm9kZTpjaGlsZF9wcm9jZXNzXCIpLkNoaWxkUHJvY2Vzc30gY2hpbGQgLSBDaGlsZCB0byByZXRpcmUuXG4gICAqIEByZXR1cm5zIHt2b2lkfVxuICAgKi9cbiAgX2JlZ2luUmV0aXJlUG9vbGVkQ2hpbGQoY2hpbGQpIHtcbiAgICBjb25zdCBzdGF0ZSA9IHRoaXMucG9vbGVkQ2hpbGRTdGF0ZXMuZ2V0KGNoaWxkKVxuICAgIGlmICghc3RhdGUgfHwgc3RhdGUucmV0aXJpbmcpIHJldHVyblxuXG4gICAgc3RhdGUucmV0aXJpbmcgPSB0cnVlXG4gICAgLy8gQmVzdC1lZmZvcnQgcHJlLXdhcm06IHNraXAgd2hlbiBzdG9wcGluZyAobm8gbmV3IHdvcmspIG9yIGJlZm9yZSB0aGVcbiAgICAvLyB3b3JrZXIgaXMgaW5pdGlhbGl6ZWQgKG5vIGNvbmZpZ3VyYXRpb24gdG8gZm9yayBhIGNoaWxkIGZyb20pLlxuICAgIGlmICghdGhpcy5zaG91bGRTdG9wICYmIHRoaXMuY29uZmlndXJhdGlvbikgdGhpcy5fY3JlYXRlUG9vbGVkQ2hpbGQoKVxuICB9XG5cbiAgLyoqXG4gICAqIFRlcm1pbmF0ZXMgYSByZXRpcmluZyBwb29sZWQgY2hpbGQgb25jZSBpdCBoYXMgbm8gaW4tZmxpZ2h0IGpvYnMgbGVmdC5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCJub2RlOmNoaWxkX3Byb2Nlc3NcIikuQ2hpbGRQcm9jZXNzfSBjaGlsZCAtIENoaWxkIHRvIGNoZWNrLlxuICAgKiBAcmV0dXJucyB7dm9pZH1cbiAgICovXG4gIF90ZXJtaW5hdGVJZkRyYWluZWQoY2hpbGQpIHtcbiAgICBjb25zdCBzdGF0ZSA9IHRoaXMucG9vbGVkQ2hpbGRTdGF0ZXMuZ2V0KGNoaWxkKVxuICAgIGlmICghc3RhdGUgfHwgIXN0YXRlLnJldGlyaW5nIHx8IHN0YXRlLmluZmxpZ2h0LnNpemUgPiAwKSByZXR1cm5cblxuICAgIHRoaXMuX3JldGlyZVBvb2xlZENoaWxkKGNoaWxkKVxuICB9XG5cbiAgLyoqXG4gICAqIFJldGlyZXMgYSBkcmFpbmVkIHBvb2xlZCBjaGlsZCAocmVtb3ZlcyBpdCBmcm9tIHRyYWNraW5nLCB0aGVuIFNJR1RFUk1zIGl0KS5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCJub2RlOmNoaWxkX3Byb2Nlc3NcIikuQ2hpbGRQcm9jZXNzfSBjaGlsZCAtIENoaWxkIHByb2Nlc3MgdG8gcmV0aXJlLlxuICAgKiBAcmV0dXJucyB7dm9pZH1cbiAgICovXG4gIF9yZXRpcmVQb29sZWRDaGlsZChjaGlsZCkge1xuICAgIGNvbnN0IHN0YXRlID0gdGhpcy5wb29sZWRDaGlsZFN0YXRlcy5nZXQoY2hpbGQpXG4gICAgaWYgKCFzdGF0ZSkgdGhyb3cgbmV3IEVycm9yKFwiQ2Fubm90IHJldGlyZSBwb29sZWQgY2hpbGQgd2l0aG91dCB0cmFja2VkIHN0YXRlXCIpXG4gICAgaWYgKHN0YXRlLmluZmxpZ2h0LnNpemUgPiAwKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoYENhbm5vdCByZXRpcmUgcG9vbGVkIGNoaWxkIHdoaWxlICR7c3RhdGUuaW5mbGlnaHQuc2l6ZX0gJHtzdGF0ZS5pbmZsaWdodC5zaXplID09PSAxID8gXCJqb2IgcmVtYWluc1wiIDogXCJqb2JzIHJlbWFpblwifSBpbiBmbGlnaHRgKVxuICAgIH1cblxuICAgIHRoaXMucG9vbGVkQ2hpbGRyZW4uZGVsZXRlKGNoaWxkKVxuICAgIHN0YXRlLnJldGlyaW5nID0gdHJ1ZVxuICAgIHRoaXMuX3JlcXVlc3RQb29sZWRDaGlsZFNodXRkb3duKHtjaGlsZCwgcmVhc29uOiBcInBhcmVudF9yZXRpcmVfZHJhaW5lZFwiLCBzaWduYWw6IFwiU0lHVEVSTVwiLCB3YWl0Rm9yT2JzZXJ2YXRpb246IHRydWV9KVxuICB9XG5cbiAgLyoqXG4gICAqIFJlY29yZHMgYW4gZXhhY3QgcGFyZW50IHJlcXVlc3QgYmVmb3JlIElQQyBvciBzaWduYWwgZGVsaXZlcnkuIERyYWluZWRcbiAgICogcmV0aXJlbWVudCBnZXRzIGEgYnJpZWYgSVBDLWZpcnN0IGdyYWNlIHNvIGl0cyB6ZXJvLWpvYiBvYnNlcnZhdGlvbiBpc1xuICAgKiBkZXRlcm1pbmlzdGljOyB0aW1lb3V0L3dvcmtlci1zdG9wIHBhdGhzIHNpZ25hbCBpbW1lZGlhdGVseS5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBTaHV0ZG93biByZXF1ZXN0LlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIm5vZGU6Y2hpbGRfcHJvY2Vzc1wiKS5DaGlsZFByb2Nlc3N9IGFyZ3MuY2hpbGQgLSBQb29sZWQgY2hpbGQuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi90eXBlcy5qc1wiKS5Qb29sZWRDaGlsZFNodXRkb3duUmVhc29ufSBhcmdzLnJlYXNvbiAtIEV4YWN0IHBhcmVudCByZWFzb24uXG4gICAqIEBwYXJhbSB7a2V5b2YgdHlwZW9mIGltcG9ydChcIm5vZGU6b3NcIikuY29uc3RhbnRzLnNpZ25hbHN9IGFyZ3Muc2lnbmFsIC0gU2lnbmFsIHRvIGRlbGl2ZXIuXG4gICAqIEBwYXJhbSB7Ym9vbGVhbn0gW2FyZ3Mud2FpdEZvck9ic2VydmF0aW9uXSAtIFdoZXRoZXIgSVBDIG9ic2VydmF0aW9uIG1heSBwcmVjZWRlIHNpZ25hbCBmYWxsYmFjay5cbiAgICogQHJldHVybnMge3ZvaWR9XG4gICAqL1xuICBfcmVxdWVzdFBvb2xlZENoaWxkU2h1dGRvd24oe2NoaWxkLCByZWFzb24sIHNpZ25hbCwgd2FpdEZvck9ic2VydmF0aW9uID0gZmFsc2V9KSB7XG4gICAgY29uc3Qgc3RhdGUgPSB0aGlzLnBvb2xlZENoaWxkU3RhdGVzLmdldChjaGlsZClcbiAgICBpZiAoIXN0YXRlIHx8IHN0YXRlLnNldHRsaW5nIHx8IHN0YXRlLnNodXRkb3duUmVhc29uKSByZXR1cm5cblxuICAgIGNvbnN0IHNodXRkb3duUmVxdWVzdGVkQXRNcyA9IERhdGUubm93KClcbiAgICBzdGF0ZS5zaHV0ZG93blJlYXNvbiA9IHJlYXNvblxuICAgIHN0YXRlLnNodXRkb3duUmVxdWVzdGVkQXRNcyA9IHNodXRkb3duUmVxdWVzdGVkQXRNc1xuICAgIHN0YXRlLnNodXRkb3duU2lnbmFsID0gc2lnbmFsXG5cbiAgICBsZXQgcmVxdWVzdFNlbnQgPSBmYWxzZVxuICAgIGlmIChjaGlsZC5jb25uZWN0ZWQpIHtcbiAgICAgIHRyeSB7XG4gICAgICAgIGNoaWxkLnNlbmQoe3R5cGU6IFwic2h1dGRvd24tcmVxdWVzdFwiLCByZWFzb24sIHNodXRkb3duUmVxdWVzdGVkQXRNcywgc2lnbmFsfSwgKGVycm9yKSA9PiB7XG4gICAgICAgICAgaWYgKCFlcnJvciB8fCAhd2FpdEZvck9ic2VydmF0aW9uIHx8IHN0YXRlLnNldHRsaW5nKSByZXR1cm5cblxuICAgICAgICAgIGlmIChzdGF0ZS5zaHV0ZG93blNpZ25hbFRpbWVyKSB7XG4gICAgICAgICAgICBjbGVhclRpbWVvdXQoc3RhdGUuc2h1dGRvd25TaWduYWxUaW1lcilcbiAgICAgICAgICAgIHN0YXRlLnNodXRkb3duU2lnbmFsVGltZXIgPSB1bmRlZmluZWRcbiAgICAgICAgICB9XG4gICAgICAgICAgdGhpcy5fc2lnbmFsUG9vbGVkQ2hpbGQoe2NoaWxkLCBzaWduYWx9KVxuICAgICAgICB9KVxuICAgICAgICByZXF1ZXN0U2VudCA9IHRydWVcbiAgICAgIH0gY2F0Y2gge1xuICAgICAgICAvLyBUaGUgc2lnbmFsIGJlbG93IHJlbWFpbnMgdGhlIGJvdW5kZWQgc2h1dGRvd24gbWVjaGFuaXNtLlxuICAgICAgfVxuICAgIH1cblxuICAgIGlmICh3YWl0Rm9yT2JzZXJ2YXRpb24gJiYgcmVxdWVzdFNlbnQpIHtcbiAgICAgIHN0YXRlLnNodXRkb3duU2lnbmFsVGltZXIgPSBzZXRUaW1lb3V0KCgpID0+IHtcbiAgICAgICAgc3RhdGUuc2h1dGRvd25TaWduYWxUaW1lciA9IHVuZGVmaW5lZFxuICAgICAgICB0aGlzLl9zaWduYWxQb29sZWRDaGlsZCh7Y2hpbGQsIHNpZ25hbH0pXG4gICAgICB9LCBQT09MRURfUlVOTkVSX1NIVVRET1dOX1JFUVVFU1RfR1JBQ0VfTVMpXG4gICAgICBzdGF0ZS5zaHV0ZG93blNpZ25hbFRpbWVyLnVucmVmKClcbiAgICAgIHJldHVyblxuICAgIH1cblxuICAgIHRoaXMuX3NpZ25hbFBvb2xlZENoaWxkKHtjaGlsZCwgc2lnbmFsfSlcbiAgfVxuXG4gIC8qKlxuICAgKiBEZWxpdmVycyBvbmUgcGFyZW50LW93bmVkIHByb2Nlc3Mgc2lnbmFsIHdpdGhvdXQgY2hhbmdpbmcgcmVjb3JkZWQgcHJvdmVuYW5jZS5cbiAgICogQHBhcmFtIHt7Y2hpbGQ6IGltcG9ydChcIm5vZGU6Y2hpbGRfcHJvY2Vzc1wiKS5DaGlsZFByb2Nlc3MsIHNpZ25hbDoga2V5b2YgdHlwZW9mIGltcG9ydChcIm5vZGU6b3NcIikuY29uc3RhbnRzLnNpZ25hbHN9fSBhcmdzIC0gU2lnbmFsIHJlcXVlc3QuXG4gICAqIEByZXR1cm5zIHt2b2lkfVxuICAgKi9cbiAgX3NpZ25hbFBvb2xlZENoaWxkKHtjaGlsZCwgc2lnbmFsfSkge1xuICAgIHRyeSB7XG4gICAgICBjaGlsZC5raWxsKHNpZ25hbClcbiAgICB9IGNhdGNoIHtcbiAgICAgIC8vIENoaWxkIGFscmVhZHkgZXhpdGVkOyBpdHMgZXhpdC9lcnJvciBoYW5kbGVyIG93bnMgc3RhdGUgc2V0dGxlbWVudC5cbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogUmVtb3ZlcyBhbiBleGl0ZWQvdW5oZWFsdGh5IHBvb2xlZCBjaGlsZCBhbmQgcmVwb3J0cyBldmVyeSBqb2IgdGhhdCB3YXNcbiAgICogaW4tZmxpZ2h0IG9uIGl0IGFzIGZhaWxlZCDigJQgYSBwcm9jZXNzLWxldmVsIGNyYXNoJ3MgYmxhc3QgcmFkaXVzIGlzIHRoZVxuICAgKiBjaGlsZCdzIHdob2xlIGluLWZsaWdodCBzZXQuIE9uY2UgdGhlIGNoaWxkIGhhcyBjb21wbGV0ZWQgc3RhcnR1cCwgaXRzXG4gICAqIGZyZWVkIGNhcGFjaXR5IGlzIGFkdmVydGlzZWQgaW1tZWRpYXRlbHk7IHRoZSByZXBsYWNlbWVudCBpdHNlbGYgaXMgc3RpbGxcbiAgICogc3Bhd25lZCBsYXppbHkgYnkgdGhlIG5leHQgZGlzcGF0Y2guIEEgY2hpbGQgdGhhdCBleGl0cyBiZWZvcmUgaXRzIHN0YXJ0dXBcbiAgICogaGFuZHNoYWtlIGRvZXMgbm90IHJlLWFubm91bmNlLCBhdm9pZGluZyBhIHRpZ2h0IHJlc3Bhd24gbG9vcCBvbiBzdGFydHVwXG4gICAqIGZhaWx1cmUuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gRmFpbHVyZSBkZXRhaWxzLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIm5vZGU6Y2hpbGRfcHJvY2Vzc1wiKS5DaGlsZFByb2Nlc3N9IGFyZ3MuY2hpbGQgLSBQb29sZWQgY2hpbGQuXG4gICAqIEBwYXJhbSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59IGFyZ3MuZXJyb3IgLSBGYWlsdXJlLlxuICAgKiBAcGFyYW0ge251bWJlciB8IG51bGx9IFthcmdzLmV4aXRDb2RlXSAtIENoaWxkIGV4aXQgY29kZSB3aGVuIG9ic2VydmVkLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vdHlwZXMuanNcIikuUG9vbGVkUnVubmVyRmFpbHVyZU9yaWdpbn0gW2FyZ3Mub3JpZ2luXSAtIFdvcmtlciBvYnNlcnZhdGlvbiB0aGF0IGluaXRpYXRlZCByZWNvdmVyeS5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCJub2RlOmNoaWxkX3Byb2Nlc3NcIikuQ2hpbGRQcm9jZXNzW1wic2lnbmFsQ29kZVwiXX0gW2FyZ3Muc2lnbmFsXSAtIENoaWxkIHRlcm1pbmF0aW9uIHNpZ25hbCB3aGVuIG9ic2VydmVkLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn1cbiAgICovXG4gIGFzeW5jIF9oYW5kbGVQb29sZWRDaGlsZEZhaWx1cmUoe2NoaWxkLCBlcnJvciwgZXhpdENvZGUgPSBudWxsLCBvcmlnaW4gPSBcInByb2Nlc3MtZXJyb3JcIiwgc2lnbmFsID0gbnVsbH0pIHtcbiAgICBjb25zdCBzdGF0ZSA9IHRoaXMucG9vbGVkQ2hpbGRTdGF0ZXMuZ2V0KGNoaWxkKVxuICAgIGlmIChzdGF0ZT8uc2V0dGxpbmcpIHJldHVyblxuICAgIGlmIChzdGF0ZSkge1xuICAgICAgc3RhdGUuc2V0dGxpbmcgPSB0cnVlXG4gICAgICAvLyBDYW5jZWwgdGhpcyBjaGlsZCdzIHBlbmRpbmcgdGltZXJzIGJlZm9yZSBpdHMgaW4tZmxpZ2h0IHNldCBpcyByZXBvcnRlZCDigJRcbiAgICAgIC8vIHRoZSBTSUdLSUxMIGdyYWNlIGZyb20gYSB0aW1lb3V0IGtpbGwsIGFuZCBldmVyeSBhcm1lZCBwZXItam9iIGJhY2tzdG9wLlxuICAgICAgaWYgKHN0YXRlLnRpbWVvdXRTaWdraWxsVGltZXIpIGNsZWFyVGltZW91dChzdGF0ZS50aW1lb3V0U2lna2lsbFRpbWVyKVxuICAgICAgaWYgKHN0YXRlLnNodXRkb3duU2lnbmFsVGltZXIpIGNsZWFyVGltZW91dChzdGF0ZS5zaHV0ZG93blNpZ25hbFRpbWVyKVxuICAgICAgZm9yIChjb25zdCBpbmZsaWdodEVudHJ5IG9mIHN0YXRlLmluZmxpZ2h0LnZhbHVlcygpKSB7XG4gICAgICAgIGlmIChpbmZsaWdodEVudHJ5LnRpbWVvdXRUaW1lcikgY2xlYXJUaW1lb3V0KGluZmxpZ2h0RW50cnkudGltZW91dFRpbWVyKVxuICAgICAgfVxuICAgIH1cbiAgICB0aGlzLnBvb2xlZENoaWxkcmVuLmRlbGV0ZShjaGlsZClcbiAgICB0aGlzLmluZmxpZ2h0UHJvY2Vzc0NoaWxkcmVuLmRlbGV0ZShjaGlsZClcblxuICAgIGNvbnN0IGVudHJpZXMgPSBzdGF0ZSA/IFsuLi5zdGF0ZS5pbmZsaWdodC52YWx1ZXMoKV0gOiBbXVxuICAgIGNvbnN0IHJ1bm5lckZhaWx1cmUgPSBzdGF0ZVxuICAgICAgPyB0aGlzLl9wb29sZWRSdW5uZXJGYWlsdXJlKHtjaGlsZCwgZXhpdENvZGUsIG9yaWdpbiwgc2lnbmFsLCBzdGF0ZX0pXG4gICAgICA6IHVuZGVmaW5lZFxuICAgIGlmIChzdGF0ZSkgc3RhdGUuaW5mbGlnaHQuY2xlYXIoKVxuICAgIHRoaXMucG9vbGVkQ2hpbGRTdGF0ZXMuZGVsZXRlKGNoaWxkKVxuXG4gICAgY29uc3QgZmFpbHVyZVJlcG9ydHMgPSBlbnRyaWVzLm1hcChhc3luYyAoZW50cnkpID0+IHtcbiAgICAgIGF3YWl0IHRoaXMuX3JlcG9ydEpvYlJlc3VsdCh7XG4gICAgICAgIGpvYklkOiBlbnRyeS5wYXlsb2FkLmlkLFxuICAgICAgICBzdGF0dXM6IFwiZmFpbGVkXCIsXG4gICAgICAgIGVycm9yLFxuICAgICAgICBoYW5kb2ZmSWQ6IGVudHJ5LnBheWxvYWQuaGFuZG9mZklkLFxuICAgICAgICBoYW5kZWRPZmZBdE1zOiBlbnRyeS5wYXlsb2FkLmhhbmRlZE9mZkF0TXMsXG4gICAgICAgIHJ1bm5lckZhaWx1cmUsXG4gICAgICAgIHdvcmtlcklkOiBlbnRyeS5wYXlsb2FkLndvcmtlcklkIHx8IHRoaXMud29ya2VySWRcbiAgICAgIH0pXG4gICAgICBpZiAoZW50cnkucmVzb2x2ZSkgZW50cnkucmVzb2x2ZSh1bmRlZmluZWQpXG4gICAgfSlcblxuICAgIC8vIFN0YXJ0IGV2ZXJ5IGZhbGxiYWNrIHJlcG9ydCBiZWZvcmUgYW5ub3VuY2luZyBjYXBhY2l0eSBzbyB0aGUgbWFpbiBjYW5ub3RcbiAgICAvLyBvYnNlcnZlIGEgcmVwbGFjZW1lbnQgc2xvdCBiZWZvcmUgdGhlIGZhaWxlZCBqb2JzJyByZXBvcnRzIGFyZSBpbiBmbGlnaHQuXG4gICAgLy8gVGhlIHJlcG9ydCBwcm9taXNlcyByZW1haW4gdHJhY2tlZCBiZWxvdzsgYSBzbG93IHJldHJ5IG11c3Qgbm90IGhvbGQgdGhlXG4gICAgLy8gbmV3bHkgZnJlZWQgcnVubmVyIGNhcGFjaXR5IGhvc3RhZ2UuXG4gICAgLy8gQSBkcmFpbmVkIHJldGlyZW1lbnQgYWxyZWFkeSBhZHZlcnRpc2VkIGl0cyByZXBsYWNlbWVudCBjYXBhY2l0eSB3aGVuXG4gICAgLy8gdGhlIGZpbmFsIGpvYiBjb21wbGV0ZWQuIFJlLWFkdmVydGlzaW5nIGhlcmUgY2FuIHJlc3RvcmUgYSBjcmVkaXQgbWFpblxuICAgIC8vIGNvbnN1bWVkIGJlZm9yZSBpdHMgaGFuZG9mZiByZWFjaGVkIHRoZSByZXBsYWNlbWVudCBjaGlsZC5cbiAgICBpZiAoc3RhdGU/LnNodXRkb3duUmVhc29uICE9PSBcInBhcmVudF9yZXRpcmVfZHJhaW5lZFwiKSB7XG4gICAgICBpZiAoc3RhdGUgJiYgc3RhdGUuc3RhcnRlZCAhPT0gZmFsc2UpIHtcbiAgICAgICAgdGhpcy5fc2VuZFJlYWR5SWZSdW5uaW5nKClcbiAgICAgIH0gZWxzZSBpZiAoc3RhdGUpIHtcbiAgICAgICAgZm9yIChjb25zdCBlbnRyeSBvZiBlbnRyaWVzKSB7XG4gICAgICAgICAgaWYgKGVudHJ5LnBvb2xlZEpvYikgdGhpcy5fcG9vbGVkU3RhcnR1cEZhaWx1cmVKb2JzLmFkZChlbnRyeS5wb29sZWRKb2IpXG4gICAgICAgICAgY29uc3QgcXVldWVUcmFja2VyID0gdGhpcy5wb29sZWRKb2JRdWV1ZVRyYWNrZXJzLmdldChlbnRyeS5wYXlsb2FkLmlkKVxuICAgICAgICAgIGlmIChxdWV1ZVRyYWNrZXIpIHRoaXMuX3Bvb2xlZFN0YXJ0dXBGYWlsdXJlSm9icy5hZGQocXVldWVUcmFja2VyKVxuICAgICAgICB9XG4gICAgICAgIC8vIEEgcHJldmlvdXMgcmVhZHkgbWVzc2FnZSBtYXkgc3RpbGwgaGF2ZSB1bmNvbnN1bWVkIHBvb2xlZCBjcmVkaXRzIGF0IHRoZVxuICAgICAgICAvLyBtYWluLiBSZXZva2UgdGhlbSBhdXRob3JpdGF0aXZlbHkgd2l0aG91dCBzdXBwcmVzc2luZyB2YWxpZCBpbmxpbmUgb3JcbiAgICAgICAgLy8gcHJvY2Vzcy1ydW5uZXIgcmVhZGluZXNzOyBvdGhlcndpc2UgcXVldWVkIGpvYnMgY2FuIHRyaWdnZXIgYSBzdGFydHVwXG4gICAgICAgIC8vIGNyYXNoIGxvb3AgdXNpbmcgdGhlIHN0YWxlIGNyZWRpdHMuXG4gICAgICAgIHRoaXMuX3NlbmRSZWFkeUlmUnVubmluZyh7cmV2b2tlUG9vbGVkQWRtaXNzaW9uOiB0cnVlfSlcbiAgICAgIH1cbiAgICB9XG5cbiAgICBhd2FpdCBQcm9taXNlLmFsbFNldHRsZWQoZmFpbHVyZVJlcG9ydHMpXG4gIH1cblxuICAvKipcbiAgICogQ2FwdHVyZXMgb25lIHN0YWJsZSBwcm9jZXNzIHNuYXBzaG90IGJlZm9yZSB0aGUgZmFpbGVkIGNoaWxkJ3Mgc3RhdGUgaXMgcmVtb3ZlZC5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBGYWlsdXJlIGRldGFpbHMuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwibm9kZTpjaGlsZF9wcm9jZXNzXCIpLkNoaWxkUHJvY2Vzc30gYXJncy5jaGlsZCAtIEZhaWxlZCBwb29sZWQgY2hpbGQuXG4gICAqIEBwYXJhbSB7bnVtYmVyIHwgbnVsbH0gYXJncy5leGl0Q29kZSAtIENoaWxkIGV4aXQgY29kZSB3aGVuIG9ic2VydmVkLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vdHlwZXMuanNcIikuUG9vbGVkUnVubmVyRmFpbHVyZU9yaWdpbn0gYXJncy5vcmlnaW4gLSBXb3JrZXIgb2JzZXJ2YXRpb24gdGhhdCBpbml0aWF0ZWQgcmVjb3ZlcnkuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwibm9kZTpjaGlsZF9wcm9jZXNzXCIpLkNoaWxkUHJvY2Vzc1tcInNpZ25hbENvZGVcIl19IGFyZ3Muc2lnbmFsIC0gQ2hpbGQgdGVybWluYXRpb24gc2lnbmFsIHdoZW4gb2JzZXJ2ZWQuXG4gICAqIEBwYXJhbSB7UG9vbGVkQ2hpbGRTdGF0ZX0gYXJncy5zdGF0ZSAtIENoaWxkIHN0YXRlIGltbWVkaWF0ZWx5IGJlZm9yZSByZWNvdmVyeS5cbiAgICogQHJldHVybnMge2ltcG9ydChcIi4vdHlwZXMuanNcIikuUG9vbGVkUnVubmVyRmFpbHVyZX0gLSBTaGFyZWQgZmFpbHVyZSBwcm92ZW5hbmNlLlxuICAgKi9cbiAgX3Bvb2xlZFJ1bm5lckZhaWx1cmUoe2NoaWxkLCBleGl0Q29kZSwgb3JpZ2luLCBzaWduYWwsIHN0YXRlfSkge1xuICAgIGNvbnN0IG9ic2VydmF0aW9uID0gc3RhdGUuc2h1dGRvd25PYnNlcnZhdGlvblxuICAgIGxldCBzaHV0ZG93blJlYXNvbiA9IHN0YXRlLnNodXRkb3duUmVhc29uID8/IG9ic2VydmF0aW9uPy5yZWFzb25cbiAgICBpZiAoIXNodXRkb3duUmVhc29uKSB7XG4gICAgICBpZiAob3JpZ2luID09PSBcInByb2Nlc3MtZXJyb3JcIiB8fCBvcmlnaW4gPT09IFwiaXBjLXNlbmRcIikge1xuICAgICAgICBzaHV0ZG93blJlYXNvbiA9IFwicHJvY2Vzc19lcnJvclwiXG4gICAgICB9IGVsc2UgaWYgKHNpZ25hbCA9PT0gXCJTSUdURVJNXCIpIHtcbiAgICAgICAgc2h1dGRvd25SZWFzb24gPSBcInNpZ25hbF9zaWd0ZXJtXCJcbiAgICAgIH0gZWxzZSBpZiAoc2lnbmFsID09PSBcIlNJR0lOVFwiKSB7XG4gICAgICAgIHNodXRkb3duUmVhc29uID0gXCJzaWduYWxfc2lnaW50XCJcbiAgICAgIH0gZWxzZSBpZiAoc2lnbmFsID09PSBcIlNJR0tJTExcIikge1xuICAgICAgICBzaHV0ZG93blJlYXNvbiA9IFwic2lnbmFsX3NpZ2tpbGxcIlxuICAgICAgfSBlbHNlIGlmIChzaWduYWwpIHtcbiAgICAgICAgc2h1dGRvd25SZWFzb24gPSBcInNpZ25hbF9vdGhlclwiXG4gICAgICB9IGVsc2UgaWYgKHN0YXRlLmlwY0Rpc2Nvbm5lY3RlZEF0TXMgJiYgZXhpdENvZGUgPT09IDApIHtcbiAgICAgICAgc2h1dGRvd25SZWFzb24gPSBcImlwY19kaXNjb25uZWN0XCJcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIHNodXRkb3duUmVhc29uID0gXCJ1bmV4cGVjdGVkX2V4aXRcIlxuICAgICAgfVxuICAgIH1cbiAgICBjb25zdCB0ZXJtaW5hdGlvblJlYXNvbiA9IHNodXRkb3duUmVhc29uID09PSBcImpvYl90aW1lb3V0XCJcbiAgICAgID8gXCJqb2ItdGltZW91dFwiXG4gICAgICA6IHNodXRkb3duUmVhc29uID09PSBcIndvcmtlcl9zdG9wXCIgPyBcIndvcmtlci1zaHV0ZG93bi10aW1lb3V0XCIgOiBcInVuZXhwZWN0ZWRcIlxuICAgIGNvbnN0IHdvcmtlckxpZmVjeWNsZSA9IHRoaXMuc2hvdWxkU3RvcCA/IFwic3RvcHBpbmdcIiA6IHRoaXMuaXNSZXRpcmluZyA/IFwicmV0aXJpbmdcIiA6IFwicnVubmluZ1wiXG4gICAgY29uc3QgcnVubmVyTGlmZWN5Y2xlID0gc3RhdGUuc3RhcnRlZCA9PT0gZmFsc2UgPyBcInN0YXJ0aW5nXCIgOiBzdGF0ZS5yZXRpcmluZyA/IFwicmV0aXJpbmdcIiA6IFwicnVubmluZ1wiXG4gICAgY29uc3QgYm91bmRlZEluZmxpZ2h0ID0gYm91bmRlZFBvb2xlZFJ1bm5lckluZmxpZ2h0Sm9iSWRzKHN0YXRlLmluZmxpZ2h0LmtleXMoKSlcbiAgICBjb25zdCBhY3RpdmVKb2JzID0gWy4uLnN0YXRlLmluZmxpZ2h0LnZhbHVlcygpXVxuICAgICAgLm1hcCgoZW50cnkpID0+ICh7XG4gICAgICAgIGhhbmRvZmZJZDogZW50cnkucGF5bG9hZC5oYW5kb2ZmSWQgPz8gbnVsbCxcbiAgICAgICAgaGFuZGVkT2ZmQXRNczogZW50cnkucGF5bG9hZC5oYW5kZWRPZmZBdE1zID8/IG51bGwsXG4gICAgICAgIGpvYklkOiBlbnRyeS5wYXlsb2FkLmlkLFxuICAgICAgICBqb2JOYW1lOiBlbnRyeS5wYXlsb2FkLmpvYk5hbWUsXG4gICAgICAgIHdvcmtlcklkOiBlbnRyeS5wYXlsb2FkLndvcmtlcklkID8/IHRoaXMud29ya2VySWRcbiAgICAgIH0pKVxuICAgICAgLnNvcnQoKGxlZnQsIHJpZ2h0KSA9PiBsZWZ0LmpvYklkLmxvY2FsZUNvbXBhcmUocmlnaHQuam9iSWQpKVxuXG4gICAgcmV0dXJuIE9iamVjdC5mcmVlemUoe1xuICAgICAgYWN0aXZlSm9icyxcbiAgICAgIGNoaWxkSW5zdGFuY2VJZDogc3RhdGUuY2hpbGRJbnN0YW5jZUlkID8/IG9ic2VydmF0aW9uPy5jaGlsZEluc3RhbmNlSWQgPz8gbnVsbCxcbiAgICAgIGV4aXRDb2RlLFxuICAgICAgZ2VuZXJhdGlvbklkOiB0aGlzLmdlbmVyYXRpb25JZCA/PyBudWxsLFxuICAgICAgLi4uYm91bmRlZEluZmxpZ2h0LFxuICAgICAgb29tS2lsbGVkOiBzaWduYWwgPT09IFwiU0lHS0lMTFwiICYmIHNodXRkb3duUmVhc29uID09PSBcInNpZ25hbF9zaWdraWxsXCIgPyBudWxsIDogZmFsc2UsXG4gICAgICBvcmlnaW4sXG4gICAgICBydW5uZXJBZ2VNczogTWF0aC5tYXgoMCwgRGF0ZS5ub3coKSAtIHN0YXRlLmNyZWF0ZWRBdE1zKSxcbiAgICAgIHJ1bm5lckNyZWF0ZWRBdE1zOiBzdGF0ZS5jcmVhdGVkQXRNcyxcbiAgICAgIHJ1bm5lckRldGFjaGVkOiBmYWxzZSxcbiAgICAgIHJ1bm5lckpvYnNSdW46IHN0YXRlLmpvYnNSdW4sXG4gICAgICBydW5uZXJMaWZlY3ljbGUsXG4gICAgICBydW5uZXJQaWQ6IGNoaWxkLnBpZCA/PyBudWxsLFxuICAgICAgc2lnbmFsLFxuICAgICAgc2h1dGRvd25PYnNlcnZlZEF0TXM6IG9ic2VydmF0aW9uPy5zaHV0ZG93bk9ic2VydmVkQXRNcyA/PyBzdGF0ZS5pcGNEaXNjb25uZWN0ZWRBdE1zID8/IG51bGwsXG4gICAgICBzaHV0ZG93blJlcXVlc3RlZEF0TXM6IHN0YXRlLnNodXRkb3duUmVxdWVzdGVkQXRNcyA/PyBvYnNlcnZhdGlvbj8uc2h1dGRvd25SZXF1ZXN0ZWRBdE1zID8/IG51bGwsXG4gICAgICBzaHV0ZG93blJlYXNvbixcbiAgICAgIHNodXRkb3duU2lnbmFsOiBzdGF0ZS5zaHV0ZG93blNpZ25hbCA/PyBvYnNlcnZhdGlvbj8uc2lnbmFsID8/IHNpZ25hbCxcbiAgICAgIHRlcm1pbmF0aW9uUmVhc29uLFxuICAgICAgdGltZW91dEpvYklkOiBzdGF0ZS50aW1lb3V0Sm9iSWQgPz8gbnVsbCxcbiAgICAgIHdvcmtlcklkOiB0aGlzLndvcmtlcklkLFxuICAgICAgd29ya2VyTGlmZWN5Y2xlLFxuICAgICAgd29ya2VyUGlkOiBwcm9jZXNzLnBpZFxuICAgIH0pXG4gIH1cblxuICAvKipcbiAgICogUnVucyBydW4gam9iIGlubGluZS5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL3R5cGVzLmpzXCIpLkJhY2tncm91bmRKb2JQYXlsb2FkfSBwYXlsb2FkIC0gUGF5bG9hZC5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgd2hlbiBkb25lLlxuICAgKi9cbiAgYXN5bmMgX3J1bkpvYklubGluZShwYXlsb2FkKSB7XG4gICAgY29uc3QgY29uZmlndXJhdGlvbiA9IHRoaXMuY29uZmlndXJhdGlvblxuICAgIGlmICghY29uZmlndXJhdGlvbikgdGhyb3cgbmV3IEVycm9yKFwiQmFja2dyb3VuZCBqb2JzIHdvcmtlciBjb25maWd1cmF0aW9uIG5vdCBpbml0aWFsaXplZFwiKVxuXG4gICAgY29uc3QgcmVnaXN0cnkgPSBuZXcgQmFja2dyb3VuZEpvYlJlZ2lzdHJ5KHtjb25maWd1cmF0aW9ufSlcbiAgICBhd2FpdCByZWdpc3RyeS5sb2FkKClcbiAgICBjb25zdCBKb2JDbGFzcyA9IHJlZ2lzdHJ5LmdldEpvYkJ5TmFtZShwYXlsb2FkLmpvYk5hbWUpXG4gICAgYXdhaXQgcnVuV2l0aEJhY2tncm91bmRKb2JQYXlsb2FkKHBheWxvYWQsIGFzeW5jICgpID0+IHtcbiAgICAgIGF3YWl0IHBlcmZvcm1CYWNrZ3JvdW5kSm9iKHtcbiAgICAgICAgY29uZmlndXJhdGlvbixcbiAgICAgICAgSm9iQ2xhc3MsXG4gICAgICAgIGpvYkFyZ3M6IHBheWxvYWQuYXJncyB8fCBbXSxcbiAgICAgICAgam9iT3B0aW9uczogcGF5bG9hZC5vcHRpb25zIHx8IHt9LFxuICAgICAgICBuYW1lOiBgQmFja2dyb3VuZCBqb2Igd29ya2VyIGlubGluZTogJHtwYXlsb2FkLmpvYk5hbWV9YCxcbiAgICAgICAgcGF5bG9hZFxuICAgICAgfSlcbiAgICB9KVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZm9yayBqb2IuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi90eXBlcy5qc1wiKS5CYWNrZ3JvdW5kSm9iUGF5bG9hZCAmIHtpZDogc3RyaW5nfX0gcGF5bG9hZCAtIFBheWxvYWQuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIHdoZW4gdGhlIGZvcmtlZCBydW5uZXIgZXhpdHMgb3IgZm9yayBmYWlscy5cbiAgICovXG4gIF9mb3JrSm9iKHBheWxvYWQpIHtcbiAgICBjb25zdCBjaGlsZCA9IHRoaXMuX2NyZWF0ZUZvcmtlZENoaWxkKClcblxuICAgIHRoaXMuaW5mbGlnaHRQcm9jZXNzQ2hpbGRyZW4uYWRkKGNoaWxkKVxuXG4gICAgY29uc3QgZmluaXNoZWQgPSB0aGlzLl93YWl0Rm9yRm9ya2VkQ2hpbGQoe2NoaWxkLCBwYXlsb2FkfSlcblxuICAgIHRoaXMuX3NlbmRGb3JrZWRQYXlsb2FkKHtjaGlsZCwgcGF5bG9hZH0pXG5cbiAgICByZXR1cm4gZmluaXNoZWRcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGNyZWF0ZSBmb3JrZWQgY2hpbGQuXG4gICAqIEByZXR1cm5zIHtpbXBvcnQoXCJub2RlOmNoaWxkX3Byb2Nlc3NcIikuQ2hpbGRQcm9jZXNzfSAtIEZvcmtlZCBjaGlsZCBwcm9jZXNzLlxuICAgKi9cbiAgX2NyZWF0ZUZvcmtlZENoaWxkKCkge1xuICAgIGNvbnN0IGNvbmZpZ3VyYXRpb24gPSB0aGlzLmNvbmZpZ3VyYXRpb25cbiAgICBpZiAoIWNvbmZpZ3VyYXRpb24pIHRocm93IG5ldyBFcnJvcihcIkJhY2tncm91bmQgam9icyB3b3JrZXIgY29uZmlndXJhdGlvbiBub3QgaW5pdGlhbGl6ZWRcIilcblxuICAgIGNvbnN0IGRpcmVjdG9yeSA9IGNvbmZpZ3VyYXRpb24uZ2V0RGlyZWN0b3J5KClcbiAgICByZXR1cm4gZm9yayhGT1JLRURfUlVOTkVSX0VOVFJZX1BBVEgsIFtdLCB7XG4gICAgICBjd2Q6IGRpcmVjdG9yeSxcbiAgICAgIGV4ZWNBcmd2OiBbXSxcbiAgICAgIHN0ZGlvOiBbXCJpZ25vcmVcIiwgXCJpZ25vcmVcIiwgXCJpZ25vcmVcIiwgXCJpcGNcIl0sXG4gICAgICBlbnY6IE9iamVjdC5hc3NpZ24oe30sIHByb2Nlc3MuZW52LCB0aGlzLl9jaGlsZEJhY2tncm91bmRKb2JzRW52aXJvbm1lbnQoKSlcbiAgICB9KVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgd2FpdCBmb3IgZm9ya2VkIGNoaWxkLlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIE9wdGlvbnMuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwibm9kZTpjaGlsZF9wcm9jZXNzXCIpLkNoaWxkUHJvY2Vzc30gYXJncy5jaGlsZCAtIEZvcmtlZCBjaGlsZCBwcm9jZXNzLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vdHlwZXMuanNcIikuQmFja2dyb3VuZEpvYlBheWxvYWQgJiB7aWQ6IHN0cmluZ319IGFyZ3MucGF5bG9hZCAtIFBheWxvYWQuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIHdoZW4gdGhlIGNoaWxkIGV4aXRzLlxuICAgKi9cbiAgX3dhaXRGb3JGb3JrZWRDaGlsZCh7Y2hpbGQsIHBheWxvYWR9KSB7XG4gICAgY29uc3QgdGltZW91dFN0YXRlID0gdGhpcy5fYXJtRm9ya2VkSm9iVGltZW91dCh7Y2hpbGQsIHBheWxvYWR9KVxuXG4gICAgcmV0dXJuIG5ldyBQcm9taXNlKChyZXNvbHZlKSA9PiB7XG4gICAgICBjaGlsZC5vbmNlKFwiZXhpdFwiLCAoY29kZSwgc2lnbmFsKSA9PiB7XG4gICAgICAgIHRoaXMuX2NsZWFyRm9ya2VkSm9iVGltZW91dCh0aW1lb3V0U3RhdGUpXG4gICAgICAgIHRoaXMuX2hhbmRsZUZvcmtlZENoaWxkRXhpdCh7Y2hpbGQsIGNvZGUsIHNpZ25hbCwgcGF5bG9hZCwgcmVzb2x2ZSwgdGltZW91dFN0YXRlfSlcbiAgICAgIH0pXG4gICAgICBjaGlsZC5vbmNlKFwiZXJyb3JcIiwgKGVycm9yKSA9PiB7XG4gICAgICAgIHRoaXMuX2NsZWFyRm9ya2VkSm9iVGltZW91dCh0aW1lb3V0U3RhdGUpXG4gICAgICAgIHRoaXMuX2hhbmRsZUZvcmtlZENoaWxkRXJyb3Ioe2NoaWxkLCBlcnJvciwgcGF5bG9hZCwgcmVzb2x2ZX0pXG4gICAgICB9KVxuICAgIH0pXG4gIH1cblxuICAvKipcbiAgICogQXJtcyBhIHdhbGwtY2xvY2sgYmFja3N0b3AgZm9yIGEgZm9ya2VkIGpvYiBydW5uZXIuIEEgZm9ya2VkIGpvYiBzdGlsbFxuICAgKiBydW5uaW5nIGFmdGVyIGBqb2JUaW1lb3V0TXNgIGlzIHRlcm1pbmF0ZWQgKFNJR1RFUk0sIHRoZW4gU0lHS0lMTCBhZnRlciB0aGVcbiAgICogZ3JhY2UpIHNvIGEgc2luZ2xlIGdlbnVpbmVseS1odW5nIHJ1bm5lciBjYW4ndCBwaW4gYSBkcmFpbmluZyB3b3JrZXIg4oCUIGFuZFxuICAgKiBpdHMgZnVsbC1hcHAgYm9vdCBhbmQgZGF0YWJhc2UgY29ubmVjdGlvbnMg4oCUIGluZGVmaW5pdGVseS4gUmV0dXJucyBhIHN0YXRlXG4gICAqIG9iamVjdCB0aGUgZXhpdC9lcnJvciBoYW5kbGVycyB1c2UgdG8gY2FuY2VsIHRoZSB0aW1lciBhbmQgdG8gcmVwb3J0IGFcbiAgICogdGltZW91dC1zcGVjaWZpYyBmYWlsdXJlLiBXaGVuIG5vIHRpbWVvdXQgaXMgY29uZmlndXJlZCB0aGUgdGltZXIgaXMgbnVsbFxuICAgKiBhbmQgYmVoYXZpb3IgaXMgdW5jaGFuZ2VkLlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIE9wdGlvbnMuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwibm9kZTpjaGlsZF9wcm9jZXNzXCIpLkNoaWxkUHJvY2Vzc30gYXJncy5jaGlsZCAtIEZvcmtlZCBjaGlsZCBwcm9jZXNzLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vdHlwZXMuanNcIikuQmFja2dyb3VuZEpvYlBheWxvYWQgJiB7aWQ6IHN0cmluZ319IGFyZ3MucGF5bG9hZCAtIEpvYiBwYXlsb2FkLlxuICAgKiBAcmV0dXJucyB7Rm9ya2VkSm9iVGltZW91dFN0YXRlfSAtIFRpbWVvdXQgc3RhdGUuXG4gICAqL1xuICBfYXJtRm9ya2VkSm9iVGltZW91dCh7Y2hpbGQsIHBheWxvYWR9KSB7XG4gICAgY29uc3QgdGltZW91dE1zID0gdGhpcy5fcmVzb2x2ZUpvYlRpbWVvdXRNcyhwYXlsb2FkLm9wdGlvbnMpXG4gICAgLyoqIEB0eXBlIHtGb3JrZWRKb2JUaW1lb3V0U3RhdGV9ICovXG4gICAgY29uc3Qgc3RhdGUgPSB7dGltZWRPdXQ6IGZhbHNlLCB0aW1lb3V0TXMsIHRpbWVyOiBudWxsLCBzaWdraWxsVGltZXI6IG51bGx9XG5cbiAgICBpZiAoISh0eXBlb2YgdGltZW91dE1zID09PSBcIm51bWJlclwiICYmIHRpbWVvdXRNcyA+IDApKSByZXR1cm4gc3RhdGVcblxuICAgIHN0YXRlLnRpbWVyID0gc2V0VGltZW91dCgoKSA9PiB0aGlzLl9vbkZvcmtlZEpvYlRpbWVvdXQoe2NoaWxkLCBzdGF0ZX0pLCB0aW1lb3V0TXMpXG5cbiAgICByZXR1cm4gc3RhdGVcbiAgfVxuXG4gIC8qKlxuICAgKiBSZXNvbHZlcyB0aGUgZWZmZWN0aXZlIHdhbGwtY2xvY2sgam9iIHRpbWVvdXQgaW4gbXMgKHNoYXJlZCBieSBmb3JrZWQgYW5kIHBvb2xlZCBqb2JzKSwgb3IgbnVsbCB3aGVuIGRpc2FibGVkLiBUaGVcbiAgICogcGVyLWpvYiBvdmVycmlkZSB3aW5zLCBmb2xsb3dlZCBieSB0aGUgY29uc3RydWN0b3Igb3ZlcnJpZGUsIHRoZW4gdGhlIHZhbHVlXG4gICAqIGZyb20gdGhlIGJhY2tncm91bmQtam9icyBjb25maWd1cmF0aW9uLiBBIG5vbi1wb3NpdGl2ZSB2YWx1ZSBkaXNhYmxlcyB0aGVcbiAgICogYmFja3N0b3AgYXQgd2hpY2hldmVyIGxldmVsIHN1cHBsaWVkIGl0LlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vdHlwZXMuanNcIikuQmFja2dyb3VuZEpvYk9wdGlvbnN9IFtqb2JPcHRpb25zXSAtIFBlci1qb2Igb3B0aW9ucy5cbiAgICogQHJldHVybnMge251bWJlciB8IG51bGx9IC0gVGltZW91dCBpbiBtcywgb3IgbnVsbCB3aGVuIGRpc2FibGVkLlxuICAgKi9cbiAgX3Jlc29sdmVKb2JUaW1lb3V0TXMoam9iT3B0aW9ucykge1xuICAgIGNvbnN0IHJhdyA9IHR5cGVvZiBqb2JPcHRpb25zPy50aW1lb3V0TXMgPT09IFwibnVtYmVyXCJcbiAgICAgID8gam9iT3B0aW9ucy50aW1lb3V0TXNcbiAgICAgIDogKHR5cGVvZiB0aGlzLmpvYlRpbWVvdXRNc092ZXJyaWRlID09PSBcIm51bWJlclwiXG4gICAgICAgICAgPyB0aGlzLmpvYlRpbWVvdXRNc092ZXJyaWRlXG4gICAgICAgICAgOiAodGhpcy5jb25maWd1cmF0aW9uID8gdGhpcy5jb25maWd1cmF0aW9uLmdldEJhY2tncm91bmRKb2JzQ29uZmlnKCkuam9iVGltZW91dE1zIDogbnVsbCkpXG5cbiAgICAvLyBBIG5vbi1maW5pdGUgKGUuZy4gSW5maW5pdHkpIG9yIG5vbi1wb3NpdGl2ZSB2YWx1ZSBkaXNhYmxlcyB0aGUgYmFja3N0b3A7XG4gICAgLy8gYSBmaW5pdGUgdmFsdWUgYmV5b25kIE5vZGUncyB0aW1lciByYW5nZSBpcyBjbGFtcGVkIHRvIHRoZSBtYXggcmF0aGVyIHRoYW5cbiAgICAvLyBzaWxlbnRseSBjb2VyY2VkIHRvIH4xbXMgKHdoaWNoIHdvdWxkIGtpbGwgZXZlcnkgZm9ya2VkIGpvYiBpbW1lZGlhdGVseSkuXG4gICAgaWYgKHR5cGVvZiByYXcgIT09IFwibnVtYmVyXCIgfHwgIU51bWJlci5pc0Zpbml0ZShyYXcpIHx8IHJhdyA8PSAwKSByZXR1cm4gbnVsbFxuXG4gICAgcmV0dXJuIE1hdGgubWluKHJhdywgTUFYX0ZPUktFRF9KT0JfVElNRU9VVF9NUylcbiAgfVxuXG4gIC8qKlxuICAgKiBGaXJlZCB3aGVuIGEgZm9ya2VkIHJ1bm5lciBvdmVycnVucyBpdHMgdGltZW91dC4gU2VuZHMgU0lHVEVSTSBmb3IgYSBjbGVhblxuICAgKiBzaHV0ZG93biwgdGhlbiBTSUdLSUxMIGFmdGVyIHRoZSBncmFjZSBmb3IgYSBydW5uZXIgdGhhdCBpZ25vcmVzIGl0LiBUaGVcbiAgICogcmVzdWx0aW5nIG5vbi1jbGVhbiBleGl0IGZsb3dzIHRocm91Z2ggYF9oYW5kbGVGb3JrZWRDaGlsZEV4aXRgLCB3aGljaCBmcmVlc1xuICAgKiB0aGUgc2xvdCBhbmQgcmVwb3J0cyB0aGUgam9iIGZhaWxlZC5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBPcHRpb25zLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIm5vZGU6Y2hpbGRfcHJvY2Vzc1wiKS5DaGlsZFByb2Nlc3N9IGFyZ3MuY2hpbGQgLSBGb3JrZWQgY2hpbGQgcHJvY2Vzcy5cbiAgICogQHBhcmFtIHtGb3JrZWRKb2JUaW1lb3V0U3RhdGV9IGFyZ3Muc3RhdGUgLSBUaW1lb3V0IHN0YXRlLlxuICAgKiBAcmV0dXJucyB7dm9pZH1cbiAgICovXG4gIF9vbkZvcmtlZEpvYlRpbWVvdXQoe2NoaWxkLCBzdGF0ZX0pIHtcbiAgICBzdGF0ZS50aW1lZE91dCA9IHRydWVcblxuICAgIHRyeSB7XG4gICAgICBjaGlsZC5raWxsKFwiU0lHVEVSTVwiKVxuICAgIH0gY2F0Y2gge1xuICAgICAgLy8gQ2hpbGQgYWxyZWFkeSBleGl0ZWQ7IG5vdGhpbmcgdG8gZG8uXG4gICAgfVxuXG4gICAgc3RhdGUuc2lna2lsbFRpbWVyID0gc2V0VGltZW91dCgoKSA9PiB7XG4gICAgICB0cnkge1xuICAgICAgICBjaGlsZC5raWxsKFwiU0lHS0lMTFwiKVxuICAgICAgfSBjYXRjaCB7XG4gICAgICAgIC8vIENoaWxkIGFscmVhZHkgZXhpdGVkOyBub3RoaW5nIHRvIGRvLlxuICAgICAgfVxuICAgIH0sIHRoaXMuZm9ya2VkQ2hpbGRTaWdraWxsR3JhY2VNcylcbiAgfVxuXG4gIC8qKlxuICAgKiBDYW5jZWxzIGFueSBwZW5kaW5nIHRpbWVvdXQvU0lHS0lMTCB0aW1lcnMgZm9yIGEgZm9ya2VkIHJ1bm5lciB0aGF0IGhhc1xuICAgKiBleGl0ZWQgKG9yIGVycm9yZWQpIHNvIHRoZXkgbmV2ZXIgZmlyZSBhZ2FpbnN0IGEgZ29uZSBvciByZXVzZWQgY2hpbGQuXG4gICAqIEBwYXJhbSB7Rm9ya2VkSm9iVGltZW91dFN0YXRlfSBzdGF0ZSAtIFRpbWVvdXQgc3RhdGUuXG4gICAqIEByZXR1cm5zIHt2b2lkfVxuICAgKi9cbiAgX2NsZWFyRm9ya2VkSm9iVGltZW91dChzdGF0ZSkge1xuICAgIGlmIChzdGF0ZS50aW1lcikge1xuICAgICAgY2xlYXJUaW1lb3V0KHN0YXRlLnRpbWVyKVxuICAgICAgc3RhdGUudGltZXIgPSBudWxsXG4gICAgfVxuXG4gICAgaWYgKHN0YXRlLnNpZ2tpbGxUaW1lcikge1xuICAgICAgY2xlYXJUaW1lb3V0KHN0YXRlLnNpZ2tpbGxUaW1lcilcbiAgICAgIHN0YXRlLnNpZ2tpbGxUaW1lciA9IG51bGxcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogUnVucyBoYW5kbGUgZm9ya2VkIGNoaWxkIGV4aXQuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gT3B0aW9ucy5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCJub2RlOmNoaWxkX3Byb2Nlc3NcIikuQ2hpbGRQcm9jZXNzfSBhcmdzLmNoaWxkIC0gRm9ya2VkIGNoaWxkIHByb2Nlc3MuXG4gICAqIEBwYXJhbSB7bnVtYmVyIHwgbnVsbH0gYXJncy5jb2RlIC0gRXhpdCBjb2RlLlxuICAgKiBAcGFyYW0ge2tleW9mIHR5cGVvZiBpbXBvcnQoXCJub2RlOm9zXCIpLmNvbnN0YW50cy5zaWduYWxzIHwgbnVsbH0gYXJncy5zaWduYWwgLSBFeGl0IHNpZ25hbC5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL3R5cGVzLmpzXCIpLkJhY2tncm91bmRKb2JQYXlsb2FkICYge2lkOiBzdHJpbmd9fSBhcmdzLnBheWxvYWQgLSBQYXlsb2FkLlxuICAgKiBAcGFyYW0geyh2YWx1ZTogdm9pZCkgPT4gdm9pZH0gYXJncy5yZXNvbHZlIC0gUHJvbWlzZSByZXNvbHZlci5cbiAgICogQHBhcmFtIHtGb3JrZWRKb2JUaW1lb3V0U3RhdGV9IFthcmdzLnRpbWVvdXRTdGF0ZV0gLSBUaW1lb3V0IHN0YXRlLCB3aGVuIHRoZSBydW5uZXIgaGFkIGEgd2FsbC1jbG9jayBiYWNrc3RvcC5cbiAgICogQHJldHVybnMge3ZvaWR9XG4gICAqL1xuICBfaGFuZGxlRm9ya2VkQ2hpbGRFeGl0KHtjaGlsZCwgY29kZSwgc2lnbmFsLCBwYXlsb2FkLCByZXNvbHZlLCB0aW1lb3V0U3RhdGV9KSB7XG4gICAgdGhpcy5pbmZsaWdodFByb2Nlc3NDaGlsZHJlbi5kZWxldGUoY2hpbGQpXG5cbiAgICAvLyBGcmVlIHRoZSB3b3JrZXIgc2xvdCBhcyBzb29uIGFzIHRoZSBjaGlsZCBpcyBnb25lIOKAlCBuZXZlciBnYXRlIGl0IG9uIHRoZVxuICAgIC8vIGZhaWx1cmUgcmVwb3J0LiBBIGh1bmcvc2xvdyByZXBvcnQgbXVzdCBub3QgbGVhayB0aGUgc2xvdDsgZW5vdWdoIGxlYWtlZFxuICAgIC8vIHNsb3RzIGRyaXZlIGBhY2NlcHRzRm9ya2VkYCB0byBmYWxzZSBhbmQgc2lsZW50bHkgd2VkZ2UgdGhlIHdvcmtlci5cbiAgICByZXNvbHZlKHVuZGVmaW5lZClcblxuICAgIGlmICh0aGlzLl9mb3JrZWRDaGlsZEV4aXRlZENsZWFubHkoe2NvZGUsIHNpZ25hbH0pKSByZXR1cm5cblxuICAgIGNvbnN0IGVycm9yID0gdGltZW91dFN0YXRlPy50aW1lZE91dFxuICAgICAgPyBuZXcgRXJyb3IoYEZvcmtlZCBiYWNrZ3JvdW5kIGpvYiBydW5uZXIgdGltZWQgb3V0IGFmdGVyICR7dGltZW91dFN0YXRlLnRpbWVvdXRNc31tcyBhbmQgd2FzIHRlcm1pbmF0ZWQ6IGNvZGU9JHtjb2RlfSBzaWduYWw9JHtzaWduYWwgfHwgXCJub25lXCJ9YClcbiAgICAgIDogbmV3IEVycm9yKGBGb3JrZWQgYmFja2dyb3VuZCBqb2IgcnVubmVyIGV4aXRlZCBiZWZvcmUgcmVwb3J0aW5nOiBjb2RlPSR7Y29kZX0gc2lnbmFsPSR7c2lnbmFsIHx8IFwibm9uZVwifWApXG5cbiAgICB0aGlzLl9yZXBvcnRGb3JrZWRDaGlsZEZhaWx1cmUoe3BheWxvYWQsIGVycm9yfSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGZvcmtlZCBjaGlsZCBleGl0ZWQgY2xlYW5seS5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBPcHRpb25zLlxuICAgKiBAcGFyYW0ge251bWJlciB8IG51bGx9IGFyZ3MuY29kZSAtIEV4aXQgY29kZS5cbiAgICogQHBhcmFtIHtrZXlvZiB0eXBlb2YgaW1wb3J0KFwibm9kZTpvc1wiKS5jb25zdGFudHMuc2lnbmFscyB8IG51bGx9IGFyZ3Muc2lnbmFsIC0gRXhpdCBzaWduYWwuXG4gICAqIEByZXR1cm5zIHtib29sZWFufSAtIFdoZXRoZXIgdGhlIGNoaWxkIGV4aXRlZCBjbGVhbmx5LlxuICAgKi9cbiAgX2ZvcmtlZENoaWxkRXhpdGVkQ2xlYW5seSh7Y29kZSwgc2lnbmFsfSkge1xuICAgIHJldHVybiBjb2RlID09PSAwICYmICFzaWduYWxcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGhhbmRsZSBmb3JrZWQgY2hpbGQgZXJyb3IuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gT3B0aW9ucy5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCJub2RlOmNoaWxkX3Byb2Nlc3NcIikuQ2hpbGRQcm9jZXNzfSBhcmdzLmNoaWxkIC0gRm9ya2VkIGNoaWxkIHByb2Nlc3MuXG4gICAqIEBwYXJhbSB7RXJyb3J9IGFyZ3MuZXJyb3IgLSBDaGlsZCBwcm9jZXNzIGVycm9yLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vdHlwZXMuanNcIikuQmFja2dyb3VuZEpvYlBheWxvYWQgJiB7aWQ6IHN0cmluZ319IGFyZ3MucGF5bG9hZCAtIFBheWxvYWQuXG4gICAqIEBwYXJhbSB7KHZhbHVlOiB2b2lkKSA9PiB2b2lkfSBhcmdzLnJlc29sdmUgLSBQcm9taXNlIHJlc29sdmVyLlxuICAgKiBAcmV0dXJucyB7dm9pZH1cbiAgICovXG4gIF9oYW5kbGVGb3JrZWRDaGlsZEVycm9yKHtjaGlsZCwgZXJyb3IsIHBheWxvYWQsIHJlc29sdmV9KSB7XG4gICAgdGhpcy5pbmZsaWdodFByb2Nlc3NDaGlsZHJlbi5kZWxldGUoY2hpbGQpXG4gICAgLy8gRnJlZSB0aGUgc2xvdCBmaXJzdCAoc2VlIF9oYW5kbGVGb3JrZWRDaGlsZEV4aXQpIOKAlCByZXBvcnRpbmcgaXMgYmVzdC1lZmZvcnQuXG4gICAgcmVzb2x2ZSh1bmRlZmluZWQpXG4gICAgY29uc29sZS5lcnJvcihcIkJhY2tncm91bmQgam9icyBmb3JrZWQgcnVubmVyIGVycm9yOlwiLCBlcnJvcilcbiAgICB0aGlzLl9yZXBvcnRGb3JrZWRDaGlsZEZhaWx1cmUoe3BheWxvYWQsIGVycm9yfSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHNlbmQgZm9ya2VkIHBheWxvYWQuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gT3B0aW9ucy5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCJub2RlOmNoaWxkX3Byb2Nlc3NcIikuQ2hpbGRQcm9jZXNzfSBhcmdzLmNoaWxkIC0gRm9ya2VkIGNoaWxkIHByb2Nlc3MuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi90eXBlcy5qc1wiKS5CYWNrZ3JvdW5kSm9iUGF5bG9hZCAmIHtpZDogc3RyaW5nfX0gYXJncy5wYXlsb2FkIC0gUGF5bG9hZC5cbiAgICogQHJldHVybnMge3ZvaWR9XG4gICAqL1xuICBfc2VuZEZvcmtlZFBheWxvYWQoe2NoaWxkLCBwYXlsb2FkfSkge1xuICAgIHRyeSB7XG4gICAgICBjaGlsZC5zZW5kKHt0eXBlOiBcImpvYlwiLCBwYXlsb2FkfSlcbiAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgY2hpbGQua2lsbChcIlNJR1RFUk1cIilcbiAgICAgIHRoaXMuX3JlcG9ydEZvcmtlZENoaWxkRmFpbHVyZSh7cGF5bG9hZCwgZXJyb3J9KVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHJlcG9ydCBmb3JrZWQgY2hpbGQgZmFpbHVyZS5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBPcHRpb25zLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vdHlwZXMuanNcIikuQmFja2dyb3VuZEpvYlBheWxvYWQgJiB7aWQ6IHN0cmluZ319IGFyZ3MucGF5bG9hZCAtIFBheWxvYWQuXG4gICAqIEBwYXJhbSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59IGFyZ3MuZXJyb3IgLSBFcnJvci5cbiAgICogQHJldHVybnMge3ZvaWR9XG4gICAqL1xuICBfcmVwb3J0Rm9ya2VkQ2hpbGRGYWlsdXJlKHtwYXlsb2FkLCBlcnJvcn0pIHtcbiAgICB0aGlzLl9yZXBvcnRKb2JSZXN1bHRJbkJhY2tncm91bmQoe1xuICAgICAgam9iSWQ6IHBheWxvYWQuaWQsXG4gICAgICBzdGF0dXM6IFwiZmFpbGVkXCIsXG4gICAgICBlcnJvcixcbiAgICAgIGhhbmRvZmZJZDogcGF5bG9hZC5oYW5kb2ZmSWQsXG4gICAgICBoYW5kZWRPZmZBdE1zOiBwYXlsb2FkLmhhbmRlZE9mZkF0TXMsXG4gICAgICB3b3JrZXJJZDogcGF5bG9hZC53b3JrZXJJZCB8fCB0aGlzLndvcmtlcklkXG4gICAgfSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHNwYXduIGpvYi5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL3R5cGVzLmpzXCIpLkJhY2tncm91bmRKb2JQYXlsb2FkfSBwYXlsb2FkIC0gUGF5bG9hZC5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgd2hlbiB0aGUgc3Bhd25lZCBydW5uZXIgZXhpdHMgb3Igc3Bhd24gZmFpbHMuXG4gICAqL1xuICBfc3Bhd25Kb2IocGF5bG9hZCkge1xuICAgIGNvbnN0IGNvbmZpZ3VyYXRpb24gPSB0aGlzLmNvbmZpZ3VyYXRpb25cbiAgICBpZiAoIWNvbmZpZ3VyYXRpb24pIHRocm93IG5ldyBFcnJvcihcIkJhY2tncm91bmQgam9icyB3b3JrZXIgY29uZmlndXJhdGlvbiBub3QgaW5pdGlhbGl6ZWRcIilcblxuICAgIGNvbnN0IGRpcmVjdG9yeSA9IGNvbmZpZ3VyYXRpb24uZ2V0RGlyZWN0b3J5KClcbiAgICBjb25zdCBhcmd2Q29tbWFuZCA9IHByb2Nlc3MuYXJndlsxXVxuICAgIGNvbnN0IGNvbW1hbmQgPSBhcmd2Q29tbWFuZCA/IGFyZ3ZDb21tYW5kIDogYCR7ZGlyZWN0b3J5fS9iaW4vdmVsb2Npb3VzLmpzYFxuICAgIGNvbnN0IGVuY29kZWRQYXlsb2FkID0gQnVmZmVyLmZyb20oSlNPTi5zdHJpbmdpZnkocGF5bG9hZCkpLnRvU3RyaW5nKFwiYmFzZTY0XCIpXG4gICAgY29uc3QgY2hpbGQgPSBzcGF3bihwcm9jZXNzLmV4ZWNQYXRoLCBbY29tbWFuZCwgXCJiYWNrZ3JvdW5kLWpvYnMtcnVubmVyXCJdLCB7XG4gICAgICBjd2Q6IGRpcmVjdG9yeSxcbiAgICAgIGRldGFjaGVkOiB0cnVlLFxuICAgICAgc3RkaW86IFwiaWdub3JlXCIsXG4gICAgICBlbnY6IE9iamVjdC5hc3NpZ24oe30sIHByb2Nlc3MuZW52LCB0aGlzLl9jaGlsZEJhY2tncm91bmRKb2JzRW52aXJvbm1lbnQoKSwge1ZFTE9DSU9VU19KT0JfUEFZTE9BRDogZW5jb2RlZFBheWxvYWR9KVxuICAgIH0pXG5cbiAgICB0aGlzLmluZmxpZ2h0UHJvY2Vzc0NoaWxkcmVuLmFkZChjaGlsZClcblxuICAgIGNvbnN0IGZpbmlzaGVkID0gbmV3IFByb21pc2UoKHJlc29sdmUpID0+IHtcbiAgICAgIGNoaWxkLm9uY2UoXCJleGl0XCIsICgpID0+IHtcbiAgICAgICAgdGhpcy5pbmZsaWdodFByb2Nlc3NDaGlsZHJlbi5kZWxldGUoY2hpbGQpXG4gICAgICAgIHJlc29sdmUodW5kZWZpbmVkKVxuICAgICAgfSlcbiAgICAgIGNoaWxkLm9uY2UoXCJlcnJvclwiLCAoZXJyb3IpID0+IHtcbiAgICAgICAgdGhpcy5pbmZsaWdodFByb2Nlc3NDaGlsZHJlbi5kZWxldGUoY2hpbGQpXG4gICAgICAgIGNvbnNvbGUuZXJyb3IoXCJCYWNrZ3JvdW5kIGpvYnMgc3Bhd25lZCBydW5uZXIgZXJyb3I6XCIsIGVycm9yKVxuICAgICAgICByZXNvbHZlKHVuZGVmaW5lZClcbiAgICAgIH0pXG4gICAgfSlcblxuICAgIGNoaWxkLnVucmVmKClcblxuICAgIHJldHVybiBmaW5pc2hlZFxuICB9XG5cbiAgLyoqXG4gICAqIEJ1aWxkcyB0aGUgZXhhY3QgbWFpbiBlbmRwb2ludCBhbmQgZ2VuZXJhdGlvbiBpbmhlcml0ZWQgYnkgZXZlcnkgY2hpbGQuXG4gICAqIEByZXR1cm5zIHtSZWNvcmQ8c3RyaW5nLCBzdHJpbmc+fSAtIENoaWxkIHByb2Nlc3MgZW52aXJvbm1lbnQgYWRkaXRpb25zLlxuICAgKi9cbiAgX2NoaWxkQmFja2dyb3VuZEpvYnNFbnZpcm9ubWVudCgpIHtcbiAgICBjb25zdCBjb25maWd1cmF0aW9uID0gdGhpcy5jb25maWd1cmF0aW9uXG4gICAgaWYgKCFjb25maWd1cmF0aW9uKSB0aHJvdyBuZXcgRXJyb3IoXCJCYWNrZ3JvdW5kIGpvYnMgd29ya2VyIGNvbmZpZ3VyYXRpb24gbm90IGluaXRpYWxpemVkXCIpXG4gICAgaWYgKCF0aGlzLmhvc3QgfHwgdHlwZW9mIHRoaXMucG9ydCAhPT0gXCJudW1iZXJcIikgdGhyb3cgbmV3IEVycm9yKFwiQmFja2dyb3VuZCBqb2JzIHdvcmtlciBlbmRwb2ludCBub3QgcmVzb2x2ZWRcIilcblxuICAgIHJldHVybiB7XG4gICAgICBWRUxPQ0lPVVNfQkFDS0dST1VORF9KT0JfQ0hJTEQ6IFwiMVwiLFxuICAgICAgVkVMT0NJT1VTX0VOVjogY29uZmlndXJhdGlvbi5nZXRFbnZpcm9ubWVudCgpLFxuICAgICAgVkVMT0NJT1VTX0JBQ0tHUk9VTkRfSk9CU19IT1NUOiB0aGlzLmhvc3QsXG4gICAgICBWRUxPQ0lPVVNfQkFDS0dST1VORF9KT0JTX1BPUlQ6IGAke3RoaXMucG9ydH1gLFxuICAgICAgLi4uKHRoaXMuZ2VuZXJhdGlvbklkID8ge1ZFTE9DSU9VU19CQUNLR1JPVU5EX0pPQlNfR0VORVJBVElPTl9JRDogdGhpcy5nZW5lcmF0aW9uSWR9IDoge30pXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgcmVwb3J0IGpvYiByZXN1bHQuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gT3B0aW9ucy5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGFyZ3Muam9iSWQgLSBKb2IgaWQuXG4gICAqIEBwYXJhbSB7XCJjb21wbGV0ZWRcIiB8IFwiZmFpbGVkXCIgfCBcInJlc2NoZWR1bGVkXCJ9IGFyZ3Muc3RhdHVzIC0gU3RhdHVzLlxuICAgKiBAcGFyYW0ge251bWJlcn0gW2FyZ3MuZGVsYXlNc10gLSBSZXNjaGVkdWxlIGRlbGF5IGluIG1pbGxpc2Vjb25kcy5cbiAgICogQHBhcmFtIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gW2FyZ3MuZXJyb3JdIC0gRXJyb3IuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBbYXJncy5oYW5kb2ZmSWRdIC0gSGFuZG9mZiBsZWFzZSBpZC5cbiAgICogQHBhcmFtIHtudW1iZXJ9IFthcmdzLmhhbmRlZE9mZkF0TXNdIC0gSGFuZGVkIG9mZiB0aW1lc3RhbXAuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBbYXJncy53b3JrZXJJZF0gLSBXb3JrZXIgaWQuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi90eXBlcy5qc1wiKS5Qb29sZWRSdW5uZXJGYWlsdXJlfSBbYXJncy5ydW5uZXJGYWlsdXJlXSAtIFBvb2xlZC1jaGlsZCBwcm9jZXNzIGZhaWx1cmUgcHJvdmVuYW5jZS5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgd2hlbiByZXBvcnRlZC5cbiAgICovXG4gIGFzeW5jIF9yZXBvcnRKb2JSZXN1bHQoe2pvYklkLCBzdGF0dXMsIGRlbGF5TXMsIGVycm9yLCBoYW5kb2ZmSWQsIGhhbmRlZE9mZkF0TXMsIHdvcmtlcklkLCBydW5uZXJGYWlsdXJlfSkge1xuICAgIGlmICghdGhpcy5zdGF0dXNSZXBvcnRlcikgcmV0dXJuXG5cbiAgICB0cnkge1xuICAgICAgLy8gUmV0cnkgYSB0cmFuc2llbnQgcGVyc2lzdCBmYWlsdXJlIChgam9iLXVwZGF0ZS1lcnJvcmApOiB0aGUgd29ya2VyIGlzXG4gICAgICAvLyBsb25nLWxpdmVkIGFuZCBjYW5ub3QgZXhpdCB0byB0cmlnZ2VyIG9ycGhhbiByZWNsYWltLCBzbyBkcm9wcGluZyB0aGVcbiAgICAgIC8vIGNvbXBsZXRpb24gaGVyZSB3b3VsZCBzdHJhbmQgdGhlIGpvYiBpbiBgaGFuZGVkX29mZmAgZm9yZXZlciDigJQgZmF0YWwgZm9yIGFcbiAgICAgIC8vIGBtYXhfY29uY3VycmVuY3k6IDFgIGpvYiAoYSBzdHJhbmRlZCByb3cgYmxvY2tzIGV2ZXJ5IGZ1dHVyZSBydW4pLlxuICAgICAgYXdhaXQgdGhpcy5zdGF0dXNSZXBvcnRlci5yZXBvcnRXaXRoUmV0cnkoe2pvYklkLCBzdGF0dXMsIGRlbGF5TXMsIGVycm9yLCBoYW5kb2ZmSWQsIGhhbmRlZE9mZkF0TXMsIHdvcmtlcklkLCBydW5uZXJGYWlsdXJlLCByZXRyeVBlcnNpc3RFcnJvcnM6IHRydWV9KVxuICAgIH0gY2F0Y2ggKHJlcG9ydEVycm9yKSB7XG4gICAgICBjb25zb2xlLmVycm9yKFwiQmFja2dyb3VuZCBqb2Igc3RhdHVzIHJlcG9ydGluZyBmYWlsZWQ6XCIsIHJlcG9ydEVycm9yKVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBGaXJlcyBhIGR1cmFibGUgam9iLXJlc3VsdCByZXBvcnQgd2l0aG91dCBibG9ja2luZyB0aGUgY2FsbGVyIChzbyBmcmVlaW5nIGFcbiAgICogam9iL2NoaWxkIHNsb3QgbmV2ZXIgd2FpdHMgb24gdGhlIHJlcG9ydCkuIFRoZSByZXBvcnQgaXMgdHJhY2tlZCBzbyBhXG4gICAqIGdyYWNlZnVsIGBzdG9wKClgIGNhbiBkcmFpbiBpbi1mbGlnaHQgcmVwb3J0cyBiZWZvcmUgY2xvc2luZyB0aGUgc29ja2V0LlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIE9wdGlvbnMuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBhcmdzLmpvYklkIC0gSm9iIGlkLlxuICAgKiBAcGFyYW0ge1wiY29tcGxldGVkXCIgfCBcImZhaWxlZFwiIHwgXCJyZXNjaGVkdWxlZFwifSBhcmdzLnN0YXR1cyAtIFN0YXR1cy5cbiAgICogQHBhcmFtIHtudW1iZXJ9IFthcmdzLmRlbGF5TXNdIC0gUmVzY2hlZHVsZSBkZWxheSBpbiBtaWxsaXNlY29uZHMuXG4gICAqIEBwYXJhbSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59IFthcmdzLmVycm9yXSAtIEVycm9yLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gW2FyZ3MuaGFuZG9mZklkXSAtIEhhbmRvZmYgbGVhc2UgaWQuXG4gICAqIEBwYXJhbSB7bnVtYmVyfSBbYXJncy5oYW5kZWRPZmZBdE1zXSAtIEhhbmRlZCBvZmYgdGltZXN0YW1wLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gW2FyZ3Mud29ya2VySWRdIC0gV29ya2VyIGlkLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vdHlwZXMuanNcIikuUG9vbGVkUnVubmVyRmFpbHVyZX0gW2FyZ3MucnVubmVyRmFpbHVyZV0gLSBQb29sZWQtY2hpbGQgcHJvY2VzcyBmYWlsdXJlIHByb3ZlbmFuY2UuXG4gICAqIEByZXR1cm5zIHt2b2lkfVxuICAgKi9cbiAgX3JlcG9ydEpvYlJlc3VsdEluQmFja2dyb3VuZCh7am9iSWQsIHN0YXR1cywgZGVsYXlNcywgZXJyb3IsIGhhbmRvZmZJZCwgaGFuZGVkT2ZmQXRNcywgd29ya2VySWQsIHJ1bm5lckZhaWx1cmV9KSB7XG4gICAgLyoqXG4gICAgICogRGVmaW5lcyByZXBvcnQuXG4gICAgICogQHR5cGUge1Byb21pc2U8dm9pZD59ICovXG4gICAgbGV0IHJlcG9ydFxuXG4gICAgcmVwb3J0ID0gdGhpcy5fcmVwb3J0Sm9iUmVzdWx0KHtqb2JJZCwgc3RhdHVzLCBkZWxheU1zLCBlcnJvciwgaGFuZG9mZklkLCBoYW5kZWRPZmZBdE1zLCB3b3JrZXJJZCwgcnVubmVyRmFpbHVyZX0pLmZpbmFsbHkoKCkgPT4ge1xuICAgICAgdGhpcy5pbmZsaWdodFJlcG9ydHMuZGVsZXRlKHJlcG9ydClcbiAgICB9KVxuXG4gICAgdGhpcy5pbmZsaWdodFJlcG9ydHMuYWRkKHJlcG9ydClcbiAgfVxufVxuIl19