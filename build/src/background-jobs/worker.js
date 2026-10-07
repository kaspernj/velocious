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
 * @property {import("./types.js").PooledChildMemoryObservation} [lastMemoryObservation] - Latest memory observation received from this child.
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
 * Checks whether an IPC value is a pooled child's bounded memory observation.
 * The pooled child's stdio is ignored by the worker fork, so this observation
 * (periodic while jobs run, plus on demand) is how a memory problem in a
 * running child names itself. The worker logs it (its stderr reaches the prod
 * log) and forwards it to the optional `onPooledRunnerMemoryObservation` hook.
 * @param {ReturnType<typeof JSON.parse>} message - IPC message.
 * @returns {message is import("./types.js").PooledChildMemoryObservation} - Whether this is a valid memory observation.
 */
function isPooledChildMemoryObservationMessage(message) {
    if (!message || typeof message !== "object")
        return false;
    const record = /** @type {Record<string, ReturnType<typeof JSON.parse>>} */ (message);
    const heapStatistics = /** @type {Record<string, ReturnType<typeof JSON.parse>> | undefined} */ (record.heapStatistics);
    const memoryUsage = /** @type {Record<string, ReturnType<typeof JSON.parse>> | undefined} */ (record.memoryUsage);
    return record.type === "pooled-child-memory"
        && typeof record.childInstanceId === "string"
        && Number.isInteger(record.childPid)
        && typeof record.rssBytes === "number"
        && Number.isFinite(record.rssBytes)
        && Number.isInteger(record.jobCount)
        && record.jobCount >= 0
        && Array.isArray(record.activeJobIds)
        && record.activeJobIds.every((jobId) => typeof jobId === "string")
        && Number.isInteger(record.activeJobIdsTruncatedCount)
        && record.activeJobIdsTruncatedCount >= 0
        && typeof record.observedAtMs === "number"
        && Number.isFinite(record.observedAtMs)
        && heapStatistics !== undefined && typeof heapStatistics === "object"
        && memoryUsage !== undefined && typeof memoryUsage === "object";
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
     * @param {(observation: import("./types.js").PooledChildMemoryObservation) => void | Promise<void>} [args.onPooledRunnerMemoryObservation] - Explicit pooled-child memory observation hook. Every validated observation (periodic while a child has in-flight jobs, plus on demand) is forwarded here, in addition to the worker's compact stderr log line, so an application can route memory diagnostics (e.g. to a bug reporter) without parsing logs.
     */
    constructor({ configuration, host, port, generationId, workerInstanceId, maxConcurrentForkedJobs, maxConcurrentInlineJobs, pooledRunnerCount, pooledRunnerConcurrency, pooledRunnerMaxJobs, pooledRunnerMaxRssBytes, pooledRunnerMaxLifetimeMs, forkedChildSigkillGraceMs, heartbeatIntervalMs, generationHandshakeTimeoutMs = DEFAULT_GENERATION_HANDSHAKE_TIMEOUT_MS, reconnectDelayMs = 1000, jobTimeoutMs, closeDatabaseConnectionsOnStop = true, onStopped, onGenerationAccepted, onRetireMessage, onPooledRunnerMemoryObservation } = {}) {
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
        this.onPooledRunnerMemoryObservation = onPooledRunnerMemoryObservation;
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
        if (isPooledChildMemoryObservationMessage(message)) {
            this._handlePooledChildMemoryObservation({ child, message });
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
     * Handles a pooled child's bounded memory observation. The pooled child's
     * stdio is ignored by the worker fork, so this IPC observation is how a
     * memory problem in a running child names itself. The worker (a) records the
     * latest observation on the child's state for later correlation, (b) logs one
     * compact line to its own stderr (which reaches the prod log, unlike the
     * child's ignored stdio), and (c) forwards the full observation to the
     * optional `onPooledRunnerMemoryObservation` hook so an application can route
     * it (e.g. to a bug reporter) without parsing logs. The heap-stat breakdown
     * distinguishes V8-heap growth from external/array-buffer (native) growth. A
     * hook failure is swallowed — diagnostics must never take down the worker or
     * fail the jobs running on that child.
     * @param {object} args - Message details.
     * @param {import("node:child_process").ChildProcess} args.child - Pooled child.
     * @param {import("./types.js").PooledChildMemoryObservation} args.message - Validated memory observation.
     * @returns {void}
     */
    _handlePooledChildMemoryObservation({ child, message }) {
        const state = this.pooledChildStates.get(child);
        if (state)
            state.lastMemoryObservation = message;
        const heap = message.heapStatistics;
        console.error(JSON.stringify({
            event: "pooled-child-memory",
            childInstanceId: state?.childInstanceId ?? message.childInstanceId,
            childPid: message.childPid,
            childUptimeS: Math.round(message.childUptimeMs / 1000),
            rssMb: Math.round(message.rssBytes / (1024 * 1024)),
            heapUsedMb: Math.round(heap.used_heap_size / (1024 * 1024)),
            heapTotalMb: Math.round(heap.total_heap_size / (1024 * 1024)),
            heapLimitMb: Math.round(heap.heap_size_limit / (1024 * 1024)),
            externalMb: Math.round(message.memoryUsage.external / (1024 * 1024)),
            arrayBuffersMb: Math.round(message.memoryUsage.arrayBuffers / (1024 * 1024)),
            jobs: message.jobCount,
            activeJobIds: message.activeJobIds
        }));
        if (this.onPooledRunnerMemoryObservation) {
            try {
                const result = this.onPooledRunnerMemoryObservation(message);
                if (result && typeof result.catch === "function")
                    result.catch((error) => {
                        console.error("Pooled runner memory observation hook failed:", error);
                    });
            }
            catch (error) {
                console.error("Pooled runner memory observation hook failed:", error);
            }
        }
    }
    /**
     * Requests an immediate memory observation from one pooled child. The child
     * replies over IPC with its current snapshot (the same shape as the periodic
     * sampler), which the worker records, logs, and forwards to the
     * `onPooledRunnerMemoryObservation` hook. Use this to pull a snapshot on
     * suspicion (e.g. after an OOM report) without waiting for the next periodic
     * sample. A no-op when the child is gone or its IPC channel is closed.
     * @param {import("node:child_process").ChildProcess} child - Pooled child to sample.
     * @returns {void}
     */
    requestPooledChildMemoryObservation(child) {
        if (!child.connected)
            return;
        try {
            child.send({ type: "memory-observation-request" });
        }
        catch {
            // The IPC channel is already gone; the disconnect/exit handler owns teardown.
        }
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoid29ya2VyLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiLi4vLi4vLi4vc3JjL2JhY2tncm91bmQtam9icy93b3JrZXIuanMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6IkFBQUEsWUFBWTtBQUVaLE9BQU8sR0FBRyxNQUFNLEtBQUssQ0FBQTtBQUNyQixPQUFPLEVBQUUsSUFBSSxFQUFFLEtBQUssRUFBRSxNQUFNLG9CQUFvQixDQUFBO0FBQ2hELE9BQU8sVUFBVSxNQUFNLGtCQUFrQixDQUFBO0FBQ3pDLE9BQU8scUJBQXFCLE1BQU0sbUJBQW1CLENBQUE7QUFDckQsT0FBTyxxQkFBcUIsTUFBTSw4QkFBOEIsQ0FBQTtBQUNoRSxPQUFPLDRCQUE0QixNQUFNLHNCQUFzQixDQUFBO0FBQy9ELE9BQU8sRUFBRSxVQUFVLEVBQUUsTUFBTSxRQUFRLENBQUE7QUFDbkMsT0FBTyxFQUFFLGFBQWEsRUFBRSxNQUFNLFVBQVUsQ0FBQTtBQUN4QyxPQUFPLGlCQUFpQixFQUFFLEVBQUUsZ0JBQWdCLEVBQUUsTUFBTSxnQ0FBZ0MsQ0FBQTtBQUNwRixPQUFPLDZCQUE2QixNQUFNLHdCQUF3QixDQUFBO0FBQ2xFLE9BQU8sb0JBQW9CLE1BQU0sa0JBQWtCLENBQUE7QUFDbkQsT0FBTyxFQUFFLDJCQUEyQixFQUFFLE1BQU0sd0JBQXdCLENBQUE7QUFDcEUsT0FBTyxFQUFFLHdCQUF3QixFQUFFLE1BQU0sMEJBQTBCLENBQUE7QUFDbkUsT0FBTyw2Q0FBNkMsRUFBRSxFQUFFLHVDQUF1QyxFQUFFLG9DQUFvQyxFQUFFLE1BQU0seUNBQXlDLENBQUE7QUFDdEwsT0FBTyxFQUFFLG1DQUFtQyxFQUFFLGlDQUFpQyxFQUFFLDJCQUEyQixFQUFFLDJCQUEyQixFQUFFLE1BQU0sNkJBQTZCLENBQUE7QUFFOUs7Ozs7Ozs7R0FPRztBQUNIOzs7Ozs7R0FNRztBQUNIOzs7Ozs7Ozs7Ozs7Ozs7Ozs7O0dBbUJHO0FBQ0gsaUZBQWlGO0FBQ2pGLE1BQU0sNkJBQTZCLEdBQUcs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LFdBQVcsRUFBRSxDQUFDO1lBQ3JCLE9BQU8sQ0FBQyxLQUFLLENBQUMseUNBQXlDLEVBQUUsV0FBVyxDQUFDLENBQUE7UUFDdkUsQ0FBQztJQUNILENBQUM7SUFFRDs7Ozs7Ozs7Ozs7Ozs7T0FjRztJQUNILDRCQUE0QixDQUFDLEVBQUMsS0FBSyxFQUFFLE1BQU0sRUFBRSxPQUFPLEVBQUUsS0FBSyxFQUFFLFNBQVMsRUFBRSxhQUFhLEVBQUUsUUFBUSxFQUFFLGFBQWEsRUFBQztRQUM3Rzs7bUNBRTJCO1FBQzNCLElBQUksTUFBTSxDQUFBO1FBRVYsTUFBTSxHQUFHLElBQUksQ0FBQyxnQkFBZ0IsQ0FBQyxFQUFDLEtBQUssRUFBRSxNQUFNLEVBQUUsT0FBTyxFQUFFLEtBQUssRUFBRSxTQUFTLEVBQUUsYUFBYSxFQUFFLFFBQVEsRUFBRSxhQUFhLEVBQUMsQ0FBQyxDQUFDLE9BQU8sQ0FBQyxHQUFHLEVBQUU7WUFDOUgsSUFBSSxDQUFDLGVBQWUsQ0FBQyxNQUFNLENBQUMsTUFBTSxDQUFDLENBQUE7UUFDckMsQ0FBQyxDQUFDLENBQUE7UUFFRixJQUFJLENBQUMsZUFBZSxDQUFDLEdBQUcsQ0FBQyxNQUFNLENBQUMsQ0FBQTtJQUNsQyxDQUFDO0NBQ0YiLCJzb3VyY2VzQ29udGVudCI6WyIvLyBAdHMtY2hlY2tcblxuaW1wb3J0IG5ldCBmcm9tIFwibmV0XCJcbmltcG9ydCB7IGZvcmssIHNwYXduIH0gZnJvbSBcIm5vZGU6Y2hpbGRfcHJvY2Vzc1wiXG5pbXBvcnQgSnNvblNvY2tldCBmcm9tIFwiLi9qc29uLXNvY2tldC5qc1wiXG5pbXBvcnQgQmFja2dyb3VuZEpvYlJlZ2lzdHJ5IGZyb20gXCIuL2pvYi1yZWdpc3RyeS5qc1wiXG5pbXBvcnQgY29uZmlndXJhdGlvblJlc29sdmVyIGZyb20gXCIuLi9jb25maWd1cmF0aW9uLXJlc29sdmVyLmpzXCJcbmltcG9ydCBCYWNrZ3JvdW5kSm9ic1N0YXR1c1JlcG9ydGVyIGZyb20gXCIuL3N0YXR1cy1yZXBvcnRlci5qc1wiXG5pbXBvcnQgeyByYW5kb21VVUlEIH0gZnJvbSBcImNyeXB0b1wiXG5pbXBvcnQgeyBmaWxlVVJMVG9QYXRoIH0gZnJvbSBcIm5vZGU6dXJsXCJcbmltcG9ydCBzaHV0ZG93bkxpZmVjeWNsZSwgeyBydW5TaHV0ZG93blN0ZXBzIH0gZnJvbSBcIi4uL3V0aWxzL3NodXRkb3duLWxpZmVjeWNsZS5qc1wiXG5pbXBvcnQgQmFja2dyb3VuZEpvYlJlc2NoZWR1bGVTaWduYWwgZnJvbSBcIi4vcmVzY2hlZHVsZS1zaWduYWwuanNcIlxuaW1wb3J0IHBlcmZvcm1CYWNrZ3JvdW5kSm9iIGZyb20gXCIuL3BlcmZvcm0tam9iLmpzXCJcbmltcG9ydCB7IHJ1bldpdGhCYWNrZ3JvdW5kSm9iUGF5bG9hZCB9IGZyb20gXCIuL2V4ZWN1dGlvbi1jb250ZXh0LmpzXCJcbmltcG9ydCB7IGNyZWF0ZUdlbmVyYXRpb25Xb3JrZXJJZCB9IGZyb20gXCIuL2dlbmVyYXRpb24taWRlbnRpdHkuanNcIlxuaW1wb3J0IEJhY2tncm91bmRKb2JzR2VuZXJhdGlvbkhhbmRzaGFrZVRpbWVvdXRFcnJvciwgeyBERUZBVUxUX0dFTkVSQVRJT05fSEFORFNIQUtFX1RJTUVPVVRfTVMsIHZhbGlkYXRlR2VuZXJhdGlvbkhhbmRzaGFrZVRpbWVvdXRNcyB9IGZyb20gXCIuL2dlbmVyYXRpb24taGFuZHNoYWtlLXRpbWVvdXQtZXJyb3IuanNcIlxuaW1wb3J0IHsgUE9PTEVEX1JVTk5FUl9JTkZMSUdIVF9KT0JfSURfTElNSVQsIGJvdW5kZWRQb29sZWRSdW5uZXJJbmZsaWdodEpvYklkcywgaXNQb29sZWRDaGlsZFNodXRkb3duUmVhc29uLCBpc1Bvb2xlZENoaWxkU2h1dGRvd25TaWduYWwgfSBmcm9tIFwiLi9wb29sZWQtcnVubmVyLXNodXRkb3duLmpzXCJcblxuLyoqXG4gKiBQZXItZm9ya2VkLWNoaWxkIHRpbWVvdXQgYm9va2tlZXBpbmcuXG4gKiBAdHlwZWRlZiB7b2JqZWN0fSBGb3JrZWRKb2JUaW1lb3V0U3RhdGVcbiAqIEBwcm9wZXJ0eSB7Ym9vbGVhbn0gdGltZWRPdXQgLSBXaGV0aGVyIHRoZSB0aW1lb3V0IGZpcmVkIGFuZCB0aGUgY2hpbGQgd2FzIHRlcm1pbmF0ZWQuXG4gKiBAcHJvcGVydHkge251bWJlciB8IG51bGx9IHRpbWVvdXRNcyAtIFRoZSBhcm1lZCB0aW1lb3V0IGluIG1zLCBvciBudWxsIHdoZW4gZGlzYWJsZWQuXG4gKiBAcHJvcGVydHkge1JldHVyblR5cGU8dHlwZW9mIHNldFRpbWVvdXQ+IHwgbnVsbH0gdGltZXIgLSBUaGUgcGVuZGluZyB0aW1lb3V0IHRpbWVyLCBjbGVhcmVkIG9uIGV4aXQuXG4gKiBAcHJvcGVydHkge1JldHVyblR5cGU8dHlwZW9mIHNldFRpbWVvdXQ+IHwgbnVsbH0gc2lna2lsbFRpbWVyIC0gVGhlIHBlbmRpbmcgU0lHS0lMTCBncmFjZSB0aW1lciwgY2xlYXJlZCBvbiBleGl0LlxuICovXG4vKipcbiAqIEB0eXBlZGVmIHtvYmplY3R9IFBvb2xlZEpvYkVudHJ5XG4gKiBAcHJvcGVydHkge2ltcG9ydChcIi4vdHlwZXMuanNcIikuQmFja2dyb3VuZEpvYlBheWxvYWQgJiB7aWQ6IHN0cmluZ319IHBheWxvYWQgLSBEdXJhYmxlIGpvYiBwYXlsb2FkLlxuICogQHByb3BlcnR5IHsodmFsdWU6IHZvaWQpID0+IHZvaWR9IFtyZXNvbHZlXSAtIENvbXBsZXRpb24gcmVzb2x2ZXIuXG4gKiBAcHJvcGVydHkge1Byb21pc2U8dm9pZD59IFtwb29sZWRKb2JdIC0gVHJhY2tlZCBwb29sZWQtam9iIHByb21pc2UuXG4gKiBAcHJvcGVydHkge1JldHVyblR5cGU8dHlwZW9mIHNldFRpbWVvdXQ+IHwgbnVsbH0gW3RpbWVvdXRUaW1lcl0gLSBQZXItam9iIHRpbWVvdXQgdGltZXIuXG4gKi9cbi8qKlxuICogQHR5cGVkZWYge29iamVjdH0gUG9vbGVkQ2hpbGRTdGF0ZVxuICogQHByb3BlcnR5IHtudW1iZXJ9IGNyZWF0ZWRBdE1zIC0gQ2hpbGQgY3JlYXRpb24gdGltZXN0YW1wLlxuICogQHByb3BlcnR5IHtzdHJpbmd9IFtjaGlsZEluc3RhbmNlSWRdIC0gU3RhYmxlIGlkZW50aXR5IHJlcG9ydGVkIGJ5IHRoZSBjaGlsZC5cbiAqIEBwcm9wZXJ0eSB7bnVtYmVyfSBqb2JzUnVuIC0gQWNrbm93bGVkZ2VkIGpvYnMgY29tcGxldGVkIGJ5IHRoaXMgY2hpbGQuXG4gKiBAcHJvcGVydHkge01hcDxzdHJpbmcsIFBvb2xlZEpvYkVudHJ5Pn0gaW5mbGlnaHQgLSBKb2JzIGN1cnJlbnRseSBvd25lZCBieSB0aGlzIGNoaWxkLlxuICogQHByb3BlcnR5IHtudW1iZXJ9IGxhc3REaXNwYXRjaFNlcSAtIFJvdW5kLXJvYmluIGRpc3BhdGNoIHNlcXVlbmNlLlxuICogQHByb3BlcnR5IHtib29sZWFufSByZXRpcmluZyAtIFdoZXRoZXIgdGhpcyBjaGlsZCBpcyBkcmFpbmluZyBiZWZvcmUgcmV0aXJlbWVudC5cbiAqIEBwcm9wZXJ0eSB7Ym9vbGVhbn0gW3N0YXJ0ZWRdIC0gV2hldGhlciB0aGUgY2hpbGQgY29tcGxldGVkIGl0cyBzdGFydHVwIGhhbmRzaGFrZS5cbiAqIEBwcm9wZXJ0eSB7Ym9vbGVhbn0gW3NldHRsaW5nXSAtIFdoZXRoZXIgZmFpbHVyZSBoYW5kbGluZyBhbHJlYWR5IG93bnMgdGhpcyBjaGlsZC5cbiAqIEBwcm9wZXJ0eSB7aW1wb3J0KFwiLi90eXBlcy5qc1wiKS5Qb29sZWRDaGlsZE1lbW9yeU9ic2VydmF0aW9ufSBbbGFzdE1lbW9yeU9ic2VydmF0aW9uXSAtIExhdGVzdCBtZW1vcnkgb2JzZXJ2YXRpb24gcmVjZWl2ZWQgZnJvbSB0aGlzIGNoaWxkLlxuICogQHByb3BlcnR5IHtudW1iZXJ9IFtpcGNEaXNjb25uZWN0ZWRBdE1zXSAtIFBhcmVudCBvYnNlcnZhdGlvbiBvZiBJUEMgZGlzY29ubmVjdC5cbiAqIEBwcm9wZXJ0eSB7aW1wb3J0KFwiLi90eXBlcy5qc1wiKS5Qb29sZWRDaGlsZFNodXRkb3duT2JzZXJ2YXRpb259IFtzaHV0ZG93bk9ic2VydmF0aW9uXSAtIENoaWxkIG9ic2VydmF0aW9uIHNlbnQgYmVmb3JlIHRlYXJkb3duLlxuICogQHByb3BlcnR5IHtpbXBvcnQoXCIuL3R5cGVzLmpzXCIpLlBvb2xlZENoaWxkU2h1dGRvd25SZWFzb259IFtzaHV0ZG93blJlYXNvbl0gLSBFeGFjdCBwYXJlbnQtcmVxdWVzdGVkIHNodXRkb3duIHJlYXNvbi5cbiAqIEBwcm9wZXJ0eSB7bnVtYmVyfSBbc2h1dGRvd25SZXF1ZXN0ZWRBdE1zXSAtIEV4YWN0IHBhcmVudCBzaHV0ZG93bi1yZXF1ZXN0IHRpbWVzdGFtcC5cbiAqIEBwcm9wZXJ0eSB7aW1wb3J0KFwibm9kZTpjaGlsZF9wcm9jZXNzXCIpLkNoaWxkUHJvY2Vzc1tcInNpZ25hbENvZGVcIl19IFtzaHV0ZG93blNpZ25hbF0gLSBTaWduYWwgc2VsZWN0ZWQgYnkgdGhlIHBhcmVudCByZXF1ZXN0LlxuICogQHByb3BlcnR5IHtSZXR1cm5UeXBlPHR5cGVvZiBzZXRUaW1lb3V0Pn0gW3NodXRkb3duU2lnbmFsVGltZXJdIC0gRHJhaW5lZC1yZXRpcmVtZW50IGZhbGxiYWNrIHNpZ25hbCB0aW1lci5cbiAqIEBwcm9wZXJ0eSB7UmV0dXJuVHlwZTx0eXBlb2Ygc2V0VGltZW91dD4gfCBudWxsfSBbdGltZW91dFNpZ2tpbGxUaW1lcl0gLSBQZW5kaW5nIHRpbWVvdXQgU0lHS0lMTCB0aW1lci5cbiAqIEBwcm9wZXJ0eSB7c3RyaW5nfSBbdGltZW91dEpvYklkXSAtIEpvYiB3aG9zZSB0aW1lb3V0IGluaXRpYXRlZCB0ZXJtaW5hdGlvbi5cbiAqL1xuLyoqIEdyYWNlIHBlcmlvZCBhZnRlciBTSUdURVJNIGJlZm9yZSBhIGxpbmdlcmluZyBwcm9jZXNzIHJ1bm5lciBpcyBTSUdLSUxMZWQuICovXG5jb25zdCBGT1JLRURfQ0hJTERfU0lHS0lMTF9HUkFDRV9NUyA9IDUwMDBcbi8qKiBUaW1lIGEgZHJhaW5lZCByZXRpcmVtZW50IGdpdmVzIHRoZSBjaGlsZCBJUEMgcmVxdWVzdCB0byBiZWdpbiB0ZWFyZG93biBiZWZvcmUgU0lHVEVSTSBmYWxsYmFjay4gKi9cbmNvbnN0IFBPT0xFRF9SVU5ORVJfU0hVVERPV05fUkVRVUVTVF9HUkFDRV9NUyA9IDI1MFxuLyoqXG4gKiBMYXJnZXN0IGRlbGF5IE5vZGUncyBgc2V0VGltZW91dGAgYWNjZXB0cyB3aXRob3V0IG92ZXJmbG93aW5nIHRvIGEgMW1zIGRlbGF5XG4gKiAoYSAzMi1iaXQgc2lnbmVkIGludCBvZiBtcywgfjI0LjggZGF5cykuIEEgYGpvYlRpbWVvdXRNc2AgYWJvdmUgdGhpcyDigJQgb3IgYVxuICogbm9uLWZpbml0ZSBvbmUgbGlrZSBgSW5maW5pdHlgIOKAlCBpcyBjbGFtcGVkL2Rpc2FibGVkIHJhdGhlciB0aGFuIGNvZXJjZWQgdG9cbiAqIH4xbXMsIHdoaWNoIHdvdWxkIG90aGVyd2lzZSB0ZXJtaW5hdGUgZXZlcnkgZm9ya2VkIGpvYiBhbG1vc3QgaW1tZWRpYXRlbHkuXG4gKi9cbmNvbnN0IE1BWF9GT1JLRURfSk9CX1RJTUVPVVRfTVMgPSAyXzE0N180ODNfNjQ3XG5jb25zdCBGT1JLRURfUlVOTkVSX0VOVFJZX1BBVEggPSBmaWxlVVJMVG9QYXRoKG5ldyBVUkwoXCIuL2ZvcmtlZC1ydW5uZXItY2hpbGQuanNcIiwgaW1wb3J0Lm1ldGEudXJsKSlcbmNvbnN0IFBPT0xFRF9SVU5ORVJfRU5UUllfUEFUSCA9IGZpbGVVUkxUb1BhdGgobmV3IFVSTChcIi4vcG9vbGVkLXJ1bm5lci1jaGlsZC5qc1wiLCBpbXBvcnQubWV0YS51cmwpKVxuLyoqIEhvdyBvZnRlbiB0aGUgd29ya2VyIHNlbmRzIGEgbGl2ZW5lc3MgaGVhcnRiZWF0IHRvIHRoZSBtYWluLiAqL1xuY29uc3QgSEVBUlRCRUFUX0lOVEVSVkFMX01TID0gMTUwMDBcbi8qKlxuICogTWF4IHRpbWUgdGhlIHdvcmtlciBzcGVuZHMgcmV0cnlpbmcgb25lIHBvb2xlZCBjaGlsZCdzIGFjY2VwdGFuY2UgcmVwb3J0XG4gKiBiZWZvcmUgZHJvcHBpbmcgaXQuIEFjY2VwdGFuY2UgZXZpZGVuY2UgaXMgZGlhZ25vc3RpYyDigJQgYSBwZXJzaXN0ZW50XG4gKiBtYWluL0RCIG91dGFnZSBtdXN0IG5vdCBob2xkIHJ1bm5lciBjYXBhY2l0eSBob3N0YWdlLlxuICovXG5jb25zdCBDSElMRF9BQ0NFUFRBTkNFX1JFUE9SVF9NQVhfRFVSQVRJT05fTVMgPSAxMDAwMFxuLyoqIFRDUCBrZWVwYWxpdmUgc28gYSBoYWxmLW9wZW4gY29ubmVjdGlvbiB0byB0aGUgbWFpbiBzdXJmYWNlcyBhcyBhIGNsb3NlLiAqL1xuY29uc3QgU09DS0VUX0tFRVBBTElWRV9NUyA9IDEwMDAwXG4vKipcbiAqIEV4ZWN1dGlvbiBtb2Rlcy5cbiAqIEB0eXBlIHtpbXBvcnQoXCIuL3R5cGVzLmpzXCIpLkJhY2tncm91bmRKb2JFeGVjdXRpb25Nb2RlW119ICovXG5jb25zdCBFWEVDVVRJT05fTU9ERVMgPSBbXCJpbmxpbmVcIiwgXCJmb3JrZWRcIiwgXCJwb29sZWRcIiwgXCJzcGF3bmVkXCJdXG5cbi8qKlxuICogTm9ybWFsaXplcyBhIGNhbmRpZGF0ZSBwb29sZWQtcnVubmVyIGNvdW50IG9yIGpvYiBsaW1pdC5cbiAqIEBwYXJhbSB7bnVtYmVyIHwgdW5kZWZpbmVkfSB2YWx1ZSAtIENhbmRpZGF0ZSBwb3NpdGl2ZSBpbnRlZ2VyLlxuICogQHJldHVybnMge251bWJlciB8IHVuZGVmaW5lZH0gLSBOb3JtYWxpemVkIHZhbHVlLlxuICovXG5mdW5jdGlvbiBwb3NpdGl2ZUludGVnZXIodmFsdWUpIHtcbiAgcmV0dXJuIHR5cGVvZiB2YWx1ZSA9PT0gXCJudW1iZXJcIiAmJiBOdW1iZXIuaXNJbnRlZ2VyKHZhbHVlKSAmJiB2YWx1ZSA+IDAgPyB2YWx1ZSA6IHVuZGVmaW5lZFxufVxuXG4vKipcbiAqIENoZWNrcyB3aGV0aGVyIGFuIElQQyB2YWx1ZSBpcyBhIHBvb2xlZCBjaGlsZCdzIGFjY2VwdGFuY2Ugb2JzZXJ2YXRpb24gZm9yXG4gKiBvbmUgam9iLiBUaGUgY2hpbGQgY2FycmllcyBpdHMgZXhhY3QgaGFuZG9mZiBsZWFzZSBzbyB0aGUgd29ya2VyIGNhbiBmb3J3YXJkXG4gKiB0aGUgcmVwb3J0IHdpdGhvdXQgZGVwZW5kaW5nIG9uIGl0cyBpbi1mbGlnaHQgZW50cnkgc3RpbGwgZXhpc3RpbmcuXG4gKiBAcGFyYW0ge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSBtZXNzYWdlIC0gSVBDIG1lc3NhZ2UuXG4gKiBAcmV0dXJucyB7bWVzc2FnZSBpcyB7dHlwZTogXCJqb2ItcmVjZWl2ZWRcIiB8IFwiam9iLXN0YXJ0ZWRcIiwgam9iSWQ6IHN0cmluZywgaGFuZG9mZklkPzogc3RyaW5nLCB3b3JrZXJJZD86IHN0cmluZywgaGFuZGVkT2ZmQXRNcz86IG51bWJlciwgcmVjZWl2ZWRBdE1zPzogbnVtYmVyLCBzdGFydGVkQXRNcz86IG51bWJlciwgY2hpbGRJbnN0YW5jZUlkPzogc3RyaW5nLCBjaGlsZFBpZD86IG51bWJlcn19IC0gV2hldGhlciB0aGlzIGlzIGEgdmFsaWQgYWNjZXB0YW5jZSBtZXNzYWdlLlxuICovXG5mdW5jdGlvbiBpc0NoaWxkQWNjZXB0YW5jZU1lc3NhZ2UobWVzc2FnZSkge1xuICBpZiAoIW1lc3NhZ2UgfHwgdHlwZW9mIG1lc3NhZ2UgIT09IFwib2JqZWN0XCIpIHJldHVybiBmYWxzZVxuICBjb25zdCByZWNvcmQgPSAvKiogQHR5cGUge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gKi8gKG1lc3NhZ2UpXG5cbiAgcmV0dXJuIChyZWNvcmQudHlwZSA9PT0gXCJqb2ItcmVjZWl2ZWRcIiB8fCByZWNvcmQudHlwZSA9PT0gXCJqb2Itc3RhcnRlZFwiKVxuICAgICYmIHR5cGVvZiByZWNvcmQuam9iSWQgPT09IFwic3RyaW5nXCJcbiAgICAmJiAocmVjb3JkLmhhbmRvZmZJZCA9PT0gdW5kZWZpbmVkIHx8IHR5cGVvZiByZWNvcmQuaGFuZG9mZklkID09PSBcInN0cmluZ1wiKVxuICAgICYmIChyZWNvcmQud29ya2VySWQgPT09IHVuZGVmaW5lZCB8fCB0eXBlb2YgcmVjb3JkLndvcmtlcklkID09PSBcInN0cmluZ1wiKVxuICAgICYmIChyZWNvcmQuaGFuZGVkT2ZmQXRNcyA9PT0gdW5kZWZpbmVkIHx8IHR5cGVvZiByZWNvcmQuaGFuZGVkT2ZmQXRNcyA9PT0gXCJudW1iZXJcIilcbiAgICAmJiAocmVjb3JkLnJlY2VpdmVkQXRNcyA9PT0gdW5kZWZpbmVkIHx8IHR5cGVvZiByZWNvcmQucmVjZWl2ZWRBdE1zID09PSBcIm51bWJlclwiKVxuICAgICYmIChyZWNvcmQuc3RhcnRlZEF0TXMgPT09IHVuZGVmaW5lZCB8fCB0eXBlb2YgcmVjb3JkLnN0YXJ0ZWRBdE1zID09PSBcIm51bWJlclwiKVxuICAgICYmIChyZWNvcmQuY2hpbGRJbnN0YW5jZUlkID09PSB1bmRlZmluZWQgfHwgdHlwZW9mIHJlY29yZC5jaGlsZEluc3RhbmNlSWQgPT09IFwic3RyaW5nXCIpXG4gICAgJiYgKHJlY29yZC5jaGlsZFBpZCA9PT0gdW5kZWZpbmVkIHx8IE51bWJlci5pc0ludGVnZXIocmVjb3JkLmNoaWxkUGlkKSlcbn1cblxuLyoqXG4gKiBDaGVja3Mgd2hldGhlciBhbiBJUEMgdmFsdWUgaXMgdGhlIGNoaWxkJ3MgYm91bmRlZCBwcmUtdGVhcmRvd24gb2JzZXJ2YXRpb24uXG4gKiBAcGFyYW0ge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSBtZXNzYWdlIC0gSVBDIG1lc3NhZ2UuXG4gKiBAcmV0dXJucyB7bWVzc2FnZSBpcyBpbXBvcnQoXCIuL3R5cGVzLmpzXCIpLlBvb2xlZENoaWxkU2h1dGRvd25PYnNlcnZhdGlvbiAmIHt0eXBlOiBcInNodXRkb3duLW9ic2VydmF0aW9uXCJ9fSAtIFdoZXRoZXIgdGhpcyBpcyBhIHZhbGlkIHNodXRkb3duIG9ic2VydmF0aW9uLlxuICovXG5mdW5jdGlvbiBpc0NoaWxkU2h1dGRvd25PYnNlcnZhdGlvbk1lc3NhZ2UobWVzc2FnZSkge1xuICBpZiAoIW1lc3NhZ2UgfHwgdHlwZW9mIG1lc3NhZ2UgIT09IFwib2JqZWN0XCIpIHJldHVybiBmYWxzZVxuICBjb25zdCByZWNvcmQgPSAvKiogQHR5cGUge3tjaGlsZEluc3RhbmNlSWQ/OiBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPiwgaW5mbGlnaHRKb2JJZHM/OiBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPiwgaW5mbGlnaHRKb2JJZHNUcnVuY2F0ZWRDb3VudD86IFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+LCByZWFzb24/OiBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPiwgc2h1dGRvd25PYnNlcnZlZEF0TXM/OiBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPiwgc2h1dGRvd25SZXF1ZXN0ZWRBdE1zPzogUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4sIHNpZ25hbD86IFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+LCB0eXBlPzogUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59fSAqLyAobWVzc2FnZSlcblxuICByZXR1cm4gcmVjb3JkLnR5cGUgPT09IFwic2h1dGRvd24tb2JzZXJ2YXRpb25cIlxuICAgICYmIHR5cGVvZiByZWNvcmQuY2hpbGRJbnN0YW5jZUlkID09PSBcInN0cmluZ1wiXG4gICAgJiYgQXJyYXkuaXNBcnJheShyZWNvcmQuaW5mbGlnaHRKb2JJZHMpXG4gICAgJiYgcmVjb3JkLmluZmxpZ2h0Sm9iSWRzLmxlbmd0aCA8PSBQT09MRURfUlVOTkVSX0lORkxJR0hUX0pPQl9JRF9MSU1JVFxuICAgICYmIHJlY29yZC5pbmZsaWdodEpvYklkcy5ldmVyeSgoam9iSWQpID0+IHR5cGVvZiBqb2JJZCA9PT0gXCJzdHJpbmdcIilcbiAgICAmJiBOdW1iZXIuaXNJbnRlZ2VyKHJlY29yZC5pbmZsaWdodEpvYklkc1RydW5jYXRlZENvdW50KVxuICAgICYmIHJlY29yZC5pbmZsaWdodEpvYklkc1RydW5jYXRlZENvdW50ID49IDBcbiAgICAmJiBpc1Bvb2xlZENoaWxkU2h1dGRvd25SZWFzb24ocmVjb3JkLnJlYXNvbilcbiAgICAmJiB0eXBlb2YgcmVjb3JkLnNodXRkb3duT2JzZXJ2ZWRBdE1zID09PSBcIm51bWJlclwiXG4gICAgJiYgTnVtYmVyLmlzRmluaXRlKHJlY29yZC5zaHV0ZG93bk9ic2VydmVkQXRNcylcbiAgICAmJiAocmVjb3JkLnNodXRkb3duUmVxdWVzdGVkQXRNcyA9PT0gbnVsbCB8fCAodHlwZW9mIHJlY29yZC5zaHV0ZG93blJlcXVlc3RlZEF0TXMgPT09IFwibnVtYmVyXCIgJiYgTnVtYmVyLmlzRmluaXRlKHJlY29yZC5zaHV0ZG93blJlcXVlc3RlZEF0TXMpKSlcbiAgICAmJiBpc1Bvb2xlZENoaWxkU2h1dGRvd25TaWduYWwocmVjb3JkLnNpZ25hbClcbn1cblxuLyoqXG4gKiBDaGVja3Mgd2hldGhlciBhbiBJUEMgdmFsdWUgaXMgYSBwb29sZWQgY2hpbGQncyBib3VuZGVkIG1lbW9yeSBvYnNlcnZhdGlvbi5cbiAqIFRoZSBwb29sZWQgY2hpbGQncyBzdGRpbyBpcyBpZ25vcmVkIGJ5IHRoZSB3b3JrZXIgZm9yaywgc28gdGhpcyBvYnNlcnZhdGlvblxuICogKHBlcmlvZGljIHdoaWxlIGpvYnMgcnVuLCBwbHVzIG9uIGRlbWFuZCkgaXMgaG93IGEgbWVtb3J5IHByb2JsZW0gaW4gYVxuICogcnVubmluZyBjaGlsZCBuYW1lcyBpdHNlbGYuIFRoZSB3b3JrZXIgbG9ncyBpdCAoaXRzIHN0ZGVyciByZWFjaGVzIHRoZSBwcm9kXG4gKiBsb2cpIGFuZCBmb3J3YXJkcyBpdCB0byB0aGUgb3B0aW9uYWwgYG9uUG9vbGVkUnVubmVyTWVtb3J5T2JzZXJ2YXRpb25gIGhvb2suXG4gKiBAcGFyYW0ge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSBtZXNzYWdlIC0gSVBDIG1lc3NhZ2UuXG4gKiBAcmV0dXJucyB7bWVzc2FnZSBpcyBpbXBvcnQoXCIuL3R5cGVzLmpzXCIpLlBvb2xlZENoaWxkTWVtb3J5T2JzZXJ2YXRpb259IC0gV2hldGhlciB0aGlzIGlzIGEgdmFsaWQgbWVtb3J5IG9ic2VydmF0aW9uLlxuICovXG5mdW5jdGlvbiBpc1Bvb2xlZENoaWxkTWVtb3J5T2JzZXJ2YXRpb25NZXNzYWdlKG1lc3NhZ2UpIHtcbiAgaWYgKCFtZXNzYWdlIHx8IHR5cGVvZiBtZXNzYWdlICE9PSBcIm9iamVjdFwiKSByZXR1cm4gZmFsc2VcbiAgY29uc3QgcmVjb3JkID0gLyoqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59ICovIChtZXNzYWdlKVxuICBjb25zdCBoZWFwU3RhdGlzdGljcyA9IC8qKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+IHwgdW5kZWZpbmVkfSAqLyAocmVjb3JkLmhlYXBTdGF0aXN0aWNzKVxuICBjb25zdCBtZW1vcnlVc2FnZSA9IC8qKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+IHwgdW5kZWZpbmVkfSAqLyAocmVjb3JkLm1lbW9yeVVzYWdlKVxuXG4gIHJldHVybiByZWNvcmQudHlwZSA9PT0gXCJwb29sZWQtY2hpbGQtbWVtb3J5XCJcbiAgICAmJiB0eXBlb2YgcmVjb3JkLmNoaWxkSW5zdGFuY2VJZCA9PT0gXCJzdHJpbmdcIlxuICAgICYmIE51bWJlci5pc0ludGVnZXIocmVjb3JkLmNoaWxkUGlkKVxuICAgICYmIHR5cGVvZiByZWNvcmQucnNzQnl0ZXMgPT09IFwibnVtYmVyXCJcbiAgICAmJiBOdW1iZXIuaXNGaW5pdGUocmVjb3JkLnJzc0J5dGVzKVxuICAgICYmIE51bWJlci5pc0ludGVnZXIocmVjb3JkLmpvYkNvdW50KVxuICAgICYmIHJlY29yZC5qb2JDb3VudCA+PSAwXG4gICAgJiYgQXJyYXkuaXNBcnJheShyZWNvcmQuYWN0aXZlSm9iSWRzKVxuICAgICYmIHJlY29yZC5hY3RpdmVKb2JJZHMuZXZlcnkoKGpvYklkKSA9PiB0eXBlb2Ygam9iSWQgPT09IFwic3RyaW5nXCIpXG4gICAgJiYgTnVtYmVyLmlzSW50ZWdlcihyZWNvcmQuYWN0aXZlSm9iSWRzVHJ1bmNhdGVkQ291bnQpXG4gICAgJiYgcmVjb3JkLmFjdGl2ZUpvYklkc1RydW5jYXRlZENvdW50ID49IDBcbiAgICAmJiB0eXBlb2YgcmVjb3JkLm9ic2VydmVkQXRNcyA9PT0gXCJudW1iZXJcIlxuICAgICYmIE51bWJlci5pc0Zpbml0ZShyZWNvcmQub2JzZXJ2ZWRBdE1zKVxuICAgICYmIGhlYXBTdGF0aXN0aWNzICE9PSB1bmRlZmluZWQgJiYgdHlwZW9mIGhlYXBTdGF0aXN0aWNzID09PSBcIm9iamVjdFwiXG4gICAgJiYgbWVtb3J5VXNhZ2UgIT09IHVuZGVmaW5lZCAmJiB0eXBlb2YgbWVtb3J5VXNhZ2UgPT09IFwib2JqZWN0XCJcbn1cblxuLyoqXG4gKiBOb3JtYWxpemVzIGEgY2FuZGlkYXRlIHBvb2xlZC1ydW5uZXIgcmVzb3VyY2UgbGltaXQuXG4gKiBAcGFyYW0ge251bWJlciB8IHVuZGVmaW5lZH0gdmFsdWUgLSBDYW5kaWRhdGUgcG9zaXRpdmUgbnVtYmVyLlxuICogQHJldHVybnMge251bWJlciB8IHVuZGVmaW5lZH0gLSBOb3JtYWxpemVkIHZhbHVlLlxuICovXG5mdW5jdGlvbiBwb3NpdGl2ZU51bWJlcih2YWx1ZSkge1xuICByZXR1cm4gdHlwZW9mIHZhbHVlID09PSBcIm51bWJlclwiICYmIE51bWJlci5pc0Zpbml0ZSh2YWx1ZSkgJiYgdmFsdWUgPiAwID8gdmFsdWUgOiB1bmRlZmluZWRcbn1cblxuZXhwb3J0IGRlZmF1bHQgY2xhc3MgQmFja2dyb3VuZEpvYnNXb3JrZXIge1xuICAvKipcbiAgICogUnVucyBjb25zdHJ1Y3Rvci5cbiAgICogQHBhcmFtIHtvYmplY3R9IFthcmdzXSAtIE9wdGlvbnMuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vY29uZmlndXJhdGlvbi5qc1wiKS5kZWZhdWx0fSBbYXJncy5jb25maWd1cmF0aW9uXSAtIENvbmZpZ3VyYXRpb24uXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBbYXJncy5ob3N0XSAtIEhvc3RuYW1lLlxuICAgKiBAcGFyYW0ge251bWJlcn0gW2FyZ3MucG9ydF0gLSBQb3J0LlxuICAgKiBAcGFyYW0ge3N0cmluZ30gW2FyZ3MuZ2VuZXJhdGlvbklkXSAtIEV4cGxpY2l0IHJlbGVhc2UgZ2VuZXJhdGlvbiBpZGVudGl0eS5cbiAgICogQHBhcmFtIHtzdHJpbmd9IFthcmdzLndvcmtlckluc3RhbmNlSWRdIC0gRXhwbGljaXQgc3RhYmxlIHdvcmtlciBVVUlELlxuICAgKiBAcGFyYW0ge251bWJlcn0gW2FyZ3MubWF4Q29uY3VycmVudEZvcmtlZEpvYnNdIC0gT3ZlcnJpZGUgdGhlIHByb2Nlc3MgcnVubmVyIGNvbmN1cnJlbmN5IGNhcCBmcm9tIGBjb25maWd1cmF0aW9uLmdldEJhY2tncm91bmRKb2JzQ29uZmlnKClgLlxuICAgKiBAcGFyYW0ge251bWJlcn0gW2FyZ3MubWF4Q29uY3VycmVudElubGluZUpvYnNdIC0gT3ZlcnJpZGUgdGhlIGlubGluZS1qb2IgY29uY3VycmVuY3kgY2FwIGZyb20gYGNvbmZpZ3VyYXRpb24uZ2V0QmFja2dyb3VuZEpvYnNDb25maWcoKWAuXG4gICAqIEBwYXJhbSB7bnVtYmVyfSBbYXJncy5wb29sZWRSdW5uZXJDb3VudF0gLSBPdmVycmlkZSB0aGUgcG9vbGVkIHJ1bm5lciBjb3VudC5cbiAgICogQHBhcmFtIHtudW1iZXJ9IFthcmdzLnBvb2xlZFJ1bm5lckNvbmN1cnJlbmN5XSAtIE92ZXJyaWRlIHRoZSBwZXItcnVubmVyIGNvbmN1cnJlbmN5LlxuICAgKiBAcGFyYW0ge251bWJlcn0gW2FyZ3MucG9vbGVkUnVubmVyTWF4Sm9ic10gLSBPdmVycmlkZSB0aGUgcGVyLXJ1bm5lciByZWN5Y2xlIGpvYiBjb3VudC5cbiAgICogQHBhcmFtIHtudW1iZXJ9IFthcmdzLnBvb2xlZFJ1bm5lck1heFJzc0J5dGVzXSAtIE92ZXJyaWRlIHRoZSBwZXItcnVubmVyIHJlY3ljbGUgUlNTIGxpbWl0LlxuICAgKiBAcGFyYW0ge251bWJlcn0gW2FyZ3MucG9vbGVkUnVubmVyTWF4TGlmZXRpbWVNc10gLSBPdmVycmlkZSB0aGUgcGVyLXJ1bm5lciByZWN5Y2xlIGxpZmV0aW1lLlxuICAgKiBAcGFyYW0ge251bWJlcn0gW2FyZ3MuZm9ya2VkQ2hpbGRTaWdraWxsR3JhY2VNc10gLSBPdmVycmlkZSB0aGUgZ3JhY2UgcGVyaW9kIGJldHdlZW4gU0lHVEVSTSBhbmQgU0lHS0lMTCB3aGVuIHJlYXBpbmcgbGluZ2VyaW5nIHByb2Nlc3MgcnVubmVycyBvbiBzdG9wLlxuICAgKiBAcGFyYW0ge251bWJlcn0gW2FyZ3MuaGVhcnRiZWF0SW50ZXJ2YWxNc10gLSBPdmVycmlkZSB0aGUgbGl2ZW5lc3MgaGVhcnRiZWF0IGludGVydmFsIChkZWZhdWx0IDE1MDAwbXMpLlxuICAgKiBAcGFyYW0ge251bWJlcn0gW2FyZ3MuZ2VuZXJhdGlvbkhhbmRzaGFrZVRpbWVvdXRNc10gLSBNYXhpbXVtIHRpbWUgdG8gd2FpdCBmb3IgZ2VuZXJhdGlvbiBhY2tub3dsZWRnZW1lbnQgKGRlZmF1bHQ6IDQwMDApLlxuICAgKiBAcGFyYW0ge251bWJlcn0gW2FyZ3MucmVjb25uZWN0RGVsYXlNc10gLSBEZWxheSBiZWZvcmUgcmVjb25uZWN0aW5nIGFuIGVzdGFibGlzaGVkIHdvcmtlciBjb25uZWN0aW9uIChkZWZhdWx0OiAxMDAwKS5cbiAgICogQHBhcmFtIHtudW1iZXJ9IFthcmdzLmpvYlRpbWVvdXRNc10gLSBPdmVycmlkZSB0aGUgd2FsbC1jbG9jayB0aW1lb3V0IGZvciBmb3JrZWQgYW5kIHBvb2xlZCBqb2JzIGZyb20gYGNvbmZpZ3VyYXRpb24uZ2V0QmFja2dyb3VuZEpvYnNDb25maWcoKWAuIGAwYCBkaXNhYmxlcyBpdC5cbiAgICogQHBhcmFtIHtib29sZWFufSBbYXJncy5jbG9zZURhdGFiYXNlQ29ubmVjdGlvbnNPblN0b3BdIC0gV2hldGhlciBzdG9wIG93bnMgY2xvc2luZyB0aGUgY29uZmlndXJhdGlvbidzIGRhdGFiYXNlIHBvb2xzIChkZWZhdWx0IHRydWUpLlxuICAgKiBAcGFyYW0geygpID0+IHZvaWQgfCBQcm9taXNlPHZvaWQ+fSBbYXJncy5vblN0b3BwZWRdIC0gTGlmZWN5Y2xlIGhvb2sgaW52b2tlZCBhZnRlciB0aGUgd29ya2VyIGZpbmlzaGVzIHN0b3BwaW5nLlxuICAgKiBAcGFyYW0geygpID0+IHZvaWR9IFthcmdzLm9uR2VuZXJhdGlvbkFjY2VwdGVkXSAtIEV4cGxpY2l0IGdlbmVyYXRpb24tYWNjZXB0YW5jZSBvYnNlcnZhdGlvbiBob29rLlxuICAgKiBAcGFyYW0geygpID0+IHZvaWR9IFthcmdzLm9uUmV0aXJlTWVzc2FnZV0gLSBFeHBsaWNpdCByZXRpcmUtbWVzc2FnZSBvYnNlcnZhdGlvbiBob29rLlxuICAgKiBAcGFyYW0geyhvYnNlcnZhdGlvbjogaW1wb3J0KFwiLi90eXBlcy5qc1wiKS5Qb29sZWRDaGlsZE1lbW9yeU9ic2VydmF0aW9uKSA9PiB2b2lkIHwgUHJvbWlzZTx2b2lkPn0gW2FyZ3Mub25Qb29sZWRSdW5uZXJNZW1vcnlPYnNlcnZhdGlvbl0gLSBFeHBsaWNpdCBwb29sZWQtY2hpbGQgbWVtb3J5IG9ic2VydmF0aW9uIGhvb2suIEV2ZXJ5IHZhbGlkYXRlZCBvYnNlcnZhdGlvbiAocGVyaW9kaWMgd2hpbGUgYSBjaGlsZCBoYXMgaW4tZmxpZ2h0IGpvYnMsIHBsdXMgb24gZGVtYW5kKSBpcyBmb3J3YXJkZWQgaGVyZSwgaW4gYWRkaXRpb24gdG8gdGhlIHdvcmtlcidzIGNvbXBhY3Qgc3RkZXJyIGxvZyBsaW5lLCBzbyBhbiBhcHBsaWNhdGlvbiBjYW4gcm91dGUgbWVtb3J5IGRpYWdub3N0aWNzIChlLmcuIHRvIGEgYnVnIHJlcG9ydGVyKSB3aXRob3V0IHBhcnNpbmcgbG9ncy5cbiAgICovXG4gIGNvbnN0cnVjdG9yKHtjb25maWd1cmF0aW9uLCBob3N0LCBwb3J0LCBnZW5lcmF0aW9uSWQsIHdvcmtlckluc3RhbmNlSWQsIG1heENvbmN1cnJlbnRGb3JrZWRKb2JzLCBtYXhDb25jdXJyZW50SW5saW5lSm9icywgcG9vbGVkUnVubmVyQ291bnQsIHBvb2xlZFJ1bm5lckNvbmN1cnJlbmN5LCBwb29sZWRSdW5uZXJNYXhKb2JzLCBwb29sZWRSdW5uZXJNYXhSc3NCeXRlcywgcG9vbGVkUnVubmVyTWF4TGlmZXRpbWVNcywgZm9ya2VkQ2hpbGRTaWdraWxsR3JhY2VNcywgaGVhcnRiZWF0SW50ZXJ2YWxNcywgZ2VuZXJhdGlvbkhhbmRzaGFrZVRpbWVvdXRNcyA9IERFRkFVTFRfR0VORVJBVElPTl9IQU5EU0hBS0VfVElNRU9VVF9NUywgcmVjb25uZWN0RGVsYXlNcyA9IDEwMDAsIGpvYlRpbWVvdXRNcywgY2xvc2VEYXRhYmFzZUNvbm5lY3Rpb25zT25TdG9wID0gdHJ1ZSwgb25TdG9wcGVkLCBvbkdlbmVyYXRpb25BY2NlcHRlZCwgb25SZXRpcmVNZXNzYWdlLCBvblBvb2xlZFJ1bm5lck1lbW9yeU9ic2VydmF0aW9ufSA9IHt9KSB7XG4gICAgLyoqXG4gICAgICogTmFycm93cyB0aGUgcnVudGltZSB2YWx1ZSB0byB0aGUgZG9jdW1lbnRlZCB0eXBlLlxuICAgICAqIEB0eXBlIHtQcm9taXNlPGltcG9ydChcIi4uL2NvbmZpZ3VyYXRpb24uanNcIikuZGVmYXVsdD59ICovXG4gICAgdGhpcy5jb25maWd1cmF0aW9uUHJvbWlzZSA9IGNvbmZpZ3VyYXRpb24gPyBQcm9taXNlLnJlc29sdmUoY29uZmlndXJhdGlvbikgOiBjb25maWd1cmF0aW9uUmVzb2x2ZXIoKVxuICAgIC8qKlxuICAgICAqIE5hcnJvd3MgdGhlIHJ1bnRpbWUgdmFsdWUgdG8gdGhlIGRvY3VtZW50ZWQgdHlwZS5cbiAgICAgKiBAdHlwZSB7aW1wb3J0KFwiLi4vY29uZmlndXJhdGlvbi5qc1wiKS5kZWZhdWx0IHwgdW5kZWZpbmVkfSAqL1xuICAgIHRoaXMuY29uZmlndXJhdGlvbiA9IHVuZGVmaW5lZFxuICAgIHRoaXMuaG9zdCA9IGhvc3RcbiAgICB0aGlzLnBvcnQgPSBwb3J0XG4gICAgdGhpcy5leHBsaWNpdEdlbmVyYXRpb25JZCA9IGdlbmVyYXRpb25JZFxuICAgIHRoaXMud29ya2VySW5zdGFuY2VJZCA9IHdvcmtlckluc3RhbmNlSWQgfHwgcmFuZG9tVVVJRCgpXG4gICAgLyoqIEB0eXBlIHtzdHJpbmcgfCB1bmRlZmluZWR9ICovXG4gICAgdGhpcy5nZW5lcmF0aW9uSWQgPSB1bmRlZmluZWRcbiAgICB0aGlzLmNsb3NlRGF0YWJhc2VDb25uZWN0aW9uc09uU3RvcCA9IGNsb3NlRGF0YWJhc2VDb25uZWN0aW9uc09uU3RvcFxuICAgIHRoaXMub25TdG9wcGVkID0gb25TdG9wcGVkXG4gICAgdGhpcy5vbkdlbmVyYXRpb25BY2NlcHRlZCA9IG9uR2VuZXJhdGlvbkFjY2VwdGVkXG4gICAgdGhpcy5vblJldGlyZU1lc3NhZ2UgPSBvblJldGlyZU1lc3NhZ2VcbiAgICB0aGlzLm9uUG9vbGVkUnVubmVyTWVtb3J5T2JzZXJ2YXRpb24gPSBvblBvb2xlZFJ1bm5lck1lbW9yeU9ic2VydmF0aW9uXG4gICAgLyoqXG4gICAgICogQ29uc3RydWN0b3Igb3ZlcnJpZGUgZm9yIHRoZSBpbmxpbmUtam9iIGNvbmN1cnJlbmN5IGNhcC4gV2hlbiB1bnNldFxuICAgICAqIHRoZSBjYXAgaXMgcmVhZCBmcm9tIGBjb25maWd1cmF0aW9uLmdldEJhY2tncm91bmRKb2JzQ29uZmlnKClgIGluXG4gICAgICogYHN0YXJ0KClgIChkZWZhdWx0OiA0KS5cbiAgICAgKiBAdHlwZSB7bnVtYmVyIHwgdW5kZWZpbmVkfVxuICAgICAqL1xuICAgIHRoaXMubWF4Q29uY3VycmVudElubGluZUpvYnNPdmVycmlkZSA9IHR5cGVvZiBtYXhDb25jdXJyZW50SW5saW5lSm9icyA9PT0gXCJudW1iZXJcIiAmJiBtYXhDb25jdXJyZW50SW5saW5lSm9icyA+PSAxXG4gICAgICA/IG1heENvbmN1cnJlbnRJbmxpbmVKb2JzXG4gICAgICA6IHVuZGVmaW5lZFxuICAgIC8qKlxuICAgICAqIE5hcnJvd3MgdGhlIHJ1bnRpbWUgdmFsdWUgdG8gdGhlIGRvY3VtZW50ZWQgdHlwZS5cbiAgICAgKiBAdHlwZSB7bnVtYmVyIHwgdW5kZWZpbmVkfSAqL1xuICAgIHRoaXMubWF4Q29uY3VycmVudEZvcmtlZEpvYnNPdmVycmlkZSA9IHR5cGVvZiBtYXhDb25jdXJyZW50Rm9ya2VkSm9icyA9PT0gXCJudW1iZXJcIiAmJiBtYXhDb25jdXJyZW50Rm9ya2VkSm9icyA+PSAxXG4gICAgICA/IG1heENvbmN1cnJlbnRGb3JrZWRKb2JzXG4gICAgICA6IHVuZGVmaW5lZFxuICAgIC8qKlxuICAgICAqIFJlc29sdmVkIGNhcCBmb3IgaW5saW5lLWpvYiBjb25jdXJyZW5jeS4gU2V0IGluIGBzdGFydCgpYDsgZGVmYXVsdHMgdG9cbiAgICAgKiA0IGlmIG5vIGNvbmZpZ3VyYXRpb24gdmFsdWUgaXMgYXZhaWxhYmxlLlxuICAgICAqIEB0eXBlIHtudW1iZXJ9XG4gICAgICovXG4gICAgdGhpcy5tYXhDb25jdXJyZW50SW5saW5lSm9icyA9IHRoaXMubWF4Q29uY3VycmVudElubGluZUpvYnNPdmVycmlkZSB8fCA0XG4gICAgLyoqXG4gICAgICogTmFycm93cyB0aGUgcnVudGltZSB2YWx1ZSB0byB0aGUgZG9jdW1lbnRlZCB0eXBlLlxuICAgICAqIEB0eXBlIHtudW1iZXJ9ICovXG4gICAgdGhpcy5tYXhDb25jdXJyZW50Rm9ya2VkSm9icyA9IHRoaXMubWF4Q29uY3VycmVudEZvcmtlZEpvYnNPdmVycmlkZSB8fCA0XG4gICAgdGhpcy5wb29sZWRSdW5uZXJDb3VudE92ZXJyaWRlID0gcG9zaXRpdmVJbnRlZ2VyKHBvb2xlZFJ1bm5lckNvdW50KVxuICAgIHRoaXMucG9vbGVkUnVubmVyQ29uY3VycmVuY3lPdmVycmlkZSA9IHBvc2l0aXZlSW50ZWdlcihwb29sZWRSdW5uZXJDb25jdXJyZW5jeSlcbiAgICB0aGlzLnBvb2xlZFJ1bm5lck1heEpvYnNPdmVycmlkZSA9IHBvc2l0aXZlSW50ZWdlcihwb29sZWRSdW5uZXJNYXhKb2JzKVxuICAgIHRoaXMucG9vbGVkUnVubmVyTWF4UnNzQnl0ZXNPdmVycmlkZSA9IHBvc2l0aXZlTnVtYmVyKHBvb2xlZFJ1bm5lck1heFJzc0J5dGVzKVxuICAgIHRoaXMucG9vbGVkUnVubmVyTWF4TGlmZXRpbWVNc092ZXJyaWRlID0gcG9zaXRpdmVOdW1iZXIocG9vbGVkUnVubmVyTWF4TGlmZXRpbWVNcylcbiAgICB0aGlzLnBvb2xlZFJ1bm5lckNvdW50ID0gdGhpcy5wb29sZWRSdW5uZXJDb3VudE92ZXJyaWRlIHx8IDRcbiAgICB0aGlzLnBvb2xlZFJ1bm5lckNvbmN1cnJlbmN5ID0gdGhpcy5wb29sZWRSdW5uZXJDb25jdXJyZW5jeU92ZXJyaWRlIHx8IDFcbiAgICB0aGlzLnBvb2xlZFJ1bm5lck1heEpvYnMgPSB0aGlzLnBvb2xlZFJ1bm5lck1heEpvYnNPdmVycmlkZSB8fCAxMDBcbiAgICB0aGlzLnBvb2xlZFJ1bm5lck1heFJzc0J5dGVzID0gdGhpcy5wb29sZWRSdW5uZXJNYXhSc3NCeXRlc092ZXJyaWRlIHx8IDUxMiAqIDEwMjQgKiAxMDI0XG4gICAgdGhpcy5wb29sZWRSdW5uZXJNYXhMaWZldGltZU1zID0gdGhpcy5wb29sZWRSdW5uZXJNYXhMaWZldGltZU1zT3ZlcnJpZGUgfHwgNjAgKiA2MCAqIDEwMDBcbiAgICAvKipcbiAgICAgKiBHcmFjZSBwZXJpb2QgYmV0d2VlbiBTSUdURVJNIGFuZCBTSUdLSUxMIHdoZW4gcmVhcGluZyBwcm9jZXNzIHJ1bm5lcnMgdGhhdFxuICAgICAqIG91dGxhc3QgYSBib3VuZGVkIHNodXRkb3duIGRyYWluLlxuICAgICAqIEB0eXBlIHtudW1iZXJ9XG4gICAgICovXG4gICAgdGhpcy5mb3JrZWRDaGlsZFNpZ2tpbGxHcmFjZU1zID0gdHlwZW9mIGZvcmtlZENoaWxkU2lna2lsbEdyYWNlTXMgPT09IFwibnVtYmVyXCIgJiYgZm9ya2VkQ2hpbGRTaWdraWxsR3JhY2VNcyA+PSAwXG4gICAgICA/IGZvcmtlZENoaWxkU2lna2lsbEdyYWNlTXNcbiAgICAgIDogRk9SS0VEX0NISUxEX1NJR0tJTExfR1JBQ0VfTVNcbiAgICAvKipcbiAgICAgKiBDb25zdHJ1Y3RvciBvdmVycmlkZSBmb3IgdGhlIGZvcmtlZCBhbmQgcG9vbGVkIHdhbGwtY2xvY2sgam9iIHRpbWVvdXQuIFdoZW4gdW5zZXQgdGhlXG4gICAgICogdGltZW91dCBpcyByZWFkIGZyb20gYGNvbmZpZ3VyYXRpb24uZ2V0QmFja2dyb3VuZEpvYnNDb25maWcoKS5qb2JUaW1lb3V0TXNgXG4gICAgICogYXQgZm9yayB0aW1lIChkZWZhdWx0OiBkaXNhYmxlZCkuXG4gICAgICogQHR5cGUge251bWJlciB8IHVuZGVmaW5lZH1cbiAgICAgKi9cbiAgICB0aGlzLmpvYlRpbWVvdXRNc092ZXJyaWRlID0gdHlwZW9mIGpvYlRpbWVvdXRNcyA9PT0gXCJudW1iZXJcIiA/IGpvYlRpbWVvdXRNcyA6IHVuZGVmaW5lZFxuICAgIHRoaXMuc2hvdWxkU3RvcCA9IGZhbHNlXG4gICAgdGhpcy5pc1JldGlyaW5nID0gZmFsc2VcbiAgICAvKiogQHR5cGUge1Byb21pc2U8dm9pZD4gfCB1bmRlZmluZWR9ICovXG4gICAgdGhpcy5zdG9wUHJvbWlzZSA9IHVuZGVmaW5lZFxuICAgIC8qKlxuICAgICAqIFJlc29sdmVzIHN0b3Agb2JzZXJ2YXRpb24uXG4gICAgICogQHR5cGUgeyh2YWx1ZT86IHZvaWQpID0+IHZvaWR9XG4gICAgICovXG4gICAgdGhpcy5fcmVzb2x2ZVN0b3BwZWQgPSAoKSA9PiB7fVxuICAgIC8qKlxuICAgICAqIFJlamVjdHMgc3RvcCBvYnNlcnZhdGlvbi5cbiAgICAgKiBAdHlwZSB7KGVycm9yOiBFcnJvcikgPT4gdm9pZH1cbiAgICAgKi9cbiAgICB0aGlzLl9yZWplY3RTdG9wcGVkID0gKCkgPT4ge31cbiAgICAvKiogQHR5cGUge1Byb21pc2U8dm9pZD59ICovXG4gICAgdGhpcy5fc3RvcHBlZFByb21pc2UgPSBQcm9taXNlLnJlc29sdmUoKVxuICAgIHRoaXMuX3Jlc2V0U3RvcHBlZFByb21pc2UoKVxuICAgIHRoaXMud29ya2VySWQgPSB0aGlzLndvcmtlckluc3RhbmNlSWRcbiAgICB0aGlzLl9nZW5lcmF0aW9uQWNjZXB0ZWQgPSBmYWxzZVxuICAgIHRoaXMuZ2VuZXJhdGlvbkhhbmRzaGFrZVRpbWVvdXRNcyA9IHZhbGlkYXRlR2VuZXJhdGlvbkhhbmRzaGFrZVRpbWVvdXRNcyhnZW5lcmF0aW9uSGFuZHNoYWtlVGltZW91dE1zKVxuICAgIGlmICghTnVtYmVyLmlzSW50ZWdlcihyZWNvbm5lY3REZWxheU1zKSB8fCByZWNvbm5lY3REZWxheU1zIDwgMCB8fCByZWNvbm5lY3REZWxheU1zID4gTUFYX0ZPUktFRF9KT0JfVElNRU9VVF9NUykge1xuICAgICAgdGhyb3cgbmV3IFR5cGVFcnJvcihcInJlY29ubmVjdERlbGF5TXMgbXVzdCBiZSBhbiBpbnRlZ2VyIGJldHdlZW4gMCBhbmQgMjE0NzQ4MzY0N1wiKVxuICAgIH1cbiAgICB0aGlzLnJlY29ubmVjdERlbGF5TXMgPSByZWNvbm5lY3REZWxheU1zXG4gICAgLyoqIEB0eXBlIHtSZXR1cm5UeXBlPHR5cGVvZiBzZXRUaW1lb3V0PiB8IHVuZGVmaW5lZH0gKi9cbiAgICB0aGlzLl9yZWNvbm5lY3RUaW1lciA9IHVuZGVmaW5lZFxuICAgIHRoaXMuaGVhcnRiZWF0SW50ZXJ2YWxNcyA9IHR5cGVvZiBoZWFydGJlYXRJbnRlcnZhbE1zID09PSBcIm51bWJlclwiICYmIGhlYXJ0YmVhdEludGVydmFsTXMgPj0gMVxuICAgICAgPyBoZWFydGJlYXRJbnRlcnZhbE1zXG4gICAgICA6IEhFQVJUQkVBVF9JTlRFUlZBTF9NU1xuICAgIC8qKlxuICAgICAqIE5hcnJvd3MgdGhlIHJ1bnRpbWUgdmFsdWUgdG8gdGhlIGRvY3VtZW50ZWQgdHlwZS5cbiAgICAgKiBAdHlwZSB7UmV0dXJuVHlwZTx0eXBlb2Ygc2V0SW50ZXJ2YWw+IHwgdW5kZWZpbmVkfSAqL1xuICAgIHRoaXMuX2hlYXJ0YmVhdFRpbWVyID0gdW5kZWZpbmVkXG4gICAgLyoqXG4gICAgICogSW4tZmxpZ2h0IGpvYi1yZXN1bHQgcmVwb3J0cyB0byB0aGUgbWFpbi4gUmVwb3J0aW5nIGlzIGRlY291cGxlZCBmcm9tIHRoZVxuICAgICAqIGpvYi9jaGlsZCBzbG90IChmcmVlaW5nIHRoZSBzbG90IG5ldmVyIHdhaXRzIG9uIGEgcmVwb3J0KSBhbmQgcmV0cmllZFxuICAgICAqIGR1cmFibHksIHNvIGEgdHJhbnNpZW50IG1haW4vREIgb3V0YWdlIGNhbm5vdCBsZWFrIHNsb3RzIG9yIGxvc2UgYVxuICAgICAqIHRlcm1pbmFsIHJlcG9ydC4gVHJhY2tlZCBzbyBhIGdyYWNlZnVsIGBzdG9wKClgIGNhbiBkcmFpbiB0aGVtLlxuICAgICAqIEB0eXBlIHtTZXQ8UHJvbWlzZTx2b2lkPj59XG4gICAgICovXG4gICAgdGhpcy5pbmZsaWdodFJlcG9ydHMgPSBuZXcgU2V0KClcbiAgICAvKipcbiAgICAgKiBOYXJyb3dzIHRoZSBydW50aW1lIHZhbHVlIHRvIHRoZSBkb2N1bWVudGVkIHR5cGUuXG4gICAgICogQHR5cGUge0pzb25Tb2NrZXQgfCB1bmRlZmluZWR9ICovXG4gICAgdGhpcy5qc29uU29ja2V0ID0gdW5kZWZpbmVkXG4gICAgLyoqXG4gICAgICogTmFycm93cyB0aGUgcnVudGltZSB2YWx1ZSB0byB0aGUgZG9jdW1lbnRlZCB0eXBlLlxuICAgICAqIEB0eXBlIHtCYWNrZ3JvdW5kSm9ic1N0YXR1c1JlcG9ydGVyIHwgdW5kZWZpbmVkfSAqL1xuICAgIHRoaXMuc3RhdHVzUmVwb3J0ZXIgPSB1bmRlZmluZWRcbiAgICAvKipcbiAgICAgKiBVcCB0byBgdGhpcy5tYXhDb25jdXJyZW50SW5saW5lSm9ic2Agb2YgdGhlc2UgcnVuIGluIHBhcmFsbGVsLiBUaGV5XG4gICAgICogc2hhcmUgdGhlIHdvcmtlcidzIHByb2Nlc3MgYW5kIERCIGNvbm5lY3Rpb24gcG9vbCwgc28gY29uY3VycmVuY3kgaXNcbiAgICAgKiBhYm91dCBvdmVybGFwcGluZyBJL08gd2FpdHMg4oCUIHVzZSBmb3JraW5nIGZvciBtZW1vcnkgaXNvbGF0aW9uIGFjcm9zc1xuICAgICAqIGxvbmctcnVubmluZyBqb2JzIGFuZCBmb3IgdXNpbmcgbW9yZSBjb3Jlcy5cbiAgICAgKiBAdHlwZSB7U2V0PFByb21pc2U8dm9pZD4+fVxuICAgICAqL1xuICAgIHRoaXMuaW5mbGlnaHRJbmxpbmVKb2JzID0gbmV3IFNldCgpXG4gICAgLyoqXG4gICAgICogSW4tZmxpZ2h0IHByb2Nlc3MgcnVubmVyIGV4aXQgcHJvbWlzZXMuIFRyYWNrZWQgc28gcHJvY2Vzcy1qb2IgaGFuZG9mZlxuICAgICAqIHN0YXlzIGJvdW5kZWQgd2hpbGUgcnVubmluZyBhbmQgc28gYSBncmFjZWZ1bCBgc3RvcCgpYCBjYW4gZHJhaW4gdGhlbS5cbiAgICAgKiBAdHlwZSB7U2V0PFByb21pc2U8dm9pZD4+fVxuICAgICAqL1xuICAgIHRoaXMuaW5mbGlnaHRQcm9jZXNzSm9icyA9IG5ldyBTZXQoKVxuICAgIC8qKlxuICAgICAqIExpdmUgcHJvY2VzcyBydW5uZXIgY2hpbGQgcHJvY2Vzc2VzLCBrZXB0IHNvIGEgZ3JhY2VmdWwgYHN0b3AoKWAgY2FuXG4gICAgICogdGVybWluYXRlIGFueSB0aGF0IG91dGxhc3QgdGhlIHNodXRkb3duIGRyYWluIGluc3RlYWQgb2Ygb3JwaGFuaW5nIHRoZW1cbiAgICAgKiBhY3Jvc3MgYSBkZXBsb3kgKHdoZXJlIHRoZXkgd291bGQga2VlcCBydW5uaW5nIGFnYWluc3QgZGVsZXRlZCByZWxlYXNlXG4gICAgICogY29kZSBhbmQgaG9sZGluZyBkYXRhYmFzZSBjb25uZWN0aW9ucykuXG4gICAgICogQHR5cGUge1NldDxpbXBvcnQoXCJub2RlOmNoaWxkX3Byb2Nlc3NcIikuQ2hpbGRQcm9jZXNzPn1cbiAgICAgKi9cbiAgICB0aGlzLmluZmxpZ2h0UHJvY2Vzc0NoaWxkcmVuID0gbmV3IFNldCgpXG4gICAgLyoqIEB0eXBlIHtTZXQ8UHJvbWlzZTx2b2lkPj59ICovXG4gICAgdGhpcy5pbmZsaWdodFBvb2xlZEpvYnMgPSBuZXcgU2V0KClcbiAgICAvKiogQHR5cGUge01hcDxzdHJpbmcsIEFycmF5PGltcG9ydChcIi4vdHlwZXMuanNcIikuQmFja2dyb3VuZEpvYlBheWxvYWQgJiB7aWQ6IHN0cmluZ30+Pn0gKi9cbiAgICB0aGlzLnBvb2xlZEpvYlF1ZXVlcyA9IG5ldyBNYXAoKVxuICAgIC8qKiBAdHlwZSB7TWFwPHN0cmluZywgUHJvbWlzZTx2b2lkPj59IC0gUGVyLWlkIG91dGVyIHF1ZXVlIHRyYWNrZXJzLiAqL1xuICAgIHRoaXMucG9vbGVkSm9iUXVldWVUcmFja2VycyA9IG5ldyBNYXAoKVxuICAgIC8qKiBAdHlwZSB7U2V0PGltcG9ydChcIm5vZGU6Y2hpbGRfcHJvY2Vzc1wiKS5DaGlsZFByb2Nlc3M+fSAqL1xuICAgIHRoaXMucG9vbGVkQ2hpbGRyZW4gPSBuZXcgU2V0KClcbiAgICAvKiogQHR5cGUge01hcDxpbXBvcnQoXCJub2RlOmNoaWxkX3Byb2Nlc3NcIikuQ2hpbGRQcm9jZXNzLCBQb29sZWRDaGlsZFN0YXRlPn0gKi9cbiAgICB0aGlzLnBvb2xlZENoaWxkU3RhdGVzID0gbmV3IE1hcCgpXG4gICAgLyoqIEB0eXBlIHtXZWFrU2V0PFByb21pc2U8dm9pZD4+fSAqL1xuICAgIHRoaXMuX3Bvb2xlZFN0YXJ0dXBGYWlsdXJlSm9icyA9IG5ldyBXZWFrU2V0KClcbiAgICAvLyBNb25vdG9uaWMgZGlzcGF0Y2ggY291bnRlciBmb3Igcm91bmQtcm9iaW4gY2hpbGQgc2VsZWN0aW9uOiBlYWNoIGRpc3BhdGNoIHN0YW1wc1xuICAgIC8vIHRoZSBjaG9zZW4gY2hpbGQsIGFuZCBzZWxlY3Rpb24gcHJlZmVycyB0aGUgY2hpbGQgZGlzcGF0Y2hlZCBsZWFzdCByZWNlbnRseS5cbiAgICB0aGlzLl9wb29sZWREaXNwYXRjaFNlcSA9IDBcbiAgICAvLyBXYWl0ZXJzIGJsb2NrZWQgaW4gX3J1blBvb2xlZEpvYiBiZWNhdXNlIHRoZSBwb29sIGlzIGF0IGl0cyBoYXJkIGNhcDogYSBqb2IgbWF5XG4gICAgLy8gbm90IHNwYXduIGEgY2hpbGQgd2hpbGUgdG90YWwgbGl2ZSBjaGlsZHJlbiAod29ya2luZyArIGRyYWluaW5nKSBpcyBhdCB0aGUgY2FwLlxuICAgIC8qKiBAdHlwZSB7U2V0PCgpID0+IHZvaWQ+fSAqL1xuICAgIHRoaXMuX3Bvb2xlZFNsb3RXYWl0ZXJzID0gbmV3IFNldCgpXG4gICAgLyoqIEB0eXBlIHtSZXR1cm5UeXBlPHR5cGVvZiBzZXRJbnRlcnZhbD4gfCB1bmRlZmluZWR9IC0gU2FmZXR5IHBvbGwgdGhhdCByZS1jaGVja3MgdGhlIHNsb3QgY29uZGl0aW9uLiAqL1xuICAgIHRoaXMuX3Bvb2xlZFNsb3RXYWl0VGltZXIgPSB1bmRlZmluZWRcbiAgfVxuXG4gIC8qKiBTdGFydHMgdGhlIHNsb3Qtd2FpdGVyIHNhZmV0eSBwb2xsIGlmIGl0IGlzIG5vdCBhbHJlYWR5IHJ1bm5pbmcuICovXG4gIF9zdGFydFBvb2xlZFNsb3RXYWl0UG9sbCgpIHtcbiAgICBpZiAodGhpcy5fcG9vbGVkU2xvdFdhaXRUaW1lcikgcmV0dXJuXG5cbiAgICB0aGlzLl9wb29sZWRTbG90V2FpdFRpbWVyID0gc2V0SW50ZXJ2YWwoKCkgPT4gdGhpcy5fd2FrZVBvb2xlZFNsb3RXYWl0ZXJzKCksIDUwKVxuICAgIHRoaXMuX3Bvb2xlZFNsb3RXYWl0VGltZXIudW5yZWYoKVxuICB9XG5cbiAgLyoqIFN0b3BzIHRoZSBzbG90LXdhaXRlciBzYWZldHkgcG9sbCBvbmNlIG5vIHdhaXRlciBpcyByZWdpc3RlcmVkLiAqL1xuICBfc3RvcFBvb2xlZFNsb3RXYWl0UG9sbElmSWRsZSgpIHtcbiAgICBpZiAodGhpcy5fcG9vbGVkU2xvdFdhaXRlcnMuc2l6ZSA+IDAgfHwgIXRoaXMuX3Bvb2xlZFNsb3RXYWl0VGltZXIpIHJldHVyblxuXG4gICAgY2xlYXJJbnRlcnZhbCh0aGlzLl9wb29sZWRTbG90V2FpdFRpbWVyKVxuICAgIHRoaXMuX3Bvb2xlZFNsb3RXYWl0VGltZXIgPSB1bmRlZmluZWRcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHN0YXJ0LlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyB3aGVuIGNvbm5lY3RlZC5cbiAgICovXG4gIGFzeW5jIHN0YXJ0KCkge1xuICAgIHRoaXMuc2hvdWxkU3RvcCA9IGZhbHNlXG4gICAgdGhpcy5pc1JldGlyaW5nID0gZmFsc2VcbiAgICB0aGlzLnN0b3BQcm9taXNlID0gdW5kZWZpbmVkXG4gICAgdGhpcy5fcmVzZXRTdG9wcGVkUHJvbWlzZSgpXG4gICAgdGhpcy5jb25maWd1cmF0aW9uID0gYXdhaXQgdGhpcy5jb25maWd1cmF0aW9uUHJvbWlzZVxuICAgIHRoaXMuY29uZmlndXJhdGlvbi5zZXRDdXJyZW50KClcbiAgICBjb25zdCByZXNvbHZlZENvbmZpZyA9IHRoaXMuY29uZmlndXJhdGlvbi5nZXRCYWNrZ3JvdW5kSm9ic0NvbmZpZygpXG4gICAgdGhpcy5nZW5lcmF0aW9uSWQgPSB0aGlzLmNvbmZpZ3VyYXRpb24ucmVzb2x2ZUJhY2tncm91bmRKb2JzR2VuZXJhdGlvbkNvbmZpZyh7XG4gICAgICBnZW5lcmF0aW9uSWQ6IHRoaXMuZXhwbGljaXRHZW5lcmF0aW9uSWQsXG4gICAgICBzb3VyY2VOYW1lOiBcIkJhY2tncm91bmRKb2JzV29ya2VyXCJcbiAgICB9KS5nZW5lcmF0aW9uSWRcbiAgICB0aGlzLndvcmtlcklkID0gdGhpcy5nZW5lcmF0aW9uSWRcbiAgICAgID8gY3JlYXRlR2VuZXJhdGlvbldvcmtlcklkKHtnZW5lcmF0aW9uSWQ6IHRoaXMuZ2VuZXJhdGlvbklkLCB3b3JrZXJJbnN0YW5jZUlkOiB0aGlzLndvcmtlckluc3RhbmNlSWR9KVxuICAgICAgOiB0aGlzLndvcmtlckluc3RhbmNlSWRcbiAgICB0aGlzLmhvc3QgfHw9IHJlc29sdmVkQ29uZmlnLmhvc3RcbiAgICBpZiAodHlwZW9mIHRoaXMucG9ydCAhPT0gXCJudW1iZXJcIikgdGhpcy5wb3J0ID0gcmVzb2x2ZWRDb25maWcucG9ydFxuICAgIGF3YWl0IHRoaXMuY29uZmlndXJhdGlvbi5pbml0aWFsaXplKHt0eXBlOiBcImJhY2tncm91bmQtam9icy13b3JrZXJcIn0pXG4gICAgYXdhaXQgdGhpcy5jb25maWd1cmF0aW9uLmNvbm5lY3RCZWFjb24oe3BlZXJUeXBlOiBcImJhY2tncm91bmQtam9icy13b3JrZXJcIn0pXG5cbiAgICAvLyBDb25zdHJ1Y3RvciBvdmVycmlkZXMgd2luOyBvdGhlcndpc2UgcGljayB1cCB0aGUgY29uZmlndXJlZCBjYXBzLlxuICAgIGlmICh0eXBlb2YgdGhpcy5tYXhDb25jdXJyZW50SW5saW5lSm9ic092ZXJyaWRlICE9PSBcIm51bWJlclwiKSB7XG4gICAgICBjb25zdCBjb25maWcgPSB0aGlzLmNvbmZpZ3VyYXRpb24uZ2V0QmFja2dyb3VuZEpvYnNDb25maWcoKVxuXG4gICAgICB0aGlzLm1heENvbmN1cnJlbnRJbmxpbmVKb2JzID0gY29uZmlnLm1heENvbmN1cnJlbnRJbmxpbmVKb2JzIHx8IHRoaXMubWF4Q29uY3VycmVudElubGluZUpvYnNcbiAgICB9XG4gICAgaWYgKHR5cGVvZiB0aGlzLm1heENvbmN1cnJlbnRGb3JrZWRKb2JzT3ZlcnJpZGUgIT09IFwibnVtYmVyXCIpIHtcbiAgICAgIGNvbnN0IGNvbmZpZyA9IHRoaXMuY29uZmlndXJhdGlvbi5nZXRCYWNrZ3JvdW5kSm9ic0NvbmZpZygpXG5cbiAgICAgIHRoaXMubWF4Q29uY3VycmVudEZvcmtlZEpvYnMgPSBjb25maWcubWF4Q29uY3VycmVudEZvcmtlZEpvYnMgfHwgdGhpcy5tYXhDb25jdXJyZW50Rm9ya2VkSm9ic1xuICAgIH1cbiAgICBjb25zdCBwb29sQ29uZmlnID0gdGhpcy5jb25maWd1cmF0aW9uLmdldEJhY2tncm91bmRKb2JzQ29uZmlnKClcbiAgICBpZiAodHlwZW9mIHRoaXMucG9vbGVkUnVubmVyQ291bnRPdmVycmlkZSAhPT0gXCJudW1iZXJcIikgdGhpcy5wb29sZWRSdW5uZXJDb3VudCA9IHBvb2xDb25maWcucG9vbGVkUnVubmVyQ291bnRcbiAgICBpZiAodHlwZW9mIHRoaXMucG9vbGVkUnVubmVyQ29uY3VycmVuY3lPdmVycmlkZSAhPT0gXCJudW1iZXJcIikgdGhpcy5wb29sZWRSdW5uZXJDb25jdXJyZW5jeSA9IHBvb2xDb25maWcucG9vbGVkUnVubmVyQ29uY3VycmVuY3lcbiAgICBpZiAodHlwZW9mIHRoaXMucG9vbGVkUnVubmVyTWF4Sm9ic092ZXJyaWRlICE9PSBcIm51bWJlclwiKSB0aGlzLnBvb2xlZFJ1bm5lck1heEpvYnMgPSBwb29sQ29uZmlnLnBvb2xlZFJ1bm5lck1heEpvYnNcbiAgICBpZiAodHlwZW9mIHRoaXMucG9vbGVkUnVubmVyTWF4UnNzQnl0ZXNPdmVycmlkZSAhPT0gXCJudW1iZXJcIikgdGhpcy5wb29sZWRSdW5uZXJNYXhSc3NCeXRlcyA9IHBvb2xDb25maWcucG9vbGVkUnVubmVyTWF4UnNzQnl0ZXNcbiAgICBpZiAodHlwZW9mIHRoaXMucG9vbGVkUnVubmVyTWF4TGlmZXRpbWVNc092ZXJyaWRlICE9PSBcIm51bWJlclwiKSB0aGlzLnBvb2xlZFJ1bm5lck1heExpZmV0aW1lTXMgPSBwb29sQ29uZmlnLnBvb2xlZFJ1bm5lck1heExpZmV0aW1lTXNcblxuICAgIHRoaXMuc3RhdHVzUmVwb3J0ZXIgPSBuZXcgQmFja2dyb3VuZEpvYnNTdGF0dXNSZXBvcnRlcih7XG4gICAgICBjb25maWd1cmF0aW9uOiB0aGlzLmNvbmZpZ3VyYXRpb24sXG4gICAgICBob3N0OiB0aGlzLmhvc3QsXG4gICAgICBwb3J0OiB0aGlzLnBvcnQsXG4gICAgICBnZW5lcmF0aW9uSGFuZHNoYWtlVGltZW91dE1zOiB0aGlzLmdlbmVyYXRpb25IYW5kc2hha2VUaW1lb3V0TXMsXG4gICAgICBnZW5lcmF0aW9uSWQ6IHRoaXMuZ2VuZXJhdGlvbklkXG4gICAgfSlcbiAgICB0cnkge1xuICAgICAgYXdhaXQgdGhpcy5fY29ubmVjdCh7YWxsb3dSZWNvbm5lY3Q6IGZhbHNlfSlcbiAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgbGV0IGNsZWFudXBFcnJvclxuXG4gICAgICB0cnkge1xuICAgICAgICBhd2FpdCB0aGlzLnN0b3AoKVxuICAgICAgfSBjYXRjaCAoY2F1Z2h0Q2xlYW51cEVycm9yKSB7XG4gICAgICAgIGNsZWFudXBFcnJvciA9IGNhdWdodENsZWFudXBFcnJvclxuICAgICAgfVxuXG4gICAgICBpZiAoY2xlYW51cEVycm9yKSB7XG4gICAgICAgIHRocm93IG5ldyBBZ2dyZWdhdGVFcnJvcihcbiAgICAgICAgICBbZXJyb3IsIGNsZWFudXBFcnJvcl0sXG4gICAgICAgICAgXCJCYWNrZ3JvdW5kIGpvYnMgd29ya2VyIHN0YXJ0dXAgYW5kIGNsZWFudXAgZmFpbGVkXCIsXG4gICAgICAgICAge2NhdXNlOiBlcnJvcn1cbiAgICAgICAgKVxuICAgICAgfVxuXG4gICAgICB0aHJvdyBlcnJvclxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBHcmFjZWZ1bGx5IHN0b3BzIHRoZSB3b3JrZXI6IGFubm91bmNlcyBkcmFpbmluZyB0byB0aGUgbWFpbiBwcm9jZXNzIHNvXG4gICAqIG5vIG5ldyBqb2JzIGFyZSBkaXNwYXRjaGVkLCB3YWl0cyBmb3IgaW4tZmxpZ2h0IGlubGluZSBqb2JzIGFuZCBwcm9jZXNzXG4gICAqIHJ1bm5lcnMgdG8gZmluaXNoIChzbyB0aGVpciByZXN1bHRzIGNhbiBiZSByZXBvcnRlZCksIHRoZW4gY2xvc2VzIHRoZVxuICAgKiBzb2NrZXQgYW5kIGRpc2Nvbm5lY3RzIGZyb20gdGhlIGJlYWNvbi5cbiAgICpcbiAgICogUHJvY2VzcyBydW5uZXJzIGFyZSBjaGlsZCBwcm9jZXNzZXMuIFdoZW4gYSBgdGltZW91dE1zYCBpcyBnaXZlbiAoZS5nLiBhXG4gICAqIGRlcGxveSBkcmFpbmluZyB0aGUgb2xkIHJlbGVhc2UpIGFueSBydW5uZXIgc3RpbGwgYWxpdmUgYWZ0ZXIgdGhlIGRyYWluXG4gICAqIHdpbmRvdyBpcyB0ZXJtaW5hdGVkIChTSUdURVJNLCB0aGVuIFNJR0tJTEwpIHJhdGhlciB0aGFuIGxlZnQgdG8gb3JwaGFuXG4gICAqIGFjcm9zcyB0aGUgZGVwbG95LiBXaXRoIG5vIGB0aW1lb3V0TXNgIHRoZSBkcmFpbiB3YWl0cyBmb3IgcnVubmVycyB0b1xuICAgKiBmaW5pc2ggb24gdGhlaXIgb3duLlxuICAgKiBAcGFyYW0ge29iamVjdH0gW2FyZ3NdIC0gT3B0aW9ucy5cbiAgICogQHBhcmFtIHtudW1iZXJ9IFthcmdzLnRpbWVvdXRNc10gLSBNYXggd2FpdCBmb3IgaW4tZmxpZ2h0IGpvYnMgKHBlciBwaGFzZSkgaW4gbXMuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIHdoZW4gc3RvcHBlZC5cbiAgICovXG4gIHN0b3Aoe3RpbWVvdXRNc30gPSB7fSkge1xuICAgIGNvbnN0IHN0b3BQcm9taXNlID0gdGhpcy5zdG9wUHJvbWlzZSB8fCB0aGlzLl9zdG9wKHt0aW1lb3V0TXN9KVxuXG4gICAgaWYgKCF0aGlzLnN0b3BQcm9taXNlKSB7XG4gICAgICB0aGlzLnN0b3BQcm9taXNlID0gc3RvcFByb21pc2VcbiAgICAgIHZvaWQgc3RvcFByb21pc2UudGhlbih0aGlzLl9yZXNvbHZlU3RvcHBlZCwgKGVycm9yKSA9PiB7XG4gICAgICAgIHRoaXMuX3JlamVjdFN0b3BwZWQoZXJyb3IgaW5zdGFuY2VvZiBFcnJvciA/IGVycm9yIDogbmV3IEVycm9yKFN0cmluZyhlcnJvcikpKVxuICAgICAgfSlcbiAgICB9XG5cbiAgICByZXR1cm4gc3RvcFByb21pc2VcbiAgfVxuXG4gIC8qKlxuICAgKiBXYWl0cyBmb3IgYXV0b21hdGljIG9yIHJlcXVlc3RlZCBzdG9wLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyB3aGVuIHRoaXMgd29ya2VyIGhhcyBmdWxseSBzdG9wcGVkLlxuICAgKi9cbiAgd2FpdFVudGlsU3RvcHBlZCgpIHsgcmV0dXJuIHRoaXMuX3N0b3BwZWRQcm9taXNlIH1cblxuICAvKiogUmVzZXRzIHRoZSBzdG9wIG9ic2VydmF0aW9uIHByb21pc2UgZm9yIGEgbmV3IHdvcmtlciBzdGFydC4gKi9cbiAgX3Jlc2V0U3RvcHBlZFByb21pc2UoKSB7XG4gICAgdGhpcy5fc3RvcHBlZFByb21pc2UgPSBuZXcgUHJvbWlzZSgocmVzb2x2ZSwgcmVqZWN0KSA9PiB7XG4gICAgICB0aGlzLl9yZXNvbHZlU3RvcHBlZCA9IHJlc29sdmVcbiAgICAgIHRoaXMuX3JlamVjdFN0b3BwZWQgPSByZWplY3RcbiAgICB9KVxuICAgIHZvaWQgdGhpcy5fc3RvcHBlZFByb21pc2UuY2F0Y2goKCkgPT4ge30pXG4gIH1cblxuICAvKipcbiAgICogUnVucyB0aGUgd29ya2VyIHNodXRkb3duIGxpZmVjeWNsZSBvbmNlLlxuICAgKiBAcGFyYW0ge29iamVjdH0gW2FyZ3NdIC0gT3B0aW9ucy5cbiAgICogQHBhcmFtIHtudW1iZXJ9IFthcmdzLnRpbWVvdXRNc10gLSBNYXggd2FpdCBmb3IgaW4tZmxpZ2h0IGpvYnMgKHBlciBwaGFzZSkgaW4gbXMuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIHdoZW4gc3RvcHBlZC5cbiAgICovXG4gIGFzeW5jIF9zdG9wKHt0aW1lb3V0TXN9ID0ge30pIHtcbiAgICB0aGlzLnNob3VsZFN0b3AgPSB0cnVlXG4gICAgdGhpcy5pc1JldGlyaW5nID0gdHJ1ZVxuICAgIHRoaXMuX3N0b3BIZWFydGJlYXQoKVxuICAgIGlmICh0aGlzLl9yZWNvbm5lY3RUaW1lcikge1xuICAgICAgY2xlYXJUaW1lb3V0KHRoaXMuX3JlY29ubmVjdFRpbWVyKVxuICAgICAgdGhpcy5fcmVjb25uZWN0VGltZXIgPSB1bmRlZmluZWRcbiAgICB9XG5cbiAgICBhd2FpdCBzaHV0ZG93bkxpZmVjeWNsZSh7XG4gICAgICBvblN0b3BwZWQ6IHRoaXMub25TdG9wcGVkLFxuICAgICAgc2h1dGRvd246IGFzeW5jICgpID0+IHtcbiAgICAgICAgLy8gQW5ub3VuY2UgZHJhaW4gc28gbWFpbiBzdG9wcyBkaXNwYXRjaGluZyBidXQga2VlcHMgdGhlIGNvbm5lY3Rpb25cbiAgICAgICAgLy8gb3BlbiB1bnRpbCB3ZSBjbG9zZSBpdCBvdXJzZWx2ZXMgYmVsb3cuXG4gICAgICAgIGlmICh0aGlzLmpzb25Tb2NrZXQpIHtcbiAgICAgICAgICB0cnkge1xuICAgICAgICAgICAgdGhpcy5qc29uU29ja2V0LnNlbmQoe3R5cGU6IFwiZHJhaW5pbmdcIn0pXG4gICAgICAgICAgfSBjYXRjaCB7XG4gICAgICAgICAgICAvLyBTb2NrZXQgbWF5IGFscmVhZHkgYmUgY2xvc2luZzsgbm90aGluZyB0byBkby5cbiAgICAgICAgICB9XG4gICAgICAgIH1cblxuICAgICAgICBhd2FpdCB0aGlzLl9kcmFpbkluZmxpZ2h0KHRoaXMuaW5mbGlnaHRJbmxpbmVKb2JzLCB0aW1lb3V0TXMpXG4gICAgICAgIGF3YWl0IHRoaXMuX2RyYWluSW5mbGlnaHQodGhpcy5pbmZsaWdodFBvb2xlZEpvYnMsIHRpbWVvdXRNcylcbiAgICAgICAgYXdhaXQgdGhpcy5fZHJhaW5JbmZsaWdodCh0aGlzLmluZmxpZ2h0UHJvY2Vzc0pvYnMsIHRpbWVvdXRNcylcbiAgICAgICAgYXdhaXQgdGhpcy5fdGVybWluYXRlUHJvY2Vzc0NoaWxkcmVuKClcbiAgICAgICAgLy8gR2l2ZSBpbi1mbGlnaHQgcmVzdWx0IHJlcG9ydHMgKG5vdyBkZWNvdXBsZWQgZnJvbSBqb2Igc2xvdHMpIGEgYm91bmRlZFxuICAgICAgICAvLyBjaGFuY2UgdG8gbGFuZCBiZWZvcmUgdGhlIHNvY2tldCBjbG9zZXMuXG4gICAgICAgIGF3YWl0IHRoaXMuX2RyYWluSW5mbGlnaHQodGhpcy5pbmZsaWdodFJlcG9ydHMsIHRpbWVvdXRNcylcblxuICAgICAgICBpZiAodGhpcy5qc29uU29ja2V0KSB0aGlzLmpzb25Tb2NrZXQuY2xvc2UoKVxuICAgICAgICBpZiAoIXRoaXMuY29uZmlndXJhdGlvbikgcmV0dXJuXG5cbiAgICAgICAgYXdhaXQgdGhpcy5fY2xvc2VDb25maWd1cmF0aW9uKClcbiAgICAgIH1cbiAgICB9KVxuICB9XG5cbiAgLyoqIEJlZ2lucyBnZW5lcmF0aW9uIHJldGlyZW1lbnQgd2l0aG91dCByZXZva2luZyBsaXZlbmVzcyBkdXJpbmcgdGhlIGRyYWluLiAqL1xuICBfYmVnaW5HZW5lcmF0aW9uUmV0aXJlbWVudCgpIHtcbiAgICBpZiAodGhpcy5zdG9wUHJvbWlzZSkgcmV0dXJuXG5cbiAgICB0aGlzLmlzUmV0aXJpbmcgPSB0cnVlXG4gICAgY29uc3Qgc3RvcFByb21pc2UgPSB0aGlzLl9zdG9wQWZ0ZXJHZW5lcmF0aW9uRHJhaW4oKVxuICAgIHRoaXMuc3RvcFByb21pc2UgPSBzdG9wUHJvbWlzZVxuICAgIHZvaWQgc3RvcFByb21pc2UudGhlbih0aGlzLl9yZXNvbHZlU3RvcHBlZCwgKGVycm9yKSA9PiB7XG4gICAgICBjb25zdCBub3JtYWxpemVkRXJyb3IgPSBlcnJvciBpbnN0YW5jZW9mIEVycm9yID8gZXJyb3IgOiBuZXcgRXJyb3IoU3RyaW5nKGVycm9yKSlcblxuICAgICAgdGhpcy5fcmVqZWN0U3RvcHBlZChub3JtYWxpemVkRXJyb3IpXG4gICAgICB0aGlzLl9yZXBvcnRMaWZlY3ljbGVFcnJvcihub3JtYWxpemVkRXJyb3IpXG4gICAgfSlcbiAgfVxuXG4gIC8qKlxuICAgKiBEcmFpbnMgYWNjZXB0ZWQgZ2VuZXJhdGlvbiB3b3JrIHdoaWxlIHJldGFpbmluZyB0aGUgZXhhY3QgY29ubmVjdGlvbiBhbmRcbiAgICogaGVhcnRiZWF0LCB0aGVuIHBlcmZvcm1zIHRoZSBmaW5hbCB0ZXJtaW5hdGluZyBzdG9wLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyBhZnRlciB0aGUgd29ya2VyIGhhcyBmdWxseSBjbG9zZWQuXG4gICAqL1xuICBhc3luYyBfc3RvcEFmdGVyR2VuZXJhdGlvbkRyYWluKCkge1xuICAgIGlmICh0aGlzLmpzb25Tb2NrZXQpIHtcbiAgICAgIHRyeSB7XG4gICAgICAgIHRoaXMuanNvblNvY2tldC5zZW5kKHt0eXBlOiBcImRyYWluaW5nXCJ9KVxuICAgICAgfSBjYXRjaCB7XG4gICAgICAgIC8vIFRoZSBjbG9zZSBoYW5kbGVyIG93bnMgZXhhY3Qgc2FtZS1nZW5lcmF0aW9uIHJlY29ubmVjdC5cbiAgICAgIH1cbiAgICB9XG5cbiAgICBhd2FpdCB0aGlzLl9kcmFpbkluZmxpZ2h0KHRoaXMuaW5mbGlnaHRJbmxpbmVKb2JzKVxuICAgIGF3YWl0IHRoaXMuX2RyYWluSW5mbGlnaHQodGhpcy5pbmZsaWdodFBvb2xlZEpvYnMpXG4gICAgYXdhaXQgdGhpcy5fZHJhaW5JbmZsaWdodCh0aGlzLmluZmxpZ2h0UHJvY2Vzc0pvYnMpXG4gICAgYXdhaXQgdGhpcy5fZHJhaW5JbmZsaWdodCh0aGlzLmluZmxpZ2h0UmVwb3J0cylcblxuICAgIHRoaXMuc2hvdWxkU3RvcCA9IHRydWVcbiAgICB0aGlzLl9zdG9wSGVhcnRiZWF0KClcbiAgICBpZiAodGhpcy5fcmVjb25uZWN0VGltZXIpIHtcbiAgICAgIGNsZWFyVGltZW91dCh0aGlzLl9yZWNvbm5lY3RUaW1lcilcbiAgICAgIHRoaXMuX3JlY29ubmVjdFRpbWVyID0gdW5kZWZpbmVkXG4gICAgfVxuICAgIGF3YWl0IHRoaXMuX3Rlcm1pbmF0ZVByb2Nlc3NDaGlsZHJlbigpXG5cbiAgICBhd2FpdCBzaHV0ZG93bkxpZmVjeWNsZSh7XG4gICAgICBvblN0b3BwZWQ6IHRoaXMub25TdG9wcGVkLFxuICAgICAgc2h1dGRvd246IGFzeW5jICgpID0+IHtcbiAgICAgICAgaWYgKHRoaXMuanNvblNvY2tldCkgdGhpcy5qc29uU29ja2V0LmNsb3NlKClcbiAgICAgICAgaWYgKCF0aGlzLmNvbmZpZ3VyYXRpb24pIHJldHVyblxuXG4gICAgICAgIGF3YWl0IHRoaXMuX2Nsb3NlQ29uZmlndXJhdGlvbigpXG4gICAgICB9XG4gICAgfSlcbiAgfVxuXG4gIC8qKlxuICAgKiBDbG9zZXMgYXBwbGljYXRpb24gcmVzb3VyY2VzIGJlZm9yZSBmcmFtZXdvcmsgcmVzb3VyY2VzIHdoZW4gdGhpcyB3b3JrZXIgb3ducyB0aGVtLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyBhZnRlciBldmVyeSBvd25lZCBjbG9zZSBzdWNjZWVkcy5cbiAgICovXG4gIGFzeW5jIF9jbG9zZUNvbmZpZ3VyYXRpb24oKSB7XG4gICAgY29uc3QgY29uZmlndXJhdGlvbiA9IHRoaXMuY29uZmlndXJhdGlvblxuXG4gICAgaWYgKCFjb25maWd1cmF0aW9uKSByZXR1cm5cblxuICAgIGF3YWl0IHJ1blNodXRkb3duU3RlcHMoe1xuICAgICAgbWVzc2FnZTogXCJCYWNrZ3JvdW5kIGpvYnMgd29ya2VyIGFwcGxpY2F0aW9uIGFuZCBmcmFtZXdvcmsgc2h1dGRvd24gZmFpbGVkXCIsXG4gICAgICBzdGVwczogW1xuICAgICAgICAuLi4odGhpcy5jbG9zZURhdGFiYXNlQ29ubmVjdGlvbnNPblN0b3BcbiAgICAgICAgICA/IFthc3luYyAoKSA9PiBhd2FpdCBjb25maWd1cmF0aW9uLnNodXRkb3duKCldXG4gICAgICAgICAgOiBbXSksXG4gICAgICAgIGFzeW5jICgpID0+IGF3YWl0IGNvbmZpZ3VyYXRpb24uZGlzY29ubmVjdEJlYWNvbigpLFxuICAgICAgICAuLi4odGhpcy5jbG9zZURhdGFiYXNlQ29ubmVjdGlvbnNPblN0b3BcbiAgICAgICAgICA/IFthc3luYyAoKSA9PiBhd2FpdCBjb25maWd1cmF0aW9uLmNsb3NlRGF0YWJhc2VDb25uZWN0aW9ucygpXVxuICAgICAgICAgIDogW10pXG4gICAgICBdXG4gICAgfSlcbiAgfVxuXG4gIC8qKlxuICAgKiBXYWl0cyBmb3IgYSBzZXQgb2YgaW4tZmxpZ2h0IGpvYiBwcm9taXNlcyB0byBzZXR0bGUsIG9wdGlvbmFsbHkgYm91bmRlZCBieVxuICAgKiBgdGltZW91dE1zYC5cbiAgICogQHBhcmFtIHtTZXQ8UHJvbWlzZTx2b2lkPj59IGluZmxpZ2h0IC0gSW4tZmxpZ2h0IGpvYiBwcm9taXNlcy5cbiAgICogQHBhcmFtIHtudW1iZXJ9IFt0aW1lb3V0TXNdIC0gTWF4IHdhaXQgaW4gbXM7IHVuYm91bmRlZCB3aGVuIG9taXR0ZWQuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIHdoZW4gc2V0dGxlZCBvciB0aGUgdGltZW91dCBlbGFwc2VzLlxuICAgKi9cbiAgYXN5bmMgX2RyYWluSW5mbGlnaHQoaW5mbGlnaHQsIHRpbWVvdXRNcykge1xuICAgIGlmIChpbmZsaWdodC5zaXplID09PSAwKSByZXR1cm5cblxuICAgIGNvbnN0IGRyYWluID0gUHJvbWlzZS5hbGxTZXR0bGVkKFsuLi5pbmZsaWdodF0pXG5cbiAgICBpZiAodHlwZW9mIHRpbWVvdXRNcyA9PT0gXCJudW1iZXJcIiAmJiB0aW1lb3V0TXMgPj0gMCkge1xuICAgICAgbGV0IHRpbWVyXG4gICAgICBjb25zdCB0aW1lb3V0ID0gbmV3IFByb21pc2UoKHJlc29sdmUpID0+IHsgdGltZXIgPSBzZXRUaW1lb3V0KHJlc29sdmUsIHRpbWVvdXRNcykgfSlcblxuICAgICAgYXdhaXQgUHJvbWlzZS5yYWNlKFtkcmFpbiwgdGltZW91dF0pXG4gICAgICBjbGVhclRpbWVvdXQodGltZXIpXG4gICAgfSBlbHNlIHtcbiAgICAgIGF3YWl0IGRyYWluXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIFRlcm1pbmF0ZXMgYW55IHByb2Nlc3MgcnVubmVyIGNoaWxkcmVuIHN0aWxsIGFsaXZlIGFmdGVyIHRoZSBkcmFpbiB3aW5kb3cgc29cbiAgICogdGhleSBkb24ndCBvdXRsaXZlIHRoZSB3b3JrZXIgYXMgb3JwaGFucy4gU0lHVEVSTSBsZXRzIHRoZSBydW5uZXIgY2xvc2UgaXRzXG4gICAqIGNvbm5lY3Rpb25zIGNsZWFubHk7IHN1cnZpdm9ycyBhcmUgU0lHS0lMTGVkIGFmdGVyIGEgc2hvcnQgZ3JhY2UuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIG9uY2Ugc3Vydml2b3JzIGhhdmUgYmVlbiBzaWduYWxsZWQuXG4gICAqL1xuICBhc3luYyBfdGVybWluYXRlUHJvY2Vzc0NoaWxkcmVuKCkge1xuICAgIGlmICh0aGlzLmluZmxpZ2h0UHJvY2Vzc0NoaWxkcmVuLnNpemUgPT09IDApIHJldHVyblxuXG4gICAgZm9yIChjb25zdCBjaGlsZCBvZiB0aGlzLmluZmxpZ2h0UHJvY2Vzc0NoaWxkcmVuKSB7XG4gICAgICBjb25zdCBwb29sZWRTdGF0ZSA9IHRoaXMucG9vbGVkQ2hpbGRTdGF0ZXMuZ2V0KGNoaWxkKVxuICAgICAgaWYgKHBvb2xlZFN0YXRlKSB7XG4gICAgICAgIHRoaXMuX3JlcXVlc3RQb29sZWRDaGlsZFNodXRkb3duKHtjaGlsZCwgcmVhc29uOiBcIndvcmtlcl9zdG9wXCIsIHNpZ25hbDogXCJTSUdURVJNXCJ9KVxuICAgICAgfSBlbHNlIHtcbiAgICAgICAgdHJ5IHtcbiAgICAgICAgICBjaGlsZC5raWxsKFwiU0lHVEVSTVwiKVxuICAgICAgICB9IGNhdGNoIHtcbiAgICAgICAgICAvLyBDaGlsZCBhbHJlYWR5IGV4aXRlZDsgbm90aGluZyB0byBkby5cbiAgICAgICAgfVxuICAgICAgfVxuICAgIH1cblxuICAgIGF3YWl0IG5ldyBQcm9taXNlKChyZXNvbHZlKSA9PiBzZXRUaW1lb3V0KHJlc29sdmUsIHRoaXMuZm9ya2VkQ2hpbGRTaWdraWxsR3JhY2VNcykpXG5cbiAgICBmb3IgKGNvbnN0IGNoaWxkIG9mIHRoaXMuaW5mbGlnaHRQcm9jZXNzQ2hpbGRyZW4pIHtcbiAgICAgIHRyeSB7XG4gICAgICAgIGNoaWxkLmtpbGwoXCJTSUdLSUxMXCIpXG4gICAgICB9IGNhdGNoIHtcbiAgICAgICAgLy8gQ2hpbGQgYWxyZWFkeSBleGl0ZWQ7IG5vdGhpbmcgdG8gZG8uXG4gICAgICB9XG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIENvbm5lY3RzIHRvIHRoZSB3b3JrZXIncyByZXNvbHZlZCBlbmRwb2ludCBhbmQgY29tcGxldGVzIGl0cyBoZWxsbyBmZW5jZS5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBSZWNvbm5lY3QgcG9saWN5LlxuICAgKiBAcGFyYW0ge2Jvb2xlYW59IGFyZ3MuYWxsb3dSZWNvbm5lY3QgLSBXaGV0aGVyIGEgZmFpbGVkIGF0dGVtcHQgbWF5IHNjaGVkdWxlIGFub3RoZXIgY29ubmVjdGlvbi5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgYWZ0ZXIgZ2VuZXJhdGlvbiBhY2tub3dsZWRnZW1lbnQuXG4gICAqL1xuICBhc3luYyBfY29ubmVjdCh7YWxsb3dSZWNvbm5lY3R9KSB7XG4gICAgY29uc3QgY29uZmlndXJhdGlvbiA9IHRoaXMuY29uZmlndXJhdGlvblxuICAgIGlmICghY29uZmlndXJhdGlvbikgdGhyb3cgbmV3IEVycm9yKFwiQmFja2dyb3VuZCBqb2JzIHdvcmtlciBjb25maWd1cmF0aW9uIG5vdCBpbml0aWFsaXplZFwiKVxuXG4gICAgY29uc3QgY29uZmlnID0gY29uZmlndXJhdGlvbi5nZXRCYWNrZ3JvdW5kSm9ic0NvbmZpZygpXG4gICAgaWYgKHRoaXMuZ2VuZXJhdGlvbklkKSB0aGlzLl9nZW5lcmF0aW9uQWNjZXB0ZWQgPSBmYWxzZVxuICAgIGNvbnN0IGhvc3QgPSB0aGlzLmhvc3QgfHwgY29uZmlnLmhvc3RcbiAgICBjb25zdCBwb3J0ID0gdHlwZW9mIHRoaXMucG9ydCA9PT0gXCJudW1iZXJcIiA/IHRoaXMucG9ydCA6IGNvbmZpZy5wb3J0XG4gICAgY29uc3Qgc29ja2V0ID0gbmV0LmNyZWF0ZUNvbm5lY3Rpb24oe2hvc3QsIHBvcnR9KVxuICAgIHNvY2tldC5zZXRLZWVwQWxpdmUodHJ1ZSwgU09DS0VUX0tFRVBBTElWRV9NUylcbiAgICBjb25zdCBqc29uU29ja2V0ID0gbmV3IEpzb25Tb2NrZXQoc29ja2V0KVxuICAgIHRoaXMuanNvblNvY2tldCA9IGpzb25Tb2NrZXRcbiAgICAvKipcbiAgICAgKiBSZXNvbHZlcyB0aGUgZ2VuZXJhdGlvbiBoYW5kc2hha2UuXG4gICAgICogQHR5cGUgeygpID0+IHZvaWR9XG4gICAgICovXG4gICAgbGV0IHJlc29sdmVIYW5kc2hha2UgPSAoKSA9PiB7fVxuICAgIC8qKlxuICAgICAqIFJlamVjdHMgdGhlIGdlbmVyYXRpb24gaGFuZHNoYWtlLlxuICAgICAqIEB0eXBlIHsoZXJyb3I6IEVycm9yKSA9PiB2b2lkfVxuICAgICAqL1xuICAgIGxldCByZWplY3RIYW5kc2hha2UgPSAoKSA9PiB7fVxuICAgIGxldCBjb25uZWN0aW9uQWNjZXB0ZWQgPSBmYWxzZVxuICAgIC8qKiBAdHlwZSB7UmV0dXJuVHlwZTx0eXBlb2Ygc2V0VGltZW91dD4gfCB1bmRlZmluZWR9ICovXG4gICAgbGV0IGhhbmRzaGFrZVRpbWVyXG4gICAgY29uc3QgaGFuZHNoYWtlID0gbmV3IFByb21pc2UoKC8qKiBAdHlwZSB7KHZhbHVlOiB2b2lkKSA9PiB2b2lkfSAqLyByZXNvbHZlLCByZWplY3QpID0+IHtcbiAgICAgIHJlc29sdmVIYW5kc2hha2UgPSByZXNvbHZlXG4gICAgICByZWplY3RIYW5kc2hha2UgPSByZWplY3RcbiAgICB9KVxuXG4gICAgLyoqXG4gICAgICogSGFuZGxlcyBhIGJhY2tncm91bmQgam9iIHNvY2tldCBtZXNzYWdlLlxuICAgICAqIEBwYXJhbSB7aW1wb3J0KFwiLi90eXBlcy5qc1wiKS5CYWNrZ3JvdW5kSm9iU29ja2V0TWVzc2FnZX0gbWVzc2FnZSAtIFNvY2tldCBtZXNzYWdlLlxuICAgICAqL1xuICAgIGpzb25Tb2NrZXQub24oXCJtZXNzYWdlXCIsIGFzeW5jIChtZXNzYWdlKSA9PiB7XG4gICAgICBpZiAobWVzc2FnZT8udHlwZSA9PT0gXCJnZW5lcmF0aW9uLWFjY2VwdGVkXCIpIHtcbiAgICAgICAgaWYgKCF0aGlzLmdlbmVyYXRpb25JZCB8fCBtZXNzYWdlLmdlbmVyYXRpb25JZCAhPT0gdGhpcy5nZW5lcmF0aW9uSWQpIHtcbiAgICAgICAgICByZWplY3RIYW5kc2hha2UobmV3IEVycm9yKFwiQmFja2dyb3VuZCBqb2JzIG1haW4gYWNrbm93bGVkZ2VkIGEgZGlmZmVyZW50IGdlbmVyYXRpb25cIikpXG4gICAgICAgICAganNvblNvY2tldC5kZXN0cm95KClcbiAgICAgICAgICByZXR1cm5cbiAgICAgICAgfVxuXG4gICAgICAgIHRoaXMuX2dlbmVyYXRpb25BY2NlcHRlZCA9IHRydWVcbiAgICAgICAgY29ubmVjdGlvbkFjY2VwdGVkID0gdHJ1ZVxuICAgICAgICBpZiAoaGFuZHNoYWtlVGltZXIpIHtcbiAgICAgICAgICBjbGVhclRpbWVvdXQoaGFuZHNoYWtlVGltZXIpXG4gICAgICAgICAgaGFuZHNoYWtlVGltZXIgPSB1bmRlZmluZWRcbiAgICAgICAgfVxuICAgICAgICBpZiAobWVzc2FnZS5saWZlY3ljbGVTdGF0ZSA9PT0gXCJyZXRpcmluZ1wiIHx8IG1lc3NhZ2UubGlmZWN5Y2xlU3RhdGUgPT09IFwicmV0aXJlZFwiKSB0aGlzLmlzUmV0aXJpbmcgPSB0cnVlXG4gICAgICAgIHRoaXMub25HZW5lcmF0aW9uQWNjZXB0ZWQ/LigpXG4gICAgICAgIHRoaXMuX3NlbmRSZWFkeUlmUnVubmluZygpXG4gICAgICAgIHRoaXMuX3N0YXJ0SGVhcnRiZWF0KClcbiAgICAgICAgcmVzb2x2ZUhhbmRzaGFrZSgpXG4gICAgICAgIHJldHVyblxuICAgICAgfVxuXG4gICAgICBpZiAobWVzc2FnZT8udHlwZSA9PT0gXCJnZW5lcmF0aW9uLXJlamVjdGVkXCIpIHtcbiAgICAgICAgdGhpcy5zaG91bGRTdG9wID0gdHJ1ZVxuICAgICAgICBpZiAoaGFuZHNoYWtlVGltZXIpIGNsZWFyVGltZW91dChoYW5kc2hha2VUaW1lcilcbiAgICAgICAgcmVqZWN0SGFuZHNoYWtlKG5ldyBFcnJvcihgQmFja2dyb3VuZCBqb2JzIGdlbmVyYXRpb24gcmVqZWN0ZWQ6ICR7bWVzc2FnZS5yZWFzb259YCkpXG4gICAgICAgIGpzb25Tb2NrZXQuZGVzdHJveSgpXG4gICAgICAgIHJldHVyblxuICAgICAgfVxuXG4gICAgICBpZiAobWVzc2FnZT8udHlwZSA9PT0gXCJyZXRpcmVcIikge1xuICAgICAgICBpZiAodGhpcy5nZW5lcmF0aW9uSWQgJiYgbWVzc2FnZS5nZW5lcmF0aW9uSWQgPT09IHRoaXMuZ2VuZXJhdGlvbklkKSB7XG4gICAgICAgICAgdGhpcy5vblJldGlyZU1lc3NhZ2U/LigpXG4gICAgICAgICAgdGhpcy5fYmVnaW5HZW5lcmF0aW9uUmV0aXJlbWVudCgpXG4gICAgICAgIH1cbiAgICAgICAgcmV0dXJuXG4gICAgICB9XG5cbiAgICAgIGlmIChtZXNzYWdlPy50eXBlID09PSBcImpvYlwiKSB7XG4gICAgICAgIGF3YWl0IHRoaXMuX2hhbmRsZUpvYihtZXNzYWdlLnBheWxvYWQpXG4gICAgICB9XG4gICAgfSlcblxuICAgIGpzb25Tb2NrZXQub24oXCJlcnJvclwiLCAoZXJyb3IpID0+IHtcbiAgICAgIGNvbnNvbGUuZXJyb3IoXCJCYWNrZ3JvdW5kIGpvYnMgd29ya2VyIHNvY2tldCBlcnJvcjpcIiwgZXJyb3IpXG4gICAgICBpZiAodGhpcy5nZW5lcmF0aW9uSWQgJiYgIXRoaXMuX2dlbmVyYXRpb25BY2NlcHRlZCkgcmVqZWN0SGFuZHNoYWtlKGVycm9yKVxuICAgIH0pXG5cbiAgICBqc29uU29ja2V0Lm9uKFwiY2xvc2VcIiwgKCkgPT4ge1xuICAgICAgaWYgKGhhbmRzaGFrZVRpbWVyKSBjbGVhclRpbWVvdXQoaGFuZHNoYWtlVGltZXIpXG4gICAgICB0aGlzLl9zdG9wSGVhcnRiZWF0KClcbiAgICAgIGlmICh0aGlzLmpzb25Tb2NrZXQgPT09IGpzb25Tb2NrZXQpIHRoaXMuanNvblNvY2tldCA9IHVuZGVmaW5lZFxuICAgICAgaWYgKHRoaXMuZ2VuZXJhdGlvbklkICYmICF0aGlzLl9nZW5lcmF0aW9uQWNjZXB0ZWQpIHtcbiAgICAgICAgcmVqZWN0SGFuZHNoYWtlKG5ldyBFcnJvcihcIkJhY2tncm91bmQgam9icyBzb2NrZXQgY2xvc2VkIGJlZm9yZSBnZW5lcmF0aW9uIGFja25vd2xlZGdlbWVudFwiKSlcbiAgICAgIH1cbiAgICAgIGlmICh0aGlzLnNob3VsZFN0b3ApIHJldHVyblxuICAgICAgaWYgKGNvbm5lY3Rpb25BY2NlcHRlZCB8fCBhbGxvd1JlY29ubmVjdCB8fCAhdGhpcy5nZW5lcmF0aW9uSWQpIHRoaXMuX3NjaGVkdWxlUmVjb25uZWN0KClcbiAgICB9KVxuXG4gICAgaWYgKHRoaXMuZ2VuZXJhdGlvbklkKSB7XG4gICAgICBoYW5kc2hha2VUaW1lciA9IHNldFRpbWVvdXQoKCkgPT4ge1xuICAgICAgICBjb25zdCBlcnJvciA9IG5ldyBCYWNrZ3JvdW5kSm9ic0dlbmVyYXRpb25IYW5kc2hha2VUaW1lb3V0RXJyb3Ioe1xuICAgICAgICAgIGVuZHBvaW50OiBgJHtob3N0fToke3BvcnR9YCxcbiAgICAgICAgICBnZW5lcmF0aW9uSWQ6IHRoaXMuZ2VuZXJhdGlvbklkIHx8IFwiXCIsXG4gICAgICAgICAgcm9sZTogXCJ3b3JrZXJcIixcbiAgICAgICAgICB0aW1lb3V0TXM6IHRoaXMuZ2VuZXJhdGlvbkhhbmRzaGFrZVRpbWVvdXRNc1xuICAgICAgICB9KVxuICAgICAgICByZWplY3RIYW5kc2hha2UoZXJyb3IpXG4gICAgICAgIGpzb25Tb2NrZXQuZGVzdHJveSgpXG4gICAgICB9LCB0aGlzLmdlbmVyYXRpb25IYW5kc2hha2VUaW1lb3V0TXMpXG4gICAgfVxuXG4gICAgc29ja2V0Lm9uKFwiY29ubmVjdFwiLCAoKSA9PiB7XG4gICAgICBqc29uU29ja2V0LnNlbmQoe3R5cGU6IFwiaGVsbG9cIiwgcm9sZTogXCJ3b3JrZXJcIiwgLi4uKHRoaXMuZ2VuZXJhdGlvbklkID8ge2dlbmVyYXRpb25JZDogdGhpcy5nZW5lcmF0aW9uSWR9IDoge30pLCBzdXBwb3J0c0hhbmRvZmZJZFJlcG9ydGluZzogdHJ1ZSwgc3VwcG9ydHNIZWFydGJlYXQ6IHRydWUsIHN1cHBvcnRzUG9vbGVkOiB0cnVlLCB3b3JrZXJJZDogdGhpcy53b3JrZXJJZH0pXG4gICAgICBpZiAoIXRoaXMuZ2VuZXJhdGlvbklkKSB7XG4gICAgICAgIGNvbm5lY3Rpb25BY2NlcHRlZCA9IHRydWVcbiAgICAgICAgdGhpcy5fc2VuZFJlYWR5SWZSdW5uaW5nKClcbiAgICAgICAgdGhpcy5fc3RhcnRIZWFydGJlYXQoKVxuICAgICAgICByZXNvbHZlSGFuZHNoYWtlKClcbiAgICAgIH1cbiAgICB9KVxuXG4gICAgaWYgKHRoaXMuZ2VuZXJhdGlvbklkKSBhd2FpdCBoYW5kc2hha2VcbiAgfVxuXG4gIC8qKiBTY2hlZHVsZXMgb25lIGZlbmNlZCByZWNvbm5lY3QgdG8gdGhlIHdvcmtlcidzIHVuY2hhbmdlZCBlbmRwb2ludC4gKi9cbiAgX3NjaGVkdWxlUmVjb25uZWN0KCkge1xuICAgIGlmICh0aGlzLnNob3VsZFN0b3AgfHwgdGhpcy5fcmVjb25uZWN0VGltZXIpIHJldHVyblxuXG4gICAgdGhpcy5fcmVjb25uZWN0VGltZXIgPSBzZXRUaW1lb3V0KCgpID0+IHtcbiAgICAgIHRoaXMuX3JlY29ubmVjdFRpbWVyID0gdW5kZWZpbmVkXG4gICAgICBpZiAodGhpcy5zaG91bGRTdG9wKSByZXR1cm5cbiAgICAgIHZvaWQgdGhpcy5fY29ubmVjdCh7YWxsb3dSZWNvbm5lY3Q6IHRydWV9KS5jYXRjaCgoZXJyb3IpID0+IHtcbiAgICAgICAgaWYgKCF0aGlzLnNob3VsZFN0b3ApIGNvbnNvbGUuZXJyb3IoXCJCYWNrZ3JvdW5kIGpvYnMgd29ya2VyIHJlY29ubmVjdCBmYWlsZWQ6XCIsIGVycm9yKVxuICAgICAgfSlcbiAgICB9LCB0aGlzLnJlY29ubmVjdERlbGF5TXMpXG4gICAgaWYgKHR5cGVvZiB0aGlzLl9yZWNvbm5lY3RUaW1lci51bnJlZiA9PT0gXCJmdW5jdGlvblwiKSB0aGlzLl9yZWNvbm5lY3RUaW1lci51bnJlZigpXG4gIH1cblxuICAvKipcbiAgICogU3VyZmFjZXMgYW4gdW5leHBlY3RlZCB3b3JrZXIgbGlmZWN5Y2xlIGZhaWx1cmUgdGhyb3VnaCB0aGUgZnJhbWV3b3JrIGVycm9yXG4gICAqIGNoYW5uZWxzIHNvIGEgc3VwZXJ2aXNvciBob29rIHRoYXQgaWdub3JlcyBzdGRpbyBzdGlsbCBoYXMgb2JzZXJ2YWJpbGl0eS5cbiAgICogQHBhcmFtIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gZXJyb3IgLSBXb3JrZXIgbGlmZWN5Y2xlIGZhaWx1cmUuXG4gICAqL1xuICBfcmVwb3J0TGlmZWN5Y2xlRXJyb3IoZXJyb3IpIHtcbiAgICBjb25zdCBjb25maWd1cmF0aW9uID0gdGhpcy5jb25maWd1cmF0aW9uXG4gICAgaWYgKCFjb25maWd1cmF0aW9uKSByZXR1cm5cbiAgICBjb25zdCBub3JtYWxpemVkRXJyb3IgPSBlcnJvciBpbnN0YW5jZW9mIEVycm9yID8gZXJyb3IgOiBuZXcgRXJyb3IoU3RyaW5nKGVycm9yKSlcbiAgICBjb25zdCBwYXlsb2FkID0ge2NvbnRleHQ6IHtnZW5lcmF0aW9uSWQ6IHRoaXMuZ2VuZXJhdGlvbklkLCBzdGFnZTogXCJiYWNrZ3JvdW5kLWpvYnMtd29ya2VyLWxpZmVjeWNsZVwifSwgZXJyb3I6IG5vcm1hbGl6ZWRFcnJvcn1cbiAgICBjb25zdCBlcnJvckV2ZW50cyA9IGNvbmZpZ3VyYXRpb24uZ2V0RXJyb3JFdmVudHMoKVxuXG4gICAgZXJyb3JFdmVudHMuZW1pdChcImZyYW1ld29yay1lcnJvclwiLCBwYXlsb2FkKVxuICAgIGVycm9yRXZlbnRzLmVtaXQoXCJhbGwtZXJyb3JcIiwgey4uLnBheWxvYWQsIGVycm9yVHlwZTogXCJmcmFtZXdvcmstZXJyb3JcIn0pXG4gIH1cblxuICAvKipcbiAgICogU2VuZHMgcGVyaW9kaWMgbGl2ZW5lc3MgaGVhcnRiZWF0cyB0byB0aGUgbWFpbiBzbyBhIHdlZGdlZCBvciBzaWxlbnQgd29ya2VyXG4gICAqIGNhbiBiZSBkZXRlY3RlZCBhbmQgZHJvcHBlZCB0aGVyZSAoaXRzIGxlYXNlcyByZWxlYXNlZCkgaW5zdGVhZCBvZiBmcmVlemluZ1xuICAgKiB0aGUgcXVldWUgdW50aWwgYSBodW1hbiBub3RpY2VzLlxuICAgKiBAcmV0dXJucyB7dm9pZH1cbiAgICovXG4gIF9zdGFydEhlYXJ0YmVhdCgpIHtcbiAgICB0aGlzLl9zdG9wSGVhcnRiZWF0KClcblxuICAgIHRoaXMuX2hlYXJ0YmVhdFRpbWVyID0gc2V0SW50ZXJ2YWwoKCkgPT4gdGhpcy5fc2VuZEhlYXJ0YmVhdCgpLCB0aGlzLmhlYXJ0YmVhdEludGVydmFsTXMpXG5cbiAgICBpZiAodHlwZW9mIHRoaXMuX2hlYXJ0YmVhdFRpbWVyLnVucmVmID09PSBcImZ1bmN0aW9uXCIpIHRoaXMuX2hlYXJ0YmVhdFRpbWVyLnVucmVmKClcbiAgfVxuXG4gIC8qKiBTZW5kcyBvbmUgbGl2ZW5lc3MgaGVhcnRiZWF0IHdoaWxlIHRoZSB3b3JrZXIgaGFzIG5vdCBmaW5hbGx5IHN0b3BwZWQuICovXG4gIF9zZW5kSGVhcnRiZWF0KCkge1xuICAgIGlmICh0aGlzLnNob3VsZFN0b3AgfHwgIXRoaXMuanNvblNvY2tldCkgcmV0dXJuXG5cbiAgICB0cnkge1xuICAgICAgdGhpcy5qc29uU29ja2V0LnNlbmQoe3R5cGU6IFwiaGVhcnRiZWF0XCIsIHdvcmtlcklkOiB0aGlzLndvcmtlcklkfSlcbiAgICB9IGNhdGNoIHtcbiAgICAgIC8vIFNvY2tldCBpcyBjbG9zaW5nL2Nsb3NlZDsgdGhlIGNsb3NlIGhhbmRsZXIgZHJpdmVzIHJlY29ubmVjdC5cbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogU3RvcHMgdGhlIGxpdmVuZXNzIGhlYXJ0YmVhdCB0aW1lci5cbiAgICogQHJldHVybnMge3ZvaWR9XG4gICAqL1xuICBfc3RvcEhlYXJ0YmVhdCgpIHtcbiAgICBpZiAodGhpcy5faGVhcnRiZWF0VGltZXIpIHtcbiAgICAgIGNsZWFySW50ZXJ2YWwodGhpcy5faGVhcnRiZWF0VGltZXIpXG4gICAgICB0aGlzLl9oZWFydGJlYXRUaW1lciA9IHVuZGVmaW5lZFxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGhhbmRsZSBqb2IuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi90eXBlcy5qc1wiKS5CYWNrZ3JvdW5kSm9iUGF5bG9hZH0gcGF5bG9hZCAtIFBheWxvYWQuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIHdoZW4gZG9uZS5cbiAgICovXG4gIGFzeW5jIF9oYW5kbGVKb2IocGF5bG9hZCkge1xuICAgIGlmICghcGF5bG9hZC5pZCkgdGhyb3cgbmV3IEVycm9yKFwiQmFja2dyb3VuZCBqb2IgcGF5bG9hZCBtaXNzaW5nIGlkXCIpXG4gICAgLyoqXG4gICAgICogSWRlbnRpZmllZCBwYXlsb2FkLlxuICAgICAqIEB0eXBlIHtpbXBvcnQoXCIuL3R5cGVzLmpzXCIpLkJhY2tncm91bmRKb2JQYXlsb2FkICYge2lkOiBzdHJpbmd9fSAqL1xuICAgIGNvbnN0IGlkZW50aWZpZWRQYXlsb2FkID0gLyoqIEB0eXBlIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gKi8gKHBheWxvYWQpXG5cbiAgICBjb25zdCBleGVjdXRpb25Nb2RlID0gdGhpcy5fZXhlY3V0aW9uTW9kZUZvclBheWxvYWQoaWRlbnRpZmllZFBheWxvYWQpXG5cbiAgICBpZiAoZXhlY3V0aW9uTW9kZSA9PT0gXCJwb29sZWRcIikge1xuICAgICAgdGhpcy5fcXVldWVQb29sZWRKb2IoaWRlbnRpZmllZFBheWxvYWQpXG4gICAgICByZXR1cm5cbiAgICB9XG5cbiAgICBpZiAoZXhlY3V0aW9uTW9kZSAhPT0gXCJpbmxpbmVcIikge1xuICAgICAgdGhpcy5fdHJhY2tQcm9jZXNzSm9iKHRoaXMuX3N0YXJ0UHJvY2Vzc0pvYih7ZXhlY3V0aW9uTW9kZSwgcGF5bG9hZDogaWRlbnRpZmllZFBheWxvYWR9KSlcbiAgICAgIHJldHVyblxuICAgIH1cblxuICAgIHRoaXMuX2hhbmRsZUlubGluZUpvYihpZGVudGlmaWVkUGF5bG9hZClcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHN0YXJ0IHByb2Nlc3Mgam9iLlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIE9wdGlvbnMuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi90eXBlcy5qc1wiKS5CYWNrZ3JvdW5kSm9iRXhlY3V0aW9uTW9kZX0gYXJncy5leGVjdXRpb25Nb2RlIC0gRXhlY3V0aW9uIG1vZGUuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi90eXBlcy5qc1wiKS5CYWNrZ3JvdW5kSm9iUGF5bG9hZCAmIHtpZDogc3RyaW5nfX0gYXJncy5wYXlsb2FkIC0gUGF5bG9hZC5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgd2hlbiB0aGUgcHJvY2VzcyBqb2IgZXhpdHMuXG4gICAqL1xuICBfc3RhcnRQcm9jZXNzSm9iKHtleGVjdXRpb25Nb2RlLCBwYXlsb2FkfSkge1xuICAgIGlmIChleGVjdXRpb25Nb2RlID09PSBcImZvcmtlZFwiKSByZXR1cm4gdGhpcy5fZm9ya0pvYihwYXlsb2FkKVxuXG4gICAgcmV0dXJuIHRoaXMuX3NwYXduSm9iKHBheWxvYWQpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBoYW5kbGUgaW5saW5lIGpvYi5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL3R5cGVzLmpzXCIpLkJhY2tncm91bmRKb2JQYXlsb2FkICYge2lkOiBzdHJpbmd9fSBwYXlsb2FkIC0gUGF5bG9hZC5cbiAgICogQHJldHVybnMge3ZvaWR9XG4gICAqL1xuICBfaGFuZGxlSW5saW5lSm9iKHBheWxvYWQpIHtcbiAgICAvLyBJbmxpbmUgam9icyBzaGFyZSB0aGUgd29ya2VyJ3MgcHJvY2VzcyBhbmQgREIgcG9vbCwgYnV0IGVhY2ggb25lXG4gICAgLy8gaXMgaXRzIG93biBhc3luYyBjaGFpbiDigJQgdGhlcmUncyBubyBzZW1hbnRpYyByZWFzb24gdG8gc2VyaWFsaXplXG4gICAgLy8gdGhlbS4gV2Uga2ljayBvZmYgdGhlIGpvYiwgcmVnaXN0ZXIgaXQgd2l0aCBgaW5mbGlnaHRJbmxpbmVKb2JzYFxuICAgIC8vIGZvciBzaHV0ZG93biBkcmFpbiwgYW5kIHNpZ25hbCBjYXBhY2l0eSB0byBtYWluOlxuICAgIC8vIC0gSWYgd2Ugc3RpbGwgaGF2ZSBhIGZyZWUgc2xvdCB3ZSBhc2sgZm9yIHRoZSBuZXh0IGpvYiByaWdodFxuICAgIC8vICAgYXdheSwgc28gYSBzbG93IGpvYiAoZS5nLiBhIGRvY2tlciBhbGl2ZSBjaGVjayB0aGF0IHdhaXRzIDE1c1xuICAgIC8vICAgb24gYSBnb25lIHNlcnZlcikgbm8gbG9uZ2VyIHN0YXJ2ZXMgZXZlcnkgb3RoZXIgaW5saW5lIGpvYi5cbiAgICAvLyAtIFdoZW4gdGhlIGpvYiBmaW5pc2hlcywgaWYgdGhlIHdvcmtlciBoYWQgYmVlbiBhdCB0aGUgY2FwLCB3ZVxuICAgIC8vICAgYXNrIGZvciB0aGUgbmV4dCBqb2IgdG8gcmVmaWxsIHRoZSBzbG90LlxuICAgIC8vIFRoZSBib29ra2VlcGluZyBpbiBgZmluYWxseSgpYCByYXRjaGV0cyBjYXBhY2l0eSBiYWNrIHVwXG4gICAgLy8gcmVnYXJkbGVzcyBvZiBzdWNjZXNzIG9yIGZhaWx1cmUuXG4gICAgLyoqXG4gICAgICogRGVmaW5lcyBpbmZsaWdodC5cbiAgICAgKiBAdHlwZSB7UHJvbWlzZTx2b2lkPn0gKi9cbiAgICBsZXQgaW5mbGlnaHRcblxuICAgIGluZmxpZ2h0ID0gdGhpcy5fcnVuSW5saW5lSm9iQW5kUmVwb3J0KHBheWxvYWQpLmZpbmFsbHkoKCkgPT4ge1xuICAgICAgdGhpcy5pbmZsaWdodElubGluZUpvYnMuZGVsZXRlKGluZmxpZ2h0KVxuXG4gICAgICAvLyBSZS1hbm5vdW5jZSBvbiBldmVyeSBjb21wbGV0aW9uIGJlbG93IGNhcCwgbm90IGp1c3QgdGhlIGNhcOKGkmNhcC0xIGVkZ2Ug4oCUXG4gICAgICAvLyBzZWUgX3RyYWNrUHJvY2Vzc0pvYiBmb3Igd2h5IHRoZSBrbmlmZS1lZGdlIGNvbmRpdGlvbiBzaWxlbnRseSB3ZWRnZXMuXG4gICAgICBpZiAoIXRoaXMuc2hvdWxkU3RvcCkgdGhpcy5fc2VuZFJlYWR5SWZSdW5uaW5nKClcbiAgICB9KVxuXG4gICAgdGhpcy5pbmZsaWdodElubGluZUpvYnMuYWRkKGluZmxpZ2h0KVxuXG4gICAgaWYgKHRoaXMuaW5mbGlnaHRJbmxpbmVKb2JzLnNpemUgPCB0aGlzLm1heENvbmN1cnJlbnRJbmxpbmVKb2JzKSB7XG4gICAgICB0aGlzLl9zZW5kUmVhZHlJZlJ1bm5pbmcoKVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGV4ZWN1dGlvbiBtb2RlIGZvciBwYXlsb2FkLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vdHlwZXMuanNcIikuQmFja2dyb3VuZEpvYlBheWxvYWR9IHBheWxvYWQgLSBQYXlsb2FkLlxuICAgKiBAcmV0dXJucyB7aW1wb3J0KFwiLi90eXBlcy5qc1wiKS5CYWNrZ3JvdW5kSm9iRXhlY3V0aW9uTW9kZX0gLSBFeGVjdXRpb24gbW9kZS5cbiAgICovXG4gIF9leGVjdXRpb25Nb2RlRm9yUGF5bG9hZChwYXlsb2FkKSB7XG4gICAgY29uc3QgZXhlY3V0aW9uTW9kZSA9IHBheWxvYWQub3B0aW9ucz8uZXhlY3V0aW9uTW9kZVxuXG4gICAgcmV0dXJuIGV4ZWN1dGlvbk1vZGUgPyB0aGlzLl9ub3JtYWxpemVFeGVjdXRpb25Nb2RlKGV4ZWN1dGlvbk1vZGUpIDogXCJwb29sZWRcIlxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgbm9ybWFsaXplIGV4ZWN1dGlvbiBtb2RlLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gZXhlY3V0aW9uTW9kZSAtIEV4ZWN1dGlvbiBtb2RlLlxuICAgKiBAcmV0dXJucyB7aW1wb3J0KFwiLi90eXBlcy5qc1wiKS5CYWNrZ3JvdW5kSm9iRXhlY3V0aW9uTW9kZX0gLSBOb3JtYWxpemVkIGV4ZWN1dGlvbiBtb2RlLlxuICAgKi9cbiAgX25vcm1hbGl6ZUV4ZWN1dGlvbk1vZGUoZXhlY3V0aW9uTW9kZSkge1xuICAgIGZvciAoY29uc3QgbW9kZSBvZiBFWEVDVVRJT05fTU9ERVMpIHtcbiAgICAgIGlmIChtb2RlID09PSBleGVjdXRpb25Nb2RlKSByZXR1cm4gbW9kZVxuICAgIH1cblxuICAgIHRocm93IG5ldyBFcnJvcihgSW52YWxpZCBiYWNrZ3JvdW5kIGpvYiBleGVjdXRpb25Nb2RlOiAke2V4ZWN1dGlvbk1vZGV9YClcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHRyYWNrIHByb2Nlc3Mgam9iLlxuICAgKiBAcGFyYW0ge1Byb21pc2U8dm9pZD59IHByb2Nlc3NKb2IgLSBQcm9jZXNzIGpvYiBwcm9taXNlLlxuICAgKiBAcmV0dXJucyB7dm9pZH1cbiAgICovXG4gIF90cmFja1Byb2Nlc3NKb2IocHJvY2Vzc0pvYikge1xuICAgIC8qKlxuICAgICAqIERlZmluZXMgaW5mbGlnaHQuXG4gICAgICogQHR5cGUge1Byb21pc2U8dm9pZD59ICovXG4gICAgbGV0IGluZmxpZ2h0XG5cbiAgICBpbmZsaWdodCA9IHByb2Nlc3NKb2IuZmluYWxseSgoKSA9PiB7XG4gICAgICB0aGlzLmluZmxpZ2h0UHJvY2Vzc0pvYnMuZGVsZXRlKGluZmxpZ2h0KVxuXG4gICAgICAvLyBSZS1hbm5vdW5jZSByZWFkaW5lc3Mgb24gRVZFUlkgY29tcGxldGlvbiB0aGF0IGxlYXZlcyB1cyBiZWxvdyBjYXAg4oCUIG5vdFxuICAgICAgLy8ganVzdCB0aGUgc2luZ2xlIGNhcOKGkmNhcC0xIGVkZ2UuIFRoZSBtYWluIHJlbW92ZXMgYSB3b3JrZXIgZnJvbSBpdHMgcmVhZHlcbiAgICAgIC8vIHNldCBvbiBlYWNoIGRpc3BhdGNoIChgX2RyYWluT25jZWApIGFuZCBvbmx5IHJlLWFkZHMgaXQgb24gYSBmcmVzaFxuICAgICAgLy8gXCJyZWFkeVwiOyBnYXRpbmcgdGhlIHJlLWFubm91bmNlIG9uIG9uZSBrbmlmZS1lZGdlIHRyYW5zaXRpb24gbWVhbnMgYVxuICAgICAgLy8gc2luZ2xlIG1pc3NlZCBvciBsb3N0IHNpZ25hbCBsZWF2ZXMgdGhlIHdvcmtlciBvdXQgb2YgdGhlIHJlYWR5IHNldCBhbmRcbiAgICAgIC8vIHdlZGdlcyBkaXNwYXRjaCBjbHVzdGVyLXdpZGUuIFRoaXMgd2FzIHRoZSBzaWxlbnQtZnJlZXplIHJvb3QgY2F1c2UuXG4gICAgICAvLyBgX3NlbmRSZWFkeUlmUnVubmluZ2Agc2VsZi1ndWFyZHMgKGl0IHNlbmRzIG5vdGhpbmcgd2hlbiB0aGUgd29ya2VyIGlzXG4gICAgICAvLyBnZW51aW5lbHkgYXQgY2FwYWNpdHkpLCBzbyByZS1hbm5vdW5jaW5nIG9uIGV2ZXJ5IGZyZWVkIHNsb3QgaXMgc2FmZSBhbmRcbiAgICAgIC8vIGlkZW1wb3RlbnQgb24gdGhlIG1haW4uXG4gICAgICBpZiAoIXRoaXMuc2hvdWxkU3RvcCkgdGhpcy5fc2VuZFJlYWR5SWZSdW5uaW5nKClcbiAgICB9KVxuXG4gICAgdGhpcy5pbmZsaWdodFByb2Nlc3NKb2JzLmFkZChpbmZsaWdodClcbiAgICB0aGlzLl9zZW5kUmVhZHlJZlJ1bm5pbmcoKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgcnVuIGlubGluZSBqb2IgYW5kIHJlcG9ydC5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL3R5cGVzLmpzXCIpLkJhY2tncm91bmRKb2JQYXlsb2FkICYge2lkOiBzdHJpbmd9fSBwYXlsb2FkIC0gUGF5bG9hZCB3aXRoIHJlcXVpcmVkIGlkLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyB3aGVuIGNvbXBsZXRlIChzdWNjZXNzIG9yIGZhaWx1cmUgcmVwb3J0ZWQpLlxuICAgKi9cbiAgYXN5bmMgX3J1bklubGluZUpvYkFuZFJlcG9ydChwYXlsb2FkKSB7XG4gICAgLy8gUmVwb3J0IGluIHRoZSBiYWNrZ3JvdW5kIHNvIGZyZWVpbmcgdGhpcyBpbmxpbmUgc2xvdCBuZXZlciB3YWl0cyBvbiB0aGVcbiAgICAvLyByZXBvcnQuIFJlcG9ydGluZyBpcyBkdXJhYmxlIChyZXRyaWVkIHVudGlsIGl0IGxhbmRzKSwgc28gYSB0cmFuc2llbnRcbiAgICAvLyBtYWluL0RCIG91dGFnZSBuZWl0aGVyIHdlZGdlcyB0aGUgc2xvdCBub3IgbG9zZXMgdGhlIHRlcm1pbmFsIHJlc3VsdC5cbiAgICB0cnkge1xuICAgICAgYXdhaXQgdGhpcy5fcnVuSm9iSW5saW5lKHBheWxvYWQpXG4gICAgICB0aGlzLl9yZXBvcnRKb2JSZXN1bHRJbkJhY2tncm91bmQoe1xuICAgICAgICBqb2JJZDogcGF5bG9hZC5pZCxcbiAgICAgICAgc3RhdHVzOiBcImNvbXBsZXRlZFwiLFxuICAgICAgICBoYW5kb2ZmSWQ6IHBheWxvYWQuaGFuZG9mZklkLFxuICAgICAgICBoYW5kZWRPZmZBdE1zOiBwYXlsb2FkLmhhbmRlZE9mZkF0TXMsXG4gICAgICAgIHdvcmtlcklkOiBwYXlsb2FkLndvcmtlcklkIHx8IHRoaXMud29ya2VySWRcbiAgICAgIH0pXG4gICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgIGlmIChlcnJvciBpbnN0YW5jZW9mIEJhY2tncm91bmRKb2JSZXNjaGVkdWxlU2lnbmFsKSB7XG4gICAgICAgIHRoaXMuX3JlcG9ydEpvYlJlc3VsdEluQmFja2dyb3VuZCh7XG4gICAgICAgICAgam9iSWQ6IHBheWxvYWQuaWQsXG4gICAgICAgICAgc3RhdHVzOiBcInJlc2NoZWR1bGVkXCIsXG4gICAgICAgICAgZGVsYXlNczogZXJyb3IuZGVsYXlNcyxcbiAgICAgICAgICBoYW5kb2ZmSWQ6IHBheWxvYWQuaGFuZG9mZklkLFxuICAgICAgICAgIGhhbmRlZE9mZkF0TXM6IHBheWxvYWQuaGFuZGVkT2ZmQXRNcyxcbiAgICAgICAgICB3b3JrZXJJZDogcGF5bG9hZC53b3JrZXJJZCB8fCB0aGlzLndvcmtlcklkXG4gICAgICAgIH0pXG4gICAgICAgIHJldHVyblxuICAgICAgfVxuXG4gICAgICB0aGlzLl9yZXBvcnRKb2JSZXN1bHRJbkJhY2tncm91bmQoe1xuICAgICAgICBqb2JJZDogcGF5bG9hZC5pZCxcbiAgICAgICAgc3RhdHVzOiBcImZhaWxlZFwiLFxuICAgICAgICBlcnJvcixcbiAgICAgICAgaGFuZG9mZklkOiBwYXlsb2FkLmhhbmRvZmZJZCxcbiAgICAgICAgaGFuZGVkT2ZmQXRNczogcGF5bG9hZC5oYW5kZWRPZmZBdE1zLFxuICAgICAgICB3b3JrZXJJZDogcGF5bG9hZC53b3JrZXJJZCB8fCB0aGlzLndvcmtlcklkXG4gICAgICB9KVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBBZHZlcnRpc2VzIGN1cnJlbnQgd29ya2VyIGNhcGFjaXR5IHVubGVzcyB0aGUgd29ya2VyIGlzIGRyYWluaW5nLlxuICAgKiBAcGFyYW0ge29iamVjdH0gW29wdGlvbnNdIC0gQWR2ZXJ0aXNlbWVudCBvcHRpb25zLlxuICAgKiBAcGFyYW0ge2Jvb2xlYW59IFtvcHRpb25zLnJldm9rZVBvb2xlZEFkbWlzc2lvbl0gLSBSZXZva2UgcG9vbGVkIGNyZWRpdHMgd2hpbGUgcHJlc2VydmluZyBvdGhlciBleGVjdXRpb24gbW9kZXMuXG4gICAqIEByZXR1cm5zIHt2b2lkfVxuICAgKi9cbiAgX3NlbmRSZWFkeUlmUnVubmluZyh7cmV2b2tlUG9vbGVkQWRtaXNzaW9uID0gZmFsc2V9ID0ge30pIHtcbiAgICBpZiAodGhpcy5zaG91bGRTdG9wIHx8IHRoaXMuaXNSZXRpcmluZykgcmV0dXJuXG4gICAgaWYgKCF0aGlzLmpzb25Tb2NrZXQpIHJldHVyblxuICAgIGlmICh0aGlzLmdlbmVyYXRpb25JZCAmJiAhdGhpcy5fZ2VuZXJhdGlvbkFjY2VwdGVkKSByZXR1cm5cblxuICAgIGNvbnN0IHJlYWR5TWVzc2FnZSA9IHRoaXMuX3JlYWR5TWVzc2FnZSh7cmV2b2tlUG9vbGVkQWRtaXNzaW9ufSlcblxuICAgIGlmICghcmVhZHlNZXNzYWdlKSByZXR1cm5cbiAgICB0aGlzLmpzb25Tb2NrZXQuc2VuZChyZWFkeU1lc3NhZ2UpXG4gIH1cblxuICAvKipcbiAgICogUnVucyByZWFkeSBtZXNzYWdlLlxuICAgKiBAcGFyYW0ge29iamVjdH0gW29wdGlvbnNdIC0gQWR2ZXJ0aXNlbWVudCBvcHRpb25zLlxuICAgKiBAcGFyYW0ge2Jvb2xlYW59IFtvcHRpb25zLnJldm9rZVBvb2xlZEFkbWlzc2lvbl0gLSBSZXZva2UgcG9vbGVkIGNyZWRpdHMgd2hpbGUgcHJlc2VydmluZyBvdGhlciBleGVjdXRpb24gbW9kZXMuXG4gICAqIEByZXR1cm5zIHtpbXBvcnQoXCIuL3R5cGVzLmpzXCIpLkJhY2tncm91bmRKb2JTb2NrZXRNZXNzYWdlIHwgbnVsbH0gLSBSZWFkeSBtZXNzYWdlIG9yIG51bGwgd2hlbiB0aGUgd29ya2VyIGhhcyBubyBjYXBhY2l0eS5cbiAgICovXG4gIF9yZWFkeU1lc3NhZ2Uoe3Jldm9rZVBvb2xlZEFkbWlzc2lvbiA9IGZhbHNlfSA9IHt9KSB7XG4gICAgY29uc3QgYWNjZXB0c1Byb2Nlc3NKb2IgPSB0aGlzLmluZmxpZ2h0UHJvY2Vzc0pvYnMuc2l6ZSA8IHRoaXMubWF4Q29uY3VycmVudEZvcmtlZEpvYnNcbiAgICBjb25zdCBhY2NlcHRzSW5saW5lID0gdGhpcy5pbmZsaWdodElubGluZUpvYnMuc2l6ZSA8IHRoaXMubWF4Q29uY3VycmVudElubGluZUpvYnNcbiAgICBjb25zdCBhdmFpbGFibGVQb29sZWRTbG90cyA9IHJldm9rZVBvb2xlZEFkbWlzc2lvbiA/IDAgOiB0aGlzLl9hdmFpbGFibGVQb29sZWRTbG90cygpXG4gICAgY29uc3QgYWNjZXB0c1Bvb2xlZCA9IGF2YWlsYWJsZVBvb2xlZFNsb3RzID4gMFxuXG4gICAgaWYgKCFyZXZva2VQb29sZWRBZG1pc3Npb24gJiYgIWFjY2VwdHNQcm9jZXNzSm9iICYmICFhY2NlcHRzSW5saW5lICYmICFhY2NlcHRzUG9vbGVkKSByZXR1cm4gbnVsbFxuXG4gICAgcmV0dXJuIHtcbiAgICAgIHR5cGU6IFwicmVhZHlcIixcbiAgICAgIGFjY2VwdHNGb3JrZWQ6IGFjY2VwdHNQcm9jZXNzSm9iLFxuICAgICAgYWNjZXB0c0lubGluZSxcbiAgICAgIGFjY2VwdHNQb29sZWQsXG4gICAgICBhdmFpbGFibGVQb29sZWRTbG90cyxcbiAgICAgIGFjY2VwdHNTcGF3bmVkOiBhY2NlcHRzUHJvY2Vzc0pvYlxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBUcmFja3MgYSBwb29sZWQgam9iIGFuZCByZS1hZHZlcnRpc2VzIGNhcGFjaXR5LlxuICAgKiBAcGFyYW0ge1Byb21pc2U8dm9pZD59IHBvb2xlZEpvYiAtIFBvb2xlZCBqb2IgcHJvbWlzZS5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gVGhlIHRyYWNrZWQgaW4tZmxpZ2h0IHByb21pc2UuXG4gICAqL1xuICBfdHJhY2tQb29sZWRKb2IocG9vbGVkSm9iKSB7XG4gICAgLyoqIEB0eXBlIHtQcm9taXNlPHZvaWQ+fSAqL1xuICAgIGxldCBpbmZsaWdodFxuICAgIGluZmxpZ2h0ID0gcG9vbGVkSm9iLmZpbmFsbHkoKCkgPT4ge1xuICAgICAgdGhpcy5pbmZsaWdodFBvb2xlZEpvYnMuZGVsZXRlKGluZmxpZ2h0KVxuICAgICAgaWYgKCF0aGlzLnNob3VsZFN0b3AgJiYgIXRoaXMuX3Bvb2xlZFN0YXJ0dXBGYWlsdXJlSm9icy5oYXMocG9vbGVkSm9iKSAmJiAhdGhpcy5fcG9vbGVkU3RhcnR1cEZhaWx1cmVKb2JzLmhhcyhpbmZsaWdodCkpIHRoaXMuX3NlbmRSZWFkeUlmUnVubmluZygpXG4gICAgfSlcbiAgICB0aGlzLmluZmxpZ2h0UG9vbGVkSm9icy5hZGQoaW5mbGlnaHQpXG4gICAgcmV0dXJuIGluZmxpZ2h0XG4gIH1cblxuICAvKipcbiAgICogU2VyaWFsaXplcyByZXBlYXRlZCBsZWFzZXMgZm9yIG9uZSBkdXJhYmxlIHJvdyB3aGlsZSBwcmVzZXJ2aW5nIHBvb2xlZFxuICAgKiBjb25jdXJyZW5jeSBhY3Jvc3MgZGlmZmVyZW50IGpvYiBpZHMuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi90eXBlcy5qc1wiKS5CYWNrZ3JvdW5kSm9iUGF5bG9hZCAmIHtpZDogc3RyaW5nfX0gcGF5bG9hZCAtIFBvb2xlZCBqb2IgcGF5bG9hZC5cbiAgICogQHJldHVybnMge3ZvaWR9XG4gICAqL1xuICBfcXVldWVQb29sZWRKb2IocGF5bG9hZCkge1xuICAgIGNvbnN0IHF1ZXVlID0gdGhpcy5wb29sZWRKb2JRdWV1ZXMuZ2V0KHBheWxvYWQuaWQpXG4gICAgaWYgKHF1ZXVlKSB7XG4gICAgICBxdWV1ZS5wdXNoKHBheWxvYWQpXG4gICAgICByZXR1cm5cbiAgICB9XG5cbiAgICB0aGlzLnBvb2xlZEpvYlF1ZXVlcy5zZXQocGF5bG9hZC5pZCwgW3BheWxvYWRdKVxuICAgIGNvbnN0IHRyYWNrZXIgPSB0aGlzLl90cmFja1Bvb2xlZEpvYih0aGlzLl9ydW5Qb29sZWRKb2JRdWV1ZShwYXlsb2FkLmlkKSlcbiAgICB0aGlzLnBvb2xlZEpvYlF1ZXVlVHJhY2tlcnMuc2V0KHBheWxvYWQuaWQsIHRyYWNrZXIpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBhZG1pdHRlZCBsZWFzZXMgZm9yIG9uZSBkdXJhYmxlIGpvYiBpZCBpbiBhcnJpdmFsIG9yZGVyLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gam9iSWQgLSBEdXJhYmxlIGpvYiBpZC5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgYWZ0ZXIgdGhlIHBlci1pZCBxdWV1ZSBkcmFpbnMuXG4gICAqL1xuICBhc3luYyBfcnVuUG9vbGVkSm9iUXVldWUoam9iSWQpIHtcbiAgICBjb25zdCBxdWV1ZSA9IHRoaXMucG9vbGVkSm9iUXVldWVzLmdldChqb2JJZClcbiAgICBpZiAoIXF1ZXVlKSB0aHJvdyBuZXcgRXJyb3IoYFBvb2xlZCBqb2IgcXVldWUgbWlzc2luZyBmb3Igam9iOiAke2pvYklkfWApXG5cbiAgICB0cnkge1xuICAgICAgd2hpbGUgKHF1ZXVlLmxlbmd0aCA+IDApIHtcbiAgICAgICAgY29uc3QgcGF5bG9hZCA9IHF1ZXVlLnNoaWZ0KClcbiAgICAgICAgaWYgKCFwYXlsb2FkKSB0aHJvdyBuZXcgRXJyb3IoYFBvb2xlZCBqb2IgcXVldWUgY29udGFpbmVkIGFuIGVtcHR5IHBheWxvYWQgZm9yIGpvYjogJHtqb2JJZH1gKVxuICAgICAgICBhd2FpdCB0aGlzLl9ydW5Qb29sZWRKb2IocGF5bG9hZClcbiAgICAgIH1cbiAgICB9IGZpbmFsbHkge1xuICAgICAgY29uc3QgdHJhY2tlciA9IHRoaXMucG9vbGVkSm9iUXVldWVUcmFja2Vycy5nZXQoam9iSWQpXG4gICAgICBpZiAodHJhY2tlcikge1xuICAgICAgICB0aGlzLmluZmxpZ2h0UG9vbGVkSm9icy5kZWxldGUodHJhY2tlcilcbiAgICAgICAgdGhpcy5wb29sZWRKb2JRdWV1ZVRyYWNrZXJzLmRlbGV0ZShqb2JJZClcbiAgICAgIH1cbiAgICAgIHRoaXMucG9vbGVkSm9iUXVldWVzLmRlbGV0ZShqb2JJZClcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogSGFyZCBjYXAgb24gdG90YWwgbGl2ZSBwb29sZWQgY2hpbGRyZW4gKHdvcmtpbmcgKyBkcmFpbmluZyk6IGNoaWxkcmVuIHRoZVxuICAgKiBwb29sIG1heSBzdGlsbCBzcGF3bi4gQ291bnRpbmcgdGhlIHdob2xlIGxpdmUgc2V0IOKAlCBkcmFpbmluZyBjaGlsZHJlblxuICAgKiBpbmNsdWRlZCDigJQgaXMgd2hhdCBib3VuZHMgcG9vbCBtZW1vcnk6IGEgZHJhaW5pbmcgY2hpbGQgc3RpbGwgaG9sZHMgaXRzXG4gICAqIFJTUyB1bnRpbCBpdHMgbGFzdCBpbi1mbGlnaHQgam9iIGZpbmlzaGVzLCBzbyBpdCBtdXN0IG9jY3VweSBhIGNhcCBzbG90LlxuICAgKiBAcmV0dXJucyB7bnVtYmVyfSAtIE51bWJlciBvZiBjaGlsZHJlbiB0aGUgcG9vbCBtYXkgc3RpbGwgc3Bhd24uXG4gICAqL1xuICBfc3Bhd25hYmxlUG9vbGVkQ2hpbGRyZW4oKSB7XG4gICAgcmV0dXJuIE1hdGgubWF4KDAsIHRoaXMucG9vbGVkUnVubmVyQ291bnQgLSB0aGlzLnBvb2xlZENoaWxkcmVuLnNpemUpXG4gIH1cblxuICAvKipcbiAgICogUmVzb2x2ZXMgb25jZSBhIG5vbi1yZXRpcmluZyBwb29sZWQgY2hpbGQgaGFzIGEgZnJlZSBjb25jdXJyZW5jeSBzbG90IG9yIHRoZVxuICAgKiBwb29sIG1heSBzcGF3biBhIG5ldyBvbmUuIFBvb2xlZCBqb2JzIGFkbWl0dGVkIHdoaWxlIHRoZSBwb29sIGlzIGF0IGl0c1xuICAgKiBoYXJkIGNhcCB3YWl0IGhlcmUgaW5zdGVhZCBvZiBzcGF3bmluZyBhbiBvdmVyLWNhcGFjaXR5IGNoaWxkOyB0aGUgd2FrZVxuICAgKiBwb2ludHMgYXJlIHRoZSBvbmx5IGNhcGFjaXR5LWZyZWVpbmcgdHJhbnNpdGlvbnMgKGEgam9iIG91dGNvbWUgYW5kIGEgY2hpbGRcbiAgICogZXhpdCksIHNvIG5vIHBvbGxpbmcgaXMgbmVlZGVkLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyB3aGVuIGEgc2xvdCBpcyBhdmFpbGFibGUuXG4gICAqL1xuICBfd2FpdFBvb2xlZFNsb3QoKSB7XG4gICAgdGhpcy5fc3RhcnRQb29sZWRTbG90V2FpdFBvbGwoKVxuXG4gICAgcmV0dXJuIG5ldyBQcm9taXNlKChyZXNvbHZlKSA9PiB7XG4gICAgICBjb25zdCB3YWl0ZXIgPSAoKSA9PiB7XG4gICAgICAgIHRoaXMuX3Bvb2xlZFNsb3RXYWl0ZXJzLmRlbGV0ZSh3YWl0ZXIpXG4gICAgICAgIHRoaXMuX3N0b3BQb29sZWRTbG90V2FpdFBvbGxJZklkbGUoKVxuICAgICAgICByZXNvbHZlKClcbiAgICAgIH1cblxuICAgICAgdGhpcy5fcG9vbGVkU2xvdFdhaXRlcnMuYWRkKHdhaXRlcilcbiAgICB9KVxuICB9XG5cbiAgLyoqXG4gICAqIFJlc29sdmVzIGV2ZXJ5IHJlZ2lzdGVyZWQgd2FpdGVyOyB3YWl0ZXJzIHJlLWNoZWNrIHRoZSBzbG90IGNvbmRpdGlvblxuICAgKiB0aGVtc2VsdmVzIGFuZCBvbmx5IHByb2NlZWQgd2hlbiBpdCBob2xkcy5cbiAgICogQHJldHVybnMge3ZvaWR9XG4gICAqL1xuICBfd2FrZVBvb2xlZFNsb3RXYWl0ZXJzKCkge1xuICAgIGlmICh0aGlzLl9wb29sZWRTbG90V2FpdGVycy5zaXplID09PSAwKSByZXR1cm5cblxuICAgIGZvciAoY29uc3QgcmVzb2x2ZSBvZiBbLi4udGhpcy5fcG9vbGVkU2xvdFdhaXRlcnNdKSByZXNvbHZlKClcbiAgfVxuXG4gIC8qKlxuICAgKiBGcmVlIHBvb2xlZCBzbG90cyBhY3Jvc3MgdGhlIHBvb2w6IG9wZW4gc2xvdHMgaW4gbm9uLXJldGlyaW5nIGNoaWxkcmVuIHBsdXNcbiAgICogdGhlIHNsb3RzIHdlIGNvdWxkIGFkZCBieSBzcGF3bmluZyBtb3JlIGNoaWxkcmVuIHVwIHRvIHRoZSBoYXJkIGNhcCBvbiB0b3RhbFxuICAgKiBsaXZlIGNoaWxkcmVuLiBSZXRpcmluZyBjaGlsZHJlbiAoZHJhaW5pbmcgYmVmb3JlIHJlcGxhY2VtZW50KSBuZXZlclxuICAgKiBjb250cmlidXRlIGNhcGFjaXR5LCBhbmQgdGhleSBjb3VudCBhZ2FpbnN0IHRoZSBjYXA6IHdoaWxlIG9uZSBpcyBzdGlsbFxuICAgKiBkcmFpbmluZywgbm8gcmVwbGFjZW1lbnQgaXMgYWR2ZXJ0aXNlZCAob3Igc3Bhd25lZCkg4oCUIHRoZSBwb29sIGFkdmVydGlzZXNcbiAgICogZXhhY3RseSB3aGF0IGl0IGNhbiBzZXJ2ZSBpbnN0ZWFkIG9mIHBoYW50b20gY2FwYWNpdHkuXG4gICAqIEByZXR1cm5zIHtudW1iZXJ9IC0gTnVtYmVyIG9mIHBvb2xlZCBqb2JzIHRoZSB3b3JrZXIgY2FuIGFjY2VwdCByaWdodCBub3cuXG4gICAqL1xuICBfYXZhaWxhYmxlUG9vbGVkU2xvdHMoKSB7XG4gICAgbGV0IG9wZW5JbkV4aXN0aW5nID0gMFxuICAgIGxldCBxdWV1ZWRSZXNlcnZhdGlvbnMgPSAwXG5cbiAgICBmb3IgKGNvbnN0IGNoaWxkIG9mIHRoaXMucG9vbGVkQ2hpbGRyZW4pIHtcbiAgICAgIGNvbnN0IHN0YXRlID0gdGhpcy5wb29sZWRDaGlsZFN0YXRlcy5nZXQoY2hpbGQpXG4gICAgICBpZiAoIXN0YXRlIHx8IHN0YXRlLnJldGlyaW5nKSBjb250aW51ZVxuICAgICAgb3BlbkluRXhpc3RpbmcgKz0gdGhpcy5wb29sZWRSdW5uZXJDb25jdXJyZW5jeSAtIHN0YXRlLmluZmxpZ2h0LnNpemVcbiAgICB9XG5cbiAgICBmb3IgKGNvbnN0IHF1ZXVlIG9mIHRoaXMucG9vbGVkSm9iUXVldWVzLnZhbHVlcygpKSBxdWV1ZWRSZXNlcnZhdGlvbnMgKz0gcXVldWUubGVuZ3RoXG5cbiAgICBjb25zdCBzcGF3bmFibGVDaGlsZHJlbiA9IE1hdGgubWF4KDAsIHRoaXMucG9vbGVkUnVubmVyQ291bnQgLSB0aGlzLnBvb2xlZENoaWxkcmVuLnNpemUpXG5cbiAgICByZXR1cm4gTWF0aC5tYXgoMCwgb3BlbkluRXhpc3RpbmcgKyBzcGF3bmFibGVDaGlsZHJlbiAqIHRoaXMucG9vbGVkUnVubmVyQ29uY3VycmVuY3kgLSBxdWV1ZWRSZXNlcnZhdGlvbnMpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBhIHBheWxvYWQgb24gYSBwb29sZWQgY2hpbGQgd2l0aCBhIGZyZWUgY29uY3VycmVuY3kgc2xvdCwgc3Bhd25pbmcgYVxuICAgKiBuZXcgY2hpbGQgd2hlbiBldmVyeSBub24tcmV0aXJpbmcgY2hpbGQgaXMgZnVsbCBhbmQgdGhlIHBvb2wgaXMgYmVsb3dcbiAgICogYHBvb2xlZFJ1bm5lckNvdW50YC4gRWFjaCBjaGlsZCBydW5zIHVwIHRvIGBwb29sZWRSdW5uZXJDb25jdXJyZW5jeWAgam9icyBhdFxuICAgKiBvbmNlIG9uIGl0cyBvd24gZXZlbnQgbG9vcC5cbiAgICpcbiAgICogV2hlbiB0aGUgcG9vbCBpcyBhbHJlYWR5IGF0IGl0cyBoYXJkIGNhcCAodG90YWwgbGl2ZSBjaGlsZHJlbiwgZHJhaW5pbmdcbiAgICogaW5jbHVkZWQpLCB0aGUgam9iIHdhaXRzIGZvciBhIHNsb3QgaW5zdGVhZCBvZiBzcGF3bmluZzogdGhhdCBpcyB3aGF0IGtlZXBzXG4gICAqIHRoZSBsaXZlLWNoaWxkIGNvdW50IOKAlCBhbmQgdGhlcmVmb3JlIHRoZSBwb29sJ3MgdG90YWwgUlNTIOKAlCBib3VuZGVkLiBUaGVcbiAgICogd2FpdCByZXNvbHZlcyBvbiB0aGUgb25seSB0d28gY2FwYWNpdHktZnJlZWluZyB0cmFuc2l0aW9ucyAoYSBqb2Igb3V0Y29tZSxcbiAgICogYSBjaGlsZCBleGl0KTsgYSBzYWZldHkgcG9sbCBjb3ZlcnMgYW55dGhpbmcgbWlzc2VkLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vdHlwZXMuanNcIikuQmFja2dyb3VuZEpvYlBheWxvYWQgJiB7aWQ6IHN0cmluZ319IHBheWxvYWQgLSBKb2IgcGF5bG9hZC5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgYWZ0ZXIgdGhlIGR1cmFibGUgcmVwb3J0LlxuICAgKi9cbiAgYXN5bmMgX3J1blBvb2xlZEpvYihwYXlsb2FkKSB7XG4gICAgLy8gQXQgdGhlIGhhcmQgY2FwIChubyBmcmVlIHNsb3QsIG5vIHNwYXduYWJsZSBjaGlsZCkgdGhlIGpvYiB3YWl0cyBmb3IgYVxuICAgIC8vIHNsb3QgaW5zdGVhZCBvZiBzcGF3bmluZyBhbiBvdmVyLWNhcGFjaXR5IGNoaWxkIOKAlCB0aGF0IGlzIHdoYXQgYm91bmRzXG4gICAgLy8gdGhlIGxpdmUtY2hpbGQgY291bnQgYW5kIHRoZSBwb29sJ3MgdG90YWwgUlNTLlxuICAgIGxldCBjaGlsZCA9IHRoaXMuX3NlbGVjdFBvb2xlZENoaWxkKClcbiAgICB3aGlsZSAoIWNoaWxkKSB7XG4gICAgICBpZiAodGhpcy5fc3Bhd25hYmxlUG9vbGVkQ2hpbGRyZW4oKSA9PT0gMCkge1xuICAgICAgICAvLyBTaHV0ZG93bjogbWFpbiBubyBsb25nZXIgZGlzcGF0Y2hlcyBhbmQgbm8gc2xvdCB3aWxsIGV2ZXIgZnJlZSDigJRcbiAgICAgICAgLy8gc3RvcCB3YWl0aW5nIHNvIHRoZSB0cmFja2VkIGpvYiBjYW4gc2V0dGxlIGFuZCB0aGUgZHJhaW4gY29tcGxldGVzLlxuICAgICAgICBpZiAodGhpcy5zaG91bGRTdG9wKSByZXR1cm5cbiAgICAgICAgYXdhaXQgdGhpcy5fd2FpdFBvb2xlZFNsb3QoKVxuICAgICAgICBjaGlsZCA9IHRoaXMuX3NlbGVjdFBvb2xlZENoaWxkKClcbiAgICAgICAgY29udGludWVcbiAgICAgIH1cbiAgICAgIGNoaWxkID0gdGhpcy5fc2VsZWN0UG9vbGVkQ2hpbGQoKSB8fCB0aGlzLl9jcmVhdGVQb29sZWRDaGlsZCgpXG4gICAgfVxuXG4gICAgY29uc3Qgc3RhdGUgPSB0aGlzLnBvb2xlZENoaWxkU3RhdGVzLmdldChjaGlsZClcbiAgICBpZiAoIXN0YXRlKSB0aHJvdyBuZXcgRXJyb3IoXCJQb29sZWQgcnVubmVyIHN0YXRlIG1pc3NpbmdcIilcblxuICAgIC8vIFN0YW1wIHRoZSByb3VuZC1yb2JpbiBjdXJzb3Igc28gdGhlIG5leHQgZGlzcGF0Y2ggcHJlZmVycyBhIGRpZmZlcmVudCBjaGlsZC5cbiAgICBzdGF0ZS5sYXN0RGlzcGF0Y2hTZXEgPSArK3RoaXMuX3Bvb2xlZERpc3BhdGNoU2VxXG5cbiAgICAvKipcbiAgICAgKiBSZXNvbHZlcyB0aGUgcG9vbGVkIGpvYiBwcm9taXNlLlxuICAgICAqIEB0eXBlIHsodmFsdWU6IHZvaWQpID0+IHZvaWR9XG4gICAgICovXG4gICAgbGV0IHJlc29sdmVQb29sZWRKb2IgPSAoKSA9PiB7fVxuICAgIGNvbnN0IHBvb2xlZEpvYiA9IG5ldyBQcm9taXNlKChyZXNvbHZlKSA9PiB7IHJlc29sdmVQb29sZWRKb2IgPSByZXNvbHZlIH0pXG4gICAgY29uc3QgdGltZW91dFRpbWVyID0gdGhpcy5fYXJtUG9vbGVkSm9iVGltZW91dCh7Y2hpbGQsIHBheWxvYWR9KVxuXG4gICAgc3RhdGUuaW5mbGlnaHQuc2V0KHBheWxvYWQuaWQsIHtwYXlsb2FkLCByZXNvbHZlOiByZXNvbHZlUG9vbGVkSm9iLCBwb29sZWRKb2IsIHRpbWVvdXRUaW1lcn0pXG4gICAgdHJ5IHtcbiAgICAgIGNoaWxkLnNlbmQoe3R5cGU6IFwiam9iXCIsIHBheWxvYWQsIHNoYXJlZFRyYW5zYWN0aW9uQnJva2VyOiB0aGlzLl9wb29sZWRKb2JTaGFyZWRUcmFuc2FjdGlvbkJyb2tlckNvbmZpZygpfSlcbiAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgdm9pZCB0aGlzLl9oYW5kbGVQb29sZWRDaGlsZEZhaWx1cmUoe2NoaWxkLCBlcnJvciwgb3JpZ2luOiBcImlwYy1zZW5kXCJ9KVxuICAgIH1cblxuICAgIHJldHVybiBwb29sZWRKb2JcbiAgfVxuXG4gIC8qKlxuICAgKiBDYXB0dXJlcyB0aGUgY3VycmVudCB0ZXN0IGF0dGVtcHQncyBicm9rZXIgbW9kZSBhdCBkaXNwYXRjaCB0aW1lLiBBIHdhcm1cbiAgICogcG9vbGVkIGNoaWxkIG11c3QgbmV2ZXIgcmVseSBvbiBpdHMgaW1tdXRhYmxlIGZvcmstdGltZSBlbnZpcm9ubWVudC5cbiAgICogQHJldHVybnMge2ltcG9ydChcIi4uL3Rlc3Rpbmcvc2hhcmVkLXRyYW5zYWN0aW9uLXByb3h5LWRyaXZlci5qc1wiKS5TaGFyZWRUcmFuc2FjdGlvbkJyb2tlckpvYkNvbmZpZ30gLSBQZXItam9iIGJyb2tlciBjb25maWd1cmF0aW9uLlxuICAgKi9cbiAgX3Bvb2xlZEpvYlNoYXJlZFRyYW5zYWN0aW9uQnJva2VyQ29uZmlnKCkge1xuICAgIGNvbnN0IHNlcmlhbGl6ZWQgPSBwcm9jZXNzLmVudi5WRUxPQ0lPVVNfVEVTVF9TSEFSRURfVFJBTlNBQ1RJT05fQlJPS0VSXG4gICAgaWYgKCFzZXJpYWxpemVkKSByZXR1cm4ge2V4cGVjdGVkOiBmYWxzZX1cblxuICAgIGNvbnN0IGNvbmZpZyA9IEpTT04ucGFyc2UoQnVmZmVyLmZyb20oc2VyaWFsaXplZCwgXCJiYXNlNjR1cmxcIikudG9TdHJpbmcoXCJ1dGY4XCIpKVxuICAgIHJldHVybiB7Li4uY29uZmlnLCBleHBlY3RlZDogdHJ1ZX1cbiAgfVxuXG4gIC8qKlxuICAgKiBTZWxlY3RzIGEgcG9vbGVkIGNoaWxkIHRvIHJ1biB0aGUgbmV4dCBqb2IsIG9yIHVuZGVmaW5lZCB3aGVuIGV2ZXJ5IG5vbi1yZXRpcmluZ1xuICAgKiBjaGlsZCBpcyBhbHJlYWR5IGZ1bGwgKHRoZSBjYWxsZXIgdGhlbiBsYXppbHkgc3Bhd25zIG9uZSkuIEFtb25nIGNoaWxkcmVuIHdpdGggYVxuICAgKiBmcmVlIGNvbmN1cnJlbmN5IHNsb3QsIHBpY2tzIHRoZSBvbmUgZGlzcGF0Y2hlZCBsZWFzdCByZWNlbnRseSDigJQgYSByb3VuZC1yb2JpbiB0aGF0XG4gICAqIHNwcmVhZHMgam9icyAobm90YWJseSBtdWx0aS1taW51dGUgUnVuQnVpbGRKb2JzLCBlYWNoIHBpbm5pbmcgYSB0ZW5hbnQgY29ubmVjdGlvblxuICAgKiBmb3IgaXRzIHdob2xlIHJ1bikgZXZlbmx5IGFjcm9zcyBjaGlsZHJlbiBpbnN0ZWFkIG9mIGZpcnN0LWZpdCBwYWNraW5nIHRoZSBlYXJsaWVzdFxuICAgKiBvbmUgdW50aWwgaXQgaXMgZnVsbC4gQSBmcmVzaGx5IHNwYXduZWQgb3IgcmVwbGFjZW1lbnQgY2hpbGQgdGhlcmVmb3JlIHRha2VzIGl0c1xuICAgKiBmYWlyIHNoYXJlIG9uZSBqb2IgYXQgYSB0aW1lIGFzIGl0cyB0dXJuIGNvbWVzIHVwLCByYXRoZXIgdGhhbiBhYnNvcmJpbmcgYSBidXJzdCB0b1xuICAgKiBcImNhdGNoIHVwXCIgdG8gdGhlIG90aGVycy5cbiAgICogQHJldHVybnMge2ltcG9ydChcIm5vZGU6Y2hpbGRfcHJvY2Vzc1wiKS5DaGlsZFByb2Nlc3MgfCB1bmRlZmluZWR9IC0gVGhlIGNob3NlbiBjaGlsZCwgb3IgdW5kZWZpbmVkIHdoZW4gYWxsIG5vbi1yZXRpcmluZyBjaGlsZHJlbiBhcmUgZnVsbC5cbiAgICovXG4gIF9zZWxlY3RQb29sZWRDaGlsZCgpIHtcbiAgICAvKiogQHR5cGUge2ltcG9ydChcIm5vZGU6Y2hpbGRfcHJvY2Vzc1wiKS5DaGlsZFByb2Nlc3MgfCB1bmRlZmluZWR9ICovXG4gICAgbGV0IHNlbGVjdGVkXG4gICAgbGV0IHNlbGVjdGVkU2VxID0gSW5maW5pdHlcblxuICAgIGZvciAoY29uc3QgY2hpbGQgb2YgdGhpcy5wb29sZWRDaGlsZHJlbikge1xuICAgICAgY29uc3Qgc3RhdGUgPSB0aGlzLnBvb2xlZENoaWxkU3RhdGVzLmdldChjaGlsZClcblxuICAgICAgaWYgKCFzdGF0ZSB8fCBzdGF0ZS5yZXRpcmluZyB8fCBzdGF0ZS5pbmZsaWdodC5zaXplID49IHRoaXMucG9vbGVkUnVubmVyQ29uY3VycmVuY3kpIGNvbnRpbnVlXG5cbiAgICAgIGlmIChzdGF0ZS5sYXN0RGlzcGF0Y2hTZXEgPCBzZWxlY3RlZFNlcSkge1xuICAgICAgICBzZWxlY3RlZCA9IGNoaWxkXG4gICAgICAgIHNlbGVjdGVkU2VxID0gc3RhdGUubGFzdERpc3BhdGNoU2VxXG4gICAgICB9XG4gICAgfVxuXG4gICAgcmV0dXJuIHNlbGVjdGVkXG4gIH1cblxuICAvKipcbiAgICogQXJtcyBhIHBlci1qb2Igd2FsbC1jbG9jayBiYWNrc3RvcCBmb3IgYSBwb29sZWQgam9iLiBBIHBvb2xlZCBjaGlsZCBob3N0cyBtYW55XG4gICAqIGNvbmN1cnJlbnQgam9icywgc28gYSBzaW5nbGUgZ2VudWluZWx5LWh1bmcgam9iIHdvdWxkIG90aGVyd2lzZSBwaW4gaXRzXG4gICAqIHJ1bm5lcidzIGNvbmN1cnJlbmN5IHNsb3QgZm9yZXZlciDigJQgdGhlIGxpZmV0aW1lIHJlY3ljbGUgb25seSByZXRpcmVzIGEgY2hpbGRcbiAgICogb25jZSBpdHMgaW4tZmxpZ2h0IHNldCBkcmFpbnMsIHdoaWNoIGEgaHVuZyBqb2IgbmV2ZXIgZG9lcy4gT24gb3ZlcnJ1biB0aGVcbiAgICogd2hvbGUgY2hpbGQgaXMgdGVybWluYXRlZCBzbyB0aGUgaHVuZyBqb2IgKGFuZCBpdHMgc2libGluZ3MpIHJlcXVldWUuIFJldHVybnNcbiAgICogdGhlIHRpbWVyLCBvciBudWxsIHdoZW4gbm8gdGltZW91dCBpcyBjb25maWd1cmVkLlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIE9wdGlvbnMuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwibm9kZTpjaGlsZF9wcm9jZXNzXCIpLkNoaWxkUHJvY2Vzc30gYXJncy5jaGlsZCAtIFBvb2xlZCBjaGlsZC5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL3R5cGVzLmpzXCIpLkJhY2tncm91bmRKb2JQYXlsb2FkICYge2lkOiBzdHJpbmd9fSBhcmdzLnBheWxvYWQgLSBKb2IgcGF5bG9hZCB3aG9zZSBvdmVycnVuIGlzIGd1YXJkZWQuXG4gICAqIEByZXR1cm5zIHtSZXR1cm5UeXBlPHR5cGVvZiBzZXRUaW1lb3V0PiB8IG51bGx9IC0gVGhlIGFybWVkIHRpbWVyLCBvciBudWxsLlxuICAgKi9cbiAgX2FybVBvb2xlZEpvYlRpbWVvdXQoe2NoaWxkLCBwYXlsb2FkfSkge1xuICAgIGNvbnN0IHRpbWVvdXRNcyA9IHRoaXMuX3Jlc29sdmVKb2JUaW1lb3V0TXMocGF5bG9hZC5vcHRpb25zKVxuXG4gICAgaWYgKCEodHlwZW9mIHRpbWVvdXRNcyA9PT0gXCJudW1iZXJcIiAmJiB0aW1lb3V0TXMgPiAwKSkgcmV0dXJuIG51bGxcblxuICAgIHJldHVybiBzZXRUaW1lb3V0KCgpID0+IHRoaXMuX29uUG9vbGVkSm9iVGltZW91dCh7Y2hpbGQsIGpvYklkOiBwYXlsb2FkLmlkfSksIHRpbWVvdXRNcylcbiAgfVxuXG4gIC8qKlxuICAgKiBGaXJlZCB3aGVuIGEgcG9vbGVkIGpvYiBvdmVycnVucyBpdHMgdGltZW91dC4gVGVybWluYXRlcyB0aGUgY2hpbGQgcnVubmluZyBpdFxuICAgKiAoU0lHVEVSTSwgdGhlbiBTSUdLSUxMIGFmdGVyIHRoZSBncmFjZSkg4oCUIGEgaHVuZyBKUyBqb2IgY2Fubm90IGJlIGNhbmNlbGxlZFxuICAgKiBhbnkgb3RoZXIgd2F5LiBUaGUgbm9uLWNsZWFuIGV4aXQgZmxvd3MgdGhyb3VnaCBgX2hhbmRsZVBvb2xlZENoaWxkRmFpbHVyZWAsXG4gICAqIHdoaWNoIHJlcG9ydHMgZXZlcnkgaW4tZmxpZ2h0IGpvYiBvbiB0aGUgY2hpbGQgZmFpbGVkIChzbyB0aGV5IHJlcXVldWUpIGFuZFxuICAgKiBkcm9wcyBpdCBmcm9tIHRyYWNraW5nOyB0aGUgZmFpbHVyZSBwYXRoIGltbWVkaWF0ZWx5IHJlLWFkdmVydGlzZXMgdGhlXG4gICAqIHJlc3VsdGluZyBjYXBhY2l0eSBvbmNlIHRoZSBydW5uZXIgaGFzIGNvbXBsZXRlZCBzdGFydHVwLlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIE9wdGlvbnMuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwibm9kZTpjaGlsZF9wcm9jZXNzXCIpLkNoaWxkUHJvY2Vzc30gYXJncy5jaGlsZCAtIFBvb2xlZCBjaGlsZC5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGFyZ3Muam9iSWQgLSBKb2IgaWQgdGhhdCBvdmVycmFuLlxuICAgKiBAcmV0dXJucyB7dm9pZH1cbiAgICovXG4gIF9vblBvb2xlZEpvYlRpbWVvdXQoe2NoaWxkLCBqb2JJZH0pIHtcbiAgICBjb25zdCBzdGF0ZSA9IHRoaXMucG9vbGVkQ2hpbGRTdGF0ZXMuZ2V0KGNoaWxkKVxuXG4gICAgLy8gQWxyZWFkeSBzZXR0bGluZy9nb25lLCBvciB0aGUgam9iIGZpbmlzaGVkIGluIHRoZSByYWNlIHdpdGggdGhpcyB0aW1lci5cbiAgICBpZiAoIXN0YXRlIHx8IHN0YXRlLnNldHRsaW5nIHx8IHN0YXRlLnNodXRkb3duUmVhc29uIHx8ICFzdGF0ZS5pbmZsaWdodC5oYXMoam9iSWQpKSByZXR1cm5cblxuICAgIHN0YXRlLnRpbWVvdXRKb2JJZCA9IGpvYklkXG4gICAgdGhpcy5fcmVxdWVzdFBvb2xlZENoaWxkU2h1dGRvd24oe2NoaWxkLCByZWFzb246IFwiam9iX3RpbWVvdXRcIiwgc2lnbmFsOiBcIlNJR1RFUk1cIn0pXG5cbiAgICBzdGF0ZS50aW1lb3V0U2lna2lsbFRpbWVyID0gc2V0VGltZW91dCgoKSA9PiB7XG4gICAgICB0cnkge1xuICAgICAgICBjaGlsZC5raWxsKFwiU0lHS0lMTFwiKVxuICAgICAgfSBjYXRjaCB7XG4gICAgICAgIC8vIENoaWxkIGFscmVhZHkgZXhpdGVkOyBub3RoaW5nIHRvIGRvLlxuICAgICAgfVxuICAgIH0sIHRoaXMuZm9ya2VkQ2hpbGRTaWdraWxsR3JhY2VNcylcbiAgfVxuXG4gIC8qKlxuICAgKiBDcmVhdGVzIGEgcmV1c2FibGUgcG9vbGVkIGNoaWxkLCBlbmZvcmNpbmcgdGhlIGhhcmQgY2FwIG9uIHRvdGFsIGxpdmVcbiAgICogY2hpbGRyZW4gKHdvcmtpbmcgKyBkcmFpbmluZykuIFJldHVybnMgdW5kZWZpbmVkIHdoZW4gdGhlIGNhcCBpcyBhbHJlYWR5XG4gICAqIG1ldCDigJQgdGhlIG9ubHkgd2F5IGEgbmV3IGNoaWxkIG1heSBleGlzdCBpcyBhIHNsb3QgYmVpbmcgb3Blbiwgc28gdGhlXG4gICAqIGNhbGxlciByZS1jaGVja3MgYW5kIHdhaXRzIGFnYWluLlxuICAgKiBAcmV0dXJucyB7aW1wb3J0KFwibm9kZTpjaGlsZF9wcm9jZXNzXCIpLkNoaWxkUHJvY2VzcyB8IHVuZGVmaW5lZH0gLSBUaGUgbmV3IGNoaWxkLCBvciB1bmRlZmluZWQgd2hlbiB0aGUgcG9vbCBpcyBhdCBpdHMgY2FwLlxuICAgKi9cbiAgX2NyZWF0ZVBvb2xlZENoaWxkKCkge1xuICAgIGNvbnN0IGNvbmZpZ3VyYXRpb24gPSB0aGlzLmNvbmZpZ3VyYXRpb25cbiAgICBpZiAoIWNvbmZpZ3VyYXRpb24pIHRocm93IG5ldyBFcnJvcihcIkJhY2tncm91bmQgam9icyB3b3JrZXIgY29uZmlndXJhdGlvbiBub3QgaW5pdGlhbGl6ZWRcIilcbiAgICBpZiAodGhpcy5wb29sZWRDaGlsZHJlbi5zaXplID49IHRoaXMucG9vbGVkUnVubmVyQ291bnQpIHJldHVybiB1bmRlZmluZWRcbiAgICBjb25zdCBjaGlsZCA9IGZvcmsoUE9PTEVEX1JVTk5FUl9FTlRSWV9QQVRILCBbXSwge1xuICAgICAgY3dkOiBjb25maWd1cmF0aW9uLmdldERpcmVjdG9yeSgpLCBleGVjQXJndjogW10sIHN0ZGlvOiBbXCJpZ25vcmVcIiwgXCJpZ25vcmVcIiwgXCJpZ25vcmVcIiwgXCJpcGNcIl0sXG4gICAgICBlbnY6IE9iamVjdC5hc3NpZ24oe30sIHByb2Nlc3MuZW52LCB0aGlzLl9jaGlsZEJhY2tncm91bmRKb2JzRW52aXJvbm1lbnQoKSlcbiAgICB9KVxuICAgIHRoaXMucG9vbGVkQ2hpbGRyZW4uYWRkKGNoaWxkKVxuICAgIHRoaXMuaW5mbGlnaHRQcm9jZXNzQ2hpbGRyZW4uYWRkKGNoaWxkKVxuICAgIHRoaXMucG9vbGVkQ2hpbGRTdGF0ZXMuc2V0KGNoaWxkLCB7Y3JlYXRlZEF0TXM6IERhdGUubm93KCksIGpvYnNSdW46IDAsIGluZmxpZ2h0OiBuZXcgTWFwKCksIGxhc3REaXNwYXRjaFNlcTogMCwgcmV0aXJpbmc6IGZhbHNlLCBzdGFydGVkOiBmYWxzZX0pXG4gICAgY2hpbGQub24oXCJtZXNzYWdlXCIsIChtZXNzYWdlKSA9PiB0aGlzLl9oYW5kbGVQb29sZWRDaGlsZE1lc3NhZ2Uoe2NoaWxkLCBtZXNzYWdlfSkpXG4gICAgY2hpbGQub25jZShcImV4aXRcIiwgKGV4aXRDb2RlLCBzaWduYWwpID0+IHRoaXMuX2hhbmRsZVBvb2xlZENoaWxkRmFpbHVyZSh7XG4gICAgICBjaGlsZCxcbiAgICAgIGVycm9yOiBuZXcgRXJyb3IoYFBvb2xlZCBiYWNrZ3JvdW5kIGpvYiBydW5uZXIgZXhpdGVkOiBjb2RlPSR7ZXhpdENvZGV9IHNpZ25hbD0ke3NpZ25hbCB8fCBcIm5vbmVcIn1gKSxcbiAgICAgIGV4aXRDb2RlLFxuICAgICAgb3JpZ2luOiBcImV4aXRcIixcbiAgICAgIHNpZ25hbFxuICAgIH0pKVxuICAgIGNoaWxkLm9uY2UoXCJlcnJvclwiLCAoZXJyb3IpID0+IHRoaXMuX2hhbmRsZVBvb2xlZENoaWxkRmFpbHVyZSh7XG4gICAgICBjaGlsZCxcbiAgICAgIGVycm9yLFxuICAgICAgZXhpdENvZGU6IGNoaWxkLmV4aXRDb2RlLFxuICAgICAgb3JpZ2luOiBcInByb2Nlc3MtZXJyb3JcIixcbiAgICAgIHNpZ25hbDogY2hpbGQuc2lnbmFsQ29kZVxuICAgIH0pKVxuICAgIGNoaWxkLm9uY2UoXCJkaXNjb25uZWN0XCIsICgpID0+IHtcbiAgICAgIGNvbnN0IHN0YXRlID0gdGhpcy5wb29sZWRDaGlsZFN0YXRlcy5nZXQoY2hpbGQpXG4gICAgICBpZiAoc3RhdGUpIHN0YXRlLmlwY0Rpc2Nvbm5lY3RlZEF0TXMgPz89IERhdGUubm93KClcbiAgICB9KVxuICAgIHJldHVybiBjaGlsZFxuICB9XG5cbiAgLyoqXG4gICAqIEhhbmRsZXMgYSBwb29sZWQgY2hpbGQncyBwZXItam9iIGR1cmFibGUtcmVwb3J0IGFja25vd2xlZGdlbWVudC4gQSBjaGlsZFxuICAgKiBydW5zIGpvYnMgY29uY3VycmVudGx5IGFuZCByZXBvcnRzIG9uZSBgam9iLW91dGNvbWVgIHBlciBqb2IgaWQuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gTWVzc2FnZSBkZXRhaWxzLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIm5vZGU6Y2hpbGRfcHJvY2Vzc1wiKS5DaGlsZFByb2Nlc3N9IGFyZ3MuY2hpbGQgLSBQb29sZWQgY2hpbGQuXG4gICAqIEBwYXJhbSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59IGFyZ3MubWVzc2FnZSAtIElQQyBtZXNzYWdlLlxuICAgKiBAcmV0dXJucyB7dm9pZH1cbiAgICovXG4gIF9oYW5kbGVQb29sZWRDaGlsZE1lc3NhZ2Uoe2NoaWxkLCBtZXNzYWdlfSkge1xuICAgIGlmICghbWVzc2FnZSB8fCB0eXBlb2YgbWVzc2FnZSAhPT0gXCJvYmplY3RcIikgcmV0dXJuXG4gICAgY29uc3QgcmVjb3JkID0gLyoqIEB0eXBlIHt7dHlwZT86IFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+LCBjaGlsZEluc3RhbmNlSWQ/OiBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPiwgam9iSWQ/OiBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPiwgYWNrbm93bGVkZ2VkPzogUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4sIHJzc0J5dGVzPzogUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4sIGVycm9yPzogUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59fSAqLyAobWVzc2FnZSlcbiAgICBjb25zdCBzdGF0ZSA9IHRoaXMucG9vbGVkQ2hpbGRTdGF0ZXMuZ2V0KGNoaWxkKVxuICAgIGlmIChyZWNvcmQudHlwZSA9PT0gXCJyZWFkeVwiKSB7XG4gICAgICBpZiAoc3RhdGUpIHtcbiAgICAgICAgc3RhdGUuc3RhcnRlZCA9IHRydWVcbiAgICAgICAgaWYgKHR5cGVvZiByZWNvcmQuY2hpbGRJbnN0YW5jZUlkID09PSBcInN0cmluZ1wiKSBzdGF0ZS5jaGlsZEluc3RhbmNlSWQgPSByZWNvcmQuY2hpbGRJbnN0YW5jZUlkXG4gICAgICB9XG4gICAgICByZXR1cm5cbiAgICB9XG4gICAgaWYgKGlzQ2hpbGRTaHV0ZG93bk9ic2VydmF0aW9uTWVzc2FnZShtZXNzYWdlKSkge1xuICAgICAgaWYgKHN0YXRlKSB7XG4gICAgICAgIHN0YXRlLmNoaWxkSW5zdGFuY2VJZCA9IG1lc3NhZ2UuY2hpbGRJbnN0YW5jZUlkXG4gICAgICAgIHN0YXRlLnNodXRkb3duT2JzZXJ2YXRpb24gPSBtZXNzYWdlXG4gICAgICAgIGlmIChzdGF0ZS5zaHV0ZG93blNpZ25hbFRpbWVyKSB7XG4gICAgICAgICAgY2xlYXJUaW1lb3V0KHN0YXRlLnNodXRkb3duU2lnbmFsVGltZXIpXG4gICAgICAgICAgc3RhdGUuc2h1dGRvd25TaWduYWxUaW1lciA9IHVuZGVmaW5lZFxuICAgICAgICB9XG4gICAgICB9XG4gICAgICByZXR1cm5cbiAgICB9XG4gICAgaWYgKGlzQ2hpbGRBY2NlcHRhbmNlTWVzc2FnZShtZXNzYWdlKSkge1xuICAgICAgdGhpcy5fcmVwb3J0Q2hpbGRBY2NlcHRlZChtZXNzYWdlKVxuICAgICAgcmV0dXJuXG4gICAgfVxuICAgIGlmIChpc1Bvb2xlZENoaWxkTWVtb3J5T2JzZXJ2YXRpb25NZXNzYWdlKG1lc3NhZ2UpKSB7XG4gICAgICB0aGlzLl9oYW5kbGVQb29sZWRDaGlsZE1lbW9yeU9ic2VydmF0aW9uKHtjaGlsZCwgbWVzc2FnZX0pXG4gICAgICByZXR1cm5cbiAgICB9XG4gICAgaWYgKHJlY29yZC50eXBlICE9PSBcImpvYi1vdXRjb21lXCIgfHwgIXN0YXRlIHx8IHN0YXRlLnNldHRsaW5nIHx8IHR5cGVvZiByZWNvcmQuam9iSWQgIT09IFwic3RyaW5nXCIpIHJldHVyblxuICAgIHN0YXRlLnN0YXJ0ZWQgPSB0cnVlXG4gICAgY29uc3QgZW50cnkgPSBzdGF0ZS5pbmZsaWdodC5nZXQocmVjb3JkLmpvYklkKVxuICAgIGlmICghZW50cnkpIHJldHVyblxuXG4gICAgaWYgKGVudHJ5LnRpbWVvdXRUaW1lcikgY2xlYXJUaW1lb3V0KGVudHJ5LnRpbWVvdXRUaW1lcilcbiAgICBzdGF0ZS5pbmZsaWdodC5kZWxldGUocmVjb3JkLmpvYklkKVxuICAgIHN0YXRlLmpvYnNSdW4gKz0gMVxuICAgIGNvbnN0IHJlc29sdmUgPSBlbnRyeS5yZXNvbHZlXG5cbiAgICBpZiAocmVjb3JkLmFja25vd2xlZGdlZCA9PT0gdHJ1ZSkge1xuICAgICAgaWYgKHJlc29sdmUpIHJlc29sdmUodW5kZWZpbmVkKVxuICAgIH0gZWxzZSB7XG4gICAgICAvLyBUaGUgY2hpbGQgc3RheWVkIGFsaXZlIGJ1dCBjb3VsZCBub3QgY29uZmlybSB0aGlzIG9uZSBqb2IncyB0ZXJtaW5hbFxuICAgICAgLy8gcmVwb3J0OyByZWNsYWltIGp1c3QgdGhpcyBqb2Ig4oCUIGl0cyBjb25jdXJyZW50IHNpYmxpbmdzIGFyZSB1bmFmZmVjdGVkLlxuICAgICAgdm9pZCB0aGlzLl9yZXBvcnRKb2JSZXN1bHQoe1xuICAgICAgICBqb2JJZDogZW50cnkucGF5bG9hZC5pZCxcbiAgICAgICAgc3RhdHVzOiBcImZhaWxlZFwiLFxuICAgICAgICBlcnJvcjogbmV3IEVycm9yKHR5cGVvZiByZWNvcmQuZXJyb3IgPT09IFwic3RyaW5nXCIgPyByZWNvcmQuZXJyb3IgOiBcIlBvb2xlZCBydW5uZXIgdGVybWluYWwgcmVwb3J0IHdhcyBub3QgYWNrbm93bGVkZ2VkXCIpLFxuICAgICAgICBoYW5kb2ZmSWQ6IGVudHJ5LnBheWxvYWQuaGFuZG9mZklkLFxuICAgICAgICBoYW5kZWRPZmZBdE1zOiBlbnRyeS5wYXlsb2FkLmhhbmRlZE9mZkF0TXMsXG4gICAgICAgIHdvcmtlcklkOiBlbnRyeS5wYXlsb2FkLndvcmtlcklkIHx8IHRoaXMud29ya2VySWRcbiAgICAgIH0pLmZpbmFsbHkoKCkgPT4geyBpZiAocmVzb2x2ZSkgcmVzb2x2ZSh1bmRlZmluZWQpIH0pXG4gICAgfVxuXG4gICAgY29uc3QgcnNzQnl0ZXMgPSB0eXBlb2YgcmVjb3JkLnJzc0J5dGVzID09PSBcIm51bWJlclwiID8gcmVjb3JkLnJzc0J5dGVzIDogTnVtYmVyLlBPU0lUSVZFX0lORklOSVRZXG4gICAgY29uc3QgcnVubmVyQWdlTXMgPSBEYXRlLm5vdygpIC0gc3RhdGUuY3JlYXRlZEF0TXNcbiAgICBpZiAoIXN0YXRlLnJldGlyaW5nICYmIChzdGF0ZS5qb2JzUnVuID49IHRoaXMucG9vbGVkUnVubmVyTWF4Sm9icyB8fCByc3NCeXRlcyA+PSB0aGlzLnBvb2xlZFJ1bm5lck1heFJzc0J5dGVzIHx8IHJ1bm5lckFnZU1zID49IHRoaXMucG9vbGVkUnVubmVyTWF4TGlmZXRpbWVNcyB8fCB0aGlzLnNob3VsZFN0b3ApKSB7XG4gICAgICB0aGlzLl9iZWdpblJldGlyZVBvb2xlZENoaWxkKGNoaWxkKVxuICAgIH1cbiAgICB0aGlzLl90ZXJtaW5hdGVJZkRyYWluZWQoY2hpbGQpXG4gICAgLy8gQSBqb2Igb3V0Y29tZSBmcmVlcyBhIGNvbmN1cnJlbmN5IHNsb3QgYW5kIG1heSBkcmFpbiBhIHJldGlyaW5nIGNoaWxkIOKAlFxuICAgIC8vIHRoZSBvbmx5IHR3byB0cmFuc2l0aW9ucyB0aGF0IGZyZWUgY2FwYWNpdHkgZm9yIHdhaXRlcnMgYXQgdGhlIGhhcmQgY2FwLlxuICAgIHRoaXMuX3dha2VQb29sZWRTbG90V2FpdGVycygpXG4gIH1cblxuICAvKipcbiAgICogRm9yd2FyZHMgb25lIHBvb2xlZCBjaGlsZCdzIGFjY2VwdGFuY2Ugb2JzZXJ2YXRpb24gdG8gbWFpbiBhcyBhIGJvdW5kZWRcbiAgICogZGlhZ25vc3RpYyByZXBvcnQuIFRoZSBjaGlsZCBjYXJyaWVzIGl0cyBleGFjdCBoYW5kb2ZmIGxlYXNlLCBzbyBhIHRpbWVvdXRcbiAgICogb3Igb3V0Y29tZSB0aGF0IGFscmVhZHkgc2V0dGxlZCB0aGUgd29ya2VyJ3MgaW4tZmxpZ2h0IGVudHJ5IGNhbm5vdCBsb3NlXG4gICAqIHRoZSBmZW5jaW5nLiBBIHJlcG9ydCB0aGF0IG5ldmVyIGxhbmRzIGRlZ3JhZGVzIHBoYXNlIGRpYWdub3N0aWNzIGZvciB0aGF0XG4gICAqIGpvYiBvbmx5IOKAlCBpdCBtdXN0IG5ldmVyIGJsb2NrIG9yIGZhaWwgdGhlIGpvYiBpdHNlbGYuXG4gICAqIEBwYXJhbSB7e3R5cGU6IFwiam9iLXJlY2VpdmVkXCIgfCBcImpvYi1zdGFydGVkXCIsIGpvYklkOiBzdHJpbmcsIGhhbmRvZmZJZD86IHN0cmluZywgd29ya2VySWQ/OiBzdHJpbmcsIGhhbmRlZE9mZkF0TXM/OiBudW1iZXIsIHJlY2VpdmVkQXRNcz86IG51bWJlciwgc3RhcnRlZEF0TXM/OiBudW1iZXIsIGNoaWxkSW5zdGFuY2VJZD86IHN0cmluZywgY2hpbGRQaWQ/OiBudW1iZXJ9fSBtZXNzYWdlIC0gVmFsaWRhdGVkIGNoaWxkIGFjY2VwdGFuY2UgbWVzc2FnZS5cbiAgICogQHJldHVybnMge3ZvaWR9XG4gICAqL1xuICBfcmVwb3J0Q2hpbGRBY2NlcHRlZChtZXNzYWdlKSB7XG4gICAgaWYgKCF0aGlzLnN0YXR1c1JlcG9ydGVyKSByZXR1cm5cblxuICAgIHZvaWQgdGhpcy5zdGF0dXNSZXBvcnRlci5yZXBvcnRDaGlsZEFjY2VwdGVkV2l0aFJldHJ5KHtcbiAgICAgIGpvYklkOiBtZXNzYWdlLmpvYklkLFxuICAgICAgaGFuZG9mZklkOiBtZXNzYWdlLmhhbmRvZmZJZCxcbiAgICAgIHdvcmtlcklkOiBtZXNzYWdlLndvcmtlcklkLFxuICAgICAgaGFuZGVkT2ZmQXRNczogbWVzc2FnZS5oYW5kZWRPZmZBdE1zLFxuICAgICAgcmVjZWl2ZWRBdE1zOiBtZXNzYWdlLnJlY2VpdmVkQXRNcyxcbiAgICAgIHN0YXJ0ZWRBdE1zOiBtZXNzYWdlLnN0YXJ0ZWRBdE1zLFxuICAgICAgY2hpbGRJbnN0YW5jZUlkOiBtZXNzYWdlLmNoaWxkSW5zdGFuY2VJZCxcbiAgICAgIGNoaWxkUGlkOiBtZXNzYWdlLmNoaWxkUGlkLFxuICAgICAgbWF4RHVyYXRpb25NczogQ0hJTERfQUNDRVBUQU5DRV9SRVBPUlRfTUFYX0RVUkFUSU9OX01TXG4gICAgfSkuY2F0Y2goKGVycm9yKSA9PiB7XG4gICAgICBjb25zb2xlLmVycm9yKFwiQmFja2dyb3VuZCBqb2IgY2hpbGQtYWNjZXB0YW5jZSByZXBvcnRpbmcgZmFpbGVkOlwiLCBlcnJvcilcbiAgICB9KVxuICB9XG5cbiAgLyoqXG4gICAqIEhhbmRsZXMgYSBwb29sZWQgY2hpbGQncyBib3VuZGVkIG1lbW9yeSBvYnNlcnZhdGlvbi4gVGhlIHBvb2xlZCBjaGlsZCdzXG4gICAqIHN0ZGlvIGlzIGlnbm9yZWQgYnkgdGhlIHdvcmtlciBmb3JrLCBzbyB0aGlzIElQQyBvYnNlcnZhdGlvbiBpcyBob3cgYVxuICAgKiBtZW1vcnkgcHJvYmxlbSBpbiBhIHJ1bm5pbmcgY2hpbGQgbmFtZXMgaXRzZWxmLiBUaGUgd29ya2VyIChhKSByZWNvcmRzIHRoZVxuICAgKiBsYXRlc3Qgb2JzZXJ2YXRpb24gb24gdGhlIGNoaWxkJ3Mgc3RhdGUgZm9yIGxhdGVyIGNvcnJlbGF0aW9uLCAoYikgbG9ncyBvbmVcbiAgICogY29tcGFjdCBsaW5lIHRvIGl0cyBvd24gc3RkZXJyICh3aGljaCByZWFjaGVzIHRoZSBwcm9kIGxvZywgdW5saWtlIHRoZVxuICAgKiBjaGlsZCdzIGlnbm9yZWQgc3RkaW8pLCBhbmQgKGMpIGZvcndhcmRzIHRoZSBmdWxsIG9ic2VydmF0aW9uIHRvIHRoZVxuICAgKiBvcHRpb25hbCBgb25Qb29sZWRSdW5uZXJNZW1vcnlPYnNlcnZhdGlvbmAgaG9vayBzbyBhbiBhcHBsaWNhdGlvbiBjYW4gcm91dGVcbiAgICogaXQgKGUuZy4gdG8gYSBidWcgcmVwb3J0ZXIpIHdpdGhvdXQgcGFyc2luZyBsb2dzLiBUaGUgaGVhcC1zdGF0IGJyZWFrZG93blxuICAgKiBkaXN0aW5ndWlzaGVzIFY4LWhlYXAgZ3Jvd3RoIGZyb20gZXh0ZXJuYWwvYXJyYXktYnVmZmVyIChuYXRpdmUpIGdyb3d0aC4gQVxuICAgKiBob29rIGZhaWx1cmUgaXMgc3dhbGxvd2VkIOKAlCBkaWFnbm9zdGljcyBtdXN0IG5ldmVyIHRha2UgZG93biB0aGUgd29ya2VyIG9yXG4gICAqIGZhaWwgdGhlIGpvYnMgcnVubmluZyBvbiB0aGF0IGNoaWxkLlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIE1lc3NhZ2UgZGV0YWlscy5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCJub2RlOmNoaWxkX3Byb2Nlc3NcIikuQ2hpbGRQcm9jZXNzfSBhcmdzLmNoaWxkIC0gUG9vbGVkIGNoaWxkLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vdHlwZXMuanNcIikuUG9vbGVkQ2hpbGRNZW1vcnlPYnNlcnZhdGlvbn0gYXJncy5tZXNzYWdlIC0gVmFsaWRhdGVkIG1lbW9yeSBvYnNlcnZhdGlvbi5cbiAgICogQHJldHVybnMge3ZvaWR9XG4gICAqL1xuICBfaGFuZGxlUG9vbGVkQ2hpbGRNZW1vcnlPYnNlcnZhdGlvbih7Y2hpbGQsIG1lc3NhZ2V9KSB7XG4gICAgY29uc3Qgc3RhdGUgPSB0aGlzLnBvb2xlZENoaWxkU3RhdGVzLmdldChjaGlsZClcbiAgICBpZiAoc3RhdGUpIHN0YXRlLmxhc3RNZW1vcnlPYnNlcnZhdGlvbiA9IG1lc3NhZ2VcblxuICAgIGNvbnN0IGhlYXAgPSBtZXNzYWdlLmhlYXBTdGF0aXN0aWNzXG4gICAgY29uc29sZS5lcnJvcihcbiAgICAgIEpTT04uc3RyaW5naWZ5KHtcbiAgICAgICAgZXZlbnQ6IFwicG9vbGVkLWNoaWxkLW1lbW9yeVwiLFxuICAgICAgICBjaGlsZEluc3RhbmNlSWQ6IHN0YXRlPy5jaGlsZEluc3RhbmNlSWQgPz8gbWVzc2FnZS5jaGlsZEluc3RhbmNlSWQsXG4gICAgICAgIGNoaWxkUGlkOiBtZXNzYWdlLmNoaWxkUGlkLFxuICAgICAgICBjaGlsZFVwdGltZVM6IE1hdGgucm91bmQobWVzc2FnZS5jaGlsZFVwdGltZU1zIC8gMTAwMCksXG4gICAgICAgIHJzc01iOiBNYXRoLnJvdW5kKG1lc3NhZ2UucnNzQnl0ZXMgLyAoMTAyNCAqIDEwMjQpKSxcbiAgICAgICAgaGVhcFVzZWRNYjogTWF0aC5yb3VuZChoZWFwLnVzZWRfaGVhcF9zaXplIC8gKDEwMjQgKiAxMDI0KSksXG4gICAgICAgIGhlYXBUb3RhbE1iOiBNYXRoLnJvdW5kKGhlYXAudG90YWxfaGVhcF9zaXplIC8gKDEwMjQgKiAxMDI0KSksXG4gICAgICAgIGhlYXBMaW1pdE1iOiBNYXRoLnJvdW5kKGhlYXAuaGVhcF9zaXplX2xpbWl0IC8gKDEwMjQgKiAxMDI0KSksXG4gICAgICAgIGV4dGVybmFsTWI6IE1hdGgucm91bmQobWVzc2FnZS5tZW1vcnlVc2FnZS5leHRlcm5hbCAvICgxMDI0ICogMTAyNCkpLFxuICAgICAgICBhcnJheUJ1ZmZlcnNNYjogTWF0aC5yb3VuZChtZXNzYWdlLm1lbW9yeVVzYWdlLmFycmF5QnVmZmVycyAvICgxMDI0ICogMTAyNCkpLFxuICAgICAgICBqb2JzOiBtZXNzYWdlLmpvYkNvdW50LFxuICAgICAgICBhY3RpdmVKb2JJZHM6IG1lc3NhZ2UuYWN0aXZlSm9iSWRzXG4gICAgICB9KVxuICAgIClcblxuICAgIGlmICh0aGlzLm9uUG9vbGVkUnVubmVyTWVtb3J5T2JzZXJ2YXRpb24pIHtcbiAgICAgIHRyeSB7XG4gICAgICAgIGNvbnN0IHJlc3VsdCA9IHRoaXMub25Qb29sZWRSdW5uZXJNZW1vcnlPYnNlcnZhdGlvbihtZXNzYWdlKVxuICAgICAgICBpZiAocmVzdWx0ICYmIHR5cGVvZiByZXN1bHQuY2F0Y2ggPT09IFwiZnVuY3Rpb25cIikgcmVzdWx0LmNhdGNoKChlcnJvcikgPT4ge1xuICAgICAgICAgIGNvbnNvbGUuZXJyb3IoXCJQb29sZWQgcnVubmVyIG1lbW9yeSBvYnNlcnZhdGlvbiBob29rIGZhaWxlZDpcIiwgZXJyb3IpXG4gICAgICAgIH0pXG4gICAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgICBjb25zb2xlLmVycm9yKFwiUG9vbGVkIHJ1bm5lciBtZW1vcnkgb2JzZXJ2YXRpb24gaG9vayBmYWlsZWQ6XCIsIGVycm9yKVxuICAgICAgfVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBSZXF1ZXN0cyBhbiBpbW1lZGlhdGUgbWVtb3J5IG9ic2VydmF0aW9uIGZyb20gb25lIHBvb2xlZCBjaGlsZC4gVGhlIGNoaWxkXG4gICAqIHJlcGxpZXMgb3ZlciBJUEMgd2l0aCBpdHMgY3VycmVudCBzbmFwc2hvdCAodGhlIHNhbWUgc2hhcGUgYXMgdGhlIHBlcmlvZGljXG4gICAqIHNhbXBsZXIpLCB3aGljaCB0aGUgd29ya2VyIHJlY29yZHMsIGxvZ3MsIGFuZCBmb3J3YXJkcyB0byB0aGVcbiAgICogYG9uUG9vbGVkUnVubmVyTWVtb3J5T2JzZXJ2YXRpb25gIGhvb2suIFVzZSB0aGlzIHRvIHB1bGwgYSBzbmFwc2hvdCBvblxuICAgKiBzdXNwaWNpb24gKGUuZy4gYWZ0ZXIgYW4gT09NIHJlcG9ydCkgd2l0aG91dCB3YWl0aW5nIGZvciB0aGUgbmV4dCBwZXJpb2RpY1xuICAgKiBzYW1wbGUuIEEgbm8tb3Agd2hlbiB0aGUgY2hpbGQgaXMgZ29uZSBvciBpdHMgSVBDIGNoYW5uZWwgaXMgY2xvc2VkLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIm5vZGU6Y2hpbGRfcHJvY2Vzc1wiKS5DaGlsZFByb2Nlc3N9IGNoaWxkIC0gUG9vbGVkIGNoaWxkIHRvIHNhbXBsZS5cbiAgICogQHJldHVybnMge3ZvaWR9XG4gICAqL1xuICByZXF1ZXN0UG9vbGVkQ2hpbGRNZW1vcnlPYnNlcnZhdGlvbihjaGlsZCkge1xuICAgIGlmICghY2hpbGQuY29ubmVjdGVkKSByZXR1cm5cblxuICAgIHRyeSB7XG4gICAgICBjaGlsZC5zZW5kKHt0eXBlOiBcIm1lbW9yeS1vYnNlcnZhdGlvbi1yZXF1ZXN0XCJ9KVxuICAgIH0gY2F0Y2gge1xuICAgICAgLy8gVGhlIElQQyBjaGFubmVsIGlzIGFscmVhZHkgZ29uZTsgdGhlIGRpc2Nvbm5lY3QvZXhpdCBoYW5kbGVyIG93bnMgdGVhcmRvd24uXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIE1hcmtzIGEgcG9vbGVkIGNoaWxkIGZvciByZXRpcmVtZW50IGFuZCDigJQgd2hlbiB0aGUgcG9vbCBpcyBiZWxvdyBpdHMgaGFyZFxuICAgKiBjYXAg4oCUIGVhZ2VybHkgc3Bhd25zIGEgc2luZ2xlIHJlcGxhY2VtZW50ICgxLWZvci0xKSBzbyBpdHMgY2FwYWNpdHkgaXNcbiAgICogcmVzdG9yZWQgaW1tZWRpYXRlbHkgd2l0aG91dCB3YWl0aW5nIGZvciBpdCB0byBmaW5pc2ggZHJhaW5pbmcuIFRoZVxuICAgKiByZXBsYWNlbWVudCBzcGF3biBpcyBnYXRlZCBieSB0aGUgY2FwICh0aGUgcmV0aXJpbmcgY2hpbGQgc3RpbGwgY291bnRzIGFzXG4gICAqIGxpdmUgdW50aWwgaXQgZXhpdHMpLCBzbyBhIGZ1bGwgcG9vbCBzaW1wbHkgZGVmZXJzIHRoZSByZXBsYWNlbWVudCB0byB0aGVcbiAgICogcmV0aXJpbmcgY2hpbGQncyBkcmFpbiBpbnN0ZWFkIG9mIHNwYXduaW5nIG92ZXIgY2FwYWNpdHkuIFRoZSByZXRpcmluZ1xuICAgKiBjaGlsZCBzdG9wcyByZWNlaXZpbmcgbmV3IGpvYnMgYW5kIGlzIHRlcm1pbmF0ZWQgb25seSBvbmNlIGl0cyBpbi1mbGlnaHRcbiAgICogc2V0IGRyYWlucywgc28gYSBsb25nLXJ1bm5pbmcgam9iIChlLmcuIGEgYnVpbGQpIGlzIG5ldmVyIGN1dCBvZmYuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwibm9kZTpjaGlsZF9wcm9jZXNzXCIpLkNoaWxkUHJvY2Vzc30gY2hpbGQgLSBDaGlsZCB0byByZXRpcmUuXG4gICAqIEByZXR1cm5zIHt2b2lkfVxuICAgKi9cbiAgX2JlZ2luUmV0aXJlUG9vbGVkQ2hpbGQoY2hpbGQpIHtcbiAgICBjb25zdCBzdGF0ZSA9IHRoaXMucG9vbGVkQ2hpbGRTdGF0ZXMuZ2V0KGNoaWxkKVxuICAgIGlmICghc3RhdGUgfHwgc3RhdGUucmV0aXJpbmcpIHJldHVyblxuXG4gICAgc3RhdGUucmV0aXJpbmcgPSB0cnVlXG4gICAgLy8gQmVzdC1lZmZvcnQgcHJlLXdhcm06IHNraXAgd2hlbiBzdG9wcGluZyAobm8gbmV3IHdvcmspIG9yIGJlZm9yZSB0aGVcbiAgICAvLyB3b3JrZXIgaXMgaW5pdGlhbGl6ZWQgKG5vIGNvbmZpZ3VyYXRpb24gdG8gZm9yayBhIGNoaWxkIGZyb20pLiBUaGUgY2FwXG4gICAgLy8gaW5zaWRlIF9jcmVhdGVQb29sZWRDaGlsZCByZWZ1c2VzIHRoZSBzcGF3biB3aGlsZSB0aGUgcG9vbCBpcyBmdWxsLCBpblxuICAgIC8vIHdoaWNoIGNhc2UgdGhlIHJlcGxhY2VtZW50IGlzIGRlZmVycmVkIHRvIHRoZSBkcmFpbiBwYXRoLlxuICAgIGlmICghdGhpcy5zaG91bGRTdG9wICYmIHRoaXMuY29uZmlndXJhdGlvbikgdGhpcy5fY3JlYXRlUG9vbGVkQ2hpbGQoKVxuICB9XG5cbiAgLyoqXG4gICAqIFRlcm1pbmF0ZXMgYSByZXRpcmluZyBwb29sZWQgY2hpbGQgb25jZSBpdCBoYXMgbm8gaW4tZmxpZ2h0IGpvYnMgbGVmdC5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCJub2RlOmNoaWxkX3Byb2Nlc3NcIikuQ2hpbGRQcm9jZXNzfSBjaGlsZCAtIENoaWxkIHRvIGNoZWNrLlxuICAgKiBAcmV0dXJucyB7dm9pZH1cbiAgICovXG4gIF90ZXJtaW5hdGVJZkRyYWluZWQoY2hpbGQpIHtcbiAgICBjb25zdCBzdGF0ZSA9IHRoaXMucG9vbGVkQ2hpbGRTdGF0ZXMuZ2V0KGNoaWxkKVxuICAgIGlmICghc3RhdGUgfHwgIXN0YXRlLnJldGlyaW5nIHx8IHN0YXRlLmluZmxpZ2h0LnNpemUgPiAwKSByZXR1cm5cblxuICAgIHRoaXMuX3JldGlyZVBvb2xlZENoaWxkKGNoaWxkKVxuICB9XG5cbiAgLyoqXG4gICAqIFJldGlyZXMgYSBkcmFpbmVkIHBvb2xlZCBjaGlsZCAocmVtb3ZlcyBpdCBmcm9tIHRyYWNraW5nLCB0aGVuIFNJR1RFUk1zIGl0KS5cbiAgICogQmVjYXVzZSB0aGUgaGFyZCBjYXAgY291bnRzIGxpdmUgY2hpbGRyZW4sIHRoZSBleGl0IG9mIHRoaXMgY2hpbGQgZnJlZXMgYVxuICAgKiBzbG90OiBhbnkgZGVmZXJyZWQgcmVwbGFjZW1lbnQgKHRoZSBwb29sIHdhcyBmdWxsIHdoZW4gdGhlIGNoaWxkIHJldGlyZWQpXG4gICAqIGlzIHNwYXduZWQgbm93LCBhbmQgY2FwYWNpdHkgaXMgcmUtYWR2ZXJ0aXNlZCBzbyBtYWluIGNhbiBkaXNwYXRjaCBpbnRvIGl0LlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIm5vZGU6Y2hpbGRfcHJvY2Vzc1wiKS5DaGlsZFByb2Nlc3N9IGNoaWxkIC0gQ2hpbGQgcHJvY2VzcyB0byByZXRpcmUuXG4gICAqIEByZXR1cm5zIHt2b2lkfVxuICAgKi9cbiAgX3JldGlyZVBvb2xlZENoaWxkKGNoaWxkKSB7XG4gICAgY29uc3Qgc3RhdGUgPSB0aGlzLnBvb2xlZENoaWxkU3RhdGVzLmdldChjaGlsZClcbiAgICBpZiAoIXN0YXRlKSB0aHJvdyBuZXcgRXJyb3IoXCJDYW5ub3QgcmV0aXJlIHBvb2xlZCBjaGlsZCB3aXRob3V0IHRyYWNrZWQgc3RhdGVcIilcbiAgICBpZiAoc3RhdGUuaW5mbGlnaHQuc2l6ZSA+IDApIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihgQ2Fubm90IHJldGlyZSBwb29sZWQgY2hpbGQgd2hpbGUgJHtzdGF0ZS5pbmZsaWdodC5zaXplfSAke3N0YXRlLmluZmxpZ2h0LnNpemUgPT09IDEgPyBcImpvYiByZW1haW5zXCIgOiBcImpvYnMgcmVtYWluXCJ9IGluIGZsaWdodGApXG4gICAgfVxuXG4gICAgdGhpcy5wb29sZWRDaGlsZHJlbi5kZWxldGUoY2hpbGQpXG4gICAgc3RhdGUucmV0aXJpbmcgPSB0cnVlXG4gICAgdGhpcy5fcmVxdWVzdFBvb2xlZENoaWxkU2h1dGRvd24oe2NoaWxkLCByZWFzb246IFwicGFyZW50X3JldGlyZV9kcmFpbmVkXCIsIHNpZ25hbDogXCJTSUdURVJNXCIsIHdhaXRGb3JPYnNlcnZhdGlvbjogdHJ1ZX0pXG4gIH1cblxuICAvKipcbiAgICogUmVjb3JkcyBhbiBleGFjdCBwYXJlbnQgcmVxdWVzdCBiZWZvcmUgSVBDIG9yIHNpZ25hbCBkZWxpdmVyeS4gRHJhaW5lZFxuICAgKiByZXRpcmVtZW50IGdldHMgYSBicmllZiBJUEMtZmlyc3QgZ3JhY2Ugc28gaXRzIHplcm8tam9iIG9ic2VydmF0aW9uIGlzXG4gICAqIGRldGVybWluaXN0aWM7IHRpbWVvdXQvd29ya2VyLXN0b3AgcGF0aHMgc2lnbmFsIGltbWVkaWF0ZWx5LlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIFNodXRkb3duIHJlcXVlc3QuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwibm9kZTpjaGlsZF9wcm9jZXNzXCIpLkNoaWxkUHJvY2Vzc30gYXJncy5jaGlsZCAtIFBvb2xlZCBjaGlsZC5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL3R5cGVzLmpzXCIpLlBvb2xlZENoaWxkU2h1dGRvd25SZWFzb259IGFyZ3MucmVhc29uIC0gRXhhY3QgcGFyZW50IHJlYXNvbi5cbiAgICogQHBhcmFtIHtrZXlvZiB0eXBlb2YgaW1wb3J0KFwibm9kZTpvc1wiKS5jb25zdGFudHMuc2lnbmFsc30gYXJncy5zaWduYWwgLSBTaWduYWwgdG8gZGVsaXZlci5cbiAgICogQHBhcmFtIHtib29sZWFufSBbYXJncy53YWl0Rm9yT2JzZXJ2YXRpb25dIC0gV2hldGhlciBJUEMgb2JzZXJ2YXRpb24gbWF5IHByZWNlZGUgc2lnbmFsIGZhbGxiYWNrLlxuICAgKiBAcmV0dXJucyB7dm9pZH1cbiAgICovXG4gIF9yZXF1ZXN0UG9vbGVkQ2hpbGRTaHV0ZG93bih7Y2hpbGQsIHJlYXNvbiwgc2lnbmFsLCB3YWl0Rm9yT2JzZXJ2YXRpb24gPSBmYWxzZX0pIHtcbiAgICBjb25zdCBzdGF0ZSA9IHRoaXMucG9vbGVkQ2hpbGRTdGF0ZXMuZ2V0KGNoaWxkKVxuICAgIGlmICghc3RhdGUgfHwgc3RhdGUuc2V0dGxpbmcgfHwgc3RhdGUuc2h1dGRvd25SZWFzb24pIHJldHVyblxuXG4gICAgY29uc3Qgc2h1dGRvd25SZXF1ZXN0ZWRBdE1zID0gRGF0ZS5ub3coKVxuICAgIHN0YXRlLnNodXRkb3duUmVhc29uID0gcmVhc29uXG4gICAgc3RhdGUuc2h1dGRvd25SZXF1ZXN0ZWRBdE1zID0gc2h1dGRvd25SZXF1ZXN0ZWRBdE1zXG4gICAgc3RhdGUuc2h1dGRvd25TaWduYWwgPSBzaWduYWxcblxuICAgIGxldCByZXF1ZXN0U2VudCA9IGZhbHNlXG4gICAgaWYgKGNoaWxkLmNvbm5lY3RlZCkge1xuICAgICAgdHJ5IHtcbiAgICAgICAgY2hpbGQuc2VuZCh7dHlwZTogXCJzaHV0ZG93bi1yZXF1ZXN0XCIsIHJlYXNvbiwgc2h1dGRvd25SZXF1ZXN0ZWRBdE1zLCBzaWduYWx9LCAoZXJyb3IpID0+IHtcbiAgICAgICAgICBpZiAoIWVycm9yIHx8ICF3YWl0Rm9yT2JzZXJ2YXRpb24gfHwgc3RhdGUuc2V0dGxpbmcpIHJldHVyblxuXG4gICAgICAgICAgaWYgKHN0YXRlLnNodXRkb3duU2lnbmFsVGltZXIpIHtcbiAgICAgICAgICAgIGNsZWFyVGltZW91dChzdGF0ZS5zaHV0ZG93blNpZ25hbFRpbWVyKVxuICAgICAgICAgICAgc3RhdGUuc2h1dGRvd25TaWduYWxUaW1lciA9IHVuZGVmaW5lZFxuICAgICAgICAgIH1cbiAgICAgICAgICB0aGlzLl9zaWduYWxQb29sZWRDaGlsZCh7Y2hpbGQsIHNpZ25hbH0pXG4gICAgICAgIH0pXG4gICAgICAgIHJlcXVlc3RTZW50ID0gdHJ1ZVxuICAgICAgfSBjYXRjaCB7XG4gICAgICAgIC8vIFRoZSBzaWduYWwgYmVsb3cgcmVtYWlucyB0aGUgYm91bmRlZCBzaHV0ZG93biBtZWNoYW5pc20uXG4gICAgICB9XG4gICAgfVxuXG4gICAgaWYgKHdhaXRGb3JPYnNlcnZhdGlvbiAmJiByZXF1ZXN0U2VudCkge1xuICAgICAgc3RhdGUuc2h1dGRvd25TaWduYWxUaW1lciA9IHNldFRpbWVvdXQoKCkgPT4ge1xuICAgICAgICBzdGF0ZS5zaHV0ZG93blNpZ25hbFRpbWVyID0gdW5kZWZpbmVkXG4gICAgICAgIHRoaXMuX3NpZ25hbFBvb2xlZENoaWxkKHtjaGlsZCwgc2lnbmFsfSlcbiAgICAgIH0sIFBPT0xFRF9SVU5ORVJfU0hVVERPV05fUkVRVUVTVF9HUkFDRV9NUylcbiAgICAgIHN0YXRlLnNodXRkb3duU2lnbmFsVGltZXIudW5yZWYoKVxuICAgICAgcmV0dXJuXG4gICAgfVxuXG4gICAgdGhpcy5fc2lnbmFsUG9vbGVkQ2hpbGQoe2NoaWxkLCBzaWduYWx9KVxuICB9XG5cbiAgLyoqXG4gICAqIERlbGl2ZXJzIG9uZSBwYXJlbnQtb3duZWQgcHJvY2VzcyBzaWduYWwgd2l0aG91dCBjaGFuZ2luZyByZWNvcmRlZCBwcm92ZW5hbmNlLlxuICAgKiBAcGFyYW0ge3tjaGlsZDogaW1wb3J0KFwibm9kZTpjaGlsZF9wcm9jZXNzXCIpLkNoaWxkUHJvY2Vzcywgc2lnbmFsOiBrZXlvZiB0eXBlb2YgaW1wb3J0KFwibm9kZTpvc1wiKS5jb25zdGFudHMuc2lnbmFsc319IGFyZ3MgLSBTaWduYWwgcmVxdWVzdC5cbiAgICogQHJldHVybnMge3ZvaWR9XG4gICAqL1xuICBfc2lnbmFsUG9vbGVkQ2hpbGQoe2NoaWxkLCBzaWduYWx9KSB7XG4gICAgdHJ5IHtcbiAgICAgIGNoaWxkLmtpbGwoc2lnbmFsKVxuICAgIH0gY2F0Y2gge1xuICAgICAgLy8gQ2hpbGQgYWxyZWFkeSBleGl0ZWQ7IGl0cyBleGl0L2Vycm9yIGhhbmRsZXIgb3ducyBzdGF0ZSBzZXR0bGVtZW50LlxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBSZW1vdmVzIGFuIGV4aXRlZC91bmhlYWx0aHkgcG9vbGVkIGNoaWxkIGFuZCByZXBvcnRzIGV2ZXJ5IGpvYiB0aGF0IHdhc1xuICAgKiBpbi1mbGlnaHQgb24gaXQgYXMgZmFpbGVkIOKAlCBhIHByb2Nlc3MtbGV2ZWwgY3Jhc2gncyBibGFzdCByYWRpdXMgaXMgdGhlXG4gICAqIGNoaWxkJ3Mgd2hvbGUgaW4tZmxpZ2h0IHNldC4gT25jZSB0aGUgY2hpbGQgaGFzIGNvbXBsZXRlZCBzdGFydHVwLCBpdHNcbiAgICogZnJlZWQgY2FwYWNpdHkgaXMgYWR2ZXJ0aXNlZCBpbW1lZGlhdGVseTsgdGhlIHJlcGxhY2VtZW50IGl0c2VsZiBpcyBzdGlsbFxuICAgKiBzcGF3bmVkIGxhemlseSBieSB0aGUgbmV4dCBkaXNwYXRjaC4gQSBjaGlsZCB0aGF0IGV4aXRzIGJlZm9yZSBpdHMgc3RhcnR1cFxuICAgKiBoYW5kc2hha2UgZG9lcyBub3QgcmUtYW5ub3VuY2UsIGF2b2lkaW5nIGEgdGlnaHQgcmVzcGF3biBsb29wIG9uIHN0YXJ0dXBcbiAgICogZmFpbHVyZS5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBGYWlsdXJlIGRldGFpbHMuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwibm9kZTpjaGlsZF9wcm9jZXNzXCIpLkNoaWxkUHJvY2Vzc30gYXJncy5jaGlsZCAtIFBvb2xlZCBjaGlsZC5cbiAgICogQHBhcmFtIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gYXJncy5lcnJvciAtIEZhaWx1cmUuXG4gICAqIEBwYXJhbSB7bnVtYmVyIHwgbnVsbH0gW2FyZ3MuZXhpdENvZGVdIC0gQ2hpbGQgZXhpdCBjb2RlIHdoZW4gb2JzZXJ2ZWQuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi90eXBlcy5qc1wiKS5Qb29sZWRSdW5uZXJGYWlsdXJlT3JpZ2lufSBbYXJncy5vcmlnaW5dIC0gV29ya2VyIG9ic2VydmF0aW9uIHRoYXQgaW5pdGlhdGVkIHJlY292ZXJ5LlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIm5vZGU6Y2hpbGRfcHJvY2Vzc1wiKS5DaGlsZFByb2Nlc3NbXCJzaWduYWxDb2RlXCJdfSBbYXJncy5zaWduYWxdIC0gQ2hpbGQgdGVybWluYXRpb24gc2lnbmFsIHdoZW4gb2JzZXJ2ZWQuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fVxuICAgKi9cbiAgYXN5bmMgX2hhbmRsZVBvb2xlZENoaWxkRmFpbHVyZSh7Y2hpbGQsIGVycm9yLCBleGl0Q29kZSA9IG51bGwsIG9yaWdpbiA9IFwicHJvY2Vzcy1lcnJvclwiLCBzaWduYWwgPSBudWxsfSkge1xuICAgIGNvbnN0IHN0YXRlID0gdGhpcy5wb29sZWRDaGlsZFN0YXRlcy5nZXQoY2hpbGQpXG4gICAgaWYgKHN0YXRlPy5zZXR0bGluZykgcmV0dXJuXG4gICAgaWYgKHN0YXRlKSB7XG4gICAgICBzdGF0ZS5zZXR0bGluZyA9IHRydWVcbiAgICAgIC8vIENhbmNlbCB0aGlzIGNoaWxkJ3MgcGVuZGluZyB0aW1lcnMgYmVmb3JlIGl0cyBpbi1mbGlnaHQgc2V0IGlzIHJlcG9ydGVkIOKAlFxuICAgICAgLy8gdGhlIFNJR0tJTEwgZ3JhY2UgZnJvbSBhIHRpbWVvdXQga2lsbCwgYW5kIGV2ZXJ5IGFybWVkIHBlci1qb2IgYmFja3N0b3AuXG4gICAgICBpZiAoc3RhdGUudGltZW91dFNpZ2tpbGxUaW1lcikgY2xlYXJUaW1lb3V0KHN0YXRlLnRpbWVvdXRTaWdraWxsVGltZXIpXG4gICAgICBpZiAoc3RhdGUuc2h1dGRvd25TaWduYWxUaW1lcikgY2xlYXJUaW1lb3V0KHN0YXRlLnNodXRkb3duU2lnbmFsVGltZXIpXG4gICAgICBmb3IgKGNvbnN0IGluZmxpZ2h0RW50cnkgb2Ygc3RhdGUuaW5mbGlnaHQudmFsdWVzKCkpIHtcbiAgICAgICAgaWYgKGluZmxpZ2h0RW50cnkudGltZW91dFRpbWVyKSBjbGVhclRpbWVvdXQoaW5mbGlnaHRFbnRyeS50aW1lb3V0VGltZXIpXG4gICAgICB9XG4gICAgfVxuICAgIHRoaXMucG9vbGVkQ2hpbGRyZW4uZGVsZXRlKGNoaWxkKVxuICAgIHRoaXMuaW5mbGlnaHRQcm9jZXNzQ2hpbGRyZW4uZGVsZXRlKGNoaWxkKVxuICAgIC8vIENoaWxkIGV4aXQgZnJlZXMgYSBoYXJkLWNhcCBzbG90IGV2ZW4gd2hpbGUgaXRzIGluLWZsaWdodCBzZXQgaXMgc3RpbGxcbiAgICAvLyBiZWluZyByZXBvcnRlZCDigJQgd2FrZSB3YWl0ZXJzIG5vdzsgdGhlaXIgcmVwb3J0cyBzZXR0bGUgaW5kZXBlbmRlbnRseS5cbiAgICB0aGlzLl93YWtlUG9vbGVkU2xvdFdhaXRlcnMoKVxuXG4gICAgY29uc3QgZW50cmllcyA9IHN0YXRlID8gWy4uLnN0YXRlLmluZmxpZ2h0LnZhbHVlcygpXSA6IFtdXG4gICAgY29uc3QgcnVubmVyRmFpbHVyZSA9IHN0YXRlXG4gICAgICA/IHRoaXMuX3Bvb2xlZFJ1bm5lckZhaWx1cmUoe2NoaWxkLCBleGl0Q29kZSwgb3JpZ2luLCBzaWduYWwsIHN0YXRlfSlcbiAgICAgIDogdW5kZWZpbmVkXG4gICAgaWYgKHN0YXRlKSBzdGF0ZS5pbmZsaWdodC5jbGVhcigpXG4gICAgdGhpcy5wb29sZWRDaGlsZFN0YXRlcy5kZWxldGUoY2hpbGQpXG5cbiAgICBjb25zdCBmYWlsdXJlUmVwb3J0cyA9IGVudHJpZXMubWFwKGFzeW5jIChlbnRyeSkgPT4ge1xuICAgICAgYXdhaXQgdGhpcy5fcmVwb3J0Sm9iUmVzdWx0KHtcbiAgICAgICAgam9iSWQ6IGVudHJ5LnBheWxvYWQuaWQsXG4gICAgICAgIHN0YXR1czogXCJmYWlsZWRcIixcbiAgICAgICAgZXJyb3IsXG4gICAgICAgIGhhbmRvZmZJZDogZW50cnkucGF5bG9hZC5oYW5kb2ZmSWQsXG4gICAgICAgIGhhbmRlZE9mZkF0TXM6IGVudHJ5LnBheWxvYWQuaGFuZGVkT2ZmQXRNcyxcbiAgICAgICAgcnVubmVyRmFpbHVyZSxcbiAgICAgICAgd29ya2VySWQ6IGVudHJ5LnBheWxvYWQud29ya2VySWQgfHwgdGhpcy53b3JrZXJJZFxuICAgICAgfSlcbiAgICAgIGlmIChlbnRyeS5yZXNvbHZlKSBlbnRyeS5yZXNvbHZlKHVuZGVmaW5lZClcbiAgICB9KVxuXG4gICAgLy8gU3RhcnQgZXZlcnkgZmFsbGJhY2sgcmVwb3J0IGJlZm9yZSBhbm5vdW5jaW5nIGNhcGFjaXR5IHNvIHRoZSBtYWluIGNhbm5vdFxuICAgIC8vIG9ic2VydmUgYSByZXBsYWNlbWVudCBzbG90IGJlZm9yZSB0aGUgZmFpbGVkIGpvYnMnIHJlcG9ydHMgYXJlIGluIGZsaWdodC5cbiAgICAvLyBUaGUgcmVwb3J0IHByb21pc2VzIHJlbWFpbiB0cmFja2VkIGJlbG93OyBhIHNsb3cgcmV0cnkgbXVzdCBub3QgaG9sZCB0aGVcbiAgICAvLyBuZXdseSBmcmVlZCBydW5uZXIgY2FwYWNpdHkgaG9zdGFnZS5cbiAgICAvLyBBIGRyYWluZWQgcmV0aXJlbWVudCBhbHJlYWR5IGFkdmVydGlzZWQgaXRzIHJlcGxhY2VtZW50IGNhcGFjaXR5IHdoZW5cbiAgICAvLyB0aGUgZmluYWwgam9iIGNvbXBsZXRlZC4gUmUtYWR2ZXJ0aXNpbmcgaGVyZSBjYW4gcmVzdG9yZSBhIGNyZWRpdCBtYWluXG4gICAgLy8gY29uc3VtZWQgYmVmb3JlIGl0cyBoYW5kb2ZmIHJlYWNoZWQgdGhlIHJlcGxhY2VtZW50IGNoaWxkLlxuICAgIGlmIChzdGF0ZT8uc2h1dGRvd25SZWFzb24gIT09IFwicGFyZW50X3JldGlyZV9kcmFpbmVkXCIpIHtcbiAgICAgIGlmIChzdGF0ZSAmJiBzdGF0ZS5zdGFydGVkICE9PSBmYWxzZSkge1xuICAgICAgICB0aGlzLl9zZW5kUmVhZHlJZlJ1bm5pbmcoKVxuICAgICAgfSBlbHNlIGlmIChzdGF0ZSkge1xuICAgICAgICBmb3IgKGNvbnN0IGVudHJ5IG9mIGVudHJpZXMpIHtcbiAgICAgICAgICBpZiAoZW50cnkucG9vbGVkSm9iKSB0aGlzLl9wb29sZWRTdGFydHVwRmFpbHVyZUpvYnMuYWRkKGVudHJ5LnBvb2xlZEpvYilcbiAgICAgICAgICBjb25zdCBxdWV1ZVRyYWNrZXIgPSB0aGlzLnBvb2xlZEpvYlF1ZXVlVHJhY2tlcnMuZ2V0KGVudHJ5LnBheWxvYWQuaWQpXG4gICAgICAgICAgaWYgKHF1ZXVlVHJhY2tlcikgdGhpcy5fcG9vbGVkU3RhcnR1cEZhaWx1cmVKb2JzLmFkZChxdWV1ZVRyYWNrZXIpXG4gICAgICAgIH1cbiAgICAgICAgLy8gQSBwcmV2aW91cyByZWFkeSBtZXNzYWdlIG1heSBzdGlsbCBoYXZlIHVuY29uc3VtZWQgcG9vbGVkIGNyZWRpdHMgYXQgdGhlXG4gICAgICAgIC8vIG1haW4uIFJldm9rZSB0aGVtIGF1dGhvcml0YXRpdmVseSB3aXRob3V0IHN1cHByZXNzaW5nIHZhbGlkIGlubGluZSBvclxuICAgICAgICAvLyBwcm9jZXNzLXJ1bm5lciByZWFkaW5lc3M7IG90aGVyd2lzZSBxdWV1ZWQgam9icyBjYW4gdHJpZ2dlciBhIHN0YXJ0dXBcbiAgICAgICAgLy8gY3Jhc2ggbG9vcCB1c2luZyB0aGUgc3RhbGUgY3JlZGl0cy5cbiAgICAgICAgdGhpcy5fc2VuZFJlYWR5SWZSdW5uaW5nKHtyZXZva2VQb29sZWRBZG1pc3Npb246IHRydWV9KVxuICAgICAgfVxuICAgIH1cblxuICAgIGF3YWl0IFByb21pc2UuYWxsU2V0dGxlZChmYWlsdXJlUmVwb3J0cylcbiAgfVxuXG4gIC8qKlxuICAgKiBDYXB0dXJlcyBvbmUgc3RhYmxlIHByb2Nlc3Mgc25hcHNob3QgYmVmb3JlIHRoZSBmYWlsZWQgY2hpbGQncyBzdGF0ZSBpcyByZW1vdmVkLlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIEZhaWx1cmUgZGV0YWlscy5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCJub2RlOmNoaWxkX3Byb2Nlc3NcIikuQ2hpbGRQcm9jZXNzfSBhcmdzLmNoaWxkIC0gRmFpbGVkIHBvb2xlZCBjaGlsZC5cbiAgICogQHBhcmFtIHtudW1iZXIgfCBudWxsfSBhcmdzLmV4aXRDb2RlIC0gQ2hpbGQgZXhpdCBjb2RlIHdoZW4gb2JzZXJ2ZWQuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi90eXBlcy5qc1wiKS5Qb29sZWRSdW5uZXJGYWlsdXJlT3JpZ2lufSBhcmdzLm9yaWdpbiAtIFdvcmtlciBvYnNlcnZhdGlvbiB0aGF0IGluaXRpYXRlZCByZWNvdmVyeS5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCJub2RlOmNoaWxkX3Byb2Nlc3NcIikuQ2hpbGRQcm9jZXNzW1wic2lnbmFsQ29kZVwiXX0gYXJncy5zaWduYWwgLSBDaGlsZCB0ZXJtaW5hdGlvbiBzaWduYWwgd2hlbiBvYnNlcnZlZC5cbiAgICogQHBhcmFtIHtQb29sZWRDaGlsZFN0YXRlfSBhcmdzLnN0YXRlIC0gQ2hpbGQgc3RhdGUgaW1tZWRpYXRlbHkgYmVmb3JlIHJlY292ZXJ5LlxuICAgKiBAcmV0dXJucyB7aW1wb3J0KFwiLi90eXBlcy5qc1wiKS5Qb29sZWRSdW5uZXJGYWlsdXJlfSAtIFNoYXJlZCBmYWlsdXJlIHByb3ZlbmFuY2UuXG4gICAqL1xuICBfcG9vbGVkUnVubmVyRmFpbHVyZSh7Y2hpbGQsIGV4aXRDb2RlLCBvcmlnaW4sIHNpZ25hbCwgc3RhdGV9KSB7XG4gICAgY29uc3Qgb2JzZXJ2YXRpb24gPSBzdGF0ZS5zaHV0ZG93bk9ic2VydmF0aW9uXG4gICAgbGV0IHNodXRkb3duUmVhc29uID0gc3RhdGUuc2h1dGRvd25SZWFzb24gPz8gb2JzZXJ2YXRpb24/LnJlYXNvblxuICAgIGlmICghc2h1dGRvd25SZWFzb24pIHtcbiAgICAgIGlmIChvcmlnaW4gPT09IFwicHJvY2Vzcy1lcnJvclwiIHx8IG9yaWdpbiA9PT0gXCJpcGMtc2VuZFwiKSB7XG4gICAgICAgIHNodXRkb3duUmVhc29uID0gXCJwcm9jZXNzX2Vycm9yXCJcbiAgICAgIH0gZWxzZSBpZiAoc2lnbmFsID09PSBcIlNJR1RFUk1cIikge1xuICAgICAgICBzaHV0ZG93blJlYXNvbiA9IFwic2lnbmFsX3NpZ3Rlcm1cIlxuICAgICAgfSBlbHNlIGlmIChzaWduYWwgPT09IFwiU0lHSU5UXCIpIHtcbiAgICAgICAgc2h1dGRvd25SZWFzb24gPSBcInNpZ25hbF9zaWdpbnRcIlxuICAgICAgfSBlbHNlIGlmIChzaWduYWwgPT09IFwiU0lHS0lMTFwiKSB7XG4gICAgICAgIHNodXRkb3duUmVhc29uID0gXCJzaWduYWxfc2lna2lsbFwiXG4gICAgICB9IGVsc2UgaWYgKHNpZ25hbCkge1xuICAgICAgICBzaHV0ZG93blJlYXNvbiA9IFwic2lnbmFsX290aGVyXCJcbiAgICAgIH0gZWxzZSBpZiAoc3RhdGUuaXBjRGlzY29ubmVjdGVkQXRNcyAmJiBleGl0Q29kZSA9PT0gMCkge1xuICAgICAgICBzaHV0ZG93blJlYXNvbiA9IFwiaXBjX2Rpc2Nvbm5lY3RcIlxuICAgICAgfSBlbHNlIHtcbiAgICAgICAgc2h1dGRvd25SZWFzb24gPSBcInVuZXhwZWN0ZWRfZXhpdFwiXG4gICAgICB9XG4gICAgfVxuICAgIGNvbnN0IHRlcm1pbmF0aW9uUmVhc29uID0gc2h1dGRvd25SZWFzb24gPT09IFwiam9iX3RpbWVvdXRcIlxuICAgICAgPyBcImpvYi10aW1lb3V0XCJcbiAgICAgIDogc2h1dGRvd25SZWFzb24gPT09IFwid29ya2VyX3N0b3BcIiA/IFwid29ya2VyLXNodXRkb3duLXRpbWVvdXRcIiA6IFwidW5leHBlY3RlZFwiXG4gICAgY29uc3Qgd29ya2VyTGlmZWN5Y2xlID0gdGhpcy5zaG91bGRTdG9wID8gXCJzdG9wcGluZ1wiIDogdGhpcy5pc1JldGlyaW5nID8gXCJyZXRpcmluZ1wiIDogXCJydW5uaW5nXCJcbiAgICBjb25zdCBydW5uZXJMaWZlY3ljbGUgPSBzdGF0ZS5zdGFydGVkID09PSBmYWxzZSA/IFwic3RhcnRpbmdcIiA6IHN0YXRlLnJldGlyaW5nID8gXCJyZXRpcmluZ1wiIDogXCJydW5uaW5nXCJcbiAgICBjb25zdCBib3VuZGVkSW5mbGlnaHQgPSBib3VuZGVkUG9vbGVkUnVubmVySW5mbGlnaHRKb2JJZHMoc3RhdGUuaW5mbGlnaHQua2V5cygpKVxuICAgIGNvbnN0IGFjdGl2ZUpvYnMgPSBbLi4uc3RhdGUuaW5mbGlnaHQudmFsdWVzKCldXG4gICAgICAubWFwKChlbnRyeSkgPT4gKHtcbiAgICAgICAgaGFuZG9mZklkOiBlbnRyeS5wYXlsb2FkLmhhbmRvZmZJZCA/PyBudWxsLFxuICAgICAgICBoYW5kZWRPZmZBdE1zOiBlbnRyeS5wYXlsb2FkLmhhbmRlZE9mZkF0TXMgPz8gbnVsbCxcbiAgICAgICAgam9iSWQ6IGVudHJ5LnBheWxvYWQuaWQsXG4gICAgICAgIGpvYk5hbWU6IGVudHJ5LnBheWxvYWQuam9iTmFtZSxcbiAgICAgICAgd29ya2VySWQ6IGVudHJ5LnBheWxvYWQud29ya2VySWQgPz8gdGhpcy53b3JrZXJJZFxuICAgICAgfSkpXG4gICAgICAuc29ydCgobGVmdCwgcmlnaHQpID0+IGxlZnQuam9iSWQubG9jYWxlQ29tcGFyZShyaWdodC5qb2JJZCkpXG5cbiAgICByZXR1cm4gT2JqZWN0LmZyZWV6ZSh7XG4gICAgICBhY3RpdmVKb2JzLFxuICAgICAgY2hpbGRJbnN0YW5jZUlkOiBzdGF0ZS5jaGlsZEluc3RhbmNlSWQgPz8gb2JzZXJ2YXRpb24/LmNoaWxkSW5zdGFuY2VJZCA/PyBudWxsLFxuICAgICAgZXhpdENvZGUsXG4gICAgICBnZW5lcmF0aW9uSWQ6IHRoaXMuZ2VuZXJhdGlvbklkID8/IG51bGwsXG4gICAgICAuLi5ib3VuZGVkSW5mbGlnaHQsXG4gICAgICBvb21LaWxsZWQ6IHNpZ25hbCA9PT0gXCJTSUdLSUxMXCIgJiYgc2h1dGRvd25SZWFzb24gPT09IFwic2lnbmFsX3NpZ2tpbGxcIiA/IG51bGwgOiBmYWxzZSxcbiAgICAgIG9yaWdpbixcbiAgICAgIHJ1bm5lckFnZU1zOiBNYXRoLm1heCgwLCBEYXRlLm5vdygpIC0gc3RhdGUuY3JlYXRlZEF0TXMpLFxuICAgICAgcnVubmVyQ3JlYXRlZEF0TXM6IHN0YXRlLmNyZWF0ZWRBdE1zLFxuICAgICAgcnVubmVyRGV0YWNoZWQ6IGZhbHNlLFxuICAgICAgcnVubmVySm9ic1J1bjogc3RhdGUuam9ic1J1bixcbiAgICAgIHJ1bm5lckxpZmVjeWNsZSxcbiAgICAgIHJ1bm5lclBpZDogY2hpbGQucGlkID8/IG51bGwsXG4gICAgICBzaWduYWwsXG4gICAgICBzaHV0ZG93bk9ic2VydmVkQXRNczogb2JzZXJ2YXRpb24/LnNodXRkb3duT2JzZXJ2ZWRBdE1zID8/IHN0YXRlLmlwY0Rpc2Nvbm5lY3RlZEF0TXMgPz8gbnVsbCxcbiAgICAgIHNodXRkb3duUmVxdWVzdGVkQXRNczogc3RhdGUuc2h1dGRvd25SZXF1ZXN0ZWRBdE1zID8/IG9ic2VydmF0aW9uPy5zaHV0ZG93blJlcXVlc3RlZEF0TXMgPz8gbnVsbCxcbiAgICAgIHNodXRkb3duUmVhc29uLFxuICAgICAgc2h1dGRvd25TaWduYWw6IHN0YXRlLnNodXRkb3duU2lnbmFsID8/IG9ic2VydmF0aW9uPy5zaWduYWwgPz8gc2lnbmFsLFxuICAgICAgdGVybWluYXRpb25SZWFzb24sXG4gICAgICB0aW1lb3V0Sm9iSWQ6IHN0YXRlLnRpbWVvdXRKb2JJZCA/PyBudWxsLFxuICAgICAgd29ya2VySWQ6IHRoaXMud29ya2VySWQsXG4gICAgICB3b3JrZXJMaWZlY3ljbGUsXG4gICAgICB3b3JrZXJQaWQ6IHByb2Nlc3MucGlkXG4gICAgfSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHJ1biBqb2IgaW5saW5lLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vdHlwZXMuanNcIikuQmFja2dyb3VuZEpvYlBheWxvYWR9IHBheWxvYWQgLSBQYXlsb2FkLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyB3aGVuIGRvbmUuXG4gICAqL1xuICBhc3luYyBfcnVuSm9iSW5saW5lKHBheWxvYWQpIHtcbiAgICBjb25zdCBjb25maWd1cmF0aW9uID0gdGhpcy5jb25maWd1cmF0aW9uXG4gICAgaWYgKCFjb25maWd1cmF0aW9uKSB0aHJvdyBuZXcgRXJyb3IoXCJCYWNrZ3JvdW5kIGpvYnMgd29ya2VyIGNvbmZpZ3VyYXRpb24gbm90IGluaXRpYWxpemVkXCIpXG5cbiAgICBjb25zdCByZWdpc3RyeSA9IG5ldyBCYWNrZ3JvdW5kSm9iUmVnaXN0cnkoe2NvbmZpZ3VyYXRpb259KVxuICAgIGF3YWl0IHJlZ2lzdHJ5LmxvYWQoKVxuICAgIGNvbnN0IEpvYkNsYXNzID0gcmVnaXN0cnkuZ2V0Sm9iQnlOYW1lKHBheWxvYWQuam9iTmFtZSlcbiAgICBhd2FpdCBydW5XaXRoQmFja2dyb3VuZEpvYlBheWxvYWQocGF5bG9hZCwgYXN5bmMgKCkgPT4ge1xuICAgICAgYXdhaXQgcGVyZm9ybUJhY2tncm91bmRKb2Ioe1xuICAgICAgICBjb25maWd1cmF0aW9uLFxuICAgICAgICBKb2JDbGFzcyxcbiAgICAgICAgam9iQXJnczogcGF5bG9hZC5hcmdzIHx8IFtdLFxuICAgICAgICBqb2JPcHRpb25zOiBwYXlsb2FkLm9wdGlvbnMgfHwge30sXG4gICAgICAgIG5hbWU6IGBCYWNrZ3JvdW5kIGpvYiB3b3JrZXIgaW5saW5lOiAke3BheWxvYWQuam9iTmFtZX1gLFxuICAgICAgICBwYXlsb2FkXG4gICAgICB9KVxuICAgIH0pXG4gIH1cblxuICAvKipcbiAgICogUnVucyBmb3JrIGpvYi5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL3R5cGVzLmpzXCIpLkJhY2tncm91bmRKb2JQYXlsb2FkICYge2lkOiBzdHJpbmd9fSBwYXlsb2FkIC0gUGF5bG9hZC5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgd2hlbiB0aGUgZm9ya2VkIHJ1bm5lciBleGl0cyBvciBmb3JrIGZhaWxzLlxuICAgKi9cbiAgX2ZvcmtKb2IocGF5bG9hZCkge1xuICAgIGNvbnN0IGNoaWxkID0gdGhpcy5fY3JlYXRlRm9ya2VkQ2hpbGQoKVxuXG4gICAgdGhpcy5pbmZsaWdodFByb2Nlc3NDaGlsZHJlbi5hZGQoY2hpbGQpXG5cbiAgICBjb25zdCBmaW5pc2hlZCA9IHRoaXMuX3dhaXRGb3JGb3JrZWRDaGlsZCh7Y2hpbGQsIHBheWxvYWR9KVxuXG4gICAgdGhpcy5fc2VuZEZvcmtlZFBheWxvYWQoe2NoaWxkLCBwYXlsb2FkfSlcblxuICAgIHJldHVybiBmaW5pc2hlZFxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgY3JlYXRlIGZvcmtlZCBjaGlsZC5cbiAgICogQHJldHVybnMge2ltcG9ydChcIm5vZGU6Y2hpbGRfcHJvY2Vzc1wiKS5DaGlsZFByb2Nlc3N9IC0gRm9ya2VkIGNoaWxkIHByb2Nlc3MuXG4gICAqL1xuICBfY3JlYXRlRm9ya2VkQ2hpbGQoKSB7XG4gICAgY29uc3QgY29uZmlndXJhdGlvbiA9IHRoaXMuY29uZmlndXJhdGlvblxuICAgIGlmICghY29uZmlndXJhdGlvbikgdGhyb3cgbmV3IEVycm9yKFwiQmFja2dyb3VuZCBqb2JzIHdvcmtlciBjb25maWd1cmF0aW9uIG5vdCBpbml0aWFsaXplZFwiKVxuXG4gICAgY29uc3QgZGlyZWN0b3J5ID0gY29uZmlndXJhdGlvbi5nZXREaXJlY3RvcnkoKVxuICAgIHJldHVybiBmb3JrKEZPUktFRF9SVU5ORVJfRU5UUllfUEFUSCwgW10sIHtcbiAgICAgIGN3ZDogZGlyZWN0b3J5LFxuICAgICAgZXhlY0FyZ3Y6IFtdLFxuICAgICAgc3RkaW86IFtcImlnbm9yZVwiLCBcImlnbm9yZVwiLCBcImlnbm9yZVwiLCBcImlwY1wiXSxcbiAgICAgIGVudjogT2JqZWN0LmFzc2lnbih7fSwgcHJvY2Vzcy5lbnYsIHRoaXMuX2NoaWxkQmFja2dyb3VuZEpvYnNFbnZpcm9ubWVudCgpKVxuICAgIH0pXG4gIH1cblxuICAvKipcbiAgICogUnVucyB3YWl0IGZvciBmb3JrZWQgY2hpbGQuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gT3B0aW9ucy5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCJub2RlOmNoaWxkX3Byb2Nlc3NcIikuQ2hpbGRQcm9jZXNzfSBhcmdzLmNoaWxkIC0gRm9ya2VkIGNoaWxkIHByb2Nlc3MuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi90eXBlcy5qc1wiKS5CYWNrZ3JvdW5kSm9iUGF5bG9hZCAmIHtpZDogc3RyaW5nfX0gYXJncy5wYXlsb2FkIC0gUGF5bG9hZC5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgd2hlbiB0aGUgY2hpbGQgZXhpdHMuXG4gICAqL1xuICBfd2FpdEZvckZvcmtlZENoaWxkKHtjaGlsZCwgcGF5bG9hZH0pIHtcbiAgICBjb25zdCB0aW1lb3V0U3RhdGUgPSB0aGlzLl9hcm1Gb3JrZWRKb2JUaW1lb3V0KHtjaGlsZCwgcGF5bG9hZH0pXG5cbiAgICByZXR1cm4gbmV3IFByb21pc2UoKHJlc29sdmUpID0+IHtcbiAgICAgIGNoaWxkLm9uY2UoXCJleGl0XCIsIChjb2RlLCBzaWduYWwpID0+IHtcbiAgICAgICAgdGhpcy5fY2xlYXJGb3JrZWRKb2JUaW1lb3V0KHRpbWVvdXRTdGF0ZSlcbiAgICAgICAgdGhpcy5faGFuZGxlRm9ya2VkQ2hpbGRFeGl0KHtjaGlsZCwgY29kZSwgc2lnbmFsLCBwYXlsb2FkLCByZXNvbHZlLCB0aW1lb3V0U3RhdGV9KVxuICAgICAgfSlcbiAgICAgIGNoaWxkLm9uY2UoXCJlcnJvclwiLCAoZXJyb3IpID0+IHtcbiAgICAgICAgdGhpcy5fY2xlYXJGb3JrZWRKb2JUaW1lb3V0KHRpbWVvdXRTdGF0ZSlcbiAgICAgICAgdGhpcy5faGFuZGxlRm9ya2VkQ2hpbGRFcnJvcih7Y2hpbGQsIGVycm9yLCBwYXlsb2FkLCByZXNvbHZlfSlcbiAgICAgIH0pXG4gICAgfSlcbiAgfVxuXG4gIC8qKlxuICAgKiBBcm1zIGEgd2FsbC1jbG9jayBiYWNrc3RvcCBmb3IgYSBmb3JrZWQgam9iIHJ1bm5lci4gQSBmb3JrZWQgam9iIHN0aWxsXG4gICAqIHJ1bm5pbmcgYWZ0ZXIgYGpvYlRpbWVvdXRNc2AgaXMgdGVybWluYXRlZCAoU0lHVEVSTSwgdGhlbiBTSUdLSUxMIGFmdGVyIHRoZVxuICAgKiBncmFjZSkgc28gYSBzaW5nbGUgZ2VudWluZWx5LWh1bmcgcnVubmVyIGNhbid0IHBpbiBhIGRyYWluaW5nIHdvcmtlciDigJQgYW5kXG4gICAqIGl0cyBmdWxsLWFwcCBib290IGFuZCBkYXRhYmFzZSBjb25uZWN0aW9ucyDigJQgaW5kZWZpbml0ZWx5LiBSZXR1cm5zIGEgc3RhdGVcbiAgICogb2JqZWN0IHRoZSBleGl0L2Vycm9yIGhhbmRsZXJzIHVzZSB0byBjYW5jZWwgdGhlIHRpbWVyIGFuZCB0byByZXBvcnQgYVxuICAgKiB0aW1lb3V0LXNwZWNpZmljIGZhaWx1cmUuIFdoZW4gbm8gdGltZW91dCBpcyBjb25maWd1cmVkIHRoZSB0aW1lciBpcyBudWxsXG4gICAqIGFuZCBiZWhhdmlvciBpcyB1bmNoYW5nZWQuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gT3B0aW9ucy5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCJub2RlOmNoaWxkX3Byb2Nlc3NcIikuQ2hpbGRQcm9jZXNzfSBhcmdzLmNoaWxkIC0gRm9ya2VkIGNoaWxkIHByb2Nlc3MuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi90eXBlcy5qc1wiKS5CYWNrZ3JvdW5kSm9iUGF5bG9hZCAmIHtpZDogc3RyaW5nfX0gYXJncy5wYXlsb2FkIC0gSm9iIHBheWxvYWQuXG4gICAqIEByZXR1cm5zIHtGb3JrZWRKb2JUaW1lb3V0U3RhdGV9IC0gVGltZW91dCBzdGF0ZS5cbiAgICovXG4gIF9hcm1Gb3JrZWRKb2JUaW1lb3V0KHtjaGlsZCwgcGF5bG9hZH0pIHtcbiAgICBjb25zdCB0aW1lb3V0TXMgPSB0aGlzLl9yZXNvbHZlSm9iVGltZW91dE1zKHBheWxvYWQub3B0aW9ucylcbiAgICAvKiogQHR5cGUge0ZvcmtlZEpvYlRpbWVvdXRTdGF0ZX0gKi9cbiAgICBjb25zdCBzdGF0ZSA9IHt0aW1lZE91dDogZmFsc2UsIHRpbWVvdXRNcywgdGltZXI6IG51bGwsIHNpZ2tpbGxUaW1lcjogbnVsbH1cblxuICAgIGlmICghKHR5cGVvZiB0aW1lb3V0TXMgPT09IFwibnVtYmVyXCIgJiYgdGltZW91dE1zID4gMCkpIHJldHVybiBzdGF0ZVxuXG4gICAgc3RhdGUudGltZXIgPSBzZXRUaW1lb3V0KCgpID0+IHRoaXMuX29uRm9ya2VkSm9iVGltZW91dCh7Y2hpbGQsIHN0YXRlfSksIHRpbWVvdXRNcylcblxuICAgIHJldHVybiBzdGF0ZVxuICB9XG5cbiAgLyoqXG4gICAqIFJlc29sdmVzIHRoZSBlZmZlY3RpdmUgd2FsbC1jbG9jayBqb2IgdGltZW91dCBpbiBtcyAoc2hhcmVkIGJ5IGZvcmtlZCBhbmQgcG9vbGVkIGpvYnMpLCBvciBudWxsIHdoZW4gZGlzYWJsZWQuIFRoZVxuICAgKiBwZXItam9iIG92ZXJyaWRlIHdpbnMsIGZvbGxvd2VkIGJ5IHRoZSBjb25zdHJ1Y3RvciBvdmVycmlkZSwgdGhlbiB0aGUgdmFsdWVcbiAgICogZnJvbSB0aGUgYmFja2dyb3VuZC1qb2JzIGNvbmZpZ3VyYXRpb24uIEEgbm9uLXBvc2l0aXZlIHZhbHVlIGRpc2FibGVzIHRoZVxuICAgKiBiYWNrc3RvcCBhdCB3aGljaGV2ZXIgbGV2ZWwgc3VwcGxpZWQgaXQuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi90eXBlcy5qc1wiKS5CYWNrZ3JvdW5kSm9iT3B0aW9uc30gW2pvYk9wdGlvbnNdIC0gUGVyLWpvYiBvcHRpb25zLlxuICAgKiBAcmV0dXJucyB7bnVtYmVyIHwgbnVsbH0gLSBUaW1lb3V0IGluIG1zLCBvciBudWxsIHdoZW4gZGlzYWJsZWQuXG4gICAqL1xuICBfcmVzb2x2ZUpvYlRpbWVvdXRNcyhqb2JPcHRpb25zKSB7XG4gICAgY29uc3QgcmF3ID0gdHlwZW9mIGpvYk9wdGlvbnM/LnRpbWVvdXRNcyA9PT0gXCJudW1iZXJcIlxuICAgICAgPyBqb2JPcHRpb25zLnRpbWVvdXRNc1xuICAgICAgOiAodHlwZW9mIHRoaXMuam9iVGltZW91dE1zT3ZlcnJpZGUgPT09IFwibnVtYmVyXCJcbiAgICAgICAgICA/IHRoaXMuam9iVGltZW91dE1zT3ZlcnJpZGVcbiAgICAgICAgICA6ICh0aGlzLmNvbmZpZ3VyYXRpb24gPyB0aGlzLmNvbmZpZ3VyYXRpb24uZ2V0QmFja2dyb3VuZEpvYnNDb25maWcoKS5qb2JUaW1lb3V0TXMgOiBudWxsKSlcblxuICAgIC8vIEEgbm9uLWZpbml0ZSAoZS5nLiBJbmZpbml0eSkgb3Igbm9uLXBvc2l0aXZlIHZhbHVlIGRpc2FibGVzIHRoZSBiYWNrc3RvcDtcbiAgICAvLyBhIGZpbml0ZSB2YWx1ZSBiZXlvbmQgTm9kZSdzIHRpbWVyIHJhbmdlIGlzIGNsYW1wZWQgdG8gdGhlIG1heCByYXRoZXIgdGhhblxuICAgIC8vIHNpbGVudGx5IGNvZXJjZWQgdG8gfjFtcyAod2hpY2ggd291bGQga2lsbCBldmVyeSBmb3JrZWQgam9iIGltbWVkaWF0ZWx5KS5cbiAgICBpZiAodHlwZW9mIHJhdyAhPT0gXCJudW1iZXJcIiB8fCAhTnVtYmVyLmlzRmluaXRlKHJhdykgfHwgcmF3IDw9IDApIHJldHVybiBudWxsXG5cbiAgICByZXR1cm4gTWF0aC5taW4ocmF3LCBNQVhfRk9SS0VEX0pPQl9USU1FT1VUX01TKVxuICB9XG5cbiAgLyoqXG4gICAqIEZpcmVkIHdoZW4gYSBmb3JrZWQgcnVubmVyIG92ZXJydW5zIGl0cyB0aW1lb3V0LiBTZW5kcyBTSUdURVJNIGZvciBhIGNsZWFuXG4gICAqIHNodXRkb3duLCB0aGVuIFNJR0tJTEwgYWZ0ZXIgdGhlIGdyYWNlIGZvciBhIHJ1bm5lciB0aGF0IGlnbm9yZXMgaXQuIFRoZVxuICAgKiByZXN1bHRpbmcgbm9uLWNsZWFuIGV4aXQgZmxvd3MgdGhyb3VnaCBgX2hhbmRsZUZvcmtlZENoaWxkRXhpdGAsIHdoaWNoIGZyZWVzXG4gICAqIHRoZSBzbG90IGFuZCByZXBvcnRzIHRoZSBqb2IgZmFpbGVkLlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIE9wdGlvbnMuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwibm9kZTpjaGlsZF9wcm9jZXNzXCIpLkNoaWxkUHJvY2Vzc30gYXJncy5jaGlsZCAtIEZvcmtlZCBjaGlsZCBwcm9jZXNzLlxuICAgKiBAcGFyYW0ge0ZvcmtlZEpvYlRpbWVvdXRTdGF0ZX0gYXJncy5zdGF0ZSAtIFRpbWVvdXQgc3RhdGUuXG4gICAqIEByZXR1cm5zIHt2b2lkfVxuICAgKi9cbiAgX29uRm9ya2VkSm9iVGltZW91dCh7Y2hpbGQsIHN0YXRlfSkge1xuICAgIHN0YXRlLnRpbWVkT3V0ID0gdHJ1ZVxuXG4gICAgdHJ5IHtcbiAgICAgIGNoaWxkLmtpbGwoXCJTSUdURVJNXCIpXG4gICAgfSBjYXRjaCB7XG4gICAgICAvLyBDaGlsZCBhbHJlYWR5IGV4aXRlZDsgbm90aGluZyB0byBkby5cbiAgICB9XG5cbiAgICBzdGF0ZS5zaWdraWxsVGltZXIgPSBzZXRUaW1lb3V0KCgpID0+IHtcbiAgICAgIHRyeSB7XG4gICAgICAgIGNoaWxkLmtpbGwoXCJTSUdLSUxMXCIpXG4gICAgICB9IGNhdGNoIHtcbiAgICAgICAgLy8gQ2hpbGQgYWxyZWFkeSBleGl0ZWQ7IG5vdGhpbmcgdG8gZG8uXG4gICAgICB9XG4gICAgfSwgdGhpcy5mb3JrZWRDaGlsZFNpZ2tpbGxHcmFjZU1zKVxuICB9XG5cbiAgLyoqXG4gICAqIENhbmNlbHMgYW55IHBlbmRpbmcgdGltZW91dC9TSUdLSUxMIHRpbWVycyBmb3IgYSBmb3JrZWQgcnVubmVyIHRoYXQgaGFzXG4gICAqIGV4aXRlZCAob3IgZXJyb3JlZCkgc28gdGhleSBuZXZlciBmaXJlIGFnYWluc3QgYSBnb25lIG9yIHJldXNlZCBjaGlsZC5cbiAgICogQHBhcmFtIHtGb3JrZWRKb2JUaW1lb3V0U3RhdGV9IHN0YXRlIC0gVGltZW91dCBzdGF0ZS5cbiAgICogQHJldHVybnMge3ZvaWR9XG4gICAqL1xuICBfY2xlYXJGb3JrZWRKb2JUaW1lb3V0KHN0YXRlKSB7XG4gICAgaWYgKHN0YXRlLnRpbWVyKSB7XG4gICAgICBjbGVhclRpbWVvdXQoc3RhdGUudGltZXIpXG4gICAgICBzdGF0ZS50aW1lciA9IG51bGxcbiAgICB9XG5cbiAgICBpZiAoc3RhdGUuc2lna2lsbFRpbWVyKSB7XG4gICAgICBjbGVhclRpbWVvdXQoc3RhdGUuc2lna2lsbFRpbWVyKVxuICAgICAgc3RhdGUuc2lna2lsbFRpbWVyID0gbnVsbFxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGhhbmRsZSBmb3JrZWQgY2hpbGQgZXhpdC5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBPcHRpb25zLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIm5vZGU6Y2hpbGRfcHJvY2Vzc1wiKS5DaGlsZFByb2Nlc3N9IGFyZ3MuY2hpbGQgLSBGb3JrZWQgY2hpbGQgcHJvY2Vzcy5cbiAgICogQHBhcmFtIHtudW1iZXIgfCBudWxsfSBhcmdzLmNvZGUgLSBFeGl0IGNvZGUuXG4gICAqIEBwYXJhbSB7a2V5b2YgdHlwZW9mIGltcG9ydChcIm5vZGU6b3NcIikuY29uc3RhbnRzLnNpZ25hbHMgfCBudWxsfSBhcmdzLnNpZ25hbCAtIEV4aXQgc2lnbmFsLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vdHlwZXMuanNcIikuQmFja2dyb3VuZEpvYlBheWxvYWQgJiB7aWQ6IHN0cmluZ319IGFyZ3MucGF5bG9hZCAtIFBheWxvYWQuXG4gICAqIEBwYXJhbSB7KHZhbHVlOiB2b2lkKSA9PiB2b2lkfSBhcmdzLnJlc29sdmUgLSBQcm9taXNlIHJlc29sdmVyLlxuICAgKiBAcGFyYW0ge0ZvcmtlZEpvYlRpbWVvdXRTdGF0ZX0gW2FyZ3MudGltZW91dFN0YXRlXSAtIFRpbWVvdXQgc3RhdGUsIHdoZW4gdGhlIHJ1bm5lciBoYWQgYSB3YWxsLWNsb2NrIGJhY2tzdG9wLlxuICAgKiBAcmV0dXJucyB7dm9pZH1cbiAgICovXG4gIF9oYW5kbGVGb3JrZWRDaGlsZEV4aXQoe2NoaWxkLCBjb2RlLCBzaWduYWwsIHBheWxvYWQsIHJlc29sdmUsIHRpbWVvdXRTdGF0ZX0pIHtcbiAgICB0aGlzLmluZmxpZ2h0UHJvY2Vzc0NoaWxkcmVuLmRlbGV0ZShjaGlsZClcblxuICAgIC8vIEZyZWUgdGhlIHdvcmtlciBzbG90IGFzIHNvb24gYXMgdGhlIGNoaWxkIGlzIGdvbmUg4oCUIG5ldmVyIGdhdGUgaXQgb24gdGhlXG4gICAgLy8gZmFpbHVyZSByZXBvcnQuIEEgaHVuZy9zbG93IHJlcG9ydCBtdXN0IG5vdCBsZWFrIHRoZSBzbG90OyBlbm91Z2ggbGVha2VkXG4gICAgLy8gc2xvdHMgZHJpdmUgYGFjY2VwdHNGb3JrZWRgIHRvIGZhbHNlIGFuZCBzaWxlbnRseSB3ZWRnZSB0aGUgd29ya2VyLlxuICAgIHJlc29sdmUodW5kZWZpbmVkKVxuXG4gICAgaWYgKHRoaXMuX2ZvcmtlZENoaWxkRXhpdGVkQ2xlYW5seSh7Y29kZSwgc2lnbmFsfSkpIHJldHVyblxuXG4gICAgY29uc3QgZXJyb3IgPSB0aW1lb3V0U3RhdGU/LnRpbWVkT3V0XG4gICAgICA/IG5ldyBFcnJvcihgRm9ya2VkIGJhY2tncm91bmQgam9iIHJ1bm5lciB0aW1lZCBvdXQgYWZ0ZXIgJHt0aW1lb3V0U3RhdGUudGltZW91dE1zfW1zIGFuZCB3YXMgdGVybWluYXRlZDogY29kZT0ke2NvZGV9IHNpZ25hbD0ke3NpZ25hbCB8fCBcIm5vbmVcIn1gKVxuICAgICAgOiBuZXcgRXJyb3IoYEZvcmtlZCBiYWNrZ3JvdW5kIGpvYiBydW5uZXIgZXhpdGVkIGJlZm9yZSByZXBvcnRpbmc6IGNvZGU9JHtjb2RlfSBzaWduYWw9JHtzaWduYWwgfHwgXCJub25lXCJ9YClcblxuICAgIHRoaXMuX3JlcG9ydEZvcmtlZENoaWxkRmFpbHVyZSh7cGF5bG9hZCwgZXJyb3J9KVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZm9ya2VkIGNoaWxkIGV4aXRlZCBjbGVhbmx5LlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIE9wdGlvbnMuXG4gICAqIEBwYXJhbSB7bnVtYmVyIHwgbnVsbH0gYXJncy5jb2RlIC0gRXhpdCBjb2RlLlxuICAgKiBAcGFyYW0ge2tleW9mIHR5cGVvZiBpbXBvcnQoXCJub2RlOm9zXCIpLmNvbnN0YW50cy5zaWduYWxzIHwgbnVsbH0gYXJncy5zaWduYWwgLSBFeGl0IHNpZ25hbC5cbiAgICogQHJldHVybnMge2Jvb2xlYW59IC0gV2hldGhlciB0aGUgY2hpbGQgZXhpdGVkIGNsZWFubHkuXG4gICAqL1xuICBfZm9ya2VkQ2hpbGRFeGl0ZWRDbGVhbmx5KHtjb2RlLCBzaWduYWx9KSB7XG4gICAgcmV0dXJuIGNvZGUgPT09IDAgJiYgIXNpZ25hbFxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgaGFuZGxlIGZvcmtlZCBjaGlsZCBlcnJvci5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBPcHRpb25zLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIm5vZGU6Y2hpbGRfcHJvY2Vzc1wiKS5DaGlsZFByb2Nlc3N9IGFyZ3MuY2hpbGQgLSBGb3JrZWQgY2hpbGQgcHJvY2Vzcy5cbiAgICogQHBhcmFtIHtFcnJvcn0gYXJncy5lcnJvciAtIENoaWxkIHByb2Nlc3MgZXJyb3IuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi90eXBlcy5qc1wiKS5CYWNrZ3JvdW5kSm9iUGF5bG9hZCAmIHtpZDogc3RyaW5nfX0gYXJncy5wYXlsb2FkIC0gUGF5bG9hZC5cbiAgICogQHBhcmFtIHsodmFsdWU6IHZvaWQpID0+IHZvaWR9IGFyZ3MucmVzb2x2ZSAtIFByb21pc2UgcmVzb2x2ZXIuXG4gICAqIEByZXR1cm5zIHt2b2lkfVxuICAgKi9cbiAgX2hhbmRsZUZvcmtlZENoaWxkRXJyb3Ioe2NoaWxkLCBlcnJvciwgcGF5bG9hZCwgcmVzb2x2ZX0pIHtcbiAgICB0aGlzLmluZmxpZ2h0UHJvY2Vzc0NoaWxkcmVuLmRlbGV0ZShjaGlsZClcbiAgICAvLyBGcmVlIHRoZSBzbG90IGZpcnN0IChzZWUgX2hhbmRsZUZvcmtlZENoaWxkRXhpdCkg4oCUIHJlcG9ydGluZyBpcyBiZXN0LWVmZm9ydC5cbiAgICByZXNvbHZlKHVuZGVmaW5lZClcbiAgICBjb25zb2xlLmVycm9yKFwiQmFja2dyb3VuZCBqb2JzIGZvcmtlZCBydW5uZXIgZXJyb3I6XCIsIGVycm9yKVxuICAgIHRoaXMuX3JlcG9ydEZvcmtlZENoaWxkRmFpbHVyZSh7cGF5bG9hZCwgZXJyb3J9KVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgc2VuZCBmb3JrZWQgcGF5bG9hZC5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBPcHRpb25zLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIm5vZGU6Y2hpbGRfcHJvY2Vzc1wiKS5DaGlsZFByb2Nlc3N9IGFyZ3MuY2hpbGQgLSBGb3JrZWQgY2hpbGQgcHJvY2Vzcy5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL3R5cGVzLmpzXCIpLkJhY2tncm91bmRKb2JQYXlsb2FkICYge2lkOiBzdHJpbmd9fSBhcmdzLnBheWxvYWQgLSBQYXlsb2FkLlxuICAgKiBAcmV0dXJucyB7dm9pZH1cbiAgICovXG4gIF9zZW5kRm9ya2VkUGF5bG9hZCh7Y2hpbGQsIHBheWxvYWR9KSB7XG4gICAgdHJ5IHtcbiAgICAgIGNoaWxkLnNlbmQoe3R5cGU6IFwiam9iXCIsIHBheWxvYWR9KVxuICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICBjaGlsZC5raWxsKFwiU0lHVEVSTVwiKVxuICAgICAgdGhpcy5fcmVwb3J0Rm9ya2VkQ2hpbGRGYWlsdXJlKHtwYXlsb2FkLCBlcnJvcn0pXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgcmVwb3J0IGZvcmtlZCBjaGlsZCBmYWlsdXJlLlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIE9wdGlvbnMuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi90eXBlcy5qc1wiKS5CYWNrZ3JvdW5kSm9iUGF5bG9hZCAmIHtpZDogc3RyaW5nfX0gYXJncy5wYXlsb2FkIC0gUGF5bG9hZC5cbiAgICogQHBhcmFtIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gYXJncy5lcnJvciAtIEVycm9yLlxuICAgKiBAcmV0dXJucyB7dm9pZH1cbiAgICovXG4gIF9yZXBvcnRGb3JrZWRDaGlsZEZhaWx1cmUoe3BheWxvYWQsIGVycm9yfSkge1xuICAgIHRoaXMuX3JlcG9ydEpvYlJlc3VsdEluQmFja2dyb3VuZCh7XG4gICAgICBqb2JJZDogcGF5bG9hZC5pZCxcbiAgICAgIHN0YXR1czogXCJmYWlsZWRcIixcbiAgICAgIGVycm9yLFxuICAgICAgaGFuZG9mZklkOiBwYXlsb2FkLmhhbmRvZmZJZCxcbiAgICAgIGhhbmRlZE9mZkF0TXM6IHBheWxvYWQuaGFuZGVkT2ZmQXRNcyxcbiAgICAgIHdvcmtlcklkOiBwYXlsb2FkLndvcmtlcklkIHx8IHRoaXMud29ya2VySWRcbiAgICB9KVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgc3Bhd24gam9iLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vdHlwZXMuanNcIikuQmFja2dyb3VuZEpvYlBheWxvYWR9IHBheWxvYWQgLSBQYXlsb2FkLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyB3aGVuIHRoZSBzcGF3bmVkIHJ1bm5lciBleGl0cyBvciBzcGF3biBmYWlscy5cbiAgICovXG4gIF9zcGF3bkpvYihwYXlsb2FkKSB7XG4gICAgY29uc3QgY29uZmlndXJhdGlvbiA9IHRoaXMuY29uZmlndXJhdGlvblxuICAgIGlmICghY29uZmlndXJhdGlvbikgdGhyb3cgbmV3IEVycm9yKFwiQmFja2dyb3VuZCBqb2JzIHdvcmtlciBjb25maWd1cmF0aW9uIG5vdCBpbml0aWFsaXplZFwiKVxuXG4gICAgY29uc3QgZGlyZWN0b3J5ID0gY29uZmlndXJhdGlvbi5nZXREaXJlY3RvcnkoKVxuICAgIGNvbnN0IGFyZ3ZDb21tYW5kID0gcHJvY2Vzcy5hcmd2WzFdXG4gICAgY29uc3QgY29tbWFuZCA9IGFyZ3ZDb21tYW5kID8gYXJndkNvbW1hbmQgOiBgJHtkaXJlY3Rvcnl9L2Jpbi92ZWxvY2lvdXMuanNgXG4gICAgY29uc3QgZW5jb2RlZFBheWxvYWQgPSBCdWZmZXIuZnJvbShKU09OLnN0cmluZ2lmeShwYXlsb2FkKSkudG9TdHJpbmcoXCJiYXNlNjRcIilcbiAgICBjb25zdCBjaGlsZCA9IHNwYXduKHByb2Nlc3MuZXhlY1BhdGgsIFtjb21tYW5kLCBcImJhY2tncm91bmQtam9icy1ydW5uZXJcIl0sIHtcbiAgICAgIGN3ZDogZGlyZWN0b3J5LFxuICAgICAgZGV0YWNoZWQ6IHRydWUsXG4gICAgICBzdGRpbzogXCJpZ25vcmVcIixcbiAgICAgIGVudjogT2JqZWN0LmFzc2lnbih7fSwgcHJvY2Vzcy5lbnYsIHRoaXMuX2NoaWxkQmFja2dyb3VuZEpvYnNFbnZpcm9ubWVudCgpLCB7VkVMT0NJT1VTX0pPQl9QQVlMT0FEOiBlbmNvZGVkUGF5bG9hZH0pXG4gICAgfSlcblxuICAgIHRoaXMuaW5mbGlnaHRQcm9jZXNzQ2hpbGRyZW4uYWRkKGNoaWxkKVxuXG4gICAgY29uc3QgZmluaXNoZWQgPSBuZXcgUHJvbWlzZSgocmVzb2x2ZSkgPT4ge1xuICAgICAgY2hpbGQub25jZShcImV4aXRcIiwgKCkgPT4ge1xuICAgICAgICB0aGlzLmluZmxpZ2h0UHJvY2Vzc0NoaWxkcmVuLmRlbGV0ZShjaGlsZClcbiAgICAgICAgcmVzb2x2ZSh1bmRlZmluZWQpXG4gICAgICB9KVxuICAgICAgY2hpbGQub25jZShcImVycm9yXCIsIChlcnJvcikgPT4ge1xuICAgICAgICB0aGlzLmluZmxpZ2h0UHJvY2Vzc0NoaWxkcmVuLmRlbGV0ZShjaGlsZClcbiAgICAgICAgY29uc29sZS5lcnJvcihcIkJhY2tncm91bmQgam9icyBzcGF3bmVkIHJ1bm5lciBlcnJvcjpcIiwgZXJyb3IpXG4gICAgICAgIHJlc29sdmUodW5kZWZpbmVkKVxuICAgICAgfSlcbiAgICB9KVxuXG4gICAgY2hpbGQudW5yZWYoKVxuXG4gICAgcmV0dXJuIGZpbmlzaGVkXG4gIH1cblxuICAvKipcbiAgICogQnVpbGRzIHRoZSBleGFjdCBtYWluIGVuZHBvaW50IGFuZCBnZW5lcmF0aW9uIGluaGVyaXRlZCBieSBldmVyeSBjaGlsZC5cbiAgICogQHJldHVybnMge1JlY29yZDxzdHJpbmcsIHN0cmluZz59IC0gQ2hpbGQgcHJvY2VzcyBlbnZpcm9ubWVudCBhZGRpdGlvbnMuXG4gICAqL1xuICBfY2hpbGRCYWNrZ3JvdW5kSm9ic0Vudmlyb25tZW50KCkge1xuICAgIGNvbnN0IGNvbmZpZ3VyYXRpb24gPSB0aGlzLmNvbmZpZ3VyYXRpb25cbiAgICBpZiAoIWNvbmZpZ3VyYXRpb24pIHRocm93IG5ldyBFcnJvcihcIkJhY2tncm91bmQgam9icyB3b3JrZXIgY29uZmlndXJhdGlvbiBub3QgaW5pdGlhbGl6ZWRcIilcbiAgICBpZiAoIXRoaXMuaG9zdCB8fCB0eXBlb2YgdGhpcy5wb3J0ICE9PSBcIm51bWJlclwiKSB0aHJvdyBuZXcgRXJyb3IoXCJCYWNrZ3JvdW5kIGpvYnMgd29ya2VyIGVuZHBvaW50IG5vdCByZXNvbHZlZFwiKVxuXG4gICAgcmV0dXJuIHtcbiAgICAgIFZFTE9DSU9VU19CQUNLR1JPVU5EX0pPQl9DSElMRDogXCIxXCIsXG4gICAgICBWRUxPQ0lPVVNfRU5WOiBjb25maWd1cmF0aW9uLmdldEVudmlyb25tZW50KCksXG4gICAgICBWRUxPQ0lPVVNfQkFDS0dST1VORF9KT0JTX0hPU1Q6IHRoaXMuaG9zdCxcbiAgICAgIFZFTE9DSU9VU19CQUNLR1JPVU5EX0pPQlNfUE9SVDogYCR7dGhpcy5wb3J0fWAsXG4gICAgICAuLi4odGhpcy5nZW5lcmF0aW9uSWQgPyB7VkVMT0NJT1VTX0JBQ0tHUk9VTkRfSk9CU19HRU5FUkFUSU9OX0lEOiB0aGlzLmdlbmVyYXRpb25JZH0gOiB7fSlcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogUnVucyByZXBvcnQgam9iIHJlc3VsdC5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBPcHRpb25zLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gYXJncy5qb2JJZCAtIEpvYiBpZC5cbiAgICogQHBhcmFtIHtcImNvbXBsZXRlZFwiIHwgXCJmYWlsZWRcIiB8IFwicmVzY2hlZHVsZWRcIn0gYXJncy5zdGF0dXMgLSBTdGF0dXMuXG4gICAqIEBwYXJhbSB7bnVtYmVyfSBbYXJncy5kZWxheU1zXSAtIFJlc2NoZWR1bGUgZGVsYXkgaW4gbWlsbGlzZWNvbmRzLlxuICAgKiBAcGFyYW0ge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSBbYXJncy5lcnJvcl0gLSBFcnJvci5cbiAgICogQHBhcmFtIHtzdHJpbmd9IFthcmdzLmhhbmRvZmZJZF0gLSBIYW5kb2ZmIGxlYXNlIGlkLlxuICAgKiBAcGFyYW0ge251bWJlcn0gW2FyZ3MuaGFuZGVkT2ZmQXRNc10gLSBIYW5kZWQgb2ZmIHRpbWVzdGFtcC5cbiAgICogQHBhcmFtIHtzdHJpbmd9IFthcmdzLndvcmtlcklkXSAtIFdvcmtlciBpZC5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL3R5cGVzLmpzXCIpLlBvb2xlZFJ1bm5lckZhaWx1cmV9IFthcmdzLnJ1bm5lckZhaWx1cmVdIC0gUG9vbGVkLWNoaWxkIHByb2Nlc3MgZmFpbHVyZSBwcm92ZW5hbmNlLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyB3aGVuIHJlcG9ydGVkLlxuICAgKi9cbiAgYXN5bmMgX3JlcG9ydEpvYlJlc3VsdCh7am9iSWQsIHN0YXR1cywgZGVsYXlNcywgZXJyb3IsIGhhbmRvZmZJZCwgaGFuZGVkT2ZmQXRNcywgd29ya2VySWQsIHJ1bm5lckZhaWx1cmV9KSB7XG4gICAgaWYgKCF0aGlzLnN0YXR1c1JlcG9ydGVyKSByZXR1cm5cblxuICAgIHRyeSB7XG4gICAgICAvLyBSZXRyeSBhIHRyYW5zaWVudCBwZXJzaXN0IGZhaWx1cmUgKGBqb2ItdXBkYXRlLWVycm9yYCk6IHRoZSB3b3JrZXIgaXNcbiAgICAgIC8vIGxvbmctbGl2ZWQgYW5kIGNhbm5vdCBleGl0IHRvIHRyaWdnZXIgb3JwaGFuIHJlY2xhaW0sIHNvIGRyb3BwaW5nIHRoZVxuICAgICAgLy8gY29tcGxldGlvbiBoZXJlIHdvdWxkIHN0cmFuZCB0aGUgam9iIGluIGBoYW5kZWRfb2ZmYCBmb3JldmVyIOKAlCBmYXRhbCBmb3IgYVxuICAgICAgLy8gYG1heF9jb25jdXJyZW5jeTogMWAgam9iIChhIHN0cmFuZGVkIHJvdyBibG9ja3MgZXZlcnkgZnV0dXJlIHJ1bikuXG4gICAgICBhd2FpdCB0aGlzLnN0YXR1c1JlcG9ydGVyLnJlcG9ydFdpdGhSZXRyeSh7am9iSWQsIHN0YXR1cywgZGVsYXlNcywgZXJyb3IsIGhhbmRvZmZJZCwgaGFuZGVkT2ZmQXRNcywgd29ya2VySWQsIHJ1bm5lckZhaWx1cmUsIHJldHJ5UGVyc2lzdEVycm9yczogdHJ1ZX0pXG4gICAgfSBjYXRjaCAocmVwb3J0RXJyb3IpIHtcbiAgICAgIGNvbnNvbGUuZXJyb3IoXCJCYWNrZ3JvdW5kIGpvYiBzdGF0dXMgcmVwb3J0aW5nIGZhaWxlZDpcIiwgcmVwb3J0RXJyb3IpXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIEZpcmVzIGEgZHVyYWJsZSBqb2ItcmVzdWx0IHJlcG9ydCB3aXRob3V0IGJsb2NraW5nIHRoZSBjYWxsZXIgKHNvIGZyZWVpbmcgYVxuICAgKiBqb2IvY2hpbGQgc2xvdCBuZXZlciB3YWl0cyBvbiB0aGUgcmVwb3J0KS4gVGhlIHJlcG9ydCBpcyB0cmFja2VkIHNvIGFcbiAgICogZ3JhY2VmdWwgYHN0b3AoKWAgY2FuIGRyYWluIGluLWZsaWdodCByZXBvcnRzIGJlZm9yZSBjbG9zaW5nIHRoZSBzb2NrZXQuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gT3B0aW9ucy5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGFyZ3Muam9iSWQgLSBKb2IgaWQuXG4gICAqIEBwYXJhbSB7XCJjb21wbGV0ZWRcIiB8IFwiZmFpbGVkXCIgfCBcInJlc2NoZWR1bGVkXCJ9IGFyZ3Muc3RhdHVzIC0gU3RhdHVzLlxuICAgKiBAcGFyYW0ge251bWJlcn0gW2FyZ3MuZGVsYXlNc10gLSBSZXNjaGVkdWxlIGRlbGF5IGluIG1pbGxpc2Vjb25kcy5cbiAgICogQHBhcmFtIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gW2FyZ3MuZXJyb3JdIC0gRXJyb3IuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBbYXJncy5oYW5kb2ZmSWRdIC0gSGFuZG9mZiBsZWFzZSBpZC5cbiAgICogQHBhcmFtIHtudW1iZXJ9IFthcmdzLmhhbmRlZE9mZkF0TXNdIC0gSGFuZGVkIG9mZiB0aW1lc3RhbXAuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBbYXJncy53b3JrZXJJZF0gLSBXb3JrZXIgaWQuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi90eXBlcy5qc1wiKS5Qb29sZWRSdW5uZXJGYWlsdXJlfSBbYXJncy5ydW5uZXJGYWlsdXJlXSAtIFBvb2xlZC1jaGlsZCBwcm9jZXNzIGZhaWx1cmUgcHJvdmVuYW5jZS5cbiAgICogQHJldHVybnMge3ZvaWR9XG4gICAqL1xuICBfcmVwb3J0Sm9iUmVzdWx0SW5CYWNrZ3JvdW5kKHtqb2JJZCwgc3RhdHVzLCBkZWxheU1zLCBlcnJvciwgaGFuZG9mZklkLCBoYW5kZWRPZmZBdE1zLCB3b3JrZXJJZCwgcnVubmVyRmFpbHVyZX0pIHtcbiAgICAvKipcbiAgICAgKiBEZWZpbmVzIHJlcG9ydC5cbiAgICAgKiBAdHlwZSB7UHJvbWlzZTx2b2lkPn0gKi9cbiAgICBsZXQgcmVwb3J0XG5cbiAgICByZXBvcnQgPSB0aGlzLl9yZXBvcnRKb2JSZXN1bHQoe2pvYklkLCBzdGF0dXMsIGRlbGF5TXMsIGVycm9yLCBoYW5kb2ZmSWQsIGhhbmRlZE9mZkF0TXMsIHdvcmtlcklkLCBydW5uZXJGYWlsdXJlfSkuZmluYWxseSgoKSA9PiB7XG4gICAgICB0aGlzLmluZmxpZ2h0UmVwb3J0cy5kZWxldGUocmVwb3J0KVxuICAgIH0pXG5cbiAgICB0aGlzLmluZmxpZ2h0UmVwb3J0cy5hZGQocmVwb3J0KVxuICB9XG59XG4iXX0=