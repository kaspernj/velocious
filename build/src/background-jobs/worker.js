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
 * @property {number} lastActivityAtMs - Last time the worker saw any IPC message from this child, or dispatched to it.
 * @property {ReturnType<typeof setTimeout>} [silenceTimer] - Armed per-child IPC-silence watchdog timer.
 * @property {ReturnType<typeof setTimeout>} [silenceSigkillTimer] - Pending SIGKILL for a child the silence watchdog declared wedged.
 */
/** Grace period after SIGTERM before a lingering process runner is SIGKILLed. */
const FORKED_CHILD_SIGKILL_GRACE_MS = 5000;
/** Time a drained retirement gives the child IPC request to begin teardown before SIGTERM fallback. */
const POOLED_RUNNER_SHUTDOWN_REQUEST_GRACE_MS = 250;
/**
 * Default bound on how long a pooled child with in-flight jobs may stay silent on
 * its IPC channel before the worker declares it wedged. A healthy child samples its
 * memory every 10 seconds while jobs run, so silence past this bound means its event
 * loop cannot run its own timers — the signature of the silent transport wedge. The
 * bound is deliberately far above a healthy long job's quiet window: it only fires on
 * a child that cannot prove it is alive, never on a genuinely busy runner.
 */
const POOLED_CHILD_SILENCE_TIMEOUT_MS = 120000;
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
     * @param {number} [args.pooledRunnerSilenceTimeoutMs] - Override the per-child IPC-silence bound for pooled children with in-flight jobs from `configuration.getBackgroundJobsConfig()` (default 120000ms). `0` disables the watchdog.
     * @param {boolean} [args.closeDatabaseConnectionsOnStop] - Whether stop owns closing the configuration's database pools (default true).
     * @param {() => void | Promise<void>} [args.onStopped] - Lifecycle hook invoked after the worker finishes stopping.
     * @param {() => void} [args.onGenerationAccepted] - Explicit generation-acceptance observation hook.
     * @param {() => void} [args.onRetireMessage] - Explicit retire-message observation hook.
     * @param {(observation: import("./types.js").PooledChildMemoryObservation) => void | Promise<void>} [args.onPooledRunnerMemoryObservation] - Explicit pooled-child memory observation hook. Every validated observation (periodic while a child has in-flight jobs, plus on demand) is forwarded here, in addition to the worker's compact stderr log line, so an application can route memory diagnostics (e.g. to a bug reporter) without parsing logs.
     * @param {(payload: import("./types.js").BackgroundJobPayload) => void} [args.onJobAccepted] - Explicit job-acceptance observation hook. Fires the moment the worker accepts a dispatched job payload, before execution mode routing, so an observer can wait for the pickup event instead of polling in-flight sets.
     */
    constructor({ configuration, host, port, generationId, workerInstanceId, maxConcurrentForkedJobs, maxConcurrentInlineJobs, pooledRunnerCount, pooledRunnerConcurrency, pooledRunnerMaxJobs, pooledRunnerMaxRssBytes, pooledRunnerMaxLifetimeMs, runnerMaxOldSpaceSizeMb, runnerMallocArenaMax, forkedChildSigkillGraceMs, heartbeatIntervalMs, generationHandshakeTimeoutMs = DEFAULT_GENERATION_HANDSHAKE_TIMEOUT_MS, reconnectDelayMs = 1000, jobTimeoutMs, pooledRunnerSilenceTimeoutMs, closeDatabaseConnectionsOnStop = true, onStopped, onGenerationAccepted, onRetireMessage, onPooledRunnerMemoryObservation, onJobAccepted } = {}) {
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
        this.onJobAccepted = onJobAccepted;
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
        this.pooledRunnerSilenceTimeoutMsOverride = typeof pooledRunnerSilenceTimeoutMs === "number" ? pooledRunnerSilenceTimeoutMs : undefined;
        this.pooledRunnerSilenceTimeoutMs = this.pooledRunnerSilenceTimeoutMsOverride ?? POOLED_CHILD_SILENCE_TIMEOUT_MS;
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
        if (typeof this.pooledRunnerSilenceTimeoutMsOverride !== "number" && typeof poolConfig.pooledRunnerSilenceTimeoutMs === "number")
            this.pooledRunnerSilenceTimeoutMs = poolConfig.pooledRunnerSilenceTimeoutMs;
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
        this.onJobAccepted?.(identifiedPayload);
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
        this._notePooledChildActivity({ child, state });
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
        this.pooledChildStates.set(child, { createdAtMs: Date.now(), jobsRun: 0, inflight: new Map(), lastDispatchSeq: 0, retiring: false, started: false, lastActivityAtMs: Date.now() });
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
        this._notePooledChildActivity({ child, state });
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
     * Records one pooled child's IPC activity and re-arms its silence watchdog while
     * that child still owns in-flight jobs. Every message the child sends — readiness,
     * acceptance, memory observation, shutdown observation, or job outcome — proves its
     * event loop is running, because a healthy child samples itself every 10 seconds
     * while jobs are in flight. Silence past the bound therefore means a wedged child
     * that can no longer prove it is alive, not a busy one.
     * @param {object} args - Activity details.
     * @param {import("node:child_process").ChildProcess} args.child - Pooled child.
     * @param {PooledChildState | undefined} args.state - Child state.
     * @returns {void}
     */
    _notePooledChildActivity({ child, state }) {
        if (!state)
            return;
        state.lastActivityAtMs = Date.now();
        if (state.inflight.size > 0 && !state.settling)
            this._armPooledChildSilenceTimer({ child, state });
    }
    /**
     * Resolves the effective pooled-child silence bound in ms, or null when disabled.
     * A non-positive or non-finite value disables the watchdog at whichever level
     * supplied it, matching the job-timeout contract.
     * @returns {number | null} - Bound in ms, or null when disabled.
     */
    _resolvePooledChildSilenceTimeoutMs() {
        const raw = this.pooledRunnerSilenceTimeoutMs;
        if (typeof raw !== "number" || !Number.isFinite(raw) || raw <= 0)
            return null;
        return Math.min(raw, MAX_FORKED_JOB_TIMEOUT_MS);
    }
    /**
     * Re-arms one child's silence watchdog from its last observed activity. Only
     * children with in-flight jobs are watched: a child with nothing in flight cannot
     * strand work, and its periodic sampler is inactive then, so silence is not
     * evidence of a wedge.
     * @param {object} args - Watchdog details.
     * @param {import("node:child_process").ChildProcess} args.child - Pooled child.
     * @param {PooledChildState} args.state - Child state.
     * @returns {void}
     */
    _armPooledChildSilenceTimer({ child, state }) {
        const timeoutMs = this._resolvePooledChildSilenceTimeoutMs();
        if (!(typeof timeoutMs === "number" && timeoutMs > 0))
            return;
        if (state.silenceTimer)
            clearTimeout(state.silenceTimer);
        state.silenceTimer = setTimeout(() => this._onPooledChildSilence({ child, state }), timeoutMs);
        if (typeof state.silenceTimer.unref === "function")
            state.silenceTimer.unref();
    }
    /**
     * Fired when a pooled child with in-flight jobs stays silent past the bound. A
     * wedged child keeps its IPC channel open but stops running its own timers, so the
     * disconnect/exit path never fires and its jobs stay stranded until a human
     * notices. The worker declares the child dead: it requests shutdown under the exact
     * `child_silence` reason, reports the whole in-flight set as failed through the
     * established failure path (so the jobs requeue and capacity is re-advertised), and
     * signals the wedged process — SIGTERM, then SIGKILL after the existing grace — so
     * it actually goes away instead of blocking the event loop forever.
     * @param {object} args - Watchdog details.
     * @param {import("node:child_process").ChildProcess} args.child - Pooled child.
     * @param {PooledChildState} args.state - Child state.
     * @returns {void}
     */
    _onPooledChildSilence({ child, state }) {
        state.silenceTimer = undefined;
        if (state.settling || state.shutdownReason)
            return;
        const silentMs = Date.now() - state.lastActivityAtMs;
        const boundMs = this._resolvePooledChildSilenceTimeoutMs();
        if (!(typeof boundMs === "number" && silentMs >= boundMs))
            return;
        const error = new Error(`Pooled background job runner went silent for ${silentMs}ms past the ${boundMs}ms bound — treated as wedged`);
        this._logPooledSilenceEvent({ child, state, silentMs, boundMs });
        this._requestPooledChildShutdown({ child, reason: "child_silence", signal: "SIGTERM" });
        void this._handlePooledChildFailure({ child, error, origin: "child-silence", signal: null });
        state.silenceSigkillTimer = setTimeout(() => {
            state.silenceSigkillTimer = undefined;
            this._signalPooledChild({ child, signal: "SIGKILL" });
        }, this.forkedChildSigkillGraceMs);
        if (typeof state.silenceSigkillTimer.unref === "function")
            state.silenceSigkillTimer.unref();
    }
    /**
     * Logs one compact JSON line naming a child the silence watchdog declared wedged
     * (the same stderr surface the memory observations use, which reaches the production
     * log), so the recovery is attributable after the fact instead of looking like a
     * random runner exit.
     * @param {object} args - Event details.
     * @param {import("node:child_process").ChildProcess} args.child - Pooled child.
     * @param {PooledChildState} args.state - Child state.
     * @param {number} args.silentMs - Observed silence in ms.
     * @param {number} args.boundMs - Configured bound in ms.
     * @returns {void}
     */
    _logPooledSilenceEvent({ child, state, silentMs, boundMs }) {
        console.error(JSON.stringify({
            event: "pooled-child-silence",
            childInstanceId: state.childInstanceId ?? null,
            childPid: child.pid ?? null,
            silentMs,
            boundMs,
            jobs: state.inflight.size
        }));
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
            if (state.silenceTimer)
                clearTimeout(state.silenceTimer);
            if (state.silenceSigkillTimer)
                clearTimeout(state.silenceSigkillTimer);
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoid29ya2VyLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiLi4vLi4vLi4vc3JjL2JhY2tncm91bmQtam9icy93b3JrZXIuanMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6IkFBQUEsWUFBWTtBQUVaLE9BQU8sR0FBRyxNQUFNLEtBQUssQ0FBQTtBQUNyQixPQUFPLEVBQUUsSUFBSSxFQUFFLEtBQUssRUFBRSxNQUFNLG9CQUFvQixDQUFBO0FBQ2hELE9BQU8sVUFBVSxNQUFNLGtCQUFrQixDQUFBO0FBQ3pDLE9BQU8scUJBQXFCLE1BQU0sbUJBQW1CLENBQUE7QUFDckQsT0FBTyxxQkFBcUIsTUFBTSw4QkFBOEIsQ0FBQTtBQUNoRSxPQUFPLDRCQUE0QixNQUFNLHNCQUFzQixDQUFBO0FBQy9ELE9BQU8sRUFBRSxVQUFVLEVBQUUsTUFBTSxRQUFRLENBQUE7QUFDbkMsT0FBTyxFQUFFLGFBQWEsRUFBRSxNQUFNLFVBQVUsQ0FBQTtBQUN4QyxPQUFPLGlCQUFpQixFQUFFLEVBQUUsZ0JBQWdCLEVBQUUsTUFBTSxnQ0FBZ0MsQ0FBQTtBQUNwRixPQUFPLDZCQUE2QixNQUFNLHdCQUF3QixDQUFBO0FBQ2xFLE9BQU8sb0JBQW9CLE1BQU0sa0JBQWtCLENBQUE7QUFDbkQsT0FBTyxFQUFFLDJCQUEyQixFQUFFLE1BQU0sd0JBQXdCLENBQUE7QUFDcEUsT0FBTyxFQUFFLHdCQUF3QixFQUFFLE1BQU0sMEJBQTBCLENBQUE7QUFDbkUsT0FBTyw2Q0FBNkMsRUFBRSxFQUFFLHVDQUF1QyxFQUFFLG9DQUFvQyxFQUFFLE1BQU0seUNBQXlDLENBQUE7QUFDdEwsT0FBTyxFQUFFLG1DQUFtQyxFQUFFLGlDQUFpQyxFQUFFLDJCQUEyQixFQUFFLDJCQUEyQixFQUFFLE1BQU0sNkJBQTZCLENBQUE7QUFFOUs7Ozs7Ozs7R0FPRztBQUNIOzs7Ozs7R0FNRztBQUNIOzs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7O0dBc0JHO0FBQ0gsaUZBQWlGO0FBQ2pGLE1BQU0sNkJBQTZCLEdB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QUFBO1FBQ3pKLENBQUM7UUFBQyxPQUFPLFdBQVcsRUFBRSxDQUFDO1lBQ3JCLE9BQU8sQ0FBQyxLQUFLLENBQUMseUNBQXlDLEVBQUUsV0FBVyxDQUFDLENBQUE7UUFDdkUsQ0FBQztJQUNILENBQUM7SUFFRDs7Ozs7Ozs7Ozs7Ozs7T0FjRztJQUNILDRCQUE0QixDQUFDLEVBQUMsS0FBSyxFQUFFLE1BQU0sRUFBRSxPQUFPLEVBQUUsS0FBSyxFQUFFLFNBQVMsRUFBRSxhQUFhLEVBQUUsUUFBUSxFQUFFLGFBQWEsRUFBQztRQUM3Rzs7bUNBRTJCO1FBQzNCLElBQUksTUFBTSxDQUFBO1FBRVYsTUFBTSxHQUFHLElBQUksQ0FBQyxnQkFBZ0IsQ0FBQyxFQUFDLEtBQUssRUFBRSxNQUFNLEVBQUUsT0FBTyxFQUFFLEtBQUssRUFBRSxTQUFTLEVBQUUsYUFBYSxFQUFFLFFBQVEsRUFBRSxhQUFhLEVBQUMsQ0FBQyxDQUFDLE9BQU8sQ0FBQyxHQUFHLEVBQUU7WUFDOUgsSUFBSSxDQUFDLGVBQWUsQ0FBQyxNQUFNLENBQUMsTUFBTSxDQUFDLENBQUE7UUFDckMsQ0FBQyxDQUFDLENBQUE7UUFFRixJQUFJLENBQUMsZUFBZSxDQUFDLEdBQUcsQ0FBQyxNQUFNLENBQUMsQ0FBQTtJQUNsQyxDQUFDO0NBQ0YiLCJzb3VyY2VzQ29udGVudCI6WyIvLyBAdHMtY2hlY2tcblxuaW1wb3J0IG5ldCBmcm9tIFwibmV0XCJcbmltcG9ydCB7IGZvcmssIHNwYXduIH0gZnJvbSBcIm5vZGU6Y2hpbGRfcHJvY2Vzc1wiXG5pbXBvcnQgSnNvblNvY2tldCBmcm9tIFwiLi9qc29uLXNvY2tldC5qc1wiXG5pbXBvcnQgQmFja2dyb3VuZEpvYlJlZ2lzdHJ5IGZyb20gXCIuL2pvYi1yZWdpc3RyeS5qc1wiXG5pbXBvcnQgY29uZmlndXJhdGlvblJlc29sdmVyIGZyb20gXCIuLi9jb25maWd1cmF0aW9uLXJlc29sdmVyLmpzXCJcbmltcG9ydCBCYWNrZ3JvdW5kSm9ic1N0YXR1c1JlcG9ydGVyIGZyb20gXCIuL3N0YXR1cy1yZXBvcnRlci5qc1wiXG5pbXBvcnQgeyByYW5kb21VVUlEIH0gZnJvbSBcImNyeXB0b1wiXG5pbXBvcnQgeyBmaWxlVVJMVG9QYXRoIH0gZnJvbSBcIm5vZGU6dXJsXCJcbmltcG9ydCBzaHV0ZG93bkxpZmVjeWNsZSwgeyBydW5TaHV0ZG93blN0ZXBzIH0gZnJvbSBcIi4uL3V0aWxzL3NodXRkb3duLWxpZmVjeWNsZS5qc1wiXG5pbXBvcnQgQmFja2dyb3VuZEpvYlJlc2NoZWR1bGVTaWduYWwgZnJvbSBcIi4vcmVzY2hlZHVsZS1zaWduYWwuanNcIlxuaW1wb3J0IHBlcmZvcm1CYWNrZ3JvdW5kSm9iIGZyb20gXCIuL3BlcmZvcm0tam9iLmpzXCJcbmltcG9ydCB7IHJ1bldpdGhCYWNrZ3JvdW5kSm9iUGF5bG9hZCB9IGZyb20gXCIuL2V4ZWN1dGlvbi1jb250ZXh0LmpzXCJcbmltcG9ydCB7IGNyZWF0ZUdlbmVyYXRpb25Xb3JrZXJJZCB9IGZyb20gXCIuL2dlbmVyYXRpb24taWRlbnRpdHkuanNcIlxuaW1wb3J0IEJhY2tncm91bmRKb2JzR2VuZXJhdGlvbkhhbmRzaGFrZVRpbWVvdXRFcnJvciwgeyBERUZBVUxUX0dFTkVSQVRJT05fSEFORFNIQUtFX1RJTUVPVVRfTVMsIHZhbGlkYXRlR2VuZXJhdGlvbkhhbmRzaGFrZVRpbWVvdXRNcyB9IGZyb20gXCIuL2dlbmVyYXRpb24taGFuZHNoYWtlLXRpbWVvdXQtZXJyb3IuanNcIlxuaW1wb3J0IHsgUE9PTEVEX1JVTk5FUl9JTkZMSUdIVF9KT0JfSURfTElNSVQsIGJvdW5kZWRQb29sZWRSdW5uZXJJbmZsaWdodEpvYklkcywgaXNQb29sZWRDaGlsZFNodXRkb3duUmVhc29uLCBpc1Bvb2xlZENoaWxkU2h1dGRvd25TaWduYWwgfSBmcm9tIFwiLi9wb29sZWQtcnVubmVyLXNodXRkb3duLmpzXCJcblxuLyoqXG4gKiBQZXItZm9ya2VkLWNoaWxkIHRpbWVvdXQgYm9va2tlZXBpbmcuXG4gKiBAdHlwZWRlZiB7b2JqZWN0fSBGb3JrZWRKb2JUaW1lb3V0U3RhdGVcbiAqIEBwcm9wZXJ0eSB7Ym9vbGVhbn0gdGltZWRPdXQgLSBXaGV0aGVyIHRoZSB0aW1lb3V0IGZpcmVkIGFuZCB0aGUgY2hpbGQgd2FzIHRlcm1pbmF0ZWQuXG4gKiBAcHJvcGVydHkge251bWJlciB8IG51bGx9IHRpbWVvdXRNcyAtIFRoZSBhcm1lZCB0aW1lb3V0IGluIG1zLCBvciBudWxsIHdoZW4gZGlzYWJsZWQuXG4gKiBAcHJvcGVydHkge1JldHVyblR5cGU8dHlwZW9mIHNldFRpbWVvdXQ+IHwgbnVsbH0gdGltZXIgLSBUaGUgcGVuZGluZyB0aW1lb3V0IHRpbWVyLCBjbGVhcmVkIG9uIGV4aXQuXG4gKiBAcHJvcGVydHkge1JldHVyblR5cGU8dHlwZW9mIHNldFRpbWVvdXQ+IHwgbnVsbH0gc2lna2lsbFRpbWVyIC0gVGhlIHBlbmRpbmcgU0lHS0lMTCBncmFjZSB0aW1lciwgY2xlYXJlZCBvbiBleGl0LlxuICovXG4vKipcbiAqIEB0eXBlZGVmIHtvYmplY3R9IFBvb2xlZEpvYkVudHJ5XG4gKiBAcHJvcGVydHkge2ltcG9ydChcIi4vdHlwZXMuanNcIikuQmFja2dyb3VuZEpvYlBheWxvYWQgJiB7aWQ6IHN0cmluZ319IHBheWxvYWQgLSBEdXJhYmxlIGpvYiBwYXlsb2FkLlxuICogQHByb3BlcnR5IHsodmFsdWU6IHZvaWQpID0+IHZvaWR9IFtyZXNvbHZlXSAtIENvbXBsZXRpb24gcmVzb2x2ZXIuXG4gKiBAcHJvcGVydHkge1Byb21pc2U8dm9pZD59IFtwb29sZWRKb2JdIC0gVHJhY2tlZCBwb29sZWQtam9iIHByb21pc2UuXG4gKiBAcHJvcGVydHkge1JldHVyblR5cGU8dHlwZW9mIHNldFRpbWVvdXQ+IHwgbnVsbH0gW3RpbWVvdXRUaW1lcl0gLSBQZXItam9iIHRpbWVvdXQgdGltZXIuXG4gKi9cbi8qKlxuICogQHR5cGVkZWYge29iamVjdH0gUG9vbGVkQ2hpbGRTdGF0ZVxuICogQHByb3BlcnR5IHtudW1iZXJ9IGNyZWF0ZWRBdE1zIC0gQ2hpbGQgY3JlYXRpb24gdGltZXN0YW1wLlxuICogQHByb3BlcnR5IHtzdHJpbmd9IFtjaGlsZEluc3RhbmNlSWRdIC0gU3RhYmxlIGlkZW50aXR5IHJlcG9ydGVkIGJ5IHRoZSBjaGlsZC5cbiAqIEBwcm9wZXJ0eSB7bnVtYmVyfSBqb2JzUnVuIC0gQWNrbm93bGVkZ2VkIGpvYnMgY29tcGxldGVkIGJ5IHRoaXMgY2hpbGQuXG4gKiBAcHJvcGVydHkge01hcDxzdHJpbmcsIFBvb2xlZEpvYkVudHJ5Pn0gaW5mbGlnaHQgLSBKb2JzIGN1cnJlbnRseSBvd25lZCBieSB0aGlzIGNoaWxkLlxuICogQHByb3BlcnR5IHtudW1iZXJ9IGxhc3REaXNwYXRjaFNlcSAtIFJvdW5kLXJvYmluIGRpc3BhdGNoIHNlcXVlbmNlLlxuICogQHByb3BlcnR5IHtib29sZWFufSByZXRpcmluZyAtIFdoZXRoZXIgdGhpcyBjaGlsZCBpcyBkcmFpbmluZyBiZWZvcmUgcmV0aXJlbWVudC5cbiAqIEBwcm9wZXJ0eSB7Ym9vbGVhbn0gW3N0YXJ0ZWRdIC0gV2hldGhlciB0aGUgY2hpbGQgY29tcGxldGVkIGl0cyBzdGFydHVwIGhhbmRzaGFrZS5cbiAqIEBwcm9wZXJ0eSB7Ym9vbGVhbn0gW3NldHRsaW5nXSAtIFdoZXRoZXIgZmFpbHVyZSBoYW5kbGluZyBhbHJlYWR5IG93bnMgdGhpcyBjaGlsZC5cbiAqIEBwcm9wZXJ0eSB7aW1wb3J0KFwiLi90eXBlcy5qc1wiKS5Qb29sZWRDaGlsZE1lbW9yeU9ic2VydmF0aW9ufSBbbGFzdE1lbW9yeU9ic2VydmF0aW9uXSAtIExhdGVzdCBtZW1vcnkgb2JzZXJ2YXRpb24gcmVjZWl2ZWQgZnJvbSB0aGlzIGNoaWxkLlxuICogQHByb3BlcnR5IHtudW1iZXJ9IFtpcGNEaXNjb25uZWN0ZWRBdE1zXSAtIFBhcmVudCBvYnNlcnZhdGlvbiBvZiBJUEMgZGlzY29ubmVjdC5cbiAqIEBwcm9wZXJ0eSB7aW1wb3J0KFwiLi90eXBlcy5qc1wiKS5Qb29sZWRDaGlsZFNodXRkb3duT2JzZXJ2YXRpb259IFtzaHV0ZG93bk9ic2VydmF0aW9uXSAtIENoaWxkIG9ic2VydmF0aW9uIHNlbnQgYmVmb3JlIHRlYXJkb3duLlxuICogQHByb3BlcnR5IHtpbXBvcnQoXCIuL3R5cGVzLmpzXCIpLlBvb2xlZENoaWxkU2h1dGRvd25SZWFzb259IFtzaHV0ZG93blJlYXNvbl0gLSBFeGFjdCBwYXJlbnQtcmVxdWVzdGVkIHNodXRkb3duIHJlYXNvbi5cbiAqIEBwcm9wZXJ0eSB7bnVtYmVyfSBbc2h1dGRvd25SZXF1ZXN0ZWRBdE1zXSAtIEV4YWN0IHBhcmVudCBzaHV0ZG93bi1yZXF1ZXN0IHRpbWVzdGFtcC5cbiAqIEBwcm9wZXJ0eSB7aW1wb3J0KFwibm9kZTpjaGlsZF9wcm9jZXNzXCIpLkNoaWxkUHJvY2Vzc1tcInNpZ25hbENvZGVcIl19IFtzaHV0ZG93blNpZ25hbF0gLSBTaWduYWwgc2VsZWN0ZWQgYnkgdGhlIHBhcmVudCByZXF1ZXN0LlxuICogQHByb3BlcnR5IHtSZXR1cm5UeXBlPHR5cGVvZiBzZXRUaW1lb3V0Pn0gW3NodXRkb3duU2lnbmFsVGltZXJdIC0gRHJhaW5lZC1yZXRpcmVtZW50IGZhbGxiYWNrIHNpZ25hbCB0aW1lci5cbiAqIEBwcm9wZXJ0eSB7UmV0dXJuVHlwZTx0eXBlb2Ygc2V0VGltZW91dD4gfCBudWxsfSBbdGltZW91dFNpZ2tpbGxUaW1lcl0gLSBQZW5kaW5nIHRpbWVvdXQgU0lHS0lMTCB0aW1lci5cbiAqIEBwcm9wZXJ0eSB7c3RyaW5nfSBbdGltZW91dEpvYklkXSAtIEpvYiB3aG9zZSB0aW1lb3V0IGluaXRpYXRlZCB0ZXJtaW5hdGlvbi5cbiAqIEBwcm9wZXJ0eSB7bnVtYmVyfSBsYXN0QWN0aXZpdHlBdE1zIC0gTGFzdCB0aW1lIHRoZSB3b3JrZXIgc2F3IGFueSBJUEMgbWVzc2FnZSBmcm9tIHRoaXMgY2hpbGQsIG9yIGRpc3BhdGNoZWQgdG8gaXQuXG4gKiBAcHJvcGVydHkge1JldHVyblR5cGU8dHlwZW9mIHNldFRpbWVvdXQ+fSBbc2lsZW5jZVRpbWVyXSAtIEFybWVkIHBlci1jaGlsZCBJUEMtc2lsZW5jZSB3YXRjaGRvZyB0aW1lci5cbiAqIEBwcm9wZXJ0eSB7UmV0dXJuVHlwZTx0eXBlb2Ygc2V0VGltZW91dD59IFtzaWxlbmNlU2lna2lsbFRpbWVyXSAtIFBlbmRpbmcgU0lHS0lMTCBmb3IgYSBjaGlsZCB0aGUgc2lsZW5jZSB3YXRjaGRvZyBkZWNsYXJlZCB3ZWRnZWQuXG4gKi9cbi8qKiBHcmFjZSBwZXJpb2QgYWZ0ZXIgU0lHVEVSTSBiZWZvcmUgYSBsaW5nZXJpbmcgcHJvY2VzcyBydW5uZXIgaXMgU0lHS0lMTGVkLiAqL1xuY29uc3QgRk9SS0VEX0NISUxEX1NJR0tJTExfR1JBQ0VfTVMgPSA1MDAwXG4vKiogVGltZSBhIGRyYWluZWQgcmV0aXJlbWVudCBnaXZlcyB0aGUgY2hpbGQgSVBDIHJlcXVlc3QgdG8gYmVnaW4gdGVhcmRvd24gYmVmb3JlIFNJR1RFUk0gZmFsbGJhY2suICovXG5jb25zdCBQT09MRURfUlVOTkVSX1NIVVRET1dOX1JFUVVFU1RfR1JBQ0VfTVMgPSAyNTBcbi8qKlxuICogRGVmYXVsdCBib3VuZCBvbiBob3cgbG9uZyBhIHBvb2xlZCBjaGlsZCB3aXRoIGluLWZsaWdodCBqb2JzIG1heSBzdGF5IHNpbGVudCBvblxuICogaXRzIElQQyBjaGFubmVsIGJlZm9yZSB0aGUgd29ya2VyIGRlY2xhcmVzIGl0IHdlZGdlZC4gQSBoZWFsdGh5IGNoaWxkIHNhbXBsZXMgaXRzXG4gKiBtZW1vcnkgZXZlcnkgMTAgc2Vjb25kcyB3aGlsZSBqb2JzIHJ1biwgc28gc2lsZW5jZSBwYXN0IHRoaXMgYm91bmQgbWVhbnMgaXRzIGV2ZW50XG4gKiBsb29wIGNhbm5vdCBydW4gaXRzIG93biB0aW1lcnMg4oCUIHRoZSBzaWduYXR1cmUgb2YgdGhlIHNpbGVudCB0cmFuc3BvcnQgd2VkZ2UuIFRoZVxuICogYm91bmQgaXMgZGVsaWJlcmF0ZWx5IGZhciBhYm92ZSBhIGhlYWx0aHkgbG9uZyBqb2IncyBxdWlldCB3aW5kb3c6IGl0IG9ubHkgZmlyZXMgb25cbiAqIGEgY2hpbGQgdGhhdCBjYW5ub3QgcHJvdmUgaXQgaXMgYWxpdmUsIG5ldmVyIG9uIGEgZ2VudWluZWx5IGJ1c3kgcnVubmVyLlxuICovXG5jb25zdCBQT09MRURfQ0hJTERfU0lMRU5DRV9USU1FT1VUX01TID0gMTIwMDAwXG4vKipcbiAqIExhcmdlc3QgZGVsYXkgTm9kZSdzIGBzZXRUaW1lb3V0YCBhY2NlcHRzIHdpdGhvdXQgb3ZlcmZsb3dpbmcgdG8gYSAxbXMgZGVsYXlcbiAqIChhIDMyLWJpdCBzaWduZWQgaW50IG9mIG1zLCB+MjQuOCBkYXlzKS4gQSBgam9iVGltZW91dE1zYCBhYm92ZSB0aGlzIOKAlCBvciBhXG4gKiBub24tZmluaXRlIG9uZSBsaWtlIGBJbmZpbml0eWAg4oCUIGlzIGNsYW1wZWQvZGlzYWJsZWQgcmF0aGVyIHRoYW4gY29lcmNlZCB0b1xuICogfjFtcywgd2hpY2ggd291bGQgb3RoZXJ3aXNlIHRlcm1pbmF0ZSBldmVyeSBmb3JrZWQgam9iIGFsbW9zdCBpbW1lZGlhdGVseS5cbiAqL1xuY29uc3QgTUFYX0ZPUktFRF9KT0JfVElNRU9VVF9NUyA9IDJfMTQ3XzQ4M182NDdcbmNvbnN0IEZPUktFRF9SVU5ORVJfRU5UUllfUEFUSCA9IGZpbGVVUkxUb1BhdGgobmV3IFVSTChcIi4vZm9ya2VkLXJ1bm5lci1jaGlsZC5qc1wiLCBpbXBvcnQubWV0YS51cmwpKVxuY29uc3QgUE9PTEVEX1JVTk5FUl9FTlRSWV9QQVRIID0gZmlsZVVSTFRvUGF0aChuZXcgVVJMKFwiLi9wb29sZWQtcnVubmVyLWNoaWxkLmpzXCIsIGltcG9ydC5tZXRhLnVybCkpXG4vKiogSG93IG9mdGVuIHRoZSB3b3JrZXIgc2VuZHMgYSBsaXZlbmVzcyBoZWFydGJlYXQgdG8gdGhlIG1haW4uICovXG5jb25zdCBIRUFSVEJFQVRfSU5URVJWQUxfTVMgPSAxNTAwMFxuLyoqXG4gKiBNYXggdGltZSB0aGUgd29ya2VyIHNwZW5kcyByZXRyeWluZyBvbmUgcG9vbGVkIGNoaWxkJ3MgYWNjZXB0YW5jZSByZXBvcnRcbiAqIGJlZm9yZSBkcm9wcGluZyBpdC4gQWNjZXB0YW5jZSBldmlkZW5jZSBpcyBkaWFnbm9zdGljIOKAlCBhIHBlcnNpc3RlbnRcbiAqIG1haW4vREIgb3V0YWdlIG11c3Qgbm90IGhvbGQgcnVubmVyIGNhcGFjaXR5IGhvc3RhZ2UuXG4gKi9cbmNvbnN0IENISUxEX0FDQ0VQVEFOQ0VfUkVQT1JUX01BWF9EVVJBVElPTl9NUyA9IDEwMDAwXG4vKiogVENQIGtlZXBhbGl2ZSBzbyBhIGhhbGYtb3BlbiBjb25uZWN0aW9uIHRvIHRoZSBtYWluIHN1cmZhY2VzIGFzIGEgY2xvc2UuICovXG5jb25zdCBTT0NLRVRfS0VFUEFMSVZFX01TID0gMTAwMDBcbi8qKlxuICogRXhlY3V0aW9uIG1vZGVzLlxuICogQHR5cGUge2ltcG9ydChcIi4vdHlwZXMuanNcIikuQmFja2dyb3VuZEpvYkV4ZWN1dGlvbk1vZGVbXX0gKi9cbmNvbnN0IEVYRUNVVElPTl9NT0RFUyA9IFtcImlubGluZVwiLCBcImZvcmtlZFwiLCBcInBvb2xlZFwiLCBcInNwYXduZWRcIl1cblxuLyoqXG4gKiBOb3JtYWxpemVzIGEgY2FuZGlkYXRlIHBvb2xlZC1ydW5uZXIgY291bnQgb3Igam9iIGxpbWl0LlxuICogQHBhcmFtIHtudW1iZXIgfCB1bmRlZmluZWR9IHZhbHVlIC0gQ2FuZGlkYXRlIHBvc2l0aXZlIGludGVnZXIuXG4gKiBAcmV0dXJucyB7bnVtYmVyIHwgdW5kZWZpbmVkfSAtIE5vcm1hbGl6ZWQgdmFsdWUuXG4gKi9cbmZ1bmN0aW9uIHBvc2l0aXZlSW50ZWdlcih2YWx1ZSkge1xuICByZXR1cm4gdHlwZW9mIHZhbHVlID09PSBcIm51bWJlclwiICYmIE51bWJlci5pc0ludGVnZXIodmFsdWUpICYmIHZhbHVlID4gMCA/IHZhbHVlIDogdW5kZWZpbmVkXG59XG5cbi8qKlxuICogQ2hlY2tzIHdoZXRoZXIgYW4gSVBDIHZhbHVlIGlzIGEgcG9vbGVkIGNoaWxkJ3MgYWNjZXB0YW5jZSBvYnNlcnZhdGlvbiBmb3JcbiAqIG9uZSBqb2IuIFRoZSBjaGlsZCBjYXJyaWVzIGl0cyBleGFjdCBoYW5kb2ZmIGxlYXNlIHNvIHRoZSB3b3JrZXIgY2FuIGZvcndhcmRcbiAqIHRoZSByZXBvcnQgd2l0aG91dCBkZXBlbmRpbmcgb24gaXRzIGluLWZsaWdodCBlbnRyeSBzdGlsbCBleGlzdGluZy5cbiAqIEBwYXJhbSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59IG1lc3NhZ2UgLSBJUEMgbWVzc2FnZS5cbiAqIEByZXR1cm5zIHttZXNzYWdlIGlzIHt0eXBlOiBcImpvYi1yZWNlaXZlZFwiIHwgXCJqb2Itc3RhcnRlZFwiLCBqb2JJZDogc3RyaW5nLCBoYW5kb2ZmSWQ/OiBzdHJpbmcsIHdvcmtlcklkPzogc3RyaW5nLCBoYW5kZWRPZmZBdE1zPzogbnVtYmVyLCByZWNlaXZlZEF0TXM/OiBudW1iZXIsIHN0YXJ0ZWRBdE1zPzogbnVtYmVyLCBjaGlsZEluc3RhbmNlSWQ/OiBzdHJpbmcsIGNoaWxkUGlkPzogbnVtYmVyLCBydW5uZXJIb3N0bmFtZT86IHN0cmluZ319IC0gV2hldGhlciB0aGlzIGlzIGEgdmFsaWQgYWNjZXB0YW5jZSBtZXNzYWdlLlxuICovXG5mdW5jdGlvbiBpc0NoaWxkQWNjZXB0YW5jZU1lc3NhZ2UobWVzc2FnZSkge1xuICBpZiAoIW1lc3NhZ2UgfHwgdHlwZW9mIG1lc3NhZ2UgIT09IFwib2JqZWN0XCIpIHJldHVybiBmYWxzZVxuICBjb25zdCByZWNvcmQgPSAvKiogQHR5cGUge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gKi8gKG1lc3NhZ2UpXG5cbiAgcmV0dXJuIChyZWNvcmQudHlwZSA9PT0gXCJqb2ItcmVjZWl2ZWRcIiB8fCByZWNvcmQudHlwZSA9PT0gXCJqb2Itc3RhcnRlZFwiKVxuICAgICYmIHR5cGVvZiByZWNvcmQuam9iSWQgPT09IFwic3RyaW5nXCJcbiAgICAmJiAocmVjb3JkLmhhbmRvZmZJZCA9PT0gdW5kZWZpbmVkIHx8IHR5cGVvZiByZWNvcmQuaGFuZG9mZklkID09PSBcInN0cmluZ1wiKVxuICAgICYmIChyZWNvcmQud29ya2VySWQgPT09IHVuZGVmaW5lZCB8fCB0eXBlb2YgcmVjb3JkLndvcmtlcklkID09PSBcInN0cmluZ1wiKVxuICAgICYmIChyZWNvcmQuaGFuZGVkT2ZmQXRNcyA9PT0gdW5kZWZpbmVkIHx8IHR5cGVvZiByZWNvcmQuaGFuZGVkT2ZmQXRNcyA9PT0gXCJudW1iZXJcIilcbiAgICAmJiAocmVjb3JkLnJlY2VpdmVkQXRNcyA9PT0gdW5kZWZpbmVkIHx8IHR5cGVvZiByZWNvcmQucmVjZWl2ZWRBdE1zID09PSBcIm51bWJlclwiKVxuICAgICYmIChyZWNvcmQuc3RhcnRlZEF0TXMgPT09IHVuZGVmaW5lZCB8fCB0eXBlb2YgcmVjb3JkLnN0YXJ0ZWRBdE1zID09PSBcIm51bWJlclwiKVxuICAgICYmIChyZWNvcmQuY2hpbGRJbnN0YW5jZUlkID09PSB1bmRlZmluZWQgfHwgdHlwZW9mIHJlY29yZC5jaGlsZEluc3RhbmNlSWQgPT09IFwic3RyaW5nXCIpXG4gICAgJiYgKHJlY29yZC5jaGlsZFBpZCA9PT0gdW5kZWZpbmVkIHx8IE51bWJlci5pc0ludGVnZXIocmVjb3JkLmNoaWxkUGlkKSlcbiAgICAmJiAocmVjb3JkLnJ1bm5lckhvc3RuYW1lID09PSB1bmRlZmluZWQgfHwgdHlwZW9mIHJlY29yZC5ydW5uZXJIb3N0bmFtZSA9PT0gXCJzdHJpbmdcIilcbn1cblxuLyoqXG4gKiBDaGVja3Mgd2hldGhlciBhbiBJUEMgdmFsdWUgaXMgdGhlIGNoaWxkJ3MgYm91bmRlZCBwcmUtdGVhcmRvd24gb2JzZXJ2YXRpb24uXG4gKiBAcGFyYW0ge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSBtZXNzYWdlIC0gSVBDIG1lc3NhZ2UuXG4gKiBAcmV0dXJucyB7bWVzc2FnZSBpcyBpbXBvcnQoXCIuL3R5cGVzLmpzXCIpLlBvb2xlZENoaWxkU2h1dGRvd25PYnNlcnZhdGlvbiAmIHt0eXBlOiBcInNodXRkb3duLW9ic2VydmF0aW9uXCJ9fSAtIFdoZXRoZXIgdGhpcyBpcyBhIHZhbGlkIHNodXRkb3duIG9ic2VydmF0aW9uLlxuICovXG5mdW5jdGlvbiBpc0NoaWxkU2h1dGRvd25PYnNlcnZhdGlvbk1lc3NhZ2UobWVzc2FnZSkge1xuICBpZiAoIW1lc3NhZ2UgfHwgdHlwZW9mIG1lc3NhZ2UgIT09IFwib2JqZWN0XCIpIHJldHVybiBmYWxzZVxuICBjb25zdCByZWNvcmQgPSAvKiogQHR5cGUge3tjaGlsZEluc3RhbmNlSWQ/OiBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPiwgaW5mbGlnaHRKb2JJZHM/OiBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPiwgaW5mbGlnaHRKb2JJZHNUcnVuY2F0ZWRDb3VudD86IFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+LCByZWFzb24/OiBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPiwgc2h1dGRvd25PYnNlcnZlZEF0TXM/OiBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPiwgc2h1dGRvd25SZXF1ZXN0ZWRBdE1zPzogUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4sIHNpZ25hbD86IFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+LCB0eXBlPzogUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59fSAqLyAobWVzc2FnZSlcblxuICByZXR1cm4gcmVjb3JkLnR5cGUgPT09IFwic2h1dGRvd24tb2JzZXJ2YXRpb25cIlxuICAgICYmIHR5cGVvZiByZWNvcmQuY2hpbGRJbnN0YW5jZUlkID09PSBcInN0cmluZ1wiXG4gICAgJiYgQXJyYXkuaXNBcnJheShyZWNvcmQuaW5mbGlnaHRKb2JJZHMpXG4gICAgJiYgcmVjb3JkLmluZmxpZ2h0Sm9iSWRzLmxlbmd0aCA8PSBQT09MRURfUlVOTkVSX0lORkxJR0hUX0pPQl9JRF9MSU1JVFxuICAgICYmIHJlY29yZC5pbmZsaWdodEpvYklkcy5ldmVyeSgoam9iSWQpID0+IHR5cGVvZiBqb2JJZCA9PT0gXCJzdHJpbmdcIilcbiAgICAmJiBOdW1iZXIuaXNJbnRlZ2VyKHJlY29yZC5pbmZsaWdodEpvYklkc1RydW5jYXRlZENvdW50KVxuICAgICYmIHJlY29yZC5pbmZsaWdodEpvYklkc1RydW5jYXRlZENvdW50ID49IDBcbiAgICAmJiBpc1Bvb2xlZENoaWxkU2h1dGRvd25SZWFzb24ocmVjb3JkLnJlYXNvbilcbiAgICAmJiB0eXBlb2YgcmVjb3JkLnNodXRkb3duT2JzZXJ2ZWRBdE1zID09PSBcIm51bWJlclwiXG4gICAgJiYgTnVtYmVyLmlzRmluaXRlKHJlY29yZC5zaHV0ZG93bk9ic2VydmVkQXRNcylcbiAgICAmJiAocmVjb3JkLnNodXRkb3duUmVxdWVzdGVkQXRNcyA9PT0gbnVsbCB8fCAodHlwZW9mIHJlY29yZC5zaHV0ZG93blJlcXVlc3RlZEF0TXMgPT09IFwibnVtYmVyXCIgJiYgTnVtYmVyLmlzRmluaXRlKHJlY29yZC5zaHV0ZG93blJlcXVlc3RlZEF0TXMpKSlcbiAgICAmJiBpc1Bvb2xlZENoaWxkU2h1dGRvd25TaWduYWwocmVjb3JkLnNpZ25hbClcbn1cblxuLyoqXG4gKiBDaGVja3Mgd2hldGhlciBhbiBJUEMgdmFsdWUgaXMgYSBwb29sZWQgY2hpbGQncyBib3VuZGVkIG1lbW9yeSBvYnNlcnZhdGlvbi5cbiAqIFRoZSBwb29sZWQgY2hpbGQncyBzdGRpbyBpcyBpZ25vcmVkIGJ5IHRoZSB3b3JrZXIgZm9yaywgc28gdGhpcyBvYnNlcnZhdGlvblxuICogKHBlcmlvZGljIHdoaWxlIGpvYnMgcnVuLCBwbHVzIG9uIGRlbWFuZCkgaXMgaG93IGEgbWVtb3J5IHByb2JsZW0gaW4gYVxuICogcnVubmluZyBjaGlsZCBuYW1lcyBpdHNlbGYuIFRoZSB3b3JrZXIgbG9ncyBpdCAoaXRzIHN0ZGVyciByZWFjaGVzIHRoZSBwcm9kXG4gKiBsb2cpIGFuZCBmb3J3YXJkcyBpdCB0byB0aGUgb3B0aW9uYWwgYG9uUG9vbGVkUnVubmVyTWVtb3J5T2JzZXJ2YXRpb25gIGhvb2suXG4gKiBAcGFyYW0ge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSBtZXNzYWdlIC0gSVBDIG1lc3NhZ2UuXG4gKiBAcmV0dXJucyB7bWVzc2FnZSBpcyBpbXBvcnQoXCIuL3R5cGVzLmpzXCIpLlBvb2xlZENoaWxkTWVtb3J5T2JzZXJ2YXRpb259IC0gV2hldGhlciB0aGlzIGlzIGEgdmFsaWQgbWVtb3J5IG9ic2VydmF0aW9uLlxuICovXG5mdW5jdGlvbiBpc1Bvb2xlZENoaWxkTWVtb3J5T2JzZXJ2YXRpb25NZXNzYWdlKG1lc3NhZ2UpIHtcbiAgaWYgKCFtZXNzYWdlIHx8IHR5cGVvZiBtZXNzYWdlICE9PSBcIm9iamVjdFwiKSByZXR1cm4gZmFsc2VcbiAgY29uc3QgcmVjb3JkID0gLyoqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59ICovIChtZXNzYWdlKVxuICBjb25zdCBoZWFwU3RhdGlzdGljcyA9IC8qKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+IHwgdW5kZWZpbmVkfSAqLyAocmVjb3JkLmhlYXBTdGF0aXN0aWNzKVxuICBjb25zdCBtZW1vcnlVc2FnZSA9IC8qKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+IHwgdW5kZWZpbmVkfSAqLyAocmVjb3JkLm1lbW9yeVVzYWdlKVxuXG4gIHJldHVybiByZWNvcmQudHlwZSA9PT0gXCJwb29sZWQtY2hpbGQtbWVtb3J5XCJcbiAgICAmJiB0eXBlb2YgcmVjb3JkLmNoaWxkSW5zdGFuY2VJZCA9PT0gXCJzdHJpbmdcIlxuICAgICYmIE51bWJlci5pc0ludGVnZXIocmVjb3JkLmNoaWxkUGlkKVxuICAgICYmIHR5cGVvZiByZWNvcmQucnNzQnl0ZXMgPT09IFwibnVtYmVyXCJcbiAgICAmJiBOdW1iZXIuaXNGaW5pdGUocmVjb3JkLnJzc0J5dGVzKVxuICAgICYmIE51bWJlci5pc0ludGVnZXIocmVjb3JkLmpvYkNvdW50KVxuICAgICYmIHJlY29yZC5qb2JDb3VudCA+PSAwXG4gICAgJiYgQXJyYXkuaXNBcnJheShyZWNvcmQuYWN0aXZlSm9iSWRzKVxuICAgICYmIHJlY29yZC5hY3RpdmVKb2JJZHMuZXZlcnkoKGpvYklkKSA9PiB0eXBlb2Ygam9iSWQgPT09IFwic3RyaW5nXCIpXG4gICAgJiYgTnVtYmVyLmlzSW50ZWdlcihyZWNvcmQuYWN0aXZlSm9iSWRzVHJ1bmNhdGVkQ291bnQpXG4gICAgJiYgcmVjb3JkLmFjdGl2ZUpvYklkc1RydW5jYXRlZENvdW50ID49IDBcbiAgICAmJiB0eXBlb2YgcmVjb3JkLm9ic2VydmVkQXRNcyA9PT0gXCJudW1iZXJcIlxuICAgICYmIE51bWJlci5pc0Zpbml0ZShyZWNvcmQub2JzZXJ2ZWRBdE1zKVxuICAgICYmIGhlYXBTdGF0aXN0aWNzICE9PSB1bmRlZmluZWQgJiYgdHlwZW9mIGhlYXBTdGF0aXN0aWNzID09PSBcIm9iamVjdFwiXG4gICAgJiYgbWVtb3J5VXNhZ2UgIT09IHVuZGVmaW5lZCAmJiB0eXBlb2YgbWVtb3J5VXNhZ2UgPT09IFwib2JqZWN0XCJcbn1cblxuLyoqXG4gKiBOb3JtYWxpemVzIGEgY2FuZGlkYXRlIHBvb2xlZC1ydW5uZXIgcmVzb3VyY2UgbGltaXQuXG4gKiBAcGFyYW0ge251bWJlciB8IHVuZGVmaW5lZH0gdmFsdWUgLSBDYW5kaWRhdGUgcG9zaXRpdmUgbnVtYmVyLlxuICogQHJldHVybnMge251bWJlciB8IHVuZGVmaW5lZH0gLSBOb3JtYWxpemVkIHZhbHVlLlxuICovXG5mdW5jdGlvbiBwb3NpdGl2ZU51bWJlcih2YWx1ZSkge1xuICByZXR1cm4gdHlwZW9mIHZhbHVlID09PSBcIm51bWJlclwiICYmIE51bWJlci5pc0Zpbml0ZSh2YWx1ZSkgJiYgdmFsdWUgPiAwID8gdmFsdWUgOiB1bmRlZmluZWRcbn1cblxuZXhwb3J0IGRlZmF1bHQgY2xhc3MgQmFja2dyb3VuZEpvYnNXb3JrZXIge1xuICAvKipcbiAgICogUnVucyBjb25zdHJ1Y3Rvci5cbiAgICogQHBhcmFtIHtvYmplY3R9IFthcmdzXSAtIE9wdGlvbnMuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vY29uZmlndXJhdGlvbi5qc1wiKS5kZWZhdWx0fSBbYXJncy5jb25maWd1cmF0aW9uXSAtIENvbmZpZ3VyYXRpb24uXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBbYXJncy5ob3N0XSAtIEhvc3RuYW1lLlxuICAgKiBAcGFyYW0ge251bWJlcn0gW2FyZ3MucG9ydF0gLSBQb3J0LlxuICAgKiBAcGFyYW0ge3N0cmluZ30gW2FyZ3MuZ2VuZXJhdGlvbklkXSAtIEV4cGxpY2l0IHJlbGVhc2UgZ2VuZXJhdGlvbiBpZGVudGl0eS5cbiAgICogQHBhcmFtIHtzdHJpbmd9IFthcmdzLndvcmtlckluc3RhbmNlSWRdIC0gRXhwbGljaXQgc3RhYmxlIHdvcmtlciBVVUlELlxuICAgKiBAcGFyYW0ge251bWJlcn0gW2FyZ3MubWF4Q29uY3VycmVudEZvcmtlZEpvYnNdIC0gT3ZlcnJpZGUgdGhlIHByb2Nlc3MgcnVubmVyIGNvbmN1cnJlbmN5IGNhcCBmcm9tIGBjb25maWd1cmF0aW9uLmdldEJhY2tncm91bmRKb2JzQ29uZmlnKClgLlxuICAgKiBAcGFyYW0ge251bWJlcn0gW2FyZ3MubWF4Q29uY3VycmVudElubGluZUpvYnNdIC0gT3ZlcnJpZGUgdGhlIGlubGluZS1qb2IgY29uY3VycmVuY3kgY2FwIGZyb20gYGNvbmZpZ3VyYXRpb24uZ2V0QmFja2dyb3VuZEpvYnNDb25maWcoKWAuXG4gICAqIEBwYXJhbSB7bnVtYmVyfSBbYXJncy5wb29sZWRSdW5uZXJDb3VudF0gLSBPdmVycmlkZSB0aGUgcG9vbGVkIHJ1bm5lciBjb3VudC5cbiAgICogQHBhcmFtIHtudW1iZXJ9IFthcmdzLnBvb2xlZFJ1bm5lckNvbmN1cnJlbmN5XSAtIE92ZXJyaWRlIHRoZSBwZXItcnVubmVyIGNvbmN1cnJlbmN5LlxuICAgKiBAcGFyYW0ge251bWJlcn0gW2FyZ3MucG9vbGVkUnVubmVyTWF4Sm9ic10gLSBPdmVycmlkZSB0aGUgcGVyLXJ1bm5lciByZWN5Y2xlIGpvYiBjb3VudC5cbiAgICogQHBhcmFtIHtudW1iZXJ9IFthcmdzLnBvb2xlZFJ1bm5lck1heFJzc0J5dGVzXSAtIE92ZXJyaWRlIHRoZSBwZXItcnVubmVyIHJlY3ljbGUgUlNTIGxpbWl0LlxuICAgKiBAcGFyYW0ge251bWJlcn0gW2FyZ3MucG9vbGVkUnVubmVyTWF4TGlmZXRpbWVNc10gLSBPdmVycmlkZSB0aGUgcGVyLXJ1bm5lciByZWN5Y2xlIGxpZmV0aW1lLlxuICAgKiBAcGFyYW0ge251bWJlcn0gW2FyZ3MucnVubmVyTWF4T2xkU3BhY2VTaXplTWJdIC0gT3ZlcnJpZGUgdGhlIFY4IGhlYXAgY2FwIChNaUIsIGAtLW1heC1vbGQtc3BhY2Utc2l6ZWApIGFwcGxpZWQgdG8gcnVubmVyIGNoaWxkcmVuLlxuICAgKiBAcGFyYW0ge251bWJlcn0gW2FyZ3MucnVubmVyTWFsbG9jQXJlbmFNYXhdIC0gT3ZlcnJpZGUgYE1BTExPQ19BUkVOQV9NQVhgIGZvciBydW5uZXIgY2hpbGRyZW4uXG4gICAqIEBwYXJhbSB7bnVtYmVyfSBbYXJncy5mb3JrZWRDaGlsZFNpZ2tpbGxHcmFjZU1zXSAtIE92ZXJyaWRlIHRoZSBncmFjZSBwZXJpb2QgYmV0d2VlbiBTSUdURVJNIGFuZCBTSUdLSUxMIHdoZW4gcmVhcGluZyBsaW5nZXJpbmcgcHJvY2VzcyBydW5uZXJzIG9uIHN0b3AuXG4gICAqIEBwYXJhbSB7bnVtYmVyfSBbYXJncy5oZWFydGJlYXRJbnRlcnZhbE1zXSAtIE92ZXJyaWRlIHRoZSBsaXZlbmVzcyBoZWFydGJlYXQgaW50ZXJ2YWwgKGRlZmF1bHQgMTUwMDBtcykuXG4gICAqIEBwYXJhbSB7bnVtYmVyfSBbYXJncy5nZW5lcmF0aW9uSGFuZHNoYWtlVGltZW91dE1zXSAtIE1heGltdW0gdGltZSB0byB3YWl0IGZvciBnZW5lcmF0aW9uIGFja25vd2xlZGdlbWVudCAoZGVmYXVsdDogNDAwMCkuXG4gICAqIEBwYXJhbSB7bnVtYmVyfSBbYXJncy5yZWNvbm5lY3REZWxheU1zXSAtIERlbGF5IGJlZm9yZSByZWNvbm5lY3RpbmcgYW4gZXN0YWJsaXNoZWQgd29ya2VyIGNvbm5lY3Rpb24gKGRlZmF1bHQ6IDEwMDApLlxuICAgKiBAcGFyYW0ge251bWJlcn0gW2FyZ3Muam9iVGltZW91dE1zXSAtIE92ZXJyaWRlIHRoZSB3YWxsLWNsb2NrIHRpbWVvdXQgZm9yIGZvcmtlZCBhbmQgcG9vbGVkIGpvYnMgZnJvbSBgY29uZmlndXJhdGlvbi5nZXRCYWNrZ3JvdW5kSm9ic0NvbmZpZygpYC4gYDBgIGRpc2FibGVzIGl0LlxuICAgKiBAcGFyYW0ge251bWJlcn0gW2FyZ3MucG9vbGVkUnVubmVyU2lsZW5jZVRpbWVvdXRNc10gLSBPdmVycmlkZSB0aGUgcGVyLWNoaWxkIElQQy1zaWxlbmNlIGJvdW5kIGZvciBwb29sZWQgY2hpbGRyZW4gd2l0aCBpbi1mbGlnaHQgam9icyBmcm9tIGBjb25maWd1cmF0aW9uLmdldEJhY2tncm91bmRKb2JzQ29uZmlnKClgIChkZWZhdWx0IDEyMDAwMG1zKS4gYDBgIGRpc2FibGVzIHRoZSB3YXRjaGRvZy5cbiAgICogQHBhcmFtIHtib29sZWFufSBbYXJncy5jbG9zZURhdGFiYXNlQ29ubmVjdGlvbnNPblN0b3BdIC0gV2hldGhlciBzdG9wIG93bnMgY2xvc2luZyB0aGUgY29uZmlndXJhdGlvbidzIGRhdGFiYXNlIHBvb2xzIChkZWZhdWx0IHRydWUpLlxuICAgKiBAcGFyYW0geygpID0+IHZvaWQgfCBQcm9taXNlPHZvaWQ+fSBbYXJncy5vblN0b3BwZWRdIC0gTGlmZWN5Y2xlIGhvb2sgaW52b2tlZCBhZnRlciB0aGUgd29ya2VyIGZpbmlzaGVzIHN0b3BwaW5nLlxuICAgKiBAcGFyYW0geygpID0+IHZvaWR9IFthcmdzLm9uR2VuZXJhdGlvbkFjY2VwdGVkXSAtIEV4cGxpY2l0IGdlbmVyYXRpb24tYWNjZXB0YW5jZSBvYnNlcnZhdGlvbiBob29rLlxuICAgKiBAcGFyYW0geygpID0+IHZvaWR9IFthcmdzLm9uUmV0aXJlTWVzc2FnZV0gLSBFeHBsaWNpdCByZXRpcmUtbWVzc2FnZSBvYnNlcnZhdGlvbiBob29rLlxuICAgKiBAcGFyYW0geyhvYnNlcnZhdGlvbjogaW1wb3J0KFwiLi90eXBlcy5qc1wiKS5Qb29sZWRDaGlsZE1lbW9yeU9ic2VydmF0aW9uKSA9PiB2b2lkIHwgUHJvbWlzZTx2b2lkPn0gW2FyZ3Mub25Qb29sZWRSdW5uZXJNZW1vcnlPYnNlcnZhdGlvbl0gLSBFeHBsaWNpdCBwb29sZWQtY2hpbGQgbWVtb3J5IG9ic2VydmF0aW9uIGhvb2suIEV2ZXJ5IHZhbGlkYXRlZCBvYnNlcnZhdGlvbiAocGVyaW9kaWMgd2hpbGUgYSBjaGlsZCBoYXMgaW4tZmxpZ2h0IGpvYnMsIHBsdXMgb24gZGVtYW5kKSBpcyBmb3J3YXJkZWQgaGVyZSwgaW4gYWRkaXRpb24gdG8gdGhlIHdvcmtlcidzIGNvbXBhY3Qgc3RkZXJyIGxvZyBsaW5lLCBzbyBhbiBhcHBsaWNhdGlvbiBjYW4gcm91dGUgbWVtb3J5IGRpYWdub3N0aWNzIChlLmcuIHRvIGEgYnVnIHJlcG9ydGVyKSB3aXRob3V0IHBhcnNpbmcgbG9ncy5cbiAgICogQHBhcmFtIHsocGF5bG9hZDogaW1wb3J0KFwiLi90eXBlcy5qc1wiKS5CYWNrZ3JvdW5kSm9iUGF5bG9hZCkgPT4gdm9pZH0gW2FyZ3Mub25Kb2JBY2NlcHRlZF0gLSBFeHBsaWNpdCBqb2ItYWNjZXB0YW5jZSBvYnNlcnZhdGlvbiBob29rLiBGaXJlcyB0aGUgbW9tZW50IHRoZSB3b3JrZXIgYWNjZXB0cyBhIGRpc3BhdGNoZWQgam9iIHBheWxvYWQsIGJlZm9yZSBleGVjdXRpb24gbW9kZSByb3V0aW5nLCBzbyBhbiBvYnNlcnZlciBjYW4gd2FpdCBmb3IgdGhlIHBpY2t1cCBldmVudCBpbnN0ZWFkIG9mIHBvbGxpbmcgaW4tZmxpZ2h0IHNldHMuXG4gICAqL1xuICBjb25zdHJ1Y3Rvcih7Y29uZmlndXJhdGlvbiwgaG9zdCwgcG9ydCwgZ2VuZXJhdGlvbklkLCB3b3JrZXJJbnN0YW5jZUlkLCBtYXhDb25jdXJyZW50Rm9ya2VkSm9icywgbWF4Q29uY3VycmVudElubGluZUpvYnMsIHBvb2xlZFJ1bm5lckNvdW50LCBwb29sZWRSdW5uZXJDb25jdXJyZW5jeSwgcG9vbGVkUnVubmVyTWF4Sm9icywgcG9vbGVkUnVubmVyTWF4UnNzQnl0ZXMsIHBvb2xlZFJ1bm5lck1heExpZmV0aW1lTXMsIHJ1bm5lck1heE9sZFNwYWNlU2l6ZU1iLCBydW5uZXJNYWxsb2NBcmVuYU1heCwgZm9ya2VkQ2hpbGRTaWdraWxsR3JhY2VNcywgaGVhcnRiZWF0SW50ZXJ2YWxNcywgZ2VuZXJhdGlvbkhhbmRzaGFrZVRpbWVvdXRNcyA9IERFRkFVTFRfR0VORVJBVElPTl9IQU5EU0hBS0VfVElNRU9VVF9NUywgcmVjb25uZWN0RGVsYXlNcyA9IDEwMDAsIGpvYlRpbWVvdXRNcywgcG9vbGVkUnVubmVyU2lsZW5jZVRpbWVvdXRNcywgY2xvc2VEYXRhYmFzZUNvbm5lY3Rpb25zT25TdG9wID0gdHJ1ZSwgb25TdG9wcGVkLCBvbkdlbmVyYXRpb25BY2NlcHRlZCwgb25SZXRpcmVNZXNzYWdlLCBvblBvb2xlZFJ1bm5lck1lbW9yeU9ic2VydmF0aW9uLCBvbkpvYkFjY2VwdGVkfSA9IHt9KSB7XG4gICAgLyoqXG4gICAgICogTmFycm93cyB0aGUgcnVudGltZSB2YWx1ZSB0byB0aGUgZG9jdW1lbnRlZCB0eXBlLlxuICAgICAqIEB0eXBlIHtQcm9taXNlPGltcG9ydChcIi4uL2NvbmZpZ3VyYXRpb24uanNcIikuZGVmYXVsdD59ICovXG4gICAgdGhpcy5jb25maWd1cmF0aW9uUHJvbWlzZSA9IGNvbmZpZ3VyYXRpb24gPyBQcm9taXNlLnJlc29sdmUoY29uZmlndXJhdGlvbikgOiBjb25maWd1cmF0aW9uUmVzb2x2ZXIoKVxuICAgIC8qKlxuICAgICAqIE5hcnJvd3MgdGhlIHJ1bnRpbWUgdmFsdWUgdG8gdGhlIGRvY3VtZW50ZWQgdHlwZS5cbiAgICAgKiBAdHlwZSB7aW1wb3J0KFwiLi4vY29uZmlndXJhdGlvbi5qc1wiKS5kZWZhdWx0IHwgdW5kZWZpbmVkfSAqL1xuICAgIHRoaXMuY29uZmlndXJhdGlvbiA9IHVuZGVmaW5lZFxuICAgIHRoaXMuaG9zdCA9IGhvc3RcbiAgICB0aGlzLnBvcnQgPSBwb3J0XG4gICAgdGhpcy5leHBsaWNpdEdlbmVyYXRpb25JZCA9IGdlbmVyYXRpb25JZFxuICAgIHRoaXMud29ya2VySW5zdGFuY2VJZCA9IHdvcmtlckluc3RhbmNlSWQgfHwgcmFuZG9tVVVJRCgpXG4gICAgLyoqIEB0eXBlIHtzdHJpbmcgfCB1bmRlZmluZWR9ICovXG4gICAgdGhpcy5nZW5lcmF0aW9uSWQgPSB1bmRlZmluZWRcbiAgICB0aGlzLmNsb3NlRGF0YWJhc2VDb25uZWN0aW9uc09uU3RvcCA9IGNsb3NlRGF0YWJhc2VDb25uZWN0aW9uc09uU3RvcFxuICAgIHRoaXMub25TdG9wcGVkID0gb25TdG9wcGVkXG4gICAgdGhpcy5vbkdlbmVyYXRpb25BY2NlcHRlZCA9IG9uR2VuZXJhdGlvbkFjY2VwdGVkXG4gICAgdGhpcy5vblJldGlyZU1lc3NhZ2UgPSBvblJldGlyZU1lc3NhZ2VcbiAgICB0aGlzLm9uUG9vbGVkUnVubmVyTWVtb3J5T2JzZXJ2YXRpb24gPSBvblBvb2xlZFJ1bm5lck1lbW9yeU9ic2VydmF0aW9uXG4gICAgdGhpcy5vbkpvYkFjY2VwdGVkID0gb25Kb2JBY2NlcHRlZFxuICAgIC8qKlxuICAgICAqIENvbnN0cnVjdG9yIG92ZXJyaWRlIGZvciB0aGUgaW5saW5lLWpvYiBjb25jdXJyZW5jeSBjYXAuIFdoZW4gdW5zZXRcbiAgICAgKiB0aGUgY2FwIGlzIHJlYWQgZnJvbSBgY29uZmlndXJhdGlvbi5nZXRCYWNrZ3JvdW5kSm9ic0NvbmZpZygpYCBpblxuICAgICAqIGBzdGFydCgpYCAoZGVmYXVsdDogNCkuXG4gICAgICogQHR5cGUge251bWJlciB8IHVuZGVmaW5lZH1cbiAgICAgKi9cbiAgICB0aGlzLm1heENvbmN1cnJlbnRJbmxpbmVKb2JzT3ZlcnJpZGUgPSB0eXBlb2YgbWF4Q29uY3VycmVudElubGluZUpvYnMgPT09IFwibnVtYmVyXCIgJiYgbWF4Q29uY3VycmVudElubGluZUpvYnMgPj0gMVxuICAgICAgPyBtYXhDb25jdXJyZW50SW5saW5lSm9ic1xuICAgICAgOiB1bmRlZmluZWRcbiAgICAvKipcbiAgICAgKiBOYXJyb3dzIHRoZSBydW50aW1lIHZhbHVlIHRvIHRoZSBkb2N1bWVudGVkIHR5cGUuXG4gICAgICogQHR5cGUge251bWJlciB8IHVuZGVmaW5lZH0gKi9cbiAgICB0aGlzLm1heENvbmN1cnJlbnRGb3JrZWRKb2JzT3ZlcnJpZGUgPSB0eXBlb2YgbWF4Q29uY3VycmVudEZvcmtlZEpvYnMgPT09IFwibnVtYmVyXCIgJiYgbWF4Q29uY3VycmVudEZvcmtlZEpvYnMgPj0gMVxuICAgICAgPyBtYXhDb25jdXJyZW50Rm9ya2VkSm9ic1xuICAgICAgOiB1bmRlZmluZWRcbiAgICAvKipcbiAgICAgKiBSZXNvbHZlZCBjYXAgZm9yIGlubGluZS1qb2IgY29uY3VycmVuY3kuIFNldCBpbiBgc3RhcnQoKWA7IGRlZmF1bHRzIHRvXG4gICAgICogNCBpZiBubyBjb25maWd1cmF0aW9uIHZhbHVlIGlzIGF2YWlsYWJsZS5cbiAgICAgKiBAdHlwZSB7bnVtYmVyfVxuICAgICAqL1xuICAgIHRoaXMubWF4Q29uY3VycmVudElubGluZUpvYnMgPSB0aGlzLm1heENvbmN1cnJlbnRJbmxpbmVKb2JzT3ZlcnJpZGUgfHwgNFxuICAgIC8qKlxuICAgICAqIE5hcnJvd3MgdGhlIHJ1bnRpbWUgdmFsdWUgdG8gdGhlIGRvY3VtZW50ZWQgdHlwZS5cbiAgICAgKiBAdHlwZSB7bnVtYmVyfSAqL1xuICAgIHRoaXMubWF4Q29uY3VycmVudEZvcmtlZEpvYnMgPSB0aGlzLm1heENvbmN1cnJlbnRGb3JrZWRKb2JzT3ZlcnJpZGUgfHwgNFxuICAgIHRoaXMucG9vbGVkUnVubmVyQ291bnRPdmVycmlkZSA9IHBvc2l0aXZlSW50ZWdlcihwb29sZWRSdW5uZXJDb3VudClcbiAgICB0aGlzLnBvb2xlZFJ1bm5lckNvbmN1cnJlbmN5T3ZlcnJpZGUgPSBwb3NpdGl2ZUludGVnZXIocG9vbGVkUnVubmVyQ29uY3VycmVuY3kpXG4gICAgdGhpcy5wb29sZWRSdW5uZXJNYXhKb2JzT3ZlcnJpZGUgPSBwb3NpdGl2ZUludGVnZXIocG9vbGVkUnVubmVyTWF4Sm9icylcbiAgICB0aGlzLnBvb2xlZFJ1bm5lck1heFJzc0J5dGVzT3ZlcnJpZGUgPSBwb3NpdGl2ZU51bWJlcihwb29sZWRSdW5uZXJNYXhSc3NCeXRlcylcbiAgICB0aGlzLnBvb2xlZFJ1bm5lck1heExpZmV0aW1lTXNPdmVycmlkZSA9IHBvc2l0aXZlTnVtYmVyKHBvb2xlZFJ1bm5lck1heExpZmV0aW1lTXMpXG4gICAgdGhpcy5ydW5uZXJNYXhPbGRTcGFjZVNpemVNYk92ZXJyaWRlID0gcG9zaXRpdmVJbnRlZ2VyKHJ1bm5lck1heE9sZFNwYWNlU2l6ZU1iKVxuICAgIHRoaXMucnVubmVyTWFsbG9jQXJlbmFNYXhPdmVycmlkZSA9IHBvc2l0aXZlSW50ZWdlcihydW5uZXJNYWxsb2NBcmVuYU1heClcbiAgICB0aGlzLnBvb2xlZFJ1bm5lckNvdW50ID0gdGhpcy5wb29sZWRSdW5uZXJDb3VudE92ZXJyaWRlIHx8IDRcbiAgICB0aGlzLnBvb2xlZFJ1bm5lckNvbmN1cnJlbmN5ID0gdGhpcy5wb29sZWRSdW5uZXJDb25jdXJyZW5jeU92ZXJyaWRlIHx8IDFcbiAgICB0aGlzLnBvb2xlZFJ1bm5lck1heEpvYnMgPSB0aGlzLnBvb2xlZFJ1bm5lck1heEpvYnNPdmVycmlkZSB8fCAxMDBcbiAgICB0aGlzLnBvb2xlZFJ1bm5lck1heFJzc0J5dGVzID0gdGhpcy5wb29sZWRSdW5uZXJNYXhSc3NCeXRlc092ZXJyaWRlIHx8IDUxMiAqIDEwMjQgKiAxMDI0XG4gICAgdGhpcy5wb29sZWRSdW5uZXJNYXhMaWZldGltZU1zID0gdGhpcy5wb29sZWRSdW5uZXJNYXhMaWZldGltZU1zT3ZlcnJpZGUgfHwgNjAgKiA2MCAqIDEwMDBcbiAgICB0aGlzLnBvb2xlZFJ1bm5lclNpbGVuY2VUaW1lb3V0TXNPdmVycmlkZSA9IHR5cGVvZiBwb29sZWRSdW5uZXJTaWxlbmNlVGltZW91dE1zID09PSBcIm51bWJlclwiID8gcG9vbGVkUnVubmVyU2lsZW5jZVRpbWVvdXRNcyA6IHVuZGVmaW5lZFxuICAgIHRoaXMucG9vbGVkUnVubmVyU2lsZW5jZVRpbWVvdXRNcyA9IHRoaXMucG9vbGVkUnVubmVyU2lsZW5jZVRpbWVvdXRNc092ZXJyaWRlID8/IFBPT0xFRF9DSElMRF9TSUxFTkNFX1RJTUVPVVRfTVNcbiAgICB0aGlzLnJ1bm5lck1heE9sZFNwYWNlU2l6ZU1iID0gdGhpcy5ydW5uZXJNYXhPbGRTcGFjZVNpemVNYk92ZXJyaWRlIHx8IDIwNDhcbiAgICB0aGlzLnJ1bm5lck1hbGxvY0FyZW5hTWF4ID0gdGhpcy5ydW5uZXJNYWxsb2NBcmVuYU1heE92ZXJyaWRlIHx8IDRcbiAgICAvKipcbiAgICAgKiBHcmFjZSBwZXJpb2QgYmV0d2VlbiBTSUdURVJNIGFuZCBTSUdLSUxMIHdoZW4gcmVhcGluZyBwcm9jZXNzIHJ1bm5lcnMgdGhhdFxuICAgICAqIG91dGxhc3QgYSBib3VuZGVkIHNodXRkb3duIGRyYWluLlxuICAgICAqIEB0eXBlIHtudW1iZXJ9XG4gICAgICovXG4gICAgdGhpcy5mb3JrZWRDaGlsZFNpZ2tpbGxHcmFjZU1zID0gdHlwZW9mIGZvcmtlZENoaWxkU2lna2lsbEdyYWNlTXMgPT09IFwibnVtYmVyXCIgJiYgZm9ya2VkQ2hpbGRTaWdraWxsR3JhY2VNcyA+PSAwXG4gICAgICA/IGZvcmtlZENoaWxkU2lna2lsbEdyYWNlTXNcbiAgICAgIDogRk9SS0VEX0NISUxEX1NJR0tJTExfR1JBQ0VfTVNcbiAgICAvKipcbiAgICAgKiBDb25zdHJ1Y3RvciBvdmVycmlkZSBmb3IgdGhlIGZvcmtlZCBhbmQgcG9vbGVkIHdhbGwtY2xvY2sgam9iIHRpbWVvdXQuIFdoZW4gdW5zZXQgdGhlXG4gICAgICogdGltZW91dCBpcyByZWFkIGZyb20gYGNvbmZpZ3VyYXRpb24uZ2V0QmFja2dyb3VuZEpvYnNDb25maWcoKS5qb2JUaW1lb3V0TXNgXG4gICAgICogYXQgZm9yayB0aW1lIChkZWZhdWx0OiBkaXNhYmxlZCkuXG4gICAgICogQHR5cGUge251bWJlciB8IHVuZGVmaW5lZH1cbiAgICAgKi9cbiAgICB0aGlzLmpvYlRpbWVvdXRNc092ZXJyaWRlID0gdHlwZW9mIGpvYlRpbWVvdXRNcyA9PT0gXCJudW1iZXJcIiA/IGpvYlRpbWVvdXRNcyA6IHVuZGVmaW5lZFxuICAgIHRoaXMuc2hvdWxkU3RvcCA9IGZhbHNlXG4gICAgdGhpcy5pc1JldGlyaW5nID0gZmFsc2VcbiAgICAvKiogQHR5cGUge1Byb21pc2U8dm9pZD4gfCB1bmRlZmluZWR9ICovXG4gICAgdGhpcy5zdG9wUHJvbWlzZSA9IHVuZGVmaW5lZFxuICAgIC8qKlxuICAgICAqIFJlc29sdmVzIHN0b3Agb2JzZXJ2YXRpb24uXG4gICAgICogQHR5cGUgeyh2YWx1ZT86IHZvaWQpID0+IHZvaWR9XG4gICAgICovXG4gICAgdGhpcy5fcmVzb2x2ZVN0b3BwZWQgPSAoKSA9PiB7fVxuICAgIC8qKlxuICAgICAqIFJlamVjdHMgc3RvcCBvYnNlcnZhdGlvbi5cbiAgICAgKiBAdHlwZSB7KGVycm9yOiBFcnJvcikgPT4gdm9pZH1cbiAgICAgKi9cbiAgICB0aGlzLl9yZWplY3RTdG9wcGVkID0gKCkgPT4ge31cbiAgICAvKiogQHR5cGUge1Byb21pc2U8dm9pZD59ICovXG4gICAgdGhpcy5fc3RvcHBlZFByb21pc2UgPSBQcm9taXNlLnJlc29sdmUoKVxuICAgIHRoaXMuX3Jlc2V0U3RvcHBlZFByb21pc2UoKVxuICAgIHRoaXMud29ya2VySWQgPSB0aGlzLndvcmtlckluc3RhbmNlSWRcbiAgICB0aGlzLl9nZW5lcmF0aW9uQWNjZXB0ZWQgPSBmYWxzZVxuICAgIHRoaXMuZ2VuZXJhdGlvbkhhbmRzaGFrZVRpbWVvdXRNcyA9IHZhbGlkYXRlR2VuZXJhdGlvbkhhbmRzaGFrZVRpbWVvdXRNcyhnZW5lcmF0aW9uSGFuZHNoYWtlVGltZW91dE1zKVxuICAgIGlmICghTnVtYmVyLmlzSW50ZWdlcihyZWNvbm5lY3REZWxheU1zKSB8fCByZWNvbm5lY3REZWxheU1zIDwgMCB8fCByZWNvbm5lY3REZWxheU1zID4gTUFYX0ZPUktFRF9KT0JfVElNRU9VVF9NUykge1xuICAgICAgdGhyb3cgbmV3IFR5cGVFcnJvcihcInJlY29ubmVjdERlbGF5TXMgbXVzdCBiZSBhbiBpbnRlZ2VyIGJldHdlZW4gMCBhbmQgMjE0NzQ4MzY0N1wiKVxuICAgIH1cbiAgICB0aGlzLnJlY29ubmVjdERlbGF5TXMgPSByZWNvbm5lY3REZWxheU1zXG4gICAgLyoqIEB0eXBlIHtSZXR1cm5UeXBlPHR5cGVvZiBzZXRUaW1lb3V0PiB8IHVuZGVmaW5lZH0gKi9cbiAgICB0aGlzLl9yZWNvbm5lY3RUaW1lciA9IHVuZGVmaW5lZFxuICAgIHRoaXMuaGVhcnRiZWF0SW50ZXJ2YWxNcyA9IHR5cGVvZiBoZWFydGJlYXRJbnRlcnZhbE1zID09PSBcIm51bWJlclwiICYmIGhlYXJ0YmVhdEludGVydmFsTXMgPj0gMVxuICAgICAgPyBoZWFydGJlYXRJbnRlcnZhbE1zXG4gICAgICA6IEhFQVJUQkVBVF9JTlRFUlZBTF9NU1xuICAgIC8qKlxuICAgICAqIE5hcnJvd3MgdGhlIHJ1bnRpbWUgdmFsdWUgdG8gdGhlIGRvY3VtZW50ZWQgdHlwZS5cbiAgICAgKiBAdHlwZSB7UmV0dXJuVHlwZTx0eXBlb2Ygc2V0SW50ZXJ2YWw+IHwgdW5kZWZpbmVkfSAqL1xuICAgIHRoaXMuX2hlYXJ0YmVhdFRpbWVyID0gdW5kZWZpbmVkXG4gICAgLyoqXG4gICAgICogSW4tZmxpZ2h0IGpvYi1yZXN1bHQgcmVwb3J0cyB0byB0aGUgbWFpbi4gUmVwb3J0aW5nIGlzIGRlY291cGxlZCBmcm9tIHRoZVxuICAgICAqIGpvYi9jaGlsZCBzbG90IChmcmVlaW5nIHRoZSBzbG90IG5ldmVyIHdhaXRzIG9uIGEgcmVwb3J0KSBhbmQgcmV0cmllZFxuICAgICAqIGR1cmFibHksIHNvIGEgdHJhbnNpZW50IG1haW4vREIgb3V0YWdlIGNhbm5vdCBsZWFrIHNsb3RzIG9yIGxvc2UgYVxuICAgICAqIHRlcm1pbmFsIHJlcG9ydC4gVHJhY2tlZCBzbyBhIGdyYWNlZnVsIGBzdG9wKClgIGNhbiBkcmFpbiB0aGVtLlxuICAgICAqIEB0eXBlIHtTZXQ8UHJvbWlzZTx2b2lkPj59XG4gICAgICovXG4gICAgdGhpcy5pbmZsaWdodFJlcG9ydHMgPSBuZXcgU2V0KClcbiAgICAvKipcbiAgICAgKiBOYXJyb3dzIHRoZSBydW50aW1lIHZhbHVlIHRvIHRoZSBkb2N1bWVudGVkIHR5cGUuXG4gICAgICogQHR5cGUge0pzb25Tb2NrZXQgfCB1bmRlZmluZWR9ICovXG4gICAgdGhpcy5qc29uU29ja2V0ID0gdW5kZWZpbmVkXG4gICAgLyoqXG4gICAgICogTmFycm93cyB0aGUgcnVudGltZSB2YWx1ZSB0byB0aGUgZG9jdW1lbnRlZCB0eXBlLlxuICAgICAqIEB0eXBlIHtCYWNrZ3JvdW5kSm9ic1N0YXR1c1JlcG9ydGVyIHwgdW5kZWZpbmVkfSAqL1xuICAgIHRoaXMuc3RhdHVzUmVwb3J0ZXIgPSB1bmRlZmluZWRcbiAgICAvKipcbiAgICAgKiBVcCB0byBgdGhpcy5tYXhDb25jdXJyZW50SW5saW5lSm9ic2Agb2YgdGhlc2UgcnVuIGluIHBhcmFsbGVsLiBUaGV5XG4gICAgICogc2hhcmUgdGhlIHdvcmtlcidzIHByb2Nlc3MgYW5kIERCIGNvbm5lY3Rpb24gcG9vbCwgc28gY29uY3VycmVuY3kgaXNcbiAgICAgKiBhYm91dCBvdmVybGFwcGluZyBJL08gd2FpdHMg4oCUIHVzZSBmb3JraW5nIGZvciBtZW1vcnkgaXNvbGF0aW9uIGFjcm9zc1xuICAgICAqIGxvbmctcnVubmluZyBqb2JzIGFuZCBmb3IgdXNpbmcgbW9yZSBjb3Jlcy5cbiAgICAgKiBAdHlwZSB7U2V0PFByb21pc2U8dm9pZD4+fVxuICAgICAqL1xuICAgIHRoaXMuaW5mbGlnaHRJbmxpbmVKb2JzID0gbmV3IFNldCgpXG4gICAgLyoqXG4gICAgICogSW4tZmxpZ2h0IHByb2Nlc3MgcnVubmVyIGV4aXQgcHJvbWlzZXMuIFRyYWNrZWQgc28gcHJvY2Vzcy1qb2IgaGFuZG9mZlxuICAgICAqIHN0YXlzIGJvdW5kZWQgd2hpbGUgcnVubmluZyBhbmQgc28gYSBncmFjZWZ1bCBgc3RvcCgpYCBjYW4gZHJhaW4gdGhlbS5cbiAgICAgKiBAdHlwZSB7U2V0PFByb21pc2U8dm9pZD4+fVxuICAgICAqL1xuICAgIHRoaXMuaW5mbGlnaHRQcm9jZXNzSm9icyA9IG5ldyBTZXQoKVxuICAgIC8qKlxuICAgICAqIExpdmUgcHJvY2VzcyBydW5uZXIgY2hpbGQgcHJvY2Vzc2VzLCBrZXB0IHNvIGEgZ3JhY2VmdWwgYHN0b3AoKWAgY2FuXG4gICAgICogdGVybWluYXRlIGFueSB0aGF0IG91dGxhc3QgdGhlIHNodXRkb3duIGRyYWluIGluc3RlYWQgb2Ygb3JwaGFuaW5nIHRoZW1cbiAgICAgKiBhY3Jvc3MgYSBkZXBsb3kgKHdoZXJlIHRoZXkgd291bGQga2VlcCBydW5uaW5nIGFnYWluc3QgZGVsZXRlZCByZWxlYXNlXG4gICAgICogY29kZSBhbmQgaG9sZGluZyBkYXRhYmFzZSBjb25uZWN0aW9ucykuXG4gICAgICogQHR5cGUge1NldDxpbXBvcnQoXCJub2RlOmNoaWxkX3Byb2Nlc3NcIikuQ2hpbGRQcm9jZXNzPn1cbiAgICAgKi9cbiAgICB0aGlzLmluZmxpZ2h0UHJvY2Vzc0NoaWxkcmVuID0gbmV3IFNldCgpXG4gICAgLyoqIEB0eXBlIHtTZXQ8UHJvbWlzZTx2b2lkPj59ICovXG4gICAgdGhpcy5pbmZsaWdodFBvb2xlZEpvYnMgPSBuZXcgU2V0KClcbiAgICAvKiogQHR5cGUge01hcDxzdHJpbmcsIEFycmF5PGltcG9ydChcIi4vdHlwZXMuanNcIikuQmFja2dyb3VuZEpvYlBheWxvYWQgJiB7aWQ6IHN0cmluZ30+Pn0gKi9cbiAgICB0aGlzLnBvb2xlZEpvYlF1ZXVlcyA9IG5ldyBNYXAoKVxuICAgIC8qKiBAdHlwZSB7TWFwPHN0cmluZywgUHJvbWlzZTx2b2lkPj59IC0gUGVyLWlkIG91dGVyIHF1ZXVlIHRyYWNrZXJzLiAqL1xuICAgIHRoaXMucG9vbGVkSm9iUXVldWVUcmFja2VycyA9IG5ldyBNYXAoKVxuICAgIC8qKiBAdHlwZSB7U2V0PGltcG9ydChcIm5vZGU6Y2hpbGRfcHJvY2Vzc1wiKS5DaGlsZFByb2Nlc3M+fSAqL1xuICAgIHRoaXMucG9vbGVkQ2hpbGRyZW4gPSBuZXcgU2V0KClcbiAgICAvKiogQHR5cGUge01hcDxpbXBvcnQoXCJub2RlOmNoaWxkX3Byb2Nlc3NcIikuQ2hpbGRQcm9jZXNzLCBQb29sZWRDaGlsZFN0YXRlPn0gKi9cbiAgICB0aGlzLnBvb2xlZENoaWxkU3RhdGVzID0gbmV3IE1hcCgpXG4gICAgLyoqIEB0eXBlIHtXZWFrU2V0PFByb21pc2U8dm9pZD4+fSAqL1xuICAgIHRoaXMuX3Bvb2xlZFN0YXJ0dXBGYWlsdXJlSm9icyA9IG5ldyBXZWFrU2V0KClcbiAgICAvLyBNb25vdG9uaWMgZGlzcGF0Y2ggY291bnRlciBmb3Igcm91bmQtcm9iaW4gY2hpbGQgc2VsZWN0aW9uOiBlYWNoIGRpc3BhdGNoIHN0YW1wc1xuICAgIC8vIHRoZSBjaG9zZW4gY2hpbGQsIGFuZCBzZWxlY3Rpb24gcHJlZmVycyB0aGUgY2hpbGQgZGlzcGF0Y2hlZCBsZWFzdCByZWNlbnRseS5cbiAgICB0aGlzLl9wb29sZWREaXNwYXRjaFNlcSA9IDBcbiAgICAvLyBXYWl0ZXJzIGJsb2NrZWQgaW4gX3J1blBvb2xlZEpvYiBiZWNhdXNlIHRoZSBwb29sIGlzIGF0IGl0cyBoYXJkIGNhcDogYSBqb2IgbWF5XG4gICAgLy8gbm90IHNwYXduIGEgY2hpbGQgd2hpbGUgdG90YWwgbGl2ZSBjaGlsZHJlbiAod29ya2luZyArIGRyYWluaW5nKSBpcyBhdCB0aGUgY2FwLlxuICAgIC8qKiBAdHlwZSB7U2V0PCgpID0+IHZvaWQ+fSAqL1xuICAgIHRoaXMuX3Bvb2xlZFNsb3RXYWl0ZXJzID0gbmV3IFNldCgpXG4gICAgLyoqIEB0eXBlIHtSZXR1cm5UeXBlPHR5cGVvZiBzZXRJbnRlcnZhbD4gfCB1bmRlZmluZWR9IC0gU2FmZXR5IHBvbGwgdGhhdCByZS1jaGVja3MgdGhlIHNsb3QgY29uZGl0aW9uLiAqL1xuICAgIHRoaXMuX3Bvb2xlZFNsb3RXYWl0VGltZXIgPSB1bmRlZmluZWRcbiAgfVxuXG4gIC8qKiBTdGFydHMgdGhlIHNsb3Qtd2FpdGVyIHNhZmV0eSBwb2xsIGlmIGl0IGlzIG5vdCBhbHJlYWR5IHJ1bm5pbmcuICovXG4gIF9zdGFydFBvb2xlZFNsb3RXYWl0UG9sbCgpIHtcbiAgICBpZiAodGhpcy5fcG9vbGVkU2xvdFdhaXRUaW1lcikgcmV0dXJuXG5cbiAgICB0aGlzLl9wb29sZWRTbG90V2FpdFRpbWVyID0gc2V0SW50ZXJ2YWwoKCkgPT4gdGhpcy5fd2FrZVBvb2xlZFNsb3RXYWl0ZXJzKCksIDUwKVxuICAgIHRoaXMuX3Bvb2xlZFNsb3RXYWl0VGltZXIudW5yZWYoKVxuICB9XG5cbiAgLyoqIFN0b3BzIHRoZSBzbG90LXdhaXRlciBzYWZldHkgcG9sbCBvbmNlIG5vIHdhaXRlciBpcyByZWdpc3RlcmVkLiAqL1xuICBfc3RvcFBvb2xlZFNsb3RXYWl0UG9sbElmSWRsZSgpIHtcbiAgICBpZiAodGhpcy5fcG9vbGVkU2xvdFdhaXRlcnMuc2l6ZSA+IDAgfHwgIXRoaXMuX3Bvb2xlZFNsb3RXYWl0VGltZXIpIHJldHVyblxuXG4gICAgY2xlYXJJbnRlcnZhbCh0aGlzLl9wb29sZWRTbG90V2FpdFRpbWVyKVxuICAgIHRoaXMuX3Bvb2xlZFNsb3RXYWl0VGltZXIgPSB1bmRlZmluZWRcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHN0YXJ0LlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyB3aGVuIGNvbm5lY3RlZC5cbiAgICovXG4gIGFzeW5jIHN0YXJ0KCkge1xuICAgIHRoaXMuc2hvdWxkU3RvcCA9IGZhbHNlXG4gICAgdGhpcy5pc1JldGlyaW5nID0gZmFsc2VcbiAgICB0aGlzLnN0b3BQcm9taXNlID0gdW5kZWZpbmVkXG4gICAgdGhpcy5fcmVzZXRTdG9wcGVkUHJvbWlzZSgpXG4gICAgdGhpcy5jb25maWd1cmF0aW9uID0gYXdhaXQgdGhpcy5jb25maWd1cmF0aW9uUHJvbWlzZVxuICAgIHRoaXMuY29uZmlndXJhdGlvbi5zZXRDdXJyZW50KClcbiAgICBjb25zdCByZXNvbHZlZENvbmZpZyA9IHRoaXMuY29uZmlndXJhdGlvbi5nZXRCYWNrZ3JvdW5kSm9ic0NvbmZpZygpXG4gICAgdGhpcy5nZW5lcmF0aW9uSWQgPSB0aGlzLmNvbmZpZ3VyYXRpb24ucmVzb2x2ZUJhY2tncm91bmRKb2JzR2VuZXJhdGlvbkNvbmZpZyh7XG4gICAgICBnZW5lcmF0aW9uSWQ6IHRoaXMuZXhwbGljaXRHZW5lcmF0aW9uSWQsXG4gICAgICBzb3VyY2VOYW1lOiBcIkJhY2tncm91bmRKb2JzV29ya2VyXCJcbiAgICB9KS5nZW5lcmF0aW9uSWRcbiAgICB0aGlzLndvcmtlcklkID0gdGhpcy5nZW5lcmF0aW9uSWRcbiAgICAgID8gY3JlYXRlR2VuZXJhdGlvbldvcmtlcklkKHtnZW5lcmF0aW9uSWQ6IHRoaXMuZ2VuZXJhdGlvbklkLCB3b3JrZXJJbnN0YW5jZUlkOiB0aGlzLndvcmtlckluc3RhbmNlSWR9KVxuICAgICAgOiB0aGlzLndvcmtlckluc3RhbmNlSWRcbiAgICB0aGlzLmhvc3QgfHw9IHJlc29sdmVkQ29uZmlnLmhvc3RcbiAgICBpZiAodHlwZW9mIHRoaXMucG9ydCAhPT0gXCJudW1iZXJcIikgdGhpcy5wb3J0ID0gcmVzb2x2ZWRDb25maWcucG9ydFxuICAgIGF3YWl0IHRoaXMuY29uZmlndXJhdGlvbi5pbml0aWFsaXplKHt0eXBlOiBcImJhY2tncm91bmQtam9icy13b3JrZXJcIn0pXG4gICAgYXdhaXQgdGhpcy5jb25maWd1cmF0aW9uLmNvbm5lY3RCZWFjb24oe3BlZXJUeXBlOiBcImJhY2tncm91bmQtam9icy13b3JrZXJcIn0pXG5cbiAgICAvLyBDb25zdHJ1Y3RvciBvdmVycmlkZXMgd2luOyBvdGhlcndpc2UgcGljayB1cCB0aGUgY29uZmlndXJlZCBjYXBzLlxuICAgIGlmICh0eXBlb2YgdGhpcy5tYXhDb25jdXJyZW50SW5saW5lSm9ic092ZXJyaWRlICE9PSBcIm51bWJlclwiKSB7XG4gICAgICBjb25zdCBjb25maWcgPSB0aGlzLmNvbmZpZ3VyYXRpb24uZ2V0QmFja2dyb3VuZEpvYnNDb25maWcoKVxuXG4gICAgICB0aGlzLm1heENvbmN1cnJlbnRJbmxpbmVKb2JzID0gY29uZmlnLm1heENvbmN1cnJlbnRJbmxpbmVKb2JzIHx8IHRoaXMubWF4Q29uY3VycmVudElubGluZUpvYnNcbiAgICB9XG4gICAgaWYgKHR5cGVvZiB0aGlzLm1heENvbmN1cnJlbnRGb3JrZWRKb2JzT3ZlcnJpZGUgIT09IFwibnVtYmVyXCIpIHtcbiAgICAgIGNvbnN0IGNvbmZpZyA9IHRoaXMuY29uZmlndXJhdGlvbi5nZXRCYWNrZ3JvdW5kSm9ic0NvbmZpZygpXG5cbiAgICAgIHRoaXMubWF4Q29uY3VycmVudEZvcmtlZEpvYnMgPSBjb25maWcubWF4Q29uY3VycmVudEZvcmtlZEpvYnMgfHwgdGhpcy5tYXhDb25jdXJyZW50Rm9ya2VkSm9ic1xuICAgIH1cbiAgICBjb25zdCBwb29sQ29uZmlnID0gdGhpcy5jb25maWd1cmF0aW9uLmdldEJhY2tncm91bmRKb2JzQ29uZmlnKClcbiAgICBpZiAodHlwZW9mIHRoaXMucG9vbGVkUnVubmVyQ291bnRPdmVycmlkZSAhPT0gXCJudW1iZXJcIikgdGhpcy5wb29sZWRSdW5uZXJDb3VudCA9IHBvb2xDb25maWcucG9vbGVkUnVubmVyQ291bnRcbiAgICBpZiAodHlwZW9mIHRoaXMucG9vbGVkUnVubmVyQ29uY3VycmVuY3lPdmVycmlkZSAhPT0gXCJudW1iZXJcIikgdGhpcy5wb29sZWRSdW5uZXJDb25jdXJyZW5jeSA9IHBvb2xDb25maWcucG9vbGVkUnVubmVyQ29uY3VycmVuY3lcbiAgICBpZiAodHlwZW9mIHRoaXMucG9vbGVkUnVubmVyTWF4Sm9ic092ZXJyaWRlICE9PSBcIm51bWJlclwiKSB0aGlzLnBvb2xlZFJ1bm5lck1heEpvYnMgPSBwb29sQ29uZmlnLnBvb2xlZFJ1bm5lck1heEpvYnNcbiAgICBpZiAodHlwZW9mIHRoaXMucG9vbGVkUnVubmVyTWF4UnNzQnl0ZXNPdmVycmlkZSAhPT0gXCJudW1iZXJcIikgdGhpcy5wb29sZWRSdW5uZXJNYXhSc3NCeXRlcyA9IHBvb2xDb25maWcucG9vbGVkUnVubmVyTWF4UnNzQnl0ZXNcbiAgICBpZiAodHlwZW9mIHRoaXMucG9vbGVkUnVubmVyTWF4TGlmZXRpbWVNc092ZXJyaWRlICE9PSBcIm51bWJlclwiKSB0aGlzLnBvb2xlZFJ1bm5lck1heExpZmV0aW1lTXMgPSBwb29sQ29uZmlnLnBvb2xlZFJ1bm5lck1heExpZmV0aW1lTXNcbiAgICBpZiAodHlwZW9mIHRoaXMucG9vbGVkUnVubmVyU2lsZW5jZVRpbWVvdXRNc092ZXJyaWRlICE9PSBcIm51bWJlclwiICYmIHR5cGVvZiBwb29sQ29uZmlnLnBvb2xlZFJ1bm5lclNpbGVuY2VUaW1lb3V0TXMgPT09IFwibnVtYmVyXCIpIHRoaXMucG9vbGVkUnVubmVyU2lsZW5jZVRpbWVvdXRNcyA9IHBvb2xDb25maWcucG9vbGVkUnVubmVyU2lsZW5jZVRpbWVvdXRNc1xuICAgIGlmICh0eXBlb2YgdGhpcy5ydW5uZXJNYXhPbGRTcGFjZVNpemVNYk92ZXJyaWRlICE9PSBcIm51bWJlclwiICYmIHR5cGVvZiBwb29sQ29uZmlnLnJ1bm5lck1heE9sZFNwYWNlU2l6ZU1iID09PSBcIm51bWJlclwiKSB0aGlzLnJ1bm5lck1heE9sZFNwYWNlU2l6ZU1iID0gcG9vbENvbmZpZy5ydW5uZXJNYXhPbGRTcGFjZVNpemVNYlxuICAgIGlmICh0eXBlb2YgdGhpcy5ydW5uZXJNYWxsb2NBcmVuYU1heE92ZXJyaWRlICE9PSBcIm51bWJlclwiICYmIHR5cGVvZiBwb29sQ29uZmlnLnJ1bm5lck1hbGxvY0FyZW5hTWF4ID09PSBcIm51bWJlclwiKSB0aGlzLnJ1bm5lck1hbGxvY0FyZW5hTWF4ID0gcG9vbENvbmZpZy5ydW5uZXJNYWxsb2NBcmVuYU1heFxuXG4gICAgdGhpcy5zdGF0dXNSZXBvcnRlciA9IG5ldyBCYWNrZ3JvdW5kSm9ic1N0YXR1c1JlcG9ydGVyKHtcbiAgICAgIGNvbmZpZ3VyYXRpb246IHRoaXMuY29uZmlndXJhdGlvbixcbiAgICAgIGhvc3Q6IHRoaXMuaG9zdCxcbiAgICAgIHBvcnQ6IHRoaXMucG9ydCxcbiAgICAgIGdlbmVyYXRpb25IYW5kc2hha2VUaW1lb3V0TXM6IHRoaXMuZ2VuZXJhdGlvbkhhbmRzaGFrZVRpbWVvdXRNcyxcbiAgICAgIGdlbmVyYXRpb25JZDogdGhpcy5nZW5lcmF0aW9uSWRcbiAgICB9KVxuICAgIHRyeSB7XG4gICAgICBhd2FpdCB0aGlzLl9jb25uZWN0KHthbGxvd1JlY29ubmVjdDogZmFsc2V9KVxuICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICBsZXQgY2xlYW51cEVycm9yXG5cbiAgICAgIHRyeSB7XG4gICAgICAgIGF3YWl0IHRoaXMuc3RvcCgpXG4gICAgICB9IGNhdGNoIChjYXVnaHRDbGVhbnVwRXJyb3IpIHtcbiAgICAgICAgY2xlYW51cEVycm9yID0gY2F1Z2h0Q2xlYW51cEVycm9yXG4gICAgICB9XG5cbiAgICAgIGlmIChjbGVhbnVwRXJyb3IpIHtcbiAgICAgICAgdGhyb3cgbmV3IEFnZ3JlZ2F0ZUVycm9yKFxuICAgICAgICAgIFtlcnJvciwgY2xlYW51cEVycm9yXSxcbiAgICAgICAgICBcIkJhY2tncm91bmQgam9icyB3b3JrZXIgc3RhcnR1cCBhbmQgY2xlYW51cCBmYWlsZWRcIixcbiAgICAgICAgICB7Y2F1c2U6IGVycm9yfVxuICAgICAgICApXG4gICAgICB9XG5cbiAgICAgIHRocm93IGVycm9yXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIEdyYWNlZnVsbHkgc3RvcHMgdGhlIHdvcmtlcjogYW5ub3VuY2VzIGRyYWluaW5nIHRvIHRoZSBtYWluIHByb2Nlc3Mgc29cbiAgICogbm8gbmV3IGpvYnMgYXJlIGRpc3BhdGNoZWQsIHdhaXRzIGZvciBpbi1mbGlnaHQgaW5saW5lIGpvYnMgYW5kIHByb2Nlc3NcbiAgICogcnVubmVycyB0byBmaW5pc2ggKHNvIHRoZWlyIHJlc3VsdHMgY2FuIGJlIHJlcG9ydGVkKSwgdGhlbiBjbG9zZXMgdGhlXG4gICAqIHNvY2tldCBhbmQgZGlzY29ubmVjdHMgZnJvbSB0aGUgYmVhY29uLlxuICAgKlxuICAgKiBQcm9jZXNzIHJ1bm5lcnMgYXJlIGNoaWxkIHByb2Nlc3Nlcy4gV2hlbiBhIGB0aW1lb3V0TXNgIGlzIGdpdmVuIChlLmcuIGFcbiAgICogZGVwbG95IGRyYWluaW5nIHRoZSBvbGQgcmVsZWFzZSkgYW55IHJ1bm5lciBzdGlsbCBhbGl2ZSBhZnRlciB0aGUgZHJhaW5cbiAgICogd2luZG93IGlzIHRlcm1pbmF0ZWQgKFNJR1RFUk0sIHRoZW4gU0lHS0lMTCkgcmF0aGVyIHRoYW4gbGVmdCB0byBvcnBoYW5cbiAgICogYWNyb3NzIHRoZSBkZXBsb3kuIFdpdGggbm8gYHRpbWVvdXRNc2AgdGhlIGRyYWluIHdhaXRzIGZvciBydW5uZXJzIHRvXG4gICAqIGZpbmlzaCBvbiB0aGVpciBvd24uXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBbYXJnc10gLSBPcHRpb25zLlxuICAgKiBAcGFyYW0ge251bWJlcn0gW2FyZ3MudGltZW91dE1zXSAtIE1heCB3YWl0IGZvciBpbi1mbGlnaHQgam9icyAocGVyIHBoYXNlKSBpbiBtcy5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgd2hlbiBzdG9wcGVkLlxuICAgKi9cbiAgc3RvcCh7dGltZW91dE1zfSA9IHt9KSB7XG4gICAgY29uc3Qgc3RvcFByb21pc2UgPSB0aGlzLnN0b3BQcm9taXNlIHx8IHRoaXMuX3N0b3Aoe3RpbWVvdXRNc30pXG5cbiAgICBpZiAoIXRoaXMuc3RvcFByb21pc2UpIHtcbiAgICAgIHRoaXMuc3RvcFByb21pc2UgPSBzdG9wUHJvbWlzZVxuICAgICAgdm9pZCBzdG9wUHJvbWlzZS50aGVuKHRoaXMuX3Jlc29sdmVTdG9wcGVkLCAoZXJyb3IpID0+IHtcbiAgICAgICAgdGhpcy5fcmVqZWN0U3RvcHBlZChlcnJvciBpbnN0YW5jZW9mIEVycm9yID8gZXJyb3IgOiBuZXcgRXJyb3IoU3RyaW5nKGVycm9yKSkpXG4gICAgICB9KVxuICAgIH1cblxuICAgIHJldHVybiBzdG9wUHJvbWlzZVxuICB9XG5cbiAgLyoqXG4gICAqIFdhaXRzIGZvciBhdXRvbWF0aWMgb3IgcmVxdWVzdGVkIHN0b3AuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIHdoZW4gdGhpcyB3b3JrZXIgaGFzIGZ1bGx5IHN0b3BwZWQuXG4gICAqL1xuICB3YWl0VW50aWxTdG9wcGVkKCkgeyByZXR1cm4gdGhpcy5fc3RvcHBlZFByb21pc2UgfVxuXG4gIC8qKiBSZXNldHMgdGhlIHN0b3Agb2JzZXJ2YXRpb24gcHJvbWlzZSBmb3IgYSBuZXcgd29ya2VyIHN0YXJ0LiAqL1xuICBfcmVzZXRTdG9wcGVkUHJvbWlzZSgpIHtcbiAgICB0aGlzLl9zdG9wcGVkUHJvbWlzZSA9IG5ldyBQcm9taXNlKChyZXNvbHZlLCByZWplY3QpID0+IHtcbiAgICAgIHRoaXMuX3Jlc29sdmVTdG9wcGVkID0gcmVzb2x2ZVxuICAgICAgdGhpcy5fcmVqZWN0U3RvcHBlZCA9IHJlamVjdFxuICAgIH0pXG4gICAgdm9pZCB0aGlzLl9zdG9wcGVkUHJvbWlzZS5jYXRjaCgoKSA9PiB7fSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHRoZSB3b3JrZXIgc2h1dGRvd24gbGlmZWN5Y2xlIG9uY2UuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBbYXJnc10gLSBPcHRpb25zLlxuICAgKiBAcGFyYW0ge251bWJlcn0gW2FyZ3MudGltZW91dE1zXSAtIE1heCB3YWl0IGZvciBpbi1mbGlnaHQgam9icyAocGVyIHBoYXNlKSBpbiBtcy5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgd2hlbiBzdG9wcGVkLlxuICAgKi9cbiAgYXN5bmMgX3N0b3Aoe3RpbWVvdXRNc30gPSB7fSkge1xuICAgIHRoaXMuc2hvdWxkU3RvcCA9IHRydWVcbiAgICB0aGlzLmlzUmV0aXJpbmcgPSB0cnVlXG4gICAgdGhpcy5fc3RvcEhlYXJ0YmVhdCgpXG4gICAgaWYgKHRoaXMuX3JlY29ubmVjdFRpbWVyKSB7XG4gICAgICBjbGVhclRpbWVvdXQodGhpcy5fcmVjb25uZWN0VGltZXIpXG4gICAgICB0aGlzLl9yZWNvbm5lY3RUaW1lciA9IHVuZGVmaW5lZFxuICAgIH1cblxuICAgIGF3YWl0IHNodXRkb3duTGlmZWN5Y2xlKHtcbiAgICAgIG9uU3RvcHBlZDogdGhpcy5vblN0b3BwZWQsXG4gICAgICBzaHV0ZG93bjogYXN5bmMgKCkgPT4ge1xuICAgICAgICAvLyBBbm5vdW5jZSBkcmFpbiBzbyBtYWluIHN0b3BzIGRpc3BhdGNoaW5nIGJ1dCBrZWVwcyB0aGUgY29ubmVjdGlvblxuICAgICAgICAvLyBvcGVuIHVudGlsIHdlIGNsb3NlIGl0IG91cnNlbHZlcyBiZWxvdy5cbiAgICAgICAgaWYgKHRoaXMuanNvblNvY2tldCkge1xuICAgICAgICAgIHRyeSB7XG4gICAgICAgICAgICB0aGlzLmpzb25Tb2NrZXQuc2VuZCh7dHlwZTogXCJkcmFpbmluZ1wifSlcbiAgICAgICAgICB9IGNhdGNoIHtcbiAgICAgICAgICAgIC8vIFNvY2tldCBtYXkgYWxyZWFkeSBiZSBjbG9zaW5nOyBub3RoaW5nIHRvIGRvLlxuICAgICAgICAgIH1cbiAgICAgICAgfVxuXG4gICAgICAgIGF3YWl0IHRoaXMuX2RyYWluSW5mbGlnaHQodGhpcy5pbmZsaWdodElubGluZUpvYnMsIHRpbWVvdXRNcylcbiAgICAgICAgYXdhaXQgdGhpcy5fZHJhaW5JbmZsaWdodCh0aGlzLmluZmxpZ2h0UG9vbGVkSm9icywgdGltZW91dE1zKVxuICAgICAgICBhd2FpdCB0aGlzLl9kcmFpbkluZmxpZ2h0KHRoaXMuaW5mbGlnaHRQcm9jZXNzSm9icywgdGltZW91dE1zKVxuICAgICAgICBhd2FpdCB0aGlzLl90ZXJtaW5hdGVQcm9jZXNzQ2hpbGRyZW4oKVxuICAgICAgICAvLyBHaXZlIGluLWZsaWdodCByZXN1bHQgcmVwb3J0cyAobm93IGRlY291cGxlZCBmcm9tIGpvYiBzbG90cykgYSBib3VuZGVkXG4gICAgICAgIC8vIGNoYW5jZSB0byBsYW5kIGJlZm9yZSB0aGUgc29ja2V0IGNsb3Nlcy5cbiAgICAgICAgYXdhaXQgdGhpcy5fZHJhaW5JbmZsaWdodCh0aGlzLmluZmxpZ2h0UmVwb3J0cywgdGltZW91dE1zKVxuXG4gICAgICAgIGlmICh0aGlzLmpzb25Tb2NrZXQpIHRoaXMuanNvblNvY2tldC5jbG9zZSgpXG4gICAgICAgIGlmICghdGhpcy5jb25maWd1cmF0aW9uKSByZXR1cm5cblxuICAgICAgICBhd2FpdCB0aGlzLl9jbG9zZUNvbmZpZ3VyYXRpb24oKVxuICAgICAgfVxuICAgIH0pXG4gIH1cblxuICAvKiogQmVnaW5zIGdlbmVyYXRpb24gcmV0aXJlbWVudCB3aXRob3V0IHJldm9raW5nIGxpdmVuZXNzIGR1cmluZyB0aGUgZHJhaW4uICovXG4gIF9iZWdpbkdlbmVyYXRpb25SZXRpcmVtZW50KCkge1xuICAgIGlmICh0aGlzLnN0b3BQcm9taXNlKSByZXR1cm5cblxuICAgIHRoaXMuaXNSZXRpcmluZyA9IHRydWVcbiAgICBjb25zdCBzdG9wUHJvbWlzZSA9IHRoaXMuX3N0b3BBZnRlckdlbmVyYXRpb25EcmFpbigpXG4gICAgdGhpcy5zdG9wUHJvbWlzZSA9IHN0b3BQcm9taXNlXG4gICAgdm9pZCBzdG9wUHJvbWlzZS50aGVuKHRoaXMuX3Jlc29sdmVTdG9wcGVkLCAoZXJyb3IpID0+IHtcbiAgICAgIGNvbnN0IG5vcm1hbGl6ZWRFcnJvciA9IGVycm9yIGluc3RhbmNlb2YgRXJyb3IgPyBlcnJvciA6IG5ldyBFcnJvcihTdHJpbmcoZXJyb3IpKVxuXG4gICAgICB0aGlzLl9yZWplY3RTdG9wcGVkKG5vcm1hbGl6ZWRFcnJvcilcbiAgICAgIHRoaXMuX3JlcG9ydExpZmVjeWNsZUVycm9yKG5vcm1hbGl6ZWRFcnJvcilcbiAgICB9KVxuICB9XG5cbiAgLyoqXG4gICAqIERyYWlucyBhY2NlcHRlZCBnZW5lcmF0aW9uIHdvcmsgd2hpbGUgcmV0YWluaW5nIHRoZSBleGFjdCBjb25uZWN0aW9uIGFuZFxuICAgKiBoZWFydGJlYXQsIHRoZW4gcGVyZm9ybXMgdGhlIGZpbmFsIHRlcm1pbmF0aW5nIHN0b3AuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIGFmdGVyIHRoZSB3b3JrZXIgaGFzIGZ1bGx5IGNsb3NlZC5cbiAgICovXG4gIGFzeW5jIF9zdG9wQWZ0ZXJHZW5lcmF0aW9uRHJhaW4oKSB7XG4gICAgaWYgKHRoaXMuanNvblNvY2tldCkge1xuICAgICAgdHJ5IHtcbiAgICAgICAgdGhpcy5qc29uU29ja2V0LnNlbmQoe3R5cGU6IFwiZHJhaW5pbmdcIn0pXG4gICAgICB9IGNhdGNoIHtcbiAgICAgICAgLy8gVGhlIGNsb3NlIGhhbmRsZXIgb3ducyBleGFjdCBzYW1lLWdlbmVyYXRpb24gcmVjb25uZWN0LlxuICAgICAgfVxuICAgIH1cblxuICAgIGF3YWl0IHRoaXMuX2RyYWluSW5mbGlnaHQodGhpcy5pbmZsaWdodElubGluZUpvYnMpXG4gICAgYXdhaXQgdGhpcy5fZHJhaW5JbmZsaWdodCh0aGlzLmluZmxpZ2h0UG9vbGVkSm9icylcbiAgICBhd2FpdCB0aGlzLl9kcmFpbkluZmxpZ2h0KHRoaXMuaW5mbGlnaHRQcm9jZXNzSm9icylcbiAgICBhd2FpdCB0aGlzLl9kcmFpbkluZmxpZ2h0KHRoaXMuaW5mbGlnaHRSZXBvcnRzKVxuXG4gICAgdGhpcy5zaG91bGRTdG9wID0gdHJ1ZVxuICAgIHRoaXMuX3N0b3BIZWFydGJlYXQoKVxuICAgIGlmICh0aGlzLl9yZWNvbm5lY3RUaW1lcikge1xuICAgICAgY2xlYXJUaW1lb3V0KHRoaXMuX3JlY29ubmVjdFRpbWVyKVxuICAgICAgdGhpcy5fcmVjb25uZWN0VGltZXIgPSB1bmRlZmluZWRcbiAgICB9XG4gICAgYXdhaXQgdGhpcy5fdGVybWluYXRlUHJvY2Vzc0NoaWxkcmVuKClcblxuICAgIGF3YWl0IHNodXRkb3duTGlmZWN5Y2xlKHtcbiAgICAgIG9uU3RvcHBlZDogdGhpcy5vblN0b3BwZWQsXG4gICAgICBzaHV0ZG93bjogYXN5bmMgKCkgPT4ge1xuICAgICAgICBpZiAodGhpcy5qc29uU29ja2V0KSB0aGlzLmpzb25Tb2NrZXQuY2xvc2UoKVxuICAgICAgICBpZiAoIXRoaXMuY29uZmlndXJhdGlvbikgcmV0dXJuXG5cbiAgICAgICAgYXdhaXQgdGhpcy5fY2xvc2VDb25maWd1cmF0aW9uKClcbiAgICAgIH1cbiAgICB9KVxuICB9XG5cbiAgLyoqXG4gICAqIENsb3NlcyBhcHBsaWNhdGlvbiByZXNvdXJjZXMgYmVmb3JlIGZyYW1ld29yayByZXNvdXJjZXMgd2hlbiB0aGlzIHdvcmtlciBvd25zIHRoZW0uXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIGFmdGVyIGV2ZXJ5IG93bmVkIGNsb3NlIHN1Y2NlZWRzLlxuICAgKi9cbiAgYXN5bmMgX2Nsb3NlQ29uZmlndXJhdGlvbigpIHtcbiAgICBjb25zdCBjb25maWd1cmF0aW9uID0gdGhpcy5jb25maWd1cmF0aW9uXG5cbiAgICBpZiAoIWNvbmZpZ3VyYXRpb24pIHJldHVyblxuXG4gICAgYXdhaXQgcnVuU2h1dGRvd25TdGVwcyh7XG4gICAgICBtZXNzYWdlOiBcIkJhY2tncm91bmQgam9icyB3b3JrZXIgYXBwbGljYXRpb24gYW5kIGZyYW1ld29yayBzaHV0ZG93biBmYWlsZWRcIixcbiAgICAgIHN0ZXBzOiBbXG4gICAgICAgIC4uLih0aGlzLmNsb3NlRGF0YWJhc2VDb25uZWN0aW9uc09uU3RvcFxuICAgICAgICAgID8gW2FzeW5jICgpID0+IGF3YWl0IGNvbmZpZ3VyYXRpb24uc2h1dGRvd24oKV1cbiAgICAgICAgICA6IFtdKSxcbiAgICAgICAgYXN5bmMgKCkgPT4gYXdhaXQgY29uZmlndXJhdGlvbi5kaXNjb25uZWN0QmVhY29uKCksXG4gICAgICAgIC4uLih0aGlzLmNsb3NlRGF0YWJhc2VDb25uZWN0aW9uc09uU3RvcFxuICAgICAgICAgID8gW2FzeW5jICgpID0+IGF3YWl0IGNvbmZpZ3VyYXRpb24uY2xvc2VEYXRhYmFzZUNvbm5lY3Rpb25zKCldXG4gICAgICAgICAgOiBbXSlcbiAgICAgIF1cbiAgICB9KVxuICB9XG5cbiAgLyoqXG4gICAqIFdhaXRzIGZvciBhIHNldCBvZiBpbi1mbGlnaHQgam9iIHByb21pc2VzIHRvIHNldHRsZSwgb3B0aW9uYWxseSBib3VuZGVkIGJ5XG4gICAqIGB0aW1lb3V0TXNgLlxuICAgKiBAcGFyYW0ge1NldDxQcm9taXNlPHZvaWQ+Pn0gaW5mbGlnaHQgLSBJbi1mbGlnaHQgam9iIHByb21pc2VzLlxuICAgKiBAcGFyYW0ge251bWJlcn0gW3RpbWVvdXRNc10gLSBNYXggd2FpdCBpbiBtczsgdW5ib3VuZGVkIHdoZW4gb21pdHRlZC5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgd2hlbiBzZXR0bGVkIG9yIHRoZSB0aW1lb3V0IGVsYXBzZXMuXG4gICAqL1xuICBhc3luYyBfZHJhaW5JbmZsaWdodChpbmZsaWdodCwgdGltZW91dE1zKSB7XG4gICAgaWYgKGluZmxpZ2h0LnNpemUgPT09IDApIHJldHVyblxuXG4gICAgY29uc3QgZHJhaW4gPSBQcm9taXNlLmFsbFNldHRsZWQoWy4uLmluZmxpZ2h0XSlcblxuICAgIGlmICh0eXBlb2YgdGltZW91dE1zID09PSBcIm51bWJlclwiICYmIHRpbWVvdXRNcyA+PSAwKSB7XG4gICAgICBsZXQgdGltZXJcbiAgICAgIGNvbnN0IHRpbWVvdXQgPSBuZXcgUHJvbWlzZSgocmVzb2x2ZSkgPT4geyB0aW1lciA9IHNldFRpbWVvdXQocmVzb2x2ZSwgdGltZW91dE1zKSB9KVxuXG4gICAgICBhd2FpdCBQcm9taXNlLnJhY2UoW2RyYWluLCB0aW1lb3V0XSlcbiAgICAgIGNsZWFyVGltZW91dCh0aW1lcilcbiAgICB9IGVsc2Uge1xuICAgICAgYXdhaXQgZHJhaW5cbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogVGVybWluYXRlcyBhbnkgcHJvY2VzcyBydW5uZXIgY2hpbGRyZW4gc3RpbGwgYWxpdmUgYWZ0ZXIgdGhlIGRyYWluIHdpbmRvdyBzb1xuICAgKiB0aGV5IGRvbid0IG91dGxpdmUgdGhlIHdvcmtlciBhcyBvcnBoYW5zLiBTSUdURVJNIGxldHMgdGhlIHJ1bm5lciBjbG9zZSBpdHNcbiAgICogY29ubmVjdGlvbnMgY2xlYW5seTsgc3Vydml2b3JzIGFyZSBTSUdLSUxMZWQgYWZ0ZXIgYSBzaG9ydCBncmFjZS5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgb25jZSBzdXJ2aXZvcnMgaGF2ZSBiZWVuIHNpZ25hbGxlZC5cbiAgICovXG4gIGFzeW5jIF90ZXJtaW5hdGVQcm9jZXNzQ2hpbGRyZW4oKSB7XG4gICAgaWYgKHRoaXMuaW5mbGlnaHRQcm9jZXNzQ2hpbGRyZW4uc2l6ZSA9PT0gMCkgcmV0dXJuXG5cbiAgICBmb3IgKGNvbnN0IGNoaWxkIG9mIHRoaXMuaW5mbGlnaHRQcm9jZXNzQ2hpbGRyZW4pIHtcbiAgICAgIGNvbnN0IHBvb2xlZFN0YXRlID0gdGhpcy5wb29sZWRDaGlsZFN0YXRlcy5nZXQoY2hpbGQpXG4gICAgICBpZiAocG9vbGVkU3RhdGUpIHtcbiAgICAgICAgdGhpcy5fcmVxdWVzdFBvb2xlZENoaWxkU2h1dGRvd24oe2NoaWxkLCByZWFzb246IFwid29ya2VyX3N0b3BcIiwgc2lnbmFsOiBcIlNJR1RFUk1cIn0pXG4gICAgICB9IGVsc2Uge1xuICAgICAgICB0cnkge1xuICAgICAgICAgIGNoaWxkLmtpbGwoXCJTSUdURVJNXCIpXG4gICAgICAgIH0gY2F0Y2gge1xuICAgICAgICAgIC8vIENoaWxkIGFscmVhZHkgZXhpdGVkOyBub3RoaW5nIHRvIGRvLlxuICAgICAgICB9XG4gICAgICB9XG4gICAgfVxuXG4gICAgYXdhaXQgbmV3IFByb21pc2UoKHJlc29sdmUpID0+IHNldFRpbWVvdXQocmVzb2x2ZSwgdGhpcy5mb3JrZWRDaGlsZFNpZ2tpbGxHcmFjZU1zKSlcblxuICAgIGZvciAoY29uc3QgY2hpbGQgb2YgdGhpcy5pbmZsaWdodFByb2Nlc3NDaGlsZHJlbikge1xuICAgICAgdHJ5IHtcbiAgICAgICAgY2hpbGQua2lsbChcIlNJR0tJTExcIilcbiAgICAgIH0gY2F0Y2gge1xuICAgICAgICAvLyBDaGlsZCBhbHJlYWR5IGV4aXRlZDsgbm90aGluZyB0byBkby5cbiAgICAgIH1cbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogQ29ubmVjdHMgdG8gdGhlIHdvcmtlcidzIHJlc29sdmVkIGVuZHBvaW50IGFuZCBjb21wbGV0ZXMgaXRzIGhlbGxvIGZlbmNlLlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIFJlY29ubmVjdCBwb2xpY3kuXG4gICAqIEBwYXJhbSB7Ym9vbGVhbn0gYXJncy5hbGxvd1JlY29ubmVjdCAtIFdoZXRoZXIgYSBmYWlsZWQgYXR0ZW1wdCBtYXkgc2NoZWR1bGUgYW5vdGhlciBjb25uZWN0aW9uLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyBhZnRlciBnZW5lcmF0aW9uIGFja25vd2xlZGdlbWVudC5cbiAgICovXG4gIGFzeW5jIF9jb25uZWN0KHthbGxvd1JlY29ubmVjdH0pIHtcbiAgICBjb25zdCBjb25maWd1cmF0aW9uID0gdGhpcy5jb25maWd1cmF0aW9uXG4gICAgaWYgKCFjb25maWd1cmF0aW9uKSB0aHJvdyBuZXcgRXJyb3IoXCJCYWNrZ3JvdW5kIGpvYnMgd29ya2VyIGNvbmZpZ3VyYXRpb24gbm90IGluaXRpYWxpemVkXCIpXG5cbiAgICBjb25zdCBjb25maWcgPSBjb25maWd1cmF0aW9uLmdldEJhY2tncm91bmRKb2JzQ29uZmlnKClcbiAgICBpZiAodGhpcy5nZW5lcmF0aW9uSWQpIHRoaXMuX2dlbmVyYXRpb25BY2NlcHRlZCA9IGZhbHNlXG4gICAgY29uc3QgaG9zdCA9IHRoaXMuaG9zdCB8fCBjb25maWcuaG9zdFxuICAgIGNvbnN0IHBvcnQgPSB0eXBlb2YgdGhpcy5wb3J0ID09PSBcIm51bWJlclwiID8gdGhpcy5wb3J0IDogY29uZmlnLnBvcnRcbiAgICBjb25zdCBzb2NrZXQgPSBuZXQuY3JlYXRlQ29ubmVjdGlvbih7aG9zdCwgcG9ydH0pXG4gICAgc29ja2V0LnNldEtlZXBBbGl2ZSh0cnVlLCBTT0NLRVRfS0VFUEFMSVZFX01TKVxuICAgIGNvbnN0IGpzb25Tb2NrZXQgPSBuZXcgSnNvblNvY2tldChzb2NrZXQpXG4gICAgdGhpcy5qc29uU29ja2V0ID0ganNvblNvY2tldFxuICAgIC8qKlxuICAgICAqIFJlc29sdmVzIHRoZSBnZW5lcmF0aW9uIGhhbmRzaGFrZS5cbiAgICAgKiBAdHlwZSB7KCkgPT4gdm9pZH1cbiAgICAgKi9cbiAgICBsZXQgcmVzb2x2ZUhhbmRzaGFrZSA9ICgpID0+IHt9XG4gICAgLyoqXG4gICAgICogUmVqZWN0cyB0aGUgZ2VuZXJhdGlvbiBoYW5kc2hha2UuXG4gICAgICogQHR5cGUgeyhlcnJvcjogRXJyb3IpID0+IHZvaWR9XG4gICAgICovXG4gICAgbGV0IHJlamVjdEhhbmRzaGFrZSA9ICgpID0+IHt9XG4gICAgbGV0IGNvbm5lY3Rpb25BY2NlcHRlZCA9IGZhbHNlXG4gICAgLyoqIEB0eXBlIHtSZXR1cm5UeXBlPHR5cGVvZiBzZXRUaW1lb3V0PiB8IHVuZGVmaW5lZH0gKi9cbiAgICBsZXQgaGFuZHNoYWtlVGltZXJcbiAgICBjb25zdCBoYW5kc2hha2UgPSBuZXcgUHJvbWlzZSgoLyoqIEB0eXBlIHsodmFsdWU6IHZvaWQpID0+IHZvaWR9ICovIHJlc29sdmUsIHJlamVjdCkgPT4ge1xuICAgICAgcmVzb2x2ZUhhbmRzaGFrZSA9IHJlc29sdmVcbiAgICAgIHJlamVjdEhhbmRzaGFrZSA9IHJlamVjdFxuICAgIH0pXG5cbiAgICAvKipcbiAgICAgKiBIYW5kbGVzIGEgYmFja2dyb3VuZCBqb2Igc29ja2V0IG1lc3NhZ2UuXG4gICAgICogQHBhcmFtIHtpbXBvcnQoXCIuL3R5cGVzLmpzXCIpLkJhY2tncm91bmRKb2JTb2NrZXRNZXNzYWdlfSBtZXNzYWdlIC0gU29ja2V0IG1lc3NhZ2UuXG4gICAgICovXG4gICAganNvblNvY2tldC5vbihcIm1lc3NhZ2VcIiwgYXN5bmMgKG1lc3NhZ2UpID0+IHtcbiAgICAgIGlmIChtZXNzYWdlPy50eXBlID09PSBcImdlbmVyYXRpb24tYWNjZXB0ZWRcIikge1xuICAgICAgICBpZiAoIXRoaXMuZ2VuZXJhdGlvbklkIHx8IG1lc3NhZ2UuZ2VuZXJhdGlvbklkICE9PSB0aGlzLmdlbmVyYXRpb25JZCkge1xuICAgICAgICAgIHJlamVjdEhhbmRzaGFrZShuZXcgRXJyb3IoXCJCYWNrZ3JvdW5kIGpvYnMgbWFpbiBhY2tub3dsZWRnZWQgYSBkaWZmZXJlbnQgZ2VuZXJhdGlvblwiKSlcbiAgICAgICAgICBqc29uU29ja2V0LmRlc3Ryb3koKVxuICAgICAgICAgIHJldHVyblxuICAgICAgICB9XG5cbiAgICAgICAgdGhpcy5fZ2VuZXJhdGlvbkFjY2VwdGVkID0gdHJ1ZVxuICAgICAgICBjb25uZWN0aW9uQWNjZXB0ZWQgPSB0cnVlXG4gICAgICAgIGlmIChoYW5kc2hha2VUaW1lcikge1xuICAgICAgICAgIGNsZWFyVGltZW91dChoYW5kc2hha2VUaW1lcilcbiAgICAgICAgICBoYW5kc2hha2VUaW1lciA9IHVuZGVmaW5lZFxuICAgICAgICB9XG4gICAgICAgIGlmIChtZXNzYWdlLmxpZmVjeWNsZVN0YXRlID09PSBcInJldGlyaW5nXCIgfHwgbWVzc2FnZS5saWZlY3ljbGVTdGF0ZSA9PT0gXCJyZXRpcmVkXCIpIHRoaXMuaXNSZXRpcmluZyA9IHRydWVcbiAgICAgICAgdGhpcy5vbkdlbmVyYXRpb25BY2NlcHRlZD8uKClcbiAgICAgICAgdGhpcy5fc2VuZFJlYWR5SWZSdW5uaW5nKClcbiAgICAgICAgdGhpcy5fc3RhcnRIZWFydGJlYXQoKVxuICAgICAgICByZXNvbHZlSGFuZHNoYWtlKClcbiAgICAgICAgcmV0dXJuXG4gICAgICB9XG5cbiAgICAgIGlmIChtZXNzYWdlPy50eXBlID09PSBcImdlbmVyYXRpb24tcmVqZWN0ZWRcIikge1xuICAgICAgICB0aGlzLnNob3VsZFN0b3AgPSB0cnVlXG4gICAgICAgIGlmIChoYW5kc2hha2VUaW1lcikgY2xlYXJUaW1lb3V0KGhhbmRzaGFrZVRpbWVyKVxuICAgICAgICByZWplY3RIYW5kc2hha2UobmV3IEVycm9yKGBCYWNrZ3JvdW5kIGpvYnMgZ2VuZXJhdGlvbiByZWplY3RlZDogJHttZXNzYWdlLnJlYXNvbn1gKSlcbiAgICAgICAganNvblNvY2tldC5kZXN0cm95KClcbiAgICAgICAgcmV0dXJuXG4gICAgICB9XG5cbiAgICAgIGlmIChtZXNzYWdlPy50eXBlID09PSBcInJldGlyZVwiKSB7XG4gICAgICAgIGlmICh0aGlzLmdlbmVyYXRpb25JZCAmJiBtZXNzYWdlLmdlbmVyYXRpb25JZCA9PT0gdGhpcy5nZW5lcmF0aW9uSWQpIHtcbiAgICAgICAgICB0aGlzLm9uUmV0aXJlTWVzc2FnZT8uKClcbiAgICAgICAgICB0aGlzLl9iZWdpbkdlbmVyYXRpb25SZXRpcmVtZW50KClcbiAgICAgICAgfVxuICAgICAgICByZXR1cm5cbiAgICAgIH1cblxuICAgICAgaWYgKG1lc3NhZ2U/LnR5cGUgPT09IFwiam9iXCIpIHtcbiAgICAgICAgYXdhaXQgdGhpcy5faGFuZGxlSm9iKG1lc3NhZ2UucGF5bG9hZClcbiAgICAgIH1cbiAgICB9KVxuXG4gICAganNvblNvY2tldC5vbihcImVycm9yXCIsIChlcnJvcikgPT4ge1xuICAgICAgY29uc29sZS5lcnJvcihcIkJhY2tncm91bmQgam9icyB3b3JrZXIgc29ja2V0IGVycm9yOlwiLCBlcnJvcilcbiAgICAgIGlmICh0aGlzLmdlbmVyYXRpb25JZCAmJiAhdGhpcy5fZ2VuZXJhdGlvbkFjY2VwdGVkKSByZWplY3RIYW5kc2hha2UoZXJyb3IpXG4gICAgfSlcblxuICAgIGpzb25Tb2NrZXQub24oXCJjbG9zZVwiLCAoKSA9PiB7XG4gICAgICBpZiAoaGFuZHNoYWtlVGltZXIpIGNsZWFyVGltZW91dChoYW5kc2hha2VUaW1lcilcbiAgICAgIHRoaXMuX3N0b3BIZWFydGJlYXQoKVxuICAgICAgaWYgKHRoaXMuanNvblNvY2tldCA9PT0ganNvblNvY2tldCkgdGhpcy5qc29uU29ja2V0ID0gdW5kZWZpbmVkXG4gICAgICBpZiAodGhpcy5nZW5lcmF0aW9uSWQgJiYgIXRoaXMuX2dlbmVyYXRpb25BY2NlcHRlZCkge1xuICAgICAgICByZWplY3RIYW5kc2hha2UobmV3IEVycm9yKFwiQmFja2dyb3VuZCBqb2JzIHNvY2tldCBjbG9zZWQgYmVmb3JlIGdlbmVyYXRpb24gYWNrbm93bGVkZ2VtZW50XCIpKVxuICAgICAgfVxuICAgICAgaWYgKHRoaXMuc2hvdWxkU3RvcCkgcmV0dXJuXG4gICAgICBpZiAoY29ubmVjdGlvbkFjY2VwdGVkIHx8IGFsbG93UmVjb25uZWN0IHx8ICF0aGlzLmdlbmVyYXRpb25JZCkgdGhpcy5fc2NoZWR1bGVSZWNvbm5lY3QoKVxuICAgIH0pXG5cbiAgICBpZiAodGhpcy5nZW5lcmF0aW9uSWQpIHtcbiAgICAgIGhhbmRzaGFrZVRpbWVyID0gc2V0VGltZW91dCgoKSA9PiB7XG4gICAgICAgIGNvbnN0IGVycm9yID0gbmV3IEJhY2tncm91bmRKb2JzR2VuZXJhdGlvbkhhbmRzaGFrZVRpbWVvdXRFcnJvcih7XG4gICAgICAgICAgZW5kcG9pbnQ6IGAke2hvc3R9OiR7cG9ydH1gLFxuICAgICAgICAgIGdlbmVyYXRpb25JZDogdGhpcy5nZW5lcmF0aW9uSWQgfHwgXCJcIixcbiAgICAgICAgICByb2xlOiBcIndvcmtlclwiLFxuICAgICAgICAgIHRpbWVvdXRNczogdGhpcy5nZW5lcmF0aW9uSGFuZHNoYWtlVGltZW91dE1zXG4gICAgICAgIH0pXG4gICAgICAgIHJlamVjdEhhbmRzaGFrZShlcnJvcilcbiAgICAgICAganNvblNvY2tldC5kZXN0cm95KClcbiAgICAgIH0sIHRoaXMuZ2VuZXJhdGlvbkhhbmRzaGFrZVRpbWVvdXRNcylcbiAgICB9XG5cbiAgICBzb2NrZXQub24oXCJjb25uZWN0XCIsICgpID0+IHtcbiAgICAgIGpzb25Tb2NrZXQuc2VuZCh7dHlwZTogXCJoZWxsb1wiLCByb2xlOiBcIndvcmtlclwiLCAuLi4odGhpcy5nZW5lcmF0aW9uSWQgPyB7Z2VuZXJhdGlvbklkOiB0aGlzLmdlbmVyYXRpb25JZH0gOiB7fSksIHN1cHBvcnRzSGFuZG9mZklkUmVwb3J0aW5nOiB0cnVlLCBzdXBwb3J0c0hlYXJ0YmVhdDogdHJ1ZSwgc3VwcG9ydHNQb29sZWQ6IHRydWUsIHdvcmtlcklkOiB0aGlzLndvcmtlcklkfSlcbiAgICAgIGlmICghdGhpcy5nZW5lcmF0aW9uSWQpIHtcbiAgICAgICAgY29ubmVjdGlvbkFjY2VwdGVkID0gdHJ1ZVxuICAgICAgICB0aGlzLl9zZW5kUmVhZHlJZlJ1bm5pbmcoKVxuICAgICAgICB0aGlzLl9zdGFydEhlYXJ0YmVhdCgpXG4gICAgICAgIHJlc29sdmVIYW5kc2hha2UoKVxuICAgICAgfVxuICAgIH0pXG5cbiAgICBpZiAodGhpcy5nZW5lcmF0aW9uSWQpIGF3YWl0IGhhbmRzaGFrZVxuICB9XG5cbiAgLyoqIFNjaGVkdWxlcyBvbmUgZmVuY2VkIHJlY29ubmVjdCB0byB0aGUgd29ya2VyJ3MgdW5jaGFuZ2VkIGVuZHBvaW50LiAqL1xuICBfc2NoZWR1bGVSZWNvbm5lY3QoKSB7XG4gICAgaWYgKHRoaXMuc2hvdWxkU3RvcCB8fCB0aGlzLl9yZWNvbm5lY3RUaW1lcikgcmV0dXJuXG5cbiAgICB0aGlzLl9yZWNvbm5lY3RUaW1lciA9IHNldFRpbWVvdXQoKCkgPT4ge1xuICAgICAgdGhpcy5fcmVjb25uZWN0VGltZXIgPSB1bmRlZmluZWRcbiAgICAgIGlmICh0aGlzLnNob3VsZFN0b3ApIHJldHVyblxuICAgICAgdm9pZCB0aGlzLl9jb25uZWN0KHthbGxvd1JlY29ubmVjdDogdHJ1ZX0pLmNhdGNoKChlcnJvcikgPT4ge1xuICAgICAgICBpZiAoIXRoaXMuc2hvdWxkU3RvcCkgY29uc29sZS5lcnJvcihcIkJhY2tncm91bmQgam9icyB3b3JrZXIgcmVjb25uZWN0IGZhaWxlZDpcIiwgZXJyb3IpXG4gICAgICB9KVxuICAgIH0sIHRoaXMucmVjb25uZWN0RGVsYXlNcylcbiAgICBpZiAodHlwZW9mIHRoaXMuX3JlY29ubmVjdFRpbWVyLnVucmVmID09PSBcImZ1bmN0aW9uXCIpIHRoaXMuX3JlY29ubmVjdFRpbWVyLnVucmVmKClcbiAgfVxuXG4gIC8qKlxuICAgKiBTdXJmYWNlcyBhbiB1bmV4cGVjdGVkIHdvcmtlciBsaWZlY3ljbGUgZmFpbHVyZSB0aHJvdWdoIHRoZSBmcmFtZXdvcmsgZXJyb3JcbiAgICogY2hhbm5lbHMgc28gYSBzdXBlcnZpc29yIGhvb2sgdGhhdCBpZ25vcmVzIHN0ZGlvIHN0aWxsIGhhcyBvYnNlcnZhYmlsaXR5LlxuICAgKiBAcGFyYW0ge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSBlcnJvciAtIFdvcmtlciBsaWZlY3ljbGUgZmFpbHVyZS5cbiAgICovXG4gIF9yZXBvcnRMaWZlY3ljbGVFcnJvcihlcnJvcikge1xuICAgIGNvbnN0IGNvbmZpZ3VyYXRpb24gPSB0aGlzLmNvbmZpZ3VyYXRpb25cbiAgICBpZiAoIWNvbmZpZ3VyYXRpb24pIHJldHVyblxuICAgIGNvbnN0IG5vcm1hbGl6ZWRFcnJvciA9IGVycm9yIGluc3RhbmNlb2YgRXJyb3IgPyBlcnJvciA6IG5ldyBFcnJvcihTdHJpbmcoZXJyb3IpKVxuICAgIGNvbnN0IHBheWxvYWQgPSB7Y29udGV4dDoge2dlbmVyYXRpb25JZDogdGhpcy5nZW5lcmF0aW9uSWQsIHN0YWdlOiBcImJhY2tncm91bmQtam9icy13b3JrZXItbGlmZWN5Y2xlXCJ9LCBlcnJvcjogbm9ybWFsaXplZEVycm9yfVxuICAgIGNvbnN0IGVycm9yRXZlbnRzID0gY29uZmlndXJhdGlvbi5nZXRFcnJvckV2ZW50cygpXG5cbiAgICBlcnJvckV2ZW50cy5lbWl0KFwiZnJhbWV3b3JrLWVycm9yXCIsIHBheWxvYWQpXG4gICAgZXJyb3JFdmVudHMuZW1pdChcImFsbC1lcnJvclwiLCB7Li4ucGF5bG9hZCwgZXJyb3JUeXBlOiBcImZyYW1ld29yay1lcnJvclwifSlcbiAgfVxuXG4gIC8qKlxuICAgKiBTZW5kcyBwZXJpb2RpYyBsaXZlbmVzcyBoZWFydGJlYXRzIHRvIHRoZSBtYWluIHNvIGEgd2VkZ2VkIG9yIHNpbGVudCB3b3JrZXJcbiAgICogY2FuIGJlIGRldGVjdGVkIGFuZCBkcm9wcGVkIHRoZXJlIChpdHMgbGVhc2VzIHJlbGVhc2VkKSBpbnN0ZWFkIG9mIGZyZWV6aW5nXG4gICAqIHRoZSBxdWV1ZSB1bnRpbCBhIGh1bWFuIG5vdGljZXMuXG4gICAqIEByZXR1cm5zIHt2b2lkfVxuICAgKi9cbiAgX3N0YXJ0SGVhcnRiZWF0KCkge1xuICAgIHRoaXMuX3N0b3BIZWFydGJlYXQoKVxuXG4gICAgdGhpcy5faGVhcnRiZWF0VGltZXIgPSBzZXRJbnRlcnZhbCgoKSA9PiB0aGlzLl9zZW5kSGVhcnRiZWF0KCksIHRoaXMuaGVhcnRiZWF0SW50ZXJ2YWxNcylcblxuICAgIGlmICh0eXBlb2YgdGhpcy5faGVhcnRiZWF0VGltZXIudW5yZWYgPT09IFwiZnVuY3Rpb25cIikgdGhpcy5faGVhcnRiZWF0VGltZXIudW5yZWYoKVxuICB9XG5cbiAgLyoqIFNlbmRzIG9uZSBsaXZlbmVzcyBoZWFydGJlYXQgd2hpbGUgdGhlIHdvcmtlciBoYXMgbm90IGZpbmFsbHkgc3RvcHBlZC4gKi9cbiAgX3NlbmRIZWFydGJlYXQoKSB7XG4gICAgaWYgKHRoaXMuc2hvdWxkU3RvcCB8fCAhdGhpcy5qc29uU29ja2V0KSByZXR1cm5cblxuICAgIHRyeSB7XG4gICAgICB0aGlzLmpzb25Tb2NrZXQuc2VuZCh7dHlwZTogXCJoZWFydGJlYXRcIiwgd29ya2VySWQ6IHRoaXMud29ya2VySWR9KVxuICAgIH0gY2F0Y2gge1xuICAgICAgLy8gU29ja2V0IGlzIGNsb3NpbmcvY2xvc2VkOyB0aGUgY2xvc2UgaGFuZGxlciBkcml2ZXMgcmVjb25uZWN0LlxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBTdG9wcyB0aGUgbGl2ZW5lc3MgaGVhcnRiZWF0IHRpbWVyLlxuICAgKiBAcmV0dXJucyB7dm9pZH1cbiAgICovXG4gIF9zdG9wSGVhcnRiZWF0KCkge1xuICAgIGlmICh0aGlzLl9oZWFydGJlYXRUaW1lcikge1xuICAgICAgY2xlYXJJbnRlcnZhbCh0aGlzLl9oZWFydGJlYXRUaW1lcilcbiAgICAgIHRoaXMuX2hlYXJ0YmVhdFRpbWVyID0gdW5kZWZpbmVkXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgaGFuZGxlIGpvYi5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL3R5cGVzLmpzXCIpLkJhY2tncm91bmRKb2JQYXlsb2FkfSBwYXlsb2FkIC0gUGF5bG9hZC5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgd2hlbiBkb25lLlxuICAgKi9cbiAgYXN5bmMgX2hhbmRsZUpvYihwYXlsb2FkKSB7XG4gICAgaWYgKCFwYXlsb2FkLmlkKSB0aHJvdyBuZXcgRXJyb3IoXCJCYWNrZ3JvdW5kIGpvYiBwYXlsb2FkIG1pc3NpbmcgaWRcIilcbiAgICAvKipcbiAgICAgKiBJZGVudGlmaWVkIHBheWxvYWQuXG4gICAgICogQHR5cGUge2ltcG9ydChcIi4vdHlwZXMuanNcIikuQmFja2dyb3VuZEpvYlBheWxvYWQgJiB7aWQ6IHN0cmluZ319ICovXG4gICAgY29uc3QgaWRlbnRpZmllZFBheWxvYWQgPSAvKiogQHR5cGUge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSAqLyAocGF5bG9hZClcblxuICAgIHRoaXMub25Kb2JBY2NlcHRlZD8uKGlkZW50aWZpZWRQYXlsb2FkKVxuXG4gICAgY29uc3QgZXhlY3V0aW9uTW9kZSA9IHRoaXMuX2V4ZWN1dGlvbk1vZGVGb3JQYXlsb2FkKGlkZW50aWZpZWRQYXlsb2FkKVxuXG4gICAgaWYgKGV4ZWN1dGlvbk1vZGUgPT09IFwicG9vbGVkXCIpIHtcbiAgICAgIHRoaXMuX3F1ZXVlUG9vbGVkSm9iKGlkZW50aWZpZWRQYXlsb2FkKVxuICAgICAgcmV0dXJuXG4gICAgfVxuXG4gICAgaWYgKGV4ZWN1dGlvbk1vZGUgIT09IFwiaW5saW5lXCIpIHtcbiAgICAgIHRoaXMuX3RyYWNrUHJvY2Vzc0pvYih0aGlzLl9zdGFydFByb2Nlc3NKb2Ioe2V4ZWN1dGlvbk1vZGUsIHBheWxvYWQ6IGlkZW50aWZpZWRQYXlsb2FkfSkpXG4gICAgICByZXR1cm5cbiAgICB9XG5cbiAgICB0aGlzLl9oYW5kbGVJbmxpbmVKb2IoaWRlbnRpZmllZFBheWxvYWQpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBzdGFydCBwcm9jZXNzIGpvYi5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBPcHRpb25zLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vdHlwZXMuanNcIikuQmFja2dyb3VuZEpvYkV4ZWN1dGlvbk1vZGV9IGFyZ3MuZXhlY3V0aW9uTW9kZSAtIEV4ZWN1dGlvbiBtb2RlLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vdHlwZXMuanNcIikuQmFja2dyb3VuZEpvYlBheWxvYWQgJiB7aWQ6IHN0cmluZ319IGFyZ3MucGF5bG9hZCAtIFBheWxvYWQuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIHdoZW4gdGhlIHByb2Nlc3Mgam9iIGV4aXRzLlxuICAgKi9cbiAgX3N0YXJ0UHJvY2Vzc0pvYih7ZXhlY3V0aW9uTW9kZSwgcGF5bG9hZH0pIHtcbiAgICBpZiAoZXhlY3V0aW9uTW9kZSA9PT0gXCJmb3JrZWRcIikgcmV0dXJuIHRoaXMuX2ZvcmtKb2IocGF5bG9hZClcblxuICAgIHJldHVybiB0aGlzLl9zcGF3bkpvYihwYXlsb2FkKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgaGFuZGxlIGlubGluZSBqb2IuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi90eXBlcy5qc1wiKS5CYWNrZ3JvdW5kSm9iUGF5bG9hZCAmIHtpZDogc3RyaW5nfX0gcGF5bG9hZCAtIFBheWxvYWQuXG4gICAqIEByZXR1cm5zIHt2b2lkfVxuICAgKi9cbiAgX2hhbmRsZUlubGluZUpvYihwYXlsb2FkKSB7XG4gICAgLy8gSW5saW5lIGpvYnMgc2hhcmUgdGhlIHdvcmtlcidzIHByb2Nlc3MgYW5kIERCIHBvb2wsIGJ1dCBlYWNoIG9uZVxuICAgIC8vIGlzIGl0cyBvd24gYXN5bmMgY2hhaW4g4oCUIHRoZXJlJ3Mgbm8gc2VtYW50aWMgcmVhc29uIHRvIHNlcmlhbGl6ZVxuICAgIC8vIHRoZW0uIFdlIGtpY2sgb2ZmIHRoZSBqb2IsIHJlZ2lzdGVyIGl0IHdpdGggYGluZmxpZ2h0SW5saW5lSm9ic2BcbiAgICAvLyBmb3Igc2h1dGRvd24gZHJhaW4sIGFuZCBzaWduYWwgY2FwYWNpdHkgdG8gbWFpbjpcbiAgICAvLyAtIElmIHdlIHN0aWxsIGhhdmUgYSBmcmVlIHNsb3Qgd2UgYXNrIGZvciB0aGUgbmV4dCBqb2IgcmlnaHRcbiAgICAvLyAgIGF3YXksIHNvIGEgc2xvdyBqb2IgKGUuZy4gYSBkb2NrZXIgYWxpdmUgY2hlY2sgdGhhdCB3YWl0cyAxNXNcbiAgICAvLyAgIG9uIGEgZ29uZSBzZXJ2ZXIpIG5vIGxvbmdlciBzdGFydmVzIGV2ZXJ5IG90aGVyIGlubGluZSBqb2IuXG4gICAgLy8gLSBXaGVuIHRoZSBqb2IgZmluaXNoZXMsIGlmIHRoZSB3b3JrZXIgaGFkIGJlZW4gYXQgdGhlIGNhcCwgd2VcbiAgICAvLyAgIGFzayBmb3IgdGhlIG5leHQgam9iIHRvIHJlZmlsbCB0aGUgc2xvdC5cbiAgICAvLyBUaGUgYm9va2tlZXBpbmcgaW4gYGZpbmFsbHkoKWAgcmF0Y2hldHMgY2FwYWNpdHkgYmFjayB1cFxuICAgIC8vIHJlZ2FyZGxlc3Mgb2Ygc3VjY2VzcyBvciBmYWlsdXJlLlxuICAgIC8qKlxuICAgICAqIERlZmluZXMgaW5mbGlnaHQuXG4gICAgICogQHR5cGUge1Byb21pc2U8dm9pZD59ICovXG4gICAgbGV0IGluZmxpZ2h0XG5cbiAgICBpbmZsaWdodCA9IHRoaXMuX3J1bklubGluZUpvYkFuZFJlcG9ydChwYXlsb2FkKS5maW5hbGx5KCgpID0+IHtcbiAgICAgIHRoaXMuaW5mbGlnaHRJbmxpbmVKb2JzLmRlbGV0ZShpbmZsaWdodClcblxuICAgICAgLy8gUmUtYW5ub3VuY2Ugb24gZXZlcnkgY29tcGxldGlvbiBiZWxvdyBjYXAsIG5vdCBqdXN0IHRoZSBjYXDihpJjYXAtMSBlZGdlIOKAlFxuICAgICAgLy8gc2VlIF90cmFja1Byb2Nlc3NKb2IgZm9yIHdoeSB0aGUga25pZmUtZWRnZSBjb25kaXRpb24gc2lsZW50bHkgd2VkZ2VzLlxuICAgICAgaWYgKCF0aGlzLnNob3VsZFN0b3ApIHRoaXMuX3NlbmRSZWFkeUlmUnVubmluZygpXG4gICAgfSlcblxuICAgIHRoaXMuaW5mbGlnaHRJbmxpbmVKb2JzLmFkZChpbmZsaWdodClcblxuICAgIGlmICh0aGlzLmluZmxpZ2h0SW5saW5lSm9icy5zaXplIDwgdGhpcy5tYXhDb25jdXJyZW50SW5saW5lSm9icykge1xuICAgICAgdGhpcy5fc2VuZFJlYWR5SWZSdW5uaW5nKClcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogUnVucyBleGVjdXRpb24gbW9kZSBmb3IgcGF5bG9hZC5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL3R5cGVzLmpzXCIpLkJhY2tncm91bmRKb2JQYXlsb2FkfSBwYXlsb2FkIC0gUGF5bG9hZC5cbiAgICogQHJldHVybnMge2ltcG9ydChcIi4vdHlwZXMuanNcIikuQmFja2dyb3VuZEpvYkV4ZWN1dGlvbk1vZGV9IC0gRXhlY3V0aW9uIG1vZGUuXG4gICAqL1xuICBfZXhlY3V0aW9uTW9kZUZvclBheWxvYWQocGF5bG9hZCkge1xuICAgIGNvbnN0IGV4ZWN1dGlvbk1vZGUgPSBwYXlsb2FkLm9wdGlvbnM/LmV4ZWN1dGlvbk1vZGVcblxuICAgIHJldHVybiBleGVjdXRpb25Nb2RlID8gdGhpcy5fbm9ybWFsaXplRXhlY3V0aW9uTW9kZShleGVjdXRpb25Nb2RlKSA6IFwicG9vbGVkXCJcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIG5vcm1hbGl6ZSBleGVjdXRpb24gbW9kZS5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGV4ZWN1dGlvbk1vZGUgLSBFeGVjdXRpb24gbW9kZS5cbiAgICogQHJldHVybnMge2ltcG9ydChcIi4vdHlwZXMuanNcIikuQmFja2dyb3VuZEpvYkV4ZWN1dGlvbk1vZGV9IC0gTm9ybWFsaXplZCBleGVjdXRpb24gbW9kZS5cbiAgICovXG4gIF9ub3JtYWxpemVFeGVjdXRpb25Nb2RlKGV4ZWN1dGlvbk1vZGUpIHtcbiAgICBmb3IgKGNvbnN0IG1vZGUgb2YgRVhFQ1VUSU9OX01PREVTKSB7XG4gICAgICBpZiAobW9kZSA9PT0gZXhlY3V0aW9uTW9kZSkgcmV0dXJuIG1vZGVcbiAgICB9XG5cbiAgICB0aHJvdyBuZXcgRXJyb3IoYEludmFsaWQgYmFja2dyb3VuZCBqb2IgZXhlY3V0aW9uTW9kZTogJHtleGVjdXRpb25Nb2RlfWApXG4gIH1cblxuICAvKipcbiAgICogUnVucyB0cmFjayBwcm9jZXNzIGpvYi5cbiAgICogQHBhcmFtIHtQcm9taXNlPHZvaWQ+fSBwcm9jZXNzSm9iIC0gUHJvY2VzcyBqb2IgcHJvbWlzZS5cbiAgICogQHJldHVybnMge3ZvaWR9XG4gICAqL1xuICBfdHJhY2tQcm9jZXNzSm9iKHByb2Nlc3NKb2IpIHtcbiAgICAvKipcbiAgICAgKiBEZWZpbmVzIGluZmxpZ2h0LlxuICAgICAqIEB0eXBlIHtQcm9taXNlPHZvaWQ+fSAqL1xuICAgIGxldCBpbmZsaWdodFxuXG4gICAgaW5mbGlnaHQgPSBwcm9jZXNzSm9iLmZpbmFsbHkoKCkgPT4ge1xuICAgICAgdGhpcy5pbmZsaWdodFByb2Nlc3NKb2JzLmRlbGV0ZShpbmZsaWdodClcblxuICAgICAgLy8gUmUtYW5ub3VuY2UgcmVhZGluZXNzIG9uIEVWRVJZIGNvbXBsZXRpb24gdGhhdCBsZWF2ZXMgdXMgYmVsb3cgY2FwIOKAlCBub3RcbiAgICAgIC8vIGp1c3QgdGhlIHNpbmdsZSBjYXDihpJjYXAtMSBlZGdlLiBUaGUgbWFpbiByZW1vdmVzIGEgd29ya2VyIGZyb20gaXRzIHJlYWR5XG4gICAgICAvLyBzZXQgb24gZWFjaCBkaXNwYXRjaCAoYF9kcmFpbk9uY2VgKSBhbmQgb25seSByZS1hZGRzIGl0IG9uIGEgZnJlc2hcbiAgICAgIC8vIFwicmVhZHlcIjsgZ2F0aW5nIHRoZSByZS1hbm5vdW5jZSBvbiBvbmUga25pZmUtZWRnZSB0cmFuc2l0aW9uIG1lYW5zIGFcbiAgICAgIC8vIHNpbmdsZSBtaXNzZWQgb3IgbG9zdCBzaWduYWwgbGVhdmVzIHRoZSB3b3JrZXIgb3V0IG9mIHRoZSByZWFkeSBzZXQgYW5kXG4gICAgICAvLyB3ZWRnZXMgZGlzcGF0Y2ggY2x1c3Rlci13aWRlLiBUaGlzIHdhcyB0aGUgc2lsZW50LWZyZWV6ZSByb290IGNhdXNlLlxuICAgICAgLy8gYF9zZW5kUmVhZHlJZlJ1bm5pbmdgIHNlbGYtZ3VhcmRzIChpdCBzZW5kcyBub3RoaW5nIHdoZW4gdGhlIHdvcmtlciBpc1xuICAgICAgLy8gZ2VudWluZWx5IGF0IGNhcGFjaXR5KSwgc28gcmUtYW5ub3VuY2luZyBvbiBldmVyeSBmcmVlZCBzbG90IGlzIHNhZmUgYW5kXG4gICAgICAvLyBpZGVtcG90ZW50IG9uIHRoZSBtYWluLlxuICAgICAgaWYgKCF0aGlzLnNob3VsZFN0b3ApIHRoaXMuX3NlbmRSZWFkeUlmUnVubmluZygpXG4gICAgfSlcblxuICAgIHRoaXMuaW5mbGlnaHRQcm9jZXNzSm9icy5hZGQoaW5mbGlnaHQpXG4gICAgdGhpcy5fc2VuZFJlYWR5SWZSdW5uaW5nKClcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHJ1biBpbmxpbmUgam9iIGFuZCByZXBvcnQuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi90eXBlcy5qc1wiKS5CYWNrZ3JvdW5kSm9iUGF5bG9hZCAmIHtpZDogc3RyaW5nfX0gcGF5bG9hZCAtIFBheWxvYWQgd2l0aCByZXF1aXJlZCBpZC5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgd2hlbiBjb21wbGV0ZSAoc3VjY2VzcyBvciBmYWlsdXJlIHJlcG9ydGVkKS5cbiAgICovXG4gIGFzeW5jIF9ydW5JbmxpbmVKb2JBbmRSZXBvcnQocGF5bG9hZCkge1xuICAgIC8vIFJlcG9ydCBpbiB0aGUgYmFja2dyb3VuZCBzbyBmcmVlaW5nIHRoaXMgaW5saW5lIHNsb3QgbmV2ZXIgd2FpdHMgb24gdGhlXG4gICAgLy8gcmVwb3J0LiBSZXBvcnRpbmcgaXMgZHVyYWJsZSAocmV0cmllZCB1bnRpbCBpdCBsYW5kcyksIHNvIGEgdHJhbnNpZW50XG4gICAgLy8gbWFpbi9EQiBvdXRhZ2UgbmVpdGhlciB3ZWRnZXMgdGhlIHNsb3Qgbm9yIGxvc2VzIHRoZSB0ZXJtaW5hbCByZXN1bHQuXG4gICAgdHJ5IHtcbiAgICAgIGF3YWl0IHRoaXMuX3J1bkpvYklubGluZShwYXlsb2FkKVxuICAgICAgdGhpcy5fcmVwb3J0Sm9iUmVzdWx0SW5CYWNrZ3JvdW5kKHtcbiAgICAgICAgam9iSWQ6IHBheWxvYWQuaWQsXG4gICAgICAgIHN0YXR1czogXCJjb21wbGV0ZWRcIixcbiAgICAgICAgaGFuZG9mZklkOiBwYXlsb2FkLmhhbmRvZmZJZCxcbiAgICAgICAgaGFuZGVkT2ZmQXRNczogcGF5bG9hZC5oYW5kZWRPZmZBdE1zLFxuICAgICAgICB3b3JrZXJJZDogcGF5bG9hZC53b3JrZXJJZCB8fCB0aGlzLndvcmtlcklkXG4gICAgICB9KVxuICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICBpZiAoZXJyb3IgaW5zdGFuY2VvZiBCYWNrZ3JvdW5kSm9iUmVzY2hlZHVsZVNpZ25hbCkge1xuICAgICAgICB0aGlzLl9yZXBvcnRKb2JSZXN1bHRJbkJhY2tncm91bmQoe1xuICAgICAgICAgIGpvYklkOiBwYXlsb2FkLmlkLFxuICAgICAgICAgIHN0YXR1czogXCJyZXNjaGVkdWxlZFwiLFxuICAgICAgICAgIGRlbGF5TXM6IGVycm9yLmRlbGF5TXMsXG4gICAgICAgICAgaGFuZG9mZklkOiBwYXlsb2FkLmhhbmRvZmZJZCxcbiAgICAgICAgICBoYW5kZWRPZmZBdE1zOiBwYXlsb2FkLmhhbmRlZE9mZkF0TXMsXG4gICAgICAgICAgd29ya2VySWQ6IHBheWxvYWQud29ya2VySWQgfHwgdGhpcy53b3JrZXJJZFxuICAgICAgICB9KVxuICAgICAgICByZXR1cm5cbiAgICAgIH1cblxuICAgICAgdGhpcy5fcmVwb3J0Sm9iUmVzdWx0SW5CYWNrZ3JvdW5kKHtcbiAgICAgICAgam9iSWQ6IHBheWxvYWQuaWQsXG4gICAgICAgIHN0YXR1czogXCJmYWlsZWRcIixcbiAgICAgICAgZXJyb3IsXG4gICAgICAgIGhhbmRvZmZJZDogcGF5bG9hZC5oYW5kb2ZmSWQsXG4gICAgICAgIGhhbmRlZE9mZkF0TXM6IHBheWxvYWQuaGFuZGVkT2ZmQXRNcyxcbiAgICAgICAgd29ya2VySWQ6IHBheWxvYWQud29ya2VySWQgfHwgdGhpcy53b3JrZXJJZFxuICAgICAgfSlcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogQWR2ZXJ0aXNlcyBjdXJyZW50IHdvcmtlciBjYXBhY2l0eSB1bmxlc3MgdGhlIHdvcmtlciBpcyBkcmFpbmluZy5cbiAgICogQHBhcmFtIHtvYmplY3R9IFtvcHRpb25zXSAtIEFkdmVydGlzZW1lbnQgb3B0aW9ucy5cbiAgICogQHBhcmFtIHtib29sZWFufSBbb3B0aW9ucy5yZXZva2VQb29sZWRBZG1pc3Npb25dIC0gUmV2b2tlIHBvb2xlZCBjcmVkaXRzIHdoaWxlIHByZXNlcnZpbmcgb3RoZXIgZXhlY3V0aW9uIG1vZGVzLlxuICAgKiBAcmV0dXJucyB7dm9pZH1cbiAgICovXG4gIF9zZW5kUmVhZHlJZlJ1bm5pbmcoe3Jldm9rZVBvb2xlZEFkbWlzc2lvbiA9IGZhbHNlfSA9IHt9KSB7XG4gICAgaWYgKHRoaXMuc2hvdWxkU3RvcCB8fCB0aGlzLmlzUmV0aXJpbmcpIHJldHVyblxuICAgIGlmICghdGhpcy5qc29uU29ja2V0KSByZXR1cm5cbiAgICBpZiAodGhpcy5nZW5lcmF0aW9uSWQgJiYgIXRoaXMuX2dlbmVyYXRpb25BY2NlcHRlZCkgcmV0dXJuXG5cbiAgICBjb25zdCByZWFkeU1lc3NhZ2UgPSB0aGlzLl9yZWFkeU1lc3NhZ2Uoe3Jldm9rZVBvb2xlZEFkbWlzc2lvbn0pXG5cbiAgICBpZiAoIXJlYWR5TWVzc2FnZSkgcmV0dXJuXG4gICAgdGhpcy5qc29uU29ja2V0LnNlbmQocmVhZHlNZXNzYWdlKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgcmVhZHkgbWVzc2FnZS5cbiAgICogQHBhcmFtIHtvYmplY3R9IFtvcHRpb25zXSAtIEFkdmVydGlzZW1lbnQgb3B0aW9ucy5cbiAgICogQHBhcmFtIHtib29sZWFufSBbb3B0aW9ucy5yZXZva2VQb29sZWRBZG1pc3Npb25dIC0gUmV2b2tlIHBvb2xlZCBjcmVkaXRzIHdoaWxlIHByZXNlcnZpbmcgb3RoZXIgZXhlY3V0aW9uIG1vZGVzLlxuICAgKiBAcmV0dXJucyB7aW1wb3J0KFwiLi90eXBlcy5qc1wiKS5CYWNrZ3JvdW5kSm9iU29ja2V0TWVzc2FnZSB8IG51bGx9IC0gUmVhZHkgbWVzc2FnZSBvciBudWxsIHdoZW4gdGhlIHdvcmtlciBoYXMgbm8gY2FwYWNpdHkuXG4gICAqL1xuICBfcmVhZHlNZXNzYWdlKHtyZXZva2VQb29sZWRBZG1pc3Npb24gPSBmYWxzZX0gPSB7fSkge1xuICAgIGNvbnN0IGFjY2VwdHNQcm9jZXNzSm9iID0gdGhpcy5pbmZsaWdodFByb2Nlc3NKb2JzLnNpemUgPCB0aGlzLm1heENvbmN1cnJlbnRGb3JrZWRKb2JzXG4gICAgY29uc3QgYWNjZXB0c0lubGluZSA9IHRoaXMuaW5mbGlnaHRJbmxpbmVKb2JzLnNpemUgPCB0aGlzLm1heENvbmN1cnJlbnRJbmxpbmVKb2JzXG4gICAgY29uc3QgYXZhaWxhYmxlUG9vbGVkU2xvdHMgPSByZXZva2VQb29sZWRBZG1pc3Npb24gPyAwIDogdGhpcy5fYXZhaWxhYmxlUG9vbGVkU2xvdHMoKVxuICAgIGNvbnN0IGFjY2VwdHNQb29sZWQgPSBhdmFpbGFibGVQb29sZWRTbG90cyA+IDBcblxuICAgIGlmICghcmV2b2tlUG9vbGVkQWRtaXNzaW9uICYmICFhY2NlcHRzUHJvY2Vzc0pvYiAmJiAhYWNjZXB0c0lubGluZSAmJiAhYWNjZXB0c1Bvb2xlZCkgcmV0dXJuIG51bGxcblxuICAgIHJldHVybiB7XG4gICAgICB0eXBlOiBcInJlYWR5XCIsXG4gICAgICBhY2NlcHRzRm9ya2VkOiBhY2NlcHRzUHJvY2Vzc0pvYixcbiAgICAgIGFjY2VwdHNJbmxpbmUsXG4gICAgICBhY2NlcHRzUG9vbGVkLFxuICAgICAgYXZhaWxhYmxlUG9vbGVkU2xvdHMsXG4gICAgICBhY2NlcHRzU3Bhd25lZDogYWNjZXB0c1Byb2Nlc3NKb2JcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogVHJhY2tzIGEgcG9vbGVkIGpvYiBhbmQgcmUtYWR2ZXJ0aXNlcyBjYXBhY2l0eS5cbiAgICogQHBhcmFtIHtQcm9taXNlPHZvaWQ+fSBwb29sZWRKb2IgLSBQb29sZWQgam9iIHByb21pc2UuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFRoZSB0cmFja2VkIGluLWZsaWdodCBwcm9taXNlLlxuICAgKi9cbiAgX3RyYWNrUG9vbGVkSm9iKHBvb2xlZEpvYikge1xuICAgIC8qKiBAdHlwZSB7UHJvbWlzZTx2b2lkPn0gKi9cbiAgICBsZXQgaW5mbGlnaHRcbiAgICBpbmZsaWdodCA9IHBvb2xlZEpvYi5maW5hbGx5KCgpID0+IHtcbiAgICAgIHRoaXMuaW5mbGlnaHRQb29sZWRKb2JzLmRlbGV0ZShpbmZsaWdodClcbiAgICAgIGlmICghdGhpcy5zaG91bGRTdG9wICYmICF0aGlzLl9wb29sZWRTdGFydHVwRmFpbHVyZUpvYnMuaGFzKHBvb2xlZEpvYikgJiYgIXRoaXMuX3Bvb2xlZFN0YXJ0dXBGYWlsdXJlSm9icy5oYXMoaW5mbGlnaHQpKSB0aGlzLl9zZW5kUmVhZHlJZlJ1bm5pbmcoKVxuICAgIH0pXG4gICAgdGhpcy5pbmZsaWdodFBvb2xlZEpvYnMuYWRkKGluZmxpZ2h0KVxuICAgIHJldHVybiBpbmZsaWdodFxuICB9XG5cbiAgLyoqXG4gICAqIFNlcmlhbGl6ZXMgcmVwZWF0ZWQgbGVhc2VzIGZvciBvbmUgZHVyYWJsZSByb3cgd2hpbGUgcHJlc2VydmluZyBwb29sZWRcbiAgICogY29uY3VycmVuY3kgYWNyb3NzIGRpZmZlcmVudCBqb2IgaWRzLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vdHlwZXMuanNcIikuQmFja2dyb3VuZEpvYlBheWxvYWQgJiB7aWQ6IHN0cmluZ319IHBheWxvYWQgLSBQb29sZWQgam9iIHBheWxvYWQuXG4gICAqIEByZXR1cm5zIHt2b2lkfVxuICAgKi9cbiAgX3F1ZXVlUG9vbGVkSm9iKHBheWxvYWQpIHtcbiAgICBjb25zdCBxdWV1ZSA9IHRoaXMucG9vbGVkSm9iUXVldWVzLmdldChwYXlsb2FkLmlkKVxuICAgIGlmIChxdWV1ZSkge1xuICAgICAgcXVldWUucHVzaChwYXlsb2FkKVxuICAgICAgcmV0dXJuXG4gICAgfVxuXG4gICAgdGhpcy5wb29sZWRKb2JRdWV1ZXMuc2V0KHBheWxvYWQuaWQsIFtwYXlsb2FkXSlcbiAgICBjb25zdCB0cmFja2VyID0gdGhpcy5fdHJhY2tQb29sZWRKb2IodGhpcy5fcnVuUG9vbGVkSm9iUXVldWUocGF5bG9hZC5pZCkpXG4gICAgdGhpcy5wb29sZWRKb2JRdWV1ZVRyYWNrZXJzLnNldChwYXlsb2FkLmlkLCB0cmFja2VyKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgYWRtaXR0ZWQgbGVhc2VzIGZvciBvbmUgZHVyYWJsZSBqb2IgaWQgaW4gYXJyaXZhbCBvcmRlci5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGpvYklkIC0gRHVyYWJsZSBqb2IgaWQuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIGFmdGVyIHRoZSBwZXItaWQgcXVldWUgZHJhaW5zLlxuICAgKi9cbiAgYXN5bmMgX3J1blBvb2xlZEpvYlF1ZXVlKGpvYklkKSB7XG4gICAgY29uc3QgcXVldWUgPSB0aGlzLnBvb2xlZEpvYlF1ZXVlcy5nZXQoam9iSWQpXG4gICAgaWYgKCFxdWV1ZSkgdGhyb3cgbmV3IEVycm9yKGBQb29sZWQgam9iIHF1ZXVlIG1pc3NpbmcgZm9yIGpvYjogJHtqb2JJZH1gKVxuXG4gICAgdHJ5IHtcbiAgICAgIHdoaWxlIChxdWV1ZS5sZW5ndGggPiAwKSB7XG4gICAgICAgIGNvbnN0IHBheWxvYWQgPSBxdWV1ZS5zaGlmdCgpXG4gICAgICAgIGlmICghcGF5bG9hZCkgdGhyb3cgbmV3IEVycm9yKGBQb29sZWQgam9iIHF1ZXVlIGNvbnRhaW5lZCBhbiBlbXB0eSBwYXlsb2FkIGZvciBqb2I6ICR7am9iSWR9YClcbiAgICAgICAgYXdhaXQgdGhpcy5fcnVuUG9vbGVkSm9iKHBheWxvYWQpXG4gICAgICB9XG4gICAgfSBmaW5hbGx5IHtcbiAgICAgIGNvbnN0IHRyYWNrZXIgPSB0aGlzLnBvb2xlZEpvYlF1ZXVlVHJhY2tlcnMuZ2V0KGpvYklkKVxuICAgICAgaWYgKHRyYWNrZXIpIHtcbiAgICAgICAgdGhpcy5pbmZsaWdodFBvb2xlZEpvYnMuZGVsZXRlKHRyYWNrZXIpXG4gICAgICAgIHRoaXMucG9vbGVkSm9iUXVldWVUcmFja2Vycy5kZWxldGUoam9iSWQpXG4gICAgICB9XG4gICAgICB0aGlzLnBvb2xlZEpvYlF1ZXVlcy5kZWxldGUoam9iSWQpXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIEhhcmQgY2FwIG9uIHRvdGFsIGxpdmUgcG9vbGVkIGNoaWxkcmVuICh3b3JraW5nICsgZHJhaW5pbmcpOiBjaGlsZHJlbiB0aGVcbiAgICogcG9vbCBtYXkgc3RpbGwgc3Bhd24uIENvdW50aW5nIHRoZSB3aG9sZSBsaXZlIHNldCDigJQgZHJhaW5pbmcgY2hpbGRyZW5cbiAgICogaW5jbHVkZWQg4oCUIGlzIHdoYXQgYm91bmRzIHBvb2wgbWVtb3J5OiBhIGRyYWluaW5nIGNoaWxkIHN0aWxsIGhvbGRzIGl0c1xuICAgKiBSU1MgdW50aWwgaXRzIGxhc3QgaW4tZmxpZ2h0IGpvYiBmaW5pc2hlcywgc28gaXQgbXVzdCBvY2N1cHkgYSBjYXAgc2xvdC5cbiAgICogQHJldHVybnMge251bWJlcn0gLSBOdW1iZXIgb2YgY2hpbGRyZW4gdGhlIHBvb2wgbWF5IHN0aWxsIHNwYXduLlxuICAgKi9cbiAgX3NwYXduYWJsZVBvb2xlZENoaWxkcmVuKCkge1xuICAgIHJldHVybiBNYXRoLm1heCgwLCB0aGlzLnBvb2xlZFJ1bm5lckNvdW50IC0gdGhpcy5wb29sZWRDaGlsZHJlbi5zaXplKVxuICB9XG5cbiAgLyoqXG4gICAqIENvdW50cyBsaXZlIGNoaWxkcmVuIHN0aWxsIGFibGUgdG8gcnVuIG5ldyB3b3JrLiBUaGUgcG9vbCBtdXN0IGFsd2F5c1xuICAgKiBrZWVwIOKAlCBvciByZXN0b3JlLCB0aHJvdWdoIHRoZSBib3VuZGVkIG92ZXItY2FwIGxpdmVuZXNzIHJlcGxhY2VtZW50IOKAlCBhdFxuICAgKiBsZWFzdCBvbmUgbm9uLXJldGlyaW5nIGNoaWxkOiB3aXRoIGV2ZXJ5IGxpdmUgY2hpbGQgcmV0aXJpbmcsIGFkdmVydGlzZWRcbiAgICogY2FwYWNpdHkgaXMgemVybyBmb3IgdGhlIGVudGlyZSBkcmFpbiB3aW5kb3csIHdoaWNoIGNhbiBzdHJldGNoIHRvIHRoZVxuICAgKiBsb25nZXN0IGluLWZsaWdodCBqb2IsIGFuZCBkaXNwYXRjaCBzaWxlbnRseSBzdGFsbHMuXG4gICAqIEByZXR1cm5zIHtudW1iZXJ9IC0gTnVtYmVyIG9mIG5vbi1yZXRpcmluZyBwb29sZWQgY2hpbGRyZW4uXG4gICAqL1xuICBfbm9uUmV0aXJpbmdQb29sZWRDaGlsZENvdW50KCkge1xuICAgIGxldCBjb3VudCA9IDBcblxuICAgIGZvciAoY29uc3Qgc3RhdGUgb2YgdGhpcy5wb29sZWRDaGlsZFN0YXRlcy52YWx1ZXMoKSkge1xuICAgICAgaWYgKCFzdGF0ZS5yZXRpcmluZykgY291bnQgKz0gMVxuICAgIH1cblxuICAgIHJldHVybiBjb3VudFxuICB9XG5cbiAgLyoqXG4gICAqIFJlc29sdmVzIG9uY2UgYSBub24tcmV0aXJpbmcgcG9vbGVkIGNoaWxkIGhhcyBhIGZyZWUgY29uY3VycmVuY3kgc2xvdCBvciB0aGVcbiAgICogcG9vbCBtYXkgc3Bhd24gYSBuZXcgb25lLiBQb29sZWQgam9icyBhZG1pdHRlZCB3aGlsZSB0aGUgcG9vbCBpcyBhdCBpdHNcbiAgICogaGFyZCBjYXAgd2FpdCBoZXJlIGluc3RlYWQgb2Ygc3Bhd25pbmcgYW4gb3Zlci1jYXBhY2l0eSBjaGlsZDsgdGhlIHdha2VcbiAgICogcG9pbnRzIGFyZSB0aGUgb25seSBjYXBhY2l0eS1mcmVlaW5nIHRyYW5zaXRpb25zIChhIGpvYiBvdXRjb21lIGFuZCBhIGNoaWxkXG4gICAqIGV4aXQpLCBzbyBubyBwb2xsaW5nIGlzIG5lZWRlZC5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgd2hlbiBhIHNsb3QgaXMgYXZhaWxhYmxlLlxuICAgKi9cbiAgX3dhaXRQb29sZWRTbG90KCkge1xuICAgIHRoaXMuX3N0YXJ0UG9vbGVkU2xvdFdhaXRQb2xsKClcblxuICAgIHJldHVybiBuZXcgUHJvbWlzZSgocmVzb2x2ZSkgPT4ge1xuICAgICAgY29uc3Qgd2FpdGVyID0gKCkgPT4ge1xuICAgICAgICB0aGlzLl9wb29sZWRTbG90V2FpdGVycy5kZWxldGUod2FpdGVyKVxuICAgICAgICB0aGlzLl9zdG9wUG9vbGVkU2xvdFdhaXRQb2xsSWZJZGxlKClcbiAgICAgICAgcmVzb2x2ZSgpXG4gICAgICB9XG5cbiAgICAgIHRoaXMuX3Bvb2xlZFNsb3RXYWl0ZXJzLmFkZCh3YWl0ZXIpXG4gICAgfSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSZXNvbHZlcyBldmVyeSByZWdpc3RlcmVkIHdhaXRlcjsgd2FpdGVycyByZS1jaGVjayB0aGUgc2xvdCBjb25kaXRpb25cbiAgICogdGhlbXNlbHZlcyBhbmQgb25seSBwcm9jZWVkIHdoZW4gaXQgaG9sZHMuXG4gICAqIEByZXR1cm5zIHt2b2lkfVxuICAgKi9cbiAgX3dha2VQb29sZWRTbG90V2FpdGVycygpIHtcbiAgICBpZiAodGhpcy5fcG9vbGVkU2xvdFdhaXRlcnMuc2l6ZSA9PT0gMCkgcmV0dXJuXG5cbiAgICBmb3IgKGNvbnN0IHJlc29sdmUgb2YgWy4uLnRoaXMuX3Bvb2xlZFNsb3RXYWl0ZXJzXSkgcmVzb2x2ZSgpXG4gIH1cblxuICAvKipcbiAgICogRnJlZSBwb29sZWQgc2xvdHMgYWNyb3NzIHRoZSBwb29sOiBvcGVuIHNsb3RzIGluIG5vbi1yZXRpcmluZyBjaGlsZHJlbiBwbHVzXG4gICAqIHRoZSBzbG90cyB3ZSBjb3VsZCBhZGQgYnkgc3Bhd25pbmcgbW9yZSBjaGlsZHJlbiB1cCB0byB0aGUgaGFyZCBjYXAgb24gdG90YWxcbiAgICogbGl2ZSBjaGlsZHJlbi4gUmV0aXJpbmcgY2hpbGRyZW4gKGRyYWluaW5nIGJlZm9yZSByZXBsYWNlbWVudCkgbmV2ZXJcbiAgICogY29udHJpYnV0ZSBjYXBhY2l0eSwgYW5kIHRoZXkgY291bnQgYWdhaW5zdCB0aGUgY2FwOiB3aGlsZSBvbmUgaXMgc3RpbGxcbiAgICogZHJhaW5pbmcsIG5vIHJlcGxhY2VtZW50IGlzIGFkdmVydGlzZWQgKG9yIHNwYXduZWQpIOKAlCB0aGUgcG9vbCBhZHZlcnRpc2VzXG4gICAqIGV4YWN0bHkgd2hhdCBpdCBjYW4gc2VydmUgaW5zdGVhZCBvZiBwaGFudG9tIGNhcGFjaXR5LlxuICAgKiBAcmV0dXJucyB7bnVtYmVyfSAtIE51bWJlciBvZiBwb29sZWQgam9icyB0aGUgd29ya2VyIGNhbiBhY2NlcHQgcmlnaHQgbm93LlxuICAgKi9cbiAgX2F2YWlsYWJsZVBvb2xlZFNsb3RzKCkge1xuICAgIGxldCBvcGVuSW5FeGlzdGluZyA9IDBcbiAgICBsZXQgcXVldWVkUmVzZXJ2YXRpb25zID0gMFxuXG4gICAgZm9yIChjb25zdCBjaGlsZCBvZiB0aGlzLnBvb2xlZENoaWxkcmVuKSB7XG4gICAgICBjb25zdCBzdGF0ZSA9IHRoaXMucG9vbGVkQ2hpbGRTdGF0ZXMuZ2V0KGNoaWxkKVxuICAgICAgaWYgKCFzdGF0ZSB8fCBzdGF0ZS5yZXRpcmluZykgY29udGludWVcbiAgICAgIG9wZW5JbkV4aXN0aW5nICs9IHRoaXMucG9vbGVkUnVubmVyQ29uY3VycmVuY3kgLSBzdGF0ZS5pbmZsaWdodC5zaXplXG4gICAgfVxuXG4gICAgZm9yIChjb25zdCBxdWV1ZSBvZiB0aGlzLnBvb2xlZEpvYlF1ZXVlcy52YWx1ZXMoKSkgcXVldWVkUmVzZXJ2YXRpb25zICs9IHF1ZXVlLmxlbmd0aFxuXG4gICAgY29uc3Qgc3Bhd25hYmxlQ2hpbGRyZW4gPSBNYXRoLm1heCgwLCB0aGlzLnBvb2xlZFJ1bm5lckNvdW50IC0gdGhpcy5wb29sZWRDaGlsZHJlbi5zaXplKVxuXG4gICAgcmV0dXJuIE1hdGgubWF4KDAsIG9wZW5JbkV4aXN0aW5nICsgc3Bhd25hYmxlQ2hpbGRyZW4gKiB0aGlzLnBvb2xlZFJ1bm5lckNvbmN1cnJlbmN5IC0gcXVldWVkUmVzZXJ2YXRpb25zKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgYSBwYXlsb2FkIG9uIGEgcG9vbGVkIGNoaWxkIHdpdGggYSBmcmVlIGNvbmN1cnJlbmN5IHNsb3QsIHNwYXduaW5nIGFcbiAgICogbmV3IGNoaWxkIHdoZW4gZXZlcnkgbm9uLXJldGlyaW5nIGNoaWxkIGlzIGZ1bGwgYW5kIHRoZSBwb29sIGlzIGJlbG93XG4gICAqIGBwb29sZWRSdW5uZXJDb3VudGAuIEVhY2ggY2hpbGQgcnVucyB1cCB0byBgcG9vbGVkUnVubmVyQ29uY3VycmVuY3lgIGpvYnMgYXRcbiAgICogb25jZSBvbiBpdHMgb3duIGV2ZW50IGxvb3AuXG4gICAqXG4gICAqIFdoZW4gdGhlIHBvb2wgaXMgYWxyZWFkeSBhdCBpdHMgaGFyZCBjYXAgKHRvdGFsIGxpdmUgY2hpbGRyZW4sIGRyYWluaW5nXG4gICAqIGluY2x1ZGVkKSwgdGhlIGpvYiB3YWl0cyBmb3IgYSBzbG90IGluc3RlYWQgb2Ygc3Bhd25pbmc6IHRoYXQgaXMgd2hhdCBrZWVwc1xuICAgKiB0aGUgbGl2ZS1jaGlsZCBjb3VudCDigJQgYW5kIHRoZXJlZm9yZSB0aGUgcG9vbCdzIHRvdGFsIFJTUyDigJQgYm91bmRlZC4gVGhlXG4gICAqIHdhaXQgcmVzb2x2ZXMgb24gdGhlIG9ubHkgdHdvIGNhcGFjaXR5LWZyZWVpbmcgdHJhbnNpdGlvbnMgKGEgam9iIG91dGNvbWUsXG4gICAqIGEgY2hpbGQgZXhpdCk7IGEgc2FmZXR5IHBvbGwgY292ZXJzIGFueXRoaW5nIG1pc3NlZC5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL3R5cGVzLmpzXCIpLkJhY2tncm91bmRKb2JQYXlsb2FkICYge2lkOiBzdHJpbmd9fSBwYXlsb2FkIC0gSm9iIHBheWxvYWQuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIGFmdGVyIHRoZSBkdXJhYmxlIHJlcG9ydC5cbiAgICovXG4gIGFzeW5jIF9ydW5Qb29sZWRKb2IocGF5bG9hZCkge1xuICAgIC8vIEF0IHRoZSBoYXJkIGNhcCAobm8gZnJlZSBzbG90LCBubyBzcGF3bmFibGUgY2hpbGQpIHRoZSBqb2Igd2FpdHMgZm9yIGFcbiAgICAvLyBzbG90IGluc3RlYWQgb2Ygc3Bhd25pbmcgYW4gb3Zlci1jYXBhY2l0eSBjaGlsZCDigJQgdGhhdCBpcyB3aGF0IGJvdW5kc1xuICAgIC8vIHRoZSBsaXZlLWNoaWxkIGNvdW50IGFuZCB0aGUgcG9vbCdzIHRvdGFsIFJTUy5cbiAgICBsZXQgY2hpbGQgPSB0aGlzLl9zZWxlY3RQb29sZWRDaGlsZCgpXG4gICAgd2hpbGUgKCFjaGlsZCkge1xuICAgICAgaWYgKHRoaXMuX3NwYXduYWJsZVBvb2xlZENoaWxkcmVuKCkgPT09IDApIHtcbiAgICAgICAgLy8gU2h1dGRvd246IG1haW4gbm8gbG9uZ2VyIGRpc3BhdGNoZXMgYW5kIG5vIHNsb3Qgd2lsbCBldmVyIGZyZWUg4oCUXG4gICAgICAgIC8vIHN0b3Agd2FpdGluZyBzbyB0aGUgdHJhY2tlZCBqb2IgY2FuIHNldHRsZSBhbmQgdGhlIGRyYWluIGNvbXBsZXRlcy5cbiAgICAgICAgaWYgKHRoaXMuc2hvdWxkU3RvcCkgcmV0dXJuXG4gICAgICAgIGF3YWl0IHRoaXMuX3dhaXRQb29sZWRTbG90KClcbiAgICAgICAgY2hpbGQgPSB0aGlzLl9zZWxlY3RQb29sZWRDaGlsZCgpXG4gICAgICAgIGNvbnRpbnVlXG4gICAgICB9XG4gICAgICBjaGlsZCA9IHRoaXMuX3NlbGVjdFBvb2xlZENoaWxkKCkgfHwgdGhpcy5fY3JlYXRlUG9vbGVkQ2hpbGQoKVxuICAgIH1cblxuICAgIGNvbnN0IHN0YXRlID0gdGhpcy5wb29sZWRDaGlsZFN0YXRlcy5nZXQoY2hpbGQpXG4gICAgaWYgKCFzdGF0ZSkgdGhyb3cgbmV3IEVycm9yKFwiUG9vbGVkIHJ1bm5lciBzdGF0ZSBtaXNzaW5nXCIpXG5cbiAgICAvLyBTdGFtcCB0aGUgcm91bmQtcm9iaW4gY3Vyc29yIHNvIHRoZSBuZXh0IGRpc3BhdGNoIHByZWZlcnMgYSBkaWZmZXJlbnQgY2hpbGQuXG4gICAgc3RhdGUubGFzdERpc3BhdGNoU2VxID0gKyt0aGlzLl9wb29sZWREaXNwYXRjaFNlcVxuXG4gICAgLyoqXG4gICAgICogUmVzb2x2ZXMgdGhlIHBvb2xlZCBqb2IgcHJvbWlzZS5cbiAgICAgKiBAdHlwZSB7KHZhbHVlOiB2b2lkKSA9PiB2b2lkfVxuICAgICAqL1xuICAgIGxldCByZXNvbHZlUG9vbGVkSm9iID0gKCkgPT4ge31cbiAgICBjb25zdCBwb29sZWRKb2IgPSBuZXcgUHJvbWlzZSgocmVzb2x2ZSkgPT4geyByZXNvbHZlUG9vbGVkSm9iID0gcmVzb2x2ZSB9KVxuICAgIGNvbnN0IHRpbWVvdXRUaW1lciA9IHRoaXMuX2FybVBvb2xlZEpvYlRpbWVvdXQoe2NoaWxkLCBwYXlsb2FkfSlcblxuICAgIHN0YXRlLmluZmxpZ2h0LnNldChwYXlsb2FkLmlkLCB7cGF5bG9hZCwgcmVzb2x2ZTogcmVzb2x2ZVBvb2xlZEpvYiwgcG9vbGVkSm9iLCB0aW1lb3V0VGltZXJ9KVxuICAgIHRoaXMuX25vdGVQb29sZWRDaGlsZEFjdGl2aXR5KHtjaGlsZCwgc3RhdGV9KVxuICAgIHRyeSB7XG4gICAgICBjaGlsZC5zZW5kKHt0eXBlOiBcImpvYlwiLCBwYXlsb2FkLCBzaGFyZWRUcmFuc2FjdGlvbkJyb2tlcjogdGhpcy5fcG9vbGVkSm9iU2hhcmVkVHJhbnNhY3Rpb25Ccm9rZXJDb25maWcoKX0pXG4gICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgIHZvaWQgdGhpcy5faGFuZGxlUG9vbGVkQ2hpbGRGYWlsdXJlKHtjaGlsZCwgZXJyb3IsIG9yaWdpbjogXCJpcGMtc2VuZFwifSlcbiAgICB9XG5cbiAgICByZXR1cm4gcG9vbGVkSm9iXG4gIH1cblxuICAvKipcbiAgICogQ2FwdHVyZXMgdGhlIGN1cnJlbnQgdGVzdCBhdHRlbXB0J3MgYnJva2VyIG1vZGUgYXQgZGlzcGF0Y2ggdGltZS4gQSB3YXJtXG4gICAqIHBvb2xlZCBjaGlsZCBtdXN0IG5ldmVyIHJlbHkgb24gaXRzIGltbXV0YWJsZSBmb3JrLXRpbWUgZW52aXJvbm1lbnQuXG4gICAqIEByZXR1cm5zIHtpbXBvcnQoXCIuLi90ZXN0aW5nL3NoYXJlZC10cmFuc2FjdGlvbi1wcm94eS1kcml2ZXIuanNcIikuU2hhcmVkVHJhbnNhY3Rpb25Ccm9rZXJKb2JDb25maWd9IC0gUGVyLWpvYiBicm9rZXIgY29uZmlndXJhdGlvbi5cbiAgICovXG4gIF9wb29sZWRKb2JTaGFyZWRUcmFuc2FjdGlvbkJyb2tlckNvbmZpZygpIHtcbiAgICBjb25zdCBzZXJpYWxpemVkID0gcHJvY2Vzcy5lbnYuVkVMT0NJT1VTX1RFU1RfU0hBUkVEX1RSQU5TQUNUSU9OX0JST0tFUlxuICAgIGlmICghc2VyaWFsaXplZCkgcmV0dXJuIHtleHBlY3RlZDogZmFsc2V9XG5cbiAgICBjb25zdCBjb25maWcgPSBKU09OLnBhcnNlKEJ1ZmZlci5mcm9tKHNlcmlhbGl6ZWQsIFwiYmFzZTY0dXJsXCIpLnRvU3RyaW5nKFwidXRmOFwiKSlcbiAgICByZXR1cm4gey4uLmNvbmZpZywgZXhwZWN0ZWQ6IHRydWV9XG4gIH1cblxuICAvKipcbiAgICogU2VsZWN0cyBhIHBvb2xlZCBjaGlsZCB0byBydW4gdGhlIG5leHQgam9iLCBvciB1bmRlZmluZWQgd2hlbiBldmVyeSBub24tcmV0aXJpbmdcbiAgICogY2hpbGQgaXMgYWxyZWFkeSBmdWxsICh0aGUgY2FsbGVyIHRoZW4gbGF6aWx5IHNwYXducyBvbmUpLiBBbW9uZyBjaGlsZHJlbiB3aXRoIGFcbiAgICogZnJlZSBjb25jdXJyZW5jeSBzbG90LCBwaWNrcyB0aGUgb25lIGRpc3BhdGNoZWQgbGVhc3QgcmVjZW50bHkg4oCUIGEgcm91bmQtcm9iaW4gdGhhdFxuICAgKiBzcHJlYWRzIGpvYnMgKG5vdGFibHkgbXVsdGktbWludXRlIFJ1bkJ1aWxkSm9icywgZWFjaCBwaW5uaW5nIGEgdGVuYW50IGNvbm5lY3Rpb25cbiAgICogZm9yIGl0cyB3aG9sZSBydW4pIGV2ZW5seSBhY3Jvc3MgY2hpbGRyZW4gaW5zdGVhZCBvZiBmaXJzdC1maXQgcGFja2luZyB0aGUgZWFybGllc3RcbiAgICogb25lIHVudGlsIGl0IGlzIGZ1bGwuIEEgZnJlc2hseSBzcGF3bmVkIG9yIHJlcGxhY2VtZW50IGNoaWxkIHRoZXJlZm9yZSB0YWtlcyBpdHNcbiAgICogZmFpciBzaGFyZSBvbmUgam9iIGF0IGEgdGltZSBhcyBpdHMgdHVybiBjb21lcyB1cCwgcmF0aGVyIHRoYW4gYWJzb3JiaW5nIGEgYnVyc3QgdG9cbiAgICogXCJjYXRjaCB1cFwiIHRvIHRoZSBvdGhlcnMuXG4gICAqIEByZXR1cm5zIHtpbXBvcnQoXCJub2RlOmNoaWxkX3Byb2Nlc3NcIikuQ2hpbGRQcm9jZXNzIHwgdW5kZWZpbmVkfSAtIFRoZSBjaG9zZW4gY2hpbGQsIG9yIHVuZGVmaW5lZCB3aGVuIGFsbCBub24tcmV0aXJpbmcgY2hpbGRyZW4gYXJlIGZ1bGwuXG4gICAqL1xuICBfc2VsZWN0UG9vbGVkQ2hpbGQoKSB7XG4gICAgLyoqIEB0eXBlIHtpbXBvcnQoXCJub2RlOmNoaWxkX3Byb2Nlc3NcIikuQ2hpbGRQcm9jZXNzIHwgdW5kZWZpbmVkfSAqL1xuICAgIGxldCBzZWxlY3RlZFxuICAgIGxldCBzZWxlY3RlZFNlcSA9IEluZmluaXR5XG5cbiAgICBmb3IgKGNvbnN0IGNoaWxkIG9mIHRoaXMucG9vbGVkQ2hpbGRyZW4pIHtcbiAgICAgIGNvbnN0IHN0YXRlID0gdGhpcy5wb29sZWRDaGlsZFN0YXRlcy5nZXQoY2hpbGQpXG5cbiAgICAgIGlmICghc3RhdGUgfHwgc3RhdGUucmV0aXJpbmcgfHwgc3RhdGUuaW5mbGlnaHQuc2l6ZSA+PSB0aGlzLnBvb2xlZFJ1bm5lckNvbmN1cnJlbmN5KSBjb250aW51ZVxuXG4gICAgICBpZiAoc3RhdGUubGFzdERpc3BhdGNoU2VxIDwgc2VsZWN0ZWRTZXEpIHtcbiAgICAgICAgc2VsZWN0ZWQgPSBjaGlsZFxuICAgICAgICBzZWxlY3RlZFNlcSA9IHN0YXRlLmxhc3REaXNwYXRjaFNlcVxuICAgICAgfVxuICAgIH1cblxuICAgIHJldHVybiBzZWxlY3RlZFxuICB9XG5cbiAgLyoqXG4gICAqIEFybXMgYSBwZXItam9iIHdhbGwtY2xvY2sgYmFja3N0b3AgZm9yIGEgcG9vbGVkIGpvYi4gQSBwb29sZWQgY2hpbGQgaG9zdHMgbWFueVxuICAgKiBjb25jdXJyZW50IGpvYnMsIHNvIGEgc2luZ2xlIGdlbnVpbmVseS1odW5nIGpvYiB3b3VsZCBvdGhlcndpc2UgcGluIGl0c1xuICAgKiBydW5uZXIncyBjb25jdXJyZW5jeSBzbG90IGZvcmV2ZXIg4oCUIHRoZSBsaWZldGltZSByZWN5Y2xlIG9ubHkgcmV0aXJlcyBhIGNoaWxkXG4gICAqIG9uY2UgaXRzIGluLWZsaWdodCBzZXQgZHJhaW5zLCB3aGljaCBhIGh1bmcgam9iIG5ldmVyIGRvZXMuIE9uIG92ZXJydW4gdGhlXG4gICAqIHdob2xlIGNoaWxkIGlzIHRlcm1pbmF0ZWQgc28gdGhlIGh1bmcgam9iIChhbmQgaXRzIHNpYmxpbmdzKSByZXF1ZXVlLiBSZXR1cm5zXG4gICAqIHRoZSB0aW1lciwgb3IgbnVsbCB3aGVuIG5vIHRpbWVvdXQgaXMgY29uZmlndXJlZC5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBPcHRpb25zLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIm5vZGU6Y2hpbGRfcHJvY2Vzc1wiKS5DaGlsZFByb2Nlc3N9IGFyZ3MuY2hpbGQgLSBQb29sZWQgY2hpbGQuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi90eXBlcy5qc1wiKS5CYWNrZ3JvdW5kSm9iUGF5bG9hZCAmIHtpZDogc3RyaW5nfX0gYXJncy5wYXlsb2FkIC0gSm9iIHBheWxvYWQgd2hvc2Ugb3ZlcnJ1biBpcyBndWFyZGVkLlxuICAgKiBAcmV0dXJucyB7UmV0dXJuVHlwZTx0eXBlb2Ygc2V0VGltZW91dD4gfCBudWxsfSAtIFRoZSBhcm1lZCB0aW1lciwgb3IgbnVsbC5cbiAgICovXG4gIF9hcm1Qb29sZWRKb2JUaW1lb3V0KHtjaGlsZCwgcGF5bG9hZH0pIHtcbiAgICBjb25zdCB0aW1lb3V0TXMgPSB0aGlzLl9yZXNvbHZlSm9iVGltZW91dE1zKHBheWxvYWQub3B0aW9ucylcblxuICAgIGlmICghKHR5cGVvZiB0aW1lb3V0TXMgPT09IFwibnVtYmVyXCIgJiYgdGltZW91dE1zID4gMCkpIHJldHVybiBudWxsXG5cbiAgICByZXR1cm4gc2V0VGltZW91dCgoKSA9PiB0aGlzLl9vblBvb2xlZEpvYlRpbWVvdXQoe2NoaWxkLCBqb2JJZDogcGF5bG9hZC5pZH0pLCB0aW1lb3V0TXMpXG4gIH1cblxuICAvKipcbiAgICogRmlyZWQgd2hlbiBhIHBvb2xlZCBqb2Igb3ZlcnJ1bnMgaXRzIHRpbWVvdXQuIFRlcm1pbmF0ZXMgdGhlIGNoaWxkIHJ1bm5pbmcgaXRcbiAgICogKFNJR1RFUk0sIHRoZW4gU0lHS0lMTCBhZnRlciB0aGUgZ3JhY2UpIOKAlCBhIGh1bmcgSlMgam9iIGNhbm5vdCBiZSBjYW5jZWxsZWRcbiAgICogYW55IG90aGVyIHdheS4gVGhlIG5vbi1jbGVhbiBleGl0IGZsb3dzIHRocm91Z2ggYF9oYW5kbGVQb29sZWRDaGlsZEZhaWx1cmVgLFxuICAgKiB3aGljaCByZXBvcnRzIGV2ZXJ5IGluLWZsaWdodCBqb2Igb24gdGhlIGNoaWxkIGZhaWxlZCAoc28gdGhleSByZXF1ZXVlKSBhbmRcbiAgICogZHJvcHMgaXQgZnJvbSB0cmFja2luZzsgdGhlIGZhaWx1cmUgcGF0aCBpbW1lZGlhdGVseSByZS1hZHZlcnRpc2VzIHRoZVxuICAgKiByZXN1bHRpbmcgY2FwYWNpdHkgb25jZSB0aGUgcnVubmVyIGhhcyBjb21wbGV0ZWQgc3RhcnR1cC5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBPcHRpb25zLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIm5vZGU6Y2hpbGRfcHJvY2Vzc1wiKS5DaGlsZFByb2Nlc3N9IGFyZ3MuY2hpbGQgLSBQb29sZWQgY2hpbGQuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBhcmdzLmpvYklkIC0gSm9iIGlkIHRoYXQgb3ZlcnJhbi5cbiAgICogQHJldHVybnMge3ZvaWR9XG4gICAqL1xuICBfb25Qb29sZWRKb2JUaW1lb3V0KHtjaGlsZCwgam9iSWR9KSB7XG4gICAgY29uc3Qgc3RhdGUgPSB0aGlzLnBvb2xlZENoaWxkU3RhdGVzLmdldChjaGlsZClcblxuICAgIC8vIEFscmVhZHkgc2V0dGxpbmcvZ29uZSwgb3IgdGhlIGpvYiBmaW5pc2hlZCBpbiB0aGUgcmFjZSB3aXRoIHRoaXMgdGltZXIuXG4gICAgaWYgKCFzdGF0ZSB8fCBzdGF0ZS5zZXR0bGluZyB8fCBzdGF0ZS5zaHV0ZG93blJlYXNvbiB8fCAhc3RhdGUuaW5mbGlnaHQuaGFzKGpvYklkKSkgcmV0dXJuXG5cbiAgICBzdGF0ZS50aW1lb3V0Sm9iSWQgPSBqb2JJZFxuICAgIHRoaXMuX3JlcXVlc3RQb29sZWRDaGlsZFNodXRkb3duKHtjaGlsZCwgcmVhc29uOiBcImpvYl90aW1lb3V0XCIsIHNpZ25hbDogXCJTSUdURVJNXCJ9KVxuXG4gICAgc3RhdGUudGltZW91dFNpZ2tpbGxUaW1lciA9IHNldFRpbWVvdXQoKCkgPT4ge1xuICAgICAgdHJ5IHtcbiAgICAgICAgY2hpbGQua2lsbChcIlNJR0tJTExcIilcbiAgICAgIH0gY2F0Y2gge1xuICAgICAgICAvLyBDaGlsZCBhbHJlYWR5IGV4aXRlZDsgbm90aGluZyB0byBkby5cbiAgICAgIH1cbiAgICB9LCB0aGlzLmZvcmtlZENoaWxkU2lna2lsbEdyYWNlTXMpXG4gIH1cblxuICAvKipcbiAgICogQ3JlYXRlcyBhIHJldXNhYmxlIHBvb2xlZCBjaGlsZCwgZW5mb3JjaW5nIHRoZSBoYXJkIGNhcCBvbiB0b3RhbCBsaXZlXG4gICAqIGNoaWxkcmVuICh3b3JraW5nICsgZHJhaW5pbmcpLiBSZXR1cm5zIHVuZGVmaW5lZCB3aGVuIHRoZSBjYXAgaXMgYWxyZWFkeVxuICAgKiBtZXQg4oCUIHRoZSBvbmx5IHdheSBhIG5ldyBjaGlsZCBtYXkgZXhpc3QgaXMgYSBzbG90IGJlaW5nIG9wZW4sIHNvIHRoZVxuICAgKiBjYWxsZXIgcmUtY2hlY2tzIGFuZCB3YWl0cyBhZ2Fpbi4gYGFsbG93T3ZlckNhcGAgaXMgcmVzZXJ2ZWQgZm9yIHRoZVxuICAgKiBib3VuZGVkIGxpdmVuZXNzIHJlcGxhY2VtZW50OiBhdCBtb3N0IG9uZSBjaGlsZCBiZXlvbmQgdGhlIGNhcCBtYXkgZXhpc3QsXG4gICAqIGFuZCBvbmx5IHdoZW4gZXZlcnkgb3RoZXIgbGl2ZSBjaGlsZCBpcyBhbHJlYWR5IHJldGlyaW5nIChzZWVcbiAgICogYF9iZWdpblJldGlyZVBvb2xlZENoaWxkYCBmb3IgdGhlIGdhdGUpLlxuICAgKiBAcGFyYW0ge29iamVjdH0gW2FyZ3NdIC0gU3Bhd24gb3B0aW9ucy5cbiAgICogQHBhcmFtIHtib29sZWFufSBbYXJncy5hbGxvd092ZXJDYXBdIC0gQWxsb3cgb25lIG92ZXItY2FwIHNwYXduIGZvciB0aGUgbGl2ZW5lc3MgcmVwbGFjZW1lbnQuXG4gICAqIEByZXR1cm5zIHtpbXBvcnQoXCJub2RlOmNoaWxkX3Byb2Nlc3NcIikuQ2hpbGRQcm9jZXNzIHwgdW5kZWZpbmVkfSAtIFRoZSBuZXcgY2hpbGQsIG9yIHVuZGVmaW5lZCB3aGVuIHRoZSBwb29sIGlzIGF0IGl0cyBjYXAuXG4gICAqL1xuICBfY3JlYXRlUG9vbGVkQ2hpbGQoe2FsbG93T3ZlckNhcCA9IGZhbHNlfSA9IHt9KSB7XG4gICAgY29uc3QgY29uZmlndXJhdGlvbiA9IHRoaXMuY29uZmlndXJhdGlvblxuICAgIGlmICghY29uZmlndXJhdGlvbikgdGhyb3cgbmV3IEVycm9yKFwiQmFja2dyb3VuZCBqb2JzIHdvcmtlciBjb25maWd1cmF0aW9uIG5vdCBpbml0aWFsaXplZFwiKVxuICAgIGlmICghYWxsb3dPdmVyQ2FwICYmIHRoaXMucG9vbGVkQ2hpbGRyZW4uc2l6ZSA+PSB0aGlzLnBvb2xlZFJ1bm5lckNvdW50KSByZXR1cm4gdW5kZWZpbmVkXG4gICAgY29uc3QgY2hpbGQgPSBmb3JrKFBPT0xFRF9SVU5ORVJfRU5UUllfUEFUSCwgW10sIHtcbiAgICAgIGN3ZDogY29uZmlndXJhdGlvbi5nZXREaXJlY3RvcnkoKSwgZXhlY0FyZ3Y6IHRoaXMuX2NoaWxkUnVubmVyRXhlY0FyZ3YoKSwgc3RkaW86IFtcImlnbm9yZVwiLCBcImlnbm9yZVwiLCBcImlnbm9yZVwiLCBcImlwY1wiXSxcbiAgICAgIGVudjogT2JqZWN0LmFzc2lnbih7fSwgcHJvY2Vzcy5lbnYsIHRoaXMuX2NoaWxkQmFja2dyb3VuZEpvYnNFbnZpcm9ubWVudCgpKVxuICAgIH0pXG4gICAgdGhpcy5wb29sZWRDaGlsZHJlbi5hZGQoY2hpbGQpXG4gICAgdGhpcy5pbmZsaWdodFByb2Nlc3NDaGlsZHJlbi5hZGQoY2hpbGQpXG4gICAgdGhpcy5wb29sZWRDaGlsZFN0YXRlcy5zZXQoY2hpbGQsIHtjcmVhdGVkQXRNczogRGF0ZS5ub3coKSwgam9ic1J1bjogMCwgaW5mbGlnaHQ6IG5ldyBNYXAoKSwgbGFzdERpc3BhdGNoU2VxOiAwLCByZXRpcmluZzogZmFsc2UsIHN0YXJ0ZWQ6IGZhbHNlLCBsYXN0QWN0aXZpdHlBdE1zOiBEYXRlLm5vdygpfSlcbiAgICBjaGlsZC5vbihcIm1lc3NhZ2VcIiwgKG1lc3NhZ2UpID0+IHRoaXMuX2hhbmRsZVBvb2xlZENoaWxkTWVzc2FnZSh7Y2hpbGQsIG1lc3NhZ2V9KSlcbiAgICBjaGlsZC5vbmNlKFwiZXhpdFwiLCAoZXhpdENvZGUsIHNpZ25hbCkgPT4gdGhpcy5faGFuZGxlUG9vbGVkQ2hpbGRGYWlsdXJlKHtcbiAgICAgIGNoaWxkLFxuICAgICAgZXJyb3I6IG5ldyBFcnJvcihgUG9vbGVkIGJhY2tncm91bmQgam9iIHJ1bm5lciBleGl0ZWQ6IGNvZGU9JHtleGl0Q29kZX0gc2lnbmFsPSR7c2lnbmFsIHx8IFwibm9uZVwifWApLFxuICAgICAgZXhpdENvZGUsXG4gICAgICBvcmlnaW46IFwiZXhpdFwiLFxuICAgICAgc2lnbmFsXG4gICAgfSkpXG4gICAgY2hpbGQub25jZShcImVycm9yXCIsIChlcnJvcikgPT4gdGhpcy5faGFuZGxlUG9vbGVkQ2hpbGRGYWlsdXJlKHtcbiAgICAgIGNoaWxkLFxuICAgICAgZXJyb3IsXG4gICAgICBleGl0Q29kZTogY2hpbGQuZXhpdENvZGUsXG4gICAgICBvcmlnaW46IFwicHJvY2Vzcy1lcnJvclwiLFxuICAgICAgc2lnbmFsOiBjaGlsZC5zaWduYWxDb2RlXG4gICAgfSkpXG4gICAgY2hpbGQub25jZShcImRpc2Nvbm5lY3RcIiwgKCkgPT4ge1xuICAgICAgY29uc3Qgc3RhdGUgPSB0aGlzLnBvb2xlZENoaWxkU3RhdGVzLmdldChjaGlsZClcbiAgICAgIGlmIChzdGF0ZSkgc3RhdGUuaXBjRGlzY29ubmVjdGVkQXRNcyA/Pz0gRGF0ZS5ub3coKVxuICAgIH0pXG4gICAgcmV0dXJuIGNoaWxkXG4gIH1cblxuICAvKipcbiAgICogSGFuZGxlcyBhIHBvb2xlZCBjaGlsZCdzIHBlci1qb2IgZHVyYWJsZS1yZXBvcnQgYWNrbm93bGVkZ2VtZW50LiBBIGNoaWxkXG4gICAqIHJ1bnMgam9icyBjb25jdXJyZW50bHkgYW5kIHJlcG9ydHMgb25lIGBqb2Itb3V0Y29tZWAgcGVyIGpvYiBpZC5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBNZXNzYWdlIGRldGFpbHMuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwibm9kZTpjaGlsZF9wcm9jZXNzXCIpLkNoaWxkUHJvY2Vzc30gYXJncy5jaGlsZCAtIFBvb2xlZCBjaGlsZC5cbiAgICogQHBhcmFtIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gYXJncy5tZXNzYWdlIC0gSVBDIG1lc3NhZ2UuXG4gICAqIEByZXR1cm5zIHt2b2lkfVxuICAgKi9cbiAgX2hhbmRsZVBvb2xlZENoaWxkTWVzc2FnZSh7Y2hpbGQsIG1lc3NhZ2V9KSB7XG4gICAgaWYgKCFtZXNzYWdlIHx8IHR5cGVvZiBtZXNzYWdlICE9PSBcIm9iamVjdFwiKSByZXR1cm5cbiAgICBjb25zdCByZWNvcmQgPSAvKiogQHR5cGUge3t0eXBlPzogUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4sIGNoaWxkSW5zdGFuY2VJZD86IFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+LCBqb2JJZD86IFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+LCBhY2tub3dsZWRnZWQ/OiBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPiwgcnNzQnl0ZXM/OiBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPiwgcGVha1Jzc0J5dGVzPzogUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4sIGVycm9yPzogUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59fSAqLyAobWVzc2FnZSlcbiAgICBjb25zdCBzdGF0ZSA9IHRoaXMucG9vbGVkQ2hpbGRTdGF0ZXMuZ2V0KGNoaWxkKVxuICAgIHRoaXMuX25vdGVQb29sZWRDaGlsZEFjdGl2aXR5KHtjaGlsZCwgc3RhdGV9KVxuICAgIGlmIChyZWNvcmQudHlwZSA9PT0gXCJyZWFkeVwiKSB7XG4gICAgICBpZiAoc3RhdGUpIHtcbiAgICAgICAgc3RhdGUuc3RhcnRlZCA9IHRydWVcbiAgICAgICAgaWYgKHR5cGVvZiByZWNvcmQuY2hpbGRJbnN0YW5jZUlkID09PSBcInN0cmluZ1wiKSBzdGF0ZS5jaGlsZEluc3RhbmNlSWQgPSByZWNvcmQuY2hpbGRJbnN0YW5jZUlkXG4gICAgICB9XG4gICAgICByZXR1cm5cbiAgICB9XG4gICAgaWYgKGlzQ2hpbGRTaHV0ZG93bk9ic2VydmF0aW9uTWVzc2FnZShtZXNzYWdlKSkge1xuICAgICAgaWYgKHN0YXRlKSB7XG4gICAgICAgIHN0YXRlLmNoaWxkSW5zdGFuY2VJZCA9IG1lc3NhZ2UuY2hpbGRJbnN0YW5jZUlkXG4gICAgICAgIHN0YXRlLnNodXRkb3duT2JzZXJ2YXRpb24gPSBtZXNzYWdlXG4gICAgICAgIGlmIChzdGF0ZS5zaHV0ZG93blNpZ25hbFRpbWVyKSB7XG4gICAgICAgICAgY2xlYXJUaW1lb3V0KHN0YXRlLnNodXRkb3duU2lnbmFsVGltZXIpXG4gICAgICAgICAgc3RhdGUuc2h1dGRvd25TaWduYWxUaW1lciA9IHVuZGVmaW5lZFxuICAgICAgICB9XG4gICAgICB9XG4gICAgICByZXR1cm5cbiAgICB9XG4gICAgaWYgKGlzQ2hpbGRBY2NlcHRhbmNlTWVzc2FnZShtZXNzYWdlKSkge1xuICAgICAgdGhpcy5fcmVwb3J0Q2hpbGRBY2NlcHRlZChtZXNzYWdlKVxuICAgICAgcmV0dXJuXG4gICAgfVxuICAgIGlmIChpc1Bvb2xlZENoaWxkTWVtb3J5T2JzZXJ2YXRpb25NZXNzYWdlKG1lc3NhZ2UpKSB7XG4gICAgICB0aGlzLl9oYW5kbGVQb29sZWRDaGlsZE1lbW9yeU9ic2VydmF0aW9uKHtjaGlsZCwgbWVzc2FnZX0pXG4gICAgICByZXR1cm5cbiAgICB9XG4gICAgaWYgKHJlY29yZC50eXBlICE9PSBcImpvYi1vdXRjb21lXCIgfHwgIXN0YXRlIHx8IHN0YXRlLnNldHRsaW5nIHx8IHR5cGVvZiByZWNvcmQuam9iSWQgIT09IFwic3RyaW5nXCIpIHJldHVyblxuICAgIHN0YXRlLnN0YXJ0ZWQgPSB0cnVlXG4gICAgY29uc3QgZW50cnkgPSBzdGF0ZS5pbmZsaWdodC5nZXQocmVjb3JkLmpvYklkKVxuICAgIGlmICghZW50cnkpIHJldHVyblxuXG4gICAgaWYgKGVudHJ5LnRpbWVvdXRUaW1lcikgY2xlYXJUaW1lb3V0KGVudHJ5LnRpbWVvdXRUaW1lcilcbiAgICBzdGF0ZS5pbmZsaWdodC5kZWxldGUocmVjb3JkLmpvYklkKVxuICAgIHN0YXRlLmpvYnNSdW4gKz0gMVxuICAgIGNvbnN0IHJlc29sdmUgPSBlbnRyeS5yZXNvbHZlXG5cbiAgICBpZiAocmVjb3JkLmFja25vd2xlZGdlZCA9PT0gdHJ1ZSkge1xuICAgICAgaWYgKHJlc29sdmUpIHJlc29sdmUodW5kZWZpbmVkKVxuICAgIH0gZWxzZSB7XG4gICAgICAvLyBUaGUgY2hpbGQgc3RheWVkIGFsaXZlIGJ1dCBjb3VsZCBub3QgY29uZmlybSB0aGlzIG9uZSBqb2IncyB0ZXJtaW5hbFxuICAgICAgLy8gcmVwb3J0OyByZWNsYWltIGp1c3QgdGhpcyBqb2Ig4oCUIGl0cyBjb25jdXJyZW50IHNpYmxpbmdzIGFyZSB1bmFmZmVjdGVkLlxuICAgICAgdm9pZCB0aGlzLl9yZXBvcnRKb2JSZXN1bHQoe1xuICAgICAgICBqb2JJZDogZW50cnkucGF5bG9hZC5pZCxcbiAgICAgICAgc3RhdHVzOiBcImZhaWxlZFwiLFxuICAgICAgICBlcnJvcjogbmV3IEVycm9yKHR5cGVvZiByZWNvcmQuZXJyb3IgPT09IFwic3RyaW5nXCIgPyByZWNvcmQuZXJyb3IgOiBcIlBvb2xlZCBydW5uZXIgdGVybWluYWwgcmVwb3J0IHdhcyBub3QgYWNrbm93bGVkZ2VkXCIpLFxuICAgICAgICBoYW5kb2ZmSWQ6IGVudHJ5LnBheWxvYWQuaGFuZG9mZklkLFxuICAgICAgICBoYW5kZWRPZmZBdE1zOiBlbnRyeS5wYXlsb2FkLmhhbmRlZE9mZkF0TXMsXG4gICAgICAgIHdvcmtlcklkOiBlbnRyeS5wYXlsb2FkLndvcmtlcklkIHx8IHRoaXMud29ya2VySWRcbiAgICAgIH0pLmZpbmFsbHkoKCkgPT4geyBpZiAocmVzb2x2ZSkgcmVzb2x2ZSh1bmRlZmluZWQpIH0pXG4gICAgfVxuXG4gICAgY29uc3QgcnNzQnl0ZXMgPSB0eXBlb2YgcmVjb3JkLnJzc0J5dGVzID09PSBcIm51bWJlclwiID8gcmVjb3JkLnJzc0J5dGVzIDogTnVtYmVyLlBPU0lUSVZFX0lORklOSVRZXG4gICAgLy8gVGhlIGNoaWxkJ3MgcGVhayBSU1MgKFZtSFdNKSBpcyBtb25vdG9uaWMgYW5kIG91dGxpdmVzIHRoZSBzZXR0bGVkXG4gICAgLy8gc2FtcGxlOiBhIHJhdGNoZXRlZCBidXJzdCB3b3JraW5nLXNldCBtdXN0IHJlY3ljbGUgdGhlIGNoaWxkIGV2ZW4gd2hlblxuICAgIC8vIHNldHRsZWQgUlNTIGF0IG91dGNvbWUgdGltZSBsb29rcyBtb2Rlc3QuIEEgY2hpbGQgd2l0aG91dCBwZWFrIHN1cHBvcnRcbiAgICAvLyBmYWxscyBiYWNrIHRvIHRoZSBzZXR0bGVkIHNhbXBsZS5cbiAgICBjb25zdCBwZWFrUnNzQnl0ZXMgPSB0eXBlb2YgcmVjb3JkLnBlYWtSc3NCeXRlcyA9PT0gXCJudW1iZXJcIiA/IHJlY29yZC5wZWFrUnNzQnl0ZXMgOiByc3NCeXRlc1xuICAgIGNvbnN0IHJ1bm5lckFnZU1zID0gRGF0ZS5ub3coKSAtIHN0YXRlLmNyZWF0ZWRBdE1zXG4gICAgaWYgKCFzdGF0ZS5yZXRpcmluZyAmJiAoc3RhdGUuam9ic1J1biA+PSB0aGlzLnBvb2xlZFJ1bm5lck1heEpvYnMgfHwgcGVha1Jzc0J5dGVzID49IHRoaXMucG9vbGVkUnVubmVyTWF4UnNzQnl0ZXMgfHwgcnVubmVyQWdlTXMgPj0gdGhpcy5wb29sZWRSdW5uZXJNYXhMaWZldGltZU1zIHx8IHRoaXMuc2hvdWxkU3RvcCkpIHtcbiAgICAgIHRoaXMuX2JlZ2luUmV0aXJlUG9vbGVkQ2hpbGQoY2hpbGQpXG4gICAgfVxuICAgIHRoaXMuX3Rlcm1pbmF0ZUlmRHJhaW5lZChjaGlsZClcbiAgICAvLyBBIGpvYiBvdXRjb21lIGZyZWVzIGEgY29uY3VycmVuY3kgc2xvdCBhbmQgbWF5IGRyYWluIGEgcmV0aXJpbmcgY2hpbGQg4oCUXG4gICAgLy8gdGhlIG9ubHkgdHdvIHRyYW5zaXRpb25zIHRoYXQgZnJlZSBjYXBhY2l0eSBmb3Igd2FpdGVycyBhdCB0aGUgaGFyZCBjYXAuXG4gICAgdGhpcy5fd2FrZVBvb2xlZFNsb3RXYWl0ZXJzKClcbiAgfVxuXG4gIC8qKlxuICAgKiBGb3J3YXJkcyBvbmUgcG9vbGVkIGNoaWxkJ3MgYWNjZXB0YW5jZSBvYnNlcnZhdGlvbiB0byBtYWluIGFzIGEgYm91bmRlZFxuICAgKiBkaWFnbm9zdGljIHJlcG9ydC4gVGhlIGNoaWxkIGNhcnJpZXMgaXRzIGV4YWN0IGhhbmRvZmYgbGVhc2UsIHNvIGEgdGltZW91dFxuICAgKiBvciBvdXRjb21lIHRoYXQgYWxyZWFkeSBzZXR0bGVkIHRoZSB3b3JrZXIncyBpbi1mbGlnaHQgZW50cnkgY2Fubm90IGxvc2VcbiAgICogdGhlIGZlbmNpbmcuIEEgcmVwb3J0IHRoYXQgbmV2ZXIgbGFuZHMgZGVncmFkZXMgcGhhc2UgZGlhZ25vc3RpY3MgZm9yIHRoYXRcbiAgICogam9iIG9ubHkg4oCUIGl0IG11c3QgbmV2ZXIgYmxvY2sgb3IgZmFpbCB0aGUgam9iIGl0c2VsZi5cbiAgICogQHBhcmFtIHt7dHlwZTogXCJqb2ItcmVjZWl2ZWRcIiB8IFwiam9iLXN0YXJ0ZWRcIiwgam9iSWQ6IHN0cmluZywgaGFuZG9mZklkPzogc3RyaW5nLCB3b3JrZXJJZD86IHN0cmluZywgaGFuZGVkT2ZmQXRNcz86IG51bWJlciwgcmVjZWl2ZWRBdE1zPzogbnVtYmVyLCBzdGFydGVkQXRNcz86IG51bWJlciwgY2hpbGRJbnN0YW5jZUlkPzogc3RyaW5nLCBjaGlsZFBpZD86IG51bWJlciwgcnVubmVySG9zdG5hbWU/OiBzdHJpbmd9fSBtZXNzYWdlIC0gVmFsaWRhdGVkIGNoaWxkIGFjY2VwdGFuY2UgbWVzc2FnZS5cbiAgICogQHJldHVybnMge3ZvaWR9XG4gICAqL1xuICBfcmVwb3J0Q2hpbGRBY2NlcHRlZChtZXNzYWdlKSB7XG4gICAgaWYgKCF0aGlzLnN0YXR1c1JlcG9ydGVyKSByZXR1cm5cblxuICAgIHZvaWQgdGhpcy5zdGF0dXNSZXBvcnRlci5yZXBvcnRDaGlsZEFjY2VwdGVkV2l0aFJldHJ5KHtcbiAgICAgIGpvYklkOiBtZXNzYWdlLmpvYklkLFxuICAgICAgaGFuZG9mZklkOiBtZXNzYWdlLmhhbmRvZmZJZCxcbiAgICAgIHdvcmtlcklkOiBtZXNzYWdlLndvcmtlcklkLFxuICAgICAgaGFuZGVkT2ZmQXRNczogbWVzc2FnZS5oYW5kZWRPZmZBdE1zLFxuICAgICAgcmVjZWl2ZWRBdE1zOiBtZXNzYWdlLnJlY2VpdmVkQXRNcyxcbiAgICAgIHN0YXJ0ZWRBdE1zOiBtZXNzYWdlLnN0YXJ0ZWRBdE1zLFxuICAgICAgY2hpbGRJbnN0YW5jZUlkOiBtZXNzYWdlLmNoaWxkSW5zdGFuY2VJZCxcbiAgICAgIGNoaWxkUGlkOiBtZXNzYWdlLmNoaWxkUGlkLFxuICAgICAgcnVubmVySG9zdG5hbWU6IG1lc3NhZ2UucnVubmVySG9zdG5hbWUsXG4gICAgICBtYXhEdXJhdGlvbk1zOiBDSElMRF9BQ0NFUFRBTkNFX1JFUE9SVF9NQVhfRFVSQVRJT05fTVNcbiAgICB9KS5jYXRjaCgoZXJyb3IpID0+IHtcbiAgICAgIGNvbnNvbGUuZXJyb3IoXCJCYWNrZ3JvdW5kIGpvYiBjaGlsZC1hY2NlcHRhbmNlIHJlcG9ydGluZyBmYWlsZWQ6XCIsIGVycm9yKVxuICAgIH0pXG4gIH1cblxuICAvKipcbiAgICogSGFuZGxlcyBhIHBvb2xlZCBjaGlsZCdzIGJvdW5kZWQgbWVtb3J5IG9ic2VydmF0aW9uLiBUaGUgcG9vbGVkIGNoaWxkJ3NcbiAgICogc3RkaW8gaXMgaWdub3JlZCBieSB0aGUgd29ya2VyIGZvcmssIHNvIHRoaXMgSVBDIG9ic2VydmF0aW9uIGlzIGhvdyBhXG4gICAqIG1lbW9yeSBwcm9ibGVtIGluIGEgcnVubmluZyBjaGlsZCBuYW1lcyBpdHNlbGYuIFRoZSB3b3JrZXIgKGEpIHJlY29yZHMgdGhlXG4gICAqIGxhdGVzdCBvYnNlcnZhdGlvbiBvbiB0aGUgY2hpbGQncyBzdGF0ZSBmb3IgbGF0ZXIgY29ycmVsYXRpb24sIChiKSBsb2dzIG9uZVxuICAgKiBjb21wYWN0IGxpbmUgdG8gaXRzIG93biBzdGRlcnIgKHdoaWNoIHJlYWNoZXMgdGhlIHByb2QgbG9nLCB1bmxpa2UgdGhlXG4gICAqIGNoaWxkJ3MgaWdub3JlZCBzdGRpbyksIGFuZCAoYykgZm9yd2FyZHMgdGhlIGZ1bGwgb2JzZXJ2YXRpb24gdG8gdGhlXG4gICAqIG9wdGlvbmFsIGBvblBvb2xlZFJ1bm5lck1lbW9yeU9ic2VydmF0aW9uYCBob29rIHNvIGFuIGFwcGxpY2F0aW9uIGNhbiByb3V0ZVxuICAgKiBpdCAoZS5nLiB0byBhIGJ1ZyByZXBvcnRlcikgd2l0aG91dCBwYXJzaW5nIGxvZ3MuIFRoZSBoZWFwLXN0YXQgYnJlYWtkb3duXG4gICAqIGRpc3Rpbmd1aXNoZXMgVjgtaGVhcCBncm93dGggZnJvbSBleHRlcm5hbC9hcnJheS1idWZmZXIgKG5hdGl2ZSkgZ3Jvd3RoLiBBXG4gICAqIGhvb2sgZmFpbHVyZSBpcyBzd2FsbG93ZWQg4oCUIGRpYWdub3N0aWNzIG11c3QgbmV2ZXIgdGFrZSBkb3duIHRoZSB3b3JrZXIgb3JcbiAgICogZmFpbCB0aGUgam9icyBydW5uaW5nIG9uIHRoYXQgY2hpbGQuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gTWVzc2FnZSBkZXRhaWxzLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIm5vZGU6Y2hpbGRfcHJvY2Vzc1wiKS5DaGlsZFByb2Nlc3N9IGFyZ3MuY2hpbGQgLSBQb29sZWQgY2hpbGQuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi90eXBlcy5qc1wiKS5Qb29sZWRDaGlsZE1lbW9yeU9ic2VydmF0aW9ufSBhcmdzLm1lc3NhZ2UgLSBWYWxpZGF0ZWQgbWVtb3J5IG9ic2VydmF0aW9uLlxuICAgKiBAcmV0dXJucyB7dm9pZH1cbiAgICovXG4gIF9oYW5kbGVQb29sZWRDaGlsZE1lbW9yeU9ic2VydmF0aW9uKHtjaGlsZCwgbWVzc2FnZX0pIHtcbiAgICBjb25zdCBzdGF0ZSA9IHRoaXMucG9vbGVkQ2hpbGRTdGF0ZXMuZ2V0KGNoaWxkKVxuICAgIGlmIChzdGF0ZSkgc3RhdGUubGFzdE1lbW9yeU9ic2VydmF0aW9uID0gbWVzc2FnZVxuXG4gICAgY29uc3QgaGVhcCA9IG1lc3NhZ2UuaGVhcFN0YXRpc3RpY3NcbiAgICBjb25zb2xlLmVycm9yKFxuICAgICAgSlNPTi5zdHJpbmdpZnkoe1xuICAgICAgICBldmVudDogXCJwb29sZWQtY2hpbGQtbWVtb3J5XCIsXG4gICAgICAgIGNoaWxkSW5zdGFuY2VJZDogc3RhdGU/LmNoaWxkSW5zdGFuY2VJZCA/PyBtZXNzYWdlLmNoaWxkSW5zdGFuY2VJZCxcbiAgICAgICAgY2hpbGRQaWQ6IG1lc3NhZ2UuY2hpbGRQaWQsXG4gICAgICAgIGNoaWxkVXB0aW1lUzogTWF0aC5yb3VuZChtZXNzYWdlLmNoaWxkVXB0aW1lTXMgLyAxMDAwKSxcbiAgICAgICAgcnNzTWI6IE1hdGgucm91bmQobWVzc2FnZS5yc3NCeXRlcyAvICgxMDI0ICogMTAyNCkpLFxuICAgICAgICBwZWFrUnNzTWI6IE1hdGgucm91bmQoKHR5cGVvZiBtZXNzYWdlLnBlYWtSc3NCeXRlcyA9PT0gXCJudW1iZXJcIiA/IG1lc3NhZ2UucGVha1Jzc0J5dGVzIDogbWVzc2FnZS5yc3NCeXRlcykgLyAoMTAyNCAqIDEwMjQpKSxcbiAgICAgICAgaGVhcFVzZWRNYjogTWF0aC5yb3VuZChoZWFwLnVzZWRfaGVhcF9zaXplIC8gKDEwMjQgKiAxMDI0KSksXG4gICAgICAgIGhlYXBUb3RhbE1iOiBNYXRoLnJvdW5kKGhlYXAudG90YWxfaGVhcF9zaXplIC8gKDEwMjQgKiAxMDI0KSksXG4gICAgICAgIGhlYXBMaW1pdE1iOiBNYXRoLnJvdW5kKGhlYXAuaGVhcF9zaXplX2xpbWl0IC8gKDEwMjQgKiAxMDI0KSksXG4gICAgICAgIGV4dGVybmFsTWI6IE1hdGgucm91bmQobWVzc2FnZS5tZW1vcnlVc2FnZS5leHRlcm5hbCAvICgxMDI0ICogMTAyNCkpLFxuICAgICAgICBhcnJheUJ1ZmZlcnNNYjogTWF0aC5yb3VuZChtZXNzYWdlLm1lbW9yeVVzYWdlLmFycmF5QnVmZmVycyAvICgxMDI0ICogMTAyNCkpLFxuICAgICAgICBqb2JzOiBtZXNzYWdlLmpvYkNvdW50LFxuICAgICAgICBhY3RpdmVKb2JJZHM6IG1lc3NhZ2UuYWN0aXZlSm9iSWRzXG4gICAgICB9KVxuICAgIClcblxuICAgIGlmICh0aGlzLm9uUG9vbGVkUnVubmVyTWVtb3J5T2JzZXJ2YXRpb24pIHtcbiAgICAgIHRyeSB7XG4gICAgICAgIGNvbnN0IHJlc3VsdCA9IHRoaXMub25Qb29sZWRSdW5uZXJNZW1vcnlPYnNlcnZhdGlvbihtZXNzYWdlKVxuICAgICAgICBpZiAocmVzdWx0ICYmIHR5cGVvZiByZXN1bHQuY2F0Y2ggPT09IFwiZnVuY3Rpb25cIikgcmVzdWx0LmNhdGNoKChlcnJvcikgPT4ge1xuICAgICAgICAgIGNvbnNvbGUuZXJyb3IoXCJQb29sZWQgcnVubmVyIG1lbW9yeSBvYnNlcnZhdGlvbiBob29rIGZhaWxlZDpcIiwgZXJyb3IpXG4gICAgICAgIH0pXG4gICAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgICBjb25zb2xlLmVycm9yKFwiUG9vbGVkIHJ1bm5lciBtZW1vcnkgb2JzZXJ2YXRpb24gaG9vayBmYWlsZWQ6XCIsIGVycm9yKVxuICAgICAgfVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBSZXF1ZXN0cyBhbiBpbW1lZGlhdGUgbWVtb3J5IG9ic2VydmF0aW9uIGZyb20gb25lIHBvb2xlZCBjaGlsZC4gVGhlIGNoaWxkXG4gICAqIHJlcGxpZXMgb3ZlciBJUEMgd2l0aCBpdHMgY3VycmVudCBzbmFwc2hvdCAodGhlIHNhbWUgc2hhcGUgYXMgdGhlIHBlcmlvZGljXG4gICAqIHNhbXBsZXIpLCB3aGljaCB0aGUgd29ya2VyIHJlY29yZHMsIGxvZ3MsIGFuZCBmb3J3YXJkcyB0byB0aGVcbiAgICogYG9uUG9vbGVkUnVubmVyTWVtb3J5T2JzZXJ2YXRpb25gIGhvb2suIFVzZSB0aGlzIHRvIHB1bGwgYSBzbmFwc2hvdCBvblxuICAgKiBzdXNwaWNpb24gKGUuZy4gYWZ0ZXIgYW4gT09NIHJlcG9ydCkgd2l0aG91dCB3YWl0aW5nIGZvciB0aGUgbmV4dCBwZXJpb2RpY1xuICAgKiBzYW1wbGUuIEEgbm8tb3Agd2hlbiB0aGUgY2hpbGQgaXMgZ29uZSBvciBpdHMgSVBDIGNoYW5uZWwgaXMgY2xvc2VkLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIm5vZGU6Y2hpbGRfcHJvY2Vzc1wiKS5DaGlsZFByb2Nlc3N9IGNoaWxkIC0gUG9vbGVkIGNoaWxkIHRvIHNhbXBsZS5cbiAgICogQHJldHVybnMge3ZvaWR9XG4gICAqL1xuICByZXF1ZXN0UG9vbGVkQ2hpbGRNZW1vcnlPYnNlcnZhdGlvbihjaGlsZCkge1xuICAgIGlmICghY2hpbGQuY29ubmVjdGVkKSByZXR1cm5cblxuICAgIHRyeSB7XG4gICAgICBjaGlsZC5zZW5kKHt0eXBlOiBcIm1lbW9yeS1vYnNlcnZhdGlvbi1yZXF1ZXN0XCJ9KVxuICAgIH0gY2F0Y2gge1xuICAgICAgLy8gVGhlIElQQyBjaGFubmVsIGlzIGFscmVhZHkgZ29uZTsgdGhlIGRpc2Nvbm5lY3QvZXhpdCBoYW5kbGVyIG93bnMgdGVhcmRvd24uXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIE1hcmtzIGEgcG9vbGVkIGNoaWxkIGZvciByZXRpcmVtZW50IGFuZCDigJQgd2hlbiB0aGUgcG9vbCBpcyBiZWxvdyBpdHMgaGFyZFxuICAgKiBjYXAg4oCUIGVhZ2VybHkgc3Bhd25zIGEgc2luZ2xlIHJlcGxhY2VtZW50ICgxLWZvci0xKSBzbyBpdHMgY2FwYWNpdHkgaXNcbiAgICogcmVzdG9yZWQgaW1tZWRpYXRlbHkgd2l0aG91dCB3YWl0aW5nIGZvciBpdCB0byBmaW5pc2ggZHJhaW5pbmcsIGFuZFxuICAgKiByZS1hZHZlcnRpc2VzIHRoYXQgY2FwYWNpdHkgc28gZGlzcGF0Y2ggY2FuIHJlc3VtZSBhdCBvbmNlLiBUaGVcbiAgICogcmVwbGFjZW1lbnQgc3Bhd24gaXMgZ2F0ZWQgYnkgdGhlIGNhcCAodGhlIHJldGlyaW5nIGNoaWxkIHN0aWxsIGNvdW50cyBhc1xuICAgKiBsaXZlIHVudGlsIGl0IGV4aXRzKSwgc28gYSBmdWxsIHBvb2wgZGVmZXJzIHRoZSByZXBsYWNlbWVudCB0byB0aGUgZHJhaW5cbiAgICogcGF0aCDigJQgd2hlcmUgYSBjaGlsZCBleGl0IHJlc3RvcmVzIGEgd29ya2luZyBjaGlsZCB0aHJvdWdoIHRoZSBzYW1lXG4gICAqIGJvdW5kZWQgbGl2ZW5lc3MgcmVwbGFjZW1lbnQgKHNlZSBgX2Vuc3VyZU5vblJldGlyaW5nQ2hpbGRgKS4gV2l0aG91dCBpdCxcbiAgICogYSBmdWxsIHJldGlyZW1lbnQgd2F2ZSAoZS5nLiBldmVyeSBjaGlsZCBjcm9zc2luZyB0aGUgcGVhay1SU1MgdGhyZXNob2xkXG4gICAqIGFmdGVyIHRoZSBzYW1lIG1lbW9yeSBidXJzdCkgc2lsZW50bHkgcmVtb3ZlcyBhbGwgcG9vbGVkIGNhcGFjaXR5IGZvciB0aGVcbiAgICogd2hvbGUgZHJhaW4gd2luZG93LCB3aGljaCBjYW4gc3RyZXRjaCB0byB0aGUgbG9uZ2VzdCBpbi1mbGlnaHQgam9iLiBUaGVcbiAgICogcmV0aXJpbmcgY2hpbGQgc3RvcHMgcmVjZWl2aW5nIG5ldyBqb2JzIGFuZCBpcyB0ZXJtaW5hdGVkIG9ubHkgb25jZSBpdHNcbiAgICogaW4tZmxpZ2h0IHNldCBkcmFpbnMsIHNvIGEgbG9uZy1ydW5uaW5nIGpvYiAoZS5nLiBhIGJ1aWxkKSBpcyBuZXZlciBjdXRcbiAgICogb2ZmLiBXaGVuIHRoZSBwb29sIGFscmVhZHkgY2FycmllcyBpdHMgYm91bmRlZCBvdmVyLWNhcCBjaGlsZCwgcmV0aXJpbmdcbiAgICogdGhlIGxhc3Qgd29ya2luZyBjaGlsZCBpcyBkZWZlcnJlZCBpbnN0ZWFkIG9mIGVtcHR5aW5nIHRoZSB3b3JraW5nIHBvb2w6XG4gICAqIHRoZSBjaGlsZCBrZWVwcyBzZXJ2aW5nIGFuZCBhIGxhdGVyIG9ic2VydmF0aW9uIHJldHJpZXMgdGhlIHJldGlyZW1lbnRcbiAgICogb25jZSBhIGRyYWluaW5nIGV4aXQgaGFzIGZyZWVkIGEgY2FwIHNsb3QsIHNvIGFkdmVydGlzZWQgY2FwYWNpdHkgY2Fubm90XG4gICAqIGNvbGxhcHNlIHRvIHplcm8gaW5zaWRlIGEgd2F2ZS5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCJub2RlOmNoaWxkX3Byb2Nlc3NcIikuQ2hpbGRQcm9jZXNzfSBjaGlsZCAtIENoaWxkIHRvIHJldGlyZS5cbiAgICogQHJldHVybnMge3ZvaWR9XG4gICAqL1xuICBfYmVnaW5SZXRpcmVQb29sZWRDaGlsZChjaGlsZCkge1xuICAgIGNvbnN0IHN0YXRlID0gdGhpcy5wb29sZWRDaGlsZFN0YXRlcy5nZXQoY2hpbGQpXG4gICAgaWYgKCFzdGF0ZSB8fCBzdGF0ZS5yZXRpcmluZykgcmV0dXJuXG5cbiAgICAvLyBSZXRpcmluZyB0aGUgbGFzdCBub24tcmV0aXJpbmcgY2hpbGQgd2hpbGUgdGhlIHBvb2wgYWxyZWFkeSBjYXJyaWVzIGl0c1xuICAgIC8vIGJvdW5kZWQgb3Zlci1jYXAgY2hpbGQgd291bGQgbGVhdmUgYWR2ZXJ0aXNlZCBjYXBhY2l0eSBhdCB6ZXJvIHVudGlsIHRoZVxuICAgIC8vIG5leHQgZHJhaW5pbmcgZXhpdCDigJQgdXAgdG8gdGhlIGxvbmdlc3QgaW4tZmxpZ2h0IGpvYiAodGVucyBvZiBtaW51dGVzXG4gICAgLy8gd2l0aCBidWlsZHMpLCBzdGFsbGluZyBkaXNwYXRjaCBjbHVzdGVyLXdpZGUuIERlZmVyIHRoaXMgcmV0aXJlbWVudFxuICAgIC8vIGluc3RlYWQ6IHRoZSBjaGlsZCBrZWVwcyBzZXJ2aW5nIGFuZCBhIGxhdGVyIG9ic2VydmF0aW9uIHJldHJpZXMgb25jZSBhXG4gICAgLy8gZHJhaW4gaGFzIGZyZWVkIGEgY2FwIHNsb3QgZm9yIGl0cyByZXBsYWNlbWVudC5cbiAgICBpZiAoIXRoaXMuc2hvdWxkU3RvcCAmJiB0aGlzLmNvbmZpZ3VyYXRpb24gJiYgdGhpcy5fbm9uUmV0aXJpbmdQb29sZWRDaGlsZENvdW50KCkgPD0gMSAmJiB0aGlzLnBvb2xlZENoaWxkcmVuLnNpemUgPiB0aGlzLnBvb2xlZFJ1bm5lckNvdW50KSB7XG4gICAgICB0aGlzLl9sb2dQb29sZWRDYXBhY2l0eUV2ZW50KFwicG9vbGVkLWNhcGFjaXR5LXJldGlyZW1lbnQtZGVmZXJyZWRcIilcbiAgICAgIHJldHVyblxuICAgIH1cblxuICAgIHN0YXRlLnJldGlyaW5nID0gdHJ1ZVxuICAgIC8vIEJlc3QtZWZmb3J0IHByZS13YXJtOiBza2lwIHdoZW4gc3RvcHBpbmcgKG5vIG5ldyB3b3JrKSBvciBiZWZvcmUgdGhlXG4gICAgLy8gd29ya2VyIGlzIGluaXRpYWxpemVkIChubyBjb25maWd1cmF0aW9uIHRvIGZvcmsgYSBjaGlsZCBmcm9tKS4gVGhlIGNhcFxuICAgIC8vIGluc2lkZSBfY3JlYXRlUG9vbGVkQ2hpbGQgcmVmdXNlcyB0aGUgc3Bhd24gd2hpbGUgdGhlIHBvb2wgaXMgZnVsbCwgaW5cbiAgICAvLyB3aGljaCBjYXNlIHRoZSBib3VuZGVkIGxpdmVuZXNzIHJlcGxhY2VtZW50IGJlbG93IHRha2VzIG92ZXIuXG4gICAgaWYgKHRoaXMuc2hvdWxkU3RvcCB8fCAhdGhpcy5jb25maWd1cmF0aW9uKSByZXR1cm5cblxuICAgIGlmICh0aGlzLl9jcmVhdGVQb29sZWRDaGlsZCgpKSB7XG4gICAgICAvLyBGcmVzaCBjYXBhY2l0eSBleGlzdHM6IHJlLWFkdmVydGlzZSBzbyB0aGUgbWFpbiBjYW4gZGlzcGF0Y2ggaW50byBpdFxuICAgICAgLy8gd2l0aG91dCB3YWl0aW5nIGZvciB0aGUgbmV4dCBqb2Igb3V0Y29tZS5cbiAgICAgIHRoaXMuX3NlbmRSZWFkeUlmUnVubmluZygpXG4gICAgICByZXR1cm5cbiAgICB9XG4gICAgaWYgKHRoaXMuX25vblJldGlyaW5nUG9vbGVkQ2hpbGRDb3VudCgpID4gMCkgcmV0dXJuXG5cbiAgICAvLyBMaXZlbmVzcyByZXBsYWNlbWVudDogdGhpcyBtYXJrIGVtcHRpZWQgdGhlIHdvcmtpbmcgcG9vbC4gUmUtYWR2ZXJ0aXNlXG4gICAgLy8gdGhlIHJlc3RvcmVkIGNhcGFjaXR5IGltbWVkaWF0ZWx5IGFmdGVyIHRoZSBib3VuZGVkIG92ZXItY2FwIHNwYXduLlxuICAgIGlmICh0aGlzLl9lbnN1cmVOb25SZXRpcmluZ0NoaWxkKCkpIHRoaXMuX3NlbmRSZWFkeUlmUnVubmluZygpXG4gIH1cblxuICAvKipcbiAgICogS2VlcHMg4oCUIG9yIHJlc3RvcmVzIOKAlCBhdCBsZWFzdCBvbmUgbm9uLXJldGlyaW5nIHBvb2xlZCBjaGlsZCB0aHJvdWdoIHRoZVxuICAgKiBib3VuZGVkIG92ZXItY2FwIGxpdmVuZXNzIHJlcGxhY2VtZW50LCB1c2VkIGJ5IGJvdGggdGhlIHJldGlyZW1lbnQgbWFya1xuICAgKiAoYF9iZWdpblJldGlyZVBvb2xlZENoaWxkYCkgYW5kIHRoZSBjaGlsZC1leGl0IHBhdGhcbiAgICogKGBfaGFuZGxlUG9vbGVkQ2hpbGRGYWlsdXJlYCk6IGFkdmVydGlzZWQgY2FwYWNpdHkgaXMgemVybyB3aGlsZSBldmVyeVxuICAgKiBsaXZlIGNoaWxkIGlzIHJldGlyaW5nLCBhbmQgb25jZSB0aGV5IGFyZSBhbGwgcmV0aXJpbmcgbm8gZnVydGhlclxuICAgKiByZXRpcmVtZW50IG1hcmsgcmVtYWlucyB0byByZXN0b3JlIGEgd29ya2luZyBjaGlsZCDigJQgbm9yIGNhbiBhIGxhenlcbiAgICogcmVwbGFjZW1lbnQgc3Bhd24gd2hpbGUgdGhlIHBvb2wgY291bnRzIGF0IGl0cyBjYXAg4oCUIHNvIGRpc3BhdGNoIHdvdWxkXG4gICAqIHN0YWxsIGNsdXN0ZXItd2lkZSB1bnRpbCB0aGUgbmV4dCBkcmFpbmluZyBleGl0LCB1cCB0byB0aGUgbG9uZ2VzdFxuICAgKiBpbi1mbGlnaHQgam9iIChlLmcuIGEgbXVsdGktbWludXRlIGJ1aWxkKS4gU3Bhd25zIG9uZSByZXBsYWNlbWVudCBvdmVyIHRoZVxuICAgKiBoYXJkIGNhcCAoYm91bmRlZDogdGhlIGdhdGUgYWRtaXRzIGl0IG9ubHkgd2hlbiB0aGUgbGl2ZSBjb3VudCBpcyBhdCBtb3N0XG4gICAqIHRoZSBjYXAsIHNvIGF0IG1vc3Qgb25lIG92ZXItY2FwIGNoaWxkIGV4aXN0cyBhbmQgdGhlIG5leHQgZHJhaW5pbmcgZXhpdFxuICAgKiBhYnNvcmJzIGl0KS4gV2hlbiBldmVuIHRoYXQgc3Bhd24gaXMgdW5hdmFpbGFibGUgKGFuIG92ZXItY2FwIGNoaWxkIGlzXG4gICAqIGFscmVhZHkgZHJhaW5pbmcpLCB0aGUgYm91bmRlZCBzdGFydmF0aW9uIGlzIGxvZ2dlZCBzbyBpdCBpcyB2aXNpYmxlXG4gICAqIGluc3RlYWQgb2Ygc2lsZW50LlxuICAgKiBAcmV0dXJucyB7Ym9vbGVhbn0gLSBUcnVlIHdoZW4gYSByZXBsYWNlbWVudCBjaGlsZCB3YXMgc3Bhd25lZC5cbiAgICovXG4gIF9lbnN1cmVOb25SZXRpcmluZ0NoaWxkKCkge1xuICAgIGlmICh0aGlzLnNob3VsZFN0b3AgfHwgIXRoaXMuY29uZmlndXJhdGlvbikgcmV0dXJuIGZhbHNlXG4gICAgaWYgKHRoaXMuX25vblJldGlyaW5nUG9vbGVkQ2hpbGRDb3VudCgpID4gMCkgcmV0dXJuIGZhbHNlXG5cbiAgICBpZiAodGhpcy5wb29sZWRDaGlsZHJlbi5zaXplIDw9IHRoaXMucG9vbGVkUnVubmVyQ291bnQpIHtcbiAgICAgIGNvbnN0IGxpdmVuZXNzQ2hpbGQgPSB0aGlzLl9jcmVhdGVQb29sZWRDaGlsZCh7YWxsb3dPdmVyQ2FwOiB0cnVlfSlcblxuICAgICAgaWYgKGxpdmVuZXNzQ2hpbGQpIHtcbiAgICAgICAgdGhpcy5fbG9nUG9vbGVkQ2FwYWNpdHlFdmVudChcInBvb2xlZC1jYXBhY2l0eS1saXZlbmVzcy1zcGF3blwiKVxuICAgICAgICByZXR1cm4gdHJ1ZVxuICAgICAgfVxuICAgIH1cblxuICAgIC8vIEFuIG92ZXItY2FwIGNoaWxkIGlzIGFscmVhZHkgZHJhaW5pbmc6IHRoZSBwb29sIHdhaXRzIGZvciB0aGUgbmV4dFxuICAgIC8vIGRyYWluaW5nIGV4aXQsIHdoaWNoIGZyZWVzIGEgY2FwIHNsb3QgZm9yIGEgbGF6eSByZXBsYWNlbWVudCDigJQgYW5kIHRoYXRcbiAgICAvLyBleGl0IHJlc3RvcmVzIGEgd29ya2luZyBjaGlsZCB0aHJvdWdoIHRoaXMgc2FtZSBwYXRoLiBMb2cgaXQgc28gdGhpc1xuICAgIC8vIGJvdW5kZWQgc3RhcnZhdGlvbiBpcyBub3Qgc2lsZW50LlxuICAgIHRoaXMuX2xvZ1Bvb2xlZENhcGFjaXR5RXZlbnQoXCJwb29sZWQtY2FwYWNpdHktc3RhcnZlZFwiKVxuICAgIHJldHVybiBmYWxzZVxuICB9XG5cbiAgLyoqXG4gICAqIFJlY29yZHMgb25lIHBvb2xlZCBjaGlsZCdzIElQQyBhY3Rpdml0eSBhbmQgcmUtYXJtcyBpdHMgc2lsZW5jZSB3YXRjaGRvZyB3aGlsZVxuICAgKiB0aGF0IGNoaWxkIHN0aWxsIG93bnMgaW4tZmxpZ2h0IGpvYnMuIEV2ZXJ5IG1lc3NhZ2UgdGhlIGNoaWxkIHNlbmRzIOKAlCByZWFkaW5lc3MsXG4gICAqIGFjY2VwdGFuY2UsIG1lbW9yeSBvYnNlcnZhdGlvbiwgc2h1dGRvd24gb2JzZXJ2YXRpb24sIG9yIGpvYiBvdXRjb21lIOKAlCBwcm92ZXMgaXRzXG4gICAqIGV2ZW50IGxvb3AgaXMgcnVubmluZywgYmVjYXVzZSBhIGhlYWx0aHkgY2hpbGQgc2FtcGxlcyBpdHNlbGYgZXZlcnkgMTAgc2Vjb25kc1xuICAgKiB3aGlsZSBqb2JzIGFyZSBpbiBmbGlnaHQuIFNpbGVuY2UgcGFzdCB0aGUgYm91bmQgdGhlcmVmb3JlIG1lYW5zIGEgd2VkZ2VkIGNoaWxkXG4gICAqIHRoYXQgY2FuIG5vIGxvbmdlciBwcm92ZSBpdCBpcyBhbGl2ZSwgbm90IGEgYnVzeSBvbmUuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gQWN0aXZpdHkgZGV0YWlscy5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCJub2RlOmNoaWxkX3Byb2Nlc3NcIikuQ2hpbGRQcm9jZXNzfSBhcmdzLmNoaWxkIC0gUG9vbGVkIGNoaWxkLlxuICAgKiBAcGFyYW0ge1Bvb2xlZENoaWxkU3RhdGUgfCB1bmRlZmluZWR9IGFyZ3Muc3RhdGUgLSBDaGlsZCBzdGF0ZS5cbiAgICogQHJldHVybnMge3ZvaWR9XG4gICAqL1xuICBfbm90ZVBvb2xlZENoaWxkQWN0aXZpdHkoe2NoaWxkLCBzdGF0ZX0pIHtcbiAgICBpZiAoIXN0YXRlKSByZXR1cm5cbiAgICBzdGF0ZS5sYXN0QWN0aXZpdHlBdE1zID0gRGF0ZS5ub3coKVxuICAgIGlmIChzdGF0ZS5pbmZsaWdodC5zaXplID4gMCAmJiAhc3RhdGUuc2V0dGxpbmcpIHRoaXMuX2FybVBvb2xlZENoaWxkU2lsZW5jZVRpbWVyKHtjaGlsZCwgc3RhdGV9KVxuICB9XG5cbiAgLyoqXG4gICAqIFJlc29sdmVzIHRoZSBlZmZlY3RpdmUgcG9vbGVkLWNoaWxkIHNpbGVuY2UgYm91bmQgaW4gbXMsIG9yIG51bGwgd2hlbiBkaXNhYmxlZC5cbiAgICogQSBub24tcG9zaXRpdmUgb3Igbm9uLWZpbml0ZSB2YWx1ZSBkaXNhYmxlcyB0aGUgd2F0Y2hkb2cgYXQgd2hpY2hldmVyIGxldmVsXG4gICAqIHN1cHBsaWVkIGl0LCBtYXRjaGluZyB0aGUgam9iLXRpbWVvdXQgY29udHJhY3QuXG4gICAqIEByZXR1cm5zIHtudW1iZXIgfCBudWxsfSAtIEJvdW5kIGluIG1zLCBvciBudWxsIHdoZW4gZGlzYWJsZWQuXG4gICAqL1xuICBfcmVzb2x2ZVBvb2xlZENoaWxkU2lsZW5jZVRpbWVvdXRNcygpIHtcbiAgICBjb25zdCByYXcgPSB0aGlzLnBvb2xlZFJ1bm5lclNpbGVuY2VUaW1lb3V0TXNcblxuICAgIGlmICh0eXBlb2YgcmF3ICE9PSBcIm51bWJlclwiIHx8ICFOdW1iZXIuaXNGaW5pdGUocmF3KSB8fCByYXcgPD0gMCkgcmV0dXJuIG51bGxcblxuICAgIHJldHVybiBNYXRoLm1pbihyYXcsIE1BWF9GT1JLRURfSk9CX1RJTUVPVVRfTVMpXG4gIH1cblxuICAvKipcbiAgICogUmUtYXJtcyBvbmUgY2hpbGQncyBzaWxlbmNlIHdhdGNoZG9nIGZyb20gaXRzIGxhc3Qgb2JzZXJ2ZWQgYWN0aXZpdHkuIE9ubHlcbiAgICogY2hpbGRyZW4gd2l0aCBpbi1mbGlnaHQgam9icyBhcmUgd2F0Y2hlZDogYSBjaGlsZCB3aXRoIG5vdGhpbmcgaW4gZmxpZ2h0IGNhbm5vdFxuICAgKiBzdHJhbmQgd29yaywgYW5kIGl0cyBwZXJpb2RpYyBzYW1wbGVyIGlzIGluYWN0aXZlIHRoZW4sIHNvIHNpbGVuY2UgaXMgbm90XG4gICAqIGV2aWRlbmNlIG9mIGEgd2VkZ2UuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gV2F0Y2hkb2cgZGV0YWlscy5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCJub2RlOmNoaWxkX3Byb2Nlc3NcIikuQ2hpbGRQcm9jZXNzfSBhcmdzLmNoaWxkIC0gUG9vbGVkIGNoaWxkLlxuICAgKiBAcGFyYW0ge1Bvb2xlZENoaWxkU3RhdGV9IGFyZ3Muc3RhdGUgLSBDaGlsZCBzdGF0ZS5cbiAgICogQHJldHVybnMge3ZvaWR9XG4gICAqL1xuICBfYXJtUG9vbGVkQ2hpbGRTaWxlbmNlVGltZXIoe2NoaWxkLCBzdGF0ZX0pIHtcbiAgICBjb25zdCB0aW1lb3V0TXMgPSB0aGlzLl9yZXNvbHZlUG9vbGVkQ2hpbGRTaWxlbmNlVGltZW91dE1zKClcbiAgICBpZiAoISh0eXBlb2YgdGltZW91dE1zID09PSBcIm51bWJlclwiICYmIHRpbWVvdXRNcyA+IDApKSByZXR1cm5cblxuICAgIGlmIChzdGF0ZS5zaWxlbmNlVGltZXIpIGNsZWFyVGltZW91dChzdGF0ZS5zaWxlbmNlVGltZXIpXG4gICAgc3RhdGUuc2lsZW5jZVRpbWVyID0gc2V0VGltZW91dCgoKSA9PiB0aGlzLl9vblBvb2xlZENoaWxkU2lsZW5jZSh7Y2hpbGQsIHN0YXRlfSksIHRpbWVvdXRNcylcbiAgICBpZiAodHlwZW9mIHN0YXRlLnNpbGVuY2VUaW1lci51bnJlZiA9PT0gXCJmdW5jdGlvblwiKSBzdGF0ZS5zaWxlbmNlVGltZXIudW5yZWYoKVxuICB9XG5cbiAgLyoqXG4gICAqIEZpcmVkIHdoZW4gYSBwb29sZWQgY2hpbGQgd2l0aCBpbi1mbGlnaHQgam9icyBzdGF5cyBzaWxlbnQgcGFzdCB0aGUgYm91bmQuIEFcbiAgICogd2VkZ2VkIGNoaWxkIGtlZXBzIGl0cyBJUEMgY2hhbm5lbCBvcGVuIGJ1dCBzdG9wcyBydW5uaW5nIGl0cyBvd24gdGltZXJzLCBzbyB0aGVcbiAgICogZGlzY29ubmVjdC9leGl0IHBhdGggbmV2ZXIgZmlyZXMgYW5kIGl0cyBqb2JzIHN0YXkgc3RyYW5kZWQgdW50aWwgYSBodW1hblxuICAgKiBub3RpY2VzLiBUaGUgd29ya2VyIGRlY2xhcmVzIHRoZSBjaGlsZCBkZWFkOiBpdCByZXF1ZXN0cyBzaHV0ZG93biB1bmRlciB0aGUgZXhhY3RcbiAgICogYGNoaWxkX3NpbGVuY2VgIHJlYXNvbiwgcmVwb3J0cyB0aGUgd2hvbGUgaW4tZmxpZ2h0IHNldCBhcyBmYWlsZWQgdGhyb3VnaCB0aGVcbiAgICogZXN0YWJsaXNoZWQgZmFpbHVyZSBwYXRoIChzbyB0aGUgam9icyByZXF1ZXVlIGFuZCBjYXBhY2l0eSBpcyByZS1hZHZlcnRpc2VkKSwgYW5kXG4gICAqIHNpZ25hbHMgdGhlIHdlZGdlZCBwcm9jZXNzIOKAlCBTSUdURVJNLCB0aGVuIFNJR0tJTEwgYWZ0ZXIgdGhlIGV4aXN0aW5nIGdyYWNlIOKAlCBzb1xuICAgKiBpdCBhY3R1YWxseSBnb2VzIGF3YXkgaW5zdGVhZCBvZiBibG9ja2luZyB0aGUgZXZlbnQgbG9vcCBmb3JldmVyLlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIFdhdGNoZG9nIGRldGFpbHMuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwibm9kZTpjaGlsZF9wcm9jZXNzXCIpLkNoaWxkUHJvY2Vzc30gYXJncy5jaGlsZCAtIFBvb2xlZCBjaGlsZC5cbiAgICogQHBhcmFtIHtQb29sZWRDaGlsZFN0YXRlfSBhcmdzLnN0YXRlIC0gQ2hpbGQgc3RhdGUuXG4gICAqIEByZXR1cm5zIHt2b2lkfVxuICAgKi9cbiAgX29uUG9vbGVkQ2hpbGRTaWxlbmNlKHtjaGlsZCwgc3RhdGV9KSB7XG4gICAgc3RhdGUuc2lsZW5jZVRpbWVyID0gdW5kZWZpbmVkXG4gICAgaWYgKHN0YXRlLnNldHRsaW5nIHx8IHN0YXRlLnNodXRkb3duUmVhc29uKSByZXR1cm5cbiAgICBjb25zdCBzaWxlbnRNcyA9IERhdGUubm93KCkgLSBzdGF0ZS5sYXN0QWN0aXZpdHlBdE1zXG4gICAgY29uc3QgYm91bmRNcyA9IHRoaXMuX3Jlc29sdmVQb29sZWRDaGlsZFNpbGVuY2VUaW1lb3V0TXMoKVxuICAgIGlmICghKHR5cGVvZiBib3VuZE1zID09PSBcIm51bWJlclwiICYmIHNpbGVudE1zID49IGJvdW5kTXMpKSByZXR1cm5cblxuICAgIGNvbnN0IGVycm9yID0gbmV3IEVycm9yKGBQb29sZWQgYmFja2dyb3VuZCBqb2IgcnVubmVyIHdlbnQgc2lsZW50IGZvciAke3NpbGVudE1zfW1zIHBhc3QgdGhlICR7Ym91bmRNc31tcyBib3VuZCDigJQgdHJlYXRlZCBhcyB3ZWRnZWRgKVxuICAgIHRoaXMuX2xvZ1Bvb2xlZFNpbGVuY2VFdmVudCh7Y2hpbGQsIHN0YXRlLCBzaWxlbnRNcywgYm91bmRNc30pXG4gICAgdGhpcy5fcmVxdWVzdFBvb2xlZENoaWxkU2h1dGRvd24oe2NoaWxkLCByZWFzb246IFwiY2hpbGRfc2lsZW5jZVwiLCBzaWduYWw6IFwiU0lHVEVSTVwifSlcbiAgICB2b2lkIHRoaXMuX2hhbmRsZVBvb2xlZENoaWxkRmFpbHVyZSh7Y2hpbGQsIGVycm9yLCBvcmlnaW46IFwiY2hpbGQtc2lsZW5jZVwiLCBzaWduYWw6IG51bGx9KVxuICAgIHN0YXRlLnNpbGVuY2VTaWdraWxsVGltZXIgPSBzZXRUaW1lb3V0KCgpID0+IHtcbiAgICAgIHN0YXRlLnNpbGVuY2VTaWdraWxsVGltZXIgPSB1bmRlZmluZWRcbiAgICAgIHRoaXMuX3NpZ25hbFBvb2xlZENoaWxkKHtjaGlsZCwgc2lnbmFsOiBcIlNJR0tJTExcIn0pXG4gICAgfSwgdGhpcy5mb3JrZWRDaGlsZFNpZ2tpbGxHcmFjZU1zKVxuICAgIGlmICh0eXBlb2Ygc3RhdGUuc2lsZW5jZVNpZ2tpbGxUaW1lci51bnJlZiA9PT0gXCJmdW5jdGlvblwiKSBzdGF0ZS5zaWxlbmNlU2lna2lsbFRpbWVyLnVucmVmKClcbiAgfVxuXG4gIC8qKlxuICAgKiBMb2dzIG9uZSBjb21wYWN0IEpTT04gbGluZSBuYW1pbmcgYSBjaGlsZCB0aGUgc2lsZW5jZSB3YXRjaGRvZyBkZWNsYXJlZCB3ZWRnZWRcbiAgICogKHRoZSBzYW1lIHN0ZGVyciBzdXJmYWNlIHRoZSBtZW1vcnkgb2JzZXJ2YXRpb25zIHVzZSwgd2hpY2ggcmVhY2hlcyB0aGUgcHJvZHVjdGlvblxuICAgKiBsb2cpLCBzbyB0aGUgcmVjb3ZlcnkgaXMgYXR0cmlidXRhYmxlIGFmdGVyIHRoZSBmYWN0IGluc3RlYWQgb2YgbG9va2luZyBsaWtlIGFcbiAgICogcmFuZG9tIHJ1bm5lciBleGl0LlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIEV2ZW50IGRldGFpbHMuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwibm9kZTpjaGlsZF9wcm9jZXNzXCIpLkNoaWxkUHJvY2Vzc30gYXJncy5jaGlsZCAtIFBvb2xlZCBjaGlsZC5cbiAgICogQHBhcmFtIHtQb29sZWRDaGlsZFN0YXRlfSBhcmdzLnN0YXRlIC0gQ2hpbGQgc3RhdGUuXG4gICAqIEBwYXJhbSB7bnVtYmVyfSBhcmdzLnNpbGVudE1zIC0gT2JzZXJ2ZWQgc2lsZW5jZSBpbiBtcy5cbiAgICogQHBhcmFtIHtudW1iZXJ9IGFyZ3MuYm91bmRNcyAtIENvbmZpZ3VyZWQgYm91bmQgaW4gbXMuXG4gICAqIEByZXR1cm5zIHt2b2lkfVxuICAgKi9cbiAgX2xvZ1Bvb2xlZFNpbGVuY2VFdmVudCh7Y2hpbGQsIHN0YXRlLCBzaWxlbnRNcywgYm91bmRNc30pIHtcbiAgICBjb25zb2xlLmVycm9yKEpTT04uc3RyaW5naWZ5KHtcbiAgICAgIGV2ZW50OiBcInBvb2xlZC1jaGlsZC1zaWxlbmNlXCIsXG4gICAgICBjaGlsZEluc3RhbmNlSWQ6IHN0YXRlLmNoaWxkSW5zdGFuY2VJZCA/PyBudWxsLFxuICAgICAgY2hpbGRQaWQ6IGNoaWxkLnBpZCA/PyBudWxsLFxuICAgICAgc2lsZW50TXMsXG4gICAgICBib3VuZE1zLFxuICAgICAgam9iczogc3RhdGUuaW5mbGlnaHQuc2l6ZVxuICAgIH0pKVxuICB9XG5cbiAgLyoqXG4gICAqIExvZ3Mgb25lIGNvbXBhY3QgcG9vbGVkLWNhcGFjaXR5IGV2ZW50IHRvIHRoZSB3b3JrZXIncyBvd24gc3RkZXJyICh0aGVcbiAgICogc3VyZmFjZSB0aGF0IHJlYWNoZXMgdGhlIHByb2R1Y3Rpb24gbG9nKS4gVXNlZCBieSB0aGUgYm91bmRlZCBsaXZlbmVzc1xuICAgKiByZXBsYWNlbWVudCBpbiBgX2Vuc3VyZU5vblJldGlyaW5nQ2hpbGRgOiB0aGUgc3Bhd24gdGhhdCBrZWVwcyBkaXNwYXRjaFxuICAgKiBhbGl2ZSB0aHJvdWdoIGEgZnVsbCByZXRpcmVtZW50IHdhdmUgKGF0IGEgcmV0aXJlbWVudCBtYXJrIG9yIGEgY2hpbGRcbiAgICogZXhpdCksIHRoZSBkZWZlcnJlZCByZXRpcmVtZW50IG9mIHRoZSBsYXN0IHdvcmtpbmcgY2hpbGQgd2hpbGUgdGhlIHBvb2xcbiAgICogYWxyZWFkeSBjYXJyaWVzIGl0cyBib3VuZGVkIG92ZXItY2FwIGNoaWxkIChyZXRyaWVkIGFmdGVyIHRoZSBuZXh0IGRyYWluXG4gICAqIGZyZWVzIGEgY2FwIHNsb3QpLCBvciB0aGUgYm91bmRlZCBzdGFydmF0aW9uIHdoZW4gYW4gb3Zlci1jYXAgY2hpbGQgaXNcbiAgICogYWxyZWFkeSBkcmFpbmluZyBhbmQgdGhlIHBvb2wgbXVzdCB3YWl0IGZvciBhbiBleGl0LlxuICAgKiBAcGFyYW0ge1wicG9vbGVkLWNhcGFjaXR5LWxpdmVuZXNzLXNwYXduXCIgfCBcInBvb2xlZC1jYXBhY2l0eS1zdGFydmVkXCIgfCBcInBvb2xlZC1jYXBhY2l0eS1yZXRpcmVtZW50LWRlZmVycmVkXCJ9IGV2ZW50IC0gRXZlbnQgbmFtZS5cbiAgICogQHJldHVybnMge3ZvaWR9XG4gICAqL1xuICBfbG9nUG9vbGVkQ2FwYWNpdHlFdmVudChldmVudCkge1xuICAgIGxldCByZXRpcmluZ0NoaWxkcmVuID0gMFxuXG4gICAgZm9yIChjb25zdCBzdGF0ZSBvZiB0aGlzLnBvb2xlZENoaWxkU3RhdGVzLnZhbHVlcygpKSB7XG4gICAgICBpZiAoc3RhdGUucmV0aXJpbmcpIHJldGlyaW5nQ2hpbGRyZW4gKz0gMVxuICAgIH1cblxuICAgIGNvbnNvbGUuZXJyb3IoSlNPTi5zdHJpbmdpZnkoe1xuICAgICAgZXZlbnQsXG4gICAgICBsaXZlQ2hpbGRyZW46IHRoaXMucG9vbGVkQ2hpbGRyZW4uc2l6ZSxcbiAgICAgIHJldGlyaW5nQ2hpbGRyZW4sXG4gICAgICBjYXA6IHRoaXMucG9vbGVkUnVubmVyQ291bnQsXG4gICAgICBjb25jdXJyZW5jeTogdGhpcy5wb29sZWRSdW5uZXJDb25jdXJyZW5jeVxuICAgIH0pKVxuICB9XG5cbiAgLyoqXG4gICAqIFRlcm1pbmF0ZXMgYSByZXRpcmluZyBwb29sZWQgY2hpbGQgb25jZSBpdCBoYXMgbm8gaW4tZmxpZ2h0IGpvYnMgbGVmdC5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCJub2RlOmNoaWxkX3Byb2Nlc3NcIikuQ2hpbGRQcm9jZXNzfSBjaGlsZCAtIENoaWxkIHRvIGNoZWNrLlxuICAgKiBAcmV0dXJucyB7dm9pZH1cbiAgICovXG4gIF90ZXJtaW5hdGVJZkRyYWluZWQoY2hpbGQpIHtcbiAgICBjb25zdCBzdGF0ZSA9IHRoaXMucG9vbGVkQ2hpbGRTdGF0ZXMuZ2V0KGNoaWxkKVxuICAgIGlmICghc3RhdGUgfHwgIXN0YXRlLnJldGlyaW5nIHx8IHN0YXRlLmluZmxpZ2h0LnNpemUgPiAwKSByZXR1cm5cblxuICAgIHRoaXMuX3JldGlyZVBvb2xlZENoaWxkKGNoaWxkKVxuICB9XG5cbiAgLyoqXG4gICAqIFJldGlyZXMgYSBkcmFpbmVkIHBvb2xlZCBjaGlsZCAocmVtb3ZlcyBpdCBmcm9tIHRyYWNraW5nLCB0aGVuIFNJR1RFUk1zIGl0KS5cbiAgICogQmVjYXVzZSB0aGUgaGFyZCBjYXAgY291bnRzIGxpdmUgY2hpbGRyZW4sIHRoZSBleGl0IG9mIHRoaXMgY2hpbGQgZnJlZXMgYVxuICAgKiBzbG90OiBhbnkgZGVmZXJyZWQgcmVwbGFjZW1lbnQgKHRoZSBwb29sIHdhcyBmdWxsIHdoZW4gdGhlIGNoaWxkIHJldGlyZWQpXG4gICAqIGlzIHNwYXduZWQgbm93LCBhbmQgY2FwYWNpdHkgaXMgcmUtYWR2ZXJ0aXNlZCBzbyBtYWluIGNhbiBkaXNwYXRjaCBpbnRvIGl0LlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIm5vZGU6Y2hpbGRfcHJvY2Vzc1wiKS5DaGlsZFByb2Nlc3N9IGNoaWxkIC0gQ2hpbGQgcHJvY2VzcyB0byByZXRpcmUuXG4gICAqIEByZXR1cm5zIHt2b2lkfVxuICAgKi9cbiAgX3JldGlyZVBvb2xlZENoaWxkKGNoaWxkKSB7XG4gICAgY29uc3Qgc3RhdGUgPSB0aGlzLnBvb2xlZENoaWxkU3RhdGVzLmdldChjaGlsZClcbiAgICBpZiAoIXN0YXRlKSB0aHJvdyBuZXcgRXJyb3IoXCJDYW5ub3QgcmV0aXJlIHBvb2xlZCBjaGlsZCB3aXRob3V0IHRyYWNrZWQgc3RhdGVcIilcbiAgICBpZiAoc3RhdGUuaW5mbGlnaHQuc2l6ZSA+IDApIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihgQ2Fubm90IHJldGlyZSBwb29sZWQgY2hpbGQgd2hpbGUgJHtzdGF0ZS5pbmZsaWdodC5zaXplfSAke3N0YXRlLmluZmxpZ2h0LnNpemUgPT09IDEgPyBcImpvYiByZW1haW5zXCIgOiBcImpvYnMgcmVtYWluXCJ9IGluIGZsaWdodGApXG4gICAgfVxuXG4gICAgdGhpcy5wb29sZWRDaGlsZHJlbi5kZWxldGUoY2hpbGQpXG4gICAgc3RhdGUucmV0aXJpbmcgPSB0cnVlXG4gICAgdGhpcy5fcmVxdWVzdFBvb2xlZENoaWxkU2h1dGRvd24oe2NoaWxkLCByZWFzb246IFwicGFyZW50X3JldGlyZV9kcmFpbmVkXCIsIHNpZ25hbDogXCJTSUdURVJNXCIsIHdhaXRGb3JPYnNlcnZhdGlvbjogdHJ1ZX0pXG4gIH1cblxuICAvKipcbiAgICogUmVjb3JkcyBhbiBleGFjdCBwYXJlbnQgcmVxdWVzdCBiZWZvcmUgSVBDIG9yIHNpZ25hbCBkZWxpdmVyeS4gRHJhaW5lZFxuICAgKiByZXRpcmVtZW50IGdldHMgYSBicmllZiBJUEMtZmlyc3QgZ3JhY2Ugc28gaXRzIHplcm8tam9iIG9ic2VydmF0aW9uIGlzXG4gICAqIGRldGVybWluaXN0aWM7IHRpbWVvdXQvd29ya2VyLXN0b3AgcGF0aHMgc2lnbmFsIGltbWVkaWF0ZWx5LlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIFNodXRkb3duIHJlcXVlc3QuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwibm9kZTpjaGlsZF9wcm9jZXNzXCIpLkNoaWxkUHJvY2Vzc30gYXJncy5jaGlsZCAtIFBvb2xlZCBjaGlsZC5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL3R5cGVzLmpzXCIpLlBvb2xlZENoaWxkU2h1dGRvd25SZWFzb259IGFyZ3MucmVhc29uIC0gRXhhY3QgcGFyZW50IHJlYXNvbi5cbiAgICogQHBhcmFtIHtrZXlvZiB0eXBlb2YgaW1wb3J0KFwibm9kZTpvc1wiKS5jb25zdGFudHMuc2lnbmFsc30gYXJncy5zaWduYWwgLSBTaWduYWwgdG8gZGVsaXZlci5cbiAgICogQHBhcmFtIHtib29sZWFufSBbYXJncy53YWl0Rm9yT2JzZXJ2YXRpb25dIC0gV2hldGhlciBJUEMgb2JzZXJ2YXRpb24gbWF5IHByZWNlZGUgc2lnbmFsIGZhbGxiYWNrLlxuICAgKiBAcmV0dXJucyB7dm9pZH1cbiAgICovXG4gIF9yZXF1ZXN0UG9vbGVkQ2hpbGRTaHV0ZG93bih7Y2hpbGQsIHJlYXNvbiwgc2lnbmFsLCB3YWl0Rm9yT2JzZXJ2YXRpb24gPSBmYWxzZX0pIHtcbiAgICBjb25zdCBzdGF0ZSA9IHRoaXMucG9vbGVkQ2hpbGRTdGF0ZXMuZ2V0KGNoaWxkKVxuICAgIGlmICghc3RhdGUgfHwgc3RhdGUuc2V0dGxpbmcgfHwgc3RhdGUuc2h1dGRvd25SZWFzb24pIHJldHVyblxuXG4gICAgY29uc3Qgc2h1dGRvd25SZXF1ZXN0ZWRBdE1zID0gRGF0ZS5ub3coKVxuICAgIHN0YXRlLnNodXRkb3duUmVhc29uID0gcmVhc29uXG4gICAgc3RhdGUuc2h1dGRvd25SZXF1ZXN0ZWRBdE1zID0gc2h1dGRvd25SZXF1ZXN0ZWRBdE1zXG4gICAgc3RhdGUuc2h1dGRvd25TaWduYWwgPSBzaWduYWxcblxuICAgIGxldCByZXF1ZXN0U2VudCA9IGZhbHNlXG4gICAgaWYgKGNoaWxkLmNvbm5lY3RlZCkge1xuICAgICAgdHJ5IHtcbiAgICAgICAgY2hpbGQuc2VuZCh7dHlwZTogXCJzaHV0ZG93bi1yZXF1ZXN0XCIsIHJlYXNvbiwgc2h1dGRvd25SZXF1ZXN0ZWRBdE1zLCBzaWduYWx9LCAoZXJyb3IpID0+IHtcbiAgICAgICAgICBpZiAoIWVycm9yIHx8ICF3YWl0Rm9yT2JzZXJ2YXRpb24gfHwgc3RhdGUuc2V0dGxpbmcpIHJldHVyblxuXG4gICAgICAgICAgaWYgKHN0YXRlLnNodXRkb3duU2lnbmFsVGltZXIpIHtcbiAgICAgICAgICAgIGNsZWFyVGltZW91dChzdGF0ZS5zaHV0ZG93blNpZ25hbFRpbWVyKVxuICAgICAgICAgICAgc3RhdGUuc2h1dGRvd25TaWduYWxUaW1lciA9IHVuZGVmaW5lZFxuICAgICAgICAgIH1cbiAgICAgICAgICB0aGlzLl9zaWduYWxQb29sZWRDaGlsZCh7Y2hpbGQsIHNpZ25hbH0pXG4gICAgICAgIH0pXG4gICAgICAgIHJlcXVlc3RTZW50ID0gdHJ1ZVxuICAgICAgfSBjYXRjaCB7XG4gICAgICAgIC8vIFRoZSBzaWduYWwgYmVsb3cgcmVtYWlucyB0aGUgYm91bmRlZCBzaHV0ZG93biBtZWNoYW5pc20uXG4gICAgICB9XG4gICAgfVxuXG4gICAgaWYgKHdhaXRGb3JPYnNlcnZhdGlvbiAmJiByZXF1ZXN0U2VudCkge1xuICAgICAgc3RhdGUuc2h1dGRvd25TaWduYWxUaW1lciA9IHNldFRpbWVvdXQoKCkgPT4ge1xuICAgICAgICBzdGF0ZS5zaHV0ZG93blNpZ25hbFRpbWVyID0gdW5kZWZpbmVkXG4gICAgICAgIHRoaXMuX3NpZ25hbFBvb2xlZENoaWxkKHtjaGlsZCwgc2lnbmFsfSlcbiAgICAgIH0sIFBPT0xFRF9SVU5ORVJfU0hVVERPV05fUkVRVUVTVF9HUkFDRV9NUylcbiAgICAgIHN0YXRlLnNodXRkb3duU2lnbmFsVGltZXIudW5yZWYoKVxuICAgICAgcmV0dXJuXG4gICAgfVxuXG4gICAgdGhpcy5fc2lnbmFsUG9vbGVkQ2hpbGQoe2NoaWxkLCBzaWduYWx9KVxuICB9XG5cbiAgLyoqXG4gICAqIERlbGl2ZXJzIG9uZSBwYXJlbnQtb3duZWQgcHJvY2VzcyBzaWduYWwgd2l0aG91dCBjaGFuZ2luZyByZWNvcmRlZCBwcm92ZW5hbmNlLlxuICAgKiBAcGFyYW0ge3tjaGlsZDogaW1wb3J0KFwibm9kZTpjaGlsZF9wcm9jZXNzXCIpLkNoaWxkUHJvY2Vzcywgc2lnbmFsOiBrZXlvZiB0eXBlb2YgaW1wb3J0KFwibm9kZTpvc1wiKS5jb25zdGFudHMuc2lnbmFsc319IGFyZ3MgLSBTaWduYWwgcmVxdWVzdC5cbiAgICogQHJldHVybnMge3ZvaWR9XG4gICAqL1xuICBfc2lnbmFsUG9vbGVkQ2hpbGQoe2NoaWxkLCBzaWduYWx9KSB7XG4gICAgdHJ5IHtcbiAgICAgIGNoaWxkLmtpbGwoc2lnbmFsKVxuICAgIH0gY2F0Y2gge1xuICAgICAgLy8gQ2hpbGQgYWxyZWFkeSBleGl0ZWQ7IGl0cyBleGl0L2Vycm9yIGhhbmRsZXIgb3ducyBzdGF0ZSBzZXR0bGVtZW50LlxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBSZW1vdmVzIGFuIGV4aXRlZC91bmhlYWx0aHkgcG9vbGVkIGNoaWxkIGFuZCByZXBvcnRzIGV2ZXJ5IGpvYiB0aGF0IHdhc1xuICAgKiBpbi1mbGlnaHQgb24gaXQgYXMgZmFpbGVkIOKAlCBhIHByb2Nlc3MtbGV2ZWwgY3Jhc2gncyBibGFzdCByYWRpdXMgaXMgdGhlXG4gICAqIGNoaWxkJ3Mgd2hvbGUgaW4tZmxpZ2h0IHNldC4gT25jZSB0aGUgY2hpbGQgaGFzIGNvbXBsZXRlZCBzdGFydHVwLCBpdHNcbiAgICogZnJlZWQgY2FwYWNpdHkgaXMgYWR2ZXJ0aXNlZCBpbW1lZGlhdGVseTsgdGhlIHJlcGxhY2VtZW50IGl0c2VsZiBpcyBzdGlsbFxuICAgKiBzcGF3bmVkIGxhemlseSBieSB0aGUgbmV4dCBkaXNwYXRjaC4gQSBjaGlsZCB0aGF0IGV4aXRzIGJlZm9yZSBpdHMgc3RhcnR1cFxuICAgKiBoYW5kc2hha2UgZG9lcyBub3QgcmUtYW5ub3VuY2UsIGF2b2lkaW5nIGEgdGlnaHQgcmVzcGF3biBsb29wIG9uIHN0YXJ0dXBcbiAgICogZmFpbHVyZS5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBGYWlsdXJlIGRldGFpbHMuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwibm9kZTpjaGlsZF9wcm9jZXNzXCIpLkNoaWxkUHJvY2Vzc30gYXJncy5jaGlsZCAtIFBvb2xlZCBjaGlsZC5cbiAgICogQHBhcmFtIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gYXJncy5lcnJvciAtIEZhaWx1cmUuXG4gICAqIEBwYXJhbSB7bnVtYmVyIHwgbnVsbH0gW2FyZ3MuZXhpdENvZGVdIC0gQ2hpbGQgZXhpdCBjb2RlIHdoZW4gb2JzZXJ2ZWQuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi90eXBlcy5qc1wiKS5Qb29sZWRSdW5uZXJGYWlsdXJlT3JpZ2lufSBbYXJncy5vcmlnaW5dIC0gV29ya2VyIG9ic2VydmF0aW9uIHRoYXQgaW5pdGlhdGVkIHJlY292ZXJ5LlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIm5vZGU6Y2hpbGRfcHJvY2Vzc1wiKS5DaGlsZFByb2Nlc3NbXCJzaWduYWxDb2RlXCJdfSBbYXJncy5zaWduYWxdIC0gQ2hpbGQgdGVybWluYXRpb24gc2lnbmFsIHdoZW4gb2JzZXJ2ZWQuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fVxuICAgKi9cbiAgYXN5bmMgX2hhbmRsZVBvb2xlZENoaWxkRmFpbHVyZSh7Y2hpbGQsIGVycm9yLCBleGl0Q29kZSA9IG51bGwsIG9yaWdpbiA9IFwicHJvY2Vzcy1lcnJvclwiLCBzaWduYWwgPSBudWxsfSkge1xuICAgIGNvbnN0IHN0YXRlID0gdGhpcy5wb29sZWRDaGlsZFN0YXRlcy5nZXQoY2hpbGQpXG4gICAgaWYgKHN0YXRlPy5zZXR0bGluZykgcmV0dXJuXG4gICAgaWYgKHN0YXRlKSB7XG4gICAgICBzdGF0ZS5zZXR0bGluZyA9IHRydWVcbiAgICAgIC8vIENhbmNlbCB0aGlzIGNoaWxkJ3MgcGVuZGluZyB0aW1lcnMgYmVmb3JlIGl0cyBpbi1mbGlnaHQgc2V0IGlzIHJlcG9ydGVkIOKAlFxuICAgICAgLy8gdGhlIFNJR0tJTEwgZ3JhY2UgZnJvbSBhIHRpbWVvdXQga2lsbCwgYW5kIGV2ZXJ5IGFybWVkIHBlci1qb2IgYmFja3N0b3AuXG4gICAgICBpZiAoc3RhdGUudGltZW91dFNpZ2tpbGxUaW1lcikgY2xlYXJUaW1lb3V0KHN0YXRlLnRpbWVvdXRTaWdraWxsVGltZXIpXG4gICAgICBpZiAoc3RhdGUuc2h1dGRvd25TaWduYWxUaW1lcikgY2xlYXJUaW1lb3V0KHN0YXRlLnNodXRkb3duU2lnbmFsVGltZXIpXG4gICAgICBpZiAoc3RhdGUuc2lsZW5jZVRpbWVyKSBjbGVhclRpbWVvdXQoc3RhdGUuc2lsZW5jZVRpbWVyKVxuICAgICAgaWYgKHN0YXRlLnNpbGVuY2VTaWdraWxsVGltZXIpIGNsZWFyVGltZW91dChzdGF0ZS5zaWxlbmNlU2lna2lsbFRpbWVyKVxuICAgICAgZm9yIChjb25zdCBpbmZsaWdodEVudHJ5IG9mIHN0YXRlLmluZmxpZ2h0LnZhbHVlcygpKSB7XG4gICAgICAgIGlmIChpbmZsaWdodEVudHJ5LnRpbWVvdXRUaW1lcikgY2xlYXJUaW1lb3V0KGluZmxpZ2h0RW50cnkudGltZW91dFRpbWVyKVxuICAgICAgfVxuICAgIH1cbiAgICB0aGlzLnBvb2xlZENoaWxkcmVuLmRlbGV0ZShjaGlsZClcbiAgICB0aGlzLmluZmxpZ2h0UHJvY2Vzc0NoaWxkcmVuLmRlbGV0ZShjaGlsZClcbiAgICAvLyBDaGlsZCBleGl0IGZyZWVzIGEgaGFyZC1jYXAgc2xvdCBldmVuIHdoaWxlIGl0cyBpbi1mbGlnaHQgc2V0IGlzIHN0aWxsXG4gICAgLy8gYmVpbmcgcmVwb3J0ZWQg4oCUIHdha2Ugd2FpdGVycyBub3c7IHRoZWlyIHJlcG9ydHMgc2V0dGxlIGluZGVwZW5kZW50bHkuXG4gICAgdGhpcy5fd2FrZVBvb2xlZFNsb3RXYWl0ZXJzKClcblxuICAgIGNvbnN0IGVudHJpZXMgPSBzdGF0ZSA/IFsuLi5zdGF0ZS5pbmZsaWdodC52YWx1ZXMoKV0gOiBbXVxuICAgIGNvbnN0IHJ1bm5lckZhaWx1cmUgPSBzdGF0ZVxuICAgICAgPyB0aGlzLl9wb29sZWRSdW5uZXJGYWlsdXJlKHtjaGlsZCwgZXhpdENvZGUsIG9yaWdpbiwgc2lnbmFsLCBzdGF0ZX0pXG4gICAgICA6IHVuZGVmaW5lZFxuICAgIGlmIChzdGF0ZSkgc3RhdGUuaW5mbGlnaHQuY2xlYXIoKVxuICAgIHRoaXMucG9vbGVkQ2hpbGRTdGF0ZXMuZGVsZXRlKGNoaWxkKVxuXG4gICAgY29uc3QgZmFpbHVyZVJlcG9ydHMgPSBlbnRyaWVzLm1hcChhc3luYyAoZW50cnkpID0+IHtcbiAgICAgIGF3YWl0IHRoaXMuX3JlcG9ydEpvYlJlc3VsdCh7XG4gICAgICAgIGpvYklkOiBlbnRyeS5wYXlsb2FkLmlkLFxuICAgICAgICBzdGF0dXM6IFwiZmFpbGVkXCIsXG4gICAgICAgIGVycm9yLFxuICAgICAgICBoYW5kb2ZmSWQ6IGVudHJ5LnBheWxvYWQuaGFuZG9mZklkLFxuICAgICAgICBoYW5kZWRPZmZBdE1zOiBlbnRyeS5wYXlsb2FkLmhhbmRlZE9mZkF0TXMsXG4gICAgICAgIHJ1bm5lckZhaWx1cmUsXG4gICAgICAgIHdvcmtlcklkOiBlbnRyeS5wYXlsb2FkLndvcmtlcklkIHx8IHRoaXMud29ya2VySWRcbiAgICAgIH0pXG4gICAgICBpZiAoZW50cnkucmVzb2x2ZSkgZW50cnkucmVzb2x2ZSh1bmRlZmluZWQpXG4gICAgfSlcblxuICAgIC8vIFN0YXJ0IGV2ZXJ5IGZhbGxiYWNrIHJlcG9ydCBiZWZvcmUgYW5ub3VuY2luZyBjYXBhY2l0eSBzbyB0aGUgbWFpbiBjYW5ub3RcbiAgICAvLyBvYnNlcnZlIGEgcmVwbGFjZW1lbnQgc2xvdCBiZWZvcmUgdGhlIGZhaWxlZCBqb2JzJyByZXBvcnRzIGFyZSBpbiBmbGlnaHQuXG4gICAgLy8gVGhlIHJlcG9ydCBwcm9taXNlcyByZW1haW4gdHJhY2tlZCBiZWxvdzsgYSBzbG93IHJldHJ5IG11c3Qgbm90IGhvbGQgdGhlXG4gICAgLy8gbmV3bHkgZnJlZWQgcnVubmVyIGNhcGFjaXR5IGhvc3RhZ2UuXG4gICAgLy8gQSBkcmFpbmVkIHJldGlyZW1lbnQgYWxyZWFkeSBhZHZlcnRpc2VkIGl0cyByZXBsYWNlbWVudCBjYXBhY2l0eSB3aGVuXG4gICAgLy8gdGhlIGZpbmFsIGpvYiBjb21wbGV0ZWQuIFJlLWFkdmVydGlzaW5nIGhlcmUgY2FuIHJlc3RvcmUgYSBjcmVkaXQgbWFpblxuICAgIC8vIGNvbnN1bWVkIGJlZm9yZSBpdHMgaGFuZG9mZiByZWFjaGVkIHRoZSByZXBsYWNlbWVudCBjaGlsZC5cbiAgICBpZiAoc3RhdGU/LnNodXRkb3duUmVhc29uICE9PSBcInBhcmVudF9yZXRpcmVfZHJhaW5lZFwiKSB7XG4gICAgICBpZiAoc3RhdGUgJiYgc3RhdGUuc3RhcnRlZCAhPT0gZmFsc2UpIHtcbiAgICAgICAgdGhpcy5fc2VuZFJlYWR5SWZSdW5uaW5nKClcbiAgICAgIH0gZWxzZSBpZiAoc3RhdGUpIHtcbiAgICAgICAgZm9yIChjb25zdCBlbnRyeSBvZiBlbnRyaWVzKSB7XG4gICAgICAgICAgaWYgKGVudHJ5LnBvb2xlZEpvYikgdGhpcy5fcG9vbGVkU3RhcnR1cEZhaWx1cmVKb2JzLmFkZChlbnRyeS5wb29sZWRKb2IpXG4gICAgICAgICAgY29uc3QgcXVldWVUcmFja2VyID0gdGhpcy5wb29sZWRKb2JRdWV1ZVRyYWNrZXJzLmdldChlbnRyeS5wYXlsb2FkLmlkKVxuICAgICAgICAgIGlmIChxdWV1ZVRyYWNrZXIpIHRoaXMuX3Bvb2xlZFN0YXJ0dXBGYWlsdXJlSm9icy5hZGQocXVldWVUcmFja2VyKVxuICAgICAgICB9XG4gICAgICAgIC8vIEEgcHJldmlvdXMgcmVhZHkgbWVzc2FnZSBtYXkgc3RpbGwgaGF2ZSB1bmNvbnN1bWVkIHBvb2xlZCBjcmVkaXRzIGF0IHRoZVxuICAgICAgICAvLyBtYWluLiBSZXZva2UgdGhlbSBhdXRob3JpdGF0aXZlbHkgd2l0aG91dCBzdXBwcmVzc2luZyB2YWxpZCBpbmxpbmUgb3JcbiAgICAgICAgLy8gcHJvY2Vzcy1ydW5uZXIgcmVhZGluZXNzOyBvdGhlcndpc2UgcXVldWVkIGpvYnMgY2FuIHRyaWdnZXIgYSBzdGFydHVwXG4gICAgICAgIC8vIGNyYXNoIGxvb3AgdXNpbmcgdGhlIHN0YWxlIGNyZWRpdHMuXG4gICAgICAgIHRoaXMuX3NlbmRSZWFkeUlmUnVubmluZyh7cmV2b2tlUG9vbGVkQWRtaXNzaW9uOiB0cnVlfSlcbiAgICAgIH1cbiAgICB9XG5cbiAgICAvLyBBIGNoaWxkIGV4aXQgY2FuIGFic29yYiB0aGUgYm91bmRlZCBvdmVyLWNhcCBsaXZlbmVzcyByZXBsYWNlbWVudCB3aGlsZVxuICAgIC8vIGV2ZXJ5IHJlbWFpbmluZyBsaXZlIGNoaWxkIGlzIHN0aWxsIHJldGlyaW5nIOKAlCBlLmcuIHRoZSByZXBsYWNlbWVudFxuICAgIC8vIHJldGlyZXMgKG9yIGRpZXMpIGZpcnN0LiBObyByZXRpcmVtZW50IG1hcmsgcmVtYWlucyB0byByZXN0b3JlIGEgd29ya2luZ1xuICAgIC8vIGNoaWxkLCBhbmQgYXQgdGhlIGNhcCBub3RoaW5nIGVsc2UgY2FuIHNwYXduLCBzbyBhZHZlcnRpc2VkIGNhcGFjaXR5XG4gICAgLy8gd291bGQgc3RheSB6ZXJvIHVudGlsIHRoZSBuZXh0IGRyYWluaW5nIGV4aXQg4oCUIHVwIHRvIHRoZSBsb25nZXN0XG4gICAgLy8gaW4tZmxpZ2h0IGpvYiDigJQgc3RhcnZpbmcgZGlzcGF0Y2ggY2x1c3Rlci13aWRlLiBSZXN0b3JlIG9uZSB3b3JraW5nXG4gICAgLy8gY2hpbGQgbm93IChzYW1lIGJvdW5kOiBhdCBtb3N0IG9uZSBvdmVyLWNhcCBjaGlsZCkgYW5kIHJlLWFkdmVydGlzZSBzb1xuICAgIC8vIG1haW4gY2FuIGRpc3BhdGNoIGludG8gaXQgaW1tZWRpYXRlbHkuXG4gICAgaWYgKHN0YXRlPy5zdGFydGVkICE9PSBmYWxzZSAmJiB0aGlzLnBvb2xlZENoaWxkcmVuLnNpemUgPiAwICYmIHRoaXMuX2Vuc3VyZU5vblJldGlyaW5nQ2hpbGQoKSkge1xuICAgICAgdGhpcy5fc2VuZFJlYWR5SWZSdW5uaW5nKClcbiAgICB9XG5cbiAgICBhd2FpdCBQcm9taXNlLmFsbFNldHRsZWQoZmFpbHVyZVJlcG9ydHMpXG4gIH1cblxuICAvKipcbiAgICogQ2FwdHVyZXMgb25lIHN0YWJsZSBwcm9jZXNzIHNuYXBzaG90IGJlZm9yZSB0aGUgZmFpbGVkIGNoaWxkJ3Mgc3RhdGUgaXMgcmVtb3ZlZC5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBGYWlsdXJlIGRldGFpbHMuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwibm9kZTpjaGlsZF9wcm9jZXNzXCIpLkNoaWxkUHJvY2Vzc30gYXJncy5jaGlsZCAtIEZhaWxlZCBwb29sZWQgY2hpbGQuXG4gICAqIEBwYXJhbSB7bnVtYmVyIHwgbnVsbH0gYXJncy5leGl0Q29kZSAtIENoaWxkIGV4aXQgY29kZSB3aGVuIG9ic2VydmVkLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vdHlwZXMuanNcIikuUG9vbGVkUnVubmVyRmFpbHVyZU9yaWdpbn0gYXJncy5vcmlnaW4gLSBXb3JrZXIgb2JzZXJ2YXRpb24gdGhhdCBpbml0aWF0ZWQgcmVjb3ZlcnkuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwibm9kZTpjaGlsZF9wcm9jZXNzXCIpLkNoaWxkUHJvY2Vzc1tcInNpZ25hbENvZGVcIl19IGFyZ3Muc2lnbmFsIC0gQ2hpbGQgdGVybWluYXRpb24gc2lnbmFsIHdoZW4gb2JzZXJ2ZWQuXG4gICAqIEBwYXJhbSB7UG9vbGVkQ2hpbGRTdGF0ZX0gYXJncy5zdGF0ZSAtIENoaWxkIHN0YXRlIGltbWVkaWF0ZWx5IGJlZm9yZSByZWNvdmVyeS5cbiAgICogQHJldHVybnMge2ltcG9ydChcIi4vdHlwZXMuanNcIikuUG9vbGVkUnVubmVyRmFpbHVyZX0gLSBTaGFyZWQgZmFpbHVyZSBwcm92ZW5hbmNlLlxuICAgKi9cbiAgX3Bvb2xlZFJ1bm5lckZhaWx1cmUoe2NoaWxkLCBleGl0Q29kZSwgb3JpZ2luLCBzaWduYWwsIHN0YXRlfSkge1xuICAgIGNvbnN0IG9ic2VydmF0aW9uID0gc3RhdGUuc2h1dGRvd25PYnNlcnZhdGlvblxuICAgIGxldCBzaHV0ZG93blJlYXNvbiA9IHN0YXRlLnNodXRkb3duUmVhc29uID8/IG9ic2VydmF0aW9uPy5yZWFzb25cbiAgICBpZiAoIXNodXRkb3duUmVhc29uKSB7XG4gICAgICBpZiAob3JpZ2luID09PSBcInByb2Nlc3MtZXJyb3JcIiB8fCBvcmlnaW4gPT09IFwiaXBjLXNlbmRcIikge1xuICAgICAgICBzaHV0ZG93blJlYXNvbiA9IFwicHJvY2Vzc19lcnJvclwiXG4gICAgICB9IGVsc2UgaWYgKHNpZ25hbCA9PT0gXCJTSUdURVJNXCIpIHtcbiAgICAgICAgc2h1dGRvd25SZWFzb24gPSBcInNpZ25hbF9zaWd0ZXJtXCJcbiAgICAgIH0gZWxzZSBpZiAoc2lnbmFsID09PSBcIlNJR0lOVFwiKSB7XG4gICAgICAgIHNodXRkb3duUmVhc29uID0gXCJzaWduYWxfc2lnaW50XCJcbiAgICAgIH0gZWxzZSBpZiAoc2lnbmFsID09PSBcIlNJR0tJTExcIikge1xuICAgICAgICBzaHV0ZG93blJlYXNvbiA9IFwic2lnbmFsX3NpZ2tpbGxcIlxuICAgICAgfSBlbHNlIGlmIChzaWduYWwpIHtcbiAgICAgICAgc2h1dGRvd25SZWFzb24gPSBcInNpZ25hbF9vdGhlclwiXG4gICAgICB9IGVsc2UgaWYgKHN0YXRlLmlwY0Rpc2Nvbm5lY3RlZEF0TXMgJiYgZXhpdENvZGUgPT09IDApIHtcbiAgICAgICAgc2h1dGRvd25SZWFzb24gPSBcImlwY19kaXNjb25uZWN0XCJcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIHNodXRkb3duUmVhc29uID0gXCJ1bmV4cGVjdGVkX2V4aXRcIlxuICAgICAgfVxuICAgIH1cbiAgICBjb25zdCB0ZXJtaW5hdGlvblJlYXNvbiA9IHNodXRkb3duUmVhc29uID09PSBcImpvYl90aW1lb3V0XCJcbiAgICAgID8gXCJqb2ItdGltZW91dFwiXG4gICAgICA6IHNodXRkb3duUmVhc29uID09PSBcIndvcmtlcl9zdG9wXCIgPyBcIndvcmtlci1zaHV0ZG93bi10aW1lb3V0XCIgOiBcInVuZXhwZWN0ZWRcIlxuICAgIGNvbnN0IHdvcmtlckxpZmVjeWNsZSA9IHRoaXMuc2hvdWxkU3RvcCA/IFwic3RvcHBpbmdcIiA6IHRoaXMuaXNSZXRpcmluZyA/IFwicmV0aXJpbmdcIiA6IFwicnVubmluZ1wiXG4gICAgY29uc3QgcnVubmVyTGlmZWN5Y2xlID0gc3RhdGUuc3RhcnRlZCA9PT0gZmFsc2UgPyBcInN0YXJ0aW5nXCIgOiBzdGF0ZS5yZXRpcmluZyA/IFwicmV0aXJpbmdcIiA6IFwicnVubmluZ1wiXG4gICAgY29uc3QgYm91bmRlZEluZmxpZ2h0ID0gYm91bmRlZFBvb2xlZFJ1bm5lckluZmxpZ2h0Sm9iSWRzKHN0YXRlLmluZmxpZ2h0LmtleXMoKSlcbiAgICBjb25zdCBhY3RpdmVKb2JzID0gWy4uLnN0YXRlLmluZmxpZ2h0LnZhbHVlcygpXVxuICAgICAgLm1hcCgoZW50cnkpID0+ICh7XG4gICAgICAgIGhhbmRvZmZJZDogZW50cnkucGF5bG9hZC5oYW5kb2ZmSWQgPz8gbnVsbCxcbiAgICAgICAgaGFuZGVkT2ZmQXRNczogZW50cnkucGF5bG9hZC5oYW5kZWRPZmZBdE1zID8/IG51bGwsXG4gICAgICAgIGpvYklkOiBlbnRyeS5wYXlsb2FkLmlkLFxuICAgICAgICBqb2JOYW1lOiBlbnRyeS5wYXlsb2FkLmpvYk5hbWUsXG4gICAgICAgIHdvcmtlcklkOiBlbnRyeS5wYXlsb2FkLndvcmtlcklkID8/IHRoaXMud29ya2VySWRcbiAgICAgIH0pKVxuICAgICAgLnNvcnQoKGxlZnQsIHJpZ2h0KSA9PiBsZWZ0LmpvYklkLmxvY2FsZUNvbXBhcmUocmlnaHQuam9iSWQpKVxuXG4gICAgcmV0dXJuIE9iamVjdC5mcmVlemUoe1xuICAgICAgYWN0aXZlSm9icyxcbiAgICAgIGNoaWxkSW5zdGFuY2VJZDogc3RhdGUuY2hpbGRJbnN0YW5jZUlkID8/IG9ic2VydmF0aW9uPy5jaGlsZEluc3RhbmNlSWQgPz8gbnVsbCxcbiAgICAgIGV4aXRDb2RlLFxuICAgICAgZ2VuZXJhdGlvbklkOiB0aGlzLmdlbmVyYXRpb25JZCA/PyBudWxsLFxuICAgICAgLi4uYm91bmRlZEluZmxpZ2h0LFxuICAgICAgb29tS2lsbGVkOiBzaWduYWwgPT09IFwiU0lHS0lMTFwiICYmIHNodXRkb3duUmVhc29uID09PSBcInNpZ25hbF9zaWdraWxsXCIgPyBudWxsIDogZmFsc2UsXG4gICAgICBvcmlnaW4sXG4gICAgICBydW5uZXJBZ2VNczogTWF0aC5tYXgoMCwgRGF0ZS5ub3coKSAtIHN0YXRlLmNyZWF0ZWRBdE1zKSxcbiAgICAgIHJ1bm5lckNyZWF0ZWRBdE1zOiBzdGF0ZS5jcmVhdGVkQXRNcyxcbiAgICAgIHJ1bm5lckRldGFjaGVkOiBmYWxzZSxcbiAgICAgIHJ1bm5lckpvYnNSdW46IHN0YXRlLmpvYnNSdW4sXG4gICAgICBydW5uZXJMaWZlY3ljbGUsXG4gICAgICBydW5uZXJQaWQ6IGNoaWxkLnBpZCA/PyBudWxsLFxuICAgICAgc2lnbmFsLFxuICAgICAgc2h1dGRvd25PYnNlcnZlZEF0TXM6IG9ic2VydmF0aW9uPy5zaHV0ZG93bk9ic2VydmVkQXRNcyA/PyBzdGF0ZS5pcGNEaXNjb25uZWN0ZWRBdE1zID8/IG51bGwsXG4gICAgICBzaHV0ZG93blJlcXVlc3RlZEF0TXM6IHN0YXRlLnNodXRkb3duUmVxdWVzdGVkQXRNcyA/PyBvYnNlcnZhdGlvbj8uc2h1dGRvd25SZXF1ZXN0ZWRBdE1zID8/IG51bGwsXG4gICAgICBzaHV0ZG93blJlYXNvbixcbiAgICAgIHNodXRkb3duU2lnbmFsOiBzdGF0ZS5zaHV0ZG93blNpZ25hbCA/PyBvYnNlcnZhdGlvbj8uc2lnbmFsID8/IHNpZ25hbCxcbiAgICAgIHRlcm1pbmF0aW9uUmVhc29uLFxuICAgICAgdGltZW91dEpvYklkOiBzdGF0ZS50aW1lb3V0Sm9iSWQgPz8gbnVsbCxcbiAgICAgIHdvcmtlcklkOiB0aGlzLndvcmtlcklkLFxuICAgICAgd29ya2VyTGlmZWN5Y2xlLFxuICAgICAgd29ya2VyUGlkOiBwcm9jZXNzLnBpZFxuICAgIH0pXG4gIH1cblxuICAvKipcbiAgICogUnVucyBydW4gam9iIGlubGluZS5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL3R5cGVzLmpzXCIpLkJhY2tncm91bmRKb2JQYXlsb2FkfSBwYXlsb2FkIC0gUGF5bG9hZC5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgd2hlbiBkb25lLlxuICAgKi9cbiAgYXN5bmMgX3J1bkpvYklubGluZShwYXlsb2FkKSB7XG4gICAgY29uc3QgY29uZmlndXJhdGlvbiA9IHRoaXMuY29uZmlndXJhdGlvblxuICAgIGlmICghY29uZmlndXJhdGlvbikgdGhyb3cgbmV3IEVycm9yKFwiQmFja2dyb3VuZCBqb2JzIHdvcmtlciBjb25maWd1cmF0aW9uIG5vdCBpbml0aWFsaXplZFwiKVxuXG4gICAgY29uc3QgcmVnaXN0cnkgPSBuZXcgQmFja2dyb3VuZEpvYlJlZ2lzdHJ5KHtjb25maWd1cmF0aW9ufSlcbiAgICBhd2FpdCByZWdpc3RyeS5sb2FkKClcbiAgICBjb25zdCBKb2JDbGFzcyA9IHJlZ2lzdHJ5LmdldEpvYkJ5TmFtZShwYXlsb2FkLmpvYk5hbWUpXG4gICAgYXdhaXQgcnVuV2l0aEJhY2tncm91bmRKb2JQYXlsb2FkKHBheWxvYWQsIGFzeW5jICgpID0+IHtcbiAgICAgIGF3YWl0IHBlcmZvcm1CYWNrZ3JvdW5kSm9iKHtcbiAgICAgICAgY29uZmlndXJhdGlvbixcbiAgICAgICAgSm9iQ2xhc3MsXG4gICAgICAgIGpvYkFyZ3M6IHBheWxvYWQuYXJncyB8fCBbXSxcbiAgICAgICAgam9iT3B0aW9uczogcGF5bG9hZC5vcHRpb25zIHx8IHt9LFxuICAgICAgICBuYW1lOiBgQmFja2dyb3VuZCBqb2Igd29ya2VyIGlubGluZTogJHtwYXlsb2FkLmpvYk5hbWV9YCxcbiAgICAgICAgcGF5bG9hZFxuICAgICAgfSlcbiAgICB9KVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZm9yayBqb2IuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi90eXBlcy5qc1wiKS5CYWNrZ3JvdW5kSm9iUGF5bG9hZCAmIHtpZDogc3RyaW5nfX0gcGF5bG9hZCAtIFBheWxvYWQuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIHdoZW4gdGhlIGZvcmtlZCBydW5uZXIgZXhpdHMgb3IgZm9yayBmYWlscy5cbiAgICovXG4gIF9mb3JrSm9iKHBheWxvYWQpIHtcbiAgICBjb25zdCBjaGlsZCA9IHRoaXMuX2NyZWF0ZUZvcmtlZENoaWxkKClcblxuICAgIHRoaXMuaW5mbGlnaHRQcm9jZXNzQ2hpbGRyZW4uYWRkKGNoaWxkKVxuXG4gICAgY29uc3QgZmluaXNoZWQgPSB0aGlzLl93YWl0Rm9yRm9ya2VkQ2hpbGQoe2NoaWxkLCBwYXlsb2FkfSlcblxuICAgIHRoaXMuX3NlbmRGb3JrZWRQYXlsb2FkKHtjaGlsZCwgcGF5bG9hZH0pXG5cbiAgICByZXR1cm4gZmluaXNoZWRcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGNyZWF0ZSBmb3JrZWQgY2hpbGQuXG4gICAqIEByZXR1cm5zIHtpbXBvcnQoXCJub2RlOmNoaWxkX3Byb2Nlc3NcIikuQ2hpbGRQcm9jZXNzfSAtIEZvcmtlZCBjaGlsZCBwcm9jZXNzLlxuICAgKi9cbiAgX2NyZWF0ZUZvcmtlZENoaWxkKCkge1xuICAgIGNvbnN0IGNvbmZpZ3VyYXRpb24gPSB0aGlzLmNvbmZpZ3VyYXRpb25cbiAgICBpZiAoIWNvbmZpZ3VyYXRpb24pIHRocm93IG5ldyBFcnJvcihcIkJhY2tncm91bmQgam9icyB3b3JrZXIgY29uZmlndXJhdGlvbiBub3QgaW5pdGlhbGl6ZWRcIilcblxuICAgIGNvbnN0IGRpcmVjdG9yeSA9IGNvbmZpZ3VyYXRpb24uZ2V0RGlyZWN0b3J5KClcbiAgICByZXR1cm4gZm9yayhGT1JLRURfUlVOTkVSX0VOVFJZX1BBVEgsIFtdLCB7XG4gICAgICBjd2Q6IGRpcmVjdG9yeSxcbiAgICAgIGV4ZWNBcmd2OiB0aGlzLl9jaGlsZFJ1bm5lckV4ZWNBcmd2KCksXG4gICAgICBzdGRpbzogW1wiaWdub3JlXCIsIFwiaWdub3JlXCIsIFwiaWdub3JlXCIsIFwiaXBjXCJdLFxuICAgICAgZW52OiBPYmplY3QuYXNzaWduKHt9LCBwcm9jZXNzLmVudiwgdGhpcy5fY2hpbGRCYWNrZ3JvdW5kSm9ic0Vudmlyb25tZW50KCkpXG4gICAgfSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHdhaXQgZm9yIGZvcmtlZCBjaGlsZC5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBPcHRpb25zLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIm5vZGU6Y2hpbGRfcHJvY2Vzc1wiKS5DaGlsZFByb2Nlc3N9IGFyZ3MuY2hpbGQgLSBGb3JrZWQgY2hpbGQgcHJvY2Vzcy5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL3R5cGVzLmpzXCIpLkJhY2tncm91bmRKb2JQYXlsb2FkICYge2lkOiBzdHJpbmd9fSBhcmdzLnBheWxvYWQgLSBQYXlsb2FkLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyB3aGVuIHRoZSBjaGlsZCBleGl0cy5cbiAgICovXG4gIF93YWl0Rm9yRm9ya2VkQ2hpbGQoe2NoaWxkLCBwYXlsb2FkfSkge1xuICAgIGNvbnN0IHRpbWVvdXRTdGF0ZSA9IHRoaXMuX2FybUZvcmtlZEpvYlRpbWVvdXQoe2NoaWxkLCBwYXlsb2FkfSlcblxuICAgIHJldHVybiBuZXcgUHJvbWlzZSgocmVzb2x2ZSkgPT4ge1xuICAgICAgY2hpbGQub25jZShcImV4aXRcIiwgKGNvZGUsIHNpZ25hbCkgPT4ge1xuICAgICAgICB0aGlzLl9jbGVhckZvcmtlZEpvYlRpbWVvdXQodGltZW91dFN0YXRlKVxuICAgICAgICB0aGlzLl9oYW5kbGVGb3JrZWRDaGlsZEV4aXQoe2NoaWxkLCBjb2RlLCBzaWduYWwsIHBheWxvYWQsIHJlc29sdmUsIHRpbWVvdXRTdGF0ZX0pXG4gICAgICB9KVxuICAgICAgY2hpbGQub25jZShcImVycm9yXCIsIChlcnJvcikgPT4ge1xuICAgICAgICB0aGlzLl9jbGVhckZvcmtlZEpvYlRpbWVvdXQodGltZW91dFN0YXRlKVxuICAgICAgICB0aGlzLl9oYW5kbGVGb3JrZWRDaGlsZEVycm9yKHtjaGlsZCwgZXJyb3IsIHBheWxvYWQsIHJlc29sdmV9KVxuICAgICAgfSlcbiAgICB9KVxuICB9XG5cbiAgLyoqXG4gICAqIEFybXMgYSB3YWxsLWNsb2NrIGJhY2tzdG9wIGZvciBhIGZvcmtlZCBqb2IgcnVubmVyLiBBIGZvcmtlZCBqb2Igc3RpbGxcbiAgICogcnVubmluZyBhZnRlciBgam9iVGltZW91dE1zYCBpcyB0ZXJtaW5hdGVkIChTSUdURVJNLCB0aGVuIFNJR0tJTEwgYWZ0ZXIgdGhlXG4gICAqIGdyYWNlKSBzbyBhIHNpbmdsZSBnZW51aW5lbHktaHVuZyBydW5uZXIgY2FuJ3QgcGluIGEgZHJhaW5pbmcgd29ya2VyIOKAlCBhbmRcbiAgICogaXRzIGZ1bGwtYXBwIGJvb3QgYW5kIGRhdGFiYXNlIGNvbm5lY3Rpb25zIOKAlCBpbmRlZmluaXRlbHkuIFJldHVybnMgYSBzdGF0ZVxuICAgKiBvYmplY3QgdGhlIGV4aXQvZXJyb3IgaGFuZGxlcnMgdXNlIHRvIGNhbmNlbCB0aGUgdGltZXIgYW5kIHRvIHJlcG9ydCBhXG4gICAqIHRpbWVvdXQtc3BlY2lmaWMgZmFpbHVyZS4gV2hlbiBubyB0aW1lb3V0IGlzIGNvbmZpZ3VyZWQgdGhlIHRpbWVyIGlzIG51bGxcbiAgICogYW5kIGJlaGF2aW9yIGlzIHVuY2hhbmdlZC5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBPcHRpb25zLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIm5vZGU6Y2hpbGRfcHJvY2Vzc1wiKS5DaGlsZFByb2Nlc3N9IGFyZ3MuY2hpbGQgLSBGb3JrZWQgY2hpbGQgcHJvY2Vzcy5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL3R5cGVzLmpzXCIpLkJhY2tncm91bmRKb2JQYXlsb2FkICYge2lkOiBzdHJpbmd9fSBhcmdzLnBheWxvYWQgLSBKb2IgcGF5bG9hZC5cbiAgICogQHJldHVybnMge0ZvcmtlZEpvYlRpbWVvdXRTdGF0ZX0gLSBUaW1lb3V0IHN0YXRlLlxuICAgKi9cbiAgX2FybUZvcmtlZEpvYlRpbWVvdXQoe2NoaWxkLCBwYXlsb2FkfSkge1xuICAgIGNvbnN0IHRpbWVvdXRNcyA9IHRoaXMuX3Jlc29sdmVKb2JUaW1lb3V0TXMocGF5bG9hZC5vcHRpb25zKVxuICAgIC8qKiBAdHlwZSB7Rm9ya2VkSm9iVGltZW91dFN0YXRlfSAqL1xuICAgIGNvbnN0IHN0YXRlID0ge3RpbWVkT3V0OiBmYWxzZSwgdGltZW91dE1zLCB0aW1lcjogbnVsbCwgc2lna2lsbFRpbWVyOiBudWxsfVxuXG4gICAgaWYgKCEodHlwZW9mIHRpbWVvdXRNcyA9PT0gXCJudW1iZXJcIiAmJiB0aW1lb3V0TXMgPiAwKSkgcmV0dXJuIHN0YXRlXG5cbiAgICBzdGF0ZS50aW1lciA9IHNldFRpbWVvdXQoKCkgPT4gdGhpcy5fb25Gb3JrZWRKb2JUaW1lb3V0KHtjaGlsZCwgc3RhdGV9KSwgdGltZW91dE1zKVxuXG4gICAgcmV0dXJuIHN0YXRlXG4gIH1cblxuICAvKipcbiAgICogUmVzb2x2ZXMgdGhlIGVmZmVjdGl2ZSB3YWxsLWNsb2NrIGpvYiB0aW1lb3V0IGluIG1zIChzaGFyZWQgYnkgZm9ya2VkIGFuZCBwb29sZWQgam9icyksIG9yIG51bGwgd2hlbiBkaXNhYmxlZC4gVGhlXG4gICAqIHBlci1qb2Igb3ZlcnJpZGUgd2lucywgZm9sbG93ZWQgYnkgdGhlIGNvbnN0cnVjdG9yIG92ZXJyaWRlLCB0aGVuIHRoZSB2YWx1ZVxuICAgKiBmcm9tIHRoZSBiYWNrZ3JvdW5kLWpvYnMgY29uZmlndXJhdGlvbi4gQSBub24tcG9zaXRpdmUgdmFsdWUgZGlzYWJsZXMgdGhlXG4gICAqIGJhY2tzdG9wIGF0IHdoaWNoZXZlciBsZXZlbCBzdXBwbGllZCBpdC5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL3R5cGVzLmpzXCIpLkJhY2tncm91bmRKb2JPcHRpb25zfSBbam9iT3B0aW9uc10gLSBQZXItam9iIG9wdGlvbnMuXG4gICAqIEByZXR1cm5zIHtudW1iZXIgfCBudWxsfSAtIFRpbWVvdXQgaW4gbXMsIG9yIG51bGwgd2hlbiBkaXNhYmxlZC5cbiAgICovXG4gIF9yZXNvbHZlSm9iVGltZW91dE1zKGpvYk9wdGlvbnMpIHtcbiAgICBjb25zdCByYXcgPSB0eXBlb2Ygam9iT3B0aW9ucz8udGltZW91dE1zID09PSBcIm51bWJlclwiXG4gICAgICA/IGpvYk9wdGlvbnMudGltZW91dE1zXG4gICAgICA6ICh0eXBlb2YgdGhpcy5qb2JUaW1lb3V0TXNPdmVycmlkZSA9PT0gXCJudW1iZXJcIlxuICAgICAgICAgID8gdGhpcy5qb2JUaW1lb3V0TXNPdmVycmlkZVxuICAgICAgICAgIDogKHRoaXMuY29uZmlndXJhdGlvbiA/IHRoaXMuY29uZmlndXJhdGlvbi5nZXRCYWNrZ3JvdW5kSm9ic0NvbmZpZygpLmpvYlRpbWVvdXRNcyA6IG51bGwpKVxuXG4gICAgLy8gQSBub24tZmluaXRlIChlLmcuIEluZmluaXR5KSBvciBub24tcG9zaXRpdmUgdmFsdWUgZGlzYWJsZXMgdGhlIGJhY2tzdG9wO1xuICAgIC8vIGEgZmluaXRlIHZhbHVlIGJleW9uZCBOb2RlJ3MgdGltZXIgcmFuZ2UgaXMgY2xhbXBlZCB0byB0aGUgbWF4IHJhdGhlciB0aGFuXG4gICAgLy8gc2lsZW50bHkgY29lcmNlZCB0byB+MW1zICh3aGljaCB3b3VsZCBraWxsIGV2ZXJ5IGZvcmtlZCBqb2IgaW1tZWRpYXRlbHkpLlxuICAgIGlmICh0eXBlb2YgcmF3ICE9PSBcIm51bWJlclwiIHx8ICFOdW1iZXIuaXNGaW5pdGUocmF3KSB8fCByYXcgPD0gMCkgcmV0dXJuIG51bGxcblxuICAgIHJldHVybiBNYXRoLm1pbihyYXcsIE1BWF9GT1JLRURfSk9CX1RJTUVPVVRfTVMpXG4gIH1cblxuICAvKipcbiAgICogRmlyZWQgd2hlbiBhIGZvcmtlZCBydW5uZXIgb3ZlcnJ1bnMgaXRzIHRpbWVvdXQuIFNlbmRzIFNJR1RFUk0gZm9yIGEgY2xlYW5cbiAgICogc2h1dGRvd24sIHRoZW4gU0lHS0lMTCBhZnRlciB0aGUgZ3JhY2UgZm9yIGEgcnVubmVyIHRoYXQgaWdub3JlcyBpdC4gVGhlXG4gICAqIHJlc3VsdGluZyBub24tY2xlYW4gZXhpdCBmbG93cyB0aHJvdWdoIGBfaGFuZGxlRm9ya2VkQ2hpbGRFeGl0YCwgd2hpY2ggZnJlZXNcbiAgICogdGhlIHNsb3QgYW5kIHJlcG9ydHMgdGhlIGpvYiBmYWlsZWQuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gT3B0aW9ucy5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCJub2RlOmNoaWxkX3Byb2Nlc3NcIikuQ2hpbGRQcm9jZXNzfSBhcmdzLmNoaWxkIC0gRm9ya2VkIGNoaWxkIHByb2Nlc3MuXG4gICAqIEBwYXJhbSB7Rm9ya2VkSm9iVGltZW91dFN0YXRlfSBhcmdzLnN0YXRlIC0gVGltZW91dCBzdGF0ZS5cbiAgICogQHJldHVybnMge3ZvaWR9XG4gICAqL1xuICBfb25Gb3JrZWRKb2JUaW1lb3V0KHtjaGlsZCwgc3RhdGV9KSB7XG4gICAgc3RhdGUudGltZWRPdXQgPSB0cnVlXG5cbiAgICB0cnkge1xuICAgICAgY2hpbGQua2lsbChcIlNJR1RFUk1cIilcbiAgICB9IGNhdGNoIHtcbiAgICAgIC8vIENoaWxkIGFscmVhZHkgZXhpdGVkOyBub3RoaW5nIHRvIGRvLlxuICAgIH1cblxuICAgIHN0YXRlLnNpZ2tpbGxUaW1lciA9IHNldFRpbWVvdXQoKCkgPT4ge1xuICAgICAgdHJ5IHtcbiAgICAgICAgY2hpbGQua2lsbChcIlNJR0tJTExcIilcbiAgICAgIH0gY2F0Y2gge1xuICAgICAgICAvLyBDaGlsZCBhbHJlYWR5IGV4aXRlZDsgbm90aGluZyB0byBkby5cbiAgICAgIH1cbiAgICB9LCB0aGlzLmZvcmtlZENoaWxkU2lna2lsbEdyYWNlTXMpXG4gIH1cblxuICAvKipcbiAgICogQ2FuY2VscyBhbnkgcGVuZGluZyB0aW1lb3V0L1NJR0tJTEwgdGltZXJzIGZvciBhIGZvcmtlZCBydW5uZXIgdGhhdCBoYXNcbiAgICogZXhpdGVkIChvciBlcnJvcmVkKSBzbyB0aGV5IG5ldmVyIGZpcmUgYWdhaW5zdCBhIGdvbmUgb3IgcmV1c2VkIGNoaWxkLlxuICAgKiBAcGFyYW0ge0ZvcmtlZEpvYlRpbWVvdXRTdGF0ZX0gc3RhdGUgLSBUaW1lb3V0IHN0YXRlLlxuICAgKiBAcmV0dXJucyB7dm9pZH1cbiAgICovXG4gIF9jbGVhckZvcmtlZEpvYlRpbWVvdXQoc3RhdGUpIHtcbiAgICBpZiAoc3RhdGUudGltZXIpIHtcbiAgICAgIGNsZWFyVGltZW91dChzdGF0ZS50aW1lcilcbiAgICAgIHN0YXRlLnRpbWVyID0gbnVsbFxuICAgIH1cblxuICAgIGlmIChzdGF0ZS5zaWdraWxsVGltZXIpIHtcbiAgICAgIGNsZWFyVGltZW91dChzdGF0ZS5zaWdraWxsVGltZXIpXG4gICAgICBzdGF0ZS5zaWdraWxsVGltZXIgPSBudWxsXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgaGFuZGxlIGZvcmtlZCBjaGlsZCBleGl0LlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIE9wdGlvbnMuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwibm9kZTpjaGlsZF9wcm9jZXNzXCIpLkNoaWxkUHJvY2Vzc30gYXJncy5jaGlsZCAtIEZvcmtlZCBjaGlsZCBwcm9jZXNzLlxuICAgKiBAcGFyYW0ge251bWJlciB8IG51bGx9IGFyZ3MuY29kZSAtIEV4aXQgY29kZS5cbiAgICogQHBhcmFtIHtrZXlvZiB0eXBlb2YgaW1wb3J0KFwibm9kZTpvc1wiKS5jb25zdGFudHMuc2lnbmFscyB8IG51bGx9IGFyZ3Muc2lnbmFsIC0gRXhpdCBzaWduYWwuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi90eXBlcy5qc1wiKS5CYWNrZ3JvdW5kSm9iUGF5bG9hZCAmIHtpZDogc3RyaW5nfX0gYXJncy5wYXlsb2FkIC0gUGF5bG9hZC5cbiAgICogQHBhcmFtIHsodmFsdWU6IHZvaWQpID0+IHZvaWR9IGFyZ3MucmVzb2x2ZSAtIFByb21pc2UgcmVzb2x2ZXIuXG4gICAqIEBwYXJhbSB7Rm9ya2VkSm9iVGltZW91dFN0YXRlfSBbYXJncy50aW1lb3V0U3RhdGVdIC0gVGltZW91dCBzdGF0ZSwgd2hlbiB0aGUgcnVubmVyIGhhZCBhIHdhbGwtY2xvY2sgYmFja3N0b3AuXG4gICAqIEByZXR1cm5zIHt2b2lkfVxuICAgKi9cbiAgX2hhbmRsZUZvcmtlZENoaWxkRXhpdCh7Y2hpbGQsIGNvZGUsIHNpZ25hbCwgcGF5bG9hZCwgcmVzb2x2ZSwgdGltZW91dFN0YXRlfSkge1xuICAgIHRoaXMuaW5mbGlnaHRQcm9jZXNzQ2hpbGRyZW4uZGVsZXRlKGNoaWxkKVxuXG4gICAgLy8gRnJlZSB0aGUgd29ya2VyIHNsb3QgYXMgc29vbiBhcyB0aGUgY2hpbGQgaXMgZ29uZSDigJQgbmV2ZXIgZ2F0ZSBpdCBvbiB0aGVcbiAgICAvLyBmYWlsdXJlIHJlcG9ydC4gQSBodW5nL3Nsb3cgcmVwb3J0IG11c3Qgbm90IGxlYWsgdGhlIHNsb3Q7IGVub3VnaCBsZWFrZWRcbiAgICAvLyBzbG90cyBkcml2ZSBgYWNjZXB0c0ZvcmtlZGAgdG8gZmFsc2UgYW5kIHNpbGVudGx5IHdlZGdlIHRoZSB3b3JrZXIuXG4gICAgcmVzb2x2ZSh1bmRlZmluZWQpXG5cbiAgICBpZiAodGhpcy5fZm9ya2VkQ2hpbGRFeGl0ZWRDbGVhbmx5KHtjb2RlLCBzaWduYWx9KSkgcmV0dXJuXG5cbiAgICBjb25zdCBlcnJvciA9IHRpbWVvdXRTdGF0ZT8udGltZWRPdXRcbiAgICAgID8gbmV3IEVycm9yKGBGb3JrZWQgYmFja2dyb3VuZCBqb2IgcnVubmVyIHRpbWVkIG91dCBhZnRlciAke3RpbWVvdXRTdGF0ZS50aW1lb3V0TXN9bXMgYW5kIHdhcyB0ZXJtaW5hdGVkOiBjb2RlPSR7Y29kZX0gc2lnbmFsPSR7c2lnbmFsIHx8IFwibm9uZVwifWApXG4gICAgICA6IG5ldyBFcnJvcihgRm9ya2VkIGJhY2tncm91bmQgam9iIHJ1bm5lciBleGl0ZWQgYmVmb3JlIHJlcG9ydGluZzogY29kZT0ke2NvZGV9IHNpZ25hbD0ke3NpZ25hbCB8fCBcIm5vbmVcIn1gKVxuXG4gICAgdGhpcy5fcmVwb3J0Rm9ya2VkQ2hpbGRGYWlsdXJlKHtwYXlsb2FkLCBlcnJvcn0pXG4gIH1cblxuICAvKipcbiAgICogUnVucyBmb3JrZWQgY2hpbGQgZXhpdGVkIGNsZWFubHkuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gT3B0aW9ucy5cbiAgICogQHBhcmFtIHtudW1iZXIgfCBudWxsfSBhcmdzLmNvZGUgLSBFeGl0IGNvZGUuXG4gICAqIEBwYXJhbSB7a2V5b2YgdHlwZW9mIGltcG9ydChcIm5vZGU6b3NcIikuY29uc3RhbnRzLnNpZ25hbHMgfCBudWxsfSBhcmdzLnNpZ25hbCAtIEV4aXQgc2lnbmFsLlxuICAgKiBAcmV0dXJucyB7Ym9vbGVhbn0gLSBXaGV0aGVyIHRoZSBjaGlsZCBleGl0ZWQgY2xlYW5seS5cbiAgICovXG4gIF9mb3JrZWRDaGlsZEV4aXRlZENsZWFubHkoe2NvZGUsIHNpZ25hbH0pIHtcbiAgICByZXR1cm4gY29kZSA9PT0gMCAmJiAhc2lnbmFsXG4gIH1cblxuICAvKipcbiAgICogUnVucyBoYW5kbGUgZm9ya2VkIGNoaWxkIGVycm9yLlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIE9wdGlvbnMuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwibm9kZTpjaGlsZF9wcm9jZXNzXCIpLkNoaWxkUHJvY2Vzc30gYXJncy5jaGlsZCAtIEZvcmtlZCBjaGlsZCBwcm9jZXNzLlxuICAgKiBAcGFyYW0ge0Vycm9yfSBhcmdzLmVycm9yIC0gQ2hpbGQgcHJvY2VzcyBlcnJvci5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL3R5cGVzLmpzXCIpLkJhY2tncm91bmRKb2JQYXlsb2FkICYge2lkOiBzdHJpbmd9fSBhcmdzLnBheWxvYWQgLSBQYXlsb2FkLlxuICAgKiBAcGFyYW0geyh2YWx1ZTogdm9pZCkgPT4gdm9pZH0gYXJncy5yZXNvbHZlIC0gUHJvbWlzZSByZXNvbHZlci5cbiAgICogQHJldHVybnMge3ZvaWR9XG4gICAqL1xuICBfaGFuZGxlRm9ya2VkQ2hpbGRFcnJvcih7Y2hpbGQsIGVycm9yLCBwYXlsb2FkLCByZXNvbHZlfSkge1xuICAgIHRoaXMuaW5mbGlnaHRQcm9jZXNzQ2hpbGRyZW4uZGVsZXRlKGNoaWxkKVxuICAgIC8vIEZyZWUgdGhlIHNsb3QgZmlyc3QgKHNlZSBfaGFuZGxlRm9ya2VkQ2hpbGRFeGl0KSDigJQgcmVwb3J0aW5nIGlzIGJlc3QtZWZmb3J0LlxuICAgIHJlc29sdmUodW5kZWZpbmVkKVxuICAgIGNvbnNvbGUuZXJyb3IoXCJCYWNrZ3JvdW5kIGpvYnMgZm9ya2VkIHJ1bm5lciBlcnJvcjpcIiwgZXJyb3IpXG4gICAgdGhpcy5fcmVwb3J0Rm9ya2VkQ2hpbGRGYWlsdXJlKHtwYXlsb2FkLCBlcnJvcn0pXG4gIH1cblxuICAvKipcbiAgICogUnVucyBzZW5kIGZvcmtlZCBwYXlsb2FkLlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIE9wdGlvbnMuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwibm9kZTpjaGlsZF9wcm9jZXNzXCIpLkNoaWxkUHJvY2Vzc30gYXJncy5jaGlsZCAtIEZvcmtlZCBjaGlsZCBwcm9jZXNzLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vdHlwZXMuanNcIikuQmFja2dyb3VuZEpvYlBheWxvYWQgJiB7aWQ6IHN0cmluZ319IGFyZ3MucGF5bG9hZCAtIFBheWxvYWQuXG4gICAqIEByZXR1cm5zIHt2b2lkfVxuICAgKi9cbiAgX3NlbmRGb3JrZWRQYXlsb2FkKHtjaGlsZCwgcGF5bG9hZH0pIHtcbiAgICB0cnkge1xuICAgICAgY2hpbGQuc2VuZCh7dHlwZTogXCJqb2JcIiwgcGF5bG9hZH0pXG4gICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgIGNoaWxkLmtpbGwoXCJTSUdURVJNXCIpXG4gICAgICB0aGlzLl9yZXBvcnRGb3JrZWRDaGlsZEZhaWx1cmUoe3BheWxvYWQsIGVycm9yfSlcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogUnVucyByZXBvcnQgZm9ya2VkIGNoaWxkIGZhaWx1cmUuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gT3B0aW9ucy5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL3R5cGVzLmpzXCIpLkJhY2tncm91bmRKb2JQYXlsb2FkICYge2lkOiBzdHJpbmd9fSBhcmdzLnBheWxvYWQgLSBQYXlsb2FkLlxuICAgKiBAcGFyYW0ge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSBhcmdzLmVycm9yIC0gRXJyb3IuXG4gICAqIEByZXR1cm5zIHt2b2lkfVxuICAgKi9cbiAgX3JlcG9ydEZvcmtlZENoaWxkRmFpbHVyZSh7cGF5bG9hZCwgZXJyb3J9KSB7XG4gICAgdGhpcy5fcmVwb3J0Sm9iUmVzdWx0SW5CYWNrZ3JvdW5kKHtcbiAgICAgIGpvYklkOiBwYXlsb2FkLmlkLFxuICAgICAgc3RhdHVzOiBcImZhaWxlZFwiLFxuICAgICAgZXJyb3IsXG4gICAgICBoYW5kb2ZmSWQ6IHBheWxvYWQuaGFuZG9mZklkLFxuICAgICAgaGFuZGVkT2ZmQXRNczogcGF5bG9hZC5oYW5kZWRPZmZBdE1zLFxuICAgICAgd29ya2VySWQ6IHBheWxvYWQud29ya2VySWQgfHwgdGhpcy53b3JrZXJJZFxuICAgIH0pXG4gIH1cblxuICAvKipcbiAgICogUnVucyBzcGF3biBqb2IuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi90eXBlcy5qc1wiKS5CYWNrZ3JvdW5kSm9iUGF5bG9hZH0gcGF5bG9hZCAtIFBheWxvYWQuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIHdoZW4gdGhlIHNwYXduZWQgcnVubmVyIGV4aXRzIG9yIHNwYXduIGZhaWxzLlxuICAgKi9cbiAgX3NwYXduSm9iKHBheWxvYWQpIHtcbiAgICBjb25zdCBjb25maWd1cmF0aW9uID0gdGhpcy5jb25maWd1cmF0aW9uXG4gICAgaWYgKCFjb25maWd1cmF0aW9uKSB0aHJvdyBuZXcgRXJyb3IoXCJCYWNrZ3JvdW5kIGpvYnMgd29ya2VyIGNvbmZpZ3VyYXRpb24gbm90IGluaXRpYWxpemVkXCIpXG5cbiAgICBjb25zdCBkaXJlY3RvcnkgPSBjb25maWd1cmF0aW9uLmdldERpcmVjdG9yeSgpXG4gICAgY29uc3QgYXJndkNvbW1hbmQgPSBwcm9jZXNzLmFyZ3ZbMV1cbiAgICBjb25zdCBjb21tYW5kID0gYXJndkNvbW1hbmQgPyBhcmd2Q29tbWFuZCA6IGAke2RpcmVjdG9yeX0vYmluL3ZlbG9jaW91cy5qc2BcbiAgICBjb25zdCBlbmNvZGVkUGF5bG9hZCA9IEJ1ZmZlci5mcm9tKEpTT04uc3RyaW5naWZ5KHBheWxvYWQpKS50b1N0cmluZyhcImJhc2U2NFwiKVxuICAgIGNvbnN0IGNoaWxkID0gc3Bhd24ocHJvY2Vzcy5leGVjUGF0aCwgWy4uLnRoaXMuX2NoaWxkUnVubmVyRXhlY0FyZ3YoKSwgY29tbWFuZCwgXCJiYWNrZ3JvdW5kLWpvYnMtcnVubmVyXCJdLCB7XG4gICAgICBjd2Q6IGRpcmVjdG9yeSxcbiAgICAgIGRldGFjaGVkOiB0cnVlLFxuICAgICAgc3RkaW86IFwiaWdub3JlXCIsXG4gICAgICBlbnY6IE9iamVjdC5hc3NpZ24oe30sIHByb2Nlc3MuZW52LCB0aGlzLl9jaGlsZEJhY2tncm91bmRKb2JzRW52aXJvbm1lbnQoKSwge1ZFTE9DSU9VU19KT0JfUEFZTE9BRDogZW5jb2RlZFBheWxvYWR9KVxuICAgIH0pXG5cbiAgICB0aGlzLmluZmxpZ2h0UHJvY2Vzc0NoaWxkcmVuLmFkZChjaGlsZClcblxuICAgIGNvbnN0IGZpbmlzaGVkID0gbmV3IFByb21pc2UoKHJlc29sdmUpID0+IHtcbiAgICAgIGNoaWxkLm9uY2UoXCJleGl0XCIsICgpID0+IHtcbiAgICAgICAgdGhpcy5pbmZsaWdodFByb2Nlc3NDaGlsZHJlbi5kZWxldGUoY2hpbGQpXG4gICAgICAgIHJlc29sdmUodW5kZWZpbmVkKVxuICAgICAgfSlcbiAgICAgIGNoaWxkLm9uY2UoXCJlcnJvclwiLCAoZXJyb3IpID0+IHtcbiAgICAgICAgdGhpcy5pbmZsaWdodFByb2Nlc3NDaGlsZHJlbi5kZWxldGUoY2hpbGQpXG4gICAgICAgIGNvbnNvbGUuZXJyb3IoXCJCYWNrZ3JvdW5kIGpvYnMgc3Bhd25lZCBydW5uZXIgZXJyb3I6XCIsIGVycm9yKVxuICAgICAgICByZXNvbHZlKHVuZGVmaW5lZClcbiAgICAgIH0pXG4gICAgfSlcblxuICAgIGNoaWxkLnVucmVmKClcblxuICAgIHJldHVybiBmaW5pc2hlZFxuICB9XG5cbiAgLyoqXG4gICAqIEJ1aWxkcyB0aGUgbm9kZSBvcHRpb25zIGFwcGxpZWQgdG8gZXZlcnkgYmFja2dyb3VuZC1qb2JzIHJ1bm5lciBjaGlsZC5cbiAgICogQSBoYXJkIFY4IGhlYXAgY2FwIGtlZXBzIG9uZSBjaGlsZCBmcm9tIGV2ZXIgY29tbWl0dGluZyBtdWx0aXBsZSBHQnMgb2ZcbiAgICogaGVhcDsgaXQgc3RheXMgZGVsaWJlcmF0ZWx5IGdlbmVyb3VzIHJlbGF0aXZlIHRvIG9ic2VydmVkIHJ1bm5lciB1c2FnZVxuICAgKiAodGVucyB0byBhIGZldyBodW5kcmVkIE1CKSBhbmQgaXMgY29uZmlndXJhYmxlIHZpYVxuICAgKiBgYmFja2dyb3VuZEpvYnMucnVubmVyTWF4T2xkU3BhY2VTaXplTWJgLlxuICAgKiBAcmV0dXJucyB7c3RyaW5nW119IC0gTm9kZSBvcHRpb25zIGZvciBydW5uZXIgY2hpbGRyZW4uXG4gICAqL1xuICBfY2hpbGRSdW5uZXJFeGVjQXJndigpIHtcbiAgICByZXR1cm4gW2AtLW1heC1vbGQtc3BhY2Utc2l6ZT0ke3RoaXMucnVubmVyTWF4T2xkU3BhY2VTaXplTWJ9YF1cbiAgfVxuXG4gIC8qKlxuICAgKiBCdWlsZHMgdGhlIGV4YWN0IG1haW4gZW5kcG9pbnQgYW5kIGdlbmVyYXRpb24gaW5oZXJpdGVkIGJ5IGV2ZXJ5IGNoaWxkLlxuICAgKiBAcmV0dXJucyB7UmVjb3JkPHN0cmluZywgc3RyaW5nPn0gLSBDaGlsZCBwcm9jZXNzIGVudmlyb25tZW50IGFkZGl0aW9ucy5cbiAgICovXG4gIF9jaGlsZEJhY2tncm91bmRKb2JzRW52aXJvbm1lbnQoKSB7XG4gICAgY29uc3QgY29uZmlndXJhdGlvbiA9IHRoaXMuY29uZmlndXJhdGlvblxuICAgIGlmICghY29uZmlndXJhdGlvbikgdGhyb3cgbmV3IEVycm9yKFwiQmFja2dyb3VuZCBqb2JzIHdvcmtlciBjb25maWd1cmF0aW9uIG5vdCBpbml0aWFsaXplZFwiKVxuICAgIGlmICghdGhpcy5ob3N0IHx8IHR5cGVvZiB0aGlzLnBvcnQgIT09IFwibnVtYmVyXCIpIHRocm93IG5ldyBFcnJvcihcIkJhY2tncm91bmQgam9icyB3b3JrZXIgZW5kcG9pbnQgbm90IHJlc29sdmVkXCIpXG5cbiAgICByZXR1cm4ge1xuICAgICAgVkVMT0NJT1VTX0JBQ0tHUk9VTkRfSk9CX0NISUxEOiBcIjFcIixcbiAgICAgIFZFTE9DSU9VU19FTlY6IGNvbmZpZ3VyYXRpb24uZ2V0RW52aXJvbm1lbnQoKSxcbiAgICAgIFZFTE9DSU9VU19CQUNLR1JPVU5EX0pPQlNfSE9TVDogdGhpcy5ob3N0LFxuICAgICAgVkVMT0NJT1VTX0JBQ0tHUk9VTkRfSk9CU19QT1JUOiBgJHt0aGlzLnBvcnR9YCxcbiAgICAgIE1BTExPQ19BUkVOQV9NQVg6IGAke3RoaXMucnVubmVyTWFsbG9jQXJlbmFNYXh9YCxcbiAgICAgIC4uLih0aGlzLmdlbmVyYXRpb25JZCA/IHtWRUxPQ0lPVVNfQkFDS0dST1VORF9KT0JTX0dFTkVSQVRJT05fSUQ6IHRoaXMuZ2VuZXJhdGlvbklkfSA6IHt9KVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHJlcG9ydCBqb2IgcmVzdWx0LlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIE9wdGlvbnMuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBhcmdzLmpvYklkIC0gSm9iIGlkLlxuICAgKiBAcGFyYW0ge1wiY29tcGxldGVkXCIgfCBcImZhaWxlZFwiIHwgXCJyZXNjaGVkdWxlZFwifSBhcmdzLnN0YXR1cyAtIFN0YXR1cy5cbiAgICogQHBhcmFtIHtudW1iZXJ9IFthcmdzLmRlbGF5TXNdIC0gUmVzY2hlZHVsZSBkZWxheSBpbiBtaWxsaXNlY29uZHMuXG4gICAqIEBwYXJhbSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59IFthcmdzLmVycm9yXSAtIEVycm9yLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gW2FyZ3MuaGFuZG9mZklkXSAtIEhhbmRvZmYgbGVhc2UgaWQuXG4gICAqIEBwYXJhbSB7bnVtYmVyfSBbYXJncy5oYW5kZWRPZmZBdE1zXSAtIEhhbmRlZCBvZmYgdGltZXN0YW1wLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gW2FyZ3Mud29ya2VySWRdIC0gV29ya2VyIGlkLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vdHlwZXMuanNcIikuUG9vbGVkUnVubmVyRmFpbHVyZX0gW2FyZ3MucnVubmVyRmFpbHVyZV0gLSBQb29sZWQtY2hpbGQgcHJvY2VzcyBmYWlsdXJlIHByb3ZlbmFuY2UuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIHdoZW4gcmVwb3J0ZWQuXG4gICAqL1xuICBhc3luYyBfcmVwb3J0Sm9iUmVzdWx0KHtqb2JJZCwgc3RhdHVzLCBkZWxheU1zLCBlcnJvciwgaGFuZG9mZklkLCBoYW5kZWRPZmZBdE1zLCB3b3JrZXJJZCwgcnVubmVyRmFpbHVyZX0pIHtcbiAgICBpZiAoIXRoaXMuc3RhdHVzUmVwb3J0ZXIpIHJldHVyblxuXG4gICAgdHJ5IHtcbiAgICAgIC8vIFJldHJ5IGEgdHJhbnNpZW50IHBlcnNpc3QgZmFpbHVyZSAoYGpvYi11cGRhdGUtZXJyb3JgKTogdGhlIHdvcmtlciBpc1xuICAgICAgLy8gbG9uZy1saXZlZCBhbmQgY2Fubm90IGV4aXQgdG8gdHJpZ2dlciBvcnBoYW4gcmVjbGFpbSwgc28gZHJvcHBpbmcgdGhlXG4gICAgICAvLyBjb21wbGV0aW9uIGhlcmUgd291bGQgc3RyYW5kIHRoZSBqb2IgaW4gYGhhbmRlZF9vZmZgIGZvcmV2ZXIg4oCUIGZhdGFsIGZvciBhXG4gICAgICAvLyBgbWF4X2NvbmN1cnJlbmN5OiAxYCBqb2IgKGEgc3RyYW5kZWQgcm93IGJsb2NrcyBldmVyeSBmdXR1cmUgcnVuKS5cbiAgICAgIGF3YWl0IHRoaXMuc3RhdHVzUmVwb3J0ZXIucmVwb3J0V2l0aFJldHJ5KHtqb2JJZCwgc3RhdHVzLCBkZWxheU1zLCBlcnJvciwgaGFuZG9mZklkLCBoYW5kZWRPZmZBdE1zLCB3b3JrZXJJZCwgcnVubmVyRmFpbHVyZSwgcmV0cnlQZXJzaXN0RXJyb3JzOiB0cnVlfSlcbiAgICB9IGNhdGNoIChyZXBvcnRFcnJvcikge1xuICAgICAgY29uc29sZS5lcnJvcihcIkJhY2tncm91bmQgam9iIHN0YXR1cyByZXBvcnRpbmcgZmFpbGVkOlwiLCByZXBvcnRFcnJvcilcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogRmlyZXMgYSBkdXJhYmxlIGpvYi1yZXN1bHQgcmVwb3J0IHdpdGhvdXQgYmxvY2tpbmcgdGhlIGNhbGxlciAoc28gZnJlZWluZyBhXG4gICAqIGpvYi9jaGlsZCBzbG90IG5ldmVyIHdhaXRzIG9uIHRoZSByZXBvcnQpLiBUaGUgcmVwb3J0IGlzIHRyYWNrZWQgc28gYVxuICAgKiBncmFjZWZ1bCBgc3RvcCgpYCBjYW4gZHJhaW4gaW4tZmxpZ2h0IHJlcG9ydHMgYmVmb3JlIGNsb3NpbmcgdGhlIHNvY2tldC5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBPcHRpb25zLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gYXJncy5qb2JJZCAtIEpvYiBpZC5cbiAgICogQHBhcmFtIHtcImNvbXBsZXRlZFwiIHwgXCJmYWlsZWRcIiB8IFwicmVzY2hlZHVsZWRcIn0gYXJncy5zdGF0dXMgLSBTdGF0dXMuXG4gICAqIEBwYXJhbSB7bnVtYmVyfSBbYXJncy5kZWxheU1zXSAtIFJlc2NoZWR1bGUgZGVsYXkgaW4gbWlsbGlzZWNvbmRzLlxuICAgKiBAcGFyYW0ge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSBbYXJncy5lcnJvcl0gLSBFcnJvci5cbiAgICogQHBhcmFtIHtzdHJpbmd9IFthcmdzLmhhbmRvZmZJZF0gLSBIYW5kb2ZmIGxlYXNlIGlkLlxuICAgKiBAcGFyYW0ge251bWJlcn0gW2FyZ3MuaGFuZGVkT2ZmQXRNc10gLSBIYW5kZWQgb2ZmIHRpbWVzdGFtcC5cbiAgICogQHBhcmFtIHtzdHJpbmd9IFthcmdzLndvcmtlcklkXSAtIFdvcmtlciBpZC5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL3R5cGVzLmpzXCIpLlBvb2xlZFJ1bm5lckZhaWx1cmV9IFthcmdzLnJ1bm5lckZhaWx1cmVdIC0gUG9vbGVkLWNoaWxkIHByb2Nlc3MgZmFpbHVyZSBwcm92ZW5hbmNlLlxuICAgKiBAcmV0dXJucyB7dm9pZH1cbiAgICovXG4gIF9yZXBvcnRKb2JSZXN1bHRJbkJhY2tncm91bmQoe2pvYklkLCBzdGF0dXMsIGRlbGF5TXMsIGVycm9yLCBoYW5kb2ZmSWQsIGhhbmRlZE9mZkF0TXMsIHdvcmtlcklkLCBydW5uZXJGYWlsdXJlfSkge1xuICAgIC8qKlxuICAgICAqIERlZmluZXMgcmVwb3J0LlxuICAgICAqIEB0eXBlIHtQcm9taXNlPHZvaWQ+fSAqL1xuICAgIGxldCByZXBvcnRcblxuICAgIHJlcG9ydCA9IHRoaXMuX3JlcG9ydEpvYlJlc3VsdCh7am9iSWQsIHN0YXR1cywgZGVsYXlNcywgZXJyb3IsIGhhbmRvZmZJZCwgaGFuZGVkT2ZmQXRNcywgd29ya2VySWQsIHJ1bm5lckZhaWx1cmV9KS5maW5hbGx5KCgpID0+IHtcbiAgICAgIHRoaXMuaW5mbGlnaHRSZXBvcnRzLmRlbGV0ZShyZXBvcnQpXG4gICAgfSlcblxuICAgIHRoaXMuaW5mbGlnaHRSZXBvcnRzLmFkZChyZXBvcnQpXG4gIH1cbn1cbiJdfQ==