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
     * Counts live children still able to run new work. The pool must always
     * keep — or restore, through the bounded over-cap liveness replacement — at
     * least one non-retiring child: with every live child retiring, advertised
     * capacity is zero for the entire drain window, which can stretch to the
     * longest in-flight job, and dispatch silently stalls.
     * @returns {number} - Number of non-retiring pooled children.
     */
    _nonRetiringPooledChildCount() {
        let count = 0;
        for (const state of this.pooledChildStates.values()) {
            if (!state.retiring)
                count += 1;
        }
        return count;
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
     * caller re-checks and waits again. `allowOverCap` is reserved for the
     * bounded liveness replacement: at most one child beyond the cap may exist,
     * and only when every other live child is already retiring (see
     * `_beginRetirePooledChild` for the gate).
     * @param {object} [args] - Spawn options.
     * @param {boolean} [args.allowOverCap] - Allow one over-cap spawn for the liveness replacement.
     * @returns {import("node:child_process").ChildProcess | undefined} - The new child, or undefined when the pool is at its cap.
     */
    _createPooledChild({ allowOverCap = false } = {}) {
        const configuration = this.configuration;
        if (!configuration)
            throw new Error("Background jobs worker configuration not initialized");
        if (!allowOverCap && this.pooledChildren.size >= this.pooledRunnerCount)
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
     * restored immediately without waiting for it to finish draining, and
     * re-advertises that capacity so dispatch can resume at once. The
     * replacement spawn is gated by the cap (the retiring child still counts as
     * live until it exits), so a full pool defers the replacement to the drain
     * path — where a child exit restores a working child through the same
     * bounded liveness replacement (see `_ensureNonRetiringChild`). Without it,
     * a full retirement wave (e.g. every child crossing the peak-RSS threshold
     * after the same memory burst) silently removes all pooled capacity for the
     * whole drain window, which can stretch to the longest in-flight job. The
     * retiring child stops receiving new jobs and is terminated only once its
     * in-flight set drains, so a long-running job (e.g. a build) is never cut
     * off.
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
        // which case the bounded liveness replacement below takes over.
        if (this.shouldStop || !this.configuration)
            return;
        if (this._createPooledChild()) {
            // Fresh capacity exists: re-advertise so the main can dispatch into it
            // without waiting for the next job outcome.
            this._sendReadyIfRunning();
            return;
        }
        if (this._nonRetiringPooledChildCount() > 0)
            return;
        // Liveness replacement: this mark emptied the working pool. Re-advertise
        // the restored capacity immediately after the bounded over-cap spawn.
        if (this._ensureNonRetiringChild())
            this._sendReadyIfRunning();
    }
    /**
     * Keeps — or restores — at least one non-retiring pooled child through the
     * bounded over-cap liveness replacement, used by both the retirement mark
     * (`_beginRetirePooledChild`) and the child-exit path
     * (`_handlePooledChildFailure`): advertised capacity is zero while every
     * live child is retiring, and once they are all retiring no further
     * retirement mark remains to restore a working child — nor can a lazy
     * replacement spawn while the pool counts at its cap — so dispatch would
     * stall cluster-wide until the next draining exit, up to the longest
     * in-flight job (e.g. a multi-minute build). Spawns one replacement over the
     * hard cap (bounded: the gate admits it only when the live count is at most
     * the cap, so at most one over-cap child exists and the next draining exit
     * absorbs it). When even that spawn is unavailable (an over-cap child is
     * already draining), the bounded starvation is logged so it is visible
     * instead of silent.
     * @returns {boolean} - True when a replacement child was spawned.
     */
    _ensureNonRetiringChild() {
        if (this.shouldStop || !this.configuration)
            return false;
        if (this._nonRetiringPooledChildCount() > 0)
            return false;
        if (this.pooledChildren.size <= this.pooledRunnerCount) {
            const livenessChild = this._createPooledChild({ allowOverCap: true });
            if (livenessChild) {
                this._logPooledCapacityEvent("pooled-capacity-liveness-spawn");
                return true;
            }
        }
        // An over-cap child is already draining: the pool waits for the next
        // draining exit, which frees a cap slot for a lazy replacement — and that
        // exit restores a working child through this same path. Log it so this
        // bounded starvation is not silent.
        this._logPooledCapacityEvent("pooled-capacity-starved");
        return false;
    }
    /**
     * Logs one compact pooled-capacity event to the worker's own stderr (the
     * surface that reaches the production log). Used by the bounded liveness
     * replacement in `_ensureNonRetiringChild`: the spawn that keeps dispatch
     * alive through a full retirement wave (at a retirement mark or a child
     * exit), or the bounded starvation when an over-cap child is already
     * draining and the pool must wait for an exit.
     * @param {"pooled-capacity-liveness-spawn" | "pooled-capacity-starved"} event - Event name.
     * @returns {void}
     */
    _logPooledCapacityEvent(event) {
        let retiringChildren = 0;
        for (const state of this.pooledChildStates.values()) {
            if (state.retiring)
                retiringChildren += 1;
        }
        console.error(JSON.stringify({
            event,
            liveChildren: this.pooledChildren.size,
            retiringChildren,
            cap: this.pooledRunnerCount,
            concurrency: this.pooledRunnerConcurrency
        }));
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
        // A child exit can absorb the bounded over-cap liveness replacement while
        // every remaining live child is still retiring — e.g. the replacement
        // retires (or dies) first. No retirement mark remains to restore a working
        // child, and at the cap nothing else can spawn, so advertised capacity
        // would stay zero until the next draining exit — up to the longest
        // in-flight job — starving dispatch cluster-wide. Restore one working
        // child now (same bound: at most one over-cap child) and re-advertise so
        // main can dispatch into it immediately.
        if (state?.started !== false && this.pooledChildren.size > 0 && this._ensureNonRetiringChild()) {
            this._sendReadyIfRunning();
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoid29ya2VyLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiLi4vLi4vLi4vc3JjL2JhY2tncm91bmQtam9icy93b3JrZXIuanMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6IkFBQUEsWUFBWTtBQUVaLE9BQU8sR0FBRyxNQUFNLEtBQUssQ0FBQTtBQUNyQixPQUFPLEVBQUUsSUFBSSxFQUFFLEtBQUssRUFBRSxNQUFNLG9CQUFvQixDQUFBO0FBQ2hELE9BQU8sVUFBVSxNQUFNLGtCQUFrQixDQUFBO0FBQ3pDLE9BQU8scUJBQXFCLE1BQU0sbUJBQW1CLENBQUE7QUFDckQsT0FBTyxxQkFBcUIsTUFBTSw4QkFBOEIsQ0FBQTtBQUNoRSxPQUFPLDRCQUE0QixNQUFNLHNCQUFzQixDQUFBO0FBQy9ELE9BQU8sRUFBRSxVQUFVLEVBQUUsTUFBTSxRQUFRLENBQUE7QUFDbkMsT0FBTyxFQUFFLGFBQWEsRUFBRSxNQUFNLFVBQVUsQ0FBQTtBQUN4QyxPQUFPLGlCQUFpQixFQUFFLEVBQUUsZ0JBQWdCLEVBQUUsTUFBTSxnQ0FBZ0MsQ0FBQTtBQUNwRixPQUFPLDZCQUE2QixNQUFNLHdCQUF3QixDQUFBO0FBQ2xFLE9BQU8sb0JBQW9CLE1BQU0sa0JBQWtCLENBQUE7QUFDbkQsT0FBTyxFQUFFLDJCQUEyQixFQUFFLE1BQU0sd0JBQXdCLENBQUE7QUFDcEUsT0FBTyxFQUFFLHdCQUF3QixFQUFFLE1BQU0sMEJBQTBCLENBQUE7QUFDbkUsT0FBTyw2Q0FBNkMsRUFBRSxFQUFFLHVDQUF1QyxFQUFFLG9DQUFvQyxFQUFFLE1BQU0seUNBQXlDLENBQUE7QUFDdEwsT0FBTyxFQUFFLG1DQUFtQyxFQUFFLGlDQUFpQyxFQUFFLDJCQUEyQixFQUFFLDJCQUEyQixFQUFFLE1BQU0sNkJBQTZCLENBQUE7QUFFOUs7Ozs7Ozs7R0FPRztBQUNIOzs7Ozs7R0FNRztBQUNIOzs7Ozs7Ozs7Ozs7Ozs7Ozs7O0dBbUJHO0FBQ0gsaUZBQWlGO0FBQ2pGLE1BQU0sNkJBQTZCLEdBQUcs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cnQgeyBmb3JrLCBzcGF3biB9IGZyb20gXCJub2RlOmNoaWxkX3Byb2Nlc3NcIlxuaW1wb3J0IEpzb25Tb2NrZXQgZnJvbSBcIi4vanNvbi1zb2NrZXQuanNcIlxuaW1wb3J0IEJhY2tncm91bmRKb2JSZWdpc3RyeSBmcm9tIFwiLi9qb2ItcmVnaXN0cnkuanNcIlxuaW1wb3J0IGNvbmZpZ3VyYXRpb25SZXNvbHZlciBmcm9tIFwiLi4vY29uZmlndXJhdGlvbi1yZXNvbHZlci5qc1wiXG5pbXBvcnQgQmFja2dyb3VuZEpvYnNTdGF0dXNSZXBvcnRlciBmcm9tIFwiLi9zdGF0dXMtcmVwb3J0ZXIuanNcIlxuaW1wb3J0IHsgcmFuZG9tVVVJRCB9IGZyb20gXCJjcnlwdG9cIlxuaW1wb3J0IHsgZmlsZVVSTFRvUGF0aCB9IGZyb20gXCJub2RlOnVybFwiXG5pbXBvcnQgc2h1dGRvd25MaWZlY3ljbGUsIHsgcnVuU2h1dGRvd25TdGVwcyB9IGZyb20gXCIuLi91dGlscy9zaHV0ZG93bi1saWZlY3ljbGUuanNcIlxuaW1wb3J0IEJhY2tncm91bmRKb2JSZXNjaGVkdWxlU2lnbmFsIGZyb20gXCIuL3Jlc2NoZWR1bGUtc2lnbmFsLmpzXCJcbmltcG9ydCBwZXJmb3JtQmFja2dyb3VuZEpvYiBmcm9tIFwiLi9wZXJmb3JtLWpvYi5qc1wiXG5pbXBvcnQgeyBydW5XaXRoQmFja2dyb3VuZEpvYlBheWxvYWQgfSBmcm9tIFwiLi9leGVjdXRpb24tY29udGV4dC5qc1wiXG5pbXBvcnQgeyBjcmVhdGVHZW5lcmF0aW9uV29ya2VySWQgfSBmcm9tIFwiLi9nZW5lcmF0aW9uLWlkZW50aXR5LmpzXCJcbmltcG9ydCBCYWNrZ3JvdW5kSm9ic0dlbmVyYXRpb25IYW5kc2hha2VUaW1lb3V0RXJyb3IsIHsgREVGQVVMVF9HRU5FUkFUSU9OX0hBTkRTSEFLRV9USU1FT1VUX01TLCB2YWxpZGF0ZUdlbmVyYXRpb25IYW5kc2hha2VUaW1lb3V0TXMgfSBmcm9tIFwiLi9nZW5lcmF0aW9uLWhhbmRzaGFrZS10aW1lb3V0LWVycm9yLmpzXCJcbmltcG9ydCB7IFBPT0xFRF9SVU5ORVJfSU5GTElHSFRfSk9CX0lEX0xJTUlULCBib3VuZGVkUG9vbGVkUnVubmVySW5mbGlnaHRKb2JJZHMsIGlzUG9vbGVkQ2hpbGRTaHV0ZG93blJlYXNvbiwgaXNQb29sZWRDaGlsZFNodXRkb3duU2lnbmFsIH0gZnJvbSBcIi4vcG9vbGVkLXJ1bm5lci1zaHV0ZG93bi5qc1wiXG5cbi8qKlxuICogUGVyLWZvcmtlZC1jaGlsZCB0aW1lb3V0IGJvb2trZWVwaW5nLlxuICogQHR5cGVkZWYge29iamVjdH0gRm9ya2VkSm9iVGltZW91dFN0YXRlXG4gKiBAcHJvcGVydHkge2Jvb2xlYW59IHRpbWVkT3V0IC0gV2hldGhlciB0aGUgdGltZW91dCBmaXJlZCBhbmQgdGhlIGNoaWxkIHdhcyB0ZXJtaW5hdGVkLlxuICogQHByb3BlcnR5IHtudW1iZXIgfCBudWxsfSB0aW1lb3V0TXMgLSBUaGUgYXJtZWQgdGltZW91dCBpbiBtcywgb3IgbnVsbCB3aGVuIGRpc2FibGVkLlxuICogQHByb3BlcnR5IHtSZXR1cm5UeXBlPHR5cGVvZiBzZXRUaW1lb3V0PiB8IG51bGx9IHRpbWVyIC0gVGhlIHBlbmRpbmcgdGltZW91dCB0aW1lciwgY2xlYXJlZCBvbiBleGl0LlxuICogQHByb3BlcnR5IHtSZXR1cm5UeXBlPHR5cGVvZiBzZXRUaW1lb3V0PiB8IG51bGx9IHNpZ2tpbGxUaW1lciAtIFRoZSBwZW5kaW5nIFNJR0tJTEwgZ3JhY2UgdGltZXIsIGNsZWFyZWQgb24gZXhpdC5cbiAqL1xuLyoqXG4gKiBAdHlwZWRlZiB7b2JqZWN0fSBQb29sZWRKb2JFbnRyeVxuICogQHByb3BlcnR5IHtpbXBvcnQoXCIuL3R5cGVzLmpzXCIpLkJhY2tncm91bmRKb2JQYXlsb2FkICYge2lkOiBzdHJpbmd9fSBwYXlsb2FkIC0gRHVyYWJsZSBqb2IgcGF5bG9hZC5cbiAqIEBwcm9wZXJ0eSB7KHZhbHVlOiB2b2lkKSA9PiB2b2lkfSBbcmVzb2x2ZV0gLSBDb21wbGV0aW9uIHJlc29sdmVyLlxuICogQHByb3BlcnR5IHtQcm9taXNlPHZvaWQ+fSBbcG9vbGVkSm9iXSAtIFRyYWNrZWQgcG9vbGVkLWpvYiBwcm9taXNlLlxuICogQHByb3BlcnR5IHtSZXR1cm5UeXBlPHR5cGVvZiBzZXRUaW1lb3V0PiB8IG51bGx9IFt0aW1lb3V0VGltZXJdIC0gUGVyLWpvYiB0aW1lb3V0IHRpbWVyLlxuICovXG4vKipcbiAqIEB0eXBlZGVmIHtvYmplY3R9IFBvb2xlZENoaWxkU3RhdGVcbiAqIEBwcm9wZXJ0eSB7bnVtYmVyfSBjcmVhdGVkQXRNcyAtIENoaWxkIGNyZWF0aW9uIHRpbWVzdGFtcC5cbiAqIEBwcm9wZXJ0eSB7c3RyaW5nfSBbY2hpbGRJbnN0YW5jZUlkXSAtIFN0YWJsZSBpZGVudGl0eSByZXBvcnRlZCBieSB0aGUgY2hpbGQuXG4gKiBAcHJvcGVydHkge251bWJlcn0gam9ic1J1biAtIEFja25vd2xlZGdlZCBqb2JzIGNvbXBsZXRlZCBieSB0aGlzIGNoaWxkLlxuICogQHByb3BlcnR5IHtNYXA8c3RyaW5nLCBQb29sZWRKb2JFbnRyeT59IGluZmxpZ2h0IC0gSm9icyBjdXJyZW50bHkgb3duZWQgYnkgdGhpcyBjaGlsZC5cbiAqIEBwcm9wZXJ0eSB7bnVtYmVyfSBsYXN0RGlzcGF0Y2hTZXEgLSBSb3VuZC1yb2JpbiBkaXNwYXRjaCBzZXF1ZW5jZS5cbiAqIEBwcm9wZXJ0eSB7Ym9vbGVhbn0gcmV0aXJpbmcgLSBXaGV0aGVyIHRoaXMgY2hpbGQgaXMgZHJhaW5pbmcgYmVmb3JlIHJldGlyZW1lbnQuXG4gKiBAcHJvcGVydHkge2Jvb2xlYW59IFtzdGFydGVkXSAtIFdoZXRoZXIgdGhlIGNoaWxkIGNvbXBsZXRlZCBpdHMgc3RhcnR1cCBoYW5kc2hha2UuXG4gKiBAcHJvcGVydHkge2Jvb2xlYW59IFtzZXR0bGluZ10gLSBXaGV0aGVyIGZhaWx1cmUgaGFuZGxpbmcgYWxyZWFkeSBvd25zIHRoaXMgY2hpbGQuXG4gKiBAcHJvcGVydHkge2ltcG9ydChcIi4vdHlwZXMuanNcIikuUG9vbGVkQ2hpbGRNZW1vcnlPYnNlcnZhdGlvbn0gW2xhc3RNZW1vcnlPYnNlcnZhdGlvbl0gLSBMYXRlc3QgbWVtb3J5IG9ic2VydmF0aW9uIHJlY2VpdmVkIGZyb20gdGhpcyBjaGlsZC5cbiAqIEBwcm9wZXJ0eSB7bnVtYmVyfSBbaXBjRGlzY29ubmVjdGVkQXRNc10gLSBQYXJlbnQgb2JzZXJ2YXRpb24gb2YgSVBDIGRpc2Nvbm5lY3QuXG4gKiBAcHJvcGVydHkge2ltcG9ydChcIi4vdHlwZXMuanNcIikuUG9vbGVkQ2hpbGRTaHV0ZG93bk9ic2VydmF0aW9ufSBbc2h1dGRvd25PYnNlcnZhdGlvbl0gLSBDaGlsZCBvYnNlcnZhdGlvbiBzZW50IGJlZm9yZSB0ZWFyZG93bi5cbiAqIEBwcm9wZXJ0eSB7aW1wb3J0KFwiLi90eXBlcy5qc1wiKS5Qb29sZWRDaGlsZFNodXRkb3duUmVhc29ufSBbc2h1dGRvd25SZWFzb25dIC0gRXhhY3QgcGFyZW50LXJlcXVlc3RlZCBzaHV0ZG93biByZWFzb24uXG4gKiBAcHJvcGVydHkge251bWJlcn0gW3NodXRkb3duUmVxdWVzdGVkQXRNc10gLSBFeGFjdCBwYXJlbnQgc2h1dGRvd24tcmVxdWVzdCB0aW1lc3RhbXAuXG4gKiBAcHJvcGVydHkge2ltcG9ydChcIm5vZGU6Y2hpbGRfcHJvY2Vzc1wiKS5DaGlsZFByb2Nlc3NbXCJzaWduYWxDb2RlXCJdfSBbc2h1dGRvd25TaWduYWxdIC0gU2lnbmFsIHNlbGVjdGVkIGJ5IHRoZSBwYXJlbnQgcmVxdWVzdC5cbiAqIEBwcm9wZXJ0eSB7UmV0dXJuVHlwZTx0eXBlb2Ygc2V0VGltZW91dD59IFtzaHV0ZG93blNpZ25hbFRpbWVyXSAtIERyYWluZWQtcmV0aXJlbWVudCBmYWxsYmFjayBzaWduYWwgdGltZXIuXG4gKiBAcHJvcGVydHkge1JldHVyblR5cGU8dHlwZW9mIHNldFRpbWVvdXQ+IHwgbnVsbH0gW3RpbWVvdXRTaWdraWxsVGltZXJdIC0gUGVuZGluZyB0aW1lb3V0IFNJR0tJTEwgdGltZXIuXG4gKiBAcHJvcGVydHkge3N0cmluZ30gW3RpbWVvdXRKb2JJZF0gLSBKb2Igd2hvc2UgdGltZW91dCBpbml0aWF0ZWQgdGVybWluYXRpb24uXG4gKi9cbi8qKiBHcmFjZSBwZXJpb2QgYWZ0ZXIgU0lHVEVSTSBiZWZvcmUgYSBsaW5nZXJpbmcgcHJvY2VzcyBydW5uZXIgaXMgU0lHS0lMTGVkLiAqL1xuY29uc3QgRk9SS0VEX0NISUxEX1NJR0tJTExfR1JBQ0VfTVMgPSA1MDAwXG4vKiogVGltZSBhIGRyYWluZWQgcmV0aXJlbWVudCBnaXZlcyB0aGUgY2hpbGQgSVBDIHJlcXVlc3QgdG8gYmVnaW4gdGVhcmRvd24gYmVmb3JlIFNJR1RFUk0gZmFsbGJhY2suICovXG5jb25zdCBQT09MRURfUlVOTkVSX1NIVVRET1dOX1JFUVVFU1RfR1JBQ0VfTVMgPSAyNTBcbi8qKlxuICogTGFyZ2VzdCBkZWxheSBOb2RlJ3MgYHNldFRpbWVvdXRgIGFjY2VwdHMgd2l0aG91dCBvdmVyZmxvd2luZyB0byBhIDFtcyBkZWxheVxuICogKGEgMzItYml0IHNpZ25lZCBpbnQgb2YgbXMsIH4yNC44IGRheXMpLiBBIGBqb2JUaW1lb3V0TXNgIGFib3ZlIHRoaXMg4oCUIG9yIGFcbiAqIG5vbi1maW5pdGUgb25lIGxpa2UgYEluZmluaXR5YCDigJQgaXMgY2xhbXBlZC9kaXNhYmxlZCByYXRoZXIgdGhhbiBjb2VyY2VkIHRvXG4gKiB+MW1zLCB3aGljaCB3b3VsZCBvdGhlcndpc2UgdGVybWluYXRlIGV2ZXJ5IGZvcmtlZCBqb2IgYWxtb3N0IGltbWVkaWF0ZWx5LlxuICovXG5jb25zdCBNQVhfRk9SS0VEX0pPQl9USU1FT1VUX01TID0gMl8xNDdfNDgzXzY0N1xuY29uc3QgRk9SS0VEX1JVTk5FUl9FTlRSWV9QQVRIID0gZmlsZVVSTFRvUGF0aChuZXcgVVJMKFwiLi9mb3JrZWQtcnVubmVyLWNoaWxkLmpzXCIsIGltcG9ydC5tZXRhLnVybCkpXG5jb25zdCBQT09MRURfUlVOTkVSX0VOVFJZX1BBVEggPSBmaWxlVVJMVG9QYXRoKG5ldyBVUkwoXCIuL3Bvb2xlZC1ydW5uZXItY2hpbGQuanNcIiwgaW1wb3J0Lm1ldGEudXJsKSlcbi8qKiBIb3cgb2Z0ZW4gdGhlIHdvcmtlciBzZW5kcyBhIGxpdmVuZXNzIGhlYXJ0YmVhdCB0byB0aGUgbWFpbi4gKi9cbmNvbnN0IEhFQVJUQkVBVF9JTlRFUlZBTF9NUyA9IDE1MDAwXG4vKipcbiAqIE1heCB0aW1lIHRoZSB3b3JrZXIgc3BlbmRzIHJldHJ5aW5nIG9uZSBwb29sZWQgY2hpbGQncyBhY2NlcHRhbmNlIHJlcG9ydFxuICogYmVmb3JlIGRyb3BwaW5nIGl0LiBBY2NlcHRhbmNlIGV2aWRlbmNlIGlzIGRpYWdub3N0aWMg4oCUIGEgcGVyc2lzdGVudFxuICogbWFpbi9EQiBvdXRhZ2UgbXVzdCBub3QgaG9sZCBydW5uZXIgY2FwYWNpdHkgaG9zdGFnZS5cbiAqL1xuY29uc3QgQ0hJTERfQUNDRVBUQU5DRV9SRVBPUlRfTUFYX0RVUkFUSU9OX01TID0gMTAwMDBcbi8qKiBUQ1Aga2VlcGFsaXZlIHNvIGEgaGFsZi1vcGVuIGNvbm5lY3Rpb24gdG8gdGhlIG1haW4gc3VyZmFjZXMgYXMgYSBjbG9zZS4gKi9cbmNvbnN0IFNPQ0tFVF9LRUVQQUxJVkVfTVMgPSAxMDAwMFxuLyoqXG4gKiBFeGVjdXRpb24gbW9kZXMuXG4gKiBAdHlwZSB7aW1wb3J0KFwiLi90eXBlcy5qc1wiKS5CYWNrZ3JvdW5kSm9iRXhlY3V0aW9uTW9kZVtdfSAqL1xuY29uc3QgRVhFQ1VUSU9OX01PREVTID0gW1wiaW5saW5lXCIsIFwiZm9ya2VkXCIsIFwicG9vbGVkXCIsIFwic3Bhd25lZFwiXVxuXG4vKipcbiAqIE5vcm1hbGl6ZXMgYSBjYW5kaWRhdGUgcG9vbGVkLXJ1bm5lciBjb3VudCBvciBqb2IgbGltaXQuXG4gKiBAcGFyYW0ge251bWJlciB8IHVuZGVmaW5lZH0gdmFsdWUgLSBDYW5kaWRhdGUgcG9zaXRpdmUgaW50ZWdlci5cbiAqIEByZXR1cm5zIHtudW1iZXIgfCB1bmRlZmluZWR9IC0gTm9ybWFsaXplZCB2YWx1ZS5cbiAqL1xuZnVuY3Rpb24gcG9zaXRpdmVJbnRlZ2VyKHZhbHVlKSB7XG4gIHJldHVybiB0eXBlb2YgdmFsdWUgPT09IFwibnVtYmVyXCIgJiYgTnVtYmVyLmlzSW50ZWdlcih2YWx1ZSkgJiYgdmFsdWUgPiAwID8gdmFsdWUgOiB1bmRlZmluZWRcbn1cblxuLyoqXG4gKiBDaGVja3Mgd2hldGhlciBhbiBJUEMgdmFsdWUgaXMgYSBwb29sZWQgY2hpbGQncyBhY2NlcHRhbmNlIG9ic2VydmF0aW9uIGZvclxuICogb25lIGpvYi4gVGhlIGNoaWxkIGNhcnJpZXMgaXRzIGV4YWN0IGhhbmRvZmYgbGVhc2Ugc28gdGhlIHdvcmtlciBjYW4gZm9yd2FyZFxuICogdGhlIHJlcG9ydCB3aXRob3V0IGRlcGVuZGluZyBvbiBpdHMgaW4tZmxpZ2h0IGVudHJ5IHN0aWxsIGV4aXN0aW5nLlxuICogQHBhcmFtIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gbWVzc2FnZSAtIElQQyBtZXNzYWdlLlxuICogQHJldHVybnMge21lc3NhZ2UgaXMge3R5cGU6IFwiam9iLXJlY2VpdmVkXCIgfCBcImpvYi1zdGFydGVkXCIsIGpvYklkOiBzdHJpbmcsIGhhbmRvZmZJZD86IHN0cmluZywgd29ya2VySWQ/OiBzdHJpbmcsIGhhbmRlZE9mZkF0TXM/OiBudW1iZXIsIHJlY2VpdmVkQXRNcz86IG51bWJlciwgc3RhcnRlZEF0TXM/OiBudW1iZXIsIGNoaWxkSW5zdGFuY2VJZD86IHN0cmluZywgY2hpbGRQaWQ/OiBudW1iZXJ9fSAtIFdoZXRoZXIgdGhpcyBpcyBhIHZhbGlkIGFjY2VwdGFuY2UgbWVzc2FnZS5cbiAqL1xuZnVuY3Rpb24gaXNDaGlsZEFjY2VwdGFuY2VNZXNzYWdlKG1lc3NhZ2UpIHtcbiAgaWYgKCFtZXNzYWdlIHx8IHR5cGVvZiBtZXNzYWdlICE9PSBcIm9iamVjdFwiKSByZXR1cm4gZmFsc2VcbiAgY29uc3QgcmVjb3JkID0gLyoqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59ICovIChtZXNzYWdlKVxuXG4gIHJldHVybiAocmVjb3JkLnR5cGUgPT09IFwiam9iLXJlY2VpdmVkXCIgfHwgcmVjb3JkLnR5cGUgPT09IFwiam9iLXN0YXJ0ZWRcIilcbiAgICAmJiB0eXBlb2YgcmVjb3JkLmpvYklkID09PSBcInN0cmluZ1wiXG4gICAgJiYgKHJlY29yZC5oYW5kb2ZmSWQgPT09IHVuZGVmaW5lZCB8fCB0eXBlb2YgcmVjb3JkLmhhbmRvZmZJZCA9PT0gXCJzdHJpbmdcIilcbiAgICAmJiAocmVjb3JkLndvcmtlcklkID09PSB1bmRlZmluZWQgfHwgdHlwZW9mIHJlY29yZC53b3JrZXJJZCA9PT0gXCJzdHJpbmdcIilcbiAgICAmJiAocmVjb3JkLmhhbmRlZE9mZkF0TXMgPT09IHVuZGVmaW5lZCB8fCB0eXBlb2YgcmVjb3JkLmhhbmRlZE9mZkF0TXMgPT09IFwibnVtYmVyXCIpXG4gICAgJiYgKHJlY29yZC5yZWNlaXZlZEF0TXMgPT09IHVuZGVmaW5lZCB8fCB0eXBlb2YgcmVjb3JkLnJlY2VpdmVkQXRNcyA9PT0gXCJudW1iZXJcIilcbiAgICAmJiAocmVjb3JkLnN0YXJ0ZWRBdE1zID09PSB1bmRlZmluZWQgfHwgdHlwZW9mIHJlY29yZC5zdGFydGVkQXRNcyA9PT0gXCJudW1iZXJcIilcbiAgICAmJiAocmVjb3JkLmNoaWxkSW5zdGFuY2VJZCA9PT0gdW5kZWZpbmVkIHx8IHR5cGVvZiByZWNvcmQuY2hpbGRJbnN0YW5jZUlkID09PSBcInN0cmluZ1wiKVxuICAgICYmIChyZWNvcmQuY2hpbGRQaWQgPT09IHVuZGVmaW5lZCB8fCBOdW1iZXIuaXNJbnRlZ2VyKHJlY29yZC5jaGlsZFBpZCkpXG59XG5cbi8qKlxuICogQ2hlY2tzIHdoZXRoZXIgYW4gSVBDIHZhbHVlIGlzIHRoZSBjaGlsZCdzIGJvdW5kZWQgcHJlLXRlYXJkb3duIG9ic2VydmF0aW9uLlxuICogQHBhcmFtIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gbWVzc2FnZSAtIElQQyBtZXNzYWdlLlxuICogQHJldHVybnMge21lc3NhZ2UgaXMgaW1wb3J0KFwiLi90eXBlcy5qc1wiKS5Qb29sZWRDaGlsZFNodXRkb3duT2JzZXJ2YXRpb24gJiB7dHlwZTogXCJzaHV0ZG93bi1vYnNlcnZhdGlvblwifX0gLSBXaGV0aGVyIHRoaXMgaXMgYSB2YWxpZCBzaHV0ZG93biBvYnNlcnZhdGlvbi5cbiAqL1xuZnVuY3Rpb24gaXNDaGlsZFNodXRkb3duT2JzZXJ2YXRpb25NZXNzYWdlKG1lc3NhZ2UpIHtcbiAgaWYgKCFtZXNzYWdlIHx8IHR5cGVvZiBtZXNzYWdlICE9PSBcIm9iamVjdFwiKSByZXR1cm4gZmFsc2VcbiAgY29uc3QgcmVjb3JkID0gLyoqIEB0eXBlIHt7Y2hpbGRJbnN0YW5jZUlkPzogUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4sIGluZmxpZ2h0Sm9iSWRzPzogUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4sIGluZmxpZ2h0Sm9iSWRzVHJ1bmNhdGVkQ291bnQ/OiBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPiwgcmVhc29uPzogUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4sIHNodXRkb3duT2JzZXJ2ZWRBdE1zPzogUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4sIHNodXRkb3duUmVxdWVzdGVkQXRNcz86IFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+LCBzaWduYWw/OiBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPiwgdHlwZT86IFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fX0gKi8gKG1lc3NhZ2UpXG5cbiAgcmV0dXJuIHJlY29yZC50eXBlID09PSBcInNodXRkb3duLW9ic2VydmF0aW9uXCJcbiAgICAmJiB0eXBlb2YgcmVjb3JkLmNoaWxkSW5zdGFuY2VJZCA9PT0gXCJzdHJpbmdcIlxuICAgICYmIEFycmF5LmlzQXJyYXkocmVjb3JkLmluZmxpZ2h0Sm9iSWRzKVxuICAgICYmIHJlY29yZC5pbmZsaWdodEpvYklkcy5sZW5ndGggPD0gUE9PTEVEX1JVTk5FUl9JTkZMSUdIVF9KT0JfSURfTElNSVRcbiAgICAmJiByZWNvcmQuaW5mbGlnaHRKb2JJZHMuZXZlcnkoKGpvYklkKSA9PiB0eXBlb2Ygam9iSWQgPT09IFwic3RyaW5nXCIpXG4gICAgJiYgTnVtYmVyLmlzSW50ZWdlcihyZWNvcmQuaW5mbGlnaHRKb2JJZHNUcnVuY2F0ZWRDb3VudClcbiAgICAmJiByZWNvcmQuaW5mbGlnaHRKb2JJZHNUcnVuY2F0ZWRDb3VudCA+PSAwXG4gICAgJiYgaXNQb29sZWRDaGlsZFNodXRkb3duUmVhc29uKHJlY29yZC5yZWFzb24pXG4gICAgJiYgdHlwZW9mIHJlY29yZC5zaHV0ZG93bk9ic2VydmVkQXRNcyA9PT0gXCJudW1iZXJcIlxuICAgICYmIE51bWJlci5pc0Zpbml0ZShyZWNvcmQuc2h1dGRvd25PYnNlcnZlZEF0TXMpXG4gICAgJiYgKHJlY29yZC5zaHV0ZG93blJlcXVlc3RlZEF0TXMgPT09IG51bGwgfHwgKHR5cGVvZiByZWNvcmQuc2h1dGRvd25SZXF1ZXN0ZWRBdE1zID09PSBcIm51bWJlclwiICYmIE51bWJlci5pc0Zpbml0ZShyZWNvcmQuc2h1dGRvd25SZXF1ZXN0ZWRBdE1zKSkpXG4gICAgJiYgaXNQb29sZWRDaGlsZFNodXRkb3duU2lnbmFsKHJlY29yZC5zaWduYWwpXG59XG5cbi8qKlxuICogQ2hlY2tzIHdoZXRoZXIgYW4gSVBDIHZhbHVlIGlzIGEgcG9vbGVkIGNoaWxkJ3MgYm91bmRlZCBtZW1vcnkgb2JzZXJ2YXRpb24uXG4gKiBUaGUgcG9vbGVkIGNoaWxkJ3Mgc3RkaW8gaXMgaWdub3JlZCBieSB0aGUgd29ya2VyIGZvcmssIHNvIHRoaXMgb2JzZXJ2YXRpb25cbiAqIChwZXJpb2RpYyB3aGlsZSBqb2JzIHJ1biwgcGx1cyBvbiBkZW1hbmQpIGlzIGhvdyBhIG1lbW9yeSBwcm9ibGVtIGluIGFcbiAqIHJ1bm5pbmcgY2hpbGQgbmFtZXMgaXRzZWxmLiBUaGUgd29ya2VyIGxvZ3MgaXQgKGl0cyBzdGRlcnIgcmVhY2hlcyB0aGUgcHJvZFxuICogbG9nKSBhbmQgZm9yd2FyZHMgaXQgdG8gdGhlIG9wdGlvbmFsIGBvblBvb2xlZFJ1bm5lck1lbW9yeU9ic2VydmF0aW9uYCBob29rLlxuICogQHBhcmFtIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gbWVzc2FnZSAtIElQQyBtZXNzYWdlLlxuICogQHJldHVybnMge21lc3NhZ2UgaXMgaW1wb3J0KFwiLi90eXBlcy5qc1wiKS5Qb29sZWRDaGlsZE1lbW9yeU9ic2VydmF0aW9ufSAtIFdoZXRoZXIgdGhpcyBpcyBhIHZhbGlkIG1lbW9yeSBvYnNlcnZhdGlvbi5cbiAqL1xuZnVuY3Rpb24gaXNQb29sZWRDaGlsZE1lbW9yeU9ic2VydmF0aW9uTWVzc2FnZShtZXNzYWdlKSB7XG4gIGlmICghbWVzc2FnZSB8fCB0eXBlb2YgbWVzc2FnZSAhPT0gXCJvYmplY3RcIikgcmV0dXJuIGZhbHNlXG4gIGNvbnN0IHJlY29yZCA9IC8qKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSAqLyAobWVzc2FnZSlcbiAgY29uc3QgaGVhcFN0YXRpc3RpY3MgPSAvKiogQHR5cGUge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+PiB8IHVuZGVmaW5lZH0gKi8gKHJlY29yZC5oZWFwU3RhdGlzdGljcylcbiAgY29uc3QgbWVtb3J5VXNhZ2UgPSAvKiogQHR5cGUge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+PiB8IHVuZGVmaW5lZH0gKi8gKHJlY29yZC5tZW1vcnlVc2FnZSlcblxuICByZXR1cm4gcmVjb3JkLnR5cGUgPT09IFwicG9vbGVkLWNoaWxkLW1lbW9yeVwiXG4gICAgJiYgdHlwZW9mIHJlY29yZC5jaGlsZEluc3RhbmNlSWQgPT09IFwic3RyaW5nXCJcbiAgICAmJiBOdW1iZXIuaXNJbnRlZ2VyKHJlY29yZC5jaGlsZFBpZClcbiAgICAmJiB0eXBlb2YgcmVjb3JkLnJzc0J5dGVzID09PSBcIm51bWJlclwiXG4gICAgJiYgTnVtYmVyLmlzRmluaXRlKHJlY29yZC5yc3NCeXRlcylcbiAgICAmJiBOdW1iZXIuaXNJbnRlZ2VyKHJlY29yZC5qb2JDb3VudClcbiAgICAmJiByZWNvcmQuam9iQ291bnQgPj0gMFxuICAgICYmIEFycmF5LmlzQXJyYXkocmVjb3JkLmFjdGl2ZUpvYklkcylcbiAgICAmJiByZWNvcmQuYWN0aXZlSm9iSWRzLmV2ZXJ5KChqb2JJZCkgPT4gdHlwZW9mIGpvYklkID09PSBcInN0cmluZ1wiKVxuICAgICYmIE51bWJlci5pc0ludGVnZXIocmVjb3JkLmFjdGl2ZUpvYklkc1RydW5jYXRlZENvdW50KVxuICAgICYmIHJlY29yZC5hY3RpdmVKb2JJZHNUcnVuY2F0ZWRDb3VudCA+PSAwXG4gICAgJiYgdHlwZW9mIHJlY29yZC5vYnNlcnZlZEF0TXMgPT09IFwibnVtYmVyXCJcbiAgICAmJiBOdW1iZXIuaXNGaW5pdGUocmVjb3JkLm9ic2VydmVkQXRNcylcbiAgICAmJiBoZWFwU3RhdGlzdGljcyAhPT0gdW5kZWZpbmVkICYmIHR5cGVvZiBoZWFwU3RhdGlzdGljcyA9PT0gXCJvYmplY3RcIlxuICAgICYmIG1lbW9yeVVzYWdlICE9PSB1bmRlZmluZWQgJiYgdHlwZW9mIG1lbW9yeVVzYWdlID09PSBcIm9iamVjdFwiXG59XG5cbi8qKlxuICogTm9ybWFsaXplcyBhIGNhbmRpZGF0ZSBwb29sZWQtcnVubmVyIHJlc291cmNlIGxpbWl0LlxuICogQHBhcmFtIHtudW1iZXIgfCB1bmRlZmluZWR9IHZhbHVlIC0gQ2FuZGlkYXRlIHBvc2l0aXZlIG51bWJlci5cbiAqIEByZXR1cm5zIHtudW1iZXIgfCB1bmRlZmluZWR9IC0gTm9ybWFsaXplZCB2YWx1ZS5cbiAqL1xuZnVuY3Rpb24gcG9zaXRpdmVOdW1iZXIodmFsdWUpIHtcbiAgcmV0dXJuIHR5cGVvZiB2YWx1ZSA9PT0gXCJudW1iZXJcIiAmJiBOdW1iZXIuaXNGaW5pdGUodmFsdWUpICYmIHZhbHVlID4gMCA/IHZhbHVlIDogdW5kZWZpbmVkXG59XG5cbmV4cG9ydCBkZWZhdWx0IGNsYXNzIEJhY2tncm91bmRKb2JzV29ya2VyIHtcbiAgLyoqXG4gICAqIFJ1bnMgY29uc3RydWN0b3IuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBbYXJnc10gLSBPcHRpb25zLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL2NvbmZpZ3VyYXRpb24uanNcIikuZGVmYXVsdH0gW2FyZ3MuY29uZmlndXJhdGlvbl0gLSBDb25maWd1cmF0aW9uLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gW2FyZ3MuaG9zdF0gLSBIb3N0bmFtZS5cbiAgICogQHBhcmFtIHtudW1iZXJ9IFthcmdzLnBvcnRdIC0gUG9ydC5cbiAgICogQHBhcmFtIHtzdHJpbmd9IFthcmdzLmdlbmVyYXRpb25JZF0gLSBFeHBsaWNpdCByZWxlYXNlIGdlbmVyYXRpb24gaWRlbnRpdHkuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBbYXJncy53b3JrZXJJbnN0YW5jZUlkXSAtIEV4cGxpY2l0IHN0YWJsZSB3b3JrZXIgVVVJRC5cbiAgICogQHBhcmFtIHtudW1iZXJ9IFthcmdzLm1heENvbmN1cnJlbnRGb3JrZWRKb2JzXSAtIE92ZXJyaWRlIHRoZSBwcm9jZXNzIHJ1bm5lciBjb25jdXJyZW5jeSBjYXAgZnJvbSBgY29uZmlndXJhdGlvbi5nZXRCYWNrZ3JvdW5kSm9ic0NvbmZpZygpYC5cbiAgICogQHBhcmFtIHtudW1iZXJ9IFthcmdzLm1heENvbmN1cnJlbnRJbmxpbmVKb2JzXSAtIE92ZXJyaWRlIHRoZSBpbmxpbmUtam9iIGNvbmN1cnJlbmN5IGNhcCBmcm9tIGBjb25maWd1cmF0aW9uLmdldEJhY2tncm91bmRKb2JzQ29uZmlnKClgLlxuICAgKiBAcGFyYW0ge251bWJlcn0gW2FyZ3MucG9vbGVkUnVubmVyQ291bnRdIC0gT3ZlcnJpZGUgdGhlIHBvb2xlZCBydW5uZXIgY291bnQuXG4gICAqIEBwYXJhbSB7bnVtYmVyfSBbYXJncy5wb29sZWRSdW5uZXJDb25jdXJyZW5jeV0gLSBPdmVycmlkZSB0aGUgcGVyLXJ1bm5lciBjb25jdXJyZW5jeS5cbiAgICogQHBhcmFtIHtudW1iZXJ9IFthcmdzLnBvb2xlZFJ1bm5lck1heEpvYnNdIC0gT3ZlcnJpZGUgdGhlIHBlci1ydW5uZXIgcmVjeWNsZSBqb2IgY291bnQuXG4gICAqIEBwYXJhbSB7bnVtYmVyfSBbYXJncy5wb29sZWRSdW5uZXJNYXhSc3NCeXRlc10gLSBPdmVycmlkZSB0aGUgcGVyLXJ1bm5lciByZWN5Y2xlIFJTUyBsaW1pdC5cbiAgICogQHBhcmFtIHtudW1iZXJ9IFthcmdzLnBvb2xlZFJ1bm5lck1heExpZmV0aW1lTXNdIC0gT3ZlcnJpZGUgdGhlIHBlci1ydW5uZXIgcmVjeWNsZSBsaWZldGltZS5cbiAgICogQHBhcmFtIHtudW1iZXJ9IFthcmdzLmZvcmtlZENoaWxkU2lna2lsbEdyYWNlTXNdIC0gT3ZlcnJpZGUgdGhlIGdyYWNlIHBlcmlvZCBiZXR3ZWVuIFNJR1RFUk0gYW5kIFNJR0tJTEwgd2hlbiByZWFwaW5nIGxpbmdlcmluZyBwcm9jZXNzIHJ1bm5lcnMgb24gc3RvcC5cbiAgICogQHBhcmFtIHtudW1iZXJ9IFthcmdzLmhlYXJ0YmVhdEludGVydmFsTXNdIC0gT3ZlcnJpZGUgdGhlIGxpdmVuZXNzIGhlYXJ0YmVhdCBpbnRlcnZhbCAoZGVmYXVsdCAxNTAwMG1zKS5cbiAgICogQHBhcmFtIHtudW1iZXJ9IFthcmdzLmdlbmVyYXRpb25IYW5kc2hha2VUaW1lb3V0TXNdIC0gTWF4aW11bSB0aW1lIHRvIHdhaXQgZm9yIGdlbmVyYXRpb24gYWNrbm93bGVkZ2VtZW50IChkZWZhdWx0OiA0MDAwKS5cbiAgICogQHBhcmFtIHtudW1iZXJ9IFthcmdzLnJlY29ubmVjdERlbGF5TXNdIC0gRGVsYXkgYmVmb3JlIHJlY29ubmVjdGluZyBhbiBlc3RhYmxpc2hlZCB3b3JrZXIgY29ubmVjdGlvbiAoZGVmYXVsdDogMTAwMCkuXG4gICAqIEBwYXJhbSB7bnVtYmVyfSBbYXJncy5qb2JUaW1lb3V0TXNdIC0gT3ZlcnJpZGUgdGhlIHdhbGwtY2xvY2sgdGltZW91dCBmb3IgZm9ya2VkIGFuZCBwb29sZWQgam9icyBmcm9tIGBjb25maWd1cmF0aW9uLmdldEJhY2tncm91bmRKb2JzQ29uZmlnKClgLiBgMGAgZGlzYWJsZXMgaXQuXG4gICAqIEBwYXJhbSB7Ym9vbGVhbn0gW2FyZ3MuY2xvc2VEYXRhYmFzZUNvbm5lY3Rpb25zT25TdG9wXSAtIFdoZXRoZXIgc3RvcCBvd25zIGNsb3NpbmcgdGhlIGNvbmZpZ3VyYXRpb24ncyBkYXRhYmFzZSBwb29scyAoZGVmYXVsdCB0cnVlKS5cbiAgICogQHBhcmFtIHsoKSA9PiB2b2lkIHwgUHJvbWlzZTx2b2lkPn0gW2FyZ3Mub25TdG9wcGVkXSAtIExpZmVjeWNsZSBob29rIGludm9rZWQgYWZ0ZXIgdGhlIHdvcmtlciBmaW5pc2hlcyBzdG9wcGluZy5cbiAgICogQHBhcmFtIHsoKSA9PiB2b2lkfSBbYXJncy5vbkdlbmVyYXRpb25BY2NlcHRlZF0gLSBFeHBsaWNpdCBnZW5lcmF0aW9uLWFjY2VwdGFuY2Ugb2JzZXJ2YXRpb24gaG9vay5cbiAgICogQHBhcmFtIHsoKSA9PiB2b2lkfSBbYXJncy5vblJldGlyZU1lc3NhZ2VdIC0gRXhwbGljaXQgcmV0aXJlLW1lc3NhZ2Ugb2JzZXJ2YXRpb24gaG9vay5cbiAgICogQHBhcmFtIHsob2JzZXJ2YXRpb246IGltcG9ydChcIi4vdHlwZXMuanNcIikuUG9vbGVkQ2hpbGRNZW1vcnlPYnNlcnZhdGlvbikgPT4gdm9pZCB8IFByb21pc2U8dm9pZD59IFthcmdzLm9uUG9vbGVkUnVubmVyTWVtb3J5T2JzZXJ2YXRpb25dIC0gRXhwbGljaXQgcG9vbGVkLWNoaWxkIG1lbW9yeSBvYnNlcnZhdGlvbiBob29rLiBFdmVyeSB2YWxpZGF0ZWQgb2JzZXJ2YXRpb24gKHBlcmlvZGljIHdoaWxlIGEgY2hpbGQgaGFzIGluLWZsaWdodCBqb2JzLCBwbHVzIG9uIGRlbWFuZCkgaXMgZm9yd2FyZGVkIGhlcmUsIGluIGFkZGl0aW9uIHRvIHRoZSB3b3JrZXIncyBjb21wYWN0IHN0ZGVyciBsb2cgbGluZSwgc28gYW4gYXBwbGljYXRpb24gY2FuIHJvdXRlIG1lbW9yeSBkaWFnbm9zdGljcyAoZS5nLiB0byBhIGJ1ZyByZXBvcnRlcikgd2l0aG91dCBwYXJzaW5nIGxvZ3MuXG4gICAqL1xuICBjb25zdHJ1Y3Rvcih7Y29uZmlndXJhdGlvbiwgaG9zdCwgcG9ydCwgZ2VuZXJhdGlvbklkLCB3b3JrZXJJbnN0YW5jZUlkLCBtYXhDb25jdXJyZW50Rm9ya2VkSm9icywgbWF4Q29uY3VycmVudElubGluZUpvYnMsIHBvb2xlZFJ1bm5lckNvdW50LCBwb29sZWRSdW5uZXJDb25jdXJyZW5jeSwgcG9vbGVkUnVubmVyTWF4Sm9icywgcG9vbGVkUnVubmVyTWF4UnNzQnl0ZXMsIHBvb2xlZFJ1bm5lck1heExpZmV0aW1lTXMsIGZvcmtlZENoaWxkU2lna2lsbEdyYWNlTXMsIGhlYXJ0YmVhdEludGVydmFsTXMsIGdlbmVyYXRpb25IYW5kc2hha2VUaW1lb3V0TXMgPSBERUZBVUxUX0dFTkVSQVRJT05fSEFORFNIQUtFX1RJTUVPVVRfTVMsIHJlY29ubmVjdERlbGF5TXMgPSAxMDAwLCBqb2JUaW1lb3V0TXMsIGNsb3NlRGF0YWJhc2VDb25uZWN0aW9uc09uU3RvcCA9IHRydWUsIG9uU3RvcHBlZCwgb25HZW5lcmF0aW9uQWNjZXB0ZWQsIG9uUmV0aXJlTWVzc2FnZSwgb25Qb29sZWRSdW5uZXJNZW1vcnlPYnNlcnZhdGlvbn0gPSB7fSkge1xuICAgIC8qKlxuICAgICAqIE5hcnJvd3MgdGhlIHJ1bnRpbWUgdmFsdWUgdG8gdGhlIGRvY3VtZW50ZWQgdHlwZS5cbiAgICAgKiBAdHlwZSB7UHJvbWlzZTxpbXBvcnQoXCIuLi9jb25maWd1cmF0aW9uLmpzXCIpLmRlZmF1bHQ+fSAqL1xuICAgIHRoaXMuY29uZmlndXJhdGlvblByb21pc2UgPSBjb25maWd1cmF0aW9uID8gUHJvbWlzZS5yZXNvbHZlKGNvbmZpZ3VyYXRpb24pIDogY29uZmlndXJhdGlvblJlc29sdmVyKClcbiAgICAvKipcbiAgICAgKiBOYXJyb3dzIHRoZSBydW50aW1lIHZhbHVlIHRvIHRoZSBkb2N1bWVudGVkIHR5cGUuXG4gICAgICogQHR5cGUge2ltcG9ydChcIi4uL2NvbmZpZ3VyYXRpb24uanNcIikuZGVmYXVsdCB8IHVuZGVmaW5lZH0gKi9cbiAgICB0aGlzLmNvbmZpZ3VyYXRpb24gPSB1bmRlZmluZWRcbiAgICB0aGlzLmhvc3QgPSBob3N0XG4gICAgdGhpcy5wb3J0ID0gcG9ydFxuICAgIHRoaXMuZXhwbGljaXRHZW5lcmF0aW9uSWQgPSBnZW5lcmF0aW9uSWRcbiAgICB0aGlzLndvcmtlckluc3RhbmNlSWQgPSB3b3JrZXJJbnN0YW5jZUlkIHx8IHJhbmRvbVVVSUQoKVxuICAgIC8qKiBAdHlwZSB7c3RyaW5nIHwgdW5kZWZpbmVkfSAqL1xuICAgIHRoaXMuZ2VuZXJhdGlvbklkID0gdW5kZWZpbmVkXG4gICAgdGhpcy5jbG9zZURhdGFiYXNlQ29ubmVjdGlvbnNPblN0b3AgPSBjbG9zZURhdGFiYXNlQ29ubmVjdGlvbnNPblN0b3BcbiAgICB0aGlzLm9uU3RvcHBlZCA9IG9uU3RvcHBlZFxuICAgIHRoaXMub25HZW5lcmF0aW9uQWNjZXB0ZWQgPSBvbkdlbmVyYXRpb25BY2NlcHRlZFxuICAgIHRoaXMub25SZXRpcmVNZXNzYWdlID0gb25SZXRpcmVNZXNzYWdlXG4gICAgdGhpcy5vblBvb2xlZFJ1bm5lck1lbW9yeU9ic2VydmF0aW9uID0gb25Qb29sZWRSdW5uZXJNZW1vcnlPYnNlcnZhdGlvblxuICAgIC8qKlxuICAgICAqIENvbnN0cnVjdG9yIG92ZXJyaWRlIGZvciB0aGUgaW5saW5lLWpvYiBjb25jdXJyZW5jeSBjYXAuIFdoZW4gdW5zZXRcbiAgICAgKiB0aGUgY2FwIGlzIHJlYWQgZnJvbSBgY29uZmlndXJhdGlvbi5nZXRCYWNrZ3JvdW5kSm9ic0NvbmZpZygpYCBpblxuICAgICAqIGBzdGFydCgpYCAoZGVmYXVsdDogNCkuXG4gICAgICogQHR5cGUge251bWJlciB8IHVuZGVmaW5lZH1cbiAgICAgKi9cbiAgICB0aGlzLm1heENvbmN1cnJlbnRJbmxpbmVKb2JzT3ZlcnJpZGUgPSB0eXBlb2YgbWF4Q29uY3VycmVudElubGluZUpvYnMgPT09IFwibnVtYmVyXCIgJiYgbWF4Q29uY3VycmVudElubGluZUpvYnMgPj0gMVxuICAgICAgPyBtYXhDb25jdXJyZW50SW5saW5lSm9ic1xuICAgICAgOiB1bmRlZmluZWRcbiAgICAvKipcbiAgICAgKiBOYXJyb3dzIHRoZSBydW50aW1lIHZhbHVlIHRvIHRoZSBkb2N1bWVudGVkIHR5cGUuXG4gICAgICogQHR5cGUge251bWJlciB8IHVuZGVmaW5lZH0gKi9cbiAgICB0aGlzLm1heENvbmN1cnJlbnRGb3JrZWRKb2JzT3ZlcnJpZGUgPSB0eXBlb2YgbWF4Q29uY3VycmVudEZvcmtlZEpvYnMgPT09IFwibnVtYmVyXCIgJiYgbWF4Q29uY3VycmVudEZvcmtlZEpvYnMgPj0gMVxuICAgICAgPyBtYXhDb25jdXJyZW50Rm9ya2VkSm9ic1xuICAgICAgOiB1bmRlZmluZWRcbiAgICAvKipcbiAgICAgKiBSZXNvbHZlZCBjYXAgZm9yIGlubGluZS1qb2IgY29uY3VycmVuY3kuIFNldCBpbiBgc3RhcnQoKWA7IGRlZmF1bHRzIHRvXG4gICAgICogNCBpZiBubyBjb25maWd1cmF0aW9uIHZhbHVlIGlzIGF2YWlsYWJsZS5cbiAgICAgKiBAdHlwZSB7bnVtYmVyfVxuICAgICAqL1xuICAgIHRoaXMubWF4Q29uY3VycmVudElubGluZUpvYnMgPSB0aGlzLm1heENvbmN1cnJlbnRJbmxpbmVKb2JzT3ZlcnJpZGUgfHwgNFxuICAgIC8qKlxuICAgICAqIE5hcnJvd3MgdGhlIHJ1bnRpbWUgdmFsdWUgdG8gdGhlIGRvY3VtZW50ZWQgdHlwZS5cbiAgICAgKiBAdHlwZSB7bnVtYmVyfSAqL1xuICAgIHRoaXMubWF4Q29uY3VycmVudEZvcmtlZEpvYnMgPSB0aGlzLm1heENvbmN1cnJlbnRGb3JrZWRKb2JzT3ZlcnJpZGUgfHwgNFxuICAgIHRoaXMucG9vbGVkUnVubmVyQ291bnRPdmVycmlkZSA9IHBvc2l0aXZlSW50ZWdlcihwb29sZWRSdW5uZXJDb3VudClcbiAgICB0aGlzLnBvb2xlZFJ1bm5lckNvbmN1cnJlbmN5T3ZlcnJpZGUgPSBwb3NpdGl2ZUludGVnZXIocG9vbGVkUnVubmVyQ29uY3VycmVuY3kpXG4gICAgdGhpcy5wb29sZWRSdW5uZXJNYXhKb2JzT3ZlcnJpZGUgPSBwb3NpdGl2ZUludGVnZXIocG9vbGVkUnVubmVyTWF4Sm9icylcbiAgICB0aGlzLnBvb2xlZFJ1bm5lck1heFJzc0J5dGVzT3ZlcnJpZGUgPSBwb3NpdGl2ZU51bWJlcihwb29sZWRSdW5uZXJNYXhSc3NCeXRlcylcbiAgICB0aGlzLnBvb2xlZFJ1bm5lck1heExpZmV0aW1lTXNPdmVycmlkZSA9IHBvc2l0aXZlTnVtYmVyKHBvb2xlZFJ1bm5lck1heExpZmV0aW1lTXMpXG4gICAgdGhpcy5wb29sZWRSdW5uZXJDb3VudCA9IHRoaXMucG9vbGVkUnVubmVyQ291bnRPdmVycmlkZSB8fCA0XG4gICAgdGhpcy5wb29sZWRSdW5uZXJDb25jdXJyZW5jeSA9IHRoaXMucG9vbGVkUnVubmVyQ29uY3VycmVuY3lPdmVycmlkZSB8fCAxXG4gICAgdGhpcy5wb29sZWRSdW5uZXJNYXhKb2JzID0gdGhpcy5wb29sZWRSdW5uZXJNYXhKb2JzT3ZlcnJpZGUgfHwgMTAwXG4gICAgdGhpcy5wb29sZWRSdW5uZXJNYXhSc3NCeXRlcyA9IHRoaXMucG9vbGVkUnVubmVyTWF4UnNzQnl0ZXNPdmVycmlkZSB8fCA1MTIgKiAxMDI0ICogMTAyNFxuICAgIHRoaXMucG9vbGVkUnVubmVyTWF4TGlmZXRpbWVNcyA9IHRoaXMucG9vbGVkUnVubmVyTWF4TGlmZXRpbWVNc092ZXJyaWRlIHx8IDYwICogNjAgKiAxMDAwXG4gICAgLyoqXG4gICAgICogR3JhY2UgcGVyaW9kIGJldHdlZW4gU0lHVEVSTSBhbmQgU0lHS0lMTCB3aGVuIHJlYXBpbmcgcHJvY2VzcyBydW5uZXJzIHRoYXRcbiAgICAgKiBvdXRsYXN0IGEgYm91bmRlZCBzaHV0ZG93biBkcmFpbi5cbiAgICAgKiBAdHlwZSB7bnVtYmVyfVxuICAgICAqL1xuICAgIHRoaXMuZm9ya2VkQ2hpbGRTaWdraWxsR3JhY2VNcyA9IHR5cGVvZiBmb3JrZWRDaGlsZFNpZ2tpbGxHcmFjZU1zID09PSBcIm51bWJlclwiICYmIGZvcmtlZENoaWxkU2lna2lsbEdyYWNlTXMgPj0gMFxuICAgICAgPyBmb3JrZWRDaGlsZFNpZ2tpbGxHcmFjZU1zXG4gICAgICA6IEZPUktFRF9DSElMRF9TSUdLSUxMX0dSQUNFX01TXG4gICAgLyoqXG4gICAgICogQ29uc3RydWN0b3Igb3ZlcnJpZGUgZm9yIHRoZSBmb3JrZWQgYW5kIHBvb2xlZCB3YWxsLWNsb2NrIGpvYiB0aW1lb3V0LiBXaGVuIHVuc2V0IHRoZVxuICAgICAqIHRpbWVvdXQgaXMgcmVhZCBmcm9tIGBjb25maWd1cmF0aW9uLmdldEJhY2tncm91bmRKb2JzQ29uZmlnKCkuam9iVGltZW91dE1zYFxuICAgICAqIGF0IGZvcmsgdGltZSAoZGVmYXVsdDogZGlzYWJsZWQpLlxuICAgICAqIEB0eXBlIHtudW1iZXIgfCB1bmRlZmluZWR9XG4gICAgICovXG4gICAgdGhpcy5qb2JUaW1lb3V0TXNPdmVycmlkZSA9IHR5cGVvZiBqb2JUaW1lb3V0TXMgPT09IFwibnVtYmVyXCIgPyBqb2JUaW1lb3V0TXMgOiB1bmRlZmluZWRcbiAgICB0aGlzLnNob3VsZFN0b3AgPSBmYWxzZVxuICAgIHRoaXMuaXNSZXRpcmluZyA9IGZhbHNlXG4gICAgLyoqIEB0eXBlIHtQcm9taXNlPHZvaWQ+IHwgdW5kZWZpbmVkfSAqL1xuICAgIHRoaXMuc3RvcFByb21pc2UgPSB1bmRlZmluZWRcbiAgICAvKipcbiAgICAgKiBSZXNvbHZlcyBzdG9wIG9ic2VydmF0aW9uLlxuICAgICAqIEB0eXBlIHsodmFsdWU/OiB2b2lkKSA9PiB2b2lkfVxuICAgICAqL1xuICAgIHRoaXMuX3Jlc29sdmVTdG9wcGVkID0gKCkgPT4ge31cbiAgICAvKipcbiAgICAgKiBSZWplY3RzIHN0b3Agb2JzZXJ2YXRpb24uXG4gICAgICogQHR5cGUgeyhlcnJvcjogRXJyb3IpID0+IHZvaWR9XG4gICAgICovXG4gICAgdGhpcy5fcmVqZWN0U3RvcHBlZCA9ICgpID0+IHt9XG4gICAgLyoqIEB0eXBlIHtQcm9taXNlPHZvaWQ+fSAqL1xuICAgIHRoaXMuX3N0b3BwZWRQcm9taXNlID0gUHJvbWlzZS5yZXNvbHZlKClcbiAgICB0aGlzLl9yZXNldFN0b3BwZWRQcm9taXNlKClcbiAgICB0aGlzLndvcmtlcklkID0gdGhpcy53b3JrZXJJbnN0YW5jZUlkXG4gICAgdGhpcy5fZ2VuZXJhdGlvbkFjY2VwdGVkID0gZmFsc2VcbiAgICB0aGlzLmdlbmVyYXRpb25IYW5kc2hha2VUaW1lb3V0TXMgPSB2YWxpZGF0ZUdlbmVyYXRpb25IYW5kc2hha2VUaW1lb3V0TXMoZ2VuZXJhdGlvbkhhbmRzaGFrZVRpbWVvdXRNcylcbiAgICBpZiAoIU51bWJlci5pc0ludGVnZXIocmVjb25uZWN0RGVsYXlNcykgfHwgcmVjb25uZWN0RGVsYXlNcyA8IDAgfHwgcmVjb25uZWN0RGVsYXlNcyA+IE1BWF9GT1JLRURfSk9CX1RJTUVPVVRfTVMpIHtcbiAgICAgIHRocm93IG5ldyBUeXBlRXJyb3IoXCJyZWNvbm5lY3REZWxheU1zIG11c3QgYmUgYW4gaW50ZWdlciBiZXR3ZWVuIDAgYW5kIDIxNDc0ODM2NDdcIilcbiAgICB9XG4gICAgdGhpcy5yZWNvbm5lY3REZWxheU1zID0gcmVjb25uZWN0RGVsYXlNc1xuICAgIC8qKiBAdHlwZSB7UmV0dXJuVHlwZTx0eXBlb2Ygc2V0VGltZW91dD4gfCB1bmRlZmluZWR9ICovXG4gICAgdGhpcy5fcmVjb25uZWN0VGltZXIgPSB1bmRlZmluZWRcbiAgICB0aGlzLmhlYXJ0YmVhdEludGVydmFsTXMgPSB0eXBlb2YgaGVhcnRiZWF0SW50ZXJ2YWxNcyA9PT0gXCJudW1iZXJcIiAmJiBoZWFydGJlYXRJbnRlcnZhbE1zID49IDFcbiAgICAgID8gaGVhcnRiZWF0SW50ZXJ2YWxNc1xuICAgICAgOiBIRUFSVEJFQVRfSU5URVJWQUxfTVNcbiAgICAvKipcbiAgICAgKiBOYXJyb3dzIHRoZSBydW50aW1lIHZhbHVlIHRvIHRoZSBkb2N1bWVudGVkIHR5cGUuXG4gICAgICogQHR5cGUge1JldHVyblR5cGU8dHlwZW9mIHNldEludGVydmFsPiB8IHVuZGVmaW5lZH0gKi9cbiAgICB0aGlzLl9oZWFydGJlYXRUaW1lciA9IHVuZGVmaW5lZFxuICAgIC8qKlxuICAgICAqIEluLWZsaWdodCBqb2ItcmVzdWx0IHJlcG9ydHMgdG8gdGhlIG1haW4uIFJlcG9ydGluZyBpcyBkZWNvdXBsZWQgZnJvbSB0aGVcbiAgICAgKiBqb2IvY2hpbGQgc2xvdCAoZnJlZWluZyB0aGUgc2xvdCBuZXZlciB3YWl0cyBvbiBhIHJlcG9ydCkgYW5kIHJldHJpZWRcbiAgICAgKiBkdXJhYmx5LCBzbyBhIHRyYW5zaWVudCBtYWluL0RCIG91dGFnZSBjYW5ub3QgbGVhayBzbG90cyBvciBsb3NlIGFcbiAgICAgKiB0ZXJtaW5hbCByZXBvcnQuIFRyYWNrZWQgc28gYSBncmFjZWZ1bCBgc3RvcCgpYCBjYW4gZHJhaW4gdGhlbS5cbiAgICAgKiBAdHlwZSB7U2V0PFByb21pc2U8dm9pZD4+fVxuICAgICAqL1xuICAgIHRoaXMuaW5mbGlnaHRSZXBvcnRzID0gbmV3IFNldCgpXG4gICAgLyoqXG4gICAgICogTmFycm93cyB0aGUgcnVudGltZSB2YWx1ZSB0byB0aGUgZG9jdW1lbnRlZCB0eXBlLlxuICAgICAqIEB0eXBlIHtKc29uU29ja2V0IHwgdW5kZWZpbmVkfSAqL1xuICAgIHRoaXMuanNvblNvY2tldCA9IHVuZGVmaW5lZFxuICAgIC8qKlxuICAgICAqIE5hcnJvd3MgdGhlIHJ1bnRpbWUgdmFsdWUgdG8gdGhlIGRvY3VtZW50ZWQgdHlwZS5cbiAgICAgKiBAdHlwZSB7QmFja2dyb3VuZEpvYnNTdGF0dXNSZXBvcnRlciB8IHVuZGVmaW5lZH0gKi9cbiAgICB0aGlzLnN0YXR1c1JlcG9ydGVyID0gdW5kZWZpbmVkXG4gICAgLyoqXG4gICAgICogVXAgdG8gYHRoaXMubWF4Q29uY3VycmVudElubGluZUpvYnNgIG9mIHRoZXNlIHJ1biBpbiBwYXJhbGxlbC4gVGhleVxuICAgICAqIHNoYXJlIHRoZSB3b3JrZXIncyBwcm9jZXNzIGFuZCBEQiBjb25uZWN0aW9uIHBvb2wsIHNvIGNvbmN1cnJlbmN5IGlzXG4gICAgICogYWJvdXQgb3ZlcmxhcHBpbmcgSS9PIHdhaXRzIOKAlCB1c2UgZm9ya2luZyBmb3IgbWVtb3J5IGlzb2xhdGlvbiBhY3Jvc3NcbiAgICAgKiBsb25nLXJ1bm5pbmcgam9icyBhbmQgZm9yIHVzaW5nIG1vcmUgY29yZXMuXG4gICAgICogQHR5cGUge1NldDxQcm9taXNlPHZvaWQ+Pn1cbiAgICAgKi9cbiAgICB0aGlzLmluZmxpZ2h0SW5saW5lSm9icyA9IG5ldyBTZXQoKVxuICAgIC8qKlxuICAgICAqIEluLWZsaWdodCBwcm9jZXNzIHJ1bm5lciBleGl0IHByb21pc2VzLiBUcmFja2VkIHNvIHByb2Nlc3Mtam9iIGhhbmRvZmZcbiAgICAgKiBzdGF5cyBib3VuZGVkIHdoaWxlIHJ1bm5pbmcgYW5kIHNvIGEgZ3JhY2VmdWwgYHN0b3AoKWAgY2FuIGRyYWluIHRoZW0uXG4gICAgICogQHR5cGUge1NldDxQcm9taXNlPHZvaWQ+Pn1cbiAgICAgKi9cbiAgICB0aGlzLmluZmxpZ2h0UHJvY2Vzc0pvYnMgPSBuZXcgU2V0KClcbiAgICAvKipcbiAgICAgKiBMaXZlIHByb2Nlc3MgcnVubmVyIGNoaWxkIHByb2Nlc3Nlcywga2VwdCBzbyBhIGdyYWNlZnVsIGBzdG9wKClgIGNhblxuICAgICAqIHRlcm1pbmF0ZSBhbnkgdGhhdCBvdXRsYXN0IHRoZSBzaHV0ZG93biBkcmFpbiBpbnN0ZWFkIG9mIG9ycGhhbmluZyB0aGVtXG4gICAgICogYWNyb3NzIGEgZGVwbG95ICh3aGVyZSB0aGV5IHdvdWxkIGtlZXAgcnVubmluZyBhZ2FpbnN0IGRlbGV0ZWQgcmVsZWFzZVxuICAgICAqIGNvZGUgYW5kIGhvbGRpbmcgZGF0YWJhc2UgY29ubmVjdGlvbnMpLlxuICAgICAqIEB0eXBlIHtTZXQ8aW1wb3J0KFwibm9kZTpjaGlsZF9wcm9jZXNzXCIpLkNoaWxkUHJvY2Vzcz59XG4gICAgICovXG4gICAgdGhpcy5pbmZsaWdodFByb2Nlc3NDaGlsZHJlbiA9IG5ldyBTZXQoKVxuICAgIC8qKiBAdHlwZSB7U2V0PFByb21pc2U8dm9pZD4+fSAqL1xuICAgIHRoaXMuaW5mbGlnaHRQb29sZWRKb2JzID0gbmV3IFNldCgpXG4gICAgLyoqIEB0eXBlIHtNYXA8c3RyaW5nLCBBcnJheTxpbXBvcnQoXCIuL3R5cGVzLmpzXCIpLkJhY2tncm91bmRKb2JQYXlsb2FkICYge2lkOiBzdHJpbmd9Pj59ICovXG4gICAgdGhpcy5wb29sZWRKb2JRdWV1ZXMgPSBuZXcgTWFwKClcbiAgICAvKiogQHR5cGUge01hcDxzdHJpbmcsIFByb21pc2U8dm9pZD4+fSAtIFBlci1pZCBvdXRlciBxdWV1ZSB0cmFja2Vycy4gKi9cbiAgICB0aGlzLnBvb2xlZEpvYlF1ZXVlVHJhY2tlcnMgPSBuZXcgTWFwKClcbiAgICAvKiogQHR5cGUge1NldDxpbXBvcnQoXCJub2RlOmNoaWxkX3Byb2Nlc3NcIikuQ2hpbGRQcm9jZXNzPn0gKi9cbiAgICB0aGlzLnBvb2xlZENoaWxkcmVuID0gbmV3IFNldCgpXG4gICAgLyoqIEB0eXBlIHtNYXA8aW1wb3J0KFwibm9kZTpjaGlsZF9wcm9jZXNzXCIpLkNoaWxkUHJvY2VzcywgUG9vbGVkQ2hpbGRTdGF0ZT59ICovXG4gICAgdGhpcy5wb29sZWRDaGlsZFN0YXRlcyA9IG5ldyBNYXAoKVxuICAgIC8qKiBAdHlwZSB7V2Vha1NldDxQcm9taXNlPHZvaWQ+Pn0gKi9cbiAgICB0aGlzLl9wb29sZWRTdGFydHVwRmFpbHVyZUpvYnMgPSBuZXcgV2Vha1NldCgpXG4gICAgLy8gTW9ub3RvbmljIGRpc3BhdGNoIGNvdW50ZXIgZm9yIHJvdW5kLXJvYmluIGNoaWxkIHNlbGVjdGlvbjogZWFjaCBkaXNwYXRjaCBzdGFtcHNcbiAgICAvLyB0aGUgY2hvc2VuIGNoaWxkLCBhbmQgc2VsZWN0aW9uIHByZWZlcnMgdGhlIGNoaWxkIGRpc3BhdGNoZWQgbGVhc3QgcmVjZW50bHkuXG4gICAgdGhpcy5fcG9vbGVkRGlzcGF0Y2hTZXEgPSAwXG4gICAgLy8gV2FpdGVycyBibG9ja2VkIGluIF9ydW5Qb29sZWRKb2IgYmVjYXVzZSB0aGUgcG9vbCBpcyBhdCBpdHMgaGFyZCBjYXA6IGEgam9iIG1heVxuICAgIC8vIG5vdCBzcGF3biBhIGNoaWxkIHdoaWxlIHRvdGFsIGxpdmUgY2hpbGRyZW4gKHdvcmtpbmcgKyBkcmFpbmluZykgaXMgYXQgdGhlIGNhcC5cbiAgICAvKiogQHR5cGUge1NldDwoKSA9PiB2b2lkPn0gKi9cbiAgICB0aGlzLl9wb29sZWRTbG90V2FpdGVycyA9IG5ldyBTZXQoKVxuICAgIC8qKiBAdHlwZSB7UmV0dXJuVHlwZTx0eXBlb2Ygc2V0SW50ZXJ2YWw+IHwgdW5kZWZpbmVkfSAtIFNhZmV0eSBwb2xsIHRoYXQgcmUtY2hlY2tzIHRoZSBzbG90IGNvbmRpdGlvbi4gKi9cbiAgICB0aGlzLl9wb29sZWRTbG90V2FpdFRpbWVyID0gdW5kZWZpbmVkXG4gIH1cblxuICAvKiogU3RhcnRzIHRoZSBzbG90LXdhaXRlciBzYWZldHkgcG9sbCBpZiBpdCBpcyBub3QgYWxyZWFkeSBydW5uaW5nLiAqL1xuICBfc3RhcnRQb29sZWRTbG90V2FpdFBvbGwoKSB7XG4gICAgaWYgKHRoaXMuX3Bvb2xlZFNsb3RXYWl0VGltZXIpIHJldHVyblxuXG4gICAgdGhpcy5fcG9vbGVkU2xvdFdhaXRUaW1lciA9IHNldEludGVydmFsKCgpID0+IHRoaXMuX3dha2VQb29sZWRTbG90V2FpdGVycygpLCA1MClcbiAgICB0aGlzLl9wb29sZWRTbG90V2FpdFRpbWVyLnVucmVmKClcbiAgfVxuXG4gIC8qKiBTdG9wcyB0aGUgc2xvdC13YWl0ZXIgc2FmZXR5IHBvbGwgb25jZSBubyB3YWl0ZXIgaXMgcmVnaXN0ZXJlZC4gKi9cbiAgX3N0b3BQb29sZWRTbG90V2FpdFBvbGxJZklkbGUoKSB7XG4gICAgaWYgKHRoaXMuX3Bvb2xlZFNsb3RXYWl0ZXJzLnNpemUgPiAwIHx8ICF0aGlzLl9wb29sZWRTbG90V2FpdFRpbWVyKSByZXR1cm5cblxuICAgIGNsZWFySW50ZXJ2YWwodGhpcy5fcG9vbGVkU2xvdFdhaXRUaW1lcilcbiAgICB0aGlzLl9wb29sZWRTbG90V2FpdFRpbWVyID0gdW5kZWZpbmVkXG4gIH1cblxuICAvKipcbiAgICogUnVucyBzdGFydC5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgd2hlbiBjb25uZWN0ZWQuXG4gICAqL1xuICBhc3luYyBzdGFydCgpIHtcbiAgICB0aGlzLnNob3VsZFN0b3AgPSBmYWxzZVxuICAgIHRoaXMuaXNSZXRpcmluZyA9IGZhbHNlXG4gICAgdGhpcy5zdG9wUHJvbWlzZSA9IHVuZGVmaW5lZFxuICAgIHRoaXMuX3Jlc2V0U3RvcHBlZFByb21pc2UoKVxuICAgIHRoaXMuY29uZmlndXJhdGlvbiA9IGF3YWl0IHRoaXMuY29uZmlndXJhdGlvblByb21pc2VcbiAgICB0aGlzLmNvbmZpZ3VyYXRpb24uc2V0Q3VycmVudCgpXG4gICAgY29uc3QgcmVzb2x2ZWRDb25maWcgPSB0aGlzLmNvbmZpZ3VyYXRpb24uZ2V0QmFja2dyb3VuZEpvYnNDb25maWcoKVxuICAgIHRoaXMuZ2VuZXJhdGlvbklkID0gdGhpcy5jb25maWd1cmF0aW9uLnJlc29sdmVCYWNrZ3JvdW5kSm9ic0dlbmVyYXRpb25Db25maWcoe1xuICAgICAgZ2VuZXJhdGlvbklkOiB0aGlzLmV4cGxpY2l0R2VuZXJhdGlvbklkLFxuICAgICAgc291cmNlTmFtZTogXCJCYWNrZ3JvdW5kSm9ic1dvcmtlclwiXG4gICAgfSkuZ2VuZXJhdGlvbklkXG4gICAgdGhpcy53b3JrZXJJZCA9IHRoaXMuZ2VuZXJhdGlvbklkXG4gICAgICA/IGNyZWF0ZUdlbmVyYXRpb25Xb3JrZXJJZCh7Z2VuZXJhdGlvbklkOiB0aGlzLmdlbmVyYXRpb25JZCwgd29ya2VySW5zdGFuY2VJZDogdGhpcy53b3JrZXJJbnN0YW5jZUlkfSlcbiAgICAgIDogdGhpcy53b3JrZXJJbnN0YW5jZUlkXG4gICAgdGhpcy5ob3N0IHx8PSByZXNvbHZlZENvbmZpZy5ob3N0XG4gICAgaWYgKHR5cGVvZiB0aGlzLnBvcnQgIT09IFwibnVtYmVyXCIpIHRoaXMucG9ydCA9IHJlc29sdmVkQ29uZmlnLnBvcnRcbiAgICBhd2FpdCB0aGlzLmNvbmZpZ3VyYXRpb24uaW5pdGlhbGl6ZSh7dHlwZTogXCJiYWNrZ3JvdW5kLWpvYnMtd29ya2VyXCJ9KVxuICAgIGF3YWl0IHRoaXMuY29uZmlndXJhdGlvbi5jb25uZWN0QmVhY29uKHtwZWVyVHlwZTogXCJiYWNrZ3JvdW5kLWpvYnMtd29ya2VyXCJ9KVxuXG4gICAgLy8gQ29uc3RydWN0b3Igb3ZlcnJpZGVzIHdpbjsgb3RoZXJ3aXNlIHBpY2sgdXAgdGhlIGNvbmZpZ3VyZWQgY2Fwcy5cbiAgICBpZiAodHlwZW9mIHRoaXMubWF4Q29uY3VycmVudElubGluZUpvYnNPdmVycmlkZSAhPT0gXCJudW1iZXJcIikge1xuICAgICAgY29uc3QgY29uZmlnID0gdGhpcy5jb25maWd1cmF0aW9uLmdldEJhY2tncm91bmRKb2JzQ29uZmlnKClcblxuICAgICAgdGhpcy5tYXhDb25jdXJyZW50SW5saW5lSm9icyA9IGNvbmZpZy5tYXhDb25jdXJyZW50SW5saW5lSm9icyB8fCB0aGlzLm1heENvbmN1cnJlbnRJbmxpbmVKb2JzXG4gICAgfVxuICAgIGlmICh0eXBlb2YgdGhpcy5tYXhDb25jdXJyZW50Rm9ya2VkSm9ic092ZXJyaWRlICE9PSBcIm51bWJlclwiKSB7XG4gICAgICBjb25zdCBjb25maWcgPSB0aGlzLmNvbmZpZ3VyYXRpb24uZ2V0QmFja2dyb3VuZEpvYnNDb25maWcoKVxuXG4gICAgICB0aGlzLm1heENvbmN1cnJlbnRGb3JrZWRKb2JzID0gY29uZmlnLm1heENvbmN1cnJlbnRGb3JrZWRKb2JzIHx8IHRoaXMubWF4Q29uY3VycmVudEZvcmtlZEpvYnNcbiAgICB9XG4gICAgY29uc3QgcG9vbENvbmZpZyA9IHRoaXMuY29uZmlndXJhdGlvbi5nZXRCYWNrZ3JvdW5kSm9ic0NvbmZpZygpXG4gICAgaWYgKHR5cGVvZiB0aGlzLnBvb2xlZFJ1bm5lckNvdW50T3ZlcnJpZGUgIT09IFwibnVtYmVyXCIpIHRoaXMucG9vbGVkUnVubmVyQ291bnQgPSBwb29sQ29uZmlnLnBvb2xlZFJ1bm5lckNvdW50XG4gICAgaWYgKHR5cGVvZiB0aGlzLnBvb2xlZFJ1bm5lckNvbmN1cnJlbmN5T3ZlcnJpZGUgIT09IFwibnVtYmVyXCIpIHRoaXMucG9vbGVkUnVubmVyQ29uY3VycmVuY3kgPSBwb29sQ29uZmlnLnBvb2xlZFJ1bm5lckNvbmN1cnJlbmN5XG4gICAgaWYgKHR5cGVvZiB0aGlzLnBvb2xlZFJ1bm5lck1heEpvYnNPdmVycmlkZSAhPT0gXCJudW1iZXJcIikgdGhpcy5wb29sZWRSdW5uZXJNYXhKb2JzID0gcG9vbENvbmZpZy5wb29sZWRSdW5uZXJNYXhKb2JzXG4gICAgaWYgKHR5cGVvZiB0aGlzLnBvb2xlZFJ1bm5lck1heFJzc0J5dGVzT3ZlcnJpZGUgIT09IFwibnVtYmVyXCIpIHRoaXMucG9vbGVkUnVubmVyTWF4UnNzQnl0ZXMgPSBwb29sQ29uZmlnLnBvb2xlZFJ1bm5lck1heFJzc0J5dGVzXG4gICAgaWYgKHR5cGVvZiB0aGlzLnBvb2xlZFJ1bm5lck1heExpZmV0aW1lTXNPdmVycmlkZSAhPT0gXCJudW1iZXJcIikgdGhpcy5wb29sZWRSdW5uZXJNYXhMaWZldGltZU1zID0gcG9vbENvbmZpZy5wb29sZWRSdW5uZXJNYXhMaWZldGltZU1zXG5cbiAgICB0aGlzLnN0YXR1c1JlcG9ydGVyID0gbmV3IEJhY2tncm91bmRKb2JzU3RhdHVzUmVwb3J0ZXIoe1xuICAgICAgY29uZmlndXJhdGlvbjogdGhpcy5jb25maWd1cmF0aW9uLFxuICAgICAgaG9zdDogdGhpcy5ob3N0LFxuICAgICAgcG9ydDogdGhpcy5wb3J0LFxuICAgICAgZ2VuZXJhdGlvbkhhbmRzaGFrZVRpbWVvdXRNczogdGhpcy5nZW5lcmF0aW9uSGFuZHNoYWtlVGltZW91dE1zLFxuICAgICAgZ2VuZXJhdGlvbklkOiB0aGlzLmdlbmVyYXRpb25JZFxuICAgIH0pXG4gICAgdHJ5IHtcbiAgICAgIGF3YWl0IHRoaXMuX2Nvbm5lY3Qoe2FsbG93UmVjb25uZWN0OiBmYWxzZX0pXG4gICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgIGxldCBjbGVhbnVwRXJyb3JcblxuICAgICAgdHJ5IHtcbiAgICAgICAgYXdhaXQgdGhpcy5zdG9wKClcbiAgICAgIH0gY2F0Y2ggKGNhdWdodENsZWFudXBFcnJvcikge1xuICAgICAgICBjbGVhbnVwRXJyb3IgPSBjYXVnaHRDbGVhbnVwRXJyb3JcbiAgICAgIH1cblxuICAgICAgaWYgKGNsZWFudXBFcnJvcikge1xuICAgICAgICB0aHJvdyBuZXcgQWdncmVnYXRlRXJyb3IoXG4gICAgICAgICAgW2Vycm9yLCBjbGVhbnVwRXJyb3JdLFxuICAgICAgICAgIFwiQmFja2dyb3VuZCBqb2JzIHdvcmtlciBzdGFydHVwIGFuZCBjbGVhbnVwIGZhaWxlZFwiLFxuICAgICAgICAgIHtjYXVzZTogZXJyb3J9XG4gICAgICAgIClcbiAgICAgIH1cblxuICAgICAgdGhyb3cgZXJyb3JcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogR3JhY2VmdWxseSBzdG9wcyB0aGUgd29ya2VyOiBhbm5vdW5jZXMgZHJhaW5pbmcgdG8gdGhlIG1haW4gcHJvY2VzcyBzb1xuICAgKiBubyBuZXcgam9icyBhcmUgZGlzcGF0Y2hlZCwgd2FpdHMgZm9yIGluLWZsaWdodCBpbmxpbmUgam9icyBhbmQgcHJvY2Vzc1xuICAgKiBydW5uZXJzIHRvIGZpbmlzaCAoc28gdGhlaXIgcmVzdWx0cyBjYW4gYmUgcmVwb3J0ZWQpLCB0aGVuIGNsb3NlcyB0aGVcbiAgICogc29ja2V0IGFuZCBkaXNjb25uZWN0cyBmcm9tIHRoZSBiZWFjb24uXG4gICAqXG4gICAqIFByb2Nlc3MgcnVubmVycyBhcmUgY2hpbGQgcHJvY2Vzc2VzLiBXaGVuIGEgYHRpbWVvdXRNc2AgaXMgZ2l2ZW4gKGUuZy4gYVxuICAgKiBkZXBsb3kgZHJhaW5pbmcgdGhlIG9sZCByZWxlYXNlKSBhbnkgcnVubmVyIHN0aWxsIGFsaXZlIGFmdGVyIHRoZSBkcmFpblxuICAgKiB3aW5kb3cgaXMgdGVybWluYXRlZCAoU0lHVEVSTSwgdGhlbiBTSUdLSUxMKSByYXRoZXIgdGhhbiBsZWZ0IHRvIG9ycGhhblxuICAgKiBhY3Jvc3MgdGhlIGRlcGxveS4gV2l0aCBubyBgdGltZW91dE1zYCB0aGUgZHJhaW4gd2FpdHMgZm9yIHJ1bm5lcnMgdG9cbiAgICogZmluaXNoIG9uIHRoZWlyIG93bi5cbiAgICogQHBhcmFtIHtvYmplY3R9IFthcmdzXSAtIE9wdGlvbnMuXG4gICAqIEBwYXJhbSB7bnVtYmVyfSBbYXJncy50aW1lb3V0TXNdIC0gTWF4IHdhaXQgZm9yIGluLWZsaWdodCBqb2JzIChwZXIgcGhhc2UpIGluIG1zLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyB3aGVuIHN0b3BwZWQuXG4gICAqL1xuICBzdG9wKHt0aW1lb3V0TXN9ID0ge30pIHtcbiAgICBjb25zdCBzdG9wUHJvbWlzZSA9IHRoaXMuc3RvcFByb21pc2UgfHwgdGhpcy5fc3RvcCh7dGltZW91dE1zfSlcblxuICAgIGlmICghdGhpcy5zdG9wUHJvbWlzZSkge1xuICAgICAgdGhpcy5zdG9wUHJvbWlzZSA9IHN0b3BQcm9taXNlXG4gICAgICB2b2lkIHN0b3BQcm9taXNlLnRoZW4odGhpcy5fcmVzb2x2ZVN0b3BwZWQsIChlcnJvcikgPT4ge1xuICAgICAgICB0aGlzLl9yZWplY3RTdG9wcGVkKGVycm9yIGluc3RhbmNlb2YgRXJyb3IgPyBlcnJvciA6IG5ldyBFcnJvcihTdHJpbmcoZXJyb3IpKSlcbiAgICAgIH0pXG4gICAgfVxuXG4gICAgcmV0dXJuIHN0b3BQcm9taXNlXG4gIH1cblxuICAvKipcbiAgICogV2FpdHMgZm9yIGF1dG9tYXRpYyBvciByZXF1ZXN0ZWQgc3RvcC5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgd2hlbiB0aGlzIHdvcmtlciBoYXMgZnVsbHkgc3RvcHBlZC5cbiAgICovXG4gIHdhaXRVbnRpbFN0b3BwZWQoKSB7IHJldHVybiB0aGlzLl9zdG9wcGVkUHJvbWlzZSB9XG5cbiAgLyoqIFJlc2V0cyB0aGUgc3RvcCBvYnNlcnZhdGlvbiBwcm9taXNlIGZvciBhIG5ldyB3b3JrZXIgc3RhcnQuICovXG4gIF9yZXNldFN0b3BwZWRQcm9taXNlKCkge1xuICAgIHRoaXMuX3N0b3BwZWRQcm9taXNlID0gbmV3IFByb21pc2UoKHJlc29sdmUsIHJlamVjdCkgPT4ge1xuICAgICAgdGhpcy5fcmVzb2x2ZVN0b3BwZWQgPSByZXNvbHZlXG4gICAgICB0aGlzLl9yZWplY3RTdG9wcGVkID0gcmVqZWN0XG4gICAgfSlcbiAgICB2b2lkIHRoaXMuX3N0b3BwZWRQcm9taXNlLmNhdGNoKCgpID0+IHt9KVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgdGhlIHdvcmtlciBzaHV0ZG93biBsaWZlY3ljbGUgb25jZS5cbiAgICogQHBhcmFtIHtvYmplY3R9IFthcmdzXSAtIE9wdGlvbnMuXG4gICAqIEBwYXJhbSB7bnVtYmVyfSBbYXJncy50aW1lb3V0TXNdIC0gTWF4IHdhaXQgZm9yIGluLWZsaWdodCBqb2JzIChwZXIgcGhhc2UpIGluIG1zLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyB3aGVuIHN0b3BwZWQuXG4gICAqL1xuICBhc3luYyBfc3RvcCh7dGltZW91dE1zfSA9IHt9KSB7XG4gICAgdGhpcy5zaG91bGRTdG9wID0gdHJ1ZVxuICAgIHRoaXMuaXNSZXRpcmluZyA9IHRydWVcbiAgICB0aGlzLl9zdG9wSGVhcnRiZWF0KClcbiAgICBpZiAodGhpcy5fcmVjb25uZWN0VGltZXIpIHtcbiAgICAgIGNsZWFyVGltZW91dCh0aGlzLl9yZWNvbm5lY3RUaW1lcilcbiAgICAgIHRoaXMuX3JlY29ubmVjdFRpbWVyID0gdW5kZWZpbmVkXG4gICAgfVxuXG4gICAgYXdhaXQgc2h1dGRvd25MaWZlY3ljbGUoe1xuICAgICAgb25TdG9wcGVkOiB0aGlzLm9uU3RvcHBlZCxcbiAgICAgIHNodXRkb3duOiBhc3luYyAoKSA9PiB7XG4gICAgICAgIC8vIEFubm91bmNlIGRyYWluIHNvIG1haW4gc3RvcHMgZGlzcGF0Y2hpbmcgYnV0IGtlZXBzIHRoZSBjb25uZWN0aW9uXG4gICAgICAgIC8vIG9wZW4gdW50aWwgd2UgY2xvc2UgaXQgb3Vyc2VsdmVzIGJlbG93LlxuICAgICAgICBpZiAodGhpcy5qc29uU29ja2V0KSB7XG4gICAgICAgICAgdHJ5IHtcbiAgICAgICAgICAgIHRoaXMuanNvblNvY2tldC5zZW5kKHt0eXBlOiBcImRyYWluaW5nXCJ9KVxuICAgICAgICAgIH0gY2F0Y2gge1xuICAgICAgICAgICAgLy8gU29ja2V0IG1heSBhbHJlYWR5IGJlIGNsb3Npbmc7IG5vdGhpbmcgdG8gZG8uXG4gICAgICAgICAgfVxuICAgICAgICB9XG5cbiAgICAgICAgYXdhaXQgdGhpcy5fZHJhaW5JbmZsaWdodCh0aGlzLmluZmxpZ2h0SW5saW5lSm9icywgdGltZW91dE1zKVxuICAgICAgICBhd2FpdCB0aGlzLl9kcmFpbkluZmxpZ2h0KHRoaXMuaW5mbGlnaHRQb29sZWRKb2JzLCB0aW1lb3V0TXMpXG4gICAgICAgIGF3YWl0IHRoaXMuX2RyYWluSW5mbGlnaHQodGhpcy5pbmZsaWdodFByb2Nlc3NKb2JzLCB0aW1lb3V0TXMpXG4gICAgICAgIGF3YWl0IHRoaXMuX3Rlcm1pbmF0ZVByb2Nlc3NDaGlsZHJlbigpXG4gICAgICAgIC8vIEdpdmUgaW4tZmxpZ2h0IHJlc3VsdCByZXBvcnRzIChub3cgZGVjb3VwbGVkIGZyb20gam9iIHNsb3RzKSBhIGJvdW5kZWRcbiAgICAgICAgLy8gY2hhbmNlIHRvIGxhbmQgYmVmb3JlIHRoZSBzb2NrZXQgY2xvc2VzLlxuICAgICAgICBhd2FpdCB0aGlzLl9kcmFpbkluZmxpZ2h0KHRoaXMuaW5mbGlnaHRSZXBvcnRzLCB0aW1lb3V0TXMpXG5cbiAgICAgICAgaWYgKHRoaXMuanNvblNvY2tldCkgdGhpcy5qc29uU29ja2V0LmNsb3NlKClcbiAgICAgICAgaWYgKCF0aGlzLmNvbmZpZ3VyYXRpb24pIHJldHVyblxuXG4gICAgICAgIGF3YWl0IHRoaXMuX2Nsb3NlQ29uZmlndXJhdGlvbigpXG4gICAgICB9XG4gICAgfSlcbiAgfVxuXG4gIC8qKiBCZWdpbnMgZ2VuZXJhdGlvbiByZXRpcmVtZW50IHdpdGhvdXQgcmV2b2tpbmcgbGl2ZW5lc3MgZHVyaW5nIHRoZSBkcmFpbi4gKi9cbiAgX2JlZ2luR2VuZXJhdGlvblJldGlyZW1lbnQoKSB7XG4gICAgaWYgKHRoaXMuc3RvcFByb21pc2UpIHJldHVyblxuXG4gICAgdGhpcy5pc1JldGlyaW5nID0gdHJ1ZVxuICAgIGNvbnN0IHN0b3BQcm9taXNlID0gdGhpcy5fc3RvcEFmdGVyR2VuZXJhdGlvbkRyYWluKClcbiAgICB0aGlzLnN0b3BQcm9taXNlID0gc3RvcFByb21pc2VcbiAgICB2b2lkIHN0b3BQcm9taXNlLnRoZW4odGhpcy5fcmVzb2x2ZVN0b3BwZWQsIChlcnJvcikgPT4ge1xuICAgICAgY29uc3Qgbm9ybWFsaXplZEVycm9yID0gZXJyb3IgaW5zdGFuY2VvZiBFcnJvciA/IGVycm9yIDogbmV3IEVycm9yKFN0cmluZyhlcnJvcikpXG5cbiAgICAgIHRoaXMuX3JlamVjdFN0b3BwZWQobm9ybWFsaXplZEVycm9yKVxuICAgICAgdGhpcy5fcmVwb3J0TGlmZWN5Y2xlRXJyb3Iobm9ybWFsaXplZEVycm9yKVxuICAgIH0pXG4gIH1cblxuICAvKipcbiAgICogRHJhaW5zIGFjY2VwdGVkIGdlbmVyYXRpb24gd29yayB3aGlsZSByZXRhaW5pbmcgdGhlIGV4YWN0IGNvbm5lY3Rpb24gYW5kXG4gICAqIGhlYXJ0YmVhdCwgdGhlbiBwZXJmb3JtcyB0aGUgZmluYWwgdGVybWluYXRpbmcgc3RvcC5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgYWZ0ZXIgdGhlIHdvcmtlciBoYXMgZnVsbHkgY2xvc2VkLlxuICAgKi9cbiAgYXN5bmMgX3N0b3BBZnRlckdlbmVyYXRpb25EcmFpbigpIHtcbiAgICBpZiAodGhpcy5qc29uU29ja2V0KSB7XG4gICAgICB0cnkge1xuICAgICAgICB0aGlzLmpzb25Tb2NrZXQuc2VuZCh7dHlwZTogXCJkcmFpbmluZ1wifSlcbiAgICAgIH0gY2F0Y2gge1xuICAgICAgICAvLyBUaGUgY2xvc2UgaGFuZGxlciBvd25zIGV4YWN0IHNhbWUtZ2VuZXJhdGlvbiByZWNvbm5lY3QuXG4gICAgICB9XG4gICAgfVxuXG4gICAgYXdhaXQgdGhpcy5fZHJhaW5JbmZsaWdodCh0aGlzLmluZmxpZ2h0SW5saW5lSm9icylcbiAgICBhd2FpdCB0aGlzLl9kcmFpbkluZmxpZ2h0KHRoaXMuaW5mbGlnaHRQb29sZWRKb2JzKVxuICAgIGF3YWl0IHRoaXMuX2RyYWluSW5mbGlnaHQodGhpcy5pbmZsaWdodFByb2Nlc3NKb2JzKVxuICAgIGF3YWl0IHRoaXMuX2RyYWluSW5mbGlnaHQodGhpcy5pbmZsaWdodFJlcG9ydHMpXG5cbiAgICB0aGlzLnNob3VsZFN0b3AgPSB0cnVlXG4gICAgdGhpcy5fc3RvcEhlYXJ0YmVhdCgpXG4gICAgaWYgKHRoaXMuX3JlY29ubmVjdFRpbWVyKSB7XG4gICAgICBjbGVhclRpbWVvdXQodGhpcy5fcmVjb25uZWN0VGltZXIpXG4gICAgICB0aGlzLl9yZWNvbm5lY3RUaW1lciA9IHVuZGVmaW5lZFxuICAgIH1cbiAgICBhd2FpdCB0aGlzLl90ZXJtaW5hdGVQcm9jZXNzQ2hpbGRyZW4oKVxuXG4gICAgYXdhaXQgc2h1dGRvd25MaWZlY3ljbGUoe1xuICAgICAgb25TdG9wcGVkOiB0aGlzLm9uU3RvcHBlZCxcbiAgICAgIHNodXRkb3duOiBhc3luYyAoKSA9PiB7XG4gICAgICAgIGlmICh0aGlzLmpzb25Tb2NrZXQpIHRoaXMuanNvblNvY2tldC5jbG9zZSgpXG4gICAgICAgIGlmICghdGhpcy5jb25maWd1cmF0aW9uKSByZXR1cm5cblxuICAgICAgICBhd2FpdCB0aGlzLl9jbG9zZUNvbmZpZ3VyYXRpb24oKVxuICAgICAgfVxuICAgIH0pXG4gIH1cblxuICAvKipcbiAgICogQ2xvc2VzIGFwcGxpY2F0aW9uIHJlc291cmNlcyBiZWZvcmUgZnJhbWV3b3JrIHJlc291cmNlcyB3aGVuIHRoaXMgd29ya2VyIG93bnMgdGhlbS5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgYWZ0ZXIgZXZlcnkgb3duZWQgY2xvc2Ugc3VjY2VlZHMuXG4gICAqL1xuICBhc3luYyBfY2xvc2VDb25maWd1cmF0aW9uKCkge1xuICAgIGNvbnN0IGNvbmZpZ3VyYXRpb24gPSB0aGlzLmNvbmZpZ3VyYXRpb25cblxuICAgIGlmICghY29uZmlndXJhdGlvbikgcmV0dXJuXG5cbiAgICBhd2FpdCBydW5TaHV0ZG93blN0ZXBzKHtcbiAgICAgIG1lc3NhZ2U6IFwiQmFja2dyb3VuZCBqb2JzIHdvcmtlciBhcHBsaWNhdGlvbiBhbmQgZnJhbWV3b3JrIHNodXRkb3duIGZhaWxlZFwiLFxuICAgICAgc3RlcHM6IFtcbiAgICAgICAgLi4uKHRoaXMuY2xvc2VEYXRhYmFzZUNvbm5lY3Rpb25zT25TdG9wXG4gICAgICAgICAgPyBbYXN5bmMgKCkgPT4gYXdhaXQgY29uZmlndXJhdGlvbi5zaHV0ZG93bigpXVxuICAgICAgICAgIDogW10pLFxuICAgICAgICBhc3luYyAoKSA9PiBhd2FpdCBjb25maWd1cmF0aW9uLmRpc2Nvbm5lY3RCZWFjb24oKSxcbiAgICAgICAgLi4uKHRoaXMuY2xvc2VEYXRhYmFzZUNvbm5lY3Rpb25zT25TdG9wXG4gICAgICAgICAgPyBbYXN5bmMgKCkgPT4gYXdhaXQgY29uZmlndXJhdGlvbi5jbG9zZURhdGFiYXNlQ29ubmVjdGlvbnMoKV1cbiAgICAgICAgICA6IFtdKVxuICAgICAgXVxuICAgIH0pXG4gIH1cblxuICAvKipcbiAgICogV2FpdHMgZm9yIGEgc2V0IG9mIGluLWZsaWdodCBqb2IgcHJvbWlzZXMgdG8gc2V0dGxlLCBvcHRpb25hbGx5IGJvdW5kZWQgYnlcbiAgICogYHRpbWVvdXRNc2AuXG4gICAqIEBwYXJhbSB7U2V0PFByb21pc2U8dm9pZD4+fSBpbmZsaWdodCAtIEluLWZsaWdodCBqb2IgcHJvbWlzZXMuXG4gICAqIEBwYXJhbSB7bnVtYmVyfSBbdGltZW91dE1zXSAtIE1heCB3YWl0IGluIG1zOyB1bmJvdW5kZWQgd2hlbiBvbWl0dGVkLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyB3aGVuIHNldHRsZWQgb3IgdGhlIHRpbWVvdXQgZWxhcHNlcy5cbiAgICovXG4gIGFzeW5jIF9kcmFpbkluZmxpZ2h0KGluZmxpZ2h0LCB0aW1lb3V0TXMpIHtcbiAgICBpZiAoaW5mbGlnaHQuc2l6ZSA9PT0gMCkgcmV0dXJuXG5cbiAgICBjb25zdCBkcmFpbiA9IFByb21pc2UuYWxsU2V0dGxlZChbLi4uaW5mbGlnaHRdKVxuXG4gICAgaWYgKHR5cGVvZiB0aW1lb3V0TXMgPT09IFwibnVtYmVyXCIgJiYgdGltZW91dE1zID49IDApIHtcbiAgICAgIGxldCB0aW1lclxuICAgICAgY29uc3QgdGltZW91dCA9IG5ldyBQcm9taXNlKChyZXNvbHZlKSA9PiB7IHRpbWVyID0gc2V0VGltZW91dChyZXNvbHZlLCB0aW1lb3V0TXMpIH0pXG5cbiAgICAgIGF3YWl0IFByb21pc2UucmFjZShbZHJhaW4sIHRpbWVvdXRdKVxuICAgICAgY2xlYXJUaW1lb3V0KHRpbWVyKVxuICAgIH0gZWxzZSB7XG4gICAgICBhd2FpdCBkcmFpblxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBUZXJtaW5hdGVzIGFueSBwcm9jZXNzIHJ1bm5lciBjaGlsZHJlbiBzdGlsbCBhbGl2ZSBhZnRlciB0aGUgZHJhaW4gd2luZG93IHNvXG4gICAqIHRoZXkgZG9uJ3Qgb3V0bGl2ZSB0aGUgd29ya2VyIGFzIG9ycGhhbnMuIFNJR1RFUk0gbGV0cyB0aGUgcnVubmVyIGNsb3NlIGl0c1xuICAgKiBjb25uZWN0aW9ucyBjbGVhbmx5OyBzdXJ2aXZvcnMgYXJlIFNJR0tJTExlZCBhZnRlciBhIHNob3J0IGdyYWNlLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyBvbmNlIHN1cnZpdm9ycyBoYXZlIGJlZW4gc2lnbmFsbGVkLlxuICAgKi9cbiAgYXN5bmMgX3Rlcm1pbmF0ZVByb2Nlc3NDaGlsZHJlbigpIHtcbiAgICBpZiAodGhpcy5pbmZsaWdodFByb2Nlc3NDaGlsZHJlbi5zaXplID09PSAwKSByZXR1cm5cblxuICAgIGZvciAoY29uc3QgY2hpbGQgb2YgdGhpcy5pbmZsaWdodFByb2Nlc3NDaGlsZHJlbikge1xuICAgICAgY29uc3QgcG9vbGVkU3RhdGUgPSB0aGlzLnBvb2xlZENoaWxkU3RhdGVzLmdldChjaGlsZClcbiAgICAgIGlmIChwb29sZWRTdGF0ZSkge1xuICAgICAgICB0aGlzLl9yZXF1ZXN0UG9vbGVkQ2hpbGRTaHV0ZG93bih7Y2hpbGQsIHJlYXNvbjogXCJ3b3JrZXJfc3RvcFwiLCBzaWduYWw6IFwiU0lHVEVSTVwifSlcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIHRyeSB7XG4gICAgICAgICAgY2hpbGQua2lsbChcIlNJR1RFUk1cIilcbiAgICAgICAgfSBjYXRjaCB7XG4gICAgICAgICAgLy8gQ2hpbGQgYWxyZWFkeSBleGl0ZWQ7IG5vdGhpbmcgdG8gZG8uXG4gICAgICAgIH1cbiAgICAgIH1cbiAgICB9XG5cbiAgICBhd2FpdCBuZXcgUHJvbWlzZSgocmVzb2x2ZSkgPT4gc2V0VGltZW91dChyZXNvbHZlLCB0aGlzLmZvcmtlZENoaWxkU2lna2lsbEdyYWNlTXMpKVxuXG4gICAgZm9yIChjb25zdCBjaGlsZCBvZiB0aGlzLmluZmxpZ2h0UHJvY2Vzc0NoaWxkcmVuKSB7XG4gICAgICB0cnkge1xuICAgICAgICBjaGlsZC5raWxsKFwiU0lHS0lMTFwiKVxuICAgICAgfSBjYXRjaCB7XG4gICAgICAgIC8vIENoaWxkIGFscmVhZHkgZXhpdGVkOyBub3RoaW5nIHRvIGRvLlxuICAgICAgfVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBDb25uZWN0cyB0byB0aGUgd29ya2VyJ3MgcmVzb2x2ZWQgZW5kcG9pbnQgYW5kIGNvbXBsZXRlcyBpdHMgaGVsbG8gZmVuY2UuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gUmVjb25uZWN0IHBvbGljeS5cbiAgICogQHBhcmFtIHtib29sZWFufSBhcmdzLmFsbG93UmVjb25uZWN0IC0gV2hldGhlciBhIGZhaWxlZCBhdHRlbXB0IG1heSBzY2hlZHVsZSBhbm90aGVyIGNvbm5lY3Rpb24uXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIGFmdGVyIGdlbmVyYXRpb24gYWNrbm93bGVkZ2VtZW50LlxuICAgKi9cbiAgYXN5bmMgX2Nvbm5lY3Qoe2FsbG93UmVjb25uZWN0fSkge1xuICAgIGNvbnN0IGNvbmZpZ3VyYXRpb24gPSB0aGlzLmNvbmZpZ3VyYXRpb25cbiAgICBpZiAoIWNvbmZpZ3VyYXRpb24pIHRocm93IG5ldyBFcnJvcihcIkJhY2tncm91bmQgam9icyB3b3JrZXIgY29uZmlndXJhdGlvbiBub3QgaW5pdGlhbGl6ZWRcIilcblxuICAgIGNvbnN0IGNvbmZpZyA9IGNvbmZpZ3VyYXRpb24uZ2V0QmFja2dyb3VuZEpvYnNDb25maWcoKVxuICAgIGlmICh0aGlzLmdlbmVyYXRpb25JZCkgdGhpcy5fZ2VuZXJhdGlvbkFjY2VwdGVkID0gZmFsc2VcbiAgICBjb25zdCBob3N0ID0gdGhpcy5ob3N0IHx8IGNvbmZpZy5ob3N0XG4gICAgY29uc3QgcG9ydCA9IHR5cGVvZiB0aGlzLnBvcnQgPT09IFwibnVtYmVyXCIgPyB0aGlzLnBvcnQgOiBjb25maWcucG9ydFxuICAgIGNvbnN0IHNvY2tldCA9IG5ldC5jcmVhdGVDb25uZWN0aW9uKHtob3N0LCBwb3J0fSlcbiAgICBzb2NrZXQuc2V0S2VlcEFsaXZlKHRydWUsIFNPQ0tFVF9LRUVQQUxJVkVfTVMpXG4gICAgY29uc3QganNvblNvY2tldCA9IG5ldyBKc29uU29ja2V0KHNvY2tldClcbiAgICB0aGlzLmpzb25Tb2NrZXQgPSBqc29uU29ja2V0XG4gICAgLyoqXG4gICAgICogUmVzb2x2ZXMgdGhlIGdlbmVyYXRpb24gaGFuZHNoYWtlLlxuICAgICAqIEB0eXBlIHsoKSA9PiB2b2lkfVxuICAgICAqL1xuICAgIGxldCByZXNvbHZlSGFuZHNoYWtlID0gKCkgPT4ge31cbiAgICAvKipcbiAgICAgKiBSZWplY3RzIHRoZSBnZW5lcmF0aW9uIGhhbmRzaGFrZS5cbiAgICAgKiBAdHlwZSB7KGVycm9yOiBFcnJvcikgPT4gdm9pZH1cbiAgICAgKi9cbiAgICBsZXQgcmVqZWN0SGFuZHNoYWtlID0gKCkgPT4ge31cbiAgICBsZXQgY29ubmVjdGlvbkFjY2VwdGVkID0gZmFsc2VcbiAgICAvKiogQHR5cGUge1JldHVyblR5cGU8dHlwZW9mIHNldFRpbWVvdXQ+IHwgdW5kZWZpbmVkfSAqL1xuICAgIGxldCBoYW5kc2hha2VUaW1lclxuICAgIGNvbnN0IGhhbmRzaGFrZSA9IG5ldyBQcm9taXNlKCgvKiogQHR5cGUgeyh2YWx1ZTogdm9pZCkgPT4gdm9pZH0gKi8gcmVzb2x2ZSwgcmVqZWN0KSA9PiB7XG4gICAgICByZXNvbHZlSGFuZHNoYWtlID0gcmVzb2x2ZVxuICAgICAgcmVqZWN0SGFuZHNoYWtlID0gcmVqZWN0XG4gICAgfSlcblxuICAgIC8qKlxuICAgICAqIEhhbmRsZXMgYSBiYWNrZ3JvdW5kIGpvYiBzb2NrZXQgbWVzc2FnZS5cbiAgICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vdHlwZXMuanNcIikuQmFja2dyb3VuZEpvYlNvY2tldE1lc3NhZ2V9IG1lc3NhZ2UgLSBTb2NrZXQgbWVzc2FnZS5cbiAgICAgKi9cbiAgICBqc29uU29ja2V0Lm9uKFwibWVzc2FnZVwiLCBhc3luYyAobWVzc2FnZSkgPT4ge1xuICAgICAgaWYgKG1lc3NhZ2U/LnR5cGUgPT09IFwiZ2VuZXJhdGlvbi1hY2NlcHRlZFwiKSB7XG4gICAgICAgIGlmICghdGhpcy5nZW5lcmF0aW9uSWQgfHwgbWVzc2FnZS5nZW5lcmF0aW9uSWQgIT09IHRoaXMuZ2VuZXJhdGlvbklkKSB7XG4gICAgICAgICAgcmVqZWN0SGFuZHNoYWtlKG5ldyBFcnJvcihcIkJhY2tncm91bmQgam9icyBtYWluIGFja25vd2xlZGdlZCBhIGRpZmZlcmVudCBnZW5lcmF0aW9uXCIpKVxuICAgICAgICAgIGpzb25Tb2NrZXQuZGVzdHJveSgpXG4gICAgICAgICAgcmV0dXJuXG4gICAgICAgIH1cblxuICAgICAgICB0aGlzLl9nZW5lcmF0aW9uQWNjZXB0ZWQgPSB0cnVlXG4gICAgICAgIGNvbm5lY3Rpb25BY2NlcHRlZCA9IHRydWVcbiAgICAgICAgaWYgKGhhbmRzaGFrZVRpbWVyKSB7XG4gICAgICAgICAgY2xlYXJUaW1lb3V0KGhhbmRzaGFrZVRpbWVyKVxuICAgICAgICAgIGhhbmRzaGFrZVRpbWVyID0gdW5kZWZpbmVkXG4gICAgICAgIH1cbiAgICAgICAgaWYgKG1lc3NhZ2UubGlmZWN5Y2xlU3RhdGUgPT09IFwicmV0aXJpbmdcIiB8fCBtZXNzYWdlLmxpZmVjeWNsZVN0YXRlID09PSBcInJldGlyZWRcIikgdGhpcy5pc1JldGlyaW5nID0gdHJ1ZVxuICAgICAgICB0aGlzLm9uR2VuZXJhdGlvbkFjY2VwdGVkPy4oKVxuICAgICAgICB0aGlzLl9zZW5kUmVhZHlJZlJ1bm5pbmcoKVxuICAgICAgICB0aGlzLl9zdGFydEhlYXJ0YmVhdCgpXG4gICAgICAgIHJlc29sdmVIYW5kc2hha2UoKVxuICAgICAgICByZXR1cm5cbiAgICAgIH1cblxuICAgICAgaWYgKG1lc3NhZ2U/LnR5cGUgPT09IFwiZ2VuZXJhdGlvbi1yZWplY3RlZFwiKSB7XG4gICAgICAgIHRoaXMuc2hvdWxkU3RvcCA9IHRydWVcbiAgICAgICAgaWYgKGhhbmRzaGFrZVRpbWVyKSBjbGVhclRpbWVvdXQoaGFuZHNoYWtlVGltZXIpXG4gICAgICAgIHJlamVjdEhhbmRzaGFrZShuZXcgRXJyb3IoYEJhY2tncm91bmQgam9icyBnZW5lcmF0aW9uIHJlamVjdGVkOiAke21lc3NhZ2UucmVhc29ufWApKVxuICAgICAgICBqc29uU29ja2V0LmRlc3Ryb3koKVxuICAgICAgICByZXR1cm5cbiAgICAgIH1cblxuICAgICAgaWYgKG1lc3NhZ2U/LnR5cGUgPT09IFwicmV0aXJlXCIpIHtcbiAgICAgICAgaWYgKHRoaXMuZ2VuZXJhdGlvbklkICYmIG1lc3NhZ2UuZ2VuZXJhdGlvbklkID09PSB0aGlzLmdlbmVyYXRpb25JZCkge1xuICAgICAgICAgIHRoaXMub25SZXRpcmVNZXNzYWdlPy4oKVxuICAgICAgICAgIHRoaXMuX2JlZ2luR2VuZXJhdGlvblJldGlyZW1lbnQoKVxuICAgICAgICB9XG4gICAgICAgIHJldHVyblxuICAgICAgfVxuXG4gICAgICBpZiAobWVzc2FnZT8udHlwZSA9PT0gXCJqb2JcIikge1xuICAgICAgICBhd2FpdCB0aGlzLl9oYW5kbGVKb2IobWVzc2FnZS5wYXlsb2FkKVxuICAgICAgfVxuICAgIH0pXG5cbiAgICBqc29uU29ja2V0Lm9uKFwiZXJyb3JcIiwgKGVycm9yKSA9PiB7XG4gICAgICBjb25zb2xlLmVycm9yKFwiQmFja2dyb3VuZCBqb2JzIHdvcmtlciBzb2NrZXQgZXJyb3I6XCIsIGVycm9yKVxuICAgICAgaWYgKHRoaXMuZ2VuZXJhdGlvbklkICYmICF0aGlzLl9nZW5lcmF0aW9uQWNjZXB0ZWQpIHJlamVjdEhhbmRzaGFrZShlcnJvcilcbiAgICB9KVxuXG4gICAganNvblNvY2tldC5vbihcImNsb3NlXCIsICgpID0+IHtcbiAgICAgIGlmIChoYW5kc2hha2VUaW1lcikgY2xlYXJUaW1lb3V0KGhhbmRzaGFrZVRpbWVyKVxuICAgICAgdGhpcy5fc3RvcEhlYXJ0YmVhdCgpXG4gICAgICBpZiAodGhpcy5qc29uU29ja2V0ID09PSBqc29uU29ja2V0KSB0aGlzLmpzb25Tb2NrZXQgPSB1bmRlZmluZWRcbiAgICAgIGlmICh0aGlzLmdlbmVyYXRpb25JZCAmJiAhdGhpcy5fZ2VuZXJhdGlvbkFjY2VwdGVkKSB7XG4gICAgICAgIHJlamVjdEhhbmRzaGFrZShuZXcgRXJyb3IoXCJCYWNrZ3JvdW5kIGpvYnMgc29ja2V0IGNsb3NlZCBiZWZvcmUgZ2VuZXJhdGlvbiBhY2tub3dsZWRnZW1lbnRcIikpXG4gICAgICB9XG4gICAgICBpZiAodGhpcy5zaG91bGRTdG9wKSByZXR1cm5cbiAgICAgIGlmIChjb25uZWN0aW9uQWNjZXB0ZWQgfHwgYWxsb3dSZWNvbm5lY3QgfHwgIXRoaXMuZ2VuZXJhdGlvbklkKSB0aGlzLl9zY2hlZHVsZVJlY29ubmVjdCgpXG4gICAgfSlcblxuICAgIGlmICh0aGlzLmdlbmVyYXRpb25JZCkge1xuICAgICAgaGFuZHNoYWtlVGltZXIgPSBzZXRUaW1lb3V0KCgpID0+IHtcbiAgICAgICAgY29uc3QgZXJyb3IgPSBuZXcgQmFja2dyb3VuZEpvYnNHZW5lcmF0aW9uSGFuZHNoYWtlVGltZW91dEVycm9yKHtcbiAgICAgICAgICBlbmRwb2ludDogYCR7aG9zdH06JHtwb3J0fWAsXG4gICAgICAgICAgZ2VuZXJhdGlvbklkOiB0aGlzLmdlbmVyYXRpb25JZCB8fCBcIlwiLFxuICAgICAgICAgIHJvbGU6IFwid29ya2VyXCIsXG4gICAgICAgICAgdGltZW91dE1zOiB0aGlzLmdlbmVyYXRpb25IYW5kc2hha2VUaW1lb3V0TXNcbiAgICAgICAgfSlcbiAgICAgICAgcmVqZWN0SGFuZHNoYWtlKGVycm9yKVxuICAgICAgICBqc29uU29ja2V0LmRlc3Ryb3koKVxuICAgICAgfSwgdGhpcy5nZW5lcmF0aW9uSGFuZHNoYWtlVGltZW91dE1zKVxuICAgIH1cblxuICAgIHNvY2tldC5vbihcImNvbm5lY3RcIiwgKCkgPT4ge1xuICAgICAganNvblNvY2tldC5zZW5kKHt0eXBlOiBcImhlbGxvXCIsIHJvbGU6IFwid29ya2VyXCIsIC4uLih0aGlzLmdlbmVyYXRpb25JZCA/IHtnZW5lcmF0aW9uSWQ6IHRoaXMuZ2VuZXJhdGlvbklkfSA6IHt9KSwgc3VwcG9ydHNIYW5kb2ZmSWRSZXBvcnRpbmc6IHRydWUsIHN1cHBvcnRzSGVhcnRiZWF0OiB0cnVlLCBzdXBwb3J0c1Bvb2xlZDogdHJ1ZSwgd29ya2VySWQ6IHRoaXMud29ya2VySWR9KVxuICAgICAgaWYgKCF0aGlzLmdlbmVyYXRpb25JZCkge1xuICAgICAgICBjb25uZWN0aW9uQWNjZXB0ZWQgPSB0cnVlXG4gICAgICAgIHRoaXMuX3NlbmRSZWFkeUlmUnVubmluZygpXG4gICAgICAgIHRoaXMuX3N0YXJ0SGVhcnRiZWF0KClcbiAgICAgICAgcmVzb2x2ZUhhbmRzaGFrZSgpXG4gICAgICB9XG4gICAgfSlcblxuICAgIGlmICh0aGlzLmdlbmVyYXRpb25JZCkgYXdhaXQgaGFuZHNoYWtlXG4gIH1cblxuICAvKiogU2NoZWR1bGVzIG9uZSBmZW5jZWQgcmVjb25uZWN0IHRvIHRoZSB3b3JrZXIncyB1bmNoYW5nZWQgZW5kcG9pbnQuICovXG4gIF9zY2hlZHVsZVJlY29ubmVjdCgpIHtcbiAgICBpZiAodGhpcy5zaG91bGRTdG9wIHx8IHRoaXMuX3JlY29ubmVjdFRpbWVyKSByZXR1cm5cblxuICAgIHRoaXMuX3JlY29ubmVjdFRpbWVyID0gc2V0VGltZW91dCgoKSA9PiB7XG4gICAgICB0aGlzLl9yZWNvbm5lY3RUaW1lciA9IHVuZGVmaW5lZFxuICAgICAgaWYgKHRoaXMuc2hvdWxkU3RvcCkgcmV0dXJuXG4gICAgICB2b2lkIHRoaXMuX2Nvbm5lY3Qoe2FsbG93UmVjb25uZWN0OiB0cnVlfSkuY2F0Y2goKGVycm9yKSA9PiB7XG4gICAgICAgIGlmICghdGhpcy5zaG91bGRTdG9wKSBjb25zb2xlLmVycm9yKFwiQmFja2dyb3VuZCBqb2JzIHdvcmtlciByZWNvbm5lY3QgZmFpbGVkOlwiLCBlcnJvcilcbiAgICAgIH0pXG4gICAgfSwgdGhpcy5yZWNvbm5lY3REZWxheU1zKVxuICAgIGlmICh0eXBlb2YgdGhpcy5fcmVjb25uZWN0VGltZXIudW5yZWYgPT09IFwiZnVuY3Rpb25cIikgdGhpcy5fcmVjb25uZWN0VGltZXIudW5yZWYoKVxuICB9XG5cbiAgLyoqXG4gICAqIFN1cmZhY2VzIGFuIHVuZXhwZWN0ZWQgd29ya2VyIGxpZmVjeWNsZSBmYWlsdXJlIHRocm91Z2ggdGhlIGZyYW1ld29yayBlcnJvclxuICAgKiBjaGFubmVscyBzbyBhIHN1cGVydmlzb3IgaG9vayB0aGF0IGlnbm9yZXMgc3RkaW8gc3RpbGwgaGFzIG9ic2VydmFiaWxpdHkuXG4gICAqIEBwYXJhbSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59IGVycm9yIC0gV29ya2VyIGxpZmVjeWNsZSBmYWlsdXJlLlxuICAgKi9cbiAgX3JlcG9ydExpZmVjeWNsZUVycm9yKGVycm9yKSB7XG4gICAgY29uc3QgY29uZmlndXJhdGlvbiA9IHRoaXMuY29uZmlndXJhdGlvblxuICAgIGlmICghY29uZmlndXJhdGlvbikgcmV0dXJuXG4gICAgY29uc3Qgbm9ybWFsaXplZEVycm9yID0gZXJyb3IgaW5zdGFuY2VvZiBFcnJvciA/IGVycm9yIDogbmV3IEVycm9yKFN0cmluZyhlcnJvcikpXG4gICAgY29uc3QgcGF5bG9hZCA9IHtjb250ZXh0OiB7Z2VuZXJhdGlvbklkOiB0aGlzLmdlbmVyYXRpb25JZCwgc3RhZ2U6IFwiYmFja2dyb3VuZC1qb2JzLXdvcmtlci1saWZlY3ljbGVcIn0sIGVycm9yOiBub3JtYWxpemVkRXJyb3J9XG4gICAgY29uc3QgZXJyb3JFdmVudHMgPSBjb25maWd1cmF0aW9uLmdldEVycm9yRXZlbnRzKClcblxuICAgIGVycm9yRXZlbnRzLmVtaXQoXCJmcmFtZXdvcmstZXJyb3JcIiwgcGF5bG9hZClcbiAgICBlcnJvckV2ZW50cy5lbWl0KFwiYWxsLWVycm9yXCIsIHsuLi5wYXlsb2FkLCBlcnJvclR5cGU6IFwiZnJhbWV3b3JrLWVycm9yXCJ9KVxuICB9XG5cbiAgLyoqXG4gICAqIFNlbmRzIHBlcmlvZGljIGxpdmVuZXNzIGhlYXJ0YmVhdHMgdG8gdGhlIG1haW4gc28gYSB3ZWRnZWQgb3Igc2lsZW50IHdvcmtlclxuICAgKiBjYW4gYmUgZGV0ZWN0ZWQgYW5kIGRyb3BwZWQgdGhlcmUgKGl0cyBsZWFzZXMgcmVsZWFzZWQpIGluc3RlYWQgb2YgZnJlZXppbmdcbiAgICogdGhlIHF1ZXVlIHVudGlsIGEgaHVtYW4gbm90aWNlcy5cbiAgICogQHJldHVybnMge3ZvaWR9XG4gICAqL1xuICBfc3RhcnRIZWFydGJlYXQoKSB7XG4gICAgdGhpcy5fc3RvcEhlYXJ0YmVhdCgpXG5cbiAgICB0aGlzLl9oZWFydGJlYXRUaW1lciA9IHNldEludGVydmFsKCgpID0+IHRoaXMuX3NlbmRIZWFydGJlYXQoKSwgdGhpcy5oZWFydGJlYXRJbnRlcnZhbE1zKVxuXG4gICAgaWYgKHR5cGVvZiB0aGlzLl9oZWFydGJlYXRUaW1lci51bnJlZiA9PT0gXCJmdW5jdGlvblwiKSB0aGlzLl9oZWFydGJlYXRUaW1lci51bnJlZigpXG4gIH1cblxuICAvKiogU2VuZHMgb25lIGxpdmVuZXNzIGhlYXJ0YmVhdCB3aGlsZSB0aGUgd29ya2VyIGhhcyBub3QgZmluYWxseSBzdG9wcGVkLiAqL1xuICBfc2VuZEhlYXJ0YmVhdCgpIHtcbiAgICBpZiAodGhpcy5zaG91bGRTdG9wIHx8ICF0aGlzLmpzb25Tb2NrZXQpIHJldHVyblxuXG4gICAgdHJ5IHtcbiAgICAgIHRoaXMuanNvblNvY2tldC5zZW5kKHt0eXBlOiBcImhlYXJ0YmVhdFwiLCB3b3JrZXJJZDogdGhpcy53b3JrZXJJZH0pXG4gICAgfSBjYXRjaCB7XG4gICAgICAvLyBTb2NrZXQgaXMgY2xvc2luZy9jbG9zZWQ7IHRoZSBjbG9zZSBoYW5kbGVyIGRyaXZlcyByZWNvbm5lY3QuXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIFN0b3BzIHRoZSBsaXZlbmVzcyBoZWFydGJlYXQgdGltZXIuXG4gICAqIEByZXR1cm5zIHt2b2lkfVxuICAgKi9cbiAgX3N0b3BIZWFydGJlYXQoKSB7XG4gICAgaWYgKHRoaXMuX2hlYXJ0YmVhdFRpbWVyKSB7XG4gICAgICBjbGVhckludGVydmFsKHRoaXMuX2hlYXJ0YmVhdFRpbWVyKVxuICAgICAgdGhpcy5faGVhcnRiZWF0VGltZXIgPSB1bmRlZmluZWRcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogUnVucyBoYW5kbGUgam9iLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vdHlwZXMuanNcIikuQmFja2dyb3VuZEpvYlBheWxvYWR9IHBheWxvYWQgLSBQYXlsb2FkLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyB3aGVuIGRvbmUuXG4gICAqL1xuICBhc3luYyBfaGFuZGxlSm9iKHBheWxvYWQpIHtcbiAgICBpZiAoIXBheWxvYWQuaWQpIHRocm93IG5ldyBFcnJvcihcIkJhY2tncm91bmQgam9iIHBheWxvYWQgbWlzc2luZyBpZFwiKVxuICAgIC8qKlxuICAgICAqIElkZW50aWZpZWQgcGF5bG9hZC5cbiAgICAgKiBAdHlwZSB7aW1wb3J0KFwiLi90eXBlcy5qc1wiKS5CYWNrZ3JvdW5kSm9iUGF5bG9hZCAmIHtpZDogc3RyaW5nfX0gKi9cbiAgICBjb25zdCBpZGVudGlmaWVkUGF5bG9hZCA9IC8qKiBAdHlwZSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59ICovIChwYXlsb2FkKVxuXG4gICAgY29uc3QgZXhlY3V0aW9uTW9kZSA9IHRoaXMuX2V4ZWN1dGlvbk1vZGVGb3JQYXlsb2FkKGlkZW50aWZpZWRQYXlsb2FkKVxuXG4gICAgaWYgKGV4ZWN1dGlvbk1vZGUgPT09IFwicG9vbGVkXCIpIHtcbiAgICAgIHRoaXMuX3F1ZXVlUG9vbGVkSm9iKGlkZW50aWZpZWRQYXlsb2FkKVxuICAgICAgcmV0dXJuXG4gICAgfVxuXG4gICAgaWYgKGV4ZWN1dGlvbk1vZGUgIT09IFwiaW5saW5lXCIpIHtcbiAgICAgIHRoaXMuX3RyYWNrUHJvY2Vzc0pvYih0aGlzLl9zdGFydFByb2Nlc3NKb2Ioe2V4ZWN1dGlvbk1vZGUsIHBheWxvYWQ6IGlkZW50aWZpZWRQYXlsb2FkfSkpXG4gICAgICByZXR1cm5cbiAgICB9XG5cbiAgICB0aGlzLl9oYW5kbGVJbmxpbmVKb2IoaWRlbnRpZmllZFBheWxvYWQpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBzdGFydCBwcm9jZXNzIGpvYi5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBPcHRpb25zLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vdHlwZXMuanNcIikuQmFja2dyb3VuZEpvYkV4ZWN1dGlvbk1vZGV9IGFyZ3MuZXhlY3V0aW9uTW9kZSAtIEV4ZWN1dGlvbiBtb2RlLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vdHlwZXMuanNcIikuQmFja2dyb3VuZEpvYlBheWxvYWQgJiB7aWQ6IHN0cmluZ319IGFyZ3MucGF5bG9hZCAtIFBheWxvYWQuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIHdoZW4gdGhlIHByb2Nlc3Mgam9iIGV4aXRzLlxuICAgKi9cbiAgX3N0YXJ0UHJvY2Vzc0pvYih7ZXhlY3V0aW9uTW9kZSwgcGF5bG9hZH0pIHtcbiAgICBpZiAoZXhlY3V0aW9uTW9kZSA9PT0gXCJmb3JrZWRcIikgcmV0dXJuIHRoaXMuX2ZvcmtKb2IocGF5bG9hZClcblxuICAgIHJldHVybiB0aGlzLl9zcGF3bkpvYihwYXlsb2FkKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgaGFuZGxlIGlubGluZSBqb2IuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi90eXBlcy5qc1wiKS5CYWNrZ3JvdW5kSm9iUGF5bG9hZCAmIHtpZDogc3RyaW5nfX0gcGF5bG9hZCAtIFBheWxvYWQuXG4gICAqIEByZXR1cm5zIHt2b2lkfVxuICAgKi9cbiAgX2hhbmRsZUlubGluZUpvYihwYXlsb2FkKSB7XG4gICAgLy8gSW5saW5lIGpvYnMgc2hhcmUgdGhlIHdvcmtlcidzIHByb2Nlc3MgYW5kIERCIHBvb2wsIGJ1dCBlYWNoIG9uZVxuICAgIC8vIGlzIGl0cyBvd24gYXN5bmMgY2hhaW4g4oCUIHRoZXJlJ3Mgbm8gc2VtYW50aWMgcmVhc29uIHRvIHNlcmlhbGl6ZVxuICAgIC8vIHRoZW0uIFdlIGtpY2sgb2ZmIHRoZSBqb2IsIHJlZ2lzdGVyIGl0IHdpdGggYGluZmxpZ2h0SW5saW5lSm9ic2BcbiAgICAvLyBmb3Igc2h1dGRvd24gZHJhaW4sIGFuZCBzaWduYWwgY2FwYWNpdHkgdG8gbWFpbjpcbiAgICAvLyAtIElmIHdlIHN0aWxsIGhhdmUgYSBmcmVlIHNsb3Qgd2UgYXNrIGZvciB0aGUgbmV4dCBqb2IgcmlnaHRcbiAgICAvLyAgIGF3YXksIHNvIGEgc2xvdyBqb2IgKGUuZy4gYSBkb2NrZXIgYWxpdmUgY2hlY2sgdGhhdCB3YWl0cyAxNXNcbiAgICAvLyAgIG9uIGEgZ29uZSBzZXJ2ZXIpIG5vIGxvbmdlciBzdGFydmVzIGV2ZXJ5IG90aGVyIGlubGluZSBqb2IuXG4gICAgLy8gLSBXaGVuIHRoZSBqb2IgZmluaXNoZXMsIGlmIHRoZSB3b3JrZXIgaGFkIGJlZW4gYXQgdGhlIGNhcCwgd2VcbiAgICAvLyAgIGFzayBmb3IgdGhlIG5leHQgam9iIHRvIHJlZmlsbCB0aGUgc2xvdC5cbiAgICAvLyBUaGUgYm9va2tlZXBpbmcgaW4gYGZpbmFsbHkoKWAgcmF0Y2hldHMgY2FwYWNpdHkgYmFjayB1cFxuICAgIC8vIHJlZ2FyZGxlc3Mgb2Ygc3VjY2VzcyBvciBmYWlsdXJlLlxuICAgIC8qKlxuICAgICAqIERlZmluZXMgaW5mbGlnaHQuXG4gICAgICogQHR5cGUge1Byb21pc2U8dm9pZD59ICovXG4gICAgbGV0IGluZmxpZ2h0XG5cbiAgICBpbmZsaWdodCA9IHRoaXMuX3J1bklubGluZUpvYkFuZFJlcG9ydChwYXlsb2FkKS5maW5hbGx5KCgpID0+IHtcbiAgICAgIHRoaXMuaW5mbGlnaHRJbmxpbmVKb2JzLmRlbGV0ZShpbmZsaWdodClcblxuICAgICAgLy8gUmUtYW5ub3VuY2Ugb24gZXZlcnkgY29tcGxldGlvbiBiZWxvdyBjYXAsIG5vdCBqdXN0IHRoZSBjYXDihpJjYXAtMSBlZGdlIOKAlFxuICAgICAgLy8gc2VlIF90cmFja1Byb2Nlc3NKb2IgZm9yIHdoeSB0aGUga25pZmUtZWRnZSBjb25kaXRpb24gc2lsZW50bHkgd2VkZ2VzLlxuICAgICAgaWYgKCF0aGlzLnNob3VsZFN0b3ApIHRoaXMuX3NlbmRSZWFkeUlmUnVubmluZygpXG4gICAgfSlcblxuICAgIHRoaXMuaW5mbGlnaHRJbmxpbmVKb2JzLmFkZChpbmZsaWdodClcblxuICAgIGlmICh0aGlzLmluZmxpZ2h0SW5saW5lSm9icy5zaXplIDwgdGhpcy5tYXhDb25jdXJyZW50SW5saW5lSm9icykge1xuICAgICAgdGhpcy5fc2VuZFJlYWR5SWZSdW5uaW5nKClcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogUnVucyBleGVjdXRpb24gbW9kZSBmb3IgcGF5bG9hZC5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL3R5cGVzLmpzXCIpLkJhY2tncm91bmRKb2JQYXlsb2FkfSBwYXlsb2FkIC0gUGF5bG9hZC5cbiAgICogQHJldHVybnMge2ltcG9ydChcIi4vdHlwZXMuanNcIikuQmFja2dyb3VuZEpvYkV4ZWN1dGlvbk1vZGV9IC0gRXhlY3V0aW9uIG1vZGUuXG4gICAqL1xuICBfZXhlY3V0aW9uTW9kZUZvclBheWxvYWQocGF5bG9hZCkge1xuICAgIGNvbnN0IGV4ZWN1dGlvbk1vZGUgPSBwYXlsb2FkLm9wdGlvbnM/LmV4ZWN1dGlvbk1vZGVcblxuICAgIHJldHVybiBleGVjdXRpb25Nb2RlID8gdGhpcy5fbm9ybWFsaXplRXhlY3V0aW9uTW9kZShleGVjdXRpb25Nb2RlKSA6IFwicG9vbGVkXCJcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIG5vcm1hbGl6ZSBleGVjdXRpb24gbW9kZS5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGV4ZWN1dGlvbk1vZGUgLSBFeGVjdXRpb24gbW9kZS5cbiAgICogQHJldHVybnMge2ltcG9ydChcIi4vdHlwZXMuanNcIikuQmFja2dyb3VuZEpvYkV4ZWN1dGlvbk1vZGV9IC0gTm9ybWFsaXplZCBleGVjdXRpb24gbW9kZS5cbiAgICovXG4gIF9ub3JtYWxpemVFeGVjdXRpb25Nb2RlKGV4ZWN1dGlvbk1vZGUpIHtcbiAgICBmb3IgKGNvbnN0IG1vZGUgb2YgRVhFQ1VUSU9OX01PREVTKSB7XG4gICAgICBpZiAobW9kZSA9PT0gZXhlY3V0aW9uTW9kZSkgcmV0dXJuIG1vZGVcbiAgICB9XG5cbiAgICB0aHJvdyBuZXcgRXJyb3IoYEludmFsaWQgYmFja2dyb3VuZCBqb2IgZXhlY3V0aW9uTW9kZTogJHtleGVjdXRpb25Nb2RlfWApXG4gIH1cblxuICAvKipcbiAgICogUnVucyB0cmFjayBwcm9jZXNzIGpvYi5cbiAgICogQHBhcmFtIHtQcm9taXNlPHZvaWQ+fSBwcm9jZXNzSm9iIC0gUHJvY2VzcyBqb2IgcHJvbWlzZS5cbiAgICogQHJldHVybnMge3ZvaWR9XG4gICAqL1xuICBfdHJhY2tQcm9jZXNzSm9iKHByb2Nlc3NKb2IpIHtcbiAgICAvKipcbiAgICAgKiBEZWZpbmVzIGluZmxpZ2h0LlxuICAgICAqIEB0eXBlIHtQcm9taXNlPHZvaWQ+fSAqL1xuICAgIGxldCBpbmZsaWdodFxuXG4gICAgaW5mbGlnaHQgPSBwcm9jZXNzSm9iLmZpbmFsbHkoKCkgPT4ge1xuICAgICAgdGhpcy5pbmZsaWdodFByb2Nlc3NKb2JzLmRlbGV0ZShpbmZsaWdodClcblxuICAgICAgLy8gUmUtYW5ub3VuY2UgcmVhZGluZXNzIG9uIEVWRVJZIGNvbXBsZXRpb24gdGhhdCBsZWF2ZXMgdXMgYmVsb3cgY2FwIOKAlCBub3RcbiAgICAgIC8vIGp1c3QgdGhlIHNpbmdsZSBjYXDihpJjYXAtMSBlZGdlLiBUaGUgbWFpbiByZW1vdmVzIGEgd29ya2VyIGZyb20gaXRzIHJlYWR5XG4gICAgICAvLyBzZXQgb24gZWFjaCBkaXNwYXRjaCAoYF9kcmFpbk9uY2VgKSBhbmQgb25seSByZS1hZGRzIGl0IG9uIGEgZnJlc2hcbiAgICAgIC8vIFwicmVhZHlcIjsgZ2F0aW5nIHRoZSByZS1hbm5vdW5jZSBvbiBvbmUga25pZmUtZWRnZSB0cmFuc2l0aW9uIG1lYW5zIGFcbiAgICAgIC8vIHNpbmdsZSBtaXNzZWQgb3IgbG9zdCBzaWduYWwgbGVhdmVzIHRoZSB3b3JrZXIgb3V0IG9mIHRoZSByZWFkeSBzZXQgYW5kXG4gICAgICAvLyB3ZWRnZXMgZGlzcGF0Y2ggY2x1c3Rlci13aWRlLiBUaGlzIHdhcyB0aGUgc2lsZW50LWZyZWV6ZSByb290IGNhdXNlLlxuICAgICAgLy8gYF9zZW5kUmVhZHlJZlJ1bm5pbmdgIHNlbGYtZ3VhcmRzIChpdCBzZW5kcyBub3RoaW5nIHdoZW4gdGhlIHdvcmtlciBpc1xuICAgICAgLy8gZ2VudWluZWx5IGF0IGNhcGFjaXR5KSwgc28gcmUtYW5ub3VuY2luZyBvbiBldmVyeSBmcmVlZCBzbG90IGlzIHNhZmUgYW5kXG4gICAgICAvLyBpZGVtcG90ZW50IG9uIHRoZSBtYWluLlxuICAgICAgaWYgKCF0aGlzLnNob3VsZFN0b3ApIHRoaXMuX3NlbmRSZWFkeUlmUnVubmluZygpXG4gICAgfSlcblxuICAgIHRoaXMuaW5mbGlnaHRQcm9jZXNzSm9icy5hZGQoaW5mbGlnaHQpXG4gICAgdGhpcy5fc2VuZFJlYWR5SWZSdW5uaW5nKClcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHJ1biBpbmxpbmUgam9iIGFuZCByZXBvcnQuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi90eXBlcy5qc1wiKS5CYWNrZ3JvdW5kSm9iUGF5bG9hZCAmIHtpZDogc3RyaW5nfX0gcGF5bG9hZCAtIFBheWxvYWQgd2l0aCByZXF1aXJlZCBpZC5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgd2hlbiBjb21wbGV0ZSAoc3VjY2VzcyBvciBmYWlsdXJlIHJlcG9ydGVkKS5cbiAgICovXG4gIGFzeW5jIF9ydW5JbmxpbmVKb2JBbmRSZXBvcnQocGF5bG9hZCkge1xuICAgIC8vIFJlcG9ydCBpbiB0aGUgYmFja2dyb3VuZCBzbyBmcmVlaW5nIHRoaXMgaW5saW5lIHNsb3QgbmV2ZXIgd2FpdHMgb24gdGhlXG4gICAgLy8gcmVwb3J0LiBSZXBvcnRpbmcgaXMgZHVyYWJsZSAocmV0cmllZCB1bnRpbCBpdCBsYW5kcyksIHNvIGEgdHJhbnNpZW50XG4gICAgLy8gbWFpbi9EQiBvdXRhZ2UgbmVpdGhlciB3ZWRnZXMgdGhlIHNsb3Qgbm9yIGxvc2VzIHRoZSB0ZXJtaW5hbCByZXN1bHQuXG4gICAgdHJ5IHtcbiAgICAgIGF3YWl0IHRoaXMuX3J1bkpvYklubGluZShwYXlsb2FkKVxuICAgICAgdGhpcy5fcmVwb3J0Sm9iUmVzdWx0SW5CYWNrZ3JvdW5kKHtcbiAgICAgICAgam9iSWQ6IHBheWxvYWQuaWQsXG4gICAgICAgIHN0YXR1czogXCJjb21wbGV0ZWRcIixcbiAgICAgICAgaGFuZG9mZklkOiBwYXlsb2FkLmhhbmRvZmZJZCxcbiAgICAgICAgaGFuZGVkT2ZmQXRNczogcGF5bG9hZC5oYW5kZWRPZmZBdE1zLFxuICAgICAgICB3b3JrZXJJZDogcGF5bG9hZC53b3JrZXJJZCB8fCB0aGlzLndvcmtlcklkXG4gICAgICB9KVxuICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICBpZiAoZXJyb3IgaW5zdGFuY2VvZiBCYWNrZ3JvdW5kSm9iUmVzY2hlZHVsZVNpZ25hbCkge1xuICAgICAgICB0aGlzLl9yZXBvcnRKb2JSZXN1bHRJbkJhY2tncm91bmQoe1xuICAgICAgICAgIGpvYklkOiBwYXlsb2FkLmlkLFxuICAgICAgICAgIHN0YXR1czogXCJyZXNjaGVkdWxlZFwiLFxuICAgICAgICAgIGRlbGF5TXM6IGVycm9yLmRlbGF5TXMsXG4gICAgICAgICAgaGFuZG9mZklkOiBwYXlsb2FkLmhhbmRvZmZJZCxcbiAgICAgICAgICBoYW5kZWRPZmZBdE1zOiBwYXlsb2FkLmhhbmRlZE9mZkF0TXMsXG4gICAgICAgICAgd29ya2VySWQ6IHBheWxvYWQud29ya2VySWQgfHwgdGhpcy53b3JrZXJJZFxuICAgICAgICB9KVxuICAgICAgICByZXR1cm5cbiAgICAgIH1cblxuICAgICAgdGhpcy5fcmVwb3J0Sm9iUmVzdWx0SW5CYWNrZ3JvdW5kKHtcbiAgICAgICAgam9iSWQ6IHBheWxvYWQuaWQsXG4gICAgICAgIHN0YXR1czogXCJmYWlsZWRcIixcbiAgICAgICAgZXJyb3IsXG4gICAgICAgIGhhbmRvZmZJZDogcGF5bG9hZC5oYW5kb2ZmSWQsXG4gICAgICAgIGhhbmRlZE9mZkF0TXM6IHBheWxvYWQuaGFuZGVkT2ZmQXRNcyxcbiAgICAgICAgd29ya2VySWQ6IHBheWxvYWQud29ya2VySWQgfHwgdGhpcy53b3JrZXJJZFxuICAgICAgfSlcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogQWR2ZXJ0aXNlcyBjdXJyZW50IHdvcmtlciBjYXBhY2l0eSB1bmxlc3MgdGhlIHdvcmtlciBpcyBkcmFpbmluZy5cbiAgICogQHBhcmFtIHtvYmplY3R9IFtvcHRpb25zXSAtIEFkdmVydGlzZW1lbnQgb3B0aW9ucy5cbiAgICogQHBhcmFtIHtib29sZWFufSBbb3B0aW9ucy5yZXZva2VQb29sZWRBZG1pc3Npb25dIC0gUmV2b2tlIHBvb2xlZCBjcmVkaXRzIHdoaWxlIHByZXNlcnZpbmcgb3RoZXIgZXhlY3V0aW9uIG1vZGVzLlxuICAgKiBAcmV0dXJucyB7dm9pZH1cbiAgICovXG4gIF9zZW5kUmVhZHlJZlJ1bm5pbmcoe3Jldm9rZVBvb2xlZEFkbWlzc2lvbiA9IGZhbHNlfSA9IHt9KSB7XG4gICAgaWYgKHRoaXMuc2hvdWxkU3RvcCB8fCB0aGlzLmlzUmV0aXJpbmcpIHJldHVyblxuICAgIGlmICghdGhpcy5qc29uU29ja2V0KSByZXR1cm5cbiAgICBpZiAodGhpcy5nZW5lcmF0aW9uSWQgJiYgIXRoaXMuX2dlbmVyYXRpb25BY2NlcHRlZCkgcmV0dXJuXG5cbiAgICBjb25zdCByZWFkeU1lc3NhZ2UgPSB0aGlzLl9yZWFkeU1lc3NhZ2Uoe3Jldm9rZVBvb2xlZEFkbWlzc2lvbn0pXG5cbiAgICBpZiAoIXJlYWR5TWVzc2FnZSkgcmV0dXJuXG4gICAgdGhpcy5qc29uU29ja2V0LnNlbmQocmVhZHlNZXNzYWdlKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgcmVhZHkgbWVzc2FnZS5cbiAgICogQHBhcmFtIHtvYmplY3R9IFtvcHRpb25zXSAtIEFkdmVydGlzZW1lbnQgb3B0aW9ucy5cbiAgICogQHBhcmFtIHtib29sZWFufSBbb3B0aW9ucy5yZXZva2VQb29sZWRBZG1pc3Npb25dIC0gUmV2b2tlIHBvb2xlZCBjcmVkaXRzIHdoaWxlIHByZXNlcnZpbmcgb3RoZXIgZXhlY3V0aW9uIG1vZGVzLlxuICAgKiBAcmV0dXJucyB7aW1wb3J0KFwiLi90eXBlcy5qc1wiKS5CYWNrZ3JvdW5kSm9iU29ja2V0TWVzc2FnZSB8IG51bGx9IC0gUmVhZHkgbWVzc2FnZSBvciBudWxsIHdoZW4gdGhlIHdvcmtlciBoYXMgbm8gY2FwYWNpdHkuXG4gICAqL1xuICBfcmVhZHlNZXNzYWdlKHtyZXZva2VQb29sZWRBZG1pc3Npb24gPSBmYWxzZX0gPSB7fSkge1xuICAgIGNvbnN0IGFjY2VwdHNQcm9jZXNzSm9iID0gdGhpcy5pbmZsaWdodFByb2Nlc3NKb2JzLnNpemUgPCB0aGlzLm1heENvbmN1cnJlbnRGb3JrZWRKb2JzXG4gICAgY29uc3QgYWNjZXB0c0lubGluZSA9IHRoaXMuaW5mbGlnaHRJbmxpbmVKb2JzLnNpemUgPCB0aGlzLm1heENvbmN1cnJlbnRJbmxpbmVKb2JzXG4gICAgY29uc3QgYXZhaWxhYmxlUG9vbGVkU2xvdHMgPSByZXZva2VQb29sZWRBZG1pc3Npb24gPyAwIDogdGhpcy5fYXZhaWxhYmxlUG9vbGVkU2xvdHMoKVxuICAgIGNvbnN0IGFjY2VwdHNQb29sZWQgPSBhdmFpbGFibGVQb29sZWRTbG90cyA+IDBcblxuICAgIGlmICghcmV2b2tlUG9vbGVkQWRtaXNzaW9uICYmICFhY2NlcHRzUHJvY2Vzc0pvYiAmJiAhYWNjZXB0c0lubGluZSAmJiAhYWNjZXB0c1Bvb2xlZCkgcmV0dXJuIG51bGxcblxuICAgIHJldHVybiB7XG4gICAgICB0eXBlOiBcInJlYWR5XCIsXG4gICAgICBhY2NlcHRzRm9ya2VkOiBhY2NlcHRzUHJvY2Vzc0pvYixcbiAgICAgIGFjY2VwdHNJbmxpbmUsXG4gICAgICBhY2NlcHRzUG9vbGVkLFxuICAgICAgYXZhaWxhYmxlUG9vbGVkU2xvdHMsXG4gICAgICBhY2NlcHRzU3Bhd25lZDogYWNjZXB0c1Byb2Nlc3NKb2JcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogVHJhY2tzIGEgcG9vbGVkIGpvYiBhbmQgcmUtYWR2ZXJ0aXNlcyBjYXBhY2l0eS5cbiAgICogQHBhcmFtIHtQcm9taXNlPHZvaWQ+fSBwb29sZWRKb2IgLSBQb29sZWQgam9iIHByb21pc2UuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFRoZSB0cmFja2VkIGluLWZsaWdodCBwcm9taXNlLlxuICAgKi9cbiAgX3RyYWNrUG9vbGVkSm9iKHBvb2xlZEpvYikge1xuICAgIC8qKiBAdHlwZSB7UHJvbWlzZTx2b2lkPn0gKi9cbiAgICBsZXQgaW5mbGlnaHRcbiAgICBpbmZsaWdodCA9IHBvb2xlZEpvYi5maW5hbGx5KCgpID0+IHtcbiAgICAgIHRoaXMuaW5mbGlnaHRQb29sZWRKb2JzLmRlbGV0ZShpbmZsaWdodClcbiAgICAgIGlmICghdGhpcy5zaG91bGRTdG9wICYmICF0aGlzLl9wb29sZWRTdGFydHVwRmFpbHVyZUpvYnMuaGFzKHBvb2xlZEpvYikgJiYgIXRoaXMuX3Bvb2xlZFN0YXJ0dXBGYWlsdXJlSm9icy5oYXMoaW5mbGlnaHQpKSB0aGlzLl9zZW5kUmVhZHlJZlJ1bm5pbmcoKVxuICAgIH0pXG4gICAgdGhpcy5pbmZsaWdodFBvb2xlZEpvYnMuYWRkKGluZmxpZ2h0KVxuICAgIHJldHVybiBpbmZsaWdodFxuICB9XG5cbiAgLyoqXG4gICAqIFNlcmlhbGl6ZXMgcmVwZWF0ZWQgbGVhc2VzIGZvciBvbmUgZHVyYWJsZSByb3cgd2hpbGUgcHJlc2VydmluZyBwb29sZWRcbiAgICogY29uY3VycmVuY3kgYWNyb3NzIGRpZmZlcmVudCBqb2IgaWRzLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vdHlwZXMuanNcIikuQmFja2dyb3VuZEpvYlBheWxvYWQgJiB7aWQ6IHN0cmluZ319IHBheWxvYWQgLSBQb29sZWQgam9iIHBheWxvYWQuXG4gICAqIEByZXR1cm5zIHt2b2lkfVxuICAgKi9cbiAgX3F1ZXVlUG9vbGVkSm9iKHBheWxvYWQpIHtcbiAgICBjb25zdCBxdWV1ZSA9IHRoaXMucG9vbGVkSm9iUXVldWVzLmdldChwYXlsb2FkLmlkKVxuICAgIGlmIChxdWV1ZSkge1xuICAgICAgcXVldWUucHVzaChwYXlsb2FkKVxuICAgICAgcmV0dXJuXG4gICAgfVxuXG4gICAgdGhpcy5wb29sZWRKb2JRdWV1ZXMuc2V0KHBheWxvYWQuaWQsIFtwYXlsb2FkXSlcbiAgICBjb25zdCB0cmFja2VyID0gdGhpcy5fdHJhY2tQb29sZWRKb2IodGhpcy5fcnVuUG9vbGVkSm9iUXVldWUocGF5bG9hZC5pZCkpXG4gICAgdGhpcy5wb29sZWRKb2JRdWV1ZVRyYWNrZXJzLnNldChwYXlsb2FkLmlkLCB0cmFja2VyKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgYWRtaXR0ZWQgbGVhc2VzIGZvciBvbmUgZHVyYWJsZSBqb2IgaWQgaW4gYXJyaXZhbCBvcmRlci5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGpvYklkIC0gRHVyYWJsZSBqb2IgaWQuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIGFmdGVyIHRoZSBwZXItaWQgcXVldWUgZHJhaW5zLlxuICAgKi9cbiAgYXN5bmMgX3J1blBvb2xlZEpvYlF1ZXVlKGpvYklkKSB7XG4gICAgY29uc3QgcXVldWUgPSB0aGlzLnBvb2xlZEpvYlF1ZXVlcy5nZXQoam9iSWQpXG4gICAgaWYgKCFxdWV1ZSkgdGhyb3cgbmV3IEVycm9yKGBQb29sZWQgam9iIHF1ZXVlIG1pc3NpbmcgZm9yIGpvYjogJHtqb2JJZH1gKVxuXG4gICAgdHJ5IHtcbiAgICAgIHdoaWxlIChxdWV1ZS5sZW5ndGggPiAwKSB7XG4gICAgICAgIGNvbnN0IHBheWxvYWQgPSBxdWV1ZS5zaGlmdCgpXG4gICAgICAgIGlmICghcGF5bG9hZCkgdGhyb3cgbmV3IEVycm9yKGBQb29sZWQgam9iIHF1ZXVlIGNvbnRhaW5lZCBhbiBlbXB0eSBwYXlsb2FkIGZvciBqb2I6ICR7am9iSWR9YClcbiAgICAgICAgYXdhaXQgdGhpcy5fcnVuUG9vbGVkSm9iKHBheWxvYWQpXG4gICAgICB9XG4gICAgfSBmaW5hbGx5IHtcbiAgICAgIGNvbnN0IHRyYWNrZXIgPSB0aGlzLnBvb2xlZEpvYlF1ZXVlVHJhY2tlcnMuZ2V0KGpvYklkKVxuICAgICAgaWYgKHRyYWNrZXIpIHtcbiAgICAgICAgdGhpcy5pbmZsaWdodFBvb2xlZEpvYnMuZGVsZXRlKHRyYWNrZXIpXG4gICAgICAgIHRoaXMucG9vbGVkSm9iUXVldWVUcmFja2Vycy5kZWxldGUoam9iSWQpXG4gICAgICB9XG4gICAgICB0aGlzLnBvb2xlZEpvYlF1ZXVlcy5kZWxldGUoam9iSWQpXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIEhhcmQgY2FwIG9uIHRvdGFsIGxpdmUgcG9vbGVkIGNoaWxkcmVuICh3b3JraW5nICsgZHJhaW5pbmcpOiBjaGlsZHJlbiB0aGVcbiAgICogcG9vbCBtYXkgc3RpbGwgc3Bhd24uIENvdW50aW5nIHRoZSB3aG9sZSBsaXZlIHNldCDigJQgZHJhaW5pbmcgY2hpbGRyZW5cbiAgICogaW5jbHVkZWQg4oCUIGlzIHdoYXQgYm91bmRzIHBvb2wgbWVtb3J5OiBhIGRyYWluaW5nIGNoaWxkIHN0aWxsIGhvbGRzIGl0c1xuICAgKiBSU1MgdW50aWwgaXRzIGxhc3QgaW4tZmxpZ2h0IGpvYiBmaW5pc2hlcywgc28gaXQgbXVzdCBvY2N1cHkgYSBjYXAgc2xvdC5cbiAgICogQHJldHVybnMge251bWJlcn0gLSBOdW1iZXIgb2YgY2hpbGRyZW4gdGhlIHBvb2wgbWF5IHN0aWxsIHNwYXduLlxuICAgKi9cbiAgX3NwYXduYWJsZVBvb2xlZENoaWxkcmVuKCkge1xuICAgIHJldHVybiBNYXRoLm1heCgwLCB0aGlzLnBvb2xlZFJ1bm5lckNvdW50IC0gdGhpcy5wb29sZWRDaGlsZHJlbi5zaXplKVxuICB9XG5cbiAgLyoqXG4gICAqIENvdW50cyBsaXZlIGNoaWxkcmVuIHN0aWxsIGFibGUgdG8gcnVuIG5ldyB3b3JrLiBUaGUgcG9vbCBtdXN0IGFsd2F5c1xuICAgKiBrZWVwIOKAlCBvciByZXN0b3JlLCB0aHJvdWdoIHRoZSBib3VuZGVkIG92ZXItY2FwIGxpdmVuZXNzIHJlcGxhY2VtZW50IOKAlCBhdFxuICAgKiBsZWFzdCBvbmUgbm9uLXJldGlyaW5nIGNoaWxkOiB3aXRoIGV2ZXJ5IGxpdmUgY2hpbGQgcmV0aXJpbmcsIGFkdmVydGlzZWRcbiAgICogY2FwYWNpdHkgaXMgemVybyBmb3IgdGhlIGVudGlyZSBkcmFpbiB3aW5kb3csIHdoaWNoIGNhbiBzdHJldGNoIHRvIHRoZVxuICAgKiBsb25nZXN0IGluLWZsaWdodCBqb2IsIGFuZCBkaXNwYXRjaCBzaWxlbnRseSBzdGFsbHMuXG4gICAqIEByZXR1cm5zIHtudW1iZXJ9IC0gTnVtYmVyIG9mIG5vbi1yZXRpcmluZyBwb29sZWQgY2hpbGRyZW4uXG4gICAqL1xuICBfbm9uUmV0aXJpbmdQb29sZWRDaGlsZENvdW50KCkge1xuICAgIGxldCBjb3VudCA9IDBcblxuICAgIGZvciAoY29uc3Qgc3RhdGUgb2YgdGhpcy5wb29sZWRDaGlsZFN0YXRlcy52YWx1ZXMoKSkge1xuICAgICAgaWYgKCFzdGF0ZS5yZXRpcmluZykgY291bnQgKz0gMVxuICAgIH1cblxuICAgIHJldHVybiBjb3VudFxuICB9XG5cbiAgLyoqXG4gICAqIFJlc29sdmVzIG9uY2UgYSBub24tcmV0aXJpbmcgcG9vbGVkIGNoaWxkIGhhcyBhIGZyZWUgY29uY3VycmVuY3kgc2xvdCBvciB0aGVcbiAgICogcG9vbCBtYXkgc3Bhd24gYSBuZXcgb25lLiBQb29sZWQgam9icyBhZG1pdHRlZCB3aGlsZSB0aGUgcG9vbCBpcyBhdCBpdHNcbiAgICogaGFyZCBjYXAgd2FpdCBoZXJlIGluc3RlYWQgb2Ygc3Bhd25pbmcgYW4gb3Zlci1jYXBhY2l0eSBjaGlsZDsgdGhlIHdha2VcbiAgICogcG9pbnRzIGFyZSB0aGUgb25seSBjYXBhY2l0eS1mcmVlaW5nIHRyYW5zaXRpb25zIChhIGpvYiBvdXRjb21lIGFuZCBhIGNoaWxkXG4gICAqIGV4aXQpLCBzbyBubyBwb2xsaW5nIGlzIG5lZWRlZC5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgd2hlbiBhIHNsb3QgaXMgYXZhaWxhYmxlLlxuICAgKi9cbiAgX3dhaXRQb29sZWRTbG90KCkge1xuICAgIHRoaXMuX3N0YXJ0UG9vbGVkU2xvdFdhaXRQb2xsKClcblxuICAgIHJldHVybiBuZXcgUHJvbWlzZSgocmVzb2x2ZSkgPT4ge1xuICAgICAgY29uc3Qgd2FpdGVyID0gKCkgPT4ge1xuICAgICAgICB0aGlzLl9wb29sZWRTbG90V2FpdGVycy5kZWxldGUod2FpdGVyKVxuICAgICAgICB0aGlzLl9zdG9wUG9vbGVkU2xvdFdhaXRQb2xsSWZJZGxlKClcbiAgICAgICAgcmVzb2x2ZSgpXG4gICAgICB9XG5cbiAgICAgIHRoaXMuX3Bvb2xlZFNsb3RXYWl0ZXJzLmFkZCh3YWl0ZXIpXG4gICAgfSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSZXNvbHZlcyBldmVyeSByZWdpc3RlcmVkIHdhaXRlcjsgd2FpdGVycyByZS1jaGVjayB0aGUgc2xvdCBjb25kaXRpb25cbiAgICogdGhlbXNlbHZlcyBhbmQgb25seSBwcm9jZWVkIHdoZW4gaXQgaG9sZHMuXG4gICAqIEByZXR1cm5zIHt2b2lkfVxuICAgKi9cbiAgX3dha2VQb29sZWRTbG90V2FpdGVycygpIHtcbiAgICBpZiAodGhpcy5fcG9vbGVkU2xvdFdhaXRlcnMuc2l6ZSA9PT0gMCkgcmV0dXJuXG5cbiAgICBmb3IgKGNvbnN0IHJlc29sdmUgb2YgWy4uLnRoaXMuX3Bvb2xlZFNsb3RXYWl0ZXJzXSkgcmVzb2x2ZSgpXG4gIH1cblxuICAvKipcbiAgICogRnJlZSBwb29sZWQgc2xvdHMgYWNyb3NzIHRoZSBwb29sOiBvcGVuIHNsb3RzIGluIG5vbi1yZXRpcmluZyBjaGlsZHJlbiBwbHVzXG4gICAqIHRoZSBzbG90cyB3ZSBjb3VsZCBhZGQgYnkgc3Bhd25pbmcgbW9yZSBjaGlsZHJlbiB1cCB0byB0aGUgaGFyZCBjYXAgb24gdG90YWxcbiAgICogbGl2ZSBjaGlsZHJlbi4gUmV0aXJpbmcgY2hpbGRyZW4gKGRyYWluaW5nIGJlZm9yZSByZXBsYWNlbWVudCkgbmV2ZXJcbiAgICogY29udHJpYnV0ZSBjYXBhY2l0eSwgYW5kIHRoZXkgY291bnQgYWdhaW5zdCB0aGUgY2FwOiB3aGlsZSBvbmUgaXMgc3RpbGxcbiAgICogZHJhaW5pbmcsIG5vIHJlcGxhY2VtZW50IGlzIGFkdmVydGlzZWQgKG9yIHNwYXduZWQpIOKAlCB0aGUgcG9vbCBhZHZlcnRpc2VzXG4gICAqIGV4YWN0bHkgd2hhdCBpdCBjYW4gc2VydmUgaW5zdGVhZCBvZiBwaGFudG9tIGNhcGFjaXR5LlxuICAgKiBAcmV0dXJucyB7bnVtYmVyfSAtIE51bWJlciBvZiBwb29sZWQgam9icyB0aGUgd29ya2VyIGNhbiBhY2NlcHQgcmlnaHQgbm93LlxuICAgKi9cbiAgX2F2YWlsYWJsZVBvb2xlZFNsb3RzKCkge1xuICAgIGxldCBvcGVuSW5FeGlzdGluZyA9IDBcbiAgICBsZXQgcXVldWVkUmVzZXJ2YXRpb25zID0gMFxuXG4gICAgZm9yIChjb25zdCBjaGlsZCBvZiB0aGlzLnBvb2xlZENoaWxkcmVuKSB7XG4gICAgICBjb25zdCBzdGF0ZSA9IHRoaXMucG9vbGVkQ2hpbGRTdGF0ZXMuZ2V0KGNoaWxkKVxuICAgICAgaWYgKCFzdGF0ZSB8fCBzdGF0ZS5yZXRpcmluZykgY29udGludWVcbiAgICAgIG9wZW5JbkV4aXN0aW5nICs9IHRoaXMucG9vbGVkUnVubmVyQ29uY3VycmVuY3kgLSBzdGF0ZS5pbmZsaWdodC5zaXplXG4gICAgfVxuXG4gICAgZm9yIChjb25zdCBxdWV1ZSBvZiB0aGlzLnBvb2xlZEpvYlF1ZXVlcy52YWx1ZXMoKSkgcXVldWVkUmVzZXJ2YXRpb25zICs9IHF1ZXVlLmxlbmd0aFxuXG4gICAgY29uc3Qgc3Bhd25hYmxlQ2hpbGRyZW4gPSBNYXRoLm1heCgwLCB0aGlzLnBvb2xlZFJ1bm5lckNvdW50IC0gdGhpcy5wb29sZWRDaGlsZHJlbi5zaXplKVxuXG4gICAgcmV0dXJuIE1hdGgubWF4KDAsIG9wZW5JbkV4aXN0aW5nICsgc3Bhd25hYmxlQ2hpbGRyZW4gKiB0aGlzLnBvb2xlZFJ1bm5lckNvbmN1cnJlbmN5IC0gcXVldWVkUmVzZXJ2YXRpb25zKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgYSBwYXlsb2FkIG9uIGEgcG9vbGVkIGNoaWxkIHdpdGggYSBmcmVlIGNvbmN1cnJlbmN5IHNsb3QsIHNwYXduaW5nIGFcbiAgICogbmV3IGNoaWxkIHdoZW4gZXZlcnkgbm9uLXJldGlyaW5nIGNoaWxkIGlzIGZ1bGwgYW5kIHRoZSBwb29sIGlzIGJlbG93XG4gICAqIGBwb29sZWRSdW5uZXJDb3VudGAuIEVhY2ggY2hpbGQgcnVucyB1cCB0byBgcG9vbGVkUnVubmVyQ29uY3VycmVuY3lgIGpvYnMgYXRcbiAgICogb25jZSBvbiBpdHMgb3duIGV2ZW50IGxvb3AuXG4gICAqXG4gICAqIFdoZW4gdGhlIHBvb2wgaXMgYWxyZWFkeSBhdCBpdHMgaGFyZCBjYXAgKHRvdGFsIGxpdmUgY2hpbGRyZW4sIGRyYWluaW5nXG4gICAqIGluY2x1ZGVkKSwgdGhlIGpvYiB3YWl0cyBmb3IgYSBzbG90IGluc3RlYWQgb2Ygc3Bhd25pbmc6IHRoYXQgaXMgd2hhdCBrZWVwc1xuICAgKiB0aGUgbGl2ZS1jaGlsZCBjb3VudCDigJQgYW5kIHRoZXJlZm9yZSB0aGUgcG9vbCdzIHRvdGFsIFJTUyDigJQgYm91bmRlZC4gVGhlXG4gICAqIHdhaXQgcmVzb2x2ZXMgb24gdGhlIG9ubHkgdHdvIGNhcGFjaXR5LWZyZWVpbmcgdHJhbnNpdGlvbnMgKGEgam9iIG91dGNvbWUsXG4gICAqIGEgY2hpbGQgZXhpdCk7IGEgc2FmZXR5IHBvbGwgY292ZXJzIGFueXRoaW5nIG1pc3NlZC5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL3R5cGVzLmpzXCIpLkJhY2tncm91bmRKb2JQYXlsb2FkICYge2lkOiBzdHJpbmd9fSBwYXlsb2FkIC0gSm9iIHBheWxvYWQuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIGFmdGVyIHRoZSBkdXJhYmxlIHJlcG9ydC5cbiAgICovXG4gIGFzeW5jIF9ydW5Qb29sZWRKb2IocGF5bG9hZCkge1xuICAgIC8vIEF0IHRoZSBoYXJkIGNhcCAobm8gZnJlZSBzbG90LCBubyBzcGF3bmFibGUgY2hpbGQpIHRoZSBqb2Igd2FpdHMgZm9yIGFcbiAgICAvLyBzbG90IGluc3RlYWQgb2Ygc3Bhd25pbmcgYW4gb3Zlci1jYXBhY2l0eSBjaGlsZCDigJQgdGhhdCBpcyB3aGF0IGJvdW5kc1xuICAgIC8vIHRoZSBsaXZlLWNoaWxkIGNvdW50IGFuZCB0aGUgcG9vbCdzIHRvdGFsIFJTUy5cbiAgICBsZXQgY2hpbGQgPSB0aGlzLl9zZWxlY3RQb29sZWRDaGlsZCgpXG4gICAgd2hpbGUgKCFjaGlsZCkge1xuICAgICAgaWYgKHRoaXMuX3NwYXduYWJsZVBvb2xlZENoaWxkcmVuKCkgPT09IDApIHtcbiAgICAgICAgLy8gU2h1dGRvd246IG1haW4gbm8gbG9uZ2VyIGRpc3BhdGNoZXMgYW5kIG5vIHNsb3Qgd2lsbCBldmVyIGZyZWUg4oCUXG4gICAgICAgIC8vIHN0b3Agd2FpdGluZyBzbyB0aGUgdHJhY2tlZCBqb2IgY2FuIHNldHRsZSBhbmQgdGhlIGRyYWluIGNvbXBsZXRlcy5cbiAgICAgICAgaWYgKHRoaXMuc2hvdWxkU3RvcCkgcmV0dXJuXG4gICAgICAgIGF3YWl0IHRoaXMuX3dhaXRQb29sZWRTbG90KClcbiAgICAgICAgY2hpbGQgPSB0aGlzLl9zZWxlY3RQb29sZWRDaGlsZCgpXG4gICAgICAgIGNvbnRpbnVlXG4gICAgICB9XG4gICAgICBjaGlsZCA9IHRoaXMuX3NlbGVjdFBvb2xlZENoaWxkKCkgfHwgdGhpcy5fY3JlYXRlUG9vbGVkQ2hpbGQoKVxuICAgIH1cblxuICAgIGNvbnN0IHN0YXRlID0gdGhpcy5wb29sZWRDaGlsZFN0YXRlcy5nZXQoY2hpbGQpXG4gICAgaWYgKCFzdGF0ZSkgdGhyb3cgbmV3IEVycm9yKFwiUG9vbGVkIHJ1bm5lciBzdGF0ZSBtaXNzaW5nXCIpXG5cbiAgICAvLyBTdGFtcCB0aGUgcm91bmQtcm9iaW4gY3Vyc29yIHNvIHRoZSBuZXh0IGRpc3BhdGNoIHByZWZlcnMgYSBkaWZmZXJlbnQgY2hpbGQuXG4gICAgc3RhdGUubGFzdERpc3BhdGNoU2VxID0gKyt0aGlzLl9wb29sZWREaXNwYXRjaFNlcVxuXG4gICAgLyoqXG4gICAgICogUmVzb2x2ZXMgdGhlIHBvb2xlZCBqb2IgcHJvbWlzZS5cbiAgICAgKiBAdHlwZSB7KHZhbHVlOiB2b2lkKSA9PiB2b2lkfVxuICAgICAqL1xuICAgIGxldCByZXNvbHZlUG9vbGVkSm9iID0gKCkgPT4ge31cbiAgICBjb25zdCBwb29sZWRKb2IgPSBuZXcgUHJvbWlzZSgocmVzb2x2ZSkgPT4geyByZXNvbHZlUG9vbGVkSm9iID0gcmVzb2x2ZSB9KVxuICAgIGNvbnN0IHRpbWVvdXRUaW1lciA9IHRoaXMuX2FybVBvb2xlZEpvYlRpbWVvdXQoe2NoaWxkLCBwYXlsb2FkfSlcblxuICAgIHN0YXRlLmluZmxpZ2h0LnNldChwYXlsb2FkLmlkLCB7cGF5bG9hZCwgcmVzb2x2ZTogcmVzb2x2ZVBvb2xlZEpvYiwgcG9vbGVkSm9iLCB0aW1lb3V0VGltZXJ9KVxuICAgIHRyeSB7XG4gICAgICBjaGlsZC5zZW5kKHt0eXBlOiBcImpvYlwiLCBwYXlsb2FkLCBzaGFyZWRUcmFuc2FjdGlvbkJyb2tlcjogdGhpcy5fcG9vbGVkSm9iU2hhcmVkVHJhbnNhY3Rpb25Ccm9rZXJDb25maWcoKX0pXG4gICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgIHZvaWQgdGhpcy5faGFuZGxlUG9vbGVkQ2hpbGRGYWlsdXJlKHtjaGlsZCwgZXJyb3IsIG9yaWdpbjogXCJpcGMtc2VuZFwifSlcbiAgICB9XG5cbiAgICByZXR1cm4gcG9vbGVkSm9iXG4gIH1cblxuICAvKipcbiAgICogQ2FwdHVyZXMgdGhlIGN1cnJlbnQgdGVzdCBhdHRlbXB0J3MgYnJva2VyIG1vZGUgYXQgZGlzcGF0Y2ggdGltZS4gQSB3YXJtXG4gICAqIHBvb2xlZCBjaGlsZCBtdXN0IG5ldmVyIHJlbHkgb24gaXRzIGltbXV0YWJsZSBmb3JrLXRpbWUgZW52aXJvbm1lbnQuXG4gICAqIEByZXR1cm5zIHtpbXBvcnQoXCIuLi90ZXN0aW5nL3NoYXJlZC10cmFuc2FjdGlvbi1wcm94eS1kcml2ZXIuanNcIikuU2hhcmVkVHJhbnNhY3Rpb25Ccm9rZXJKb2JDb25maWd9IC0gUGVyLWpvYiBicm9rZXIgY29uZmlndXJhdGlvbi5cbiAgICovXG4gIF9wb29sZWRKb2JTaGFyZWRUcmFuc2FjdGlvbkJyb2tlckNvbmZpZygpIHtcbiAgICBjb25zdCBzZXJpYWxpemVkID0gcHJvY2Vzcy5lbnYuVkVMT0NJT1VTX1RFU1RfU0hBUkVEX1RSQU5TQUNUSU9OX0JST0tFUlxuICAgIGlmICghc2VyaWFsaXplZCkgcmV0dXJuIHtleHBlY3RlZDogZmFsc2V9XG5cbiAgICBjb25zdCBjb25maWcgPSBKU09OLnBhcnNlKEJ1ZmZlci5mcm9tKHNlcmlhbGl6ZWQsIFwiYmFzZTY0dXJsXCIpLnRvU3RyaW5nKFwidXRmOFwiKSlcbiAgICByZXR1cm4gey4uLmNvbmZpZywgZXhwZWN0ZWQ6IHRydWV9XG4gIH1cblxuICAvKipcbiAgICogU2VsZWN0cyBhIHBvb2xlZCBjaGlsZCB0byBydW4gdGhlIG5leHQgam9iLCBvciB1bmRlZmluZWQgd2hlbiBldmVyeSBub24tcmV0aXJpbmdcbiAgICogY2hpbGQgaXMgYWxyZWFkeSBmdWxsICh0aGUgY2FsbGVyIHRoZW4gbGF6aWx5IHNwYXducyBvbmUpLiBBbW9uZyBjaGlsZHJlbiB3aXRoIGFcbiAgICogZnJlZSBjb25jdXJyZW5jeSBzbG90LCBwaWNrcyB0aGUgb25lIGRpc3BhdGNoZWQgbGVhc3QgcmVjZW50bHkg4oCUIGEgcm91bmQtcm9iaW4gdGhhdFxuICAgKiBzcHJlYWRzIGpvYnMgKG5vdGFibHkgbXVsdGktbWludXRlIFJ1bkJ1aWxkSm9icywgZWFjaCBwaW5uaW5nIGEgdGVuYW50IGNvbm5lY3Rpb25cbiAgICogZm9yIGl0cyB3aG9sZSBydW4pIGV2ZW5seSBhY3Jvc3MgY2hpbGRyZW4gaW5zdGVhZCBvZiBmaXJzdC1maXQgcGFja2luZyB0aGUgZWFybGllc3RcbiAgICogb25lIHVudGlsIGl0IGlzIGZ1bGwuIEEgZnJlc2hseSBzcGF3bmVkIG9yIHJlcGxhY2VtZW50IGNoaWxkIHRoZXJlZm9yZSB0YWtlcyBpdHNcbiAgICogZmFpciBzaGFyZSBvbmUgam9iIGF0IGEgdGltZSBhcyBpdHMgdHVybiBjb21lcyB1cCwgcmF0aGVyIHRoYW4gYWJzb3JiaW5nIGEgYnVyc3QgdG9cbiAgICogXCJjYXRjaCB1cFwiIHRvIHRoZSBvdGhlcnMuXG4gICAqIEByZXR1cm5zIHtpbXBvcnQoXCJub2RlOmNoaWxkX3Byb2Nlc3NcIikuQ2hpbGRQcm9jZXNzIHwgdW5kZWZpbmVkfSAtIFRoZSBjaG9zZW4gY2hpbGQsIG9yIHVuZGVmaW5lZCB3aGVuIGFsbCBub24tcmV0aXJpbmcgY2hpbGRyZW4gYXJlIGZ1bGwuXG4gICAqL1xuICBfc2VsZWN0UG9vbGVkQ2hpbGQoKSB7XG4gICAgLyoqIEB0eXBlIHtpbXBvcnQoXCJub2RlOmNoaWxkX3Byb2Nlc3NcIikuQ2hpbGRQcm9jZXNzIHwgdW5kZWZpbmVkfSAqL1xuICAgIGxldCBzZWxlY3RlZFxuICAgIGxldCBzZWxlY3RlZFNlcSA9IEluZmluaXR5XG5cbiAgICBmb3IgKGNvbnN0IGNoaWxkIG9mIHRoaXMucG9vbGVkQ2hpbGRyZW4pIHtcbiAgICAgIGNvbnN0IHN0YXRlID0gdGhpcy5wb29sZWRDaGlsZFN0YXRlcy5nZXQoY2hpbGQpXG5cbiAgICAgIGlmICghc3RhdGUgfHwgc3RhdGUucmV0aXJpbmcgfHwgc3RhdGUuaW5mbGlnaHQuc2l6ZSA+PSB0aGlzLnBvb2xlZFJ1bm5lckNvbmN1cnJlbmN5KSBjb250aW51ZVxuXG4gICAgICBpZiAoc3RhdGUubGFzdERpc3BhdGNoU2VxIDwgc2VsZWN0ZWRTZXEpIHtcbiAgICAgICAgc2VsZWN0ZWQgPSBjaGlsZFxuICAgICAgICBzZWxlY3RlZFNlcSA9IHN0YXRlLmxhc3REaXNwYXRjaFNlcVxuICAgICAgfVxuICAgIH1cblxuICAgIHJldHVybiBzZWxlY3RlZFxuICB9XG5cbiAgLyoqXG4gICAqIEFybXMgYSBwZXItam9iIHdhbGwtY2xvY2sgYmFja3N0b3AgZm9yIGEgcG9vbGVkIGpvYi4gQSBwb29sZWQgY2hpbGQgaG9zdHMgbWFueVxuICAgKiBjb25jdXJyZW50IGpvYnMsIHNvIGEgc2luZ2xlIGdlbnVpbmVseS1odW5nIGpvYiB3b3VsZCBvdGhlcndpc2UgcGluIGl0c1xuICAgKiBydW5uZXIncyBjb25jdXJyZW5jeSBzbG90IGZvcmV2ZXIg4oCUIHRoZSBsaWZldGltZSByZWN5Y2xlIG9ubHkgcmV0aXJlcyBhIGNoaWxkXG4gICAqIG9uY2UgaXRzIGluLWZsaWdodCBzZXQgZHJhaW5zLCB3aGljaCBhIGh1bmcgam9iIG5ldmVyIGRvZXMuIE9uIG92ZXJydW4gdGhlXG4gICAqIHdob2xlIGNoaWxkIGlzIHRlcm1pbmF0ZWQgc28gdGhlIGh1bmcgam9iIChhbmQgaXRzIHNpYmxpbmdzKSByZXF1ZXVlLiBSZXR1cm5zXG4gICAqIHRoZSB0aW1lciwgb3IgbnVsbCB3aGVuIG5vIHRpbWVvdXQgaXMgY29uZmlndXJlZC5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBPcHRpb25zLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIm5vZGU6Y2hpbGRfcHJvY2Vzc1wiKS5DaGlsZFByb2Nlc3N9IGFyZ3MuY2hpbGQgLSBQb29sZWQgY2hpbGQuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi90eXBlcy5qc1wiKS5CYWNrZ3JvdW5kSm9iUGF5bG9hZCAmIHtpZDogc3RyaW5nfX0gYXJncy5wYXlsb2FkIC0gSm9iIHBheWxvYWQgd2hvc2Ugb3ZlcnJ1biBpcyBndWFyZGVkLlxuICAgKiBAcmV0dXJucyB7UmV0dXJuVHlwZTx0eXBlb2Ygc2V0VGltZW91dD4gfCBudWxsfSAtIFRoZSBhcm1lZCB0aW1lciwgb3IgbnVsbC5cbiAgICovXG4gIF9hcm1Qb29sZWRKb2JUaW1lb3V0KHtjaGlsZCwgcGF5bG9hZH0pIHtcbiAgICBjb25zdCB0aW1lb3V0TXMgPSB0aGlzLl9yZXNvbHZlSm9iVGltZW91dE1zKHBheWxvYWQub3B0aW9ucylcblxuICAgIGlmICghKHR5cGVvZiB0aW1lb3V0TXMgPT09IFwibnVtYmVyXCIgJiYgdGltZW91dE1zID4gMCkpIHJldHVybiBudWxsXG5cbiAgICByZXR1cm4gc2V0VGltZW91dCgoKSA9PiB0aGlzLl9vblBvb2xlZEpvYlRpbWVvdXQoe2NoaWxkLCBqb2JJZDogcGF5bG9hZC5pZH0pLCB0aW1lb3V0TXMpXG4gIH1cblxuICAvKipcbiAgICogRmlyZWQgd2hlbiBhIHBvb2xlZCBqb2Igb3ZlcnJ1bnMgaXRzIHRpbWVvdXQuIFRlcm1pbmF0ZXMgdGhlIGNoaWxkIHJ1bm5pbmcgaXRcbiAgICogKFNJR1RFUk0sIHRoZW4gU0lHS0lMTCBhZnRlciB0aGUgZ3JhY2UpIOKAlCBhIGh1bmcgSlMgam9iIGNhbm5vdCBiZSBjYW5jZWxsZWRcbiAgICogYW55IG90aGVyIHdheS4gVGhlIG5vbi1jbGVhbiBleGl0IGZsb3dzIHRocm91Z2ggYF9oYW5kbGVQb29sZWRDaGlsZEZhaWx1cmVgLFxuICAgKiB3aGljaCByZXBvcnRzIGV2ZXJ5IGluLWZsaWdodCBqb2Igb24gdGhlIGNoaWxkIGZhaWxlZCAoc28gdGhleSByZXF1ZXVlKSBhbmRcbiAgICogZHJvcHMgaXQgZnJvbSB0cmFja2luZzsgdGhlIGZhaWx1cmUgcGF0aCBpbW1lZGlhdGVseSByZS1hZHZlcnRpc2VzIHRoZVxuICAgKiByZXN1bHRpbmcgY2FwYWNpdHkgb25jZSB0aGUgcnVubmVyIGhhcyBjb21wbGV0ZWQgc3RhcnR1cC5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBPcHRpb25zLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIm5vZGU6Y2hpbGRfcHJvY2Vzc1wiKS5DaGlsZFByb2Nlc3N9IGFyZ3MuY2hpbGQgLSBQb29sZWQgY2hpbGQuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBhcmdzLmpvYklkIC0gSm9iIGlkIHRoYXQgb3ZlcnJhbi5cbiAgICogQHJldHVybnMge3ZvaWR9XG4gICAqL1xuICBfb25Qb29sZWRKb2JUaW1lb3V0KHtjaGlsZCwgam9iSWR9KSB7XG4gICAgY29uc3Qgc3RhdGUgPSB0aGlzLnBvb2xlZENoaWxkU3RhdGVzLmdldChjaGlsZClcblxuICAgIC8vIEFscmVhZHkgc2V0dGxpbmcvZ29uZSwgb3IgdGhlIGpvYiBmaW5pc2hlZCBpbiB0aGUgcmFjZSB3aXRoIHRoaXMgdGltZXIuXG4gICAgaWYgKCFzdGF0ZSB8fCBzdGF0ZS5zZXR0bGluZyB8fCBzdGF0ZS5zaHV0ZG93blJlYXNvbiB8fCAhc3RhdGUuaW5mbGlnaHQuaGFzKGpvYklkKSkgcmV0dXJuXG5cbiAgICBzdGF0ZS50aW1lb3V0Sm9iSWQgPSBqb2JJZFxuICAgIHRoaXMuX3JlcXVlc3RQb29sZWRDaGlsZFNodXRkb3duKHtjaGlsZCwgcmVhc29uOiBcImpvYl90aW1lb3V0XCIsIHNpZ25hbDogXCJTSUdURVJNXCJ9KVxuXG4gICAgc3RhdGUudGltZW91dFNpZ2tpbGxUaW1lciA9IHNldFRpbWVvdXQoKCkgPT4ge1xuICAgICAgdHJ5IHtcbiAgICAgICAgY2hpbGQua2lsbChcIlNJR0tJTExcIilcbiAgICAgIH0gY2F0Y2gge1xuICAgICAgICAvLyBDaGlsZCBhbHJlYWR5IGV4aXRlZDsgbm90aGluZyB0byBkby5cbiAgICAgIH1cbiAgICB9LCB0aGlzLmZvcmtlZENoaWxkU2lna2lsbEdyYWNlTXMpXG4gIH1cblxuICAvKipcbiAgICogQ3JlYXRlcyBhIHJldXNhYmxlIHBvb2xlZCBjaGlsZCwgZW5mb3JjaW5nIHRoZSBoYXJkIGNhcCBvbiB0b3RhbCBsaXZlXG4gICAqIGNoaWxkcmVuICh3b3JraW5nICsgZHJhaW5pbmcpLiBSZXR1cm5zIHVuZGVmaW5lZCB3aGVuIHRoZSBjYXAgaXMgYWxyZWFkeVxuICAgKiBtZXQg4oCUIHRoZSBvbmx5IHdheSBhIG5ldyBjaGlsZCBtYXkgZXhpc3QgaXMgYSBzbG90IGJlaW5nIG9wZW4sIHNvIHRoZVxuICAgKiBjYWxsZXIgcmUtY2hlY2tzIGFuZCB3YWl0cyBhZ2Fpbi4gYGFsbG93T3ZlckNhcGAgaXMgcmVzZXJ2ZWQgZm9yIHRoZVxuICAgKiBib3VuZGVkIGxpdmVuZXNzIHJlcGxhY2VtZW50OiBhdCBtb3N0IG9uZSBjaGlsZCBiZXlvbmQgdGhlIGNhcCBtYXkgZXhpc3QsXG4gICAqIGFuZCBvbmx5IHdoZW4gZXZlcnkgb3RoZXIgbGl2ZSBjaGlsZCBpcyBhbHJlYWR5IHJldGlyaW5nIChzZWVcbiAgICogYF9iZWdpblJldGlyZVBvb2xlZENoaWxkYCBmb3IgdGhlIGdhdGUpLlxuICAgKiBAcGFyYW0ge29iamVjdH0gW2FyZ3NdIC0gU3Bhd24gb3B0aW9ucy5cbiAgICogQHBhcmFtIHtib29sZWFufSBbYXJncy5hbGxvd092ZXJDYXBdIC0gQWxsb3cgb25lIG92ZXItY2FwIHNwYXduIGZvciB0aGUgbGl2ZW5lc3MgcmVwbGFjZW1lbnQuXG4gICAqIEByZXR1cm5zIHtpbXBvcnQoXCJub2RlOmNoaWxkX3Byb2Nlc3NcIikuQ2hpbGRQcm9jZXNzIHwgdW5kZWZpbmVkfSAtIFRoZSBuZXcgY2hpbGQsIG9yIHVuZGVmaW5lZCB3aGVuIHRoZSBwb29sIGlzIGF0IGl0cyBjYXAuXG4gICAqL1xuICBfY3JlYXRlUG9vbGVkQ2hpbGQoe2FsbG93T3ZlckNhcCA9IGZhbHNlfSA9IHt9KSB7XG4gICAgY29uc3QgY29uZmlndXJhdGlvbiA9IHRoaXMuY29uZmlndXJhdGlvblxuICAgIGlmICghY29uZmlndXJhdGlvbikgdGhyb3cgbmV3IEVycm9yKFwiQmFja2dyb3VuZCBqb2JzIHdvcmtlciBjb25maWd1cmF0aW9uIG5vdCBpbml0aWFsaXplZFwiKVxuICAgIGlmICghYWxsb3dPdmVyQ2FwICYmIHRoaXMucG9vbGVkQ2hpbGRyZW4uc2l6ZSA+PSB0aGlzLnBvb2xlZFJ1bm5lckNvdW50KSByZXR1cm4gdW5kZWZpbmVkXG4gICAgY29uc3QgY2hpbGQgPSBmb3JrKFBPT0xFRF9SVU5ORVJfRU5UUllfUEFUSCwgW10sIHtcbiAgICAgIGN3ZDogY29uZmlndXJhdGlvbi5nZXREaXJlY3RvcnkoKSwgZXhlY0FyZ3Y6IFtdLCBzdGRpbzogW1wiaWdub3JlXCIsIFwiaWdub3JlXCIsIFwiaWdub3JlXCIsIFwiaXBjXCJdLFxuICAgICAgZW52OiBPYmplY3QuYXNzaWduKHt9LCBwcm9jZXNzLmVudiwgdGhpcy5fY2hpbGRCYWNrZ3JvdW5kSm9ic0Vudmlyb25tZW50KCkpXG4gICAgfSlcbiAgICB0aGlzLnBvb2xlZENoaWxkcmVuLmFkZChjaGlsZClcbiAgICB0aGlzLmluZmxpZ2h0UHJvY2Vzc0NoaWxkcmVuLmFkZChjaGlsZClcbiAgICB0aGlzLnBvb2xlZENoaWxkU3RhdGVzLnNldChjaGlsZCwge2NyZWF0ZWRBdE1zOiBEYXRlLm5vdygpLCBqb2JzUnVuOiAwLCBpbmZsaWdodDogbmV3IE1hcCgpLCBsYXN0RGlzcGF0Y2hTZXE6IDAsIHJldGlyaW5nOiBmYWxzZSwgc3RhcnRlZDogZmFsc2V9KVxuICAgIGNoaWxkLm9uKFwibWVzc2FnZVwiLCAobWVzc2FnZSkgPT4gdGhpcy5faGFuZGxlUG9vbGVkQ2hpbGRNZXNzYWdlKHtjaGlsZCwgbWVzc2FnZX0pKVxuICAgIGNoaWxkLm9uY2UoXCJleGl0XCIsIChleGl0Q29kZSwgc2lnbmFsKSA9PiB0aGlzLl9oYW5kbGVQb29sZWRDaGlsZEZhaWx1cmUoe1xuICAgICAgY2hpbGQsXG4gICAgICBlcnJvcjogbmV3IEVycm9yKGBQb29sZWQgYmFja2dyb3VuZCBqb2IgcnVubmVyIGV4aXRlZDogY29kZT0ke2V4aXRDb2RlfSBzaWduYWw9JHtzaWduYWwgfHwgXCJub25lXCJ9YCksXG4gICAgICBleGl0Q29kZSxcbiAgICAgIG9yaWdpbjogXCJleGl0XCIsXG4gICAgICBzaWduYWxcbiAgICB9KSlcbiAgICBjaGlsZC5vbmNlKFwiZXJyb3JcIiwgKGVycm9yKSA9PiB0aGlzLl9oYW5kbGVQb29sZWRDaGlsZEZhaWx1cmUoe1xuICAgICAgY2hpbGQsXG4gICAgICBlcnJvcixcbiAgICAgIGV4aXRDb2RlOiBjaGlsZC5leGl0Q29kZSxcbiAgICAgIG9yaWdpbjogXCJwcm9jZXNzLWVycm9yXCIsXG4gICAgICBzaWduYWw6IGNoaWxkLnNpZ25hbENvZGVcbiAgICB9KSlcbiAgICBjaGlsZC5vbmNlKFwiZGlzY29ubmVjdFwiLCAoKSA9PiB7XG4gICAgICBjb25zdCBzdGF0ZSA9IHRoaXMucG9vbGVkQ2hpbGRTdGF0ZXMuZ2V0KGNoaWxkKVxuICAgICAgaWYgKHN0YXRlKSBzdGF0ZS5pcGNEaXNjb25uZWN0ZWRBdE1zID8/PSBEYXRlLm5vdygpXG4gICAgfSlcbiAgICByZXR1cm4gY2hpbGRcbiAgfVxuXG4gIC8qKlxuICAgKiBIYW5kbGVzIGEgcG9vbGVkIGNoaWxkJ3MgcGVyLWpvYiBkdXJhYmxlLXJlcG9ydCBhY2tub3dsZWRnZW1lbnQuIEEgY2hpbGRcbiAgICogcnVucyBqb2JzIGNvbmN1cnJlbnRseSBhbmQgcmVwb3J0cyBvbmUgYGpvYi1vdXRjb21lYCBwZXIgam9iIGlkLlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIE1lc3NhZ2UgZGV0YWlscy5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCJub2RlOmNoaWxkX3Byb2Nlc3NcIikuQ2hpbGRQcm9jZXNzfSBhcmdzLmNoaWxkIC0gUG9vbGVkIGNoaWxkLlxuICAgKiBAcGFyYW0ge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSBhcmdzLm1lc3NhZ2UgLSBJUEMgbWVzc2FnZS5cbiAgICogQHJldHVybnMge3ZvaWR9XG4gICAqL1xuICBfaGFuZGxlUG9vbGVkQ2hpbGRNZXNzYWdlKHtjaGlsZCwgbWVzc2FnZX0pIHtcbiAgICBpZiAoIW1lc3NhZ2UgfHwgdHlwZW9mIG1lc3NhZ2UgIT09IFwib2JqZWN0XCIpIHJldHVyblxuICAgIGNvbnN0IHJlY29yZCA9IC8qKiBAdHlwZSB7e3R5cGU/OiBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPiwgY2hpbGRJbnN0YW5jZUlkPzogUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4sIGpvYklkPzogUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4sIGFja25vd2xlZGdlZD86IFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+LCByc3NCeXRlcz86IFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+LCBwZWFrUnNzQnl0ZXM/OiBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPiwgZXJyb3I/OiBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn19ICovIChtZXNzYWdlKVxuICAgIGNvbnN0IHN0YXRlID0gdGhpcy5wb29sZWRDaGlsZFN0YXRlcy5nZXQoY2hpbGQpXG4gICAgaWYgKHJlY29yZC50eXBlID09PSBcInJlYWR5XCIpIHtcbiAgICAgIGlmIChzdGF0ZSkge1xuICAgICAgICBzdGF0ZS5zdGFydGVkID0gdHJ1ZVxuICAgICAgICBpZiAodHlwZW9mIHJlY29yZC5jaGlsZEluc3RhbmNlSWQgPT09IFwic3RyaW5nXCIpIHN0YXRlLmNoaWxkSW5zdGFuY2VJZCA9IHJlY29yZC5jaGlsZEluc3RhbmNlSWRcbiAgICAgIH1cbiAgICAgIHJldHVyblxuICAgIH1cbiAgICBpZiAoaXNDaGlsZFNodXRkb3duT2JzZXJ2YXRpb25NZXNzYWdlKG1lc3NhZ2UpKSB7XG4gICAgICBpZiAoc3RhdGUpIHtcbiAgICAgICAgc3RhdGUuY2hpbGRJbnN0YW5jZUlkID0gbWVzc2FnZS5jaGlsZEluc3RhbmNlSWRcbiAgICAgICAgc3RhdGUuc2h1dGRvd25PYnNlcnZhdGlvbiA9IG1lc3NhZ2VcbiAgICAgICAgaWYgKHN0YXRlLnNodXRkb3duU2lnbmFsVGltZXIpIHtcbiAgICAgICAgICBjbGVhclRpbWVvdXQoc3RhdGUuc2h1dGRvd25TaWduYWxUaW1lcilcbiAgICAgICAgICBzdGF0ZS5zaHV0ZG93blNpZ25hbFRpbWVyID0gdW5kZWZpbmVkXG4gICAgICAgIH1cbiAgICAgIH1cbiAgICAgIHJldHVyblxuICAgIH1cbiAgICBpZiAoaXNDaGlsZEFjY2VwdGFuY2VNZXNzYWdlKG1lc3NhZ2UpKSB7XG4gICAgICB0aGlzLl9yZXBvcnRDaGlsZEFjY2VwdGVkKG1lc3NhZ2UpXG4gICAgICByZXR1cm5cbiAgICB9XG4gICAgaWYgKGlzUG9vbGVkQ2hpbGRNZW1vcnlPYnNlcnZhdGlvbk1lc3NhZ2UobWVzc2FnZSkpIHtcbiAgICAgIHRoaXMuX2hhbmRsZVBvb2xlZENoaWxkTWVtb3J5T2JzZXJ2YXRpb24oe2NoaWxkLCBtZXNzYWdlfSlcbiAgICAgIHJldHVyblxuICAgIH1cbiAgICBpZiAocmVjb3JkLnR5cGUgIT09IFwiam9iLW91dGNvbWVcIiB8fCAhc3RhdGUgfHwgc3RhdGUuc2V0dGxpbmcgfHwgdHlwZW9mIHJlY29yZC5qb2JJZCAhPT0gXCJzdHJpbmdcIikgcmV0dXJuXG4gICAgc3RhdGUuc3RhcnRlZCA9IHRydWVcbiAgICBjb25zdCBlbnRyeSA9IHN0YXRlLmluZmxpZ2h0LmdldChyZWNvcmQuam9iSWQpXG4gICAgaWYgKCFlbnRyeSkgcmV0dXJuXG5cbiAgICBpZiAoZW50cnkudGltZW91dFRpbWVyKSBjbGVhclRpbWVvdXQoZW50cnkudGltZW91dFRpbWVyKVxuICAgIHN0YXRlLmluZmxpZ2h0LmRlbGV0ZShyZWNvcmQuam9iSWQpXG4gICAgc3RhdGUuam9ic1J1biArPSAxXG4gICAgY29uc3QgcmVzb2x2ZSA9IGVudHJ5LnJlc29sdmVcblxuICAgIGlmIChyZWNvcmQuYWNrbm93bGVkZ2VkID09PSB0cnVlKSB7XG4gICAgICBpZiAocmVzb2x2ZSkgcmVzb2x2ZSh1bmRlZmluZWQpXG4gICAgfSBlbHNlIHtcbiAgICAgIC8vIFRoZSBjaGlsZCBzdGF5ZWQgYWxpdmUgYnV0IGNvdWxkIG5vdCBjb25maXJtIHRoaXMgb25lIGpvYidzIHRlcm1pbmFsXG4gICAgICAvLyByZXBvcnQ7IHJlY2xhaW0ganVzdCB0aGlzIGpvYiDigJQgaXRzIGNvbmN1cnJlbnQgc2libGluZ3MgYXJlIHVuYWZmZWN0ZWQuXG4gICAgICB2b2lkIHRoaXMuX3JlcG9ydEpvYlJlc3VsdCh7XG4gICAgICAgIGpvYklkOiBlbnRyeS5wYXlsb2FkLmlkLFxuICAgICAgICBzdGF0dXM6IFwiZmFpbGVkXCIsXG4gICAgICAgIGVycm9yOiBuZXcgRXJyb3IodHlwZW9mIHJlY29yZC5lcnJvciA9PT0gXCJzdHJpbmdcIiA/IHJlY29yZC5lcnJvciA6IFwiUG9vbGVkIHJ1bm5lciB0ZXJtaW5hbCByZXBvcnQgd2FzIG5vdCBhY2tub3dsZWRnZWRcIiksXG4gICAgICAgIGhhbmRvZmZJZDogZW50cnkucGF5bG9hZC5oYW5kb2ZmSWQsXG4gICAgICAgIGhhbmRlZE9mZkF0TXM6IGVudHJ5LnBheWxvYWQuaGFuZGVkT2ZmQXRNcyxcbiAgICAgICAgd29ya2VySWQ6IGVudHJ5LnBheWxvYWQud29ya2VySWQgfHwgdGhpcy53b3JrZXJJZFxuICAgICAgfSkuZmluYWxseSgoKSA9PiB7IGlmIChyZXNvbHZlKSByZXNvbHZlKHVuZGVmaW5lZCkgfSlcbiAgICB9XG5cbiAgICBjb25zdCByc3NCeXRlcyA9IHR5cGVvZiByZWNvcmQucnNzQnl0ZXMgPT09IFwibnVtYmVyXCIgPyByZWNvcmQucnNzQnl0ZXMgOiBOdW1iZXIuUE9TSVRJVkVfSU5GSU5JVFlcbiAgICAvLyBUaGUgY2hpbGQncyBwZWFrIFJTUyAoVm1IV00pIGlzIG1vbm90b25pYyBhbmQgb3V0bGl2ZXMgdGhlIHNldHRsZWRcbiAgICAvLyBzYW1wbGU6IGEgcmF0Y2hldGVkIGJ1cnN0IHdvcmtpbmctc2V0IG11c3QgcmVjeWNsZSB0aGUgY2hpbGQgZXZlbiB3aGVuXG4gICAgLy8gc2V0dGxlZCBSU1MgYXQgb3V0Y29tZSB0aW1lIGxvb2tzIG1vZGVzdC4gQSBjaGlsZCB3aXRob3V0IHBlYWsgc3VwcG9ydFxuICAgIC8vIGZhbGxzIGJhY2sgdG8gdGhlIHNldHRsZWQgc2FtcGxlLlxuICAgIGNvbnN0IHBlYWtSc3NCeXRlcyA9IHR5cGVvZiByZWNvcmQucGVha1Jzc0J5dGVzID09PSBcIm51bWJlclwiID8gcmVjb3JkLnBlYWtSc3NCeXRlcyA6IHJzc0J5dGVzXG4gICAgY29uc3QgcnVubmVyQWdlTXMgPSBEYXRlLm5vdygpIC0gc3RhdGUuY3JlYXRlZEF0TXNcbiAgICBpZiAoIXN0YXRlLnJldGlyaW5nICYmIChzdGF0ZS5qb2JzUnVuID49IHRoaXMucG9vbGVkUnVubmVyTWF4Sm9icyB8fCBwZWFrUnNzQnl0ZXMgPj0gdGhpcy5wb29sZWRSdW5uZXJNYXhSc3NCeXRlcyB8fCBydW5uZXJBZ2VNcyA+PSB0aGlzLnBvb2xlZFJ1bm5lck1heExpZmV0aW1lTXMgfHwgdGhpcy5zaG91bGRTdG9wKSkge1xuICAgICAgdGhpcy5fYmVnaW5SZXRpcmVQb29sZWRDaGlsZChjaGlsZClcbiAgICB9XG4gICAgdGhpcy5fdGVybWluYXRlSWZEcmFpbmVkKGNoaWxkKVxuICAgIC8vIEEgam9iIG91dGNvbWUgZnJlZXMgYSBjb25jdXJyZW5jeSBzbG90IGFuZCBtYXkgZHJhaW4gYSByZXRpcmluZyBjaGlsZCDigJRcbiAgICAvLyB0aGUgb25seSB0d28gdHJhbnNpdGlvbnMgdGhhdCBmcmVlIGNhcGFjaXR5IGZvciB3YWl0ZXJzIGF0IHRoZSBoYXJkIGNhcC5cbiAgICB0aGlzLl93YWtlUG9vbGVkU2xvdFdhaXRlcnMoKVxuICB9XG5cbiAgLyoqXG4gICAqIEZvcndhcmRzIG9uZSBwb29sZWQgY2hpbGQncyBhY2NlcHRhbmNlIG9ic2VydmF0aW9uIHRvIG1haW4gYXMgYSBib3VuZGVkXG4gICAqIGRpYWdub3N0aWMgcmVwb3J0LiBUaGUgY2hpbGQgY2FycmllcyBpdHMgZXhhY3QgaGFuZG9mZiBsZWFzZSwgc28gYSB0aW1lb3V0XG4gICAqIG9yIG91dGNvbWUgdGhhdCBhbHJlYWR5IHNldHRsZWQgdGhlIHdvcmtlcidzIGluLWZsaWdodCBlbnRyeSBjYW5ub3QgbG9zZVxuICAgKiB0aGUgZmVuY2luZy4gQSByZXBvcnQgdGhhdCBuZXZlciBsYW5kcyBkZWdyYWRlcyBwaGFzZSBkaWFnbm9zdGljcyBmb3IgdGhhdFxuICAgKiBqb2Igb25seSDigJQgaXQgbXVzdCBuZXZlciBibG9jayBvciBmYWlsIHRoZSBqb2IgaXRzZWxmLlxuICAgKiBAcGFyYW0ge3t0eXBlOiBcImpvYi1yZWNlaXZlZFwiIHwgXCJqb2Itc3RhcnRlZFwiLCBqb2JJZDogc3RyaW5nLCBoYW5kb2ZmSWQ/OiBzdHJpbmcsIHdvcmtlcklkPzogc3RyaW5nLCBoYW5kZWRPZmZBdE1zPzogbnVtYmVyLCByZWNlaXZlZEF0TXM/OiBudW1iZXIsIHN0YXJ0ZWRBdE1zPzogbnVtYmVyLCBjaGlsZEluc3RhbmNlSWQ/OiBzdHJpbmcsIGNoaWxkUGlkPzogbnVtYmVyfX0gbWVzc2FnZSAtIFZhbGlkYXRlZCBjaGlsZCBhY2NlcHRhbmNlIG1lc3NhZ2UuXG4gICAqIEByZXR1cm5zIHt2b2lkfVxuICAgKi9cbiAgX3JlcG9ydENoaWxkQWNjZXB0ZWQobWVzc2FnZSkge1xuICAgIGlmICghdGhpcy5zdGF0dXNSZXBvcnRlcikgcmV0dXJuXG5cbiAgICB2b2lkIHRoaXMuc3RhdHVzUmVwb3J0ZXIucmVwb3J0Q2hpbGRBY2NlcHRlZFdpdGhSZXRyeSh7XG4gICAgICBqb2JJZDogbWVzc2FnZS5qb2JJZCxcbiAgICAgIGhhbmRvZmZJZDogbWVzc2FnZS5oYW5kb2ZmSWQsXG4gICAgICB3b3JrZXJJZDogbWVzc2FnZS53b3JrZXJJZCxcbiAgICAgIGhhbmRlZE9mZkF0TXM6IG1lc3NhZ2UuaGFuZGVkT2ZmQXRNcyxcbiAgICAgIHJlY2VpdmVkQXRNczogbWVzc2FnZS5yZWNlaXZlZEF0TXMsXG4gICAgICBzdGFydGVkQXRNczogbWVzc2FnZS5zdGFydGVkQXRNcyxcbiAgICAgIGNoaWxkSW5zdGFuY2VJZDogbWVzc2FnZS5jaGlsZEluc3RhbmNlSWQsXG4gICAgICBjaGlsZFBpZDogbWVzc2FnZS5jaGlsZFBpZCxcbiAgICAgIG1heER1cmF0aW9uTXM6IENISUxEX0FDQ0VQVEFOQ0VfUkVQT1JUX01BWF9EVVJBVElPTl9NU1xuICAgIH0pLmNhdGNoKChlcnJvcikgPT4ge1xuICAgICAgY29uc29sZS5lcnJvcihcIkJhY2tncm91bmQgam9iIGNoaWxkLWFjY2VwdGFuY2UgcmVwb3J0aW5nIGZhaWxlZDpcIiwgZXJyb3IpXG4gICAgfSlcbiAgfVxuXG4gIC8qKlxuICAgKiBIYW5kbGVzIGEgcG9vbGVkIGNoaWxkJ3MgYm91bmRlZCBtZW1vcnkgb2JzZXJ2YXRpb24uIFRoZSBwb29sZWQgY2hpbGQnc1xuICAgKiBzdGRpbyBpcyBpZ25vcmVkIGJ5IHRoZSB3b3JrZXIgZm9yaywgc28gdGhpcyBJUEMgb2JzZXJ2YXRpb24gaXMgaG93IGFcbiAgICogbWVtb3J5IHByb2JsZW0gaW4gYSBydW5uaW5nIGNoaWxkIG5hbWVzIGl0c2VsZi4gVGhlIHdvcmtlciAoYSkgcmVjb3JkcyB0aGVcbiAgICogbGF0ZXN0IG9ic2VydmF0aW9uIG9uIHRoZSBjaGlsZCdzIHN0YXRlIGZvciBsYXRlciBjb3JyZWxhdGlvbiwgKGIpIGxvZ3Mgb25lXG4gICAqIGNvbXBhY3QgbGluZSB0byBpdHMgb3duIHN0ZGVyciAod2hpY2ggcmVhY2hlcyB0aGUgcHJvZCBsb2csIHVubGlrZSB0aGVcbiAgICogY2hpbGQncyBpZ25vcmVkIHN0ZGlvKSwgYW5kIChjKSBmb3J3YXJkcyB0aGUgZnVsbCBvYnNlcnZhdGlvbiB0byB0aGVcbiAgICogb3B0aW9uYWwgYG9uUG9vbGVkUnVubmVyTWVtb3J5T2JzZXJ2YXRpb25gIGhvb2sgc28gYW4gYXBwbGljYXRpb24gY2FuIHJvdXRlXG4gICAqIGl0IChlLmcuIHRvIGEgYnVnIHJlcG9ydGVyKSB3aXRob3V0IHBhcnNpbmcgbG9ncy4gVGhlIGhlYXAtc3RhdCBicmVha2Rvd25cbiAgICogZGlzdGluZ3Vpc2hlcyBWOC1oZWFwIGdyb3d0aCBmcm9tIGV4dGVybmFsL2FycmF5LWJ1ZmZlciAobmF0aXZlKSBncm93dGguIEFcbiAgICogaG9vayBmYWlsdXJlIGlzIHN3YWxsb3dlZCDigJQgZGlhZ25vc3RpY3MgbXVzdCBuZXZlciB0YWtlIGRvd24gdGhlIHdvcmtlciBvclxuICAgKiBmYWlsIHRoZSBqb2JzIHJ1bm5pbmcgb24gdGhhdCBjaGlsZC5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBNZXNzYWdlIGRldGFpbHMuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwibm9kZTpjaGlsZF9wcm9jZXNzXCIpLkNoaWxkUHJvY2Vzc30gYXJncy5jaGlsZCAtIFBvb2xlZCBjaGlsZC5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL3R5cGVzLmpzXCIpLlBvb2xlZENoaWxkTWVtb3J5T2JzZXJ2YXRpb259IGFyZ3MubWVzc2FnZSAtIFZhbGlkYXRlZCBtZW1vcnkgb2JzZXJ2YXRpb24uXG4gICAqIEByZXR1cm5zIHt2b2lkfVxuICAgKi9cbiAgX2hhbmRsZVBvb2xlZENoaWxkTWVtb3J5T2JzZXJ2YXRpb24oe2NoaWxkLCBtZXNzYWdlfSkge1xuICAgIGNvbnN0IHN0YXRlID0gdGhpcy5wb29sZWRDaGlsZFN0YXRlcy5nZXQoY2hpbGQpXG4gICAgaWYgKHN0YXRlKSBzdGF0ZS5sYXN0TWVtb3J5T2JzZXJ2YXRpb24gPSBtZXNzYWdlXG5cbiAgICBjb25zdCBoZWFwID0gbWVzc2FnZS5oZWFwU3RhdGlzdGljc1xuICAgIGNvbnNvbGUuZXJyb3IoXG4gICAgICBKU09OLnN0cmluZ2lmeSh7XG4gICAgICAgIGV2ZW50OiBcInBvb2xlZC1jaGlsZC1tZW1vcnlcIixcbiAgICAgICAgY2hpbGRJbnN0YW5jZUlkOiBzdGF0ZT8uY2hpbGRJbnN0YW5jZUlkID8/IG1lc3NhZ2UuY2hpbGRJbnN0YW5jZUlkLFxuICAgICAgICBjaGlsZFBpZDogbWVzc2FnZS5jaGlsZFBpZCxcbiAgICAgICAgY2hpbGRVcHRpbWVTOiBNYXRoLnJvdW5kKG1lc3NhZ2UuY2hpbGRVcHRpbWVNcyAvIDEwMDApLFxuICAgICAgICByc3NNYjogTWF0aC5yb3VuZChtZXNzYWdlLnJzc0J5dGVzIC8gKDEwMjQgKiAxMDI0KSksXG4gICAgICAgIHBlYWtSc3NNYjogTWF0aC5yb3VuZCgodHlwZW9mIG1lc3NhZ2UucGVha1Jzc0J5dGVzID09PSBcIm51bWJlclwiID8gbWVzc2FnZS5wZWFrUnNzQnl0ZXMgOiBtZXNzYWdlLnJzc0J5dGVzKSAvICgxMDI0ICogMTAyNCkpLFxuICAgICAgICBoZWFwVXNlZE1iOiBNYXRoLnJvdW5kKGhlYXAudXNlZF9oZWFwX3NpemUgLyAoMTAyNCAqIDEwMjQpKSxcbiAgICAgICAgaGVhcFRvdGFsTWI6IE1hdGgucm91bmQoaGVhcC50b3RhbF9oZWFwX3NpemUgLyAoMTAyNCAqIDEwMjQpKSxcbiAgICAgICAgaGVhcExpbWl0TWI6IE1hdGgucm91bmQoaGVhcC5oZWFwX3NpemVfbGltaXQgLyAoMTAyNCAqIDEwMjQpKSxcbiAgICAgICAgZXh0ZXJuYWxNYjogTWF0aC5yb3VuZChtZXNzYWdlLm1lbW9yeVVzYWdlLmV4dGVybmFsIC8gKDEwMjQgKiAxMDI0KSksXG4gICAgICAgIGFycmF5QnVmZmVyc01iOiBNYXRoLnJvdW5kKG1lc3NhZ2UubWVtb3J5VXNhZ2UuYXJyYXlCdWZmZXJzIC8gKDEwMjQgKiAxMDI0KSksXG4gICAgICAgIGpvYnM6IG1lc3NhZ2Uuam9iQ291bnQsXG4gICAgICAgIGFjdGl2ZUpvYklkczogbWVzc2FnZS5hY3RpdmVKb2JJZHNcbiAgICAgIH0pXG4gICAgKVxuXG4gICAgaWYgKHRoaXMub25Qb29sZWRSdW5uZXJNZW1vcnlPYnNlcnZhdGlvbikge1xuICAgICAgdHJ5IHtcbiAgICAgICAgY29uc3QgcmVzdWx0ID0gdGhpcy5vblBvb2xlZFJ1bm5lck1lbW9yeU9ic2VydmF0aW9uKG1lc3NhZ2UpXG4gICAgICAgIGlmIChyZXN1bHQgJiYgdHlwZW9mIHJlc3VsdC5jYXRjaCA9PT0gXCJmdW5jdGlvblwiKSByZXN1bHQuY2F0Y2goKGVycm9yKSA9PiB7XG4gICAgICAgICAgY29uc29sZS5lcnJvcihcIlBvb2xlZCBydW5uZXIgbWVtb3J5IG9ic2VydmF0aW9uIGhvb2sgZmFpbGVkOlwiLCBlcnJvcilcbiAgICAgICAgfSlcbiAgICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICAgIGNvbnNvbGUuZXJyb3IoXCJQb29sZWQgcnVubmVyIG1lbW9yeSBvYnNlcnZhdGlvbiBob29rIGZhaWxlZDpcIiwgZXJyb3IpXG4gICAgICB9XG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIFJlcXVlc3RzIGFuIGltbWVkaWF0ZSBtZW1vcnkgb2JzZXJ2YXRpb24gZnJvbSBvbmUgcG9vbGVkIGNoaWxkLiBUaGUgY2hpbGRcbiAgICogcmVwbGllcyBvdmVyIElQQyB3aXRoIGl0cyBjdXJyZW50IHNuYXBzaG90ICh0aGUgc2FtZSBzaGFwZSBhcyB0aGUgcGVyaW9kaWNcbiAgICogc2FtcGxlciksIHdoaWNoIHRoZSB3b3JrZXIgcmVjb3JkcywgbG9ncywgYW5kIGZvcndhcmRzIHRvIHRoZVxuICAgKiBgb25Qb29sZWRSdW5uZXJNZW1vcnlPYnNlcnZhdGlvbmAgaG9vay4gVXNlIHRoaXMgdG8gcHVsbCBhIHNuYXBzaG90IG9uXG4gICAqIHN1c3BpY2lvbiAoZS5nLiBhZnRlciBhbiBPT00gcmVwb3J0KSB3aXRob3V0IHdhaXRpbmcgZm9yIHRoZSBuZXh0IHBlcmlvZGljXG4gICAqIHNhbXBsZS4gQSBuby1vcCB3aGVuIHRoZSBjaGlsZCBpcyBnb25lIG9yIGl0cyBJUEMgY2hhbm5lbCBpcyBjbG9zZWQuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwibm9kZTpjaGlsZF9wcm9jZXNzXCIpLkNoaWxkUHJvY2Vzc30gY2hpbGQgLSBQb29sZWQgY2hpbGQgdG8gc2FtcGxlLlxuICAgKiBAcmV0dXJucyB7dm9pZH1cbiAgICovXG4gIHJlcXVlc3RQb29sZWRDaGlsZE1lbW9yeU9ic2VydmF0aW9uKGNoaWxkKSB7XG4gICAgaWYgKCFjaGlsZC5jb25uZWN0ZWQpIHJldHVyblxuXG4gICAgdHJ5IHtcbiAgICAgIGNoaWxkLnNlbmQoe3R5cGU6IFwibWVtb3J5LW9ic2VydmF0aW9uLXJlcXVlc3RcIn0pXG4gICAgfSBjYXRjaCB7XG4gICAgICAvLyBUaGUgSVBDIGNoYW5uZWwgaXMgYWxyZWFkeSBnb25lOyB0aGUgZGlzY29ubmVjdC9leGl0IGhhbmRsZXIgb3ducyB0ZWFyZG93bi5cbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogTWFya3MgYSBwb29sZWQgY2hpbGQgZm9yIHJldGlyZW1lbnQgYW5kIOKAlCB3aGVuIHRoZSBwb29sIGlzIGJlbG93IGl0cyBoYXJkXG4gICAqIGNhcCDigJQgZWFnZXJseSBzcGF3bnMgYSBzaW5nbGUgcmVwbGFjZW1lbnQgKDEtZm9yLTEpIHNvIGl0cyBjYXBhY2l0eSBpc1xuICAgKiByZXN0b3JlZCBpbW1lZGlhdGVseSB3aXRob3V0IHdhaXRpbmcgZm9yIGl0IHRvIGZpbmlzaCBkcmFpbmluZywgYW5kXG4gICAqIHJlLWFkdmVydGlzZXMgdGhhdCBjYXBhY2l0eSBzbyBkaXNwYXRjaCBjYW4gcmVzdW1lIGF0IG9uY2UuIFRoZVxuICAgKiByZXBsYWNlbWVudCBzcGF3biBpcyBnYXRlZCBieSB0aGUgY2FwICh0aGUgcmV0aXJpbmcgY2hpbGQgc3RpbGwgY291bnRzIGFzXG4gICAqIGxpdmUgdW50aWwgaXQgZXhpdHMpLCBzbyBhIGZ1bGwgcG9vbCBkZWZlcnMgdGhlIHJlcGxhY2VtZW50IHRvIHRoZSBkcmFpblxuICAgKiBwYXRoIOKAlCB3aGVyZSBhIGNoaWxkIGV4aXQgcmVzdG9yZXMgYSB3b3JraW5nIGNoaWxkIHRocm91Z2ggdGhlIHNhbWVcbiAgICogYm91bmRlZCBsaXZlbmVzcyByZXBsYWNlbWVudCAoc2VlIGBfZW5zdXJlTm9uUmV0aXJpbmdDaGlsZGApLiBXaXRob3V0IGl0LFxuICAgKiBhIGZ1bGwgcmV0aXJlbWVudCB3YXZlIChlLmcuIGV2ZXJ5IGNoaWxkIGNyb3NzaW5nIHRoZSBwZWFrLVJTUyB0aHJlc2hvbGRcbiAgICogYWZ0ZXIgdGhlIHNhbWUgbWVtb3J5IGJ1cnN0KSBzaWxlbnRseSByZW1vdmVzIGFsbCBwb29sZWQgY2FwYWNpdHkgZm9yIHRoZVxuICAgKiB3aG9sZSBkcmFpbiB3aW5kb3csIHdoaWNoIGNhbiBzdHJldGNoIHRvIHRoZSBsb25nZXN0IGluLWZsaWdodCBqb2IuIFRoZVxuICAgKiByZXRpcmluZyBjaGlsZCBzdG9wcyByZWNlaXZpbmcgbmV3IGpvYnMgYW5kIGlzIHRlcm1pbmF0ZWQgb25seSBvbmNlIGl0c1xuICAgKiBpbi1mbGlnaHQgc2V0IGRyYWlucywgc28gYSBsb25nLXJ1bm5pbmcgam9iIChlLmcuIGEgYnVpbGQpIGlzIG5ldmVyIGN1dFxuICAgKiBvZmYuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwibm9kZTpjaGlsZF9wcm9jZXNzXCIpLkNoaWxkUHJvY2Vzc30gY2hpbGQgLSBDaGlsZCB0byByZXRpcmUuXG4gICAqIEByZXR1cm5zIHt2b2lkfVxuICAgKi9cbiAgX2JlZ2luUmV0aXJlUG9vbGVkQ2hpbGQoY2hpbGQpIHtcbiAgICBjb25zdCBzdGF0ZSA9IHRoaXMucG9vbGVkQ2hpbGRTdGF0ZXMuZ2V0KGNoaWxkKVxuICAgIGlmICghc3RhdGUgfHwgc3RhdGUucmV0aXJpbmcpIHJldHVyblxuXG4gICAgc3RhdGUucmV0aXJpbmcgPSB0cnVlXG4gICAgLy8gQmVzdC1lZmZvcnQgcHJlLXdhcm06IHNraXAgd2hlbiBzdG9wcGluZyAobm8gbmV3IHdvcmspIG9yIGJlZm9yZSB0aGVcbiAgICAvLyB3b3JrZXIgaXMgaW5pdGlhbGl6ZWQgKG5vIGNvbmZpZ3VyYXRpb24gdG8gZm9yayBhIGNoaWxkIGZyb20pLiBUaGUgY2FwXG4gICAgLy8gaW5zaWRlIF9jcmVhdGVQb29sZWRDaGlsZCByZWZ1c2VzIHRoZSBzcGF3biB3aGlsZSB0aGUgcG9vbCBpcyBmdWxsLCBpblxuICAgIC8vIHdoaWNoIGNhc2UgdGhlIGJvdW5kZWQgbGl2ZW5lc3MgcmVwbGFjZW1lbnQgYmVsb3cgdGFrZXMgb3Zlci5cbiAgICBpZiAodGhpcy5zaG91bGRTdG9wIHx8ICF0aGlzLmNvbmZpZ3VyYXRpb24pIHJldHVyblxuXG4gICAgaWYgKHRoaXMuX2NyZWF0ZVBvb2xlZENoaWxkKCkpIHtcbiAgICAgIC8vIEZyZXNoIGNhcGFjaXR5IGV4aXN0czogcmUtYWR2ZXJ0aXNlIHNvIHRoZSBtYWluIGNhbiBkaXNwYXRjaCBpbnRvIGl0XG4gICAgICAvLyB3aXRob3V0IHdhaXRpbmcgZm9yIHRoZSBuZXh0IGpvYiBvdXRjb21lLlxuICAgICAgdGhpcy5fc2VuZFJlYWR5SWZSdW5uaW5nKClcbiAgICAgIHJldHVyblxuICAgIH1cbiAgICBpZiAodGhpcy5fbm9uUmV0aXJpbmdQb29sZWRDaGlsZENvdW50KCkgPiAwKSByZXR1cm5cblxuICAgIC8vIExpdmVuZXNzIHJlcGxhY2VtZW50OiB0aGlzIG1hcmsgZW1wdGllZCB0aGUgd29ya2luZyBwb29sLiBSZS1hZHZlcnRpc2VcbiAgICAvLyB0aGUgcmVzdG9yZWQgY2FwYWNpdHkgaW1tZWRpYXRlbHkgYWZ0ZXIgdGhlIGJvdW5kZWQgb3Zlci1jYXAgc3Bhd24uXG4gICAgaWYgKHRoaXMuX2Vuc3VyZU5vblJldGlyaW5nQ2hpbGQoKSkgdGhpcy5fc2VuZFJlYWR5SWZSdW5uaW5nKClcbiAgfVxuXG4gIC8qKlxuICAgKiBLZWVwcyDigJQgb3IgcmVzdG9yZXMg4oCUIGF0IGxlYXN0IG9uZSBub24tcmV0aXJpbmcgcG9vbGVkIGNoaWxkIHRocm91Z2ggdGhlXG4gICAqIGJvdW5kZWQgb3Zlci1jYXAgbGl2ZW5lc3MgcmVwbGFjZW1lbnQsIHVzZWQgYnkgYm90aCB0aGUgcmV0aXJlbWVudCBtYXJrXG4gICAqIChgX2JlZ2luUmV0aXJlUG9vbGVkQ2hpbGRgKSBhbmQgdGhlIGNoaWxkLWV4aXQgcGF0aFxuICAgKiAoYF9oYW5kbGVQb29sZWRDaGlsZEZhaWx1cmVgKTogYWR2ZXJ0aXNlZCBjYXBhY2l0eSBpcyB6ZXJvIHdoaWxlIGV2ZXJ5XG4gICAqIGxpdmUgY2hpbGQgaXMgcmV0aXJpbmcsIGFuZCBvbmNlIHRoZXkgYXJlIGFsbCByZXRpcmluZyBubyBmdXJ0aGVyXG4gICAqIHJldGlyZW1lbnQgbWFyayByZW1haW5zIHRvIHJlc3RvcmUgYSB3b3JraW5nIGNoaWxkIOKAlCBub3IgY2FuIGEgbGF6eVxuICAgKiByZXBsYWNlbWVudCBzcGF3biB3aGlsZSB0aGUgcG9vbCBjb3VudHMgYXQgaXRzIGNhcCDigJQgc28gZGlzcGF0Y2ggd291bGRcbiAgICogc3RhbGwgY2x1c3Rlci13aWRlIHVudGlsIHRoZSBuZXh0IGRyYWluaW5nIGV4aXQsIHVwIHRvIHRoZSBsb25nZXN0XG4gICAqIGluLWZsaWdodCBqb2IgKGUuZy4gYSBtdWx0aS1taW51dGUgYnVpbGQpLiBTcGF3bnMgb25lIHJlcGxhY2VtZW50IG92ZXIgdGhlXG4gICAqIGhhcmQgY2FwIChib3VuZGVkOiB0aGUgZ2F0ZSBhZG1pdHMgaXQgb25seSB3aGVuIHRoZSBsaXZlIGNvdW50IGlzIGF0IG1vc3RcbiAgICogdGhlIGNhcCwgc28gYXQgbW9zdCBvbmUgb3Zlci1jYXAgY2hpbGQgZXhpc3RzIGFuZCB0aGUgbmV4dCBkcmFpbmluZyBleGl0XG4gICAqIGFic29yYnMgaXQpLiBXaGVuIGV2ZW4gdGhhdCBzcGF3biBpcyB1bmF2YWlsYWJsZSAoYW4gb3Zlci1jYXAgY2hpbGQgaXNcbiAgICogYWxyZWFkeSBkcmFpbmluZyksIHRoZSBib3VuZGVkIHN0YXJ2YXRpb24gaXMgbG9nZ2VkIHNvIGl0IGlzIHZpc2libGVcbiAgICogaW5zdGVhZCBvZiBzaWxlbnQuXG4gICAqIEByZXR1cm5zIHtib29sZWFufSAtIFRydWUgd2hlbiBhIHJlcGxhY2VtZW50IGNoaWxkIHdhcyBzcGF3bmVkLlxuICAgKi9cbiAgX2Vuc3VyZU5vblJldGlyaW5nQ2hpbGQoKSB7XG4gICAgaWYgKHRoaXMuc2hvdWxkU3RvcCB8fCAhdGhpcy5jb25maWd1cmF0aW9uKSByZXR1cm4gZmFsc2VcbiAgICBpZiAodGhpcy5fbm9uUmV0aXJpbmdQb29sZWRDaGlsZENvdW50KCkgPiAwKSByZXR1cm4gZmFsc2VcblxuICAgIGlmICh0aGlzLnBvb2xlZENoaWxkcmVuLnNpemUgPD0gdGhpcy5wb29sZWRSdW5uZXJDb3VudCkge1xuICAgICAgY29uc3QgbGl2ZW5lc3NDaGlsZCA9IHRoaXMuX2NyZWF0ZVBvb2xlZENoaWxkKHthbGxvd092ZXJDYXA6IHRydWV9KVxuXG4gICAgICBpZiAobGl2ZW5lc3NDaGlsZCkge1xuICAgICAgICB0aGlzLl9sb2dQb29sZWRDYXBhY2l0eUV2ZW50KFwicG9vbGVkLWNhcGFjaXR5LWxpdmVuZXNzLXNwYXduXCIpXG4gICAgICAgIHJldHVybiB0cnVlXG4gICAgICB9XG4gICAgfVxuXG4gICAgLy8gQW4gb3Zlci1jYXAgY2hpbGQgaXMgYWxyZWFkeSBkcmFpbmluZzogdGhlIHBvb2wgd2FpdHMgZm9yIHRoZSBuZXh0XG4gICAgLy8gZHJhaW5pbmcgZXhpdCwgd2hpY2ggZnJlZXMgYSBjYXAgc2xvdCBmb3IgYSBsYXp5IHJlcGxhY2VtZW50IOKAlCBhbmQgdGhhdFxuICAgIC8vIGV4aXQgcmVzdG9yZXMgYSB3b3JraW5nIGNoaWxkIHRocm91Z2ggdGhpcyBzYW1lIHBhdGguIExvZyBpdCBzbyB0aGlzXG4gICAgLy8gYm91bmRlZCBzdGFydmF0aW9uIGlzIG5vdCBzaWxlbnQuXG4gICAgdGhpcy5fbG9nUG9vbGVkQ2FwYWNpdHlFdmVudChcInBvb2xlZC1jYXBhY2l0eS1zdGFydmVkXCIpXG4gICAgcmV0dXJuIGZhbHNlXG4gIH1cblxuICAvKipcbiAgICogTG9ncyBvbmUgY29tcGFjdCBwb29sZWQtY2FwYWNpdHkgZXZlbnQgdG8gdGhlIHdvcmtlcidzIG93biBzdGRlcnIgKHRoZVxuICAgKiBzdXJmYWNlIHRoYXQgcmVhY2hlcyB0aGUgcHJvZHVjdGlvbiBsb2cpLiBVc2VkIGJ5IHRoZSBib3VuZGVkIGxpdmVuZXNzXG4gICAqIHJlcGxhY2VtZW50IGluIGBfZW5zdXJlTm9uUmV0aXJpbmdDaGlsZGA6IHRoZSBzcGF3biB0aGF0IGtlZXBzIGRpc3BhdGNoXG4gICAqIGFsaXZlIHRocm91Z2ggYSBmdWxsIHJldGlyZW1lbnQgd2F2ZSAoYXQgYSByZXRpcmVtZW50IG1hcmsgb3IgYSBjaGlsZFxuICAgKiBleGl0KSwgb3IgdGhlIGJvdW5kZWQgc3RhcnZhdGlvbiB3aGVuIGFuIG92ZXItY2FwIGNoaWxkIGlzIGFscmVhZHlcbiAgICogZHJhaW5pbmcgYW5kIHRoZSBwb29sIG11c3Qgd2FpdCBmb3IgYW4gZXhpdC5cbiAgICogQHBhcmFtIHtcInBvb2xlZC1jYXBhY2l0eS1saXZlbmVzcy1zcGF3blwiIHwgXCJwb29sZWQtY2FwYWNpdHktc3RhcnZlZFwifSBldmVudCAtIEV2ZW50IG5hbWUuXG4gICAqIEByZXR1cm5zIHt2b2lkfVxuICAgKi9cbiAgX2xvZ1Bvb2xlZENhcGFjaXR5RXZlbnQoZXZlbnQpIHtcbiAgICBsZXQgcmV0aXJpbmdDaGlsZHJlbiA9IDBcblxuICAgIGZvciAoY29uc3Qgc3RhdGUgb2YgdGhpcy5wb29sZWRDaGlsZFN0YXRlcy52YWx1ZXMoKSkge1xuICAgICAgaWYgKHN0YXRlLnJldGlyaW5nKSByZXRpcmluZ0NoaWxkcmVuICs9IDFcbiAgICB9XG5cbiAgICBjb25zb2xlLmVycm9yKEpTT04uc3RyaW5naWZ5KHtcbiAgICAgIGV2ZW50LFxuICAgICAgbGl2ZUNoaWxkcmVuOiB0aGlzLnBvb2xlZENoaWxkcmVuLnNpemUsXG4gICAgICByZXRpcmluZ0NoaWxkcmVuLFxuICAgICAgY2FwOiB0aGlzLnBvb2xlZFJ1bm5lckNvdW50LFxuICAgICAgY29uY3VycmVuY3k6IHRoaXMucG9vbGVkUnVubmVyQ29uY3VycmVuY3lcbiAgICB9KSlcbiAgfVxuXG4gIC8qKlxuICAgKiBUZXJtaW5hdGVzIGEgcmV0aXJpbmcgcG9vbGVkIGNoaWxkIG9uY2UgaXQgaGFzIG5vIGluLWZsaWdodCBqb2JzIGxlZnQuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwibm9kZTpjaGlsZF9wcm9jZXNzXCIpLkNoaWxkUHJvY2Vzc30gY2hpbGQgLSBDaGlsZCB0byBjaGVjay5cbiAgICogQHJldHVybnMge3ZvaWR9XG4gICAqL1xuICBfdGVybWluYXRlSWZEcmFpbmVkKGNoaWxkKSB7XG4gICAgY29uc3Qgc3RhdGUgPSB0aGlzLnBvb2xlZENoaWxkU3RhdGVzLmdldChjaGlsZClcbiAgICBpZiAoIXN0YXRlIHx8ICFzdGF0ZS5yZXRpcmluZyB8fCBzdGF0ZS5pbmZsaWdodC5zaXplID4gMCkgcmV0dXJuXG5cbiAgICB0aGlzLl9yZXRpcmVQb29sZWRDaGlsZChjaGlsZClcbiAgfVxuXG4gIC8qKlxuICAgKiBSZXRpcmVzIGEgZHJhaW5lZCBwb29sZWQgY2hpbGQgKHJlbW92ZXMgaXQgZnJvbSB0cmFja2luZywgdGhlbiBTSUdURVJNcyBpdCkuXG4gICAqIEJlY2F1c2UgdGhlIGhhcmQgY2FwIGNvdW50cyBsaXZlIGNoaWxkcmVuLCB0aGUgZXhpdCBvZiB0aGlzIGNoaWxkIGZyZWVzIGFcbiAgICogc2xvdDogYW55IGRlZmVycmVkIHJlcGxhY2VtZW50ICh0aGUgcG9vbCB3YXMgZnVsbCB3aGVuIHRoZSBjaGlsZCByZXRpcmVkKVxuICAgKiBpcyBzcGF3bmVkIG5vdywgYW5kIGNhcGFjaXR5IGlzIHJlLWFkdmVydGlzZWQgc28gbWFpbiBjYW4gZGlzcGF0Y2ggaW50byBpdC5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCJub2RlOmNoaWxkX3Byb2Nlc3NcIikuQ2hpbGRQcm9jZXNzfSBjaGlsZCAtIENoaWxkIHByb2Nlc3MgdG8gcmV0aXJlLlxuICAgKiBAcmV0dXJucyB7dm9pZH1cbiAgICovXG4gIF9yZXRpcmVQb29sZWRDaGlsZChjaGlsZCkge1xuICAgIGNvbnN0IHN0YXRlID0gdGhpcy5wb29sZWRDaGlsZFN0YXRlcy5nZXQoY2hpbGQpXG4gICAgaWYgKCFzdGF0ZSkgdGhyb3cgbmV3IEVycm9yKFwiQ2Fubm90IHJldGlyZSBwb29sZWQgY2hpbGQgd2l0aG91dCB0cmFja2VkIHN0YXRlXCIpXG4gICAgaWYgKHN0YXRlLmluZmxpZ2h0LnNpemUgPiAwKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoYENhbm5vdCByZXRpcmUgcG9vbGVkIGNoaWxkIHdoaWxlICR7c3RhdGUuaW5mbGlnaHQuc2l6ZX0gJHtzdGF0ZS5pbmZsaWdodC5zaXplID09PSAxID8gXCJqb2IgcmVtYWluc1wiIDogXCJqb2JzIHJlbWFpblwifSBpbiBmbGlnaHRgKVxuICAgIH1cblxuICAgIHRoaXMucG9vbGVkQ2hpbGRyZW4uZGVsZXRlKGNoaWxkKVxuICAgIHN0YXRlLnJldGlyaW5nID0gdHJ1ZVxuICAgIHRoaXMuX3JlcXVlc3RQb29sZWRDaGlsZFNodXRkb3duKHtjaGlsZCwgcmVhc29uOiBcInBhcmVudF9yZXRpcmVfZHJhaW5lZFwiLCBzaWduYWw6IFwiU0lHVEVSTVwiLCB3YWl0Rm9yT2JzZXJ2YXRpb246IHRydWV9KVxuICB9XG5cbiAgLyoqXG4gICAqIFJlY29yZHMgYW4gZXhhY3QgcGFyZW50IHJlcXVlc3QgYmVmb3JlIElQQyBvciBzaWduYWwgZGVsaXZlcnkuIERyYWluZWRcbiAgICogcmV0aXJlbWVudCBnZXRzIGEgYnJpZWYgSVBDLWZpcnN0IGdyYWNlIHNvIGl0cyB6ZXJvLWpvYiBvYnNlcnZhdGlvbiBpc1xuICAgKiBkZXRlcm1pbmlzdGljOyB0aW1lb3V0L3dvcmtlci1zdG9wIHBhdGhzIHNpZ25hbCBpbW1lZGlhdGVseS5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBTaHV0ZG93biByZXF1ZXN0LlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIm5vZGU6Y2hpbGRfcHJvY2Vzc1wiKS5DaGlsZFByb2Nlc3N9IGFyZ3MuY2hpbGQgLSBQb29sZWQgY2hpbGQuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi90eXBlcy5qc1wiKS5Qb29sZWRDaGlsZFNodXRkb3duUmVhc29ufSBhcmdzLnJlYXNvbiAtIEV4YWN0IHBhcmVudCByZWFzb24uXG4gICAqIEBwYXJhbSB7a2V5b2YgdHlwZW9mIGltcG9ydChcIm5vZGU6b3NcIikuY29uc3RhbnRzLnNpZ25hbHN9IGFyZ3Muc2lnbmFsIC0gU2lnbmFsIHRvIGRlbGl2ZXIuXG4gICAqIEBwYXJhbSB7Ym9vbGVhbn0gW2FyZ3Mud2FpdEZvck9ic2VydmF0aW9uXSAtIFdoZXRoZXIgSVBDIG9ic2VydmF0aW9uIG1heSBwcmVjZWRlIHNpZ25hbCBmYWxsYmFjay5cbiAgICogQHJldHVybnMge3ZvaWR9XG4gICAqL1xuICBfcmVxdWVzdFBvb2xlZENoaWxkU2h1dGRvd24oe2NoaWxkLCByZWFzb24sIHNpZ25hbCwgd2FpdEZvck9ic2VydmF0aW9uID0gZmFsc2V9KSB7XG4gICAgY29uc3Qgc3RhdGUgPSB0aGlzLnBvb2xlZENoaWxkU3RhdGVzLmdldChjaGlsZClcbiAgICBpZiAoIXN0YXRlIHx8IHN0YXRlLnNldHRsaW5nIHx8IHN0YXRlLnNodXRkb3duUmVhc29uKSByZXR1cm5cblxuICAgIGNvbnN0IHNodXRkb3duUmVxdWVzdGVkQXRNcyA9IERhdGUubm93KClcbiAgICBzdGF0ZS5zaHV0ZG93blJlYXNvbiA9IHJlYXNvblxuICAgIHN0YXRlLnNodXRkb3duUmVxdWVzdGVkQXRNcyA9IHNodXRkb3duUmVxdWVzdGVkQXRNc1xuICAgIHN0YXRlLnNodXRkb3duU2lnbmFsID0gc2lnbmFsXG5cbiAgICBsZXQgcmVxdWVzdFNlbnQgPSBmYWxzZVxuICAgIGlmIChjaGlsZC5jb25uZWN0ZWQpIHtcbiAgICAgIHRyeSB7XG4gICAgICAgIGNoaWxkLnNlbmQoe3R5cGU6IFwic2h1dGRvd24tcmVxdWVzdFwiLCByZWFzb24sIHNodXRkb3duUmVxdWVzdGVkQXRNcywgc2lnbmFsfSwgKGVycm9yKSA9PiB7XG4gICAgICAgICAgaWYgKCFlcnJvciB8fCAhd2FpdEZvck9ic2VydmF0aW9uIHx8IHN0YXRlLnNldHRsaW5nKSByZXR1cm5cblxuICAgICAgICAgIGlmIChzdGF0ZS5zaHV0ZG93blNpZ25hbFRpbWVyKSB7XG4gICAgICAgICAgICBjbGVhclRpbWVvdXQoc3RhdGUuc2h1dGRvd25TaWduYWxUaW1lcilcbiAgICAgICAgICAgIHN0YXRlLnNodXRkb3duU2lnbmFsVGltZXIgPSB1bmRlZmluZWRcbiAgICAgICAgICB9XG4gICAgICAgICAgdGhpcy5fc2lnbmFsUG9vbGVkQ2hpbGQoe2NoaWxkLCBzaWduYWx9KVxuICAgICAgICB9KVxuICAgICAgICByZXF1ZXN0U2VudCA9IHRydWVcbiAgICAgIH0gY2F0Y2gge1xuICAgICAgICAvLyBUaGUgc2lnbmFsIGJlbG93IHJlbWFpbnMgdGhlIGJvdW5kZWQgc2h1dGRvd24gbWVjaGFuaXNtLlxuICAgICAgfVxuICAgIH1cblxuICAgIGlmICh3YWl0Rm9yT2JzZXJ2YXRpb24gJiYgcmVxdWVzdFNlbnQpIHtcbiAgICAgIHN0YXRlLnNodXRkb3duU2lnbmFsVGltZXIgPSBzZXRUaW1lb3V0KCgpID0+IHtcbiAgICAgICAgc3RhdGUuc2h1dGRvd25TaWduYWxUaW1lciA9IHVuZGVmaW5lZFxuICAgICAgICB0aGlzLl9zaWduYWxQb29sZWRDaGlsZCh7Y2hpbGQsIHNpZ25hbH0pXG4gICAgICB9LCBQT09MRURfUlVOTkVSX1NIVVRET1dOX1JFUVVFU1RfR1JBQ0VfTVMpXG4gICAgICBzdGF0ZS5zaHV0ZG93blNpZ25hbFRpbWVyLnVucmVmKClcbiAgICAgIHJldHVyblxuICAgIH1cblxuICAgIHRoaXMuX3NpZ25hbFBvb2xlZENoaWxkKHtjaGlsZCwgc2lnbmFsfSlcbiAgfVxuXG4gIC8qKlxuICAgKiBEZWxpdmVycyBvbmUgcGFyZW50LW93bmVkIHByb2Nlc3Mgc2lnbmFsIHdpdGhvdXQgY2hhbmdpbmcgcmVjb3JkZWQgcHJvdmVuYW5jZS5cbiAgICogQHBhcmFtIHt7Y2hpbGQ6IGltcG9ydChcIm5vZGU6Y2hpbGRfcHJvY2Vzc1wiKS5DaGlsZFByb2Nlc3MsIHNpZ25hbDoga2V5b2YgdHlwZW9mIGltcG9ydChcIm5vZGU6b3NcIikuY29uc3RhbnRzLnNpZ25hbHN9fSBhcmdzIC0gU2lnbmFsIHJlcXVlc3QuXG4gICAqIEByZXR1cm5zIHt2b2lkfVxuICAgKi9cbiAgX3NpZ25hbFBvb2xlZENoaWxkKHtjaGlsZCwgc2lnbmFsfSkge1xuICAgIHRyeSB7XG4gICAgICBjaGlsZC5raWxsKHNpZ25hbClcbiAgICB9IGNhdGNoIHtcbiAgICAgIC8vIENoaWxkIGFscmVhZHkgZXhpdGVkOyBpdHMgZXhpdC9lcnJvciBoYW5kbGVyIG93bnMgc3RhdGUgc2V0dGxlbWVudC5cbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogUmVtb3ZlcyBhbiBleGl0ZWQvdW5oZWFsdGh5IHBvb2xlZCBjaGlsZCBhbmQgcmVwb3J0cyBldmVyeSBqb2IgdGhhdCB3YXNcbiAgICogaW4tZmxpZ2h0IG9uIGl0IGFzIGZhaWxlZCDigJQgYSBwcm9jZXNzLWxldmVsIGNyYXNoJ3MgYmxhc3QgcmFkaXVzIGlzIHRoZVxuICAgKiBjaGlsZCdzIHdob2xlIGluLWZsaWdodCBzZXQuIE9uY2UgdGhlIGNoaWxkIGhhcyBjb21wbGV0ZWQgc3RhcnR1cCwgaXRzXG4gICAqIGZyZWVkIGNhcGFjaXR5IGlzIGFkdmVydGlzZWQgaW1tZWRpYXRlbHk7IHRoZSByZXBsYWNlbWVudCBpdHNlbGYgaXMgc3RpbGxcbiAgICogc3Bhd25lZCBsYXppbHkgYnkgdGhlIG5leHQgZGlzcGF0Y2guIEEgY2hpbGQgdGhhdCBleGl0cyBiZWZvcmUgaXRzIHN0YXJ0dXBcbiAgICogaGFuZHNoYWtlIGRvZXMgbm90IHJlLWFubm91bmNlLCBhdm9pZGluZyBhIHRpZ2h0IHJlc3Bhd24gbG9vcCBvbiBzdGFydHVwXG4gICAqIGZhaWx1cmUuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gRmFpbHVyZSBkZXRhaWxzLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIm5vZGU6Y2hpbGRfcHJvY2Vzc1wiKS5DaGlsZFByb2Nlc3N9IGFyZ3MuY2hpbGQgLSBQb29sZWQgY2hpbGQuXG4gICAqIEBwYXJhbSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59IGFyZ3MuZXJyb3IgLSBGYWlsdXJlLlxuICAgKiBAcGFyYW0ge251bWJlciB8IG51bGx9IFthcmdzLmV4aXRDb2RlXSAtIENoaWxkIGV4aXQgY29kZSB3aGVuIG9ic2VydmVkLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vdHlwZXMuanNcIikuUG9vbGVkUnVubmVyRmFpbHVyZU9yaWdpbn0gW2FyZ3Mub3JpZ2luXSAtIFdvcmtlciBvYnNlcnZhdGlvbiB0aGF0IGluaXRpYXRlZCByZWNvdmVyeS5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCJub2RlOmNoaWxkX3Byb2Nlc3NcIikuQ2hpbGRQcm9jZXNzW1wic2lnbmFsQ29kZVwiXX0gW2FyZ3Muc2lnbmFsXSAtIENoaWxkIHRlcm1pbmF0aW9uIHNpZ25hbCB3aGVuIG9ic2VydmVkLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn1cbiAgICovXG4gIGFzeW5jIF9oYW5kbGVQb29sZWRDaGlsZEZhaWx1cmUoe2NoaWxkLCBlcnJvciwgZXhpdENvZGUgPSBudWxsLCBvcmlnaW4gPSBcInByb2Nlc3MtZXJyb3JcIiwgc2lnbmFsID0gbnVsbH0pIHtcbiAgICBjb25zdCBzdGF0ZSA9IHRoaXMucG9vbGVkQ2hpbGRTdGF0ZXMuZ2V0KGNoaWxkKVxuICAgIGlmIChzdGF0ZT8uc2V0dGxpbmcpIHJldHVyblxuICAgIGlmIChzdGF0ZSkge1xuICAgICAgc3RhdGUuc2V0dGxpbmcgPSB0cnVlXG4gICAgICAvLyBDYW5jZWwgdGhpcyBjaGlsZCdzIHBlbmRpbmcgdGltZXJzIGJlZm9yZSBpdHMgaW4tZmxpZ2h0IHNldCBpcyByZXBvcnRlZCDigJRcbiAgICAgIC8vIHRoZSBTSUdLSUxMIGdyYWNlIGZyb20gYSB0aW1lb3V0IGtpbGwsIGFuZCBldmVyeSBhcm1lZCBwZXItam9iIGJhY2tzdG9wLlxuICAgICAgaWYgKHN0YXRlLnRpbWVvdXRTaWdraWxsVGltZXIpIGNsZWFyVGltZW91dChzdGF0ZS50aW1lb3V0U2lna2lsbFRpbWVyKVxuICAgICAgaWYgKHN0YXRlLnNodXRkb3duU2lnbmFsVGltZXIpIGNsZWFyVGltZW91dChzdGF0ZS5zaHV0ZG93blNpZ25hbFRpbWVyKVxuICAgICAgZm9yIChjb25zdCBpbmZsaWdodEVudHJ5IG9mIHN0YXRlLmluZmxpZ2h0LnZhbHVlcygpKSB7XG4gICAgICAgIGlmIChpbmZsaWdodEVudHJ5LnRpbWVvdXRUaW1lcikgY2xlYXJUaW1lb3V0KGluZmxpZ2h0RW50cnkudGltZW91dFRpbWVyKVxuICAgICAgfVxuICAgIH1cbiAgICB0aGlzLnBvb2xlZENoaWxkcmVuLmRlbGV0ZShjaGlsZClcbiAgICB0aGlzLmluZmxpZ2h0UHJvY2Vzc0NoaWxkcmVuLmRlbGV0ZShjaGlsZClcbiAgICAvLyBDaGlsZCBleGl0IGZyZWVzIGEgaGFyZC1jYXAgc2xvdCBldmVuIHdoaWxlIGl0cyBpbi1mbGlnaHQgc2V0IGlzIHN0aWxsXG4gICAgLy8gYmVpbmcgcmVwb3J0ZWQg4oCUIHdha2Ugd2FpdGVycyBub3c7IHRoZWlyIHJlcG9ydHMgc2V0dGxlIGluZGVwZW5kZW50bHkuXG4gICAgdGhpcy5fd2FrZVBvb2xlZFNsb3RXYWl0ZXJzKClcblxuICAgIGNvbnN0IGVudHJpZXMgPSBzdGF0ZSA/IFsuLi5zdGF0ZS5pbmZsaWdodC52YWx1ZXMoKV0gOiBbXVxuICAgIGNvbnN0IHJ1bm5lckZhaWx1cmUgPSBzdGF0ZVxuICAgICAgPyB0aGlzLl9wb29sZWRSdW5uZXJGYWlsdXJlKHtjaGlsZCwgZXhpdENvZGUsIG9yaWdpbiwgc2lnbmFsLCBzdGF0ZX0pXG4gICAgICA6IHVuZGVmaW5lZFxuICAgIGlmIChzdGF0ZSkgc3RhdGUuaW5mbGlnaHQuY2xlYXIoKVxuICAgIHRoaXMucG9vbGVkQ2hpbGRTdGF0ZXMuZGVsZXRlKGNoaWxkKVxuXG4gICAgY29uc3QgZmFpbHVyZVJlcG9ydHMgPSBlbnRyaWVzLm1hcChhc3luYyAoZW50cnkpID0+IHtcbiAgICAgIGF3YWl0IHRoaXMuX3JlcG9ydEpvYlJlc3VsdCh7XG4gICAgICAgIGpvYklkOiBlbnRyeS5wYXlsb2FkLmlkLFxuICAgICAgICBzdGF0dXM6IFwiZmFpbGVkXCIsXG4gICAgICAgIGVycm9yLFxuICAgICAgICBoYW5kb2ZmSWQ6IGVudHJ5LnBheWxvYWQuaGFuZG9mZklkLFxuICAgICAgICBoYW5kZWRPZmZBdE1zOiBlbnRyeS5wYXlsb2FkLmhhbmRlZE9mZkF0TXMsXG4gICAgICAgIHJ1bm5lckZhaWx1cmUsXG4gICAgICAgIHdvcmtlcklkOiBlbnRyeS5wYXlsb2FkLndvcmtlcklkIHx8IHRoaXMud29ya2VySWRcbiAgICAgIH0pXG4gICAgICBpZiAoZW50cnkucmVzb2x2ZSkgZW50cnkucmVzb2x2ZSh1bmRlZmluZWQpXG4gICAgfSlcblxuICAgIC8vIFN0YXJ0IGV2ZXJ5IGZhbGxiYWNrIHJlcG9ydCBiZWZvcmUgYW5ub3VuY2luZyBjYXBhY2l0eSBzbyB0aGUgbWFpbiBjYW5ub3RcbiAgICAvLyBvYnNlcnZlIGEgcmVwbGFjZW1lbnQgc2xvdCBiZWZvcmUgdGhlIGZhaWxlZCBqb2JzJyByZXBvcnRzIGFyZSBpbiBmbGlnaHQuXG4gICAgLy8gVGhlIHJlcG9ydCBwcm9taXNlcyByZW1haW4gdHJhY2tlZCBiZWxvdzsgYSBzbG93IHJldHJ5IG11c3Qgbm90IGhvbGQgdGhlXG4gICAgLy8gbmV3bHkgZnJlZWQgcnVubmVyIGNhcGFjaXR5IGhvc3RhZ2UuXG4gICAgLy8gQSBkcmFpbmVkIHJldGlyZW1lbnQgYWxyZWFkeSBhZHZlcnRpc2VkIGl0cyByZXBsYWNlbWVudCBjYXBhY2l0eSB3aGVuXG4gICAgLy8gdGhlIGZpbmFsIGpvYiBjb21wbGV0ZWQuIFJlLWFkdmVydGlzaW5nIGhlcmUgY2FuIHJlc3RvcmUgYSBjcmVkaXQgbWFpblxuICAgIC8vIGNvbnN1bWVkIGJlZm9yZSBpdHMgaGFuZG9mZiByZWFjaGVkIHRoZSByZXBsYWNlbWVudCBjaGlsZC5cbiAgICBpZiAoc3RhdGU/LnNodXRkb3duUmVhc29uICE9PSBcInBhcmVudF9yZXRpcmVfZHJhaW5lZFwiKSB7XG4gICAgICBpZiAoc3RhdGUgJiYgc3RhdGUuc3RhcnRlZCAhPT0gZmFsc2UpIHtcbiAgICAgICAgdGhpcy5fc2VuZFJlYWR5SWZSdW5uaW5nKClcbiAgICAgIH0gZWxzZSBpZiAoc3RhdGUpIHtcbiAgICAgICAgZm9yIChjb25zdCBlbnRyeSBvZiBlbnRyaWVzKSB7XG4gICAgICAgICAgaWYgKGVudHJ5LnBvb2xlZEpvYikgdGhpcy5fcG9vbGVkU3RhcnR1cEZhaWx1cmVKb2JzLmFkZChlbnRyeS5wb29sZWRKb2IpXG4gICAgICAgICAgY29uc3QgcXVldWVUcmFja2VyID0gdGhpcy5wb29sZWRKb2JRdWV1ZVRyYWNrZXJzLmdldChlbnRyeS5wYXlsb2FkLmlkKVxuICAgICAgICAgIGlmIChxdWV1ZVRyYWNrZXIpIHRoaXMuX3Bvb2xlZFN0YXJ0dXBGYWlsdXJlSm9icy5hZGQocXVldWVUcmFja2VyKVxuICAgICAgICB9XG4gICAgICAgIC8vIEEgcHJldmlvdXMgcmVhZHkgbWVzc2FnZSBtYXkgc3RpbGwgaGF2ZSB1bmNvbnN1bWVkIHBvb2xlZCBjcmVkaXRzIGF0IHRoZVxuICAgICAgICAvLyBtYWluLiBSZXZva2UgdGhlbSBhdXRob3JpdGF0aXZlbHkgd2l0aG91dCBzdXBwcmVzc2luZyB2YWxpZCBpbmxpbmUgb3JcbiAgICAgICAgLy8gcHJvY2Vzcy1ydW5uZXIgcmVhZGluZXNzOyBvdGhlcndpc2UgcXVldWVkIGpvYnMgY2FuIHRyaWdnZXIgYSBzdGFydHVwXG4gICAgICAgIC8vIGNyYXNoIGxvb3AgdXNpbmcgdGhlIHN0YWxlIGNyZWRpdHMuXG4gICAgICAgIHRoaXMuX3NlbmRSZWFkeUlmUnVubmluZyh7cmV2b2tlUG9vbGVkQWRtaXNzaW9uOiB0cnVlfSlcbiAgICAgIH1cbiAgICB9XG5cbiAgICAvLyBBIGNoaWxkIGV4aXQgY2FuIGFic29yYiB0aGUgYm91bmRlZCBvdmVyLWNhcCBsaXZlbmVzcyByZXBsYWNlbWVudCB3aGlsZVxuICAgIC8vIGV2ZXJ5IHJlbWFpbmluZyBsaXZlIGNoaWxkIGlzIHN0aWxsIHJldGlyaW5nIOKAlCBlLmcuIHRoZSByZXBsYWNlbWVudFxuICAgIC8vIHJldGlyZXMgKG9yIGRpZXMpIGZpcnN0LiBObyByZXRpcmVtZW50IG1hcmsgcmVtYWlucyB0byByZXN0b3JlIGEgd29ya2luZ1xuICAgIC8vIGNoaWxkLCBhbmQgYXQgdGhlIGNhcCBub3RoaW5nIGVsc2UgY2FuIHNwYXduLCBzbyBhZHZlcnRpc2VkIGNhcGFjaXR5XG4gICAgLy8gd291bGQgc3RheSB6ZXJvIHVudGlsIHRoZSBuZXh0IGRyYWluaW5nIGV4aXQg4oCUIHVwIHRvIHRoZSBsb25nZXN0XG4gICAgLy8gaW4tZmxpZ2h0IGpvYiDigJQgc3RhcnZpbmcgZGlzcGF0Y2ggY2x1c3Rlci13aWRlLiBSZXN0b3JlIG9uZSB3b3JraW5nXG4gICAgLy8gY2hpbGQgbm93IChzYW1lIGJvdW5kOiBhdCBtb3N0IG9uZSBvdmVyLWNhcCBjaGlsZCkgYW5kIHJlLWFkdmVydGlzZSBzb1xuICAgIC8vIG1haW4gY2FuIGRpc3BhdGNoIGludG8gaXQgaW1tZWRpYXRlbHkuXG4gICAgaWYgKHN0YXRlPy5zdGFydGVkICE9PSBmYWxzZSAmJiB0aGlzLnBvb2xlZENoaWxkcmVuLnNpemUgPiAwICYmIHRoaXMuX2Vuc3VyZU5vblJldGlyaW5nQ2hpbGQoKSkge1xuICAgICAgdGhpcy5fc2VuZFJlYWR5SWZSdW5uaW5nKClcbiAgICB9XG5cbiAgICBhd2FpdCBQcm9taXNlLmFsbFNldHRsZWQoZmFpbHVyZVJlcG9ydHMpXG4gIH1cblxuICAvKipcbiAgICogQ2FwdHVyZXMgb25lIHN0YWJsZSBwcm9jZXNzIHNuYXBzaG90IGJlZm9yZSB0aGUgZmFpbGVkIGNoaWxkJ3Mgc3RhdGUgaXMgcmVtb3ZlZC5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBGYWlsdXJlIGRldGFpbHMuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwibm9kZTpjaGlsZF9wcm9jZXNzXCIpLkNoaWxkUHJvY2Vzc30gYXJncy5jaGlsZCAtIEZhaWxlZCBwb29sZWQgY2hpbGQuXG4gICAqIEBwYXJhbSB7bnVtYmVyIHwgbnVsbH0gYXJncy5leGl0Q29kZSAtIENoaWxkIGV4aXQgY29kZSB3aGVuIG9ic2VydmVkLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vdHlwZXMuanNcIikuUG9vbGVkUnVubmVyRmFpbHVyZU9yaWdpbn0gYXJncy5vcmlnaW4gLSBXb3JrZXIgb2JzZXJ2YXRpb24gdGhhdCBpbml0aWF0ZWQgcmVjb3ZlcnkuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwibm9kZTpjaGlsZF9wcm9jZXNzXCIpLkNoaWxkUHJvY2Vzc1tcInNpZ25hbENvZGVcIl19IGFyZ3Muc2lnbmFsIC0gQ2hpbGQgdGVybWluYXRpb24gc2lnbmFsIHdoZW4gb2JzZXJ2ZWQuXG4gICAqIEBwYXJhbSB7UG9vbGVkQ2hpbGRTdGF0ZX0gYXJncy5zdGF0ZSAtIENoaWxkIHN0YXRlIGltbWVkaWF0ZWx5IGJlZm9yZSByZWNvdmVyeS5cbiAgICogQHJldHVybnMge2ltcG9ydChcIi4vdHlwZXMuanNcIikuUG9vbGVkUnVubmVyRmFpbHVyZX0gLSBTaGFyZWQgZmFpbHVyZSBwcm92ZW5hbmNlLlxuICAgKi9cbiAgX3Bvb2xlZFJ1bm5lckZhaWx1cmUoe2NoaWxkLCBleGl0Q29kZSwgb3JpZ2luLCBzaWduYWwsIHN0YXRlfSkge1xuICAgIGNvbnN0IG9ic2VydmF0aW9uID0gc3RhdGUuc2h1dGRvd25PYnNlcnZhdGlvblxuICAgIGxldCBzaHV0ZG93blJlYXNvbiA9IHN0YXRlLnNodXRkb3duUmVhc29uID8/IG9ic2VydmF0aW9uPy5yZWFzb25cbiAgICBpZiAoIXNodXRkb3duUmVhc29uKSB7XG4gICAgICBpZiAob3JpZ2luID09PSBcInByb2Nlc3MtZXJyb3JcIiB8fCBvcmlnaW4gPT09IFwiaXBjLXNlbmRcIikge1xuICAgICAgICBzaHV0ZG93blJlYXNvbiA9IFwicHJvY2Vzc19lcnJvclwiXG4gICAgICB9IGVsc2UgaWYgKHNpZ25hbCA9PT0gXCJTSUdURVJNXCIpIHtcbiAgICAgICAgc2h1dGRvd25SZWFzb24gPSBcInNpZ25hbF9zaWd0ZXJtXCJcbiAgICAgIH0gZWxzZSBpZiAoc2lnbmFsID09PSBcIlNJR0lOVFwiKSB7XG4gICAgICAgIHNodXRkb3duUmVhc29uID0gXCJzaWduYWxfc2lnaW50XCJcbiAgICAgIH0gZWxzZSBpZiAoc2lnbmFsID09PSBcIlNJR0tJTExcIikge1xuICAgICAgICBzaHV0ZG93blJlYXNvbiA9IFwic2lnbmFsX3NpZ2tpbGxcIlxuICAgICAgfSBlbHNlIGlmIChzaWduYWwpIHtcbiAgICAgICAgc2h1dGRvd25SZWFzb24gPSBcInNpZ25hbF9vdGhlclwiXG4gICAgICB9IGVsc2UgaWYgKHN0YXRlLmlwY0Rpc2Nvbm5lY3RlZEF0TXMgJiYgZXhpdENvZGUgPT09IDApIHtcbiAgICAgICAgc2h1dGRvd25SZWFzb24gPSBcImlwY19kaXNjb25uZWN0XCJcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIHNodXRkb3duUmVhc29uID0gXCJ1bmV4cGVjdGVkX2V4aXRcIlxuICAgICAgfVxuICAgIH1cbiAgICBjb25zdCB0ZXJtaW5hdGlvblJlYXNvbiA9IHNodXRkb3duUmVhc29uID09PSBcImpvYl90aW1lb3V0XCJcbiAgICAgID8gXCJqb2ItdGltZW91dFwiXG4gICAgICA6IHNodXRkb3duUmVhc29uID09PSBcIndvcmtlcl9zdG9wXCIgPyBcIndvcmtlci1zaHV0ZG93bi10aW1lb3V0XCIgOiBcInVuZXhwZWN0ZWRcIlxuICAgIGNvbnN0IHdvcmtlckxpZmVjeWNsZSA9IHRoaXMuc2hvdWxkU3RvcCA/IFwic3RvcHBpbmdcIiA6IHRoaXMuaXNSZXRpcmluZyA/IFwicmV0aXJpbmdcIiA6IFwicnVubmluZ1wiXG4gICAgY29uc3QgcnVubmVyTGlmZWN5Y2xlID0gc3RhdGUuc3RhcnRlZCA9PT0gZmFsc2UgPyBcInN0YXJ0aW5nXCIgOiBzdGF0ZS5yZXRpcmluZyA/IFwicmV0aXJpbmdcIiA6IFwicnVubmluZ1wiXG4gICAgY29uc3QgYm91bmRlZEluZmxpZ2h0ID0gYm91bmRlZFBvb2xlZFJ1bm5lckluZmxpZ2h0Sm9iSWRzKHN0YXRlLmluZmxpZ2h0LmtleXMoKSlcbiAgICBjb25zdCBhY3RpdmVKb2JzID0gWy4uLnN0YXRlLmluZmxpZ2h0LnZhbHVlcygpXVxuICAgICAgLm1hcCgoZW50cnkpID0+ICh7XG4gICAgICAgIGhhbmRvZmZJZDogZW50cnkucGF5bG9hZC5oYW5kb2ZmSWQgPz8gbnVsbCxcbiAgICAgICAgaGFuZGVkT2ZmQXRNczogZW50cnkucGF5bG9hZC5oYW5kZWRPZmZBdE1zID8/IG51bGwsXG4gICAgICAgIGpvYklkOiBlbnRyeS5wYXlsb2FkLmlkLFxuICAgICAgICBqb2JOYW1lOiBlbnRyeS5wYXlsb2FkLmpvYk5hbWUsXG4gICAgICAgIHdvcmtlcklkOiBlbnRyeS5wYXlsb2FkLndvcmtlcklkID8/IHRoaXMud29ya2VySWRcbiAgICAgIH0pKVxuICAgICAgLnNvcnQoKGxlZnQsIHJpZ2h0KSA9PiBsZWZ0LmpvYklkLmxvY2FsZUNvbXBhcmUocmlnaHQuam9iSWQpKVxuXG4gICAgcmV0dXJuIE9iamVjdC5mcmVlemUoe1xuICAgICAgYWN0aXZlSm9icyxcbiAgICAgIGNoaWxkSW5zdGFuY2VJZDogc3RhdGUuY2hpbGRJbnN0YW5jZUlkID8/IG9ic2VydmF0aW9uPy5jaGlsZEluc3RhbmNlSWQgPz8gbnVsbCxcbiAgICAgIGV4aXRDb2RlLFxuICAgICAgZ2VuZXJhdGlvbklkOiB0aGlzLmdlbmVyYXRpb25JZCA/PyBudWxsLFxuICAgICAgLi4uYm91bmRlZEluZmxpZ2h0LFxuICAgICAgb29tS2lsbGVkOiBzaWduYWwgPT09IFwiU0lHS0lMTFwiICYmIHNodXRkb3duUmVhc29uID09PSBcInNpZ25hbF9zaWdraWxsXCIgPyBudWxsIDogZmFsc2UsXG4gICAgICBvcmlnaW4sXG4gICAgICBydW5uZXJBZ2VNczogTWF0aC5tYXgoMCwgRGF0ZS5ub3coKSAtIHN0YXRlLmNyZWF0ZWRBdE1zKSxcbiAgICAgIHJ1bm5lckNyZWF0ZWRBdE1zOiBzdGF0ZS5jcmVhdGVkQXRNcyxcbiAgICAgIHJ1bm5lckRldGFjaGVkOiBmYWxzZSxcbiAgICAgIHJ1bm5lckpvYnNSdW46IHN0YXRlLmpvYnNSdW4sXG4gICAgICBydW5uZXJMaWZlY3ljbGUsXG4gICAgICBydW5uZXJQaWQ6IGNoaWxkLnBpZCA/PyBudWxsLFxuICAgICAgc2lnbmFsLFxuICAgICAgc2h1dGRvd25PYnNlcnZlZEF0TXM6IG9ic2VydmF0aW9uPy5zaHV0ZG93bk9ic2VydmVkQXRNcyA/PyBzdGF0ZS5pcGNEaXNjb25uZWN0ZWRBdE1zID8/IG51bGwsXG4gICAgICBzaHV0ZG93blJlcXVlc3RlZEF0TXM6IHN0YXRlLnNodXRkb3duUmVxdWVzdGVkQXRNcyA/PyBvYnNlcnZhdGlvbj8uc2h1dGRvd25SZXF1ZXN0ZWRBdE1zID8/IG51bGwsXG4gICAgICBzaHV0ZG93blJlYXNvbixcbiAgICAgIHNodXRkb3duU2lnbmFsOiBzdGF0ZS5zaHV0ZG93blNpZ25hbCA/PyBvYnNlcnZhdGlvbj8uc2lnbmFsID8/IHNpZ25hbCxcbiAgICAgIHRlcm1pbmF0aW9uUmVhc29uLFxuICAgICAgdGltZW91dEpvYklkOiBzdGF0ZS50aW1lb3V0Sm9iSWQgPz8gbnVsbCxcbiAgICAgIHdvcmtlcklkOiB0aGlzLndvcmtlcklkLFxuICAgICAgd29ya2VyTGlmZWN5Y2xlLFxuICAgICAgd29ya2VyUGlkOiBwcm9jZXNzLnBpZFxuICAgIH0pXG4gIH1cblxuICAvKipcbiAgICogUnVucyBydW4gam9iIGlubGluZS5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL3R5cGVzLmpzXCIpLkJhY2tncm91bmRKb2JQYXlsb2FkfSBwYXlsb2FkIC0gUGF5bG9hZC5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgd2hlbiBkb25lLlxuICAgKi9cbiAgYXN5bmMgX3J1bkpvYklubGluZShwYXlsb2FkKSB7XG4gICAgY29uc3QgY29uZmlndXJhdGlvbiA9IHRoaXMuY29uZmlndXJhdGlvblxuICAgIGlmICghY29uZmlndXJhdGlvbikgdGhyb3cgbmV3IEVycm9yKFwiQmFja2dyb3VuZCBqb2JzIHdvcmtlciBjb25maWd1cmF0aW9uIG5vdCBpbml0aWFsaXplZFwiKVxuXG4gICAgY29uc3QgcmVnaXN0cnkgPSBuZXcgQmFja2dyb3VuZEpvYlJlZ2lzdHJ5KHtjb25maWd1cmF0aW9ufSlcbiAgICBhd2FpdCByZWdpc3RyeS5sb2FkKClcbiAgICBjb25zdCBKb2JDbGFzcyA9IHJlZ2lzdHJ5LmdldEpvYkJ5TmFtZShwYXlsb2FkLmpvYk5hbWUpXG4gICAgYXdhaXQgcnVuV2l0aEJhY2tncm91bmRKb2JQYXlsb2FkKHBheWxvYWQsIGFzeW5jICgpID0+IHtcbiAgICAgIGF3YWl0IHBlcmZvcm1CYWNrZ3JvdW5kSm9iKHtcbiAgICAgICAgY29uZmlndXJhdGlvbixcbiAgICAgICAgSm9iQ2xhc3MsXG4gICAgICAgIGpvYkFyZ3M6IHBheWxvYWQuYXJncyB8fCBbXSxcbiAgICAgICAgam9iT3B0aW9uczogcGF5bG9hZC5vcHRpb25zIHx8IHt9LFxuICAgICAgICBuYW1lOiBgQmFja2dyb3VuZCBqb2Igd29ya2VyIGlubGluZTogJHtwYXlsb2FkLmpvYk5hbWV9YCxcbiAgICAgICAgcGF5bG9hZFxuICAgICAgfSlcbiAgICB9KVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZm9yayBqb2IuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi90eXBlcy5qc1wiKS5CYWNrZ3JvdW5kSm9iUGF5bG9hZCAmIHtpZDogc3RyaW5nfX0gcGF5bG9hZCAtIFBheWxvYWQuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIHdoZW4gdGhlIGZvcmtlZCBydW5uZXIgZXhpdHMgb3IgZm9yayBmYWlscy5cbiAgICovXG4gIF9mb3JrSm9iKHBheWxvYWQpIHtcbiAgICBjb25zdCBjaGlsZCA9IHRoaXMuX2NyZWF0ZUZvcmtlZENoaWxkKClcblxuICAgIHRoaXMuaW5mbGlnaHRQcm9jZXNzQ2hpbGRyZW4uYWRkKGNoaWxkKVxuXG4gICAgY29uc3QgZmluaXNoZWQgPSB0aGlzLl93YWl0Rm9yRm9ya2VkQ2hpbGQoe2NoaWxkLCBwYXlsb2FkfSlcblxuICAgIHRoaXMuX3NlbmRGb3JrZWRQYXlsb2FkKHtjaGlsZCwgcGF5bG9hZH0pXG5cbiAgICByZXR1cm4gZmluaXNoZWRcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGNyZWF0ZSBmb3JrZWQgY2hpbGQuXG4gICAqIEByZXR1cm5zIHtpbXBvcnQoXCJub2RlOmNoaWxkX3Byb2Nlc3NcIikuQ2hpbGRQcm9jZXNzfSAtIEZvcmtlZCBjaGlsZCBwcm9jZXNzLlxuICAgKi9cbiAgX2NyZWF0ZUZvcmtlZENoaWxkKCkge1xuICAgIGNvbnN0IGNvbmZpZ3VyYXRpb24gPSB0aGlzLmNvbmZpZ3VyYXRpb25cbiAgICBpZiAoIWNvbmZpZ3VyYXRpb24pIHRocm93IG5ldyBFcnJvcihcIkJhY2tncm91bmQgam9icyB3b3JrZXIgY29uZmlndXJhdGlvbiBub3QgaW5pdGlhbGl6ZWRcIilcblxuICAgIGNvbnN0IGRpcmVjdG9yeSA9IGNvbmZpZ3VyYXRpb24uZ2V0RGlyZWN0b3J5KClcbiAgICByZXR1cm4gZm9yayhGT1JLRURfUlVOTkVSX0VOVFJZX1BBVEgsIFtdLCB7XG4gICAgICBjd2Q6IGRpcmVjdG9yeSxcbiAgICAgIGV4ZWNBcmd2OiBbXSxcbiAgICAgIHN0ZGlvOiBbXCJpZ25vcmVcIiwgXCJpZ25vcmVcIiwgXCJpZ25vcmVcIiwgXCJpcGNcIl0sXG4gICAgICBlbnY6IE9iamVjdC5hc3NpZ24oe30sIHByb2Nlc3MuZW52LCB0aGlzLl9jaGlsZEJhY2tncm91bmRKb2JzRW52aXJvbm1lbnQoKSlcbiAgICB9KVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgd2FpdCBmb3IgZm9ya2VkIGNoaWxkLlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIE9wdGlvbnMuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwibm9kZTpjaGlsZF9wcm9jZXNzXCIpLkNoaWxkUHJvY2Vzc30gYXJncy5jaGlsZCAtIEZvcmtlZCBjaGlsZCBwcm9jZXNzLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vdHlwZXMuanNcIikuQmFja2dyb3VuZEpvYlBheWxvYWQgJiB7aWQ6IHN0cmluZ319IGFyZ3MucGF5bG9hZCAtIFBheWxvYWQuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIHdoZW4gdGhlIGNoaWxkIGV4aXRzLlxuICAgKi9cbiAgX3dhaXRGb3JGb3JrZWRDaGlsZCh7Y2hpbGQsIHBheWxvYWR9KSB7XG4gICAgY29uc3QgdGltZW91dFN0YXRlID0gdGhpcy5fYXJtRm9ya2VkSm9iVGltZW91dCh7Y2hpbGQsIHBheWxvYWR9KVxuXG4gICAgcmV0dXJuIG5ldyBQcm9taXNlKChyZXNvbHZlKSA9PiB7XG4gICAgICBjaGlsZC5vbmNlKFwiZXhpdFwiLCAoY29kZSwgc2lnbmFsKSA9PiB7XG4gICAgICAgIHRoaXMuX2NsZWFyRm9ya2VkSm9iVGltZW91dCh0aW1lb3V0U3RhdGUpXG4gICAgICAgIHRoaXMuX2hhbmRsZUZvcmtlZENoaWxkRXhpdCh7Y2hpbGQsIGNvZGUsIHNpZ25hbCwgcGF5bG9hZCwgcmVzb2x2ZSwgdGltZW91dFN0YXRlfSlcbiAgICAgIH0pXG4gICAgICBjaGlsZC5vbmNlKFwiZXJyb3JcIiwgKGVycm9yKSA9PiB7XG4gICAgICAgIHRoaXMuX2NsZWFyRm9ya2VkSm9iVGltZW91dCh0aW1lb3V0U3RhdGUpXG4gICAgICAgIHRoaXMuX2hhbmRsZUZvcmtlZENoaWxkRXJyb3Ioe2NoaWxkLCBlcnJvciwgcGF5bG9hZCwgcmVzb2x2ZX0pXG4gICAgICB9KVxuICAgIH0pXG4gIH1cblxuICAvKipcbiAgICogQXJtcyBhIHdhbGwtY2xvY2sgYmFja3N0b3AgZm9yIGEgZm9ya2VkIGpvYiBydW5uZXIuIEEgZm9ya2VkIGpvYiBzdGlsbFxuICAgKiBydW5uaW5nIGFmdGVyIGBqb2JUaW1lb3V0TXNgIGlzIHRlcm1pbmF0ZWQgKFNJR1RFUk0sIHRoZW4gU0lHS0lMTCBhZnRlciB0aGVcbiAgICogZ3JhY2UpIHNvIGEgc2luZ2xlIGdlbnVpbmVseS1odW5nIHJ1bm5lciBjYW4ndCBwaW4gYSBkcmFpbmluZyB3b3JrZXIg4oCUIGFuZFxuICAgKiBpdHMgZnVsbC1hcHAgYm9vdCBhbmQgZGF0YWJhc2UgY29ubmVjdGlvbnMg4oCUIGluZGVmaW5pdGVseS4gUmV0dXJucyBhIHN0YXRlXG4gICAqIG9iamVjdCB0aGUgZXhpdC9lcnJvciBoYW5kbGVycyB1c2UgdG8gY2FuY2VsIHRoZSB0aW1lciBhbmQgdG8gcmVwb3J0IGFcbiAgICogdGltZW91dC1zcGVjaWZpYyBmYWlsdXJlLiBXaGVuIG5vIHRpbWVvdXQgaXMgY29uZmlndXJlZCB0aGUgdGltZXIgaXMgbnVsbFxuICAgKiBhbmQgYmVoYXZpb3IgaXMgdW5jaGFuZ2VkLlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIE9wdGlvbnMuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwibm9kZTpjaGlsZF9wcm9jZXNzXCIpLkNoaWxkUHJvY2Vzc30gYXJncy5jaGlsZCAtIEZvcmtlZCBjaGlsZCBwcm9jZXNzLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vdHlwZXMuanNcIikuQmFja2dyb3VuZEpvYlBheWxvYWQgJiB7aWQ6IHN0cmluZ319IGFyZ3MucGF5bG9hZCAtIEpvYiBwYXlsb2FkLlxuICAgKiBAcmV0dXJucyB7Rm9ya2VkSm9iVGltZW91dFN0YXRlfSAtIFRpbWVvdXQgc3RhdGUuXG4gICAqL1xuICBfYXJtRm9ya2VkSm9iVGltZW91dCh7Y2hpbGQsIHBheWxvYWR9KSB7XG4gICAgY29uc3QgdGltZW91dE1zID0gdGhpcy5fcmVzb2x2ZUpvYlRpbWVvdXRNcyhwYXlsb2FkLm9wdGlvbnMpXG4gICAgLyoqIEB0eXBlIHtGb3JrZWRKb2JUaW1lb3V0U3RhdGV9ICovXG4gICAgY29uc3Qgc3RhdGUgPSB7dGltZWRPdXQ6IGZhbHNlLCB0aW1lb3V0TXMsIHRpbWVyOiBudWxsLCBzaWdraWxsVGltZXI6IG51bGx9XG5cbiAgICBpZiAoISh0eXBlb2YgdGltZW91dE1zID09PSBcIm51bWJlclwiICYmIHRpbWVvdXRNcyA+IDApKSByZXR1cm4gc3RhdGVcblxuICAgIHN0YXRlLnRpbWVyID0gc2V0VGltZW91dCgoKSA9PiB0aGlzLl9vbkZvcmtlZEpvYlRpbWVvdXQoe2NoaWxkLCBzdGF0ZX0pLCB0aW1lb3V0TXMpXG5cbiAgICByZXR1cm4gc3RhdGVcbiAgfVxuXG4gIC8qKlxuICAgKiBSZXNvbHZlcyB0aGUgZWZmZWN0aXZlIHdhbGwtY2xvY2sgam9iIHRpbWVvdXQgaW4gbXMgKHNoYXJlZCBieSBmb3JrZWQgYW5kIHBvb2xlZCBqb2JzKSwgb3IgbnVsbCB3aGVuIGRpc2FibGVkLiBUaGVcbiAgICogcGVyLWpvYiBvdmVycmlkZSB3aW5zLCBmb2xsb3dlZCBieSB0aGUgY29uc3RydWN0b3Igb3ZlcnJpZGUsIHRoZW4gdGhlIHZhbHVlXG4gICAqIGZyb20gdGhlIGJhY2tncm91bmQtam9icyBjb25maWd1cmF0aW9uLiBBIG5vbi1wb3NpdGl2ZSB2YWx1ZSBkaXNhYmxlcyB0aGVcbiAgICogYmFja3N0b3AgYXQgd2hpY2hldmVyIGxldmVsIHN1cHBsaWVkIGl0LlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vdHlwZXMuanNcIikuQmFja2dyb3VuZEpvYk9wdGlvbnN9IFtqb2JPcHRpb25zXSAtIFBlci1qb2Igb3B0aW9ucy5cbiAgICogQHJldHVybnMge251bWJlciB8IG51bGx9IC0gVGltZW91dCBpbiBtcywgb3IgbnVsbCB3aGVuIGRpc2FibGVkLlxuICAgKi9cbiAgX3Jlc29sdmVKb2JUaW1lb3V0TXMoam9iT3B0aW9ucykge1xuICAgIGNvbnN0IHJhdyA9IHR5cGVvZiBqb2JPcHRpb25zPy50aW1lb3V0TXMgPT09IFwibnVtYmVyXCJcbiAgICAgID8gam9iT3B0aW9ucy50aW1lb3V0TXNcbiAgICAgIDogKHR5cGVvZiB0aGlzLmpvYlRpbWVvdXRNc092ZXJyaWRlID09PSBcIm51bWJlclwiXG4gICAgICAgICAgPyB0aGlzLmpvYlRpbWVvdXRNc092ZXJyaWRlXG4gICAgICAgICAgOiAodGhpcy5jb25maWd1cmF0aW9uID8gdGhpcy5jb25maWd1cmF0aW9uLmdldEJhY2tncm91bmRKb2JzQ29uZmlnKCkuam9iVGltZW91dE1zIDogbnVsbCkpXG5cbiAgICAvLyBBIG5vbi1maW5pdGUgKGUuZy4gSW5maW5pdHkpIG9yIG5vbi1wb3NpdGl2ZSB2YWx1ZSBkaXNhYmxlcyB0aGUgYmFja3N0b3A7XG4gICAgLy8gYSBmaW5pdGUgdmFsdWUgYmV5b25kIE5vZGUncyB0aW1lciByYW5nZSBpcyBjbGFtcGVkIHRvIHRoZSBtYXggcmF0aGVyIHRoYW5cbiAgICAvLyBzaWxlbnRseSBjb2VyY2VkIHRvIH4xbXMgKHdoaWNoIHdvdWxkIGtpbGwgZXZlcnkgZm9ya2VkIGpvYiBpbW1lZGlhdGVseSkuXG4gICAgaWYgKHR5cGVvZiByYXcgIT09IFwibnVtYmVyXCIgfHwgIU51bWJlci5pc0Zpbml0ZShyYXcpIHx8IHJhdyA8PSAwKSByZXR1cm4gbnVsbFxuXG4gICAgcmV0dXJuIE1hdGgubWluKHJhdywgTUFYX0ZPUktFRF9KT0JfVElNRU9VVF9NUylcbiAgfVxuXG4gIC8qKlxuICAgKiBGaXJlZCB3aGVuIGEgZm9ya2VkIHJ1bm5lciBvdmVycnVucyBpdHMgdGltZW91dC4gU2VuZHMgU0lHVEVSTSBmb3IgYSBjbGVhblxuICAgKiBzaHV0ZG93biwgdGhlbiBTSUdLSUxMIGFmdGVyIHRoZSBncmFjZSBmb3IgYSBydW5uZXIgdGhhdCBpZ25vcmVzIGl0LiBUaGVcbiAgICogcmVzdWx0aW5nIG5vbi1jbGVhbiBleGl0IGZsb3dzIHRocm91Z2ggYF9oYW5kbGVGb3JrZWRDaGlsZEV4aXRgLCB3aGljaCBmcmVlc1xuICAgKiB0aGUgc2xvdCBhbmQgcmVwb3J0cyB0aGUgam9iIGZhaWxlZC5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBPcHRpb25zLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIm5vZGU6Y2hpbGRfcHJvY2Vzc1wiKS5DaGlsZFByb2Nlc3N9IGFyZ3MuY2hpbGQgLSBGb3JrZWQgY2hpbGQgcHJvY2Vzcy5cbiAgICogQHBhcmFtIHtGb3JrZWRKb2JUaW1lb3V0U3RhdGV9IGFyZ3Muc3RhdGUgLSBUaW1lb3V0IHN0YXRlLlxuICAgKiBAcmV0dXJucyB7dm9pZH1cbiAgICovXG4gIF9vbkZvcmtlZEpvYlRpbWVvdXQoe2NoaWxkLCBzdGF0ZX0pIHtcbiAgICBzdGF0ZS50aW1lZE91dCA9IHRydWVcblxuICAgIHRyeSB7XG4gICAgICBjaGlsZC5raWxsKFwiU0lHVEVSTVwiKVxuICAgIH0gY2F0Y2gge1xuICAgICAgLy8gQ2hpbGQgYWxyZWFkeSBleGl0ZWQ7IG5vdGhpbmcgdG8gZG8uXG4gICAgfVxuXG4gICAgc3RhdGUuc2lna2lsbFRpbWVyID0gc2V0VGltZW91dCgoKSA9PiB7XG4gICAgICB0cnkge1xuICAgICAgICBjaGlsZC5raWxsKFwiU0lHS0lMTFwiKVxuICAgICAgfSBjYXRjaCB7XG4gICAgICAgIC8vIENoaWxkIGFscmVhZHkgZXhpdGVkOyBub3RoaW5nIHRvIGRvLlxuICAgICAgfVxuICAgIH0sIHRoaXMuZm9ya2VkQ2hpbGRTaWdraWxsR3JhY2VNcylcbiAgfVxuXG4gIC8qKlxuICAgKiBDYW5jZWxzIGFueSBwZW5kaW5nIHRpbWVvdXQvU0lHS0lMTCB0aW1lcnMgZm9yIGEgZm9ya2VkIHJ1bm5lciB0aGF0IGhhc1xuICAgKiBleGl0ZWQgKG9yIGVycm9yZWQpIHNvIHRoZXkgbmV2ZXIgZmlyZSBhZ2FpbnN0IGEgZ29uZSBvciByZXVzZWQgY2hpbGQuXG4gICAqIEBwYXJhbSB7Rm9ya2VkSm9iVGltZW91dFN0YXRlfSBzdGF0ZSAtIFRpbWVvdXQgc3RhdGUuXG4gICAqIEByZXR1cm5zIHt2b2lkfVxuICAgKi9cbiAgX2NsZWFyRm9ya2VkSm9iVGltZW91dChzdGF0ZSkge1xuICAgIGlmIChzdGF0ZS50aW1lcikge1xuICAgICAgY2xlYXJUaW1lb3V0KHN0YXRlLnRpbWVyKVxuICAgICAgc3RhdGUudGltZXIgPSBudWxsXG4gICAgfVxuXG4gICAgaWYgKHN0YXRlLnNpZ2tpbGxUaW1lcikge1xuICAgICAgY2xlYXJUaW1lb3V0KHN0YXRlLnNpZ2tpbGxUaW1lcilcbiAgICAgIHN0YXRlLnNpZ2tpbGxUaW1lciA9IG51bGxcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogUnVucyBoYW5kbGUgZm9ya2VkIGNoaWxkIGV4aXQuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gT3B0aW9ucy5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCJub2RlOmNoaWxkX3Byb2Nlc3NcIikuQ2hpbGRQcm9jZXNzfSBhcmdzLmNoaWxkIC0gRm9ya2VkIGNoaWxkIHByb2Nlc3MuXG4gICAqIEBwYXJhbSB7bnVtYmVyIHwgbnVsbH0gYXJncy5jb2RlIC0gRXhpdCBjb2RlLlxuICAgKiBAcGFyYW0ge2tleW9mIHR5cGVvZiBpbXBvcnQoXCJub2RlOm9zXCIpLmNvbnN0YW50cy5zaWduYWxzIHwgbnVsbH0gYXJncy5zaWduYWwgLSBFeGl0IHNpZ25hbC5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL3R5cGVzLmpzXCIpLkJhY2tncm91bmRKb2JQYXlsb2FkICYge2lkOiBzdHJpbmd9fSBhcmdzLnBheWxvYWQgLSBQYXlsb2FkLlxuICAgKiBAcGFyYW0geyh2YWx1ZTogdm9pZCkgPT4gdm9pZH0gYXJncy5yZXNvbHZlIC0gUHJvbWlzZSByZXNvbHZlci5cbiAgICogQHBhcmFtIHtGb3JrZWRKb2JUaW1lb3V0U3RhdGV9IFthcmdzLnRpbWVvdXRTdGF0ZV0gLSBUaW1lb3V0IHN0YXRlLCB3aGVuIHRoZSBydW5uZXIgaGFkIGEgd2FsbC1jbG9jayBiYWNrc3RvcC5cbiAgICogQHJldHVybnMge3ZvaWR9XG4gICAqL1xuICBfaGFuZGxlRm9ya2VkQ2hpbGRFeGl0KHtjaGlsZCwgY29kZSwgc2lnbmFsLCBwYXlsb2FkLCByZXNvbHZlLCB0aW1lb3V0U3RhdGV9KSB7XG4gICAgdGhpcy5pbmZsaWdodFByb2Nlc3NDaGlsZHJlbi5kZWxldGUoY2hpbGQpXG5cbiAgICAvLyBGcmVlIHRoZSB3b3JrZXIgc2xvdCBhcyBzb29uIGFzIHRoZSBjaGlsZCBpcyBnb25lIOKAlCBuZXZlciBnYXRlIGl0IG9uIHRoZVxuICAgIC8vIGZhaWx1cmUgcmVwb3J0LiBBIGh1bmcvc2xvdyByZXBvcnQgbXVzdCBub3QgbGVhayB0aGUgc2xvdDsgZW5vdWdoIGxlYWtlZFxuICAgIC8vIHNsb3RzIGRyaXZlIGBhY2NlcHRzRm9ya2VkYCB0byBmYWxzZSBhbmQgc2lsZW50bHkgd2VkZ2UgdGhlIHdvcmtlci5cbiAgICByZXNvbHZlKHVuZGVmaW5lZClcblxuICAgIGlmICh0aGlzLl9mb3JrZWRDaGlsZEV4aXRlZENsZWFubHkoe2NvZGUsIHNpZ25hbH0pKSByZXR1cm5cblxuICAgIGNvbnN0IGVycm9yID0gdGltZW91dFN0YXRlPy50aW1lZE91dFxuICAgICAgPyBuZXcgRXJyb3IoYEZvcmtlZCBiYWNrZ3JvdW5kIGpvYiBydW5uZXIgdGltZWQgb3V0IGFmdGVyICR7dGltZW91dFN0YXRlLnRpbWVvdXRNc31tcyBhbmQgd2FzIHRlcm1pbmF0ZWQ6IGNvZGU9JHtjb2RlfSBzaWduYWw9JHtzaWduYWwgfHwgXCJub25lXCJ9YClcbiAgICAgIDogbmV3IEVycm9yKGBGb3JrZWQgYmFja2dyb3VuZCBqb2IgcnVubmVyIGV4aXRlZCBiZWZvcmUgcmVwb3J0aW5nOiBjb2RlPSR7Y29kZX0gc2lnbmFsPSR7c2lnbmFsIHx8IFwibm9uZVwifWApXG5cbiAgICB0aGlzLl9yZXBvcnRGb3JrZWRDaGlsZEZhaWx1cmUoe3BheWxvYWQsIGVycm9yfSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGZvcmtlZCBjaGlsZCBleGl0ZWQgY2xlYW5seS5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBPcHRpb25zLlxuICAgKiBAcGFyYW0ge251bWJlciB8IG51bGx9IGFyZ3MuY29kZSAtIEV4aXQgY29kZS5cbiAgICogQHBhcmFtIHtrZXlvZiB0eXBlb2YgaW1wb3J0KFwibm9kZTpvc1wiKS5jb25zdGFudHMuc2lnbmFscyB8IG51bGx9IGFyZ3Muc2lnbmFsIC0gRXhpdCBzaWduYWwuXG4gICAqIEByZXR1cm5zIHtib29sZWFufSAtIFdoZXRoZXIgdGhlIGNoaWxkIGV4aXRlZCBjbGVhbmx5LlxuICAgKi9cbiAgX2ZvcmtlZENoaWxkRXhpdGVkQ2xlYW5seSh7Y29kZSwgc2lnbmFsfSkge1xuICAgIHJldHVybiBjb2RlID09PSAwICYmICFzaWduYWxcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGhhbmRsZSBmb3JrZWQgY2hpbGQgZXJyb3IuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gT3B0aW9ucy5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCJub2RlOmNoaWxkX3Byb2Nlc3NcIikuQ2hpbGRQcm9jZXNzfSBhcmdzLmNoaWxkIC0gRm9ya2VkIGNoaWxkIHByb2Nlc3MuXG4gICAqIEBwYXJhbSB7RXJyb3J9IGFyZ3MuZXJyb3IgLSBDaGlsZCBwcm9jZXNzIGVycm9yLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vdHlwZXMuanNcIikuQmFja2dyb3VuZEpvYlBheWxvYWQgJiB7aWQ6IHN0cmluZ319IGFyZ3MucGF5bG9hZCAtIFBheWxvYWQuXG4gICAqIEBwYXJhbSB7KHZhbHVlOiB2b2lkKSA9PiB2b2lkfSBhcmdzLnJlc29sdmUgLSBQcm9taXNlIHJlc29sdmVyLlxuICAgKiBAcmV0dXJucyB7dm9pZH1cbiAgICovXG4gIF9oYW5kbGVGb3JrZWRDaGlsZEVycm9yKHtjaGlsZCwgZXJyb3IsIHBheWxvYWQsIHJlc29sdmV9KSB7XG4gICAgdGhpcy5pbmZsaWdodFByb2Nlc3NDaGlsZHJlbi5kZWxldGUoY2hpbGQpXG4gICAgLy8gRnJlZSB0aGUgc2xvdCBmaXJzdCAoc2VlIF9oYW5kbGVGb3JrZWRDaGlsZEV4aXQpIOKAlCByZXBvcnRpbmcgaXMgYmVzdC1lZmZvcnQuXG4gICAgcmVzb2x2ZSh1bmRlZmluZWQpXG4gICAgY29uc29sZS5lcnJvcihcIkJhY2tncm91bmQgam9icyBmb3JrZWQgcnVubmVyIGVycm9yOlwiLCBlcnJvcilcbiAgICB0aGlzLl9yZXBvcnRGb3JrZWRDaGlsZEZhaWx1cmUoe3BheWxvYWQsIGVycm9yfSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHNlbmQgZm9ya2VkIHBheWxvYWQuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gT3B0aW9ucy5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCJub2RlOmNoaWxkX3Byb2Nlc3NcIikuQ2hpbGRQcm9jZXNzfSBhcmdzLmNoaWxkIC0gRm9ya2VkIGNoaWxkIHByb2Nlc3MuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi90eXBlcy5qc1wiKS5CYWNrZ3JvdW5kSm9iUGF5bG9hZCAmIHtpZDogc3RyaW5nfX0gYXJncy5wYXlsb2FkIC0gUGF5bG9hZC5cbiAgICogQHJldHVybnMge3ZvaWR9XG4gICAqL1xuICBfc2VuZEZvcmtlZFBheWxvYWQoe2NoaWxkLCBwYXlsb2FkfSkge1xuICAgIHRyeSB7XG4gICAgICBjaGlsZC5zZW5kKHt0eXBlOiBcImpvYlwiLCBwYXlsb2FkfSlcbiAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgY2hpbGQua2lsbChcIlNJR1RFUk1cIilcbiAgICAgIHRoaXMuX3JlcG9ydEZvcmtlZENoaWxkRmFpbHVyZSh7cGF5bG9hZCwgZXJyb3J9KVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHJlcG9ydCBmb3JrZWQgY2hpbGQgZmFpbHVyZS5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBPcHRpb25zLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vdHlwZXMuanNcIikuQmFja2dyb3VuZEpvYlBheWxvYWQgJiB7aWQ6IHN0cmluZ319IGFyZ3MucGF5bG9hZCAtIFBheWxvYWQuXG4gICAqIEBwYXJhbSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59IGFyZ3MuZXJyb3IgLSBFcnJvci5cbiAgICogQHJldHVybnMge3ZvaWR9XG4gICAqL1xuICBfcmVwb3J0Rm9ya2VkQ2hpbGRGYWlsdXJlKHtwYXlsb2FkLCBlcnJvcn0pIHtcbiAgICB0aGlzLl9yZXBvcnRKb2JSZXN1bHRJbkJhY2tncm91bmQoe1xuICAgICAgam9iSWQ6IHBheWxvYWQuaWQsXG4gICAgICBzdGF0dXM6IFwiZmFpbGVkXCIsXG4gICAgICBlcnJvcixcbiAgICAgIGhhbmRvZmZJZDogcGF5bG9hZC5oYW5kb2ZmSWQsXG4gICAgICBoYW5kZWRPZmZBdE1zOiBwYXlsb2FkLmhhbmRlZE9mZkF0TXMsXG4gICAgICB3b3JrZXJJZDogcGF5bG9hZC53b3JrZXJJZCB8fCB0aGlzLndvcmtlcklkXG4gICAgfSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHNwYXduIGpvYi5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL3R5cGVzLmpzXCIpLkJhY2tncm91bmRKb2JQYXlsb2FkfSBwYXlsb2FkIC0gUGF5bG9hZC5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgd2hlbiB0aGUgc3Bhd25lZCBydW5uZXIgZXhpdHMgb3Igc3Bhd24gZmFpbHMuXG4gICAqL1xuICBfc3Bhd25Kb2IocGF5bG9hZCkge1xuICAgIGNvbnN0IGNvbmZpZ3VyYXRpb24gPSB0aGlzLmNvbmZpZ3VyYXRpb25cbiAgICBpZiAoIWNvbmZpZ3VyYXRpb24pIHRocm93IG5ldyBFcnJvcihcIkJhY2tncm91bmQgam9icyB3b3JrZXIgY29uZmlndXJhdGlvbiBub3QgaW5pdGlhbGl6ZWRcIilcblxuICAgIGNvbnN0IGRpcmVjdG9yeSA9IGNvbmZpZ3VyYXRpb24uZ2V0RGlyZWN0b3J5KClcbiAgICBjb25zdCBhcmd2Q29tbWFuZCA9IHByb2Nlc3MuYXJndlsxXVxuICAgIGNvbnN0IGNvbW1hbmQgPSBhcmd2Q29tbWFuZCA/IGFyZ3ZDb21tYW5kIDogYCR7ZGlyZWN0b3J5fS9iaW4vdmVsb2Npb3VzLmpzYFxuICAgIGNvbnN0IGVuY29kZWRQYXlsb2FkID0gQnVmZmVyLmZyb20oSlNPTi5zdHJpbmdpZnkocGF5bG9hZCkpLnRvU3RyaW5nKFwiYmFzZTY0XCIpXG4gICAgY29uc3QgY2hpbGQgPSBzcGF3bihwcm9jZXNzLmV4ZWNQYXRoLCBbY29tbWFuZCwgXCJiYWNrZ3JvdW5kLWpvYnMtcnVubmVyXCJdLCB7XG4gICAgICBjd2Q6IGRpcmVjdG9yeSxcbiAgICAgIGRldGFjaGVkOiB0cnVlLFxuICAgICAgc3RkaW86IFwiaWdub3JlXCIsXG4gICAgICBlbnY6IE9iamVjdC5hc3NpZ24oe30sIHByb2Nlc3MuZW52LCB0aGlzLl9jaGlsZEJhY2tncm91bmRKb2JzRW52aXJvbm1lbnQoKSwge1ZFTE9DSU9VU19KT0JfUEFZTE9BRDogZW5jb2RlZFBheWxvYWR9KVxuICAgIH0pXG5cbiAgICB0aGlzLmluZmxpZ2h0UHJvY2Vzc0NoaWxkcmVuLmFkZChjaGlsZClcblxuICAgIGNvbnN0IGZpbmlzaGVkID0gbmV3IFByb21pc2UoKHJlc29sdmUpID0+IHtcbiAgICAgIGNoaWxkLm9uY2UoXCJleGl0XCIsICgpID0+IHtcbiAgICAgICAgdGhpcy5pbmZsaWdodFByb2Nlc3NDaGlsZHJlbi5kZWxldGUoY2hpbGQpXG4gICAgICAgIHJlc29sdmUodW5kZWZpbmVkKVxuICAgICAgfSlcbiAgICAgIGNoaWxkLm9uY2UoXCJlcnJvclwiLCAoZXJyb3IpID0+IHtcbiAgICAgICAgdGhpcy5pbmZsaWdodFByb2Nlc3NDaGlsZHJlbi5kZWxldGUoY2hpbGQpXG4gICAgICAgIGNvbnNvbGUuZXJyb3IoXCJCYWNrZ3JvdW5kIGpvYnMgc3Bhd25lZCBydW5uZXIgZXJyb3I6XCIsIGVycm9yKVxuICAgICAgICByZXNvbHZlKHVuZGVmaW5lZClcbiAgICAgIH0pXG4gICAgfSlcblxuICAgIGNoaWxkLnVucmVmKClcblxuICAgIHJldHVybiBmaW5pc2hlZFxuICB9XG5cbiAgLyoqXG4gICAqIEJ1aWxkcyB0aGUgZXhhY3QgbWFpbiBlbmRwb2ludCBhbmQgZ2VuZXJhdGlvbiBpbmhlcml0ZWQgYnkgZXZlcnkgY2hpbGQuXG4gICAqIEByZXR1cm5zIHtSZWNvcmQ8c3RyaW5nLCBzdHJpbmc+fSAtIENoaWxkIHByb2Nlc3MgZW52aXJvbm1lbnQgYWRkaXRpb25zLlxuICAgKi9cbiAgX2NoaWxkQmFja2dyb3VuZEpvYnNFbnZpcm9ubWVudCgpIHtcbiAgICBjb25zdCBjb25maWd1cmF0aW9uID0gdGhpcy5jb25maWd1cmF0aW9uXG4gICAgaWYgKCFjb25maWd1cmF0aW9uKSB0aHJvdyBuZXcgRXJyb3IoXCJCYWNrZ3JvdW5kIGpvYnMgd29ya2VyIGNvbmZpZ3VyYXRpb24gbm90IGluaXRpYWxpemVkXCIpXG4gICAgaWYgKCF0aGlzLmhvc3QgfHwgdHlwZW9mIHRoaXMucG9ydCAhPT0gXCJudW1iZXJcIikgdGhyb3cgbmV3IEVycm9yKFwiQmFja2dyb3VuZCBqb2JzIHdvcmtlciBlbmRwb2ludCBub3QgcmVzb2x2ZWRcIilcblxuICAgIHJldHVybiB7XG4gICAgICBWRUxPQ0lPVVNfQkFDS0dST1VORF9KT0JfQ0hJTEQ6IFwiMVwiLFxuICAgICAgVkVMT0NJT1VTX0VOVjogY29uZmlndXJhdGlvbi5nZXRFbnZpcm9ubWVudCgpLFxuICAgICAgVkVMT0NJT1VTX0JBQ0tHUk9VTkRfSk9CU19IT1NUOiB0aGlzLmhvc3QsXG4gICAgICBWRUxPQ0lPVVNfQkFDS0dST1VORF9KT0JTX1BPUlQ6IGAke3RoaXMucG9ydH1gLFxuICAgICAgLi4uKHRoaXMuZ2VuZXJhdGlvbklkID8ge1ZFTE9DSU9VU19CQUNLR1JPVU5EX0pPQlNfR0VORVJBVElPTl9JRDogdGhpcy5nZW5lcmF0aW9uSWR9IDoge30pXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgcmVwb3J0IGpvYiByZXN1bHQuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gT3B0aW9ucy5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGFyZ3Muam9iSWQgLSBKb2IgaWQuXG4gICAqIEBwYXJhbSB7XCJjb21wbGV0ZWRcIiB8IFwiZmFpbGVkXCIgfCBcInJlc2NoZWR1bGVkXCJ9IGFyZ3Muc3RhdHVzIC0gU3RhdHVzLlxuICAgKiBAcGFyYW0ge251bWJlcn0gW2FyZ3MuZGVsYXlNc10gLSBSZXNjaGVkdWxlIGRlbGF5IGluIG1pbGxpc2Vjb25kcy5cbiAgICogQHBhcmFtIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gW2FyZ3MuZXJyb3JdIC0gRXJyb3IuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBbYXJncy5oYW5kb2ZmSWRdIC0gSGFuZG9mZiBsZWFzZSBpZC5cbiAgICogQHBhcmFtIHtudW1iZXJ9IFthcmdzLmhhbmRlZE9mZkF0TXNdIC0gSGFuZGVkIG9mZiB0aW1lc3RhbXAuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBbYXJncy53b3JrZXJJZF0gLSBXb3JrZXIgaWQuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi90eXBlcy5qc1wiKS5Qb29sZWRSdW5uZXJGYWlsdXJlfSBbYXJncy5ydW5uZXJGYWlsdXJlXSAtIFBvb2xlZC1jaGlsZCBwcm9jZXNzIGZhaWx1cmUgcHJvdmVuYW5jZS5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgd2hlbiByZXBvcnRlZC5cbiAgICovXG4gIGFzeW5jIF9yZXBvcnRKb2JSZXN1bHQoe2pvYklkLCBzdGF0dXMsIGRlbGF5TXMsIGVycm9yLCBoYW5kb2ZmSWQsIGhhbmRlZE9mZkF0TXMsIHdvcmtlcklkLCBydW5uZXJGYWlsdXJlfSkge1xuICAgIGlmICghdGhpcy5zdGF0dXNSZXBvcnRlcikgcmV0dXJuXG5cbiAgICB0cnkge1xuICAgICAgLy8gUmV0cnkgYSB0cmFuc2llbnQgcGVyc2lzdCBmYWlsdXJlIChgam9iLXVwZGF0ZS1lcnJvcmApOiB0aGUgd29ya2VyIGlzXG4gICAgICAvLyBsb25nLWxpdmVkIGFuZCBjYW5ub3QgZXhpdCB0byB0cmlnZ2VyIG9ycGhhbiByZWNsYWltLCBzbyBkcm9wcGluZyB0aGVcbiAgICAgIC8vIGNvbXBsZXRpb24gaGVyZSB3b3VsZCBzdHJhbmQgdGhlIGpvYiBpbiBgaGFuZGVkX29mZmAgZm9yZXZlciDigJQgZmF0YWwgZm9yIGFcbiAgICAgIC8vIGBtYXhfY29uY3VycmVuY3k6IDFgIGpvYiAoYSBzdHJhbmRlZCByb3cgYmxvY2tzIGV2ZXJ5IGZ1dHVyZSBydW4pLlxuICAgICAgYXdhaXQgdGhpcy5zdGF0dXNSZXBvcnRlci5yZXBvcnRXaXRoUmV0cnkoe2pvYklkLCBzdGF0dXMsIGRlbGF5TXMsIGVycm9yLCBoYW5kb2ZmSWQsIGhhbmRlZE9mZkF0TXMsIHdvcmtlcklkLCBydW5uZXJGYWlsdXJlLCByZXRyeVBlcnNpc3RFcnJvcnM6IHRydWV9KVxuICAgIH0gY2F0Y2ggKHJlcG9ydEVycm9yKSB7XG4gICAgICBjb25zb2xlLmVycm9yKFwiQmFja2dyb3VuZCBqb2Igc3RhdHVzIHJlcG9ydGluZyBmYWlsZWQ6XCIsIHJlcG9ydEVycm9yKVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBGaXJlcyBhIGR1cmFibGUgam9iLXJlc3VsdCByZXBvcnQgd2l0aG91dCBibG9ja2luZyB0aGUgY2FsbGVyIChzbyBmcmVlaW5nIGFcbiAgICogam9iL2NoaWxkIHNsb3QgbmV2ZXIgd2FpdHMgb24gdGhlIHJlcG9ydCkuIFRoZSByZXBvcnQgaXMgdHJhY2tlZCBzbyBhXG4gICAqIGdyYWNlZnVsIGBzdG9wKClgIGNhbiBkcmFpbiBpbi1mbGlnaHQgcmVwb3J0cyBiZWZvcmUgY2xvc2luZyB0aGUgc29ja2V0LlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIE9wdGlvbnMuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBhcmdzLmpvYklkIC0gSm9iIGlkLlxuICAgKiBAcGFyYW0ge1wiY29tcGxldGVkXCIgfCBcImZhaWxlZFwiIHwgXCJyZXNjaGVkdWxlZFwifSBhcmdzLnN0YXR1cyAtIFN0YXR1cy5cbiAgICogQHBhcmFtIHtudW1iZXJ9IFthcmdzLmRlbGF5TXNdIC0gUmVzY2hlZHVsZSBkZWxheSBpbiBtaWxsaXNlY29uZHMuXG4gICAqIEBwYXJhbSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59IFthcmdzLmVycm9yXSAtIEVycm9yLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gW2FyZ3MuaGFuZG9mZklkXSAtIEhhbmRvZmYgbGVhc2UgaWQuXG4gICAqIEBwYXJhbSB7bnVtYmVyfSBbYXJncy5oYW5kZWRPZmZBdE1zXSAtIEhhbmRlZCBvZmYgdGltZXN0YW1wLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gW2FyZ3Mud29ya2VySWRdIC0gV29ya2VyIGlkLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vdHlwZXMuanNcIikuUG9vbGVkUnVubmVyRmFpbHVyZX0gW2FyZ3MucnVubmVyRmFpbHVyZV0gLSBQb29sZWQtY2hpbGQgcHJvY2VzcyBmYWlsdXJlIHByb3ZlbmFuY2UuXG4gICAqIEByZXR1cm5zIHt2b2lkfVxuICAgKi9cbiAgX3JlcG9ydEpvYlJlc3VsdEluQmFja2dyb3VuZCh7am9iSWQsIHN0YXR1cywgZGVsYXlNcywgZXJyb3IsIGhhbmRvZmZJZCwgaGFuZGVkT2ZmQXRNcywgd29ya2VySWQsIHJ1bm5lckZhaWx1cmV9KSB7XG4gICAgLyoqXG4gICAgICogRGVmaW5lcyByZXBvcnQuXG4gICAgICogQHR5cGUge1Byb21pc2U8dm9pZD59ICovXG4gICAgbGV0IHJlcG9ydFxuXG4gICAgcmVwb3J0ID0gdGhpcy5fcmVwb3J0Sm9iUmVzdWx0KHtqb2JJZCwgc3RhdHVzLCBkZWxheU1zLCBlcnJvciwgaGFuZG9mZklkLCBoYW5kZWRPZmZBdE1zLCB3b3JrZXJJZCwgcnVubmVyRmFpbHVyZX0pLmZpbmFsbHkoKCkgPT4ge1xuICAgICAgdGhpcy5pbmZsaWdodFJlcG9ydHMuZGVsZXRlKHJlcG9ydClcbiAgICB9KVxuXG4gICAgdGhpcy5pbmZsaWdodFJlcG9ydHMuYWRkKHJlcG9ydClcbiAgfVxufVxuIl19