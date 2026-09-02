// @ts-check
import { randomUUID } from "crypto";
import net from "net";
import JsonSocket from "./json-socket.js";
import BackgroundJobsScheduler from "./scheduler.js";
import Logger from "../logger.js";
import PruneTerminalBackgroundJobsJob from "../jobs/prune-terminal-background-jobs.js";
import VelociousError from "../velocious-error.js";
import shutdownLifecycle, { runShutdownSteps } from "../utils/shutdown-lifecycle.js";
import { validateGenerationId, workerIdBelongsToGeneration } from "./generation-identity.js";
import BackgroundJobsLifecycleControlServer from "./lifecycle-control-server.js";
/**
 * WorkerExecutionModeCapability type.
 * @typedef {object} WorkerExecutionModeCapability
 * @property {import("./types.js").BackgroundJobExecutionMode} executionMode - Execution mode.
 * @property {(worker: JsonSocket) => boolean} accepts - Whether the worker accepts this mode.
 */
/**
 * Channel used by `background-jobs-main` to coordinate dispatch wake-ups
 * across processes via Beacon. Workers do NOT subscribe to this channel
 * — they already receive job-handoff messages on their JsonSocket to
 * main; this channel exists so cross-process enqueues (or future
 * multi-main deployments) can poke an idle main to drain.
 */
const DISPATCH_CHANNEL = "velocious-background-jobs-dispatch";
/**
 * `setTimeout` is implemented with 32-bit signed delays on Node; passing
 * anything larger silently clamps to 1ms and fires immediately. Cap the
 * scheduled-job timer here and re-arm when it expires.
 */
const MAX_TIMER_MS = 2_147_483_647; // ~24.8 days
/** A worker silent (no heartbeat/ready/report) longer than this is dropped. */
const WORKER_STALE_TIMEOUT_MS = 60000;
/** How often the main scans workers for staleness. */
const WORKER_LIVENESS_SWEEP_MS = 15000;
/** Grace for workers from the previous main generation to reconnect and adopt leases. */
const WORKER_RECONNECT_GRACE_MS = 30000;
const GENERATION_ORPHANED_AFTER_MS = 60 * 60 * 1000;
const WORKER_RECONNECT_GRACE_VALIDATION_MESSAGE = `workerReconnectGraceMs must be an integer between 0 and ${MAX_TIMER_MS}`;
/**
 * Resolves a startup reconnect grace without allowing Node's timer overflow to
 * turn an intentionally long grace into an immediate reclaim.
 * @param {number | undefined} workerReconnectGraceMs - Requested reconnect grace.
 * @returns {number} - Valid timer delay.
 */
function normalizeWorkerReconnectGraceMs(workerReconnectGraceMs) {
    if (workerReconnectGraceMs === undefined)
        return WORKER_RECONNECT_GRACE_MS;
    if (!Number.isInteger(workerReconnectGraceMs) || workerReconnectGraceMs < 0 || workerReconnectGraceMs > MAX_TIMER_MS) {
        throw new TypeError(WORKER_RECONNECT_GRACE_VALIDATION_MESSAGE);
    }
    return workerReconnectGraceMs;
}
/**
 * Worker execution mode capabilities.
 * @type {WorkerExecutionModeCapability[]} */
const WORKER_EXECUTION_MODE_CAPABILITIES = [
    { executionMode: "inline", accepts: (worker) => worker.acceptsInlineJobs !== false },
    { executionMode: "forked", accepts: (worker) => worker.acceptsForkedJobs !== false },
    // Pooled is opt-in: only workers that explicitly advertise `acceptsPooled`
    // receive pooled jobs. The `=== true` (rather than `!== false`) check keeps a
    // pre-pooled worker — which never sends the field — out of the pooled-capable
    // set, so the main never dispatches a pooled job to a worker that cannot run
    // one. This is the conservative half of the extended readiness protocol.
    { executionMode: "pooled", accepts: (worker) => worker.acceptsPooledJobs === true && (!worker.usesPooledCapacityCredits || worker.availablePooledSlots > 0) },
    { executionMode: "spawned", accepts: (worker) => worker.acceptsSpawnedJobs !== false }
];
const WORKER_EXECUTION_MODE_CAPABILITIES_BY_MODE = new Map(WORKER_EXECUTION_MODE_CAPABILITIES.map((capability) => [capability.executionMode, capability]));
export default class BackgroundJobsMain {
    /**
     * Runs constructor.
     * @param {object} args - Options.
     * @param {import("../configuration.js").default} args.configuration - Configuration.
     * @param {string} [args.host] - Hostname.
     * @param {number} [args.port] - Port.
     * @param {string} [args.generationId] - Explicit release generation identity.
     * @param {import("./types.js").BackgroundJobsGenerationInitialState} [args.initialGenerationState] - Explicit generation boot state.
     * @param {string} [args.lifecycleSocketPath] - Explicit lifecycle socket path.
     * @param {number} [args.workerStaleTimeoutMs] - Override how long a silent worker may go before being dropped (default 60000ms).
     * @param {number} [args.workerLivenessSweepMs] - Override how often stale workers are swept for (default 15000ms).
     * @param {number} [args.workerReconnectGraceMs] - Integer from 0 through 2,147,483,647 overriding how long previous-generation workers may reconnect before exact startup leases are reclaimed (default 30000ms).
     * @param {boolean} [args.closeDatabaseConnectionsOnStop] - Whether stop owns closing the configuration's database pools (default true).
     * @param {() => void | Promise<void>} [args.onStopped] - Lifecycle hook invoked after the main process finishes stopping.
     * @param {(args: {handoff: import("./types.js").BackgroundJobHandoff, job: import("./types.js").BackgroundJobRow}) => void | Promise<void>} [args.afterHandoffClaim] - Explicit handoff-claim observation hook.
     * @param {(worker: JsonSocket) => void} [args.onWorkerReady] - Explicit readiness observation hook.
     * @param {(worker: JsonSocket) => void} [args.onWorkerHeartbeat] - Explicit heartbeat observation hook.
     * @param {(workerId: string) => void} [args.onWorkerDisconnected] - Explicit generation disconnect observation hook.
     * @param {(workerId: string) => void} [args.onWorkerHandoffsReleased] - Explicit grace-expiry observation hook.
     * @param {(jobs: import("./types.js").BackgroundJobRow[]) => void} [args.onStartupHandoffsReclaimed] - Explicit startup reclaim observation hook.
     * @param {(args: {accepted: boolean, jobId: string, status: "completed" | "failed" | "rescheduled"}) => void} [args.onJobUpdated] - Explicit durable report observation hook.
     * @param {{now: () => number, setTimeout?: (callback: () => void, delayMs: number) => ReturnType<typeof setTimeout> | number, clearTimeout?: (timerId: ReturnType<typeof setTimeout> | number) => void}} [args.clock] - Injectable wall clock for deterministic lifecycle tests.
     */
    constructor({ configuration, host, port, generationId: explicitGenerationId, initialGenerationState: explicitInitialGenerationState, lifecycleSocketPath: explicitLifecycleSocketPath, workerStaleTimeoutMs, workerLivenessSweepMs, workerReconnectGraceMs, closeDatabaseConnectionsOnStop = true, onStopped, afterHandoffClaim, onWorkerReady, onWorkerHeartbeat, onWorkerDisconnected, onWorkerHandoffsReleased, onStartupHandoffsReclaimed, onJobUpdated, clock }) {
        this.configuration = configuration;
        this.closeDatabaseConnectionsOnStop = closeDatabaseConnectionsOnStop;
        this.onStopped = onStopped;
        this.afterHandoffClaim = afterHandoffClaim;
        this.onWorkerReady = onWorkerReady;
        this.onWorkerHeartbeat = onWorkerHeartbeat;
        this.onWorkerDisconnected = onWorkerDisconnected;
        this.onWorkerHandoffsReleased = onWorkerHandoffsReleased;
        this.onStartupHandoffsReclaimed = onStartupHandoffsReclaimed;
        this.onJobUpdated = onJobUpdated;
        this.clock = {
            clearTimeout: clock?.clearTimeout || ((timerId) => clearTimeout(timerId)),
            now: clock?.now || (() => Date.now()),
            setTimeout: clock?.setTimeout || ((callback, delayMs) => setTimeout(callback, delayMs))
        };
        const config = configuration.getBackgroundJobsConfig();
        const generationConfig = configuration.resolveBackgroundJobsGenerationConfig({
            generationId: explicitGenerationId,
            initialGenerationState: explicitInitialGenerationState,
            lifecycleSocketPath: explicitLifecycleSocketPath,
            sourceName: "BackgroundJobsMain"
        });
        this.generationId = generationConfig.generationId;
        this.initialGenerationState = generationConfig.initialGenerationState;
        this.lifecycleSocketPath = generationConfig.lifecycleSocketPath;
        /** @type {import("./types.js").BackgroundJobsGenerationLifecycleState} */
        this.lifecycleState = "starting";
        this._activeOwnershipReady = false;
        /** @type {Promise<void> | undefined} */
        this._activationPromise = undefined;
        /** @type {Promise<void> | undefined} */
        this._retirementPromise = undefined;
        /** @type {Set<JsonSocket>} */
        this.candidateReadyWorkers = new Set();
        /** @type {Map<string, {worker: JsonSocket, timer: ReturnType<typeof setTimeout> | number}>} */
        this.disconnectedWorkers = new Map();
        this._lifecycleRequestLeases = 0;
        this._activeNonWorkerRequests = 0;
        /**
         * Resolves stop observation.
         * @type {() => void}
         */
        this._resolveStopped = () => { };
        this._stoppedPromise = new Promise((/** @type {(value: void) => void} */ resolve) => { this._resolveStopped = resolve; });
        this.host = host || config.host;
        this.port = typeof port === "number" ? port : config.port;
        this.dispatchStrategy = config.dispatchStrategy;
        this.pollIntervalMs = config.pollIntervalMs;
        this.retention = config.retention;
        // A worker that stops sending anything (heartbeat/ready/report) for this
        // long is treated as wedged/dead: its leases are released and it is dropped.
        this.workerStaleTimeoutMs = typeof workerStaleTimeoutMs === "number" && workerStaleTimeoutMs >= 1 ? workerStaleTimeoutMs : WORKER_STALE_TIMEOUT_MS;
        this.workerLivenessSweepMs = typeof workerLivenessSweepMs === "number" && workerLivenessSweepMs >= 1 ? workerLivenessSweepMs : WORKER_LIVENESS_SWEEP_MS;
        this.workerReconnectGraceMs = normalizeWorkerReconnectGraceMs(workerReconnectGraceMs);
        /** @type {import("./adapter.js").default | undefined} */
        this.adapter = undefined;
        this.logger = new Logger(this);
        /**
         * Narrows the runtime value to the documented type.
         * @type {Set<JsonSocket>} */
        this.workers = new Set();
        /** @type {Set<JsonSocket>} */
        this.connections = new Set();
        /**
         * Narrows the runtime value to the documented type.
         * @type {Set<JsonSocket>} */
        this.readyWorkers = new Set();
        /**
         * Active durable handoffs keyed by the exact worker socket that received them.
         * @type {Map<JsonSocket, Map<string, string>>} */
        this.workerHandoffs = new Map();
        /**
         * Exact caller-generated leases whose claim outcome was ambiguous or whose
         * pre-dispatch release has not yet been acknowledged. Retained until a
         * fenced return succeeds (including an exact no-op).
         * @type {Map<string, string>} */
        this.pendingHandoffRecoveries = new Map();
        /**
         * Handoff-adoption queries started by worker hello messages. Shutdown must
         * wait for these before closing the configuration's database pools.
         * @type {Set<Promise<void>>} */
        this.inflightWorkerHandoffAdoptions = new Set();
        /**
         * Worker ids whose handoffs were successfully adopted by a still-live
         * connection in this main generation.
         * @type {Set<string>}
         */
        this.reconnectedWorkerIds = new Set();
        /** @type {import("./types.js").BackgroundJobHandoffSnapshot[]} */
        this.startupHandoffSnapshot = [];
        /** @type {Promise<void>[]} */
        this._startupHandoffAdoptionsAtDeadline = [];
        this._startupHandoffGraceElapsed = false;
        /**
         * Narrows the runtime value to the documented type.
         * @type {net.Server | undefined} */
        this.server = undefined;
        /**
         * Narrows the runtime value to the documented type.
         * @type {ReturnType<typeof setTimeout> | undefined} */
        this._pollTimer = undefined;
        /**
         * Narrows the runtime value to the documented type.
         * @type {ReturnType<typeof setTimeout> | undefined} */
        this._scheduledTimer = undefined;
        /**
         * Narrows the runtime value to the documented type.
         * @type {ReturnType<typeof setTimeout> | undefined} */
        this._errorRetryTimer = undefined;
        /**
         * Narrows the runtime value to the documented type.
         * @type {ReturnType<typeof setTimeout> | undefined} */
        this._orphanTimer = undefined;
        /**
         * Narrows the runtime value to the documented type.
         * @type {ReturnType<typeof setInterval> | undefined} */
        this._workerStaleTimer = undefined;
        /** @type {ReturnType<typeof setTimeout> | number | undefined} */
        this._startupHandoffReclaimTimer = undefined;
        /** @type {Promise<void> | undefined} */
        this._startupHandoffReclaimPromise = undefined;
        /**
         * Narrows the runtime value to the documented type.
         * @type {BackgroundJobsScheduler | undefined} */
        this.scheduler = undefined;
        this._draining = false;
        this._redrainQueued = false;
        /** @type {Promise<void> | undefined} */
        this._drainPromise = undefined;
        this._stopped = false;
        /** @type {Promise<void> | undefined} */
        this.stopPromise = undefined;
        /**
         * Narrows the runtime value to the documented type.
         * @type {(() => void) | undefined} */
        this._unsubscribeBeacon = undefined;
        /**
         * Narrows the runtime value to the documented type.
         * @type {((...args: Array<ReturnType<typeof JSON.parse>>) => void) | undefined} */
        this._beaconConnectHandler = undefined;
        /**
         * Narrows the runtime value to the documented type.
         * @type {import("../beacon/client.js").default | import("../beacon/in-process-client.js").default | undefined} */
        this._beaconClient = undefined;
        /** @type {BackgroundJobsLifecycleControlServer | undefined} */
        this.lifecycleControlServer = undefined;
    }
    /**
     * Compatibility alias for integrations that inspect the active main store.
     * @returns {import("./adapter.js").default} - Adapter acquired by start.
     */
    get store() {
        if (!this.adapter)
            throw new Error("Background jobs main has not acquired its adapter");
        return this.adapter;
    }
    /**
     * Preserves the historical subclass seam while keeping one adapter reference.
     * @param {import("./adapter.js").default} adapter - Adapter to assign.
     */
    set store(adapter) {
        this.adapter = adapter;
    }
    /**
     * Runs start.
     * @returns {Promise<void>} - Resolves when listening.
     */
    async start() {
        this._stopped = false;
        this.stopPromise = undefined;
        this._activeOwnershipReady = false;
        this.lifecycleState = "starting";
        this._stoppedPromise = new Promise((/** @type {(value: void) => void} */ resolve) => { this._resolveStopped = resolve; });
        this.reconnectedWorkerIds.clear();
        this.startupHandoffSnapshot = [];
        this._startupHandoffAdoptionsAtDeadline = [];
        this._startupHandoffGraceElapsed = false;
        this._startupHandoffReclaimPromise = undefined;
        this.configuration.setCurrent();
        try {
            await this.configuration.initialize({ type: "background-jobs-main" });
            await this.configuration.connectBeacon({ peerType: "background-jobs-main" });
            if (!this.adapter) {
                this.adapter = await this.configuration.acquireReadyBackgroundJobsAdapter();
            }
            if (this.generationId && !this.adapter.supportsReleaseScopedGenerations()) {
                throw new Error("The configured background jobs adapter does not support release-scoped generations");
            }
            if (!this.generationId || this.initialGenerationState !== "candidate") {
                this.startupHandoffSnapshot = await this._generationOwnedHandoffSnapshot();
            }
            const server = net.createServer((socket) => this._handleConnection(socket));
            this.server = server;
            await new Promise((resolve, reject) => {
                server.once("error", reject);
                server.listen(this.port, this.host, () => resolve(undefined));
            });
            const address = server.address();
            if (address && typeof address === "object") {
                this.port = address.port;
            }
            this.lifecycleState = this.generationId ? this.initialGenerationState : "active";
            if (this.generationId && this.lifecycleSocketPath) {
                this.lifecycleControlServer = new BackgroundJobsLifecycleControlServer({
                    configuration: this.configuration,
                    generationId: this.generationId,
                    main: this,
                    socketPath: this.lifecycleSocketPath
                });
                await this.lifecycleControlServer.start();
            }
            this._workerStaleTimer = setInterval(() => {
                void this._sweepStaleWorkers();
            }, this.workerLivenessSweepMs);
            if (this.lifecycleState === "active") {
                await this._startActiveOwnership();
            }
            else if (this.lifecycleState === "retired") {
                this._startGenerationRecoveryOwnership();
            }
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
                throw new AggregateError([error, cleanupError], "Background jobs main startup and cleanup failed", { cause: error });
            }
            throw error;
        }
    }
    /**
     * Runs stop.
     * @returns {Promise<void>} - Resolves when closed.
     */
    stop() {
        if (!this.stopPromise)
            this.stopPromise = this._stop();
        return this.stopPromise;
    }
    /**
     * Runs the main-process shutdown lifecycle once.
     * @returns {Promise<void>} - Resolves when closed.
     */
    async _stop() {
        this._stopped = true;
        try {
            await shutdownLifecycle({
                onStopped: this.onStopped,
                shutdown: async () => {
                    this._closeWorkers();
                    this._clearTimers();
                    this._disconnectBeaconHandlers();
                    try {
                        await this.scheduler?.stop();
                        if (this._drainPromise)
                            await this._drainPromise;
                    }
                    finally {
                        try {
                            await this._drainWorkerHandoffAdoptions();
                        }
                        finally {
                            try {
                                await this._drainStartupHandoffReclaim();
                            }
                            finally {
                                await this._stopBeaconAndServer();
                            }
                        }
                    }
                }
            });
        }
        finally {
            this.adapter = undefined;
            this.lifecycleState = "stopped";
            this._resolveStopped();
        }
    }
    /**
     * Runs close workers.
     * @returns {void} */
    _closeWorkers() {
        for (const connection of this.connections) {
            connection.close();
        }
    }
    /**
     * Runs clear timers.
     * @returns {void} */
    _clearTimers() {
        if (this._pollTimer)
            clearInterval(this._pollTimer);
        if (this._scheduledTimer)
            clearTimeout(this._scheduledTimer);
        if (this._errorRetryTimer)
            clearTimeout(this._errorRetryTimer);
        if (this._orphanTimer)
            clearInterval(this._orphanTimer);
        if (this._workerStaleTimer)
            clearInterval(this._workerStaleTimer);
        if (this._startupHandoffReclaimTimer)
            this.clock.clearTimeout(this._startupHandoffReclaimTimer);
        for (const { timer } of this.disconnectedWorkers.values())
            this.clock.clearTimeout(timer);
        this.disconnectedWorkers.clear();
        this._pollTimer = undefined;
        this._scheduledTimer = undefined;
        this._errorRetryTimer = undefined;
        this._orphanTimer = undefined;
        this._workerStaleTimer = undefined;
        this._startupHandoffReclaimTimer = undefined;
    }
    /**
     * Runs disconnect beacon handlers.
     * @returns {void} */
    _disconnectBeaconHandlers() {
        if (this._unsubscribeBeacon) {
            this._unsubscribeBeacon();
            this._unsubscribeBeacon = undefined;
        }
        if (this._beaconClient && this._beaconConnectHandler) {
            this._beaconClient.off("connect", this._beaconConnectHandler);
        }
        this._beaconConnectHandler = undefined;
        this._beaconClient = undefined;
    }
    /**
     * Runs stop beacon and server.
     * @returns {Promise<void>} */
    async _stopBeaconAndServer() {
        await runShutdownSteps({
            message: "Background jobs main application and framework shutdown failed",
            steps: [
                async () => {
                    try {
                        await this.lifecycleControlServer?.close();
                    }
                    finally {
                        this.lifecycleControlServer = undefined;
                    }
                },
                ...(this.closeDatabaseConnectionsOnStop
                    ? [async () => await this.configuration.shutdown()]
                    : []),
                async () => await this.configuration.disconnectBeacon(),
                async () => await this._closeServer(),
                async () => {
                    if (this.closeDatabaseConnectionsOnStop) {
                        await this.configuration.closeDatabaseConnections();
                    }
                    else {
                        await this.configuration.closeBackgroundJobsAdapter();
                    }
                }
            ]
        });
    }
    /**
     * Runs close server.
     * @returns {Promise<void>} */
    async _closeServer() {
        if (!this.server)
            return;
        const { server } = this;
        this.server = undefined;
        await new Promise((resolve) => server.close(() => resolve(undefined)));
    }
    /**
     * Runs get port.
     * @returns {number} - Bound port.
     */
    getPort() {
        return this.port;
    }
    /**
     * Gets the lifecycle state.
     * @returns {import("./types.js").BackgroundJobsGenerationLifecycleState} - Current lifecycle state.
     */
    getLifecycleState() { return this.lifecycleState; }
    /**
     * Returns a promise that settles only after the main has fully stopped.
     * @returns {Promise<void>} - Stop completion.
     */
    async waitUntilStopped() { await this._stoppedPromise; }
    /**
     * Snapshots only exact durable owners from this release generation.
     * Legacy mode intentionally retains its historical global snapshot.
     * @returns {Promise<import("./types.js").BackgroundJobHandoffSnapshot[]>} - Owned snapshot.
     */
    async _generationOwnedHandoffSnapshot() {
        const handoffs = await this.store.snapshotHandedOffJobs();
        if (!this.generationId)
            return handoffs;
        const generationId = this.generationId;
        return handoffs.filter(({ workerId }) => workerIdBelongsToGeneration({ generationId, workerId }));
    }
    /**
     * Acquires scheduling and dispatch ownership for an active generation.
     * @returns {Promise<void>} - Resolves after active ownership is established.
     */
    async _startActiveOwnership() {
        await this.store.reconcileQueueConcurrency();
        this._setupDispatchTriggers();
        this._setupStartupHandoffReclaim();
        this._startOrphanSweep();
        await this._startScheduler();
        this._activeOwnershipReady = true;
        this._creditReadyWorkers();
        await this._drain();
    }
    /** Starts exact recovery duties without acquiring global dispatch ownership. */
    _startGenerationRecoveryOwnership() {
        this._setupStartupHandoffReclaim();
        this._startOrphanSweep();
        this._maybeStopRetired();
    }
    /** Starts the generation-fenced orphan sweep. */
    _startOrphanSweep() {
        if (this._orphanTimer)
            return;
        this._orphanTimer = setInterval(() => { void this._sweepOrphans(); }, 60000);
    }
    /**
     * Starts schedule ownership exactly once.
     * @returns {Promise<void>} - Resolves after schedules are loaded.
     */
    async _startScheduler() {
        if (this.scheduler)
            return;
        this.scheduler = new BackgroundJobsScheduler({
            configuration: this.configuration,
            enqueueJob: async ({ args, jobClass, options }) => {
                await this.store.enqueue({
                    jobName: jobClass.jobName(),
                    args,
                    options: jobClass._withJobContext({ jobArgs: args, jobOptions: options })
                });
                this._notifyEnqueued();
                void this._drain();
            }
        });
        await this.scheduler.start();
        const retentionSchedule = PruneTerminalBackgroundJobsJob.scheduleConfiguration(this.retention);
        if (retentionSchedule) {
            this.scheduler.scheduleJob({ jobConfiguration: retentionSchedule, jobKey: "velociousPruneTerminalBackgroundJobs" });
        }
    }
    /** Credits readiness advertisements recorded while dispatch was fenced. */
    _creditReadyWorkers() {
        for (const worker of this.candidateReadyWorkers) {
            if (this.workers.has(worker) && !worker.isDraining && worker.supportsHandoffIdReporting) {
                this.readyWorkers.add(worker);
            }
        }
        this.candidateReadyWorkers.clear();
    }
    /**
     * Activates a candidate after its supervisor has retired the old generation.
     * @returns {Promise<void>} - Resolves after scheduling and dispatch are active.
     */
    activate() {
        if (!this.generationId)
            throw new Error("Background jobs generation activation requires generation mode");
        if (this.lifecycleState === "active")
            return Promise.resolve();
        if (this.lifecycleState !== "candidate")
            throw new Error(`Cannot activate background jobs generation from ${this.lifecycleState}`);
        if (!this._activationPromise)
            this._activationPromise = this._activate();
        return this._activationPromise;
    }
    /**
     * Runs activation.
     * @returns {Promise<void>} - Activation completion.
     */
    async _activate() {
        this.logger.info(() => ["Background jobs generation activation starting", { generationId: this.generationId }]);
        await this._startActiveOwnership();
        this.lifecycleState = "active";
        this._creditReadyWorkers();
        this.logger.info(() => ["Background jobs generation activation acknowledged", { generationId: this.generationId }]);
        void this._drain().catch((error) => {
            this.logger.error(() => ["Background jobs generation post-activation drain failed", { error, generationId: this.generationId }]);
        });
    }
    /**
     * Establishes the synchronous retirement fence and then drains ownership setup.
     * @returns {Promise<void>} - Resolves after the retirement fence is durable in memory.
     */
    retire() {
        if (!this.generationId)
            throw new Error("Background jobs generation retirement requires generation mode");
        if (this.lifecycleState === "retiring" || this.lifecycleState === "retired")
            return Promise.resolve();
        if (this.lifecycleState !== "active")
            throw new Error(`Cannot retire background jobs generation from ${this.lifecycleState}`);
        this.lifecycleState = "retiring";
        this._activeOwnershipReady = false;
        this.readyWorkers.clear();
        this.candidateReadyWorkers.clear();
        this._clearDispatchTimers();
        this._disconnectBeaconHandlers();
        this._retirementPromise = this._retire();
        void this._retirementPromise.catch((error) => this._reportConnectionHandlerError(error));
        return Promise.resolve();
    }
    /**
     * Runs retirement after its synchronous fence.
     * @returns {Promise<void>} - Retirement fence completion.
     */
    async _retire() {
        await this.scheduler?.stop();
        this.scheduler = undefined;
        if (this._drainPromise)
            await this._drainPromise;
        if (this._stopped)
            return;
        for (const worker of this.workers) {
            worker.isDraining = true;
            worker.send({ type: "retire", generationId: this.generationId });
        }
        this.lifecycleState = "retired";
        this._startGenerationRecoveryOwnership();
    }
    /** Clears timers that can initiate new global dispatch or schedule work. */
    _clearDispatchTimers() {
        if (this._pollTimer)
            clearInterval(this._pollTimer);
        if (this._scheduledTimer)
            clearTimeout(this._scheduledTimer);
        if (this._errorRetryTimer)
            clearTimeout(this._errorRetryTimer);
        this._pollTimer = undefined;
        this._scheduledTimer = undefined;
        this._errorRetryTimer = undefined;
    }
    /** Holds the main open until a lifecycle response has flushed. */
    acquireLifecycleRequestLease() { this._lifecycleRequestLeases += 1; }
    /** Releases one lifecycle-response lease after its socket write callback. */
    releaseLifecycleRequestLease() {
        if (this._lifecycleRequestLeases < 1)
            throw new Error("No background jobs lifecycle request lease to release");
        this._lifecycleRequestLeases -= 1;
        this._maybeStopRetired();
    }
    /** Stops a retired generation only after its exact ownership has drained. */
    _maybeStopRetired() {
        if (this.lifecycleState !== "retired" || this._stopped || this.stopPromise)
            return;
        if (this._lifecycleRequestLeases > 0 || this._activeNonWorkerRequests > 0 || this.workers.size > 0 || this.disconnectedWorkers.size > 0)
            return;
        if (this.inflightWorkerHandoffAdoptions.size > 0 || this.pendingHandoffRecoveries.size > 0)
            return;
        if (this._drainPromise || this._startupHandoffReclaimPromise || this._startupHandoffReclaimTimer)
            return;
        if (this.startupHandoffSnapshot.length > 0)
            return;
        for (const handoffs of this.workerHandoffs.values()) {
            if (handoffs.size > 0)
                return;
        }
        void this.stop().catch((error) => this._reportConnectionHandlerError(error));
    }
    /**
     * Wires up the dispatch-triggering signal sources for the configured
     * strategy. In `"beacon"` mode (default) this means subscribing to the
     * `velocious-background-jobs-dispatch` channel for cross-process
     * wake-ups, listening for Beacon (re)connects to catch up on missed
     * work, and relying on direct in-process calls from `_handleEnqueue`,
     * `_handleJobComplete`/`Failed`, worker hello/ready, and the
     * scheduled-job `setTimeout`. In `"polling"` mode we restore the
     * legacy fixed-interval poll for users who want the previous behavior.
     * @returns {void}
     */
    _setupDispatchTriggers() {
        if (this.dispatchStrategy === "polling") {
            this._pollTimer = setInterval(() => {
                void this._retryAfterError();
            }, this.pollIntervalMs);
            return;
        }
        const beaconClient = this.configuration.getBeaconClient();
        if (!beaconClient)
            return;
        this._beaconClient = beaconClient;
        this._unsubscribeBeacon = beaconClient.onBroadcast((message) => {
            if (message?.channel !== DISPATCH_CHANNEL)
                return;
            void this._drain();
        });
        // Drain on every (re)connect to catch up on jobs enqueued while the
        // bus was unreachable. The DB is the durable log; Beacon is just the
        // wake-up signal.
        this._beaconConnectHandler = () => {
            void this._drain();
        };
        beaconClient.on("connect", this._beaconConnectHandler);
    }
    /**
     * Arms the bounded adoption grace only when startup found exact persisted
     * handoffs. The timer is unrefed so an otherwise-finished process is never
     * retained solely to perform this cleanup.
     * @returns {void}
     */
    _setupStartupHandoffReclaim() {
        if (this.startupHandoffSnapshot.length === 0)
            return;
        if (this._startupHandoffReclaimTimer || this._startupHandoffReclaimPromise || this._startupHandoffGraceElapsed)
            return;
        this._startupHandoffReclaimTimer = this.clock.setTimeout(() => {
            this._startupHandoffReclaimTimer = undefined;
            this._startupHandoffAdoptionsAtDeadline = [...this.inflightWorkerHandoffAdoptions];
            this._startupHandoffGraceElapsed = true;
            void this._startStartupHandoffReclaim();
        }, this.workerReconnectGraceMs);
        if (typeof this._startupHandoffReclaimTimer === "object")
            this._startupHandoffReclaimTimer.unref();
    }
    /**
     * Starts one tracked startup-reclaim pass, coalescing lifecycle and retry
     * callers so shutdown can wait for durable mutation before closing pools.
     * @returns {Promise<void>} - Resolves after this pass settles.
     */
    _startStartupHandoffReclaim() {
        if (this._startupHandoffReclaimPromise)
            return this._startupHandoffReclaimPromise;
        const reclaim = this._reclaimDisconnectedStartupHandoffs();
        this._startupHandoffReclaimPromise = reclaim;
        const clearReclaim = () => {
            if (this._startupHandoffReclaimPromise === reclaim) {
                this._startupHandoffReclaimPromise = undefined;
            }
        };
        void reclaim.then(clearReclaim, clearReclaim);
        return reclaim;
    }
    /**
     * Waits for an already-started startup reclaim before adapter shutdown.
     * @returns {Promise<void>} - Resolves when no pass remains.
     */
    async _drainStartupHandoffReclaim() {
        while (this._startupHandoffReclaimPromise) {
            await this._startupHandoffReclaimPromise;
        }
    }
    /**
     * Orphans only startup-snapshotted leases whose stable worker id has not been
     * observed by this main generation. Store fencing rejects completed,
     * returned, replaced, and re-handed-off rows.
     * @returns {Promise<void>} - Resolves after reclaim or retained retry state.
     */
    async _reclaimDisconnectedStartupHandoffs() {
        if (this._stopped || !this._startupHandoffGraceElapsed)
            return;
        if (this.startupHandoffSnapshot.length === 0)
            return;
        await this._waitForStartupHandoffAdoptionsAtDeadline();
        if (this._stopped)
            return;
        const handoffs = this.startupHandoffSnapshot.filter(({ workerId }) => !this.reconnectedWorkerIds.has(workerId));
        if (handoffs.length === 0) {
            this.startupHandoffSnapshot = [];
            this._maybeStopRetired();
            return;
        }
        let orphanedJobs;
        try {
            orphanedJobs = await this.store.markOrphanedHandoffs({
                error: "Job orphaned after its pre-restart worker did not reconnect",
                handoffs
            });
        }
        catch (error) {
            this._reportStartupHandoffReclaimError(error);
            this._scheduleErrorRetry();
            return;
        }
        this.startupHandoffSnapshot = [];
        await this._handleOrphanedJobs({
            jobs: orphanedJobs,
            warning: "Reclaimed background jobs from workers absent after main restart grace"
        });
        this.onStartupHandoffsReclaimed?.(orphanedJobs);
        this._maybeStopRetired();
    }
    /**
     * Lets adoption queries already running at the reconnect deadline settle
     * before worker ids are filtered. A second bounded grace prevents a stuck
     * adapter query from deferring startup reclaim forever.
     * @returns {Promise<void>} - Resolves when the deadline set settles or times out.
     */
    async _waitForStartupHandoffAdoptionsAtDeadline() {
        const adoptions = this._startupHandoffAdoptionsAtDeadline;
        this._startupHandoffAdoptionsAtDeadline = [];
        if (adoptions.length === 0)
            return;
        /** @type {ReturnType<typeof setTimeout> | undefined} */
        let timer;
        const waitLimit = new Promise((resolve) => {
            // This lifecycle deadline must not keep the main process alive; the
            // generic timeout helper intentionally uses a referenced timer.
            timer = setTimeout(resolve, this.workerReconnectGraceMs);
            timer.unref();
        });
        try {
            await Promise.race([Promise.all(adoptions), waitLimit]);
        }
        finally {
            if (timer)
                clearTimeout(timer);
        }
    }
    /**
     * Publishes a dispatch wake-up on the Beacon channel. No-op in polling
     * mode or when Beacon is not connected; in those cases the direct
     * in-process `_drain()` call in the enqueue/handle paths is sufficient
     * (there are no other processes to notify).
     * @returns {void}
     */
    _notifyEnqueued() {
        if (this.dispatchStrategy === "polling")
            return;
        const beaconClient = this.configuration.getBeaconClient();
        if (!beaconClient || !beaconClient.isConnected())
            return;
        try {
            beaconClient.publish({
                channel: DISPATCH_CHANNEL,
                broadcastParams: {},
                body: { action: "wake" }
            });
        }
        catch (error) {
            this.logger.warn(() => ["Failed to publish background jobs wake broadcast:", error]);
        }
    }
    /**
     * Runs handle connection.
     * @param {import("net").Socket} socket - Socket.
     * @returns {void}
     */
    _handleConnection(socket) {
        const jsonSocket = new JsonSocket(socket);
        this.connections.add(jsonSocket);
        /**
         * Role.
         * @type {import("./types.js").BackgroundJobSocketRole | null} */
        let role = null;
        let cleanedUp = false;
        const cleanup = () => {
            if (cleanedUp)
                return;
            cleanedUp = true;
            this.connections.delete(jsonSocket);
            if (role === "worker")
                void this._handleWorkerSocketClosed(jsonSocket);
            this._maybeStopRetired();
        };
        jsonSocket.on("close", cleanup);
        jsonSocket.on("error", (error) => {
            this.logger.warn(() => ["Background jobs connection error:", error]);
            cleanup();
        });
        let messageHandling = Promise.resolve();
        jsonSocket.on("message", (message) => {
            messageHandling = messageHandling.then(async () => {
                const existingRole = role;
                role = await this._handleSocketMessage({ jsonSocket, message, role });
                if (existingRole === "client" || existingRole === "reporter")
                    jsonSocket.close();
            }).catch((error) => {
                this._reportConnectionHandlerError(error);
                jsonSocket.close();
            });
        });
    }
    /**
     * Surfaces an unexpected protocol-handler failure.
     * @param {ReturnType<typeof JSON.parse>} error - Handler failure.
     * @returns {void}
     */
    _reportConnectionHandlerError(error) {
        const normalizedError = error instanceof Error ? error : new Error(String(error));
        const payload = { context: { stage: "background-jobs-socket-handler" }, error: normalizedError };
        const errorEvents = this.configuration.getErrorEvents();
        this.logger.error(() => ["Background jobs socket handler failed:", normalizedError]);
        errorEvents.emit("framework-error", payload);
        errorEvents.emit("all-error", { ...payload, errorType: "framework-error" });
    }
    /**
     * Runs handle socket message.
     * @param {object} args - Options.
     * @param {JsonSocket} args.jsonSocket - JSON socket.
     * @param {import("./types.js").BackgroundJobSocketMessage} args.message - Socket message.
     * @param {import("./types.js").BackgroundJobSocketRole | null} args.role - Current socket role.
     * @returns {Promise<import("./types.js").BackgroundJobSocketRole | null>} - Updated socket role.
     */
    async _handleSocketMessage({ jsonSocket, message, role }) {
        if (!role)
            return await this._handleRolelessSocketMessage({ jsonSocket, message });
        if (role === "worker") {
            await this._handleWorkerSocketMessage({ jsonSocket, message });
            return role;
        }
        this._activeNonWorkerRequests += 1;
        try {
            if (role === "client")
                await this._handleClientSocketMessage({ jsonSocket, message });
            if (role === "reporter")
                await this._handleReporterSocketMessage({ jsonSocket, message });
        }
        finally {
            this._activeNonWorkerRequests -= 1;
            this._maybeStopRetired();
        }
        return role;
    }
    /**
     * Runs handle roleless socket message.
     * @param {object} args - Options.
     * @param {JsonSocket} args.jsonSocket - JSON socket.
     * @param {import("./types.js").BackgroundJobSocketMessage} args.message - Socket message.
     * @returns {Promise<import("./types.js").BackgroundJobSocketRole | null>} - New socket role.
     */
    async _handleRolelessSocketMessage({ jsonSocket, message }) {
        if (message?.type !== "hello")
            return null;
        const rejectionReason = this._generationHelloRejectionReason(message);
        if (rejectionReason) {
            jsonSocket.send({ type: "generation-rejected", reason: rejectionReason });
            jsonSocket.close();
            return null;
        }
        if (message.role === "worker") {
            if (this._stopped) {
                jsonSocket.close();
                return message.role;
            }
            if (!(await this._registerWorker({ jsonSocket, message })))
                return null;
        }
        if (this.generationId) {
            jsonSocket.send({
                type: "generation-accepted",
                generationId: this.generationId,
                lifecycleState: this.lifecycleState
            });
            if (message.role === "worker" && (this.lifecycleState === "retiring" || this.lifecycleState === "retired")) {
                jsonSocket.send({ type: "retire", generationId: this.generationId });
            }
        }
        return message.role;
    }
    /**
     * Validates the generation fence before assigning a socket role.
     * @param {import("./types.js").BackgroundJobHelloMessage} message - Hello message.
     * @returns {import("./types.js").BackgroundJobsGenerationRejectionReason | null} - Rejection reason.
     */
    _generationHelloRejectionReason(message) {
        const messageHasGeneration = Object.hasOwn(message, "generationId");
        if (!this.generationId)
            return messageHasGeneration ? "unexpected-generation" : null;
        if (!messageHasGeneration)
            return "missing-generation";
        try {
            validateGenerationId(message.generationId, "hello generationId");
        }
        catch {
            return "malformed-generation";
        }
        if (message.generationId !== this.generationId)
            return "generation-mismatch";
        if (message.role === "worker" && !workerIdBelongsToGeneration({ generationId: this.generationId, workerId: message.workerId })) {
            return "generation-mismatch";
        }
        return null;
    }
    /**
     * Registers a generation-fenced worker and transfers only its exact ownership.
     * @param {object} args - Worker hello.
     * @param {JsonSocket} args.jsonSocket - New socket.
     * @param {import("./types.js").BackgroundJobHelloMessage} args.message - Hello.
     * @returns {Promise<boolean>} - Whether the worker was admitted.
     */
    async _registerWorker({ jsonSocket, message }) {
        jsonSocket.workerId = message.workerId;
        jsonSocket.supportsHandoffIdReporting = message.supportsHandoffIdReporting === true;
        jsonSocket.supportsHeartbeat = message.supportsHeartbeat === true;
        jsonSocket.lastSeenAt = this.clock.now();
        const workerId = jsonSocket.workerId;
        const disconnected = workerId ? this.disconnectedWorkers.get(workerId) : undefined;
        let handoffs = disconnected ? this.workerHandoffs.get(disconnected.worker) : undefined;
        const recoveryOnly = this.lifecycleState === "retiring" || this.lifecycleState === "retired";
        if (recoveryOnly && (!handoffs || handoffs.size === 0)) {
            if (!workerId)
                return false;
            const durableHandoffs = await this.store.handedOffJobsForWorker({ workerId });
            if (durableHandoffs.length === 0) {
                jsonSocket.send({ type: "generation-rejected", reason: "worker-has-no-recoverable-handoffs" });
                jsonSocket.close();
                return false;
            }
            handoffs = new Map(durableHandoffs.map(({ jobId, handoffId }) => [jobId, handoffId]));
            this.reconnectedWorkerIds.add(workerId);
        }
        if (disconnected) {
            this.clock.clearTimeout(disconnected.timer);
            if (workerId)
                this.disconnectedWorkers.delete(workerId);
            this.workerHandoffs.delete(disconnected.worker);
        }
        this.workers.add(jsonSocket);
        this.workerHandoffs.set(jsonSocket, handoffs || new Map());
        if (recoveryOnly)
            jsonSocket.isDraining = true;
        if (!handoffs && this.lifecycleState === "active")
            this._trackWorkerHandoffAdoption(jsonSocket);
        return true;
    }
    /**
     * Tracks a worker handoff-adoption query through shutdown.
     * @param {JsonSocket} jsonSocket - Reconnecting worker socket.
     * @returns {void}
     */
    _trackWorkerHandoffAdoption(jsonSocket) {
        const adoption = this._adoptWorkerHandoffs(jsonSocket);
        this.inflightWorkerHandoffAdoptions.add(adoption);
        const removeAdoption = () => {
            this.inflightWorkerHandoffAdoptions.delete(adoption);
            this._maybeStopRetired();
        };
        void adoption.then(removeAdoption, removeAdoption);
    }
    /**
     * Waits for worker handoff-adoption queries to finish.
     * @returns {Promise<void>} - Resolves when no adoption query remains.
     */
    async _drainWorkerHandoffAdoptions() {
        while (this.inflightWorkerHandoffAdoptions.size > 0) {
            await Promise.all([...this.inflightWorkerHandoffAdoptions]);
        }
    }
    /**
     * Adopts a reconnecting worker's still-active `handed_off` jobs into its new
     * socket's handoff map. A fresh main (e.g. after a deploy restart) holds no
     * in-memory leases, so a worker that reconnects with its stable id would
     * otherwise have its pre-restart jobs tracked nowhere — if it then died, those
     * leases (and their concurrency reservations) would sit stuck until the
     * hours-long orphan sweep. Adopting them means `_handleWorkerSocketClosed`
     * releases them on the worker's next disconnect, while a still-running worker
     * (including one gracefully draining) keeps executing them untouched. No
     * time-based reclaim is used, so a draining worker whose jobs outlive the old
     * main is never wrongly requeued into a duplicate attempt.
     * @param {JsonSocket} jsonSocket - The reconnected worker socket.
     * @returns {Promise<void>}
     */
    async _adoptWorkerHandoffs(jsonSocket) {
        const workerId = jsonSocket.workerId;
        if (typeof workerId !== "string" || workerId.length === 0)
            return;
        try {
            const handoffs = await this.store.handedOffJobsForWorker({ workerId });
            const map = this.workerHandoffs.get(jsonSocket);
            // The socket may have closed while the query was in flight; its map is then
            // gone and the jobs are left for the orphan sweep rather than resurrected.
            if (!map || !this.workers.has(jsonSocket))
                return;
            for (const { jobId, handoffId } of handoffs) {
                map.set(jobId, handoffId);
            }
            this.reconnectedWorkerIds.add(workerId);
        }
        catch (error) {
            this._reportHandoffAdoptError(error);
        }
    }
    /**
     * Runs handle client socket message.
     * @param {object} args - Options.
     * @param {JsonSocket} args.jsonSocket - JSON socket.
     * @param {import("./types.js").BackgroundJobSocketMessage} args.message - Socket message.
     * @returns {Promise<void>} - Resolves after the request is acknowledged.
     */
    async _handleClientSocketMessage({ jsonSocket, message }) {
        if (this.generationId && (this.lifecycleState === "retiring" || this.lifecycleState === "retired")) {
            if (message?.type === "enqueue")
                jsonSocket.send({ type: "enqueue-error", error: "Background jobs generation is retired" });
            if (message?.type === "replace-scheduled")
                jsonSocket.send({ type: "replace-scheduled-error", error: "Background jobs generation is retired" });
            if (message?.type === "cancel-scheduled")
                jsonSocket.send({ type: "cancel-scheduled-error", error: "Background jobs generation is retired" });
            return;
        }
        if (message?.type === "enqueue") {
            await this._handleEnqueue({ jsonSocket, message });
            return;
        }
        if (message?.type === "replace-scheduled") {
            await this._handleReplaceScheduled({ jsonSocket, message });
            return;
        }
        if (message?.type === "cancel-scheduled") {
            await this._handleCancelScheduled({ jsonSocket, message });
        }
    }
    /**
     * Runs handle worker socket message.
     * @param {object} args - Options.
     * @param {JsonSocket} args.jsonSocket - JSON socket.
     * @param {import("./types.js").BackgroundJobSocketMessage} args.message - Socket message.
     * @returns {Promise<void>} - Resolves after the worker message is handled.
     */
    async _handleWorkerSocketMessage({ jsonSocket, message }) {
        // Any message from the worker proves it is alive; the liveness sweep uses
        // this to detect a wedged/silent worker.
        jsonSocket.lastSeenAt = this.clock.now();
        if (message?.type === "heartbeat") {
            this.onWorkerHeartbeat?.(jsonSocket);
            return;
        }
        if (message?.type === "ready") {
            this._handleWorkerReady({ jsonSocket, message });
            return;
        }
        if (message?.type === "draining") {
            this._handleWorkerDraining({ jsonSocket });
            return;
        }
        await this._handleReporterSocketMessage({ jsonSocket, message });
    }
    /**
     * Runs handle reporter socket message.
     * @param {object} args - Options.
     * @param {JsonSocket} args.jsonSocket - JSON socket.
     * @param {import("./types.js").BackgroundJobSocketMessage} args.message - Socket message.
     * @returns {Promise<void>} - Resolves after the report is acknowledged.
     */
    async _handleReporterSocketMessage({ jsonSocket, message }) {
        if (this.generationId && this._generationReportIsInvalid(message)) {
            if ("jobId" in message && typeof message.jobId === "string") {
                jsonSocket.send({ type: "job-update-error", jobId: message.jobId, error: "Generation ownership rejected" });
            }
            return;
        }
        if (message?.type === "job-complete") {
            await this._handleJobComplete({ jsonSocket, message });
            return;
        }
        if (message?.type === "job-failed") {
            await this._handleJobFailed({ jsonSocket, message });
            return;
        }
        if (message?.type === "job-reschedule") {
            await this._handleJobReschedule({ jsonSocket, message });
        }
    }
    /**
     * Requires the complete durable lease identity before a generation-mode
     * reporter can mutate a job. Legacy reporters keep their permissive protocol.
     * @param {import("./types.js").BackgroundJobSocketMessage} message - Reporter message.
     * @returns {boolean} - Whether the report lacks its exact generation lease.
     */
    _generationReportIsInvalid(message) {
        if (message?.type !== "job-complete" && message?.type !== "job-failed" && message?.type !== "job-reschedule")
            return false;
        const generationId = this.generationId;
        if (!generationId)
            return false;
        return typeof message.handoffId !== "string"
            || typeof message.handedOffAtMs !== "number"
            || !workerIdBelongsToGeneration({ generationId, workerId: message.workerId });
    }
    /**
     * Runs handle worker ready.
     * @param {object} args - Options.
     * @param {JsonSocket} args.jsonSocket - JSON socket.
     * @param {import("./types.js").BackgroundJobReadyMessage} args.message - Ready message.
     * @returns {void}
     */
    _handleWorkerReady({ jsonSocket, message }) {
        if (this.lifecycleState === "retiring" || this.lifecycleState === "retired") {
            this.readyWorkers.delete(jsonSocket);
            this.candidateReadyWorkers.delete(jsonSocket);
            return;
        }
        jsonSocket.readinessVersion += 1;
        jsonSocket.acceptsSpawnedJobs = message.acceptsSpawned !== false && message.acceptsForked !== false;
        jsonSocket.acceptsForkedJobs = message.acceptsForked !== false;
        jsonSocket.acceptsPooledJobs = message.acceptsPooled === true;
        const availablePooledSlots = message.availablePooledSlots;
        jsonSocket.usesPooledCapacityCredits = Number.isInteger(availablePooledSlots);
        jsonSocket.availablePooledSlots = Number.isInteger(availablePooledSlots) && availablePooledSlots !== undefined && availablePooledSlots > 0
            ? availablePooledSlots
            : 0;
        jsonSocket.acceptsInlineJobs = message.acceptsInline !== false;
        if (this.lifecycleState === "candidate") {
            this.readyWorkers.delete(jsonSocket);
            if (!jsonSocket.isDraining)
                this.candidateReadyWorkers.add(jsonSocket);
        }
        else if (this.lifecycleState === "active" && this._activeOwnershipReady && jsonSocket.supportsHandoffIdReporting && !jsonSocket.isDraining) {
            this.readyWorkers.add(jsonSocket);
        }
        else {
            this.readyWorkers.delete(jsonSocket);
            this.candidateReadyWorkers.delete(jsonSocket);
        }
        this.onWorkerReady?.(jsonSocket);
        void this._drain();
    }
    /**
     * Runs handle worker draining.
     * @param {object} args - Options.
     * @param {JsonSocket} args.jsonSocket - JSON socket.
     * @returns {void}
     */
    _handleWorkerDraining({ jsonSocket }) {
        // The worker is shutting down gracefully. Stop dispatching new jobs
        // to it but keep the connection in `workers` so any in-flight job
        // it's still draining can report its result.
        jsonSocket.isDraining = true;
        this.readyWorkers.delete(jsonSocket);
        this.candidateReadyWorkers.delete(jsonSocket);
    }
    /**
     * Removes a lost worker socket and releases only leases dispatched through it.
     * @param {JsonSocket} worker - Disconnected worker socket.
     * @param {object} [args] - Coordination options.
     * @param {boolean} [args.queueRedrain] - Queue another pass instead of awaiting the active drain.
     * @returns {Promise<void>} - Resolves after its active leases are released.
     */
    async _handleWorkerSocketClosed(worker, { queueRedrain = false } = {}) {
        this.workers.delete(worker);
        this.readyWorkers.delete(worker);
        this.candidateReadyWorkers.delete(worker);
        if (this._stopped) {
            this.workerHandoffs.delete(worker);
            return;
        }
        const handoffs = this.workerHandoffs.get(worker);
        if (this.generationId && worker.workerId && handoffs && handoffs.size > 0) {
            const existing = this.disconnectedWorkers.get(worker.workerId);
            if (existing?.worker === worker)
                return;
            if (existing)
                this.clock.clearTimeout(existing.timer);
            const timer = this.clock.setTimeout(() => {
                this.disconnectedWorkers.delete(worker.workerId || "");
                void this._releaseWorkerHandoffs(worker).then(() => {
                    if (worker.workerId)
                        this.onWorkerHandoffsReleased?.(worker.workerId);
                }, (error) => {
                    this._reportHandoffReleaseError(error);
                    this._scheduleErrorRetry();
                });
            }, this.workerReconnectGraceMs);
            if (typeof timer === "object")
                timer.unref();
            this.disconnectedWorkers.set(worker.workerId, { worker, timer });
            this.onWorkerDisconnected?.(worker.workerId);
            return;
        }
        try {
            await this._releaseWorkerHandoffs(worker, { queueRedrain });
        }
        catch (error) {
            this._reportHandoffReleaseError(error);
            this._scheduleErrorRetry();
        }
        this._maybeStopRetired();
    }
    /**
     * Releases all leases still owned by one exact worker socket.
     * @param {JsonSocket} worker - Worker socket.
     * @param {object} [args] - Coordination options.
     * @param {boolean} [args.queueRedrain] - Queue another pass instead of awaiting the active drain.
     * @returns {Promise<void>} - Resolves after fenced releases and dispatch wake-up.
     */
    async _releaseWorkerHandoffs(worker, { queueRedrain = false } = {}) {
        const handoffs = this.workerHandoffs.get(worker);
        if (!handoffs || handoffs.size === 0) {
            this.workerHandoffs.delete(worker);
            return;
        }
        for (const [jobId, handoffId] of handoffs) {
            await this._releaseHandoff({ handoffId, jobId, worker });
        }
        this.workerHandoffs.delete(worker);
        this._notifyEnqueued();
        if (queueRedrain) {
            this._redrainQueued = true;
        }
        else {
            if (this.lifecycleState === "active")
                await this._drain();
        }
        this._maybeStopRetired();
    }
    /**
     * Runs one idempotent conditional lease release.
     * @param {object} args - Options.
     * @param {string} args.handoffId - Handoff lease id.
     * @param {string} args.jobId - Job id.
     * @param {JsonSocket} args.worker - Socket that received the lease.
     * @returns {Promise<void>} - Resolves after the fenced transition.
     */
    async _releaseHandoff({ handoffId, jobId, worker }) {
        await this.store.markReturnedToQueue({ handoffId, jobId });
        const handoffs = this.workerHandoffs.get(worker);
        if (handoffs?.get(jobId) === handoffId)
            handoffs.delete(jobId);
    }
    /**
     * Forgets a successfully reported lease without relying on worker ids.
     * @param {object} args - Options.
     * @param {string} args.handoffId - Handoff lease id.
     * @param {string} args.jobId - Job id.
     * @returns {void}
     */
    _forgetHandoff({ handoffId, jobId }) {
        for (const [worker, handoffs] of this.workerHandoffs) {
            if (handoffs.get(jobId) !== handoffId)
                continue;
            handoffs.delete(jobId);
            if (handoffs.size === 0 && !this.workers.has(worker))
                this.workerHandoffs.delete(worker);
            if (handoffs.size === 0 && worker.workerId) {
                const disconnected = this.disconnectedWorkers.get(worker.workerId);
                if (disconnected?.worker === worker) {
                    this.clock.clearTimeout(disconnected.timer);
                    this.disconnectedWorkers.delete(worker.workerId);
                }
            }
            this._maybeStopRetired();
            return;
        }
    }
    /**
     * Reports an unexpected lease-release failure on framework error channels.
     * @param {ReturnType<typeof JSON.parse>} error - Release failure.
     * @returns {void}
     */
    _reportHandoffReleaseError(error) {
        const normalizedError = error instanceof Error ? error : new Error(String(error));
        const payload = { context: { stage: "background-job-handoff-release" }, error: normalizedError };
        const errorEvents = this.configuration.getErrorEvents();
        this.logger.error(() => ["Failed to release disconnected worker handoffs:", normalizedError]);
        errorEvents.emit("framework-error", payload);
        errorEvents.emit("all-error", { ...payload, errorType: "framework-error" });
    }
    /**
     * Reports an unexpected worker-handoff adoption failure on framework error
     * channels. A failed adoption is not fatal (the worker's jobs remain and are
     * reclaimed by the orphan sweep), but must surface rather than be swallowed.
     * @param {ReturnType<typeof JSON.parse>} error - Adoption failure.
     * @returns {void}
     */
    _reportHandoffAdoptError(error) {
        const normalizedError = error instanceof Error ? error : new Error(String(error));
        const payload = { context: { stage: "background-job-handoff-adopt" }, error: normalizedError };
        const errorEvents = this.configuration.getErrorEvents();
        this.logger.error(() => ["Failed to adopt reconnected worker handoffs:", normalizedError]);
        errorEvents.emit("framework-error", payload);
        errorEvents.emit("all-error", { ...payload, errorType: "framework-error" });
    }
    /**
     * Reports an unexpected startup-snapshot reclaim failure while retaining the
     * snapshot for the dispatcher's existing transient-error retry lifecycle.
     * @param {ReturnType<typeof JSON.parse>} error - Reclaim failure.
     * @returns {void}
     */
    _reportStartupHandoffReclaimError(error) {
        const normalizedError = error instanceof Error ? error : new Error(String(error));
        const payload = { context: { stage: "background-job-startup-handoff-reclaim" }, error: normalizedError };
        const errorEvents = this.configuration.getErrorEvents();
        this.logger.error(() => ["Failed to reclaim disconnected startup handoffs:", normalizedError]);
        errorEvents.emit("framework-error", payload);
        errorEvents.emit("all-error", { ...payload, errorType: "framework-error" });
    }
    /**
     * Runs handle enqueue.
     * @param {object} args - Options.
     * @param {JsonSocket} args.jsonSocket - JSON socket.
     * @param {import("./types.js").BackgroundJobEnqueueMessage} args.message - Message.
     * @returns {Promise<void>} - Resolves when handled.
     */
    async _handleEnqueue({ jsonSocket, message }) {
        try {
            const jobId = await this.store.enqueue({
                jobName: message.jobName,
                args: message.args || [],
                options: message.options || {}
            });
            jsonSocket.send({ type: "enqueued", jobId });
            this._notifyEnqueued();
            await this._drain();
        }
        catch (error) {
            this._handleClientMutationError({
                context: { jobName: message.jobName, stage: "background-job-enqueue" },
                error,
                fallbackMessage: "Failed to enqueue job",
                jsonSocket,
                logMessage: "Failed to enqueue background job:",
                responseType: "enqueue-error"
            });
        }
    }
    /**
     * Handles a stable-key replacement request and re-arms dispatch afterward.
     * @param {object} args - Options.
     * @param {JsonSocket} args.jsonSocket - JSON socket.
     * @param {import("./types.js").BackgroundJobReplaceScheduledMessage} args.message - Message.
     * @returns {Promise<void>} - Resolves when handled.
     */
    async _handleReplaceScheduled({ jsonSocket, message }) {
        try {
            const result = await this.store.replaceScheduled({
                scheduleKey: message.scheduleKey,
                jobName: message.jobName,
                args: message.args || [],
                options: message.options || {}
            });
            this._notifyEnqueued();
            await this._drain();
            jsonSocket.send({ type: "schedule-replaced", ...result });
        }
        catch (error) {
            this._handleClientMutationError({
                context: { jobName: message.jobName, scheduleKey: message.scheduleKey, stage: "background-job-replace-scheduled" },
                error,
                fallbackMessage: "Failed to replace scheduled job",
                jsonSocket,
                logMessage: "Failed to replace scheduled background job:",
                responseType: "replace-scheduled-error"
            });
        }
    }
    /**
     * Handles a stable-key cancellation request and re-arms dispatch afterward.
     * @param {object} args - Options.
     * @param {JsonSocket} args.jsonSocket - JSON socket.
     * @param {import("./types.js").BackgroundJobCancelScheduledMessage} args.message - Message.
     * @returns {Promise<void>} - Resolves when handled.
     */
    async _handleCancelScheduled({ jsonSocket, message }) {
        try {
            const result = await this.store.cancelScheduled(message.scheduleKey);
            this._notifyEnqueued();
            await this._drain();
            jsonSocket.send({ type: "schedule-cancelled", ...result });
        }
        catch (error) {
            this._handleClientMutationError({
                context: { scheduleKey: message.scheduleKey, stage: "background-job-cancel-scheduled" },
                error,
                fallbackMessage: "Failed to cancel scheduled job",
                jsonSocket,
                logMessage: "Failed to cancel scheduled background job:",
                responseType: "cancel-scheduled-error"
            });
        }
    }
    /**
     * Returns safe validation failures and reports unexpected client mutations.
     * @param {object} args - Options.
     * @param {Record<string, ReturnType<typeof JSON.parse>>} args.context - Framework-error context.
     * @param {ReturnType<typeof JSON.parse>} args.error - Mutation failure.
     * @param {string} args.fallbackMessage - Client-safe fallback message.
     * @param {JsonSocket} args.jsonSocket - JSON socket.
     * @param {string} args.logMessage - Error log prefix.
     * @param {"enqueue-error" | "replace-scheduled-error" | "cancel-scheduled-error"} args.responseType - Response type.
     * @returns {void}
     */
    _handleClientMutationError({ context, error, fallbackMessage, jsonSocket, logMessage, responseType }) {
        if (error instanceof VelociousError && error.safeToExpose) {
            jsonSocket.send({ type: responseType, error: error.message });
            return;
        }
        const normalizedError = error instanceof Error ? error : new Error(String(error));
        const payload = { context, error: normalizedError };
        const errorEvents = this.configuration.getErrorEvents();
        this.logger.error(() => [logMessage, normalizedError]);
        errorEvents.emit("framework-error", payload);
        errorEvents.emit("all-error", { ...payload, errorType: "framework-error" });
        jsonSocket.send({ type: responseType, error: fallbackMessage });
    }
    /**
     * Runs handle job complete.
     * @param {object} args - Options.
     * @param {JsonSocket} args.jsonSocket - JSON socket.
     * @param {import("./types.js").BackgroundJobCompleteMessage} args.message - Message.
     * @returns {Promise<void>} - Resolves when handled.
     */
    async _handleJobComplete({ jsonSocket, message }) {
        try {
            const accepted = await this.store.markCompleted({
                jobId: message.jobId,
                handoffId: message.handoffId,
                workerId: message.workerId,
                handedOffAtMs: message.handedOffAtMs
            });
            if (accepted && message.handoffId) {
                this._forgetHandoff({ handoffId: message.handoffId, jobId: message.jobId });
            }
            this.onJobUpdated?.({ accepted, jobId: message.jobId, status: "completed" });
            jsonSocket.send({ type: "job-updated", jobId: message.jobId });
        }
        catch (error) {
            this._reportJobUpdateFailure({ error, jobId: message.jobId, stage: "background-job-complete" });
            jsonSocket.send({ type: "job-update-error", jobId: message.jobId, error: "Failed to update job" });
        }
    }
    /**
     * Surfaces an unexpected durable report failure without exposing it to the
     * reporting peer.
     * @param {object} args - Failure context.
     * @param {ReturnType<typeof JSON.parse>} args.error - Adapter failure.
     * @param {string} args.jobId - Durable job id.
     * @param {string} args.stage - Mutation stage.
     */
    _reportJobUpdateFailure({ error, jobId, stage }) {
        const normalizedError = error instanceof Error ? error : new Error(String(error));
        const payload = { context: { generationId: this.generationId, jobId, stage }, error: normalizedError };
        const errorEvents = this.configuration.getErrorEvents();
        this.logger.error(() => ["Failed to update background job:", normalizedError]);
        errorEvents.emit("framework-error", payload);
        errorEvents.emit("all-error", { ...payload, errorType: "framework-error" });
    }
    /**
     * Persists a normal job reschedule outcome and wakes scheduled dispatch.
     * @param {object} args - Options.
     * @param {JsonSocket} args.jsonSocket - JSON socket.
     * @param {import("./types.js").BackgroundJobRescheduleMessage} args.message - Message.
     * @returns {Promise<void>} - Resolves when handled.
     */
    async _handleJobReschedule({ jsonSocket, message }) {
        try {
            const accepted = await this.store.markRescheduled({
                jobId: message.jobId,
                delayMs: message.delayMs,
                handoffId: message.handoffId,
                workerId: message.workerId,
                handedOffAtMs: message.handedOffAtMs
            });
            if (accepted && message.handoffId) {
                this._forgetHandoff({ handoffId: message.handoffId, jobId: message.jobId });
            }
            this.onJobUpdated?.({ accepted, jobId: message.jobId, status: "rescheduled" });
            jsonSocket.send({ type: "job-updated", jobId: message.jobId });
            this._notifyEnqueued();
            await this._drain();
        }
        catch (error) {
            const normalizedError = error instanceof Error ? error : new Error(String(error));
            const payload = { context: { jobId: message.jobId, stage: "background-job-reschedule" }, error: normalizedError };
            const errorEvents = this.configuration.getErrorEvents();
            this.logger.error(() => ["Failed to update job reschedule:", normalizedError]);
            errorEvents.emit("framework-error", payload);
            errorEvents.emit("all-error", { ...payload, errorType: "framework-error" });
            jsonSocket.send({ type: "job-update-error", jobId: message.jobId, error: "Failed to update job" });
        }
    }
    /**
     * Runs handle job failed.
     * @param {object} args - Options.
     * @param {JsonSocket} args.jsonSocket - JSON socket.
     * @param {import("./types.js").BackgroundJobFailedMessage} args.message - Message.
     * @returns {Promise<void>} - Resolves when handled.
     */
    async _handleJobFailed({ jsonSocket, message }) {
        try {
            const failedJob = await this.store.markFailed({
                jobId: message.jobId,
                error: message.error,
                handoffId: message.handoffId,
                workerId: message.workerId,
                handedOffAtMs: message.handedOffAtMs
            });
            if (failedJob) {
                if (message.handoffId) {
                    this._forgetHandoff({ handoffId: message.handoffId, jobId: message.jobId });
                }
                this._emitBackgroundJobFailed({
                    error: message.error,
                    handoffId: message.handoffId,
                    handedOffAtMs: message.handedOffAtMs,
                    job: failedJob,
                    workerId: message.workerId
                });
            }
            this.onJobUpdated?.({ accepted: Boolean(failedJob), jobId: message.jobId, status: "failed" });
            jsonSocket.send({ type: "job-updated", jobId: message.jobId });
            // A failed job may have been re-queued (with backoff) for retry —
            // poke the dispatcher so the retry timer is armed.
            this._notifyEnqueued();
            await this._drain();
        }
        catch (error) {
            this.logger.error(() => ["Failed to update job failure:", error]);
            jsonSocket.send({ type: "job-update-error", jobId: message.jobId, error: "Failed to update job" });
        }
    }
    /**
     * Runs emit background job failed.
     * @param {{error: ReturnType<typeof JSON.parse>, handoffId?: string, handedOffAtMs?: number, job: import("./types.js").BackgroundJobRow, workerId?: string}} args - Failure event data.
     * @returns {void}
     */
    _emitBackgroundJobFailed({ error, handoffId, handedOffAtMs, job, workerId }) {
        const normalizedError = this._normalizeFailureError(error);
        const payload = {
            context: {
                attempts: job.attempts,
                handoffId,
                handedOffAtMs,
                jobArgs: job.args,
                jobId: job.id,
                jobName: job.jobName,
                maxRetries: job.maxRetries,
                stage: "background-job-failed",
                status: job.status,
                terminal: job.status === "failed" || job.status === "orphaned",
                willRetry: job.status === "queued",
                workerId
            },
            error: normalizedError
        };
        const errorEvents = this.configuration.getErrorEvents();
        errorEvents.emit("background-job-failed", payload);
        errorEvents.emit("all-error", { ...payload, errorType: "background-job-failed" });
    }
    /**
     * Emits `background-job-orphaned` (mirrored to `all-error`) for a job the time-based orphan sweep
     * reclaimed after its worker died mid-run. Unlike `background-job-failed`, which fires on a
     * worker's failure report, this fires from the main process's sweep, so applications can react to
     * a dead worker's specific job — recover the work it left behind — without polling. `willRetry`
     * reflects whether the reclaim returned the job to the queue for another attempt.
     * @param {{job: import("./types.js").BackgroundJobRow}} args - The orphaned job.
     * @returns {void}
     */
    _emitBackgroundJobOrphaned({ job }) {
        const normalizedError = this._normalizeFailureError(job.lastError ?? "Job orphaned after timeout");
        const payload = {
            context: {
                attempts: job.attempts,
                jobArgs: job.args,
                jobId: job.id,
                jobName: job.jobName,
                maxRetries: job.maxRetries,
                stage: "background-job-orphaned",
                status: job.status,
                terminal: job.status === "failed" || job.status === "orphaned",
                willRetry: job.status === "queued"
            },
            error: normalizedError
        };
        const errorEvents = this.configuration.getErrorEvents();
        errorEvents.emit("background-job-orphaned", payload);
        errorEvents.emit("all-error", { ...payload, errorType: "background-job-orphaned" });
    }
    /**
     * Runs normalize failure error.
     * @param {ReturnType<typeof JSON.parse>} error - Reported failure value.
     * @returns {Error} Normalized error.
     */
    _normalizeFailureError(error) {
        if (error instanceof Error)
            return error;
        return this._errorFromUnknownFailure(error);
    }
    /**
     * Runs error from unknown failure.
     * @param {ReturnType<typeof JSON.parse>} error - Reported failure value.
     * @returns {Error} Normalized error.
     */
    _errorFromUnknownFailure(error) {
        const message = this._messageFromUnknownFailure(error);
        const normalizedError = new Error(message);
        this._copyStringFailureStack({ error, normalizedError });
        return normalizedError;
    }
    /**
     * Runs message from unknown failure.
     * @param {ReturnType<typeof JSON.parse>} error - Reported failure value.
     * @returns {string} Error message.
     */
    _messageFromUnknownFailure(error) {
        if (this._hasStringFailure(error))
            return error.trim().split("\n")[0];
        return String(error || "Background job failed");
    }
    /**
     * Runs has string failure.
     * @param {ReturnType<typeof JSON.parse>} error - Reported failure value.
     * @returns {error is string} Whether the value is a non-empty string.
     */
    _hasStringFailure(error) {
        return typeof error === "string" && error.trim().length > 0;
    }
    /**
     * Runs copy string failure stack.
     * @param {object} args - Options.
     * @param {ReturnType<typeof JSON.parse>} args.error - Reported failure value.
     * @param {Error} args.normalizedError - Normalized error.
     * @returns {void}
     */
    _copyStringFailureStack({ error, normalizedError }) {
        if (this._hasStringFailure(error))
            normalizedError.stack = error;
    }
    /**
     * Drains all dispatchable jobs to ready workers, then arms the
     * scheduled-job timer for the next future `scheduled_at_ms`. Coalesces
     * concurrent triggers: a wake-up that lands while a drain is in
     * flight just sets a re-drain flag and lets the in-flight drain
     * re-loop after it finishes, so no signal is dropped but no two
     * drains run in parallel.
     *
     * Resilience: in beacon mode this is the sole wake-up path for
     * already-queued work, so a transient DB error during the drain (e.g.
     * `nextAvailableJob()` rejecting) must not strand the queue until the
     * next external signal. On any error we log it and arm a one-shot
     * retry via `_scheduleErrorRetry` using `pollIntervalMs` as the
     * cadence; on success the retry timer is cleared. Polling-mode runs
     * `_drain` from its own interval, so the retry timer is a no-op there.
     * @returns {Promise<void>}
     */
    async _drain() {
        if (this._stopped || this.lifecycleState !== "active" || !this._activeOwnershipReady)
            return;
        if (this._drainPromise) {
            this._redrainQueued = true;
            await this._drainPromise;
            return;
        }
        const drainPromise = this._drainToCompletion();
        this._drainPromise = drainPromise;
        await drainPromise;
    }
    /**
     * Runs one serialized drain lifecycle, including timer re-arming.
     * @returns {Promise<void>} - Resolves after every coalesced request is handled.
     */
    async _drainToCompletion() {
        this._draining = true;
        try {
            let errored;
            do {
                errored = await this._drainUntilIdle();
                await this._finishDrain({ errored });
            } while (!errored && this._redrainQueued && !this._stopped && this.lifecycleState === "active");
        }
        finally {
            this._draining = false;
            this._drainPromise = undefined;
        }
    }
    /**
     * Runs finish drain.
     * @param {object} args - Options.
     * @param {boolean} args.errored - Whether the drain hit an error.
     * @returns {Promise<void>} - Resolves after follow-up timers are handled.
     */
    async _finishDrain({ errored }) {
        if (this._stopped || this.lifecycleState !== "active")
            return;
        if (errored)
            return this._scheduleErrorRetry();
        await this._armScheduledTimerOrRetry();
    }
    /**
     * Runs arm scheduled timer or retry.
     * @returns {Promise<void>} - Resolves after scheduled timer handling.
     */
    async _armScheduledTimerOrRetry() {
        try {
            await this._armScheduledTimer();
        }
        catch (error) {
            this.logger.error(() => ["Background jobs scheduled-timer arming failed:", error]);
            this._scheduleErrorRetry();
            return;
        }
        this._clearErrorRetryTimer();
    }
    /**
     * Runs clear error retry timer.
     * @returns {void} */
    _clearErrorRetryTimer() {
        if (this.pendingHandoffRecoveries.size > 0)
            return;
        if (this._startupHandoffGraceElapsed && this.startupHandoffSnapshot.length > 0)
            return;
        for (const worker of this.workerHandoffs.keys()) {
            if (!this.workers.has(worker))
                return;
        }
        if (this._errorRetryTimer) {
            clearTimeout(this._errorRetryTimer);
            this._errorRetryTimer = undefined;
        }
    }
    /**
     * Runs drain until idle.
     * @returns {Promise<boolean>} - Whether the drain hit an error.
     */
    async _drainUntilIdle() {
        return await this._runDrainLoop();
    }
    /**
     * Runs run drain loop.
     * @returns {Promise<boolean>} - Whether the drain hit an error.
     */
    async _runDrainLoop() {
        do {
            this._redrainQueued = false;
            const errored = await this._drainOnceWithErrorReport();
            if (errored)
                return true;
        } while (this._redrainQueued && !this._stopped);
        return false;
    }
    /**
     * Runs drain once with error report.
     * @returns {Promise<boolean>} - Whether one drain pass failed.
     */
    async _drainOnceWithErrorReport() {
        try {
            await this._drainOnce();
            return false;
        }
        catch (error) {
            this.logger.error(() => ["Background jobs drain failed:", error]);
            return true;
        }
    }
    /**
     * Arms a one-shot `setTimeout` to retry `_drain` after a transient
     * failure. Idempotent — repeated calls while a retry is already
     * pending are no-ops. Polling mode already retries via its own
     * interval, so this is a no-op in that mode.
     * @returns {void}
     */
    _scheduleErrorRetry() {
        if (this._stopped)
            return;
        if (this._errorRetryTimer)
            return;
        if (this.dispatchStrategy === "polling" && this.lifecycleState === "active")
            return;
        this._errorRetryTimer = setTimeout(() => {
            this._errorRetryTimer = undefined;
            void this._retryAfterError();
        }, this.pollIntervalMs);
    }
    /**
     * Retries failed pre-dispatch and disconnected-socket releases before
     * draining queued work.
     * @returns {Promise<void>} - Resolves after retry work.
     */
    async _retryAfterError() {
        if (this._stopped)
            return;
        if (this._startupHandoffGraceElapsed && this.startupHandoffSnapshot.length > 0) {
            await this._startStartupHandoffReclaim();
            if (this.startupHandoffSnapshot.length > 0)
                return;
        }
        try {
            await this._retryPendingHandoffRecoveries();
        }
        catch {
            this._scheduleErrorRetry();
            return;
        }
        try {
            for (const worker of this.workerHandoffs.keys()) {
                if (!this.workers.has(worker))
                    await this._releaseWorkerHandoffs(worker);
            }
        }
        catch (error) {
            this._reportHandoffReleaseError(error);
            this._scheduleErrorRetry();
            return;
        }
        if (this.lifecycleState === "active")
            await this._drain();
        this._maybeStopRetired();
    }
    /**
     * Inner drain loop: pulls eligible queued jobs and hands them off to
     * ready workers until one of them runs out.
     * @returns {Promise<void>}
     */
    async _drainOnce() {
        while (this.readyWorkers.size > 0 && !this._stopped && this.lifecycleState === "active" && this._activeOwnershipReady) {
            const job = await this.nextAvailableJobForReadyWorkers();
            if (!job)
                return;
            const worker = this.readyWorkerForJob(job);
            if (!worker)
                return;
            const admission = this._consumeWorkerAdmission({ job, worker });
            const requestedHandoffId = randomUUID();
            let handoff;
            try {
                handoff = await this.store.markHandedOff({ handoffId: requestedHandoffId, jobId: job.id, workerId: worker.workerId });
            }
            catch (error) {
                this._rememberHandoffRecovery({ handoffId: requestedHandoffId, jobId: job.id });
                this._restoreWorkerAdmission({ ...admission, worker });
                try {
                    await this._recoverHandoff({ handoffId: requestedHandoffId, jobId: job.id });
                }
                catch (recoveryError) {
                    this._reportHandoffRecoveryError({ error: recoveryError, handoffId: requestedHandoffId, jobId: job.id });
                }
                throw error;
            }
            if (!handoff) {
                this._restoreWorkerAdmission({ ...admission, worker });
                continue;
            }
            await this.afterHandoffClaim?.({ handoff, job });
            const handoffs = this.workerHandoffs.get(worker);
            if (!handoffs || !this.workers.has(worker) || worker.isDraining || this.lifecycleState !== "active" || !this._activeOwnershipReady) {
                this._rememberHandoffRecovery({ handoffId: handoff.handoffId, jobId: job.id });
                try {
                    await this._recoverHandoff({ handoffId: handoff.handoffId, jobId: job.id });
                }
                catch (recoveryError) {
                    this._reportHandoffRecoveryError({ error: recoveryError, handoffId: handoff.handoffId, jobId: job.id });
                    throw recoveryError;
                }
                this._notifyEnqueued();
                this._redrainQueued = true;
                continue;
            }
            this._finalizeWorkerAdmission({ ...admission, job, worker });
            handoffs.set(job.id, handoff.handoffId);
            try {
                worker.send({
                    type: "job",
                    payload: {
                        id: job.id,
                        jobName: job.jobName,
                        args: job.args,
                        handoffId: handoff.handoffId,
                        workerId: worker.workerId,
                        handedOffAtMs: handoff.handedOffAtMs,
                        options: {
                            concurrencyKey: job.concurrencyKey || undefined,
                            executionMode: job.executionMode,
                            maxConcurrency: job.maxConcurrency ?? undefined,
                            maxRetries: job.maxRetries ?? undefined,
                            queue: job.queue,
                            scheduledAtMs: job.scheduledAtMs ?? undefined,
                            ...(job.timeoutMs === null ? {} : { timeoutMs: job.timeoutMs })
                        }
                    }
                });
            }
            catch (error) {
                this.logger.warn(() => ["Failed to send job to worker, re-queueing:", error]);
                try {
                    worker.close();
                }
                catch (closeError) {
                    this.logger.warn(() => ["Failed to close worker after job send failure:", closeError]);
                }
                await this._handleWorkerSocketClosed(worker, { queueRedrain: true });
            }
        }
    }
    /**
     * Consumes one advertised worker admission while persistence is in flight.
     * @param {object} args - Admission details.
     * @param {import("./types.js").BackgroundJobRow} args.job - Selected job.
     * @param {JsonSocket} args.worker - Selected worker socket.
     * @returns {{pooledCreditConsumed: boolean, readinessVersion: number}} - Reversible admission debit.
     */
    _consumeWorkerAdmission({ job, worker }) {
        let pooledCreditConsumed = false;
        this.readyWorkers.delete(worker);
        if (job.executionMode === "pooled" && worker.usesPooledCapacityCredits && worker.availablePooledSlots > 0) {
            pooledCreditConsumed = true;
            worker.availablePooledSlots -= 1;
            if (worker.availablePooledSlots > 0)
                this.readyWorkers.add(worker);
        }
        return { pooledCreditConsumed, readinessVersion: worker.readinessVersion };
    }
    /**
     * Restores an admission that never reached a worker. A newer readiness
     * advertisement is already authoritative, so its pooled count is not changed.
     * @param {object} args - Admission details.
     * @param {boolean} args.pooledCreditConsumed - Whether a pooled credit was debited.
     * @param {number} args.readinessVersion - Readiness generation at debit time.
     * @param {JsonSocket} args.worker - Selected worker socket.
     * @returns {void}
     */
    _restoreWorkerAdmission({ pooledCreditConsumed, readinessVersion, worker }) {
        if (this._stopped || this.lifecycleState !== "active" || !this._activeOwnershipReady || !this.workers.has(worker) || worker.isDraining)
            return;
        if (pooledCreditConsumed && worker.readinessVersion === readinessVersion) {
            worker.availablePooledSlots += 1;
        }
        if (worker.supportsHandoffIdReporting)
            this.readyWorkers.add(worker);
    }
    /**
     * Applies a successful pooled admission to a readiness advertisement that
     * arrived while persistence was in flight and replaced the earlier debit.
     * @param {object} args - Admission details.
     * @param {import("./types.js").BackgroundJobRow} args.job - Selected job.
     * @param {boolean} args.pooledCreditConsumed - Whether a pooled credit was debited.
     * @param {number} args.readinessVersion - Readiness generation at debit time.
     * @param {JsonSocket} args.worker - Selected worker socket.
     * @returns {void}
     */
    _finalizeWorkerAdmission({ job, pooledCreditConsumed, readinessVersion, worker }) {
        if (!pooledCreditConsumed || job.executionMode !== "pooled")
            return;
        if (worker.readinessVersion === readinessVersion || !worker.usesPooledCapacityCredits)
            return;
        if (worker.availablePooledSlots <= 0)
            return;
        worker.availablePooledSlots -= 1;
        if (worker.availablePooledSlots === 0)
            this.readyWorkers.delete(worker);
    }
    /**
     * Retains an exact lease for idempotent pre-dispatch recovery.
     * @param {{handoffId: string, jobId: string}} args - Exact recovery fence.
     * @returns {void}
     */
    _rememberHandoffRecovery({ handoffId, jobId }) {
        this.pendingHandoffRecoveries.set(handoffId, jobId);
    }
    /**
     * Returns one exact lease and forgets it only after the adapter acknowledges
     * the fenced transition or confirms it was already absent.
     * @param {{handoffId: string, jobId: string}} args - Exact recovery fence.
     * @returns {Promise<void>} - Resolves after durable recovery settles.
     */
    async _recoverHandoff({ handoffId, jobId }) {
        await this.store.markReturnedToQueue({ handoffId, jobId });
        if (this.pendingHandoffRecoveries.get(handoffId) === jobId) {
            this.pendingHandoffRecoveries.delete(handoffId);
        }
    }
    /**
     * Replays retained exact-ID recoveries through the dispatcher's existing
     * transient-error retry lifecycle.
     * @returns {Promise<void>} - Resolves after every retained recovery settles.
     */
    async _retryPendingHandoffRecoveries() {
        for (const [handoffId, jobId] of [...this.pendingHandoffRecoveries]) {
            try {
                await this._recoverHandoff({ handoffId, jobId });
            }
            catch (error) {
                this._reportHandoffRecoveryError({ error, handoffId, jobId });
                throw error;
            }
        }
    }
    /**
     * Surfaces a failed exact-ID recovery without dropping its retry ledger entry.
     * @param {object} args - Recovery failure.
     * @param {ReturnType<typeof JSON.parse>} args.error - Adapter failure.
     * @param {string} args.handoffId - Exact lease fence.
     * @param {string} args.jobId - Job id.
     * @returns {void}
     */
    _reportHandoffRecoveryError({ error, handoffId, jobId }) {
        const normalizedError = error instanceof Error ? error : new Error(String(error));
        const payload = {
            context: { handoffId, jobId, stage: "background-job-handoff-admission-recovery" },
            error: normalizedError
        };
        const errorEvents = this.configuration.getErrorEvents();
        this.logger.error(() => ["Failed to recover an ambiguous background job handoff:", normalizedError]);
        errorEvents.emit("framework-error", payload);
        errorEvents.emit("all-error", { ...payload, errorType: "framework-error" });
    }
    /**
     * Runs next available job for ready workers.
     * @returns {Promise<import("./types.js").BackgroundJobRow | null>} - Next queued job matching ready worker capacity.
     */
    async nextAvailableJobForReadyWorkers() {
        const executionModes = this.readyWorkerExecutionModes();
        if (executionModes.length === 0)
            return null;
        if (executionModes.length === WORKER_EXECUTION_MODE_CAPABILITIES.length)
            return await this.store.nextAvailableJob();
        return await this.store.nextAvailableJob({ executionMode: executionModes });
    }
    /**
     * Runs ready worker execution modes.
     * @returns {import("./types.js").BackgroundJobExecutionMode[]} - Execution modes currently accepted by ready workers.
     */
    readyWorkerExecutionModes() {
        const executionModes = new Set();
        for (const worker of this.readyWorkers) {
            this._addAcceptedExecutionModes({ executionModes, worker });
        }
        return /** @type {import("./types.js").BackgroundJobExecutionMode[]} */ ([...executionModes]);
    }
    /**
     * Runs add accepted execution modes.
     * @param {object} args - Options.
     * @param {Set<import("./types.js").BackgroundJobExecutionMode>} args.executionModes - Accepted modes.
     * @param {JsonSocket} args.worker - Worker socket.
     * @returns {void}
     */
    _addAcceptedExecutionModes({ executionModes, worker }) {
        if (!worker.supportsHandoffIdReporting)
            return;
        for (const capability of WORKER_EXECUTION_MODE_CAPABILITIES) {
            if (capability.accepts(worker))
                executionModes.add(capability.executionMode);
        }
    }
    /**
     * Runs ready worker for job.
     * @param {import("./types.js").BackgroundJobRow} job - Job being handed off.
     * @returns {JsonSocket | undefined} - Ready worker for the job type.
     */
    readyWorkerForJob(job) {
        for (const worker of this.readyWorkers) {
            if (this._workerAcceptsJob({ job, worker }))
                return worker;
        }
    }
    /**
     * Runs worker accepts job.
     * @param {object} args - Options.
     * @param {import("./types.js").BackgroundJobRow} args.job - Job being handed off.
     * @param {JsonSocket} args.worker - Worker socket.
     * @returns {boolean} - Whether the worker accepts the job mode.
     */
    _workerAcceptsJob({ job, worker }) {
        if (!worker.supportsHandoffIdReporting)
            return false;
        const capability = WORKER_EXECUTION_MODE_CAPABILITIES_BY_MODE.get(job.executionMode);
        if (!capability)
            return false;
        return capability.accepts(worker);
    }
    /**
     * Arms a single `setTimeout` for the soonest future-scheduled job's
     * `scheduled_at_ms`. Replaces the second responsibility of the legacy
     * 1-second poll (becoming-eligible scheduled jobs). The timer is
     * idempotently re-armed at the end of every drain.
     * @returns {Promise<void>}
     */
    async _armScheduledTimer() {
        if (this._scheduledTimer) {
            clearTimeout(this._scheduledTimer);
            this._scheduledTimer = undefined;
        }
        if (this._stopped || this.lifecycleState !== "active" || !this._activeOwnershipReady)
            return;
        if (this.dispatchStrategy === "polling")
            return;
        const next = await this.store.nextScheduledJob();
        let delay;
        if (next && typeof next.scheduledAtMs === "number") {
            delay = Math.max(0, Math.min(next.scheduledAtMs - this.clock.now(), MAX_TIMER_MS));
        }
        // `nextScheduledJob` only returns future jobs, so a job that became
        // eligible after the drain's eligible-job probe is invisible to it. If one
        // is dispatchable now, arm a 0-delay re-drain so it is dispatched
        // immediately instead of being stranded until the next future timer (or
        // external signal) fires.
        if (await this.nextAvailableJobForReadyWorkers())
            delay = 0;
        if (typeof delay !== "number")
            return;
        this._scheduledTimer = setTimeout(() => {
            this._scheduledTimer = undefined;
            void this._drain();
        }, delay);
    }
    async _sweepOrphans() {
        try {
            let orphanedJobs;
            if (this.generationId) {
                const connectedWorkerIds = new Set();
                for (const worker of this.workers) {
                    if (worker.workerId)
                        connectedWorkerIds.add(worker.workerId);
                }
                for (const workerId of this.disconnectedWorkers.keys())
                    connectedWorkerIds.add(workerId);
                const cutoff = this.clock.now() - GENERATION_ORPHANED_AFTER_MS;
                const handoffs = (await this._generationOwnedHandoffSnapshot()).filter((handoff) => {
                    return handoff.handedOffAtMs <= cutoff && !connectedWorkerIds.has(handoff.workerId);
                });
                orphanedJobs = handoffs.length === 0
                    ? []
                    : await this.store.markOrphanedHandoffs({ handoffs, error: "Job orphaned after its generation owner disappeared" });
            }
            else {
                orphanedJobs = await this.store.markOrphanedJobs();
            }
            await this._handleOrphanedJobs({ jobs: orphanedJobs, warning: "Marked orphaned background jobs" });
        }
        catch (error) {
            const normalizedError = error instanceof Error ? error : new Error(String(error));
            const payload = { context: { generationId: this.generationId, stage: "background-job-orphan-sweep" }, error: normalizedError };
            const errorEvents = this.configuration.getErrorEvents();
            this.logger.error(() => ["Failed to mark orphaned jobs:", normalizedError]);
            errorEvents.emit("framework-error", payload);
            errorEvents.emit("all-error", { ...payload, errorType: "framework-error" });
        }
    }
    /**
     * Publishes the common post-orphan lifecycle: wake queued retries, emit one
     * isolated event per accepted transition, and drain so released concurrency
     * can immediately admit other work.
     * @param {object} args - Options.
     * @param {import("./types.js").BackgroundJobRow[]} args.jobs - Accepted orphan transitions.
     * @param {string} args.warning - Lifecycle log message.
     * @returns {Promise<void>} - Resolves after the resulting drain.
     */
    async _handleOrphanedJobs({ jobs, warning }) {
        if (jobs.length === 0) {
            this._maybeStopRetired();
            return;
        }
        this.logger.warn(() => [warning, jobs.length]);
        // Reclaimed orphans can become `queued` again — wake the dispatcher first
        // so an application event handler that throws below cannot strand them.
        this._notifyEnqueued();
        // Emit before awaiting the drain so a blocked dispatcher cannot delay
        // application recovery. Isolate handlers so one cannot suppress the rest.
        for (const job of jobs) {
            try {
                this._emitBackgroundJobOrphaned({ job });
            }
            catch (error) {
                this.logger.error(() => ["A background-job-orphaned event handler threw:", error]);
            }
        }
        await this._drain();
        this._maybeStopRetired();
    }
    /**
     * Drops workers that have gone silent past `workerStaleTimeoutMs` (no
     * heartbeat, ready, or report). A wedged worker keeps its socket open, so the
     * `close`-based cleanup never fires and its in-flight leases — and the whole
     * queue — stay stuck until a human notices. Releasing the lost worker's
     * leases lets its jobs run elsewhere and stops dispatch to it; the worker's
     * own process lifecycle is the supervisor's concern.
     * @returns {Promise<void>} - Resolves after the sweep.
     */
    async _sweepStaleWorkers() {
        if (this._stopped)
            return;
        const cutoff = this.clock.now() - this.workerStaleTimeoutMs;
        /** @type {JsonSocket[]} */
        const stale = [];
        for (const worker of this.workers) {
            // Only evict heartbeat-capable workers. A legacy worker (e.g. one from the
            // previous release during a rolling deploy) never heartbeats, so evicting
            // it on silence would wrongly release the leases of a job it is still
            // running. Its disconnect is still handled by the socket `close` path.
            if (!worker.supportsHeartbeat)
                continue;
            const lastSeenAt = typeof worker.lastSeenAt === "number" ? worker.lastSeenAt : 0;
            if (lastSeenAt <= cutoff)
                stale.push(worker);
        }
        for (const worker of stale) {
            this.logger.warn(() => ["Dropping stale background jobs worker", { workerId: worker.workerId, lastSeenAt: worker.lastSeenAt }]);
            try {
                worker.close();
            }
            catch {
                // Already closing; the lease release below is what matters.
            }
            await this._handleWorkerSocketClosed(worker);
        }
    }
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoibWFpbi5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uLy4uLy4uL3NyYy9iYWNrZ3JvdW5kLWpvYnMvbWFpbi5qcyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiQUFBQSxZQUFZO0FBRVosT0FBTyxFQUFFLFVBQVUsRUFBRSxNQUFNLFFBQVEsQ0FBQTtBQUNuQyxPQUFPLEdBQUcsTUFBTSxLQUFLLENBQUE7QUFDckIsT0FBTyxVQUFVLE1BQU0sa0JBQWtCLENBQUE7QUFDekMsT0FBTyx1QkFBdUIsTUFBTSxnQkFBZ0IsQ0FBQTtBQUNwRCxPQUFPLE1BQU0sTUFBTSxjQUFjLENBQUE7QUFDakMsT0FBTyw4QkFBOEIsTUFBTSwyQ0FBMkMsQ0FBQTtBQUN0RixPQUFPLGNBQWMsTUFBTSx1QkFBdUIsQ0FBQTtBQUNsRCxPQUFPLGlCQUFpQixFQUFFLEVBQUUsZ0JBQWdCLEVBQUUsTUFBTSxnQ0FBZ0MsQ0FBQTtBQUNwRixPQUFPLEVBQUUsb0JBQW9CLEVBQUUsMkJBQTJCLEVBQUUsTUFBTSwwQkFBMEIsQ0FBQTtBQUM1RixPQUFPLG9DQUFvQyxNQUFNLCtCQUErQixDQUFBO0FBRWhGOzs7OztHQUtHO0FBQ0g7Ozs7OztHQU1HO0FBQ0gsTUFBTSxnQkFBZ0IsR0FBRyxvQ0FBb0MsQ0FBQTtBQUU3RDs7OztHQUlHO0FBQ0gsTUFBTSxZQUFZLEdBQUcsYUFBYSxDQUFBLENBQUMsYUFBYTtBQUNoRCwrRUFBK0U7QUFDL0UsTUFBTSx1QkFBdUIsR0FBRyxLQUFLLENBQUE7QUFDckMsc0RBQXNEO0FBQ3RELE1BQU0sd0JBQXdCLEdBQUcsS0FBSyxDQUFBO0FBQ3RDLHlGQUF5RjtBQUN6RixNQUFNLHlCQUF5QixHQUFHLEtBQUssQ0FBQTtBQUN2QyxNQUFNLDRCQUE0QixHQUFHLEVBQUUsR0FBRyxFQUFFLEdBQUcsSUFBSSxDQUFBO0FBQ25ELE1BQU0seUNBQXlDLEdBQUcsMkRBQTJELFlBQVksRUFBRSxDQUFBO0FBRTNIOzs7OztHQUtHO0FBQ0gsU0FBUywrQkFBK0IsQ0FBQyxzQkFBc0I7SUFDN0QsSUFBSSxzQkFBc0IsS0FBSyxTQUFTO1FBQUUsT0FBTyx5QkFBeUIsQ0FBQTtJQUMxRSxJQUFJLENBQUMsTUFBTSxDQUFDLFNBQVMsQ0FBQyxzQkFBc0IsQ0FBQyxJQUFJLHNCQUFzQixHQUFHLENBQUMsSUFBSSxzQkFBc0IsR0FBRyxZQUFZLEVBQUUsQ0FBQztRQUNySCxNQUFNLElBQUksU0FBUyxDQUFDLHlDQUF5QyxDQUFDLENBQUE7SUFDaEUsQ0FBQztJQUVELE9BQU8sc0JBQXNCLENBQUE7QUFDL0IsQ0FBQztBQUNEOzs2Q0FFNkM7QUFDN0MsTUFBTSxrQ0FBa0MsR0FBRztJQUN6QyxFQUFDLGFBQWEsRUFBRSxRQUFRLEVBQUUsT0FBTyxFQUFFLENBQUMsTUFBTSxFQUFFLEVBQUUsQ0FBQyxNQUFNLENBQUMsaUJBQWlCLEtBQUssS0FBSyxFQUFDO0lBQ2xGLEVBQUMsYUFBYSxFQUFFLFFBQVEsRUFBRSxPQUFPLEVBQUUsQ0FBQyxNQUFNLEVBQUUsRUFBRSxDQUFDLE1BQU0sQ0FBQyxpQkFBaUIsS0FBSyxLQUFLLEVBQUM7SUFDbEYsMkVBQTJFO0lBQzNFLDhFQUE4RTtJQUM5RSw4RUFBOEU7SUFDOUUsNkVBQTZFO0lBQzdFLHlFQUF5RTtJQUN6RSxFQUFDLGFBQWEsRUFBRSxRQUFRLEVBQUUsT0FBTyxFQUFFLENBQUMsTUFBTSxFQUFFLEVBQUUsQ0FBQyxNQUFNLENBQUMsaUJBQWlCLEtBQUssSUFBSSxJQUFJLENBQUMsQ0FBQyxNQUFNLENBQUMseUJBQXlCLElBQUksTUFBTSxDQUFDLG9CQUFvQixHQUFHLENBQUMsQ0FBQyxFQUFDO0lBQzNKLEVBQUMsYUFBYSxFQUFFLFNBQVMsRUFBRSxPQUFPLEVBQUUsQ0FBQyxNQUFNLEVBQUUsRUFBRSxDQUFDLE1BQU0sQ0FBQyxrQkFBa0IsS0FBSyxLQUFLLEVBQUM7Q0FDckYsQ0FBQTtBQUNELE1BQU0sMENBQTBDLEdBQUcsSUFBSSxHQUFHLENBQ3hELGtDQUFrQyxDQUFDLEdBQUcsQ0FBQyxDQUFDLFVBQVUsRUFBRSxFQUFFLENBQUMsQ0FBQyxVQUFVLENBQUMsYUFBYSxFQUFFLFVBQVUsQ0FBQyxDQUFDLENBQy9GLENBQUE7QUFFRCxNQUFNLENBQUMsT0FBTyxPQUFPLGtCQUFrQjtJQUNyQzs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7OztPQXNCRztJQUNILFlBQVksRUFBQyxhQUFhLEVBQUUsSUFBSSxFQUFFLElBQUksRUFBRSxZQUFZLEVBQUUsb0JBQW9CLEVBQUUsc0JBQXNCLEVBQUUsOEJBQThCLEVBQUUsbUJBQW1CLEVBQUUsMkJBQTJCLEVBQUUsb0JBQW9CLEVBQUUscUJBQXFCLEVBQUUsc0JBQXNCLEVBQUUsOEJBQThCLEdBQUcsSUFBSSxFQUFFLFNBQVMsRUFBRSxpQkFBaUIsRUFBRSxhQUFhLEVBQUUsaUJBQWlCLEVBQUUsb0JBQW9CLEVBQUUsd0JBQXdCLEVBQUUsMEJBQTBCLEVBQUUsWUFBWSxFQUFFLEtBQUssRUFBQztRQUNoYyxJQUFJLENBQUMsYUFBYSxHQUFHLGFBQWEsQ0FBQTtRQUNsQyxJQUFJLENBQUMsOEJBQThCLEdBQUcsOEJBQThCLENBQUE7UUFDcEUsSUFBSSxDQUFDLFNBQVMsR0FBRyxTQUFTLENBQUE7UUFDMUIsSUFBSSxDQUFDLGlCQUFpQixHQUFHLGlCQUFpQixDQUFBO1FBQzFDLElBQUksQ0FBQyxhQUFhLEdBQUcsYUFBYSxDQUFBO1FBQ2xDLElBQUksQ0FBQyxpQkFBaUIsR0FBRyxpQkFBaUIsQ0FBQTtRQUMxQyxJQUFJLENBQUMsb0JBQW9CLEdBQUcsb0JBQW9CLENBQUE7UUFDaEQsSUFBSSxDQUFDLHdCQUF3QixHQUFHLHdCQUF3QixDQUFBO1FBQ3hELElBQUksQ0FBQywwQkFBMEIsR0FBRywwQkFBMEIsQ0FBQTtRQUM1RCxJQUFJLENBQUMsWUFBWSxHQUFHLFlBQVksQ0FBQTtRQUNoQyxJQUFJLENBQUMsS0FBSyxHQUFHO1lBQ1gsWUFBWSxFQUFFLEtBQUssRUFBRSxZQUFZLElBQUksQ0FBQyxDQUFDLE9BQU8sRUFBRSxFQUFFLENBQUMsWUFBWSxDQUFDLE9BQU8sQ0FBQyxDQUFDO1lBQ3pFLEdBQUcsRUFBRSxLQUFLLEVBQUUsR0FBRyxJQUFJLENBQUMsR0FBRyxFQUFFLENBQUMsSUFBSSxDQUFDLEdBQUcsRUFBRSxDQUFDO1lBQ3JDLFVBQVUsRUFBRSxLQUFLLEVBQUUsVUFBVSxJQUFJLENBQUMsQ0FBQyxRQUFRLEVBQUUsT0FBTyxFQUFFLEVBQUUsQ0FBQyxVQUFVLENBQUMsUUFBUSxFQUFFLE9BQU8sQ0FBQyxDQUFDO1NBQ3hGLENBQUE7UUFDRCxNQUFNLE1BQU0sR0FBRyxhQUFhLENBQUMsdUJBQXVCLEVBQUUsQ0FBQTtRQUN0RCxNQUFNLGdCQUFnQixHQUFHLGFBQWEsQ0FBQyxxQ0FBcUMsQ0FBQztZQUMzRSxZQUFZLEVBQUUsb0JBQW9CO1lBQ2xDLHNCQUFzQixFQUFFLDhCQUE4QjtZQUN0RCxtQkFBbUIsRUFBRSwyQkFBMkI7WUFDaEQsVUFBVSxFQUFFLG9CQUFvQjtTQUNqQyxDQUFDLENBQUE7UUFDRixJQUFJLENBQUMsWUFBWSxHQUFHLGdCQUFnQixDQUFDLFlBQVksQ0FBQTtRQUNqRCxJQUFJLENBQUMsc0JBQXNCLEdBQUcsZ0JBQWdCLENBQUMsc0JBQXNCLENBQUE7UUFDckUsSUFBSSxDQUFDLG1CQUFtQixHQUFHLGdCQUFnQixDQUFDLG1CQUFtQixDQUFBO1FBQy9ELDBFQUEwRTtRQUMxRSxJQUFJLENBQUMsY0FBYyxHQUFHLFVBQVUsQ0FBQTtRQUNoQyxJQUFJLENBQUMscUJBQXFCLEdBQUcsS0FBSyxDQUFBO1FBQ2xDLHdDQUF3QztRQUN4QyxJQUFJLENBQUMsa0JBQWtCLEdBQUcsU0FBUyxDQUFBO1FBQ25DLHdDQUF3QztRQUN4QyxJQUFJLENBQUMsa0JBQWtCLEdBQUcsU0FBUyxDQUFBO1FBQ25DLDhCQUE4QjtRQUM5QixJQUFJLENBQUMscUJBQXFCLEdBQUcsSUFBSSxHQUFHLEVBQUUsQ0FBQTtRQUN0QywrRkFBK0Y7UUFDL0YsSUFBSSxDQUFDLG1CQUFtQixHQUFHLElBQUksR0FBRyxFQUFFLENBQUE7UUFDcEMsSUFBSSxDQUFDLHVCQUF1QixHQUFHLENBQUMsQ0FBQTtRQUNoQyxJQUFJLENBQUMsd0JBQXdCLEdBQUcsQ0FBQyxDQUFBO1FBQ2pDOzs7V0FHRztRQUNILElBQUksQ0FBQyxlQUFlLEdBQUcsR0FBRyxFQUFFLEdBQUUsQ0FBQyxDQUFBO1FBQy9CLElBQUksQ0FBQyxlQUFlLEdBQUcsSUFBSSxPQUFPLENBQUMsQ0FBQyxvQ0FBb0MsQ0FBQyxPQUFPLEVBQUUsRUFBRSxHQUFHLElBQUksQ0FBQyxlQUFlLEdBQUcsT0FBTyxDQUFBLENBQUMsQ0FBQyxDQUFDLENBQUE7UUFDeEgsSUFBSSxDQUFDLElBQUksR0FBRyxJQUFJLElBQUksTUFBTSxDQUFDLElBQUksQ0FBQTtRQUMvQixJQUFJLENBQUMsSUFBSSxHQUFHLE9BQU8sSUFBSSxLQUFLLFFBQVEsQ0FBQyxDQUFDLENBQUMsSUFBSSxDQUFDLENBQUMsQ0FBQyxNQUFNLENBQUMsSUFBSSxDQUFBO1FBQ3pELElBQUksQ0FBQyxnQkFBZ0IsR0FBRyxNQUFNLENBQUMsZ0JBQWdCLENBQUE7UUFDL0MsSUFBSSxDQUFDLGNBQWMsR0FBRyxNQUFNLENBQUMsY0FBYyxDQUFBO1FBQzNDLElBQUksQ0FBQyxTQUFTLEdBQUcsTUFBTSxDQUFDLFNBQVMsQ0FBQTtRQUNqQyx5RUFBeUU7UUFDekUsNkVBQTZFO1FBQzdFLElBQUksQ0FBQyxvQkFBb0IsR0FBRyxPQUFPLG9CQUFvQixLQUFLLFFBQVEsSUFBSSxvQkFBb0IsSUFBSSxDQUFDLENBQUMsQ0FBQyxDQUFDLG9CQUFvQixDQUFDLENBQUMsQ0FBQyx1QkFBdUIsQ0FBQTtRQUNsSixJQUFJLENBQUMscUJBQXFCLEdBQUcsT0FBTyxxQkFBcUIsS0FBSyxRQUFRLElBQUkscUJBQXFCLElBQUksQ0FBQyxDQUFDLENBQUMsQ0FBQyxxQkFBcUIsQ0FBQyxDQUFDLENBQUMsd0JBQXdCLENBQUE7UUFDdkosSUFBSSxDQUFDLHNCQUFzQixHQUFHLCtCQUErQixDQUFDLHNCQUFzQixDQUFDLENBQUE7UUFDckYseURBQXlEO1FBQ3pELElBQUksQ0FBQyxPQUFPLEdBQUcsU0FBUyxDQUFBO1FBQ3hCLElBQUksQ0FBQyxNQUFNLEdBQUcsSUFBSSxNQUFNLENBQUMsSUFBSSxDQUFDLENBQUE7UUFDOUI7O3FDQUU2QjtRQUM3QixJQUFJLENBQUMsT0FBTyxHQUFHLElBQUksR0FBRyxFQUFFLENBQUE7UUFDeEIsOEJBQThCO1FBQzlCLElBQUksQ0FBQyxXQUFXLEdBQUcsSUFBSSxHQUFHLEVBQUUsQ0FBQTtRQUM1Qjs7cUNBRTZCO1FBQzdCLElBQUksQ0FBQyxZQUFZLEdBQUcsSUFBSSxHQUFHLEVBQUUsQ0FBQTtRQUM3Qjs7MERBRWtEO1FBQ2xELElBQUksQ0FBQyxjQUFjLEdBQUcsSUFBSSxHQUFHLEVBQUUsQ0FBQTtRQUMvQjs7Ozt5Q0FJaUM7UUFDakMsSUFBSSxDQUFDLHdCQUF3QixHQUFHLElBQUksR0FBRyxFQUFFLENBQUE7UUFDekM7Ozt3Q0FHZ0M7UUFDaEMsSUFBSSxDQUFDLDhCQUE4QixHQUFHLElBQUksR0FBRyxFQUFFLENBQUE7UUFDL0M7Ozs7V0FJRztRQUNILElBQUksQ0FBQyxvQkFBb0IsR0FBRyxJQUFJLEdBQUcsRUFBRSxDQUFBO1FBQ3JDLGtFQUFrRTtRQUNsRSxJQUFJLENBQUMsc0JBQXNCLEdBQUcsRUFBRSxDQUFBO1FBQ2hDLDhCQUE4QjtRQUM5QixJQUFJLENBQUMsa0NBQWtDLEdBQUcsRUFBRSxDQUFBO1FBQzVDLElBQUksQ0FBQywyQkFBMkIsR0FBRyxLQUFLLENBQUE7UUFDeEM7OzRDQUVvQztRQUNwQyxJQUFJLENBQUMsTUFBTSxHQUFHLFNBQVMsQ0FBQTtRQUN2Qjs7K0RBRXVEO1FBQ3ZELElBQUksQ0FBQyxVQUFVLEdBQUcsU0FBUyxDQUFBO1FBQzNCOzsrREFFdUQ7UUFDdkQsSUFBSSxDQUFDLGVBQWUsR0FBRyxTQUFTLENBQUE7UUFDaEM7OytEQUV1RDtRQUN2RCxJQUFJLENBQUMsZ0JBQWdCLEdBQUcsU0FBUyxDQUFBO1FBQ2pDOzsrREFFdUQ7UUFDdkQsSUFBSSxDQUFDLFlBQVksR0FBRyxTQUFTLENBQUE7UUFDN0I7O2dFQUV3RDtRQUN4RCxJQUFJLENBQUMsaUJBQWlCLEdBQUcsU0FBUyxDQUFBO1FBQ2xDLGlFQUFpRTtRQUNqRSxJQUFJLENBQUMsMkJBQTJCLEdBQUcsU0FBUyxDQUFBO1FBQzVDLHdDQUF3QztRQUN4QyxJQUFJLENBQUMsNkJBQTZCLEdBQUcsU0FBUyxDQUFBO1FBQzlDOzt5REFFaUQ7UUFDakQsSUFBSSxDQUFDLFNBQVMsR0FBRyxTQUFTLENBQUE7UUFDMUIsSUFBSSxDQUFDLFNBQVMsR0FBRyxLQUFLLENBQUE7UUFDdEIsSUFBSSxDQUFDLGNBQWMsR0FBRyxLQUFLLENBQUE7UUFDM0Isd0NBQXdDO1FBQ3hDLElBQUksQ0FBQyxhQUFhLEdBQUcsU0FBUyxDQUFBO1FBQzlCLElBQUksQ0FBQyxRQUFRLEdBQUcsS0FBSyxDQUFBO1FBQ3JCLHdDQUF3QztRQUN4QyxJQUFJLENBQUMsV0FBVyxHQUFHLFNBQVMsQ0FBQTtRQUM1Qjs7OENBRXNDO1FBQ3RDLElBQUksQ0FBQyxrQkFBa0IsR0FBRyxTQUFTLENBQUE7UUFDbkM7OzJGQUVtRjtRQUNuRixJQUFJLENBQUMscUJBQXFCLEdBQUcsU0FBUyxDQUFBO1FBQ3RDOzswSEFFa0g7UUFDbEgsSUFBSSxDQUFDLGFBQWEsR0FBRyxTQUFTLENBQUE7UUFDOUIsK0RBQStEO1FBQy9ELElBQUksQ0FBQyxzQkFBc0IsR0FBRyxTQUFTLENBQUE7SUFDekMsQ0FBQztJQUVEOzs7T0FHRztJQUNILElBQUksS0FBSztRQUNQLElBQUksQ0FBQyxJQUFJLENBQUMsT0FBTztZQUFFLE1BQU0sSUFBSSxLQUFLLENBQUMsbURBQW1ELENBQUMsQ0FBQTtRQUV2RixPQUFPLElBQUksQ0FBQyxPQUFPLENBQUE7SUFDckIsQ0FBQztJQUVEOzs7T0FHRztJQUNILElBQUksS0FBSyxDQUFDLE9BQU87UUFDZixJQUFJLENBQUMsT0FBTyxHQUFHLE9BQU8sQ0FBQTtJQUN4QixDQUFDO0lBRUQ7OztPQUdHO0lBQ0gsS0FBSyxDQUFDLEtBQUs7UUFDVCxJQUFJLENBQUMsUUFBUSxHQUFHLEtBQUssQ0FBQTtRQUNyQixJQUFJLENBQUMsV0FBVyxHQUFHLFNBQVMsQ0FBQTtRQUM1QixJQUFJLENBQUMscUJBQXFCLEdBQUcsS0FBSyxDQUFBO1FBQ2xDLElBQUksQ0FBQyxjQUFjLEdBQUcsVUFBVSxDQUFBO1FBQ2hDLElBQUksQ0FBQyxlQUFlLEdBQUcsSUFBSSxPQUFPLENBQUMsQ0FBQyxvQ0FBb0MsQ0FBQyxPQUFPLEVBQUUsRUFBRSxHQUFHLElBQUksQ0FBQyxlQUFlLEdBQUcsT0FBTyxDQUFBLENBQUMsQ0FBQyxDQUFDLENBQUE7UUFDeEgsSUFBSSxDQUFDLG9CQUFvQixDQUFDLEtBQUssRUFBRSxDQUFBO1FBQ2pDLElBQUksQ0FBQyxzQkFBc0IsR0FBRyxFQUFFLENBQUE7UUFDaEMsSUFBSSxDQUFDLGtDQUFrQyxHQUFHLEVBQUUsQ0FBQTtRQUM1QyxJQUFJLENBQUMsMkJBQTJCLEdBQUcsS0FBSyxDQUFBO1FBQ3hDLElBQUksQ0FBQyw2QkFBNkIsR0FBRyxTQUFTLENBQUE7UUFDOUMsSUFBSSxDQUFDLGFBQWEsQ0FBQyxVQUFVLEVBQUUsQ0FBQTtRQUUvQixJQUFJLENBQUM7WUFDSCxNQUFNLElBQUksQ0FBQyxhQUFhLENBQUMsVUFBVSxDQUFDLEVBQUMsSUFBSSxFQUFFLHNCQUFzQixFQUFDLENBQUMsQ0FBQTtZQUNuRSxNQUFNLElBQUksQ0FBQyxhQUFhLENBQUMsYUFBYSxDQUFDLEVBQUMsUUFBUSxFQUFFLHNCQUFzQixFQUFDLENBQUMsQ0FBQTtZQUUxRSxJQUFJLENBQUMsSUFBSSxDQUFDLE9BQU8sRUFBRSxDQUFDO2dCQUNsQixJQUFJLENBQUMsT0FBTyxHQUFHLE1BQU0sSUFBSSxDQUFDLGFBQWEsQ0FBQyxpQ0FBaUMsRUFBRSxDQUFBO1lBQzdFLENBQUM7WUFDRCxJQUFJLElBQUksQ0FBQyxZQUFZLElBQUksQ0FBQyxJQUFJLENBQUMsT0FBTyxDQUFDLGdDQUFnQyxFQUFFLEVBQUUsQ0FBQztnQkFDMUUsTUFBTSxJQUFJLEtBQUssQ0FBQyxvRkFBb0YsQ0FBQyxDQUFBO1lBQ3ZHLENBQUM7WUFFRCxJQUFJLENBQUMsSUFBSSxDQUFDLFlBQVksSUFBSSxJQUFJLENBQUMsc0JBQXNCLEtBQUssV0FBVyxFQUFFLENBQUM7Z0JBQ3RFLElBQUksQ0FBQyxzQkFBc0IsR0FBRyxNQUFNLElBQUksQ0FBQywrQkFBK0IsRUFBRSxDQUFBO1lBQzVFLENBQUM7WUFDRCxNQUFNLE1BQU0sR0FBRyxHQUFHLENBQUMsWUFBWSxDQUFDLENBQUMsTUFBTSxFQUFFLEVBQUUsQ0FBQyxJQUFJLENBQUMsaUJBQWlCLENBQUMsTUFBTSxDQUFDLENBQUMsQ0FBQTtZQUMzRSxJQUFJLENBQUMsTUFBTSxHQUFHLE1BQU0sQ0FBQTtZQUVwQixNQUFNLElBQUksT0FBTyxDQUFDLENBQUMsT0FBTyxFQUFFLE1BQU0sRUFBRSxFQUFFO2dCQUNwQyxNQUFNLENBQUMsSUFBSSxDQUFDLE9BQU8sRUFBRSxNQUFNLENBQUMsQ0FBQTtnQkFDNUIsTUFBTSxDQUFDLE1BQU0sQ0FBQyxJQUFJLENBQUMsSUFBSSxFQUFFLElBQUksQ0FBQyxJQUFJLEVBQUUsR0FBRyxFQUFFLENBQUMsT0FBTyxDQUFDLFNBQVMsQ0FBQyxDQUFDLENBQUE7WUFDL0QsQ0FBQyxDQUFDLENBQUE7WUFFRixNQUFNLE9BQU8sR0FBRyxNQUFNLENBQUMsT0FBTyxFQUFFLENBQUE7WUFDaEMsSUFBSSxPQUFPLElBQUksT0FBTyxPQUFPLEtBQUssUUFBUSxFQUFFLENBQUM7Z0JBQzNDLElBQUksQ0FBQyxJQUFJLEdBQUcsT0FBTyxDQUFDLElBQUksQ0FBQTtZQUMxQixDQUFDO1lBRUQsSUFBSSxDQUFDLGNBQWMsR0FBRyxJQUFJLENBQUMsWUFBWSxDQUFDLENBQUMsQ0FBQyxJQUFJLENBQUMsc0JBQXNCLENBQUMsQ0FBQyxDQUFDLFFBQVEsQ0FBQTtZQUVoRixJQUFJLElBQUksQ0FBQyxZQUFZLElBQUksSUFBSSxDQUFDLG1CQUFtQixFQUFFLENBQUM7Z0JBQ2xELElBQUksQ0FBQyxzQkFBc0IsR0FBRyxJQUFJLG9DQUFvQyxDQUFDO29CQUNyRSxhQUFhLEVBQUUsSUFBSSxDQUFDLGFBQWE7b0JBQ2pDLFlBQVksRUFBRSxJQUFJLENBQUMsWUFBWTtvQkFDL0IsSUFBSSxFQUFFLElBQUk7b0JBQ1YsVUFBVSxFQUFFLElBQUksQ0FBQyxtQkFBbUI7aUJBQ3JDLENBQUMsQ0FBQTtnQkFDRixNQUFNLElBQUksQ0FBQyxzQkFBc0IsQ0FBQyxLQUFLLEVBQUUsQ0FBQTtZQUMzQyxDQUFDO1lBRUQsSUFBSSxDQUFDLGlCQUFpQixHQUFHLFdBQVcsQ0FBQyxHQUFHLEVBQUU7Z0JBQ3hDLEtBQUssSUFBSSxDQUFDLGtCQUFrQixFQUFFLENBQUE7WUFDaEMsQ0FBQyxFQUFFLElBQUksQ0FBQyxxQkFBcUIsQ0FBQyxDQUFBO1lBRTlCLElBQUksSUFBSSxDQUFDLGNBQWMsS0FBSyxRQUFRLEVBQUUsQ0FBQztnQkFDckMsTUFBTSxJQUFJLENBQUMscUJBQXFCLEVBQUUsQ0FBQTtZQUNwQyxDQUFDO2lCQUFNLElBQUksSUFBSSxDQUFDLGNBQWMsS0FBSyxTQUFTLEVBQUUsQ0FBQztnQkFDN0MsSUFBSSxDQUFDLGlDQUFpQyxFQUFFLENBQUE7WUFDMUMsQ0FBQztRQUNILENBQUM7UUFBQyxPQUFPLEtBQUssRUFBRSxDQUFDO1lBQ2YsSUFBSSxZQUFZLENBQUE7WUFFaEIsSUFBSSxDQUFDO2dCQUNILE1BQU0sSUFBSSxDQUFDLElBQUksRUFBRSxDQUFBO1lBQ25CLENBQUM7WUFBQyxPQUFPLGtCQUFrQixFQUFFLENBQUM7Z0JBQzVCLFlBQVksR0FBRyxrQkFBa0IsQ0FBQTtZQUNuQyxDQUFDO1lBRUQsSUFBSSxZQUFZLEVBQUUsQ0FBQztnQkFDakIsTUFBTSxJQUFJLGNBQWMsQ0FDdEIsQ0FBQyxLQUFLLEVBQUUsWUFBWSxDQUFDLEVBQ3JCLGlEQUFpRCxFQUNqRCxFQUFDLEtBQUssRUFBRSxLQUFLLEVBQUMsQ0FDZixDQUFBO1lBQ0gsQ0FBQztZQUVELE1BQU0sS0FBSyxDQUFBO1FBQ2IsQ0FBQztJQUNILENBQUM7SUFFRDs7O09BR0c7SUFDSCxJQUFJO1FBQ0YsSUFBSSxDQUFDLElBQUksQ0FBQyxXQUFXO1lBQUUsSUFBSSxDQUFDLFdBQVcsR0FBRyxJQUFJLENBQUMsS0FBSyxFQUFFLENBQUE7UUFFdEQsT0FBTyxJQUFJLENBQUMsV0FBVyxDQUFBO0lBQ3pCLENBQUM7SUFFRDs7O09BR0c7SUFDSCxLQUFLLENBQUMsS0FBSztRQUNULElBQUksQ0FBQyxRQUFRLEdBQUcsSUFBSSxDQUFBO1FBRXBCLElBQUksQ0FBQztZQUNILE1BQU0saUJBQWlCLENBQUM7Z0JBQ3RCLFNBQVMsRUFBRSxJQUFJLENBQUMsU0FBUztnQkFDekIsUUFBUSxFQUFFLEtBQUssSUFBSSxFQUFFO29CQUNuQixJQUFJLENBQUMsYUFBYSxFQUFFLENBQUE7b0JBQ3BCLElBQUksQ0FBQyxZQUFZLEVBQUUsQ0FBQTtvQkFDbkIsSUFBSSxDQUFDLHlCQUF5QixFQUFFLENBQUE7b0JBQ2hDLElBQUksQ0FBQzt3QkFDSCxNQUFNLElBQUksQ0FBQyxTQUFTLEVBQUUsSUFBSSxFQUFFLENBQUE7d0JBQzVCLElBQUksSUFBSSxDQUFDLGFBQWE7NEJBQUUsTUFBTSxJQUFJLENBQUMsYUFBYSxDQUFBO29CQUNsRCxDQUFDOzRCQUFTLENBQUM7d0JBQ1QsSUFBSSxDQUFDOzRCQUNILE1BQU0sSUFBSSxDQUFDLDRCQUE0QixFQUFFLENBQUE7d0JBQzNDLENBQUM7Z0NBQVMsQ0FBQzs0QkFDVCxJQUFJLENBQUM7Z0NBQ0gsTUFBTSxJQUFJLENBQUMsMkJBQTJCLEVBQUUsQ0FBQTs0QkFDMUMsQ0FBQztvQ0FBUyxDQUFDO2dDQUNULE1BQU0sSUFBSSxDQUFDLG9CQUFvQixFQUFFLENBQUE7NEJBQ25DLENBQUM7d0JBQ0gsQ0FBQztvQkFDSCxDQUFDO2dCQUNILENBQUM7YUFDRixDQUFDLENBQUE7UUFDSixDQUFDO2dCQUFTLENBQUM7WUFDVCxJQUFJLENBQUMsT0FBTyxHQUFHLFNBQVMsQ0FBQTtZQUN4QixJQUFJLENBQUMsY0FBYyxHQUFHLFNBQVMsQ0FBQTtZQUMvQixJQUFJLENBQUMsZUFBZSxFQUFFLENBQUE7UUFDeEIsQ0FBQztJQUNILENBQUM7SUFFRDs7eUJBRXFCO0lBQ3JCLGFBQWE7UUFDWCxLQUFLLE1BQU0sVUFBVSxJQUFJLElBQUksQ0FBQyxXQUFXLEVBQUUsQ0FBQztZQUMxQyxVQUFVLENBQUMsS0FBSyxFQUFFLENBQUE7UUFDcEIsQ0FBQztJQUNILENBQUM7SUFFRDs7eUJBRXFCO0lBQ3JCLFlBQVk7UUFDVixJQUFJLElBQUksQ0FBQyxVQUFVO1lBQUUsYUFBYSxDQUFDLElBQUksQ0FBQyxVQUFVLENBQUMsQ0FBQTtRQUNuRCxJQUFJLElBQUksQ0FBQyxlQUFlO1lBQUUsWUFBWSxDQUFDLElBQUksQ0FBQyxlQUFlLENBQUMsQ0FBQTtRQUM1RCxJQUFJLElBQUksQ0FBQyxnQkFBZ0I7WUFBRSxZQUFZLENBQUMsSUFBSSxDQUFDLGdCQUFnQixDQUFDLENBQUE7UUFDOUQsSUFBSSxJQUFJLENBQUMsWUFBWTtZQUFFLGFBQWEsQ0FBQyxJQUFJLENBQUMsWUFBWSxDQUFDLENBQUE7UUFDdkQsSUFBSSxJQUFJLENBQUMsaUJBQWlCO1lBQUUsYUFBYSxDQUFDLElBQUksQ0FBQyxpQkFBaUIsQ0FBQyxDQUFBO1FBQ2pFLElBQUksSUFBSSxDQUFDLDJCQUEyQjtZQUFFLElBQUksQ0FBQyxLQUFLLENBQUMsWUFBWSxDQUFDLElBQUksQ0FBQywyQkFBMkIsQ0FBQyxDQUFBO1FBQy9GLEtBQUssTUFBTSxFQUFDLEtBQUssRUFBQyxJQUFJLElBQUksQ0FBQyxtQkFBbUIsQ0FBQyxNQUFNLEVBQUU7WUFBRSxJQUFJLENBQUMsS0FBSyxDQUFDLFlBQVksQ0FBQyxLQUFLLENBQUMsQ0FBQTtRQUN2RixJQUFJLENBQUMsbUJBQW1CLENBQUMsS0FBSyxFQUFFLENBQUE7UUFDaEMsSUFBSSxDQUFDLFVBQVUsR0FBRyxTQUFTLENBQUE7UUFDM0IsSUFBSSxDQUFDLGVBQWUsR0FBRyxTQUFTLENBQUE7UUFDaEMsSUFBSSxDQUFDLGdCQUFnQixHQUFHLFNBQVMsQ0FBQTtRQUNqQyxJQUFJLENBQUMsWUFBWSxHQUFHLFNBQVMsQ0FBQTtRQUM3QixJQUFJLENBQUMsaUJBQWlCLEdBQUcsU0FBUyxDQUFBO1FBQ2xDLElBQUksQ0FBQywyQkFBMkIsR0FBRyxTQUFTLENBQUE7SUFDOUMsQ0FBQztJQUVEOzt5QkFFcUI7SUFDckIseUJBQXlCO1FBQ3ZCLElBQUksSUFBSSxDQUFDLGtCQUFrQixFQUFFLENBQUM7WUFDNUIsSUFBSSxDQUFDLGtCQUFrQixFQUFFLENBQUE7WUFDekIsSUFBSSxDQUFDLGtCQUFrQixHQUFHLFNBQVMsQ0FBQTtRQUNyQyxDQUFDO1FBRUQsSUFBSSxJQUFJLENBQUMsYUFBYSxJQUFJLElBQUksQ0FBQyxxQkFBcUIsRUFBRSxDQUFDO1lBQ3JELElBQUksQ0FBQyxhQUFhLENBQUMsR0FBRyxDQUFDLFNBQVMsRUFBRSxJQUFJLENBQUMscUJBQXFCLENBQUMsQ0FBQTtRQUMvRCxDQUFDO1FBQ0QsSUFBSSxDQUFDLHFCQUFxQixHQUFHLFNBQVMsQ0FBQTtRQUN0QyxJQUFJLENBQUMsYUFBYSxHQUFHLFNBQVMsQ0FBQTtJQUNoQyxDQUFDO0lBRUQ7O2tDQUU4QjtJQUM5QixLQUFLLENBQUMsb0JBQW9CO1FBQ3hCLE1BQU0sZ0JBQWdCLENBQUM7WUFDckIsT0FBTyxFQUFFLGdFQUFnRTtZQUN6RSxLQUFLLEVBQUU7Z0JBQ0wsS0FBSyxJQUFJLEVBQUU7b0JBQ1QsSUFBSSxDQUFDO3dCQUNILE1BQU0sSUFBSSxDQUFDLHNCQUFzQixFQUFFLEtBQUssRUFBRSxDQUFBO29CQUM1QyxDQUFDOzRCQUFTLENBQUM7d0JBQ1QsSUFBSSxDQUFDLHNCQUFzQixHQUFHLFNBQVMsQ0FBQTtvQkFDekMsQ0FBQztnQkFDSCxDQUFDO2dCQUNELEdBQUcsQ0FBQyxJQUFJLENBQUMsOEJBQThCO29CQUNyQyxDQUFDLENBQUMsQ0FBQyxLQUFLLElBQUksRUFBRSxDQUFDLE1BQU0sSUFBSSxDQUFDLGFBQWEsQ0FBQyxRQUFRLEVBQUUsQ0FBQztvQkFDbkQsQ0FBQyxDQUFDLEVBQUUsQ0FBQztnQkFDUCxLQUFLLElBQUksRUFBRSxDQUFDLE1BQU0sSUFBSSxDQUFDLGFBQWEsQ0FBQyxnQkFBZ0IsRUFBRTtnQkFDdkQsS0FBSyxJQUFJLEVBQUUsQ0FBQyxNQUFNLElBQUksQ0FBQyxZQUFZLEVBQUU7Z0JBQ3JDLEtBQUssSUFBSSxFQUFFO29CQUNULElBQUksSUFBSSxDQUFDLDhCQUE4QixFQUFFLENBQUM7d0JBQ3hDLE1BQU0sSUFBSSxDQUFDLGFBQWEsQ0FBQyx3QkFBd0IsRUFBRSxDQUFBO29CQUNyRCxDQUFDO3lCQUFNLENBQUM7d0JBQ04sTUFBTSxJQUFJLENBQUMsYUFBYSxDQUFDLDBCQUEwQixFQUFFLENBQUE7b0JBQ3ZELENBQUM7Z0JBQ0gsQ0FBQzthQUNGO1NBQ0YsQ0FBQyxDQUFBO0lBQ0osQ0FBQztJQUVEOztrQ0FFOEI7SUFDOUIsS0FBSyxDQUFDLFlBQVk7UUFDaEIsSUFBSSxDQUFDLElBQUksQ0FBQyxNQUFNO1lBQUUsT0FBTTtRQUV4QixNQUFNLEVBQUMsTUFBTSxFQUFDLEdBQUcsSUFBSSxDQUFBO1FBQ3JCLElBQUksQ0FBQyxNQUFNLEdBQUcsU0FBUyxDQUFBO1FBQ3ZCLE1BQU0sSUFBSSxPQUFPLENBQUMsQ0FBQyxPQUFPLEVBQUUsRUFBRSxDQUFDLE1BQU0sQ0FBQyxLQUFLLENBQUMsR0FBRyxFQUFFLENBQUMsT0FBTyxDQUFDLFNBQVMsQ0FBQyxDQUFDLENBQUMsQ0FBQTtJQUN4RSxDQUFDO0lBRUQ7OztPQUdHO0lBQ0gsT0FBTztRQUNMLE9BQU8sSUFBSSxDQUFDLElBQUksQ0FBQTtJQUNsQixDQUFDO0lBRUQ7OztPQUdHO0lBQ0gsaUJBQWlCLEtBQUssT0FBTyxJQUFJLENBQUMsY0FBYyxDQUFBLENBQUMsQ0FBQztJQUVsRDs7O09BR0c7SUFDSCxLQUFLLENBQUMsZ0JBQWdCLEtBQUssTUFBTSxJQUFJLENBQUMsZUFBZSxDQUFBLENBQUMsQ0FBQztJQUV2RDs7OztPQUlHO0lBQ0gsS0FBSyxDQUFDLCtCQUErQjtRQUNuQyxNQUFNLFFBQVEsR0FBRyxNQUFNLElBQUksQ0FBQyxLQUFLLENBQUMscUJBQXFCLEVBQUUsQ0FBQTtRQUV6RCxJQUFJLENBQUMsSUFBSSxDQUFDLFlBQVk7WUFBRSxPQUFPLFFBQVEsQ0FBQTtRQUN2QyxNQUFNLFlBQVksR0FBRyxJQUFJLENBQUMsWUFBWSxDQUFBO1FBRXRDLE9BQU8sUUFBUSxDQUFDLE1BQU0sQ0FBQyxDQUFDLEVBQUMsUUFBUSxFQUFDLEVBQUUsRUFBRSxDQUFDLDJCQUEyQixDQUFDLEVBQUMsWUFBWSxFQUFFLFFBQVEsRUFBQyxDQUFDLENBQUMsQ0FBQTtJQUMvRixDQUFDO0lBRUQ7OztPQUdHO0lBQ0gsS0FBSyxDQUFDLHFCQUFxQjtRQUN6QixNQUFNLElBQUksQ0FBQyxLQUFLLENBQUMseUJBQXlCLEVBQUUsQ0FBQTtRQUM1QyxJQUFJLENBQUMsc0JBQXNCLEVBQUUsQ0FBQTtRQUM3QixJQUFJLENBQUMsMkJBQTJCLEVBQUUsQ0FBQTtRQUNsQyxJQUFJLENBQUMsaUJBQWlCLEVBQUUsQ0FBQTtRQUN4QixNQUFNLElBQUksQ0FBQyxlQUFlLEVBQUUsQ0FBQTtRQUM1QixJQUFJLENBQUMscUJBQXFCLEdBQUcsSUFBSSxDQUFBO1FBQ2pDLElBQUksQ0FBQyxtQkFBbUIsRUFBRSxDQUFBO1FBQzFCLE1BQU0sSUFBSSxDQUFDLE1BQU0sRUFBRSxDQUFBO0lBQ3JCLENBQUM7SUFFRCxnRkFBZ0Y7SUFDaEYsaUNBQWlDO1FBQy9CLElBQUksQ0FBQywyQkFBMkIsRUFBRSxDQUFBO1FBQ2xDLElBQUksQ0FBQyxpQkFBaUIsRUFBRSxDQUFBO1FBQ3hCLElBQUksQ0FBQyxpQkFBaUIsRUFBRSxDQUFBO0lBQzFCLENBQUM7SUFFRCxpREFBaUQ7SUFDakQsaUJBQWlCO1FBQ2YsSUFBSSxJQUFJLENBQUMsWUFBWTtZQUFFLE9BQU07UUFFN0IsSUFBSSxDQUFDLFlBQVksR0FBRyxXQUFXLENBQUMsR0FBRyxFQUFFLEdBQUcsS0FBSyxJQUFJLENBQUMsYUFBYSxFQUFFLENBQUEsQ0FBQyxDQUFDLEVBQUUsS0FBSyxDQUFDLENBQUE7SUFDN0UsQ0FBQztJQUVEOzs7T0FHRztJQUNILEtBQUssQ0FBQyxlQUFlO1FBQ25CLElBQUksSUFBSSxDQUFDLFNBQVM7WUFBRSxPQUFNO1FBRTFCLElBQUksQ0FBQyxTQUFTLEdBQUcsSUFBSSx1QkFBdUIsQ0FBQztZQUMzQyxhQUFhLEVBQUUsSUFBSSxDQUFDLGFBQWE7WUFDakMsVUFBVSxFQUFFLEtBQUssRUFBRSxFQUFDLElBQUksRUFBRSxRQUFRLEVBQUUsT0FBTyxFQUFDLEVBQUUsRUFBRTtnQkFDOUMsTUFBTSxJQUFJLENBQUMsS0FBSyxDQUFDLE9BQU8sQ0FBQztvQkFDdkIsT0FBTyxFQUFFLFFBQVEsQ0FBQyxPQUFPLEVBQUU7b0JBQzNCLElBQUk7b0JBQ0osT0FBTyxFQUFFLFFBQVEsQ0FBQyxlQUFlLENBQUMsRUFBQyxPQUFPLEVBQUUsSUFBSSxFQUFFLFVBQVUsRUFBRSxPQUFPLEVBQUMsQ0FBQztpQkFDeEUsQ0FBQyxDQUFBO2dCQUNGLElBQUksQ0FBQyxlQUFlLEVBQUUsQ0FBQTtnQkFDdEIsS0FBSyxJQUFJLENBQUMsTUFBTSxFQUFFLENBQUE7WUFDcEIsQ0FBQztTQUNGLENBQUMsQ0FBQTtRQUNGLE1BQU0sSUFBSSxDQUFDLFNBQVMsQ0FBQyxLQUFLLEVBQUUsQ0FBQTtRQUU1QixNQUFNLGlCQUFpQixHQUFHLDhCQUE4QixDQUFDLHFCQUFxQixDQUFDLElBQUksQ0FBQyxTQUFTLENBQUMsQ0FBQTtRQUU5RixJQUFJLGlCQUFpQixFQUFFLENBQUM7WUFDdEIsSUFBSSxDQUFDLFNBQVMsQ0FBQyxXQUFXLENBQUMsRUFBQyxnQkFBZ0IsRUFBRSxpQkFBaUIsRUFBRSxNQUFNLEVBQUUsc0NBQXNDLEVBQUMsQ0FBQyxDQUFBO1FBQ25ILENBQUM7SUFDSCxDQUFDO0lBRUQsMkVBQTJFO0lBQzNFLG1CQUFtQjtRQUNqQixLQUFLLE1BQU0sTUFBTSxJQUFJLElBQUksQ0FBQyxxQkFBcUIsRUFBRSxDQUFDO1lBQ2hELElBQUksSUFBSSxDQUFDLE9BQU8sQ0FBQyxHQUFHLENBQUMsTUFBTSxDQUFDLElBQUksQ0FBQyxNQUFNLENBQUMsVUFBVSxJQUFJLE1BQU0sQ0FBQywwQkFBMEIsRUFBRSxDQUFDO2dCQUN4RixJQUFJLENBQUMsWUFBWSxDQUFDLEdBQUcsQ0FBQyxNQUFNLENBQUMsQ0FBQTtZQUMvQixDQUFDO1FBQ0gsQ0FBQztRQUNELElBQUksQ0FBQyxxQkFBcUIsQ0FBQyxLQUFLLEVBQUUsQ0FBQTtJQUNwQyxDQUFDO0lBRUQ7OztPQUdHO0lBQ0gsUUFBUTtRQUNOLElBQUksQ0FBQyxJQUFJLENBQUMsWUFBWTtZQUFFLE1BQU0sSUFBSSxLQUFLLENBQUMsZ0VBQWdFLENBQUMsQ0FBQTtRQUN6RyxJQUFJLElBQUksQ0FBQyxjQUFjLEtBQUssUUFBUTtZQUFFLE9BQU8sT0FBTyxDQUFDLE9BQU8sRUFBRSxDQUFBO1FBQzlELElBQUksSUFBSSxDQUFDLGNBQWMsS0FBSyxXQUFXO1lBQUUsTUFBTSxJQUFJLEtBQUssQ0FBQyxtREFBbUQsSUFBSSxDQUFDLGNBQWMsRUFBRSxDQUFDLENBQUE7UUFDbEksSUFBSSxDQUFDLElBQUksQ0FBQyxrQkFBa0I7WUFBRSxJQUFJLENBQUMsa0JBQWtCLEdBQUcsSUFBSSxDQUFDLFNBQVMsRUFBRSxDQUFBO1FBRXhFLE9BQU8sSUFBSSxDQUFDLGtCQUFrQixDQUFBO0lBQ2hDLENBQUM7SUFFRDs7O09BR0c7SUFDSCxLQUFLLENBQUMsU0FBUztRQUNiLElBQUksQ0FBQyxNQUFNLENBQUMsSUFBSSxDQUFDLEdBQUcsRUFBRSxDQUFDLENBQUMsZ0RBQWdELEVBQUUsRUFBQyxZQUFZLEVBQUUsSUFBSSxDQUFDLFlBQVksRUFBQyxDQUFDLENBQUMsQ0FBQTtRQUM3RyxNQUFNLElBQUksQ0FBQyxxQkFBcUIsRUFBRSxDQUFBO1FBQ2xDLElBQUksQ0FBQyxjQUFjLEdBQUcsUUFBUSxDQUFBO1FBQzlCLElBQUksQ0FBQyxtQkFBbUIsRUFBRSxDQUFBO1FBQzFCLElBQUksQ0FBQyxNQUFNLENBQUMsSUFBSSxDQUFDLEdBQUcsRUFBRSxDQUFDLENBQUMsb0RBQW9ELEVBQUUsRUFBQyxZQUFZLEVBQUUsSUFBSSxDQUFDLFlBQVksRUFBQyxDQUFDLENBQUMsQ0FBQTtRQUNqSCxLQUFLLElBQUksQ0FBQyxNQUFNLEVBQUUsQ0FBQyxLQUFLLENBQUMsQ0FBQyxLQUFLLEVBQUUsRUFBRTtZQUNqQyxJQUFJLENBQUMsTUFBTSxDQUFDLEtBQUssQ0FBQyxHQUFHLEVBQUUsQ0FBQyxDQUFDLHlEQUF5RCxFQUFFLEVBQUMsS0FBSyxFQUFFLFlBQVksRUFBRSxJQUFJLENBQUMsWUFBWSxFQUFDLENBQUMsQ0FBQyxDQUFBO1FBQ2hJLENBQUMsQ0FBQyxDQUFBO0lBQ0osQ0FBQztJQUVEOzs7T0FHRztJQUNILE1BQU07UUFDSixJQUFJLENBQUMsSUFBSSxDQUFDLFlBQVk7WUFBRSxNQUFNLElBQUksS0FBSyxDQUFDLGdFQUFnRSxDQUFDLENBQUE7UUFDekcsSUFBSSxJQUFJLENBQUMsY0FBYyxLQUFLLFVBQVUsSUFBSSxJQUFJLENBQUMsY0FBYyxLQUFLLFNBQVM7WUFBRSxPQUFPLE9BQU8sQ0FBQyxPQUFPLEVBQUUsQ0FBQTtRQUNyRyxJQUFJLElBQUksQ0FBQyxjQUFjLEtBQUssUUFBUTtZQUFFLE1BQU0sSUFBSSxLQUFLLENBQUMsaURBQWlELElBQUksQ0FBQyxjQUFjLEVBQUUsQ0FBQyxDQUFBO1FBRTdILElBQUksQ0FBQyxjQUFjLEdBQUcsVUFBVSxDQUFBO1FBQ2hDLElBQUksQ0FBQyxxQkFBcUIsR0FBRyxLQUFLLENBQUE7UUFDbEMsSUFBSSxDQUFDLFlBQVksQ0FBQyxLQUFLLEVBQUUsQ0FBQTtRQUN6QixJQUFJLENBQUMscUJBQXFCLENBQUMsS0FBSyxFQUFFLENBQUE7UUFDbEMsSUFBSSxDQUFDLG9CQUFvQixFQUFFLENBQUE7UUFDM0IsSUFBSSxDQUFDLHlCQUF5QixFQUFFLENBQUE7UUFDaEMsSUFBSSxDQUFDLGtCQUFrQixHQUFHLElBQUksQ0FBQyxPQUFPLEVBQUUsQ0FBQTtRQUN4QyxLQUFLLElBQUksQ0FBQyxrQkFBa0IsQ0FBQyxLQUFLLENBQUMsQ0FBQyxLQUFLLEVBQUUsRUFBRSxDQUFDLElBQUksQ0FBQyw2QkFBNkIsQ0FBQyxLQUFLLENBQUMsQ0FBQyxDQUFBO1FBRXhGLE9BQU8sT0FBTyxDQUFDLE9BQU8sRUFBRSxDQUFBO0lBQzFCLENBQUM7SUFFRDs7O09BR0c7SUFDSCxLQUFLLENBQUMsT0FBTztRQUNYLE1BQU0sSUFBSSxDQUFDLFNBQVMsRUFBRSxJQUFJLEVBQUUsQ0FBQTtRQUM1QixJQUFJLENBQUMsU0FBUyxHQUFHLFNBQVMsQ0FBQTtRQUMxQixJQUFJLElBQUksQ0FBQyxhQUFhO1lBQUUsTUFBTSxJQUFJLENBQUMsYUFBYSxDQUFBO1FBQ2hELElBQUksSUFBSSxDQUFDLFFBQVE7WUFBRSxPQUFNO1FBRXpCLEtBQUssTUFBTSxNQUFNLElBQUksSUFBSSxDQUFDLE9BQU8sRUFBRSxDQUFDO1lBQ2xDLE1BQU0sQ0FBQyxVQUFVLEdBQUcsSUFBSSxDQUFBO1lBQ3hCLE1BQU0sQ0FBQyxJQUFJLENBQUMsRUFBQyxJQUFJLEVBQUUsUUFBUSxFQUFFLFlBQVksRUFBRSxJQUFJLENBQUMsWUFBWSxFQUFDLENBQUMsQ0FBQTtRQUNoRSxDQUFDO1FBRUQsSUFBSSxDQUFDLGNBQWMsR0FBRyxTQUFTLENBQUE7UUFDL0IsSUFBSSxDQUFDLGlDQUFpQyxFQUFFLENBQUE7SUFDMUMsQ0FBQztJQUVELDRFQUE0RTtJQUM1RSxvQkFBb0I7UUFDbEIsSUFBSSxJQUFJLENBQUMsVUFBVTtZQUFFLGFBQWEsQ0FBQyxJQUFJLENBQUMsVUFBVSxDQUFDLENBQUE7UUFDbkQsSUFBSSxJQUFJLENBQUMsZUFBZTtZQUFFLFlBQVksQ0FBQyxJQUFJLENBQUMsZUFBZSxDQUFDLENBQUE7UUFDNUQsSUFBSSxJQUFJLENBQUMsZ0JBQWdCO1lBQUUsWUFBWSxDQUFDLElBQUksQ0FBQyxnQkFBZ0IsQ0FBQyxDQUFBO1FBQzlELElBQUksQ0FBQyxVQUFVLEdBQUcsU0FBUyxDQUFBO1FBQzNCLElBQUksQ0FBQyxlQUFlLEdBQUcsU0FBUyxDQUFBO1FBQ2hDLElBQUksQ0FBQyxnQkFBZ0IsR0FBRyxTQUFTLENBQUE7SUFDbkMsQ0FBQztJQUVELGtFQUFrRTtJQUNsRSw0QkFBNEIsS0FBSyxJQUFJLENBQUMsdUJBQXVCLElBQUksQ0FBQyxDQUFBLENBQUMsQ0FBQztJQUVwRSw2RUFBNkU7SUFDN0UsNEJBQTRCO1FBQzFCLElBQUksSUFBSSxDQUFDLHVCQUF1QixHQUFHLENBQUM7WUFBRSxNQUFNLElBQUksS0FBSyxDQUFDLHVEQUF1RCxDQUFDLENBQUE7UUFDOUcsSUFBSSxDQUFDLHVCQUF1QixJQUFJLENBQUMsQ0FBQTtRQUNqQyxJQUFJLENBQUMsaUJBQWlCLEVBQUUsQ0FBQTtJQUMxQixDQUFDO0lBRUQsNkVBQTZFO0lBQzdFLGlCQUFpQjtRQUNmLElBQUksSUFBSSxDQUFDLGNBQWMsS0FBSyxTQUFTLElBQUksSUFBSSxDQUFDLFFBQVEsSUFBSSxJQUFJLENBQUMsV0FBVztZQUFFLE9BQU07UUFDbEYsSUFBSSxJQUFJLENBQUMsdUJBQXVCLEdBQUcsQ0FBQyxJQUFJLElBQUksQ0FBQyx3QkFBd0IsR0FBRyxDQUFDLElBQUksSUFBSSxDQUFDLE9BQU8sQ0FBQyxJQUFJLEdBQUcsQ0FBQyxJQUFJLElBQUksQ0FBQyxtQkFBbUIsQ0FBQyxJQUFJLEdBQUcsQ0FBQztZQUFFLE9BQU07UUFDL0ksSUFBSSxJQUFJLENBQUMsOEJBQThCLENBQUMsSUFBSSxHQUFHLENBQUMsSUFBSSxJQUFJLENBQUMsd0JBQXdCLENBQUMsSUFBSSxHQUFHLENBQUM7WUFBRSxPQUFNO1FBQ2xHLElBQUksSUFBSSxDQUFDLGFBQWEsSUFBSSxJQUFJLENBQUMsNkJBQTZCLElBQUksSUFBSSxDQUFDLDJCQUEyQjtZQUFFLE9BQU07UUFDeEcsSUFBSSxJQUFJLENBQUMsc0JBQXNCLENBQUMsTUFBTSxHQUFHLENBQUM7WUFBRSxPQUFNO1FBRWxELEtBQUssTUFBTSxRQUFRLElBQUksSUFBSSxDQUFDLGNBQWMsQ0FBQyxNQUFNLEVBQUUsRUFBRSxDQUFDO1lBQ3BELElBQUksUUFBUSxDQUFDLElBQUksR0FBRyxDQUFDO2dCQUFFLE9BQU07UUFDL0IsQ0FBQztRQUVELEtBQUssSUFBSSxDQUFDLElBQUksRUFBRSxDQUFDLEtBQUssQ0FBQyxDQUFDLEtBQUssRUFBRSxFQUFFLENBQUMsSUFBSSxDQUFDLDZCQUE2QixDQUFDLEtBQUssQ0FBQyxDQUFDLENBQUE7SUFDOUUsQ0FBQztJQUVEOzs7Ozs7Ozs7O09BVUc7SUFDSCxzQkFBc0I7UUFDcEIsSUFBSSxJQUFJLENBQUMsZ0JBQWdCLEtBQUssU0FBUyxFQUFFLENBQUM7WUFDeEMsSUFBSSxDQUFDLFVBQVUsR0FBRyxXQUFXLENBQUMsR0FBRyxFQUFFO2dCQUNqQyxLQUFLLElBQUksQ0FBQyxnQkFBZ0IsRUFBRSxDQUFBO1lBQzlCLENBQUMsRUFBRSxJQUFJLENBQUMsY0FBYyxDQUFDLENBQUE7WUFDdkIsT0FBTTtRQUNSLENBQUM7UUFFRCxNQUFNLFlBQVksR0FBRyxJQUFJLENBQUMsYUFBYSxDQUFDLGVBQWUsRUFBRSxDQUFBO1FBQ3pELElBQUksQ0FBQyxZQUFZO1lBQUUsT0FBTTtRQUV6QixJQUFJLENBQUMsYUFBYSxHQUFHLFlBQVksQ0FBQTtRQUVqQyxJQUFJLENBQUMsa0JBQWtCLEdBQUcsWUFBWSxDQUFDLFdBQVcsQ0FBQyxDQUFDLE9BQU8sRUFBRSxFQUFFO1lBQzdELElBQUksT0FBTyxFQUFFLE9BQU8sS0FBSyxnQkFBZ0I7Z0JBQUUsT0FBTTtZQUNqRCxLQUFLLElBQUksQ0FBQyxNQUFNLEVBQUUsQ0FBQTtRQUNwQixDQUFDLENBQUMsQ0FBQTtRQUVGLG9FQUFvRTtRQUNwRSxxRUFBcUU7UUFDckUsa0JBQWtCO1FBQ2xCLElBQUksQ0FBQyxxQkFBcUIsR0FBRyxHQUFHLEVBQUU7WUFDaEMsS0FBSyxJQUFJLENBQUMsTUFBTSxFQUFFLENBQUE7UUFDcEIsQ0FBQyxDQUFBO1FBQ0QsWUFBWSxDQUFDLEVBQUUsQ0FBQyxTQUFTLEVBQUUsSUFBSSxDQUFDLHFCQUFxQixDQUFDLENBQUE7SUFDeEQsQ0FBQztJQUVEOzs7OztPQUtHO0lBQ0gsMkJBQTJCO1FBQ3pCLElBQUksSUFBSSxDQUFDLHNCQUFzQixDQUFDLE1BQU0sS0FBSyxDQUFDO1lBQUUsT0FBTTtRQUNwRCxJQUFJLElBQUksQ0FBQywyQkFBMkIsSUFBSSxJQUFJLENBQUMsNkJBQTZCLElBQUksSUFBSSxDQUFDLDJCQUEyQjtZQUFFLE9BQU07UUFFdEgsSUFBSSxDQUFDLDJCQUEyQixHQUFHLElBQUksQ0FBQyxLQUFLLENBQUMsVUFBVSxDQUFDLEdBQUcsRUFBRTtZQUM1RCxJQUFJLENBQUMsMkJBQTJCLEdBQUcsU0FBUyxDQUFBO1lBQzVDLElBQUksQ0FBQyxrQ0FBa0MsR0FBRyxDQUFDLEdBQUcsSUFBSSxDQUFDLDhCQUE4QixDQUFDLENBQUE7WUFDbEYsSUFBSSxDQUFDLDJCQUEyQixHQUFHLElBQUksQ0FBQTtZQUN2QyxLQUFLLElBQUksQ0FBQywyQkFBMkIsRUFBRSxDQUFBO1FBQ3pDLENBQUMsRUFBRSxJQUFJLENBQUMsc0JBQXNCLENBQUMsQ0FBQTtRQUMvQixJQUFJLE9BQU8sSUFBSSxDQUFDLDJCQUEyQixLQUFLLFFBQVE7WUFBRSxJQUFJLENBQUMsMkJBQTJCLENBQUMsS0FBSyxFQUFFLENBQUE7SUFDcEcsQ0FBQztJQUVEOzs7O09BSUc7SUFDSCwyQkFBMkI7UUFDekIsSUFBSSxJQUFJLENBQUMsNkJBQTZCO1lBQUUsT0FBTyxJQUFJLENBQUMsNkJBQTZCLENBQUE7UUFFakYsTUFBTSxPQUFPLEdBQUcsSUFBSSxDQUFDLG1DQUFtQyxFQUFFLENBQUE7UUFFMUQsSUFBSSxDQUFDLDZCQUE2QixHQUFHLE9BQU8sQ0FBQTtRQUM1QyxNQUFNLFlBQVksR0FBRyxHQUFHLEVBQUU7WUFDeEIsSUFBSSxJQUFJLENBQUMsNkJBQTZCLEtBQUssT0FBTyxFQUFFLENBQUM7Z0JBQ25ELElBQUksQ0FBQyw2QkFBNkIsR0FBRyxTQUFTLENBQUE7WUFDaEQsQ0FBQztRQUNILENBQUMsQ0FBQTtRQUNELEtBQUssT0FBTyxDQUFDLElBQUksQ0FBQyxZQUFZLEVBQUUsWUFBWSxDQUFDLENBQUE7UUFFN0MsT0FBTyxPQUFPLENBQUE7SUFDaEIsQ0FBQztJQUVEOzs7T0FHRztJQUNILEtBQUssQ0FBQywyQkFBMkI7UUFDL0IsT0FBTyxJQUFJLENBQUMsNkJBQTZCLEVBQUUsQ0FBQztZQUMxQyxNQUFNLElBQUksQ0FBQyw2QkFBNkIsQ0FBQTtRQUMxQyxDQUFDO0lBQ0gsQ0FBQztJQUVEOzs7OztPQUtHO0lBQ0gsS0FBSyxDQUFDLG1DQUFtQztRQUN2QyxJQUFJLElBQUksQ0FBQyxRQUFRLElBQUksQ0FBQyxJQUFJLENBQUMsMkJBQTJCO1lBQUUsT0FBTTtRQUM5RCxJQUFJLElBQUksQ0FBQyxzQkFBc0IsQ0FBQyxNQUFNLEtBQUssQ0FBQztZQUFFLE9BQU07UUFFcEQsTUFBTSxJQUFJLENBQUMseUNBQXlDLEVBQUUsQ0FBQTtRQUN0RCxJQUFJLElBQUksQ0FBQyxRQUFRO1lBQUUsT0FBTTtRQUV6QixNQUFNLFFBQVEsR0FBRyxJQUFJLENBQUMsc0JBQXNCLENBQUMsTUFBTSxDQUFDLENBQUMsRUFBQyxRQUFRLEVBQUMsRUFBRSxFQUFFLENBQUMsQ0FBQyxJQUFJLENBQUMsb0JBQW9CLENBQUMsR0FBRyxDQUFDLFFBQVEsQ0FBQyxDQUFDLENBQUE7UUFFN0csSUFBSSxRQUFRLENBQUMsTUFBTSxLQUFLLENBQUMsRUFBRSxDQUFDO1lBQzFCLElBQUksQ0FBQyxzQkFBc0IsR0FBRyxFQUFFLENBQUE7WUFDaEMsSUFBSSxDQUFDLGlCQUFpQixFQUFFLENBQUE7WUFDeEIsT0FBTTtRQUNSLENBQUM7UUFFRCxJQUFJLFlBQVksQ0FBQTtRQUVoQixJQUFJLENBQUM7WUFDSCxZQUFZLEdBQUcsTUFBTSxJQUFJLENBQUMsS0FBSyxDQUFDLG9CQUFvQixDQUFDO2dCQUNuRCxLQUFLLEVBQUUsNkRBQTZEO2dCQUNwRSxRQUFRO2FBQ1QsQ0FBQyxDQUFBO1FBQ0osQ0FBQztRQUFDLE9BQU8sS0FBSyxFQUFFLENBQUM7WUFDZixJQUFJLENBQUMsaUNBQWlDLENBQUMsS0FBSyxDQUFDLENBQUE7WUFDN0MsSUFBSSxDQUFDLG1CQUFtQixFQUFFLENBQUE7WUFDMUIsT0FBTTtRQUNSLENBQUM7UUFFRCxJQUFJLENBQUMsc0JBQXNCLEdBQUcsRUFBRSxDQUFBO1FBQ2hDLE1BQU0sSUFBSSxDQUFDLG1CQUFtQixDQUFDO1lBQzdCLElBQUksRUFBRSxZQUFZO1lBQ2xCLE9BQU8sRUFBRSx3RUFBd0U7U0FDbEYsQ0FBQyxDQUFBO1FBQ0YsSUFBSSxDQUFDLDBCQUEwQixFQUFFLENBQUMsWUFBWSxDQUFDLENBQUE7UUFDL0MsSUFBSSxDQUFDLGlCQUFpQixFQUFFLENBQUE7SUFDMUIsQ0FBQztJQUVEOzs7OztPQUtHO0lBQ0gsS0FBSyxDQUFDLHlDQUF5QztRQUM3QyxNQUFNLFNBQVMsR0FBRyxJQUFJLENBQUMsa0NBQWtDLENBQUE7UUFFekQsSUFBSSxDQUFDLGtDQUFrQyxHQUFHLEVBQUUsQ0FBQTtRQUM1QyxJQUFJLFNBQVMsQ0FBQyxNQUFNLEtBQUssQ0FBQztZQUFFLE9BQU07UUFFbEMsd0RBQXdEO1FBQ3hELElBQUksS0FBSyxDQUFBO1FBQ1QsTUFBTSxTQUFTLEdBQUcsSUFBSSxPQUFPLENBQUMsQ0FBQyxPQUFPLEVBQUUsRUFBRTtZQUN4QyxvRUFBb0U7WUFDcEUsZ0VBQWdFO1lBQ2hFLEtBQUssR0FBRyxVQUFVLENBQUMsT0FBTyxFQUFFLElBQUksQ0FBQyxzQkFBc0IsQ0FBQyxDQUFBO1lBQ3hELEtBQUssQ0FBQyxLQUFLLEVBQUUsQ0FBQTtRQUNmLENBQUMsQ0FBQyxDQUFBO1FBRUYsSUFBSSxDQUFDO1lBQ0gsTUFBTSxPQUFPLENBQUMsSUFBSSxDQUFDLENBQUMsT0FBTyxDQUFDLEdBQUcsQ0FBQyxTQUFTLENBQUMsRUFBRSxTQUFTLENBQUMsQ0FBQyxDQUFBO1FBQ3pELENBQUM7Z0JBQVMsQ0FBQztZQUNULElBQUksS0FBSztnQkFBRSxZQUFZLENBQUMsS0FBSyxDQUFDLENBQUE7UUFDaEMsQ0FBQztJQUNILENBQUM7SUFFRDs7Ozs7O09BTUc7SUFDSCxlQUFlO1FBQ2IsSUFBSSxJQUFJLENBQUMsZ0JBQWdCLEtBQUssU0FBUztZQUFFLE9BQU07UUFFL0MsTUFBTSxZQUFZLEdBQUcsSUFBSSxDQUFDLGFBQWEsQ0FBQyxlQUFlLEVBQUUsQ0FBQTtRQUN6RCxJQUFJLENBQUMsWUFBWSxJQUFJLENBQUMsWUFBWSxDQUFDLFdBQVcsRUFBRTtZQUFFLE9BQU07UUFFeEQsSUFBSSxDQUFDO1lBQ0gsWUFBWSxDQUFDLE9BQU8sQ0FBQztnQkFDbkIsT0FBTyxFQUFFLGdCQUFnQjtnQkFDekIsZUFBZSxFQUFFLEVBQUU7Z0JBQ25CLElBQUksRUFBRSxFQUFDLE1BQU0sRUFBRSxNQUFNLEVBQUM7YUFDdkIsQ0FBQyxDQUFBO1FBQ0osQ0FBQztRQUFDLE9BQU8sS0FBSyxFQUFFLENBQUM7WUFDZixJQUFJLENBQUMsTUFBTSxDQUFDLElBQUksQ0FBQyxHQUFHLEVBQUUsQ0FBQyxDQUFDLG1EQUFtRCxFQUFFLEtBQUssQ0FBQyxDQUFDLENBQUE7UUFDdEYsQ0FBQztJQUNILENBQUM7SUFFRDs7OztPQUlHO0lBQ0gsaUJBQWlCLENBQUMsTUFBTTtRQUN0QixNQUFNLFVBQVUsR0FBRyxJQUFJLFVBQVUsQ0FBQyxNQUFNLENBQUMsQ0FBQTtRQUN6QyxJQUFJLENBQUMsV0FBVyxDQUFDLEdBQUcsQ0FBQyxVQUFVLENBQUMsQ0FBQTtRQUNoQzs7eUVBRWlFO1FBQ2pFLElBQUksSUFBSSxHQUFHLElBQUksQ0FBQTtRQUVmLElBQUksU0FBUyxHQUFHLEtBQUssQ0FBQTtRQUNyQixNQUFNLE9BQU8sR0FBRyxHQUFHLEVBQUU7WUFDbkIsSUFBSSxTQUFTO2dCQUFFLE9BQU07WUFDckIsU0FBUyxHQUFHLElBQUksQ0FBQTtZQUNoQixJQUFJLENBQUMsV0FBVyxDQUFDLE1BQU0sQ0FBQyxVQUFVLENBQUMsQ0FBQTtZQUVuQyxJQUFJLElBQUksS0FBSyxRQUFRO2dCQUFFLEtBQUssSUFBSSxDQUFDLHlCQUF5QixDQUFDLFVBQVUsQ0FBQyxDQUFBO1lBQ3RFLElBQUksQ0FBQyxpQkFBaUIsRUFBRSxDQUFBO1FBQzFCLENBQUMsQ0FBQTtRQUVELFVBQVUsQ0FBQyxFQUFFLENBQUMsT0FBTyxFQUFFLE9BQU8sQ0FBQyxDQUFBO1FBQy9CLFVBQVUsQ0FBQyxFQUFFLENBQUMsT0FBTyxFQUFFLENBQUMsS0FBSyxFQUFFLEVBQUU7WUFDL0IsSUFBSSxDQUFDLE1BQU0sQ0FBQyxJQUFJLENBQUMsR0FBRyxFQUFFLENBQUMsQ0FBQyxtQ0FBbUMsRUFBRSxLQUFLLENBQUMsQ0FBQyxDQUFBO1lBQ3BFLE9BQU8sRUFBRSxDQUFBO1FBQ1gsQ0FBQyxDQUFDLENBQUE7UUFFRixJQUFJLGVBQWUsR0FBRyxPQUFPLENBQUMsT0FBTyxFQUFFLENBQUE7UUFDdkMsVUFBVSxDQUFDLEVBQUUsQ0FBQyxTQUFTLEVBQUUsQ0FBQyxPQUFPLEVBQUUsRUFBRTtZQUNuQyxlQUFlLEdBQUcsZUFBZSxDQUFDLElBQUksQ0FBQyxLQUFLLElBQUksRUFBRTtnQkFDaEQsTUFBTSxZQUFZLEdBQUcsSUFBSSxDQUFBO2dCQUN6QixJQUFJLEdBQUcsTUFBTSxJQUFJLENBQUMsb0JBQW9CLENBQUMsRUFBQyxVQUFVLEVBQUUsT0FBTyxFQUFFLElBQUksRUFBQyxDQUFDLENBQUE7Z0JBQ25FLElBQUksWUFBWSxLQUFLLFFBQVEsSUFBSSxZQUFZLEtBQUssVUFBVTtvQkFBRSxVQUFVLENBQUMsS0FBSyxFQUFFLENBQUE7WUFDbEYsQ0FBQyxDQUFDLENBQUMsS0FBSyxDQUFDLENBQUMsS0FBSyxFQUFFLEVBQUU7Z0JBQ2pCLElBQUksQ0FBQyw2QkFBNkIsQ0FBQyxLQUFLLENBQUMsQ0FBQTtnQkFDekMsVUFBVSxDQUFDLEtBQUssRUFBRSxDQUFBO1lBQ3BCLENBQUMsQ0FBQyxDQUFBO1FBQ0osQ0FBQyxDQUFDLENBQUE7SUFDSixDQUFDO0lBRUQ7Ozs7T0FJRztJQUNILDZCQUE2QixDQUFDLEtBQUs7UUFDakMsTUFBTSxlQUFlLEdBQUcsS0FBSyxZQUFZLEtBQUssQ0FBQyxDQUFDLENBQUMsS0FBSyxDQUFDLENBQUMsQ0FBQyxJQUFJLEtBQUssQ0FBQyxNQUFNLENBQUMsS0FBSyxDQUFDLENBQUMsQ0FBQTtRQUNqRixNQUFNLE9BQU8sR0FBRyxFQUFDLE9BQU8sRUFBRSxFQUFDLEtBQUssRUFBRSxnQ0FBZ0MsRUFBQyxFQUFFLEtBQUssRUFBRSxlQUFlLEVBQUMsQ0FBQTtRQUM1RixNQUFNLFdBQVcsR0FBRyxJQUFJLENBQUMsYUFBYSxDQUFDLGNBQWMsRUFBRSxDQUFBO1FBRXZELElBQUksQ0FBQyxNQUFNLENBQUMsS0FBSyxDQUFDLEdBQUcsRUFBRSxDQUFDLENBQUMsd0NBQXdDLEVBQUUsZUFBZSxDQUFDLENBQUMsQ0FBQTtRQUNwRixXQUFXLENBQUMsSUFBSSxDQUFDLGlCQUFpQixFQUFFLE9BQU8sQ0FBQyxDQUFBO1FBQzVDLFdBQVcsQ0FBQyxJQUFJLENBQUMsV0FBVyxFQUFFLEVBQUMsR0FBRyxPQUFPLEVBQUUsU0FBUyxFQUFFLGlCQUFpQixFQUFDLENBQUMsQ0FBQTtJQUMzRSxDQUFDO0lBRUQ7Ozs7Ozs7T0FPRztJQUNILEtBQUssQ0FBQyxvQkFBb0IsQ0FBQyxFQUFDLFVBQVUsRUFBRSxPQUFPLEVBQUUsSUFBSSxFQUFDO1FBQ3BELElBQUksQ0FBQyxJQUFJO1lBQUUsT0FBTyxNQUFNLElBQUksQ0FBQyw0QkFBNEIsQ0FBQyxFQUFDLFVBQVUsRUFBRSxPQUFPLEVBQUMsQ0FBQyxDQUFBO1FBQ2hGLElBQUksSUFBSSxLQUFLLFFBQVEsRUFBRSxDQUFDO1lBQ3RCLE1BQU0sSUFBSSxDQUFDLDBCQUEwQixDQUFDLEVBQUMsVUFBVSxFQUFFLE9BQU8sRUFBQyxDQUFDLENBQUE7WUFDNUQsT0FBTyxJQUFJLENBQUE7UUFDYixDQUFDO1FBRUQsSUFBSSxDQUFDLHdCQUF3QixJQUFJLENBQUMsQ0FBQTtRQUNsQyxJQUFJLENBQUM7WUFDSCxJQUFJLElBQUksS0FBSyxRQUFRO2dCQUFFLE1BQU0sSUFBSSxDQUFDLDBCQUEwQixDQUFDLEVBQUMsVUFBVSxFQUFFLE9BQU8sRUFBQyxDQUFDLENBQUE7WUFDbkYsSUFBSSxJQUFJLEtBQUssVUFBVTtnQkFBRSxNQUFNLElBQUksQ0FBQyw0QkFBNEIsQ0FBQyxFQUFDLFVBQVUsRUFBRSxPQUFPLEVBQUMsQ0FBQyxDQUFBO1FBQ3pGLENBQUM7Z0JBQVMsQ0FBQztZQUNULElBQUksQ0FBQyx3QkFBd0IsSUFBSSxDQUFDLENBQUE7WUFDbEMsSUFBSSxDQUFDLGlCQUFpQixFQUFFLENBQUE7UUFDMUIsQ0FBQztRQUVELE9BQU8sSUFBSSxDQUFBO0lBQ2IsQ0FBQztJQUVEOzs7Ozs7T0FNRztJQUNILEtBQUssQ0FBQyw0QkFBNEIsQ0FBQyxFQUFDLFVBQVUsRUFBRSxPQUFPLEVBQUM7UUFDdEQsSUFBSSxPQUFPLEVBQUUsSUFBSSxLQUFLLE9BQU87WUFBRSxPQUFPLElBQUksQ0FBQTtRQUUxQyxNQUFNLGVBQWUsR0FBRyxJQUFJLENBQUMsK0JBQStCLENBQUMsT0FBTyxDQUFDLENBQUE7UUFFckUsSUFBSSxlQUFlLEVBQUUsQ0FBQztZQUNwQixVQUFVLENBQUMsSUFBSSxDQUFDLEVBQUMsSUFBSSxFQUFFLHFCQUFxQixFQUFFLE1BQU0sRUFBRSxlQUFlLEVBQUMsQ0FBQyxDQUFBO1lBQ3ZFLFVBQVUsQ0FBQyxLQUFLLEVBQUUsQ0FBQTtZQUNsQixPQUFPLElBQUksQ0FBQTtRQUNiLENBQUM7UUFFRCxJQUFJLE9BQU8sQ0FBQyxJQUFJLEtBQUssUUFBUSxFQUFFLENBQUM7WUFDOUIsSUFBSSxJQUFJLENBQUMsUUFBUSxFQUFFLENBQUM7Z0JBQ2xCLFVBQVUsQ0FBQyxLQUFLLEVBQUUsQ0FBQTtnQkFDbEIsT0FBTyxPQUFPLENBQUMsSUFBSSxDQUFBO1lBQ3JCLENBQUM7WUFFRCxJQUFJLENBQUMsQ0FBQyxNQUFNLElBQUksQ0FBQyxlQUFlLENBQUMsRUFBQyxVQUFVLEVBQUUsT0FBTyxFQUFDLENBQUMsQ0FBQztnQkFBRSxPQUFPLElBQUksQ0FBQTtRQUN2RSxDQUFDO1FBRUQsSUFBSSxJQUFJLENBQUMsWUFBWSxFQUFFLENBQUM7WUFDdEIsVUFBVSxDQUFDLElBQUksQ0FBQztnQkFDZCxJQUFJLEVBQUUscUJBQXFCO2dCQUMzQixZQUFZLEVBQUUsSUFBSSxDQUFDLFlBQVk7Z0JBQy9CLGNBQWMsRUFBRSxJQUFJLENBQUMsY0FBYzthQUNwQyxDQUFDLENBQUE7WUFDRixJQUFJLE9BQU8sQ0FBQyxJQUFJLEtBQUssUUFBUSxJQUFJLENBQUMsSUFBSSxDQUFDLGNBQWMsS0FBSyxVQUFVLElBQUksSUFBSSxDQUFDLGNBQWMsS0FBSyxTQUFTLENBQUMsRUFBRSxDQUFDO2dCQUMzRyxVQUFVLENBQUMsSUFBSSxDQUFDLEVBQUMsSUFBSSxFQUFFLFFBQVEsRUFBRSxZQUFZLEVBQUUsSUFBSSxDQUFDLFlBQVksRUFBQyxDQUFDLENBQUE7WUFDcEUsQ0FBQztRQUNILENBQUM7UUFFRCxPQUFPLE9BQU8sQ0FBQyxJQUFJLENBQUE7SUFDckIsQ0FBQztJQUVEOzs7O09BSUc7SUFDSCwrQkFBK0IsQ0FBQyxPQUFPO1FBQ3JDLE1BQU0sb0JBQW9CLEdBQUcsTUFBTSxDQUFDLE1BQU0sQ0FBQyxPQUFPLEVBQUUsY0FBYyxDQUFDLENBQUE7UUFFbkUsSUFBSSxDQUFDLElBQUksQ0FBQyxZQUFZO1lBQUUsT0FBTyxvQkFBb0IsQ0FBQyxDQUFDLENBQUMsdUJBQXVCLENBQUMsQ0FBQyxDQUFDLElBQUksQ0FBQTtRQUNwRixJQUFJLENBQUMsb0JBQW9CO1lBQUUsT0FBTyxvQkFBb0IsQ0FBQTtRQUV0RCxJQUFJLENBQUM7WUFDSCxvQkFBb0IsQ0FBQyxPQUFPLENBQUMsWUFBWSxFQUFFLG9CQUFvQixDQUFDLENBQUE7UUFDbEUsQ0FBQztRQUFDLE1BQU0sQ0FBQztZQUNQLE9BQU8sc0JBQXNCLENBQUE7UUFDL0IsQ0FBQztRQUVELElBQUksT0FBTyxDQUFDLFlBQVksS0FBSyxJQUFJLENBQUMsWUFBWTtZQUFFLE9BQU8scUJBQXFCLENBQUE7UUFDNUUsSUFBSSxPQUFPLENBQUMsSUFBSSxLQUFLLFFBQVEsSUFBSSxDQUFDLDJCQUEyQixDQUFDLEVBQUMsWUFBWSxFQUFFLElBQUksQ0FBQyxZQUFZLEVBQUUsUUFBUSxFQUFFLE9BQU8sQ0FBQyxRQUFRLEVBQUMsQ0FBQyxFQUFFLENBQUM7WUFDN0gsT0FBTyxxQkFBcUIsQ0FBQTtRQUM5QixDQUFDO1FBRUQsT0FBTyxJQUFJLENBQUE7SUFDYixDQUFDO0lBRUQ7Ozs7OztPQU1HO0lBQ0gsS0FBSyxDQUFDLGVBQWUsQ0FBQyxFQUFDLFVBQVUsRUFBRSxPQUFPLEVBQUM7UUFDekMsVUFBVSxDQUFDLFFBQVEsR0FBRyxPQUFPLENBQUMsUUFBUSxDQUFBO1FBQ3RDLFVBQVUsQ0FBQywwQkFBMEIsR0FBRyxPQUFPLENBQUMsMEJBQTBCLEtBQUssSUFBSSxDQUFBO1FBQ25GLFVBQVUsQ0FBQyxpQkFBaUIsR0FBRyxPQUFPLENBQUMsaUJBQWlCLEtBQUssSUFBSSxDQUFBO1FBQ2pFLFVBQVUsQ0FBQyxVQUFVLEdBQUcsSUFBSSxDQUFDLEtBQUssQ0FBQyxHQUFHLEVBQUUsQ0FBQTtRQUV4QyxNQUFNLFFBQVEsR0FBRyxVQUFVLENBQUMsUUFBUSxDQUFBO1FBQ3BDLE1BQU0sWUFBWSxHQUFHLFFBQVEsQ0FBQyxDQUFDLENBQUMsSUFBSSxDQUFDLG1CQUFtQixDQUFDLEdBQUcsQ0FBQyxRQUFRLENBQUMsQ0FBQyxDQUFDLENBQUMsU0FBUyxDQUFBO1FBQ2xGLElBQUksUUFBUSxHQUFHLFlBQVksQ0FBQyxDQUFDLENBQUMsSUFBSSxDQUFDLGNBQWMsQ0FBQyxHQUFHLENBQUMsWUFBWSxDQUFDLE1BQU0sQ0FBQyxDQUFDLENBQUMsQ0FBQyxTQUFTLENBQUE7UUFDdEYsTUFBTSxZQUFZLEdBQUcsSUFBSSxDQUFDLGNBQWMsS0FBSyxVQUFVLElBQUksSUFBSSxDQUFDLGNBQWMsS0FBSyxTQUFTLENBQUE7UUFFNUYsSUFBSSxZQUFZLElBQUksQ0FBQyxDQUFDLFFBQVEsSUFBSSxRQUFRLENBQUMsSUFBSSxLQUFLLENBQUMsQ0FBQyxFQUFFLENBQUM7WUFDdkQsSUFBSSxDQUFDLFFBQVE7Z0JBQUUsT0FBTyxLQUFLLENBQUE7WUFDM0IsTUFBTSxlQUFlLEdBQUcsTUFBTSxJQUFJLENBQUMsS0FBSyxDQUFDLHNCQUFzQixDQUFDLEVBQUMsUUFBUSxFQUFDLENBQUMsQ0FBQTtZQUUzRSxJQUFJLGVBQWUsQ0FBQyxNQUFNLEtBQUssQ0FBQyxFQUFFLENBQUM7Z0JBQ2pDLFVBQVUsQ0FBQyxJQUFJLENBQUMsRUFBQyxJQUFJLEVBQUUscUJBQXFCLEVBQUUsTUFBTSxFQUFFLG9DQUFvQyxFQUFDLENBQUMsQ0FBQTtnQkFDNUYsVUFBVSxDQUFDLEtBQUssRUFBRSxDQUFBO2dCQUNsQixPQUFPLEtBQUssQ0FBQTtZQUNkLENBQUM7WUFFRCxRQUFRLEdBQUcsSUFBSSxHQUFHLENBQUMsZUFBZSxDQUFDLEdBQUcsQ0FBQyxDQUFDLEVBQUMsS0FBSyxFQUFFLFNBQVMsRUFBQyxFQUFFLEVBQUUsQ0FBQyxDQUFDLEtBQUssRUFBRSxTQUFTLENBQUMsQ0FBQyxDQUFDLENBQUE7WUFDbkYsSUFBSSxDQUFDLG9CQUFvQixDQUFDLEdBQUcsQ0FBQyxRQUFRLENBQUMsQ0FBQTtRQUN6QyxDQUFDO1FBRUQsSUFBSSxZQUFZLEVBQUUsQ0FBQztZQUNqQixJQUFJLENBQUMsS0FBSyxDQUFDLFlBQVksQ0FBQyxZQUFZLENBQUMsS0FBSyxDQUFDLENBQUE7WUFDM0MsSUFBSSxRQUFRO2dCQUFFLElBQUksQ0FBQyxtQkFBbUIsQ0FBQyxNQUFNLENBQUMsUUFBUSxDQUFDLENBQUE7WUFDdkQsSUFBSSxDQUFDLGNBQWMsQ0FBQyxNQUFNLENBQUMsWUFBWSxDQUFDLE1BQU0sQ0FBQyxDQUFBO1FBQ2pELENBQUM7UUFFRCxJQUFJLENBQUMsT0FBTyxDQUFDLEdBQUcsQ0FBQyxVQUFVLENBQUMsQ0FBQTtRQUM1QixJQUFJLENBQUMsY0FBYyxDQUFDLEdBQUcsQ0FBQyxVQUFVLEVBQUUsUUFBUSxJQUFJLElBQUksR0FBRyxFQUFFLENBQUMsQ0FBQTtRQUMxRCxJQUFJLFlBQVk7WUFBRSxVQUFVLENBQUMsVUFBVSxHQUFHLElBQUksQ0FBQTtRQUM5QyxJQUFJLENBQUMsUUFBUSxJQUFJLElBQUksQ0FBQyxjQUFjLEtBQUssUUFBUTtZQUFFLElBQUksQ0FBQywyQkFBMkIsQ0FBQyxVQUFVLENBQUMsQ0FBQTtRQUUvRixPQUFPLElBQUksQ0FBQTtJQUNiLENBQUM7SUFFRDs7OztPQUlHO0lBQ0gsMkJBQTJCLENBQUMsVUFBVTtRQUNwQyxNQUFNLFFBQVEsR0FBRyxJQUFJLENBQUMsb0JBQW9CLENBQUMsVUFBVSxDQUFDLENBQUE7UUFDdEQsSUFBSSxDQUFDLDhCQUE4QixDQUFDLEdBQUcsQ0FBQyxRQUFRLENBQUMsQ0FBQTtRQUNqRCxNQUFNLGNBQWMsR0FBRyxHQUFHLEVBQUU7WUFDMUIsSUFBSSxDQUFDLDhCQUE4QixDQUFDLE1BQU0sQ0FBQyxRQUFRLENBQUMsQ0FBQTtZQUNwRCxJQUFJLENBQUMsaUJBQWlCLEVBQUUsQ0FBQTtRQUMxQixDQUFDLENBQUE7UUFDRCxLQUFLLFFBQVEsQ0FBQyxJQUFJLENBQUMsY0FBYyxFQUFFLGNBQWMsQ0FBQyxDQUFBO0lBQ3BELENBQUM7SUFFRDs7O09BR0c7SUFDSCxLQUFLLENBQUMsNEJBQTRCO1FBQ2hDLE9BQU8sSUFBSSxDQUFDLDhCQUE4QixDQUFDLElBQUksR0FBRyxDQUFDLEVBQUUsQ0FBQztZQUNwRCxNQUFNLE9BQU8sQ0FBQyxHQUFHLENBQUMsQ0FBQyxHQUFHLElBQUksQ0FBQyw4QkFBOEIsQ0FBQyxDQUFDLENBQUE7UUFDN0QsQ0FBQztJQUNILENBQUM7SUFFRDs7Ozs7Ozs7Ozs7OztPQWFHO0lBQ0gsS0FBSyxDQUFDLG9CQUFvQixDQUFDLFVBQVU7UUFDbkMsTUFBTSxRQUFRLEdBQUcsVUFBVSxDQUFDLFFBQVEsQ0FBQTtRQUVwQyxJQUFJLE9BQU8sUUFBUSxLQUFLLFFBQVEsSUFBSSxRQUFRLENBQUMsTUFBTSxLQUFLLENBQUM7WUFBRSxPQUFNO1FBRWpFLElBQUksQ0FBQztZQUNILE1BQU0sUUFBUSxHQUFHLE1BQU0sSUFBSSxDQUFDLEtBQUssQ0FBQyxzQkFBc0IsQ0FBQyxFQUFDLFFBQVEsRUFBQyxDQUFDLENBQUE7WUFDcEUsTUFBTSxHQUFHLEdBQUcsSUFBSSxDQUFDLGNBQWMsQ0FBQyxHQUFHLENBQUMsVUFBVSxDQUFDLENBQUE7WUFFL0MsNEVBQTRFO1lBQzVFLDJFQUEyRTtZQUMzRSxJQUFJLENBQUMsR0FBRyxJQUFJLENBQUMsSUFBSSxDQUFDLE9BQU8sQ0FBQyxHQUFHLENBQUMsVUFBVSxDQUFDO2dCQUFFLE9BQU07WUFFakQsS0FBSyxNQUFNLEVBQUMsS0FBSyxFQUFFLFNBQVMsRUFBQyxJQUFJLFFBQVEsRUFBRSxDQUFDO2dCQUMxQyxHQUFHLENBQUMsR0FBRyxDQUFDLEtBQUssRUFBRSxTQUFTLENBQUMsQ0FBQTtZQUMzQixDQUFDO1lBQ0QsSUFBSSxDQUFDLG9CQUFvQixDQUFDLEdBQUcsQ0FBQyxRQUFRLENBQUMsQ0FBQTtRQUN6QyxDQUFDO1FBQUMsT0FBTyxLQUFLLEVBQUUsQ0FBQztZQUNmLElBQUksQ0FBQyx3QkFBd0IsQ0FBQyxLQUFLLENBQUMsQ0FBQTtRQUN0QyxDQUFDO0lBQ0gsQ0FBQztJQUVEOzs7Ozs7T0FNRztJQUNILEtBQUssQ0FBQywwQkFBMEIsQ0FBQyxFQUFDLFVBQVUsRUFBRSxPQUFPLEVBQUM7UUFDcEQsSUFBSSxJQUFJLENBQUMsWUFBWSxJQUFJLENBQUMsSUFBSSxDQUFDLGNBQWMsS0FBSyxVQUFVLElBQUksSUFBSSxDQUFDLGNBQWMsS0FBSyxTQUFTLENBQUMsRUFBRSxDQUFDO1lBQ25HLElBQUksT0FBTyxFQUFFLElBQUksS0FBSyxTQUFTO2dCQUFFLFVBQVUsQ0FBQyxJQUFJLENBQUMsRUFBQyxJQUFJLEVBQUUsZUFBZSxFQUFFLEtBQUssRUFBRSx1Q0FBdUMsRUFBQyxDQUFDLENBQUE7WUFDekgsSUFBSSxPQUFPLEVBQUUsSUFBSSxLQUFLLG1CQUFtQjtnQkFBRSxVQUFVLENBQUMsSUFBSSxDQUFDLEVBQUMsSUFBSSxFQUFFLHlCQUF5QixFQUFFLEtBQUssRUFBRSx1Q0FBdUMsRUFBQyxDQUFDLENBQUE7WUFDN0ksSUFBSSxPQUFPLEVBQUUsSUFBSSxLQUFLLGtCQUFrQjtnQkFBRSxVQUFVLENBQUMsSUFBSSxDQUFDLEVBQUMsSUFBSSxFQUFFLHdCQUF3QixFQUFFLEtBQUssRUFBRSx1Q0FBdUMsRUFBQyxDQUFDLENBQUE7WUFDM0ksT0FBTTtRQUNSLENBQUM7UUFFRCxJQUFJLE9BQU8sRUFBRSxJQUFJLEtBQUssU0FBUyxFQUFFLENBQUM7WUFDaEMsTUFBTSxJQUFJLENBQUMsY0FBYyxDQUFDLEVBQUMsVUFBVSxFQUFFLE9BQU8sRUFBQyxDQUFDLENBQUE7WUFDaEQsT0FBTTtRQUNSLENBQUM7UUFFRCxJQUFJLE9BQU8sRUFBRSxJQUFJLEtBQUssbUJBQW1CLEVBQUUsQ0FBQztZQUMxQyxNQUFNLElBQUksQ0FBQyx1QkFBdUIsQ0FBQyxFQUFDLFVBQVUsRUFBRSxPQUFPLEVBQUMsQ0FBQyxDQUFBO1lBQ3pELE9BQU07UUFDUixDQUFDO1FBRUQsSUFBSSxPQUFPLEVBQUUsSUFBSSxLQUFLLGtCQUFrQixFQUFFLENBQUM7WUFDekMsTUFBTSxJQUFJLENBQUMsc0JBQXNCLENBQUMsRUFBQyxVQUFVLEVBQUUsT0FBTyxFQUFDLENBQUMsQ0FBQTtRQUMxRCxDQUFDO0lBQ0gsQ0FBQztJQUVEOzs7Ozs7T0FNRztJQUNILEtBQUssQ0FBQywwQkFBMEIsQ0FBQyxFQUFDLFVBQVUsRUFBRSxPQUFPLEVBQUM7UUFDcEQsMEVBQTBFO1FBQzFFLHlDQUF5QztRQUN6QyxVQUFVLENBQUMsVUFBVSxHQUFHLElBQUksQ0FBQyxLQUFLLENBQUMsR0FBRyxFQUFFLENBQUE7UUFFeEMsSUFBSSxPQUFPLEVBQUUsSUFBSSxLQUFLLFdBQVcsRUFBRSxDQUFDO1lBQ2xDLElBQUksQ0FBQyxpQkFBaUIsRUFBRSxDQUFDLFVBQVUsQ0FBQyxDQUFBO1lBQ3BDLE9BQU07UUFDUixDQUFDO1FBRUQsSUFBSSxPQUFPLEVBQUUsSUFBSSxLQUFLLE9BQU8sRUFBRSxDQUFDO1lBQzlCLElBQUksQ0FBQyxrQkFBa0IsQ0FBQyxFQUFDLFVBQVUsRUFBRSxPQUFPLEVBQUMsQ0FBQyxDQUFBO1lBQzlDLE9BQU07UUFDUixDQUFDO1FBRUQsSUFBSSxPQUFPLEVBQUUsSUFBSSxLQUFLLFVBQVUsRUFBRSxDQUFDO1lBQ2pDLElBQUksQ0FBQyxxQkFBcUIsQ0FBQyxFQUFDLFVBQVUsRUFBQyxDQUFDLENBQUE7WUFDeEMsT0FBTTtRQUNSLENBQUM7UUFFRCxNQUFNLElBQUksQ0FBQyw0QkFBNEIsQ0FBQyxFQUFDLFVBQVUsRUFBRSxPQUFPLEVBQUMsQ0FBQyxDQUFBO0lBQ2hFLENBQUM7SUFFRDs7Ozs7O09BTUc7SUFDSCxLQUFLLENBQUMsNEJBQTRCLENBQUMsRUFBQyxVQUFVLEVBQUUsT0FBTyxFQUFDO1FBQ3RELElBQUksSUFBSSxDQUFDLFlBQVksSUFBSSxJQUFJLENBQUMsMEJBQTBCLENBQUMsT0FBTyxDQUFDLEVBQUUsQ0FBQztZQUNsRSxJQUFJLE9BQU8sSUFBSSxPQUFPLElBQUksT0FBTyxPQUFPLENBQUMsS0FBSyxLQUFLLFFBQVEsRUFBRSxDQUFDO2dCQUM1RCxVQUFVLENBQUMsSUFBSSxDQUFDLEVBQUMsSUFBSSxFQUFFLGtCQUFrQixFQUFFLEtBQUssRUFBRSxPQUFPLENBQUMsS0FBSyxFQUFFLEtBQUssRUFBRSwrQkFBK0IsRUFBQyxDQUFDLENBQUE7WUFDM0csQ0FBQztZQUNELE9BQU07UUFDUixDQUFDO1FBQ0QsSUFBSSxPQUFPLEVBQUUsSUFBSSxLQUFLLGNBQWMsRUFBRSxDQUFDO1lBQ3JDLE1BQU0sSUFBSSxDQUFDLGtCQUFrQixDQUFDLEVBQUMsVUFBVSxFQUFFLE9BQU8sRUFBQyxDQUFDLENBQUE7WUFDcEQsT0FBTTtRQUNSLENBQUM7UUFFRCxJQUFJLE9BQU8sRUFBRSxJQUFJLEtBQUssWUFBWSxFQUFFLENBQUM7WUFDbkMsTUFBTSxJQUFJLENBQUMsZ0JBQWdCLENBQUMsRUFBQyxVQUFVLEVBQUUsT0FBTyxFQUFDLENBQUMsQ0FBQTtZQUNsRCxPQUFNO1FBQ1IsQ0FBQztRQUVELElBQUksT0FBTyxFQUFFLElBQUksS0FBSyxnQkFBZ0IsRUFBRSxDQUFDO1lBQ3ZDLE1BQU0sSUFBSSxDQUFDLG9CQUFvQixDQUFDLEVBQUMsVUFBVSxFQUFFLE9BQU8sRUFBQyxDQUFDLENBQUE7UUFDeEQsQ0FBQztJQUNILENBQUM7SUFFRDs7Ozs7T0FLRztJQUNILDBCQUEwQixDQUFDLE9BQU87UUFDaEMsSUFBSSxPQUFPLEVBQUUsSUFBSSxLQUFLLGNBQWMsSUFBSSxPQUFPLEVBQUUsSUFBSSxLQUFLLFlBQVksSUFBSSxPQUFPLEVBQUUsSUFBSSxLQUFLLGdCQUFnQjtZQUFFLE9BQU8sS0FBSyxDQUFBO1FBQzFILE1BQU0sWUFBWSxHQUFHLElBQUksQ0FBQyxZQUFZLENBQUE7UUFDdEMsSUFBSSxDQUFDLFlBQVk7WUFBRSxPQUFPLEtBQUssQ0FBQTtRQUUvQixPQUFPLE9BQU8sT0FBTyxDQUFDLFNBQVMsS0FBSyxRQUFRO2VBQ3ZDLE9BQU8sT0FBTyxDQUFDLGFBQWEsS0FBSyxRQUFRO2VBQ3pDLENBQUMsMkJBQTJCLENBQUMsRUFBQyxZQUFZLEVBQUUsUUFBUSxFQUFFLE9BQU8sQ0FBQyxRQUFRLEVBQUMsQ0FBQyxDQUFBO0lBQy9FLENBQUM7SUFFRDs7Ozs7O09BTUc7SUFDSCxrQkFBa0IsQ0FBQyxFQUFDLFVBQVUsRUFBRSxPQUFPLEVBQUM7UUFDdEMsSUFBSSxJQUFJLENBQUMsY0FBYyxLQUFLLFVBQVUsSUFBSSxJQUFJLENBQUMsY0FBYyxLQUFLLFNBQVMsRUFBRSxDQUFDO1lBQzVFLElBQUksQ0FBQyxZQUFZLENBQUMsTUFBTSxDQUFDLFVBQVUsQ0FBQyxDQUFBO1lBQ3BDLElBQUksQ0FBQyxxQkFBcUIsQ0FBQyxNQUFNLENBQUMsVUFBVSxDQUFDLENBQUE7WUFDN0MsT0FBTTtRQUNSLENBQUM7UUFFRCxVQUFVLENBQUMsZ0JBQWdCLElBQUksQ0FBQyxDQUFBO1FBQ2hDLFVBQVUsQ0FBQyxrQkFBa0IsR0FBRyxPQUFPLENBQUMsY0FBYyxLQUFLLEtBQUssSUFBSSxPQUFPLENBQUMsYUFBYSxLQUFLLEtBQUssQ0FBQTtRQUNuRyxVQUFVLENBQUMsaUJBQWlCLEdBQUcsT0FBTyxDQUFDLGFBQWEsS0FBSyxLQUFLLENBQUE7UUFDOUQsVUFBVSxDQUFDLGlCQUFpQixHQUFHLE9BQU8sQ0FBQyxhQUFhLEtBQUssSUFBSSxDQUFBO1FBQzdELE1BQU0sb0JBQW9CLEdBQUcsT0FBTyxDQUFDLG9CQUFvQixDQUFBO1FBQ3pELFVBQVUsQ0FBQyx5QkFBeUIsR0FBRyxNQUFNLENBQUMsU0FBUyxDQUFDLG9CQUFvQixDQUFDLENBQUE7UUFDN0UsVUFBVSxDQUFDLG9CQUFvQixHQUFHLE1BQU0sQ0FBQyxTQUFTLENBQUMsb0JBQW9CLENBQUMsSUFBSSxvQkFBb0IsS0FBSyxTQUFTLElBQUksb0JBQW9CLEdBQUcsQ0FBQztZQUN4SSxDQUFDLENBQUMsb0JBQW9CO1lBQ3RCLENBQUMsQ0FBQyxDQUFDLENBQUE7UUFDTCxVQUFVLENBQUMsaUJBQWlCLEdBQUcsT0FBTyxDQUFDLGFBQWEsS0FBSyxLQUFLLENBQUE7UUFDOUQsSUFBSSxJQUFJLENBQUMsY0FBYyxLQUFLLFdBQVcsRUFBRSxDQUFDO1lBQ3hDLElBQUksQ0FBQyxZQUFZLENBQUMsTUFBTSxDQUFDLFVBQVUsQ0FBQyxDQUFBO1lBQ3BDLElBQUksQ0FBQyxVQUFVLENBQUMsVUFBVTtnQkFBRSxJQUFJLENBQUMscUJBQXFCLENBQUMsR0FBRyxDQUFDLFVBQVUsQ0FBQyxDQUFBO1FBQ3hFLENBQUM7YUFBTSxJQUFJLElBQUksQ0FBQyxjQUFjLEtBQUssUUFBUSxJQUFJLElBQUksQ0FBQyxxQkFBcUIsSUFBSSxVQUFVLENBQUMsMEJBQTBCLElBQUksQ0FBQyxVQUFVLENBQUMsVUFBVSxFQUFFLENBQUM7WUFDN0ksSUFBSSxDQUFDLFlBQVksQ0FBQyxHQUFHLENBQUMsVUFBVSxDQUFDLENBQUE7UUFDbkMsQ0FBQzthQUFNLENBQUM7WUFDTixJQUFJLENBQUMsWUFBWSxDQUFDLE1BQU0sQ0FBQyxVQUFVLENBQUMsQ0FBQTtZQUNwQyxJQUFJLENBQUMscUJBQXFCLENBQUMsTUFBTSxDQUFDLFVBQVUsQ0FBQyxDQUFBO1FBQy9DLENBQUM7UUFDRCxJQUFJLENBQUMsYUFBYSxFQUFFLENBQUMsVUFBVSxDQUFDLENBQUE7UUFDaEMsS0FBSyxJQUFJLENBQUMsTUFBTSxFQUFFLENBQUE7SUFDcEIsQ0FBQztJQUVEOzs7OztPQUtHO0lBQ0gscUJBQXFCLENBQUMsRUFBQyxVQUFVLEVBQUM7UUFDaEMsb0VBQW9FO1FBQ3BFLGtFQUFrRTtRQUNsRSw2Q0FBNkM7UUFDN0MsVUFBVSxDQUFDLFVBQVUsR0FBRyxJQUFJLENBQUE7UUFDNUIsSUFBSSxDQUFDLFlBQVksQ0FBQyxNQUFNLENBQUMsVUFBVSxDQUFDLENBQUE7UUFDcEMsSUFBSSxDQUFDLHFCQUFxQixDQUFDLE1BQU0sQ0FBQyxVQUFVLENBQUMsQ0FBQTtJQUMvQyxDQUFDO0lBRUQ7Ozs7OztPQU1HO0lBQ0gsS0FBSyxDQUFDLHlCQUF5QixDQUFDLE1BQU0sRUFBRSxFQUFDLFlBQVksR0FBRyxLQUFLLEVBQUMsR0FBRyxFQUFFO1FBQ2pFLElBQUksQ0FBQyxPQUFPLENBQUMsTUFBTSxDQUFDLE1BQU0sQ0FBQyxDQUFBO1FBQzNCLElBQUksQ0FBQyxZQUFZLENBQUMsTUFBTSxDQUFDLE1BQU0sQ0FBQyxDQUFBO1FBQ2hDLElBQUksQ0FBQyxxQkFBcUIsQ0FBQyxNQUFNLENBQUMsTUFBTSxDQUFDLENBQUE7UUFFekMsSUFBSSxJQUFJLENBQUMsUUFBUSxFQUFFLENBQUM7WUFDbEIsSUFBSSxDQUFDLGNBQWMsQ0FBQyxNQUFNLENBQUMsTUFBTSxDQUFDLENBQUE7WUFDbEMsT0FBTTtRQUNSLENBQUM7UUFFRCxNQUFNLFFBQVEsR0FBRyxJQUFJLENBQUMsY0FBYyxDQUFDLEdBQUcsQ0FBQyxNQUFNLENBQUMsQ0FBQTtRQUNoRCxJQUFJLElBQUksQ0FBQyxZQUFZLElBQUksTUFBTSxDQUFDLFFBQVEsSUFBSSxRQUFRLElBQUksUUFBUSxDQUFDLElBQUksR0FBRyxDQUFDLEVBQUUsQ0FBQztZQUMxRSxNQUFNLFFBQVEsR0FBRyxJQUFJLENBQUMsbUJBQW1CLENBQUMsR0FBRyxDQUFDLE1BQU0sQ0FBQyxRQUFRLENBQUMsQ0FBQTtZQUM5RCxJQUFJLFFBQVEsRUFBRSxNQUFNLEtBQUssTUFBTTtnQkFBRSxPQUFNO1lBQ3ZDLElBQUksUUFBUTtnQkFBRSxJQUFJLENBQUMsS0FBSyxDQUFDLFlBQVksQ0FBQyxRQUFRLENBQUMsS0FBSyxDQUFDLENBQUE7WUFFckQsTUFBTSxLQUFLLEdBQUcsSUFBSSxDQUFDLEtBQUssQ0FBQyxVQUFVLENBQUMsR0FBRyxFQUFFO2dCQUN2QyxJQUFJLENBQUMsbUJBQW1CLENBQUMsTUFBTSxDQUFDLE1BQU0sQ0FBQyxRQUFRLElBQUksRUFBRSxDQUFDLENBQUE7Z0JBQ3RELEtBQUssSUFBSSxDQUFDLHNCQUFzQixDQUFDLE1BQU0sQ0FBQyxDQUFDLElBQUksQ0FBQyxHQUFHLEVBQUU7b0JBQ2pELElBQUksTUFBTSxDQUFDLFFBQVE7d0JBQUUsSUFBSSxDQUFDLHdCQUF3QixFQUFFLENBQUMsTUFBTSxDQUFDLFFBQVEsQ0FBQyxDQUFBO2dCQUN2RSxDQUFDLEVBQUUsQ0FBQyxLQUFLLEVBQUUsRUFBRTtvQkFDWCxJQUFJLENBQUMsMEJBQTBCLENBQUMsS0FBSyxDQUFDLENBQUE7b0JBQ3RDLElBQUksQ0FBQyxtQkFBbUIsRUFBRSxDQUFBO2dCQUM1QixDQUFDLENBQUMsQ0FBQTtZQUNKLENBQUMsRUFBRSxJQUFJLENBQUMsc0JBQXNCLENBQUMsQ0FBQTtZQUMvQixJQUFJLE9BQU8sS0FBSyxLQUFLLFFBQVE7Z0JBQUUsS0FBSyxDQUFDLEtBQUssRUFBRSxDQUFBO1lBQzVDLElBQUksQ0FBQyxtQkFBbUIsQ0FBQyxHQUFHLENBQUMsTUFBTSxDQUFDLFFBQVEsRUFBRSxFQUFDLE1BQU0sRUFBRSxLQUFLLEVBQUMsQ0FBQyxDQUFBO1lBQzlELElBQUksQ0FBQyxvQkFBb0IsRUFBRSxDQUFDLE1BQU0sQ0FBQyxRQUFRLENBQUMsQ0FBQTtZQUM1QyxPQUFNO1FBQ1IsQ0FBQztRQUVELElBQUksQ0FBQztZQUNILE1BQU0sSUFBSSxDQUFDLHNCQUFzQixDQUFDLE1BQU0sRUFBRSxFQUFDLFlBQVksRUFBQyxDQUFDLENBQUE7UUFDM0QsQ0FBQztRQUFDLE9BQU8sS0FBSyxFQUFFLENBQUM7WUFDZixJQUFJLENBQUMsMEJBQTBCLENBQUMsS0FBSyxDQUFDLENBQUE7WUFDdEMsSUFBSSxDQUFDLG1CQUFtQixFQUFFLENBQUE7UUFDNUIsQ0FBQztRQUNELElBQUksQ0FBQyxpQkFBaUIsRUFBRSxDQUFBO0lBQzFCLENBQUM7SUFFRDs7Ozs7O09BTUc7SUFDSCxLQUFLLENBQUMsc0JBQXNCLENBQUMsTUFBTSxFQUFFLEVBQUMsWUFBWSxHQUFHLEtBQUssRUFBQyxHQUFHLEVBQUU7UUFDOUQsTUFBTSxRQUFRLEdBQUcsSUFBSSxDQUFDLGNBQWMsQ0FBQyxHQUFHLENBQUMsTUFBTSxDQUFDLENBQUE7UUFFaEQsSUFBSSxDQUFDLFFBQVEsSUFBSSxRQUFRLENBQUMsSUFBSSxLQUFLLENBQUMsRUFBRSxDQUFDO1lBQ3JDLElBQUksQ0FBQyxjQUFjLENBQUMsTUFBTSxDQUFDLE1BQU0sQ0FBQyxDQUFBO1lBQ2xDLE9BQU07UUFDUixDQUFDO1FBRUQsS0FBSyxNQUFNLENBQUMsS0FBSyxFQUFFLFNBQVMsQ0FBQyxJQUFJLFFBQVEsRUFBRSxDQUFDO1lBQzFDLE1BQU0sSUFBSSxDQUFDLGVBQWUsQ0FBQyxFQUFDLFNBQVMsRUFBRSxLQUFLLEVBQUUsTUFBTSxFQUFDLENBQUMsQ0FBQTtRQUN4RCxDQUFDO1FBRUQsSUFBSSxDQUFDLGNBQWMsQ0FBQyxNQUFNLENBQUMsTUFBTSxDQUFDLENBQUE7UUFDbEMsSUFBSSxDQUFDLGVBQWUsRUFBRSxDQUFBO1FBQ3RCLElBQUksWUFBWSxFQUFFLENBQUM7WUFDakIsSUFBSSxDQUFDLGNBQWMsR0FBRyxJQUFJLENBQUE7UUFDNUIsQ0FBQzthQUFNLENBQUM7WUFDTixJQUFJLElBQUksQ0FBQyxjQUFjLEtBQUssUUFBUTtnQkFBRSxNQUFNLElBQUksQ0FBQyxNQUFNLEVBQUUsQ0FBQTtRQUMzRCxDQUFDO1FBQ0QsSUFBSSxDQUFDLGlCQUFpQixFQUFFLENBQUE7SUFDMUIsQ0FBQztJQUVEOzs7Ozs7O09BT0c7SUFDSCxLQUFLLENBQUMsZUFBZSxDQUFDLEVBQUMsU0FBUyxFQUFFLEtBQUssRUFBRSxNQUFNLEVBQUM7UUFDOUMsTUFBTSxJQUFJLENBQUMsS0FBSyxDQUFDLG1CQUFtQixDQUFDLEVBQUMsU0FBUyxFQUFFLEtBQUssRUFBQyxDQUFDLENBQUE7UUFFeEQsTUFBTSxRQUFRLEdBQUcsSUFBSSxDQUFDLGNBQWMsQ0FBQyxHQUFHLENBQUMsTUFBTSxDQUFDLENBQUE7UUFFaEQsSUFBSSxRQUFRLEVBQUUsR0FBRyxDQUFDLEtBQUssQ0FBQyxLQUFLLFNBQVM7WUFBRSxRQUFRLENBQUMsTUFBTSxDQUFDLEtBQUssQ0FBQyxDQUFBO0lBQ2hFLENBQUM7SUFFRDs7Ozs7O09BTUc7SUFDSCxjQUFjLENBQUMsRUFBQyxTQUFTLEVBQUUsS0FBSyxFQUFDO1FBQy9CLEtBQUssTUFBTSxDQUFDLE1BQU0sRUFBRSxRQUFRLENBQUMsSUFBSSxJQUFJLENBQUMsY0FBYyxFQUFFLENBQUM7WUFDckQsSUFBSSxRQUFRLENBQUMsR0FBRyxDQUFDLEtBQUssQ0FBQyxLQUFLLFNBQVM7Z0JBQUUsU0FBUTtZQUUvQyxRQUFRLENBQUMsTUFBTSxDQUFDLEtBQUssQ0FBQyxDQUFBO1lBQ3RCLElBQUksUUFBUSxDQUFDLElBQUksS0FBSyxDQUFDLElBQUksQ0FBQyxJQUFJLENBQUMsT0FBTyxDQUFDLEdBQUcsQ0FBQyxNQUFNLENBQUM7Z0JBQUUsSUFBSSxDQUFDLGNBQWMsQ0FBQyxNQUFNLENBQUMsTUFBTSxDQUFDLENBQUE7WUFDeEYsSUFBSSxRQUFRLENBQUMsSUFBSSxLQUFLLENBQUMsSUFBSSxNQUFNLENBQUMsUUFBUSxFQUFFLENBQUM7Z0JBQzNDLE1BQU0sWUFBWSxHQUFHLElBQUksQ0FBQyxtQkFBbUIsQ0FBQyxHQUFHLENBQUMsTUFBTSxDQUFDLFFBQVEsQ0FBQyxDQUFBO2dCQUNsRSxJQUFJLFlBQVksRUFBRSxNQUFNLEtBQUssTUFBTSxFQUFFLENBQUM7b0JBQ3BDLElBQUksQ0FBQyxLQUFLLENBQUMsWUFBWSxDQUFDLFlBQVksQ0FBQyxLQUFLLENBQUMsQ0FBQTtvQkFDM0MsSUFBSSxDQUFDLG1CQUFtQixDQUFDLE1BQU0sQ0FBQyxNQUFNLENBQUMsUUFBUSxDQUFDLENBQUE7Z0JBQ2xELENBQUM7WUFDSCxDQUFDO1lBQ0QsSUFBSSxDQUFDLGlCQUFpQixFQUFFLENBQUE7WUFDeEIsT0FBTTtRQUNSLENBQUM7SUFDSCxDQUFDO0lBRUQ7Ozs7T0FJRztJQUNILDBCQUEwQixDQUFDLEtBQUs7UUFDOUIsTUFBTSxlQUFlLEdBQUcsS0FBSyxZQUFZLEtBQUssQ0FBQyxDQUFDLENBQUMsS0FBSyxDQUFDLENBQUMsQ0FBQyxJQUFJLEtBQUssQ0FBQyxNQUFNLENBQUMsS0FBSyxDQUFDLENBQUMsQ0FBQTtRQUNqRixNQUFNLE9BQU8sR0FBRyxFQUFDLE9BQU8sRUFBRSxFQUFDLEtBQUssRUFBRSxnQ0FBZ0MsRUFBQyxFQUFFLEtBQUssRUFBRSxlQUFlLEVBQUMsQ0FBQTtRQUM1RixNQUFNLFdBQVcsR0FBRyxJQUFJLENBQUMsYUFBYSxDQUFDLGNBQWMsRUFBRSxDQUFBO1FBRXZELElBQUksQ0FBQyxNQUFNLENBQUMsS0FBSyxDQUFDLEdBQUcsRUFBRSxDQUFDLENBQUMsaURBQWlELEVBQUUsZUFBZSxDQUFDLENBQUMsQ0FBQTtRQUM3RixXQUFXLENBQUMsSUFBSSxDQUFDLGlCQUFpQixFQUFFLE9BQU8sQ0FBQyxDQUFBO1FBQzVDLFdBQVcsQ0FBQyxJQUFJLENBQUMsV0FBVyxFQUFFLEVBQUMsR0FBRyxPQUFPLEVBQUUsU0FBUyxFQUFFLGlCQUFpQixFQUFDLENBQUMsQ0FBQTtJQUMzRSxDQUFDO0lBRUQ7Ozs7OztPQU1HO0lBQ0gsd0JBQXdCLENBQUMsS0FBSztRQUM1QixNQUFNLGVBQWUsR0FBRyxLQUFLLFlBQVksS0FBSyxDQUFDLENBQUMsQ0FBQyxLQUFLLENBQUMsQ0FBQyxDQUFDLElBQUksS0FBSyxDQUFDLE1BQU0sQ0FBQyxLQUFLLENBQUMsQ0FBQyxDQUFBO1FBQ2pGLE1BQU0sT0FBTyxHQUFHLEVBQUMsT0FBTyxFQUFFLEVBQUMsS0FBSyxFQUFFLDhCQUE4QixFQUFDLEVBQUUsS0FBSyxFQUFFLGVBQWUsRUFBQyxDQUFBO1FBQzFGLE1BQU0sV0FBVyxHQUFHLElBQUksQ0FBQyxhQUFhLENBQUMsY0FBYyxFQUFFLENBQUE7UUFFdkQsSUFBSSxDQUFDLE1BQU0sQ0FBQyxLQUFLLENBQUMsR0FBRyxFQUFFLENBQUMsQ0FBQyw4Q0FBOEMsRUFBRSxlQUFlLENBQUMsQ0FBQyxDQUFBO1FBQzFGLFdBQVcsQ0FBQyxJQUFJLENBQUMsaUJBQWlCLEVBQUUsT0FBTyxDQUFDLENBQUE7UUFDNUMsV0FBVyxDQUFDLElBQUksQ0FBQyxXQUFXLEVBQUUsRUFBQyxHQUFHLE9BQU8sRUFBRSxTQUFTLEVBQUUsaUJBQWlCLEVBQUMsQ0FBQyxDQUFBO0lBQzNFLENBQUM7SUFFRDs7Ozs7T0FLRztJQUNILGlDQUFpQyxDQUFDLEtBQUs7UUFDckMsTUFBTSxlQUFlLEdBQUcsS0FBSyxZQUFZLEtBQUssQ0FBQyxDQUFDLENBQUMsS0FBSyxDQUFDLENBQUMsQ0FBQyxJQUFJLEtBQUssQ0FBQyxNQUFNLENBQUMsS0FBSyxDQUFDLENBQUMsQ0FBQTtRQUNqRixNQUFNLE9BQU8sR0FBRyxFQUFDLE9BQU8sRUFBRSxFQUFDLEtBQUssRUFBRSx3Q0FBd0MsRUFBQyxFQUFFLEtBQUssRUFBRSxlQUFlLEVBQUMsQ0FBQTtRQUNwRyxNQUFNLFdBQVcsR0FBRyxJQUFJLENBQUMsYUFBYSxDQUFDLGNBQWMsRUFBRSxDQUFBO1FBRXZELElBQUksQ0FBQyxNQUFNLENBQUMsS0FBSyxDQUFDLEdBQUcsRUFBRSxDQUFDLENBQUMsa0RBQWtELEVBQUUsZUFBZSxDQUFDLENBQUMsQ0FBQTtRQUM5RixXQUFXLENBQUMsSUFBSSxDQUFDLGlCQUFpQixFQUFFLE9BQU8sQ0FBQyxDQUFBO1FBQzVDLFdBQVcsQ0FBQyxJQUFJLENBQUMsV0FBVyxFQUFFLEVBQUMsR0FBRyxPQUFPLEVBQUUsU0FBUyxFQUFFLGlCQUFpQixFQUFDLENBQUMsQ0FBQTtJQUMzRSxDQUFDO0lBRUQ7Ozs7OztPQU1HO0lBQ0gsS0FBSyxDQUFDLGNBQWMsQ0FBQyxFQUFDLFVBQVUsRUFBRSxPQUFPLEVBQUM7UUFDeEMsSUFBSSxDQUFDO1lBQ0gsTUFBTSxLQUFLLEdBQUcsTUFBTSxJQUFJLENBQUMsS0FBSyxDQUFDLE9BQU8sQ0FBQztnQkFDckMsT0FBTyxFQUFFLE9BQU8sQ0FBQyxPQUFPO2dCQUN4QixJQUFJLEVBQUUsT0FBTyxDQUFDLElBQUksSUFBSSxFQUFFO2dCQUN4QixPQUFPLEVBQUUsT0FBTyxDQUFDLE9BQU8sSUFBSSxFQUFFO2FBQy9CLENBQUMsQ0FBQTtZQUVGLFVBQVUsQ0FBQyxJQUFJLENBQUMsRUFBQyxJQUFJLEVBQUUsVUFBVSxFQUFFLEtBQUssRUFBQyxDQUFDLENBQUE7WUFDMUMsSUFBSSxDQUFDLGVBQWUsRUFBRSxDQUFBO1lBQ3RCLE1BQU0sSUFBSSxDQUFDLE1BQU0sRUFBRSxDQUFBO1FBQ3JCLENBQUM7UUFBQyxPQUFPLEtBQUssRUFBRSxDQUFDO1lBQ2YsSUFBSSxDQUFDLDBCQUEwQixDQUFDO2dCQUM5QixPQUFPLEVBQUUsRUFBQyxPQUFPLEVBQUUsT0FBTyxDQUFDLE9BQU8sRUFBRSxLQUFLLEVBQUUsd0JBQXdCLEVBQUM7Z0JBQ3BFLEtBQUs7Z0JBQ0wsZUFBZSxFQUFFLHVCQUF1QjtnQkFDeEMsVUFBVTtnQkFDVixVQUFVLEVBQUUsbUNBQW1DO2dCQUMvQyxZQUFZLEVBQUUsZUFBZTthQUM5QixDQUFDLENBQUE7UUFDSixDQUFDO0lBQ0gsQ0FBQztJQUVEOzs7Ozs7T0FNRztJQUNILEtBQUssQ0FBQyx1QkFBdUIsQ0FBQyxFQUFDLFVBQVUsRUFBRSxPQUFPLEVBQUM7UUFDakQsSUFBSSxDQUFDO1lBQ0gsTUFBTSxNQUFNLEdBQUcsTUFBTSxJQUFJLENBQUMsS0FBSyxDQUFDLGdCQUFnQixDQUFDO2dCQUMvQyxXQUFXLEVBQUUsT0FBTyxDQUFDLFdBQVc7Z0JBQ2hDLE9BQU8sRUFBRSxPQUFPLENBQUMsT0FBTztnQkFDeEIsSUFBSSxFQUFFLE9BQU8sQ0FBQyxJQUFJLElBQUksRUFBRTtnQkFDeEIsT0FBTyxFQUFFLE9BQU8sQ0FBQyxPQUFPLElBQUksRUFBRTthQUMvQixDQUFDLENBQUE7WUFFRixJQUFJLENBQUMsZUFBZSxFQUFFLENBQUE7WUFDdEIsTUFBTSxJQUFJLENBQUMsTUFBTSxFQUFFLENBQUE7WUFDbkIsVUFBVSxDQUFDLElBQUksQ0FBQyxFQUFDLElBQUksRUFBRSxtQkFBbUIsRUFBRSxHQUFHLE1BQU0sRUFBQyxDQUFDLENBQUE7UUFDekQsQ0FBQztRQUFDLE9BQU8sS0FBSyxFQUFFLENBQUM7WUFDZixJQUFJLENBQUMsMEJBQTBCLENBQUM7Z0JBQzlCLE9BQU8sRUFBRSxFQUFDLE9BQU8sRUFBRSxPQUFPLENBQUMsT0FBTyxFQUFFLFdBQVcsRUFBRSxPQUFPLENBQUMsV0FBVyxFQUFFLEtBQUssRUFBRSxrQ0FBa0MsRUFBQztnQkFDaEgsS0FBSztnQkFDTCxlQUFlLEVBQUUsaUNBQWlDO2dCQUNsRCxVQUFVO2dCQUNWLFVBQVUsRUFBRSw2Q0FBNkM7Z0JBQ3pELFlBQVksRUFBRSx5QkFBeUI7YUFDeEMsQ0FBQyxDQUFBO1FBQ0osQ0FBQztJQUNILENBQUM7SUFFRDs7Ozs7O09BTUc7SUFDSCxLQUFLLENBQUMsc0JBQXNCLENBQUMsRUFBQyxVQUFVLEVBQUUsT0FBTyxFQUFDO1FBQ2hELElBQUksQ0FBQztZQUNILE1BQU0sTUFBTSxHQUFHLE1BQU0sSUFBSSxDQUFDLEtBQUssQ0FBQyxlQUFlLENBQUMsT0FBTyxDQUFDLFdBQVcsQ0FBQyxDQUFBO1lBRXBFLElBQUksQ0FBQyxlQUFlLEVBQUUsQ0FBQTtZQUN0QixNQUFNLElBQUksQ0FBQyxNQUFNLEVBQUUsQ0FBQTtZQUNuQixVQUFVLENBQUMsSUFBSSxDQUFDLEVBQUMsSUFBSSxFQUFFLG9CQUFvQixFQUFFLEdBQUcsTUFBTSxFQUFDLENBQUMsQ0FBQTtRQUMxRCxDQUFDO1FBQUMsT0FBTyxLQUFLLEVBQUUsQ0FBQztZQUNmLElBQUksQ0FBQywwQkFBMEIsQ0FBQztnQkFDOUIsT0FBTyxFQUFFLEVBQUMsV0FBVyxFQUFFLE9BQU8sQ0FBQyxXQUFXLEVBQUUsS0FBSyxFQUFFLGlDQUFpQyxFQUFDO2dCQUNyRixLQUFLO2dCQUNMLGVBQWUsRUFBRSxnQ0FBZ0M7Z0JBQ2pELFVBQVU7Z0JBQ1YsVUFBVSxFQUFFLDRDQUE0QztnQkFDeEQsWUFBWSxFQUFFLHdCQUF3QjthQUN2QyxDQUFDLENBQUE7UUFDSixDQUFDO0lBQ0gsQ0FBQztJQUVEOzs7Ozs7Ozs7O09BVUc7SUFDSCwwQkFBMEIsQ0FBQyxFQUFDLE9BQU8sRUFBRSxLQUFLLEVBQUUsZUFBZSxFQUFFLFVBQVUsRUFBRSxVQUFVLEVBQUUsWUFBWSxFQUFDO1FBQ2hHLElBQUksS0FBSyxZQUFZLGNBQWMsSUFBSSxLQUFLLENBQUMsWUFBWSxFQUFFLENBQUM7WUFDMUQsVUFBVSxDQUFDLElBQUksQ0FBQyxFQUFDLElBQUksRUFBRSxZQUFZLEVBQUUsS0FBSyxFQUFFLEtBQUssQ0FBQyxPQUFPLEVBQUMsQ0FBQyxDQUFBO1lBQzNELE9BQU07UUFDUixDQUFDO1FBRUQsTUFBTSxlQUFlLEdBQUcsS0FBSyxZQUFZLEtBQUssQ0FBQyxDQUFDLENBQUMsS0FBSyxDQUFDLENBQUMsQ0FBQyxJQUFJLEtBQUssQ0FBQyxNQUFNLENBQUMsS0FBSyxDQUFDLENBQUMsQ0FBQTtRQUNqRixNQUFNLE9BQU8sR0FBRyxFQUFDLE9BQU8sRUFBRSxLQUFLLEVBQUUsZUFBZSxFQUFDLENBQUE7UUFDakQsTUFBTSxXQUFXLEdBQUcsSUFBSSxDQUFDLGFBQWEsQ0FBQyxjQUFjLEVBQUUsQ0FBQTtRQUV2RCxJQUFJLENBQUMsTUFBTSxDQUFDLEtBQUssQ0FBQyxHQUFHLEVBQUUsQ0FBQyxDQUFDLFVBQVUsRUFBRSxlQUFlLENBQUMsQ0FBQyxDQUFBO1FBQ3RELFdBQVcsQ0FBQyxJQUFJLENBQUMsaUJBQWlCLEVBQUUsT0FBTyxDQUFDLENBQUE7UUFDNUMsV0FBVyxDQUFDLElBQUksQ0FBQyxXQUFXLEVBQUUsRUFBQyxHQUFHLE9BQU8sRUFBRSxTQUFTLEVBQUUsaUJBQWlCLEVBQUMsQ0FBQyxDQUFBO1FBQ3pFLFVBQVUsQ0FBQyxJQUFJLENBQUMsRUFBQyxJQUFJLEVBQUUsWUFBWSxFQUFFLEtBQUssRUFBRSxlQUFlLEVBQUMsQ0FBQyxDQUFBO0lBQy9ELENBQUM7SUFFRDs7Ozs7O09BTUc7SUFDSCxLQUFLLENBQUMsa0JBQWtCLENBQUMsRUFBQyxVQUFVLEVBQUUsT0FBTyxFQUFDO1FBQzVDLElBQUksQ0FBQztZQUNILE1BQU0sUUFBUSxHQUFHLE1BQU0sSUFBSSxDQUFDLEtBQUssQ0FBQyxhQUFhLENBQUM7Z0JBQzlDLEtBQUssRUFBRSxPQUFPLENBQUMsS0FBSztnQkFDcEIsU0FBUyxFQUFFLE9BQU8sQ0FBQyxTQUFTO2dCQUM1QixRQUFRLEVBQUUsT0FBTyxDQUFDLFFBQVE7Z0JBQzFCLGFBQWEsRUFBRSxPQUFPLENBQUMsYUFBYTthQUNyQyxDQUFDLENBQUE7WUFDRixJQUFJLFFBQVEsSUFBSSxPQUFPLENBQUMsU0FBUyxFQUFFLENBQUM7Z0JBQ2xDLElBQUksQ0FBQyxjQUFjLENBQUMsRUFBQyxTQUFTLEVBQUUsT0FBTyxDQUFDLFNBQVMsRUFBRSxLQUFLLEVBQUUsT0FBTyxDQUFDLEtBQUssRUFBQyxDQUFDLENBQUE7WUFDM0UsQ0FBQztZQUNELElBQUksQ0FBQyxZQUFZLEVBQUUsQ0FBQyxFQUFDLFFBQVEsRUFBRSxLQUFLLEVBQUUsT0FBTyxDQUFDLEtBQUssRUFBRSxNQUFNLEVBQUUsV0FBVyxFQUFDLENBQUMsQ0FBQTtZQUMxRSxVQUFVLENBQUMsSUFBSSxDQUFDLEVBQUMsSUFBSSxFQUFFLGFBQWEsRUFBRSxLQUFLLEVBQUUsT0FBTyxDQUFDLEtBQUssRUFBQyxDQUFDLENBQUE7UUFDOUQsQ0FBQztRQUFDLE9BQU8sS0FBSyxFQUFFLENBQUM7WUFDZixJQUFJLENBQUMsdUJBQXVCLENBQUMsRUFBQyxLQUFLLEVBQUUsS0FBSyxFQUFFLE9BQU8sQ0FBQyxLQUFLLEVBQUUsS0FBSyxFQUFFLHlCQUF5QixFQUFDLENBQUMsQ0FBQTtZQUM3RixVQUFVLENBQUMsSUFBSSxDQUFDLEVBQUMsSUFBSSxFQUFFLGtCQUFrQixFQUFFLEtBQUssRUFBRSxPQUFPLENBQUMsS0FBSyxFQUFFLEtBQUssRUFBRSxzQkFBc0IsRUFBQyxDQUFDLENBQUE7UUFDbEcsQ0FBQztJQUNILENBQUM7SUFFRDs7Ozs7OztPQU9HO0lBQ0gsdUJBQXVCLENBQUMsRUFBQyxLQUFLLEVBQUUsS0FBSyxFQUFFLEtBQUssRUFBQztRQUMzQyxNQUFNLGVBQWUsR0FBRyxLQUFLLFlBQVksS0FBSyxDQUFDLENBQUMsQ0FBQyxLQUFLLENBQUMsQ0FBQyxDQUFDLElBQUksS0FBSyxDQUFDLE1BQU0sQ0FBQyxLQUFLLENBQUMsQ0FBQyxDQUFBO1FBQ2pGLE1BQU0sT0FBTyxHQUFHLEVBQUMsT0FBTyxFQUFFLEVBQUMsWUFBWSxFQUFFLElBQUksQ0FBQyxZQUFZLEVBQUUsS0FBSyxFQUFFLEtBQUssRUFBQyxFQUFFLEtBQUssRUFBRSxlQUFlLEVBQUMsQ0FBQTtRQUNsRyxNQUFNLFdBQVcsR0FBRyxJQUFJLENBQUMsYUFBYSxDQUFDLGNBQWMsRUFBRSxDQUFBO1FBRXZELElBQUksQ0FBQyxNQUFNLENBQUMsS0FBSyxDQUFDLEdBQUcsRUFBRSxDQUFDLENBQUMsa0NBQWtDLEVBQUUsZUFBZSxDQUFDLENBQUMsQ0FBQTtRQUM5RSxXQUFXLENBQUMsSUFBSSxDQUFDLGlCQUFpQixFQUFFLE9BQU8sQ0FBQyxDQUFBO1FBQzVDLFdBQVcsQ0FBQyxJQUFJLENBQUMsV0FBVyxFQUFFLEVBQUMsR0FBRyxPQUFPLEVBQUUsU0FBUyxFQUFFLGlCQUFpQixFQUFDLENBQUMsQ0FBQTtJQUMzRSxDQUFDO0lBRUQ7Ozs7OztPQU1HO0lBQ0gsS0FBSyxDQUFDLG9CQUFvQixDQUFDLEVBQUMsVUFBVSxFQUFFLE9BQU8sRUFBQztRQUM5QyxJQUFJLENBQUM7WUFDSCxNQUFNLFFBQVEsR0FBRyxNQUFNLElBQUksQ0FBQyxLQUFLLENBQUMsZUFBZSxDQUFDO2dCQUNoRCxLQUFLLEVBQUUsT0FBTyxDQUFDLEtBQUs7Z0JBQ3BCLE9BQU8sRUFBRSxPQUFPLENBQUMsT0FBTztnQkFDeEIsU0FBUyxFQUFFLE9BQU8sQ0FBQyxTQUFTO2dCQUM1QixRQUFRLEVBQUUsT0FBTyxDQUFDLFFBQVE7Z0JBQzFCLGFBQWEsRUFBRSxPQUFPLENBQUMsYUFBYTthQUNyQyxDQUFDLENBQUE7WUFDRixJQUFJLFFBQVEsSUFBSSxPQUFPLENBQUMsU0FBUyxFQUFFLENBQUM7Z0JBQ2xDLElBQUksQ0FBQyxjQUFjLENBQUMsRUFBQyxTQUFTLEVBQUUsT0FBTyxDQUFDLFNBQVMsRUFBRSxLQUFLLEVBQUUsT0FBTyxDQUFDLEtBQUssRUFBQyxDQUFDLENBQUE7WUFDM0UsQ0FBQztZQUNELElBQUksQ0FBQyxZQUFZLEVBQUUsQ0FBQyxFQUFDLFFBQVEsRUFBRSxLQUFLLEVBQUUsT0FBTyxDQUFDLEtBQUssRUFBRSxNQUFNLEVBQUUsYUFBYSxFQUFDLENBQUMsQ0FBQTtZQUM1RSxVQUFVLENBQUMsSUFBSSxDQUFDLEVBQUMsSUFBSSxFQUFFLGFBQWEsRUFBRSxLQUFLLEVBQUUsT0FBTyxDQUFDLEtBQUssRUFBQyxDQUFDLENBQUE7WUFDNUQsSUFBSSxDQUFDLGVBQWUsRUFBRSxDQUFBO1lBQ3RCLE1BQU0sSUFBSSxDQUFDLE1BQU0sRUFBRSxDQUFBO1FBQ3JCLENBQUM7UUFBQyxPQUFPLEtBQUssRUFBRSxDQUFDO1lBQ2YsTUFBTSxlQUFlLEdBQUcsS0FBSyxZQUFZLEtBQUssQ0FBQyxDQUFDLENBQUMsS0FBSyxDQUFDLENBQUMsQ0FBQyxJQUFJLEtBQUssQ0FBQyxNQUFNLENBQUMsS0FBSyxDQUFDLENBQUMsQ0FBQTtZQUNqRixNQUFNLE9BQU8sR0FBRyxFQUFDLE9BQU8sRUFBRSxFQUFDLEtBQUssRUFBRSxPQUFPLENBQUMsS0FBSyxFQUFFLEtBQUssRUFBRSwyQkFBMkIsRUFBQyxFQUFFLEtBQUssRUFBRSxlQUFlLEVBQUMsQ0FBQTtZQUM3RyxNQUFNLFdBQVcsR0FBRyxJQUFJLENBQUMsYUFBYSxDQUFDLGNBQWMsRUFBRSxDQUFBO1lBRXZELElBQUksQ0FBQyxNQUFNLENBQUMsS0FBSyxDQUFDLEdBQUcsRUFBRSxDQUFDLENBQUMsa0NBQWtDLEVBQUUsZUFBZSxDQUFDLENBQUMsQ0FBQTtZQUM5RSxXQUFXLENBQUMsSUFBSSxDQUFDLGlCQUFpQixFQUFFLE9BQU8sQ0FBQyxDQUFBO1lBQzVDLFdBQVcsQ0FBQyxJQUFJLENBQUMsV0FBVyxFQUFFLEVBQUMsR0FBRyxPQUFPLEVBQUUsU0FBUyxFQUFFLGlCQUFpQixFQUFDLENBQUMsQ0FBQTtZQUN6RSxVQUFVLENBQUMsSUFBSSxDQUFDLEVBQUMsSUFBSSxFQUFFLGtCQUFrQixFQUFFLEtBQUssRUFBRSxPQUFPLENBQUMsS0FBSyxFQUFFLEtBQUssRUFBRSxzQkFBc0IsRUFBQyxDQUFDLENBQUE7UUFDbEcsQ0FBQztJQUNILENBQUM7SUFFRDs7Ozs7O09BTUc7SUFDSCxLQUFLLENBQUMsZ0JBQWdCLENBQUMsRUFBQyxVQUFVLEVBQUUsT0FBTyxFQUFDO1FBQzFDLElBQUksQ0FBQztZQUNILE1BQU0sU0FBUyxHQUFHLE1BQU0sSUFBSSxDQUFDLEtBQUssQ0FBQyxVQUFVLENBQUM7Z0JBQzVDLEtBQUssRUFBRSxPQUFPLENBQUMsS0FBSztnQkFDcEIsS0FBSyxFQUFFLE9BQU8sQ0FBQyxLQUFLO2dCQUNwQixTQUFTLEVBQUUsT0FBTyxDQUFDLFNBQVM7Z0JBQzVCLFFBQVEsRUFBRSxPQUFPLENBQUMsUUFBUTtnQkFDMUIsYUFBYSxFQUFFLE9BQU8sQ0FBQyxhQUFhO2FBQ3JDLENBQUMsQ0FBQTtZQUVGLElBQUksU0FBUyxFQUFFLENBQUM7Z0JBQ2QsSUFBSSxPQUFPLENBQUMsU0FBUyxFQUFFLENBQUM7b0JBQ3RCLElBQUksQ0FBQyxjQUFjLENBQUMsRUFBQyxTQUFTLEVBQUUsT0FBTyxDQUFDLFNBQVMsRUFBRSxLQUFLLEVBQUUsT0FBTyxDQUFDLEtBQUssRUFBQyxDQUFDLENBQUE7Z0JBQzNFLENBQUM7Z0JBQ0QsSUFBSSxDQUFDLHdCQUF3QixDQUFDO29CQUM1QixLQUFLLEVBQUUsT0FBTyxDQUFDLEtBQUs7b0JBQ3BCLFNBQVMsRUFBRSxPQUFPLENBQUMsU0FBUztvQkFDNUIsYUFBYSxFQUFFLE9BQU8sQ0FBQyxhQUFhO29CQUNwQyxHQUFHLEVBQUUsU0FBUztvQkFDZCxRQUFRLEVBQUUsT0FBTyxDQUFDLFFBQVE7aUJBQzNCLENBQUMsQ0FBQTtZQUNKLENBQUM7WUFFRCxJQUFJLENBQUMsWUFBWSxFQUFFLENBQUMsRUFBQyxRQUFRLEVBQUUsT0FBTyxDQUFDLFNBQVMsQ0FBQyxFQUFFLEtBQUssRUFBRSxPQUFPLENBQUMsS0FBSyxFQUFFLE1BQU0sRUFBRSxRQUFRLEVBQUMsQ0FBQyxDQUFBO1lBQzNGLFVBQVUsQ0FBQyxJQUFJLENBQUMsRUFBQyxJQUFJLEVBQUUsYUFBYSxFQUFFLEtBQUssRUFBRSxPQUFPLENBQUMsS0FBSyxFQUFDLENBQUMsQ0FBQTtZQUM1RCxrRUFBa0U7WUFDbEUsbURBQW1EO1lBQ25ELElBQUksQ0FBQyxlQUFlLEVBQUUsQ0FBQTtZQUN0QixNQUFNLElBQUksQ0FBQyxNQUFNLEVBQUUsQ0FBQTtRQUNyQixDQUFDO1FBQUMsT0FBTyxLQUFLLEVBQUUsQ0FBQztZQUNmLElBQUksQ0FBQyxNQUFNLENBQUMsS0FBSyxDQUFDLEdBQUcsRUFBRSxDQUFDLENBQUMsK0JBQStCLEVBQUUsS0FBSyxDQUFDLENBQUMsQ0FBQTtZQUNqRSxVQUFVLENBQUMsSUFBSSxDQUFDLEVBQUMsSUFBSSxFQUFFLGtCQUFrQixFQUFFLEtBQUssRUFBRSxPQUFPLENBQUMsS0FBSyxFQUFFLEtBQUssRUFBRSxzQkFBc0IsRUFBQyxDQUFDLENBQUE7UUFDbEcsQ0FBQztJQUNILENBQUM7SUFFRDs7OztPQUlHO0lBQ0gsd0JBQXdCLENBQUMsRUFBQyxLQUFLLEVBQUUsU0FBUyxFQUFFLGFBQWEsRUFBRSxHQUFHLEVBQUUsUUFBUSxFQUFDO1FBQ3ZFLE1BQU0sZUFBZSxHQUFHLElBQUksQ0FBQyxzQkFBc0IsQ0FBQyxLQUFLLENBQUMsQ0FBQTtRQUMxRCxNQUFNLE9BQU8sR0FBRztZQUNkLE9BQU8sRUFBRTtnQkFDUCxRQUFRLEVBQUUsR0FBRyxDQUFDLFFBQVE7Z0JBQ3RCLFNBQVM7Z0JBQ1QsYUFBYTtnQkFDYixPQUFPLEVBQUUsR0FBRyxDQUFDLElBQUk7Z0JBQ2pCLEtBQUssRUFBRSxHQUFHLENBQUMsRUFBRTtnQkFDYixPQUFPLEVBQUUsR0FBRyxDQUFDLE9BQU87Z0JBQ3BCLFVBQVUsRUFBRSxHQUFHLENBQUMsVUFBVTtnQkFDMUIsS0FBSyxFQUFFLHVCQUF1QjtnQkFDOUIsTUFBTSxFQUFFLEdBQUcsQ0FBQyxNQUFNO2dCQUNsQixRQUFRLEVBQUUsR0FBRyxDQUFDLE1BQU0sS0FBSyxRQUFRLElBQUksR0FBRyxDQUFDLE1BQU0sS0FBSyxVQUFVO2dCQUM5RCxTQUFTLEVBQUUsR0FBRyxDQUFDLE1BQU0sS0FBSyxRQUFRO2dCQUNsQyxRQUFRO2FBQ1Q7WUFDRCxLQUFLLEVBQUUsZUFBZTtTQUN2QixDQUFBO1FBQ0QsTUFBTSxXQUFXLEdBQUcsSUFBSSxDQUFDLGFBQWEsQ0FBQyxjQUFjLEVBQUUsQ0FBQTtRQUV2RCxXQUFXLENBQUMsSUFBSSxDQUFDLHVCQUF1QixFQUFFLE9BQU8sQ0FBQyxDQUFBO1FBQ2xELFdBQVcsQ0FBQyxJQUFJLENBQUMsV0FBVyxFQUFFLEVBQUMsR0FBRyxPQUFPLEVBQUUsU0FBUyxFQUFFLHVCQUF1QixFQUFDLENBQUMsQ0FBQTtJQUNqRixDQUFDO0lBRUQ7Ozs7Ozs7O09BUUc7SUFDSCwwQkFBMEIsQ0FBQyxFQUFDLEdBQUcsRUFBQztRQUM5QixNQUFNLGVBQWUsR0FBRyxJQUFJLENBQUMsc0JBQXNCLENBQUMsR0FBRyxDQUFDLFNBQVMsSUFBSSw0QkFBNEIsQ0FBQyxDQUFBO1FBQ2xHLE1BQU0sT0FBTyxHQUFHO1lBQ2QsT0FBTyxFQUFFO2dCQUNQLFFBQVEsRUFBRSxHQUFHLENBQUMsUUFBUTtnQkFDdEIsT0FBTyxFQUFFLEdBQUcsQ0FBQyxJQUFJO2dCQUNqQixLQUFLLEVBQUUsR0FBRyxDQUFDLEVBQUU7Z0JBQ2IsT0FBTyxFQUFFLEdBQUcsQ0FBQyxPQUFPO2dCQUNwQixVQUFVLEVBQUUsR0FBRyxDQUFDLFVBQVU7Z0JBQzFCLEtBQUssRUFBRSx5QkFBeUI7Z0JBQ2hDLE1BQU0sRUFBRSxHQUFHLENBQUMsTUFBTTtnQkFDbEIsUUFBUSxFQUFFLEdBQUcsQ0FBQyxNQUFNLEtBQUssUUFBUSxJQUFJLEdBQUcsQ0FBQyxNQUFNLEtBQUssVUFBVTtnQkFDOUQsU0FBUyxFQUFFLEdBQUcsQ0FBQyxNQUFNLEtBQUssUUFBUTthQUNuQztZQUNELEtBQUssRUFBRSxlQUFlO1NBQ3ZCLENBQUE7UUFDRCxNQUFNLFdBQVcsR0FBRyxJQUFJLENBQUMsYUFBYSxDQUFDLGNBQWMsRUFBRSxDQUFBO1FBRXZELFdBQVcsQ0FBQyxJQUFJLENBQUMseUJBQXlCLEVBQUUsT0FBTyxDQUFDLENBQUE7UUFDcEQsV0FBVyxDQUFDLElBQUksQ0FBQyxXQUFXLEVBQUUsRUFBQyxHQUFHLE9BQU8sRUFBRSxTQUFTLEVBQUUseUJBQXlCLEVBQUMsQ0FBQyxDQUFBO0lBQ25GLENBQUM7SUFFRDs7OztPQUlHO0lBQ0gsc0JBQXNCLENBQUMsS0FBSztRQUMxQixJQUFJLEtBQUssWUFBWSxLQUFLO1lBQUUsT0FBTyxLQUFLLENBQUE7UUFFeEMsT0FBTyxJQUFJLENBQUMsd0JBQXdCLENBQUMsS0FBSyxDQUFDLENBQUE7SUFDN0MsQ0FBQztJQUVEOzs7O09BSUc7SUFDSCx3QkFBd0IsQ0FBQyxLQUFLO1FBQzVCLE1BQU0sT0FBTyxHQUFHLElBQUksQ0FBQywwQkFBMEIsQ0FBQyxLQUFLLENBQUMsQ0FBQTtRQUN0RCxNQUFNLGVBQWUsR0FBRyxJQUFJLEtBQUssQ0FBQyxPQUFPLENBQUMsQ0FBQTtRQUUxQyxJQUFJLENBQUMsdUJBQXVCLENBQUMsRUFBQyxLQUFLLEVBQUUsZUFBZSxFQUFDLENBQUMsQ0FBQTtRQUV0RCxPQUFPLGVBQWUsQ0FBQTtJQUN4QixDQUFDO0lBRUQ7Ozs7T0FJRztJQUNILDBCQUEwQixDQUFDLEtBQUs7UUFDOUIsSUFBSSxJQUFJLENBQUMsaUJBQWlCLENBQUMsS0FBSyxDQUFDO1lBQUUsT0FBTyxLQUFLLENBQUMsSUFBSSxFQUFFLENBQUMsS0FBSyxDQUFDLElBQUksQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFBO1FBRXJFLE9BQU8sTUFBTSxDQUFDLEtBQUssSUFBSSx1QkFBdUIsQ0FBQyxDQUFBO0lBQ2pELENBQUM7SUFFRDs7OztPQUlHO0lBQ0gsaUJBQWlCLENBQUMsS0FBSztRQUNyQixPQUFPLE9BQU8sS0FBSyxLQUFLLFFBQVEsSUFBSSxLQUFLLENBQUMsSUFBSSxFQUFFLENBQUMsTUFBTSxHQUFHLENBQUMsQ0FBQTtJQUM3RCxDQUFDO0lBRUQ7Ozs7OztPQU1HO0lBQ0gsdUJBQXVCLENBQUMsRUFBQyxLQUFLLEVBQUUsZUFBZSxFQUFDO1FBQzlDLElBQUksSUFBSSxDQUFDLGlCQUFpQixDQUFDLEtBQUssQ0FBQztZQUFFLGVBQWUsQ0FBQyxLQUFLLEdBQUcsS0FBSyxDQUFBO0lBQ2xFLENBQUM7SUFFRDs7Ozs7Ozs7Ozs7Ozs7OztPQWdCRztJQUNILEtBQUssQ0FBQyxNQUFNO1FBQ1YsSUFBSSxJQUFJLENBQUMsUUFBUSxJQUFJLElBQUksQ0FBQyxjQUFjLEtBQUssUUFBUSxJQUFJLENBQUMsSUFBSSxDQUFDLHFCQUFxQjtZQUFFLE9BQU07UUFFNUYsSUFBSSxJQUFJLENBQUMsYUFBYSxFQUFFLENBQUM7WUFDdkIsSUFBSSxDQUFDLGNBQWMsR0FBRyxJQUFJLENBQUE7WUFDMUIsTUFBTSxJQUFJLENBQUMsYUFBYSxDQUFBO1lBQ3hCLE9BQU07UUFDUixDQUFDO1FBRUQsTUFBTSxZQUFZLEdBQUcsSUFBSSxDQUFDLGtCQUFrQixFQUFFLENBQUE7UUFFOUMsSUFBSSxDQUFDLGFBQWEsR0FBRyxZQUFZLENBQUE7UUFDakMsTUFBTSxZQUFZLENBQUE7SUFDcEIsQ0FBQztJQUVEOzs7T0FHRztJQUNILEtBQUssQ0FBQyxrQkFBa0I7UUFDdEIsSUFBSSxDQUFDLFNBQVMsR0FBRyxJQUFJLENBQUE7UUFFckIsSUFBSSxDQUFDO1lBQ0gsSUFBSSxPQUFPLENBQUE7WUFFWCxHQUFHLENBQUM7Z0JBQ0YsT0FBTyxHQUFHLE1BQU0sSUFBSSxDQUFDLGVBQWUsRUFBRSxDQUFBO2dCQUN0QyxNQUFNLElBQUksQ0FBQyxZQUFZLENBQUMsRUFBQyxPQUFPLEVBQUMsQ0FBQyxDQUFBO1lBQ3BDLENBQUMsUUFBUSxDQUFDLE9BQU8sSUFBSSxJQUFJLENBQUMsY0FBYyxJQUFJLENBQUMsSUFBSSxDQUFDLFFBQVEsSUFBSSxJQUFJLENBQUMsY0FBYyxLQUFLLFFBQVEsRUFBQztRQUNqRyxDQUFDO2dCQUFTLENBQUM7WUFDVCxJQUFJLENBQUMsU0FBUyxHQUFHLEtBQUssQ0FBQTtZQUN0QixJQUFJLENBQUMsYUFBYSxHQUFHLFNBQVMsQ0FBQTtRQUNoQyxDQUFDO0lBQ0gsQ0FBQztJQUVEOzs7OztPQUtHO0lBQ0gsS0FBSyxDQUFDLFlBQVksQ0FBQyxFQUFDLE9BQU8sRUFBQztRQUMxQixJQUFJLElBQUksQ0FBQyxRQUFRLElBQUksSUFBSSxDQUFDLGNBQWMsS0FBSyxRQUFRO1lBQUUsT0FBTTtRQUM3RCxJQUFJLE9BQU87WUFBRSxPQUFPLElBQUksQ0FBQyxtQkFBbUIsRUFBRSxDQUFBO1FBRTlDLE1BQU0sSUFBSSxDQUFDLHlCQUF5QixFQUFFLENBQUE7SUFDeEMsQ0FBQztJQUVEOzs7T0FHRztJQUNILEtBQUssQ0FBQyx5QkFBeUI7UUFDN0IsSUFBSSxDQUFDO1lBQ0gsTUFBTSxJQUFJLENBQUMsa0JBQWtCLEVBQUUsQ0FBQTtRQUNqQyxDQUFDO1FBQUMsT0FBTyxLQUFLLEVBQUUsQ0FBQztZQUNmLElBQUksQ0FBQyxNQUFNLENBQUMsS0FBSyxDQUFDLEdBQUcsRUFBRSxDQUFDLENBQUMsZ0RBQWdELEVBQUUsS0FBSyxDQUFDLENBQUMsQ0FBQTtZQUNsRixJQUFJLENBQUMsbUJBQW1CLEVBQUUsQ0FBQTtZQUMxQixPQUFNO1FBQ1IsQ0FBQztRQUVELElBQUksQ0FBQyxxQkFBcUIsRUFBRSxDQUFBO0lBQzlCLENBQUM7SUFFRDs7eUJBRXFCO0lBQ3JCLHFCQUFxQjtRQUNuQixJQUFJLElBQUksQ0FBQyx3QkFBd0IsQ0FBQyxJQUFJLEdBQUcsQ0FBQztZQUFFLE9BQU07UUFDbEQsSUFBSSxJQUFJLENBQUMsMkJBQTJCLElBQUksSUFBSSxDQUFDLHNCQUFzQixDQUFDLE1BQU0sR0FBRyxDQUFDO1lBQUUsT0FBTTtRQUV0RixLQUFLLE1BQU0sTUFBTSxJQUFJLElBQUksQ0FBQyxjQUFjLENBQUMsSUFBSSxFQUFFLEVBQUUsQ0FBQztZQUNoRCxJQUFJLENBQUMsSUFBSSxDQUFDLE9BQU8sQ0FBQyxHQUFHLENBQUMsTUFBTSxDQUFDO2dCQUFFLE9BQU07UUFDdkMsQ0FBQztRQUVELElBQUksSUFBSSxDQUFDLGdCQUFnQixFQUFFLENBQUM7WUFDMUIsWUFBWSxDQUFDLElBQUksQ0FBQyxnQkFBZ0IsQ0FBQyxDQUFBO1lBQ25DLElBQUksQ0FBQyxnQkFBZ0IsR0FBRyxTQUFTLENBQUE7UUFDbkMsQ0FBQztJQUNILENBQUM7SUFFRDs7O09BR0c7SUFDSCxLQUFLLENBQUMsZUFBZTtRQUNuQixPQUFPLE1BQU0sSUFBSSxDQUFDLGFBQWEsRUFBRSxDQUFBO0lBQ25DLENBQUM7SUFFRDs7O09BR0c7SUFDSCxLQUFLLENBQUMsYUFBYTtRQUNqQixHQUFHLENBQUM7WUFDRixJQUFJLENBQUMsY0FBYyxHQUFHLEtBQUssQ0FBQTtZQUMzQixNQUFNLE9BQU8sR0FBRyxNQUFNLElBQUksQ0FBQyx5QkFBeUIsRUFBRSxDQUFBO1lBRXRELElBQUksT0FBTztnQkFBRSxPQUFPLElBQUksQ0FBQTtRQUMxQixDQUFDLFFBQVEsSUFBSSxDQUFDLGNBQWMsSUFBSSxDQUFDLElBQUksQ0FBQyxRQUFRLEVBQUM7UUFFL0MsT0FBTyxLQUFLLENBQUE7SUFDZCxDQUFDO0lBRUQ7OztPQUdHO0lBQ0gsS0FBSyxDQUFDLHlCQUF5QjtRQUM3QixJQUFJLENBQUM7WUFDSCxNQUFNLElBQUksQ0FBQyxVQUFVLEVBQUUsQ0FBQTtZQUN2QixPQUFPLEtBQUssQ0FBQTtRQUNkLENBQUM7UUFBQyxPQUFPLEtBQUssRUFBRSxDQUFDO1lBQ2YsSUFBSSxDQUFDLE1BQU0sQ0FBQyxLQUFLLENBQUMsR0FBRyxFQUFFLENBQUMsQ0FBQywrQkFBK0IsRUFBRSxLQUFLLENBQUMsQ0FBQyxDQUFBO1lBQ2pFLE9BQU8sSUFBSSxDQUFBO1FBQ2IsQ0FBQztJQUNILENBQUM7SUFFRDs7Ozs7O09BTUc7SUFDSCxtQkFBbUI7UUFDakIsSUFBSSxJQUFJLENBQUMsUUFBUTtZQUFFLE9BQU07UUFDekIsSUFBSSxJQUFJLENBQUMsZ0JBQWdCO1lBQUUsT0FBTTtRQUNqQyxJQUFJLElBQUksQ0FBQyxnQkFBZ0IsS0FBSyxTQUFTLElBQUksSUFBSSxDQUFDLGNBQWMsS0FBSyxRQUFRO1lBQUUsT0FBTTtRQUVuRixJQUFJLENBQUMsZ0JBQWdCLEdBQUcsVUFBVSxDQUFDLEdBQUcsRUFBRTtZQUN0QyxJQUFJLENBQUMsZ0JBQWdCLEdBQUcsU0FBUyxDQUFBO1lBQ2pDLEtBQUssSUFBSSxDQUFDLGdCQUFnQixFQUFFLENBQUE7UUFDOUIsQ0FBQyxFQUFFLElBQUksQ0FBQyxjQUFjLENBQUMsQ0FBQTtJQUN6QixDQUFDO0lBRUQ7Ozs7T0FJRztJQUNILEtBQUssQ0FBQyxnQkFBZ0I7UUFDcEIsSUFBSSxJQUFJLENBQUMsUUFBUTtZQUFFLE9BQU07UUFFekIsSUFBSSxJQUFJLENBQUMsMkJBQTJCLElBQUksSUFBSSxDQUFDLHNCQUFzQixDQUFDLE1BQU0sR0FBRyxDQUFDLEVBQUUsQ0FBQztZQUMvRSxNQUFNLElBQUksQ0FBQywyQkFBMkIsRUFBRSxDQUFBO1lBQ3hDLElBQUksSUFBSSxDQUFDLHNCQUFzQixDQUFDLE1BQU0sR0FBRyxDQUFDO2dCQUFFLE9BQU07UUFDcEQsQ0FBQztRQUVELElBQUksQ0FBQztZQUNILE1BQU0sSUFBSSxDQUFDLDhCQUE4QixFQUFFLENBQUE7UUFDN0MsQ0FBQztRQUFDLE1BQU0sQ0FBQztZQUNQLElBQUksQ0FBQyxtQkFBbUIsRUFBRSxDQUFBO1lBQzFCLE9BQU07UUFDUixDQUFDO1FBRUQsSUFBSSxDQUFDO1lBQ0gsS0FBSyxNQUFNLE1BQU0sSUFBSSxJQUFJLENBQUMsY0FBYyxDQUFDLElBQUksRUFBRSxFQUFFLENBQUM7Z0JBQ2hELElBQUksQ0FBQyxJQUFJLENBQUMsT0FBTyxDQUFDLEdBQUcsQ0FBQyxNQUFNLENBQUM7b0JBQUUsTUFBTSxJQUFJLENBQUMsc0JBQXNCLENBQUMsTUFBTSxDQUFDLENBQUE7WUFDMUUsQ0FBQztRQUNILENBQUM7UUFBQyxPQUFPLEtBQUssRUFBRSxDQUFDO1lBQ2YsSUFBSSxDQUFDLDBCQUEwQixDQUFDLEtBQUssQ0FBQyxDQUFBO1lBQ3RDLElBQUksQ0FBQyxtQkFBbUIsRUFBRSxDQUFBO1lBQzFCLE9BQU07UUFDUixDQUFDO1FBRUQsSUFBSSxJQUFJLENBQUMsY0FBYyxLQUFLLFFBQVE7WUFBRSxNQUFNLElBQUksQ0FBQyxNQUFNLEVBQUUsQ0FBQTtRQUN6RCxJQUFJLENBQUMsaUJBQWlCLEVBQUUsQ0FBQTtJQUMxQixDQUFDO0lBRUQ7Ozs7T0FJRztJQUNILEtBQUssQ0FBQyxVQUFVO1FBQ2QsT0FBTyxJQUFJLENBQUMsWUFBWSxDQUFDLElBQUksR0FBRyxDQUFDLElBQUksQ0FBQyxJQUFJLENBQUMsUUFBUSxJQUFJLElBQUksQ0FBQyxjQUFjLEtBQUssUUFBUSxJQUFJLElBQUksQ0FBQyxxQkFBcUIsRUFBRSxDQUFDO1lBQ3RILE1BQU0sR0FBRyxHQUFHLE1BQU0sSUFBSSxDQUFDLCtCQUErQixFQUFFLENBQUE7WUFDeEQsSUFBSSxDQUFDLEdBQUc7Z0JBQUUsT0FBTTtZQUVoQixNQUFNLE1BQU0sR0FBRyxJQUFJLENBQUMsaUJBQWlCLENBQUMsR0FBRyxDQUFDLENBQUE7WUFDMUMsSUFBSSxDQUFDLE1BQU07Z0JBQUUsT0FBTTtZQUVuQixNQUFNLFNBQVMsR0FBRyxJQUFJLENBQUMsdUJBQXVCLENBQUMsRUFBQyxHQUFHLEVBQUUsTUFBTSxFQUFDLENBQUMsQ0FBQTtZQUM3RCxNQUFNLGtCQUFrQixHQUFHLFVBQVUsRUFBRSxDQUFBO1lBQ3ZDLElBQUksT0FBTyxDQUFBO1lBRVgsSUFBSSxDQUFDO2dCQUNILE9BQU8sR0FBRyxNQUFNLElBQUksQ0FBQyxLQUFLLENBQUMsYUFBYSxDQUFDLEVBQUMsU0FBUyxFQUFFLGtCQUFrQixFQUFFLEtBQUssRUFBRSxHQUFHLENBQUMsRUFBRSxFQUFFLFFBQVEsRUFBRSxNQUFNLENBQUMsUUFBUSxFQUFDLENBQUMsQ0FBQTtZQUNySCxDQUFDO1lBQUMsT0FBTyxLQUFLLEVBQUUsQ0FBQztnQkFDZixJQUFJLENBQUMsd0JBQXdCLENBQUMsRUFBQyxTQUFTLEVBQUUsa0JBQWtCLEVBQUUsS0FBSyxFQUFFLEdBQUcsQ0FBQyxFQUFFLEVBQUMsQ0FBQyxDQUFBO2dCQUM3RSxJQUFJLENBQUMsdUJBQXVCLENBQUMsRUFBQyxHQUFHLFNBQVMsRUFBRSxNQUFNLEVBQUMsQ0FBQyxDQUFBO2dCQUVwRCxJQUFJLENBQUM7b0JBQ0gsTUFBTSxJQUFJLENBQUMsZUFBZSxDQUFDLEVBQUMsU0FBUyxFQUFFLGtCQUFrQixFQUFFLEtBQUssRUFBRSxHQUFHLENBQUMsRUFBRSxFQUFDLENBQUMsQ0FBQTtnQkFDNUUsQ0FBQztnQkFBQyxPQUFPLGFBQWEsRUFBRSxDQUFDO29CQUN2QixJQUFJLENBQUMsMkJBQTJCLENBQUMsRUFBQyxLQUFLLEVBQUUsYUFBYSxFQUFFLFNBQVMsRUFBRSxrQkFBa0IsRUFBRSxLQUFLLEVBQUUsR0FBRyxDQUFDLEVBQUUsRUFBQyxDQUFDLENBQUE7Z0JBQ3hHLENBQUM7Z0JBRUQsTUFBTSxLQUFLLENBQUE7WUFDYixDQUFDO1lBRUQsSUFBSSxDQUFDLE9BQU8sRUFBRSxDQUFDO2dCQUNiLElBQUksQ0FBQyx1QkFBdUIsQ0FBQyxFQUFDLEdBQUcsU0FBUyxFQUFFLE1BQU0sRUFBQyxDQUFDLENBQUE7Z0JBQ3BELFNBQVE7WUFDVixDQUFDO1lBRUQsTUFBTSxJQUFJLENBQUMsaUJBQWlCLEVBQUUsQ0FBQyxFQUFDLE9BQU8sRUFBRSxHQUFHLEVBQUMsQ0FBQyxDQUFBO1lBRTlDLE1BQU0sUUFBUSxHQUFHLElBQUksQ0FBQyxjQUFjLENBQUMsR0FBRyxDQUFDLE1BQU0sQ0FBQyxDQUFBO1lBRWhELElBQUksQ0FBQyxRQUFRLElBQUksQ0FBQyxJQUFJLENBQUMsT0FBTyxDQUFDLEdBQUcsQ0FBQyxNQUFNLENBQUMsSUFBSSxNQUFNLENBQUMsVUFBVSxJQUFJLElBQUksQ0FBQyxjQUFjLEtBQUssUUFBUSxJQUFJLENBQUMsSUFBSSxDQUFDLHFCQUFxQixFQUFFLENBQUM7Z0JBQ25JLElBQUksQ0FBQyx3QkFBd0IsQ0FBQyxFQUFDLFNBQVMsRUFBRSxPQUFPLENBQUMsU0FBUyxFQUFFLEtBQUssRUFBRSxHQUFHLENBQUMsRUFBRSxFQUFDLENBQUMsQ0FBQTtnQkFDNUUsSUFBSSxDQUFDO29CQUNILE1BQU0sSUFBSSxDQUFDLGVBQWUsQ0FBQyxFQUFDLFNBQVMsRUFBRSxPQUFPLENBQUMsU0FBUyxFQUFFLEtBQUssRUFBRSxHQUFHLENBQUMsRUFBRSxFQUFDLENBQUMsQ0FBQTtnQkFDM0UsQ0FBQztnQkFBQyxPQUFPLGFBQWEsRUFBRSxDQUFDO29CQUN2QixJQUFJLENBQUMsMkJBQTJCLENBQUMsRUFBQyxLQUFLLEVBQUUsYUFBYSxFQUFFLFNBQVMsRUFBRSxPQUFPLENBQUMsU0FBUyxFQUFFLEtBQUssRUFBRSxHQUFHLENBQUMsRUFBRSxFQUFDLENBQUMsQ0FBQTtvQkFDckcsTUFBTSxhQUFhLENBQUE7Z0JBQ3JCLENBQUM7Z0JBQ0QsSUFBSSxDQUFDLGVBQWUsRUFBRSxDQUFBO2dCQUN0QixJQUFJLENBQUMsY0FBYyxHQUFHLElBQUksQ0FBQTtnQkFDMUIsU0FBUTtZQUNWLENBQUM7WUFFRCxJQUFJLENBQUMsd0JBQXdCLENBQUMsRUFBQyxHQUFHLFNBQVMsRUFBRSxHQUFHLEVBQUUsTUFBTSxFQUFDLENBQUMsQ0FBQTtZQUMxRCxRQUFRLENBQUMsR0FBRyxDQUFDLEdBQUcsQ0FBQyxFQUFFLEVBQUUsT0FBTyxDQUFDLFNBQVMsQ0FBQyxDQUFBO1lBRXZDLElBQUksQ0FBQztnQkFDSCxNQUFNLENBQUMsSUFBSSxDQUFDO29CQUNWLElBQUksRUFBRSxLQUFLO29CQUNYLE9BQU8sRUFBRTt3QkFDUCxFQUFFLEVBQUUsR0FBRyxDQUFDLEVBQUU7d0JBQ1YsT0FBTyxFQUFFLEdBQUcsQ0FBQyxPQUFPO3dCQUNwQixJQUFJLEVBQUUsR0FBRyxDQUFDLElBQUk7d0JBQ2QsU0FBUyxFQUFFLE9BQU8sQ0FBQyxTQUFTO3dCQUM1QixRQUFRLEVBQUUsTUFBTSxDQUFDLFFBQVE7d0JBQ3pCLGFBQWEsRUFBRSxPQUFPLENBQUMsYUFBYTt3QkFDcEMsT0FBTyxFQUFFOzRCQUNQLGNBQWMsRUFBRSxHQUFHLENBQUMsY0FBYyxJQUFJLFNBQVM7NEJBQy9DLGFBQWEsRUFBRSxHQUFHLENBQUMsYUFBYTs0QkFDaEMsY0FBYyxFQUFFLEdBQUcsQ0FBQyxjQUFjLElBQUksU0FBUzs0QkFDL0MsVUFBVSxFQUFFLEdBQUcsQ0FBQyxVQUFVLElBQUksU0FBUzs0QkFDdkMsS0FBSyxFQUFFLEdBQUcsQ0FBQyxLQUFLOzRCQUNoQixhQUFhLEVBQUUsR0FBRyxDQUFDLGFBQWEsSUFBSSxTQUFTOzRCQUM3QyxHQUFHLENBQUMsR0FBRyxDQUFDLFNBQVMsS0FBSyxJQUFJLENBQUMsQ0FBQyxDQUFDLEVBQUUsQ0FBQyxDQUFDLENBQUMsRUFBQyxTQUFTLEVBQUUsR0FBRyxDQUFDLFNBQVMsRUFBQyxDQUFDO3lCQUM5RDtxQkFDRjtpQkFDRixDQUFDLENBQUE7WUFDSixDQUFDO1lBQUMsT0FBTyxLQUFLLEVBQUUsQ0FBQztnQkFDZixJQUFJLENBQUMsTUFBTSxDQUFDLElBQUksQ0FBQyxHQUFHLEVBQUUsQ0FBQyxDQUFDLDRDQUE0QyxFQUFFLEtBQUssQ0FBQyxDQUFDLENBQUE7Z0JBQzdFLElBQUksQ0FBQztvQkFDSCxNQUFNLENBQUMsS0FBSyxFQUFFLENBQUE7Z0JBQ2hCLENBQUM7Z0JBQUMsT0FBTyxVQUFVLEVBQUUsQ0FBQztvQkFDcEIsSUFBSSxDQUFDLE1BQU0sQ0FBQyxJQUFJLENBQUMsR0FBRyxFQUFFLENBQUMsQ0FBQyxnREFBZ0QsRUFBRSxVQUFVLENBQUMsQ0FBQyxDQUFBO2dCQUN4RixDQUFDO2dCQUNELE1BQU0sSUFBSSxDQUFDLHlCQUF5QixDQUFDLE1BQU0sRUFBRSxFQUFDLFlBQVksRUFBRSxJQUFJLEVBQUMsQ0FBQyxDQUFBO1lBQ3BFLENBQUM7UUFDSCxDQUFDO0lBQ0gsQ0FBQztJQUVEOzs7Ozs7T0FNRztJQUNILHVCQUF1QixDQUFDLEVBQUMsR0FBRyxFQUFFLE1BQU0sRUFBQztRQUNuQyxJQUFJLG9CQUFvQixHQUFHLEtBQUssQ0FBQTtRQUVoQyxJQUFJLENBQUMsWUFBWSxDQUFDLE1BQU0sQ0FBQyxNQUFNLENBQUMsQ0FBQTtRQUVoQyxJQUFJLEdBQUcsQ0FBQyxhQUFhLEtBQUssUUFBUSxJQUFJLE1BQU0sQ0FBQyx5QkFBeUIsSUFBSSxNQUFNLENBQUMsb0JBQW9CLEdBQUcsQ0FBQyxFQUFFLENBQUM7WUFDMUcsb0JBQW9CLEdBQUcsSUFBSSxDQUFBO1lBQzNCLE1BQU0sQ0FBQyxvQkFBb0IsSUFBSSxDQUFDLENBQUE7WUFDaEMsSUFBSSxNQUFNLENBQUMsb0JBQW9CLEdBQUcsQ0FBQztnQkFBRSxJQUFJLENBQUMsWUFBWSxDQUFDLEdBQUcsQ0FBQyxNQUFNLENBQUMsQ0FBQTtRQUNwRSxDQUFDO1FBRUQsT0FBTyxFQUFDLG9CQUFvQixFQUFFLGdCQUFnQixFQUFFLE1BQU0sQ0FBQyxnQkFBZ0IsRUFBQyxDQUFBO0lBQzFFLENBQUM7SUFFRDs7Ozs7Ozs7T0FRRztJQUNILHVCQUF1QixDQUFDLEVBQUMsb0JBQW9CLEVBQUUsZ0JBQWdCLEVBQUUsTUFBTSxFQUFDO1FBQ3RFLElBQUksSUFBSSxDQUFDLFFBQVEsSUFBSSxJQUFJLENBQUMsY0FBYyxLQUFLLFFBQVEsSUFBSSxDQUFDLElBQUksQ0FBQyxxQkFBcUIsSUFBSSxDQUFDLElBQUksQ0FBQyxPQUFPLENBQUMsR0FBRyxDQUFDLE1BQU0sQ0FBQyxJQUFJLE1BQU0sQ0FBQyxVQUFVO1lBQUUsT0FBTTtRQUU5SSxJQUFJLG9CQUFvQixJQUFJLE1BQU0sQ0FBQyxnQkFBZ0IsS0FBSyxnQkFBZ0IsRUFBRSxDQUFDO1lBQ3pFLE1BQU0sQ0FBQyxvQkFBb0IsSUFBSSxDQUFDLENBQUE7UUFDbEMsQ0FBQztRQUVELElBQUksTUFBTSxDQUFDLDBCQUEwQjtZQUFFLElBQUksQ0FBQyxZQUFZLENBQUMsR0FBRyxDQUFDLE1BQU0sQ0FBQyxDQUFBO0lBQ3RFLENBQUM7SUFFRDs7Ozs7Ozs7O09BU0c7SUFDSCx3QkFBd0IsQ0FBQyxFQUFDLEdBQUcsRUFBRSxvQkFBb0IsRUFBRSxnQkFBZ0IsRUFBRSxNQUFNLEVBQUM7UUFDNUUsSUFBSSxDQUFDLG9CQUFvQixJQUFJLEdBQUcsQ0FBQyxhQUFhLEtBQUssUUFBUTtZQUFFLE9BQU07UUFDbkUsSUFBSSxNQUFNLENBQUMsZ0JBQWdCLEtBQUssZ0JBQWdCLElBQUksQ0FBQyxNQUFNLENBQUMseUJBQXlCO1lBQUUsT0FBTTtRQUM3RixJQUFJLE1BQU0sQ0FBQyxvQkFBb0IsSUFBSSxDQUFDO1lBQUUsT0FBTTtRQUU1QyxNQUFNLENBQUMsb0JBQW9CLElBQUksQ0FBQyxDQUFBO1FBQ2hDLElBQUksTUFBTSxDQUFDLG9CQUFvQixLQUFLLENBQUM7WUFBRSxJQUFJLENBQUMsWUFBWSxDQUFDLE1BQU0sQ0FBQyxNQUFNLENBQUMsQ0FBQTtJQUN6RSxDQUFDO0lBRUQ7Ozs7T0FJRztJQUNILHdCQUF3QixDQUFDLEVBQUMsU0FBUyxFQUFFLEtBQUssRUFBQztRQUN6QyxJQUFJLENBQUMsd0JBQXdCLENBQUMsR0FBRyxDQUFDLFNBQVMsRUFBRSxLQUFLLENBQUMsQ0FBQTtJQUNyRCxDQUFDO0lBRUQ7Ozs7O09BS0c7SUFDSCxLQUFLLENBQUMsZUFBZSxDQUFDLEVBQUMsU0FBUyxFQUFFLEtBQUssRUFBQztRQUN0QyxNQUFNLElBQUksQ0FBQyxLQUFLLENBQUMsbUJBQW1CLENBQUMsRUFBQyxTQUFTLEVBQUUsS0FBSyxFQUFDLENBQUMsQ0FBQTtRQUV4RCxJQUFJLElBQUksQ0FBQyx3QkFBd0IsQ0FBQyxHQUFHLENBQUMsU0FBUyxDQUFDLEtBQUssS0FBSyxFQUFFLENBQUM7WUFDM0QsSUFBSSxDQUFDLHdCQUF3QixDQUFDLE1BQU0sQ0FBQyxTQUFTLENBQUMsQ0FBQTtRQUNqRCxDQUFDO0lBQ0gsQ0FBQztJQUVEOzs7O09BSUc7SUFDSCxLQUFLLENBQUMsOEJBQThCO1FBQ2xDLEtBQUssTUFBTSxDQUFDLFNBQVMsRUFBRSxLQUFLLENBQUMsSUFBSSxDQUFDLEdBQUcsSUFBSSxDQUFDLHdCQUF3QixDQUFDLEVBQUUsQ0FBQztZQUNwRSxJQUFJLENBQUM7Z0JBQ0gsTUFBTSxJQUFJLENBQUMsZUFBZSxDQUFDLEVBQUMsU0FBUyxFQUFFLEtBQUssRUFBQyxDQUFDLENBQUE7WUFDaEQsQ0FBQztZQUFDLE9BQU8sS0FBSyxFQUFFLENBQUM7Z0JBQ2YsSUFBSSxDQUFDLDJCQUEyQixDQUFDLEVBQUMsS0FBSyxFQUFFLFNBQVMsRUFBRSxLQUFLLEVBQUMsQ0FBQyxDQUFBO2dCQUMzRCxNQUFNLEtBQUssQ0FBQTtZQUNiLENBQUM7UUFDSCxDQUFDO0lBQ0gsQ0FBQztJQUVEOzs7Ozs7O09BT0c7SUFDSCwyQkFBMkIsQ0FBQyxFQUFDLEtBQUssRUFBRSxTQUFTLEVBQUUsS0FBSyxFQUFDO1FBQ25ELE1BQU0sZUFBZSxHQUFHLEtBQUssWUFBWSxLQUFLLENBQUMsQ0FBQyxDQUFDLEtBQUssQ0FBQyxDQUFDLENBQUMsSUFBSSxLQUFLLENBQUMsTUFBTSxDQUFDLEtBQUssQ0FBQyxDQUFDLENBQUE7UUFDakYsTUFBTSxPQUFPLEdBQUc7WUFDZCxPQUFPLEVBQUUsRUFBQyxTQUFTLEVBQUUsS0FBSyxFQUFFLEtBQUssRUFBRSwyQ0FBMkMsRUFBQztZQUMvRSxLQUFLLEVBQUUsZUFBZTtTQUN2QixDQUFBO1FBQ0QsTUFBTSxXQUFXLEdBQUcsSUFBSSxDQUFDLGFBQWEsQ0FBQyxjQUFjLEVBQUUsQ0FBQTtRQUV2RCxJQUFJLENBQUMsTUFBTSxDQUFDLEtBQUssQ0FBQyxHQUFHLEVBQUUsQ0FBQyxDQUFDLHdEQUF3RCxFQUFFLGVBQWUsQ0FBQyxDQUFDLENBQUE7UUFDcEcsV0FBVyxDQUFDLElBQUksQ0FBQyxpQkFBaUIsRUFBRSxPQUFPLENBQUMsQ0FBQTtRQUM1QyxXQUFXLENBQUMsSUFBSSxDQUFDLFdBQVcsRUFBRSxFQUFDLEdBQUcsT0FBTyxFQUFFLFNBQVMsRUFBRSxpQkFBaUIsRUFBQyxDQUFDLENBQUE7SUFDM0UsQ0FBQztJQUVEOzs7T0FHRztJQUNILEtBQUssQ0FBQywrQkFBK0I7UUFDbkMsTUFBTSxjQUFjLEdBQUcsSUFBSSxDQUFDLHlCQUF5QixFQUFFLENBQUE7UUFFdkQsSUFBSSxjQUFjLENBQUMsTUFBTSxLQUFLLENBQUM7WUFBRSxPQUFPLElBQUksQ0FBQTtRQUM1QyxJQUFJLGNBQWMsQ0FBQyxNQUFNLEtBQUssa0NBQWtDLENBQUMsTUFBTTtZQUFFLE9BQU8sTUFBTSxJQUFJLENBQUMsS0FBSyxDQUFDLGdCQUFnQixFQUFFLENBQUE7UUFFbkgsT0FBTyxNQUFNLElBQUksQ0FBQyxLQUFLLENBQUMsZ0JBQWdCLENBQUMsRUFBQyxhQUFhLEVBQUUsY0FBYyxFQUFDLENBQUMsQ0FBQTtJQUMzRSxDQUFDO0lBRUQ7OztPQUdHO0lBQ0gseUJBQXlCO1FBQ3ZCLE1BQU0sY0FBYyxHQUFHLElBQUksR0FBRyxFQUFFLENBQUE7UUFFaEMsS0FBSyxNQUFNLE1BQU0sSUFBSSxJQUFJLENBQUMsWUFBWSxFQUFFLENBQUM7WUFDdkMsSUFBSSxDQUFDLDBCQUEwQixDQUFDLEVBQUMsY0FBYyxFQUFFLE1BQU0sRUFBQyxDQUFDLENBQUE7UUFDM0QsQ0FBQztRQUVELE9BQU8sZ0VBQWdFLENBQUMsQ0FBQyxDQUFDLEdBQUcsY0FBYyxDQUFDLENBQUMsQ0FBQTtJQUMvRixDQUFDO0lBRUQ7Ozs7OztPQU1HO0lBQ0gsMEJBQTBCLENBQUMsRUFBQyxjQUFjLEVBQUUsTUFBTSxFQUFDO1FBQ2pELElBQUksQ0FBQyxNQUFNLENBQUMsMEJBQTBCO1lBQUUsT0FBTTtRQUU5QyxLQUFLLE1BQU0sVUFBVSxJQUFJLGtDQUFrQyxFQUFFLENBQUM7WUFDNUQsSUFBSSxVQUFVLENBQUMsT0FBTyxDQUFDLE1BQU0sQ0FBQztnQkFBRSxjQUFjLENBQUMsR0FBRyxDQUFDLFVBQVUsQ0FBQyxhQUFhLENBQUMsQ0FBQTtRQUM5RSxDQUFDO0lBQ0gsQ0FBQztJQUVEOzs7O09BSUc7SUFDSCxpQkFBaUIsQ0FBQyxHQUFHO1FBQ25CLEtBQUssTUFBTSxNQUFNLElBQUksSUFBSSxDQUFDLFlBQVksRUFBRSxDQUFDO1lBQ3ZDLElBQUksSUFBSSxDQUFDLGlCQUFpQixDQUFDLEVBQUMsR0FBRyxFQUFFLE1BQU0sRUFBQyxDQUFDO2dCQUFFLE9BQU8sTUFBTSxDQUFBO1FBQzFELENBQUM7SUFDSCxDQUFDO0lBRUQ7Ozs7OztPQU1HO0lBQ0gsaUJBQWlCLENBQUMsRUFBQyxHQUFHLEVBQUUsTUFBTSxFQUFDO1FBQzdCLElBQUksQ0FBQyxNQUFNLENBQUMsMEJBQTBCO1lBQUUsT0FBTyxLQUFLLENBQUE7UUFFcEQsTUFBTSxVQUFVLEdBQUcsMENBQTBDLENBQUMsR0FBRyxDQUFDLEdBQUcsQ0FBQyxhQUFhLENBQUMsQ0FBQTtRQUVwRixJQUFJLENBQUMsVUFBVTtZQUFFLE9BQU8sS0FBSyxDQUFBO1FBRTdCLE9BQU8sVUFBVSxDQUFDLE9BQU8sQ0FBQyxNQUFNLENBQUMsQ0FBQTtJQUNuQyxDQUFDO0lBRUQ7Ozs7OztPQU1HO0lBQ0gsS0FBSyxDQUFDLGtCQUFrQjtRQUN0QixJQUFJLElBQUksQ0FBQyxlQUFlLEVBQUUsQ0FBQztZQUN6QixZQUFZLENBQUMsSUFBSSxDQUFDLGVBQWUsQ0FBQyxDQUFBO1lBQ2xDLElBQUksQ0FBQyxlQUFlLEdBQUcsU0FBUyxDQUFBO1FBQ2xDLENBQUM7UUFFRCxJQUFJLElBQUksQ0FBQyxRQUFRLElBQUksSUFBSSxDQUFDLGNBQWMsS0FBSyxRQUFRLElBQUksQ0FBQyxJQUFJLENBQUMscUJBQXFCO1lBQUUsT0FBTTtRQUM1RixJQUFJLElBQUksQ0FBQyxnQkFBZ0IsS0FBSyxTQUFTO1lBQUUsT0FBTTtRQUUvQyxNQUFNLElBQUksR0FBRyxNQUFNLElBQUksQ0FBQyxLQUFLLENBQUMsZ0JBQWdCLEVBQUUsQ0FBQTtRQUNoRCxJQUFJLEtBQUssQ0FBQTtRQUVULElBQUksSUFBSSxJQUFJLE9BQU8sSUFBSSxDQUFDLGFBQWEsS0FBSyxRQUFRLEVBQUUsQ0FBQztZQUNuRCxLQUFLLEdBQUcsSUFBSSxDQUFDLEdBQUcsQ0FBQyxDQUFDLEVBQUUsSUFBSSxDQUFDLEdBQUcsQ0FBQyxJQUFJLENBQUMsYUFBYSxHQUFHLElBQUksQ0FBQyxLQUFLLENBQUMsR0FBRyxFQUFFLEVBQUUsWUFBWSxDQUFDLENBQUMsQ0FBQTtRQUNwRixDQUFDO1FBRUQsb0VBQW9FO1FBQ3BFLDJFQUEyRTtRQUMzRSxrRUFBa0U7UUFDbEUsd0VBQXdFO1FBQ3hFLDBCQUEwQjtRQUMxQixJQUFJLE1BQU0sSUFBSSxDQUFDLCtCQUErQixFQUFFO1lBQUUsS0FBSyxHQUFHLENBQUMsQ0FBQTtRQUUzRCxJQUFJLE9BQU8sS0FBSyxLQUFLLFFBQVE7WUFBRSxPQUFNO1FBRXJDLElBQUksQ0FBQyxlQUFlLEdBQUcsVUFBVSxDQUFDLEdBQUcsRUFBRTtZQUNyQyxJQUFJLENBQUMsZUFBZSxHQUFHLFNBQVMsQ0FBQTtZQUNoQyxLQUFLLElBQUksQ0FBQyxNQUFNLEVBQUUsQ0FBQTtRQUNwQixDQUFDLEVBQUUsS0FBSyxDQUFDLENBQUE7SUFDWCxDQUFDO0lBRUQsS0FBSyxDQUFDLGFBQWE7UUFDakIsSUFBSSxDQUFDO1lBQ0gsSUFBSSxZQUFZLENBQUE7WUFFaEIsSUFBSSxJQUFJLENBQUMsWUFBWSxFQUFFLENBQUM7Z0JBQ3RCLE1BQU0sa0JBQWtCLEdBQUcsSUFBSSxHQUFHLEVBQUUsQ0FBQTtnQkFDcEMsS0FBSyxNQUFNLE1BQU0sSUFBSSxJQUFJLENBQUMsT0FBTyxFQUFFLENBQUM7b0JBQ2xDLElBQUksTUFBTSxDQUFDLFFBQVE7d0JBQUUsa0JBQWtCLENBQUMsR0FBRyxDQUFDLE1BQU0sQ0FBQyxRQUFRLENBQUMsQ0FBQTtnQkFDOUQsQ0FBQztnQkFDRCxLQUFLLE1BQU0sUUFBUSxJQUFJLElBQUksQ0FBQyxtQkFBbUIsQ0FBQyxJQUFJLEVBQUU7b0JBQUUsa0JBQWtCLENBQUMsR0FBRyxDQUFDLFFBQVEsQ0FBQyxDQUFBO2dCQUV4RixNQUFNLE1BQU0sR0FBRyxJQUFJLENBQUMsS0FBSyxDQUFDLEdBQUcsRUFBRSxHQUFHLDRCQUE0QixDQUFBO2dCQUM5RCxNQUFNLFFBQVEsR0FBRyxDQUFDLE1BQU0sSUFBSSxDQUFDLCtCQUErQixFQUFFLENBQUMsQ0FBQyxNQUFNLENBQUMsQ0FBQyxPQUFPLEVBQUUsRUFBRTtvQkFDakYsT0FBTyxPQUFPLENBQUMsYUFBYSxJQUFJLE1BQU0sSUFBSSxDQUFDLGtCQUFrQixDQUFDLEdBQUcsQ0FBQyxPQUFPLENBQUMsUUFBUSxDQUFDLENBQUE7Z0JBQ3JGLENBQUMsQ0FBQyxDQUFBO2dCQUNGLFlBQVksR0FBRyxRQUFRLENBQUMsTUFBTSxLQUFLLENBQUM7b0JBQ2xDLENBQUMsQ0FBQyxFQUFFO29CQUNKLENBQUMsQ0FBQyxNQUFNLElBQUksQ0FBQyxLQUFLLENBQUMsb0JBQW9CLENBQUMsRUFBQyxRQUFRLEVBQUUsS0FBSyxFQUFFLHFEQUFxRCxFQUFDLENBQUMsQ0FBQTtZQUNySCxDQUFDO2lCQUFNLENBQUM7Z0JBQ04sWUFBWSxHQUFHLE1BQU0sSUFBSSxDQUFDLEtBQUssQ0FBQyxnQkFBZ0IsRUFBRSxDQUFBO1lBQ3BELENBQUM7WUFFRCxNQUFNLElBQUksQ0FBQyxtQkFBbUIsQ0FBQyxFQUFDLElBQUksRUFBRSxZQUFZLEVBQUUsT0FBTyxFQUFFLGlDQUFpQyxFQUFDLENBQUMsQ0FBQTtRQUNsRyxDQUFDO1FBQUMsT0FBTyxLQUFLLEVBQUUsQ0FBQztZQUNmLE1BQU0sZUFBZSxHQUFHLEtBQUssWUFBWSxLQUFLLENBQUMsQ0FBQyxDQUFDLEtBQUssQ0FBQyxDQUFDLENBQUMsSUFBSSxLQUFLLENBQUMsTUFBTSxDQUFDLEtBQUssQ0FBQyxDQUFDLENBQUE7WUFDakYsTUFBTSxPQUFPLEdBQUcsRUFBQyxPQUFPLEVBQUUsRUFBQyxZQUFZLEVBQUUsSUFBSSxDQUFDLFlBQVksRUFBRSxLQUFLLEVBQUUsNkJBQTZCLEVBQUMsRUFBRSxLQUFLLEVBQUUsZUFBZSxFQUFDLENBQUE7WUFDMUgsTUFBTSxXQUFXLEdBQUcsSUFBSSxDQUFDLGFBQWEsQ0FBQyxjQUFjLEVBQUUsQ0FBQTtZQUV2RCxJQUFJLENBQUMsTUFBTSxDQUFDLEtBQUssQ0FBQyxHQUFHLEVBQUUsQ0FBQyxDQUFDLCtCQUErQixFQUFFLGVBQWUsQ0FBQyxDQUFDLENBQUE7WUFDM0UsV0FBVyxDQUFDLElBQUksQ0FBQyxpQkFBaUIsRUFBRSxPQUFPLENBQUMsQ0FBQTtZQUM1QyxXQUFXLENBQUMsSUFBSSxDQUFDLFdBQVcsRUFBRSxFQUFDLEdBQUcsT0FBTyxFQUFFLFNBQVMsRUFBRSxpQkFBaUIsRUFBQyxDQUFDLENBQUE7UUFDM0UsQ0FBQztJQUNILENBQUM7SUFFRDs7Ozs7Ozs7T0FRRztJQUNILEtBQUssQ0FBQyxtQkFBbUIsQ0FBQyxFQUFDLElBQUksRUFBRSxPQUFPLEVBQUM7UUFDdkMsSUFBSSxJQUFJLENBQUMsTUFBTSxLQUFLLENBQUMsRUFBRSxDQUFDO1lBQ3RCLElBQUksQ0FBQyxpQkFBaUIsRUFBRSxDQUFBO1lBQ3hCLE9BQU07UUFDUixDQUFDO1FBRUQsSUFBSSxDQUFDLE1BQU0sQ0FBQyxJQUFJLENBQUMsR0FBRyxFQUFFLENBQUMsQ0FBQyxPQUFPLEVBQUUsSUFBSSxDQUFDLE1BQU0sQ0FBQyxDQUFDLENBQUE7UUFDOUMsMEVBQTBFO1FBQzFFLHdFQUF3RTtRQUN4RSxJQUFJLENBQUMsZUFBZSxFQUFFLENBQUE7UUFDdEIsc0VBQXNFO1FBQ3RFLDBFQUEwRTtRQUMxRSxLQUFLLE1BQU0sR0FBRyxJQUFJLElBQUksRUFBRSxDQUFDO1lBQ3ZCLElBQUksQ0FBQztnQkFDSCxJQUFJLENBQUMsMEJBQTBCLENBQUMsRUFBQyxHQUFHLEVBQUMsQ0FBQyxDQUFBO1lBQ3hDLENBQUM7WUFBQyxPQUFPLEtBQUssRUFBRSxDQUFDO2dCQUNmLElBQUksQ0FBQyxNQUFNLENBQUMsS0FBSyxDQUFDLEdBQUcsRUFBRSxDQUFDLENBQUMsZ0RBQWdELEVBQUUsS0FBSyxDQUFDLENBQUMsQ0FBQTtZQUNwRixDQUFDO1FBQ0gsQ0FBQztRQUNELE1BQU0sSUFBSSxDQUFDLE1BQU0sRUFBRSxDQUFBO1FBQ25CLElBQUksQ0FBQyxpQkFBaUIsRUFBRSxDQUFBO0lBQzFCLENBQUM7SUFFRDs7Ozs7Ozs7T0FRRztJQUNILEtBQUssQ0FBQyxrQkFBa0I7UUFDdEIsSUFBSSxJQUFJLENBQUMsUUFBUTtZQUFFLE9BQU07UUFFekIsTUFBTSxNQUFNLEdBQUcsSUFBSSxDQUFDLEtBQUssQ0FBQyxHQUFHLEVBQUUsR0FBRyxJQUFJLENBQUMsb0JBQW9CLENBQUE7UUFDM0QsMkJBQTJCO1FBQzNCLE1BQU0sS0FBSyxHQUFHLEVBQUUsQ0FBQTtRQUVoQixLQUFLLE1BQU0sTUFBTSxJQUFJLElBQUksQ0FBQyxPQUFPLEVBQUUsQ0FBQztZQUNsQywyRUFBMkU7WUFDM0UsMEVBQTBFO1lBQzFFLHNFQUFzRTtZQUN0RSx1RUFBdUU7WUFDdkUsSUFBSSxDQUFDLE1BQU0sQ0FBQyxpQkFBaUI7Z0JBQUUsU0FBUTtZQUV2QyxNQUFNLFVBQVUsR0FBRyxPQUFPLE1BQU0sQ0FBQyxVQUFVLEtBQUssUUFBUSxDQUFDLENBQUMsQ0FBQyxNQUFNLENBQUMsVUFBVSxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUE7WUFFaEYsSUFBSSxVQUFVLElBQUksTUFBTTtnQkFBRSxLQUFLLENBQUMsSUFBSSxDQUFDLE1BQU0sQ0FBQyxDQUFBO1FBQzlDLENBQUM7UUFFRCxLQUFLLE1BQU0sTUFBTSxJQUFJLEtBQUssRUFBRSxDQUFDO1lBQzNCLElBQUksQ0FBQyxNQUFNLENBQUMsSUFBSSxDQUFDLEdBQUcsRUFBRSxDQUFDLENBQUMsdUNBQXVDLEVBQUUsRUFBQyxRQUFRLEVBQUUsTUFBTSxDQUFDLFFBQVEsRUFBRSxVQUFVLEVBQUUsTUFBTSxDQUFDLFVBQVUsRUFBQyxDQUFDLENBQUMsQ0FBQTtZQUU3SCxJQUFJLENBQUM7Z0JBQ0gsTUFBTSxDQUFDLEtBQUssRUFBRSxDQUFBO1lBQ2hCLENBQUM7WUFBQyxNQUFNLENBQUM7Z0JBQ1AsNERBQTREO1lBQzlELENBQUM7WUFFRCxNQUFNLElBQUksQ0FBQyx5QkFBeUIsQ0FBQyxNQUFNLENBQUMsQ0FBQTtRQUM5QyxDQUFDO0lBQ0gsQ0FBQztDQUNGIiwic291cmNlc0NvbnRlbnQiOlsiLy8gQHRzLWNoZWNrXG5cbmltcG9ydCB7IHJhbmRvbVVVSUQgfSBmcm9tIFwiY3J5cHRvXCJcbmltcG9ydCBuZXQgZnJvbSBcIm5ldFwiXG5pbXBvcnQgSnNvblNvY2tldCBmcm9tIFwiLi9qc29uLXNvY2tldC5qc1wiXG5pbXBvcnQgQmFja2dyb3VuZEpvYnNTY2hlZHVsZXIgZnJvbSBcIi4vc2NoZWR1bGVyLmpzXCJcbmltcG9ydCBMb2dnZXIgZnJvbSBcIi4uL2xvZ2dlci5qc1wiXG5pbXBvcnQgUHJ1bmVUZXJtaW5hbEJhY2tncm91bmRKb2JzSm9iIGZyb20gXCIuLi9qb2JzL3BydW5lLXRlcm1pbmFsLWJhY2tncm91bmQtam9icy5qc1wiXG5pbXBvcnQgVmVsb2Npb3VzRXJyb3IgZnJvbSBcIi4uL3ZlbG9jaW91cy1lcnJvci5qc1wiXG5pbXBvcnQgc2h1dGRvd25MaWZlY3ljbGUsIHsgcnVuU2h1dGRvd25TdGVwcyB9IGZyb20gXCIuLi91dGlscy9zaHV0ZG93bi1saWZlY3ljbGUuanNcIlxuaW1wb3J0IHsgdmFsaWRhdGVHZW5lcmF0aW9uSWQsIHdvcmtlcklkQmVsb25nc1RvR2VuZXJhdGlvbiB9IGZyb20gXCIuL2dlbmVyYXRpb24taWRlbnRpdHkuanNcIlxuaW1wb3J0IEJhY2tncm91bmRKb2JzTGlmZWN5Y2xlQ29udHJvbFNlcnZlciBmcm9tIFwiLi9saWZlY3ljbGUtY29udHJvbC1zZXJ2ZXIuanNcIlxuXG4vKipcbiAqIFdvcmtlckV4ZWN1dGlvbk1vZGVDYXBhYmlsaXR5IHR5cGUuXG4gKiBAdHlwZWRlZiB7b2JqZWN0fSBXb3JrZXJFeGVjdXRpb25Nb2RlQ2FwYWJpbGl0eVxuICogQHByb3BlcnR5IHtpbXBvcnQoXCIuL3R5cGVzLmpzXCIpLkJhY2tncm91bmRKb2JFeGVjdXRpb25Nb2RlfSBleGVjdXRpb25Nb2RlIC0gRXhlY3V0aW9uIG1vZGUuXG4gKiBAcHJvcGVydHkgeyh3b3JrZXI6IEpzb25Tb2NrZXQpID0+IGJvb2xlYW59IGFjY2VwdHMgLSBXaGV0aGVyIHRoZSB3b3JrZXIgYWNjZXB0cyB0aGlzIG1vZGUuXG4gKi9cbi8qKlxuICogQ2hhbm5lbCB1c2VkIGJ5IGBiYWNrZ3JvdW5kLWpvYnMtbWFpbmAgdG8gY29vcmRpbmF0ZSBkaXNwYXRjaCB3YWtlLXVwc1xuICogYWNyb3NzIHByb2Nlc3NlcyB2aWEgQmVhY29uLiBXb3JrZXJzIGRvIE5PVCBzdWJzY3JpYmUgdG8gdGhpcyBjaGFubmVsXG4gKiDigJQgdGhleSBhbHJlYWR5IHJlY2VpdmUgam9iLWhhbmRvZmYgbWVzc2FnZXMgb24gdGhlaXIgSnNvblNvY2tldCB0b1xuICogbWFpbjsgdGhpcyBjaGFubmVsIGV4aXN0cyBzbyBjcm9zcy1wcm9jZXNzIGVucXVldWVzIChvciBmdXR1cmVcbiAqIG11bHRpLW1haW4gZGVwbG95bWVudHMpIGNhbiBwb2tlIGFuIGlkbGUgbWFpbiB0byBkcmFpbi5cbiAqL1xuY29uc3QgRElTUEFUQ0hfQ0hBTk5FTCA9IFwidmVsb2Npb3VzLWJhY2tncm91bmQtam9icy1kaXNwYXRjaFwiXG5cbi8qKlxuICogYHNldFRpbWVvdXRgIGlzIGltcGxlbWVudGVkIHdpdGggMzItYml0IHNpZ25lZCBkZWxheXMgb24gTm9kZTsgcGFzc2luZ1xuICogYW55dGhpbmcgbGFyZ2VyIHNpbGVudGx5IGNsYW1wcyB0byAxbXMgYW5kIGZpcmVzIGltbWVkaWF0ZWx5LiBDYXAgdGhlXG4gKiBzY2hlZHVsZWQtam9iIHRpbWVyIGhlcmUgYW5kIHJlLWFybSB3aGVuIGl0IGV4cGlyZXMuXG4gKi9cbmNvbnN0IE1BWF9USU1FUl9NUyA9IDJfMTQ3XzQ4M182NDcgLy8gfjI0LjggZGF5c1xuLyoqIEEgd29ya2VyIHNpbGVudCAobm8gaGVhcnRiZWF0L3JlYWR5L3JlcG9ydCkgbG9uZ2VyIHRoYW4gdGhpcyBpcyBkcm9wcGVkLiAqL1xuY29uc3QgV09SS0VSX1NUQUxFX1RJTUVPVVRfTVMgPSA2MDAwMFxuLyoqIEhvdyBvZnRlbiB0aGUgbWFpbiBzY2FucyB3b3JrZXJzIGZvciBzdGFsZW5lc3MuICovXG5jb25zdCBXT1JLRVJfTElWRU5FU1NfU1dFRVBfTVMgPSAxNTAwMFxuLyoqIEdyYWNlIGZvciB3b3JrZXJzIGZyb20gdGhlIHByZXZpb3VzIG1haW4gZ2VuZXJhdGlvbiB0byByZWNvbm5lY3QgYW5kIGFkb3B0IGxlYXNlcy4gKi9cbmNvbnN0IFdPUktFUl9SRUNPTk5FQ1RfR1JBQ0VfTVMgPSAzMDAwMFxuY29uc3QgR0VORVJBVElPTl9PUlBIQU5FRF9BRlRFUl9NUyA9IDYwICogNjAgKiAxMDAwXG5jb25zdCBXT1JLRVJfUkVDT05ORUNUX0dSQUNFX1ZBTElEQVRJT05fTUVTU0FHRSA9IGB3b3JrZXJSZWNvbm5lY3RHcmFjZU1zIG11c3QgYmUgYW4gaW50ZWdlciBiZXR3ZWVuIDAgYW5kICR7TUFYX1RJTUVSX01TfWBcblxuLyoqXG4gKiBSZXNvbHZlcyBhIHN0YXJ0dXAgcmVjb25uZWN0IGdyYWNlIHdpdGhvdXQgYWxsb3dpbmcgTm9kZSdzIHRpbWVyIG92ZXJmbG93IHRvXG4gKiB0dXJuIGFuIGludGVudGlvbmFsbHkgbG9uZyBncmFjZSBpbnRvIGFuIGltbWVkaWF0ZSByZWNsYWltLlxuICogQHBhcmFtIHtudW1iZXIgfCB1bmRlZmluZWR9IHdvcmtlclJlY29ubmVjdEdyYWNlTXMgLSBSZXF1ZXN0ZWQgcmVjb25uZWN0IGdyYWNlLlxuICogQHJldHVybnMge251bWJlcn0gLSBWYWxpZCB0aW1lciBkZWxheS5cbiAqL1xuZnVuY3Rpb24gbm9ybWFsaXplV29ya2VyUmVjb25uZWN0R3JhY2VNcyh3b3JrZXJSZWNvbm5lY3RHcmFjZU1zKSB7XG4gIGlmICh3b3JrZXJSZWNvbm5lY3RHcmFjZU1zID09PSB1bmRlZmluZWQpIHJldHVybiBXT1JLRVJfUkVDT05ORUNUX0dSQUNFX01TXG4gIGlmICghTnVtYmVyLmlzSW50ZWdlcih3b3JrZXJSZWNvbm5lY3RHcmFjZU1zKSB8fCB3b3JrZXJSZWNvbm5lY3RHcmFjZU1zIDwgMCB8fCB3b3JrZXJSZWNvbm5lY3RHcmFjZU1zID4gTUFYX1RJTUVSX01TKSB7XG4gICAgdGhyb3cgbmV3IFR5cGVFcnJvcihXT1JLRVJfUkVDT05ORUNUX0dSQUNFX1ZBTElEQVRJT05fTUVTU0FHRSlcbiAgfVxuXG4gIHJldHVybiB3b3JrZXJSZWNvbm5lY3RHcmFjZU1zXG59XG4vKipcbiAqIFdvcmtlciBleGVjdXRpb24gbW9kZSBjYXBhYmlsaXRpZXMuXG4gKiBAdHlwZSB7V29ya2VyRXhlY3V0aW9uTW9kZUNhcGFiaWxpdHlbXX0gKi9cbmNvbnN0IFdPUktFUl9FWEVDVVRJT05fTU9ERV9DQVBBQklMSVRJRVMgPSBbXG4gIHtleGVjdXRpb25Nb2RlOiBcImlubGluZVwiLCBhY2NlcHRzOiAod29ya2VyKSA9PiB3b3JrZXIuYWNjZXB0c0lubGluZUpvYnMgIT09IGZhbHNlfSxcbiAge2V4ZWN1dGlvbk1vZGU6IFwiZm9ya2VkXCIsIGFjY2VwdHM6ICh3b3JrZXIpID0+IHdvcmtlci5hY2NlcHRzRm9ya2VkSm9icyAhPT0gZmFsc2V9LFxuICAvLyBQb29sZWQgaXMgb3B0LWluOiBvbmx5IHdvcmtlcnMgdGhhdCBleHBsaWNpdGx5IGFkdmVydGlzZSBgYWNjZXB0c1Bvb2xlZGBcbiAgLy8gcmVjZWl2ZSBwb29sZWQgam9icy4gVGhlIGA9PT0gdHJ1ZWAgKHJhdGhlciB0aGFuIGAhPT0gZmFsc2VgKSBjaGVjayBrZWVwcyBhXG4gIC8vIHByZS1wb29sZWQgd29ya2VyIOKAlCB3aGljaCBuZXZlciBzZW5kcyB0aGUgZmllbGQg4oCUIG91dCBvZiB0aGUgcG9vbGVkLWNhcGFibGVcbiAgLy8gc2V0LCBzbyB0aGUgbWFpbiBuZXZlciBkaXNwYXRjaGVzIGEgcG9vbGVkIGpvYiB0byBhIHdvcmtlciB0aGF0IGNhbm5vdCBydW5cbiAgLy8gb25lLiBUaGlzIGlzIHRoZSBjb25zZXJ2YXRpdmUgaGFsZiBvZiB0aGUgZXh0ZW5kZWQgcmVhZGluZXNzIHByb3RvY29sLlxuICB7ZXhlY3V0aW9uTW9kZTogXCJwb29sZWRcIiwgYWNjZXB0czogKHdvcmtlcikgPT4gd29ya2VyLmFjY2VwdHNQb29sZWRKb2JzID09PSB0cnVlICYmICghd29ya2VyLnVzZXNQb29sZWRDYXBhY2l0eUNyZWRpdHMgfHwgd29ya2VyLmF2YWlsYWJsZVBvb2xlZFNsb3RzID4gMCl9LFxuICB7ZXhlY3V0aW9uTW9kZTogXCJzcGF3bmVkXCIsIGFjY2VwdHM6ICh3b3JrZXIpID0+IHdvcmtlci5hY2NlcHRzU3Bhd25lZEpvYnMgIT09IGZhbHNlfVxuXVxuY29uc3QgV09SS0VSX0VYRUNVVElPTl9NT0RFX0NBUEFCSUxJVElFU19CWV9NT0RFID0gbmV3IE1hcChcbiAgV09SS0VSX0VYRUNVVElPTl9NT0RFX0NBUEFCSUxJVElFUy5tYXAoKGNhcGFiaWxpdHkpID0+IFtjYXBhYmlsaXR5LmV4ZWN1dGlvbk1vZGUsIGNhcGFiaWxpdHldKVxuKVxuXG5leHBvcnQgZGVmYXVsdCBjbGFzcyBCYWNrZ3JvdW5kSm9ic01haW4ge1xuICAvKipcbiAgICogUnVucyBjb25zdHJ1Y3Rvci5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBPcHRpb25zLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL2NvbmZpZ3VyYXRpb24uanNcIikuZGVmYXVsdH0gYXJncy5jb25maWd1cmF0aW9uIC0gQ29uZmlndXJhdGlvbi5cbiAgICogQHBhcmFtIHtzdHJpbmd9IFthcmdzLmhvc3RdIC0gSG9zdG5hbWUuXG4gICAqIEBwYXJhbSB7bnVtYmVyfSBbYXJncy5wb3J0XSAtIFBvcnQuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBbYXJncy5nZW5lcmF0aW9uSWRdIC0gRXhwbGljaXQgcmVsZWFzZSBnZW5lcmF0aW9uIGlkZW50aXR5LlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vdHlwZXMuanNcIikuQmFja2dyb3VuZEpvYnNHZW5lcmF0aW9uSW5pdGlhbFN0YXRlfSBbYXJncy5pbml0aWFsR2VuZXJhdGlvblN0YXRlXSAtIEV4cGxpY2l0IGdlbmVyYXRpb24gYm9vdCBzdGF0ZS5cbiAgICogQHBhcmFtIHtzdHJpbmd9IFthcmdzLmxpZmVjeWNsZVNvY2tldFBhdGhdIC0gRXhwbGljaXQgbGlmZWN5Y2xlIHNvY2tldCBwYXRoLlxuICAgKiBAcGFyYW0ge251bWJlcn0gW2FyZ3Mud29ya2VyU3RhbGVUaW1lb3V0TXNdIC0gT3ZlcnJpZGUgaG93IGxvbmcgYSBzaWxlbnQgd29ya2VyIG1heSBnbyBiZWZvcmUgYmVpbmcgZHJvcHBlZCAoZGVmYXVsdCA2MDAwMG1zKS5cbiAgICogQHBhcmFtIHtudW1iZXJ9IFthcmdzLndvcmtlckxpdmVuZXNzU3dlZXBNc10gLSBPdmVycmlkZSBob3cgb2Z0ZW4gc3RhbGUgd29ya2VycyBhcmUgc3dlcHQgZm9yIChkZWZhdWx0IDE1MDAwbXMpLlxuICAgKiBAcGFyYW0ge251bWJlcn0gW2FyZ3Mud29ya2VyUmVjb25uZWN0R3JhY2VNc10gLSBJbnRlZ2VyIGZyb20gMCB0aHJvdWdoIDIsMTQ3LDQ4Myw2NDcgb3ZlcnJpZGluZyBob3cgbG9uZyBwcmV2aW91cy1nZW5lcmF0aW9uIHdvcmtlcnMgbWF5IHJlY29ubmVjdCBiZWZvcmUgZXhhY3Qgc3RhcnR1cCBsZWFzZXMgYXJlIHJlY2xhaW1lZCAoZGVmYXVsdCAzMDAwMG1zKS5cbiAgICogQHBhcmFtIHtib29sZWFufSBbYXJncy5jbG9zZURhdGFiYXNlQ29ubmVjdGlvbnNPblN0b3BdIC0gV2hldGhlciBzdG9wIG93bnMgY2xvc2luZyB0aGUgY29uZmlndXJhdGlvbidzIGRhdGFiYXNlIHBvb2xzIChkZWZhdWx0IHRydWUpLlxuICAgKiBAcGFyYW0geygpID0+IHZvaWQgfCBQcm9taXNlPHZvaWQ+fSBbYXJncy5vblN0b3BwZWRdIC0gTGlmZWN5Y2xlIGhvb2sgaW52b2tlZCBhZnRlciB0aGUgbWFpbiBwcm9jZXNzIGZpbmlzaGVzIHN0b3BwaW5nLlxuICAgKiBAcGFyYW0geyhhcmdzOiB7aGFuZG9mZjogaW1wb3J0KFwiLi90eXBlcy5qc1wiKS5CYWNrZ3JvdW5kSm9iSGFuZG9mZiwgam9iOiBpbXBvcnQoXCIuL3R5cGVzLmpzXCIpLkJhY2tncm91bmRKb2JSb3d9KSA9PiB2b2lkIHwgUHJvbWlzZTx2b2lkPn0gW2FyZ3MuYWZ0ZXJIYW5kb2ZmQ2xhaW1dIC0gRXhwbGljaXQgaGFuZG9mZi1jbGFpbSBvYnNlcnZhdGlvbiBob29rLlxuICAgKiBAcGFyYW0geyh3b3JrZXI6IEpzb25Tb2NrZXQpID0+IHZvaWR9IFthcmdzLm9uV29ya2VyUmVhZHldIC0gRXhwbGljaXQgcmVhZGluZXNzIG9ic2VydmF0aW9uIGhvb2suXG4gICAqIEBwYXJhbSB7KHdvcmtlcjogSnNvblNvY2tldCkgPT4gdm9pZH0gW2FyZ3Mub25Xb3JrZXJIZWFydGJlYXRdIC0gRXhwbGljaXQgaGVhcnRiZWF0IG9ic2VydmF0aW9uIGhvb2suXG4gICAqIEBwYXJhbSB7KHdvcmtlcklkOiBzdHJpbmcpID0+IHZvaWR9IFthcmdzLm9uV29ya2VyRGlzY29ubmVjdGVkXSAtIEV4cGxpY2l0IGdlbmVyYXRpb24gZGlzY29ubmVjdCBvYnNlcnZhdGlvbiBob29rLlxuICAgKiBAcGFyYW0geyh3b3JrZXJJZDogc3RyaW5nKSA9PiB2b2lkfSBbYXJncy5vbldvcmtlckhhbmRvZmZzUmVsZWFzZWRdIC0gRXhwbGljaXQgZ3JhY2UtZXhwaXJ5IG9ic2VydmF0aW9uIGhvb2suXG4gICAqIEBwYXJhbSB7KGpvYnM6IGltcG9ydChcIi4vdHlwZXMuanNcIikuQmFja2dyb3VuZEpvYlJvd1tdKSA9PiB2b2lkfSBbYXJncy5vblN0YXJ0dXBIYW5kb2Zmc1JlY2xhaW1lZF0gLSBFeHBsaWNpdCBzdGFydHVwIHJlY2xhaW0gb2JzZXJ2YXRpb24gaG9vay5cbiAgICogQHBhcmFtIHsoYXJnczoge2FjY2VwdGVkOiBib29sZWFuLCBqb2JJZDogc3RyaW5nLCBzdGF0dXM6IFwiY29tcGxldGVkXCIgfCBcImZhaWxlZFwiIHwgXCJyZXNjaGVkdWxlZFwifSkgPT4gdm9pZH0gW2FyZ3Mub25Kb2JVcGRhdGVkXSAtIEV4cGxpY2l0IGR1cmFibGUgcmVwb3J0IG9ic2VydmF0aW9uIGhvb2suXG4gICAqIEBwYXJhbSB7e25vdzogKCkgPT4gbnVtYmVyLCBzZXRUaW1lb3V0PzogKGNhbGxiYWNrOiAoKSA9PiB2b2lkLCBkZWxheU1zOiBudW1iZXIpID0+IFJldHVyblR5cGU8dHlwZW9mIHNldFRpbWVvdXQ+IHwgbnVtYmVyLCBjbGVhclRpbWVvdXQ/OiAodGltZXJJZDogUmV0dXJuVHlwZTx0eXBlb2Ygc2V0VGltZW91dD4gfCBudW1iZXIpID0+IHZvaWR9fSBbYXJncy5jbG9ja10gLSBJbmplY3RhYmxlIHdhbGwgY2xvY2sgZm9yIGRldGVybWluaXN0aWMgbGlmZWN5Y2xlIHRlc3RzLlxuICAgKi9cbiAgY29uc3RydWN0b3Ioe2NvbmZpZ3VyYXRpb24sIGhvc3QsIHBvcnQsIGdlbmVyYXRpb25JZDogZXhwbGljaXRHZW5lcmF0aW9uSWQsIGluaXRpYWxHZW5lcmF0aW9uU3RhdGU6IGV4cGxpY2l0SW5pdGlhbEdlbmVyYXRpb25TdGF0ZSwgbGlmZWN5Y2xlU29ja2V0UGF0aDogZXhwbGljaXRMaWZlY3ljbGVTb2NrZXRQYXRoLCB3b3JrZXJTdGFsZVRpbWVvdXRNcywgd29ya2VyTGl2ZW5lc3NTd2VlcE1zLCB3b3JrZXJSZWNvbm5lY3RHcmFjZU1zLCBjbG9zZURhdGFiYXNlQ29ubmVjdGlvbnNPblN0b3AgPSB0cnVlLCBvblN0b3BwZWQsIGFmdGVySGFuZG9mZkNsYWltLCBvbldvcmtlclJlYWR5LCBvbldvcmtlckhlYXJ0YmVhdCwgb25Xb3JrZXJEaXNjb25uZWN0ZWQsIG9uV29ya2VySGFuZG9mZnNSZWxlYXNlZCwgb25TdGFydHVwSGFuZG9mZnNSZWNsYWltZWQsIG9uSm9iVXBkYXRlZCwgY2xvY2t9KSB7XG4gICAgdGhpcy5jb25maWd1cmF0aW9uID0gY29uZmlndXJhdGlvblxuICAgIHRoaXMuY2xvc2VEYXRhYmFzZUNvbm5lY3Rpb25zT25TdG9wID0gY2xvc2VEYXRhYmFzZUNvbm5lY3Rpb25zT25TdG9wXG4gICAgdGhpcy5vblN0b3BwZWQgPSBvblN0b3BwZWRcbiAgICB0aGlzLmFmdGVySGFuZG9mZkNsYWltID0gYWZ0ZXJIYW5kb2ZmQ2xhaW1cbiAgICB0aGlzLm9uV29ya2VyUmVhZHkgPSBvbldvcmtlclJlYWR5XG4gICAgdGhpcy5vbldvcmtlckhlYXJ0YmVhdCA9IG9uV29ya2VySGVhcnRiZWF0XG4gICAgdGhpcy5vbldvcmtlckRpc2Nvbm5lY3RlZCA9IG9uV29ya2VyRGlzY29ubmVjdGVkXG4gICAgdGhpcy5vbldvcmtlckhhbmRvZmZzUmVsZWFzZWQgPSBvbldvcmtlckhhbmRvZmZzUmVsZWFzZWRcbiAgICB0aGlzLm9uU3RhcnR1cEhhbmRvZmZzUmVjbGFpbWVkID0gb25TdGFydHVwSGFuZG9mZnNSZWNsYWltZWRcbiAgICB0aGlzLm9uSm9iVXBkYXRlZCA9IG9uSm9iVXBkYXRlZFxuICAgIHRoaXMuY2xvY2sgPSB7XG4gICAgICBjbGVhclRpbWVvdXQ6IGNsb2NrPy5jbGVhclRpbWVvdXQgfHwgKCh0aW1lcklkKSA9PiBjbGVhclRpbWVvdXQodGltZXJJZCkpLFxuICAgICAgbm93OiBjbG9jaz8ubm93IHx8ICgoKSA9PiBEYXRlLm5vdygpKSxcbiAgICAgIHNldFRpbWVvdXQ6IGNsb2NrPy5zZXRUaW1lb3V0IHx8ICgoY2FsbGJhY2ssIGRlbGF5TXMpID0+IHNldFRpbWVvdXQoY2FsbGJhY2ssIGRlbGF5TXMpKVxuICAgIH1cbiAgICBjb25zdCBjb25maWcgPSBjb25maWd1cmF0aW9uLmdldEJhY2tncm91bmRKb2JzQ29uZmlnKClcbiAgICBjb25zdCBnZW5lcmF0aW9uQ29uZmlnID0gY29uZmlndXJhdGlvbi5yZXNvbHZlQmFja2dyb3VuZEpvYnNHZW5lcmF0aW9uQ29uZmlnKHtcbiAgICAgIGdlbmVyYXRpb25JZDogZXhwbGljaXRHZW5lcmF0aW9uSWQsXG4gICAgICBpbml0aWFsR2VuZXJhdGlvblN0YXRlOiBleHBsaWNpdEluaXRpYWxHZW5lcmF0aW9uU3RhdGUsXG4gICAgICBsaWZlY3ljbGVTb2NrZXRQYXRoOiBleHBsaWNpdExpZmVjeWNsZVNvY2tldFBhdGgsXG4gICAgICBzb3VyY2VOYW1lOiBcIkJhY2tncm91bmRKb2JzTWFpblwiXG4gICAgfSlcbiAgICB0aGlzLmdlbmVyYXRpb25JZCA9IGdlbmVyYXRpb25Db25maWcuZ2VuZXJhdGlvbklkXG4gICAgdGhpcy5pbml0aWFsR2VuZXJhdGlvblN0YXRlID0gZ2VuZXJhdGlvbkNvbmZpZy5pbml0aWFsR2VuZXJhdGlvblN0YXRlXG4gICAgdGhpcy5saWZlY3ljbGVTb2NrZXRQYXRoID0gZ2VuZXJhdGlvbkNvbmZpZy5saWZlY3ljbGVTb2NrZXRQYXRoXG4gICAgLyoqIEB0eXBlIHtpbXBvcnQoXCIuL3R5cGVzLmpzXCIpLkJhY2tncm91bmRKb2JzR2VuZXJhdGlvbkxpZmVjeWNsZVN0YXRlfSAqL1xuICAgIHRoaXMubGlmZWN5Y2xlU3RhdGUgPSBcInN0YXJ0aW5nXCJcbiAgICB0aGlzLl9hY3RpdmVPd25lcnNoaXBSZWFkeSA9IGZhbHNlXG4gICAgLyoqIEB0eXBlIHtQcm9taXNlPHZvaWQ+IHwgdW5kZWZpbmVkfSAqL1xuICAgIHRoaXMuX2FjdGl2YXRpb25Qcm9taXNlID0gdW5kZWZpbmVkXG4gICAgLyoqIEB0eXBlIHtQcm9taXNlPHZvaWQ+IHwgdW5kZWZpbmVkfSAqL1xuICAgIHRoaXMuX3JldGlyZW1lbnRQcm9taXNlID0gdW5kZWZpbmVkXG4gICAgLyoqIEB0eXBlIHtTZXQ8SnNvblNvY2tldD59ICovXG4gICAgdGhpcy5jYW5kaWRhdGVSZWFkeVdvcmtlcnMgPSBuZXcgU2V0KClcbiAgICAvKiogQHR5cGUge01hcDxzdHJpbmcsIHt3b3JrZXI6IEpzb25Tb2NrZXQsIHRpbWVyOiBSZXR1cm5UeXBlPHR5cGVvZiBzZXRUaW1lb3V0PiB8IG51bWJlcn0+fSAqL1xuICAgIHRoaXMuZGlzY29ubmVjdGVkV29ya2VycyA9IG5ldyBNYXAoKVxuICAgIHRoaXMuX2xpZmVjeWNsZVJlcXVlc3RMZWFzZXMgPSAwXG4gICAgdGhpcy5fYWN0aXZlTm9uV29ya2VyUmVxdWVzdHMgPSAwXG4gICAgLyoqXG4gICAgICogUmVzb2x2ZXMgc3RvcCBvYnNlcnZhdGlvbi5cbiAgICAgKiBAdHlwZSB7KCkgPT4gdm9pZH1cbiAgICAgKi9cbiAgICB0aGlzLl9yZXNvbHZlU3RvcHBlZCA9ICgpID0+IHt9XG4gICAgdGhpcy5fc3RvcHBlZFByb21pc2UgPSBuZXcgUHJvbWlzZSgoLyoqIEB0eXBlIHsodmFsdWU6IHZvaWQpID0+IHZvaWR9ICovIHJlc29sdmUpID0+IHsgdGhpcy5fcmVzb2x2ZVN0b3BwZWQgPSByZXNvbHZlIH0pXG4gICAgdGhpcy5ob3N0ID0gaG9zdCB8fCBjb25maWcuaG9zdFxuICAgIHRoaXMucG9ydCA9IHR5cGVvZiBwb3J0ID09PSBcIm51bWJlclwiID8gcG9ydCA6IGNvbmZpZy5wb3J0XG4gICAgdGhpcy5kaXNwYXRjaFN0cmF0ZWd5ID0gY29uZmlnLmRpc3BhdGNoU3RyYXRlZ3lcbiAgICB0aGlzLnBvbGxJbnRlcnZhbE1zID0gY29uZmlnLnBvbGxJbnRlcnZhbE1zXG4gICAgdGhpcy5yZXRlbnRpb24gPSBjb25maWcucmV0ZW50aW9uXG4gICAgLy8gQSB3b3JrZXIgdGhhdCBzdG9wcyBzZW5kaW5nIGFueXRoaW5nIChoZWFydGJlYXQvcmVhZHkvcmVwb3J0KSBmb3IgdGhpc1xuICAgIC8vIGxvbmcgaXMgdHJlYXRlZCBhcyB3ZWRnZWQvZGVhZDogaXRzIGxlYXNlcyBhcmUgcmVsZWFzZWQgYW5kIGl0IGlzIGRyb3BwZWQuXG4gICAgdGhpcy53b3JrZXJTdGFsZVRpbWVvdXRNcyA9IHR5cGVvZiB3b3JrZXJTdGFsZVRpbWVvdXRNcyA9PT0gXCJudW1iZXJcIiAmJiB3b3JrZXJTdGFsZVRpbWVvdXRNcyA+PSAxID8gd29ya2VyU3RhbGVUaW1lb3V0TXMgOiBXT1JLRVJfU1RBTEVfVElNRU9VVF9NU1xuICAgIHRoaXMud29ya2VyTGl2ZW5lc3NTd2VlcE1zID0gdHlwZW9mIHdvcmtlckxpdmVuZXNzU3dlZXBNcyA9PT0gXCJudW1iZXJcIiAmJiB3b3JrZXJMaXZlbmVzc1N3ZWVwTXMgPj0gMSA/IHdvcmtlckxpdmVuZXNzU3dlZXBNcyA6IFdPUktFUl9MSVZFTkVTU19TV0VFUF9NU1xuICAgIHRoaXMud29ya2VyUmVjb25uZWN0R3JhY2VNcyA9IG5vcm1hbGl6ZVdvcmtlclJlY29ubmVjdEdyYWNlTXMod29ya2VyUmVjb25uZWN0R3JhY2VNcylcbiAgICAvKiogQHR5cGUge2ltcG9ydChcIi4vYWRhcHRlci5qc1wiKS5kZWZhdWx0IHwgdW5kZWZpbmVkfSAqL1xuICAgIHRoaXMuYWRhcHRlciA9IHVuZGVmaW5lZFxuICAgIHRoaXMubG9nZ2VyID0gbmV3IExvZ2dlcih0aGlzKVxuICAgIC8qKlxuICAgICAqIE5hcnJvd3MgdGhlIHJ1bnRpbWUgdmFsdWUgdG8gdGhlIGRvY3VtZW50ZWQgdHlwZS5cbiAgICAgKiBAdHlwZSB7U2V0PEpzb25Tb2NrZXQ+fSAqL1xuICAgIHRoaXMud29ya2VycyA9IG5ldyBTZXQoKVxuICAgIC8qKiBAdHlwZSB7U2V0PEpzb25Tb2NrZXQ+fSAqL1xuICAgIHRoaXMuY29ubmVjdGlvbnMgPSBuZXcgU2V0KClcbiAgICAvKipcbiAgICAgKiBOYXJyb3dzIHRoZSBydW50aW1lIHZhbHVlIHRvIHRoZSBkb2N1bWVudGVkIHR5cGUuXG4gICAgICogQHR5cGUge1NldDxKc29uU29ja2V0Pn0gKi9cbiAgICB0aGlzLnJlYWR5V29ya2VycyA9IG5ldyBTZXQoKVxuICAgIC8qKlxuICAgICAqIEFjdGl2ZSBkdXJhYmxlIGhhbmRvZmZzIGtleWVkIGJ5IHRoZSBleGFjdCB3b3JrZXIgc29ja2V0IHRoYXQgcmVjZWl2ZWQgdGhlbS5cbiAgICAgKiBAdHlwZSB7TWFwPEpzb25Tb2NrZXQsIE1hcDxzdHJpbmcsIHN0cmluZz4+fSAqL1xuICAgIHRoaXMud29ya2VySGFuZG9mZnMgPSBuZXcgTWFwKClcbiAgICAvKipcbiAgICAgKiBFeGFjdCBjYWxsZXItZ2VuZXJhdGVkIGxlYXNlcyB3aG9zZSBjbGFpbSBvdXRjb21lIHdhcyBhbWJpZ3VvdXMgb3Igd2hvc2VcbiAgICAgKiBwcmUtZGlzcGF0Y2ggcmVsZWFzZSBoYXMgbm90IHlldCBiZWVuIGFja25vd2xlZGdlZC4gUmV0YWluZWQgdW50aWwgYVxuICAgICAqIGZlbmNlZCByZXR1cm4gc3VjY2VlZHMgKGluY2x1ZGluZyBhbiBleGFjdCBuby1vcCkuXG4gICAgICogQHR5cGUge01hcDxzdHJpbmcsIHN0cmluZz59ICovXG4gICAgdGhpcy5wZW5kaW5nSGFuZG9mZlJlY292ZXJpZXMgPSBuZXcgTWFwKClcbiAgICAvKipcbiAgICAgKiBIYW5kb2ZmLWFkb3B0aW9uIHF1ZXJpZXMgc3RhcnRlZCBieSB3b3JrZXIgaGVsbG8gbWVzc2FnZXMuIFNodXRkb3duIG11c3RcbiAgICAgKiB3YWl0IGZvciB0aGVzZSBiZWZvcmUgY2xvc2luZyB0aGUgY29uZmlndXJhdGlvbidzIGRhdGFiYXNlIHBvb2xzLlxuICAgICAqIEB0eXBlIHtTZXQ8UHJvbWlzZTx2b2lkPj59ICovXG4gICAgdGhpcy5pbmZsaWdodFdvcmtlckhhbmRvZmZBZG9wdGlvbnMgPSBuZXcgU2V0KClcbiAgICAvKipcbiAgICAgKiBXb3JrZXIgaWRzIHdob3NlIGhhbmRvZmZzIHdlcmUgc3VjY2Vzc2Z1bGx5IGFkb3B0ZWQgYnkgYSBzdGlsbC1saXZlXG4gICAgICogY29ubmVjdGlvbiBpbiB0aGlzIG1haW4gZ2VuZXJhdGlvbi5cbiAgICAgKiBAdHlwZSB7U2V0PHN0cmluZz59XG4gICAgICovXG4gICAgdGhpcy5yZWNvbm5lY3RlZFdvcmtlcklkcyA9IG5ldyBTZXQoKVxuICAgIC8qKiBAdHlwZSB7aW1wb3J0KFwiLi90eXBlcy5qc1wiKS5CYWNrZ3JvdW5kSm9iSGFuZG9mZlNuYXBzaG90W119ICovXG4gICAgdGhpcy5zdGFydHVwSGFuZG9mZlNuYXBzaG90ID0gW11cbiAgICAvKiogQHR5cGUge1Byb21pc2U8dm9pZD5bXX0gKi9cbiAgICB0aGlzLl9zdGFydHVwSGFuZG9mZkFkb3B0aW9uc0F0RGVhZGxpbmUgPSBbXVxuICAgIHRoaXMuX3N0YXJ0dXBIYW5kb2ZmR3JhY2VFbGFwc2VkID0gZmFsc2VcbiAgICAvKipcbiAgICAgKiBOYXJyb3dzIHRoZSBydW50aW1lIHZhbHVlIHRvIHRoZSBkb2N1bWVudGVkIHR5cGUuXG4gICAgICogQHR5cGUge25ldC5TZXJ2ZXIgfCB1bmRlZmluZWR9ICovXG4gICAgdGhpcy5zZXJ2ZXIgPSB1bmRlZmluZWRcbiAgICAvKipcbiAgICAgKiBOYXJyb3dzIHRoZSBydW50aW1lIHZhbHVlIHRvIHRoZSBkb2N1bWVudGVkIHR5cGUuXG4gICAgICogQHR5cGUge1JldHVyblR5cGU8dHlwZW9mIHNldFRpbWVvdXQ+IHwgdW5kZWZpbmVkfSAqL1xuICAgIHRoaXMuX3BvbGxUaW1lciA9IHVuZGVmaW5lZFxuICAgIC8qKlxuICAgICAqIE5hcnJvd3MgdGhlIHJ1bnRpbWUgdmFsdWUgdG8gdGhlIGRvY3VtZW50ZWQgdHlwZS5cbiAgICAgKiBAdHlwZSB7UmV0dXJuVHlwZTx0eXBlb2Ygc2V0VGltZW91dD4gfCB1bmRlZmluZWR9ICovXG4gICAgdGhpcy5fc2NoZWR1bGVkVGltZXIgPSB1bmRlZmluZWRcbiAgICAvKipcbiAgICAgKiBOYXJyb3dzIHRoZSBydW50aW1lIHZhbHVlIHRvIHRoZSBkb2N1bWVudGVkIHR5cGUuXG4gICAgICogQHR5cGUge1JldHVyblR5cGU8dHlwZW9mIHNldFRpbWVvdXQ+IHwgdW5kZWZpbmVkfSAqL1xuICAgIHRoaXMuX2Vycm9yUmV0cnlUaW1lciA9IHVuZGVmaW5lZFxuICAgIC8qKlxuICAgICAqIE5hcnJvd3MgdGhlIHJ1bnRpbWUgdmFsdWUgdG8gdGhlIGRvY3VtZW50ZWQgdHlwZS5cbiAgICAgKiBAdHlwZSB7UmV0dXJuVHlwZTx0eXBlb2Ygc2V0VGltZW91dD4gfCB1bmRlZmluZWR9ICovXG4gICAgdGhpcy5fb3JwaGFuVGltZXIgPSB1bmRlZmluZWRcbiAgICAvKipcbiAgICAgKiBOYXJyb3dzIHRoZSBydW50aW1lIHZhbHVlIHRvIHRoZSBkb2N1bWVudGVkIHR5cGUuXG4gICAgICogQHR5cGUge1JldHVyblR5cGU8dHlwZW9mIHNldEludGVydmFsPiB8IHVuZGVmaW5lZH0gKi9cbiAgICB0aGlzLl93b3JrZXJTdGFsZVRpbWVyID0gdW5kZWZpbmVkXG4gICAgLyoqIEB0eXBlIHtSZXR1cm5UeXBlPHR5cGVvZiBzZXRUaW1lb3V0PiB8IG51bWJlciB8IHVuZGVmaW5lZH0gKi9cbiAgICB0aGlzLl9zdGFydHVwSGFuZG9mZlJlY2xhaW1UaW1lciA9IHVuZGVmaW5lZFxuICAgIC8qKiBAdHlwZSB7UHJvbWlzZTx2b2lkPiB8IHVuZGVmaW5lZH0gKi9cbiAgICB0aGlzLl9zdGFydHVwSGFuZG9mZlJlY2xhaW1Qcm9taXNlID0gdW5kZWZpbmVkXG4gICAgLyoqXG4gICAgICogTmFycm93cyB0aGUgcnVudGltZSB2YWx1ZSB0byB0aGUgZG9jdW1lbnRlZCB0eXBlLlxuICAgICAqIEB0eXBlIHtCYWNrZ3JvdW5kSm9ic1NjaGVkdWxlciB8IHVuZGVmaW5lZH0gKi9cbiAgICB0aGlzLnNjaGVkdWxlciA9IHVuZGVmaW5lZFxuICAgIHRoaXMuX2RyYWluaW5nID0gZmFsc2VcbiAgICB0aGlzLl9yZWRyYWluUXVldWVkID0gZmFsc2VcbiAgICAvKiogQHR5cGUge1Byb21pc2U8dm9pZD4gfCB1bmRlZmluZWR9ICovXG4gICAgdGhpcy5fZHJhaW5Qcm9taXNlID0gdW5kZWZpbmVkXG4gICAgdGhpcy5fc3RvcHBlZCA9IGZhbHNlXG4gICAgLyoqIEB0eXBlIHtQcm9taXNlPHZvaWQ+IHwgdW5kZWZpbmVkfSAqL1xuICAgIHRoaXMuc3RvcFByb21pc2UgPSB1bmRlZmluZWRcbiAgICAvKipcbiAgICAgKiBOYXJyb3dzIHRoZSBydW50aW1lIHZhbHVlIHRvIHRoZSBkb2N1bWVudGVkIHR5cGUuXG4gICAgICogQHR5cGUgeygoKSA9PiB2b2lkKSB8IHVuZGVmaW5lZH0gKi9cbiAgICB0aGlzLl91bnN1YnNjcmliZUJlYWNvbiA9IHVuZGVmaW5lZFxuICAgIC8qKlxuICAgICAqIE5hcnJvd3MgdGhlIHJ1bnRpbWUgdmFsdWUgdG8gdGhlIGRvY3VtZW50ZWQgdHlwZS5cbiAgICAgKiBAdHlwZSB7KCguLi5hcmdzOiBBcnJheTxSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj4pID0+IHZvaWQpIHwgdW5kZWZpbmVkfSAqL1xuICAgIHRoaXMuX2JlYWNvbkNvbm5lY3RIYW5kbGVyID0gdW5kZWZpbmVkXG4gICAgLyoqXG4gICAgICogTmFycm93cyB0aGUgcnVudGltZSB2YWx1ZSB0byB0aGUgZG9jdW1lbnRlZCB0eXBlLlxuICAgICAqIEB0eXBlIHtpbXBvcnQoXCIuLi9iZWFjb24vY2xpZW50LmpzXCIpLmRlZmF1bHQgfCBpbXBvcnQoXCIuLi9iZWFjb24vaW4tcHJvY2Vzcy1jbGllbnQuanNcIikuZGVmYXVsdCB8IHVuZGVmaW5lZH0gKi9cbiAgICB0aGlzLl9iZWFjb25DbGllbnQgPSB1bmRlZmluZWRcbiAgICAvKiogQHR5cGUge0JhY2tncm91bmRKb2JzTGlmZWN5Y2xlQ29udHJvbFNlcnZlciB8IHVuZGVmaW5lZH0gKi9cbiAgICB0aGlzLmxpZmVjeWNsZUNvbnRyb2xTZXJ2ZXIgPSB1bmRlZmluZWRcbiAgfVxuXG4gIC8qKlxuICAgKiBDb21wYXRpYmlsaXR5IGFsaWFzIGZvciBpbnRlZ3JhdGlvbnMgdGhhdCBpbnNwZWN0IHRoZSBhY3RpdmUgbWFpbiBzdG9yZS5cbiAgICogQHJldHVybnMge2ltcG9ydChcIi4vYWRhcHRlci5qc1wiKS5kZWZhdWx0fSAtIEFkYXB0ZXIgYWNxdWlyZWQgYnkgc3RhcnQuXG4gICAqL1xuICBnZXQgc3RvcmUoKSB7XG4gICAgaWYgKCF0aGlzLmFkYXB0ZXIpIHRocm93IG5ldyBFcnJvcihcIkJhY2tncm91bmQgam9icyBtYWluIGhhcyBub3QgYWNxdWlyZWQgaXRzIGFkYXB0ZXJcIilcblxuICAgIHJldHVybiB0aGlzLmFkYXB0ZXJcbiAgfVxuXG4gIC8qKlxuICAgKiBQcmVzZXJ2ZXMgdGhlIGhpc3RvcmljYWwgc3ViY2xhc3Mgc2VhbSB3aGlsZSBrZWVwaW5nIG9uZSBhZGFwdGVyIHJlZmVyZW5jZS5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL2FkYXB0ZXIuanNcIikuZGVmYXVsdH0gYWRhcHRlciAtIEFkYXB0ZXIgdG8gYXNzaWduLlxuICAgKi9cbiAgc2V0IHN0b3JlKGFkYXB0ZXIpIHtcbiAgICB0aGlzLmFkYXB0ZXIgPSBhZGFwdGVyXG4gIH1cblxuICAvKipcbiAgICogUnVucyBzdGFydC5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgd2hlbiBsaXN0ZW5pbmcuXG4gICAqL1xuICBhc3luYyBzdGFydCgpIHtcbiAgICB0aGlzLl9zdG9wcGVkID0gZmFsc2VcbiAgICB0aGlzLnN0b3BQcm9taXNlID0gdW5kZWZpbmVkXG4gICAgdGhpcy5fYWN0aXZlT3duZXJzaGlwUmVhZHkgPSBmYWxzZVxuICAgIHRoaXMubGlmZWN5Y2xlU3RhdGUgPSBcInN0YXJ0aW5nXCJcbiAgICB0aGlzLl9zdG9wcGVkUHJvbWlzZSA9IG5ldyBQcm9taXNlKCgvKiogQHR5cGUgeyh2YWx1ZTogdm9pZCkgPT4gdm9pZH0gKi8gcmVzb2x2ZSkgPT4geyB0aGlzLl9yZXNvbHZlU3RvcHBlZCA9IHJlc29sdmUgfSlcbiAgICB0aGlzLnJlY29ubmVjdGVkV29ya2VySWRzLmNsZWFyKClcbiAgICB0aGlzLnN0YXJ0dXBIYW5kb2ZmU25hcHNob3QgPSBbXVxuICAgIHRoaXMuX3N0YXJ0dXBIYW5kb2ZmQWRvcHRpb25zQXREZWFkbGluZSA9IFtdXG4gICAgdGhpcy5fc3RhcnR1cEhhbmRvZmZHcmFjZUVsYXBzZWQgPSBmYWxzZVxuICAgIHRoaXMuX3N0YXJ0dXBIYW5kb2ZmUmVjbGFpbVByb21pc2UgPSB1bmRlZmluZWRcbiAgICB0aGlzLmNvbmZpZ3VyYXRpb24uc2V0Q3VycmVudCgpXG5cbiAgICB0cnkge1xuICAgICAgYXdhaXQgdGhpcy5jb25maWd1cmF0aW9uLmluaXRpYWxpemUoe3R5cGU6IFwiYmFja2dyb3VuZC1qb2JzLW1haW5cIn0pXG4gICAgICBhd2FpdCB0aGlzLmNvbmZpZ3VyYXRpb24uY29ubmVjdEJlYWNvbih7cGVlclR5cGU6IFwiYmFja2dyb3VuZC1qb2JzLW1haW5cIn0pXG5cbiAgICAgIGlmICghdGhpcy5hZGFwdGVyKSB7XG4gICAgICAgIHRoaXMuYWRhcHRlciA9IGF3YWl0IHRoaXMuY29uZmlndXJhdGlvbi5hY3F1aXJlUmVhZHlCYWNrZ3JvdW5kSm9ic0FkYXB0ZXIoKVxuICAgICAgfVxuICAgICAgaWYgKHRoaXMuZ2VuZXJhdGlvbklkICYmICF0aGlzLmFkYXB0ZXIuc3VwcG9ydHNSZWxlYXNlU2NvcGVkR2VuZXJhdGlvbnMoKSkge1xuICAgICAgICB0aHJvdyBuZXcgRXJyb3IoXCJUaGUgY29uZmlndXJlZCBiYWNrZ3JvdW5kIGpvYnMgYWRhcHRlciBkb2VzIG5vdCBzdXBwb3J0IHJlbGVhc2Utc2NvcGVkIGdlbmVyYXRpb25zXCIpXG4gICAgICB9XG5cbiAgICAgIGlmICghdGhpcy5nZW5lcmF0aW9uSWQgfHwgdGhpcy5pbml0aWFsR2VuZXJhdGlvblN0YXRlICE9PSBcImNhbmRpZGF0ZVwiKSB7XG4gICAgICAgIHRoaXMuc3RhcnR1cEhhbmRvZmZTbmFwc2hvdCA9IGF3YWl0IHRoaXMuX2dlbmVyYXRpb25Pd25lZEhhbmRvZmZTbmFwc2hvdCgpXG4gICAgICB9XG4gICAgICBjb25zdCBzZXJ2ZXIgPSBuZXQuY3JlYXRlU2VydmVyKChzb2NrZXQpID0+IHRoaXMuX2hhbmRsZUNvbm5lY3Rpb24oc29ja2V0KSlcbiAgICAgIHRoaXMuc2VydmVyID0gc2VydmVyXG5cbiAgICAgIGF3YWl0IG5ldyBQcm9taXNlKChyZXNvbHZlLCByZWplY3QpID0+IHtcbiAgICAgICAgc2VydmVyLm9uY2UoXCJlcnJvclwiLCByZWplY3QpXG4gICAgICAgIHNlcnZlci5saXN0ZW4odGhpcy5wb3J0LCB0aGlzLmhvc3QsICgpID0+IHJlc29sdmUodW5kZWZpbmVkKSlcbiAgICAgIH0pXG5cbiAgICAgIGNvbnN0IGFkZHJlc3MgPSBzZXJ2ZXIuYWRkcmVzcygpXG4gICAgICBpZiAoYWRkcmVzcyAmJiB0eXBlb2YgYWRkcmVzcyA9PT0gXCJvYmplY3RcIikge1xuICAgICAgICB0aGlzLnBvcnQgPSBhZGRyZXNzLnBvcnRcbiAgICAgIH1cblxuICAgICAgdGhpcy5saWZlY3ljbGVTdGF0ZSA9IHRoaXMuZ2VuZXJhdGlvbklkID8gdGhpcy5pbml0aWFsR2VuZXJhdGlvblN0YXRlIDogXCJhY3RpdmVcIlxuXG4gICAgICBpZiAodGhpcy5nZW5lcmF0aW9uSWQgJiYgdGhpcy5saWZlY3ljbGVTb2NrZXRQYXRoKSB7XG4gICAgICAgIHRoaXMubGlmZWN5Y2xlQ29udHJvbFNlcnZlciA9IG5ldyBCYWNrZ3JvdW5kSm9ic0xpZmVjeWNsZUNvbnRyb2xTZXJ2ZXIoe1xuICAgICAgICAgIGNvbmZpZ3VyYXRpb246IHRoaXMuY29uZmlndXJhdGlvbixcbiAgICAgICAgICBnZW5lcmF0aW9uSWQ6IHRoaXMuZ2VuZXJhdGlvbklkLFxuICAgICAgICAgIG1haW46IHRoaXMsXG4gICAgICAgICAgc29ja2V0UGF0aDogdGhpcy5saWZlY3ljbGVTb2NrZXRQYXRoXG4gICAgICAgIH0pXG4gICAgICAgIGF3YWl0IHRoaXMubGlmZWN5Y2xlQ29udHJvbFNlcnZlci5zdGFydCgpXG4gICAgICB9XG5cbiAgICAgIHRoaXMuX3dvcmtlclN0YWxlVGltZXIgPSBzZXRJbnRlcnZhbCgoKSA9PiB7XG4gICAgICAgIHZvaWQgdGhpcy5fc3dlZXBTdGFsZVdvcmtlcnMoKVxuICAgICAgfSwgdGhpcy53b3JrZXJMaXZlbmVzc1N3ZWVwTXMpXG5cbiAgICAgIGlmICh0aGlzLmxpZmVjeWNsZVN0YXRlID09PSBcImFjdGl2ZVwiKSB7XG4gICAgICAgIGF3YWl0IHRoaXMuX3N0YXJ0QWN0aXZlT3duZXJzaGlwKClcbiAgICAgIH0gZWxzZSBpZiAodGhpcy5saWZlY3ljbGVTdGF0ZSA9PT0gXCJyZXRpcmVkXCIpIHtcbiAgICAgICAgdGhpcy5fc3RhcnRHZW5lcmF0aW9uUmVjb3ZlcnlPd25lcnNoaXAoKVxuICAgICAgfVxuICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICBsZXQgY2xlYW51cEVycm9yXG5cbiAgICAgIHRyeSB7XG4gICAgICAgIGF3YWl0IHRoaXMuc3RvcCgpXG4gICAgICB9IGNhdGNoIChjYXVnaHRDbGVhbnVwRXJyb3IpIHtcbiAgICAgICAgY2xlYW51cEVycm9yID0gY2F1Z2h0Q2xlYW51cEVycm9yXG4gICAgICB9XG5cbiAgICAgIGlmIChjbGVhbnVwRXJyb3IpIHtcbiAgICAgICAgdGhyb3cgbmV3IEFnZ3JlZ2F0ZUVycm9yKFxuICAgICAgICAgIFtlcnJvciwgY2xlYW51cEVycm9yXSxcbiAgICAgICAgICBcIkJhY2tncm91bmQgam9icyBtYWluIHN0YXJ0dXAgYW5kIGNsZWFudXAgZmFpbGVkXCIsXG4gICAgICAgICAge2NhdXNlOiBlcnJvcn1cbiAgICAgICAgKVxuICAgICAgfVxuXG4gICAgICB0aHJvdyBlcnJvclxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHN0b3AuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIHdoZW4gY2xvc2VkLlxuICAgKi9cbiAgc3RvcCgpIHtcbiAgICBpZiAoIXRoaXMuc3RvcFByb21pc2UpIHRoaXMuc3RvcFByb21pc2UgPSB0aGlzLl9zdG9wKClcblxuICAgIHJldHVybiB0aGlzLnN0b3BQcm9taXNlXG4gIH1cblxuICAvKipcbiAgICogUnVucyB0aGUgbWFpbi1wcm9jZXNzIHNodXRkb3duIGxpZmVjeWNsZSBvbmNlLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyB3aGVuIGNsb3NlZC5cbiAgICovXG4gIGFzeW5jIF9zdG9wKCkge1xuICAgIHRoaXMuX3N0b3BwZWQgPSB0cnVlXG5cbiAgICB0cnkge1xuICAgICAgYXdhaXQgc2h1dGRvd25MaWZlY3ljbGUoe1xuICAgICAgICBvblN0b3BwZWQ6IHRoaXMub25TdG9wcGVkLFxuICAgICAgICBzaHV0ZG93bjogYXN5bmMgKCkgPT4ge1xuICAgICAgICAgIHRoaXMuX2Nsb3NlV29ya2VycygpXG4gICAgICAgICAgdGhpcy5fY2xlYXJUaW1lcnMoKVxuICAgICAgICAgIHRoaXMuX2Rpc2Nvbm5lY3RCZWFjb25IYW5kbGVycygpXG4gICAgICAgICAgdHJ5IHtcbiAgICAgICAgICAgIGF3YWl0IHRoaXMuc2NoZWR1bGVyPy5zdG9wKClcbiAgICAgICAgICAgIGlmICh0aGlzLl9kcmFpblByb21pc2UpIGF3YWl0IHRoaXMuX2RyYWluUHJvbWlzZVxuICAgICAgICAgIH0gZmluYWxseSB7XG4gICAgICAgICAgICB0cnkge1xuICAgICAgICAgICAgICBhd2FpdCB0aGlzLl9kcmFpbldvcmtlckhhbmRvZmZBZG9wdGlvbnMoKVxuICAgICAgICAgICAgfSBmaW5hbGx5IHtcbiAgICAgICAgICAgICAgdHJ5IHtcbiAgICAgICAgICAgICAgICBhd2FpdCB0aGlzLl9kcmFpblN0YXJ0dXBIYW5kb2ZmUmVjbGFpbSgpXG4gICAgICAgICAgICAgIH0gZmluYWxseSB7XG4gICAgICAgICAgICAgICAgYXdhaXQgdGhpcy5fc3RvcEJlYWNvbkFuZFNlcnZlcigpXG4gICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH1cbiAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICAgIH0pXG4gICAgfSBmaW5hbGx5IHtcbiAgICAgIHRoaXMuYWRhcHRlciA9IHVuZGVmaW5lZFxuICAgICAgdGhpcy5saWZlY3ljbGVTdGF0ZSA9IFwic3RvcHBlZFwiXG4gICAgICB0aGlzLl9yZXNvbHZlU3RvcHBlZCgpXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgY2xvc2Ugd29ya2Vycy5cbiAgICogQHJldHVybnMge3ZvaWR9ICovXG4gIF9jbG9zZVdvcmtlcnMoKSB7XG4gICAgZm9yIChjb25zdCBjb25uZWN0aW9uIG9mIHRoaXMuY29ubmVjdGlvbnMpIHtcbiAgICAgIGNvbm5lY3Rpb24uY2xvc2UoKVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGNsZWFyIHRpbWVycy5cbiAgICogQHJldHVybnMge3ZvaWR9ICovXG4gIF9jbGVhclRpbWVycygpIHtcbiAgICBpZiAodGhpcy5fcG9sbFRpbWVyKSBjbGVhckludGVydmFsKHRoaXMuX3BvbGxUaW1lcilcbiAgICBpZiAodGhpcy5fc2NoZWR1bGVkVGltZXIpIGNsZWFyVGltZW91dCh0aGlzLl9zY2hlZHVsZWRUaW1lcilcbiAgICBpZiAodGhpcy5fZXJyb3JSZXRyeVRpbWVyKSBjbGVhclRpbWVvdXQodGhpcy5fZXJyb3JSZXRyeVRpbWVyKVxuICAgIGlmICh0aGlzLl9vcnBoYW5UaW1lcikgY2xlYXJJbnRlcnZhbCh0aGlzLl9vcnBoYW5UaW1lcilcbiAgICBpZiAodGhpcy5fd29ya2VyU3RhbGVUaW1lcikgY2xlYXJJbnRlcnZhbCh0aGlzLl93b3JrZXJTdGFsZVRpbWVyKVxuICAgIGlmICh0aGlzLl9zdGFydHVwSGFuZG9mZlJlY2xhaW1UaW1lcikgdGhpcy5jbG9jay5jbGVhclRpbWVvdXQodGhpcy5fc3RhcnR1cEhhbmRvZmZSZWNsYWltVGltZXIpXG4gICAgZm9yIChjb25zdCB7dGltZXJ9IG9mIHRoaXMuZGlzY29ubmVjdGVkV29ya2Vycy52YWx1ZXMoKSkgdGhpcy5jbG9jay5jbGVhclRpbWVvdXQodGltZXIpXG4gICAgdGhpcy5kaXNjb25uZWN0ZWRXb3JrZXJzLmNsZWFyKClcbiAgICB0aGlzLl9wb2xsVGltZXIgPSB1bmRlZmluZWRcbiAgICB0aGlzLl9zY2hlZHVsZWRUaW1lciA9IHVuZGVmaW5lZFxuICAgIHRoaXMuX2Vycm9yUmV0cnlUaW1lciA9IHVuZGVmaW5lZFxuICAgIHRoaXMuX29ycGhhblRpbWVyID0gdW5kZWZpbmVkXG4gICAgdGhpcy5fd29ya2VyU3RhbGVUaW1lciA9IHVuZGVmaW5lZFxuICAgIHRoaXMuX3N0YXJ0dXBIYW5kb2ZmUmVjbGFpbVRpbWVyID0gdW5kZWZpbmVkXG4gIH1cblxuICAvKipcbiAgICogUnVucyBkaXNjb25uZWN0IGJlYWNvbiBoYW5kbGVycy5cbiAgICogQHJldHVybnMge3ZvaWR9ICovXG4gIF9kaXNjb25uZWN0QmVhY29uSGFuZGxlcnMoKSB7XG4gICAgaWYgKHRoaXMuX3Vuc3Vic2NyaWJlQmVhY29uKSB7XG4gICAgICB0aGlzLl91bnN1YnNjcmliZUJlYWNvbigpXG4gICAgICB0aGlzLl91bnN1YnNjcmliZUJlYWNvbiA9IHVuZGVmaW5lZFxuICAgIH1cblxuICAgIGlmICh0aGlzLl9iZWFjb25DbGllbnQgJiYgdGhpcy5fYmVhY29uQ29ubmVjdEhhbmRsZXIpIHtcbiAgICAgIHRoaXMuX2JlYWNvbkNsaWVudC5vZmYoXCJjb25uZWN0XCIsIHRoaXMuX2JlYWNvbkNvbm5lY3RIYW5kbGVyKVxuICAgIH1cbiAgICB0aGlzLl9iZWFjb25Db25uZWN0SGFuZGxlciA9IHVuZGVmaW5lZFxuICAgIHRoaXMuX2JlYWNvbkNsaWVudCA9IHVuZGVmaW5lZFxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgc3RvcCBiZWFjb24gYW5kIHNlcnZlci5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59ICovXG4gIGFzeW5jIF9zdG9wQmVhY29uQW5kU2VydmVyKCkge1xuICAgIGF3YWl0IHJ1blNodXRkb3duU3RlcHMoe1xuICAgICAgbWVzc2FnZTogXCJCYWNrZ3JvdW5kIGpvYnMgbWFpbiBhcHBsaWNhdGlvbiBhbmQgZnJhbWV3b3JrIHNodXRkb3duIGZhaWxlZFwiLFxuICAgICAgc3RlcHM6IFtcbiAgICAgICAgYXN5bmMgKCkgPT4ge1xuICAgICAgICAgIHRyeSB7XG4gICAgICAgICAgICBhd2FpdCB0aGlzLmxpZmVjeWNsZUNvbnRyb2xTZXJ2ZXI/LmNsb3NlKClcbiAgICAgICAgICB9IGZpbmFsbHkge1xuICAgICAgICAgICAgdGhpcy5saWZlY3ljbGVDb250cm9sU2VydmVyID0gdW5kZWZpbmVkXG4gICAgICAgICAgfVxuICAgICAgICB9LFxuICAgICAgICAuLi4odGhpcy5jbG9zZURhdGFiYXNlQ29ubmVjdGlvbnNPblN0b3BcbiAgICAgICAgICA/IFthc3luYyAoKSA9PiBhd2FpdCB0aGlzLmNvbmZpZ3VyYXRpb24uc2h1dGRvd24oKV1cbiAgICAgICAgICA6IFtdKSxcbiAgICAgICAgYXN5bmMgKCkgPT4gYXdhaXQgdGhpcy5jb25maWd1cmF0aW9uLmRpc2Nvbm5lY3RCZWFjb24oKSxcbiAgICAgICAgYXN5bmMgKCkgPT4gYXdhaXQgdGhpcy5fY2xvc2VTZXJ2ZXIoKSxcbiAgICAgICAgYXN5bmMgKCkgPT4ge1xuICAgICAgICAgIGlmICh0aGlzLmNsb3NlRGF0YWJhc2VDb25uZWN0aW9uc09uU3RvcCkge1xuICAgICAgICAgICAgYXdhaXQgdGhpcy5jb25maWd1cmF0aW9uLmNsb3NlRGF0YWJhc2VDb25uZWN0aW9ucygpXG4gICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgIGF3YWl0IHRoaXMuY29uZmlndXJhdGlvbi5jbG9zZUJhY2tncm91bmRKb2JzQWRhcHRlcigpXG4gICAgICAgICAgfVxuICAgICAgICB9XG4gICAgICBdXG4gICAgfSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGNsb3NlIHNlcnZlci5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59ICovXG4gIGFzeW5jIF9jbG9zZVNlcnZlcigpIHtcbiAgICBpZiAoIXRoaXMuc2VydmVyKSByZXR1cm5cblxuICAgIGNvbnN0IHtzZXJ2ZXJ9ID0gdGhpc1xuICAgIHRoaXMuc2VydmVyID0gdW5kZWZpbmVkXG4gICAgYXdhaXQgbmV3IFByb21pc2UoKHJlc29sdmUpID0+IHNlcnZlci5jbG9zZSgoKSA9PiByZXNvbHZlKHVuZGVmaW5lZCkpKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZ2V0IHBvcnQuXG4gICAqIEByZXR1cm5zIHtudW1iZXJ9IC0gQm91bmQgcG9ydC5cbiAgICovXG4gIGdldFBvcnQoKSB7XG4gICAgcmV0dXJuIHRoaXMucG9ydFxuICB9XG5cbiAgLyoqXG4gICAqIEdldHMgdGhlIGxpZmVjeWNsZSBzdGF0ZS5cbiAgICogQHJldHVybnMge2ltcG9ydChcIi4vdHlwZXMuanNcIikuQmFja2dyb3VuZEpvYnNHZW5lcmF0aW9uTGlmZWN5Y2xlU3RhdGV9IC0gQ3VycmVudCBsaWZlY3ljbGUgc3RhdGUuXG4gICAqL1xuICBnZXRMaWZlY3ljbGVTdGF0ZSgpIHsgcmV0dXJuIHRoaXMubGlmZWN5Y2xlU3RhdGUgfVxuXG4gIC8qKlxuICAgKiBSZXR1cm5zIGEgcHJvbWlzZSB0aGF0IHNldHRsZXMgb25seSBhZnRlciB0aGUgbWFpbiBoYXMgZnVsbHkgc3RvcHBlZC5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gU3RvcCBjb21wbGV0aW9uLlxuICAgKi9cbiAgYXN5bmMgd2FpdFVudGlsU3RvcHBlZCgpIHsgYXdhaXQgdGhpcy5fc3RvcHBlZFByb21pc2UgfVxuXG4gIC8qKlxuICAgKiBTbmFwc2hvdHMgb25seSBleGFjdCBkdXJhYmxlIG93bmVycyBmcm9tIHRoaXMgcmVsZWFzZSBnZW5lcmF0aW9uLlxuICAgKiBMZWdhY3kgbW9kZSBpbnRlbnRpb25hbGx5IHJldGFpbnMgaXRzIGhpc3RvcmljYWwgZ2xvYmFsIHNuYXBzaG90LlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxpbXBvcnQoXCIuL3R5cGVzLmpzXCIpLkJhY2tncm91bmRKb2JIYW5kb2ZmU25hcHNob3RbXT59IC0gT3duZWQgc25hcHNob3QuXG4gICAqL1xuICBhc3luYyBfZ2VuZXJhdGlvbk93bmVkSGFuZG9mZlNuYXBzaG90KCkge1xuICAgIGNvbnN0IGhhbmRvZmZzID0gYXdhaXQgdGhpcy5zdG9yZS5zbmFwc2hvdEhhbmRlZE9mZkpvYnMoKVxuXG4gICAgaWYgKCF0aGlzLmdlbmVyYXRpb25JZCkgcmV0dXJuIGhhbmRvZmZzXG4gICAgY29uc3QgZ2VuZXJhdGlvbklkID0gdGhpcy5nZW5lcmF0aW9uSWRcblxuICAgIHJldHVybiBoYW5kb2Zmcy5maWx0ZXIoKHt3b3JrZXJJZH0pID0+IHdvcmtlcklkQmVsb25nc1RvR2VuZXJhdGlvbih7Z2VuZXJhdGlvbklkLCB3b3JrZXJJZH0pKVxuICB9XG5cbiAgLyoqXG4gICAqIEFjcXVpcmVzIHNjaGVkdWxpbmcgYW5kIGRpc3BhdGNoIG93bmVyc2hpcCBmb3IgYW4gYWN0aXZlIGdlbmVyYXRpb24uXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIGFmdGVyIGFjdGl2ZSBvd25lcnNoaXAgaXMgZXN0YWJsaXNoZWQuXG4gICAqL1xuICBhc3luYyBfc3RhcnRBY3RpdmVPd25lcnNoaXAoKSB7XG4gICAgYXdhaXQgdGhpcy5zdG9yZS5yZWNvbmNpbGVRdWV1ZUNvbmN1cnJlbmN5KClcbiAgICB0aGlzLl9zZXR1cERpc3BhdGNoVHJpZ2dlcnMoKVxuICAgIHRoaXMuX3NldHVwU3RhcnR1cEhhbmRvZmZSZWNsYWltKClcbiAgICB0aGlzLl9zdGFydE9ycGhhblN3ZWVwKClcbiAgICBhd2FpdCB0aGlzLl9zdGFydFNjaGVkdWxlcigpXG4gICAgdGhpcy5fYWN0aXZlT3duZXJzaGlwUmVhZHkgPSB0cnVlXG4gICAgdGhpcy5fY3JlZGl0UmVhZHlXb3JrZXJzKClcbiAgICBhd2FpdCB0aGlzLl9kcmFpbigpXG4gIH1cblxuICAvKiogU3RhcnRzIGV4YWN0IHJlY292ZXJ5IGR1dGllcyB3aXRob3V0IGFjcXVpcmluZyBnbG9iYWwgZGlzcGF0Y2ggb3duZXJzaGlwLiAqL1xuICBfc3RhcnRHZW5lcmF0aW9uUmVjb3ZlcnlPd25lcnNoaXAoKSB7XG4gICAgdGhpcy5fc2V0dXBTdGFydHVwSGFuZG9mZlJlY2xhaW0oKVxuICAgIHRoaXMuX3N0YXJ0T3JwaGFuU3dlZXAoKVxuICAgIHRoaXMuX21heWJlU3RvcFJldGlyZWQoKVxuICB9XG5cbiAgLyoqIFN0YXJ0cyB0aGUgZ2VuZXJhdGlvbi1mZW5jZWQgb3JwaGFuIHN3ZWVwLiAqL1xuICBfc3RhcnRPcnBoYW5Td2VlcCgpIHtcbiAgICBpZiAodGhpcy5fb3JwaGFuVGltZXIpIHJldHVyblxuXG4gICAgdGhpcy5fb3JwaGFuVGltZXIgPSBzZXRJbnRlcnZhbCgoKSA9PiB7IHZvaWQgdGhpcy5fc3dlZXBPcnBoYW5zKCkgfSwgNjAwMDApXG4gIH1cblxuICAvKipcbiAgICogU3RhcnRzIHNjaGVkdWxlIG93bmVyc2hpcCBleGFjdGx5IG9uY2UuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIGFmdGVyIHNjaGVkdWxlcyBhcmUgbG9hZGVkLlxuICAgKi9cbiAgYXN5bmMgX3N0YXJ0U2NoZWR1bGVyKCkge1xuICAgIGlmICh0aGlzLnNjaGVkdWxlcikgcmV0dXJuXG5cbiAgICB0aGlzLnNjaGVkdWxlciA9IG5ldyBCYWNrZ3JvdW5kSm9ic1NjaGVkdWxlcih7XG4gICAgICBjb25maWd1cmF0aW9uOiB0aGlzLmNvbmZpZ3VyYXRpb24sXG4gICAgICBlbnF1ZXVlSm9iOiBhc3luYyAoe2FyZ3MsIGpvYkNsYXNzLCBvcHRpb25zfSkgPT4ge1xuICAgICAgICBhd2FpdCB0aGlzLnN0b3JlLmVucXVldWUoe1xuICAgICAgICAgIGpvYk5hbWU6IGpvYkNsYXNzLmpvYk5hbWUoKSxcbiAgICAgICAgICBhcmdzLFxuICAgICAgICAgIG9wdGlvbnM6IGpvYkNsYXNzLl93aXRoSm9iQ29udGV4dCh7am9iQXJnczogYXJncywgam9iT3B0aW9uczogb3B0aW9uc30pXG4gICAgICAgIH0pXG4gICAgICAgIHRoaXMuX25vdGlmeUVucXVldWVkKClcbiAgICAgICAgdm9pZCB0aGlzLl9kcmFpbigpXG4gICAgICB9XG4gICAgfSlcbiAgICBhd2FpdCB0aGlzLnNjaGVkdWxlci5zdGFydCgpXG5cbiAgICBjb25zdCByZXRlbnRpb25TY2hlZHVsZSA9IFBydW5lVGVybWluYWxCYWNrZ3JvdW5kSm9ic0pvYi5zY2hlZHVsZUNvbmZpZ3VyYXRpb24odGhpcy5yZXRlbnRpb24pXG5cbiAgICBpZiAocmV0ZW50aW9uU2NoZWR1bGUpIHtcbiAgICAgIHRoaXMuc2NoZWR1bGVyLnNjaGVkdWxlSm9iKHtqb2JDb25maWd1cmF0aW9uOiByZXRlbnRpb25TY2hlZHVsZSwgam9iS2V5OiBcInZlbG9jaW91c1BydW5lVGVybWluYWxCYWNrZ3JvdW5kSm9ic1wifSlcbiAgICB9XG4gIH1cblxuICAvKiogQ3JlZGl0cyByZWFkaW5lc3MgYWR2ZXJ0aXNlbWVudHMgcmVjb3JkZWQgd2hpbGUgZGlzcGF0Y2ggd2FzIGZlbmNlZC4gKi9cbiAgX2NyZWRpdFJlYWR5V29ya2VycygpIHtcbiAgICBmb3IgKGNvbnN0IHdvcmtlciBvZiB0aGlzLmNhbmRpZGF0ZVJlYWR5V29ya2Vycykge1xuICAgICAgaWYgKHRoaXMud29ya2Vycy5oYXMod29ya2VyKSAmJiAhd29ya2VyLmlzRHJhaW5pbmcgJiYgd29ya2VyLnN1cHBvcnRzSGFuZG9mZklkUmVwb3J0aW5nKSB7XG4gICAgICAgIHRoaXMucmVhZHlXb3JrZXJzLmFkZCh3b3JrZXIpXG4gICAgICB9XG4gICAgfVxuICAgIHRoaXMuY2FuZGlkYXRlUmVhZHlXb3JrZXJzLmNsZWFyKClcbiAgfVxuXG4gIC8qKlxuICAgKiBBY3RpdmF0ZXMgYSBjYW5kaWRhdGUgYWZ0ZXIgaXRzIHN1cGVydmlzb3IgaGFzIHJldGlyZWQgdGhlIG9sZCBnZW5lcmF0aW9uLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyBhZnRlciBzY2hlZHVsaW5nIGFuZCBkaXNwYXRjaCBhcmUgYWN0aXZlLlxuICAgKi9cbiAgYWN0aXZhdGUoKSB7XG4gICAgaWYgKCF0aGlzLmdlbmVyYXRpb25JZCkgdGhyb3cgbmV3IEVycm9yKFwiQmFja2dyb3VuZCBqb2JzIGdlbmVyYXRpb24gYWN0aXZhdGlvbiByZXF1aXJlcyBnZW5lcmF0aW9uIG1vZGVcIilcbiAgICBpZiAodGhpcy5saWZlY3ljbGVTdGF0ZSA9PT0gXCJhY3RpdmVcIikgcmV0dXJuIFByb21pc2UucmVzb2x2ZSgpXG4gICAgaWYgKHRoaXMubGlmZWN5Y2xlU3RhdGUgIT09IFwiY2FuZGlkYXRlXCIpIHRocm93IG5ldyBFcnJvcihgQ2Fubm90IGFjdGl2YXRlIGJhY2tncm91bmQgam9icyBnZW5lcmF0aW9uIGZyb20gJHt0aGlzLmxpZmVjeWNsZVN0YXRlfWApXG4gICAgaWYgKCF0aGlzLl9hY3RpdmF0aW9uUHJvbWlzZSkgdGhpcy5fYWN0aXZhdGlvblByb21pc2UgPSB0aGlzLl9hY3RpdmF0ZSgpXG5cbiAgICByZXR1cm4gdGhpcy5fYWN0aXZhdGlvblByb21pc2VcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGFjdGl2YXRpb24uXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIEFjdGl2YXRpb24gY29tcGxldGlvbi5cbiAgICovXG4gIGFzeW5jIF9hY3RpdmF0ZSgpIHtcbiAgICB0aGlzLmxvZ2dlci5pbmZvKCgpID0+IFtcIkJhY2tncm91bmQgam9icyBnZW5lcmF0aW9uIGFjdGl2YXRpb24gc3RhcnRpbmdcIiwge2dlbmVyYXRpb25JZDogdGhpcy5nZW5lcmF0aW9uSWR9XSlcbiAgICBhd2FpdCB0aGlzLl9zdGFydEFjdGl2ZU93bmVyc2hpcCgpXG4gICAgdGhpcy5saWZlY3ljbGVTdGF0ZSA9IFwiYWN0aXZlXCJcbiAgICB0aGlzLl9jcmVkaXRSZWFkeVdvcmtlcnMoKVxuICAgIHRoaXMubG9nZ2VyLmluZm8oKCkgPT4gW1wiQmFja2dyb3VuZCBqb2JzIGdlbmVyYXRpb24gYWN0aXZhdGlvbiBhY2tub3dsZWRnZWRcIiwge2dlbmVyYXRpb25JZDogdGhpcy5nZW5lcmF0aW9uSWR9XSlcbiAgICB2b2lkIHRoaXMuX2RyYWluKCkuY2F0Y2goKGVycm9yKSA9PiB7XG4gICAgICB0aGlzLmxvZ2dlci5lcnJvcigoKSA9PiBbXCJCYWNrZ3JvdW5kIGpvYnMgZ2VuZXJhdGlvbiBwb3N0LWFjdGl2YXRpb24gZHJhaW4gZmFpbGVkXCIsIHtlcnJvciwgZ2VuZXJhdGlvbklkOiB0aGlzLmdlbmVyYXRpb25JZH1dKVxuICAgIH0pXG4gIH1cblxuICAvKipcbiAgICogRXN0YWJsaXNoZXMgdGhlIHN5bmNocm9ub3VzIHJldGlyZW1lbnQgZmVuY2UgYW5kIHRoZW4gZHJhaW5zIG93bmVyc2hpcCBzZXR1cC5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgYWZ0ZXIgdGhlIHJldGlyZW1lbnQgZmVuY2UgaXMgZHVyYWJsZSBpbiBtZW1vcnkuXG4gICAqL1xuICByZXRpcmUoKSB7XG4gICAgaWYgKCF0aGlzLmdlbmVyYXRpb25JZCkgdGhyb3cgbmV3IEVycm9yKFwiQmFja2dyb3VuZCBqb2JzIGdlbmVyYXRpb24gcmV0aXJlbWVudCByZXF1aXJlcyBnZW5lcmF0aW9uIG1vZGVcIilcbiAgICBpZiAodGhpcy5saWZlY3ljbGVTdGF0ZSA9PT0gXCJyZXRpcmluZ1wiIHx8IHRoaXMubGlmZWN5Y2xlU3RhdGUgPT09IFwicmV0aXJlZFwiKSByZXR1cm4gUHJvbWlzZS5yZXNvbHZlKClcbiAgICBpZiAodGhpcy5saWZlY3ljbGVTdGF0ZSAhPT0gXCJhY3RpdmVcIikgdGhyb3cgbmV3IEVycm9yKGBDYW5ub3QgcmV0aXJlIGJhY2tncm91bmQgam9icyBnZW5lcmF0aW9uIGZyb20gJHt0aGlzLmxpZmVjeWNsZVN0YXRlfWApXG5cbiAgICB0aGlzLmxpZmVjeWNsZVN0YXRlID0gXCJyZXRpcmluZ1wiXG4gICAgdGhpcy5fYWN0aXZlT3duZXJzaGlwUmVhZHkgPSBmYWxzZVxuICAgIHRoaXMucmVhZHlXb3JrZXJzLmNsZWFyKClcbiAgICB0aGlzLmNhbmRpZGF0ZVJlYWR5V29ya2Vycy5jbGVhcigpXG4gICAgdGhpcy5fY2xlYXJEaXNwYXRjaFRpbWVycygpXG4gICAgdGhpcy5fZGlzY29ubmVjdEJlYWNvbkhhbmRsZXJzKClcbiAgICB0aGlzLl9yZXRpcmVtZW50UHJvbWlzZSA9IHRoaXMuX3JldGlyZSgpXG4gICAgdm9pZCB0aGlzLl9yZXRpcmVtZW50UHJvbWlzZS5jYXRjaCgoZXJyb3IpID0+IHRoaXMuX3JlcG9ydENvbm5lY3Rpb25IYW5kbGVyRXJyb3IoZXJyb3IpKVxuXG4gICAgcmV0dXJuIFByb21pc2UucmVzb2x2ZSgpXG4gIH1cblxuICAvKipcbiAgICogUnVucyByZXRpcmVtZW50IGFmdGVyIGl0cyBzeW5jaHJvbm91cyBmZW5jZS5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmV0aXJlbWVudCBmZW5jZSBjb21wbGV0aW9uLlxuICAgKi9cbiAgYXN5bmMgX3JldGlyZSgpIHtcbiAgICBhd2FpdCB0aGlzLnNjaGVkdWxlcj8uc3RvcCgpXG4gICAgdGhpcy5zY2hlZHVsZXIgPSB1bmRlZmluZWRcbiAgICBpZiAodGhpcy5fZHJhaW5Qcm9taXNlKSBhd2FpdCB0aGlzLl9kcmFpblByb21pc2VcbiAgICBpZiAodGhpcy5fc3RvcHBlZCkgcmV0dXJuXG5cbiAgICBmb3IgKGNvbnN0IHdvcmtlciBvZiB0aGlzLndvcmtlcnMpIHtcbiAgICAgIHdvcmtlci5pc0RyYWluaW5nID0gdHJ1ZVxuICAgICAgd29ya2VyLnNlbmQoe3R5cGU6IFwicmV0aXJlXCIsIGdlbmVyYXRpb25JZDogdGhpcy5nZW5lcmF0aW9uSWR9KVxuICAgIH1cblxuICAgIHRoaXMubGlmZWN5Y2xlU3RhdGUgPSBcInJldGlyZWRcIlxuICAgIHRoaXMuX3N0YXJ0R2VuZXJhdGlvblJlY292ZXJ5T3duZXJzaGlwKClcbiAgfVxuXG4gIC8qKiBDbGVhcnMgdGltZXJzIHRoYXQgY2FuIGluaXRpYXRlIG5ldyBnbG9iYWwgZGlzcGF0Y2ggb3Igc2NoZWR1bGUgd29yay4gKi9cbiAgX2NsZWFyRGlzcGF0Y2hUaW1lcnMoKSB7XG4gICAgaWYgKHRoaXMuX3BvbGxUaW1lcikgY2xlYXJJbnRlcnZhbCh0aGlzLl9wb2xsVGltZXIpXG4gICAgaWYgKHRoaXMuX3NjaGVkdWxlZFRpbWVyKSBjbGVhclRpbWVvdXQodGhpcy5fc2NoZWR1bGVkVGltZXIpXG4gICAgaWYgKHRoaXMuX2Vycm9yUmV0cnlUaW1lcikgY2xlYXJUaW1lb3V0KHRoaXMuX2Vycm9yUmV0cnlUaW1lcilcbiAgICB0aGlzLl9wb2xsVGltZXIgPSB1bmRlZmluZWRcbiAgICB0aGlzLl9zY2hlZHVsZWRUaW1lciA9IHVuZGVmaW5lZFxuICAgIHRoaXMuX2Vycm9yUmV0cnlUaW1lciA9IHVuZGVmaW5lZFxuICB9XG5cbiAgLyoqIEhvbGRzIHRoZSBtYWluIG9wZW4gdW50aWwgYSBsaWZlY3ljbGUgcmVzcG9uc2UgaGFzIGZsdXNoZWQuICovXG4gIGFjcXVpcmVMaWZlY3ljbGVSZXF1ZXN0TGVhc2UoKSB7IHRoaXMuX2xpZmVjeWNsZVJlcXVlc3RMZWFzZXMgKz0gMSB9XG5cbiAgLyoqIFJlbGVhc2VzIG9uZSBsaWZlY3ljbGUtcmVzcG9uc2UgbGVhc2UgYWZ0ZXIgaXRzIHNvY2tldCB3cml0ZSBjYWxsYmFjay4gKi9cbiAgcmVsZWFzZUxpZmVjeWNsZVJlcXVlc3RMZWFzZSgpIHtcbiAgICBpZiAodGhpcy5fbGlmZWN5Y2xlUmVxdWVzdExlYXNlcyA8IDEpIHRocm93IG5ldyBFcnJvcihcIk5vIGJhY2tncm91bmQgam9icyBsaWZlY3ljbGUgcmVxdWVzdCBsZWFzZSB0byByZWxlYXNlXCIpXG4gICAgdGhpcy5fbGlmZWN5Y2xlUmVxdWVzdExlYXNlcyAtPSAxXG4gICAgdGhpcy5fbWF5YmVTdG9wUmV0aXJlZCgpXG4gIH1cblxuICAvKiogU3RvcHMgYSByZXRpcmVkIGdlbmVyYXRpb24gb25seSBhZnRlciBpdHMgZXhhY3Qgb3duZXJzaGlwIGhhcyBkcmFpbmVkLiAqL1xuICBfbWF5YmVTdG9wUmV0aXJlZCgpIHtcbiAgICBpZiAodGhpcy5saWZlY3ljbGVTdGF0ZSAhPT0gXCJyZXRpcmVkXCIgfHwgdGhpcy5fc3RvcHBlZCB8fCB0aGlzLnN0b3BQcm9taXNlKSByZXR1cm5cbiAgICBpZiAodGhpcy5fbGlmZWN5Y2xlUmVxdWVzdExlYXNlcyA+IDAgfHwgdGhpcy5fYWN0aXZlTm9uV29ya2VyUmVxdWVzdHMgPiAwIHx8IHRoaXMud29ya2Vycy5zaXplID4gMCB8fCB0aGlzLmRpc2Nvbm5lY3RlZFdvcmtlcnMuc2l6ZSA+IDApIHJldHVyblxuICAgIGlmICh0aGlzLmluZmxpZ2h0V29ya2VySGFuZG9mZkFkb3B0aW9ucy5zaXplID4gMCB8fCB0aGlzLnBlbmRpbmdIYW5kb2ZmUmVjb3Zlcmllcy5zaXplID4gMCkgcmV0dXJuXG4gICAgaWYgKHRoaXMuX2RyYWluUHJvbWlzZSB8fCB0aGlzLl9zdGFydHVwSGFuZG9mZlJlY2xhaW1Qcm9taXNlIHx8IHRoaXMuX3N0YXJ0dXBIYW5kb2ZmUmVjbGFpbVRpbWVyKSByZXR1cm5cbiAgICBpZiAodGhpcy5zdGFydHVwSGFuZG9mZlNuYXBzaG90Lmxlbmd0aCA+IDApIHJldHVyblxuXG4gICAgZm9yIChjb25zdCBoYW5kb2ZmcyBvZiB0aGlzLndvcmtlckhhbmRvZmZzLnZhbHVlcygpKSB7XG4gICAgICBpZiAoaGFuZG9mZnMuc2l6ZSA+IDApIHJldHVyblxuICAgIH1cblxuICAgIHZvaWQgdGhpcy5zdG9wKCkuY2F0Y2goKGVycm9yKSA9PiB0aGlzLl9yZXBvcnRDb25uZWN0aW9uSGFuZGxlckVycm9yKGVycm9yKSlcbiAgfVxuXG4gIC8qKlxuICAgKiBXaXJlcyB1cCB0aGUgZGlzcGF0Y2gtdHJpZ2dlcmluZyBzaWduYWwgc291cmNlcyBmb3IgdGhlIGNvbmZpZ3VyZWRcbiAgICogc3RyYXRlZ3kuIEluIGBcImJlYWNvblwiYCBtb2RlIChkZWZhdWx0KSB0aGlzIG1lYW5zIHN1YnNjcmliaW5nIHRvIHRoZVxuICAgKiBgdmVsb2Npb3VzLWJhY2tncm91bmQtam9icy1kaXNwYXRjaGAgY2hhbm5lbCBmb3IgY3Jvc3MtcHJvY2Vzc1xuICAgKiB3YWtlLXVwcywgbGlzdGVuaW5nIGZvciBCZWFjb24gKHJlKWNvbm5lY3RzIHRvIGNhdGNoIHVwIG9uIG1pc3NlZFxuICAgKiB3b3JrLCBhbmQgcmVseWluZyBvbiBkaXJlY3QgaW4tcHJvY2VzcyBjYWxscyBmcm9tIGBfaGFuZGxlRW5xdWV1ZWAsXG4gICAqIGBfaGFuZGxlSm9iQ29tcGxldGVgL2BGYWlsZWRgLCB3b3JrZXIgaGVsbG8vcmVhZHksIGFuZCB0aGVcbiAgICogc2NoZWR1bGVkLWpvYiBgc2V0VGltZW91dGAuIEluIGBcInBvbGxpbmdcImAgbW9kZSB3ZSByZXN0b3JlIHRoZVxuICAgKiBsZWdhY3kgZml4ZWQtaW50ZXJ2YWwgcG9sbCBmb3IgdXNlcnMgd2hvIHdhbnQgdGhlIHByZXZpb3VzIGJlaGF2aW9yLlxuICAgKiBAcmV0dXJucyB7dm9pZH1cbiAgICovXG4gIF9zZXR1cERpc3BhdGNoVHJpZ2dlcnMoKSB7XG4gICAgaWYgKHRoaXMuZGlzcGF0Y2hTdHJhdGVneSA9PT0gXCJwb2xsaW5nXCIpIHtcbiAgICAgIHRoaXMuX3BvbGxUaW1lciA9IHNldEludGVydmFsKCgpID0+IHtcbiAgICAgICAgdm9pZCB0aGlzLl9yZXRyeUFmdGVyRXJyb3IoKVxuICAgICAgfSwgdGhpcy5wb2xsSW50ZXJ2YWxNcylcbiAgICAgIHJldHVyblxuICAgIH1cblxuICAgIGNvbnN0IGJlYWNvbkNsaWVudCA9IHRoaXMuY29uZmlndXJhdGlvbi5nZXRCZWFjb25DbGllbnQoKVxuICAgIGlmICghYmVhY29uQ2xpZW50KSByZXR1cm5cblxuICAgIHRoaXMuX2JlYWNvbkNsaWVudCA9IGJlYWNvbkNsaWVudFxuXG4gICAgdGhpcy5fdW5zdWJzY3JpYmVCZWFjb24gPSBiZWFjb25DbGllbnQub25Ccm9hZGNhc3QoKG1lc3NhZ2UpID0+IHtcbiAgICAgIGlmIChtZXNzYWdlPy5jaGFubmVsICE9PSBESVNQQVRDSF9DSEFOTkVMKSByZXR1cm5cbiAgICAgIHZvaWQgdGhpcy5fZHJhaW4oKVxuICAgIH0pXG5cbiAgICAvLyBEcmFpbiBvbiBldmVyeSAocmUpY29ubmVjdCB0byBjYXRjaCB1cCBvbiBqb2JzIGVucXVldWVkIHdoaWxlIHRoZVxuICAgIC8vIGJ1cyB3YXMgdW5yZWFjaGFibGUuIFRoZSBEQiBpcyB0aGUgZHVyYWJsZSBsb2c7IEJlYWNvbiBpcyBqdXN0IHRoZVxuICAgIC8vIHdha2UtdXAgc2lnbmFsLlxuICAgIHRoaXMuX2JlYWNvbkNvbm5lY3RIYW5kbGVyID0gKCkgPT4ge1xuICAgICAgdm9pZCB0aGlzLl9kcmFpbigpXG4gICAgfVxuICAgIGJlYWNvbkNsaWVudC5vbihcImNvbm5lY3RcIiwgdGhpcy5fYmVhY29uQ29ubmVjdEhhbmRsZXIpXG4gIH1cblxuICAvKipcbiAgICogQXJtcyB0aGUgYm91bmRlZCBhZG9wdGlvbiBncmFjZSBvbmx5IHdoZW4gc3RhcnR1cCBmb3VuZCBleGFjdCBwZXJzaXN0ZWRcbiAgICogaGFuZG9mZnMuIFRoZSB0aW1lciBpcyB1bnJlZmVkIHNvIGFuIG90aGVyd2lzZS1maW5pc2hlZCBwcm9jZXNzIGlzIG5ldmVyXG4gICAqIHJldGFpbmVkIHNvbGVseSB0byBwZXJmb3JtIHRoaXMgY2xlYW51cC5cbiAgICogQHJldHVybnMge3ZvaWR9XG4gICAqL1xuICBfc2V0dXBTdGFydHVwSGFuZG9mZlJlY2xhaW0oKSB7XG4gICAgaWYgKHRoaXMuc3RhcnR1cEhhbmRvZmZTbmFwc2hvdC5sZW5ndGggPT09IDApIHJldHVyblxuICAgIGlmICh0aGlzLl9zdGFydHVwSGFuZG9mZlJlY2xhaW1UaW1lciB8fCB0aGlzLl9zdGFydHVwSGFuZG9mZlJlY2xhaW1Qcm9taXNlIHx8IHRoaXMuX3N0YXJ0dXBIYW5kb2ZmR3JhY2VFbGFwc2VkKSByZXR1cm5cblxuICAgIHRoaXMuX3N0YXJ0dXBIYW5kb2ZmUmVjbGFpbVRpbWVyID0gdGhpcy5jbG9jay5zZXRUaW1lb3V0KCgpID0+IHtcbiAgICAgIHRoaXMuX3N0YXJ0dXBIYW5kb2ZmUmVjbGFpbVRpbWVyID0gdW5kZWZpbmVkXG4gICAgICB0aGlzLl9zdGFydHVwSGFuZG9mZkFkb3B0aW9uc0F0RGVhZGxpbmUgPSBbLi4udGhpcy5pbmZsaWdodFdvcmtlckhhbmRvZmZBZG9wdGlvbnNdXG4gICAgICB0aGlzLl9zdGFydHVwSGFuZG9mZkdyYWNlRWxhcHNlZCA9IHRydWVcbiAgICAgIHZvaWQgdGhpcy5fc3RhcnRTdGFydHVwSGFuZG9mZlJlY2xhaW0oKVxuICAgIH0sIHRoaXMud29ya2VyUmVjb25uZWN0R3JhY2VNcylcbiAgICBpZiAodHlwZW9mIHRoaXMuX3N0YXJ0dXBIYW5kb2ZmUmVjbGFpbVRpbWVyID09PSBcIm9iamVjdFwiKSB0aGlzLl9zdGFydHVwSGFuZG9mZlJlY2xhaW1UaW1lci51bnJlZigpXG4gIH1cblxuICAvKipcbiAgICogU3RhcnRzIG9uZSB0cmFja2VkIHN0YXJ0dXAtcmVjbGFpbSBwYXNzLCBjb2FsZXNjaW5nIGxpZmVjeWNsZSBhbmQgcmV0cnlcbiAgICogY2FsbGVycyBzbyBzaHV0ZG93biBjYW4gd2FpdCBmb3IgZHVyYWJsZSBtdXRhdGlvbiBiZWZvcmUgY2xvc2luZyBwb29scy5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgYWZ0ZXIgdGhpcyBwYXNzIHNldHRsZXMuXG4gICAqL1xuICBfc3RhcnRTdGFydHVwSGFuZG9mZlJlY2xhaW0oKSB7XG4gICAgaWYgKHRoaXMuX3N0YXJ0dXBIYW5kb2ZmUmVjbGFpbVByb21pc2UpIHJldHVybiB0aGlzLl9zdGFydHVwSGFuZG9mZlJlY2xhaW1Qcm9taXNlXG5cbiAgICBjb25zdCByZWNsYWltID0gdGhpcy5fcmVjbGFpbURpc2Nvbm5lY3RlZFN0YXJ0dXBIYW5kb2ZmcygpXG5cbiAgICB0aGlzLl9zdGFydHVwSGFuZG9mZlJlY2xhaW1Qcm9taXNlID0gcmVjbGFpbVxuICAgIGNvbnN0IGNsZWFyUmVjbGFpbSA9ICgpID0+IHtcbiAgICAgIGlmICh0aGlzLl9zdGFydHVwSGFuZG9mZlJlY2xhaW1Qcm9taXNlID09PSByZWNsYWltKSB7XG4gICAgICAgIHRoaXMuX3N0YXJ0dXBIYW5kb2ZmUmVjbGFpbVByb21pc2UgPSB1bmRlZmluZWRcbiAgICAgIH1cbiAgICB9XG4gICAgdm9pZCByZWNsYWltLnRoZW4oY2xlYXJSZWNsYWltLCBjbGVhclJlY2xhaW0pXG5cbiAgICByZXR1cm4gcmVjbGFpbVxuICB9XG5cbiAgLyoqXG4gICAqIFdhaXRzIGZvciBhbiBhbHJlYWR5LXN0YXJ0ZWQgc3RhcnR1cCByZWNsYWltIGJlZm9yZSBhZGFwdGVyIHNodXRkb3duLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyB3aGVuIG5vIHBhc3MgcmVtYWlucy5cbiAgICovXG4gIGFzeW5jIF9kcmFpblN0YXJ0dXBIYW5kb2ZmUmVjbGFpbSgpIHtcbiAgICB3aGlsZSAodGhpcy5fc3RhcnR1cEhhbmRvZmZSZWNsYWltUHJvbWlzZSkge1xuICAgICAgYXdhaXQgdGhpcy5fc3RhcnR1cEhhbmRvZmZSZWNsYWltUHJvbWlzZVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBPcnBoYW5zIG9ubHkgc3RhcnR1cC1zbmFwc2hvdHRlZCBsZWFzZXMgd2hvc2Ugc3RhYmxlIHdvcmtlciBpZCBoYXMgbm90IGJlZW5cbiAgICogb2JzZXJ2ZWQgYnkgdGhpcyBtYWluIGdlbmVyYXRpb24uIFN0b3JlIGZlbmNpbmcgcmVqZWN0cyBjb21wbGV0ZWQsXG4gICAqIHJldHVybmVkLCByZXBsYWNlZCwgYW5kIHJlLWhhbmRlZC1vZmYgcm93cy5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgYWZ0ZXIgcmVjbGFpbSBvciByZXRhaW5lZCByZXRyeSBzdGF0ZS5cbiAgICovXG4gIGFzeW5jIF9yZWNsYWltRGlzY29ubmVjdGVkU3RhcnR1cEhhbmRvZmZzKCkge1xuICAgIGlmICh0aGlzLl9zdG9wcGVkIHx8ICF0aGlzLl9zdGFydHVwSGFuZG9mZkdyYWNlRWxhcHNlZCkgcmV0dXJuXG4gICAgaWYgKHRoaXMuc3RhcnR1cEhhbmRvZmZTbmFwc2hvdC5sZW5ndGggPT09IDApIHJldHVyblxuXG4gICAgYXdhaXQgdGhpcy5fd2FpdEZvclN0YXJ0dXBIYW5kb2ZmQWRvcHRpb25zQXREZWFkbGluZSgpXG4gICAgaWYgKHRoaXMuX3N0b3BwZWQpIHJldHVyblxuXG4gICAgY29uc3QgaGFuZG9mZnMgPSB0aGlzLnN0YXJ0dXBIYW5kb2ZmU25hcHNob3QuZmlsdGVyKCh7d29ya2VySWR9KSA9PiAhdGhpcy5yZWNvbm5lY3RlZFdvcmtlcklkcy5oYXMod29ya2VySWQpKVxuXG4gICAgaWYgKGhhbmRvZmZzLmxlbmd0aCA9PT0gMCkge1xuICAgICAgdGhpcy5zdGFydHVwSGFuZG9mZlNuYXBzaG90ID0gW11cbiAgICAgIHRoaXMuX21heWJlU3RvcFJldGlyZWQoKVxuICAgICAgcmV0dXJuXG4gICAgfVxuXG4gICAgbGV0IG9ycGhhbmVkSm9ic1xuXG4gICAgdHJ5IHtcbiAgICAgIG9ycGhhbmVkSm9icyA9IGF3YWl0IHRoaXMuc3RvcmUubWFya09ycGhhbmVkSGFuZG9mZnMoe1xuICAgICAgICBlcnJvcjogXCJKb2Igb3JwaGFuZWQgYWZ0ZXIgaXRzIHByZS1yZXN0YXJ0IHdvcmtlciBkaWQgbm90IHJlY29ubmVjdFwiLFxuICAgICAgICBoYW5kb2Zmc1xuICAgICAgfSlcbiAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgdGhpcy5fcmVwb3J0U3RhcnR1cEhhbmRvZmZSZWNsYWltRXJyb3IoZXJyb3IpXG4gICAgICB0aGlzLl9zY2hlZHVsZUVycm9yUmV0cnkoKVxuICAgICAgcmV0dXJuXG4gICAgfVxuXG4gICAgdGhpcy5zdGFydHVwSGFuZG9mZlNuYXBzaG90ID0gW11cbiAgICBhd2FpdCB0aGlzLl9oYW5kbGVPcnBoYW5lZEpvYnMoe1xuICAgICAgam9iczogb3JwaGFuZWRKb2JzLFxuICAgICAgd2FybmluZzogXCJSZWNsYWltZWQgYmFja2dyb3VuZCBqb2JzIGZyb20gd29ya2VycyBhYnNlbnQgYWZ0ZXIgbWFpbiByZXN0YXJ0IGdyYWNlXCJcbiAgICB9KVxuICAgIHRoaXMub25TdGFydHVwSGFuZG9mZnNSZWNsYWltZWQ/LihvcnBoYW5lZEpvYnMpXG4gICAgdGhpcy5fbWF5YmVTdG9wUmV0aXJlZCgpXG4gIH1cblxuICAvKipcbiAgICogTGV0cyBhZG9wdGlvbiBxdWVyaWVzIGFscmVhZHkgcnVubmluZyBhdCB0aGUgcmVjb25uZWN0IGRlYWRsaW5lIHNldHRsZVxuICAgKiBiZWZvcmUgd29ya2VyIGlkcyBhcmUgZmlsdGVyZWQuIEEgc2Vjb25kIGJvdW5kZWQgZ3JhY2UgcHJldmVudHMgYSBzdHVja1xuICAgKiBhZGFwdGVyIHF1ZXJ5IGZyb20gZGVmZXJyaW5nIHN0YXJ0dXAgcmVjbGFpbSBmb3JldmVyLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyB3aGVuIHRoZSBkZWFkbGluZSBzZXQgc2V0dGxlcyBvciB0aW1lcyBvdXQuXG4gICAqL1xuICBhc3luYyBfd2FpdEZvclN0YXJ0dXBIYW5kb2ZmQWRvcHRpb25zQXREZWFkbGluZSgpIHtcbiAgICBjb25zdCBhZG9wdGlvbnMgPSB0aGlzLl9zdGFydHVwSGFuZG9mZkFkb3B0aW9uc0F0RGVhZGxpbmVcblxuICAgIHRoaXMuX3N0YXJ0dXBIYW5kb2ZmQWRvcHRpb25zQXREZWFkbGluZSA9IFtdXG4gICAgaWYgKGFkb3B0aW9ucy5sZW5ndGggPT09IDApIHJldHVyblxuXG4gICAgLyoqIEB0eXBlIHtSZXR1cm5UeXBlPHR5cGVvZiBzZXRUaW1lb3V0PiB8IHVuZGVmaW5lZH0gKi9cbiAgICBsZXQgdGltZXJcbiAgICBjb25zdCB3YWl0TGltaXQgPSBuZXcgUHJvbWlzZSgocmVzb2x2ZSkgPT4ge1xuICAgICAgLy8gVGhpcyBsaWZlY3ljbGUgZGVhZGxpbmUgbXVzdCBub3Qga2VlcCB0aGUgbWFpbiBwcm9jZXNzIGFsaXZlOyB0aGVcbiAgICAgIC8vIGdlbmVyaWMgdGltZW91dCBoZWxwZXIgaW50ZW50aW9uYWxseSB1c2VzIGEgcmVmZXJlbmNlZCB0aW1lci5cbiAgICAgIHRpbWVyID0gc2V0VGltZW91dChyZXNvbHZlLCB0aGlzLndvcmtlclJlY29ubmVjdEdyYWNlTXMpXG4gICAgICB0aW1lci51bnJlZigpXG4gICAgfSlcblxuICAgIHRyeSB7XG4gICAgICBhd2FpdCBQcm9taXNlLnJhY2UoW1Byb21pc2UuYWxsKGFkb3B0aW9ucyksIHdhaXRMaW1pdF0pXG4gICAgfSBmaW5hbGx5IHtcbiAgICAgIGlmICh0aW1lcikgY2xlYXJUaW1lb3V0KHRpbWVyKVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBQdWJsaXNoZXMgYSBkaXNwYXRjaCB3YWtlLXVwIG9uIHRoZSBCZWFjb24gY2hhbm5lbC4gTm8tb3AgaW4gcG9sbGluZ1xuICAgKiBtb2RlIG9yIHdoZW4gQmVhY29uIGlzIG5vdCBjb25uZWN0ZWQ7IGluIHRob3NlIGNhc2VzIHRoZSBkaXJlY3RcbiAgICogaW4tcHJvY2VzcyBgX2RyYWluKClgIGNhbGwgaW4gdGhlIGVucXVldWUvaGFuZGxlIHBhdGhzIGlzIHN1ZmZpY2llbnRcbiAgICogKHRoZXJlIGFyZSBubyBvdGhlciBwcm9jZXNzZXMgdG8gbm90aWZ5KS5cbiAgICogQHJldHVybnMge3ZvaWR9XG4gICAqL1xuICBfbm90aWZ5RW5xdWV1ZWQoKSB7XG4gICAgaWYgKHRoaXMuZGlzcGF0Y2hTdHJhdGVneSA9PT0gXCJwb2xsaW5nXCIpIHJldHVyblxuXG4gICAgY29uc3QgYmVhY29uQ2xpZW50ID0gdGhpcy5jb25maWd1cmF0aW9uLmdldEJlYWNvbkNsaWVudCgpXG4gICAgaWYgKCFiZWFjb25DbGllbnQgfHwgIWJlYWNvbkNsaWVudC5pc0Nvbm5lY3RlZCgpKSByZXR1cm5cblxuICAgIHRyeSB7XG4gICAgICBiZWFjb25DbGllbnQucHVibGlzaCh7XG4gICAgICAgIGNoYW5uZWw6IERJU1BBVENIX0NIQU5ORUwsXG4gICAgICAgIGJyb2FkY2FzdFBhcmFtczoge30sXG4gICAgICAgIGJvZHk6IHthY3Rpb246IFwid2FrZVwifVxuICAgICAgfSlcbiAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgdGhpcy5sb2dnZXIud2FybigoKSA9PiBbXCJGYWlsZWQgdG8gcHVibGlzaCBiYWNrZ3JvdW5kIGpvYnMgd2FrZSBicm9hZGNhc3Q6XCIsIGVycm9yXSlcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogUnVucyBoYW5kbGUgY29ubmVjdGlvbi5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCJuZXRcIikuU29ja2V0fSBzb2NrZXQgLSBTb2NrZXQuXG4gICAqIEByZXR1cm5zIHt2b2lkfVxuICAgKi9cbiAgX2hhbmRsZUNvbm5lY3Rpb24oc29ja2V0KSB7XG4gICAgY29uc3QganNvblNvY2tldCA9IG5ldyBKc29uU29ja2V0KHNvY2tldClcbiAgICB0aGlzLmNvbm5lY3Rpb25zLmFkZChqc29uU29ja2V0KVxuICAgIC8qKlxuICAgICAqIFJvbGUuXG4gICAgICogQHR5cGUge2ltcG9ydChcIi4vdHlwZXMuanNcIikuQmFja2dyb3VuZEpvYlNvY2tldFJvbGUgfCBudWxsfSAqL1xuICAgIGxldCByb2xlID0gbnVsbFxuXG4gICAgbGV0IGNsZWFuZWRVcCA9IGZhbHNlXG4gICAgY29uc3QgY2xlYW51cCA9ICgpID0+IHtcbiAgICAgIGlmIChjbGVhbmVkVXApIHJldHVyblxuICAgICAgY2xlYW5lZFVwID0gdHJ1ZVxuICAgICAgdGhpcy5jb25uZWN0aW9ucy5kZWxldGUoanNvblNvY2tldClcblxuICAgICAgaWYgKHJvbGUgPT09IFwid29ya2VyXCIpIHZvaWQgdGhpcy5faGFuZGxlV29ya2VyU29ja2V0Q2xvc2VkKGpzb25Tb2NrZXQpXG4gICAgICB0aGlzLl9tYXliZVN0b3BSZXRpcmVkKClcbiAgICB9XG5cbiAgICBqc29uU29ja2V0Lm9uKFwiY2xvc2VcIiwgY2xlYW51cClcbiAgICBqc29uU29ja2V0Lm9uKFwiZXJyb3JcIiwgKGVycm9yKSA9PiB7XG4gICAgICB0aGlzLmxvZ2dlci53YXJuKCgpID0+IFtcIkJhY2tncm91bmQgam9icyBjb25uZWN0aW9uIGVycm9yOlwiLCBlcnJvcl0pXG4gICAgICBjbGVhbnVwKClcbiAgICB9KVxuXG4gICAgbGV0IG1lc3NhZ2VIYW5kbGluZyA9IFByb21pc2UucmVzb2x2ZSgpXG4gICAganNvblNvY2tldC5vbihcIm1lc3NhZ2VcIiwgKG1lc3NhZ2UpID0+IHtcbiAgICAgIG1lc3NhZ2VIYW5kbGluZyA9IG1lc3NhZ2VIYW5kbGluZy50aGVuKGFzeW5jICgpID0+IHtcbiAgICAgICAgY29uc3QgZXhpc3RpbmdSb2xlID0gcm9sZVxuICAgICAgICByb2xlID0gYXdhaXQgdGhpcy5faGFuZGxlU29ja2V0TWVzc2FnZSh7anNvblNvY2tldCwgbWVzc2FnZSwgcm9sZX0pXG4gICAgICAgIGlmIChleGlzdGluZ1JvbGUgPT09IFwiY2xpZW50XCIgfHwgZXhpc3RpbmdSb2xlID09PSBcInJlcG9ydGVyXCIpIGpzb25Tb2NrZXQuY2xvc2UoKVxuICAgICAgfSkuY2F0Y2goKGVycm9yKSA9PiB7XG4gICAgICAgIHRoaXMuX3JlcG9ydENvbm5lY3Rpb25IYW5kbGVyRXJyb3IoZXJyb3IpXG4gICAgICAgIGpzb25Tb2NrZXQuY2xvc2UoKVxuICAgICAgfSlcbiAgICB9KVxuICB9XG5cbiAgLyoqXG4gICAqIFN1cmZhY2VzIGFuIHVuZXhwZWN0ZWQgcHJvdG9jb2wtaGFuZGxlciBmYWlsdXJlLlxuICAgKiBAcGFyYW0ge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSBlcnJvciAtIEhhbmRsZXIgZmFpbHVyZS5cbiAgICogQHJldHVybnMge3ZvaWR9XG4gICAqL1xuICBfcmVwb3J0Q29ubmVjdGlvbkhhbmRsZXJFcnJvcihlcnJvcikge1xuICAgIGNvbnN0IG5vcm1hbGl6ZWRFcnJvciA9IGVycm9yIGluc3RhbmNlb2YgRXJyb3IgPyBlcnJvciA6IG5ldyBFcnJvcihTdHJpbmcoZXJyb3IpKVxuICAgIGNvbnN0IHBheWxvYWQgPSB7Y29udGV4dDoge3N0YWdlOiBcImJhY2tncm91bmQtam9icy1zb2NrZXQtaGFuZGxlclwifSwgZXJyb3I6IG5vcm1hbGl6ZWRFcnJvcn1cbiAgICBjb25zdCBlcnJvckV2ZW50cyA9IHRoaXMuY29uZmlndXJhdGlvbi5nZXRFcnJvckV2ZW50cygpXG5cbiAgICB0aGlzLmxvZ2dlci5lcnJvcigoKSA9PiBbXCJCYWNrZ3JvdW5kIGpvYnMgc29ja2V0IGhhbmRsZXIgZmFpbGVkOlwiLCBub3JtYWxpemVkRXJyb3JdKVxuICAgIGVycm9yRXZlbnRzLmVtaXQoXCJmcmFtZXdvcmstZXJyb3JcIiwgcGF5bG9hZClcbiAgICBlcnJvckV2ZW50cy5lbWl0KFwiYWxsLWVycm9yXCIsIHsuLi5wYXlsb2FkLCBlcnJvclR5cGU6IFwiZnJhbWV3b3JrLWVycm9yXCJ9KVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgaGFuZGxlIHNvY2tldCBtZXNzYWdlLlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIE9wdGlvbnMuXG4gICAqIEBwYXJhbSB7SnNvblNvY2tldH0gYXJncy5qc29uU29ja2V0IC0gSlNPTiBzb2NrZXQuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi90eXBlcy5qc1wiKS5CYWNrZ3JvdW5kSm9iU29ja2V0TWVzc2FnZX0gYXJncy5tZXNzYWdlIC0gU29ja2V0IG1lc3NhZ2UuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi90eXBlcy5qc1wiKS5CYWNrZ3JvdW5kSm9iU29ja2V0Um9sZSB8IG51bGx9IGFyZ3Mucm9sZSAtIEN1cnJlbnQgc29ja2V0IHJvbGUuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPGltcG9ydChcIi4vdHlwZXMuanNcIikuQmFja2dyb3VuZEpvYlNvY2tldFJvbGUgfCBudWxsPn0gLSBVcGRhdGVkIHNvY2tldCByb2xlLlxuICAgKi9cbiAgYXN5bmMgX2hhbmRsZVNvY2tldE1lc3NhZ2Uoe2pzb25Tb2NrZXQsIG1lc3NhZ2UsIHJvbGV9KSB7XG4gICAgaWYgKCFyb2xlKSByZXR1cm4gYXdhaXQgdGhpcy5faGFuZGxlUm9sZWxlc3NTb2NrZXRNZXNzYWdlKHtqc29uU29ja2V0LCBtZXNzYWdlfSlcbiAgICBpZiAocm9sZSA9PT0gXCJ3b3JrZXJcIikge1xuICAgICAgYXdhaXQgdGhpcy5faGFuZGxlV29ya2VyU29ja2V0TWVzc2FnZSh7anNvblNvY2tldCwgbWVzc2FnZX0pXG4gICAgICByZXR1cm4gcm9sZVxuICAgIH1cblxuICAgIHRoaXMuX2FjdGl2ZU5vbldvcmtlclJlcXVlc3RzICs9IDFcbiAgICB0cnkge1xuICAgICAgaWYgKHJvbGUgPT09IFwiY2xpZW50XCIpIGF3YWl0IHRoaXMuX2hhbmRsZUNsaWVudFNvY2tldE1lc3NhZ2Uoe2pzb25Tb2NrZXQsIG1lc3NhZ2V9KVxuICAgICAgaWYgKHJvbGUgPT09IFwicmVwb3J0ZXJcIikgYXdhaXQgdGhpcy5faGFuZGxlUmVwb3J0ZXJTb2NrZXRNZXNzYWdlKHtqc29uU29ja2V0LCBtZXNzYWdlfSlcbiAgICB9IGZpbmFsbHkge1xuICAgICAgdGhpcy5fYWN0aXZlTm9uV29ya2VyUmVxdWVzdHMgLT0gMVxuICAgICAgdGhpcy5fbWF5YmVTdG9wUmV0aXJlZCgpXG4gICAgfVxuXG4gICAgcmV0dXJuIHJvbGVcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGhhbmRsZSByb2xlbGVzcyBzb2NrZXQgbWVzc2FnZS5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBPcHRpb25zLlxuICAgKiBAcGFyYW0ge0pzb25Tb2NrZXR9IGFyZ3MuanNvblNvY2tldCAtIEpTT04gc29ja2V0LlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vdHlwZXMuanNcIikuQmFja2dyb3VuZEpvYlNvY2tldE1lc3NhZ2V9IGFyZ3MubWVzc2FnZSAtIFNvY2tldCBtZXNzYWdlLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxpbXBvcnQoXCIuL3R5cGVzLmpzXCIpLkJhY2tncm91bmRKb2JTb2NrZXRSb2xlIHwgbnVsbD59IC0gTmV3IHNvY2tldCByb2xlLlxuICAgKi9cbiAgYXN5bmMgX2hhbmRsZVJvbGVsZXNzU29ja2V0TWVzc2FnZSh7anNvblNvY2tldCwgbWVzc2FnZX0pIHtcbiAgICBpZiAobWVzc2FnZT8udHlwZSAhPT0gXCJoZWxsb1wiKSByZXR1cm4gbnVsbFxuXG4gICAgY29uc3QgcmVqZWN0aW9uUmVhc29uID0gdGhpcy5fZ2VuZXJhdGlvbkhlbGxvUmVqZWN0aW9uUmVhc29uKG1lc3NhZ2UpXG5cbiAgICBpZiAocmVqZWN0aW9uUmVhc29uKSB7XG4gICAgICBqc29uU29ja2V0LnNlbmQoe3R5cGU6IFwiZ2VuZXJhdGlvbi1yZWplY3RlZFwiLCByZWFzb246IHJlamVjdGlvblJlYXNvbn0pXG4gICAgICBqc29uU29ja2V0LmNsb3NlKClcbiAgICAgIHJldHVybiBudWxsXG4gICAgfVxuXG4gICAgaWYgKG1lc3NhZ2Uucm9sZSA9PT0gXCJ3b3JrZXJcIikge1xuICAgICAgaWYgKHRoaXMuX3N0b3BwZWQpIHtcbiAgICAgICAganNvblNvY2tldC5jbG9zZSgpXG4gICAgICAgIHJldHVybiBtZXNzYWdlLnJvbGVcbiAgICAgIH1cblxuICAgICAgaWYgKCEoYXdhaXQgdGhpcy5fcmVnaXN0ZXJXb3JrZXIoe2pzb25Tb2NrZXQsIG1lc3NhZ2V9KSkpIHJldHVybiBudWxsXG4gICAgfVxuXG4gICAgaWYgKHRoaXMuZ2VuZXJhdGlvbklkKSB7XG4gICAgICBqc29uU29ja2V0LnNlbmQoe1xuICAgICAgICB0eXBlOiBcImdlbmVyYXRpb24tYWNjZXB0ZWRcIixcbiAgICAgICAgZ2VuZXJhdGlvbklkOiB0aGlzLmdlbmVyYXRpb25JZCxcbiAgICAgICAgbGlmZWN5Y2xlU3RhdGU6IHRoaXMubGlmZWN5Y2xlU3RhdGVcbiAgICAgIH0pXG4gICAgICBpZiAobWVzc2FnZS5yb2xlID09PSBcIndvcmtlclwiICYmICh0aGlzLmxpZmVjeWNsZVN0YXRlID09PSBcInJldGlyaW5nXCIgfHwgdGhpcy5saWZlY3ljbGVTdGF0ZSA9PT0gXCJyZXRpcmVkXCIpKSB7XG4gICAgICAgIGpzb25Tb2NrZXQuc2VuZCh7dHlwZTogXCJyZXRpcmVcIiwgZ2VuZXJhdGlvbklkOiB0aGlzLmdlbmVyYXRpb25JZH0pXG4gICAgICB9XG4gICAgfVxuXG4gICAgcmV0dXJuIG1lc3NhZ2Uucm9sZVxuICB9XG5cbiAgLyoqXG4gICAqIFZhbGlkYXRlcyB0aGUgZ2VuZXJhdGlvbiBmZW5jZSBiZWZvcmUgYXNzaWduaW5nIGEgc29ja2V0IHJvbGUuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi90eXBlcy5qc1wiKS5CYWNrZ3JvdW5kSm9iSGVsbG9NZXNzYWdlfSBtZXNzYWdlIC0gSGVsbG8gbWVzc2FnZS5cbiAgICogQHJldHVybnMge2ltcG9ydChcIi4vdHlwZXMuanNcIikuQmFja2dyb3VuZEpvYnNHZW5lcmF0aW9uUmVqZWN0aW9uUmVhc29uIHwgbnVsbH0gLSBSZWplY3Rpb24gcmVhc29uLlxuICAgKi9cbiAgX2dlbmVyYXRpb25IZWxsb1JlamVjdGlvblJlYXNvbihtZXNzYWdlKSB7XG4gICAgY29uc3QgbWVzc2FnZUhhc0dlbmVyYXRpb24gPSBPYmplY3QuaGFzT3duKG1lc3NhZ2UsIFwiZ2VuZXJhdGlvbklkXCIpXG5cbiAgICBpZiAoIXRoaXMuZ2VuZXJhdGlvbklkKSByZXR1cm4gbWVzc2FnZUhhc0dlbmVyYXRpb24gPyBcInVuZXhwZWN0ZWQtZ2VuZXJhdGlvblwiIDogbnVsbFxuICAgIGlmICghbWVzc2FnZUhhc0dlbmVyYXRpb24pIHJldHVybiBcIm1pc3NpbmctZ2VuZXJhdGlvblwiXG5cbiAgICB0cnkge1xuICAgICAgdmFsaWRhdGVHZW5lcmF0aW9uSWQobWVzc2FnZS5nZW5lcmF0aW9uSWQsIFwiaGVsbG8gZ2VuZXJhdGlvbklkXCIpXG4gICAgfSBjYXRjaCB7XG4gICAgICByZXR1cm4gXCJtYWxmb3JtZWQtZ2VuZXJhdGlvblwiXG4gICAgfVxuXG4gICAgaWYgKG1lc3NhZ2UuZ2VuZXJhdGlvbklkICE9PSB0aGlzLmdlbmVyYXRpb25JZCkgcmV0dXJuIFwiZ2VuZXJhdGlvbi1taXNtYXRjaFwiXG4gICAgaWYgKG1lc3NhZ2Uucm9sZSA9PT0gXCJ3b3JrZXJcIiAmJiAhd29ya2VySWRCZWxvbmdzVG9HZW5lcmF0aW9uKHtnZW5lcmF0aW9uSWQ6IHRoaXMuZ2VuZXJhdGlvbklkLCB3b3JrZXJJZDogbWVzc2FnZS53b3JrZXJJZH0pKSB7XG4gICAgICByZXR1cm4gXCJnZW5lcmF0aW9uLW1pc21hdGNoXCJcbiAgICB9XG5cbiAgICByZXR1cm4gbnVsbFxuICB9XG5cbiAgLyoqXG4gICAqIFJlZ2lzdGVycyBhIGdlbmVyYXRpb24tZmVuY2VkIHdvcmtlciBhbmQgdHJhbnNmZXJzIG9ubHkgaXRzIGV4YWN0IG93bmVyc2hpcC5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBXb3JrZXIgaGVsbG8uXG4gICAqIEBwYXJhbSB7SnNvblNvY2tldH0gYXJncy5qc29uU29ja2V0IC0gTmV3IHNvY2tldC5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL3R5cGVzLmpzXCIpLkJhY2tncm91bmRKb2JIZWxsb01lc3NhZ2V9IGFyZ3MubWVzc2FnZSAtIEhlbGxvLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxib29sZWFuPn0gLSBXaGV0aGVyIHRoZSB3b3JrZXIgd2FzIGFkbWl0dGVkLlxuICAgKi9cbiAgYXN5bmMgX3JlZ2lzdGVyV29ya2VyKHtqc29uU29ja2V0LCBtZXNzYWdlfSkge1xuICAgIGpzb25Tb2NrZXQud29ya2VySWQgPSBtZXNzYWdlLndvcmtlcklkXG4gICAganNvblNvY2tldC5zdXBwb3J0c0hhbmRvZmZJZFJlcG9ydGluZyA9IG1lc3NhZ2Uuc3VwcG9ydHNIYW5kb2ZmSWRSZXBvcnRpbmcgPT09IHRydWVcbiAgICBqc29uU29ja2V0LnN1cHBvcnRzSGVhcnRiZWF0ID0gbWVzc2FnZS5zdXBwb3J0c0hlYXJ0YmVhdCA9PT0gdHJ1ZVxuICAgIGpzb25Tb2NrZXQubGFzdFNlZW5BdCA9IHRoaXMuY2xvY2subm93KClcblxuICAgIGNvbnN0IHdvcmtlcklkID0ganNvblNvY2tldC53b3JrZXJJZFxuICAgIGNvbnN0IGRpc2Nvbm5lY3RlZCA9IHdvcmtlcklkID8gdGhpcy5kaXNjb25uZWN0ZWRXb3JrZXJzLmdldCh3b3JrZXJJZCkgOiB1bmRlZmluZWRcbiAgICBsZXQgaGFuZG9mZnMgPSBkaXNjb25uZWN0ZWQgPyB0aGlzLndvcmtlckhhbmRvZmZzLmdldChkaXNjb25uZWN0ZWQud29ya2VyKSA6IHVuZGVmaW5lZFxuICAgIGNvbnN0IHJlY292ZXJ5T25seSA9IHRoaXMubGlmZWN5Y2xlU3RhdGUgPT09IFwicmV0aXJpbmdcIiB8fCB0aGlzLmxpZmVjeWNsZVN0YXRlID09PSBcInJldGlyZWRcIlxuXG4gICAgaWYgKHJlY292ZXJ5T25seSAmJiAoIWhhbmRvZmZzIHx8IGhhbmRvZmZzLnNpemUgPT09IDApKSB7XG4gICAgICBpZiAoIXdvcmtlcklkKSByZXR1cm4gZmFsc2VcbiAgICAgIGNvbnN0IGR1cmFibGVIYW5kb2ZmcyA9IGF3YWl0IHRoaXMuc3RvcmUuaGFuZGVkT2ZmSm9ic0Zvcldvcmtlcih7d29ya2VySWR9KVxuXG4gICAgICBpZiAoZHVyYWJsZUhhbmRvZmZzLmxlbmd0aCA9PT0gMCkge1xuICAgICAgICBqc29uU29ja2V0LnNlbmQoe3R5cGU6IFwiZ2VuZXJhdGlvbi1yZWplY3RlZFwiLCByZWFzb246IFwid29ya2VyLWhhcy1uby1yZWNvdmVyYWJsZS1oYW5kb2Zmc1wifSlcbiAgICAgICAganNvblNvY2tldC5jbG9zZSgpXG4gICAgICAgIHJldHVybiBmYWxzZVxuICAgICAgfVxuXG4gICAgICBoYW5kb2ZmcyA9IG5ldyBNYXAoZHVyYWJsZUhhbmRvZmZzLm1hcCgoe2pvYklkLCBoYW5kb2ZmSWR9KSA9PiBbam9iSWQsIGhhbmRvZmZJZF0pKVxuICAgICAgdGhpcy5yZWNvbm5lY3RlZFdvcmtlcklkcy5hZGQod29ya2VySWQpXG4gICAgfVxuXG4gICAgaWYgKGRpc2Nvbm5lY3RlZCkge1xuICAgICAgdGhpcy5jbG9jay5jbGVhclRpbWVvdXQoZGlzY29ubmVjdGVkLnRpbWVyKVxuICAgICAgaWYgKHdvcmtlcklkKSB0aGlzLmRpc2Nvbm5lY3RlZFdvcmtlcnMuZGVsZXRlKHdvcmtlcklkKVxuICAgICAgdGhpcy53b3JrZXJIYW5kb2Zmcy5kZWxldGUoZGlzY29ubmVjdGVkLndvcmtlcilcbiAgICB9XG5cbiAgICB0aGlzLndvcmtlcnMuYWRkKGpzb25Tb2NrZXQpXG4gICAgdGhpcy53b3JrZXJIYW5kb2Zmcy5zZXQoanNvblNvY2tldCwgaGFuZG9mZnMgfHwgbmV3IE1hcCgpKVxuICAgIGlmIChyZWNvdmVyeU9ubHkpIGpzb25Tb2NrZXQuaXNEcmFpbmluZyA9IHRydWVcbiAgICBpZiAoIWhhbmRvZmZzICYmIHRoaXMubGlmZWN5Y2xlU3RhdGUgPT09IFwiYWN0aXZlXCIpIHRoaXMuX3RyYWNrV29ya2VySGFuZG9mZkFkb3B0aW9uKGpzb25Tb2NrZXQpXG5cbiAgICByZXR1cm4gdHJ1ZVxuICB9XG5cbiAgLyoqXG4gICAqIFRyYWNrcyBhIHdvcmtlciBoYW5kb2ZmLWFkb3B0aW9uIHF1ZXJ5IHRocm91Z2ggc2h1dGRvd24uXG4gICAqIEBwYXJhbSB7SnNvblNvY2tldH0ganNvblNvY2tldCAtIFJlY29ubmVjdGluZyB3b3JrZXIgc29ja2V0LlxuICAgKiBAcmV0dXJucyB7dm9pZH1cbiAgICovXG4gIF90cmFja1dvcmtlckhhbmRvZmZBZG9wdGlvbihqc29uU29ja2V0KSB7XG4gICAgY29uc3QgYWRvcHRpb24gPSB0aGlzLl9hZG9wdFdvcmtlckhhbmRvZmZzKGpzb25Tb2NrZXQpXG4gICAgdGhpcy5pbmZsaWdodFdvcmtlckhhbmRvZmZBZG9wdGlvbnMuYWRkKGFkb3B0aW9uKVxuICAgIGNvbnN0IHJlbW92ZUFkb3B0aW9uID0gKCkgPT4ge1xuICAgICAgdGhpcy5pbmZsaWdodFdvcmtlckhhbmRvZmZBZG9wdGlvbnMuZGVsZXRlKGFkb3B0aW9uKVxuICAgICAgdGhpcy5fbWF5YmVTdG9wUmV0aXJlZCgpXG4gICAgfVxuICAgIHZvaWQgYWRvcHRpb24udGhlbihyZW1vdmVBZG9wdGlvbiwgcmVtb3ZlQWRvcHRpb24pXG4gIH1cblxuICAvKipcbiAgICogV2FpdHMgZm9yIHdvcmtlciBoYW5kb2ZmLWFkb3B0aW9uIHF1ZXJpZXMgdG8gZmluaXNoLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyB3aGVuIG5vIGFkb3B0aW9uIHF1ZXJ5IHJlbWFpbnMuXG4gICAqL1xuICBhc3luYyBfZHJhaW5Xb3JrZXJIYW5kb2ZmQWRvcHRpb25zKCkge1xuICAgIHdoaWxlICh0aGlzLmluZmxpZ2h0V29ya2VySGFuZG9mZkFkb3B0aW9ucy5zaXplID4gMCkge1xuICAgICAgYXdhaXQgUHJvbWlzZS5hbGwoWy4uLnRoaXMuaW5mbGlnaHRXb3JrZXJIYW5kb2ZmQWRvcHRpb25zXSlcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogQWRvcHRzIGEgcmVjb25uZWN0aW5nIHdvcmtlcidzIHN0aWxsLWFjdGl2ZSBgaGFuZGVkX29mZmAgam9icyBpbnRvIGl0cyBuZXdcbiAgICogc29ja2V0J3MgaGFuZG9mZiBtYXAuIEEgZnJlc2ggbWFpbiAoZS5nLiBhZnRlciBhIGRlcGxveSByZXN0YXJ0KSBob2xkcyBub1xuICAgKiBpbi1tZW1vcnkgbGVhc2VzLCBzbyBhIHdvcmtlciB0aGF0IHJlY29ubmVjdHMgd2l0aCBpdHMgc3RhYmxlIGlkIHdvdWxkXG4gICAqIG90aGVyd2lzZSBoYXZlIGl0cyBwcmUtcmVzdGFydCBqb2JzIHRyYWNrZWQgbm93aGVyZSDigJQgaWYgaXQgdGhlbiBkaWVkLCB0aG9zZVxuICAgKiBsZWFzZXMgKGFuZCB0aGVpciBjb25jdXJyZW5jeSByZXNlcnZhdGlvbnMpIHdvdWxkIHNpdCBzdHVjayB1bnRpbCB0aGVcbiAgICogaG91cnMtbG9uZyBvcnBoYW4gc3dlZXAuIEFkb3B0aW5nIHRoZW0gbWVhbnMgYF9oYW5kbGVXb3JrZXJTb2NrZXRDbG9zZWRgXG4gICAqIHJlbGVhc2VzIHRoZW0gb24gdGhlIHdvcmtlcidzIG5leHQgZGlzY29ubmVjdCwgd2hpbGUgYSBzdGlsbC1ydW5uaW5nIHdvcmtlclxuICAgKiAoaW5jbHVkaW5nIG9uZSBncmFjZWZ1bGx5IGRyYWluaW5nKSBrZWVwcyBleGVjdXRpbmcgdGhlbSB1bnRvdWNoZWQuIE5vXG4gICAqIHRpbWUtYmFzZWQgcmVjbGFpbSBpcyB1c2VkLCBzbyBhIGRyYWluaW5nIHdvcmtlciB3aG9zZSBqb2JzIG91dGxpdmUgdGhlIG9sZFxuICAgKiBtYWluIGlzIG5ldmVyIHdyb25nbHkgcmVxdWV1ZWQgaW50byBhIGR1cGxpY2F0ZSBhdHRlbXB0LlxuICAgKiBAcGFyYW0ge0pzb25Tb2NrZXR9IGpzb25Tb2NrZXQgLSBUaGUgcmVjb25uZWN0ZWQgd29ya2VyIHNvY2tldC5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59XG4gICAqL1xuICBhc3luYyBfYWRvcHRXb3JrZXJIYW5kb2Zmcyhqc29uU29ja2V0KSB7XG4gICAgY29uc3Qgd29ya2VySWQgPSBqc29uU29ja2V0LndvcmtlcklkXG5cbiAgICBpZiAodHlwZW9mIHdvcmtlcklkICE9PSBcInN0cmluZ1wiIHx8IHdvcmtlcklkLmxlbmd0aCA9PT0gMCkgcmV0dXJuXG5cbiAgICB0cnkge1xuICAgICAgY29uc3QgaGFuZG9mZnMgPSBhd2FpdCB0aGlzLnN0b3JlLmhhbmRlZE9mZkpvYnNGb3JXb3JrZXIoe3dvcmtlcklkfSlcbiAgICAgIGNvbnN0IG1hcCA9IHRoaXMud29ya2VySGFuZG9mZnMuZ2V0KGpzb25Tb2NrZXQpXG5cbiAgICAgIC8vIFRoZSBzb2NrZXQgbWF5IGhhdmUgY2xvc2VkIHdoaWxlIHRoZSBxdWVyeSB3YXMgaW4gZmxpZ2h0OyBpdHMgbWFwIGlzIHRoZW5cbiAgICAgIC8vIGdvbmUgYW5kIHRoZSBqb2JzIGFyZSBsZWZ0IGZvciB0aGUgb3JwaGFuIHN3ZWVwIHJhdGhlciB0aGFuIHJlc3VycmVjdGVkLlxuICAgICAgaWYgKCFtYXAgfHwgIXRoaXMud29ya2Vycy5oYXMoanNvblNvY2tldCkpIHJldHVyblxuXG4gICAgICBmb3IgKGNvbnN0IHtqb2JJZCwgaGFuZG9mZklkfSBvZiBoYW5kb2Zmcykge1xuICAgICAgICBtYXAuc2V0KGpvYklkLCBoYW5kb2ZmSWQpXG4gICAgICB9XG4gICAgICB0aGlzLnJlY29ubmVjdGVkV29ya2VySWRzLmFkZCh3b3JrZXJJZClcbiAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgdGhpcy5fcmVwb3J0SGFuZG9mZkFkb3B0RXJyb3IoZXJyb3IpXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgaGFuZGxlIGNsaWVudCBzb2NrZXQgbWVzc2FnZS5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBPcHRpb25zLlxuICAgKiBAcGFyYW0ge0pzb25Tb2NrZXR9IGFyZ3MuanNvblNvY2tldCAtIEpTT04gc29ja2V0LlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vdHlwZXMuanNcIikuQmFja2dyb3VuZEpvYlNvY2tldE1lc3NhZ2V9IGFyZ3MubWVzc2FnZSAtIFNvY2tldCBtZXNzYWdlLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyBhZnRlciB0aGUgcmVxdWVzdCBpcyBhY2tub3dsZWRnZWQuXG4gICAqL1xuICBhc3luYyBfaGFuZGxlQ2xpZW50U29ja2V0TWVzc2FnZSh7anNvblNvY2tldCwgbWVzc2FnZX0pIHtcbiAgICBpZiAodGhpcy5nZW5lcmF0aW9uSWQgJiYgKHRoaXMubGlmZWN5Y2xlU3RhdGUgPT09IFwicmV0aXJpbmdcIiB8fCB0aGlzLmxpZmVjeWNsZVN0YXRlID09PSBcInJldGlyZWRcIikpIHtcbiAgICAgIGlmIChtZXNzYWdlPy50eXBlID09PSBcImVucXVldWVcIikganNvblNvY2tldC5zZW5kKHt0eXBlOiBcImVucXVldWUtZXJyb3JcIiwgZXJyb3I6IFwiQmFja2dyb3VuZCBqb2JzIGdlbmVyYXRpb24gaXMgcmV0aXJlZFwifSlcbiAgICAgIGlmIChtZXNzYWdlPy50eXBlID09PSBcInJlcGxhY2Utc2NoZWR1bGVkXCIpIGpzb25Tb2NrZXQuc2VuZCh7dHlwZTogXCJyZXBsYWNlLXNjaGVkdWxlZC1lcnJvclwiLCBlcnJvcjogXCJCYWNrZ3JvdW5kIGpvYnMgZ2VuZXJhdGlvbiBpcyByZXRpcmVkXCJ9KVxuICAgICAgaWYgKG1lc3NhZ2U/LnR5cGUgPT09IFwiY2FuY2VsLXNjaGVkdWxlZFwiKSBqc29uU29ja2V0LnNlbmQoe3R5cGU6IFwiY2FuY2VsLXNjaGVkdWxlZC1lcnJvclwiLCBlcnJvcjogXCJCYWNrZ3JvdW5kIGpvYnMgZ2VuZXJhdGlvbiBpcyByZXRpcmVkXCJ9KVxuICAgICAgcmV0dXJuXG4gICAgfVxuXG4gICAgaWYgKG1lc3NhZ2U/LnR5cGUgPT09IFwiZW5xdWV1ZVwiKSB7XG4gICAgICBhd2FpdCB0aGlzLl9oYW5kbGVFbnF1ZXVlKHtqc29uU29ja2V0LCBtZXNzYWdlfSlcbiAgICAgIHJldHVyblxuICAgIH1cblxuICAgIGlmIChtZXNzYWdlPy50eXBlID09PSBcInJlcGxhY2Utc2NoZWR1bGVkXCIpIHtcbiAgICAgIGF3YWl0IHRoaXMuX2hhbmRsZVJlcGxhY2VTY2hlZHVsZWQoe2pzb25Tb2NrZXQsIG1lc3NhZ2V9KVxuICAgICAgcmV0dXJuXG4gICAgfVxuXG4gICAgaWYgKG1lc3NhZ2U/LnR5cGUgPT09IFwiY2FuY2VsLXNjaGVkdWxlZFwiKSB7XG4gICAgICBhd2FpdCB0aGlzLl9oYW5kbGVDYW5jZWxTY2hlZHVsZWQoe2pzb25Tb2NrZXQsIG1lc3NhZ2V9KVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGhhbmRsZSB3b3JrZXIgc29ja2V0IG1lc3NhZ2UuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gT3B0aW9ucy5cbiAgICogQHBhcmFtIHtKc29uU29ja2V0fSBhcmdzLmpzb25Tb2NrZXQgLSBKU09OIHNvY2tldC5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL3R5cGVzLmpzXCIpLkJhY2tncm91bmRKb2JTb2NrZXRNZXNzYWdlfSBhcmdzLm1lc3NhZ2UgLSBTb2NrZXQgbWVzc2FnZS5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgYWZ0ZXIgdGhlIHdvcmtlciBtZXNzYWdlIGlzIGhhbmRsZWQuXG4gICAqL1xuICBhc3luYyBfaGFuZGxlV29ya2VyU29ja2V0TWVzc2FnZSh7anNvblNvY2tldCwgbWVzc2FnZX0pIHtcbiAgICAvLyBBbnkgbWVzc2FnZSBmcm9tIHRoZSB3b3JrZXIgcHJvdmVzIGl0IGlzIGFsaXZlOyB0aGUgbGl2ZW5lc3Mgc3dlZXAgdXNlc1xuICAgIC8vIHRoaXMgdG8gZGV0ZWN0IGEgd2VkZ2VkL3NpbGVudCB3b3JrZXIuXG4gICAganNvblNvY2tldC5sYXN0U2VlbkF0ID0gdGhpcy5jbG9jay5ub3coKVxuXG4gICAgaWYgKG1lc3NhZ2U/LnR5cGUgPT09IFwiaGVhcnRiZWF0XCIpIHtcbiAgICAgIHRoaXMub25Xb3JrZXJIZWFydGJlYXQ/Lihqc29uU29ja2V0KVxuICAgICAgcmV0dXJuXG4gICAgfVxuXG4gICAgaWYgKG1lc3NhZ2U/LnR5cGUgPT09IFwicmVhZHlcIikge1xuICAgICAgdGhpcy5faGFuZGxlV29ya2VyUmVhZHkoe2pzb25Tb2NrZXQsIG1lc3NhZ2V9KVxuICAgICAgcmV0dXJuXG4gICAgfVxuXG4gICAgaWYgKG1lc3NhZ2U/LnR5cGUgPT09IFwiZHJhaW5pbmdcIikge1xuICAgICAgdGhpcy5faGFuZGxlV29ya2VyRHJhaW5pbmcoe2pzb25Tb2NrZXR9KVxuICAgICAgcmV0dXJuXG4gICAgfVxuXG4gICAgYXdhaXQgdGhpcy5faGFuZGxlUmVwb3J0ZXJTb2NrZXRNZXNzYWdlKHtqc29uU29ja2V0LCBtZXNzYWdlfSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGhhbmRsZSByZXBvcnRlciBzb2NrZXQgbWVzc2FnZS5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBPcHRpb25zLlxuICAgKiBAcGFyYW0ge0pzb25Tb2NrZXR9IGFyZ3MuanNvblNvY2tldCAtIEpTT04gc29ja2V0LlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vdHlwZXMuanNcIikuQmFja2dyb3VuZEpvYlNvY2tldE1lc3NhZ2V9IGFyZ3MubWVzc2FnZSAtIFNvY2tldCBtZXNzYWdlLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyBhZnRlciB0aGUgcmVwb3J0IGlzIGFja25vd2xlZGdlZC5cbiAgICovXG4gIGFzeW5jIF9oYW5kbGVSZXBvcnRlclNvY2tldE1lc3NhZ2Uoe2pzb25Tb2NrZXQsIG1lc3NhZ2V9KSB7XG4gICAgaWYgKHRoaXMuZ2VuZXJhdGlvbklkICYmIHRoaXMuX2dlbmVyYXRpb25SZXBvcnRJc0ludmFsaWQobWVzc2FnZSkpIHtcbiAgICAgIGlmIChcImpvYklkXCIgaW4gbWVzc2FnZSAmJiB0eXBlb2YgbWVzc2FnZS5qb2JJZCA9PT0gXCJzdHJpbmdcIikge1xuICAgICAgICBqc29uU29ja2V0LnNlbmQoe3R5cGU6IFwiam9iLXVwZGF0ZS1lcnJvclwiLCBqb2JJZDogbWVzc2FnZS5qb2JJZCwgZXJyb3I6IFwiR2VuZXJhdGlvbiBvd25lcnNoaXAgcmVqZWN0ZWRcIn0pXG4gICAgICB9XG4gICAgICByZXR1cm5cbiAgICB9XG4gICAgaWYgKG1lc3NhZ2U/LnR5cGUgPT09IFwiam9iLWNvbXBsZXRlXCIpIHtcbiAgICAgIGF3YWl0IHRoaXMuX2hhbmRsZUpvYkNvbXBsZXRlKHtqc29uU29ja2V0LCBtZXNzYWdlfSlcbiAgICAgIHJldHVyblxuICAgIH1cblxuICAgIGlmIChtZXNzYWdlPy50eXBlID09PSBcImpvYi1mYWlsZWRcIikge1xuICAgICAgYXdhaXQgdGhpcy5faGFuZGxlSm9iRmFpbGVkKHtqc29uU29ja2V0LCBtZXNzYWdlfSlcbiAgICAgIHJldHVyblxuICAgIH1cblxuICAgIGlmIChtZXNzYWdlPy50eXBlID09PSBcImpvYi1yZXNjaGVkdWxlXCIpIHtcbiAgICAgIGF3YWl0IHRoaXMuX2hhbmRsZUpvYlJlc2NoZWR1bGUoe2pzb25Tb2NrZXQsIG1lc3NhZ2V9KVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBSZXF1aXJlcyB0aGUgY29tcGxldGUgZHVyYWJsZSBsZWFzZSBpZGVudGl0eSBiZWZvcmUgYSBnZW5lcmF0aW9uLW1vZGVcbiAgICogcmVwb3J0ZXIgY2FuIG11dGF0ZSBhIGpvYi4gTGVnYWN5IHJlcG9ydGVycyBrZWVwIHRoZWlyIHBlcm1pc3NpdmUgcHJvdG9jb2wuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi90eXBlcy5qc1wiKS5CYWNrZ3JvdW5kSm9iU29ja2V0TWVzc2FnZX0gbWVzc2FnZSAtIFJlcG9ydGVyIG1lc3NhZ2UuXG4gICAqIEByZXR1cm5zIHtib29sZWFufSAtIFdoZXRoZXIgdGhlIHJlcG9ydCBsYWNrcyBpdHMgZXhhY3QgZ2VuZXJhdGlvbiBsZWFzZS5cbiAgICovXG4gIF9nZW5lcmF0aW9uUmVwb3J0SXNJbnZhbGlkKG1lc3NhZ2UpIHtcbiAgICBpZiAobWVzc2FnZT8udHlwZSAhPT0gXCJqb2ItY29tcGxldGVcIiAmJiBtZXNzYWdlPy50eXBlICE9PSBcImpvYi1mYWlsZWRcIiAmJiBtZXNzYWdlPy50eXBlICE9PSBcImpvYi1yZXNjaGVkdWxlXCIpIHJldHVybiBmYWxzZVxuICAgIGNvbnN0IGdlbmVyYXRpb25JZCA9IHRoaXMuZ2VuZXJhdGlvbklkXG4gICAgaWYgKCFnZW5lcmF0aW9uSWQpIHJldHVybiBmYWxzZVxuXG4gICAgcmV0dXJuIHR5cGVvZiBtZXNzYWdlLmhhbmRvZmZJZCAhPT0gXCJzdHJpbmdcIlxuICAgICAgfHwgdHlwZW9mIG1lc3NhZ2UuaGFuZGVkT2ZmQXRNcyAhPT0gXCJudW1iZXJcIlxuICAgICAgfHwgIXdvcmtlcklkQmVsb25nc1RvR2VuZXJhdGlvbih7Z2VuZXJhdGlvbklkLCB3b3JrZXJJZDogbWVzc2FnZS53b3JrZXJJZH0pXG4gIH1cblxuICAvKipcbiAgICogUnVucyBoYW5kbGUgd29ya2VyIHJlYWR5LlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIE9wdGlvbnMuXG4gICAqIEBwYXJhbSB7SnNvblNvY2tldH0gYXJncy5qc29uU29ja2V0IC0gSlNPTiBzb2NrZXQuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi90eXBlcy5qc1wiKS5CYWNrZ3JvdW5kSm9iUmVhZHlNZXNzYWdlfSBhcmdzLm1lc3NhZ2UgLSBSZWFkeSBtZXNzYWdlLlxuICAgKiBAcmV0dXJucyB7dm9pZH1cbiAgICovXG4gIF9oYW5kbGVXb3JrZXJSZWFkeSh7anNvblNvY2tldCwgbWVzc2FnZX0pIHtcbiAgICBpZiAodGhpcy5saWZlY3ljbGVTdGF0ZSA9PT0gXCJyZXRpcmluZ1wiIHx8IHRoaXMubGlmZWN5Y2xlU3RhdGUgPT09IFwicmV0aXJlZFwiKSB7XG4gICAgICB0aGlzLnJlYWR5V29ya2Vycy5kZWxldGUoanNvblNvY2tldClcbiAgICAgIHRoaXMuY2FuZGlkYXRlUmVhZHlXb3JrZXJzLmRlbGV0ZShqc29uU29ja2V0KVxuICAgICAgcmV0dXJuXG4gICAgfVxuXG4gICAganNvblNvY2tldC5yZWFkaW5lc3NWZXJzaW9uICs9IDFcbiAgICBqc29uU29ja2V0LmFjY2VwdHNTcGF3bmVkSm9icyA9IG1lc3NhZ2UuYWNjZXB0c1NwYXduZWQgIT09IGZhbHNlICYmIG1lc3NhZ2UuYWNjZXB0c0ZvcmtlZCAhPT0gZmFsc2VcbiAgICBqc29uU29ja2V0LmFjY2VwdHNGb3JrZWRKb2JzID0gbWVzc2FnZS5hY2NlcHRzRm9ya2VkICE9PSBmYWxzZVxuICAgIGpzb25Tb2NrZXQuYWNjZXB0c1Bvb2xlZEpvYnMgPSBtZXNzYWdlLmFjY2VwdHNQb29sZWQgPT09IHRydWVcbiAgICBjb25zdCBhdmFpbGFibGVQb29sZWRTbG90cyA9IG1lc3NhZ2UuYXZhaWxhYmxlUG9vbGVkU2xvdHNcbiAgICBqc29uU29ja2V0LnVzZXNQb29sZWRDYXBhY2l0eUNyZWRpdHMgPSBOdW1iZXIuaXNJbnRlZ2VyKGF2YWlsYWJsZVBvb2xlZFNsb3RzKVxuICAgIGpzb25Tb2NrZXQuYXZhaWxhYmxlUG9vbGVkU2xvdHMgPSBOdW1iZXIuaXNJbnRlZ2VyKGF2YWlsYWJsZVBvb2xlZFNsb3RzKSAmJiBhdmFpbGFibGVQb29sZWRTbG90cyAhPT0gdW5kZWZpbmVkICYmIGF2YWlsYWJsZVBvb2xlZFNsb3RzID4gMFxuICAgICAgPyBhdmFpbGFibGVQb29sZWRTbG90c1xuICAgICAgOiAwXG4gICAganNvblNvY2tldC5hY2NlcHRzSW5saW5lSm9icyA9IG1lc3NhZ2UuYWNjZXB0c0lubGluZSAhPT0gZmFsc2VcbiAgICBpZiAodGhpcy5saWZlY3ljbGVTdGF0ZSA9PT0gXCJjYW5kaWRhdGVcIikge1xuICAgICAgdGhpcy5yZWFkeVdvcmtlcnMuZGVsZXRlKGpzb25Tb2NrZXQpXG4gICAgICBpZiAoIWpzb25Tb2NrZXQuaXNEcmFpbmluZykgdGhpcy5jYW5kaWRhdGVSZWFkeVdvcmtlcnMuYWRkKGpzb25Tb2NrZXQpXG4gICAgfSBlbHNlIGlmICh0aGlzLmxpZmVjeWNsZVN0YXRlID09PSBcImFjdGl2ZVwiICYmIHRoaXMuX2FjdGl2ZU93bmVyc2hpcFJlYWR5ICYmIGpzb25Tb2NrZXQuc3VwcG9ydHNIYW5kb2ZmSWRSZXBvcnRpbmcgJiYgIWpzb25Tb2NrZXQuaXNEcmFpbmluZykge1xuICAgICAgdGhpcy5yZWFkeVdvcmtlcnMuYWRkKGpzb25Tb2NrZXQpXG4gICAgfSBlbHNlIHtcbiAgICAgIHRoaXMucmVhZHlXb3JrZXJzLmRlbGV0ZShqc29uU29ja2V0KVxuICAgICAgdGhpcy5jYW5kaWRhdGVSZWFkeVdvcmtlcnMuZGVsZXRlKGpzb25Tb2NrZXQpXG4gICAgfVxuICAgIHRoaXMub25Xb3JrZXJSZWFkeT8uKGpzb25Tb2NrZXQpXG4gICAgdm9pZCB0aGlzLl9kcmFpbigpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBoYW5kbGUgd29ya2VyIGRyYWluaW5nLlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIE9wdGlvbnMuXG4gICAqIEBwYXJhbSB7SnNvblNvY2tldH0gYXJncy5qc29uU29ja2V0IC0gSlNPTiBzb2NrZXQuXG4gICAqIEByZXR1cm5zIHt2b2lkfVxuICAgKi9cbiAgX2hhbmRsZVdvcmtlckRyYWluaW5nKHtqc29uU29ja2V0fSkge1xuICAgIC8vIFRoZSB3b3JrZXIgaXMgc2h1dHRpbmcgZG93biBncmFjZWZ1bGx5LiBTdG9wIGRpc3BhdGNoaW5nIG5ldyBqb2JzXG4gICAgLy8gdG8gaXQgYnV0IGtlZXAgdGhlIGNvbm5lY3Rpb24gaW4gYHdvcmtlcnNgIHNvIGFueSBpbi1mbGlnaHQgam9iXG4gICAgLy8gaXQncyBzdGlsbCBkcmFpbmluZyBjYW4gcmVwb3J0IGl0cyByZXN1bHQuXG4gICAganNvblNvY2tldC5pc0RyYWluaW5nID0gdHJ1ZVxuICAgIHRoaXMucmVhZHlXb3JrZXJzLmRlbGV0ZShqc29uU29ja2V0KVxuICAgIHRoaXMuY2FuZGlkYXRlUmVhZHlXb3JrZXJzLmRlbGV0ZShqc29uU29ja2V0KVxuICB9XG5cbiAgLyoqXG4gICAqIFJlbW92ZXMgYSBsb3N0IHdvcmtlciBzb2NrZXQgYW5kIHJlbGVhc2VzIG9ubHkgbGVhc2VzIGRpc3BhdGNoZWQgdGhyb3VnaCBpdC5cbiAgICogQHBhcmFtIHtKc29uU29ja2V0fSB3b3JrZXIgLSBEaXNjb25uZWN0ZWQgd29ya2VyIHNvY2tldC5cbiAgICogQHBhcmFtIHtvYmplY3R9IFthcmdzXSAtIENvb3JkaW5hdGlvbiBvcHRpb25zLlxuICAgKiBAcGFyYW0ge2Jvb2xlYW59IFthcmdzLnF1ZXVlUmVkcmFpbl0gLSBRdWV1ZSBhbm90aGVyIHBhc3MgaW5zdGVhZCBvZiBhd2FpdGluZyB0aGUgYWN0aXZlIGRyYWluLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyBhZnRlciBpdHMgYWN0aXZlIGxlYXNlcyBhcmUgcmVsZWFzZWQuXG4gICAqL1xuICBhc3luYyBfaGFuZGxlV29ya2VyU29ja2V0Q2xvc2VkKHdvcmtlciwge3F1ZXVlUmVkcmFpbiA9IGZhbHNlfSA9IHt9KSB7XG4gICAgdGhpcy53b3JrZXJzLmRlbGV0ZSh3b3JrZXIpXG4gICAgdGhpcy5yZWFkeVdvcmtlcnMuZGVsZXRlKHdvcmtlcilcbiAgICB0aGlzLmNhbmRpZGF0ZVJlYWR5V29ya2Vycy5kZWxldGUod29ya2VyKVxuXG4gICAgaWYgKHRoaXMuX3N0b3BwZWQpIHtcbiAgICAgIHRoaXMud29ya2VySGFuZG9mZnMuZGVsZXRlKHdvcmtlcilcbiAgICAgIHJldHVyblxuICAgIH1cblxuICAgIGNvbnN0IGhhbmRvZmZzID0gdGhpcy53b3JrZXJIYW5kb2Zmcy5nZXQod29ya2VyKVxuICAgIGlmICh0aGlzLmdlbmVyYXRpb25JZCAmJiB3b3JrZXIud29ya2VySWQgJiYgaGFuZG9mZnMgJiYgaGFuZG9mZnMuc2l6ZSA+IDApIHtcbiAgICAgIGNvbnN0IGV4aXN0aW5nID0gdGhpcy5kaXNjb25uZWN0ZWRXb3JrZXJzLmdldCh3b3JrZXIud29ya2VySWQpXG4gICAgICBpZiAoZXhpc3Rpbmc/LndvcmtlciA9PT0gd29ya2VyKSByZXR1cm5cbiAgICAgIGlmIChleGlzdGluZykgdGhpcy5jbG9jay5jbGVhclRpbWVvdXQoZXhpc3RpbmcudGltZXIpXG5cbiAgICAgIGNvbnN0IHRpbWVyID0gdGhpcy5jbG9jay5zZXRUaW1lb3V0KCgpID0+IHtcbiAgICAgICAgdGhpcy5kaXNjb25uZWN0ZWRXb3JrZXJzLmRlbGV0ZSh3b3JrZXIud29ya2VySWQgfHwgXCJcIilcbiAgICAgICAgdm9pZCB0aGlzLl9yZWxlYXNlV29ya2VySGFuZG9mZnMod29ya2VyKS50aGVuKCgpID0+IHtcbiAgICAgICAgICBpZiAod29ya2VyLndvcmtlcklkKSB0aGlzLm9uV29ya2VySGFuZG9mZnNSZWxlYXNlZD8uKHdvcmtlci53b3JrZXJJZClcbiAgICAgICAgfSwgKGVycm9yKSA9PiB7XG4gICAgICAgICAgdGhpcy5fcmVwb3J0SGFuZG9mZlJlbGVhc2VFcnJvcihlcnJvcilcbiAgICAgICAgICB0aGlzLl9zY2hlZHVsZUVycm9yUmV0cnkoKVxuICAgICAgICB9KVxuICAgICAgfSwgdGhpcy53b3JrZXJSZWNvbm5lY3RHcmFjZU1zKVxuICAgICAgaWYgKHR5cGVvZiB0aW1lciA9PT0gXCJvYmplY3RcIikgdGltZXIudW5yZWYoKVxuICAgICAgdGhpcy5kaXNjb25uZWN0ZWRXb3JrZXJzLnNldCh3b3JrZXIud29ya2VySWQsIHt3b3JrZXIsIHRpbWVyfSlcbiAgICAgIHRoaXMub25Xb3JrZXJEaXNjb25uZWN0ZWQ/Lih3b3JrZXIud29ya2VySWQpXG4gICAgICByZXR1cm5cbiAgICB9XG5cbiAgICB0cnkge1xuICAgICAgYXdhaXQgdGhpcy5fcmVsZWFzZVdvcmtlckhhbmRvZmZzKHdvcmtlciwge3F1ZXVlUmVkcmFpbn0pXG4gICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgIHRoaXMuX3JlcG9ydEhhbmRvZmZSZWxlYXNlRXJyb3IoZXJyb3IpXG4gICAgICB0aGlzLl9zY2hlZHVsZUVycm9yUmV0cnkoKVxuICAgIH1cbiAgICB0aGlzLl9tYXliZVN0b3BSZXRpcmVkKClcbiAgfVxuXG4gIC8qKlxuICAgKiBSZWxlYXNlcyBhbGwgbGVhc2VzIHN0aWxsIG93bmVkIGJ5IG9uZSBleGFjdCB3b3JrZXIgc29ja2V0LlxuICAgKiBAcGFyYW0ge0pzb25Tb2NrZXR9IHdvcmtlciAtIFdvcmtlciBzb2NrZXQuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBbYXJnc10gLSBDb29yZGluYXRpb24gb3B0aW9ucy5cbiAgICogQHBhcmFtIHtib29sZWFufSBbYXJncy5xdWV1ZVJlZHJhaW5dIC0gUXVldWUgYW5vdGhlciBwYXNzIGluc3RlYWQgb2YgYXdhaXRpbmcgdGhlIGFjdGl2ZSBkcmFpbi5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgYWZ0ZXIgZmVuY2VkIHJlbGVhc2VzIGFuZCBkaXNwYXRjaCB3YWtlLXVwLlxuICAgKi9cbiAgYXN5bmMgX3JlbGVhc2VXb3JrZXJIYW5kb2Zmcyh3b3JrZXIsIHtxdWV1ZVJlZHJhaW4gPSBmYWxzZX0gPSB7fSkge1xuICAgIGNvbnN0IGhhbmRvZmZzID0gdGhpcy53b3JrZXJIYW5kb2Zmcy5nZXQod29ya2VyKVxuXG4gICAgaWYgKCFoYW5kb2ZmcyB8fCBoYW5kb2Zmcy5zaXplID09PSAwKSB7XG4gICAgICB0aGlzLndvcmtlckhhbmRvZmZzLmRlbGV0ZSh3b3JrZXIpXG4gICAgICByZXR1cm5cbiAgICB9XG5cbiAgICBmb3IgKGNvbnN0IFtqb2JJZCwgaGFuZG9mZklkXSBvZiBoYW5kb2Zmcykge1xuICAgICAgYXdhaXQgdGhpcy5fcmVsZWFzZUhhbmRvZmYoe2hhbmRvZmZJZCwgam9iSWQsIHdvcmtlcn0pXG4gICAgfVxuXG4gICAgdGhpcy53b3JrZXJIYW5kb2Zmcy5kZWxldGUod29ya2VyKVxuICAgIHRoaXMuX25vdGlmeUVucXVldWVkKClcbiAgICBpZiAocXVldWVSZWRyYWluKSB7XG4gICAgICB0aGlzLl9yZWRyYWluUXVldWVkID0gdHJ1ZVxuICAgIH0gZWxzZSB7XG4gICAgICBpZiAodGhpcy5saWZlY3ljbGVTdGF0ZSA9PT0gXCJhY3RpdmVcIikgYXdhaXQgdGhpcy5fZHJhaW4oKVxuICAgIH1cbiAgICB0aGlzLl9tYXliZVN0b3BSZXRpcmVkKClcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIG9uZSBpZGVtcG90ZW50IGNvbmRpdGlvbmFsIGxlYXNlIHJlbGVhc2UuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gT3B0aW9ucy5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGFyZ3MuaGFuZG9mZklkIC0gSGFuZG9mZiBsZWFzZSBpZC5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGFyZ3Muam9iSWQgLSBKb2IgaWQuXG4gICAqIEBwYXJhbSB7SnNvblNvY2tldH0gYXJncy53b3JrZXIgLSBTb2NrZXQgdGhhdCByZWNlaXZlZCB0aGUgbGVhc2UuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIGFmdGVyIHRoZSBmZW5jZWQgdHJhbnNpdGlvbi5cbiAgICovXG4gIGFzeW5jIF9yZWxlYXNlSGFuZG9mZih7aGFuZG9mZklkLCBqb2JJZCwgd29ya2VyfSkge1xuICAgIGF3YWl0IHRoaXMuc3RvcmUubWFya1JldHVybmVkVG9RdWV1ZSh7aGFuZG9mZklkLCBqb2JJZH0pXG5cbiAgICBjb25zdCBoYW5kb2ZmcyA9IHRoaXMud29ya2VySGFuZG9mZnMuZ2V0KHdvcmtlcilcblxuICAgIGlmIChoYW5kb2Zmcz8uZ2V0KGpvYklkKSA9PT0gaGFuZG9mZklkKSBoYW5kb2Zmcy5kZWxldGUoam9iSWQpXG4gIH1cblxuICAvKipcbiAgICogRm9yZ2V0cyBhIHN1Y2Nlc3NmdWxseSByZXBvcnRlZCBsZWFzZSB3aXRob3V0IHJlbHlpbmcgb24gd29ya2VyIGlkcy5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBPcHRpb25zLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gYXJncy5oYW5kb2ZmSWQgLSBIYW5kb2ZmIGxlYXNlIGlkLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gYXJncy5qb2JJZCAtIEpvYiBpZC5cbiAgICogQHJldHVybnMge3ZvaWR9XG4gICAqL1xuICBfZm9yZ2V0SGFuZG9mZih7aGFuZG9mZklkLCBqb2JJZH0pIHtcbiAgICBmb3IgKGNvbnN0IFt3b3JrZXIsIGhhbmRvZmZzXSBvZiB0aGlzLndvcmtlckhhbmRvZmZzKSB7XG4gICAgICBpZiAoaGFuZG9mZnMuZ2V0KGpvYklkKSAhPT0gaGFuZG9mZklkKSBjb250aW51ZVxuXG4gICAgICBoYW5kb2Zmcy5kZWxldGUoam9iSWQpXG4gICAgICBpZiAoaGFuZG9mZnMuc2l6ZSA9PT0gMCAmJiAhdGhpcy53b3JrZXJzLmhhcyh3b3JrZXIpKSB0aGlzLndvcmtlckhhbmRvZmZzLmRlbGV0ZSh3b3JrZXIpXG4gICAgICBpZiAoaGFuZG9mZnMuc2l6ZSA9PT0gMCAmJiB3b3JrZXIud29ya2VySWQpIHtcbiAgICAgICAgY29uc3QgZGlzY29ubmVjdGVkID0gdGhpcy5kaXNjb25uZWN0ZWRXb3JrZXJzLmdldCh3b3JrZXIud29ya2VySWQpXG4gICAgICAgIGlmIChkaXNjb25uZWN0ZWQ/LndvcmtlciA9PT0gd29ya2VyKSB7XG4gICAgICAgICAgdGhpcy5jbG9jay5jbGVhclRpbWVvdXQoZGlzY29ubmVjdGVkLnRpbWVyKVxuICAgICAgICAgIHRoaXMuZGlzY29ubmVjdGVkV29ya2Vycy5kZWxldGUod29ya2VyLndvcmtlcklkKVxuICAgICAgICB9XG4gICAgICB9XG4gICAgICB0aGlzLl9tYXliZVN0b3BSZXRpcmVkKClcbiAgICAgIHJldHVyblxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBSZXBvcnRzIGFuIHVuZXhwZWN0ZWQgbGVhc2UtcmVsZWFzZSBmYWlsdXJlIG9uIGZyYW1ld29yayBlcnJvciBjaGFubmVscy5cbiAgICogQHBhcmFtIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gZXJyb3IgLSBSZWxlYXNlIGZhaWx1cmUuXG4gICAqIEByZXR1cm5zIHt2b2lkfVxuICAgKi9cbiAgX3JlcG9ydEhhbmRvZmZSZWxlYXNlRXJyb3IoZXJyb3IpIHtcbiAgICBjb25zdCBub3JtYWxpemVkRXJyb3IgPSBlcnJvciBpbnN0YW5jZW9mIEVycm9yID8gZXJyb3IgOiBuZXcgRXJyb3IoU3RyaW5nKGVycm9yKSlcbiAgICBjb25zdCBwYXlsb2FkID0ge2NvbnRleHQ6IHtzdGFnZTogXCJiYWNrZ3JvdW5kLWpvYi1oYW5kb2ZmLXJlbGVhc2VcIn0sIGVycm9yOiBub3JtYWxpemVkRXJyb3J9XG4gICAgY29uc3QgZXJyb3JFdmVudHMgPSB0aGlzLmNvbmZpZ3VyYXRpb24uZ2V0RXJyb3JFdmVudHMoKVxuXG4gICAgdGhpcy5sb2dnZXIuZXJyb3IoKCkgPT4gW1wiRmFpbGVkIHRvIHJlbGVhc2UgZGlzY29ubmVjdGVkIHdvcmtlciBoYW5kb2ZmczpcIiwgbm9ybWFsaXplZEVycm9yXSlcbiAgICBlcnJvckV2ZW50cy5lbWl0KFwiZnJhbWV3b3JrLWVycm9yXCIsIHBheWxvYWQpXG4gICAgZXJyb3JFdmVudHMuZW1pdChcImFsbC1lcnJvclwiLCB7Li4ucGF5bG9hZCwgZXJyb3JUeXBlOiBcImZyYW1ld29yay1lcnJvclwifSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSZXBvcnRzIGFuIHVuZXhwZWN0ZWQgd29ya2VyLWhhbmRvZmYgYWRvcHRpb24gZmFpbHVyZSBvbiBmcmFtZXdvcmsgZXJyb3JcbiAgICogY2hhbm5lbHMuIEEgZmFpbGVkIGFkb3B0aW9uIGlzIG5vdCBmYXRhbCAodGhlIHdvcmtlcidzIGpvYnMgcmVtYWluIGFuZCBhcmVcbiAgICogcmVjbGFpbWVkIGJ5IHRoZSBvcnBoYW4gc3dlZXApLCBidXQgbXVzdCBzdXJmYWNlIHJhdGhlciB0aGFuIGJlIHN3YWxsb3dlZC5cbiAgICogQHBhcmFtIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gZXJyb3IgLSBBZG9wdGlvbiBmYWlsdXJlLlxuICAgKiBAcmV0dXJucyB7dm9pZH1cbiAgICovXG4gIF9yZXBvcnRIYW5kb2ZmQWRvcHRFcnJvcihlcnJvcikge1xuICAgIGNvbnN0IG5vcm1hbGl6ZWRFcnJvciA9IGVycm9yIGluc3RhbmNlb2YgRXJyb3IgPyBlcnJvciA6IG5ldyBFcnJvcihTdHJpbmcoZXJyb3IpKVxuICAgIGNvbnN0IHBheWxvYWQgPSB7Y29udGV4dDoge3N0YWdlOiBcImJhY2tncm91bmQtam9iLWhhbmRvZmYtYWRvcHRcIn0sIGVycm9yOiBub3JtYWxpemVkRXJyb3J9XG4gICAgY29uc3QgZXJyb3JFdmVudHMgPSB0aGlzLmNvbmZpZ3VyYXRpb24uZ2V0RXJyb3JFdmVudHMoKVxuXG4gICAgdGhpcy5sb2dnZXIuZXJyb3IoKCkgPT4gW1wiRmFpbGVkIHRvIGFkb3B0IHJlY29ubmVjdGVkIHdvcmtlciBoYW5kb2ZmczpcIiwgbm9ybWFsaXplZEVycm9yXSlcbiAgICBlcnJvckV2ZW50cy5lbWl0KFwiZnJhbWV3b3JrLWVycm9yXCIsIHBheWxvYWQpXG4gICAgZXJyb3JFdmVudHMuZW1pdChcImFsbC1lcnJvclwiLCB7Li4ucGF5bG9hZCwgZXJyb3JUeXBlOiBcImZyYW1ld29yay1lcnJvclwifSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSZXBvcnRzIGFuIHVuZXhwZWN0ZWQgc3RhcnR1cC1zbmFwc2hvdCByZWNsYWltIGZhaWx1cmUgd2hpbGUgcmV0YWluaW5nIHRoZVxuICAgKiBzbmFwc2hvdCBmb3IgdGhlIGRpc3BhdGNoZXIncyBleGlzdGluZyB0cmFuc2llbnQtZXJyb3IgcmV0cnkgbGlmZWN5Y2xlLlxuICAgKiBAcGFyYW0ge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSBlcnJvciAtIFJlY2xhaW0gZmFpbHVyZS5cbiAgICogQHJldHVybnMge3ZvaWR9XG4gICAqL1xuICBfcmVwb3J0U3RhcnR1cEhhbmRvZmZSZWNsYWltRXJyb3IoZXJyb3IpIHtcbiAgICBjb25zdCBub3JtYWxpemVkRXJyb3IgPSBlcnJvciBpbnN0YW5jZW9mIEVycm9yID8gZXJyb3IgOiBuZXcgRXJyb3IoU3RyaW5nKGVycm9yKSlcbiAgICBjb25zdCBwYXlsb2FkID0ge2NvbnRleHQ6IHtzdGFnZTogXCJiYWNrZ3JvdW5kLWpvYi1zdGFydHVwLWhhbmRvZmYtcmVjbGFpbVwifSwgZXJyb3I6IG5vcm1hbGl6ZWRFcnJvcn1cbiAgICBjb25zdCBlcnJvckV2ZW50cyA9IHRoaXMuY29uZmlndXJhdGlvbi5nZXRFcnJvckV2ZW50cygpXG5cbiAgICB0aGlzLmxvZ2dlci5lcnJvcigoKSA9PiBbXCJGYWlsZWQgdG8gcmVjbGFpbSBkaXNjb25uZWN0ZWQgc3RhcnR1cCBoYW5kb2ZmczpcIiwgbm9ybWFsaXplZEVycm9yXSlcbiAgICBlcnJvckV2ZW50cy5lbWl0KFwiZnJhbWV3b3JrLWVycm9yXCIsIHBheWxvYWQpXG4gICAgZXJyb3JFdmVudHMuZW1pdChcImFsbC1lcnJvclwiLCB7Li4ucGF5bG9hZCwgZXJyb3JUeXBlOiBcImZyYW1ld29yay1lcnJvclwifSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGhhbmRsZSBlbnF1ZXVlLlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIE9wdGlvbnMuXG4gICAqIEBwYXJhbSB7SnNvblNvY2tldH0gYXJncy5qc29uU29ja2V0IC0gSlNPTiBzb2NrZXQuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi90eXBlcy5qc1wiKS5CYWNrZ3JvdW5kSm9iRW5xdWV1ZU1lc3NhZ2V9IGFyZ3MubWVzc2FnZSAtIE1lc3NhZ2UuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIHdoZW4gaGFuZGxlZC5cbiAgICovXG4gIGFzeW5jIF9oYW5kbGVFbnF1ZXVlKHtqc29uU29ja2V0LCBtZXNzYWdlfSkge1xuICAgIHRyeSB7XG4gICAgICBjb25zdCBqb2JJZCA9IGF3YWl0IHRoaXMuc3RvcmUuZW5xdWV1ZSh7XG4gICAgICAgIGpvYk5hbWU6IG1lc3NhZ2Uuam9iTmFtZSxcbiAgICAgICAgYXJnczogbWVzc2FnZS5hcmdzIHx8IFtdLFxuICAgICAgICBvcHRpb25zOiBtZXNzYWdlLm9wdGlvbnMgfHwge31cbiAgICAgIH0pXG5cbiAgICAgIGpzb25Tb2NrZXQuc2VuZCh7dHlwZTogXCJlbnF1ZXVlZFwiLCBqb2JJZH0pXG4gICAgICB0aGlzLl9ub3RpZnlFbnF1ZXVlZCgpXG4gICAgICBhd2FpdCB0aGlzLl9kcmFpbigpXG4gICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgIHRoaXMuX2hhbmRsZUNsaWVudE11dGF0aW9uRXJyb3Ioe1xuICAgICAgICBjb250ZXh0OiB7am9iTmFtZTogbWVzc2FnZS5qb2JOYW1lLCBzdGFnZTogXCJiYWNrZ3JvdW5kLWpvYi1lbnF1ZXVlXCJ9LFxuICAgICAgICBlcnJvcixcbiAgICAgICAgZmFsbGJhY2tNZXNzYWdlOiBcIkZhaWxlZCB0byBlbnF1ZXVlIGpvYlwiLFxuICAgICAgICBqc29uU29ja2V0LFxuICAgICAgICBsb2dNZXNzYWdlOiBcIkZhaWxlZCB0byBlbnF1ZXVlIGJhY2tncm91bmQgam9iOlwiLFxuICAgICAgICByZXNwb25zZVR5cGU6IFwiZW5xdWV1ZS1lcnJvclwiXG4gICAgICB9KVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBIYW5kbGVzIGEgc3RhYmxlLWtleSByZXBsYWNlbWVudCByZXF1ZXN0IGFuZCByZS1hcm1zIGRpc3BhdGNoIGFmdGVyd2FyZC5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBPcHRpb25zLlxuICAgKiBAcGFyYW0ge0pzb25Tb2NrZXR9IGFyZ3MuanNvblNvY2tldCAtIEpTT04gc29ja2V0LlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vdHlwZXMuanNcIikuQmFja2dyb3VuZEpvYlJlcGxhY2VTY2hlZHVsZWRNZXNzYWdlfSBhcmdzLm1lc3NhZ2UgLSBNZXNzYWdlLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyB3aGVuIGhhbmRsZWQuXG4gICAqL1xuICBhc3luYyBfaGFuZGxlUmVwbGFjZVNjaGVkdWxlZCh7anNvblNvY2tldCwgbWVzc2FnZX0pIHtcbiAgICB0cnkge1xuICAgICAgY29uc3QgcmVzdWx0ID0gYXdhaXQgdGhpcy5zdG9yZS5yZXBsYWNlU2NoZWR1bGVkKHtcbiAgICAgICAgc2NoZWR1bGVLZXk6IG1lc3NhZ2Uuc2NoZWR1bGVLZXksXG4gICAgICAgIGpvYk5hbWU6IG1lc3NhZ2Uuam9iTmFtZSxcbiAgICAgICAgYXJnczogbWVzc2FnZS5hcmdzIHx8IFtdLFxuICAgICAgICBvcHRpb25zOiBtZXNzYWdlLm9wdGlvbnMgfHwge31cbiAgICAgIH0pXG5cbiAgICAgIHRoaXMuX25vdGlmeUVucXVldWVkKClcbiAgICAgIGF3YWl0IHRoaXMuX2RyYWluKClcbiAgICAgIGpzb25Tb2NrZXQuc2VuZCh7dHlwZTogXCJzY2hlZHVsZS1yZXBsYWNlZFwiLCAuLi5yZXN1bHR9KVxuICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICB0aGlzLl9oYW5kbGVDbGllbnRNdXRhdGlvbkVycm9yKHtcbiAgICAgICAgY29udGV4dDoge2pvYk5hbWU6IG1lc3NhZ2Uuam9iTmFtZSwgc2NoZWR1bGVLZXk6IG1lc3NhZ2Uuc2NoZWR1bGVLZXksIHN0YWdlOiBcImJhY2tncm91bmQtam9iLXJlcGxhY2Utc2NoZWR1bGVkXCJ9LFxuICAgICAgICBlcnJvcixcbiAgICAgICAgZmFsbGJhY2tNZXNzYWdlOiBcIkZhaWxlZCB0byByZXBsYWNlIHNjaGVkdWxlZCBqb2JcIixcbiAgICAgICAganNvblNvY2tldCxcbiAgICAgICAgbG9nTWVzc2FnZTogXCJGYWlsZWQgdG8gcmVwbGFjZSBzY2hlZHVsZWQgYmFja2dyb3VuZCBqb2I6XCIsXG4gICAgICAgIHJlc3BvbnNlVHlwZTogXCJyZXBsYWNlLXNjaGVkdWxlZC1lcnJvclwiXG4gICAgICB9KVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBIYW5kbGVzIGEgc3RhYmxlLWtleSBjYW5jZWxsYXRpb24gcmVxdWVzdCBhbmQgcmUtYXJtcyBkaXNwYXRjaCBhZnRlcndhcmQuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gT3B0aW9ucy5cbiAgICogQHBhcmFtIHtKc29uU29ja2V0fSBhcmdzLmpzb25Tb2NrZXQgLSBKU09OIHNvY2tldC5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL3R5cGVzLmpzXCIpLkJhY2tncm91bmRKb2JDYW5jZWxTY2hlZHVsZWRNZXNzYWdlfSBhcmdzLm1lc3NhZ2UgLSBNZXNzYWdlLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyB3aGVuIGhhbmRsZWQuXG4gICAqL1xuICBhc3luYyBfaGFuZGxlQ2FuY2VsU2NoZWR1bGVkKHtqc29uU29ja2V0LCBtZXNzYWdlfSkge1xuICAgIHRyeSB7XG4gICAgICBjb25zdCByZXN1bHQgPSBhd2FpdCB0aGlzLnN0b3JlLmNhbmNlbFNjaGVkdWxlZChtZXNzYWdlLnNjaGVkdWxlS2V5KVxuXG4gICAgICB0aGlzLl9ub3RpZnlFbnF1ZXVlZCgpXG4gICAgICBhd2FpdCB0aGlzLl9kcmFpbigpXG4gICAgICBqc29uU29ja2V0LnNlbmQoe3R5cGU6IFwic2NoZWR1bGUtY2FuY2VsbGVkXCIsIC4uLnJlc3VsdH0pXG4gICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgIHRoaXMuX2hhbmRsZUNsaWVudE11dGF0aW9uRXJyb3Ioe1xuICAgICAgICBjb250ZXh0OiB7c2NoZWR1bGVLZXk6IG1lc3NhZ2Uuc2NoZWR1bGVLZXksIHN0YWdlOiBcImJhY2tncm91bmQtam9iLWNhbmNlbC1zY2hlZHVsZWRcIn0sXG4gICAgICAgIGVycm9yLFxuICAgICAgICBmYWxsYmFja01lc3NhZ2U6IFwiRmFpbGVkIHRvIGNhbmNlbCBzY2hlZHVsZWQgam9iXCIsXG4gICAgICAgIGpzb25Tb2NrZXQsXG4gICAgICAgIGxvZ01lc3NhZ2U6IFwiRmFpbGVkIHRvIGNhbmNlbCBzY2hlZHVsZWQgYmFja2dyb3VuZCBqb2I6XCIsXG4gICAgICAgIHJlc3BvbnNlVHlwZTogXCJjYW5jZWwtc2NoZWR1bGVkLWVycm9yXCJcbiAgICAgIH0pXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIFJldHVybnMgc2FmZSB2YWxpZGF0aW9uIGZhaWx1cmVzIGFuZCByZXBvcnRzIHVuZXhwZWN0ZWQgY2xpZW50IG11dGF0aW9ucy5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBPcHRpb25zLlxuICAgKiBAcGFyYW0ge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gYXJncy5jb250ZXh0IC0gRnJhbWV3b3JrLWVycm9yIGNvbnRleHQuXG4gICAqIEBwYXJhbSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59IGFyZ3MuZXJyb3IgLSBNdXRhdGlvbiBmYWlsdXJlLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gYXJncy5mYWxsYmFja01lc3NhZ2UgLSBDbGllbnQtc2FmZSBmYWxsYmFjayBtZXNzYWdlLlxuICAgKiBAcGFyYW0ge0pzb25Tb2NrZXR9IGFyZ3MuanNvblNvY2tldCAtIEpTT04gc29ja2V0LlxuICAgKiBAcGFyYW0ge3N0cmluZ30gYXJncy5sb2dNZXNzYWdlIC0gRXJyb3IgbG9nIHByZWZpeC5cbiAgICogQHBhcmFtIHtcImVucXVldWUtZXJyb3JcIiB8IFwicmVwbGFjZS1zY2hlZHVsZWQtZXJyb3JcIiB8IFwiY2FuY2VsLXNjaGVkdWxlZC1lcnJvclwifSBhcmdzLnJlc3BvbnNlVHlwZSAtIFJlc3BvbnNlIHR5cGUuXG4gICAqIEByZXR1cm5zIHt2b2lkfVxuICAgKi9cbiAgX2hhbmRsZUNsaWVudE11dGF0aW9uRXJyb3Ioe2NvbnRleHQsIGVycm9yLCBmYWxsYmFja01lc3NhZ2UsIGpzb25Tb2NrZXQsIGxvZ01lc3NhZ2UsIHJlc3BvbnNlVHlwZX0pIHtcbiAgICBpZiAoZXJyb3IgaW5zdGFuY2VvZiBWZWxvY2lvdXNFcnJvciAmJiBlcnJvci5zYWZlVG9FeHBvc2UpIHtcbiAgICAgIGpzb25Tb2NrZXQuc2VuZCh7dHlwZTogcmVzcG9uc2VUeXBlLCBlcnJvcjogZXJyb3IubWVzc2FnZX0pXG4gICAgICByZXR1cm5cbiAgICB9XG5cbiAgICBjb25zdCBub3JtYWxpemVkRXJyb3IgPSBlcnJvciBpbnN0YW5jZW9mIEVycm9yID8gZXJyb3IgOiBuZXcgRXJyb3IoU3RyaW5nKGVycm9yKSlcbiAgICBjb25zdCBwYXlsb2FkID0ge2NvbnRleHQsIGVycm9yOiBub3JtYWxpemVkRXJyb3J9XG4gICAgY29uc3QgZXJyb3JFdmVudHMgPSB0aGlzLmNvbmZpZ3VyYXRpb24uZ2V0RXJyb3JFdmVudHMoKVxuXG4gICAgdGhpcy5sb2dnZXIuZXJyb3IoKCkgPT4gW2xvZ01lc3NhZ2UsIG5vcm1hbGl6ZWRFcnJvcl0pXG4gICAgZXJyb3JFdmVudHMuZW1pdChcImZyYW1ld29yay1lcnJvclwiLCBwYXlsb2FkKVxuICAgIGVycm9yRXZlbnRzLmVtaXQoXCJhbGwtZXJyb3JcIiwgey4uLnBheWxvYWQsIGVycm9yVHlwZTogXCJmcmFtZXdvcmstZXJyb3JcIn0pXG4gICAganNvblNvY2tldC5zZW5kKHt0eXBlOiByZXNwb25zZVR5cGUsIGVycm9yOiBmYWxsYmFja01lc3NhZ2V9KVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgaGFuZGxlIGpvYiBjb21wbGV0ZS5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBPcHRpb25zLlxuICAgKiBAcGFyYW0ge0pzb25Tb2NrZXR9IGFyZ3MuanNvblNvY2tldCAtIEpTT04gc29ja2V0LlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vdHlwZXMuanNcIikuQmFja2dyb3VuZEpvYkNvbXBsZXRlTWVzc2FnZX0gYXJncy5tZXNzYWdlIC0gTWVzc2FnZS5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgd2hlbiBoYW5kbGVkLlxuICAgKi9cbiAgYXN5bmMgX2hhbmRsZUpvYkNvbXBsZXRlKHtqc29uU29ja2V0LCBtZXNzYWdlfSkge1xuICAgIHRyeSB7XG4gICAgICBjb25zdCBhY2NlcHRlZCA9IGF3YWl0IHRoaXMuc3RvcmUubWFya0NvbXBsZXRlZCh7XG4gICAgICAgIGpvYklkOiBtZXNzYWdlLmpvYklkLFxuICAgICAgICBoYW5kb2ZmSWQ6IG1lc3NhZ2UuaGFuZG9mZklkLFxuICAgICAgICB3b3JrZXJJZDogbWVzc2FnZS53b3JrZXJJZCxcbiAgICAgICAgaGFuZGVkT2ZmQXRNczogbWVzc2FnZS5oYW5kZWRPZmZBdE1zXG4gICAgICB9KVxuICAgICAgaWYgKGFjY2VwdGVkICYmIG1lc3NhZ2UuaGFuZG9mZklkKSB7XG4gICAgICAgIHRoaXMuX2ZvcmdldEhhbmRvZmYoe2hhbmRvZmZJZDogbWVzc2FnZS5oYW5kb2ZmSWQsIGpvYklkOiBtZXNzYWdlLmpvYklkfSlcbiAgICAgIH1cbiAgICAgIHRoaXMub25Kb2JVcGRhdGVkPy4oe2FjY2VwdGVkLCBqb2JJZDogbWVzc2FnZS5qb2JJZCwgc3RhdHVzOiBcImNvbXBsZXRlZFwifSlcbiAgICAgIGpzb25Tb2NrZXQuc2VuZCh7dHlwZTogXCJqb2ItdXBkYXRlZFwiLCBqb2JJZDogbWVzc2FnZS5qb2JJZH0pXG4gICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgIHRoaXMuX3JlcG9ydEpvYlVwZGF0ZUZhaWx1cmUoe2Vycm9yLCBqb2JJZDogbWVzc2FnZS5qb2JJZCwgc3RhZ2U6IFwiYmFja2dyb3VuZC1qb2ItY29tcGxldGVcIn0pXG4gICAgICBqc29uU29ja2V0LnNlbmQoe3R5cGU6IFwiam9iLXVwZGF0ZS1lcnJvclwiLCBqb2JJZDogbWVzc2FnZS5qb2JJZCwgZXJyb3I6IFwiRmFpbGVkIHRvIHVwZGF0ZSBqb2JcIn0pXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIFN1cmZhY2VzIGFuIHVuZXhwZWN0ZWQgZHVyYWJsZSByZXBvcnQgZmFpbHVyZSB3aXRob3V0IGV4cG9zaW5nIGl0IHRvIHRoZVxuICAgKiByZXBvcnRpbmcgcGVlci5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBGYWlsdXJlIGNvbnRleHQuXG4gICAqIEBwYXJhbSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59IGFyZ3MuZXJyb3IgLSBBZGFwdGVyIGZhaWx1cmUuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBhcmdzLmpvYklkIC0gRHVyYWJsZSBqb2IgaWQuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBhcmdzLnN0YWdlIC0gTXV0YXRpb24gc3RhZ2UuXG4gICAqL1xuICBfcmVwb3J0Sm9iVXBkYXRlRmFpbHVyZSh7ZXJyb3IsIGpvYklkLCBzdGFnZX0pIHtcbiAgICBjb25zdCBub3JtYWxpemVkRXJyb3IgPSBlcnJvciBpbnN0YW5jZW9mIEVycm9yID8gZXJyb3IgOiBuZXcgRXJyb3IoU3RyaW5nKGVycm9yKSlcbiAgICBjb25zdCBwYXlsb2FkID0ge2NvbnRleHQ6IHtnZW5lcmF0aW9uSWQ6IHRoaXMuZ2VuZXJhdGlvbklkLCBqb2JJZCwgc3RhZ2V9LCBlcnJvcjogbm9ybWFsaXplZEVycm9yfVxuICAgIGNvbnN0IGVycm9yRXZlbnRzID0gdGhpcy5jb25maWd1cmF0aW9uLmdldEVycm9yRXZlbnRzKClcblxuICAgIHRoaXMubG9nZ2VyLmVycm9yKCgpID0+IFtcIkZhaWxlZCB0byB1cGRhdGUgYmFja2dyb3VuZCBqb2I6XCIsIG5vcm1hbGl6ZWRFcnJvcl0pXG4gICAgZXJyb3JFdmVudHMuZW1pdChcImZyYW1ld29yay1lcnJvclwiLCBwYXlsb2FkKVxuICAgIGVycm9yRXZlbnRzLmVtaXQoXCJhbGwtZXJyb3JcIiwgey4uLnBheWxvYWQsIGVycm9yVHlwZTogXCJmcmFtZXdvcmstZXJyb3JcIn0pXG4gIH1cblxuICAvKipcbiAgICogUGVyc2lzdHMgYSBub3JtYWwgam9iIHJlc2NoZWR1bGUgb3V0Y29tZSBhbmQgd2FrZXMgc2NoZWR1bGVkIGRpc3BhdGNoLlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIE9wdGlvbnMuXG4gICAqIEBwYXJhbSB7SnNvblNvY2tldH0gYXJncy5qc29uU29ja2V0IC0gSlNPTiBzb2NrZXQuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi90eXBlcy5qc1wiKS5CYWNrZ3JvdW5kSm9iUmVzY2hlZHVsZU1lc3NhZ2V9IGFyZ3MubWVzc2FnZSAtIE1lc3NhZ2UuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIHdoZW4gaGFuZGxlZC5cbiAgICovXG4gIGFzeW5jIF9oYW5kbGVKb2JSZXNjaGVkdWxlKHtqc29uU29ja2V0LCBtZXNzYWdlfSkge1xuICAgIHRyeSB7XG4gICAgICBjb25zdCBhY2NlcHRlZCA9IGF3YWl0IHRoaXMuc3RvcmUubWFya1Jlc2NoZWR1bGVkKHtcbiAgICAgICAgam9iSWQ6IG1lc3NhZ2Uuam9iSWQsXG4gICAgICAgIGRlbGF5TXM6IG1lc3NhZ2UuZGVsYXlNcyxcbiAgICAgICAgaGFuZG9mZklkOiBtZXNzYWdlLmhhbmRvZmZJZCxcbiAgICAgICAgd29ya2VySWQ6IG1lc3NhZ2Uud29ya2VySWQsXG4gICAgICAgIGhhbmRlZE9mZkF0TXM6IG1lc3NhZ2UuaGFuZGVkT2ZmQXRNc1xuICAgICAgfSlcbiAgICAgIGlmIChhY2NlcHRlZCAmJiBtZXNzYWdlLmhhbmRvZmZJZCkge1xuICAgICAgICB0aGlzLl9mb3JnZXRIYW5kb2ZmKHtoYW5kb2ZmSWQ6IG1lc3NhZ2UuaGFuZG9mZklkLCBqb2JJZDogbWVzc2FnZS5qb2JJZH0pXG4gICAgICB9XG4gICAgICB0aGlzLm9uSm9iVXBkYXRlZD8uKHthY2NlcHRlZCwgam9iSWQ6IG1lc3NhZ2Uuam9iSWQsIHN0YXR1czogXCJyZXNjaGVkdWxlZFwifSlcbiAgICAgIGpzb25Tb2NrZXQuc2VuZCh7dHlwZTogXCJqb2ItdXBkYXRlZFwiLCBqb2JJZDogbWVzc2FnZS5qb2JJZH0pXG4gICAgICB0aGlzLl9ub3RpZnlFbnF1ZXVlZCgpXG4gICAgICBhd2FpdCB0aGlzLl9kcmFpbigpXG4gICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgIGNvbnN0IG5vcm1hbGl6ZWRFcnJvciA9IGVycm9yIGluc3RhbmNlb2YgRXJyb3IgPyBlcnJvciA6IG5ldyBFcnJvcihTdHJpbmcoZXJyb3IpKVxuICAgICAgY29uc3QgcGF5bG9hZCA9IHtjb250ZXh0OiB7am9iSWQ6IG1lc3NhZ2Uuam9iSWQsIHN0YWdlOiBcImJhY2tncm91bmQtam9iLXJlc2NoZWR1bGVcIn0sIGVycm9yOiBub3JtYWxpemVkRXJyb3J9XG4gICAgICBjb25zdCBlcnJvckV2ZW50cyA9IHRoaXMuY29uZmlndXJhdGlvbi5nZXRFcnJvckV2ZW50cygpXG5cbiAgICAgIHRoaXMubG9nZ2VyLmVycm9yKCgpID0+IFtcIkZhaWxlZCB0byB1cGRhdGUgam9iIHJlc2NoZWR1bGU6XCIsIG5vcm1hbGl6ZWRFcnJvcl0pXG4gICAgICBlcnJvckV2ZW50cy5lbWl0KFwiZnJhbWV3b3JrLWVycm9yXCIsIHBheWxvYWQpXG4gICAgICBlcnJvckV2ZW50cy5lbWl0KFwiYWxsLWVycm9yXCIsIHsuLi5wYXlsb2FkLCBlcnJvclR5cGU6IFwiZnJhbWV3b3JrLWVycm9yXCJ9KVxuICAgICAganNvblNvY2tldC5zZW5kKHt0eXBlOiBcImpvYi11cGRhdGUtZXJyb3JcIiwgam9iSWQ6IG1lc3NhZ2Uuam9iSWQsIGVycm9yOiBcIkZhaWxlZCB0byB1cGRhdGUgam9iXCJ9KVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGhhbmRsZSBqb2IgZmFpbGVkLlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIE9wdGlvbnMuXG4gICAqIEBwYXJhbSB7SnNvblNvY2tldH0gYXJncy5qc29uU29ja2V0IC0gSlNPTiBzb2NrZXQuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi90eXBlcy5qc1wiKS5CYWNrZ3JvdW5kSm9iRmFpbGVkTWVzc2FnZX0gYXJncy5tZXNzYWdlIC0gTWVzc2FnZS5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgd2hlbiBoYW5kbGVkLlxuICAgKi9cbiAgYXN5bmMgX2hhbmRsZUpvYkZhaWxlZCh7anNvblNvY2tldCwgbWVzc2FnZX0pIHtcbiAgICB0cnkge1xuICAgICAgY29uc3QgZmFpbGVkSm9iID0gYXdhaXQgdGhpcy5zdG9yZS5tYXJrRmFpbGVkKHtcbiAgICAgICAgam9iSWQ6IG1lc3NhZ2Uuam9iSWQsXG4gICAgICAgIGVycm9yOiBtZXNzYWdlLmVycm9yLFxuICAgICAgICBoYW5kb2ZmSWQ6IG1lc3NhZ2UuaGFuZG9mZklkLFxuICAgICAgICB3b3JrZXJJZDogbWVzc2FnZS53b3JrZXJJZCxcbiAgICAgICAgaGFuZGVkT2ZmQXRNczogbWVzc2FnZS5oYW5kZWRPZmZBdE1zXG4gICAgICB9KVxuXG4gICAgICBpZiAoZmFpbGVkSm9iKSB7XG4gICAgICAgIGlmIChtZXNzYWdlLmhhbmRvZmZJZCkge1xuICAgICAgICAgIHRoaXMuX2ZvcmdldEhhbmRvZmYoe2hhbmRvZmZJZDogbWVzc2FnZS5oYW5kb2ZmSWQsIGpvYklkOiBtZXNzYWdlLmpvYklkfSlcbiAgICAgICAgfVxuICAgICAgICB0aGlzLl9lbWl0QmFja2dyb3VuZEpvYkZhaWxlZCh7XG4gICAgICAgICAgZXJyb3I6IG1lc3NhZ2UuZXJyb3IsXG4gICAgICAgICAgaGFuZG9mZklkOiBtZXNzYWdlLmhhbmRvZmZJZCxcbiAgICAgICAgICBoYW5kZWRPZmZBdE1zOiBtZXNzYWdlLmhhbmRlZE9mZkF0TXMsXG4gICAgICAgICAgam9iOiBmYWlsZWRKb2IsXG4gICAgICAgICAgd29ya2VySWQ6IG1lc3NhZ2Uud29ya2VySWRcbiAgICAgICAgfSlcbiAgICAgIH1cblxuICAgICAgdGhpcy5vbkpvYlVwZGF0ZWQ/Lih7YWNjZXB0ZWQ6IEJvb2xlYW4oZmFpbGVkSm9iKSwgam9iSWQ6IG1lc3NhZ2Uuam9iSWQsIHN0YXR1czogXCJmYWlsZWRcIn0pXG4gICAgICBqc29uU29ja2V0LnNlbmQoe3R5cGU6IFwiam9iLXVwZGF0ZWRcIiwgam9iSWQ6IG1lc3NhZ2Uuam9iSWR9KVxuICAgICAgLy8gQSBmYWlsZWQgam9iIG1heSBoYXZlIGJlZW4gcmUtcXVldWVkICh3aXRoIGJhY2tvZmYpIGZvciByZXRyeSDigJRcbiAgICAgIC8vIHBva2UgdGhlIGRpc3BhdGNoZXIgc28gdGhlIHJldHJ5IHRpbWVyIGlzIGFybWVkLlxuICAgICAgdGhpcy5fbm90aWZ5RW5xdWV1ZWQoKVxuICAgICAgYXdhaXQgdGhpcy5fZHJhaW4oKVxuICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICB0aGlzLmxvZ2dlci5lcnJvcigoKSA9PiBbXCJGYWlsZWQgdG8gdXBkYXRlIGpvYiBmYWlsdXJlOlwiLCBlcnJvcl0pXG4gICAgICBqc29uU29ja2V0LnNlbmQoe3R5cGU6IFwiam9iLXVwZGF0ZS1lcnJvclwiLCBqb2JJZDogbWVzc2FnZS5qb2JJZCwgZXJyb3I6IFwiRmFpbGVkIHRvIHVwZGF0ZSBqb2JcIn0pXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZW1pdCBiYWNrZ3JvdW5kIGpvYiBmYWlsZWQuXG4gICAqIEBwYXJhbSB7e2Vycm9yOiBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPiwgaGFuZG9mZklkPzogc3RyaW5nLCBoYW5kZWRPZmZBdE1zPzogbnVtYmVyLCBqb2I6IGltcG9ydChcIi4vdHlwZXMuanNcIikuQmFja2dyb3VuZEpvYlJvdywgd29ya2VySWQ/OiBzdHJpbmd9fSBhcmdzIC0gRmFpbHVyZSBldmVudCBkYXRhLlxuICAgKiBAcmV0dXJucyB7dm9pZH1cbiAgICovXG4gIF9lbWl0QmFja2dyb3VuZEpvYkZhaWxlZCh7ZXJyb3IsIGhhbmRvZmZJZCwgaGFuZGVkT2ZmQXRNcywgam9iLCB3b3JrZXJJZH0pIHtcbiAgICBjb25zdCBub3JtYWxpemVkRXJyb3IgPSB0aGlzLl9ub3JtYWxpemVGYWlsdXJlRXJyb3IoZXJyb3IpXG4gICAgY29uc3QgcGF5bG9hZCA9IHtcbiAgICAgIGNvbnRleHQ6IHtcbiAgICAgICAgYXR0ZW1wdHM6IGpvYi5hdHRlbXB0cyxcbiAgICAgICAgaGFuZG9mZklkLFxuICAgICAgICBoYW5kZWRPZmZBdE1zLFxuICAgICAgICBqb2JBcmdzOiBqb2IuYXJncyxcbiAgICAgICAgam9iSWQ6IGpvYi5pZCxcbiAgICAgICAgam9iTmFtZTogam9iLmpvYk5hbWUsXG4gICAgICAgIG1heFJldHJpZXM6IGpvYi5tYXhSZXRyaWVzLFxuICAgICAgICBzdGFnZTogXCJiYWNrZ3JvdW5kLWpvYi1mYWlsZWRcIixcbiAgICAgICAgc3RhdHVzOiBqb2Iuc3RhdHVzLFxuICAgICAgICB0ZXJtaW5hbDogam9iLnN0YXR1cyA9PT0gXCJmYWlsZWRcIiB8fCBqb2Iuc3RhdHVzID09PSBcIm9ycGhhbmVkXCIsXG4gICAgICAgIHdpbGxSZXRyeTogam9iLnN0YXR1cyA9PT0gXCJxdWV1ZWRcIixcbiAgICAgICAgd29ya2VySWRcbiAgICAgIH0sXG4gICAgICBlcnJvcjogbm9ybWFsaXplZEVycm9yXG4gICAgfVxuICAgIGNvbnN0IGVycm9yRXZlbnRzID0gdGhpcy5jb25maWd1cmF0aW9uLmdldEVycm9yRXZlbnRzKClcblxuICAgIGVycm9yRXZlbnRzLmVtaXQoXCJiYWNrZ3JvdW5kLWpvYi1mYWlsZWRcIiwgcGF5bG9hZClcbiAgICBlcnJvckV2ZW50cy5lbWl0KFwiYWxsLWVycm9yXCIsIHsuLi5wYXlsb2FkLCBlcnJvclR5cGU6IFwiYmFja2dyb3VuZC1qb2ItZmFpbGVkXCJ9KVxuICB9XG5cbiAgLyoqXG4gICAqIEVtaXRzIGBiYWNrZ3JvdW5kLWpvYi1vcnBoYW5lZGAgKG1pcnJvcmVkIHRvIGBhbGwtZXJyb3JgKSBmb3IgYSBqb2IgdGhlIHRpbWUtYmFzZWQgb3JwaGFuIHN3ZWVwXG4gICAqIHJlY2xhaW1lZCBhZnRlciBpdHMgd29ya2VyIGRpZWQgbWlkLXJ1bi4gVW5saWtlIGBiYWNrZ3JvdW5kLWpvYi1mYWlsZWRgLCB3aGljaCBmaXJlcyBvbiBhXG4gICAqIHdvcmtlcidzIGZhaWx1cmUgcmVwb3J0LCB0aGlzIGZpcmVzIGZyb20gdGhlIG1haW4gcHJvY2VzcydzIHN3ZWVwLCBzbyBhcHBsaWNhdGlvbnMgY2FuIHJlYWN0IHRvXG4gICAqIGEgZGVhZCB3b3JrZXIncyBzcGVjaWZpYyBqb2Ig4oCUIHJlY292ZXIgdGhlIHdvcmsgaXQgbGVmdCBiZWhpbmQg4oCUIHdpdGhvdXQgcG9sbGluZy4gYHdpbGxSZXRyeWBcbiAgICogcmVmbGVjdHMgd2hldGhlciB0aGUgcmVjbGFpbSByZXR1cm5lZCB0aGUgam9iIHRvIHRoZSBxdWV1ZSBmb3IgYW5vdGhlciBhdHRlbXB0LlxuICAgKiBAcGFyYW0ge3tqb2I6IGltcG9ydChcIi4vdHlwZXMuanNcIikuQmFja2dyb3VuZEpvYlJvd319IGFyZ3MgLSBUaGUgb3JwaGFuZWQgam9iLlxuICAgKiBAcmV0dXJucyB7dm9pZH1cbiAgICovXG4gIF9lbWl0QmFja2dyb3VuZEpvYk9ycGhhbmVkKHtqb2J9KSB7XG4gICAgY29uc3Qgbm9ybWFsaXplZEVycm9yID0gdGhpcy5fbm9ybWFsaXplRmFpbHVyZUVycm9yKGpvYi5sYXN0RXJyb3IgPz8gXCJKb2Igb3JwaGFuZWQgYWZ0ZXIgdGltZW91dFwiKVxuICAgIGNvbnN0IHBheWxvYWQgPSB7XG4gICAgICBjb250ZXh0OiB7XG4gICAgICAgIGF0dGVtcHRzOiBqb2IuYXR0ZW1wdHMsXG4gICAgICAgIGpvYkFyZ3M6IGpvYi5hcmdzLFxuICAgICAgICBqb2JJZDogam9iLmlkLFxuICAgICAgICBqb2JOYW1lOiBqb2Iuam9iTmFtZSxcbiAgICAgICAgbWF4UmV0cmllczogam9iLm1heFJldHJpZXMsXG4gICAgICAgIHN0YWdlOiBcImJhY2tncm91bmQtam9iLW9ycGhhbmVkXCIsXG4gICAgICAgIHN0YXR1czogam9iLnN0YXR1cyxcbiAgICAgICAgdGVybWluYWw6IGpvYi5zdGF0dXMgPT09IFwiZmFpbGVkXCIgfHwgam9iLnN0YXR1cyA9PT0gXCJvcnBoYW5lZFwiLFxuICAgICAgICB3aWxsUmV0cnk6IGpvYi5zdGF0dXMgPT09IFwicXVldWVkXCJcbiAgICAgIH0sXG4gICAgICBlcnJvcjogbm9ybWFsaXplZEVycm9yXG4gICAgfVxuICAgIGNvbnN0IGVycm9yRXZlbnRzID0gdGhpcy5jb25maWd1cmF0aW9uLmdldEVycm9yRXZlbnRzKClcblxuICAgIGVycm9yRXZlbnRzLmVtaXQoXCJiYWNrZ3JvdW5kLWpvYi1vcnBoYW5lZFwiLCBwYXlsb2FkKVxuICAgIGVycm9yRXZlbnRzLmVtaXQoXCJhbGwtZXJyb3JcIiwgey4uLnBheWxvYWQsIGVycm9yVHlwZTogXCJiYWNrZ3JvdW5kLWpvYi1vcnBoYW5lZFwifSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIG5vcm1hbGl6ZSBmYWlsdXJlIGVycm9yLlxuICAgKiBAcGFyYW0ge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSBlcnJvciAtIFJlcG9ydGVkIGZhaWx1cmUgdmFsdWUuXG4gICAqIEByZXR1cm5zIHtFcnJvcn0gTm9ybWFsaXplZCBlcnJvci5cbiAgICovXG4gIF9ub3JtYWxpemVGYWlsdXJlRXJyb3IoZXJyb3IpIHtcbiAgICBpZiAoZXJyb3IgaW5zdGFuY2VvZiBFcnJvcikgcmV0dXJuIGVycm9yXG5cbiAgICByZXR1cm4gdGhpcy5fZXJyb3JGcm9tVW5rbm93bkZhaWx1cmUoZXJyb3IpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBlcnJvciBmcm9tIHVua25vd24gZmFpbHVyZS5cbiAgICogQHBhcmFtIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gZXJyb3IgLSBSZXBvcnRlZCBmYWlsdXJlIHZhbHVlLlxuICAgKiBAcmV0dXJucyB7RXJyb3J9IE5vcm1hbGl6ZWQgZXJyb3IuXG4gICAqL1xuICBfZXJyb3JGcm9tVW5rbm93bkZhaWx1cmUoZXJyb3IpIHtcbiAgICBjb25zdCBtZXNzYWdlID0gdGhpcy5fbWVzc2FnZUZyb21Vbmtub3duRmFpbHVyZShlcnJvcilcbiAgICBjb25zdCBub3JtYWxpemVkRXJyb3IgPSBuZXcgRXJyb3IobWVzc2FnZSlcblxuICAgIHRoaXMuX2NvcHlTdHJpbmdGYWlsdXJlU3RhY2soe2Vycm9yLCBub3JtYWxpemVkRXJyb3J9KVxuXG4gICAgcmV0dXJuIG5vcm1hbGl6ZWRFcnJvclxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgbWVzc2FnZSBmcm9tIHVua25vd24gZmFpbHVyZS5cbiAgICogQHBhcmFtIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gZXJyb3IgLSBSZXBvcnRlZCBmYWlsdXJlIHZhbHVlLlxuICAgKiBAcmV0dXJucyB7c3RyaW5nfSBFcnJvciBtZXNzYWdlLlxuICAgKi9cbiAgX21lc3NhZ2VGcm9tVW5rbm93bkZhaWx1cmUoZXJyb3IpIHtcbiAgICBpZiAodGhpcy5faGFzU3RyaW5nRmFpbHVyZShlcnJvcikpIHJldHVybiBlcnJvci50cmltKCkuc3BsaXQoXCJcXG5cIilbMF1cblxuICAgIHJldHVybiBTdHJpbmcoZXJyb3IgfHwgXCJCYWNrZ3JvdW5kIGpvYiBmYWlsZWRcIilcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGhhcyBzdHJpbmcgZmFpbHVyZS5cbiAgICogQHBhcmFtIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gZXJyb3IgLSBSZXBvcnRlZCBmYWlsdXJlIHZhbHVlLlxuICAgKiBAcmV0dXJucyB7ZXJyb3IgaXMgc3RyaW5nfSBXaGV0aGVyIHRoZSB2YWx1ZSBpcyBhIG5vbi1lbXB0eSBzdHJpbmcuXG4gICAqL1xuICBfaGFzU3RyaW5nRmFpbHVyZShlcnJvcikge1xuICAgIHJldHVybiB0eXBlb2YgZXJyb3IgPT09IFwic3RyaW5nXCIgJiYgZXJyb3IudHJpbSgpLmxlbmd0aCA+IDBcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGNvcHkgc3RyaW5nIGZhaWx1cmUgc3RhY2suXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gT3B0aW9ucy5cbiAgICogQHBhcmFtIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gYXJncy5lcnJvciAtIFJlcG9ydGVkIGZhaWx1cmUgdmFsdWUuXG4gICAqIEBwYXJhbSB7RXJyb3J9IGFyZ3Mubm9ybWFsaXplZEVycm9yIC0gTm9ybWFsaXplZCBlcnJvci5cbiAgICogQHJldHVybnMge3ZvaWR9XG4gICAqL1xuICBfY29weVN0cmluZ0ZhaWx1cmVTdGFjayh7ZXJyb3IsIG5vcm1hbGl6ZWRFcnJvcn0pIHtcbiAgICBpZiAodGhpcy5faGFzU3RyaW5nRmFpbHVyZShlcnJvcikpIG5vcm1hbGl6ZWRFcnJvci5zdGFjayA9IGVycm9yXG4gIH1cblxuICAvKipcbiAgICogRHJhaW5zIGFsbCBkaXNwYXRjaGFibGUgam9icyB0byByZWFkeSB3b3JrZXJzLCB0aGVuIGFybXMgdGhlXG4gICAqIHNjaGVkdWxlZC1qb2IgdGltZXIgZm9yIHRoZSBuZXh0IGZ1dHVyZSBgc2NoZWR1bGVkX2F0X21zYC4gQ29hbGVzY2VzXG4gICAqIGNvbmN1cnJlbnQgdHJpZ2dlcnM6IGEgd2FrZS11cCB0aGF0IGxhbmRzIHdoaWxlIGEgZHJhaW4gaXMgaW5cbiAgICogZmxpZ2h0IGp1c3Qgc2V0cyBhIHJlLWRyYWluIGZsYWcgYW5kIGxldHMgdGhlIGluLWZsaWdodCBkcmFpblxuICAgKiByZS1sb29wIGFmdGVyIGl0IGZpbmlzaGVzLCBzbyBubyBzaWduYWwgaXMgZHJvcHBlZCBidXQgbm8gdHdvXG4gICAqIGRyYWlucyBydW4gaW4gcGFyYWxsZWwuXG4gICAqXG4gICAqIFJlc2lsaWVuY2U6IGluIGJlYWNvbiBtb2RlIHRoaXMgaXMgdGhlIHNvbGUgd2FrZS11cCBwYXRoIGZvclxuICAgKiBhbHJlYWR5LXF1ZXVlZCB3b3JrLCBzbyBhIHRyYW5zaWVudCBEQiBlcnJvciBkdXJpbmcgdGhlIGRyYWluIChlLmcuXG4gICAqIGBuZXh0QXZhaWxhYmxlSm9iKClgIHJlamVjdGluZykgbXVzdCBub3Qgc3RyYW5kIHRoZSBxdWV1ZSB1bnRpbCB0aGVcbiAgICogbmV4dCBleHRlcm5hbCBzaWduYWwuIE9uIGFueSBlcnJvciB3ZSBsb2cgaXQgYW5kIGFybSBhIG9uZS1zaG90XG4gICAqIHJldHJ5IHZpYSBgX3NjaGVkdWxlRXJyb3JSZXRyeWAgdXNpbmcgYHBvbGxJbnRlcnZhbE1zYCBhcyB0aGVcbiAgICogY2FkZW5jZTsgb24gc3VjY2VzcyB0aGUgcmV0cnkgdGltZXIgaXMgY2xlYXJlZC4gUG9sbGluZy1tb2RlIHJ1bnNcbiAgICogYF9kcmFpbmAgZnJvbSBpdHMgb3duIGludGVydmFsLCBzbyB0aGUgcmV0cnkgdGltZXIgaXMgYSBuby1vcCB0aGVyZS5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59XG4gICAqL1xuICBhc3luYyBfZHJhaW4oKSB7XG4gICAgaWYgKHRoaXMuX3N0b3BwZWQgfHwgdGhpcy5saWZlY3ljbGVTdGF0ZSAhPT0gXCJhY3RpdmVcIiB8fCAhdGhpcy5fYWN0aXZlT3duZXJzaGlwUmVhZHkpIHJldHVyblxuXG4gICAgaWYgKHRoaXMuX2RyYWluUHJvbWlzZSkge1xuICAgICAgdGhpcy5fcmVkcmFpblF1ZXVlZCA9IHRydWVcbiAgICAgIGF3YWl0IHRoaXMuX2RyYWluUHJvbWlzZVxuICAgICAgcmV0dXJuXG4gICAgfVxuXG4gICAgY29uc3QgZHJhaW5Qcm9taXNlID0gdGhpcy5fZHJhaW5Ub0NvbXBsZXRpb24oKVxuXG4gICAgdGhpcy5fZHJhaW5Qcm9taXNlID0gZHJhaW5Qcm9taXNlXG4gICAgYXdhaXQgZHJhaW5Qcm9taXNlXG4gIH1cblxuICAvKipcbiAgICogUnVucyBvbmUgc2VyaWFsaXplZCBkcmFpbiBsaWZlY3ljbGUsIGluY2x1ZGluZyB0aW1lciByZS1hcm1pbmcuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIGFmdGVyIGV2ZXJ5IGNvYWxlc2NlZCByZXF1ZXN0IGlzIGhhbmRsZWQuXG4gICAqL1xuICBhc3luYyBfZHJhaW5Ub0NvbXBsZXRpb24oKSB7XG4gICAgdGhpcy5fZHJhaW5pbmcgPSB0cnVlXG5cbiAgICB0cnkge1xuICAgICAgbGV0IGVycm9yZWRcblxuICAgICAgZG8ge1xuICAgICAgICBlcnJvcmVkID0gYXdhaXQgdGhpcy5fZHJhaW5VbnRpbElkbGUoKVxuICAgICAgICBhd2FpdCB0aGlzLl9maW5pc2hEcmFpbih7ZXJyb3JlZH0pXG4gICAgICB9IHdoaWxlICghZXJyb3JlZCAmJiB0aGlzLl9yZWRyYWluUXVldWVkICYmICF0aGlzLl9zdG9wcGVkICYmIHRoaXMubGlmZWN5Y2xlU3RhdGUgPT09IFwiYWN0aXZlXCIpXG4gICAgfSBmaW5hbGx5IHtcbiAgICAgIHRoaXMuX2RyYWluaW5nID0gZmFsc2VcbiAgICAgIHRoaXMuX2RyYWluUHJvbWlzZSA9IHVuZGVmaW5lZFxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGZpbmlzaCBkcmFpbi5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBPcHRpb25zLlxuICAgKiBAcGFyYW0ge2Jvb2xlYW59IGFyZ3MuZXJyb3JlZCAtIFdoZXRoZXIgdGhlIGRyYWluIGhpdCBhbiBlcnJvci5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgYWZ0ZXIgZm9sbG93LXVwIHRpbWVycyBhcmUgaGFuZGxlZC5cbiAgICovXG4gIGFzeW5jIF9maW5pc2hEcmFpbih7ZXJyb3JlZH0pIHtcbiAgICBpZiAodGhpcy5fc3RvcHBlZCB8fCB0aGlzLmxpZmVjeWNsZVN0YXRlICE9PSBcImFjdGl2ZVwiKSByZXR1cm5cbiAgICBpZiAoZXJyb3JlZCkgcmV0dXJuIHRoaXMuX3NjaGVkdWxlRXJyb3JSZXRyeSgpXG5cbiAgICBhd2FpdCB0aGlzLl9hcm1TY2hlZHVsZWRUaW1lck9yUmV0cnkoKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgYXJtIHNjaGVkdWxlZCB0aW1lciBvciByZXRyeS5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgYWZ0ZXIgc2NoZWR1bGVkIHRpbWVyIGhhbmRsaW5nLlxuICAgKi9cbiAgYXN5bmMgX2FybVNjaGVkdWxlZFRpbWVyT3JSZXRyeSgpIHtcbiAgICB0cnkge1xuICAgICAgYXdhaXQgdGhpcy5fYXJtU2NoZWR1bGVkVGltZXIoKVxuICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICB0aGlzLmxvZ2dlci5lcnJvcigoKSA9PiBbXCJCYWNrZ3JvdW5kIGpvYnMgc2NoZWR1bGVkLXRpbWVyIGFybWluZyBmYWlsZWQ6XCIsIGVycm9yXSlcbiAgICAgIHRoaXMuX3NjaGVkdWxlRXJyb3JSZXRyeSgpXG4gICAgICByZXR1cm5cbiAgICB9XG5cbiAgICB0aGlzLl9jbGVhckVycm9yUmV0cnlUaW1lcigpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBjbGVhciBlcnJvciByZXRyeSB0aW1lci5cbiAgICogQHJldHVybnMge3ZvaWR9ICovXG4gIF9jbGVhckVycm9yUmV0cnlUaW1lcigpIHtcbiAgICBpZiAodGhpcy5wZW5kaW5nSGFuZG9mZlJlY292ZXJpZXMuc2l6ZSA+IDApIHJldHVyblxuICAgIGlmICh0aGlzLl9zdGFydHVwSGFuZG9mZkdyYWNlRWxhcHNlZCAmJiB0aGlzLnN0YXJ0dXBIYW5kb2ZmU25hcHNob3QubGVuZ3RoID4gMCkgcmV0dXJuXG5cbiAgICBmb3IgKGNvbnN0IHdvcmtlciBvZiB0aGlzLndvcmtlckhhbmRvZmZzLmtleXMoKSkge1xuICAgICAgaWYgKCF0aGlzLndvcmtlcnMuaGFzKHdvcmtlcikpIHJldHVyblxuICAgIH1cblxuICAgIGlmICh0aGlzLl9lcnJvclJldHJ5VGltZXIpIHtcbiAgICAgIGNsZWFyVGltZW91dCh0aGlzLl9lcnJvclJldHJ5VGltZXIpXG4gICAgICB0aGlzLl9lcnJvclJldHJ5VGltZXIgPSB1bmRlZmluZWRcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogUnVucyBkcmFpbiB1bnRpbCBpZGxlLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxib29sZWFuPn0gLSBXaGV0aGVyIHRoZSBkcmFpbiBoaXQgYW4gZXJyb3IuXG4gICAqL1xuICBhc3luYyBfZHJhaW5VbnRpbElkbGUoKSB7XG4gICAgcmV0dXJuIGF3YWl0IHRoaXMuX3J1bkRyYWluTG9vcCgpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBydW4gZHJhaW4gbG9vcC5cbiAgICogQHJldHVybnMge1Byb21pc2U8Ym9vbGVhbj59IC0gV2hldGhlciB0aGUgZHJhaW4gaGl0IGFuIGVycm9yLlxuICAgKi9cbiAgYXN5bmMgX3J1bkRyYWluTG9vcCgpIHtcbiAgICBkbyB7XG4gICAgICB0aGlzLl9yZWRyYWluUXVldWVkID0gZmFsc2VcbiAgICAgIGNvbnN0IGVycm9yZWQgPSBhd2FpdCB0aGlzLl9kcmFpbk9uY2VXaXRoRXJyb3JSZXBvcnQoKVxuXG4gICAgICBpZiAoZXJyb3JlZCkgcmV0dXJuIHRydWVcbiAgICB9IHdoaWxlICh0aGlzLl9yZWRyYWluUXVldWVkICYmICF0aGlzLl9zdG9wcGVkKVxuXG4gICAgcmV0dXJuIGZhbHNlXG4gIH1cblxuICAvKipcbiAgICogUnVucyBkcmFpbiBvbmNlIHdpdGggZXJyb3IgcmVwb3J0LlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxib29sZWFuPn0gLSBXaGV0aGVyIG9uZSBkcmFpbiBwYXNzIGZhaWxlZC5cbiAgICovXG4gIGFzeW5jIF9kcmFpbk9uY2VXaXRoRXJyb3JSZXBvcnQoKSB7XG4gICAgdHJ5IHtcbiAgICAgIGF3YWl0IHRoaXMuX2RyYWluT25jZSgpXG4gICAgICByZXR1cm4gZmFsc2VcbiAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgdGhpcy5sb2dnZXIuZXJyb3IoKCkgPT4gW1wiQmFja2dyb3VuZCBqb2JzIGRyYWluIGZhaWxlZDpcIiwgZXJyb3JdKVxuICAgICAgcmV0dXJuIHRydWVcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogQXJtcyBhIG9uZS1zaG90IGBzZXRUaW1lb3V0YCB0byByZXRyeSBgX2RyYWluYCBhZnRlciBhIHRyYW5zaWVudFxuICAgKiBmYWlsdXJlLiBJZGVtcG90ZW50IOKAlCByZXBlYXRlZCBjYWxscyB3aGlsZSBhIHJldHJ5IGlzIGFscmVhZHlcbiAgICogcGVuZGluZyBhcmUgbm8tb3BzLiBQb2xsaW5nIG1vZGUgYWxyZWFkeSByZXRyaWVzIHZpYSBpdHMgb3duXG4gICAqIGludGVydmFsLCBzbyB0aGlzIGlzIGEgbm8tb3AgaW4gdGhhdCBtb2RlLlxuICAgKiBAcmV0dXJucyB7dm9pZH1cbiAgICovXG4gIF9zY2hlZHVsZUVycm9yUmV0cnkoKSB7XG4gICAgaWYgKHRoaXMuX3N0b3BwZWQpIHJldHVyblxuICAgIGlmICh0aGlzLl9lcnJvclJldHJ5VGltZXIpIHJldHVyblxuICAgIGlmICh0aGlzLmRpc3BhdGNoU3RyYXRlZ3kgPT09IFwicG9sbGluZ1wiICYmIHRoaXMubGlmZWN5Y2xlU3RhdGUgPT09IFwiYWN0aXZlXCIpIHJldHVyblxuXG4gICAgdGhpcy5fZXJyb3JSZXRyeVRpbWVyID0gc2V0VGltZW91dCgoKSA9PiB7XG4gICAgICB0aGlzLl9lcnJvclJldHJ5VGltZXIgPSB1bmRlZmluZWRcbiAgICAgIHZvaWQgdGhpcy5fcmV0cnlBZnRlckVycm9yKClcbiAgICB9LCB0aGlzLnBvbGxJbnRlcnZhbE1zKVxuICB9XG5cbiAgLyoqXG4gICAqIFJldHJpZXMgZmFpbGVkIHByZS1kaXNwYXRjaCBhbmQgZGlzY29ubmVjdGVkLXNvY2tldCByZWxlYXNlcyBiZWZvcmVcbiAgICogZHJhaW5pbmcgcXVldWVkIHdvcmsuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIGFmdGVyIHJldHJ5IHdvcmsuXG4gICAqL1xuICBhc3luYyBfcmV0cnlBZnRlckVycm9yKCkge1xuICAgIGlmICh0aGlzLl9zdG9wcGVkKSByZXR1cm5cblxuICAgIGlmICh0aGlzLl9zdGFydHVwSGFuZG9mZkdyYWNlRWxhcHNlZCAmJiB0aGlzLnN0YXJ0dXBIYW5kb2ZmU25hcHNob3QubGVuZ3RoID4gMCkge1xuICAgICAgYXdhaXQgdGhpcy5fc3RhcnRTdGFydHVwSGFuZG9mZlJlY2xhaW0oKVxuICAgICAgaWYgKHRoaXMuc3RhcnR1cEhhbmRvZmZTbmFwc2hvdC5sZW5ndGggPiAwKSByZXR1cm5cbiAgICB9XG5cbiAgICB0cnkge1xuICAgICAgYXdhaXQgdGhpcy5fcmV0cnlQZW5kaW5nSGFuZG9mZlJlY292ZXJpZXMoKVxuICAgIH0gY2F0Y2gge1xuICAgICAgdGhpcy5fc2NoZWR1bGVFcnJvclJldHJ5KClcbiAgICAgIHJldHVyblxuICAgIH1cblxuICAgIHRyeSB7XG4gICAgICBmb3IgKGNvbnN0IHdvcmtlciBvZiB0aGlzLndvcmtlckhhbmRvZmZzLmtleXMoKSkge1xuICAgICAgICBpZiAoIXRoaXMud29ya2Vycy5oYXMod29ya2VyKSkgYXdhaXQgdGhpcy5fcmVsZWFzZVdvcmtlckhhbmRvZmZzKHdvcmtlcilcbiAgICAgIH1cbiAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgdGhpcy5fcmVwb3J0SGFuZG9mZlJlbGVhc2VFcnJvcihlcnJvcilcbiAgICAgIHRoaXMuX3NjaGVkdWxlRXJyb3JSZXRyeSgpXG4gICAgICByZXR1cm5cbiAgICB9XG5cbiAgICBpZiAodGhpcy5saWZlY3ljbGVTdGF0ZSA9PT0gXCJhY3RpdmVcIikgYXdhaXQgdGhpcy5fZHJhaW4oKVxuICAgIHRoaXMuX21heWJlU3RvcFJldGlyZWQoKVxuICB9XG5cbiAgLyoqXG4gICAqIElubmVyIGRyYWluIGxvb3A6IHB1bGxzIGVsaWdpYmxlIHF1ZXVlZCBqb2JzIGFuZCBoYW5kcyB0aGVtIG9mZiB0b1xuICAgKiByZWFkeSB3b3JrZXJzIHVudGlsIG9uZSBvZiB0aGVtIHJ1bnMgb3V0LlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn1cbiAgICovXG4gIGFzeW5jIF9kcmFpbk9uY2UoKSB7XG4gICAgd2hpbGUgKHRoaXMucmVhZHlXb3JrZXJzLnNpemUgPiAwICYmICF0aGlzLl9zdG9wcGVkICYmIHRoaXMubGlmZWN5Y2xlU3RhdGUgPT09IFwiYWN0aXZlXCIgJiYgdGhpcy5fYWN0aXZlT3duZXJzaGlwUmVhZHkpIHtcbiAgICAgIGNvbnN0IGpvYiA9IGF3YWl0IHRoaXMubmV4dEF2YWlsYWJsZUpvYkZvclJlYWR5V29ya2VycygpXG4gICAgICBpZiAoIWpvYikgcmV0dXJuXG5cbiAgICAgIGNvbnN0IHdvcmtlciA9IHRoaXMucmVhZHlXb3JrZXJGb3JKb2Ioam9iKVxuICAgICAgaWYgKCF3b3JrZXIpIHJldHVyblxuXG4gICAgICBjb25zdCBhZG1pc3Npb24gPSB0aGlzLl9jb25zdW1lV29ya2VyQWRtaXNzaW9uKHtqb2IsIHdvcmtlcn0pXG4gICAgICBjb25zdCByZXF1ZXN0ZWRIYW5kb2ZmSWQgPSByYW5kb21VVUlEKClcbiAgICAgIGxldCBoYW5kb2ZmXG5cbiAgICAgIHRyeSB7XG4gICAgICAgIGhhbmRvZmYgPSBhd2FpdCB0aGlzLnN0b3JlLm1hcmtIYW5kZWRPZmYoe2hhbmRvZmZJZDogcmVxdWVzdGVkSGFuZG9mZklkLCBqb2JJZDogam9iLmlkLCB3b3JrZXJJZDogd29ya2VyLndvcmtlcklkfSlcbiAgICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICAgIHRoaXMuX3JlbWVtYmVySGFuZG9mZlJlY292ZXJ5KHtoYW5kb2ZmSWQ6IHJlcXVlc3RlZEhhbmRvZmZJZCwgam9iSWQ6IGpvYi5pZH0pXG4gICAgICAgIHRoaXMuX3Jlc3RvcmVXb3JrZXJBZG1pc3Npb24oey4uLmFkbWlzc2lvbiwgd29ya2VyfSlcblxuICAgICAgICB0cnkge1xuICAgICAgICAgIGF3YWl0IHRoaXMuX3JlY292ZXJIYW5kb2ZmKHtoYW5kb2ZmSWQ6IHJlcXVlc3RlZEhhbmRvZmZJZCwgam9iSWQ6IGpvYi5pZH0pXG4gICAgICAgIH0gY2F0Y2ggKHJlY292ZXJ5RXJyb3IpIHtcbiAgICAgICAgICB0aGlzLl9yZXBvcnRIYW5kb2ZmUmVjb3ZlcnlFcnJvcih7ZXJyb3I6IHJlY292ZXJ5RXJyb3IsIGhhbmRvZmZJZDogcmVxdWVzdGVkSGFuZG9mZklkLCBqb2JJZDogam9iLmlkfSlcbiAgICAgICAgfVxuXG4gICAgICAgIHRocm93IGVycm9yXG4gICAgICB9XG5cbiAgICAgIGlmICghaGFuZG9mZikge1xuICAgICAgICB0aGlzLl9yZXN0b3JlV29ya2VyQWRtaXNzaW9uKHsuLi5hZG1pc3Npb24sIHdvcmtlcn0pXG4gICAgICAgIGNvbnRpbnVlXG4gICAgICB9XG5cbiAgICAgIGF3YWl0IHRoaXMuYWZ0ZXJIYW5kb2ZmQ2xhaW0/Lih7aGFuZG9mZiwgam9ifSlcblxuICAgICAgY29uc3QgaGFuZG9mZnMgPSB0aGlzLndvcmtlckhhbmRvZmZzLmdldCh3b3JrZXIpXG5cbiAgICAgIGlmICghaGFuZG9mZnMgfHwgIXRoaXMud29ya2Vycy5oYXMod29ya2VyKSB8fCB3b3JrZXIuaXNEcmFpbmluZyB8fCB0aGlzLmxpZmVjeWNsZVN0YXRlICE9PSBcImFjdGl2ZVwiIHx8ICF0aGlzLl9hY3RpdmVPd25lcnNoaXBSZWFkeSkge1xuICAgICAgICB0aGlzLl9yZW1lbWJlckhhbmRvZmZSZWNvdmVyeSh7aGFuZG9mZklkOiBoYW5kb2ZmLmhhbmRvZmZJZCwgam9iSWQ6IGpvYi5pZH0pXG4gICAgICAgIHRyeSB7XG4gICAgICAgICAgYXdhaXQgdGhpcy5fcmVjb3ZlckhhbmRvZmYoe2hhbmRvZmZJZDogaGFuZG9mZi5oYW5kb2ZmSWQsIGpvYklkOiBqb2IuaWR9KVxuICAgICAgICB9IGNhdGNoIChyZWNvdmVyeUVycm9yKSB7XG4gICAgICAgICAgdGhpcy5fcmVwb3J0SGFuZG9mZlJlY292ZXJ5RXJyb3Ioe2Vycm9yOiByZWNvdmVyeUVycm9yLCBoYW5kb2ZmSWQ6IGhhbmRvZmYuaGFuZG9mZklkLCBqb2JJZDogam9iLmlkfSlcbiAgICAgICAgICB0aHJvdyByZWNvdmVyeUVycm9yXG4gICAgICAgIH1cbiAgICAgICAgdGhpcy5fbm90aWZ5RW5xdWV1ZWQoKVxuICAgICAgICB0aGlzLl9yZWRyYWluUXVldWVkID0gdHJ1ZVxuICAgICAgICBjb250aW51ZVxuICAgICAgfVxuXG4gICAgICB0aGlzLl9maW5hbGl6ZVdvcmtlckFkbWlzc2lvbih7Li4uYWRtaXNzaW9uLCBqb2IsIHdvcmtlcn0pXG4gICAgICBoYW5kb2Zmcy5zZXQoam9iLmlkLCBoYW5kb2ZmLmhhbmRvZmZJZClcblxuICAgICAgdHJ5IHtcbiAgICAgICAgd29ya2VyLnNlbmQoe1xuICAgICAgICAgIHR5cGU6IFwiam9iXCIsXG4gICAgICAgICAgcGF5bG9hZDoge1xuICAgICAgICAgICAgaWQ6IGpvYi5pZCxcbiAgICAgICAgICAgIGpvYk5hbWU6IGpvYi5qb2JOYW1lLFxuICAgICAgICAgICAgYXJnczogam9iLmFyZ3MsXG4gICAgICAgICAgICBoYW5kb2ZmSWQ6IGhhbmRvZmYuaGFuZG9mZklkLFxuICAgICAgICAgICAgd29ya2VySWQ6IHdvcmtlci53b3JrZXJJZCxcbiAgICAgICAgICAgIGhhbmRlZE9mZkF0TXM6IGhhbmRvZmYuaGFuZGVkT2ZmQXRNcyxcbiAgICAgICAgICAgIG9wdGlvbnM6IHtcbiAgICAgICAgICAgICAgY29uY3VycmVuY3lLZXk6IGpvYi5jb25jdXJyZW5jeUtleSB8fCB1bmRlZmluZWQsXG4gICAgICAgICAgICAgIGV4ZWN1dGlvbk1vZGU6IGpvYi5leGVjdXRpb25Nb2RlLFxuICAgICAgICAgICAgICBtYXhDb25jdXJyZW5jeTogam9iLm1heENvbmN1cnJlbmN5ID8/IHVuZGVmaW5lZCxcbiAgICAgICAgICAgICAgbWF4UmV0cmllczogam9iLm1heFJldHJpZXMgPz8gdW5kZWZpbmVkLFxuICAgICAgICAgICAgICBxdWV1ZTogam9iLnF1ZXVlLFxuICAgICAgICAgICAgICBzY2hlZHVsZWRBdE1zOiBqb2Iuc2NoZWR1bGVkQXRNcyA/PyB1bmRlZmluZWQsXG4gICAgICAgICAgICAgIC4uLihqb2IudGltZW91dE1zID09PSBudWxsID8ge30gOiB7dGltZW91dE1zOiBqb2IudGltZW91dE1zfSlcbiAgICAgICAgICAgIH1cbiAgICAgICAgICB9XG4gICAgICAgIH0pXG4gICAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgICB0aGlzLmxvZ2dlci53YXJuKCgpID0+IFtcIkZhaWxlZCB0byBzZW5kIGpvYiB0byB3b3JrZXIsIHJlLXF1ZXVlaW5nOlwiLCBlcnJvcl0pXG4gICAgICAgIHRyeSB7XG4gICAgICAgICAgd29ya2VyLmNsb3NlKClcbiAgICAgICAgfSBjYXRjaCAoY2xvc2VFcnJvcikge1xuICAgICAgICAgIHRoaXMubG9nZ2VyLndhcm4oKCkgPT4gW1wiRmFpbGVkIHRvIGNsb3NlIHdvcmtlciBhZnRlciBqb2Igc2VuZCBmYWlsdXJlOlwiLCBjbG9zZUVycm9yXSlcbiAgICAgICAgfVxuICAgICAgICBhd2FpdCB0aGlzLl9oYW5kbGVXb3JrZXJTb2NrZXRDbG9zZWQod29ya2VyLCB7cXVldWVSZWRyYWluOiB0cnVlfSlcbiAgICAgIH1cbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogQ29uc3VtZXMgb25lIGFkdmVydGlzZWQgd29ya2VyIGFkbWlzc2lvbiB3aGlsZSBwZXJzaXN0ZW5jZSBpcyBpbiBmbGlnaHQuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gQWRtaXNzaW9uIGRldGFpbHMuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi90eXBlcy5qc1wiKS5CYWNrZ3JvdW5kSm9iUm93fSBhcmdzLmpvYiAtIFNlbGVjdGVkIGpvYi5cbiAgICogQHBhcmFtIHtKc29uU29ja2V0fSBhcmdzLndvcmtlciAtIFNlbGVjdGVkIHdvcmtlciBzb2NrZXQuXG4gICAqIEByZXR1cm5zIHt7cG9vbGVkQ3JlZGl0Q29uc3VtZWQ6IGJvb2xlYW4sIHJlYWRpbmVzc1ZlcnNpb246IG51bWJlcn19IC0gUmV2ZXJzaWJsZSBhZG1pc3Npb24gZGViaXQuXG4gICAqL1xuICBfY29uc3VtZVdvcmtlckFkbWlzc2lvbih7am9iLCB3b3JrZXJ9KSB7XG4gICAgbGV0IHBvb2xlZENyZWRpdENvbnN1bWVkID0gZmFsc2VcblxuICAgIHRoaXMucmVhZHlXb3JrZXJzLmRlbGV0ZSh3b3JrZXIpXG5cbiAgICBpZiAoam9iLmV4ZWN1dGlvbk1vZGUgPT09IFwicG9vbGVkXCIgJiYgd29ya2VyLnVzZXNQb29sZWRDYXBhY2l0eUNyZWRpdHMgJiYgd29ya2VyLmF2YWlsYWJsZVBvb2xlZFNsb3RzID4gMCkge1xuICAgICAgcG9vbGVkQ3JlZGl0Q29uc3VtZWQgPSB0cnVlXG4gICAgICB3b3JrZXIuYXZhaWxhYmxlUG9vbGVkU2xvdHMgLT0gMVxuICAgICAgaWYgKHdvcmtlci5hdmFpbGFibGVQb29sZWRTbG90cyA+IDApIHRoaXMucmVhZHlXb3JrZXJzLmFkZCh3b3JrZXIpXG4gICAgfVxuXG4gICAgcmV0dXJuIHtwb29sZWRDcmVkaXRDb25zdW1lZCwgcmVhZGluZXNzVmVyc2lvbjogd29ya2VyLnJlYWRpbmVzc1ZlcnNpb259XG4gIH1cblxuICAvKipcbiAgICogUmVzdG9yZXMgYW4gYWRtaXNzaW9uIHRoYXQgbmV2ZXIgcmVhY2hlZCBhIHdvcmtlci4gQSBuZXdlciByZWFkaW5lc3NcbiAgICogYWR2ZXJ0aXNlbWVudCBpcyBhbHJlYWR5IGF1dGhvcml0YXRpdmUsIHNvIGl0cyBwb29sZWQgY291bnQgaXMgbm90IGNoYW5nZWQuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gQWRtaXNzaW9uIGRldGFpbHMuXG4gICAqIEBwYXJhbSB7Ym9vbGVhbn0gYXJncy5wb29sZWRDcmVkaXRDb25zdW1lZCAtIFdoZXRoZXIgYSBwb29sZWQgY3JlZGl0IHdhcyBkZWJpdGVkLlxuICAgKiBAcGFyYW0ge251bWJlcn0gYXJncy5yZWFkaW5lc3NWZXJzaW9uIC0gUmVhZGluZXNzIGdlbmVyYXRpb24gYXQgZGViaXQgdGltZS5cbiAgICogQHBhcmFtIHtKc29uU29ja2V0fSBhcmdzLndvcmtlciAtIFNlbGVjdGVkIHdvcmtlciBzb2NrZXQuXG4gICAqIEByZXR1cm5zIHt2b2lkfVxuICAgKi9cbiAgX3Jlc3RvcmVXb3JrZXJBZG1pc3Npb24oe3Bvb2xlZENyZWRpdENvbnN1bWVkLCByZWFkaW5lc3NWZXJzaW9uLCB3b3JrZXJ9KSB7XG4gICAgaWYgKHRoaXMuX3N0b3BwZWQgfHwgdGhpcy5saWZlY3ljbGVTdGF0ZSAhPT0gXCJhY3RpdmVcIiB8fCAhdGhpcy5fYWN0aXZlT3duZXJzaGlwUmVhZHkgfHwgIXRoaXMud29ya2Vycy5oYXMod29ya2VyKSB8fCB3b3JrZXIuaXNEcmFpbmluZykgcmV0dXJuXG5cbiAgICBpZiAocG9vbGVkQ3JlZGl0Q29uc3VtZWQgJiYgd29ya2VyLnJlYWRpbmVzc1ZlcnNpb24gPT09IHJlYWRpbmVzc1ZlcnNpb24pIHtcbiAgICAgIHdvcmtlci5hdmFpbGFibGVQb29sZWRTbG90cyArPSAxXG4gICAgfVxuXG4gICAgaWYgKHdvcmtlci5zdXBwb3J0c0hhbmRvZmZJZFJlcG9ydGluZykgdGhpcy5yZWFkeVdvcmtlcnMuYWRkKHdvcmtlcilcbiAgfVxuXG4gIC8qKlxuICAgKiBBcHBsaWVzIGEgc3VjY2Vzc2Z1bCBwb29sZWQgYWRtaXNzaW9uIHRvIGEgcmVhZGluZXNzIGFkdmVydGlzZW1lbnQgdGhhdFxuICAgKiBhcnJpdmVkIHdoaWxlIHBlcnNpc3RlbmNlIHdhcyBpbiBmbGlnaHQgYW5kIHJlcGxhY2VkIHRoZSBlYXJsaWVyIGRlYml0LlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIEFkbWlzc2lvbiBkZXRhaWxzLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vdHlwZXMuanNcIikuQmFja2dyb3VuZEpvYlJvd30gYXJncy5qb2IgLSBTZWxlY3RlZCBqb2IuXG4gICAqIEBwYXJhbSB7Ym9vbGVhbn0gYXJncy5wb29sZWRDcmVkaXRDb25zdW1lZCAtIFdoZXRoZXIgYSBwb29sZWQgY3JlZGl0IHdhcyBkZWJpdGVkLlxuICAgKiBAcGFyYW0ge251bWJlcn0gYXJncy5yZWFkaW5lc3NWZXJzaW9uIC0gUmVhZGluZXNzIGdlbmVyYXRpb24gYXQgZGViaXQgdGltZS5cbiAgICogQHBhcmFtIHtKc29uU29ja2V0fSBhcmdzLndvcmtlciAtIFNlbGVjdGVkIHdvcmtlciBzb2NrZXQuXG4gICAqIEByZXR1cm5zIHt2b2lkfVxuICAgKi9cbiAgX2ZpbmFsaXplV29ya2VyQWRtaXNzaW9uKHtqb2IsIHBvb2xlZENyZWRpdENvbnN1bWVkLCByZWFkaW5lc3NWZXJzaW9uLCB3b3JrZXJ9KSB7XG4gICAgaWYgKCFwb29sZWRDcmVkaXRDb25zdW1lZCB8fCBqb2IuZXhlY3V0aW9uTW9kZSAhPT0gXCJwb29sZWRcIikgcmV0dXJuXG4gICAgaWYgKHdvcmtlci5yZWFkaW5lc3NWZXJzaW9uID09PSByZWFkaW5lc3NWZXJzaW9uIHx8ICF3b3JrZXIudXNlc1Bvb2xlZENhcGFjaXR5Q3JlZGl0cykgcmV0dXJuXG4gICAgaWYgKHdvcmtlci5hdmFpbGFibGVQb29sZWRTbG90cyA8PSAwKSByZXR1cm5cblxuICAgIHdvcmtlci5hdmFpbGFibGVQb29sZWRTbG90cyAtPSAxXG4gICAgaWYgKHdvcmtlci5hdmFpbGFibGVQb29sZWRTbG90cyA9PT0gMCkgdGhpcy5yZWFkeVdvcmtlcnMuZGVsZXRlKHdvcmtlcilcbiAgfVxuXG4gIC8qKlxuICAgKiBSZXRhaW5zIGFuIGV4YWN0IGxlYXNlIGZvciBpZGVtcG90ZW50IHByZS1kaXNwYXRjaCByZWNvdmVyeS5cbiAgICogQHBhcmFtIHt7aGFuZG9mZklkOiBzdHJpbmcsIGpvYklkOiBzdHJpbmd9fSBhcmdzIC0gRXhhY3QgcmVjb3ZlcnkgZmVuY2UuXG4gICAqIEByZXR1cm5zIHt2b2lkfVxuICAgKi9cbiAgX3JlbWVtYmVySGFuZG9mZlJlY292ZXJ5KHtoYW5kb2ZmSWQsIGpvYklkfSkge1xuICAgIHRoaXMucGVuZGluZ0hhbmRvZmZSZWNvdmVyaWVzLnNldChoYW5kb2ZmSWQsIGpvYklkKVxuICB9XG5cbiAgLyoqXG4gICAqIFJldHVybnMgb25lIGV4YWN0IGxlYXNlIGFuZCBmb3JnZXRzIGl0IG9ubHkgYWZ0ZXIgdGhlIGFkYXB0ZXIgYWNrbm93bGVkZ2VzXG4gICAqIHRoZSBmZW5jZWQgdHJhbnNpdGlvbiBvciBjb25maXJtcyBpdCB3YXMgYWxyZWFkeSBhYnNlbnQuXG4gICAqIEBwYXJhbSB7e2hhbmRvZmZJZDogc3RyaW5nLCBqb2JJZDogc3RyaW5nfX0gYXJncyAtIEV4YWN0IHJlY292ZXJ5IGZlbmNlLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyBhZnRlciBkdXJhYmxlIHJlY292ZXJ5IHNldHRsZXMuXG4gICAqL1xuICBhc3luYyBfcmVjb3ZlckhhbmRvZmYoe2hhbmRvZmZJZCwgam9iSWR9KSB7XG4gICAgYXdhaXQgdGhpcy5zdG9yZS5tYXJrUmV0dXJuZWRUb1F1ZXVlKHtoYW5kb2ZmSWQsIGpvYklkfSlcblxuICAgIGlmICh0aGlzLnBlbmRpbmdIYW5kb2ZmUmVjb3Zlcmllcy5nZXQoaGFuZG9mZklkKSA9PT0gam9iSWQpIHtcbiAgICAgIHRoaXMucGVuZGluZ0hhbmRvZmZSZWNvdmVyaWVzLmRlbGV0ZShoYW5kb2ZmSWQpXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIFJlcGxheXMgcmV0YWluZWQgZXhhY3QtSUQgcmVjb3ZlcmllcyB0aHJvdWdoIHRoZSBkaXNwYXRjaGVyJ3MgZXhpc3RpbmdcbiAgICogdHJhbnNpZW50LWVycm9yIHJldHJ5IGxpZmVjeWNsZS5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgYWZ0ZXIgZXZlcnkgcmV0YWluZWQgcmVjb3Zlcnkgc2V0dGxlcy5cbiAgICovXG4gIGFzeW5jIF9yZXRyeVBlbmRpbmdIYW5kb2ZmUmVjb3ZlcmllcygpIHtcbiAgICBmb3IgKGNvbnN0IFtoYW5kb2ZmSWQsIGpvYklkXSBvZiBbLi4udGhpcy5wZW5kaW5nSGFuZG9mZlJlY292ZXJpZXNdKSB7XG4gICAgICB0cnkge1xuICAgICAgICBhd2FpdCB0aGlzLl9yZWNvdmVySGFuZG9mZih7aGFuZG9mZklkLCBqb2JJZH0pXG4gICAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgICB0aGlzLl9yZXBvcnRIYW5kb2ZmUmVjb3ZlcnlFcnJvcih7ZXJyb3IsIGhhbmRvZmZJZCwgam9iSWR9KVxuICAgICAgICB0aHJvdyBlcnJvclxuICAgICAgfVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBTdXJmYWNlcyBhIGZhaWxlZCBleGFjdC1JRCByZWNvdmVyeSB3aXRob3V0IGRyb3BwaW5nIGl0cyByZXRyeSBsZWRnZXIgZW50cnkuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gUmVjb3ZlcnkgZmFpbHVyZS5cbiAgICogQHBhcmFtIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gYXJncy5lcnJvciAtIEFkYXB0ZXIgZmFpbHVyZS5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGFyZ3MuaGFuZG9mZklkIC0gRXhhY3QgbGVhc2UgZmVuY2UuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBhcmdzLmpvYklkIC0gSm9iIGlkLlxuICAgKiBAcmV0dXJucyB7dm9pZH1cbiAgICovXG4gIF9yZXBvcnRIYW5kb2ZmUmVjb3ZlcnlFcnJvcih7ZXJyb3IsIGhhbmRvZmZJZCwgam9iSWR9KSB7XG4gICAgY29uc3Qgbm9ybWFsaXplZEVycm9yID0gZXJyb3IgaW5zdGFuY2VvZiBFcnJvciA/IGVycm9yIDogbmV3IEVycm9yKFN0cmluZyhlcnJvcikpXG4gICAgY29uc3QgcGF5bG9hZCA9IHtcbiAgICAgIGNvbnRleHQ6IHtoYW5kb2ZmSWQsIGpvYklkLCBzdGFnZTogXCJiYWNrZ3JvdW5kLWpvYi1oYW5kb2ZmLWFkbWlzc2lvbi1yZWNvdmVyeVwifSxcbiAgICAgIGVycm9yOiBub3JtYWxpemVkRXJyb3JcbiAgICB9XG4gICAgY29uc3QgZXJyb3JFdmVudHMgPSB0aGlzLmNvbmZpZ3VyYXRpb24uZ2V0RXJyb3JFdmVudHMoKVxuXG4gICAgdGhpcy5sb2dnZXIuZXJyb3IoKCkgPT4gW1wiRmFpbGVkIHRvIHJlY292ZXIgYW4gYW1iaWd1b3VzIGJhY2tncm91bmQgam9iIGhhbmRvZmY6XCIsIG5vcm1hbGl6ZWRFcnJvcl0pXG4gICAgZXJyb3JFdmVudHMuZW1pdChcImZyYW1ld29yay1lcnJvclwiLCBwYXlsb2FkKVxuICAgIGVycm9yRXZlbnRzLmVtaXQoXCJhbGwtZXJyb3JcIiwgey4uLnBheWxvYWQsIGVycm9yVHlwZTogXCJmcmFtZXdvcmstZXJyb3JcIn0pXG4gIH1cblxuICAvKipcbiAgICogUnVucyBuZXh0IGF2YWlsYWJsZSBqb2IgZm9yIHJlYWR5IHdvcmtlcnMuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPGltcG9ydChcIi4vdHlwZXMuanNcIikuQmFja2dyb3VuZEpvYlJvdyB8IG51bGw+fSAtIE5leHQgcXVldWVkIGpvYiBtYXRjaGluZyByZWFkeSB3b3JrZXIgY2FwYWNpdHkuXG4gICAqL1xuICBhc3luYyBuZXh0QXZhaWxhYmxlSm9iRm9yUmVhZHlXb3JrZXJzKCkge1xuICAgIGNvbnN0IGV4ZWN1dGlvbk1vZGVzID0gdGhpcy5yZWFkeVdvcmtlckV4ZWN1dGlvbk1vZGVzKClcblxuICAgIGlmIChleGVjdXRpb25Nb2Rlcy5sZW5ndGggPT09IDApIHJldHVybiBudWxsXG4gICAgaWYgKGV4ZWN1dGlvbk1vZGVzLmxlbmd0aCA9PT0gV09SS0VSX0VYRUNVVElPTl9NT0RFX0NBUEFCSUxJVElFUy5sZW5ndGgpIHJldHVybiBhd2FpdCB0aGlzLnN0b3JlLm5leHRBdmFpbGFibGVKb2IoKVxuXG4gICAgcmV0dXJuIGF3YWl0IHRoaXMuc3RvcmUubmV4dEF2YWlsYWJsZUpvYih7ZXhlY3V0aW9uTW9kZTogZXhlY3V0aW9uTW9kZXN9KVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgcmVhZHkgd29ya2VyIGV4ZWN1dGlvbiBtb2Rlcy5cbiAgICogQHJldHVybnMge2ltcG9ydChcIi4vdHlwZXMuanNcIikuQmFja2dyb3VuZEpvYkV4ZWN1dGlvbk1vZGVbXX0gLSBFeGVjdXRpb24gbW9kZXMgY3VycmVudGx5IGFjY2VwdGVkIGJ5IHJlYWR5IHdvcmtlcnMuXG4gICAqL1xuICByZWFkeVdvcmtlckV4ZWN1dGlvbk1vZGVzKCkge1xuICAgIGNvbnN0IGV4ZWN1dGlvbk1vZGVzID0gbmV3IFNldCgpXG5cbiAgICBmb3IgKGNvbnN0IHdvcmtlciBvZiB0aGlzLnJlYWR5V29ya2Vycykge1xuICAgICAgdGhpcy5fYWRkQWNjZXB0ZWRFeGVjdXRpb25Nb2Rlcyh7ZXhlY3V0aW9uTW9kZXMsIHdvcmtlcn0pXG4gICAgfVxuXG4gICAgcmV0dXJuIC8qKiBAdHlwZSB7aW1wb3J0KFwiLi90eXBlcy5qc1wiKS5CYWNrZ3JvdW5kSm9iRXhlY3V0aW9uTW9kZVtdfSAqLyAoWy4uLmV4ZWN1dGlvbk1vZGVzXSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGFkZCBhY2NlcHRlZCBleGVjdXRpb24gbW9kZXMuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gT3B0aW9ucy5cbiAgICogQHBhcmFtIHtTZXQ8aW1wb3J0KFwiLi90eXBlcy5qc1wiKS5CYWNrZ3JvdW5kSm9iRXhlY3V0aW9uTW9kZT59IGFyZ3MuZXhlY3V0aW9uTW9kZXMgLSBBY2NlcHRlZCBtb2Rlcy5cbiAgICogQHBhcmFtIHtKc29uU29ja2V0fSBhcmdzLndvcmtlciAtIFdvcmtlciBzb2NrZXQuXG4gICAqIEByZXR1cm5zIHt2b2lkfVxuICAgKi9cbiAgX2FkZEFjY2VwdGVkRXhlY3V0aW9uTW9kZXMoe2V4ZWN1dGlvbk1vZGVzLCB3b3JrZXJ9KSB7XG4gICAgaWYgKCF3b3JrZXIuc3VwcG9ydHNIYW5kb2ZmSWRSZXBvcnRpbmcpIHJldHVyblxuXG4gICAgZm9yIChjb25zdCBjYXBhYmlsaXR5IG9mIFdPUktFUl9FWEVDVVRJT05fTU9ERV9DQVBBQklMSVRJRVMpIHtcbiAgICAgIGlmIChjYXBhYmlsaXR5LmFjY2VwdHMod29ya2VyKSkgZXhlY3V0aW9uTW9kZXMuYWRkKGNhcGFiaWxpdHkuZXhlY3V0aW9uTW9kZSlcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogUnVucyByZWFkeSB3b3JrZXIgZm9yIGpvYi5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL3R5cGVzLmpzXCIpLkJhY2tncm91bmRKb2JSb3d9IGpvYiAtIEpvYiBiZWluZyBoYW5kZWQgb2ZmLlxuICAgKiBAcmV0dXJucyB7SnNvblNvY2tldCB8IHVuZGVmaW5lZH0gLSBSZWFkeSB3b3JrZXIgZm9yIHRoZSBqb2IgdHlwZS5cbiAgICovXG4gIHJlYWR5V29ya2VyRm9ySm9iKGpvYikge1xuICAgIGZvciAoY29uc3Qgd29ya2VyIG9mIHRoaXMucmVhZHlXb3JrZXJzKSB7XG4gICAgICBpZiAodGhpcy5fd29ya2VyQWNjZXB0c0pvYih7am9iLCB3b3JrZXJ9KSkgcmV0dXJuIHdvcmtlclxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHdvcmtlciBhY2NlcHRzIGpvYi5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBPcHRpb25zLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vdHlwZXMuanNcIikuQmFja2dyb3VuZEpvYlJvd30gYXJncy5qb2IgLSBKb2IgYmVpbmcgaGFuZGVkIG9mZi5cbiAgICogQHBhcmFtIHtKc29uU29ja2V0fSBhcmdzLndvcmtlciAtIFdvcmtlciBzb2NrZXQuXG4gICAqIEByZXR1cm5zIHtib29sZWFufSAtIFdoZXRoZXIgdGhlIHdvcmtlciBhY2NlcHRzIHRoZSBqb2IgbW9kZS5cbiAgICovXG4gIF93b3JrZXJBY2NlcHRzSm9iKHtqb2IsIHdvcmtlcn0pIHtcbiAgICBpZiAoIXdvcmtlci5zdXBwb3J0c0hhbmRvZmZJZFJlcG9ydGluZykgcmV0dXJuIGZhbHNlXG5cbiAgICBjb25zdCBjYXBhYmlsaXR5ID0gV09SS0VSX0VYRUNVVElPTl9NT0RFX0NBUEFCSUxJVElFU19CWV9NT0RFLmdldChqb2IuZXhlY3V0aW9uTW9kZSlcblxuICAgIGlmICghY2FwYWJpbGl0eSkgcmV0dXJuIGZhbHNlXG5cbiAgICByZXR1cm4gY2FwYWJpbGl0eS5hY2NlcHRzKHdvcmtlcilcbiAgfVxuXG4gIC8qKlxuICAgKiBBcm1zIGEgc2luZ2xlIGBzZXRUaW1lb3V0YCBmb3IgdGhlIHNvb25lc3QgZnV0dXJlLXNjaGVkdWxlZCBqb2Inc1xuICAgKiBgc2NoZWR1bGVkX2F0X21zYC4gUmVwbGFjZXMgdGhlIHNlY29uZCByZXNwb25zaWJpbGl0eSBvZiB0aGUgbGVnYWN5XG4gICAqIDEtc2Vjb25kIHBvbGwgKGJlY29taW5nLWVsaWdpYmxlIHNjaGVkdWxlZCBqb2JzKS4gVGhlIHRpbWVyIGlzXG4gICAqIGlkZW1wb3RlbnRseSByZS1hcm1lZCBhdCB0aGUgZW5kIG9mIGV2ZXJ5IGRyYWluLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn1cbiAgICovXG4gIGFzeW5jIF9hcm1TY2hlZHVsZWRUaW1lcigpIHtcbiAgICBpZiAodGhpcy5fc2NoZWR1bGVkVGltZXIpIHtcbiAgICAgIGNsZWFyVGltZW91dCh0aGlzLl9zY2hlZHVsZWRUaW1lcilcbiAgICAgIHRoaXMuX3NjaGVkdWxlZFRpbWVyID0gdW5kZWZpbmVkXG4gICAgfVxuXG4gICAgaWYgKHRoaXMuX3N0b3BwZWQgfHwgdGhpcy5saWZlY3ljbGVTdGF0ZSAhPT0gXCJhY3RpdmVcIiB8fCAhdGhpcy5fYWN0aXZlT3duZXJzaGlwUmVhZHkpIHJldHVyblxuICAgIGlmICh0aGlzLmRpc3BhdGNoU3RyYXRlZ3kgPT09IFwicG9sbGluZ1wiKSByZXR1cm5cblxuICAgIGNvbnN0IG5leHQgPSBhd2FpdCB0aGlzLnN0b3JlLm5leHRTY2hlZHVsZWRKb2IoKVxuICAgIGxldCBkZWxheVxuXG4gICAgaWYgKG5leHQgJiYgdHlwZW9mIG5leHQuc2NoZWR1bGVkQXRNcyA9PT0gXCJudW1iZXJcIikge1xuICAgICAgZGVsYXkgPSBNYXRoLm1heCgwLCBNYXRoLm1pbihuZXh0LnNjaGVkdWxlZEF0TXMgLSB0aGlzLmNsb2NrLm5vdygpLCBNQVhfVElNRVJfTVMpKVxuICAgIH1cblxuICAgIC8vIGBuZXh0U2NoZWR1bGVkSm9iYCBvbmx5IHJldHVybnMgZnV0dXJlIGpvYnMsIHNvIGEgam9iIHRoYXQgYmVjYW1lXG4gICAgLy8gZWxpZ2libGUgYWZ0ZXIgdGhlIGRyYWluJ3MgZWxpZ2libGUtam9iIHByb2JlIGlzIGludmlzaWJsZSB0byBpdC4gSWYgb25lXG4gICAgLy8gaXMgZGlzcGF0Y2hhYmxlIG5vdywgYXJtIGEgMC1kZWxheSByZS1kcmFpbiBzbyBpdCBpcyBkaXNwYXRjaGVkXG4gICAgLy8gaW1tZWRpYXRlbHkgaW5zdGVhZCBvZiBiZWluZyBzdHJhbmRlZCB1bnRpbCB0aGUgbmV4dCBmdXR1cmUgdGltZXIgKG9yXG4gICAgLy8gZXh0ZXJuYWwgc2lnbmFsKSBmaXJlcy5cbiAgICBpZiAoYXdhaXQgdGhpcy5uZXh0QXZhaWxhYmxlSm9iRm9yUmVhZHlXb3JrZXJzKCkpIGRlbGF5ID0gMFxuXG4gICAgaWYgKHR5cGVvZiBkZWxheSAhPT0gXCJudW1iZXJcIikgcmV0dXJuXG5cbiAgICB0aGlzLl9zY2hlZHVsZWRUaW1lciA9IHNldFRpbWVvdXQoKCkgPT4ge1xuICAgICAgdGhpcy5fc2NoZWR1bGVkVGltZXIgPSB1bmRlZmluZWRcbiAgICAgIHZvaWQgdGhpcy5fZHJhaW4oKVxuICAgIH0sIGRlbGF5KVxuICB9XG5cbiAgYXN5bmMgX3N3ZWVwT3JwaGFucygpIHtcbiAgICB0cnkge1xuICAgICAgbGV0IG9ycGhhbmVkSm9ic1xuXG4gICAgICBpZiAodGhpcy5nZW5lcmF0aW9uSWQpIHtcbiAgICAgICAgY29uc3QgY29ubmVjdGVkV29ya2VySWRzID0gbmV3IFNldCgpXG4gICAgICAgIGZvciAoY29uc3Qgd29ya2VyIG9mIHRoaXMud29ya2Vycykge1xuICAgICAgICAgIGlmICh3b3JrZXIud29ya2VySWQpIGNvbm5lY3RlZFdvcmtlcklkcy5hZGQod29ya2VyLndvcmtlcklkKVxuICAgICAgICB9XG4gICAgICAgIGZvciAoY29uc3Qgd29ya2VySWQgb2YgdGhpcy5kaXNjb25uZWN0ZWRXb3JrZXJzLmtleXMoKSkgY29ubmVjdGVkV29ya2VySWRzLmFkZCh3b3JrZXJJZClcblxuICAgICAgICBjb25zdCBjdXRvZmYgPSB0aGlzLmNsb2NrLm5vdygpIC0gR0VORVJBVElPTl9PUlBIQU5FRF9BRlRFUl9NU1xuICAgICAgICBjb25zdCBoYW5kb2ZmcyA9IChhd2FpdCB0aGlzLl9nZW5lcmF0aW9uT3duZWRIYW5kb2ZmU25hcHNob3QoKSkuZmlsdGVyKChoYW5kb2ZmKSA9PiB7XG4gICAgICAgICAgcmV0dXJuIGhhbmRvZmYuaGFuZGVkT2ZmQXRNcyA8PSBjdXRvZmYgJiYgIWNvbm5lY3RlZFdvcmtlcklkcy5oYXMoaGFuZG9mZi53b3JrZXJJZClcbiAgICAgICAgfSlcbiAgICAgICAgb3JwaGFuZWRKb2JzID0gaGFuZG9mZnMubGVuZ3RoID09PSAwXG4gICAgICAgICAgPyBbXVxuICAgICAgICAgIDogYXdhaXQgdGhpcy5zdG9yZS5tYXJrT3JwaGFuZWRIYW5kb2Zmcyh7aGFuZG9mZnMsIGVycm9yOiBcIkpvYiBvcnBoYW5lZCBhZnRlciBpdHMgZ2VuZXJhdGlvbiBvd25lciBkaXNhcHBlYXJlZFwifSlcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIG9ycGhhbmVkSm9icyA9IGF3YWl0IHRoaXMuc3RvcmUubWFya09ycGhhbmVkSm9icygpXG4gICAgICB9XG5cbiAgICAgIGF3YWl0IHRoaXMuX2hhbmRsZU9ycGhhbmVkSm9icyh7am9iczogb3JwaGFuZWRKb2JzLCB3YXJuaW5nOiBcIk1hcmtlZCBvcnBoYW5lZCBiYWNrZ3JvdW5kIGpvYnNcIn0pXG4gICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgIGNvbnN0IG5vcm1hbGl6ZWRFcnJvciA9IGVycm9yIGluc3RhbmNlb2YgRXJyb3IgPyBlcnJvciA6IG5ldyBFcnJvcihTdHJpbmcoZXJyb3IpKVxuICAgICAgY29uc3QgcGF5bG9hZCA9IHtjb250ZXh0OiB7Z2VuZXJhdGlvbklkOiB0aGlzLmdlbmVyYXRpb25JZCwgc3RhZ2U6IFwiYmFja2dyb3VuZC1qb2Itb3JwaGFuLXN3ZWVwXCJ9LCBlcnJvcjogbm9ybWFsaXplZEVycm9yfVxuICAgICAgY29uc3QgZXJyb3JFdmVudHMgPSB0aGlzLmNvbmZpZ3VyYXRpb24uZ2V0RXJyb3JFdmVudHMoKVxuXG4gICAgICB0aGlzLmxvZ2dlci5lcnJvcigoKSA9PiBbXCJGYWlsZWQgdG8gbWFyayBvcnBoYW5lZCBqb2JzOlwiLCBub3JtYWxpemVkRXJyb3JdKVxuICAgICAgZXJyb3JFdmVudHMuZW1pdChcImZyYW1ld29yay1lcnJvclwiLCBwYXlsb2FkKVxuICAgICAgZXJyb3JFdmVudHMuZW1pdChcImFsbC1lcnJvclwiLCB7Li4ucGF5bG9hZCwgZXJyb3JUeXBlOiBcImZyYW1ld29yay1lcnJvclwifSlcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogUHVibGlzaGVzIHRoZSBjb21tb24gcG9zdC1vcnBoYW4gbGlmZWN5Y2xlOiB3YWtlIHF1ZXVlZCByZXRyaWVzLCBlbWl0IG9uZVxuICAgKiBpc29sYXRlZCBldmVudCBwZXIgYWNjZXB0ZWQgdHJhbnNpdGlvbiwgYW5kIGRyYWluIHNvIHJlbGVhc2VkIGNvbmN1cnJlbmN5XG4gICAqIGNhbiBpbW1lZGlhdGVseSBhZG1pdCBvdGhlciB3b3JrLlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIE9wdGlvbnMuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi90eXBlcy5qc1wiKS5CYWNrZ3JvdW5kSm9iUm93W119IGFyZ3Muam9icyAtIEFjY2VwdGVkIG9ycGhhbiB0cmFuc2l0aW9ucy5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGFyZ3Mud2FybmluZyAtIExpZmVjeWNsZSBsb2cgbWVzc2FnZS5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgYWZ0ZXIgdGhlIHJlc3VsdGluZyBkcmFpbi5cbiAgICovXG4gIGFzeW5jIF9oYW5kbGVPcnBoYW5lZEpvYnMoe2pvYnMsIHdhcm5pbmd9KSB7XG4gICAgaWYgKGpvYnMubGVuZ3RoID09PSAwKSB7XG4gICAgICB0aGlzLl9tYXliZVN0b3BSZXRpcmVkKClcbiAgICAgIHJldHVyblxuICAgIH1cblxuICAgIHRoaXMubG9nZ2VyLndhcm4oKCkgPT4gW3dhcm5pbmcsIGpvYnMubGVuZ3RoXSlcbiAgICAvLyBSZWNsYWltZWQgb3JwaGFucyBjYW4gYmVjb21lIGBxdWV1ZWRgIGFnYWluIOKAlCB3YWtlIHRoZSBkaXNwYXRjaGVyIGZpcnN0XG4gICAgLy8gc28gYW4gYXBwbGljYXRpb24gZXZlbnQgaGFuZGxlciB0aGF0IHRocm93cyBiZWxvdyBjYW5ub3Qgc3RyYW5kIHRoZW0uXG4gICAgdGhpcy5fbm90aWZ5RW5xdWV1ZWQoKVxuICAgIC8vIEVtaXQgYmVmb3JlIGF3YWl0aW5nIHRoZSBkcmFpbiBzbyBhIGJsb2NrZWQgZGlzcGF0Y2hlciBjYW5ub3QgZGVsYXlcbiAgICAvLyBhcHBsaWNhdGlvbiByZWNvdmVyeS4gSXNvbGF0ZSBoYW5kbGVycyBzbyBvbmUgY2Fubm90IHN1cHByZXNzIHRoZSByZXN0LlxuICAgIGZvciAoY29uc3Qgam9iIG9mIGpvYnMpIHtcbiAgICAgIHRyeSB7XG4gICAgICAgIHRoaXMuX2VtaXRCYWNrZ3JvdW5kSm9iT3JwaGFuZWQoe2pvYn0pXG4gICAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgICB0aGlzLmxvZ2dlci5lcnJvcigoKSA9PiBbXCJBIGJhY2tncm91bmQtam9iLW9ycGhhbmVkIGV2ZW50IGhhbmRsZXIgdGhyZXc6XCIsIGVycm9yXSlcbiAgICAgIH1cbiAgICB9XG4gICAgYXdhaXQgdGhpcy5fZHJhaW4oKVxuICAgIHRoaXMuX21heWJlU3RvcFJldGlyZWQoKVxuICB9XG5cbiAgLyoqXG4gICAqIERyb3BzIHdvcmtlcnMgdGhhdCBoYXZlIGdvbmUgc2lsZW50IHBhc3QgYHdvcmtlclN0YWxlVGltZW91dE1zYCAobm9cbiAgICogaGVhcnRiZWF0LCByZWFkeSwgb3IgcmVwb3J0KS4gQSB3ZWRnZWQgd29ya2VyIGtlZXBzIGl0cyBzb2NrZXQgb3Blbiwgc28gdGhlXG4gICAqIGBjbG9zZWAtYmFzZWQgY2xlYW51cCBuZXZlciBmaXJlcyBhbmQgaXRzIGluLWZsaWdodCBsZWFzZXMg4oCUIGFuZCB0aGUgd2hvbGVcbiAgICogcXVldWUg4oCUIHN0YXkgc3R1Y2sgdW50aWwgYSBodW1hbiBub3RpY2VzLiBSZWxlYXNpbmcgdGhlIGxvc3Qgd29ya2VyJ3NcbiAgICogbGVhc2VzIGxldHMgaXRzIGpvYnMgcnVuIGVsc2V3aGVyZSBhbmQgc3RvcHMgZGlzcGF0Y2ggdG8gaXQ7IHRoZSB3b3JrZXInc1xuICAgKiBvd24gcHJvY2VzcyBsaWZlY3ljbGUgaXMgdGhlIHN1cGVydmlzb3IncyBjb25jZXJuLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyBhZnRlciB0aGUgc3dlZXAuXG4gICAqL1xuICBhc3luYyBfc3dlZXBTdGFsZVdvcmtlcnMoKSB7XG4gICAgaWYgKHRoaXMuX3N0b3BwZWQpIHJldHVyblxuXG4gICAgY29uc3QgY3V0b2ZmID0gdGhpcy5jbG9jay5ub3coKSAtIHRoaXMud29ya2VyU3RhbGVUaW1lb3V0TXNcbiAgICAvKiogQHR5cGUge0pzb25Tb2NrZXRbXX0gKi9cbiAgICBjb25zdCBzdGFsZSA9IFtdXG5cbiAgICBmb3IgKGNvbnN0IHdvcmtlciBvZiB0aGlzLndvcmtlcnMpIHtcbiAgICAgIC8vIE9ubHkgZXZpY3QgaGVhcnRiZWF0LWNhcGFibGUgd29ya2Vycy4gQSBsZWdhY3kgd29ya2VyIChlLmcuIG9uZSBmcm9tIHRoZVxuICAgICAgLy8gcHJldmlvdXMgcmVsZWFzZSBkdXJpbmcgYSByb2xsaW5nIGRlcGxveSkgbmV2ZXIgaGVhcnRiZWF0cywgc28gZXZpY3RpbmdcbiAgICAgIC8vIGl0IG9uIHNpbGVuY2Ugd291bGQgd3JvbmdseSByZWxlYXNlIHRoZSBsZWFzZXMgb2YgYSBqb2IgaXQgaXMgc3RpbGxcbiAgICAgIC8vIHJ1bm5pbmcuIEl0cyBkaXNjb25uZWN0IGlzIHN0aWxsIGhhbmRsZWQgYnkgdGhlIHNvY2tldCBgY2xvc2VgIHBhdGguXG4gICAgICBpZiAoIXdvcmtlci5zdXBwb3J0c0hlYXJ0YmVhdCkgY29udGludWVcblxuICAgICAgY29uc3QgbGFzdFNlZW5BdCA9IHR5cGVvZiB3b3JrZXIubGFzdFNlZW5BdCA9PT0gXCJudW1iZXJcIiA/IHdvcmtlci5sYXN0U2VlbkF0IDogMFxuXG4gICAgICBpZiAobGFzdFNlZW5BdCA8PSBjdXRvZmYpIHN0YWxlLnB1c2god29ya2VyKVxuICAgIH1cblxuICAgIGZvciAoY29uc3Qgd29ya2VyIG9mIHN0YWxlKSB7XG4gICAgICB0aGlzLmxvZ2dlci53YXJuKCgpID0+IFtcIkRyb3BwaW5nIHN0YWxlIGJhY2tncm91bmQgam9icyB3b3JrZXJcIiwge3dvcmtlcklkOiB3b3JrZXIud29ya2VySWQsIGxhc3RTZWVuQXQ6IHdvcmtlci5sYXN0U2VlbkF0fV0pXG5cbiAgICAgIHRyeSB7XG4gICAgICAgIHdvcmtlci5jbG9zZSgpXG4gICAgICB9IGNhdGNoIHtcbiAgICAgICAgLy8gQWxyZWFkeSBjbG9zaW5nOyB0aGUgbGVhc2UgcmVsZWFzZSBiZWxvdyBpcyB3aGF0IG1hdHRlcnMuXG4gICAgICB9XG5cbiAgICAgIGF3YWl0IHRoaXMuX2hhbmRsZVdvcmtlclNvY2tldENsb3NlZCh3b3JrZXIpXG4gICAgfVxuICB9XG59XG4iXX0=