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
        // Waiters blocked in _runPooledJob because the pool is at its hard cap: a job may
        // not spawn a child while total live children (working + draining) is at the cap.
        /** @type {Set<() => void>} */
        this._pooledSlotWaiters = new Set();
        /** @type {ReturnType<typeof setInterval> | undefined} - Safety poll that re-checks the slot condition. */
        this._pooledSlotWaitTimer = undefined;
    }
    /** Starts the slot-waiter safety poll if it is not already running. */
    _startPooledSlotWaitPoll() {
        if (this._pooledSlotWaitTimer)
            return;
        this._pooledSlotWaitTimer = setInterval(() => this._wakePooledSlotWaiters(), 50);
        this._pooledSlotWaitTimer.unref();
    }
    /** Stops the slot-waiter safety poll once no waiter is registered. */
    _stopPooledSlotWaitPollIfIdle() {
        if (this._pooledSlotWaiters.size > 0 || !this._pooledSlotWaitTimer)
            return;
        clearInterval(this._pooledSlotWaitTimer);
        this._pooledSlotWaitTimer = undefined;
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
     * Hard cap on total live pooled children (working + draining): children the
     * pool may still spawn. Counting the whole live set — draining children
     * included — is what bounds pool memory: a draining child still holds its
     * RSS until its last in-flight job finishes, so it must occupy a cap slot.
     * @returns {number} - Number of children the pool may still spawn.
     */
    _spawnablePooledChildren() {
        return Math.max(0, this.pooledRunnerCount - this.pooledChildren.size);
    }
    /**
     * Resolves once a non-retiring pooled child has a free concurrency slot or the
     * pool may spawn a new one. Pooled jobs admitted while the pool is at its
     * hard cap wait here instead of spawning an over-capacity child; the wake
     * points are the only capacity-freeing transitions (a job outcome and a child
     * exit), so no polling is needed.
     * @returns {Promise<void>} - Resolves when a slot is available.
     */
    _waitPooledSlot() {
        this._startPooledSlotWaitPoll();
        return new Promise((resolve) => {
            const waiter = () => {
                this._pooledSlotWaiters.delete(waiter);
                this._stopPooledSlotWaitPollIfIdle();
                resolve();
            };
            this._pooledSlotWaiters.add(waiter);
        });
    }
    /**
     * Resolves every registered waiter; waiters re-check the slot condition
     * themselves and only proceed when it holds.
     * @returns {void}
     */
    _wakePooledSlotWaiters() {
        if (this._pooledSlotWaiters.size === 0)
            return;
        for (const resolve of [...this._pooledSlotWaiters])
            resolve();
    }
    /**
     * Free pooled slots across the pool: open slots in non-retiring children plus
     * the slots we could add by spawning more children up to the hard cap on total
     * live children. Retiring children (draining before replacement) never
     * contribute capacity, and they count against the cap: while one is still
     * draining, no replacement is advertised (or spawned) — the pool advertises
     * exactly what it can serve instead of phantom capacity.
     * @returns {number} - Number of pooled jobs the worker can accept right now.
     */
    _availablePooledSlots() {
        let openInExisting = 0;
        let queuedReservations = 0;
        for (const child of this.pooledChildren) {
            const state = this.pooledChildStates.get(child);
            if (!state || state.retiring)
                continue;
            openInExisting += this.pooledRunnerConcurrency - state.inflight.size;
        }
        for (const queue of this.pooledJobQueues.values())
            queuedReservations += queue.length;
        const spawnableChildren = Math.max(0, this.pooledRunnerCount - this.pooledChildren.size);
        return Math.max(0, openInExisting + spawnableChildren * this.pooledRunnerConcurrency - queuedReservations);
    }
    /**
     * Runs a payload on a pooled child with a free concurrency slot, spawning a
     * new child when every non-retiring child is full and the pool is below
     * `pooledRunnerCount`. Each child runs up to `pooledRunnerConcurrency` jobs at
     * once on its own event loop.
     *
     * When the pool is already at its hard cap (total live children, draining
     * included), the job waits for a slot instead of spawning: that is what keeps
     * the live-child count — and therefore the pool's total RSS — bounded. The
     * wait resolves on the only two capacity-freeing transitions (a job outcome,
     * a child exit); a safety poll covers anything missed.
     * @param {import("./types.js").BackgroundJobPayload & {id: string}} payload - Job payload.
     * @returns {Promise<void>} - Resolves after the durable report.
     */
    async _runPooledJob(payload) {
        // At the hard cap (no free slot, no spawnable child) the job waits for a
        // slot instead of spawning an over-capacity child — that is what bounds
        // the live-child count and the pool's total RSS.
        let child = this._selectPooledChild();
        while (!child) {
            if (this._spawnablePooledChildren() === 0) {
                // Shutdown: main no longer dispatches and no slot will ever free —
                // stop waiting so the tracked job can settle and the drain completes.
                if (this.shouldStop)
                    return;
                await this._waitPooledSlot();
                child = this._selectPooledChild();
                continue;
            }
            child = this._selectPooledChild() || this._createPooledChild();
        }
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
     * Creates a reusable pooled child, enforcing the hard cap on total live
     * children (working + draining). Returns undefined when the cap is already
     * met — the only way a new child may exist is a slot being open, so the
     * caller re-checks and waits again.
     * @returns {import("node:child_process").ChildProcess | undefined} - The new child, or undefined when the pool is at its cap.
     */
    _createPooledChild() {
        const configuration = this.configuration;
        if (!configuration)
            throw new Error("Background jobs worker configuration not initialized");
        if (this.pooledChildren.size >= this.pooledRunnerCount)
            return undefined;
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
        // A job outcome frees a concurrency slot and may drain a retiring child —
        // the only two transitions that free capacity for waiters at the hard cap.
        this._wakePooledSlotWaiters();
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
     * Marks a pooled child for retirement and — when the pool is below its hard
     * cap — eagerly spawns a single replacement (1-for-1) so its capacity is
     * restored immediately without waiting for it to finish draining. The
     * replacement spawn is gated by the cap (the retiring child still counts as
     * live until it exits), so a full pool simply defers the replacement to the
     * retiring child's drain instead of spawning over capacity. The retiring
     * child stops receiving new jobs and is terminated only once its in-flight
     * set drains, so a long-running job (e.g. a build) is never cut off.
     * @param {import("node:child_process").ChildProcess} child - Child to retire.
     * @returns {void}
     */
    _beginRetirePooledChild(child) {
        const state = this.pooledChildStates.get(child);
        if (!state || state.retiring)
            return;
        state.retiring = true;
        // Best-effort pre-warm: skip when stopping (no new work) or before the
        // worker is initialized (no configuration to fork a child from). The cap
        // inside _createPooledChild refuses the spawn while the pool is full, in
        // which case the replacement is deferred to the drain path.
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
     * Because the hard cap counts live children, the exit of this child frees a
     * slot: any deferred replacement (the pool was full when the child retired)
     * is spawned now, and capacity is re-advertised so main can dispatch into it.
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
        // Child exit frees a hard-cap slot even while its in-flight set is still
        // being reported — wake waiters now; their reports settle independently.
        this._wakePooledSlotWaiters();
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoid29ya2VyLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiLi4vLi4vLi4vc3JjL2JhY2tncm91bmQtam9icy93b3JrZXIuanMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6IkFBQUEsWUFBWTtBQUVaLE9BQU8sR0FBRyxNQUFNLEtBQUssQ0FBQTtBQUNyQixPQUFPLEVBQUUsSUFBSSxFQUFFLEtBQUssRUFBRSxNQUFNLG9CQUFvQixDQUFBO0FBQ2hELE9BQU8sVUFBVSxNQUFNLGtCQUFrQixDQUFBO0FBQ3pDLE9BQU8scUJBQXFCLE1BQU0sbUJBQW1CLENBQUE7QUFDckQsT0FBTyxxQkFBcUIsTUFBTSw4QkFBOEIsQ0FBQTtBQUNoRSxPQUFPLDRCQUE0QixNQUFNLHNCQUFzQixDQUFBO0FBQy9ELE9BQU8sRUFBRSxVQUFVLEVBQUUsTUFBTSxRQUFRLENBQUE7QUFDbkMsT0FBTyxFQUFFLGFBQWEsRUFBRSxNQUFNLFVBQVUsQ0FBQTtBQUN4QyxPQUFPLGlCQUFpQixFQUFFLEVBQUUsZ0JBQWdCLEVBQUUsTUFBTSxnQ0FBZ0MsQ0FBQTtBQUNwRixPQUFPLDZCQUE2QixNQUFNLHdCQUF3QixDQUFBO0FBQ2xFLE9BQU8sb0JBQW9CLE1BQU0sa0JBQWtCLENBQUE7QUFDbkQsT0FBTyxFQUFFLDJCQUEyQixFQUFFLE1BQU0sd0JBQXdCLENBQUE7QUFDcEUsT0FBTyxFQUFFLHdCQUF3QixFQUFFLE1BQU0sMEJBQTBCLENBQUE7QUFDbkUsT0FBTyw2Q0FBNkMsRUFBRSxFQUFFLHVDQUF1QyxFQUFFLG9DQUFvQyxFQUFFLE1BQU0seUNBQXlDLENBQUE7QUFDdEwsT0FBTyxFQUFFLG1DQUFtQyxFQUFFLGlDQUFpQyxFQUFFLDJCQUEyQixFQUFFLDJCQUEyQixFQUFFLE1BQU0sNkJBQTZCLENBQUE7QUFFOUs7Ozs7Ozs7R0FPRztBQUNIOzs7Ozs7R0FNRztBQUNIOzs7Ozs7Ozs7Ozs7Ozs7Ozs7R0FrQkc7QUFDSCxpRkFBaUY7QUFDakYsTUFBTSw2QkFBNkIsR0FBRyxJ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LEVBQUUsTUFBTSxFQUFFLE9BQU8sRUFBRSxLQUFLLEVBQUUsU0FBUyxFQUFFLGFBQWEsRUFBRSxRQUFRLEVBQUUsYUFBYSxFQUFDO1FBQzdHOzttQ0FFMkI7UUFDM0IsSUFBSSxNQUFNLENBQUE7UUFFVixNQUFNLEdBQUcsSUFBSSxDQUFDLGdCQUFnQixDQUFDLEVBQUMsS0FBSyxFQUFFLE1BQU0sRUFBRSxPQUFPLEVBQUUsS0FBSyxFQUFFLFNBQVMsRUFBRSxhQUFhLEVBQUUsUUFBUSxFQUFFLGFBQWEsRUFBQyxDQUFDLENBQUMsT0FBTyxDQUFDLEdBQUcsRUFBRTtZQUM5SCxJQUFJLENBQUMsZUFBZSxDQUFDLE1BQU0sQ0FBQyxNQUFNLENBQUMsQ0FBQTtRQUNyQyxDQUFDLENBQUMsQ0FBQTtRQUVGLElBQUksQ0FBQyxlQUFlLENBQUMsR0FBRyxDQUFDLE1BQU0sQ0FBQyxDQUFBO0lBQ2xDLENBQUM7Q0FDRiIsInNvdXJjZXNDb250ZW50IjpbIi8vIEB0cy1jaGVja1xuXG5pbXBvcnQgbmV0IGZyb20gXCJuZXRcIlxuaW1wb3J0IHsgZm9yaywgc3Bhd24gfSBmcm9tIFwibm9kZTpjaGlsZF9wcm9jZXNzXCJcbmltcG9ydCBKc29uU29ja2V0IGZyb20gXCIuL2pzb24tc29ja2V0LmpzXCJcbmltcG9ydCBCYWNrZ3JvdW5kSm9iUmVnaXN0cnkgZnJvbSBcIi4vam9iLXJlZ2lzdHJ5LmpzXCJcbmltcG9ydCBjb25maWd1cmF0aW9uUmVzb2x2ZXIgZnJvbSBcIi4uL2NvbmZpZ3VyYXRpb24tcmVzb2x2ZXIuanNcIlxuaW1wb3J0IEJhY2tncm91bmRKb2JzU3RhdHVzUmVwb3J0ZXIgZnJvbSBcIi4vc3RhdHVzLXJlcG9ydGVyLmpzXCJcbmltcG9ydCB7IHJhbmRvbVVVSUQgfSBmcm9tIFwiY3J5cHRvXCJcbmltcG9ydCB7IGZpbGVVUkxUb1BhdGggfSBmcm9tIFwibm9kZTp1cmxcIlxuaW1wb3J0IHNodXRkb3duTGlmZWN5Y2xlLCB7IHJ1blNodXRkb3duU3RlcHMgfSBmcm9tIFwiLi4vdXRpbHMvc2h1dGRvd24tbGlmZWN5Y2xlLmpzXCJcbmltcG9ydCBCYWNrZ3JvdW5kSm9iUmVzY2hlZHVsZVNpZ25hbCBmcm9tIFwiLi9yZXNjaGVkdWxlLXNpZ25hbC5qc1wiXG5pbXBvcnQgcGVyZm9ybUJhY2tncm91bmRKb2IgZnJvbSBcIi4vcGVyZm9ybS1qb2IuanNcIlxuaW1wb3J0IHsgcnVuV2l0aEJhY2tncm91bmRKb2JQYXlsb2FkIH0gZnJvbSBcIi4vZXhlY3V0aW9uLWNvbnRleHQuanNcIlxuaW1wb3J0IHsgY3JlYXRlR2VuZXJhdGlvbldvcmtlcklkIH0gZnJvbSBcIi4vZ2VuZXJhdGlvbi1pZGVudGl0eS5qc1wiXG5pbXBvcnQgQmFja2dyb3VuZEpvYnNHZW5lcmF0aW9uSGFuZHNoYWtlVGltZW91dEVycm9yLCB7IERFRkFVTFRfR0VORVJBVElPTl9IQU5EU0hBS0VfVElNRU9VVF9NUywgdmFsaWRhdGVHZW5lcmF0aW9uSGFuZHNoYWtlVGltZW91dE1zIH0gZnJvbSBcIi4vZ2VuZXJhdGlvbi1oYW5kc2hha2UtdGltZW91dC1lcnJvci5qc1wiXG5pbXBvcnQgeyBQT09MRURfUlVOTkVSX0lORkxJR0hUX0pPQl9JRF9MSU1JVCwgYm91bmRlZFBvb2xlZFJ1bm5lckluZmxpZ2h0Sm9iSWRzLCBpc1Bvb2xlZENoaWxkU2h1dGRvd25SZWFzb24sIGlzUG9vbGVkQ2hpbGRTaHV0ZG93blNpZ25hbCB9IGZyb20gXCIuL3Bvb2xlZC1ydW5uZXItc2h1dGRvd24uanNcIlxuXG4vKipcbiAqIFBlci1mb3JrZWQtY2hpbGQgdGltZW91dCBib29ra2VlcGluZy5cbiAqIEB0eXBlZGVmIHtvYmplY3R9IEZvcmtlZEpvYlRpbWVvdXRTdGF0ZVxuICogQHByb3BlcnR5IHtib29sZWFufSB0aW1lZE91dCAtIFdoZXRoZXIgdGhlIHRpbWVvdXQgZmlyZWQgYW5kIHRoZSBjaGlsZCB3YXMgdGVybWluYXRlZC5cbiAqIEBwcm9wZXJ0eSB7bnVtYmVyIHwgbnVsbH0gdGltZW91dE1zIC0gVGhlIGFybWVkIHRpbWVvdXQgaW4gbXMsIG9yIG51bGwgd2hlbiBkaXNhYmxlZC5cbiAqIEBwcm9wZXJ0eSB7UmV0dXJuVHlwZTx0eXBlb2Ygc2V0VGltZW91dD4gfCBudWxsfSB0aW1lciAtIFRoZSBwZW5kaW5nIHRpbWVvdXQgdGltZXIsIGNsZWFyZWQgb24gZXhpdC5cbiAqIEBwcm9wZXJ0eSB7UmV0dXJuVHlwZTx0eXBlb2Ygc2V0VGltZW91dD4gfCBudWxsfSBzaWdraWxsVGltZXIgLSBUaGUgcGVuZGluZyBTSUdLSUxMIGdyYWNlIHRpbWVyLCBjbGVhcmVkIG9uIGV4aXQuXG4gKi9cbi8qKlxuICogQHR5cGVkZWYge29iamVjdH0gUG9vbGVkSm9iRW50cnlcbiAqIEBwcm9wZXJ0eSB7aW1wb3J0KFwiLi90eXBlcy5qc1wiKS5CYWNrZ3JvdW5kSm9iUGF5bG9hZCAmIHtpZDogc3RyaW5nfX0gcGF5bG9hZCAtIER1cmFibGUgam9iIHBheWxvYWQuXG4gKiBAcHJvcGVydHkgeyh2YWx1ZTogdm9pZCkgPT4gdm9pZH0gW3Jlc29sdmVdIC0gQ29tcGxldGlvbiByZXNvbHZlci5cbiAqIEBwcm9wZXJ0eSB7UHJvbWlzZTx2b2lkPn0gW3Bvb2xlZEpvYl0gLSBUcmFja2VkIHBvb2xlZC1qb2IgcHJvbWlzZS5cbiAqIEBwcm9wZXJ0eSB7UmV0dXJuVHlwZTx0eXBlb2Ygc2V0VGltZW91dD4gfCBudWxsfSBbdGltZW91dFRpbWVyXSAtIFBlci1qb2IgdGltZW91dCB0aW1lci5cbiAqL1xuLyoqXG4gKiBAdHlwZWRlZiB7b2JqZWN0fSBQb29sZWRDaGlsZFN0YXRlXG4gKiBAcHJvcGVydHkge251bWJlcn0gY3JlYXRlZEF0TXMgLSBDaGlsZCBjcmVhdGlvbiB0aW1lc3RhbXAuXG4gKiBAcHJvcGVydHkge3N0cmluZ30gW2NoaWxkSW5zdGFuY2VJZF0gLSBTdGFibGUgaWRlbnRpdHkgcmVwb3J0ZWQgYnkgdGhlIGNoaWxkLlxuICogQHByb3BlcnR5IHtudW1iZXJ9IGpvYnNSdW4gLSBBY2tub3dsZWRnZWQgam9icyBjb21wbGV0ZWQgYnkgdGhpcyBjaGlsZC5cbiAqIEBwcm9wZXJ0eSB7TWFwPHN0cmluZywgUG9vbGVkSm9iRW50cnk+fSBpbmZsaWdodCAtIEpvYnMgY3VycmVudGx5IG93bmVkIGJ5IHRoaXMgY2hpbGQuXG4gKiBAcHJvcGVydHkge251bWJlcn0gbGFzdERpc3BhdGNoU2VxIC0gUm91bmQtcm9iaW4gZGlzcGF0Y2ggc2VxdWVuY2UuXG4gKiBAcHJvcGVydHkge2Jvb2xlYW59IHJldGlyaW5nIC0gV2hldGhlciB0aGlzIGNoaWxkIGlzIGRyYWluaW5nIGJlZm9yZSByZXRpcmVtZW50LlxuICogQHByb3BlcnR5IHtib29sZWFufSBbc3RhcnRlZF0gLSBXaGV0aGVyIHRoZSBjaGlsZCBjb21wbGV0ZWQgaXRzIHN0YXJ0dXAgaGFuZHNoYWtlLlxuICogQHByb3BlcnR5IHtib29sZWFufSBbc2V0dGxpbmddIC0gV2hldGhlciBmYWlsdXJlIGhhbmRsaW5nIGFscmVhZHkgb3ducyB0aGlzIGNoaWxkLlxuICogQHByb3BlcnR5IHtudW1iZXJ9IFtpcGNEaXNjb25uZWN0ZWRBdE1zXSAtIFBhcmVudCBvYnNlcnZhdGlvbiBvZiBJUEMgZGlzY29ubmVjdC5cbiAqIEBwcm9wZXJ0eSB7aW1wb3J0KFwiLi90eXBlcy5qc1wiKS5Qb29sZWRDaGlsZFNodXRkb3duT2JzZXJ2YXRpb259IFtzaHV0ZG93bk9ic2VydmF0aW9uXSAtIENoaWxkIG9ic2VydmF0aW9uIHNlbnQgYmVmb3JlIHRlYXJkb3duLlxuICogQHByb3BlcnR5IHtpbXBvcnQoXCIuL3R5cGVzLmpzXCIpLlBvb2xlZENoaWxkU2h1dGRvd25SZWFzb259IFtzaHV0ZG93blJlYXNvbl0gLSBFeGFjdCBwYXJlbnQtcmVxdWVzdGVkIHNodXRkb3duIHJlYXNvbi5cbiAqIEBwcm9wZXJ0eSB7bnVtYmVyfSBbc2h1dGRvd25SZXF1ZXN0ZWRBdE1zXSAtIEV4YWN0IHBhcmVudCBzaHV0ZG93bi1yZXF1ZXN0IHRpbWVzdGFtcC5cbiAqIEBwcm9wZXJ0eSB7aW1wb3J0KFwibm9kZTpjaGlsZF9wcm9jZXNzXCIpLkNoaWxkUHJvY2Vzc1tcInNpZ25hbENvZGVcIl19IFtzaHV0ZG93blNpZ25hbF0gLSBTaWduYWwgc2VsZWN0ZWQgYnkgdGhlIHBhcmVudCByZXF1ZXN0LlxuICogQHByb3BlcnR5IHtSZXR1cm5UeXBlPHR5cGVvZiBzZXRUaW1lb3V0Pn0gW3NodXRkb3duU2lnbmFsVGltZXJdIC0gRHJhaW5lZC1yZXRpcmVtZW50IGZhbGxiYWNrIHNpZ25hbCB0aW1lci5cbiAqIEBwcm9wZXJ0eSB7UmV0dXJuVHlwZTx0eXBlb2Ygc2V0VGltZW91dD4gfCBudWxsfSBbdGltZW91dFNpZ2tpbGxUaW1lcl0gLSBQZW5kaW5nIHRpbWVvdXQgU0lHS0lMTCB0aW1lci5cbiAqIEBwcm9wZXJ0eSB7c3RyaW5nfSBbdGltZW91dEpvYklkXSAtIEpvYiB3aG9zZSB0aW1lb3V0IGluaXRpYXRlZCB0ZXJtaW5hdGlvbi5cbiAqL1xuLyoqIEdyYWNlIHBlcmlvZCBhZnRlciBTSUdURVJNIGJlZm9yZSBhIGxpbmdlcmluZyBwcm9jZXNzIHJ1bm5lciBpcyBTSUdLSUxMZWQuICovXG5jb25zdCBGT1JLRURfQ0hJTERfU0lHS0lMTF9HUkFDRV9NUyA9IDUwMDBcbi8qKiBUaW1lIGEgZHJhaW5lZCByZXRpcmVtZW50IGdpdmVzIHRoZSBjaGlsZCBJUEMgcmVxdWVzdCB0byBiZWdpbiB0ZWFyZG93biBiZWZvcmUgU0lHVEVSTSBmYWxsYmFjay4gKi9cbmNvbnN0IFBPT0xFRF9SVU5ORVJfU0hVVERPV05fUkVRVUVTVF9HUkFDRV9NUyA9IDI1MFxuLyoqXG4gKiBMYXJnZXN0IGRlbGF5IE5vZGUncyBgc2V0VGltZW91dGAgYWNjZXB0cyB3aXRob3V0IG92ZXJmbG93aW5nIHRvIGEgMW1zIGRlbGF5XG4gKiAoYSAzMi1iaXQgc2lnbmVkIGludCBvZiBtcywgfjI0LjggZGF5cykuIEEgYGpvYlRpbWVvdXRNc2AgYWJvdmUgdGhpcyDigJQgb3IgYVxuICogbm9uLWZpbml0ZSBvbmUgbGlrZSBgSW5maW5pdHlgIOKAlCBpcyBjbGFtcGVkL2Rpc2FibGVkIHJhdGhlciB0aGFuIGNvZXJjZWQgdG9cbiAqIH4xbXMsIHdoaWNoIHdvdWxkIG90aGVyd2lzZSB0ZXJtaW5hdGUgZXZlcnkgZm9ya2VkIGpvYiBhbG1vc3QgaW1tZWRpYXRlbHkuXG4gKi9cbmNvbnN0IE1BWF9GT1JLRURfSk9CX1RJTUVPVVRfTVMgPSAyXzE0N180ODNfNjQ3XG5jb25zdCBGT1JLRURfUlVOTkVSX0VOVFJZX1BBVEggPSBmaWxlVVJMVG9QYXRoKG5ldyBVUkwoXCIuL2ZvcmtlZC1ydW5uZXItY2hpbGQuanNcIiwgaW1wb3J0Lm1ldGEudXJsKSlcbmNvbnN0IFBPT0xFRF9SVU5ORVJfRU5UUllfUEFUSCA9IGZpbGVVUkxUb1BhdGgobmV3IFVSTChcIi4vcG9vbGVkLXJ1bm5lci1jaGlsZC5qc1wiLCBpbXBvcnQubWV0YS51cmwpKVxuLyoqIEhvdyBvZnRlbiB0aGUgd29ya2VyIHNlbmRzIGEgbGl2ZW5lc3MgaGVhcnRiZWF0IHRvIHRoZSBtYWluLiAqL1xuY29uc3QgSEVBUlRCRUFUX0lOVEVSVkFMX01TID0gMTUwMDBcbi8qKlxuICogTWF4IHRpbWUgdGhlIHdvcmtlciBzcGVuZHMgcmV0cnlpbmcgb25lIHBvb2xlZCBjaGlsZCdzIGFjY2VwdGFuY2UgcmVwb3J0XG4gKiBiZWZvcmUgZHJvcHBpbmcgaXQuIEFjY2VwdGFuY2UgZXZpZGVuY2UgaXMgZGlhZ25vc3RpYyDigJQgYSBwZXJzaXN0ZW50XG4gKiBtYWluL0RCIG91dGFnZSBtdXN0IG5vdCBob2xkIHJ1bm5lciBjYXBhY2l0eSBob3N0YWdlLlxuICovXG5jb25zdCBDSElMRF9BQ0NFUFRBTkNFX1JFUE9SVF9NQVhfRFVSQVRJT05fTVMgPSAxMDAwMFxuLyoqIFRDUCBrZWVwYWxpdmUgc28gYSBoYWxmLW9wZW4gY29ubmVjdGlvbiB0byB0aGUgbWFpbiBzdXJmYWNlcyBhcyBhIGNsb3NlLiAqL1xuY29uc3QgU09DS0VUX0tFRVBBTElWRV9NUyA9IDEwMDAwXG4vKipcbiAqIEV4ZWN1dGlvbiBtb2Rlcy5cbiAqIEB0eXBlIHtpbXBvcnQoXCIuL3R5cGVzLmpzXCIpLkJhY2tncm91bmRKb2JFeGVjdXRpb25Nb2RlW119ICovXG5jb25zdCBFWEVDVVRJT05fTU9ERVMgPSBbXCJpbmxpbmVcIiwgXCJmb3JrZWRcIiwgXCJwb29sZWRcIiwgXCJzcGF3bmVkXCJdXG5cbi8qKlxuICogTm9ybWFsaXplcyBhIGNhbmRpZGF0ZSBwb29sZWQtcnVubmVyIGNvdW50IG9yIGpvYiBsaW1pdC5cbiAqIEBwYXJhbSB7bnVtYmVyIHwgdW5kZWZpbmVkfSB2YWx1ZSAtIENhbmRpZGF0ZSBwb3NpdGl2ZSBpbnRlZ2VyLlxuICogQHJldHVybnMge251bWJlciB8IHVuZGVmaW5lZH0gLSBOb3JtYWxpemVkIHZhbHVlLlxuICovXG5mdW5jdGlvbiBwb3NpdGl2ZUludGVnZXIodmFsdWUpIHtcbiAgcmV0dXJuIHR5cGVvZiB2YWx1ZSA9PT0gXCJudW1iZXJcIiAmJiBOdW1iZXIuaXNJbnRlZ2VyKHZhbHVlKSAmJiB2YWx1ZSA+IDAgPyB2YWx1ZSA6IHVuZGVmaW5lZFxufVxuXG4vKipcbiAqIENoZWNrcyB3aGV0aGVyIGFuIElQQyB2YWx1ZSBpcyBhIHBvb2xlZCBjaGlsZCdzIGFjY2VwdGFuY2Ugb2JzZXJ2YXRpb24gZm9yXG4gKiBvbmUgam9iLiBUaGUgY2hpbGQgY2FycmllcyBpdHMgZXhhY3QgaGFuZG9mZiBsZWFzZSBzbyB0aGUgd29ya2VyIGNhbiBmb3J3YXJkXG4gKiB0aGUgcmVwb3J0IHdpdGhvdXQgZGVwZW5kaW5nIG9uIGl0cyBpbi1mbGlnaHQgZW50cnkgc3RpbGwgZXhpc3RpbmcuXG4gKiBAcGFyYW0ge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSBtZXNzYWdlIC0gSVBDIG1lc3NhZ2UuXG4gKiBAcmV0dXJucyB7bWVzc2FnZSBpcyB7dHlwZTogXCJqb2ItcmVjZWl2ZWRcIiB8IFwiam9iLXN0YXJ0ZWRcIiwgam9iSWQ6IHN0cmluZywgaGFuZG9mZklkPzogc3RyaW5nLCB3b3JrZXJJZD86IHN0cmluZywgaGFuZGVkT2ZmQXRNcz86IG51bWJlciwgcmVjZWl2ZWRBdE1zPzogbnVtYmVyLCBzdGFydGVkQXRNcz86IG51bWJlciwgY2hpbGRJbnN0YW5jZUlkPzogc3RyaW5nLCBjaGlsZFBpZD86IG51bWJlcn19IC0gV2hldGhlciB0aGlzIGlzIGEgdmFsaWQgYWNjZXB0YW5jZSBtZXNzYWdlLlxuICovXG5mdW5jdGlvbiBpc0NoaWxkQWNjZXB0YW5jZU1lc3NhZ2UobWVzc2FnZSkge1xuICBpZiAoIW1lc3NhZ2UgfHwgdHlwZW9mIG1lc3NhZ2UgIT09IFwib2JqZWN0XCIpIHJldHVybiBmYWxzZVxuICBjb25zdCByZWNvcmQgPSAvKiogQHR5cGUge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gKi8gKG1lc3NhZ2UpXG5cbiAgcmV0dXJuIChyZWNvcmQudHlwZSA9PT0gXCJqb2ItcmVjZWl2ZWRcIiB8fCByZWNvcmQudHlwZSA9PT0gXCJqb2Itc3RhcnRlZFwiKVxuICAgICYmIHR5cGVvZiByZWNvcmQuam9iSWQgPT09IFwic3RyaW5nXCJcbiAgICAmJiAocmVjb3JkLmhhbmRvZmZJZCA9PT0gdW5kZWZpbmVkIHx8IHR5cGVvZiByZWNvcmQuaGFuZG9mZklkID09PSBcInN0cmluZ1wiKVxuICAgICYmIChyZWNvcmQud29ya2VySWQgPT09IHVuZGVmaW5lZCB8fCB0eXBlb2YgcmVjb3JkLndvcmtlcklkID09PSBcInN0cmluZ1wiKVxuICAgICYmIChyZWNvcmQuaGFuZGVkT2ZmQXRNcyA9PT0gdW5kZWZpbmVkIHx8IHR5cGVvZiByZWNvcmQuaGFuZGVkT2ZmQXRNcyA9PT0gXCJudW1iZXJcIilcbiAgICAmJiAocmVjb3JkLnJlY2VpdmVkQXRNcyA9PT0gdW5kZWZpbmVkIHx8IHR5cGVvZiByZWNvcmQucmVjZWl2ZWRBdE1zID09PSBcIm51bWJlclwiKVxuICAgICYmIChyZWNvcmQuc3RhcnRlZEF0TXMgPT09IHVuZGVmaW5lZCB8fCB0eXBlb2YgcmVjb3JkLnN0YXJ0ZWRBdE1zID09PSBcIm51bWJlclwiKVxuICAgICYmIChyZWNvcmQuY2hpbGRJbnN0YW5jZUlkID09PSB1bmRlZmluZWQgfHwgdHlwZW9mIHJlY29yZC5jaGlsZEluc3RhbmNlSWQgPT09IFwic3RyaW5nXCIpXG4gICAgJiYgKHJlY29yZC5jaGlsZFBpZCA9PT0gdW5kZWZpbmVkIHx8IE51bWJlci5pc0ludGVnZXIocmVjb3JkLmNoaWxkUGlkKSlcbn1cblxuLyoqXG4gKiBDaGVja3Mgd2hldGhlciBhbiBJUEMgdmFsdWUgaXMgdGhlIGNoaWxkJ3MgYm91bmRlZCBwcmUtdGVhcmRvd24gb2JzZXJ2YXRpb24uXG4gKiBAcGFyYW0ge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSBtZXNzYWdlIC0gSVBDIG1lc3NhZ2UuXG4gKiBAcmV0dXJucyB7bWVzc2FnZSBpcyBpbXBvcnQoXCIuL3R5cGVzLmpzXCIpLlBvb2xlZENoaWxkU2h1dGRvd25PYnNlcnZhdGlvbiAmIHt0eXBlOiBcInNodXRkb3duLW9ic2VydmF0aW9uXCJ9fSAtIFdoZXRoZXIgdGhpcyBpcyBhIHZhbGlkIHNodXRkb3duIG9ic2VydmF0aW9uLlxuICovXG5mdW5jdGlvbiBpc0NoaWxkU2h1dGRvd25PYnNlcnZhdGlvbk1lc3NhZ2UobWVzc2FnZSkge1xuICBpZiAoIW1lc3NhZ2UgfHwgdHlwZW9mIG1lc3NhZ2UgIT09IFwib2JqZWN0XCIpIHJldHVybiBmYWxzZVxuICBjb25zdCByZWNvcmQgPSAvKiogQHR5cGUge3tjaGlsZEluc3RhbmNlSWQ/OiBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPiwgaW5mbGlnaHRKb2JJZHM/OiBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPiwgaW5mbGlnaHRKb2JJZHNUcnVuY2F0ZWRDb3VudD86IFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+LCByZWFzb24/OiBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPiwgc2h1dGRvd25PYnNlcnZlZEF0TXM/OiBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPiwgc2h1dGRvd25SZXF1ZXN0ZWRBdE1zPzogUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4sIHNpZ25hbD86IFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+LCB0eXBlPzogUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59fSAqLyAobWVzc2FnZSlcblxuICByZXR1cm4gcmVjb3JkLnR5cGUgPT09IFwic2h1dGRvd24tb2JzZXJ2YXRpb25cIlxuICAgICYmIHR5cGVvZiByZWNvcmQuY2hpbGRJbnN0YW5jZUlkID09PSBcInN0cmluZ1wiXG4gICAgJiYgQXJyYXkuaXNBcnJheShyZWNvcmQuaW5mbGlnaHRKb2JJZHMpXG4gICAgJiYgcmVjb3JkLmluZmxpZ2h0Sm9iSWRzLmxlbmd0aCA8PSBQT09MRURfUlVOTkVSX0lORkxJR0hUX0pPQl9JRF9MSU1JVFxuICAgICYmIHJlY29yZC5pbmZsaWdodEpvYklkcy5ldmVyeSgoam9iSWQpID0+IHR5cGVvZiBqb2JJZCA9PT0gXCJzdHJpbmdcIilcbiAgICAmJiBOdW1iZXIuaXNJbnRlZ2VyKHJlY29yZC5pbmZsaWdodEpvYklkc1RydW5jYXRlZENvdW50KVxuICAgICYmIHJlY29yZC5pbmZsaWdodEpvYklkc1RydW5jYXRlZENvdW50ID49IDBcbiAgICAmJiBpc1Bvb2xlZENoaWxkU2h1dGRvd25SZWFzb24ocmVjb3JkLnJlYXNvbilcbiAgICAmJiB0eXBlb2YgcmVjb3JkLnNodXRkb3duT2JzZXJ2ZWRBdE1zID09PSBcIm51bWJlclwiXG4gICAgJiYgTnVtYmVyLmlzRmluaXRlKHJlY29yZC5zaHV0ZG93bk9ic2VydmVkQXRNcylcbiAgICAmJiAocmVjb3JkLnNodXRkb3duUmVxdWVzdGVkQXRNcyA9PT0gbnVsbCB8fCAodHlwZW9mIHJlY29yZC5zaHV0ZG93blJlcXVlc3RlZEF0TXMgPT09IFwibnVtYmVyXCIgJiYgTnVtYmVyLmlzRmluaXRlKHJlY29yZC5zaHV0ZG93blJlcXVlc3RlZEF0TXMpKSlcbiAgICAmJiBpc1Bvb2xlZENoaWxkU2h1dGRvd25TaWduYWwocmVjb3JkLnNpZ25hbClcbn1cblxuLyoqXG4gKiBOb3JtYWxpemVzIGEgY2FuZGlkYXRlIHBvb2xlZC1ydW5uZXIgcmVzb3VyY2UgbGltaXQuXG4gKiBAcGFyYW0ge251bWJlciB8IHVuZGVmaW5lZH0gdmFsdWUgLSBDYW5kaWRhdGUgcG9zaXRpdmUgbnVtYmVyLlxuICogQHJldHVybnMge251bWJlciB8IHVuZGVmaW5lZH0gLSBOb3JtYWxpemVkIHZhbHVlLlxuICovXG5mdW5jdGlvbiBwb3NpdGl2ZU51bWJlcih2YWx1ZSkge1xuICByZXR1cm4gdHlwZW9mIHZhbHVlID09PSBcIm51bWJlclwiICYmIE51bWJlci5pc0Zpbml0ZSh2YWx1ZSkgJiYgdmFsdWUgPiAwID8gdmFsdWUgOiB1bmRlZmluZWRcbn1cblxuZXhwb3J0IGRlZmF1bHQgY2xhc3MgQmFja2dyb3VuZEpvYnNXb3JrZXIge1xuICAvKipcbiAgICogUnVucyBjb25zdHJ1Y3Rvci5cbiAgICogQHBhcmFtIHtvYmplY3R9IFthcmdzXSAtIE9wdGlvbnMuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vY29uZmlndXJhdGlvbi5qc1wiKS5kZWZhdWx0fSBbYXJncy5jb25maWd1cmF0aW9uXSAtIENvbmZpZ3VyYXRpb24uXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBbYXJncy5ob3N0XSAtIEhvc3RuYW1lLlxuICAgKiBAcGFyYW0ge251bWJlcn0gW2FyZ3MucG9ydF0gLSBQb3J0LlxuICAgKiBAcGFyYW0ge3N0cmluZ30gW2FyZ3MuZ2VuZXJhdGlvbklkXSAtIEV4cGxpY2l0IHJlbGVhc2UgZ2VuZXJhdGlvbiBpZGVudGl0eS5cbiAgICogQHBhcmFtIHtzdHJpbmd9IFthcmdzLndvcmtlckluc3RhbmNlSWRdIC0gRXhwbGljaXQgc3RhYmxlIHdvcmtlciBVVUlELlxuICAgKiBAcGFyYW0ge251bWJlcn0gW2FyZ3MubWF4Q29uY3VycmVudEZvcmtlZEpvYnNdIC0gT3ZlcnJpZGUgdGhlIHByb2Nlc3MgcnVubmVyIGNvbmN1cnJlbmN5IGNhcCBmcm9tIGBjb25maWd1cmF0aW9uLmdldEJhY2tncm91bmRKb2JzQ29uZmlnKClgLlxuICAgKiBAcGFyYW0ge251bWJlcn0gW2FyZ3MubWF4Q29uY3VycmVudElubGluZUpvYnNdIC0gT3ZlcnJpZGUgdGhlIGlubGluZS1qb2IgY29uY3VycmVuY3kgY2FwIGZyb20gYGNvbmZpZ3VyYXRpb24uZ2V0QmFja2dyb3VuZEpvYnNDb25maWcoKWAuXG4gICAqIEBwYXJhbSB7bnVtYmVyfSBbYXJncy5wb29sZWRSdW5uZXJDb3VudF0gLSBPdmVycmlkZSB0aGUgcG9vbGVkIHJ1bm5lciBjb3VudC5cbiAgICogQHBhcmFtIHtudW1iZXJ9IFthcmdzLnBvb2xlZFJ1bm5lckNvbmN1cnJlbmN5XSAtIE92ZXJyaWRlIHRoZSBwZXItcnVubmVyIGNvbmN1cnJlbmN5LlxuICAgKiBAcGFyYW0ge251bWJlcn0gW2FyZ3MucG9vbGVkUnVubmVyTWF4Sm9ic10gLSBPdmVycmlkZSB0aGUgcGVyLXJ1bm5lciByZWN5Y2xlIGpvYiBjb3VudC5cbiAgICogQHBhcmFtIHtudW1iZXJ9IFthcmdzLnBvb2xlZFJ1bm5lck1heFJzc0J5dGVzXSAtIE92ZXJyaWRlIHRoZSBwZXItcnVubmVyIHJlY3ljbGUgUlNTIGxpbWl0LlxuICAgKiBAcGFyYW0ge251bWJlcn0gW2FyZ3MucG9vbGVkUnVubmVyTWF4TGlmZXRpbWVNc10gLSBPdmVycmlkZSB0aGUgcGVyLXJ1bm5lciByZWN5Y2xlIGxpZmV0aW1lLlxuICAgKiBAcGFyYW0ge251bWJlcn0gW2FyZ3MuZm9ya2VkQ2hpbGRTaWdraWxsR3JhY2VNc10gLSBPdmVycmlkZSB0aGUgZ3JhY2UgcGVyaW9kIGJldHdlZW4gU0lHVEVSTSBhbmQgU0lHS0lMTCB3aGVuIHJlYXBpbmcgbGluZ2VyaW5nIHByb2Nlc3MgcnVubmVycyBvbiBzdG9wLlxuICAgKiBAcGFyYW0ge251bWJlcn0gW2FyZ3MuaGVhcnRiZWF0SW50ZXJ2YWxNc10gLSBPdmVycmlkZSB0aGUgbGl2ZW5lc3MgaGVhcnRiZWF0IGludGVydmFsIChkZWZhdWx0IDE1MDAwbXMpLlxuICAgKiBAcGFyYW0ge251bWJlcn0gW2FyZ3MuZ2VuZXJhdGlvbkhhbmRzaGFrZVRpbWVvdXRNc10gLSBNYXhpbXVtIHRpbWUgdG8gd2FpdCBmb3IgZ2VuZXJhdGlvbiBhY2tub3dsZWRnZW1lbnQgKGRlZmF1bHQ6IDQwMDApLlxuICAgKiBAcGFyYW0ge251bWJlcn0gW2FyZ3MucmVjb25uZWN0RGVsYXlNc10gLSBEZWxheSBiZWZvcmUgcmVjb25uZWN0aW5nIGFuIGVzdGFibGlzaGVkIHdvcmtlciBjb25uZWN0aW9uIChkZWZhdWx0OiAxMDAwKS5cbiAgICogQHBhcmFtIHtudW1iZXJ9IFthcmdzLmpvYlRpbWVvdXRNc10gLSBPdmVycmlkZSB0aGUgd2FsbC1jbG9jayB0aW1lb3V0IGZvciBmb3JrZWQgYW5kIHBvb2xlZCBqb2JzIGZyb20gYGNvbmZpZ3VyYXRpb24uZ2V0QmFja2dyb3VuZEpvYnNDb25maWcoKWAuIGAwYCBkaXNhYmxlcyBpdC5cbiAgICogQHBhcmFtIHtib29sZWFufSBbYXJncy5jbG9zZURhdGFiYXNlQ29ubmVjdGlvbnNPblN0b3BdIC0gV2hldGhlciBzdG9wIG93bnMgY2xvc2luZyB0aGUgY29uZmlndXJhdGlvbidzIGRhdGFiYXNlIHBvb2xzIChkZWZhdWx0IHRydWUpLlxuICAgKiBAcGFyYW0geygpID0+IHZvaWQgfCBQcm9taXNlPHZvaWQ+fSBbYXJncy5vblN0b3BwZWRdIC0gTGlmZWN5Y2xlIGhvb2sgaW52b2tlZCBhZnRlciB0aGUgd29ya2VyIGZpbmlzaGVzIHN0b3BwaW5nLlxuICAgKiBAcGFyYW0geygpID0+IHZvaWR9IFthcmdzLm9uR2VuZXJhdGlvbkFjY2VwdGVkXSAtIEV4cGxpY2l0IGdlbmVyYXRpb24tYWNjZXB0YW5jZSBvYnNlcnZhdGlvbiBob29rLlxuICAgKiBAcGFyYW0geygpID0+IHZvaWR9IFthcmdzLm9uUmV0aXJlTWVzc2FnZV0gLSBFeHBsaWNpdCByZXRpcmUtbWVzc2FnZSBvYnNlcnZhdGlvbiBob29rLlxuICAgKi9cbiAgY29uc3RydWN0b3Ioe2NvbmZpZ3VyYXRpb24sIGhvc3QsIHBvcnQsIGdlbmVyYXRpb25JZCwgd29ya2VySW5zdGFuY2VJZCwgbWF4Q29uY3VycmVudEZvcmtlZEpvYnMsIG1heENvbmN1cnJlbnRJbmxpbmVKb2JzLCBwb29sZWRSdW5uZXJDb3VudCwgcG9vbGVkUnVubmVyQ29uY3VycmVuY3ksIHBvb2xlZFJ1bm5lck1heEpvYnMsIHBvb2xlZFJ1bm5lck1heFJzc0J5dGVzLCBwb29sZWRSdW5uZXJNYXhMaWZldGltZU1zLCBmb3JrZWRDaGlsZFNpZ2tpbGxHcmFjZU1zLCBoZWFydGJlYXRJbnRlcnZhbE1zLCBnZW5lcmF0aW9uSGFuZHNoYWtlVGltZW91dE1zID0gREVGQVVMVF9HRU5FUkFUSU9OX0hBTkRTSEFLRV9USU1FT1VUX01TLCByZWNvbm5lY3REZWxheU1zID0gMTAwMCwgam9iVGltZW91dE1zLCBjbG9zZURhdGFiYXNlQ29ubmVjdGlvbnNPblN0b3AgPSB0cnVlLCBvblN0b3BwZWQsIG9uR2VuZXJhdGlvbkFjY2VwdGVkLCBvblJldGlyZU1lc3NhZ2V9ID0ge30pIHtcbiAgICAvKipcbiAgICAgKiBOYXJyb3dzIHRoZSBydW50aW1lIHZhbHVlIHRvIHRoZSBkb2N1bWVudGVkIHR5cGUuXG4gICAgICogQHR5cGUge1Byb21pc2U8aW1wb3J0KFwiLi4vY29uZmlndXJhdGlvbi5qc1wiKS5kZWZhdWx0Pn0gKi9cbiAgICB0aGlzLmNvbmZpZ3VyYXRpb25Qcm9taXNlID0gY29uZmlndXJhdGlvbiA/IFByb21pc2UucmVzb2x2ZShjb25maWd1cmF0aW9uKSA6IGNvbmZpZ3VyYXRpb25SZXNvbHZlcigpXG4gICAgLyoqXG4gICAgICogTmFycm93cyB0aGUgcnVudGltZSB2YWx1ZSB0byB0aGUgZG9jdW1lbnRlZCB0eXBlLlxuICAgICAqIEB0eXBlIHtpbXBvcnQoXCIuLi9jb25maWd1cmF0aW9uLmpzXCIpLmRlZmF1bHQgfCB1bmRlZmluZWR9ICovXG4gICAgdGhpcy5jb25maWd1cmF0aW9uID0gdW5kZWZpbmVkXG4gICAgdGhpcy5ob3N0ID0gaG9zdFxuICAgIHRoaXMucG9ydCA9IHBvcnRcbiAgICB0aGlzLmV4cGxpY2l0R2VuZXJhdGlvbklkID0gZ2VuZXJhdGlvbklkXG4gICAgdGhpcy53b3JrZXJJbnN0YW5jZUlkID0gd29ya2VySW5zdGFuY2VJZCB8fCByYW5kb21VVUlEKClcbiAgICAvKiogQHR5cGUge3N0cmluZyB8IHVuZGVmaW5lZH0gKi9cbiAgICB0aGlzLmdlbmVyYXRpb25JZCA9IHVuZGVmaW5lZFxuICAgIHRoaXMuY2xvc2VEYXRhYmFzZUNvbm5lY3Rpb25zT25TdG9wID0gY2xvc2VEYXRhYmFzZUNvbm5lY3Rpb25zT25TdG9wXG4gICAgdGhpcy5vblN0b3BwZWQgPSBvblN0b3BwZWRcbiAgICB0aGlzLm9uR2VuZXJhdGlvbkFjY2VwdGVkID0gb25HZW5lcmF0aW9uQWNjZXB0ZWRcbiAgICB0aGlzLm9uUmV0aXJlTWVzc2FnZSA9IG9uUmV0aXJlTWVzc2FnZVxuICAgIC8qKlxuICAgICAqIENvbnN0cnVjdG9yIG92ZXJyaWRlIGZvciB0aGUgaW5saW5lLWpvYiBjb25jdXJyZW5jeSBjYXAuIFdoZW4gdW5zZXRcbiAgICAgKiB0aGUgY2FwIGlzIHJlYWQgZnJvbSBgY29uZmlndXJhdGlvbi5nZXRCYWNrZ3JvdW5kSm9ic0NvbmZpZygpYCBpblxuICAgICAqIGBzdGFydCgpYCAoZGVmYXVsdDogNCkuXG4gICAgICogQHR5cGUge251bWJlciB8IHVuZGVmaW5lZH1cbiAgICAgKi9cbiAgICB0aGlzLm1heENvbmN1cnJlbnRJbmxpbmVKb2JzT3ZlcnJpZGUgPSB0eXBlb2YgbWF4Q29uY3VycmVudElubGluZUpvYnMgPT09IFwibnVtYmVyXCIgJiYgbWF4Q29uY3VycmVudElubGluZUpvYnMgPj0gMVxuICAgICAgPyBtYXhDb25jdXJyZW50SW5saW5lSm9ic1xuICAgICAgOiB1bmRlZmluZWRcbiAgICAvKipcbiAgICAgKiBOYXJyb3dzIHRoZSBydW50aW1lIHZhbHVlIHRvIHRoZSBkb2N1bWVudGVkIHR5cGUuXG4gICAgICogQHR5cGUge251bWJlciB8IHVuZGVmaW5lZH0gKi9cbiAgICB0aGlzLm1heENvbmN1cnJlbnRGb3JrZWRKb2JzT3ZlcnJpZGUgPSB0eXBlb2YgbWF4Q29uY3VycmVudEZvcmtlZEpvYnMgPT09IFwibnVtYmVyXCIgJiYgbWF4Q29uY3VycmVudEZvcmtlZEpvYnMgPj0gMVxuICAgICAgPyBtYXhDb25jdXJyZW50Rm9ya2VkSm9ic1xuICAgICAgOiB1bmRlZmluZWRcbiAgICAvKipcbiAgICAgKiBSZXNvbHZlZCBjYXAgZm9yIGlubGluZS1qb2IgY29uY3VycmVuY3kuIFNldCBpbiBgc3RhcnQoKWA7IGRlZmF1bHRzIHRvXG4gICAgICogNCBpZiBubyBjb25maWd1cmF0aW9uIHZhbHVlIGlzIGF2YWlsYWJsZS5cbiAgICAgKiBAdHlwZSB7bnVtYmVyfVxuICAgICAqL1xuICAgIHRoaXMubWF4Q29uY3VycmVudElubGluZUpvYnMgPSB0aGlzLm1heENvbmN1cnJlbnRJbmxpbmVKb2JzT3ZlcnJpZGUgfHwgNFxuICAgIC8qKlxuICAgICAqIE5hcnJvd3MgdGhlIHJ1bnRpbWUgdmFsdWUgdG8gdGhlIGRvY3VtZW50ZWQgdHlwZS5cbiAgICAgKiBAdHlwZSB7bnVtYmVyfSAqL1xuICAgIHRoaXMubWF4Q29uY3VycmVudEZvcmtlZEpvYnMgPSB0aGlzLm1heENvbmN1cnJlbnRGb3JrZWRKb2JzT3ZlcnJpZGUgfHwgNFxuICAgIHRoaXMucG9vbGVkUnVubmVyQ291bnRPdmVycmlkZSA9IHBvc2l0aXZlSW50ZWdlcihwb29sZWRSdW5uZXJDb3VudClcbiAgICB0aGlzLnBvb2xlZFJ1bm5lckNvbmN1cnJlbmN5T3ZlcnJpZGUgPSBwb3NpdGl2ZUludGVnZXIocG9vbGVkUnVubmVyQ29uY3VycmVuY3kpXG4gICAgdGhpcy5wb29sZWRSdW5uZXJNYXhKb2JzT3ZlcnJpZGUgPSBwb3NpdGl2ZUludGVnZXIocG9vbGVkUnVubmVyTWF4Sm9icylcbiAgICB0aGlzLnBvb2xlZFJ1bm5lck1heFJzc0J5dGVzT3ZlcnJpZGUgPSBwb3NpdGl2ZU51bWJlcihwb29sZWRSdW5uZXJNYXhSc3NCeXRlcylcbiAgICB0aGlzLnBvb2xlZFJ1bm5lck1heExpZmV0aW1lTXNPdmVycmlkZSA9IHBvc2l0aXZlTnVtYmVyKHBvb2xlZFJ1bm5lck1heExpZmV0aW1lTXMpXG4gICAgdGhpcy5wb29sZWRSdW5uZXJDb3VudCA9IHRoaXMucG9vbGVkUnVubmVyQ291bnRPdmVycmlkZSB8fCA0XG4gICAgdGhpcy5wb29sZWRSdW5uZXJDb25jdXJyZW5jeSA9IHRoaXMucG9vbGVkUnVubmVyQ29uY3VycmVuY3lPdmVycmlkZSB8fCAxXG4gICAgdGhpcy5wb29sZWRSdW5uZXJNYXhKb2JzID0gdGhpcy5wb29sZWRSdW5uZXJNYXhKb2JzT3ZlcnJpZGUgfHwgMTAwXG4gICAgdGhpcy5wb29sZWRSdW5uZXJNYXhSc3NCeXRlcyA9IHRoaXMucG9vbGVkUnVubmVyTWF4UnNzQnl0ZXNPdmVycmlkZSB8fCA1MTIgKiAxMDI0ICogMTAyNFxuICAgIHRoaXMucG9vbGVkUnVubmVyTWF4TGlmZXRpbWVNcyA9IHRoaXMucG9vbGVkUnVubmVyTWF4TGlmZXRpbWVNc092ZXJyaWRlIHx8IDYwICogNjAgKiAxMDAwXG4gICAgLyoqXG4gICAgICogR3JhY2UgcGVyaW9kIGJldHdlZW4gU0lHVEVSTSBhbmQgU0lHS0lMTCB3aGVuIHJlYXBpbmcgcHJvY2VzcyBydW5uZXJzIHRoYXRcbiAgICAgKiBvdXRsYXN0IGEgYm91bmRlZCBzaHV0ZG93biBkcmFpbi5cbiAgICAgKiBAdHlwZSB7bnVtYmVyfVxuICAgICAqL1xuICAgIHRoaXMuZm9ya2VkQ2hpbGRTaWdraWxsR3JhY2VNcyA9IHR5cGVvZiBmb3JrZWRDaGlsZFNpZ2tpbGxHcmFjZU1zID09PSBcIm51bWJlclwiICYmIGZvcmtlZENoaWxkU2lna2lsbEdyYWNlTXMgPj0gMFxuICAgICAgPyBmb3JrZWRDaGlsZFNpZ2tpbGxHcmFjZU1zXG4gICAgICA6IEZPUktFRF9DSElMRF9TSUdLSUxMX0dSQUNFX01TXG4gICAgLyoqXG4gICAgICogQ29uc3RydWN0b3Igb3ZlcnJpZGUgZm9yIHRoZSBmb3JrZWQgYW5kIHBvb2xlZCB3YWxsLWNsb2NrIGpvYiB0aW1lb3V0LiBXaGVuIHVuc2V0IHRoZVxuICAgICAqIHRpbWVvdXQgaXMgcmVhZCBmcm9tIGBjb25maWd1cmF0aW9uLmdldEJhY2tncm91bmRKb2JzQ29uZmlnKCkuam9iVGltZW91dE1zYFxuICAgICAqIGF0IGZvcmsgdGltZSAoZGVmYXVsdDogZGlzYWJsZWQpLlxuICAgICAqIEB0eXBlIHtudW1iZXIgfCB1bmRlZmluZWR9XG4gICAgICovXG4gICAgdGhpcy5qb2JUaW1lb3V0TXNPdmVycmlkZSA9IHR5cGVvZiBqb2JUaW1lb3V0TXMgPT09IFwibnVtYmVyXCIgPyBqb2JUaW1lb3V0TXMgOiB1bmRlZmluZWRcbiAgICB0aGlzLnNob3VsZFN0b3AgPSBmYWxzZVxuICAgIHRoaXMuaXNSZXRpcmluZyA9IGZhbHNlXG4gICAgLyoqIEB0eXBlIHtQcm9taXNlPHZvaWQ+IHwgdW5kZWZpbmVkfSAqL1xuICAgIHRoaXMuc3RvcFByb21pc2UgPSB1bmRlZmluZWRcbiAgICAvKipcbiAgICAgKiBSZXNvbHZlcyBzdG9wIG9ic2VydmF0aW9uLlxuICAgICAqIEB0eXBlIHsodmFsdWU/OiB2b2lkKSA9PiB2b2lkfVxuICAgICAqL1xuICAgIHRoaXMuX3Jlc29sdmVTdG9wcGVkID0gKCkgPT4ge31cbiAgICAvKipcbiAgICAgKiBSZWplY3RzIHN0b3Agb2JzZXJ2YXRpb24uXG4gICAgICogQHR5cGUgeyhlcnJvcjogRXJyb3IpID0+IHZvaWR9XG4gICAgICovXG4gICAgdGhpcy5fcmVqZWN0U3RvcHBlZCA9ICgpID0+IHt9XG4gICAgLyoqIEB0eXBlIHtQcm9taXNlPHZvaWQ+fSAqL1xuICAgIHRoaXMuX3N0b3BwZWRQcm9taXNlID0gUHJvbWlzZS5yZXNvbHZlKClcbiAgICB0aGlzLl9yZXNldFN0b3BwZWRQcm9taXNlKClcbiAgICB0aGlzLndvcmtlcklkID0gdGhpcy53b3JrZXJJbnN0YW5jZUlkXG4gICAgdGhpcy5fZ2VuZXJhdGlvbkFjY2VwdGVkID0gZmFsc2VcbiAgICB0aGlzLmdlbmVyYXRpb25IYW5kc2hha2VUaW1lb3V0TXMgPSB2YWxpZGF0ZUdlbmVyYXRpb25IYW5kc2hha2VUaW1lb3V0TXMoZ2VuZXJhdGlvbkhhbmRzaGFrZVRpbWVvdXRNcylcbiAgICBpZiAoIU51bWJlci5pc0ludGVnZXIocmVjb25uZWN0RGVsYXlNcykgfHwgcmVjb25uZWN0RGVsYXlNcyA8IDAgfHwgcmVjb25uZWN0RGVsYXlNcyA+IE1BWF9GT1JLRURfSk9CX1RJTUVPVVRfTVMpIHtcbiAgICAgIHRocm93IG5ldyBUeXBlRXJyb3IoXCJyZWNvbm5lY3REZWxheU1zIG11c3QgYmUgYW4gaW50ZWdlciBiZXR3ZWVuIDAgYW5kIDIxNDc0ODM2NDdcIilcbiAgICB9XG4gICAgdGhpcy5yZWNvbm5lY3REZWxheU1zID0gcmVjb25uZWN0RGVsYXlNc1xuICAgIC8qKiBAdHlwZSB7UmV0dXJuVHlwZTx0eXBlb2Ygc2V0VGltZW91dD4gfCB1bmRlZmluZWR9ICovXG4gICAgdGhpcy5fcmVjb25uZWN0VGltZXIgPSB1bmRlZmluZWRcbiAgICB0aGlzLmhlYXJ0YmVhdEludGVydmFsTXMgPSB0eXBlb2YgaGVhcnRiZWF0SW50ZXJ2YWxNcyA9PT0gXCJudW1iZXJcIiAmJiBoZWFydGJlYXRJbnRlcnZhbE1zID49IDFcbiAgICAgID8gaGVhcnRiZWF0SW50ZXJ2YWxNc1xuICAgICAgOiBIRUFSVEJFQVRfSU5URVJWQUxfTVNcbiAgICAvKipcbiAgICAgKiBOYXJyb3dzIHRoZSBydW50aW1lIHZhbHVlIHRvIHRoZSBkb2N1bWVudGVkIHR5cGUuXG4gICAgICogQHR5cGUge1JldHVyblR5cGU8dHlwZW9mIHNldEludGVydmFsPiB8IHVuZGVmaW5lZH0gKi9cbiAgICB0aGlzLl9oZWFydGJlYXRUaW1lciA9IHVuZGVmaW5lZFxuICAgIC8qKlxuICAgICAqIEluLWZsaWdodCBqb2ItcmVzdWx0IHJlcG9ydHMgdG8gdGhlIG1haW4uIFJlcG9ydGluZyBpcyBkZWNvdXBsZWQgZnJvbSB0aGVcbiAgICAgKiBqb2IvY2hpbGQgc2xvdCAoZnJlZWluZyB0aGUgc2xvdCBuZXZlciB3YWl0cyBvbiBhIHJlcG9ydCkgYW5kIHJldHJpZWRcbiAgICAgKiBkdXJhYmx5LCBzbyBhIHRyYW5zaWVudCBtYWluL0RCIG91dGFnZSBjYW5ub3QgbGVhayBzbG90cyBvciBsb3NlIGFcbiAgICAgKiB0ZXJtaW5hbCByZXBvcnQuIFRyYWNrZWQgc28gYSBncmFjZWZ1bCBgc3RvcCgpYCBjYW4gZHJhaW4gdGhlbS5cbiAgICAgKiBAdHlwZSB7U2V0PFByb21pc2U8dm9pZD4+fVxuICAgICAqL1xuICAgIHRoaXMuaW5mbGlnaHRSZXBvcnRzID0gbmV3IFNldCgpXG4gICAgLyoqXG4gICAgICogTmFycm93cyB0aGUgcnVudGltZSB2YWx1ZSB0byB0aGUgZG9jdW1lbnRlZCB0eXBlLlxuICAgICAqIEB0eXBlIHtKc29uU29ja2V0IHwgdW5kZWZpbmVkfSAqL1xuICAgIHRoaXMuanNvblNvY2tldCA9IHVuZGVmaW5lZFxuICAgIC8qKlxuICAgICAqIE5hcnJvd3MgdGhlIHJ1bnRpbWUgdmFsdWUgdG8gdGhlIGRvY3VtZW50ZWQgdHlwZS5cbiAgICAgKiBAdHlwZSB7QmFja2dyb3VuZEpvYnNTdGF0dXNSZXBvcnRlciB8IHVuZGVmaW5lZH0gKi9cbiAgICB0aGlzLnN0YXR1c1JlcG9ydGVyID0gdW5kZWZpbmVkXG4gICAgLyoqXG4gICAgICogVXAgdG8gYHRoaXMubWF4Q29uY3VycmVudElubGluZUpvYnNgIG9mIHRoZXNlIHJ1biBpbiBwYXJhbGxlbC4gVGhleVxuICAgICAqIHNoYXJlIHRoZSB3b3JrZXIncyBwcm9jZXNzIGFuZCBEQiBjb25uZWN0aW9uIHBvb2wsIHNvIGNvbmN1cnJlbmN5IGlzXG4gICAgICogYWJvdXQgb3ZlcmxhcHBpbmcgSS9PIHdhaXRzIOKAlCB1c2UgZm9ya2luZyBmb3IgbWVtb3J5IGlzb2xhdGlvbiBhY3Jvc3NcbiAgICAgKiBsb25nLXJ1bm5pbmcgam9icyBhbmQgZm9yIHVzaW5nIG1vcmUgY29yZXMuXG4gICAgICogQHR5cGUge1NldDxQcm9taXNlPHZvaWQ+Pn1cbiAgICAgKi9cbiAgICB0aGlzLmluZmxpZ2h0SW5saW5lSm9icyA9IG5ldyBTZXQoKVxuICAgIC8qKlxuICAgICAqIEluLWZsaWdodCBwcm9jZXNzIHJ1bm5lciBleGl0IHByb21pc2VzLiBUcmFja2VkIHNvIHByb2Nlc3Mtam9iIGhhbmRvZmZcbiAgICAgKiBzdGF5cyBib3VuZGVkIHdoaWxlIHJ1bm5pbmcgYW5kIHNvIGEgZ3JhY2VmdWwgYHN0b3AoKWAgY2FuIGRyYWluIHRoZW0uXG4gICAgICogQHR5cGUge1NldDxQcm9taXNlPHZvaWQ+Pn1cbiAgICAgKi9cbiAgICB0aGlzLmluZmxpZ2h0UHJvY2Vzc0pvYnMgPSBuZXcgU2V0KClcbiAgICAvKipcbiAgICAgKiBMaXZlIHByb2Nlc3MgcnVubmVyIGNoaWxkIHByb2Nlc3Nlcywga2VwdCBzbyBhIGdyYWNlZnVsIGBzdG9wKClgIGNhblxuICAgICAqIHRlcm1pbmF0ZSBhbnkgdGhhdCBvdXRsYXN0IHRoZSBzaHV0ZG93biBkcmFpbiBpbnN0ZWFkIG9mIG9ycGhhbmluZyB0aGVtXG4gICAgICogYWNyb3NzIGEgZGVwbG95ICh3aGVyZSB0aGV5IHdvdWxkIGtlZXAgcnVubmluZyBhZ2FpbnN0IGRlbGV0ZWQgcmVsZWFzZVxuICAgICAqIGNvZGUgYW5kIGhvbGRpbmcgZGF0YWJhc2UgY29ubmVjdGlvbnMpLlxuICAgICAqIEB0eXBlIHtTZXQ8aW1wb3J0KFwibm9kZTpjaGlsZF9wcm9jZXNzXCIpLkNoaWxkUHJvY2Vzcz59XG4gICAgICovXG4gICAgdGhpcy5pbmZsaWdodFByb2Nlc3NDaGlsZHJlbiA9IG5ldyBTZXQoKVxuICAgIC8qKiBAdHlwZSB7U2V0PFByb21pc2U8dm9pZD4+fSAqL1xuICAgIHRoaXMuaW5mbGlnaHRQb29sZWRKb2JzID0gbmV3IFNldCgpXG4gICAgLyoqIEB0eXBlIHtNYXA8c3RyaW5nLCBBcnJheTxpbXBvcnQoXCIuL3R5cGVzLmpzXCIpLkJhY2tncm91bmRKb2JQYXlsb2FkICYge2lkOiBzdHJpbmd9Pj59ICovXG4gICAgdGhpcy5wb29sZWRKb2JRdWV1ZXMgPSBuZXcgTWFwKClcbiAgICAvKiogQHR5cGUge01hcDxzdHJpbmcsIFByb21pc2U8dm9pZD4+fSAtIFBlci1pZCBvdXRlciBxdWV1ZSB0cmFja2Vycy4gKi9cbiAgICB0aGlzLnBvb2xlZEpvYlF1ZXVlVHJhY2tlcnMgPSBuZXcgTWFwKClcbiAgICAvKiogQHR5cGUge1NldDxpbXBvcnQoXCJub2RlOmNoaWxkX3Byb2Nlc3NcIikuQ2hpbGRQcm9jZXNzPn0gKi9cbiAgICB0aGlzLnBvb2xlZENoaWxkcmVuID0gbmV3IFNldCgpXG4gICAgLyoqIEB0eXBlIHtNYXA8aW1wb3J0KFwibm9kZTpjaGlsZF9wcm9jZXNzXCIpLkNoaWxkUHJvY2VzcywgUG9vbGVkQ2hpbGRTdGF0ZT59ICovXG4gICAgdGhpcy5wb29sZWRDaGlsZFN0YXRlcyA9IG5ldyBNYXAoKVxuICAgIC8qKiBAdHlwZSB7V2Vha1NldDxQcm9taXNlPHZvaWQ+Pn0gKi9cbiAgICB0aGlzLl9wb29sZWRTdGFydHVwRmFpbHVyZUpvYnMgPSBuZXcgV2Vha1NldCgpXG4gICAgLy8gTW9ub3RvbmljIGRpc3BhdGNoIGNvdW50ZXIgZm9yIHJvdW5kLXJvYmluIGNoaWxkIHNlbGVjdGlvbjogZWFjaCBkaXNwYXRjaCBzdGFtcHNcbiAgICAvLyB0aGUgY2hvc2VuIGNoaWxkLCBhbmQgc2VsZWN0aW9uIHByZWZlcnMgdGhlIGNoaWxkIGRpc3BhdGNoZWQgbGVhc3QgcmVjZW50bHkuXG4gICAgdGhpcy5fcG9vbGVkRGlzcGF0Y2hTZXEgPSAwXG4gICAgLy8gV2FpdGVycyBibG9ja2VkIGluIF9ydW5Qb29sZWRKb2IgYmVjYXVzZSB0aGUgcG9vbCBpcyBhdCBpdHMgaGFyZCBjYXA6IGEgam9iIG1heVxuICAgIC8vIG5vdCBzcGF3biBhIGNoaWxkIHdoaWxlIHRvdGFsIGxpdmUgY2hpbGRyZW4gKHdvcmtpbmcgKyBkcmFpbmluZykgaXMgYXQgdGhlIGNhcC5cbiAgICAvKiogQHR5cGUge1NldDwoKSA9PiB2b2lkPn0gKi9cbiAgICB0aGlzLl9wb29sZWRTbG90V2FpdGVycyA9IG5ldyBTZXQoKVxuICAgIC8qKiBAdHlwZSB7UmV0dXJuVHlwZTx0eXBlb2Ygc2V0SW50ZXJ2YWw+IHwgdW5kZWZpbmVkfSAtIFNhZmV0eSBwb2xsIHRoYXQgcmUtY2hlY2tzIHRoZSBzbG90IGNvbmRpdGlvbi4gKi9cbiAgICB0aGlzLl9wb29sZWRTbG90V2FpdFRpbWVyID0gdW5kZWZpbmVkXG4gIH1cblxuICAvKiogU3RhcnRzIHRoZSBzbG90LXdhaXRlciBzYWZldHkgcG9sbCBpZiBpdCBpcyBub3QgYWxyZWFkeSBydW5uaW5nLiAqL1xuICBfc3RhcnRQb29sZWRTbG90V2FpdFBvbGwoKSB7XG4gICAgaWYgKHRoaXMuX3Bvb2xlZFNsb3RXYWl0VGltZXIpIHJldHVyblxuXG4gICAgdGhpcy5fcG9vbGVkU2xvdFdhaXRUaW1lciA9IHNldEludGVydmFsKCgpID0+IHRoaXMuX3dha2VQb29sZWRTbG90V2FpdGVycygpLCA1MClcbiAgICB0aGlzLl9wb29sZWRTbG90V2FpdFRpbWVyLnVucmVmKClcbiAgfVxuXG4gIC8qKiBTdG9wcyB0aGUgc2xvdC13YWl0ZXIgc2FmZXR5IHBvbGwgb25jZSBubyB3YWl0ZXIgaXMgcmVnaXN0ZXJlZC4gKi9cbiAgX3N0b3BQb29sZWRTbG90V2FpdFBvbGxJZklkbGUoKSB7XG4gICAgaWYgKHRoaXMuX3Bvb2xlZFNsb3RXYWl0ZXJzLnNpemUgPiAwIHx8ICF0aGlzLl9wb29sZWRTbG90V2FpdFRpbWVyKSByZXR1cm5cblxuICAgIGNsZWFySW50ZXJ2YWwodGhpcy5fcG9vbGVkU2xvdFdhaXRUaW1lcilcbiAgICB0aGlzLl9wb29sZWRTbG90V2FpdFRpbWVyID0gdW5kZWZpbmVkXG4gIH1cblxuICAvKipcbiAgICogUnVucyBzdGFydC5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgd2hlbiBjb25uZWN0ZWQuXG4gICAqL1xuICBhc3luYyBzdGFydCgpIHtcbiAgICB0aGlzLnNob3VsZFN0b3AgPSBmYWxzZVxuICAgIHRoaXMuaXNSZXRpcmluZyA9IGZhbHNlXG4gICAgdGhpcy5zdG9wUHJvbWlzZSA9IHVuZGVmaW5lZFxuICAgIHRoaXMuX3Jlc2V0U3RvcHBlZFByb21pc2UoKVxuICAgIHRoaXMuY29uZmlndXJhdGlvbiA9IGF3YWl0IHRoaXMuY29uZmlndXJhdGlvblByb21pc2VcbiAgICB0aGlzLmNvbmZpZ3VyYXRpb24uc2V0Q3VycmVudCgpXG4gICAgY29uc3QgcmVzb2x2ZWRDb25maWcgPSB0aGlzLmNvbmZpZ3VyYXRpb24uZ2V0QmFja2dyb3VuZEpvYnNDb25maWcoKVxuICAgIHRoaXMuZ2VuZXJhdGlvbklkID0gdGhpcy5jb25maWd1cmF0aW9uLnJlc29sdmVCYWNrZ3JvdW5kSm9ic0dlbmVyYXRpb25Db25maWcoe1xuICAgICAgZ2VuZXJhdGlvbklkOiB0aGlzLmV4cGxpY2l0R2VuZXJhdGlvbklkLFxuICAgICAgc291cmNlTmFtZTogXCJCYWNrZ3JvdW5kSm9ic1dvcmtlclwiXG4gICAgfSkuZ2VuZXJhdGlvbklkXG4gICAgdGhpcy53b3JrZXJJZCA9IHRoaXMuZ2VuZXJhdGlvbklkXG4gICAgICA/IGNyZWF0ZUdlbmVyYXRpb25Xb3JrZXJJZCh7Z2VuZXJhdGlvbklkOiB0aGlzLmdlbmVyYXRpb25JZCwgd29ya2VySW5zdGFuY2VJZDogdGhpcy53b3JrZXJJbnN0YW5jZUlkfSlcbiAgICAgIDogdGhpcy53b3JrZXJJbnN0YW5jZUlkXG4gICAgdGhpcy5ob3N0IHx8PSByZXNvbHZlZENvbmZpZy5ob3N0XG4gICAgaWYgKHR5cGVvZiB0aGlzLnBvcnQgIT09IFwibnVtYmVyXCIpIHRoaXMucG9ydCA9IHJlc29sdmVkQ29uZmlnLnBvcnRcbiAgICBhd2FpdCB0aGlzLmNvbmZpZ3VyYXRpb24uaW5pdGlhbGl6ZSh7dHlwZTogXCJiYWNrZ3JvdW5kLWpvYnMtd29ya2VyXCJ9KVxuICAgIGF3YWl0IHRoaXMuY29uZmlndXJhdGlvbi5jb25uZWN0QmVhY29uKHtwZWVyVHlwZTogXCJiYWNrZ3JvdW5kLWpvYnMtd29ya2VyXCJ9KVxuXG4gICAgLy8gQ29uc3RydWN0b3Igb3ZlcnJpZGVzIHdpbjsgb3RoZXJ3aXNlIHBpY2sgdXAgdGhlIGNvbmZpZ3VyZWQgY2Fwcy5cbiAgICBpZiAodHlwZW9mIHRoaXMubWF4Q29uY3VycmVudElubGluZUpvYnNPdmVycmlkZSAhPT0gXCJudW1iZXJcIikge1xuICAgICAgY29uc3QgY29uZmlnID0gdGhpcy5jb25maWd1cmF0aW9uLmdldEJhY2tncm91bmRKb2JzQ29uZmlnKClcblxuICAgICAgdGhpcy5tYXhDb25jdXJyZW50SW5saW5lSm9icyA9IGNvbmZpZy5tYXhDb25jdXJyZW50SW5saW5lSm9icyB8fCB0aGlzLm1heENvbmN1cnJlbnRJbmxpbmVKb2JzXG4gICAgfVxuICAgIGlmICh0eXBlb2YgdGhpcy5tYXhDb25jdXJyZW50Rm9ya2VkSm9ic092ZXJyaWRlICE9PSBcIm51bWJlclwiKSB7XG4gICAgICBjb25zdCBjb25maWcgPSB0aGlzLmNvbmZpZ3VyYXRpb24uZ2V0QmFja2dyb3VuZEpvYnNDb25maWcoKVxuXG4gICAgICB0aGlzLm1heENvbmN1cnJlbnRGb3JrZWRKb2JzID0gY29uZmlnLm1heENvbmN1cnJlbnRGb3JrZWRKb2JzIHx8IHRoaXMubWF4Q29uY3VycmVudEZvcmtlZEpvYnNcbiAgICB9XG4gICAgY29uc3QgcG9vbENvbmZpZyA9IHRoaXMuY29uZmlndXJhdGlvbi5nZXRCYWNrZ3JvdW5kSm9ic0NvbmZpZygpXG4gICAgaWYgKHR5cGVvZiB0aGlzLnBvb2xlZFJ1bm5lckNvdW50T3ZlcnJpZGUgIT09IFwibnVtYmVyXCIpIHRoaXMucG9vbGVkUnVubmVyQ291bnQgPSBwb29sQ29uZmlnLnBvb2xlZFJ1bm5lckNvdW50XG4gICAgaWYgKHR5cGVvZiB0aGlzLnBvb2xlZFJ1bm5lckNvbmN1cnJlbmN5T3ZlcnJpZGUgIT09IFwibnVtYmVyXCIpIHRoaXMucG9vbGVkUnVubmVyQ29uY3VycmVuY3kgPSBwb29sQ29uZmlnLnBvb2xlZFJ1bm5lckNvbmN1cnJlbmN5XG4gICAgaWYgKHR5cGVvZiB0aGlzLnBvb2xlZFJ1bm5lck1heEpvYnNPdmVycmlkZSAhPT0gXCJudW1iZXJcIikgdGhpcy5wb29sZWRSdW5uZXJNYXhKb2JzID0gcG9vbENvbmZpZy5wb29sZWRSdW5uZXJNYXhKb2JzXG4gICAgaWYgKHR5cGVvZiB0aGlzLnBvb2xlZFJ1bm5lck1heFJzc0J5dGVzT3ZlcnJpZGUgIT09IFwibnVtYmVyXCIpIHRoaXMucG9vbGVkUnVubmVyTWF4UnNzQnl0ZXMgPSBwb29sQ29uZmlnLnBvb2xlZFJ1bm5lck1heFJzc0J5dGVzXG4gICAgaWYgKHR5cGVvZiB0aGlzLnBvb2xlZFJ1bm5lck1heExpZmV0aW1lTXNPdmVycmlkZSAhPT0gXCJudW1iZXJcIikgdGhpcy5wb29sZWRSdW5uZXJNYXhMaWZldGltZU1zID0gcG9vbENvbmZpZy5wb29sZWRSdW5uZXJNYXhMaWZldGltZU1zXG5cbiAgICB0aGlzLnN0YXR1c1JlcG9ydGVyID0gbmV3IEJhY2tncm91bmRKb2JzU3RhdHVzUmVwb3J0ZXIoe1xuICAgICAgY29uZmlndXJhdGlvbjogdGhpcy5jb25maWd1cmF0aW9uLFxuICAgICAgaG9zdDogdGhpcy5ob3N0LFxuICAgICAgcG9ydDogdGhpcy5wb3J0LFxuICAgICAgZ2VuZXJhdGlvbkhhbmRzaGFrZVRpbWVvdXRNczogdGhpcy5nZW5lcmF0aW9uSGFuZHNoYWtlVGltZW91dE1zLFxuICAgICAgZ2VuZXJhdGlvbklkOiB0aGlzLmdlbmVyYXRpb25JZFxuICAgIH0pXG4gICAgdHJ5IHtcbiAgICAgIGF3YWl0IHRoaXMuX2Nvbm5lY3Qoe2FsbG93UmVjb25uZWN0OiBmYWxzZX0pXG4gICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgIGxldCBjbGVhbnVwRXJyb3JcblxuICAgICAgdHJ5IHtcbiAgICAgICAgYXdhaXQgdGhpcy5zdG9wKClcbiAgICAgIH0gY2F0Y2ggKGNhdWdodENsZWFudXBFcnJvcikge1xuICAgICAgICBjbGVhbnVwRXJyb3IgPSBjYXVnaHRDbGVhbnVwRXJyb3JcbiAgICAgIH1cblxuICAgICAgaWYgKGNsZWFudXBFcnJvcikge1xuICAgICAgICB0aHJvdyBuZXcgQWdncmVnYXRlRXJyb3IoXG4gICAgICAgICAgW2Vycm9yLCBjbGVhbnVwRXJyb3JdLFxuICAgICAgICAgIFwiQmFja2dyb3VuZCBqb2JzIHdvcmtlciBzdGFydHVwIGFuZCBjbGVhbnVwIGZhaWxlZFwiLFxuICAgICAgICAgIHtjYXVzZTogZXJyb3J9XG4gICAgICAgIClcbiAgICAgIH1cblxuICAgICAgdGhyb3cgZXJyb3JcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogR3JhY2VmdWxseSBzdG9wcyB0aGUgd29ya2VyOiBhbm5vdW5jZXMgZHJhaW5pbmcgdG8gdGhlIG1haW4gcHJvY2VzcyBzb1xuICAgKiBubyBuZXcgam9icyBhcmUgZGlzcGF0Y2hlZCwgd2FpdHMgZm9yIGluLWZsaWdodCBpbmxpbmUgam9icyBhbmQgcHJvY2Vzc1xuICAgKiBydW5uZXJzIHRvIGZpbmlzaCAoc28gdGhlaXIgcmVzdWx0cyBjYW4gYmUgcmVwb3J0ZWQpLCB0aGVuIGNsb3NlcyB0aGVcbiAgICogc29ja2V0IGFuZCBkaXNjb25uZWN0cyBmcm9tIHRoZSBiZWFjb24uXG4gICAqXG4gICAqIFByb2Nlc3MgcnVubmVycyBhcmUgY2hpbGQgcHJvY2Vzc2VzLiBXaGVuIGEgYHRpbWVvdXRNc2AgaXMgZ2l2ZW4gKGUuZy4gYVxuICAgKiBkZXBsb3kgZHJhaW5pbmcgdGhlIG9sZCByZWxlYXNlKSBhbnkgcnVubmVyIHN0aWxsIGFsaXZlIGFmdGVyIHRoZSBkcmFpblxuICAgKiB3aW5kb3cgaXMgdGVybWluYXRlZCAoU0lHVEVSTSwgdGhlbiBTSUdLSUxMKSByYXRoZXIgdGhhbiBsZWZ0IHRvIG9ycGhhblxuICAgKiBhY3Jvc3MgdGhlIGRlcGxveS4gV2l0aCBubyBgdGltZW91dE1zYCB0aGUgZHJhaW4gd2FpdHMgZm9yIHJ1bm5lcnMgdG9cbiAgICogZmluaXNoIG9uIHRoZWlyIG93bi5cbiAgICogQHBhcmFtIHtvYmplY3R9IFthcmdzXSAtIE9wdGlvbnMuXG4gICAqIEBwYXJhbSB7bnVtYmVyfSBbYXJncy50aW1lb3V0TXNdIC0gTWF4IHdhaXQgZm9yIGluLWZsaWdodCBqb2JzIChwZXIgcGhhc2UpIGluIG1zLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyB3aGVuIHN0b3BwZWQuXG4gICAqL1xuICBzdG9wKHt0aW1lb3V0TXN9ID0ge30pIHtcbiAgICBjb25zdCBzdG9wUHJvbWlzZSA9IHRoaXMuc3RvcFByb21pc2UgfHwgdGhpcy5fc3RvcCh7dGltZW91dE1zfSlcblxuICAgIGlmICghdGhpcy5zdG9wUHJvbWlzZSkge1xuICAgICAgdGhpcy5zdG9wUHJvbWlzZSA9IHN0b3BQcm9taXNlXG4gICAgICB2b2lkIHN0b3BQcm9taXNlLnRoZW4odGhpcy5fcmVzb2x2ZVN0b3BwZWQsIChlcnJvcikgPT4ge1xuICAgICAgICB0aGlzLl9yZWplY3RTdG9wcGVkKGVycm9yIGluc3RhbmNlb2YgRXJyb3IgPyBlcnJvciA6IG5ldyBFcnJvcihTdHJpbmcoZXJyb3IpKSlcbiAgICAgIH0pXG4gICAgfVxuXG4gICAgcmV0dXJuIHN0b3BQcm9taXNlXG4gIH1cblxuICAvKipcbiAgICogV2FpdHMgZm9yIGF1dG9tYXRpYyBvciByZXF1ZXN0ZWQgc3RvcC5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgd2hlbiB0aGlzIHdvcmtlciBoYXMgZnVsbHkgc3RvcHBlZC5cbiAgICovXG4gIHdhaXRVbnRpbFN0b3BwZWQoKSB7IHJldHVybiB0aGlzLl9zdG9wcGVkUHJvbWlzZSB9XG5cbiAgLyoqIFJlc2V0cyB0aGUgc3RvcCBvYnNlcnZhdGlvbiBwcm9taXNlIGZvciBhIG5ldyB3b3JrZXIgc3RhcnQuICovXG4gIF9yZXNldFN0b3BwZWRQcm9taXNlKCkge1xuICAgIHRoaXMuX3N0b3BwZWRQcm9taXNlID0gbmV3IFByb21pc2UoKHJlc29sdmUsIHJlamVjdCkgPT4ge1xuICAgICAgdGhpcy5fcmVzb2x2ZVN0b3BwZWQgPSByZXNvbHZlXG4gICAgICB0aGlzLl9yZWplY3RTdG9wcGVkID0gcmVqZWN0XG4gICAgfSlcbiAgICB2b2lkIHRoaXMuX3N0b3BwZWRQcm9taXNlLmNhdGNoKCgpID0+IHt9KVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgdGhlIHdvcmtlciBzaHV0ZG93biBsaWZlY3ljbGUgb25jZS5cbiAgICogQHBhcmFtIHtvYmplY3R9IFthcmdzXSAtIE9wdGlvbnMuXG4gICAqIEBwYXJhbSB7bnVtYmVyfSBbYXJncy50aW1lb3V0TXNdIC0gTWF4IHdhaXQgZm9yIGluLWZsaWdodCBqb2JzIChwZXIgcGhhc2UpIGluIG1zLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyB3aGVuIHN0b3BwZWQuXG4gICAqL1xuICBhc3luYyBfc3RvcCh7dGltZW91dE1zfSA9IHt9KSB7XG4gICAgdGhpcy5zaG91bGRTdG9wID0gdHJ1ZVxuICAgIHRoaXMuaXNSZXRpcmluZyA9IHRydWVcbiAgICB0aGlzLl9zdG9wSGVhcnRiZWF0KClcbiAgICBpZiAodGhpcy5fcmVjb25uZWN0VGltZXIpIHtcbiAgICAgIGNsZWFyVGltZW91dCh0aGlzLl9yZWNvbm5lY3RUaW1lcilcbiAgICAgIHRoaXMuX3JlY29ubmVjdFRpbWVyID0gdW5kZWZpbmVkXG4gICAgfVxuXG4gICAgYXdhaXQgc2h1dGRvd25MaWZlY3ljbGUoe1xuICAgICAgb25TdG9wcGVkOiB0aGlzLm9uU3RvcHBlZCxcbiAgICAgIHNodXRkb3duOiBhc3luYyAoKSA9PiB7XG4gICAgICAgIC8vIEFubm91bmNlIGRyYWluIHNvIG1haW4gc3RvcHMgZGlzcGF0Y2hpbmcgYnV0IGtlZXBzIHRoZSBjb25uZWN0aW9uXG4gICAgICAgIC8vIG9wZW4gdW50aWwgd2UgY2xvc2UgaXQgb3Vyc2VsdmVzIGJlbG93LlxuICAgICAgICBpZiAodGhpcy5qc29uU29ja2V0KSB7XG4gICAgICAgICAgdHJ5IHtcbiAgICAgICAgICAgIHRoaXMuanNvblNvY2tldC5zZW5kKHt0eXBlOiBcImRyYWluaW5nXCJ9KVxuICAgICAgICAgIH0gY2F0Y2gge1xuICAgICAgICAgICAgLy8gU29ja2V0IG1heSBhbHJlYWR5IGJlIGNsb3Npbmc7IG5vdGhpbmcgdG8gZG8uXG4gICAgICAgICAgfVxuICAgICAgICB9XG5cbiAgICAgICAgYXdhaXQgdGhpcy5fZHJhaW5JbmZsaWdodCh0aGlzLmluZmxpZ2h0SW5saW5lSm9icywgdGltZW91dE1zKVxuICAgICAgICBhd2FpdCB0aGlzLl9kcmFpbkluZmxpZ2h0KHRoaXMuaW5mbGlnaHRQb29sZWRKb2JzLCB0aW1lb3V0TXMpXG4gICAgICAgIGF3YWl0IHRoaXMuX2RyYWluSW5mbGlnaHQodGhpcy5pbmZsaWdodFByb2Nlc3NKb2JzLCB0aW1lb3V0TXMpXG4gICAgICAgIGF3YWl0IHRoaXMuX3Rlcm1pbmF0ZVByb2Nlc3NDaGlsZHJlbigpXG4gICAgICAgIC8vIEdpdmUgaW4tZmxpZ2h0IHJlc3VsdCByZXBvcnRzIChub3cgZGVjb3VwbGVkIGZyb20gam9iIHNsb3RzKSBhIGJvdW5kZWRcbiAgICAgICAgLy8gY2hhbmNlIHRvIGxhbmQgYmVmb3JlIHRoZSBzb2NrZXQgY2xvc2VzLlxuICAgICAgICBhd2FpdCB0aGlzLl9kcmFpbkluZmxpZ2h0KHRoaXMuaW5mbGlnaHRSZXBvcnRzLCB0aW1lb3V0TXMpXG5cbiAgICAgICAgaWYgKHRoaXMuanNvblNvY2tldCkgdGhpcy5qc29uU29ja2V0LmNsb3NlKClcbiAgICAgICAgaWYgKCF0aGlzLmNvbmZpZ3VyYXRpb24pIHJldHVyblxuXG4gICAgICAgIGF3YWl0IHRoaXMuX2Nsb3NlQ29uZmlndXJhdGlvbigpXG4gICAgICB9XG4gICAgfSlcbiAgfVxuXG4gIC8qKiBCZWdpbnMgZ2VuZXJhdGlvbiByZXRpcmVtZW50IHdpdGhvdXQgcmV2b2tpbmcgbGl2ZW5lc3MgZHVyaW5nIHRoZSBkcmFpbi4gKi9cbiAgX2JlZ2luR2VuZXJhdGlvblJldGlyZW1lbnQoKSB7XG4gICAgaWYgKHRoaXMuc3RvcFByb21pc2UpIHJldHVyblxuXG4gICAgdGhpcy5pc1JldGlyaW5nID0gdHJ1ZVxuICAgIGNvbnN0IHN0b3BQcm9taXNlID0gdGhpcy5fc3RvcEFmdGVyR2VuZXJhdGlvbkRyYWluKClcbiAgICB0aGlzLnN0b3BQcm9taXNlID0gc3RvcFByb21pc2VcbiAgICB2b2lkIHN0b3BQcm9taXNlLnRoZW4odGhpcy5fcmVzb2x2ZVN0b3BwZWQsIChlcnJvcikgPT4ge1xuICAgICAgY29uc3Qgbm9ybWFsaXplZEVycm9yID0gZXJyb3IgaW5zdGFuY2VvZiBFcnJvciA/IGVycm9yIDogbmV3IEVycm9yKFN0cmluZyhlcnJvcikpXG5cbiAgICAgIHRoaXMuX3JlamVjdFN0b3BwZWQobm9ybWFsaXplZEVycm9yKVxuICAgICAgdGhpcy5fcmVwb3J0TGlmZWN5Y2xlRXJyb3Iobm9ybWFsaXplZEVycm9yKVxuICAgIH0pXG4gIH1cblxuICAvKipcbiAgICogRHJhaW5zIGFjY2VwdGVkIGdlbmVyYXRpb24gd29yayB3aGlsZSByZXRhaW5pbmcgdGhlIGV4YWN0IGNvbm5lY3Rpb24gYW5kXG4gICAqIGhlYXJ0YmVhdCwgdGhlbiBwZXJmb3JtcyB0aGUgZmluYWwgdGVybWluYXRpbmcgc3RvcC5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgYWZ0ZXIgdGhlIHdvcmtlciBoYXMgZnVsbHkgY2xvc2VkLlxuICAgKi9cbiAgYXN5bmMgX3N0b3BBZnRlckdlbmVyYXRpb25EcmFpbigpIHtcbiAgICBpZiAodGhpcy5qc29uU29ja2V0KSB7XG4gICAgICB0cnkge1xuICAgICAgICB0aGlzLmpzb25Tb2NrZXQuc2VuZCh7dHlwZTogXCJkcmFpbmluZ1wifSlcbiAgICAgIH0gY2F0Y2gge1xuICAgICAgICAvLyBUaGUgY2xvc2UgaGFuZGxlciBvd25zIGV4YWN0IHNhbWUtZ2VuZXJhdGlvbiByZWNvbm5lY3QuXG4gICAgICB9XG4gICAgfVxuXG4gICAgYXdhaXQgdGhpcy5fZHJhaW5JbmZsaWdodCh0aGlzLmluZmxpZ2h0SW5saW5lSm9icylcbiAgICBhd2FpdCB0aGlzLl9kcmFpbkluZmxpZ2h0KHRoaXMuaW5mbGlnaHRQb29sZWRKb2JzKVxuICAgIGF3YWl0IHRoaXMuX2RyYWluSW5mbGlnaHQodGhpcy5pbmZsaWdodFByb2Nlc3NKb2JzKVxuICAgIGF3YWl0IHRoaXMuX2RyYWluSW5mbGlnaHQodGhpcy5pbmZsaWdodFJlcG9ydHMpXG5cbiAgICB0aGlzLnNob3VsZFN0b3AgPSB0cnVlXG4gICAgdGhpcy5fc3RvcEhlYXJ0YmVhdCgpXG4gICAgaWYgKHRoaXMuX3JlY29ubmVjdFRpbWVyKSB7XG4gICAgICBjbGVhclRpbWVvdXQodGhpcy5fcmVjb25uZWN0VGltZXIpXG4gICAgICB0aGlzLl9yZWNvbm5lY3RUaW1lciA9IHVuZGVmaW5lZFxuICAgIH1cbiAgICBhd2FpdCB0aGlzLl90ZXJtaW5hdGVQcm9jZXNzQ2hpbGRyZW4oKVxuXG4gICAgYXdhaXQgc2h1dGRvd25MaWZlY3ljbGUoe1xuICAgICAgb25TdG9wcGVkOiB0aGlzLm9uU3RvcHBlZCxcbiAgICAgIHNodXRkb3duOiBhc3luYyAoKSA9PiB7XG4gICAgICAgIGlmICh0aGlzLmpzb25Tb2NrZXQpIHRoaXMuanNvblNvY2tldC5jbG9zZSgpXG4gICAgICAgIGlmICghdGhpcy5jb25maWd1cmF0aW9uKSByZXR1cm5cblxuICAgICAgICBhd2FpdCB0aGlzLl9jbG9zZUNvbmZpZ3VyYXRpb24oKVxuICAgICAgfVxuICAgIH0pXG4gIH1cblxuICAvKipcbiAgICogQ2xvc2VzIGFwcGxpY2F0aW9uIHJlc291cmNlcyBiZWZvcmUgZnJhbWV3b3JrIHJlc291cmNlcyB3aGVuIHRoaXMgd29ya2VyIG93bnMgdGhlbS5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgYWZ0ZXIgZXZlcnkgb3duZWQgY2xvc2Ugc3VjY2VlZHMuXG4gICAqL1xuICBhc3luYyBfY2xvc2VDb25maWd1cmF0aW9uKCkge1xuICAgIGNvbnN0IGNvbmZpZ3VyYXRpb24gPSB0aGlzLmNvbmZpZ3VyYXRpb25cblxuICAgIGlmICghY29uZmlndXJhdGlvbikgcmV0dXJuXG5cbiAgICBhd2FpdCBydW5TaHV0ZG93blN0ZXBzKHtcbiAgICAgIG1lc3NhZ2U6IFwiQmFja2dyb3VuZCBqb2JzIHdvcmtlciBhcHBsaWNhdGlvbiBhbmQgZnJhbWV3b3JrIHNodXRkb3duIGZhaWxlZFwiLFxuICAgICAgc3RlcHM6IFtcbiAgICAgICAgLi4uKHRoaXMuY2xvc2VEYXRhYmFzZUNvbm5lY3Rpb25zT25TdG9wXG4gICAgICAgICAgPyBbYXN5bmMgKCkgPT4gYXdhaXQgY29uZmlndXJhdGlvbi5zaHV0ZG93bigpXVxuICAgICAgICAgIDogW10pLFxuICAgICAgICBhc3luYyAoKSA9PiBhd2FpdCBjb25maWd1cmF0aW9uLmRpc2Nvbm5lY3RCZWFjb24oKSxcbiAgICAgICAgLi4uKHRoaXMuY2xvc2VEYXRhYmFzZUNvbm5lY3Rpb25zT25TdG9wXG4gICAgICAgICAgPyBbYXN5bmMgKCkgPT4gYXdhaXQgY29uZmlndXJhdGlvbi5jbG9zZURhdGFiYXNlQ29ubmVjdGlvbnMoKV1cbiAgICAgICAgICA6IFtdKVxuICAgICAgXVxuICAgIH0pXG4gIH1cblxuICAvKipcbiAgICogV2FpdHMgZm9yIGEgc2V0IG9mIGluLWZsaWdodCBqb2IgcHJvbWlzZXMgdG8gc2V0dGxlLCBvcHRpb25hbGx5IGJvdW5kZWQgYnlcbiAgICogYHRpbWVvdXRNc2AuXG4gICAqIEBwYXJhbSB7U2V0PFByb21pc2U8dm9pZD4+fSBpbmZsaWdodCAtIEluLWZsaWdodCBqb2IgcHJvbWlzZXMuXG4gICAqIEBwYXJhbSB7bnVtYmVyfSBbdGltZW91dE1zXSAtIE1heCB3YWl0IGluIG1zOyB1bmJvdW5kZWQgd2hlbiBvbWl0dGVkLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyB3aGVuIHNldHRsZWQgb3IgdGhlIHRpbWVvdXQgZWxhcHNlcy5cbiAgICovXG4gIGFzeW5jIF9kcmFpbkluZmxpZ2h0KGluZmxpZ2h0LCB0aW1lb3V0TXMpIHtcbiAgICBpZiAoaW5mbGlnaHQuc2l6ZSA9PT0gMCkgcmV0dXJuXG5cbiAgICBjb25zdCBkcmFpbiA9IFByb21pc2UuYWxsU2V0dGxlZChbLi4uaW5mbGlnaHRdKVxuXG4gICAgaWYgKHR5cGVvZiB0aW1lb3V0TXMgPT09IFwibnVtYmVyXCIgJiYgdGltZW91dE1zID49IDApIHtcbiAgICAgIGxldCB0aW1lclxuICAgICAgY29uc3QgdGltZW91dCA9IG5ldyBQcm9taXNlKChyZXNvbHZlKSA9PiB7IHRpbWVyID0gc2V0VGltZW91dChyZXNvbHZlLCB0aW1lb3V0TXMpIH0pXG5cbiAgICAgIGF3YWl0IFByb21pc2UucmFjZShbZHJhaW4sIHRpbWVvdXRdKVxuICAgICAgY2xlYXJUaW1lb3V0KHRpbWVyKVxuICAgIH0gZWxzZSB7XG4gICAgICBhd2FpdCBkcmFpblxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBUZXJtaW5hdGVzIGFueSBwcm9jZXNzIHJ1bm5lciBjaGlsZHJlbiBzdGlsbCBhbGl2ZSBhZnRlciB0aGUgZHJhaW4gd2luZG93IHNvXG4gICAqIHRoZXkgZG9uJ3Qgb3V0bGl2ZSB0aGUgd29ya2VyIGFzIG9ycGhhbnMuIFNJR1RFUk0gbGV0cyB0aGUgcnVubmVyIGNsb3NlIGl0c1xuICAgKiBjb25uZWN0aW9ucyBjbGVhbmx5OyBzdXJ2aXZvcnMgYXJlIFNJR0tJTExlZCBhZnRlciBhIHNob3J0IGdyYWNlLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyBvbmNlIHN1cnZpdm9ycyBoYXZlIGJlZW4gc2lnbmFsbGVkLlxuICAgKi9cbiAgYXN5bmMgX3Rlcm1pbmF0ZVByb2Nlc3NDaGlsZHJlbigpIHtcbiAgICBpZiAodGhpcy5pbmZsaWdodFByb2Nlc3NDaGlsZHJlbi5zaXplID09PSAwKSByZXR1cm5cblxuICAgIGZvciAoY29uc3QgY2hpbGQgb2YgdGhpcy5pbmZsaWdodFByb2Nlc3NDaGlsZHJlbikge1xuICAgICAgY29uc3QgcG9vbGVkU3RhdGUgPSB0aGlzLnBvb2xlZENoaWxkU3RhdGVzLmdldChjaGlsZClcbiAgICAgIGlmIChwb29sZWRTdGF0ZSkge1xuICAgICAgICB0aGlzLl9yZXF1ZXN0UG9vbGVkQ2hpbGRTaHV0ZG93bih7Y2hpbGQsIHJlYXNvbjogXCJ3b3JrZXJfc3RvcFwiLCBzaWduYWw6IFwiU0lHVEVSTVwifSlcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIHRyeSB7XG4gICAgICAgICAgY2hpbGQua2lsbChcIlNJR1RFUk1cIilcbiAgICAgICAgfSBjYXRjaCB7XG4gICAgICAgICAgLy8gQ2hpbGQgYWxyZWFkeSBleGl0ZWQ7IG5vdGhpbmcgdG8gZG8uXG4gICAgICAgIH1cbiAgICAgIH1cbiAgICB9XG5cbiAgICBhd2FpdCBuZXcgUHJvbWlzZSgocmVzb2x2ZSkgPT4gc2V0VGltZW91dChyZXNvbHZlLCB0aGlzLmZvcmtlZENoaWxkU2lna2lsbEdyYWNlTXMpKVxuXG4gICAgZm9yIChjb25zdCBjaGlsZCBvZiB0aGlzLmluZmxpZ2h0UHJvY2Vzc0NoaWxkcmVuKSB7XG4gICAgICB0cnkge1xuICAgICAgICBjaGlsZC5raWxsKFwiU0lHS0lMTFwiKVxuICAgICAgfSBjYXRjaCB7XG4gICAgICAgIC8vIENoaWxkIGFscmVhZHkgZXhpdGVkOyBub3RoaW5nIHRvIGRvLlxuICAgICAgfVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBDb25uZWN0cyB0byB0aGUgd29ya2VyJ3MgcmVzb2x2ZWQgZW5kcG9pbnQgYW5kIGNvbXBsZXRlcyBpdHMgaGVsbG8gZmVuY2UuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gUmVjb25uZWN0IHBvbGljeS5cbiAgICogQHBhcmFtIHtib29sZWFufSBhcmdzLmFsbG93UmVjb25uZWN0IC0gV2hldGhlciBhIGZhaWxlZCBhdHRlbXB0IG1heSBzY2hlZHVsZSBhbm90aGVyIGNvbm5lY3Rpb24uXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIGFmdGVyIGdlbmVyYXRpb24gYWNrbm93bGVkZ2VtZW50LlxuICAgKi9cbiAgYXN5bmMgX2Nvbm5lY3Qoe2FsbG93UmVjb25uZWN0fSkge1xuICAgIGNvbnN0IGNvbmZpZ3VyYXRpb24gPSB0aGlzLmNvbmZpZ3VyYXRpb25cbiAgICBpZiAoIWNvbmZpZ3VyYXRpb24pIHRocm93IG5ldyBFcnJvcihcIkJhY2tncm91bmQgam9icyB3b3JrZXIgY29uZmlndXJhdGlvbiBub3QgaW5pdGlhbGl6ZWRcIilcblxuICAgIGNvbnN0IGNvbmZpZyA9IGNvbmZpZ3VyYXRpb24uZ2V0QmFja2dyb3VuZEpvYnNDb25maWcoKVxuICAgIGlmICh0aGlzLmdlbmVyYXRpb25JZCkgdGhpcy5fZ2VuZXJhdGlvbkFjY2VwdGVkID0gZmFsc2VcbiAgICBjb25zdCBob3N0ID0gdGhpcy5ob3N0IHx8IGNvbmZpZy5ob3N0XG4gICAgY29uc3QgcG9ydCA9IHR5cGVvZiB0aGlzLnBvcnQgPT09IFwibnVtYmVyXCIgPyB0aGlzLnBvcnQgOiBjb25maWcucG9ydFxuICAgIGNvbnN0IHNvY2tldCA9IG5ldC5jcmVhdGVDb25uZWN0aW9uKHtob3N0LCBwb3J0fSlcbiAgICBzb2NrZXQuc2V0S2VlcEFsaXZlKHRydWUsIFNPQ0tFVF9LRUVQQUxJVkVfTVMpXG4gICAgY29uc3QganNvblNvY2tldCA9IG5ldyBKc29uU29ja2V0KHNvY2tldClcbiAgICB0aGlzLmpzb25Tb2NrZXQgPSBqc29uU29ja2V0XG4gICAgLyoqXG4gICAgICogUmVzb2x2ZXMgdGhlIGdlbmVyYXRpb24gaGFuZHNoYWtlLlxuICAgICAqIEB0eXBlIHsoKSA9PiB2b2lkfVxuICAgICAqL1xuICAgIGxldCByZXNvbHZlSGFuZHNoYWtlID0gKCkgPT4ge31cbiAgICAvKipcbiAgICAgKiBSZWplY3RzIHRoZSBnZW5lcmF0aW9uIGhhbmRzaGFrZS5cbiAgICAgKiBAdHlwZSB7KGVycm9yOiBFcnJvcikgPT4gdm9pZH1cbiAgICAgKi9cbiAgICBsZXQgcmVqZWN0SGFuZHNoYWtlID0gKCkgPT4ge31cbiAgICBsZXQgY29ubmVjdGlvbkFjY2VwdGVkID0gZmFsc2VcbiAgICAvKiogQHR5cGUge1JldHVyblR5cGU8dHlwZW9mIHNldFRpbWVvdXQ+IHwgdW5kZWZpbmVkfSAqL1xuICAgIGxldCBoYW5kc2hha2VUaW1lclxuICAgIGNvbnN0IGhhbmRzaGFrZSA9IG5ldyBQcm9taXNlKCgvKiogQHR5cGUgeyh2YWx1ZTogdm9pZCkgPT4gdm9pZH0gKi8gcmVzb2x2ZSwgcmVqZWN0KSA9PiB7XG4gICAgICByZXNvbHZlSGFuZHNoYWtlID0gcmVzb2x2ZVxuICAgICAgcmVqZWN0SGFuZHNoYWtlID0gcmVqZWN0XG4gICAgfSlcblxuICAgIC8qKlxuICAgICAqIEhhbmRsZXMgYSBiYWNrZ3JvdW5kIGpvYiBzb2NrZXQgbWVzc2FnZS5cbiAgICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vdHlwZXMuanNcIikuQmFja2dyb3VuZEpvYlNvY2tldE1lc3NhZ2V9IG1lc3NhZ2UgLSBTb2NrZXQgbWVzc2FnZS5cbiAgICAgKi9cbiAgICBqc29uU29ja2V0Lm9uKFwibWVzc2FnZVwiLCBhc3luYyAobWVzc2FnZSkgPT4ge1xuICAgICAgaWYgKG1lc3NhZ2U/LnR5cGUgPT09IFwiZ2VuZXJhdGlvbi1hY2NlcHRlZFwiKSB7XG4gICAgICAgIGlmICghdGhpcy5nZW5lcmF0aW9uSWQgfHwgbWVzc2FnZS5nZW5lcmF0aW9uSWQgIT09IHRoaXMuZ2VuZXJhdGlvbklkKSB7XG4gICAgICAgICAgcmVqZWN0SGFuZHNoYWtlKG5ldyBFcnJvcihcIkJhY2tncm91bmQgam9icyBtYWluIGFja25vd2xlZGdlZCBhIGRpZmZlcmVudCBnZW5lcmF0aW9uXCIpKVxuICAgICAgICAgIGpzb25Tb2NrZXQuZGVzdHJveSgpXG4gICAgICAgICAgcmV0dXJuXG4gICAgICAgIH1cblxuICAgICAgICB0aGlzLl9nZW5lcmF0aW9uQWNjZXB0ZWQgPSB0cnVlXG4gICAgICAgIGNvbm5lY3Rpb25BY2NlcHRlZCA9IHRydWVcbiAgICAgICAgaWYgKGhhbmRzaGFrZVRpbWVyKSB7XG4gICAgICAgICAgY2xlYXJUaW1lb3V0KGhhbmRzaGFrZVRpbWVyKVxuICAgICAgICAgIGhhbmRzaGFrZVRpbWVyID0gdW5kZWZpbmVkXG4gICAgICAgIH1cbiAgICAgICAgaWYgKG1lc3NhZ2UubGlmZWN5Y2xlU3RhdGUgPT09IFwicmV0aXJpbmdcIiB8fCBtZXNzYWdlLmxpZmVjeWNsZVN0YXRlID09PSBcInJldGlyZWRcIikgdGhpcy5pc1JldGlyaW5nID0gdHJ1ZVxuICAgICAgICB0aGlzLm9uR2VuZXJhdGlvbkFjY2VwdGVkPy4oKVxuICAgICAgICB0aGlzLl9zZW5kUmVhZHlJZlJ1bm5pbmcoKVxuICAgICAgICB0aGlzLl9zdGFydEhlYXJ0YmVhdCgpXG4gICAgICAgIHJlc29sdmVIYW5kc2hha2UoKVxuICAgICAgICByZXR1cm5cbiAgICAgIH1cblxuICAgICAgaWYgKG1lc3NhZ2U/LnR5cGUgPT09IFwiZ2VuZXJhdGlvbi1yZWplY3RlZFwiKSB7XG4gICAgICAgIHRoaXMuc2hvdWxkU3RvcCA9IHRydWVcbiAgICAgICAgaWYgKGhhbmRzaGFrZVRpbWVyKSBjbGVhclRpbWVvdXQoaGFuZHNoYWtlVGltZXIpXG4gICAgICAgIHJlamVjdEhhbmRzaGFrZShuZXcgRXJyb3IoYEJhY2tncm91bmQgam9icyBnZW5lcmF0aW9uIHJlamVjdGVkOiAke21lc3NhZ2UucmVhc29ufWApKVxuICAgICAgICBqc29uU29ja2V0LmRlc3Ryb3koKVxuICAgICAgICByZXR1cm5cbiAgICAgIH1cblxuICAgICAgaWYgKG1lc3NhZ2U/LnR5cGUgPT09IFwicmV0aXJlXCIpIHtcbiAgICAgICAgaWYgKHRoaXMuZ2VuZXJhdGlvbklkICYmIG1lc3NhZ2UuZ2VuZXJhdGlvbklkID09PSB0aGlzLmdlbmVyYXRpb25JZCkge1xuICAgICAgICAgIHRoaXMub25SZXRpcmVNZXNzYWdlPy4oKVxuICAgICAgICAgIHRoaXMuX2JlZ2luR2VuZXJhdGlvblJldGlyZW1lbnQoKVxuICAgICAgICB9XG4gICAgICAgIHJldHVyblxuICAgICAgfVxuXG4gICAgICBpZiAobWVzc2FnZT8udHlwZSA9PT0gXCJqb2JcIikge1xuICAgICAgICBhd2FpdCB0aGlzLl9oYW5kbGVKb2IobWVzc2FnZS5wYXlsb2FkKVxuICAgICAgfVxuICAgIH0pXG5cbiAgICBqc29uU29ja2V0Lm9uKFwiZXJyb3JcIiwgKGVycm9yKSA9PiB7XG4gICAgICBjb25zb2xlLmVycm9yKFwiQmFja2dyb3VuZCBqb2JzIHdvcmtlciBzb2NrZXQgZXJyb3I6XCIsIGVycm9yKVxuICAgICAgaWYgKHRoaXMuZ2VuZXJhdGlvbklkICYmICF0aGlzLl9nZW5lcmF0aW9uQWNjZXB0ZWQpIHJlamVjdEhhbmRzaGFrZShlcnJvcilcbiAgICB9KVxuXG4gICAganNvblNvY2tldC5vbihcImNsb3NlXCIsICgpID0+IHtcbiAgICAgIGlmIChoYW5kc2hha2VUaW1lcikgY2xlYXJUaW1lb3V0KGhhbmRzaGFrZVRpbWVyKVxuICAgICAgdGhpcy5fc3RvcEhlYXJ0YmVhdCgpXG4gICAgICBpZiAodGhpcy5qc29uU29ja2V0ID09PSBqc29uU29ja2V0KSB0aGlzLmpzb25Tb2NrZXQgPSB1bmRlZmluZWRcbiAgICAgIGlmICh0aGlzLmdlbmVyYXRpb25JZCAmJiAhdGhpcy5fZ2VuZXJhdGlvbkFjY2VwdGVkKSB7XG4gICAgICAgIHJlamVjdEhhbmRzaGFrZShuZXcgRXJyb3IoXCJCYWNrZ3JvdW5kIGpvYnMgc29ja2V0IGNsb3NlZCBiZWZvcmUgZ2VuZXJhdGlvbiBhY2tub3dsZWRnZW1lbnRcIikpXG4gICAgICB9XG4gICAgICBpZiAodGhpcy5zaG91bGRTdG9wKSByZXR1cm5cbiAgICAgIGlmIChjb25uZWN0aW9uQWNjZXB0ZWQgfHwgYWxsb3dSZWNvbm5lY3QgfHwgIXRoaXMuZ2VuZXJhdGlvbklkKSB0aGlzLl9zY2hlZHVsZVJlY29ubmVjdCgpXG4gICAgfSlcblxuICAgIGlmICh0aGlzLmdlbmVyYXRpb25JZCkge1xuICAgICAgaGFuZHNoYWtlVGltZXIgPSBzZXRUaW1lb3V0KCgpID0+IHtcbiAgICAgICAgY29uc3QgZXJyb3IgPSBuZXcgQmFja2dyb3VuZEpvYnNHZW5lcmF0aW9uSGFuZHNoYWtlVGltZW91dEVycm9yKHtcbiAgICAgICAgICBlbmRwb2ludDogYCR7aG9zdH06JHtwb3J0fWAsXG4gICAgICAgICAgZ2VuZXJhdGlvbklkOiB0aGlzLmdlbmVyYXRpb25JZCB8fCBcIlwiLFxuICAgICAgICAgIHJvbGU6IFwid29ya2VyXCIsXG4gICAgICAgICAgdGltZW91dE1zOiB0aGlzLmdlbmVyYXRpb25IYW5kc2hha2VUaW1lb3V0TXNcbiAgICAgICAgfSlcbiAgICAgICAgcmVqZWN0SGFuZHNoYWtlKGVycm9yKVxuICAgICAgICBqc29uU29ja2V0LmRlc3Ryb3koKVxuICAgICAgfSwgdGhpcy5nZW5lcmF0aW9uSGFuZHNoYWtlVGltZW91dE1zKVxuICAgIH1cblxuICAgIHNvY2tldC5vbihcImNvbm5lY3RcIiwgKCkgPT4ge1xuICAgICAganNvblNvY2tldC5zZW5kKHt0eXBlOiBcImhlbGxvXCIsIHJvbGU6IFwid29ya2VyXCIsIC4uLih0aGlzLmdlbmVyYXRpb25JZCA/IHtnZW5lcmF0aW9uSWQ6IHRoaXMuZ2VuZXJhdGlvbklkfSA6IHt9KSwgc3VwcG9ydHNIYW5kb2ZmSWRSZXBvcnRpbmc6IHRydWUsIHN1cHBvcnRzSGVhcnRiZWF0OiB0cnVlLCBzdXBwb3J0c1Bvb2xlZDogdHJ1ZSwgd29ya2VySWQ6IHRoaXMud29ya2VySWR9KVxuICAgICAgaWYgKCF0aGlzLmdlbmVyYXRpb25JZCkge1xuICAgICAgICBjb25uZWN0aW9uQWNjZXB0ZWQgPSB0cnVlXG4gICAgICAgIHRoaXMuX3NlbmRSZWFkeUlmUnVubmluZygpXG4gICAgICAgIHRoaXMuX3N0YXJ0SGVhcnRiZWF0KClcbiAgICAgICAgcmVzb2x2ZUhhbmRzaGFrZSgpXG4gICAgICB9XG4gICAgfSlcblxuICAgIGlmICh0aGlzLmdlbmVyYXRpb25JZCkgYXdhaXQgaGFuZHNoYWtlXG4gIH1cblxuICAvKiogU2NoZWR1bGVzIG9uZSBmZW5jZWQgcmVjb25uZWN0IHRvIHRoZSB3b3JrZXIncyB1bmNoYW5nZWQgZW5kcG9pbnQuICovXG4gIF9zY2hlZHVsZVJlY29ubmVjdCgpIHtcbiAgICBpZiAodGhpcy5zaG91bGRTdG9wIHx8IHRoaXMuX3JlY29ubmVjdFRpbWVyKSByZXR1cm5cblxuICAgIHRoaXMuX3JlY29ubmVjdFRpbWVyID0gc2V0VGltZW91dCgoKSA9PiB7XG4gICAgICB0aGlzLl9yZWNvbm5lY3RUaW1lciA9IHVuZGVmaW5lZFxuICAgICAgaWYgKHRoaXMuc2hvdWxkU3RvcCkgcmV0dXJuXG4gICAgICB2b2lkIHRoaXMuX2Nvbm5lY3Qoe2FsbG93UmVjb25uZWN0OiB0cnVlfSkuY2F0Y2goKGVycm9yKSA9PiB7XG4gICAgICAgIGlmICghdGhpcy5zaG91bGRTdG9wKSBjb25zb2xlLmVycm9yKFwiQmFja2dyb3VuZCBqb2JzIHdvcmtlciByZWNvbm5lY3QgZmFpbGVkOlwiLCBlcnJvcilcbiAgICAgIH0pXG4gICAgfSwgdGhpcy5yZWNvbm5lY3REZWxheU1zKVxuICAgIGlmICh0eXBlb2YgdGhpcy5fcmVjb25uZWN0VGltZXIudW5yZWYgPT09IFwiZnVuY3Rpb25cIikgdGhpcy5fcmVjb25uZWN0VGltZXIudW5yZWYoKVxuICB9XG5cbiAgLyoqXG4gICAqIFN1cmZhY2VzIGFuIHVuZXhwZWN0ZWQgd29ya2VyIGxpZmVjeWNsZSBmYWlsdXJlIHRocm91Z2ggdGhlIGZyYW1ld29yayBlcnJvclxuICAgKiBjaGFubmVscyBzbyBhIHN1cGVydmlzb3IgaG9vayB0aGF0IGlnbm9yZXMgc3RkaW8gc3RpbGwgaGFzIG9ic2VydmFiaWxpdHkuXG4gICAqIEBwYXJhbSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59IGVycm9yIC0gV29ya2VyIGxpZmVjeWNsZSBmYWlsdXJlLlxuICAgKi9cbiAgX3JlcG9ydExpZmVjeWNsZUVycm9yKGVycm9yKSB7XG4gICAgY29uc3QgY29uZmlndXJhdGlvbiA9IHRoaXMuY29uZmlndXJhdGlvblxuICAgIGlmICghY29uZmlndXJhdGlvbikgcmV0dXJuXG4gICAgY29uc3Qgbm9ybWFsaXplZEVycm9yID0gZXJyb3IgaW5zdGFuY2VvZiBFcnJvciA/IGVycm9yIDogbmV3IEVycm9yKFN0cmluZyhlcnJvcikpXG4gICAgY29uc3QgcGF5bG9hZCA9IHtjb250ZXh0OiB7Z2VuZXJhdGlvbklkOiB0aGlzLmdlbmVyYXRpb25JZCwgc3RhZ2U6IFwiYmFja2dyb3VuZC1qb2JzLXdvcmtlci1saWZlY3ljbGVcIn0sIGVycm9yOiBub3JtYWxpemVkRXJyb3J9XG4gICAgY29uc3QgZXJyb3JFdmVudHMgPSBjb25maWd1cmF0aW9uLmdldEVycm9yRXZlbnRzKClcblxuICAgIGVycm9yRXZlbnRzLmVtaXQoXCJmcmFtZXdvcmstZXJyb3JcIiwgcGF5bG9hZClcbiAgICBlcnJvckV2ZW50cy5lbWl0KFwiYWxsLWVycm9yXCIsIHsuLi5wYXlsb2FkLCBlcnJvclR5cGU6IFwiZnJhbWV3b3JrLWVycm9yXCJ9KVxuICB9XG5cbiAgLyoqXG4gICAqIFNlbmRzIHBlcmlvZGljIGxpdmVuZXNzIGhlYXJ0YmVhdHMgdG8gdGhlIG1haW4gc28gYSB3ZWRnZWQgb3Igc2lsZW50IHdvcmtlclxuICAgKiBjYW4gYmUgZGV0ZWN0ZWQgYW5kIGRyb3BwZWQgdGhlcmUgKGl0cyBsZWFzZXMgcmVsZWFzZWQpIGluc3RlYWQgb2YgZnJlZXppbmdcbiAgICogdGhlIHF1ZXVlIHVudGlsIGEgaHVtYW4gbm90aWNlcy5cbiAgICogQHJldHVybnMge3ZvaWR9XG4gICAqL1xuICBfc3RhcnRIZWFydGJlYXQoKSB7XG4gICAgdGhpcy5fc3RvcEhlYXJ0YmVhdCgpXG5cbiAgICB0aGlzLl9oZWFydGJlYXRUaW1lciA9IHNldEludGVydmFsKCgpID0+IHRoaXMuX3NlbmRIZWFydGJlYXQoKSwgdGhpcy5oZWFydGJlYXRJbnRlcnZhbE1zKVxuXG4gICAgaWYgKHR5cGVvZiB0aGlzLl9oZWFydGJlYXRUaW1lci51bnJlZiA9PT0gXCJmdW5jdGlvblwiKSB0aGlzLl9oZWFydGJlYXRUaW1lci51bnJlZigpXG4gIH1cblxuICAvKiogU2VuZHMgb25lIGxpdmVuZXNzIGhlYXJ0YmVhdCB3aGlsZSB0aGUgd29ya2VyIGhhcyBub3QgZmluYWxseSBzdG9wcGVkLiAqL1xuICBfc2VuZEhlYXJ0YmVhdCgpIHtcbiAgICBpZiAodGhpcy5zaG91bGRTdG9wIHx8ICF0aGlzLmpzb25Tb2NrZXQpIHJldHVyblxuXG4gICAgdHJ5IHtcbiAgICAgIHRoaXMuanNvblNvY2tldC5zZW5kKHt0eXBlOiBcImhlYXJ0YmVhdFwiLCB3b3JrZXJJZDogdGhpcy53b3JrZXJJZH0pXG4gICAgfSBjYXRjaCB7XG4gICAgICAvLyBTb2NrZXQgaXMgY2xvc2luZy9jbG9zZWQ7IHRoZSBjbG9zZSBoYW5kbGVyIGRyaXZlcyByZWNvbm5lY3QuXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIFN0b3BzIHRoZSBsaXZlbmVzcyBoZWFydGJlYXQgdGltZXIuXG4gICAqIEByZXR1cm5zIHt2b2lkfVxuICAgKi9cbiAgX3N0b3BIZWFydGJlYXQoKSB7XG4gICAgaWYgKHRoaXMuX2hlYXJ0YmVhdFRpbWVyKSB7XG4gICAgICBjbGVhckludGVydmFsKHRoaXMuX2hlYXJ0YmVhdFRpbWVyKVxuICAgICAgdGhpcy5faGVhcnRiZWF0VGltZXIgPSB1bmRlZmluZWRcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogUnVucyBoYW5kbGUgam9iLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vdHlwZXMuanNcIikuQmFja2dyb3VuZEpvYlBheWxvYWR9IHBheWxvYWQgLSBQYXlsb2FkLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyB3aGVuIGRvbmUuXG4gICAqL1xuICBhc3luYyBfaGFuZGxlSm9iKHBheWxvYWQpIHtcbiAgICBpZiAoIXBheWxvYWQuaWQpIHRocm93IG5ldyBFcnJvcihcIkJhY2tncm91bmQgam9iIHBheWxvYWQgbWlzc2luZyBpZFwiKVxuICAgIC8qKlxuICAgICAqIElkZW50aWZpZWQgcGF5bG9hZC5cbiAgICAgKiBAdHlwZSB7aW1wb3J0KFwiLi90eXBlcy5qc1wiKS5CYWNrZ3JvdW5kSm9iUGF5bG9hZCAmIHtpZDogc3RyaW5nfX0gKi9cbiAgICBjb25zdCBpZGVudGlmaWVkUGF5bG9hZCA9IC8qKiBAdHlwZSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59ICovIChwYXlsb2FkKVxuXG4gICAgY29uc3QgZXhlY3V0aW9uTW9kZSA9IHRoaXMuX2V4ZWN1dGlvbk1vZGVGb3JQYXlsb2FkKGlkZW50aWZpZWRQYXlsb2FkKVxuXG4gICAgaWYgKGV4ZWN1dGlvbk1vZGUgPT09IFwicG9vbGVkXCIpIHtcbiAgICAgIHRoaXMuX3F1ZXVlUG9vbGVkSm9iKGlkZW50aWZpZWRQYXlsb2FkKVxuICAgICAgcmV0dXJuXG4gICAgfVxuXG4gICAgaWYgKGV4ZWN1dGlvbk1vZGUgIT09IFwiaW5saW5lXCIpIHtcbiAgICAgIHRoaXMuX3RyYWNrUHJvY2Vzc0pvYih0aGlzLl9zdGFydFByb2Nlc3NKb2Ioe2V4ZWN1dGlvbk1vZGUsIHBheWxvYWQ6IGlkZW50aWZpZWRQYXlsb2FkfSkpXG4gICAgICByZXR1cm5cbiAgICB9XG5cbiAgICB0aGlzLl9oYW5kbGVJbmxpbmVKb2IoaWRlbnRpZmllZFBheWxvYWQpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBzdGFydCBwcm9jZXNzIGpvYi5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBPcHRpb25zLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vdHlwZXMuanNcIikuQmFja2dyb3VuZEpvYkV4ZWN1dGlvbk1vZGV9IGFyZ3MuZXhlY3V0aW9uTW9kZSAtIEV4ZWN1dGlvbiBtb2RlLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vdHlwZXMuanNcIikuQmFja2dyb3VuZEpvYlBheWxvYWQgJiB7aWQ6IHN0cmluZ319IGFyZ3MucGF5bG9hZCAtIFBheWxvYWQuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIHdoZW4gdGhlIHByb2Nlc3Mgam9iIGV4aXRzLlxuICAgKi9cbiAgX3N0YXJ0UHJvY2Vzc0pvYih7ZXhlY3V0aW9uTW9kZSwgcGF5bG9hZH0pIHtcbiAgICBpZiAoZXhlY3V0aW9uTW9kZSA9PT0gXCJmb3JrZWRcIikgcmV0dXJuIHRoaXMuX2ZvcmtKb2IocGF5bG9hZClcblxuICAgIHJldHVybiB0aGlzLl9zcGF3bkpvYihwYXlsb2FkKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgaGFuZGxlIGlubGluZSBqb2IuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi90eXBlcy5qc1wiKS5CYWNrZ3JvdW5kSm9iUGF5bG9hZCAmIHtpZDogc3RyaW5nfX0gcGF5bG9hZCAtIFBheWxvYWQuXG4gICAqIEByZXR1cm5zIHt2b2lkfVxuICAgKi9cbiAgX2hhbmRsZUlubGluZUpvYihwYXlsb2FkKSB7XG4gICAgLy8gSW5saW5lIGpvYnMgc2hhcmUgdGhlIHdvcmtlcidzIHByb2Nlc3MgYW5kIERCIHBvb2wsIGJ1dCBlYWNoIG9uZVxuICAgIC8vIGlzIGl0cyBvd24gYXN5bmMgY2hhaW4g4oCUIHRoZXJlJ3Mgbm8gc2VtYW50aWMgcmVhc29uIHRvIHNlcmlhbGl6ZVxuICAgIC8vIHRoZW0uIFdlIGtpY2sgb2ZmIHRoZSBqb2IsIHJlZ2lzdGVyIGl0IHdpdGggYGluZmxpZ2h0SW5saW5lSm9ic2BcbiAgICAvLyBmb3Igc2h1dGRvd24gZHJhaW4sIGFuZCBzaWduYWwgY2FwYWNpdHkgdG8gbWFpbjpcbiAgICAvLyAtIElmIHdlIHN0aWxsIGhhdmUgYSBmcmVlIHNsb3Qgd2UgYXNrIGZvciB0aGUgbmV4dCBqb2IgcmlnaHRcbiAgICAvLyAgIGF3YXksIHNvIGEgc2xvdyBqb2IgKGUuZy4gYSBkb2NrZXIgYWxpdmUgY2hlY2sgdGhhdCB3YWl0cyAxNXNcbiAgICAvLyAgIG9uIGEgZ29uZSBzZXJ2ZXIpIG5vIGxvbmdlciBzdGFydmVzIGV2ZXJ5IG90aGVyIGlubGluZSBqb2IuXG4gICAgLy8gLSBXaGVuIHRoZSBqb2IgZmluaXNoZXMsIGlmIHRoZSB3b3JrZXIgaGFkIGJlZW4gYXQgdGhlIGNhcCwgd2VcbiAgICAvLyAgIGFzayBmb3IgdGhlIG5leHQgam9iIHRvIHJlZmlsbCB0aGUgc2xvdC5cbiAgICAvLyBUaGUgYm9va2tlZXBpbmcgaW4gYGZpbmFsbHkoKWAgcmF0Y2hldHMgY2FwYWNpdHkgYmFjayB1cFxuICAgIC8vIHJlZ2FyZGxlc3Mgb2Ygc3VjY2VzcyBvciBmYWlsdXJlLlxuICAgIC8qKlxuICAgICAqIERlZmluZXMgaW5mbGlnaHQuXG4gICAgICogQHR5cGUge1Byb21pc2U8dm9pZD59ICovXG4gICAgbGV0IGluZmxpZ2h0XG5cbiAgICBpbmZsaWdodCA9IHRoaXMuX3J1bklubGluZUpvYkFuZFJlcG9ydChwYXlsb2FkKS5maW5hbGx5KCgpID0+IHtcbiAgICAgIHRoaXMuaW5mbGlnaHRJbmxpbmVKb2JzLmRlbGV0ZShpbmZsaWdodClcblxuICAgICAgLy8gUmUtYW5ub3VuY2Ugb24gZXZlcnkgY29tcGxldGlvbiBiZWxvdyBjYXAsIG5vdCBqdXN0IHRoZSBjYXDihpJjYXAtMSBlZGdlIOKAlFxuICAgICAgLy8gc2VlIF90cmFja1Byb2Nlc3NKb2IgZm9yIHdoeSB0aGUga25pZmUtZWRnZSBjb25kaXRpb24gc2lsZW50bHkgd2VkZ2VzLlxuICAgICAgaWYgKCF0aGlzLnNob3VsZFN0b3ApIHRoaXMuX3NlbmRSZWFkeUlmUnVubmluZygpXG4gICAgfSlcblxuICAgIHRoaXMuaW5mbGlnaHRJbmxpbmVKb2JzLmFkZChpbmZsaWdodClcblxuICAgIGlmICh0aGlzLmluZmxpZ2h0SW5saW5lSm9icy5zaXplIDwgdGhpcy5tYXhDb25jdXJyZW50SW5saW5lSm9icykge1xuICAgICAgdGhpcy5fc2VuZFJlYWR5SWZSdW5uaW5nKClcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogUnVucyBleGVjdXRpb24gbW9kZSBmb3IgcGF5bG9hZC5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL3R5cGVzLmpzXCIpLkJhY2tncm91bmRKb2JQYXlsb2FkfSBwYXlsb2FkIC0gUGF5bG9hZC5cbiAgICogQHJldHVybnMge2ltcG9ydChcIi4vdHlwZXMuanNcIikuQmFja2dyb3VuZEpvYkV4ZWN1dGlvbk1vZGV9IC0gRXhlY3V0aW9uIG1vZGUuXG4gICAqL1xuICBfZXhlY3V0aW9uTW9kZUZvclBheWxvYWQocGF5bG9hZCkge1xuICAgIGNvbnN0IGV4ZWN1dGlvbk1vZGUgPSBwYXlsb2FkLm9wdGlvbnM/LmV4ZWN1dGlvbk1vZGVcblxuICAgIHJldHVybiBleGVjdXRpb25Nb2RlID8gdGhpcy5fbm9ybWFsaXplRXhlY3V0aW9uTW9kZShleGVjdXRpb25Nb2RlKSA6IFwicG9vbGVkXCJcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIG5vcm1hbGl6ZSBleGVjdXRpb24gbW9kZS5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGV4ZWN1dGlvbk1vZGUgLSBFeGVjdXRpb24gbW9kZS5cbiAgICogQHJldHVybnMge2ltcG9ydChcIi4vdHlwZXMuanNcIikuQmFja2dyb3VuZEpvYkV4ZWN1dGlvbk1vZGV9IC0gTm9ybWFsaXplZCBleGVjdXRpb24gbW9kZS5cbiAgICovXG4gIF9ub3JtYWxpemVFeGVjdXRpb25Nb2RlKGV4ZWN1dGlvbk1vZGUpIHtcbiAgICBmb3IgKGNvbnN0IG1vZGUgb2YgRVhFQ1VUSU9OX01PREVTKSB7XG4gICAgICBpZiAobW9kZSA9PT0gZXhlY3V0aW9uTW9kZSkgcmV0dXJuIG1vZGVcbiAgICB9XG5cbiAgICB0aHJvdyBuZXcgRXJyb3IoYEludmFsaWQgYmFja2dyb3VuZCBqb2IgZXhlY3V0aW9uTW9kZTogJHtleGVjdXRpb25Nb2RlfWApXG4gIH1cblxuICAvKipcbiAgICogUnVucyB0cmFjayBwcm9jZXNzIGpvYi5cbiAgICogQHBhcmFtIHtQcm9taXNlPHZvaWQ+fSBwcm9jZXNzSm9iIC0gUHJvY2VzcyBqb2IgcHJvbWlzZS5cbiAgICogQHJldHVybnMge3ZvaWR9XG4gICAqL1xuICBfdHJhY2tQcm9jZXNzSm9iKHByb2Nlc3NKb2IpIHtcbiAgICAvKipcbiAgICAgKiBEZWZpbmVzIGluZmxpZ2h0LlxuICAgICAqIEB0eXBlIHtQcm9taXNlPHZvaWQ+fSAqL1xuICAgIGxldCBpbmZsaWdodFxuXG4gICAgaW5mbGlnaHQgPSBwcm9jZXNzSm9iLmZpbmFsbHkoKCkgPT4ge1xuICAgICAgdGhpcy5pbmZsaWdodFByb2Nlc3NKb2JzLmRlbGV0ZShpbmZsaWdodClcblxuICAgICAgLy8gUmUtYW5ub3VuY2UgcmVhZGluZXNzIG9uIEVWRVJZIGNvbXBsZXRpb24gdGhhdCBsZWF2ZXMgdXMgYmVsb3cgY2FwIOKAlCBub3RcbiAgICAgIC8vIGp1c3QgdGhlIHNpbmdsZSBjYXDihpJjYXAtMSBlZGdlLiBUaGUgbWFpbiByZW1vdmVzIGEgd29ya2VyIGZyb20gaXRzIHJlYWR5XG4gICAgICAvLyBzZXQgb24gZWFjaCBkaXNwYXRjaCAoYF9kcmFpbk9uY2VgKSBhbmQgb25seSByZS1hZGRzIGl0IG9uIGEgZnJlc2hcbiAgICAgIC8vIFwicmVhZHlcIjsgZ2F0aW5nIHRoZSByZS1hbm5vdW5jZSBvbiBvbmUga25pZmUtZWRnZSB0cmFuc2l0aW9uIG1lYW5zIGFcbiAgICAgIC8vIHNpbmdsZSBtaXNzZWQgb3IgbG9zdCBzaWduYWwgbGVhdmVzIHRoZSB3b3JrZXIgb3V0IG9mIHRoZSByZWFkeSBzZXQgYW5kXG4gICAgICAvLyB3ZWRnZXMgZGlzcGF0Y2ggY2x1c3Rlci13aWRlLiBUaGlzIHdhcyB0aGUgc2lsZW50LWZyZWV6ZSByb290IGNhdXNlLlxuICAgICAgLy8gYF9zZW5kUmVhZHlJZlJ1bm5pbmdgIHNlbGYtZ3VhcmRzIChpdCBzZW5kcyBub3RoaW5nIHdoZW4gdGhlIHdvcmtlciBpc1xuICAgICAgLy8gZ2VudWluZWx5IGF0IGNhcGFjaXR5KSwgc28gcmUtYW5ub3VuY2luZyBvbiBldmVyeSBmcmVlZCBzbG90IGlzIHNhZmUgYW5kXG4gICAgICAvLyBpZGVtcG90ZW50IG9uIHRoZSBtYWluLlxuICAgICAgaWYgKCF0aGlzLnNob3VsZFN0b3ApIHRoaXMuX3NlbmRSZWFkeUlmUnVubmluZygpXG4gICAgfSlcblxuICAgIHRoaXMuaW5mbGlnaHRQcm9jZXNzSm9icy5hZGQoaW5mbGlnaHQpXG4gICAgdGhpcy5fc2VuZFJlYWR5SWZSdW5uaW5nKClcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHJ1biBpbmxpbmUgam9iIGFuZCByZXBvcnQuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi90eXBlcy5qc1wiKS5CYWNrZ3JvdW5kSm9iUGF5bG9hZCAmIHtpZDogc3RyaW5nfX0gcGF5bG9hZCAtIFBheWxvYWQgd2l0aCByZXF1aXJlZCBpZC5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgd2hlbiBjb21wbGV0ZSAoc3VjY2VzcyBvciBmYWlsdXJlIHJlcG9ydGVkKS5cbiAgICovXG4gIGFzeW5jIF9ydW5JbmxpbmVKb2JBbmRSZXBvcnQocGF5bG9hZCkge1xuICAgIC8vIFJlcG9ydCBpbiB0aGUgYmFja2dyb3VuZCBzbyBmcmVlaW5nIHRoaXMgaW5saW5lIHNsb3QgbmV2ZXIgd2FpdHMgb24gdGhlXG4gICAgLy8gcmVwb3J0LiBSZXBvcnRpbmcgaXMgZHVyYWJsZSAocmV0cmllZCB1bnRpbCBpdCBsYW5kcyksIHNvIGEgdHJhbnNpZW50XG4gICAgLy8gbWFpbi9EQiBvdXRhZ2UgbmVpdGhlciB3ZWRnZXMgdGhlIHNsb3Qgbm9yIGxvc2VzIHRoZSB0ZXJtaW5hbCByZXN1bHQuXG4gICAgdHJ5IHtcbiAgICAgIGF3YWl0IHRoaXMuX3J1bkpvYklubGluZShwYXlsb2FkKVxuICAgICAgdGhpcy5fcmVwb3J0Sm9iUmVzdWx0SW5CYWNrZ3JvdW5kKHtcbiAgICAgICAgam9iSWQ6IHBheWxvYWQuaWQsXG4gICAgICAgIHN0YXR1czogXCJjb21wbGV0ZWRcIixcbiAgICAgICAgaGFuZG9mZklkOiBwYXlsb2FkLmhhbmRvZmZJZCxcbiAgICAgICAgaGFuZGVkT2ZmQXRNczogcGF5bG9hZC5oYW5kZWRPZmZBdE1zLFxuICAgICAgICB3b3JrZXJJZDogcGF5bG9hZC53b3JrZXJJZCB8fCB0aGlzLndvcmtlcklkXG4gICAgICB9KVxuICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICBpZiAoZXJyb3IgaW5zdGFuY2VvZiBCYWNrZ3JvdW5kSm9iUmVzY2hlZHVsZVNpZ25hbCkge1xuICAgICAgICB0aGlzLl9yZXBvcnRKb2JSZXN1bHRJbkJhY2tncm91bmQoe1xuICAgICAgICAgIGpvYklkOiBwYXlsb2FkLmlkLFxuICAgICAgICAgIHN0YXR1czogXCJyZXNjaGVkdWxlZFwiLFxuICAgICAgICAgIGRlbGF5TXM6IGVycm9yLmRlbGF5TXMsXG4gICAgICAgICAgaGFuZG9mZklkOiBwYXlsb2FkLmhhbmRvZmZJZCxcbiAgICAgICAgICBoYW5kZWRPZmZBdE1zOiBwYXlsb2FkLmhhbmRlZE9mZkF0TXMsXG4gICAgICAgICAgd29ya2VySWQ6IHBheWxvYWQud29ya2VySWQgfHwgdGhpcy53b3JrZXJJZFxuICAgICAgICB9KVxuICAgICAgICByZXR1cm5cbiAgICAgIH1cblxuICAgICAgdGhpcy5fcmVwb3J0Sm9iUmVzdWx0SW5CYWNrZ3JvdW5kKHtcbiAgICAgICAgam9iSWQ6IHBheWxvYWQuaWQsXG4gICAgICAgIHN0YXR1czogXCJmYWlsZWRcIixcbiAgICAgICAgZXJyb3IsXG4gICAgICAgIGhhbmRvZmZJZDogcGF5bG9hZC5oYW5kb2ZmSWQsXG4gICAgICAgIGhhbmRlZE9mZkF0TXM6IHBheWxvYWQuaGFuZGVkT2ZmQXRNcyxcbiAgICAgICAgd29ya2VySWQ6IHBheWxvYWQud29ya2VySWQgfHwgdGhpcy53b3JrZXJJZFxuICAgICAgfSlcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogQWR2ZXJ0aXNlcyBjdXJyZW50IHdvcmtlciBjYXBhY2l0eSB1bmxlc3MgdGhlIHdvcmtlciBpcyBkcmFpbmluZy5cbiAgICogQHBhcmFtIHtvYmplY3R9IFtvcHRpb25zXSAtIEFkdmVydGlzZW1lbnQgb3B0aW9ucy5cbiAgICogQHBhcmFtIHtib29sZWFufSBbb3B0aW9ucy5yZXZva2VQb29sZWRBZG1pc3Npb25dIC0gUmV2b2tlIHBvb2xlZCBjcmVkaXRzIHdoaWxlIHByZXNlcnZpbmcgb3RoZXIgZXhlY3V0aW9uIG1vZGVzLlxuICAgKiBAcmV0dXJucyB7dm9pZH1cbiAgICovXG4gIF9zZW5kUmVhZHlJZlJ1bm5pbmcoe3Jldm9rZVBvb2xlZEFkbWlzc2lvbiA9IGZhbHNlfSA9IHt9KSB7XG4gICAgaWYgKHRoaXMuc2hvdWxkU3RvcCB8fCB0aGlzLmlzUmV0aXJpbmcpIHJldHVyblxuICAgIGlmICghdGhpcy5qc29uU29ja2V0KSByZXR1cm5cbiAgICBpZiAodGhpcy5nZW5lcmF0aW9uSWQgJiYgIXRoaXMuX2dlbmVyYXRpb25BY2NlcHRlZCkgcmV0dXJuXG5cbiAgICBjb25zdCByZWFkeU1lc3NhZ2UgPSB0aGlzLl9yZWFkeU1lc3NhZ2Uoe3Jldm9rZVBvb2xlZEFkbWlzc2lvbn0pXG5cbiAgICBpZiAoIXJlYWR5TWVzc2FnZSkgcmV0dXJuXG4gICAgdGhpcy5qc29uU29ja2V0LnNlbmQocmVhZHlNZXNzYWdlKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgcmVhZHkgbWVzc2FnZS5cbiAgICogQHBhcmFtIHtvYmplY3R9IFtvcHRpb25zXSAtIEFkdmVydGlzZW1lbnQgb3B0aW9ucy5cbiAgICogQHBhcmFtIHtib29sZWFufSBbb3B0aW9ucy5yZXZva2VQb29sZWRBZG1pc3Npb25dIC0gUmV2b2tlIHBvb2xlZCBjcmVkaXRzIHdoaWxlIHByZXNlcnZpbmcgb3RoZXIgZXhlY3V0aW9uIG1vZGVzLlxuICAgKiBAcmV0dXJucyB7aW1wb3J0KFwiLi90eXBlcy5qc1wiKS5CYWNrZ3JvdW5kSm9iU29ja2V0TWVzc2FnZSB8IG51bGx9IC0gUmVhZHkgbWVzc2FnZSBvciBudWxsIHdoZW4gdGhlIHdvcmtlciBoYXMgbm8gY2FwYWNpdHkuXG4gICAqL1xuICBfcmVhZHlNZXNzYWdlKHtyZXZva2VQb29sZWRBZG1pc3Npb24gPSBmYWxzZX0gPSB7fSkge1xuICAgIGNvbnN0IGFjY2VwdHNQcm9jZXNzSm9iID0gdGhpcy5pbmZsaWdodFByb2Nlc3NKb2JzLnNpemUgPCB0aGlzLm1heENvbmN1cnJlbnRGb3JrZWRKb2JzXG4gICAgY29uc3QgYWNjZXB0c0lubGluZSA9IHRoaXMuaW5mbGlnaHRJbmxpbmVKb2JzLnNpemUgPCB0aGlzLm1heENvbmN1cnJlbnRJbmxpbmVKb2JzXG4gICAgY29uc3QgYXZhaWxhYmxlUG9vbGVkU2xvdHMgPSByZXZva2VQb29sZWRBZG1pc3Npb24gPyAwIDogdGhpcy5fYXZhaWxhYmxlUG9vbGVkU2xvdHMoKVxuICAgIGNvbnN0IGFjY2VwdHNQb29sZWQgPSBhdmFpbGFibGVQb29sZWRTbG90cyA+IDBcblxuICAgIGlmICghcmV2b2tlUG9vbGVkQWRtaXNzaW9uICYmICFhY2NlcHRzUHJvY2Vzc0pvYiAmJiAhYWNjZXB0c0lubGluZSAmJiAhYWNjZXB0c1Bvb2xlZCkgcmV0dXJuIG51bGxcblxuICAgIHJldHVybiB7XG4gICAgICB0eXBlOiBcInJlYWR5XCIsXG4gICAgICBhY2NlcHRzRm9ya2VkOiBhY2NlcHRzUHJvY2Vzc0pvYixcbiAgICAgIGFjY2VwdHNJbmxpbmUsXG4gICAgICBhY2NlcHRzUG9vbGVkLFxuICAgICAgYXZhaWxhYmxlUG9vbGVkU2xvdHMsXG4gICAgICBhY2NlcHRzU3Bhd25lZDogYWNjZXB0c1Byb2Nlc3NKb2JcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogVHJhY2tzIGEgcG9vbGVkIGpvYiBhbmQgcmUtYWR2ZXJ0aXNlcyBjYXBhY2l0eS5cbiAgICogQHBhcmFtIHtQcm9taXNlPHZvaWQ+fSBwb29sZWRKb2IgLSBQb29sZWQgam9iIHByb21pc2UuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFRoZSB0cmFja2VkIGluLWZsaWdodCBwcm9taXNlLlxuICAgKi9cbiAgX3RyYWNrUG9vbGVkSm9iKHBvb2xlZEpvYikge1xuICAgIC8qKiBAdHlwZSB7UHJvbWlzZTx2b2lkPn0gKi9cbiAgICBsZXQgaW5mbGlnaHRcbiAgICBpbmZsaWdodCA9IHBvb2xlZEpvYi5maW5hbGx5KCgpID0+IHtcbiAgICAgIHRoaXMuaW5mbGlnaHRQb29sZWRKb2JzLmRlbGV0ZShpbmZsaWdodClcbiAgICAgIGlmICghdGhpcy5zaG91bGRTdG9wICYmICF0aGlzLl9wb29sZWRTdGFydHVwRmFpbHVyZUpvYnMuaGFzKHBvb2xlZEpvYikgJiYgIXRoaXMuX3Bvb2xlZFN0YXJ0dXBGYWlsdXJlSm9icy5oYXMoaW5mbGlnaHQpKSB0aGlzLl9zZW5kUmVhZHlJZlJ1bm5pbmcoKVxuICAgIH0pXG4gICAgdGhpcy5pbmZsaWdodFBvb2xlZEpvYnMuYWRkKGluZmxpZ2h0KVxuICAgIHJldHVybiBpbmZsaWdodFxuICB9XG5cbiAgLyoqXG4gICAqIFNlcmlhbGl6ZXMgcmVwZWF0ZWQgbGVhc2VzIGZvciBvbmUgZHVyYWJsZSByb3cgd2hpbGUgcHJlc2VydmluZyBwb29sZWRcbiAgICogY29uY3VycmVuY3kgYWNyb3NzIGRpZmZlcmVudCBqb2IgaWRzLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vdHlwZXMuanNcIikuQmFja2dyb3VuZEpvYlBheWxvYWQgJiB7aWQ6IHN0cmluZ319IHBheWxvYWQgLSBQb29sZWQgam9iIHBheWxvYWQuXG4gICAqIEByZXR1cm5zIHt2b2lkfVxuICAgKi9cbiAgX3F1ZXVlUG9vbGVkSm9iKHBheWxvYWQpIHtcbiAgICBjb25zdCBxdWV1ZSA9IHRoaXMucG9vbGVkSm9iUXVldWVzLmdldChwYXlsb2FkLmlkKVxuICAgIGlmIChxdWV1ZSkge1xuICAgICAgcXVldWUucHVzaChwYXlsb2FkKVxuICAgICAgcmV0dXJuXG4gICAgfVxuXG4gICAgdGhpcy5wb29sZWRKb2JRdWV1ZXMuc2V0KHBheWxvYWQuaWQsIFtwYXlsb2FkXSlcbiAgICBjb25zdCB0cmFja2VyID0gdGhpcy5fdHJhY2tQb29sZWRKb2IodGhpcy5fcnVuUG9vbGVkSm9iUXVldWUocGF5bG9hZC5pZCkpXG4gICAgdGhpcy5wb29sZWRKb2JRdWV1ZVRyYWNrZXJzLnNldChwYXlsb2FkLmlkLCB0cmFja2VyKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgYWRtaXR0ZWQgbGVhc2VzIGZvciBvbmUgZHVyYWJsZSBqb2IgaWQgaW4gYXJyaXZhbCBvcmRlci5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGpvYklkIC0gRHVyYWJsZSBqb2IgaWQuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIGFmdGVyIHRoZSBwZXItaWQgcXVldWUgZHJhaW5zLlxuICAgKi9cbiAgYXN5bmMgX3J1blBvb2xlZEpvYlF1ZXVlKGpvYklkKSB7XG4gICAgY29uc3QgcXVldWUgPSB0aGlzLnBvb2xlZEpvYlF1ZXVlcy5nZXQoam9iSWQpXG4gICAgaWYgKCFxdWV1ZSkgdGhyb3cgbmV3IEVycm9yKGBQb29sZWQgam9iIHF1ZXVlIG1pc3NpbmcgZm9yIGpvYjogJHtqb2JJZH1gKVxuXG4gICAgdHJ5IHtcbiAgICAgIHdoaWxlIChxdWV1ZS5sZW5ndGggPiAwKSB7XG4gICAgICAgIGNvbnN0IHBheWxvYWQgPSBxdWV1ZS5zaGlmdCgpXG4gICAgICAgIGlmICghcGF5bG9hZCkgdGhyb3cgbmV3IEVycm9yKGBQb29sZWQgam9iIHF1ZXVlIGNvbnRhaW5lZCBhbiBlbXB0eSBwYXlsb2FkIGZvciBqb2I6ICR7am9iSWR9YClcbiAgICAgICAgYXdhaXQgdGhpcy5fcnVuUG9vbGVkSm9iKHBheWxvYWQpXG4gICAgICB9XG4gICAgfSBmaW5hbGx5IHtcbiAgICAgIGNvbnN0IHRyYWNrZXIgPSB0aGlzLnBvb2xlZEpvYlF1ZXVlVHJhY2tlcnMuZ2V0KGpvYklkKVxuICAgICAgaWYgKHRyYWNrZXIpIHtcbiAgICAgICAgdGhpcy5pbmZsaWdodFBvb2xlZEpvYnMuZGVsZXRlKHRyYWNrZXIpXG4gICAgICAgIHRoaXMucG9vbGVkSm9iUXVldWVUcmFja2Vycy5kZWxldGUoam9iSWQpXG4gICAgICB9XG4gICAgICB0aGlzLnBvb2xlZEpvYlF1ZXVlcy5kZWxldGUoam9iSWQpXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIEhhcmQgY2FwIG9uIHRvdGFsIGxpdmUgcG9vbGVkIGNoaWxkcmVuICh3b3JraW5nICsgZHJhaW5pbmcpOiBjaGlsZHJlbiB0aGVcbiAgICogcG9vbCBtYXkgc3RpbGwgc3Bhd24uIENvdW50aW5nIHRoZSB3aG9sZSBsaXZlIHNldCDigJQgZHJhaW5pbmcgY2hpbGRyZW5cbiAgICogaW5jbHVkZWQg4oCUIGlzIHdoYXQgYm91bmRzIHBvb2wgbWVtb3J5OiBhIGRyYWluaW5nIGNoaWxkIHN0aWxsIGhvbGRzIGl0c1xuICAgKiBSU1MgdW50aWwgaXRzIGxhc3QgaW4tZmxpZ2h0IGpvYiBmaW5pc2hlcywgc28gaXQgbXVzdCBvY2N1cHkgYSBjYXAgc2xvdC5cbiAgICogQHJldHVybnMge251bWJlcn0gLSBOdW1iZXIgb2YgY2hpbGRyZW4gdGhlIHBvb2wgbWF5IHN0aWxsIHNwYXduLlxuICAgKi9cbiAgX3NwYXduYWJsZVBvb2xlZENoaWxkcmVuKCkge1xuICAgIHJldHVybiBNYXRoLm1heCgwLCB0aGlzLnBvb2xlZFJ1bm5lckNvdW50IC0gdGhpcy5wb29sZWRDaGlsZHJlbi5zaXplKVxuICB9XG5cbiAgLyoqXG4gICAqIFJlc29sdmVzIG9uY2UgYSBub24tcmV0aXJpbmcgcG9vbGVkIGNoaWxkIGhhcyBhIGZyZWUgY29uY3VycmVuY3kgc2xvdCBvciB0aGVcbiAgICogcG9vbCBtYXkgc3Bhd24gYSBuZXcgb25lLiBQb29sZWQgam9icyBhZG1pdHRlZCB3aGlsZSB0aGUgcG9vbCBpcyBhdCBpdHNcbiAgICogaGFyZCBjYXAgd2FpdCBoZXJlIGluc3RlYWQgb2Ygc3Bhd25pbmcgYW4gb3Zlci1jYXBhY2l0eSBjaGlsZDsgdGhlIHdha2VcbiAgICogcG9pbnRzIGFyZSB0aGUgb25seSBjYXBhY2l0eS1mcmVlaW5nIHRyYW5zaXRpb25zIChhIGpvYiBvdXRjb21lIGFuZCBhIGNoaWxkXG4gICAqIGV4aXQpLCBzbyBubyBwb2xsaW5nIGlzIG5lZWRlZC5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgd2hlbiBhIHNsb3QgaXMgYXZhaWxhYmxlLlxuICAgKi9cbiAgX3dhaXRQb29sZWRTbG90KCkge1xuICAgIHRoaXMuX3N0YXJ0UG9vbGVkU2xvdFdhaXRQb2xsKClcblxuICAgIHJldHVybiBuZXcgUHJvbWlzZSgocmVzb2x2ZSkgPT4ge1xuICAgICAgY29uc3Qgd2FpdGVyID0gKCkgPT4ge1xuICAgICAgICB0aGlzLl9wb29sZWRTbG90V2FpdGVycy5kZWxldGUod2FpdGVyKVxuICAgICAgICB0aGlzLl9zdG9wUG9vbGVkU2xvdFdhaXRQb2xsSWZJZGxlKClcbiAgICAgICAgcmVzb2x2ZSgpXG4gICAgICB9XG5cbiAgICAgIHRoaXMuX3Bvb2xlZFNsb3RXYWl0ZXJzLmFkZCh3YWl0ZXIpXG4gICAgfSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSZXNvbHZlcyBldmVyeSByZWdpc3RlcmVkIHdhaXRlcjsgd2FpdGVycyByZS1jaGVjayB0aGUgc2xvdCBjb25kaXRpb25cbiAgICogdGhlbXNlbHZlcyBhbmQgb25seSBwcm9jZWVkIHdoZW4gaXQgaG9sZHMuXG4gICAqIEByZXR1cm5zIHt2b2lkfVxuICAgKi9cbiAgX3dha2VQb29sZWRTbG90V2FpdGVycygpIHtcbiAgICBpZiAodGhpcy5fcG9vbGVkU2xvdFdhaXRlcnMuc2l6ZSA9PT0gMCkgcmV0dXJuXG5cbiAgICBmb3IgKGNvbnN0IHJlc29sdmUgb2YgWy4uLnRoaXMuX3Bvb2xlZFNsb3RXYWl0ZXJzXSkgcmVzb2x2ZSgpXG4gIH1cblxuICAvKipcbiAgICogRnJlZSBwb29sZWQgc2xvdHMgYWNyb3NzIHRoZSBwb29sOiBvcGVuIHNsb3RzIGluIG5vbi1yZXRpcmluZyBjaGlsZHJlbiBwbHVzXG4gICAqIHRoZSBzbG90cyB3ZSBjb3VsZCBhZGQgYnkgc3Bhd25pbmcgbW9yZSBjaGlsZHJlbiB1cCB0byB0aGUgaGFyZCBjYXAgb24gdG90YWxcbiAgICogbGl2ZSBjaGlsZHJlbi4gUmV0aXJpbmcgY2hpbGRyZW4gKGRyYWluaW5nIGJlZm9yZSByZXBsYWNlbWVudCkgbmV2ZXJcbiAgICogY29udHJpYnV0ZSBjYXBhY2l0eSwgYW5kIHRoZXkgY291bnQgYWdhaW5zdCB0aGUgY2FwOiB3aGlsZSBvbmUgaXMgc3RpbGxcbiAgICogZHJhaW5pbmcsIG5vIHJlcGxhY2VtZW50IGlzIGFkdmVydGlzZWQgKG9yIHNwYXduZWQpIOKAlCB0aGUgcG9vbCBhZHZlcnRpc2VzXG4gICAqIGV4YWN0bHkgd2hhdCBpdCBjYW4gc2VydmUgaW5zdGVhZCBvZiBwaGFudG9tIGNhcGFjaXR5LlxuICAgKiBAcmV0dXJucyB7bnVtYmVyfSAtIE51bWJlciBvZiBwb29sZWQgam9icyB0aGUgd29ya2VyIGNhbiBhY2NlcHQgcmlnaHQgbm93LlxuICAgKi9cbiAgX2F2YWlsYWJsZVBvb2xlZFNsb3RzKCkge1xuICAgIGxldCBvcGVuSW5FeGlzdGluZyA9IDBcbiAgICBsZXQgcXVldWVkUmVzZXJ2YXRpb25zID0gMFxuXG4gICAgZm9yIChjb25zdCBjaGlsZCBvZiB0aGlzLnBvb2xlZENoaWxkcmVuKSB7XG4gICAgICBjb25zdCBzdGF0ZSA9IHRoaXMucG9vbGVkQ2hpbGRTdGF0ZXMuZ2V0KGNoaWxkKVxuICAgICAgaWYgKCFzdGF0ZSB8fCBzdGF0ZS5yZXRpcmluZykgY29udGludWVcbiAgICAgIG9wZW5JbkV4aXN0aW5nICs9IHRoaXMucG9vbGVkUnVubmVyQ29uY3VycmVuY3kgLSBzdGF0ZS5pbmZsaWdodC5zaXplXG4gICAgfVxuXG4gICAgZm9yIChjb25zdCBxdWV1ZSBvZiB0aGlzLnBvb2xlZEpvYlF1ZXVlcy52YWx1ZXMoKSkgcXVldWVkUmVzZXJ2YXRpb25zICs9IHF1ZXVlLmxlbmd0aFxuXG4gICAgY29uc3Qgc3Bhd25hYmxlQ2hpbGRyZW4gPSBNYXRoLm1heCgwLCB0aGlzLnBvb2xlZFJ1bm5lckNvdW50IC0gdGhpcy5wb29sZWRDaGlsZHJlbi5zaXplKVxuXG4gICAgcmV0dXJuIE1hdGgubWF4KDAsIG9wZW5JbkV4aXN0aW5nICsgc3Bhd25hYmxlQ2hpbGRyZW4gKiB0aGlzLnBvb2xlZFJ1bm5lckNvbmN1cnJlbmN5IC0gcXVldWVkUmVzZXJ2YXRpb25zKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgYSBwYXlsb2FkIG9uIGEgcG9vbGVkIGNoaWxkIHdpdGggYSBmcmVlIGNvbmN1cnJlbmN5IHNsb3QsIHNwYXduaW5nIGFcbiAgICogbmV3IGNoaWxkIHdoZW4gZXZlcnkgbm9uLXJldGlyaW5nIGNoaWxkIGlzIGZ1bGwgYW5kIHRoZSBwb29sIGlzIGJlbG93XG4gICAqIGBwb29sZWRSdW5uZXJDb3VudGAuIEVhY2ggY2hpbGQgcnVucyB1cCB0byBgcG9vbGVkUnVubmVyQ29uY3VycmVuY3lgIGpvYnMgYXRcbiAgICogb25jZSBvbiBpdHMgb3duIGV2ZW50IGxvb3AuXG4gICAqXG4gICAqIFdoZW4gdGhlIHBvb2wgaXMgYWxyZWFkeSBhdCBpdHMgaGFyZCBjYXAgKHRvdGFsIGxpdmUgY2hpbGRyZW4sIGRyYWluaW5nXG4gICAqIGluY2x1ZGVkKSwgdGhlIGpvYiB3YWl0cyBmb3IgYSBzbG90IGluc3RlYWQgb2Ygc3Bhd25pbmc6IHRoYXQgaXMgd2hhdCBrZWVwc1xuICAgKiB0aGUgbGl2ZS1jaGlsZCBjb3VudCDigJQgYW5kIHRoZXJlZm9yZSB0aGUgcG9vbCdzIHRvdGFsIFJTUyDigJQgYm91bmRlZC4gVGhlXG4gICAqIHdhaXQgcmVzb2x2ZXMgb24gdGhlIG9ubHkgdHdvIGNhcGFjaXR5LWZyZWVpbmcgdHJhbnNpdGlvbnMgKGEgam9iIG91dGNvbWUsXG4gICAqIGEgY2hpbGQgZXhpdCk7IGEgc2FmZXR5IHBvbGwgY292ZXJzIGFueXRoaW5nIG1pc3NlZC5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL3R5cGVzLmpzXCIpLkJhY2tncm91bmRKb2JQYXlsb2FkICYge2lkOiBzdHJpbmd9fSBwYXlsb2FkIC0gSm9iIHBheWxvYWQuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIGFmdGVyIHRoZSBkdXJhYmxlIHJlcG9ydC5cbiAgICovXG4gIGFzeW5jIF9ydW5Qb29sZWRKb2IocGF5bG9hZCkge1xuICAgIC8vIEF0IHRoZSBoYXJkIGNhcCAobm8gZnJlZSBzbG90LCBubyBzcGF3bmFibGUgY2hpbGQpIHRoZSBqb2Igd2FpdHMgZm9yIGFcbiAgICAvLyBzbG90IGluc3RlYWQgb2Ygc3Bhd25pbmcgYW4gb3Zlci1jYXBhY2l0eSBjaGlsZCDigJQgdGhhdCBpcyB3aGF0IGJvdW5kc1xuICAgIC8vIHRoZSBsaXZlLWNoaWxkIGNvdW50IGFuZCB0aGUgcG9vbCdzIHRvdGFsIFJTUy5cbiAgICBsZXQgY2hpbGQgPSB0aGlzLl9zZWxlY3RQb29sZWRDaGlsZCgpXG4gICAgd2hpbGUgKCFjaGlsZCkge1xuICAgICAgaWYgKHRoaXMuX3NwYXduYWJsZVBvb2xlZENoaWxkcmVuKCkgPT09IDApIHtcbiAgICAgICAgLy8gU2h1dGRvd246IG1haW4gbm8gbG9uZ2VyIGRpc3BhdGNoZXMgYW5kIG5vIHNsb3Qgd2lsbCBldmVyIGZyZWUg4oCUXG4gICAgICAgIC8vIHN0b3Agd2FpdGluZyBzbyB0aGUgdHJhY2tlZCBqb2IgY2FuIHNldHRsZSBhbmQgdGhlIGRyYWluIGNvbXBsZXRlcy5cbiAgICAgICAgaWYgKHRoaXMuc2hvdWxkU3RvcCkgcmV0dXJuXG4gICAgICAgIGF3YWl0IHRoaXMuX3dhaXRQb29sZWRTbG90KClcbiAgICAgICAgY2hpbGQgPSB0aGlzLl9zZWxlY3RQb29sZWRDaGlsZCgpXG4gICAgICAgIGNvbnRpbnVlXG4gICAgICB9XG4gICAgICBjaGlsZCA9IHRoaXMuX3NlbGVjdFBvb2xlZENoaWxkKCkgfHwgdGhpcy5fY3JlYXRlUG9vbGVkQ2hpbGQoKVxuICAgIH1cblxuICAgIGNvbnN0IHN0YXRlID0gdGhpcy5wb29sZWRDaGlsZFN0YXRlcy5nZXQoY2hpbGQpXG4gICAgaWYgKCFzdGF0ZSkgdGhyb3cgbmV3IEVycm9yKFwiUG9vbGVkIHJ1bm5lciBzdGF0ZSBtaXNzaW5nXCIpXG5cbiAgICAvLyBTdGFtcCB0aGUgcm91bmQtcm9iaW4gY3Vyc29yIHNvIHRoZSBuZXh0IGRpc3BhdGNoIHByZWZlcnMgYSBkaWZmZXJlbnQgY2hpbGQuXG4gICAgc3RhdGUubGFzdERpc3BhdGNoU2VxID0gKyt0aGlzLl9wb29sZWREaXNwYXRjaFNlcVxuXG4gICAgLyoqXG4gICAgICogUmVzb2x2ZXMgdGhlIHBvb2xlZCBqb2IgcHJvbWlzZS5cbiAgICAgKiBAdHlwZSB7KHZhbHVlOiB2b2lkKSA9PiB2b2lkfVxuICAgICAqL1xuICAgIGxldCByZXNvbHZlUG9vbGVkSm9iID0gKCkgPT4ge31cbiAgICBjb25zdCBwb29sZWRKb2IgPSBuZXcgUHJvbWlzZSgocmVzb2x2ZSkgPT4geyByZXNvbHZlUG9vbGVkSm9iID0gcmVzb2x2ZSB9KVxuICAgIGNvbnN0IHRpbWVvdXRUaW1lciA9IHRoaXMuX2FybVBvb2xlZEpvYlRpbWVvdXQoe2NoaWxkLCBwYXlsb2FkfSlcblxuICAgIHN0YXRlLmluZmxpZ2h0LnNldChwYXlsb2FkLmlkLCB7cGF5bG9hZCwgcmVzb2x2ZTogcmVzb2x2ZVBvb2xlZEpvYiwgcG9vbGVkSm9iLCB0aW1lb3V0VGltZXJ9KVxuICAgIHRyeSB7XG4gICAgICBjaGlsZC5zZW5kKHt0eXBlOiBcImpvYlwiLCBwYXlsb2FkLCBzaGFyZWRUcmFuc2FjdGlvbkJyb2tlcjogdGhpcy5fcG9vbGVkSm9iU2hhcmVkVHJhbnNhY3Rpb25Ccm9rZXJDb25maWcoKX0pXG4gICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgIHZvaWQgdGhpcy5faGFuZGxlUG9vbGVkQ2hpbGRGYWlsdXJlKHtjaGlsZCwgZXJyb3IsIG9yaWdpbjogXCJpcGMtc2VuZFwifSlcbiAgICB9XG5cbiAgICByZXR1cm4gcG9vbGVkSm9iXG4gIH1cblxuICAvKipcbiAgICogQ2FwdHVyZXMgdGhlIGN1cnJlbnQgdGVzdCBhdHRlbXB0J3MgYnJva2VyIG1vZGUgYXQgZGlzcGF0Y2ggdGltZS4gQSB3YXJtXG4gICAqIHBvb2xlZCBjaGlsZCBtdXN0IG5ldmVyIHJlbHkgb24gaXRzIGltbXV0YWJsZSBmb3JrLXRpbWUgZW52aXJvbm1lbnQuXG4gICAqIEByZXR1cm5zIHtpbXBvcnQoXCIuLi90ZXN0aW5nL3NoYXJlZC10cmFuc2FjdGlvbi1wcm94eS1kcml2ZXIuanNcIikuU2hhcmVkVHJhbnNhY3Rpb25Ccm9rZXJKb2JDb25maWd9IC0gUGVyLWpvYiBicm9rZXIgY29uZmlndXJhdGlvbi5cbiAgICovXG4gIF9wb29sZWRKb2JTaGFyZWRUcmFuc2FjdGlvbkJyb2tlckNvbmZpZygpIHtcbiAgICBjb25zdCBzZXJpYWxpemVkID0gcHJvY2Vzcy5lbnYuVkVMT0NJT1VTX1RFU1RfU0hBUkVEX1RSQU5TQUNUSU9OX0JST0tFUlxuICAgIGlmICghc2VyaWFsaXplZCkgcmV0dXJuIHtleHBlY3RlZDogZmFsc2V9XG5cbiAgICBjb25zdCBjb25maWcgPSBKU09OLnBhcnNlKEJ1ZmZlci5mcm9tKHNlcmlhbGl6ZWQsIFwiYmFzZTY0dXJsXCIpLnRvU3RyaW5nKFwidXRmOFwiKSlcbiAgICByZXR1cm4gey4uLmNvbmZpZywgZXhwZWN0ZWQ6IHRydWV9XG4gIH1cblxuICAvKipcbiAgICogU2VsZWN0cyBhIHBvb2xlZCBjaGlsZCB0byBydW4gdGhlIG5leHQgam9iLCBvciB1bmRlZmluZWQgd2hlbiBldmVyeSBub24tcmV0aXJpbmdcbiAgICogY2hpbGQgaXMgYWxyZWFkeSBmdWxsICh0aGUgY2FsbGVyIHRoZW4gbGF6aWx5IHNwYXducyBvbmUpLiBBbW9uZyBjaGlsZHJlbiB3aXRoIGFcbiAgICogZnJlZSBjb25jdXJyZW5jeSBzbG90LCBwaWNrcyB0aGUgb25lIGRpc3BhdGNoZWQgbGVhc3QgcmVjZW50bHkg4oCUIGEgcm91bmQtcm9iaW4gdGhhdFxuICAgKiBzcHJlYWRzIGpvYnMgKG5vdGFibHkgbXVsdGktbWludXRlIFJ1bkJ1aWxkSm9icywgZWFjaCBwaW5uaW5nIGEgdGVuYW50IGNvbm5lY3Rpb25cbiAgICogZm9yIGl0cyB3aG9sZSBydW4pIGV2ZW5seSBhY3Jvc3MgY2hpbGRyZW4gaW5zdGVhZCBvZiBmaXJzdC1maXQgcGFja2luZyB0aGUgZWFybGllc3RcbiAgICogb25lIHVudGlsIGl0IGlzIGZ1bGwuIEEgZnJlc2hseSBzcGF3bmVkIG9yIHJlcGxhY2VtZW50IGNoaWxkIHRoZXJlZm9yZSB0YWtlcyBpdHNcbiAgICogZmFpciBzaGFyZSBvbmUgam9iIGF0IGEgdGltZSBhcyBpdHMgdHVybiBjb21lcyB1cCwgcmF0aGVyIHRoYW4gYWJzb3JiaW5nIGEgYnVyc3QgdG9cbiAgICogXCJjYXRjaCB1cFwiIHRvIHRoZSBvdGhlcnMuXG4gICAqIEByZXR1cm5zIHtpbXBvcnQoXCJub2RlOmNoaWxkX3Byb2Nlc3NcIikuQ2hpbGRQcm9jZXNzIHwgdW5kZWZpbmVkfSAtIFRoZSBjaG9zZW4gY2hpbGQsIG9yIHVuZGVmaW5lZCB3aGVuIGFsbCBub24tcmV0aXJpbmcgY2hpbGRyZW4gYXJlIGZ1bGwuXG4gICAqL1xuICBfc2VsZWN0UG9vbGVkQ2hpbGQoKSB7XG4gICAgLyoqIEB0eXBlIHtpbXBvcnQoXCJub2RlOmNoaWxkX3Byb2Nlc3NcIikuQ2hpbGRQcm9jZXNzIHwgdW5kZWZpbmVkfSAqL1xuICAgIGxldCBzZWxlY3RlZFxuICAgIGxldCBzZWxlY3RlZFNlcSA9IEluZmluaXR5XG5cbiAgICBmb3IgKGNvbnN0IGNoaWxkIG9mIHRoaXMucG9vbGVkQ2hpbGRyZW4pIHtcbiAgICAgIGNvbnN0IHN0YXRlID0gdGhpcy5wb29sZWRDaGlsZFN0YXRlcy5nZXQoY2hpbGQpXG5cbiAgICAgIGlmICghc3RhdGUgfHwgc3RhdGUucmV0aXJpbmcgfHwgc3RhdGUuaW5mbGlnaHQuc2l6ZSA+PSB0aGlzLnBvb2xlZFJ1bm5lckNvbmN1cnJlbmN5KSBjb250aW51ZVxuXG4gICAgICBpZiAoc3RhdGUubGFzdERpc3BhdGNoU2VxIDwgc2VsZWN0ZWRTZXEpIHtcbiAgICAgICAgc2VsZWN0ZWQgPSBjaGlsZFxuICAgICAgICBzZWxlY3RlZFNlcSA9IHN0YXRlLmxhc3REaXNwYXRjaFNlcVxuICAgICAgfVxuICAgIH1cblxuICAgIHJldHVybiBzZWxlY3RlZFxuICB9XG5cbiAgLyoqXG4gICAqIEFybXMgYSBwZXItam9iIHdhbGwtY2xvY2sgYmFja3N0b3AgZm9yIGEgcG9vbGVkIGpvYi4gQSBwb29sZWQgY2hpbGQgaG9zdHMgbWFueVxuICAgKiBjb25jdXJyZW50IGpvYnMsIHNvIGEgc2luZ2xlIGdlbnVpbmVseS1odW5nIGpvYiB3b3VsZCBvdGhlcndpc2UgcGluIGl0c1xuICAgKiBydW5uZXIncyBjb25jdXJyZW5jeSBzbG90IGZvcmV2ZXIg4oCUIHRoZSBsaWZldGltZSByZWN5Y2xlIG9ubHkgcmV0aXJlcyBhIGNoaWxkXG4gICAqIG9uY2UgaXRzIGluLWZsaWdodCBzZXQgZHJhaW5zLCB3aGljaCBhIGh1bmcgam9iIG5ldmVyIGRvZXMuIE9uIG92ZXJydW4gdGhlXG4gICAqIHdob2xlIGNoaWxkIGlzIHRlcm1pbmF0ZWQgc28gdGhlIGh1bmcgam9iIChhbmQgaXRzIHNpYmxpbmdzKSByZXF1ZXVlLiBSZXR1cm5zXG4gICAqIHRoZSB0aW1lciwgb3IgbnVsbCB3aGVuIG5vIHRpbWVvdXQgaXMgY29uZmlndXJlZC5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBPcHRpb25zLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIm5vZGU6Y2hpbGRfcHJvY2Vzc1wiKS5DaGlsZFByb2Nlc3N9IGFyZ3MuY2hpbGQgLSBQb29sZWQgY2hpbGQuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi90eXBlcy5qc1wiKS5CYWNrZ3JvdW5kSm9iUGF5bG9hZCAmIHtpZDogc3RyaW5nfX0gYXJncy5wYXlsb2FkIC0gSm9iIHBheWxvYWQgd2hvc2Ugb3ZlcnJ1biBpcyBndWFyZGVkLlxuICAgKiBAcmV0dXJucyB7UmV0dXJuVHlwZTx0eXBlb2Ygc2V0VGltZW91dD4gfCBudWxsfSAtIFRoZSBhcm1lZCB0aW1lciwgb3IgbnVsbC5cbiAgICovXG4gIF9hcm1Qb29sZWRKb2JUaW1lb3V0KHtjaGlsZCwgcGF5bG9hZH0pIHtcbiAgICBjb25zdCB0aW1lb3V0TXMgPSB0aGlzLl9yZXNvbHZlSm9iVGltZW91dE1zKHBheWxvYWQub3B0aW9ucylcblxuICAgIGlmICghKHR5cGVvZiB0aW1lb3V0TXMgPT09IFwibnVtYmVyXCIgJiYgdGltZW91dE1zID4gMCkpIHJldHVybiBudWxsXG5cbiAgICByZXR1cm4gc2V0VGltZW91dCgoKSA9PiB0aGlzLl9vblBvb2xlZEpvYlRpbWVvdXQoe2NoaWxkLCBqb2JJZDogcGF5bG9hZC5pZH0pLCB0aW1lb3V0TXMpXG4gIH1cblxuICAvKipcbiAgICogRmlyZWQgd2hlbiBhIHBvb2xlZCBqb2Igb3ZlcnJ1bnMgaXRzIHRpbWVvdXQuIFRlcm1pbmF0ZXMgdGhlIGNoaWxkIHJ1bm5pbmcgaXRcbiAgICogKFNJR1RFUk0sIHRoZW4gU0lHS0lMTCBhZnRlciB0aGUgZ3JhY2UpIOKAlCBhIGh1bmcgSlMgam9iIGNhbm5vdCBiZSBjYW5jZWxsZWRcbiAgICogYW55IG90aGVyIHdheS4gVGhlIG5vbi1jbGVhbiBleGl0IGZsb3dzIHRocm91Z2ggYF9oYW5kbGVQb29sZWRDaGlsZEZhaWx1cmVgLFxuICAgKiB3aGljaCByZXBvcnRzIGV2ZXJ5IGluLWZsaWdodCBqb2Igb24gdGhlIGNoaWxkIGZhaWxlZCAoc28gdGhleSByZXF1ZXVlKSBhbmRcbiAgICogZHJvcHMgaXQgZnJvbSB0cmFja2luZzsgdGhlIGZhaWx1cmUgcGF0aCBpbW1lZGlhdGVseSByZS1hZHZlcnRpc2VzIHRoZVxuICAgKiByZXN1bHRpbmcgY2FwYWNpdHkgb25jZSB0aGUgcnVubmVyIGhhcyBjb21wbGV0ZWQgc3RhcnR1cC5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBPcHRpb25zLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIm5vZGU6Y2hpbGRfcHJvY2Vzc1wiKS5DaGlsZFByb2Nlc3N9IGFyZ3MuY2hpbGQgLSBQb29sZWQgY2hpbGQuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBhcmdzLmpvYklkIC0gSm9iIGlkIHRoYXQgb3ZlcnJhbi5cbiAgICogQHJldHVybnMge3ZvaWR9XG4gICAqL1xuICBfb25Qb29sZWRKb2JUaW1lb3V0KHtjaGlsZCwgam9iSWR9KSB7XG4gICAgY29uc3Qgc3RhdGUgPSB0aGlzLnBvb2xlZENoaWxkU3RhdGVzLmdldChjaGlsZClcblxuICAgIC8vIEFscmVhZHkgc2V0dGxpbmcvZ29uZSwgb3IgdGhlIGpvYiBmaW5pc2hlZCBpbiB0aGUgcmFjZSB3aXRoIHRoaXMgdGltZXIuXG4gICAgaWYgKCFzdGF0ZSB8fCBzdGF0ZS5zZXR0bGluZyB8fCBzdGF0ZS5zaHV0ZG93blJlYXNvbiB8fCAhc3RhdGUuaW5mbGlnaHQuaGFzKGpvYklkKSkgcmV0dXJuXG5cbiAgICBzdGF0ZS50aW1lb3V0Sm9iSWQgPSBqb2JJZFxuICAgIHRoaXMuX3JlcXVlc3RQb29sZWRDaGlsZFNodXRkb3duKHtjaGlsZCwgcmVhc29uOiBcImpvYl90aW1lb3V0XCIsIHNpZ25hbDogXCJTSUdURVJNXCJ9KVxuXG4gICAgc3RhdGUudGltZW91dFNpZ2tpbGxUaW1lciA9IHNldFRpbWVvdXQoKCkgPT4ge1xuICAgICAgdHJ5IHtcbiAgICAgICAgY2hpbGQua2lsbChcIlNJR0tJTExcIilcbiAgICAgIH0gY2F0Y2gge1xuICAgICAgICAvLyBDaGlsZCBhbHJlYWR5IGV4aXRlZDsgbm90aGluZyB0byBkby5cbiAgICAgIH1cbiAgICB9LCB0aGlzLmZvcmtlZENoaWxkU2lna2lsbEdyYWNlTXMpXG4gIH1cblxuICAvKipcbiAgICogQ3JlYXRlcyBhIHJldXNhYmxlIHBvb2xlZCBjaGlsZCwgZW5mb3JjaW5nIHRoZSBoYXJkIGNhcCBvbiB0b3RhbCBsaXZlXG4gICAqIGNoaWxkcmVuICh3b3JraW5nICsgZHJhaW5pbmcpLiBSZXR1cm5zIHVuZGVmaW5lZCB3aGVuIHRoZSBjYXAgaXMgYWxyZWFkeVxuICAgKiBtZXQg4oCUIHRoZSBvbmx5IHdheSBhIG5ldyBjaGlsZCBtYXkgZXhpc3QgaXMgYSBzbG90IGJlaW5nIG9wZW4sIHNvIHRoZVxuICAgKiBjYWxsZXIgcmUtY2hlY2tzIGFuZCB3YWl0cyBhZ2Fpbi5cbiAgICogQHJldHVybnMge2ltcG9ydChcIm5vZGU6Y2hpbGRfcHJvY2Vzc1wiKS5DaGlsZFByb2Nlc3MgfCB1bmRlZmluZWR9IC0gVGhlIG5ldyBjaGlsZCwgb3IgdW5kZWZpbmVkIHdoZW4gdGhlIHBvb2wgaXMgYXQgaXRzIGNhcC5cbiAgICovXG4gIF9jcmVhdGVQb29sZWRDaGlsZCgpIHtcbiAgICBjb25zdCBjb25maWd1cmF0aW9uID0gdGhpcy5jb25maWd1cmF0aW9uXG4gICAgaWYgKCFjb25maWd1cmF0aW9uKSB0aHJvdyBuZXcgRXJyb3IoXCJCYWNrZ3JvdW5kIGpvYnMgd29ya2VyIGNvbmZpZ3VyYXRpb24gbm90IGluaXRpYWxpemVkXCIpXG4gICAgaWYgKHRoaXMucG9vbGVkQ2hpbGRyZW4uc2l6ZSA+PSB0aGlzLnBvb2xlZFJ1bm5lckNvdW50KSByZXR1cm4gdW5kZWZpbmVkXG4gICAgY29uc3QgY2hpbGQgPSBmb3JrKFBPT0xFRF9SVU5ORVJfRU5UUllfUEFUSCwgW10sIHtcbiAgICAgIGN3ZDogY29uZmlndXJhdGlvbi5nZXREaXJlY3RvcnkoKSwgZXhlY0FyZ3Y6IFtdLCBzdGRpbzogW1wiaWdub3JlXCIsIFwiaWdub3JlXCIsIFwiaWdub3JlXCIsIFwiaXBjXCJdLFxuICAgICAgZW52OiBPYmplY3QuYXNzaWduKHt9LCBwcm9jZXNzLmVudiwgdGhpcy5fY2hpbGRCYWNrZ3JvdW5kSm9ic0Vudmlyb25tZW50KCkpXG4gICAgfSlcbiAgICB0aGlzLnBvb2xlZENoaWxkcmVuLmFkZChjaGlsZClcbiAgICB0aGlzLmluZmxpZ2h0UHJvY2Vzc0NoaWxkcmVuLmFkZChjaGlsZClcbiAgICB0aGlzLnBvb2xlZENoaWxkU3RhdGVzLnNldChjaGlsZCwge2NyZWF0ZWRBdE1zOiBEYXRlLm5vdygpLCBqb2JzUnVuOiAwLCBpbmZsaWdodDogbmV3IE1hcCgpLCBsYXN0RGlzcGF0Y2hTZXE6IDAsIHJldGlyaW5nOiBmYWxzZSwgc3RhcnRlZDogZmFsc2V9KVxuICAgIGNoaWxkLm9uKFwibWVzc2FnZVwiLCAobWVzc2FnZSkgPT4gdGhpcy5faGFuZGxlUG9vbGVkQ2hpbGRNZXNzYWdlKHtjaGlsZCwgbWVzc2FnZX0pKVxuICAgIGNoaWxkLm9uY2UoXCJleGl0XCIsIChleGl0Q29kZSwgc2lnbmFsKSA9PiB0aGlzLl9oYW5kbGVQb29sZWRDaGlsZEZhaWx1cmUoe1xuICAgICAgY2hpbGQsXG4gICAgICBlcnJvcjogbmV3IEVycm9yKGBQb29sZWQgYmFja2dyb3VuZCBqb2IgcnVubmVyIGV4aXRlZDogY29kZT0ke2V4aXRDb2RlfSBzaWduYWw9JHtzaWduYWwgfHwgXCJub25lXCJ9YCksXG4gICAgICBleGl0Q29kZSxcbiAgICAgIG9yaWdpbjogXCJleGl0XCIsXG4gICAgICBzaWduYWxcbiAgICB9KSlcbiAgICBjaGlsZC5vbmNlKFwiZXJyb3JcIiwgKGVycm9yKSA9PiB0aGlzLl9oYW5kbGVQb29sZWRDaGlsZEZhaWx1cmUoe1xuICAgICAgY2hpbGQsXG4gICAgICBlcnJvcixcbiAgICAgIGV4aXRDb2RlOiBjaGlsZC5leGl0Q29kZSxcbiAgICAgIG9yaWdpbjogXCJwcm9jZXNzLWVycm9yXCIsXG4gICAgICBzaWduYWw6IGNoaWxkLnNpZ25hbENvZGVcbiAgICB9KSlcbiAgICBjaGlsZC5vbmNlKFwiZGlzY29ubmVjdFwiLCAoKSA9PiB7XG4gICAgICBjb25zdCBzdGF0ZSA9IHRoaXMucG9vbGVkQ2hpbGRTdGF0ZXMuZ2V0KGNoaWxkKVxuICAgICAgaWYgKHN0YXRlKSBzdGF0ZS5pcGNEaXNjb25uZWN0ZWRBdE1zID8/PSBEYXRlLm5vdygpXG4gICAgfSlcbiAgICByZXR1cm4gY2hpbGRcbiAgfVxuXG4gIC8qKlxuICAgKiBIYW5kbGVzIGEgcG9vbGVkIGNoaWxkJ3MgcGVyLWpvYiBkdXJhYmxlLXJlcG9ydCBhY2tub3dsZWRnZW1lbnQuIEEgY2hpbGRcbiAgICogcnVucyBqb2JzIGNvbmN1cnJlbnRseSBhbmQgcmVwb3J0cyBvbmUgYGpvYi1vdXRjb21lYCBwZXIgam9iIGlkLlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIE1lc3NhZ2UgZGV0YWlscy5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCJub2RlOmNoaWxkX3Byb2Nlc3NcIikuQ2hpbGRQcm9jZXNzfSBhcmdzLmNoaWxkIC0gUG9vbGVkIGNoaWxkLlxuICAgKiBAcGFyYW0ge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSBhcmdzLm1lc3NhZ2UgLSBJUEMgbWVzc2FnZS5cbiAgICogQHJldHVybnMge3ZvaWR9XG4gICAqL1xuICBfaGFuZGxlUG9vbGVkQ2hpbGRNZXNzYWdlKHtjaGlsZCwgbWVzc2FnZX0pIHtcbiAgICBpZiAoIW1lc3NhZ2UgfHwgdHlwZW9mIG1lc3NhZ2UgIT09IFwib2JqZWN0XCIpIHJldHVyblxuICAgIGNvbnN0IHJlY29yZCA9IC8qKiBAdHlwZSB7e3R5cGU/OiBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPiwgY2hpbGRJbnN0YW5jZUlkPzogUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4sIGpvYklkPzogUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4sIGFja25vd2xlZGdlZD86IFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+LCByc3NCeXRlcz86IFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+LCBlcnJvcj86IFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fX0gKi8gKG1lc3NhZ2UpXG4gICAgY29uc3Qgc3RhdGUgPSB0aGlzLnBvb2xlZENoaWxkU3RhdGVzLmdldChjaGlsZClcbiAgICBpZiAocmVjb3JkLnR5cGUgPT09IFwicmVhZHlcIikge1xuICAgICAgaWYgKHN0YXRlKSB7XG4gICAgICAgIHN0YXRlLnN0YXJ0ZWQgPSB0cnVlXG4gICAgICAgIGlmICh0eXBlb2YgcmVjb3JkLmNoaWxkSW5zdGFuY2VJZCA9PT0gXCJzdHJpbmdcIikgc3RhdGUuY2hpbGRJbnN0YW5jZUlkID0gcmVjb3JkLmNoaWxkSW5zdGFuY2VJZFxuICAgICAgfVxuICAgICAgcmV0dXJuXG4gICAgfVxuICAgIGlmIChpc0NoaWxkU2h1dGRvd25PYnNlcnZhdGlvbk1lc3NhZ2UobWVzc2FnZSkpIHtcbiAgICAgIGlmIChzdGF0ZSkge1xuICAgICAgICBzdGF0ZS5jaGlsZEluc3RhbmNlSWQgPSBtZXNzYWdlLmNoaWxkSW5zdGFuY2VJZFxuICAgICAgICBzdGF0ZS5zaHV0ZG93bk9ic2VydmF0aW9uID0gbWVzc2FnZVxuICAgICAgICBpZiAoc3RhdGUuc2h1dGRvd25TaWduYWxUaW1lcikge1xuICAgICAgICAgIGNsZWFyVGltZW91dChzdGF0ZS5zaHV0ZG93blNpZ25hbFRpbWVyKVxuICAgICAgICAgIHN0YXRlLnNodXRkb3duU2lnbmFsVGltZXIgPSB1bmRlZmluZWRcbiAgICAgICAgfVxuICAgICAgfVxuICAgICAgcmV0dXJuXG4gICAgfVxuICAgIGlmIChpc0NoaWxkQWNjZXB0YW5jZU1lc3NhZ2UobWVzc2FnZSkpIHtcbiAgICAgIHRoaXMuX3JlcG9ydENoaWxkQWNjZXB0ZWQobWVzc2FnZSlcbiAgICAgIHJldHVyblxuICAgIH1cbiAgICBpZiAocmVjb3JkLnR5cGUgIT09IFwiam9iLW91dGNvbWVcIiB8fCAhc3RhdGUgfHwgc3RhdGUuc2V0dGxpbmcgfHwgdHlwZW9mIHJlY29yZC5qb2JJZCAhPT0gXCJzdHJpbmdcIikgcmV0dXJuXG4gICAgc3RhdGUuc3RhcnRlZCA9IHRydWVcbiAgICBjb25zdCBlbnRyeSA9IHN0YXRlLmluZmxpZ2h0LmdldChyZWNvcmQuam9iSWQpXG4gICAgaWYgKCFlbnRyeSkgcmV0dXJuXG5cbiAgICBpZiAoZW50cnkudGltZW91dFRpbWVyKSBjbGVhclRpbWVvdXQoZW50cnkudGltZW91dFRpbWVyKVxuICAgIHN0YXRlLmluZmxpZ2h0LmRlbGV0ZShyZWNvcmQuam9iSWQpXG4gICAgc3RhdGUuam9ic1J1biArPSAxXG4gICAgY29uc3QgcmVzb2x2ZSA9IGVudHJ5LnJlc29sdmVcblxuICAgIGlmIChyZWNvcmQuYWNrbm93bGVkZ2VkID09PSB0cnVlKSB7XG4gICAgICBpZiAocmVzb2x2ZSkgcmVzb2x2ZSh1bmRlZmluZWQpXG4gICAgfSBlbHNlIHtcbiAgICAgIC8vIFRoZSBjaGlsZCBzdGF5ZWQgYWxpdmUgYnV0IGNvdWxkIG5vdCBjb25maXJtIHRoaXMgb25lIGpvYidzIHRlcm1pbmFsXG4gICAgICAvLyByZXBvcnQ7IHJlY2xhaW0ganVzdCB0aGlzIGpvYiDigJQgaXRzIGNvbmN1cnJlbnQgc2libGluZ3MgYXJlIHVuYWZmZWN0ZWQuXG4gICAgICB2b2lkIHRoaXMuX3JlcG9ydEpvYlJlc3VsdCh7XG4gICAgICAgIGpvYklkOiBlbnRyeS5wYXlsb2FkLmlkLFxuICAgICAgICBzdGF0dXM6IFwiZmFpbGVkXCIsXG4gICAgICAgIGVycm9yOiBuZXcgRXJyb3IodHlwZW9mIHJlY29yZC5lcnJvciA9PT0gXCJzdHJpbmdcIiA/IHJlY29yZC5lcnJvciA6IFwiUG9vbGVkIHJ1bm5lciB0ZXJtaW5hbCByZXBvcnQgd2FzIG5vdCBhY2tub3dsZWRnZWRcIiksXG4gICAgICAgIGhhbmRvZmZJZDogZW50cnkucGF5bG9hZC5oYW5kb2ZmSWQsXG4gICAgICAgIGhhbmRlZE9mZkF0TXM6IGVudHJ5LnBheWxvYWQuaGFuZGVkT2ZmQXRNcyxcbiAgICAgICAgd29ya2VySWQ6IGVudHJ5LnBheWxvYWQud29ya2VySWQgfHwgdGhpcy53b3JrZXJJZFxuICAgICAgfSkuZmluYWxseSgoKSA9PiB7IGlmIChyZXNvbHZlKSByZXNvbHZlKHVuZGVmaW5lZCkgfSlcbiAgICB9XG5cbiAgICBjb25zdCByc3NCeXRlcyA9IHR5cGVvZiByZWNvcmQucnNzQnl0ZXMgPT09IFwibnVtYmVyXCIgPyByZWNvcmQucnNzQnl0ZXMgOiBOdW1iZXIuUE9TSVRJVkVfSU5GSU5JVFlcbiAgICBjb25zdCBydW5uZXJBZ2VNcyA9IERhdGUubm93KCkgLSBzdGF0ZS5jcmVhdGVkQXRNc1xuICAgIGlmICghc3RhdGUucmV0aXJpbmcgJiYgKHN0YXRlLmpvYnNSdW4gPj0gdGhpcy5wb29sZWRSdW5uZXJNYXhKb2JzIHx8IHJzc0J5dGVzID49IHRoaXMucG9vbGVkUnVubmVyTWF4UnNzQnl0ZXMgfHwgcnVubmVyQWdlTXMgPj0gdGhpcy5wb29sZWRSdW5uZXJNYXhMaWZldGltZU1zIHx8IHRoaXMuc2hvdWxkU3RvcCkpIHtcbiAgICAgIHRoaXMuX2JlZ2luUmV0aXJlUG9vbGVkQ2hpbGQoY2hpbGQpXG4gICAgfVxuICAgIHRoaXMuX3Rlcm1pbmF0ZUlmRHJhaW5lZChjaGlsZClcbiAgICAvLyBBIGpvYiBvdXRjb21lIGZyZWVzIGEgY29uY3VycmVuY3kgc2xvdCBhbmQgbWF5IGRyYWluIGEgcmV0aXJpbmcgY2hpbGQg4oCUXG4gICAgLy8gdGhlIG9ubHkgdHdvIHRyYW5zaXRpb25zIHRoYXQgZnJlZSBjYXBhY2l0eSBmb3Igd2FpdGVycyBhdCB0aGUgaGFyZCBjYXAuXG4gICAgdGhpcy5fd2FrZVBvb2xlZFNsb3RXYWl0ZXJzKClcbiAgfVxuXG4gIC8qKlxuICAgKiBGb3J3YXJkcyBvbmUgcG9vbGVkIGNoaWxkJ3MgYWNjZXB0YW5jZSBvYnNlcnZhdGlvbiB0byBtYWluIGFzIGEgYm91bmRlZFxuICAgKiBkaWFnbm9zdGljIHJlcG9ydC4gVGhlIGNoaWxkIGNhcnJpZXMgaXRzIGV4YWN0IGhhbmRvZmYgbGVhc2UsIHNvIGEgdGltZW91dFxuICAgKiBvciBvdXRjb21lIHRoYXQgYWxyZWFkeSBzZXR0bGVkIHRoZSB3b3JrZXIncyBpbi1mbGlnaHQgZW50cnkgY2Fubm90IGxvc2VcbiAgICogdGhlIGZlbmNpbmcuIEEgcmVwb3J0IHRoYXQgbmV2ZXIgbGFuZHMgZGVncmFkZXMgcGhhc2UgZGlhZ25vc3RpY3MgZm9yIHRoYXRcbiAgICogam9iIG9ubHkg4oCUIGl0IG11c3QgbmV2ZXIgYmxvY2sgb3IgZmFpbCB0aGUgam9iIGl0c2VsZi5cbiAgICogQHBhcmFtIHt7dHlwZTogXCJqb2ItcmVjZWl2ZWRcIiB8IFwiam9iLXN0YXJ0ZWRcIiwgam9iSWQ6IHN0cmluZywgaGFuZG9mZklkPzogc3RyaW5nLCB3b3JrZXJJZD86IHN0cmluZywgaGFuZGVkT2ZmQXRNcz86IG51bWJlciwgcmVjZWl2ZWRBdE1zPzogbnVtYmVyLCBzdGFydGVkQXRNcz86IG51bWJlciwgY2hpbGRJbnN0YW5jZUlkPzogc3RyaW5nLCBjaGlsZFBpZD86IG51bWJlcn19IG1lc3NhZ2UgLSBWYWxpZGF0ZWQgY2hpbGQgYWNjZXB0YW5jZSBtZXNzYWdlLlxuICAgKiBAcmV0dXJucyB7dm9pZH1cbiAgICovXG4gIF9yZXBvcnRDaGlsZEFjY2VwdGVkKG1lc3NhZ2UpIHtcbiAgICBpZiAoIXRoaXMuc3RhdHVzUmVwb3J0ZXIpIHJldHVyblxuXG4gICAgdm9pZCB0aGlzLnN0YXR1c1JlcG9ydGVyLnJlcG9ydENoaWxkQWNjZXB0ZWRXaXRoUmV0cnkoe1xuICAgICAgam9iSWQ6IG1lc3NhZ2Uuam9iSWQsXG4gICAgICBoYW5kb2ZmSWQ6IG1lc3NhZ2UuaGFuZG9mZklkLFxuICAgICAgd29ya2VySWQ6IG1lc3NhZ2Uud29ya2VySWQsXG4gICAgICBoYW5kZWRPZmZBdE1zOiBtZXNzYWdlLmhhbmRlZE9mZkF0TXMsXG4gICAgICByZWNlaXZlZEF0TXM6IG1lc3NhZ2UucmVjZWl2ZWRBdE1zLFxuICAgICAgc3RhcnRlZEF0TXM6IG1lc3NhZ2Uuc3RhcnRlZEF0TXMsXG4gICAgICBjaGlsZEluc3RhbmNlSWQ6IG1lc3NhZ2UuY2hpbGRJbnN0YW5jZUlkLFxuICAgICAgY2hpbGRQaWQ6IG1lc3NhZ2UuY2hpbGRQaWQsXG4gICAgICBtYXhEdXJhdGlvbk1zOiBDSElMRF9BQ0NFUFRBTkNFX1JFUE9SVF9NQVhfRFVSQVRJT05fTVNcbiAgICB9KS5jYXRjaCgoZXJyb3IpID0+IHtcbiAgICAgIGNvbnNvbGUuZXJyb3IoXCJCYWNrZ3JvdW5kIGpvYiBjaGlsZC1hY2NlcHRhbmNlIHJlcG9ydGluZyBmYWlsZWQ6XCIsIGVycm9yKVxuICAgIH0pXG4gIH1cblxuICAvKipcbiAgICogTWFya3MgYSBwb29sZWQgY2hpbGQgZm9yIHJldGlyZW1lbnQgYW5kIOKAlCB3aGVuIHRoZSBwb29sIGlzIGJlbG93IGl0cyBoYXJkXG4gICAqIGNhcCDigJQgZWFnZXJseSBzcGF3bnMgYSBzaW5nbGUgcmVwbGFjZW1lbnQgKDEtZm9yLTEpIHNvIGl0cyBjYXBhY2l0eSBpc1xuICAgKiByZXN0b3JlZCBpbW1lZGlhdGVseSB3aXRob3V0IHdhaXRpbmcgZm9yIGl0IHRvIGZpbmlzaCBkcmFpbmluZy4gVGhlXG4gICAqIHJlcGxhY2VtZW50IHNwYXduIGlzIGdhdGVkIGJ5IHRoZSBjYXAgKHRoZSByZXRpcmluZyBjaGlsZCBzdGlsbCBjb3VudHMgYXNcbiAgICogbGl2ZSB1bnRpbCBpdCBleGl0cyksIHNvIGEgZnVsbCBwb29sIHNpbXBseSBkZWZlcnMgdGhlIHJlcGxhY2VtZW50IHRvIHRoZVxuICAgKiByZXRpcmluZyBjaGlsZCdzIGRyYWluIGluc3RlYWQgb2Ygc3Bhd25pbmcgb3ZlciBjYXBhY2l0eS4gVGhlIHJldGlyaW5nXG4gICAqIGNoaWxkIHN0b3BzIHJlY2VpdmluZyBuZXcgam9icyBhbmQgaXMgdGVybWluYXRlZCBvbmx5IG9uY2UgaXRzIGluLWZsaWdodFxuICAgKiBzZXQgZHJhaW5zLCBzbyBhIGxvbmctcnVubmluZyBqb2IgKGUuZy4gYSBidWlsZCkgaXMgbmV2ZXIgY3V0IG9mZi5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCJub2RlOmNoaWxkX3Byb2Nlc3NcIikuQ2hpbGRQcm9jZXNzfSBjaGlsZCAtIENoaWxkIHRvIHJldGlyZS5cbiAgICogQHJldHVybnMge3ZvaWR9XG4gICAqL1xuICBfYmVnaW5SZXRpcmVQb29sZWRDaGlsZChjaGlsZCkge1xuICAgIGNvbnN0IHN0YXRlID0gdGhpcy5wb29sZWRDaGlsZFN0YXRlcy5nZXQoY2hpbGQpXG4gICAgaWYgKCFzdGF0ZSB8fCBzdGF0ZS5yZXRpcmluZykgcmV0dXJuXG5cbiAgICBzdGF0ZS5yZXRpcmluZyA9IHRydWVcbiAgICAvLyBCZXN0LWVmZm9ydCBwcmUtd2FybTogc2tpcCB3aGVuIHN0b3BwaW5nIChubyBuZXcgd29yaykgb3IgYmVmb3JlIHRoZVxuICAgIC8vIHdvcmtlciBpcyBpbml0aWFsaXplZCAobm8gY29uZmlndXJhdGlvbiB0byBmb3JrIGEgY2hpbGQgZnJvbSkuIFRoZSBjYXBcbiAgICAvLyBpbnNpZGUgX2NyZWF0ZVBvb2xlZENoaWxkIHJlZnVzZXMgdGhlIHNwYXduIHdoaWxlIHRoZSBwb29sIGlzIGZ1bGwsIGluXG4gICAgLy8gd2hpY2ggY2FzZSB0aGUgcmVwbGFjZW1lbnQgaXMgZGVmZXJyZWQgdG8gdGhlIGRyYWluIHBhdGguXG4gICAgaWYgKCF0aGlzLnNob3VsZFN0b3AgJiYgdGhpcy5jb25maWd1cmF0aW9uKSB0aGlzLl9jcmVhdGVQb29sZWRDaGlsZCgpXG4gIH1cblxuICAvKipcbiAgICogVGVybWluYXRlcyBhIHJldGlyaW5nIHBvb2xlZCBjaGlsZCBvbmNlIGl0IGhhcyBubyBpbi1mbGlnaHQgam9icyBsZWZ0LlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIm5vZGU6Y2hpbGRfcHJvY2Vzc1wiKS5DaGlsZFByb2Nlc3N9IGNoaWxkIC0gQ2hpbGQgdG8gY2hlY2suXG4gICAqIEByZXR1cm5zIHt2b2lkfVxuICAgKi9cbiAgX3Rlcm1pbmF0ZUlmRHJhaW5lZChjaGlsZCkge1xuICAgIGNvbnN0IHN0YXRlID0gdGhpcy5wb29sZWRDaGlsZFN0YXRlcy5nZXQoY2hpbGQpXG4gICAgaWYgKCFzdGF0ZSB8fCAhc3RhdGUucmV0aXJpbmcgfHwgc3RhdGUuaW5mbGlnaHQuc2l6ZSA+IDApIHJldHVyblxuXG4gICAgdGhpcy5fcmV0aXJlUG9vbGVkQ2hpbGQoY2hpbGQpXG4gIH1cblxuICAvKipcbiAgICogUmV0aXJlcyBhIGRyYWluZWQgcG9vbGVkIGNoaWxkIChyZW1vdmVzIGl0IGZyb20gdHJhY2tpbmcsIHRoZW4gU0lHVEVSTXMgaXQpLlxuICAgKiBCZWNhdXNlIHRoZSBoYXJkIGNhcCBjb3VudHMgbGl2ZSBjaGlsZHJlbiwgdGhlIGV4aXQgb2YgdGhpcyBjaGlsZCBmcmVlcyBhXG4gICAqIHNsb3Q6IGFueSBkZWZlcnJlZCByZXBsYWNlbWVudCAodGhlIHBvb2wgd2FzIGZ1bGwgd2hlbiB0aGUgY2hpbGQgcmV0aXJlZClcbiAgICogaXMgc3Bhd25lZCBub3csIGFuZCBjYXBhY2l0eSBpcyByZS1hZHZlcnRpc2VkIHNvIG1haW4gY2FuIGRpc3BhdGNoIGludG8gaXQuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwibm9kZTpjaGlsZF9wcm9jZXNzXCIpLkNoaWxkUHJvY2Vzc30gY2hpbGQgLSBDaGlsZCBwcm9jZXNzIHRvIHJldGlyZS5cbiAgICogQHJldHVybnMge3ZvaWR9XG4gICAqL1xuICBfcmV0aXJlUG9vbGVkQ2hpbGQoY2hpbGQpIHtcbiAgICBjb25zdCBzdGF0ZSA9IHRoaXMucG9vbGVkQ2hpbGRTdGF0ZXMuZ2V0KGNoaWxkKVxuICAgIGlmICghc3RhdGUpIHRocm93IG5ldyBFcnJvcihcIkNhbm5vdCByZXRpcmUgcG9vbGVkIGNoaWxkIHdpdGhvdXQgdHJhY2tlZCBzdGF0ZVwiKVxuICAgIGlmIChzdGF0ZS5pbmZsaWdodC5zaXplID4gMCkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKGBDYW5ub3QgcmV0aXJlIHBvb2xlZCBjaGlsZCB3aGlsZSAke3N0YXRlLmluZmxpZ2h0LnNpemV9ICR7c3RhdGUuaW5mbGlnaHQuc2l6ZSA9PT0gMSA/IFwiam9iIHJlbWFpbnNcIiA6IFwiam9icyByZW1haW5cIn0gaW4gZmxpZ2h0YClcbiAgICB9XG5cbiAgICB0aGlzLnBvb2xlZENoaWxkcmVuLmRlbGV0ZShjaGlsZClcbiAgICBzdGF0ZS5yZXRpcmluZyA9IHRydWVcbiAgICB0aGlzLl9yZXF1ZXN0UG9vbGVkQ2hpbGRTaHV0ZG93bih7Y2hpbGQsIHJlYXNvbjogXCJwYXJlbnRfcmV0aXJlX2RyYWluZWRcIiwgc2lnbmFsOiBcIlNJR1RFUk1cIiwgd2FpdEZvck9ic2VydmF0aW9uOiB0cnVlfSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSZWNvcmRzIGFuIGV4YWN0IHBhcmVudCByZXF1ZXN0IGJlZm9yZSBJUEMgb3Igc2lnbmFsIGRlbGl2ZXJ5LiBEcmFpbmVkXG4gICAqIHJldGlyZW1lbnQgZ2V0cyBhIGJyaWVmIElQQy1maXJzdCBncmFjZSBzbyBpdHMgemVyby1qb2Igb2JzZXJ2YXRpb24gaXNcbiAgICogZGV0ZXJtaW5pc3RpYzsgdGltZW91dC93b3JrZXItc3RvcCBwYXRocyBzaWduYWwgaW1tZWRpYXRlbHkuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gU2h1dGRvd24gcmVxdWVzdC5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCJub2RlOmNoaWxkX3Byb2Nlc3NcIikuQ2hpbGRQcm9jZXNzfSBhcmdzLmNoaWxkIC0gUG9vbGVkIGNoaWxkLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vdHlwZXMuanNcIikuUG9vbGVkQ2hpbGRTaHV0ZG93blJlYXNvbn0gYXJncy5yZWFzb24gLSBFeGFjdCBwYXJlbnQgcmVhc29uLlxuICAgKiBAcGFyYW0ge2tleW9mIHR5cGVvZiBpbXBvcnQoXCJub2RlOm9zXCIpLmNvbnN0YW50cy5zaWduYWxzfSBhcmdzLnNpZ25hbCAtIFNpZ25hbCB0byBkZWxpdmVyLlxuICAgKiBAcGFyYW0ge2Jvb2xlYW59IFthcmdzLndhaXRGb3JPYnNlcnZhdGlvbl0gLSBXaGV0aGVyIElQQyBvYnNlcnZhdGlvbiBtYXkgcHJlY2VkZSBzaWduYWwgZmFsbGJhY2suXG4gICAqIEByZXR1cm5zIHt2b2lkfVxuICAgKi9cbiAgX3JlcXVlc3RQb29sZWRDaGlsZFNodXRkb3duKHtjaGlsZCwgcmVhc29uLCBzaWduYWwsIHdhaXRGb3JPYnNlcnZhdGlvbiA9IGZhbHNlfSkge1xuICAgIGNvbnN0IHN0YXRlID0gdGhpcy5wb29sZWRDaGlsZFN0YXRlcy5nZXQoY2hpbGQpXG4gICAgaWYgKCFzdGF0ZSB8fCBzdGF0ZS5zZXR0bGluZyB8fCBzdGF0ZS5zaHV0ZG93blJlYXNvbikgcmV0dXJuXG5cbiAgICBjb25zdCBzaHV0ZG93blJlcXVlc3RlZEF0TXMgPSBEYXRlLm5vdygpXG4gICAgc3RhdGUuc2h1dGRvd25SZWFzb24gPSByZWFzb25cbiAgICBzdGF0ZS5zaHV0ZG93blJlcXVlc3RlZEF0TXMgPSBzaHV0ZG93blJlcXVlc3RlZEF0TXNcbiAgICBzdGF0ZS5zaHV0ZG93blNpZ25hbCA9IHNpZ25hbFxuXG4gICAgbGV0IHJlcXVlc3RTZW50ID0gZmFsc2VcbiAgICBpZiAoY2hpbGQuY29ubmVjdGVkKSB7XG4gICAgICB0cnkge1xuICAgICAgICBjaGlsZC5zZW5kKHt0eXBlOiBcInNodXRkb3duLXJlcXVlc3RcIiwgcmVhc29uLCBzaHV0ZG93blJlcXVlc3RlZEF0TXMsIHNpZ25hbH0sIChlcnJvcikgPT4ge1xuICAgICAgICAgIGlmICghZXJyb3IgfHwgIXdhaXRGb3JPYnNlcnZhdGlvbiB8fCBzdGF0ZS5zZXR0bGluZykgcmV0dXJuXG5cbiAgICAgICAgICBpZiAoc3RhdGUuc2h1dGRvd25TaWduYWxUaW1lcikge1xuICAgICAgICAgICAgY2xlYXJUaW1lb3V0KHN0YXRlLnNodXRkb3duU2lnbmFsVGltZXIpXG4gICAgICAgICAgICBzdGF0ZS5zaHV0ZG93blNpZ25hbFRpbWVyID0gdW5kZWZpbmVkXG4gICAgICAgICAgfVxuICAgICAgICAgIHRoaXMuX3NpZ25hbFBvb2xlZENoaWxkKHtjaGlsZCwgc2lnbmFsfSlcbiAgICAgICAgfSlcbiAgICAgICAgcmVxdWVzdFNlbnQgPSB0cnVlXG4gICAgICB9IGNhdGNoIHtcbiAgICAgICAgLy8gVGhlIHNpZ25hbCBiZWxvdyByZW1haW5zIHRoZSBib3VuZGVkIHNodXRkb3duIG1lY2hhbmlzbS5cbiAgICAgIH1cbiAgICB9XG5cbiAgICBpZiAod2FpdEZvck9ic2VydmF0aW9uICYmIHJlcXVlc3RTZW50KSB7XG4gICAgICBzdGF0ZS5zaHV0ZG93blNpZ25hbFRpbWVyID0gc2V0VGltZW91dCgoKSA9PiB7XG4gICAgICAgIHN0YXRlLnNodXRkb3duU2lnbmFsVGltZXIgPSB1bmRlZmluZWRcbiAgICAgICAgdGhpcy5fc2lnbmFsUG9vbGVkQ2hpbGQoe2NoaWxkLCBzaWduYWx9KVxuICAgICAgfSwgUE9PTEVEX1JVTk5FUl9TSFVURE9XTl9SRVFVRVNUX0dSQUNFX01TKVxuICAgICAgc3RhdGUuc2h1dGRvd25TaWduYWxUaW1lci51bnJlZigpXG4gICAgICByZXR1cm5cbiAgICB9XG5cbiAgICB0aGlzLl9zaWduYWxQb29sZWRDaGlsZCh7Y2hpbGQsIHNpZ25hbH0pXG4gIH1cblxuICAvKipcbiAgICogRGVsaXZlcnMgb25lIHBhcmVudC1vd25lZCBwcm9jZXNzIHNpZ25hbCB3aXRob3V0IGNoYW5naW5nIHJlY29yZGVkIHByb3ZlbmFuY2UuXG4gICAqIEBwYXJhbSB7e2NoaWxkOiBpbXBvcnQoXCJub2RlOmNoaWxkX3Byb2Nlc3NcIikuQ2hpbGRQcm9jZXNzLCBzaWduYWw6IGtleW9mIHR5cGVvZiBpbXBvcnQoXCJub2RlOm9zXCIpLmNvbnN0YW50cy5zaWduYWxzfX0gYXJncyAtIFNpZ25hbCByZXF1ZXN0LlxuICAgKiBAcmV0dXJucyB7dm9pZH1cbiAgICovXG4gIF9zaWduYWxQb29sZWRDaGlsZCh7Y2hpbGQsIHNpZ25hbH0pIHtcbiAgICB0cnkge1xuICAgICAgY2hpbGQua2lsbChzaWduYWwpXG4gICAgfSBjYXRjaCB7XG4gICAgICAvLyBDaGlsZCBhbHJlYWR5IGV4aXRlZDsgaXRzIGV4aXQvZXJyb3IgaGFuZGxlciBvd25zIHN0YXRlIHNldHRsZW1lbnQuXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIFJlbW92ZXMgYW4gZXhpdGVkL3VuaGVhbHRoeSBwb29sZWQgY2hpbGQgYW5kIHJlcG9ydHMgZXZlcnkgam9iIHRoYXQgd2FzXG4gICAqIGluLWZsaWdodCBvbiBpdCBhcyBmYWlsZWQg4oCUIGEgcHJvY2Vzcy1sZXZlbCBjcmFzaCdzIGJsYXN0IHJhZGl1cyBpcyB0aGVcbiAgICogY2hpbGQncyB3aG9sZSBpbi1mbGlnaHQgc2V0LiBPbmNlIHRoZSBjaGlsZCBoYXMgY29tcGxldGVkIHN0YXJ0dXAsIGl0c1xuICAgKiBmcmVlZCBjYXBhY2l0eSBpcyBhZHZlcnRpc2VkIGltbWVkaWF0ZWx5OyB0aGUgcmVwbGFjZW1lbnQgaXRzZWxmIGlzIHN0aWxsXG4gICAqIHNwYXduZWQgbGF6aWx5IGJ5IHRoZSBuZXh0IGRpc3BhdGNoLiBBIGNoaWxkIHRoYXQgZXhpdHMgYmVmb3JlIGl0cyBzdGFydHVwXG4gICAqIGhhbmRzaGFrZSBkb2VzIG5vdCByZS1hbm5vdW5jZSwgYXZvaWRpbmcgYSB0aWdodCByZXNwYXduIGxvb3Agb24gc3RhcnR1cFxuICAgKiBmYWlsdXJlLlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIEZhaWx1cmUgZGV0YWlscy5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCJub2RlOmNoaWxkX3Byb2Nlc3NcIikuQ2hpbGRQcm9jZXNzfSBhcmdzLmNoaWxkIC0gUG9vbGVkIGNoaWxkLlxuICAgKiBAcGFyYW0ge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSBhcmdzLmVycm9yIC0gRmFpbHVyZS5cbiAgICogQHBhcmFtIHtudW1iZXIgfCBudWxsfSBbYXJncy5leGl0Q29kZV0gLSBDaGlsZCBleGl0IGNvZGUgd2hlbiBvYnNlcnZlZC5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL3R5cGVzLmpzXCIpLlBvb2xlZFJ1bm5lckZhaWx1cmVPcmlnaW59IFthcmdzLm9yaWdpbl0gLSBXb3JrZXIgb2JzZXJ2YXRpb24gdGhhdCBpbml0aWF0ZWQgcmVjb3ZlcnkuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwibm9kZTpjaGlsZF9wcm9jZXNzXCIpLkNoaWxkUHJvY2Vzc1tcInNpZ25hbENvZGVcIl19IFthcmdzLnNpZ25hbF0gLSBDaGlsZCB0ZXJtaW5hdGlvbiBzaWduYWwgd2hlbiBvYnNlcnZlZC5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59XG4gICAqL1xuICBhc3luYyBfaGFuZGxlUG9vbGVkQ2hpbGRGYWlsdXJlKHtjaGlsZCwgZXJyb3IsIGV4aXRDb2RlID0gbnVsbCwgb3JpZ2luID0gXCJwcm9jZXNzLWVycm9yXCIsIHNpZ25hbCA9IG51bGx9KSB7XG4gICAgY29uc3Qgc3RhdGUgPSB0aGlzLnBvb2xlZENoaWxkU3RhdGVzLmdldChjaGlsZClcbiAgICBpZiAoc3RhdGU/LnNldHRsaW5nKSByZXR1cm5cbiAgICBpZiAoc3RhdGUpIHtcbiAgICAgIHN0YXRlLnNldHRsaW5nID0gdHJ1ZVxuICAgICAgLy8gQ2FuY2VsIHRoaXMgY2hpbGQncyBwZW5kaW5nIHRpbWVycyBiZWZvcmUgaXRzIGluLWZsaWdodCBzZXQgaXMgcmVwb3J0ZWQg4oCUXG4gICAgICAvLyB0aGUgU0lHS0lMTCBncmFjZSBmcm9tIGEgdGltZW91dCBraWxsLCBhbmQgZXZlcnkgYXJtZWQgcGVyLWpvYiBiYWNrc3RvcC5cbiAgICAgIGlmIChzdGF0ZS50aW1lb3V0U2lna2lsbFRpbWVyKSBjbGVhclRpbWVvdXQoc3RhdGUudGltZW91dFNpZ2tpbGxUaW1lcilcbiAgICAgIGlmIChzdGF0ZS5zaHV0ZG93blNpZ25hbFRpbWVyKSBjbGVhclRpbWVvdXQoc3RhdGUuc2h1dGRvd25TaWduYWxUaW1lcilcbiAgICAgIGZvciAoY29uc3QgaW5mbGlnaHRFbnRyeSBvZiBzdGF0ZS5pbmZsaWdodC52YWx1ZXMoKSkge1xuICAgICAgICBpZiAoaW5mbGlnaHRFbnRyeS50aW1lb3V0VGltZXIpIGNsZWFyVGltZW91dChpbmZsaWdodEVudHJ5LnRpbWVvdXRUaW1lcilcbiAgICAgIH1cbiAgICB9XG4gICAgdGhpcy5wb29sZWRDaGlsZHJlbi5kZWxldGUoY2hpbGQpXG4gICAgdGhpcy5pbmZsaWdodFByb2Nlc3NDaGlsZHJlbi5kZWxldGUoY2hpbGQpXG4gICAgLy8gQ2hpbGQgZXhpdCBmcmVlcyBhIGhhcmQtY2FwIHNsb3QgZXZlbiB3aGlsZSBpdHMgaW4tZmxpZ2h0IHNldCBpcyBzdGlsbFxuICAgIC8vIGJlaW5nIHJlcG9ydGVkIOKAlCB3YWtlIHdhaXRlcnMgbm93OyB0aGVpciByZXBvcnRzIHNldHRsZSBpbmRlcGVuZGVudGx5LlxuICAgIHRoaXMuX3dha2VQb29sZWRTbG90V2FpdGVycygpXG5cbiAgICBjb25zdCBlbnRyaWVzID0gc3RhdGUgPyBbLi4uc3RhdGUuaW5mbGlnaHQudmFsdWVzKCldIDogW11cbiAgICBjb25zdCBydW5uZXJGYWlsdXJlID0gc3RhdGVcbiAgICAgID8gdGhpcy5fcG9vbGVkUnVubmVyRmFpbHVyZSh7Y2hpbGQsIGV4aXRDb2RlLCBvcmlnaW4sIHNpZ25hbCwgc3RhdGV9KVxuICAgICAgOiB1bmRlZmluZWRcbiAgICBpZiAoc3RhdGUpIHN0YXRlLmluZmxpZ2h0LmNsZWFyKClcbiAgICB0aGlzLnBvb2xlZENoaWxkU3RhdGVzLmRlbGV0ZShjaGlsZClcblxuICAgIGNvbnN0IGZhaWx1cmVSZXBvcnRzID0gZW50cmllcy5tYXAoYXN5bmMgKGVudHJ5KSA9PiB7XG4gICAgICBhd2FpdCB0aGlzLl9yZXBvcnRKb2JSZXN1bHQoe1xuICAgICAgICBqb2JJZDogZW50cnkucGF5bG9hZC5pZCxcbiAgICAgICAgc3RhdHVzOiBcImZhaWxlZFwiLFxuICAgICAgICBlcnJvcixcbiAgICAgICAgaGFuZG9mZklkOiBlbnRyeS5wYXlsb2FkLmhhbmRvZmZJZCxcbiAgICAgICAgaGFuZGVkT2ZmQXRNczogZW50cnkucGF5bG9hZC5oYW5kZWRPZmZBdE1zLFxuICAgICAgICBydW5uZXJGYWlsdXJlLFxuICAgICAgICB3b3JrZXJJZDogZW50cnkucGF5bG9hZC53b3JrZXJJZCB8fCB0aGlzLndvcmtlcklkXG4gICAgICB9KVxuICAgICAgaWYgKGVudHJ5LnJlc29sdmUpIGVudHJ5LnJlc29sdmUodW5kZWZpbmVkKVxuICAgIH0pXG5cbiAgICAvLyBTdGFydCBldmVyeSBmYWxsYmFjayByZXBvcnQgYmVmb3JlIGFubm91bmNpbmcgY2FwYWNpdHkgc28gdGhlIG1haW4gY2Fubm90XG4gICAgLy8gb2JzZXJ2ZSBhIHJlcGxhY2VtZW50IHNsb3QgYmVmb3JlIHRoZSBmYWlsZWQgam9icycgcmVwb3J0cyBhcmUgaW4gZmxpZ2h0LlxuICAgIC8vIFRoZSByZXBvcnQgcHJvbWlzZXMgcmVtYWluIHRyYWNrZWQgYmVsb3c7IGEgc2xvdyByZXRyeSBtdXN0IG5vdCBob2xkIHRoZVxuICAgIC8vIG5ld2x5IGZyZWVkIHJ1bm5lciBjYXBhY2l0eSBob3N0YWdlLlxuICAgIC8vIEEgZHJhaW5lZCByZXRpcmVtZW50IGFscmVhZHkgYWR2ZXJ0aXNlZCBpdHMgcmVwbGFjZW1lbnQgY2FwYWNpdHkgd2hlblxuICAgIC8vIHRoZSBmaW5hbCBqb2IgY29tcGxldGVkLiBSZS1hZHZlcnRpc2luZyBoZXJlIGNhbiByZXN0b3JlIGEgY3JlZGl0IG1haW5cbiAgICAvLyBjb25zdW1lZCBiZWZvcmUgaXRzIGhhbmRvZmYgcmVhY2hlZCB0aGUgcmVwbGFjZW1lbnQgY2hpbGQuXG4gICAgaWYgKHN0YXRlPy5zaHV0ZG93blJlYXNvbiAhPT0gXCJwYXJlbnRfcmV0aXJlX2RyYWluZWRcIikge1xuICAgICAgaWYgKHN0YXRlICYmIHN0YXRlLnN0YXJ0ZWQgIT09IGZhbHNlKSB7XG4gICAgICAgIHRoaXMuX3NlbmRSZWFkeUlmUnVubmluZygpXG4gICAgICB9IGVsc2UgaWYgKHN0YXRlKSB7XG4gICAgICAgIGZvciAoY29uc3QgZW50cnkgb2YgZW50cmllcykge1xuICAgICAgICAgIGlmIChlbnRyeS5wb29sZWRKb2IpIHRoaXMuX3Bvb2xlZFN0YXJ0dXBGYWlsdXJlSm9icy5hZGQoZW50cnkucG9vbGVkSm9iKVxuICAgICAgICAgIGNvbnN0IHF1ZXVlVHJhY2tlciA9IHRoaXMucG9vbGVkSm9iUXVldWVUcmFja2Vycy5nZXQoZW50cnkucGF5bG9hZC5pZClcbiAgICAgICAgICBpZiAocXVldWVUcmFja2VyKSB0aGlzLl9wb29sZWRTdGFydHVwRmFpbHVyZUpvYnMuYWRkKHF1ZXVlVHJhY2tlcilcbiAgICAgICAgfVxuICAgICAgICAvLyBBIHByZXZpb3VzIHJlYWR5IG1lc3NhZ2UgbWF5IHN0aWxsIGhhdmUgdW5jb25zdW1lZCBwb29sZWQgY3JlZGl0cyBhdCB0aGVcbiAgICAgICAgLy8gbWFpbi4gUmV2b2tlIHRoZW0gYXV0aG9yaXRhdGl2ZWx5IHdpdGhvdXQgc3VwcHJlc3NpbmcgdmFsaWQgaW5saW5lIG9yXG4gICAgICAgIC8vIHByb2Nlc3MtcnVubmVyIHJlYWRpbmVzczsgb3RoZXJ3aXNlIHF1ZXVlZCBqb2JzIGNhbiB0cmlnZ2VyIGEgc3RhcnR1cFxuICAgICAgICAvLyBjcmFzaCBsb29wIHVzaW5nIHRoZSBzdGFsZSBjcmVkaXRzLlxuICAgICAgICB0aGlzLl9zZW5kUmVhZHlJZlJ1bm5pbmcoe3Jldm9rZVBvb2xlZEFkbWlzc2lvbjogdHJ1ZX0pXG4gICAgICB9XG4gICAgfVxuXG4gICAgYXdhaXQgUHJvbWlzZS5hbGxTZXR0bGVkKGZhaWx1cmVSZXBvcnRzKVxuICB9XG5cbiAgLyoqXG4gICAqIENhcHR1cmVzIG9uZSBzdGFibGUgcHJvY2VzcyBzbmFwc2hvdCBiZWZvcmUgdGhlIGZhaWxlZCBjaGlsZCdzIHN0YXRlIGlzIHJlbW92ZWQuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gRmFpbHVyZSBkZXRhaWxzLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIm5vZGU6Y2hpbGRfcHJvY2Vzc1wiKS5DaGlsZFByb2Nlc3N9IGFyZ3MuY2hpbGQgLSBGYWlsZWQgcG9vbGVkIGNoaWxkLlxuICAgKiBAcGFyYW0ge251bWJlciB8IG51bGx9IGFyZ3MuZXhpdENvZGUgLSBDaGlsZCBleGl0IGNvZGUgd2hlbiBvYnNlcnZlZC5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL3R5cGVzLmpzXCIpLlBvb2xlZFJ1bm5lckZhaWx1cmVPcmlnaW59IGFyZ3Mub3JpZ2luIC0gV29ya2VyIG9ic2VydmF0aW9uIHRoYXQgaW5pdGlhdGVkIHJlY292ZXJ5LlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIm5vZGU6Y2hpbGRfcHJvY2Vzc1wiKS5DaGlsZFByb2Nlc3NbXCJzaWduYWxDb2RlXCJdfSBhcmdzLnNpZ25hbCAtIENoaWxkIHRlcm1pbmF0aW9uIHNpZ25hbCB3aGVuIG9ic2VydmVkLlxuICAgKiBAcGFyYW0ge1Bvb2xlZENoaWxkU3RhdGV9IGFyZ3Muc3RhdGUgLSBDaGlsZCBzdGF0ZSBpbW1lZGlhdGVseSBiZWZvcmUgcmVjb3ZlcnkuXG4gICAqIEByZXR1cm5zIHtpbXBvcnQoXCIuL3R5cGVzLmpzXCIpLlBvb2xlZFJ1bm5lckZhaWx1cmV9IC0gU2hhcmVkIGZhaWx1cmUgcHJvdmVuYW5jZS5cbiAgICovXG4gIF9wb29sZWRSdW5uZXJGYWlsdXJlKHtjaGlsZCwgZXhpdENvZGUsIG9yaWdpbiwgc2lnbmFsLCBzdGF0ZX0pIHtcbiAgICBjb25zdCBvYnNlcnZhdGlvbiA9IHN0YXRlLnNodXRkb3duT2JzZXJ2YXRpb25cbiAgICBsZXQgc2h1dGRvd25SZWFzb24gPSBzdGF0ZS5zaHV0ZG93blJlYXNvbiA/PyBvYnNlcnZhdGlvbj8ucmVhc29uXG4gICAgaWYgKCFzaHV0ZG93blJlYXNvbikge1xuICAgICAgaWYgKG9yaWdpbiA9PT0gXCJwcm9jZXNzLWVycm9yXCIgfHwgb3JpZ2luID09PSBcImlwYy1zZW5kXCIpIHtcbiAgICAgICAgc2h1dGRvd25SZWFzb24gPSBcInByb2Nlc3NfZXJyb3JcIlxuICAgICAgfSBlbHNlIGlmIChzaWduYWwgPT09IFwiU0lHVEVSTVwiKSB7XG4gICAgICAgIHNodXRkb3duUmVhc29uID0gXCJzaWduYWxfc2lndGVybVwiXG4gICAgICB9IGVsc2UgaWYgKHNpZ25hbCA9PT0gXCJTSUdJTlRcIikge1xuICAgICAgICBzaHV0ZG93blJlYXNvbiA9IFwic2lnbmFsX3NpZ2ludFwiXG4gICAgICB9IGVsc2UgaWYgKHNpZ25hbCA9PT0gXCJTSUdLSUxMXCIpIHtcbiAgICAgICAgc2h1dGRvd25SZWFzb24gPSBcInNpZ25hbF9zaWdraWxsXCJcbiAgICAgIH0gZWxzZSBpZiAoc2lnbmFsKSB7XG4gICAgICAgIHNodXRkb3duUmVhc29uID0gXCJzaWduYWxfb3RoZXJcIlxuICAgICAgfSBlbHNlIGlmIChzdGF0ZS5pcGNEaXNjb25uZWN0ZWRBdE1zICYmIGV4aXRDb2RlID09PSAwKSB7XG4gICAgICAgIHNodXRkb3duUmVhc29uID0gXCJpcGNfZGlzY29ubmVjdFwiXG4gICAgICB9IGVsc2Uge1xuICAgICAgICBzaHV0ZG93blJlYXNvbiA9IFwidW5leHBlY3RlZF9leGl0XCJcbiAgICAgIH1cbiAgICB9XG4gICAgY29uc3QgdGVybWluYXRpb25SZWFzb24gPSBzaHV0ZG93blJlYXNvbiA9PT0gXCJqb2JfdGltZW91dFwiXG4gICAgICA/IFwiam9iLXRpbWVvdXRcIlxuICAgICAgOiBzaHV0ZG93blJlYXNvbiA9PT0gXCJ3b3JrZXJfc3RvcFwiID8gXCJ3b3JrZXItc2h1dGRvd24tdGltZW91dFwiIDogXCJ1bmV4cGVjdGVkXCJcbiAgICBjb25zdCB3b3JrZXJMaWZlY3ljbGUgPSB0aGlzLnNob3VsZFN0b3AgPyBcInN0b3BwaW5nXCIgOiB0aGlzLmlzUmV0aXJpbmcgPyBcInJldGlyaW5nXCIgOiBcInJ1bm5pbmdcIlxuICAgIGNvbnN0IHJ1bm5lckxpZmVjeWNsZSA9IHN0YXRlLnN0YXJ0ZWQgPT09IGZhbHNlID8gXCJzdGFydGluZ1wiIDogc3RhdGUucmV0aXJpbmcgPyBcInJldGlyaW5nXCIgOiBcInJ1bm5pbmdcIlxuICAgIGNvbnN0IGJvdW5kZWRJbmZsaWdodCA9IGJvdW5kZWRQb29sZWRSdW5uZXJJbmZsaWdodEpvYklkcyhzdGF0ZS5pbmZsaWdodC5rZXlzKCkpXG4gICAgY29uc3QgYWN0aXZlSm9icyA9IFsuLi5zdGF0ZS5pbmZsaWdodC52YWx1ZXMoKV1cbiAgICAgIC5tYXAoKGVudHJ5KSA9PiAoe1xuICAgICAgICBoYW5kb2ZmSWQ6IGVudHJ5LnBheWxvYWQuaGFuZG9mZklkID8/IG51bGwsXG4gICAgICAgIGhhbmRlZE9mZkF0TXM6IGVudHJ5LnBheWxvYWQuaGFuZGVkT2ZmQXRNcyA/PyBudWxsLFxuICAgICAgICBqb2JJZDogZW50cnkucGF5bG9hZC5pZCxcbiAgICAgICAgam9iTmFtZTogZW50cnkucGF5bG9hZC5qb2JOYW1lLFxuICAgICAgICB3b3JrZXJJZDogZW50cnkucGF5bG9hZC53b3JrZXJJZCA/PyB0aGlzLndvcmtlcklkXG4gICAgICB9KSlcbiAgICAgIC5zb3J0KChsZWZ0LCByaWdodCkgPT4gbGVmdC5qb2JJZC5sb2NhbGVDb21wYXJlKHJpZ2h0LmpvYklkKSlcblxuICAgIHJldHVybiBPYmplY3QuZnJlZXplKHtcbiAgICAgIGFjdGl2ZUpvYnMsXG4gICAgICBjaGlsZEluc3RhbmNlSWQ6IHN0YXRlLmNoaWxkSW5zdGFuY2VJZCA/PyBvYnNlcnZhdGlvbj8uY2hpbGRJbnN0YW5jZUlkID8/IG51bGwsXG4gICAgICBleGl0Q29kZSxcbiAgICAgIGdlbmVyYXRpb25JZDogdGhpcy5nZW5lcmF0aW9uSWQgPz8gbnVsbCxcbiAgICAgIC4uLmJvdW5kZWRJbmZsaWdodCxcbiAgICAgIG9vbUtpbGxlZDogc2lnbmFsID09PSBcIlNJR0tJTExcIiAmJiBzaHV0ZG93blJlYXNvbiA9PT0gXCJzaWduYWxfc2lna2lsbFwiID8gbnVsbCA6IGZhbHNlLFxuICAgICAgb3JpZ2luLFxuICAgICAgcnVubmVyQWdlTXM6IE1hdGgubWF4KDAsIERhdGUubm93KCkgLSBzdGF0ZS5jcmVhdGVkQXRNcyksXG4gICAgICBydW5uZXJDcmVhdGVkQXRNczogc3RhdGUuY3JlYXRlZEF0TXMsXG4gICAgICBydW5uZXJEZXRhY2hlZDogZmFsc2UsXG4gICAgICBydW5uZXJKb2JzUnVuOiBzdGF0ZS5qb2JzUnVuLFxuICAgICAgcnVubmVyTGlmZWN5Y2xlLFxuICAgICAgcnVubmVyUGlkOiBjaGlsZC5waWQgPz8gbnVsbCxcbiAgICAgIHNpZ25hbCxcbiAgICAgIHNodXRkb3duT2JzZXJ2ZWRBdE1zOiBvYnNlcnZhdGlvbj8uc2h1dGRvd25PYnNlcnZlZEF0TXMgPz8gc3RhdGUuaXBjRGlzY29ubmVjdGVkQXRNcyA/PyBudWxsLFxuICAgICAgc2h1dGRvd25SZXF1ZXN0ZWRBdE1zOiBzdGF0ZS5zaHV0ZG93blJlcXVlc3RlZEF0TXMgPz8gb2JzZXJ2YXRpb24/LnNodXRkb3duUmVxdWVzdGVkQXRNcyA/PyBudWxsLFxuICAgICAgc2h1dGRvd25SZWFzb24sXG4gICAgICBzaHV0ZG93blNpZ25hbDogc3RhdGUuc2h1dGRvd25TaWduYWwgPz8gb2JzZXJ2YXRpb24/LnNpZ25hbCA/PyBzaWduYWwsXG4gICAgICB0ZXJtaW5hdGlvblJlYXNvbixcbiAgICAgIHRpbWVvdXRKb2JJZDogc3RhdGUudGltZW91dEpvYklkID8/IG51bGwsXG4gICAgICB3b3JrZXJJZDogdGhpcy53b3JrZXJJZCxcbiAgICAgIHdvcmtlckxpZmVjeWNsZSxcbiAgICAgIHdvcmtlclBpZDogcHJvY2Vzcy5waWRcbiAgICB9KVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgcnVuIGpvYiBpbmxpbmUuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi90eXBlcy5qc1wiKS5CYWNrZ3JvdW5kSm9iUGF5bG9hZH0gcGF5bG9hZCAtIFBheWxvYWQuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIHdoZW4gZG9uZS5cbiAgICovXG4gIGFzeW5jIF9ydW5Kb2JJbmxpbmUocGF5bG9hZCkge1xuICAgIGNvbnN0IGNvbmZpZ3VyYXRpb24gPSB0aGlzLmNvbmZpZ3VyYXRpb25cbiAgICBpZiAoIWNvbmZpZ3VyYXRpb24pIHRocm93IG5ldyBFcnJvcihcIkJhY2tncm91bmQgam9icyB3b3JrZXIgY29uZmlndXJhdGlvbiBub3QgaW5pdGlhbGl6ZWRcIilcblxuICAgIGNvbnN0IHJlZ2lzdHJ5ID0gbmV3IEJhY2tncm91bmRKb2JSZWdpc3RyeSh7Y29uZmlndXJhdGlvbn0pXG4gICAgYXdhaXQgcmVnaXN0cnkubG9hZCgpXG4gICAgY29uc3QgSm9iQ2xhc3MgPSByZWdpc3RyeS5nZXRKb2JCeU5hbWUocGF5bG9hZC5qb2JOYW1lKVxuICAgIGF3YWl0IHJ1bldpdGhCYWNrZ3JvdW5kSm9iUGF5bG9hZChwYXlsb2FkLCBhc3luYyAoKSA9PiB7XG4gICAgICBhd2FpdCBwZXJmb3JtQmFja2dyb3VuZEpvYih7XG4gICAgICAgIGNvbmZpZ3VyYXRpb24sXG4gICAgICAgIEpvYkNsYXNzLFxuICAgICAgICBqb2JBcmdzOiBwYXlsb2FkLmFyZ3MgfHwgW10sXG4gICAgICAgIGpvYk9wdGlvbnM6IHBheWxvYWQub3B0aW9ucyB8fCB7fSxcbiAgICAgICAgbmFtZTogYEJhY2tncm91bmQgam9iIHdvcmtlciBpbmxpbmU6ICR7cGF5bG9hZC5qb2JOYW1lfWAsXG4gICAgICAgIHBheWxvYWRcbiAgICAgIH0pXG4gICAgfSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGZvcmsgam9iLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vdHlwZXMuanNcIikuQmFja2dyb3VuZEpvYlBheWxvYWQgJiB7aWQ6IHN0cmluZ319IHBheWxvYWQgLSBQYXlsb2FkLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyB3aGVuIHRoZSBmb3JrZWQgcnVubmVyIGV4aXRzIG9yIGZvcmsgZmFpbHMuXG4gICAqL1xuICBfZm9ya0pvYihwYXlsb2FkKSB7XG4gICAgY29uc3QgY2hpbGQgPSB0aGlzLl9jcmVhdGVGb3JrZWRDaGlsZCgpXG5cbiAgICB0aGlzLmluZmxpZ2h0UHJvY2Vzc0NoaWxkcmVuLmFkZChjaGlsZClcblxuICAgIGNvbnN0IGZpbmlzaGVkID0gdGhpcy5fd2FpdEZvckZvcmtlZENoaWxkKHtjaGlsZCwgcGF5bG9hZH0pXG5cbiAgICB0aGlzLl9zZW5kRm9ya2VkUGF5bG9hZCh7Y2hpbGQsIHBheWxvYWR9KVxuXG4gICAgcmV0dXJuIGZpbmlzaGVkXG4gIH1cblxuICAvKipcbiAgICogUnVucyBjcmVhdGUgZm9ya2VkIGNoaWxkLlxuICAgKiBAcmV0dXJucyB7aW1wb3J0KFwibm9kZTpjaGlsZF9wcm9jZXNzXCIpLkNoaWxkUHJvY2Vzc30gLSBGb3JrZWQgY2hpbGQgcHJvY2Vzcy5cbiAgICovXG4gIF9jcmVhdGVGb3JrZWRDaGlsZCgpIHtcbiAgICBjb25zdCBjb25maWd1cmF0aW9uID0gdGhpcy5jb25maWd1cmF0aW9uXG4gICAgaWYgKCFjb25maWd1cmF0aW9uKSB0aHJvdyBuZXcgRXJyb3IoXCJCYWNrZ3JvdW5kIGpvYnMgd29ya2VyIGNvbmZpZ3VyYXRpb24gbm90IGluaXRpYWxpemVkXCIpXG5cbiAgICBjb25zdCBkaXJlY3RvcnkgPSBjb25maWd1cmF0aW9uLmdldERpcmVjdG9yeSgpXG4gICAgcmV0dXJuIGZvcmsoRk9SS0VEX1JVTk5FUl9FTlRSWV9QQVRILCBbXSwge1xuICAgICAgY3dkOiBkaXJlY3RvcnksXG4gICAgICBleGVjQXJndjogW10sXG4gICAgICBzdGRpbzogW1wiaWdub3JlXCIsIFwiaWdub3JlXCIsIFwiaWdub3JlXCIsIFwiaXBjXCJdLFxuICAgICAgZW52OiBPYmplY3QuYXNzaWduKHt9LCBwcm9jZXNzLmVudiwgdGhpcy5fY2hpbGRCYWNrZ3JvdW5kSm9ic0Vudmlyb25tZW50KCkpXG4gICAgfSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHdhaXQgZm9yIGZvcmtlZCBjaGlsZC5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBPcHRpb25zLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIm5vZGU6Y2hpbGRfcHJvY2Vzc1wiKS5DaGlsZFByb2Nlc3N9IGFyZ3MuY2hpbGQgLSBGb3JrZWQgY2hpbGQgcHJvY2Vzcy5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL3R5cGVzLmpzXCIpLkJhY2tncm91bmRKb2JQYXlsb2FkICYge2lkOiBzdHJpbmd9fSBhcmdzLnBheWxvYWQgLSBQYXlsb2FkLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyB3aGVuIHRoZSBjaGlsZCBleGl0cy5cbiAgICovXG4gIF93YWl0Rm9yRm9ya2VkQ2hpbGQoe2NoaWxkLCBwYXlsb2FkfSkge1xuICAgIGNvbnN0IHRpbWVvdXRTdGF0ZSA9IHRoaXMuX2FybUZvcmtlZEpvYlRpbWVvdXQoe2NoaWxkLCBwYXlsb2FkfSlcblxuICAgIHJldHVybiBuZXcgUHJvbWlzZSgocmVzb2x2ZSkgPT4ge1xuICAgICAgY2hpbGQub25jZShcImV4aXRcIiwgKGNvZGUsIHNpZ25hbCkgPT4ge1xuICAgICAgICB0aGlzLl9jbGVhckZvcmtlZEpvYlRpbWVvdXQodGltZW91dFN0YXRlKVxuICAgICAgICB0aGlzLl9oYW5kbGVGb3JrZWRDaGlsZEV4aXQoe2NoaWxkLCBjb2RlLCBzaWduYWwsIHBheWxvYWQsIHJlc29sdmUsIHRpbWVvdXRTdGF0ZX0pXG4gICAgICB9KVxuICAgICAgY2hpbGQub25jZShcImVycm9yXCIsIChlcnJvcikgPT4ge1xuICAgICAgICB0aGlzLl9jbGVhckZvcmtlZEpvYlRpbWVvdXQodGltZW91dFN0YXRlKVxuICAgICAgICB0aGlzLl9oYW5kbGVGb3JrZWRDaGlsZEVycm9yKHtjaGlsZCwgZXJyb3IsIHBheWxvYWQsIHJlc29sdmV9KVxuICAgICAgfSlcbiAgICB9KVxuICB9XG5cbiAgLyoqXG4gICAqIEFybXMgYSB3YWxsLWNsb2NrIGJhY2tzdG9wIGZvciBhIGZvcmtlZCBqb2IgcnVubmVyLiBBIGZvcmtlZCBqb2Igc3RpbGxcbiAgICogcnVubmluZyBhZnRlciBgam9iVGltZW91dE1zYCBpcyB0ZXJtaW5hdGVkIChTSUdURVJNLCB0aGVuIFNJR0tJTEwgYWZ0ZXIgdGhlXG4gICAqIGdyYWNlKSBzbyBhIHNpbmdsZSBnZW51aW5lbHktaHVuZyBydW5uZXIgY2FuJ3QgcGluIGEgZHJhaW5pbmcgd29ya2VyIOKAlCBhbmRcbiAgICogaXRzIGZ1bGwtYXBwIGJvb3QgYW5kIGRhdGFiYXNlIGNvbm5lY3Rpb25zIOKAlCBpbmRlZmluaXRlbHkuIFJldHVybnMgYSBzdGF0ZVxuICAgKiBvYmplY3QgdGhlIGV4aXQvZXJyb3IgaGFuZGxlcnMgdXNlIHRvIGNhbmNlbCB0aGUgdGltZXIgYW5kIHRvIHJlcG9ydCBhXG4gICAqIHRpbWVvdXQtc3BlY2lmaWMgZmFpbHVyZS4gV2hlbiBubyB0aW1lb3V0IGlzIGNvbmZpZ3VyZWQgdGhlIHRpbWVyIGlzIG51bGxcbiAgICogYW5kIGJlaGF2aW9yIGlzIHVuY2hhbmdlZC5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBPcHRpb25zLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIm5vZGU6Y2hpbGRfcHJvY2Vzc1wiKS5DaGlsZFByb2Nlc3N9IGFyZ3MuY2hpbGQgLSBGb3JrZWQgY2hpbGQgcHJvY2Vzcy5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL3R5cGVzLmpzXCIpLkJhY2tncm91bmRKb2JQYXlsb2FkICYge2lkOiBzdHJpbmd9fSBhcmdzLnBheWxvYWQgLSBKb2IgcGF5bG9hZC5cbiAgICogQHJldHVybnMge0ZvcmtlZEpvYlRpbWVvdXRTdGF0ZX0gLSBUaW1lb3V0IHN0YXRlLlxuICAgKi9cbiAgX2FybUZvcmtlZEpvYlRpbWVvdXQoe2NoaWxkLCBwYXlsb2FkfSkge1xuICAgIGNvbnN0IHRpbWVvdXRNcyA9IHRoaXMuX3Jlc29sdmVKb2JUaW1lb3V0TXMocGF5bG9hZC5vcHRpb25zKVxuICAgIC8qKiBAdHlwZSB7Rm9ya2VkSm9iVGltZW91dFN0YXRlfSAqL1xuICAgIGNvbnN0IHN0YXRlID0ge3RpbWVkT3V0OiBmYWxzZSwgdGltZW91dE1zLCB0aW1lcjogbnVsbCwgc2lna2lsbFRpbWVyOiBudWxsfVxuXG4gICAgaWYgKCEodHlwZW9mIHRpbWVvdXRNcyA9PT0gXCJudW1iZXJcIiAmJiB0aW1lb3V0TXMgPiAwKSkgcmV0dXJuIHN0YXRlXG5cbiAgICBzdGF0ZS50aW1lciA9IHNldFRpbWVvdXQoKCkgPT4gdGhpcy5fb25Gb3JrZWRKb2JUaW1lb3V0KHtjaGlsZCwgc3RhdGV9KSwgdGltZW91dE1zKVxuXG4gICAgcmV0dXJuIHN0YXRlXG4gIH1cblxuICAvKipcbiAgICogUmVzb2x2ZXMgdGhlIGVmZmVjdGl2ZSB3YWxsLWNsb2NrIGpvYiB0aW1lb3V0IGluIG1zIChzaGFyZWQgYnkgZm9ya2VkIGFuZCBwb29sZWQgam9icyksIG9yIG51bGwgd2hlbiBkaXNhYmxlZC4gVGhlXG4gICAqIHBlci1qb2Igb3ZlcnJpZGUgd2lucywgZm9sbG93ZWQgYnkgdGhlIGNvbnN0cnVjdG9yIG92ZXJyaWRlLCB0aGVuIHRoZSB2YWx1ZVxuICAgKiBmcm9tIHRoZSBiYWNrZ3JvdW5kLWpvYnMgY29uZmlndXJhdGlvbi4gQSBub24tcG9zaXRpdmUgdmFsdWUgZGlzYWJsZXMgdGhlXG4gICAqIGJhY2tzdG9wIGF0IHdoaWNoZXZlciBsZXZlbCBzdXBwbGllZCBpdC5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL3R5cGVzLmpzXCIpLkJhY2tncm91bmRKb2JPcHRpb25zfSBbam9iT3B0aW9uc10gLSBQZXItam9iIG9wdGlvbnMuXG4gICAqIEByZXR1cm5zIHtudW1iZXIgfCBudWxsfSAtIFRpbWVvdXQgaW4gbXMsIG9yIG51bGwgd2hlbiBkaXNhYmxlZC5cbiAgICovXG4gIF9yZXNvbHZlSm9iVGltZW91dE1zKGpvYk9wdGlvbnMpIHtcbiAgICBjb25zdCByYXcgPSB0eXBlb2Ygam9iT3B0aW9ucz8udGltZW91dE1zID09PSBcIm51bWJlclwiXG4gICAgICA/IGpvYk9wdGlvbnMudGltZW91dE1zXG4gICAgICA6ICh0eXBlb2YgdGhpcy5qb2JUaW1lb3V0TXNPdmVycmlkZSA9PT0gXCJudW1iZXJcIlxuICAgICAgICAgID8gdGhpcy5qb2JUaW1lb3V0TXNPdmVycmlkZVxuICAgICAgICAgIDogKHRoaXMuY29uZmlndXJhdGlvbiA/IHRoaXMuY29uZmlndXJhdGlvbi5nZXRCYWNrZ3JvdW5kSm9ic0NvbmZpZygpLmpvYlRpbWVvdXRNcyA6IG51bGwpKVxuXG4gICAgLy8gQSBub24tZmluaXRlIChlLmcuIEluZmluaXR5KSBvciBub24tcG9zaXRpdmUgdmFsdWUgZGlzYWJsZXMgdGhlIGJhY2tzdG9wO1xuICAgIC8vIGEgZmluaXRlIHZhbHVlIGJleW9uZCBOb2RlJ3MgdGltZXIgcmFuZ2UgaXMgY2xhbXBlZCB0byB0aGUgbWF4IHJhdGhlciB0aGFuXG4gICAgLy8gc2lsZW50bHkgY29lcmNlZCB0byB+MW1zICh3aGljaCB3b3VsZCBraWxsIGV2ZXJ5IGZvcmtlZCBqb2IgaW1tZWRpYXRlbHkpLlxuICAgIGlmICh0eXBlb2YgcmF3ICE9PSBcIm51bWJlclwiIHx8ICFOdW1iZXIuaXNGaW5pdGUocmF3KSB8fCByYXcgPD0gMCkgcmV0dXJuIG51bGxcblxuICAgIHJldHVybiBNYXRoLm1pbihyYXcsIE1BWF9GT1JLRURfSk9CX1RJTUVPVVRfTVMpXG4gIH1cblxuICAvKipcbiAgICogRmlyZWQgd2hlbiBhIGZvcmtlZCBydW5uZXIgb3ZlcnJ1bnMgaXRzIHRpbWVvdXQuIFNlbmRzIFNJR1RFUk0gZm9yIGEgY2xlYW5cbiAgICogc2h1dGRvd24sIHRoZW4gU0lHS0lMTCBhZnRlciB0aGUgZ3JhY2UgZm9yIGEgcnVubmVyIHRoYXQgaWdub3JlcyBpdC4gVGhlXG4gICAqIHJlc3VsdGluZyBub24tY2xlYW4gZXhpdCBmbG93cyB0aHJvdWdoIGBfaGFuZGxlRm9ya2VkQ2hpbGRFeGl0YCwgd2hpY2ggZnJlZXNcbiAgICogdGhlIHNsb3QgYW5kIHJlcG9ydHMgdGhlIGpvYiBmYWlsZWQuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gT3B0aW9ucy5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCJub2RlOmNoaWxkX3Byb2Nlc3NcIikuQ2hpbGRQcm9jZXNzfSBhcmdzLmNoaWxkIC0gRm9ya2VkIGNoaWxkIHByb2Nlc3MuXG4gICAqIEBwYXJhbSB7Rm9ya2VkSm9iVGltZW91dFN0YXRlfSBhcmdzLnN0YXRlIC0gVGltZW91dCBzdGF0ZS5cbiAgICogQHJldHVybnMge3ZvaWR9XG4gICAqL1xuICBfb25Gb3JrZWRKb2JUaW1lb3V0KHtjaGlsZCwgc3RhdGV9KSB7XG4gICAgc3RhdGUudGltZWRPdXQgPSB0cnVlXG5cbiAgICB0cnkge1xuICAgICAgY2hpbGQua2lsbChcIlNJR1RFUk1cIilcbiAgICB9IGNhdGNoIHtcbiAgICAgIC8vIENoaWxkIGFscmVhZHkgZXhpdGVkOyBub3RoaW5nIHRvIGRvLlxuICAgIH1cblxuICAgIHN0YXRlLnNpZ2tpbGxUaW1lciA9IHNldFRpbWVvdXQoKCkgPT4ge1xuICAgICAgdHJ5IHtcbiAgICAgICAgY2hpbGQua2lsbChcIlNJR0tJTExcIilcbiAgICAgIH0gY2F0Y2gge1xuICAgICAgICAvLyBDaGlsZCBhbHJlYWR5IGV4aXRlZDsgbm90aGluZyB0byBkby5cbiAgICAgIH1cbiAgICB9LCB0aGlzLmZvcmtlZENoaWxkU2lna2lsbEdyYWNlTXMpXG4gIH1cblxuICAvKipcbiAgICogQ2FuY2VscyBhbnkgcGVuZGluZyB0aW1lb3V0L1NJR0tJTEwgdGltZXJzIGZvciBhIGZvcmtlZCBydW5uZXIgdGhhdCBoYXNcbiAgICogZXhpdGVkIChvciBlcnJvcmVkKSBzbyB0aGV5IG5ldmVyIGZpcmUgYWdhaW5zdCBhIGdvbmUgb3IgcmV1c2VkIGNoaWxkLlxuICAgKiBAcGFyYW0ge0ZvcmtlZEpvYlRpbWVvdXRTdGF0ZX0gc3RhdGUgLSBUaW1lb3V0IHN0YXRlLlxuICAgKiBAcmV0dXJucyB7dm9pZH1cbiAgICovXG4gIF9jbGVhckZvcmtlZEpvYlRpbWVvdXQoc3RhdGUpIHtcbiAgICBpZiAoc3RhdGUudGltZXIpIHtcbiAgICAgIGNsZWFyVGltZW91dChzdGF0ZS50aW1lcilcbiAgICAgIHN0YXRlLnRpbWVyID0gbnVsbFxuICAgIH1cblxuICAgIGlmIChzdGF0ZS5zaWdraWxsVGltZXIpIHtcbiAgICAgIGNsZWFyVGltZW91dChzdGF0ZS5zaWdraWxsVGltZXIpXG4gICAgICBzdGF0ZS5zaWdraWxsVGltZXIgPSBudWxsXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgaGFuZGxlIGZvcmtlZCBjaGlsZCBleGl0LlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIE9wdGlvbnMuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwibm9kZTpjaGlsZF9wcm9jZXNzXCIpLkNoaWxkUHJvY2Vzc30gYXJncy5jaGlsZCAtIEZvcmtlZCBjaGlsZCBwcm9jZXNzLlxuICAgKiBAcGFyYW0ge251bWJlciB8IG51bGx9IGFyZ3MuY29kZSAtIEV4aXQgY29kZS5cbiAgICogQHBhcmFtIHtrZXlvZiB0eXBlb2YgaW1wb3J0KFwibm9kZTpvc1wiKS5jb25zdGFudHMuc2lnbmFscyB8IG51bGx9IGFyZ3Muc2lnbmFsIC0gRXhpdCBzaWduYWwuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi90eXBlcy5qc1wiKS5CYWNrZ3JvdW5kSm9iUGF5bG9hZCAmIHtpZDogc3RyaW5nfX0gYXJncy5wYXlsb2FkIC0gUGF5bG9hZC5cbiAgICogQHBhcmFtIHsodmFsdWU6IHZvaWQpID0+IHZvaWR9IGFyZ3MucmVzb2x2ZSAtIFByb21pc2UgcmVzb2x2ZXIuXG4gICAqIEBwYXJhbSB7Rm9ya2VkSm9iVGltZW91dFN0YXRlfSBbYXJncy50aW1lb3V0U3RhdGVdIC0gVGltZW91dCBzdGF0ZSwgd2hlbiB0aGUgcnVubmVyIGhhZCBhIHdhbGwtY2xvY2sgYmFja3N0b3AuXG4gICAqIEByZXR1cm5zIHt2b2lkfVxuICAgKi9cbiAgX2hhbmRsZUZvcmtlZENoaWxkRXhpdCh7Y2hpbGQsIGNvZGUsIHNpZ25hbCwgcGF5bG9hZCwgcmVzb2x2ZSwgdGltZW91dFN0YXRlfSkge1xuICAgIHRoaXMuaW5mbGlnaHRQcm9jZXNzQ2hpbGRyZW4uZGVsZXRlKGNoaWxkKVxuXG4gICAgLy8gRnJlZSB0aGUgd29ya2VyIHNsb3QgYXMgc29vbiBhcyB0aGUgY2hpbGQgaXMgZ29uZSDigJQgbmV2ZXIgZ2F0ZSBpdCBvbiB0aGVcbiAgICAvLyBmYWlsdXJlIHJlcG9ydC4gQSBodW5nL3Nsb3cgcmVwb3J0IG11c3Qgbm90IGxlYWsgdGhlIHNsb3Q7IGVub3VnaCBsZWFrZWRcbiAgICAvLyBzbG90cyBkcml2ZSBgYWNjZXB0c0ZvcmtlZGAgdG8gZmFsc2UgYW5kIHNpbGVudGx5IHdlZGdlIHRoZSB3b3JrZXIuXG4gICAgcmVzb2x2ZSh1bmRlZmluZWQpXG5cbiAgICBpZiAodGhpcy5fZm9ya2VkQ2hpbGRFeGl0ZWRDbGVhbmx5KHtjb2RlLCBzaWduYWx9KSkgcmV0dXJuXG5cbiAgICBjb25zdCBlcnJvciA9IHRpbWVvdXRTdGF0ZT8udGltZWRPdXRcbiAgICAgID8gbmV3IEVycm9yKGBGb3JrZWQgYmFja2dyb3VuZCBqb2IgcnVubmVyIHRpbWVkIG91dCBhZnRlciAke3RpbWVvdXRTdGF0ZS50aW1lb3V0TXN9bXMgYW5kIHdhcyB0ZXJtaW5hdGVkOiBjb2RlPSR7Y29kZX0gc2lnbmFsPSR7c2lnbmFsIHx8IFwibm9uZVwifWApXG4gICAgICA6IG5ldyBFcnJvcihgRm9ya2VkIGJhY2tncm91bmQgam9iIHJ1bm5lciBleGl0ZWQgYmVmb3JlIHJlcG9ydGluZzogY29kZT0ke2NvZGV9IHNpZ25hbD0ke3NpZ25hbCB8fCBcIm5vbmVcIn1gKVxuXG4gICAgdGhpcy5fcmVwb3J0Rm9ya2VkQ2hpbGRGYWlsdXJlKHtwYXlsb2FkLCBlcnJvcn0pXG4gIH1cblxuICAvKipcbiAgICogUnVucyBmb3JrZWQgY2hpbGQgZXhpdGVkIGNsZWFubHkuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gT3B0aW9ucy5cbiAgICogQHBhcmFtIHtudW1iZXIgfCBudWxsfSBhcmdzLmNvZGUgLSBFeGl0IGNvZGUuXG4gICAqIEBwYXJhbSB7a2V5b2YgdHlwZW9mIGltcG9ydChcIm5vZGU6b3NcIikuY29uc3RhbnRzLnNpZ25hbHMgfCBudWxsfSBhcmdzLnNpZ25hbCAtIEV4aXQgc2lnbmFsLlxuICAgKiBAcmV0dXJucyB7Ym9vbGVhbn0gLSBXaGV0aGVyIHRoZSBjaGlsZCBleGl0ZWQgY2xlYW5seS5cbiAgICovXG4gIF9mb3JrZWRDaGlsZEV4aXRlZENsZWFubHkoe2NvZGUsIHNpZ25hbH0pIHtcbiAgICByZXR1cm4gY29kZSA9PT0gMCAmJiAhc2lnbmFsXG4gIH1cblxuICAvKipcbiAgICogUnVucyBoYW5kbGUgZm9ya2VkIGNoaWxkIGVycm9yLlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIE9wdGlvbnMuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwibm9kZTpjaGlsZF9wcm9jZXNzXCIpLkNoaWxkUHJvY2Vzc30gYXJncy5jaGlsZCAtIEZvcmtlZCBjaGlsZCBwcm9jZXNzLlxuICAgKiBAcGFyYW0ge0Vycm9yfSBhcmdzLmVycm9yIC0gQ2hpbGQgcHJvY2VzcyBlcnJvci5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL3R5cGVzLmpzXCIpLkJhY2tncm91bmRKb2JQYXlsb2FkICYge2lkOiBzdHJpbmd9fSBhcmdzLnBheWxvYWQgLSBQYXlsb2FkLlxuICAgKiBAcGFyYW0geyh2YWx1ZTogdm9pZCkgPT4gdm9pZH0gYXJncy5yZXNvbHZlIC0gUHJvbWlzZSByZXNvbHZlci5cbiAgICogQHJldHVybnMge3ZvaWR9XG4gICAqL1xuICBfaGFuZGxlRm9ya2VkQ2hpbGRFcnJvcih7Y2hpbGQsIGVycm9yLCBwYXlsb2FkLCByZXNvbHZlfSkge1xuICAgIHRoaXMuaW5mbGlnaHRQcm9jZXNzQ2hpbGRyZW4uZGVsZXRlKGNoaWxkKVxuICAgIC8vIEZyZWUgdGhlIHNsb3QgZmlyc3QgKHNlZSBfaGFuZGxlRm9ya2VkQ2hpbGRFeGl0KSDigJQgcmVwb3J0aW5nIGlzIGJlc3QtZWZmb3J0LlxuICAgIHJlc29sdmUodW5kZWZpbmVkKVxuICAgIGNvbnNvbGUuZXJyb3IoXCJCYWNrZ3JvdW5kIGpvYnMgZm9ya2VkIHJ1bm5lciBlcnJvcjpcIiwgZXJyb3IpXG4gICAgdGhpcy5fcmVwb3J0Rm9ya2VkQ2hpbGRGYWlsdXJlKHtwYXlsb2FkLCBlcnJvcn0pXG4gIH1cblxuICAvKipcbiAgICogUnVucyBzZW5kIGZvcmtlZCBwYXlsb2FkLlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIE9wdGlvbnMuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwibm9kZTpjaGlsZF9wcm9jZXNzXCIpLkNoaWxkUHJvY2Vzc30gYXJncy5jaGlsZCAtIEZvcmtlZCBjaGlsZCBwcm9jZXNzLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vdHlwZXMuanNcIikuQmFja2dyb3VuZEpvYlBheWxvYWQgJiB7aWQ6IHN0cmluZ319IGFyZ3MucGF5bG9hZCAtIFBheWxvYWQuXG4gICAqIEByZXR1cm5zIHt2b2lkfVxuICAgKi9cbiAgX3NlbmRGb3JrZWRQYXlsb2FkKHtjaGlsZCwgcGF5bG9hZH0pIHtcbiAgICB0cnkge1xuICAgICAgY2hpbGQuc2VuZCh7dHlwZTogXCJqb2JcIiwgcGF5bG9hZH0pXG4gICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgIGNoaWxkLmtpbGwoXCJTSUdURVJNXCIpXG4gICAgICB0aGlzLl9yZXBvcnRGb3JrZWRDaGlsZEZhaWx1cmUoe3BheWxvYWQsIGVycm9yfSlcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogUnVucyByZXBvcnQgZm9ya2VkIGNoaWxkIGZhaWx1cmUuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gT3B0aW9ucy5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL3R5cGVzLmpzXCIpLkJhY2tncm91bmRKb2JQYXlsb2FkICYge2lkOiBzdHJpbmd9fSBhcmdzLnBheWxvYWQgLSBQYXlsb2FkLlxuICAgKiBAcGFyYW0ge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSBhcmdzLmVycm9yIC0gRXJyb3IuXG4gICAqIEByZXR1cm5zIHt2b2lkfVxuICAgKi9cbiAgX3JlcG9ydEZvcmtlZENoaWxkRmFpbHVyZSh7cGF5bG9hZCwgZXJyb3J9KSB7XG4gICAgdGhpcy5fcmVwb3J0Sm9iUmVzdWx0SW5CYWNrZ3JvdW5kKHtcbiAgICAgIGpvYklkOiBwYXlsb2FkLmlkLFxuICAgICAgc3RhdHVzOiBcImZhaWxlZFwiLFxuICAgICAgZXJyb3IsXG4gICAgICBoYW5kb2ZmSWQ6IHBheWxvYWQuaGFuZG9mZklkLFxuICAgICAgaGFuZGVkT2ZmQXRNczogcGF5bG9hZC5oYW5kZWRPZmZBdE1zLFxuICAgICAgd29ya2VySWQ6IHBheWxvYWQud29ya2VySWQgfHwgdGhpcy53b3JrZXJJZFxuICAgIH0pXG4gIH1cblxuICAvKipcbiAgICogUnVucyBzcGF3biBqb2IuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi90eXBlcy5qc1wiKS5CYWNrZ3JvdW5kSm9iUGF5bG9hZH0gcGF5bG9hZCAtIFBheWxvYWQuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIHdoZW4gdGhlIHNwYXduZWQgcnVubmVyIGV4aXRzIG9yIHNwYXduIGZhaWxzLlxuICAgKi9cbiAgX3NwYXduSm9iKHBheWxvYWQpIHtcbiAgICBjb25zdCBjb25maWd1cmF0aW9uID0gdGhpcy5jb25maWd1cmF0aW9uXG4gICAgaWYgKCFjb25maWd1cmF0aW9uKSB0aHJvdyBuZXcgRXJyb3IoXCJCYWNrZ3JvdW5kIGpvYnMgd29ya2VyIGNvbmZpZ3VyYXRpb24gbm90IGluaXRpYWxpemVkXCIpXG5cbiAgICBjb25zdCBkaXJlY3RvcnkgPSBjb25maWd1cmF0aW9uLmdldERpcmVjdG9yeSgpXG4gICAgY29uc3QgYXJndkNvbW1hbmQgPSBwcm9jZXNzLmFyZ3ZbMV1cbiAgICBjb25zdCBjb21tYW5kID0gYXJndkNvbW1hbmQgPyBhcmd2Q29tbWFuZCA6IGAke2RpcmVjdG9yeX0vYmluL3ZlbG9jaW91cy5qc2BcbiAgICBjb25zdCBlbmNvZGVkUGF5bG9hZCA9IEJ1ZmZlci5mcm9tKEpTT04uc3RyaW5naWZ5KHBheWxvYWQpKS50b1N0cmluZyhcImJhc2U2NFwiKVxuICAgIGNvbnN0IGNoaWxkID0gc3Bhd24ocHJvY2Vzcy5leGVjUGF0aCwgW2NvbW1hbmQsIFwiYmFja2dyb3VuZC1qb2JzLXJ1bm5lclwiXSwge1xuICAgICAgY3dkOiBkaXJlY3RvcnksXG4gICAgICBkZXRhY2hlZDogdHJ1ZSxcbiAgICAgIHN0ZGlvOiBcImlnbm9yZVwiLFxuICAgICAgZW52OiBPYmplY3QuYXNzaWduKHt9LCBwcm9jZXNzLmVudiwgdGhpcy5fY2hpbGRCYWNrZ3JvdW5kSm9ic0Vudmlyb25tZW50KCksIHtWRUxPQ0lPVVNfSk9CX1BBWUxPQUQ6IGVuY29kZWRQYXlsb2FkfSlcbiAgICB9KVxuXG4gICAgdGhpcy5pbmZsaWdodFByb2Nlc3NDaGlsZHJlbi5hZGQoY2hpbGQpXG5cbiAgICBjb25zdCBmaW5pc2hlZCA9IG5ldyBQcm9taXNlKChyZXNvbHZlKSA9PiB7XG4gICAgICBjaGlsZC5vbmNlKFwiZXhpdFwiLCAoKSA9PiB7XG4gICAgICAgIHRoaXMuaW5mbGlnaHRQcm9jZXNzQ2hpbGRyZW4uZGVsZXRlKGNoaWxkKVxuICAgICAgICByZXNvbHZlKHVuZGVmaW5lZClcbiAgICAgIH0pXG4gICAgICBjaGlsZC5vbmNlKFwiZXJyb3JcIiwgKGVycm9yKSA9PiB7XG4gICAgICAgIHRoaXMuaW5mbGlnaHRQcm9jZXNzQ2hpbGRyZW4uZGVsZXRlKGNoaWxkKVxuICAgICAgICBjb25zb2xlLmVycm9yKFwiQmFja2dyb3VuZCBqb2JzIHNwYXduZWQgcnVubmVyIGVycm9yOlwiLCBlcnJvcilcbiAgICAgICAgcmVzb2x2ZSh1bmRlZmluZWQpXG4gICAgICB9KVxuICAgIH0pXG5cbiAgICBjaGlsZC51bnJlZigpXG5cbiAgICByZXR1cm4gZmluaXNoZWRcbiAgfVxuXG4gIC8qKlxuICAgKiBCdWlsZHMgdGhlIGV4YWN0IG1haW4gZW5kcG9pbnQgYW5kIGdlbmVyYXRpb24gaW5oZXJpdGVkIGJ5IGV2ZXJ5IGNoaWxkLlxuICAgKiBAcmV0dXJucyB7UmVjb3JkPHN0cmluZywgc3RyaW5nPn0gLSBDaGlsZCBwcm9jZXNzIGVudmlyb25tZW50IGFkZGl0aW9ucy5cbiAgICovXG4gIF9jaGlsZEJhY2tncm91bmRKb2JzRW52aXJvbm1lbnQoKSB7XG4gICAgY29uc3QgY29uZmlndXJhdGlvbiA9IHRoaXMuY29uZmlndXJhdGlvblxuICAgIGlmICghY29uZmlndXJhdGlvbikgdGhyb3cgbmV3IEVycm9yKFwiQmFja2dyb3VuZCBqb2JzIHdvcmtlciBjb25maWd1cmF0aW9uIG5vdCBpbml0aWFsaXplZFwiKVxuICAgIGlmICghdGhpcy5ob3N0IHx8IHR5cGVvZiB0aGlzLnBvcnQgIT09IFwibnVtYmVyXCIpIHRocm93IG5ldyBFcnJvcihcIkJhY2tncm91bmQgam9icyB3b3JrZXIgZW5kcG9pbnQgbm90IHJlc29sdmVkXCIpXG5cbiAgICByZXR1cm4ge1xuICAgICAgVkVMT0NJT1VTX0JBQ0tHUk9VTkRfSk9CX0NISUxEOiBcIjFcIixcbiAgICAgIFZFTE9DSU9VU19FTlY6IGNvbmZpZ3VyYXRpb24uZ2V0RW52aXJvbm1lbnQoKSxcbiAgICAgIFZFTE9DSU9VU19CQUNLR1JPVU5EX0pPQlNfSE9TVDogdGhpcy5ob3N0LFxuICAgICAgVkVMT0NJT1VTX0JBQ0tHUk9VTkRfSk9CU19QT1JUOiBgJHt0aGlzLnBvcnR9YCxcbiAgICAgIC4uLih0aGlzLmdlbmVyYXRpb25JZCA/IHtWRUxPQ0lPVVNfQkFDS0dST1VORF9KT0JTX0dFTkVSQVRJT05fSUQ6IHRoaXMuZ2VuZXJhdGlvbklkfSA6IHt9KVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHJlcG9ydCBqb2IgcmVzdWx0LlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIE9wdGlvbnMuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBhcmdzLmpvYklkIC0gSm9iIGlkLlxuICAgKiBAcGFyYW0ge1wiY29tcGxldGVkXCIgfCBcImZhaWxlZFwiIHwgXCJyZXNjaGVkdWxlZFwifSBhcmdzLnN0YXR1cyAtIFN0YXR1cy5cbiAgICogQHBhcmFtIHtudW1iZXJ9IFthcmdzLmRlbGF5TXNdIC0gUmVzY2hlZHVsZSBkZWxheSBpbiBtaWxsaXNlY29uZHMuXG4gICAqIEBwYXJhbSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59IFthcmdzLmVycm9yXSAtIEVycm9yLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gW2FyZ3MuaGFuZG9mZklkXSAtIEhhbmRvZmYgbGVhc2UgaWQuXG4gICAqIEBwYXJhbSB7bnVtYmVyfSBbYXJncy5oYW5kZWRPZmZBdE1zXSAtIEhhbmRlZCBvZmYgdGltZXN0YW1wLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gW2FyZ3Mud29ya2VySWRdIC0gV29ya2VyIGlkLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vdHlwZXMuanNcIikuUG9vbGVkUnVubmVyRmFpbHVyZX0gW2FyZ3MucnVubmVyRmFpbHVyZV0gLSBQb29sZWQtY2hpbGQgcHJvY2VzcyBmYWlsdXJlIHByb3ZlbmFuY2UuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIHdoZW4gcmVwb3J0ZWQuXG4gICAqL1xuICBhc3luYyBfcmVwb3J0Sm9iUmVzdWx0KHtqb2JJZCwgc3RhdHVzLCBkZWxheU1zLCBlcnJvciwgaGFuZG9mZklkLCBoYW5kZWRPZmZBdE1zLCB3b3JrZXJJZCwgcnVubmVyRmFpbHVyZX0pIHtcbiAgICBpZiAoIXRoaXMuc3RhdHVzUmVwb3J0ZXIpIHJldHVyblxuXG4gICAgdHJ5IHtcbiAgICAgIC8vIFJldHJ5IGEgdHJhbnNpZW50IHBlcnNpc3QgZmFpbHVyZSAoYGpvYi11cGRhdGUtZXJyb3JgKTogdGhlIHdvcmtlciBpc1xuICAgICAgLy8gbG9uZy1saXZlZCBhbmQgY2Fubm90IGV4aXQgdG8gdHJpZ2dlciBvcnBoYW4gcmVjbGFpbSwgc28gZHJvcHBpbmcgdGhlXG4gICAgICAvLyBjb21wbGV0aW9uIGhlcmUgd291bGQgc3RyYW5kIHRoZSBqb2IgaW4gYGhhbmRlZF9vZmZgIGZvcmV2ZXIg4oCUIGZhdGFsIGZvciBhXG4gICAgICAvLyBgbWF4X2NvbmN1cnJlbmN5OiAxYCBqb2IgKGEgc3RyYW5kZWQgcm93IGJsb2NrcyBldmVyeSBmdXR1cmUgcnVuKS5cbiAgICAgIGF3YWl0IHRoaXMuc3RhdHVzUmVwb3J0ZXIucmVwb3J0V2l0aFJldHJ5KHtqb2JJZCwgc3RhdHVzLCBkZWxheU1zLCBlcnJvciwgaGFuZG9mZklkLCBoYW5kZWRPZmZBdE1zLCB3b3JrZXJJZCwgcnVubmVyRmFpbHVyZSwgcmV0cnlQZXJzaXN0RXJyb3JzOiB0cnVlfSlcbiAgICB9IGNhdGNoIChyZXBvcnRFcnJvcikge1xuICAgICAgY29uc29sZS5lcnJvcihcIkJhY2tncm91bmQgam9iIHN0YXR1cyByZXBvcnRpbmcgZmFpbGVkOlwiLCByZXBvcnRFcnJvcilcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogRmlyZXMgYSBkdXJhYmxlIGpvYi1yZXN1bHQgcmVwb3J0IHdpdGhvdXQgYmxvY2tpbmcgdGhlIGNhbGxlciAoc28gZnJlZWluZyBhXG4gICAqIGpvYi9jaGlsZCBzbG90IG5ldmVyIHdhaXRzIG9uIHRoZSByZXBvcnQpLiBUaGUgcmVwb3J0IGlzIHRyYWNrZWQgc28gYVxuICAgKiBncmFjZWZ1bCBgc3RvcCgpYCBjYW4gZHJhaW4gaW4tZmxpZ2h0IHJlcG9ydHMgYmVmb3JlIGNsb3NpbmcgdGhlIHNvY2tldC5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBPcHRpb25zLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gYXJncy5qb2JJZCAtIEpvYiBpZC5cbiAgICogQHBhcmFtIHtcImNvbXBsZXRlZFwiIHwgXCJmYWlsZWRcIiB8IFwicmVzY2hlZHVsZWRcIn0gYXJncy5zdGF0dXMgLSBTdGF0dXMuXG4gICAqIEBwYXJhbSB7bnVtYmVyfSBbYXJncy5kZWxheU1zXSAtIFJlc2NoZWR1bGUgZGVsYXkgaW4gbWlsbGlzZWNvbmRzLlxuICAgKiBAcGFyYW0ge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSBbYXJncy5lcnJvcl0gLSBFcnJvci5cbiAgICogQHBhcmFtIHtzdHJpbmd9IFthcmdzLmhhbmRvZmZJZF0gLSBIYW5kb2ZmIGxlYXNlIGlkLlxuICAgKiBAcGFyYW0ge251bWJlcn0gW2FyZ3MuaGFuZGVkT2ZmQXRNc10gLSBIYW5kZWQgb2ZmIHRpbWVzdGFtcC5cbiAgICogQHBhcmFtIHtzdHJpbmd9IFthcmdzLndvcmtlcklkXSAtIFdvcmtlciBpZC5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL3R5cGVzLmpzXCIpLlBvb2xlZFJ1bm5lckZhaWx1cmV9IFthcmdzLnJ1bm5lckZhaWx1cmVdIC0gUG9vbGVkLWNoaWxkIHByb2Nlc3MgZmFpbHVyZSBwcm92ZW5hbmNlLlxuICAgKiBAcmV0dXJucyB7dm9pZH1cbiAgICovXG4gIF9yZXBvcnRKb2JSZXN1bHRJbkJhY2tncm91bmQoe2pvYklkLCBzdGF0dXMsIGRlbGF5TXMsIGVycm9yLCBoYW5kb2ZmSWQsIGhhbmRlZE9mZkF0TXMsIHdvcmtlcklkLCBydW5uZXJGYWlsdXJlfSkge1xuICAgIC8qKlxuICAgICAqIERlZmluZXMgcmVwb3J0LlxuICAgICAqIEB0eXBlIHtQcm9taXNlPHZvaWQ+fSAqL1xuICAgIGxldCByZXBvcnRcblxuICAgIHJlcG9ydCA9IHRoaXMuX3JlcG9ydEpvYlJlc3VsdCh7am9iSWQsIHN0YXR1cywgZGVsYXlNcywgZXJyb3IsIGhhbmRvZmZJZCwgaGFuZGVkT2ZmQXRNcywgd29ya2VySWQsIHJ1bm5lckZhaWx1cmV9KS5maW5hbGx5KCgpID0+IHtcbiAgICAgIHRoaXMuaW5mbGlnaHRSZXBvcnRzLmRlbGV0ZShyZXBvcnQpXG4gICAgfSlcblxuICAgIHRoaXMuaW5mbGlnaHRSZXBvcnRzLmFkZChyZXBvcnQpXG4gIH1cbn1cbiJdfQ==