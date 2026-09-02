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
        /** @type {Map<import("node:child_process").ChildProcess, {createdAtMs: number, jobsRun: number, inflight: Map<string, {payload: import("./types.js").BackgroundJobPayload & {id: string}, resolve?: (value: void) => void, pooledJob?: Promise<void>, timeoutTimer?: ReturnType<typeof setTimeout> | null}>, lastDispatchSeq: number, retiring: boolean, started?: boolean, settling?: boolean, timeoutSigkillTimer?: ReturnType<typeof setTimeout> | null}>} */
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
            void this._handlePooledChildFailure({ child, error });
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
        if (!state || state.settling || !state.inflight.has(jobId))
            return;
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
        child.once("exit", (code, signal) => this._handlePooledChildFailure({ child, error: new Error(`Pooled background job runner exited: code=${code} signal=${signal || "none"}`) }));
        child.once("error", (error) => this._handlePooledChildFailure({ child, error }));
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
     * @returns {Promise<void>}
     */
    async _handlePooledChildFailure({ child, error }) {
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
        await performBackgroundJob({
            configuration,
            JobClass,
            jobArgs: payload.args || [],
            jobOptions: payload.options || {},
            name: `Background job worker inline: ${payload.jobName}`,
            payload
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
     * @returns {Promise<void>} - Resolves when reported.
     */
    async _reportJobResult({ jobId, status, delayMs, error, handoffId, handedOffAtMs, workerId }) {
        if (!this.statusReporter)
            return;
        try {
            // Retry a transient persist failure (`job-update-error`): the worker is
            // long-lived and cannot exit to trigger orphan reclaim, so dropping the
            // completion here would strand the job in `handed_off` forever — fatal for a
            // `max_concurrency: 1` job (a stranded row blocks every future run).
            await this.statusReporter.reportWithRetry({ jobId, status, delayMs, error, handoffId, handedOffAtMs, workerId, retryPersistErrors: true });
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
     * @returns {void}
     */
    _reportJobResultInBackground({ jobId, status, delayMs, error, handoffId, handedOffAtMs, workerId }) {
        /**
         * Defines report.
         * @type {Promise<void>} */
        let report;
        report = this._reportJobResult({ jobId, status, delayMs, error, handoffId, handedOffAtMs, workerId }).finally(() => {
            this.inflightReports.delete(report);
        });
        this.inflightReports.add(report);
    }
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoid29ya2VyLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiLi4vLi4vLi4vc3JjL2JhY2tncm91bmQtam9icy93b3JrZXIuanMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6IkFBQUEsWUFBWTtBQUVaLE9BQU8sR0FBRyxNQUFNLEtBQUssQ0FBQTtBQUNyQixPQUFPLEVBQUUsSUFBSSxFQUFFLEtBQUssRUFBRSxNQUFNLG9CQUFvQixDQUFBO0FBQ2hELE9BQU8sVUFBVSxNQUFNLGtCQUFrQixDQUFBO0FBQ3pDLE9BQU8scUJBQXFCLE1BQU0sbUJBQW1CLENBQUE7QUFDckQsT0FBTyxxQkFBcUIsTUFBTSw4QkFBOEIsQ0FBQTtBQUNoRSxPQUFPLDRCQUE0QixNQUFNLHNCQUFzQixDQUFBO0FBQy9ELE9BQU8sRUFBRSxVQUFVLEVBQUUsTUFBTSxRQUFRLENBQUE7QUFDbkMsT0FBTyxFQUFFLGFBQWEsRUFBRSxNQUFNLFVBQVUsQ0FBQTtBQUN4QyxPQUFPLGlCQUFpQixFQUFFLEVBQUUsZ0JBQWdCLEVBQUUsTUFBTSxnQ0FBZ0MsQ0FBQTtBQUNwRixPQUFPLDZCQUE2QixNQUFNLHdCQUF3QixDQUFBO0FBQ2xFLE9BQU8sb0JBQW9CLE1BQU0sa0JBQWtCLENBQUE7QUFDbkQsT0FBTyxFQUFFLHdCQUF3QixFQUFFLE1BQU0sMEJBQTBCLENBQUE7QUFDbkUsT0FBTyw2Q0FBNkMsRUFBRSxFQUFFLHVDQUF1QyxFQUFFLG9DQUFvQyxFQUFFLE1BQU0seUNBQXlDLENBQUE7QUFFdEw7Ozs7Ozs7R0FPRztBQUNILGlGQUFpRjtBQUNqRixNQUFNLDZCQUE2QixHQUFHLElBQUksQ0FBQTtBQUMxQzs7Ozs7R0FLRztBQUNILE1BQU0seUJBQXlCLEdBQUcsYUFBYSxDQUFBO0FBQy9DLE1BQU0sd0JBQXdCLEdBQUcsYUFBYSxDQUFDLElBQUksR0FBRyxDQUFDLDBCQUEwQixFQUFFLE9BQU8sSUFBSSxDQUFDLEdBQUcsQ0FBQyxDQUFDLENBQUE7QUFDcEcsTUFBTSx3QkFBd0Is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LENBQUMsQ0FBQTtJQUNsQyxDQUFDO0NBQ0YiLCJzb3VyY2VzQ29udGVudCI6WyIvLyBAdHMtY2hlY2tcblxuaW1wb3J0IG5ldCBmcm9tIFwibmV0XCJcbmltcG9ydCB7IGZvcmssIHNwYXduIH0gZnJvbSBcIm5vZGU6Y2hpbGRfcHJvY2Vzc1wiXG5pbXBvcnQgSnNvblNvY2tldCBmcm9tIFwiLi9qc29uLXNvY2tldC5qc1wiXG5pbXBvcnQgQmFja2dyb3VuZEpvYlJlZ2lzdHJ5IGZyb20gXCIuL2pvYi1yZWdpc3RyeS5qc1wiXG5pbXBvcnQgY29uZmlndXJhdGlvblJlc29sdmVyIGZyb20gXCIuLi9jb25maWd1cmF0aW9uLXJlc29sdmVyLmpzXCJcbmltcG9ydCBCYWNrZ3JvdW5kSm9ic1N0YXR1c1JlcG9ydGVyIGZyb20gXCIuL3N0YXR1cy1yZXBvcnRlci5qc1wiXG5pbXBvcnQgeyByYW5kb21VVUlEIH0gZnJvbSBcImNyeXB0b1wiXG5pbXBvcnQgeyBmaWxlVVJMVG9QYXRoIH0gZnJvbSBcIm5vZGU6dXJsXCJcbmltcG9ydCBzaHV0ZG93bkxpZmVjeWNsZSwgeyBydW5TaHV0ZG93blN0ZXBzIH0gZnJvbSBcIi4uL3V0aWxzL3NodXRkb3duLWxpZmVjeWNsZS5qc1wiXG5pbXBvcnQgQmFja2dyb3VuZEpvYlJlc2NoZWR1bGVTaWduYWwgZnJvbSBcIi4vcmVzY2hlZHVsZS1zaWduYWwuanNcIlxuaW1wb3J0IHBlcmZvcm1CYWNrZ3JvdW5kSm9iIGZyb20gXCIuL3BlcmZvcm0tam9iLmpzXCJcbmltcG9ydCB7IGNyZWF0ZUdlbmVyYXRpb25Xb3JrZXJJZCB9IGZyb20gXCIuL2dlbmVyYXRpb24taWRlbnRpdHkuanNcIlxuaW1wb3J0IEJhY2tncm91bmRKb2JzR2VuZXJhdGlvbkhhbmRzaGFrZVRpbWVvdXRFcnJvciwgeyBERUZBVUxUX0dFTkVSQVRJT05fSEFORFNIQUtFX1RJTUVPVVRfTVMsIHZhbGlkYXRlR2VuZXJhdGlvbkhhbmRzaGFrZVRpbWVvdXRNcyB9IGZyb20gXCIuL2dlbmVyYXRpb24taGFuZHNoYWtlLXRpbWVvdXQtZXJyb3IuanNcIlxuXG4vKipcbiAqIFBlci1mb3JrZWQtY2hpbGQgdGltZW91dCBib29ra2VlcGluZy5cbiAqIEB0eXBlZGVmIHtvYmplY3R9IEZvcmtlZEpvYlRpbWVvdXRTdGF0ZVxuICogQHByb3BlcnR5IHtib29sZWFufSB0aW1lZE91dCAtIFdoZXRoZXIgdGhlIHRpbWVvdXQgZmlyZWQgYW5kIHRoZSBjaGlsZCB3YXMgdGVybWluYXRlZC5cbiAqIEBwcm9wZXJ0eSB7bnVtYmVyIHwgbnVsbH0gdGltZW91dE1zIC0gVGhlIGFybWVkIHRpbWVvdXQgaW4gbXMsIG9yIG51bGwgd2hlbiBkaXNhYmxlZC5cbiAqIEBwcm9wZXJ0eSB7UmV0dXJuVHlwZTx0eXBlb2Ygc2V0VGltZW91dD4gfCBudWxsfSB0aW1lciAtIFRoZSBwZW5kaW5nIHRpbWVvdXQgdGltZXIsIGNsZWFyZWQgb24gZXhpdC5cbiAqIEBwcm9wZXJ0eSB7UmV0dXJuVHlwZTx0eXBlb2Ygc2V0VGltZW91dD4gfCBudWxsfSBzaWdraWxsVGltZXIgLSBUaGUgcGVuZGluZyBTSUdLSUxMIGdyYWNlIHRpbWVyLCBjbGVhcmVkIG9uIGV4aXQuXG4gKi9cbi8qKiBHcmFjZSBwZXJpb2QgYWZ0ZXIgU0lHVEVSTSBiZWZvcmUgYSBsaW5nZXJpbmcgcHJvY2VzcyBydW5uZXIgaXMgU0lHS0lMTGVkLiAqL1xuY29uc3QgRk9SS0VEX0NISUxEX1NJR0tJTExfR1JBQ0VfTVMgPSA1MDAwXG4vKipcbiAqIExhcmdlc3QgZGVsYXkgTm9kZSdzIGBzZXRUaW1lb3V0YCBhY2NlcHRzIHdpdGhvdXQgb3ZlcmZsb3dpbmcgdG8gYSAxbXMgZGVsYXlcbiAqIChhIDMyLWJpdCBzaWduZWQgaW50IG9mIG1zLCB+MjQuOCBkYXlzKS4gQSBgam9iVGltZW91dE1zYCBhYm92ZSB0aGlzIOKAlCBvciBhXG4gKiBub24tZmluaXRlIG9uZSBsaWtlIGBJbmZpbml0eWAg4oCUIGlzIGNsYW1wZWQvZGlzYWJsZWQgcmF0aGVyIHRoYW4gY29lcmNlZCB0b1xuICogfjFtcywgd2hpY2ggd291bGQgb3RoZXJ3aXNlIHRlcm1pbmF0ZSBldmVyeSBmb3JrZWQgam9iIGFsbW9zdCBpbW1lZGlhdGVseS5cbiAqL1xuY29uc3QgTUFYX0ZPUktFRF9KT0JfVElNRU9VVF9NUyA9IDJfMTQ3XzQ4M182NDdcbmNvbnN0IEZPUktFRF9SVU5ORVJfRU5UUllfUEFUSCA9IGZpbGVVUkxUb1BhdGgobmV3IFVSTChcIi4vZm9ya2VkLXJ1bm5lci1jaGlsZC5qc1wiLCBpbXBvcnQubWV0YS51cmwpKVxuY29uc3QgUE9PTEVEX1JVTk5FUl9FTlRSWV9QQVRIID0gZmlsZVVSTFRvUGF0aChuZXcgVVJMKFwiLi9wb29sZWQtcnVubmVyLWNoaWxkLmpzXCIsIGltcG9ydC5tZXRhLnVybCkpXG4vKiogSG93IG9mdGVuIHRoZSB3b3JrZXIgc2VuZHMgYSBsaXZlbmVzcyBoZWFydGJlYXQgdG8gdGhlIG1haW4uICovXG5jb25zdCBIRUFSVEJFQVRfSU5URVJWQUxfTVMgPSAxNTAwMFxuLyoqIFRDUCBrZWVwYWxpdmUgc28gYSBoYWxmLW9wZW4gY29ubmVjdGlvbiB0byB0aGUgbWFpbiBzdXJmYWNlcyBhcyBhIGNsb3NlLiAqL1xuY29uc3QgU09DS0VUX0tFRVBBTElWRV9NUyA9IDEwMDAwXG4vKipcbiAqIEV4ZWN1dGlvbiBtb2Rlcy5cbiAqIEB0eXBlIHtpbXBvcnQoXCIuL3R5cGVzLmpzXCIpLkJhY2tncm91bmRKb2JFeGVjdXRpb25Nb2RlW119ICovXG5jb25zdCBFWEVDVVRJT05fTU9ERVMgPSBbXCJpbmxpbmVcIiwgXCJmb3JrZWRcIiwgXCJwb29sZWRcIiwgXCJzcGF3bmVkXCJdXG5cbi8qKlxuICogTm9ybWFsaXplcyBhIGNhbmRpZGF0ZSBwb29sZWQtcnVubmVyIGNvdW50IG9yIGpvYiBsaW1pdC5cbiAqIEBwYXJhbSB7bnVtYmVyIHwgdW5kZWZpbmVkfSB2YWx1ZSAtIENhbmRpZGF0ZSBwb3NpdGl2ZSBpbnRlZ2VyLlxuICogQHJldHVybnMge251bWJlciB8IHVuZGVmaW5lZH0gLSBOb3JtYWxpemVkIHZhbHVlLlxuICovXG5mdW5jdGlvbiBwb3NpdGl2ZUludGVnZXIodmFsdWUpIHtcbiAgcmV0dXJuIHR5cGVvZiB2YWx1ZSA9PT0gXCJudW1iZXJcIiAmJiBOdW1iZXIuaXNJbnRlZ2VyKHZhbHVlKSAmJiB2YWx1ZSA+IDAgPyB2YWx1ZSA6IHVuZGVmaW5lZFxufVxuXG4vKipcbiAqIE5vcm1hbGl6ZXMgYSBjYW5kaWRhdGUgcG9vbGVkLXJ1bm5lciByZXNvdXJjZSBsaW1pdC5cbiAqIEBwYXJhbSB7bnVtYmVyIHwgdW5kZWZpbmVkfSB2YWx1ZSAtIENhbmRpZGF0ZSBwb3NpdGl2ZSBudW1iZXIuXG4gKiBAcmV0dXJucyB7bnVtYmVyIHwgdW5kZWZpbmVkfSAtIE5vcm1hbGl6ZWQgdmFsdWUuXG4gKi9cbmZ1bmN0aW9uIHBvc2l0aXZlTnVtYmVyKHZhbHVlKSB7XG4gIHJldHVybiB0eXBlb2YgdmFsdWUgPT09IFwibnVtYmVyXCIgJiYgTnVtYmVyLmlzRmluaXRlKHZhbHVlKSAmJiB2YWx1ZSA+IDAgPyB2YWx1ZSA6IHVuZGVmaW5lZFxufVxuXG5leHBvcnQgZGVmYXVsdCBjbGFzcyBCYWNrZ3JvdW5kSm9ic1dvcmtlciB7XG4gIC8qKlxuICAgKiBSdW5zIGNvbnN0cnVjdG9yLlxuICAgKiBAcGFyYW0ge29iamVjdH0gW2FyZ3NdIC0gT3B0aW9ucy5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9jb25maWd1cmF0aW9uLmpzXCIpLmRlZmF1bHR9IFthcmdzLmNvbmZpZ3VyYXRpb25dIC0gQ29uZmlndXJhdGlvbi5cbiAgICogQHBhcmFtIHtzdHJpbmd9IFthcmdzLmhvc3RdIC0gSG9zdG5hbWUuXG4gICAqIEBwYXJhbSB7bnVtYmVyfSBbYXJncy5wb3J0XSAtIFBvcnQuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBbYXJncy5nZW5lcmF0aW9uSWRdIC0gRXhwbGljaXQgcmVsZWFzZSBnZW5lcmF0aW9uIGlkZW50aXR5LlxuICAgKiBAcGFyYW0ge3N0cmluZ30gW2FyZ3Mud29ya2VySW5zdGFuY2VJZF0gLSBFeHBsaWNpdCBzdGFibGUgd29ya2VyIFVVSUQuXG4gICAqIEBwYXJhbSB7bnVtYmVyfSBbYXJncy5tYXhDb25jdXJyZW50Rm9ya2VkSm9ic10gLSBPdmVycmlkZSB0aGUgcHJvY2VzcyBydW5uZXIgY29uY3VycmVuY3kgY2FwIGZyb20gYGNvbmZpZ3VyYXRpb24uZ2V0QmFja2dyb3VuZEpvYnNDb25maWcoKWAuXG4gICAqIEBwYXJhbSB7bnVtYmVyfSBbYXJncy5tYXhDb25jdXJyZW50SW5saW5lSm9ic10gLSBPdmVycmlkZSB0aGUgaW5saW5lLWpvYiBjb25jdXJyZW5jeSBjYXAgZnJvbSBgY29uZmlndXJhdGlvbi5nZXRCYWNrZ3JvdW5kSm9ic0NvbmZpZygpYC5cbiAgICogQHBhcmFtIHtudW1iZXJ9IFthcmdzLnBvb2xlZFJ1bm5lckNvdW50XSAtIE92ZXJyaWRlIHRoZSBwb29sZWQgcnVubmVyIGNvdW50LlxuICAgKiBAcGFyYW0ge251bWJlcn0gW2FyZ3MucG9vbGVkUnVubmVyQ29uY3VycmVuY3ldIC0gT3ZlcnJpZGUgdGhlIHBlci1ydW5uZXIgY29uY3VycmVuY3kuXG4gICAqIEBwYXJhbSB7bnVtYmVyfSBbYXJncy5wb29sZWRSdW5uZXJNYXhKb2JzXSAtIE92ZXJyaWRlIHRoZSBwZXItcnVubmVyIHJlY3ljbGUgam9iIGNvdW50LlxuICAgKiBAcGFyYW0ge251bWJlcn0gW2FyZ3MucG9vbGVkUnVubmVyTWF4UnNzQnl0ZXNdIC0gT3ZlcnJpZGUgdGhlIHBlci1ydW5uZXIgcmVjeWNsZSBSU1MgbGltaXQuXG4gICAqIEBwYXJhbSB7bnVtYmVyfSBbYXJncy5wb29sZWRSdW5uZXJNYXhMaWZldGltZU1zXSAtIE92ZXJyaWRlIHRoZSBwZXItcnVubmVyIHJlY3ljbGUgbGlmZXRpbWUuXG4gICAqIEBwYXJhbSB7bnVtYmVyfSBbYXJncy5mb3JrZWRDaGlsZFNpZ2tpbGxHcmFjZU1zXSAtIE92ZXJyaWRlIHRoZSBncmFjZSBwZXJpb2QgYmV0d2VlbiBTSUdURVJNIGFuZCBTSUdLSUxMIHdoZW4gcmVhcGluZyBsaW5nZXJpbmcgcHJvY2VzcyBydW5uZXJzIG9uIHN0b3AuXG4gICAqIEBwYXJhbSB7bnVtYmVyfSBbYXJncy5oZWFydGJlYXRJbnRlcnZhbE1zXSAtIE92ZXJyaWRlIHRoZSBsaXZlbmVzcyBoZWFydGJlYXQgaW50ZXJ2YWwgKGRlZmF1bHQgMTUwMDBtcykuXG4gICAqIEBwYXJhbSB7bnVtYmVyfSBbYXJncy5nZW5lcmF0aW9uSGFuZHNoYWtlVGltZW91dE1zXSAtIE1heGltdW0gdGltZSB0byB3YWl0IGZvciBnZW5lcmF0aW9uIGFja25vd2xlZGdlbWVudCAoZGVmYXVsdDogNDAwMCkuXG4gICAqIEBwYXJhbSB7bnVtYmVyfSBbYXJncy5yZWNvbm5lY3REZWxheU1zXSAtIERlbGF5IGJlZm9yZSByZWNvbm5lY3RpbmcgYW4gZXN0YWJsaXNoZWQgd29ya2VyIGNvbm5lY3Rpb24gKGRlZmF1bHQ6IDEwMDApLlxuICAgKiBAcGFyYW0ge251bWJlcn0gW2FyZ3Muam9iVGltZW91dE1zXSAtIE92ZXJyaWRlIHRoZSB3YWxsLWNsb2NrIHRpbWVvdXQgZm9yIGZvcmtlZCBhbmQgcG9vbGVkIGpvYnMgZnJvbSBgY29uZmlndXJhdGlvbi5nZXRCYWNrZ3JvdW5kSm9ic0NvbmZpZygpYC4gYDBgIGRpc2FibGVzIGl0LlxuICAgKiBAcGFyYW0ge2Jvb2xlYW59IFthcmdzLmNsb3NlRGF0YWJhc2VDb25uZWN0aW9uc09uU3RvcF0gLSBXaGV0aGVyIHN0b3Agb3ducyBjbG9zaW5nIHRoZSBjb25maWd1cmF0aW9uJ3MgZGF0YWJhc2UgcG9vbHMgKGRlZmF1bHQgdHJ1ZSkuXG4gICAqIEBwYXJhbSB7KCkgPT4gdm9pZCB8IFByb21pc2U8dm9pZD59IFthcmdzLm9uU3RvcHBlZF0gLSBMaWZlY3ljbGUgaG9vayBpbnZva2VkIGFmdGVyIHRoZSB3b3JrZXIgZmluaXNoZXMgc3RvcHBpbmcuXG4gICAqIEBwYXJhbSB7KCkgPT4gdm9pZH0gW2FyZ3Mub25HZW5lcmF0aW9uQWNjZXB0ZWRdIC0gRXhwbGljaXQgZ2VuZXJhdGlvbi1hY2NlcHRhbmNlIG9ic2VydmF0aW9uIGhvb2suXG4gICAqIEBwYXJhbSB7KCkgPT4gdm9pZH0gW2FyZ3Mub25SZXRpcmVNZXNzYWdlXSAtIEV4cGxpY2l0IHJldGlyZS1tZXNzYWdlIG9ic2VydmF0aW9uIGhvb2suXG4gICAqL1xuICBjb25zdHJ1Y3Rvcih7Y29uZmlndXJhdGlvbiwgaG9zdCwgcG9ydCwgZ2VuZXJhdGlvbklkLCB3b3JrZXJJbnN0YW5jZUlkLCBtYXhDb25jdXJyZW50Rm9ya2VkSm9icywgbWF4Q29uY3VycmVudElubGluZUpvYnMsIHBvb2xlZFJ1bm5lckNvdW50LCBwb29sZWRSdW5uZXJDb25jdXJyZW5jeSwgcG9vbGVkUnVubmVyTWF4Sm9icywgcG9vbGVkUnVubmVyTWF4UnNzQnl0ZXMsIHBvb2xlZFJ1bm5lck1heExpZmV0aW1lTXMsIGZvcmtlZENoaWxkU2lna2lsbEdyYWNlTXMsIGhlYXJ0YmVhdEludGVydmFsTXMsIGdlbmVyYXRpb25IYW5kc2hha2VUaW1lb3V0TXMgPSBERUZBVUxUX0dFTkVSQVRJT05fSEFORFNIQUtFX1RJTUVPVVRfTVMsIHJlY29ubmVjdERlbGF5TXMgPSAxMDAwLCBqb2JUaW1lb3V0TXMsIGNsb3NlRGF0YWJhc2VDb25uZWN0aW9uc09uU3RvcCA9IHRydWUsIG9uU3RvcHBlZCwgb25HZW5lcmF0aW9uQWNjZXB0ZWQsIG9uUmV0aXJlTWVzc2FnZX0gPSB7fSkge1xuICAgIC8qKlxuICAgICAqIE5hcnJvd3MgdGhlIHJ1bnRpbWUgdmFsdWUgdG8gdGhlIGRvY3VtZW50ZWQgdHlwZS5cbiAgICAgKiBAdHlwZSB7UHJvbWlzZTxpbXBvcnQoXCIuLi9jb25maWd1cmF0aW9uLmpzXCIpLmRlZmF1bHQ+fSAqL1xuICAgIHRoaXMuY29uZmlndXJhdGlvblByb21pc2UgPSBjb25maWd1cmF0aW9uID8gUHJvbWlzZS5yZXNvbHZlKGNvbmZpZ3VyYXRpb24pIDogY29uZmlndXJhdGlvblJlc29sdmVyKClcbiAgICAvKipcbiAgICAgKiBOYXJyb3dzIHRoZSBydW50aW1lIHZhbHVlIHRvIHRoZSBkb2N1bWVudGVkIHR5cGUuXG4gICAgICogQHR5cGUge2ltcG9ydChcIi4uL2NvbmZpZ3VyYXRpb24uanNcIikuZGVmYXVsdCB8IHVuZGVmaW5lZH0gKi9cbiAgICB0aGlzLmNvbmZpZ3VyYXRpb24gPSB1bmRlZmluZWRcbiAgICB0aGlzLmhvc3QgPSBob3N0XG4gICAgdGhpcy5wb3J0ID0gcG9ydFxuICAgIHRoaXMuZXhwbGljaXRHZW5lcmF0aW9uSWQgPSBnZW5lcmF0aW9uSWRcbiAgICB0aGlzLndvcmtlckluc3RhbmNlSWQgPSB3b3JrZXJJbnN0YW5jZUlkIHx8IHJhbmRvbVVVSUQoKVxuICAgIC8qKiBAdHlwZSB7c3RyaW5nIHwgdW5kZWZpbmVkfSAqL1xuICAgIHRoaXMuZ2VuZXJhdGlvbklkID0gdW5kZWZpbmVkXG4gICAgdGhpcy5jbG9zZURhdGFiYXNlQ29ubmVjdGlvbnNPblN0b3AgPSBjbG9zZURhdGFiYXNlQ29ubmVjdGlvbnNPblN0b3BcbiAgICB0aGlzLm9uU3RvcHBlZCA9IG9uU3RvcHBlZFxuICAgIHRoaXMub25HZW5lcmF0aW9uQWNjZXB0ZWQgPSBvbkdlbmVyYXRpb25BY2NlcHRlZFxuICAgIHRoaXMub25SZXRpcmVNZXNzYWdlID0gb25SZXRpcmVNZXNzYWdlXG4gICAgLyoqXG4gICAgICogQ29uc3RydWN0b3Igb3ZlcnJpZGUgZm9yIHRoZSBpbmxpbmUtam9iIGNvbmN1cnJlbmN5IGNhcC4gV2hlbiB1bnNldFxuICAgICAqIHRoZSBjYXAgaXMgcmVhZCBmcm9tIGBjb25maWd1cmF0aW9uLmdldEJhY2tncm91bmRKb2JzQ29uZmlnKClgIGluXG4gICAgICogYHN0YXJ0KClgIChkZWZhdWx0OiA0KS5cbiAgICAgKiBAdHlwZSB7bnVtYmVyIHwgdW5kZWZpbmVkfVxuICAgICAqL1xuICAgIHRoaXMubWF4Q29uY3VycmVudElubGluZUpvYnNPdmVycmlkZSA9IHR5cGVvZiBtYXhDb25jdXJyZW50SW5saW5lSm9icyA9PT0gXCJudW1iZXJcIiAmJiBtYXhDb25jdXJyZW50SW5saW5lSm9icyA+PSAxXG4gICAgICA/IG1heENvbmN1cnJlbnRJbmxpbmVKb2JzXG4gICAgICA6IHVuZGVmaW5lZFxuICAgIC8qKlxuICAgICAqIE5hcnJvd3MgdGhlIHJ1bnRpbWUgdmFsdWUgdG8gdGhlIGRvY3VtZW50ZWQgdHlwZS5cbiAgICAgKiBAdHlwZSB7bnVtYmVyIHwgdW5kZWZpbmVkfSAqL1xuICAgIHRoaXMubWF4Q29uY3VycmVudEZvcmtlZEpvYnNPdmVycmlkZSA9IHR5cGVvZiBtYXhDb25jdXJyZW50Rm9ya2VkSm9icyA9PT0gXCJudW1iZXJcIiAmJiBtYXhDb25jdXJyZW50Rm9ya2VkSm9icyA+PSAxXG4gICAgICA/IG1heENvbmN1cnJlbnRGb3JrZWRKb2JzXG4gICAgICA6IHVuZGVmaW5lZFxuICAgIC8qKlxuICAgICAqIFJlc29sdmVkIGNhcCBmb3IgaW5saW5lLWpvYiBjb25jdXJyZW5jeS4gU2V0IGluIGBzdGFydCgpYDsgZGVmYXVsdHMgdG9cbiAgICAgKiA0IGlmIG5vIGNvbmZpZ3VyYXRpb24gdmFsdWUgaXMgYXZhaWxhYmxlLlxuICAgICAqIEB0eXBlIHtudW1iZXJ9XG4gICAgICovXG4gICAgdGhpcy5tYXhDb25jdXJyZW50SW5saW5lSm9icyA9IHRoaXMubWF4Q29uY3VycmVudElubGluZUpvYnNPdmVycmlkZSB8fCA0XG4gICAgLyoqXG4gICAgICogTmFycm93cyB0aGUgcnVudGltZSB2YWx1ZSB0byB0aGUgZG9jdW1lbnRlZCB0eXBlLlxuICAgICAqIEB0eXBlIHtudW1iZXJ9ICovXG4gICAgdGhpcy5tYXhDb25jdXJyZW50Rm9ya2VkSm9icyA9IHRoaXMubWF4Q29uY3VycmVudEZvcmtlZEpvYnNPdmVycmlkZSB8fCA0XG4gICAgdGhpcy5wb29sZWRSdW5uZXJDb3VudE92ZXJyaWRlID0gcG9zaXRpdmVJbnRlZ2VyKHBvb2xlZFJ1bm5lckNvdW50KVxuICAgIHRoaXMucG9vbGVkUnVubmVyQ29uY3VycmVuY3lPdmVycmlkZSA9IHBvc2l0aXZlSW50ZWdlcihwb29sZWRSdW5uZXJDb25jdXJyZW5jeSlcbiAgICB0aGlzLnBvb2xlZFJ1bm5lck1heEpvYnNPdmVycmlkZSA9IHBvc2l0aXZlSW50ZWdlcihwb29sZWRSdW5uZXJNYXhKb2JzKVxuICAgIHRoaXMucG9vbGVkUnVubmVyTWF4UnNzQnl0ZXNPdmVycmlkZSA9IHBvc2l0aXZlTnVtYmVyKHBvb2xlZFJ1bm5lck1heFJzc0J5dGVzKVxuICAgIHRoaXMucG9vbGVkUnVubmVyTWF4TGlmZXRpbWVNc092ZXJyaWRlID0gcG9zaXRpdmVOdW1iZXIocG9vbGVkUnVubmVyTWF4TGlmZXRpbWVNcylcbiAgICB0aGlzLnBvb2xlZFJ1bm5lckNvdW50ID0gdGhpcy5wb29sZWRSdW5uZXJDb3VudE92ZXJyaWRlIHx8IDRcbiAgICB0aGlzLnBvb2xlZFJ1bm5lckNvbmN1cnJlbmN5ID0gdGhpcy5wb29sZWRSdW5uZXJDb25jdXJyZW5jeU92ZXJyaWRlIHx8IDFcbiAgICB0aGlzLnBvb2xlZFJ1bm5lck1heEpvYnMgPSB0aGlzLnBvb2xlZFJ1bm5lck1heEpvYnNPdmVycmlkZSB8fCAxMDBcbiAgICB0aGlzLnBvb2xlZFJ1bm5lck1heFJzc0J5dGVzID0gdGhpcy5wb29sZWRSdW5uZXJNYXhSc3NCeXRlc092ZXJyaWRlIHx8IDUxMiAqIDEwMjQgKiAxMDI0XG4gICAgdGhpcy5wb29sZWRSdW5uZXJNYXhMaWZldGltZU1zID0gdGhpcy5wb29sZWRSdW5uZXJNYXhMaWZldGltZU1zT3ZlcnJpZGUgfHwgNjAgKiA2MCAqIDEwMDBcbiAgICAvKipcbiAgICAgKiBHcmFjZSBwZXJpb2QgYmV0d2VlbiBTSUdURVJNIGFuZCBTSUdLSUxMIHdoZW4gcmVhcGluZyBwcm9jZXNzIHJ1bm5lcnMgdGhhdFxuICAgICAqIG91dGxhc3QgYSBib3VuZGVkIHNodXRkb3duIGRyYWluLlxuICAgICAqIEB0eXBlIHtudW1iZXJ9XG4gICAgICovXG4gICAgdGhpcy5mb3JrZWRDaGlsZFNpZ2tpbGxHcmFjZU1zID0gdHlwZW9mIGZvcmtlZENoaWxkU2lna2lsbEdyYWNlTXMgPT09IFwibnVtYmVyXCIgJiYgZm9ya2VkQ2hpbGRTaWdraWxsR3JhY2VNcyA+PSAwXG4gICAgICA/IGZvcmtlZENoaWxkU2lna2lsbEdyYWNlTXNcbiAgICAgIDogRk9SS0VEX0NISUxEX1NJR0tJTExfR1JBQ0VfTVNcbiAgICAvKipcbiAgICAgKiBDb25zdHJ1Y3RvciBvdmVycmlkZSBmb3IgdGhlIGZvcmtlZCBhbmQgcG9vbGVkIHdhbGwtY2xvY2sgam9iIHRpbWVvdXQuIFdoZW4gdW5zZXQgdGhlXG4gICAgICogdGltZW91dCBpcyByZWFkIGZyb20gYGNvbmZpZ3VyYXRpb24uZ2V0QmFja2dyb3VuZEpvYnNDb25maWcoKS5qb2JUaW1lb3V0TXNgXG4gICAgICogYXQgZm9yayB0aW1lIChkZWZhdWx0OiBkaXNhYmxlZCkuXG4gICAgICogQHR5cGUge251bWJlciB8IHVuZGVmaW5lZH1cbiAgICAgKi9cbiAgICB0aGlzLmpvYlRpbWVvdXRNc092ZXJyaWRlID0gdHlwZW9mIGpvYlRpbWVvdXRNcyA9PT0gXCJudW1iZXJcIiA/IGpvYlRpbWVvdXRNcyA6IHVuZGVmaW5lZFxuICAgIHRoaXMuc2hvdWxkU3RvcCA9IGZhbHNlXG4gICAgdGhpcy5pc1JldGlyaW5nID0gZmFsc2VcbiAgICAvKiogQHR5cGUge1Byb21pc2U8dm9pZD4gfCB1bmRlZmluZWR9ICovXG4gICAgdGhpcy5zdG9wUHJvbWlzZSA9IHVuZGVmaW5lZFxuICAgIC8qKlxuICAgICAqIFJlc29sdmVzIHN0b3Agb2JzZXJ2YXRpb24uXG4gICAgICogQHR5cGUgeyh2YWx1ZT86IHZvaWQpID0+IHZvaWR9XG4gICAgICovXG4gICAgdGhpcy5fcmVzb2x2ZVN0b3BwZWQgPSAoKSA9PiB7fVxuICAgIC8qKlxuICAgICAqIFJlamVjdHMgc3RvcCBvYnNlcnZhdGlvbi5cbiAgICAgKiBAdHlwZSB7KGVycm9yOiBFcnJvcikgPT4gdm9pZH1cbiAgICAgKi9cbiAgICB0aGlzLl9yZWplY3RTdG9wcGVkID0gKCkgPT4ge31cbiAgICAvKiogQHR5cGUge1Byb21pc2U8dm9pZD59ICovXG4gICAgdGhpcy5fc3RvcHBlZFByb21pc2UgPSBQcm9taXNlLnJlc29sdmUoKVxuICAgIHRoaXMuX3Jlc2V0U3RvcHBlZFByb21pc2UoKVxuICAgIHRoaXMud29ya2VySWQgPSB0aGlzLndvcmtlckluc3RhbmNlSWRcbiAgICB0aGlzLl9nZW5lcmF0aW9uQWNjZXB0ZWQgPSBmYWxzZVxuICAgIHRoaXMuZ2VuZXJhdGlvbkhhbmRzaGFrZVRpbWVvdXRNcyA9IHZhbGlkYXRlR2VuZXJhdGlvbkhhbmRzaGFrZVRpbWVvdXRNcyhnZW5lcmF0aW9uSGFuZHNoYWtlVGltZW91dE1zKVxuICAgIGlmICghTnVtYmVyLmlzSW50ZWdlcihyZWNvbm5lY3REZWxheU1zKSB8fCByZWNvbm5lY3REZWxheU1zIDwgMCB8fCByZWNvbm5lY3REZWxheU1zID4gTUFYX0ZPUktFRF9KT0JfVElNRU9VVF9NUykge1xuICAgICAgdGhyb3cgbmV3IFR5cGVFcnJvcihcInJlY29ubmVjdERlbGF5TXMgbXVzdCBiZSBhbiBpbnRlZ2VyIGJldHdlZW4gMCBhbmQgMjE0NzQ4MzY0N1wiKVxuICAgIH1cbiAgICB0aGlzLnJlY29ubmVjdERlbGF5TXMgPSByZWNvbm5lY3REZWxheU1zXG4gICAgLyoqIEB0eXBlIHtSZXR1cm5UeXBlPHR5cGVvZiBzZXRUaW1lb3V0PiB8IHVuZGVmaW5lZH0gKi9cbiAgICB0aGlzLl9yZWNvbm5lY3RUaW1lciA9IHVuZGVmaW5lZFxuICAgIHRoaXMuaGVhcnRiZWF0SW50ZXJ2YWxNcyA9IHR5cGVvZiBoZWFydGJlYXRJbnRlcnZhbE1zID09PSBcIm51bWJlclwiICYmIGhlYXJ0YmVhdEludGVydmFsTXMgPj0gMVxuICAgICAgPyBoZWFydGJlYXRJbnRlcnZhbE1zXG4gICAgICA6IEhFQVJUQkVBVF9JTlRFUlZBTF9NU1xuICAgIC8qKlxuICAgICAqIE5hcnJvd3MgdGhlIHJ1bnRpbWUgdmFsdWUgdG8gdGhlIGRvY3VtZW50ZWQgdHlwZS5cbiAgICAgKiBAdHlwZSB7UmV0dXJuVHlwZTx0eXBlb2Ygc2V0SW50ZXJ2YWw+IHwgdW5kZWZpbmVkfSAqL1xuICAgIHRoaXMuX2hlYXJ0YmVhdFRpbWVyID0gdW5kZWZpbmVkXG4gICAgLyoqXG4gICAgICogSW4tZmxpZ2h0IGpvYi1yZXN1bHQgcmVwb3J0cyB0byB0aGUgbWFpbi4gUmVwb3J0aW5nIGlzIGRlY291cGxlZCBmcm9tIHRoZVxuICAgICAqIGpvYi9jaGlsZCBzbG90IChmcmVlaW5nIHRoZSBzbG90IG5ldmVyIHdhaXRzIG9uIGEgcmVwb3J0KSBhbmQgcmV0cmllZFxuICAgICAqIGR1cmFibHksIHNvIGEgdHJhbnNpZW50IG1haW4vREIgb3V0YWdlIGNhbm5vdCBsZWFrIHNsb3RzIG9yIGxvc2UgYVxuICAgICAqIHRlcm1pbmFsIHJlcG9ydC4gVHJhY2tlZCBzbyBhIGdyYWNlZnVsIGBzdG9wKClgIGNhbiBkcmFpbiB0aGVtLlxuICAgICAqIEB0eXBlIHtTZXQ8UHJvbWlzZTx2b2lkPj59XG4gICAgICovXG4gICAgdGhpcy5pbmZsaWdodFJlcG9ydHMgPSBuZXcgU2V0KClcbiAgICAvKipcbiAgICAgKiBOYXJyb3dzIHRoZSBydW50aW1lIHZhbHVlIHRvIHRoZSBkb2N1bWVudGVkIHR5cGUuXG4gICAgICogQHR5cGUge0pzb25Tb2NrZXQgfCB1bmRlZmluZWR9ICovXG4gICAgdGhpcy5qc29uU29ja2V0ID0gdW5kZWZpbmVkXG4gICAgLyoqXG4gICAgICogTmFycm93cyB0aGUgcnVudGltZSB2YWx1ZSB0byB0aGUgZG9jdW1lbnRlZCB0eXBlLlxuICAgICAqIEB0eXBlIHtCYWNrZ3JvdW5kSm9ic1N0YXR1c1JlcG9ydGVyIHwgdW5kZWZpbmVkfSAqL1xuICAgIHRoaXMuc3RhdHVzUmVwb3J0ZXIgPSB1bmRlZmluZWRcbiAgICAvKipcbiAgICAgKiBVcCB0byBgdGhpcy5tYXhDb25jdXJyZW50SW5saW5lSm9ic2Agb2YgdGhlc2UgcnVuIGluIHBhcmFsbGVsLiBUaGV5XG4gICAgICogc2hhcmUgdGhlIHdvcmtlcidzIHByb2Nlc3MgYW5kIERCIGNvbm5lY3Rpb24gcG9vbCwgc28gY29uY3VycmVuY3kgaXNcbiAgICAgKiBhYm91dCBvdmVybGFwcGluZyBJL08gd2FpdHMg4oCUIHVzZSBmb3JraW5nIGZvciBtZW1vcnkgaXNvbGF0aW9uIGFjcm9zc1xuICAgICAqIGxvbmctcnVubmluZyBqb2JzIGFuZCBmb3IgdXNpbmcgbW9yZSBjb3Jlcy5cbiAgICAgKiBAdHlwZSB7U2V0PFByb21pc2U8dm9pZD4+fVxuICAgICAqL1xuICAgIHRoaXMuaW5mbGlnaHRJbmxpbmVKb2JzID0gbmV3IFNldCgpXG4gICAgLyoqXG4gICAgICogSW4tZmxpZ2h0IHByb2Nlc3MgcnVubmVyIGV4aXQgcHJvbWlzZXMuIFRyYWNrZWQgc28gcHJvY2Vzcy1qb2IgaGFuZG9mZlxuICAgICAqIHN0YXlzIGJvdW5kZWQgd2hpbGUgcnVubmluZyBhbmQgc28gYSBncmFjZWZ1bCBgc3RvcCgpYCBjYW4gZHJhaW4gdGhlbS5cbiAgICAgKiBAdHlwZSB7U2V0PFByb21pc2U8dm9pZD4+fVxuICAgICAqL1xuICAgIHRoaXMuaW5mbGlnaHRQcm9jZXNzSm9icyA9IG5ldyBTZXQoKVxuICAgIC8qKlxuICAgICAqIExpdmUgcHJvY2VzcyBydW5uZXIgY2hpbGQgcHJvY2Vzc2VzLCBrZXB0IHNvIGEgZ3JhY2VmdWwgYHN0b3AoKWAgY2FuXG4gICAgICogdGVybWluYXRlIGFueSB0aGF0IG91dGxhc3QgdGhlIHNodXRkb3duIGRyYWluIGluc3RlYWQgb2Ygb3JwaGFuaW5nIHRoZW1cbiAgICAgKiBhY3Jvc3MgYSBkZXBsb3kgKHdoZXJlIHRoZXkgd291bGQga2VlcCBydW5uaW5nIGFnYWluc3QgZGVsZXRlZCByZWxlYXNlXG4gICAgICogY29kZSBhbmQgaG9sZGluZyBkYXRhYmFzZSBjb25uZWN0aW9ucykuXG4gICAgICogQHR5cGUge1NldDxpbXBvcnQoXCJub2RlOmNoaWxkX3Byb2Nlc3NcIikuQ2hpbGRQcm9jZXNzPn1cbiAgICAgKi9cbiAgICB0aGlzLmluZmxpZ2h0UHJvY2Vzc0NoaWxkcmVuID0gbmV3IFNldCgpXG4gICAgLyoqIEB0eXBlIHtTZXQ8UHJvbWlzZTx2b2lkPj59ICovXG4gICAgdGhpcy5pbmZsaWdodFBvb2xlZEpvYnMgPSBuZXcgU2V0KClcbiAgICAvKiogQHR5cGUge01hcDxzdHJpbmcsIEFycmF5PGltcG9ydChcIi4vdHlwZXMuanNcIikuQmFja2dyb3VuZEpvYlBheWxvYWQgJiB7aWQ6IHN0cmluZ30+Pn0gKi9cbiAgICB0aGlzLnBvb2xlZEpvYlF1ZXVlcyA9IG5ldyBNYXAoKVxuICAgIC8qKiBAdHlwZSB7TWFwPHN0cmluZywgUHJvbWlzZTx2b2lkPj59IC0gUGVyLWlkIG91dGVyIHF1ZXVlIHRyYWNrZXJzLiAqL1xuICAgIHRoaXMucG9vbGVkSm9iUXVldWVUcmFja2VycyA9IG5ldyBNYXAoKVxuICAgIC8qKiBAdHlwZSB7U2V0PGltcG9ydChcIm5vZGU6Y2hpbGRfcHJvY2Vzc1wiKS5DaGlsZFByb2Nlc3M+fSAqL1xuICAgIHRoaXMucG9vbGVkQ2hpbGRyZW4gPSBuZXcgU2V0KClcbiAgICAvKiogQHR5cGUge01hcDxpbXBvcnQoXCJub2RlOmNoaWxkX3Byb2Nlc3NcIikuQ2hpbGRQcm9jZXNzLCB7Y3JlYXRlZEF0TXM6IG51bWJlciwgam9ic1J1bjogbnVtYmVyLCBpbmZsaWdodDogTWFwPHN0cmluZywge3BheWxvYWQ6IGltcG9ydChcIi4vdHlwZXMuanNcIikuQmFja2dyb3VuZEpvYlBheWxvYWQgJiB7aWQ6IHN0cmluZ30sIHJlc29sdmU/OiAodmFsdWU6IHZvaWQpID0+IHZvaWQsIHBvb2xlZEpvYj86IFByb21pc2U8dm9pZD4sIHRpbWVvdXRUaW1lcj86IFJldHVyblR5cGU8dHlwZW9mIHNldFRpbWVvdXQ+IHwgbnVsbH0+LCBsYXN0RGlzcGF0Y2hTZXE6IG51bWJlciwgcmV0aXJpbmc6IGJvb2xlYW4sIHN0YXJ0ZWQ/OiBib29sZWFuLCBzZXR0bGluZz86IGJvb2xlYW4sIHRpbWVvdXRTaWdraWxsVGltZXI/OiBSZXR1cm5UeXBlPHR5cGVvZiBzZXRUaW1lb3V0PiB8IG51bGx9Pn0gKi9cbiAgICB0aGlzLnBvb2xlZENoaWxkU3RhdGVzID0gbmV3IE1hcCgpXG4gICAgLyoqIEB0eXBlIHtXZWFrU2V0PFByb21pc2U8dm9pZD4+fSAqL1xuICAgIHRoaXMuX3Bvb2xlZFN0YXJ0dXBGYWlsdXJlSm9icyA9IG5ldyBXZWFrU2V0KClcbiAgICAvLyBNb25vdG9uaWMgZGlzcGF0Y2ggY291bnRlciBmb3Igcm91bmQtcm9iaW4gY2hpbGQgc2VsZWN0aW9uOiBlYWNoIGRpc3BhdGNoIHN0YW1wc1xuICAgIC8vIHRoZSBjaG9zZW4gY2hpbGQsIGFuZCBzZWxlY3Rpb24gcHJlZmVycyB0aGUgY2hpbGQgZGlzcGF0Y2hlZCBsZWFzdCByZWNlbnRseS5cbiAgICB0aGlzLl9wb29sZWREaXNwYXRjaFNlcSA9IDBcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHN0YXJ0LlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyB3aGVuIGNvbm5lY3RlZC5cbiAgICovXG4gIGFzeW5jIHN0YXJ0KCkge1xuICAgIHRoaXMuc2hvdWxkU3RvcCA9IGZhbHNlXG4gICAgdGhpcy5pc1JldGlyaW5nID0gZmFsc2VcbiAgICB0aGlzLnN0b3BQcm9taXNlID0gdW5kZWZpbmVkXG4gICAgdGhpcy5fcmVzZXRTdG9wcGVkUHJvbWlzZSgpXG4gICAgdGhpcy5jb25maWd1cmF0aW9uID0gYXdhaXQgdGhpcy5jb25maWd1cmF0aW9uUHJvbWlzZVxuICAgIHRoaXMuY29uZmlndXJhdGlvbi5zZXRDdXJyZW50KClcbiAgICBjb25zdCByZXNvbHZlZENvbmZpZyA9IHRoaXMuY29uZmlndXJhdGlvbi5nZXRCYWNrZ3JvdW5kSm9ic0NvbmZpZygpXG4gICAgdGhpcy5nZW5lcmF0aW9uSWQgPSB0aGlzLmNvbmZpZ3VyYXRpb24ucmVzb2x2ZUJhY2tncm91bmRKb2JzR2VuZXJhdGlvbkNvbmZpZyh7XG4gICAgICBnZW5lcmF0aW9uSWQ6IHRoaXMuZXhwbGljaXRHZW5lcmF0aW9uSWQsXG4gICAgICBzb3VyY2VOYW1lOiBcIkJhY2tncm91bmRKb2JzV29ya2VyXCJcbiAgICB9KS5nZW5lcmF0aW9uSWRcbiAgICB0aGlzLndvcmtlcklkID0gdGhpcy5nZW5lcmF0aW9uSWRcbiAgICAgID8gY3JlYXRlR2VuZXJhdGlvbldvcmtlcklkKHtnZW5lcmF0aW9uSWQ6IHRoaXMuZ2VuZXJhdGlvbklkLCB3b3JrZXJJbnN0YW5jZUlkOiB0aGlzLndvcmtlckluc3RhbmNlSWR9KVxuICAgICAgOiB0aGlzLndvcmtlckluc3RhbmNlSWRcbiAgICB0aGlzLmhvc3QgfHw9IHJlc29sdmVkQ29uZmlnLmhvc3RcbiAgICBpZiAodHlwZW9mIHRoaXMucG9ydCAhPT0gXCJudW1iZXJcIikgdGhpcy5wb3J0ID0gcmVzb2x2ZWRDb25maWcucG9ydFxuICAgIGF3YWl0IHRoaXMuY29uZmlndXJhdGlvbi5pbml0aWFsaXplKHt0eXBlOiBcImJhY2tncm91bmQtam9icy13b3JrZXJcIn0pXG4gICAgYXdhaXQgdGhpcy5jb25maWd1cmF0aW9uLmNvbm5lY3RCZWFjb24oe3BlZXJUeXBlOiBcImJhY2tncm91bmQtam9icy13b3JrZXJcIn0pXG5cbiAgICAvLyBDb25zdHJ1Y3RvciBvdmVycmlkZXMgd2luOyBvdGhlcndpc2UgcGljayB1cCB0aGUgY29uZmlndXJlZCBjYXBzLlxuICAgIGlmICh0eXBlb2YgdGhpcy5tYXhDb25jdXJyZW50SW5saW5lSm9ic092ZXJyaWRlICE9PSBcIm51bWJlclwiKSB7XG4gICAgICBjb25zdCBjb25maWcgPSB0aGlzLmNvbmZpZ3VyYXRpb24uZ2V0QmFja2dyb3VuZEpvYnNDb25maWcoKVxuXG4gICAgICB0aGlzLm1heENvbmN1cnJlbnRJbmxpbmVKb2JzID0gY29uZmlnLm1heENvbmN1cnJlbnRJbmxpbmVKb2JzIHx8IHRoaXMubWF4Q29uY3VycmVudElubGluZUpvYnNcbiAgICB9XG4gICAgaWYgKHR5cGVvZiB0aGlzLm1heENvbmN1cnJlbnRGb3JrZWRKb2JzT3ZlcnJpZGUgIT09IFwibnVtYmVyXCIpIHtcbiAgICAgIGNvbnN0IGNvbmZpZyA9IHRoaXMuY29uZmlndXJhdGlvbi5nZXRCYWNrZ3JvdW5kSm9ic0NvbmZpZygpXG5cbiAgICAgIHRoaXMubWF4Q29uY3VycmVudEZvcmtlZEpvYnMgPSBjb25maWcubWF4Q29uY3VycmVudEZvcmtlZEpvYnMgfHwgdGhpcy5tYXhDb25jdXJyZW50Rm9ya2VkSm9ic1xuICAgIH1cbiAgICBjb25zdCBwb29sQ29uZmlnID0gdGhpcy5jb25maWd1cmF0aW9uLmdldEJhY2tncm91bmRKb2JzQ29uZmlnKClcbiAgICBpZiAodHlwZW9mIHRoaXMucG9vbGVkUnVubmVyQ291bnRPdmVycmlkZSAhPT0gXCJudW1iZXJcIikgdGhpcy5wb29sZWRSdW5uZXJDb3VudCA9IHBvb2xDb25maWcucG9vbGVkUnVubmVyQ291bnRcbiAgICBpZiAodHlwZW9mIHRoaXMucG9vbGVkUnVubmVyQ29uY3VycmVuY3lPdmVycmlkZSAhPT0gXCJudW1iZXJcIikgdGhpcy5wb29sZWRSdW5uZXJDb25jdXJyZW5jeSA9IHBvb2xDb25maWcucG9vbGVkUnVubmVyQ29uY3VycmVuY3lcbiAgICBpZiAodHlwZW9mIHRoaXMucG9vbGVkUnVubmVyTWF4Sm9ic092ZXJyaWRlICE9PSBcIm51bWJlclwiKSB0aGlzLnBvb2xlZFJ1bm5lck1heEpvYnMgPSBwb29sQ29uZmlnLnBvb2xlZFJ1bm5lck1heEpvYnNcbiAgICBpZiAodHlwZW9mIHRoaXMucG9vbGVkUnVubmVyTWF4UnNzQnl0ZXNPdmVycmlkZSAhPT0gXCJudW1iZXJcIikgdGhpcy5wb29sZWRSdW5uZXJNYXhSc3NCeXRlcyA9IHBvb2xDb25maWcucG9vbGVkUnVubmVyTWF4UnNzQnl0ZXNcbiAgICBpZiAodHlwZW9mIHRoaXMucG9vbGVkUnVubmVyTWF4TGlmZXRpbWVNc092ZXJyaWRlICE9PSBcIm51bWJlclwiKSB0aGlzLnBvb2xlZFJ1bm5lck1heExpZmV0aW1lTXMgPSBwb29sQ29uZmlnLnBvb2xlZFJ1bm5lck1heExpZmV0aW1lTXNcblxuICAgIHRoaXMuc3RhdHVzUmVwb3J0ZXIgPSBuZXcgQmFja2dyb3VuZEpvYnNTdGF0dXNSZXBvcnRlcih7XG4gICAgICBjb25maWd1cmF0aW9uOiB0aGlzLmNvbmZpZ3VyYXRpb24sXG4gICAgICBob3N0OiB0aGlzLmhvc3QsXG4gICAgICBwb3J0OiB0aGlzLnBvcnQsXG4gICAgICBnZW5lcmF0aW9uSGFuZHNoYWtlVGltZW91dE1zOiB0aGlzLmdlbmVyYXRpb25IYW5kc2hha2VUaW1lb3V0TXMsXG4gICAgICBnZW5lcmF0aW9uSWQ6IHRoaXMuZ2VuZXJhdGlvbklkXG4gICAgfSlcbiAgICB0cnkge1xuICAgICAgYXdhaXQgdGhpcy5fY29ubmVjdCh7YWxsb3dSZWNvbm5lY3Q6IGZhbHNlfSlcbiAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgbGV0IGNsZWFudXBFcnJvclxuXG4gICAgICB0cnkge1xuICAgICAgICBhd2FpdCB0aGlzLnN0b3AoKVxuICAgICAgfSBjYXRjaCAoY2F1Z2h0Q2xlYW51cEVycm9yKSB7XG4gICAgICAgIGNsZWFudXBFcnJvciA9IGNhdWdodENsZWFudXBFcnJvclxuICAgICAgfVxuXG4gICAgICBpZiAoY2xlYW51cEVycm9yKSB7XG4gICAgICAgIHRocm93IG5ldyBBZ2dyZWdhdGVFcnJvcihcbiAgICAgICAgICBbZXJyb3IsIGNsZWFudXBFcnJvcl0sXG4gICAgICAgICAgXCJCYWNrZ3JvdW5kIGpvYnMgd29ya2VyIHN0YXJ0dXAgYW5kIGNsZWFudXAgZmFpbGVkXCIsXG4gICAgICAgICAge2NhdXNlOiBlcnJvcn1cbiAgICAgICAgKVxuICAgICAgfVxuXG4gICAgICB0aHJvdyBlcnJvclxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBHcmFjZWZ1bGx5IHN0b3BzIHRoZSB3b3JrZXI6IGFubm91bmNlcyBkcmFpbmluZyB0byB0aGUgbWFpbiBwcm9jZXNzIHNvXG4gICAqIG5vIG5ldyBqb2JzIGFyZSBkaXNwYXRjaGVkLCB3YWl0cyBmb3IgaW4tZmxpZ2h0IGlubGluZSBqb2JzIGFuZCBwcm9jZXNzXG4gICAqIHJ1bm5lcnMgdG8gZmluaXNoIChzbyB0aGVpciByZXN1bHRzIGNhbiBiZSByZXBvcnRlZCksIHRoZW4gY2xvc2VzIHRoZVxuICAgKiBzb2NrZXQgYW5kIGRpc2Nvbm5lY3RzIGZyb20gdGhlIGJlYWNvbi5cbiAgICpcbiAgICogUHJvY2VzcyBydW5uZXJzIGFyZSBjaGlsZCBwcm9jZXNzZXMuIFdoZW4gYSBgdGltZW91dE1zYCBpcyBnaXZlbiAoZS5nLiBhXG4gICAqIGRlcGxveSBkcmFpbmluZyB0aGUgb2xkIHJlbGVhc2UpIGFueSBydW5uZXIgc3RpbGwgYWxpdmUgYWZ0ZXIgdGhlIGRyYWluXG4gICAqIHdpbmRvdyBpcyB0ZXJtaW5hdGVkIChTSUdURVJNLCB0aGVuIFNJR0tJTEwpIHJhdGhlciB0aGFuIGxlZnQgdG8gb3JwaGFuXG4gICAqIGFjcm9zcyB0aGUgZGVwbG95LiBXaXRoIG5vIGB0aW1lb3V0TXNgIHRoZSBkcmFpbiB3YWl0cyBmb3IgcnVubmVycyB0b1xuICAgKiBmaW5pc2ggb24gdGhlaXIgb3duLlxuICAgKiBAcGFyYW0ge29iamVjdH0gW2FyZ3NdIC0gT3B0aW9ucy5cbiAgICogQHBhcmFtIHtudW1iZXJ9IFthcmdzLnRpbWVvdXRNc10gLSBNYXggd2FpdCBmb3IgaW4tZmxpZ2h0IGpvYnMgKHBlciBwaGFzZSkgaW4gbXMuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIHdoZW4gc3RvcHBlZC5cbiAgICovXG4gIHN0b3Aoe3RpbWVvdXRNc30gPSB7fSkge1xuICAgIGNvbnN0IHN0b3BQcm9taXNlID0gdGhpcy5zdG9wUHJvbWlzZSB8fCB0aGlzLl9zdG9wKHt0aW1lb3V0TXN9KVxuXG4gICAgaWYgKCF0aGlzLnN0b3BQcm9taXNlKSB7XG4gICAgICB0aGlzLnN0b3BQcm9taXNlID0gc3RvcFByb21pc2VcbiAgICAgIHZvaWQgc3RvcFByb21pc2UudGhlbih0aGlzLl9yZXNvbHZlU3RvcHBlZCwgKGVycm9yKSA9PiB7XG4gICAgICAgIHRoaXMuX3JlamVjdFN0b3BwZWQoZXJyb3IgaW5zdGFuY2VvZiBFcnJvciA/IGVycm9yIDogbmV3IEVycm9yKFN0cmluZyhlcnJvcikpKVxuICAgICAgfSlcbiAgICB9XG5cbiAgICByZXR1cm4gc3RvcFByb21pc2VcbiAgfVxuXG4gIC8qKlxuICAgKiBXYWl0cyBmb3IgYXV0b21hdGljIG9yIHJlcXVlc3RlZCBzdG9wLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyB3aGVuIHRoaXMgd29ya2VyIGhhcyBmdWxseSBzdG9wcGVkLlxuICAgKi9cbiAgd2FpdFVudGlsU3RvcHBlZCgpIHsgcmV0dXJuIHRoaXMuX3N0b3BwZWRQcm9taXNlIH1cblxuICAvKiogUmVzZXRzIHRoZSBzdG9wIG9ic2VydmF0aW9uIHByb21pc2UgZm9yIGEgbmV3IHdvcmtlciBzdGFydC4gKi9cbiAgX3Jlc2V0U3RvcHBlZFByb21pc2UoKSB7XG4gICAgdGhpcy5fc3RvcHBlZFByb21pc2UgPSBuZXcgUHJvbWlzZSgocmVzb2x2ZSwgcmVqZWN0KSA9PiB7XG4gICAgICB0aGlzLl9yZXNvbHZlU3RvcHBlZCA9IHJlc29sdmVcbiAgICAgIHRoaXMuX3JlamVjdFN0b3BwZWQgPSByZWplY3RcbiAgICB9KVxuICAgIHZvaWQgdGhpcy5fc3RvcHBlZFByb21pc2UuY2F0Y2goKCkgPT4ge30pXG4gIH1cblxuICAvKipcbiAgICogUnVucyB0aGUgd29ya2VyIHNodXRkb3duIGxpZmVjeWNsZSBvbmNlLlxuICAgKiBAcGFyYW0ge29iamVjdH0gW2FyZ3NdIC0gT3B0aW9ucy5cbiAgICogQHBhcmFtIHtudW1iZXJ9IFthcmdzLnRpbWVvdXRNc10gLSBNYXggd2FpdCBmb3IgaW4tZmxpZ2h0IGpvYnMgKHBlciBwaGFzZSkgaW4gbXMuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIHdoZW4gc3RvcHBlZC5cbiAgICovXG4gIGFzeW5jIF9zdG9wKHt0aW1lb3V0TXN9ID0ge30pIHtcbiAgICB0aGlzLnNob3VsZFN0b3AgPSB0cnVlXG4gICAgdGhpcy5pc1JldGlyaW5nID0gdHJ1ZVxuICAgIHRoaXMuX3N0b3BIZWFydGJlYXQoKVxuICAgIGlmICh0aGlzLl9yZWNvbm5lY3RUaW1lcikge1xuICAgICAgY2xlYXJUaW1lb3V0KHRoaXMuX3JlY29ubmVjdFRpbWVyKVxuICAgICAgdGhpcy5fcmVjb25uZWN0VGltZXIgPSB1bmRlZmluZWRcbiAgICB9XG5cbiAgICBhd2FpdCBzaHV0ZG93bkxpZmVjeWNsZSh7XG4gICAgICBvblN0b3BwZWQ6IHRoaXMub25TdG9wcGVkLFxuICAgICAgc2h1dGRvd246IGFzeW5jICgpID0+IHtcbiAgICAgICAgLy8gQW5ub3VuY2UgZHJhaW4gc28gbWFpbiBzdG9wcyBkaXNwYXRjaGluZyBidXQga2VlcHMgdGhlIGNvbm5lY3Rpb25cbiAgICAgICAgLy8gb3BlbiB1bnRpbCB3ZSBjbG9zZSBpdCBvdXJzZWx2ZXMgYmVsb3cuXG4gICAgICAgIGlmICh0aGlzLmpzb25Tb2NrZXQpIHtcbiAgICAgICAgICB0cnkge1xuICAgICAgICAgICAgdGhpcy5qc29uU29ja2V0LnNlbmQoe3R5cGU6IFwiZHJhaW5pbmdcIn0pXG4gICAgICAgICAgfSBjYXRjaCB7XG4gICAgICAgICAgICAvLyBTb2NrZXQgbWF5IGFscmVhZHkgYmUgY2xvc2luZzsgbm90aGluZyB0byBkby5cbiAgICAgICAgICB9XG4gICAgICAgIH1cblxuICAgICAgICBhd2FpdCB0aGlzLl9kcmFpbkluZmxpZ2h0KHRoaXMuaW5mbGlnaHRJbmxpbmVKb2JzLCB0aW1lb3V0TXMpXG4gICAgICAgIGF3YWl0IHRoaXMuX2RyYWluSW5mbGlnaHQodGhpcy5pbmZsaWdodFBvb2xlZEpvYnMsIHRpbWVvdXRNcylcbiAgICAgICAgYXdhaXQgdGhpcy5fZHJhaW5JbmZsaWdodCh0aGlzLmluZmxpZ2h0UHJvY2Vzc0pvYnMsIHRpbWVvdXRNcylcbiAgICAgICAgYXdhaXQgdGhpcy5fdGVybWluYXRlUHJvY2Vzc0NoaWxkcmVuKClcbiAgICAgICAgLy8gR2l2ZSBpbi1mbGlnaHQgcmVzdWx0IHJlcG9ydHMgKG5vdyBkZWNvdXBsZWQgZnJvbSBqb2Igc2xvdHMpIGEgYm91bmRlZFxuICAgICAgICAvLyBjaGFuY2UgdG8gbGFuZCBiZWZvcmUgdGhlIHNvY2tldCBjbG9zZXMuXG4gICAgICAgIGF3YWl0IHRoaXMuX2RyYWluSW5mbGlnaHQodGhpcy5pbmZsaWdodFJlcG9ydHMsIHRpbWVvdXRNcylcblxuICAgICAgICBpZiAodGhpcy5qc29uU29ja2V0KSB0aGlzLmpzb25Tb2NrZXQuY2xvc2UoKVxuICAgICAgICBpZiAoIXRoaXMuY29uZmlndXJhdGlvbikgcmV0dXJuXG5cbiAgICAgICAgYXdhaXQgdGhpcy5fY2xvc2VDb25maWd1cmF0aW9uKClcbiAgICAgIH1cbiAgICB9KVxuICB9XG5cbiAgLyoqIEJlZ2lucyBnZW5lcmF0aW9uIHJldGlyZW1lbnQgd2l0aG91dCByZXZva2luZyBsaXZlbmVzcyBkdXJpbmcgdGhlIGRyYWluLiAqL1xuICBfYmVnaW5HZW5lcmF0aW9uUmV0aXJlbWVudCgpIHtcbiAgICBpZiAodGhpcy5zdG9wUHJvbWlzZSkgcmV0dXJuXG5cbiAgICB0aGlzLmlzUmV0aXJpbmcgPSB0cnVlXG4gICAgY29uc3Qgc3RvcFByb21pc2UgPSB0aGlzLl9zdG9wQWZ0ZXJHZW5lcmF0aW9uRHJhaW4oKVxuICAgIHRoaXMuc3RvcFByb21pc2UgPSBzdG9wUHJvbWlzZVxuICAgIHZvaWQgc3RvcFByb21pc2UudGhlbih0aGlzLl9yZXNvbHZlU3RvcHBlZCwgKGVycm9yKSA9PiB7XG4gICAgICBjb25zdCBub3JtYWxpemVkRXJyb3IgPSBlcnJvciBpbnN0YW5jZW9mIEVycm9yID8gZXJyb3IgOiBuZXcgRXJyb3IoU3RyaW5nKGVycm9yKSlcblxuICAgICAgdGhpcy5fcmVqZWN0U3RvcHBlZChub3JtYWxpemVkRXJyb3IpXG4gICAgICB0aGlzLl9yZXBvcnRMaWZlY3ljbGVFcnJvcihub3JtYWxpemVkRXJyb3IpXG4gICAgfSlcbiAgfVxuXG4gIC8qKlxuICAgKiBEcmFpbnMgYWNjZXB0ZWQgZ2VuZXJhdGlvbiB3b3JrIHdoaWxlIHJldGFpbmluZyB0aGUgZXhhY3QgY29ubmVjdGlvbiBhbmRcbiAgICogaGVhcnRiZWF0LCB0aGVuIHBlcmZvcm1zIHRoZSBmaW5hbCB0ZXJtaW5hdGluZyBzdG9wLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyBhZnRlciB0aGUgd29ya2VyIGhhcyBmdWxseSBjbG9zZWQuXG4gICAqL1xuICBhc3luYyBfc3RvcEFmdGVyR2VuZXJhdGlvbkRyYWluKCkge1xuICAgIGlmICh0aGlzLmpzb25Tb2NrZXQpIHtcbiAgICAgIHRyeSB7XG4gICAgICAgIHRoaXMuanNvblNvY2tldC5zZW5kKHt0eXBlOiBcImRyYWluaW5nXCJ9KVxuICAgICAgfSBjYXRjaCB7XG4gICAgICAgIC8vIFRoZSBjbG9zZSBoYW5kbGVyIG93bnMgZXhhY3Qgc2FtZS1nZW5lcmF0aW9uIHJlY29ubmVjdC5cbiAgICAgIH1cbiAgICB9XG5cbiAgICBhd2FpdCB0aGlzLl9kcmFpbkluZmxpZ2h0KHRoaXMuaW5mbGlnaHRJbmxpbmVKb2JzKVxuICAgIGF3YWl0IHRoaXMuX2RyYWluSW5mbGlnaHQodGhpcy5pbmZsaWdodFBvb2xlZEpvYnMpXG4gICAgYXdhaXQgdGhpcy5fZHJhaW5JbmZsaWdodCh0aGlzLmluZmxpZ2h0UHJvY2Vzc0pvYnMpXG4gICAgYXdhaXQgdGhpcy5fZHJhaW5JbmZsaWdodCh0aGlzLmluZmxpZ2h0UmVwb3J0cylcblxuICAgIHRoaXMuc2hvdWxkU3RvcCA9IHRydWVcbiAgICB0aGlzLl9zdG9wSGVhcnRiZWF0KClcbiAgICBpZiAodGhpcy5fcmVjb25uZWN0VGltZXIpIHtcbiAgICAgIGNsZWFyVGltZW91dCh0aGlzLl9yZWNvbm5lY3RUaW1lcilcbiAgICAgIHRoaXMuX3JlY29ubmVjdFRpbWVyID0gdW5kZWZpbmVkXG4gICAgfVxuICAgIGF3YWl0IHRoaXMuX3Rlcm1pbmF0ZVByb2Nlc3NDaGlsZHJlbigpXG5cbiAgICBhd2FpdCBzaHV0ZG93bkxpZmVjeWNsZSh7XG4gICAgICBvblN0b3BwZWQ6IHRoaXMub25TdG9wcGVkLFxuICAgICAgc2h1dGRvd246IGFzeW5jICgpID0+IHtcbiAgICAgICAgaWYgKHRoaXMuanNvblNvY2tldCkgdGhpcy5qc29uU29ja2V0LmNsb3NlKClcbiAgICAgICAgaWYgKCF0aGlzLmNvbmZpZ3VyYXRpb24pIHJldHVyblxuXG4gICAgICAgIGF3YWl0IHRoaXMuX2Nsb3NlQ29uZmlndXJhdGlvbigpXG4gICAgICB9XG4gICAgfSlcbiAgfVxuXG4gIC8qKlxuICAgKiBDbG9zZXMgYXBwbGljYXRpb24gcmVzb3VyY2VzIGJlZm9yZSBmcmFtZXdvcmsgcmVzb3VyY2VzIHdoZW4gdGhpcyB3b3JrZXIgb3ducyB0aGVtLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyBhZnRlciBldmVyeSBvd25lZCBjbG9zZSBzdWNjZWVkcy5cbiAgICovXG4gIGFzeW5jIF9jbG9zZUNvbmZpZ3VyYXRpb24oKSB7XG4gICAgY29uc3QgY29uZmlndXJhdGlvbiA9IHRoaXMuY29uZmlndXJhdGlvblxuXG4gICAgaWYgKCFjb25maWd1cmF0aW9uKSByZXR1cm5cblxuICAgIGF3YWl0IHJ1blNodXRkb3duU3RlcHMoe1xuICAgICAgbWVzc2FnZTogXCJCYWNrZ3JvdW5kIGpvYnMgd29ya2VyIGFwcGxpY2F0aW9uIGFuZCBmcmFtZXdvcmsgc2h1dGRvd24gZmFpbGVkXCIsXG4gICAgICBzdGVwczogW1xuICAgICAgICAuLi4odGhpcy5jbG9zZURhdGFiYXNlQ29ubmVjdGlvbnNPblN0b3BcbiAgICAgICAgICA/IFthc3luYyAoKSA9PiBhd2FpdCBjb25maWd1cmF0aW9uLnNodXRkb3duKCldXG4gICAgICAgICAgOiBbXSksXG4gICAgICAgIGFzeW5jICgpID0+IGF3YWl0IGNvbmZpZ3VyYXRpb24uZGlzY29ubmVjdEJlYWNvbigpLFxuICAgICAgICAuLi4odGhpcy5jbG9zZURhdGFiYXNlQ29ubmVjdGlvbnNPblN0b3BcbiAgICAgICAgICA/IFthc3luYyAoKSA9PiBhd2FpdCBjb25maWd1cmF0aW9uLmNsb3NlRGF0YWJhc2VDb25uZWN0aW9ucygpXVxuICAgICAgICAgIDogW10pXG4gICAgICBdXG4gICAgfSlcbiAgfVxuXG4gIC8qKlxuICAgKiBXYWl0cyBmb3IgYSBzZXQgb2YgaW4tZmxpZ2h0IGpvYiBwcm9taXNlcyB0byBzZXR0bGUsIG9wdGlvbmFsbHkgYm91bmRlZCBieVxuICAgKiBgdGltZW91dE1zYC5cbiAgICogQHBhcmFtIHtTZXQ8UHJvbWlzZTx2b2lkPj59IGluZmxpZ2h0IC0gSW4tZmxpZ2h0IGpvYiBwcm9taXNlcy5cbiAgICogQHBhcmFtIHtudW1iZXJ9IFt0aW1lb3V0TXNdIC0gTWF4IHdhaXQgaW4gbXM7IHVuYm91bmRlZCB3aGVuIG9taXR0ZWQuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIHdoZW4gc2V0dGxlZCBvciB0aGUgdGltZW91dCBlbGFwc2VzLlxuICAgKi9cbiAgYXN5bmMgX2RyYWluSW5mbGlnaHQoaW5mbGlnaHQsIHRpbWVvdXRNcykge1xuICAgIGlmIChpbmZsaWdodC5zaXplID09PSAwKSByZXR1cm5cblxuICAgIGNvbnN0IGRyYWluID0gUHJvbWlzZS5hbGxTZXR0bGVkKFsuLi5pbmZsaWdodF0pXG5cbiAgICBpZiAodHlwZW9mIHRpbWVvdXRNcyA9PT0gXCJudW1iZXJcIiAmJiB0aW1lb3V0TXMgPj0gMCkge1xuICAgICAgbGV0IHRpbWVyXG4gICAgICBjb25zdCB0aW1lb3V0ID0gbmV3IFByb21pc2UoKHJlc29sdmUpID0+IHsgdGltZXIgPSBzZXRUaW1lb3V0KHJlc29sdmUsIHRpbWVvdXRNcykgfSlcblxuICAgICAgYXdhaXQgUHJvbWlzZS5yYWNlKFtkcmFpbiwgdGltZW91dF0pXG4gICAgICBjbGVhclRpbWVvdXQodGltZXIpXG4gICAgfSBlbHNlIHtcbiAgICAgIGF3YWl0IGRyYWluXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIFRlcm1pbmF0ZXMgYW55IHByb2Nlc3MgcnVubmVyIGNoaWxkcmVuIHN0aWxsIGFsaXZlIGFmdGVyIHRoZSBkcmFpbiB3aW5kb3cgc29cbiAgICogdGhleSBkb24ndCBvdXRsaXZlIHRoZSB3b3JrZXIgYXMgb3JwaGFucy4gU0lHVEVSTSBsZXRzIHRoZSBydW5uZXIgY2xvc2UgaXRzXG4gICAqIGNvbm5lY3Rpb25zIGNsZWFubHk7IHN1cnZpdm9ycyBhcmUgU0lHS0lMTGVkIGFmdGVyIGEgc2hvcnQgZ3JhY2UuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIG9uY2Ugc3Vydml2b3JzIGhhdmUgYmVlbiBzaWduYWxsZWQuXG4gICAqL1xuICBhc3luYyBfdGVybWluYXRlUHJvY2Vzc0NoaWxkcmVuKCkge1xuICAgIGlmICh0aGlzLmluZmxpZ2h0UHJvY2Vzc0NoaWxkcmVuLnNpemUgPT09IDApIHJldHVyblxuXG4gICAgZm9yIChjb25zdCBjaGlsZCBvZiB0aGlzLmluZmxpZ2h0UHJvY2Vzc0NoaWxkcmVuKSB7XG4gICAgICB0cnkge1xuICAgICAgICBjaGlsZC5raWxsKFwiU0lHVEVSTVwiKVxuICAgICAgfSBjYXRjaCB7XG4gICAgICAgIC8vIENoaWxkIGFscmVhZHkgZXhpdGVkOyBub3RoaW5nIHRvIGRvLlxuICAgICAgfVxuICAgIH1cblxuICAgIGF3YWl0IG5ldyBQcm9taXNlKChyZXNvbHZlKSA9PiBzZXRUaW1lb3V0KHJlc29sdmUsIHRoaXMuZm9ya2VkQ2hpbGRTaWdraWxsR3JhY2VNcykpXG5cbiAgICBmb3IgKGNvbnN0IGNoaWxkIG9mIHRoaXMuaW5mbGlnaHRQcm9jZXNzQ2hpbGRyZW4pIHtcbiAgICAgIHRyeSB7XG4gICAgICAgIGNoaWxkLmtpbGwoXCJTSUdLSUxMXCIpXG4gICAgICB9IGNhdGNoIHtcbiAgICAgICAgLy8gQ2hpbGQgYWxyZWFkeSBleGl0ZWQ7IG5vdGhpbmcgdG8gZG8uXG4gICAgICB9XG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIENvbm5lY3RzIHRvIHRoZSB3b3JrZXIncyByZXNvbHZlZCBlbmRwb2ludCBhbmQgY29tcGxldGVzIGl0cyBoZWxsbyBmZW5jZS5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBSZWNvbm5lY3QgcG9saWN5LlxuICAgKiBAcGFyYW0ge2Jvb2xlYW59IGFyZ3MuYWxsb3dSZWNvbm5lY3QgLSBXaGV0aGVyIGEgZmFpbGVkIGF0dGVtcHQgbWF5IHNjaGVkdWxlIGFub3RoZXIgY29ubmVjdGlvbi5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgYWZ0ZXIgZ2VuZXJhdGlvbiBhY2tub3dsZWRnZW1lbnQuXG4gICAqL1xuICBhc3luYyBfY29ubmVjdCh7YWxsb3dSZWNvbm5lY3R9KSB7XG4gICAgY29uc3QgY29uZmlndXJhdGlvbiA9IHRoaXMuY29uZmlndXJhdGlvblxuICAgIGlmICghY29uZmlndXJhdGlvbikgdGhyb3cgbmV3IEVycm9yKFwiQmFja2dyb3VuZCBqb2JzIHdvcmtlciBjb25maWd1cmF0aW9uIG5vdCBpbml0aWFsaXplZFwiKVxuXG4gICAgY29uc3QgY29uZmlnID0gY29uZmlndXJhdGlvbi5nZXRCYWNrZ3JvdW5kSm9ic0NvbmZpZygpXG4gICAgaWYgKHRoaXMuZ2VuZXJhdGlvbklkKSB0aGlzLl9nZW5lcmF0aW9uQWNjZXB0ZWQgPSBmYWxzZVxuICAgIGNvbnN0IGhvc3QgPSB0aGlzLmhvc3QgfHwgY29uZmlnLmhvc3RcbiAgICBjb25zdCBwb3J0ID0gdHlwZW9mIHRoaXMucG9ydCA9PT0gXCJudW1iZXJcIiA/IHRoaXMucG9ydCA6IGNvbmZpZy5wb3J0XG4gICAgY29uc3Qgc29ja2V0ID0gbmV0LmNyZWF0ZUNvbm5lY3Rpb24oe2hvc3QsIHBvcnR9KVxuICAgIHNvY2tldC5zZXRLZWVwQWxpdmUodHJ1ZSwgU09DS0VUX0tFRVBBTElWRV9NUylcbiAgICBjb25zdCBqc29uU29ja2V0ID0gbmV3IEpzb25Tb2NrZXQoc29ja2V0KVxuICAgIHRoaXMuanNvblNvY2tldCA9IGpzb25Tb2NrZXRcbiAgICAvKipcbiAgICAgKiBSZXNvbHZlcyB0aGUgZ2VuZXJhdGlvbiBoYW5kc2hha2UuXG4gICAgICogQHR5cGUgeygpID0+IHZvaWR9XG4gICAgICovXG4gICAgbGV0IHJlc29sdmVIYW5kc2hha2UgPSAoKSA9PiB7fVxuICAgIC8qKlxuICAgICAqIFJlamVjdHMgdGhlIGdlbmVyYXRpb24gaGFuZHNoYWtlLlxuICAgICAqIEB0eXBlIHsoZXJyb3I6IEVycm9yKSA9PiB2b2lkfVxuICAgICAqL1xuICAgIGxldCByZWplY3RIYW5kc2hha2UgPSAoKSA9PiB7fVxuICAgIGxldCBjb25uZWN0aW9uQWNjZXB0ZWQgPSBmYWxzZVxuICAgIC8qKiBAdHlwZSB7UmV0dXJuVHlwZTx0eXBlb2Ygc2V0VGltZW91dD4gfCB1bmRlZmluZWR9ICovXG4gICAgbGV0IGhhbmRzaGFrZVRpbWVyXG4gICAgY29uc3QgaGFuZHNoYWtlID0gbmV3IFByb21pc2UoKC8qKiBAdHlwZSB7KHZhbHVlOiB2b2lkKSA9PiB2b2lkfSAqLyByZXNvbHZlLCByZWplY3QpID0+IHtcbiAgICAgIHJlc29sdmVIYW5kc2hha2UgPSByZXNvbHZlXG4gICAgICByZWplY3RIYW5kc2hha2UgPSByZWplY3RcbiAgICB9KVxuXG4gICAgLyoqXG4gICAgICogSGFuZGxlcyBhIGJhY2tncm91bmQgam9iIHNvY2tldCBtZXNzYWdlLlxuICAgICAqIEBwYXJhbSB7aW1wb3J0KFwiLi90eXBlcy5qc1wiKS5CYWNrZ3JvdW5kSm9iU29ja2V0TWVzc2FnZX0gbWVzc2FnZSAtIFNvY2tldCBtZXNzYWdlLlxuICAgICAqL1xuICAgIGpzb25Tb2NrZXQub24oXCJtZXNzYWdlXCIsIGFzeW5jIChtZXNzYWdlKSA9PiB7XG4gICAgICBpZiAobWVzc2FnZT8udHlwZSA9PT0gXCJnZW5lcmF0aW9uLWFjY2VwdGVkXCIpIHtcbiAgICAgICAgaWYgKCF0aGlzLmdlbmVyYXRpb25JZCB8fCBtZXNzYWdlLmdlbmVyYXRpb25JZCAhPT0gdGhpcy5nZW5lcmF0aW9uSWQpIHtcbiAgICAgICAgICByZWplY3RIYW5kc2hha2UobmV3IEVycm9yKFwiQmFja2dyb3VuZCBqb2JzIG1haW4gYWNrbm93bGVkZ2VkIGEgZGlmZmVyZW50IGdlbmVyYXRpb25cIikpXG4gICAgICAgICAganNvblNvY2tldC5kZXN0cm95KClcbiAgICAgICAgICByZXR1cm5cbiAgICAgICAgfVxuXG4gICAgICAgIHRoaXMuX2dlbmVyYXRpb25BY2NlcHRlZCA9IHRydWVcbiAgICAgICAgY29ubmVjdGlvbkFjY2VwdGVkID0gdHJ1ZVxuICAgICAgICBpZiAoaGFuZHNoYWtlVGltZXIpIHtcbiAgICAgICAgICBjbGVhclRpbWVvdXQoaGFuZHNoYWtlVGltZXIpXG4gICAgICAgICAgaGFuZHNoYWtlVGltZXIgPSB1bmRlZmluZWRcbiAgICAgICAgfVxuICAgICAgICBpZiAobWVzc2FnZS5saWZlY3ljbGVTdGF0ZSA9PT0gXCJyZXRpcmluZ1wiIHx8IG1lc3NhZ2UubGlmZWN5Y2xlU3RhdGUgPT09IFwicmV0aXJlZFwiKSB0aGlzLmlzUmV0aXJpbmcgPSB0cnVlXG4gICAgICAgIHRoaXMub25HZW5lcmF0aW9uQWNjZXB0ZWQ/LigpXG4gICAgICAgIHRoaXMuX3NlbmRSZWFkeUlmUnVubmluZygpXG4gICAgICAgIHRoaXMuX3N0YXJ0SGVhcnRiZWF0KClcbiAgICAgICAgcmVzb2x2ZUhhbmRzaGFrZSgpXG4gICAgICAgIHJldHVyblxuICAgICAgfVxuXG4gICAgICBpZiAobWVzc2FnZT8udHlwZSA9PT0gXCJnZW5lcmF0aW9uLXJlamVjdGVkXCIpIHtcbiAgICAgICAgdGhpcy5zaG91bGRTdG9wID0gdHJ1ZVxuICAgICAgICBpZiAoaGFuZHNoYWtlVGltZXIpIGNsZWFyVGltZW91dChoYW5kc2hha2VUaW1lcilcbiAgICAgICAgcmVqZWN0SGFuZHNoYWtlKG5ldyBFcnJvcihgQmFja2dyb3VuZCBqb2JzIGdlbmVyYXRpb24gcmVqZWN0ZWQ6ICR7bWVzc2FnZS5yZWFzb259YCkpXG4gICAgICAgIGpzb25Tb2NrZXQuZGVzdHJveSgpXG4gICAgICAgIHJldHVyblxuICAgICAgfVxuXG4gICAgICBpZiAobWVzc2FnZT8udHlwZSA9PT0gXCJyZXRpcmVcIikge1xuICAgICAgICBpZiAodGhpcy5nZW5lcmF0aW9uSWQgJiYgbWVzc2FnZS5nZW5lcmF0aW9uSWQgPT09IHRoaXMuZ2VuZXJhdGlvbklkKSB7XG4gICAgICAgICAgdGhpcy5vblJldGlyZU1lc3NhZ2U/LigpXG4gICAgICAgICAgdGhpcy5fYmVnaW5HZW5lcmF0aW9uUmV0aXJlbWVudCgpXG4gICAgICAgIH1cbiAgICAgICAgcmV0dXJuXG4gICAgICB9XG5cbiAgICAgIGlmIChtZXNzYWdlPy50eXBlID09PSBcImpvYlwiKSB7XG4gICAgICAgIGF3YWl0IHRoaXMuX2hhbmRsZUpvYihtZXNzYWdlLnBheWxvYWQpXG4gICAgICB9XG4gICAgfSlcblxuICAgIGpzb25Tb2NrZXQub24oXCJlcnJvclwiLCAoZXJyb3IpID0+IHtcbiAgICAgIGNvbnNvbGUuZXJyb3IoXCJCYWNrZ3JvdW5kIGpvYnMgd29ya2VyIHNvY2tldCBlcnJvcjpcIiwgZXJyb3IpXG4gICAgICBpZiAodGhpcy5nZW5lcmF0aW9uSWQgJiYgIXRoaXMuX2dlbmVyYXRpb25BY2NlcHRlZCkgcmVqZWN0SGFuZHNoYWtlKGVycm9yKVxuICAgIH0pXG5cbiAgICBqc29uU29ja2V0Lm9uKFwiY2xvc2VcIiwgKCkgPT4ge1xuICAgICAgaWYgKGhhbmRzaGFrZVRpbWVyKSBjbGVhclRpbWVvdXQoaGFuZHNoYWtlVGltZXIpXG4gICAgICB0aGlzLl9zdG9wSGVhcnRiZWF0KClcbiAgICAgIGlmICh0aGlzLmpzb25Tb2NrZXQgPT09IGpzb25Tb2NrZXQpIHRoaXMuanNvblNvY2tldCA9IHVuZGVmaW5lZFxuICAgICAgaWYgKHRoaXMuZ2VuZXJhdGlvbklkICYmICF0aGlzLl9nZW5lcmF0aW9uQWNjZXB0ZWQpIHtcbiAgICAgICAgcmVqZWN0SGFuZHNoYWtlKG5ldyBFcnJvcihcIkJhY2tncm91bmQgam9icyBzb2NrZXQgY2xvc2VkIGJlZm9yZSBnZW5lcmF0aW9uIGFja25vd2xlZGdlbWVudFwiKSlcbiAgICAgIH1cbiAgICAgIGlmICh0aGlzLnNob3VsZFN0b3ApIHJldHVyblxuICAgICAgaWYgKGNvbm5lY3Rpb25BY2NlcHRlZCB8fCBhbGxvd1JlY29ubmVjdCB8fCAhdGhpcy5nZW5lcmF0aW9uSWQpIHRoaXMuX3NjaGVkdWxlUmVjb25uZWN0KClcbiAgICB9KVxuXG4gICAgaWYgKHRoaXMuZ2VuZXJhdGlvbklkKSB7XG4gICAgICBoYW5kc2hha2VUaW1lciA9IHNldFRpbWVvdXQoKCkgPT4ge1xuICAgICAgICBjb25zdCBlcnJvciA9IG5ldyBCYWNrZ3JvdW5kSm9ic0dlbmVyYXRpb25IYW5kc2hha2VUaW1lb3V0RXJyb3Ioe1xuICAgICAgICAgIGVuZHBvaW50OiBgJHtob3N0fToke3BvcnR9YCxcbiAgICAgICAgICBnZW5lcmF0aW9uSWQ6IHRoaXMuZ2VuZXJhdGlvbklkIHx8IFwiXCIsXG4gICAgICAgICAgcm9sZTogXCJ3b3JrZXJcIixcbiAgICAgICAgICB0aW1lb3V0TXM6IHRoaXMuZ2VuZXJhdGlvbkhhbmRzaGFrZVRpbWVvdXRNc1xuICAgICAgICB9KVxuICAgICAgICByZWplY3RIYW5kc2hha2UoZXJyb3IpXG4gICAgICAgIGpzb25Tb2NrZXQuZGVzdHJveSgpXG4gICAgICB9LCB0aGlzLmdlbmVyYXRpb25IYW5kc2hha2VUaW1lb3V0TXMpXG4gICAgfVxuXG4gICAgc29ja2V0Lm9uKFwiY29ubmVjdFwiLCAoKSA9PiB7XG4gICAgICBqc29uU29ja2V0LnNlbmQoe3R5cGU6IFwiaGVsbG9cIiwgcm9sZTogXCJ3b3JrZXJcIiwgLi4uKHRoaXMuZ2VuZXJhdGlvbklkID8ge2dlbmVyYXRpb25JZDogdGhpcy5nZW5lcmF0aW9uSWR9IDoge30pLCBzdXBwb3J0c0hhbmRvZmZJZFJlcG9ydGluZzogdHJ1ZSwgc3VwcG9ydHNIZWFydGJlYXQ6IHRydWUsIHN1cHBvcnRzUG9vbGVkOiB0cnVlLCB3b3JrZXJJZDogdGhpcy53b3JrZXJJZH0pXG4gICAgICBpZiAoIXRoaXMuZ2VuZXJhdGlvbklkKSB7XG4gICAgICAgIGNvbm5lY3Rpb25BY2NlcHRlZCA9IHRydWVcbiAgICAgICAgdGhpcy5fc2VuZFJlYWR5SWZSdW5uaW5nKClcbiAgICAgICAgdGhpcy5fc3RhcnRIZWFydGJlYXQoKVxuICAgICAgICByZXNvbHZlSGFuZHNoYWtlKClcbiAgICAgIH1cbiAgICB9KVxuXG4gICAgaWYgKHRoaXMuZ2VuZXJhdGlvbklkKSBhd2FpdCBoYW5kc2hha2VcbiAgfVxuXG4gIC8qKiBTY2hlZHVsZXMgb25lIGZlbmNlZCByZWNvbm5lY3QgdG8gdGhlIHdvcmtlcidzIHVuY2hhbmdlZCBlbmRwb2ludC4gKi9cbiAgX3NjaGVkdWxlUmVjb25uZWN0KCkge1xuICAgIGlmICh0aGlzLnNob3VsZFN0b3AgfHwgdGhpcy5fcmVjb25uZWN0VGltZXIpIHJldHVyblxuXG4gICAgdGhpcy5fcmVjb25uZWN0VGltZXIgPSBzZXRUaW1lb3V0KCgpID0+IHtcbiAgICAgIHRoaXMuX3JlY29ubmVjdFRpbWVyID0gdW5kZWZpbmVkXG4gICAgICBpZiAodGhpcy5zaG91bGRTdG9wKSByZXR1cm5cbiAgICAgIHZvaWQgdGhpcy5fY29ubmVjdCh7YWxsb3dSZWNvbm5lY3Q6IHRydWV9KS5jYXRjaCgoZXJyb3IpID0+IHtcbiAgICAgICAgaWYgKCF0aGlzLnNob3VsZFN0b3ApIGNvbnNvbGUuZXJyb3IoXCJCYWNrZ3JvdW5kIGpvYnMgd29ya2VyIHJlY29ubmVjdCBmYWlsZWQ6XCIsIGVycm9yKVxuICAgICAgfSlcbiAgICB9LCB0aGlzLnJlY29ubmVjdERlbGF5TXMpXG4gICAgaWYgKHR5cGVvZiB0aGlzLl9yZWNvbm5lY3RUaW1lci51bnJlZiA9PT0gXCJmdW5jdGlvblwiKSB0aGlzLl9yZWNvbm5lY3RUaW1lci51bnJlZigpXG4gIH1cblxuICAvKipcbiAgICogU3VyZmFjZXMgYW4gdW5leHBlY3RlZCB3b3JrZXIgbGlmZWN5Y2xlIGZhaWx1cmUgdGhyb3VnaCB0aGUgZnJhbWV3b3JrIGVycm9yXG4gICAqIGNoYW5uZWxzIHNvIGEgc3VwZXJ2aXNvciBob29rIHRoYXQgaWdub3JlcyBzdGRpbyBzdGlsbCBoYXMgb2JzZXJ2YWJpbGl0eS5cbiAgICogQHBhcmFtIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gZXJyb3IgLSBXb3JrZXIgbGlmZWN5Y2xlIGZhaWx1cmUuXG4gICAqL1xuICBfcmVwb3J0TGlmZWN5Y2xlRXJyb3IoZXJyb3IpIHtcbiAgICBjb25zdCBjb25maWd1cmF0aW9uID0gdGhpcy5jb25maWd1cmF0aW9uXG4gICAgaWYgKCFjb25maWd1cmF0aW9uKSByZXR1cm5cbiAgICBjb25zdCBub3JtYWxpemVkRXJyb3IgPSBlcnJvciBpbnN0YW5jZW9mIEVycm9yID8gZXJyb3IgOiBuZXcgRXJyb3IoU3RyaW5nKGVycm9yKSlcbiAgICBjb25zdCBwYXlsb2FkID0ge2NvbnRleHQ6IHtnZW5lcmF0aW9uSWQ6IHRoaXMuZ2VuZXJhdGlvbklkLCBzdGFnZTogXCJiYWNrZ3JvdW5kLWpvYnMtd29ya2VyLWxpZmVjeWNsZVwifSwgZXJyb3I6IG5vcm1hbGl6ZWRFcnJvcn1cbiAgICBjb25zdCBlcnJvckV2ZW50cyA9IGNvbmZpZ3VyYXRpb24uZ2V0RXJyb3JFdmVudHMoKVxuXG4gICAgZXJyb3JFdmVudHMuZW1pdChcImZyYW1ld29yay1lcnJvclwiLCBwYXlsb2FkKVxuICAgIGVycm9yRXZlbnRzLmVtaXQoXCJhbGwtZXJyb3JcIiwgey4uLnBheWxvYWQsIGVycm9yVHlwZTogXCJmcmFtZXdvcmstZXJyb3JcIn0pXG4gIH1cblxuICAvKipcbiAgICogU2VuZHMgcGVyaW9kaWMgbGl2ZW5lc3MgaGVhcnRiZWF0cyB0byB0aGUgbWFpbiBzbyBhIHdlZGdlZCBvciBzaWxlbnQgd29ya2VyXG4gICAqIGNhbiBiZSBkZXRlY3RlZCBhbmQgZHJvcHBlZCB0aGVyZSAoaXRzIGxlYXNlcyByZWxlYXNlZCkgaW5zdGVhZCBvZiBmcmVlemluZ1xuICAgKiB0aGUgcXVldWUgdW50aWwgYSBodW1hbiBub3RpY2VzLlxuICAgKiBAcmV0dXJucyB7dm9pZH1cbiAgICovXG4gIF9zdGFydEhlYXJ0YmVhdCgpIHtcbiAgICB0aGlzLl9zdG9wSGVhcnRiZWF0KClcblxuICAgIHRoaXMuX2hlYXJ0YmVhdFRpbWVyID0gc2V0SW50ZXJ2YWwoKCkgPT4gdGhpcy5fc2VuZEhlYXJ0YmVhdCgpLCB0aGlzLmhlYXJ0YmVhdEludGVydmFsTXMpXG5cbiAgICBpZiAodHlwZW9mIHRoaXMuX2hlYXJ0YmVhdFRpbWVyLnVucmVmID09PSBcImZ1bmN0aW9uXCIpIHRoaXMuX2hlYXJ0YmVhdFRpbWVyLnVucmVmKClcbiAgfVxuXG4gIC8qKiBTZW5kcyBvbmUgbGl2ZW5lc3MgaGVhcnRiZWF0IHdoaWxlIHRoZSB3b3JrZXIgaGFzIG5vdCBmaW5hbGx5IHN0b3BwZWQuICovXG4gIF9zZW5kSGVhcnRiZWF0KCkge1xuICAgIGlmICh0aGlzLnNob3VsZFN0b3AgfHwgIXRoaXMuanNvblNvY2tldCkgcmV0dXJuXG5cbiAgICB0cnkge1xuICAgICAgdGhpcy5qc29uU29ja2V0LnNlbmQoe3R5cGU6IFwiaGVhcnRiZWF0XCIsIHdvcmtlcklkOiB0aGlzLndvcmtlcklkfSlcbiAgICB9IGNhdGNoIHtcbiAgICAgIC8vIFNvY2tldCBpcyBjbG9zaW5nL2Nsb3NlZDsgdGhlIGNsb3NlIGhhbmRsZXIgZHJpdmVzIHJlY29ubmVjdC5cbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogU3RvcHMgdGhlIGxpdmVuZXNzIGhlYXJ0YmVhdCB0aW1lci5cbiAgICogQHJldHVybnMge3ZvaWR9XG4gICAqL1xuICBfc3RvcEhlYXJ0YmVhdCgpIHtcbiAgICBpZiAodGhpcy5faGVhcnRiZWF0VGltZXIpIHtcbiAgICAgIGNsZWFySW50ZXJ2YWwodGhpcy5faGVhcnRiZWF0VGltZXIpXG4gICAgICB0aGlzLl9oZWFydGJlYXRUaW1lciA9IHVuZGVmaW5lZFxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGhhbmRsZSBqb2IuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi90eXBlcy5qc1wiKS5CYWNrZ3JvdW5kSm9iUGF5bG9hZH0gcGF5bG9hZCAtIFBheWxvYWQuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIHdoZW4gZG9uZS5cbiAgICovXG4gIGFzeW5jIF9oYW5kbGVKb2IocGF5bG9hZCkge1xuICAgIGlmICghcGF5bG9hZC5pZCkgdGhyb3cgbmV3IEVycm9yKFwiQmFja2dyb3VuZCBqb2IgcGF5bG9hZCBtaXNzaW5nIGlkXCIpXG4gICAgLyoqXG4gICAgICogSWRlbnRpZmllZCBwYXlsb2FkLlxuICAgICAqIEB0eXBlIHtpbXBvcnQoXCIuL3R5cGVzLmpzXCIpLkJhY2tncm91bmRKb2JQYXlsb2FkICYge2lkOiBzdHJpbmd9fSAqL1xuICAgIGNvbnN0IGlkZW50aWZpZWRQYXlsb2FkID0gLyoqIEB0eXBlIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gKi8gKHBheWxvYWQpXG5cbiAgICBjb25zdCBleGVjdXRpb25Nb2RlID0gdGhpcy5fZXhlY3V0aW9uTW9kZUZvclBheWxvYWQoaWRlbnRpZmllZFBheWxvYWQpXG5cbiAgICBpZiAoZXhlY3V0aW9uTW9kZSA9PT0gXCJwb29sZWRcIikge1xuICAgICAgdGhpcy5fcXVldWVQb29sZWRKb2IoaWRlbnRpZmllZFBheWxvYWQpXG4gICAgICByZXR1cm5cbiAgICB9XG5cbiAgICBpZiAoZXhlY3V0aW9uTW9kZSAhPT0gXCJpbmxpbmVcIikge1xuICAgICAgdGhpcy5fdHJhY2tQcm9jZXNzSm9iKHRoaXMuX3N0YXJ0UHJvY2Vzc0pvYih7ZXhlY3V0aW9uTW9kZSwgcGF5bG9hZDogaWRlbnRpZmllZFBheWxvYWR9KSlcbiAgICAgIHJldHVyblxuICAgIH1cblxuICAgIHRoaXMuX2hhbmRsZUlubGluZUpvYihpZGVudGlmaWVkUGF5bG9hZClcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHN0YXJ0IHByb2Nlc3Mgam9iLlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIE9wdGlvbnMuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi90eXBlcy5qc1wiKS5CYWNrZ3JvdW5kSm9iRXhlY3V0aW9uTW9kZX0gYXJncy5leGVjdXRpb25Nb2RlIC0gRXhlY3V0aW9uIG1vZGUuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi90eXBlcy5qc1wiKS5CYWNrZ3JvdW5kSm9iUGF5bG9hZCAmIHtpZDogc3RyaW5nfX0gYXJncy5wYXlsb2FkIC0gUGF5bG9hZC5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgd2hlbiB0aGUgcHJvY2VzcyBqb2IgZXhpdHMuXG4gICAqL1xuICBfc3RhcnRQcm9jZXNzSm9iKHtleGVjdXRpb25Nb2RlLCBwYXlsb2FkfSkge1xuICAgIGlmIChleGVjdXRpb25Nb2RlID09PSBcImZvcmtlZFwiKSByZXR1cm4gdGhpcy5fZm9ya0pvYihwYXlsb2FkKVxuXG4gICAgcmV0dXJuIHRoaXMuX3NwYXduSm9iKHBheWxvYWQpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBoYW5kbGUgaW5saW5lIGpvYi5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL3R5cGVzLmpzXCIpLkJhY2tncm91bmRKb2JQYXlsb2FkICYge2lkOiBzdHJpbmd9fSBwYXlsb2FkIC0gUGF5bG9hZC5cbiAgICogQHJldHVybnMge3ZvaWR9XG4gICAqL1xuICBfaGFuZGxlSW5saW5lSm9iKHBheWxvYWQpIHtcbiAgICAvLyBJbmxpbmUgam9icyBzaGFyZSB0aGUgd29ya2VyJ3MgcHJvY2VzcyBhbmQgREIgcG9vbCwgYnV0IGVhY2ggb25lXG4gICAgLy8gaXMgaXRzIG93biBhc3luYyBjaGFpbiDigJQgdGhlcmUncyBubyBzZW1hbnRpYyByZWFzb24gdG8gc2VyaWFsaXplXG4gICAgLy8gdGhlbS4gV2Uga2ljayBvZmYgdGhlIGpvYiwgcmVnaXN0ZXIgaXQgd2l0aCBgaW5mbGlnaHRJbmxpbmVKb2JzYFxuICAgIC8vIGZvciBzaHV0ZG93biBkcmFpbiwgYW5kIHNpZ25hbCBjYXBhY2l0eSB0byBtYWluOlxuICAgIC8vIC0gSWYgd2Ugc3RpbGwgaGF2ZSBhIGZyZWUgc2xvdCB3ZSBhc2sgZm9yIHRoZSBuZXh0IGpvYiByaWdodFxuICAgIC8vICAgYXdheSwgc28gYSBzbG93IGpvYiAoZS5nLiBhIGRvY2tlciBhbGl2ZSBjaGVjayB0aGF0IHdhaXRzIDE1c1xuICAgIC8vICAgb24gYSBnb25lIHNlcnZlcikgbm8gbG9uZ2VyIHN0YXJ2ZXMgZXZlcnkgb3RoZXIgaW5saW5lIGpvYi5cbiAgICAvLyAtIFdoZW4gdGhlIGpvYiBmaW5pc2hlcywgaWYgdGhlIHdvcmtlciBoYWQgYmVlbiBhdCB0aGUgY2FwLCB3ZVxuICAgIC8vICAgYXNrIGZvciB0aGUgbmV4dCBqb2IgdG8gcmVmaWxsIHRoZSBzbG90LlxuICAgIC8vIFRoZSBib29ra2VlcGluZyBpbiBgZmluYWxseSgpYCByYXRjaGV0cyBjYXBhY2l0eSBiYWNrIHVwXG4gICAgLy8gcmVnYXJkbGVzcyBvZiBzdWNjZXNzIG9yIGZhaWx1cmUuXG4gICAgLyoqXG4gICAgICogRGVmaW5lcyBpbmZsaWdodC5cbiAgICAgKiBAdHlwZSB7UHJvbWlzZTx2b2lkPn0gKi9cbiAgICBsZXQgaW5mbGlnaHRcblxuICAgIGluZmxpZ2h0ID0gdGhpcy5fcnVuSW5saW5lSm9iQW5kUmVwb3J0KHBheWxvYWQpLmZpbmFsbHkoKCkgPT4ge1xuICAgICAgdGhpcy5pbmZsaWdodElubGluZUpvYnMuZGVsZXRlKGluZmxpZ2h0KVxuXG4gICAgICAvLyBSZS1hbm5vdW5jZSBvbiBldmVyeSBjb21wbGV0aW9uIGJlbG93IGNhcCwgbm90IGp1c3QgdGhlIGNhcOKGkmNhcC0xIGVkZ2Ug4oCUXG4gICAgICAvLyBzZWUgX3RyYWNrUHJvY2Vzc0pvYiBmb3Igd2h5IHRoZSBrbmlmZS1lZGdlIGNvbmRpdGlvbiBzaWxlbnRseSB3ZWRnZXMuXG4gICAgICBpZiAoIXRoaXMuc2hvdWxkU3RvcCkgdGhpcy5fc2VuZFJlYWR5SWZSdW5uaW5nKClcbiAgICB9KVxuXG4gICAgdGhpcy5pbmZsaWdodElubGluZUpvYnMuYWRkKGluZmxpZ2h0KVxuXG4gICAgaWYgKHRoaXMuaW5mbGlnaHRJbmxpbmVKb2JzLnNpemUgPCB0aGlzLm1heENvbmN1cnJlbnRJbmxpbmVKb2JzKSB7XG4gICAgICB0aGlzLl9zZW5kUmVhZHlJZlJ1bm5pbmcoKVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGV4ZWN1dGlvbiBtb2RlIGZvciBwYXlsb2FkLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vdHlwZXMuanNcIikuQmFja2dyb3VuZEpvYlBheWxvYWR9IHBheWxvYWQgLSBQYXlsb2FkLlxuICAgKiBAcmV0dXJucyB7aW1wb3J0KFwiLi90eXBlcy5qc1wiKS5CYWNrZ3JvdW5kSm9iRXhlY3V0aW9uTW9kZX0gLSBFeGVjdXRpb24gbW9kZS5cbiAgICovXG4gIF9leGVjdXRpb25Nb2RlRm9yUGF5bG9hZChwYXlsb2FkKSB7XG4gICAgY29uc3QgZXhlY3V0aW9uTW9kZSA9IHBheWxvYWQub3B0aW9ucz8uZXhlY3V0aW9uTW9kZVxuXG4gICAgcmV0dXJuIGV4ZWN1dGlvbk1vZGUgPyB0aGlzLl9ub3JtYWxpemVFeGVjdXRpb25Nb2RlKGV4ZWN1dGlvbk1vZGUpIDogXCJwb29sZWRcIlxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgbm9ybWFsaXplIGV4ZWN1dGlvbiBtb2RlLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gZXhlY3V0aW9uTW9kZSAtIEV4ZWN1dGlvbiBtb2RlLlxuICAgKiBAcmV0dXJucyB7aW1wb3J0KFwiLi90eXBlcy5qc1wiKS5CYWNrZ3JvdW5kSm9iRXhlY3V0aW9uTW9kZX0gLSBOb3JtYWxpemVkIGV4ZWN1dGlvbiBtb2RlLlxuICAgKi9cbiAgX25vcm1hbGl6ZUV4ZWN1dGlvbk1vZGUoZXhlY3V0aW9uTW9kZSkge1xuICAgIGZvciAoY29uc3QgbW9kZSBvZiBFWEVDVVRJT05fTU9ERVMpIHtcbiAgICAgIGlmIChtb2RlID09PSBleGVjdXRpb25Nb2RlKSByZXR1cm4gbW9kZVxuICAgIH1cblxuICAgIHRocm93IG5ldyBFcnJvcihgSW52YWxpZCBiYWNrZ3JvdW5kIGpvYiBleGVjdXRpb25Nb2RlOiAke2V4ZWN1dGlvbk1vZGV9YClcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHRyYWNrIHByb2Nlc3Mgam9iLlxuICAgKiBAcGFyYW0ge1Byb21pc2U8dm9pZD59IHByb2Nlc3NKb2IgLSBQcm9jZXNzIGpvYiBwcm9taXNlLlxuICAgKiBAcmV0dXJucyB7dm9pZH1cbiAgICovXG4gIF90cmFja1Byb2Nlc3NKb2IocHJvY2Vzc0pvYikge1xuICAgIC8qKlxuICAgICAqIERlZmluZXMgaW5mbGlnaHQuXG4gICAgICogQHR5cGUge1Byb21pc2U8dm9pZD59ICovXG4gICAgbGV0IGluZmxpZ2h0XG5cbiAgICBpbmZsaWdodCA9IHByb2Nlc3NKb2IuZmluYWxseSgoKSA9PiB7XG4gICAgICB0aGlzLmluZmxpZ2h0UHJvY2Vzc0pvYnMuZGVsZXRlKGluZmxpZ2h0KVxuXG4gICAgICAvLyBSZS1hbm5vdW5jZSByZWFkaW5lc3Mgb24gRVZFUlkgY29tcGxldGlvbiB0aGF0IGxlYXZlcyB1cyBiZWxvdyBjYXAg4oCUIG5vdFxuICAgICAgLy8ganVzdCB0aGUgc2luZ2xlIGNhcOKGkmNhcC0xIGVkZ2UuIFRoZSBtYWluIHJlbW92ZXMgYSB3b3JrZXIgZnJvbSBpdHMgcmVhZHlcbiAgICAgIC8vIHNldCBvbiBlYWNoIGRpc3BhdGNoIChgX2RyYWluT25jZWApIGFuZCBvbmx5IHJlLWFkZHMgaXQgb24gYSBmcmVzaFxuICAgICAgLy8gXCJyZWFkeVwiOyBnYXRpbmcgdGhlIHJlLWFubm91bmNlIG9uIG9uZSBrbmlmZS1lZGdlIHRyYW5zaXRpb24gbWVhbnMgYVxuICAgICAgLy8gc2luZ2xlIG1pc3NlZCBvciBsb3N0IHNpZ25hbCBsZWF2ZXMgdGhlIHdvcmtlciBvdXQgb2YgdGhlIHJlYWR5IHNldCBhbmRcbiAgICAgIC8vIHdlZGdlcyBkaXNwYXRjaCBjbHVzdGVyLXdpZGUuIFRoaXMgd2FzIHRoZSBzaWxlbnQtZnJlZXplIHJvb3QgY2F1c2UuXG4gICAgICAvLyBgX3NlbmRSZWFkeUlmUnVubmluZ2Agc2VsZi1ndWFyZHMgKGl0IHNlbmRzIG5vdGhpbmcgd2hlbiB0aGUgd29ya2VyIGlzXG4gICAgICAvLyBnZW51aW5lbHkgYXQgY2FwYWNpdHkpLCBzbyByZS1hbm5vdW5jaW5nIG9uIGV2ZXJ5IGZyZWVkIHNsb3QgaXMgc2FmZSBhbmRcbiAgICAgIC8vIGlkZW1wb3RlbnQgb24gdGhlIG1haW4uXG4gICAgICBpZiAoIXRoaXMuc2hvdWxkU3RvcCkgdGhpcy5fc2VuZFJlYWR5SWZSdW5uaW5nKClcbiAgICB9KVxuXG4gICAgdGhpcy5pbmZsaWdodFByb2Nlc3NKb2JzLmFkZChpbmZsaWdodClcbiAgICB0aGlzLl9zZW5kUmVhZHlJZlJ1bm5pbmcoKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgcnVuIGlubGluZSBqb2IgYW5kIHJlcG9ydC5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL3R5cGVzLmpzXCIpLkJhY2tncm91bmRKb2JQYXlsb2FkICYge2lkOiBzdHJpbmd9fSBwYXlsb2FkIC0gUGF5bG9hZCB3aXRoIHJlcXVpcmVkIGlkLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyB3aGVuIGNvbXBsZXRlIChzdWNjZXNzIG9yIGZhaWx1cmUgcmVwb3J0ZWQpLlxuICAgKi9cbiAgYXN5bmMgX3J1bklubGluZUpvYkFuZFJlcG9ydChwYXlsb2FkKSB7XG4gICAgLy8gUmVwb3J0IGluIHRoZSBiYWNrZ3JvdW5kIHNvIGZyZWVpbmcgdGhpcyBpbmxpbmUgc2xvdCBuZXZlciB3YWl0cyBvbiB0aGVcbiAgICAvLyByZXBvcnQuIFJlcG9ydGluZyBpcyBkdXJhYmxlIChyZXRyaWVkIHVudGlsIGl0IGxhbmRzKSwgc28gYSB0cmFuc2llbnRcbiAgICAvLyBtYWluL0RCIG91dGFnZSBuZWl0aGVyIHdlZGdlcyB0aGUgc2xvdCBub3IgbG9zZXMgdGhlIHRlcm1pbmFsIHJlc3VsdC5cbiAgICB0cnkge1xuICAgICAgYXdhaXQgdGhpcy5fcnVuSm9iSW5saW5lKHBheWxvYWQpXG4gICAgICB0aGlzLl9yZXBvcnRKb2JSZXN1bHRJbkJhY2tncm91bmQoe1xuICAgICAgICBqb2JJZDogcGF5bG9hZC5pZCxcbiAgICAgICAgc3RhdHVzOiBcImNvbXBsZXRlZFwiLFxuICAgICAgICBoYW5kb2ZmSWQ6IHBheWxvYWQuaGFuZG9mZklkLFxuICAgICAgICBoYW5kZWRPZmZBdE1zOiBwYXlsb2FkLmhhbmRlZE9mZkF0TXMsXG4gICAgICAgIHdvcmtlcklkOiBwYXlsb2FkLndvcmtlcklkIHx8IHRoaXMud29ya2VySWRcbiAgICAgIH0pXG4gICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgIGlmIChlcnJvciBpbnN0YW5jZW9mIEJhY2tncm91bmRKb2JSZXNjaGVkdWxlU2lnbmFsKSB7XG4gICAgICAgIHRoaXMuX3JlcG9ydEpvYlJlc3VsdEluQmFja2dyb3VuZCh7XG4gICAgICAgICAgam9iSWQ6IHBheWxvYWQuaWQsXG4gICAgICAgICAgc3RhdHVzOiBcInJlc2NoZWR1bGVkXCIsXG4gICAgICAgICAgZGVsYXlNczogZXJyb3IuZGVsYXlNcyxcbiAgICAgICAgICBoYW5kb2ZmSWQ6IHBheWxvYWQuaGFuZG9mZklkLFxuICAgICAgICAgIGhhbmRlZE9mZkF0TXM6IHBheWxvYWQuaGFuZGVkT2ZmQXRNcyxcbiAgICAgICAgICB3b3JrZXJJZDogcGF5bG9hZC53b3JrZXJJZCB8fCB0aGlzLndvcmtlcklkXG4gICAgICAgIH0pXG4gICAgICAgIHJldHVyblxuICAgICAgfVxuXG4gICAgICB0aGlzLl9yZXBvcnRKb2JSZXN1bHRJbkJhY2tncm91bmQoe1xuICAgICAgICBqb2JJZDogcGF5bG9hZC5pZCxcbiAgICAgICAgc3RhdHVzOiBcImZhaWxlZFwiLFxuICAgICAgICBlcnJvcixcbiAgICAgICAgaGFuZG9mZklkOiBwYXlsb2FkLmhhbmRvZmZJZCxcbiAgICAgICAgaGFuZGVkT2ZmQXRNczogcGF5bG9hZC5oYW5kZWRPZmZBdE1zLFxuICAgICAgICB3b3JrZXJJZDogcGF5bG9hZC53b3JrZXJJZCB8fCB0aGlzLndvcmtlcklkXG4gICAgICB9KVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBBZHZlcnRpc2VzIGN1cnJlbnQgd29ya2VyIGNhcGFjaXR5IHVubGVzcyB0aGUgd29ya2VyIGlzIGRyYWluaW5nLlxuICAgKiBAcGFyYW0ge29iamVjdH0gW29wdGlvbnNdIC0gQWR2ZXJ0aXNlbWVudCBvcHRpb25zLlxuICAgKiBAcGFyYW0ge2Jvb2xlYW59IFtvcHRpb25zLnJldm9rZVBvb2xlZEFkbWlzc2lvbl0gLSBSZXZva2UgcG9vbGVkIGNyZWRpdHMgd2hpbGUgcHJlc2VydmluZyBvdGhlciBleGVjdXRpb24gbW9kZXMuXG4gICAqIEByZXR1cm5zIHt2b2lkfVxuICAgKi9cbiAgX3NlbmRSZWFkeUlmUnVubmluZyh7cmV2b2tlUG9vbGVkQWRtaXNzaW9uID0gZmFsc2V9ID0ge30pIHtcbiAgICBpZiAodGhpcy5zaG91bGRTdG9wIHx8IHRoaXMuaXNSZXRpcmluZykgcmV0dXJuXG4gICAgaWYgKCF0aGlzLmpzb25Tb2NrZXQpIHJldHVyblxuICAgIGlmICh0aGlzLmdlbmVyYXRpb25JZCAmJiAhdGhpcy5fZ2VuZXJhdGlvbkFjY2VwdGVkKSByZXR1cm5cblxuICAgIGNvbnN0IHJlYWR5TWVzc2FnZSA9IHRoaXMuX3JlYWR5TWVzc2FnZSh7cmV2b2tlUG9vbGVkQWRtaXNzaW9ufSlcblxuICAgIGlmICghcmVhZHlNZXNzYWdlKSByZXR1cm5cbiAgICB0aGlzLmpzb25Tb2NrZXQuc2VuZChyZWFkeU1lc3NhZ2UpXG4gIH1cblxuICAvKipcbiAgICogUnVucyByZWFkeSBtZXNzYWdlLlxuICAgKiBAcGFyYW0ge29iamVjdH0gW29wdGlvbnNdIC0gQWR2ZXJ0aXNlbWVudCBvcHRpb25zLlxuICAgKiBAcGFyYW0ge2Jvb2xlYW59IFtvcHRpb25zLnJldm9rZVBvb2xlZEFkbWlzc2lvbl0gLSBSZXZva2UgcG9vbGVkIGNyZWRpdHMgd2hpbGUgcHJlc2VydmluZyBvdGhlciBleGVjdXRpb24gbW9kZXMuXG4gICAqIEByZXR1cm5zIHtpbXBvcnQoXCIuL3R5cGVzLmpzXCIpLkJhY2tncm91bmRKb2JTb2NrZXRNZXNzYWdlIHwgbnVsbH0gLSBSZWFkeSBtZXNzYWdlIG9yIG51bGwgd2hlbiB0aGUgd29ya2VyIGhhcyBubyBjYXBhY2l0eS5cbiAgICovXG4gIF9yZWFkeU1lc3NhZ2Uoe3Jldm9rZVBvb2xlZEFkbWlzc2lvbiA9IGZhbHNlfSA9IHt9KSB7XG4gICAgY29uc3QgYWNjZXB0c1Byb2Nlc3NKb2IgPSB0aGlzLmluZmxpZ2h0UHJvY2Vzc0pvYnMuc2l6ZSA8IHRoaXMubWF4Q29uY3VycmVudEZvcmtlZEpvYnNcbiAgICBjb25zdCBhY2NlcHRzSW5saW5lID0gdGhpcy5pbmZsaWdodElubGluZUpvYnMuc2l6ZSA8IHRoaXMubWF4Q29uY3VycmVudElubGluZUpvYnNcbiAgICBjb25zdCBhdmFpbGFibGVQb29sZWRTbG90cyA9IHJldm9rZVBvb2xlZEFkbWlzc2lvbiA/IDAgOiB0aGlzLl9hdmFpbGFibGVQb29sZWRTbG90cygpXG4gICAgY29uc3QgYWNjZXB0c1Bvb2xlZCA9IGF2YWlsYWJsZVBvb2xlZFNsb3RzID4gMFxuXG4gICAgaWYgKCFyZXZva2VQb29sZWRBZG1pc3Npb24gJiYgIWFjY2VwdHNQcm9jZXNzSm9iICYmICFhY2NlcHRzSW5saW5lICYmICFhY2NlcHRzUG9vbGVkKSByZXR1cm4gbnVsbFxuXG4gICAgcmV0dXJuIHtcbiAgICAgIHR5cGU6IFwicmVhZHlcIixcbiAgICAgIGFjY2VwdHNGb3JrZWQ6IGFjY2VwdHNQcm9jZXNzSm9iLFxuICAgICAgYWNjZXB0c0lubGluZSxcbiAgICAgIGFjY2VwdHNQb29sZWQsXG4gICAgICBhdmFpbGFibGVQb29sZWRTbG90cyxcbiAgICAgIGFjY2VwdHNTcGF3bmVkOiBhY2NlcHRzUHJvY2Vzc0pvYlxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBUcmFja3MgYSBwb29sZWQgam9iIGFuZCByZS1hZHZlcnRpc2VzIGNhcGFjaXR5LlxuICAgKiBAcGFyYW0ge1Byb21pc2U8dm9pZD59IHBvb2xlZEpvYiAtIFBvb2xlZCBqb2IgcHJvbWlzZS5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gVGhlIHRyYWNrZWQgaW4tZmxpZ2h0IHByb21pc2UuXG4gICAqL1xuICBfdHJhY2tQb29sZWRKb2IocG9vbGVkSm9iKSB7XG4gICAgLyoqIEB0eXBlIHtQcm9taXNlPHZvaWQ+fSAqL1xuICAgIGxldCBpbmZsaWdodFxuICAgIGluZmxpZ2h0ID0gcG9vbGVkSm9iLmZpbmFsbHkoKCkgPT4ge1xuICAgICAgdGhpcy5pbmZsaWdodFBvb2xlZEpvYnMuZGVsZXRlKGluZmxpZ2h0KVxuICAgICAgaWYgKCF0aGlzLnNob3VsZFN0b3AgJiYgIXRoaXMuX3Bvb2xlZFN0YXJ0dXBGYWlsdXJlSm9icy5oYXMocG9vbGVkSm9iKSAmJiAhdGhpcy5fcG9vbGVkU3RhcnR1cEZhaWx1cmVKb2JzLmhhcyhpbmZsaWdodCkpIHRoaXMuX3NlbmRSZWFkeUlmUnVubmluZygpXG4gICAgfSlcbiAgICB0aGlzLmluZmxpZ2h0UG9vbGVkSm9icy5hZGQoaW5mbGlnaHQpXG4gICAgcmV0dXJuIGluZmxpZ2h0XG4gIH1cblxuICAvKipcbiAgICogU2VyaWFsaXplcyByZXBlYXRlZCBsZWFzZXMgZm9yIG9uZSBkdXJhYmxlIHJvdyB3aGlsZSBwcmVzZXJ2aW5nIHBvb2xlZFxuICAgKiBjb25jdXJyZW5jeSBhY3Jvc3MgZGlmZmVyZW50IGpvYiBpZHMuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi90eXBlcy5qc1wiKS5CYWNrZ3JvdW5kSm9iUGF5bG9hZCAmIHtpZDogc3RyaW5nfX0gcGF5bG9hZCAtIFBvb2xlZCBqb2IgcGF5bG9hZC5cbiAgICogQHJldHVybnMge3ZvaWR9XG4gICAqL1xuICBfcXVldWVQb29sZWRKb2IocGF5bG9hZCkge1xuICAgIGNvbnN0IHF1ZXVlID0gdGhpcy5wb29sZWRKb2JRdWV1ZXMuZ2V0KHBheWxvYWQuaWQpXG4gICAgaWYgKHF1ZXVlKSB7XG4gICAgICBxdWV1ZS5wdXNoKHBheWxvYWQpXG4gICAgICByZXR1cm5cbiAgICB9XG5cbiAgICB0aGlzLnBvb2xlZEpvYlF1ZXVlcy5zZXQocGF5bG9hZC5pZCwgW3BheWxvYWRdKVxuICAgIGNvbnN0IHRyYWNrZXIgPSB0aGlzLl90cmFja1Bvb2xlZEpvYih0aGlzLl9ydW5Qb29sZWRKb2JRdWV1ZShwYXlsb2FkLmlkKSlcbiAgICB0aGlzLnBvb2xlZEpvYlF1ZXVlVHJhY2tlcnMuc2V0KHBheWxvYWQuaWQsIHRyYWNrZXIpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBhZG1pdHRlZCBsZWFzZXMgZm9yIG9uZSBkdXJhYmxlIGpvYiBpZCBpbiBhcnJpdmFsIG9yZGVyLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gam9iSWQgLSBEdXJhYmxlIGpvYiBpZC5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgYWZ0ZXIgdGhlIHBlci1pZCBxdWV1ZSBkcmFpbnMuXG4gICAqL1xuICBhc3luYyBfcnVuUG9vbGVkSm9iUXVldWUoam9iSWQpIHtcbiAgICBjb25zdCBxdWV1ZSA9IHRoaXMucG9vbGVkSm9iUXVldWVzLmdldChqb2JJZClcbiAgICBpZiAoIXF1ZXVlKSB0aHJvdyBuZXcgRXJyb3IoYFBvb2xlZCBqb2IgcXVldWUgbWlzc2luZyBmb3Igam9iOiAke2pvYklkfWApXG5cbiAgICB0cnkge1xuICAgICAgd2hpbGUgKHF1ZXVlLmxlbmd0aCA+IDApIHtcbiAgICAgICAgY29uc3QgcGF5bG9hZCA9IHF1ZXVlLnNoaWZ0KClcbiAgICAgICAgaWYgKCFwYXlsb2FkKSB0aHJvdyBuZXcgRXJyb3IoYFBvb2xlZCBqb2IgcXVldWUgY29udGFpbmVkIGFuIGVtcHR5IHBheWxvYWQgZm9yIGpvYjogJHtqb2JJZH1gKVxuICAgICAgICBhd2FpdCB0aGlzLl9ydW5Qb29sZWRKb2IocGF5bG9hZClcbiAgICAgIH1cbiAgICB9IGZpbmFsbHkge1xuICAgICAgY29uc3QgdHJhY2tlciA9IHRoaXMucG9vbGVkSm9iUXVldWVUcmFja2Vycy5nZXQoam9iSWQpXG4gICAgICBpZiAodHJhY2tlcikge1xuICAgICAgICB0aGlzLmluZmxpZ2h0UG9vbGVkSm9icy5kZWxldGUodHJhY2tlcilcbiAgICAgICAgdGhpcy5wb29sZWRKb2JRdWV1ZVRyYWNrZXJzLmRlbGV0ZShqb2JJZClcbiAgICAgIH1cbiAgICAgIHRoaXMucG9vbGVkSm9iUXVldWVzLmRlbGV0ZShqb2JJZClcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogRnJlZSBwb29sZWQgc2xvdHMgYWNyb3NzIHRoZSBwb29sOiBvcGVuIHNsb3RzIGluIG5vbi1yZXRpcmluZyBjaGlsZHJlbiBwbHVzXG4gICAqIHRoZSBzbG90cyB3ZSBjb3VsZCBhZGQgYnkgc3Bhd25pbmcgbW9yZSBjaGlsZHJlbiB1cCB0byBgcG9vbGVkUnVubmVyQ291bnRgLlxuICAgKiBSZXRpcmluZyBjaGlsZHJlbiAoZHJhaW5pbmcgYmVmb3JlIHJlcGxhY2VtZW50KSBuZXZlciBjb250cmlidXRlIGNhcGFjaXR5LlxuICAgKiBAcmV0dXJucyB7bnVtYmVyfSAtIE51bWJlciBvZiBwb29sZWQgam9icyB0aGUgd29ya2VyIGNhbiBhY2NlcHQgcmlnaHQgbm93LlxuICAgKi9cbiAgX2F2YWlsYWJsZVBvb2xlZFNsb3RzKCkge1xuICAgIGxldCBvcGVuSW5FeGlzdGluZyA9IDBcbiAgICBsZXQgbm9uUmV0aXJpbmdDaGlsZHJlbiA9IDBcbiAgICBsZXQgcXVldWVkUmVzZXJ2YXRpb25zID0gMFxuXG4gICAgZm9yIChjb25zdCBjaGlsZCBvZiB0aGlzLnBvb2xlZENoaWxkcmVuKSB7XG4gICAgICBjb25zdCBzdGF0ZSA9IHRoaXMucG9vbGVkQ2hpbGRTdGF0ZXMuZ2V0KGNoaWxkKVxuICAgICAgaWYgKCFzdGF0ZSB8fCBzdGF0ZS5yZXRpcmluZykgY29udGludWVcbiAgICAgIG5vblJldGlyaW5nQ2hpbGRyZW4gKz0gMVxuICAgICAgb3BlbkluRXhpc3RpbmcgKz0gdGhpcy5wb29sZWRSdW5uZXJDb25jdXJyZW5jeSAtIHN0YXRlLmluZmxpZ2h0LnNpemVcbiAgICB9XG5cbiAgICBmb3IgKGNvbnN0IHF1ZXVlIG9mIHRoaXMucG9vbGVkSm9iUXVldWVzLnZhbHVlcygpKSBxdWV1ZWRSZXNlcnZhdGlvbnMgKz0gcXVldWUubGVuZ3RoXG5cbiAgICBjb25zdCBzcGF3bmFibGVDaGlsZHJlbiA9IE1hdGgubWF4KDAsIHRoaXMucG9vbGVkUnVubmVyQ291bnQgLSBub25SZXRpcmluZ0NoaWxkcmVuKVxuXG4gICAgcmV0dXJuIE1hdGgubWF4KDAsIG9wZW5JbkV4aXN0aW5nICsgc3Bhd25hYmxlQ2hpbGRyZW4gKiB0aGlzLnBvb2xlZFJ1bm5lckNvbmN1cnJlbmN5IC0gcXVldWVkUmVzZXJ2YXRpb25zKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgYSBwYXlsb2FkIG9uIGEgcG9vbGVkIGNoaWxkIHdpdGggYSBmcmVlIGNvbmN1cnJlbmN5IHNsb3QsIHNwYXduaW5nIGFcbiAgICogbmV3IGNoaWxkIHdoZW4gZXZlcnkgbm9uLXJldGlyaW5nIGNoaWxkIGlzIGZ1bGwgYW5kIHRoZSBwb29sIGlzIGJlbG93XG4gICAqIGBwb29sZWRSdW5uZXJDb3VudGAuIEVhY2ggY2hpbGQgcnVucyB1cCB0byBgcG9vbGVkUnVubmVyQ29uY3VycmVuY3lgIGpvYnMgYXRcbiAgICogb25jZSBvbiBpdHMgb3duIGV2ZW50IGxvb3AuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi90eXBlcy5qc1wiKS5CYWNrZ3JvdW5kSm9iUGF5bG9hZCAmIHtpZDogc3RyaW5nfX0gcGF5bG9hZCAtIEpvYiBwYXlsb2FkLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyBhZnRlciB0aGUgZHVyYWJsZSByZXBvcnQuXG4gICAqL1xuICBfcnVuUG9vbGVkSm9iKHBheWxvYWQpIHtcbiAgICBjb25zdCBjaGlsZCA9IHRoaXMuX3NlbGVjdFBvb2xlZENoaWxkKCkgfHwgdGhpcy5fY3JlYXRlUG9vbGVkQ2hpbGQoKVxuICAgIGNvbnN0IHN0YXRlID0gdGhpcy5wb29sZWRDaGlsZFN0YXRlcy5nZXQoY2hpbGQpXG4gICAgaWYgKCFzdGF0ZSkgdGhyb3cgbmV3IEVycm9yKFwiUG9vbGVkIHJ1bm5lciBzdGF0ZSBtaXNzaW5nXCIpXG5cbiAgICAvLyBTdGFtcCB0aGUgcm91bmQtcm9iaW4gY3Vyc29yIHNvIHRoZSBuZXh0IGRpc3BhdGNoIHByZWZlcnMgYSBkaWZmZXJlbnQgY2hpbGQuXG4gICAgc3RhdGUubGFzdERpc3BhdGNoU2VxID0gKyt0aGlzLl9wb29sZWREaXNwYXRjaFNlcVxuXG4gICAgLyoqXG4gICAgICogUmVzb2x2ZXMgdGhlIHBvb2xlZCBqb2IgcHJvbWlzZS5cbiAgICAgKiBAdHlwZSB7KHZhbHVlOiB2b2lkKSA9PiB2b2lkfVxuICAgICAqL1xuICAgIGxldCByZXNvbHZlUG9vbGVkSm9iID0gKCkgPT4ge31cbiAgICBjb25zdCBwb29sZWRKb2IgPSBuZXcgUHJvbWlzZSgocmVzb2x2ZSkgPT4geyByZXNvbHZlUG9vbGVkSm9iID0gcmVzb2x2ZSB9KVxuICAgIGNvbnN0IHRpbWVvdXRUaW1lciA9IHRoaXMuX2FybVBvb2xlZEpvYlRpbWVvdXQoe2NoaWxkLCBwYXlsb2FkfSlcblxuICAgIHN0YXRlLmluZmxpZ2h0LnNldChwYXlsb2FkLmlkLCB7cGF5bG9hZCwgcmVzb2x2ZTogcmVzb2x2ZVBvb2xlZEpvYiwgcG9vbGVkSm9iLCB0aW1lb3V0VGltZXJ9KVxuICAgIHRyeSB7XG4gICAgICBjaGlsZC5zZW5kKHt0eXBlOiBcImpvYlwiLCBwYXlsb2FkLCBzaGFyZWRUcmFuc2FjdGlvbkJyb2tlcjogdGhpcy5fcG9vbGVkSm9iU2hhcmVkVHJhbnNhY3Rpb25Ccm9rZXJDb25maWcoKX0pXG4gICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgIHZvaWQgdGhpcy5faGFuZGxlUG9vbGVkQ2hpbGRGYWlsdXJlKHtjaGlsZCwgZXJyb3J9KVxuICAgIH1cblxuICAgIHJldHVybiBwb29sZWRKb2JcbiAgfVxuXG4gIC8qKlxuICAgKiBDYXB0dXJlcyB0aGUgY3VycmVudCB0ZXN0IGF0dGVtcHQncyBicm9rZXIgbW9kZSBhdCBkaXNwYXRjaCB0aW1lLiBBIHdhcm1cbiAgICogcG9vbGVkIGNoaWxkIG11c3QgbmV2ZXIgcmVseSBvbiBpdHMgaW1tdXRhYmxlIGZvcmstdGltZSBlbnZpcm9ubWVudC5cbiAgICogQHJldHVybnMge2ltcG9ydChcIi4uL3Rlc3Rpbmcvc2hhcmVkLXRyYW5zYWN0aW9uLXByb3h5LWRyaXZlci5qc1wiKS5TaGFyZWRUcmFuc2FjdGlvbkJyb2tlckpvYkNvbmZpZ30gLSBQZXItam9iIGJyb2tlciBjb25maWd1cmF0aW9uLlxuICAgKi9cbiAgX3Bvb2xlZEpvYlNoYXJlZFRyYW5zYWN0aW9uQnJva2VyQ29uZmlnKCkge1xuICAgIGNvbnN0IHNlcmlhbGl6ZWQgPSBwcm9jZXNzLmVudi5WRUxPQ0lPVVNfVEVTVF9TSEFSRURfVFJBTlNBQ1RJT05fQlJPS0VSXG4gICAgaWYgKCFzZXJpYWxpemVkKSByZXR1cm4ge2V4cGVjdGVkOiBmYWxzZX1cblxuICAgIGNvbnN0IGNvbmZpZyA9IEpTT04ucGFyc2UoQnVmZmVyLmZyb20oc2VyaWFsaXplZCwgXCJiYXNlNjR1cmxcIikudG9TdHJpbmcoXCJ1dGY4XCIpKVxuICAgIHJldHVybiB7Li4uY29uZmlnLCBleHBlY3RlZDogdHJ1ZX1cbiAgfVxuXG4gIC8qKlxuICAgKiBTZWxlY3RzIGEgcG9vbGVkIGNoaWxkIHRvIHJ1biB0aGUgbmV4dCBqb2IsIG9yIHVuZGVmaW5lZCB3aGVuIGV2ZXJ5IG5vbi1yZXRpcmluZ1xuICAgKiBjaGlsZCBpcyBhbHJlYWR5IGZ1bGwgKHRoZSBjYWxsZXIgdGhlbiBsYXppbHkgc3Bhd25zIG9uZSkuIEFtb25nIGNoaWxkcmVuIHdpdGggYVxuICAgKiBmcmVlIGNvbmN1cnJlbmN5IHNsb3QsIHBpY2tzIHRoZSBvbmUgZGlzcGF0Y2hlZCBsZWFzdCByZWNlbnRseSDigJQgYSByb3VuZC1yb2JpbiB0aGF0XG4gICAqIHNwcmVhZHMgam9icyAobm90YWJseSBtdWx0aS1taW51dGUgUnVuQnVpbGRKb2JzLCBlYWNoIHBpbm5pbmcgYSB0ZW5hbnQgY29ubmVjdGlvblxuICAgKiBmb3IgaXRzIHdob2xlIHJ1bikgZXZlbmx5IGFjcm9zcyBjaGlsZHJlbiBpbnN0ZWFkIG9mIGZpcnN0LWZpdCBwYWNraW5nIHRoZSBlYXJsaWVzdFxuICAgKiBvbmUgdW50aWwgaXQgaXMgZnVsbC4gQSBmcmVzaGx5IHNwYXduZWQgb3IgcmVwbGFjZW1lbnQgY2hpbGQgdGhlcmVmb3JlIHRha2VzIGl0c1xuICAgKiBmYWlyIHNoYXJlIG9uZSBqb2IgYXQgYSB0aW1lIGFzIGl0cyB0dXJuIGNvbWVzIHVwLCByYXRoZXIgdGhhbiBhYnNvcmJpbmcgYSBidXJzdCB0b1xuICAgKiBcImNhdGNoIHVwXCIgdG8gdGhlIG90aGVycy5cbiAgICogQHJldHVybnMge2ltcG9ydChcIm5vZGU6Y2hpbGRfcHJvY2Vzc1wiKS5DaGlsZFByb2Nlc3MgfCB1bmRlZmluZWR9IC0gVGhlIGNob3NlbiBjaGlsZCwgb3IgdW5kZWZpbmVkIHdoZW4gYWxsIG5vbi1yZXRpcmluZyBjaGlsZHJlbiBhcmUgZnVsbC5cbiAgICovXG4gIF9zZWxlY3RQb29sZWRDaGlsZCgpIHtcbiAgICAvKiogQHR5cGUge2ltcG9ydChcIm5vZGU6Y2hpbGRfcHJvY2Vzc1wiKS5DaGlsZFByb2Nlc3MgfCB1bmRlZmluZWR9ICovXG4gICAgbGV0IHNlbGVjdGVkXG4gICAgbGV0IHNlbGVjdGVkU2VxID0gSW5maW5pdHlcblxuICAgIGZvciAoY29uc3QgY2hpbGQgb2YgdGhpcy5wb29sZWRDaGlsZHJlbikge1xuICAgICAgY29uc3Qgc3RhdGUgPSB0aGlzLnBvb2xlZENoaWxkU3RhdGVzLmdldChjaGlsZClcblxuICAgICAgaWYgKCFzdGF0ZSB8fCBzdGF0ZS5yZXRpcmluZyB8fCBzdGF0ZS5pbmZsaWdodC5zaXplID49IHRoaXMucG9vbGVkUnVubmVyQ29uY3VycmVuY3kpIGNvbnRpbnVlXG5cbiAgICAgIGlmIChzdGF0ZS5sYXN0RGlzcGF0Y2hTZXEgPCBzZWxlY3RlZFNlcSkge1xuICAgICAgICBzZWxlY3RlZCA9IGNoaWxkXG4gICAgICAgIHNlbGVjdGVkU2VxID0gc3RhdGUubGFzdERpc3BhdGNoU2VxXG4gICAgICB9XG4gICAgfVxuXG4gICAgcmV0dXJuIHNlbGVjdGVkXG4gIH1cblxuICAvKipcbiAgICogQXJtcyBhIHBlci1qb2Igd2FsbC1jbG9jayBiYWNrc3RvcCBmb3IgYSBwb29sZWQgam9iLiBBIHBvb2xlZCBjaGlsZCBob3N0cyBtYW55XG4gICAqIGNvbmN1cnJlbnQgam9icywgc28gYSBzaW5nbGUgZ2VudWluZWx5LWh1bmcgam9iIHdvdWxkIG90aGVyd2lzZSBwaW4gaXRzXG4gICAqIHJ1bm5lcidzIGNvbmN1cnJlbmN5IHNsb3QgZm9yZXZlciDigJQgdGhlIGxpZmV0aW1lIHJlY3ljbGUgb25seSByZXRpcmVzIGEgY2hpbGRcbiAgICogb25jZSBpdHMgaW4tZmxpZ2h0IHNldCBkcmFpbnMsIHdoaWNoIGEgaHVuZyBqb2IgbmV2ZXIgZG9lcy4gT24gb3ZlcnJ1biB0aGVcbiAgICogd2hvbGUgY2hpbGQgaXMgdGVybWluYXRlZCBzbyB0aGUgaHVuZyBqb2IgKGFuZCBpdHMgc2libGluZ3MpIHJlcXVldWUuIFJldHVybnNcbiAgICogdGhlIHRpbWVyLCBvciBudWxsIHdoZW4gbm8gdGltZW91dCBpcyBjb25maWd1cmVkLlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIE9wdGlvbnMuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwibm9kZTpjaGlsZF9wcm9jZXNzXCIpLkNoaWxkUHJvY2Vzc30gYXJncy5jaGlsZCAtIFBvb2xlZCBjaGlsZC5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL3R5cGVzLmpzXCIpLkJhY2tncm91bmRKb2JQYXlsb2FkICYge2lkOiBzdHJpbmd9fSBhcmdzLnBheWxvYWQgLSBKb2IgcGF5bG9hZCB3aG9zZSBvdmVycnVuIGlzIGd1YXJkZWQuXG4gICAqIEByZXR1cm5zIHtSZXR1cm5UeXBlPHR5cGVvZiBzZXRUaW1lb3V0PiB8IG51bGx9IC0gVGhlIGFybWVkIHRpbWVyLCBvciBudWxsLlxuICAgKi9cbiAgX2FybVBvb2xlZEpvYlRpbWVvdXQoe2NoaWxkLCBwYXlsb2FkfSkge1xuICAgIGNvbnN0IHRpbWVvdXRNcyA9IHRoaXMuX3Jlc29sdmVKb2JUaW1lb3V0TXMocGF5bG9hZC5vcHRpb25zKVxuXG4gICAgaWYgKCEodHlwZW9mIHRpbWVvdXRNcyA9PT0gXCJudW1iZXJcIiAmJiB0aW1lb3V0TXMgPiAwKSkgcmV0dXJuIG51bGxcblxuICAgIHJldHVybiBzZXRUaW1lb3V0KCgpID0+IHRoaXMuX29uUG9vbGVkSm9iVGltZW91dCh7Y2hpbGQsIGpvYklkOiBwYXlsb2FkLmlkfSksIHRpbWVvdXRNcylcbiAgfVxuXG4gIC8qKlxuICAgKiBGaXJlZCB3aGVuIGEgcG9vbGVkIGpvYiBvdmVycnVucyBpdHMgdGltZW91dC4gVGVybWluYXRlcyB0aGUgY2hpbGQgcnVubmluZyBpdFxuICAgKiAoU0lHVEVSTSwgdGhlbiBTSUdLSUxMIGFmdGVyIHRoZSBncmFjZSkg4oCUIGEgaHVuZyBKUyBqb2IgY2Fubm90IGJlIGNhbmNlbGxlZFxuICAgKiBhbnkgb3RoZXIgd2F5LiBUaGUgbm9uLWNsZWFuIGV4aXQgZmxvd3MgdGhyb3VnaCBgX2hhbmRsZVBvb2xlZENoaWxkRmFpbHVyZWAsXG4gICAqIHdoaWNoIHJlcG9ydHMgZXZlcnkgaW4tZmxpZ2h0IGpvYiBvbiB0aGUgY2hpbGQgZmFpbGVkIChzbyB0aGV5IHJlcXVldWUpIGFuZFxuICAgKiBkcm9wcyBpdCBmcm9tIHRyYWNraW5nOyB0aGUgZmFpbHVyZSBwYXRoIGltbWVkaWF0ZWx5IHJlLWFkdmVydGlzZXMgdGhlXG4gICAqIHJlc3VsdGluZyBjYXBhY2l0eSBvbmNlIHRoZSBydW5uZXIgaGFzIGNvbXBsZXRlZCBzdGFydHVwLlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIE9wdGlvbnMuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwibm9kZTpjaGlsZF9wcm9jZXNzXCIpLkNoaWxkUHJvY2Vzc30gYXJncy5jaGlsZCAtIFBvb2xlZCBjaGlsZC5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGFyZ3Muam9iSWQgLSBKb2IgaWQgdGhhdCBvdmVycmFuLlxuICAgKiBAcmV0dXJucyB7dm9pZH1cbiAgICovXG4gIF9vblBvb2xlZEpvYlRpbWVvdXQoe2NoaWxkLCBqb2JJZH0pIHtcbiAgICBjb25zdCBzdGF0ZSA9IHRoaXMucG9vbGVkQ2hpbGRTdGF0ZXMuZ2V0KGNoaWxkKVxuXG4gICAgLy8gQWxyZWFkeSBzZXR0bGluZy9nb25lLCBvciB0aGUgam9iIGZpbmlzaGVkIGluIHRoZSByYWNlIHdpdGggdGhpcyB0aW1lci5cbiAgICBpZiAoIXN0YXRlIHx8IHN0YXRlLnNldHRsaW5nIHx8ICFzdGF0ZS5pbmZsaWdodC5oYXMoam9iSWQpKSByZXR1cm5cblxuICAgIHRyeSB7XG4gICAgICBjaGlsZC5raWxsKFwiU0lHVEVSTVwiKVxuICAgIH0gY2F0Y2gge1xuICAgICAgLy8gQ2hpbGQgYWxyZWFkeSBleGl0ZWQ7IG5vdGhpbmcgdG8gZG8uXG4gICAgfVxuXG4gICAgc3RhdGUudGltZW91dFNpZ2tpbGxUaW1lciA9IHNldFRpbWVvdXQoKCkgPT4ge1xuICAgICAgdHJ5IHtcbiAgICAgICAgY2hpbGQua2lsbChcIlNJR0tJTExcIilcbiAgICAgIH0gY2F0Y2gge1xuICAgICAgICAvLyBDaGlsZCBhbHJlYWR5IGV4aXRlZDsgbm90aGluZyB0byBkby5cbiAgICAgIH1cbiAgICB9LCB0aGlzLmZvcmtlZENoaWxkU2lna2lsbEdyYWNlTXMpXG4gIH1cblxuICAvKipcbiAgICogQ3JlYXRlcyBhIHJldXNhYmxlIHBvb2xlZCBjaGlsZC5cbiAgICogQHJldHVybnMge2ltcG9ydChcIm5vZGU6Y2hpbGRfcHJvY2Vzc1wiKS5DaGlsZFByb2Nlc3N9IC0gTmV3IHBvb2xlZCBjaGlsZC5cbiAgICovXG4gIF9jcmVhdGVQb29sZWRDaGlsZCgpIHtcbiAgICBjb25zdCBjb25maWd1cmF0aW9uID0gdGhpcy5jb25maWd1cmF0aW9uXG4gICAgaWYgKCFjb25maWd1cmF0aW9uKSB0aHJvdyBuZXcgRXJyb3IoXCJCYWNrZ3JvdW5kIGpvYnMgd29ya2VyIGNvbmZpZ3VyYXRpb24gbm90IGluaXRpYWxpemVkXCIpXG4gICAgY29uc3QgY2hpbGQgPSBmb3JrKFBPT0xFRF9SVU5ORVJfRU5UUllfUEFUSCwgW10sIHtcbiAgICAgIGN3ZDogY29uZmlndXJhdGlvbi5nZXREaXJlY3RvcnkoKSwgZXhlY0FyZ3Y6IFtdLCBzdGRpbzogW1wiaWdub3JlXCIsIFwiaWdub3JlXCIsIFwiaWdub3JlXCIsIFwiaXBjXCJdLFxuICAgICAgZW52OiBPYmplY3QuYXNzaWduKHt9LCBwcm9jZXNzLmVudiwgdGhpcy5fY2hpbGRCYWNrZ3JvdW5kSm9ic0Vudmlyb25tZW50KCkpXG4gICAgfSlcbiAgICB0aGlzLnBvb2xlZENoaWxkcmVuLmFkZChjaGlsZClcbiAgICB0aGlzLmluZmxpZ2h0UHJvY2Vzc0NoaWxkcmVuLmFkZChjaGlsZClcbiAgICB0aGlzLnBvb2xlZENoaWxkU3RhdGVzLnNldChjaGlsZCwge2NyZWF0ZWRBdE1zOiBEYXRlLm5vdygpLCBqb2JzUnVuOiAwLCBpbmZsaWdodDogbmV3IE1hcCgpLCBsYXN0RGlzcGF0Y2hTZXE6IDAsIHJldGlyaW5nOiBmYWxzZSwgc3RhcnRlZDogZmFsc2V9KVxuICAgIGNoaWxkLm9uKFwibWVzc2FnZVwiLCAobWVzc2FnZSkgPT4gdGhpcy5faGFuZGxlUG9vbGVkQ2hpbGRNZXNzYWdlKHtjaGlsZCwgbWVzc2FnZX0pKVxuICAgIGNoaWxkLm9uY2UoXCJleGl0XCIsIChjb2RlLCBzaWduYWwpID0+IHRoaXMuX2hhbmRsZVBvb2xlZENoaWxkRmFpbHVyZSh7Y2hpbGQsIGVycm9yOiBuZXcgRXJyb3IoYFBvb2xlZCBiYWNrZ3JvdW5kIGpvYiBydW5uZXIgZXhpdGVkOiBjb2RlPSR7Y29kZX0gc2lnbmFsPSR7c2lnbmFsIHx8IFwibm9uZVwifWApfSkpXG4gICAgY2hpbGQub25jZShcImVycm9yXCIsIChlcnJvcikgPT4gdGhpcy5faGFuZGxlUG9vbGVkQ2hpbGRGYWlsdXJlKHtjaGlsZCwgZXJyb3J9KSlcbiAgICByZXR1cm4gY2hpbGRcbiAgfVxuXG4gIC8qKlxuICAgKiBIYW5kbGVzIGEgcG9vbGVkIGNoaWxkJ3MgcGVyLWpvYiBkdXJhYmxlLXJlcG9ydCBhY2tub3dsZWRnZW1lbnQuIEEgY2hpbGRcbiAgICogcnVucyBqb2JzIGNvbmN1cnJlbnRseSBhbmQgcmVwb3J0cyBvbmUgYGpvYi1vdXRjb21lYCBwZXIgam9iIGlkLlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIE1lc3NhZ2UgZGV0YWlscy5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCJub2RlOmNoaWxkX3Byb2Nlc3NcIikuQ2hpbGRQcm9jZXNzfSBhcmdzLmNoaWxkIC0gUG9vbGVkIGNoaWxkLlxuICAgKiBAcGFyYW0ge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSBhcmdzLm1lc3NhZ2UgLSBJUEMgbWVzc2FnZS5cbiAgICogQHJldHVybnMge3ZvaWR9XG4gICAqL1xuICBfaGFuZGxlUG9vbGVkQ2hpbGRNZXNzYWdlKHtjaGlsZCwgbWVzc2FnZX0pIHtcbiAgICBpZiAoIW1lc3NhZ2UgfHwgdHlwZW9mIG1lc3NhZ2UgIT09IFwib2JqZWN0XCIpIHJldHVyblxuICAgIGNvbnN0IHJlY29yZCA9IC8qKiBAdHlwZSB7e3R5cGU/OiBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPiwgam9iSWQ/OiBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPiwgYWNrbm93bGVkZ2VkPzogUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4sIHJzc0J5dGVzPzogUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4sIGVycm9yPzogUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59fSAqLyAobWVzc2FnZSlcbiAgICBjb25zdCBzdGF0ZSA9IHRoaXMucG9vbGVkQ2hpbGRTdGF0ZXMuZ2V0KGNoaWxkKVxuICAgIGlmIChyZWNvcmQudHlwZSA9PT0gXCJyZWFkeVwiKSB7XG4gICAgICBpZiAoc3RhdGUpIHN0YXRlLnN0YXJ0ZWQgPSB0cnVlXG4gICAgICByZXR1cm5cbiAgICB9XG4gICAgaWYgKHJlY29yZC50eXBlICE9PSBcImpvYi1vdXRjb21lXCIgfHwgIXN0YXRlIHx8IHN0YXRlLnNldHRsaW5nIHx8IHR5cGVvZiByZWNvcmQuam9iSWQgIT09IFwic3RyaW5nXCIpIHJldHVyblxuICAgIHN0YXRlLnN0YXJ0ZWQgPSB0cnVlXG4gICAgY29uc3QgZW50cnkgPSBzdGF0ZS5pbmZsaWdodC5nZXQocmVjb3JkLmpvYklkKVxuICAgIGlmICghZW50cnkpIHJldHVyblxuXG4gICAgaWYgKGVudHJ5LnRpbWVvdXRUaW1lcikgY2xlYXJUaW1lb3V0KGVudHJ5LnRpbWVvdXRUaW1lcilcbiAgICBzdGF0ZS5pbmZsaWdodC5kZWxldGUocmVjb3JkLmpvYklkKVxuICAgIHN0YXRlLmpvYnNSdW4gKz0gMVxuICAgIGNvbnN0IHJlc29sdmUgPSBlbnRyeS5yZXNvbHZlXG5cbiAgICBpZiAocmVjb3JkLmFja25vd2xlZGdlZCA9PT0gdHJ1ZSkge1xuICAgICAgaWYgKHJlc29sdmUpIHJlc29sdmUodW5kZWZpbmVkKVxuICAgIH0gZWxzZSB7XG4gICAgICAvLyBUaGUgY2hpbGQgc3RheWVkIGFsaXZlIGJ1dCBjb3VsZCBub3QgY29uZmlybSB0aGlzIG9uZSBqb2IncyB0ZXJtaW5hbFxuICAgICAgLy8gcmVwb3J0OyByZWNsYWltIGp1c3QgdGhpcyBqb2Ig4oCUIGl0cyBjb25jdXJyZW50IHNpYmxpbmdzIGFyZSB1bmFmZmVjdGVkLlxuICAgICAgdm9pZCB0aGlzLl9yZXBvcnRKb2JSZXN1bHQoe1xuICAgICAgICBqb2JJZDogZW50cnkucGF5bG9hZC5pZCxcbiAgICAgICAgc3RhdHVzOiBcImZhaWxlZFwiLFxuICAgICAgICBlcnJvcjogbmV3IEVycm9yKHR5cGVvZiByZWNvcmQuZXJyb3IgPT09IFwic3RyaW5nXCIgPyByZWNvcmQuZXJyb3IgOiBcIlBvb2xlZCBydW5uZXIgdGVybWluYWwgcmVwb3J0IHdhcyBub3QgYWNrbm93bGVkZ2VkXCIpLFxuICAgICAgICBoYW5kb2ZmSWQ6IGVudHJ5LnBheWxvYWQuaGFuZG9mZklkLFxuICAgICAgICBoYW5kZWRPZmZBdE1zOiBlbnRyeS5wYXlsb2FkLmhhbmRlZE9mZkF0TXMsXG4gICAgICAgIHdvcmtlcklkOiBlbnRyeS5wYXlsb2FkLndvcmtlcklkIHx8IHRoaXMud29ya2VySWRcbiAgICAgIH0pLmZpbmFsbHkoKCkgPT4geyBpZiAocmVzb2x2ZSkgcmVzb2x2ZSh1bmRlZmluZWQpIH0pXG4gICAgfVxuXG4gICAgY29uc3QgcnNzQnl0ZXMgPSB0eXBlb2YgcmVjb3JkLnJzc0J5dGVzID09PSBcIm51bWJlclwiID8gcmVjb3JkLnJzc0J5dGVzIDogTnVtYmVyLlBPU0lUSVZFX0lORklOSVRZXG4gICAgY29uc3QgcnVubmVyQWdlTXMgPSBEYXRlLm5vdygpIC0gc3RhdGUuY3JlYXRlZEF0TXNcbiAgICBpZiAoIXN0YXRlLnJldGlyaW5nICYmIChzdGF0ZS5qb2JzUnVuID49IHRoaXMucG9vbGVkUnVubmVyTWF4Sm9icyB8fCByc3NCeXRlcyA+PSB0aGlzLnBvb2xlZFJ1bm5lck1heFJzc0J5dGVzIHx8IHJ1bm5lckFnZU1zID49IHRoaXMucG9vbGVkUnVubmVyTWF4TGlmZXRpbWVNcyB8fCB0aGlzLnNob3VsZFN0b3ApKSB7XG4gICAgICB0aGlzLl9iZWdpblJldGlyZVBvb2xlZENoaWxkKGNoaWxkKVxuICAgIH1cbiAgICB0aGlzLl90ZXJtaW5hdGVJZkRyYWluZWQoY2hpbGQpXG4gIH1cblxuICAvKipcbiAgICogTWFya3MgYSBwb29sZWQgY2hpbGQgZm9yIHJldGlyZW1lbnQgYW5kIGVhZ2VybHkgc3Bhd25zIGEgc2luZ2xlIHJlcGxhY2VtZW50XG4gICAqICgxLWZvci0xKSBzbyBpdHMgY2FwYWNpdHkgaXMgcmVzdG9yZWQgaW1tZWRpYXRlbHkgd2l0aG91dCB3YWl0aW5nIGZvciBpdCB0b1xuICAgKiBmaW5pc2ggZHJhaW5pbmcuIFRoZSByZXRpcmluZyBjaGlsZCBzdG9wcyByZWNlaXZpbmcgbmV3IGpvYnMgYW5kIGlzXG4gICAqIHRlcm1pbmF0ZWQgb25seSBvbmNlIGl0cyBpbi1mbGlnaHQgc2V0IGRyYWlucywgc28gYSBsb25nLXJ1bm5pbmcgam9iIChlLmcuIGFcbiAgICogYnVpbGQpIGlzIG5ldmVyIGN1dCBvZmYuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwibm9kZTpjaGlsZF9wcm9jZXNzXCIpLkNoaWxkUHJvY2Vzc30gY2hpbGQgLSBDaGlsZCB0byByZXRpcmUuXG4gICAqIEByZXR1cm5zIHt2b2lkfVxuICAgKi9cbiAgX2JlZ2luUmV0aXJlUG9vbGVkQ2hpbGQoY2hpbGQpIHtcbiAgICBjb25zdCBzdGF0ZSA9IHRoaXMucG9vbGVkQ2hpbGRTdGF0ZXMuZ2V0KGNoaWxkKVxuICAgIGlmICghc3RhdGUgfHwgc3RhdGUucmV0aXJpbmcpIHJldHVyblxuXG4gICAgc3RhdGUucmV0aXJpbmcgPSB0cnVlXG4gICAgLy8gQmVzdC1lZmZvcnQgcHJlLXdhcm06IHNraXAgd2hlbiBzdG9wcGluZyAobm8gbmV3IHdvcmspIG9yIGJlZm9yZSB0aGVcbiAgICAvLyB3b3JrZXIgaXMgaW5pdGlhbGl6ZWQgKG5vIGNvbmZpZ3VyYXRpb24gdG8gZm9yayBhIGNoaWxkIGZyb20pLlxuICAgIGlmICghdGhpcy5zaG91bGRTdG9wICYmIHRoaXMuY29uZmlndXJhdGlvbikgdGhpcy5fY3JlYXRlUG9vbGVkQ2hpbGQoKVxuICB9XG5cbiAgLyoqXG4gICAqIFRlcm1pbmF0ZXMgYSByZXRpcmluZyBwb29sZWQgY2hpbGQgb25jZSBpdCBoYXMgbm8gaW4tZmxpZ2h0IGpvYnMgbGVmdC5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCJub2RlOmNoaWxkX3Byb2Nlc3NcIikuQ2hpbGRQcm9jZXNzfSBjaGlsZCAtIENoaWxkIHRvIGNoZWNrLlxuICAgKiBAcmV0dXJucyB7dm9pZH1cbiAgICovXG4gIF90ZXJtaW5hdGVJZkRyYWluZWQoY2hpbGQpIHtcbiAgICBjb25zdCBzdGF0ZSA9IHRoaXMucG9vbGVkQ2hpbGRTdGF0ZXMuZ2V0KGNoaWxkKVxuICAgIGlmICghc3RhdGUgfHwgIXN0YXRlLnJldGlyaW5nIHx8IHN0YXRlLmluZmxpZ2h0LnNpemUgPiAwKSByZXR1cm5cblxuICAgIHRoaXMuX3JldGlyZVBvb2xlZENoaWxkKGNoaWxkKVxuICB9XG5cbiAgLyoqXG4gICAqIFJldGlyZXMgYSBkcmFpbmVkIHBvb2xlZCBjaGlsZCAocmVtb3ZlcyBpdCBmcm9tIHRyYWNraW5nLCB0aGVuIFNJR1RFUk1zIGl0KS5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCJub2RlOmNoaWxkX3Byb2Nlc3NcIikuQ2hpbGRQcm9jZXNzfSBjaGlsZCAtIENoaWxkIHByb2Nlc3MgdG8gcmV0aXJlLlxuICAgKiBAcmV0dXJucyB7dm9pZH1cbiAgICovXG4gIF9yZXRpcmVQb29sZWRDaGlsZChjaGlsZCkge1xuICAgIHRoaXMucG9vbGVkQ2hpbGRyZW4uZGVsZXRlKGNoaWxkKVxuICAgIHRoaXMucG9vbGVkQ2hpbGRTdGF0ZXMuZGVsZXRlKGNoaWxkKVxuICAgIHRoaXMuaW5mbGlnaHRQcm9jZXNzQ2hpbGRyZW4uZGVsZXRlKGNoaWxkKVxuICAgIGNoaWxkLmtpbGwoXCJTSUdURVJNXCIpXG4gIH1cblxuICAvKipcbiAgICogUmVtb3ZlcyBhbiBleGl0ZWQvdW5oZWFsdGh5IHBvb2xlZCBjaGlsZCBhbmQgcmVwb3J0cyBldmVyeSBqb2IgdGhhdCB3YXNcbiAgICogaW4tZmxpZ2h0IG9uIGl0IGFzIGZhaWxlZCDigJQgYSBwcm9jZXNzLWxldmVsIGNyYXNoJ3MgYmxhc3QgcmFkaXVzIGlzIHRoZVxuICAgKiBjaGlsZCdzIHdob2xlIGluLWZsaWdodCBzZXQuIE9uY2UgdGhlIGNoaWxkIGhhcyBjb21wbGV0ZWQgc3RhcnR1cCwgaXRzXG4gICAqIGZyZWVkIGNhcGFjaXR5IGlzIGFkdmVydGlzZWQgaW1tZWRpYXRlbHk7IHRoZSByZXBsYWNlbWVudCBpdHNlbGYgaXMgc3RpbGxcbiAgICogc3Bhd25lZCBsYXppbHkgYnkgdGhlIG5leHQgZGlzcGF0Y2guIEEgY2hpbGQgdGhhdCBleGl0cyBiZWZvcmUgaXRzIHN0YXJ0dXBcbiAgICogaGFuZHNoYWtlIGRvZXMgbm90IHJlLWFubm91bmNlLCBhdm9pZGluZyBhIHRpZ2h0IHJlc3Bhd24gbG9vcCBvbiBzdGFydHVwXG4gICAqIGZhaWx1cmUuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gRmFpbHVyZSBkZXRhaWxzLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIm5vZGU6Y2hpbGRfcHJvY2Vzc1wiKS5DaGlsZFByb2Nlc3N9IGFyZ3MuY2hpbGQgLSBQb29sZWQgY2hpbGQuXG4gICAqIEBwYXJhbSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59IGFyZ3MuZXJyb3IgLSBGYWlsdXJlLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn1cbiAgICovXG4gIGFzeW5jIF9oYW5kbGVQb29sZWRDaGlsZEZhaWx1cmUoe2NoaWxkLCBlcnJvcn0pIHtcbiAgICBjb25zdCBzdGF0ZSA9IHRoaXMucG9vbGVkQ2hpbGRTdGF0ZXMuZ2V0KGNoaWxkKVxuICAgIGlmIChzdGF0ZT8uc2V0dGxpbmcpIHJldHVyblxuICAgIGlmIChzdGF0ZSkge1xuICAgICAgc3RhdGUuc2V0dGxpbmcgPSB0cnVlXG4gICAgICAvLyBDYW5jZWwgdGhpcyBjaGlsZCdzIHBlbmRpbmcgdGltZXJzIGJlZm9yZSBpdHMgaW4tZmxpZ2h0IHNldCBpcyByZXBvcnRlZCDigJRcbiAgICAgIC8vIHRoZSBTSUdLSUxMIGdyYWNlIGZyb20gYSB0aW1lb3V0IGtpbGwsIGFuZCBldmVyeSBhcm1lZCBwZXItam9iIGJhY2tzdG9wLlxuICAgICAgaWYgKHN0YXRlLnRpbWVvdXRTaWdraWxsVGltZXIpIGNsZWFyVGltZW91dChzdGF0ZS50aW1lb3V0U2lna2lsbFRpbWVyKVxuICAgICAgZm9yIChjb25zdCBpbmZsaWdodEVudHJ5IG9mIHN0YXRlLmluZmxpZ2h0LnZhbHVlcygpKSB7XG4gICAgICAgIGlmIChpbmZsaWdodEVudHJ5LnRpbWVvdXRUaW1lcikgY2xlYXJUaW1lb3V0KGluZmxpZ2h0RW50cnkudGltZW91dFRpbWVyKVxuICAgICAgfVxuICAgIH1cbiAgICB0aGlzLnBvb2xlZENoaWxkcmVuLmRlbGV0ZShjaGlsZClcbiAgICB0aGlzLmluZmxpZ2h0UHJvY2Vzc0NoaWxkcmVuLmRlbGV0ZShjaGlsZClcblxuICAgIGNvbnN0IGVudHJpZXMgPSBzdGF0ZSA/IFsuLi5zdGF0ZS5pbmZsaWdodC52YWx1ZXMoKV0gOiBbXVxuICAgIGlmIChzdGF0ZSkgc3RhdGUuaW5mbGlnaHQuY2xlYXIoKVxuICAgIHRoaXMucG9vbGVkQ2hpbGRTdGF0ZXMuZGVsZXRlKGNoaWxkKVxuXG4gICAgY29uc3QgZmFpbHVyZVJlcG9ydHMgPSBlbnRyaWVzLm1hcChhc3luYyAoZW50cnkpID0+IHtcbiAgICAgIGF3YWl0IHRoaXMuX3JlcG9ydEpvYlJlc3VsdCh7XG4gICAgICAgIGpvYklkOiBlbnRyeS5wYXlsb2FkLmlkLFxuICAgICAgICBzdGF0dXM6IFwiZmFpbGVkXCIsXG4gICAgICAgIGVycm9yLFxuICAgICAgICBoYW5kb2ZmSWQ6IGVudHJ5LnBheWxvYWQuaGFuZG9mZklkLFxuICAgICAgICBoYW5kZWRPZmZBdE1zOiBlbnRyeS5wYXlsb2FkLmhhbmRlZE9mZkF0TXMsXG4gICAgICAgIHdvcmtlcklkOiBlbnRyeS5wYXlsb2FkLndvcmtlcklkIHx8IHRoaXMud29ya2VySWRcbiAgICAgIH0pXG4gICAgICBpZiAoZW50cnkucmVzb2x2ZSkgZW50cnkucmVzb2x2ZSh1bmRlZmluZWQpXG4gICAgfSlcblxuICAgIC8vIFN0YXJ0IGV2ZXJ5IGZhbGxiYWNrIHJlcG9ydCBiZWZvcmUgYW5ub3VuY2luZyBjYXBhY2l0eSBzbyB0aGUgbWFpbiBjYW5ub3RcbiAgICAvLyBvYnNlcnZlIGEgcmVwbGFjZW1lbnQgc2xvdCBiZWZvcmUgdGhlIGZhaWxlZCBqb2JzJyByZXBvcnRzIGFyZSBpbiBmbGlnaHQuXG4gICAgLy8gVGhlIHJlcG9ydCBwcm9taXNlcyByZW1haW4gdHJhY2tlZCBiZWxvdzsgYSBzbG93IHJldHJ5IG11c3Qgbm90IGhvbGQgdGhlXG4gICAgLy8gbmV3bHkgZnJlZWQgcnVubmVyIGNhcGFjaXR5IGhvc3RhZ2UuXG4gICAgaWYgKHN0YXRlICYmIHN0YXRlLnN0YXJ0ZWQgIT09IGZhbHNlKSB7XG4gICAgICB0aGlzLl9zZW5kUmVhZHlJZlJ1bm5pbmcoKVxuICAgIH0gZWxzZSBpZiAoc3RhdGUpIHtcbiAgICAgIGZvciAoY29uc3QgZW50cnkgb2YgZW50cmllcykge1xuICAgICAgICBpZiAoZW50cnkucG9vbGVkSm9iKSB0aGlzLl9wb29sZWRTdGFydHVwRmFpbHVyZUpvYnMuYWRkKGVudHJ5LnBvb2xlZEpvYilcbiAgICAgICAgY29uc3QgcXVldWVUcmFja2VyID0gdGhpcy5wb29sZWRKb2JRdWV1ZVRyYWNrZXJzLmdldChlbnRyeS5wYXlsb2FkLmlkKVxuICAgICAgICBpZiAocXVldWVUcmFja2VyKSB0aGlzLl9wb29sZWRTdGFydHVwRmFpbHVyZUpvYnMuYWRkKHF1ZXVlVHJhY2tlcilcbiAgICAgIH1cbiAgICAgIC8vIEEgcHJldmlvdXMgcmVhZHkgbWVzc2FnZSBtYXkgc3RpbGwgaGF2ZSB1bmNvbnN1bWVkIHBvb2xlZCBjcmVkaXRzIGF0IHRoZVxuICAgICAgLy8gbWFpbi4gUmV2b2tlIHRoZW0gYXV0aG9yaXRhdGl2ZWx5IHdpdGhvdXQgc3VwcHJlc3NpbmcgdmFsaWQgaW5saW5lIG9yXG4gICAgICAvLyBwcm9jZXNzLXJ1bm5lciByZWFkaW5lc3M7IG90aGVyd2lzZSBxdWV1ZWQgam9icyBjYW4gdHJpZ2dlciBhIHN0YXJ0dXBcbiAgICAgIC8vIGNyYXNoIGxvb3AgdXNpbmcgdGhlIHN0YWxlIGNyZWRpdHMuXG4gICAgICB0aGlzLl9zZW5kUmVhZHlJZlJ1bm5pbmcoe3Jldm9rZVBvb2xlZEFkbWlzc2lvbjogdHJ1ZX0pXG4gICAgfVxuXG4gICAgYXdhaXQgUHJvbWlzZS5hbGxTZXR0bGVkKGZhaWx1cmVSZXBvcnRzKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgcnVuIGpvYiBpbmxpbmUuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi90eXBlcy5qc1wiKS5CYWNrZ3JvdW5kSm9iUGF5bG9hZH0gcGF5bG9hZCAtIFBheWxvYWQuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIHdoZW4gZG9uZS5cbiAgICovXG4gIGFzeW5jIF9ydW5Kb2JJbmxpbmUocGF5bG9hZCkge1xuICAgIGNvbnN0IGNvbmZpZ3VyYXRpb24gPSB0aGlzLmNvbmZpZ3VyYXRpb25cbiAgICBpZiAoIWNvbmZpZ3VyYXRpb24pIHRocm93IG5ldyBFcnJvcihcIkJhY2tncm91bmQgam9icyB3b3JrZXIgY29uZmlndXJhdGlvbiBub3QgaW5pdGlhbGl6ZWRcIilcblxuICAgIGNvbnN0IHJlZ2lzdHJ5ID0gbmV3IEJhY2tncm91bmRKb2JSZWdpc3RyeSh7Y29uZmlndXJhdGlvbn0pXG4gICAgYXdhaXQgcmVnaXN0cnkubG9hZCgpXG4gICAgY29uc3QgSm9iQ2xhc3MgPSByZWdpc3RyeS5nZXRKb2JCeU5hbWUocGF5bG9hZC5qb2JOYW1lKVxuICAgIGF3YWl0IHBlcmZvcm1CYWNrZ3JvdW5kSm9iKHtcbiAgICAgIGNvbmZpZ3VyYXRpb24sXG4gICAgICBKb2JDbGFzcyxcbiAgICAgIGpvYkFyZ3M6IHBheWxvYWQuYXJncyB8fCBbXSxcbiAgICAgIGpvYk9wdGlvbnM6IHBheWxvYWQub3B0aW9ucyB8fCB7fSxcbiAgICAgIG5hbWU6IGBCYWNrZ3JvdW5kIGpvYiB3b3JrZXIgaW5saW5lOiAke3BheWxvYWQuam9iTmFtZX1gLFxuICAgICAgcGF5bG9hZFxuICAgIH0pXG4gIH1cblxuICAvKipcbiAgICogUnVucyBmb3JrIGpvYi5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL3R5cGVzLmpzXCIpLkJhY2tncm91bmRKb2JQYXlsb2FkICYge2lkOiBzdHJpbmd9fSBwYXlsb2FkIC0gUGF5bG9hZC5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgd2hlbiB0aGUgZm9ya2VkIHJ1bm5lciBleGl0cyBvciBmb3JrIGZhaWxzLlxuICAgKi9cbiAgX2ZvcmtKb2IocGF5bG9hZCkge1xuICAgIGNvbnN0IGNoaWxkID0gdGhpcy5fY3JlYXRlRm9ya2VkQ2hpbGQoKVxuXG4gICAgdGhpcy5pbmZsaWdodFByb2Nlc3NDaGlsZHJlbi5hZGQoY2hpbGQpXG5cbiAgICBjb25zdCBmaW5pc2hlZCA9IHRoaXMuX3dhaXRGb3JGb3JrZWRDaGlsZCh7Y2hpbGQsIHBheWxvYWR9KVxuXG4gICAgdGhpcy5fc2VuZEZvcmtlZFBheWxvYWQoe2NoaWxkLCBwYXlsb2FkfSlcblxuICAgIHJldHVybiBmaW5pc2hlZFxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgY3JlYXRlIGZvcmtlZCBjaGlsZC5cbiAgICogQHJldHVybnMge2ltcG9ydChcIm5vZGU6Y2hpbGRfcHJvY2Vzc1wiKS5DaGlsZFByb2Nlc3N9IC0gRm9ya2VkIGNoaWxkIHByb2Nlc3MuXG4gICAqL1xuICBfY3JlYXRlRm9ya2VkQ2hpbGQoKSB7XG4gICAgY29uc3QgY29uZmlndXJhdGlvbiA9IHRoaXMuY29uZmlndXJhdGlvblxuICAgIGlmICghY29uZmlndXJhdGlvbikgdGhyb3cgbmV3IEVycm9yKFwiQmFja2dyb3VuZCBqb2JzIHdvcmtlciBjb25maWd1cmF0aW9uIG5vdCBpbml0aWFsaXplZFwiKVxuXG4gICAgY29uc3QgZGlyZWN0b3J5ID0gY29uZmlndXJhdGlvbi5nZXREaXJlY3RvcnkoKVxuICAgIHJldHVybiBmb3JrKEZPUktFRF9SVU5ORVJfRU5UUllfUEFUSCwgW10sIHtcbiAgICAgIGN3ZDogZGlyZWN0b3J5LFxuICAgICAgZXhlY0FyZ3Y6IFtdLFxuICAgICAgc3RkaW86IFtcImlnbm9yZVwiLCBcImlnbm9yZVwiLCBcImlnbm9yZVwiLCBcImlwY1wiXSxcbiAgICAgIGVudjogT2JqZWN0LmFzc2lnbih7fSwgcHJvY2Vzcy5lbnYsIHRoaXMuX2NoaWxkQmFja2dyb3VuZEpvYnNFbnZpcm9ubWVudCgpKVxuICAgIH0pXG4gIH1cblxuICAvKipcbiAgICogUnVucyB3YWl0IGZvciBmb3JrZWQgY2hpbGQuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gT3B0aW9ucy5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCJub2RlOmNoaWxkX3Byb2Nlc3NcIikuQ2hpbGRQcm9jZXNzfSBhcmdzLmNoaWxkIC0gRm9ya2VkIGNoaWxkIHByb2Nlc3MuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi90eXBlcy5qc1wiKS5CYWNrZ3JvdW5kSm9iUGF5bG9hZCAmIHtpZDogc3RyaW5nfX0gYXJncy5wYXlsb2FkIC0gUGF5bG9hZC5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgd2hlbiB0aGUgY2hpbGQgZXhpdHMuXG4gICAqL1xuICBfd2FpdEZvckZvcmtlZENoaWxkKHtjaGlsZCwgcGF5bG9hZH0pIHtcbiAgICBjb25zdCB0aW1lb3V0U3RhdGUgPSB0aGlzLl9hcm1Gb3JrZWRKb2JUaW1lb3V0KHtjaGlsZCwgcGF5bG9hZH0pXG5cbiAgICByZXR1cm4gbmV3IFByb21pc2UoKHJlc29sdmUpID0+IHtcbiAgICAgIGNoaWxkLm9uY2UoXCJleGl0XCIsIChjb2RlLCBzaWduYWwpID0+IHtcbiAgICAgICAgdGhpcy5fY2xlYXJGb3JrZWRKb2JUaW1lb3V0KHRpbWVvdXRTdGF0ZSlcbiAgICAgICAgdGhpcy5faGFuZGxlRm9ya2VkQ2hpbGRFeGl0KHtjaGlsZCwgY29kZSwgc2lnbmFsLCBwYXlsb2FkLCByZXNvbHZlLCB0aW1lb3V0U3RhdGV9KVxuICAgICAgfSlcbiAgICAgIGNoaWxkLm9uY2UoXCJlcnJvclwiLCAoZXJyb3IpID0+IHtcbiAgICAgICAgdGhpcy5fY2xlYXJGb3JrZWRKb2JUaW1lb3V0KHRpbWVvdXRTdGF0ZSlcbiAgICAgICAgdGhpcy5faGFuZGxlRm9ya2VkQ2hpbGRFcnJvcih7Y2hpbGQsIGVycm9yLCBwYXlsb2FkLCByZXNvbHZlfSlcbiAgICAgIH0pXG4gICAgfSlcbiAgfVxuXG4gIC8qKlxuICAgKiBBcm1zIGEgd2FsbC1jbG9jayBiYWNrc3RvcCBmb3IgYSBmb3JrZWQgam9iIHJ1bm5lci4gQSBmb3JrZWQgam9iIHN0aWxsXG4gICAqIHJ1bm5pbmcgYWZ0ZXIgYGpvYlRpbWVvdXRNc2AgaXMgdGVybWluYXRlZCAoU0lHVEVSTSwgdGhlbiBTSUdLSUxMIGFmdGVyIHRoZVxuICAgKiBncmFjZSkgc28gYSBzaW5nbGUgZ2VudWluZWx5LWh1bmcgcnVubmVyIGNhbid0IHBpbiBhIGRyYWluaW5nIHdvcmtlciDigJQgYW5kXG4gICAqIGl0cyBmdWxsLWFwcCBib290IGFuZCBkYXRhYmFzZSBjb25uZWN0aW9ucyDigJQgaW5kZWZpbml0ZWx5LiBSZXR1cm5zIGEgc3RhdGVcbiAgICogb2JqZWN0IHRoZSBleGl0L2Vycm9yIGhhbmRsZXJzIHVzZSB0byBjYW5jZWwgdGhlIHRpbWVyIGFuZCB0byByZXBvcnQgYVxuICAgKiB0aW1lb3V0LXNwZWNpZmljIGZhaWx1cmUuIFdoZW4gbm8gdGltZW91dCBpcyBjb25maWd1cmVkIHRoZSB0aW1lciBpcyBudWxsXG4gICAqIGFuZCBiZWhhdmlvciBpcyB1bmNoYW5nZWQuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gT3B0aW9ucy5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCJub2RlOmNoaWxkX3Byb2Nlc3NcIikuQ2hpbGRQcm9jZXNzfSBhcmdzLmNoaWxkIC0gRm9ya2VkIGNoaWxkIHByb2Nlc3MuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi90eXBlcy5qc1wiKS5CYWNrZ3JvdW5kSm9iUGF5bG9hZCAmIHtpZDogc3RyaW5nfX0gYXJncy5wYXlsb2FkIC0gSm9iIHBheWxvYWQuXG4gICAqIEByZXR1cm5zIHtGb3JrZWRKb2JUaW1lb3V0U3RhdGV9IC0gVGltZW91dCBzdGF0ZS5cbiAgICovXG4gIF9hcm1Gb3JrZWRKb2JUaW1lb3V0KHtjaGlsZCwgcGF5bG9hZH0pIHtcbiAgICBjb25zdCB0aW1lb3V0TXMgPSB0aGlzLl9yZXNvbHZlSm9iVGltZW91dE1zKHBheWxvYWQub3B0aW9ucylcbiAgICAvKiogQHR5cGUge0ZvcmtlZEpvYlRpbWVvdXRTdGF0ZX0gKi9cbiAgICBjb25zdCBzdGF0ZSA9IHt0aW1lZE91dDogZmFsc2UsIHRpbWVvdXRNcywgdGltZXI6IG51bGwsIHNpZ2tpbGxUaW1lcjogbnVsbH1cblxuICAgIGlmICghKHR5cGVvZiB0aW1lb3V0TXMgPT09IFwibnVtYmVyXCIgJiYgdGltZW91dE1zID4gMCkpIHJldHVybiBzdGF0ZVxuXG4gICAgc3RhdGUudGltZXIgPSBzZXRUaW1lb3V0KCgpID0+IHRoaXMuX29uRm9ya2VkSm9iVGltZW91dCh7Y2hpbGQsIHN0YXRlfSksIHRpbWVvdXRNcylcblxuICAgIHJldHVybiBzdGF0ZVxuICB9XG5cbiAgLyoqXG4gICAqIFJlc29sdmVzIHRoZSBlZmZlY3RpdmUgd2FsbC1jbG9jayBqb2IgdGltZW91dCBpbiBtcyAoc2hhcmVkIGJ5IGZvcmtlZCBhbmQgcG9vbGVkIGpvYnMpLCBvciBudWxsIHdoZW4gZGlzYWJsZWQuIFRoZVxuICAgKiBwZXItam9iIG92ZXJyaWRlIHdpbnMsIGZvbGxvd2VkIGJ5IHRoZSBjb25zdHJ1Y3RvciBvdmVycmlkZSwgdGhlbiB0aGUgdmFsdWVcbiAgICogZnJvbSB0aGUgYmFja2dyb3VuZC1qb2JzIGNvbmZpZ3VyYXRpb24uIEEgbm9uLXBvc2l0aXZlIHZhbHVlIGRpc2FibGVzIHRoZVxuICAgKiBiYWNrc3RvcCBhdCB3aGljaGV2ZXIgbGV2ZWwgc3VwcGxpZWQgaXQuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi90eXBlcy5qc1wiKS5CYWNrZ3JvdW5kSm9iT3B0aW9uc30gW2pvYk9wdGlvbnNdIC0gUGVyLWpvYiBvcHRpb25zLlxuICAgKiBAcmV0dXJucyB7bnVtYmVyIHwgbnVsbH0gLSBUaW1lb3V0IGluIG1zLCBvciBudWxsIHdoZW4gZGlzYWJsZWQuXG4gICAqL1xuICBfcmVzb2x2ZUpvYlRpbWVvdXRNcyhqb2JPcHRpb25zKSB7XG4gICAgY29uc3QgcmF3ID0gdHlwZW9mIGpvYk9wdGlvbnM/LnRpbWVvdXRNcyA9PT0gXCJudW1iZXJcIlxuICAgICAgPyBqb2JPcHRpb25zLnRpbWVvdXRNc1xuICAgICAgOiAodHlwZW9mIHRoaXMuam9iVGltZW91dE1zT3ZlcnJpZGUgPT09IFwibnVtYmVyXCJcbiAgICAgICAgICA/IHRoaXMuam9iVGltZW91dE1zT3ZlcnJpZGVcbiAgICAgICAgICA6ICh0aGlzLmNvbmZpZ3VyYXRpb24gPyB0aGlzLmNvbmZpZ3VyYXRpb24uZ2V0QmFja2dyb3VuZEpvYnNDb25maWcoKS5qb2JUaW1lb3V0TXMgOiBudWxsKSlcblxuICAgIC8vIEEgbm9uLWZpbml0ZSAoZS5nLiBJbmZpbml0eSkgb3Igbm9uLXBvc2l0aXZlIHZhbHVlIGRpc2FibGVzIHRoZSBiYWNrc3RvcDtcbiAgICAvLyBhIGZpbml0ZSB2YWx1ZSBiZXlvbmQgTm9kZSdzIHRpbWVyIHJhbmdlIGlzIGNsYW1wZWQgdG8gdGhlIG1heCByYXRoZXIgdGhhblxuICAgIC8vIHNpbGVudGx5IGNvZXJjZWQgdG8gfjFtcyAod2hpY2ggd291bGQga2lsbCBldmVyeSBmb3JrZWQgam9iIGltbWVkaWF0ZWx5KS5cbiAgICBpZiAodHlwZW9mIHJhdyAhPT0gXCJudW1iZXJcIiB8fCAhTnVtYmVyLmlzRmluaXRlKHJhdykgfHwgcmF3IDw9IDApIHJldHVybiBudWxsXG5cbiAgICByZXR1cm4gTWF0aC5taW4ocmF3LCBNQVhfRk9SS0VEX0pPQl9USU1FT1VUX01TKVxuICB9XG5cbiAgLyoqXG4gICAqIEZpcmVkIHdoZW4gYSBmb3JrZWQgcnVubmVyIG92ZXJydW5zIGl0cyB0aW1lb3V0LiBTZW5kcyBTSUdURVJNIGZvciBhIGNsZWFuXG4gICAqIHNodXRkb3duLCB0aGVuIFNJR0tJTEwgYWZ0ZXIgdGhlIGdyYWNlIGZvciBhIHJ1bm5lciB0aGF0IGlnbm9yZXMgaXQuIFRoZVxuICAgKiByZXN1bHRpbmcgbm9uLWNsZWFuIGV4aXQgZmxvd3MgdGhyb3VnaCBgX2hhbmRsZUZvcmtlZENoaWxkRXhpdGAsIHdoaWNoIGZyZWVzXG4gICAqIHRoZSBzbG90IGFuZCByZXBvcnRzIHRoZSBqb2IgZmFpbGVkLlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIE9wdGlvbnMuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwibm9kZTpjaGlsZF9wcm9jZXNzXCIpLkNoaWxkUHJvY2Vzc30gYXJncy5jaGlsZCAtIEZvcmtlZCBjaGlsZCBwcm9jZXNzLlxuICAgKiBAcGFyYW0ge0ZvcmtlZEpvYlRpbWVvdXRTdGF0ZX0gYXJncy5zdGF0ZSAtIFRpbWVvdXQgc3RhdGUuXG4gICAqIEByZXR1cm5zIHt2b2lkfVxuICAgKi9cbiAgX29uRm9ya2VkSm9iVGltZW91dCh7Y2hpbGQsIHN0YXRlfSkge1xuICAgIHN0YXRlLnRpbWVkT3V0ID0gdHJ1ZVxuXG4gICAgdHJ5IHtcbiAgICAgIGNoaWxkLmtpbGwoXCJTSUdURVJNXCIpXG4gICAgfSBjYXRjaCB7XG4gICAgICAvLyBDaGlsZCBhbHJlYWR5IGV4aXRlZDsgbm90aGluZyB0byBkby5cbiAgICB9XG5cbiAgICBzdGF0ZS5zaWdraWxsVGltZXIgPSBzZXRUaW1lb3V0KCgpID0+IHtcbiAgICAgIHRyeSB7XG4gICAgICAgIGNoaWxkLmtpbGwoXCJTSUdLSUxMXCIpXG4gICAgICB9IGNhdGNoIHtcbiAgICAgICAgLy8gQ2hpbGQgYWxyZWFkeSBleGl0ZWQ7IG5vdGhpbmcgdG8gZG8uXG4gICAgICB9XG4gICAgfSwgdGhpcy5mb3JrZWRDaGlsZFNpZ2tpbGxHcmFjZU1zKVxuICB9XG5cbiAgLyoqXG4gICAqIENhbmNlbHMgYW55IHBlbmRpbmcgdGltZW91dC9TSUdLSUxMIHRpbWVycyBmb3IgYSBmb3JrZWQgcnVubmVyIHRoYXQgaGFzXG4gICAqIGV4aXRlZCAob3IgZXJyb3JlZCkgc28gdGhleSBuZXZlciBmaXJlIGFnYWluc3QgYSBnb25lIG9yIHJldXNlZCBjaGlsZC5cbiAgICogQHBhcmFtIHtGb3JrZWRKb2JUaW1lb3V0U3RhdGV9IHN0YXRlIC0gVGltZW91dCBzdGF0ZS5cbiAgICogQHJldHVybnMge3ZvaWR9XG4gICAqL1xuICBfY2xlYXJGb3JrZWRKb2JUaW1lb3V0KHN0YXRlKSB7XG4gICAgaWYgKHN0YXRlLnRpbWVyKSB7XG4gICAgICBjbGVhclRpbWVvdXQoc3RhdGUudGltZXIpXG4gICAgICBzdGF0ZS50aW1lciA9IG51bGxcbiAgICB9XG5cbiAgICBpZiAoc3RhdGUuc2lna2lsbFRpbWVyKSB7XG4gICAgICBjbGVhclRpbWVvdXQoc3RhdGUuc2lna2lsbFRpbWVyKVxuICAgICAgc3RhdGUuc2lna2lsbFRpbWVyID0gbnVsbFxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGhhbmRsZSBmb3JrZWQgY2hpbGQgZXhpdC5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBPcHRpb25zLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIm5vZGU6Y2hpbGRfcHJvY2Vzc1wiKS5DaGlsZFByb2Nlc3N9IGFyZ3MuY2hpbGQgLSBGb3JrZWQgY2hpbGQgcHJvY2Vzcy5cbiAgICogQHBhcmFtIHtudW1iZXIgfCBudWxsfSBhcmdzLmNvZGUgLSBFeGl0IGNvZGUuXG4gICAqIEBwYXJhbSB7a2V5b2YgdHlwZW9mIGltcG9ydChcIm5vZGU6b3NcIikuY29uc3RhbnRzLnNpZ25hbHMgfCBudWxsfSBhcmdzLnNpZ25hbCAtIEV4aXQgc2lnbmFsLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vdHlwZXMuanNcIikuQmFja2dyb3VuZEpvYlBheWxvYWQgJiB7aWQ6IHN0cmluZ319IGFyZ3MucGF5bG9hZCAtIFBheWxvYWQuXG4gICAqIEBwYXJhbSB7KHZhbHVlOiB2b2lkKSA9PiB2b2lkfSBhcmdzLnJlc29sdmUgLSBQcm9taXNlIHJlc29sdmVyLlxuICAgKiBAcGFyYW0ge0ZvcmtlZEpvYlRpbWVvdXRTdGF0ZX0gW2FyZ3MudGltZW91dFN0YXRlXSAtIFRpbWVvdXQgc3RhdGUsIHdoZW4gdGhlIHJ1bm5lciBoYWQgYSB3YWxsLWNsb2NrIGJhY2tzdG9wLlxuICAgKiBAcmV0dXJucyB7dm9pZH1cbiAgICovXG4gIF9oYW5kbGVGb3JrZWRDaGlsZEV4aXQoe2NoaWxkLCBjb2RlLCBzaWduYWwsIHBheWxvYWQsIHJlc29sdmUsIHRpbWVvdXRTdGF0ZX0pIHtcbiAgICB0aGlzLmluZmxpZ2h0UHJvY2Vzc0NoaWxkcmVuLmRlbGV0ZShjaGlsZClcblxuICAgIC8vIEZyZWUgdGhlIHdvcmtlciBzbG90IGFzIHNvb24gYXMgdGhlIGNoaWxkIGlzIGdvbmUg4oCUIG5ldmVyIGdhdGUgaXQgb24gdGhlXG4gICAgLy8gZmFpbHVyZSByZXBvcnQuIEEgaHVuZy9zbG93IHJlcG9ydCBtdXN0IG5vdCBsZWFrIHRoZSBzbG90OyBlbm91Z2ggbGVha2VkXG4gICAgLy8gc2xvdHMgZHJpdmUgYGFjY2VwdHNGb3JrZWRgIHRvIGZhbHNlIGFuZCBzaWxlbnRseSB3ZWRnZSB0aGUgd29ya2VyLlxuICAgIHJlc29sdmUodW5kZWZpbmVkKVxuXG4gICAgaWYgKHRoaXMuX2ZvcmtlZENoaWxkRXhpdGVkQ2xlYW5seSh7Y29kZSwgc2lnbmFsfSkpIHJldHVyblxuXG4gICAgY29uc3QgZXJyb3IgPSB0aW1lb3V0U3RhdGU/LnRpbWVkT3V0XG4gICAgICA/IG5ldyBFcnJvcihgRm9ya2VkIGJhY2tncm91bmQgam9iIHJ1bm5lciB0aW1lZCBvdXQgYWZ0ZXIgJHt0aW1lb3V0U3RhdGUudGltZW91dE1zfW1zIGFuZCB3YXMgdGVybWluYXRlZDogY29kZT0ke2NvZGV9IHNpZ25hbD0ke3NpZ25hbCB8fCBcIm5vbmVcIn1gKVxuICAgICAgOiBuZXcgRXJyb3IoYEZvcmtlZCBiYWNrZ3JvdW5kIGpvYiBydW5uZXIgZXhpdGVkIGJlZm9yZSByZXBvcnRpbmc6IGNvZGU9JHtjb2RlfSBzaWduYWw9JHtzaWduYWwgfHwgXCJub25lXCJ9YClcblxuICAgIHRoaXMuX3JlcG9ydEZvcmtlZENoaWxkRmFpbHVyZSh7cGF5bG9hZCwgZXJyb3J9KVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZm9ya2VkIGNoaWxkIGV4aXRlZCBjbGVhbmx5LlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIE9wdGlvbnMuXG4gICAqIEBwYXJhbSB7bnVtYmVyIHwgbnVsbH0gYXJncy5jb2RlIC0gRXhpdCBjb2RlLlxuICAgKiBAcGFyYW0ge2tleW9mIHR5cGVvZiBpbXBvcnQoXCJub2RlOm9zXCIpLmNvbnN0YW50cy5zaWduYWxzIHwgbnVsbH0gYXJncy5zaWduYWwgLSBFeGl0IHNpZ25hbC5cbiAgICogQHJldHVybnMge2Jvb2xlYW59IC0gV2hldGhlciB0aGUgY2hpbGQgZXhpdGVkIGNsZWFubHkuXG4gICAqL1xuICBfZm9ya2VkQ2hpbGRFeGl0ZWRDbGVhbmx5KHtjb2RlLCBzaWduYWx9KSB7XG4gICAgcmV0dXJuIGNvZGUgPT09IDAgJiYgIXNpZ25hbFxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgaGFuZGxlIGZvcmtlZCBjaGlsZCBlcnJvci5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBPcHRpb25zLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIm5vZGU6Y2hpbGRfcHJvY2Vzc1wiKS5DaGlsZFByb2Nlc3N9IGFyZ3MuY2hpbGQgLSBGb3JrZWQgY2hpbGQgcHJvY2Vzcy5cbiAgICogQHBhcmFtIHtFcnJvcn0gYXJncy5lcnJvciAtIENoaWxkIHByb2Nlc3MgZXJyb3IuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi90eXBlcy5qc1wiKS5CYWNrZ3JvdW5kSm9iUGF5bG9hZCAmIHtpZDogc3RyaW5nfX0gYXJncy5wYXlsb2FkIC0gUGF5bG9hZC5cbiAgICogQHBhcmFtIHsodmFsdWU6IHZvaWQpID0+IHZvaWR9IGFyZ3MucmVzb2x2ZSAtIFByb21pc2UgcmVzb2x2ZXIuXG4gICAqIEByZXR1cm5zIHt2b2lkfVxuICAgKi9cbiAgX2hhbmRsZUZvcmtlZENoaWxkRXJyb3Ioe2NoaWxkLCBlcnJvciwgcGF5bG9hZCwgcmVzb2x2ZX0pIHtcbiAgICB0aGlzLmluZmxpZ2h0UHJvY2Vzc0NoaWxkcmVuLmRlbGV0ZShjaGlsZClcbiAgICAvLyBGcmVlIHRoZSBzbG90IGZpcnN0IChzZWUgX2hhbmRsZUZvcmtlZENoaWxkRXhpdCkg4oCUIHJlcG9ydGluZyBpcyBiZXN0LWVmZm9ydC5cbiAgICByZXNvbHZlKHVuZGVmaW5lZClcbiAgICBjb25zb2xlLmVycm9yKFwiQmFja2dyb3VuZCBqb2JzIGZvcmtlZCBydW5uZXIgZXJyb3I6XCIsIGVycm9yKVxuICAgIHRoaXMuX3JlcG9ydEZvcmtlZENoaWxkRmFpbHVyZSh7cGF5bG9hZCwgZXJyb3J9KVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgc2VuZCBmb3JrZWQgcGF5bG9hZC5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBPcHRpb25zLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIm5vZGU6Y2hpbGRfcHJvY2Vzc1wiKS5DaGlsZFByb2Nlc3N9IGFyZ3MuY2hpbGQgLSBGb3JrZWQgY2hpbGQgcHJvY2Vzcy5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL3R5cGVzLmpzXCIpLkJhY2tncm91bmRKb2JQYXlsb2FkICYge2lkOiBzdHJpbmd9fSBhcmdzLnBheWxvYWQgLSBQYXlsb2FkLlxuICAgKiBAcmV0dXJucyB7dm9pZH1cbiAgICovXG4gIF9zZW5kRm9ya2VkUGF5bG9hZCh7Y2hpbGQsIHBheWxvYWR9KSB7XG4gICAgdHJ5IHtcbiAgICAgIGNoaWxkLnNlbmQoe3R5cGU6IFwiam9iXCIsIHBheWxvYWR9KVxuICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICBjaGlsZC5raWxsKFwiU0lHVEVSTVwiKVxuICAgICAgdGhpcy5fcmVwb3J0Rm9ya2VkQ2hpbGRGYWlsdXJlKHtwYXlsb2FkLCBlcnJvcn0pXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgcmVwb3J0IGZvcmtlZCBjaGlsZCBmYWlsdXJlLlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIE9wdGlvbnMuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi90eXBlcy5qc1wiKS5CYWNrZ3JvdW5kSm9iUGF5bG9hZCAmIHtpZDogc3RyaW5nfX0gYXJncy5wYXlsb2FkIC0gUGF5bG9hZC5cbiAgICogQHBhcmFtIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gYXJncy5lcnJvciAtIEVycm9yLlxuICAgKiBAcmV0dXJucyB7dm9pZH1cbiAgICovXG4gIF9yZXBvcnRGb3JrZWRDaGlsZEZhaWx1cmUoe3BheWxvYWQsIGVycm9yfSkge1xuICAgIHRoaXMuX3JlcG9ydEpvYlJlc3VsdEluQmFja2dyb3VuZCh7XG4gICAgICBqb2JJZDogcGF5bG9hZC5pZCxcbiAgICAgIHN0YXR1czogXCJmYWlsZWRcIixcbiAgICAgIGVycm9yLFxuICAgICAgaGFuZG9mZklkOiBwYXlsb2FkLmhhbmRvZmZJZCxcbiAgICAgIGhhbmRlZE9mZkF0TXM6IHBheWxvYWQuaGFuZGVkT2ZmQXRNcyxcbiAgICAgIHdvcmtlcklkOiBwYXlsb2FkLndvcmtlcklkIHx8IHRoaXMud29ya2VySWRcbiAgICB9KVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgc3Bhd24gam9iLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vdHlwZXMuanNcIikuQmFja2dyb3VuZEpvYlBheWxvYWR9IHBheWxvYWQgLSBQYXlsb2FkLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyB3aGVuIHRoZSBzcGF3bmVkIHJ1bm5lciBleGl0cyBvciBzcGF3biBmYWlscy5cbiAgICovXG4gIF9zcGF3bkpvYihwYXlsb2FkKSB7XG4gICAgY29uc3QgY29uZmlndXJhdGlvbiA9IHRoaXMuY29uZmlndXJhdGlvblxuICAgIGlmICghY29uZmlndXJhdGlvbikgdGhyb3cgbmV3IEVycm9yKFwiQmFja2dyb3VuZCBqb2JzIHdvcmtlciBjb25maWd1cmF0aW9uIG5vdCBpbml0aWFsaXplZFwiKVxuXG4gICAgY29uc3QgZGlyZWN0b3J5ID0gY29uZmlndXJhdGlvbi5nZXREaXJlY3RvcnkoKVxuICAgIGNvbnN0IGFyZ3ZDb21tYW5kID0gcHJvY2Vzcy5hcmd2WzFdXG4gICAgY29uc3QgY29tbWFuZCA9IGFyZ3ZDb21tYW5kID8gYXJndkNvbW1hbmQgOiBgJHtkaXJlY3Rvcnl9L2Jpbi92ZWxvY2lvdXMuanNgXG4gICAgY29uc3QgZW5jb2RlZFBheWxvYWQgPSBCdWZmZXIuZnJvbShKU09OLnN0cmluZ2lmeShwYXlsb2FkKSkudG9TdHJpbmcoXCJiYXNlNjRcIilcbiAgICBjb25zdCBjaGlsZCA9IHNwYXduKHByb2Nlc3MuZXhlY1BhdGgsIFtjb21tYW5kLCBcImJhY2tncm91bmQtam9icy1ydW5uZXJcIl0sIHtcbiAgICAgIGN3ZDogZGlyZWN0b3J5LFxuICAgICAgZGV0YWNoZWQ6IHRydWUsXG4gICAgICBzdGRpbzogXCJpZ25vcmVcIixcbiAgICAgIGVudjogT2JqZWN0LmFzc2lnbih7fSwgcHJvY2Vzcy5lbnYsIHRoaXMuX2NoaWxkQmFja2dyb3VuZEpvYnNFbnZpcm9ubWVudCgpLCB7VkVMT0NJT1VTX0pPQl9QQVlMT0FEOiBlbmNvZGVkUGF5bG9hZH0pXG4gICAgfSlcblxuICAgIHRoaXMuaW5mbGlnaHRQcm9jZXNzQ2hpbGRyZW4uYWRkKGNoaWxkKVxuXG4gICAgY29uc3QgZmluaXNoZWQgPSBuZXcgUHJvbWlzZSgocmVzb2x2ZSkgPT4ge1xuICAgICAgY2hpbGQub25jZShcImV4aXRcIiwgKCkgPT4ge1xuICAgICAgICB0aGlzLmluZmxpZ2h0UHJvY2Vzc0NoaWxkcmVuLmRlbGV0ZShjaGlsZClcbiAgICAgICAgcmVzb2x2ZSh1bmRlZmluZWQpXG4gICAgICB9KVxuICAgICAgY2hpbGQub25jZShcImVycm9yXCIsIChlcnJvcikgPT4ge1xuICAgICAgICB0aGlzLmluZmxpZ2h0UHJvY2Vzc0NoaWxkcmVuLmRlbGV0ZShjaGlsZClcbiAgICAgICAgY29uc29sZS5lcnJvcihcIkJhY2tncm91bmQgam9icyBzcGF3bmVkIHJ1bm5lciBlcnJvcjpcIiwgZXJyb3IpXG4gICAgICAgIHJlc29sdmUodW5kZWZpbmVkKVxuICAgICAgfSlcbiAgICB9KVxuXG4gICAgY2hpbGQudW5yZWYoKVxuXG4gICAgcmV0dXJuIGZpbmlzaGVkXG4gIH1cblxuICAvKipcbiAgICogQnVpbGRzIHRoZSBleGFjdCBtYWluIGVuZHBvaW50IGFuZCBnZW5lcmF0aW9uIGluaGVyaXRlZCBieSBldmVyeSBjaGlsZC5cbiAgICogQHJldHVybnMge1JlY29yZDxzdHJpbmcsIHN0cmluZz59IC0gQ2hpbGQgcHJvY2VzcyBlbnZpcm9ubWVudCBhZGRpdGlvbnMuXG4gICAqL1xuICBfY2hpbGRCYWNrZ3JvdW5kSm9ic0Vudmlyb25tZW50KCkge1xuICAgIGNvbnN0IGNvbmZpZ3VyYXRpb24gPSB0aGlzLmNvbmZpZ3VyYXRpb25cbiAgICBpZiAoIWNvbmZpZ3VyYXRpb24pIHRocm93IG5ldyBFcnJvcihcIkJhY2tncm91bmQgam9icyB3b3JrZXIgY29uZmlndXJhdGlvbiBub3QgaW5pdGlhbGl6ZWRcIilcbiAgICBpZiAoIXRoaXMuaG9zdCB8fCB0eXBlb2YgdGhpcy5wb3J0ICE9PSBcIm51bWJlclwiKSB0aHJvdyBuZXcgRXJyb3IoXCJCYWNrZ3JvdW5kIGpvYnMgd29ya2VyIGVuZHBvaW50IG5vdCByZXNvbHZlZFwiKVxuXG4gICAgcmV0dXJuIHtcbiAgICAgIFZFTE9DSU9VU19CQUNLR1JPVU5EX0pPQl9DSElMRDogXCIxXCIsXG4gICAgICBWRUxPQ0lPVVNfRU5WOiBjb25maWd1cmF0aW9uLmdldEVudmlyb25tZW50KCksXG4gICAgICBWRUxPQ0lPVVNfQkFDS0dST1VORF9KT0JTX0hPU1Q6IHRoaXMuaG9zdCxcbiAgICAgIFZFTE9DSU9VU19CQUNLR1JPVU5EX0pPQlNfUE9SVDogYCR7dGhpcy5wb3J0fWAsXG4gICAgICAuLi4odGhpcy5nZW5lcmF0aW9uSWQgPyB7VkVMT0NJT1VTX0JBQ0tHUk9VTkRfSk9CU19HRU5FUkFUSU9OX0lEOiB0aGlzLmdlbmVyYXRpb25JZH0gOiB7fSlcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogUnVucyByZXBvcnQgam9iIHJlc3VsdC5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBPcHRpb25zLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gYXJncy5qb2JJZCAtIEpvYiBpZC5cbiAgICogQHBhcmFtIHtcImNvbXBsZXRlZFwiIHwgXCJmYWlsZWRcIiB8IFwicmVzY2hlZHVsZWRcIn0gYXJncy5zdGF0dXMgLSBTdGF0dXMuXG4gICAqIEBwYXJhbSB7bnVtYmVyfSBbYXJncy5kZWxheU1zXSAtIFJlc2NoZWR1bGUgZGVsYXkgaW4gbWlsbGlzZWNvbmRzLlxuICAgKiBAcGFyYW0ge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSBbYXJncy5lcnJvcl0gLSBFcnJvci5cbiAgICogQHBhcmFtIHtzdHJpbmd9IFthcmdzLmhhbmRvZmZJZF0gLSBIYW5kb2ZmIGxlYXNlIGlkLlxuICAgKiBAcGFyYW0ge251bWJlcn0gW2FyZ3MuaGFuZGVkT2ZmQXRNc10gLSBIYW5kZWQgb2ZmIHRpbWVzdGFtcC5cbiAgICogQHBhcmFtIHtzdHJpbmd9IFthcmdzLndvcmtlcklkXSAtIFdvcmtlciBpZC5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgd2hlbiByZXBvcnRlZC5cbiAgICovXG4gIGFzeW5jIF9yZXBvcnRKb2JSZXN1bHQoe2pvYklkLCBzdGF0dXMsIGRlbGF5TXMsIGVycm9yLCBoYW5kb2ZmSWQsIGhhbmRlZE9mZkF0TXMsIHdvcmtlcklkfSkge1xuICAgIGlmICghdGhpcy5zdGF0dXNSZXBvcnRlcikgcmV0dXJuXG5cbiAgICB0cnkge1xuICAgICAgLy8gUmV0cnkgYSB0cmFuc2llbnQgcGVyc2lzdCBmYWlsdXJlIChgam9iLXVwZGF0ZS1lcnJvcmApOiB0aGUgd29ya2VyIGlzXG4gICAgICAvLyBsb25nLWxpdmVkIGFuZCBjYW5ub3QgZXhpdCB0byB0cmlnZ2VyIG9ycGhhbiByZWNsYWltLCBzbyBkcm9wcGluZyB0aGVcbiAgICAgIC8vIGNvbXBsZXRpb24gaGVyZSB3b3VsZCBzdHJhbmQgdGhlIGpvYiBpbiBgaGFuZGVkX29mZmAgZm9yZXZlciDigJQgZmF0YWwgZm9yIGFcbiAgICAgIC8vIGBtYXhfY29uY3VycmVuY3k6IDFgIGpvYiAoYSBzdHJhbmRlZCByb3cgYmxvY2tzIGV2ZXJ5IGZ1dHVyZSBydW4pLlxuICAgICAgYXdhaXQgdGhpcy5zdGF0dXNSZXBvcnRlci5yZXBvcnRXaXRoUmV0cnkoe2pvYklkLCBzdGF0dXMsIGRlbGF5TXMsIGVycm9yLCBoYW5kb2ZmSWQsIGhhbmRlZE9mZkF0TXMsIHdvcmtlcklkLCByZXRyeVBlcnNpc3RFcnJvcnM6IHRydWV9KVxuICAgIH0gY2F0Y2ggKHJlcG9ydEVycm9yKSB7XG4gICAgICBjb25zb2xlLmVycm9yKFwiQmFja2dyb3VuZCBqb2Igc3RhdHVzIHJlcG9ydGluZyBmYWlsZWQ6XCIsIHJlcG9ydEVycm9yKVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBGaXJlcyBhIGR1cmFibGUgam9iLXJlc3VsdCByZXBvcnQgd2l0aG91dCBibG9ja2luZyB0aGUgY2FsbGVyIChzbyBmcmVlaW5nIGFcbiAgICogam9iL2NoaWxkIHNsb3QgbmV2ZXIgd2FpdHMgb24gdGhlIHJlcG9ydCkuIFRoZSByZXBvcnQgaXMgdHJhY2tlZCBzbyBhXG4gICAqIGdyYWNlZnVsIGBzdG9wKClgIGNhbiBkcmFpbiBpbi1mbGlnaHQgcmVwb3J0cyBiZWZvcmUgY2xvc2luZyB0aGUgc29ja2V0LlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIE9wdGlvbnMuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBhcmdzLmpvYklkIC0gSm9iIGlkLlxuICAgKiBAcGFyYW0ge1wiY29tcGxldGVkXCIgfCBcImZhaWxlZFwiIHwgXCJyZXNjaGVkdWxlZFwifSBhcmdzLnN0YXR1cyAtIFN0YXR1cy5cbiAgICogQHBhcmFtIHtudW1iZXJ9IFthcmdzLmRlbGF5TXNdIC0gUmVzY2hlZHVsZSBkZWxheSBpbiBtaWxsaXNlY29uZHMuXG4gICAqIEBwYXJhbSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59IFthcmdzLmVycm9yXSAtIEVycm9yLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gW2FyZ3MuaGFuZG9mZklkXSAtIEhhbmRvZmYgbGVhc2UgaWQuXG4gICAqIEBwYXJhbSB7bnVtYmVyfSBbYXJncy5oYW5kZWRPZmZBdE1zXSAtIEhhbmRlZCBvZmYgdGltZXN0YW1wLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gW2FyZ3Mud29ya2VySWRdIC0gV29ya2VyIGlkLlxuICAgKiBAcmV0dXJucyB7dm9pZH1cbiAgICovXG4gIF9yZXBvcnRKb2JSZXN1bHRJbkJhY2tncm91bmQoe2pvYklkLCBzdGF0dXMsIGRlbGF5TXMsIGVycm9yLCBoYW5kb2ZmSWQsIGhhbmRlZE9mZkF0TXMsIHdvcmtlcklkfSkge1xuICAgIC8qKlxuICAgICAqIERlZmluZXMgcmVwb3J0LlxuICAgICAqIEB0eXBlIHtQcm9taXNlPHZvaWQ+fSAqL1xuICAgIGxldCByZXBvcnRcblxuICAgIHJlcG9ydCA9IHRoaXMuX3JlcG9ydEpvYlJlc3VsdCh7am9iSWQsIHN0YXR1cywgZGVsYXlNcywgZXJyb3IsIGhhbmRvZmZJZCwgaGFuZGVkT2ZmQXRNcywgd29ya2VySWR9KS5maW5hbGx5KCgpID0+IHtcbiAgICAgIHRoaXMuaW5mbGlnaHRSZXBvcnRzLmRlbGV0ZShyZXBvcnQpXG4gICAgfSlcblxuICAgIHRoaXMuaW5mbGlnaHRSZXBvcnRzLmFkZChyZXBvcnQpXG4gIH1cbn1cbiJdfQ==