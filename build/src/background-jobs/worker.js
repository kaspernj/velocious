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
     * @param {number} [args.runnerMaxOldSpaceSizeMb] - Override the V8 heap cap (MiB, `--max-old-space-size`) applied to runner children.
     * @param {number} [args.runnerMallocArenaMax] - Override `MALLOC_ARENA_MAX` for runner children.
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
    constructor({ configuration, host, port, generationId, workerInstanceId, maxConcurrentForkedJobs, maxConcurrentInlineJobs, pooledRunnerCount, pooledRunnerConcurrency, pooledRunnerMaxJobs, pooledRunnerMaxRssBytes, pooledRunnerMaxLifetimeMs, runnerMaxOldSpaceSizeMb, runnerMallocArenaMax, forkedChildSigkillGraceMs, heartbeatIntervalMs, generationHandshakeTimeoutMs = DEFAULT_GENERATION_HANDSHAKE_TIMEOUT_MS, reconnectDelayMs = 1000, jobTimeoutMs, closeDatabaseConnectionsOnStop = true, onStopped, onGenerationAccepted, onRetireMessage, onPooledRunnerMemoryObservation } = {}) {
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
        this.runnerMaxOldSpaceSizeMbOverride = positiveInteger(runnerMaxOldSpaceSizeMb);
        this.runnerMallocArenaMaxOverride = positiveInteger(runnerMallocArenaMax);
        this.pooledRunnerCount = this.pooledRunnerCountOverride || 4;
        this.pooledRunnerConcurrency = this.pooledRunnerConcurrencyOverride || 1;
        this.pooledRunnerMaxJobs = this.pooledRunnerMaxJobsOverride || 100;
        this.pooledRunnerMaxRssBytes = this.pooledRunnerMaxRssBytesOverride || 512 * 1024 * 1024;
        this.pooledRunnerMaxLifetimeMs = this.pooledRunnerMaxLifetimeMsOverride || 60 * 60 * 1000;
        this.runnerMaxOldSpaceSizeMb = this.runnerMaxOldSpaceSizeMbOverride || 2048;
        this.runnerMallocArenaMax = this.runnerMallocArenaMaxOverride || 4;
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
        if (typeof this.runnerMaxOldSpaceSizeMbOverride !== "number" && typeof poolConfig.runnerMaxOldSpaceSizeMb === "number")
            this.runnerMaxOldSpaceSizeMb = poolConfig.runnerMaxOldSpaceSizeMb;
        if (typeof this.runnerMallocArenaMaxOverride !== "number" && typeof poolConfig.runnerMallocArenaMax === "number")
            this.runnerMallocArenaMax = poolConfig.runnerMallocArenaMax;
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
            cwd: configuration.getDirectory(), execArgv: this._childRunnerExecArgv(), stdio: ["ignore", "ignore", "ignore", "ipc"],
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
            execArgv: this._childRunnerExecArgv(),
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
        const child = spawn(process.execPath, [...this._childRunnerExecArgv(), command, "background-jobs-runner"], {
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
     * Builds the node options applied to every background-jobs runner child.
     * A hard V8 heap cap keeps one child from ever committing multiple GBs of
     * heap; it stays deliberately generous relative to observed runner usage
     * (tens to a few hundred MB) and is configurable via
     * `backgroundJobs.runnerMaxOldSpaceSizeMb`.
     * @returns {string[]} - Node options for runner children.
     */
    _childRunnerExecArgv() {
        return [`--max-old-space-size=${this.runnerMaxOldSpaceSizeMb}`];
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
            MALLOC_ARENA_MAX: `${this.runnerMallocArenaMax}`,
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoid29ya2VyLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiLi4vLi4vLi4vc3JjL2JhY2tncm91bmQtam9icy93b3JrZXIuanMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6IkFBQUEsWUFBWTtBQUVaLE9BQU8sR0FBRyxNQUFNLEtBQUssQ0FBQTtBQUNyQixPQUFPLEVBQUUsSUFBSSxFQUFFLEtBQUssRUFBRSxNQUFNLG9CQUFvQixDQUFBO0FBQ2hELE9BQU8sVUFBVSxNQUFNLGtCQUFrQixDQUFBO0FBQ3pDLE9BQU8scUJBQXFCLE1BQU0sbUJBQW1CLENBQUE7QUFDckQsT0FBTyxxQkFBcUIsTUFBTSw4QkFBOEIsQ0FBQTtBQUNoRSxPQUFPLDRCQUE0QixNQUFNLHNCQUFzQixDQUFBO0FBQy9ELE9BQU8sRUFBRSxVQUFVLEVBQUUsTUFBTSxRQUFRLENBQUE7QUFDbkMsT0FBTyxFQUFFLGFBQWEsRUFBRSxNQUFNLFVBQVUsQ0FBQTtBQUN4QyxPQUFPLGlCQUFpQixFQUFFLEVBQUUsZ0JBQWdCLEVBQUUsTUFBTSxnQ0FBZ0MsQ0FBQTtBQUNwRixPQUFPLDZCQUE2QixNQUFNLHdCQUF3QixDQUFBO0FBQ2xFLE9BQU8sb0JBQW9CLE1BQU0sa0JBQWtCLENBQUE7QUFDbkQsT0FBTyxFQUFFLDJCQUEyQixFQUFFLE1BQU0sd0JBQXdCLENBQUE7QUFDcEUsT0FBTyxFQUFFLHdCQUF3QixFQUFFLE1BQU0sMEJBQTBCLENBQUE7QUFDbkUsT0FBTyw2Q0FBNkMsRUFBRSxFQUFFLHVDQUF1QyxFQUFFLG9DQUFvQyxFQUFFLE1BQU0seUNBQXlDLENBQUE7QUFDdEwsT0FBTyxFQUFFLG1DQUFtQyxFQUFFLGlDQUFpQyxFQUFFLDJCQUEyQixFQUFFLDJCQUEyQixFQUFFLE1BQU0sNkJBQTZCLENBQUE7QUFFOUs7Ozs7Ozs7R0FPRztBQUNIOzs7Ozs7R0FNRztBQUNIOzs7Ozs7Ozs7Ozs7Ozs7Ozs7O0dBbUJHO0FBQ0gsaUZBQWlGO0FBQ2pGLE1BQU0sNkJBQTZCLEdBQUcs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QUUsT0FBTyxFQUFFLEtBQUssRUFBRSxTQUFTLEVBQUUsYUFBYSxFQUFFLFFBQVEsRUFBRSxhQUFhLEVBQUUsa0JBQWtCLEVBQUUsSUFBSSxFQUFDLENBQUMsQ0FBQTtRQUN6SixDQUFDO1FBQUMsT0FBTyxXQUFXLEVBQUUsQ0FBQztZQUNyQixPQUFPLENBQUMsS0FBSyxDQUFDLHlDQUF5QyxFQUFFLFdBQVcsQ0FBQyxDQUFBO1FBQ3ZFLENBQUM7SUFDSCxDQUFDO0lBRUQ7Ozs7Ozs7Ozs7Ozs7O09BY0c7SUFDSCw0QkFBNEIsQ0FBQyxFQUFDLEtBQUssRUFBRSxNQUFNLEVBQUUsT0FBTyxFQUFFLEtBQUssRUFBRSxTQUFTLEVBQUUsYUFBYSxFQUFFLFFBQVEsRUFBRSxhQUFhLEVBQUM7UUFDN0c7O21DQUUyQjtRQUMzQixJQUFJLE1BQU0sQ0FBQTtRQUVWLE1BQU0sR0FBRyxJQUFJLENBQUMsZ0JBQWdCLENBQUMsRUFBQyxLQUFLLEVBQUUsTUFBTSxFQUFFLE9BQU8sRUFBRSxLQUFLLEVBQUUsU0FBUyxFQUFFLGFBQWEsRUFBRSxRQUFRLEVBQUUsYUFBYSxFQUFDLENBQUMsQ0FBQyxPQUFPLENBQUMsR0FBRyxFQUFFO1lBQzlILElBQUksQ0FBQyxlQUFlLENBQUMsTUFBTSxDQUFDLE1BQU0sQ0FBQyxDQUFBO1FBQ3JDLENBQUMsQ0FBQyxDQUFBO1FBRUYsSUFBSSxDQUFDLGVBQWUsQ0FBQyxHQUFHLENBQUMsTUFBTSxDQUFDLENBQUE7SUFDbEMsQ0FBQztDQUNGIiwic291cmNlc0NvbnRlbnQiOlsiLy8gQHRzLWNoZWNrXG5cbmltcG9ydCBuZXQgZnJvbSBcIm5ldFwiXG5pbXBvcnQgeyBmb3JrLCBzcGF3biB9IGZyb20gXCJub2RlOmNoaWxkX3Byb2Nlc3NcIlxuaW1wb3J0IEpzb25Tb2NrZXQgZnJvbSBcIi4vanNvbi1zb2NrZXQuanNcIlxuaW1wb3J0IEJhY2tncm91bmRKb2JSZWdpc3RyeSBmcm9tIFwiLi9qb2ItcmVnaXN0cnkuanNcIlxuaW1wb3J0IGNvbmZpZ3VyYXRpb25SZXNvbHZlciBmcm9tIFwiLi4vY29uZmlndXJhdGlvbi1yZXNvbHZlci5qc1wiXG5pbXBvcnQgQmFja2dyb3VuZEpvYnNTdGF0dXNSZXBvcnRlciBmcm9tIFwiLi9zdGF0dXMtcmVwb3J0ZXIuanNcIlxuaW1wb3J0IHsgcmFuZG9tVVVJRCB9IGZyb20gXCJjcnlwdG9cIlxuaW1wb3J0IHsgZmlsZVVSTFRvUGF0aCB9IGZyb20gXCJub2RlOnVybFwiXG5pbXBvcnQgc2h1dGRvd25MaWZlY3ljbGUsIHsgcnVuU2h1dGRvd25TdGVwcyB9IGZyb20gXCIuLi91dGlscy9zaHV0ZG93bi1saWZlY3ljbGUuanNcIlxuaW1wb3J0IEJhY2tncm91bmRKb2JSZXNjaGVkdWxlU2lnbmFsIGZyb20gXCIuL3Jlc2NoZWR1bGUtc2lnbmFsLmpzXCJcbmltcG9ydCBwZXJmb3JtQmFja2dyb3VuZEpvYiBmcm9tIFwiLi9wZXJmb3JtLWpvYi5qc1wiXG5pbXBvcnQgeyBydW5XaXRoQmFja2dyb3VuZEpvYlBheWxvYWQgfSBmcm9tIFwiLi9leGVjdXRpb24tY29udGV4dC5qc1wiXG5pbXBvcnQgeyBjcmVhdGVHZW5lcmF0aW9uV29ya2VySWQgfSBmcm9tIFwiLi9nZW5lcmF0aW9uLWlkZW50aXR5LmpzXCJcbmltcG9ydCBCYWNrZ3JvdW5kSm9ic0dlbmVyYXRpb25IYW5kc2hha2VUaW1lb3V0RXJyb3IsIHsgREVGQVVMVF9HRU5FUkFUSU9OX0hBTkRTSEFLRV9USU1FT1VUX01TLCB2YWxpZGF0ZUdlbmVyYXRpb25IYW5kc2hha2VUaW1lb3V0TXMgfSBmcm9tIFwiLi9nZW5lcmF0aW9uLWhhbmRzaGFrZS10aW1lb3V0LWVycm9yLmpzXCJcbmltcG9ydCB7IFBPT0xFRF9SVU5ORVJfSU5GTElHSFRfSk9CX0lEX0xJTUlULCBib3VuZGVkUG9vbGVkUnVubmVySW5mbGlnaHRKb2JJZHMsIGlzUG9vbGVkQ2hpbGRTaHV0ZG93blJlYXNvbiwgaXNQb29sZWRDaGlsZFNodXRkb3duU2lnbmFsIH0gZnJvbSBcIi4vcG9vbGVkLXJ1bm5lci1zaHV0ZG93bi5qc1wiXG5cbi8qKlxuICogUGVyLWZvcmtlZC1jaGlsZCB0aW1lb3V0IGJvb2trZWVwaW5nLlxuICogQHR5cGVkZWYge29iamVjdH0gRm9ya2VkSm9iVGltZW91dFN0YXRlXG4gKiBAcHJvcGVydHkge2Jvb2xlYW59IHRpbWVkT3V0IC0gV2hldGhlciB0aGUgdGltZW91dCBmaXJlZCBhbmQgdGhlIGNoaWxkIHdhcyB0ZXJtaW5hdGVkLlxuICogQHByb3BlcnR5IHtudW1iZXIgfCBudWxsfSB0aW1lb3V0TXMgLSBUaGUgYXJtZWQgdGltZW91dCBpbiBtcywgb3IgbnVsbCB3aGVuIGRpc2FibGVkLlxuICogQHByb3BlcnR5IHtSZXR1cm5UeXBlPHR5cGVvZiBzZXRUaW1lb3V0PiB8IG51bGx9IHRpbWVyIC0gVGhlIHBlbmRpbmcgdGltZW91dCB0aW1lciwgY2xlYXJlZCBvbiBleGl0LlxuICogQHByb3BlcnR5IHtSZXR1cm5UeXBlPHR5cGVvZiBzZXRUaW1lb3V0PiB8IG51bGx9IHNpZ2tpbGxUaW1lciAtIFRoZSBwZW5kaW5nIFNJR0tJTEwgZ3JhY2UgdGltZXIsIGNsZWFyZWQgb24gZXhpdC5cbiAqL1xuLyoqXG4gKiBAdHlwZWRlZiB7b2JqZWN0fSBQb29sZWRKb2JFbnRyeVxuICogQHByb3BlcnR5IHtpbXBvcnQoXCIuL3R5cGVzLmpzXCIpLkJhY2tncm91bmRKb2JQYXlsb2FkICYge2lkOiBzdHJpbmd9fSBwYXlsb2FkIC0gRHVyYWJsZSBqb2IgcGF5bG9hZC5cbiAqIEBwcm9wZXJ0eSB7KHZhbHVlOiB2b2lkKSA9PiB2b2lkfSBbcmVzb2x2ZV0gLSBDb21wbGV0aW9uIHJlc29sdmVyLlxuICogQHByb3BlcnR5IHtQcm9taXNlPHZvaWQ+fSBbcG9vbGVkSm9iXSAtIFRyYWNrZWQgcG9vbGVkLWpvYiBwcm9taXNlLlxuICogQHByb3BlcnR5IHtSZXR1cm5UeXBlPHR5cGVvZiBzZXRUaW1lb3V0PiB8IG51bGx9IFt0aW1lb3V0VGltZXJdIC0gUGVyLWpvYiB0aW1lb3V0IHRpbWVyLlxuICovXG4vKipcbiAqIEB0eXBlZGVmIHtvYmplY3R9IFBvb2xlZENoaWxkU3RhdGVcbiAqIEBwcm9wZXJ0eSB7bnVtYmVyfSBjcmVhdGVkQXRNcyAtIENoaWxkIGNyZWF0aW9uIHRpbWVzdGFtcC5cbiAqIEBwcm9wZXJ0eSB7c3RyaW5nfSBbY2hpbGRJbnN0YW5jZUlkXSAtIFN0YWJsZSBpZGVudGl0eSByZXBvcnRlZCBieSB0aGUgY2hpbGQuXG4gKiBAcHJvcGVydHkge251bWJlcn0gam9ic1J1biAtIEFja25vd2xlZGdlZCBqb2JzIGNvbXBsZXRlZCBieSB0aGlzIGNoaWxkLlxuICogQHByb3BlcnR5IHtNYXA8c3RyaW5nLCBQb29sZWRKb2JFbnRyeT59IGluZmxpZ2h0IC0gSm9icyBjdXJyZW50bHkgb3duZWQgYnkgdGhpcyBjaGlsZC5cbiAqIEBwcm9wZXJ0eSB7bnVtYmVyfSBsYXN0RGlzcGF0Y2hTZXEgLSBSb3VuZC1yb2JpbiBkaXNwYXRjaCBzZXF1ZW5jZS5cbiAqIEBwcm9wZXJ0eSB7Ym9vbGVhbn0gcmV0aXJpbmcgLSBXaGV0aGVyIHRoaXMgY2hpbGQgaXMgZHJhaW5pbmcgYmVmb3JlIHJldGlyZW1lbnQuXG4gKiBAcHJvcGVydHkge2Jvb2xlYW59IFtzdGFydGVkXSAtIFdoZXRoZXIgdGhlIGNoaWxkIGNvbXBsZXRlZCBpdHMgc3RhcnR1cCBoYW5kc2hha2UuXG4gKiBAcHJvcGVydHkge2Jvb2xlYW59IFtzZXR0bGluZ10gLSBXaGV0aGVyIGZhaWx1cmUgaGFuZGxpbmcgYWxyZWFkeSBvd25zIHRoaXMgY2hpbGQuXG4gKiBAcHJvcGVydHkge2ltcG9ydChcIi4vdHlwZXMuanNcIikuUG9vbGVkQ2hpbGRNZW1vcnlPYnNlcnZhdGlvbn0gW2xhc3RNZW1vcnlPYnNlcnZhdGlvbl0gLSBMYXRlc3QgbWVtb3J5IG9ic2VydmF0aW9uIHJlY2VpdmVkIGZyb20gdGhpcyBjaGlsZC5cbiAqIEBwcm9wZXJ0eSB7bnVtYmVyfSBbaXBjRGlzY29ubmVjdGVkQXRNc10gLSBQYXJlbnQgb2JzZXJ2YXRpb24gb2YgSVBDIGRpc2Nvbm5lY3QuXG4gKiBAcHJvcGVydHkge2ltcG9ydChcIi4vdHlwZXMuanNcIikuUG9vbGVkQ2hpbGRTaHV0ZG93bk9ic2VydmF0aW9ufSBbc2h1dGRvd25PYnNlcnZhdGlvbl0gLSBDaGlsZCBvYnNlcnZhdGlvbiBzZW50IGJlZm9yZSB0ZWFyZG93bi5cbiAqIEBwcm9wZXJ0eSB7aW1wb3J0KFwiLi90eXBlcy5qc1wiKS5Qb29sZWRDaGlsZFNodXRkb3duUmVhc29ufSBbc2h1dGRvd25SZWFzb25dIC0gRXhhY3QgcGFyZW50LXJlcXVlc3RlZCBzaHV0ZG93biByZWFzb24uXG4gKiBAcHJvcGVydHkge251bWJlcn0gW3NodXRkb3duUmVxdWVzdGVkQXRNc10gLSBFeGFjdCBwYXJlbnQgc2h1dGRvd24tcmVxdWVzdCB0aW1lc3RhbXAuXG4gKiBAcHJvcGVydHkge2ltcG9ydChcIm5vZGU6Y2hpbGRfcHJvY2Vzc1wiKS5DaGlsZFByb2Nlc3NbXCJzaWduYWxDb2RlXCJdfSBbc2h1dGRvd25TaWduYWxdIC0gU2lnbmFsIHNlbGVjdGVkIGJ5IHRoZSBwYXJlbnQgcmVxdWVzdC5cbiAqIEBwcm9wZXJ0eSB7UmV0dXJuVHlwZTx0eXBlb2Ygc2V0VGltZW91dD59IFtzaHV0ZG93blNpZ25hbFRpbWVyXSAtIERyYWluZWQtcmV0aXJlbWVudCBmYWxsYmFjayBzaWduYWwgdGltZXIuXG4gKiBAcHJvcGVydHkge1JldHVyblR5cGU8dHlwZW9mIHNldFRpbWVvdXQ+IHwgbnVsbH0gW3RpbWVvdXRTaWdraWxsVGltZXJdIC0gUGVuZGluZyB0aW1lb3V0IFNJR0tJTEwgdGltZXIuXG4gKiBAcHJvcGVydHkge3N0cmluZ30gW3RpbWVvdXRKb2JJZF0gLSBKb2Igd2hvc2UgdGltZW91dCBpbml0aWF0ZWQgdGVybWluYXRpb24uXG4gKi9cbi8qKiBHcmFjZSBwZXJpb2QgYWZ0ZXIgU0lHVEVSTSBiZWZvcmUgYSBsaW5nZXJpbmcgcHJvY2VzcyBydW5uZXIgaXMgU0lHS0lMTGVkLiAqL1xuY29uc3QgRk9SS0VEX0NISUxEX1NJR0tJTExfR1JBQ0VfTVMgPSA1MDAwXG4vKiogVGltZSBhIGRyYWluZWQgcmV0aXJlbWVudCBnaXZlcyB0aGUgY2hpbGQgSVBDIHJlcXVlc3QgdG8gYmVnaW4gdGVhcmRvd24gYmVmb3JlIFNJR1RFUk0gZmFsbGJhY2suICovXG5jb25zdCBQT09MRURfUlVOTkVSX1NIVVRET1dOX1JFUVVFU1RfR1JBQ0VfTVMgPSAyNTBcbi8qKlxuICogTGFyZ2VzdCBkZWxheSBOb2RlJ3MgYHNldFRpbWVvdXRgIGFjY2VwdHMgd2l0aG91dCBvdmVyZmxvd2luZyB0byBhIDFtcyBkZWxheVxuICogKGEgMzItYml0IHNpZ25lZCBpbnQgb2YgbXMsIH4yNC44IGRheXMpLiBBIGBqb2JUaW1lb3V0TXNgIGFib3ZlIHRoaXMg4oCUIG9yIGFcbiAqIG5vbi1maW5pdGUgb25lIGxpa2UgYEluZmluaXR5YCDigJQgaXMgY2xhbXBlZC9kaXNhYmxlZCByYXRoZXIgdGhhbiBjb2VyY2VkIHRvXG4gKiB+MW1zLCB3aGljaCB3b3VsZCBvdGhlcndpc2UgdGVybWluYXRlIGV2ZXJ5IGZvcmtlZCBqb2IgYWxtb3N0IGltbWVkaWF0ZWx5LlxuICovXG5jb25zdCBNQVhfRk9SS0VEX0pPQl9USU1FT1VUX01TID0gMl8xNDdfNDgzXzY0N1xuY29uc3QgRk9SS0VEX1JVTk5FUl9FTlRSWV9QQVRIID0gZmlsZVVSTFRvUGF0aChuZXcgVVJMKFwiLi9mb3JrZWQtcnVubmVyLWNoaWxkLmpzXCIsIGltcG9ydC5tZXRhLnVybCkpXG5jb25zdCBQT09MRURfUlVOTkVSX0VOVFJZX1BBVEggPSBmaWxlVVJMVG9QYXRoKG5ldyBVUkwoXCIuL3Bvb2xlZC1ydW5uZXItY2hpbGQuanNcIiwgaW1wb3J0Lm1ldGEudXJsKSlcbi8qKiBIb3cgb2Z0ZW4gdGhlIHdvcmtlciBzZW5kcyBhIGxpdmVuZXNzIGhlYXJ0YmVhdCB0byB0aGUgbWFpbi4gKi9cbmNvbnN0IEhFQVJUQkVBVF9JTlRFUlZBTF9NUyA9IDE1MDAwXG4vKipcbiAqIE1heCB0aW1lIHRoZSB3b3JrZXIgc3BlbmRzIHJldHJ5aW5nIG9uZSBwb29sZWQgY2hpbGQncyBhY2NlcHRhbmNlIHJlcG9ydFxuICogYmVmb3JlIGRyb3BwaW5nIGl0LiBBY2NlcHRhbmNlIGV2aWRlbmNlIGlzIGRpYWdub3N0aWMg4oCUIGEgcGVyc2lzdGVudFxuICogbWFpbi9EQiBvdXRhZ2UgbXVzdCBub3QgaG9sZCBydW5uZXIgY2FwYWNpdHkgaG9zdGFnZS5cbiAqL1xuY29uc3QgQ0hJTERfQUNDRVBUQU5DRV9SRVBPUlRfTUFYX0RVUkFUSU9OX01TID0gMTAwMDBcbi8qKiBUQ1Aga2VlcGFsaXZlIHNvIGEgaGFsZi1vcGVuIGNvbm5lY3Rpb24gdG8gdGhlIG1haW4gc3VyZmFjZXMgYXMgYSBjbG9zZS4gKi9cbmNvbnN0IFNPQ0tFVF9LRUVQQUxJVkVfTVMgPSAxMDAwMFxuLyoqXG4gKiBFeGVjdXRpb24gbW9kZXMuXG4gKiBAdHlwZSB7aW1wb3J0KFwiLi90eXBlcy5qc1wiKS5CYWNrZ3JvdW5kSm9iRXhlY3V0aW9uTW9kZVtdfSAqL1xuY29uc3QgRVhFQ1VUSU9OX01PREVTID0gW1wiaW5saW5lXCIsIFwiZm9ya2VkXCIsIFwicG9vbGVkXCIsIFwic3Bhd25lZFwiXVxuXG4vKipcbiAqIE5vcm1hbGl6ZXMgYSBjYW5kaWRhdGUgcG9vbGVkLXJ1bm5lciBjb3VudCBvciBqb2IgbGltaXQuXG4gKiBAcGFyYW0ge251bWJlciB8IHVuZGVmaW5lZH0gdmFsdWUgLSBDYW5kaWRhdGUgcG9zaXRpdmUgaW50ZWdlci5cbiAqIEByZXR1cm5zIHtudW1iZXIgfCB1bmRlZmluZWR9IC0gTm9ybWFsaXplZCB2YWx1ZS5cbiAqL1xuZnVuY3Rpb24gcG9zaXRpdmVJbnRlZ2VyKHZhbHVlKSB7XG4gIHJldHVybiB0eXBlb2YgdmFsdWUgPT09IFwibnVtYmVyXCIgJiYgTnVtYmVyLmlzSW50ZWdlcih2YWx1ZSkgJiYgdmFsdWUgPiAwID8gdmFsdWUgOiB1bmRlZmluZWRcbn1cblxuLyoqXG4gKiBDaGVja3Mgd2hldGhlciBhbiBJUEMgdmFsdWUgaXMgYSBwb29sZWQgY2hpbGQncyBhY2NlcHRhbmNlIG9ic2VydmF0aW9uIGZvclxuICogb25lIGpvYi4gVGhlIGNoaWxkIGNhcnJpZXMgaXRzIGV4YWN0IGhhbmRvZmYgbGVhc2Ugc28gdGhlIHdvcmtlciBjYW4gZm9yd2FyZFxuICogdGhlIHJlcG9ydCB3aXRob3V0IGRlcGVuZGluZyBvbiBpdHMgaW4tZmxpZ2h0IGVudHJ5IHN0aWxsIGV4aXN0aW5nLlxuICogQHBhcmFtIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gbWVzc2FnZSAtIElQQyBtZXNzYWdlLlxuICogQHJldHVybnMge21lc3NhZ2UgaXMge3R5cGU6IFwiam9iLXJlY2VpdmVkXCIgfCBcImpvYi1zdGFydGVkXCIsIGpvYklkOiBzdHJpbmcsIGhhbmRvZmZJZD86IHN0cmluZywgd29ya2VySWQ/OiBzdHJpbmcsIGhhbmRlZE9mZkF0TXM/OiBudW1iZXIsIHJlY2VpdmVkQXRNcz86IG51bWJlciwgc3RhcnRlZEF0TXM/OiBudW1iZXIsIGNoaWxkSW5zdGFuY2VJZD86IHN0cmluZywgY2hpbGRQaWQ/OiBudW1iZXJ9fSAtIFdoZXRoZXIgdGhpcyBpcyBhIHZhbGlkIGFjY2VwdGFuY2UgbWVzc2FnZS5cbiAqL1xuZnVuY3Rpb24gaXNDaGlsZEFjY2VwdGFuY2VNZXNzYWdlKG1lc3NhZ2UpIHtcbiAgaWYgKCFtZXNzYWdlIHx8IHR5cGVvZiBtZXNzYWdlICE9PSBcIm9iamVjdFwiKSByZXR1cm4gZmFsc2VcbiAgY29uc3QgcmVjb3JkID0gLyoqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59ICovIChtZXNzYWdlKVxuXG4gIHJldHVybiAocmVjb3JkLnR5cGUgPT09IFwiam9iLXJlY2VpdmVkXCIgfHwgcmVjb3JkLnR5cGUgPT09IFwiam9iLXN0YXJ0ZWRcIilcbiAgICAmJiB0eXBlb2YgcmVjb3JkLmpvYklkID09PSBcInN0cmluZ1wiXG4gICAgJiYgKHJlY29yZC5oYW5kb2ZmSWQgPT09IHVuZGVmaW5lZCB8fCB0eXBlb2YgcmVjb3JkLmhhbmRvZmZJZCA9PT0gXCJzdHJpbmdcIilcbiAgICAmJiAocmVjb3JkLndvcmtlcklkID09PSB1bmRlZmluZWQgfHwgdHlwZW9mIHJlY29yZC53b3JrZXJJZCA9PT0gXCJzdHJpbmdcIilcbiAgICAmJiAocmVjb3JkLmhhbmRlZE9mZkF0TXMgPT09IHVuZGVmaW5lZCB8fCB0eXBlb2YgcmVjb3JkLmhhbmRlZE9mZkF0TXMgPT09IFwibnVtYmVyXCIpXG4gICAgJiYgKHJlY29yZC5yZWNlaXZlZEF0TXMgPT09IHVuZGVmaW5lZCB8fCB0eXBlb2YgcmVjb3JkLnJlY2VpdmVkQXRNcyA9PT0gXCJudW1iZXJcIilcbiAgICAmJiAocmVjb3JkLnN0YXJ0ZWRBdE1zID09PSB1bmRlZmluZWQgfHwgdHlwZW9mIHJlY29yZC5zdGFydGVkQXRNcyA9PT0gXCJudW1iZXJcIilcbiAgICAmJiAocmVjb3JkLmNoaWxkSW5zdGFuY2VJZCA9PT0gdW5kZWZpbmVkIHx8IHR5cGVvZiByZWNvcmQuY2hpbGRJbnN0YW5jZUlkID09PSBcInN0cmluZ1wiKVxuICAgICYmIChyZWNvcmQuY2hpbGRQaWQgPT09IHVuZGVmaW5lZCB8fCBOdW1iZXIuaXNJbnRlZ2VyKHJlY29yZC5jaGlsZFBpZCkpXG59XG5cbi8qKlxuICogQ2hlY2tzIHdoZXRoZXIgYW4gSVBDIHZhbHVlIGlzIHRoZSBjaGlsZCdzIGJvdW5kZWQgcHJlLXRlYXJkb3duIG9ic2VydmF0aW9uLlxuICogQHBhcmFtIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gbWVzc2FnZSAtIElQQyBtZXNzYWdlLlxuICogQHJldHVybnMge21lc3NhZ2UgaXMgaW1wb3J0KFwiLi90eXBlcy5qc1wiKS5Qb29sZWRDaGlsZFNodXRkb3duT2JzZXJ2YXRpb24gJiB7dHlwZTogXCJzaHV0ZG93bi1vYnNlcnZhdGlvblwifX0gLSBXaGV0aGVyIHRoaXMgaXMgYSB2YWxpZCBzaHV0ZG93biBvYnNlcnZhdGlvbi5cbiAqL1xuZnVuY3Rpb24gaXNDaGlsZFNodXRkb3duT2JzZXJ2YXRpb25NZXNzYWdlKG1lc3NhZ2UpIHtcbiAgaWYgKCFtZXNzYWdlIHx8IHR5cGVvZiBtZXNzYWdlICE9PSBcIm9iamVjdFwiKSByZXR1cm4gZmFsc2VcbiAgY29uc3QgcmVjb3JkID0gLyoqIEB0eXBlIHt7Y2hpbGRJbnN0YW5jZUlkPzogUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4sIGluZmxpZ2h0Sm9iSWRzPzogUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4sIGluZmxpZ2h0Sm9iSWRzVHJ1bmNhdGVkQ291bnQ/OiBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPiwgcmVhc29uPzogUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4sIHNodXRkb3duT2JzZXJ2ZWRBdE1zPzogUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4sIHNodXRkb3duUmVxdWVzdGVkQXRNcz86IFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+LCBzaWduYWw/OiBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPiwgdHlwZT86IFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fX0gKi8gKG1lc3NhZ2UpXG5cbiAgcmV0dXJuIHJlY29yZC50eXBlID09PSBcInNodXRkb3duLW9ic2VydmF0aW9uXCJcbiAgICAmJiB0eXBlb2YgcmVjb3JkLmNoaWxkSW5zdGFuY2VJZCA9PT0gXCJzdHJpbmdcIlxuICAgICYmIEFycmF5LmlzQXJyYXkocmVjb3JkLmluZmxpZ2h0Sm9iSWRzKVxuICAgICYmIHJlY29yZC5pbmZsaWdodEpvYklkcy5sZW5ndGggPD0gUE9PTEVEX1JVTk5FUl9JTkZMSUdIVF9KT0JfSURfTElNSVRcbiAgICAmJiByZWNvcmQuaW5mbGlnaHRKb2JJZHMuZXZlcnkoKGpvYklkKSA9PiB0eXBlb2Ygam9iSWQgPT09IFwic3RyaW5nXCIpXG4gICAgJiYgTnVtYmVyLmlzSW50ZWdlcihyZWNvcmQuaW5mbGlnaHRKb2JJZHNUcnVuY2F0ZWRDb3VudClcbiAgICAmJiByZWNvcmQuaW5mbGlnaHRKb2JJZHNUcnVuY2F0ZWRDb3VudCA+PSAwXG4gICAgJiYgaXNQb29sZWRDaGlsZFNodXRkb3duUmVhc29uKHJlY29yZC5yZWFzb24pXG4gICAgJiYgdHlwZW9mIHJlY29yZC5zaHV0ZG93bk9ic2VydmVkQXRNcyA9PT0gXCJudW1iZXJcIlxuICAgICYmIE51bWJlci5pc0Zpbml0ZShyZWNvcmQuc2h1dGRvd25PYnNlcnZlZEF0TXMpXG4gICAgJiYgKHJlY29yZC5zaHV0ZG93blJlcXVlc3RlZEF0TXMgPT09IG51bGwgfHwgKHR5cGVvZiByZWNvcmQuc2h1dGRvd25SZXF1ZXN0ZWRBdE1zID09PSBcIm51bWJlclwiICYmIE51bWJlci5pc0Zpbml0ZShyZWNvcmQuc2h1dGRvd25SZXF1ZXN0ZWRBdE1zKSkpXG4gICAgJiYgaXNQb29sZWRDaGlsZFNodXRkb3duU2lnbmFsKHJlY29yZC5zaWduYWwpXG59XG5cbi8qKlxuICogQ2hlY2tzIHdoZXRoZXIgYW4gSVBDIHZhbHVlIGlzIGEgcG9vbGVkIGNoaWxkJ3MgYm91bmRlZCBtZW1vcnkgb2JzZXJ2YXRpb24uXG4gKiBUaGUgcG9vbGVkIGNoaWxkJ3Mgc3RkaW8gaXMgaWdub3JlZCBieSB0aGUgd29ya2VyIGZvcmssIHNvIHRoaXMgb2JzZXJ2YXRpb25cbiAqIChwZXJpb2RpYyB3aGlsZSBqb2JzIHJ1biwgcGx1cyBvbiBkZW1hbmQpIGlzIGhvdyBhIG1lbW9yeSBwcm9ibGVtIGluIGFcbiAqIHJ1bm5pbmcgY2hpbGQgbmFtZXMgaXRzZWxmLiBUaGUgd29ya2VyIGxvZ3MgaXQgKGl0cyBzdGRlcnIgcmVhY2hlcyB0aGUgcHJvZFxuICogbG9nKSBhbmQgZm9yd2FyZHMgaXQgdG8gdGhlIG9wdGlvbmFsIGBvblBvb2xlZFJ1bm5lck1lbW9yeU9ic2VydmF0aW9uYCBob29rLlxuICogQHBhcmFtIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gbWVzc2FnZSAtIElQQyBtZXNzYWdlLlxuICogQHJldHVybnMge21lc3NhZ2UgaXMgaW1wb3J0KFwiLi90eXBlcy5qc1wiKS5Qb29sZWRDaGlsZE1lbW9yeU9ic2VydmF0aW9ufSAtIFdoZXRoZXIgdGhpcyBpcyBhIHZhbGlkIG1lbW9yeSBvYnNlcnZhdGlvbi5cbiAqL1xuZnVuY3Rpb24gaXNQb29sZWRDaGlsZE1lbW9yeU9ic2VydmF0aW9uTWVzc2FnZShtZXNzYWdlKSB7XG4gIGlmICghbWVzc2FnZSB8fCB0eXBlb2YgbWVzc2FnZSAhPT0gXCJvYmplY3RcIikgcmV0dXJuIGZhbHNlXG4gIGNvbnN0IHJlY29yZCA9IC8qKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSAqLyAobWVzc2FnZSlcbiAgY29uc3QgaGVhcFN0YXRpc3RpY3MgPSAvKiogQHR5cGUge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+PiB8IHVuZGVmaW5lZH0gKi8gKHJlY29yZC5oZWFwU3RhdGlzdGljcylcbiAgY29uc3QgbWVtb3J5VXNhZ2UgPSAvKiogQHR5cGUge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+PiB8IHVuZGVmaW5lZH0gKi8gKHJlY29yZC5tZW1vcnlVc2FnZSlcblxuICByZXR1cm4gcmVjb3JkLnR5cGUgPT09IFwicG9vbGVkLWNoaWxkLW1lbW9yeVwiXG4gICAgJiYgdHlwZW9mIHJlY29yZC5jaGlsZEluc3RhbmNlSWQgPT09IFwic3RyaW5nXCJcbiAgICAmJiBOdW1iZXIuaXNJbnRlZ2VyKHJlY29yZC5jaGlsZFBpZClcbiAgICAmJiB0eXBlb2YgcmVjb3JkLnJzc0J5dGVzID09PSBcIm51bWJlclwiXG4gICAgJiYgTnVtYmVyLmlzRmluaXRlKHJlY29yZC5yc3NCeXRlcylcbiAgICAmJiBOdW1iZXIuaXNJbnRlZ2VyKHJlY29yZC5qb2JDb3VudClcbiAgICAmJiByZWNvcmQuam9iQ291bnQgPj0gMFxuICAgICYmIEFycmF5LmlzQXJyYXkocmVjb3JkLmFjdGl2ZUpvYklkcylcbiAgICAmJiByZWNvcmQuYWN0aXZlSm9iSWRzLmV2ZXJ5KChqb2JJZCkgPT4gdHlwZW9mIGpvYklkID09PSBcInN0cmluZ1wiKVxuICAgICYmIE51bWJlci5pc0ludGVnZXIocmVjb3JkLmFjdGl2ZUpvYklkc1RydW5jYXRlZENvdW50KVxuICAgICYmIHJlY29yZC5hY3RpdmVKb2JJZHNUcnVuY2F0ZWRDb3VudCA+PSAwXG4gICAgJiYgdHlwZW9mIHJlY29yZC5vYnNlcnZlZEF0TXMgPT09IFwibnVtYmVyXCJcbiAgICAmJiBOdW1iZXIuaXNGaW5pdGUocmVjb3JkLm9ic2VydmVkQXRNcylcbiAgICAmJiBoZWFwU3RhdGlzdGljcyAhPT0gdW5kZWZpbmVkICYmIHR5cGVvZiBoZWFwU3RhdGlzdGljcyA9PT0gXCJvYmplY3RcIlxuICAgICYmIG1lbW9yeVVzYWdlICE9PSB1bmRlZmluZWQgJiYgdHlwZW9mIG1lbW9yeVVzYWdlID09PSBcIm9iamVjdFwiXG59XG5cbi8qKlxuICogTm9ybWFsaXplcyBhIGNhbmRpZGF0ZSBwb29sZWQtcnVubmVyIHJlc291cmNlIGxpbWl0LlxuICogQHBhcmFtIHtudW1iZXIgfCB1bmRlZmluZWR9IHZhbHVlIC0gQ2FuZGlkYXRlIHBvc2l0aXZlIG51bWJlci5cbiAqIEByZXR1cm5zIHtudW1iZXIgfCB1bmRlZmluZWR9IC0gTm9ybWFsaXplZCB2YWx1ZS5cbiAqL1xuZnVuY3Rpb24gcG9zaXRpdmVOdW1iZXIodmFsdWUpIHtcbiAgcmV0dXJuIHR5cGVvZiB2YWx1ZSA9PT0gXCJudW1iZXJcIiAmJiBOdW1iZXIuaXNGaW5pdGUodmFsdWUpICYmIHZhbHVlID4gMCA/IHZhbHVlIDogdW5kZWZpbmVkXG59XG5cbmV4cG9ydCBkZWZhdWx0IGNsYXNzIEJhY2tncm91bmRKb2JzV29ya2VyIHtcbiAgLyoqXG4gICAqIFJ1bnMgY29uc3RydWN0b3IuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBbYXJnc10gLSBPcHRpb25zLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL2NvbmZpZ3VyYXRpb24uanNcIikuZGVmYXVsdH0gW2FyZ3MuY29uZmlndXJhdGlvbl0gLSBDb25maWd1cmF0aW9uLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gW2FyZ3MuaG9zdF0gLSBIb3N0bmFtZS5cbiAgICogQHBhcmFtIHtudW1iZXJ9IFthcmdzLnBvcnRdIC0gUG9ydC5cbiAgICogQHBhcmFtIHtzdHJpbmd9IFthcmdzLmdlbmVyYXRpb25JZF0gLSBFeHBsaWNpdCByZWxlYXNlIGdlbmVyYXRpb24gaWRlbnRpdHkuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBbYXJncy53b3JrZXJJbnN0YW5jZUlkXSAtIEV4cGxpY2l0IHN0YWJsZSB3b3JrZXIgVVVJRC5cbiAgICogQHBhcmFtIHtudW1iZXJ9IFthcmdzLm1heENvbmN1cnJlbnRGb3JrZWRKb2JzXSAtIE92ZXJyaWRlIHRoZSBwcm9jZXNzIHJ1bm5lciBjb25jdXJyZW5jeSBjYXAgZnJvbSBgY29uZmlndXJhdGlvbi5nZXRCYWNrZ3JvdW5kSm9ic0NvbmZpZygpYC5cbiAgICogQHBhcmFtIHtudW1iZXJ9IFthcmdzLm1heENvbmN1cnJlbnRJbmxpbmVKb2JzXSAtIE92ZXJyaWRlIHRoZSBpbmxpbmUtam9iIGNvbmN1cnJlbmN5IGNhcCBmcm9tIGBjb25maWd1cmF0aW9uLmdldEJhY2tncm91bmRKb2JzQ29uZmlnKClgLlxuICAgKiBAcGFyYW0ge251bWJlcn0gW2FyZ3MucG9vbGVkUnVubmVyQ291bnRdIC0gT3ZlcnJpZGUgdGhlIHBvb2xlZCBydW5uZXIgY291bnQuXG4gICAqIEBwYXJhbSB7bnVtYmVyfSBbYXJncy5wb29sZWRSdW5uZXJDb25jdXJyZW5jeV0gLSBPdmVycmlkZSB0aGUgcGVyLXJ1bm5lciBjb25jdXJyZW5jeS5cbiAgICogQHBhcmFtIHtudW1iZXJ9IFthcmdzLnBvb2xlZFJ1bm5lck1heEpvYnNdIC0gT3ZlcnJpZGUgdGhlIHBlci1ydW5uZXIgcmVjeWNsZSBqb2IgY291bnQuXG4gICAqIEBwYXJhbSB7bnVtYmVyfSBbYXJncy5wb29sZWRSdW5uZXJNYXhSc3NCeXRlc10gLSBPdmVycmlkZSB0aGUgcGVyLXJ1bm5lciByZWN5Y2xlIFJTUyBsaW1pdC5cbiAgICogQHBhcmFtIHtudW1iZXJ9IFthcmdzLnBvb2xlZFJ1bm5lck1heExpZmV0aW1lTXNdIC0gT3ZlcnJpZGUgdGhlIHBlci1ydW5uZXIgcmVjeWNsZSBsaWZldGltZS5cbiAgICogQHBhcmFtIHtudW1iZXJ9IFthcmdzLnJ1bm5lck1heE9sZFNwYWNlU2l6ZU1iXSAtIE92ZXJyaWRlIHRoZSBWOCBoZWFwIGNhcCAoTWlCLCBgLS1tYXgtb2xkLXNwYWNlLXNpemVgKSBhcHBsaWVkIHRvIHJ1bm5lciBjaGlsZHJlbi5cbiAgICogQHBhcmFtIHtudW1iZXJ9IFthcmdzLnJ1bm5lck1hbGxvY0FyZW5hTWF4XSAtIE92ZXJyaWRlIGBNQUxMT0NfQVJFTkFfTUFYYCBmb3IgcnVubmVyIGNoaWxkcmVuLlxuICAgKiBAcGFyYW0ge251bWJlcn0gW2FyZ3MuZm9ya2VkQ2hpbGRTaWdraWxsR3JhY2VNc10gLSBPdmVycmlkZSB0aGUgZ3JhY2UgcGVyaW9kIGJldHdlZW4gU0lHVEVSTSBhbmQgU0lHS0lMTCB3aGVuIHJlYXBpbmcgbGluZ2VyaW5nIHByb2Nlc3MgcnVubmVycyBvbiBzdG9wLlxuICAgKiBAcGFyYW0ge251bWJlcn0gW2FyZ3MuaGVhcnRiZWF0SW50ZXJ2YWxNc10gLSBPdmVycmlkZSB0aGUgbGl2ZW5lc3MgaGVhcnRiZWF0IGludGVydmFsIChkZWZhdWx0IDE1MDAwbXMpLlxuICAgKiBAcGFyYW0ge251bWJlcn0gW2FyZ3MuZ2VuZXJhdGlvbkhhbmRzaGFrZVRpbWVvdXRNc10gLSBNYXhpbXVtIHRpbWUgdG8gd2FpdCBmb3IgZ2VuZXJhdGlvbiBhY2tub3dsZWRnZW1lbnQgKGRlZmF1bHQ6IDQwMDApLlxuICAgKiBAcGFyYW0ge251bWJlcn0gW2FyZ3MucmVjb25uZWN0RGVsYXlNc10gLSBEZWxheSBiZWZvcmUgcmVjb25uZWN0aW5nIGFuIGVzdGFibGlzaGVkIHdvcmtlciBjb25uZWN0aW9uIChkZWZhdWx0OiAxMDAwKS5cbiAgICogQHBhcmFtIHtudW1iZXJ9IFthcmdzLmpvYlRpbWVvdXRNc10gLSBPdmVycmlkZSB0aGUgd2FsbC1jbG9jayB0aW1lb3V0IGZvciBmb3JrZWQgYW5kIHBvb2xlZCBqb2JzIGZyb20gYGNvbmZpZ3VyYXRpb24uZ2V0QmFja2dyb3VuZEpvYnNDb25maWcoKWAuIGAwYCBkaXNhYmxlcyBpdC5cbiAgICogQHBhcmFtIHtib29sZWFufSBbYXJncy5jbG9zZURhdGFiYXNlQ29ubmVjdGlvbnNPblN0b3BdIC0gV2hldGhlciBzdG9wIG93bnMgY2xvc2luZyB0aGUgY29uZmlndXJhdGlvbidzIGRhdGFiYXNlIHBvb2xzIChkZWZhdWx0IHRydWUpLlxuICAgKiBAcGFyYW0geygpID0+IHZvaWQgfCBQcm9taXNlPHZvaWQ+fSBbYXJncy5vblN0b3BwZWRdIC0gTGlmZWN5Y2xlIGhvb2sgaW52b2tlZCBhZnRlciB0aGUgd29ya2VyIGZpbmlzaGVzIHN0b3BwaW5nLlxuICAgKiBAcGFyYW0geygpID0+IHZvaWR9IFthcmdzLm9uR2VuZXJhdGlvbkFjY2VwdGVkXSAtIEV4cGxpY2l0IGdlbmVyYXRpb24tYWNjZXB0YW5jZSBvYnNlcnZhdGlvbiBob29rLlxuICAgKiBAcGFyYW0geygpID0+IHZvaWR9IFthcmdzLm9uUmV0aXJlTWVzc2FnZV0gLSBFeHBsaWNpdCByZXRpcmUtbWVzc2FnZSBvYnNlcnZhdGlvbiBob29rLlxuICAgKiBAcGFyYW0geyhvYnNlcnZhdGlvbjogaW1wb3J0KFwiLi90eXBlcy5qc1wiKS5Qb29sZWRDaGlsZE1lbW9yeU9ic2VydmF0aW9uKSA9PiB2b2lkIHwgUHJvbWlzZTx2b2lkPn0gW2FyZ3Mub25Qb29sZWRSdW5uZXJNZW1vcnlPYnNlcnZhdGlvbl0gLSBFeHBsaWNpdCBwb29sZWQtY2hpbGQgbWVtb3J5IG9ic2VydmF0aW9uIGhvb2suIEV2ZXJ5IHZhbGlkYXRlZCBvYnNlcnZhdGlvbiAocGVyaW9kaWMgd2hpbGUgYSBjaGlsZCBoYXMgaW4tZmxpZ2h0IGpvYnMsIHBsdXMgb24gZGVtYW5kKSBpcyBmb3J3YXJkZWQgaGVyZSwgaW4gYWRkaXRpb24gdG8gdGhlIHdvcmtlcidzIGNvbXBhY3Qgc3RkZXJyIGxvZyBsaW5lLCBzbyBhbiBhcHBsaWNhdGlvbiBjYW4gcm91dGUgbWVtb3J5IGRpYWdub3N0aWNzIChlLmcuIHRvIGEgYnVnIHJlcG9ydGVyKSB3aXRob3V0IHBhcnNpbmcgbG9ncy5cbiAgICovXG4gIGNvbnN0cnVjdG9yKHtjb25maWd1cmF0aW9uLCBob3N0LCBwb3J0LCBnZW5lcmF0aW9uSWQsIHdvcmtlckluc3RhbmNlSWQsIG1heENvbmN1cnJlbnRGb3JrZWRKb2JzLCBtYXhDb25jdXJyZW50SW5saW5lSm9icywgcG9vbGVkUnVubmVyQ291bnQsIHBvb2xlZFJ1bm5lckNvbmN1cnJlbmN5LCBwb29sZWRSdW5uZXJNYXhKb2JzLCBwb29sZWRSdW5uZXJNYXhSc3NCeXRlcywgcG9vbGVkUnVubmVyTWF4TGlmZXRpbWVNcywgcnVubmVyTWF4T2xkU3BhY2VTaXplTWIsIHJ1bm5lck1hbGxvY0FyZW5hTWF4LCBmb3JrZWRDaGlsZFNpZ2tpbGxHcmFjZU1zLCBoZWFydGJlYXRJbnRlcnZhbE1zLCBnZW5lcmF0aW9uSGFuZHNoYWtlVGltZW91dE1zID0gREVGQVVMVF9HRU5FUkFUSU9OX0hBTkRTSEFLRV9USU1FT1VUX01TLCByZWNvbm5lY3REZWxheU1zID0gMTAwMCwgam9iVGltZW91dE1zLCBjbG9zZURhdGFiYXNlQ29ubmVjdGlvbnNPblN0b3AgPSB0cnVlLCBvblN0b3BwZWQsIG9uR2VuZXJhdGlvbkFjY2VwdGVkLCBvblJldGlyZU1lc3NhZ2UsIG9uUG9vbGVkUnVubmVyTWVtb3J5T2JzZXJ2YXRpb259ID0ge30pIHtcbiAgICAvKipcbiAgICAgKiBOYXJyb3dzIHRoZSBydW50aW1lIHZhbHVlIHRvIHRoZSBkb2N1bWVudGVkIHR5cGUuXG4gICAgICogQHR5cGUge1Byb21pc2U8aW1wb3J0KFwiLi4vY29uZmlndXJhdGlvbi5qc1wiKS5kZWZhdWx0Pn0gKi9cbiAgICB0aGlzLmNvbmZpZ3VyYXRpb25Qcm9taXNlID0gY29uZmlndXJhdGlvbiA/IFByb21pc2UucmVzb2x2ZShjb25maWd1cmF0aW9uKSA6IGNvbmZpZ3VyYXRpb25SZXNvbHZlcigpXG4gICAgLyoqXG4gICAgICogTmFycm93cyB0aGUgcnVudGltZSB2YWx1ZSB0byB0aGUgZG9jdW1lbnRlZCB0eXBlLlxuICAgICAqIEB0eXBlIHtpbXBvcnQoXCIuLi9jb25maWd1cmF0aW9uLmpzXCIpLmRlZmF1bHQgfCB1bmRlZmluZWR9ICovXG4gICAgdGhpcy5jb25maWd1cmF0aW9uID0gdW5kZWZpbmVkXG4gICAgdGhpcy5ob3N0ID0gaG9zdFxuICAgIHRoaXMucG9ydCA9IHBvcnRcbiAgICB0aGlzLmV4cGxpY2l0R2VuZXJhdGlvbklkID0gZ2VuZXJhdGlvbklkXG4gICAgdGhpcy53b3JrZXJJbnN0YW5jZUlkID0gd29ya2VySW5zdGFuY2VJZCB8fCByYW5kb21VVUlEKClcbiAgICAvKiogQHR5cGUge3N0cmluZyB8IHVuZGVmaW5lZH0gKi9cbiAgICB0aGlzLmdlbmVyYXRpb25JZCA9IHVuZGVmaW5lZFxuICAgIHRoaXMuY2xvc2VEYXRhYmFzZUNvbm5lY3Rpb25zT25TdG9wID0gY2xvc2VEYXRhYmFzZUNvbm5lY3Rpb25zT25TdG9wXG4gICAgdGhpcy5vblN0b3BwZWQgPSBvblN0b3BwZWRcbiAgICB0aGlzLm9uR2VuZXJhdGlvbkFjY2VwdGVkID0gb25HZW5lcmF0aW9uQWNjZXB0ZWRcbiAgICB0aGlzLm9uUmV0aXJlTWVzc2FnZSA9IG9uUmV0aXJlTWVzc2FnZVxuICAgIHRoaXMub25Qb29sZWRSdW5uZXJNZW1vcnlPYnNlcnZhdGlvbiA9IG9uUG9vbGVkUnVubmVyTWVtb3J5T2JzZXJ2YXRpb25cbiAgICAvKipcbiAgICAgKiBDb25zdHJ1Y3RvciBvdmVycmlkZSBmb3IgdGhlIGlubGluZS1qb2IgY29uY3VycmVuY3kgY2FwLiBXaGVuIHVuc2V0XG4gICAgICogdGhlIGNhcCBpcyByZWFkIGZyb20gYGNvbmZpZ3VyYXRpb24uZ2V0QmFja2dyb3VuZEpvYnNDb25maWcoKWAgaW5cbiAgICAgKiBgc3RhcnQoKWAgKGRlZmF1bHQ6IDQpLlxuICAgICAqIEB0eXBlIHtudW1iZXIgfCB1bmRlZmluZWR9XG4gICAgICovXG4gICAgdGhpcy5tYXhDb25jdXJyZW50SW5saW5lSm9ic092ZXJyaWRlID0gdHlwZW9mIG1heENvbmN1cnJlbnRJbmxpbmVKb2JzID09PSBcIm51bWJlclwiICYmIG1heENvbmN1cnJlbnRJbmxpbmVKb2JzID49IDFcbiAgICAgID8gbWF4Q29uY3VycmVudElubGluZUpvYnNcbiAgICAgIDogdW5kZWZpbmVkXG4gICAgLyoqXG4gICAgICogTmFycm93cyB0aGUgcnVudGltZSB2YWx1ZSB0byB0aGUgZG9jdW1lbnRlZCB0eXBlLlxuICAgICAqIEB0eXBlIHtudW1iZXIgfCB1bmRlZmluZWR9ICovXG4gICAgdGhpcy5tYXhDb25jdXJyZW50Rm9ya2VkSm9ic092ZXJyaWRlID0gdHlwZW9mIG1heENvbmN1cnJlbnRGb3JrZWRKb2JzID09PSBcIm51bWJlclwiICYmIG1heENvbmN1cnJlbnRGb3JrZWRKb2JzID49IDFcbiAgICAgID8gbWF4Q29uY3VycmVudEZvcmtlZEpvYnNcbiAgICAgIDogdW5kZWZpbmVkXG4gICAgLyoqXG4gICAgICogUmVzb2x2ZWQgY2FwIGZvciBpbmxpbmUtam9iIGNvbmN1cnJlbmN5LiBTZXQgaW4gYHN0YXJ0KClgOyBkZWZhdWx0cyB0b1xuICAgICAqIDQgaWYgbm8gY29uZmlndXJhdGlvbiB2YWx1ZSBpcyBhdmFpbGFibGUuXG4gICAgICogQHR5cGUge251bWJlcn1cbiAgICAgKi9cbiAgICB0aGlzLm1heENvbmN1cnJlbnRJbmxpbmVKb2JzID0gdGhpcy5tYXhDb25jdXJyZW50SW5saW5lSm9ic092ZXJyaWRlIHx8IDRcbiAgICAvKipcbiAgICAgKiBOYXJyb3dzIHRoZSBydW50aW1lIHZhbHVlIHRvIHRoZSBkb2N1bWVudGVkIHR5cGUuXG4gICAgICogQHR5cGUge251bWJlcn0gKi9cbiAgICB0aGlzLm1heENvbmN1cnJlbnRGb3JrZWRKb2JzID0gdGhpcy5tYXhDb25jdXJyZW50Rm9ya2VkSm9ic092ZXJyaWRlIHx8IDRcbiAgICB0aGlzLnBvb2xlZFJ1bm5lckNvdW50T3ZlcnJpZGUgPSBwb3NpdGl2ZUludGVnZXIocG9vbGVkUnVubmVyQ291bnQpXG4gICAgdGhpcy5wb29sZWRSdW5uZXJDb25jdXJyZW5jeU92ZXJyaWRlID0gcG9zaXRpdmVJbnRlZ2VyKHBvb2xlZFJ1bm5lckNvbmN1cnJlbmN5KVxuICAgIHRoaXMucG9vbGVkUnVubmVyTWF4Sm9ic092ZXJyaWRlID0gcG9zaXRpdmVJbnRlZ2VyKHBvb2xlZFJ1bm5lck1heEpvYnMpXG4gICAgdGhpcy5wb29sZWRSdW5uZXJNYXhSc3NCeXRlc092ZXJyaWRlID0gcG9zaXRpdmVOdW1iZXIocG9vbGVkUnVubmVyTWF4UnNzQnl0ZXMpXG4gICAgdGhpcy5wb29sZWRSdW5uZXJNYXhMaWZldGltZU1zT3ZlcnJpZGUgPSBwb3NpdGl2ZU51bWJlcihwb29sZWRSdW5uZXJNYXhMaWZldGltZU1zKVxuICAgIHRoaXMucnVubmVyTWF4T2xkU3BhY2VTaXplTWJPdmVycmlkZSA9IHBvc2l0aXZlSW50ZWdlcihydW5uZXJNYXhPbGRTcGFjZVNpemVNYilcbiAgICB0aGlzLnJ1bm5lck1hbGxvY0FyZW5hTWF4T3ZlcnJpZGUgPSBwb3NpdGl2ZUludGVnZXIocnVubmVyTWFsbG9jQXJlbmFNYXgpXG4gICAgdGhpcy5wb29sZWRSdW5uZXJDb3VudCA9IHRoaXMucG9vbGVkUnVubmVyQ291bnRPdmVycmlkZSB8fCA0XG4gICAgdGhpcy5wb29sZWRSdW5uZXJDb25jdXJyZW5jeSA9IHRoaXMucG9vbGVkUnVubmVyQ29uY3VycmVuY3lPdmVycmlkZSB8fCAxXG4gICAgdGhpcy5wb29sZWRSdW5uZXJNYXhKb2JzID0gdGhpcy5wb29sZWRSdW5uZXJNYXhKb2JzT3ZlcnJpZGUgfHwgMTAwXG4gICAgdGhpcy5wb29sZWRSdW5uZXJNYXhSc3NCeXRlcyA9IHRoaXMucG9vbGVkUnVubmVyTWF4UnNzQnl0ZXNPdmVycmlkZSB8fCA1MTIgKiAxMDI0ICogMTAyNFxuICAgIHRoaXMucG9vbGVkUnVubmVyTWF4TGlmZXRpbWVNcyA9IHRoaXMucG9vbGVkUnVubmVyTWF4TGlmZXRpbWVNc092ZXJyaWRlIHx8IDYwICogNjAgKiAxMDAwXG4gICAgdGhpcy5ydW5uZXJNYXhPbGRTcGFjZVNpemVNYiA9IHRoaXMucnVubmVyTWF4T2xkU3BhY2VTaXplTWJPdmVycmlkZSB8fCAyMDQ4XG4gICAgdGhpcy5ydW5uZXJNYWxsb2NBcmVuYU1heCA9IHRoaXMucnVubmVyTWFsbG9jQXJlbmFNYXhPdmVycmlkZSB8fCA0XG4gICAgLyoqXG4gICAgICogR3JhY2UgcGVyaW9kIGJldHdlZW4gU0lHVEVSTSBhbmQgU0lHS0lMTCB3aGVuIHJlYXBpbmcgcHJvY2VzcyBydW5uZXJzIHRoYXRcbiAgICAgKiBvdXRsYXN0IGEgYm91bmRlZCBzaHV0ZG93biBkcmFpbi5cbiAgICAgKiBAdHlwZSB7bnVtYmVyfVxuICAgICAqL1xuICAgIHRoaXMuZm9ya2VkQ2hpbGRTaWdraWxsR3JhY2VNcyA9IHR5cGVvZiBmb3JrZWRDaGlsZFNpZ2tpbGxHcmFjZU1zID09PSBcIm51bWJlclwiICYmIGZvcmtlZENoaWxkU2lna2lsbEdyYWNlTXMgPj0gMFxuICAgICAgPyBmb3JrZWRDaGlsZFNpZ2tpbGxHcmFjZU1zXG4gICAgICA6IEZPUktFRF9DSElMRF9TSUdLSUxMX0dSQUNFX01TXG4gICAgLyoqXG4gICAgICogQ29uc3RydWN0b3Igb3ZlcnJpZGUgZm9yIHRoZSBmb3JrZWQgYW5kIHBvb2xlZCB3YWxsLWNsb2NrIGpvYiB0aW1lb3V0LiBXaGVuIHVuc2V0IHRoZVxuICAgICAqIHRpbWVvdXQgaXMgcmVhZCBmcm9tIGBjb25maWd1cmF0aW9uLmdldEJhY2tncm91bmRKb2JzQ29uZmlnKCkuam9iVGltZW91dE1zYFxuICAgICAqIGF0IGZvcmsgdGltZSAoZGVmYXVsdDogZGlzYWJsZWQpLlxuICAgICAqIEB0eXBlIHtudW1iZXIgfCB1bmRlZmluZWR9XG4gICAgICovXG4gICAgdGhpcy5qb2JUaW1lb3V0TXNPdmVycmlkZSA9IHR5cGVvZiBqb2JUaW1lb3V0TXMgPT09IFwibnVtYmVyXCIgPyBqb2JUaW1lb3V0TXMgOiB1bmRlZmluZWRcbiAgICB0aGlzLnNob3VsZFN0b3AgPSBmYWxzZVxuICAgIHRoaXMuaXNSZXRpcmluZyA9IGZhbHNlXG4gICAgLyoqIEB0eXBlIHtQcm9taXNlPHZvaWQ+IHwgdW5kZWZpbmVkfSAqL1xuICAgIHRoaXMuc3RvcFByb21pc2UgPSB1bmRlZmluZWRcbiAgICAvKipcbiAgICAgKiBSZXNvbHZlcyBzdG9wIG9ic2VydmF0aW9uLlxuICAgICAqIEB0eXBlIHsodmFsdWU/OiB2b2lkKSA9PiB2b2lkfVxuICAgICAqL1xuICAgIHRoaXMuX3Jlc29sdmVTdG9wcGVkID0gKCkgPT4ge31cbiAgICAvKipcbiAgICAgKiBSZWplY3RzIHN0b3Agb2JzZXJ2YXRpb24uXG4gICAgICogQHR5cGUgeyhlcnJvcjogRXJyb3IpID0+IHZvaWR9XG4gICAgICovXG4gICAgdGhpcy5fcmVqZWN0U3RvcHBlZCA9ICgpID0+IHt9XG4gICAgLyoqIEB0eXBlIHtQcm9taXNlPHZvaWQ+fSAqL1xuICAgIHRoaXMuX3N0b3BwZWRQcm9taXNlID0gUHJvbWlzZS5yZXNvbHZlKClcbiAgICB0aGlzLl9yZXNldFN0b3BwZWRQcm9taXNlKClcbiAgICB0aGlzLndvcmtlcklkID0gdGhpcy53b3JrZXJJbnN0YW5jZUlkXG4gICAgdGhpcy5fZ2VuZXJhdGlvbkFjY2VwdGVkID0gZmFsc2VcbiAgICB0aGlzLmdlbmVyYXRpb25IYW5kc2hha2VUaW1lb3V0TXMgPSB2YWxpZGF0ZUdlbmVyYXRpb25IYW5kc2hha2VUaW1lb3V0TXMoZ2VuZXJhdGlvbkhhbmRzaGFrZVRpbWVvdXRNcylcbiAgICBpZiAoIU51bWJlci5pc0ludGVnZXIocmVjb25uZWN0RGVsYXlNcykgfHwgcmVjb25uZWN0RGVsYXlNcyA8IDAgfHwgcmVjb25uZWN0RGVsYXlNcyA+IE1BWF9GT1JLRURfSk9CX1RJTUVPVVRfTVMpIHtcbiAgICAgIHRocm93IG5ldyBUeXBlRXJyb3IoXCJyZWNvbm5lY3REZWxheU1zIG11c3QgYmUgYW4gaW50ZWdlciBiZXR3ZWVuIDAgYW5kIDIxNDc0ODM2NDdcIilcbiAgICB9XG4gICAgdGhpcy5yZWNvbm5lY3REZWxheU1zID0gcmVjb25uZWN0RGVsYXlNc1xuICAgIC8qKiBAdHlwZSB7UmV0dXJuVHlwZTx0eXBlb2Ygc2V0VGltZW91dD4gfCB1bmRlZmluZWR9ICovXG4gICAgdGhpcy5fcmVjb25uZWN0VGltZXIgPSB1bmRlZmluZWRcbiAgICB0aGlzLmhlYXJ0YmVhdEludGVydmFsTXMgPSB0eXBlb2YgaGVhcnRiZWF0SW50ZXJ2YWxNcyA9PT0gXCJudW1iZXJcIiAmJiBoZWFydGJlYXRJbnRlcnZhbE1zID49IDFcbiAgICAgID8gaGVhcnRiZWF0SW50ZXJ2YWxNc1xuICAgICAgOiBIRUFSVEJFQVRfSU5URVJWQUxfTVNcbiAgICAvKipcbiAgICAgKiBOYXJyb3dzIHRoZSBydW50aW1lIHZhbHVlIHRvIHRoZSBkb2N1bWVudGVkIHR5cGUuXG4gICAgICogQHR5cGUge1JldHVyblR5cGU8dHlwZW9mIHNldEludGVydmFsPiB8IHVuZGVmaW5lZH0gKi9cbiAgICB0aGlzLl9oZWFydGJlYXRUaW1lciA9IHVuZGVmaW5lZFxuICAgIC8qKlxuICAgICAqIEluLWZsaWdodCBqb2ItcmVzdWx0IHJlcG9ydHMgdG8gdGhlIG1haW4uIFJlcG9ydGluZyBpcyBkZWNvdXBsZWQgZnJvbSB0aGVcbiAgICAgKiBqb2IvY2hpbGQgc2xvdCAoZnJlZWluZyB0aGUgc2xvdCBuZXZlciB3YWl0cyBvbiBhIHJlcG9ydCkgYW5kIHJldHJpZWRcbiAgICAgKiBkdXJhYmx5LCBzbyBhIHRyYW5zaWVudCBtYWluL0RCIG91dGFnZSBjYW5ub3QgbGVhayBzbG90cyBvciBsb3NlIGFcbiAgICAgKiB0ZXJtaW5hbCByZXBvcnQuIFRyYWNrZWQgc28gYSBncmFjZWZ1bCBgc3RvcCgpYCBjYW4gZHJhaW4gdGhlbS5cbiAgICAgKiBAdHlwZSB7U2V0PFByb21pc2U8dm9pZD4+fVxuICAgICAqL1xuICAgIHRoaXMuaW5mbGlnaHRSZXBvcnRzID0gbmV3IFNldCgpXG4gICAgLyoqXG4gICAgICogTmFycm93cyB0aGUgcnVudGltZSB2YWx1ZSB0byB0aGUgZG9jdW1lbnRlZCB0eXBlLlxuICAgICAqIEB0eXBlIHtKc29uU29ja2V0IHwgdW5kZWZpbmVkfSAqL1xuICAgIHRoaXMuanNvblNvY2tldCA9IHVuZGVmaW5lZFxuICAgIC8qKlxuICAgICAqIE5hcnJvd3MgdGhlIHJ1bnRpbWUgdmFsdWUgdG8gdGhlIGRvY3VtZW50ZWQgdHlwZS5cbiAgICAgKiBAdHlwZSB7QmFja2dyb3VuZEpvYnNTdGF0dXNSZXBvcnRlciB8IHVuZGVmaW5lZH0gKi9cbiAgICB0aGlzLnN0YXR1c1JlcG9ydGVyID0gdW5kZWZpbmVkXG4gICAgLyoqXG4gICAgICogVXAgdG8gYHRoaXMubWF4Q29uY3VycmVudElubGluZUpvYnNgIG9mIHRoZXNlIHJ1biBpbiBwYXJhbGxlbC4gVGhleVxuICAgICAqIHNoYXJlIHRoZSB3b3JrZXIncyBwcm9jZXNzIGFuZCBEQiBjb25uZWN0aW9uIHBvb2wsIHNvIGNvbmN1cnJlbmN5IGlzXG4gICAgICogYWJvdXQgb3ZlcmxhcHBpbmcgSS9PIHdhaXRzIOKAlCB1c2UgZm9ya2luZyBmb3IgbWVtb3J5IGlzb2xhdGlvbiBhY3Jvc3NcbiAgICAgKiBsb25nLXJ1bm5pbmcgam9icyBhbmQgZm9yIHVzaW5nIG1vcmUgY29yZXMuXG4gICAgICogQHR5cGUge1NldDxQcm9taXNlPHZvaWQ+Pn1cbiAgICAgKi9cbiAgICB0aGlzLmluZmxpZ2h0SW5saW5lSm9icyA9IG5ldyBTZXQoKVxuICAgIC8qKlxuICAgICAqIEluLWZsaWdodCBwcm9jZXNzIHJ1bm5lciBleGl0IHByb21pc2VzLiBUcmFja2VkIHNvIHByb2Nlc3Mtam9iIGhhbmRvZmZcbiAgICAgKiBzdGF5cyBib3VuZGVkIHdoaWxlIHJ1bm5pbmcgYW5kIHNvIGEgZ3JhY2VmdWwgYHN0b3AoKWAgY2FuIGRyYWluIHRoZW0uXG4gICAgICogQHR5cGUge1NldDxQcm9taXNlPHZvaWQ+Pn1cbiAgICAgKi9cbiAgICB0aGlzLmluZmxpZ2h0UHJvY2Vzc0pvYnMgPSBuZXcgU2V0KClcbiAgICAvKipcbiAgICAgKiBMaXZlIHByb2Nlc3MgcnVubmVyIGNoaWxkIHByb2Nlc3Nlcywga2VwdCBzbyBhIGdyYWNlZnVsIGBzdG9wKClgIGNhblxuICAgICAqIHRlcm1pbmF0ZSBhbnkgdGhhdCBvdXRsYXN0IHRoZSBzaHV0ZG93biBkcmFpbiBpbnN0ZWFkIG9mIG9ycGhhbmluZyB0aGVtXG4gICAgICogYWNyb3NzIGEgZGVwbG95ICh3aGVyZSB0aGV5IHdvdWxkIGtlZXAgcnVubmluZyBhZ2FpbnN0IGRlbGV0ZWQgcmVsZWFzZVxuICAgICAqIGNvZGUgYW5kIGhvbGRpbmcgZGF0YWJhc2UgY29ubmVjdGlvbnMpLlxuICAgICAqIEB0eXBlIHtTZXQ8aW1wb3J0KFwibm9kZTpjaGlsZF9wcm9jZXNzXCIpLkNoaWxkUHJvY2Vzcz59XG4gICAgICovXG4gICAgdGhpcy5pbmZsaWdodFByb2Nlc3NDaGlsZHJlbiA9IG5ldyBTZXQoKVxuICAgIC8qKiBAdHlwZSB7U2V0PFByb21pc2U8dm9pZD4+fSAqL1xuICAgIHRoaXMuaW5mbGlnaHRQb29sZWRKb2JzID0gbmV3IFNldCgpXG4gICAgLyoqIEB0eXBlIHtNYXA8c3RyaW5nLCBBcnJheTxpbXBvcnQoXCIuL3R5cGVzLmpzXCIpLkJhY2tncm91bmRKb2JQYXlsb2FkICYge2lkOiBzdHJpbmd9Pj59ICovXG4gICAgdGhpcy5wb29sZWRKb2JRdWV1ZXMgPSBuZXcgTWFwKClcbiAgICAvKiogQHR5cGUge01hcDxzdHJpbmcsIFByb21pc2U8dm9pZD4+fSAtIFBlci1pZCBvdXRlciBxdWV1ZSB0cmFja2Vycy4gKi9cbiAgICB0aGlzLnBvb2xlZEpvYlF1ZXVlVHJhY2tlcnMgPSBuZXcgTWFwKClcbiAgICAvKiogQHR5cGUge1NldDxpbXBvcnQoXCJub2RlOmNoaWxkX3Byb2Nlc3NcIikuQ2hpbGRQcm9jZXNzPn0gKi9cbiAgICB0aGlzLnBvb2xlZENoaWxkcmVuID0gbmV3IFNldCgpXG4gICAgLyoqIEB0eXBlIHtNYXA8aW1wb3J0KFwibm9kZTpjaGlsZF9wcm9jZXNzXCIpLkNoaWxkUHJvY2VzcywgUG9vbGVkQ2hpbGRTdGF0ZT59ICovXG4gICAgdGhpcy5wb29sZWRDaGlsZFN0YXRlcyA9IG5ldyBNYXAoKVxuICAgIC8qKiBAdHlwZSB7V2Vha1NldDxQcm9taXNlPHZvaWQ+Pn0gKi9cbiAgICB0aGlzLl9wb29sZWRTdGFydHVwRmFpbHVyZUpvYnMgPSBuZXcgV2Vha1NldCgpXG4gICAgLy8gTW9ub3RvbmljIGRpc3BhdGNoIGNvdW50ZXIgZm9yIHJvdW5kLXJvYmluIGNoaWxkIHNlbGVjdGlvbjogZWFjaCBkaXNwYXRjaCBzdGFtcHNcbiAgICAvLyB0aGUgY2hvc2VuIGNoaWxkLCBhbmQgc2VsZWN0aW9uIHByZWZlcnMgdGhlIGNoaWxkIGRpc3BhdGNoZWQgbGVhc3QgcmVjZW50bHkuXG4gICAgdGhpcy5fcG9vbGVkRGlzcGF0Y2hTZXEgPSAwXG4gICAgLy8gV2FpdGVycyBibG9ja2VkIGluIF9ydW5Qb29sZWRKb2IgYmVjYXVzZSB0aGUgcG9vbCBpcyBhdCBpdHMgaGFyZCBjYXA6IGEgam9iIG1heVxuICAgIC8vIG5vdCBzcGF3biBhIGNoaWxkIHdoaWxlIHRvdGFsIGxpdmUgY2hpbGRyZW4gKHdvcmtpbmcgKyBkcmFpbmluZykgaXMgYXQgdGhlIGNhcC5cbiAgICAvKiogQHR5cGUge1NldDwoKSA9PiB2b2lkPn0gKi9cbiAgICB0aGlzLl9wb29sZWRTbG90V2FpdGVycyA9IG5ldyBTZXQoKVxuICAgIC8qKiBAdHlwZSB7UmV0dXJuVHlwZTx0eXBlb2Ygc2V0SW50ZXJ2YWw+IHwgdW5kZWZpbmVkfSAtIFNhZmV0eSBwb2xsIHRoYXQgcmUtY2hlY2tzIHRoZSBzbG90IGNvbmRpdGlvbi4gKi9cbiAgICB0aGlzLl9wb29sZWRTbG90V2FpdFRpbWVyID0gdW5kZWZpbmVkXG4gIH1cblxuICAvKiogU3RhcnRzIHRoZSBzbG90LXdhaXRlciBzYWZldHkgcG9sbCBpZiBpdCBpcyBub3QgYWxyZWFkeSBydW5uaW5nLiAqL1xuICBfc3RhcnRQb29sZWRTbG90V2FpdFBvbGwoKSB7XG4gICAgaWYgKHRoaXMuX3Bvb2xlZFNsb3RXYWl0VGltZXIpIHJldHVyblxuXG4gICAgdGhpcy5fcG9vbGVkU2xvdFdhaXRUaW1lciA9IHNldEludGVydmFsKCgpID0+IHRoaXMuX3dha2VQb29sZWRTbG90V2FpdGVycygpLCA1MClcbiAgICB0aGlzLl9wb29sZWRTbG90V2FpdFRpbWVyLnVucmVmKClcbiAgfVxuXG4gIC8qKiBTdG9wcyB0aGUgc2xvdC13YWl0ZXIgc2FmZXR5IHBvbGwgb25jZSBubyB3YWl0ZXIgaXMgcmVnaXN0ZXJlZC4gKi9cbiAgX3N0b3BQb29sZWRTbG90V2FpdFBvbGxJZklkbGUoKSB7XG4gICAgaWYgKHRoaXMuX3Bvb2xlZFNsb3RXYWl0ZXJzLnNpemUgPiAwIHx8ICF0aGlzLl9wb29sZWRTbG90V2FpdFRpbWVyKSByZXR1cm5cblxuICAgIGNsZWFySW50ZXJ2YWwodGhpcy5fcG9vbGVkU2xvdFdhaXRUaW1lcilcbiAgICB0aGlzLl9wb29sZWRTbG90V2FpdFRpbWVyID0gdW5kZWZpbmVkXG4gIH1cblxuICAvKipcbiAgICogUnVucyBzdGFydC5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgd2hlbiBjb25uZWN0ZWQuXG4gICAqL1xuICBhc3luYyBzdGFydCgpIHtcbiAgICB0aGlzLnNob3VsZFN0b3AgPSBmYWxzZVxuICAgIHRoaXMuaXNSZXRpcmluZyA9IGZhbHNlXG4gICAgdGhpcy5zdG9wUHJvbWlzZSA9IHVuZGVmaW5lZFxuICAgIHRoaXMuX3Jlc2V0U3RvcHBlZFByb21pc2UoKVxuICAgIHRoaXMuY29uZmlndXJhdGlvbiA9IGF3YWl0IHRoaXMuY29uZmlndXJhdGlvblByb21pc2VcbiAgICB0aGlzLmNvbmZpZ3VyYXRpb24uc2V0Q3VycmVudCgpXG4gICAgY29uc3QgcmVzb2x2ZWRDb25maWcgPSB0aGlzLmNvbmZpZ3VyYXRpb24uZ2V0QmFja2dyb3VuZEpvYnNDb25maWcoKVxuICAgIHRoaXMuZ2VuZXJhdGlvbklkID0gdGhpcy5jb25maWd1cmF0aW9uLnJlc29sdmVCYWNrZ3JvdW5kSm9ic0dlbmVyYXRpb25Db25maWcoe1xuICAgICAgZ2VuZXJhdGlvbklkOiB0aGlzLmV4cGxpY2l0R2VuZXJhdGlvbklkLFxuICAgICAgc291cmNlTmFtZTogXCJCYWNrZ3JvdW5kSm9ic1dvcmtlclwiXG4gICAgfSkuZ2VuZXJhdGlvbklkXG4gICAgdGhpcy53b3JrZXJJZCA9IHRoaXMuZ2VuZXJhdGlvbklkXG4gICAgICA/IGNyZWF0ZUdlbmVyYXRpb25Xb3JrZXJJZCh7Z2VuZXJhdGlvbklkOiB0aGlzLmdlbmVyYXRpb25JZCwgd29ya2VySW5zdGFuY2VJZDogdGhpcy53b3JrZXJJbnN0YW5jZUlkfSlcbiAgICAgIDogdGhpcy53b3JrZXJJbnN0YW5jZUlkXG4gICAgdGhpcy5ob3N0IHx8PSByZXNvbHZlZENvbmZpZy5ob3N0XG4gICAgaWYgKHR5cGVvZiB0aGlzLnBvcnQgIT09IFwibnVtYmVyXCIpIHRoaXMucG9ydCA9IHJlc29sdmVkQ29uZmlnLnBvcnRcbiAgICBhd2FpdCB0aGlzLmNvbmZpZ3VyYXRpb24uaW5pdGlhbGl6ZSh7dHlwZTogXCJiYWNrZ3JvdW5kLWpvYnMtd29ya2VyXCJ9KVxuICAgIGF3YWl0IHRoaXMuY29uZmlndXJhdGlvbi5jb25uZWN0QmVhY29uKHtwZWVyVHlwZTogXCJiYWNrZ3JvdW5kLWpvYnMtd29ya2VyXCJ9KVxuXG4gICAgLy8gQ29uc3RydWN0b3Igb3ZlcnJpZGVzIHdpbjsgb3RoZXJ3aXNlIHBpY2sgdXAgdGhlIGNvbmZpZ3VyZWQgY2Fwcy5cbiAgICBpZiAodHlwZW9mIHRoaXMubWF4Q29uY3VycmVudElubGluZUpvYnNPdmVycmlkZSAhPT0gXCJudW1iZXJcIikge1xuICAgICAgY29uc3QgY29uZmlnID0gdGhpcy5jb25maWd1cmF0aW9uLmdldEJhY2tncm91bmRKb2JzQ29uZmlnKClcblxuICAgICAgdGhpcy5tYXhDb25jdXJyZW50SW5saW5lSm9icyA9IGNvbmZpZy5tYXhDb25jdXJyZW50SW5saW5lSm9icyB8fCB0aGlzLm1heENvbmN1cnJlbnRJbmxpbmVKb2JzXG4gICAgfVxuICAgIGlmICh0eXBlb2YgdGhpcy5tYXhDb25jdXJyZW50Rm9ya2VkSm9ic092ZXJyaWRlICE9PSBcIm51bWJlclwiKSB7XG4gICAgICBjb25zdCBjb25maWcgPSB0aGlzLmNvbmZpZ3VyYXRpb24uZ2V0QmFja2dyb3VuZEpvYnNDb25maWcoKVxuXG4gICAgICB0aGlzLm1heENvbmN1cnJlbnRGb3JrZWRKb2JzID0gY29uZmlnLm1heENvbmN1cnJlbnRGb3JrZWRKb2JzIHx8IHRoaXMubWF4Q29uY3VycmVudEZvcmtlZEpvYnNcbiAgICB9XG4gICAgY29uc3QgcG9vbENvbmZpZyA9IHRoaXMuY29uZmlndXJhdGlvbi5nZXRCYWNrZ3JvdW5kSm9ic0NvbmZpZygpXG4gICAgaWYgKHR5cGVvZiB0aGlzLnBvb2xlZFJ1bm5lckNvdW50T3ZlcnJpZGUgIT09IFwibnVtYmVyXCIpIHRoaXMucG9vbGVkUnVubmVyQ291bnQgPSBwb29sQ29uZmlnLnBvb2xlZFJ1bm5lckNvdW50XG4gICAgaWYgKHR5cGVvZiB0aGlzLnBvb2xlZFJ1bm5lckNvbmN1cnJlbmN5T3ZlcnJpZGUgIT09IFwibnVtYmVyXCIpIHRoaXMucG9vbGVkUnVubmVyQ29uY3VycmVuY3kgPSBwb29sQ29uZmlnLnBvb2xlZFJ1bm5lckNvbmN1cnJlbmN5XG4gICAgaWYgKHR5cGVvZiB0aGlzLnBvb2xlZFJ1bm5lck1heEpvYnNPdmVycmlkZSAhPT0gXCJudW1iZXJcIikgdGhpcy5wb29sZWRSdW5uZXJNYXhKb2JzID0gcG9vbENvbmZpZy5wb29sZWRSdW5uZXJNYXhKb2JzXG4gICAgaWYgKHR5cGVvZiB0aGlzLnBvb2xlZFJ1bm5lck1heFJzc0J5dGVzT3ZlcnJpZGUgIT09IFwibnVtYmVyXCIpIHRoaXMucG9vbGVkUnVubmVyTWF4UnNzQnl0ZXMgPSBwb29sQ29uZmlnLnBvb2xlZFJ1bm5lck1heFJzc0J5dGVzXG4gICAgaWYgKHR5cGVvZiB0aGlzLnBvb2xlZFJ1bm5lck1heExpZmV0aW1lTXNPdmVycmlkZSAhPT0gXCJudW1iZXJcIikgdGhpcy5wb29sZWRSdW5uZXJNYXhMaWZldGltZU1zID0gcG9vbENvbmZpZy5wb29sZWRSdW5uZXJNYXhMaWZldGltZU1zXG4gICAgaWYgKHR5cGVvZiB0aGlzLnJ1bm5lck1heE9sZFNwYWNlU2l6ZU1iT3ZlcnJpZGUgIT09IFwibnVtYmVyXCIgJiYgdHlwZW9mIHBvb2xDb25maWcucnVubmVyTWF4T2xkU3BhY2VTaXplTWIgPT09IFwibnVtYmVyXCIpIHRoaXMucnVubmVyTWF4T2xkU3BhY2VTaXplTWIgPSBwb29sQ29uZmlnLnJ1bm5lck1heE9sZFNwYWNlU2l6ZU1iXG4gICAgaWYgKHR5cGVvZiB0aGlzLnJ1bm5lck1hbGxvY0FyZW5hTWF4T3ZlcnJpZGUgIT09IFwibnVtYmVyXCIgJiYgdHlwZW9mIHBvb2xDb25maWcucnVubmVyTWFsbG9jQXJlbmFNYXggPT09IFwibnVtYmVyXCIpIHRoaXMucnVubmVyTWFsbG9jQXJlbmFNYXggPSBwb29sQ29uZmlnLnJ1bm5lck1hbGxvY0FyZW5hTWF4XG5cbiAgICB0aGlzLnN0YXR1c1JlcG9ydGVyID0gbmV3IEJhY2tncm91bmRKb2JzU3RhdHVzUmVwb3J0ZXIoe1xuICAgICAgY29uZmlndXJhdGlvbjogdGhpcy5jb25maWd1cmF0aW9uLFxuICAgICAgaG9zdDogdGhpcy5ob3N0LFxuICAgICAgcG9ydDogdGhpcy5wb3J0LFxuICAgICAgZ2VuZXJhdGlvbkhhbmRzaGFrZVRpbWVvdXRNczogdGhpcy5nZW5lcmF0aW9uSGFuZHNoYWtlVGltZW91dE1zLFxuICAgICAgZ2VuZXJhdGlvbklkOiB0aGlzLmdlbmVyYXRpb25JZFxuICAgIH0pXG4gICAgdHJ5IHtcbiAgICAgIGF3YWl0IHRoaXMuX2Nvbm5lY3Qoe2FsbG93UmVjb25uZWN0OiBmYWxzZX0pXG4gICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgIGxldCBjbGVhbnVwRXJyb3JcblxuICAgICAgdHJ5IHtcbiAgICAgICAgYXdhaXQgdGhpcy5zdG9wKClcbiAgICAgIH0gY2F0Y2ggKGNhdWdodENsZWFudXBFcnJvcikge1xuICAgICAgICBjbGVhbnVwRXJyb3IgPSBjYXVnaHRDbGVhbnVwRXJyb3JcbiAgICAgIH1cblxuICAgICAgaWYgKGNsZWFudXBFcnJvcikge1xuICAgICAgICB0aHJvdyBuZXcgQWdncmVnYXRlRXJyb3IoXG4gICAgICAgICAgW2Vycm9yLCBjbGVhbnVwRXJyb3JdLFxuICAgICAgICAgIFwiQmFja2dyb3VuZCBqb2JzIHdvcmtlciBzdGFydHVwIGFuZCBjbGVhbnVwIGZhaWxlZFwiLFxuICAgICAgICAgIHtjYXVzZTogZXJyb3J9XG4gICAgICAgIClcbiAgICAgIH1cblxuICAgICAgdGhyb3cgZXJyb3JcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogR3JhY2VmdWxseSBzdG9wcyB0aGUgd29ya2VyOiBhbm5vdW5jZXMgZHJhaW5pbmcgdG8gdGhlIG1haW4gcHJvY2VzcyBzb1xuICAgKiBubyBuZXcgam9icyBhcmUgZGlzcGF0Y2hlZCwgd2FpdHMgZm9yIGluLWZsaWdodCBpbmxpbmUgam9icyBhbmQgcHJvY2Vzc1xuICAgKiBydW5uZXJzIHRvIGZpbmlzaCAoc28gdGhlaXIgcmVzdWx0cyBjYW4gYmUgcmVwb3J0ZWQpLCB0aGVuIGNsb3NlcyB0aGVcbiAgICogc29ja2V0IGFuZCBkaXNjb25uZWN0cyBmcm9tIHRoZSBiZWFjb24uXG4gICAqXG4gICAqIFByb2Nlc3MgcnVubmVycyBhcmUgY2hpbGQgcHJvY2Vzc2VzLiBXaGVuIGEgYHRpbWVvdXRNc2AgaXMgZ2l2ZW4gKGUuZy4gYVxuICAgKiBkZXBsb3kgZHJhaW5pbmcgdGhlIG9sZCByZWxlYXNlKSBhbnkgcnVubmVyIHN0aWxsIGFsaXZlIGFmdGVyIHRoZSBkcmFpblxuICAgKiB3aW5kb3cgaXMgdGVybWluYXRlZCAoU0lHVEVSTSwgdGhlbiBTSUdLSUxMKSByYXRoZXIgdGhhbiBsZWZ0IHRvIG9ycGhhblxuICAgKiBhY3Jvc3MgdGhlIGRlcGxveS4gV2l0aCBubyBgdGltZW91dE1zYCB0aGUgZHJhaW4gd2FpdHMgZm9yIHJ1bm5lcnMgdG9cbiAgICogZmluaXNoIG9uIHRoZWlyIG93bi5cbiAgICogQHBhcmFtIHtvYmplY3R9IFthcmdzXSAtIE9wdGlvbnMuXG4gICAqIEBwYXJhbSB7bnVtYmVyfSBbYXJncy50aW1lb3V0TXNdIC0gTWF4IHdhaXQgZm9yIGluLWZsaWdodCBqb2JzIChwZXIgcGhhc2UpIGluIG1zLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyB3aGVuIHN0b3BwZWQuXG4gICAqL1xuICBzdG9wKHt0aW1lb3V0TXN9ID0ge30pIHtcbiAgICBjb25zdCBzdG9wUHJvbWlzZSA9IHRoaXMuc3RvcFByb21pc2UgfHwgdGhpcy5fc3RvcCh7dGltZW91dE1zfSlcblxuICAgIGlmICghdGhpcy5zdG9wUHJvbWlzZSkge1xuICAgICAgdGhpcy5zdG9wUHJvbWlzZSA9IHN0b3BQcm9taXNlXG4gICAgICB2b2lkIHN0b3BQcm9taXNlLnRoZW4odGhpcy5fcmVzb2x2ZVN0b3BwZWQsIChlcnJvcikgPT4ge1xuICAgICAgICB0aGlzLl9yZWplY3RTdG9wcGVkKGVycm9yIGluc3RhbmNlb2YgRXJyb3IgPyBlcnJvciA6IG5ldyBFcnJvcihTdHJpbmcoZXJyb3IpKSlcbiAgICAgIH0pXG4gICAgfVxuXG4gICAgcmV0dXJuIHN0b3BQcm9taXNlXG4gIH1cblxuICAvKipcbiAgICogV2FpdHMgZm9yIGF1dG9tYXRpYyBvciByZXF1ZXN0ZWQgc3RvcC5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgd2hlbiB0aGlzIHdvcmtlciBoYXMgZnVsbHkgc3RvcHBlZC5cbiAgICovXG4gIHdhaXRVbnRpbFN0b3BwZWQoKSB7IHJldHVybiB0aGlzLl9zdG9wcGVkUHJvbWlzZSB9XG5cbiAgLyoqIFJlc2V0cyB0aGUgc3RvcCBvYnNlcnZhdGlvbiBwcm9taXNlIGZvciBhIG5ldyB3b3JrZXIgc3RhcnQuICovXG4gIF9yZXNldFN0b3BwZWRQcm9taXNlKCkge1xuICAgIHRoaXMuX3N0b3BwZWRQcm9taXNlID0gbmV3IFByb21pc2UoKHJlc29sdmUsIHJlamVjdCkgPT4ge1xuICAgICAgdGhpcy5fcmVzb2x2ZVN0b3BwZWQgPSByZXNvbHZlXG4gICAgICB0aGlzLl9yZWplY3RTdG9wcGVkID0gcmVqZWN0XG4gICAgfSlcbiAgICB2b2lkIHRoaXMuX3N0b3BwZWRQcm9taXNlLmNhdGNoKCgpID0+IHt9KVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgdGhlIHdvcmtlciBzaHV0ZG93biBsaWZlY3ljbGUgb25jZS5cbiAgICogQHBhcmFtIHtvYmplY3R9IFthcmdzXSAtIE9wdGlvbnMuXG4gICAqIEBwYXJhbSB7bnVtYmVyfSBbYXJncy50aW1lb3V0TXNdIC0gTWF4IHdhaXQgZm9yIGluLWZsaWdodCBqb2JzIChwZXIgcGhhc2UpIGluIG1zLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyB3aGVuIHN0b3BwZWQuXG4gICAqL1xuICBhc3luYyBfc3RvcCh7dGltZW91dE1zfSA9IHt9KSB7XG4gICAgdGhpcy5zaG91bGRTdG9wID0gdHJ1ZVxuICAgIHRoaXMuaXNSZXRpcmluZyA9IHRydWVcbiAgICB0aGlzLl9zdG9wSGVhcnRiZWF0KClcbiAgICBpZiAodGhpcy5fcmVjb25uZWN0VGltZXIpIHtcbiAgICAgIGNsZWFyVGltZW91dCh0aGlzLl9yZWNvbm5lY3RUaW1lcilcbiAgICAgIHRoaXMuX3JlY29ubmVjdFRpbWVyID0gdW5kZWZpbmVkXG4gICAgfVxuXG4gICAgYXdhaXQgc2h1dGRvd25MaWZlY3ljbGUoe1xuICAgICAgb25TdG9wcGVkOiB0aGlzLm9uU3RvcHBlZCxcbiAgICAgIHNodXRkb3duOiBhc3luYyAoKSA9PiB7XG4gICAgICAgIC8vIEFubm91bmNlIGRyYWluIHNvIG1haW4gc3RvcHMgZGlzcGF0Y2hpbmcgYnV0IGtlZXBzIHRoZSBjb25uZWN0aW9uXG4gICAgICAgIC8vIG9wZW4gdW50aWwgd2UgY2xvc2UgaXQgb3Vyc2VsdmVzIGJlbG93LlxuICAgICAgICBpZiAodGhpcy5qc29uU29ja2V0KSB7XG4gICAgICAgICAgdHJ5IHtcbiAgICAgICAgICAgIHRoaXMuanNvblNvY2tldC5zZW5kKHt0eXBlOiBcImRyYWluaW5nXCJ9KVxuICAgICAgICAgIH0gY2F0Y2gge1xuICAgICAgICAgICAgLy8gU29ja2V0IG1heSBhbHJlYWR5IGJlIGNsb3Npbmc7IG5vdGhpbmcgdG8gZG8uXG4gICAgICAgICAgfVxuICAgICAgICB9XG5cbiAgICAgICAgYXdhaXQgdGhpcy5fZHJhaW5JbmZsaWdodCh0aGlzLmluZmxpZ2h0SW5saW5lSm9icywgdGltZW91dE1zKVxuICAgICAgICBhd2FpdCB0aGlzLl9kcmFpbkluZmxpZ2h0KHRoaXMuaW5mbGlnaHRQb29sZWRKb2JzLCB0aW1lb3V0TXMpXG4gICAgICAgIGF3YWl0IHRoaXMuX2RyYWluSW5mbGlnaHQodGhpcy5pbmZsaWdodFByb2Nlc3NKb2JzLCB0aW1lb3V0TXMpXG4gICAgICAgIGF3YWl0IHRoaXMuX3Rlcm1pbmF0ZVByb2Nlc3NDaGlsZHJlbigpXG4gICAgICAgIC8vIEdpdmUgaW4tZmxpZ2h0IHJlc3VsdCByZXBvcnRzIChub3cgZGVjb3VwbGVkIGZyb20gam9iIHNsb3RzKSBhIGJvdW5kZWRcbiAgICAgICAgLy8gY2hhbmNlIHRvIGxhbmQgYmVmb3JlIHRoZSBzb2NrZXQgY2xvc2VzLlxuICAgICAgICBhd2FpdCB0aGlzLl9kcmFpbkluZmxpZ2h0KHRoaXMuaW5mbGlnaHRSZXBvcnRzLCB0aW1lb3V0TXMpXG5cbiAgICAgICAgaWYgKHRoaXMuanNvblNvY2tldCkgdGhpcy5qc29uU29ja2V0LmNsb3NlKClcbiAgICAgICAgaWYgKCF0aGlzLmNvbmZpZ3VyYXRpb24pIHJldHVyblxuXG4gICAgICAgIGF3YWl0IHRoaXMuX2Nsb3NlQ29uZmlndXJhdGlvbigpXG4gICAgICB9XG4gICAgfSlcbiAgfVxuXG4gIC8qKiBCZWdpbnMgZ2VuZXJhdGlvbiByZXRpcmVtZW50IHdpdGhvdXQgcmV2b2tpbmcgbGl2ZW5lc3MgZHVyaW5nIHRoZSBkcmFpbi4gKi9cbiAgX2JlZ2luR2VuZXJhdGlvblJldGlyZW1lbnQoKSB7XG4gICAgaWYgKHRoaXMuc3RvcFByb21pc2UpIHJldHVyblxuXG4gICAgdGhpcy5pc1JldGlyaW5nID0gdHJ1ZVxuICAgIGNvbnN0IHN0b3BQcm9taXNlID0gdGhpcy5fc3RvcEFmdGVyR2VuZXJhdGlvbkRyYWluKClcbiAgICB0aGlzLnN0b3BQcm9taXNlID0gc3RvcFByb21pc2VcbiAgICB2b2lkIHN0b3BQcm9taXNlLnRoZW4odGhpcy5fcmVzb2x2ZVN0b3BwZWQsIChlcnJvcikgPT4ge1xuICAgICAgY29uc3Qgbm9ybWFsaXplZEVycm9yID0gZXJyb3IgaW5zdGFuY2VvZiBFcnJvciA/IGVycm9yIDogbmV3IEVycm9yKFN0cmluZyhlcnJvcikpXG5cbiAgICAgIHRoaXMuX3JlamVjdFN0b3BwZWQobm9ybWFsaXplZEVycm9yKVxuICAgICAgdGhpcy5fcmVwb3J0TGlmZWN5Y2xlRXJyb3Iobm9ybWFsaXplZEVycm9yKVxuICAgIH0pXG4gIH1cblxuICAvKipcbiAgICogRHJhaW5zIGFjY2VwdGVkIGdlbmVyYXRpb24gd29yayB3aGlsZSByZXRhaW5pbmcgdGhlIGV4YWN0IGNvbm5lY3Rpb24gYW5kXG4gICAqIGhlYXJ0YmVhdCwgdGhlbiBwZXJmb3JtcyB0aGUgZmluYWwgdGVybWluYXRpbmcgc3RvcC5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgYWZ0ZXIgdGhlIHdvcmtlciBoYXMgZnVsbHkgY2xvc2VkLlxuICAgKi9cbiAgYXN5bmMgX3N0b3BBZnRlckdlbmVyYXRpb25EcmFpbigpIHtcbiAgICBpZiAodGhpcy5qc29uU29ja2V0KSB7XG4gICAgICB0cnkge1xuICAgICAgICB0aGlzLmpzb25Tb2NrZXQuc2VuZCh7dHlwZTogXCJkcmFpbmluZ1wifSlcbiAgICAgIH0gY2F0Y2gge1xuICAgICAgICAvLyBUaGUgY2xvc2UgaGFuZGxlciBvd25zIGV4YWN0IHNhbWUtZ2VuZXJhdGlvbiByZWNvbm5lY3QuXG4gICAgICB9XG4gICAgfVxuXG4gICAgYXdhaXQgdGhpcy5fZHJhaW5JbmZsaWdodCh0aGlzLmluZmxpZ2h0SW5saW5lSm9icylcbiAgICBhd2FpdCB0aGlzLl9kcmFpbkluZmxpZ2h0KHRoaXMuaW5mbGlnaHRQb29sZWRKb2JzKVxuICAgIGF3YWl0IHRoaXMuX2RyYWluSW5mbGlnaHQodGhpcy5pbmZsaWdodFByb2Nlc3NKb2JzKVxuICAgIGF3YWl0IHRoaXMuX2RyYWluSW5mbGlnaHQodGhpcy5pbmZsaWdodFJlcG9ydHMpXG5cbiAgICB0aGlzLnNob3VsZFN0b3AgPSB0cnVlXG4gICAgdGhpcy5fc3RvcEhlYXJ0YmVhdCgpXG4gICAgaWYgKHRoaXMuX3JlY29ubmVjdFRpbWVyKSB7XG4gICAgICBjbGVhclRpbWVvdXQodGhpcy5fcmVjb25uZWN0VGltZXIpXG4gICAgICB0aGlzLl9yZWNvbm5lY3RUaW1lciA9IHVuZGVmaW5lZFxuICAgIH1cbiAgICBhd2FpdCB0aGlzLl90ZXJtaW5hdGVQcm9jZXNzQ2hpbGRyZW4oKVxuXG4gICAgYXdhaXQgc2h1dGRvd25MaWZlY3ljbGUoe1xuICAgICAgb25TdG9wcGVkOiB0aGlzLm9uU3RvcHBlZCxcbiAgICAgIHNodXRkb3duOiBhc3luYyAoKSA9PiB7XG4gICAgICAgIGlmICh0aGlzLmpzb25Tb2NrZXQpIHRoaXMuanNvblNvY2tldC5jbG9zZSgpXG4gICAgICAgIGlmICghdGhpcy5jb25maWd1cmF0aW9uKSByZXR1cm5cblxuICAgICAgICBhd2FpdCB0aGlzLl9jbG9zZUNvbmZpZ3VyYXRpb24oKVxuICAgICAgfVxuICAgIH0pXG4gIH1cblxuICAvKipcbiAgICogQ2xvc2VzIGFwcGxpY2F0aW9uIHJlc291cmNlcyBiZWZvcmUgZnJhbWV3b3JrIHJlc291cmNlcyB3aGVuIHRoaXMgd29ya2VyIG93bnMgdGhlbS5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgYWZ0ZXIgZXZlcnkgb3duZWQgY2xvc2Ugc3VjY2VlZHMuXG4gICAqL1xuICBhc3luYyBfY2xvc2VDb25maWd1cmF0aW9uKCkge1xuICAgIGNvbnN0IGNvbmZpZ3VyYXRpb24gPSB0aGlzLmNvbmZpZ3VyYXRpb25cblxuICAgIGlmICghY29uZmlndXJhdGlvbikgcmV0dXJuXG5cbiAgICBhd2FpdCBydW5TaHV0ZG93blN0ZXBzKHtcbiAgICAgIG1lc3NhZ2U6IFwiQmFja2dyb3VuZCBqb2JzIHdvcmtlciBhcHBsaWNhdGlvbiBhbmQgZnJhbWV3b3JrIHNodXRkb3duIGZhaWxlZFwiLFxuICAgICAgc3RlcHM6IFtcbiAgICAgICAgLi4uKHRoaXMuY2xvc2VEYXRhYmFzZUNvbm5lY3Rpb25zT25TdG9wXG4gICAgICAgICAgPyBbYXN5bmMgKCkgPT4gYXdhaXQgY29uZmlndXJhdGlvbi5zaHV0ZG93bigpXVxuICAgICAgICAgIDogW10pLFxuICAgICAgICBhc3luYyAoKSA9PiBhd2FpdCBjb25maWd1cmF0aW9uLmRpc2Nvbm5lY3RCZWFjb24oKSxcbiAgICAgICAgLi4uKHRoaXMuY2xvc2VEYXRhYmFzZUNvbm5lY3Rpb25zT25TdG9wXG4gICAgICAgICAgPyBbYXN5bmMgKCkgPT4gYXdhaXQgY29uZmlndXJhdGlvbi5jbG9zZURhdGFiYXNlQ29ubmVjdGlvbnMoKV1cbiAgICAgICAgICA6IFtdKVxuICAgICAgXVxuICAgIH0pXG4gIH1cblxuICAvKipcbiAgICogV2FpdHMgZm9yIGEgc2V0IG9mIGluLWZsaWdodCBqb2IgcHJvbWlzZXMgdG8gc2V0dGxlLCBvcHRpb25hbGx5IGJvdW5kZWQgYnlcbiAgICogYHRpbWVvdXRNc2AuXG4gICAqIEBwYXJhbSB7U2V0PFByb21pc2U8dm9pZD4+fSBpbmZsaWdodCAtIEluLWZsaWdodCBqb2IgcHJvbWlzZXMuXG4gICAqIEBwYXJhbSB7bnVtYmVyfSBbdGltZW91dE1zXSAtIE1heCB3YWl0IGluIG1zOyB1bmJvdW5kZWQgd2hlbiBvbWl0dGVkLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyB3aGVuIHNldHRsZWQgb3IgdGhlIHRpbWVvdXQgZWxhcHNlcy5cbiAgICovXG4gIGFzeW5jIF9kcmFpbkluZmxpZ2h0KGluZmxpZ2h0LCB0aW1lb3V0TXMpIHtcbiAgICBpZiAoaW5mbGlnaHQuc2l6ZSA9PT0gMCkgcmV0dXJuXG5cbiAgICBjb25zdCBkcmFpbiA9IFByb21pc2UuYWxsU2V0dGxlZChbLi4uaW5mbGlnaHRdKVxuXG4gICAgaWYgKHR5cGVvZiB0aW1lb3V0TXMgPT09IFwibnVtYmVyXCIgJiYgdGltZW91dE1zID49IDApIHtcbiAgICAgIGxldCB0aW1lclxuICAgICAgY29uc3QgdGltZW91dCA9IG5ldyBQcm9taXNlKChyZXNvbHZlKSA9PiB7IHRpbWVyID0gc2V0VGltZW91dChyZXNvbHZlLCB0aW1lb3V0TXMpIH0pXG5cbiAgICAgIGF3YWl0IFByb21pc2UucmFjZShbZHJhaW4sIHRpbWVvdXRdKVxuICAgICAgY2xlYXJUaW1lb3V0KHRpbWVyKVxuICAgIH0gZWxzZSB7XG4gICAgICBhd2FpdCBkcmFpblxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBUZXJtaW5hdGVzIGFueSBwcm9jZXNzIHJ1bm5lciBjaGlsZHJlbiBzdGlsbCBhbGl2ZSBhZnRlciB0aGUgZHJhaW4gd2luZG93IHNvXG4gICAqIHRoZXkgZG9uJ3Qgb3V0bGl2ZSB0aGUgd29ya2VyIGFzIG9ycGhhbnMuIFNJR1RFUk0gbGV0cyB0aGUgcnVubmVyIGNsb3NlIGl0c1xuICAgKiBjb25uZWN0aW9ucyBjbGVhbmx5OyBzdXJ2aXZvcnMgYXJlIFNJR0tJTExlZCBhZnRlciBhIHNob3J0IGdyYWNlLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyBvbmNlIHN1cnZpdm9ycyBoYXZlIGJlZW4gc2lnbmFsbGVkLlxuICAgKi9cbiAgYXN5bmMgX3Rlcm1pbmF0ZVByb2Nlc3NDaGlsZHJlbigpIHtcbiAgICBpZiAodGhpcy5pbmZsaWdodFByb2Nlc3NDaGlsZHJlbi5zaXplID09PSAwKSByZXR1cm5cblxuICAgIGZvciAoY29uc3QgY2hpbGQgb2YgdGhpcy5pbmZsaWdodFByb2Nlc3NDaGlsZHJlbikge1xuICAgICAgY29uc3QgcG9vbGVkU3RhdGUgPSB0aGlzLnBvb2xlZENoaWxkU3RhdGVzLmdldChjaGlsZClcbiAgICAgIGlmIChwb29sZWRTdGF0ZSkge1xuICAgICAgICB0aGlzLl9yZXF1ZXN0UG9vbGVkQ2hpbGRTaHV0ZG93bih7Y2hpbGQsIHJlYXNvbjogXCJ3b3JrZXJfc3RvcFwiLCBzaWduYWw6IFwiU0lHVEVSTVwifSlcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIHRyeSB7XG4gICAgICAgICAgY2hpbGQua2lsbChcIlNJR1RFUk1cIilcbiAgICAgICAgfSBjYXRjaCB7XG4gICAgICAgICAgLy8gQ2hpbGQgYWxyZWFkeSBleGl0ZWQ7IG5vdGhpbmcgdG8gZG8uXG4gICAgICAgIH1cbiAgICAgIH1cbiAgICB9XG5cbiAgICBhd2FpdCBuZXcgUHJvbWlzZSgocmVzb2x2ZSkgPT4gc2V0VGltZW91dChyZXNvbHZlLCB0aGlzLmZvcmtlZENoaWxkU2lna2lsbEdyYWNlTXMpKVxuXG4gICAgZm9yIChjb25zdCBjaGlsZCBvZiB0aGlzLmluZmxpZ2h0UHJvY2Vzc0NoaWxkcmVuKSB7XG4gICAgICB0cnkge1xuICAgICAgICBjaGlsZC5raWxsKFwiU0lHS0lMTFwiKVxuICAgICAgfSBjYXRjaCB7XG4gICAgICAgIC8vIENoaWxkIGFscmVhZHkgZXhpdGVkOyBub3RoaW5nIHRvIGRvLlxuICAgICAgfVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBDb25uZWN0cyB0byB0aGUgd29ya2VyJ3MgcmVzb2x2ZWQgZW5kcG9pbnQgYW5kIGNvbXBsZXRlcyBpdHMgaGVsbG8gZmVuY2UuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gUmVjb25uZWN0IHBvbGljeS5cbiAgICogQHBhcmFtIHtib29sZWFufSBhcmdzLmFsbG93UmVjb25uZWN0IC0gV2hldGhlciBhIGZhaWxlZCBhdHRlbXB0IG1heSBzY2hlZHVsZSBhbm90aGVyIGNvbm5lY3Rpb24uXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIGFmdGVyIGdlbmVyYXRpb24gYWNrbm93bGVkZ2VtZW50LlxuICAgKi9cbiAgYXN5bmMgX2Nvbm5lY3Qoe2FsbG93UmVjb25uZWN0fSkge1xuICAgIGNvbnN0IGNvbmZpZ3VyYXRpb24gPSB0aGlzLmNvbmZpZ3VyYXRpb25cbiAgICBpZiAoIWNvbmZpZ3VyYXRpb24pIHRocm93IG5ldyBFcnJvcihcIkJhY2tncm91bmQgam9icyB3b3JrZXIgY29uZmlndXJhdGlvbiBub3QgaW5pdGlhbGl6ZWRcIilcblxuICAgIGNvbnN0IGNvbmZpZyA9IGNvbmZpZ3VyYXRpb24uZ2V0QmFja2dyb3VuZEpvYnNDb25maWcoKVxuICAgIGlmICh0aGlzLmdlbmVyYXRpb25JZCkgdGhpcy5fZ2VuZXJhdGlvbkFjY2VwdGVkID0gZmFsc2VcbiAgICBjb25zdCBob3N0ID0gdGhpcy5ob3N0IHx8IGNvbmZpZy5ob3N0XG4gICAgY29uc3QgcG9ydCA9IHR5cGVvZiB0aGlzLnBvcnQgPT09IFwibnVtYmVyXCIgPyB0aGlzLnBvcnQgOiBjb25maWcucG9ydFxuICAgIGNvbnN0IHNvY2tldCA9IG5ldC5jcmVhdGVDb25uZWN0aW9uKHtob3N0LCBwb3J0fSlcbiAgICBzb2NrZXQuc2V0S2VlcEFsaXZlKHRydWUsIFNPQ0tFVF9LRUVQQUxJVkVfTVMpXG4gICAgY29uc3QganNvblNvY2tldCA9IG5ldyBKc29uU29ja2V0KHNvY2tldClcbiAgICB0aGlzLmpzb25Tb2NrZXQgPSBqc29uU29ja2V0XG4gICAgLyoqXG4gICAgICogUmVzb2x2ZXMgdGhlIGdlbmVyYXRpb24gaGFuZHNoYWtlLlxuICAgICAqIEB0eXBlIHsoKSA9PiB2b2lkfVxuICAgICAqL1xuICAgIGxldCByZXNvbHZlSGFuZHNoYWtlID0gKCkgPT4ge31cbiAgICAvKipcbiAgICAgKiBSZWplY3RzIHRoZSBnZW5lcmF0aW9uIGhhbmRzaGFrZS5cbiAgICAgKiBAdHlwZSB7KGVycm9yOiBFcnJvcikgPT4gdm9pZH1cbiAgICAgKi9cbiAgICBsZXQgcmVqZWN0SGFuZHNoYWtlID0gKCkgPT4ge31cbiAgICBsZXQgY29ubmVjdGlvbkFjY2VwdGVkID0gZmFsc2VcbiAgICAvKiogQHR5cGUge1JldHVyblR5cGU8dHlwZW9mIHNldFRpbWVvdXQ+IHwgdW5kZWZpbmVkfSAqL1xuICAgIGxldCBoYW5kc2hha2VUaW1lclxuICAgIGNvbnN0IGhhbmRzaGFrZSA9IG5ldyBQcm9taXNlKCgvKiogQHR5cGUgeyh2YWx1ZTogdm9pZCkgPT4gdm9pZH0gKi8gcmVzb2x2ZSwgcmVqZWN0KSA9PiB7XG4gICAgICByZXNvbHZlSGFuZHNoYWtlID0gcmVzb2x2ZVxuICAgICAgcmVqZWN0SGFuZHNoYWtlID0gcmVqZWN0XG4gICAgfSlcblxuICAgIC8qKlxuICAgICAqIEhhbmRsZXMgYSBiYWNrZ3JvdW5kIGpvYiBzb2NrZXQgbWVzc2FnZS5cbiAgICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vdHlwZXMuanNcIikuQmFja2dyb3VuZEpvYlNvY2tldE1lc3NhZ2V9IG1lc3NhZ2UgLSBTb2NrZXQgbWVzc2FnZS5cbiAgICAgKi9cbiAgICBqc29uU29ja2V0Lm9uKFwibWVzc2FnZVwiLCBhc3luYyAobWVzc2FnZSkgPT4ge1xuICAgICAgaWYgKG1lc3NhZ2U/LnR5cGUgPT09IFwiZ2VuZXJhdGlvbi1hY2NlcHRlZFwiKSB7XG4gICAgICAgIGlmICghdGhpcy5nZW5lcmF0aW9uSWQgfHwgbWVzc2FnZS5nZW5lcmF0aW9uSWQgIT09IHRoaXMuZ2VuZXJhdGlvbklkKSB7XG4gICAgICAgICAgcmVqZWN0SGFuZHNoYWtlKG5ldyBFcnJvcihcIkJhY2tncm91bmQgam9icyBtYWluIGFja25vd2xlZGdlZCBhIGRpZmZlcmVudCBnZW5lcmF0aW9uXCIpKVxuICAgICAgICAgIGpzb25Tb2NrZXQuZGVzdHJveSgpXG4gICAgICAgICAgcmV0dXJuXG4gICAgICAgIH1cblxuICAgICAgICB0aGlzLl9nZW5lcmF0aW9uQWNjZXB0ZWQgPSB0cnVlXG4gICAgICAgIGNvbm5lY3Rpb25BY2NlcHRlZCA9IHRydWVcbiAgICAgICAgaWYgKGhhbmRzaGFrZVRpbWVyKSB7XG4gICAgICAgICAgY2xlYXJUaW1lb3V0KGhhbmRzaGFrZVRpbWVyKVxuICAgICAgICAgIGhhbmRzaGFrZVRpbWVyID0gdW5kZWZpbmVkXG4gICAgICAgIH1cbiAgICAgICAgaWYgKG1lc3NhZ2UubGlmZWN5Y2xlU3RhdGUgPT09IFwicmV0aXJpbmdcIiB8fCBtZXNzYWdlLmxpZmVjeWNsZVN0YXRlID09PSBcInJldGlyZWRcIikgdGhpcy5pc1JldGlyaW5nID0gdHJ1ZVxuICAgICAgICB0aGlzLm9uR2VuZXJhdGlvbkFjY2VwdGVkPy4oKVxuICAgICAgICB0aGlzLl9zZW5kUmVhZHlJZlJ1bm5pbmcoKVxuICAgICAgICB0aGlzLl9zdGFydEhlYXJ0YmVhdCgpXG4gICAgICAgIHJlc29sdmVIYW5kc2hha2UoKVxuICAgICAgICByZXR1cm5cbiAgICAgIH1cblxuICAgICAgaWYgKG1lc3NhZ2U/LnR5cGUgPT09IFwiZ2VuZXJhdGlvbi1yZWplY3RlZFwiKSB7XG4gICAgICAgIHRoaXMuc2hvdWxkU3RvcCA9IHRydWVcbiAgICAgICAgaWYgKGhhbmRzaGFrZVRpbWVyKSBjbGVhclRpbWVvdXQoaGFuZHNoYWtlVGltZXIpXG4gICAgICAgIHJlamVjdEhhbmRzaGFrZShuZXcgRXJyb3IoYEJhY2tncm91bmQgam9icyBnZW5lcmF0aW9uIHJlamVjdGVkOiAke21lc3NhZ2UucmVhc29ufWApKVxuICAgICAgICBqc29uU29ja2V0LmRlc3Ryb3koKVxuICAgICAgICByZXR1cm5cbiAgICAgIH1cblxuICAgICAgaWYgKG1lc3NhZ2U/LnR5cGUgPT09IFwicmV0aXJlXCIpIHtcbiAgICAgICAgaWYgKHRoaXMuZ2VuZXJhdGlvbklkICYmIG1lc3NhZ2UuZ2VuZXJhdGlvbklkID09PSB0aGlzLmdlbmVyYXRpb25JZCkge1xuICAgICAgICAgIHRoaXMub25SZXRpcmVNZXNzYWdlPy4oKVxuICAgICAgICAgIHRoaXMuX2JlZ2luR2VuZXJhdGlvblJldGlyZW1lbnQoKVxuICAgICAgICB9XG4gICAgICAgIHJldHVyblxuICAgICAgfVxuXG4gICAgICBpZiAobWVzc2FnZT8udHlwZSA9PT0gXCJqb2JcIikge1xuICAgICAgICBhd2FpdCB0aGlzLl9oYW5kbGVKb2IobWVzc2FnZS5wYXlsb2FkKVxuICAgICAgfVxuICAgIH0pXG5cbiAgICBqc29uU29ja2V0Lm9uKFwiZXJyb3JcIiwgKGVycm9yKSA9PiB7XG4gICAgICBjb25zb2xlLmVycm9yKFwiQmFja2dyb3VuZCBqb2JzIHdvcmtlciBzb2NrZXQgZXJyb3I6XCIsIGVycm9yKVxuICAgICAgaWYgKHRoaXMuZ2VuZXJhdGlvbklkICYmICF0aGlzLl9nZW5lcmF0aW9uQWNjZXB0ZWQpIHJlamVjdEhhbmRzaGFrZShlcnJvcilcbiAgICB9KVxuXG4gICAganNvblNvY2tldC5vbihcImNsb3NlXCIsICgpID0+IHtcbiAgICAgIGlmIChoYW5kc2hha2VUaW1lcikgY2xlYXJUaW1lb3V0KGhhbmRzaGFrZVRpbWVyKVxuICAgICAgdGhpcy5fc3RvcEhlYXJ0YmVhdCgpXG4gICAgICBpZiAodGhpcy5qc29uU29ja2V0ID09PSBqc29uU29ja2V0KSB0aGlzLmpzb25Tb2NrZXQgPSB1bmRlZmluZWRcbiAgICAgIGlmICh0aGlzLmdlbmVyYXRpb25JZCAmJiAhdGhpcy5fZ2VuZXJhdGlvbkFjY2VwdGVkKSB7XG4gICAgICAgIHJlamVjdEhhbmRzaGFrZShuZXcgRXJyb3IoXCJCYWNrZ3JvdW5kIGpvYnMgc29ja2V0IGNsb3NlZCBiZWZvcmUgZ2VuZXJhdGlvbiBhY2tub3dsZWRnZW1lbnRcIikpXG4gICAgICB9XG4gICAgICBpZiAodGhpcy5zaG91bGRTdG9wKSByZXR1cm5cbiAgICAgIGlmIChjb25uZWN0aW9uQWNjZXB0ZWQgfHwgYWxsb3dSZWNvbm5lY3QgfHwgIXRoaXMuZ2VuZXJhdGlvbklkKSB0aGlzLl9zY2hlZHVsZVJlY29ubmVjdCgpXG4gICAgfSlcblxuICAgIGlmICh0aGlzLmdlbmVyYXRpb25JZCkge1xuICAgICAgaGFuZHNoYWtlVGltZXIgPSBzZXRUaW1lb3V0KCgpID0+IHtcbiAgICAgICAgY29uc3QgZXJyb3IgPSBuZXcgQmFja2dyb3VuZEpvYnNHZW5lcmF0aW9uSGFuZHNoYWtlVGltZW91dEVycm9yKHtcbiAgICAgICAgICBlbmRwb2ludDogYCR7aG9zdH06JHtwb3J0fWAsXG4gICAgICAgICAgZ2VuZXJhdGlvbklkOiB0aGlzLmdlbmVyYXRpb25JZCB8fCBcIlwiLFxuICAgICAgICAgIHJvbGU6IFwid29ya2VyXCIsXG4gICAgICAgICAgdGltZW91dE1zOiB0aGlzLmdlbmVyYXRpb25IYW5kc2hha2VUaW1lb3V0TXNcbiAgICAgICAgfSlcbiAgICAgICAgcmVqZWN0SGFuZHNoYWtlKGVycm9yKVxuICAgICAgICBqc29uU29ja2V0LmRlc3Ryb3koKVxuICAgICAgfSwgdGhpcy5nZW5lcmF0aW9uSGFuZHNoYWtlVGltZW91dE1zKVxuICAgIH1cblxuICAgIHNvY2tldC5vbihcImNvbm5lY3RcIiwgKCkgPT4ge1xuICAgICAganNvblNvY2tldC5zZW5kKHt0eXBlOiBcImhlbGxvXCIsIHJvbGU6IFwid29ya2VyXCIsIC4uLih0aGlzLmdlbmVyYXRpb25JZCA/IHtnZW5lcmF0aW9uSWQ6IHRoaXMuZ2VuZXJhdGlvbklkfSA6IHt9KSwgc3VwcG9ydHNIYW5kb2ZmSWRSZXBvcnRpbmc6IHRydWUsIHN1cHBvcnRzSGVhcnRiZWF0OiB0cnVlLCBzdXBwb3J0c1Bvb2xlZDogdHJ1ZSwgd29ya2VySWQ6IHRoaXMud29ya2VySWR9KVxuICAgICAgaWYgKCF0aGlzLmdlbmVyYXRpb25JZCkge1xuICAgICAgICBjb25uZWN0aW9uQWNjZXB0ZWQgPSB0cnVlXG4gICAgICAgIHRoaXMuX3NlbmRSZWFkeUlmUnVubmluZygpXG4gICAgICAgIHRoaXMuX3N0YXJ0SGVhcnRiZWF0KClcbiAgICAgICAgcmVzb2x2ZUhhbmRzaGFrZSgpXG4gICAgICB9XG4gICAgfSlcblxuICAgIGlmICh0aGlzLmdlbmVyYXRpb25JZCkgYXdhaXQgaGFuZHNoYWtlXG4gIH1cblxuICAvKiogU2NoZWR1bGVzIG9uZSBmZW5jZWQgcmVjb25uZWN0IHRvIHRoZSB3b3JrZXIncyB1bmNoYW5nZWQgZW5kcG9pbnQuICovXG4gIF9zY2hlZHVsZVJlY29ubmVjdCgpIHtcbiAgICBpZiAodGhpcy5zaG91bGRTdG9wIHx8IHRoaXMuX3JlY29ubmVjdFRpbWVyKSByZXR1cm5cblxuICAgIHRoaXMuX3JlY29ubmVjdFRpbWVyID0gc2V0VGltZW91dCgoKSA9PiB7XG4gICAgICB0aGlzLl9yZWNvbm5lY3RUaW1lciA9IHVuZGVmaW5lZFxuICAgICAgaWYgKHRoaXMuc2hvdWxkU3RvcCkgcmV0dXJuXG4gICAgICB2b2lkIHRoaXMuX2Nvbm5lY3Qoe2FsbG93UmVjb25uZWN0OiB0cnVlfSkuY2F0Y2goKGVycm9yKSA9PiB7XG4gICAgICAgIGlmICghdGhpcy5zaG91bGRTdG9wKSBjb25zb2xlLmVycm9yKFwiQmFja2dyb3VuZCBqb2JzIHdvcmtlciByZWNvbm5lY3QgZmFpbGVkOlwiLCBlcnJvcilcbiAgICAgIH0pXG4gICAgfSwgdGhpcy5yZWNvbm5lY3REZWxheU1zKVxuICAgIGlmICh0eXBlb2YgdGhpcy5fcmVjb25uZWN0VGltZXIudW5yZWYgPT09IFwiZnVuY3Rpb25cIikgdGhpcy5fcmVjb25uZWN0VGltZXIudW5yZWYoKVxuICB9XG5cbiAgLyoqXG4gICAqIFN1cmZhY2VzIGFuIHVuZXhwZWN0ZWQgd29ya2VyIGxpZmVjeWNsZSBmYWlsdXJlIHRocm91Z2ggdGhlIGZyYW1ld29yayBlcnJvclxuICAgKiBjaGFubmVscyBzbyBhIHN1cGVydmlzb3IgaG9vayB0aGF0IGlnbm9yZXMgc3RkaW8gc3RpbGwgaGFzIG9ic2VydmFiaWxpdHkuXG4gICAqIEBwYXJhbSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59IGVycm9yIC0gV29ya2VyIGxpZmVjeWNsZSBmYWlsdXJlLlxuICAgKi9cbiAgX3JlcG9ydExpZmVjeWNsZUVycm9yKGVycm9yKSB7XG4gICAgY29uc3QgY29uZmlndXJhdGlvbiA9IHRoaXMuY29uZmlndXJhdGlvblxuICAgIGlmICghY29uZmlndXJhdGlvbikgcmV0dXJuXG4gICAgY29uc3Qgbm9ybWFsaXplZEVycm9yID0gZXJyb3IgaW5zdGFuY2VvZiBFcnJvciA/IGVycm9yIDogbmV3IEVycm9yKFN0cmluZyhlcnJvcikpXG4gICAgY29uc3QgcGF5bG9hZCA9IHtjb250ZXh0OiB7Z2VuZXJhdGlvbklkOiB0aGlzLmdlbmVyYXRpb25JZCwgc3RhZ2U6IFwiYmFja2dyb3VuZC1qb2JzLXdvcmtlci1saWZlY3ljbGVcIn0sIGVycm9yOiBub3JtYWxpemVkRXJyb3J9XG4gICAgY29uc3QgZXJyb3JFdmVudHMgPSBjb25maWd1cmF0aW9uLmdldEVycm9yRXZlbnRzKClcblxuICAgIGVycm9yRXZlbnRzLmVtaXQoXCJmcmFtZXdvcmstZXJyb3JcIiwgcGF5bG9hZClcbiAgICBlcnJvckV2ZW50cy5lbWl0KFwiYWxsLWVycm9yXCIsIHsuLi5wYXlsb2FkLCBlcnJvclR5cGU6IFwiZnJhbWV3b3JrLWVycm9yXCJ9KVxuICB9XG5cbiAgLyoqXG4gICAqIFNlbmRzIHBlcmlvZGljIGxpdmVuZXNzIGhlYXJ0YmVhdHMgdG8gdGhlIG1haW4gc28gYSB3ZWRnZWQgb3Igc2lsZW50IHdvcmtlclxuICAgKiBjYW4gYmUgZGV0ZWN0ZWQgYW5kIGRyb3BwZWQgdGhlcmUgKGl0cyBsZWFzZXMgcmVsZWFzZWQpIGluc3RlYWQgb2YgZnJlZXppbmdcbiAgICogdGhlIHF1ZXVlIHVudGlsIGEgaHVtYW4gbm90aWNlcy5cbiAgICogQHJldHVybnMge3ZvaWR9XG4gICAqL1xuICBfc3RhcnRIZWFydGJlYXQoKSB7XG4gICAgdGhpcy5fc3RvcEhlYXJ0YmVhdCgpXG5cbiAgICB0aGlzLl9oZWFydGJlYXRUaW1lciA9IHNldEludGVydmFsKCgpID0+IHRoaXMuX3NlbmRIZWFydGJlYXQoKSwgdGhpcy5oZWFydGJlYXRJbnRlcnZhbE1zKVxuXG4gICAgaWYgKHR5cGVvZiB0aGlzLl9oZWFydGJlYXRUaW1lci51bnJlZiA9PT0gXCJmdW5jdGlvblwiKSB0aGlzLl9oZWFydGJlYXRUaW1lci51bnJlZigpXG4gIH1cblxuICAvKiogU2VuZHMgb25lIGxpdmVuZXNzIGhlYXJ0YmVhdCB3aGlsZSB0aGUgd29ya2VyIGhhcyBub3QgZmluYWxseSBzdG9wcGVkLiAqL1xuICBfc2VuZEhlYXJ0YmVhdCgpIHtcbiAgICBpZiAodGhpcy5zaG91bGRTdG9wIHx8ICF0aGlzLmpzb25Tb2NrZXQpIHJldHVyblxuXG4gICAgdHJ5IHtcbiAgICAgIHRoaXMuanNvblNvY2tldC5zZW5kKHt0eXBlOiBcImhlYXJ0YmVhdFwiLCB3b3JrZXJJZDogdGhpcy53b3JrZXJJZH0pXG4gICAgfSBjYXRjaCB7XG4gICAgICAvLyBTb2NrZXQgaXMgY2xvc2luZy9jbG9zZWQ7IHRoZSBjbG9zZSBoYW5kbGVyIGRyaXZlcyByZWNvbm5lY3QuXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIFN0b3BzIHRoZSBsaXZlbmVzcyBoZWFydGJlYXQgdGltZXIuXG4gICAqIEByZXR1cm5zIHt2b2lkfVxuICAgKi9cbiAgX3N0b3BIZWFydGJlYXQoKSB7XG4gICAgaWYgKHRoaXMuX2hlYXJ0YmVhdFRpbWVyKSB7XG4gICAgICBjbGVhckludGVydmFsKHRoaXMuX2hlYXJ0YmVhdFRpbWVyKVxuICAgICAgdGhpcy5faGVhcnRiZWF0VGltZXIgPSB1bmRlZmluZWRcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogUnVucyBoYW5kbGUgam9iLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vdHlwZXMuanNcIikuQmFja2dyb3VuZEpvYlBheWxvYWR9IHBheWxvYWQgLSBQYXlsb2FkLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyB3aGVuIGRvbmUuXG4gICAqL1xuICBhc3luYyBfaGFuZGxlSm9iKHBheWxvYWQpIHtcbiAgICBpZiAoIXBheWxvYWQuaWQpIHRocm93IG5ldyBFcnJvcihcIkJhY2tncm91bmQgam9iIHBheWxvYWQgbWlzc2luZyBpZFwiKVxuICAgIC8qKlxuICAgICAqIElkZW50aWZpZWQgcGF5bG9hZC5cbiAgICAgKiBAdHlwZSB7aW1wb3J0KFwiLi90eXBlcy5qc1wiKS5CYWNrZ3JvdW5kSm9iUGF5bG9hZCAmIHtpZDogc3RyaW5nfX0gKi9cbiAgICBjb25zdCBpZGVudGlmaWVkUGF5bG9hZCA9IC8qKiBAdHlwZSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59ICovIChwYXlsb2FkKVxuXG4gICAgY29uc3QgZXhlY3V0aW9uTW9kZSA9IHRoaXMuX2V4ZWN1dGlvbk1vZGVGb3JQYXlsb2FkKGlkZW50aWZpZWRQYXlsb2FkKVxuXG4gICAgaWYgKGV4ZWN1dGlvbk1vZGUgPT09IFwicG9vbGVkXCIpIHtcbiAgICAgIHRoaXMuX3F1ZXVlUG9vbGVkSm9iKGlkZW50aWZpZWRQYXlsb2FkKVxuICAgICAgcmV0dXJuXG4gICAgfVxuXG4gICAgaWYgKGV4ZWN1dGlvbk1vZGUgIT09IFwiaW5saW5lXCIpIHtcbiAgICAgIHRoaXMuX3RyYWNrUHJvY2Vzc0pvYih0aGlzLl9zdGFydFByb2Nlc3NKb2Ioe2V4ZWN1dGlvbk1vZGUsIHBheWxvYWQ6IGlkZW50aWZpZWRQYXlsb2FkfSkpXG4gICAgICByZXR1cm5cbiAgICB9XG5cbiAgICB0aGlzLl9oYW5kbGVJbmxpbmVKb2IoaWRlbnRpZmllZFBheWxvYWQpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBzdGFydCBwcm9jZXNzIGpvYi5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBPcHRpb25zLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vdHlwZXMuanNcIikuQmFja2dyb3VuZEpvYkV4ZWN1dGlvbk1vZGV9IGFyZ3MuZXhlY3V0aW9uTW9kZSAtIEV4ZWN1dGlvbiBtb2RlLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vdHlwZXMuanNcIikuQmFja2dyb3VuZEpvYlBheWxvYWQgJiB7aWQ6IHN0cmluZ319IGFyZ3MucGF5bG9hZCAtIFBheWxvYWQuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIHdoZW4gdGhlIHByb2Nlc3Mgam9iIGV4aXRzLlxuICAgKi9cbiAgX3N0YXJ0UHJvY2Vzc0pvYih7ZXhlY3V0aW9uTW9kZSwgcGF5bG9hZH0pIHtcbiAgICBpZiAoZXhlY3V0aW9uTW9kZSA9PT0gXCJmb3JrZWRcIikgcmV0dXJuIHRoaXMuX2ZvcmtKb2IocGF5bG9hZClcblxuICAgIHJldHVybiB0aGlzLl9zcGF3bkpvYihwYXlsb2FkKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgaGFuZGxlIGlubGluZSBqb2IuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi90eXBlcy5qc1wiKS5CYWNrZ3JvdW5kSm9iUGF5bG9hZCAmIHtpZDogc3RyaW5nfX0gcGF5bG9hZCAtIFBheWxvYWQuXG4gICAqIEByZXR1cm5zIHt2b2lkfVxuICAgKi9cbiAgX2hhbmRsZUlubGluZUpvYihwYXlsb2FkKSB7XG4gICAgLy8gSW5saW5lIGpvYnMgc2hhcmUgdGhlIHdvcmtlcidzIHByb2Nlc3MgYW5kIERCIHBvb2wsIGJ1dCBlYWNoIG9uZVxuICAgIC8vIGlzIGl0cyBvd24gYXN5bmMgY2hhaW4g4oCUIHRoZXJlJ3Mgbm8gc2VtYW50aWMgcmVhc29uIHRvIHNlcmlhbGl6ZVxuICAgIC8vIHRoZW0uIFdlIGtpY2sgb2ZmIHRoZSBqb2IsIHJlZ2lzdGVyIGl0IHdpdGggYGluZmxpZ2h0SW5saW5lSm9ic2BcbiAgICAvLyBmb3Igc2h1dGRvd24gZHJhaW4sIGFuZCBzaWduYWwgY2FwYWNpdHkgdG8gbWFpbjpcbiAgICAvLyAtIElmIHdlIHN0aWxsIGhhdmUgYSBmcmVlIHNsb3Qgd2UgYXNrIGZvciB0aGUgbmV4dCBqb2IgcmlnaHRcbiAgICAvLyAgIGF3YXksIHNvIGEgc2xvdyBqb2IgKGUuZy4gYSBkb2NrZXIgYWxpdmUgY2hlY2sgdGhhdCB3YWl0cyAxNXNcbiAgICAvLyAgIG9uIGEgZ29uZSBzZXJ2ZXIpIG5vIGxvbmdlciBzdGFydmVzIGV2ZXJ5IG90aGVyIGlubGluZSBqb2IuXG4gICAgLy8gLSBXaGVuIHRoZSBqb2IgZmluaXNoZXMsIGlmIHRoZSB3b3JrZXIgaGFkIGJlZW4gYXQgdGhlIGNhcCwgd2VcbiAgICAvLyAgIGFzayBmb3IgdGhlIG5leHQgam9iIHRvIHJlZmlsbCB0aGUgc2xvdC5cbiAgICAvLyBUaGUgYm9va2tlZXBpbmcgaW4gYGZpbmFsbHkoKWAgcmF0Y2hldHMgY2FwYWNpdHkgYmFjayB1cFxuICAgIC8vIHJlZ2FyZGxlc3Mgb2Ygc3VjY2VzcyBvciBmYWlsdXJlLlxuICAgIC8qKlxuICAgICAqIERlZmluZXMgaW5mbGlnaHQuXG4gICAgICogQHR5cGUge1Byb21pc2U8dm9pZD59ICovXG4gICAgbGV0IGluZmxpZ2h0XG5cbiAgICBpbmZsaWdodCA9IHRoaXMuX3J1bklubGluZUpvYkFuZFJlcG9ydChwYXlsb2FkKS5maW5hbGx5KCgpID0+IHtcbiAgICAgIHRoaXMuaW5mbGlnaHRJbmxpbmVKb2JzLmRlbGV0ZShpbmZsaWdodClcblxuICAgICAgLy8gUmUtYW5ub3VuY2Ugb24gZXZlcnkgY29tcGxldGlvbiBiZWxvdyBjYXAsIG5vdCBqdXN0IHRoZSBjYXDihpJjYXAtMSBlZGdlIOKAlFxuICAgICAgLy8gc2VlIF90cmFja1Byb2Nlc3NKb2IgZm9yIHdoeSB0aGUga25pZmUtZWRnZSBjb25kaXRpb24gc2lsZW50bHkgd2VkZ2VzLlxuICAgICAgaWYgKCF0aGlzLnNob3VsZFN0b3ApIHRoaXMuX3NlbmRSZWFkeUlmUnVubmluZygpXG4gICAgfSlcblxuICAgIHRoaXMuaW5mbGlnaHRJbmxpbmVKb2JzLmFkZChpbmZsaWdodClcblxuICAgIGlmICh0aGlzLmluZmxpZ2h0SW5saW5lSm9icy5zaXplIDwgdGhpcy5tYXhDb25jdXJyZW50SW5saW5lSm9icykge1xuICAgICAgdGhpcy5fc2VuZFJlYWR5SWZSdW5uaW5nKClcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogUnVucyBleGVjdXRpb24gbW9kZSBmb3IgcGF5bG9hZC5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL3R5cGVzLmpzXCIpLkJhY2tncm91bmRKb2JQYXlsb2FkfSBwYXlsb2FkIC0gUGF5bG9hZC5cbiAgICogQHJldHVybnMge2ltcG9ydChcIi4vdHlwZXMuanNcIikuQmFja2dyb3VuZEpvYkV4ZWN1dGlvbk1vZGV9IC0gRXhlY3V0aW9uIG1vZGUuXG4gICAqL1xuICBfZXhlY3V0aW9uTW9kZUZvclBheWxvYWQocGF5bG9hZCkge1xuICAgIGNvbnN0IGV4ZWN1dGlvbk1vZGUgPSBwYXlsb2FkLm9wdGlvbnM/LmV4ZWN1dGlvbk1vZGVcblxuICAgIHJldHVybiBleGVjdXRpb25Nb2RlID8gdGhpcy5fbm9ybWFsaXplRXhlY3V0aW9uTW9kZShleGVjdXRpb25Nb2RlKSA6IFwicG9vbGVkXCJcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIG5vcm1hbGl6ZSBleGVjdXRpb24gbW9kZS5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGV4ZWN1dGlvbk1vZGUgLSBFeGVjdXRpb24gbW9kZS5cbiAgICogQHJldHVybnMge2ltcG9ydChcIi4vdHlwZXMuanNcIikuQmFja2dyb3VuZEpvYkV4ZWN1dGlvbk1vZGV9IC0gTm9ybWFsaXplZCBleGVjdXRpb24gbW9kZS5cbiAgICovXG4gIF9ub3JtYWxpemVFeGVjdXRpb25Nb2RlKGV4ZWN1dGlvbk1vZGUpIHtcbiAgICBmb3IgKGNvbnN0IG1vZGUgb2YgRVhFQ1VUSU9OX01PREVTKSB7XG4gICAgICBpZiAobW9kZSA9PT0gZXhlY3V0aW9uTW9kZSkgcmV0dXJuIG1vZGVcbiAgICB9XG5cbiAgICB0aHJvdyBuZXcgRXJyb3IoYEludmFsaWQgYmFja2dyb3VuZCBqb2IgZXhlY3V0aW9uTW9kZTogJHtleGVjdXRpb25Nb2RlfWApXG4gIH1cblxuICAvKipcbiAgICogUnVucyB0cmFjayBwcm9jZXNzIGpvYi5cbiAgICogQHBhcmFtIHtQcm9taXNlPHZvaWQ+fSBwcm9jZXNzSm9iIC0gUHJvY2VzcyBqb2IgcHJvbWlzZS5cbiAgICogQHJldHVybnMge3ZvaWR9XG4gICAqL1xuICBfdHJhY2tQcm9jZXNzSm9iKHByb2Nlc3NKb2IpIHtcbiAgICAvKipcbiAgICAgKiBEZWZpbmVzIGluZmxpZ2h0LlxuICAgICAqIEB0eXBlIHtQcm9taXNlPHZvaWQ+fSAqL1xuICAgIGxldCBpbmZsaWdodFxuXG4gICAgaW5mbGlnaHQgPSBwcm9jZXNzSm9iLmZpbmFsbHkoKCkgPT4ge1xuICAgICAgdGhpcy5pbmZsaWdodFByb2Nlc3NKb2JzLmRlbGV0ZShpbmZsaWdodClcblxuICAgICAgLy8gUmUtYW5ub3VuY2UgcmVhZGluZXNzIG9uIEVWRVJZIGNvbXBsZXRpb24gdGhhdCBsZWF2ZXMgdXMgYmVsb3cgY2FwIOKAlCBub3RcbiAgICAgIC8vIGp1c3QgdGhlIHNpbmdsZSBjYXDihpJjYXAtMSBlZGdlLiBUaGUgbWFpbiByZW1vdmVzIGEgd29ya2VyIGZyb20gaXRzIHJlYWR5XG4gICAgICAvLyBzZXQgb24gZWFjaCBkaXNwYXRjaCAoYF9kcmFpbk9uY2VgKSBhbmQgb25seSByZS1hZGRzIGl0IG9uIGEgZnJlc2hcbiAgICAgIC8vIFwicmVhZHlcIjsgZ2F0aW5nIHRoZSByZS1hbm5vdW5jZSBvbiBvbmUga25pZmUtZWRnZSB0cmFuc2l0aW9uIG1lYW5zIGFcbiAgICAgIC8vIHNpbmdsZSBtaXNzZWQgb3IgbG9zdCBzaWduYWwgbGVhdmVzIHRoZSB3b3JrZXIgb3V0IG9mIHRoZSByZWFkeSBzZXQgYW5kXG4gICAgICAvLyB3ZWRnZXMgZGlzcGF0Y2ggY2x1c3Rlci13aWRlLiBUaGlzIHdhcyB0aGUgc2lsZW50LWZyZWV6ZSByb290IGNhdXNlLlxuICAgICAgLy8gYF9zZW5kUmVhZHlJZlJ1bm5pbmdgIHNlbGYtZ3VhcmRzIChpdCBzZW5kcyBub3RoaW5nIHdoZW4gdGhlIHdvcmtlciBpc1xuICAgICAgLy8gZ2VudWluZWx5IGF0IGNhcGFjaXR5KSwgc28gcmUtYW5ub3VuY2luZyBvbiBldmVyeSBmcmVlZCBzbG90IGlzIHNhZmUgYW5kXG4gICAgICAvLyBpZGVtcG90ZW50IG9uIHRoZSBtYWluLlxuICAgICAgaWYgKCF0aGlzLnNob3VsZFN0b3ApIHRoaXMuX3NlbmRSZWFkeUlmUnVubmluZygpXG4gICAgfSlcblxuICAgIHRoaXMuaW5mbGlnaHRQcm9jZXNzSm9icy5hZGQoaW5mbGlnaHQpXG4gICAgdGhpcy5fc2VuZFJlYWR5SWZSdW5uaW5nKClcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHJ1biBpbmxpbmUgam9iIGFuZCByZXBvcnQuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi90eXBlcy5qc1wiKS5CYWNrZ3JvdW5kSm9iUGF5bG9hZCAmIHtpZDogc3RyaW5nfX0gcGF5bG9hZCAtIFBheWxvYWQgd2l0aCByZXF1aXJlZCBpZC5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgd2hlbiBjb21wbGV0ZSAoc3VjY2VzcyBvciBmYWlsdXJlIHJlcG9ydGVkKS5cbiAgICovXG4gIGFzeW5jIF9ydW5JbmxpbmVKb2JBbmRSZXBvcnQocGF5bG9hZCkge1xuICAgIC8vIFJlcG9ydCBpbiB0aGUgYmFja2dyb3VuZCBzbyBmcmVlaW5nIHRoaXMgaW5saW5lIHNsb3QgbmV2ZXIgd2FpdHMgb24gdGhlXG4gICAgLy8gcmVwb3J0LiBSZXBvcnRpbmcgaXMgZHVyYWJsZSAocmV0cmllZCB1bnRpbCBpdCBsYW5kcyksIHNvIGEgdHJhbnNpZW50XG4gICAgLy8gbWFpbi9EQiBvdXRhZ2UgbmVpdGhlciB3ZWRnZXMgdGhlIHNsb3Qgbm9yIGxvc2VzIHRoZSB0ZXJtaW5hbCByZXN1bHQuXG4gICAgdHJ5IHtcbiAgICAgIGF3YWl0IHRoaXMuX3J1bkpvYklubGluZShwYXlsb2FkKVxuICAgICAgdGhpcy5fcmVwb3J0Sm9iUmVzdWx0SW5CYWNrZ3JvdW5kKHtcbiAgICAgICAgam9iSWQ6IHBheWxvYWQuaWQsXG4gICAgICAgIHN0YXR1czogXCJjb21wbGV0ZWRcIixcbiAgICAgICAgaGFuZG9mZklkOiBwYXlsb2FkLmhhbmRvZmZJZCxcbiAgICAgICAgaGFuZGVkT2ZmQXRNczogcGF5bG9hZC5oYW5kZWRPZmZBdE1zLFxuICAgICAgICB3b3JrZXJJZDogcGF5bG9hZC53b3JrZXJJZCB8fCB0aGlzLndvcmtlcklkXG4gICAgICB9KVxuICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICBpZiAoZXJyb3IgaW5zdGFuY2VvZiBCYWNrZ3JvdW5kSm9iUmVzY2hlZHVsZVNpZ25hbCkge1xuICAgICAgICB0aGlzLl9yZXBvcnRKb2JSZXN1bHRJbkJhY2tncm91bmQoe1xuICAgICAgICAgIGpvYklkOiBwYXlsb2FkLmlkLFxuICAgICAgICAgIHN0YXR1czogXCJyZXNjaGVkdWxlZFwiLFxuICAgICAgICAgIGRlbGF5TXM6IGVycm9yLmRlbGF5TXMsXG4gICAgICAgICAgaGFuZG9mZklkOiBwYXlsb2FkLmhhbmRvZmZJZCxcbiAgICAgICAgICBoYW5kZWRPZmZBdE1zOiBwYXlsb2FkLmhhbmRlZE9mZkF0TXMsXG4gICAgICAgICAgd29ya2VySWQ6IHBheWxvYWQud29ya2VySWQgfHwgdGhpcy53b3JrZXJJZFxuICAgICAgICB9KVxuICAgICAgICByZXR1cm5cbiAgICAgIH1cblxuICAgICAgdGhpcy5fcmVwb3J0Sm9iUmVzdWx0SW5CYWNrZ3JvdW5kKHtcbiAgICAgICAgam9iSWQ6IHBheWxvYWQuaWQsXG4gICAgICAgIHN0YXR1czogXCJmYWlsZWRcIixcbiAgICAgICAgZXJyb3IsXG4gICAgICAgIGhhbmRvZmZJZDogcGF5bG9hZC5oYW5kb2ZmSWQsXG4gICAgICAgIGhhbmRlZE9mZkF0TXM6IHBheWxvYWQuaGFuZGVkT2ZmQXRNcyxcbiAgICAgICAgd29ya2VySWQ6IHBheWxvYWQud29ya2VySWQgfHwgdGhpcy53b3JrZXJJZFxuICAgICAgfSlcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogQWR2ZXJ0aXNlcyBjdXJyZW50IHdvcmtlciBjYXBhY2l0eSB1bmxlc3MgdGhlIHdvcmtlciBpcyBkcmFpbmluZy5cbiAgICogQHBhcmFtIHtvYmplY3R9IFtvcHRpb25zXSAtIEFkdmVydGlzZW1lbnQgb3B0aW9ucy5cbiAgICogQHBhcmFtIHtib29sZWFufSBbb3B0aW9ucy5yZXZva2VQb29sZWRBZG1pc3Npb25dIC0gUmV2b2tlIHBvb2xlZCBjcmVkaXRzIHdoaWxlIHByZXNlcnZpbmcgb3RoZXIgZXhlY3V0aW9uIG1vZGVzLlxuICAgKiBAcmV0dXJucyB7dm9pZH1cbiAgICovXG4gIF9zZW5kUmVhZHlJZlJ1bm5pbmcoe3Jldm9rZVBvb2xlZEFkbWlzc2lvbiA9IGZhbHNlfSA9IHt9KSB7XG4gICAgaWYgKHRoaXMuc2hvdWxkU3RvcCB8fCB0aGlzLmlzUmV0aXJpbmcpIHJldHVyblxuICAgIGlmICghdGhpcy5qc29uU29ja2V0KSByZXR1cm5cbiAgICBpZiAodGhpcy5nZW5lcmF0aW9uSWQgJiYgIXRoaXMuX2dlbmVyYXRpb25BY2NlcHRlZCkgcmV0dXJuXG5cbiAgICBjb25zdCByZWFkeU1lc3NhZ2UgPSB0aGlzLl9yZWFkeU1lc3NhZ2Uoe3Jldm9rZVBvb2xlZEFkbWlzc2lvbn0pXG5cbiAgICBpZiAoIXJlYWR5TWVzc2FnZSkgcmV0dXJuXG4gICAgdGhpcy5qc29uU29ja2V0LnNlbmQocmVhZHlNZXNzYWdlKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgcmVhZHkgbWVzc2FnZS5cbiAgICogQHBhcmFtIHtvYmplY3R9IFtvcHRpb25zXSAtIEFkdmVydGlzZW1lbnQgb3B0aW9ucy5cbiAgICogQHBhcmFtIHtib29sZWFufSBbb3B0aW9ucy5yZXZva2VQb29sZWRBZG1pc3Npb25dIC0gUmV2b2tlIHBvb2xlZCBjcmVkaXRzIHdoaWxlIHByZXNlcnZpbmcgb3RoZXIgZXhlY3V0aW9uIG1vZGVzLlxuICAgKiBAcmV0dXJucyB7aW1wb3J0KFwiLi90eXBlcy5qc1wiKS5CYWNrZ3JvdW5kSm9iU29ja2V0TWVzc2FnZSB8IG51bGx9IC0gUmVhZHkgbWVzc2FnZSBvciBudWxsIHdoZW4gdGhlIHdvcmtlciBoYXMgbm8gY2FwYWNpdHkuXG4gICAqL1xuICBfcmVhZHlNZXNzYWdlKHtyZXZva2VQb29sZWRBZG1pc3Npb24gPSBmYWxzZX0gPSB7fSkge1xuICAgIGNvbnN0IGFjY2VwdHNQcm9jZXNzSm9iID0gdGhpcy5pbmZsaWdodFByb2Nlc3NKb2JzLnNpemUgPCB0aGlzLm1heENvbmN1cnJlbnRGb3JrZWRKb2JzXG4gICAgY29uc3QgYWNjZXB0c0lubGluZSA9IHRoaXMuaW5mbGlnaHRJbmxpbmVKb2JzLnNpemUgPCB0aGlzLm1heENvbmN1cnJlbnRJbmxpbmVKb2JzXG4gICAgY29uc3QgYXZhaWxhYmxlUG9vbGVkU2xvdHMgPSByZXZva2VQb29sZWRBZG1pc3Npb24gPyAwIDogdGhpcy5fYXZhaWxhYmxlUG9vbGVkU2xvdHMoKVxuICAgIGNvbnN0IGFjY2VwdHNQb29sZWQgPSBhdmFpbGFibGVQb29sZWRTbG90cyA+IDBcblxuICAgIGlmICghcmV2b2tlUG9vbGVkQWRtaXNzaW9uICYmICFhY2NlcHRzUHJvY2Vzc0pvYiAmJiAhYWNjZXB0c0lubGluZSAmJiAhYWNjZXB0c1Bvb2xlZCkgcmV0dXJuIG51bGxcblxuICAgIHJldHVybiB7XG4gICAgICB0eXBlOiBcInJlYWR5XCIsXG4gICAgICBhY2NlcHRzRm9ya2VkOiBhY2NlcHRzUHJvY2Vzc0pvYixcbiAgICAgIGFjY2VwdHNJbmxpbmUsXG4gICAgICBhY2NlcHRzUG9vbGVkLFxuICAgICAgYXZhaWxhYmxlUG9vbGVkU2xvdHMsXG4gICAgICBhY2NlcHRzU3Bhd25lZDogYWNjZXB0c1Byb2Nlc3NKb2JcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogVHJhY2tzIGEgcG9vbGVkIGpvYiBhbmQgcmUtYWR2ZXJ0aXNlcyBjYXBhY2l0eS5cbiAgICogQHBhcmFtIHtQcm9taXNlPHZvaWQ+fSBwb29sZWRKb2IgLSBQb29sZWQgam9iIHByb21pc2UuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFRoZSB0cmFja2VkIGluLWZsaWdodCBwcm9taXNlLlxuICAgKi9cbiAgX3RyYWNrUG9vbGVkSm9iKHBvb2xlZEpvYikge1xuICAgIC8qKiBAdHlwZSB7UHJvbWlzZTx2b2lkPn0gKi9cbiAgICBsZXQgaW5mbGlnaHRcbiAgICBpbmZsaWdodCA9IHBvb2xlZEpvYi5maW5hbGx5KCgpID0+IHtcbiAgICAgIHRoaXMuaW5mbGlnaHRQb29sZWRKb2JzLmRlbGV0ZShpbmZsaWdodClcbiAgICAgIGlmICghdGhpcy5zaG91bGRTdG9wICYmICF0aGlzLl9wb29sZWRTdGFydHVwRmFpbHVyZUpvYnMuaGFzKHBvb2xlZEpvYikgJiYgIXRoaXMuX3Bvb2xlZFN0YXJ0dXBGYWlsdXJlSm9icy5oYXMoaW5mbGlnaHQpKSB0aGlzLl9zZW5kUmVhZHlJZlJ1bm5pbmcoKVxuICAgIH0pXG4gICAgdGhpcy5pbmZsaWdodFBvb2xlZEpvYnMuYWRkKGluZmxpZ2h0KVxuICAgIHJldHVybiBpbmZsaWdodFxuICB9XG5cbiAgLyoqXG4gICAqIFNlcmlhbGl6ZXMgcmVwZWF0ZWQgbGVhc2VzIGZvciBvbmUgZHVyYWJsZSByb3cgd2hpbGUgcHJlc2VydmluZyBwb29sZWRcbiAgICogY29uY3VycmVuY3kgYWNyb3NzIGRpZmZlcmVudCBqb2IgaWRzLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vdHlwZXMuanNcIikuQmFja2dyb3VuZEpvYlBheWxvYWQgJiB7aWQ6IHN0cmluZ319IHBheWxvYWQgLSBQb29sZWQgam9iIHBheWxvYWQuXG4gICAqIEByZXR1cm5zIHt2b2lkfVxuICAgKi9cbiAgX3F1ZXVlUG9vbGVkSm9iKHBheWxvYWQpIHtcbiAgICBjb25zdCBxdWV1ZSA9IHRoaXMucG9vbGVkSm9iUXVldWVzLmdldChwYXlsb2FkLmlkKVxuICAgIGlmIChxdWV1ZSkge1xuICAgICAgcXVldWUucHVzaChwYXlsb2FkKVxuICAgICAgcmV0dXJuXG4gICAgfVxuXG4gICAgdGhpcy5wb29sZWRKb2JRdWV1ZXMuc2V0KHBheWxvYWQuaWQsIFtwYXlsb2FkXSlcbiAgICBjb25zdCB0cmFja2VyID0gdGhpcy5fdHJhY2tQb29sZWRKb2IodGhpcy5fcnVuUG9vbGVkSm9iUXVldWUocGF5bG9hZC5pZCkpXG4gICAgdGhpcy5wb29sZWRKb2JRdWV1ZVRyYWNrZXJzLnNldChwYXlsb2FkLmlkLCB0cmFja2VyKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgYWRtaXR0ZWQgbGVhc2VzIGZvciBvbmUgZHVyYWJsZSBqb2IgaWQgaW4gYXJyaXZhbCBvcmRlci5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGpvYklkIC0gRHVyYWJsZSBqb2IgaWQuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIGFmdGVyIHRoZSBwZXItaWQgcXVldWUgZHJhaW5zLlxuICAgKi9cbiAgYXN5bmMgX3J1blBvb2xlZEpvYlF1ZXVlKGpvYklkKSB7XG4gICAgY29uc3QgcXVldWUgPSB0aGlzLnBvb2xlZEpvYlF1ZXVlcy5nZXQoam9iSWQpXG4gICAgaWYgKCFxdWV1ZSkgdGhyb3cgbmV3IEVycm9yKGBQb29sZWQgam9iIHF1ZXVlIG1pc3NpbmcgZm9yIGpvYjogJHtqb2JJZH1gKVxuXG4gICAgdHJ5IHtcbiAgICAgIHdoaWxlIChxdWV1ZS5sZW5ndGggPiAwKSB7XG4gICAgICAgIGNvbnN0IHBheWxvYWQgPSBxdWV1ZS5zaGlmdCgpXG4gICAgICAgIGlmICghcGF5bG9hZCkgdGhyb3cgbmV3IEVycm9yKGBQb29sZWQgam9iIHF1ZXVlIGNvbnRhaW5lZCBhbiBlbXB0eSBwYXlsb2FkIGZvciBqb2I6ICR7am9iSWR9YClcbiAgICAgICAgYXdhaXQgdGhpcy5fcnVuUG9vbGVkSm9iKHBheWxvYWQpXG4gICAgICB9XG4gICAgfSBmaW5hbGx5IHtcbiAgICAgIGNvbnN0IHRyYWNrZXIgPSB0aGlzLnBvb2xlZEpvYlF1ZXVlVHJhY2tlcnMuZ2V0KGpvYklkKVxuICAgICAgaWYgKHRyYWNrZXIpIHtcbiAgICAgICAgdGhpcy5pbmZsaWdodFBvb2xlZEpvYnMuZGVsZXRlKHRyYWNrZXIpXG4gICAgICAgIHRoaXMucG9vbGVkSm9iUXVldWVUcmFja2Vycy5kZWxldGUoam9iSWQpXG4gICAgICB9XG4gICAgICB0aGlzLnBvb2xlZEpvYlF1ZXVlcy5kZWxldGUoam9iSWQpXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIEhhcmQgY2FwIG9uIHRvdGFsIGxpdmUgcG9vbGVkIGNoaWxkcmVuICh3b3JraW5nICsgZHJhaW5pbmcpOiBjaGlsZHJlbiB0aGVcbiAgICogcG9vbCBtYXkgc3RpbGwgc3Bhd24uIENvdW50aW5nIHRoZSB3aG9sZSBsaXZlIHNldCDigJQgZHJhaW5pbmcgY2hpbGRyZW5cbiAgICogaW5jbHVkZWQg4oCUIGlzIHdoYXQgYm91bmRzIHBvb2wgbWVtb3J5OiBhIGRyYWluaW5nIGNoaWxkIHN0aWxsIGhvbGRzIGl0c1xuICAgKiBSU1MgdW50aWwgaXRzIGxhc3QgaW4tZmxpZ2h0IGpvYiBmaW5pc2hlcywgc28gaXQgbXVzdCBvY2N1cHkgYSBjYXAgc2xvdC5cbiAgICogQHJldHVybnMge251bWJlcn0gLSBOdW1iZXIgb2YgY2hpbGRyZW4gdGhlIHBvb2wgbWF5IHN0aWxsIHNwYXduLlxuICAgKi9cbiAgX3NwYXduYWJsZVBvb2xlZENoaWxkcmVuKCkge1xuICAgIHJldHVybiBNYXRoLm1heCgwLCB0aGlzLnBvb2xlZFJ1bm5lckNvdW50IC0gdGhpcy5wb29sZWRDaGlsZHJlbi5zaXplKVxuICB9XG5cbiAgLyoqXG4gICAqIENvdW50cyBsaXZlIGNoaWxkcmVuIHN0aWxsIGFibGUgdG8gcnVuIG5ldyB3b3JrLiBUaGUgcG9vbCBtdXN0IGFsd2F5c1xuICAgKiBrZWVwIOKAlCBvciByZXN0b3JlLCB0aHJvdWdoIHRoZSBib3VuZGVkIG92ZXItY2FwIGxpdmVuZXNzIHJlcGxhY2VtZW50IOKAlCBhdFxuICAgKiBsZWFzdCBvbmUgbm9uLXJldGlyaW5nIGNoaWxkOiB3aXRoIGV2ZXJ5IGxpdmUgY2hpbGQgcmV0aXJpbmcsIGFkdmVydGlzZWRcbiAgICogY2FwYWNpdHkgaXMgemVybyBmb3IgdGhlIGVudGlyZSBkcmFpbiB3aW5kb3csIHdoaWNoIGNhbiBzdHJldGNoIHRvIHRoZVxuICAgKiBsb25nZXN0IGluLWZsaWdodCBqb2IsIGFuZCBkaXNwYXRjaCBzaWxlbnRseSBzdGFsbHMuXG4gICAqIEByZXR1cm5zIHtudW1iZXJ9IC0gTnVtYmVyIG9mIG5vbi1yZXRpcmluZyBwb29sZWQgY2hpbGRyZW4uXG4gICAqL1xuICBfbm9uUmV0aXJpbmdQb29sZWRDaGlsZENvdW50KCkge1xuICAgIGxldCBjb3VudCA9IDBcblxuICAgIGZvciAoY29uc3Qgc3RhdGUgb2YgdGhpcy5wb29sZWRDaGlsZFN0YXRlcy52YWx1ZXMoKSkge1xuICAgICAgaWYgKCFzdGF0ZS5yZXRpcmluZykgY291bnQgKz0gMVxuICAgIH1cblxuICAgIHJldHVybiBjb3VudFxuICB9XG5cbiAgLyoqXG4gICAqIFJlc29sdmVzIG9uY2UgYSBub24tcmV0aXJpbmcgcG9vbGVkIGNoaWxkIGhhcyBhIGZyZWUgY29uY3VycmVuY3kgc2xvdCBvciB0aGVcbiAgICogcG9vbCBtYXkgc3Bhd24gYSBuZXcgb25lLiBQb29sZWQgam9icyBhZG1pdHRlZCB3aGlsZSB0aGUgcG9vbCBpcyBhdCBpdHNcbiAgICogaGFyZCBjYXAgd2FpdCBoZXJlIGluc3RlYWQgb2Ygc3Bhd25pbmcgYW4gb3Zlci1jYXBhY2l0eSBjaGlsZDsgdGhlIHdha2VcbiAgICogcG9pbnRzIGFyZSB0aGUgb25seSBjYXBhY2l0eS1mcmVlaW5nIHRyYW5zaXRpb25zIChhIGpvYiBvdXRjb21lIGFuZCBhIGNoaWxkXG4gICAqIGV4aXQpLCBzbyBubyBwb2xsaW5nIGlzIG5lZWRlZC5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgd2hlbiBhIHNsb3QgaXMgYXZhaWxhYmxlLlxuICAgKi9cbiAgX3dhaXRQb29sZWRTbG90KCkge1xuICAgIHRoaXMuX3N0YXJ0UG9vbGVkU2xvdFdhaXRQb2xsKClcblxuICAgIHJldHVybiBuZXcgUHJvbWlzZSgocmVzb2x2ZSkgPT4ge1xuICAgICAgY29uc3Qgd2FpdGVyID0gKCkgPT4ge1xuICAgICAgICB0aGlzLl9wb29sZWRTbG90V2FpdGVycy5kZWxldGUod2FpdGVyKVxuICAgICAgICB0aGlzLl9zdG9wUG9vbGVkU2xvdFdhaXRQb2xsSWZJZGxlKClcbiAgICAgICAgcmVzb2x2ZSgpXG4gICAgICB9XG5cbiAgICAgIHRoaXMuX3Bvb2xlZFNsb3RXYWl0ZXJzLmFkZCh3YWl0ZXIpXG4gICAgfSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSZXNvbHZlcyBldmVyeSByZWdpc3RlcmVkIHdhaXRlcjsgd2FpdGVycyByZS1jaGVjayB0aGUgc2xvdCBjb25kaXRpb25cbiAgICogdGhlbXNlbHZlcyBhbmQgb25seSBwcm9jZWVkIHdoZW4gaXQgaG9sZHMuXG4gICAqIEByZXR1cm5zIHt2b2lkfVxuICAgKi9cbiAgX3dha2VQb29sZWRTbG90V2FpdGVycygpIHtcbiAgICBpZiAodGhpcy5fcG9vbGVkU2xvdFdhaXRlcnMuc2l6ZSA9PT0gMCkgcmV0dXJuXG5cbiAgICBmb3IgKGNvbnN0IHJlc29sdmUgb2YgWy4uLnRoaXMuX3Bvb2xlZFNsb3RXYWl0ZXJzXSkgcmVzb2x2ZSgpXG4gIH1cblxuICAvKipcbiAgICogRnJlZSBwb29sZWQgc2xvdHMgYWNyb3NzIHRoZSBwb29sOiBvcGVuIHNsb3RzIGluIG5vbi1yZXRpcmluZyBjaGlsZHJlbiBwbHVzXG4gICAqIHRoZSBzbG90cyB3ZSBjb3VsZCBhZGQgYnkgc3Bhd25pbmcgbW9yZSBjaGlsZHJlbiB1cCB0byB0aGUgaGFyZCBjYXAgb24gdG90YWxcbiAgICogbGl2ZSBjaGlsZHJlbi4gUmV0aXJpbmcgY2hpbGRyZW4gKGRyYWluaW5nIGJlZm9yZSByZXBsYWNlbWVudCkgbmV2ZXJcbiAgICogY29udHJpYnV0ZSBjYXBhY2l0eSwgYW5kIHRoZXkgY291bnQgYWdhaW5zdCB0aGUgY2FwOiB3aGlsZSBvbmUgaXMgc3RpbGxcbiAgICogZHJhaW5pbmcsIG5vIHJlcGxhY2VtZW50IGlzIGFkdmVydGlzZWQgKG9yIHNwYXduZWQpIOKAlCB0aGUgcG9vbCBhZHZlcnRpc2VzXG4gICAqIGV4YWN0bHkgd2hhdCBpdCBjYW4gc2VydmUgaW5zdGVhZCBvZiBwaGFudG9tIGNhcGFjaXR5LlxuICAgKiBAcmV0dXJucyB7bnVtYmVyfSAtIE51bWJlciBvZiBwb29sZWQgam9icyB0aGUgd29ya2VyIGNhbiBhY2NlcHQgcmlnaHQgbm93LlxuICAgKi9cbiAgX2F2YWlsYWJsZVBvb2xlZFNsb3RzKCkge1xuICAgIGxldCBvcGVuSW5FeGlzdGluZyA9IDBcbiAgICBsZXQgcXVldWVkUmVzZXJ2YXRpb25zID0gMFxuXG4gICAgZm9yIChjb25zdCBjaGlsZCBvZiB0aGlzLnBvb2xlZENoaWxkcmVuKSB7XG4gICAgICBjb25zdCBzdGF0ZSA9IHRoaXMucG9vbGVkQ2hpbGRTdGF0ZXMuZ2V0KGNoaWxkKVxuICAgICAgaWYgKCFzdGF0ZSB8fCBzdGF0ZS5yZXRpcmluZykgY29udGludWVcbiAgICAgIG9wZW5JbkV4aXN0aW5nICs9IHRoaXMucG9vbGVkUnVubmVyQ29uY3VycmVuY3kgLSBzdGF0ZS5pbmZsaWdodC5zaXplXG4gICAgfVxuXG4gICAgZm9yIChjb25zdCBxdWV1ZSBvZiB0aGlzLnBvb2xlZEpvYlF1ZXVlcy52YWx1ZXMoKSkgcXVldWVkUmVzZXJ2YXRpb25zICs9IHF1ZXVlLmxlbmd0aFxuXG4gICAgY29uc3Qgc3Bhd25hYmxlQ2hpbGRyZW4gPSBNYXRoLm1heCgwLCB0aGlzLnBvb2xlZFJ1bm5lckNvdW50IC0gdGhpcy5wb29sZWRDaGlsZHJlbi5zaXplKVxuXG4gICAgcmV0dXJuIE1hdGgubWF4KDAsIG9wZW5JbkV4aXN0aW5nICsgc3Bhd25hYmxlQ2hpbGRyZW4gKiB0aGlzLnBvb2xlZFJ1bm5lckNvbmN1cnJlbmN5IC0gcXVldWVkUmVzZXJ2YXRpb25zKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgYSBwYXlsb2FkIG9uIGEgcG9vbGVkIGNoaWxkIHdpdGggYSBmcmVlIGNvbmN1cnJlbmN5IHNsb3QsIHNwYXduaW5nIGFcbiAgICogbmV3IGNoaWxkIHdoZW4gZXZlcnkgbm9uLXJldGlyaW5nIGNoaWxkIGlzIGZ1bGwgYW5kIHRoZSBwb29sIGlzIGJlbG93XG4gICAqIGBwb29sZWRSdW5uZXJDb3VudGAuIEVhY2ggY2hpbGQgcnVucyB1cCB0byBgcG9vbGVkUnVubmVyQ29uY3VycmVuY3lgIGpvYnMgYXRcbiAgICogb25jZSBvbiBpdHMgb3duIGV2ZW50IGxvb3AuXG4gICAqXG4gICAqIFdoZW4gdGhlIHBvb2wgaXMgYWxyZWFkeSBhdCBpdHMgaGFyZCBjYXAgKHRvdGFsIGxpdmUgY2hpbGRyZW4sIGRyYWluaW5nXG4gICAqIGluY2x1ZGVkKSwgdGhlIGpvYiB3YWl0cyBmb3IgYSBzbG90IGluc3RlYWQgb2Ygc3Bhd25pbmc6IHRoYXQgaXMgd2hhdCBrZWVwc1xuICAgKiB0aGUgbGl2ZS1jaGlsZCBjb3VudCDigJQgYW5kIHRoZXJlZm9yZSB0aGUgcG9vbCdzIHRvdGFsIFJTUyDigJQgYm91bmRlZC4gVGhlXG4gICAqIHdhaXQgcmVzb2x2ZXMgb24gdGhlIG9ubHkgdHdvIGNhcGFjaXR5LWZyZWVpbmcgdHJhbnNpdGlvbnMgKGEgam9iIG91dGNvbWUsXG4gICAqIGEgY2hpbGQgZXhpdCk7IGEgc2FmZXR5IHBvbGwgY292ZXJzIGFueXRoaW5nIG1pc3NlZC5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL3R5cGVzLmpzXCIpLkJhY2tncm91bmRKb2JQYXlsb2FkICYge2lkOiBzdHJpbmd9fSBwYXlsb2FkIC0gSm9iIHBheWxvYWQuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIGFmdGVyIHRoZSBkdXJhYmxlIHJlcG9ydC5cbiAgICovXG4gIGFzeW5jIF9ydW5Qb29sZWRKb2IocGF5bG9hZCkge1xuICAgIC8vIEF0IHRoZSBoYXJkIGNhcCAobm8gZnJlZSBzbG90LCBubyBzcGF3bmFibGUgY2hpbGQpIHRoZSBqb2Igd2FpdHMgZm9yIGFcbiAgICAvLyBzbG90IGluc3RlYWQgb2Ygc3Bhd25pbmcgYW4gb3Zlci1jYXBhY2l0eSBjaGlsZCDigJQgdGhhdCBpcyB3aGF0IGJvdW5kc1xuICAgIC8vIHRoZSBsaXZlLWNoaWxkIGNvdW50IGFuZCB0aGUgcG9vbCdzIHRvdGFsIFJTUy5cbiAgICBsZXQgY2hpbGQgPSB0aGlzLl9zZWxlY3RQb29sZWRDaGlsZCgpXG4gICAgd2hpbGUgKCFjaGlsZCkge1xuICAgICAgaWYgKHRoaXMuX3NwYXduYWJsZVBvb2xlZENoaWxkcmVuKCkgPT09IDApIHtcbiAgICAgICAgLy8gU2h1dGRvd246IG1haW4gbm8gbG9uZ2VyIGRpc3BhdGNoZXMgYW5kIG5vIHNsb3Qgd2lsbCBldmVyIGZyZWUg4oCUXG4gICAgICAgIC8vIHN0b3Agd2FpdGluZyBzbyB0aGUgdHJhY2tlZCBqb2IgY2FuIHNldHRsZSBhbmQgdGhlIGRyYWluIGNvbXBsZXRlcy5cbiAgICAgICAgaWYgKHRoaXMuc2hvdWxkU3RvcCkgcmV0dXJuXG4gICAgICAgIGF3YWl0IHRoaXMuX3dhaXRQb29sZWRTbG90KClcbiAgICAgICAgY2hpbGQgPSB0aGlzLl9zZWxlY3RQb29sZWRDaGlsZCgpXG4gICAgICAgIGNvbnRpbnVlXG4gICAgICB9XG4gICAgICBjaGlsZCA9IHRoaXMuX3NlbGVjdFBvb2xlZENoaWxkKCkgfHwgdGhpcy5fY3JlYXRlUG9vbGVkQ2hpbGQoKVxuICAgIH1cblxuICAgIGNvbnN0IHN0YXRlID0gdGhpcy5wb29sZWRDaGlsZFN0YXRlcy5nZXQoY2hpbGQpXG4gICAgaWYgKCFzdGF0ZSkgdGhyb3cgbmV3IEVycm9yKFwiUG9vbGVkIHJ1bm5lciBzdGF0ZSBtaXNzaW5nXCIpXG5cbiAgICAvLyBTdGFtcCB0aGUgcm91bmQtcm9iaW4gY3Vyc29yIHNvIHRoZSBuZXh0IGRpc3BhdGNoIHByZWZlcnMgYSBkaWZmZXJlbnQgY2hpbGQuXG4gICAgc3RhdGUubGFzdERpc3BhdGNoU2VxID0gKyt0aGlzLl9wb29sZWREaXNwYXRjaFNlcVxuXG4gICAgLyoqXG4gICAgICogUmVzb2x2ZXMgdGhlIHBvb2xlZCBqb2IgcHJvbWlzZS5cbiAgICAgKiBAdHlwZSB7KHZhbHVlOiB2b2lkKSA9PiB2b2lkfVxuICAgICAqL1xuICAgIGxldCByZXNvbHZlUG9vbGVkSm9iID0gKCkgPT4ge31cbiAgICBjb25zdCBwb29sZWRKb2IgPSBuZXcgUHJvbWlzZSgocmVzb2x2ZSkgPT4geyByZXNvbHZlUG9vbGVkSm9iID0gcmVzb2x2ZSB9KVxuICAgIGNvbnN0IHRpbWVvdXRUaW1lciA9IHRoaXMuX2FybVBvb2xlZEpvYlRpbWVvdXQoe2NoaWxkLCBwYXlsb2FkfSlcblxuICAgIHN0YXRlLmluZmxpZ2h0LnNldChwYXlsb2FkLmlkLCB7cGF5bG9hZCwgcmVzb2x2ZTogcmVzb2x2ZVBvb2xlZEpvYiwgcG9vbGVkSm9iLCB0aW1lb3V0VGltZXJ9KVxuICAgIHRyeSB7XG4gICAgICBjaGlsZC5zZW5kKHt0eXBlOiBcImpvYlwiLCBwYXlsb2FkLCBzaGFyZWRUcmFuc2FjdGlvbkJyb2tlcjogdGhpcy5fcG9vbGVkSm9iU2hhcmVkVHJhbnNhY3Rpb25Ccm9rZXJDb25maWcoKX0pXG4gICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgIHZvaWQgdGhpcy5faGFuZGxlUG9vbGVkQ2hpbGRGYWlsdXJlKHtjaGlsZCwgZXJyb3IsIG9yaWdpbjogXCJpcGMtc2VuZFwifSlcbiAgICB9XG5cbiAgICByZXR1cm4gcG9vbGVkSm9iXG4gIH1cblxuICAvKipcbiAgICogQ2FwdHVyZXMgdGhlIGN1cnJlbnQgdGVzdCBhdHRlbXB0J3MgYnJva2VyIG1vZGUgYXQgZGlzcGF0Y2ggdGltZS4gQSB3YXJtXG4gICAqIHBvb2xlZCBjaGlsZCBtdXN0IG5ldmVyIHJlbHkgb24gaXRzIGltbXV0YWJsZSBmb3JrLXRpbWUgZW52aXJvbm1lbnQuXG4gICAqIEByZXR1cm5zIHtpbXBvcnQoXCIuLi90ZXN0aW5nL3NoYXJlZC10cmFuc2FjdGlvbi1wcm94eS1kcml2ZXIuanNcIikuU2hhcmVkVHJhbnNhY3Rpb25Ccm9rZXJKb2JDb25maWd9IC0gUGVyLWpvYiBicm9rZXIgY29uZmlndXJhdGlvbi5cbiAgICovXG4gIF9wb29sZWRKb2JTaGFyZWRUcmFuc2FjdGlvbkJyb2tlckNvbmZpZygpIHtcbiAgICBjb25zdCBzZXJpYWxpemVkID0gcHJvY2Vzcy5lbnYuVkVMT0NJT1VTX1RFU1RfU0hBUkVEX1RSQU5TQUNUSU9OX0JST0tFUlxuICAgIGlmICghc2VyaWFsaXplZCkgcmV0dXJuIHtleHBlY3RlZDogZmFsc2V9XG5cbiAgICBjb25zdCBjb25maWcgPSBKU09OLnBhcnNlKEJ1ZmZlci5mcm9tKHNlcmlhbGl6ZWQsIFwiYmFzZTY0dXJsXCIpLnRvU3RyaW5nKFwidXRmOFwiKSlcbiAgICByZXR1cm4gey4uLmNvbmZpZywgZXhwZWN0ZWQ6IHRydWV9XG4gIH1cblxuICAvKipcbiAgICogU2VsZWN0cyBhIHBvb2xlZCBjaGlsZCB0byBydW4gdGhlIG5leHQgam9iLCBvciB1bmRlZmluZWQgd2hlbiBldmVyeSBub24tcmV0aXJpbmdcbiAgICogY2hpbGQgaXMgYWxyZWFkeSBmdWxsICh0aGUgY2FsbGVyIHRoZW4gbGF6aWx5IHNwYXducyBvbmUpLiBBbW9uZyBjaGlsZHJlbiB3aXRoIGFcbiAgICogZnJlZSBjb25jdXJyZW5jeSBzbG90LCBwaWNrcyB0aGUgb25lIGRpc3BhdGNoZWQgbGVhc3QgcmVjZW50bHkg4oCUIGEgcm91bmQtcm9iaW4gdGhhdFxuICAgKiBzcHJlYWRzIGpvYnMgKG5vdGFibHkgbXVsdGktbWludXRlIFJ1bkJ1aWxkSm9icywgZWFjaCBwaW5uaW5nIGEgdGVuYW50IGNvbm5lY3Rpb25cbiAgICogZm9yIGl0cyB3aG9sZSBydW4pIGV2ZW5seSBhY3Jvc3MgY2hpbGRyZW4gaW5zdGVhZCBvZiBmaXJzdC1maXQgcGFja2luZyB0aGUgZWFybGllc3RcbiAgICogb25lIHVudGlsIGl0IGlzIGZ1bGwuIEEgZnJlc2hseSBzcGF3bmVkIG9yIHJlcGxhY2VtZW50IGNoaWxkIHRoZXJlZm9yZSB0YWtlcyBpdHNcbiAgICogZmFpciBzaGFyZSBvbmUgam9iIGF0IGEgdGltZSBhcyBpdHMgdHVybiBjb21lcyB1cCwgcmF0aGVyIHRoYW4gYWJzb3JiaW5nIGEgYnVyc3QgdG9cbiAgICogXCJjYXRjaCB1cFwiIHRvIHRoZSBvdGhlcnMuXG4gICAqIEByZXR1cm5zIHtpbXBvcnQoXCJub2RlOmNoaWxkX3Byb2Nlc3NcIikuQ2hpbGRQcm9jZXNzIHwgdW5kZWZpbmVkfSAtIFRoZSBjaG9zZW4gY2hpbGQsIG9yIHVuZGVmaW5lZCB3aGVuIGFsbCBub24tcmV0aXJpbmcgY2hpbGRyZW4gYXJlIGZ1bGwuXG4gICAqL1xuICBfc2VsZWN0UG9vbGVkQ2hpbGQoKSB7XG4gICAgLyoqIEB0eXBlIHtpbXBvcnQoXCJub2RlOmNoaWxkX3Byb2Nlc3NcIikuQ2hpbGRQcm9jZXNzIHwgdW5kZWZpbmVkfSAqL1xuICAgIGxldCBzZWxlY3RlZFxuICAgIGxldCBzZWxlY3RlZFNlcSA9IEluZmluaXR5XG5cbiAgICBmb3IgKGNvbnN0IGNoaWxkIG9mIHRoaXMucG9vbGVkQ2hpbGRyZW4pIHtcbiAgICAgIGNvbnN0IHN0YXRlID0gdGhpcy5wb29sZWRDaGlsZFN0YXRlcy5nZXQoY2hpbGQpXG5cbiAgICAgIGlmICghc3RhdGUgfHwgc3RhdGUucmV0aXJpbmcgfHwgc3RhdGUuaW5mbGlnaHQuc2l6ZSA+PSB0aGlzLnBvb2xlZFJ1bm5lckNvbmN1cnJlbmN5KSBjb250aW51ZVxuXG4gICAgICBpZiAoc3RhdGUubGFzdERpc3BhdGNoU2VxIDwgc2VsZWN0ZWRTZXEpIHtcbiAgICAgICAgc2VsZWN0ZWQgPSBjaGlsZFxuICAgICAgICBzZWxlY3RlZFNlcSA9IHN0YXRlLmxhc3REaXNwYXRjaFNlcVxuICAgICAgfVxuICAgIH1cblxuICAgIHJldHVybiBzZWxlY3RlZFxuICB9XG5cbiAgLyoqXG4gICAqIEFybXMgYSBwZXItam9iIHdhbGwtY2xvY2sgYmFja3N0b3AgZm9yIGEgcG9vbGVkIGpvYi4gQSBwb29sZWQgY2hpbGQgaG9zdHMgbWFueVxuICAgKiBjb25jdXJyZW50IGpvYnMsIHNvIGEgc2luZ2xlIGdlbnVpbmVseS1odW5nIGpvYiB3b3VsZCBvdGhlcndpc2UgcGluIGl0c1xuICAgKiBydW5uZXIncyBjb25jdXJyZW5jeSBzbG90IGZvcmV2ZXIg4oCUIHRoZSBsaWZldGltZSByZWN5Y2xlIG9ubHkgcmV0aXJlcyBhIGNoaWxkXG4gICAqIG9uY2UgaXRzIGluLWZsaWdodCBzZXQgZHJhaW5zLCB3aGljaCBhIGh1bmcgam9iIG5ldmVyIGRvZXMuIE9uIG92ZXJydW4gdGhlXG4gICAqIHdob2xlIGNoaWxkIGlzIHRlcm1pbmF0ZWQgc28gdGhlIGh1bmcgam9iIChhbmQgaXRzIHNpYmxpbmdzKSByZXF1ZXVlLiBSZXR1cm5zXG4gICAqIHRoZSB0aW1lciwgb3IgbnVsbCB3aGVuIG5vIHRpbWVvdXQgaXMgY29uZmlndXJlZC5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBPcHRpb25zLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIm5vZGU6Y2hpbGRfcHJvY2Vzc1wiKS5DaGlsZFByb2Nlc3N9IGFyZ3MuY2hpbGQgLSBQb29sZWQgY2hpbGQuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi90eXBlcy5qc1wiKS5CYWNrZ3JvdW5kSm9iUGF5bG9hZCAmIHtpZDogc3RyaW5nfX0gYXJncy5wYXlsb2FkIC0gSm9iIHBheWxvYWQgd2hvc2Ugb3ZlcnJ1biBpcyBndWFyZGVkLlxuICAgKiBAcmV0dXJucyB7UmV0dXJuVHlwZTx0eXBlb2Ygc2V0VGltZW91dD4gfCBudWxsfSAtIFRoZSBhcm1lZCB0aW1lciwgb3IgbnVsbC5cbiAgICovXG4gIF9hcm1Qb29sZWRKb2JUaW1lb3V0KHtjaGlsZCwgcGF5bG9hZH0pIHtcbiAgICBjb25zdCB0aW1lb3V0TXMgPSB0aGlzLl9yZXNvbHZlSm9iVGltZW91dE1zKHBheWxvYWQub3B0aW9ucylcblxuICAgIGlmICghKHR5cGVvZiB0aW1lb3V0TXMgPT09IFwibnVtYmVyXCIgJiYgdGltZW91dE1zID4gMCkpIHJldHVybiBudWxsXG5cbiAgICByZXR1cm4gc2V0VGltZW91dCgoKSA9PiB0aGlzLl9vblBvb2xlZEpvYlRpbWVvdXQoe2NoaWxkLCBqb2JJZDogcGF5bG9hZC5pZH0pLCB0aW1lb3V0TXMpXG4gIH1cblxuICAvKipcbiAgICogRmlyZWQgd2hlbiBhIHBvb2xlZCBqb2Igb3ZlcnJ1bnMgaXRzIHRpbWVvdXQuIFRlcm1pbmF0ZXMgdGhlIGNoaWxkIHJ1bm5pbmcgaXRcbiAgICogKFNJR1RFUk0sIHRoZW4gU0lHS0lMTCBhZnRlciB0aGUgZ3JhY2UpIOKAlCBhIGh1bmcgSlMgam9iIGNhbm5vdCBiZSBjYW5jZWxsZWRcbiAgICogYW55IG90aGVyIHdheS4gVGhlIG5vbi1jbGVhbiBleGl0IGZsb3dzIHRocm91Z2ggYF9oYW5kbGVQb29sZWRDaGlsZEZhaWx1cmVgLFxuICAgKiB3aGljaCByZXBvcnRzIGV2ZXJ5IGluLWZsaWdodCBqb2Igb24gdGhlIGNoaWxkIGZhaWxlZCAoc28gdGhleSByZXF1ZXVlKSBhbmRcbiAgICogZHJvcHMgaXQgZnJvbSB0cmFja2luZzsgdGhlIGZhaWx1cmUgcGF0aCBpbW1lZGlhdGVseSByZS1hZHZlcnRpc2VzIHRoZVxuICAgKiByZXN1bHRpbmcgY2FwYWNpdHkgb25jZSB0aGUgcnVubmVyIGhhcyBjb21wbGV0ZWQgc3RhcnR1cC5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBPcHRpb25zLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIm5vZGU6Y2hpbGRfcHJvY2Vzc1wiKS5DaGlsZFByb2Nlc3N9IGFyZ3MuY2hpbGQgLSBQb29sZWQgY2hpbGQuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBhcmdzLmpvYklkIC0gSm9iIGlkIHRoYXQgb3ZlcnJhbi5cbiAgICogQHJldHVybnMge3ZvaWR9XG4gICAqL1xuICBfb25Qb29sZWRKb2JUaW1lb3V0KHtjaGlsZCwgam9iSWR9KSB7XG4gICAgY29uc3Qgc3RhdGUgPSB0aGlzLnBvb2xlZENoaWxkU3RhdGVzLmdldChjaGlsZClcblxuICAgIC8vIEFscmVhZHkgc2V0dGxpbmcvZ29uZSwgb3IgdGhlIGpvYiBmaW5pc2hlZCBpbiB0aGUgcmFjZSB3aXRoIHRoaXMgdGltZXIuXG4gICAgaWYgKCFzdGF0ZSB8fCBzdGF0ZS5zZXR0bGluZyB8fCBzdGF0ZS5zaHV0ZG93blJlYXNvbiB8fCAhc3RhdGUuaW5mbGlnaHQuaGFzKGpvYklkKSkgcmV0dXJuXG5cbiAgICBzdGF0ZS50aW1lb3V0Sm9iSWQgPSBqb2JJZFxuICAgIHRoaXMuX3JlcXVlc3RQb29sZWRDaGlsZFNodXRkb3duKHtjaGlsZCwgcmVhc29uOiBcImpvYl90aW1lb3V0XCIsIHNpZ25hbDogXCJTSUdURVJNXCJ9KVxuXG4gICAgc3RhdGUudGltZW91dFNpZ2tpbGxUaW1lciA9IHNldFRpbWVvdXQoKCkgPT4ge1xuICAgICAgdHJ5IHtcbiAgICAgICAgY2hpbGQua2lsbChcIlNJR0tJTExcIilcbiAgICAgIH0gY2F0Y2gge1xuICAgICAgICAvLyBDaGlsZCBhbHJlYWR5IGV4aXRlZDsgbm90aGluZyB0byBkby5cbiAgICAgIH1cbiAgICB9LCB0aGlzLmZvcmtlZENoaWxkU2lna2lsbEdyYWNlTXMpXG4gIH1cblxuICAvKipcbiAgICogQ3JlYXRlcyBhIHJldXNhYmxlIHBvb2xlZCBjaGlsZCwgZW5mb3JjaW5nIHRoZSBoYXJkIGNhcCBvbiB0b3RhbCBsaXZlXG4gICAqIGNoaWxkcmVuICh3b3JraW5nICsgZHJhaW5pbmcpLiBSZXR1cm5zIHVuZGVmaW5lZCB3aGVuIHRoZSBjYXAgaXMgYWxyZWFkeVxuICAgKiBtZXQg4oCUIHRoZSBvbmx5IHdheSBhIG5ldyBjaGlsZCBtYXkgZXhpc3QgaXMgYSBzbG90IGJlaW5nIG9wZW4sIHNvIHRoZVxuICAgKiBjYWxsZXIgcmUtY2hlY2tzIGFuZCB3YWl0cyBhZ2Fpbi4gYGFsbG93T3ZlckNhcGAgaXMgcmVzZXJ2ZWQgZm9yIHRoZVxuICAgKiBib3VuZGVkIGxpdmVuZXNzIHJlcGxhY2VtZW50OiBhdCBtb3N0IG9uZSBjaGlsZCBiZXlvbmQgdGhlIGNhcCBtYXkgZXhpc3QsXG4gICAqIGFuZCBvbmx5IHdoZW4gZXZlcnkgb3RoZXIgbGl2ZSBjaGlsZCBpcyBhbHJlYWR5IHJldGlyaW5nIChzZWVcbiAgICogYF9iZWdpblJldGlyZVBvb2xlZENoaWxkYCBmb3IgdGhlIGdhdGUpLlxuICAgKiBAcGFyYW0ge29iamVjdH0gW2FyZ3NdIC0gU3Bhd24gb3B0aW9ucy5cbiAgICogQHBhcmFtIHtib29sZWFufSBbYXJncy5hbGxvd092ZXJDYXBdIC0gQWxsb3cgb25lIG92ZXItY2FwIHNwYXduIGZvciB0aGUgbGl2ZW5lc3MgcmVwbGFjZW1lbnQuXG4gICAqIEByZXR1cm5zIHtpbXBvcnQoXCJub2RlOmNoaWxkX3Byb2Nlc3NcIikuQ2hpbGRQcm9jZXNzIHwgdW5kZWZpbmVkfSAtIFRoZSBuZXcgY2hpbGQsIG9yIHVuZGVmaW5lZCB3aGVuIHRoZSBwb29sIGlzIGF0IGl0cyBjYXAuXG4gICAqL1xuICBfY3JlYXRlUG9vbGVkQ2hpbGQoe2FsbG93T3ZlckNhcCA9IGZhbHNlfSA9IHt9KSB7XG4gICAgY29uc3QgY29uZmlndXJhdGlvbiA9IHRoaXMuY29uZmlndXJhdGlvblxuICAgIGlmICghY29uZmlndXJhdGlvbikgdGhyb3cgbmV3IEVycm9yKFwiQmFja2dyb3VuZCBqb2JzIHdvcmtlciBjb25maWd1cmF0aW9uIG5vdCBpbml0aWFsaXplZFwiKVxuICAgIGlmICghYWxsb3dPdmVyQ2FwICYmIHRoaXMucG9vbGVkQ2hpbGRyZW4uc2l6ZSA+PSB0aGlzLnBvb2xlZFJ1bm5lckNvdW50KSByZXR1cm4gdW5kZWZpbmVkXG4gICAgY29uc3QgY2hpbGQgPSBmb3JrKFBPT0xFRF9SVU5ORVJfRU5UUllfUEFUSCwgW10sIHtcbiAgICAgIGN3ZDogY29uZmlndXJhdGlvbi5nZXREaXJlY3RvcnkoKSwgZXhlY0FyZ3Y6IHRoaXMuX2NoaWxkUnVubmVyRXhlY0FyZ3YoKSwgc3RkaW86IFtcImlnbm9yZVwiLCBcImlnbm9yZVwiLCBcImlnbm9yZVwiLCBcImlwY1wiXSxcbiAgICAgIGVudjogT2JqZWN0LmFzc2lnbih7fSwgcHJvY2Vzcy5lbnYsIHRoaXMuX2NoaWxkQmFja2dyb3VuZEpvYnNFbnZpcm9ubWVudCgpKVxuICAgIH0pXG4gICAgdGhpcy5wb29sZWRDaGlsZHJlbi5hZGQoY2hpbGQpXG4gICAgdGhpcy5pbmZsaWdodFByb2Nlc3NDaGlsZHJlbi5hZGQoY2hpbGQpXG4gICAgdGhpcy5wb29sZWRDaGlsZFN0YXRlcy5zZXQoY2hpbGQsIHtjcmVhdGVkQXRNczogRGF0ZS5ub3coKSwgam9ic1J1bjogMCwgaW5mbGlnaHQ6IG5ldyBNYXAoKSwgbGFzdERpc3BhdGNoU2VxOiAwLCByZXRpcmluZzogZmFsc2UsIHN0YXJ0ZWQ6IGZhbHNlfSlcbiAgICBjaGlsZC5vbihcIm1lc3NhZ2VcIiwgKG1lc3NhZ2UpID0+IHRoaXMuX2hhbmRsZVBvb2xlZENoaWxkTWVzc2FnZSh7Y2hpbGQsIG1lc3NhZ2V9KSlcbiAgICBjaGlsZC5vbmNlKFwiZXhpdFwiLCAoZXhpdENvZGUsIHNpZ25hbCkgPT4gdGhpcy5faGFuZGxlUG9vbGVkQ2hpbGRGYWlsdXJlKHtcbiAgICAgIGNoaWxkLFxuICAgICAgZXJyb3I6IG5ldyBFcnJvcihgUG9vbGVkIGJhY2tncm91bmQgam9iIHJ1bm5lciBleGl0ZWQ6IGNvZGU9JHtleGl0Q29kZX0gc2lnbmFsPSR7c2lnbmFsIHx8IFwibm9uZVwifWApLFxuICAgICAgZXhpdENvZGUsXG4gICAgICBvcmlnaW46IFwiZXhpdFwiLFxuICAgICAgc2lnbmFsXG4gICAgfSkpXG4gICAgY2hpbGQub25jZShcImVycm9yXCIsIChlcnJvcikgPT4gdGhpcy5faGFuZGxlUG9vbGVkQ2hpbGRGYWlsdXJlKHtcbiAgICAgIGNoaWxkLFxuICAgICAgZXJyb3IsXG4gICAgICBleGl0Q29kZTogY2hpbGQuZXhpdENvZGUsXG4gICAgICBvcmlnaW46IFwicHJvY2Vzcy1lcnJvclwiLFxuICAgICAgc2lnbmFsOiBjaGlsZC5zaWduYWxDb2RlXG4gICAgfSkpXG4gICAgY2hpbGQub25jZShcImRpc2Nvbm5lY3RcIiwgKCkgPT4ge1xuICAgICAgY29uc3Qgc3RhdGUgPSB0aGlzLnBvb2xlZENoaWxkU3RhdGVzLmdldChjaGlsZClcbiAgICAgIGlmIChzdGF0ZSkgc3RhdGUuaXBjRGlzY29ubmVjdGVkQXRNcyA/Pz0gRGF0ZS5ub3coKVxuICAgIH0pXG4gICAgcmV0dXJuIGNoaWxkXG4gIH1cblxuICAvKipcbiAgICogSGFuZGxlcyBhIHBvb2xlZCBjaGlsZCdzIHBlci1qb2IgZHVyYWJsZS1yZXBvcnQgYWNrbm93bGVkZ2VtZW50LiBBIGNoaWxkXG4gICAqIHJ1bnMgam9icyBjb25jdXJyZW50bHkgYW5kIHJlcG9ydHMgb25lIGBqb2Itb3V0Y29tZWAgcGVyIGpvYiBpZC5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBNZXNzYWdlIGRldGFpbHMuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwibm9kZTpjaGlsZF9wcm9jZXNzXCIpLkNoaWxkUHJvY2Vzc30gYXJncy5jaGlsZCAtIFBvb2xlZCBjaGlsZC5cbiAgICogQHBhcmFtIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gYXJncy5tZXNzYWdlIC0gSVBDIG1lc3NhZ2UuXG4gICAqIEByZXR1cm5zIHt2b2lkfVxuICAgKi9cbiAgX2hhbmRsZVBvb2xlZENoaWxkTWVzc2FnZSh7Y2hpbGQsIG1lc3NhZ2V9KSB7XG4gICAgaWYgKCFtZXNzYWdlIHx8IHR5cGVvZiBtZXNzYWdlICE9PSBcIm9iamVjdFwiKSByZXR1cm5cbiAgICBjb25zdCByZWNvcmQgPSAvKiogQHR5cGUge3t0eXBlPzogUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4sIGNoaWxkSW5zdGFuY2VJZD86IFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+LCBqb2JJZD86IFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+LCBhY2tub3dsZWRnZWQ/OiBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPiwgcnNzQnl0ZXM/OiBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPiwgcGVha1Jzc0J5dGVzPzogUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4sIGVycm9yPzogUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59fSAqLyAobWVzc2FnZSlcbiAgICBjb25zdCBzdGF0ZSA9IHRoaXMucG9vbGVkQ2hpbGRTdGF0ZXMuZ2V0KGNoaWxkKVxuICAgIGlmIChyZWNvcmQudHlwZSA9PT0gXCJyZWFkeVwiKSB7XG4gICAgICBpZiAoc3RhdGUpIHtcbiAgICAgICAgc3RhdGUuc3RhcnRlZCA9IHRydWVcbiAgICAgICAgaWYgKHR5cGVvZiByZWNvcmQuY2hpbGRJbnN0YW5jZUlkID09PSBcInN0cmluZ1wiKSBzdGF0ZS5jaGlsZEluc3RhbmNlSWQgPSByZWNvcmQuY2hpbGRJbnN0YW5jZUlkXG4gICAgICB9XG4gICAgICByZXR1cm5cbiAgICB9XG4gICAgaWYgKGlzQ2hpbGRTaHV0ZG93bk9ic2VydmF0aW9uTWVzc2FnZShtZXNzYWdlKSkge1xuICAgICAgaWYgKHN0YXRlKSB7XG4gICAgICAgIHN0YXRlLmNoaWxkSW5zdGFuY2VJZCA9IG1lc3NhZ2UuY2hpbGRJbnN0YW5jZUlkXG4gICAgICAgIHN0YXRlLnNodXRkb3duT2JzZXJ2YXRpb24gPSBtZXNzYWdlXG4gICAgICAgIGlmIChzdGF0ZS5zaHV0ZG93blNpZ25hbFRpbWVyKSB7XG4gICAgICAgICAgY2xlYXJUaW1lb3V0KHN0YXRlLnNodXRkb3duU2lnbmFsVGltZXIpXG4gICAgICAgICAgc3RhdGUuc2h1dGRvd25TaWduYWxUaW1lciA9IHVuZGVmaW5lZFxuICAgICAgICB9XG4gICAgICB9XG4gICAgICByZXR1cm5cbiAgICB9XG4gICAgaWYgKGlzQ2hpbGRBY2NlcHRhbmNlTWVzc2FnZShtZXNzYWdlKSkge1xuICAgICAgdGhpcy5fcmVwb3J0Q2hpbGRBY2NlcHRlZChtZXNzYWdlKVxuICAgICAgcmV0dXJuXG4gICAgfVxuICAgIGlmIChpc1Bvb2xlZENoaWxkTWVtb3J5T2JzZXJ2YXRpb25NZXNzYWdlKG1lc3NhZ2UpKSB7XG4gICAgICB0aGlzLl9oYW5kbGVQb29sZWRDaGlsZE1lbW9yeU9ic2VydmF0aW9uKHtjaGlsZCwgbWVzc2FnZX0pXG4gICAgICByZXR1cm5cbiAgICB9XG4gICAgaWYgKHJlY29yZC50eXBlICE9PSBcImpvYi1vdXRjb21lXCIgfHwgIXN0YXRlIHx8IHN0YXRlLnNldHRsaW5nIHx8IHR5cGVvZiByZWNvcmQuam9iSWQgIT09IFwic3RyaW5nXCIpIHJldHVyblxuICAgIHN0YXRlLnN0YXJ0ZWQgPSB0cnVlXG4gICAgY29uc3QgZW50cnkgPSBzdGF0ZS5pbmZsaWdodC5nZXQocmVjb3JkLmpvYklkKVxuICAgIGlmICghZW50cnkpIHJldHVyblxuXG4gICAgaWYgKGVudHJ5LnRpbWVvdXRUaW1lcikgY2xlYXJUaW1lb3V0KGVudHJ5LnRpbWVvdXRUaW1lcilcbiAgICBzdGF0ZS5pbmZsaWdodC5kZWxldGUocmVjb3JkLmpvYklkKVxuICAgIHN0YXRlLmpvYnNSdW4gKz0gMVxuICAgIGNvbnN0IHJlc29sdmUgPSBlbnRyeS5yZXNvbHZlXG5cbiAgICBpZiAocmVjb3JkLmFja25vd2xlZGdlZCA9PT0gdHJ1ZSkge1xuICAgICAgaWYgKHJlc29sdmUpIHJlc29sdmUodW5kZWZpbmVkKVxuICAgIH0gZWxzZSB7XG4gICAgICAvLyBUaGUgY2hpbGQgc3RheWVkIGFsaXZlIGJ1dCBjb3VsZCBub3QgY29uZmlybSB0aGlzIG9uZSBqb2IncyB0ZXJtaW5hbFxuICAgICAgLy8gcmVwb3J0OyByZWNsYWltIGp1c3QgdGhpcyBqb2Ig4oCUIGl0cyBjb25jdXJyZW50IHNpYmxpbmdzIGFyZSB1bmFmZmVjdGVkLlxuICAgICAgdm9pZCB0aGlzLl9yZXBvcnRKb2JSZXN1bHQoe1xuICAgICAgICBqb2JJZDogZW50cnkucGF5bG9hZC5pZCxcbiAgICAgICAgc3RhdHVzOiBcImZhaWxlZFwiLFxuICAgICAgICBlcnJvcjogbmV3IEVycm9yKHR5cGVvZiByZWNvcmQuZXJyb3IgPT09IFwic3RyaW5nXCIgPyByZWNvcmQuZXJyb3IgOiBcIlBvb2xlZCBydW5uZXIgdGVybWluYWwgcmVwb3J0IHdhcyBub3QgYWNrbm93bGVkZ2VkXCIpLFxuICAgICAgICBoYW5kb2ZmSWQ6IGVudHJ5LnBheWxvYWQuaGFuZG9mZklkLFxuICAgICAgICBoYW5kZWRPZmZBdE1zOiBlbnRyeS5wYXlsb2FkLmhhbmRlZE9mZkF0TXMsXG4gICAgICAgIHdvcmtlcklkOiBlbnRyeS5wYXlsb2FkLndvcmtlcklkIHx8IHRoaXMud29ya2VySWRcbiAgICAgIH0pLmZpbmFsbHkoKCkgPT4geyBpZiAocmVzb2x2ZSkgcmVzb2x2ZSh1bmRlZmluZWQpIH0pXG4gICAgfVxuXG4gICAgY29uc3QgcnNzQnl0ZXMgPSB0eXBlb2YgcmVjb3JkLnJzc0J5dGVzID09PSBcIm51bWJlclwiID8gcmVjb3JkLnJzc0J5dGVzIDogTnVtYmVyLlBPU0lUSVZFX0lORklOSVRZXG4gICAgLy8gVGhlIGNoaWxkJ3MgcGVhayBSU1MgKFZtSFdNKSBpcyBtb25vdG9uaWMgYW5kIG91dGxpdmVzIHRoZSBzZXR0bGVkXG4gICAgLy8gc2FtcGxlOiBhIHJhdGNoZXRlZCBidXJzdCB3b3JraW5nLXNldCBtdXN0IHJlY3ljbGUgdGhlIGNoaWxkIGV2ZW4gd2hlblxuICAgIC8vIHNldHRsZWQgUlNTIGF0IG91dGNvbWUgdGltZSBsb29rcyBtb2Rlc3QuIEEgY2hpbGQgd2l0aG91dCBwZWFrIHN1cHBvcnRcbiAgICAvLyBmYWxscyBiYWNrIHRvIHRoZSBzZXR0bGVkIHNhbXBsZS5cbiAgICBjb25zdCBwZWFrUnNzQnl0ZXMgPSB0eXBlb2YgcmVjb3JkLnBlYWtSc3NCeXRlcyA9PT0gXCJudW1iZXJcIiA/IHJlY29yZC5wZWFrUnNzQnl0ZXMgOiByc3NCeXRlc1xuICAgIGNvbnN0IHJ1bm5lckFnZU1zID0gRGF0ZS5ub3coKSAtIHN0YXRlLmNyZWF0ZWRBdE1zXG4gICAgaWYgKCFzdGF0ZS5yZXRpcmluZyAmJiAoc3RhdGUuam9ic1J1biA+PSB0aGlzLnBvb2xlZFJ1bm5lck1heEpvYnMgfHwgcGVha1Jzc0J5dGVzID49IHRoaXMucG9vbGVkUnVubmVyTWF4UnNzQnl0ZXMgfHwgcnVubmVyQWdlTXMgPj0gdGhpcy5wb29sZWRSdW5uZXJNYXhMaWZldGltZU1zIHx8IHRoaXMuc2hvdWxkU3RvcCkpIHtcbiAgICAgIHRoaXMuX2JlZ2luUmV0aXJlUG9vbGVkQ2hpbGQoY2hpbGQpXG4gICAgfVxuICAgIHRoaXMuX3Rlcm1pbmF0ZUlmRHJhaW5lZChjaGlsZClcbiAgICAvLyBBIGpvYiBvdXRjb21lIGZyZWVzIGEgY29uY3VycmVuY3kgc2xvdCBhbmQgbWF5IGRyYWluIGEgcmV0aXJpbmcgY2hpbGQg4oCUXG4gICAgLy8gdGhlIG9ubHkgdHdvIHRyYW5zaXRpb25zIHRoYXQgZnJlZSBjYXBhY2l0eSBmb3Igd2FpdGVycyBhdCB0aGUgaGFyZCBjYXAuXG4gICAgdGhpcy5fd2FrZVBvb2xlZFNsb3RXYWl0ZXJzKClcbiAgfVxuXG4gIC8qKlxuICAgKiBGb3J3YXJkcyBvbmUgcG9vbGVkIGNoaWxkJ3MgYWNjZXB0YW5jZSBvYnNlcnZhdGlvbiB0byBtYWluIGFzIGEgYm91bmRlZFxuICAgKiBkaWFnbm9zdGljIHJlcG9ydC4gVGhlIGNoaWxkIGNhcnJpZXMgaXRzIGV4YWN0IGhhbmRvZmYgbGVhc2UsIHNvIGEgdGltZW91dFxuICAgKiBvciBvdXRjb21lIHRoYXQgYWxyZWFkeSBzZXR0bGVkIHRoZSB3b3JrZXIncyBpbi1mbGlnaHQgZW50cnkgY2Fubm90IGxvc2VcbiAgICogdGhlIGZlbmNpbmcuIEEgcmVwb3J0IHRoYXQgbmV2ZXIgbGFuZHMgZGVncmFkZXMgcGhhc2UgZGlhZ25vc3RpY3MgZm9yIHRoYXRcbiAgICogam9iIG9ubHkg4oCUIGl0IG11c3QgbmV2ZXIgYmxvY2sgb3IgZmFpbCB0aGUgam9iIGl0c2VsZi5cbiAgICogQHBhcmFtIHt7dHlwZTogXCJqb2ItcmVjZWl2ZWRcIiB8IFwiam9iLXN0YXJ0ZWRcIiwgam9iSWQ6IHN0cmluZywgaGFuZG9mZklkPzogc3RyaW5nLCB3b3JrZXJJZD86IHN0cmluZywgaGFuZGVkT2ZmQXRNcz86IG51bWJlciwgcmVjZWl2ZWRBdE1zPzogbnVtYmVyLCBzdGFydGVkQXRNcz86IG51bWJlciwgY2hpbGRJbnN0YW5jZUlkPzogc3RyaW5nLCBjaGlsZFBpZD86IG51bWJlcn19IG1lc3NhZ2UgLSBWYWxpZGF0ZWQgY2hpbGQgYWNjZXB0YW5jZSBtZXNzYWdlLlxuICAgKiBAcmV0dXJucyB7dm9pZH1cbiAgICovXG4gIF9yZXBvcnRDaGlsZEFjY2VwdGVkKG1lc3NhZ2UpIHtcbiAgICBpZiAoIXRoaXMuc3RhdHVzUmVwb3J0ZXIpIHJldHVyblxuXG4gICAgdm9pZCB0aGlzLnN0YXR1c1JlcG9ydGVyLnJlcG9ydENoaWxkQWNjZXB0ZWRXaXRoUmV0cnkoe1xuICAgICAgam9iSWQ6IG1lc3NhZ2Uuam9iSWQsXG4gICAgICBoYW5kb2ZmSWQ6IG1lc3NhZ2UuaGFuZG9mZklkLFxuICAgICAgd29ya2VySWQ6IG1lc3NhZ2Uud29ya2VySWQsXG4gICAgICBoYW5kZWRPZmZBdE1zOiBtZXNzYWdlLmhhbmRlZE9mZkF0TXMsXG4gICAgICByZWNlaXZlZEF0TXM6IG1lc3NhZ2UucmVjZWl2ZWRBdE1zLFxuICAgICAgc3RhcnRlZEF0TXM6IG1lc3NhZ2Uuc3RhcnRlZEF0TXMsXG4gICAgICBjaGlsZEluc3RhbmNlSWQ6IG1lc3NhZ2UuY2hpbGRJbnN0YW5jZUlkLFxuICAgICAgY2hpbGRQaWQ6IG1lc3NhZ2UuY2hpbGRQaWQsXG4gICAgICBtYXhEdXJhdGlvbk1zOiBDSElMRF9BQ0NFUFRBTkNFX1JFUE9SVF9NQVhfRFVSQVRJT05fTVNcbiAgICB9KS5jYXRjaCgoZXJyb3IpID0+IHtcbiAgICAgIGNvbnNvbGUuZXJyb3IoXCJCYWNrZ3JvdW5kIGpvYiBjaGlsZC1hY2NlcHRhbmNlIHJlcG9ydGluZyBmYWlsZWQ6XCIsIGVycm9yKVxuICAgIH0pXG4gIH1cblxuICAvKipcbiAgICogSGFuZGxlcyBhIHBvb2xlZCBjaGlsZCdzIGJvdW5kZWQgbWVtb3J5IG9ic2VydmF0aW9uLiBUaGUgcG9vbGVkIGNoaWxkJ3NcbiAgICogc3RkaW8gaXMgaWdub3JlZCBieSB0aGUgd29ya2VyIGZvcmssIHNvIHRoaXMgSVBDIG9ic2VydmF0aW9uIGlzIGhvdyBhXG4gICAqIG1lbW9yeSBwcm9ibGVtIGluIGEgcnVubmluZyBjaGlsZCBuYW1lcyBpdHNlbGYuIFRoZSB3b3JrZXIgKGEpIHJlY29yZHMgdGhlXG4gICAqIGxhdGVzdCBvYnNlcnZhdGlvbiBvbiB0aGUgY2hpbGQncyBzdGF0ZSBmb3IgbGF0ZXIgY29ycmVsYXRpb24sIChiKSBsb2dzIG9uZVxuICAgKiBjb21wYWN0IGxpbmUgdG8gaXRzIG93biBzdGRlcnIgKHdoaWNoIHJlYWNoZXMgdGhlIHByb2QgbG9nLCB1bmxpa2UgdGhlXG4gICAqIGNoaWxkJ3MgaWdub3JlZCBzdGRpbyksIGFuZCAoYykgZm9yd2FyZHMgdGhlIGZ1bGwgb2JzZXJ2YXRpb24gdG8gdGhlXG4gICAqIG9wdGlvbmFsIGBvblBvb2xlZFJ1bm5lck1lbW9yeU9ic2VydmF0aW9uYCBob29rIHNvIGFuIGFwcGxpY2F0aW9uIGNhbiByb3V0ZVxuICAgKiBpdCAoZS5nLiB0byBhIGJ1ZyByZXBvcnRlcikgd2l0aG91dCBwYXJzaW5nIGxvZ3MuIFRoZSBoZWFwLXN0YXQgYnJlYWtkb3duXG4gICAqIGRpc3Rpbmd1aXNoZXMgVjgtaGVhcCBncm93dGggZnJvbSBleHRlcm5hbC9hcnJheS1idWZmZXIgKG5hdGl2ZSkgZ3Jvd3RoLiBBXG4gICAqIGhvb2sgZmFpbHVyZSBpcyBzd2FsbG93ZWQg4oCUIGRpYWdub3N0aWNzIG11c3QgbmV2ZXIgdGFrZSBkb3duIHRoZSB3b3JrZXIgb3JcbiAgICogZmFpbCB0aGUgam9icyBydW5uaW5nIG9uIHRoYXQgY2hpbGQuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gTWVzc2FnZSBkZXRhaWxzLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIm5vZGU6Y2hpbGRfcHJvY2Vzc1wiKS5DaGlsZFByb2Nlc3N9IGFyZ3MuY2hpbGQgLSBQb29sZWQgY2hpbGQuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi90eXBlcy5qc1wiKS5Qb29sZWRDaGlsZE1lbW9yeU9ic2VydmF0aW9ufSBhcmdzLm1lc3NhZ2UgLSBWYWxpZGF0ZWQgbWVtb3J5IG9ic2VydmF0aW9uLlxuICAgKiBAcmV0dXJucyB7dm9pZH1cbiAgICovXG4gIF9oYW5kbGVQb29sZWRDaGlsZE1lbW9yeU9ic2VydmF0aW9uKHtjaGlsZCwgbWVzc2FnZX0pIHtcbiAgICBjb25zdCBzdGF0ZSA9IHRoaXMucG9vbGVkQ2hpbGRTdGF0ZXMuZ2V0KGNoaWxkKVxuICAgIGlmIChzdGF0ZSkgc3RhdGUubGFzdE1lbW9yeU9ic2VydmF0aW9uID0gbWVzc2FnZVxuXG4gICAgY29uc3QgaGVhcCA9IG1lc3NhZ2UuaGVhcFN0YXRpc3RpY3NcbiAgICBjb25zb2xlLmVycm9yKFxuICAgICAgSlNPTi5zdHJpbmdpZnkoe1xuICAgICAgICBldmVudDogXCJwb29sZWQtY2hpbGQtbWVtb3J5XCIsXG4gICAgICAgIGNoaWxkSW5zdGFuY2VJZDogc3RhdGU/LmNoaWxkSW5zdGFuY2VJZCA/PyBtZXNzYWdlLmNoaWxkSW5zdGFuY2VJZCxcbiAgICAgICAgY2hpbGRQaWQ6IG1lc3NhZ2UuY2hpbGRQaWQsXG4gICAgICAgIGNoaWxkVXB0aW1lUzogTWF0aC5yb3VuZChtZXNzYWdlLmNoaWxkVXB0aW1lTXMgLyAxMDAwKSxcbiAgICAgICAgcnNzTWI6IE1hdGgucm91bmQobWVzc2FnZS5yc3NCeXRlcyAvICgxMDI0ICogMTAyNCkpLFxuICAgICAgICBwZWFrUnNzTWI6IE1hdGgucm91bmQoKHR5cGVvZiBtZXNzYWdlLnBlYWtSc3NCeXRlcyA9PT0gXCJudW1iZXJcIiA/IG1lc3NhZ2UucGVha1Jzc0J5dGVzIDogbWVzc2FnZS5yc3NCeXRlcykgLyAoMTAyNCAqIDEwMjQpKSxcbiAgICAgICAgaGVhcFVzZWRNYjogTWF0aC5yb3VuZChoZWFwLnVzZWRfaGVhcF9zaXplIC8gKDEwMjQgKiAxMDI0KSksXG4gICAgICAgIGhlYXBUb3RhbE1iOiBNYXRoLnJvdW5kKGhlYXAudG90YWxfaGVhcF9zaXplIC8gKDEwMjQgKiAxMDI0KSksXG4gICAgICAgIGhlYXBMaW1pdE1iOiBNYXRoLnJvdW5kKGhlYXAuaGVhcF9zaXplX2xpbWl0IC8gKDEwMjQgKiAxMDI0KSksXG4gICAgICAgIGV4dGVybmFsTWI6IE1hdGgucm91bmQobWVzc2FnZS5tZW1vcnlVc2FnZS5leHRlcm5hbCAvICgxMDI0ICogMTAyNCkpLFxuICAgICAgICBhcnJheUJ1ZmZlcnNNYjogTWF0aC5yb3VuZChtZXNzYWdlLm1lbW9yeVVzYWdlLmFycmF5QnVmZmVycyAvICgxMDI0ICogMTAyNCkpLFxuICAgICAgICBqb2JzOiBtZXNzYWdlLmpvYkNvdW50LFxuICAgICAgICBhY3RpdmVKb2JJZHM6IG1lc3NhZ2UuYWN0aXZlSm9iSWRzXG4gICAgICB9KVxuICAgIClcblxuICAgIGlmICh0aGlzLm9uUG9vbGVkUnVubmVyTWVtb3J5T2JzZXJ2YXRpb24pIHtcbiAgICAgIHRyeSB7XG4gICAgICAgIGNvbnN0IHJlc3VsdCA9IHRoaXMub25Qb29sZWRSdW5uZXJNZW1vcnlPYnNlcnZhdGlvbihtZXNzYWdlKVxuICAgICAgICBpZiAocmVzdWx0ICYmIHR5cGVvZiByZXN1bHQuY2F0Y2ggPT09IFwiZnVuY3Rpb25cIikgcmVzdWx0LmNhdGNoKChlcnJvcikgPT4ge1xuICAgICAgICAgIGNvbnNvbGUuZXJyb3IoXCJQb29sZWQgcnVubmVyIG1lbW9yeSBvYnNlcnZhdGlvbiBob29rIGZhaWxlZDpcIiwgZXJyb3IpXG4gICAgICAgIH0pXG4gICAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgICBjb25zb2xlLmVycm9yKFwiUG9vbGVkIHJ1bm5lciBtZW1vcnkgb2JzZXJ2YXRpb24gaG9vayBmYWlsZWQ6XCIsIGVycm9yKVxuICAgICAgfVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBSZXF1ZXN0cyBhbiBpbW1lZGlhdGUgbWVtb3J5IG9ic2VydmF0aW9uIGZyb20gb25lIHBvb2xlZCBjaGlsZC4gVGhlIGNoaWxkXG4gICAqIHJlcGxpZXMgb3ZlciBJUEMgd2l0aCBpdHMgY3VycmVudCBzbmFwc2hvdCAodGhlIHNhbWUgc2hhcGUgYXMgdGhlIHBlcmlvZGljXG4gICAqIHNhbXBsZXIpLCB3aGljaCB0aGUgd29ya2VyIHJlY29yZHMsIGxvZ3MsIGFuZCBmb3J3YXJkcyB0byB0aGVcbiAgICogYG9uUG9vbGVkUnVubmVyTWVtb3J5T2JzZXJ2YXRpb25gIGhvb2suIFVzZSB0aGlzIHRvIHB1bGwgYSBzbmFwc2hvdCBvblxuICAgKiBzdXNwaWNpb24gKGUuZy4gYWZ0ZXIgYW4gT09NIHJlcG9ydCkgd2l0aG91dCB3YWl0aW5nIGZvciB0aGUgbmV4dCBwZXJpb2RpY1xuICAgKiBzYW1wbGUuIEEgbm8tb3Agd2hlbiB0aGUgY2hpbGQgaXMgZ29uZSBvciBpdHMgSVBDIGNoYW5uZWwgaXMgY2xvc2VkLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIm5vZGU6Y2hpbGRfcHJvY2Vzc1wiKS5DaGlsZFByb2Nlc3N9IGNoaWxkIC0gUG9vbGVkIGNoaWxkIHRvIHNhbXBsZS5cbiAgICogQHJldHVybnMge3ZvaWR9XG4gICAqL1xuICByZXF1ZXN0UG9vbGVkQ2hpbGRNZW1vcnlPYnNlcnZhdGlvbihjaGlsZCkge1xuICAgIGlmICghY2hpbGQuY29ubmVjdGVkKSByZXR1cm5cblxuICAgIHRyeSB7XG4gICAgICBjaGlsZC5zZW5kKHt0eXBlOiBcIm1lbW9yeS1vYnNlcnZhdGlvbi1yZXF1ZXN0XCJ9KVxuICAgIH0gY2F0Y2gge1xuICAgICAgLy8gVGhlIElQQyBjaGFubmVsIGlzIGFscmVhZHkgZ29uZTsgdGhlIGRpc2Nvbm5lY3QvZXhpdCBoYW5kbGVyIG93bnMgdGVhcmRvd24uXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIE1hcmtzIGEgcG9vbGVkIGNoaWxkIGZvciByZXRpcmVtZW50IGFuZCDigJQgd2hlbiB0aGUgcG9vbCBpcyBiZWxvdyBpdHMgaGFyZFxuICAgKiBjYXAg4oCUIGVhZ2VybHkgc3Bhd25zIGEgc2luZ2xlIHJlcGxhY2VtZW50ICgxLWZvci0xKSBzbyBpdHMgY2FwYWNpdHkgaXNcbiAgICogcmVzdG9yZWQgaW1tZWRpYXRlbHkgd2l0aG91dCB3YWl0aW5nIGZvciBpdCB0byBmaW5pc2ggZHJhaW5pbmcsIGFuZFxuICAgKiByZS1hZHZlcnRpc2VzIHRoYXQgY2FwYWNpdHkgc28gZGlzcGF0Y2ggY2FuIHJlc3VtZSBhdCBvbmNlLiBUaGVcbiAgICogcmVwbGFjZW1lbnQgc3Bhd24gaXMgZ2F0ZWQgYnkgdGhlIGNhcCAodGhlIHJldGlyaW5nIGNoaWxkIHN0aWxsIGNvdW50cyBhc1xuICAgKiBsaXZlIHVudGlsIGl0IGV4aXRzKSwgc28gYSBmdWxsIHBvb2wgZGVmZXJzIHRoZSByZXBsYWNlbWVudCB0byB0aGUgZHJhaW5cbiAgICogcGF0aCDigJQgd2hlcmUgYSBjaGlsZCBleGl0IHJlc3RvcmVzIGEgd29ya2luZyBjaGlsZCB0aHJvdWdoIHRoZSBzYW1lXG4gICAqIGJvdW5kZWQgbGl2ZW5lc3MgcmVwbGFjZW1lbnQgKHNlZSBgX2Vuc3VyZU5vblJldGlyaW5nQ2hpbGRgKS4gV2l0aG91dCBpdCxcbiAgICogYSBmdWxsIHJldGlyZW1lbnQgd2F2ZSAoZS5nLiBldmVyeSBjaGlsZCBjcm9zc2luZyB0aGUgcGVhay1SU1MgdGhyZXNob2xkXG4gICAqIGFmdGVyIHRoZSBzYW1lIG1lbW9yeSBidXJzdCkgc2lsZW50bHkgcmVtb3ZlcyBhbGwgcG9vbGVkIGNhcGFjaXR5IGZvciB0aGVcbiAgICogd2hvbGUgZHJhaW4gd2luZG93LCB3aGljaCBjYW4gc3RyZXRjaCB0byB0aGUgbG9uZ2VzdCBpbi1mbGlnaHQgam9iLiBUaGVcbiAgICogcmV0aXJpbmcgY2hpbGQgc3RvcHMgcmVjZWl2aW5nIG5ldyBqb2JzIGFuZCBpcyB0ZXJtaW5hdGVkIG9ubHkgb25jZSBpdHNcbiAgICogaW4tZmxpZ2h0IHNldCBkcmFpbnMsIHNvIGEgbG9uZy1ydW5uaW5nIGpvYiAoZS5nLiBhIGJ1aWxkKSBpcyBuZXZlciBjdXRcbiAgICogb2ZmLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIm5vZGU6Y2hpbGRfcHJvY2Vzc1wiKS5DaGlsZFByb2Nlc3N9IGNoaWxkIC0gQ2hpbGQgdG8gcmV0aXJlLlxuICAgKiBAcmV0dXJucyB7dm9pZH1cbiAgICovXG4gIF9iZWdpblJldGlyZVBvb2xlZENoaWxkKGNoaWxkKSB7XG4gICAgY29uc3Qgc3RhdGUgPSB0aGlzLnBvb2xlZENoaWxkU3RhdGVzLmdldChjaGlsZClcbiAgICBpZiAoIXN0YXRlIHx8IHN0YXRlLnJldGlyaW5nKSByZXR1cm5cblxuICAgIHN0YXRlLnJldGlyaW5nID0gdHJ1ZVxuICAgIC8vIEJlc3QtZWZmb3J0IHByZS13YXJtOiBza2lwIHdoZW4gc3RvcHBpbmcgKG5vIG5ldyB3b3JrKSBvciBiZWZvcmUgdGhlXG4gICAgLy8gd29ya2VyIGlzIGluaXRpYWxpemVkIChubyBjb25maWd1cmF0aW9uIHRvIGZvcmsgYSBjaGlsZCBmcm9tKS4gVGhlIGNhcFxuICAgIC8vIGluc2lkZSBfY3JlYXRlUG9vbGVkQ2hpbGQgcmVmdXNlcyB0aGUgc3Bhd24gd2hpbGUgdGhlIHBvb2wgaXMgZnVsbCwgaW5cbiAgICAvLyB3aGljaCBjYXNlIHRoZSBib3VuZGVkIGxpdmVuZXNzIHJlcGxhY2VtZW50IGJlbG93IHRha2VzIG92ZXIuXG4gICAgaWYgKHRoaXMuc2hvdWxkU3RvcCB8fCAhdGhpcy5jb25maWd1cmF0aW9uKSByZXR1cm5cblxuICAgIGlmICh0aGlzLl9jcmVhdGVQb29sZWRDaGlsZCgpKSB7XG4gICAgICAvLyBGcmVzaCBjYXBhY2l0eSBleGlzdHM6IHJlLWFkdmVydGlzZSBzbyB0aGUgbWFpbiBjYW4gZGlzcGF0Y2ggaW50byBpdFxuICAgICAgLy8gd2l0aG91dCB3YWl0aW5nIGZvciB0aGUgbmV4dCBqb2Igb3V0Y29tZS5cbiAgICAgIHRoaXMuX3NlbmRSZWFkeUlmUnVubmluZygpXG4gICAgICByZXR1cm5cbiAgICB9XG4gICAgaWYgKHRoaXMuX25vblJldGlyaW5nUG9vbGVkQ2hpbGRDb3VudCgpID4gMCkgcmV0dXJuXG5cbiAgICAvLyBMaXZlbmVzcyByZXBsYWNlbWVudDogdGhpcyBtYXJrIGVtcHRpZWQgdGhlIHdvcmtpbmcgcG9vbC4gUmUtYWR2ZXJ0aXNlXG4gICAgLy8gdGhlIHJlc3RvcmVkIGNhcGFjaXR5IGltbWVkaWF0ZWx5IGFmdGVyIHRoZSBib3VuZGVkIG92ZXItY2FwIHNwYXduLlxuICAgIGlmICh0aGlzLl9lbnN1cmVOb25SZXRpcmluZ0NoaWxkKCkpIHRoaXMuX3NlbmRSZWFkeUlmUnVubmluZygpXG4gIH1cblxuICAvKipcbiAgICogS2VlcHMg4oCUIG9yIHJlc3RvcmVzIOKAlCBhdCBsZWFzdCBvbmUgbm9uLXJldGlyaW5nIHBvb2xlZCBjaGlsZCB0aHJvdWdoIHRoZVxuICAgKiBib3VuZGVkIG92ZXItY2FwIGxpdmVuZXNzIHJlcGxhY2VtZW50LCB1c2VkIGJ5IGJvdGggdGhlIHJldGlyZW1lbnQgbWFya1xuICAgKiAoYF9iZWdpblJldGlyZVBvb2xlZENoaWxkYCkgYW5kIHRoZSBjaGlsZC1leGl0IHBhdGhcbiAgICogKGBfaGFuZGxlUG9vbGVkQ2hpbGRGYWlsdXJlYCk6IGFkdmVydGlzZWQgY2FwYWNpdHkgaXMgemVybyB3aGlsZSBldmVyeVxuICAgKiBsaXZlIGNoaWxkIGlzIHJldGlyaW5nLCBhbmQgb25jZSB0aGV5IGFyZSBhbGwgcmV0aXJpbmcgbm8gZnVydGhlclxuICAgKiByZXRpcmVtZW50IG1hcmsgcmVtYWlucyB0byByZXN0b3JlIGEgd29ya2luZyBjaGlsZCDigJQgbm9yIGNhbiBhIGxhenlcbiAgICogcmVwbGFjZW1lbnQgc3Bhd24gd2hpbGUgdGhlIHBvb2wgY291bnRzIGF0IGl0cyBjYXAg4oCUIHNvIGRpc3BhdGNoIHdvdWxkXG4gICAqIHN0YWxsIGNsdXN0ZXItd2lkZSB1bnRpbCB0aGUgbmV4dCBkcmFpbmluZyBleGl0LCB1cCB0byB0aGUgbG9uZ2VzdFxuICAgKiBpbi1mbGlnaHQgam9iIChlLmcuIGEgbXVsdGktbWludXRlIGJ1aWxkKS4gU3Bhd25zIG9uZSByZXBsYWNlbWVudCBvdmVyIHRoZVxuICAgKiBoYXJkIGNhcCAoYm91bmRlZDogdGhlIGdhdGUgYWRtaXRzIGl0IG9ubHkgd2hlbiB0aGUgbGl2ZSBjb3VudCBpcyBhdCBtb3N0XG4gICAqIHRoZSBjYXAsIHNvIGF0IG1vc3Qgb25lIG92ZXItY2FwIGNoaWxkIGV4aXN0cyBhbmQgdGhlIG5leHQgZHJhaW5pbmcgZXhpdFxuICAgKiBhYnNvcmJzIGl0KS4gV2hlbiBldmVuIHRoYXQgc3Bhd24gaXMgdW5hdmFpbGFibGUgKGFuIG92ZXItY2FwIGNoaWxkIGlzXG4gICAqIGFscmVhZHkgZHJhaW5pbmcpLCB0aGUgYm91bmRlZCBzdGFydmF0aW9uIGlzIGxvZ2dlZCBzbyBpdCBpcyB2aXNpYmxlXG4gICAqIGluc3RlYWQgb2Ygc2lsZW50LlxuICAgKiBAcmV0dXJucyB7Ym9vbGVhbn0gLSBUcnVlIHdoZW4gYSByZXBsYWNlbWVudCBjaGlsZCB3YXMgc3Bhd25lZC5cbiAgICovXG4gIF9lbnN1cmVOb25SZXRpcmluZ0NoaWxkKCkge1xuICAgIGlmICh0aGlzLnNob3VsZFN0b3AgfHwgIXRoaXMuY29uZmlndXJhdGlvbikgcmV0dXJuIGZhbHNlXG4gICAgaWYgKHRoaXMuX25vblJldGlyaW5nUG9vbGVkQ2hpbGRDb3VudCgpID4gMCkgcmV0dXJuIGZhbHNlXG5cbiAgICBpZiAodGhpcy5wb29sZWRDaGlsZHJlbi5zaXplIDw9IHRoaXMucG9vbGVkUnVubmVyQ291bnQpIHtcbiAgICAgIGNvbnN0IGxpdmVuZXNzQ2hpbGQgPSB0aGlzLl9jcmVhdGVQb29sZWRDaGlsZCh7YWxsb3dPdmVyQ2FwOiB0cnVlfSlcblxuICAgICAgaWYgKGxpdmVuZXNzQ2hpbGQpIHtcbiAgICAgICAgdGhpcy5fbG9nUG9vbGVkQ2FwYWNpdHlFdmVudChcInBvb2xlZC1jYXBhY2l0eS1saXZlbmVzcy1zcGF3blwiKVxuICAgICAgICByZXR1cm4gdHJ1ZVxuICAgICAgfVxuICAgIH1cblxuICAgIC8vIEFuIG92ZXItY2FwIGNoaWxkIGlzIGFscmVhZHkgZHJhaW5pbmc6IHRoZSBwb29sIHdhaXRzIGZvciB0aGUgbmV4dFxuICAgIC8vIGRyYWluaW5nIGV4aXQsIHdoaWNoIGZyZWVzIGEgY2FwIHNsb3QgZm9yIGEgbGF6eSByZXBsYWNlbWVudCDigJQgYW5kIHRoYXRcbiAgICAvLyBleGl0IHJlc3RvcmVzIGEgd29ya2luZyBjaGlsZCB0aHJvdWdoIHRoaXMgc2FtZSBwYXRoLiBMb2cgaXQgc28gdGhpc1xuICAgIC8vIGJvdW5kZWQgc3RhcnZhdGlvbiBpcyBub3Qgc2lsZW50LlxuICAgIHRoaXMuX2xvZ1Bvb2xlZENhcGFjaXR5RXZlbnQoXCJwb29sZWQtY2FwYWNpdHktc3RhcnZlZFwiKVxuICAgIHJldHVybiBmYWxzZVxuICB9XG5cbiAgLyoqXG4gICAqIExvZ3Mgb25lIGNvbXBhY3QgcG9vbGVkLWNhcGFjaXR5IGV2ZW50IHRvIHRoZSB3b3JrZXIncyBvd24gc3RkZXJyICh0aGVcbiAgICogc3VyZmFjZSB0aGF0IHJlYWNoZXMgdGhlIHByb2R1Y3Rpb24gbG9nKS4gVXNlZCBieSB0aGUgYm91bmRlZCBsaXZlbmVzc1xuICAgKiByZXBsYWNlbWVudCBpbiBgX2Vuc3VyZU5vblJldGlyaW5nQ2hpbGRgOiB0aGUgc3Bhd24gdGhhdCBrZWVwcyBkaXNwYXRjaFxuICAgKiBhbGl2ZSB0aHJvdWdoIGEgZnVsbCByZXRpcmVtZW50IHdhdmUgKGF0IGEgcmV0aXJlbWVudCBtYXJrIG9yIGEgY2hpbGRcbiAgICogZXhpdCksIG9yIHRoZSBib3VuZGVkIHN0YXJ2YXRpb24gd2hlbiBhbiBvdmVyLWNhcCBjaGlsZCBpcyBhbHJlYWR5XG4gICAqIGRyYWluaW5nIGFuZCB0aGUgcG9vbCBtdXN0IHdhaXQgZm9yIGFuIGV4aXQuXG4gICAqIEBwYXJhbSB7XCJwb29sZWQtY2FwYWNpdHktbGl2ZW5lc3Mtc3Bhd25cIiB8IFwicG9vbGVkLWNhcGFjaXR5LXN0YXJ2ZWRcIn0gZXZlbnQgLSBFdmVudCBuYW1lLlxuICAgKiBAcmV0dXJucyB7dm9pZH1cbiAgICovXG4gIF9sb2dQb29sZWRDYXBhY2l0eUV2ZW50KGV2ZW50KSB7XG4gICAgbGV0IHJldGlyaW5nQ2hpbGRyZW4gPSAwXG5cbiAgICBmb3IgKGNvbnN0IHN0YXRlIG9mIHRoaXMucG9vbGVkQ2hpbGRTdGF0ZXMudmFsdWVzKCkpIHtcbiAgICAgIGlmIChzdGF0ZS5yZXRpcmluZykgcmV0aXJpbmdDaGlsZHJlbiArPSAxXG4gICAgfVxuXG4gICAgY29uc29sZS5lcnJvcihKU09OLnN0cmluZ2lmeSh7XG4gICAgICBldmVudCxcbiAgICAgIGxpdmVDaGlsZHJlbjogdGhpcy5wb29sZWRDaGlsZHJlbi5zaXplLFxuICAgICAgcmV0aXJpbmdDaGlsZHJlbixcbiAgICAgIGNhcDogdGhpcy5wb29sZWRSdW5uZXJDb3VudCxcbiAgICAgIGNvbmN1cnJlbmN5OiB0aGlzLnBvb2xlZFJ1bm5lckNvbmN1cnJlbmN5XG4gICAgfSkpXG4gIH1cblxuICAvKipcbiAgICogVGVybWluYXRlcyBhIHJldGlyaW5nIHBvb2xlZCBjaGlsZCBvbmNlIGl0IGhhcyBubyBpbi1mbGlnaHQgam9icyBsZWZ0LlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIm5vZGU6Y2hpbGRfcHJvY2Vzc1wiKS5DaGlsZFByb2Nlc3N9IGNoaWxkIC0gQ2hpbGQgdG8gY2hlY2suXG4gICAqIEByZXR1cm5zIHt2b2lkfVxuICAgKi9cbiAgX3Rlcm1pbmF0ZUlmRHJhaW5lZChjaGlsZCkge1xuICAgIGNvbnN0IHN0YXRlID0gdGhpcy5wb29sZWRDaGlsZFN0YXRlcy5nZXQoY2hpbGQpXG4gICAgaWYgKCFzdGF0ZSB8fCAhc3RhdGUucmV0aXJpbmcgfHwgc3RhdGUuaW5mbGlnaHQuc2l6ZSA+IDApIHJldHVyblxuXG4gICAgdGhpcy5fcmV0aXJlUG9vbGVkQ2hpbGQoY2hpbGQpXG4gIH1cblxuICAvKipcbiAgICogUmV0aXJlcyBhIGRyYWluZWQgcG9vbGVkIGNoaWxkIChyZW1vdmVzIGl0IGZyb20gdHJhY2tpbmcsIHRoZW4gU0lHVEVSTXMgaXQpLlxuICAgKiBCZWNhdXNlIHRoZSBoYXJkIGNhcCBjb3VudHMgbGl2ZSBjaGlsZHJlbiwgdGhlIGV4aXQgb2YgdGhpcyBjaGlsZCBmcmVlcyBhXG4gICAqIHNsb3Q6IGFueSBkZWZlcnJlZCByZXBsYWNlbWVudCAodGhlIHBvb2wgd2FzIGZ1bGwgd2hlbiB0aGUgY2hpbGQgcmV0aXJlZClcbiAgICogaXMgc3Bhd25lZCBub3csIGFuZCBjYXBhY2l0eSBpcyByZS1hZHZlcnRpc2VkIHNvIG1haW4gY2FuIGRpc3BhdGNoIGludG8gaXQuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwibm9kZTpjaGlsZF9wcm9jZXNzXCIpLkNoaWxkUHJvY2Vzc30gY2hpbGQgLSBDaGlsZCBwcm9jZXNzIHRvIHJldGlyZS5cbiAgICogQHJldHVybnMge3ZvaWR9XG4gICAqL1xuICBfcmV0aXJlUG9vbGVkQ2hpbGQoY2hpbGQpIHtcbiAgICBjb25zdCBzdGF0ZSA9IHRoaXMucG9vbGVkQ2hpbGRTdGF0ZXMuZ2V0KGNoaWxkKVxuICAgIGlmICghc3RhdGUpIHRocm93IG5ldyBFcnJvcihcIkNhbm5vdCByZXRpcmUgcG9vbGVkIGNoaWxkIHdpdGhvdXQgdHJhY2tlZCBzdGF0ZVwiKVxuICAgIGlmIChzdGF0ZS5pbmZsaWdodC5zaXplID4gMCkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKGBDYW5ub3QgcmV0aXJlIHBvb2xlZCBjaGlsZCB3aGlsZSAke3N0YXRlLmluZmxpZ2h0LnNpemV9ICR7c3RhdGUuaW5mbGlnaHQuc2l6ZSA9PT0gMSA/IFwiam9iIHJlbWFpbnNcIiA6IFwiam9icyByZW1haW5cIn0gaW4gZmxpZ2h0YClcbiAgICB9XG5cbiAgICB0aGlzLnBvb2xlZENoaWxkcmVuLmRlbGV0ZShjaGlsZClcbiAgICBzdGF0ZS5yZXRpcmluZyA9IHRydWVcbiAgICB0aGlzLl9yZXF1ZXN0UG9vbGVkQ2hpbGRTaHV0ZG93bih7Y2hpbGQsIHJlYXNvbjogXCJwYXJlbnRfcmV0aXJlX2RyYWluZWRcIiwgc2lnbmFsOiBcIlNJR1RFUk1cIiwgd2FpdEZvck9ic2VydmF0aW9uOiB0cnVlfSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSZWNvcmRzIGFuIGV4YWN0IHBhcmVudCByZXF1ZXN0IGJlZm9yZSBJUEMgb3Igc2lnbmFsIGRlbGl2ZXJ5LiBEcmFpbmVkXG4gICAqIHJldGlyZW1lbnQgZ2V0cyBhIGJyaWVmIElQQy1maXJzdCBncmFjZSBzbyBpdHMgemVyby1qb2Igb2JzZXJ2YXRpb24gaXNcbiAgICogZGV0ZXJtaW5pc3RpYzsgdGltZW91dC93b3JrZXItc3RvcCBwYXRocyBzaWduYWwgaW1tZWRpYXRlbHkuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gU2h1dGRvd24gcmVxdWVzdC5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCJub2RlOmNoaWxkX3Byb2Nlc3NcIikuQ2hpbGRQcm9jZXNzfSBhcmdzLmNoaWxkIC0gUG9vbGVkIGNoaWxkLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vdHlwZXMuanNcIikuUG9vbGVkQ2hpbGRTaHV0ZG93blJlYXNvbn0gYXJncy5yZWFzb24gLSBFeGFjdCBwYXJlbnQgcmVhc29uLlxuICAgKiBAcGFyYW0ge2tleW9mIHR5cGVvZiBpbXBvcnQoXCJub2RlOm9zXCIpLmNvbnN0YW50cy5zaWduYWxzfSBhcmdzLnNpZ25hbCAtIFNpZ25hbCB0byBkZWxpdmVyLlxuICAgKiBAcGFyYW0ge2Jvb2xlYW59IFthcmdzLndhaXRGb3JPYnNlcnZhdGlvbl0gLSBXaGV0aGVyIElQQyBvYnNlcnZhdGlvbiBtYXkgcHJlY2VkZSBzaWduYWwgZmFsbGJhY2suXG4gICAqIEByZXR1cm5zIHt2b2lkfVxuICAgKi9cbiAgX3JlcXVlc3RQb29sZWRDaGlsZFNodXRkb3duKHtjaGlsZCwgcmVhc29uLCBzaWduYWwsIHdhaXRGb3JPYnNlcnZhdGlvbiA9IGZhbHNlfSkge1xuICAgIGNvbnN0IHN0YXRlID0gdGhpcy5wb29sZWRDaGlsZFN0YXRlcy5nZXQoY2hpbGQpXG4gICAgaWYgKCFzdGF0ZSB8fCBzdGF0ZS5zZXR0bGluZyB8fCBzdGF0ZS5zaHV0ZG93blJlYXNvbikgcmV0dXJuXG5cbiAgICBjb25zdCBzaHV0ZG93blJlcXVlc3RlZEF0TXMgPSBEYXRlLm5vdygpXG4gICAgc3RhdGUuc2h1dGRvd25SZWFzb24gPSByZWFzb25cbiAgICBzdGF0ZS5zaHV0ZG93blJlcXVlc3RlZEF0TXMgPSBzaHV0ZG93blJlcXVlc3RlZEF0TXNcbiAgICBzdGF0ZS5zaHV0ZG93blNpZ25hbCA9IHNpZ25hbFxuXG4gICAgbGV0IHJlcXVlc3RTZW50ID0gZmFsc2VcbiAgICBpZiAoY2hpbGQuY29ubmVjdGVkKSB7XG4gICAgICB0cnkge1xuICAgICAgICBjaGlsZC5zZW5kKHt0eXBlOiBcInNodXRkb3duLXJlcXVlc3RcIiwgcmVhc29uLCBzaHV0ZG93blJlcXVlc3RlZEF0TXMsIHNpZ25hbH0sIChlcnJvcikgPT4ge1xuICAgICAgICAgIGlmICghZXJyb3IgfHwgIXdhaXRGb3JPYnNlcnZhdGlvbiB8fCBzdGF0ZS5zZXR0bGluZykgcmV0dXJuXG5cbiAgICAgICAgICBpZiAoc3RhdGUuc2h1dGRvd25TaWduYWxUaW1lcikge1xuICAgICAgICAgICAgY2xlYXJUaW1lb3V0KHN0YXRlLnNodXRkb3duU2lnbmFsVGltZXIpXG4gICAgICAgICAgICBzdGF0ZS5zaHV0ZG93blNpZ25hbFRpbWVyID0gdW5kZWZpbmVkXG4gICAgICAgICAgfVxuICAgICAgICAgIHRoaXMuX3NpZ25hbFBvb2xlZENoaWxkKHtjaGlsZCwgc2lnbmFsfSlcbiAgICAgICAgfSlcbiAgICAgICAgcmVxdWVzdFNlbnQgPSB0cnVlXG4gICAgICB9IGNhdGNoIHtcbiAgICAgICAgLy8gVGhlIHNpZ25hbCBiZWxvdyByZW1haW5zIHRoZSBib3VuZGVkIHNodXRkb3duIG1lY2hhbmlzbS5cbiAgICAgIH1cbiAgICB9XG5cbiAgICBpZiAod2FpdEZvck9ic2VydmF0aW9uICYmIHJlcXVlc3RTZW50KSB7XG4gICAgICBzdGF0ZS5zaHV0ZG93blNpZ25hbFRpbWVyID0gc2V0VGltZW91dCgoKSA9PiB7XG4gICAgICAgIHN0YXRlLnNodXRkb3duU2lnbmFsVGltZXIgPSB1bmRlZmluZWRcbiAgICAgICAgdGhpcy5fc2lnbmFsUG9vbGVkQ2hpbGQoe2NoaWxkLCBzaWduYWx9KVxuICAgICAgfSwgUE9PTEVEX1JVTk5FUl9TSFVURE9XTl9SRVFVRVNUX0dSQUNFX01TKVxuICAgICAgc3RhdGUuc2h1dGRvd25TaWduYWxUaW1lci51bnJlZigpXG4gICAgICByZXR1cm5cbiAgICB9XG5cbiAgICB0aGlzLl9zaWduYWxQb29sZWRDaGlsZCh7Y2hpbGQsIHNpZ25hbH0pXG4gIH1cblxuICAvKipcbiAgICogRGVsaXZlcnMgb25lIHBhcmVudC1vd25lZCBwcm9jZXNzIHNpZ25hbCB3aXRob3V0IGNoYW5naW5nIHJlY29yZGVkIHByb3ZlbmFuY2UuXG4gICAqIEBwYXJhbSB7e2NoaWxkOiBpbXBvcnQoXCJub2RlOmNoaWxkX3Byb2Nlc3NcIikuQ2hpbGRQcm9jZXNzLCBzaWduYWw6IGtleW9mIHR5cGVvZiBpbXBvcnQoXCJub2RlOm9zXCIpLmNvbnN0YW50cy5zaWduYWxzfX0gYXJncyAtIFNpZ25hbCByZXF1ZXN0LlxuICAgKiBAcmV0dXJucyB7dm9pZH1cbiAgICovXG4gIF9zaWduYWxQb29sZWRDaGlsZCh7Y2hpbGQsIHNpZ25hbH0pIHtcbiAgICB0cnkge1xuICAgICAgY2hpbGQua2lsbChzaWduYWwpXG4gICAgfSBjYXRjaCB7XG4gICAgICAvLyBDaGlsZCBhbHJlYWR5IGV4aXRlZDsgaXRzIGV4aXQvZXJyb3IgaGFuZGxlciBvd25zIHN0YXRlIHNldHRsZW1lbnQuXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIFJlbW92ZXMgYW4gZXhpdGVkL3VuaGVhbHRoeSBwb29sZWQgY2hpbGQgYW5kIHJlcG9ydHMgZXZlcnkgam9iIHRoYXQgd2FzXG4gICAqIGluLWZsaWdodCBvbiBpdCBhcyBmYWlsZWQg4oCUIGEgcHJvY2Vzcy1sZXZlbCBjcmFzaCdzIGJsYXN0IHJhZGl1cyBpcyB0aGVcbiAgICogY2hpbGQncyB3aG9sZSBpbi1mbGlnaHQgc2V0LiBPbmNlIHRoZSBjaGlsZCBoYXMgY29tcGxldGVkIHN0YXJ0dXAsIGl0c1xuICAgKiBmcmVlZCBjYXBhY2l0eSBpcyBhZHZlcnRpc2VkIGltbWVkaWF0ZWx5OyB0aGUgcmVwbGFjZW1lbnQgaXRzZWxmIGlzIHN0aWxsXG4gICAqIHNwYXduZWQgbGF6aWx5IGJ5IHRoZSBuZXh0IGRpc3BhdGNoLiBBIGNoaWxkIHRoYXQgZXhpdHMgYmVmb3JlIGl0cyBzdGFydHVwXG4gICAqIGhhbmRzaGFrZSBkb2VzIG5vdCByZS1hbm5vdW5jZSwgYXZvaWRpbmcgYSB0aWdodCByZXNwYXduIGxvb3Agb24gc3RhcnR1cFxuICAgKiBmYWlsdXJlLlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIEZhaWx1cmUgZGV0YWlscy5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCJub2RlOmNoaWxkX3Byb2Nlc3NcIikuQ2hpbGRQcm9jZXNzfSBhcmdzLmNoaWxkIC0gUG9vbGVkIGNoaWxkLlxuICAgKiBAcGFyYW0ge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSBhcmdzLmVycm9yIC0gRmFpbHVyZS5cbiAgICogQHBhcmFtIHtudW1iZXIgfCBudWxsfSBbYXJncy5leGl0Q29kZV0gLSBDaGlsZCBleGl0IGNvZGUgd2hlbiBvYnNlcnZlZC5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL3R5cGVzLmpzXCIpLlBvb2xlZFJ1bm5lckZhaWx1cmVPcmlnaW59IFthcmdzLm9yaWdpbl0gLSBXb3JrZXIgb2JzZXJ2YXRpb24gdGhhdCBpbml0aWF0ZWQgcmVjb3ZlcnkuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwibm9kZTpjaGlsZF9wcm9jZXNzXCIpLkNoaWxkUHJvY2Vzc1tcInNpZ25hbENvZGVcIl19IFthcmdzLnNpZ25hbF0gLSBDaGlsZCB0ZXJtaW5hdGlvbiBzaWduYWwgd2hlbiBvYnNlcnZlZC5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59XG4gICAqL1xuICBhc3luYyBfaGFuZGxlUG9vbGVkQ2hpbGRGYWlsdXJlKHtjaGlsZCwgZXJyb3IsIGV4aXRDb2RlID0gbnVsbCwgb3JpZ2luID0gXCJwcm9jZXNzLWVycm9yXCIsIHNpZ25hbCA9IG51bGx9KSB7XG4gICAgY29uc3Qgc3RhdGUgPSB0aGlzLnBvb2xlZENoaWxkU3RhdGVzLmdldChjaGlsZClcbiAgICBpZiAoc3RhdGU/LnNldHRsaW5nKSByZXR1cm5cbiAgICBpZiAoc3RhdGUpIHtcbiAgICAgIHN0YXRlLnNldHRsaW5nID0gdHJ1ZVxuICAgICAgLy8gQ2FuY2VsIHRoaXMgY2hpbGQncyBwZW5kaW5nIHRpbWVycyBiZWZvcmUgaXRzIGluLWZsaWdodCBzZXQgaXMgcmVwb3J0ZWQg4oCUXG4gICAgICAvLyB0aGUgU0lHS0lMTCBncmFjZSBmcm9tIGEgdGltZW91dCBraWxsLCBhbmQgZXZlcnkgYXJtZWQgcGVyLWpvYiBiYWNrc3RvcC5cbiAgICAgIGlmIChzdGF0ZS50aW1lb3V0U2lna2lsbFRpbWVyKSBjbGVhclRpbWVvdXQoc3RhdGUudGltZW91dFNpZ2tpbGxUaW1lcilcbiAgICAgIGlmIChzdGF0ZS5zaHV0ZG93blNpZ25hbFRpbWVyKSBjbGVhclRpbWVvdXQoc3RhdGUuc2h1dGRvd25TaWduYWxUaW1lcilcbiAgICAgIGZvciAoY29uc3QgaW5mbGlnaHRFbnRyeSBvZiBzdGF0ZS5pbmZsaWdodC52YWx1ZXMoKSkge1xuICAgICAgICBpZiAoaW5mbGlnaHRFbnRyeS50aW1lb3V0VGltZXIpIGNsZWFyVGltZW91dChpbmZsaWdodEVudHJ5LnRpbWVvdXRUaW1lcilcbiAgICAgIH1cbiAgICB9XG4gICAgdGhpcy5wb29sZWRDaGlsZHJlbi5kZWxldGUoY2hpbGQpXG4gICAgdGhpcy5pbmZsaWdodFByb2Nlc3NDaGlsZHJlbi5kZWxldGUoY2hpbGQpXG4gICAgLy8gQ2hpbGQgZXhpdCBmcmVlcyBhIGhhcmQtY2FwIHNsb3QgZXZlbiB3aGlsZSBpdHMgaW4tZmxpZ2h0IHNldCBpcyBzdGlsbFxuICAgIC8vIGJlaW5nIHJlcG9ydGVkIOKAlCB3YWtlIHdhaXRlcnMgbm93OyB0aGVpciByZXBvcnRzIHNldHRsZSBpbmRlcGVuZGVudGx5LlxuICAgIHRoaXMuX3dha2VQb29sZWRTbG90V2FpdGVycygpXG5cbiAgICBjb25zdCBlbnRyaWVzID0gc3RhdGUgPyBbLi4uc3RhdGUuaW5mbGlnaHQudmFsdWVzKCldIDogW11cbiAgICBjb25zdCBydW5uZXJGYWlsdXJlID0gc3RhdGVcbiAgICAgID8gdGhpcy5fcG9vbGVkUnVubmVyRmFpbHVyZSh7Y2hpbGQsIGV4aXRDb2RlLCBvcmlnaW4sIHNpZ25hbCwgc3RhdGV9KVxuICAgICAgOiB1bmRlZmluZWRcbiAgICBpZiAoc3RhdGUpIHN0YXRlLmluZmxpZ2h0LmNsZWFyKClcbiAgICB0aGlzLnBvb2xlZENoaWxkU3RhdGVzLmRlbGV0ZShjaGlsZClcblxuICAgIGNvbnN0IGZhaWx1cmVSZXBvcnRzID0gZW50cmllcy5tYXAoYXN5bmMgKGVudHJ5KSA9PiB7XG4gICAgICBhd2FpdCB0aGlzLl9yZXBvcnRKb2JSZXN1bHQoe1xuICAgICAgICBqb2JJZDogZW50cnkucGF5bG9hZC5pZCxcbiAgICAgICAgc3RhdHVzOiBcImZhaWxlZFwiLFxuICAgICAgICBlcnJvcixcbiAgICAgICAgaGFuZG9mZklkOiBlbnRyeS5wYXlsb2FkLmhhbmRvZmZJZCxcbiAgICAgICAgaGFuZGVkT2ZmQXRNczogZW50cnkucGF5bG9hZC5oYW5kZWRPZmZBdE1zLFxuICAgICAgICBydW5uZXJGYWlsdXJlLFxuICAgICAgICB3b3JrZXJJZDogZW50cnkucGF5bG9hZC53b3JrZXJJZCB8fCB0aGlzLndvcmtlcklkXG4gICAgICB9KVxuICAgICAgaWYgKGVudHJ5LnJlc29sdmUpIGVudHJ5LnJlc29sdmUodW5kZWZpbmVkKVxuICAgIH0pXG5cbiAgICAvLyBTdGFydCBldmVyeSBmYWxsYmFjayByZXBvcnQgYmVmb3JlIGFubm91bmNpbmcgY2FwYWNpdHkgc28gdGhlIG1haW4gY2Fubm90XG4gICAgLy8gb2JzZXJ2ZSBhIHJlcGxhY2VtZW50IHNsb3QgYmVmb3JlIHRoZSBmYWlsZWQgam9icycgcmVwb3J0cyBhcmUgaW4gZmxpZ2h0LlxuICAgIC8vIFRoZSByZXBvcnQgcHJvbWlzZXMgcmVtYWluIHRyYWNrZWQgYmVsb3c7IGEgc2xvdyByZXRyeSBtdXN0IG5vdCBob2xkIHRoZVxuICAgIC8vIG5ld2x5IGZyZWVkIHJ1bm5lciBjYXBhY2l0eSBob3N0YWdlLlxuICAgIC8vIEEgZHJhaW5lZCByZXRpcmVtZW50IGFscmVhZHkgYWR2ZXJ0aXNlZCBpdHMgcmVwbGFjZW1lbnQgY2FwYWNpdHkgd2hlblxuICAgIC8vIHRoZSBmaW5hbCBqb2IgY29tcGxldGVkLiBSZS1hZHZlcnRpc2luZyBoZXJlIGNhbiByZXN0b3JlIGEgY3JlZGl0IG1haW5cbiAgICAvLyBjb25zdW1lZCBiZWZvcmUgaXRzIGhhbmRvZmYgcmVhY2hlZCB0aGUgcmVwbGFjZW1lbnQgY2hpbGQuXG4gICAgaWYgKHN0YXRlPy5zaHV0ZG93blJlYXNvbiAhPT0gXCJwYXJlbnRfcmV0aXJlX2RyYWluZWRcIikge1xuICAgICAgaWYgKHN0YXRlICYmIHN0YXRlLnN0YXJ0ZWQgIT09IGZhbHNlKSB7XG4gICAgICAgIHRoaXMuX3NlbmRSZWFkeUlmUnVubmluZygpXG4gICAgICB9IGVsc2UgaWYgKHN0YXRlKSB7XG4gICAgICAgIGZvciAoY29uc3QgZW50cnkgb2YgZW50cmllcykge1xuICAgICAgICAgIGlmIChlbnRyeS5wb29sZWRKb2IpIHRoaXMuX3Bvb2xlZFN0YXJ0dXBGYWlsdXJlSm9icy5hZGQoZW50cnkucG9vbGVkSm9iKVxuICAgICAgICAgIGNvbnN0IHF1ZXVlVHJhY2tlciA9IHRoaXMucG9vbGVkSm9iUXVldWVUcmFja2Vycy5nZXQoZW50cnkucGF5bG9hZC5pZClcbiAgICAgICAgICBpZiAocXVldWVUcmFja2VyKSB0aGlzLl9wb29sZWRTdGFydHVwRmFpbHVyZUpvYnMuYWRkKHF1ZXVlVHJhY2tlcilcbiAgICAgICAgfVxuICAgICAgICAvLyBBIHByZXZpb3VzIHJlYWR5IG1lc3NhZ2UgbWF5IHN0aWxsIGhhdmUgdW5jb25zdW1lZCBwb29sZWQgY3JlZGl0cyBhdCB0aGVcbiAgICAgICAgLy8gbWFpbi4gUmV2b2tlIHRoZW0gYXV0aG9yaXRhdGl2ZWx5IHdpdGhvdXQgc3VwcHJlc3NpbmcgdmFsaWQgaW5saW5lIG9yXG4gICAgICAgIC8vIHByb2Nlc3MtcnVubmVyIHJlYWRpbmVzczsgb3RoZXJ3aXNlIHF1ZXVlZCBqb2JzIGNhbiB0cmlnZ2VyIGEgc3RhcnR1cFxuICAgICAgICAvLyBjcmFzaCBsb29wIHVzaW5nIHRoZSBzdGFsZSBjcmVkaXRzLlxuICAgICAgICB0aGlzLl9zZW5kUmVhZHlJZlJ1bm5pbmcoe3Jldm9rZVBvb2xlZEFkbWlzc2lvbjogdHJ1ZX0pXG4gICAgICB9XG4gICAgfVxuXG4gICAgLy8gQSBjaGlsZCBleGl0IGNhbiBhYnNvcmIgdGhlIGJvdW5kZWQgb3Zlci1jYXAgbGl2ZW5lc3MgcmVwbGFjZW1lbnQgd2hpbGVcbiAgICAvLyBldmVyeSByZW1haW5pbmcgbGl2ZSBjaGlsZCBpcyBzdGlsbCByZXRpcmluZyDigJQgZS5nLiB0aGUgcmVwbGFjZW1lbnRcbiAgICAvLyByZXRpcmVzIChvciBkaWVzKSBmaXJzdC4gTm8gcmV0aXJlbWVudCBtYXJrIHJlbWFpbnMgdG8gcmVzdG9yZSBhIHdvcmtpbmdcbiAgICAvLyBjaGlsZCwgYW5kIGF0IHRoZSBjYXAgbm90aGluZyBlbHNlIGNhbiBzcGF3biwgc28gYWR2ZXJ0aXNlZCBjYXBhY2l0eVxuICAgIC8vIHdvdWxkIHN0YXkgemVybyB1bnRpbCB0aGUgbmV4dCBkcmFpbmluZyBleGl0IOKAlCB1cCB0byB0aGUgbG9uZ2VzdFxuICAgIC8vIGluLWZsaWdodCBqb2Ig4oCUIHN0YXJ2aW5nIGRpc3BhdGNoIGNsdXN0ZXItd2lkZS4gUmVzdG9yZSBvbmUgd29ya2luZ1xuICAgIC8vIGNoaWxkIG5vdyAoc2FtZSBib3VuZDogYXQgbW9zdCBvbmUgb3Zlci1jYXAgY2hpbGQpIGFuZCByZS1hZHZlcnRpc2Ugc29cbiAgICAvLyBtYWluIGNhbiBkaXNwYXRjaCBpbnRvIGl0IGltbWVkaWF0ZWx5LlxuICAgIGlmIChzdGF0ZT8uc3RhcnRlZCAhPT0gZmFsc2UgJiYgdGhpcy5wb29sZWRDaGlsZHJlbi5zaXplID4gMCAmJiB0aGlzLl9lbnN1cmVOb25SZXRpcmluZ0NoaWxkKCkpIHtcbiAgICAgIHRoaXMuX3NlbmRSZWFkeUlmUnVubmluZygpXG4gICAgfVxuXG4gICAgYXdhaXQgUHJvbWlzZS5hbGxTZXR0bGVkKGZhaWx1cmVSZXBvcnRzKVxuICB9XG5cbiAgLyoqXG4gICAqIENhcHR1cmVzIG9uZSBzdGFibGUgcHJvY2VzcyBzbmFwc2hvdCBiZWZvcmUgdGhlIGZhaWxlZCBjaGlsZCdzIHN0YXRlIGlzIHJlbW92ZWQuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gRmFpbHVyZSBkZXRhaWxzLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIm5vZGU6Y2hpbGRfcHJvY2Vzc1wiKS5DaGlsZFByb2Nlc3N9IGFyZ3MuY2hpbGQgLSBGYWlsZWQgcG9vbGVkIGNoaWxkLlxuICAgKiBAcGFyYW0ge251bWJlciB8IG51bGx9IGFyZ3MuZXhpdENvZGUgLSBDaGlsZCBleGl0IGNvZGUgd2hlbiBvYnNlcnZlZC5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL3R5cGVzLmpzXCIpLlBvb2xlZFJ1bm5lckZhaWx1cmVPcmlnaW59IGFyZ3Mub3JpZ2luIC0gV29ya2VyIG9ic2VydmF0aW9uIHRoYXQgaW5pdGlhdGVkIHJlY292ZXJ5LlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIm5vZGU6Y2hpbGRfcHJvY2Vzc1wiKS5DaGlsZFByb2Nlc3NbXCJzaWduYWxDb2RlXCJdfSBhcmdzLnNpZ25hbCAtIENoaWxkIHRlcm1pbmF0aW9uIHNpZ25hbCB3aGVuIG9ic2VydmVkLlxuICAgKiBAcGFyYW0ge1Bvb2xlZENoaWxkU3RhdGV9IGFyZ3Muc3RhdGUgLSBDaGlsZCBzdGF0ZSBpbW1lZGlhdGVseSBiZWZvcmUgcmVjb3ZlcnkuXG4gICAqIEByZXR1cm5zIHtpbXBvcnQoXCIuL3R5cGVzLmpzXCIpLlBvb2xlZFJ1bm5lckZhaWx1cmV9IC0gU2hhcmVkIGZhaWx1cmUgcHJvdmVuYW5jZS5cbiAgICovXG4gIF9wb29sZWRSdW5uZXJGYWlsdXJlKHtjaGlsZCwgZXhpdENvZGUsIG9yaWdpbiwgc2lnbmFsLCBzdGF0ZX0pIHtcbiAgICBjb25zdCBvYnNlcnZhdGlvbiA9IHN0YXRlLnNodXRkb3duT2JzZXJ2YXRpb25cbiAgICBsZXQgc2h1dGRvd25SZWFzb24gPSBzdGF0ZS5zaHV0ZG93blJlYXNvbiA/PyBvYnNlcnZhdGlvbj8ucmVhc29uXG4gICAgaWYgKCFzaHV0ZG93blJlYXNvbikge1xuICAgICAgaWYgKG9yaWdpbiA9PT0gXCJwcm9jZXNzLWVycm9yXCIgfHwgb3JpZ2luID09PSBcImlwYy1zZW5kXCIpIHtcbiAgICAgICAgc2h1dGRvd25SZWFzb24gPSBcInByb2Nlc3NfZXJyb3JcIlxuICAgICAgfSBlbHNlIGlmIChzaWduYWwgPT09IFwiU0lHVEVSTVwiKSB7XG4gICAgICAgIHNodXRkb3duUmVhc29uID0gXCJzaWduYWxfc2lndGVybVwiXG4gICAgICB9IGVsc2UgaWYgKHNpZ25hbCA9PT0gXCJTSUdJTlRcIikge1xuICAgICAgICBzaHV0ZG93blJlYXNvbiA9IFwic2lnbmFsX3NpZ2ludFwiXG4gICAgICB9IGVsc2UgaWYgKHNpZ25hbCA9PT0gXCJTSUdLSUxMXCIpIHtcbiAgICAgICAgc2h1dGRvd25SZWFzb24gPSBcInNpZ25hbF9zaWdraWxsXCJcbiAgICAgIH0gZWxzZSBpZiAoc2lnbmFsKSB7XG4gICAgICAgIHNodXRkb3duUmVhc29uID0gXCJzaWduYWxfb3RoZXJcIlxuICAgICAgfSBlbHNlIGlmIChzdGF0ZS5pcGNEaXNjb25uZWN0ZWRBdE1zICYmIGV4aXRDb2RlID09PSAwKSB7XG4gICAgICAgIHNodXRkb3duUmVhc29uID0gXCJpcGNfZGlzY29ubmVjdFwiXG4gICAgICB9IGVsc2Uge1xuICAgICAgICBzaHV0ZG93blJlYXNvbiA9IFwidW5leHBlY3RlZF9leGl0XCJcbiAgICAgIH1cbiAgICB9XG4gICAgY29uc3QgdGVybWluYXRpb25SZWFzb24gPSBzaHV0ZG93blJlYXNvbiA9PT0gXCJqb2JfdGltZW91dFwiXG4gICAgICA/IFwiam9iLXRpbWVvdXRcIlxuICAgICAgOiBzaHV0ZG93blJlYXNvbiA9PT0gXCJ3b3JrZXJfc3RvcFwiID8gXCJ3b3JrZXItc2h1dGRvd24tdGltZW91dFwiIDogXCJ1bmV4cGVjdGVkXCJcbiAgICBjb25zdCB3b3JrZXJMaWZlY3ljbGUgPSB0aGlzLnNob3VsZFN0b3AgPyBcInN0b3BwaW5nXCIgOiB0aGlzLmlzUmV0aXJpbmcgPyBcInJldGlyaW5nXCIgOiBcInJ1bm5pbmdcIlxuICAgIGNvbnN0IHJ1bm5lckxpZmVjeWNsZSA9IHN0YXRlLnN0YXJ0ZWQgPT09IGZhbHNlID8gXCJzdGFydGluZ1wiIDogc3RhdGUucmV0aXJpbmcgPyBcInJldGlyaW5nXCIgOiBcInJ1bm5pbmdcIlxuICAgIGNvbnN0IGJvdW5kZWRJbmZsaWdodCA9IGJvdW5kZWRQb29sZWRSdW5uZXJJbmZsaWdodEpvYklkcyhzdGF0ZS5pbmZsaWdodC5rZXlzKCkpXG4gICAgY29uc3QgYWN0aXZlSm9icyA9IFsuLi5zdGF0ZS5pbmZsaWdodC52YWx1ZXMoKV1cbiAgICAgIC5tYXAoKGVudHJ5KSA9PiAoe1xuICAgICAgICBoYW5kb2ZmSWQ6IGVudHJ5LnBheWxvYWQuaGFuZG9mZklkID8/IG51bGwsXG4gICAgICAgIGhhbmRlZE9mZkF0TXM6IGVudHJ5LnBheWxvYWQuaGFuZGVkT2ZmQXRNcyA/PyBudWxsLFxuICAgICAgICBqb2JJZDogZW50cnkucGF5bG9hZC5pZCxcbiAgICAgICAgam9iTmFtZTogZW50cnkucGF5bG9hZC5qb2JOYW1lLFxuICAgICAgICB3b3JrZXJJZDogZW50cnkucGF5bG9hZC53b3JrZXJJZCA/PyB0aGlzLndvcmtlcklkXG4gICAgICB9KSlcbiAgICAgIC5zb3J0KChsZWZ0LCByaWdodCkgPT4gbGVmdC5qb2JJZC5sb2NhbGVDb21wYXJlKHJpZ2h0LmpvYklkKSlcblxuICAgIHJldHVybiBPYmplY3QuZnJlZXplKHtcbiAgICAgIGFjdGl2ZUpvYnMsXG4gICAgICBjaGlsZEluc3RhbmNlSWQ6IHN0YXRlLmNoaWxkSW5zdGFuY2VJZCA/PyBvYnNlcnZhdGlvbj8uY2hpbGRJbnN0YW5jZUlkID8/IG51bGwsXG4gICAgICBleGl0Q29kZSxcbiAgICAgIGdlbmVyYXRpb25JZDogdGhpcy5nZW5lcmF0aW9uSWQgPz8gbnVsbCxcbiAgICAgIC4uLmJvdW5kZWRJbmZsaWdodCxcbiAgICAgIG9vbUtpbGxlZDogc2lnbmFsID09PSBcIlNJR0tJTExcIiAmJiBzaHV0ZG93blJlYXNvbiA9PT0gXCJzaWduYWxfc2lna2lsbFwiID8gbnVsbCA6IGZhbHNlLFxuICAgICAgb3JpZ2luLFxuICAgICAgcnVubmVyQWdlTXM6IE1hdGgubWF4KDAsIERhdGUubm93KCkgLSBzdGF0ZS5jcmVhdGVkQXRNcyksXG4gICAgICBydW5uZXJDcmVhdGVkQXRNczogc3RhdGUuY3JlYXRlZEF0TXMsXG4gICAgICBydW5uZXJEZXRhY2hlZDogZmFsc2UsXG4gICAgICBydW5uZXJKb2JzUnVuOiBzdGF0ZS5qb2JzUnVuLFxuICAgICAgcnVubmVyTGlmZWN5Y2xlLFxuICAgICAgcnVubmVyUGlkOiBjaGlsZC5waWQgPz8gbnVsbCxcbiAgICAgIHNpZ25hbCxcbiAgICAgIHNodXRkb3duT2JzZXJ2ZWRBdE1zOiBvYnNlcnZhdGlvbj8uc2h1dGRvd25PYnNlcnZlZEF0TXMgPz8gc3RhdGUuaXBjRGlzY29ubmVjdGVkQXRNcyA/PyBudWxsLFxuICAgICAgc2h1dGRvd25SZXF1ZXN0ZWRBdE1zOiBzdGF0ZS5zaHV0ZG93blJlcXVlc3RlZEF0TXMgPz8gb2JzZXJ2YXRpb24/LnNodXRkb3duUmVxdWVzdGVkQXRNcyA/PyBudWxsLFxuICAgICAgc2h1dGRvd25SZWFzb24sXG4gICAgICBzaHV0ZG93blNpZ25hbDogc3RhdGUuc2h1dGRvd25TaWduYWwgPz8gb2JzZXJ2YXRpb24/LnNpZ25hbCA/PyBzaWduYWwsXG4gICAgICB0ZXJtaW5hdGlvblJlYXNvbixcbiAgICAgIHRpbWVvdXRKb2JJZDogc3RhdGUudGltZW91dEpvYklkID8/IG51bGwsXG4gICAgICB3b3JrZXJJZDogdGhpcy53b3JrZXJJZCxcbiAgICAgIHdvcmtlckxpZmVjeWNsZSxcbiAgICAgIHdvcmtlclBpZDogcHJvY2Vzcy5waWRcbiAgICB9KVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgcnVuIGpvYiBpbmxpbmUuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi90eXBlcy5qc1wiKS5CYWNrZ3JvdW5kSm9iUGF5bG9hZH0gcGF5bG9hZCAtIFBheWxvYWQuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIHdoZW4gZG9uZS5cbiAgICovXG4gIGFzeW5jIF9ydW5Kb2JJbmxpbmUocGF5bG9hZCkge1xuICAgIGNvbnN0IGNvbmZpZ3VyYXRpb24gPSB0aGlzLmNvbmZpZ3VyYXRpb25cbiAgICBpZiAoIWNvbmZpZ3VyYXRpb24pIHRocm93IG5ldyBFcnJvcihcIkJhY2tncm91bmQgam9icyB3b3JrZXIgY29uZmlndXJhdGlvbiBub3QgaW5pdGlhbGl6ZWRcIilcblxuICAgIGNvbnN0IHJlZ2lzdHJ5ID0gbmV3IEJhY2tncm91bmRKb2JSZWdpc3RyeSh7Y29uZmlndXJhdGlvbn0pXG4gICAgYXdhaXQgcmVnaXN0cnkubG9hZCgpXG4gICAgY29uc3QgSm9iQ2xhc3MgPSByZWdpc3RyeS5nZXRKb2JCeU5hbWUocGF5bG9hZC5qb2JOYW1lKVxuICAgIGF3YWl0IHJ1bldpdGhCYWNrZ3JvdW5kSm9iUGF5bG9hZChwYXlsb2FkLCBhc3luYyAoKSA9PiB7XG4gICAgICBhd2FpdCBwZXJmb3JtQmFja2dyb3VuZEpvYih7XG4gICAgICAgIGNvbmZpZ3VyYXRpb24sXG4gICAgICAgIEpvYkNsYXNzLFxuICAgICAgICBqb2JBcmdzOiBwYXlsb2FkLmFyZ3MgfHwgW10sXG4gICAgICAgIGpvYk9wdGlvbnM6IHBheWxvYWQub3B0aW9ucyB8fCB7fSxcbiAgICAgICAgbmFtZTogYEJhY2tncm91bmQgam9iIHdvcmtlciBpbmxpbmU6ICR7cGF5bG9hZC5qb2JOYW1lfWAsXG4gICAgICAgIHBheWxvYWRcbiAgICAgIH0pXG4gICAgfSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGZvcmsgam9iLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vdHlwZXMuanNcIikuQmFja2dyb3VuZEpvYlBheWxvYWQgJiB7aWQ6IHN0cmluZ319IHBheWxvYWQgLSBQYXlsb2FkLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyB3aGVuIHRoZSBmb3JrZWQgcnVubmVyIGV4aXRzIG9yIGZvcmsgZmFpbHMuXG4gICAqL1xuICBfZm9ya0pvYihwYXlsb2FkKSB7XG4gICAgY29uc3QgY2hpbGQgPSB0aGlzLl9jcmVhdGVGb3JrZWRDaGlsZCgpXG5cbiAgICB0aGlzLmluZmxpZ2h0UHJvY2Vzc0NoaWxkcmVuLmFkZChjaGlsZClcblxuICAgIGNvbnN0IGZpbmlzaGVkID0gdGhpcy5fd2FpdEZvckZvcmtlZENoaWxkKHtjaGlsZCwgcGF5bG9hZH0pXG5cbiAgICB0aGlzLl9zZW5kRm9ya2VkUGF5bG9hZCh7Y2hpbGQsIHBheWxvYWR9KVxuXG4gICAgcmV0dXJuIGZpbmlzaGVkXG4gIH1cblxuICAvKipcbiAgICogUnVucyBjcmVhdGUgZm9ya2VkIGNoaWxkLlxuICAgKiBAcmV0dXJucyB7aW1wb3J0KFwibm9kZTpjaGlsZF9wcm9jZXNzXCIpLkNoaWxkUHJvY2Vzc30gLSBGb3JrZWQgY2hpbGQgcHJvY2Vzcy5cbiAgICovXG4gIF9jcmVhdGVGb3JrZWRDaGlsZCgpIHtcbiAgICBjb25zdCBjb25maWd1cmF0aW9uID0gdGhpcy5jb25maWd1cmF0aW9uXG4gICAgaWYgKCFjb25maWd1cmF0aW9uKSB0aHJvdyBuZXcgRXJyb3IoXCJCYWNrZ3JvdW5kIGpvYnMgd29ya2VyIGNvbmZpZ3VyYXRpb24gbm90IGluaXRpYWxpemVkXCIpXG5cbiAgICBjb25zdCBkaXJlY3RvcnkgPSBjb25maWd1cmF0aW9uLmdldERpcmVjdG9yeSgpXG4gICAgcmV0dXJuIGZvcmsoRk9SS0VEX1JVTk5FUl9FTlRSWV9QQVRILCBbXSwge1xuICAgICAgY3dkOiBkaXJlY3RvcnksXG4gICAgICBleGVjQXJndjogdGhpcy5fY2hpbGRSdW5uZXJFeGVjQXJndigpLFxuICAgICAgc3RkaW86IFtcImlnbm9yZVwiLCBcImlnbm9yZVwiLCBcImlnbm9yZVwiLCBcImlwY1wiXSxcbiAgICAgIGVudjogT2JqZWN0LmFzc2lnbih7fSwgcHJvY2Vzcy5lbnYsIHRoaXMuX2NoaWxkQmFja2dyb3VuZEpvYnNFbnZpcm9ubWVudCgpKVxuICAgIH0pXG4gIH1cblxuICAvKipcbiAgICogUnVucyB3YWl0IGZvciBmb3JrZWQgY2hpbGQuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gT3B0aW9ucy5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCJub2RlOmNoaWxkX3Byb2Nlc3NcIikuQ2hpbGRQcm9jZXNzfSBhcmdzLmNoaWxkIC0gRm9ya2VkIGNoaWxkIHByb2Nlc3MuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi90eXBlcy5qc1wiKS5CYWNrZ3JvdW5kSm9iUGF5bG9hZCAmIHtpZDogc3RyaW5nfX0gYXJncy5wYXlsb2FkIC0gUGF5bG9hZC5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgd2hlbiB0aGUgY2hpbGQgZXhpdHMuXG4gICAqL1xuICBfd2FpdEZvckZvcmtlZENoaWxkKHtjaGlsZCwgcGF5bG9hZH0pIHtcbiAgICBjb25zdCB0aW1lb3V0U3RhdGUgPSB0aGlzLl9hcm1Gb3JrZWRKb2JUaW1lb3V0KHtjaGlsZCwgcGF5bG9hZH0pXG5cbiAgICByZXR1cm4gbmV3IFByb21pc2UoKHJlc29sdmUpID0+IHtcbiAgICAgIGNoaWxkLm9uY2UoXCJleGl0XCIsIChjb2RlLCBzaWduYWwpID0+IHtcbiAgICAgICAgdGhpcy5fY2xlYXJGb3JrZWRKb2JUaW1lb3V0KHRpbWVvdXRTdGF0ZSlcbiAgICAgICAgdGhpcy5faGFuZGxlRm9ya2VkQ2hpbGRFeGl0KHtjaGlsZCwgY29kZSwgc2lnbmFsLCBwYXlsb2FkLCByZXNvbHZlLCB0aW1lb3V0U3RhdGV9KVxuICAgICAgfSlcbiAgICAgIGNoaWxkLm9uY2UoXCJlcnJvclwiLCAoZXJyb3IpID0+IHtcbiAgICAgICAgdGhpcy5fY2xlYXJGb3JrZWRKb2JUaW1lb3V0KHRpbWVvdXRTdGF0ZSlcbiAgICAgICAgdGhpcy5faGFuZGxlRm9ya2VkQ2hpbGRFcnJvcih7Y2hpbGQsIGVycm9yLCBwYXlsb2FkLCByZXNvbHZlfSlcbiAgICAgIH0pXG4gICAgfSlcbiAgfVxuXG4gIC8qKlxuICAgKiBBcm1zIGEgd2FsbC1jbG9jayBiYWNrc3RvcCBmb3IgYSBmb3JrZWQgam9iIHJ1bm5lci4gQSBmb3JrZWQgam9iIHN0aWxsXG4gICAqIHJ1bm5pbmcgYWZ0ZXIgYGpvYlRpbWVvdXRNc2AgaXMgdGVybWluYXRlZCAoU0lHVEVSTSwgdGhlbiBTSUdLSUxMIGFmdGVyIHRoZVxuICAgKiBncmFjZSkgc28gYSBzaW5nbGUgZ2VudWluZWx5LWh1bmcgcnVubmVyIGNhbid0IHBpbiBhIGRyYWluaW5nIHdvcmtlciDigJQgYW5kXG4gICAqIGl0cyBmdWxsLWFwcCBib290IGFuZCBkYXRhYmFzZSBjb25uZWN0aW9ucyDigJQgaW5kZWZpbml0ZWx5LiBSZXR1cm5zIGEgc3RhdGVcbiAgICogb2JqZWN0IHRoZSBleGl0L2Vycm9yIGhhbmRsZXJzIHVzZSB0byBjYW5jZWwgdGhlIHRpbWVyIGFuZCB0byByZXBvcnQgYVxuICAgKiB0aW1lb3V0LXNwZWNpZmljIGZhaWx1cmUuIFdoZW4gbm8gdGltZW91dCBpcyBjb25maWd1cmVkIHRoZSB0aW1lciBpcyBudWxsXG4gICAqIGFuZCBiZWhhdmlvciBpcyB1bmNoYW5nZWQuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gT3B0aW9ucy5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCJub2RlOmNoaWxkX3Byb2Nlc3NcIikuQ2hpbGRQcm9jZXNzfSBhcmdzLmNoaWxkIC0gRm9ya2VkIGNoaWxkIHByb2Nlc3MuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi90eXBlcy5qc1wiKS5CYWNrZ3JvdW5kSm9iUGF5bG9hZCAmIHtpZDogc3RyaW5nfX0gYXJncy5wYXlsb2FkIC0gSm9iIHBheWxvYWQuXG4gICAqIEByZXR1cm5zIHtGb3JrZWRKb2JUaW1lb3V0U3RhdGV9IC0gVGltZW91dCBzdGF0ZS5cbiAgICovXG4gIF9hcm1Gb3JrZWRKb2JUaW1lb3V0KHtjaGlsZCwgcGF5bG9hZH0pIHtcbiAgICBjb25zdCB0aW1lb3V0TXMgPSB0aGlzLl9yZXNvbHZlSm9iVGltZW91dE1zKHBheWxvYWQub3B0aW9ucylcbiAgICAvKiogQHR5cGUge0ZvcmtlZEpvYlRpbWVvdXRTdGF0ZX0gKi9cbiAgICBjb25zdCBzdGF0ZSA9IHt0aW1lZE91dDogZmFsc2UsIHRpbWVvdXRNcywgdGltZXI6IG51bGwsIHNpZ2tpbGxUaW1lcjogbnVsbH1cblxuICAgIGlmICghKHR5cGVvZiB0aW1lb3V0TXMgPT09IFwibnVtYmVyXCIgJiYgdGltZW91dE1zID4gMCkpIHJldHVybiBzdGF0ZVxuXG4gICAgc3RhdGUudGltZXIgPSBzZXRUaW1lb3V0KCgpID0+IHRoaXMuX29uRm9ya2VkSm9iVGltZW91dCh7Y2hpbGQsIHN0YXRlfSksIHRpbWVvdXRNcylcblxuICAgIHJldHVybiBzdGF0ZVxuICB9XG5cbiAgLyoqXG4gICAqIFJlc29sdmVzIHRoZSBlZmZlY3RpdmUgd2FsbC1jbG9jayBqb2IgdGltZW91dCBpbiBtcyAoc2hhcmVkIGJ5IGZvcmtlZCBhbmQgcG9vbGVkIGpvYnMpLCBvciBudWxsIHdoZW4gZGlzYWJsZWQuIFRoZVxuICAgKiBwZXItam9iIG92ZXJyaWRlIHdpbnMsIGZvbGxvd2VkIGJ5IHRoZSBjb25zdHJ1Y3RvciBvdmVycmlkZSwgdGhlbiB0aGUgdmFsdWVcbiAgICogZnJvbSB0aGUgYmFja2dyb3VuZC1qb2JzIGNvbmZpZ3VyYXRpb24uIEEgbm9uLXBvc2l0aXZlIHZhbHVlIGRpc2FibGVzIHRoZVxuICAgKiBiYWNrc3RvcCBhdCB3aGljaGV2ZXIgbGV2ZWwgc3VwcGxpZWQgaXQuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi90eXBlcy5qc1wiKS5CYWNrZ3JvdW5kSm9iT3B0aW9uc30gW2pvYk9wdGlvbnNdIC0gUGVyLWpvYiBvcHRpb25zLlxuICAgKiBAcmV0dXJucyB7bnVtYmVyIHwgbnVsbH0gLSBUaW1lb3V0IGluIG1zLCBvciBudWxsIHdoZW4gZGlzYWJsZWQuXG4gICAqL1xuICBfcmVzb2x2ZUpvYlRpbWVvdXRNcyhqb2JPcHRpb25zKSB7XG4gICAgY29uc3QgcmF3ID0gdHlwZW9mIGpvYk9wdGlvbnM/LnRpbWVvdXRNcyA9PT0gXCJudW1iZXJcIlxuICAgICAgPyBqb2JPcHRpb25zLnRpbWVvdXRNc1xuICAgICAgOiAodHlwZW9mIHRoaXMuam9iVGltZW91dE1zT3ZlcnJpZGUgPT09IFwibnVtYmVyXCJcbiAgICAgICAgICA/IHRoaXMuam9iVGltZW91dE1zT3ZlcnJpZGVcbiAgICAgICAgICA6ICh0aGlzLmNvbmZpZ3VyYXRpb24gPyB0aGlzLmNvbmZpZ3VyYXRpb24uZ2V0QmFja2dyb3VuZEpvYnNDb25maWcoKS5qb2JUaW1lb3V0TXMgOiBudWxsKSlcblxuICAgIC8vIEEgbm9uLWZpbml0ZSAoZS5nLiBJbmZpbml0eSkgb3Igbm9uLXBvc2l0aXZlIHZhbHVlIGRpc2FibGVzIHRoZSBiYWNrc3RvcDtcbiAgICAvLyBhIGZpbml0ZSB2YWx1ZSBiZXlvbmQgTm9kZSdzIHRpbWVyIHJhbmdlIGlzIGNsYW1wZWQgdG8gdGhlIG1heCByYXRoZXIgdGhhblxuICAgIC8vIHNpbGVudGx5IGNvZXJjZWQgdG8gfjFtcyAod2hpY2ggd291bGQga2lsbCBldmVyeSBmb3JrZWQgam9iIGltbWVkaWF0ZWx5KS5cbiAgICBpZiAodHlwZW9mIHJhdyAhPT0gXCJudW1iZXJcIiB8fCAhTnVtYmVyLmlzRmluaXRlKHJhdykgfHwgcmF3IDw9IDApIHJldHVybiBudWxsXG5cbiAgICByZXR1cm4gTWF0aC5taW4ocmF3LCBNQVhfRk9SS0VEX0pPQl9USU1FT1VUX01TKVxuICB9XG5cbiAgLyoqXG4gICAqIEZpcmVkIHdoZW4gYSBmb3JrZWQgcnVubmVyIG92ZXJydW5zIGl0cyB0aW1lb3V0LiBTZW5kcyBTSUdURVJNIGZvciBhIGNsZWFuXG4gICAqIHNodXRkb3duLCB0aGVuIFNJR0tJTEwgYWZ0ZXIgdGhlIGdyYWNlIGZvciBhIHJ1bm5lciB0aGF0IGlnbm9yZXMgaXQuIFRoZVxuICAgKiByZXN1bHRpbmcgbm9uLWNsZWFuIGV4aXQgZmxvd3MgdGhyb3VnaCBgX2hhbmRsZUZvcmtlZENoaWxkRXhpdGAsIHdoaWNoIGZyZWVzXG4gICAqIHRoZSBzbG90IGFuZCByZXBvcnRzIHRoZSBqb2IgZmFpbGVkLlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIE9wdGlvbnMuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwibm9kZTpjaGlsZF9wcm9jZXNzXCIpLkNoaWxkUHJvY2Vzc30gYXJncy5jaGlsZCAtIEZvcmtlZCBjaGlsZCBwcm9jZXNzLlxuICAgKiBAcGFyYW0ge0ZvcmtlZEpvYlRpbWVvdXRTdGF0ZX0gYXJncy5zdGF0ZSAtIFRpbWVvdXQgc3RhdGUuXG4gICAqIEByZXR1cm5zIHt2b2lkfVxuICAgKi9cbiAgX29uRm9ya2VkSm9iVGltZW91dCh7Y2hpbGQsIHN0YXRlfSkge1xuICAgIHN0YXRlLnRpbWVkT3V0ID0gdHJ1ZVxuXG4gICAgdHJ5IHtcbiAgICAgIGNoaWxkLmtpbGwoXCJTSUdURVJNXCIpXG4gICAgfSBjYXRjaCB7XG4gICAgICAvLyBDaGlsZCBhbHJlYWR5IGV4aXRlZDsgbm90aGluZyB0byBkby5cbiAgICB9XG5cbiAgICBzdGF0ZS5zaWdraWxsVGltZXIgPSBzZXRUaW1lb3V0KCgpID0+IHtcbiAgICAgIHRyeSB7XG4gICAgICAgIGNoaWxkLmtpbGwoXCJTSUdLSUxMXCIpXG4gICAgICB9IGNhdGNoIHtcbiAgICAgICAgLy8gQ2hpbGQgYWxyZWFkeSBleGl0ZWQ7IG5vdGhpbmcgdG8gZG8uXG4gICAgICB9XG4gICAgfSwgdGhpcy5mb3JrZWRDaGlsZFNpZ2tpbGxHcmFjZU1zKVxuICB9XG5cbiAgLyoqXG4gICAqIENhbmNlbHMgYW55IHBlbmRpbmcgdGltZW91dC9TSUdLSUxMIHRpbWVycyBmb3IgYSBmb3JrZWQgcnVubmVyIHRoYXQgaGFzXG4gICAqIGV4aXRlZCAob3IgZXJyb3JlZCkgc28gdGhleSBuZXZlciBmaXJlIGFnYWluc3QgYSBnb25lIG9yIHJldXNlZCBjaGlsZC5cbiAgICogQHBhcmFtIHtGb3JrZWRKb2JUaW1lb3V0U3RhdGV9IHN0YXRlIC0gVGltZW91dCBzdGF0ZS5cbiAgICogQHJldHVybnMge3ZvaWR9XG4gICAqL1xuICBfY2xlYXJGb3JrZWRKb2JUaW1lb3V0KHN0YXRlKSB7XG4gICAgaWYgKHN0YXRlLnRpbWVyKSB7XG4gICAgICBjbGVhclRpbWVvdXQoc3RhdGUudGltZXIpXG4gICAgICBzdGF0ZS50aW1lciA9IG51bGxcbiAgICB9XG5cbiAgICBpZiAoc3RhdGUuc2lna2lsbFRpbWVyKSB7XG4gICAgICBjbGVhclRpbWVvdXQoc3RhdGUuc2lna2lsbFRpbWVyKVxuICAgICAgc3RhdGUuc2lna2lsbFRpbWVyID0gbnVsbFxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGhhbmRsZSBmb3JrZWQgY2hpbGQgZXhpdC5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBPcHRpb25zLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIm5vZGU6Y2hpbGRfcHJvY2Vzc1wiKS5DaGlsZFByb2Nlc3N9IGFyZ3MuY2hpbGQgLSBGb3JrZWQgY2hpbGQgcHJvY2Vzcy5cbiAgICogQHBhcmFtIHtudW1iZXIgfCBudWxsfSBhcmdzLmNvZGUgLSBFeGl0IGNvZGUuXG4gICAqIEBwYXJhbSB7a2V5b2YgdHlwZW9mIGltcG9ydChcIm5vZGU6b3NcIikuY29uc3RhbnRzLnNpZ25hbHMgfCBudWxsfSBhcmdzLnNpZ25hbCAtIEV4aXQgc2lnbmFsLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vdHlwZXMuanNcIikuQmFja2dyb3VuZEpvYlBheWxvYWQgJiB7aWQ6IHN0cmluZ319IGFyZ3MucGF5bG9hZCAtIFBheWxvYWQuXG4gICAqIEBwYXJhbSB7KHZhbHVlOiB2b2lkKSA9PiB2b2lkfSBhcmdzLnJlc29sdmUgLSBQcm9taXNlIHJlc29sdmVyLlxuICAgKiBAcGFyYW0ge0ZvcmtlZEpvYlRpbWVvdXRTdGF0ZX0gW2FyZ3MudGltZW91dFN0YXRlXSAtIFRpbWVvdXQgc3RhdGUsIHdoZW4gdGhlIHJ1bm5lciBoYWQgYSB3YWxsLWNsb2NrIGJhY2tzdG9wLlxuICAgKiBAcmV0dXJucyB7dm9pZH1cbiAgICovXG4gIF9oYW5kbGVGb3JrZWRDaGlsZEV4aXQoe2NoaWxkLCBjb2RlLCBzaWduYWwsIHBheWxvYWQsIHJlc29sdmUsIHRpbWVvdXRTdGF0ZX0pIHtcbiAgICB0aGlzLmluZmxpZ2h0UHJvY2Vzc0NoaWxkcmVuLmRlbGV0ZShjaGlsZClcblxuICAgIC8vIEZyZWUgdGhlIHdvcmtlciBzbG90IGFzIHNvb24gYXMgdGhlIGNoaWxkIGlzIGdvbmUg4oCUIG5ldmVyIGdhdGUgaXQgb24gdGhlXG4gICAgLy8gZmFpbHVyZSByZXBvcnQuIEEgaHVuZy9zbG93IHJlcG9ydCBtdXN0IG5vdCBsZWFrIHRoZSBzbG90OyBlbm91Z2ggbGVha2VkXG4gICAgLy8gc2xvdHMgZHJpdmUgYGFjY2VwdHNGb3JrZWRgIHRvIGZhbHNlIGFuZCBzaWxlbnRseSB3ZWRnZSB0aGUgd29ya2VyLlxuICAgIHJlc29sdmUodW5kZWZpbmVkKVxuXG4gICAgaWYgKHRoaXMuX2ZvcmtlZENoaWxkRXhpdGVkQ2xlYW5seSh7Y29kZSwgc2lnbmFsfSkpIHJldHVyblxuXG4gICAgY29uc3QgZXJyb3IgPSB0aW1lb3V0U3RhdGU/LnRpbWVkT3V0XG4gICAgICA/IG5ldyBFcnJvcihgRm9ya2VkIGJhY2tncm91bmQgam9iIHJ1bm5lciB0aW1lZCBvdXQgYWZ0ZXIgJHt0aW1lb3V0U3RhdGUudGltZW91dE1zfW1zIGFuZCB3YXMgdGVybWluYXRlZDogY29kZT0ke2NvZGV9IHNpZ25hbD0ke3NpZ25hbCB8fCBcIm5vbmVcIn1gKVxuICAgICAgOiBuZXcgRXJyb3IoYEZvcmtlZCBiYWNrZ3JvdW5kIGpvYiBydW5uZXIgZXhpdGVkIGJlZm9yZSByZXBvcnRpbmc6IGNvZGU9JHtjb2RlfSBzaWduYWw9JHtzaWduYWwgfHwgXCJub25lXCJ9YClcblxuICAgIHRoaXMuX3JlcG9ydEZvcmtlZENoaWxkRmFpbHVyZSh7cGF5bG9hZCwgZXJyb3J9KVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZm9ya2VkIGNoaWxkIGV4aXRlZCBjbGVhbmx5LlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIE9wdGlvbnMuXG4gICAqIEBwYXJhbSB7bnVtYmVyIHwgbnVsbH0gYXJncy5jb2RlIC0gRXhpdCBjb2RlLlxuICAgKiBAcGFyYW0ge2tleW9mIHR5cGVvZiBpbXBvcnQoXCJub2RlOm9zXCIpLmNvbnN0YW50cy5zaWduYWxzIHwgbnVsbH0gYXJncy5zaWduYWwgLSBFeGl0IHNpZ25hbC5cbiAgICogQHJldHVybnMge2Jvb2xlYW59IC0gV2hldGhlciB0aGUgY2hpbGQgZXhpdGVkIGNsZWFubHkuXG4gICAqL1xuICBfZm9ya2VkQ2hpbGRFeGl0ZWRDbGVhbmx5KHtjb2RlLCBzaWduYWx9KSB7XG4gICAgcmV0dXJuIGNvZGUgPT09IDAgJiYgIXNpZ25hbFxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgaGFuZGxlIGZvcmtlZCBjaGlsZCBlcnJvci5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBPcHRpb25zLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIm5vZGU6Y2hpbGRfcHJvY2Vzc1wiKS5DaGlsZFByb2Nlc3N9IGFyZ3MuY2hpbGQgLSBGb3JrZWQgY2hpbGQgcHJvY2Vzcy5cbiAgICogQHBhcmFtIHtFcnJvcn0gYXJncy5lcnJvciAtIENoaWxkIHByb2Nlc3MgZXJyb3IuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi90eXBlcy5qc1wiKS5CYWNrZ3JvdW5kSm9iUGF5bG9hZCAmIHtpZDogc3RyaW5nfX0gYXJncy5wYXlsb2FkIC0gUGF5bG9hZC5cbiAgICogQHBhcmFtIHsodmFsdWU6IHZvaWQpID0+IHZvaWR9IGFyZ3MucmVzb2x2ZSAtIFByb21pc2UgcmVzb2x2ZXIuXG4gICAqIEByZXR1cm5zIHt2b2lkfVxuICAgKi9cbiAgX2hhbmRsZUZvcmtlZENoaWxkRXJyb3Ioe2NoaWxkLCBlcnJvciwgcGF5bG9hZCwgcmVzb2x2ZX0pIHtcbiAgICB0aGlzLmluZmxpZ2h0UHJvY2Vzc0NoaWxkcmVuLmRlbGV0ZShjaGlsZClcbiAgICAvLyBGcmVlIHRoZSBzbG90IGZpcnN0IChzZWUgX2hhbmRsZUZvcmtlZENoaWxkRXhpdCkg4oCUIHJlcG9ydGluZyBpcyBiZXN0LWVmZm9ydC5cbiAgICByZXNvbHZlKHVuZGVmaW5lZClcbiAgICBjb25zb2xlLmVycm9yKFwiQmFja2dyb3VuZCBqb2JzIGZvcmtlZCBydW5uZXIgZXJyb3I6XCIsIGVycm9yKVxuICAgIHRoaXMuX3JlcG9ydEZvcmtlZENoaWxkRmFpbHVyZSh7cGF5bG9hZCwgZXJyb3J9KVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgc2VuZCBmb3JrZWQgcGF5bG9hZC5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBPcHRpb25zLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIm5vZGU6Y2hpbGRfcHJvY2Vzc1wiKS5DaGlsZFByb2Nlc3N9IGFyZ3MuY2hpbGQgLSBGb3JrZWQgY2hpbGQgcHJvY2Vzcy5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL3R5cGVzLmpzXCIpLkJhY2tncm91bmRKb2JQYXlsb2FkICYge2lkOiBzdHJpbmd9fSBhcmdzLnBheWxvYWQgLSBQYXlsb2FkLlxuICAgKiBAcmV0dXJucyB7dm9pZH1cbiAgICovXG4gIF9zZW5kRm9ya2VkUGF5bG9hZCh7Y2hpbGQsIHBheWxvYWR9KSB7XG4gICAgdHJ5IHtcbiAgICAgIGNoaWxkLnNlbmQoe3R5cGU6IFwiam9iXCIsIHBheWxvYWR9KVxuICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICBjaGlsZC5raWxsKFwiU0lHVEVSTVwiKVxuICAgICAgdGhpcy5fcmVwb3J0Rm9ya2VkQ2hpbGRGYWlsdXJlKHtwYXlsb2FkLCBlcnJvcn0pXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgcmVwb3J0IGZvcmtlZCBjaGlsZCBmYWlsdXJlLlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIE9wdGlvbnMuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi90eXBlcy5qc1wiKS5CYWNrZ3JvdW5kSm9iUGF5bG9hZCAmIHtpZDogc3RyaW5nfX0gYXJncy5wYXlsb2FkIC0gUGF5bG9hZC5cbiAgICogQHBhcmFtIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gYXJncy5lcnJvciAtIEVycm9yLlxuICAgKiBAcmV0dXJucyB7dm9pZH1cbiAgICovXG4gIF9yZXBvcnRGb3JrZWRDaGlsZEZhaWx1cmUoe3BheWxvYWQsIGVycm9yfSkge1xuICAgIHRoaXMuX3JlcG9ydEpvYlJlc3VsdEluQmFja2dyb3VuZCh7XG4gICAgICBqb2JJZDogcGF5bG9hZC5pZCxcbiAgICAgIHN0YXR1czogXCJmYWlsZWRcIixcbiAgICAgIGVycm9yLFxuICAgICAgaGFuZG9mZklkOiBwYXlsb2FkLmhhbmRvZmZJZCxcbiAgICAgIGhhbmRlZE9mZkF0TXM6IHBheWxvYWQuaGFuZGVkT2ZmQXRNcyxcbiAgICAgIHdvcmtlcklkOiBwYXlsb2FkLndvcmtlcklkIHx8IHRoaXMud29ya2VySWRcbiAgICB9KVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgc3Bhd24gam9iLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vdHlwZXMuanNcIikuQmFja2dyb3VuZEpvYlBheWxvYWR9IHBheWxvYWQgLSBQYXlsb2FkLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyB3aGVuIHRoZSBzcGF3bmVkIHJ1bm5lciBleGl0cyBvciBzcGF3biBmYWlscy5cbiAgICovXG4gIF9zcGF3bkpvYihwYXlsb2FkKSB7XG4gICAgY29uc3QgY29uZmlndXJhdGlvbiA9IHRoaXMuY29uZmlndXJhdGlvblxuICAgIGlmICghY29uZmlndXJhdGlvbikgdGhyb3cgbmV3IEVycm9yKFwiQmFja2dyb3VuZCBqb2JzIHdvcmtlciBjb25maWd1cmF0aW9uIG5vdCBpbml0aWFsaXplZFwiKVxuXG4gICAgY29uc3QgZGlyZWN0b3J5ID0gY29uZmlndXJhdGlvbi5nZXREaXJlY3RvcnkoKVxuICAgIGNvbnN0IGFyZ3ZDb21tYW5kID0gcHJvY2Vzcy5hcmd2WzFdXG4gICAgY29uc3QgY29tbWFuZCA9IGFyZ3ZDb21tYW5kID8gYXJndkNvbW1hbmQgOiBgJHtkaXJlY3Rvcnl9L2Jpbi92ZWxvY2lvdXMuanNgXG4gICAgY29uc3QgZW5jb2RlZFBheWxvYWQgPSBCdWZmZXIuZnJvbShKU09OLnN0cmluZ2lmeShwYXlsb2FkKSkudG9TdHJpbmcoXCJiYXNlNjRcIilcbiAgICBjb25zdCBjaGlsZCA9IHNwYXduKHByb2Nlc3MuZXhlY1BhdGgsIFsuLi50aGlzLl9jaGlsZFJ1bm5lckV4ZWNBcmd2KCksIGNvbW1hbmQsIFwiYmFja2dyb3VuZC1qb2JzLXJ1bm5lclwiXSwge1xuICAgICAgY3dkOiBkaXJlY3RvcnksXG4gICAgICBkZXRhY2hlZDogdHJ1ZSxcbiAgICAgIHN0ZGlvOiBcImlnbm9yZVwiLFxuICAgICAgZW52OiBPYmplY3QuYXNzaWduKHt9LCBwcm9jZXNzLmVudiwgdGhpcy5fY2hpbGRCYWNrZ3JvdW5kSm9ic0Vudmlyb25tZW50KCksIHtWRUxPQ0lPVVNfSk9CX1BBWUxPQUQ6IGVuY29kZWRQYXlsb2FkfSlcbiAgICB9KVxuXG4gICAgdGhpcy5pbmZsaWdodFByb2Nlc3NDaGlsZHJlbi5hZGQoY2hpbGQpXG5cbiAgICBjb25zdCBmaW5pc2hlZCA9IG5ldyBQcm9taXNlKChyZXNvbHZlKSA9PiB7XG4gICAgICBjaGlsZC5vbmNlKFwiZXhpdFwiLCAoKSA9PiB7XG4gICAgICAgIHRoaXMuaW5mbGlnaHRQcm9jZXNzQ2hpbGRyZW4uZGVsZXRlKGNoaWxkKVxuICAgICAgICByZXNvbHZlKHVuZGVmaW5lZClcbiAgICAgIH0pXG4gICAgICBjaGlsZC5vbmNlKFwiZXJyb3JcIiwgKGVycm9yKSA9PiB7XG4gICAgICAgIHRoaXMuaW5mbGlnaHRQcm9jZXNzQ2hpbGRyZW4uZGVsZXRlKGNoaWxkKVxuICAgICAgICBjb25zb2xlLmVycm9yKFwiQmFja2dyb3VuZCBqb2JzIHNwYXduZWQgcnVubmVyIGVycm9yOlwiLCBlcnJvcilcbiAgICAgICAgcmVzb2x2ZSh1bmRlZmluZWQpXG4gICAgICB9KVxuICAgIH0pXG5cbiAgICBjaGlsZC51bnJlZigpXG5cbiAgICByZXR1cm4gZmluaXNoZWRcbiAgfVxuXG4gIC8qKlxuICAgKiBCdWlsZHMgdGhlIG5vZGUgb3B0aW9ucyBhcHBsaWVkIHRvIGV2ZXJ5IGJhY2tncm91bmQtam9icyBydW5uZXIgY2hpbGQuXG4gICAqIEEgaGFyZCBWOCBoZWFwIGNhcCBrZWVwcyBvbmUgY2hpbGQgZnJvbSBldmVyIGNvbW1pdHRpbmcgbXVsdGlwbGUgR0JzIG9mXG4gICAqIGhlYXA7IGl0IHN0YXlzIGRlbGliZXJhdGVseSBnZW5lcm91cyByZWxhdGl2ZSB0byBvYnNlcnZlZCBydW5uZXIgdXNhZ2VcbiAgICogKHRlbnMgdG8gYSBmZXcgaHVuZHJlZCBNQikgYW5kIGlzIGNvbmZpZ3VyYWJsZSB2aWFcbiAgICogYGJhY2tncm91bmRKb2JzLnJ1bm5lck1heE9sZFNwYWNlU2l6ZU1iYC5cbiAgICogQHJldHVybnMge3N0cmluZ1tdfSAtIE5vZGUgb3B0aW9ucyBmb3IgcnVubmVyIGNoaWxkcmVuLlxuICAgKi9cbiAgX2NoaWxkUnVubmVyRXhlY0FyZ3YoKSB7XG4gICAgcmV0dXJuIFtgLS1tYXgtb2xkLXNwYWNlLXNpemU9JHt0aGlzLnJ1bm5lck1heE9sZFNwYWNlU2l6ZU1ifWBdXG4gIH1cblxuICAvKipcbiAgICogQnVpbGRzIHRoZSBleGFjdCBtYWluIGVuZHBvaW50IGFuZCBnZW5lcmF0aW9uIGluaGVyaXRlZCBieSBldmVyeSBjaGlsZC5cbiAgICogQHJldHVybnMge1JlY29yZDxzdHJpbmcsIHN0cmluZz59IC0gQ2hpbGQgcHJvY2VzcyBlbnZpcm9ubWVudCBhZGRpdGlvbnMuXG4gICAqL1xuICBfY2hpbGRCYWNrZ3JvdW5kSm9ic0Vudmlyb25tZW50KCkge1xuICAgIGNvbnN0IGNvbmZpZ3VyYXRpb24gPSB0aGlzLmNvbmZpZ3VyYXRpb25cbiAgICBpZiAoIWNvbmZpZ3VyYXRpb24pIHRocm93IG5ldyBFcnJvcihcIkJhY2tncm91bmQgam9icyB3b3JrZXIgY29uZmlndXJhdGlvbiBub3QgaW5pdGlhbGl6ZWRcIilcbiAgICBpZiAoIXRoaXMuaG9zdCB8fCB0eXBlb2YgdGhpcy5wb3J0ICE9PSBcIm51bWJlclwiKSB0aHJvdyBuZXcgRXJyb3IoXCJCYWNrZ3JvdW5kIGpvYnMgd29ya2VyIGVuZHBvaW50IG5vdCByZXNvbHZlZFwiKVxuXG4gICAgcmV0dXJuIHtcbiAgICAgIFZFTE9DSU9VU19CQUNLR1JPVU5EX0pPQl9DSElMRDogXCIxXCIsXG4gICAgICBWRUxPQ0lPVVNfRU5WOiBjb25maWd1cmF0aW9uLmdldEVudmlyb25tZW50KCksXG4gICAgICBWRUxPQ0lPVVNfQkFDS0dST1VORF9KT0JTX0hPU1Q6IHRoaXMuaG9zdCxcbiAgICAgIFZFTE9DSU9VU19CQUNLR1JPVU5EX0pPQlNfUE9SVDogYCR7dGhpcy5wb3J0fWAsXG4gICAgICBNQUxMT0NfQVJFTkFfTUFYOiBgJHt0aGlzLnJ1bm5lck1hbGxvY0FyZW5hTWF4fWAsXG4gICAgICAuLi4odGhpcy5nZW5lcmF0aW9uSWQgPyB7VkVMT0NJT1VTX0JBQ0tHUk9VTkRfSk9CU19HRU5FUkFUSU9OX0lEOiB0aGlzLmdlbmVyYXRpb25JZH0gOiB7fSlcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogUnVucyByZXBvcnQgam9iIHJlc3VsdC5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBPcHRpb25zLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gYXJncy5qb2JJZCAtIEpvYiBpZC5cbiAgICogQHBhcmFtIHtcImNvbXBsZXRlZFwiIHwgXCJmYWlsZWRcIiB8IFwicmVzY2hlZHVsZWRcIn0gYXJncy5zdGF0dXMgLSBTdGF0dXMuXG4gICAqIEBwYXJhbSB7bnVtYmVyfSBbYXJncy5kZWxheU1zXSAtIFJlc2NoZWR1bGUgZGVsYXkgaW4gbWlsbGlzZWNvbmRzLlxuICAgKiBAcGFyYW0ge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSBbYXJncy5lcnJvcl0gLSBFcnJvci5cbiAgICogQHBhcmFtIHtzdHJpbmd9IFthcmdzLmhhbmRvZmZJZF0gLSBIYW5kb2ZmIGxlYXNlIGlkLlxuICAgKiBAcGFyYW0ge251bWJlcn0gW2FyZ3MuaGFuZGVkT2ZmQXRNc10gLSBIYW5kZWQgb2ZmIHRpbWVzdGFtcC5cbiAgICogQHBhcmFtIHtzdHJpbmd9IFthcmdzLndvcmtlcklkXSAtIFdvcmtlciBpZC5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL3R5cGVzLmpzXCIpLlBvb2xlZFJ1bm5lckZhaWx1cmV9IFthcmdzLnJ1bm5lckZhaWx1cmVdIC0gUG9vbGVkLWNoaWxkIHByb2Nlc3MgZmFpbHVyZSBwcm92ZW5hbmNlLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyB3aGVuIHJlcG9ydGVkLlxuICAgKi9cbiAgYXN5bmMgX3JlcG9ydEpvYlJlc3VsdCh7am9iSWQsIHN0YXR1cywgZGVsYXlNcywgZXJyb3IsIGhhbmRvZmZJZCwgaGFuZGVkT2ZmQXRNcywgd29ya2VySWQsIHJ1bm5lckZhaWx1cmV9KSB7XG4gICAgaWYgKCF0aGlzLnN0YXR1c1JlcG9ydGVyKSByZXR1cm5cblxuICAgIHRyeSB7XG4gICAgICAvLyBSZXRyeSBhIHRyYW5zaWVudCBwZXJzaXN0IGZhaWx1cmUgKGBqb2ItdXBkYXRlLWVycm9yYCk6IHRoZSB3b3JrZXIgaXNcbiAgICAgIC8vIGxvbmctbGl2ZWQgYW5kIGNhbm5vdCBleGl0IHRvIHRyaWdnZXIgb3JwaGFuIHJlY2xhaW0sIHNvIGRyb3BwaW5nIHRoZVxuICAgICAgLy8gY29tcGxldGlvbiBoZXJlIHdvdWxkIHN0cmFuZCB0aGUgam9iIGluIGBoYW5kZWRfb2ZmYCBmb3JldmVyIOKAlCBmYXRhbCBmb3IgYVxuICAgICAgLy8gYG1heF9jb25jdXJyZW5jeTogMWAgam9iIChhIHN0cmFuZGVkIHJvdyBibG9ja3MgZXZlcnkgZnV0dXJlIHJ1bikuXG4gICAgICBhd2FpdCB0aGlzLnN0YXR1c1JlcG9ydGVyLnJlcG9ydFdpdGhSZXRyeSh7am9iSWQsIHN0YXR1cywgZGVsYXlNcywgZXJyb3IsIGhhbmRvZmZJZCwgaGFuZGVkT2ZmQXRNcywgd29ya2VySWQsIHJ1bm5lckZhaWx1cmUsIHJldHJ5UGVyc2lzdEVycm9yczogdHJ1ZX0pXG4gICAgfSBjYXRjaCAocmVwb3J0RXJyb3IpIHtcbiAgICAgIGNvbnNvbGUuZXJyb3IoXCJCYWNrZ3JvdW5kIGpvYiBzdGF0dXMgcmVwb3J0aW5nIGZhaWxlZDpcIiwgcmVwb3J0RXJyb3IpXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIEZpcmVzIGEgZHVyYWJsZSBqb2ItcmVzdWx0IHJlcG9ydCB3aXRob3V0IGJsb2NraW5nIHRoZSBjYWxsZXIgKHNvIGZyZWVpbmcgYVxuICAgKiBqb2IvY2hpbGQgc2xvdCBuZXZlciB3YWl0cyBvbiB0aGUgcmVwb3J0KS4gVGhlIHJlcG9ydCBpcyB0cmFja2VkIHNvIGFcbiAgICogZ3JhY2VmdWwgYHN0b3AoKWAgY2FuIGRyYWluIGluLWZsaWdodCByZXBvcnRzIGJlZm9yZSBjbG9zaW5nIHRoZSBzb2NrZXQuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gT3B0aW9ucy5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGFyZ3Muam9iSWQgLSBKb2IgaWQuXG4gICAqIEBwYXJhbSB7XCJjb21wbGV0ZWRcIiB8IFwiZmFpbGVkXCIgfCBcInJlc2NoZWR1bGVkXCJ9IGFyZ3Muc3RhdHVzIC0gU3RhdHVzLlxuICAgKiBAcGFyYW0ge251bWJlcn0gW2FyZ3MuZGVsYXlNc10gLSBSZXNjaGVkdWxlIGRlbGF5IGluIG1pbGxpc2Vjb25kcy5cbiAgICogQHBhcmFtIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gW2FyZ3MuZXJyb3JdIC0gRXJyb3IuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBbYXJncy5oYW5kb2ZmSWRdIC0gSGFuZG9mZiBsZWFzZSBpZC5cbiAgICogQHBhcmFtIHtudW1iZXJ9IFthcmdzLmhhbmRlZE9mZkF0TXNdIC0gSGFuZGVkIG9mZiB0aW1lc3RhbXAuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBbYXJncy53b3JrZXJJZF0gLSBXb3JrZXIgaWQuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi90eXBlcy5qc1wiKS5Qb29sZWRSdW5uZXJGYWlsdXJlfSBbYXJncy5ydW5uZXJGYWlsdXJlXSAtIFBvb2xlZC1jaGlsZCBwcm9jZXNzIGZhaWx1cmUgcHJvdmVuYW5jZS5cbiAgICogQHJldHVybnMge3ZvaWR9XG4gICAqL1xuICBfcmVwb3J0Sm9iUmVzdWx0SW5CYWNrZ3JvdW5kKHtqb2JJZCwgc3RhdHVzLCBkZWxheU1zLCBlcnJvciwgaGFuZG9mZklkLCBoYW5kZWRPZmZBdE1zLCB3b3JrZXJJZCwgcnVubmVyRmFpbHVyZX0pIHtcbiAgICAvKipcbiAgICAgKiBEZWZpbmVzIHJlcG9ydC5cbiAgICAgKiBAdHlwZSB7UHJvbWlzZTx2b2lkPn0gKi9cbiAgICBsZXQgcmVwb3J0XG5cbiAgICByZXBvcnQgPSB0aGlzLl9yZXBvcnRKb2JSZXN1bHQoe2pvYklkLCBzdGF0dXMsIGRlbGF5TXMsIGVycm9yLCBoYW5kb2ZmSWQsIGhhbmRlZE9mZkF0TXMsIHdvcmtlcklkLCBydW5uZXJGYWlsdXJlfSkuZmluYWxseSgoKSA9PiB7XG4gICAgICB0aGlzLmluZmxpZ2h0UmVwb3J0cy5kZWxldGUocmVwb3J0KVxuICAgIH0pXG5cbiAgICB0aGlzLmluZmxpZ2h0UmVwb3J0cy5hZGQocmVwb3J0KVxuICB9XG59XG4iXX0=