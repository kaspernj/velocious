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
 * @returns {message is {type: "job-received" | "job-started", jobId: string, handoffId?: string, workerId?: string, handedOffAtMs?: number, receivedAtMs?: number, startedAtMs?: number, childInstanceId?: string, childPid?: number, runnerHostname?: string}} - Whether this is a valid acceptance message.
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
        && (record.childPid === undefined || Number.isInteger(record.childPid))
        && (record.runnerHostname === undefined || typeof record.runnerHostname === "string");
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
     * @param {{type: "job-received" | "job-started", jobId: string, handoffId?: string, workerId?: string, handedOffAtMs?: number, receivedAtMs?: number, startedAtMs?: number, childInstanceId?: string, childPid?: number, runnerHostname?: string}} message - Validated child acceptance message.
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
            runnerHostname: message.runnerHostname,
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
     * off. When the pool already carries its bounded over-cap child, retiring
     * the last working child is deferred instead of emptying the working pool:
     * the child keeps serving and a later observation retries the retirement
     * once a draining exit has freed a cap slot, so advertised capacity cannot
     * collapse to zero inside a wave.
     * @param {import("node:child_process").ChildProcess} child - Child to retire.
     * @returns {void}
     */
    _beginRetirePooledChild(child) {
        const state = this.pooledChildStates.get(child);
        if (!state || state.retiring)
            return;
        // Retiring the last non-retiring child while the pool already carries its
        // bounded over-cap child would leave advertised capacity at zero until the
        // next draining exit — up to the longest in-flight job (tens of minutes
        // with builds), stalling dispatch cluster-wide. Defer this retirement
        // instead: the child keeps serving and a later observation retries once a
        // drain has freed a cap slot for its replacement.
        if (!this.shouldStop && this.configuration && this._nonRetiringPooledChildCount() <= 1 && this.pooledChildren.size > this.pooledRunnerCount) {
            this._logPooledCapacityEvent("pooled-capacity-retirement-deferred");
            return;
        }
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
     * exit), the deferred retirement of the last working child while the pool
     * already carries its bounded over-cap child (retried after the next drain
     * frees a cap slot), or the bounded starvation when an over-cap child is
     * already draining and the pool must wait for an exit.
     * @param {"pooled-capacity-liveness-spawn" | "pooled-capacity-starved" | "pooled-capacity-retirement-deferred"} event - Event name.
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoid29ya2VyLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiLi4vLi4vLi4vc3JjL2JhY2tncm91bmQtam9icy93b3JrZXIuanMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6IkFBQUEsWUFBWTtBQUVaLE9BQU8sR0FBRyxNQUFNLEtBQUssQ0FBQTtBQUNyQixPQUFPLEVBQUUsSUFBSSxFQUFFLEtBQUssRUFBRSxNQUFNLG9CQUFvQixDQUFBO0FBQ2hELE9BQU8sVUFBVSxNQUFNLGtCQUFrQixDQUFBO0FBQ3pDLE9BQU8scUJBQXFCLE1BQU0sbUJBQW1CLENBQUE7QUFDckQsT0FBTyxxQkFBcUIsTUFBTSw4QkFBOEIsQ0FBQTtBQUNoRSxPQUFPLDRCQUE0QixNQUFNLHNCQUFzQixDQUFBO0FBQy9ELE9BQU8sRUFBRSxVQUFVLEVBQUUsTUFBTSxRQUFRLENBQUE7QUFDbkMsT0FBTyxFQUFFLGFBQWEsRUFBRSxNQUFNLFVBQVUsQ0FBQTtBQUN4QyxPQUFPLGlCQUFpQixFQUFFLEVBQUUsZ0JBQWdCLEVBQUUsTUFBTSxnQ0FBZ0MsQ0FBQTtBQUNwRixPQUFPLDZCQUE2QixNQUFNLHdCQUF3QixDQUFBO0FBQ2xFLE9BQU8sb0JBQW9CLE1BQU0sa0JBQWtCLENBQUE7QUFDbkQsT0FBTyxFQUFFLDJCQUEyQixFQUFFLE1BQU0sd0JBQXdCLENBQUE7QUFDcEUsT0FBTyxFQUFFLHdCQUF3QixFQUFFLE1BQU0sMEJBQTBCLENBQUE7QUFDbkUsT0FBTyw2Q0FBNkMsRUFBRSxFQUFFLHVDQUF1QyxFQUFFLG9DQUFvQyxFQUFFLE1BQU0seUNBQXlDLENBQUE7QUFDdEwsT0FBTyxFQUFFLG1DQUFtQyxFQUFFLGlDQUFpQyxFQUFFLDJCQUEyQixFQUFFLDJCQUEyQixFQUFFLE1BQU0sNkJBQTZCLENBQUE7QUFFOUs7Ozs7Ozs7R0FPRztBQUNIOzs7Ozs7R0FNRztBQUNIOzs7Ozs7Ozs7Ozs7Ozs7Ozs7O0dBbUJHO0FBQ0gsaUZBQWlGO0FBQ2pGLE1BQU0sNkJBQTZCLEdBQUcs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QUMsT0FBTyxDQUFDLEdBQUcsRUFBRTtZQUM5SCxJQUFJLENBQUMsZUFBZSxDQUFDLE1BQU0sQ0FBQyxNQUFNLENBQUMsQ0FBQTtRQUNyQyxDQUFDLENBQUMsQ0FBQTtRQUVGLElBQUksQ0FBQyxlQUFlLENBQUMsR0FBRyxDQUFDLE1BQU0sQ0FBQyxDQUFBO0lBQ2xDLENBQUM7Q0FDRiIsInNvdXJjZXNDb250ZW50IjpbIi8vIEB0cy1jaGVja1xuXG5pbXBvcnQgbmV0IGZyb20gXCJuZXRcIlxuaW1wb3J0IHsgZm9yaywgc3Bhd24gfSBmcm9tIFwibm9kZTpjaGlsZF9wcm9jZXNzXCJcbmltcG9ydCBKc29uU29ja2V0IGZyb20gXCIuL2pzb24tc29ja2V0LmpzXCJcbmltcG9ydCBCYWNrZ3JvdW5kSm9iUmVnaXN0cnkgZnJvbSBcIi4vam9iLXJlZ2lzdHJ5LmpzXCJcbmltcG9ydCBjb25maWd1cmF0aW9uUmVzb2x2ZXIgZnJvbSBcIi4uL2NvbmZpZ3VyYXRpb24tcmVzb2x2ZXIuanNcIlxuaW1wb3J0IEJhY2tncm91bmRKb2JzU3RhdHVzUmVwb3J0ZXIgZnJvbSBcIi4vc3RhdHVzLXJlcG9ydGVyLmpzXCJcbmltcG9ydCB7IHJhbmRvbVVVSUQgfSBmcm9tIFwiY3J5cHRvXCJcbmltcG9ydCB7IGZpbGVVUkxUb1BhdGggfSBmcm9tIFwibm9kZTp1cmxcIlxuaW1wb3J0IHNodXRkb3duTGlmZWN5Y2xlLCB7IHJ1blNodXRkb3duU3RlcHMgfSBmcm9tIFwiLi4vdXRpbHMvc2h1dGRvd24tbGlmZWN5Y2xlLmpzXCJcbmltcG9ydCBCYWNrZ3JvdW5kSm9iUmVzY2hlZHVsZVNpZ25hbCBmcm9tIFwiLi9yZXNjaGVkdWxlLXNpZ25hbC5qc1wiXG5pbXBvcnQgcGVyZm9ybUJhY2tncm91bmRKb2IgZnJvbSBcIi4vcGVyZm9ybS1qb2IuanNcIlxuaW1wb3J0IHsgcnVuV2l0aEJhY2tncm91bmRKb2JQYXlsb2FkIH0gZnJvbSBcIi4vZXhlY3V0aW9uLWNvbnRleHQuanNcIlxuaW1wb3J0IHsgY3JlYXRlR2VuZXJhdGlvbldvcmtlcklkIH0gZnJvbSBcIi4vZ2VuZXJhdGlvbi1pZGVudGl0eS5qc1wiXG5pbXBvcnQgQmFja2dyb3VuZEpvYnNHZW5lcmF0aW9uSGFuZHNoYWtlVGltZW91dEVycm9yLCB7IERFRkFVTFRfR0VORVJBVElPTl9IQU5EU0hBS0VfVElNRU9VVF9NUywgdmFsaWRhdGVHZW5lcmF0aW9uSGFuZHNoYWtlVGltZW91dE1zIH0gZnJvbSBcIi4vZ2VuZXJhdGlvbi1oYW5kc2hha2UtdGltZW91dC1lcnJvci5qc1wiXG5pbXBvcnQgeyBQT09MRURfUlVOTkVSX0lORkxJR0hUX0pPQl9JRF9MSU1JVCwgYm91bmRlZFBvb2xlZFJ1bm5lckluZmxpZ2h0Sm9iSWRzLCBpc1Bvb2xlZENoaWxkU2h1dGRvd25SZWFzb24sIGlzUG9vbGVkQ2hpbGRTaHV0ZG93blNpZ25hbCB9IGZyb20gXCIuL3Bvb2xlZC1ydW5uZXItc2h1dGRvd24uanNcIlxuXG4vKipcbiAqIFBlci1mb3JrZWQtY2hpbGQgdGltZW91dCBib29ra2VlcGluZy5cbiAqIEB0eXBlZGVmIHtvYmplY3R9IEZvcmtlZEpvYlRpbWVvdXRTdGF0ZVxuICogQHByb3BlcnR5IHtib29sZWFufSB0aW1lZE91dCAtIFdoZXRoZXIgdGhlIHRpbWVvdXQgZmlyZWQgYW5kIHRoZSBjaGlsZCB3YXMgdGVybWluYXRlZC5cbiAqIEBwcm9wZXJ0eSB7bnVtYmVyIHwgbnVsbH0gdGltZW91dE1zIC0gVGhlIGFybWVkIHRpbWVvdXQgaW4gbXMsIG9yIG51bGwgd2hlbiBkaXNhYmxlZC5cbiAqIEBwcm9wZXJ0eSB7UmV0dXJuVHlwZTx0eXBlb2Ygc2V0VGltZW91dD4gfCBudWxsfSB0aW1lciAtIFRoZSBwZW5kaW5nIHRpbWVvdXQgdGltZXIsIGNsZWFyZWQgb24gZXhpdC5cbiAqIEBwcm9wZXJ0eSB7UmV0dXJuVHlwZTx0eXBlb2Ygc2V0VGltZW91dD4gfCBudWxsfSBzaWdraWxsVGltZXIgLSBUaGUgcGVuZGluZyBTSUdLSUxMIGdyYWNlIHRpbWVyLCBjbGVhcmVkIG9uIGV4aXQuXG4gKi9cbi8qKlxuICogQHR5cGVkZWYge29iamVjdH0gUG9vbGVkSm9iRW50cnlcbiAqIEBwcm9wZXJ0eSB7aW1wb3J0KFwiLi90eXBlcy5qc1wiKS5CYWNrZ3JvdW5kSm9iUGF5bG9hZCAmIHtpZDogc3RyaW5nfX0gcGF5bG9hZCAtIER1cmFibGUgam9iIHBheWxvYWQuXG4gKiBAcHJvcGVydHkgeyh2YWx1ZTogdm9pZCkgPT4gdm9pZH0gW3Jlc29sdmVdIC0gQ29tcGxldGlvbiByZXNvbHZlci5cbiAqIEBwcm9wZXJ0eSB7UHJvbWlzZTx2b2lkPn0gW3Bvb2xlZEpvYl0gLSBUcmFja2VkIHBvb2xlZC1qb2IgcHJvbWlzZS5cbiAqIEBwcm9wZXJ0eSB7UmV0dXJuVHlwZTx0eXBlb2Ygc2V0VGltZW91dD4gfCBudWxsfSBbdGltZW91dFRpbWVyXSAtIFBlci1qb2IgdGltZW91dCB0aW1lci5cbiAqL1xuLyoqXG4gKiBAdHlwZWRlZiB7b2JqZWN0fSBQb29sZWRDaGlsZFN0YXRlXG4gKiBAcHJvcGVydHkge251bWJlcn0gY3JlYXRlZEF0TXMgLSBDaGlsZCBjcmVhdGlvbiB0aW1lc3RhbXAuXG4gKiBAcHJvcGVydHkge3N0cmluZ30gW2NoaWxkSW5zdGFuY2VJZF0gLSBTdGFibGUgaWRlbnRpdHkgcmVwb3J0ZWQgYnkgdGhlIGNoaWxkLlxuICogQHByb3BlcnR5IHtudW1iZXJ9IGpvYnNSdW4gLSBBY2tub3dsZWRnZWQgam9icyBjb21wbGV0ZWQgYnkgdGhpcyBjaGlsZC5cbiAqIEBwcm9wZXJ0eSB7TWFwPHN0cmluZywgUG9vbGVkSm9iRW50cnk+fSBpbmZsaWdodCAtIEpvYnMgY3VycmVudGx5IG93bmVkIGJ5IHRoaXMgY2hpbGQuXG4gKiBAcHJvcGVydHkge251bWJlcn0gbGFzdERpc3BhdGNoU2VxIC0gUm91bmQtcm9iaW4gZGlzcGF0Y2ggc2VxdWVuY2UuXG4gKiBAcHJvcGVydHkge2Jvb2xlYW59IHJldGlyaW5nIC0gV2hldGhlciB0aGlzIGNoaWxkIGlzIGRyYWluaW5nIGJlZm9yZSByZXRpcmVtZW50LlxuICogQHByb3BlcnR5IHtib29sZWFufSBbc3RhcnRlZF0gLSBXaGV0aGVyIHRoZSBjaGlsZCBjb21wbGV0ZWQgaXRzIHN0YXJ0dXAgaGFuZHNoYWtlLlxuICogQHByb3BlcnR5IHtib29sZWFufSBbc2V0dGxpbmddIC0gV2hldGhlciBmYWlsdXJlIGhhbmRsaW5nIGFscmVhZHkgb3ducyB0aGlzIGNoaWxkLlxuICogQHByb3BlcnR5IHtpbXBvcnQoXCIuL3R5cGVzLmpzXCIpLlBvb2xlZENoaWxkTWVtb3J5T2JzZXJ2YXRpb259IFtsYXN0TWVtb3J5T2JzZXJ2YXRpb25dIC0gTGF0ZXN0IG1lbW9yeSBvYnNlcnZhdGlvbiByZWNlaXZlZCBmcm9tIHRoaXMgY2hpbGQuXG4gKiBAcHJvcGVydHkge251bWJlcn0gW2lwY0Rpc2Nvbm5lY3RlZEF0TXNdIC0gUGFyZW50IG9ic2VydmF0aW9uIG9mIElQQyBkaXNjb25uZWN0LlxuICogQHByb3BlcnR5IHtpbXBvcnQoXCIuL3R5cGVzLmpzXCIpLlBvb2xlZENoaWxkU2h1dGRvd25PYnNlcnZhdGlvbn0gW3NodXRkb3duT2JzZXJ2YXRpb25dIC0gQ2hpbGQgb2JzZXJ2YXRpb24gc2VudCBiZWZvcmUgdGVhcmRvd24uXG4gKiBAcHJvcGVydHkge2ltcG9ydChcIi4vdHlwZXMuanNcIikuUG9vbGVkQ2hpbGRTaHV0ZG93blJlYXNvbn0gW3NodXRkb3duUmVhc29uXSAtIEV4YWN0IHBhcmVudC1yZXF1ZXN0ZWQgc2h1dGRvd24gcmVhc29uLlxuICogQHByb3BlcnR5IHtudW1iZXJ9IFtzaHV0ZG93blJlcXVlc3RlZEF0TXNdIC0gRXhhY3QgcGFyZW50IHNodXRkb3duLXJlcXVlc3QgdGltZXN0YW1wLlxuICogQHByb3BlcnR5IHtpbXBvcnQoXCJub2RlOmNoaWxkX3Byb2Nlc3NcIikuQ2hpbGRQcm9jZXNzW1wic2lnbmFsQ29kZVwiXX0gW3NodXRkb3duU2lnbmFsXSAtIFNpZ25hbCBzZWxlY3RlZCBieSB0aGUgcGFyZW50IHJlcXVlc3QuXG4gKiBAcHJvcGVydHkge1JldHVyblR5cGU8dHlwZW9mIHNldFRpbWVvdXQ+fSBbc2h1dGRvd25TaWduYWxUaW1lcl0gLSBEcmFpbmVkLXJldGlyZW1lbnQgZmFsbGJhY2sgc2lnbmFsIHRpbWVyLlxuICogQHByb3BlcnR5IHtSZXR1cm5UeXBlPHR5cGVvZiBzZXRUaW1lb3V0PiB8IG51bGx9IFt0aW1lb3V0U2lna2lsbFRpbWVyXSAtIFBlbmRpbmcgdGltZW91dCBTSUdLSUxMIHRpbWVyLlxuICogQHByb3BlcnR5IHtzdHJpbmd9IFt0aW1lb3V0Sm9iSWRdIC0gSm9iIHdob3NlIHRpbWVvdXQgaW5pdGlhdGVkIHRlcm1pbmF0aW9uLlxuICovXG4vKiogR3JhY2UgcGVyaW9kIGFmdGVyIFNJR1RFUk0gYmVmb3JlIGEgbGluZ2VyaW5nIHByb2Nlc3MgcnVubmVyIGlzIFNJR0tJTExlZC4gKi9cbmNvbnN0IEZPUktFRF9DSElMRF9TSUdLSUxMX0dSQUNFX01TID0gNTAwMFxuLyoqIFRpbWUgYSBkcmFpbmVkIHJldGlyZW1lbnQgZ2l2ZXMgdGhlIGNoaWxkIElQQyByZXF1ZXN0IHRvIGJlZ2luIHRlYXJkb3duIGJlZm9yZSBTSUdURVJNIGZhbGxiYWNrLiAqL1xuY29uc3QgUE9PTEVEX1JVTk5FUl9TSFVURE9XTl9SRVFVRVNUX0dSQUNFX01TID0gMjUwXG4vKipcbiAqIExhcmdlc3QgZGVsYXkgTm9kZSdzIGBzZXRUaW1lb3V0YCBhY2NlcHRzIHdpdGhvdXQgb3ZlcmZsb3dpbmcgdG8gYSAxbXMgZGVsYXlcbiAqIChhIDMyLWJpdCBzaWduZWQgaW50IG9mIG1zLCB+MjQuOCBkYXlzKS4gQSBgam9iVGltZW91dE1zYCBhYm92ZSB0aGlzIOKAlCBvciBhXG4gKiBub24tZmluaXRlIG9uZSBsaWtlIGBJbmZpbml0eWAg4oCUIGlzIGNsYW1wZWQvZGlzYWJsZWQgcmF0aGVyIHRoYW4gY29lcmNlZCB0b1xuICogfjFtcywgd2hpY2ggd291bGQgb3RoZXJ3aXNlIHRlcm1pbmF0ZSBldmVyeSBmb3JrZWQgam9iIGFsbW9zdCBpbW1lZGlhdGVseS5cbiAqL1xuY29uc3QgTUFYX0ZPUktFRF9KT0JfVElNRU9VVF9NUyA9IDJfMTQ3XzQ4M182NDdcbmNvbnN0IEZPUktFRF9SVU5ORVJfRU5UUllfUEFUSCA9IGZpbGVVUkxUb1BhdGgobmV3IFVSTChcIi4vZm9ya2VkLXJ1bm5lci1jaGlsZC5qc1wiLCBpbXBvcnQubWV0YS51cmwpKVxuY29uc3QgUE9PTEVEX1JVTk5FUl9FTlRSWV9QQVRIID0gZmlsZVVSTFRvUGF0aChuZXcgVVJMKFwiLi9wb29sZWQtcnVubmVyLWNoaWxkLmpzXCIsIGltcG9ydC5tZXRhLnVybCkpXG4vKiogSG93IG9mdGVuIHRoZSB3b3JrZXIgc2VuZHMgYSBsaXZlbmVzcyBoZWFydGJlYXQgdG8gdGhlIG1haW4uICovXG5jb25zdCBIRUFSVEJFQVRfSU5URVJWQUxfTVMgPSAxNTAwMFxuLyoqXG4gKiBNYXggdGltZSB0aGUgd29ya2VyIHNwZW5kcyByZXRyeWluZyBvbmUgcG9vbGVkIGNoaWxkJ3MgYWNjZXB0YW5jZSByZXBvcnRcbiAqIGJlZm9yZSBkcm9wcGluZyBpdC4gQWNjZXB0YW5jZSBldmlkZW5jZSBpcyBkaWFnbm9zdGljIOKAlCBhIHBlcnNpc3RlbnRcbiAqIG1haW4vREIgb3V0YWdlIG11c3Qgbm90IGhvbGQgcnVubmVyIGNhcGFjaXR5IGhvc3RhZ2UuXG4gKi9cbmNvbnN0IENISUxEX0FDQ0VQVEFOQ0VfUkVQT1JUX01BWF9EVVJBVElPTl9NUyA9IDEwMDAwXG4vKiogVENQIGtlZXBhbGl2ZSBzbyBhIGhhbGYtb3BlbiBjb25uZWN0aW9uIHRvIHRoZSBtYWluIHN1cmZhY2VzIGFzIGEgY2xvc2UuICovXG5jb25zdCBTT0NLRVRfS0VFUEFMSVZFX01TID0gMTAwMDBcbi8qKlxuICogRXhlY3V0aW9uIG1vZGVzLlxuICogQHR5cGUge2ltcG9ydChcIi4vdHlwZXMuanNcIikuQmFja2dyb3VuZEpvYkV4ZWN1dGlvbk1vZGVbXX0gKi9cbmNvbnN0IEVYRUNVVElPTl9NT0RFUyA9IFtcImlubGluZVwiLCBcImZvcmtlZFwiLCBcInBvb2xlZFwiLCBcInNwYXduZWRcIl1cblxuLyoqXG4gKiBOb3JtYWxpemVzIGEgY2FuZGlkYXRlIHBvb2xlZC1ydW5uZXIgY291bnQgb3Igam9iIGxpbWl0LlxuICogQHBhcmFtIHtudW1iZXIgfCB1bmRlZmluZWR9IHZhbHVlIC0gQ2FuZGlkYXRlIHBvc2l0aXZlIGludGVnZXIuXG4gKiBAcmV0dXJucyB7bnVtYmVyIHwgdW5kZWZpbmVkfSAtIE5vcm1hbGl6ZWQgdmFsdWUuXG4gKi9cbmZ1bmN0aW9uIHBvc2l0aXZlSW50ZWdlcih2YWx1ZSkge1xuICByZXR1cm4gdHlwZW9mIHZhbHVlID09PSBcIm51bWJlclwiICYmIE51bWJlci5pc0ludGVnZXIodmFsdWUpICYmIHZhbHVlID4gMCA/IHZhbHVlIDogdW5kZWZpbmVkXG59XG5cbi8qKlxuICogQ2hlY2tzIHdoZXRoZXIgYW4gSVBDIHZhbHVlIGlzIGEgcG9vbGVkIGNoaWxkJ3MgYWNjZXB0YW5jZSBvYnNlcnZhdGlvbiBmb3JcbiAqIG9uZSBqb2IuIFRoZSBjaGlsZCBjYXJyaWVzIGl0cyBleGFjdCBoYW5kb2ZmIGxlYXNlIHNvIHRoZSB3b3JrZXIgY2FuIGZvcndhcmRcbiAqIHRoZSByZXBvcnQgd2l0aG91dCBkZXBlbmRpbmcgb24gaXRzIGluLWZsaWdodCBlbnRyeSBzdGlsbCBleGlzdGluZy5cbiAqIEBwYXJhbSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59IG1lc3NhZ2UgLSBJUEMgbWVzc2FnZS5cbiAqIEByZXR1cm5zIHttZXNzYWdlIGlzIHt0eXBlOiBcImpvYi1yZWNlaXZlZFwiIHwgXCJqb2Itc3RhcnRlZFwiLCBqb2JJZDogc3RyaW5nLCBoYW5kb2ZmSWQ/OiBzdHJpbmcsIHdvcmtlcklkPzogc3RyaW5nLCBoYW5kZWRPZmZBdE1zPzogbnVtYmVyLCByZWNlaXZlZEF0TXM/OiBudW1iZXIsIHN0YXJ0ZWRBdE1zPzogbnVtYmVyLCBjaGlsZEluc3RhbmNlSWQ/OiBzdHJpbmcsIGNoaWxkUGlkPzogbnVtYmVyLCBydW5uZXJIb3N0bmFtZT86IHN0cmluZ319IC0gV2hldGhlciB0aGlzIGlzIGEgdmFsaWQgYWNjZXB0YW5jZSBtZXNzYWdlLlxuICovXG5mdW5jdGlvbiBpc0NoaWxkQWNjZXB0YW5jZU1lc3NhZ2UobWVzc2FnZSkge1xuICBpZiAoIW1lc3NhZ2UgfHwgdHlwZW9mIG1lc3NhZ2UgIT09IFwib2JqZWN0XCIpIHJldHVybiBmYWxzZVxuICBjb25zdCByZWNvcmQgPSAvKiogQHR5cGUge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gKi8gKG1lc3NhZ2UpXG5cbiAgcmV0dXJuIChyZWNvcmQudHlwZSA9PT0gXCJqb2ItcmVjZWl2ZWRcIiB8fCByZWNvcmQudHlwZSA9PT0gXCJqb2Itc3RhcnRlZFwiKVxuICAgICYmIHR5cGVvZiByZWNvcmQuam9iSWQgPT09IFwic3RyaW5nXCJcbiAgICAmJiAocmVjb3JkLmhhbmRvZmZJZCA9PT0gdW5kZWZpbmVkIHx8IHR5cGVvZiByZWNvcmQuaGFuZG9mZklkID09PSBcInN0cmluZ1wiKVxuICAgICYmIChyZWNvcmQud29ya2VySWQgPT09IHVuZGVmaW5lZCB8fCB0eXBlb2YgcmVjb3JkLndvcmtlcklkID09PSBcInN0cmluZ1wiKVxuICAgICYmIChyZWNvcmQuaGFuZGVkT2ZmQXRNcyA9PT0gdW5kZWZpbmVkIHx8IHR5cGVvZiByZWNvcmQuaGFuZGVkT2ZmQXRNcyA9PT0gXCJudW1iZXJcIilcbiAgICAmJiAocmVjb3JkLnJlY2VpdmVkQXRNcyA9PT0gdW5kZWZpbmVkIHx8IHR5cGVvZiByZWNvcmQucmVjZWl2ZWRBdE1zID09PSBcIm51bWJlclwiKVxuICAgICYmIChyZWNvcmQuc3RhcnRlZEF0TXMgPT09IHVuZGVmaW5lZCB8fCB0eXBlb2YgcmVjb3JkLnN0YXJ0ZWRBdE1zID09PSBcIm51bWJlclwiKVxuICAgICYmIChyZWNvcmQuY2hpbGRJbnN0YW5jZUlkID09PSB1bmRlZmluZWQgfHwgdHlwZW9mIHJlY29yZC5jaGlsZEluc3RhbmNlSWQgPT09IFwic3RyaW5nXCIpXG4gICAgJiYgKHJlY29yZC5jaGlsZFBpZCA9PT0gdW5kZWZpbmVkIHx8IE51bWJlci5pc0ludGVnZXIocmVjb3JkLmNoaWxkUGlkKSlcbiAgICAmJiAocmVjb3JkLnJ1bm5lckhvc3RuYW1lID09PSB1bmRlZmluZWQgfHwgdHlwZW9mIHJlY29yZC5ydW5uZXJIb3N0bmFtZSA9PT0gXCJzdHJpbmdcIilcbn1cblxuLyoqXG4gKiBDaGVja3Mgd2hldGhlciBhbiBJUEMgdmFsdWUgaXMgdGhlIGNoaWxkJ3MgYm91bmRlZCBwcmUtdGVhcmRvd24gb2JzZXJ2YXRpb24uXG4gKiBAcGFyYW0ge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSBtZXNzYWdlIC0gSVBDIG1lc3NhZ2UuXG4gKiBAcmV0dXJucyB7bWVzc2FnZSBpcyBpbXBvcnQoXCIuL3R5cGVzLmpzXCIpLlBvb2xlZENoaWxkU2h1dGRvd25PYnNlcnZhdGlvbiAmIHt0eXBlOiBcInNodXRkb3duLW9ic2VydmF0aW9uXCJ9fSAtIFdoZXRoZXIgdGhpcyBpcyBhIHZhbGlkIHNodXRkb3duIG9ic2VydmF0aW9uLlxuICovXG5mdW5jdGlvbiBpc0NoaWxkU2h1dGRvd25PYnNlcnZhdGlvbk1lc3NhZ2UobWVzc2FnZSkge1xuICBpZiAoIW1lc3NhZ2UgfHwgdHlwZW9mIG1lc3NhZ2UgIT09IFwib2JqZWN0XCIpIHJldHVybiBmYWxzZVxuICBjb25zdCByZWNvcmQgPSAvKiogQHR5cGUge3tjaGlsZEluc3RhbmNlSWQ/OiBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPiwgaW5mbGlnaHRKb2JJZHM/OiBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPiwgaW5mbGlnaHRKb2JJZHNUcnVuY2F0ZWRDb3VudD86IFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+LCByZWFzb24/OiBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPiwgc2h1dGRvd25PYnNlcnZlZEF0TXM/OiBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPiwgc2h1dGRvd25SZXF1ZXN0ZWRBdE1zPzogUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4sIHNpZ25hbD86IFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+LCB0eXBlPzogUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59fSAqLyAobWVzc2FnZSlcblxuICByZXR1cm4gcmVjb3JkLnR5cGUgPT09IFwic2h1dGRvd24tb2JzZXJ2YXRpb25cIlxuICAgICYmIHR5cGVvZiByZWNvcmQuY2hpbGRJbnN0YW5jZUlkID09PSBcInN0cmluZ1wiXG4gICAgJiYgQXJyYXkuaXNBcnJheShyZWNvcmQuaW5mbGlnaHRKb2JJZHMpXG4gICAgJiYgcmVjb3JkLmluZmxpZ2h0Sm9iSWRzLmxlbmd0aCA8PSBQT09MRURfUlVOTkVSX0lORkxJR0hUX0pPQl9JRF9MSU1JVFxuICAgICYmIHJlY29yZC5pbmZsaWdodEpvYklkcy5ldmVyeSgoam9iSWQpID0+IHR5cGVvZiBqb2JJZCA9PT0gXCJzdHJpbmdcIilcbiAgICAmJiBOdW1iZXIuaXNJbnRlZ2VyKHJlY29yZC5pbmZsaWdodEpvYklkc1RydW5jYXRlZENvdW50KVxuICAgICYmIHJlY29yZC5pbmZsaWdodEpvYklkc1RydW5jYXRlZENvdW50ID49IDBcbiAgICAmJiBpc1Bvb2xlZENoaWxkU2h1dGRvd25SZWFzb24ocmVjb3JkLnJlYXNvbilcbiAgICAmJiB0eXBlb2YgcmVjb3JkLnNodXRkb3duT2JzZXJ2ZWRBdE1zID09PSBcIm51bWJlclwiXG4gICAgJiYgTnVtYmVyLmlzRmluaXRlKHJlY29yZC5zaHV0ZG93bk9ic2VydmVkQXRNcylcbiAgICAmJiAocmVjb3JkLnNodXRkb3duUmVxdWVzdGVkQXRNcyA9PT0gbnVsbCB8fCAodHlwZW9mIHJlY29yZC5zaHV0ZG93blJlcXVlc3RlZEF0TXMgPT09IFwibnVtYmVyXCIgJiYgTnVtYmVyLmlzRmluaXRlKHJlY29yZC5zaHV0ZG93blJlcXVlc3RlZEF0TXMpKSlcbiAgICAmJiBpc1Bvb2xlZENoaWxkU2h1dGRvd25TaWduYWwocmVjb3JkLnNpZ25hbClcbn1cblxuLyoqXG4gKiBDaGVja3Mgd2hldGhlciBhbiBJUEMgdmFsdWUgaXMgYSBwb29sZWQgY2hpbGQncyBib3VuZGVkIG1lbW9yeSBvYnNlcnZhdGlvbi5cbiAqIFRoZSBwb29sZWQgY2hpbGQncyBzdGRpbyBpcyBpZ25vcmVkIGJ5IHRoZSB3b3JrZXIgZm9yaywgc28gdGhpcyBvYnNlcnZhdGlvblxuICogKHBlcmlvZGljIHdoaWxlIGpvYnMgcnVuLCBwbHVzIG9uIGRlbWFuZCkgaXMgaG93IGEgbWVtb3J5IHByb2JsZW0gaW4gYVxuICogcnVubmluZyBjaGlsZCBuYW1lcyBpdHNlbGYuIFRoZSB3b3JrZXIgbG9ncyBpdCAoaXRzIHN0ZGVyciByZWFjaGVzIHRoZSBwcm9kXG4gKiBsb2cpIGFuZCBmb3J3YXJkcyBpdCB0byB0aGUgb3B0aW9uYWwgYG9uUG9vbGVkUnVubmVyTWVtb3J5T2JzZXJ2YXRpb25gIGhvb2suXG4gKiBAcGFyYW0ge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSBtZXNzYWdlIC0gSVBDIG1lc3NhZ2UuXG4gKiBAcmV0dXJucyB7bWVzc2FnZSBpcyBpbXBvcnQoXCIuL3R5cGVzLmpzXCIpLlBvb2xlZENoaWxkTWVtb3J5T2JzZXJ2YXRpb259IC0gV2hldGhlciB0aGlzIGlzIGEgdmFsaWQgbWVtb3J5IG9ic2VydmF0aW9uLlxuICovXG5mdW5jdGlvbiBpc1Bvb2xlZENoaWxkTWVtb3J5T2JzZXJ2YXRpb25NZXNzYWdlKG1lc3NhZ2UpIHtcbiAgaWYgKCFtZXNzYWdlIHx8IHR5cGVvZiBtZXNzYWdlICE9PSBcIm9iamVjdFwiKSByZXR1cm4gZmFsc2VcbiAgY29uc3QgcmVjb3JkID0gLyoqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59ICovIChtZXNzYWdlKVxuICBjb25zdCBoZWFwU3RhdGlzdGljcyA9IC8qKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+IHwgdW5kZWZpbmVkfSAqLyAocmVjb3JkLmhlYXBTdGF0aXN0aWNzKVxuICBjb25zdCBtZW1vcnlVc2FnZSA9IC8qKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+IHwgdW5kZWZpbmVkfSAqLyAocmVjb3JkLm1lbW9yeVVzYWdlKVxuXG4gIHJldHVybiByZWNvcmQudHlwZSA9PT0gXCJwb29sZWQtY2hpbGQtbWVtb3J5XCJcbiAgICAmJiB0eXBlb2YgcmVjb3JkLmNoaWxkSW5zdGFuY2VJZCA9PT0gXCJzdHJpbmdcIlxuICAgICYmIE51bWJlci5pc0ludGVnZXIocmVjb3JkLmNoaWxkUGlkKVxuICAgICYmIHR5cGVvZiByZWNvcmQucnNzQnl0ZXMgPT09IFwibnVtYmVyXCJcbiAgICAmJiBOdW1iZXIuaXNGaW5pdGUocmVjb3JkLnJzc0J5dGVzKVxuICAgICYmIE51bWJlci5pc0ludGVnZXIocmVjb3JkLmpvYkNvdW50KVxuICAgICYmIHJlY29yZC5qb2JDb3VudCA+PSAwXG4gICAgJiYgQXJyYXkuaXNBcnJheShyZWNvcmQuYWN0aXZlSm9iSWRzKVxuICAgICYmIHJlY29yZC5hY3RpdmVKb2JJZHMuZXZlcnkoKGpvYklkKSA9PiB0eXBlb2Ygam9iSWQgPT09IFwic3RyaW5nXCIpXG4gICAgJiYgTnVtYmVyLmlzSW50ZWdlcihyZWNvcmQuYWN0aXZlSm9iSWRzVHJ1bmNhdGVkQ291bnQpXG4gICAgJiYgcmVjb3JkLmFjdGl2ZUpvYklkc1RydW5jYXRlZENvdW50ID49IDBcbiAgICAmJiB0eXBlb2YgcmVjb3JkLm9ic2VydmVkQXRNcyA9PT0gXCJudW1iZXJcIlxuICAgICYmIE51bWJlci5pc0Zpbml0ZShyZWNvcmQub2JzZXJ2ZWRBdE1zKVxuICAgICYmIGhlYXBTdGF0aXN0aWNzICE9PSB1bmRlZmluZWQgJiYgdHlwZW9mIGhlYXBTdGF0aXN0aWNzID09PSBcIm9iamVjdFwiXG4gICAgJiYgbWVtb3J5VXNhZ2UgIT09IHVuZGVmaW5lZCAmJiB0eXBlb2YgbWVtb3J5VXNhZ2UgPT09IFwib2JqZWN0XCJcbn1cblxuLyoqXG4gKiBOb3JtYWxpemVzIGEgY2FuZGlkYXRlIHBvb2xlZC1ydW5uZXIgcmVzb3VyY2UgbGltaXQuXG4gKiBAcGFyYW0ge251bWJlciB8IHVuZGVmaW5lZH0gdmFsdWUgLSBDYW5kaWRhdGUgcG9zaXRpdmUgbnVtYmVyLlxuICogQHJldHVybnMge251bWJlciB8IHVuZGVmaW5lZH0gLSBOb3JtYWxpemVkIHZhbHVlLlxuICovXG5mdW5jdGlvbiBwb3NpdGl2ZU51bWJlcih2YWx1ZSkge1xuICByZXR1cm4gdHlwZW9mIHZhbHVlID09PSBcIm51bWJlclwiICYmIE51bWJlci5pc0Zpbml0ZSh2YWx1ZSkgJiYgdmFsdWUgPiAwID8gdmFsdWUgOiB1bmRlZmluZWRcbn1cblxuZXhwb3J0IGRlZmF1bHQgY2xhc3MgQmFja2dyb3VuZEpvYnNXb3JrZXIge1xuICAvKipcbiAgICogUnVucyBjb25zdHJ1Y3Rvci5cbiAgICogQHBhcmFtIHtvYmplY3R9IFthcmdzXSAtIE9wdGlvbnMuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vY29uZmlndXJhdGlvbi5qc1wiKS5kZWZhdWx0fSBbYXJncy5jb25maWd1cmF0aW9uXSAtIENvbmZpZ3VyYXRpb24uXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBbYXJncy5ob3N0XSAtIEhvc3RuYW1lLlxuICAgKiBAcGFyYW0ge251bWJlcn0gW2FyZ3MucG9ydF0gLSBQb3J0LlxuICAgKiBAcGFyYW0ge3N0cmluZ30gW2FyZ3MuZ2VuZXJhdGlvbklkXSAtIEV4cGxpY2l0IHJlbGVhc2UgZ2VuZXJhdGlvbiBpZGVudGl0eS5cbiAgICogQHBhcmFtIHtzdHJpbmd9IFthcmdzLndvcmtlckluc3RhbmNlSWRdIC0gRXhwbGljaXQgc3RhYmxlIHdvcmtlciBVVUlELlxuICAgKiBAcGFyYW0ge251bWJlcn0gW2FyZ3MubWF4Q29uY3VycmVudEZvcmtlZEpvYnNdIC0gT3ZlcnJpZGUgdGhlIHByb2Nlc3MgcnVubmVyIGNvbmN1cnJlbmN5IGNhcCBmcm9tIGBjb25maWd1cmF0aW9uLmdldEJhY2tncm91bmRKb2JzQ29uZmlnKClgLlxuICAgKiBAcGFyYW0ge251bWJlcn0gW2FyZ3MubWF4Q29uY3VycmVudElubGluZUpvYnNdIC0gT3ZlcnJpZGUgdGhlIGlubGluZS1qb2IgY29uY3VycmVuY3kgY2FwIGZyb20gYGNvbmZpZ3VyYXRpb24uZ2V0QmFja2dyb3VuZEpvYnNDb25maWcoKWAuXG4gICAqIEBwYXJhbSB7bnVtYmVyfSBbYXJncy5wb29sZWRSdW5uZXJDb3VudF0gLSBPdmVycmlkZSB0aGUgcG9vbGVkIHJ1bm5lciBjb3VudC5cbiAgICogQHBhcmFtIHtudW1iZXJ9IFthcmdzLnBvb2xlZFJ1bm5lckNvbmN1cnJlbmN5XSAtIE92ZXJyaWRlIHRoZSBwZXItcnVubmVyIGNvbmN1cnJlbmN5LlxuICAgKiBAcGFyYW0ge251bWJlcn0gW2FyZ3MucG9vbGVkUnVubmVyTWF4Sm9ic10gLSBPdmVycmlkZSB0aGUgcGVyLXJ1bm5lciByZWN5Y2xlIGpvYiBjb3VudC5cbiAgICogQHBhcmFtIHtudW1iZXJ9IFthcmdzLnBvb2xlZFJ1bm5lck1heFJzc0J5dGVzXSAtIE92ZXJyaWRlIHRoZSBwZXItcnVubmVyIHJlY3ljbGUgUlNTIGxpbWl0LlxuICAgKiBAcGFyYW0ge251bWJlcn0gW2FyZ3MucG9vbGVkUnVubmVyTWF4TGlmZXRpbWVNc10gLSBPdmVycmlkZSB0aGUgcGVyLXJ1bm5lciByZWN5Y2xlIGxpZmV0aW1lLlxuICAgKiBAcGFyYW0ge251bWJlcn0gW2FyZ3MucnVubmVyTWF4T2xkU3BhY2VTaXplTWJdIC0gT3ZlcnJpZGUgdGhlIFY4IGhlYXAgY2FwIChNaUIsIGAtLW1heC1vbGQtc3BhY2Utc2l6ZWApIGFwcGxpZWQgdG8gcnVubmVyIGNoaWxkcmVuLlxuICAgKiBAcGFyYW0ge251bWJlcn0gW2FyZ3MucnVubmVyTWFsbG9jQXJlbmFNYXhdIC0gT3ZlcnJpZGUgYE1BTExPQ19BUkVOQV9NQVhgIGZvciBydW5uZXIgY2hpbGRyZW4uXG4gICAqIEBwYXJhbSB7bnVtYmVyfSBbYXJncy5mb3JrZWRDaGlsZFNpZ2tpbGxHcmFjZU1zXSAtIE92ZXJyaWRlIHRoZSBncmFjZSBwZXJpb2QgYmV0d2VlbiBTSUdURVJNIGFuZCBTSUdLSUxMIHdoZW4gcmVhcGluZyBsaW5nZXJpbmcgcHJvY2VzcyBydW5uZXJzIG9uIHN0b3AuXG4gICAqIEBwYXJhbSB7bnVtYmVyfSBbYXJncy5oZWFydGJlYXRJbnRlcnZhbE1zXSAtIE92ZXJyaWRlIHRoZSBsaXZlbmVzcyBoZWFydGJlYXQgaW50ZXJ2YWwgKGRlZmF1bHQgMTUwMDBtcykuXG4gICAqIEBwYXJhbSB7bnVtYmVyfSBbYXJncy5nZW5lcmF0aW9uSGFuZHNoYWtlVGltZW91dE1zXSAtIE1heGltdW0gdGltZSB0byB3YWl0IGZvciBnZW5lcmF0aW9uIGFja25vd2xlZGdlbWVudCAoZGVmYXVsdDogNDAwMCkuXG4gICAqIEBwYXJhbSB7bnVtYmVyfSBbYXJncy5yZWNvbm5lY3REZWxheU1zXSAtIERlbGF5IGJlZm9yZSByZWNvbm5lY3RpbmcgYW4gZXN0YWJsaXNoZWQgd29ya2VyIGNvbm5lY3Rpb24gKGRlZmF1bHQ6IDEwMDApLlxuICAgKiBAcGFyYW0ge251bWJlcn0gW2FyZ3Muam9iVGltZW91dE1zXSAtIE92ZXJyaWRlIHRoZSB3YWxsLWNsb2NrIHRpbWVvdXQgZm9yIGZvcmtlZCBhbmQgcG9vbGVkIGpvYnMgZnJvbSBgY29uZmlndXJhdGlvbi5nZXRCYWNrZ3JvdW5kSm9ic0NvbmZpZygpYC4gYDBgIGRpc2FibGVzIGl0LlxuICAgKiBAcGFyYW0ge2Jvb2xlYW59IFthcmdzLmNsb3NlRGF0YWJhc2VDb25uZWN0aW9uc09uU3RvcF0gLSBXaGV0aGVyIHN0b3Agb3ducyBjbG9zaW5nIHRoZSBjb25maWd1cmF0aW9uJ3MgZGF0YWJhc2UgcG9vbHMgKGRlZmF1bHQgdHJ1ZSkuXG4gICAqIEBwYXJhbSB7KCkgPT4gdm9pZCB8IFByb21pc2U8dm9pZD59IFthcmdzLm9uU3RvcHBlZF0gLSBMaWZlY3ljbGUgaG9vayBpbnZva2VkIGFmdGVyIHRoZSB3b3JrZXIgZmluaXNoZXMgc3RvcHBpbmcuXG4gICAqIEBwYXJhbSB7KCkgPT4gdm9pZH0gW2FyZ3Mub25HZW5lcmF0aW9uQWNjZXB0ZWRdIC0gRXhwbGljaXQgZ2VuZXJhdGlvbi1hY2NlcHRhbmNlIG9ic2VydmF0aW9uIGhvb2suXG4gICAqIEBwYXJhbSB7KCkgPT4gdm9pZH0gW2FyZ3Mub25SZXRpcmVNZXNzYWdlXSAtIEV4cGxpY2l0IHJldGlyZS1tZXNzYWdlIG9ic2VydmF0aW9uIGhvb2suXG4gICAqIEBwYXJhbSB7KG9ic2VydmF0aW9uOiBpbXBvcnQoXCIuL3R5cGVzLmpzXCIpLlBvb2xlZENoaWxkTWVtb3J5T2JzZXJ2YXRpb24pID0+IHZvaWQgfCBQcm9taXNlPHZvaWQ+fSBbYXJncy5vblBvb2xlZFJ1bm5lck1lbW9yeU9ic2VydmF0aW9uXSAtIEV4cGxpY2l0IHBvb2xlZC1jaGlsZCBtZW1vcnkgb2JzZXJ2YXRpb24gaG9vay4gRXZlcnkgdmFsaWRhdGVkIG9ic2VydmF0aW9uIChwZXJpb2RpYyB3aGlsZSBhIGNoaWxkIGhhcyBpbi1mbGlnaHQgam9icywgcGx1cyBvbiBkZW1hbmQpIGlzIGZvcndhcmRlZCBoZXJlLCBpbiBhZGRpdGlvbiB0byB0aGUgd29ya2VyJ3MgY29tcGFjdCBzdGRlcnIgbG9nIGxpbmUsIHNvIGFuIGFwcGxpY2F0aW9uIGNhbiByb3V0ZSBtZW1vcnkgZGlhZ25vc3RpY3MgKGUuZy4gdG8gYSBidWcgcmVwb3J0ZXIpIHdpdGhvdXQgcGFyc2luZyBsb2dzLlxuICAgKi9cbiAgY29uc3RydWN0b3Ioe2NvbmZpZ3VyYXRpb24sIGhvc3QsIHBvcnQsIGdlbmVyYXRpb25JZCwgd29ya2VySW5zdGFuY2VJZCwgbWF4Q29uY3VycmVudEZvcmtlZEpvYnMsIG1heENvbmN1cnJlbnRJbmxpbmVKb2JzLCBwb29sZWRSdW5uZXJDb3VudCwgcG9vbGVkUnVubmVyQ29uY3VycmVuY3ksIHBvb2xlZFJ1bm5lck1heEpvYnMsIHBvb2xlZFJ1bm5lck1heFJzc0J5dGVzLCBwb29sZWRSdW5uZXJNYXhMaWZldGltZU1zLCBydW5uZXJNYXhPbGRTcGFjZVNpemVNYiwgcnVubmVyTWFsbG9jQXJlbmFNYXgsIGZvcmtlZENoaWxkU2lna2lsbEdyYWNlTXMsIGhlYXJ0YmVhdEludGVydmFsTXMsIGdlbmVyYXRpb25IYW5kc2hha2VUaW1lb3V0TXMgPSBERUZBVUxUX0dFTkVSQVRJT05fSEFORFNIQUtFX1RJTUVPVVRfTVMsIHJlY29ubmVjdERlbGF5TXMgPSAxMDAwLCBqb2JUaW1lb3V0TXMsIGNsb3NlRGF0YWJhc2VDb25uZWN0aW9uc09uU3RvcCA9IHRydWUsIG9uU3RvcHBlZCwgb25HZW5lcmF0aW9uQWNjZXB0ZWQsIG9uUmV0aXJlTWVzc2FnZSwgb25Qb29sZWRSdW5uZXJNZW1vcnlPYnNlcnZhdGlvbn0gPSB7fSkge1xuICAgIC8qKlxuICAgICAqIE5hcnJvd3MgdGhlIHJ1bnRpbWUgdmFsdWUgdG8gdGhlIGRvY3VtZW50ZWQgdHlwZS5cbiAgICAgKiBAdHlwZSB7UHJvbWlzZTxpbXBvcnQoXCIuLi9jb25maWd1cmF0aW9uLmpzXCIpLmRlZmF1bHQ+fSAqL1xuICAgIHRoaXMuY29uZmlndXJhdGlvblByb21pc2UgPSBjb25maWd1cmF0aW9uID8gUHJvbWlzZS5yZXNvbHZlKGNvbmZpZ3VyYXRpb24pIDogY29uZmlndXJhdGlvblJlc29sdmVyKClcbiAgICAvKipcbiAgICAgKiBOYXJyb3dzIHRoZSBydW50aW1lIHZhbHVlIHRvIHRoZSBkb2N1bWVudGVkIHR5cGUuXG4gICAgICogQHR5cGUge2ltcG9ydChcIi4uL2NvbmZpZ3VyYXRpb24uanNcIikuZGVmYXVsdCB8IHVuZGVmaW5lZH0gKi9cbiAgICB0aGlzLmNvbmZpZ3VyYXRpb24gPSB1bmRlZmluZWRcbiAgICB0aGlzLmhvc3QgPSBob3N0XG4gICAgdGhpcy5wb3J0ID0gcG9ydFxuICAgIHRoaXMuZXhwbGljaXRHZW5lcmF0aW9uSWQgPSBnZW5lcmF0aW9uSWRcbiAgICB0aGlzLndvcmtlckluc3RhbmNlSWQgPSB3b3JrZXJJbnN0YW5jZUlkIHx8IHJhbmRvbVVVSUQoKVxuICAgIC8qKiBAdHlwZSB7c3RyaW5nIHwgdW5kZWZpbmVkfSAqL1xuICAgIHRoaXMuZ2VuZXJhdGlvbklkID0gdW5kZWZpbmVkXG4gICAgdGhpcy5jbG9zZURhdGFiYXNlQ29ubmVjdGlvbnNPblN0b3AgPSBjbG9zZURhdGFiYXNlQ29ubmVjdGlvbnNPblN0b3BcbiAgICB0aGlzLm9uU3RvcHBlZCA9IG9uU3RvcHBlZFxuICAgIHRoaXMub25HZW5lcmF0aW9uQWNjZXB0ZWQgPSBvbkdlbmVyYXRpb25BY2NlcHRlZFxuICAgIHRoaXMub25SZXRpcmVNZXNzYWdlID0gb25SZXRpcmVNZXNzYWdlXG4gICAgdGhpcy5vblBvb2xlZFJ1bm5lck1lbW9yeU9ic2VydmF0aW9uID0gb25Qb29sZWRSdW5uZXJNZW1vcnlPYnNlcnZhdGlvblxuICAgIC8qKlxuICAgICAqIENvbnN0cnVjdG9yIG92ZXJyaWRlIGZvciB0aGUgaW5saW5lLWpvYiBjb25jdXJyZW5jeSBjYXAuIFdoZW4gdW5zZXRcbiAgICAgKiB0aGUgY2FwIGlzIHJlYWQgZnJvbSBgY29uZmlndXJhdGlvbi5nZXRCYWNrZ3JvdW5kSm9ic0NvbmZpZygpYCBpblxuICAgICAqIGBzdGFydCgpYCAoZGVmYXVsdDogNCkuXG4gICAgICogQHR5cGUge251bWJlciB8IHVuZGVmaW5lZH1cbiAgICAgKi9cbiAgICB0aGlzLm1heENvbmN1cnJlbnRJbmxpbmVKb2JzT3ZlcnJpZGUgPSB0eXBlb2YgbWF4Q29uY3VycmVudElubGluZUpvYnMgPT09IFwibnVtYmVyXCIgJiYgbWF4Q29uY3VycmVudElubGluZUpvYnMgPj0gMVxuICAgICAgPyBtYXhDb25jdXJyZW50SW5saW5lSm9ic1xuICAgICAgOiB1bmRlZmluZWRcbiAgICAvKipcbiAgICAgKiBOYXJyb3dzIHRoZSBydW50aW1lIHZhbHVlIHRvIHRoZSBkb2N1bWVudGVkIHR5cGUuXG4gICAgICogQHR5cGUge251bWJlciB8IHVuZGVmaW5lZH0gKi9cbiAgICB0aGlzLm1heENvbmN1cnJlbnRGb3JrZWRKb2JzT3ZlcnJpZGUgPSB0eXBlb2YgbWF4Q29uY3VycmVudEZvcmtlZEpvYnMgPT09IFwibnVtYmVyXCIgJiYgbWF4Q29uY3VycmVudEZvcmtlZEpvYnMgPj0gMVxuICAgICAgPyBtYXhDb25jdXJyZW50Rm9ya2VkSm9ic1xuICAgICAgOiB1bmRlZmluZWRcbiAgICAvKipcbiAgICAgKiBSZXNvbHZlZCBjYXAgZm9yIGlubGluZS1qb2IgY29uY3VycmVuY3kuIFNldCBpbiBgc3RhcnQoKWA7IGRlZmF1bHRzIHRvXG4gICAgICogNCBpZiBubyBjb25maWd1cmF0aW9uIHZhbHVlIGlzIGF2YWlsYWJsZS5cbiAgICAgKiBAdHlwZSB7bnVtYmVyfVxuICAgICAqL1xuICAgIHRoaXMubWF4Q29uY3VycmVudElubGluZUpvYnMgPSB0aGlzLm1heENvbmN1cnJlbnRJbmxpbmVKb2JzT3ZlcnJpZGUgfHwgNFxuICAgIC8qKlxuICAgICAqIE5hcnJvd3MgdGhlIHJ1bnRpbWUgdmFsdWUgdG8gdGhlIGRvY3VtZW50ZWQgdHlwZS5cbiAgICAgKiBAdHlwZSB7bnVtYmVyfSAqL1xuICAgIHRoaXMubWF4Q29uY3VycmVudEZvcmtlZEpvYnMgPSB0aGlzLm1heENvbmN1cnJlbnRGb3JrZWRKb2JzT3ZlcnJpZGUgfHwgNFxuICAgIHRoaXMucG9vbGVkUnVubmVyQ291bnRPdmVycmlkZSA9IHBvc2l0aXZlSW50ZWdlcihwb29sZWRSdW5uZXJDb3VudClcbiAgICB0aGlzLnBvb2xlZFJ1bm5lckNvbmN1cnJlbmN5T3ZlcnJpZGUgPSBwb3NpdGl2ZUludGVnZXIocG9vbGVkUnVubmVyQ29uY3VycmVuY3kpXG4gICAgdGhpcy5wb29sZWRSdW5uZXJNYXhKb2JzT3ZlcnJpZGUgPSBwb3NpdGl2ZUludGVnZXIocG9vbGVkUnVubmVyTWF4Sm9icylcbiAgICB0aGlzLnBvb2xlZFJ1bm5lck1heFJzc0J5dGVzT3ZlcnJpZGUgPSBwb3NpdGl2ZU51bWJlcihwb29sZWRSdW5uZXJNYXhSc3NCeXRlcylcbiAgICB0aGlzLnBvb2xlZFJ1bm5lck1heExpZmV0aW1lTXNPdmVycmlkZSA9IHBvc2l0aXZlTnVtYmVyKHBvb2xlZFJ1bm5lck1heExpZmV0aW1lTXMpXG4gICAgdGhpcy5ydW5uZXJNYXhPbGRTcGFjZVNpemVNYk92ZXJyaWRlID0gcG9zaXRpdmVJbnRlZ2VyKHJ1bm5lck1heE9sZFNwYWNlU2l6ZU1iKVxuICAgIHRoaXMucnVubmVyTWFsbG9jQXJlbmFNYXhPdmVycmlkZSA9IHBvc2l0aXZlSW50ZWdlcihydW5uZXJNYWxsb2NBcmVuYU1heClcbiAgICB0aGlzLnBvb2xlZFJ1bm5lckNvdW50ID0gdGhpcy5wb29sZWRSdW5uZXJDb3VudE92ZXJyaWRlIHx8IDRcbiAgICB0aGlzLnBvb2xlZFJ1bm5lckNvbmN1cnJlbmN5ID0gdGhpcy5wb29sZWRSdW5uZXJDb25jdXJyZW5jeU92ZXJyaWRlIHx8IDFcbiAgICB0aGlzLnBvb2xlZFJ1bm5lck1heEpvYnMgPSB0aGlzLnBvb2xlZFJ1bm5lck1heEpvYnNPdmVycmlkZSB8fCAxMDBcbiAgICB0aGlzLnBvb2xlZFJ1bm5lck1heFJzc0J5dGVzID0gdGhpcy5wb29sZWRSdW5uZXJNYXhSc3NCeXRlc092ZXJyaWRlIHx8IDUxMiAqIDEwMjQgKiAxMDI0XG4gICAgdGhpcy5wb29sZWRSdW5uZXJNYXhMaWZldGltZU1zID0gdGhpcy5wb29sZWRSdW5uZXJNYXhMaWZldGltZU1zT3ZlcnJpZGUgfHwgNjAgKiA2MCAqIDEwMDBcbiAgICB0aGlzLnJ1bm5lck1heE9sZFNwYWNlU2l6ZU1iID0gdGhpcy5ydW5uZXJNYXhPbGRTcGFjZVNpemVNYk92ZXJyaWRlIHx8IDIwNDhcbiAgICB0aGlzLnJ1bm5lck1hbGxvY0FyZW5hTWF4ID0gdGhpcy5ydW5uZXJNYWxsb2NBcmVuYU1heE92ZXJyaWRlIHx8IDRcbiAgICAvKipcbiAgICAgKiBHcmFjZSBwZXJpb2QgYmV0d2VlbiBTSUdURVJNIGFuZCBTSUdLSUxMIHdoZW4gcmVhcGluZyBwcm9jZXNzIHJ1bm5lcnMgdGhhdFxuICAgICAqIG91dGxhc3QgYSBib3VuZGVkIHNodXRkb3duIGRyYWluLlxuICAgICAqIEB0eXBlIHtudW1iZXJ9XG4gICAgICovXG4gICAgdGhpcy5mb3JrZWRDaGlsZFNpZ2tpbGxHcmFjZU1zID0gdHlwZW9mIGZvcmtlZENoaWxkU2lna2lsbEdyYWNlTXMgPT09IFwibnVtYmVyXCIgJiYgZm9ya2VkQ2hpbGRTaWdraWxsR3JhY2VNcyA+PSAwXG4gICAgICA/IGZvcmtlZENoaWxkU2lna2lsbEdyYWNlTXNcbiAgICAgIDogRk9SS0VEX0NISUxEX1NJR0tJTExfR1JBQ0VfTVNcbiAgICAvKipcbiAgICAgKiBDb25zdHJ1Y3RvciBvdmVycmlkZSBmb3IgdGhlIGZvcmtlZCBhbmQgcG9vbGVkIHdhbGwtY2xvY2sgam9iIHRpbWVvdXQuIFdoZW4gdW5zZXQgdGhlXG4gICAgICogdGltZW91dCBpcyByZWFkIGZyb20gYGNvbmZpZ3VyYXRpb24uZ2V0QmFja2dyb3VuZEpvYnNDb25maWcoKS5qb2JUaW1lb3V0TXNgXG4gICAgICogYXQgZm9yayB0aW1lIChkZWZhdWx0OiBkaXNhYmxlZCkuXG4gICAgICogQHR5cGUge251bWJlciB8IHVuZGVmaW5lZH1cbiAgICAgKi9cbiAgICB0aGlzLmpvYlRpbWVvdXRNc092ZXJyaWRlID0gdHlwZW9mIGpvYlRpbWVvdXRNcyA9PT0gXCJudW1iZXJcIiA/IGpvYlRpbWVvdXRNcyA6IHVuZGVmaW5lZFxuICAgIHRoaXMuc2hvdWxkU3RvcCA9IGZhbHNlXG4gICAgdGhpcy5pc1JldGlyaW5nID0gZmFsc2VcbiAgICAvKiogQHR5cGUge1Byb21pc2U8dm9pZD4gfCB1bmRlZmluZWR9ICovXG4gICAgdGhpcy5zdG9wUHJvbWlzZSA9IHVuZGVmaW5lZFxuICAgIC8qKlxuICAgICAqIFJlc29sdmVzIHN0b3Agb2JzZXJ2YXRpb24uXG4gICAgICogQHR5cGUgeyh2YWx1ZT86IHZvaWQpID0+IHZvaWR9XG4gICAgICovXG4gICAgdGhpcy5fcmVzb2x2ZVN0b3BwZWQgPSAoKSA9PiB7fVxuICAgIC8qKlxuICAgICAqIFJlamVjdHMgc3RvcCBvYnNlcnZhdGlvbi5cbiAgICAgKiBAdHlwZSB7KGVycm9yOiBFcnJvcikgPT4gdm9pZH1cbiAgICAgKi9cbiAgICB0aGlzLl9yZWplY3RTdG9wcGVkID0gKCkgPT4ge31cbiAgICAvKiogQHR5cGUge1Byb21pc2U8dm9pZD59ICovXG4gICAgdGhpcy5fc3RvcHBlZFByb21pc2UgPSBQcm9taXNlLnJlc29sdmUoKVxuICAgIHRoaXMuX3Jlc2V0U3RvcHBlZFByb21pc2UoKVxuICAgIHRoaXMud29ya2VySWQgPSB0aGlzLndvcmtlckluc3RhbmNlSWRcbiAgICB0aGlzLl9nZW5lcmF0aW9uQWNjZXB0ZWQgPSBmYWxzZVxuICAgIHRoaXMuZ2VuZXJhdGlvbkhhbmRzaGFrZVRpbWVvdXRNcyA9IHZhbGlkYXRlR2VuZXJhdGlvbkhhbmRzaGFrZVRpbWVvdXRNcyhnZW5lcmF0aW9uSGFuZHNoYWtlVGltZW91dE1zKVxuICAgIGlmICghTnVtYmVyLmlzSW50ZWdlcihyZWNvbm5lY3REZWxheU1zKSB8fCByZWNvbm5lY3REZWxheU1zIDwgMCB8fCByZWNvbm5lY3REZWxheU1zID4gTUFYX0ZPUktFRF9KT0JfVElNRU9VVF9NUykge1xuICAgICAgdGhyb3cgbmV3IFR5cGVFcnJvcihcInJlY29ubmVjdERlbGF5TXMgbXVzdCBiZSBhbiBpbnRlZ2VyIGJldHdlZW4gMCBhbmQgMjE0NzQ4MzY0N1wiKVxuICAgIH1cbiAgICB0aGlzLnJlY29ubmVjdERlbGF5TXMgPSByZWNvbm5lY3REZWxheU1zXG4gICAgLyoqIEB0eXBlIHtSZXR1cm5UeXBlPHR5cGVvZiBzZXRUaW1lb3V0PiB8IHVuZGVmaW5lZH0gKi9cbiAgICB0aGlzLl9yZWNvbm5lY3RUaW1lciA9IHVuZGVmaW5lZFxuICAgIHRoaXMuaGVhcnRiZWF0SW50ZXJ2YWxNcyA9IHR5cGVvZiBoZWFydGJlYXRJbnRlcnZhbE1zID09PSBcIm51bWJlclwiICYmIGhlYXJ0YmVhdEludGVydmFsTXMgPj0gMVxuICAgICAgPyBoZWFydGJlYXRJbnRlcnZhbE1zXG4gICAgICA6IEhFQVJUQkVBVF9JTlRFUlZBTF9NU1xuICAgIC8qKlxuICAgICAqIE5hcnJvd3MgdGhlIHJ1bnRpbWUgdmFsdWUgdG8gdGhlIGRvY3VtZW50ZWQgdHlwZS5cbiAgICAgKiBAdHlwZSB7UmV0dXJuVHlwZTx0eXBlb2Ygc2V0SW50ZXJ2YWw+IHwgdW5kZWZpbmVkfSAqL1xuICAgIHRoaXMuX2hlYXJ0YmVhdFRpbWVyID0gdW5kZWZpbmVkXG4gICAgLyoqXG4gICAgICogSW4tZmxpZ2h0IGpvYi1yZXN1bHQgcmVwb3J0cyB0byB0aGUgbWFpbi4gUmVwb3J0aW5nIGlzIGRlY291cGxlZCBmcm9tIHRoZVxuICAgICAqIGpvYi9jaGlsZCBzbG90IChmcmVlaW5nIHRoZSBzbG90IG5ldmVyIHdhaXRzIG9uIGEgcmVwb3J0KSBhbmQgcmV0cmllZFxuICAgICAqIGR1cmFibHksIHNvIGEgdHJhbnNpZW50IG1haW4vREIgb3V0YWdlIGNhbm5vdCBsZWFrIHNsb3RzIG9yIGxvc2UgYVxuICAgICAqIHRlcm1pbmFsIHJlcG9ydC4gVHJhY2tlZCBzbyBhIGdyYWNlZnVsIGBzdG9wKClgIGNhbiBkcmFpbiB0aGVtLlxuICAgICAqIEB0eXBlIHtTZXQ8UHJvbWlzZTx2b2lkPj59XG4gICAgICovXG4gICAgdGhpcy5pbmZsaWdodFJlcG9ydHMgPSBuZXcgU2V0KClcbiAgICAvKipcbiAgICAgKiBOYXJyb3dzIHRoZSBydW50aW1lIHZhbHVlIHRvIHRoZSBkb2N1bWVudGVkIHR5cGUuXG4gICAgICogQHR5cGUge0pzb25Tb2NrZXQgfCB1bmRlZmluZWR9ICovXG4gICAgdGhpcy5qc29uU29ja2V0ID0gdW5kZWZpbmVkXG4gICAgLyoqXG4gICAgICogTmFycm93cyB0aGUgcnVudGltZSB2YWx1ZSB0byB0aGUgZG9jdW1lbnRlZCB0eXBlLlxuICAgICAqIEB0eXBlIHtCYWNrZ3JvdW5kSm9ic1N0YXR1c1JlcG9ydGVyIHwgdW5kZWZpbmVkfSAqL1xuICAgIHRoaXMuc3RhdHVzUmVwb3J0ZXIgPSB1bmRlZmluZWRcbiAgICAvKipcbiAgICAgKiBVcCB0byBgdGhpcy5tYXhDb25jdXJyZW50SW5saW5lSm9ic2Agb2YgdGhlc2UgcnVuIGluIHBhcmFsbGVsLiBUaGV5XG4gICAgICogc2hhcmUgdGhlIHdvcmtlcidzIHByb2Nlc3MgYW5kIERCIGNvbm5lY3Rpb24gcG9vbCwgc28gY29uY3VycmVuY3kgaXNcbiAgICAgKiBhYm91dCBvdmVybGFwcGluZyBJL08gd2FpdHMg4oCUIHVzZSBmb3JraW5nIGZvciBtZW1vcnkgaXNvbGF0aW9uIGFjcm9zc1xuICAgICAqIGxvbmctcnVubmluZyBqb2JzIGFuZCBmb3IgdXNpbmcgbW9yZSBjb3Jlcy5cbiAgICAgKiBAdHlwZSB7U2V0PFByb21pc2U8dm9pZD4+fVxuICAgICAqL1xuICAgIHRoaXMuaW5mbGlnaHRJbmxpbmVKb2JzID0gbmV3IFNldCgpXG4gICAgLyoqXG4gICAgICogSW4tZmxpZ2h0IHByb2Nlc3MgcnVubmVyIGV4aXQgcHJvbWlzZXMuIFRyYWNrZWQgc28gcHJvY2Vzcy1qb2IgaGFuZG9mZlxuICAgICAqIHN0YXlzIGJvdW5kZWQgd2hpbGUgcnVubmluZyBhbmQgc28gYSBncmFjZWZ1bCBgc3RvcCgpYCBjYW4gZHJhaW4gdGhlbS5cbiAgICAgKiBAdHlwZSB7U2V0PFByb21pc2U8dm9pZD4+fVxuICAgICAqL1xuICAgIHRoaXMuaW5mbGlnaHRQcm9jZXNzSm9icyA9IG5ldyBTZXQoKVxuICAgIC8qKlxuICAgICAqIExpdmUgcHJvY2VzcyBydW5uZXIgY2hpbGQgcHJvY2Vzc2VzLCBrZXB0IHNvIGEgZ3JhY2VmdWwgYHN0b3AoKWAgY2FuXG4gICAgICogdGVybWluYXRlIGFueSB0aGF0IG91dGxhc3QgdGhlIHNodXRkb3duIGRyYWluIGluc3RlYWQgb2Ygb3JwaGFuaW5nIHRoZW1cbiAgICAgKiBhY3Jvc3MgYSBkZXBsb3kgKHdoZXJlIHRoZXkgd291bGQga2VlcCBydW5uaW5nIGFnYWluc3QgZGVsZXRlZCByZWxlYXNlXG4gICAgICogY29kZSBhbmQgaG9sZGluZyBkYXRhYmFzZSBjb25uZWN0aW9ucykuXG4gICAgICogQHR5cGUge1NldDxpbXBvcnQoXCJub2RlOmNoaWxkX3Byb2Nlc3NcIikuQ2hpbGRQcm9jZXNzPn1cbiAgICAgKi9cbiAgICB0aGlzLmluZmxpZ2h0UHJvY2Vzc0NoaWxkcmVuID0gbmV3IFNldCgpXG4gICAgLyoqIEB0eXBlIHtTZXQ8UHJvbWlzZTx2b2lkPj59ICovXG4gICAgdGhpcy5pbmZsaWdodFBvb2xlZEpvYnMgPSBuZXcgU2V0KClcbiAgICAvKiogQHR5cGUge01hcDxzdHJpbmcsIEFycmF5PGltcG9ydChcIi4vdHlwZXMuanNcIikuQmFja2dyb3VuZEpvYlBheWxvYWQgJiB7aWQ6IHN0cmluZ30+Pn0gKi9cbiAgICB0aGlzLnBvb2xlZEpvYlF1ZXVlcyA9IG5ldyBNYXAoKVxuICAgIC8qKiBAdHlwZSB7TWFwPHN0cmluZywgUHJvbWlzZTx2b2lkPj59IC0gUGVyLWlkIG91dGVyIHF1ZXVlIHRyYWNrZXJzLiAqL1xuICAgIHRoaXMucG9vbGVkSm9iUXVldWVUcmFja2VycyA9IG5ldyBNYXAoKVxuICAgIC8qKiBAdHlwZSB7U2V0PGltcG9ydChcIm5vZGU6Y2hpbGRfcHJvY2Vzc1wiKS5DaGlsZFByb2Nlc3M+fSAqL1xuICAgIHRoaXMucG9vbGVkQ2hpbGRyZW4gPSBuZXcgU2V0KClcbiAgICAvKiogQHR5cGUge01hcDxpbXBvcnQoXCJub2RlOmNoaWxkX3Byb2Nlc3NcIikuQ2hpbGRQcm9jZXNzLCBQb29sZWRDaGlsZFN0YXRlPn0gKi9cbiAgICB0aGlzLnBvb2xlZENoaWxkU3RhdGVzID0gbmV3IE1hcCgpXG4gICAgLyoqIEB0eXBlIHtXZWFrU2V0PFByb21pc2U8dm9pZD4+fSAqL1xuICAgIHRoaXMuX3Bvb2xlZFN0YXJ0dXBGYWlsdXJlSm9icyA9IG5ldyBXZWFrU2V0KClcbiAgICAvLyBNb25vdG9uaWMgZGlzcGF0Y2ggY291bnRlciBmb3Igcm91bmQtcm9iaW4gY2hpbGQgc2VsZWN0aW9uOiBlYWNoIGRpc3BhdGNoIHN0YW1wc1xuICAgIC8vIHRoZSBjaG9zZW4gY2hpbGQsIGFuZCBzZWxlY3Rpb24gcHJlZmVycyB0aGUgY2hpbGQgZGlzcGF0Y2hlZCBsZWFzdCByZWNlbnRseS5cbiAgICB0aGlzLl9wb29sZWREaXNwYXRjaFNlcSA9IDBcbiAgICAvLyBXYWl0ZXJzIGJsb2NrZWQgaW4gX3J1blBvb2xlZEpvYiBiZWNhdXNlIHRoZSBwb29sIGlzIGF0IGl0cyBoYXJkIGNhcDogYSBqb2IgbWF5XG4gICAgLy8gbm90IHNwYXduIGEgY2hpbGQgd2hpbGUgdG90YWwgbGl2ZSBjaGlsZHJlbiAod29ya2luZyArIGRyYWluaW5nKSBpcyBhdCB0aGUgY2FwLlxuICAgIC8qKiBAdHlwZSB7U2V0PCgpID0+IHZvaWQ+fSAqL1xuICAgIHRoaXMuX3Bvb2xlZFNsb3RXYWl0ZXJzID0gbmV3IFNldCgpXG4gICAgLyoqIEB0eXBlIHtSZXR1cm5UeXBlPHR5cGVvZiBzZXRJbnRlcnZhbD4gfCB1bmRlZmluZWR9IC0gU2FmZXR5IHBvbGwgdGhhdCByZS1jaGVja3MgdGhlIHNsb3QgY29uZGl0aW9uLiAqL1xuICAgIHRoaXMuX3Bvb2xlZFNsb3RXYWl0VGltZXIgPSB1bmRlZmluZWRcbiAgfVxuXG4gIC8qKiBTdGFydHMgdGhlIHNsb3Qtd2FpdGVyIHNhZmV0eSBwb2xsIGlmIGl0IGlzIG5vdCBhbHJlYWR5IHJ1bm5pbmcuICovXG4gIF9zdGFydFBvb2xlZFNsb3RXYWl0UG9sbCgpIHtcbiAgICBpZiAodGhpcy5fcG9vbGVkU2xvdFdhaXRUaW1lcikgcmV0dXJuXG5cbiAgICB0aGlzLl9wb29sZWRTbG90V2FpdFRpbWVyID0gc2V0SW50ZXJ2YWwoKCkgPT4gdGhpcy5fd2FrZVBvb2xlZFNsb3RXYWl0ZXJzKCksIDUwKVxuICAgIHRoaXMuX3Bvb2xlZFNsb3RXYWl0VGltZXIudW5yZWYoKVxuICB9XG5cbiAgLyoqIFN0b3BzIHRoZSBzbG90LXdhaXRlciBzYWZldHkgcG9sbCBvbmNlIG5vIHdhaXRlciBpcyByZWdpc3RlcmVkLiAqL1xuICBfc3RvcFBvb2xlZFNsb3RXYWl0UG9sbElmSWRsZSgpIHtcbiAgICBpZiAodGhpcy5fcG9vbGVkU2xvdFdhaXRlcnMuc2l6ZSA+IDAgfHwgIXRoaXMuX3Bvb2xlZFNsb3RXYWl0VGltZXIpIHJldHVyblxuXG4gICAgY2xlYXJJbnRlcnZhbCh0aGlzLl9wb29sZWRTbG90V2FpdFRpbWVyKVxuICAgIHRoaXMuX3Bvb2xlZFNsb3RXYWl0VGltZXIgPSB1bmRlZmluZWRcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHN0YXJ0LlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyB3aGVuIGNvbm5lY3RlZC5cbiAgICovXG4gIGFzeW5jIHN0YXJ0KCkge1xuICAgIHRoaXMuc2hvdWxkU3RvcCA9IGZhbHNlXG4gICAgdGhpcy5pc1JldGlyaW5nID0gZmFsc2VcbiAgICB0aGlzLnN0b3BQcm9taXNlID0gdW5kZWZpbmVkXG4gICAgdGhpcy5fcmVzZXRTdG9wcGVkUHJvbWlzZSgpXG4gICAgdGhpcy5jb25maWd1cmF0aW9uID0gYXdhaXQgdGhpcy5jb25maWd1cmF0aW9uUHJvbWlzZVxuICAgIHRoaXMuY29uZmlndXJhdGlvbi5zZXRDdXJyZW50KClcbiAgICBjb25zdCByZXNvbHZlZENvbmZpZyA9IHRoaXMuY29uZmlndXJhdGlvbi5nZXRCYWNrZ3JvdW5kSm9ic0NvbmZpZygpXG4gICAgdGhpcy5nZW5lcmF0aW9uSWQgPSB0aGlzLmNvbmZpZ3VyYXRpb24ucmVzb2x2ZUJhY2tncm91bmRKb2JzR2VuZXJhdGlvbkNvbmZpZyh7XG4gICAgICBnZW5lcmF0aW9uSWQ6IHRoaXMuZXhwbGljaXRHZW5lcmF0aW9uSWQsXG4gICAgICBzb3VyY2VOYW1lOiBcIkJhY2tncm91bmRKb2JzV29ya2VyXCJcbiAgICB9KS5nZW5lcmF0aW9uSWRcbiAgICB0aGlzLndvcmtlcklkID0gdGhpcy5nZW5lcmF0aW9uSWRcbiAgICAgID8gY3JlYXRlR2VuZXJhdGlvbldvcmtlcklkKHtnZW5lcmF0aW9uSWQ6IHRoaXMuZ2VuZXJhdGlvbklkLCB3b3JrZXJJbnN0YW5jZUlkOiB0aGlzLndvcmtlckluc3RhbmNlSWR9KVxuICAgICAgOiB0aGlzLndvcmtlckluc3RhbmNlSWRcbiAgICB0aGlzLmhvc3QgfHw9IHJlc29sdmVkQ29uZmlnLmhvc3RcbiAgICBpZiAodHlwZW9mIHRoaXMucG9ydCAhPT0gXCJudW1iZXJcIikgdGhpcy5wb3J0ID0gcmVzb2x2ZWRDb25maWcucG9ydFxuICAgIGF3YWl0IHRoaXMuY29uZmlndXJhdGlvbi5pbml0aWFsaXplKHt0eXBlOiBcImJhY2tncm91bmQtam9icy13b3JrZXJcIn0pXG4gICAgYXdhaXQgdGhpcy5jb25maWd1cmF0aW9uLmNvbm5lY3RCZWFjb24oe3BlZXJUeXBlOiBcImJhY2tncm91bmQtam9icy13b3JrZXJcIn0pXG5cbiAgICAvLyBDb25zdHJ1Y3RvciBvdmVycmlkZXMgd2luOyBvdGhlcndpc2UgcGljayB1cCB0aGUgY29uZmlndXJlZCBjYXBzLlxuICAgIGlmICh0eXBlb2YgdGhpcy5tYXhDb25jdXJyZW50SW5saW5lSm9ic092ZXJyaWRlICE9PSBcIm51bWJlclwiKSB7XG4gICAgICBjb25zdCBjb25maWcgPSB0aGlzLmNvbmZpZ3VyYXRpb24uZ2V0QmFja2dyb3VuZEpvYnNDb25maWcoKVxuXG4gICAgICB0aGlzLm1heENvbmN1cnJlbnRJbmxpbmVKb2JzID0gY29uZmlnLm1heENvbmN1cnJlbnRJbmxpbmVKb2JzIHx8IHRoaXMubWF4Q29uY3VycmVudElubGluZUpvYnNcbiAgICB9XG4gICAgaWYgKHR5cGVvZiB0aGlzLm1heENvbmN1cnJlbnRGb3JrZWRKb2JzT3ZlcnJpZGUgIT09IFwibnVtYmVyXCIpIHtcbiAgICAgIGNvbnN0IGNvbmZpZyA9IHRoaXMuY29uZmlndXJhdGlvbi5nZXRCYWNrZ3JvdW5kSm9ic0NvbmZpZygpXG5cbiAgICAgIHRoaXMubWF4Q29uY3VycmVudEZvcmtlZEpvYnMgPSBjb25maWcubWF4Q29uY3VycmVudEZvcmtlZEpvYnMgfHwgdGhpcy5tYXhDb25jdXJyZW50Rm9ya2VkSm9ic1xuICAgIH1cbiAgICBjb25zdCBwb29sQ29uZmlnID0gdGhpcy5jb25maWd1cmF0aW9uLmdldEJhY2tncm91bmRKb2JzQ29uZmlnKClcbiAgICBpZiAodHlwZW9mIHRoaXMucG9vbGVkUnVubmVyQ291bnRPdmVycmlkZSAhPT0gXCJudW1iZXJcIikgdGhpcy5wb29sZWRSdW5uZXJDb3VudCA9IHBvb2xDb25maWcucG9vbGVkUnVubmVyQ291bnRcbiAgICBpZiAodHlwZW9mIHRoaXMucG9vbGVkUnVubmVyQ29uY3VycmVuY3lPdmVycmlkZSAhPT0gXCJudW1iZXJcIikgdGhpcy5wb29sZWRSdW5uZXJDb25jdXJyZW5jeSA9IHBvb2xDb25maWcucG9vbGVkUnVubmVyQ29uY3VycmVuY3lcbiAgICBpZiAodHlwZW9mIHRoaXMucG9vbGVkUnVubmVyTWF4Sm9ic092ZXJyaWRlICE9PSBcIm51bWJlclwiKSB0aGlzLnBvb2xlZFJ1bm5lck1heEpvYnMgPSBwb29sQ29uZmlnLnBvb2xlZFJ1bm5lck1heEpvYnNcbiAgICBpZiAodHlwZW9mIHRoaXMucG9vbGVkUnVubmVyTWF4UnNzQnl0ZXNPdmVycmlkZSAhPT0gXCJudW1iZXJcIikgdGhpcy5wb29sZWRSdW5uZXJNYXhSc3NCeXRlcyA9IHBvb2xDb25maWcucG9vbGVkUnVubmVyTWF4UnNzQnl0ZXNcbiAgICBpZiAodHlwZW9mIHRoaXMucG9vbGVkUnVubmVyTWF4TGlmZXRpbWVNc092ZXJyaWRlICE9PSBcIm51bWJlclwiKSB0aGlzLnBvb2xlZFJ1bm5lck1heExpZmV0aW1lTXMgPSBwb29sQ29uZmlnLnBvb2xlZFJ1bm5lck1heExpZmV0aW1lTXNcbiAgICBpZiAodHlwZW9mIHRoaXMucnVubmVyTWF4T2xkU3BhY2VTaXplTWJPdmVycmlkZSAhPT0gXCJudW1iZXJcIiAmJiB0eXBlb2YgcG9vbENvbmZpZy5ydW5uZXJNYXhPbGRTcGFjZVNpemVNYiA9PT0gXCJudW1iZXJcIikgdGhpcy5ydW5uZXJNYXhPbGRTcGFjZVNpemVNYiA9IHBvb2xDb25maWcucnVubmVyTWF4T2xkU3BhY2VTaXplTWJcbiAgICBpZiAodHlwZW9mIHRoaXMucnVubmVyTWFsbG9jQXJlbmFNYXhPdmVycmlkZSAhPT0gXCJudW1iZXJcIiAmJiB0eXBlb2YgcG9vbENvbmZpZy5ydW5uZXJNYWxsb2NBcmVuYU1heCA9PT0gXCJudW1iZXJcIikgdGhpcy5ydW5uZXJNYWxsb2NBcmVuYU1heCA9IHBvb2xDb25maWcucnVubmVyTWFsbG9jQXJlbmFNYXhcblxuICAgIHRoaXMuc3RhdHVzUmVwb3J0ZXIgPSBuZXcgQmFja2dyb3VuZEpvYnNTdGF0dXNSZXBvcnRlcih7XG4gICAgICBjb25maWd1cmF0aW9uOiB0aGlzLmNvbmZpZ3VyYXRpb24sXG4gICAgICBob3N0OiB0aGlzLmhvc3QsXG4gICAgICBwb3J0OiB0aGlzLnBvcnQsXG4gICAgICBnZW5lcmF0aW9uSGFuZHNoYWtlVGltZW91dE1zOiB0aGlzLmdlbmVyYXRpb25IYW5kc2hha2VUaW1lb3V0TXMsXG4gICAgICBnZW5lcmF0aW9uSWQ6IHRoaXMuZ2VuZXJhdGlvbklkXG4gICAgfSlcbiAgICB0cnkge1xuICAgICAgYXdhaXQgdGhpcy5fY29ubmVjdCh7YWxsb3dSZWNvbm5lY3Q6IGZhbHNlfSlcbiAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgbGV0IGNsZWFudXBFcnJvclxuXG4gICAgICB0cnkge1xuICAgICAgICBhd2FpdCB0aGlzLnN0b3AoKVxuICAgICAgfSBjYXRjaCAoY2F1Z2h0Q2xlYW51cEVycm9yKSB7XG4gICAgICAgIGNsZWFudXBFcnJvciA9IGNhdWdodENsZWFudXBFcnJvclxuICAgICAgfVxuXG4gICAgICBpZiAoY2xlYW51cEVycm9yKSB7XG4gICAgICAgIHRocm93IG5ldyBBZ2dyZWdhdGVFcnJvcihcbiAgICAgICAgICBbZXJyb3IsIGNsZWFudXBFcnJvcl0sXG4gICAgICAgICAgXCJCYWNrZ3JvdW5kIGpvYnMgd29ya2VyIHN0YXJ0dXAgYW5kIGNsZWFudXAgZmFpbGVkXCIsXG4gICAgICAgICAge2NhdXNlOiBlcnJvcn1cbiAgICAgICAgKVxuICAgICAgfVxuXG4gICAgICB0aHJvdyBlcnJvclxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBHcmFjZWZ1bGx5IHN0b3BzIHRoZSB3b3JrZXI6IGFubm91bmNlcyBkcmFpbmluZyB0byB0aGUgbWFpbiBwcm9jZXNzIHNvXG4gICAqIG5vIG5ldyBqb2JzIGFyZSBkaXNwYXRjaGVkLCB3YWl0cyBmb3IgaW4tZmxpZ2h0IGlubGluZSBqb2JzIGFuZCBwcm9jZXNzXG4gICAqIHJ1bm5lcnMgdG8gZmluaXNoIChzbyB0aGVpciByZXN1bHRzIGNhbiBiZSByZXBvcnRlZCksIHRoZW4gY2xvc2VzIHRoZVxuICAgKiBzb2NrZXQgYW5kIGRpc2Nvbm5lY3RzIGZyb20gdGhlIGJlYWNvbi5cbiAgICpcbiAgICogUHJvY2VzcyBydW5uZXJzIGFyZSBjaGlsZCBwcm9jZXNzZXMuIFdoZW4gYSBgdGltZW91dE1zYCBpcyBnaXZlbiAoZS5nLiBhXG4gICAqIGRlcGxveSBkcmFpbmluZyB0aGUgb2xkIHJlbGVhc2UpIGFueSBydW5uZXIgc3RpbGwgYWxpdmUgYWZ0ZXIgdGhlIGRyYWluXG4gICAqIHdpbmRvdyBpcyB0ZXJtaW5hdGVkIChTSUdURVJNLCB0aGVuIFNJR0tJTEwpIHJhdGhlciB0aGFuIGxlZnQgdG8gb3JwaGFuXG4gICAqIGFjcm9zcyB0aGUgZGVwbG95LiBXaXRoIG5vIGB0aW1lb3V0TXNgIHRoZSBkcmFpbiB3YWl0cyBmb3IgcnVubmVycyB0b1xuICAgKiBmaW5pc2ggb24gdGhlaXIgb3duLlxuICAgKiBAcGFyYW0ge29iamVjdH0gW2FyZ3NdIC0gT3B0aW9ucy5cbiAgICogQHBhcmFtIHtudW1iZXJ9IFthcmdzLnRpbWVvdXRNc10gLSBNYXggd2FpdCBmb3IgaW4tZmxpZ2h0IGpvYnMgKHBlciBwaGFzZSkgaW4gbXMuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIHdoZW4gc3RvcHBlZC5cbiAgICovXG4gIHN0b3Aoe3RpbWVvdXRNc30gPSB7fSkge1xuICAgIGNvbnN0IHN0b3BQcm9taXNlID0gdGhpcy5zdG9wUHJvbWlzZSB8fCB0aGlzLl9zdG9wKHt0aW1lb3V0TXN9KVxuXG4gICAgaWYgKCF0aGlzLnN0b3BQcm9taXNlKSB7XG4gICAgICB0aGlzLnN0b3BQcm9taXNlID0gc3RvcFByb21pc2VcbiAgICAgIHZvaWQgc3RvcFByb21pc2UudGhlbih0aGlzLl9yZXNvbHZlU3RvcHBlZCwgKGVycm9yKSA9PiB7XG4gICAgICAgIHRoaXMuX3JlamVjdFN0b3BwZWQoZXJyb3IgaW5zdGFuY2VvZiBFcnJvciA/IGVycm9yIDogbmV3IEVycm9yKFN0cmluZyhlcnJvcikpKVxuICAgICAgfSlcbiAgICB9XG5cbiAgICByZXR1cm4gc3RvcFByb21pc2VcbiAgfVxuXG4gIC8qKlxuICAgKiBXYWl0cyBmb3IgYXV0b21hdGljIG9yIHJlcXVlc3RlZCBzdG9wLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyB3aGVuIHRoaXMgd29ya2VyIGhhcyBmdWxseSBzdG9wcGVkLlxuICAgKi9cbiAgd2FpdFVudGlsU3RvcHBlZCgpIHsgcmV0dXJuIHRoaXMuX3N0b3BwZWRQcm9taXNlIH1cblxuICAvKiogUmVzZXRzIHRoZSBzdG9wIG9ic2VydmF0aW9uIHByb21pc2UgZm9yIGEgbmV3IHdvcmtlciBzdGFydC4gKi9cbiAgX3Jlc2V0U3RvcHBlZFByb21pc2UoKSB7XG4gICAgdGhpcy5fc3RvcHBlZFByb21pc2UgPSBuZXcgUHJvbWlzZSgocmVzb2x2ZSwgcmVqZWN0KSA9PiB7XG4gICAgICB0aGlzLl9yZXNvbHZlU3RvcHBlZCA9IHJlc29sdmVcbiAgICAgIHRoaXMuX3JlamVjdFN0b3BwZWQgPSByZWplY3RcbiAgICB9KVxuICAgIHZvaWQgdGhpcy5fc3RvcHBlZFByb21pc2UuY2F0Y2goKCkgPT4ge30pXG4gIH1cblxuICAvKipcbiAgICogUnVucyB0aGUgd29ya2VyIHNodXRkb3duIGxpZmVjeWNsZSBvbmNlLlxuICAgKiBAcGFyYW0ge29iamVjdH0gW2FyZ3NdIC0gT3B0aW9ucy5cbiAgICogQHBhcmFtIHtudW1iZXJ9IFthcmdzLnRpbWVvdXRNc10gLSBNYXggd2FpdCBmb3IgaW4tZmxpZ2h0IGpvYnMgKHBlciBwaGFzZSkgaW4gbXMuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIHdoZW4gc3RvcHBlZC5cbiAgICovXG4gIGFzeW5jIF9zdG9wKHt0aW1lb3V0TXN9ID0ge30pIHtcbiAgICB0aGlzLnNob3VsZFN0b3AgPSB0cnVlXG4gICAgdGhpcy5pc1JldGlyaW5nID0gdHJ1ZVxuICAgIHRoaXMuX3N0b3BIZWFydGJlYXQoKVxuICAgIGlmICh0aGlzLl9yZWNvbm5lY3RUaW1lcikge1xuICAgICAgY2xlYXJUaW1lb3V0KHRoaXMuX3JlY29ubmVjdFRpbWVyKVxuICAgICAgdGhpcy5fcmVjb25uZWN0VGltZXIgPSB1bmRlZmluZWRcbiAgICB9XG5cbiAgICBhd2FpdCBzaHV0ZG93bkxpZmVjeWNsZSh7XG4gICAgICBvblN0b3BwZWQ6IHRoaXMub25TdG9wcGVkLFxuICAgICAgc2h1dGRvd246IGFzeW5jICgpID0+IHtcbiAgICAgICAgLy8gQW5ub3VuY2UgZHJhaW4gc28gbWFpbiBzdG9wcyBkaXNwYXRjaGluZyBidXQga2VlcHMgdGhlIGNvbm5lY3Rpb25cbiAgICAgICAgLy8gb3BlbiB1bnRpbCB3ZSBjbG9zZSBpdCBvdXJzZWx2ZXMgYmVsb3cuXG4gICAgICAgIGlmICh0aGlzLmpzb25Tb2NrZXQpIHtcbiAgICAgICAgICB0cnkge1xuICAgICAgICAgICAgdGhpcy5qc29uU29ja2V0LnNlbmQoe3R5cGU6IFwiZHJhaW5pbmdcIn0pXG4gICAgICAgICAgfSBjYXRjaCB7XG4gICAgICAgICAgICAvLyBTb2NrZXQgbWF5IGFscmVhZHkgYmUgY2xvc2luZzsgbm90aGluZyB0byBkby5cbiAgICAgICAgICB9XG4gICAgICAgIH1cblxuICAgICAgICBhd2FpdCB0aGlzLl9kcmFpbkluZmxpZ2h0KHRoaXMuaW5mbGlnaHRJbmxpbmVKb2JzLCB0aW1lb3V0TXMpXG4gICAgICAgIGF3YWl0IHRoaXMuX2RyYWluSW5mbGlnaHQodGhpcy5pbmZsaWdodFBvb2xlZEpvYnMsIHRpbWVvdXRNcylcbiAgICAgICAgYXdhaXQgdGhpcy5fZHJhaW5JbmZsaWdodCh0aGlzLmluZmxpZ2h0UHJvY2Vzc0pvYnMsIHRpbWVvdXRNcylcbiAgICAgICAgYXdhaXQgdGhpcy5fdGVybWluYXRlUHJvY2Vzc0NoaWxkcmVuKClcbiAgICAgICAgLy8gR2l2ZSBpbi1mbGlnaHQgcmVzdWx0IHJlcG9ydHMgKG5vdyBkZWNvdXBsZWQgZnJvbSBqb2Igc2xvdHMpIGEgYm91bmRlZFxuICAgICAgICAvLyBjaGFuY2UgdG8gbGFuZCBiZWZvcmUgdGhlIHNvY2tldCBjbG9zZXMuXG4gICAgICAgIGF3YWl0IHRoaXMuX2RyYWluSW5mbGlnaHQodGhpcy5pbmZsaWdodFJlcG9ydHMsIHRpbWVvdXRNcylcblxuICAgICAgICBpZiAodGhpcy5qc29uU29ja2V0KSB0aGlzLmpzb25Tb2NrZXQuY2xvc2UoKVxuICAgICAgICBpZiAoIXRoaXMuY29uZmlndXJhdGlvbikgcmV0dXJuXG5cbiAgICAgICAgYXdhaXQgdGhpcy5fY2xvc2VDb25maWd1cmF0aW9uKClcbiAgICAgIH1cbiAgICB9KVxuICB9XG5cbiAgLyoqIEJlZ2lucyBnZW5lcmF0aW9uIHJldGlyZW1lbnQgd2l0aG91dCByZXZva2luZyBsaXZlbmVzcyBkdXJpbmcgdGhlIGRyYWluLiAqL1xuICBfYmVnaW5HZW5lcmF0aW9uUmV0aXJlbWVudCgpIHtcbiAgICBpZiAodGhpcy5zdG9wUHJvbWlzZSkgcmV0dXJuXG5cbiAgICB0aGlzLmlzUmV0aXJpbmcgPSB0cnVlXG4gICAgY29uc3Qgc3RvcFByb21pc2UgPSB0aGlzLl9zdG9wQWZ0ZXJHZW5lcmF0aW9uRHJhaW4oKVxuICAgIHRoaXMuc3RvcFByb21pc2UgPSBzdG9wUHJvbWlzZVxuICAgIHZvaWQgc3RvcFByb21pc2UudGhlbih0aGlzLl9yZXNvbHZlU3RvcHBlZCwgKGVycm9yKSA9PiB7XG4gICAgICBjb25zdCBub3JtYWxpemVkRXJyb3IgPSBlcnJvciBpbnN0YW5jZW9mIEVycm9yID8gZXJyb3IgOiBuZXcgRXJyb3IoU3RyaW5nKGVycm9yKSlcblxuICAgICAgdGhpcy5fcmVqZWN0U3RvcHBlZChub3JtYWxpemVkRXJyb3IpXG4gICAgICB0aGlzLl9yZXBvcnRMaWZlY3ljbGVFcnJvcihub3JtYWxpemVkRXJyb3IpXG4gICAgfSlcbiAgfVxuXG4gIC8qKlxuICAgKiBEcmFpbnMgYWNjZXB0ZWQgZ2VuZXJhdGlvbiB3b3JrIHdoaWxlIHJldGFpbmluZyB0aGUgZXhhY3QgY29ubmVjdGlvbiBhbmRcbiAgICogaGVhcnRiZWF0LCB0aGVuIHBlcmZvcm1zIHRoZSBmaW5hbCB0ZXJtaW5hdGluZyBzdG9wLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyBhZnRlciB0aGUgd29ya2VyIGhhcyBmdWxseSBjbG9zZWQuXG4gICAqL1xuICBhc3luYyBfc3RvcEFmdGVyR2VuZXJhdGlvbkRyYWluKCkge1xuICAgIGlmICh0aGlzLmpzb25Tb2NrZXQpIHtcbiAgICAgIHRyeSB7XG4gICAgICAgIHRoaXMuanNvblNvY2tldC5zZW5kKHt0eXBlOiBcImRyYWluaW5nXCJ9KVxuICAgICAgfSBjYXRjaCB7XG4gICAgICAgIC8vIFRoZSBjbG9zZSBoYW5kbGVyIG93bnMgZXhhY3Qgc2FtZS1nZW5lcmF0aW9uIHJlY29ubmVjdC5cbiAgICAgIH1cbiAgICB9XG5cbiAgICBhd2FpdCB0aGlzLl9kcmFpbkluZmxpZ2h0KHRoaXMuaW5mbGlnaHRJbmxpbmVKb2JzKVxuICAgIGF3YWl0IHRoaXMuX2RyYWluSW5mbGlnaHQodGhpcy5pbmZsaWdodFBvb2xlZEpvYnMpXG4gICAgYXdhaXQgdGhpcy5fZHJhaW5JbmZsaWdodCh0aGlzLmluZmxpZ2h0UHJvY2Vzc0pvYnMpXG4gICAgYXdhaXQgdGhpcy5fZHJhaW5JbmZsaWdodCh0aGlzLmluZmxpZ2h0UmVwb3J0cylcblxuICAgIHRoaXMuc2hvdWxkU3RvcCA9IHRydWVcbiAgICB0aGlzLl9zdG9wSGVhcnRiZWF0KClcbiAgICBpZiAodGhpcy5fcmVjb25uZWN0VGltZXIpIHtcbiAgICAgIGNsZWFyVGltZW91dCh0aGlzLl9yZWNvbm5lY3RUaW1lcilcbiAgICAgIHRoaXMuX3JlY29ubmVjdFRpbWVyID0gdW5kZWZpbmVkXG4gICAgfVxuICAgIGF3YWl0IHRoaXMuX3Rlcm1pbmF0ZVByb2Nlc3NDaGlsZHJlbigpXG5cbiAgICBhd2FpdCBzaHV0ZG93bkxpZmVjeWNsZSh7XG4gICAgICBvblN0b3BwZWQ6IHRoaXMub25TdG9wcGVkLFxuICAgICAgc2h1dGRvd246IGFzeW5jICgpID0+IHtcbiAgICAgICAgaWYgKHRoaXMuanNvblNvY2tldCkgdGhpcy5qc29uU29ja2V0LmNsb3NlKClcbiAgICAgICAgaWYgKCF0aGlzLmNvbmZpZ3VyYXRpb24pIHJldHVyblxuXG4gICAgICAgIGF3YWl0IHRoaXMuX2Nsb3NlQ29uZmlndXJhdGlvbigpXG4gICAgICB9XG4gICAgfSlcbiAgfVxuXG4gIC8qKlxuICAgKiBDbG9zZXMgYXBwbGljYXRpb24gcmVzb3VyY2VzIGJlZm9yZSBmcmFtZXdvcmsgcmVzb3VyY2VzIHdoZW4gdGhpcyB3b3JrZXIgb3ducyB0aGVtLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyBhZnRlciBldmVyeSBvd25lZCBjbG9zZSBzdWNjZWVkcy5cbiAgICovXG4gIGFzeW5jIF9jbG9zZUNvbmZpZ3VyYXRpb24oKSB7XG4gICAgY29uc3QgY29uZmlndXJhdGlvbiA9IHRoaXMuY29uZmlndXJhdGlvblxuXG4gICAgaWYgKCFjb25maWd1cmF0aW9uKSByZXR1cm5cblxuICAgIGF3YWl0IHJ1blNodXRkb3duU3RlcHMoe1xuICAgICAgbWVzc2FnZTogXCJCYWNrZ3JvdW5kIGpvYnMgd29ya2VyIGFwcGxpY2F0aW9uIGFuZCBmcmFtZXdvcmsgc2h1dGRvd24gZmFpbGVkXCIsXG4gICAgICBzdGVwczogW1xuICAgICAgICAuLi4odGhpcy5jbG9zZURhdGFiYXNlQ29ubmVjdGlvbnNPblN0b3BcbiAgICAgICAgICA/IFthc3luYyAoKSA9PiBhd2FpdCBjb25maWd1cmF0aW9uLnNodXRkb3duKCldXG4gICAgICAgICAgOiBbXSksXG4gICAgICAgIGFzeW5jICgpID0+IGF3YWl0IGNvbmZpZ3VyYXRpb24uZGlzY29ubmVjdEJlYWNvbigpLFxuICAgICAgICAuLi4odGhpcy5jbG9zZURhdGFiYXNlQ29ubmVjdGlvbnNPblN0b3BcbiAgICAgICAgICA/IFthc3luYyAoKSA9PiBhd2FpdCBjb25maWd1cmF0aW9uLmNsb3NlRGF0YWJhc2VDb25uZWN0aW9ucygpXVxuICAgICAgICAgIDogW10pXG4gICAgICBdXG4gICAgfSlcbiAgfVxuXG4gIC8qKlxuICAgKiBXYWl0cyBmb3IgYSBzZXQgb2YgaW4tZmxpZ2h0IGpvYiBwcm9taXNlcyB0byBzZXR0bGUsIG9wdGlvbmFsbHkgYm91bmRlZCBieVxuICAgKiBgdGltZW91dE1zYC5cbiAgICogQHBhcmFtIHtTZXQ8UHJvbWlzZTx2b2lkPj59IGluZmxpZ2h0IC0gSW4tZmxpZ2h0IGpvYiBwcm9taXNlcy5cbiAgICogQHBhcmFtIHtudW1iZXJ9IFt0aW1lb3V0TXNdIC0gTWF4IHdhaXQgaW4gbXM7IHVuYm91bmRlZCB3aGVuIG9taXR0ZWQuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIHdoZW4gc2V0dGxlZCBvciB0aGUgdGltZW91dCBlbGFwc2VzLlxuICAgKi9cbiAgYXN5bmMgX2RyYWluSW5mbGlnaHQoaW5mbGlnaHQsIHRpbWVvdXRNcykge1xuICAgIGlmIChpbmZsaWdodC5zaXplID09PSAwKSByZXR1cm5cblxuICAgIGNvbnN0IGRyYWluID0gUHJvbWlzZS5hbGxTZXR0bGVkKFsuLi5pbmZsaWdodF0pXG5cbiAgICBpZiAodHlwZW9mIHRpbWVvdXRNcyA9PT0gXCJudW1iZXJcIiAmJiB0aW1lb3V0TXMgPj0gMCkge1xuICAgICAgbGV0IHRpbWVyXG4gICAgICBjb25zdCB0aW1lb3V0ID0gbmV3IFByb21pc2UoKHJlc29sdmUpID0+IHsgdGltZXIgPSBzZXRUaW1lb3V0KHJlc29sdmUsIHRpbWVvdXRNcykgfSlcblxuICAgICAgYXdhaXQgUHJvbWlzZS5yYWNlKFtkcmFpbiwgdGltZW91dF0pXG4gICAgICBjbGVhclRpbWVvdXQodGltZXIpXG4gICAgfSBlbHNlIHtcbiAgICAgIGF3YWl0IGRyYWluXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIFRlcm1pbmF0ZXMgYW55IHByb2Nlc3MgcnVubmVyIGNoaWxkcmVuIHN0aWxsIGFsaXZlIGFmdGVyIHRoZSBkcmFpbiB3aW5kb3cgc29cbiAgICogdGhleSBkb24ndCBvdXRsaXZlIHRoZSB3b3JrZXIgYXMgb3JwaGFucy4gU0lHVEVSTSBsZXRzIHRoZSBydW5uZXIgY2xvc2UgaXRzXG4gICAqIGNvbm5lY3Rpb25zIGNsZWFubHk7IHN1cnZpdm9ycyBhcmUgU0lHS0lMTGVkIGFmdGVyIGEgc2hvcnQgZ3JhY2UuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIG9uY2Ugc3Vydml2b3JzIGhhdmUgYmVlbiBzaWduYWxsZWQuXG4gICAqL1xuICBhc3luYyBfdGVybWluYXRlUHJvY2Vzc0NoaWxkcmVuKCkge1xuICAgIGlmICh0aGlzLmluZmxpZ2h0UHJvY2Vzc0NoaWxkcmVuLnNpemUgPT09IDApIHJldHVyblxuXG4gICAgZm9yIChjb25zdCBjaGlsZCBvZiB0aGlzLmluZmxpZ2h0UHJvY2Vzc0NoaWxkcmVuKSB7XG4gICAgICBjb25zdCBwb29sZWRTdGF0ZSA9IHRoaXMucG9vbGVkQ2hpbGRTdGF0ZXMuZ2V0KGNoaWxkKVxuICAgICAgaWYgKHBvb2xlZFN0YXRlKSB7XG4gICAgICAgIHRoaXMuX3JlcXVlc3RQb29sZWRDaGlsZFNodXRkb3duKHtjaGlsZCwgcmVhc29uOiBcIndvcmtlcl9zdG9wXCIsIHNpZ25hbDogXCJTSUdURVJNXCJ9KVxuICAgICAgfSBlbHNlIHtcbiAgICAgICAgdHJ5IHtcbiAgICAgICAgICBjaGlsZC5raWxsKFwiU0lHVEVSTVwiKVxuICAgICAgICB9IGNhdGNoIHtcbiAgICAgICAgICAvLyBDaGlsZCBhbHJlYWR5IGV4aXRlZDsgbm90aGluZyB0byBkby5cbiAgICAgICAgfVxuICAgICAgfVxuICAgIH1cblxuICAgIGF3YWl0IG5ldyBQcm9taXNlKChyZXNvbHZlKSA9PiBzZXRUaW1lb3V0KHJlc29sdmUsIHRoaXMuZm9ya2VkQ2hpbGRTaWdraWxsR3JhY2VNcykpXG5cbiAgICBmb3IgKGNvbnN0IGNoaWxkIG9mIHRoaXMuaW5mbGlnaHRQcm9jZXNzQ2hpbGRyZW4pIHtcbiAgICAgIHRyeSB7XG4gICAgICAgIGNoaWxkLmtpbGwoXCJTSUdLSUxMXCIpXG4gICAgICB9IGNhdGNoIHtcbiAgICAgICAgLy8gQ2hpbGQgYWxyZWFkeSBleGl0ZWQ7IG5vdGhpbmcgdG8gZG8uXG4gICAgICB9XG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIENvbm5lY3RzIHRvIHRoZSB3b3JrZXIncyByZXNvbHZlZCBlbmRwb2ludCBhbmQgY29tcGxldGVzIGl0cyBoZWxsbyBmZW5jZS5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBSZWNvbm5lY3QgcG9saWN5LlxuICAgKiBAcGFyYW0ge2Jvb2xlYW59IGFyZ3MuYWxsb3dSZWNvbm5lY3QgLSBXaGV0aGVyIGEgZmFpbGVkIGF0dGVtcHQgbWF5IHNjaGVkdWxlIGFub3RoZXIgY29ubmVjdGlvbi5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgYWZ0ZXIgZ2VuZXJhdGlvbiBhY2tub3dsZWRnZW1lbnQuXG4gICAqL1xuICBhc3luYyBfY29ubmVjdCh7YWxsb3dSZWNvbm5lY3R9KSB7XG4gICAgY29uc3QgY29uZmlndXJhdGlvbiA9IHRoaXMuY29uZmlndXJhdGlvblxuICAgIGlmICghY29uZmlndXJhdGlvbikgdGhyb3cgbmV3IEVycm9yKFwiQmFja2dyb3VuZCBqb2JzIHdvcmtlciBjb25maWd1cmF0aW9uIG5vdCBpbml0aWFsaXplZFwiKVxuXG4gICAgY29uc3QgY29uZmlnID0gY29uZmlndXJhdGlvbi5nZXRCYWNrZ3JvdW5kSm9ic0NvbmZpZygpXG4gICAgaWYgKHRoaXMuZ2VuZXJhdGlvbklkKSB0aGlzLl9nZW5lcmF0aW9uQWNjZXB0ZWQgPSBmYWxzZVxuICAgIGNvbnN0IGhvc3QgPSB0aGlzLmhvc3QgfHwgY29uZmlnLmhvc3RcbiAgICBjb25zdCBwb3J0ID0gdHlwZW9mIHRoaXMucG9ydCA9PT0gXCJudW1iZXJcIiA/IHRoaXMucG9ydCA6IGNvbmZpZy5wb3J0XG4gICAgY29uc3Qgc29ja2V0ID0gbmV0LmNyZWF0ZUNvbm5lY3Rpb24oe2hvc3QsIHBvcnR9KVxuICAgIHNvY2tldC5zZXRLZWVwQWxpdmUodHJ1ZSwgU09DS0VUX0tFRVBBTElWRV9NUylcbiAgICBjb25zdCBqc29uU29ja2V0ID0gbmV3IEpzb25Tb2NrZXQoc29ja2V0KVxuICAgIHRoaXMuanNvblNvY2tldCA9IGpzb25Tb2NrZXRcbiAgICAvKipcbiAgICAgKiBSZXNvbHZlcyB0aGUgZ2VuZXJhdGlvbiBoYW5kc2hha2UuXG4gICAgICogQHR5cGUgeygpID0+IHZvaWR9XG4gICAgICovXG4gICAgbGV0IHJlc29sdmVIYW5kc2hha2UgPSAoKSA9PiB7fVxuICAgIC8qKlxuICAgICAqIFJlamVjdHMgdGhlIGdlbmVyYXRpb24gaGFuZHNoYWtlLlxuICAgICAqIEB0eXBlIHsoZXJyb3I6IEVycm9yKSA9PiB2b2lkfVxuICAgICAqL1xuICAgIGxldCByZWplY3RIYW5kc2hha2UgPSAoKSA9PiB7fVxuICAgIGxldCBjb25uZWN0aW9uQWNjZXB0ZWQgPSBmYWxzZVxuICAgIC8qKiBAdHlwZSB7UmV0dXJuVHlwZTx0eXBlb2Ygc2V0VGltZW91dD4gfCB1bmRlZmluZWR9ICovXG4gICAgbGV0IGhhbmRzaGFrZVRpbWVyXG4gICAgY29uc3QgaGFuZHNoYWtlID0gbmV3IFByb21pc2UoKC8qKiBAdHlwZSB7KHZhbHVlOiB2b2lkKSA9PiB2b2lkfSAqLyByZXNvbHZlLCByZWplY3QpID0+IHtcbiAgICAgIHJlc29sdmVIYW5kc2hha2UgPSByZXNvbHZlXG4gICAgICByZWplY3RIYW5kc2hha2UgPSByZWplY3RcbiAgICB9KVxuXG4gICAgLyoqXG4gICAgICogSGFuZGxlcyBhIGJhY2tncm91bmQgam9iIHNvY2tldCBtZXNzYWdlLlxuICAgICAqIEBwYXJhbSB7aW1wb3J0KFwiLi90eXBlcy5qc1wiKS5CYWNrZ3JvdW5kSm9iU29ja2V0TWVzc2FnZX0gbWVzc2FnZSAtIFNvY2tldCBtZXNzYWdlLlxuICAgICAqL1xuICAgIGpzb25Tb2NrZXQub24oXCJtZXNzYWdlXCIsIGFzeW5jIChtZXNzYWdlKSA9PiB7XG4gICAgICBpZiAobWVzc2FnZT8udHlwZSA9PT0gXCJnZW5lcmF0aW9uLWFjY2VwdGVkXCIpIHtcbiAgICAgICAgaWYgKCF0aGlzLmdlbmVyYXRpb25JZCB8fCBtZXNzYWdlLmdlbmVyYXRpb25JZCAhPT0gdGhpcy5nZW5lcmF0aW9uSWQpIHtcbiAgICAgICAgICByZWplY3RIYW5kc2hha2UobmV3IEVycm9yKFwiQmFja2dyb3VuZCBqb2JzIG1haW4gYWNrbm93bGVkZ2VkIGEgZGlmZmVyZW50IGdlbmVyYXRpb25cIikpXG4gICAgICAgICAganNvblNvY2tldC5kZXN0cm95KClcbiAgICAgICAgICByZXR1cm5cbiAgICAgICAgfVxuXG4gICAgICAgIHRoaXMuX2dlbmVyYXRpb25BY2NlcHRlZCA9IHRydWVcbiAgICAgICAgY29ubmVjdGlvbkFjY2VwdGVkID0gdHJ1ZVxuICAgICAgICBpZiAoaGFuZHNoYWtlVGltZXIpIHtcbiAgICAgICAgICBjbGVhclRpbWVvdXQoaGFuZHNoYWtlVGltZXIpXG4gICAgICAgICAgaGFuZHNoYWtlVGltZXIgPSB1bmRlZmluZWRcbiAgICAgICAgfVxuICAgICAgICBpZiAobWVzc2FnZS5saWZlY3ljbGVTdGF0ZSA9PT0gXCJyZXRpcmluZ1wiIHx8IG1lc3NhZ2UubGlmZWN5Y2xlU3RhdGUgPT09IFwicmV0aXJlZFwiKSB0aGlzLmlzUmV0aXJpbmcgPSB0cnVlXG4gICAgICAgIHRoaXMub25HZW5lcmF0aW9uQWNjZXB0ZWQ/LigpXG4gICAgICAgIHRoaXMuX3NlbmRSZWFkeUlmUnVubmluZygpXG4gICAgICAgIHRoaXMuX3N0YXJ0SGVhcnRiZWF0KClcbiAgICAgICAgcmVzb2x2ZUhhbmRzaGFrZSgpXG4gICAgICAgIHJldHVyblxuICAgICAgfVxuXG4gICAgICBpZiAobWVzc2FnZT8udHlwZSA9PT0gXCJnZW5lcmF0aW9uLXJlamVjdGVkXCIpIHtcbiAgICAgICAgdGhpcy5zaG91bGRTdG9wID0gdHJ1ZVxuICAgICAgICBpZiAoaGFuZHNoYWtlVGltZXIpIGNsZWFyVGltZW91dChoYW5kc2hha2VUaW1lcilcbiAgICAgICAgcmVqZWN0SGFuZHNoYWtlKG5ldyBFcnJvcihgQmFja2dyb3VuZCBqb2JzIGdlbmVyYXRpb24gcmVqZWN0ZWQ6ICR7bWVzc2FnZS5yZWFzb259YCkpXG4gICAgICAgIGpzb25Tb2NrZXQuZGVzdHJveSgpXG4gICAgICAgIHJldHVyblxuICAgICAgfVxuXG4gICAgICBpZiAobWVzc2FnZT8udHlwZSA9PT0gXCJyZXRpcmVcIikge1xuICAgICAgICBpZiAodGhpcy5nZW5lcmF0aW9uSWQgJiYgbWVzc2FnZS5nZW5lcmF0aW9uSWQgPT09IHRoaXMuZ2VuZXJhdGlvbklkKSB7XG4gICAgICAgICAgdGhpcy5vblJldGlyZU1lc3NhZ2U/LigpXG4gICAgICAgICAgdGhpcy5fYmVnaW5HZW5lcmF0aW9uUmV0aXJlbWVudCgpXG4gICAgICAgIH1cbiAgICAgICAgcmV0dXJuXG4gICAgICB9XG5cbiAgICAgIGlmIChtZXNzYWdlPy50eXBlID09PSBcImpvYlwiKSB7XG4gICAgICAgIGF3YWl0IHRoaXMuX2hhbmRsZUpvYihtZXNzYWdlLnBheWxvYWQpXG4gICAgICB9XG4gICAgfSlcblxuICAgIGpzb25Tb2NrZXQub24oXCJlcnJvclwiLCAoZXJyb3IpID0+IHtcbiAgICAgIGNvbnNvbGUuZXJyb3IoXCJCYWNrZ3JvdW5kIGpvYnMgd29ya2VyIHNvY2tldCBlcnJvcjpcIiwgZXJyb3IpXG4gICAgICBpZiAodGhpcy5nZW5lcmF0aW9uSWQgJiYgIXRoaXMuX2dlbmVyYXRpb25BY2NlcHRlZCkgcmVqZWN0SGFuZHNoYWtlKGVycm9yKVxuICAgIH0pXG5cbiAgICBqc29uU29ja2V0Lm9uKFwiY2xvc2VcIiwgKCkgPT4ge1xuICAgICAgaWYgKGhhbmRzaGFrZVRpbWVyKSBjbGVhclRpbWVvdXQoaGFuZHNoYWtlVGltZXIpXG4gICAgICB0aGlzLl9zdG9wSGVhcnRiZWF0KClcbiAgICAgIGlmICh0aGlzLmpzb25Tb2NrZXQgPT09IGpzb25Tb2NrZXQpIHRoaXMuanNvblNvY2tldCA9IHVuZGVmaW5lZFxuICAgICAgaWYgKHRoaXMuZ2VuZXJhdGlvbklkICYmICF0aGlzLl9nZW5lcmF0aW9uQWNjZXB0ZWQpIHtcbiAgICAgICAgcmVqZWN0SGFuZHNoYWtlKG5ldyBFcnJvcihcIkJhY2tncm91bmQgam9icyBzb2NrZXQgY2xvc2VkIGJlZm9yZSBnZW5lcmF0aW9uIGFja25vd2xlZGdlbWVudFwiKSlcbiAgICAgIH1cbiAgICAgIGlmICh0aGlzLnNob3VsZFN0b3ApIHJldHVyblxuICAgICAgaWYgKGNvbm5lY3Rpb25BY2NlcHRlZCB8fCBhbGxvd1JlY29ubmVjdCB8fCAhdGhpcy5nZW5lcmF0aW9uSWQpIHRoaXMuX3NjaGVkdWxlUmVjb25uZWN0KClcbiAgICB9KVxuXG4gICAgaWYgKHRoaXMuZ2VuZXJhdGlvbklkKSB7XG4gICAgICBoYW5kc2hha2VUaW1lciA9IHNldFRpbWVvdXQoKCkgPT4ge1xuICAgICAgICBjb25zdCBlcnJvciA9IG5ldyBCYWNrZ3JvdW5kSm9ic0dlbmVyYXRpb25IYW5kc2hha2VUaW1lb3V0RXJyb3Ioe1xuICAgICAgICAgIGVuZHBvaW50OiBgJHtob3N0fToke3BvcnR9YCxcbiAgICAgICAgICBnZW5lcmF0aW9uSWQ6IHRoaXMuZ2VuZXJhdGlvbklkIHx8IFwiXCIsXG4gICAgICAgICAgcm9sZTogXCJ3b3JrZXJcIixcbiAgICAgICAgICB0aW1lb3V0TXM6IHRoaXMuZ2VuZXJhdGlvbkhhbmRzaGFrZVRpbWVvdXRNc1xuICAgICAgICB9KVxuICAgICAgICByZWplY3RIYW5kc2hha2UoZXJyb3IpXG4gICAgICAgIGpzb25Tb2NrZXQuZGVzdHJveSgpXG4gICAgICB9LCB0aGlzLmdlbmVyYXRpb25IYW5kc2hha2VUaW1lb3V0TXMpXG4gICAgfVxuXG4gICAgc29ja2V0Lm9uKFwiY29ubmVjdFwiLCAoKSA9PiB7XG4gICAgICBqc29uU29ja2V0LnNlbmQoe3R5cGU6IFwiaGVsbG9cIiwgcm9sZTogXCJ3b3JrZXJcIiwgLi4uKHRoaXMuZ2VuZXJhdGlvbklkID8ge2dlbmVyYXRpb25JZDogdGhpcy5nZW5lcmF0aW9uSWR9IDoge30pLCBzdXBwb3J0c0hhbmRvZmZJZFJlcG9ydGluZzogdHJ1ZSwgc3VwcG9ydHNIZWFydGJlYXQ6IHRydWUsIHN1cHBvcnRzUG9vbGVkOiB0cnVlLCB3b3JrZXJJZDogdGhpcy53b3JrZXJJZH0pXG4gICAgICBpZiAoIXRoaXMuZ2VuZXJhdGlvbklkKSB7XG4gICAgICAgIGNvbm5lY3Rpb25BY2NlcHRlZCA9IHRydWVcbiAgICAgICAgdGhpcy5fc2VuZFJlYWR5SWZSdW5uaW5nKClcbiAgICAgICAgdGhpcy5fc3RhcnRIZWFydGJlYXQoKVxuICAgICAgICByZXNvbHZlSGFuZHNoYWtlKClcbiAgICAgIH1cbiAgICB9KVxuXG4gICAgaWYgKHRoaXMuZ2VuZXJhdGlvbklkKSBhd2FpdCBoYW5kc2hha2VcbiAgfVxuXG4gIC8qKiBTY2hlZHVsZXMgb25lIGZlbmNlZCByZWNvbm5lY3QgdG8gdGhlIHdvcmtlcidzIHVuY2hhbmdlZCBlbmRwb2ludC4gKi9cbiAgX3NjaGVkdWxlUmVjb25uZWN0KCkge1xuICAgIGlmICh0aGlzLnNob3VsZFN0b3AgfHwgdGhpcy5fcmVjb25uZWN0VGltZXIpIHJldHVyblxuXG4gICAgdGhpcy5fcmVjb25uZWN0VGltZXIgPSBzZXRUaW1lb3V0KCgpID0+IHtcbiAgICAgIHRoaXMuX3JlY29ubmVjdFRpbWVyID0gdW5kZWZpbmVkXG4gICAgICBpZiAodGhpcy5zaG91bGRTdG9wKSByZXR1cm5cbiAgICAgIHZvaWQgdGhpcy5fY29ubmVjdCh7YWxsb3dSZWNvbm5lY3Q6IHRydWV9KS5jYXRjaCgoZXJyb3IpID0+IHtcbiAgICAgICAgaWYgKCF0aGlzLnNob3VsZFN0b3ApIGNvbnNvbGUuZXJyb3IoXCJCYWNrZ3JvdW5kIGpvYnMgd29ya2VyIHJlY29ubmVjdCBmYWlsZWQ6XCIsIGVycm9yKVxuICAgICAgfSlcbiAgICB9LCB0aGlzLnJlY29ubmVjdERlbGF5TXMpXG4gICAgaWYgKHR5cGVvZiB0aGlzLl9yZWNvbm5lY3RUaW1lci51bnJlZiA9PT0gXCJmdW5jdGlvblwiKSB0aGlzLl9yZWNvbm5lY3RUaW1lci51bnJlZigpXG4gIH1cblxuICAvKipcbiAgICogU3VyZmFjZXMgYW4gdW5leHBlY3RlZCB3b3JrZXIgbGlmZWN5Y2xlIGZhaWx1cmUgdGhyb3VnaCB0aGUgZnJhbWV3b3JrIGVycm9yXG4gICAqIGNoYW5uZWxzIHNvIGEgc3VwZXJ2aXNvciBob29rIHRoYXQgaWdub3JlcyBzdGRpbyBzdGlsbCBoYXMgb2JzZXJ2YWJpbGl0eS5cbiAgICogQHBhcmFtIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gZXJyb3IgLSBXb3JrZXIgbGlmZWN5Y2xlIGZhaWx1cmUuXG4gICAqL1xuICBfcmVwb3J0TGlmZWN5Y2xlRXJyb3IoZXJyb3IpIHtcbiAgICBjb25zdCBjb25maWd1cmF0aW9uID0gdGhpcy5jb25maWd1cmF0aW9uXG4gICAgaWYgKCFjb25maWd1cmF0aW9uKSByZXR1cm5cbiAgICBjb25zdCBub3JtYWxpemVkRXJyb3IgPSBlcnJvciBpbnN0YW5jZW9mIEVycm9yID8gZXJyb3IgOiBuZXcgRXJyb3IoU3RyaW5nKGVycm9yKSlcbiAgICBjb25zdCBwYXlsb2FkID0ge2NvbnRleHQ6IHtnZW5lcmF0aW9uSWQ6IHRoaXMuZ2VuZXJhdGlvbklkLCBzdGFnZTogXCJiYWNrZ3JvdW5kLWpvYnMtd29ya2VyLWxpZmVjeWNsZVwifSwgZXJyb3I6IG5vcm1hbGl6ZWRFcnJvcn1cbiAgICBjb25zdCBlcnJvckV2ZW50cyA9IGNvbmZpZ3VyYXRpb24uZ2V0RXJyb3JFdmVudHMoKVxuXG4gICAgZXJyb3JFdmVudHMuZW1pdChcImZyYW1ld29yay1lcnJvclwiLCBwYXlsb2FkKVxuICAgIGVycm9yRXZlbnRzLmVtaXQoXCJhbGwtZXJyb3JcIiwgey4uLnBheWxvYWQsIGVycm9yVHlwZTogXCJmcmFtZXdvcmstZXJyb3JcIn0pXG4gIH1cblxuICAvKipcbiAgICogU2VuZHMgcGVyaW9kaWMgbGl2ZW5lc3MgaGVhcnRiZWF0cyB0byB0aGUgbWFpbiBzbyBhIHdlZGdlZCBvciBzaWxlbnQgd29ya2VyXG4gICAqIGNhbiBiZSBkZXRlY3RlZCBhbmQgZHJvcHBlZCB0aGVyZSAoaXRzIGxlYXNlcyByZWxlYXNlZCkgaW5zdGVhZCBvZiBmcmVlemluZ1xuICAgKiB0aGUgcXVldWUgdW50aWwgYSBodW1hbiBub3RpY2VzLlxuICAgKiBAcmV0dXJucyB7dm9pZH1cbiAgICovXG4gIF9zdGFydEhlYXJ0YmVhdCgpIHtcbiAgICB0aGlzLl9zdG9wSGVhcnRiZWF0KClcblxuICAgIHRoaXMuX2hlYXJ0YmVhdFRpbWVyID0gc2V0SW50ZXJ2YWwoKCkgPT4gdGhpcy5fc2VuZEhlYXJ0YmVhdCgpLCB0aGlzLmhlYXJ0YmVhdEludGVydmFsTXMpXG5cbiAgICBpZiAodHlwZW9mIHRoaXMuX2hlYXJ0YmVhdFRpbWVyLnVucmVmID09PSBcImZ1bmN0aW9uXCIpIHRoaXMuX2hlYXJ0YmVhdFRpbWVyLnVucmVmKClcbiAgfVxuXG4gIC8qKiBTZW5kcyBvbmUgbGl2ZW5lc3MgaGVhcnRiZWF0IHdoaWxlIHRoZSB3b3JrZXIgaGFzIG5vdCBmaW5hbGx5IHN0b3BwZWQuICovXG4gIF9zZW5kSGVhcnRiZWF0KCkge1xuICAgIGlmICh0aGlzLnNob3VsZFN0b3AgfHwgIXRoaXMuanNvblNvY2tldCkgcmV0dXJuXG5cbiAgICB0cnkge1xuICAgICAgdGhpcy5qc29uU29ja2V0LnNlbmQoe3R5cGU6IFwiaGVhcnRiZWF0XCIsIHdvcmtlcklkOiB0aGlzLndvcmtlcklkfSlcbiAgICB9IGNhdGNoIHtcbiAgICAgIC8vIFNvY2tldCBpcyBjbG9zaW5nL2Nsb3NlZDsgdGhlIGNsb3NlIGhhbmRsZXIgZHJpdmVzIHJlY29ubmVjdC5cbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogU3RvcHMgdGhlIGxpdmVuZXNzIGhlYXJ0YmVhdCB0aW1lci5cbiAgICogQHJldHVybnMge3ZvaWR9XG4gICAqL1xuICBfc3RvcEhlYXJ0YmVhdCgpIHtcbiAgICBpZiAodGhpcy5faGVhcnRiZWF0VGltZXIpIHtcbiAgICAgIGNsZWFySW50ZXJ2YWwodGhpcy5faGVhcnRiZWF0VGltZXIpXG4gICAgICB0aGlzLl9oZWFydGJlYXRUaW1lciA9IHVuZGVmaW5lZFxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGhhbmRsZSBqb2IuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi90eXBlcy5qc1wiKS5CYWNrZ3JvdW5kSm9iUGF5bG9hZH0gcGF5bG9hZCAtIFBheWxvYWQuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIHdoZW4gZG9uZS5cbiAgICovXG4gIGFzeW5jIF9oYW5kbGVKb2IocGF5bG9hZCkge1xuICAgIGlmICghcGF5bG9hZC5pZCkgdGhyb3cgbmV3IEVycm9yKFwiQmFja2dyb3VuZCBqb2IgcGF5bG9hZCBtaXNzaW5nIGlkXCIpXG4gICAgLyoqXG4gICAgICogSWRlbnRpZmllZCBwYXlsb2FkLlxuICAgICAqIEB0eXBlIHtpbXBvcnQoXCIuL3R5cGVzLmpzXCIpLkJhY2tncm91bmRKb2JQYXlsb2FkICYge2lkOiBzdHJpbmd9fSAqL1xuICAgIGNvbnN0IGlkZW50aWZpZWRQYXlsb2FkID0gLyoqIEB0eXBlIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gKi8gKHBheWxvYWQpXG5cbiAgICBjb25zdCBleGVjdXRpb25Nb2RlID0gdGhpcy5fZXhlY3V0aW9uTW9kZUZvclBheWxvYWQoaWRlbnRpZmllZFBheWxvYWQpXG5cbiAgICBpZiAoZXhlY3V0aW9uTW9kZSA9PT0gXCJwb29sZWRcIikge1xuICAgICAgdGhpcy5fcXVldWVQb29sZWRKb2IoaWRlbnRpZmllZFBheWxvYWQpXG4gICAgICByZXR1cm5cbiAgICB9XG5cbiAgICBpZiAoZXhlY3V0aW9uTW9kZSAhPT0gXCJpbmxpbmVcIikge1xuICAgICAgdGhpcy5fdHJhY2tQcm9jZXNzSm9iKHRoaXMuX3N0YXJ0UHJvY2Vzc0pvYih7ZXhlY3V0aW9uTW9kZSwgcGF5bG9hZDogaWRlbnRpZmllZFBheWxvYWR9KSlcbiAgICAgIHJldHVyblxuICAgIH1cblxuICAgIHRoaXMuX2hhbmRsZUlubGluZUpvYihpZGVudGlmaWVkUGF5bG9hZClcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHN0YXJ0IHByb2Nlc3Mgam9iLlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIE9wdGlvbnMuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi90eXBlcy5qc1wiKS5CYWNrZ3JvdW5kSm9iRXhlY3V0aW9uTW9kZX0gYXJncy5leGVjdXRpb25Nb2RlIC0gRXhlY3V0aW9uIG1vZGUuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi90eXBlcy5qc1wiKS5CYWNrZ3JvdW5kSm9iUGF5bG9hZCAmIHtpZDogc3RyaW5nfX0gYXJncy5wYXlsb2FkIC0gUGF5bG9hZC5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgd2hlbiB0aGUgcHJvY2VzcyBqb2IgZXhpdHMuXG4gICAqL1xuICBfc3RhcnRQcm9jZXNzSm9iKHtleGVjdXRpb25Nb2RlLCBwYXlsb2FkfSkge1xuICAgIGlmIChleGVjdXRpb25Nb2RlID09PSBcImZvcmtlZFwiKSByZXR1cm4gdGhpcy5fZm9ya0pvYihwYXlsb2FkKVxuXG4gICAgcmV0dXJuIHRoaXMuX3NwYXduSm9iKHBheWxvYWQpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBoYW5kbGUgaW5saW5lIGpvYi5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL3R5cGVzLmpzXCIpLkJhY2tncm91bmRKb2JQYXlsb2FkICYge2lkOiBzdHJpbmd9fSBwYXlsb2FkIC0gUGF5bG9hZC5cbiAgICogQHJldHVybnMge3ZvaWR9XG4gICAqL1xuICBfaGFuZGxlSW5saW5lSm9iKHBheWxvYWQpIHtcbiAgICAvLyBJbmxpbmUgam9icyBzaGFyZSB0aGUgd29ya2VyJ3MgcHJvY2VzcyBhbmQgREIgcG9vbCwgYnV0IGVhY2ggb25lXG4gICAgLy8gaXMgaXRzIG93biBhc3luYyBjaGFpbiDigJQgdGhlcmUncyBubyBzZW1hbnRpYyByZWFzb24gdG8gc2VyaWFsaXplXG4gICAgLy8gdGhlbS4gV2Uga2ljayBvZmYgdGhlIGpvYiwgcmVnaXN0ZXIgaXQgd2l0aCBgaW5mbGlnaHRJbmxpbmVKb2JzYFxuICAgIC8vIGZvciBzaHV0ZG93biBkcmFpbiwgYW5kIHNpZ25hbCBjYXBhY2l0eSB0byBtYWluOlxuICAgIC8vIC0gSWYgd2Ugc3RpbGwgaGF2ZSBhIGZyZWUgc2xvdCB3ZSBhc2sgZm9yIHRoZSBuZXh0IGpvYiByaWdodFxuICAgIC8vICAgYXdheSwgc28gYSBzbG93IGpvYiAoZS5nLiBhIGRvY2tlciBhbGl2ZSBjaGVjayB0aGF0IHdhaXRzIDE1c1xuICAgIC8vICAgb24gYSBnb25lIHNlcnZlcikgbm8gbG9uZ2VyIHN0YXJ2ZXMgZXZlcnkgb3RoZXIgaW5saW5lIGpvYi5cbiAgICAvLyAtIFdoZW4gdGhlIGpvYiBmaW5pc2hlcywgaWYgdGhlIHdvcmtlciBoYWQgYmVlbiBhdCB0aGUgY2FwLCB3ZVxuICAgIC8vICAgYXNrIGZvciB0aGUgbmV4dCBqb2IgdG8gcmVmaWxsIHRoZSBzbG90LlxuICAgIC8vIFRoZSBib29ra2VlcGluZyBpbiBgZmluYWxseSgpYCByYXRjaGV0cyBjYXBhY2l0eSBiYWNrIHVwXG4gICAgLy8gcmVnYXJkbGVzcyBvZiBzdWNjZXNzIG9yIGZhaWx1cmUuXG4gICAgLyoqXG4gICAgICogRGVmaW5lcyBpbmZsaWdodC5cbiAgICAgKiBAdHlwZSB7UHJvbWlzZTx2b2lkPn0gKi9cbiAgICBsZXQgaW5mbGlnaHRcblxuICAgIGluZmxpZ2h0ID0gdGhpcy5fcnVuSW5saW5lSm9iQW5kUmVwb3J0KHBheWxvYWQpLmZpbmFsbHkoKCkgPT4ge1xuICAgICAgdGhpcy5pbmZsaWdodElubGluZUpvYnMuZGVsZXRlKGluZmxpZ2h0KVxuXG4gICAgICAvLyBSZS1hbm5vdW5jZSBvbiBldmVyeSBjb21wbGV0aW9uIGJlbG93IGNhcCwgbm90IGp1c3QgdGhlIGNhcOKGkmNhcC0xIGVkZ2Ug4oCUXG4gICAgICAvLyBzZWUgX3RyYWNrUHJvY2Vzc0pvYiBmb3Igd2h5IHRoZSBrbmlmZS1lZGdlIGNvbmRpdGlvbiBzaWxlbnRseSB3ZWRnZXMuXG4gICAgICBpZiAoIXRoaXMuc2hvdWxkU3RvcCkgdGhpcy5fc2VuZFJlYWR5SWZSdW5uaW5nKClcbiAgICB9KVxuXG4gICAgdGhpcy5pbmZsaWdodElubGluZUpvYnMuYWRkKGluZmxpZ2h0KVxuXG4gICAgaWYgKHRoaXMuaW5mbGlnaHRJbmxpbmVKb2JzLnNpemUgPCB0aGlzLm1heENvbmN1cnJlbnRJbmxpbmVKb2JzKSB7XG4gICAgICB0aGlzLl9zZW5kUmVhZHlJZlJ1bm5pbmcoKVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGV4ZWN1dGlvbiBtb2RlIGZvciBwYXlsb2FkLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vdHlwZXMuanNcIikuQmFja2dyb3VuZEpvYlBheWxvYWR9IHBheWxvYWQgLSBQYXlsb2FkLlxuICAgKiBAcmV0dXJucyB7aW1wb3J0KFwiLi90eXBlcy5qc1wiKS5CYWNrZ3JvdW5kSm9iRXhlY3V0aW9uTW9kZX0gLSBFeGVjdXRpb24gbW9kZS5cbiAgICovXG4gIF9leGVjdXRpb25Nb2RlRm9yUGF5bG9hZChwYXlsb2FkKSB7XG4gICAgY29uc3QgZXhlY3V0aW9uTW9kZSA9IHBheWxvYWQub3B0aW9ucz8uZXhlY3V0aW9uTW9kZVxuXG4gICAgcmV0dXJuIGV4ZWN1dGlvbk1vZGUgPyB0aGlzLl9ub3JtYWxpemVFeGVjdXRpb25Nb2RlKGV4ZWN1dGlvbk1vZGUpIDogXCJwb29sZWRcIlxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgbm9ybWFsaXplIGV4ZWN1dGlvbiBtb2RlLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gZXhlY3V0aW9uTW9kZSAtIEV4ZWN1dGlvbiBtb2RlLlxuICAgKiBAcmV0dXJucyB7aW1wb3J0KFwiLi90eXBlcy5qc1wiKS5CYWNrZ3JvdW5kSm9iRXhlY3V0aW9uTW9kZX0gLSBOb3JtYWxpemVkIGV4ZWN1dGlvbiBtb2RlLlxuICAgKi9cbiAgX25vcm1hbGl6ZUV4ZWN1dGlvbk1vZGUoZXhlY3V0aW9uTW9kZSkge1xuICAgIGZvciAoY29uc3QgbW9kZSBvZiBFWEVDVVRJT05fTU9ERVMpIHtcbiAgICAgIGlmIChtb2RlID09PSBleGVjdXRpb25Nb2RlKSByZXR1cm4gbW9kZVxuICAgIH1cblxuICAgIHRocm93IG5ldyBFcnJvcihgSW52YWxpZCBiYWNrZ3JvdW5kIGpvYiBleGVjdXRpb25Nb2RlOiAke2V4ZWN1dGlvbk1vZGV9YClcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHRyYWNrIHByb2Nlc3Mgam9iLlxuICAgKiBAcGFyYW0ge1Byb21pc2U8dm9pZD59IHByb2Nlc3NKb2IgLSBQcm9jZXNzIGpvYiBwcm9taXNlLlxuICAgKiBAcmV0dXJucyB7dm9pZH1cbiAgICovXG4gIF90cmFja1Byb2Nlc3NKb2IocHJvY2Vzc0pvYikge1xuICAgIC8qKlxuICAgICAqIERlZmluZXMgaW5mbGlnaHQuXG4gICAgICogQHR5cGUge1Byb21pc2U8dm9pZD59ICovXG4gICAgbGV0IGluZmxpZ2h0XG5cbiAgICBpbmZsaWdodCA9IHByb2Nlc3NKb2IuZmluYWxseSgoKSA9PiB7XG4gICAgICB0aGlzLmluZmxpZ2h0UHJvY2Vzc0pvYnMuZGVsZXRlKGluZmxpZ2h0KVxuXG4gICAgICAvLyBSZS1hbm5vdW5jZSByZWFkaW5lc3Mgb24gRVZFUlkgY29tcGxldGlvbiB0aGF0IGxlYXZlcyB1cyBiZWxvdyBjYXAg4oCUIG5vdFxuICAgICAgLy8ganVzdCB0aGUgc2luZ2xlIGNhcOKGkmNhcC0xIGVkZ2UuIFRoZSBtYWluIHJlbW92ZXMgYSB3b3JrZXIgZnJvbSBpdHMgcmVhZHlcbiAgICAgIC8vIHNldCBvbiBlYWNoIGRpc3BhdGNoIChgX2RyYWluT25jZWApIGFuZCBvbmx5IHJlLWFkZHMgaXQgb24gYSBmcmVzaFxuICAgICAgLy8gXCJyZWFkeVwiOyBnYXRpbmcgdGhlIHJlLWFubm91bmNlIG9uIG9uZSBrbmlmZS1lZGdlIHRyYW5zaXRpb24gbWVhbnMgYVxuICAgICAgLy8gc2luZ2xlIG1pc3NlZCBvciBsb3N0IHNpZ25hbCBsZWF2ZXMgdGhlIHdvcmtlciBvdXQgb2YgdGhlIHJlYWR5IHNldCBhbmRcbiAgICAgIC8vIHdlZGdlcyBkaXNwYXRjaCBjbHVzdGVyLXdpZGUuIFRoaXMgd2FzIHRoZSBzaWxlbnQtZnJlZXplIHJvb3QgY2F1c2UuXG4gICAgICAvLyBgX3NlbmRSZWFkeUlmUnVubmluZ2Agc2VsZi1ndWFyZHMgKGl0IHNlbmRzIG5vdGhpbmcgd2hlbiB0aGUgd29ya2VyIGlzXG4gICAgICAvLyBnZW51aW5lbHkgYXQgY2FwYWNpdHkpLCBzbyByZS1hbm5vdW5jaW5nIG9uIGV2ZXJ5IGZyZWVkIHNsb3QgaXMgc2FmZSBhbmRcbiAgICAgIC8vIGlkZW1wb3RlbnQgb24gdGhlIG1haW4uXG4gICAgICBpZiAoIXRoaXMuc2hvdWxkU3RvcCkgdGhpcy5fc2VuZFJlYWR5SWZSdW5uaW5nKClcbiAgICB9KVxuXG4gICAgdGhpcy5pbmZsaWdodFByb2Nlc3NKb2JzLmFkZChpbmZsaWdodClcbiAgICB0aGlzLl9zZW5kUmVhZHlJZlJ1bm5pbmcoKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgcnVuIGlubGluZSBqb2IgYW5kIHJlcG9ydC5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL3R5cGVzLmpzXCIpLkJhY2tncm91bmRKb2JQYXlsb2FkICYge2lkOiBzdHJpbmd9fSBwYXlsb2FkIC0gUGF5bG9hZCB3aXRoIHJlcXVpcmVkIGlkLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyB3aGVuIGNvbXBsZXRlIChzdWNjZXNzIG9yIGZhaWx1cmUgcmVwb3J0ZWQpLlxuICAgKi9cbiAgYXN5bmMgX3J1bklubGluZUpvYkFuZFJlcG9ydChwYXlsb2FkKSB7XG4gICAgLy8gUmVwb3J0IGluIHRoZSBiYWNrZ3JvdW5kIHNvIGZyZWVpbmcgdGhpcyBpbmxpbmUgc2xvdCBuZXZlciB3YWl0cyBvbiB0aGVcbiAgICAvLyByZXBvcnQuIFJlcG9ydGluZyBpcyBkdXJhYmxlIChyZXRyaWVkIHVudGlsIGl0IGxhbmRzKSwgc28gYSB0cmFuc2llbnRcbiAgICAvLyBtYWluL0RCIG91dGFnZSBuZWl0aGVyIHdlZGdlcyB0aGUgc2xvdCBub3IgbG9zZXMgdGhlIHRlcm1pbmFsIHJlc3VsdC5cbiAgICB0cnkge1xuICAgICAgYXdhaXQgdGhpcy5fcnVuSm9iSW5saW5lKHBheWxvYWQpXG4gICAgICB0aGlzLl9yZXBvcnRKb2JSZXN1bHRJbkJhY2tncm91bmQoe1xuICAgICAgICBqb2JJZDogcGF5bG9hZC5pZCxcbiAgICAgICAgc3RhdHVzOiBcImNvbXBsZXRlZFwiLFxuICAgICAgICBoYW5kb2ZmSWQ6IHBheWxvYWQuaGFuZG9mZklkLFxuICAgICAgICBoYW5kZWRPZmZBdE1zOiBwYXlsb2FkLmhhbmRlZE9mZkF0TXMsXG4gICAgICAgIHdvcmtlcklkOiBwYXlsb2FkLndvcmtlcklkIHx8IHRoaXMud29ya2VySWRcbiAgICAgIH0pXG4gICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgIGlmIChlcnJvciBpbnN0YW5jZW9mIEJhY2tncm91bmRKb2JSZXNjaGVkdWxlU2lnbmFsKSB7XG4gICAgICAgIHRoaXMuX3JlcG9ydEpvYlJlc3VsdEluQmFja2dyb3VuZCh7XG4gICAgICAgICAgam9iSWQ6IHBheWxvYWQuaWQsXG4gICAgICAgICAgc3RhdHVzOiBcInJlc2NoZWR1bGVkXCIsXG4gICAgICAgICAgZGVsYXlNczogZXJyb3IuZGVsYXlNcyxcbiAgICAgICAgICBoYW5kb2ZmSWQ6IHBheWxvYWQuaGFuZG9mZklkLFxuICAgICAgICAgIGhhbmRlZE9mZkF0TXM6IHBheWxvYWQuaGFuZGVkT2ZmQXRNcyxcbiAgICAgICAgICB3b3JrZXJJZDogcGF5bG9hZC53b3JrZXJJZCB8fCB0aGlzLndvcmtlcklkXG4gICAgICAgIH0pXG4gICAgICAgIHJldHVyblxuICAgICAgfVxuXG4gICAgICB0aGlzLl9yZXBvcnRKb2JSZXN1bHRJbkJhY2tncm91bmQoe1xuICAgICAgICBqb2JJZDogcGF5bG9hZC5pZCxcbiAgICAgICAgc3RhdHVzOiBcImZhaWxlZFwiLFxuICAgICAgICBlcnJvcixcbiAgICAgICAgaGFuZG9mZklkOiBwYXlsb2FkLmhhbmRvZmZJZCxcbiAgICAgICAgaGFuZGVkT2ZmQXRNczogcGF5bG9hZC5oYW5kZWRPZmZBdE1zLFxuICAgICAgICB3b3JrZXJJZDogcGF5bG9hZC53b3JrZXJJZCB8fCB0aGlzLndvcmtlcklkXG4gICAgICB9KVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBBZHZlcnRpc2VzIGN1cnJlbnQgd29ya2VyIGNhcGFjaXR5IHVubGVzcyB0aGUgd29ya2VyIGlzIGRyYWluaW5nLlxuICAgKiBAcGFyYW0ge29iamVjdH0gW29wdGlvbnNdIC0gQWR2ZXJ0aXNlbWVudCBvcHRpb25zLlxuICAgKiBAcGFyYW0ge2Jvb2xlYW59IFtvcHRpb25zLnJldm9rZVBvb2xlZEFkbWlzc2lvbl0gLSBSZXZva2UgcG9vbGVkIGNyZWRpdHMgd2hpbGUgcHJlc2VydmluZyBvdGhlciBleGVjdXRpb24gbW9kZXMuXG4gICAqIEByZXR1cm5zIHt2b2lkfVxuICAgKi9cbiAgX3NlbmRSZWFkeUlmUnVubmluZyh7cmV2b2tlUG9vbGVkQWRtaXNzaW9uID0gZmFsc2V9ID0ge30pIHtcbiAgICBpZiAodGhpcy5zaG91bGRTdG9wIHx8IHRoaXMuaXNSZXRpcmluZykgcmV0dXJuXG4gICAgaWYgKCF0aGlzLmpzb25Tb2NrZXQpIHJldHVyblxuICAgIGlmICh0aGlzLmdlbmVyYXRpb25JZCAmJiAhdGhpcy5fZ2VuZXJhdGlvbkFjY2VwdGVkKSByZXR1cm5cblxuICAgIGNvbnN0IHJlYWR5TWVzc2FnZSA9IHRoaXMuX3JlYWR5TWVzc2FnZSh7cmV2b2tlUG9vbGVkQWRtaXNzaW9ufSlcblxuICAgIGlmICghcmVhZHlNZXNzYWdlKSByZXR1cm5cbiAgICB0aGlzLmpzb25Tb2NrZXQuc2VuZChyZWFkeU1lc3NhZ2UpXG4gIH1cblxuICAvKipcbiAgICogUnVucyByZWFkeSBtZXNzYWdlLlxuICAgKiBAcGFyYW0ge29iamVjdH0gW29wdGlvbnNdIC0gQWR2ZXJ0aXNlbWVudCBvcHRpb25zLlxuICAgKiBAcGFyYW0ge2Jvb2xlYW59IFtvcHRpb25zLnJldm9rZVBvb2xlZEFkbWlzc2lvbl0gLSBSZXZva2UgcG9vbGVkIGNyZWRpdHMgd2hpbGUgcHJlc2VydmluZyBvdGhlciBleGVjdXRpb24gbW9kZXMuXG4gICAqIEByZXR1cm5zIHtpbXBvcnQoXCIuL3R5cGVzLmpzXCIpLkJhY2tncm91bmRKb2JTb2NrZXRNZXNzYWdlIHwgbnVsbH0gLSBSZWFkeSBtZXNzYWdlIG9yIG51bGwgd2hlbiB0aGUgd29ya2VyIGhhcyBubyBjYXBhY2l0eS5cbiAgICovXG4gIF9yZWFkeU1lc3NhZ2Uoe3Jldm9rZVBvb2xlZEFkbWlzc2lvbiA9IGZhbHNlfSA9IHt9KSB7XG4gICAgY29uc3QgYWNjZXB0c1Byb2Nlc3NKb2IgPSB0aGlzLmluZmxpZ2h0UHJvY2Vzc0pvYnMuc2l6ZSA8IHRoaXMubWF4Q29uY3VycmVudEZvcmtlZEpvYnNcbiAgICBjb25zdCBhY2NlcHRzSW5saW5lID0gdGhpcy5pbmZsaWdodElubGluZUpvYnMuc2l6ZSA8IHRoaXMubWF4Q29uY3VycmVudElubGluZUpvYnNcbiAgICBjb25zdCBhdmFpbGFibGVQb29sZWRTbG90cyA9IHJldm9rZVBvb2xlZEFkbWlzc2lvbiA/IDAgOiB0aGlzLl9hdmFpbGFibGVQb29sZWRTbG90cygpXG4gICAgY29uc3QgYWNjZXB0c1Bvb2xlZCA9IGF2YWlsYWJsZVBvb2xlZFNsb3RzID4gMFxuXG4gICAgaWYgKCFyZXZva2VQb29sZWRBZG1pc3Npb24gJiYgIWFjY2VwdHNQcm9jZXNzSm9iICYmICFhY2NlcHRzSW5saW5lICYmICFhY2NlcHRzUG9vbGVkKSByZXR1cm4gbnVsbFxuXG4gICAgcmV0dXJuIHtcbiAgICAgIHR5cGU6IFwicmVhZHlcIixcbiAgICAgIGFjY2VwdHNGb3JrZWQ6IGFjY2VwdHNQcm9jZXNzSm9iLFxuICAgICAgYWNjZXB0c0lubGluZSxcbiAgICAgIGFjY2VwdHNQb29sZWQsXG4gICAgICBhdmFpbGFibGVQb29sZWRTbG90cyxcbiAgICAgIGFjY2VwdHNTcGF3bmVkOiBhY2NlcHRzUHJvY2Vzc0pvYlxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBUcmFja3MgYSBwb29sZWQgam9iIGFuZCByZS1hZHZlcnRpc2VzIGNhcGFjaXR5LlxuICAgKiBAcGFyYW0ge1Byb21pc2U8dm9pZD59IHBvb2xlZEpvYiAtIFBvb2xlZCBqb2IgcHJvbWlzZS5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gVGhlIHRyYWNrZWQgaW4tZmxpZ2h0IHByb21pc2UuXG4gICAqL1xuICBfdHJhY2tQb29sZWRKb2IocG9vbGVkSm9iKSB7XG4gICAgLyoqIEB0eXBlIHtQcm9taXNlPHZvaWQ+fSAqL1xuICAgIGxldCBpbmZsaWdodFxuICAgIGluZmxpZ2h0ID0gcG9vbGVkSm9iLmZpbmFsbHkoKCkgPT4ge1xuICAgICAgdGhpcy5pbmZsaWdodFBvb2xlZEpvYnMuZGVsZXRlKGluZmxpZ2h0KVxuICAgICAgaWYgKCF0aGlzLnNob3VsZFN0b3AgJiYgIXRoaXMuX3Bvb2xlZFN0YXJ0dXBGYWlsdXJlSm9icy5oYXMocG9vbGVkSm9iKSAmJiAhdGhpcy5fcG9vbGVkU3RhcnR1cEZhaWx1cmVKb2JzLmhhcyhpbmZsaWdodCkpIHRoaXMuX3NlbmRSZWFkeUlmUnVubmluZygpXG4gICAgfSlcbiAgICB0aGlzLmluZmxpZ2h0UG9vbGVkSm9icy5hZGQoaW5mbGlnaHQpXG4gICAgcmV0dXJuIGluZmxpZ2h0XG4gIH1cblxuICAvKipcbiAgICogU2VyaWFsaXplcyByZXBlYXRlZCBsZWFzZXMgZm9yIG9uZSBkdXJhYmxlIHJvdyB3aGlsZSBwcmVzZXJ2aW5nIHBvb2xlZFxuICAgKiBjb25jdXJyZW5jeSBhY3Jvc3MgZGlmZmVyZW50IGpvYiBpZHMuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi90eXBlcy5qc1wiKS5CYWNrZ3JvdW5kSm9iUGF5bG9hZCAmIHtpZDogc3RyaW5nfX0gcGF5bG9hZCAtIFBvb2xlZCBqb2IgcGF5bG9hZC5cbiAgICogQHJldHVybnMge3ZvaWR9XG4gICAqL1xuICBfcXVldWVQb29sZWRKb2IocGF5bG9hZCkge1xuICAgIGNvbnN0IHF1ZXVlID0gdGhpcy5wb29sZWRKb2JRdWV1ZXMuZ2V0KHBheWxvYWQuaWQpXG4gICAgaWYgKHF1ZXVlKSB7XG4gICAgICBxdWV1ZS5wdXNoKHBheWxvYWQpXG4gICAgICByZXR1cm5cbiAgICB9XG5cbiAgICB0aGlzLnBvb2xlZEpvYlF1ZXVlcy5zZXQocGF5bG9hZC5pZCwgW3BheWxvYWRdKVxuICAgIGNvbnN0IHRyYWNrZXIgPSB0aGlzLl90cmFja1Bvb2xlZEpvYih0aGlzLl9ydW5Qb29sZWRKb2JRdWV1ZShwYXlsb2FkLmlkKSlcbiAgICB0aGlzLnBvb2xlZEpvYlF1ZXVlVHJhY2tlcnMuc2V0KHBheWxvYWQuaWQsIHRyYWNrZXIpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBhZG1pdHRlZCBsZWFzZXMgZm9yIG9uZSBkdXJhYmxlIGpvYiBpZCBpbiBhcnJpdmFsIG9yZGVyLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gam9iSWQgLSBEdXJhYmxlIGpvYiBpZC5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgYWZ0ZXIgdGhlIHBlci1pZCBxdWV1ZSBkcmFpbnMuXG4gICAqL1xuICBhc3luYyBfcnVuUG9vbGVkSm9iUXVldWUoam9iSWQpIHtcbiAgICBjb25zdCBxdWV1ZSA9IHRoaXMucG9vbGVkSm9iUXVldWVzLmdldChqb2JJZClcbiAgICBpZiAoIXF1ZXVlKSB0aHJvdyBuZXcgRXJyb3IoYFBvb2xlZCBqb2IgcXVldWUgbWlzc2luZyBmb3Igam9iOiAke2pvYklkfWApXG5cbiAgICB0cnkge1xuICAgICAgd2hpbGUgKHF1ZXVlLmxlbmd0aCA+IDApIHtcbiAgICAgICAgY29uc3QgcGF5bG9hZCA9IHF1ZXVlLnNoaWZ0KClcbiAgICAgICAgaWYgKCFwYXlsb2FkKSB0aHJvdyBuZXcgRXJyb3IoYFBvb2xlZCBqb2IgcXVldWUgY29udGFpbmVkIGFuIGVtcHR5IHBheWxvYWQgZm9yIGpvYjogJHtqb2JJZH1gKVxuICAgICAgICBhd2FpdCB0aGlzLl9ydW5Qb29sZWRKb2IocGF5bG9hZClcbiAgICAgIH1cbiAgICB9IGZpbmFsbHkge1xuICAgICAgY29uc3QgdHJhY2tlciA9IHRoaXMucG9vbGVkSm9iUXVldWVUcmFja2Vycy5nZXQoam9iSWQpXG4gICAgICBpZiAodHJhY2tlcikge1xuICAgICAgICB0aGlzLmluZmxpZ2h0UG9vbGVkSm9icy5kZWxldGUodHJhY2tlcilcbiAgICAgICAgdGhpcy5wb29sZWRKb2JRdWV1ZVRyYWNrZXJzLmRlbGV0ZShqb2JJZClcbiAgICAgIH1cbiAgICAgIHRoaXMucG9vbGVkSm9iUXVldWVzLmRlbGV0ZShqb2JJZClcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogSGFyZCBjYXAgb24gdG90YWwgbGl2ZSBwb29sZWQgY2hpbGRyZW4gKHdvcmtpbmcgKyBkcmFpbmluZyk6IGNoaWxkcmVuIHRoZVxuICAgKiBwb29sIG1heSBzdGlsbCBzcGF3bi4gQ291bnRpbmcgdGhlIHdob2xlIGxpdmUgc2V0IOKAlCBkcmFpbmluZyBjaGlsZHJlblxuICAgKiBpbmNsdWRlZCDigJQgaXMgd2hhdCBib3VuZHMgcG9vbCBtZW1vcnk6IGEgZHJhaW5pbmcgY2hpbGQgc3RpbGwgaG9sZHMgaXRzXG4gICAqIFJTUyB1bnRpbCBpdHMgbGFzdCBpbi1mbGlnaHQgam9iIGZpbmlzaGVzLCBzbyBpdCBtdXN0IG9jY3VweSBhIGNhcCBzbG90LlxuICAgKiBAcmV0dXJucyB7bnVtYmVyfSAtIE51bWJlciBvZiBjaGlsZHJlbiB0aGUgcG9vbCBtYXkgc3RpbGwgc3Bhd24uXG4gICAqL1xuICBfc3Bhd25hYmxlUG9vbGVkQ2hpbGRyZW4oKSB7XG4gICAgcmV0dXJuIE1hdGgubWF4KDAsIHRoaXMucG9vbGVkUnVubmVyQ291bnQgLSB0aGlzLnBvb2xlZENoaWxkcmVuLnNpemUpXG4gIH1cblxuICAvKipcbiAgICogQ291bnRzIGxpdmUgY2hpbGRyZW4gc3RpbGwgYWJsZSB0byBydW4gbmV3IHdvcmsuIFRoZSBwb29sIG11c3QgYWx3YXlzXG4gICAqIGtlZXAg4oCUIG9yIHJlc3RvcmUsIHRocm91Z2ggdGhlIGJvdW5kZWQgb3Zlci1jYXAgbGl2ZW5lc3MgcmVwbGFjZW1lbnQg4oCUIGF0XG4gICAqIGxlYXN0IG9uZSBub24tcmV0aXJpbmcgY2hpbGQ6IHdpdGggZXZlcnkgbGl2ZSBjaGlsZCByZXRpcmluZywgYWR2ZXJ0aXNlZFxuICAgKiBjYXBhY2l0eSBpcyB6ZXJvIGZvciB0aGUgZW50aXJlIGRyYWluIHdpbmRvdywgd2hpY2ggY2FuIHN0cmV0Y2ggdG8gdGhlXG4gICAqIGxvbmdlc3QgaW4tZmxpZ2h0IGpvYiwgYW5kIGRpc3BhdGNoIHNpbGVudGx5IHN0YWxscy5cbiAgICogQHJldHVybnMge251bWJlcn0gLSBOdW1iZXIgb2Ygbm9uLXJldGlyaW5nIHBvb2xlZCBjaGlsZHJlbi5cbiAgICovXG4gIF9ub25SZXRpcmluZ1Bvb2xlZENoaWxkQ291bnQoKSB7XG4gICAgbGV0IGNvdW50ID0gMFxuXG4gICAgZm9yIChjb25zdCBzdGF0ZSBvZiB0aGlzLnBvb2xlZENoaWxkU3RhdGVzLnZhbHVlcygpKSB7XG4gICAgICBpZiAoIXN0YXRlLnJldGlyaW5nKSBjb3VudCArPSAxXG4gICAgfVxuXG4gICAgcmV0dXJuIGNvdW50XG4gIH1cblxuICAvKipcbiAgICogUmVzb2x2ZXMgb25jZSBhIG5vbi1yZXRpcmluZyBwb29sZWQgY2hpbGQgaGFzIGEgZnJlZSBjb25jdXJyZW5jeSBzbG90IG9yIHRoZVxuICAgKiBwb29sIG1heSBzcGF3biBhIG5ldyBvbmUuIFBvb2xlZCBqb2JzIGFkbWl0dGVkIHdoaWxlIHRoZSBwb29sIGlzIGF0IGl0c1xuICAgKiBoYXJkIGNhcCB3YWl0IGhlcmUgaW5zdGVhZCBvZiBzcGF3bmluZyBhbiBvdmVyLWNhcGFjaXR5IGNoaWxkOyB0aGUgd2FrZVxuICAgKiBwb2ludHMgYXJlIHRoZSBvbmx5IGNhcGFjaXR5LWZyZWVpbmcgdHJhbnNpdGlvbnMgKGEgam9iIG91dGNvbWUgYW5kIGEgY2hpbGRcbiAgICogZXhpdCksIHNvIG5vIHBvbGxpbmcgaXMgbmVlZGVkLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyB3aGVuIGEgc2xvdCBpcyBhdmFpbGFibGUuXG4gICAqL1xuICBfd2FpdFBvb2xlZFNsb3QoKSB7XG4gICAgdGhpcy5fc3RhcnRQb29sZWRTbG90V2FpdFBvbGwoKVxuXG4gICAgcmV0dXJuIG5ldyBQcm9taXNlKChyZXNvbHZlKSA9PiB7XG4gICAgICBjb25zdCB3YWl0ZXIgPSAoKSA9PiB7XG4gICAgICAgIHRoaXMuX3Bvb2xlZFNsb3RXYWl0ZXJzLmRlbGV0ZSh3YWl0ZXIpXG4gICAgICAgIHRoaXMuX3N0b3BQb29sZWRTbG90V2FpdFBvbGxJZklkbGUoKVxuICAgICAgICByZXNvbHZlKClcbiAgICAgIH1cblxuICAgICAgdGhpcy5fcG9vbGVkU2xvdFdhaXRlcnMuYWRkKHdhaXRlcilcbiAgICB9KVxuICB9XG5cbiAgLyoqXG4gICAqIFJlc29sdmVzIGV2ZXJ5IHJlZ2lzdGVyZWQgd2FpdGVyOyB3YWl0ZXJzIHJlLWNoZWNrIHRoZSBzbG90IGNvbmRpdGlvblxuICAgKiB0aGVtc2VsdmVzIGFuZCBvbmx5IHByb2NlZWQgd2hlbiBpdCBob2xkcy5cbiAgICogQHJldHVybnMge3ZvaWR9XG4gICAqL1xuICBfd2FrZVBvb2xlZFNsb3RXYWl0ZXJzKCkge1xuICAgIGlmICh0aGlzLl9wb29sZWRTbG90V2FpdGVycy5zaXplID09PSAwKSByZXR1cm5cblxuICAgIGZvciAoY29uc3QgcmVzb2x2ZSBvZiBbLi4udGhpcy5fcG9vbGVkU2xvdFdhaXRlcnNdKSByZXNvbHZlKClcbiAgfVxuXG4gIC8qKlxuICAgKiBGcmVlIHBvb2xlZCBzbG90cyBhY3Jvc3MgdGhlIHBvb2w6IG9wZW4gc2xvdHMgaW4gbm9uLXJldGlyaW5nIGNoaWxkcmVuIHBsdXNcbiAgICogdGhlIHNsb3RzIHdlIGNvdWxkIGFkZCBieSBzcGF3bmluZyBtb3JlIGNoaWxkcmVuIHVwIHRvIHRoZSBoYXJkIGNhcCBvbiB0b3RhbFxuICAgKiBsaXZlIGNoaWxkcmVuLiBSZXRpcmluZyBjaGlsZHJlbiAoZHJhaW5pbmcgYmVmb3JlIHJlcGxhY2VtZW50KSBuZXZlclxuICAgKiBjb250cmlidXRlIGNhcGFjaXR5LCBhbmQgdGhleSBjb3VudCBhZ2FpbnN0IHRoZSBjYXA6IHdoaWxlIG9uZSBpcyBzdGlsbFxuICAgKiBkcmFpbmluZywgbm8gcmVwbGFjZW1lbnQgaXMgYWR2ZXJ0aXNlZCAob3Igc3Bhd25lZCkg4oCUIHRoZSBwb29sIGFkdmVydGlzZXNcbiAgICogZXhhY3RseSB3aGF0IGl0IGNhbiBzZXJ2ZSBpbnN0ZWFkIG9mIHBoYW50b20gY2FwYWNpdHkuXG4gICAqIEByZXR1cm5zIHtudW1iZXJ9IC0gTnVtYmVyIG9mIHBvb2xlZCBqb2JzIHRoZSB3b3JrZXIgY2FuIGFjY2VwdCByaWdodCBub3cuXG4gICAqL1xuICBfYXZhaWxhYmxlUG9vbGVkU2xvdHMoKSB7XG4gICAgbGV0IG9wZW5JbkV4aXN0aW5nID0gMFxuICAgIGxldCBxdWV1ZWRSZXNlcnZhdGlvbnMgPSAwXG5cbiAgICBmb3IgKGNvbnN0IGNoaWxkIG9mIHRoaXMucG9vbGVkQ2hpbGRyZW4pIHtcbiAgICAgIGNvbnN0IHN0YXRlID0gdGhpcy5wb29sZWRDaGlsZFN0YXRlcy5nZXQoY2hpbGQpXG4gICAgICBpZiAoIXN0YXRlIHx8IHN0YXRlLnJldGlyaW5nKSBjb250aW51ZVxuICAgICAgb3BlbkluRXhpc3RpbmcgKz0gdGhpcy5wb29sZWRSdW5uZXJDb25jdXJyZW5jeSAtIHN0YXRlLmluZmxpZ2h0LnNpemVcbiAgICB9XG5cbiAgICBmb3IgKGNvbnN0IHF1ZXVlIG9mIHRoaXMucG9vbGVkSm9iUXVldWVzLnZhbHVlcygpKSBxdWV1ZWRSZXNlcnZhdGlvbnMgKz0gcXVldWUubGVuZ3RoXG5cbiAgICBjb25zdCBzcGF3bmFibGVDaGlsZHJlbiA9IE1hdGgubWF4KDAsIHRoaXMucG9vbGVkUnVubmVyQ291bnQgLSB0aGlzLnBvb2xlZENoaWxkcmVuLnNpemUpXG5cbiAgICByZXR1cm4gTWF0aC5tYXgoMCwgb3BlbkluRXhpc3RpbmcgKyBzcGF3bmFibGVDaGlsZHJlbiAqIHRoaXMucG9vbGVkUnVubmVyQ29uY3VycmVuY3kgLSBxdWV1ZWRSZXNlcnZhdGlvbnMpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBhIHBheWxvYWQgb24gYSBwb29sZWQgY2hpbGQgd2l0aCBhIGZyZWUgY29uY3VycmVuY3kgc2xvdCwgc3Bhd25pbmcgYVxuICAgKiBuZXcgY2hpbGQgd2hlbiBldmVyeSBub24tcmV0aXJpbmcgY2hpbGQgaXMgZnVsbCBhbmQgdGhlIHBvb2wgaXMgYmVsb3dcbiAgICogYHBvb2xlZFJ1bm5lckNvdW50YC4gRWFjaCBjaGlsZCBydW5zIHVwIHRvIGBwb29sZWRSdW5uZXJDb25jdXJyZW5jeWAgam9icyBhdFxuICAgKiBvbmNlIG9uIGl0cyBvd24gZXZlbnQgbG9vcC5cbiAgICpcbiAgICogV2hlbiB0aGUgcG9vbCBpcyBhbHJlYWR5IGF0IGl0cyBoYXJkIGNhcCAodG90YWwgbGl2ZSBjaGlsZHJlbiwgZHJhaW5pbmdcbiAgICogaW5jbHVkZWQpLCB0aGUgam9iIHdhaXRzIGZvciBhIHNsb3QgaW5zdGVhZCBvZiBzcGF3bmluZzogdGhhdCBpcyB3aGF0IGtlZXBzXG4gICAqIHRoZSBsaXZlLWNoaWxkIGNvdW50IOKAlCBhbmQgdGhlcmVmb3JlIHRoZSBwb29sJ3MgdG90YWwgUlNTIOKAlCBib3VuZGVkLiBUaGVcbiAgICogd2FpdCByZXNvbHZlcyBvbiB0aGUgb25seSB0d28gY2FwYWNpdHktZnJlZWluZyB0cmFuc2l0aW9ucyAoYSBqb2Igb3V0Y29tZSxcbiAgICogYSBjaGlsZCBleGl0KTsgYSBzYWZldHkgcG9sbCBjb3ZlcnMgYW55dGhpbmcgbWlzc2VkLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vdHlwZXMuanNcIikuQmFja2dyb3VuZEpvYlBheWxvYWQgJiB7aWQ6IHN0cmluZ319IHBheWxvYWQgLSBKb2IgcGF5bG9hZC5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgYWZ0ZXIgdGhlIGR1cmFibGUgcmVwb3J0LlxuICAgKi9cbiAgYXN5bmMgX3J1blBvb2xlZEpvYihwYXlsb2FkKSB7XG4gICAgLy8gQXQgdGhlIGhhcmQgY2FwIChubyBmcmVlIHNsb3QsIG5vIHNwYXduYWJsZSBjaGlsZCkgdGhlIGpvYiB3YWl0cyBmb3IgYVxuICAgIC8vIHNsb3QgaW5zdGVhZCBvZiBzcGF3bmluZyBhbiBvdmVyLWNhcGFjaXR5IGNoaWxkIOKAlCB0aGF0IGlzIHdoYXQgYm91bmRzXG4gICAgLy8gdGhlIGxpdmUtY2hpbGQgY291bnQgYW5kIHRoZSBwb29sJ3MgdG90YWwgUlNTLlxuICAgIGxldCBjaGlsZCA9IHRoaXMuX3NlbGVjdFBvb2xlZENoaWxkKClcbiAgICB3aGlsZSAoIWNoaWxkKSB7XG4gICAgICBpZiAodGhpcy5fc3Bhd25hYmxlUG9vbGVkQ2hpbGRyZW4oKSA9PT0gMCkge1xuICAgICAgICAvLyBTaHV0ZG93bjogbWFpbiBubyBsb25nZXIgZGlzcGF0Y2hlcyBhbmQgbm8gc2xvdCB3aWxsIGV2ZXIgZnJlZSDigJRcbiAgICAgICAgLy8gc3RvcCB3YWl0aW5nIHNvIHRoZSB0cmFja2VkIGpvYiBjYW4gc2V0dGxlIGFuZCB0aGUgZHJhaW4gY29tcGxldGVzLlxuICAgICAgICBpZiAodGhpcy5zaG91bGRTdG9wKSByZXR1cm5cbiAgICAgICAgYXdhaXQgdGhpcy5fd2FpdFBvb2xlZFNsb3QoKVxuICAgICAgICBjaGlsZCA9IHRoaXMuX3NlbGVjdFBvb2xlZENoaWxkKClcbiAgICAgICAgY29udGludWVcbiAgICAgIH1cbiAgICAgIGNoaWxkID0gdGhpcy5fc2VsZWN0UG9vbGVkQ2hpbGQoKSB8fCB0aGlzLl9jcmVhdGVQb29sZWRDaGlsZCgpXG4gICAgfVxuXG4gICAgY29uc3Qgc3RhdGUgPSB0aGlzLnBvb2xlZENoaWxkU3RhdGVzLmdldChjaGlsZClcbiAgICBpZiAoIXN0YXRlKSB0aHJvdyBuZXcgRXJyb3IoXCJQb29sZWQgcnVubmVyIHN0YXRlIG1pc3NpbmdcIilcblxuICAgIC8vIFN0YW1wIHRoZSByb3VuZC1yb2JpbiBjdXJzb3Igc28gdGhlIG5leHQgZGlzcGF0Y2ggcHJlZmVycyBhIGRpZmZlcmVudCBjaGlsZC5cbiAgICBzdGF0ZS5sYXN0RGlzcGF0Y2hTZXEgPSArK3RoaXMuX3Bvb2xlZERpc3BhdGNoU2VxXG5cbiAgICAvKipcbiAgICAgKiBSZXNvbHZlcyB0aGUgcG9vbGVkIGpvYiBwcm9taXNlLlxuICAgICAqIEB0eXBlIHsodmFsdWU6IHZvaWQpID0+IHZvaWR9XG4gICAgICovXG4gICAgbGV0IHJlc29sdmVQb29sZWRKb2IgPSAoKSA9PiB7fVxuICAgIGNvbnN0IHBvb2xlZEpvYiA9IG5ldyBQcm9taXNlKChyZXNvbHZlKSA9PiB7IHJlc29sdmVQb29sZWRKb2IgPSByZXNvbHZlIH0pXG4gICAgY29uc3QgdGltZW91dFRpbWVyID0gdGhpcy5fYXJtUG9vbGVkSm9iVGltZW91dCh7Y2hpbGQsIHBheWxvYWR9KVxuXG4gICAgc3RhdGUuaW5mbGlnaHQuc2V0KHBheWxvYWQuaWQsIHtwYXlsb2FkLCByZXNvbHZlOiByZXNvbHZlUG9vbGVkSm9iLCBwb29sZWRKb2IsIHRpbWVvdXRUaW1lcn0pXG4gICAgdHJ5IHtcbiAgICAgIGNoaWxkLnNlbmQoe3R5cGU6IFwiam9iXCIsIHBheWxvYWQsIHNoYXJlZFRyYW5zYWN0aW9uQnJva2VyOiB0aGlzLl9wb29sZWRKb2JTaGFyZWRUcmFuc2FjdGlvbkJyb2tlckNvbmZpZygpfSlcbiAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgdm9pZCB0aGlzLl9oYW5kbGVQb29sZWRDaGlsZEZhaWx1cmUoe2NoaWxkLCBlcnJvciwgb3JpZ2luOiBcImlwYy1zZW5kXCJ9KVxuICAgIH1cblxuICAgIHJldHVybiBwb29sZWRKb2JcbiAgfVxuXG4gIC8qKlxuICAgKiBDYXB0dXJlcyB0aGUgY3VycmVudCB0ZXN0IGF0dGVtcHQncyBicm9rZXIgbW9kZSBhdCBkaXNwYXRjaCB0aW1lLiBBIHdhcm1cbiAgICogcG9vbGVkIGNoaWxkIG11c3QgbmV2ZXIgcmVseSBvbiBpdHMgaW1tdXRhYmxlIGZvcmstdGltZSBlbnZpcm9ubWVudC5cbiAgICogQHJldHVybnMge2ltcG9ydChcIi4uL3Rlc3Rpbmcvc2hhcmVkLXRyYW5zYWN0aW9uLXByb3h5LWRyaXZlci5qc1wiKS5TaGFyZWRUcmFuc2FjdGlvbkJyb2tlckpvYkNvbmZpZ30gLSBQZXItam9iIGJyb2tlciBjb25maWd1cmF0aW9uLlxuICAgKi9cbiAgX3Bvb2xlZEpvYlNoYXJlZFRyYW5zYWN0aW9uQnJva2VyQ29uZmlnKCkge1xuICAgIGNvbnN0IHNlcmlhbGl6ZWQgPSBwcm9jZXNzLmVudi5WRUxPQ0lPVVNfVEVTVF9TSEFSRURfVFJBTlNBQ1RJT05fQlJPS0VSXG4gICAgaWYgKCFzZXJpYWxpemVkKSByZXR1cm4ge2V4cGVjdGVkOiBmYWxzZX1cblxuICAgIGNvbnN0IGNvbmZpZyA9IEpTT04ucGFyc2UoQnVmZmVyLmZyb20oc2VyaWFsaXplZCwgXCJiYXNlNjR1cmxcIikudG9TdHJpbmcoXCJ1dGY4XCIpKVxuICAgIHJldHVybiB7Li4uY29uZmlnLCBleHBlY3RlZDogdHJ1ZX1cbiAgfVxuXG4gIC8qKlxuICAgKiBTZWxlY3RzIGEgcG9vbGVkIGNoaWxkIHRvIHJ1biB0aGUgbmV4dCBqb2IsIG9yIHVuZGVmaW5lZCB3aGVuIGV2ZXJ5IG5vbi1yZXRpcmluZ1xuICAgKiBjaGlsZCBpcyBhbHJlYWR5IGZ1bGwgKHRoZSBjYWxsZXIgdGhlbiBsYXppbHkgc3Bhd25zIG9uZSkuIEFtb25nIGNoaWxkcmVuIHdpdGggYVxuICAgKiBmcmVlIGNvbmN1cnJlbmN5IHNsb3QsIHBpY2tzIHRoZSBvbmUgZGlzcGF0Y2hlZCBsZWFzdCByZWNlbnRseSDigJQgYSByb3VuZC1yb2JpbiB0aGF0XG4gICAqIHNwcmVhZHMgam9icyAobm90YWJseSBtdWx0aS1taW51dGUgUnVuQnVpbGRKb2JzLCBlYWNoIHBpbm5pbmcgYSB0ZW5hbnQgY29ubmVjdGlvblxuICAgKiBmb3IgaXRzIHdob2xlIHJ1bikgZXZlbmx5IGFjcm9zcyBjaGlsZHJlbiBpbnN0ZWFkIG9mIGZpcnN0LWZpdCBwYWNraW5nIHRoZSBlYXJsaWVzdFxuICAgKiBvbmUgdW50aWwgaXQgaXMgZnVsbC4gQSBmcmVzaGx5IHNwYXduZWQgb3IgcmVwbGFjZW1lbnQgY2hpbGQgdGhlcmVmb3JlIHRha2VzIGl0c1xuICAgKiBmYWlyIHNoYXJlIG9uZSBqb2IgYXQgYSB0aW1lIGFzIGl0cyB0dXJuIGNvbWVzIHVwLCByYXRoZXIgdGhhbiBhYnNvcmJpbmcgYSBidXJzdCB0b1xuICAgKiBcImNhdGNoIHVwXCIgdG8gdGhlIG90aGVycy5cbiAgICogQHJldHVybnMge2ltcG9ydChcIm5vZGU6Y2hpbGRfcHJvY2Vzc1wiKS5DaGlsZFByb2Nlc3MgfCB1bmRlZmluZWR9IC0gVGhlIGNob3NlbiBjaGlsZCwgb3IgdW5kZWZpbmVkIHdoZW4gYWxsIG5vbi1yZXRpcmluZyBjaGlsZHJlbiBhcmUgZnVsbC5cbiAgICovXG4gIF9zZWxlY3RQb29sZWRDaGlsZCgpIHtcbiAgICAvKiogQHR5cGUge2ltcG9ydChcIm5vZGU6Y2hpbGRfcHJvY2Vzc1wiKS5DaGlsZFByb2Nlc3MgfCB1bmRlZmluZWR9ICovXG4gICAgbGV0IHNlbGVjdGVkXG4gICAgbGV0IHNlbGVjdGVkU2VxID0gSW5maW5pdHlcblxuICAgIGZvciAoY29uc3QgY2hpbGQgb2YgdGhpcy5wb29sZWRDaGlsZHJlbikge1xuICAgICAgY29uc3Qgc3RhdGUgPSB0aGlzLnBvb2xlZENoaWxkU3RhdGVzLmdldChjaGlsZClcblxuICAgICAgaWYgKCFzdGF0ZSB8fCBzdGF0ZS5yZXRpcmluZyB8fCBzdGF0ZS5pbmZsaWdodC5zaXplID49IHRoaXMucG9vbGVkUnVubmVyQ29uY3VycmVuY3kpIGNvbnRpbnVlXG5cbiAgICAgIGlmIChzdGF0ZS5sYXN0RGlzcGF0Y2hTZXEgPCBzZWxlY3RlZFNlcSkge1xuICAgICAgICBzZWxlY3RlZCA9IGNoaWxkXG4gICAgICAgIHNlbGVjdGVkU2VxID0gc3RhdGUubGFzdERpc3BhdGNoU2VxXG4gICAgICB9XG4gICAgfVxuXG4gICAgcmV0dXJuIHNlbGVjdGVkXG4gIH1cblxuICAvKipcbiAgICogQXJtcyBhIHBlci1qb2Igd2FsbC1jbG9jayBiYWNrc3RvcCBmb3IgYSBwb29sZWQgam9iLiBBIHBvb2xlZCBjaGlsZCBob3N0cyBtYW55XG4gICAqIGNvbmN1cnJlbnQgam9icywgc28gYSBzaW5nbGUgZ2VudWluZWx5LWh1bmcgam9iIHdvdWxkIG90aGVyd2lzZSBwaW4gaXRzXG4gICAqIHJ1bm5lcidzIGNvbmN1cnJlbmN5IHNsb3QgZm9yZXZlciDigJQgdGhlIGxpZmV0aW1lIHJlY3ljbGUgb25seSByZXRpcmVzIGEgY2hpbGRcbiAgICogb25jZSBpdHMgaW4tZmxpZ2h0IHNldCBkcmFpbnMsIHdoaWNoIGEgaHVuZyBqb2IgbmV2ZXIgZG9lcy4gT24gb3ZlcnJ1biB0aGVcbiAgICogd2hvbGUgY2hpbGQgaXMgdGVybWluYXRlZCBzbyB0aGUgaHVuZyBqb2IgKGFuZCBpdHMgc2libGluZ3MpIHJlcXVldWUuIFJldHVybnNcbiAgICogdGhlIHRpbWVyLCBvciBudWxsIHdoZW4gbm8gdGltZW91dCBpcyBjb25maWd1cmVkLlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIE9wdGlvbnMuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwibm9kZTpjaGlsZF9wcm9jZXNzXCIpLkNoaWxkUHJvY2Vzc30gYXJncy5jaGlsZCAtIFBvb2xlZCBjaGlsZC5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL3R5cGVzLmpzXCIpLkJhY2tncm91bmRKb2JQYXlsb2FkICYge2lkOiBzdHJpbmd9fSBhcmdzLnBheWxvYWQgLSBKb2IgcGF5bG9hZCB3aG9zZSBvdmVycnVuIGlzIGd1YXJkZWQuXG4gICAqIEByZXR1cm5zIHtSZXR1cm5UeXBlPHR5cGVvZiBzZXRUaW1lb3V0PiB8IG51bGx9IC0gVGhlIGFybWVkIHRpbWVyLCBvciBudWxsLlxuICAgKi9cbiAgX2FybVBvb2xlZEpvYlRpbWVvdXQoe2NoaWxkLCBwYXlsb2FkfSkge1xuICAgIGNvbnN0IHRpbWVvdXRNcyA9IHRoaXMuX3Jlc29sdmVKb2JUaW1lb3V0TXMocGF5bG9hZC5vcHRpb25zKVxuXG4gICAgaWYgKCEodHlwZW9mIHRpbWVvdXRNcyA9PT0gXCJudW1iZXJcIiAmJiB0aW1lb3V0TXMgPiAwKSkgcmV0dXJuIG51bGxcblxuICAgIHJldHVybiBzZXRUaW1lb3V0KCgpID0+IHRoaXMuX29uUG9vbGVkSm9iVGltZW91dCh7Y2hpbGQsIGpvYklkOiBwYXlsb2FkLmlkfSksIHRpbWVvdXRNcylcbiAgfVxuXG4gIC8qKlxuICAgKiBGaXJlZCB3aGVuIGEgcG9vbGVkIGpvYiBvdmVycnVucyBpdHMgdGltZW91dC4gVGVybWluYXRlcyB0aGUgY2hpbGQgcnVubmluZyBpdFxuICAgKiAoU0lHVEVSTSwgdGhlbiBTSUdLSUxMIGFmdGVyIHRoZSBncmFjZSkg4oCUIGEgaHVuZyBKUyBqb2IgY2Fubm90IGJlIGNhbmNlbGxlZFxuICAgKiBhbnkgb3RoZXIgd2F5LiBUaGUgbm9uLWNsZWFuIGV4aXQgZmxvd3MgdGhyb3VnaCBgX2hhbmRsZVBvb2xlZENoaWxkRmFpbHVyZWAsXG4gICAqIHdoaWNoIHJlcG9ydHMgZXZlcnkgaW4tZmxpZ2h0IGpvYiBvbiB0aGUgY2hpbGQgZmFpbGVkIChzbyB0aGV5IHJlcXVldWUpIGFuZFxuICAgKiBkcm9wcyBpdCBmcm9tIHRyYWNraW5nOyB0aGUgZmFpbHVyZSBwYXRoIGltbWVkaWF0ZWx5IHJlLWFkdmVydGlzZXMgdGhlXG4gICAqIHJlc3VsdGluZyBjYXBhY2l0eSBvbmNlIHRoZSBydW5uZXIgaGFzIGNvbXBsZXRlZCBzdGFydHVwLlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIE9wdGlvbnMuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwibm9kZTpjaGlsZF9wcm9jZXNzXCIpLkNoaWxkUHJvY2Vzc30gYXJncy5jaGlsZCAtIFBvb2xlZCBjaGlsZC5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGFyZ3Muam9iSWQgLSBKb2IgaWQgdGhhdCBvdmVycmFuLlxuICAgKiBAcmV0dXJucyB7dm9pZH1cbiAgICovXG4gIF9vblBvb2xlZEpvYlRpbWVvdXQoe2NoaWxkLCBqb2JJZH0pIHtcbiAgICBjb25zdCBzdGF0ZSA9IHRoaXMucG9vbGVkQ2hpbGRTdGF0ZXMuZ2V0KGNoaWxkKVxuXG4gICAgLy8gQWxyZWFkeSBzZXR0bGluZy9nb25lLCBvciB0aGUgam9iIGZpbmlzaGVkIGluIHRoZSByYWNlIHdpdGggdGhpcyB0aW1lci5cbiAgICBpZiAoIXN0YXRlIHx8IHN0YXRlLnNldHRsaW5nIHx8IHN0YXRlLnNodXRkb3duUmVhc29uIHx8ICFzdGF0ZS5pbmZsaWdodC5oYXMoam9iSWQpKSByZXR1cm5cblxuICAgIHN0YXRlLnRpbWVvdXRKb2JJZCA9IGpvYklkXG4gICAgdGhpcy5fcmVxdWVzdFBvb2xlZENoaWxkU2h1dGRvd24oe2NoaWxkLCByZWFzb246IFwiam9iX3RpbWVvdXRcIiwgc2lnbmFsOiBcIlNJR1RFUk1cIn0pXG5cbiAgICBzdGF0ZS50aW1lb3V0U2lna2lsbFRpbWVyID0gc2V0VGltZW91dCgoKSA9PiB7XG4gICAgICB0cnkge1xuICAgICAgICBjaGlsZC5raWxsKFwiU0lHS0lMTFwiKVxuICAgICAgfSBjYXRjaCB7XG4gICAgICAgIC8vIENoaWxkIGFscmVhZHkgZXhpdGVkOyBub3RoaW5nIHRvIGRvLlxuICAgICAgfVxuICAgIH0sIHRoaXMuZm9ya2VkQ2hpbGRTaWdraWxsR3JhY2VNcylcbiAgfVxuXG4gIC8qKlxuICAgKiBDcmVhdGVzIGEgcmV1c2FibGUgcG9vbGVkIGNoaWxkLCBlbmZvcmNpbmcgdGhlIGhhcmQgY2FwIG9uIHRvdGFsIGxpdmVcbiAgICogY2hpbGRyZW4gKHdvcmtpbmcgKyBkcmFpbmluZykuIFJldHVybnMgdW5kZWZpbmVkIHdoZW4gdGhlIGNhcCBpcyBhbHJlYWR5XG4gICAqIG1ldCDigJQgdGhlIG9ubHkgd2F5IGEgbmV3IGNoaWxkIG1heSBleGlzdCBpcyBhIHNsb3QgYmVpbmcgb3Blbiwgc28gdGhlXG4gICAqIGNhbGxlciByZS1jaGVja3MgYW5kIHdhaXRzIGFnYWluLiBgYWxsb3dPdmVyQ2FwYCBpcyByZXNlcnZlZCBmb3IgdGhlXG4gICAqIGJvdW5kZWQgbGl2ZW5lc3MgcmVwbGFjZW1lbnQ6IGF0IG1vc3Qgb25lIGNoaWxkIGJleW9uZCB0aGUgY2FwIG1heSBleGlzdCxcbiAgICogYW5kIG9ubHkgd2hlbiBldmVyeSBvdGhlciBsaXZlIGNoaWxkIGlzIGFscmVhZHkgcmV0aXJpbmcgKHNlZVxuICAgKiBgX2JlZ2luUmV0aXJlUG9vbGVkQ2hpbGRgIGZvciB0aGUgZ2F0ZSkuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBbYXJnc10gLSBTcGF3biBvcHRpb25zLlxuICAgKiBAcGFyYW0ge2Jvb2xlYW59IFthcmdzLmFsbG93T3ZlckNhcF0gLSBBbGxvdyBvbmUgb3Zlci1jYXAgc3Bhd24gZm9yIHRoZSBsaXZlbmVzcyByZXBsYWNlbWVudC5cbiAgICogQHJldHVybnMge2ltcG9ydChcIm5vZGU6Y2hpbGRfcHJvY2Vzc1wiKS5DaGlsZFByb2Nlc3MgfCB1bmRlZmluZWR9IC0gVGhlIG5ldyBjaGlsZCwgb3IgdW5kZWZpbmVkIHdoZW4gdGhlIHBvb2wgaXMgYXQgaXRzIGNhcC5cbiAgICovXG4gIF9jcmVhdGVQb29sZWRDaGlsZCh7YWxsb3dPdmVyQ2FwID0gZmFsc2V9ID0ge30pIHtcbiAgICBjb25zdCBjb25maWd1cmF0aW9uID0gdGhpcy5jb25maWd1cmF0aW9uXG4gICAgaWYgKCFjb25maWd1cmF0aW9uKSB0aHJvdyBuZXcgRXJyb3IoXCJCYWNrZ3JvdW5kIGpvYnMgd29ya2VyIGNvbmZpZ3VyYXRpb24gbm90IGluaXRpYWxpemVkXCIpXG4gICAgaWYgKCFhbGxvd092ZXJDYXAgJiYgdGhpcy5wb29sZWRDaGlsZHJlbi5zaXplID49IHRoaXMucG9vbGVkUnVubmVyQ291bnQpIHJldHVybiB1bmRlZmluZWRcbiAgICBjb25zdCBjaGlsZCA9IGZvcmsoUE9PTEVEX1JVTk5FUl9FTlRSWV9QQVRILCBbXSwge1xuICAgICAgY3dkOiBjb25maWd1cmF0aW9uLmdldERpcmVjdG9yeSgpLCBleGVjQXJndjogdGhpcy5fY2hpbGRSdW5uZXJFeGVjQXJndigpLCBzdGRpbzogW1wiaWdub3JlXCIsIFwiaWdub3JlXCIsIFwiaWdub3JlXCIsIFwiaXBjXCJdLFxuICAgICAgZW52OiBPYmplY3QuYXNzaWduKHt9LCBwcm9jZXNzLmVudiwgdGhpcy5fY2hpbGRCYWNrZ3JvdW5kSm9ic0Vudmlyb25tZW50KCkpXG4gICAgfSlcbiAgICB0aGlzLnBvb2xlZENoaWxkcmVuLmFkZChjaGlsZClcbiAgICB0aGlzLmluZmxpZ2h0UHJvY2Vzc0NoaWxkcmVuLmFkZChjaGlsZClcbiAgICB0aGlzLnBvb2xlZENoaWxkU3RhdGVzLnNldChjaGlsZCwge2NyZWF0ZWRBdE1zOiBEYXRlLm5vdygpLCBqb2JzUnVuOiAwLCBpbmZsaWdodDogbmV3IE1hcCgpLCBsYXN0RGlzcGF0Y2hTZXE6IDAsIHJldGlyaW5nOiBmYWxzZSwgc3RhcnRlZDogZmFsc2V9KVxuICAgIGNoaWxkLm9uKFwibWVzc2FnZVwiLCAobWVzc2FnZSkgPT4gdGhpcy5faGFuZGxlUG9vbGVkQ2hpbGRNZXNzYWdlKHtjaGlsZCwgbWVzc2FnZX0pKVxuICAgIGNoaWxkLm9uY2UoXCJleGl0XCIsIChleGl0Q29kZSwgc2lnbmFsKSA9PiB0aGlzLl9oYW5kbGVQb29sZWRDaGlsZEZhaWx1cmUoe1xuICAgICAgY2hpbGQsXG4gICAgICBlcnJvcjogbmV3IEVycm9yKGBQb29sZWQgYmFja2dyb3VuZCBqb2IgcnVubmVyIGV4aXRlZDogY29kZT0ke2V4aXRDb2RlfSBzaWduYWw9JHtzaWduYWwgfHwgXCJub25lXCJ9YCksXG4gICAgICBleGl0Q29kZSxcbiAgICAgIG9yaWdpbjogXCJleGl0XCIsXG4gICAgICBzaWduYWxcbiAgICB9KSlcbiAgICBjaGlsZC5vbmNlKFwiZXJyb3JcIiwgKGVycm9yKSA9PiB0aGlzLl9oYW5kbGVQb29sZWRDaGlsZEZhaWx1cmUoe1xuICAgICAgY2hpbGQsXG4gICAgICBlcnJvcixcbiAgICAgIGV4aXRDb2RlOiBjaGlsZC5leGl0Q29kZSxcbiAgICAgIG9yaWdpbjogXCJwcm9jZXNzLWVycm9yXCIsXG4gICAgICBzaWduYWw6IGNoaWxkLnNpZ25hbENvZGVcbiAgICB9KSlcbiAgICBjaGlsZC5vbmNlKFwiZGlzY29ubmVjdFwiLCAoKSA9PiB7XG4gICAgICBjb25zdCBzdGF0ZSA9IHRoaXMucG9vbGVkQ2hpbGRTdGF0ZXMuZ2V0KGNoaWxkKVxuICAgICAgaWYgKHN0YXRlKSBzdGF0ZS5pcGNEaXNjb25uZWN0ZWRBdE1zID8/PSBEYXRlLm5vdygpXG4gICAgfSlcbiAgICByZXR1cm4gY2hpbGRcbiAgfVxuXG4gIC8qKlxuICAgKiBIYW5kbGVzIGEgcG9vbGVkIGNoaWxkJ3MgcGVyLWpvYiBkdXJhYmxlLXJlcG9ydCBhY2tub3dsZWRnZW1lbnQuIEEgY2hpbGRcbiAgICogcnVucyBqb2JzIGNvbmN1cnJlbnRseSBhbmQgcmVwb3J0cyBvbmUgYGpvYi1vdXRjb21lYCBwZXIgam9iIGlkLlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIE1lc3NhZ2UgZGV0YWlscy5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCJub2RlOmNoaWxkX3Byb2Nlc3NcIikuQ2hpbGRQcm9jZXNzfSBhcmdzLmNoaWxkIC0gUG9vbGVkIGNoaWxkLlxuICAgKiBAcGFyYW0ge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSBhcmdzLm1lc3NhZ2UgLSBJUEMgbWVzc2FnZS5cbiAgICogQHJldHVybnMge3ZvaWR9XG4gICAqL1xuICBfaGFuZGxlUG9vbGVkQ2hpbGRNZXNzYWdlKHtjaGlsZCwgbWVzc2FnZX0pIHtcbiAgICBpZiAoIW1lc3NhZ2UgfHwgdHlwZW9mIG1lc3NhZ2UgIT09IFwib2JqZWN0XCIpIHJldHVyblxuICAgIGNvbnN0IHJlY29yZCA9IC8qKiBAdHlwZSB7e3R5cGU/OiBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPiwgY2hpbGRJbnN0YW5jZUlkPzogUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4sIGpvYklkPzogUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4sIGFja25vd2xlZGdlZD86IFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+LCByc3NCeXRlcz86IFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+LCBwZWFrUnNzQnl0ZXM/OiBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPiwgZXJyb3I/OiBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn19ICovIChtZXNzYWdlKVxuICAgIGNvbnN0IHN0YXRlID0gdGhpcy5wb29sZWRDaGlsZFN0YXRlcy5nZXQoY2hpbGQpXG4gICAgaWYgKHJlY29yZC50eXBlID09PSBcInJlYWR5XCIpIHtcbiAgICAgIGlmIChzdGF0ZSkge1xuICAgICAgICBzdGF0ZS5zdGFydGVkID0gdHJ1ZVxuICAgICAgICBpZiAodHlwZW9mIHJlY29yZC5jaGlsZEluc3RhbmNlSWQgPT09IFwic3RyaW5nXCIpIHN0YXRlLmNoaWxkSW5zdGFuY2VJZCA9IHJlY29yZC5jaGlsZEluc3RhbmNlSWRcbiAgICAgIH1cbiAgICAgIHJldHVyblxuICAgIH1cbiAgICBpZiAoaXNDaGlsZFNodXRkb3duT2JzZXJ2YXRpb25NZXNzYWdlKG1lc3NhZ2UpKSB7XG4gICAgICBpZiAoc3RhdGUpIHtcbiAgICAgICAgc3RhdGUuY2hpbGRJbnN0YW5jZUlkID0gbWVzc2FnZS5jaGlsZEluc3RhbmNlSWRcbiAgICAgICAgc3RhdGUuc2h1dGRvd25PYnNlcnZhdGlvbiA9IG1lc3NhZ2VcbiAgICAgICAgaWYgKHN0YXRlLnNodXRkb3duU2lnbmFsVGltZXIpIHtcbiAgICAgICAgICBjbGVhclRpbWVvdXQoc3RhdGUuc2h1dGRvd25TaWduYWxUaW1lcilcbiAgICAgICAgICBzdGF0ZS5zaHV0ZG93blNpZ25hbFRpbWVyID0gdW5kZWZpbmVkXG4gICAgICAgIH1cbiAgICAgIH1cbiAgICAgIHJldHVyblxuICAgIH1cbiAgICBpZiAoaXNDaGlsZEFjY2VwdGFuY2VNZXNzYWdlKG1lc3NhZ2UpKSB7XG4gICAgICB0aGlzLl9yZXBvcnRDaGlsZEFjY2VwdGVkKG1lc3NhZ2UpXG4gICAgICByZXR1cm5cbiAgICB9XG4gICAgaWYgKGlzUG9vbGVkQ2hpbGRNZW1vcnlPYnNlcnZhdGlvbk1lc3NhZ2UobWVzc2FnZSkpIHtcbiAgICAgIHRoaXMuX2hhbmRsZVBvb2xlZENoaWxkTWVtb3J5T2JzZXJ2YXRpb24oe2NoaWxkLCBtZXNzYWdlfSlcbiAgICAgIHJldHVyblxuICAgIH1cbiAgICBpZiAocmVjb3JkLnR5cGUgIT09IFwiam9iLW91dGNvbWVcIiB8fCAhc3RhdGUgfHwgc3RhdGUuc2V0dGxpbmcgfHwgdHlwZW9mIHJlY29yZC5qb2JJZCAhPT0gXCJzdHJpbmdcIikgcmV0dXJuXG4gICAgc3RhdGUuc3RhcnRlZCA9IHRydWVcbiAgICBjb25zdCBlbnRyeSA9IHN0YXRlLmluZmxpZ2h0LmdldChyZWNvcmQuam9iSWQpXG4gICAgaWYgKCFlbnRyeSkgcmV0dXJuXG5cbiAgICBpZiAoZW50cnkudGltZW91dFRpbWVyKSBjbGVhclRpbWVvdXQoZW50cnkudGltZW91dFRpbWVyKVxuICAgIHN0YXRlLmluZmxpZ2h0LmRlbGV0ZShyZWNvcmQuam9iSWQpXG4gICAgc3RhdGUuam9ic1J1biArPSAxXG4gICAgY29uc3QgcmVzb2x2ZSA9IGVudHJ5LnJlc29sdmVcblxuICAgIGlmIChyZWNvcmQuYWNrbm93bGVkZ2VkID09PSB0cnVlKSB7XG4gICAgICBpZiAocmVzb2x2ZSkgcmVzb2x2ZSh1bmRlZmluZWQpXG4gICAgfSBlbHNlIHtcbiAgICAgIC8vIFRoZSBjaGlsZCBzdGF5ZWQgYWxpdmUgYnV0IGNvdWxkIG5vdCBjb25maXJtIHRoaXMgb25lIGpvYidzIHRlcm1pbmFsXG4gICAgICAvLyByZXBvcnQ7IHJlY2xhaW0ganVzdCB0aGlzIGpvYiDigJQgaXRzIGNvbmN1cnJlbnQgc2libGluZ3MgYXJlIHVuYWZmZWN0ZWQuXG4gICAgICB2b2lkIHRoaXMuX3JlcG9ydEpvYlJlc3VsdCh7XG4gICAgICAgIGpvYklkOiBlbnRyeS5wYXlsb2FkLmlkLFxuICAgICAgICBzdGF0dXM6IFwiZmFpbGVkXCIsXG4gICAgICAgIGVycm9yOiBuZXcgRXJyb3IodHlwZW9mIHJlY29yZC5lcnJvciA9PT0gXCJzdHJpbmdcIiA/IHJlY29yZC5lcnJvciA6IFwiUG9vbGVkIHJ1bm5lciB0ZXJtaW5hbCByZXBvcnQgd2FzIG5vdCBhY2tub3dsZWRnZWRcIiksXG4gICAgICAgIGhhbmRvZmZJZDogZW50cnkucGF5bG9hZC5oYW5kb2ZmSWQsXG4gICAgICAgIGhhbmRlZE9mZkF0TXM6IGVudHJ5LnBheWxvYWQuaGFuZGVkT2ZmQXRNcyxcbiAgICAgICAgd29ya2VySWQ6IGVudHJ5LnBheWxvYWQud29ya2VySWQgfHwgdGhpcy53b3JrZXJJZFxuICAgICAgfSkuZmluYWxseSgoKSA9PiB7IGlmIChyZXNvbHZlKSByZXNvbHZlKHVuZGVmaW5lZCkgfSlcbiAgICB9XG5cbiAgICBjb25zdCByc3NCeXRlcyA9IHR5cGVvZiByZWNvcmQucnNzQnl0ZXMgPT09IFwibnVtYmVyXCIgPyByZWNvcmQucnNzQnl0ZXMgOiBOdW1iZXIuUE9TSVRJVkVfSU5GSU5JVFlcbiAgICAvLyBUaGUgY2hpbGQncyBwZWFrIFJTUyAoVm1IV00pIGlzIG1vbm90b25pYyBhbmQgb3V0bGl2ZXMgdGhlIHNldHRsZWRcbiAgICAvLyBzYW1wbGU6IGEgcmF0Y2hldGVkIGJ1cnN0IHdvcmtpbmctc2V0IG11c3QgcmVjeWNsZSB0aGUgY2hpbGQgZXZlbiB3aGVuXG4gICAgLy8gc2V0dGxlZCBSU1MgYXQgb3V0Y29tZSB0aW1lIGxvb2tzIG1vZGVzdC4gQSBjaGlsZCB3aXRob3V0IHBlYWsgc3VwcG9ydFxuICAgIC8vIGZhbGxzIGJhY2sgdG8gdGhlIHNldHRsZWQgc2FtcGxlLlxuICAgIGNvbnN0IHBlYWtSc3NCeXRlcyA9IHR5cGVvZiByZWNvcmQucGVha1Jzc0J5dGVzID09PSBcIm51bWJlclwiID8gcmVjb3JkLnBlYWtSc3NCeXRlcyA6IHJzc0J5dGVzXG4gICAgY29uc3QgcnVubmVyQWdlTXMgPSBEYXRlLm5vdygpIC0gc3RhdGUuY3JlYXRlZEF0TXNcbiAgICBpZiAoIXN0YXRlLnJldGlyaW5nICYmIChzdGF0ZS5qb2JzUnVuID49IHRoaXMucG9vbGVkUnVubmVyTWF4Sm9icyB8fCBwZWFrUnNzQnl0ZXMgPj0gdGhpcy5wb29sZWRSdW5uZXJNYXhSc3NCeXRlcyB8fCBydW5uZXJBZ2VNcyA+PSB0aGlzLnBvb2xlZFJ1bm5lck1heExpZmV0aW1lTXMgfHwgdGhpcy5zaG91bGRTdG9wKSkge1xuICAgICAgdGhpcy5fYmVnaW5SZXRpcmVQb29sZWRDaGlsZChjaGlsZClcbiAgICB9XG4gICAgdGhpcy5fdGVybWluYXRlSWZEcmFpbmVkKGNoaWxkKVxuICAgIC8vIEEgam9iIG91dGNvbWUgZnJlZXMgYSBjb25jdXJyZW5jeSBzbG90IGFuZCBtYXkgZHJhaW4gYSByZXRpcmluZyBjaGlsZCDigJRcbiAgICAvLyB0aGUgb25seSB0d28gdHJhbnNpdGlvbnMgdGhhdCBmcmVlIGNhcGFjaXR5IGZvciB3YWl0ZXJzIGF0IHRoZSBoYXJkIGNhcC5cbiAgICB0aGlzLl93YWtlUG9vbGVkU2xvdFdhaXRlcnMoKVxuICB9XG5cbiAgLyoqXG4gICAqIEZvcndhcmRzIG9uZSBwb29sZWQgY2hpbGQncyBhY2NlcHRhbmNlIG9ic2VydmF0aW9uIHRvIG1haW4gYXMgYSBib3VuZGVkXG4gICAqIGRpYWdub3N0aWMgcmVwb3J0LiBUaGUgY2hpbGQgY2FycmllcyBpdHMgZXhhY3QgaGFuZG9mZiBsZWFzZSwgc28gYSB0aW1lb3V0XG4gICAqIG9yIG91dGNvbWUgdGhhdCBhbHJlYWR5IHNldHRsZWQgdGhlIHdvcmtlcidzIGluLWZsaWdodCBlbnRyeSBjYW5ub3QgbG9zZVxuICAgKiB0aGUgZmVuY2luZy4gQSByZXBvcnQgdGhhdCBuZXZlciBsYW5kcyBkZWdyYWRlcyBwaGFzZSBkaWFnbm9zdGljcyBmb3IgdGhhdFxuICAgKiBqb2Igb25seSDigJQgaXQgbXVzdCBuZXZlciBibG9jayBvciBmYWlsIHRoZSBqb2IgaXRzZWxmLlxuICAgKiBAcGFyYW0ge3t0eXBlOiBcImpvYi1yZWNlaXZlZFwiIHwgXCJqb2Itc3RhcnRlZFwiLCBqb2JJZDogc3RyaW5nLCBoYW5kb2ZmSWQ/OiBzdHJpbmcsIHdvcmtlcklkPzogc3RyaW5nLCBoYW5kZWRPZmZBdE1zPzogbnVtYmVyLCByZWNlaXZlZEF0TXM/OiBudW1iZXIsIHN0YXJ0ZWRBdE1zPzogbnVtYmVyLCBjaGlsZEluc3RhbmNlSWQ/OiBzdHJpbmcsIGNoaWxkUGlkPzogbnVtYmVyLCBydW5uZXJIb3N0bmFtZT86IHN0cmluZ319IG1lc3NhZ2UgLSBWYWxpZGF0ZWQgY2hpbGQgYWNjZXB0YW5jZSBtZXNzYWdlLlxuICAgKiBAcmV0dXJucyB7dm9pZH1cbiAgICovXG4gIF9yZXBvcnRDaGlsZEFjY2VwdGVkKG1lc3NhZ2UpIHtcbiAgICBpZiAoIXRoaXMuc3RhdHVzUmVwb3J0ZXIpIHJldHVyblxuXG4gICAgdm9pZCB0aGlzLnN0YXR1c1JlcG9ydGVyLnJlcG9ydENoaWxkQWNjZXB0ZWRXaXRoUmV0cnkoe1xuICAgICAgam9iSWQ6IG1lc3NhZ2Uuam9iSWQsXG4gICAgICBoYW5kb2ZmSWQ6IG1lc3NhZ2UuaGFuZG9mZklkLFxuICAgICAgd29ya2VySWQ6IG1lc3NhZ2Uud29ya2VySWQsXG4gICAgICBoYW5kZWRPZmZBdE1zOiBtZXNzYWdlLmhhbmRlZE9mZkF0TXMsXG4gICAgICByZWNlaXZlZEF0TXM6IG1lc3NhZ2UucmVjZWl2ZWRBdE1zLFxuICAgICAgc3RhcnRlZEF0TXM6IG1lc3NhZ2Uuc3RhcnRlZEF0TXMsXG4gICAgICBjaGlsZEluc3RhbmNlSWQ6IG1lc3NhZ2UuY2hpbGRJbnN0YW5jZUlkLFxuICAgICAgY2hpbGRQaWQ6IG1lc3NhZ2UuY2hpbGRQaWQsXG4gICAgICBydW5uZXJIb3N0bmFtZTogbWVzc2FnZS5ydW5uZXJIb3N0bmFtZSxcbiAgICAgIG1heER1cmF0aW9uTXM6IENISUxEX0FDQ0VQVEFOQ0VfUkVQT1JUX01BWF9EVVJBVElPTl9NU1xuICAgIH0pLmNhdGNoKChlcnJvcikgPT4ge1xuICAgICAgY29uc29sZS5lcnJvcihcIkJhY2tncm91bmQgam9iIGNoaWxkLWFjY2VwdGFuY2UgcmVwb3J0aW5nIGZhaWxlZDpcIiwgZXJyb3IpXG4gICAgfSlcbiAgfVxuXG4gIC8qKlxuICAgKiBIYW5kbGVzIGEgcG9vbGVkIGNoaWxkJ3MgYm91bmRlZCBtZW1vcnkgb2JzZXJ2YXRpb24uIFRoZSBwb29sZWQgY2hpbGQnc1xuICAgKiBzdGRpbyBpcyBpZ25vcmVkIGJ5IHRoZSB3b3JrZXIgZm9yaywgc28gdGhpcyBJUEMgb2JzZXJ2YXRpb24gaXMgaG93IGFcbiAgICogbWVtb3J5IHByb2JsZW0gaW4gYSBydW5uaW5nIGNoaWxkIG5hbWVzIGl0c2VsZi4gVGhlIHdvcmtlciAoYSkgcmVjb3JkcyB0aGVcbiAgICogbGF0ZXN0IG9ic2VydmF0aW9uIG9uIHRoZSBjaGlsZCdzIHN0YXRlIGZvciBsYXRlciBjb3JyZWxhdGlvbiwgKGIpIGxvZ3Mgb25lXG4gICAqIGNvbXBhY3QgbGluZSB0byBpdHMgb3duIHN0ZGVyciAod2hpY2ggcmVhY2hlcyB0aGUgcHJvZCBsb2csIHVubGlrZSB0aGVcbiAgICogY2hpbGQncyBpZ25vcmVkIHN0ZGlvKSwgYW5kIChjKSBmb3J3YXJkcyB0aGUgZnVsbCBvYnNlcnZhdGlvbiB0byB0aGVcbiAgICogb3B0aW9uYWwgYG9uUG9vbGVkUnVubmVyTWVtb3J5T2JzZXJ2YXRpb25gIGhvb2sgc28gYW4gYXBwbGljYXRpb24gY2FuIHJvdXRlXG4gICAqIGl0IChlLmcuIHRvIGEgYnVnIHJlcG9ydGVyKSB3aXRob3V0IHBhcnNpbmcgbG9ncy4gVGhlIGhlYXAtc3RhdCBicmVha2Rvd25cbiAgICogZGlzdGluZ3Vpc2hlcyBWOC1oZWFwIGdyb3d0aCBmcm9tIGV4dGVybmFsL2FycmF5LWJ1ZmZlciAobmF0aXZlKSBncm93dGguIEFcbiAgICogaG9vayBmYWlsdXJlIGlzIHN3YWxsb3dlZCDigJQgZGlhZ25vc3RpY3MgbXVzdCBuZXZlciB0YWtlIGRvd24gdGhlIHdvcmtlciBvclxuICAgKiBmYWlsIHRoZSBqb2JzIHJ1bm5pbmcgb24gdGhhdCBjaGlsZC5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBNZXNzYWdlIGRldGFpbHMuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwibm9kZTpjaGlsZF9wcm9jZXNzXCIpLkNoaWxkUHJvY2Vzc30gYXJncy5jaGlsZCAtIFBvb2xlZCBjaGlsZC5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL3R5cGVzLmpzXCIpLlBvb2xlZENoaWxkTWVtb3J5T2JzZXJ2YXRpb259IGFyZ3MubWVzc2FnZSAtIFZhbGlkYXRlZCBtZW1vcnkgb2JzZXJ2YXRpb24uXG4gICAqIEByZXR1cm5zIHt2b2lkfVxuICAgKi9cbiAgX2hhbmRsZVBvb2xlZENoaWxkTWVtb3J5T2JzZXJ2YXRpb24oe2NoaWxkLCBtZXNzYWdlfSkge1xuICAgIGNvbnN0IHN0YXRlID0gdGhpcy5wb29sZWRDaGlsZFN0YXRlcy5nZXQoY2hpbGQpXG4gICAgaWYgKHN0YXRlKSBzdGF0ZS5sYXN0TWVtb3J5T2JzZXJ2YXRpb24gPSBtZXNzYWdlXG5cbiAgICBjb25zdCBoZWFwID0gbWVzc2FnZS5oZWFwU3RhdGlzdGljc1xuICAgIGNvbnNvbGUuZXJyb3IoXG4gICAgICBKU09OLnN0cmluZ2lmeSh7XG4gICAgICAgIGV2ZW50OiBcInBvb2xlZC1jaGlsZC1tZW1vcnlcIixcbiAgICAgICAgY2hpbGRJbnN0YW5jZUlkOiBzdGF0ZT8uY2hpbGRJbnN0YW5jZUlkID8/IG1lc3NhZ2UuY2hpbGRJbnN0YW5jZUlkLFxuICAgICAgICBjaGlsZFBpZDogbWVzc2FnZS5jaGlsZFBpZCxcbiAgICAgICAgY2hpbGRVcHRpbWVTOiBNYXRoLnJvdW5kKG1lc3NhZ2UuY2hpbGRVcHRpbWVNcyAvIDEwMDApLFxuICAgICAgICByc3NNYjogTWF0aC5yb3VuZChtZXNzYWdlLnJzc0J5dGVzIC8gKDEwMjQgKiAxMDI0KSksXG4gICAgICAgIHBlYWtSc3NNYjogTWF0aC5yb3VuZCgodHlwZW9mIG1lc3NhZ2UucGVha1Jzc0J5dGVzID09PSBcIm51bWJlclwiID8gbWVzc2FnZS5wZWFrUnNzQnl0ZXMgOiBtZXNzYWdlLnJzc0J5dGVzKSAvICgxMDI0ICogMTAyNCkpLFxuICAgICAgICBoZWFwVXNlZE1iOiBNYXRoLnJvdW5kKGhlYXAudXNlZF9oZWFwX3NpemUgLyAoMTAyNCAqIDEwMjQpKSxcbiAgICAgICAgaGVhcFRvdGFsTWI6IE1hdGgucm91bmQoaGVhcC50b3RhbF9oZWFwX3NpemUgLyAoMTAyNCAqIDEwMjQpKSxcbiAgICAgICAgaGVhcExpbWl0TWI6IE1hdGgucm91bmQoaGVhcC5oZWFwX3NpemVfbGltaXQgLyAoMTAyNCAqIDEwMjQpKSxcbiAgICAgICAgZXh0ZXJuYWxNYjogTWF0aC5yb3VuZChtZXNzYWdlLm1lbW9yeVVzYWdlLmV4dGVybmFsIC8gKDEwMjQgKiAxMDI0KSksXG4gICAgICAgIGFycmF5QnVmZmVyc01iOiBNYXRoLnJvdW5kKG1lc3NhZ2UubWVtb3J5VXNhZ2UuYXJyYXlCdWZmZXJzIC8gKDEwMjQgKiAxMDI0KSksXG4gICAgICAgIGpvYnM6IG1lc3NhZ2Uuam9iQ291bnQsXG4gICAgICAgIGFjdGl2ZUpvYklkczogbWVzc2FnZS5hY3RpdmVKb2JJZHNcbiAgICAgIH0pXG4gICAgKVxuXG4gICAgaWYgKHRoaXMub25Qb29sZWRSdW5uZXJNZW1vcnlPYnNlcnZhdGlvbikge1xuICAgICAgdHJ5IHtcbiAgICAgICAgY29uc3QgcmVzdWx0ID0gdGhpcy5vblBvb2xlZFJ1bm5lck1lbW9yeU9ic2VydmF0aW9uKG1lc3NhZ2UpXG4gICAgICAgIGlmIChyZXN1bHQgJiYgdHlwZW9mIHJlc3VsdC5jYXRjaCA9PT0gXCJmdW5jdGlvblwiKSByZXN1bHQuY2F0Y2goKGVycm9yKSA9PiB7XG4gICAgICAgICAgY29uc29sZS5lcnJvcihcIlBvb2xlZCBydW5uZXIgbWVtb3J5IG9ic2VydmF0aW9uIGhvb2sgZmFpbGVkOlwiLCBlcnJvcilcbiAgICAgICAgfSlcbiAgICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICAgIGNvbnNvbGUuZXJyb3IoXCJQb29sZWQgcnVubmVyIG1lbW9yeSBvYnNlcnZhdGlvbiBob29rIGZhaWxlZDpcIiwgZXJyb3IpXG4gICAgICB9XG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIFJlcXVlc3RzIGFuIGltbWVkaWF0ZSBtZW1vcnkgb2JzZXJ2YXRpb24gZnJvbSBvbmUgcG9vbGVkIGNoaWxkLiBUaGUgY2hpbGRcbiAgICogcmVwbGllcyBvdmVyIElQQyB3aXRoIGl0cyBjdXJyZW50IHNuYXBzaG90ICh0aGUgc2FtZSBzaGFwZSBhcyB0aGUgcGVyaW9kaWNcbiAgICogc2FtcGxlciksIHdoaWNoIHRoZSB3b3JrZXIgcmVjb3JkcywgbG9ncywgYW5kIGZvcndhcmRzIHRvIHRoZVxuICAgKiBgb25Qb29sZWRSdW5uZXJNZW1vcnlPYnNlcnZhdGlvbmAgaG9vay4gVXNlIHRoaXMgdG8gcHVsbCBhIHNuYXBzaG90IG9uXG4gICAqIHN1c3BpY2lvbiAoZS5nLiBhZnRlciBhbiBPT00gcmVwb3J0KSB3aXRob3V0IHdhaXRpbmcgZm9yIHRoZSBuZXh0IHBlcmlvZGljXG4gICAqIHNhbXBsZS4gQSBuby1vcCB3aGVuIHRoZSBjaGlsZCBpcyBnb25lIG9yIGl0cyBJUEMgY2hhbm5lbCBpcyBjbG9zZWQuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwibm9kZTpjaGlsZF9wcm9jZXNzXCIpLkNoaWxkUHJvY2Vzc30gY2hpbGQgLSBQb29sZWQgY2hpbGQgdG8gc2FtcGxlLlxuICAgKiBAcmV0dXJucyB7dm9pZH1cbiAgICovXG4gIHJlcXVlc3RQb29sZWRDaGlsZE1lbW9yeU9ic2VydmF0aW9uKGNoaWxkKSB7XG4gICAgaWYgKCFjaGlsZC5jb25uZWN0ZWQpIHJldHVyblxuXG4gICAgdHJ5IHtcbiAgICAgIGNoaWxkLnNlbmQoe3R5cGU6IFwibWVtb3J5LW9ic2VydmF0aW9uLXJlcXVlc3RcIn0pXG4gICAgfSBjYXRjaCB7XG4gICAgICAvLyBUaGUgSVBDIGNoYW5uZWwgaXMgYWxyZWFkeSBnb25lOyB0aGUgZGlzY29ubmVjdC9leGl0IGhhbmRsZXIgb3ducyB0ZWFyZG93bi5cbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogTWFya3MgYSBwb29sZWQgY2hpbGQgZm9yIHJldGlyZW1lbnQgYW5kIOKAlCB3aGVuIHRoZSBwb29sIGlzIGJlbG93IGl0cyBoYXJkXG4gICAqIGNhcCDigJQgZWFnZXJseSBzcGF3bnMgYSBzaW5nbGUgcmVwbGFjZW1lbnQgKDEtZm9yLTEpIHNvIGl0cyBjYXBhY2l0eSBpc1xuICAgKiByZXN0b3JlZCBpbW1lZGlhdGVseSB3aXRob3V0IHdhaXRpbmcgZm9yIGl0IHRvIGZpbmlzaCBkcmFpbmluZywgYW5kXG4gICAqIHJlLWFkdmVydGlzZXMgdGhhdCBjYXBhY2l0eSBzbyBkaXNwYXRjaCBjYW4gcmVzdW1lIGF0IG9uY2UuIFRoZVxuICAgKiByZXBsYWNlbWVudCBzcGF3biBpcyBnYXRlZCBieSB0aGUgY2FwICh0aGUgcmV0aXJpbmcgY2hpbGQgc3RpbGwgY291bnRzIGFzXG4gICAqIGxpdmUgdW50aWwgaXQgZXhpdHMpLCBzbyBhIGZ1bGwgcG9vbCBkZWZlcnMgdGhlIHJlcGxhY2VtZW50IHRvIHRoZSBkcmFpblxuICAgKiBwYXRoIOKAlCB3aGVyZSBhIGNoaWxkIGV4aXQgcmVzdG9yZXMgYSB3b3JraW5nIGNoaWxkIHRocm91Z2ggdGhlIHNhbWVcbiAgICogYm91bmRlZCBsaXZlbmVzcyByZXBsYWNlbWVudCAoc2VlIGBfZW5zdXJlTm9uUmV0aXJpbmdDaGlsZGApLiBXaXRob3V0IGl0LFxuICAgKiBhIGZ1bGwgcmV0aXJlbWVudCB3YXZlIChlLmcuIGV2ZXJ5IGNoaWxkIGNyb3NzaW5nIHRoZSBwZWFrLVJTUyB0aHJlc2hvbGRcbiAgICogYWZ0ZXIgdGhlIHNhbWUgbWVtb3J5IGJ1cnN0KSBzaWxlbnRseSByZW1vdmVzIGFsbCBwb29sZWQgY2FwYWNpdHkgZm9yIHRoZVxuICAgKiB3aG9sZSBkcmFpbiB3aW5kb3csIHdoaWNoIGNhbiBzdHJldGNoIHRvIHRoZSBsb25nZXN0IGluLWZsaWdodCBqb2IuIFRoZVxuICAgKiByZXRpcmluZyBjaGlsZCBzdG9wcyByZWNlaXZpbmcgbmV3IGpvYnMgYW5kIGlzIHRlcm1pbmF0ZWQgb25seSBvbmNlIGl0c1xuICAgKiBpbi1mbGlnaHQgc2V0IGRyYWlucywgc28gYSBsb25nLXJ1bm5pbmcgam9iIChlLmcuIGEgYnVpbGQpIGlzIG5ldmVyIGN1dFxuICAgKiBvZmYuIFdoZW4gdGhlIHBvb2wgYWxyZWFkeSBjYXJyaWVzIGl0cyBib3VuZGVkIG92ZXItY2FwIGNoaWxkLCByZXRpcmluZ1xuICAgKiB0aGUgbGFzdCB3b3JraW5nIGNoaWxkIGlzIGRlZmVycmVkIGluc3RlYWQgb2YgZW1wdHlpbmcgdGhlIHdvcmtpbmcgcG9vbDpcbiAgICogdGhlIGNoaWxkIGtlZXBzIHNlcnZpbmcgYW5kIGEgbGF0ZXIgb2JzZXJ2YXRpb24gcmV0cmllcyB0aGUgcmV0aXJlbWVudFxuICAgKiBvbmNlIGEgZHJhaW5pbmcgZXhpdCBoYXMgZnJlZWQgYSBjYXAgc2xvdCwgc28gYWR2ZXJ0aXNlZCBjYXBhY2l0eSBjYW5ub3RcbiAgICogY29sbGFwc2UgdG8gemVybyBpbnNpZGUgYSB3YXZlLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIm5vZGU6Y2hpbGRfcHJvY2Vzc1wiKS5DaGlsZFByb2Nlc3N9IGNoaWxkIC0gQ2hpbGQgdG8gcmV0aXJlLlxuICAgKiBAcmV0dXJucyB7dm9pZH1cbiAgICovXG4gIF9iZWdpblJldGlyZVBvb2xlZENoaWxkKGNoaWxkKSB7XG4gICAgY29uc3Qgc3RhdGUgPSB0aGlzLnBvb2xlZENoaWxkU3RhdGVzLmdldChjaGlsZClcbiAgICBpZiAoIXN0YXRlIHx8IHN0YXRlLnJldGlyaW5nKSByZXR1cm5cblxuICAgIC8vIFJldGlyaW5nIHRoZSBsYXN0IG5vbi1yZXRpcmluZyBjaGlsZCB3aGlsZSB0aGUgcG9vbCBhbHJlYWR5IGNhcnJpZXMgaXRzXG4gICAgLy8gYm91bmRlZCBvdmVyLWNhcCBjaGlsZCB3b3VsZCBsZWF2ZSBhZHZlcnRpc2VkIGNhcGFjaXR5IGF0IHplcm8gdW50aWwgdGhlXG4gICAgLy8gbmV4dCBkcmFpbmluZyBleGl0IOKAlCB1cCB0byB0aGUgbG9uZ2VzdCBpbi1mbGlnaHQgam9iICh0ZW5zIG9mIG1pbnV0ZXNcbiAgICAvLyB3aXRoIGJ1aWxkcyksIHN0YWxsaW5nIGRpc3BhdGNoIGNsdXN0ZXItd2lkZS4gRGVmZXIgdGhpcyByZXRpcmVtZW50XG4gICAgLy8gaW5zdGVhZDogdGhlIGNoaWxkIGtlZXBzIHNlcnZpbmcgYW5kIGEgbGF0ZXIgb2JzZXJ2YXRpb24gcmV0cmllcyBvbmNlIGFcbiAgICAvLyBkcmFpbiBoYXMgZnJlZWQgYSBjYXAgc2xvdCBmb3IgaXRzIHJlcGxhY2VtZW50LlxuICAgIGlmICghdGhpcy5zaG91bGRTdG9wICYmIHRoaXMuY29uZmlndXJhdGlvbiAmJiB0aGlzLl9ub25SZXRpcmluZ1Bvb2xlZENoaWxkQ291bnQoKSA8PSAxICYmIHRoaXMucG9vbGVkQ2hpbGRyZW4uc2l6ZSA+IHRoaXMucG9vbGVkUnVubmVyQ291bnQpIHtcbiAgICAgIHRoaXMuX2xvZ1Bvb2xlZENhcGFjaXR5RXZlbnQoXCJwb29sZWQtY2FwYWNpdHktcmV0aXJlbWVudC1kZWZlcnJlZFwiKVxuICAgICAgcmV0dXJuXG4gICAgfVxuXG4gICAgc3RhdGUucmV0aXJpbmcgPSB0cnVlXG4gICAgLy8gQmVzdC1lZmZvcnQgcHJlLXdhcm06IHNraXAgd2hlbiBzdG9wcGluZyAobm8gbmV3IHdvcmspIG9yIGJlZm9yZSB0aGVcbiAgICAvLyB3b3JrZXIgaXMgaW5pdGlhbGl6ZWQgKG5vIGNvbmZpZ3VyYXRpb24gdG8gZm9yayBhIGNoaWxkIGZyb20pLiBUaGUgY2FwXG4gICAgLy8gaW5zaWRlIF9jcmVhdGVQb29sZWRDaGlsZCByZWZ1c2VzIHRoZSBzcGF3biB3aGlsZSB0aGUgcG9vbCBpcyBmdWxsLCBpblxuICAgIC8vIHdoaWNoIGNhc2UgdGhlIGJvdW5kZWQgbGl2ZW5lc3MgcmVwbGFjZW1lbnQgYmVsb3cgdGFrZXMgb3Zlci5cbiAgICBpZiAodGhpcy5zaG91bGRTdG9wIHx8ICF0aGlzLmNvbmZpZ3VyYXRpb24pIHJldHVyblxuXG4gICAgaWYgKHRoaXMuX2NyZWF0ZVBvb2xlZENoaWxkKCkpIHtcbiAgICAgIC8vIEZyZXNoIGNhcGFjaXR5IGV4aXN0czogcmUtYWR2ZXJ0aXNlIHNvIHRoZSBtYWluIGNhbiBkaXNwYXRjaCBpbnRvIGl0XG4gICAgICAvLyB3aXRob3V0IHdhaXRpbmcgZm9yIHRoZSBuZXh0IGpvYiBvdXRjb21lLlxuICAgICAgdGhpcy5fc2VuZFJlYWR5SWZSdW5uaW5nKClcbiAgICAgIHJldHVyblxuICAgIH1cbiAgICBpZiAodGhpcy5fbm9uUmV0aXJpbmdQb29sZWRDaGlsZENvdW50KCkgPiAwKSByZXR1cm5cblxuICAgIC8vIExpdmVuZXNzIHJlcGxhY2VtZW50OiB0aGlzIG1hcmsgZW1wdGllZCB0aGUgd29ya2luZyBwb29sLiBSZS1hZHZlcnRpc2VcbiAgICAvLyB0aGUgcmVzdG9yZWQgY2FwYWNpdHkgaW1tZWRpYXRlbHkgYWZ0ZXIgdGhlIGJvdW5kZWQgb3Zlci1jYXAgc3Bhd24uXG4gICAgaWYgKHRoaXMuX2Vuc3VyZU5vblJldGlyaW5nQ2hpbGQoKSkgdGhpcy5fc2VuZFJlYWR5SWZSdW5uaW5nKClcbiAgfVxuXG4gIC8qKlxuICAgKiBLZWVwcyDigJQgb3IgcmVzdG9yZXMg4oCUIGF0IGxlYXN0IG9uZSBub24tcmV0aXJpbmcgcG9vbGVkIGNoaWxkIHRocm91Z2ggdGhlXG4gICAqIGJvdW5kZWQgb3Zlci1jYXAgbGl2ZW5lc3MgcmVwbGFjZW1lbnQsIHVzZWQgYnkgYm90aCB0aGUgcmV0aXJlbWVudCBtYXJrXG4gICAqIChgX2JlZ2luUmV0aXJlUG9vbGVkQ2hpbGRgKSBhbmQgdGhlIGNoaWxkLWV4aXQgcGF0aFxuICAgKiAoYF9oYW5kbGVQb29sZWRDaGlsZEZhaWx1cmVgKTogYWR2ZXJ0aXNlZCBjYXBhY2l0eSBpcyB6ZXJvIHdoaWxlIGV2ZXJ5XG4gICAqIGxpdmUgY2hpbGQgaXMgcmV0aXJpbmcsIGFuZCBvbmNlIHRoZXkgYXJlIGFsbCByZXRpcmluZyBubyBmdXJ0aGVyXG4gICAqIHJldGlyZW1lbnQgbWFyayByZW1haW5zIHRvIHJlc3RvcmUgYSB3b3JraW5nIGNoaWxkIOKAlCBub3IgY2FuIGEgbGF6eVxuICAgKiByZXBsYWNlbWVudCBzcGF3biB3aGlsZSB0aGUgcG9vbCBjb3VudHMgYXQgaXRzIGNhcCDigJQgc28gZGlzcGF0Y2ggd291bGRcbiAgICogc3RhbGwgY2x1c3Rlci13aWRlIHVudGlsIHRoZSBuZXh0IGRyYWluaW5nIGV4aXQsIHVwIHRvIHRoZSBsb25nZXN0XG4gICAqIGluLWZsaWdodCBqb2IgKGUuZy4gYSBtdWx0aS1taW51dGUgYnVpbGQpLiBTcGF3bnMgb25lIHJlcGxhY2VtZW50IG92ZXIgdGhlXG4gICAqIGhhcmQgY2FwIChib3VuZGVkOiB0aGUgZ2F0ZSBhZG1pdHMgaXQgb25seSB3aGVuIHRoZSBsaXZlIGNvdW50IGlzIGF0IG1vc3RcbiAgICogdGhlIGNhcCwgc28gYXQgbW9zdCBvbmUgb3Zlci1jYXAgY2hpbGQgZXhpc3RzIGFuZCB0aGUgbmV4dCBkcmFpbmluZyBleGl0XG4gICAqIGFic29yYnMgaXQpLiBXaGVuIGV2ZW4gdGhhdCBzcGF3biBpcyB1bmF2YWlsYWJsZSAoYW4gb3Zlci1jYXAgY2hpbGQgaXNcbiAgICogYWxyZWFkeSBkcmFpbmluZyksIHRoZSBib3VuZGVkIHN0YXJ2YXRpb24gaXMgbG9nZ2VkIHNvIGl0IGlzIHZpc2libGVcbiAgICogaW5zdGVhZCBvZiBzaWxlbnQuXG4gICAqIEByZXR1cm5zIHtib29sZWFufSAtIFRydWUgd2hlbiBhIHJlcGxhY2VtZW50IGNoaWxkIHdhcyBzcGF3bmVkLlxuICAgKi9cbiAgX2Vuc3VyZU5vblJldGlyaW5nQ2hpbGQoKSB7XG4gICAgaWYgKHRoaXMuc2hvdWxkU3RvcCB8fCAhdGhpcy5jb25maWd1cmF0aW9uKSByZXR1cm4gZmFsc2VcbiAgICBpZiAodGhpcy5fbm9uUmV0aXJpbmdQb29sZWRDaGlsZENvdW50KCkgPiAwKSByZXR1cm4gZmFsc2VcblxuICAgIGlmICh0aGlzLnBvb2xlZENoaWxkcmVuLnNpemUgPD0gdGhpcy5wb29sZWRSdW5uZXJDb3VudCkge1xuICAgICAgY29uc3QgbGl2ZW5lc3NDaGlsZCA9IHRoaXMuX2NyZWF0ZVBvb2xlZENoaWxkKHthbGxvd092ZXJDYXA6IHRydWV9KVxuXG4gICAgICBpZiAobGl2ZW5lc3NDaGlsZCkge1xuICAgICAgICB0aGlzLl9sb2dQb29sZWRDYXBhY2l0eUV2ZW50KFwicG9vbGVkLWNhcGFjaXR5LWxpdmVuZXNzLXNwYXduXCIpXG4gICAgICAgIHJldHVybiB0cnVlXG4gICAgICB9XG4gICAgfVxuXG4gICAgLy8gQW4gb3Zlci1jYXAgY2hpbGQgaXMgYWxyZWFkeSBkcmFpbmluZzogdGhlIHBvb2wgd2FpdHMgZm9yIHRoZSBuZXh0XG4gICAgLy8gZHJhaW5pbmcgZXhpdCwgd2hpY2ggZnJlZXMgYSBjYXAgc2xvdCBmb3IgYSBsYXp5IHJlcGxhY2VtZW50IOKAlCBhbmQgdGhhdFxuICAgIC8vIGV4aXQgcmVzdG9yZXMgYSB3b3JraW5nIGNoaWxkIHRocm91Z2ggdGhpcyBzYW1lIHBhdGguIExvZyBpdCBzbyB0aGlzXG4gICAgLy8gYm91bmRlZCBzdGFydmF0aW9uIGlzIG5vdCBzaWxlbnQuXG4gICAgdGhpcy5fbG9nUG9vbGVkQ2FwYWNpdHlFdmVudChcInBvb2xlZC1jYXBhY2l0eS1zdGFydmVkXCIpXG4gICAgcmV0dXJuIGZhbHNlXG4gIH1cblxuICAvKipcbiAgICogTG9ncyBvbmUgY29tcGFjdCBwb29sZWQtY2FwYWNpdHkgZXZlbnQgdG8gdGhlIHdvcmtlcidzIG93biBzdGRlcnIgKHRoZVxuICAgKiBzdXJmYWNlIHRoYXQgcmVhY2hlcyB0aGUgcHJvZHVjdGlvbiBsb2cpLiBVc2VkIGJ5IHRoZSBib3VuZGVkIGxpdmVuZXNzXG4gICAqIHJlcGxhY2VtZW50IGluIGBfZW5zdXJlTm9uUmV0aXJpbmdDaGlsZGA6IHRoZSBzcGF3biB0aGF0IGtlZXBzIGRpc3BhdGNoXG4gICAqIGFsaXZlIHRocm91Z2ggYSBmdWxsIHJldGlyZW1lbnQgd2F2ZSAoYXQgYSByZXRpcmVtZW50IG1hcmsgb3IgYSBjaGlsZFxuICAgKiBleGl0KSwgdGhlIGRlZmVycmVkIHJldGlyZW1lbnQgb2YgdGhlIGxhc3Qgd29ya2luZyBjaGlsZCB3aGlsZSB0aGUgcG9vbFxuICAgKiBhbHJlYWR5IGNhcnJpZXMgaXRzIGJvdW5kZWQgb3Zlci1jYXAgY2hpbGQgKHJldHJpZWQgYWZ0ZXIgdGhlIG5leHQgZHJhaW5cbiAgICogZnJlZXMgYSBjYXAgc2xvdCksIG9yIHRoZSBib3VuZGVkIHN0YXJ2YXRpb24gd2hlbiBhbiBvdmVyLWNhcCBjaGlsZCBpc1xuICAgKiBhbHJlYWR5IGRyYWluaW5nIGFuZCB0aGUgcG9vbCBtdXN0IHdhaXQgZm9yIGFuIGV4aXQuXG4gICAqIEBwYXJhbSB7XCJwb29sZWQtY2FwYWNpdHktbGl2ZW5lc3Mtc3Bhd25cIiB8IFwicG9vbGVkLWNhcGFjaXR5LXN0YXJ2ZWRcIiB8IFwicG9vbGVkLWNhcGFjaXR5LXJldGlyZW1lbnQtZGVmZXJyZWRcIn0gZXZlbnQgLSBFdmVudCBuYW1lLlxuICAgKiBAcmV0dXJucyB7dm9pZH1cbiAgICovXG4gIF9sb2dQb29sZWRDYXBhY2l0eUV2ZW50KGV2ZW50KSB7XG4gICAgbGV0IHJldGlyaW5nQ2hpbGRyZW4gPSAwXG5cbiAgICBmb3IgKGNvbnN0IHN0YXRlIG9mIHRoaXMucG9vbGVkQ2hpbGRTdGF0ZXMudmFsdWVzKCkpIHtcbiAgICAgIGlmIChzdGF0ZS5yZXRpcmluZykgcmV0aXJpbmdDaGlsZHJlbiArPSAxXG4gICAgfVxuXG4gICAgY29uc29sZS5lcnJvcihKU09OLnN0cmluZ2lmeSh7XG4gICAgICBldmVudCxcbiAgICAgIGxpdmVDaGlsZHJlbjogdGhpcy5wb29sZWRDaGlsZHJlbi5zaXplLFxuICAgICAgcmV0aXJpbmdDaGlsZHJlbixcbiAgICAgIGNhcDogdGhpcy5wb29sZWRSdW5uZXJDb3VudCxcbiAgICAgIGNvbmN1cnJlbmN5OiB0aGlzLnBvb2xlZFJ1bm5lckNvbmN1cnJlbmN5XG4gICAgfSkpXG4gIH1cblxuICAvKipcbiAgICogVGVybWluYXRlcyBhIHJldGlyaW5nIHBvb2xlZCBjaGlsZCBvbmNlIGl0IGhhcyBubyBpbi1mbGlnaHQgam9icyBsZWZ0LlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIm5vZGU6Y2hpbGRfcHJvY2Vzc1wiKS5DaGlsZFByb2Nlc3N9IGNoaWxkIC0gQ2hpbGQgdG8gY2hlY2suXG4gICAqIEByZXR1cm5zIHt2b2lkfVxuICAgKi9cbiAgX3Rlcm1pbmF0ZUlmRHJhaW5lZChjaGlsZCkge1xuICAgIGNvbnN0IHN0YXRlID0gdGhpcy5wb29sZWRDaGlsZFN0YXRlcy5nZXQoY2hpbGQpXG4gICAgaWYgKCFzdGF0ZSB8fCAhc3RhdGUucmV0aXJpbmcgfHwgc3RhdGUuaW5mbGlnaHQuc2l6ZSA+IDApIHJldHVyblxuXG4gICAgdGhpcy5fcmV0aXJlUG9vbGVkQ2hpbGQoY2hpbGQpXG4gIH1cblxuICAvKipcbiAgICogUmV0aXJlcyBhIGRyYWluZWQgcG9vbGVkIGNoaWxkIChyZW1vdmVzIGl0IGZyb20gdHJhY2tpbmcsIHRoZW4gU0lHVEVSTXMgaXQpLlxuICAgKiBCZWNhdXNlIHRoZSBoYXJkIGNhcCBjb3VudHMgbGl2ZSBjaGlsZHJlbiwgdGhlIGV4aXQgb2YgdGhpcyBjaGlsZCBmcmVlcyBhXG4gICAqIHNsb3Q6IGFueSBkZWZlcnJlZCByZXBsYWNlbWVudCAodGhlIHBvb2wgd2FzIGZ1bGwgd2hlbiB0aGUgY2hpbGQgcmV0aXJlZClcbiAgICogaXMgc3Bhd25lZCBub3csIGFuZCBjYXBhY2l0eSBpcyByZS1hZHZlcnRpc2VkIHNvIG1haW4gY2FuIGRpc3BhdGNoIGludG8gaXQuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwibm9kZTpjaGlsZF9wcm9jZXNzXCIpLkNoaWxkUHJvY2Vzc30gY2hpbGQgLSBDaGlsZCBwcm9jZXNzIHRvIHJldGlyZS5cbiAgICogQHJldHVybnMge3ZvaWR9XG4gICAqL1xuICBfcmV0aXJlUG9vbGVkQ2hpbGQoY2hpbGQpIHtcbiAgICBjb25zdCBzdGF0ZSA9IHRoaXMucG9vbGVkQ2hpbGRTdGF0ZXMuZ2V0KGNoaWxkKVxuICAgIGlmICghc3RhdGUpIHRocm93IG5ldyBFcnJvcihcIkNhbm5vdCByZXRpcmUgcG9vbGVkIGNoaWxkIHdpdGhvdXQgdHJhY2tlZCBzdGF0ZVwiKVxuICAgIGlmIChzdGF0ZS5pbmZsaWdodC5zaXplID4gMCkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKGBDYW5ub3QgcmV0aXJlIHBvb2xlZCBjaGlsZCB3aGlsZSAke3N0YXRlLmluZmxpZ2h0LnNpemV9ICR7c3RhdGUuaW5mbGlnaHQuc2l6ZSA9PT0gMSA/IFwiam9iIHJlbWFpbnNcIiA6IFwiam9icyByZW1haW5cIn0gaW4gZmxpZ2h0YClcbiAgICB9XG5cbiAgICB0aGlzLnBvb2xlZENoaWxkcmVuLmRlbGV0ZShjaGlsZClcbiAgICBzdGF0ZS5yZXRpcmluZyA9IHRydWVcbiAgICB0aGlzLl9yZXF1ZXN0UG9vbGVkQ2hpbGRTaHV0ZG93bih7Y2hpbGQsIHJlYXNvbjogXCJwYXJlbnRfcmV0aXJlX2RyYWluZWRcIiwgc2lnbmFsOiBcIlNJR1RFUk1cIiwgd2FpdEZvck9ic2VydmF0aW9uOiB0cnVlfSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSZWNvcmRzIGFuIGV4YWN0IHBhcmVudCByZXF1ZXN0IGJlZm9yZSBJUEMgb3Igc2lnbmFsIGRlbGl2ZXJ5LiBEcmFpbmVkXG4gICAqIHJldGlyZW1lbnQgZ2V0cyBhIGJyaWVmIElQQy1maXJzdCBncmFjZSBzbyBpdHMgemVyby1qb2Igb2JzZXJ2YXRpb24gaXNcbiAgICogZGV0ZXJtaW5pc3RpYzsgdGltZW91dC93b3JrZXItc3RvcCBwYXRocyBzaWduYWwgaW1tZWRpYXRlbHkuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gU2h1dGRvd24gcmVxdWVzdC5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCJub2RlOmNoaWxkX3Byb2Nlc3NcIikuQ2hpbGRQcm9jZXNzfSBhcmdzLmNoaWxkIC0gUG9vbGVkIGNoaWxkLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vdHlwZXMuanNcIikuUG9vbGVkQ2hpbGRTaHV0ZG93blJlYXNvbn0gYXJncy5yZWFzb24gLSBFeGFjdCBwYXJlbnQgcmVhc29uLlxuICAgKiBAcGFyYW0ge2tleW9mIHR5cGVvZiBpbXBvcnQoXCJub2RlOm9zXCIpLmNvbnN0YW50cy5zaWduYWxzfSBhcmdzLnNpZ25hbCAtIFNpZ25hbCB0byBkZWxpdmVyLlxuICAgKiBAcGFyYW0ge2Jvb2xlYW59IFthcmdzLndhaXRGb3JPYnNlcnZhdGlvbl0gLSBXaGV0aGVyIElQQyBvYnNlcnZhdGlvbiBtYXkgcHJlY2VkZSBzaWduYWwgZmFsbGJhY2suXG4gICAqIEByZXR1cm5zIHt2b2lkfVxuICAgKi9cbiAgX3JlcXVlc3RQb29sZWRDaGlsZFNodXRkb3duKHtjaGlsZCwgcmVhc29uLCBzaWduYWwsIHdhaXRGb3JPYnNlcnZhdGlvbiA9IGZhbHNlfSkge1xuICAgIGNvbnN0IHN0YXRlID0gdGhpcy5wb29sZWRDaGlsZFN0YXRlcy5nZXQoY2hpbGQpXG4gICAgaWYgKCFzdGF0ZSB8fCBzdGF0ZS5zZXR0bGluZyB8fCBzdGF0ZS5zaHV0ZG93blJlYXNvbikgcmV0dXJuXG5cbiAgICBjb25zdCBzaHV0ZG93blJlcXVlc3RlZEF0TXMgPSBEYXRlLm5vdygpXG4gICAgc3RhdGUuc2h1dGRvd25SZWFzb24gPSByZWFzb25cbiAgICBzdGF0ZS5zaHV0ZG93blJlcXVlc3RlZEF0TXMgPSBzaHV0ZG93blJlcXVlc3RlZEF0TXNcbiAgICBzdGF0ZS5zaHV0ZG93blNpZ25hbCA9IHNpZ25hbFxuXG4gICAgbGV0IHJlcXVlc3RTZW50ID0gZmFsc2VcbiAgICBpZiAoY2hpbGQuY29ubmVjdGVkKSB7XG4gICAgICB0cnkge1xuICAgICAgICBjaGlsZC5zZW5kKHt0eXBlOiBcInNodXRkb3duLXJlcXVlc3RcIiwgcmVhc29uLCBzaHV0ZG93blJlcXVlc3RlZEF0TXMsIHNpZ25hbH0sIChlcnJvcikgPT4ge1xuICAgICAgICAgIGlmICghZXJyb3IgfHwgIXdhaXRGb3JPYnNlcnZhdGlvbiB8fCBzdGF0ZS5zZXR0bGluZykgcmV0dXJuXG5cbiAgICAgICAgICBpZiAoc3RhdGUuc2h1dGRvd25TaWduYWxUaW1lcikge1xuICAgICAgICAgICAgY2xlYXJUaW1lb3V0KHN0YXRlLnNodXRkb3duU2lnbmFsVGltZXIpXG4gICAgICAgICAgICBzdGF0ZS5zaHV0ZG93blNpZ25hbFRpbWVyID0gdW5kZWZpbmVkXG4gICAgICAgICAgfVxuICAgICAgICAgIHRoaXMuX3NpZ25hbFBvb2xlZENoaWxkKHtjaGlsZCwgc2lnbmFsfSlcbiAgICAgICAgfSlcbiAgICAgICAgcmVxdWVzdFNlbnQgPSB0cnVlXG4gICAgICB9IGNhdGNoIHtcbiAgICAgICAgLy8gVGhlIHNpZ25hbCBiZWxvdyByZW1haW5zIHRoZSBib3VuZGVkIHNodXRkb3duIG1lY2hhbmlzbS5cbiAgICAgIH1cbiAgICB9XG5cbiAgICBpZiAod2FpdEZvck9ic2VydmF0aW9uICYmIHJlcXVlc3RTZW50KSB7XG4gICAgICBzdGF0ZS5zaHV0ZG93blNpZ25hbFRpbWVyID0gc2V0VGltZW91dCgoKSA9PiB7XG4gICAgICAgIHN0YXRlLnNodXRkb3duU2lnbmFsVGltZXIgPSB1bmRlZmluZWRcbiAgICAgICAgdGhpcy5fc2lnbmFsUG9vbGVkQ2hpbGQoe2NoaWxkLCBzaWduYWx9KVxuICAgICAgfSwgUE9PTEVEX1JVTk5FUl9TSFVURE9XTl9SRVFVRVNUX0dSQUNFX01TKVxuICAgICAgc3RhdGUuc2h1dGRvd25TaWduYWxUaW1lci51bnJlZigpXG4gICAgICByZXR1cm5cbiAgICB9XG5cbiAgICB0aGlzLl9zaWduYWxQb29sZWRDaGlsZCh7Y2hpbGQsIHNpZ25hbH0pXG4gIH1cblxuICAvKipcbiAgICogRGVsaXZlcnMgb25lIHBhcmVudC1vd25lZCBwcm9jZXNzIHNpZ25hbCB3aXRob3V0IGNoYW5naW5nIHJlY29yZGVkIHByb3ZlbmFuY2UuXG4gICAqIEBwYXJhbSB7e2NoaWxkOiBpbXBvcnQoXCJub2RlOmNoaWxkX3Byb2Nlc3NcIikuQ2hpbGRQcm9jZXNzLCBzaWduYWw6IGtleW9mIHR5cGVvZiBpbXBvcnQoXCJub2RlOm9zXCIpLmNvbnN0YW50cy5zaWduYWxzfX0gYXJncyAtIFNpZ25hbCByZXF1ZXN0LlxuICAgKiBAcmV0dXJucyB7dm9pZH1cbiAgICovXG4gIF9zaWduYWxQb29sZWRDaGlsZCh7Y2hpbGQsIHNpZ25hbH0pIHtcbiAgICB0cnkge1xuICAgICAgY2hpbGQua2lsbChzaWduYWwpXG4gICAgfSBjYXRjaCB7XG4gICAgICAvLyBDaGlsZCBhbHJlYWR5IGV4aXRlZDsgaXRzIGV4aXQvZXJyb3IgaGFuZGxlciBvd25zIHN0YXRlIHNldHRsZW1lbnQuXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIFJlbW92ZXMgYW4gZXhpdGVkL3VuaGVhbHRoeSBwb29sZWQgY2hpbGQgYW5kIHJlcG9ydHMgZXZlcnkgam9iIHRoYXQgd2FzXG4gICAqIGluLWZsaWdodCBvbiBpdCBhcyBmYWlsZWQg4oCUIGEgcHJvY2Vzcy1sZXZlbCBjcmFzaCdzIGJsYXN0IHJhZGl1cyBpcyB0aGVcbiAgICogY2hpbGQncyB3aG9sZSBpbi1mbGlnaHQgc2V0LiBPbmNlIHRoZSBjaGlsZCBoYXMgY29tcGxldGVkIHN0YXJ0dXAsIGl0c1xuICAgKiBmcmVlZCBjYXBhY2l0eSBpcyBhZHZlcnRpc2VkIGltbWVkaWF0ZWx5OyB0aGUgcmVwbGFjZW1lbnQgaXRzZWxmIGlzIHN0aWxsXG4gICAqIHNwYXduZWQgbGF6aWx5IGJ5IHRoZSBuZXh0IGRpc3BhdGNoLiBBIGNoaWxkIHRoYXQgZXhpdHMgYmVmb3JlIGl0cyBzdGFydHVwXG4gICAqIGhhbmRzaGFrZSBkb2VzIG5vdCByZS1hbm5vdW5jZSwgYXZvaWRpbmcgYSB0aWdodCByZXNwYXduIGxvb3Agb24gc3RhcnR1cFxuICAgKiBmYWlsdXJlLlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIEZhaWx1cmUgZGV0YWlscy5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCJub2RlOmNoaWxkX3Byb2Nlc3NcIikuQ2hpbGRQcm9jZXNzfSBhcmdzLmNoaWxkIC0gUG9vbGVkIGNoaWxkLlxuICAgKiBAcGFyYW0ge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSBhcmdzLmVycm9yIC0gRmFpbHVyZS5cbiAgICogQHBhcmFtIHtudW1iZXIgfCBudWxsfSBbYXJncy5leGl0Q29kZV0gLSBDaGlsZCBleGl0IGNvZGUgd2hlbiBvYnNlcnZlZC5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL3R5cGVzLmpzXCIpLlBvb2xlZFJ1bm5lckZhaWx1cmVPcmlnaW59IFthcmdzLm9yaWdpbl0gLSBXb3JrZXIgb2JzZXJ2YXRpb24gdGhhdCBpbml0aWF0ZWQgcmVjb3ZlcnkuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwibm9kZTpjaGlsZF9wcm9jZXNzXCIpLkNoaWxkUHJvY2Vzc1tcInNpZ25hbENvZGVcIl19IFthcmdzLnNpZ25hbF0gLSBDaGlsZCB0ZXJtaW5hdGlvbiBzaWduYWwgd2hlbiBvYnNlcnZlZC5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59XG4gICAqL1xuICBhc3luYyBfaGFuZGxlUG9vbGVkQ2hpbGRGYWlsdXJlKHtjaGlsZCwgZXJyb3IsIGV4aXRDb2RlID0gbnVsbCwgb3JpZ2luID0gXCJwcm9jZXNzLWVycm9yXCIsIHNpZ25hbCA9IG51bGx9KSB7XG4gICAgY29uc3Qgc3RhdGUgPSB0aGlzLnBvb2xlZENoaWxkU3RhdGVzLmdldChjaGlsZClcbiAgICBpZiAoc3RhdGU/LnNldHRsaW5nKSByZXR1cm5cbiAgICBpZiAoc3RhdGUpIHtcbiAgICAgIHN0YXRlLnNldHRsaW5nID0gdHJ1ZVxuICAgICAgLy8gQ2FuY2VsIHRoaXMgY2hpbGQncyBwZW5kaW5nIHRpbWVycyBiZWZvcmUgaXRzIGluLWZsaWdodCBzZXQgaXMgcmVwb3J0ZWQg4oCUXG4gICAgICAvLyB0aGUgU0lHS0lMTCBncmFjZSBmcm9tIGEgdGltZW91dCBraWxsLCBhbmQgZXZlcnkgYXJtZWQgcGVyLWpvYiBiYWNrc3RvcC5cbiAgICAgIGlmIChzdGF0ZS50aW1lb3V0U2lna2lsbFRpbWVyKSBjbGVhclRpbWVvdXQoc3RhdGUudGltZW91dFNpZ2tpbGxUaW1lcilcbiAgICAgIGlmIChzdGF0ZS5zaHV0ZG93blNpZ25hbFRpbWVyKSBjbGVhclRpbWVvdXQoc3RhdGUuc2h1dGRvd25TaWduYWxUaW1lcilcbiAgICAgIGZvciAoY29uc3QgaW5mbGlnaHRFbnRyeSBvZiBzdGF0ZS5pbmZsaWdodC52YWx1ZXMoKSkge1xuICAgICAgICBpZiAoaW5mbGlnaHRFbnRyeS50aW1lb3V0VGltZXIpIGNsZWFyVGltZW91dChpbmZsaWdodEVudHJ5LnRpbWVvdXRUaW1lcilcbiAgICAgIH1cbiAgICB9XG4gICAgdGhpcy5wb29sZWRDaGlsZHJlbi5kZWxldGUoY2hpbGQpXG4gICAgdGhpcy5pbmZsaWdodFByb2Nlc3NDaGlsZHJlbi5kZWxldGUoY2hpbGQpXG4gICAgLy8gQ2hpbGQgZXhpdCBmcmVlcyBhIGhhcmQtY2FwIHNsb3QgZXZlbiB3aGlsZSBpdHMgaW4tZmxpZ2h0IHNldCBpcyBzdGlsbFxuICAgIC8vIGJlaW5nIHJlcG9ydGVkIOKAlCB3YWtlIHdhaXRlcnMgbm93OyB0aGVpciByZXBvcnRzIHNldHRsZSBpbmRlcGVuZGVudGx5LlxuICAgIHRoaXMuX3dha2VQb29sZWRTbG90V2FpdGVycygpXG5cbiAgICBjb25zdCBlbnRyaWVzID0gc3RhdGUgPyBbLi4uc3RhdGUuaW5mbGlnaHQudmFsdWVzKCldIDogW11cbiAgICBjb25zdCBydW5uZXJGYWlsdXJlID0gc3RhdGVcbiAgICAgID8gdGhpcy5fcG9vbGVkUnVubmVyRmFpbHVyZSh7Y2hpbGQsIGV4aXRDb2RlLCBvcmlnaW4sIHNpZ25hbCwgc3RhdGV9KVxuICAgICAgOiB1bmRlZmluZWRcbiAgICBpZiAoc3RhdGUpIHN0YXRlLmluZmxpZ2h0LmNsZWFyKClcbiAgICB0aGlzLnBvb2xlZENoaWxkU3RhdGVzLmRlbGV0ZShjaGlsZClcblxuICAgIGNvbnN0IGZhaWx1cmVSZXBvcnRzID0gZW50cmllcy5tYXAoYXN5bmMgKGVudHJ5KSA9PiB7XG4gICAgICBhd2FpdCB0aGlzLl9yZXBvcnRKb2JSZXN1bHQoe1xuICAgICAgICBqb2JJZDogZW50cnkucGF5bG9hZC5pZCxcbiAgICAgICAgc3RhdHVzOiBcImZhaWxlZFwiLFxuICAgICAgICBlcnJvcixcbiAgICAgICAgaGFuZG9mZklkOiBlbnRyeS5wYXlsb2FkLmhhbmRvZmZJZCxcbiAgICAgICAgaGFuZGVkT2ZmQXRNczogZW50cnkucGF5bG9hZC5oYW5kZWRPZmZBdE1zLFxuICAgICAgICBydW5uZXJGYWlsdXJlLFxuICAgICAgICB3b3JrZXJJZDogZW50cnkucGF5bG9hZC53b3JrZXJJZCB8fCB0aGlzLndvcmtlcklkXG4gICAgICB9KVxuICAgICAgaWYgKGVudHJ5LnJlc29sdmUpIGVudHJ5LnJlc29sdmUodW5kZWZpbmVkKVxuICAgIH0pXG5cbiAgICAvLyBTdGFydCBldmVyeSBmYWxsYmFjayByZXBvcnQgYmVmb3JlIGFubm91bmNpbmcgY2FwYWNpdHkgc28gdGhlIG1haW4gY2Fubm90XG4gICAgLy8gb2JzZXJ2ZSBhIHJlcGxhY2VtZW50IHNsb3QgYmVmb3JlIHRoZSBmYWlsZWQgam9icycgcmVwb3J0cyBhcmUgaW4gZmxpZ2h0LlxuICAgIC8vIFRoZSByZXBvcnQgcHJvbWlzZXMgcmVtYWluIHRyYWNrZWQgYmVsb3c7IGEgc2xvdyByZXRyeSBtdXN0IG5vdCBob2xkIHRoZVxuICAgIC8vIG5ld2x5IGZyZWVkIHJ1bm5lciBjYXBhY2l0eSBob3N0YWdlLlxuICAgIC8vIEEgZHJhaW5lZCByZXRpcmVtZW50IGFscmVhZHkgYWR2ZXJ0aXNlZCBpdHMgcmVwbGFjZW1lbnQgY2FwYWNpdHkgd2hlblxuICAgIC8vIHRoZSBmaW5hbCBqb2IgY29tcGxldGVkLiBSZS1hZHZlcnRpc2luZyBoZXJlIGNhbiByZXN0b3JlIGEgY3JlZGl0IG1haW5cbiAgICAvLyBjb25zdW1lZCBiZWZvcmUgaXRzIGhhbmRvZmYgcmVhY2hlZCB0aGUgcmVwbGFjZW1lbnQgY2hpbGQuXG4gICAgaWYgKHN0YXRlPy5zaHV0ZG93blJlYXNvbiAhPT0gXCJwYXJlbnRfcmV0aXJlX2RyYWluZWRcIikge1xuICAgICAgaWYgKHN0YXRlICYmIHN0YXRlLnN0YXJ0ZWQgIT09IGZhbHNlKSB7XG4gICAgICAgIHRoaXMuX3NlbmRSZWFkeUlmUnVubmluZygpXG4gICAgICB9IGVsc2UgaWYgKHN0YXRlKSB7XG4gICAgICAgIGZvciAoY29uc3QgZW50cnkgb2YgZW50cmllcykge1xuICAgICAgICAgIGlmIChlbnRyeS5wb29sZWRKb2IpIHRoaXMuX3Bvb2xlZFN0YXJ0dXBGYWlsdXJlSm9icy5hZGQoZW50cnkucG9vbGVkSm9iKVxuICAgICAgICAgIGNvbnN0IHF1ZXVlVHJhY2tlciA9IHRoaXMucG9vbGVkSm9iUXVldWVUcmFja2Vycy5nZXQoZW50cnkucGF5bG9hZC5pZClcbiAgICAgICAgICBpZiAocXVldWVUcmFja2VyKSB0aGlzLl9wb29sZWRTdGFydHVwRmFpbHVyZUpvYnMuYWRkKHF1ZXVlVHJhY2tlcilcbiAgICAgICAgfVxuICAgICAgICAvLyBBIHByZXZpb3VzIHJlYWR5IG1lc3NhZ2UgbWF5IHN0aWxsIGhhdmUgdW5jb25zdW1lZCBwb29sZWQgY3JlZGl0cyBhdCB0aGVcbiAgICAgICAgLy8gbWFpbi4gUmV2b2tlIHRoZW0gYXV0aG9yaXRhdGl2ZWx5IHdpdGhvdXQgc3VwcHJlc3NpbmcgdmFsaWQgaW5saW5lIG9yXG4gICAgICAgIC8vIHByb2Nlc3MtcnVubmVyIHJlYWRpbmVzczsgb3RoZXJ3aXNlIHF1ZXVlZCBqb2JzIGNhbiB0cmlnZ2VyIGEgc3RhcnR1cFxuICAgICAgICAvLyBjcmFzaCBsb29wIHVzaW5nIHRoZSBzdGFsZSBjcmVkaXRzLlxuICAgICAgICB0aGlzLl9zZW5kUmVhZHlJZlJ1bm5pbmcoe3Jldm9rZVBvb2xlZEFkbWlzc2lvbjogdHJ1ZX0pXG4gICAgICB9XG4gICAgfVxuXG4gICAgLy8gQSBjaGlsZCBleGl0IGNhbiBhYnNvcmIgdGhlIGJvdW5kZWQgb3Zlci1jYXAgbGl2ZW5lc3MgcmVwbGFjZW1lbnQgd2hpbGVcbiAgICAvLyBldmVyeSByZW1haW5pbmcgbGl2ZSBjaGlsZCBpcyBzdGlsbCByZXRpcmluZyDigJQgZS5nLiB0aGUgcmVwbGFjZW1lbnRcbiAgICAvLyByZXRpcmVzIChvciBkaWVzKSBmaXJzdC4gTm8gcmV0aXJlbWVudCBtYXJrIHJlbWFpbnMgdG8gcmVzdG9yZSBhIHdvcmtpbmdcbiAgICAvLyBjaGlsZCwgYW5kIGF0IHRoZSBjYXAgbm90aGluZyBlbHNlIGNhbiBzcGF3biwgc28gYWR2ZXJ0aXNlZCBjYXBhY2l0eVxuICAgIC8vIHdvdWxkIHN0YXkgemVybyB1bnRpbCB0aGUgbmV4dCBkcmFpbmluZyBleGl0IOKAlCB1cCB0byB0aGUgbG9uZ2VzdFxuICAgIC8vIGluLWZsaWdodCBqb2Ig4oCUIHN0YXJ2aW5nIGRpc3BhdGNoIGNsdXN0ZXItd2lkZS4gUmVzdG9yZSBvbmUgd29ya2luZ1xuICAgIC8vIGNoaWxkIG5vdyAoc2FtZSBib3VuZDogYXQgbW9zdCBvbmUgb3Zlci1jYXAgY2hpbGQpIGFuZCByZS1hZHZlcnRpc2Ugc29cbiAgICAvLyBtYWluIGNhbiBkaXNwYXRjaCBpbnRvIGl0IGltbWVkaWF0ZWx5LlxuICAgIGlmIChzdGF0ZT8uc3RhcnRlZCAhPT0gZmFsc2UgJiYgdGhpcy5wb29sZWRDaGlsZHJlbi5zaXplID4gMCAmJiB0aGlzLl9lbnN1cmVOb25SZXRpcmluZ0NoaWxkKCkpIHtcbiAgICAgIHRoaXMuX3NlbmRSZWFkeUlmUnVubmluZygpXG4gICAgfVxuXG4gICAgYXdhaXQgUHJvbWlzZS5hbGxTZXR0bGVkKGZhaWx1cmVSZXBvcnRzKVxuICB9XG5cbiAgLyoqXG4gICAqIENhcHR1cmVzIG9uZSBzdGFibGUgcHJvY2VzcyBzbmFwc2hvdCBiZWZvcmUgdGhlIGZhaWxlZCBjaGlsZCdzIHN0YXRlIGlzIHJlbW92ZWQuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gRmFpbHVyZSBkZXRhaWxzLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIm5vZGU6Y2hpbGRfcHJvY2Vzc1wiKS5DaGlsZFByb2Nlc3N9IGFyZ3MuY2hpbGQgLSBGYWlsZWQgcG9vbGVkIGNoaWxkLlxuICAgKiBAcGFyYW0ge251bWJlciB8IG51bGx9IGFyZ3MuZXhpdENvZGUgLSBDaGlsZCBleGl0IGNvZGUgd2hlbiBvYnNlcnZlZC5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL3R5cGVzLmpzXCIpLlBvb2xlZFJ1bm5lckZhaWx1cmVPcmlnaW59IGFyZ3Mub3JpZ2luIC0gV29ya2VyIG9ic2VydmF0aW9uIHRoYXQgaW5pdGlhdGVkIHJlY292ZXJ5LlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIm5vZGU6Y2hpbGRfcHJvY2Vzc1wiKS5DaGlsZFByb2Nlc3NbXCJzaWduYWxDb2RlXCJdfSBhcmdzLnNpZ25hbCAtIENoaWxkIHRlcm1pbmF0aW9uIHNpZ25hbCB3aGVuIG9ic2VydmVkLlxuICAgKiBAcGFyYW0ge1Bvb2xlZENoaWxkU3RhdGV9IGFyZ3Muc3RhdGUgLSBDaGlsZCBzdGF0ZSBpbW1lZGlhdGVseSBiZWZvcmUgcmVjb3ZlcnkuXG4gICAqIEByZXR1cm5zIHtpbXBvcnQoXCIuL3R5cGVzLmpzXCIpLlBvb2xlZFJ1bm5lckZhaWx1cmV9IC0gU2hhcmVkIGZhaWx1cmUgcHJvdmVuYW5jZS5cbiAgICovXG4gIF9wb29sZWRSdW5uZXJGYWlsdXJlKHtjaGlsZCwgZXhpdENvZGUsIG9yaWdpbiwgc2lnbmFsLCBzdGF0ZX0pIHtcbiAgICBjb25zdCBvYnNlcnZhdGlvbiA9IHN0YXRlLnNodXRkb3duT2JzZXJ2YXRpb25cbiAgICBsZXQgc2h1dGRvd25SZWFzb24gPSBzdGF0ZS5zaHV0ZG93blJlYXNvbiA/PyBvYnNlcnZhdGlvbj8ucmVhc29uXG4gICAgaWYgKCFzaHV0ZG93blJlYXNvbikge1xuICAgICAgaWYgKG9yaWdpbiA9PT0gXCJwcm9jZXNzLWVycm9yXCIgfHwgb3JpZ2luID09PSBcImlwYy1zZW5kXCIpIHtcbiAgICAgICAgc2h1dGRvd25SZWFzb24gPSBcInByb2Nlc3NfZXJyb3JcIlxuICAgICAgfSBlbHNlIGlmIChzaWduYWwgPT09IFwiU0lHVEVSTVwiKSB7XG4gICAgICAgIHNodXRkb3duUmVhc29uID0gXCJzaWduYWxfc2lndGVybVwiXG4gICAgICB9IGVsc2UgaWYgKHNpZ25hbCA9PT0gXCJTSUdJTlRcIikge1xuICAgICAgICBzaHV0ZG93blJlYXNvbiA9IFwic2lnbmFsX3NpZ2ludFwiXG4gICAgICB9IGVsc2UgaWYgKHNpZ25hbCA9PT0gXCJTSUdLSUxMXCIpIHtcbiAgICAgICAgc2h1dGRvd25SZWFzb24gPSBcInNpZ25hbF9zaWdraWxsXCJcbiAgICAgIH0gZWxzZSBpZiAoc2lnbmFsKSB7XG4gICAgICAgIHNodXRkb3duUmVhc29uID0gXCJzaWduYWxfb3RoZXJcIlxuICAgICAgfSBlbHNlIGlmIChzdGF0ZS5pcGNEaXNjb25uZWN0ZWRBdE1zICYmIGV4aXRDb2RlID09PSAwKSB7XG4gICAgICAgIHNodXRkb3duUmVhc29uID0gXCJpcGNfZGlzY29ubmVjdFwiXG4gICAgICB9IGVsc2Uge1xuICAgICAgICBzaHV0ZG93blJlYXNvbiA9IFwidW5leHBlY3RlZF9leGl0XCJcbiAgICAgIH1cbiAgICB9XG4gICAgY29uc3QgdGVybWluYXRpb25SZWFzb24gPSBzaHV0ZG93blJlYXNvbiA9PT0gXCJqb2JfdGltZW91dFwiXG4gICAgICA/IFwiam9iLXRpbWVvdXRcIlxuICAgICAgOiBzaHV0ZG93blJlYXNvbiA9PT0gXCJ3b3JrZXJfc3RvcFwiID8gXCJ3b3JrZXItc2h1dGRvd24tdGltZW91dFwiIDogXCJ1bmV4cGVjdGVkXCJcbiAgICBjb25zdCB3b3JrZXJMaWZlY3ljbGUgPSB0aGlzLnNob3VsZFN0b3AgPyBcInN0b3BwaW5nXCIgOiB0aGlzLmlzUmV0aXJpbmcgPyBcInJldGlyaW5nXCIgOiBcInJ1bm5pbmdcIlxuICAgIGNvbnN0IHJ1bm5lckxpZmVjeWNsZSA9IHN0YXRlLnN0YXJ0ZWQgPT09IGZhbHNlID8gXCJzdGFydGluZ1wiIDogc3RhdGUucmV0aXJpbmcgPyBcInJldGlyaW5nXCIgOiBcInJ1bm5pbmdcIlxuICAgIGNvbnN0IGJvdW5kZWRJbmZsaWdodCA9IGJvdW5kZWRQb29sZWRSdW5uZXJJbmZsaWdodEpvYklkcyhzdGF0ZS5pbmZsaWdodC5rZXlzKCkpXG4gICAgY29uc3QgYWN0aXZlSm9icyA9IFsuLi5zdGF0ZS5pbmZsaWdodC52YWx1ZXMoKV1cbiAgICAgIC5tYXAoKGVudHJ5KSA9PiAoe1xuICAgICAgICBoYW5kb2ZmSWQ6IGVudHJ5LnBheWxvYWQuaGFuZG9mZklkID8/IG51bGwsXG4gICAgICAgIGhhbmRlZE9mZkF0TXM6IGVudHJ5LnBheWxvYWQuaGFuZGVkT2ZmQXRNcyA/PyBudWxsLFxuICAgICAgICBqb2JJZDogZW50cnkucGF5bG9hZC5pZCxcbiAgICAgICAgam9iTmFtZTogZW50cnkucGF5bG9hZC5qb2JOYW1lLFxuICAgICAgICB3b3JrZXJJZDogZW50cnkucGF5bG9hZC53b3JrZXJJZCA/PyB0aGlzLndvcmtlcklkXG4gICAgICB9KSlcbiAgICAgIC5zb3J0KChsZWZ0LCByaWdodCkgPT4gbGVmdC5qb2JJZC5sb2NhbGVDb21wYXJlKHJpZ2h0LmpvYklkKSlcblxuICAgIHJldHVybiBPYmplY3QuZnJlZXplKHtcbiAgICAgIGFjdGl2ZUpvYnMsXG4gICAgICBjaGlsZEluc3RhbmNlSWQ6IHN0YXRlLmNoaWxkSW5zdGFuY2VJZCA/PyBvYnNlcnZhdGlvbj8uY2hpbGRJbnN0YW5jZUlkID8/IG51bGwsXG4gICAgICBleGl0Q29kZSxcbiAgICAgIGdlbmVyYXRpb25JZDogdGhpcy5nZW5lcmF0aW9uSWQgPz8gbnVsbCxcbiAgICAgIC4uLmJvdW5kZWRJbmZsaWdodCxcbiAgICAgIG9vbUtpbGxlZDogc2lnbmFsID09PSBcIlNJR0tJTExcIiAmJiBzaHV0ZG93blJlYXNvbiA9PT0gXCJzaWduYWxfc2lna2lsbFwiID8gbnVsbCA6IGZhbHNlLFxuICAgICAgb3JpZ2luLFxuICAgICAgcnVubmVyQWdlTXM6IE1hdGgubWF4KDAsIERhdGUubm93KCkgLSBzdGF0ZS5jcmVhdGVkQXRNcyksXG4gICAgICBydW5uZXJDcmVhdGVkQXRNczogc3RhdGUuY3JlYXRlZEF0TXMsXG4gICAgICBydW5uZXJEZXRhY2hlZDogZmFsc2UsXG4gICAgICBydW5uZXJKb2JzUnVuOiBzdGF0ZS5qb2JzUnVuLFxuICAgICAgcnVubmVyTGlmZWN5Y2xlLFxuICAgICAgcnVubmVyUGlkOiBjaGlsZC5waWQgPz8gbnVsbCxcbiAgICAgIHNpZ25hbCxcbiAgICAgIHNodXRkb3duT2JzZXJ2ZWRBdE1zOiBvYnNlcnZhdGlvbj8uc2h1dGRvd25PYnNlcnZlZEF0TXMgPz8gc3RhdGUuaXBjRGlzY29ubmVjdGVkQXRNcyA/PyBudWxsLFxuICAgICAgc2h1dGRvd25SZXF1ZXN0ZWRBdE1zOiBzdGF0ZS5zaHV0ZG93blJlcXVlc3RlZEF0TXMgPz8gb2JzZXJ2YXRpb24/LnNodXRkb3duUmVxdWVzdGVkQXRNcyA/PyBudWxsLFxuICAgICAgc2h1dGRvd25SZWFzb24sXG4gICAgICBzaHV0ZG93blNpZ25hbDogc3RhdGUuc2h1dGRvd25TaWduYWwgPz8gb2JzZXJ2YXRpb24/LnNpZ25hbCA/PyBzaWduYWwsXG4gICAgICB0ZXJtaW5hdGlvblJlYXNvbixcbiAgICAgIHRpbWVvdXRKb2JJZDogc3RhdGUudGltZW91dEpvYklkID8/IG51bGwsXG4gICAgICB3b3JrZXJJZDogdGhpcy53b3JrZXJJZCxcbiAgICAgIHdvcmtlckxpZmVjeWNsZSxcbiAgICAgIHdvcmtlclBpZDogcHJvY2Vzcy5waWRcbiAgICB9KVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgcnVuIGpvYiBpbmxpbmUuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi90eXBlcy5qc1wiKS5CYWNrZ3JvdW5kSm9iUGF5bG9hZH0gcGF5bG9hZCAtIFBheWxvYWQuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIHdoZW4gZG9uZS5cbiAgICovXG4gIGFzeW5jIF9ydW5Kb2JJbmxpbmUocGF5bG9hZCkge1xuICAgIGNvbnN0IGNvbmZpZ3VyYXRpb24gPSB0aGlzLmNvbmZpZ3VyYXRpb25cbiAgICBpZiAoIWNvbmZpZ3VyYXRpb24pIHRocm93IG5ldyBFcnJvcihcIkJhY2tncm91bmQgam9icyB3b3JrZXIgY29uZmlndXJhdGlvbiBub3QgaW5pdGlhbGl6ZWRcIilcblxuICAgIGNvbnN0IHJlZ2lzdHJ5ID0gbmV3IEJhY2tncm91bmRKb2JSZWdpc3RyeSh7Y29uZmlndXJhdGlvbn0pXG4gICAgYXdhaXQgcmVnaXN0cnkubG9hZCgpXG4gICAgY29uc3QgSm9iQ2xhc3MgPSByZWdpc3RyeS5nZXRKb2JCeU5hbWUocGF5bG9hZC5qb2JOYW1lKVxuICAgIGF3YWl0IHJ1bldpdGhCYWNrZ3JvdW5kSm9iUGF5bG9hZChwYXlsb2FkLCBhc3luYyAoKSA9PiB7XG4gICAgICBhd2FpdCBwZXJmb3JtQmFja2dyb3VuZEpvYih7XG4gICAgICAgIGNvbmZpZ3VyYXRpb24sXG4gICAgICAgIEpvYkNsYXNzLFxuICAgICAgICBqb2JBcmdzOiBwYXlsb2FkLmFyZ3MgfHwgW10sXG4gICAgICAgIGpvYk9wdGlvbnM6IHBheWxvYWQub3B0aW9ucyB8fCB7fSxcbiAgICAgICAgbmFtZTogYEJhY2tncm91bmQgam9iIHdvcmtlciBpbmxpbmU6ICR7cGF5bG9hZC5qb2JOYW1lfWAsXG4gICAgICAgIHBheWxvYWRcbiAgICAgIH0pXG4gICAgfSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGZvcmsgam9iLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vdHlwZXMuanNcIikuQmFja2dyb3VuZEpvYlBheWxvYWQgJiB7aWQ6IHN0cmluZ319IHBheWxvYWQgLSBQYXlsb2FkLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyB3aGVuIHRoZSBmb3JrZWQgcnVubmVyIGV4aXRzIG9yIGZvcmsgZmFpbHMuXG4gICAqL1xuICBfZm9ya0pvYihwYXlsb2FkKSB7XG4gICAgY29uc3QgY2hpbGQgPSB0aGlzLl9jcmVhdGVGb3JrZWRDaGlsZCgpXG5cbiAgICB0aGlzLmluZmxpZ2h0UHJvY2Vzc0NoaWxkcmVuLmFkZChjaGlsZClcblxuICAgIGNvbnN0IGZpbmlzaGVkID0gdGhpcy5fd2FpdEZvckZvcmtlZENoaWxkKHtjaGlsZCwgcGF5bG9hZH0pXG5cbiAgICB0aGlzLl9zZW5kRm9ya2VkUGF5bG9hZCh7Y2hpbGQsIHBheWxvYWR9KVxuXG4gICAgcmV0dXJuIGZpbmlzaGVkXG4gIH1cblxuICAvKipcbiAgICogUnVucyBjcmVhdGUgZm9ya2VkIGNoaWxkLlxuICAgKiBAcmV0dXJucyB7aW1wb3J0KFwibm9kZTpjaGlsZF9wcm9jZXNzXCIpLkNoaWxkUHJvY2Vzc30gLSBGb3JrZWQgY2hpbGQgcHJvY2Vzcy5cbiAgICovXG4gIF9jcmVhdGVGb3JrZWRDaGlsZCgpIHtcbiAgICBjb25zdCBjb25maWd1cmF0aW9uID0gdGhpcy5jb25maWd1cmF0aW9uXG4gICAgaWYgKCFjb25maWd1cmF0aW9uKSB0aHJvdyBuZXcgRXJyb3IoXCJCYWNrZ3JvdW5kIGpvYnMgd29ya2VyIGNvbmZpZ3VyYXRpb24gbm90IGluaXRpYWxpemVkXCIpXG5cbiAgICBjb25zdCBkaXJlY3RvcnkgPSBjb25maWd1cmF0aW9uLmdldERpcmVjdG9yeSgpXG4gICAgcmV0dXJuIGZvcmsoRk9SS0VEX1JVTk5FUl9FTlRSWV9QQVRILCBbXSwge1xuICAgICAgY3dkOiBkaXJlY3RvcnksXG4gICAgICBleGVjQXJndjogdGhpcy5fY2hpbGRSdW5uZXJFeGVjQXJndigpLFxuICAgICAgc3RkaW86IFtcImlnbm9yZVwiLCBcImlnbm9yZVwiLCBcImlnbm9yZVwiLCBcImlwY1wiXSxcbiAgICAgIGVudjogT2JqZWN0LmFzc2lnbih7fSwgcHJvY2Vzcy5lbnYsIHRoaXMuX2NoaWxkQmFja2dyb3VuZEpvYnNFbnZpcm9ubWVudCgpKVxuICAgIH0pXG4gIH1cblxuICAvKipcbiAgICogUnVucyB3YWl0IGZvciBmb3JrZWQgY2hpbGQuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gT3B0aW9ucy5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCJub2RlOmNoaWxkX3Byb2Nlc3NcIikuQ2hpbGRQcm9jZXNzfSBhcmdzLmNoaWxkIC0gRm9ya2VkIGNoaWxkIHByb2Nlc3MuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi90eXBlcy5qc1wiKS5CYWNrZ3JvdW5kSm9iUGF5bG9hZCAmIHtpZDogc3RyaW5nfX0gYXJncy5wYXlsb2FkIC0gUGF5bG9hZC5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgd2hlbiB0aGUgY2hpbGQgZXhpdHMuXG4gICAqL1xuICBfd2FpdEZvckZvcmtlZENoaWxkKHtjaGlsZCwgcGF5bG9hZH0pIHtcbiAgICBjb25zdCB0aW1lb3V0U3RhdGUgPSB0aGlzLl9hcm1Gb3JrZWRKb2JUaW1lb3V0KHtjaGlsZCwgcGF5bG9hZH0pXG5cbiAgICByZXR1cm4gbmV3IFByb21pc2UoKHJlc29sdmUpID0+IHtcbiAgICAgIGNoaWxkLm9uY2UoXCJleGl0XCIsIChjb2RlLCBzaWduYWwpID0+IHtcbiAgICAgICAgdGhpcy5fY2xlYXJGb3JrZWRKb2JUaW1lb3V0KHRpbWVvdXRTdGF0ZSlcbiAgICAgICAgdGhpcy5faGFuZGxlRm9ya2VkQ2hpbGRFeGl0KHtjaGlsZCwgY29kZSwgc2lnbmFsLCBwYXlsb2FkLCByZXNvbHZlLCB0aW1lb3V0U3RhdGV9KVxuICAgICAgfSlcbiAgICAgIGNoaWxkLm9uY2UoXCJlcnJvclwiLCAoZXJyb3IpID0+IHtcbiAgICAgICAgdGhpcy5fY2xlYXJGb3JrZWRKb2JUaW1lb3V0KHRpbWVvdXRTdGF0ZSlcbiAgICAgICAgdGhpcy5faGFuZGxlRm9ya2VkQ2hpbGRFcnJvcih7Y2hpbGQsIGVycm9yLCBwYXlsb2FkLCByZXNvbHZlfSlcbiAgICAgIH0pXG4gICAgfSlcbiAgfVxuXG4gIC8qKlxuICAgKiBBcm1zIGEgd2FsbC1jbG9jayBiYWNrc3RvcCBmb3IgYSBmb3JrZWQgam9iIHJ1bm5lci4gQSBmb3JrZWQgam9iIHN0aWxsXG4gICAqIHJ1bm5pbmcgYWZ0ZXIgYGpvYlRpbWVvdXRNc2AgaXMgdGVybWluYXRlZCAoU0lHVEVSTSwgdGhlbiBTSUdLSUxMIGFmdGVyIHRoZVxuICAgKiBncmFjZSkgc28gYSBzaW5nbGUgZ2VudWluZWx5LWh1bmcgcnVubmVyIGNhbid0IHBpbiBhIGRyYWluaW5nIHdvcmtlciDigJQgYW5kXG4gICAqIGl0cyBmdWxsLWFwcCBib290IGFuZCBkYXRhYmFzZSBjb25uZWN0aW9ucyDigJQgaW5kZWZpbml0ZWx5LiBSZXR1cm5zIGEgc3RhdGVcbiAgICogb2JqZWN0IHRoZSBleGl0L2Vycm9yIGhhbmRsZXJzIHVzZSB0byBjYW5jZWwgdGhlIHRpbWVyIGFuZCB0byByZXBvcnQgYVxuICAgKiB0aW1lb3V0LXNwZWNpZmljIGZhaWx1cmUuIFdoZW4gbm8gdGltZW91dCBpcyBjb25maWd1cmVkIHRoZSB0aW1lciBpcyBudWxsXG4gICAqIGFuZCBiZWhhdmlvciBpcyB1bmNoYW5nZWQuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gT3B0aW9ucy5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCJub2RlOmNoaWxkX3Byb2Nlc3NcIikuQ2hpbGRQcm9jZXNzfSBhcmdzLmNoaWxkIC0gRm9ya2VkIGNoaWxkIHByb2Nlc3MuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi90eXBlcy5qc1wiKS5CYWNrZ3JvdW5kSm9iUGF5bG9hZCAmIHtpZDogc3RyaW5nfX0gYXJncy5wYXlsb2FkIC0gSm9iIHBheWxvYWQuXG4gICAqIEByZXR1cm5zIHtGb3JrZWRKb2JUaW1lb3V0U3RhdGV9IC0gVGltZW91dCBzdGF0ZS5cbiAgICovXG4gIF9hcm1Gb3JrZWRKb2JUaW1lb3V0KHtjaGlsZCwgcGF5bG9hZH0pIHtcbiAgICBjb25zdCB0aW1lb3V0TXMgPSB0aGlzLl9yZXNvbHZlSm9iVGltZW91dE1zKHBheWxvYWQub3B0aW9ucylcbiAgICAvKiogQHR5cGUge0ZvcmtlZEpvYlRpbWVvdXRTdGF0ZX0gKi9cbiAgICBjb25zdCBzdGF0ZSA9IHt0aW1lZE91dDogZmFsc2UsIHRpbWVvdXRNcywgdGltZXI6IG51bGwsIHNpZ2tpbGxUaW1lcjogbnVsbH1cblxuICAgIGlmICghKHR5cGVvZiB0aW1lb3V0TXMgPT09IFwibnVtYmVyXCIgJiYgdGltZW91dE1zID4gMCkpIHJldHVybiBzdGF0ZVxuXG4gICAgc3RhdGUudGltZXIgPSBzZXRUaW1lb3V0KCgpID0+IHRoaXMuX29uRm9ya2VkSm9iVGltZW91dCh7Y2hpbGQsIHN0YXRlfSksIHRpbWVvdXRNcylcblxuICAgIHJldHVybiBzdGF0ZVxuICB9XG5cbiAgLyoqXG4gICAqIFJlc29sdmVzIHRoZSBlZmZlY3RpdmUgd2FsbC1jbG9jayBqb2IgdGltZW91dCBpbiBtcyAoc2hhcmVkIGJ5IGZvcmtlZCBhbmQgcG9vbGVkIGpvYnMpLCBvciBudWxsIHdoZW4gZGlzYWJsZWQuIFRoZVxuICAgKiBwZXItam9iIG92ZXJyaWRlIHdpbnMsIGZvbGxvd2VkIGJ5IHRoZSBjb25zdHJ1Y3RvciBvdmVycmlkZSwgdGhlbiB0aGUgdmFsdWVcbiAgICogZnJvbSB0aGUgYmFja2dyb3VuZC1qb2JzIGNvbmZpZ3VyYXRpb24uIEEgbm9uLXBvc2l0aXZlIHZhbHVlIGRpc2FibGVzIHRoZVxuICAgKiBiYWNrc3RvcCBhdCB3aGljaGV2ZXIgbGV2ZWwgc3VwcGxpZWQgaXQuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi90eXBlcy5qc1wiKS5CYWNrZ3JvdW5kSm9iT3B0aW9uc30gW2pvYk9wdGlvbnNdIC0gUGVyLWpvYiBvcHRpb25zLlxuICAgKiBAcmV0dXJucyB7bnVtYmVyIHwgbnVsbH0gLSBUaW1lb3V0IGluIG1zLCBvciBudWxsIHdoZW4gZGlzYWJsZWQuXG4gICAqL1xuICBfcmVzb2x2ZUpvYlRpbWVvdXRNcyhqb2JPcHRpb25zKSB7XG4gICAgY29uc3QgcmF3ID0gdHlwZW9mIGpvYk9wdGlvbnM/LnRpbWVvdXRNcyA9PT0gXCJudW1iZXJcIlxuICAgICAgPyBqb2JPcHRpb25zLnRpbWVvdXRNc1xuICAgICAgOiAodHlwZW9mIHRoaXMuam9iVGltZW91dE1zT3ZlcnJpZGUgPT09IFwibnVtYmVyXCJcbiAgICAgICAgICA/IHRoaXMuam9iVGltZW91dE1zT3ZlcnJpZGVcbiAgICAgICAgICA6ICh0aGlzLmNvbmZpZ3VyYXRpb24gPyB0aGlzLmNvbmZpZ3VyYXRpb24uZ2V0QmFja2dyb3VuZEpvYnNDb25maWcoKS5qb2JUaW1lb3V0TXMgOiBudWxsKSlcblxuICAgIC8vIEEgbm9uLWZpbml0ZSAoZS5nLiBJbmZpbml0eSkgb3Igbm9uLXBvc2l0aXZlIHZhbHVlIGRpc2FibGVzIHRoZSBiYWNrc3RvcDtcbiAgICAvLyBhIGZpbml0ZSB2YWx1ZSBiZXlvbmQgTm9kZSdzIHRpbWVyIHJhbmdlIGlzIGNsYW1wZWQgdG8gdGhlIG1heCByYXRoZXIgdGhhblxuICAgIC8vIHNpbGVudGx5IGNvZXJjZWQgdG8gfjFtcyAod2hpY2ggd291bGQga2lsbCBldmVyeSBmb3JrZWQgam9iIGltbWVkaWF0ZWx5KS5cbiAgICBpZiAodHlwZW9mIHJhdyAhPT0gXCJudW1iZXJcIiB8fCAhTnVtYmVyLmlzRmluaXRlKHJhdykgfHwgcmF3IDw9IDApIHJldHVybiBudWxsXG5cbiAgICByZXR1cm4gTWF0aC5taW4ocmF3LCBNQVhfRk9SS0VEX0pPQl9USU1FT1VUX01TKVxuICB9XG5cbiAgLyoqXG4gICAqIEZpcmVkIHdoZW4gYSBmb3JrZWQgcnVubmVyIG92ZXJydW5zIGl0cyB0aW1lb3V0LiBTZW5kcyBTSUdURVJNIGZvciBhIGNsZWFuXG4gICAqIHNodXRkb3duLCB0aGVuIFNJR0tJTEwgYWZ0ZXIgdGhlIGdyYWNlIGZvciBhIHJ1bm5lciB0aGF0IGlnbm9yZXMgaXQuIFRoZVxuICAgKiByZXN1bHRpbmcgbm9uLWNsZWFuIGV4aXQgZmxvd3MgdGhyb3VnaCBgX2hhbmRsZUZvcmtlZENoaWxkRXhpdGAsIHdoaWNoIGZyZWVzXG4gICAqIHRoZSBzbG90IGFuZCByZXBvcnRzIHRoZSBqb2IgZmFpbGVkLlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIE9wdGlvbnMuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwibm9kZTpjaGlsZF9wcm9jZXNzXCIpLkNoaWxkUHJvY2Vzc30gYXJncy5jaGlsZCAtIEZvcmtlZCBjaGlsZCBwcm9jZXNzLlxuICAgKiBAcGFyYW0ge0ZvcmtlZEpvYlRpbWVvdXRTdGF0ZX0gYXJncy5zdGF0ZSAtIFRpbWVvdXQgc3RhdGUuXG4gICAqIEByZXR1cm5zIHt2b2lkfVxuICAgKi9cbiAgX29uRm9ya2VkSm9iVGltZW91dCh7Y2hpbGQsIHN0YXRlfSkge1xuICAgIHN0YXRlLnRpbWVkT3V0ID0gdHJ1ZVxuXG4gICAgdHJ5IHtcbiAgICAgIGNoaWxkLmtpbGwoXCJTSUdURVJNXCIpXG4gICAgfSBjYXRjaCB7XG4gICAgICAvLyBDaGlsZCBhbHJlYWR5IGV4aXRlZDsgbm90aGluZyB0byBkby5cbiAgICB9XG5cbiAgICBzdGF0ZS5zaWdraWxsVGltZXIgPSBzZXRUaW1lb3V0KCgpID0+IHtcbiAgICAgIHRyeSB7XG4gICAgICAgIGNoaWxkLmtpbGwoXCJTSUdLSUxMXCIpXG4gICAgICB9IGNhdGNoIHtcbiAgICAgICAgLy8gQ2hpbGQgYWxyZWFkeSBleGl0ZWQ7IG5vdGhpbmcgdG8gZG8uXG4gICAgICB9XG4gICAgfSwgdGhpcy5mb3JrZWRDaGlsZFNpZ2tpbGxHcmFjZU1zKVxuICB9XG5cbiAgLyoqXG4gICAqIENhbmNlbHMgYW55IHBlbmRpbmcgdGltZW91dC9TSUdLSUxMIHRpbWVycyBmb3IgYSBmb3JrZWQgcnVubmVyIHRoYXQgaGFzXG4gICAqIGV4aXRlZCAob3IgZXJyb3JlZCkgc28gdGhleSBuZXZlciBmaXJlIGFnYWluc3QgYSBnb25lIG9yIHJldXNlZCBjaGlsZC5cbiAgICogQHBhcmFtIHtGb3JrZWRKb2JUaW1lb3V0U3RhdGV9IHN0YXRlIC0gVGltZW91dCBzdGF0ZS5cbiAgICogQHJldHVybnMge3ZvaWR9XG4gICAqL1xuICBfY2xlYXJGb3JrZWRKb2JUaW1lb3V0KHN0YXRlKSB7XG4gICAgaWYgKHN0YXRlLnRpbWVyKSB7XG4gICAgICBjbGVhclRpbWVvdXQoc3RhdGUudGltZXIpXG4gICAgICBzdGF0ZS50aW1lciA9IG51bGxcbiAgICB9XG5cbiAgICBpZiAoc3RhdGUuc2lna2lsbFRpbWVyKSB7XG4gICAgICBjbGVhclRpbWVvdXQoc3RhdGUuc2lna2lsbFRpbWVyKVxuICAgICAgc3RhdGUuc2lna2lsbFRpbWVyID0gbnVsbFxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGhhbmRsZSBmb3JrZWQgY2hpbGQgZXhpdC5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBPcHRpb25zLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIm5vZGU6Y2hpbGRfcHJvY2Vzc1wiKS5DaGlsZFByb2Nlc3N9IGFyZ3MuY2hpbGQgLSBGb3JrZWQgY2hpbGQgcHJvY2Vzcy5cbiAgICogQHBhcmFtIHtudW1iZXIgfCBudWxsfSBhcmdzLmNvZGUgLSBFeGl0IGNvZGUuXG4gICAqIEBwYXJhbSB7a2V5b2YgdHlwZW9mIGltcG9ydChcIm5vZGU6b3NcIikuY29uc3RhbnRzLnNpZ25hbHMgfCBudWxsfSBhcmdzLnNpZ25hbCAtIEV4aXQgc2lnbmFsLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vdHlwZXMuanNcIikuQmFja2dyb3VuZEpvYlBheWxvYWQgJiB7aWQ6IHN0cmluZ319IGFyZ3MucGF5bG9hZCAtIFBheWxvYWQuXG4gICAqIEBwYXJhbSB7KHZhbHVlOiB2b2lkKSA9PiB2b2lkfSBhcmdzLnJlc29sdmUgLSBQcm9taXNlIHJlc29sdmVyLlxuICAgKiBAcGFyYW0ge0ZvcmtlZEpvYlRpbWVvdXRTdGF0ZX0gW2FyZ3MudGltZW91dFN0YXRlXSAtIFRpbWVvdXQgc3RhdGUsIHdoZW4gdGhlIHJ1bm5lciBoYWQgYSB3YWxsLWNsb2NrIGJhY2tzdG9wLlxuICAgKiBAcmV0dXJucyB7dm9pZH1cbiAgICovXG4gIF9oYW5kbGVGb3JrZWRDaGlsZEV4aXQoe2NoaWxkLCBjb2RlLCBzaWduYWwsIHBheWxvYWQsIHJlc29sdmUsIHRpbWVvdXRTdGF0ZX0pIHtcbiAgICB0aGlzLmluZmxpZ2h0UHJvY2Vzc0NoaWxkcmVuLmRlbGV0ZShjaGlsZClcblxuICAgIC8vIEZyZWUgdGhlIHdvcmtlciBzbG90IGFzIHNvb24gYXMgdGhlIGNoaWxkIGlzIGdvbmUg4oCUIG5ldmVyIGdhdGUgaXQgb24gdGhlXG4gICAgLy8gZmFpbHVyZSByZXBvcnQuIEEgaHVuZy9zbG93IHJlcG9ydCBtdXN0IG5vdCBsZWFrIHRoZSBzbG90OyBlbm91Z2ggbGVha2VkXG4gICAgLy8gc2xvdHMgZHJpdmUgYGFjY2VwdHNGb3JrZWRgIHRvIGZhbHNlIGFuZCBzaWxlbnRseSB3ZWRnZSB0aGUgd29ya2VyLlxuICAgIHJlc29sdmUodW5kZWZpbmVkKVxuXG4gICAgaWYgKHRoaXMuX2ZvcmtlZENoaWxkRXhpdGVkQ2xlYW5seSh7Y29kZSwgc2lnbmFsfSkpIHJldHVyblxuXG4gICAgY29uc3QgZXJyb3IgPSB0aW1lb3V0U3RhdGU/LnRpbWVkT3V0XG4gICAgICA/IG5ldyBFcnJvcihgRm9ya2VkIGJhY2tncm91bmQgam9iIHJ1bm5lciB0aW1lZCBvdXQgYWZ0ZXIgJHt0aW1lb3V0U3RhdGUudGltZW91dE1zfW1zIGFuZCB3YXMgdGVybWluYXRlZDogY29kZT0ke2NvZGV9IHNpZ25hbD0ke3NpZ25hbCB8fCBcIm5vbmVcIn1gKVxuICAgICAgOiBuZXcgRXJyb3IoYEZvcmtlZCBiYWNrZ3JvdW5kIGpvYiBydW5uZXIgZXhpdGVkIGJlZm9yZSByZXBvcnRpbmc6IGNvZGU9JHtjb2RlfSBzaWduYWw9JHtzaWduYWwgfHwgXCJub25lXCJ9YClcblxuICAgIHRoaXMuX3JlcG9ydEZvcmtlZENoaWxkRmFpbHVyZSh7cGF5bG9hZCwgZXJyb3J9KVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZm9ya2VkIGNoaWxkIGV4aXRlZCBjbGVhbmx5LlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIE9wdGlvbnMuXG4gICAqIEBwYXJhbSB7bnVtYmVyIHwgbnVsbH0gYXJncy5jb2RlIC0gRXhpdCBjb2RlLlxuICAgKiBAcGFyYW0ge2tleW9mIHR5cGVvZiBpbXBvcnQoXCJub2RlOm9zXCIpLmNvbnN0YW50cy5zaWduYWxzIHwgbnVsbH0gYXJncy5zaWduYWwgLSBFeGl0IHNpZ25hbC5cbiAgICogQHJldHVybnMge2Jvb2xlYW59IC0gV2hldGhlciB0aGUgY2hpbGQgZXhpdGVkIGNsZWFubHkuXG4gICAqL1xuICBfZm9ya2VkQ2hpbGRFeGl0ZWRDbGVhbmx5KHtjb2RlLCBzaWduYWx9KSB7XG4gICAgcmV0dXJuIGNvZGUgPT09IDAgJiYgIXNpZ25hbFxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgaGFuZGxlIGZvcmtlZCBjaGlsZCBlcnJvci5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBPcHRpb25zLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIm5vZGU6Y2hpbGRfcHJvY2Vzc1wiKS5DaGlsZFByb2Nlc3N9IGFyZ3MuY2hpbGQgLSBGb3JrZWQgY2hpbGQgcHJvY2Vzcy5cbiAgICogQHBhcmFtIHtFcnJvcn0gYXJncy5lcnJvciAtIENoaWxkIHByb2Nlc3MgZXJyb3IuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi90eXBlcy5qc1wiKS5CYWNrZ3JvdW5kSm9iUGF5bG9hZCAmIHtpZDogc3RyaW5nfX0gYXJncy5wYXlsb2FkIC0gUGF5bG9hZC5cbiAgICogQHBhcmFtIHsodmFsdWU6IHZvaWQpID0+IHZvaWR9IGFyZ3MucmVzb2x2ZSAtIFByb21pc2UgcmVzb2x2ZXIuXG4gICAqIEByZXR1cm5zIHt2b2lkfVxuICAgKi9cbiAgX2hhbmRsZUZvcmtlZENoaWxkRXJyb3Ioe2NoaWxkLCBlcnJvciwgcGF5bG9hZCwgcmVzb2x2ZX0pIHtcbiAgICB0aGlzLmluZmxpZ2h0UHJvY2Vzc0NoaWxkcmVuLmRlbGV0ZShjaGlsZClcbiAgICAvLyBGcmVlIHRoZSBzbG90IGZpcnN0IChzZWUgX2hhbmRsZUZvcmtlZENoaWxkRXhpdCkg4oCUIHJlcG9ydGluZyBpcyBiZXN0LWVmZm9ydC5cbiAgICByZXNvbHZlKHVuZGVmaW5lZClcbiAgICBjb25zb2xlLmVycm9yKFwiQmFja2dyb3VuZCBqb2JzIGZvcmtlZCBydW5uZXIgZXJyb3I6XCIsIGVycm9yKVxuICAgIHRoaXMuX3JlcG9ydEZvcmtlZENoaWxkRmFpbHVyZSh7cGF5bG9hZCwgZXJyb3J9KVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgc2VuZCBmb3JrZWQgcGF5bG9hZC5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBPcHRpb25zLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIm5vZGU6Y2hpbGRfcHJvY2Vzc1wiKS5DaGlsZFByb2Nlc3N9IGFyZ3MuY2hpbGQgLSBGb3JrZWQgY2hpbGQgcHJvY2Vzcy5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL3R5cGVzLmpzXCIpLkJhY2tncm91bmRKb2JQYXlsb2FkICYge2lkOiBzdHJpbmd9fSBhcmdzLnBheWxvYWQgLSBQYXlsb2FkLlxuICAgKiBAcmV0dXJucyB7dm9pZH1cbiAgICovXG4gIF9zZW5kRm9ya2VkUGF5bG9hZCh7Y2hpbGQsIHBheWxvYWR9KSB7XG4gICAgdHJ5IHtcbiAgICAgIGNoaWxkLnNlbmQoe3R5cGU6IFwiam9iXCIsIHBheWxvYWR9KVxuICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICBjaGlsZC5raWxsKFwiU0lHVEVSTVwiKVxuICAgICAgdGhpcy5fcmVwb3J0Rm9ya2VkQ2hpbGRGYWlsdXJlKHtwYXlsb2FkLCBlcnJvcn0pXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgcmVwb3J0IGZvcmtlZCBjaGlsZCBmYWlsdXJlLlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIE9wdGlvbnMuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi90eXBlcy5qc1wiKS5CYWNrZ3JvdW5kSm9iUGF5bG9hZCAmIHtpZDogc3RyaW5nfX0gYXJncy5wYXlsb2FkIC0gUGF5bG9hZC5cbiAgICogQHBhcmFtIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gYXJncy5lcnJvciAtIEVycm9yLlxuICAgKiBAcmV0dXJucyB7dm9pZH1cbiAgICovXG4gIF9yZXBvcnRGb3JrZWRDaGlsZEZhaWx1cmUoe3BheWxvYWQsIGVycm9yfSkge1xuICAgIHRoaXMuX3JlcG9ydEpvYlJlc3VsdEluQmFja2dyb3VuZCh7XG4gICAgICBqb2JJZDogcGF5bG9hZC5pZCxcbiAgICAgIHN0YXR1czogXCJmYWlsZWRcIixcbiAgICAgIGVycm9yLFxuICAgICAgaGFuZG9mZklkOiBwYXlsb2FkLmhhbmRvZmZJZCxcbiAgICAgIGhhbmRlZE9mZkF0TXM6IHBheWxvYWQuaGFuZGVkT2ZmQXRNcyxcbiAgICAgIHdvcmtlcklkOiBwYXlsb2FkLndvcmtlcklkIHx8IHRoaXMud29ya2VySWRcbiAgICB9KVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgc3Bhd24gam9iLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vdHlwZXMuanNcIikuQmFja2dyb3VuZEpvYlBheWxvYWR9IHBheWxvYWQgLSBQYXlsb2FkLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyB3aGVuIHRoZSBzcGF3bmVkIHJ1bm5lciBleGl0cyBvciBzcGF3biBmYWlscy5cbiAgICovXG4gIF9zcGF3bkpvYihwYXlsb2FkKSB7XG4gICAgY29uc3QgY29uZmlndXJhdGlvbiA9IHRoaXMuY29uZmlndXJhdGlvblxuICAgIGlmICghY29uZmlndXJhdGlvbikgdGhyb3cgbmV3IEVycm9yKFwiQmFja2dyb3VuZCBqb2JzIHdvcmtlciBjb25maWd1cmF0aW9uIG5vdCBpbml0aWFsaXplZFwiKVxuXG4gICAgY29uc3QgZGlyZWN0b3J5ID0gY29uZmlndXJhdGlvbi5nZXREaXJlY3RvcnkoKVxuICAgIGNvbnN0IGFyZ3ZDb21tYW5kID0gcHJvY2Vzcy5hcmd2WzFdXG4gICAgY29uc3QgY29tbWFuZCA9IGFyZ3ZDb21tYW5kID8gYXJndkNvbW1hbmQgOiBgJHtkaXJlY3Rvcnl9L2Jpbi92ZWxvY2lvdXMuanNgXG4gICAgY29uc3QgZW5jb2RlZFBheWxvYWQgPSBCdWZmZXIuZnJvbShKU09OLnN0cmluZ2lmeShwYXlsb2FkKSkudG9TdHJpbmcoXCJiYXNlNjRcIilcbiAgICBjb25zdCBjaGlsZCA9IHNwYXduKHByb2Nlc3MuZXhlY1BhdGgsIFsuLi50aGlzLl9jaGlsZFJ1bm5lckV4ZWNBcmd2KCksIGNvbW1hbmQsIFwiYmFja2dyb3VuZC1qb2JzLXJ1bm5lclwiXSwge1xuICAgICAgY3dkOiBkaXJlY3RvcnksXG4gICAgICBkZXRhY2hlZDogdHJ1ZSxcbiAgICAgIHN0ZGlvOiBcImlnbm9yZVwiLFxuICAgICAgZW52OiBPYmplY3QuYXNzaWduKHt9LCBwcm9jZXNzLmVudiwgdGhpcy5fY2hpbGRCYWNrZ3JvdW5kSm9ic0Vudmlyb25tZW50KCksIHtWRUxPQ0lPVVNfSk9CX1BBWUxPQUQ6IGVuY29kZWRQYXlsb2FkfSlcbiAgICB9KVxuXG4gICAgdGhpcy5pbmZsaWdodFByb2Nlc3NDaGlsZHJlbi5hZGQoY2hpbGQpXG5cbiAgICBjb25zdCBmaW5pc2hlZCA9IG5ldyBQcm9taXNlKChyZXNvbHZlKSA9PiB7XG4gICAgICBjaGlsZC5vbmNlKFwiZXhpdFwiLCAoKSA9PiB7XG4gICAgICAgIHRoaXMuaW5mbGlnaHRQcm9jZXNzQ2hpbGRyZW4uZGVsZXRlKGNoaWxkKVxuICAgICAgICByZXNvbHZlKHVuZGVmaW5lZClcbiAgICAgIH0pXG4gICAgICBjaGlsZC5vbmNlKFwiZXJyb3JcIiwgKGVycm9yKSA9PiB7XG4gICAgICAgIHRoaXMuaW5mbGlnaHRQcm9jZXNzQ2hpbGRyZW4uZGVsZXRlKGNoaWxkKVxuICAgICAgICBjb25zb2xlLmVycm9yKFwiQmFja2dyb3VuZCBqb2JzIHNwYXduZWQgcnVubmVyIGVycm9yOlwiLCBlcnJvcilcbiAgICAgICAgcmVzb2x2ZSh1bmRlZmluZWQpXG4gICAgICB9KVxuICAgIH0pXG5cbiAgICBjaGlsZC51bnJlZigpXG5cbiAgICByZXR1cm4gZmluaXNoZWRcbiAgfVxuXG4gIC8qKlxuICAgKiBCdWlsZHMgdGhlIG5vZGUgb3B0aW9ucyBhcHBsaWVkIHRvIGV2ZXJ5IGJhY2tncm91bmQtam9icyBydW5uZXIgY2hpbGQuXG4gICAqIEEgaGFyZCBWOCBoZWFwIGNhcCBrZWVwcyBvbmUgY2hpbGQgZnJvbSBldmVyIGNvbW1pdHRpbmcgbXVsdGlwbGUgR0JzIG9mXG4gICAqIGhlYXA7IGl0IHN0YXlzIGRlbGliZXJhdGVseSBnZW5lcm91cyByZWxhdGl2ZSB0byBvYnNlcnZlZCBydW5uZXIgdXNhZ2VcbiAgICogKHRlbnMgdG8gYSBmZXcgaHVuZHJlZCBNQikgYW5kIGlzIGNvbmZpZ3VyYWJsZSB2aWFcbiAgICogYGJhY2tncm91bmRKb2JzLnJ1bm5lck1heE9sZFNwYWNlU2l6ZU1iYC5cbiAgICogQHJldHVybnMge3N0cmluZ1tdfSAtIE5vZGUgb3B0aW9ucyBmb3IgcnVubmVyIGNoaWxkcmVuLlxuICAgKi9cbiAgX2NoaWxkUnVubmVyRXhlY0FyZ3YoKSB7XG4gICAgcmV0dXJuIFtgLS1tYXgtb2xkLXNwYWNlLXNpemU9JHt0aGlzLnJ1bm5lck1heE9sZFNwYWNlU2l6ZU1ifWBdXG4gIH1cblxuICAvKipcbiAgICogQnVpbGRzIHRoZSBleGFjdCBtYWluIGVuZHBvaW50IGFuZCBnZW5lcmF0aW9uIGluaGVyaXRlZCBieSBldmVyeSBjaGlsZC5cbiAgICogQHJldHVybnMge1JlY29yZDxzdHJpbmcsIHN0cmluZz59IC0gQ2hpbGQgcHJvY2VzcyBlbnZpcm9ubWVudCBhZGRpdGlvbnMuXG4gICAqL1xuICBfY2hpbGRCYWNrZ3JvdW5kSm9ic0Vudmlyb25tZW50KCkge1xuICAgIGNvbnN0IGNvbmZpZ3VyYXRpb24gPSB0aGlzLmNvbmZpZ3VyYXRpb25cbiAgICBpZiAoIWNvbmZpZ3VyYXRpb24pIHRocm93IG5ldyBFcnJvcihcIkJhY2tncm91bmQgam9icyB3b3JrZXIgY29uZmlndXJhdGlvbiBub3QgaW5pdGlhbGl6ZWRcIilcbiAgICBpZiAoIXRoaXMuaG9zdCB8fCB0eXBlb2YgdGhpcy5wb3J0ICE9PSBcIm51bWJlclwiKSB0aHJvdyBuZXcgRXJyb3IoXCJCYWNrZ3JvdW5kIGpvYnMgd29ya2VyIGVuZHBvaW50IG5vdCByZXNvbHZlZFwiKVxuXG4gICAgcmV0dXJuIHtcbiAgICAgIFZFTE9DSU9VU19CQUNLR1JPVU5EX0pPQl9DSElMRDogXCIxXCIsXG4gICAgICBWRUxPQ0lPVVNfRU5WOiBjb25maWd1cmF0aW9uLmdldEVudmlyb25tZW50KCksXG4gICAgICBWRUxPQ0lPVVNfQkFDS0dST1VORF9KT0JTX0hPU1Q6IHRoaXMuaG9zdCxcbiAgICAgIFZFTE9DSU9VU19CQUNLR1JPVU5EX0pPQlNfUE9SVDogYCR7dGhpcy5wb3J0fWAsXG4gICAgICBNQUxMT0NfQVJFTkFfTUFYOiBgJHt0aGlzLnJ1bm5lck1hbGxvY0FyZW5hTWF4fWAsXG4gICAgICAuLi4odGhpcy5nZW5lcmF0aW9uSWQgPyB7VkVMT0NJT1VTX0JBQ0tHUk9VTkRfSk9CU19HRU5FUkFUSU9OX0lEOiB0aGlzLmdlbmVyYXRpb25JZH0gOiB7fSlcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogUnVucyByZXBvcnQgam9iIHJlc3VsdC5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBPcHRpb25zLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gYXJncy5qb2JJZCAtIEpvYiBpZC5cbiAgICogQHBhcmFtIHtcImNvbXBsZXRlZFwiIHwgXCJmYWlsZWRcIiB8IFwicmVzY2hlZHVsZWRcIn0gYXJncy5zdGF0dXMgLSBTdGF0dXMuXG4gICAqIEBwYXJhbSB7bnVtYmVyfSBbYXJncy5kZWxheU1zXSAtIFJlc2NoZWR1bGUgZGVsYXkgaW4gbWlsbGlzZWNvbmRzLlxuICAgKiBAcGFyYW0ge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSBbYXJncy5lcnJvcl0gLSBFcnJvci5cbiAgICogQHBhcmFtIHtzdHJpbmd9IFthcmdzLmhhbmRvZmZJZF0gLSBIYW5kb2ZmIGxlYXNlIGlkLlxuICAgKiBAcGFyYW0ge251bWJlcn0gW2FyZ3MuaGFuZGVkT2ZmQXRNc10gLSBIYW5kZWQgb2ZmIHRpbWVzdGFtcC5cbiAgICogQHBhcmFtIHtzdHJpbmd9IFthcmdzLndvcmtlcklkXSAtIFdvcmtlciBpZC5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL3R5cGVzLmpzXCIpLlBvb2xlZFJ1bm5lckZhaWx1cmV9IFthcmdzLnJ1bm5lckZhaWx1cmVdIC0gUG9vbGVkLWNoaWxkIHByb2Nlc3MgZmFpbHVyZSBwcm92ZW5hbmNlLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyB3aGVuIHJlcG9ydGVkLlxuICAgKi9cbiAgYXN5bmMgX3JlcG9ydEpvYlJlc3VsdCh7am9iSWQsIHN0YXR1cywgZGVsYXlNcywgZXJyb3IsIGhhbmRvZmZJZCwgaGFuZGVkT2ZmQXRNcywgd29ya2VySWQsIHJ1bm5lckZhaWx1cmV9KSB7XG4gICAgaWYgKCF0aGlzLnN0YXR1c1JlcG9ydGVyKSByZXR1cm5cblxuICAgIHRyeSB7XG4gICAgICAvLyBSZXRyeSBhIHRyYW5zaWVudCBwZXJzaXN0IGZhaWx1cmUgKGBqb2ItdXBkYXRlLWVycm9yYCk6IHRoZSB3b3JrZXIgaXNcbiAgICAgIC8vIGxvbmctbGl2ZWQgYW5kIGNhbm5vdCBleGl0IHRvIHRyaWdnZXIgb3JwaGFuIHJlY2xhaW0sIHNvIGRyb3BwaW5nIHRoZVxuICAgICAgLy8gY29tcGxldGlvbiBoZXJlIHdvdWxkIHN0cmFuZCB0aGUgam9iIGluIGBoYW5kZWRfb2ZmYCBmb3JldmVyIOKAlCBmYXRhbCBmb3IgYVxuICAgICAgLy8gYG1heF9jb25jdXJyZW5jeTogMWAgam9iIChhIHN0cmFuZGVkIHJvdyBibG9ja3MgZXZlcnkgZnV0dXJlIHJ1bikuXG4gICAgICBhd2FpdCB0aGlzLnN0YXR1c1JlcG9ydGVyLnJlcG9ydFdpdGhSZXRyeSh7am9iSWQsIHN0YXR1cywgZGVsYXlNcywgZXJyb3IsIGhhbmRvZmZJZCwgaGFuZGVkT2ZmQXRNcywgd29ya2VySWQsIHJ1bm5lckZhaWx1cmUsIHJldHJ5UGVyc2lzdEVycm9yczogdHJ1ZX0pXG4gICAgfSBjYXRjaCAocmVwb3J0RXJyb3IpIHtcbiAgICAgIGNvbnNvbGUuZXJyb3IoXCJCYWNrZ3JvdW5kIGpvYiBzdGF0dXMgcmVwb3J0aW5nIGZhaWxlZDpcIiwgcmVwb3J0RXJyb3IpXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIEZpcmVzIGEgZHVyYWJsZSBqb2ItcmVzdWx0IHJlcG9ydCB3aXRob3V0IGJsb2NraW5nIHRoZSBjYWxsZXIgKHNvIGZyZWVpbmcgYVxuICAgKiBqb2IvY2hpbGQgc2xvdCBuZXZlciB3YWl0cyBvbiB0aGUgcmVwb3J0KS4gVGhlIHJlcG9ydCBpcyB0cmFja2VkIHNvIGFcbiAgICogZ3JhY2VmdWwgYHN0b3AoKWAgY2FuIGRyYWluIGluLWZsaWdodCByZXBvcnRzIGJlZm9yZSBjbG9zaW5nIHRoZSBzb2NrZXQuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gT3B0aW9ucy5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGFyZ3Muam9iSWQgLSBKb2IgaWQuXG4gICAqIEBwYXJhbSB7XCJjb21wbGV0ZWRcIiB8IFwiZmFpbGVkXCIgfCBcInJlc2NoZWR1bGVkXCJ9IGFyZ3Muc3RhdHVzIC0gU3RhdHVzLlxuICAgKiBAcGFyYW0ge251bWJlcn0gW2FyZ3MuZGVsYXlNc10gLSBSZXNjaGVkdWxlIGRlbGF5IGluIG1pbGxpc2Vjb25kcy5cbiAgICogQHBhcmFtIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gW2FyZ3MuZXJyb3JdIC0gRXJyb3IuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBbYXJncy5oYW5kb2ZmSWRdIC0gSGFuZG9mZiBsZWFzZSBpZC5cbiAgICogQHBhcmFtIHtudW1iZXJ9IFthcmdzLmhhbmRlZE9mZkF0TXNdIC0gSGFuZGVkIG9mZiB0aW1lc3RhbXAuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBbYXJncy53b3JrZXJJZF0gLSBXb3JrZXIgaWQuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi90eXBlcy5qc1wiKS5Qb29sZWRSdW5uZXJGYWlsdXJlfSBbYXJncy5ydW5uZXJGYWlsdXJlXSAtIFBvb2xlZC1jaGlsZCBwcm9jZXNzIGZhaWx1cmUgcHJvdmVuYW5jZS5cbiAgICogQHJldHVybnMge3ZvaWR9XG4gICAqL1xuICBfcmVwb3J0Sm9iUmVzdWx0SW5CYWNrZ3JvdW5kKHtqb2JJZCwgc3RhdHVzLCBkZWxheU1zLCBlcnJvciwgaGFuZG9mZklkLCBoYW5kZWRPZmZBdE1zLCB3b3JrZXJJZCwgcnVubmVyRmFpbHVyZX0pIHtcbiAgICAvKipcbiAgICAgKiBEZWZpbmVzIHJlcG9ydC5cbiAgICAgKiBAdHlwZSB7UHJvbWlzZTx2b2lkPn0gKi9cbiAgICBsZXQgcmVwb3J0XG5cbiAgICByZXBvcnQgPSB0aGlzLl9yZXBvcnRKb2JSZXN1bHQoe2pvYklkLCBzdGF0dXMsIGRlbGF5TXMsIGVycm9yLCBoYW5kb2ZmSWQsIGhhbmRlZE9mZkF0TXMsIHdvcmtlcklkLCBydW5uZXJGYWlsdXJlfSkuZmluYWxseSgoKSA9PiB7XG4gICAgICB0aGlzLmluZmxpZ2h0UmVwb3J0cy5kZWxldGUocmVwb3J0KVxuICAgIH0pXG5cbiAgICB0aGlzLmluZmxpZ2h0UmVwb3J0cy5hZGQocmVwb3J0KVxuICB9XG59XG4iXX0=