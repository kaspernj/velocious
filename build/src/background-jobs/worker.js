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
        const record = /** @type {{type?: ReturnType<typeof JSON.parse>, childInstanceId?: ReturnType<typeof JSON.parse>, jobId?: ReturnType<typeof JSON.parse>, acknowledged?: ReturnType<typeof JSON.parse>, rssBytes?: ReturnType<typeof JSON.parse>, peakRssBytes?: ReturnType<typeof JSON.parse>, error?: ReturnType<typeof JSON.parse>}} */ (message);
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
        // The child's peak RSS (VmHWM) is monotonic and outlives the settled
        // sample: a ratcheted burst working-set must recycle the child even when
        // settled RSS at outcome time looks modest. A child without peak support
        // falls back to the settled sample.
        const peakRssBytes = typeof record.peakRssBytes === "number" ? record.peakRssBytes : rssBytes;
        const runnerAgeMs = Date.now() - state.createdAtMs;
        if (!state.retiring && (state.jobsRun >= this.pooledRunnerMaxJobs || peakRssBytes >= this.pooledRunnerMaxRssBytes || runnerAgeMs >= this.pooledRunnerMaxLifetimeMs || this.shouldStop)) {
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
            peakRssMb: Math.round((typeof message.peakRssBytes === "number" ? message.peakRssBytes : message.rssBytes) / (1024 * 1024)),
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoid29ya2VyLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiLi4vLi4vLi4vc3JjL2JhY2tncm91bmQtam9icy93b3JrZXIuanMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6IkFBQUEsWUFBWTtBQUVaLE9BQU8sR0FBRyxNQUFNLEtBQUssQ0FBQTtBQUNyQixPQUFPLEVBQUUsSUFBSSxFQUFFLEtBQUssRUFBRSxNQUFNLG9CQUFvQixDQUFBO0FBQ2hELE9BQU8sVUFBVSxNQUFNLGtCQUFrQixDQUFBO0FBQ3pDLE9BQU8scUJBQXFCLE1BQU0sbUJBQW1CLENBQUE7QUFDckQsT0FBTyxxQkFBcUIsTUFBTSw4QkFBOEIsQ0FBQTtBQUNoRSxPQUFPLDRCQUE0QixNQUFNLHNCQUFzQixDQUFBO0FBQy9ELE9BQU8sRUFBRSxVQUFVLEVBQUUsTUFBTSxRQUFRLENBQUE7QUFDbkMsT0FBTyxFQUFFLGFBQWEsRUFBRSxNQUFNLFVBQVUsQ0FBQTtBQUN4QyxPQUFPLGlCQUFpQixFQUFFLEVBQUUsZ0JBQWdCLEVBQUUsTUFBTSxnQ0FBZ0MsQ0FBQTtBQUNwRixPQUFPLDZCQUE2QixNQUFNLHdCQUF3QixDQUFBO0FBQ2xFLE9BQU8sb0JBQW9CLE1BQU0sa0JBQWtCLENBQUE7QUFDbkQsT0FBTyxFQUFFLDJCQUEyQixFQUFFLE1BQU0sd0JBQXdCLENBQUE7QUFDcEUsT0FBTyxFQUFFLHdCQUF3QixFQUFFLE1BQU0sMEJBQTBCLENBQUE7QUFDbkUsT0FBTyw2Q0FBNkMsRUFBRSxFQUFFLHVDQUF1QyxFQUFFLG9DQUFvQyxFQUFFLE1BQU0seUNBQXlDLENBQUE7QUFDdEwsT0FBTyxFQUFFLG1DQUFtQyxFQUFFLGlDQUFpQyxFQUFFLDJCQUEyQixFQUFFLDJCQUEyQixFQUFFLE1BQU0sNkJBQTZCLENBQUE7QUFFOUs7Ozs7Ozs7R0FPRztBQUNIOzs7Ozs7R0FNRztBQUNIOzs7Ozs7Ozs7Ozs7Ozs7Ozs7O0dBbUJHO0FBQ0gsaUZBQWlGO0FBQ2pGLE1BQU0sNkJBQTZCLEdBQUcs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a1xuXG5pbXBvcnQgbmV0IGZyb20gXCJuZXRcIlxuaW1wb3J0IHsgZm9yaywgc3Bhd24gfSBmcm9tIFwibm9kZTpjaGlsZF9wcm9jZXNzXCJcbmltcG9ydCBKc29uU29ja2V0IGZyb20gXCIuL2pzb24tc29ja2V0LmpzXCJcbmltcG9ydCBCYWNrZ3JvdW5kSm9iUmVnaXN0cnkgZnJvbSBcIi4vam9iLXJlZ2lzdHJ5LmpzXCJcbmltcG9ydCBjb25maWd1cmF0aW9uUmVzb2x2ZXIgZnJvbSBcIi4uL2NvbmZpZ3VyYXRpb24tcmVzb2x2ZXIuanNcIlxuaW1wb3J0IEJhY2tncm91bmRKb2JzU3RhdHVzUmVwb3J0ZXIgZnJvbSBcIi4vc3RhdHVzLXJlcG9ydGVyLmpzXCJcbmltcG9ydCB7IHJhbmRvbVVVSUQgfSBmcm9tIFwiY3J5cHRvXCJcbmltcG9ydCB7IGZpbGVVUkxUb1BhdGggfSBmcm9tIFwibm9kZTp1cmxcIlxuaW1wb3J0IHNodXRkb3duTGlmZWN5Y2xlLCB7IHJ1blNodXRkb3duU3RlcHMgfSBmcm9tIFwiLi4vdXRpbHMvc2h1dGRvd24tbGlmZWN5Y2xlLmpzXCJcbmltcG9ydCBCYWNrZ3JvdW5kSm9iUmVzY2hlZHVsZVNpZ25hbCBmcm9tIFwiLi9yZXNjaGVkdWxlLXNpZ25hbC5qc1wiXG5pbXBvcnQgcGVyZm9ybUJhY2tncm91bmRKb2IgZnJvbSBcIi4vcGVyZm9ybS1qb2IuanNcIlxuaW1wb3J0IHsgcnVuV2l0aEJhY2tncm91bmRKb2JQYXlsb2FkIH0gZnJvbSBcIi4vZXhlY3V0aW9uLWNvbnRleHQuanNcIlxuaW1wb3J0IHsgY3JlYXRlR2VuZXJhdGlvbldvcmtlcklkIH0gZnJvbSBcIi4vZ2VuZXJhdGlvbi1pZGVudGl0eS5qc1wiXG5pbXBvcnQgQmFja2dyb3VuZEpvYnNHZW5lcmF0aW9uSGFuZHNoYWtlVGltZW91dEVycm9yLCB7IERFRkFVTFRfR0VORVJBVElPTl9IQU5EU0hBS0VfVElNRU9VVF9NUywgdmFsaWRhdGVHZW5lcmF0aW9uSGFuZHNoYWtlVGltZW91dE1zIH0gZnJvbSBcIi4vZ2VuZXJhdGlvbi1oYW5kc2hha2UtdGltZW91dC1lcnJvci5qc1wiXG5pbXBvcnQgeyBQT09MRURfUlVOTkVSX0lORkxJR0hUX0pPQl9JRF9MSU1JVCwgYm91bmRlZFBvb2xlZFJ1bm5lckluZmxpZ2h0Sm9iSWRzLCBpc1Bvb2xlZENoaWxkU2h1dGRvd25SZWFzb24sIGlzUG9vbGVkQ2hpbGRTaHV0ZG93blNpZ25hbCB9IGZyb20gXCIuL3Bvb2xlZC1ydW5uZXItc2h1dGRvd24uanNcIlxuXG4vKipcbiAqIFBlci1mb3JrZWQtY2hpbGQgdGltZW91dCBib29ra2VlcGluZy5cbiAqIEB0eXBlZGVmIHtvYmplY3R9IEZvcmtlZEpvYlRpbWVvdXRTdGF0ZVxuICogQHByb3BlcnR5IHtib29sZWFufSB0aW1lZE91dCAtIFdoZXRoZXIgdGhlIHRpbWVvdXQgZmlyZWQgYW5kIHRoZSBjaGlsZCB3YXMgdGVybWluYXRlZC5cbiAqIEBwcm9wZXJ0eSB7bnVtYmVyIHwgbnVsbH0gdGltZW91dE1zIC0gVGhlIGFybWVkIHRpbWVvdXQgaW4gbXMsIG9yIG51bGwgd2hlbiBkaXNhYmxlZC5cbiAqIEBwcm9wZXJ0eSB7UmV0dXJuVHlwZTx0eXBlb2Ygc2V0VGltZW91dD4gfCBudWxsfSB0aW1lciAtIFRoZSBwZW5kaW5nIHRpbWVvdXQgdGltZXIsIGNsZWFyZWQgb24gZXhpdC5cbiAqIEBwcm9wZXJ0eSB7UmV0dXJuVHlwZTx0eXBlb2Ygc2V0VGltZW91dD4gfCBudWxsfSBzaWdraWxsVGltZXIgLSBUaGUgcGVuZGluZyBTSUdLSUxMIGdyYWNlIHRpbWVyLCBjbGVhcmVkIG9uIGV4aXQuXG4gKi9cbi8qKlxuICogQHR5cGVkZWYge29iamVjdH0gUG9vbGVkSm9iRW50cnlcbiAqIEBwcm9wZXJ0eSB7aW1wb3J0KFwiLi90eXBlcy5qc1wiKS5CYWNrZ3JvdW5kSm9iUGF5bG9hZCAmIHtpZDogc3RyaW5nfX0gcGF5bG9hZCAtIER1cmFibGUgam9iIHBheWxvYWQuXG4gKiBAcHJvcGVydHkgeyh2YWx1ZTogdm9pZCkgPT4gdm9pZH0gW3Jlc29sdmVdIC0gQ29tcGxldGlvbiByZXNvbHZlci5cbiAqIEBwcm9wZXJ0eSB7UHJvbWlzZTx2b2lkPn0gW3Bvb2xlZEpvYl0gLSBUcmFja2VkIHBvb2xlZC1qb2IgcHJvbWlzZS5cbiAqIEBwcm9wZXJ0eSB7UmV0dXJuVHlwZTx0eXBlb2Ygc2V0VGltZW91dD4gfCBudWxsfSBbdGltZW91dFRpbWVyXSAtIFBlci1qb2IgdGltZW91dCB0aW1lci5cbiAqL1xuLyoqXG4gKiBAdHlwZWRlZiB7b2JqZWN0fSBQb29sZWRDaGlsZFN0YXRlXG4gKiBAcHJvcGVydHkge251bWJlcn0gY3JlYXRlZEF0TXMgLSBDaGlsZCBjcmVhdGlvbiB0aW1lc3RhbXAuXG4gKiBAcHJvcGVydHkge3N0cmluZ30gW2NoaWxkSW5zdGFuY2VJZF0gLSBTdGFibGUgaWRlbnRpdHkgcmVwb3J0ZWQgYnkgdGhlIGNoaWxkLlxuICogQHByb3BlcnR5IHtudW1iZXJ9IGpvYnNSdW4gLSBBY2tub3dsZWRnZWQgam9icyBjb21wbGV0ZWQgYnkgdGhpcyBjaGlsZC5cbiAqIEBwcm9wZXJ0eSB7TWFwPHN0cmluZywgUG9vbGVkSm9iRW50cnk+fSBpbmZsaWdodCAtIEpvYnMgY3VycmVudGx5IG93bmVkIGJ5IHRoaXMgY2hpbGQuXG4gKiBAcHJvcGVydHkge251bWJlcn0gbGFzdERpc3BhdGNoU2VxIC0gUm91bmQtcm9iaW4gZGlzcGF0Y2ggc2VxdWVuY2UuXG4gKiBAcHJvcGVydHkge2Jvb2xlYW59IHJldGlyaW5nIC0gV2hldGhlciB0aGlzIGNoaWxkIGlzIGRyYWluaW5nIGJlZm9yZSByZXRpcmVtZW50LlxuICogQHByb3BlcnR5IHtib29sZWFufSBbc3RhcnRlZF0gLSBXaGV0aGVyIHRoZSBjaGlsZCBjb21wbGV0ZWQgaXRzIHN0YXJ0dXAgaGFuZHNoYWtlLlxuICogQHByb3BlcnR5IHtib29sZWFufSBbc2V0dGxpbmddIC0gV2hldGhlciBmYWlsdXJlIGhhbmRsaW5nIGFscmVhZHkgb3ducyB0aGlzIGNoaWxkLlxuICogQHByb3BlcnR5IHtpbXBvcnQoXCIuL3R5cGVzLmpzXCIpLlBvb2xlZENoaWxkTWVtb3J5T2JzZXJ2YXRpb259IFtsYXN0TWVtb3J5T2JzZXJ2YXRpb25dIC0gTGF0ZXN0IG1lbW9yeSBvYnNlcnZhdGlvbiByZWNlaXZlZCBmcm9tIHRoaXMgY2hpbGQuXG4gKiBAcHJvcGVydHkge251bWJlcn0gW2lwY0Rpc2Nvbm5lY3RlZEF0TXNdIC0gUGFyZW50IG9ic2VydmF0aW9uIG9mIElQQyBkaXNjb25uZWN0LlxuICogQHByb3BlcnR5IHtpbXBvcnQoXCIuL3R5cGVzLmpzXCIpLlBvb2xlZENoaWxkU2h1dGRvd25PYnNlcnZhdGlvbn0gW3NodXRkb3duT2JzZXJ2YXRpb25dIC0gQ2hpbGQgb2JzZXJ2YXRpb24gc2VudCBiZWZvcmUgdGVhcmRvd24uXG4gKiBAcHJvcGVydHkge2ltcG9ydChcIi4vdHlwZXMuanNcIikuUG9vbGVkQ2hpbGRTaHV0ZG93blJlYXNvbn0gW3NodXRkb3duUmVhc29uXSAtIEV4YWN0IHBhcmVudC1yZXF1ZXN0ZWQgc2h1dGRvd24gcmVhc29uLlxuICogQHByb3BlcnR5IHtudW1iZXJ9IFtzaHV0ZG93blJlcXVlc3RlZEF0TXNdIC0gRXhhY3QgcGFyZW50IHNodXRkb3duLXJlcXVlc3QgdGltZXN0YW1wLlxuICogQHByb3BlcnR5IHtpbXBvcnQoXCJub2RlOmNoaWxkX3Byb2Nlc3NcIikuQ2hpbGRQcm9jZXNzW1wic2lnbmFsQ29kZVwiXX0gW3NodXRkb3duU2lnbmFsXSAtIFNpZ25hbCBzZWxlY3RlZCBieSB0aGUgcGFyZW50IHJlcXVlc3QuXG4gKiBAcHJvcGVydHkge1JldHVyblR5cGU8dHlwZW9mIHNldFRpbWVvdXQ+fSBbc2h1dGRvd25TaWduYWxUaW1lcl0gLSBEcmFpbmVkLXJldGlyZW1lbnQgZmFsbGJhY2sgc2lnbmFsIHRpbWVyLlxuICogQHByb3BlcnR5IHtSZXR1cm5UeXBlPHR5cGVvZiBzZXRUaW1lb3V0PiB8IG51bGx9IFt0aW1lb3V0U2lna2lsbFRpbWVyXSAtIFBlbmRpbmcgdGltZW91dCBTSUdLSUxMIHRpbWVyLlxuICogQHByb3BlcnR5IHtzdHJpbmd9IFt0aW1lb3V0Sm9iSWRdIC0gSm9iIHdob3NlIHRpbWVvdXQgaW5pdGlhdGVkIHRlcm1pbmF0aW9uLlxuICovXG4vKiogR3JhY2UgcGVyaW9kIGFmdGVyIFNJR1RFUk0gYmVmb3JlIGEgbGluZ2VyaW5nIHByb2Nlc3MgcnVubmVyIGlzIFNJR0tJTExlZC4gKi9cbmNvbnN0IEZPUktFRF9DSElMRF9TSUdLSUxMX0dSQUNFX01TID0gNTAwMFxuLyoqIFRpbWUgYSBkcmFpbmVkIHJldGlyZW1lbnQgZ2l2ZXMgdGhlIGNoaWxkIElQQyByZXF1ZXN0IHRvIGJlZ2luIHRlYXJkb3duIGJlZm9yZSBTSUdURVJNIGZhbGxiYWNrLiAqL1xuY29uc3QgUE9PTEVEX1JVTk5FUl9TSFVURE9XTl9SRVFVRVNUX0dSQUNFX01TID0gMjUwXG4vKipcbiAqIExhcmdlc3QgZGVsYXkgTm9kZSdzIGBzZXRUaW1lb3V0YCBhY2NlcHRzIHdpdGhvdXQgb3ZlcmZsb3dpbmcgdG8gYSAxbXMgZGVsYXlcbiAqIChhIDMyLWJpdCBzaWduZWQgaW50IG9mIG1zLCB+MjQuOCBkYXlzKS4gQSBgam9iVGltZW91dE1zYCBhYm92ZSB0aGlzIOKAlCBvciBhXG4gKiBub24tZmluaXRlIG9uZSBsaWtlIGBJbmZpbml0eWAg4oCUIGlzIGNsYW1wZWQvZGlzYWJsZWQgcmF0aGVyIHRoYW4gY29lcmNlZCB0b1xuICogfjFtcywgd2hpY2ggd291bGQgb3RoZXJ3aXNlIHRlcm1pbmF0ZSBldmVyeSBmb3JrZWQgam9iIGFsbW9zdCBpbW1lZGlhdGVseS5cbiAqL1xuY29uc3QgTUFYX0ZPUktFRF9KT0JfVElNRU9VVF9NUyA9IDJfMTQ3XzQ4M182NDdcbmNvbnN0IEZPUktFRF9SVU5ORVJfRU5UUllfUEFUSCA9IGZpbGVVUkxUb1BhdGgobmV3IFVSTChcIi4vZm9ya2VkLXJ1bm5lci1jaGlsZC5qc1wiLCBpbXBvcnQubWV0YS51cmwpKVxuY29uc3QgUE9PTEVEX1JVTk5FUl9FTlRSWV9QQVRIID0gZmlsZVVSTFRvUGF0aChuZXcgVVJMKFwiLi9wb29sZWQtcnVubmVyLWNoaWxkLmpzXCIsIGltcG9ydC5tZXRhLnVybCkpXG4vKiogSG93IG9mdGVuIHRoZSB3b3JrZXIgc2VuZHMgYSBsaXZlbmVzcyBoZWFydGJlYXQgdG8gdGhlIG1haW4uICovXG5jb25zdCBIRUFSVEJFQVRfSU5URVJWQUxfTVMgPSAxNTAwMFxuLyoqXG4gKiBNYXggdGltZSB0aGUgd29ya2VyIHNwZW5kcyByZXRyeWluZyBvbmUgcG9vbGVkIGNoaWxkJ3MgYWNjZXB0YW5jZSByZXBvcnRcbiAqIGJlZm9yZSBkcm9wcGluZyBpdC4gQWNjZXB0YW5jZSBldmlkZW5jZSBpcyBkaWFnbm9zdGljIOKAlCBhIHBlcnNpc3RlbnRcbiAqIG1haW4vREIgb3V0YWdlIG11c3Qgbm90IGhvbGQgcnVubmVyIGNhcGFjaXR5IGhvc3RhZ2UuXG4gKi9cbmNvbnN0IENISUxEX0FDQ0VQVEFOQ0VfUkVQT1JUX01BWF9EVVJBVElPTl9NUyA9IDEwMDAwXG4vKiogVENQIGtlZXBhbGl2ZSBzbyBhIGhhbGYtb3BlbiBjb25uZWN0aW9uIHRvIHRoZSBtYWluIHN1cmZhY2VzIGFzIGEgY2xvc2UuICovXG5jb25zdCBTT0NLRVRfS0VFUEFMSVZFX01TID0gMTAwMDBcbi8qKlxuICogRXhlY3V0aW9uIG1vZGVzLlxuICogQHR5cGUge2ltcG9ydChcIi4vdHlwZXMuanNcIikuQmFja2dyb3VuZEpvYkV4ZWN1dGlvbk1vZGVbXX0gKi9cbmNvbnN0IEVYRUNVVElPTl9NT0RFUyA9IFtcImlubGluZVwiLCBcImZvcmtlZFwiLCBcInBvb2xlZFwiLCBcInNwYXduZWRcIl1cblxuLyoqXG4gKiBOb3JtYWxpemVzIGEgY2FuZGlkYXRlIHBvb2xlZC1ydW5uZXIgY291bnQgb3Igam9iIGxpbWl0LlxuICogQHBhcmFtIHtudW1iZXIgfCB1bmRlZmluZWR9IHZhbHVlIC0gQ2FuZGlkYXRlIHBvc2l0aXZlIGludGVnZXIuXG4gKiBAcmV0dXJucyB7bnVtYmVyIHwgdW5kZWZpbmVkfSAtIE5vcm1hbGl6ZWQgdmFsdWUuXG4gKi9cbmZ1bmN0aW9uIHBvc2l0aXZlSW50ZWdlcih2YWx1ZSkge1xuICByZXR1cm4gdHlwZW9mIHZhbHVlID09PSBcIm51bWJlclwiICYmIE51bWJlci5pc0ludGVnZXIodmFsdWUpICYmIHZhbHVlID4gMCA/IHZhbHVlIDogdW5kZWZpbmVkXG59XG5cbi8qKlxuICogQ2hlY2tzIHdoZXRoZXIgYW4gSVBDIHZhbHVlIGlzIGEgcG9vbGVkIGNoaWxkJ3MgYWNjZXB0YW5jZSBvYnNlcnZhdGlvbiBmb3JcbiAqIG9uZSBqb2IuIFRoZSBjaGlsZCBjYXJyaWVzIGl0cyBleGFjdCBoYW5kb2ZmIGxlYXNlIHNvIHRoZSB3b3JrZXIgY2FuIGZvcndhcmRcbiAqIHRoZSByZXBvcnQgd2l0aG91dCBkZXBlbmRpbmcgb24gaXRzIGluLWZsaWdodCBlbnRyeSBzdGlsbCBleGlzdGluZy5cbiAqIEBwYXJhbSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59IG1lc3NhZ2UgLSBJUEMgbWVzc2FnZS5cbiAqIEByZXR1cm5zIHttZXNzYWdlIGlzIHt0eXBlOiBcImpvYi1yZWNlaXZlZFwiIHwgXCJqb2Itc3RhcnRlZFwiLCBqb2JJZDogc3RyaW5nLCBoYW5kb2ZmSWQ/OiBzdHJpbmcsIHdvcmtlcklkPzogc3RyaW5nLCBoYW5kZWRPZmZBdE1zPzogbnVtYmVyLCByZWNlaXZlZEF0TXM/OiBudW1iZXIsIHN0YXJ0ZWRBdE1zPzogbnVtYmVyLCBjaGlsZEluc3RhbmNlSWQ/OiBzdHJpbmcsIGNoaWxkUGlkPzogbnVtYmVyfX0gLSBXaGV0aGVyIHRoaXMgaXMgYSB2YWxpZCBhY2NlcHRhbmNlIG1lc3NhZ2UuXG4gKi9cbmZ1bmN0aW9uIGlzQ2hpbGRBY2NlcHRhbmNlTWVzc2FnZShtZXNzYWdlKSB7XG4gIGlmICghbWVzc2FnZSB8fCB0eXBlb2YgbWVzc2FnZSAhPT0gXCJvYmplY3RcIikgcmV0dXJuIGZhbHNlXG4gIGNvbnN0IHJlY29yZCA9IC8qKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSAqLyAobWVzc2FnZSlcblxuICByZXR1cm4gKHJlY29yZC50eXBlID09PSBcImpvYi1yZWNlaXZlZFwiIHx8IHJlY29yZC50eXBlID09PSBcImpvYi1zdGFydGVkXCIpXG4gICAgJiYgdHlwZW9mIHJlY29yZC5qb2JJZCA9PT0gXCJzdHJpbmdcIlxuICAgICYmIChyZWNvcmQuaGFuZG9mZklkID09PSB1bmRlZmluZWQgfHwgdHlwZW9mIHJlY29yZC5oYW5kb2ZmSWQgPT09IFwic3RyaW5nXCIpXG4gICAgJiYgKHJlY29yZC53b3JrZXJJZCA9PT0gdW5kZWZpbmVkIHx8IHR5cGVvZiByZWNvcmQud29ya2VySWQgPT09IFwic3RyaW5nXCIpXG4gICAgJiYgKHJlY29yZC5oYW5kZWRPZmZBdE1zID09PSB1bmRlZmluZWQgfHwgdHlwZW9mIHJlY29yZC5oYW5kZWRPZmZBdE1zID09PSBcIm51bWJlclwiKVxuICAgICYmIChyZWNvcmQucmVjZWl2ZWRBdE1zID09PSB1bmRlZmluZWQgfHwgdHlwZW9mIHJlY29yZC5yZWNlaXZlZEF0TXMgPT09IFwibnVtYmVyXCIpXG4gICAgJiYgKHJlY29yZC5zdGFydGVkQXRNcyA9PT0gdW5kZWZpbmVkIHx8IHR5cGVvZiByZWNvcmQuc3RhcnRlZEF0TXMgPT09IFwibnVtYmVyXCIpXG4gICAgJiYgKHJlY29yZC5jaGlsZEluc3RhbmNlSWQgPT09IHVuZGVmaW5lZCB8fCB0eXBlb2YgcmVjb3JkLmNoaWxkSW5zdGFuY2VJZCA9PT0gXCJzdHJpbmdcIilcbiAgICAmJiAocmVjb3JkLmNoaWxkUGlkID09PSB1bmRlZmluZWQgfHwgTnVtYmVyLmlzSW50ZWdlcihyZWNvcmQuY2hpbGRQaWQpKVxufVxuXG4vKipcbiAqIENoZWNrcyB3aGV0aGVyIGFuIElQQyB2YWx1ZSBpcyB0aGUgY2hpbGQncyBib3VuZGVkIHByZS10ZWFyZG93biBvYnNlcnZhdGlvbi5cbiAqIEBwYXJhbSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59IG1lc3NhZ2UgLSBJUEMgbWVzc2FnZS5cbiAqIEByZXR1cm5zIHttZXNzYWdlIGlzIGltcG9ydChcIi4vdHlwZXMuanNcIikuUG9vbGVkQ2hpbGRTaHV0ZG93bk9ic2VydmF0aW9uICYge3R5cGU6IFwic2h1dGRvd24tb2JzZXJ2YXRpb25cIn19IC0gV2hldGhlciB0aGlzIGlzIGEgdmFsaWQgc2h1dGRvd24gb2JzZXJ2YXRpb24uXG4gKi9cbmZ1bmN0aW9uIGlzQ2hpbGRTaHV0ZG93bk9ic2VydmF0aW9uTWVzc2FnZShtZXNzYWdlKSB7XG4gIGlmICghbWVzc2FnZSB8fCB0eXBlb2YgbWVzc2FnZSAhPT0gXCJvYmplY3RcIikgcmV0dXJuIGZhbHNlXG4gIGNvbnN0IHJlY29yZCA9IC8qKiBAdHlwZSB7e2NoaWxkSW5zdGFuY2VJZD86IFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+LCBpbmZsaWdodEpvYklkcz86IFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+LCBpbmZsaWdodEpvYklkc1RydW5jYXRlZENvdW50PzogUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4sIHJlYXNvbj86IFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+LCBzaHV0ZG93bk9ic2VydmVkQXRNcz86IFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+LCBzaHV0ZG93blJlcXVlc3RlZEF0TXM/OiBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPiwgc2lnbmFsPzogUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4sIHR5cGU/OiBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn19ICovIChtZXNzYWdlKVxuXG4gIHJldHVybiByZWNvcmQudHlwZSA9PT0gXCJzaHV0ZG93bi1vYnNlcnZhdGlvblwiXG4gICAgJiYgdHlwZW9mIHJlY29yZC5jaGlsZEluc3RhbmNlSWQgPT09IFwic3RyaW5nXCJcbiAgICAmJiBBcnJheS5pc0FycmF5KHJlY29yZC5pbmZsaWdodEpvYklkcylcbiAgICAmJiByZWNvcmQuaW5mbGlnaHRKb2JJZHMubGVuZ3RoIDw9IFBPT0xFRF9SVU5ORVJfSU5GTElHSFRfSk9CX0lEX0xJTUlUXG4gICAgJiYgcmVjb3JkLmluZmxpZ2h0Sm9iSWRzLmV2ZXJ5KChqb2JJZCkgPT4gdHlwZW9mIGpvYklkID09PSBcInN0cmluZ1wiKVxuICAgICYmIE51bWJlci5pc0ludGVnZXIocmVjb3JkLmluZmxpZ2h0Sm9iSWRzVHJ1bmNhdGVkQ291bnQpXG4gICAgJiYgcmVjb3JkLmluZmxpZ2h0Sm9iSWRzVHJ1bmNhdGVkQ291bnQgPj0gMFxuICAgICYmIGlzUG9vbGVkQ2hpbGRTaHV0ZG93blJlYXNvbihyZWNvcmQucmVhc29uKVxuICAgICYmIHR5cGVvZiByZWNvcmQuc2h1dGRvd25PYnNlcnZlZEF0TXMgPT09IFwibnVtYmVyXCJcbiAgICAmJiBOdW1iZXIuaXNGaW5pdGUocmVjb3JkLnNodXRkb3duT2JzZXJ2ZWRBdE1zKVxuICAgICYmIChyZWNvcmQuc2h1dGRvd25SZXF1ZXN0ZWRBdE1zID09PSBudWxsIHx8ICh0eXBlb2YgcmVjb3JkLnNodXRkb3duUmVxdWVzdGVkQXRNcyA9PT0gXCJudW1iZXJcIiAmJiBOdW1iZXIuaXNGaW5pdGUocmVjb3JkLnNodXRkb3duUmVxdWVzdGVkQXRNcykpKVxuICAgICYmIGlzUG9vbGVkQ2hpbGRTaHV0ZG93blNpZ25hbChyZWNvcmQuc2lnbmFsKVxufVxuXG4vKipcbiAqIENoZWNrcyB3aGV0aGVyIGFuIElQQyB2YWx1ZSBpcyBhIHBvb2xlZCBjaGlsZCdzIGJvdW5kZWQgbWVtb3J5IG9ic2VydmF0aW9uLlxuICogVGhlIHBvb2xlZCBjaGlsZCdzIHN0ZGlvIGlzIGlnbm9yZWQgYnkgdGhlIHdvcmtlciBmb3JrLCBzbyB0aGlzIG9ic2VydmF0aW9uXG4gKiAocGVyaW9kaWMgd2hpbGUgam9icyBydW4sIHBsdXMgb24gZGVtYW5kKSBpcyBob3cgYSBtZW1vcnkgcHJvYmxlbSBpbiBhXG4gKiBydW5uaW5nIGNoaWxkIG5hbWVzIGl0c2VsZi4gVGhlIHdvcmtlciBsb2dzIGl0IChpdHMgc3RkZXJyIHJlYWNoZXMgdGhlIHByb2RcbiAqIGxvZykgYW5kIGZvcndhcmRzIGl0IHRvIHRoZSBvcHRpb25hbCBgb25Qb29sZWRSdW5uZXJNZW1vcnlPYnNlcnZhdGlvbmAgaG9vay5cbiAqIEBwYXJhbSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59IG1lc3NhZ2UgLSBJUEMgbWVzc2FnZS5cbiAqIEByZXR1cm5zIHttZXNzYWdlIGlzIGltcG9ydChcIi4vdHlwZXMuanNcIikuUG9vbGVkQ2hpbGRNZW1vcnlPYnNlcnZhdGlvbn0gLSBXaGV0aGVyIHRoaXMgaXMgYSB2YWxpZCBtZW1vcnkgb2JzZXJ2YXRpb24uXG4gKi9cbmZ1bmN0aW9uIGlzUG9vbGVkQ2hpbGRNZW1vcnlPYnNlcnZhdGlvbk1lc3NhZ2UobWVzc2FnZSkge1xuICBpZiAoIW1lc3NhZ2UgfHwgdHlwZW9mIG1lc3NhZ2UgIT09IFwib2JqZWN0XCIpIHJldHVybiBmYWxzZVxuICBjb25zdCByZWNvcmQgPSAvKiogQHR5cGUge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gKi8gKG1lc3NhZ2UpXG4gIGNvbnN0IGhlYXBTdGF0aXN0aWNzID0gLyoqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj4gfCB1bmRlZmluZWR9ICovIChyZWNvcmQuaGVhcFN0YXRpc3RpY3MpXG4gIGNvbnN0IG1lbW9yeVVzYWdlID0gLyoqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj4gfCB1bmRlZmluZWR9ICovIChyZWNvcmQubWVtb3J5VXNhZ2UpXG5cbiAgcmV0dXJuIHJlY29yZC50eXBlID09PSBcInBvb2xlZC1jaGlsZC1tZW1vcnlcIlxuICAgICYmIHR5cGVvZiByZWNvcmQuY2hpbGRJbnN0YW5jZUlkID09PSBcInN0cmluZ1wiXG4gICAgJiYgTnVtYmVyLmlzSW50ZWdlcihyZWNvcmQuY2hpbGRQaWQpXG4gICAgJiYgdHlwZW9mIHJlY29yZC5yc3NCeXRlcyA9PT0gXCJudW1iZXJcIlxuICAgICYmIE51bWJlci5pc0Zpbml0ZShyZWNvcmQucnNzQnl0ZXMpXG4gICAgJiYgTnVtYmVyLmlzSW50ZWdlcihyZWNvcmQuam9iQ291bnQpXG4gICAgJiYgcmVjb3JkLmpvYkNvdW50ID49IDBcbiAgICAmJiBBcnJheS5pc0FycmF5KHJlY29yZC5hY3RpdmVKb2JJZHMpXG4gICAgJiYgcmVjb3JkLmFjdGl2ZUpvYklkcy5ldmVyeSgoam9iSWQpID0+IHR5cGVvZiBqb2JJZCA9PT0gXCJzdHJpbmdcIilcbiAgICAmJiBOdW1iZXIuaXNJbnRlZ2VyKHJlY29yZC5hY3RpdmVKb2JJZHNUcnVuY2F0ZWRDb3VudClcbiAgICAmJiByZWNvcmQuYWN0aXZlSm9iSWRzVHJ1bmNhdGVkQ291bnQgPj0gMFxuICAgICYmIHR5cGVvZiByZWNvcmQub2JzZXJ2ZWRBdE1zID09PSBcIm51bWJlclwiXG4gICAgJiYgTnVtYmVyLmlzRmluaXRlKHJlY29yZC5vYnNlcnZlZEF0TXMpXG4gICAgJiYgaGVhcFN0YXRpc3RpY3MgIT09IHVuZGVmaW5lZCAmJiB0eXBlb2YgaGVhcFN0YXRpc3RpY3MgPT09IFwib2JqZWN0XCJcbiAgICAmJiBtZW1vcnlVc2FnZSAhPT0gdW5kZWZpbmVkICYmIHR5cGVvZiBtZW1vcnlVc2FnZSA9PT0gXCJvYmplY3RcIlxufVxuXG4vKipcbiAqIE5vcm1hbGl6ZXMgYSBjYW5kaWRhdGUgcG9vbGVkLXJ1bm5lciByZXNvdXJjZSBsaW1pdC5cbiAqIEBwYXJhbSB7bnVtYmVyIHwgdW5kZWZpbmVkfSB2YWx1ZSAtIENhbmRpZGF0ZSBwb3NpdGl2ZSBudW1iZXIuXG4gKiBAcmV0dXJucyB7bnVtYmVyIHwgdW5kZWZpbmVkfSAtIE5vcm1hbGl6ZWQgdmFsdWUuXG4gKi9cbmZ1bmN0aW9uIHBvc2l0aXZlTnVtYmVyKHZhbHVlKSB7XG4gIHJldHVybiB0eXBlb2YgdmFsdWUgPT09IFwibnVtYmVyXCIgJiYgTnVtYmVyLmlzRmluaXRlKHZhbHVlKSAmJiB2YWx1ZSA+IDAgPyB2YWx1ZSA6IHVuZGVmaW5lZFxufVxuXG5leHBvcnQgZGVmYXVsdCBjbGFzcyBCYWNrZ3JvdW5kSm9ic1dvcmtlciB7XG4gIC8qKlxuICAgKiBSdW5zIGNvbnN0cnVjdG9yLlxuICAgKiBAcGFyYW0ge29iamVjdH0gW2FyZ3NdIC0gT3B0aW9ucy5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9jb25maWd1cmF0aW9uLmpzXCIpLmRlZmF1bHR9IFthcmdzLmNvbmZpZ3VyYXRpb25dIC0gQ29uZmlndXJhdGlvbi5cbiAgICogQHBhcmFtIHtzdHJpbmd9IFthcmdzLmhvc3RdIC0gSG9zdG5hbWUuXG4gICAqIEBwYXJhbSB7bnVtYmVyfSBbYXJncy5wb3J0XSAtIFBvcnQuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBbYXJncy5nZW5lcmF0aW9uSWRdIC0gRXhwbGljaXQgcmVsZWFzZSBnZW5lcmF0aW9uIGlkZW50aXR5LlxuICAgKiBAcGFyYW0ge3N0cmluZ30gW2FyZ3Mud29ya2VySW5zdGFuY2VJZF0gLSBFeHBsaWNpdCBzdGFibGUgd29ya2VyIFVVSUQuXG4gICAqIEBwYXJhbSB7bnVtYmVyfSBbYXJncy5tYXhDb25jdXJyZW50Rm9ya2VkSm9ic10gLSBPdmVycmlkZSB0aGUgcHJvY2VzcyBydW5uZXIgY29uY3VycmVuY3kgY2FwIGZyb20gYGNvbmZpZ3VyYXRpb24uZ2V0QmFja2dyb3VuZEpvYnNDb25maWcoKWAuXG4gICAqIEBwYXJhbSB7bnVtYmVyfSBbYXJncy5tYXhDb25jdXJyZW50SW5saW5lSm9ic10gLSBPdmVycmlkZSB0aGUgaW5saW5lLWpvYiBjb25jdXJyZW5jeSBjYXAgZnJvbSBgY29uZmlndXJhdGlvbi5nZXRCYWNrZ3JvdW5kSm9ic0NvbmZpZygpYC5cbiAgICogQHBhcmFtIHtudW1iZXJ9IFthcmdzLnBvb2xlZFJ1bm5lckNvdW50XSAtIE92ZXJyaWRlIHRoZSBwb29sZWQgcnVubmVyIGNvdW50LlxuICAgKiBAcGFyYW0ge251bWJlcn0gW2FyZ3MucG9vbGVkUnVubmVyQ29uY3VycmVuY3ldIC0gT3ZlcnJpZGUgdGhlIHBlci1ydW5uZXIgY29uY3VycmVuY3kuXG4gICAqIEBwYXJhbSB7bnVtYmVyfSBbYXJncy5wb29sZWRSdW5uZXJNYXhKb2JzXSAtIE92ZXJyaWRlIHRoZSBwZXItcnVubmVyIHJlY3ljbGUgam9iIGNvdW50LlxuICAgKiBAcGFyYW0ge251bWJlcn0gW2FyZ3MucG9vbGVkUnVubmVyTWF4UnNzQnl0ZXNdIC0gT3ZlcnJpZGUgdGhlIHBlci1ydW5uZXIgcmVjeWNsZSBSU1MgbGltaXQuXG4gICAqIEBwYXJhbSB7bnVtYmVyfSBbYXJncy5wb29sZWRSdW5uZXJNYXhMaWZldGltZU1zXSAtIE92ZXJyaWRlIHRoZSBwZXItcnVubmVyIHJlY3ljbGUgbGlmZXRpbWUuXG4gICAqIEBwYXJhbSB7bnVtYmVyfSBbYXJncy5mb3JrZWRDaGlsZFNpZ2tpbGxHcmFjZU1zXSAtIE92ZXJyaWRlIHRoZSBncmFjZSBwZXJpb2QgYmV0d2VlbiBTSUdURVJNIGFuZCBTSUdLSUxMIHdoZW4gcmVhcGluZyBsaW5nZXJpbmcgcHJvY2VzcyBydW5uZXJzIG9uIHN0b3AuXG4gICAqIEBwYXJhbSB7bnVtYmVyfSBbYXJncy5oZWFydGJlYXRJbnRlcnZhbE1zXSAtIE92ZXJyaWRlIHRoZSBsaXZlbmVzcyBoZWFydGJlYXQgaW50ZXJ2YWwgKGRlZmF1bHQgMTUwMDBtcykuXG4gICAqIEBwYXJhbSB7bnVtYmVyfSBbYXJncy5nZW5lcmF0aW9uSGFuZHNoYWtlVGltZW91dE1zXSAtIE1heGltdW0gdGltZSB0byB3YWl0IGZvciBnZW5lcmF0aW9uIGFja25vd2xlZGdlbWVudCAoZGVmYXVsdDogNDAwMCkuXG4gICAqIEBwYXJhbSB7bnVtYmVyfSBbYXJncy5yZWNvbm5lY3REZWxheU1zXSAtIERlbGF5IGJlZm9yZSByZWNvbm5lY3RpbmcgYW4gZXN0YWJsaXNoZWQgd29ya2VyIGNvbm5lY3Rpb24gKGRlZmF1bHQ6IDEwMDApLlxuICAgKiBAcGFyYW0ge251bWJlcn0gW2FyZ3Muam9iVGltZW91dE1zXSAtIE92ZXJyaWRlIHRoZSB3YWxsLWNsb2NrIHRpbWVvdXQgZm9yIGZvcmtlZCBhbmQgcG9vbGVkIGpvYnMgZnJvbSBgY29uZmlndXJhdGlvbi5nZXRCYWNrZ3JvdW5kSm9ic0NvbmZpZygpYC4gYDBgIGRpc2FibGVzIGl0LlxuICAgKiBAcGFyYW0ge2Jvb2xlYW59IFthcmdzLmNsb3NlRGF0YWJhc2VDb25uZWN0aW9uc09uU3RvcF0gLSBXaGV0aGVyIHN0b3Agb3ducyBjbG9zaW5nIHRoZSBjb25maWd1cmF0aW9uJ3MgZGF0YWJhc2UgcG9vbHMgKGRlZmF1bHQgdHJ1ZSkuXG4gICAqIEBwYXJhbSB7KCkgPT4gdm9pZCB8IFByb21pc2U8dm9pZD59IFthcmdzLm9uU3RvcHBlZF0gLSBMaWZlY3ljbGUgaG9vayBpbnZva2VkIGFmdGVyIHRoZSB3b3JrZXIgZmluaXNoZXMgc3RvcHBpbmcuXG4gICAqIEBwYXJhbSB7KCkgPT4gdm9pZH0gW2FyZ3Mub25HZW5lcmF0aW9uQWNjZXB0ZWRdIC0gRXhwbGljaXQgZ2VuZXJhdGlvbi1hY2NlcHRhbmNlIG9ic2VydmF0aW9uIGhvb2suXG4gICAqIEBwYXJhbSB7KCkgPT4gdm9pZH0gW2FyZ3Mub25SZXRpcmVNZXNzYWdlXSAtIEV4cGxpY2l0IHJldGlyZS1tZXNzYWdlIG9ic2VydmF0aW9uIGhvb2suXG4gICAqIEBwYXJhbSB7KG9ic2VydmF0aW9uOiBpbXBvcnQoXCIuL3R5cGVzLmpzXCIpLlBvb2xlZENoaWxkTWVtb3J5T2JzZXJ2YXRpb24pID0+IHZvaWQgfCBQcm9taXNlPHZvaWQ+fSBbYXJncy5vblBvb2xlZFJ1bm5lck1lbW9yeU9ic2VydmF0aW9uXSAtIEV4cGxpY2l0IHBvb2xlZC1jaGlsZCBtZW1vcnkgb2JzZXJ2YXRpb24gaG9vay4gRXZlcnkgdmFsaWRhdGVkIG9ic2VydmF0aW9uIChwZXJpb2RpYyB3aGlsZSBhIGNoaWxkIGhhcyBpbi1mbGlnaHQgam9icywgcGx1cyBvbiBkZW1hbmQpIGlzIGZvcndhcmRlZCBoZXJlLCBpbiBhZGRpdGlvbiB0byB0aGUgd29ya2VyJ3MgY29tcGFjdCBzdGRlcnIgbG9nIGxpbmUsIHNvIGFuIGFwcGxpY2F0aW9uIGNhbiByb3V0ZSBtZW1vcnkgZGlhZ25vc3RpY3MgKGUuZy4gdG8gYSBidWcgcmVwb3J0ZXIpIHdpdGhvdXQgcGFyc2luZyBsb2dzLlxuICAgKi9cbiAgY29uc3RydWN0b3Ioe2NvbmZpZ3VyYXRpb24sIGhvc3QsIHBvcnQsIGdlbmVyYXRpb25JZCwgd29ya2VySW5zdGFuY2VJZCwgbWF4Q29uY3VycmVudEZvcmtlZEpvYnMsIG1heENvbmN1cnJlbnRJbmxpbmVKb2JzLCBwb29sZWRSdW5uZXJDb3VudCwgcG9vbGVkUnVubmVyQ29uY3VycmVuY3ksIHBvb2xlZFJ1bm5lck1heEpvYnMsIHBvb2xlZFJ1bm5lck1heFJzc0J5dGVzLCBwb29sZWRSdW5uZXJNYXhMaWZldGltZU1zLCBmb3JrZWRDaGlsZFNpZ2tpbGxHcmFjZU1zLCBoZWFydGJlYXRJbnRlcnZhbE1zLCBnZW5lcmF0aW9uSGFuZHNoYWtlVGltZW91dE1zID0gREVGQVVMVF9HRU5FUkFUSU9OX0hBTkRTSEFLRV9USU1FT1VUX01TLCByZWNvbm5lY3REZWxheU1zID0gMTAwMCwgam9iVGltZW91dE1zLCBjbG9zZURhdGFiYXNlQ29ubmVjdGlvbnNPblN0b3AgPSB0cnVlLCBvblN0b3BwZWQsIG9uR2VuZXJhdGlvbkFjY2VwdGVkLCBvblJldGlyZU1lc3NhZ2UsIG9uUG9vbGVkUnVubmVyTWVtb3J5T2JzZXJ2YXRpb259ID0ge30pIHtcbiAgICAvKipcbiAgICAgKiBOYXJyb3dzIHRoZSBydW50aW1lIHZhbHVlIHRvIHRoZSBkb2N1bWVudGVkIHR5cGUuXG4gICAgICogQHR5cGUge1Byb21pc2U8aW1wb3J0KFwiLi4vY29uZmlndXJhdGlvbi5qc1wiKS5kZWZhdWx0Pn0gKi9cbiAgICB0aGlzLmNvbmZpZ3VyYXRpb25Qcm9taXNlID0gY29uZmlndXJhdGlvbiA/IFByb21pc2UucmVzb2x2ZShjb25maWd1cmF0aW9uKSA6IGNvbmZpZ3VyYXRpb25SZXNvbHZlcigpXG4gICAgLyoqXG4gICAgICogTmFycm93cyB0aGUgcnVudGltZSB2YWx1ZSB0byB0aGUgZG9jdW1lbnRlZCB0eXBlLlxuICAgICAqIEB0eXBlIHtpbXBvcnQoXCIuLi9jb25maWd1cmF0aW9uLmpzXCIpLmRlZmF1bHQgfCB1bmRlZmluZWR9ICovXG4gICAgdGhpcy5jb25maWd1cmF0aW9uID0gdW5kZWZpbmVkXG4gICAgdGhpcy5ob3N0ID0gaG9zdFxuICAgIHRoaXMucG9ydCA9IHBvcnRcbiAgICB0aGlzLmV4cGxpY2l0R2VuZXJhdGlvbklkID0gZ2VuZXJhdGlvbklkXG4gICAgdGhpcy53b3JrZXJJbnN0YW5jZUlkID0gd29ya2VySW5zdGFuY2VJZCB8fCByYW5kb21VVUlEKClcbiAgICAvKiogQHR5cGUge3N0cmluZyB8IHVuZGVmaW5lZH0gKi9cbiAgICB0aGlzLmdlbmVyYXRpb25JZCA9IHVuZGVmaW5lZFxuICAgIHRoaXMuY2xvc2VEYXRhYmFzZUNvbm5lY3Rpb25zT25TdG9wID0gY2xvc2VEYXRhYmFzZUNvbm5lY3Rpb25zT25TdG9wXG4gICAgdGhpcy5vblN0b3BwZWQgPSBvblN0b3BwZWRcbiAgICB0aGlzLm9uR2VuZXJhdGlvbkFjY2VwdGVkID0gb25HZW5lcmF0aW9uQWNjZXB0ZWRcbiAgICB0aGlzLm9uUmV0aXJlTWVzc2FnZSA9IG9uUmV0aXJlTWVzc2FnZVxuICAgIHRoaXMub25Qb29sZWRSdW5uZXJNZW1vcnlPYnNlcnZhdGlvbiA9IG9uUG9vbGVkUnVubmVyTWVtb3J5T2JzZXJ2YXRpb25cbiAgICAvKipcbiAgICAgKiBDb25zdHJ1Y3RvciBvdmVycmlkZSBmb3IgdGhlIGlubGluZS1qb2IgY29uY3VycmVuY3kgY2FwLiBXaGVuIHVuc2V0XG4gICAgICogdGhlIGNhcCBpcyByZWFkIGZyb20gYGNvbmZpZ3VyYXRpb24uZ2V0QmFja2dyb3VuZEpvYnNDb25maWcoKWAgaW5cbiAgICAgKiBgc3RhcnQoKWAgKGRlZmF1bHQ6IDQpLlxuICAgICAqIEB0eXBlIHtudW1iZXIgfCB1bmRlZmluZWR9XG4gICAgICovXG4gICAgdGhpcy5tYXhDb25jdXJyZW50SW5saW5lSm9ic092ZXJyaWRlID0gdHlwZW9mIG1heENvbmN1cnJlbnRJbmxpbmVKb2JzID09PSBcIm51bWJlclwiICYmIG1heENvbmN1cnJlbnRJbmxpbmVKb2JzID49IDFcbiAgICAgID8gbWF4Q29uY3VycmVudElubGluZUpvYnNcbiAgICAgIDogdW5kZWZpbmVkXG4gICAgLyoqXG4gICAgICogTmFycm93cyB0aGUgcnVudGltZSB2YWx1ZSB0byB0aGUgZG9jdW1lbnRlZCB0eXBlLlxuICAgICAqIEB0eXBlIHtudW1iZXIgfCB1bmRlZmluZWR9ICovXG4gICAgdGhpcy5tYXhDb25jdXJyZW50Rm9ya2VkSm9ic092ZXJyaWRlID0gdHlwZW9mIG1heENvbmN1cnJlbnRGb3JrZWRKb2JzID09PSBcIm51bWJlclwiICYmIG1heENvbmN1cnJlbnRGb3JrZWRKb2JzID49IDFcbiAgICAgID8gbWF4Q29uY3VycmVudEZvcmtlZEpvYnNcbiAgICAgIDogdW5kZWZpbmVkXG4gICAgLyoqXG4gICAgICogUmVzb2x2ZWQgY2FwIGZvciBpbmxpbmUtam9iIGNvbmN1cnJlbmN5LiBTZXQgaW4gYHN0YXJ0KClgOyBkZWZhdWx0cyB0b1xuICAgICAqIDQgaWYgbm8gY29uZmlndXJhdGlvbiB2YWx1ZSBpcyBhdmFpbGFibGUuXG4gICAgICogQHR5cGUge251bWJlcn1cbiAgICAgKi9cbiAgICB0aGlzLm1heENvbmN1cnJlbnRJbmxpbmVKb2JzID0gdGhpcy5tYXhDb25jdXJyZW50SW5saW5lSm9ic092ZXJyaWRlIHx8IDRcbiAgICAvKipcbiAgICAgKiBOYXJyb3dzIHRoZSBydW50aW1lIHZhbHVlIHRvIHRoZSBkb2N1bWVudGVkIHR5cGUuXG4gICAgICogQHR5cGUge251bWJlcn0gKi9cbiAgICB0aGlzLm1heENvbmN1cnJlbnRGb3JrZWRKb2JzID0gdGhpcy5tYXhDb25jdXJyZW50Rm9ya2VkSm9ic092ZXJyaWRlIHx8IDRcbiAgICB0aGlzLnBvb2xlZFJ1bm5lckNvdW50T3ZlcnJpZGUgPSBwb3NpdGl2ZUludGVnZXIocG9vbGVkUnVubmVyQ291bnQpXG4gICAgdGhpcy5wb29sZWRSdW5uZXJDb25jdXJyZW5jeU92ZXJyaWRlID0gcG9zaXRpdmVJbnRlZ2VyKHBvb2xlZFJ1bm5lckNvbmN1cnJlbmN5KVxuICAgIHRoaXMucG9vbGVkUnVubmVyTWF4Sm9ic092ZXJyaWRlID0gcG9zaXRpdmVJbnRlZ2VyKHBvb2xlZFJ1bm5lck1heEpvYnMpXG4gICAgdGhpcy5wb29sZWRSdW5uZXJNYXhSc3NCeXRlc092ZXJyaWRlID0gcG9zaXRpdmVOdW1iZXIocG9vbGVkUnVubmVyTWF4UnNzQnl0ZXMpXG4gICAgdGhpcy5wb29sZWRSdW5uZXJNYXhMaWZldGltZU1zT3ZlcnJpZGUgPSBwb3NpdGl2ZU51bWJlcihwb29sZWRSdW5uZXJNYXhMaWZldGltZU1zKVxuICAgIHRoaXMucG9vbGVkUnVubmVyQ291bnQgPSB0aGlzLnBvb2xlZFJ1bm5lckNvdW50T3ZlcnJpZGUgfHwgNFxuICAgIHRoaXMucG9vbGVkUnVubmVyQ29uY3VycmVuY3kgPSB0aGlzLnBvb2xlZFJ1bm5lckNvbmN1cnJlbmN5T3ZlcnJpZGUgfHwgMVxuICAgIHRoaXMucG9vbGVkUnVubmVyTWF4Sm9icyA9IHRoaXMucG9vbGVkUnVubmVyTWF4Sm9ic092ZXJyaWRlIHx8IDEwMFxuICAgIHRoaXMucG9vbGVkUnVubmVyTWF4UnNzQnl0ZXMgPSB0aGlzLnBvb2xlZFJ1bm5lck1heFJzc0J5dGVzT3ZlcnJpZGUgfHwgNTEyICogMTAyNCAqIDEwMjRcbiAgICB0aGlzLnBvb2xlZFJ1bm5lck1heExpZmV0aW1lTXMgPSB0aGlzLnBvb2xlZFJ1bm5lck1heExpZmV0aW1lTXNPdmVycmlkZSB8fCA2MCAqIDYwICogMTAwMFxuICAgIC8qKlxuICAgICAqIEdyYWNlIHBlcmlvZCBiZXR3ZWVuIFNJR1RFUk0gYW5kIFNJR0tJTEwgd2hlbiByZWFwaW5nIHByb2Nlc3MgcnVubmVycyB0aGF0XG4gICAgICogb3V0bGFzdCBhIGJvdW5kZWQgc2h1dGRvd24gZHJhaW4uXG4gICAgICogQHR5cGUge251bWJlcn1cbiAgICAgKi9cbiAgICB0aGlzLmZvcmtlZENoaWxkU2lna2lsbEdyYWNlTXMgPSB0eXBlb2YgZm9ya2VkQ2hpbGRTaWdraWxsR3JhY2VNcyA9PT0gXCJudW1iZXJcIiAmJiBmb3JrZWRDaGlsZFNpZ2tpbGxHcmFjZU1zID49IDBcbiAgICAgID8gZm9ya2VkQ2hpbGRTaWdraWxsR3JhY2VNc1xuICAgICAgOiBGT1JLRURfQ0hJTERfU0lHS0lMTF9HUkFDRV9NU1xuICAgIC8qKlxuICAgICAqIENvbnN0cnVjdG9yIG92ZXJyaWRlIGZvciB0aGUgZm9ya2VkIGFuZCBwb29sZWQgd2FsbC1jbG9jayBqb2IgdGltZW91dC4gV2hlbiB1bnNldCB0aGVcbiAgICAgKiB0aW1lb3V0IGlzIHJlYWQgZnJvbSBgY29uZmlndXJhdGlvbi5nZXRCYWNrZ3JvdW5kSm9ic0NvbmZpZygpLmpvYlRpbWVvdXRNc2BcbiAgICAgKiBhdCBmb3JrIHRpbWUgKGRlZmF1bHQ6IGRpc2FibGVkKS5cbiAgICAgKiBAdHlwZSB7bnVtYmVyIHwgdW5kZWZpbmVkfVxuICAgICAqL1xuICAgIHRoaXMuam9iVGltZW91dE1zT3ZlcnJpZGUgPSB0eXBlb2Ygam9iVGltZW91dE1zID09PSBcIm51bWJlclwiID8gam9iVGltZW91dE1zIDogdW5kZWZpbmVkXG4gICAgdGhpcy5zaG91bGRTdG9wID0gZmFsc2VcbiAgICB0aGlzLmlzUmV0aXJpbmcgPSBmYWxzZVxuICAgIC8qKiBAdHlwZSB7UHJvbWlzZTx2b2lkPiB8IHVuZGVmaW5lZH0gKi9cbiAgICB0aGlzLnN0b3BQcm9taXNlID0gdW5kZWZpbmVkXG4gICAgLyoqXG4gICAgICogUmVzb2x2ZXMgc3RvcCBvYnNlcnZhdGlvbi5cbiAgICAgKiBAdHlwZSB7KHZhbHVlPzogdm9pZCkgPT4gdm9pZH1cbiAgICAgKi9cbiAgICB0aGlzLl9yZXNvbHZlU3RvcHBlZCA9ICgpID0+IHt9XG4gICAgLyoqXG4gICAgICogUmVqZWN0cyBzdG9wIG9ic2VydmF0aW9uLlxuICAgICAqIEB0eXBlIHsoZXJyb3I6IEVycm9yKSA9PiB2b2lkfVxuICAgICAqL1xuICAgIHRoaXMuX3JlamVjdFN0b3BwZWQgPSAoKSA9PiB7fVxuICAgIC8qKiBAdHlwZSB7UHJvbWlzZTx2b2lkPn0gKi9cbiAgICB0aGlzLl9zdG9wcGVkUHJvbWlzZSA9IFByb21pc2UucmVzb2x2ZSgpXG4gICAgdGhpcy5fcmVzZXRTdG9wcGVkUHJvbWlzZSgpXG4gICAgdGhpcy53b3JrZXJJZCA9IHRoaXMud29ya2VySW5zdGFuY2VJZFxuICAgIHRoaXMuX2dlbmVyYXRpb25BY2NlcHRlZCA9IGZhbHNlXG4gICAgdGhpcy5nZW5lcmF0aW9uSGFuZHNoYWtlVGltZW91dE1zID0gdmFsaWRhdGVHZW5lcmF0aW9uSGFuZHNoYWtlVGltZW91dE1zKGdlbmVyYXRpb25IYW5kc2hha2VUaW1lb3V0TXMpXG4gICAgaWYgKCFOdW1iZXIuaXNJbnRlZ2VyKHJlY29ubmVjdERlbGF5TXMpIHx8IHJlY29ubmVjdERlbGF5TXMgPCAwIHx8IHJlY29ubmVjdERlbGF5TXMgPiBNQVhfRk9SS0VEX0pPQl9USU1FT1VUX01TKSB7XG4gICAgICB0aHJvdyBuZXcgVHlwZUVycm9yKFwicmVjb25uZWN0RGVsYXlNcyBtdXN0IGJlIGFuIGludGVnZXIgYmV0d2VlbiAwIGFuZCAyMTQ3NDgzNjQ3XCIpXG4gICAgfVxuICAgIHRoaXMucmVjb25uZWN0RGVsYXlNcyA9IHJlY29ubmVjdERlbGF5TXNcbiAgICAvKiogQHR5cGUge1JldHVyblR5cGU8dHlwZW9mIHNldFRpbWVvdXQ+IHwgdW5kZWZpbmVkfSAqL1xuICAgIHRoaXMuX3JlY29ubmVjdFRpbWVyID0gdW5kZWZpbmVkXG4gICAgdGhpcy5oZWFydGJlYXRJbnRlcnZhbE1zID0gdHlwZW9mIGhlYXJ0YmVhdEludGVydmFsTXMgPT09IFwibnVtYmVyXCIgJiYgaGVhcnRiZWF0SW50ZXJ2YWxNcyA+PSAxXG4gICAgICA/IGhlYXJ0YmVhdEludGVydmFsTXNcbiAgICAgIDogSEVBUlRCRUFUX0lOVEVSVkFMX01TXG4gICAgLyoqXG4gICAgICogTmFycm93cyB0aGUgcnVudGltZSB2YWx1ZSB0byB0aGUgZG9jdW1lbnRlZCB0eXBlLlxuICAgICAqIEB0eXBlIHtSZXR1cm5UeXBlPHR5cGVvZiBzZXRJbnRlcnZhbD4gfCB1bmRlZmluZWR9ICovXG4gICAgdGhpcy5faGVhcnRiZWF0VGltZXIgPSB1bmRlZmluZWRcbiAgICAvKipcbiAgICAgKiBJbi1mbGlnaHQgam9iLXJlc3VsdCByZXBvcnRzIHRvIHRoZSBtYWluLiBSZXBvcnRpbmcgaXMgZGVjb3VwbGVkIGZyb20gdGhlXG4gICAgICogam9iL2NoaWxkIHNsb3QgKGZyZWVpbmcgdGhlIHNsb3QgbmV2ZXIgd2FpdHMgb24gYSByZXBvcnQpIGFuZCByZXRyaWVkXG4gICAgICogZHVyYWJseSwgc28gYSB0cmFuc2llbnQgbWFpbi9EQiBvdXRhZ2UgY2Fubm90IGxlYWsgc2xvdHMgb3IgbG9zZSBhXG4gICAgICogdGVybWluYWwgcmVwb3J0LiBUcmFja2VkIHNvIGEgZ3JhY2VmdWwgYHN0b3AoKWAgY2FuIGRyYWluIHRoZW0uXG4gICAgICogQHR5cGUge1NldDxQcm9taXNlPHZvaWQ+Pn1cbiAgICAgKi9cbiAgICB0aGlzLmluZmxpZ2h0UmVwb3J0cyA9IG5ldyBTZXQoKVxuICAgIC8qKlxuICAgICAqIE5hcnJvd3MgdGhlIHJ1bnRpbWUgdmFsdWUgdG8gdGhlIGRvY3VtZW50ZWQgdHlwZS5cbiAgICAgKiBAdHlwZSB7SnNvblNvY2tldCB8IHVuZGVmaW5lZH0gKi9cbiAgICB0aGlzLmpzb25Tb2NrZXQgPSB1bmRlZmluZWRcbiAgICAvKipcbiAgICAgKiBOYXJyb3dzIHRoZSBydW50aW1lIHZhbHVlIHRvIHRoZSBkb2N1bWVudGVkIHR5cGUuXG4gICAgICogQHR5cGUge0JhY2tncm91bmRKb2JzU3RhdHVzUmVwb3J0ZXIgfCB1bmRlZmluZWR9ICovXG4gICAgdGhpcy5zdGF0dXNSZXBvcnRlciA9IHVuZGVmaW5lZFxuICAgIC8qKlxuICAgICAqIFVwIHRvIGB0aGlzLm1heENvbmN1cnJlbnRJbmxpbmVKb2JzYCBvZiB0aGVzZSBydW4gaW4gcGFyYWxsZWwuIFRoZXlcbiAgICAgKiBzaGFyZSB0aGUgd29ya2VyJ3MgcHJvY2VzcyBhbmQgREIgY29ubmVjdGlvbiBwb29sLCBzbyBjb25jdXJyZW5jeSBpc1xuICAgICAqIGFib3V0IG92ZXJsYXBwaW5nIEkvTyB3YWl0cyDigJQgdXNlIGZvcmtpbmcgZm9yIG1lbW9yeSBpc29sYXRpb24gYWNyb3NzXG4gICAgICogbG9uZy1ydW5uaW5nIGpvYnMgYW5kIGZvciB1c2luZyBtb3JlIGNvcmVzLlxuICAgICAqIEB0eXBlIHtTZXQ8UHJvbWlzZTx2b2lkPj59XG4gICAgICovXG4gICAgdGhpcy5pbmZsaWdodElubGluZUpvYnMgPSBuZXcgU2V0KClcbiAgICAvKipcbiAgICAgKiBJbi1mbGlnaHQgcHJvY2VzcyBydW5uZXIgZXhpdCBwcm9taXNlcy4gVHJhY2tlZCBzbyBwcm9jZXNzLWpvYiBoYW5kb2ZmXG4gICAgICogc3RheXMgYm91bmRlZCB3aGlsZSBydW5uaW5nIGFuZCBzbyBhIGdyYWNlZnVsIGBzdG9wKClgIGNhbiBkcmFpbiB0aGVtLlxuICAgICAqIEB0eXBlIHtTZXQ8UHJvbWlzZTx2b2lkPj59XG4gICAgICovXG4gICAgdGhpcy5pbmZsaWdodFByb2Nlc3NKb2JzID0gbmV3IFNldCgpXG4gICAgLyoqXG4gICAgICogTGl2ZSBwcm9jZXNzIHJ1bm5lciBjaGlsZCBwcm9jZXNzZXMsIGtlcHQgc28gYSBncmFjZWZ1bCBgc3RvcCgpYCBjYW5cbiAgICAgKiB0ZXJtaW5hdGUgYW55IHRoYXQgb3V0bGFzdCB0aGUgc2h1dGRvd24gZHJhaW4gaW5zdGVhZCBvZiBvcnBoYW5pbmcgdGhlbVxuICAgICAqIGFjcm9zcyBhIGRlcGxveSAod2hlcmUgdGhleSB3b3VsZCBrZWVwIHJ1bm5pbmcgYWdhaW5zdCBkZWxldGVkIHJlbGVhc2VcbiAgICAgKiBjb2RlIGFuZCBob2xkaW5nIGRhdGFiYXNlIGNvbm5lY3Rpb25zKS5cbiAgICAgKiBAdHlwZSB7U2V0PGltcG9ydChcIm5vZGU6Y2hpbGRfcHJvY2Vzc1wiKS5DaGlsZFByb2Nlc3M+fVxuICAgICAqL1xuICAgIHRoaXMuaW5mbGlnaHRQcm9jZXNzQ2hpbGRyZW4gPSBuZXcgU2V0KClcbiAgICAvKiogQHR5cGUge1NldDxQcm9taXNlPHZvaWQ+Pn0gKi9cbiAgICB0aGlzLmluZmxpZ2h0UG9vbGVkSm9icyA9IG5ldyBTZXQoKVxuICAgIC8qKiBAdHlwZSB7TWFwPHN0cmluZywgQXJyYXk8aW1wb3J0KFwiLi90eXBlcy5qc1wiKS5CYWNrZ3JvdW5kSm9iUGF5bG9hZCAmIHtpZDogc3RyaW5nfT4+fSAqL1xuICAgIHRoaXMucG9vbGVkSm9iUXVldWVzID0gbmV3IE1hcCgpXG4gICAgLyoqIEB0eXBlIHtNYXA8c3RyaW5nLCBQcm9taXNlPHZvaWQ+Pn0gLSBQZXItaWQgb3V0ZXIgcXVldWUgdHJhY2tlcnMuICovXG4gICAgdGhpcy5wb29sZWRKb2JRdWV1ZVRyYWNrZXJzID0gbmV3IE1hcCgpXG4gICAgLyoqIEB0eXBlIHtTZXQ8aW1wb3J0KFwibm9kZTpjaGlsZF9wcm9jZXNzXCIpLkNoaWxkUHJvY2Vzcz59ICovXG4gICAgdGhpcy5wb29sZWRDaGlsZHJlbiA9IG5ldyBTZXQoKVxuICAgIC8qKiBAdHlwZSB7TWFwPGltcG9ydChcIm5vZGU6Y2hpbGRfcHJvY2Vzc1wiKS5DaGlsZFByb2Nlc3MsIFBvb2xlZENoaWxkU3RhdGU+fSAqL1xuICAgIHRoaXMucG9vbGVkQ2hpbGRTdGF0ZXMgPSBuZXcgTWFwKClcbiAgICAvKiogQHR5cGUge1dlYWtTZXQ8UHJvbWlzZTx2b2lkPj59ICovXG4gICAgdGhpcy5fcG9vbGVkU3RhcnR1cEZhaWx1cmVKb2JzID0gbmV3IFdlYWtTZXQoKVxuICAgIC8vIE1vbm90b25pYyBkaXNwYXRjaCBjb3VudGVyIGZvciByb3VuZC1yb2JpbiBjaGlsZCBzZWxlY3Rpb246IGVhY2ggZGlzcGF0Y2ggc3RhbXBzXG4gICAgLy8gdGhlIGNob3NlbiBjaGlsZCwgYW5kIHNlbGVjdGlvbiBwcmVmZXJzIHRoZSBjaGlsZCBkaXNwYXRjaGVkIGxlYXN0IHJlY2VudGx5LlxuICAgIHRoaXMuX3Bvb2xlZERpc3BhdGNoU2VxID0gMFxuICAgIC8vIFdhaXRlcnMgYmxvY2tlZCBpbiBfcnVuUG9vbGVkSm9iIGJlY2F1c2UgdGhlIHBvb2wgaXMgYXQgaXRzIGhhcmQgY2FwOiBhIGpvYiBtYXlcbiAgICAvLyBub3Qgc3Bhd24gYSBjaGlsZCB3aGlsZSB0b3RhbCBsaXZlIGNoaWxkcmVuICh3b3JraW5nICsgZHJhaW5pbmcpIGlzIGF0IHRoZSBjYXAuXG4gICAgLyoqIEB0eXBlIHtTZXQ8KCkgPT4gdm9pZD59ICovXG4gICAgdGhpcy5fcG9vbGVkU2xvdFdhaXRlcnMgPSBuZXcgU2V0KClcbiAgICAvKiogQHR5cGUge1JldHVyblR5cGU8dHlwZW9mIHNldEludGVydmFsPiB8IHVuZGVmaW5lZH0gLSBTYWZldHkgcG9sbCB0aGF0IHJlLWNoZWNrcyB0aGUgc2xvdCBjb25kaXRpb24uICovXG4gICAgdGhpcy5fcG9vbGVkU2xvdFdhaXRUaW1lciA9IHVuZGVmaW5lZFxuICB9XG5cbiAgLyoqIFN0YXJ0cyB0aGUgc2xvdC13YWl0ZXIgc2FmZXR5IHBvbGwgaWYgaXQgaXMgbm90IGFscmVhZHkgcnVubmluZy4gKi9cbiAgX3N0YXJ0UG9vbGVkU2xvdFdhaXRQb2xsKCkge1xuICAgIGlmICh0aGlzLl9wb29sZWRTbG90V2FpdFRpbWVyKSByZXR1cm5cblxuICAgIHRoaXMuX3Bvb2xlZFNsb3RXYWl0VGltZXIgPSBzZXRJbnRlcnZhbCgoKSA9PiB0aGlzLl93YWtlUG9vbGVkU2xvdFdhaXRlcnMoKSwgNTApXG4gICAgdGhpcy5fcG9vbGVkU2xvdFdhaXRUaW1lci51bnJlZigpXG4gIH1cblxuICAvKiogU3RvcHMgdGhlIHNsb3Qtd2FpdGVyIHNhZmV0eSBwb2xsIG9uY2Ugbm8gd2FpdGVyIGlzIHJlZ2lzdGVyZWQuICovXG4gIF9zdG9wUG9vbGVkU2xvdFdhaXRQb2xsSWZJZGxlKCkge1xuICAgIGlmICh0aGlzLl9wb29sZWRTbG90V2FpdGVycy5zaXplID4gMCB8fCAhdGhpcy5fcG9vbGVkU2xvdFdhaXRUaW1lcikgcmV0dXJuXG5cbiAgICBjbGVhckludGVydmFsKHRoaXMuX3Bvb2xlZFNsb3RXYWl0VGltZXIpXG4gICAgdGhpcy5fcG9vbGVkU2xvdFdhaXRUaW1lciA9IHVuZGVmaW5lZFxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgc3RhcnQuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIHdoZW4gY29ubmVjdGVkLlxuICAgKi9cbiAgYXN5bmMgc3RhcnQoKSB7XG4gICAgdGhpcy5zaG91bGRTdG9wID0gZmFsc2VcbiAgICB0aGlzLmlzUmV0aXJpbmcgPSBmYWxzZVxuICAgIHRoaXMuc3RvcFByb21pc2UgPSB1bmRlZmluZWRcbiAgICB0aGlzLl9yZXNldFN0b3BwZWRQcm9taXNlKClcbiAgICB0aGlzLmNvbmZpZ3VyYXRpb24gPSBhd2FpdCB0aGlzLmNvbmZpZ3VyYXRpb25Qcm9taXNlXG4gICAgdGhpcy5jb25maWd1cmF0aW9uLnNldEN1cnJlbnQoKVxuICAgIGNvbnN0IHJlc29sdmVkQ29uZmlnID0gdGhpcy5jb25maWd1cmF0aW9uLmdldEJhY2tncm91bmRKb2JzQ29uZmlnKClcbiAgICB0aGlzLmdlbmVyYXRpb25JZCA9IHRoaXMuY29uZmlndXJhdGlvbi5yZXNvbHZlQmFja2dyb3VuZEpvYnNHZW5lcmF0aW9uQ29uZmlnKHtcbiAgICAgIGdlbmVyYXRpb25JZDogdGhpcy5leHBsaWNpdEdlbmVyYXRpb25JZCxcbiAgICAgIHNvdXJjZU5hbWU6IFwiQmFja2dyb3VuZEpvYnNXb3JrZXJcIlxuICAgIH0pLmdlbmVyYXRpb25JZFxuICAgIHRoaXMud29ya2VySWQgPSB0aGlzLmdlbmVyYXRpb25JZFxuICAgICAgPyBjcmVhdGVHZW5lcmF0aW9uV29ya2VySWQoe2dlbmVyYXRpb25JZDogdGhpcy5nZW5lcmF0aW9uSWQsIHdvcmtlckluc3RhbmNlSWQ6IHRoaXMud29ya2VySW5zdGFuY2VJZH0pXG4gICAgICA6IHRoaXMud29ya2VySW5zdGFuY2VJZFxuICAgIHRoaXMuaG9zdCB8fD0gcmVzb2x2ZWRDb25maWcuaG9zdFxuICAgIGlmICh0eXBlb2YgdGhpcy5wb3J0ICE9PSBcIm51bWJlclwiKSB0aGlzLnBvcnQgPSByZXNvbHZlZENvbmZpZy5wb3J0XG4gICAgYXdhaXQgdGhpcy5jb25maWd1cmF0aW9uLmluaXRpYWxpemUoe3R5cGU6IFwiYmFja2dyb3VuZC1qb2JzLXdvcmtlclwifSlcbiAgICBhd2FpdCB0aGlzLmNvbmZpZ3VyYXRpb24uY29ubmVjdEJlYWNvbih7cGVlclR5cGU6IFwiYmFja2dyb3VuZC1qb2JzLXdvcmtlclwifSlcblxuICAgIC8vIENvbnN0cnVjdG9yIG92ZXJyaWRlcyB3aW47IG90aGVyd2lzZSBwaWNrIHVwIHRoZSBjb25maWd1cmVkIGNhcHMuXG4gICAgaWYgKHR5cGVvZiB0aGlzLm1heENvbmN1cnJlbnRJbmxpbmVKb2JzT3ZlcnJpZGUgIT09IFwibnVtYmVyXCIpIHtcbiAgICAgIGNvbnN0IGNvbmZpZyA9IHRoaXMuY29uZmlndXJhdGlvbi5nZXRCYWNrZ3JvdW5kSm9ic0NvbmZpZygpXG5cbiAgICAgIHRoaXMubWF4Q29uY3VycmVudElubGluZUpvYnMgPSBjb25maWcubWF4Q29uY3VycmVudElubGluZUpvYnMgfHwgdGhpcy5tYXhDb25jdXJyZW50SW5saW5lSm9ic1xuICAgIH1cbiAgICBpZiAodHlwZW9mIHRoaXMubWF4Q29uY3VycmVudEZvcmtlZEpvYnNPdmVycmlkZSAhPT0gXCJudW1iZXJcIikge1xuICAgICAgY29uc3QgY29uZmlnID0gdGhpcy5jb25maWd1cmF0aW9uLmdldEJhY2tncm91bmRKb2JzQ29uZmlnKClcblxuICAgICAgdGhpcy5tYXhDb25jdXJyZW50Rm9ya2VkSm9icyA9IGNvbmZpZy5tYXhDb25jdXJyZW50Rm9ya2VkSm9icyB8fCB0aGlzLm1heENvbmN1cnJlbnRGb3JrZWRKb2JzXG4gICAgfVxuICAgIGNvbnN0IHBvb2xDb25maWcgPSB0aGlzLmNvbmZpZ3VyYXRpb24uZ2V0QmFja2dyb3VuZEpvYnNDb25maWcoKVxuICAgIGlmICh0eXBlb2YgdGhpcy5wb29sZWRSdW5uZXJDb3VudE92ZXJyaWRlICE9PSBcIm51bWJlclwiKSB0aGlzLnBvb2xlZFJ1bm5lckNvdW50ID0gcG9vbENvbmZpZy5wb29sZWRSdW5uZXJDb3VudFxuICAgIGlmICh0eXBlb2YgdGhpcy5wb29sZWRSdW5uZXJDb25jdXJyZW5jeU92ZXJyaWRlICE9PSBcIm51bWJlclwiKSB0aGlzLnBvb2xlZFJ1bm5lckNvbmN1cnJlbmN5ID0gcG9vbENvbmZpZy5wb29sZWRSdW5uZXJDb25jdXJyZW5jeVxuICAgIGlmICh0eXBlb2YgdGhpcy5wb29sZWRSdW5uZXJNYXhKb2JzT3ZlcnJpZGUgIT09IFwibnVtYmVyXCIpIHRoaXMucG9vbGVkUnVubmVyTWF4Sm9icyA9IHBvb2xDb25maWcucG9vbGVkUnVubmVyTWF4Sm9ic1xuICAgIGlmICh0eXBlb2YgdGhpcy5wb29sZWRSdW5uZXJNYXhSc3NCeXRlc092ZXJyaWRlICE9PSBcIm51bWJlclwiKSB0aGlzLnBvb2xlZFJ1bm5lck1heFJzc0J5dGVzID0gcG9vbENvbmZpZy5wb29sZWRSdW5uZXJNYXhSc3NCeXRlc1xuICAgIGlmICh0eXBlb2YgdGhpcy5wb29sZWRSdW5uZXJNYXhMaWZldGltZU1zT3ZlcnJpZGUgIT09IFwibnVtYmVyXCIpIHRoaXMucG9vbGVkUnVubmVyTWF4TGlmZXRpbWVNcyA9IHBvb2xDb25maWcucG9vbGVkUnVubmVyTWF4TGlmZXRpbWVNc1xuXG4gICAgdGhpcy5zdGF0dXNSZXBvcnRlciA9IG5ldyBCYWNrZ3JvdW5kSm9ic1N0YXR1c1JlcG9ydGVyKHtcbiAgICAgIGNvbmZpZ3VyYXRpb246IHRoaXMuY29uZmlndXJhdGlvbixcbiAgICAgIGhvc3Q6IHRoaXMuaG9zdCxcbiAgICAgIHBvcnQ6IHRoaXMucG9ydCxcbiAgICAgIGdlbmVyYXRpb25IYW5kc2hha2VUaW1lb3V0TXM6IHRoaXMuZ2VuZXJhdGlvbkhhbmRzaGFrZVRpbWVvdXRNcyxcbiAgICAgIGdlbmVyYXRpb25JZDogdGhpcy5nZW5lcmF0aW9uSWRcbiAgICB9KVxuICAgIHRyeSB7XG4gICAgICBhd2FpdCB0aGlzLl9jb25uZWN0KHthbGxvd1JlY29ubmVjdDogZmFsc2V9KVxuICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICBsZXQgY2xlYW51cEVycm9yXG5cbiAgICAgIHRyeSB7XG4gICAgICAgIGF3YWl0IHRoaXMuc3RvcCgpXG4gICAgICB9IGNhdGNoIChjYXVnaHRDbGVhbnVwRXJyb3IpIHtcbiAgICAgICAgY2xlYW51cEVycm9yID0gY2F1Z2h0Q2xlYW51cEVycm9yXG4gICAgICB9XG5cbiAgICAgIGlmIChjbGVhbnVwRXJyb3IpIHtcbiAgICAgICAgdGhyb3cgbmV3IEFnZ3JlZ2F0ZUVycm9yKFxuICAgICAgICAgIFtlcnJvciwgY2xlYW51cEVycm9yXSxcbiAgICAgICAgICBcIkJhY2tncm91bmQgam9icyB3b3JrZXIgc3RhcnR1cCBhbmQgY2xlYW51cCBmYWlsZWRcIixcbiAgICAgICAgICB7Y2F1c2U6IGVycm9yfVxuICAgICAgICApXG4gICAgICB9XG5cbiAgICAgIHRocm93IGVycm9yXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIEdyYWNlZnVsbHkgc3RvcHMgdGhlIHdvcmtlcjogYW5ub3VuY2VzIGRyYWluaW5nIHRvIHRoZSBtYWluIHByb2Nlc3Mgc29cbiAgICogbm8gbmV3IGpvYnMgYXJlIGRpc3BhdGNoZWQsIHdhaXRzIGZvciBpbi1mbGlnaHQgaW5saW5lIGpvYnMgYW5kIHByb2Nlc3NcbiAgICogcnVubmVycyB0byBmaW5pc2ggKHNvIHRoZWlyIHJlc3VsdHMgY2FuIGJlIHJlcG9ydGVkKSwgdGhlbiBjbG9zZXMgdGhlXG4gICAqIHNvY2tldCBhbmQgZGlzY29ubmVjdHMgZnJvbSB0aGUgYmVhY29uLlxuICAgKlxuICAgKiBQcm9jZXNzIHJ1bm5lcnMgYXJlIGNoaWxkIHByb2Nlc3Nlcy4gV2hlbiBhIGB0aW1lb3V0TXNgIGlzIGdpdmVuIChlLmcuIGFcbiAgICogZGVwbG95IGRyYWluaW5nIHRoZSBvbGQgcmVsZWFzZSkgYW55IHJ1bm5lciBzdGlsbCBhbGl2ZSBhZnRlciB0aGUgZHJhaW5cbiAgICogd2luZG93IGlzIHRlcm1pbmF0ZWQgKFNJR1RFUk0sIHRoZW4gU0lHS0lMTCkgcmF0aGVyIHRoYW4gbGVmdCB0byBvcnBoYW5cbiAgICogYWNyb3NzIHRoZSBkZXBsb3kuIFdpdGggbm8gYHRpbWVvdXRNc2AgdGhlIGRyYWluIHdhaXRzIGZvciBydW5uZXJzIHRvXG4gICAqIGZpbmlzaCBvbiB0aGVpciBvd24uXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBbYXJnc10gLSBPcHRpb25zLlxuICAgKiBAcGFyYW0ge251bWJlcn0gW2FyZ3MudGltZW91dE1zXSAtIE1heCB3YWl0IGZvciBpbi1mbGlnaHQgam9icyAocGVyIHBoYXNlKSBpbiBtcy5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgd2hlbiBzdG9wcGVkLlxuICAgKi9cbiAgc3RvcCh7dGltZW91dE1zfSA9IHt9KSB7XG4gICAgY29uc3Qgc3RvcFByb21pc2UgPSB0aGlzLnN0b3BQcm9taXNlIHx8IHRoaXMuX3N0b3Aoe3RpbWVvdXRNc30pXG5cbiAgICBpZiAoIXRoaXMuc3RvcFByb21pc2UpIHtcbiAgICAgIHRoaXMuc3RvcFByb21pc2UgPSBzdG9wUHJvbWlzZVxuICAgICAgdm9pZCBzdG9wUHJvbWlzZS50aGVuKHRoaXMuX3Jlc29sdmVTdG9wcGVkLCAoZXJyb3IpID0+IHtcbiAgICAgICAgdGhpcy5fcmVqZWN0U3RvcHBlZChlcnJvciBpbnN0YW5jZW9mIEVycm9yID8gZXJyb3IgOiBuZXcgRXJyb3IoU3RyaW5nKGVycm9yKSkpXG4gICAgICB9KVxuICAgIH1cblxuICAgIHJldHVybiBzdG9wUHJvbWlzZVxuICB9XG5cbiAgLyoqXG4gICAqIFdhaXRzIGZvciBhdXRvbWF0aWMgb3IgcmVxdWVzdGVkIHN0b3AuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIHdoZW4gdGhpcyB3b3JrZXIgaGFzIGZ1bGx5IHN0b3BwZWQuXG4gICAqL1xuICB3YWl0VW50aWxTdG9wcGVkKCkgeyByZXR1cm4gdGhpcy5fc3RvcHBlZFByb21pc2UgfVxuXG4gIC8qKiBSZXNldHMgdGhlIHN0b3Agb2JzZXJ2YXRpb24gcHJvbWlzZSBmb3IgYSBuZXcgd29ya2VyIHN0YXJ0LiAqL1xuICBfcmVzZXRTdG9wcGVkUHJvbWlzZSgpIHtcbiAgICB0aGlzLl9zdG9wcGVkUHJvbWlzZSA9IG5ldyBQcm9taXNlKChyZXNvbHZlLCByZWplY3QpID0+IHtcbiAgICAgIHRoaXMuX3Jlc29sdmVTdG9wcGVkID0gcmVzb2x2ZVxuICAgICAgdGhpcy5fcmVqZWN0U3RvcHBlZCA9IHJlamVjdFxuICAgIH0pXG4gICAgdm9pZCB0aGlzLl9zdG9wcGVkUHJvbWlzZS5jYXRjaCgoKSA9PiB7fSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHRoZSB3b3JrZXIgc2h1dGRvd24gbGlmZWN5Y2xlIG9uY2UuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBbYXJnc10gLSBPcHRpb25zLlxuICAgKiBAcGFyYW0ge251bWJlcn0gW2FyZ3MudGltZW91dE1zXSAtIE1heCB3YWl0IGZvciBpbi1mbGlnaHQgam9icyAocGVyIHBoYXNlKSBpbiBtcy5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgd2hlbiBzdG9wcGVkLlxuICAgKi9cbiAgYXN5bmMgX3N0b3Aoe3RpbWVvdXRNc30gPSB7fSkge1xuICAgIHRoaXMuc2hvdWxkU3RvcCA9IHRydWVcbiAgICB0aGlzLmlzUmV0aXJpbmcgPSB0cnVlXG4gICAgdGhpcy5fc3RvcEhlYXJ0YmVhdCgpXG4gICAgaWYgKHRoaXMuX3JlY29ubmVjdFRpbWVyKSB7XG4gICAgICBjbGVhclRpbWVvdXQodGhpcy5fcmVjb25uZWN0VGltZXIpXG4gICAgICB0aGlzLl9yZWNvbm5lY3RUaW1lciA9IHVuZGVmaW5lZFxuICAgIH1cblxuICAgIGF3YWl0IHNodXRkb3duTGlmZWN5Y2xlKHtcbiAgICAgIG9uU3RvcHBlZDogdGhpcy5vblN0b3BwZWQsXG4gICAgICBzaHV0ZG93bjogYXN5bmMgKCkgPT4ge1xuICAgICAgICAvLyBBbm5vdW5jZSBkcmFpbiBzbyBtYWluIHN0b3BzIGRpc3BhdGNoaW5nIGJ1dCBrZWVwcyB0aGUgY29ubmVjdGlvblxuICAgICAgICAvLyBvcGVuIHVudGlsIHdlIGNsb3NlIGl0IG91cnNlbHZlcyBiZWxvdy5cbiAgICAgICAgaWYgKHRoaXMuanNvblNvY2tldCkge1xuICAgICAgICAgIHRyeSB7XG4gICAgICAgICAgICB0aGlzLmpzb25Tb2NrZXQuc2VuZCh7dHlwZTogXCJkcmFpbmluZ1wifSlcbiAgICAgICAgICB9IGNhdGNoIHtcbiAgICAgICAgICAgIC8vIFNvY2tldCBtYXkgYWxyZWFkeSBiZSBjbG9zaW5nOyBub3RoaW5nIHRvIGRvLlxuICAgICAgICAgIH1cbiAgICAgICAgfVxuXG4gICAgICAgIGF3YWl0IHRoaXMuX2RyYWluSW5mbGlnaHQodGhpcy5pbmZsaWdodElubGluZUpvYnMsIHRpbWVvdXRNcylcbiAgICAgICAgYXdhaXQgdGhpcy5fZHJhaW5JbmZsaWdodCh0aGlzLmluZmxpZ2h0UG9vbGVkSm9icywgdGltZW91dE1zKVxuICAgICAgICBhd2FpdCB0aGlzLl9kcmFpbkluZmxpZ2h0KHRoaXMuaW5mbGlnaHRQcm9jZXNzSm9icywgdGltZW91dE1zKVxuICAgICAgICBhd2FpdCB0aGlzLl90ZXJtaW5hdGVQcm9jZXNzQ2hpbGRyZW4oKVxuICAgICAgICAvLyBHaXZlIGluLWZsaWdodCByZXN1bHQgcmVwb3J0cyAobm93IGRlY291cGxlZCBmcm9tIGpvYiBzbG90cykgYSBib3VuZGVkXG4gICAgICAgIC8vIGNoYW5jZSB0byBsYW5kIGJlZm9yZSB0aGUgc29ja2V0IGNsb3Nlcy5cbiAgICAgICAgYXdhaXQgdGhpcy5fZHJhaW5JbmZsaWdodCh0aGlzLmluZmxpZ2h0UmVwb3J0cywgdGltZW91dE1zKVxuXG4gICAgICAgIGlmICh0aGlzLmpzb25Tb2NrZXQpIHRoaXMuanNvblNvY2tldC5jbG9zZSgpXG4gICAgICAgIGlmICghdGhpcy5jb25maWd1cmF0aW9uKSByZXR1cm5cblxuICAgICAgICBhd2FpdCB0aGlzLl9jbG9zZUNvbmZpZ3VyYXRpb24oKVxuICAgICAgfVxuICAgIH0pXG4gIH1cblxuICAvKiogQmVnaW5zIGdlbmVyYXRpb24gcmV0aXJlbWVudCB3aXRob3V0IHJldm9raW5nIGxpdmVuZXNzIGR1cmluZyB0aGUgZHJhaW4uICovXG4gIF9iZWdpbkdlbmVyYXRpb25SZXRpcmVtZW50KCkge1xuICAgIGlmICh0aGlzLnN0b3BQcm9taXNlKSByZXR1cm5cblxuICAgIHRoaXMuaXNSZXRpcmluZyA9IHRydWVcbiAgICBjb25zdCBzdG9wUHJvbWlzZSA9IHRoaXMuX3N0b3BBZnRlckdlbmVyYXRpb25EcmFpbigpXG4gICAgdGhpcy5zdG9wUHJvbWlzZSA9IHN0b3BQcm9taXNlXG4gICAgdm9pZCBzdG9wUHJvbWlzZS50aGVuKHRoaXMuX3Jlc29sdmVTdG9wcGVkLCAoZXJyb3IpID0+IHtcbiAgICAgIGNvbnN0IG5vcm1hbGl6ZWRFcnJvciA9IGVycm9yIGluc3RhbmNlb2YgRXJyb3IgPyBlcnJvciA6IG5ldyBFcnJvcihTdHJpbmcoZXJyb3IpKVxuXG4gICAgICB0aGlzLl9yZWplY3RTdG9wcGVkKG5vcm1hbGl6ZWRFcnJvcilcbiAgICAgIHRoaXMuX3JlcG9ydExpZmVjeWNsZUVycm9yKG5vcm1hbGl6ZWRFcnJvcilcbiAgICB9KVxuICB9XG5cbiAgLyoqXG4gICAqIERyYWlucyBhY2NlcHRlZCBnZW5lcmF0aW9uIHdvcmsgd2hpbGUgcmV0YWluaW5nIHRoZSBleGFjdCBjb25uZWN0aW9uIGFuZFxuICAgKiBoZWFydGJlYXQsIHRoZW4gcGVyZm9ybXMgdGhlIGZpbmFsIHRlcm1pbmF0aW5nIHN0b3AuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIGFmdGVyIHRoZSB3b3JrZXIgaGFzIGZ1bGx5IGNsb3NlZC5cbiAgICovXG4gIGFzeW5jIF9zdG9wQWZ0ZXJHZW5lcmF0aW9uRHJhaW4oKSB7XG4gICAgaWYgKHRoaXMuanNvblNvY2tldCkge1xuICAgICAgdHJ5IHtcbiAgICAgICAgdGhpcy5qc29uU29ja2V0LnNlbmQoe3R5cGU6IFwiZHJhaW5pbmdcIn0pXG4gICAgICB9IGNhdGNoIHtcbiAgICAgICAgLy8gVGhlIGNsb3NlIGhhbmRsZXIgb3ducyBleGFjdCBzYW1lLWdlbmVyYXRpb24gcmVjb25uZWN0LlxuICAgICAgfVxuICAgIH1cblxuICAgIGF3YWl0IHRoaXMuX2RyYWluSW5mbGlnaHQodGhpcy5pbmZsaWdodElubGluZUpvYnMpXG4gICAgYXdhaXQgdGhpcy5fZHJhaW5JbmZsaWdodCh0aGlzLmluZmxpZ2h0UG9vbGVkSm9icylcbiAgICBhd2FpdCB0aGlzLl9kcmFpbkluZmxpZ2h0KHRoaXMuaW5mbGlnaHRQcm9jZXNzSm9icylcbiAgICBhd2FpdCB0aGlzLl9kcmFpbkluZmxpZ2h0KHRoaXMuaW5mbGlnaHRSZXBvcnRzKVxuXG4gICAgdGhpcy5zaG91bGRTdG9wID0gdHJ1ZVxuICAgIHRoaXMuX3N0b3BIZWFydGJlYXQoKVxuICAgIGlmICh0aGlzLl9yZWNvbm5lY3RUaW1lcikge1xuICAgICAgY2xlYXJUaW1lb3V0KHRoaXMuX3JlY29ubmVjdFRpbWVyKVxuICAgICAgdGhpcy5fcmVjb25uZWN0VGltZXIgPSB1bmRlZmluZWRcbiAgICB9XG4gICAgYXdhaXQgdGhpcy5fdGVybWluYXRlUHJvY2Vzc0NoaWxkcmVuKClcblxuICAgIGF3YWl0IHNodXRkb3duTGlmZWN5Y2xlKHtcbiAgICAgIG9uU3RvcHBlZDogdGhpcy5vblN0b3BwZWQsXG4gICAgICBzaHV0ZG93bjogYXN5bmMgKCkgPT4ge1xuICAgICAgICBpZiAodGhpcy5qc29uU29ja2V0KSB0aGlzLmpzb25Tb2NrZXQuY2xvc2UoKVxuICAgICAgICBpZiAoIXRoaXMuY29uZmlndXJhdGlvbikgcmV0dXJuXG5cbiAgICAgICAgYXdhaXQgdGhpcy5fY2xvc2VDb25maWd1cmF0aW9uKClcbiAgICAgIH1cbiAgICB9KVxuICB9XG5cbiAgLyoqXG4gICAqIENsb3NlcyBhcHBsaWNhdGlvbiByZXNvdXJjZXMgYmVmb3JlIGZyYW1ld29yayByZXNvdXJjZXMgd2hlbiB0aGlzIHdvcmtlciBvd25zIHRoZW0uXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIGFmdGVyIGV2ZXJ5IG93bmVkIGNsb3NlIHN1Y2NlZWRzLlxuICAgKi9cbiAgYXN5bmMgX2Nsb3NlQ29uZmlndXJhdGlvbigpIHtcbiAgICBjb25zdCBjb25maWd1cmF0aW9uID0gdGhpcy5jb25maWd1cmF0aW9uXG5cbiAgICBpZiAoIWNvbmZpZ3VyYXRpb24pIHJldHVyblxuXG4gICAgYXdhaXQgcnVuU2h1dGRvd25TdGVwcyh7XG4gICAgICBtZXNzYWdlOiBcIkJhY2tncm91bmQgam9icyB3b3JrZXIgYXBwbGljYXRpb24gYW5kIGZyYW1ld29yayBzaHV0ZG93biBmYWlsZWRcIixcbiAgICAgIHN0ZXBzOiBbXG4gICAgICAgIC4uLih0aGlzLmNsb3NlRGF0YWJhc2VDb25uZWN0aW9uc09uU3RvcFxuICAgICAgICAgID8gW2FzeW5jICgpID0+IGF3YWl0IGNvbmZpZ3VyYXRpb24uc2h1dGRvd24oKV1cbiAgICAgICAgICA6IFtdKSxcbiAgICAgICAgYXN5bmMgKCkgPT4gYXdhaXQgY29uZmlndXJhdGlvbi5kaXNjb25uZWN0QmVhY29uKCksXG4gICAgICAgIC4uLih0aGlzLmNsb3NlRGF0YWJhc2VDb25uZWN0aW9uc09uU3RvcFxuICAgICAgICAgID8gW2FzeW5jICgpID0+IGF3YWl0IGNvbmZpZ3VyYXRpb24uY2xvc2VEYXRhYmFzZUNvbm5lY3Rpb25zKCldXG4gICAgICAgICAgOiBbXSlcbiAgICAgIF1cbiAgICB9KVxuICB9XG5cbiAgLyoqXG4gICAqIFdhaXRzIGZvciBhIHNldCBvZiBpbi1mbGlnaHQgam9iIHByb21pc2VzIHRvIHNldHRsZSwgb3B0aW9uYWxseSBib3VuZGVkIGJ5XG4gICAqIGB0aW1lb3V0TXNgLlxuICAgKiBAcGFyYW0ge1NldDxQcm9taXNlPHZvaWQ+Pn0gaW5mbGlnaHQgLSBJbi1mbGlnaHQgam9iIHByb21pc2VzLlxuICAgKiBAcGFyYW0ge251bWJlcn0gW3RpbWVvdXRNc10gLSBNYXggd2FpdCBpbiBtczsgdW5ib3VuZGVkIHdoZW4gb21pdHRlZC5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgd2hlbiBzZXR0bGVkIG9yIHRoZSB0aW1lb3V0IGVsYXBzZXMuXG4gICAqL1xuICBhc3luYyBfZHJhaW5JbmZsaWdodChpbmZsaWdodCwgdGltZW91dE1zKSB7XG4gICAgaWYgKGluZmxpZ2h0LnNpemUgPT09IDApIHJldHVyblxuXG4gICAgY29uc3QgZHJhaW4gPSBQcm9taXNlLmFsbFNldHRsZWQoWy4uLmluZmxpZ2h0XSlcblxuICAgIGlmICh0eXBlb2YgdGltZW91dE1zID09PSBcIm51bWJlclwiICYmIHRpbWVvdXRNcyA+PSAwKSB7XG4gICAgICBsZXQgdGltZXJcbiAgICAgIGNvbnN0IHRpbWVvdXQgPSBuZXcgUHJvbWlzZSgocmVzb2x2ZSkgPT4geyB0aW1lciA9IHNldFRpbWVvdXQocmVzb2x2ZSwgdGltZW91dE1zKSB9KVxuXG4gICAgICBhd2FpdCBQcm9taXNlLnJhY2UoW2RyYWluLCB0aW1lb3V0XSlcbiAgICAgIGNsZWFyVGltZW91dCh0aW1lcilcbiAgICB9IGVsc2Uge1xuICAgICAgYXdhaXQgZHJhaW5cbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogVGVybWluYXRlcyBhbnkgcHJvY2VzcyBydW5uZXIgY2hpbGRyZW4gc3RpbGwgYWxpdmUgYWZ0ZXIgdGhlIGRyYWluIHdpbmRvdyBzb1xuICAgKiB0aGV5IGRvbid0IG91dGxpdmUgdGhlIHdvcmtlciBhcyBvcnBoYW5zLiBTSUdURVJNIGxldHMgdGhlIHJ1bm5lciBjbG9zZSBpdHNcbiAgICogY29ubmVjdGlvbnMgY2xlYW5seTsgc3Vydml2b3JzIGFyZSBTSUdLSUxMZWQgYWZ0ZXIgYSBzaG9ydCBncmFjZS5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgb25jZSBzdXJ2aXZvcnMgaGF2ZSBiZWVuIHNpZ25hbGxlZC5cbiAgICovXG4gIGFzeW5jIF90ZXJtaW5hdGVQcm9jZXNzQ2hpbGRyZW4oKSB7XG4gICAgaWYgKHRoaXMuaW5mbGlnaHRQcm9jZXNzQ2hpbGRyZW4uc2l6ZSA9PT0gMCkgcmV0dXJuXG5cbiAgICBmb3IgKGNvbnN0IGNoaWxkIG9mIHRoaXMuaW5mbGlnaHRQcm9jZXNzQ2hpbGRyZW4pIHtcbiAgICAgIGNvbnN0IHBvb2xlZFN0YXRlID0gdGhpcy5wb29sZWRDaGlsZFN0YXRlcy5nZXQoY2hpbGQpXG4gICAgICBpZiAocG9vbGVkU3RhdGUpIHtcbiAgICAgICAgdGhpcy5fcmVxdWVzdFBvb2xlZENoaWxkU2h1dGRvd24oe2NoaWxkLCByZWFzb246IFwid29ya2VyX3N0b3BcIiwgc2lnbmFsOiBcIlNJR1RFUk1cIn0pXG4gICAgICB9IGVsc2Uge1xuICAgICAgICB0cnkge1xuICAgICAgICAgIGNoaWxkLmtpbGwoXCJTSUdURVJNXCIpXG4gICAgICAgIH0gY2F0Y2gge1xuICAgICAgICAgIC8vIENoaWxkIGFscmVhZHkgZXhpdGVkOyBub3RoaW5nIHRvIGRvLlxuICAgICAgICB9XG4gICAgICB9XG4gICAgfVxuXG4gICAgYXdhaXQgbmV3IFByb21pc2UoKHJlc29sdmUpID0+IHNldFRpbWVvdXQocmVzb2x2ZSwgdGhpcy5mb3JrZWRDaGlsZFNpZ2tpbGxHcmFjZU1zKSlcblxuICAgIGZvciAoY29uc3QgY2hpbGQgb2YgdGhpcy5pbmZsaWdodFByb2Nlc3NDaGlsZHJlbikge1xuICAgICAgdHJ5IHtcbiAgICAgICAgY2hpbGQua2lsbChcIlNJR0tJTExcIilcbiAgICAgIH0gY2F0Y2gge1xuICAgICAgICAvLyBDaGlsZCBhbHJlYWR5IGV4aXRlZDsgbm90aGluZyB0byBkby5cbiAgICAgIH1cbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogQ29ubmVjdHMgdG8gdGhlIHdvcmtlcidzIHJlc29sdmVkIGVuZHBvaW50IGFuZCBjb21wbGV0ZXMgaXRzIGhlbGxvIGZlbmNlLlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIFJlY29ubmVjdCBwb2xpY3kuXG4gICAqIEBwYXJhbSB7Ym9vbGVhbn0gYXJncy5hbGxvd1JlY29ubmVjdCAtIFdoZXRoZXIgYSBmYWlsZWQgYXR0ZW1wdCBtYXkgc2NoZWR1bGUgYW5vdGhlciBjb25uZWN0aW9uLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyBhZnRlciBnZW5lcmF0aW9uIGFja25vd2xlZGdlbWVudC5cbiAgICovXG4gIGFzeW5jIF9jb25uZWN0KHthbGxvd1JlY29ubmVjdH0pIHtcbiAgICBjb25zdCBjb25maWd1cmF0aW9uID0gdGhpcy5jb25maWd1cmF0aW9uXG4gICAgaWYgKCFjb25maWd1cmF0aW9uKSB0aHJvdyBuZXcgRXJyb3IoXCJCYWNrZ3JvdW5kIGpvYnMgd29ya2VyIGNvbmZpZ3VyYXRpb24gbm90IGluaXRpYWxpemVkXCIpXG5cbiAgICBjb25zdCBjb25maWcgPSBjb25maWd1cmF0aW9uLmdldEJhY2tncm91bmRKb2JzQ29uZmlnKClcbiAgICBpZiAodGhpcy5nZW5lcmF0aW9uSWQpIHRoaXMuX2dlbmVyYXRpb25BY2NlcHRlZCA9IGZhbHNlXG4gICAgY29uc3QgaG9zdCA9IHRoaXMuaG9zdCB8fCBjb25maWcuaG9zdFxuICAgIGNvbnN0IHBvcnQgPSB0eXBlb2YgdGhpcy5wb3J0ID09PSBcIm51bWJlclwiID8gdGhpcy5wb3J0IDogY29uZmlnLnBvcnRcbiAgICBjb25zdCBzb2NrZXQgPSBuZXQuY3JlYXRlQ29ubmVjdGlvbih7aG9zdCwgcG9ydH0pXG4gICAgc29ja2V0LnNldEtlZXBBbGl2ZSh0cnVlLCBTT0NLRVRfS0VFUEFMSVZFX01TKVxuICAgIGNvbnN0IGpzb25Tb2NrZXQgPSBuZXcgSnNvblNvY2tldChzb2NrZXQpXG4gICAgdGhpcy5qc29uU29ja2V0ID0ganNvblNvY2tldFxuICAgIC8qKlxuICAgICAqIFJlc29sdmVzIHRoZSBnZW5lcmF0aW9uIGhhbmRzaGFrZS5cbiAgICAgKiBAdHlwZSB7KCkgPT4gdm9pZH1cbiAgICAgKi9cbiAgICBsZXQgcmVzb2x2ZUhhbmRzaGFrZSA9ICgpID0+IHt9XG4gICAgLyoqXG4gICAgICogUmVqZWN0cyB0aGUgZ2VuZXJhdGlvbiBoYW5kc2hha2UuXG4gICAgICogQHR5cGUgeyhlcnJvcjogRXJyb3IpID0+IHZvaWR9XG4gICAgICovXG4gICAgbGV0IHJlamVjdEhhbmRzaGFrZSA9ICgpID0+IHt9XG4gICAgbGV0IGNvbm5lY3Rpb25BY2NlcHRlZCA9IGZhbHNlXG4gICAgLyoqIEB0eXBlIHtSZXR1cm5UeXBlPHR5cGVvZiBzZXRUaW1lb3V0PiB8IHVuZGVmaW5lZH0gKi9cbiAgICBsZXQgaGFuZHNoYWtlVGltZXJcbiAgICBjb25zdCBoYW5kc2hha2UgPSBuZXcgUHJvbWlzZSgoLyoqIEB0eXBlIHsodmFsdWU6IHZvaWQpID0+IHZvaWR9ICovIHJlc29sdmUsIHJlamVjdCkgPT4ge1xuICAgICAgcmVzb2x2ZUhhbmRzaGFrZSA9IHJlc29sdmVcbiAgICAgIHJlamVjdEhhbmRzaGFrZSA9IHJlamVjdFxuICAgIH0pXG5cbiAgICAvKipcbiAgICAgKiBIYW5kbGVzIGEgYmFja2dyb3VuZCBqb2Igc29ja2V0IG1lc3NhZ2UuXG4gICAgICogQHBhcmFtIHtpbXBvcnQoXCIuL3R5cGVzLmpzXCIpLkJhY2tncm91bmRKb2JTb2NrZXRNZXNzYWdlfSBtZXNzYWdlIC0gU29ja2V0IG1lc3NhZ2UuXG4gICAgICovXG4gICAganNvblNvY2tldC5vbihcIm1lc3NhZ2VcIiwgYXN5bmMgKG1lc3NhZ2UpID0+IHtcbiAgICAgIGlmIChtZXNzYWdlPy50eXBlID09PSBcImdlbmVyYXRpb24tYWNjZXB0ZWRcIikge1xuICAgICAgICBpZiAoIXRoaXMuZ2VuZXJhdGlvbklkIHx8IG1lc3NhZ2UuZ2VuZXJhdGlvbklkICE9PSB0aGlzLmdlbmVyYXRpb25JZCkge1xuICAgICAgICAgIHJlamVjdEhhbmRzaGFrZShuZXcgRXJyb3IoXCJCYWNrZ3JvdW5kIGpvYnMgbWFpbiBhY2tub3dsZWRnZWQgYSBkaWZmZXJlbnQgZ2VuZXJhdGlvblwiKSlcbiAgICAgICAgICBqc29uU29ja2V0LmRlc3Ryb3koKVxuICAgICAgICAgIHJldHVyblxuICAgICAgICB9XG5cbiAgICAgICAgdGhpcy5fZ2VuZXJhdGlvbkFjY2VwdGVkID0gdHJ1ZVxuICAgICAgICBjb25uZWN0aW9uQWNjZXB0ZWQgPSB0cnVlXG4gICAgICAgIGlmIChoYW5kc2hha2VUaW1lcikge1xuICAgICAgICAgIGNsZWFyVGltZW91dChoYW5kc2hha2VUaW1lcilcbiAgICAgICAgICBoYW5kc2hha2VUaW1lciA9IHVuZGVmaW5lZFxuICAgICAgICB9XG4gICAgICAgIGlmIChtZXNzYWdlLmxpZmVjeWNsZVN0YXRlID09PSBcInJldGlyaW5nXCIgfHwgbWVzc2FnZS5saWZlY3ljbGVTdGF0ZSA9PT0gXCJyZXRpcmVkXCIpIHRoaXMuaXNSZXRpcmluZyA9IHRydWVcbiAgICAgICAgdGhpcy5vbkdlbmVyYXRpb25BY2NlcHRlZD8uKClcbiAgICAgICAgdGhpcy5fc2VuZFJlYWR5SWZSdW5uaW5nKClcbiAgICAgICAgdGhpcy5fc3RhcnRIZWFydGJlYXQoKVxuICAgICAgICByZXNvbHZlSGFuZHNoYWtlKClcbiAgICAgICAgcmV0dXJuXG4gICAgICB9XG5cbiAgICAgIGlmIChtZXNzYWdlPy50eXBlID09PSBcImdlbmVyYXRpb24tcmVqZWN0ZWRcIikge1xuICAgICAgICB0aGlzLnNob3VsZFN0b3AgPSB0cnVlXG4gICAgICAgIGlmIChoYW5kc2hha2VUaW1lcikgY2xlYXJUaW1lb3V0KGhhbmRzaGFrZVRpbWVyKVxuICAgICAgICByZWplY3RIYW5kc2hha2UobmV3IEVycm9yKGBCYWNrZ3JvdW5kIGpvYnMgZ2VuZXJhdGlvbiByZWplY3RlZDogJHttZXNzYWdlLnJlYXNvbn1gKSlcbiAgICAgICAganNvblNvY2tldC5kZXN0cm95KClcbiAgICAgICAgcmV0dXJuXG4gICAgICB9XG5cbiAgICAgIGlmIChtZXNzYWdlPy50eXBlID09PSBcInJldGlyZVwiKSB7XG4gICAgICAgIGlmICh0aGlzLmdlbmVyYXRpb25JZCAmJiBtZXNzYWdlLmdlbmVyYXRpb25JZCA9PT0gdGhpcy5nZW5lcmF0aW9uSWQpIHtcbiAgICAgICAgICB0aGlzLm9uUmV0aXJlTWVzc2FnZT8uKClcbiAgICAgICAgICB0aGlzLl9iZWdpbkdlbmVyYXRpb25SZXRpcmVtZW50KClcbiAgICAgICAgfVxuICAgICAgICByZXR1cm5cbiAgICAgIH1cblxuICAgICAgaWYgKG1lc3NhZ2U/LnR5cGUgPT09IFwiam9iXCIpIHtcbiAgICAgICAgYXdhaXQgdGhpcy5faGFuZGxlSm9iKG1lc3NhZ2UucGF5bG9hZClcbiAgICAgIH1cbiAgICB9KVxuXG4gICAganNvblNvY2tldC5vbihcImVycm9yXCIsIChlcnJvcikgPT4ge1xuICAgICAgY29uc29sZS5lcnJvcihcIkJhY2tncm91bmQgam9icyB3b3JrZXIgc29ja2V0IGVycm9yOlwiLCBlcnJvcilcbiAgICAgIGlmICh0aGlzLmdlbmVyYXRpb25JZCAmJiAhdGhpcy5fZ2VuZXJhdGlvbkFjY2VwdGVkKSByZWplY3RIYW5kc2hha2UoZXJyb3IpXG4gICAgfSlcblxuICAgIGpzb25Tb2NrZXQub24oXCJjbG9zZVwiLCAoKSA9PiB7XG4gICAgICBpZiAoaGFuZHNoYWtlVGltZXIpIGNsZWFyVGltZW91dChoYW5kc2hha2VUaW1lcilcbiAgICAgIHRoaXMuX3N0b3BIZWFydGJlYXQoKVxuICAgICAgaWYgKHRoaXMuanNvblNvY2tldCA9PT0ganNvblNvY2tldCkgdGhpcy5qc29uU29ja2V0ID0gdW5kZWZpbmVkXG4gICAgICBpZiAodGhpcy5nZW5lcmF0aW9uSWQgJiYgIXRoaXMuX2dlbmVyYXRpb25BY2NlcHRlZCkge1xuICAgICAgICByZWplY3RIYW5kc2hha2UobmV3IEVycm9yKFwiQmFja2dyb3VuZCBqb2JzIHNvY2tldCBjbG9zZWQgYmVmb3JlIGdlbmVyYXRpb24gYWNrbm93bGVkZ2VtZW50XCIpKVxuICAgICAgfVxuICAgICAgaWYgKHRoaXMuc2hvdWxkU3RvcCkgcmV0dXJuXG4gICAgICBpZiAoY29ubmVjdGlvbkFjY2VwdGVkIHx8IGFsbG93UmVjb25uZWN0IHx8ICF0aGlzLmdlbmVyYXRpb25JZCkgdGhpcy5fc2NoZWR1bGVSZWNvbm5lY3QoKVxuICAgIH0pXG5cbiAgICBpZiAodGhpcy5nZW5lcmF0aW9uSWQpIHtcbiAgICAgIGhhbmRzaGFrZVRpbWVyID0gc2V0VGltZW91dCgoKSA9PiB7XG4gICAgICAgIGNvbnN0IGVycm9yID0gbmV3IEJhY2tncm91bmRKb2JzR2VuZXJhdGlvbkhhbmRzaGFrZVRpbWVvdXRFcnJvcih7XG4gICAgICAgICAgZW5kcG9pbnQ6IGAke2hvc3R9OiR7cG9ydH1gLFxuICAgICAgICAgIGdlbmVyYXRpb25JZDogdGhpcy5nZW5lcmF0aW9uSWQgfHwgXCJcIixcbiAgICAgICAgICByb2xlOiBcIndvcmtlclwiLFxuICAgICAgICAgIHRpbWVvdXRNczogdGhpcy5nZW5lcmF0aW9uSGFuZHNoYWtlVGltZW91dE1zXG4gICAgICAgIH0pXG4gICAgICAgIHJlamVjdEhhbmRzaGFrZShlcnJvcilcbiAgICAgICAganNvblNvY2tldC5kZXN0cm95KClcbiAgICAgIH0sIHRoaXMuZ2VuZXJhdGlvbkhhbmRzaGFrZVRpbWVvdXRNcylcbiAgICB9XG5cbiAgICBzb2NrZXQub24oXCJjb25uZWN0XCIsICgpID0+IHtcbiAgICAgIGpzb25Tb2NrZXQuc2VuZCh7dHlwZTogXCJoZWxsb1wiLCByb2xlOiBcIndvcmtlclwiLCAuLi4odGhpcy5nZW5lcmF0aW9uSWQgPyB7Z2VuZXJhdGlvbklkOiB0aGlzLmdlbmVyYXRpb25JZH0gOiB7fSksIHN1cHBvcnRzSGFuZG9mZklkUmVwb3J0aW5nOiB0cnVlLCBzdXBwb3J0c0hlYXJ0YmVhdDogdHJ1ZSwgc3VwcG9ydHNQb29sZWQ6IHRydWUsIHdvcmtlcklkOiB0aGlzLndvcmtlcklkfSlcbiAgICAgIGlmICghdGhpcy5nZW5lcmF0aW9uSWQpIHtcbiAgICAgICAgY29ubmVjdGlvbkFjY2VwdGVkID0gdHJ1ZVxuICAgICAgICB0aGlzLl9zZW5kUmVhZHlJZlJ1bm5pbmcoKVxuICAgICAgICB0aGlzLl9zdGFydEhlYXJ0YmVhdCgpXG4gICAgICAgIHJlc29sdmVIYW5kc2hha2UoKVxuICAgICAgfVxuICAgIH0pXG5cbiAgICBpZiAodGhpcy5nZW5lcmF0aW9uSWQpIGF3YWl0IGhhbmRzaGFrZVxuICB9XG5cbiAgLyoqIFNjaGVkdWxlcyBvbmUgZmVuY2VkIHJlY29ubmVjdCB0byB0aGUgd29ya2VyJ3MgdW5jaGFuZ2VkIGVuZHBvaW50LiAqL1xuICBfc2NoZWR1bGVSZWNvbm5lY3QoKSB7XG4gICAgaWYgKHRoaXMuc2hvdWxkU3RvcCB8fCB0aGlzLl9yZWNvbm5lY3RUaW1lcikgcmV0dXJuXG5cbiAgICB0aGlzLl9yZWNvbm5lY3RUaW1lciA9IHNldFRpbWVvdXQoKCkgPT4ge1xuICAgICAgdGhpcy5fcmVjb25uZWN0VGltZXIgPSB1bmRlZmluZWRcbiAgICAgIGlmICh0aGlzLnNob3VsZFN0b3ApIHJldHVyblxuICAgICAgdm9pZCB0aGlzLl9jb25uZWN0KHthbGxvd1JlY29ubmVjdDogdHJ1ZX0pLmNhdGNoKChlcnJvcikgPT4ge1xuICAgICAgICBpZiAoIXRoaXMuc2hvdWxkU3RvcCkgY29uc29sZS5lcnJvcihcIkJhY2tncm91bmQgam9icyB3b3JrZXIgcmVjb25uZWN0IGZhaWxlZDpcIiwgZXJyb3IpXG4gICAgICB9KVxuICAgIH0sIHRoaXMucmVjb25uZWN0RGVsYXlNcylcbiAgICBpZiAodHlwZW9mIHRoaXMuX3JlY29ubmVjdFRpbWVyLnVucmVmID09PSBcImZ1bmN0aW9uXCIpIHRoaXMuX3JlY29ubmVjdFRpbWVyLnVucmVmKClcbiAgfVxuXG4gIC8qKlxuICAgKiBTdXJmYWNlcyBhbiB1bmV4cGVjdGVkIHdvcmtlciBsaWZlY3ljbGUgZmFpbHVyZSB0aHJvdWdoIHRoZSBmcmFtZXdvcmsgZXJyb3JcbiAgICogY2hhbm5lbHMgc28gYSBzdXBlcnZpc29yIGhvb2sgdGhhdCBpZ25vcmVzIHN0ZGlvIHN0aWxsIGhhcyBvYnNlcnZhYmlsaXR5LlxuICAgKiBAcGFyYW0ge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSBlcnJvciAtIFdvcmtlciBsaWZlY3ljbGUgZmFpbHVyZS5cbiAgICovXG4gIF9yZXBvcnRMaWZlY3ljbGVFcnJvcihlcnJvcikge1xuICAgIGNvbnN0IGNvbmZpZ3VyYXRpb24gPSB0aGlzLmNvbmZpZ3VyYXRpb25cbiAgICBpZiAoIWNvbmZpZ3VyYXRpb24pIHJldHVyblxuICAgIGNvbnN0IG5vcm1hbGl6ZWRFcnJvciA9IGVycm9yIGluc3RhbmNlb2YgRXJyb3IgPyBlcnJvciA6IG5ldyBFcnJvcihTdHJpbmcoZXJyb3IpKVxuICAgIGNvbnN0IHBheWxvYWQgPSB7Y29udGV4dDoge2dlbmVyYXRpb25JZDogdGhpcy5nZW5lcmF0aW9uSWQsIHN0YWdlOiBcImJhY2tncm91bmQtam9icy13b3JrZXItbGlmZWN5Y2xlXCJ9LCBlcnJvcjogbm9ybWFsaXplZEVycm9yfVxuICAgIGNvbnN0IGVycm9yRXZlbnRzID0gY29uZmlndXJhdGlvbi5nZXRFcnJvckV2ZW50cygpXG5cbiAgICBlcnJvckV2ZW50cy5lbWl0KFwiZnJhbWV3b3JrLWVycm9yXCIsIHBheWxvYWQpXG4gICAgZXJyb3JFdmVudHMuZW1pdChcImFsbC1lcnJvclwiLCB7Li4ucGF5bG9hZCwgZXJyb3JUeXBlOiBcImZyYW1ld29yay1lcnJvclwifSlcbiAgfVxuXG4gIC8qKlxuICAgKiBTZW5kcyBwZXJpb2RpYyBsaXZlbmVzcyBoZWFydGJlYXRzIHRvIHRoZSBtYWluIHNvIGEgd2VkZ2VkIG9yIHNpbGVudCB3b3JrZXJcbiAgICogY2FuIGJlIGRldGVjdGVkIGFuZCBkcm9wcGVkIHRoZXJlIChpdHMgbGVhc2VzIHJlbGVhc2VkKSBpbnN0ZWFkIG9mIGZyZWV6aW5nXG4gICAqIHRoZSBxdWV1ZSB1bnRpbCBhIGh1bWFuIG5vdGljZXMuXG4gICAqIEByZXR1cm5zIHt2b2lkfVxuICAgKi9cbiAgX3N0YXJ0SGVhcnRiZWF0KCkge1xuICAgIHRoaXMuX3N0b3BIZWFydGJlYXQoKVxuXG4gICAgdGhpcy5faGVhcnRiZWF0VGltZXIgPSBzZXRJbnRlcnZhbCgoKSA9PiB0aGlzLl9zZW5kSGVhcnRiZWF0KCksIHRoaXMuaGVhcnRiZWF0SW50ZXJ2YWxNcylcblxuICAgIGlmICh0eXBlb2YgdGhpcy5faGVhcnRiZWF0VGltZXIudW5yZWYgPT09IFwiZnVuY3Rpb25cIikgdGhpcy5faGVhcnRiZWF0VGltZXIudW5yZWYoKVxuICB9XG5cbiAgLyoqIFNlbmRzIG9uZSBsaXZlbmVzcyBoZWFydGJlYXQgd2hpbGUgdGhlIHdvcmtlciBoYXMgbm90IGZpbmFsbHkgc3RvcHBlZC4gKi9cbiAgX3NlbmRIZWFydGJlYXQoKSB7XG4gICAgaWYgKHRoaXMuc2hvdWxkU3RvcCB8fCAhdGhpcy5qc29uU29ja2V0KSByZXR1cm5cblxuICAgIHRyeSB7XG4gICAgICB0aGlzLmpzb25Tb2NrZXQuc2VuZCh7dHlwZTogXCJoZWFydGJlYXRcIiwgd29ya2VySWQ6IHRoaXMud29ya2VySWR9KVxuICAgIH0gY2F0Y2gge1xuICAgICAgLy8gU29ja2V0IGlzIGNsb3NpbmcvY2xvc2VkOyB0aGUgY2xvc2UgaGFuZGxlciBkcml2ZXMgcmVjb25uZWN0LlxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBTdG9wcyB0aGUgbGl2ZW5lc3MgaGVhcnRiZWF0IHRpbWVyLlxuICAgKiBAcmV0dXJucyB7dm9pZH1cbiAgICovXG4gIF9zdG9wSGVhcnRiZWF0KCkge1xuICAgIGlmICh0aGlzLl9oZWFydGJlYXRUaW1lcikge1xuICAgICAgY2xlYXJJbnRlcnZhbCh0aGlzLl9oZWFydGJlYXRUaW1lcilcbiAgICAgIHRoaXMuX2hlYXJ0YmVhdFRpbWVyID0gdW5kZWZpbmVkXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgaGFuZGxlIGpvYi5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL3R5cGVzLmpzXCIpLkJhY2tncm91bmRKb2JQYXlsb2FkfSBwYXlsb2FkIC0gUGF5bG9hZC5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgd2hlbiBkb25lLlxuICAgKi9cbiAgYXN5bmMgX2hhbmRsZUpvYihwYXlsb2FkKSB7XG4gICAgaWYgKCFwYXlsb2FkLmlkKSB0aHJvdyBuZXcgRXJyb3IoXCJCYWNrZ3JvdW5kIGpvYiBwYXlsb2FkIG1pc3NpbmcgaWRcIilcbiAgICAvKipcbiAgICAgKiBJZGVudGlmaWVkIHBheWxvYWQuXG4gICAgICogQHR5cGUge2ltcG9ydChcIi4vdHlwZXMuanNcIikuQmFja2dyb3VuZEpvYlBheWxvYWQgJiB7aWQ6IHN0cmluZ319ICovXG4gICAgY29uc3QgaWRlbnRpZmllZFBheWxvYWQgPSAvKiogQHR5cGUge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSAqLyAocGF5bG9hZClcblxuICAgIGNvbnN0IGV4ZWN1dGlvbk1vZGUgPSB0aGlzLl9leGVjdXRpb25Nb2RlRm9yUGF5bG9hZChpZGVudGlmaWVkUGF5bG9hZClcblxuICAgIGlmIChleGVjdXRpb25Nb2RlID09PSBcInBvb2xlZFwiKSB7XG4gICAgICB0aGlzLl9xdWV1ZVBvb2xlZEpvYihpZGVudGlmaWVkUGF5bG9hZClcbiAgICAgIHJldHVyblxuICAgIH1cblxuICAgIGlmIChleGVjdXRpb25Nb2RlICE9PSBcImlubGluZVwiKSB7XG4gICAgICB0aGlzLl90cmFja1Byb2Nlc3NKb2IodGhpcy5fc3RhcnRQcm9jZXNzSm9iKHtleGVjdXRpb25Nb2RlLCBwYXlsb2FkOiBpZGVudGlmaWVkUGF5bG9hZH0pKVxuICAgICAgcmV0dXJuXG4gICAgfVxuXG4gICAgdGhpcy5faGFuZGxlSW5saW5lSm9iKGlkZW50aWZpZWRQYXlsb2FkKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgc3RhcnQgcHJvY2VzcyBqb2IuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gT3B0aW9ucy5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL3R5cGVzLmpzXCIpLkJhY2tncm91bmRKb2JFeGVjdXRpb25Nb2RlfSBhcmdzLmV4ZWN1dGlvbk1vZGUgLSBFeGVjdXRpb24gbW9kZS5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL3R5cGVzLmpzXCIpLkJhY2tncm91bmRKb2JQYXlsb2FkICYge2lkOiBzdHJpbmd9fSBhcmdzLnBheWxvYWQgLSBQYXlsb2FkLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyB3aGVuIHRoZSBwcm9jZXNzIGpvYiBleGl0cy5cbiAgICovXG4gIF9zdGFydFByb2Nlc3NKb2Ioe2V4ZWN1dGlvbk1vZGUsIHBheWxvYWR9KSB7XG4gICAgaWYgKGV4ZWN1dGlvbk1vZGUgPT09IFwiZm9ya2VkXCIpIHJldHVybiB0aGlzLl9mb3JrSm9iKHBheWxvYWQpXG5cbiAgICByZXR1cm4gdGhpcy5fc3Bhd25Kb2IocGF5bG9hZClcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGhhbmRsZSBpbmxpbmUgam9iLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vdHlwZXMuanNcIikuQmFja2dyb3VuZEpvYlBheWxvYWQgJiB7aWQ6IHN0cmluZ319IHBheWxvYWQgLSBQYXlsb2FkLlxuICAgKiBAcmV0dXJucyB7dm9pZH1cbiAgICovXG4gIF9oYW5kbGVJbmxpbmVKb2IocGF5bG9hZCkge1xuICAgIC8vIElubGluZSBqb2JzIHNoYXJlIHRoZSB3b3JrZXIncyBwcm9jZXNzIGFuZCBEQiBwb29sLCBidXQgZWFjaCBvbmVcbiAgICAvLyBpcyBpdHMgb3duIGFzeW5jIGNoYWluIOKAlCB0aGVyZSdzIG5vIHNlbWFudGljIHJlYXNvbiB0byBzZXJpYWxpemVcbiAgICAvLyB0aGVtLiBXZSBraWNrIG9mZiB0aGUgam9iLCByZWdpc3RlciBpdCB3aXRoIGBpbmZsaWdodElubGluZUpvYnNgXG4gICAgLy8gZm9yIHNodXRkb3duIGRyYWluLCBhbmQgc2lnbmFsIGNhcGFjaXR5IHRvIG1haW46XG4gICAgLy8gLSBJZiB3ZSBzdGlsbCBoYXZlIGEgZnJlZSBzbG90IHdlIGFzayBmb3IgdGhlIG5leHQgam9iIHJpZ2h0XG4gICAgLy8gICBhd2F5LCBzbyBhIHNsb3cgam9iIChlLmcuIGEgZG9ja2VyIGFsaXZlIGNoZWNrIHRoYXQgd2FpdHMgMTVzXG4gICAgLy8gICBvbiBhIGdvbmUgc2VydmVyKSBubyBsb25nZXIgc3RhcnZlcyBldmVyeSBvdGhlciBpbmxpbmUgam9iLlxuICAgIC8vIC0gV2hlbiB0aGUgam9iIGZpbmlzaGVzLCBpZiB0aGUgd29ya2VyIGhhZCBiZWVuIGF0IHRoZSBjYXAsIHdlXG4gICAgLy8gICBhc2sgZm9yIHRoZSBuZXh0IGpvYiB0byByZWZpbGwgdGhlIHNsb3QuXG4gICAgLy8gVGhlIGJvb2trZWVwaW5nIGluIGBmaW5hbGx5KClgIHJhdGNoZXRzIGNhcGFjaXR5IGJhY2sgdXBcbiAgICAvLyByZWdhcmRsZXNzIG9mIHN1Y2Nlc3Mgb3IgZmFpbHVyZS5cbiAgICAvKipcbiAgICAgKiBEZWZpbmVzIGluZmxpZ2h0LlxuICAgICAqIEB0eXBlIHtQcm9taXNlPHZvaWQ+fSAqL1xuICAgIGxldCBpbmZsaWdodFxuXG4gICAgaW5mbGlnaHQgPSB0aGlzLl9ydW5JbmxpbmVKb2JBbmRSZXBvcnQocGF5bG9hZCkuZmluYWxseSgoKSA9PiB7XG4gICAgICB0aGlzLmluZmxpZ2h0SW5saW5lSm9icy5kZWxldGUoaW5mbGlnaHQpXG5cbiAgICAgIC8vIFJlLWFubm91bmNlIG9uIGV2ZXJ5IGNvbXBsZXRpb24gYmVsb3cgY2FwLCBub3QganVzdCB0aGUgY2Fw4oaSY2FwLTEgZWRnZSDigJRcbiAgICAgIC8vIHNlZSBfdHJhY2tQcm9jZXNzSm9iIGZvciB3aHkgdGhlIGtuaWZlLWVkZ2UgY29uZGl0aW9uIHNpbGVudGx5IHdlZGdlcy5cbiAgICAgIGlmICghdGhpcy5zaG91bGRTdG9wKSB0aGlzLl9zZW5kUmVhZHlJZlJ1bm5pbmcoKVxuICAgIH0pXG5cbiAgICB0aGlzLmluZmxpZ2h0SW5saW5lSm9icy5hZGQoaW5mbGlnaHQpXG5cbiAgICBpZiAodGhpcy5pbmZsaWdodElubGluZUpvYnMuc2l6ZSA8IHRoaXMubWF4Q29uY3VycmVudElubGluZUpvYnMpIHtcbiAgICAgIHRoaXMuX3NlbmRSZWFkeUlmUnVubmluZygpXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZXhlY3V0aW9uIG1vZGUgZm9yIHBheWxvYWQuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi90eXBlcy5qc1wiKS5CYWNrZ3JvdW5kSm9iUGF5bG9hZH0gcGF5bG9hZCAtIFBheWxvYWQuXG4gICAqIEByZXR1cm5zIHtpbXBvcnQoXCIuL3R5cGVzLmpzXCIpLkJhY2tncm91bmRKb2JFeGVjdXRpb25Nb2RlfSAtIEV4ZWN1dGlvbiBtb2RlLlxuICAgKi9cbiAgX2V4ZWN1dGlvbk1vZGVGb3JQYXlsb2FkKHBheWxvYWQpIHtcbiAgICBjb25zdCBleGVjdXRpb25Nb2RlID0gcGF5bG9hZC5vcHRpb25zPy5leGVjdXRpb25Nb2RlXG5cbiAgICByZXR1cm4gZXhlY3V0aW9uTW9kZSA/IHRoaXMuX25vcm1hbGl6ZUV4ZWN1dGlvbk1vZGUoZXhlY3V0aW9uTW9kZSkgOiBcInBvb2xlZFwiXG4gIH1cblxuICAvKipcbiAgICogUnVucyBub3JtYWxpemUgZXhlY3V0aW9uIG1vZGUuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBleGVjdXRpb25Nb2RlIC0gRXhlY3V0aW9uIG1vZGUuXG4gICAqIEByZXR1cm5zIHtpbXBvcnQoXCIuL3R5cGVzLmpzXCIpLkJhY2tncm91bmRKb2JFeGVjdXRpb25Nb2RlfSAtIE5vcm1hbGl6ZWQgZXhlY3V0aW9uIG1vZGUuXG4gICAqL1xuICBfbm9ybWFsaXplRXhlY3V0aW9uTW9kZShleGVjdXRpb25Nb2RlKSB7XG4gICAgZm9yIChjb25zdCBtb2RlIG9mIEVYRUNVVElPTl9NT0RFUykge1xuICAgICAgaWYgKG1vZGUgPT09IGV4ZWN1dGlvbk1vZGUpIHJldHVybiBtb2RlXG4gICAgfVxuXG4gICAgdGhyb3cgbmV3IEVycm9yKGBJbnZhbGlkIGJhY2tncm91bmQgam9iIGV4ZWN1dGlvbk1vZGU6ICR7ZXhlY3V0aW9uTW9kZX1gKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgdHJhY2sgcHJvY2VzcyBqb2IuXG4gICAqIEBwYXJhbSB7UHJvbWlzZTx2b2lkPn0gcHJvY2Vzc0pvYiAtIFByb2Nlc3Mgam9iIHByb21pc2UuXG4gICAqIEByZXR1cm5zIHt2b2lkfVxuICAgKi9cbiAgX3RyYWNrUHJvY2Vzc0pvYihwcm9jZXNzSm9iKSB7XG4gICAgLyoqXG4gICAgICogRGVmaW5lcyBpbmZsaWdodC5cbiAgICAgKiBAdHlwZSB7UHJvbWlzZTx2b2lkPn0gKi9cbiAgICBsZXQgaW5mbGlnaHRcblxuICAgIGluZmxpZ2h0ID0gcHJvY2Vzc0pvYi5maW5hbGx5KCgpID0+IHtcbiAgICAgIHRoaXMuaW5mbGlnaHRQcm9jZXNzSm9icy5kZWxldGUoaW5mbGlnaHQpXG5cbiAgICAgIC8vIFJlLWFubm91bmNlIHJlYWRpbmVzcyBvbiBFVkVSWSBjb21wbGV0aW9uIHRoYXQgbGVhdmVzIHVzIGJlbG93IGNhcCDigJQgbm90XG4gICAgICAvLyBqdXN0IHRoZSBzaW5nbGUgY2Fw4oaSY2FwLTEgZWRnZS4gVGhlIG1haW4gcmVtb3ZlcyBhIHdvcmtlciBmcm9tIGl0cyByZWFkeVxuICAgICAgLy8gc2V0IG9uIGVhY2ggZGlzcGF0Y2ggKGBfZHJhaW5PbmNlYCkgYW5kIG9ubHkgcmUtYWRkcyBpdCBvbiBhIGZyZXNoXG4gICAgICAvLyBcInJlYWR5XCI7IGdhdGluZyB0aGUgcmUtYW5ub3VuY2Ugb24gb25lIGtuaWZlLWVkZ2UgdHJhbnNpdGlvbiBtZWFucyBhXG4gICAgICAvLyBzaW5nbGUgbWlzc2VkIG9yIGxvc3Qgc2lnbmFsIGxlYXZlcyB0aGUgd29ya2VyIG91dCBvZiB0aGUgcmVhZHkgc2V0IGFuZFxuICAgICAgLy8gd2VkZ2VzIGRpc3BhdGNoIGNsdXN0ZXItd2lkZS4gVGhpcyB3YXMgdGhlIHNpbGVudC1mcmVlemUgcm9vdCBjYXVzZS5cbiAgICAgIC8vIGBfc2VuZFJlYWR5SWZSdW5uaW5nYCBzZWxmLWd1YXJkcyAoaXQgc2VuZHMgbm90aGluZyB3aGVuIHRoZSB3b3JrZXIgaXNcbiAgICAgIC8vIGdlbnVpbmVseSBhdCBjYXBhY2l0eSksIHNvIHJlLWFubm91bmNpbmcgb24gZXZlcnkgZnJlZWQgc2xvdCBpcyBzYWZlIGFuZFxuICAgICAgLy8gaWRlbXBvdGVudCBvbiB0aGUgbWFpbi5cbiAgICAgIGlmICghdGhpcy5zaG91bGRTdG9wKSB0aGlzLl9zZW5kUmVhZHlJZlJ1bm5pbmcoKVxuICAgIH0pXG5cbiAgICB0aGlzLmluZmxpZ2h0UHJvY2Vzc0pvYnMuYWRkKGluZmxpZ2h0KVxuICAgIHRoaXMuX3NlbmRSZWFkeUlmUnVubmluZygpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBydW4gaW5saW5lIGpvYiBhbmQgcmVwb3J0LlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vdHlwZXMuanNcIikuQmFja2dyb3VuZEpvYlBheWxvYWQgJiB7aWQ6IHN0cmluZ319IHBheWxvYWQgLSBQYXlsb2FkIHdpdGggcmVxdWlyZWQgaWQuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIHdoZW4gY29tcGxldGUgKHN1Y2Nlc3Mgb3IgZmFpbHVyZSByZXBvcnRlZCkuXG4gICAqL1xuICBhc3luYyBfcnVuSW5saW5lSm9iQW5kUmVwb3J0KHBheWxvYWQpIHtcbiAgICAvLyBSZXBvcnQgaW4gdGhlIGJhY2tncm91bmQgc28gZnJlZWluZyB0aGlzIGlubGluZSBzbG90IG5ldmVyIHdhaXRzIG9uIHRoZVxuICAgIC8vIHJlcG9ydC4gUmVwb3J0aW5nIGlzIGR1cmFibGUgKHJldHJpZWQgdW50aWwgaXQgbGFuZHMpLCBzbyBhIHRyYW5zaWVudFxuICAgIC8vIG1haW4vREIgb3V0YWdlIG5laXRoZXIgd2VkZ2VzIHRoZSBzbG90IG5vciBsb3NlcyB0aGUgdGVybWluYWwgcmVzdWx0LlxuICAgIHRyeSB7XG4gICAgICBhd2FpdCB0aGlzLl9ydW5Kb2JJbmxpbmUocGF5bG9hZClcbiAgICAgIHRoaXMuX3JlcG9ydEpvYlJlc3VsdEluQmFja2dyb3VuZCh7XG4gICAgICAgIGpvYklkOiBwYXlsb2FkLmlkLFxuICAgICAgICBzdGF0dXM6IFwiY29tcGxldGVkXCIsXG4gICAgICAgIGhhbmRvZmZJZDogcGF5bG9hZC5oYW5kb2ZmSWQsXG4gICAgICAgIGhhbmRlZE9mZkF0TXM6IHBheWxvYWQuaGFuZGVkT2ZmQXRNcyxcbiAgICAgICAgd29ya2VySWQ6IHBheWxvYWQud29ya2VySWQgfHwgdGhpcy53b3JrZXJJZFxuICAgICAgfSlcbiAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgaWYgKGVycm9yIGluc3RhbmNlb2YgQmFja2dyb3VuZEpvYlJlc2NoZWR1bGVTaWduYWwpIHtcbiAgICAgICAgdGhpcy5fcmVwb3J0Sm9iUmVzdWx0SW5CYWNrZ3JvdW5kKHtcbiAgICAgICAgICBqb2JJZDogcGF5bG9hZC5pZCxcbiAgICAgICAgICBzdGF0dXM6IFwicmVzY2hlZHVsZWRcIixcbiAgICAgICAgICBkZWxheU1zOiBlcnJvci5kZWxheU1zLFxuICAgICAgICAgIGhhbmRvZmZJZDogcGF5bG9hZC5oYW5kb2ZmSWQsXG4gICAgICAgICAgaGFuZGVkT2ZmQXRNczogcGF5bG9hZC5oYW5kZWRPZmZBdE1zLFxuICAgICAgICAgIHdvcmtlcklkOiBwYXlsb2FkLndvcmtlcklkIHx8IHRoaXMud29ya2VySWRcbiAgICAgICAgfSlcbiAgICAgICAgcmV0dXJuXG4gICAgICB9XG5cbiAgICAgIHRoaXMuX3JlcG9ydEpvYlJlc3VsdEluQmFja2dyb3VuZCh7XG4gICAgICAgIGpvYklkOiBwYXlsb2FkLmlkLFxuICAgICAgICBzdGF0dXM6IFwiZmFpbGVkXCIsXG4gICAgICAgIGVycm9yLFxuICAgICAgICBoYW5kb2ZmSWQ6IHBheWxvYWQuaGFuZG9mZklkLFxuICAgICAgICBoYW5kZWRPZmZBdE1zOiBwYXlsb2FkLmhhbmRlZE9mZkF0TXMsXG4gICAgICAgIHdvcmtlcklkOiBwYXlsb2FkLndvcmtlcklkIHx8IHRoaXMud29ya2VySWRcbiAgICAgIH0pXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIEFkdmVydGlzZXMgY3VycmVudCB3b3JrZXIgY2FwYWNpdHkgdW5sZXNzIHRoZSB3b3JrZXIgaXMgZHJhaW5pbmcuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBbb3B0aW9uc10gLSBBZHZlcnRpc2VtZW50IG9wdGlvbnMuXG4gICAqIEBwYXJhbSB7Ym9vbGVhbn0gW29wdGlvbnMucmV2b2tlUG9vbGVkQWRtaXNzaW9uXSAtIFJldm9rZSBwb29sZWQgY3JlZGl0cyB3aGlsZSBwcmVzZXJ2aW5nIG90aGVyIGV4ZWN1dGlvbiBtb2Rlcy5cbiAgICogQHJldHVybnMge3ZvaWR9XG4gICAqL1xuICBfc2VuZFJlYWR5SWZSdW5uaW5nKHtyZXZva2VQb29sZWRBZG1pc3Npb24gPSBmYWxzZX0gPSB7fSkge1xuICAgIGlmICh0aGlzLnNob3VsZFN0b3AgfHwgdGhpcy5pc1JldGlyaW5nKSByZXR1cm5cbiAgICBpZiAoIXRoaXMuanNvblNvY2tldCkgcmV0dXJuXG4gICAgaWYgKHRoaXMuZ2VuZXJhdGlvbklkICYmICF0aGlzLl9nZW5lcmF0aW9uQWNjZXB0ZWQpIHJldHVyblxuXG4gICAgY29uc3QgcmVhZHlNZXNzYWdlID0gdGhpcy5fcmVhZHlNZXNzYWdlKHtyZXZva2VQb29sZWRBZG1pc3Npb259KVxuXG4gICAgaWYgKCFyZWFkeU1lc3NhZ2UpIHJldHVyblxuICAgIHRoaXMuanNvblNvY2tldC5zZW5kKHJlYWR5TWVzc2FnZSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHJlYWR5IG1lc3NhZ2UuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBbb3B0aW9uc10gLSBBZHZlcnRpc2VtZW50IG9wdGlvbnMuXG4gICAqIEBwYXJhbSB7Ym9vbGVhbn0gW29wdGlvbnMucmV2b2tlUG9vbGVkQWRtaXNzaW9uXSAtIFJldm9rZSBwb29sZWQgY3JlZGl0cyB3aGlsZSBwcmVzZXJ2aW5nIG90aGVyIGV4ZWN1dGlvbiBtb2Rlcy5cbiAgICogQHJldHVybnMge2ltcG9ydChcIi4vdHlwZXMuanNcIikuQmFja2dyb3VuZEpvYlNvY2tldE1lc3NhZ2UgfCBudWxsfSAtIFJlYWR5IG1lc3NhZ2Ugb3IgbnVsbCB3aGVuIHRoZSB3b3JrZXIgaGFzIG5vIGNhcGFjaXR5LlxuICAgKi9cbiAgX3JlYWR5TWVzc2FnZSh7cmV2b2tlUG9vbGVkQWRtaXNzaW9uID0gZmFsc2V9ID0ge30pIHtcbiAgICBjb25zdCBhY2NlcHRzUHJvY2Vzc0pvYiA9IHRoaXMuaW5mbGlnaHRQcm9jZXNzSm9icy5zaXplIDwgdGhpcy5tYXhDb25jdXJyZW50Rm9ya2VkSm9ic1xuICAgIGNvbnN0IGFjY2VwdHNJbmxpbmUgPSB0aGlzLmluZmxpZ2h0SW5saW5lSm9icy5zaXplIDwgdGhpcy5tYXhDb25jdXJyZW50SW5saW5lSm9ic1xuICAgIGNvbnN0IGF2YWlsYWJsZVBvb2xlZFNsb3RzID0gcmV2b2tlUG9vbGVkQWRtaXNzaW9uID8gMCA6IHRoaXMuX2F2YWlsYWJsZVBvb2xlZFNsb3RzKClcbiAgICBjb25zdCBhY2NlcHRzUG9vbGVkID0gYXZhaWxhYmxlUG9vbGVkU2xvdHMgPiAwXG5cbiAgICBpZiAoIXJldm9rZVBvb2xlZEFkbWlzc2lvbiAmJiAhYWNjZXB0c1Byb2Nlc3NKb2IgJiYgIWFjY2VwdHNJbmxpbmUgJiYgIWFjY2VwdHNQb29sZWQpIHJldHVybiBudWxsXG5cbiAgICByZXR1cm4ge1xuICAgICAgdHlwZTogXCJyZWFkeVwiLFxuICAgICAgYWNjZXB0c0ZvcmtlZDogYWNjZXB0c1Byb2Nlc3NKb2IsXG4gICAgICBhY2NlcHRzSW5saW5lLFxuICAgICAgYWNjZXB0c1Bvb2xlZCxcbiAgICAgIGF2YWlsYWJsZVBvb2xlZFNsb3RzLFxuICAgICAgYWNjZXB0c1NwYXduZWQ6IGFjY2VwdHNQcm9jZXNzSm9iXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIFRyYWNrcyBhIHBvb2xlZCBqb2IgYW5kIHJlLWFkdmVydGlzZXMgY2FwYWNpdHkuXG4gICAqIEBwYXJhbSB7UHJvbWlzZTx2b2lkPn0gcG9vbGVkSm9iIC0gUG9vbGVkIGpvYiBwcm9taXNlLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBUaGUgdHJhY2tlZCBpbi1mbGlnaHQgcHJvbWlzZS5cbiAgICovXG4gIF90cmFja1Bvb2xlZEpvYihwb29sZWRKb2IpIHtcbiAgICAvKiogQHR5cGUge1Byb21pc2U8dm9pZD59ICovXG4gICAgbGV0IGluZmxpZ2h0XG4gICAgaW5mbGlnaHQgPSBwb29sZWRKb2IuZmluYWxseSgoKSA9PiB7XG4gICAgICB0aGlzLmluZmxpZ2h0UG9vbGVkSm9icy5kZWxldGUoaW5mbGlnaHQpXG4gICAgICBpZiAoIXRoaXMuc2hvdWxkU3RvcCAmJiAhdGhpcy5fcG9vbGVkU3RhcnR1cEZhaWx1cmVKb2JzLmhhcyhwb29sZWRKb2IpICYmICF0aGlzLl9wb29sZWRTdGFydHVwRmFpbHVyZUpvYnMuaGFzKGluZmxpZ2h0KSkgdGhpcy5fc2VuZFJlYWR5SWZSdW5uaW5nKClcbiAgICB9KVxuICAgIHRoaXMuaW5mbGlnaHRQb29sZWRKb2JzLmFkZChpbmZsaWdodClcbiAgICByZXR1cm4gaW5mbGlnaHRcbiAgfVxuXG4gIC8qKlxuICAgKiBTZXJpYWxpemVzIHJlcGVhdGVkIGxlYXNlcyBmb3Igb25lIGR1cmFibGUgcm93IHdoaWxlIHByZXNlcnZpbmcgcG9vbGVkXG4gICAqIGNvbmN1cnJlbmN5IGFjcm9zcyBkaWZmZXJlbnQgam9iIGlkcy5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL3R5cGVzLmpzXCIpLkJhY2tncm91bmRKb2JQYXlsb2FkICYge2lkOiBzdHJpbmd9fSBwYXlsb2FkIC0gUG9vbGVkIGpvYiBwYXlsb2FkLlxuICAgKiBAcmV0dXJucyB7dm9pZH1cbiAgICovXG4gIF9xdWV1ZVBvb2xlZEpvYihwYXlsb2FkKSB7XG4gICAgY29uc3QgcXVldWUgPSB0aGlzLnBvb2xlZEpvYlF1ZXVlcy5nZXQocGF5bG9hZC5pZClcbiAgICBpZiAocXVldWUpIHtcbiAgICAgIHF1ZXVlLnB1c2gocGF5bG9hZClcbiAgICAgIHJldHVyblxuICAgIH1cblxuICAgIHRoaXMucG9vbGVkSm9iUXVldWVzLnNldChwYXlsb2FkLmlkLCBbcGF5bG9hZF0pXG4gICAgY29uc3QgdHJhY2tlciA9IHRoaXMuX3RyYWNrUG9vbGVkSm9iKHRoaXMuX3J1blBvb2xlZEpvYlF1ZXVlKHBheWxvYWQuaWQpKVxuICAgIHRoaXMucG9vbGVkSm9iUXVldWVUcmFja2Vycy5zZXQocGF5bG9hZC5pZCwgdHJhY2tlcilcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGFkbWl0dGVkIGxlYXNlcyBmb3Igb25lIGR1cmFibGUgam9iIGlkIGluIGFycml2YWwgb3JkZXIuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBqb2JJZCAtIER1cmFibGUgam9iIGlkLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyBhZnRlciB0aGUgcGVyLWlkIHF1ZXVlIGRyYWlucy5cbiAgICovXG4gIGFzeW5jIF9ydW5Qb29sZWRKb2JRdWV1ZShqb2JJZCkge1xuICAgIGNvbnN0IHF1ZXVlID0gdGhpcy5wb29sZWRKb2JRdWV1ZXMuZ2V0KGpvYklkKVxuICAgIGlmICghcXVldWUpIHRocm93IG5ldyBFcnJvcihgUG9vbGVkIGpvYiBxdWV1ZSBtaXNzaW5nIGZvciBqb2I6ICR7am9iSWR9YClcblxuICAgIHRyeSB7XG4gICAgICB3aGlsZSAocXVldWUubGVuZ3RoID4gMCkge1xuICAgICAgICBjb25zdCBwYXlsb2FkID0gcXVldWUuc2hpZnQoKVxuICAgICAgICBpZiAoIXBheWxvYWQpIHRocm93IG5ldyBFcnJvcihgUG9vbGVkIGpvYiBxdWV1ZSBjb250YWluZWQgYW4gZW1wdHkgcGF5bG9hZCBmb3Igam9iOiAke2pvYklkfWApXG4gICAgICAgIGF3YWl0IHRoaXMuX3J1blBvb2xlZEpvYihwYXlsb2FkKVxuICAgICAgfVxuICAgIH0gZmluYWxseSB7XG4gICAgICBjb25zdCB0cmFja2VyID0gdGhpcy5wb29sZWRKb2JRdWV1ZVRyYWNrZXJzLmdldChqb2JJZClcbiAgICAgIGlmICh0cmFja2VyKSB7XG4gICAgICAgIHRoaXMuaW5mbGlnaHRQb29sZWRKb2JzLmRlbGV0ZSh0cmFja2VyKVxuICAgICAgICB0aGlzLnBvb2xlZEpvYlF1ZXVlVHJhY2tlcnMuZGVsZXRlKGpvYklkKVxuICAgICAgfVxuICAgICAgdGhpcy5wb29sZWRKb2JRdWV1ZXMuZGVsZXRlKGpvYklkKVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBIYXJkIGNhcCBvbiB0b3RhbCBsaXZlIHBvb2xlZCBjaGlsZHJlbiAod29ya2luZyArIGRyYWluaW5nKTogY2hpbGRyZW4gdGhlXG4gICAqIHBvb2wgbWF5IHN0aWxsIHNwYXduLiBDb3VudGluZyB0aGUgd2hvbGUgbGl2ZSBzZXQg4oCUIGRyYWluaW5nIGNoaWxkcmVuXG4gICAqIGluY2x1ZGVkIOKAlCBpcyB3aGF0IGJvdW5kcyBwb29sIG1lbW9yeTogYSBkcmFpbmluZyBjaGlsZCBzdGlsbCBob2xkcyBpdHNcbiAgICogUlNTIHVudGlsIGl0cyBsYXN0IGluLWZsaWdodCBqb2IgZmluaXNoZXMsIHNvIGl0IG11c3Qgb2NjdXB5IGEgY2FwIHNsb3QuXG4gICAqIEByZXR1cm5zIHtudW1iZXJ9IC0gTnVtYmVyIG9mIGNoaWxkcmVuIHRoZSBwb29sIG1heSBzdGlsbCBzcGF3bi5cbiAgICovXG4gIF9zcGF3bmFibGVQb29sZWRDaGlsZHJlbigpIHtcbiAgICByZXR1cm4gTWF0aC5tYXgoMCwgdGhpcy5wb29sZWRSdW5uZXJDb3VudCAtIHRoaXMucG9vbGVkQ2hpbGRyZW4uc2l6ZSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSZXNvbHZlcyBvbmNlIGEgbm9uLXJldGlyaW5nIHBvb2xlZCBjaGlsZCBoYXMgYSBmcmVlIGNvbmN1cnJlbmN5IHNsb3Qgb3IgdGhlXG4gICAqIHBvb2wgbWF5IHNwYXduIGEgbmV3IG9uZS4gUG9vbGVkIGpvYnMgYWRtaXR0ZWQgd2hpbGUgdGhlIHBvb2wgaXMgYXQgaXRzXG4gICAqIGhhcmQgY2FwIHdhaXQgaGVyZSBpbnN0ZWFkIG9mIHNwYXduaW5nIGFuIG92ZXItY2FwYWNpdHkgY2hpbGQ7IHRoZSB3YWtlXG4gICAqIHBvaW50cyBhcmUgdGhlIG9ubHkgY2FwYWNpdHktZnJlZWluZyB0cmFuc2l0aW9ucyAoYSBqb2Igb3V0Y29tZSBhbmQgYSBjaGlsZFxuICAgKiBleGl0KSwgc28gbm8gcG9sbGluZyBpcyBuZWVkZWQuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIHdoZW4gYSBzbG90IGlzIGF2YWlsYWJsZS5cbiAgICovXG4gIF93YWl0UG9vbGVkU2xvdCgpIHtcbiAgICB0aGlzLl9zdGFydFBvb2xlZFNsb3RXYWl0UG9sbCgpXG5cbiAgICByZXR1cm4gbmV3IFByb21pc2UoKHJlc29sdmUpID0+IHtcbiAgICAgIGNvbnN0IHdhaXRlciA9ICgpID0+IHtcbiAgICAgICAgdGhpcy5fcG9vbGVkU2xvdFdhaXRlcnMuZGVsZXRlKHdhaXRlcilcbiAgICAgICAgdGhpcy5fc3RvcFBvb2xlZFNsb3RXYWl0UG9sbElmSWRsZSgpXG4gICAgICAgIHJlc29sdmUoKVxuICAgICAgfVxuXG4gICAgICB0aGlzLl9wb29sZWRTbG90V2FpdGVycy5hZGQod2FpdGVyKVxuICAgIH0pXG4gIH1cblxuICAvKipcbiAgICogUmVzb2x2ZXMgZXZlcnkgcmVnaXN0ZXJlZCB3YWl0ZXI7IHdhaXRlcnMgcmUtY2hlY2sgdGhlIHNsb3QgY29uZGl0aW9uXG4gICAqIHRoZW1zZWx2ZXMgYW5kIG9ubHkgcHJvY2VlZCB3aGVuIGl0IGhvbGRzLlxuICAgKiBAcmV0dXJucyB7dm9pZH1cbiAgICovXG4gIF93YWtlUG9vbGVkU2xvdFdhaXRlcnMoKSB7XG4gICAgaWYgKHRoaXMuX3Bvb2xlZFNsb3RXYWl0ZXJzLnNpemUgPT09IDApIHJldHVyblxuXG4gICAgZm9yIChjb25zdCByZXNvbHZlIG9mIFsuLi50aGlzLl9wb29sZWRTbG90V2FpdGVyc10pIHJlc29sdmUoKVxuICB9XG5cbiAgLyoqXG4gICAqIEZyZWUgcG9vbGVkIHNsb3RzIGFjcm9zcyB0aGUgcG9vbDogb3BlbiBzbG90cyBpbiBub24tcmV0aXJpbmcgY2hpbGRyZW4gcGx1c1xuICAgKiB0aGUgc2xvdHMgd2UgY291bGQgYWRkIGJ5IHNwYXduaW5nIG1vcmUgY2hpbGRyZW4gdXAgdG8gdGhlIGhhcmQgY2FwIG9uIHRvdGFsXG4gICAqIGxpdmUgY2hpbGRyZW4uIFJldGlyaW5nIGNoaWxkcmVuIChkcmFpbmluZyBiZWZvcmUgcmVwbGFjZW1lbnQpIG5ldmVyXG4gICAqIGNvbnRyaWJ1dGUgY2FwYWNpdHksIGFuZCB0aGV5IGNvdW50IGFnYWluc3QgdGhlIGNhcDogd2hpbGUgb25lIGlzIHN0aWxsXG4gICAqIGRyYWluaW5nLCBubyByZXBsYWNlbWVudCBpcyBhZHZlcnRpc2VkIChvciBzcGF3bmVkKSDigJQgdGhlIHBvb2wgYWR2ZXJ0aXNlc1xuICAgKiBleGFjdGx5IHdoYXQgaXQgY2FuIHNlcnZlIGluc3RlYWQgb2YgcGhhbnRvbSBjYXBhY2l0eS5cbiAgICogQHJldHVybnMge251bWJlcn0gLSBOdW1iZXIgb2YgcG9vbGVkIGpvYnMgdGhlIHdvcmtlciBjYW4gYWNjZXB0IHJpZ2h0IG5vdy5cbiAgICovXG4gIF9hdmFpbGFibGVQb29sZWRTbG90cygpIHtcbiAgICBsZXQgb3BlbkluRXhpc3RpbmcgPSAwXG4gICAgbGV0IHF1ZXVlZFJlc2VydmF0aW9ucyA9IDBcblxuICAgIGZvciAoY29uc3QgY2hpbGQgb2YgdGhpcy5wb29sZWRDaGlsZHJlbikge1xuICAgICAgY29uc3Qgc3RhdGUgPSB0aGlzLnBvb2xlZENoaWxkU3RhdGVzLmdldChjaGlsZClcbiAgICAgIGlmICghc3RhdGUgfHwgc3RhdGUucmV0aXJpbmcpIGNvbnRpbnVlXG4gICAgICBvcGVuSW5FeGlzdGluZyArPSB0aGlzLnBvb2xlZFJ1bm5lckNvbmN1cnJlbmN5IC0gc3RhdGUuaW5mbGlnaHQuc2l6ZVxuICAgIH1cblxuICAgIGZvciAoY29uc3QgcXVldWUgb2YgdGhpcy5wb29sZWRKb2JRdWV1ZXMudmFsdWVzKCkpIHF1ZXVlZFJlc2VydmF0aW9ucyArPSBxdWV1ZS5sZW5ndGhcblxuICAgIGNvbnN0IHNwYXduYWJsZUNoaWxkcmVuID0gTWF0aC5tYXgoMCwgdGhpcy5wb29sZWRSdW5uZXJDb3VudCAtIHRoaXMucG9vbGVkQ2hpbGRyZW4uc2l6ZSlcblxuICAgIHJldHVybiBNYXRoLm1heCgwLCBvcGVuSW5FeGlzdGluZyArIHNwYXduYWJsZUNoaWxkcmVuICogdGhpcy5wb29sZWRSdW5uZXJDb25jdXJyZW5jeSAtIHF1ZXVlZFJlc2VydmF0aW9ucylcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGEgcGF5bG9hZCBvbiBhIHBvb2xlZCBjaGlsZCB3aXRoIGEgZnJlZSBjb25jdXJyZW5jeSBzbG90LCBzcGF3bmluZyBhXG4gICAqIG5ldyBjaGlsZCB3aGVuIGV2ZXJ5IG5vbi1yZXRpcmluZyBjaGlsZCBpcyBmdWxsIGFuZCB0aGUgcG9vbCBpcyBiZWxvd1xuICAgKiBgcG9vbGVkUnVubmVyQ291bnRgLiBFYWNoIGNoaWxkIHJ1bnMgdXAgdG8gYHBvb2xlZFJ1bm5lckNvbmN1cnJlbmN5YCBqb2JzIGF0XG4gICAqIG9uY2Ugb24gaXRzIG93biBldmVudCBsb29wLlxuICAgKlxuICAgKiBXaGVuIHRoZSBwb29sIGlzIGFscmVhZHkgYXQgaXRzIGhhcmQgY2FwICh0b3RhbCBsaXZlIGNoaWxkcmVuLCBkcmFpbmluZ1xuICAgKiBpbmNsdWRlZCksIHRoZSBqb2Igd2FpdHMgZm9yIGEgc2xvdCBpbnN0ZWFkIG9mIHNwYXduaW5nOiB0aGF0IGlzIHdoYXQga2VlcHNcbiAgICogdGhlIGxpdmUtY2hpbGQgY291bnQg4oCUIGFuZCB0aGVyZWZvcmUgdGhlIHBvb2wncyB0b3RhbCBSU1Mg4oCUIGJvdW5kZWQuIFRoZVxuICAgKiB3YWl0IHJlc29sdmVzIG9uIHRoZSBvbmx5IHR3byBjYXBhY2l0eS1mcmVlaW5nIHRyYW5zaXRpb25zIChhIGpvYiBvdXRjb21lLFxuICAgKiBhIGNoaWxkIGV4aXQpOyBhIHNhZmV0eSBwb2xsIGNvdmVycyBhbnl0aGluZyBtaXNzZWQuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi90eXBlcy5qc1wiKS5CYWNrZ3JvdW5kSm9iUGF5bG9hZCAmIHtpZDogc3RyaW5nfX0gcGF5bG9hZCAtIEpvYiBwYXlsb2FkLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyBhZnRlciB0aGUgZHVyYWJsZSByZXBvcnQuXG4gICAqL1xuICBhc3luYyBfcnVuUG9vbGVkSm9iKHBheWxvYWQpIHtcbiAgICAvLyBBdCB0aGUgaGFyZCBjYXAgKG5vIGZyZWUgc2xvdCwgbm8gc3Bhd25hYmxlIGNoaWxkKSB0aGUgam9iIHdhaXRzIGZvciBhXG4gICAgLy8gc2xvdCBpbnN0ZWFkIG9mIHNwYXduaW5nIGFuIG92ZXItY2FwYWNpdHkgY2hpbGQg4oCUIHRoYXQgaXMgd2hhdCBib3VuZHNcbiAgICAvLyB0aGUgbGl2ZS1jaGlsZCBjb3VudCBhbmQgdGhlIHBvb2wncyB0b3RhbCBSU1MuXG4gICAgbGV0IGNoaWxkID0gdGhpcy5fc2VsZWN0UG9vbGVkQ2hpbGQoKVxuICAgIHdoaWxlICghY2hpbGQpIHtcbiAgICAgIGlmICh0aGlzLl9zcGF3bmFibGVQb29sZWRDaGlsZHJlbigpID09PSAwKSB7XG4gICAgICAgIC8vIFNodXRkb3duOiBtYWluIG5vIGxvbmdlciBkaXNwYXRjaGVzIGFuZCBubyBzbG90IHdpbGwgZXZlciBmcmVlIOKAlFxuICAgICAgICAvLyBzdG9wIHdhaXRpbmcgc28gdGhlIHRyYWNrZWQgam9iIGNhbiBzZXR0bGUgYW5kIHRoZSBkcmFpbiBjb21wbGV0ZXMuXG4gICAgICAgIGlmICh0aGlzLnNob3VsZFN0b3ApIHJldHVyblxuICAgICAgICBhd2FpdCB0aGlzLl93YWl0UG9vbGVkU2xvdCgpXG4gICAgICAgIGNoaWxkID0gdGhpcy5fc2VsZWN0UG9vbGVkQ2hpbGQoKVxuICAgICAgICBjb250aW51ZVxuICAgICAgfVxuICAgICAgY2hpbGQgPSB0aGlzLl9zZWxlY3RQb29sZWRDaGlsZCgpIHx8IHRoaXMuX2NyZWF0ZVBvb2xlZENoaWxkKClcbiAgICB9XG5cbiAgICBjb25zdCBzdGF0ZSA9IHRoaXMucG9vbGVkQ2hpbGRTdGF0ZXMuZ2V0KGNoaWxkKVxuICAgIGlmICghc3RhdGUpIHRocm93IG5ldyBFcnJvcihcIlBvb2xlZCBydW5uZXIgc3RhdGUgbWlzc2luZ1wiKVxuXG4gICAgLy8gU3RhbXAgdGhlIHJvdW5kLXJvYmluIGN1cnNvciBzbyB0aGUgbmV4dCBkaXNwYXRjaCBwcmVmZXJzIGEgZGlmZmVyZW50IGNoaWxkLlxuICAgIHN0YXRlLmxhc3REaXNwYXRjaFNlcSA9ICsrdGhpcy5fcG9vbGVkRGlzcGF0Y2hTZXFcblxuICAgIC8qKlxuICAgICAqIFJlc29sdmVzIHRoZSBwb29sZWQgam9iIHByb21pc2UuXG4gICAgICogQHR5cGUgeyh2YWx1ZTogdm9pZCkgPT4gdm9pZH1cbiAgICAgKi9cbiAgICBsZXQgcmVzb2x2ZVBvb2xlZEpvYiA9ICgpID0+IHt9XG4gICAgY29uc3QgcG9vbGVkSm9iID0gbmV3IFByb21pc2UoKHJlc29sdmUpID0+IHsgcmVzb2x2ZVBvb2xlZEpvYiA9IHJlc29sdmUgfSlcbiAgICBjb25zdCB0aW1lb3V0VGltZXIgPSB0aGlzLl9hcm1Qb29sZWRKb2JUaW1lb3V0KHtjaGlsZCwgcGF5bG9hZH0pXG5cbiAgICBzdGF0ZS5pbmZsaWdodC5zZXQocGF5bG9hZC5pZCwge3BheWxvYWQsIHJlc29sdmU6IHJlc29sdmVQb29sZWRKb2IsIHBvb2xlZEpvYiwgdGltZW91dFRpbWVyfSlcbiAgICB0cnkge1xuICAgICAgY2hpbGQuc2VuZCh7dHlwZTogXCJqb2JcIiwgcGF5bG9hZCwgc2hhcmVkVHJhbnNhY3Rpb25Ccm9rZXI6IHRoaXMuX3Bvb2xlZEpvYlNoYXJlZFRyYW5zYWN0aW9uQnJva2VyQ29uZmlnKCl9KVxuICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICB2b2lkIHRoaXMuX2hhbmRsZVBvb2xlZENoaWxkRmFpbHVyZSh7Y2hpbGQsIGVycm9yLCBvcmlnaW46IFwiaXBjLXNlbmRcIn0pXG4gICAgfVxuXG4gICAgcmV0dXJuIHBvb2xlZEpvYlxuICB9XG5cbiAgLyoqXG4gICAqIENhcHR1cmVzIHRoZSBjdXJyZW50IHRlc3QgYXR0ZW1wdCdzIGJyb2tlciBtb2RlIGF0IGRpc3BhdGNoIHRpbWUuIEEgd2FybVxuICAgKiBwb29sZWQgY2hpbGQgbXVzdCBuZXZlciByZWx5IG9uIGl0cyBpbW11dGFibGUgZm9yay10aW1lIGVudmlyb25tZW50LlxuICAgKiBAcmV0dXJucyB7aW1wb3J0KFwiLi4vdGVzdGluZy9zaGFyZWQtdHJhbnNhY3Rpb24tcHJveHktZHJpdmVyLmpzXCIpLlNoYXJlZFRyYW5zYWN0aW9uQnJva2VySm9iQ29uZmlnfSAtIFBlci1qb2IgYnJva2VyIGNvbmZpZ3VyYXRpb24uXG4gICAqL1xuICBfcG9vbGVkSm9iU2hhcmVkVHJhbnNhY3Rpb25Ccm9rZXJDb25maWcoKSB7XG4gICAgY29uc3Qgc2VyaWFsaXplZCA9IHByb2Nlc3MuZW52LlZFTE9DSU9VU19URVNUX1NIQVJFRF9UUkFOU0FDVElPTl9CUk9LRVJcbiAgICBpZiAoIXNlcmlhbGl6ZWQpIHJldHVybiB7ZXhwZWN0ZWQ6IGZhbHNlfVxuXG4gICAgY29uc3QgY29uZmlnID0gSlNPTi5wYXJzZShCdWZmZXIuZnJvbShzZXJpYWxpemVkLCBcImJhc2U2NHVybFwiKS50b1N0cmluZyhcInV0ZjhcIikpXG4gICAgcmV0dXJuIHsuLi5jb25maWcsIGV4cGVjdGVkOiB0cnVlfVxuICB9XG5cbiAgLyoqXG4gICAqIFNlbGVjdHMgYSBwb29sZWQgY2hpbGQgdG8gcnVuIHRoZSBuZXh0IGpvYiwgb3IgdW5kZWZpbmVkIHdoZW4gZXZlcnkgbm9uLXJldGlyaW5nXG4gICAqIGNoaWxkIGlzIGFscmVhZHkgZnVsbCAodGhlIGNhbGxlciB0aGVuIGxhemlseSBzcGF3bnMgb25lKS4gQW1vbmcgY2hpbGRyZW4gd2l0aCBhXG4gICAqIGZyZWUgY29uY3VycmVuY3kgc2xvdCwgcGlja3MgdGhlIG9uZSBkaXNwYXRjaGVkIGxlYXN0IHJlY2VudGx5IOKAlCBhIHJvdW5kLXJvYmluIHRoYXRcbiAgICogc3ByZWFkcyBqb2JzIChub3RhYmx5IG11bHRpLW1pbnV0ZSBSdW5CdWlsZEpvYnMsIGVhY2ggcGlubmluZyBhIHRlbmFudCBjb25uZWN0aW9uXG4gICAqIGZvciBpdHMgd2hvbGUgcnVuKSBldmVubHkgYWNyb3NzIGNoaWxkcmVuIGluc3RlYWQgb2YgZmlyc3QtZml0IHBhY2tpbmcgdGhlIGVhcmxpZXN0XG4gICAqIG9uZSB1bnRpbCBpdCBpcyBmdWxsLiBBIGZyZXNobHkgc3Bhd25lZCBvciByZXBsYWNlbWVudCBjaGlsZCB0aGVyZWZvcmUgdGFrZXMgaXRzXG4gICAqIGZhaXIgc2hhcmUgb25lIGpvYiBhdCBhIHRpbWUgYXMgaXRzIHR1cm4gY29tZXMgdXAsIHJhdGhlciB0aGFuIGFic29yYmluZyBhIGJ1cnN0IHRvXG4gICAqIFwiY2F0Y2ggdXBcIiB0byB0aGUgb3RoZXJzLlxuICAgKiBAcmV0dXJucyB7aW1wb3J0KFwibm9kZTpjaGlsZF9wcm9jZXNzXCIpLkNoaWxkUHJvY2VzcyB8IHVuZGVmaW5lZH0gLSBUaGUgY2hvc2VuIGNoaWxkLCBvciB1bmRlZmluZWQgd2hlbiBhbGwgbm9uLXJldGlyaW5nIGNoaWxkcmVuIGFyZSBmdWxsLlxuICAgKi9cbiAgX3NlbGVjdFBvb2xlZENoaWxkKCkge1xuICAgIC8qKiBAdHlwZSB7aW1wb3J0KFwibm9kZTpjaGlsZF9wcm9jZXNzXCIpLkNoaWxkUHJvY2VzcyB8IHVuZGVmaW5lZH0gKi9cbiAgICBsZXQgc2VsZWN0ZWRcbiAgICBsZXQgc2VsZWN0ZWRTZXEgPSBJbmZpbml0eVxuXG4gICAgZm9yIChjb25zdCBjaGlsZCBvZiB0aGlzLnBvb2xlZENoaWxkcmVuKSB7XG4gICAgICBjb25zdCBzdGF0ZSA9IHRoaXMucG9vbGVkQ2hpbGRTdGF0ZXMuZ2V0KGNoaWxkKVxuXG4gICAgICBpZiAoIXN0YXRlIHx8IHN0YXRlLnJldGlyaW5nIHx8IHN0YXRlLmluZmxpZ2h0LnNpemUgPj0gdGhpcy5wb29sZWRSdW5uZXJDb25jdXJyZW5jeSkgY29udGludWVcblxuICAgICAgaWYgKHN0YXRlLmxhc3REaXNwYXRjaFNlcSA8IHNlbGVjdGVkU2VxKSB7XG4gICAgICAgIHNlbGVjdGVkID0gY2hpbGRcbiAgICAgICAgc2VsZWN0ZWRTZXEgPSBzdGF0ZS5sYXN0RGlzcGF0Y2hTZXFcbiAgICAgIH1cbiAgICB9XG5cbiAgICByZXR1cm4gc2VsZWN0ZWRcbiAgfVxuXG4gIC8qKlxuICAgKiBBcm1zIGEgcGVyLWpvYiB3YWxsLWNsb2NrIGJhY2tzdG9wIGZvciBhIHBvb2xlZCBqb2IuIEEgcG9vbGVkIGNoaWxkIGhvc3RzIG1hbnlcbiAgICogY29uY3VycmVudCBqb2JzLCBzbyBhIHNpbmdsZSBnZW51aW5lbHktaHVuZyBqb2Igd291bGQgb3RoZXJ3aXNlIHBpbiBpdHNcbiAgICogcnVubmVyJ3MgY29uY3VycmVuY3kgc2xvdCBmb3JldmVyIOKAlCB0aGUgbGlmZXRpbWUgcmVjeWNsZSBvbmx5IHJldGlyZXMgYSBjaGlsZFxuICAgKiBvbmNlIGl0cyBpbi1mbGlnaHQgc2V0IGRyYWlucywgd2hpY2ggYSBodW5nIGpvYiBuZXZlciBkb2VzLiBPbiBvdmVycnVuIHRoZVxuICAgKiB3aG9sZSBjaGlsZCBpcyB0ZXJtaW5hdGVkIHNvIHRoZSBodW5nIGpvYiAoYW5kIGl0cyBzaWJsaW5ncykgcmVxdWV1ZS4gUmV0dXJuc1xuICAgKiB0aGUgdGltZXIsIG9yIG51bGwgd2hlbiBubyB0aW1lb3V0IGlzIGNvbmZpZ3VyZWQuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gT3B0aW9ucy5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCJub2RlOmNoaWxkX3Byb2Nlc3NcIikuQ2hpbGRQcm9jZXNzfSBhcmdzLmNoaWxkIC0gUG9vbGVkIGNoaWxkLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vdHlwZXMuanNcIikuQmFja2dyb3VuZEpvYlBheWxvYWQgJiB7aWQ6IHN0cmluZ319IGFyZ3MucGF5bG9hZCAtIEpvYiBwYXlsb2FkIHdob3NlIG92ZXJydW4gaXMgZ3VhcmRlZC5cbiAgICogQHJldHVybnMge1JldHVyblR5cGU8dHlwZW9mIHNldFRpbWVvdXQ+IHwgbnVsbH0gLSBUaGUgYXJtZWQgdGltZXIsIG9yIG51bGwuXG4gICAqL1xuICBfYXJtUG9vbGVkSm9iVGltZW91dCh7Y2hpbGQsIHBheWxvYWR9KSB7XG4gICAgY29uc3QgdGltZW91dE1zID0gdGhpcy5fcmVzb2x2ZUpvYlRpbWVvdXRNcyhwYXlsb2FkLm9wdGlvbnMpXG5cbiAgICBpZiAoISh0eXBlb2YgdGltZW91dE1zID09PSBcIm51bWJlclwiICYmIHRpbWVvdXRNcyA+IDApKSByZXR1cm4gbnVsbFxuXG4gICAgcmV0dXJuIHNldFRpbWVvdXQoKCkgPT4gdGhpcy5fb25Qb29sZWRKb2JUaW1lb3V0KHtjaGlsZCwgam9iSWQ6IHBheWxvYWQuaWR9KSwgdGltZW91dE1zKVxuICB9XG5cbiAgLyoqXG4gICAqIEZpcmVkIHdoZW4gYSBwb29sZWQgam9iIG92ZXJydW5zIGl0cyB0aW1lb3V0LiBUZXJtaW5hdGVzIHRoZSBjaGlsZCBydW5uaW5nIGl0XG4gICAqIChTSUdURVJNLCB0aGVuIFNJR0tJTEwgYWZ0ZXIgdGhlIGdyYWNlKSDigJQgYSBodW5nIEpTIGpvYiBjYW5ub3QgYmUgY2FuY2VsbGVkXG4gICAqIGFueSBvdGhlciB3YXkuIFRoZSBub24tY2xlYW4gZXhpdCBmbG93cyB0aHJvdWdoIGBfaGFuZGxlUG9vbGVkQ2hpbGRGYWlsdXJlYCxcbiAgICogd2hpY2ggcmVwb3J0cyBldmVyeSBpbi1mbGlnaHQgam9iIG9uIHRoZSBjaGlsZCBmYWlsZWQgKHNvIHRoZXkgcmVxdWV1ZSkgYW5kXG4gICAqIGRyb3BzIGl0IGZyb20gdHJhY2tpbmc7IHRoZSBmYWlsdXJlIHBhdGggaW1tZWRpYXRlbHkgcmUtYWR2ZXJ0aXNlcyB0aGVcbiAgICogcmVzdWx0aW5nIGNhcGFjaXR5IG9uY2UgdGhlIHJ1bm5lciBoYXMgY29tcGxldGVkIHN0YXJ0dXAuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gT3B0aW9ucy5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCJub2RlOmNoaWxkX3Byb2Nlc3NcIikuQ2hpbGRQcm9jZXNzfSBhcmdzLmNoaWxkIC0gUG9vbGVkIGNoaWxkLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gYXJncy5qb2JJZCAtIEpvYiBpZCB0aGF0IG92ZXJyYW4uXG4gICAqIEByZXR1cm5zIHt2b2lkfVxuICAgKi9cbiAgX29uUG9vbGVkSm9iVGltZW91dCh7Y2hpbGQsIGpvYklkfSkge1xuICAgIGNvbnN0IHN0YXRlID0gdGhpcy5wb29sZWRDaGlsZFN0YXRlcy5nZXQoY2hpbGQpXG5cbiAgICAvLyBBbHJlYWR5IHNldHRsaW5nL2dvbmUsIG9yIHRoZSBqb2IgZmluaXNoZWQgaW4gdGhlIHJhY2Ugd2l0aCB0aGlzIHRpbWVyLlxuICAgIGlmICghc3RhdGUgfHwgc3RhdGUuc2V0dGxpbmcgfHwgc3RhdGUuc2h1dGRvd25SZWFzb24gfHwgIXN0YXRlLmluZmxpZ2h0Lmhhcyhqb2JJZCkpIHJldHVyblxuXG4gICAgc3RhdGUudGltZW91dEpvYklkID0gam9iSWRcbiAgICB0aGlzLl9yZXF1ZXN0UG9vbGVkQ2hpbGRTaHV0ZG93bih7Y2hpbGQsIHJlYXNvbjogXCJqb2JfdGltZW91dFwiLCBzaWduYWw6IFwiU0lHVEVSTVwifSlcblxuICAgIHN0YXRlLnRpbWVvdXRTaWdraWxsVGltZXIgPSBzZXRUaW1lb3V0KCgpID0+IHtcbiAgICAgIHRyeSB7XG4gICAgICAgIGNoaWxkLmtpbGwoXCJTSUdLSUxMXCIpXG4gICAgICB9IGNhdGNoIHtcbiAgICAgICAgLy8gQ2hpbGQgYWxyZWFkeSBleGl0ZWQ7IG5vdGhpbmcgdG8gZG8uXG4gICAgICB9XG4gICAgfSwgdGhpcy5mb3JrZWRDaGlsZFNpZ2tpbGxHcmFjZU1zKVxuICB9XG5cbiAgLyoqXG4gICAqIENyZWF0ZXMgYSByZXVzYWJsZSBwb29sZWQgY2hpbGQsIGVuZm9yY2luZyB0aGUgaGFyZCBjYXAgb24gdG90YWwgbGl2ZVxuICAgKiBjaGlsZHJlbiAod29ya2luZyArIGRyYWluaW5nKS4gUmV0dXJucyB1bmRlZmluZWQgd2hlbiB0aGUgY2FwIGlzIGFscmVhZHlcbiAgICogbWV0IOKAlCB0aGUgb25seSB3YXkgYSBuZXcgY2hpbGQgbWF5IGV4aXN0IGlzIGEgc2xvdCBiZWluZyBvcGVuLCBzbyB0aGVcbiAgICogY2FsbGVyIHJlLWNoZWNrcyBhbmQgd2FpdHMgYWdhaW4uXG4gICAqIEByZXR1cm5zIHtpbXBvcnQoXCJub2RlOmNoaWxkX3Byb2Nlc3NcIikuQ2hpbGRQcm9jZXNzIHwgdW5kZWZpbmVkfSAtIFRoZSBuZXcgY2hpbGQsIG9yIHVuZGVmaW5lZCB3aGVuIHRoZSBwb29sIGlzIGF0IGl0cyBjYXAuXG4gICAqL1xuICBfY3JlYXRlUG9vbGVkQ2hpbGQoKSB7XG4gICAgY29uc3QgY29uZmlndXJhdGlvbiA9IHRoaXMuY29uZmlndXJhdGlvblxuICAgIGlmICghY29uZmlndXJhdGlvbikgdGhyb3cgbmV3IEVycm9yKFwiQmFja2dyb3VuZCBqb2JzIHdvcmtlciBjb25maWd1cmF0aW9uIG5vdCBpbml0aWFsaXplZFwiKVxuICAgIGlmICh0aGlzLnBvb2xlZENoaWxkcmVuLnNpemUgPj0gdGhpcy5wb29sZWRSdW5uZXJDb3VudCkgcmV0dXJuIHVuZGVmaW5lZFxuICAgIGNvbnN0IGNoaWxkID0gZm9yayhQT09MRURfUlVOTkVSX0VOVFJZX1BBVEgsIFtdLCB7XG4gICAgICBjd2Q6IGNvbmZpZ3VyYXRpb24uZ2V0RGlyZWN0b3J5KCksIGV4ZWNBcmd2OiBbXSwgc3RkaW86IFtcImlnbm9yZVwiLCBcImlnbm9yZVwiLCBcImlnbm9yZVwiLCBcImlwY1wiXSxcbiAgICAgIGVudjogT2JqZWN0LmFzc2lnbih7fSwgcHJvY2Vzcy5lbnYsIHRoaXMuX2NoaWxkQmFja2dyb3VuZEpvYnNFbnZpcm9ubWVudCgpKVxuICAgIH0pXG4gICAgdGhpcy5wb29sZWRDaGlsZHJlbi5hZGQoY2hpbGQpXG4gICAgdGhpcy5pbmZsaWdodFByb2Nlc3NDaGlsZHJlbi5hZGQoY2hpbGQpXG4gICAgdGhpcy5wb29sZWRDaGlsZFN0YXRlcy5zZXQoY2hpbGQsIHtjcmVhdGVkQXRNczogRGF0ZS5ub3coKSwgam9ic1J1bjogMCwgaW5mbGlnaHQ6IG5ldyBNYXAoKSwgbGFzdERpc3BhdGNoU2VxOiAwLCByZXRpcmluZzogZmFsc2UsIHN0YXJ0ZWQ6IGZhbHNlfSlcbiAgICBjaGlsZC5vbihcIm1lc3NhZ2VcIiwgKG1lc3NhZ2UpID0+IHRoaXMuX2hhbmRsZVBvb2xlZENoaWxkTWVzc2FnZSh7Y2hpbGQsIG1lc3NhZ2V9KSlcbiAgICBjaGlsZC5vbmNlKFwiZXhpdFwiLCAoZXhpdENvZGUsIHNpZ25hbCkgPT4gdGhpcy5faGFuZGxlUG9vbGVkQ2hpbGRGYWlsdXJlKHtcbiAgICAgIGNoaWxkLFxuICAgICAgZXJyb3I6IG5ldyBFcnJvcihgUG9vbGVkIGJhY2tncm91bmQgam9iIHJ1bm5lciBleGl0ZWQ6IGNvZGU9JHtleGl0Q29kZX0gc2lnbmFsPSR7c2lnbmFsIHx8IFwibm9uZVwifWApLFxuICAgICAgZXhpdENvZGUsXG4gICAgICBvcmlnaW46IFwiZXhpdFwiLFxuICAgICAgc2lnbmFsXG4gICAgfSkpXG4gICAgY2hpbGQub25jZShcImVycm9yXCIsIChlcnJvcikgPT4gdGhpcy5faGFuZGxlUG9vbGVkQ2hpbGRGYWlsdXJlKHtcbiAgICAgIGNoaWxkLFxuICAgICAgZXJyb3IsXG4gICAgICBleGl0Q29kZTogY2hpbGQuZXhpdENvZGUsXG4gICAgICBvcmlnaW46IFwicHJvY2Vzcy1lcnJvclwiLFxuICAgICAgc2lnbmFsOiBjaGlsZC5zaWduYWxDb2RlXG4gICAgfSkpXG4gICAgY2hpbGQub25jZShcImRpc2Nvbm5lY3RcIiwgKCkgPT4ge1xuICAgICAgY29uc3Qgc3RhdGUgPSB0aGlzLnBvb2xlZENoaWxkU3RhdGVzLmdldChjaGlsZClcbiAgICAgIGlmIChzdGF0ZSkgc3RhdGUuaXBjRGlzY29ubmVjdGVkQXRNcyA/Pz0gRGF0ZS5ub3coKVxuICAgIH0pXG4gICAgcmV0dXJuIGNoaWxkXG4gIH1cblxuICAvKipcbiAgICogSGFuZGxlcyBhIHBvb2xlZCBjaGlsZCdzIHBlci1qb2IgZHVyYWJsZS1yZXBvcnQgYWNrbm93bGVkZ2VtZW50LiBBIGNoaWxkXG4gICAqIHJ1bnMgam9icyBjb25jdXJyZW50bHkgYW5kIHJlcG9ydHMgb25lIGBqb2Itb3V0Y29tZWAgcGVyIGpvYiBpZC5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBNZXNzYWdlIGRldGFpbHMuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwibm9kZTpjaGlsZF9wcm9jZXNzXCIpLkNoaWxkUHJvY2Vzc30gYXJncy5jaGlsZCAtIFBvb2xlZCBjaGlsZC5cbiAgICogQHBhcmFtIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gYXJncy5tZXNzYWdlIC0gSVBDIG1lc3NhZ2UuXG4gICAqIEByZXR1cm5zIHt2b2lkfVxuICAgKi9cbiAgX2hhbmRsZVBvb2xlZENoaWxkTWVzc2FnZSh7Y2hpbGQsIG1lc3NhZ2V9KSB7XG4gICAgaWYgKCFtZXNzYWdlIHx8IHR5cGVvZiBtZXNzYWdlICE9PSBcIm9iamVjdFwiKSByZXR1cm5cbiAgICBjb25zdCByZWNvcmQgPSAvKiogQHR5cGUge3t0eXBlPzogUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4sIGNoaWxkSW5zdGFuY2VJZD86IFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+LCBqb2JJZD86IFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+LCBhY2tub3dsZWRnZWQ/OiBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPiwgcnNzQnl0ZXM/OiBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPiwgcGVha1Jzc0J5dGVzPzogUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4sIGVycm9yPzogUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59fSAqLyAobWVzc2FnZSlcbiAgICBjb25zdCBzdGF0ZSA9IHRoaXMucG9vbGVkQ2hpbGRTdGF0ZXMuZ2V0KGNoaWxkKVxuICAgIGlmIChyZWNvcmQudHlwZSA9PT0gXCJyZWFkeVwiKSB7XG4gICAgICBpZiAoc3RhdGUpIHtcbiAgICAgICAgc3RhdGUuc3RhcnRlZCA9IHRydWVcbiAgICAgICAgaWYgKHR5cGVvZiByZWNvcmQuY2hpbGRJbnN0YW5jZUlkID09PSBcInN0cmluZ1wiKSBzdGF0ZS5jaGlsZEluc3RhbmNlSWQgPSByZWNvcmQuY2hpbGRJbnN0YW5jZUlkXG4gICAgICB9XG4gICAgICByZXR1cm5cbiAgICB9XG4gICAgaWYgKGlzQ2hpbGRTaHV0ZG93bk9ic2VydmF0aW9uTWVzc2FnZShtZXNzYWdlKSkge1xuICAgICAgaWYgKHN0YXRlKSB7XG4gICAgICAgIHN0YXRlLmNoaWxkSW5zdGFuY2VJZCA9IG1lc3NhZ2UuY2hpbGRJbnN0YW5jZUlkXG4gICAgICAgIHN0YXRlLnNodXRkb3duT2JzZXJ2YXRpb24gPSBtZXNzYWdlXG4gICAgICAgIGlmIChzdGF0ZS5zaHV0ZG93blNpZ25hbFRpbWVyKSB7XG4gICAgICAgICAgY2xlYXJUaW1lb3V0KHN0YXRlLnNodXRkb3duU2lnbmFsVGltZXIpXG4gICAgICAgICAgc3RhdGUuc2h1dGRvd25TaWduYWxUaW1lciA9IHVuZGVmaW5lZFxuICAgICAgICB9XG4gICAgICB9XG4gICAgICByZXR1cm5cbiAgICB9XG4gICAgaWYgKGlzQ2hpbGRBY2NlcHRhbmNlTWVzc2FnZShtZXNzYWdlKSkge1xuICAgICAgdGhpcy5fcmVwb3J0Q2hpbGRBY2NlcHRlZChtZXNzYWdlKVxuICAgICAgcmV0dXJuXG4gICAgfVxuICAgIGlmIChpc1Bvb2xlZENoaWxkTWVtb3J5T2JzZXJ2YXRpb25NZXNzYWdlKG1lc3NhZ2UpKSB7XG4gICAgICB0aGlzLl9oYW5kbGVQb29sZWRDaGlsZE1lbW9yeU9ic2VydmF0aW9uKHtjaGlsZCwgbWVzc2FnZX0pXG4gICAgICByZXR1cm5cbiAgICB9XG4gICAgaWYgKHJlY29yZC50eXBlICE9PSBcImpvYi1vdXRjb21lXCIgfHwgIXN0YXRlIHx8IHN0YXRlLnNldHRsaW5nIHx8IHR5cGVvZiByZWNvcmQuam9iSWQgIT09IFwic3RyaW5nXCIpIHJldHVyblxuICAgIHN0YXRlLnN0YXJ0ZWQgPSB0cnVlXG4gICAgY29uc3QgZW50cnkgPSBzdGF0ZS5pbmZsaWdodC5nZXQocmVjb3JkLmpvYklkKVxuICAgIGlmICghZW50cnkpIHJldHVyblxuXG4gICAgaWYgKGVudHJ5LnRpbWVvdXRUaW1lcikgY2xlYXJUaW1lb3V0KGVudHJ5LnRpbWVvdXRUaW1lcilcbiAgICBzdGF0ZS5pbmZsaWdodC5kZWxldGUocmVjb3JkLmpvYklkKVxuICAgIHN0YXRlLmpvYnNSdW4gKz0gMVxuICAgIGNvbnN0IHJlc29sdmUgPSBlbnRyeS5yZXNvbHZlXG5cbiAgICBpZiAocmVjb3JkLmFja25vd2xlZGdlZCA9PT0gdHJ1ZSkge1xuICAgICAgaWYgKHJlc29sdmUpIHJlc29sdmUodW5kZWZpbmVkKVxuICAgIH0gZWxzZSB7XG4gICAgICAvLyBUaGUgY2hpbGQgc3RheWVkIGFsaXZlIGJ1dCBjb3VsZCBub3QgY29uZmlybSB0aGlzIG9uZSBqb2IncyB0ZXJtaW5hbFxuICAgICAgLy8gcmVwb3J0OyByZWNsYWltIGp1c3QgdGhpcyBqb2Ig4oCUIGl0cyBjb25jdXJyZW50IHNpYmxpbmdzIGFyZSB1bmFmZmVjdGVkLlxuICAgICAgdm9pZCB0aGlzLl9yZXBvcnRKb2JSZXN1bHQoe1xuICAgICAgICBqb2JJZDogZW50cnkucGF5bG9hZC5pZCxcbiAgICAgICAgc3RhdHVzOiBcImZhaWxlZFwiLFxuICAgICAgICBlcnJvcjogbmV3IEVycm9yKHR5cGVvZiByZWNvcmQuZXJyb3IgPT09IFwic3RyaW5nXCIgPyByZWNvcmQuZXJyb3IgOiBcIlBvb2xlZCBydW5uZXIgdGVybWluYWwgcmVwb3J0IHdhcyBub3QgYWNrbm93bGVkZ2VkXCIpLFxuICAgICAgICBoYW5kb2ZmSWQ6IGVudHJ5LnBheWxvYWQuaGFuZG9mZklkLFxuICAgICAgICBoYW5kZWRPZmZBdE1zOiBlbnRyeS5wYXlsb2FkLmhhbmRlZE9mZkF0TXMsXG4gICAgICAgIHdvcmtlcklkOiBlbnRyeS5wYXlsb2FkLndvcmtlcklkIHx8IHRoaXMud29ya2VySWRcbiAgICAgIH0pLmZpbmFsbHkoKCkgPT4geyBpZiAocmVzb2x2ZSkgcmVzb2x2ZSh1bmRlZmluZWQpIH0pXG4gICAgfVxuXG4gICAgY29uc3QgcnNzQnl0ZXMgPSB0eXBlb2YgcmVjb3JkLnJzc0J5dGVzID09PSBcIm51bWJlclwiID8gcmVjb3JkLnJzc0J5dGVzIDogTnVtYmVyLlBPU0lUSVZFX0lORklOSVRZXG4gICAgLy8gVGhlIGNoaWxkJ3MgcGVhayBSU1MgKFZtSFdNKSBpcyBtb25vdG9uaWMgYW5kIG91dGxpdmVzIHRoZSBzZXR0bGVkXG4gICAgLy8gc2FtcGxlOiBhIHJhdGNoZXRlZCBidXJzdCB3b3JraW5nLXNldCBtdXN0IHJlY3ljbGUgdGhlIGNoaWxkIGV2ZW4gd2hlblxuICAgIC8vIHNldHRsZWQgUlNTIGF0IG91dGNvbWUgdGltZSBsb29rcyBtb2Rlc3QuIEEgY2hpbGQgd2l0aG91dCBwZWFrIHN1cHBvcnRcbiAgICAvLyBmYWxscyBiYWNrIHRvIHRoZSBzZXR0bGVkIHNhbXBsZS5cbiAgICBjb25zdCBwZWFrUnNzQnl0ZXMgPSB0eXBlb2YgcmVjb3JkLnBlYWtSc3NCeXRlcyA9PT0gXCJudW1iZXJcIiA/IHJlY29yZC5wZWFrUnNzQnl0ZXMgOiByc3NCeXRlc1xuICAgIGNvbnN0IHJ1bm5lckFnZU1zID0gRGF0ZS5ub3coKSAtIHN0YXRlLmNyZWF0ZWRBdE1zXG4gICAgaWYgKCFzdGF0ZS5yZXRpcmluZyAmJiAoc3RhdGUuam9ic1J1biA+PSB0aGlzLnBvb2xlZFJ1bm5lck1heEpvYnMgfHwgcGVha1Jzc0J5dGVzID49IHRoaXMucG9vbGVkUnVubmVyTWF4UnNzQnl0ZXMgfHwgcnVubmVyQWdlTXMgPj0gdGhpcy5wb29sZWRSdW5uZXJNYXhMaWZldGltZU1zIHx8IHRoaXMuc2hvdWxkU3RvcCkpIHtcbiAgICAgIHRoaXMuX2JlZ2luUmV0aXJlUG9vbGVkQ2hpbGQoY2hpbGQpXG4gICAgfVxuICAgIHRoaXMuX3Rlcm1pbmF0ZUlmRHJhaW5lZChjaGlsZClcbiAgICAvLyBBIGpvYiBvdXRjb21lIGZyZWVzIGEgY29uY3VycmVuY3kgc2xvdCBhbmQgbWF5IGRyYWluIGEgcmV0aXJpbmcgY2hpbGQg4oCUXG4gICAgLy8gdGhlIG9ubHkgdHdvIHRyYW5zaXRpb25zIHRoYXQgZnJlZSBjYXBhY2l0eSBmb3Igd2FpdGVycyBhdCB0aGUgaGFyZCBjYXAuXG4gICAgdGhpcy5fd2FrZVBvb2xlZFNsb3RXYWl0ZXJzKClcbiAgfVxuXG4gIC8qKlxuICAgKiBGb3J3YXJkcyBvbmUgcG9vbGVkIGNoaWxkJ3MgYWNjZXB0YW5jZSBvYnNlcnZhdGlvbiB0byBtYWluIGFzIGEgYm91bmRlZFxuICAgKiBkaWFnbm9zdGljIHJlcG9ydC4gVGhlIGNoaWxkIGNhcnJpZXMgaXRzIGV4YWN0IGhhbmRvZmYgbGVhc2UsIHNvIGEgdGltZW91dFxuICAgKiBvciBvdXRjb21lIHRoYXQgYWxyZWFkeSBzZXR0bGVkIHRoZSB3b3JrZXIncyBpbi1mbGlnaHQgZW50cnkgY2Fubm90IGxvc2VcbiAgICogdGhlIGZlbmNpbmcuIEEgcmVwb3J0IHRoYXQgbmV2ZXIgbGFuZHMgZGVncmFkZXMgcGhhc2UgZGlhZ25vc3RpY3MgZm9yIHRoYXRcbiAgICogam9iIG9ubHkg4oCUIGl0IG11c3QgbmV2ZXIgYmxvY2sgb3IgZmFpbCB0aGUgam9iIGl0c2VsZi5cbiAgICogQHBhcmFtIHt7dHlwZTogXCJqb2ItcmVjZWl2ZWRcIiB8IFwiam9iLXN0YXJ0ZWRcIiwgam9iSWQ6IHN0cmluZywgaGFuZG9mZklkPzogc3RyaW5nLCB3b3JrZXJJZD86IHN0cmluZywgaGFuZGVkT2ZmQXRNcz86IG51bWJlciwgcmVjZWl2ZWRBdE1zPzogbnVtYmVyLCBzdGFydGVkQXRNcz86IG51bWJlciwgY2hpbGRJbnN0YW5jZUlkPzogc3RyaW5nLCBjaGlsZFBpZD86IG51bWJlcn19IG1lc3NhZ2UgLSBWYWxpZGF0ZWQgY2hpbGQgYWNjZXB0YW5jZSBtZXNzYWdlLlxuICAgKiBAcmV0dXJucyB7dm9pZH1cbiAgICovXG4gIF9yZXBvcnRDaGlsZEFjY2VwdGVkKG1lc3NhZ2UpIHtcbiAgICBpZiAoIXRoaXMuc3RhdHVzUmVwb3J0ZXIpIHJldHVyblxuXG4gICAgdm9pZCB0aGlzLnN0YXR1c1JlcG9ydGVyLnJlcG9ydENoaWxkQWNjZXB0ZWRXaXRoUmV0cnkoe1xuICAgICAgam9iSWQ6IG1lc3NhZ2Uuam9iSWQsXG4gICAgICBoYW5kb2ZmSWQ6IG1lc3NhZ2UuaGFuZG9mZklkLFxuICAgICAgd29ya2VySWQ6IG1lc3NhZ2Uud29ya2VySWQsXG4gICAgICBoYW5kZWRPZmZBdE1zOiBtZXNzYWdlLmhhbmRlZE9mZkF0TXMsXG4gICAgICByZWNlaXZlZEF0TXM6IG1lc3NhZ2UucmVjZWl2ZWRBdE1zLFxuICAgICAgc3RhcnRlZEF0TXM6IG1lc3NhZ2Uuc3RhcnRlZEF0TXMsXG4gICAgICBjaGlsZEluc3RhbmNlSWQ6IG1lc3NhZ2UuY2hpbGRJbnN0YW5jZUlkLFxuICAgICAgY2hpbGRQaWQ6IG1lc3NhZ2UuY2hpbGRQaWQsXG4gICAgICBtYXhEdXJhdGlvbk1zOiBDSElMRF9BQ0NFUFRBTkNFX1JFUE9SVF9NQVhfRFVSQVRJT05fTVNcbiAgICB9KS5jYXRjaCgoZXJyb3IpID0+IHtcbiAgICAgIGNvbnNvbGUuZXJyb3IoXCJCYWNrZ3JvdW5kIGpvYiBjaGlsZC1hY2NlcHRhbmNlIHJlcG9ydGluZyBmYWlsZWQ6XCIsIGVycm9yKVxuICAgIH0pXG4gIH1cblxuICAvKipcbiAgICogSGFuZGxlcyBhIHBvb2xlZCBjaGlsZCdzIGJvdW5kZWQgbWVtb3J5IG9ic2VydmF0aW9uLiBUaGUgcG9vbGVkIGNoaWxkJ3NcbiAgICogc3RkaW8gaXMgaWdub3JlZCBieSB0aGUgd29ya2VyIGZvcmssIHNvIHRoaXMgSVBDIG9ic2VydmF0aW9uIGlzIGhvdyBhXG4gICAqIG1lbW9yeSBwcm9ibGVtIGluIGEgcnVubmluZyBjaGlsZCBuYW1lcyBpdHNlbGYuIFRoZSB3b3JrZXIgKGEpIHJlY29yZHMgdGhlXG4gICAqIGxhdGVzdCBvYnNlcnZhdGlvbiBvbiB0aGUgY2hpbGQncyBzdGF0ZSBmb3IgbGF0ZXIgY29ycmVsYXRpb24sIChiKSBsb2dzIG9uZVxuICAgKiBjb21wYWN0IGxpbmUgdG8gaXRzIG93biBzdGRlcnIgKHdoaWNoIHJlYWNoZXMgdGhlIHByb2QgbG9nLCB1bmxpa2UgdGhlXG4gICAqIGNoaWxkJ3MgaWdub3JlZCBzdGRpbyksIGFuZCAoYykgZm9yd2FyZHMgdGhlIGZ1bGwgb2JzZXJ2YXRpb24gdG8gdGhlXG4gICAqIG9wdGlvbmFsIGBvblBvb2xlZFJ1bm5lck1lbW9yeU9ic2VydmF0aW9uYCBob29rIHNvIGFuIGFwcGxpY2F0aW9uIGNhbiByb3V0ZVxuICAgKiBpdCAoZS5nLiB0byBhIGJ1ZyByZXBvcnRlcikgd2l0aG91dCBwYXJzaW5nIGxvZ3MuIFRoZSBoZWFwLXN0YXQgYnJlYWtkb3duXG4gICAqIGRpc3Rpbmd1aXNoZXMgVjgtaGVhcCBncm93dGggZnJvbSBleHRlcm5hbC9hcnJheS1idWZmZXIgKG5hdGl2ZSkgZ3Jvd3RoLiBBXG4gICAqIGhvb2sgZmFpbHVyZSBpcyBzd2FsbG93ZWQg4oCUIGRpYWdub3N0aWNzIG11c3QgbmV2ZXIgdGFrZSBkb3duIHRoZSB3b3JrZXIgb3JcbiAgICogZmFpbCB0aGUgam9icyBydW5uaW5nIG9uIHRoYXQgY2hpbGQuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gTWVzc2FnZSBkZXRhaWxzLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIm5vZGU6Y2hpbGRfcHJvY2Vzc1wiKS5DaGlsZFByb2Nlc3N9IGFyZ3MuY2hpbGQgLSBQb29sZWQgY2hpbGQuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi90eXBlcy5qc1wiKS5Qb29sZWRDaGlsZE1lbW9yeU9ic2VydmF0aW9ufSBhcmdzLm1lc3NhZ2UgLSBWYWxpZGF0ZWQgbWVtb3J5IG9ic2VydmF0aW9uLlxuICAgKiBAcmV0dXJucyB7dm9pZH1cbiAgICovXG4gIF9oYW5kbGVQb29sZWRDaGlsZE1lbW9yeU9ic2VydmF0aW9uKHtjaGlsZCwgbWVzc2FnZX0pIHtcbiAgICBjb25zdCBzdGF0ZSA9IHRoaXMucG9vbGVkQ2hpbGRTdGF0ZXMuZ2V0KGNoaWxkKVxuICAgIGlmIChzdGF0ZSkgc3RhdGUubGFzdE1lbW9yeU9ic2VydmF0aW9uID0gbWVzc2FnZVxuXG4gICAgY29uc3QgaGVhcCA9IG1lc3NhZ2UuaGVhcFN0YXRpc3RpY3NcbiAgICBjb25zb2xlLmVycm9yKFxuICAgICAgSlNPTi5zdHJpbmdpZnkoe1xuICAgICAgICBldmVudDogXCJwb29sZWQtY2hpbGQtbWVtb3J5XCIsXG4gICAgICAgIGNoaWxkSW5zdGFuY2VJZDogc3RhdGU/LmNoaWxkSW5zdGFuY2VJZCA/PyBtZXNzYWdlLmNoaWxkSW5zdGFuY2VJZCxcbiAgICAgICAgY2hpbGRQaWQ6IG1lc3NhZ2UuY2hpbGRQaWQsXG4gICAgICAgIGNoaWxkVXB0aW1lUzogTWF0aC5yb3VuZChtZXNzYWdlLmNoaWxkVXB0aW1lTXMgLyAxMDAwKSxcbiAgICAgICAgcnNzTWI6IE1hdGgucm91bmQobWVzc2FnZS5yc3NCeXRlcyAvICgxMDI0ICogMTAyNCkpLFxuICAgICAgICBwZWFrUnNzTWI6IE1hdGgucm91bmQoKHR5cGVvZiBtZXNzYWdlLnBlYWtSc3NCeXRlcyA9PT0gXCJudW1iZXJcIiA/IG1lc3NhZ2UucGVha1Jzc0J5dGVzIDogbWVzc2FnZS5yc3NCeXRlcykgLyAoMTAyNCAqIDEwMjQpKSxcbiAgICAgICAgaGVhcFVzZWRNYjogTWF0aC5yb3VuZChoZWFwLnVzZWRfaGVhcF9zaXplIC8gKDEwMjQgKiAxMDI0KSksXG4gICAgICAgIGhlYXBUb3RhbE1iOiBNYXRoLnJvdW5kKGhlYXAudG90YWxfaGVhcF9zaXplIC8gKDEwMjQgKiAxMDI0KSksXG4gICAgICAgIGhlYXBMaW1pdE1iOiBNYXRoLnJvdW5kKGhlYXAuaGVhcF9zaXplX2xpbWl0IC8gKDEwMjQgKiAxMDI0KSksXG4gICAgICAgIGV4dGVybmFsTWI6IE1hdGgucm91bmQobWVzc2FnZS5tZW1vcnlVc2FnZS5leHRlcm5hbCAvICgxMDI0ICogMTAyNCkpLFxuICAgICAgICBhcnJheUJ1ZmZlcnNNYjogTWF0aC5yb3VuZChtZXNzYWdlLm1lbW9yeVVzYWdlLmFycmF5QnVmZmVycyAvICgxMDI0ICogMTAyNCkpLFxuICAgICAgICBqb2JzOiBtZXNzYWdlLmpvYkNvdW50LFxuICAgICAgICBhY3RpdmVKb2JJZHM6IG1lc3NhZ2UuYWN0aXZlSm9iSWRzXG4gICAgICB9KVxuICAgIClcblxuICAgIGlmICh0aGlzLm9uUG9vbGVkUnVubmVyTWVtb3J5T2JzZXJ2YXRpb24pIHtcbiAgICAgIHRyeSB7XG4gICAgICAgIGNvbnN0IHJlc3VsdCA9IHRoaXMub25Qb29sZWRSdW5uZXJNZW1vcnlPYnNlcnZhdGlvbihtZXNzYWdlKVxuICAgICAgICBpZiAocmVzdWx0ICYmIHR5cGVvZiByZXN1bHQuY2F0Y2ggPT09IFwiZnVuY3Rpb25cIikgcmVzdWx0LmNhdGNoKChlcnJvcikgPT4ge1xuICAgICAgICAgIGNvbnNvbGUuZXJyb3IoXCJQb29sZWQgcnVubmVyIG1lbW9yeSBvYnNlcnZhdGlvbiBob29rIGZhaWxlZDpcIiwgZXJyb3IpXG4gICAgICAgIH0pXG4gICAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgICBjb25zb2xlLmVycm9yKFwiUG9vbGVkIHJ1bm5lciBtZW1vcnkgb2JzZXJ2YXRpb24gaG9vayBmYWlsZWQ6XCIsIGVycm9yKVxuICAgICAgfVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBSZXF1ZXN0cyBhbiBpbW1lZGlhdGUgbWVtb3J5IG9ic2VydmF0aW9uIGZyb20gb25lIHBvb2xlZCBjaGlsZC4gVGhlIGNoaWxkXG4gICAqIHJlcGxpZXMgb3ZlciBJUEMgd2l0aCBpdHMgY3VycmVudCBzbmFwc2hvdCAodGhlIHNhbWUgc2hhcGUgYXMgdGhlIHBlcmlvZGljXG4gICAqIHNhbXBsZXIpLCB3aGljaCB0aGUgd29ya2VyIHJlY29yZHMsIGxvZ3MsIGFuZCBmb3J3YXJkcyB0byB0aGVcbiAgICogYG9uUG9vbGVkUnVubmVyTWVtb3J5T2JzZXJ2YXRpb25gIGhvb2suIFVzZSB0aGlzIHRvIHB1bGwgYSBzbmFwc2hvdCBvblxuICAgKiBzdXNwaWNpb24gKGUuZy4gYWZ0ZXIgYW4gT09NIHJlcG9ydCkgd2l0aG91dCB3YWl0aW5nIGZvciB0aGUgbmV4dCBwZXJpb2RpY1xuICAgKiBzYW1wbGUuIEEgbm8tb3Agd2hlbiB0aGUgY2hpbGQgaXMgZ29uZSBvciBpdHMgSVBDIGNoYW5uZWwgaXMgY2xvc2VkLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIm5vZGU6Y2hpbGRfcHJvY2Vzc1wiKS5DaGlsZFByb2Nlc3N9IGNoaWxkIC0gUG9vbGVkIGNoaWxkIHRvIHNhbXBsZS5cbiAgICogQHJldHVybnMge3ZvaWR9XG4gICAqL1xuICByZXF1ZXN0UG9vbGVkQ2hpbGRNZW1vcnlPYnNlcnZhdGlvbihjaGlsZCkge1xuICAgIGlmICghY2hpbGQuY29ubmVjdGVkKSByZXR1cm5cblxuICAgIHRyeSB7XG4gICAgICBjaGlsZC5zZW5kKHt0eXBlOiBcIm1lbW9yeS1vYnNlcnZhdGlvbi1yZXF1ZXN0XCJ9KVxuICAgIH0gY2F0Y2gge1xuICAgICAgLy8gVGhlIElQQyBjaGFubmVsIGlzIGFscmVhZHkgZ29uZTsgdGhlIGRpc2Nvbm5lY3QvZXhpdCBoYW5kbGVyIG93bnMgdGVhcmRvd24uXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIE1hcmtzIGEgcG9vbGVkIGNoaWxkIGZvciByZXRpcmVtZW50IGFuZCDigJQgd2hlbiB0aGUgcG9vbCBpcyBiZWxvdyBpdHMgaGFyZFxuICAgKiBjYXAg4oCUIGVhZ2VybHkgc3Bhd25zIGEgc2luZ2xlIHJlcGxhY2VtZW50ICgxLWZvci0xKSBzbyBpdHMgY2FwYWNpdHkgaXNcbiAgICogcmVzdG9yZWQgaW1tZWRpYXRlbHkgd2l0aG91dCB3YWl0aW5nIGZvciBpdCB0byBmaW5pc2ggZHJhaW5pbmcuIFRoZVxuICAgKiByZXBsYWNlbWVudCBzcGF3biBpcyBnYXRlZCBieSB0aGUgY2FwICh0aGUgcmV0aXJpbmcgY2hpbGQgc3RpbGwgY291bnRzIGFzXG4gICAqIGxpdmUgdW50aWwgaXQgZXhpdHMpLCBzbyBhIGZ1bGwgcG9vbCBzaW1wbHkgZGVmZXJzIHRoZSByZXBsYWNlbWVudCB0byB0aGVcbiAgICogcmV0aXJpbmcgY2hpbGQncyBkcmFpbiBpbnN0ZWFkIG9mIHNwYXduaW5nIG92ZXIgY2FwYWNpdHkuIFRoZSByZXRpcmluZ1xuICAgKiBjaGlsZCBzdG9wcyByZWNlaXZpbmcgbmV3IGpvYnMgYW5kIGlzIHRlcm1pbmF0ZWQgb25seSBvbmNlIGl0cyBpbi1mbGlnaHRcbiAgICogc2V0IGRyYWlucywgc28gYSBsb25nLXJ1bm5pbmcgam9iIChlLmcuIGEgYnVpbGQpIGlzIG5ldmVyIGN1dCBvZmYuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwibm9kZTpjaGlsZF9wcm9jZXNzXCIpLkNoaWxkUHJvY2Vzc30gY2hpbGQgLSBDaGlsZCB0byByZXRpcmUuXG4gICAqIEByZXR1cm5zIHt2b2lkfVxuICAgKi9cbiAgX2JlZ2luUmV0aXJlUG9vbGVkQ2hpbGQoY2hpbGQpIHtcbiAgICBjb25zdCBzdGF0ZSA9IHRoaXMucG9vbGVkQ2hpbGRTdGF0ZXMuZ2V0KGNoaWxkKVxuICAgIGlmICghc3RhdGUgfHwgc3RhdGUucmV0aXJpbmcpIHJldHVyblxuXG4gICAgc3RhdGUucmV0aXJpbmcgPSB0cnVlXG4gICAgLy8gQmVzdC1lZmZvcnQgcHJlLXdhcm06IHNraXAgd2hlbiBzdG9wcGluZyAobm8gbmV3IHdvcmspIG9yIGJlZm9yZSB0aGVcbiAgICAvLyB3b3JrZXIgaXMgaW5pdGlhbGl6ZWQgKG5vIGNvbmZpZ3VyYXRpb24gdG8gZm9yayBhIGNoaWxkIGZyb20pLiBUaGUgY2FwXG4gICAgLy8gaW5zaWRlIF9jcmVhdGVQb29sZWRDaGlsZCByZWZ1c2VzIHRoZSBzcGF3biB3aGlsZSB0aGUgcG9vbCBpcyBmdWxsLCBpblxuICAgIC8vIHdoaWNoIGNhc2UgdGhlIHJlcGxhY2VtZW50IGlzIGRlZmVycmVkIHRvIHRoZSBkcmFpbiBwYXRoLlxuICAgIGlmICghdGhpcy5zaG91bGRTdG9wICYmIHRoaXMuY29uZmlndXJhdGlvbikgdGhpcy5fY3JlYXRlUG9vbGVkQ2hpbGQoKVxuICB9XG5cbiAgLyoqXG4gICAqIFRlcm1pbmF0ZXMgYSByZXRpcmluZyBwb29sZWQgY2hpbGQgb25jZSBpdCBoYXMgbm8gaW4tZmxpZ2h0IGpvYnMgbGVmdC5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCJub2RlOmNoaWxkX3Byb2Nlc3NcIikuQ2hpbGRQcm9jZXNzfSBjaGlsZCAtIENoaWxkIHRvIGNoZWNrLlxuICAgKiBAcmV0dXJucyB7dm9pZH1cbiAgICovXG4gIF90ZXJtaW5hdGVJZkRyYWluZWQoY2hpbGQpIHtcbiAgICBjb25zdCBzdGF0ZSA9IHRoaXMucG9vbGVkQ2hpbGRTdGF0ZXMuZ2V0KGNoaWxkKVxuICAgIGlmICghc3RhdGUgfHwgIXN0YXRlLnJldGlyaW5nIHx8IHN0YXRlLmluZmxpZ2h0LnNpemUgPiAwKSByZXR1cm5cblxuICAgIHRoaXMuX3JldGlyZVBvb2xlZENoaWxkKGNoaWxkKVxuICB9XG5cbiAgLyoqXG4gICAqIFJldGlyZXMgYSBkcmFpbmVkIHBvb2xlZCBjaGlsZCAocmVtb3ZlcyBpdCBmcm9tIHRyYWNraW5nLCB0aGVuIFNJR1RFUk1zIGl0KS5cbiAgICogQmVjYXVzZSB0aGUgaGFyZCBjYXAgY291bnRzIGxpdmUgY2hpbGRyZW4sIHRoZSBleGl0IG9mIHRoaXMgY2hpbGQgZnJlZXMgYVxuICAgKiBzbG90OiBhbnkgZGVmZXJyZWQgcmVwbGFjZW1lbnQgKHRoZSBwb29sIHdhcyBmdWxsIHdoZW4gdGhlIGNoaWxkIHJldGlyZWQpXG4gICAqIGlzIHNwYXduZWQgbm93LCBhbmQgY2FwYWNpdHkgaXMgcmUtYWR2ZXJ0aXNlZCBzbyBtYWluIGNhbiBkaXNwYXRjaCBpbnRvIGl0LlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIm5vZGU6Y2hpbGRfcHJvY2Vzc1wiKS5DaGlsZFByb2Nlc3N9IGNoaWxkIC0gQ2hpbGQgcHJvY2VzcyB0byByZXRpcmUuXG4gICAqIEByZXR1cm5zIHt2b2lkfVxuICAgKi9cbiAgX3JldGlyZVBvb2xlZENoaWxkKGNoaWxkKSB7XG4gICAgY29uc3Qgc3RhdGUgPSB0aGlzLnBvb2xlZENoaWxkU3RhdGVzLmdldChjaGlsZClcbiAgICBpZiAoIXN0YXRlKSB0aHJvdyBuZXcgRXJyb3IoXCJDYW5ub3QgcmV0aXJlIHBvb2xlZCBjaGlsZCB3aXRob3V0IHRyYWNrZWQgc3RhdGVcIilcbiAgICBpZiAoc3RhdGUuaW5mbGlnaHQuc2l6ZSA+IDApIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihgQ2Fubm90IHJldGlyZSBwb29sZWQgY2hpbGQgd2hpbGUgJHtzdGF0ZS5pbmZsaWdodC5zaXplfSAke3N0YXRlLmluZmxpZ2h0LnNpemUgPT09IDEgPyBcImpvYiByZW1haW5zXCIgOiBcImpvYnMgcmVtYWluXCJ9IGluIGZsaWdodGApXG4gICAgfVxuXG4gICAgdGhpcy5wb29sZWRDaGlsZHJlbi5kZWxldGUoY2hpbGQpXG4gICAgc3RhdGUucmV0aXJpbmcgPSB0cnVlXG4gICAgdGhpcy5fcmVxdWVzdFBvb2xlZENoaWxkU2h1dGRvd24oe2NoaWxkLCByZWFzb246IFwicGFyZW50X3JldGlyZV9kcmFpbmVkXCIsIHNpZ25hbDogXCJTSUdURVJNXCIsIHdhaXRGb3JPYnNlcnZhdGlvbjogdHJ1ZX0pXG4gIH1cblxuICAvKipcbiAgICogUmVjb3JkcyBhbiBleGFjdCBwYXJlbnQgcmVxdWVzdCBiZWZvcmUgSVBDIG9yIHNpZ25hbCBkZWxpdmVyeS4gRHJhaW5lZFxuICAgKiByZXRpcmVtZW50IGdldHMgYSBicmllZiBJUEMtZmlyc3QgZ3JhY2Ugc28gaXRzIHplcm8tam9iIG9ic2VydmF0aW9uIGlzXG4gICAqIGRldGVybWluaXN0aWM7IHRpbWVvdXQvd29ya2VyLXN0b3AgcGF0aHMgc2lnbmFsIGltbWVkaWF0ZWx5LlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIFNodXRkb3duIHJlcXVlc3QuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwibm9kZTpjaGlsZF9wcm9jZXNzXCIpLkNoaWxkUHJvY2Vzc30gYXJncy5jaGlsZCAtIFBvb2xlZCBjaGlsZC5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL3R5cGVzLmpzXCIpLlBvb2xlZENoaWxkU2h1dGRvd25SZWFzb259IGFyZ3MucmVhc29uIC0gRXhhY3QgcGFyZW50IHJlYXNvbi5cbiAgICogQHBhcmFtIHtrZXlvZiB0eXBlb2YgaW1wb3J0KFwibm9kZTpvc1wiKS5jb25zdGFudHMuc2lnbmFsc30gYXJncy5zaWduYWwgLSBTaWduYWwgdG8gZGVsaXZlci5cbiAgICogQHBhcmFtIHtib29sZWFufSBbYXJncy53YWl0Rm9yT2JzZXJ2YXRpb25dIC0gV2hldGhlciBJUEMgb2JzZXJ2YXRpb24gbWF5IHByZWNlZGUgc2lnbmFsIGZhbGxiYWNrLlxuICAgKiBAcmV0dXJucyB7dm9pZH1cbiAgICovXG4gIF9yZXF1ZXN0UG9vbGVkQ2hpbGRTaHV0ZG93bih7Y2hpbGQsIHJlYXNvbiwgc2lnbmFsLCB3YWl0Rm9yT2JzZXJ2YXRpb24gPSBmYWxzZX0pIHtcbiAgICBjb25zdCBzdGF0ZSA9IHRoaXMucG9vbGVkQ2hpbGRTdGF0ZXMuZ2V0KGNoaWxkKVxuICAgIGlmICghc3RhdGUgfHwgc3RhdGUuc2V0dGxpbmcgfHwgc3RhdGUuc2h1dGRvd25SZWFzb24pIHJldHVyblxuXG4gICAgY29uc3Qgc2h1dGRvd25SZXF1ZXN0ZWRBdE1zID0gRGF0ZS5ub3coKVxuICAgIHN0YXRlLnNodXRkb3duUmVhc29uID0gcmVhc29uXG4gICAgc3RhdGUuc2h1dGRvd25SZXF1ZXN0ZWRBdE1zID0gc2h1dGRvd25SZXF1ZXN0ZWRBdE1zXG4gICAgc3RhdGUuc2h1dGRvd25TaWduYWwgPSBzaWduYWxcblxuICAgIGxldCByZXF1ZXN0U2VudCA9IGZhbHNlXG4gICAgaWYgKGNoaWxkLmNvbm5lY3RlZCkge1xuICAgICAgdHJ5IHtcbiAgICAgICAgY2hpbGQuc2VuZCh7dHlwZTogXCJzaHV0ZG93bi1yZXF1ZXN0XCIsIHJlYXNvbiwgc2h1dGRvd25SZXF1ZXN0ZWRBdE1zLCBzaWduYWx9LCAoZXJyb3IpID0+IHtcbiAgICAgICAgICBpZiAoIWVycm9yIHx8ICF3YWl0Rm9yT2JzZXJ2YXRpb24gfHwgc3RhdGUuc2V0dGxpbmcpIHJldHVyblxuXG4gICAgICAgICAgaWYgKHN0YXRlLnNodXRkb3duU2lnbmFsVGltZXIpIHtcbiAgICAgICAgICAgIGNsZWFyVGltZW91dChzdGF0ZS5zaHV0ZG93blNpZ25hbFRpbWVyKVxuICAgICAgICAgICAgc3RhdGUuc2h1dGRvd25TaWduYWxUaW1lciA9IHVuZGVmaW5lZFxuICAgICAgICAgIH1cbiAgICAgICAgICB0aGlzLl9zaWduYWxQb29sZWRDaGlsZCh7Y2hpbGQsIHNpZ25hbH0pXG4gICAgICAgIH0pXG4gICAgICAgIHJlcXVlc3RTZW50ID0gdHJ1ZVxuICAgICAgfSBjYXRjaCB7XG4gICAgICAgIC8vIFRoZSBzaWduYWwgYmVsb3cgcmVtYWlucyB0aGUgYm91bmRlZCBzaHV0ZG93biBtZWNoYW5pc20uXG4gICAgICB9XG4gICAgfVxuXG4gICAgaWYgKHdhaXRGb3JPYnNlcnZhdGlvbiAmJiByZXF1ZXN0U2VudCkge1xuICAgICAgc3RhdGUuc2h1dGRvd25TaWduYWxUaW1lciA9IHNldFRpbWVvdXQoKCkgPT4ge1xuICAgICAgICBzdGF0ZS5zaHV0ZG93blNpZ25hbFRpbWVyID0gdW5kZWZpbmVkXG4gICAgICAgIHRoaXMuX3NpZ25hbFBvb2xlZENoaWxkKHtjaGlsZCwgc2lnbmFsfSlcbiAgICAgIH0sIFBPT0xFRF9SVU5ORVJfU0hVVERPV05fUkVRVUVTVF9HUkFDRV9NUylcbiAgICAgIHN0YXRlLnNodXRkb3duU2lnbmFsVGltZXIudW5yZWYoKVxuICAgICAgcmV0dXJuXG4gICAgfVxuXG4gICAgdGhpcy5fc2lnbmFsUG9vbGVkQ2hpbGQoe2NoaWxkLCBzaWduYWx9KVxuICB9XG5cbiAgLyoqXG4gICAqIERlbGl2ZXJzIG9uZSBwYXJlbnQtb3duZWQgcHJvY2VzcyBzaWduYWwgd2l0aG91dCBjaGFuZ2luZyByZWNvcmRlZCBwcm92ZW5hbmNlLlxuICAgKiBAcGFyYW0ge3tjaGlsZDogaW1wb3J0KFwibm9kZTpjaGlsZF9wcm9jZXNzXCIpLkNoaWxkUHJvY2Vzcywgc2lnbmFsOiBrZXlvZiB0eXBlb2YgaW1wb3J0KFwibm9kZTpvc1wiKS5jb25zdGFudHMuc2lnbmFsc319IGFyZ3MgLSBTaWduYWwgcmVxdWVzdC5cbiAgICogQHJldHVybnMge3ZvaWR9XG4gICAqL1xuICBfc2lnbmFsUG9vbGVkQ2hpbGQoe2NoaWxkLCBzaWduYWx9KSB7XG4gICAgdHJ5IHtcbiAgICAgIGNoaWxkLmtpbGwoc2lnbmFsKVxuICAgIH0gY2F0Y2gge1xuICAgICAgLy8gQ2hpbGQgYWxyZWFkeSBleGl0ZWQ7IGl0cyBleGl0L2Vycm9yIGhhbmRsZXIgb3ducyBzdGF0ZSBzZXR0bGVtZW50LlxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBSZW1vdmVzIGFuIGV4aXRlZC91bmhlYWx0aHkgcG9vbGVkIGNoaWxkIGFuZCByZXBvcnRzIGV2ZXJ5IGpvYiB0aGF0IHdhc1xuICAgKiBpbi1mbGlnaHQgb24gaXQgYXMgZmFpbGVkIOKAlCBhIHByb2Nlc3MtbGV2ZWwgY3Jhc2gncyBibGFzdCByYWRpdXMgaXMgdGhlXG4gICAqIGNoaWxkJ3Mgd2hvbGUgaW4tZmxpZ2h0IHNldC4gT25jZSB0aGUgY2hpbGQgaGFzIGNvbXBsZXRlZCBzdGFydHVwLCBpdHNcbiAgICogZnJlZWQgY2FwYWNpdHkgaXMgYWR2ZXJ0aXNlZCBpbW1lZGlhdGVseTsgdGhlIHJlcGxhY2VtZW50IGl0c2VsZiBpcyBzdGlsbFxuICAgKiBzcGF3bmVkIGxhemlseSBieSB0aGUgbmV4dCBkaXNwYXRjaC4gQSBjaGlsZCB0aGF0IGV4aXRzIGJlZm9yZSBpdHMgc3RhcnR1cFxuICAgKiBoYW5kc2hha2UgZG9lcyBub3QgcmUtYW5ub3VuY2UsIGF2b2lkaW5nIGEgdGlnaHQgcmVzcGF3biBsb29wIG9uIHN0YXJ0dXBcbiAgICogZmFpbHVyZS5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBGYWlsdXJlIGRldGFpbHMuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwibm9kZTpjaGlsZF9wcm9jZXNzXCIpLkNoaWxkUHJvY2Vzc30gYXJncy5jaGlsZCAtIFBvb2xlZCBjaGlsZC5cbiAgICogQHBhcmFtIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gYXJncy5lcnJvciAtIEZhaWx1cmUuXG4gICAqIEBwYXJhbSB7bnVtYmVyIHwgbnVsbH0gW2FyZ3MuZXhpdENvZGVdIC0gQ2hpbGQgZXhpdCBjb2RlIHdoZW4gb2JzZXJ2ZWQuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi90eXBlcy5qc1wiKS5Qb29sZWRSdW5uZXJGYWlsdXJlT3JpZ2lufSBbYXJncy5vcmlnaW5dIC0gV29ya2VyIG9ic2VydmF0aW9uIHRoYXQgaW5pdGlhdGVkIHJlY292ZXJ5LlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIm5vZGU6Y2hpbGRfcHJvY2Vzc1wiKS5DaGlsZFByb2Nlc3NbXCJzaWduYWxDb2RlXCJdfSBbYXJncy5zaWduYWxdIC0gQ2hpbGQgdGVybWluYXRpb24gc2lnbmFsIHdoZW4gb2JzZXJ2ZWQuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fVxuICAgKi9cbiAgYXN5bmMgX2hhbmRsZVBvb2xlZENoaWxkRmFpbHVyZSh7Y2hpbGQsIGVycm9yLCBleGl0Q29kZSA9IG51bGwsIG9yaWdpbiA9IFwicHJvY2Vzcy1lcnJvclwiLCBzaWduYWwgPSBudWxsfSkge1xuICAgIGNvbnN0IHN0YXRlID0gdGhpcy5wb29sZWRDaGlsZFN0YXRlcy5nZXQoY2hpbGQpXG4gICAgaWYgKHN0YXRlPy5zZXR0bGluZykgcmV0dXJuXG4gICAgaWYgKHN0YXRlKSB7XG4gICAgICBzdGF0ZS5zZXR0bGluZyA9IHRydWVcbiAgICAgIC8vIENhbmNlbCB0aGlzIGNoaWxkJ3MgcGVuZGluZyB0aW1lcnMgYmVmb3JlIGl0cyBpbi1mbGlnaHQgc2V0IGlzIHJlcG9ydGVkIOKAlFxuICAgICAgLy8gdGhlIFNJR0tJTEwgZ3JhY2UgZnJvbSBhIHRpbWVvdXQga2lsbCwgYW5kIGV2ZXJ5IGFybWVkIHBlci1qb2IgYmFja3N0b3AuXG4gICAgICBpZiAoc3RhdGUudGltZW91dFNpZ2tpbGxUaW1lcikgY2xlYXJUaW1lb3V0KHN0YXRlLnRpbWVvdXRTaWdraWxsVGltZXIpXG4gICAgICBpZiAoc3RhdGUuc2h1dGRvd25TaWduYWxUaW1lcikgY2xlYXJUaW1lb3V0KHN0YXRlLnNodXRkb3duU2lnbmFsVGltZXIpXG4gICAgICBmb3IgKGNvbnN0IGluZmxpZ2h0RW50cnkgb2Ygc3RhdGUuaW5mbGlnaHQudmFsdWVzKCkpIHtcbiAgICAgICAgaWYgKGluZmxpZ2h0RW50cnkudGltZW91dFRpbWVyKSBjbGVhclRpbWVvdXQoaW5mbGlnaHRFbnRyeS50aW1lb3V0VGltZXIpXG4gICAgICB9XG4gICAgfVxuICAgIHRoaXMucG9vbGVkQ2hpbGRyZW4uZGVsZXRlKGNoaWxkKVxuICAgIHRoaXMuaW5mbGlnaHRQcm9jZXNzQ2hpbGRyZW4uZGVsZXRlKGNoaWxkKVxuICAgIC8vIENoaWxkIGV4aXQgZnJlZXMgYSBoYXJkLWNhcCBzbG90IGV2ZW4gd2hpbGUgaXRzIGluLWZsaWdodCBzZXQgaXMgc3RpbGxcbiAgICAvLyBiZWluZyByZXBvcnRlZCDigJQgd2FrZSB3YWl0ZXJzIG5vdzsgdGhlaXIgcmVwb3J0cyBzZXR0bGUgaW5kZXBlbmRlbnRseS5cbiAgICB0aGlzLl93YWtlUG9vbGVkU2xvdFdhaXRlcnMoKVxuXG4gICAgY29uc3QgZW50cmllcyA9IHN0YXRlID8gWy4uLnN0YXRlLmluZmxpZ2h0LnZhbHVlcygpXSA6IFtdXG4gICAgY29uc3QgcnVubmVyRmFpbHVyZSA9IHN0YXRlXG4gICAgICA/IHRoaXMuX3Bvb2xlZFJ1bm5lckZhaWx1cmUoe2NoaWxkLCBleGl0Q29kZSwgb3JpZ2luLCBzaWduYWwsIHN0YXRlfSlcbiAgICAgIDogdW5kZWZpbmVkXG4gICAgaWYgKHN0YXRlKSBzdGF0ZS5pbmZsaWdodC5jbGVhcigpXG4gICAgdGhpcy5wb29sZWRDaGlsZFN0YXRlcy5kZWxldGUoY2hpbGQpXG5cbiAgICBjb25zdCBmYWlsdXJlUmVwb3J0cyA9IGVudHJpZXMubWFwKGFzeW5jIChlbnRyeSkgPT4ge1xuICAgICAgYXdhaXQgdGhpcy5fcmVwb3J0Sm9iUmVzdWx0KHtcbiAgICAgICAgam9iSWQ6IGVudHJ5LnBheWxvYWQuaWQsXG4gICAgICAgIHN0YXR1czogXCJmYWlsZWRcIixcbiAgICAgICAgZXJyb3IsXG4gICAgICAgIGhhbmRvZmZJZDogZW50cnkucGF5bG9hZC5oYW5kb2ZmSWQsXG4gICAgICAgIGhhbmRlZE9mZkF0TXM6IGVudHJ5LnBheWxvYWQuaGFuZGVkT2ZmQXRNcyxcbiAgICAgICAgcnVubmVyRmFpbHVyZSxcbiAgICAgICAgd29ya2VySWQ6IGVudHJ5LnBheWxvYWQud29ya2VySWQgfHwgdGhpcy53b3JrZXJJZFxuICAgICAgfSlcbiAgICAgIGlmIChlbnRyeS5yZXNvbHZlKSBlbnRyeS5yZXNvbHZlKHVuZGVmaW5lZClcbiAgICB9KVxuXG4gICAgLy8gU3RhcnQgZXZlcnkgZmFsbGJhY2sgcmVwb3J0IGJlZm9yZSBhbm5vdW5jaW5nIGNhcGFjaXR5IHNvIHRoZSBtYWluIGNhbm5vdFxuICAgIC8vIG9ic2VydmUgYSByZXBsYWNlbWVudCBzbG90IGJlZm9yZSB0aGUgZmFpbGVkIGpvYnMnIHJlcG9ydHMgYXJlIGluIGZsaWdodC5cbiAgICAvLyBUaGUgcmVwb3J0IHByb21pc2VzIHJlbWFpbiB0cmFja2VkIGJlbG93OyBhIHNsb3cgcmV0cnkgbXVzdCBub3QgaG9sZCB0aGVcbiAgICAvLyBuZXdseSBmcmVlZCBydW5uZXIgY2FwYWNpdHkgaG9zdGFnZS5cbiAgICAvLyBBIGRyYWluZWQgcmV0aXJlbWVudCBhbHJlYWR5IGFkdmVydGlzZWQgaXRzIHJlcGxhY2VtZW50IGNhcGFjaXR5IHdoZW5cbiAgICAvLyB0aGUgZmluYWwgam9iIGNvbXBsZXRlZC4gUmUtYWR2ZXJ0aXNpbmcgaGVyZSBjYW4gcmVzdG9yZSBhIGNyZWRpdCBtYWluXG4gICAgLy8gY29uc3VtZWQgYmVmb3JlIGl0cyBoYW5kb2ZmIHJlYWNoZWQgdGhlIHJlcGxhY2VtZW50IGNoaWxkLlxuICAgIGlmIChzdGF0ZT8uc2h1dGRvd25SZWFzb24gIT09IFwicGFyZW50X3JldGlyZV9kcmFpbmVkXCIpIHtcbiAgICAgIGlmIChzdGF0ZSAmJiBzdGF0ZS5zdGFydGVkICE9PSBmYWxzZSkge1xuICAgICAgICB0aGlzLl9zZW5kUmVhZHlJZlJ1bm5pbmcoKVxuICAgICAgfSBlbHNlIGlmIChzdGF0ZSkge1xuICAgICAgICBmb3IgKGNvbnN0IGVudHJ5IG9mIGVudHJpZXMpIHtcbiAgICAgICAgICBpZiAoZW50cnkucG9vbGVkSm9iKSB0aGlzLl9wb29sZWRTdGFydHVwRmFpbHVyZUpvYnMuYWRkKGVudHJ5LnBvb2xlZEpvYilcbiAgICAgICAgICBjb25zdCBxdWV1ZVRyYWNrZXIgPSB0aGlzLnBvb2xlZEpvYlF1ZXVlVHJhY2tlcnMuZ2V0KGVudHJ5LnBheWxvYWQuaWQpXG4gICAgICAgICAgaWYgKHF1ZXVlVHJhY2tlcikgdGhpcy5fcG9vbGVkU3RhcnR1cEZhaWx1cmVKb2JzLmFkZChxdWV1ZVRyYWNrZXIpXG4gICAgICAgIH1cbiAgICAgICAgLy8gQSBwcmV2aW91cyByZWFkeSBtZXNzYWdlIG1heSBzdGlsbCBoYXZlIHVuY29uc3VtZWQgcG9vbGVkIGNyZWRpdHMgYXQgdGhlXG4gICAgICAgIC8vIG1haW4uIFJldm9rZSB0aGVtIGF1dGhvcml0YXRpdmVseSB3aXRob3V0IHN1cHByZXNzaW5nIHZhbGlkIGlubGluZSBvclxuICAgICAgICAvLyBwcm9jZXNzLXJ1bm5lciByZWFkaW5lc3M7IG90aGVyd2lzZSBxdWV1ZWQgam9icyBjYW4gdHJpZ2dlciBhIHN0YXJ0dXBcbiAgICAgICAgLy8gY3Jhc2ggbG9vcCB1c2luZyB0aGUgc3RhbGUgY3JlZGl0cy5cbiAgICAgICAgdGhpcy5fc2VuZFJlYWR5SWZSdW5uaW5nKHtyZXZva2VQb29sZWRBZG1pc3Npb246IHRydWV9KVxuICAgICAgfVxuICAgIH1cblxuICAgIGF3YWl0IFByb21pc2UuYWxsU2V0dGxlZChmYWlsdXJlUmVwb3J0cylcbiAgfVxuXG4gIC8qKlxuICAgKiBDYXB0dXJlcyBvbmUgc3RhYmxlIHByb2Nlc3Mgc25hcHNob3QgYmVmb3JlIHRoZSBmYWlsZWQgY2hpbGQncyBzdGF0ZSBpcyByZW1vdmVkLlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIEZhaWx1cmUgZGV0YWlscy5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCJub2RlOmNoaWxkX3Byb2Nlc3NcIikuQ2hpbGRQcm9jZXNzfSBhcmdzLmNoaWxkIC0gRmFpbGVkIHBvb2xlZCBjaGlsZC5cbiAgICogQHBhcmFtIHtudW1iZXIgfCBudWxsfSBhcmdzLmV4aXRDb2RlIC0gQ2hpbGQgZXhpdCBjb2RlIHdoZW4gb2JzZXJ2ZWQuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi90eXBlcy5qc1wiKS5Qb29sZWRSdW5uZXJGYWlsdXJlT3JpZ2lufSBhcmdzLm9yaWdpbiAtIFdvcmtlciBvYnNlcnZhdGlvbiB0aGF0IGluaXRpYXRlZCByZWNvdmVyeS5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCJub2RlOmNoaWxkX3Byb2Nlc3NcIikuQ2hpbGRQcm9jZXNzW1wic2lnbmFsQ29kZVwiXX0gYXJncy5zaWduYWwgLSBDaGlsZCB0ZXJtaW5hdGlvbiBzaWduYWwgd2hlbiBvYnNlcnZlZC5cbiAgICogQHBhcmFtIHtQb29sZWRDaGlsZFN0YXRlfSBhcmdzLnN0YXRlIC0gQ2hpbGQgc3RhdGUgaW1tZWRpYXRlbHkgYmVmb3JlIHJlY292ZXJ5LlxuICAgKiBAcmV0dXJucyB7aW1wb3J0KFwiLi90eXBlcy5qc1wiKS5Qb29sZWRSdW5uZXJGYWlsdXJlfSAtIFNoYXJlZCBmYWlsdXJlIHByb3ZlbmFuY2UuXG4gICAqL1xuICBfcG9vbGVkUnVubmVyRmFpbHVyZSh7Y2hpbGQsIGV4aXRDb2RlLCBvcmlnaW4sIHNpZ25hbCwgc3RhdGV9KSB7XG4gICAgY29uc3Qgb2JzZXJ2YXRpb24gPSBzdGF0ZS5zaHV0ZG93bk9ic2VydmF0aW9uXG4gICAgbGV0IHNodXRkb3duUmVhc29uID0gc3RhdGUuc2h1dGRvd25SZWFzb24gPz8gb2JzZXJ2YXRpb24/LnJlYXNvblxuICAgIGlmICghc2h1dGRvd25SZWFzb24pIHtcbiAgICAgIGlmIChvcmlnaW4gPT09IFwicHJvY2Vzcy1lcnJvclwiIHx8IG9yaWdpbiA9PT0gXCJpcGMtc2VuZFwiKSB7XG4gICAgICAgIHNodXRkb3duUmVhc29uID0gXCJwcm9jZXNzX2Vycm9yXCJcbiAgICAgIH0gZWxzZSBpZiAoc2lnbmFsID09PSBcIlNJR1RFUk1cIikge1xuICAgICAgICBzaHV0ZG93blJlYXNvbiA9IFwic2lnbmFsX3NpZ3Rlcm1cIlxuICAgICAgfSBlbHNlIGlmIChzaWduYWwgPT09IFwiU0lHSU5UXCIpIHtcbiAgICAgICAgc2h1dGRvd25SZWFzb24gPSBcInNpZ25hbF9zaWdpbnRcIlxuICAgICAgfSBlbHNlIGlmIChzaWduYWwgPT09IFwiU0lHS0lMTFwiKSB7XG4gICAgICAgIHNodXRkb3duUmVhc29uID0gXCJzaWduYWxfc2lna2lsbFwiXG4gICAgICB9IGVsc2UgaWYgKHNpZ25hbCkge1xuICAgICAgICBzaHV0ZG93blJlYXNvbiA9IFwic2lnbmFsX290aGVyXCJcbiAgICAgIH0gZWxzZSBpZiAoc3RhdGUuaXBjRGlzY29ubmVjdGVkQXRNcyAmJiBleGl0Q29kZSA9PT0gMCkge1xuICAgICAgICBzaHV0ZG93blJlYXNvbiA9IFwiaXBjX2Rpc2Nvbm5lY3RcIlxuICAgICAgfSBlbHNlIHtcbiAgICAgICAgc2h1dGRvd25SZWFzb24gPSBcInVuZXhwZWN0ZWRfZXhpdFwiXG4gICAgICB9XG4gICAgfVxuICAgIGNvbnN0IHRlcm1pbmF0aW9uUmVhc29uID0gc2h1dGRvd25SZWFzb24gPT09IFwiam9iX3RpbWVvdXRcIlxuICAgICAgPyBcImpvYi10aW1lb3V0XCJcbiAgICAgIDogc2h1dGRvd25SZWFzb24gPT09IFwid29ya2VyX3N0b3BcIiA/IFwid29ya2VyLXNodXRkb3duLXRpbWVvdXRcIiA6IFwidW5leHBlY3RlZFwiXG4gICAgY29uc3Qgd29ya2VyTGlmZWN5Y2xlID0gdGhpcy5zaG91bGRTdG9wID8gXCJzdG9wcGluZ1wiIDogdGhpcy5pc1JldGlyaW5nID8gXCJyZXRpcmluZ1wiIDogXCJydW5uaW5nXCJcbiAgICBjb25zdCBydW5uZXJMaWZlY3ljbGUgPSBzdGF0ZS5zdGFydGVkID09PSBmYWxzZSA/IFwic3RhcnRpbmdcIiA6IHN0YXRlLnJldGlyaW5nID8gXCJyZXRpcmluZ1wiIDogXCJydW5uaW5nXCJcbiAgICBjb25zdCBib3VuZGVkSW5mbGlnaHQgPSBib3VuZGVkUG9vbGVkUnVubmVySW5mbGlnaHRKb2JJZHMoc3RhdGUuaW5mbGlnaHQua2V5cygpKVxuICAgIGNvbnN0IGFjdGl2ZUpvYnMgPSBbLi4uc3RhdGUuaW5mbGlnaHQudmFsdWVzKCldXG4gICAgICAubWFwKChlbnRyeSkgPT4gKHtcbiAgICAgICAgaGFuZG9mZklkOiBlbnRyeS5wYXlsb2FkLmhhbmRvZmZJZCA/PyBudWxsLFxuICAgICAgICBoYW5kZWRPZmZBdE1zOiBlbnRyeS5wYXlsb2FkLmhhbmRlZE9mZkF0TXMgPz8gbnVsbCxcbiAgICAgICAgam9iSWQ6IGVudHJ5LnBheWxvYWQuaWQsXG4gICAgICAgIGpvYk5hbWU6IGVudHJ5LnBheWxvYWQuam9iTmFtZSxcbiAgICAgICAgd29ya2VySWQ6IGVudHJ5LnBheWxvYWQud29ya2VySWQgPz8gdGhpcy53b3JrZXJJZFxuICAgICAgfSkpXG4gICAgICAuc29ydCgobGVmdCwgcmlnaHQpID0+IGxlZnQuam9iSWQubG9jYWxlQ29tcGFyZShyaWdodC5qb2JJZCkpXG5cbiAgICByZXR1cm4gT2JqZWN0LmZyZWV6ZSh7XG4gICAgICBhY3RpdmVKb2JzLFxuICAgICAgY2hpbGRJbnN0YW5jZUlkOiBzdGF0ZS5jaGlsZEluc3RhbmNlSWQgPz8gb2JzZXJ2YXRpb24/LmNoaWxkSW5zdGFuY2VJZCA/PyBudWxsLFxuICAgICAgZXhpdENvZGUsXG4gICAgICBnZW5lcmF0aW9uSWQ6IHRoaXMuZ2VuZXJhdGlvbklkID8/IG51bGwsXG4gICAgICAuLi5ib3VuZGVkSW5mbGlnaHQsXG4gICAgICBvb21LaWxsZWQ6IHNpZ25hbCA9PT0gXCJTSUdLSUxMXCIgJiYgc2h1dGRvd25SZWFzb24gPT09IFwic2lnbmFsX3NpZ2tpbGxcIiA/IG51bGwgOiBmYWxzZSxcbiAgICAgIG9yaWdpbixcbiAgICAgIHJ1bm5lckFnZU1zOiBNYXRoLm1heCgwLCBEYXRlLm5vdygpIC0gc3RhdGUuY3JlYXRlZEF0TXMpLFxuICAgICAgcnVubmVyQ3JlYXRlZEF0TXM6IHN0YXRlLmNyZWF0ZWRBdE1zLFxuICAgICAgcnVubmVyRGV0YWNoZWQ6IGZhbHNlLFxuICAgICAgcnVubmVySm9ic1J1bjogc3RhdGUuam9ic1J1bixcbiAgICAgIHJ1bm5lckxpZmVjeWNsZSxcbiAgICAgIHJ1bm5lclBpZDogY2hpbGQucGlkID8/IG51bGwsXG4gICAgICBzaWduYWwsXG4gICAgICBzaHV0ZG93bk9ic2VydmVkQXRNczogb2JzZXJ2YXRpb24/LnNodXRkb3duT2JzZXJ2ZWRBdE1zID8/IHN0YXRlLmlwY0Rpc2Nvbm5lY3RlZEF0TXMgPz8gbnVsbCxcbiAgICAgIHNodXRkb3duUmVxdWVzdGVkQXRNczogc3RhdGUuc2h1dGRvd25SZXF1ZXN0ZWRBdE1zID8/IG9ic2VydmF0aW9uPy5zaHV0ZG93blJlcXVlc3RlZEF0TXMgPz8gbnVsbCxcbiAgICAgIHNodXRkb3duUmVhc29uLFxuICAgICAgc2h1dGRvd25TaWduYWw6IHN0YXRlLnNodXRkb3duU2lnbmFsID8/IG9ic2VydmF0aW9uPy5zaWduYWwgPz8gc2lnbmFsLFxuICAgICAgdGVybWluYXRpb25SZWFzb24sXG4gICAgICB0aW1lb3V0Sm9iSWQ6IHN0YXRlLnRpbWVvdXRKb2JJZCA/PyBudWxsLFxuICAgICAgd29ya2VySWQ6IHRoaXMud29ya2VySWQsXG4gICAgICB3b3JrZXJMaWZlY3ljbGUsXG4gICAgICB3b3JrZXJQaWQ6IHByb2Nlc3MucGlkXG4gICAgfSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHJ1biBqb2IgaW5saW5lLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vdHlwZXMuanNcIikuQmFja2dyb3VuZEpvYlBheWxvYWR9IHBheWxvYWQgLSBQYXlsb2FkLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyB3aGVuIGRvbmUuXG4gICAqL1xuICBhc3luYyBfcnVuSm9iSW5saW5lKHBheWxvYWQpIHtcbiAgICBjb25zdCBjb25maWd1cmF0aW9uID0gdGhpcy5jb25maWd1cmF0aW9uXG4gICAgaWYgKCFjb25maWd1cmF0aW9uKSB0aHJvdyBuZXcgRXJyb3IoXCJCYWNrZ3JvdW5kIGpvYnMgd29ya2VyIGNvbmZpZ3VyYXRpb24gbm90IGluaXRpYWxpemVkXCIpXG5cbiAgICBjb25zdCByZWdpc3RyeSA9IG5ldyBCYWNrZ3JvdW5kSm9iUmVnaXN0cnkoe2NvbmZpZ3VyYXRpb259KVxuICAgIGF3YWl0IHJlZ2lzdHJ5LmxvYWQoKVxuICAgIGNvbnN0IEpvYkNsYXNzID0gcmVnaXN0cnkuZ2V0Sm9iQnlOYW1lKHBheWxvYWQuam9iTmFtZSlcbiAgICBhd2FpdCBydW5XaXRoQmFja2dyb3VuZEpvYlBheWxvYWQocGF5bG9hZCwgYXN5bmMgKCkgPT4ge1xuICAgICAgYXdhaXQgcGVyZm9ybUJhY2tncm91bmRKb2Ioe1xuICAgICAgICBjb25maWd1cmF0aW9uLFxuICAgICAgICBKb2JDbGFzcyxcbiAgICAgICAgam9iQXJnczogcGF5bG9hZC5hcmdzIHx8IFtdLFxuICAgICAgICBqb2JPcHRpb25zOiBwYXlsb2FkLm9wdGlvbnMgfHwge30sXG4gICAgICAgIG5hbWU6IGBCYWNrZ3JvdW5kIGpvYiB3b3JrZXIgaW5saW5lOiAke3BheWxvYWQuam9iTmFtZX1gLFxuICAgICAgICBwYXlsb2FkXG4gICAgICB9KVxuICAgIH0pXG4gIH1cblxuICAvKipcbiAgICogUnVucyBmb3JrIGpvYi5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL3R5cGVzLmpzXCIpLkJhY2tncm91bmRKb2JQYXlsb2FkICYge2lkOiBzdHJpbmd9fSBwYXlsb2FkIC0gUGF5bG9hZC5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgd2hlbiB0aGUgZm9ya2VkIHJ1bm5lciBleGl0cyBvciBmb3JrIGZhaWxzLlxuICAgKi9cbiAgX2ZvcmtKb2IocGF5bG9hZCkge1xuICAgIGNvbnN0IGNoaWxkID0gdGhpcy5fY3JlYXRlRm9ya2VkQ2hpbGQoKVxuXG4gICAgdGhpcy5pbmZsaWdodFByb2Nlc3NDaGlsZHJlbi5hZGQoY2hpbGQpXG5cbiAgICBjb25zdCBmaW5pc2hlZCA9IHRoaXMuX3dhaXRGb3JGb3JrZWRDaGlsZCh7Y2hpbGQsIHBheWxvYWR9KVxuXG4gICAgdGhpcy5fc2VuZEZvcmtlZFBheWxvYWQoe2NoaWxkLCBwYXlsb2FkfSlcblxuICAgIHJldHVybiBmaW5pc2hlZFxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgY3JlYXRlIGZvcmtlZCBjaGlsZC5cbiAgICogQHJldHVybnMge2ltcG9ydChcIm5vZGU6Y2hpbGRfcHJvY2Vzc1wiKS5DaGlsZFByb2Nlc3N9IC0gRm9ya2VkIGNoaWxkIHByb2Nlc3MuXG4gICAqL1xuICBfY3JlYXRlRm9ya2VkQ2hpbGQoKSB7XG4gICAgY29uc3QgY29uZmlndXJhdGlvbiA9IHRoaXMuY29uZmlndXJhdGlvblxuICAgIGlmICghY29uZmlndXJhdGlvbikgdGhyb3cgbmV3IEVycm9yKFwiQmFja2dyb3VuZCBqb2JzIHdvcmtlciBjb25maWd1cmF0aW9uIG5vdCBpbml0aWFsaXplZFwiKVxuXG4gICAgY29uc3QgZGlyZWN0b3J5ID0gY29uZmlndXJhdGlvbi5nZXREaXJlY3RvcnkoKVxuICAgIHJldHVybiBmb3JrKEZPUktFRF9SVU5ORVJfRU5UUllfUEFUSCwgW10sIHtcbiAgICAgIGN3ZDogZGlyZWN0b3J5LFxuICAgICAgZXhlY0FyZ3Y6IFtdLFxuICAgICAgc3RkaW86IFtcImlnbm9yZVwiLCBcImlnbm9yZVwiLCBcImlnbm9yZVwiLCBcImlwY1wiXSxcbiAgICAgIGVudjogT2JqZWN0LmFzc2lnbih7fSwgcHJvY2Vzcy5lbnYsIHRoaXMuX2NoaWxkQmFja2dyb3VuZEpvYnNFbnZpcm9ubWVudCgpKVxuICAgIH0pXG4gIH1cblxuICAvKipcbiAgICogUnVucyB3YWl0IGZvciBmb3JrZWQgY2hpbGQuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gT3B0aW9ucy5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCJub2RlOmNoaWxkX3Byb2Nlc3NcIikuQ2hpbGRQcm9jZXNzfSBhcmdzLmNoaWxkIC0gRm9ya2VkIGNoaWxkIHByb2Nlc3MuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi90eXBlcy5qc1wiKS5CYWNrZ3JvdW5kSm9iUGF5bG9hZCAmIHtpZDogc3RyaW5nfX0gYXJncy5wYXlsb2FkIC0gUGF5bG9hZC5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgd2hlbiB0aGUgY2hpbGQgZXhpdHMuXG4gICAqL1xuICBfd2FpdEZvckZvcmtlZENoaWxkKHtjaGlsZCwgcGF5bG9hZH0pIHtcbiAgICBjb25zdCB0aW1lb3V0U3RhdGUgPSB0aGlzLl9hcm1Gb3JrZWRKb2JUaW1lb3V0KHtjaGlsZCwgcGF5bG9hZH0pXG5cbiAgICByZXR1cm4gbmV3IFByb21pc2UoKHJlc29sdmUpID0+IHtcbiAgICAgIGNoaWxkLm9uY2UoXCJleGl0XCIsIChjb2RlLCBzaWduYWwpID0+IHtcbiAgICAgICAgdGhpcy5fY2xlYXJGb3JrZWRKb2JUaW1lb3V0KHRpbWVvdXRTdGF0ZSlcbiAgICAgICAgdGhpcy5faGFuZGxlRm9ya2VkQ2hpbGRFeGl0KHtjaGlsZCwgY29kZSwgc2lnbmFsLCBwYXlsb2FkLCByZXNvbHZlLCB0aW1lb3V0U3RhdGV9KVxuICAgICAgfSlcbiAgICAgIGNoaWxkLm9uY2UoXCJlcnJvclwiLCAoZXJyb3IpID0+IHtcbiAgICAgICAgdGhpcy5fY2xlYXJGb3JrZWRKb2JUaW1lb3V0KHRpbWVvdXRTdGF0ZSlcbiAgICAgICAgdGhpcy5faGFuZGxlRm9ya2VkQ2hpbGRFcnJvcih7Y2hpbGQsIGVycm9yLCBwYXlsb2FkLCByZXNvbHZlfSlcbiAgICAgIH0pXG4gICAgfSlcbiAgfVxuXG4gIC8qKlxuICAgKiBBcm1zIGEgd2FsbC1jbG9jayBiYWNrc3RvcCBmb3IgYSBmb3JrZWQgam9iIHJ1bm5lci4gQSBmb3JrZWQgam9iIHN0aWxsXG4gICAqIHJ1bm5pbmcgYWZ0ZXIgYGpvYlRpbWVvdXRNc2AgaXMgdGVybWluYXRlZCAoU0lHVEVSTSwgdGhlbiBTSUdLSUxMIGFmdGVyIHRoZVxuICAgKiBncmFjZSkgc28gYSBzaW5nbGUgZ2VudWluZWx5LWh1bmcgcnVubmVyIGNhbid0IHBpbiBhIGRyYWluaW5nIHdvcmtlciDigJQgYW5kXG4gICAqIGl0cyBmdWxsLWFwcCBib290IGFuZCBkYXRhYmFzZSBjb25uZWN0aW9ucyDigJQgaW5kZWZpbml0ZWx5LiBSZXR1cm5zIGEgc3RhdGVcbiAgICogb2JqZWN0IHRoZSBleGl0L2Vycm9yIGhhbmRsZXJzIHVzZSB0byBjYW5jZWwgdGhlIHRpbWVyIGFuZCB0byByZXBvcnQgYVxuICAgKiB0aW1lb3V0LXNwZWNpZmljIGZhaWx1cmUuIFdoZW4gbm8gdGltZW91dCBpcyBjb25maWd1cmVkIHRoZSB0aW1lciBpcyBudWxsXG4gICAqIGFuZCBiZWhhdmlvciBpcyB1bmNoYW5nZWQuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gT3B0aW9ucy5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCJub2RlOmNoaWxkX3Byb2Nlc3NcIikuQ2hpbGRQcm9jZXNzfSBhcmdzLmNoaWxkIC0gRm9ya2VkIGNoaWxkIHByb2Nlc3MuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi90eXBlcy5qc1wiKS5CYWNrZ3JvdW5kSm9iUGF5bG9hZCAmIHtpZDogc3RyaW5nfX0gYXJncy5wYXlsb2FkIC0gSm9iIHBheWxvYWQuXG4gICAqIEByZXR1cm5zIHtGb3JrZWRKb2JUaW1lb3V0U3RhdGV9IC0gVGltZW91dCBzdGF0ZS5cbiAgICovXG4gIF9hcm1Gb3JrZWRKb2JUaW1lb3V0KHtjaGlsZCwgcGF5bG9hZH0pIHtcbiAgICBjb25zdCB0aW1lb3V0TXMgPSB0aGlzLl9yZXNvbHZlSm9iVGltZW91dE1zKHBheWxvYWQub3B0aW9ucylcbiAgICAvKiogQHR5cGUge0ZvcmtlZEpvYlRpbWVvdXRTdGF0ZX0gKi9cbiAgICBjb25zdCBzdGF0ZSA9IHt0aW1lZE91dDogZmFsc2UsIHRpbWVvdXRNcywgdGltZXI6IG51bGwsIHNpZ2tpbGxUaW1lcjogbnVsbH1cblxuICAgIGlmICghKHR5cGVvZiB0aW1lb3V0TXMgPT09IFwibnVtYmVyXCIgJiYgdGltZW91dE1zID4gMCkpIHJldHVybiBzdGF0ZVxuXG4gICAgc3RhdGUudGltZXIgPSBzZXRUaW1lb3V0KCgpID0+IHRoaXMuX29uRm9ya2VkSm9iVGltZW91dCh7Y2hpbGQsIHN0YXRlfSksIHRpbWVvdXRNcylcblxuICAgIHJldHVybiBzdGF0ZVxuICB9XG5cbiAgLyoqXG4gICAqIFJlc29sdmVzIHRoZSBlZmZlY3RpdmUgd2FsbC1jbG9jayBqb2IgdGltZW91dCBpbiBtcyAoc2hhcmVkIGJ5IGZvcmtlZCBhbmQgcG9vbGVkIGpvYnMpLCBvciBudWxsIHdoZW4gZGlzYWJsZWQuIFRoZVxuICAgKiBwZXItam9iIG92ZXJyaWRlIHdpbnMsIGZvbGxvd2VkIGJ5IHRoZSBjb25zdHJ1Y3RvciBvdmVycmlkZSwgdGhlbiB0aGUgdmFsdWVcbiAgICogZnJvbSB0aGUgYmFja2dyb3VuZC1qb2JzIGNvbmZpZ3VyYXRpb24uIEEgbm9uLXBvc2l0aXZlIHZhbHVlIGRpc2FibGVzIHRoZVxuICAgKiBiYWNrc3RvcCBhdCB3aGljaGV2ZXIgbGV2ZWwgc3VwcGxpZWQgaXQuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi90eXBlcy5qc1wiKS5CYWNrZ3JvdW5kSm9iT3B0aW9uc30gW2pvYk9wdGlvbnNdIC0gUGVyLWpvYiBvcHRpb25zLlxuICAgKiBAcmV0dXJucyB7bnVtYmVyIHwgbnVsbH0gLSBUaW1lb3V0IGluIG1zLCBvciBudWxsIHdoZW4gZGlzYWJsZWQuXG4gICAqL1xuICBfcmVzb2x2ZUpvYlRpbWVvdXRNcyhqb2JPcHRpb25zKSB7XG4gICAgY29uc3QgcmF3ID0gdHlwZW9mIGpvYk9wdGlvbnM/LnRpbWVvdXRNcyA9PT0gXCJudW1iZXJcIlxuICAgICAgPyBqb2JPcHRpb25zLnRpbWVvdXRNc1xuICAgICAgOiAodHlwZW9mIHRoaXMuam9iVGltZW91dE1zT3ZlcnJpZGUgPT09IFwibnVtYmVyXCJcbiAgICAgICAgICA/IHRoaXMuam9iVGltZW91dE1zT3ZlcnJpZGVcbiAgICAgICAgICA6ICh0aGlzLmNvbmZpZ3VyYXRpb24gPyB0aGlzLmNvbmZpZ3VyYXRpb24uZ2V0QmFja2dyb3VuZEpvYnNDb25maWcoKS5qb2JUaW1lb3V0TXMgOiBudWxsKSlcblxuICAgIC8vIEEgbm9uLWZpbml0ZSAoZS5nLiBJbmZpbml0eSkgb3Igbm9uLXBvc2l0aXZlIHZhbHVlIGRpc2FibGVzIHRoZSBiYWNrc3RvcDtcbiAgICAvLyBhIGZpbml0ZSB2YWx1ZSBiZXlvbmQgTm9kZSdzIHRpbWVyIHJhbmdlIGlzIGNsYW1wZWQgdG8gdGhlIG1heCByYXRoZXIgdGhhblxuICAgIC8vIHNpbGVudGx5IGNvZXJjZWQgdG8gfjFtcyAod2hpY2ggd291bGQga2lsbCBldmVyeSBmb3JrZWQgam9iIGltbWVkaWF0ZWx5KS5cbiAgICBpZiAodHlwZW9mIHJhdyAhPT0gXCJudW1iZXJcIiB8fCAhTnVtYmVyLmlzRmluaXRlKHJhdykgfHwgcmF3IDw9IDApIHJldHVybiBudWxsXG5cbiAgICByZXR1cm4gTWF0aC5taW4ocmF3LCBNQVhfRk9SS0VEX0pPQl9USU1FT1VUX01TKVxuICB9XG5cbiAgLyoqXG4gICAqIEZpcmVkIHdoZW4gYSBmb3JrZWQgcnVubmVyIG92ZXJydW5zIGl0cyB0aW1lb3V0LiBTZW5kcyBTSUdURVJNIGZvciBhIGNsZWFuXG4gICAqIHNodXRkb3duLCB0aGVuIFNJR0tJTEwgYWZ0ZXIgdGhlIGdyYWNlIGZvciBhIHJ1bm5lciB0aGF0IGlnbm9yZXMgaXQuIFRoZVxuICAgKiByZXN1bHRpbmcgbm9uLWNsZWFuIGV4aXQgZmxvd3MgdGhyb3VnaCBgX2hhbmRsZUZvcmtlZENoaWxkRXhpdGAsIHdoaWNoIGZyZWVzXG4gICAqIHRoZSBzbG90IGFuZCByZXBvcnRzIHRoZSBqb2IgZmFpbGVkLlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIE9wdGlvbnMuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwibm9kZTpjaGlsZF9wcm9jZXNzXCIpLkNoaWxkUHJvY2Vzc30gYXJncy5jaGlsZCAtIEZvcmtlZCBjaGlsZCBwcm9jZXNzLlxuICAgKiBAcGFyYW0ge0ZvcmtlZEpvYlRpbWVvdXRTdGF0ZX0gYXJncy5zdGF0ZSAtIFRpbWVvdXQgc3RhdGUuXG4gICAqIEByZXR1cm5zIHt2b2lkfVxuICAgKi9cbiAgX29uRm9ya2VkSm9iVGltZW91dCh7Y2hpbGQsIHN0YXRlfSkge1xuICAgIHN0YXRlLnRpbWVkT3V0ID0gdHJ1ZVxuXG4gICAgdHJ5IHtcbiAgICAgIGNoaWxkLmtpbGwoXCJTSUdURVJNXCIpXG4gICAgfSBjYXRjaCB7XG4gICAgICAvLyBDaGlsZCBhbHJlYWR5IGV4aXRlZDsgbm90aGluZyB0byBkby5cbiAgICB9XG5cbiAgICBzdGF0ZS5zaWdraWxsVGltZXIgPSBzZXRUaW1lb3V0KCgpID0+IHtcbiAgICAgIHRyeSB7XG4gICAgICAgIGNoaWxkLmtpbGwoXCJTSUdLSUxMXCIpXG4gICAgICB9IGNhdGNoIHtcbiAgICAgICAgLy8gQ2hpbGQgYWxyZWFkeSBleGl0ZWQ7IG5vdGhpbmcgdG8gZG8uXG4gICAgICB9XG4gICAgfSwgdGhpcy5mb3JrZWRDaGlsZFNpZ2tpbGxHcmFjZU1zKVxuICB9XG5cbiAgLyoqXG4gICAqIENhbmNlbHMgYW55IHBlbmRpbmcgdGltZW91dC9TSUdLSUxMIHRpbWVycyBmb3IgYSBmb3JrZWQgcnVubmVyIHRoYXQgaGFzXG4gICAqIGV4aXRlZCAob3IgZXJyb3JlZCkgc28gdGhleSBuZXZlciBmaXJlIGFnYWluc3QgYSBnb25lIG9yIHJldXNlZCBjaGlsZC5cbiAgICogQHBhcmFtIHtGb3JrZWRKb2JUaW1lb3V0U3RhdGV9IHN0YXRlIC0gVGltZW91dCBzdGF0ZS5cbiAgICogQHJldHVybnMge3ZvaWR9XG4gICAqL1xuICBfY2xlYXJGb3JrZWRKb2JUaW1lb3V0KHN0YXRlKSB7XG4gICAgaWYgKHN0YXRlLnRpbWVyKSB7XG4gICAgICBjbGVhclRpbWVvdXQoc3RhdGUudGltZXIpXG4gICAgICBzdGF0ZS50aW1lciA9IG51bGxcbiAgICB9XG5cbiAgICBpZiAoc3RhdGUuc2lna2lsbFRpbWVyKSB7XG4gICAgICBjbGVhclRpbWVvdXQoc3RhdGUuc2lna2lsbFRpbWVyKVxuICAgICAgc3RhdGUuc2lna2lsbFRpbWVyID0gbnVsbFxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGhhbmRsZSBmb3JrZWQgY2hpbGQgZXhpdC5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBPcHRpb25zLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIm5vZGU6Y2hpbGRfcHJvY2Vzc1wiKS5DaGlsZFByb2Nlc3N9IGFyZ3MuY2hpbGQgLSBGb3JrZWQgY2hpbGQgcHJvY2Vzcy5cbiAgICogQHBhcmFtIHtudW1iZXIgfCBudWxsfSBhcmdzLmNvZGUgLSBFeGl0IGNvZGUuXG4gICAqIEBwYXJhbSB7a2V5b2YgdHlwZW9mIGltcG9ydChcIm5vZGU6b3NcIikuY29uc3RhbnRzLnNpZ25hbHMgfCBudWxsfSBhcmdzLnNpZ25hbCAtIEV4aXQgc2lnbmFsLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vdHlwZXMuanNcIikuQmFja2dyb3VuZEpvYlBheWxvYWQgJiB7aWQ6IHN0cmluZ319IGFyZ3MucGF5bG9hZCAtIFBheWxvYWQuXG4gICAqIEBwYXJhbSB7KHZhbHVlOiB2b2lkKSA9PiB2b2lkfSBhcmdzLnJlc29sdmUgLSBQcm9taXNlIHJlc29sdmVyLlxuICAgKiBAcGFyYW0ge0ZvcmtlZEpvYlRpbWVvdXRTdGF0ZX0gW2FyZ3MudGltZW91dFN0YXRlXSAtIFRpbWVvdXQgc3RhdGUsIHdoZW4gdGhlIHJ1bm5lciBoYWQgYSB3YWxsLWNsb2NrIGJhY2tzdG9wLlxuICAgKiBAcmV0dXJucyB7dm9pZH1cbiAgICovXG4gIF9oYW5kbGVGb3JrZWRDaGlsZEV4aXQoe2NoaWxkLCBjb2RlLCBzaWduYWwsIHBheWxvYWQsIHJlc29sdmUsIHRpbWVvdXRTdGF0ZX0pIHtcbiAgICB0aGlzLmluZmxpZ2h0UHJvY2Vzc0NoaWxkcmVuLmRlbGV0ZShjaGlsZClcblxuICAgIC8vIEZyZWUgdGhlIHdvcmtlciBzbG90IGFzIHNvb24gYXMgdGhlIGNoaWxkIGlzIGdvbmUg4oCUIG5ldmVyIGdhdGUgaXQgb24gdGhlXG4gICAgLy8gZmFpbHVyZSByZXBvcnQuIEEgaHVuZy9zbG93IHJlcG9ydCBtdXN0IG5vdCBsZWFrIHRoZSBzbG90OyBlbm91Z2ggbGVha2VkXG4gICAgLy8gc2xvdHMgZHJpdmUgYGFjY2VwdHNGb3JrZWRgIHRvIGZhbHNlIGFuZCBzaWxlbnRseSB3ZWRnZSB0aGUgd29ya2VyLlxuICAgIHJlc29sdmUodW5kZWZpbmVkKVxuXG4gICAgaWYgKHRoaXMuX2ZvcmtlZENoaWxkRXhpdGVkQ2xlYW5seSh7Y29kZSwgc2lnbmFsfSkpIHJldHVyblxuXG4gICAgY29uc3QgZXJyb3IgPSB0aW1lb3V0U3RhdGU/LnRpbWVkT3V0XG4gICAgICA/IG5ldyBFcnJvcihgRm9ya2VkIGJhY2tncm91bmQgam9iIHJ1bm5lciB0aW1lZCBvdXQgYWZ0ZXIgJHt0aW1lb3V0U3RhdGUudGltZW91dE1zfW1zIGFuZCB3YXMgdGVybWluYXRlZDogY29kZT0ke2NvZGV9IHNpZ25hbD0ke3NpZ25hbCB8fCBcIm5vbmVcIn1gKVxuICAgICAgOiBuZXcgRXJyb3IoYEZvcmtlZCBiYWNrZ3JvdW5kIGpvYiBydW5uZXIgZXhpdGVkIGJlZm9yZSByZXBvcnRpbmc6IGNvZGU9JHtjb2RlfSBzaWduYWw9JHtzaWduYWwgfHwgXCJub25lXCJ9YClcblxuICAgIHRoaXMuX3JlcG9ydEZvcmtlZENoaWxkRmFpbHVyZSh7cGF5bG9hZCwgZXJyb3J9KVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZm9ya2VkIGNoaWxkIGV4aXRlZCBjbGVhbmx5LlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIE9wdGlvbnMuXG4gICAqIEBwYXJhbSB7bnVtYmVyIHwgbnVsbH0gYXJncy5jb2RlIC0gRXhpdCBjb2RlLlxuICAgKiBAcGFyYW0ge2tleW9mIHR5cGVvZiBpbXBvcnQoXCJub2RlOm9zXCIpLmNvbnN0YW50cy5zaWduYWxzIHwgbnVsbH0gYXJncy5zaWduYWwgLSBFeGl0IHNpZ25hbC5cbiAgICogQHJldHVybnMge2Jvb2xlYW59IC0gV2hldGhlciB0aGUgY2hpbGQgZXhpdGVkIGNsZWFubHkuXG4gICAqL1xuICBfZm9ya2VkQ2hpbGRFeGl0ZWRDbGVhbmx5KHtjb2RlLCBzaWduYWx9KSB7XG4gICAgcmV0dXJuIGNvZGUgPT09IDAgJiYgIXNpZ25hbFxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgaGFuZGxlIGZvcmtlZCBjaGlsZCBlcnJvci5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBPcHRpb25zLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIm5vZGU6Y2hpbGRfcHJvY2Vzc1wiKS5DaGlsZFByb2Nlc3N9IGFyZ3MuY2hpbGQgLSBGb3JrZWQgY2hpbGQgcHJvY2Vzcy5cbiAgICogQHBhcmFtIHtFcnJvcn0gYXJncy5lcnJvciAtIENoaWxkIHByb2Nlc3MgZXJyb3IuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi90eXBlcy5qc1wiKS5CYWNrZ3JvdW5kSm9iUGF5bG9hZCAmIHtpZDogc3RyaW5nfX0gYXJncy5wYXlsb2FkIC0gUGF5bG9hZC5cbiAgICogQHBhcmFtIHsodmFsdWU6IHZvaWQpID0+IHZvaWR9IGFyZ3MucmVzb2x2ZSAtIFByb21pc2UgcmVzb2x2ZXIuXG4gICAqIEByZXR1cm5zIHt2b2lkfVxuICAgKi9cbiAgX2hhbmRsZUZvcmtlZENoaWxkRXJyb3Ioe2NoaWxkLCBlcnJvciwgcGF5bG9hZCwgcmVzb2x2ZX0pIHtcbiAgICB0aGlzLmluZmxpZ2h0UHJvY2Vzc0NoaWxkcmVuLmRlbGV0ZShjaGlsZClcbiAgICAvLyBGcmVlIHRoZSBzbG90IGZpcnN0IChzZWUgX2hhbmRsZUZvcmtlZENoaWxkRXhpdCkg4oCUIHJlcG9ydGluZyBpcyBiZXN0LWVmZm9ydC5cbiAgICByZXNvbHZlKHVuZGVmaW5lZClcbiAgICBjb25zb2xlLmVycm9yKFwiQmFja2dyb3VuZCBqb2JzIGZvcmtlZCBydW5uZXIgZXJyb3I6XCIsIGVycm9yKVxuICAgIHRoaXMuX3JlcG9ydEZvcmtlZENoaWxkRmFpbHVyZSh7cGF5bG9hZCwgZXJyb3J9KVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgc2VuZCBmb3JrZWQgcGF5bG9hZC5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBPcHRpb25zLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIm5vZGU6Y2hpbGRfcHJvY2Vzc1wiKS5DaGlsZFByb2Nlc3N9IGFyZ3MuY2hpbGQgLSBGb3JrZWQgY2hpbGQgcHJvY2Vzcy5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL3R5cGVzLmpzXCIpLkJhY2tncm91bmRKb2JQYXlsb2FkICYge2lkOiBzdHJpbmd9fSBhcmdzLnBheWxvYWQgLSBQYXlsb2FkLlxuICAgKiBAcmV0dXJucyB7dm9pZH1cbiAgICovXG4gIF9zZW5kRm9ya2VkUGF5bG9hZCh7Y2hpbGQsIHBheWxvYWR9KSB7XG4gICAgdHJ5IHtcbiAgICAgIGNoaWxkLnNlbmQoe3R5cGU6IFwiam9iXCIsIHBheWxvYWR9KVxuICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICBjaGlsZC5raWxsKFwiU0lHVEVSTVwiKVxuICAgICAgdGhpcy5fcmVwb3J0Rm9ya2VkQ2hpbGRGYWlsdXJlKHtwYXlsb2FkLCBlcnJvcn0pXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgcmVwb3J0IGZvcmtlZCBjaGlsZCBmYWlsdXJlLlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIE9wdGlvbnMuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi90eXBlcy5qc1wiKS5CYWNrZ3JvdW5kSm9iUGF5bG9hZCAmIHtpZDogc3RyaW5nfX0gYXJncy5wYXlsb2FkIC0gUGF5bG9hZC5cbiAgICogQHBhcmFtIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gYXJncy5lcnJvciAtIEVycm9yLlxuICAgKiBAcmV0dXJucyB7dm9pZH1cbiAgICovXG4gIF9yZXBvcnRGb3JrZWRDaGlsZEZhaWx1cmUoe3BheWxvYWQsIGVycm9yfSkge1xuICAgIHRoaXMuX3JlcG9ydEpvYlJlc3VsdEluQmFja2dyb3VuZCh7XG4gICAgICBqb2JJZDogcGF5bG9hZC5pZCxcbiAgICAgIHN0YXR1czogXCJmYWlsZWRcIixcbiAgICAgIGVycm9yLFxuICAgICAgaGFuZG9mZklkOiBwYXlsb2FkLmhhbmRvZmZJZCxcbiAgICAgIGhhbmRlZE9mZkF0TXM6IHBheWxvYWQuaGFuZGVkT2ZmQXRNcyxcbiAgICAgIHdvcmtlcklkOiBwYXlsb2FkLndvcmtlcklkIHx8IHRoaXMud29ya2VySWRcbiAgICB9KVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgc3Bhd24gam9iLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vdHlwZXMuanNcIikuQmFja2dyb3VuZEpvYlBheWxvYWR9IHBheWxvYWQgLSBQYXlsb2FkLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyB3aGVuIHRoZSBzcGF3bmVkIHJ1bm5lciBleGl0cyBvciBzcGF3biBmYWlscy5cbiAgICovXG4gIF9zcGF3bkpvYihwYXlsb2FkKSB7XG4gICAgY29uc3QgY29uZmlndXJhdGlvbiA9IHRoaXMuY29uZmlndXJhdGlvblxuICAgIGlmICghY29uZmlndXJhdGlvbikgdGhyb3cgbmV3IEVycm9yKFwiQmFja2dyb3VuZCBqb2JzIHdvcmtlciBjb25maWd1cmF0aW9uIG5vdCBpbml0aWFsaXplZFwiKVxuXG4gICAgY29uc3QgZGlyZWN0b3J5ID0gY29uZmlndXJhdGlvbi5nZXREaXJlY3RvcnkoKVxuICAgIGNvbnN0IGFyZ3ZDb21tYW5kID0gcHJvY2Vzcy5hcmd2WzFdXG4gICAgY29uc3QgY29tbWFuZCA9IGFyZ3ZDb21tYW5kID8gYXJndkNvbW1hbmQgOiBgJHtkaXJlY3Rvcnl9L2Jpbi92ZWxvY2lvdXMuanNgXG4gICAgY29uc3QgZW5jb2RlZFBheWxvYWQgPSBCdWZmZXIuZnJvbShKU09OLnN0cmluZ2lmeShwYXlsb2FkKSkudG9TdHJpbmcoXCJiYXNlNjRcIilcbiAgICBjb25zdCBjaGlsZCA9IHNwYXduKHByb2Nlc3MuZXhlY1BhdGgsIFtjb21tYW5kLCBcImJhY2tncm91bmQtam9icy1ydW5uZXJcIl0sIHtcbiAgICAgIGN3ZDogZGlyZWN0b3J5LFxuICAgICAgZGV0YWNoZWQ6IHRydWUsXG4gICAgICBzdGRpbzogXCJpZ25vcmVcIixcbiAgICAgIGVudjogT2JqZWN0LmFzc2lnbih7fSwgcHJvY2Vzcy5lbnYsIHRoaXMuX2NoaWxkQmFja2dyb3VuZEpvYnNFbnZpcm9ubWVudCgpLCB7VkVMT0NJT1VTX0pPQl9QQVlMT0FEOiBlbmNvZGVkUGF5bG9hZH0pXG4gICAgfSlcblxuICAgIHRoaXMuaW5mbGlnaHRQcm9jZXNzQ2hpbGRyZW4uYWRkKGNoaWxkKVxuXG4gICAgY29uc3QgZmluaXNoZWQgPSBuZXcgUHJvbWlzZSgocmVzb2x2ZSkgPT4ge1xuICAgICAgY2hpbGQub25jZShcImV4aXRcIiwgKCkgPT4ge1xuICAgICAgICB0aGlzLmluZmxpZ2h0UHJvY2Vzc0NoaWxkcmVuLmRlbGV0ZShjaGlsZClcbiAgICAgICAgcmVzb2x2ZSh1bmRlZmluZWQpXG4gICAgICB9KVxuICAgICAgY2hpbGQub25jZShcImVycm9yXCIsIChlcnJvcikgPT4ge1xuICAgICAgICB0aGlzLmluZmxpZ2h0UHJvY2Vzc0NoaWxkcmVuLmRlbGV0ZShjaGlsZClcbiAgICAgICAgY29uc29sZS5lcnJvcihcIkJhY2tncm91bmQgam9icyBzcGF3bmVkIHJ1bm5lciBlcnJvcjpcIiwgZXJyb3IpXG4gICAgICAgIHJlc29sdmUodW5kZWZpbmVkKVxuICAgICAgfSlcbiAgICB9KVxuXG4gICAgY2hpbGQudW5yZWYoKVxuXG4gICAgcmV0dXJuIGZpbmlzaGVkXG4gIH1cblxuICAvKipcbiAgICogQnVpbGRzIHRoZSBleGFjdCBtYWluIGVuZHBvaW50IGFuZCBnZW5lcmF0aW9uIGluaGVyaXRlZCBieSBldmVyeSBjaGlsZC5cbiAgICogQHJldHVybnMge1JlY29yZDxzdHJpbmcsIHN0cmluZz59IC0gQ2hpbGQgcHJvY2VzcyBlbnZpcm9ubWVudCBhZGRpdGlvbnMuXG4gICAqL1xuICBfY2hpbGRCYWNrZ3JvdW5kSm9ic0Vudmlyb25tZW50KCkge1xuICAgIGNvbnN0IGNvbmZpZ3VyYXRpb24gPSB0aGlzLmNvbmZpZ3VyYXRpb25cbiAgICBpZiAoIWNvbmZpZ3VyYXRpb24pIHRocm93IG5ldyBFcnJvcihcIkJhY2tncm91bmQgam9icyB3b3JrZXIgY29uZmlndXJhdGlvbiBub3QgaW5pdGlhbGl6ZWRcIilcbiAgICBpZiAoIXRoaXMuaG9zdCB8fCB0eXBlb2YgdGhpcy5wb3J0ICE9PSBcIm51bWJlclwiKSB0aHJvdyBuZXcgRXJyb3IoXCJCYWNrZ3JvdW5kIGpvYnMgd29ya2VyIGVuZHBvaW50IG5vdCByZXNvbHZlZFwiKVxuXG4gICAgcmV0dXJuIHtcbiAgICAgIFZFTE9DSU9VU19CQUNLR1JPVU5EX0pPQl9DSElMRDogXCIxXCIsXG4gICAgICBWRUxPQ0lPVVNfRU5WOiBjb25maWd1cmF0aW9uLmdldEVudmlyb25tZW50KCksXG4gICAgICBWRUxPQ0lPVVNfQkFDS0dST1VORF9KT0JTX0hPU1Q6IHRoaXMuaG9zdCxcbiAgICAgIFZFTE9DSU9VU19CQUNLR1JPVU5EX0pPQlNfUE9SVDogYCR7dGhpcy5wb3J0fWAsXG4gICAgICAuLi4odGhpcy5nZW5lcmF0aW9uSWQgPyB7VkVMT0NJT1VTX0JBQ0tHUk9VTkRfSk9CU19HRU5FUkFUSU9OX0lEOiB0aGlzLmdlbmVyYXRpb25JZH0gOiB7fSlcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogUnVucyByZXBvcnQgam9iIHJlc3VsdC5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBPcHRpb25zLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gYXJncy5qb2JJZCAtIEpvYiBpZC5cbiAgICogQHBhcmFtIHtcImNvbXBsZXRlZFwiIHwgXCJmYWlsZWRcIiB8IFwicmVzY2hlZHVsZWRcIn0gYXJncy5zdGF0dXMgLSBTdGF0dXMuXG4gICAqIEBwYXJhbSB7bnVtYmVyfSBbYXJncy5kZWxheU1zXSAtIFJlc2NoZWR1bGUgZGVsYXkgaW4gbWlsbGlzZWNvbmRzLlxuICAgKiBAcGFyYW0ge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSBbYXJncy5lcnJvcl0gLSBFcnJvci5cbiAgICogQHBhcmFtIHtzdHJpbmd9IFthcmdzLmhhbmRvZmZJZF0gLSBIYW5kb2ZmIGxlYXNlIGlkLlxuICAgKiBAcGFyYW0ge251bWJlcn0gW2FyZ3MuaGFuZGVkT2ZmQXRNc10gLSBIYW5kZWQgb2ZmIHRpbWVzdGFtcC5cbiAgICogQHBhcmFtIHtzdHJpbmd9IFthcmdzLndvcmtlcklkXSAtIFdvcmtlciBpZC5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL3R5cGVzLmpzXCIpLlBvb2xlZFJ1bm5lckZhaWx1cmV9IFthcmdzLnJ1bm5lckZhaWx1cmVdIC0gUG9vbGVkLWNoaWxkIHByb2Nlc3MgZmFpbHVyZSBwcm92ZW5hbmNlLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyB3aGVuIHJlcG9ydGVkLlxuICAgKi9cbiAgYXN5bmMgX3JlcG9ydEpvYlJlc3VsdCh7am9iSWQsIHN0YXR1cywgZGVsYXlNcywgZXJyb3IsIGhhbmRvZmZJZCwgaGFuZGVkT2ZmQXRNcywgd29ya2VySWQsIHJ1bm5lckZhaWx1cmV9KSB7XG4gICAgaWYgKCF0aGlzLnN0YXR1c1JlcG9ydGVyKSByZXR1cm5cblxuICAgIHRyeSB7XG4gICAgICAvLyBSZXRyeSBhIHRyYW5zaWVudCBwZXJzaXN0IGZhaWx1cmUgKGBqb2ItdXBkYXRlLWVycm9yYCk6IHRoZSB3b3JrZXIgaXNcbiAgICAgIC8vIGxvbmctbGl2ZWQgYW5kIGNhbm5vdCBleGl0IHRvIHRyaWdnZXIgb3JwaGFuIHJlY2xhaW0sIHNvIGRyb3BwaW5nIHRoZVxuICAgICAgLy8gY29tcGxldGlvbiBoZXJlIHdvdWxkIHN0cmFuZCB0aGUgam9iIGluIGBoYW5kZWRfb2ZmYCBmb3JldmVyIOKAlCBmYXRhbCBmb3IgYVxuICAgICAgLy8gYG1heF9jb25jdXJyZW5jeTogMWAgam9iIChhIHN0cmFuZGVkIHJvdyBibG9ja3MgZXZlcnkgZnV0dXJlIHJ1bikuXG4gICAgICBhd2FpdCB0aGlzLnN0YXR1c1JlcG9ydGVyLnJlcG9ydFdpdGhSZXRyeSh7am9iSWQsIHN0YXR1cywgZGVsYXlNcywgZXJyb3IsIGhhbmRvZmZJZCwgaGFuZGVkT2ZmQXRNcywgd29ya2VySWQsIHJ1bm5lckZhaWx1cmUsIHJldHJ5UGVyc2lzdEVycm9yczogdHJ1ZX0pXG4gICAgfSBjYXRjaCAocmVwb3J0RXJyb3IpIHtcbiAgICAgIGNvbnNvbGUuZXJyb3IoXCJCYWNrZ3JvdW5kIGpvYiBzdGF0dXMgcmVwb3J0aW5nIGZhaWxlZDpcIiwgcmVwb3J0RXJyb3IpXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIEZpcmVzIGEgZHVyYWJsZSBqb2ItcmVzdWx0IHJlcG9ydCB3aXRob3V0IGJsb2NraW5nIHRoZSBjYWxsZXIgKHNvIGZyZWVpbmcgYVxuICAgKiBqb2IvY2hpbGQgc2xvdCBuZXZlciB3YWl0cyBvbiB0aGUgcmVwb3J0KS4gVGhlIHJlcG9ydCBpcyB0cmFja2VkIHNvIGFcbiAgICogZ3JhY2VmdWwgYHN0b3AoKWAgY2FuIGRyYWluIGluLWZsaWdodCByZXBvcnRzIGJlZm9yZSBjbG9zaW5nIHRoZSBzb2NrZXQuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gT3B0aW9ucy5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGFyZ3Muam9iSWQgLSBKb2IgaWQuXG4gICAqIEBwYXJhbSB7XCJjb21wbGV0ZWRcIiB8IFwiZmFpbGVkXCIgfCBcInJlc2NoZWR1bGVkXCJ9IGFyZ3Muc3RhdHVzIC0gU3RhdHVzLlxuICAgKiBAcGFyYW0ge251bWJlcn0gW2FyZ3MuZGVsYXlNc10gLSBSZXNjaGVkdWxlIGRlbGF5IGluIG1pbGxpc2Vjb25kcy5cbiAgICogQHBhcmFtIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gW2FyZ3MuZXJyb3JdIC0gRXJyb3IuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBbYXJncy5oYW5kb2ZmSWRdIC0gSGFuZG9mZiBsZWFzZSBpZC5cbiAgICogQHBhcmFtIHtudW1iZXJ9IFthcmdzLmhhbmRlZE9mZkF0TXNdIC0gSGFuZGVkIG9mZiB0aW1lc3RhbXAuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBbYXJncy53b3JrZXJJZF0gLSBXb3JrZXIgaWQuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi90eXBlcy5qc1wiKS5Qb29sZWRSdW5uZXJGYWlsdXJlfSBbYXJncy5ydW5uZXJGYWlsdXJlXSAtIFBvb2xlZC1jaGlsZCBwcm9jZXNzIGZhaWx1cmUgcHJvdmVuYW5jZS5cbiAgICogQHJldHVybnMge3ZvaWR9XG4gICAqL1xuICBfcmVwb3J0Sm9iUmVzdWx0SW5CYWNrZ3JvdW5kKHtqb2JJZCwgc3RhdHVzLCBkZWxheU1zLCBlcnJvciwgaGFuZG9mZklkLCBoYW5kZWRPZmZBdE1zLCB3b3JrZXJJZCwgcnVubmVyRmFpbHVyZX0pIHtcbiAgICAvKipcbiAgICAgKiBEZWZpbmVzIHJlcG9ydC5cbiAgICAgKiBAdHlwZSB7UHJvbWlzZTx2b2lkPn0gKi9cbiAgICBsZXQgcmVwb3J0XG5cbiAgICByZXBvcnQgPSB0aGlzLl9yZXBvcnRKb2JSZXN1bHQoe2pvYklkLCBzdGF0dXMsIGRlbGF5TXMsIGVycm9yLCBoYW5kb2ZmSWQsIGhhbmRlZE9mZkF0TXMsIHdvcmtlcklkLCBydW5uZXJGYWlsdXJlfSkuZmluYWxseSgoKSA9PiB7XG4gICAgICB0aGlzLmluZmxpZ2h0UmVwb3J0cy5kZWxldGUocmVwb3J0KVxuICAgIH0pXG5cbiAgICB0aGlzLmluZmxpZ2h0UmVwb3J0cy5hZGQocmVwb3J0KVxuICB9XG59XG4iXX0=