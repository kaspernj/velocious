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
            return this._retirementPromise || Promise.resolve();
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
        return this._retirementPromise;
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoibWFpbi5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uLy4uLy4uL3NyYy9iYWNrZ3JvdW5kLWpvYnMvbWFpbi5qcyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiQUFBQSxZQUFZO0FBRVosT0FBTyxFQUFFLFVBQVUsRUFBRSxNQUFNLFFBQVEsQ0FBQTtBQUNuQyxPQUFPLEdBQUcsTUFBTSxLQUFLLENBQUE7QUFDckIsT0FBTyxVQUFVLE1BQU0sa0JBQWtCLENBQUE7QUFDekMsT0FBTyx1QkFBdUIsTUFBTSxnQkFBZ0IsQ0FBQTtBQUNwRCxPQUFPLE1BQU0sTUFBTSxjQUFjLENBQUE7QUFDakMsT0FBTyw4QkFBOEIsTUFBTSwyQ0FBMkMsQ0FBQTtBQUN0RixPQUFPLGNBQWMsTUFBTSx1QkFBdUIsQ0FBQTtBQUNsRCxPQUFPLGlCQUFpQixFQUFFLEVBQUUsZ0JBQWdCLEVBQUUsTUFBTSxnQ0FBZ0MsQ0FBQTtBQUNwRixPQUFPLEVBQUUsb0JBQW9CLEVBQUUsMkJBQTJCLEVBQUUsTUFBTSwwQkFBMEIsQ0FBQTtBQUM1RixPQUFPLG9DQUFvQyxNQUFNLCtCQUErQixDQUFBO0FBRWhGOzs7OztHQUtHO0FBQ0g7Ozs7OztHQU1HO0FBQ0gsTUFBTSxnQkFBZ0IsR0FBRyxvQ0FBb0MsQ0FBQTtBQUU3RDs7OztHQUlHO0FBQ0gsTUFBTSxZQUFZLEdBQUcsYUFBYSxDQUFBLENBQUMsYUFBYTtBQUNoRCwrRUFBK0U7QUFDL0UsTUFBTSx1QkFBdUIsR0FBRyxLQUFLLENBQUE7QUFDckMsc0RBQXNEO0FBQ3RELE1BQU0sd0JBQXdCLEdBQUcsS0FBSyxDQUFBO0FBQ3RDLHlGQUF5RjtBQUN6RixNQUFNLHlCQUF5QixHQUFHLEtBQUssQ0FBQTtBQUN2QyxNQUFNLDRCQUE0QixHQUFHLEVBQUUsR0FBRyxFQUFFLEdBQUcsSUFBSSxDQUFBO0FBQ25ELE1BQU0seUNBQXlDLEdBQUcsMkRBQTJELFlBQVksRUFBRSxDQUFBO0FBRTNIOzs7OztHQUtHO0FBQ0gsU0FBUywrQkFB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Q0FBQztJQUNILENBQUM7Q0FDRiIsInNvdXJjZXNDb250ZW50IjpbIi8vIEB0cy1jaGVja1xuXG5pbXBvcnQgeyByYW5kb21VVUlEIH0gZnJvbSBcImNyeXB0b1wiXG5pbXBvcnQgbmV0IGZyb20gXCJuZXRcIlxuaW1wb3J0IEpzb25Tb2NrZXQgZnJvbSBcIi4vanNvbi1zb2NrZXQuanNcIlxuaW1wb3J0IEJhY2tncm91bmRKb2JzU2NoZWR1bGVyIGZyb20gXCIuL3NjaGVkdWxlci5qc1wiXG5pbXBvcnQgTG9nZ2VyIGZyb20gXCIuLi9sb2dnZXIuanNcIlxuaW1wb3J0IFBydW5lVGVybWluYWxCYWNrZ3JvdW5kSm9ic0pvYiBmcm9tIFwiLi4vam9icy9wcnVuZS10ZXJtaW5hbC1iYWNrZ3JvdW5kLWpvYnMuanNcIlxuaW1wb3J0IFZlbG9jaW91c0Vycm9yIGZyb20gXCIuLi92ZWxvY2lvdXMtZXJyb3IuanNcIlxuaW1wb3J0IHNodXRkb3duTGlmZWN5Y2xlLCB7IHJ1blNodXRkb3duU3RlcHMgfSBmcm9tIFwiLi4vdXRpbHMvc2h1dGRvd24tbGlmZWN5Y2xlLmpzXCJcbmltcG9ydCB7IHZhbGlkYXRlR2VuZXJhdGlvbklkLCB3b3JrZXJJZEJlbG9uZ3NUb0dlbmVyYXRpb24gfSBmcm9tIFwiLi9nZW5lcmF0aW9uLWlkZW50aXR5LmpzXCJcbmltcG9ydCBCYWNrZ3JvdW5kSm9ic0xpZmVjeWNsZUNvbnRyb2xTZXJ2ZXIgZnJvbSBcIi4vbGlmZWN5Y2xlLWNvbnRyb2wtc2VydmVyLmpzXCJcblxuLyoqXG4gKiBXb3JrZXJFeGVjdXRpb25Nb2RlQ2FwYWJpbGl0eSB0eXBlLlxuICogQHR5cGVkZWYge29iamVjdH0gV29ya2VyRXhlY3V0aW9uTW9kZUNhcGFiaWxpdHlcbiAqIEBwcm9wZXJ0eSB7aW1wb3J0KFwiLi90eXBlcy5qc1wiKS5CYWNrZ3JvdW5kSm9iRXhlY3V0aW9uTW9kZX0gZXhlY3V0aW9uTW9kZSAtIEV4ZWN1dGlvbiBtb2RlLlxuICogQHByb3BlcnR5IHsod29ya2VyOiBKc29uU29ja2V0KSA9PiBib29sZWFufSBhY2NlcHRzIC0gV2hldGhlciB0aGUgd29ya2VyIGFjY2VwdHMgdGhpcyBtb2RlLlxuICovXG4vKipcbiAqIENoYW5uZWwgdXNlZCBieSBgYmFja2dyb3VuZC1qb2JzLW1haW5gIHRvIGNvb3JkaW5hdGUgZGlzcGF0Y2ggd2FrZS11cHNcbiAqIGFjcm9zcyBwcm9jZXNzZXMgdmlhIEJlYWNvbi4gV29ya2VycyBkbyBOT1Qgc3Vic2NyaWJlIHRvIHRoaXMgY2hhbm5lbFxuICog4oCUIHRoZXkgYWxyZWFkeSByZWNlaXZlIGpvYi1oYW5kb2ZmIG1lc3NhZ2VzIG9uIHRoZWlyIEpzb25Tb2NrZXQgdG9cbiAqIG1haW47IHRoaXMgY2hhbm5lbCBleGlzdHMgc28gY3Jvc3MtcHJvY2VzcyBlbnF1ZXVlcyAob3IgZnV0dXJlXG4gKiBtdWx0aS1tYWluIGRlcGxveW1lbnRzKSBjYW4gcG9rZSBhbiBpZGxlIG1haW4gdG8gZHJhaW4uXG4gKi9cbmNvbnN0IERJU1BBVENIX0NIQU5ORUwgPSBcInZlbG9jaW91cy1iYWNrZ3JvdW5kLWpvYnMtZGlzcGF0Y2hcIlxuXG4vKipcbiAqIGBzZXRUaW1lb3V0YCBpcyBpbXBsZW1lbnRlZCB3aXRoIDMyLWJpdCBzaWduZWQgZGVsYXlzIG9uIE5vZGU7IHBhc3NpbmdcbiAqIGFueXRoaW5nIGxhcmdlciBzaWxlbnRseSBjbGFtcHMgdG8gMW1zIGFuZCBmaXJlcyBpbW1lZGlhdGVseS4gQ2FwIHRoZVxuICogc2NoZWR1bGVkLWpvYiB0aW1lciBoZXJlIGFuZCByZS1hcm0gd2hlbiBpdCBleHBpcmVzLlxuICovXG5jb25zdCBNQVhfVElNRVJfTVMgPSAyXzE0N180ODNfNjQ3IC8vIH4yNC44IGRheXNcbi8qKiBBIHdvcmtlciBzaWxlbnQgKG5vIGhlYXJ0YmVhdC9yZWFkeS9yZXBvcnQpIGxvbmdlciB0aGFuIHRoaXMgaXMgZHJvcHBlZC4gKi9cbmNvbnN0IFdPUktFUl9TVEFMRV9USU1FT1VUX01TID0gNjAwMDBcbi8qKiBIb3cgb2Z0ZW4gdGhlIG1haW4gc2NhbnMgd29ya2VycyBmb3Igc3RhbGVuZXNzLiAqL1xuY29uc3QgV09SS0VSX0xJVkVORVNTX1NXRUVQX01TID0gMTUwMDBcbi8qKiBHcmFjZSBmb3Igd29ya2VycyBmcm9tIHRoZSBwcmV2aW91cyBtYWluIGdlbmVyYXRpb24gdG8gcmVjb25uZWN0IGFuZCBhZG9wdCBsZWFzZXMuICovXG5jb25zdCBXT1JLRVJfUkVDT05ORUNUX0dSQUNFX01TID0gMzAwMDBcbmNvbnN0IEdFTkVSQVRJT05fT1JQSEFORURfQUZURVJfTVMgPSA2MCAqIDYwICogMTAwMFxuY29uc3QgV09SS0VSX1JFQ09OTkVDVF9HUkFDRV9WQUxJREFUSU9OX01FU1NBR0UgPSBgd29ya2VyUmVjb25uZWN0R3JhY2VNcyBtdXN0IGJlIGFuIGludGVnZXIgYmV0d2VlbiAwIGFuZCAke01BWF9USU1FUl9NU31gXG5cbi8qKlxuICogUmVzb2x2ZXMgYSBzdGFydHVwIHJlY29ubmVjdCBncmFjZSB3aXRob3V0IGFsbG93aW5nIE5vZGUncyB0aW1lciBvdmVyZmxvdyB0b1xuICogdHVybiBhbiBpbnRlbnRpb25hbGx5IGxvbmcgZ3JhY2UgaW50byBhbiBpbW1lZGlhdGUgcmVjbGFpbS5cbiAqIEBwYXJhbSB7bnVtYmVyIHwgdW5kZWZpbmVkfSB3b3JrZXJSZWNvbm5lY3RHcmFjZU1zIC0gUmVxdWVzdGVkIHJlY29ubmVjdCBncmFjZS5cbiAqIEByZXR1cm5zIHtudW1iZXJ9IC0gVmFsaWQgdGltZXIgZGVsYXkuXG4gKi9cbmZ1bmN0aW9uIG5vcm1hbGl6ZVdvcmtlclJlY29ubmVjdEdyYWNlTXMod29ya2VyUmVjb25uZWN0R3JhY2VNcykge1xuICBpZiAod29ya2VyUmVjb25uZWN0R3JhY2VNcyA9PT0gdW5kZWZpbmVkKSByZXR1cm4gV09SS0VSX1JFQ09OTkVDVF9HUkFDRV9NU1xuICBpZiAoIU51bWJlci5pc0ludGVnZXIod29ya2VyUmVjb25uZWN0R3JhY2VNcykgfHwgd29ya2VyUmVjb25uZWN0R3JhY2VNcyA8IDAgfHwgd29ya2VyUmVjb25uZWN0R3JhY2VNcyA+IE1BWF9USU1FUl9NUykge1xuICAgIHRocm93IG5ldyBUeXBlRXJyb3IoV09SS0VSX1JFQ09OTkVDVF9HUkFDRV9WQUxJREFUSU9OX01FU1NBR0UpXG4gIH1cblxuICByZXR1cm4gd29ya2VyUmVjb25uZWN0R3JhY2VNc1xufVxuLyoqXG4gKiBXb3JrZXIgZXhlY3V0aW9uIG1vZGUgY2FwYWJpbGl0aWVzLlxuICogQHR5cGUge1dvcmtlckV4ZWN1dGlvbk1vZGVDYXBhYmlsaXR5W119ICovXG5jb25zdCBXT1JLRVJfRVhFQ1VUSU9OX01PREVfQ0FQQUJJTElUSUVTID0gW1xuICB7ZXhlY3V0aW9uTW9kZTogXCJpbmxpbmVcIiwgYWNjZXB0czogKHdvcmtlcikgPT4gd29ya2VyLmFjY2VwdHNJbmxpbmVKb2JzICE9PSBmYWxzZX0sXG4gIHtleGVjdXRpb25Nb2RlOiBcImZvcmtlZFwiLCBhY2NlcHRzOiAod29ya2VyKSA9PiB3b3JrZXIuYWNjZXB0c0ZvcmtlZEpvYnMgIT09IGZhbHNlfSxcbiAgLy8gUG9vbGVkIGlzIG9wdC1pbjogb25seSB3b3JrZXJzIHRoYXQgZXhwbGljaXRseSBhZHZlcnRpc2UgYGFjY2VwdHNQb29sZWRgXG4gIC8vIHJlY2VpdmUgcG9vbGVkIGpvYnMuIFRoZSBgPT09IHRydWVgIChyYXRoZXIgdGhhbiBgIT09IGZhbHNlYCkgY2hlY2sga2VlcHMgYVxuICAvLyBwcmUtcG9vbGVkIHdvcmtlciDigJQgd2hpY2ggbmV2ZXIgc2VuZHMgdGhlIGZpZWxkIOKAlCBvdXQgb2YgdGhlIHBvb2xlZC1jYXBhYmxlXG4gIC8vIHNldCwgc28gdGhlIG1haW4gbmV2ZXIgZGlzcGF0Y2hlcyBhIHBvb2xlZCBqb2IgdG8gYSB3b3JrZXIgdGhhdCBjYW5ub3QgcnVuXG4gIC8vIG9uZS4gVGhpcyBpcyB0aGUgY29uc2VydmF0aXZlIGhhbGYgb2YgdGhlIGV4dGVuZGVkIHJlYWRpbmVzcyBwcm90b2NvbC5cbiAge2V4ZWN1dGlvbk1vZGU6IFwicG9vbGVkXCIsIGFjY2VwdHM6ICh3b3JrZXIpID0+IHdvcmtlci5hY2NlcHRzUG9vbGVkSm9icyA9PT0gdHJ1ZSAmJiAoIXdvcmtlci51c2VzUG9vbGVkQ2FwYWNpdHlDcmVkaXRzIHx8IHdvcmtlci5hdmFpbGFibGVQb29sZWRTbG90cyA+IDApfSxcbiAge2V4ZWN1dGlvbk1vZGU6IFwic3Bhd25lZFwiLCBhY2NlcHRzOiAod29ya2VyKSA9PiB3b3JrZXIuYWNjZXB0c1NwYXduZWRKb2JzICE9PSBmYWxzZX1cbl1cbmNvbnN0IFdPUktFUl9FWEVDVVRJT05fTU9ERV9DQVBBQklMSVRJRVNfQllfTU9ERSA9IG5ldyBNYXAoXG4gIFdPUktFUl9FWEVDVVRJT05fTU9ERV9DQVBBQklMSVRJRVMubWFwKChjYXBhYmlsaXR5KSA9PiBbY2FwYWJpbGl0eS5leGVjdXRpb25Nb2RlLCBjYXBhYmlsaXR5XSlcbilcblxuZXhwb3J0IGRlZmF1bHQgY2xhc3MgQmFja2dyb3VuZEpvYnNNYWluIHtcbiAgLyoqXG4gICAqIFJ1bnMgY29uc3RydWN0b3IuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gT3B0aW9ucy5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9jb25maWd1cmF0aW9uLmpzXCIpLmRlZmF1bHR9IGFyZ3MuY29uZmlndXJhdGlvbiAtIENvbmZpZ3VyYXRpb24uXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBbYXJncy5ob3N0XSAtIEhvc3RuYW1lLlxuICAgKiBAcGFyYW0ge251bWJlcn0gW2FyZ3MucG9ydF0gLSBQb3J0LlxuICAgKiBAcGFyYW0ge3N0cmluZ30gW2FyZ3MuZ2VuZXJhdGlvbklkXSAtIEV4cGxpY2l0IHJlbGVhc2UgZ2VuZXJhdGlvbiBpZGVudGl0eS5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL3R5cGVzLmpzXCIpLkJhY2tncm91bmRKb2JzR2VuZXJhdGlvbkluaXRpYWxTdGF0ZX0gW2FyZ3MuaW5pdGlhbEdlbmVyYXRpb25TdGF0ZV0gLSBFeHBsaWNpdCBnZW5lcmF0aW9uIGJvb3Qgc3RhdGUuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBbYXJncy5saWZlY3ljbGVTb2NrZXRQYXRoXSAtIEV4cGxpY2l0IGxpZmVjeWNsZSBzb2NrZXQgcGF0aC5cbiAgICogQHBhcmFtIHtudW1iZXJ9IFthcmdzLndvcmtlclN0YWxlVGltZW91dE1zXSAtIE92ZXJyaWRlIGhvdyBsb25nIGEgc2lsZW50IHdvcmtlciBtYXkgZ28gYmVmb3JlIGJlaW5nIGRyb3BwZWQgKGRlZmF1bHQgNjAwMDBtcykuXG4gICAqIEBwYXJhbSB7bnVtYmVyfSBbYXJncy53b3JrZXJMaXZlbmVzc1N3ZWVwTXNdIC0gT3ZlcnJpZGUgaG93IG9mdGVuIHN0YWxlIHdvcmtlcnMgYXJlIHN3ZXB0IGZvciAoZGVmYXVsdCAxNTAwMG1zKS5cbiAgICogQHBhcmFtIHtudW1iZXJ9IFthcmdzLndvcmtlclJlY29ubmVjdEdyYWNlTXNdIC0gSW50ZWdlciBmcm9tIDAgdGhyb3VnaCAyLDE0Nyw0ODMsNjQ3IG92ZXJyaWRpbmcgaG93IGxvbmcgcHJldmlvdXMtZ2VuZXJhdGlvbiB3b3JrZXJzIG1heSByZWNvbm5lY3QgYmVmb3JlIGV4YWN0IHN0YXJ0dXAgbGVhc2VzIGFyZSByZWNsYWltZWQgKGRlZmF1bHQgMzAwMDBtcykuXG4gICAqIEBwYXJhbSB7Ym9vbGVhbn0gW2FyZ3MuY2xvc2VEYXRhYmFzZUNvbm5lY3Rpb25zT25TdG9wXSAtIFdoZXRoZXIgc3RvcCBvd25zIGNsb3NpbmcgdGhlIGNvbmZpZ3VyYXRpb24ncyBkYXRhYmFzZSBwb29scyAoZGVmYXVsdCB0cnVlKS5cbiAgICogQHBhcmFtIHsoKSA9PiB2b2lkIHwgUHJvbWlzZTx2b2lkPn0gW2FyZ3Mub25TdG9wcGVkXSAtIExpZmVjeWNsZSBob29rIGludm9rZWQgYWZ0ZXIgdGhlIG1haW4gcHJvY2VzcyBmaW5pc2hlcyBzdG9wcGluZy5cbiAgICogQHBhcmFtIHsoYXJnczoge2hhbmRvZmY6IGltcG9ydChcIi4vdHlwZXMuanNcIikuQmFja2dyb3VuZEpvYkhhbmRvZmYsIGpvYjogaW1wb3J0KFwiLi90eXBlcy5qc1wiKS5CYWNrZ3JvdW5kSm9iUm93fSkgPT4gdm9pZCB8IFByb21pc2U8dm9pZD59IFthcmdzLmFmdGVySGFuZG9mZkNsYWltXSAtIEV4cGxpY2l0IGhhbmRvZmYtY2xhaW0gb2JzZXJ2YXRpb24gaG9vay5cbiAgICogQHBhcmFtIHsod29ya2VyOiBKc29uU29ja2V0KSA9PiB2b2lkfSBbYXJncy5vbldvcmtlclJlYWR5XSAtIEV4cGxpY2l0IHJlYWRpbmVzcyBvYnNlcnZhdGlvbiBob29rLlxuICAgKiBAcGFyYW0geyh3b3JrZXI6IEpzb25Tb2NrZXQpID0+IHZvaWR9IFthcmdzLm9uV29ya2VySGVhcnRiZWF0XSAtIEV4cGxpY2l0IGhlYXJ0YmVhdCBvYnNlcnZhdGlvbiBob29rLlxuICAgKiBAcGFyYW0geyh3b3JrZXJJZDogc3RyaW5nKSA9PiB2b2lkfSBbYXJncy5vbldvcmtlckRpc2Nvbm5lY3RlZF0gLSBFeHBsaWNpdCBnZW5lcmF0aW9uIGRpc2Nvbm5lY3Qgb2JzZXJ2YXRpb24gaG9vay5cbiAgICogQHBhcmFtIHsod29ya2VySWQ6IHN0cmluZykgPT4gdm9pZH0gW2FyZ3Mub25Xb3JrZXJIYW5kb2Zmc1JlbGVhc2VkXSAtIEV4cGxpY2l0IGdyYWNlLWV4cGlyeSBvYnNlcnZhdGlvbiBob29rLlxuICAgKiBAcGFyYW0geyhqb2JzOiBpbXBvcnQoXCIuL3R5cGVzLmpzXCIpLkJhY2tncm91bmRKb2JSb3dbXSkgPT4gdm9pZH0gW2FyZ3Mub25TdGFydHVwSGFuZG9mZnNSZWNsYWltZWRdIC0gRXhwbGljaXQgc3RhcnR1cCByZWNsYWltIG9ic2VydmF0aW9uIGhvb2suXG4gICAqIEBwYXJhbSB7KGFyZ3M6IHthY2NlcHRlZDogYm9vbGVhbiwgam9iSWQ6IHN0cmluZywgc3RhdHVzOiBcImNvbXBsZXRlZFwiIHwgXCJmYWlsZWRcIiB8IFwicmVzY2hlZHVsZWRcIn0pID0+IHZvaWR9IFthcmdzLm9uSm9iVXBkYXRlZF0gLSBFeHBsaWNpdCBkdXJhYmxlIHJlcG9ydCBvYnNlcnZhdGlvbiBob29rLlxuICAgKiBAcGFyYW0ge3tub3c6ICgpID0+IG51bWJlciwgc2V0VGltZW91dD86IChjYWxsYmFjazogKCkgPT4gdm9pZCwgZGVsYXlNczogbnVtYmVyKSA9PiBSZXR1cm5UeXBlPHR5cGVvZiBzZXRUaW1lb3V0PiB8IG51bWJlciwgY2xlYXJUaW1lb3V0PzogKHRpbWVySWQ6IFJldHVyblR5cGU8dHlwZW9mIHNldFRpbWVvdXQ+IHwgbnVtYmVyKSA9PiB2b2lkfX0gW2FyZ3MuY2xvY2tdIC0gSW5qZWN0YWJsZSB3YWxsIGNsb2NrIGZvciBkZXRlcm1pbmlzdGljIGxpZmVjeWNsZSB0ZXN0cy5cbiAgICovXG4gIGNvbnN0cnVjdG9yKHtjb25maWd1cmF0aW9uLCBob3N0LCBwb3J0LCBnZW5lcmF0aW9uSWQ6IGV4cGxpY2l0R2VuZXJhdGlvbklkLCBpbml0aWFsR2VuZXJhdGlvblN0YXRlOiBleHBsaWNpdEluaXRpYWxHZW5lcmF0aW9uU3RhdGUsIGxpZmVjeWNsZVNvY2tldFBhdGg6IGV4cGxpY2l0TGlmZWN5Y2xlU29ja2V0UGF0aCwgd29ya2VyU3RhbGVUaW1lb3V0TXMsIHdvcmtlckxpdmVuZXNzU3dlZXBNcywgd29ya2VyUmVjb25uZWN0R3JhY2VNcywgY2xvc2VEYXRhYmFzZUNvbm5lY3Rpb25zT25TdG9wID0gdHJ1ZSwgb25TdG9wcGVkLCBhZnRlckhhbmRvZmZDbGFpbSwgb25Xb3JrZXJSZWFkeSwgb25Xb3JrZXJIZWFydGJlYXQsIG9uV29ya2VyRGlzY29ubmVjdGVkLCBvbldvcmtlckhhbmRvZmZzUmVsZWFzZWQsIG9uU3RhcnR1cEhhbmRvZmZzUmVjbGFpbWVkLCBvbkpvYlVwZGF0ZWQsIGNsb2NrfSkge1xuICAgIHRoaXMuY29uZmlndXJhdGlvbiA9IGNvbmZpZ3VyYXRpb25cbiAgICB0aGlzLmNsb3NlRGF0YWJhc2VDb25uZWN0aW9uc09uU3RvcCA9IGNsb3NlRGF0YWJhc2VDb25uZWN0aW9uc09uU3RvcFxuICAgIHRoaXMub25TdG9wcGVkID0gb25TdG9wcGVkXG4gICAgdGhpcy5hZnRlckhhbmRvZmZDbGFpbSA9IGFmdGVySGFuZG9mZkNsYWltXG4gICAgdGhpcy5vbldvcmtlclJlYWR5ID0gb25Xb3JrZXJSZWFkeVxuICAgIHRoaXMub25Xb3JrZXJIZWFydGJlYXQgPSBvbldvcmtlckhlYXJ0YmVhdFxuICAgIHRoaXMub25Xb3JrZXJEaXNjb25uZWN0ZWQgPSBvbldvcmtlckRpc2Nvbm5lY3RlZFxuICAgIHRoaXMub25Xb3JrZXJIYW5kb2Zmc1JlbGVhc2VkID0gb25Xb3JrZXJIYW5kb2Zmc1JlbGVhc2VkXG4gICAgdGhpcy5vblN0YXJ0dXBIYW5kb2Zmc1JlY2xhaW1lZCA9IG9uU3RhcnR1cEhhbmRvZmZzUmVjbGFpbWVkXG4gICAgdGhpcy5vbkpvYlVwZGF0ZWQgPSBvbkpvYlVwZGF0ZWRcbiAgICB0aGlzLmNsb2NrID0ge1xuICAgICAgY2xlYXJUaW1lb3V0OiBjbG9jaz8uY2xlYXJUaW1lb3V0IHx8ICgodGltZXJJZCkgPT4gY2xlYXJUaW1lb3V0KHRpbWVySWQpKSxcbiAgICAgIG5vdzogY2xvY2s/Lm5vdyB8fCAoKCkgPT4gRGF0ZS5ub3coKSksXG4gICAgICBzZXRUaW1lb3V0OiBjbG9jaz8uc2V0VGltZW91dCB8fCAoKGNhbGxiYWNrLCBkZWxheU1zKSA9PiBzZXRUaW1lb3V0KGNhbGxiYWNrLCBkZWxheU1zKSlcbiAgICB9XG4gICAgY29uc3QgY29uZmlnID0gY29uZmlndXJhdGlvbi5nZXRCYWNrZ3JvdW5kSm9ic0NvbmZpZygpXG4gICAgY29uc3QgZ2VuZXJhdGlvbkNvbmZpZyA9IGNvbmZpZ3VyYXRpb24ucmVzb2x2ZUJhY2tncm91bmRKb2JzR2VuZXJhdGlvbkNvbmZpZyh7XG4gICAgICBnZW5lcmF0aW9uSWQ6IGV4cGxpY2l0R2VuZXJhdGlvbklkLFxuICAgICAgaW5pdGlhbEdlbmVyYXRpb25TdGF0ZTogZXhwbGljaXRJbml0aWFsR2VuZXJhdGlvblN0YXRlLFxuICAgICAgbGlmZWN5Y2xlU29ja2V0UGF0aDogZXhwbGljaXRMaWZlY3ljbGVTb2NrZXRQYXRoLFxuICAgICAgc291cmNlTmFtZTogXCJCYWNrZ3JvdW5kSm9ic01haW5cIlxuICAgIH0pXG4gICAgdGhpcy5nZW5lcmF0aW9uSWQgPSBnZW5lcmF0aW9uQ29uZmlnLmdlbmVyYXRpb25JZFxuICAgIHRoaXMuaW5pdGlhbEdlbmVyYXRpb25TdGF0ZSA9IGdlbmVyYXRpb25Db25maWcuaW5pdGlhbEdlbmVyYXRpb25TdGF0ZVxuICAgIHRoaXMubGlmZWN5Y2xlU29ja2V0UGF0aCA9IGdlbmVyYXRpb25Db25maWcubGlmZWN5Y2xlU29ja2V0UGF0aFxuICAgIC8qKiBAdHlwZSB7aW1wb3J0KFwiLi90eXBlcy5qc1wiKS5CYWNrZ3JvdW5kSm9ic0dlbmVyYXRpb25MaWZlY3ljbGVTdGF0ZX0gKi9cbiAgICB0aGlzLmxpZmVjeWNsZVN0YXRlID0gXCJzdGFydGluZ1wiXG4gICAgdGhpcy5fYWN0aXZlT3duZXJzaGlwUmVhZHkgPSBmYWxzZVxuICAgIC8qKiBAdHlwZSB7UHJvbWlzZTx2b2lkPiB8IHVuZGVmaW5lZH0gKi9cbiAgICB0aGlzLl9hY3RpdmF0aW9uUHJvbWlzZSA9IHVuZGVmaW5lZFxuICAgIC8qKiBAdHlwZSB7UHJvbWlzZTx2b2lkPiB8IHVuZGVmaW5lZH0gKi9cbiAgICB0aGlzLl9yZXRpcmVtZW50UHJvbWlzZSA9IHVuZGVmaW5lZFxuICAgIC8qKiBAdHlwZSB7U2V0PEpzb25Tb2NrZXQ+fSAqL1xuICAgIHRoaXMuY2FuZGlkYXRlUmVhZHlXb3JrZXJzID0gbmV3IFNldCgpXG4gICAgLyoqIEB0eXBlIHtNYXA8c3RyaW5nLCB7d29ya2VyOiBKc29uU29ja2V0LCB0aW1lcjogUmV0dXJuVHlwZTx0eXBlb2Ygc2V0VGltZW91dD4gfCBudW1iZXJ9Pn0gKi9cbiAgICB0aGlzLmRpc2Nvbm5lY3RlZFdvcmtlcnMgPSBuZXcgTWFwKClcbiAgICB0aGlzLl9saWZlY3ljbGVSZXF1ZXN0TGVhc2VzID0gMFxuICAgIHRoaXMuX2FjdGl2ZU5vbldvcmtlclJlcXVlc3RzID0gMFxuICAgIC8qKlxuICAgICAqIFJlc29sdmVzIHN0b3Agb2JzZXJ2YXRpb24uXG4gICAgICogQHR5cGUgeygpID0+IHZvaWR9XG4gICAgICovXG4gICAgdGhpcy5fcmVzb2x2ZVN0b3BwZWQgPSAoKSA9PiB7fVxuICAgIHRoaXMuX3N0b3BwZWRQcm9taXNlID0gbmV3IFByb21pc2UoKC8qKiBAdHlwZSB7KHZhbHVlOiB2b2lkKSA9PiB2b2lkfSAqLyByZXNvbHZlKSA9PiB7IHRoaXMuX3Jlc29sdmVTdG9wcGVkID0gcmVzb2x2ZSB9KVxuICAgIHRoaXMuaG9zdCA9IGhvc3QgfHwgY29uZmlnLmhvc3RcbiAgICB0aGlzLnBvcnQgPSB0eXBlb2YgcG9ydCA9PT0gXCJudW1iZXJcIiA/IHBvcnQgOiBjb25maWcucG9ydFxuICAgIHRoaXMuZGlzcGF0Y2hTdHJhdGVneSA9IGNvbmZpZy5kaXNwYXRjaFN0cmF0ZWd5XG4gICAgdGhpcy5wb2xsSW50ZXJ2YWxNcyA9IGNvbmZpZy5wb2xsSW50ZXJ2YWxNc1xuICAgIHRoaXMucmV0ZW50aW9uID0gY29uZmlnLnJldGVudGlvblxuICAgIC8vIEEgd29ya2VyIHRoYXQgc3RvcHMgc2VuZGluZyBhbnl0aGluZyAoaGVhcnRiZWF0L3JlYWR5L3JlcG9ydCkgZm9yIHRoaXNcbiAgICAvLyBsb25nIGlzIHRyZWF0ZWQgYXMgd2VkZ2VkL2RlYWQ6IGl0cyBsZWFzZXMgYXJlIHJlbGVhc2VkIGFuZCBpdCBpcyBkcm9wcGVkLlxuICAgIHRoaXMud29ya2VyU3RhbGVUaW1lb3V0TXMgPSB0eXBlb2Ygd29ya2VyU3RhbGVUaW1lb3V0TXMgPT09IFwibnVtYmVyXCIgJiYgd29ya2VyU3RhbGVUaW1lb3V0TXMgPj0gMSA/IHdvcmtlclN0YWxlVGltZW91dE1zIDogV09SS0VSX1NUQUxFX1RJTUVPVVRfTVNcbiAgICB0aGlzLndvcmtlckxpdmVuZXNzU3dlZXBNcyA9IHR5cGVvZiB3b3JrZXJMaXZlbmVzc1N3ZWVwTXMgPT09IFwibnVtYmVyXCIgJiYgd29ya2VyTGl2ZW5lc3NTd2VlcE1zID49IDEgPyB3b3JrZXJMaXZlbmVzc1N3ZWVwTXMgOiBXT1JLRVJfTElWRU5FU1NfU1dFRVBfTVNcbiAgICB0aGlzLndvcmtlclJlY29ubmVjdEdyYWNlTXMgPSBub3JtYWxpemVXb3JrZXJSZWNvbm5lY3RHcmFjZU1zKHdvcmtlclJlY29ubmVjdEdyYWNlTXMpXG4gICAgLyoqIEB0eXBlIHtpbXBvcnQoXCIuL2FkYXB0ZXIuanNcIikuZGVmYXVsdCB8IHVuZGVmaW5lZH0gKi9cbiAgICB0aGlzLmFkYXB0ZXIgPSB1bmRlZmluZWRcbiAgICB0aGlzLmxvZ2dlciA9IG5ldyBMb2dnZXIodGhpcylcbiAgICAvKipcbiAgICAgKiBOYXJyb3dzIHRoZSBydW50aW1lIHZhbHVlIHRvIHRoZSBkb2N1bWVudGVkIHR5cGUuXG4gICAgICogQHR5cGUge1NldDxKc29uU29ja2V0Pn0gKi9cbiAgICB0aGlzLndvcmtlcnMgPSBuZXcgU2V0KClcbiAgICAvKiogQHR5cGUge1NldDxKc29uU29ja2V0Pn0gKi9cbiAgICB0aGlzLmNvbm5lY3Rpb25zID0gbmV3IFNldCgpXG4gICAgLyoqXG4gICAgICogTmFycm93cyB0aGUgcnVudGltZSB2YWx1ZSB0byB0aGUgZG9jdW1lbnRlZCB0eXBlLlxuICAgICAqIEB0eXBlIHtTZXQ8SnNvblNvY2tldD59ICovXG4gICAgdGhpcy5yZWFkeVdvcmtlcnMgPSBuZXcgU2V0KClcbiAgICAvKipcbiAgICAgKiBBY3RpdmUgZHVyYWJsZSBoYW5kb2ZmcyBrZXllZCBieSB0aGUgZXhhY3Qgd29ya2VyIHNvY2tldCB0aGF0IHJlY2VpdmVkIHRoZW0uXG4gICAgICogQHR5cGUge01hcDxKc29uU29ja2V0LCBNYXA8c3RyaW5nLCBzdHJpbmc+Pn0gKi9cbiAgICB0aGlzLndvcmtlckhhbmRvZmZzID0gbmV3IE1hcCgpXG4gICAgLyoqXG4gICAgICogRXhhY3QgY2FsbGVyLWdlbmVyYXRlZCBsZWFzZXMgd2hvc2UgY2xhaW0gb3V0Y29tZSB3YXMgYW1iaWd1b3VzIG9yIHdob3NlXG4gICAgICogcHJlLWRpc3BhdGNoIHJlbGVhc2UgaGFzIG5vdCB5ZXQgYmVlbiBhY2tub3dsZWRnZWQuIFJldGFpbmVkIHVudGlsIGFcbiAgICAgKiBmZW5jZWQgcmV0dXJuIHN1Y2NlZWRzIChpbmNsdWRpbmcgYW4gZXhhY3Qgbm8tb3ApLlxuICAgICAqIEB0eXBlIHtNYXA8c3RyaW5nLCBzdHJpbmc+fSAqL1xuICAgIHRoaXMucGVuZGluZ0hhbmRvZmZSZWNvdmVyaWVzID0gbmV3IE1hcCgpXG4gICAgLyoqXG4gICAgICogSGFuZG9mZi1hZG9wdGlvbiBxdWVyaWVzIHN0YXJ0ZWQgYnkgd29ya2VyIGhlbGxvIG1lc3NhZ2VzLiBTaHV0ZG93biBtdXN0XG4gICAgICogd2FpdCBmb3IgdGhlc2UgYmVmb3JlIGNsb3NpbmcgdGhlIGNvbmZpZ3VyYXRpb24ncyBkYXRhYmFzZSBwb29scy5cbiAgICAgKiBAdHlwZSB7U2V0PFByb21pc2U8dm9pZD4+fSAqL1xuICAgIHRoaXMuaW5mbGlnaHRXb3JrZXJIYW5kb2ZmQWRvcHRpb25zID0gbmV3IFNldCgpXG4gICAgLyoqXG4gICAgICogV29ya2VyIGlkcyB3aG9zZSBoYW5kb2ZmcyB3ZXJlIHN1Y2Nlc3NmdWxseSBhZG9wdGVkIGJ5IGEgc3RpbGwtbGl2ZVxuICAgICAqIGNvbm5lY3Rpb24gaW4gdGhpcyBtYWluIGdlbmVyYXRpb24uXG4gICAgICogQHR5cGUge1NldDxzdHJpbmc+fVxuICAgICAqL1xuICAgIHRoaXMucmVjb25uZWN0ZWRXb3JrZXJJZHMgPSBuZXcgU2V0KClcbiAgICAvKiogQHR5cGUge2ltcG9ydChcIi4vdHlwZXMuanNcIikuQmFja2dyb3VuZEpvYkhhbmRvZmZTbmFwc2hvdFtdfSAqL1xuICAgIHRoaXMuc3RhcnR1cEhhbmRvZmZTbmFwc2hvdCA9IFtdXG4gICAgLyoqIEB0eXBlIHtQcm9taXNlPHZvaWQ+W119ICovXG4gICAgdGhpcy5fc3RhcnR1cEhhbmRvZmZBZG9wdGlvbnNBdERlYWRsaW5lID0gW11cbiAgICB0aGlzLl9zdGFydHVwSGFuZG9mZkdyYWNlRWxhcHNlZCA9IGZhbHNlXG4gICAgLyoqXG4gICAgICogTmFycm93cyB0aGUgcnVudGltZSB2YWx1ZSB0byB0aGUgZG9jdW1lbnRlZCB0eXBlLlxuICAgICAqIEB0eXBlIHtuZXQuU2VydmVyIHwgdW5kZWZpbmVkfSAqL1xuICAgIHRoaXMuc2VydmVyID0gdW5kZWZpbmVkXG4gICAgLyoqXG4gICAgICogTmFycm93cyB0aGUgcnVudGltZSB2YWx1ZSB0byB0aGUgZG9jdW1lbnRlZCB0eXBlLlxuICAgICAqIEB0eXBlIHtSZXR1cm5UeXBlPHR5cGVvZiBzZXRUaW1lb3V0PiB8IHVuZGVmaW5lZH0gKi9cbiAgICB0aGlzLl9wb2xsVGltZXIgPSB1bmRlZmluZWRcbiAgICAvKipcbiAgICAgKiBOYXJyb3dzIHRoZSBydW50aW1lIHZhbHVlIHRvIHRoZSBkb2N1bWVudGVkIHR5cGUuXG4gICAgICogQHR5cGUge1JldHVyblR5cGU8dHlwZW9mIHNldFRpbWVvdXQ+IHwgdW5kZWZpbmVkfSAqL1xuICAgIHRoaXMuX3NjaGVkdWxlZFRpbWVyID0gdW5kZWZpbmVkXG4gICAgLyoqXG4gICAgICogTmFycm93cyB0aGUgcnVudGltZSB2YWx1ZSB0byB0aGUgZG9jdW1lbnRlZCB0eXBlLlxuICAgICAqIEB0eXBlIHtSZXR1cm5UeXBlPHR5cGVvZiBzZXRUaW1lb3V0PiB8IHVuZGVmaW5lZH0gKi9cbiAgICB0aGlzLl9lcnJvclJldHJ5VGltZXIgPSB1bmRlZmluZWRcbiAgICAvKipcbiAgICAgKiBOYXJyb3dzIHRoZSBydW50aW1lIHZhbHVlIHRvIHRoZSBkb2N1bWVudGVkIHR5cGUuXG4gICAgICogQHR5cGUge1JldHVyblR5cGU8dHlwZW9mIHNldFRpbWVvdXQ+IHwgdW5kZWZpbmVkfSAqL1xuICAgIHRoaXMuX29ycGhhblRpbWVyID0gdW5kZWZpbmVkXG4gICAgLyoqXG4gICAgICogTmFycm93cyB0aGUgcnVudGltZSB2YWx1ZSB0byB0aGUgZG9jdW1lbnRlZCB0eXBlLlxuICAgICAqIEB0eXBlIHtSZXR1cm5UeXBlPHR5cGVvZiBzZXRJbnRlcnZhbD4gfCB1bmRlZmluZWR9ICovXG4gICAgdGhpcy5fd29ya2VyU3RhbGVUaW1lciA9IHVuZGVmaW5lZFxuICAgIC8qKiBAdHlwZSB7UmV0dXJuVHlwZTx0eXBlb2Ygc2V0VGltZW91dD4gfCBudW1iZXIgfCB1bmRlZmluZWR9ICovXG4gICAgdGhpcy5fc3RhcnR1cEhhbmRvZmZSZWNsYWltVGltZXIgPSB1bmRlZmluZWRcbiAgICAvKiogQHR5cGUge1Byb21pc2U8dm9pZD4gfCB1bmRlZmluZWR9ICovXG4gICAgdGhpcy5fc3RhcnR1cEhhbmRvZmZSZWNsYWltUHJvbWlzZSA9IHVuZGVmaW5lZFxuICAgIC8qKlxuICAgICAqIE5hcnJvd3MgdGhlIHJ1bnRpbWUgdmFsdWUgdG8gdGhlIGRvY3VtZW50ZWQgdHlwZS5cbiAgICAgKiBAdHlwZSB7QmFja2dyb3VuZEpvYnNTY2hlZHVsZXIgfCB1bmRlZmluZWR9ICovXG4gICAgdGhpcy5zY2hlZHVsZXIgPSB1bmRlZmluZWRcbiAgICB0aGlzLl9kcmFpbmluZyA9IGZhbHNlXG4gICAgdGhpcy5fcmVkcmFpblF1ZXVlZCA9IGZhbHNlXG4gICAgLyoqIEB0eXBlIHtQcm9taXNlPHZvaWQ+IHwgdW5kZWZpbmVkfSAqL1xuICAgIHRoaXMuX2RyYWluUHJvbWlzZSA9IHVuZGVmaW5lZFxuICAgIHRoaXMuX3N0b3BwZWQgPSBmYWxzZVxuICAgIC8qKiBAdHlwZSB7UHJvbWlzZTx2b2lkPiB8IHVuZGVmaW5lZH0gKi9cbiAgICB0aGlzLnN0b3BQcm9taXNlID0gdW5kZWZpbmVkXG4gICAgLyoqXG4gICAgICogTmFycm93cyB0aGUgcnVudGltZSB2YWx1ZSB0byB0aGUgZG9jdW1lbnRlZCB0eXBlLlxuICAgICAqIEB0eXBlIHsoKCkgPT4gdm9pZCkgfCB1bmRlZmluZWR9ICovXG4gICAgdGhpcy5fdW5zdWJzY3JpYmVCZWFjb24gPSB1bmRlZmluZWRcbiAgICAvKipcbiAgICAgKiBOYXJyb3dzIHRoZSBydW50aW1lIHZhbHVlIHRvIHRoZSBkb2N1bWVudGVkIHR5cGUuXG4gICAgICogQHR5cGUgeygoLi4uYXJnczogQXJyYXk8UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+KSA9PiB2b2lkKSB8IHVuZGVmaW5lZH0gKi9cbiAgICB0aGlzLl9iZWFjb25Db25uZWN0SGFuZGxlciA9IHVuZGVmaW5lZFxuICAgIC8qKlxuICAgICAqIE5hcnJvd3MgdGhlIHJ1bnRpbWUgdmFsdWUgdG8gdGhlIGRvY3VtZW50ZWQgdHlwZS5cbiAgICAgKiBAdHlwZSB7aW1wb3J0KFwiLi4vYmVhY29uL2NsaWVudC5qc1wiKS5kZWZhdWx0IHwgaW1wb3J0KFwiLi4vYmVhY29uL2luLXByb2Nlc3MtY2xpZW50LmpzXCIpLmRlZmF1bHQgfCB1bmRlZmluZWR9ICovXG4gICAgdGhpcy5fYmVhY29uQ2xpZW50ID0gdW5kZWZpbmVkXG4gICAgLyoqIEB0eXBlIHtCYWNrZ3JvdW5kSm9ic0xpZmVjeWNsZUNvbnRyb2xTZXJ2ZXIgfCB1bmRlZmluZWR9ICovXG4gICAgdGhpcy5saWZlY3ljbGVDb250cm9sU2VydmVyID0gdW5kZWZpbmVkXG4gIH1cblxuICAvKipcbiAgICogQ29tcGF0aWJpbGl0eSBhbGlhcyBmb3IgaW50ZWdyYXRpb25zIHRoYXQgaW5zcGVjdCB0aGUgYWN0aXZlIG1haW4gc3RvcmUuXG4gICAqIEByZXR1cm5zIHtpbXBvcnQoXCIuL2FkYXB0ZXIuanNcIikuZGVmYXVsdH0gLSBBZGFwdGVyIGFjcXVpcmVkIGJ5IHN0YXJ0LlxuICAgKi9cbiAgZ2V0IHN0b3JlKCkge1xuICAgIGlmICghdGhpcy5hZGFwdGVyKSB0aHJvdyBuZXcgRXJyb3IoXCJCYWNrZ3JvdW5kIGpvYnMgbWFpbiBoYXMgbm90IGFjcXVpcmVkIGl0cyBhZGFwdGVyXCIpXG5cbiAgICByZXR1cm4gdGhpcy5hZGFwdGVyXG4gIH1cblxuICAvKipcbiAgICogUHJlc2VydmVzIHRoZSBoaXN0b3JpY2FsIHN1YmNsYXNzIHNlYW0gd2hpbGUga2VlcGluZyBvbmUgYWRhcHRlciByZWZlcmVuY2UuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi9hZGFwdGVyLmpzXCIpLmRlZmF1bHR9IGFkYXB0ZXIgLSBBZGFwdGVyIHRvIGFzc2lnbi5cbiAgICovXG4gIHNldCBzdG9yZShhZGFwdGVyKSB7XG4gICAgdGhpcy5hZGFwdGVyID0gYWRhcHRlclxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgc3RhcnQuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIHdoZW4gbGlzdGVuaW5nLlxuICAgKi9cbiAgYXN5bmMgc3RhcnQoKSB7XG4gICAgdGhpcy5fc3RvcHBlZCA9IGZhbHNlXG4gICAgdGhpcy5zdG9wUHJvbWlzZSA9IHVuZGVmaW5lZFxuICAgIHRoaXMuX2FjdGl2ZU93bmVyc2hpcFJlYWR5ID0gZmFsc2VcbiAgICB0aGlzLmxpZmVjeWNsZVN0YXRlID0gXCJzdGFydGluZ1wiXG4gICAgdGhpcy5fc3RvcHBlZFByb21pc2UgPSBuZXcgUHJvbWlzZSgoLyoqIEB0eXBlIHsodmFsdWU6IHZvaWQpID0+IHZvaWR9ICovIHJlc29sdmUpID0+IHsgdGhpcy5fcmVzb2x2ZVN0b3BwZWQgPSByZXNvbHZlIH0pXG4gICAgdGhpcy5yZWNvbm5lY3RlZFdvcmtlcklkcy5jbGVhcigpXG4gICAgdGhpcy5zdGFydHVwSGFuZG9mZlNuYXBzaG90ID0gW11cbiAgICB0aGlzLl9zdGFydHVwSGFuZG9mZkFkb3B0aW9uc0F0RGVhZGxpbmUgPSBbXVxuICAgIHRoaXMuX3N0YXJ0dXBIYW5kb2ZmR3JhY2VFbGFwc2VkID0gZmFsc2VcbiAgICB0aGlzLl9zdGFydHVwSGFuZG9mZlJlY2xhaW1Qcm9taXNlID0gdW5kZWZpbmVkXG4gICAgdGhpcy5jb25maWd1cmF0aW9uLnNldEN1cnJlbnQoKVxuXG4gICAgdHJ5IHtcbiAgICAgIGF3YWl0IHRoaXMuY29uZmlndXJhdGlvbi5pbml0aWFsaXplKHt0eXBlOiBcImJhY2tncm91bmQtam9icy1tYWluXCJ9KVxuICAgICAgYXdhaXQgdGhpcy5jb25maWd1cmF0aW9uLmNvbm5lY3RCZWFjb24oe3BlZXJUeXBlOiBcImJhY2tncm91bmQtam9icy1tYWluXCJ9KVxuXG4gICAgICBpZiAoIXRoaXMuYWRhcHRlcikge1xuICAgICAgICB0aGlzLmFkYXB0ZXIgPSBhd2FpdCB0aGlzLmNvbmZpZ3VyYXRpb24uYWNxdWlyZVJlYWR5QmFja2dyb3VuZEpvYnNBZGFwdGVyKClcbiAgICAgIH1cbiAgICAgIGlmICh0aGlzLmdlbmVyYXRpb25JZCAmJiAhdGhpcy5hZGFwdGVyLnN1cHBvcnRzUmVsZWFzZVNjb3BlZEdlbmVyYXRpb25zKCkpIHtcbiAgICAgICAgdGhyb3cgbmV3IEVycm9yKFwiVGhlIGNvbmZpZ3VyZWQgYmFja2dyb3VuZCBqb2JzIGFkYXB0ZXIgZG9lcyBub3Qgc3VwcG9ydCByZWxlYXNlLXNjb3BlZCBnZW5lcmF0aW9uc1wiKVxuICAgICAgfVxuXG4gICAgICBpZiAoIXRoaXMuZ2VuZXJhdGlvbklkIHx8IHRoaXMuaW5pdGlhbEdlbmVyYXRpb25TdGF0ZSAhPT0gXCJjYW5kaWRhdGVcIikge1xuICAgICAgICB0aGlzLnN0YXJ0dXBIYW5kb2ZmU25hcHNob3QgPSBhd2FpdCB0aGlzLl9nZW5lcmF0aW9uT3duZWRIYW5kb2ZmU25hcHNob3QoKVxuICAgICAgfVxuICAgICAgY29uc3Qgc2VydmVyID0gbmV0LmNyZWF0ZVNlcnZlcigoc29ja2V0KSA9PiB0aGlzLl9oYW5kbGVDb25uZWN0aW9uKHNvY2tldCkpXG4gICAgICB0aGlzLnNlcnZlciA9IHNlcnZlclxuXG4gICAgICBhd2FpdCBuZXcgUHJvbWlzZSgocmVzb2x2ZSwgcmVqZWN0KSA9PiB7XG4gICAgICAgIHNlcnZlci5vbmNlKFwiZXJyb3JcIiwgcmVqZWN0KVxuICAgICAgICBzZXJ2ZXIubGlzdGVuKHRoaXMucG9ydCwgdGhpcy5ob3N0LCAoKSA9PiByZXNvbHZlKHVuZGVmaW5lZCkpXG4gICAgICB9KVxuXG4gICAgICBjb25zdCBhZGRyZXNzID0gc2VydmVyLmFkZHJlc3MoKVxuICAgICAgaWYgKGFkZHJlc3MgJiYgdHlwZW9mIGFkZHJlc3MgPT09IFwib2JqZWN0XCIpIHtcbiAgICAgICAgdGhpcy5wb3J0ID0gYWRkcmVzcy5wb3J0XG4gICAgICB9XG5cbiAgICAgIHRoaXMubGlmZWN5Y2xlU3RhdGUgPSB0aGlzLmdlbmVyYXRpb25JZCA/IHRoaXMuaW5pdGlhbEdlbmVyYXRpb25TdGF0ZSA6IFwiYWN0aXZlXCJcblxuICAgICAgaWYgKHRoaXMuZ2VuZXJhdGlvbklkICYmIHRoaXMubGlmZWN5Y2xlU29ja2V0UGF0aCkge1xuICAgICAgICB0aGlzLmxpZmVjeWNsZUNvbnRyb2xTZXJ2ZXIgPSBuZXcgQmFja2dyb3VuZEpvYnNMaWZlY3ljbGVDb250cm9sU2VydmVyKHtcbiAgICAgICAgICBjb25maWd1cmF0aW9uOiB0aGlzLmNvbmZpZ3VyYXRpb24sXG4gICAgICAgICAgZ2VuZXJhdGlvbklkOiB0aGlzLmdlbmVyYXRpb25JZCxcbiAgICAgICAgICBtYWluOiB0aGlzLFxuICAgICAgICAgIHNvY2tldFBhdGg6IHRoaXMubGlmZWN5Y2xlU29ja2V0UGF0aFxuICAgICAgICB9KVxuICAgICAgICBhd2FpdCB0aGlzLmxpZmVjeWNsZUNvbnRyb2xTZXJ2ZXIuc3RhcnQoKVxuICAgICAgfVxuXG4gICAgICB0aGlzLl93b3JrZXJTdGFsZVRpbWVyID0gc2V0SW50ZXJ2YWwoKCkgPT4ge1xuICAgICAgICB2b2lkIHRoaXMuX3N3ZWVwU3RhbGVXb3JrZXJzKClcbiAgICAgIH0sIHRoaXMud29ya2VyTGl2ZW5lc3NTd2VlcE1zKVxuXG4gICAgICBpZiAodGhpcy5saWZlY3ljbGVTdGF0ZSA9PT0gXCJhY3RpdmVcIikge1xuICAgICAgICBhd2FpdCB0aGlzLl9zdGFydEFjdGl2ZU93bmVyc2hpcCgpXG4gICAgICB9IGVsc2UgaWYgKHRoaXMubGlmZWN5Y2xlU3RhdGUgPT09IFwicmV0aXJlZFwiKSB7XG4gICAgICAgIHRoaXMuX3N0YXJ0R2VuZXJhdGlvblJlY292ZXJ5T3duZXJzaGlwKClcbiAgICAgIH1cbiAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgbGV0IGNsZWFudXBFcnJvclxuXG4gICAgICB0cnkge1xuICAgICAgICBhd2FpdCB0aGlzLnN0b3AoKVxuICAgICAgfSBjYXRjaCAoY2F1Z2h0Q2xlYW51cEVycm9yKSB7XG4gICAgICAgIGNsZWFudXBFcnJvciA9IGNhdWdodENsZWFudXBFcnJvclxuICAgICAgfVxuXG4gICAgICBpZiAoY2xlYW51cEVycm9yKSB7XG4gICAgICAgIHRocm93IG5ldyBBZ2dyZWdhdGVFcnJvcihcbiAgICAgICAgICBbZXJyb3IsIGNsZWFudXBFcnJvcl0sXG4gICAgICAgICAgXCJCYWNrZ3JvdW5kIGpvYnMgbWFpbiBzdGFydHVwIGFuZCBjbGVhbnVwIGZhaWxlZFwiLFxuICAgICAgICAgIHtjYXVzZTogZXJyb3J9XG4gICAgICAgIClcbiAgICAgIH1cblxuICAgICAgdGhyb3cgZXJyb3JcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogUnVucyBzdG9wLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyB3aGVuIGNsb3NlZC5cbiAgICovXG4gIHN0b3AoKSB7XG4gICAgaWYgKCF0aGlzLnN0b3BQcm9taXNlKSB0aGlzLnN0b3BQcm9taXNlID0gdGhpcy5fc3RvcCgpXG5cbiAgICByZXR1cm4gdGhpcy5zdG9wUHJvbWlzZVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgdGhlIG1haW4tcHJvY2VzcyBzaHV0ZG93biBsaWZlY3ljbGUgb25jZS5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgd2hlbiBjbG9zZWQuXG4gICAqL1xuICBhc3luYyBfc3RvcCgpIHtcbiAgICB0aGlzLl9zdG9wcGVkID0gdHJ1ZVxuXG4gICAgdHJ5IHtcbiAgICAgIGF3YWl0IHNodXRkb3duTGlmZWN5Y2xlKHtcbiAgICAgICAgb25TdG9wcGVkOiB0aGlzLm9uU3RvcHBlZCxcbiAgICAgICAgc2h1dGRvd246IGFzeW5jICgpID0+IHtcbiAgICAgICAgICB0aGlzLl9jbG9zZVdvcmtlcnMoKVxuICAgICAgICAgIHRoaXMuX2NsZWFyVGltZXJzKClcbiAgICAgICAgICB0aGlzLl9kaXNjb25uZWN0QmVhY29uSGFuZGxlcnMoKVxuICAgICAgICAgIHRyeSB7XG4gICAgICAgICAgICBhd2FpdCB0aGlzLnNjaGVkdWxlcj8uc3RvcCgpXG4gICAgICAgICAgICBpZiAodGhpcy5fZHJhaW5Qcm9taXNlKSBhd2FpdCB0aGlzLl9kcmFpblByb21pc2VcbiAgICAgICAgICB9IGZpbmFsbHkge1xuICAgICAgICAgICAgdHJ5IHtcbiAgICAgICAgICAgICAgYXdhaXQgdGhpcy5fZHJhaW5Xb3JrZXJIYW5kb2ZmQWRvcHRpb25zKClcbiAgICAgICAgICAgIH0gZmluYWxseSB7XG4gICAgICAgICAgICAgIHRyeSB7XG4gICAgICAgICAgICAgICAgYXdhaXQgdGhpcy5fZHJhaW5TdGFydHVwSGFuZG9mZlJlY2xhaW0oKVxuICAgICAgICAgICAgICB9IGZpbmFsbHkge1xuICAgICAgICAgICAgICAgIGF3YWl0IHRoaXMuX3N0b3BCZWFjb25BbmRTZXJ2ZXIoKVxuICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9XG4gICAgICAgICAgfVxuICAgICAgICB9XG4gICAgICB9KVxuICAgIH0gZmluYWxseSB7XG4gICAgICB0aGlzLmFkYXB0ZXIgPSB1bmRlZmluZWRcbiAgICAgIHRoaXMubGlmZWN5Y2xlU3RhdGUgPSBcInN0b3BwZWRcIlxuICAgICAgdGhpcy5fcmVzb2x2ZVN0b3BwZWQoKVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGNsb3NlIHdvcmtlcnMuXG4gICAqIEByZXR1cm5zIHt2b2lkfSAqL1xuICBfY2xvc2VXb3JrZXJzKCkge1xuICAgIGZvciAoY29uc3QgY29ubmVjdGlvbiBvZiB0aGlzLmNvbm5lY3Rpb25zKSB7XG4gICAgICBjb25uZWN0aW9uLmNsb3NlKClcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogUnVucyBjbGVhciB0aW1lcnMuXG4gICAqIEByZXR1cm5zIHt2b2lkfSAqL1xuICBfY2xlYXJUaW1lcnMoKSB7XG4gICAgaWYgKHRoaXMuX3BvbGxUaW1lcikgY2xlYXJJbnRlcnZhbCh0aGlzLl9wb2xsVGltZXIpXG4gICAgaWYgKHRoaXMuX3NjaGVkdWxlZFRpbWVyKSBjbGVhclRpbWVvdXQodGhpcy5fc2NoZWR1bGVkVGltZXIpXG4gICAgaWYgKHRoaXMuX2Vycm9yUmV0cnlUaW1lcikgY2xlYXJUaW1lb3V0KHRoaXMuX2Vycm9yUmV0cnlUaW1lcilcbiAgICBpZiAodGhpcy5fb3JwaGFuVGltZXIpIGNsZWFySW50ZXJ2YWwodGhpcy5fb3JwaGFuVGltZXIpXG4gICAgaWYgKHRoaXMuX3dvcmtlclN0YWxlVGltZXIpIGNsZWFySW50ZXJ2YWwodGhpcy5fd29ya2VyU3RhbGVUaW1lcilcbiAgICBpZiAodGhpcy5fc3RhcnR1cEhhbmRvZmZSZWNsYWltVGltZXIpIHRoaXMuY2xvY2suY2xlYXJUaW1lb3V0KHRoaXMuX3N0YXJ0dXBIYW5kb2ZmUmVjbGFpbVRpbWVyKVxuICAgIGZvciAoY29uc3Qge3RpbWVyfSBvZiB0aGlzLmRpc2Nvbm5lY3RlZFdvcmtlcnMudmFsdWVzKCkpIHRoaXMuY2xvY2suY2xlYXJUaW1lb3V0KHRpbWVyKVxuICAgIHRoaXMuZGlzY29ubmVjdGVkV29ya2Vycy5jbGVhcigpXG4gICAgdGhpcy5fcG9sbFRpbWVyID0gdW5kZWZpbmVkXG4gICAgdGhpcy5fc2NoZWR1bGVkVGltZXIgPSB1bmRlZmluZWRcbiAgICB0aGlzLl9lcnJvclJldHJ5VGltZXIgPSB1bmRlZmluZWRcbiAgICB0aGlzLl9vcnBoYW5UaW1lciA9IHVuZGVmaW5lZFxuICAgIHRoaXMuX3dvcmtlclN0YWxlVGltZXIgPSB1bmRlZmluZWRcbiAgICB0aGlzLl9zdGFydHVwSGFuZG9mZlJlY2xhaW1UaW1lciA9IHVuZGVmaW5lZFxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZGlzY29ubmVjdCBiZWFjb24gaGFuZGxlcnMuXG4gICAqIEByZXR1cm5zIHt2b2lkfSAqL1xuICBfZGlzY29ubmVjdEJlYWNvbkhhbmRsZXJzKCkge1xuICAgIGlmICh0aGlzLl91bnN1YnNjcmliZUJlYWNvbikge1xuICAgICAgdGhpcy5fdW5zdWJzY3JpYmVCZWFjb24oKVxuICAgICAgdGhpcy5fdW5zdWJzY3JpYmVCZWFjb24gPSB1bmRlZmluZWRcbiAgICB9XG5cbiAgICBpZiAodGhpcy5fYmVhY29uQ2xpZW50ICYmIHRoaXMuX2JlYWNvbkNvbm5lY3RIYW5kbGVyKSB7XG4gICAgICB0aGlzLl9iZWFjb25DbGllbnQub2ZmKFwiY29ubmVjdFwiLCB0aGlzLl9iZWFjb25Db25uZWN0SGFuZGxlcilcbiAgICB9XG4gICAgdGhpcy5fYmVhY29uQ29ubmVjdEhhbmRsZXIgPSB1bmRlZmluZWRcbiAgICB0aGlzLl9iZWFjb25DbGllbnQgPSB1bmRlZmluZWRcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHN0b3AgYmVhY29uIGFuZCBzZXJ2ZXIuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAqL1xuICBhc3luYyBfc3RvcEJlYWNvbkFuZFNlcnZlcigpIHtcbiAgICBhd2FpdCBydW5TaHV0ZG93blN0ZXBzKHtcbiAgICAgIG1lc3NhZ2U6IFwiQmFja2dyb3VuZCBqb2JzIG1haW4gYXBwbGljYXRpb24gYW5kIGZyYW1ld29yayBzaHV0ZG93biBmYWlsZWRcIixcbiAgICAgIHN0ZXBzOiBbXG4gICAgICAgIGFzeW5jICgpID0+IHtcbiAgICAgICAgICB0cnkge1xuICAgICAgICAgICAgYXdhaXQgdGhpcy5saWZlY3ljbGVDb250cm9sU2VydmVyPy5jbG9zZSgpXG4gICAgICAgICAgfSBmaW5hbGx5IHtcbiAgICAgICAgICAgIHRoaXMubGlmZWN5Y2xlQ29udHJvbFNlcnZlciA9IHVuZGVmaW5lZFxuICAgICAgICAgIH1cbiAgICAgICAgfSxcbiAgICAgICAgLi4uKHRoaXMuY2xvc2VEYXRhYmFzZUNvbm5lY3Rpb25zT25TdG9wXG4gICAgICAgICAgPyBbYXN5bmMgKCkgPT4gYXdhaXQgdGhpcy5jb25maWd1cmF0aW9uLnNodXRkb3duKCldXG4gICAgICAgICAgOiBbXSksXG4gICAgICAgIGFzeW5jICgpID0+IGF3YWl0IHRoaXMuY29uZmlndXJhdGlvbi5kaXNjb25uZWN0QmVhY29uKCksXG4gICAgICAgIGFzeW5jICgpID0+IGF3YWl0IHRoaXMuX2Nsb3NlU2VydmVyKCksXG4gICAgICAgIGFzeW5jICgpID0+IHtcbiAgICAgICAgICBpZiAodGhpcy5jbG9zZURhdGFiYXNlQ29ubmVjdGlvbnNPblN0b3ApIHtcbiAgICAgICAgICAgIGF3YWl0IHRoaXMuY29uZmlndXJhdGlvbi5jbG9zZURhdGFiYXNlQ29ubmVjdGlvbnMoKVxuICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICBhd2FpdCB0aGlzLmNvbmZpZ3VyYXRpb24uY2xvc2VCYWNrZ3JvdW5kSm9ic0FkYXB0ZXIoKVxuICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgICAgXVxuICAgIH0pXG4gIH1cblxuICAvKipcbiAgICogUnVucyBjbG9zZSBzZXJ2ZXIuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAqL1xuICBhc3luYyBfY2xvc2VTZXJ2ZXIoKSB7XG4gICAgaWYgKCF0aGlzLnNlcnZlcikgcmV0dXJuXG5cbiAgICBjb25zdCB7c2VydmVyfSA9IHRoaXNcbiAgICB0aGlzLnNlcnZlciA9IHVuZGVmaW5lZFxuICAgIGF3YWl0IG5ldyBQcm9taXNlKChyZXNvbHZlKSA9PiBzZXJ2ZXIuY2xvc2UoKCkgPT4gcmVzb2x2ZSh1bmRlZmluZWQpKSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGdldCBwb3J0LlxuICAgKiBAcmV0dXJucyB7bnVtYmVyfSAtIEJvdW5kIHBvcnQuXG4gICAqL1xuICBnZXRQb3J0KCkge1xuICAgIHJldHVybiB0aGlzLnBvcnRcbiAgfVxuXG4gIC8qKlxuICAgKiBHZXRzIHRoZSBsaWZlY3ljbGUgc3RhdGUuXG4gICAqIEByZXR1cm5zIHtpbXBvcnQoXCIuL3R5cGVzLmpzXCIpLkJhY2tncm91bmRKb2JzR2VuZXJhdGlvbkxpZmVjeWNsZVN0YXRlfSAtIEN1cnJlbnQgbGlmZWN5Y2xlIHN0YXRlLlxuICAgKi9cbiAgZ2V0TGlmZWN5Y2xlU3RhdGUoKSB7IHJldHVybiB0aGlzLmxpZmVjeWNsZVN0YXRlIH1cblxuICAvKipcbiAgICogUmV0dXJucyBhIHByb21pc2UgdGhhdCBzZXR0bGVzIG9ubHkgYWZ0ZXIgdGhlIG1haW4gaGFzIGZ1bGx5IHN0b3BwZWQuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFN0b3AgY29tcGxldGlvbi5cbiAgICovXG4gIGFzeW5jIHdhaXRVbnRpbFN0b3BwZWQoKSB7IGF3YWl0IHRoaXMuX3N0b3BwZWRQcm9taXNlIH1cblxuICAvKipcbiAgICogU25hcHNob3RzIG9ubHkgZXhhY3QgZHVyYWJsZSBvd25lcnMgZnJvbSB0aGlzIHJlbGVhc2UgZ2VuZXJhdGlvbi5cbiAgICogTGVnYWN5IG1vZGUgaW50ZW50aW9uYWxseSByZXRhaW5zIGl0cyBoaXN0b3JpY2FsIGdsb2JhbCBzbmFwc2hvdC5cbiAgICogQHJldHVybnMge1Byb21pc2U8aW1wb3J0KFwiLi90eXBlcy5qc1wiKS5CYWNrZ3JvdW5kSm9iSGFuZG9mZlNuYXBzaG90W10+fSAtIE93bmVkIHNuYXBzaG90LlxuICAgKi9cbiAgYXN5bmMgX2dlbmVyYXRpb25Pd25lZEhhbmRvZmZTbmFwc2hvdCgpIHtcbiAgICBjb25zdCBoYW5kb2ZmcyA9IGF3YWl0IHRoaXMuc3RvcmUuc25hcHNob3RIYW5kZWRPZmZKb2JzKClcblxuICAgIGlmICghdGhpcy5nZW5lcmF0aW9uSWQpIHJldHVybiBoYW5kb2Zmc1xuICAgIGNvbnN0IGdlbmVyYXRpb25JZCA9IHRoaXMuZ2VuZXJhdGlvbklkXG5cbiAgICByZXR1cm4gaGFuZG9mZnMuZmlsdGVyKCh7d29ya2VySWR9KSA9PiB3b3JrZXJJZEJlbG9uZ3NUb0dlbmVyYXRpb24oe2dlbmVyYXRpb25JZCwgd29ya2VySWR9KSlcbiAgfVxuXG4gIC8qKlxuICAgKiBBY3F1aXJlcyBzY2hlZHVsaW5nIGFuZCBkaXNwYXRjaCBvd25lcnNoaXAgZm9yIGFuIGFjdGl2ZSBnZW5lcmF0aW9uLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyBhZnRlciBhY3RpdmUgb3duZXJzaGlwIGlzIGVzdGFibGlzaGVkLlxuICAgKi9cbiAgYXN5bmMgX3N0YXJ0QWN0aXZlT3duZXJzaGlwKCkge1xuICAgIGF3YWl0IHRoaXMuc3RvcmUucmVjb25jaWxlUXVldWVDb25jdXJyZW5jeSgpXG4gICAgdGhpcy5fc2V0dXBEaXNwYXRjaFRyaWdnZXJzKClcbiAgICB0aGlzLl9zZXR1cFN0YXJ0dXBIYW5kb2ZmUmVjbGFpbSgpXG4gICAgdGhpcy5fc3RhcnRPcnBoYW5Td2VlcCgpXG4gICAgYXdhaXQgdGhpcy5fc3RhcnRTY2hlZHVsZXIoKVxuICAgIHRoaXMuX2FjdGl2ZU93bmVyc2hpcFJlYWR5ID0gdHJ1ZVxuICAgIHRoaXMuX2NyZWRpdFJlYWR5V29ya2VycygpXG4gICAgYXdhaXQgdGhpcy5fZHJhaW4oKVxuICB9XG5cbiAgLyoqIFN0YXJ0cyBleGFjdCByZWNvdmVyeSBkdXRpZXMgd2l0aG91dCBhY3F1aXJpbmcgZ2xvYmFsIGRpc3BhdGNoIG93bmVyc2hpcC4gKi9cbiAgX3N0YXJ0R2VuZXJhdGlvblJlY292ZXJ5T3duZXJzaGlwKCkge1xuICAgIHRoaXMuX3NldHVwU3RhcnR1cEhhbmRvZmZSZWNsYWltKClcbiAgICB0aGlzLl9zdGFydE9ycGhhblN3ZWVwKClcbiAgICB0aGlzLl9tYXliZVN0b3BSZXRpcmVkKClcbiAgfVxuXG4gIC8qKiBTdGFydHMgdGhlIGdlbmVyYXRpb24tZmVuY2VkIG9ycGhhbiBzd2VlcC4gKi9cbiAgX3N0YXJ0T3JwaGFuU3dlZXAoKSB7XG4gICAgaWYgKHRoaXMuX29ycGhhblRpbWVyKSByZXR1cm5cblxuICAgIHRoaXMuX29ycGhhblRpbWVyID0gc2V0SW50ZXJ2YWwoKCkgPT4geyB2b2lkIHRoaXMuX3N3ZWVwT3JwaGFucygpIH0sIDYwMDAwKVxuICB9XG5cbiAgLyoqXG4gICAqIFN0YXJ0cyBzY2hlZHVsZSBvd25lcnNoaXAgZXhhY3RseSBvbmNlLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyBhZnRlciBzY2hlZHVsZXMgYXJlIGxvYWRlZC5cbiAgICovXG4gIGFzeW5jIF9zdGFydFNjaGVkdWxlcigpIHtcbiAgICBpZiAodGhpcy5zY2hlZHVsZXIpIHJldHVyblxuXG4gICAgdGhpcy5zY2hlZHVsZXIgPSBuZXcgQmFja2dyb3VuZEpvYnNTY2hlZHVsZXIoe1xuICAgICAgY29uZmlndXJhdGlvbjogdGhpcy5jb25maWd1cmF0aW9uLFxuICAgICAgZW5xdWV1ZUpvYjogYXN5bmMgKHthcmdzLCBqb2JDbGFzcywgb3B0aW9uc30pID0+IHtcbiAgICAgICAgYXdhaXQgdGhpcy5zdG9yZS5lbnF1ZXVlKHtcbiAgICAgICAgICBqb2JOYW1lOiBqb2JDbGFzcy5qb2JOYW1lKCksXG4gICAgICAgICAgYXJncyxcbiAgICAgICAgICBvcHRpb25zOiBqb2JDbGFzcy5fd2l0aEpvYkNvbnRleHQoe2pvYkFyZ3M6IGFyZ3MsIGpvYk9wdGlvbnM6IG9wdGlvbnN9KVxuICAgICAgICB9KVxuICAgICAgICB0aGlzLl9ub3RpZnlFbnF1ZXVlZCgpXG4gICAgICAgIHZvaWQgdGhpcy5fZHJhaW4oKVxuICAgICAgfVxuICAgIH0pXG4gICAgYXdhaXQgdGhpcy5zY2hlZHVsZXIuc3RhcnQoKVxuXG4gICAgY29uc3QgcmV0ZW50aW9uU2NoZWR1bGUgPSBQcnVuZVRlcm1pbmFsQmFja2dyb3VuZEpvYnNKb2Iuc2NoZWR1bGVDb25maWd1cmF0aW9uKHRoaXMucmV0ZW50aW9uKVxuXG4gICAgaWYgKHJldGVudGlvblNjaGVkdWxlKSB7XG4gICAgICB0aGlzLnNjaGVkdWxlci5zY2hlZHVsZUpvYih7am9iQ29uZmlndXJhdGlvbjogcmV0ZW50aW9uU2NoZWR1bGUsIGpvYktleTogXCJ2ZWxvY2lvdXNQcnVuZVRlcm1pbmFsQmFja2dyb3VuZEpvYnNcIn0pXG4gICAgfVxuICB9XG5cbiAgLyoqIENyZWRpdHMgcmVhZGluZXNzIGFkdmVydGlzZW1lbnRzIHJlY29yZGVkIHdoaWxlIGRpc3BhdGNoIHdhcyBmZW5jZWQuICovXG4gIF9jcmVkaXRSZWFkeVdvcmtlcnMoKSB7XG4gICAgZm9yIChjb25zdCB3b3JrZXIgb2YgdGhpcy5jYW5kaWRhdGVSZWFkeVdvcmtlcnMpIHtcbiAgICAgIGlmICh0aGlzLndvcmtlcnMuaGFzKHdvcmtlcikgJiYgIXdvcmtlci5pc0RyYWluaW5nICYmIHdvcmtlci5zdXBwb3J0c0hhbmRvZmZJZFJlcG9ydGluZykge1xuICAgICAgICB0aGlzLnJlYWR5V29ya2Vycy5hZGQod29ya2VyKVxuICAgICAgfVxuICAgIH1cbiAgICB0aGlzLmNhbmRpZGF0ZVJlYWR5V29ya2Vycy5jbGVhcigpXG4gIH1cblxuICAvKipcbiAgICogQWN0aXZhdGVzIGEgY2FuZGlkYXRlIGFmdGVyIGl0cyBzdXBlcnZpc29yIGhhcyByZXRpcmVkIHRoZSBvbGQgZ2VuZXJhdGlvbi5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgYWZ0ZXIgc2NoZWR1bGluZyBhbmQgZGlzcGF0Y2ggYXJlIGFjdGl2ZS5cbiAgICovXG4gIGFjdGl2YXRlKCkge1xuICAgIGlmICghdGhpcy5nZW5lcmF0aW9uSWQpIHRocm93IG5ldyBFcnJvcihcIkJhY2tncm91bmQgam9icyBnZW5lcmF0aW9uIGFjdGl2YXRpb24gcmVxdWlyZXMgZ2VuZXJhdGlvbiBtb2RlXCIpXG4gICAgaWYgKHRoaXMubGlmZWN5Y2xlU3RhdGUgPT09IFwiYWN0aXZlXCIpIHJldHVybiBQcm9taXNlLnJlc29sdmUoKVxuICAgIGlmICh0aGlzLmxpZmVjeWNsZVN0YXRlICE9PSBcImNhbmRpZGF0ZVwiKSB0aHJvdyBuZXcgRXJyb3IoYENhbm5vdCBhY3RpdmF0ZSBiYWNrZ3JvdW5kIGpvYnMgZ2VuZXJhdGlvbiBmcm9tICR7dGhpcy5saWZlY3ljbGVTdGF0ZX1gKVxuICAgIGlmICghdGhpcy5fYWN0aXZhdGlvblByb21pc2UpIHRoaXMuX2FjdGl2YXRpb25Qcm9taXNlID0gdGhpcy5fYWN0aXZhdGUoKVxuXG4gICAgcmV0dXJuIHRoaXMuX2FjdGl2YXRpb25Qcm9taXNlXG4gIH1cblxuICAvKipcbiAgICogUnVucyBhY3RpdmF0aW9uLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBBY3RpdmF0aW9uIGNvbXBsZXRpb24uXG4gICAqL1xuICBhc3luYyBfYWN0aXZhdGUoKSB7XG4gICAgdGhpcy5sb2dnZXIuaW5mbygoKSA9PiBbXCJCYWNrZ3JvdW5kIGpvYnMgZ2VuZXJhdGlvbiBhY3RpdmF0aW9uIHN0YXJ0aW5nXCIsIHtnZW5lcmF0aW9uSWQ6IHRoaXMuZ2VuZXJhdGlvbklkfV0pXG4gICAgYXdhaXQgdGhpcy5fc3RhcnRBY3RpdmVPd25lcnNoaXAoKVxuICAgIHRoaXMubGlmZWN5Y2xlU3RhdGUgPSBcImFjdGl2ZVwiXG4gICAgdGhpcy5fY3JlZGl0UmVhZHlXb3JrZXJzKClcbiAgICB0aGlzLmxvZ2dlci5pbmZvKCgpID0+IFtcIkJhY2tncm91bmQgam9icyBnZW5lcmF0aW9uIGFjdGl2YXRpb24gYWNrbm93bGVkZ2VkXCIsIHtnZW5lcmF0aW9uSWQ6IHRoaXMuZ2VuZXJhdGlvbklkfV0pXG4gICAgdm9pZCB0aGlzLl9kcmFpbigpLmNhdGNoKChlcnJvcikgPT4ge1xuICAgICAgdGhpcy5sb2dnZXIuZXJyb3IoKCkgPT4gW1wiQmFja2dyb3VuZCBqb2JzIGdlbmVyYXRpb24gcG9zdC1hY3RpdmF0aW9uIGRyYWluIGZhaWxlZFwiLCB7ZXJyb3IsIGdlbmVyYXRpb25JZDogdGhpcy5nZW5lcmF0aW9uSWR9XSlcbiAgICB9KVxuICB9XG5cbiAgLyoqXG4gICAqIEVzdGFibGlzaGVzIHRoZSBzeW5jaHJvbm91cyByZXRpcmVtZW50IGZlbmNlIGFuZCB0aGVuIGRyYWlucyBvd25lcnNoaXAgc2V0dXAuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIGFmdGVyIHRoZSByZXRpcmVtZW50IGZlbmNlIGlzIGR1cmFibGUgaW4gbWVtb3J5LlxuICAgKi9cbiAgcmV0aXJlKCkge1xuICAgIGlmICghdGhpcy5nZW5lcmF0aW9uSWQpIHRocm93IG5ldyBFcnJvcihcIkJhY2tncm91bmQgam9icyBnZW5lcmF0aW9uIHJldGlyZW1lbnQgcmVxdWlyZXMgZ2VuZXJhdGlvbiBtb2RlXCIpXG4gICAgaWYgKHRoaXMubGlmZWN5Y2xlU3RhdGUgPT09IFwicmV0aXJpbmdcIiB8fCB0aGlzLmxpZmVjeWNsZVN0YXRlID09PSBcInJldGlyZWRcIikgcmV0dXJuIHRoaXMuX3JldGlyZW1lbnRQcm9taXNlIHx8IFByb21pc2UucmVzb2x2ZSgpXG4gICAgaWYgKHRoaXMubGlmZWN5Y2xlU3RhdGUgIT09IFwiYWN0aXZlXCIpIHRocm93IG5ldyBFcnJvcihgQ2Fubm90IHJldGlyZSBiYWNrZ3JvdW5kIGpvYnMgZ2VuZXJhdGlvbiBmcm9tICR7dGhpcy5saWZlY3ljbGVTdGF0ZX1gKVxuXG4gICAgdGhpcy5saWZlY3ljbGVTdGF0ZSA9IFwicmV0aXJpbmdcIlxuICAgIHRoaXMuX2FjdGl2ZU93bmVyc2hpcFJlYWR5ID0gZmFsc2VcbiAgICB0aGlzLnJlYWR5V29ya2Vycy5jbGVhcigpXG4gICAgdGhpcy5jYW5kaWRhdGVSZWFkeVdvcmtlcnMuY2xlYXIoKVxuICAgIHRoaXMuX2NsZWFyRGlzcGF0Y2hUaW1lcnMoKVxuICAgIHRoaXMuX2Rpc2Nvbm5lY3RCZWFjb25IYW5kbGVycygpXG4gICAgdGhpcy5fcmV0aXJlbWVudFByb21pc2UgPSB0aGlzLl9yZXRpcmUoKVxuICAgIHZvaWQgdGhpcy5fcmV0aXJlbWVudFByb21pc2UuY2F0Y2goKGVycm9yKSA9PiB0aGlzLl9yZXBvcnRDb25uZWN0aW9uSGFuZGxlckVycm9yKGVycm9yKSlcblxuICAgIHJldHVybiB0aGlzLl9yZXRpcmVtZW50UHJvbWlzZVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgcmV0aXJlbWVudCBhZnRlciBpdHMgc3luY2hyb25vdXMgZmVuY2UuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJldGlyZW1lbnQgZmVuY2UgY29tcGxldGlvbi5cbiAgICovXG4gIGFzeW5jIF9yZXRpcmUoKSB7XG4gICAgYXdhaXQgdGhpcy5zY2hlZHVsZXI/LnN0b3AoKVxuICAgIHRoaXMuc2NoZWR1bGVyID0gdW5kZWZpbmVkXG4gICAgaWYgKHRoaXMuX2RyYWluUHJvbWlzZSkgYXdhaXQgdGhpcy5fZHJhaW5Qcm9taXNlXG4gICAgaWYgKHRoaXMuX3N0b3BwZWQpIHJldHVyblxuXG4gICAgZm9yIChjb25zdCB3b3JrZXIgb2YgdGhpcy53b3JrZXJzKSB7XG4gICAgICB3b3JrZXIuaXNEcmFpbmluZyA9IHRydWVcbiAgICAgIHdvcmtlci5zZW5kKHt0eXBlOiBcInJldGlyZVwiLCBnZW5lcmF0aW9uSWQ6IHRoaXMuZ2VuZXJhdGlvbklkfSlcbiAgICB9XG5cbiAgICB0aGlzLmxpZmVjeWNsZVN0YXRlID0gXCJyZXRpcmVkXCJcbiAgICB0aGlzLl9zdGFydEdlbmVyYXRpb25SZWNvdmVyeU93bmVyc2hpcCgpXG4gIH1cblxuICAvKiogQ2xlYXJzIHRpbWVycyB0aGF0IGNhbiBpbml0aWF0ZSBuZXcgZ2xvYmFsIGRpc3BhdGNoIG9yIHNjaGVkdWxlIHdvcmsuICovXG4gIF9jbGVhckRpc3BhdGNoVGltZXJzKCkge1xuICAgIGlmICh0aGlzLl9wb2xsVGltZXIpIGNsZWFySW50ZXJ2YWwodGhpcy5fcG9sbFRpbWVyKVxuICAgIGlmICh0aGlzLl9zY2hlZHVsZWRUaW1lcikgY2xlYXJUaW1lb3V0KHRoaXMuX3NjaGVkdWxlZFRpbWVyKVxuICAgIGlmICh0aGlzLl9lcnJvclJldHJ5VGltZXIpIGNsZWFyVGltZW91dCh0aGlzLl9lcnJvclJldHJ5VGltZXIpXG4gICAgdGhpcy5fcG9sbFRpbWVyID0gdW5kZWZpbmVkXG4gICAgdGhpcy5fc2NoZWR1bGVkVGltZXIgPSB1bmRlZmluZWRcbiAgICB0aGlzLl9lcnJvclJldHJ5VGltZXIgPSB1bmRlZmluZWRcbiAgfVxuXG4gIC8qKiBIb2xkcyB0aGUgbWFpbiBvcGVuIHVudGlsIGEgbGlmZWN5Y2xlIHJlc3BvbnNlIGhhcyBmbHVzaGVkLiAqL1xuICBhY3F1aXJlTGlmZWN5Y2xlUmVxdWVzdExlYXNlKCkgeyB0aGlzLl9saWZlY3ljbGVSZXF1ZXN0TGVhc2VzICs9IDEgfVxuXG4gIC8qKiBSZWxlYXNlcyBvbmUgbGlmZWN5Y2xlLXJlc3BvbnNlIGxlYXNlIGFmdGVyIGl0cyBzb2NrZXQgd3JpdGUgY2FsbGJhY2suICovXG4gIHJlbGVhc2VMaWZlY3ljbGVSZXF1ZXN0TGVhc2UoKSB7XG4gICAgaWYgKHRoaXMuX2xpZmVjeWNsZVJlcXVlc3RMZWFzZXMgPCAxKSB0aHJvdyBuZXcgRXJyb3IoXCJObyBiYWNrZ3JvdW5kIGpvYnMgbGlmZWN5Y2xlIHJlcXVlc3QgbGVhc2UgdG8gcmVsZWFzZVwiKVxuICAgIHRoaXMuX2xpZmVjeWNsZVJlcXVlc3RMZWFzZXMgLT0gMVxuICAgIHRoaXMuX21heWJlU3RvcFJldGlyZWQoKVxuICB9XG5cbiAgLyoqIFN0b3BzIGEgcmV0aXJlZCBnZW5lcmF0aW9uIG9ubHkgYWZ0ZXIgaXRzIGV4YWN0IG93bmVyc2hpcCBoYXMgZHJhaW5lZC4gKi9cbiAgX21heWJlU3RvcFJldGlyZWQoKSB7XG4gICAgaWYgKHRoaXMubGlmZWN5Y2xlU3RhdGUgIT09IFwicmV0aXJlZFwiIHx8IHRoaXMuX3N0b3BwZWQgfHwgdGhpcy5zdG9wUHJvbWlzZSkgcmV0dXJuXG4gICAgaWYgKHRoaXMuX2xpZmVjeWNsZVJlcXVlc3RMZWFzZXMgPiAwIHx8IHRoaXMuX2FjdGl2ZU5vbldvcmtlclJlcXVlc3RzID4gMCB8fCB0aGlzLndvcmtlcnMuc2l6ZSA+IDAgfHwgdGhpcy5kaXNjb25uZWN0ZWRXb3JrZXJzLnNpemUgPiAwKSByZXR1cm5cbiAgICBpZiAodGhpcy5pbmZsaWdodFdvcmtlckhhbmRvZmZBZG9wdGlvbnMuc2l6ZSA+IDAgfHwgdGhpcy5wZW5kaW5nSGFuZG9mZlJlY292ZXJpZXMuc2l6ZSA+IDApIHJldHVyblxuICAgIGlmICh0aGlzLl9kcmFpblByb21pc2UgfHwgdGhpcy5fc3RhcnR1cEhhbmRvZmZSZWNsYWltUHJvbWlzZSB8fCB0aGlzLl9zdGFydHVwSGFuZG9mZlJlY2xhaW1UaW1lcikgcmV0dXJuXG4gICAgaWYgKHRoaXMuc3RhcnR1cEhhbmRvZmZTbmFwc2hvdC5sZW5ndGggPiAwKSByZXR1cm5cblxuICAgIGZvciAoY29uc3QgaGFuZG9mZnMgb2YgdGhpcy53b3JrZXJIYW5kb2Zmcy52YWx1ZXMoKSkge1xuICAgICAgaWYgKGhhbmRvZmZzLnNpemUgPiAwKSByZXR1cm5cbiAgICB9XG5cbiAgICB2b2lkIHRoaXMuc3RvcCgpLmNhdGNoKChlcnJvcikgPT4gdGhpcy5fcmVwb3J0Q29ubmVjdGlvbkhhbmRsZXJFcnJvcihlcnJvcikpXG4gIH1cblxuICAvKipcbiAgICogV2lyZXMgdXAgdGhlIGRpc3BhdGNoLXRyaWdnZXJpbmcgc2lnbmFsIHNvdXJjZXMgZm9yIHRoZSBjb25maWd1cmVkXG4gICAqIHN0cmF0ZWd5LiBJbiBgXCJiZWFjb25cImAgbW9kZSAoZGVmYXVsdCkgdGhpcyBtZWFucyBzdWJzY3JpYmluZyB0byB0aGVcbiAgICogYHZlbG9jaW91cy1iYWNrZ3JvdW5kLWpvYnMtZGlzcGF0Y2hgIGNoYW5uZWwgZm9yIGNyb3NzLXByb2Nlc3NcbiAgICogd2FrZS11cHMsIGxpc3RlbmluZyBmb3IgQmVhY29uIChyZSljb25uZWN0cyB0byBjYXRjaCB1cCBvbiBtaXNzZWRcbiAgICogd29yaywgYW5kIHJlbHlpbmcgb24gZGlyZWN0IGluLXByb2Nlc3MgY2FsbHMgZnJvbSBgX2hhbmRsZUVucXVldWVgLFxuICAgKiBgX2hhbmRsZUpvYkNvbXBsZXRlYC9gRmFpbGVkYCwgd29ya2VyIGhlbGxvL3JlYWR5LCBhbmQgdGhlXG4gICAqIHNjaGVkdWxlZC1qb2IgYHNldFRpbWVvdXRgLiBJbiBgXCJwb2xsaW5nXCJgIG1vZGUgd2UgcmVzdG9yZSB0aGVcbiAgICogbGVnYWN5IGZpeGVkLWludGVydmFsIHBvbGwgZm9yIHVzZXJzIHdobyB3YW50IHRoZSBwcmV2aW91cyBiZWhhdmlvci5cbiAgICogQHJldHVybnMge3ZvaWR9XG4gICAqL1xuICBfc2V0dXBEaXNwYXRjaFRyaWdnZXJzKCkge1xuICAgIGlmICh0aGlzLmRpc3BhdGNoU3RyYXRlZ3kgPT09IFwicG9sbGluZ1wiKSB7XG4gICAgICB0aGlzLl9wb2xsVGltZXIgPSBzZXRJbnRlcnZhbCgoKSA9PiB7XG4gICAgICAgIHZvaWQgdGhpcy5fcmV0cnlBZnRlckVycm9yKClcbiAgICAgIH0sIHRoaXMucG9sbEludGVydmFsTXMpXG4gICAgICByZXR1cm5cbiAgICB9XG5cbiAgICBjb25zdCBiZWFjb25DbGllbnQgPSB0aGlzLmNvbmZpZ3VyYXRpb24uZ2V0QmVhY29uQ2xpZW50KClcbiAgICBpZiAoIWJlYWNvbkNsaWVudCkgcmV0dXJuXG5cbiAgICB0aGlzLl9iZWFjb25DbGllbnQgPSBiZWFjb25DbGllbnRcblxuICAgIHRoaXMuX3Vuc3Vic2NyaWJlQmVhY29uID0gYmVhY29uQ2xpZW50Lm9uQnJvYWRjYXN0KChtZXNzYWdlKSA9PiB7XG4gICAgICBpZiAobWVzc2FnZT8uY2hhbm5lbCAhPT0gRElTUEFUQ0hfQ0hBTk5FTCkgcmV0dXJuXG4gICAgICB2b2lkIHRoaXMuX2RyYWluKClcbiAgICB9KVxuXG4gICAgLy8gRHJhaW4gb24gZXZlcnkgKHJlKWNvbm5lY3QgdG8gY2F0Y2ggdXAgb24gam9icyBlbnF1ZXVlZCB3aGlsZSB0aGVcbiAgICAvLyBidXMgd2FzIHVucmVhY2hhYmxlLiBUaGUgREIgaXMgdGhlIGR1cmFibGUgbG9nOyBCZWFjb24gaXMganVzdCB0aGVcbiAgICAvLyB3YWtlLXVwIHNpZ25hbC5cbiAgICB0aGlzLl9iZWFjb25Db25uZWN0SGFuZGxlciA9ICgpID0+IHtcbiAgICAgIHZvaWQgdGhpcy5fZHJhaW4oKVxuICAgIH1cbiAgICBiZWFjb25DbGllbnQub24oXCJjb25uZWN0XCIsIHRoaXMuX2JlYWNvbkNvbm5lY3RIYW5kbGVyKVxuICB9XG5cbiAgLyoqXG4gICAqIEFybXMgdGhlIGJvdW5kZWQgYWRvcHRpb24gZ3JhY2Ugb25seSB3aGVuIHN0YXJ0dXAgZm91bmQgZXhhY3QgcGVyc2lzdGVkXG4gICAqIGhhbmRvZmZzLiBUaGUgdGltZXIgaXMgdW5yZWZlZCBzbyBhbiBvdGhlcndpc2UtZmluaXNoZWQgcHJvY2VzcyBpcyBuZXZlclxuICAgKiByZXRhaW5lZCBzb2xlbHkgdG8gcGVyZm9ybSB0aGlzIGNsZWFudXAuXG4gICAqIEByZXR1cm5zIHt2b2lkfVxuICAgKi9cbiAgX3NldHVwU3RhcnR1cEhhbmRvZmZSZWNsYWltKCkge1xuICAgIGlmICh0aGlzLnN0YXJ0dXBIYW5kb2ZmU25hcHNob3QubGVuZ3RoID09PSAwKSByZXR1cm5cbiAgICBpZiAodGhpcy5fc3RhcnR1cEhhbmRvZmZSZWNsYWltVGltZXIgfHwgdGhpcy5fc3RhcnR1cEhhbmRvZmZSZWNsYWltUHJvbWlzZSB8fCB0aGlzLl9zdGFydHVwSGFuZG9mZkdyYWNlRWxhcHNlZCkgcmV0dXJuXG5cbiAgICB0aGlzLl9zdGFydHVwSGFuZG9mZlJlY2xhaW1UaW1lciA9IHRoaXMuY2xvY2suc2V0VGltZW91dCgoKSA9PiB7XG4gICAgICB0aGlzLl9zdGFydHVwSGFuZG9mZlJlY2xhaW1UaW1lciA9IHVuZGVmaW5lZFxuICAgICAgdGhpcy5fc3RhcnR1cEhhbmRvZmZBZG9wdGlvbnNBdERlYWRsaW5lID0gWy4uLnRoaXMuaW5mbGlnaHRXb3JrZXJIYW5kb2ZmQWRvcHRpb25zXVxuICAgICAgdGhpcy5fc3RhcnR1cEhhbmRvZmZHcmFjZUVsYXBzZWQgPSB0cnVlXG4gICAgICB2b2lkIHRoaXMuX3N0YXJ0U3RhcnR1cEhhbmRvZmZSZWNsYWltKClcbiAgICB9LCB0aGlzLndvcmtlclJlY29ubmVjdEdyYWNlTXMpXG4gICAgaWYgKHR5cGVvZiB0aGlzLl9zdGFydHVwSGFuZG9mZlJlY2xhaW1UaW1lciA9PT0gXCJvYmplY3RcIikgdGhpcy5fc3RhcnR1cEhhbmRvZmZSZWNsYWltVGltZXIudW5yZWYoKVxuICB9XG5cbiAgLyoqXG4gICAqIFN0YXJ0cyBvbmUgdHJhY2tlZCBzdGFydHVwLXJlY2xhaW0gcGFzcywgY29hbGVzY2luZyBsaWZlY3ljbGUgYW5kIHJldHJ5XG4gICAqIGNhbGxlcnMgc28gc2h1dGRvd24gY2FuIHdhaXQgZm9yIGR1cmFibGUgbXV0YXRpb24gYmVmb3JlIGNsb3NpbmcgcG9vbHMuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIGFmdGVyIHRoaXMgcGFzcyBzZXR0bGVzLlxuICAgKi9cbiAgX3N0YXJ0U3RhcnR1cEhhbmRvZmZSZWNsYWltKCkge1xuICAgIGlmICh0aGlzLl9zdGFydHVwSGFuZG9mZlJlY2xhaW1Qcm9taXNlKSByZXR1cm4gdGhpcy5fc3RhcnR1cEhhbmRvZmZSZWNsYWltUHJvbWlzZVxuXG4gICAgY29uc3QgcmVjbGFpbSA9IHRoaXMuX3JlY2xhaW1EaXNjb25uZWN0ZWRTdGFydHVwSGFuZG9mZnMoKVxuXG4gICAgdGhpcy5fc3RhcnR1cEhhbmRvZmZSZWNsYWltUHJvbWlzZSA9IHJlY2xhaW1cbiAgICBjb25zdCBjbGVhclJlY2xhaW0gPSAoKSA9PiB7XG4gICAgICBpZiAodGhpcy5fc3RhcnR1cEhhbmRvZmZSZWNsYWltUHJvbWlzZSA9PT0gcmVjbGFpbSkge1xuICAgICAgICB0aGlzLl9zdGFydHVwSGFuZG9mZlJlY2xhaW1Qcm9taXNlID0gdW5kZWZpbmVkXG4gICAgICB9XG4gICAgfVxuICAgIHZvaWQgcmVjbGFpbS50aGVuKGNsZWFyUmVjbGFpbSwgY2xlYXJSZWNsYWltKVxuXG4gICAgcmV0dXJuIHJlY2xhaW1cbiAgfVxuXG4gIC8qKlxuICAgKiBXYWl0cyBmb3IgYW4gYWxyZWFkeS1zdGFydGVkIHN0YXJ0dXAgcmVjbGFpbSBiZWZvcmUgYWRhcHRlciBzaHV0ZG93bi5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgd2hlbiBubyBwYXNzIHJlbWFpbnMuXG4gICAqL1xuICBhc3luYyBfZHJhaW5TdGFydHVwSGFuZG9mZlJlY2xhaW0oKSB7XG4gICAgd2hpbGUgKHRoaXMuX3N0YXJ0dXBIYW5kb2ZmUmVjbGFpbVByb21pc2UpIHtcbiAgICAgIGF3YWl0IHRoaXMuX3N0YXJ0dXBIYW5kb2ZmUmVjbGFpbVByb21pc2VcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogT3JwaGFucyBvbmx5IHN0YXJ0dXAtc25hcHNob3R0ZWQgbGVhc2VzIHdob3NlIHN0YWJsZSB3b3JrZXIgaWQgaGFzIG5vdCBiZWVuXG4gICAqIG9ic2VydmVkIGJ5IHRoaXMgbWFpbiBnZW5lcmF0aW9uLiBTdG9yZSBmZW5jaW5nIHJlamVjdHMgY29tcGxldGVkLFxuICAgKiByZXR1cm5lZCwgcmVwbGFjZWQsIGFuZCByZS1oYW5kZWQtb2ZmIHJvd3MuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIGFmdGVyIHJlY2xhaW0gb3IgcmV0YWluZWQgcmV0cnkgc3RhdGUuXG4gICAqL1xuICBhc3luYyBfcmVjbGFpbURpc2Nvbm5lY3RlZFN0YXJ0dXBIYW5kb2ZmcygpIHtcbiAgICBpZiAodGhpcy5fc3RvcHBlZCB8fCAhdGhpcy5fc3RhcnR1cEhhbmRvZmZHcmFjZUVsYXBzZWQpIHJldHVyblxuICAgIGlmICh0aGlzLnN0YXJ0dXBIYW5kb2ZmU25hcHNob3QubGVuZ3RoID09PSAwKSByZXR1cm5cblxuICAgIGF3YWl0IHRoaXMuX3dhaXRGb3JTdGFydHVwSGFuZG9mZkFkb3B0aW9uc0F0RGVhZGxpbmUoKVxuICAgIGlmICh0aGlzLl9zdG9wcGVkKSByZXR1cm5cblxuICAgIGNvbnN0IGhhbmRvZmZzID0gdGhpcy5zdGFydHVwSGFuZG9mZlNuYXBzaG90LmZpbHRlcigoe3dvcmtlcklkfSkgPT4gIXRoaXMucmVjb25uZWN0ZWRXb3JrZXJJZHMuaGFzKHdvcmtlcklkKSlcblxuICAgIGlmIChoYW5kb2Zmcy5sZW5ndGggPT09IDApIHtcbiAgICAgIHRoaXMuc3RhcnR1cEhhbmRvZmZTbmFwc2hvdCA9IFtdXG4gICAgICB0aGlzLl9tYXliZVN0b3BSZXRpcmVkKClcbiAgICAgIHJldHVyblxuICAgIH1cblxuICAgIGxldCBvcnBoYW5lZEpvYnNcblxuICAgIHRyeSB7XG4gICAgICBvcnBoYW5lZEpvYnMgPSBhd2FpdCB0aGlzLnN0b3JlLm1hcmtPcnBoYW5lZEhhbmRvZmZzKHtcbiAgICAgICAgZXJyb3I6IFwiSm9iIG9ycGhhbmVkIGFmdGVyIGl0cyBwcmUtcmVzdGFydCB3b3JrZXIgZGlkIG5vdCByZWNvbm5lY3RcIixcbiAgICAgICAgaGFuZG9mZnNcbiAgICAgIH0pXG4gICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgIHRoaXMuX3JlcG9ydFN0YXJ0dXBIYW5kb2ZmUmVjbGFpbUVycm9yKGVycm9yKVxuICAgICAgdGhpcy5fc2NoZWR1bGVFcnJvclJldHJ5KClcbiAgICAgIHJldHVyblxuICAgIH1cblxuICAgIHRoaXMuc3RhcnR1cEhhbmRvZmZTbmFwc2hvdCA9IFtdXG4gICAgYXdhaXQgdGhpcy5faGFuZGxlT3JwaGFuZWRKb2JzKHtcbiAgICAgIGpvYnM6IG9ycGhhbmVkSm9icyxcbiAgICAgIHdhcm5pbmc6IFwiUmVjbGFpbWVkIGJhY2tncm91bmQgam9icyBmcm9tIHdvcmtlcnMgYWJzZW50IGFmdGVyIG1haW4gcmVzdGFydCBncmFjZVwiXG4gICAgfSlcbiAgICB0aGlzLm9uU3RhcnR1cEhhbmRvZmZzUmVjbGFpbWVkPy4ob3JwaGFuZWRKb2JzKVxuICAgIHRoaXMuX21heWJlU3RvcFJldGlyZWQoKVxuICB9XG5cbiAgLyoqXG4gICAqIExldHMgYWRvcHRpb24gcXVlcmllcyBhbHJlYWR5IHJ1bm5pbmcgYXQgdGhlIHJlY29ubmVjdCBkZWFkbGluZSBzZXR0bGVcbiAgICogYmVmb3JlIHdvcmtlciBpZHMgYXJlIGZpbHRlcmVkLiBBIHNlY29uZCBib3VuZGVkIGdyYWNlIHByZXZlbnRzIGEgc3R1Y2tcbiAgICogYWRhcHRlciBxdWVyeSBmcm9tIGRlZmVycmluZyBzdGFydHVwIHJlY2xhaW0gZm9yZXZlci5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgd2hlbiB0aGUgZGVhZGxpbmUgc2V0IHNldHRsZXMgb3IgdGltZXMgb3V0LlxuICAgKi9cbiAgYXN5bmMgX3dhaXRGb3JTdGFydHVwSGFuZG9mZkFkb3B0aW9uc0F0RGVhZGxpbmUoKSB7XG4gICAgY29uc3QgYWRvcHRpb25zID0gdGhpcy5fc3RhcnR1cEhhbmRvZmZBZG9wdGlvbnNBdERlYWRsaW5lXG5cbiAgICB0aGlzLl9zdGFydHVwSGFuZG9mZkFkb3B0aW9uc0F0RGVhZGxpbmUgPSBbXVxuICAgIGlmIChhZG9wdGlvbnMubGVuZ3RoID09PSAwKSByZXR1cm5cblxuICAgIC8qKiBAdHlwZSB7UmV0dXJuVHlwZTx0eXBlb2Ygc2V0VGltZW91dD4gfCB1bmRlZmluZWR9ICovXG4gICAgbGV0IHRpbWVyXG4gICAgY29uc3Qgd2FpdExpbWl0ID0gbmV3IFByb21pc2UoKHJlc29sdmUpID0+IHtcbiAgICAgIC8vIFRoaXMgbGlmZWN5Y2xlIGRlYWRsaW5lIG11c3Qgbm90IGtlZXAgdGhlIG1haW4gcHJvY2VzcyBhbGl2ZTsgdGhlXG4gICAgICAvLyBnZW5lcmljIHRpbWVvdXQgaGVscGVyIGludGVudGlvbmFsbHkgdXNlcyBhIHJlZmVyZW5jZWQgdGltZXIuXG4gICAgICB0aW1lciA9IHNldFRpbWVvdXQocmVzb2x2ZSwgdGhpcy53b3JrZXJSZWNvbm5lY3RHcmFjZU1zKVxuICAgICAgdGltZXIudW5yZWYoKVxuICAgIH0pXG5cbiAgICB0cnkge1xuICAgICAgYXdhaXQgUHJvbWlzZS5yYWNlKFtQcm9taXNlLmFsbChhZG9wdGlvbnMpLCB3YWl0TGltaXRdKVxuICAgIH0gZmluYWxseSB7XG4gICAgICBpZiAodGltZXIpIGNsZWFyVGltZW91dCh0aW1lcilcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogUHVibGlzaGVzIGEgZGlzcGF0Y2ggd2FrZS11cCBvbiB0aGUgQmVhY29uIGNoYW5uZWwuIE5vLW9wIGluIHBvbGxpbmdcbiAgICogbW9kZSBvciB3aGVuIEJlYWNvbiBpcyBub3QgY29ubmVjdGVkOyBpbiB0aG9zZSBjYXNlcyB0aGUgZGlyZWN0XG4gICAqIGluLXByb2Nlc3MgYF9kcmFpbigpYCBjYWxsIGluIHRoZSBlbnF1ZXVlL2hhbmRsZSBwYXRocyBpcyBzdWZmaWNpZW50XG4gICAqICh0aGVyZSBhcmUgbm8gb3RoZXIgcHJvY2Vzc2VzIHRvIG5vdGlmeSkuXG4gICAqIEByZXR1cm5zIHt2b2lkfVxuICAgKi9cbiAgX25vdGlmeUVucXVldWVkKCkge1xuICAgIGlmICh0aGlzLmRpc3BhdGNoU3RyYXRlZ3kgPT09IFwicG9sbGluZ1wiKSByZXR1cm5cblxuICAgIGNvbnN0IGJlYWNvbkNsaWVudCA9IHRoaXMuY29uZmlndXJhdGlvbi5nZXRCZWFjb25DbGllbnQoKVxuICAgIGlmICghYmVhY29uQ2xpZW50IHx8ICFiZWFjb25DbGllbnQuaXNDb25uZWN0ZWQoKSkgcmV0dXJuXG5cbiAgICB0cnkge1xuICAgICAgYmVhY29uQ2xpZW50LnB1Ymxpc2goe1xuICAgICAgICBjaGFubmVsOiBESVNQQVRDSF9DSEFOTkVMLFxuICAgICAgICBicm9hZGNhc3RQYXJhbXM6IHt9LFxuICAgICAgICBib2R5OiB7YWN0aW9uOiBcIndha2VcIn1cbiAgICAgIH0pXG4gICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgIHRoaXMubG9nZ2VyLndhcm4oKCkgPT4gW1wiRmFpbGVkIHRvIHB1Ymxpc2ggYmFja2dyb3VuZCBqb2JzIHdha2UgYnJvYWRjYXN0OlwiLCBlcnJvcl0pXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgaGFuZGxlIGNvbm5lY3Rpb24uXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwibmV0XCIpLlNvY2tldH0gc29ja2V0IC0gU29ja2V0LlxuICAgKiBAcmV0dXJucyB7dm9pZH1cbiAgICovXG4gIF9oYW5kbGVDb25uZWN0aW9uKHNvY2tldCkge1xuICAgIGNvbnN0IGpzb25Tb2NrZXQgPSBuZXcgSnNvblNvY2tldChzb2NrZXQpXG4gICAgdGhpcy5jb25uZWN0aW9ucy5hZGQoanNvblNvY2tldClcbiAgICAvKipcbiAgICAgKiBSb2xlLlxuICAgICAqIEB0eXBlIHtpbXBvcnQoXCIuL3R5cGVzLmpzXCIpLkJhY2tncm91bmRKb2JTb2NrZXRSb2xlIHwgbnVsbH0gKi9cbiAgICBsZXQgcm9sZSA9IG51bGxcblxuICAgIGxldCBjbGVhbmVkVXAgPSBmYWxzZVxuICAgIGNvbnN0IGNsZWFudXAgPSAoKSA9PiB7XG4gICAgICBpZiAoY2xlYW5lZFVwKSByZXR1cm5cbiAgICAgIGNsZWFuZWRVcCA9IHRydWVcbiAgICAgIHRoaXMuY29ubmVjdGlvbnMuZGVsZXRlKGpzb25Tb2NrZXQpXG5cbiAgICAgIGlmIChyb2xlID09PSBcIndvcmtlclwiKSB2b2lkIHRoaXMuX2hhbmRsZVdvcmtlclNvY2tldENsb3NlZChqc29uU29ja2V0KVxuICAgICAgdGhpcy5fbWF5YmVTdG9wUmV0aXJlZCgpXG4gICAgfVxuXG4gICAganNvblNvY2tldC5vbihcImNsb3NlXCIsIGNsZWFudXApXG4gICAganNvblNvY2tldC5vbihcImVycm9yXCIsIChlcnJvcikgPT4ge1xuICAgICAgdGhpcy5sb2dnZXIud2FybigoKSA9PiBbXCJCYWNrZ3JvdW5kIGpvYnMgY29ubmVjdGlvbiBlcnJvcjpcIiwgZXJyb3JdKVxuICAgICAgY2xlYW51cCgpXG4gICAgfSlcblxuICAgIGxldCBtZXNzYWdlSGFuZGxpbmcgPSBQcm9taXNlLnJlc29sdmUoKVxuICAgIGpzb25Tb2NrZXQub24oXCJtZXNzYWdlXCIsIChtZXNzYWdlKSA9PiB7XG4gICAgICBtZXNzYWdlSGFuZGxpbmcgPSBtZXNzYWdlSGFuZGxpbmcudGhlbihhc3luYyAoKSA9PiB7XG4gICAgICAgIGNvbnN0IGV4aXN0aW5nUm9sZSA9IHJvbGVcbiAgICAgICAgcm9sZSA9IGF3YWl0IHRoaXMuX2hhbmRsZVNvY2tldE1lc3NhZ2Uoe2pzb25Tb2NrZXQsIG1lc3NhZ2UsIHJvbGV9KVxuICAgICAgICBpZiAoZXhpc3RpbmdSb2xlID09PSBcImNsaWVudFwiIHx8IGV4aXN0aW5nUm9sZSA9PT0gXCJyZXBvcnRlclwiKSBqc29uU29ja2V0LmNsb3NlKClcbiAgICAgIH0pLmNhdGNoKChlcnJvcikgPT4ge1xuICAgICAgICB0aGlzLl9yZXBvcnRDb25uZWN0aW9uSGFuZGxlckVycm9yKGVycm9yKVxuICAgICAgICBqc29uU29ja2V0LmNsb3NlKClcbiAgICAgIH0pXG4gICAgfSlcbiAgfVxuXG4gIC8qKlxuICAgKiBTdXJmYWNlcyBhbiB1bmV4cGVjdGVkIHByb3RvY29sLWhhbmRsZXIgZmFpbHVyZS5cbiAgICogQHBhcmFtIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gZXJyb3IgLSBIYW5kbGVyIGZhaWx1cmUuXG4gICAqIEByZXR1cm5zIHt2b2lkfVxuICAgKi9cbiAgX3JlcG9ydENvbm5lY3Rpb25IYW5kbGVyRXJyb3IoZXJyb3IpIHtcbiAgICBjb25zdCBub3JtYWxpemVkRXJyb3IgPSBlcnJvciBpbnN0YW5jZW9mIEVycm9yID8gZXJyb3IgOiBuZXcgRXJyb3IoU3RyaW5nKGVycm9yKSlcbiAgICBjb25zdCBwYXlsb2FkID0ge2NvbnRleHQ6IHtzdGFnZTogXCJiYWNrZ3JvdW5kLWpvYnMtc29ja2V0LWhhbmRsZXJcIn0sIGVycm9yOiBub3JtYWxpemVkRXJyb3J9XG4gICAgY29uc3QgZXJyb3JFdmVudHMgPSB0aGlzLmNvbmZpZ3VyYXRpb24uZ2V0RXJyb3JFdmVudHMoKVxuXG4gICAgdGhpcy5sb2dnZXIuZXJyb3IoKCkgPT4gW1wiQmFja2dyb3VuZCBqb2JzIHNvY2tldCBoYW5kbGVyIGZhaWxlZDpcIiwgbm9ybWFsaXplZEVycm9yXSlcbiAgICBlcnJvckV2ZW50cy5lbWl0KFwiZnJhbWV3b3JrLWVycm9yXCIsIHBheWxvYWQpXG4gICAgZXJyb3JFdmVudHMuZW1pdChcImFsbC1lcnJvclwiLCB7Li4ucGF5bG9hZCwgZXJyb3JUeXBlOiBcImZyYW1ld29yay1lcnJvclwifSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGhhbmRsZSBzb2NrZXQgbWVzc2FnZS5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBPcHRpb25zLlxuICAgKiBAcGFyYW0ge0pzb25Tb2NrZXR9IGFyZ3MuanNvblNvY2tldCAtIEpTT04gc29ja2V0LlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vdHlwZXMuanNcIikuQmFja2dyb3VuZEpvYlNvY2tldE1lc3NhZ2V9IGFyZ3MubWVzc2FnZSAtIFNvY2tldCBtZXNzYWdlLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vdHlwZXMuanNcIikuQmFja2dyb3VuZEpvYlNvY2tldFJvbGUgfCBudWxsfSBhcmdzLnJvbGUgLSBDdXJyZW50IHNvY2tldCByb2xlLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxpbXBvcnQoXCIuL3R5cGVzLmpzXCIpLkJhY2tncm91bmRKb2JTb2NrZXRSb2xlIHwgbnVsbD59IC0gVXBkYXRlZCBzb2NrZXQgcm9sZS5cbiAgICovXG4gIGFzeW5jIF9oYW5kbGVTb2NrZXRNZXNzYWdlKHtqc29uU29ja2V0LCBtZXNzYWdlLCByb2xlfSkge1xuICAgIGlmICghcm9sZSkgcmV0dXJuIGF3YWl0IHRoaXMuX2hhbmRsZVJvbGVsZXNzU29ja2V0TWVzc2FnZSh7anNvblNvY2tldCwgbWVzc2FnZX0pXG4gICAgaWYgKHJvbGUgPT09IFwid29ya2VyXCIpIHtcbiAgICAgIGF3YWl0IHRoaXMuX2hhbmRsZVdvcmtlclNvY2tldE1lc3NhZ2Uoe2pzb25Tb2NrZXQsIG1lc3NhZ2V9KVxuICAgICAgcmV0dXJuIHJvbGVcbiAgICB9XG5cbiAgICB0aGlzLl9hY3RpdmVOb25Xb3JrZXJSZXF1ZXN0cyArPSAxXG4gICAgdHJ5IHtcbiAgICAgIGlmIChyb2xlID09PSBcImNsaWVudFwiKSBhd2FpdCB0aGlzLl9oYW5kbGVDbGllbnRTb2NrZXRNZXNzYWdlKHtqc29uU29ja2V0LCBtZXNzYWdlfSlcbiAgICAgIGlmIChyb2xlID09PSBcInJlcG9ydGVyXCIpIGF3YWl0IHRoaXMuX2hhbmRsZVJlcG9ydGVyU29ja2V0TWVzc2FnZSh7anNvblNvY2tldCwgbWVzc2FnZX0pXG4gICAgfSBmaW5hbGx5IHtcbiAgICAgIHRoaXMuX2FjdGl2ZU5vbldvcmtlclJlcXVlc3RzIC09IDFcbiAgICAgIHRoaXMuX21heWJlU3RvcFJldGlyZWQoKVxuICAgIH1cblxuICAgIHJldHVybiByb2xlXG4gIH1cblxuICAvKipcbiAgICogUnVucyBoYW5kbGUgcm9sZWxlc3Mgc29ja2V0IG1lc3NhZ2UuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gT3B0aW9ucy5cbiAgICogQHBhcmFtIHtKc29uU29ja2V0fSBhcmdzLmpzb25Tb2NrZXQgLSBKU09OIHNvY2tldC5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL3R5cGVzLmpzXCIpLkJhY2tncm91bmRKb2JTb2NrZXRNZXNzYWdlfSBhcmdzLm1lc3NhZ2UgLSBTb2NrZXQgbWVzc2FnZS5cbiAgICogQHJldHVybnMge1Byb21pc2U8aW1wb3J0KFwiLi90eXBlcy5qc1wiKS5CYWNrZ3JvdW5kSm9iU29ja2V0Um9sZSB8IG51bGw+fSAtIE5ldyBzb2NrZXQgcm9sZS5cbiAgICovXG4gIGFzeW5jIF9oYW5kbGVSb2xlbGVzc1NvY2tldE1lc3NhZ2Uoe2pzb25Tb2NrZXQsIG1lc3NhZ2V9KSB7XG4gICAgaWYgKG1lc3NhZ2U/LnR5cGUgIT09IFwiaGVsbG9cIikgcmV0dXJuIG51bGxcblxuICAgIGNvbnN0IHJlamVjdGlvblJlYXNvbiA9IHRoaXMuX2dlbmVyYXRpb25IZWxsb1JlamVjdGlvblJlYXNvbihtZXNzYWdlKVxuXG4gICAgaWYgKHJlamVjdGlvblJlYXNvbikge1xuICAgICAganNvblNvY2tldC5zZW5kKHt0eXBlOiBcImdlbmVyYXRpb24tcmVqZWN0ZWRcIiwgcmVhc29uOiByZWplY3Rpb25SZWFzb259KVxuICAgICAganNvblNvY2tldC5jbG9zZSgpXG4gICAgICByZXR1cm4gbnVsbFxuICAgIH1cblxuICAgIGlmIChtZXNzYWdlLnJvbGUgPT09IFwid29ya2VyXCIpIHtcbiAgICAgIGlmICh0aGlzLl9zdG9wcGVkKSB7XG4gICAgICAgIGpzb25Tb2NrZXQuY2xvc2UoKVxuICAgICAgICByZXR1cm4gbWVzc2FnZS5yb2xlXG4gICAgICB9XG5cbiAgICAgIGlmICghKGF3YWl0IHRoaXMuX3JlZ2lzdGVyV29ya2VyKHtqc29uU29ja2V0LCBtZXNzYWdlfSkpKSByZXR1cm4gbnVsbFxuICAgIH1cblxuICAgIGlmICh0aGlzLmdlbmVyYXRpb25JZCkge1xuICAgICAganNvblNvY2tldC5zZW5kKHtcbiAgICAgICAgdHlwZTogXCJnZW5lcmF0aW9uLWFjY2VwdGVkXCIsXG4gICAgICAgIGdlbmVyYXRpb25JZDogdGhpcy5nZW5lcmF0aW9uSWQsXG4gICAgICAgIGxpZmVjeWNsZVN0YXRlOiB0aGlzLmxpZmVjeWNsZVN0YXRlXG4gICAgICB9KVxuICAgICAgaWYgKG1lc3NhZ2Uucm9sZSA9PT0gXCJ3b3JrZXJcIiAmJiAodGhpcy5saWZlY3ljbGVTdGF0ZSA9PT0gXCJyZXRpcmluZ1wiIHx8IHRoaXMubGlmZWN5Y2xlU3RhdGUgPT09IFwicmV0aXJlZFwiKSkge1xuICAgICAgICBqc29uU29ja2V0LnNlbmQoe3R5cGU6IFwicmV0aXJlXCIsIGdlbmVyYXRpb25JZDogdGhpcy5nZW5lcmF0aW9uSWR9KVxuICAgICAgfVxuICAgIH1cblxuICAgIHJldHVybiBtZXNzYWdlLnJvbGVcbiAgfVxuXG4gIC8qKlxuICAgKiBWYWxpZGF0ZXMgdGhlIGdlbmVyYXRpb24gZmVuY2UgYmVmb3JlIGFzc2lnbmluZyBhIHNvY2tldCByb2xlLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vdHlwZXMuanNcIikuQmFja2dyb3VuZEpvYkhlbGxvTWVzc2FnZX0gbWVzc2FnZSAtIEhlbGxvIG1lc3NhZ2UuXG4gICAqIEByZXR1cm5zIHtpbXBvcnQoXCIuL3R5cGVzLmpzXCIpLkJhY2tncm91bmRKb2JzR2VuZXJhdGlvblJlamVjdGlvblJlYXNvbiB8IG51bGx9IC0gUmVqZWN0aW9uIHJlYXNvbi5cbiAgICovXG4gIF9nZW5lcmF0aW9uSGVsbG9SZWplY3Rpb25SZWFzb24obWVzc2FnZSkge1xuICAgIGNvbnN0IG1lc3NhZ2VIYXNHZW5lcmF0aW9uID0gT2JqZWN0Lmhhc093bihtZXNzYWdlLCBcImdlbmVyYXRpb25JZFwiKVxuXG4gICAgaWYgKCF0aGlzLmdlbmVyYXRpb25JZCkgcmV0dXJuIG1lc3NhZ2VIYXNHZW5lcmF0aW9uID8gXCJ1bmV4cGVjdGVkLWdlbmVyYXRpb25cIiA6IG51bGxcbiAgICBpZiAoIW1lc3NhZ2VIYXNHZW5lcmF0aW9uKSByZXR1cm4gXCJtaXNzaW5nLWdlbmVyYXRpb25cIlxuXG4gICAgdHJ5IHtcbiAgICAgIHZhbGlkYXRlR2VuZXJhdGlvbklkKG1lc3NhZ2UuZ2VuZXJhdGlvbklkLCBcImhlbGxvIGdlbmVyYXRpb25JZFwiKVxuICAgIH0gY2F0Y2gge1xuICAgICAgcmV0dXJuIFwibWFsZm9ybWVkLWdlbmVyYXRpb25cIlxuICAgIH1cblxuICAgIGlmIChtZXNzYWdlLmdlbmVyYXRpb25JZCAhPT0gdGhpcy5nZW5lcmF0aW9uSWQpIHJldHVybiBcImdlbmVyYXRpb24tbWlzbWF0Y2hcIlxuICAgIGlmIChtZXNzYWdlLnJvbGUgPT09IFwid29ya2VyXCIgJiYgIXdvcmtlcklkQmVsb25nc1RvR2VuZXJhdGlvbih7Z2VuZXJhdGlvbklkOiB0aGlzLmdlbmVyYXRpb25JZCwgd29ya2VySWQ6IG1lc3NhZ2Uud29ya2VySWR9KSkge1xuICAgICAgcmV0dXJuIFwiZ2VuZXJhdGlvbi1taXNtYXRjaFwiXG4gICAgfVxuXG4gICAgcmV0dXJuIG51bGxcbiAgfVxuXG4gIC8qKlxuICAgKiBSZWdpc3RlcnMgYSBnZW5lcmF0aW9uLWZlbmNlZCB3b3JrZXIgYW5kIHRyYW5zZmVycyBvbmx5IGl0cyBleGFjdCBvd25lcnNoaXAuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gV29ya2VyIGhlbGxvLlxuICAgKiBAcGFyYW0ge0pzb25Tb2NrZXR9IGFyZ3MuanNvblNvY2tldCAtIE5ldyBzb2NrZXQuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi90eXBlcy5qc1wiKS5CYWNrZ3JvdW5kSm9iSGVsbG9NZXNzYWdlfSBhcmdzLm1lc3NhZ2UgLSBIZWxsby5cbiAgICogQHJldHVybnMge1Byb21pc2U8Ym9vbGVhbj59IC0gV2hldGhlciB0aGUgd29ya2VyIHdhcyBhZG1pdHRlZC5cbiAgICovXG4gIGFzeW5jIF9yZWdpc3Rlcldvcmtlcih7anNvblNvY2tldCwgbWVzc2FnZX0pIHtcbiAgICBqc29uU29ja2V0LndvcmtlcklkID0gbWVzc2FnZS53b3JrZXJJZFxuICAgIGpzb25Tb2NrZXQuc3VwcG9ydHNIYW5kb2ZmSWRSZXBvcnRpbmcgPSBtZXNzYWdlLnN1cHBvcnRzSGFuZG9mZklkUmVwb3J0aW5nID09PSB0cnVlXG4gICAganNvblNvY2tldC5zdXBwb3J0c0hlYXJ0YmVhdCA9IG1lc3NhZ2Uuc3VwcG9ydHNIZWFydGJlYXQgPT09IHRydWVcbiAgICBqc29uU29ja2V0Lmxhc3RTZWVuQXQgPSB0aGlzLmNsb2NrLm5vdygpXG5cbiAgICBjb25zdCB3b3JrZXJJZCA9IGpzb25Tb2NrZXQud29ya2VySWRcbiAgICBjb25zdCBkaXNjb25uZWN0ZWQgPSB3b3JrZXJJZCA/IHRoaXMuZGlzY29ubmVjdGVkV29ya2Vycy5nZXQod29ya2VySWQpIDogdW5kZWZpbmVkXG4gICAgbGV0IGhhbmRvZmZzID0gZGlzY29ubmVjdGVkID8gdGhpcy53b3JrZXJIYW5kb2Zmcy5nZXQoZGlzY29ubmVjdGVkLndvcmtlcikgOiB1bmRlZmluZWRcbiAgICBjb25zdCByZWNvdmVyeU9ubHkgPSB0aGlzLmxpZmVjeWNsZVN0YXRlID09PSBcInJldGlyaW5nXCIgfHwgdGhpcy5saWZlY3ljbGVTdGF0ZSA9PT0gXCJyZXRpcmVkXCJcblxuICAgIGlmIChyZWNvdmVyeU9ubHkgJiYgKCFoYW5kb2ZmcyB8fCBoYW5kb2Zmcy5zaXplID09PSAwKSkge1xuICAgICAgaWYgKCF3b3JrZXJJZCkgcmV0dXJuIGZhbHNlXG4gICAgICBjb25zdCBkdXJhYmxlSGFuZG9mZnMgPSBhd2FpdCB0aGlzLnN0b3JlLmhhbmRlZE9mZkpvYnNGb3JXb3JrZXIoe3dvcmtlcklkfSlcblxuICAgICAgaWYgKGR1cmFibGVIYW5kb2Zmcy5sZW5ndGggPT09IDApIHtcbiAgICAgICAganNvblNvY2tldC5zZW5kKHt0eXBlOiBcImdlbmVyYXRpb24tcmVqZWN0ZWRcIiwgcmVhc29uOiBcIndvcmtlci1oYXMtbm8tcmVjb3ZlcmFibGUtaGFuZG9mZnNcIn0pXG4gICAgICAgIGpzb25Tb2NrZXQuY2xvc2UoKVxuICAgICAgICByZXR1cm4gZmFsc2VcbiAgICAgIH1cblxuICAgICAgaGFuZG9mZnMgPSBuZXcgTWFwKGR1cmFibGVIYW5kb2Zmcy5tYXAoKHtqb2JJZCwgaGFuZG9mZklkfSkgPT4gW2pvYklkLCBoYW5kb2ZmSWRdKSlcbiAgICAgIHRoaXMucmVjb25uZWN0ZWRXb3JrZXJJZHMuYWRkKHdvcmtlcklkKVxuICAgIH1cblxuICAgIGlmIChkaXNjb25uZWN0ZWQpIHtcbiAgICAgIHRoaXMuY2xvY2suY2xlYXJUaW1lb3V0KGRpc2Nvbm5lY3RlZC50aW1lcilcbiAgICAgIGlmICh3b3JrZXJJZCkgdGhpcy5kaXNjb25uZWN0ZWRXb3JrZXJzLmRlbGV0ZSh3b3JrZXJJZClcbiAgICAgIHRoaXMud29ya2VySGFuZG9mZnMuZGVsZXRlKGRpc2Nvbm5lY3RlZC53b3JrZXIpXG4gICAgfVxuXG4gICAgdGhpcy53b3JrZXJzLmFkZChqc29uU29ja2V0KVxuICAgIHRoaXMud29ya2VySGFuZG9mZnMuc2V0KGpzb25Tb2NrZXQsIGhhbmRvZmZzIHx8IG5ldyBNYXAoKSlcbiAgICBpZiAocmVjb3ZlcnlPbmx5KSBqc29uU29ja2V0LmlzRHJhaW5pbmcgPSB0cnVlXG4gICAgaWYgKCFoYW5kb2ZmcyAmJiB0aGlzLmxpZmVjeWNsZVN0YXRlID09PSBcImFjdGl2ZVwiKSB0aGlzLl90cmFja1dvcmtlckhhbmRvZmZBZG9wdGlvbihqc29uU29ja2V0KVxuXG4gICAgcmV0dXJuIHRydWVcbiAgfVxuXG4gIC8qKlxuICAgKiBUcmFja3MgYSB3b3JrZXIgaGFuZG9mZi1hZG9wdGlvbiBxdWVyeSB0aHJvdWdoIHNodXRkb3duLlxuICAgKiBAcGFyYW0ge0pzb25Tb2NrZXR9IGpzb25Tb2NrZXQgLSBSZWNvbm5lY3Rpbmcgd29ya2VyIHNvY2tldC5cbiAgICogQHJldHVybnMge3ZvaWR9XG4gICAqL1xuICBfdHJhY2tXb3JrZXJIYW5kb2ZmQWRvcHRpb24oanNvblNvY2tldCkge1xuICAgIGNvbnN0IGFkb3B0aW9uID0gdGhpcy5fYWRvcHRXb3JrZXJIYW5kb2Zmcyhqc29uU29ja2V0KVxuICAgIHRoaXMuaW5mbGlnaHRXb3JrZXJIYW5kb2ZmQWRvcHRpb25zLmFkZChhZG9wdGlvbilcbiAgICBjb25zdCByZW1vdmVBZG9wdGlvbiA9ICgpID0+IHtcbiAgICAgIHRoaXMuaW5mbGlnaHRXb3JrZXJIYW5kb2ZmQWRvcHRpb25zLmRlbGV0ZShhZG9wdGlvbilcbiAgICAgIHRoaXMuX21heWJlU3RvcFJldGlyZWQoKVxuICAgIH1cbiAgICB2b2lkIGFkb3B0aW9uLnRoZW4ocmVtb3ZlQWRvcHRpb24sIHJlbW92ZUFkb3B0aW9uKVxuICB9XG5cbiAgLyoqXG4gICAqIFdhaXRzIGZvciB3b3JrZXIgaGFuZG9mZi1hZG9wdGlvbiBxdWVyaWVzIHRvIGZpbmlzaC5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgd2hlbiBubyBhZG9wdGlvbiBxdWVyeSByZW1haW5zLlxuICAgKi9cbiAgYXN5bmMgX2RyYWluV29ya2VySGFuZG9mZkFkb3B0aW9ucygpIHtcbiAgICB3aGlsZSAodGhpcy5pbmZsaWdodFdvcmtlckhhbmRvZmZBZG9wdGlvbnMuc2l6ZSA+IDApIHtcbiAgICAgIGF3YWl0IFByb21pc2UuYWxsKFsuLi50aGlzLmluZmxpZ2h0V29ya2VySGFuZG9mZkFkb3B0aW9uc10pXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIEFkb3B0cyBhIHJlY29ubmVjdGluZyB3b3JrZXIncyBzdGlsbC1hY3RpdmUgYGhhbmRlZF9vZmZgIGpvYnMgaW50byBpdHMgbmV3XG4gICAqIHNvY2tldCdzIGhhbmRvZmYgbWFwLiBBIGZyZXNoIG1haW4gKGUuZy4gYWZ0ZXIgYSBkZXBsb3kgcmVzdGFydCkgaG9sZHMgbm9cbiAgICogaW4tbWVtb3J5IGxlYXNlcywgc28gYSB3b3JrZXIgdGhhdCByZWNvbm5lY3RzIHdpdGggaXRzIHN0YWJsZSBpZCB3b3VsZFxuICAgKiBvdGhlcndpc2UgaGF2ZSBpdHMgcHJlLXJlc3RhcnQgam9icyB0cmFja2VkIG5vd2hlcmUg4oCUIGlmIGl0IHRoZW4gZGllZCwgdGhvc2VcbiAgICogbGVhc2VzIChhbmQgdGhlaXIgY29uY3VycmVuY3kgcmVzZXJ2YXRpb25zKSB3b3VsZCBzaXQgc3R1Y2sgdW50aWwgdGhlXG4gICAqIGhvdXJzLWxvbmcgb3JwaGFuIHN3ZWVwLiBBZG9wdGluZyB0aGVtIG1lYW5zIGBfaGFuZGxlV29ya2VyU29ja2V0Q2xvc2VkYFxuICAgKiByZWxlYXNlcyB0aGVtIG9uIHRoZSB3b3JrZXIncyBuZXh0IGRpc2Nvbm5lY3QsIHdoaWxlIGEgc3RpbGwtcnVubmluZyB3b3JrZXJcbiAgICogKGluY2x1ZGluZyBvbmUgZ3JhY2VmdWxseSBkcmFpbmluZykga2VlcHMgZXhlY3V0aW5nIHRoZW0gdW50b3VjaGVkLiBOb1xuICAgKiB0aW1lLWJhc2VkIHJlY2xhaW0gaXMgdXNlZCwgc28gYSBkcmFpbmluZyB3b3JrZXIgd2hvc2Ugam9icyBvdXRsaXZlIHRoZSBvbGRcbiAgICogbWFpbiBpcyBuZXZlciB3cm9uZ2x5IHJlcXVldWVkIGludG8gYSBkdXBsaWNhdGUgYXR0ZW1wdC5cbiAgICogQHBhcmFtIHtKc29uU29ja2V0fSBqc29uU29ja2V0IC0gVGhlIHJlY29ubmVjdGVkIHdvcmtlciBzb2NrZXQuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fVxuICAgKi9cbiAgYXN5bmMgX2Fkb3B0V29ya2VySGFuZG9mZnMoanNvblNvY2tldCkge1xuICAgIGNvbnN0IHdvcmtlcklkID0ganNvblNvY2tldC53b3JrZXJJZFxuXG4gICAgaWYgKHR5cGVvZiB3b3JrZXJJZCAhPT0gXCJzdHJpbmdcIiB8fCB3b3JrZXJJZC5sZW5ndGggPT09IDApIHJldHVyblxuXG4gICAgdHJ5IHtcbiAgICAgIGNvbnN0IGhhbmRvZmZzID0gYXdhaXQgdGhpcy5zdG9yZS5oYW5kZWRPZmZKb2JzRm9yV29ya2VyKHt3b3JrZXJJZH0pXG4gICAgICBjb25zdCBtYXAgPSB0aGlzLndvcmtlckhhbmRvZmZzLmdldChqc29uU29ja2V0KVxuXG4gICAgICAvLyBUaGUgc29ja2V0IG1heSBoYXZlIGNsb3NlZCB3aGlsZSB0aGUgcXVlcnkgd2FzIGluIGZsaWdodDsgaXRzIG1hcCBpcyB0aGVuXG4gICAgICAvLyBnb25lIGFuZCB0aGUgam9icyBhcmUgbGVmdCBmb3IgdGhlIG9ycGhhbiBzd2VlcCByYXRoZXIgdGhhbiByZXN1cnJlY3RlZC5cbiAgICAgIGlmICghbWFwIHx8ICF0aGlzLndvcmtlcnMuaGFzKGpzb25Tb2NrZXQpKSByZXR1cm5cblxuICAgICAgZm9yIChjb25zdCB7am9iSWQsIGhhbmRvZmZJZH0gb2YgaGFuZG9mZnMpIHtcbiAgICAgICAgbWFwLnNldChqb2JJZCwgaGFuZG9mZklkKVxuICAgICAgfVxuICAgICAgdGhpcy5yZWNvbm5lY3RlZFdvcmtlcklkcy5hZGQod29ya2VySWQpXG4gICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgIHRoaXMuX3JlcG9ydEhhbmRvZmZBZG9wdEVycm9yKGVycm9yKVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGhhbmRsZSBjbGllbnQgc29ja2V0IG1lc3NhZ2UuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gT3B0aW9ucy5cbiAgICogQHBhcmFtIHtKc29uU29ja2V0fSBhcmdzLmpzb25Tb2NrZXQgLSBKU09OIHNvY2tldC5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL3R5cGVzLmpzXCIpLkJhY2tncm91bmRKb2JTb2NrZXRNZXNzYWdlfSBhcmdzLm1lc3NhZ2UgLSBTb2NrZXQgbWVzc2FnZS5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgYWZ0ZXIgdGhlIHJlcXVlc3QgaXMgYWNrbm93bGVkZ2VkLlxuICAgKi9cbiAgYXN5bmMgX2hhbmRsZUNsaWVudFNvY2tldE1lc3NhZ2Uoe2pzb25Tb2NrZXQsIG1lc3NhZ2V9KSB7XG4gICAgaWYgKHRoaXMuZ2VuZXJhdGlvbklkICYmICh0aGlzLmxpZmVjeWNsZVN0YXRlID09PSBcInJldGlyaW5nXCIgfHwgdGhpcy5saWZlY3ljbGVTdGF0ZSA9PT0gXCJyZXRpcmVkXCIpKSB7XG4gICAgICBpZiAobWVzc2FnZT8udHlwZSA9PT0gXCJlbnF1ZXVlXCIpIGpzb25Tb2NrZXQuc2VuZCh7dHlwZTogXCJlbnF1ZXVlLWVycm9yXCIsIGVycm9yOiBcIkJhY2tncm91bmQgam9icyBnZW5lcmF0aW9uIGlzIHJldGlyZWRcIn0pXG4gICAgICBpZiAobWVzc2FnZT8udHlwZSA9PT0gXCJyZXBsYWNlLXNjaGVkdWxlZFwiKSBqc29uU29ja2V0LnNlbmQoe3R5cGU6IFwicmVwbGFjZS1zY2hlZHVsZWQtZXJyb3JcIiwgZXJyb3I6IFwiQmFja2dyb3VuZCBqb2JzIGdlbmVyYXRpb24gaXMgcmV0aXJlZFwifSlcbiAgICAgIGlmIChtZXNzYWdlPy50eXBlID09PSBcImNhbmNlbC1zY2hlZHVsZWRcIikganNvblNvY2tldC5zZW5kKHt0eXBlOiBcImNhbmNlbC1zY2hlZHVsZWQtZXJyb3JcIiwgZXJyb3I6IFwiQmFja2dyb3VuZCBqb2JzIGdlbmVyYXRpb24gaXMgcmV0aXJlZFwifSlcbiAgICAgIHJldHVyblxuICAgIH1cblxuICAgIGlmIChtZXNzYWdlPy50eXBlID09PSBcImVucXVldWVcIikge1xuICAgICAgYXdhaXQgdGhpcy5faGFuZGxlRW5xdWV1ZSh7anNvblNvY2tldCwgbWVzc2FnZX0pXG4gICAgICByZXR1cm5cbiAgICB9XG5cbiAgICBpZiAobWVzc2FnZT8udHlwZSA9PT0gXCJyZXBsYWNlLXNjaGVkdWxlZFwiKSB7XG4gICAgICBhd2FpdCB0aGlzLl9oYW5kbGVSZXBsYWNlU2NoZWR1bGVkKHtqc29uU29ja2V0LCBtZXNzYWdlfSlcbiAgICAgIHJldHVyblxuICAgIH1cblxuICAgIGlmIChtZXNzYWdlPy50eXBlID09PSBcImNhbmNlbC1zY2hlZHVsZWRcIikge1xuICAgICAgYXdhaXQgdGhpcy5faGFuZGxlQ2FuY2VsU2NoZWR1bGVkKHtqc29uU29ja2V0LCBtZXNzYWdlfSlcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogUnVucyBoYW5kbGUgd29ya2VyIHNvY2tldCBtZXNzYWdlLlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIE9wdGlvbnMuXG4gICAqIEBwYXJhbSB7SnNvblNvY2tldH0gYXJncy5qc29uU29ja2V0IC0gSlNPTiBzb2NrZXQuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi90eXBlcy5qc1wiKS5CYWNrZ3JvdW5kSm9iU29ja2V0TWVzc2FnZX0gYXJncy5tZXNzYWdlIC0gU29ja2V0IG1lc3NhZ2UuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIGFmdGVyIHRoZSB3b3JrZXIgbWVzc2FnZSBpcyBoYW5kbGVkLlxuICAgKi9cbiAgYXN5bmMgX2hhbmRsZVdvcmtlclNvY2tldE1lc3NhZ2Uoe2pzb25Tb2NrZXQsIG1lc3NhZ2V9KSB7XG4gICAgLy8gQW55IG1lc3NhZ2UgZnJvbSB0aGUgd29ya2VyIHByb3ZlcyBpdCBpcyBhbGl2ZTsgdGhlIGxpdmVuZXNzIHN3ZWVwIHVzZXNcbiAgICAvLyB0aGlzIHRvIGRldGVjdCBhIHdlZGdlZC9zaWxlbnQgd29ya2VyLlxuICAgIGpzb25Tb2NrZXQubGFzdFNlZW5BdCA9IHRoaXMuY2xvY2subm93KClcblxuICAgIGlmIChtZXNzYWdlPy50eXBlID09PSBcImhlYXJ0YmVhdFwiKSB7XG4gICAgICB0aGlzLm9uV29ya2VySGVhcnRiZWF0Py4oanNvblNvY2tldClcbiAgICAgIHJldHVyblxuICAgIH1cblxuICAgIGlmIChtZXNzYWdlPy50eXBlID09PSBcInJlYWR5XCIpIHtcbiAgICAgIHRoaXMuX2hhbmRsZVdvcmtlclJlYWR5KHtqc29uU29ja2V0LCBtZXNzYWdlfSlcbiAgICAgIHJldHVyblxuICAgIH1cblxuICAgIGlmIChtZXNzYWdlPy50eXBlID09PSBcImRyYWluaW5nXCIpIHtcbiAgICAgIHRoaXMuX2hhbmRsZVdvcmtlckRyYWluaW5nKHtqc29uU29ja2V0fSlcbiAgICAgIHJldHVyblxuICAgIH1cblxuICAgIGF3YWl0IHRoaXMuX2hhbmRsZVJlcG9ydGVyU29ja2V0TWVzc2FnZSh7anNvblNvY2tldCwgbWVzc2FnZX0pXG4gIH1cblxuICAvKipcbiAgICogUnVucyBoYW5kbGUgcmVwb3J0ZXIgc29ja2V0IG1lc3NhZ2UuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gT3B0aW9ucy5cbiAgICogQHBhcmFtIHtKc29uU29ja2V0fSBhcmdzLmpzb25Tb2NrZXQgLSBKU09OIHNvY2tldC5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL3R5cGVzLmpzXCIpLkJhY2tncm91bmRKb2JTb2NrZXRNZXNzYWdlfSBhcmdzLm1lc3NhZ2UgLSBTb2NrZXQgbWVzc2FnZS5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgYWZ0ZXIgdGhlIHJlcG9ydCBpcyBhY2tub3dsZWRnZWQuXG4gICAqL1xuICBhc3luYyBfaGFuZGxlUmVwb3J0ZXJTb2NrZXRNZXNzYWdlKHtqc29uU29ja2V0LCBtZXNzYWdlfSkge1xuICAgIGlmICh0aGlzLmdlbmVyYXRpb25JZCAmJiB0aGlzLl9nZW5lcmF0aW9uUmVwb3J0SXNJbnZhbGlkKG1lc3NhZ2UpKSB7XG4gICAgICBpZiAoXCJqb2JJZFwiIGluIG1lc3NhZ2UgJiYgdHlwZW9mIG1lc3NhZ2Uuam9iSWQgPT09IFwic3RyaW5nXCIpIHtcbiAgICAgICAganNvblNvY2tldC5zZW5kKHt0eXBlOiBcImpvYi11cGRhdGUtZXJyb3JcIiwgam9iSWQ6IG1lc3NhZ2Uuam9iSWQsIGVycm9yOiBcIkdlbmVyYXRpb24gb3duZXJzaGlwIHJlamVjdGVkXCJ9KVxuICAgICAgfVxuICAgICAgcmV0dXJuXG4gICAgfVxuICAgIGlmIChtZXNzYWdlPy50eXBlID09PSBcImpvYi1jb21wbGV0ZVwiKSB7XG4gICAgICBhd2FpdCB0aGlzLl9oYW5kbGVKb2JDb21wbGV0ZSh7anNvblNvY2tldCwgbWVzc2FnZX0pXG4gICAgICByZXR1cm5cbiAgICB9XG5cbiAgICBpZiAobWVzc2FnZT8udHlwZSA9PT0gXCJqb2ItZmFpbGVkXCIpIHtcbiAgICAgIGF3YWl0IHRoaXMuX2hhbmRsZUpvYkZhaWxlZCh7anNvblNvY2tldCwgbWVzc2FnZX0pXG4gICAgICByZXR1cm5cbiAgICB9XG5cbiAgICBpZiAobWVzc2FnZT8udHlwZSA9PT0gXCJqb2ItcmVzY2hlZHVsZVwiKSB7XG4gICAgICBhd2FpdCB0aGlzLl9oYW5kbGVKb2JSZXNjaGVkdWxlKHtqc29uU29ja2V0LCBtZXNzYWdlfSlcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogUmVxdWlyZXMgdGhlIGNvbXBsZXRlIGR1cmFibGUgbGVhc2UgaWRlbnRpdHkgYmVmb3JlIGEgZ2VuZXJhdGlvbi1tb2RlXG4gICAqIHJlcG9ydGVyIGNhbiBtdXRhdGUgYSBqb2IuIExlZ2FjeSByZXBvcnRlcnMga2VlcCB0aGVpciBwZXJtaXNzaXZlIHByb3RvY29sLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vdHlwZXMuanNcIikuQmFja2dyb3VuZEpvYlNvY2tldE1lc3NhZ2V9IG1lc3NhZ2UgLSBSZXBvcnRlciBtZXNzYWdlLlxuICAgKiBAcmV0dXJucyB7Ym9vbGVhbn0gLSBXaGV0aGVyIHRoZSByZXBvcnQgbGFja3MgaXRzIGV4YWN0IGdlbmVyYXRpb24gbGVhc2UuXG4gICAqL1xuICBfZ2VuZXJhdGlvblJlcG9ydElzSW52YWxpZChtZXNzYWdlKSB7XG4gICAgaWYgKG1lc3NhZ2U/LnR5cGUgIT09IFwiam9iLWNvbXBsZXRlXCIgJiYgbWVzc2FnZT8udHlwZSAhPT0gXCJqb2ItZmFpbGVkXCIgJiYgbWVzc2FnZT8udHlwZSAhPT0gXCJqb2ItcmVzY2hlZHVsZVwiKSByZXR1cm4gZmFsc2VcbiAgICBjb25zdCBnZW5lcmF0aW9uSWQgPSB0aGlzLmdlbmVyYXRpb25JZFxuICAgIGlmICghZ2VuZXJhdGlvbklkKSByZXR1cm4gZmFsc2VcblxuICAgIHJldHVybiB0eXBlb2YgbWVzc2FnZS5oYW5kb2ZmSWQgIT09IFwic3RyaW5nXCJcbiAgICAgIHx8IHR5cGVvZiBtZXNzYWdlLmhhbmRlZE9mZkF0TXMgIT09IFwibnVtYmVyXCJcbiAgICAgIHx8ICF3b3JrZXJJZEJlbG9uZ3NUb0dlbmVyYXRpb24oe2dlbmVyYXRpb25JZCwgd29ya2VySWQ6IG1lc3NhZ2Uud29ya2VySWR9KVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgaGFuZGxlIHdvcmtlciByZWFkeS5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBPcHRpb25zLlxuICAgKiBAcGFyYW0ge0pzb25Tb2NrZXR9IGFyZ3MuanNvblNvY2tldCAtIEpTT04gc29ja2V0LlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vdHlwZXMuanNcIikuQmFja2dyb3VuZEpvYlJlYWR5TWVzc2FnZX0gYXJncy5tZXNzYWdlIC0gUmVhZHkgbWVzc2FnZS5cbiAgICogQHJldHVybnMge3ZvaWR9XG4gICAqL1xuICBfaGFuZGxlV29ya2VyUmVhZHkoe2pzb25Tb2NrZXQsIG1lc3NhZ2V9KSB7XG4gICAgaWYgKHRoaXMubGlmZWN5Y2xlU3RhdGUgPT09IFwicmV0aXJpbmdcIiB8fCB0aGlzLmxpZmVjeWNsZVN0YXRlID09PSBcInJldGlyZWRcIikge1xuICAgICAgdGhpcy5yZWFkeVdvcmtlcnMuZGVsZXRlKGpzb25Tb2NrZXQpXG4gICAgICB0aGlzLmNhbmRpZGF0ZVJlYWR5V29ya2Vycy5kZWxldGUoanNvblNvY2tldClcbiAgICAgIHJldHVyblxuICAgIH1cblxuICAgIGpzb25Tb2NrZXQucmVhZGluZXNzVmVyc2lvbiArPSAxXG4gICAganNvblNvY2tldC5hY2NlcHRzU3Bhd25lZEpvYnMgPSBtZXNzYWdlLmFjY2VwdHNTcGF3bmVkICE9PSBmYWxzZSAmJiBtZXNzYWdlLmFjY2VwdHNGb3JrZWQgIT09IGZhbHNlXG4gICAganNvblNvY2tldC5hY2NlcHRzRm9ya2VkSm9icyA9IG1lc3NhZ2UuYWNjZXB0c0ZvcmtlZCAhPT0gZmFsc2VcbiAgICBqc29uU29ja2V0LmFjY2VwdHNQb29sZWRKb2JzID0gbWVzc2FnZS5hY2NlcHRzUG9vbGVkID09PSB0cnVlXG4gICAgY29uc3QgYXZhaWxhYmxlUG9vbGVkU2xvdHMgPSBtZXNzYWdlLmF2YWlsYWJsZVBvb2xlZFNsb3RzXG4gICAganNvblNvY2tldC51c2VzUG9vbGVkQ2FwYWNpdHlDcmVkaXRzID0gTnVtYmVyLmlzSW50ZWdlcihhdmFpbGFibGVQb29sZWRTbG90cylcbiAgICBqc29uU29ja2V0LmF2YWlsYWJsZVBvb2xlZFNsb3RzID0gTnVtYmVyLmlzSW50ZWdlcihhdmFpbGFibGVQb29sZWRTbG90cykgJiYgYXZhaWxhYmxlUG9vbGVkU2xvdHMgIT09IHVuZGVmaW5lZCAmJiBhdmFpbGFibGVQb29sZWRTbG90cyA+IDBcbiAgICAgID8gYXZhaWxhYmxlUG9vbGVkU2xvdHNcbiAgICAgIDogMFxuICAgIGpzb25Tb2NrZXQuYWNjZXB0c0lubGluZUpvYnMgPSBtZXNzYWdlLmFjY2VwdHNJbmxpbmUgIT09IGZhbHNlXG4gICAgaWYgKHRoaXMubGlmZWN5Y2xlU3RhdGUgPT09IFwiY2FuZGlkYXRlXCIpIHtcbiAgICAgIHRoaXMucmVhZHlXb3JrZXJzLmRlbGV0ZShqc29uU29ja2V0KVxuICAgICAgaWYgKCFqc29uU29ja2V0LmlzRHJhaW5pbmcpIHRoaXMuY2FuZGlkYXRlUmVhZHlXb3JrZXJzLmFkZChqc29uU29ja2V0KVxuICAgIH0gZWxzZSBpZiAodGhpcy5saWZlY3ljbGVTdGF0ZSA9PT0gXCJhY3RpdmVcIiAmJiB0aGlzLl9hY3RpdmVPd25lcnNoaXBSZWFkeSAmJiBqc29uU29ja2V0LnN1cHBvcnRzSGFuZG9mZklkUmVwb3J0aW5nICYmICFqc29uU29ja2V0LmlzRHJhaW5pbmcpIHtcbiAgICAgIHRoaXMucmVhZHlXb3JrZXJzLmFkZChqc29uU29ja2V0KVxuICAgIH0gZWxzZSB7XG4gICAgICB0aGlzLnJlYWR5V29ya2Vycy5kZWxldGUoanNvblNvY2tldClcbiAgICAgIHRoaXMuY2FuZGlkYXRlUmVhZHlXb3JrZXJzLmRlbGV0ZShqc29uU29ja2V0KVxuICAgIH1cbiAgICB0aGlzLm9uV29ya2VyUmVhZHk/Lihqc29uU29ja2V0KVxuICAgIHZvaWQgdGhpcy5fZHJhaW4oKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgaGFuZGxlIHdvcmtlciBkcmFpbmluZy5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBPcHRpb25zLlxuICAgKiBAcGFyYW0ge0pzb25Tb2NrZXR9IGFyZ3MuanNvblNvY2tldCAtIEpTT04gc29ja2V0LlxuICAgKiBAcmV0dXJucyB7dm9pZH1cbiAgICovXG4gIF9oYW5kbGVXb3JrZXJEcmFpbmluZyh7anNvblNvY2tldH0pIHtcbiAgICAvLyBUaGUgd29ya2VyIGlzIHNodXR0aW5nIGRvd24gZ3JhY2VmdWxseS4gU3RvcCBkaXNwYXRjaGluZyBuZXcgam9ic1xuICAgIC8vIHRvIGl0IGJ1dCBrZWVwIHRoZSBjb25uZWN0aW9uIGluIGB3b3JrZXJzYCBzbyBhbnkgaW4tZmxpZ2h0IGpvYlxuICAgIC8vIGl0J3Mgc3RpbGwgZHJhaW5pbmcgY2FuIHJlcG9ydCBpdHMgcmVzdWx0LlxuICAgIGpzb25Tb2NrZXQuaXNEcmFpbmluZyA9IHRydWVcbiAgICB0aGlzLnJlYWR5V29ya2Vycy5kZWxldGUoanNvblNvY2tldClcbiAgICB0aGlzLmNhbmRpZGF0ZVJlYWR5V29ya2Vycy5kZWxldGUoanNvblNvY2tldClcbiAgfVxuXG4gIC8qKlxuICAgKiBSZW1vdmVzIGEgbG9zdCB3b3JrZXIgc29ja2V0IGFuZCByZWxlYXNlcyBvbmx5IGxlYXNlcyBkaXNwYXRjaGVkIHRocm91Z2ggaXQuXG4gICAqIEBwYXJhbSB7SnNvblNvY2tldH0gd29ya2VyIC0gRGlzY29ubmVjdGVkIHdvcmtlciBzb2NrZXQuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBbYXJnc10gLSBDb29yZGluYXRpb24gb3B0aW9ucy5cbiAgICogQHBhcmFtIHtib29sZWFufSBbYXJncy5xdWV1ZVJlZHJhaW5dIC0gUXVldWUgYW5vdGhlciBwYXNzIGluc3RlYWQgb2YgYXdhaXRpbmcgdGhlIGFjdGl2ZSBkcmFpbi5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgYWZ0ZXIgaXRzIGFjdGl2ZSBsZWFzZXMgYXJlIHJlbGVhc2VkLlxuICAgKi9cbiAgYXN5bmMgX2hhbmRsZVdvcmtlclNvY2tldENsb3NlZCh3b3JrZXIsIHtxdWV1ZVJlZHJhaW4gPSBmYWxzZX0gPSB7fSkge1xuICAgIHRoaXMud29ya2Vycy5kZWxldGUod29ya2VyKVxuICAgIHRoaXMucmVhZHlXb3JrZXJzLmRlbGV0ZSh3b3JrZXIpXG4gICAgdGhpcy5jYW5kaWRhdGVSZWFkeVdvcmtlcnMuZGVsZXRlKHdvcmtlcilcblxuICAgIGlmICh0aGlzLl9zdG9wcGVkKSB7XG4gICAgICB0aGlzLndvcmtlckhhbmRvZmZzLmRlbGV0ZSh3b3JrZXIpXG4gICAgICByZXR1cm5cbiAgICB9XG5cbiAgICBjb25zdCBoYW5kb2ZmcyA9IHRoaXMud29ya2VySGFuZG9mZnMuZ2V0KHdvcmtlcilcbiAgICBpZiAodGhpcy5nZW5lcmF0aW9uSWQgJiYgd29ya2VyLndvcmtlcklkICYmIGhhbmRvZmZzICYmIGhhbmRvZmZzLnNpemUgPiAwKSB7XG4gICAgICBjb25zdCBleGlzdGluZyA9IHRoaXMuZGlzY29ubmVjdGVkV29ya2Vycy5nZXQod29ya2VyLndvcmtlcklkKVxuICAgICAgaWYgKGV4aXN0aW5nPy53b3JrZXIgPT09IHdvcmtlcikgcmV0dXJuXG4gICAgICBpZiAoZXhpc3RpbmcpIHRoaXMuY2xvY2suY2xlYXJUaW1lb3V0KGV4aXN0aW5nLnRpbWVyKVxuXG4gICAgICBjb25zdCB0aW1lciA9IHRoaXMuY2xvY2suc2V0VGltZW91dCgoKSA9PiB7XG4gICAgICAgIHRoaXMuZGlzY29ubmVjdGVkV29ya2Vycy5kZWxldGUod29ya2VyLndvcmtlcklkIHx8IFwiXCIpXG4gICAgICAgIHZvaWQgdGhpcy5fcmVsZWFzZVdvcmtlckhhbmRvZmZzKHdvcmtlcikudGhlbigoKSA9PiB7XG4gICAgICAgICAgaWYgKHdvcmtlci53b3JrZXJJZCkgdGhpcy5vbldvcmtlckhhbmRvZmZzUmVsZWFzZWQ/Lih3b3JrZXIud29ya2VySWQpXG4gICAgICAgIH0sIChlcnJvcikgPT4ge1xuICAgICAgICAgIHRoaXMuX3JlcG9ydEhhbmRvZmZSZWxlYXNlRXJyb3IoZXJyb3IpXG4gICAgICAgICAgdGhpcy5fc2NoZWR1bGVFcnJvclJldHJ5KClcbiAgICAgICAgfSlcbiAgICAgIH0sIHRoaXMud29ya2VyUmVjb25uZWN0R3JhY2VNcylcbiAgICAgIGlmICh0eXBlb2YgdGltZXIgPT09IFwib2JqZWN0XCIpIHRpbWVyLnVucmVmKClcbiAgICAgIHRoaXMuZGlzY29ubmVjdGVkV29ya2Vycy5zZXQod29ya2VyLndvcmtlcklkLCB7d29ya2VyLCB0aW1lcn0pXG4gICAgICB0aGlzLm9uV29ya2VyRGlzY29ubmVjdGVkPy4od29ya2VyLndvcmtlcklkKVxuICAgICAgcmV0dXJuXG4gICAgfVxuXG4gICAgdHJ5IHtcbiAgICAgIGF3YWl0IHRoaXMuX3JlbGVhc2VXb3JrZXJIYW5kb2Zmcyh3b3JrZXIsIHtxdWV1ZVJlZHJhaW59KVxuICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICB0aGlzLl9yZXBvcnRIYW5kb2ZmUmVsZWFzZUVycm9yKGVycm9yKVxuICAgICAgdGhpcy5fc2NoZWR1bGVFcnJvclJldHJ5KClcbiAgICB9XG4gICAgdGhpcy5fbWF5YmVTdG9wUmV0aXJlZCgpXG4gIH1cblxuICAvKipcbiAgICogUmVsZWFzZXMgYWxsIGxlYXNlcyBzdGlsbCBvd25lZCBieSBvbmUgZXhhY3Qgd29ya2VyIHNvY2tldC5cbiAgICogQHBhcmFtIHtKc29uU29ja2V0fSB3b3JrZXIgLSBXb3JrZXIgc29ja2V0LlxuICAgKiBAcGFyYW0ge29iamVjdH0gW2FyZ3NdIC0gQ29vcmRpbmF0aW9uIG9wdGlvbnMuXG4gICAqIEBwYXJhbSB7Ym9vbGVhbn0gW2FyZ3MucXVldWVSZWRyYWluXSAtIFF1ZXVlIGFub3RoZXIgcGFzcyBpbnN0ZWFkIG9mIGF3YWl0aW5nIHRoZSBhY3RpdmUgZHJhaW4uXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIGFmdGVyIGZlbmNlZCByZWxlYXNlcyBhbmQgZGlzcGF0Y2ggd2FrZS11cC5cbiAgICovXG4gIGFzeW5jIF9yZWxlYXNlV29ya2VySGFuZG9mZnMod29ya2VyLCB7cXVldWVSZWRyYWluID0gZmFsc2V9ID0ge30pIHtcbiAgICBjb25zdCBoYW5kb2ZmcyA9IHRoaXMud29ya2VySGFuZG9mZnMuZ2V0KHdvcmtlcilcblxuICAgIGlmICghaGFuZG9mZnMgfHwgaGFuZG9mZnMuc2l6ZSA9PT0gMCkge1xuICAgICAgdGhpcy53b3JrZXJIYW5kb2Zmcy5kZWxldGUod29ya2VyKVxuICAgICAgcmV0dXJuXG4gICAgfVxuXG4gICAgZm9yIChjb25zdCBbam9iSWQsIGhhbmRvZmZJZF0gb2YgaGFuZG9mZnMpIHtcbiAgICAgIGF3YWl0IHRoaXMuX3JlbGVhc2VIYW5kb2ZmKHtoYW5kb2ZmSWQsIGpvYklkLCB3b3JrZXJ9KVxuICAgIH1cblxuICAgIHRoaXMud29ya2VySGFuZG9mZnMuZGVsZXRlKHdvcmtlcilcbiAgICB0aGlzLl9ub3RpZnlFbnF1ZXVlZCgpXG4gICAgaWYgKHF1ZXVlUmVkcmFpbikge1xuICAgICAgdGhpcy5fcmVkcmFpblF1ZXVlZCA9IHRydWVcbiAgICB9IGVsc2Uge1xuICAgICAgaWYgKHRoaXMubGlmZWN5Y2xlU3RhdGUgPT09IFwiYWN0aXZlXCIpIGF3YWl0IHRoaXMuX2RyYWluKClcbiAgICB9XG4gICAgdGhpcy5fbWF5YmVTdG9wUmV0aXJlZCgpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBvbmUgaWRlbXBvdGVudCBjb25kaXRpb25hbCBsZWFzZSByZWxlYXNlLlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIE9wdGlvbnMuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBhcmdzLmhhbmRvZmZJZCAtIEhhbmRvZmYgbGVhc2UgaWQuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBhcmdzLmpvYklkIC0gSm9iIGlkLlxuICAgKiBAcGFyYW0ge0pzb25Tb2NrZXR9IGFyZ3Mud29ya2VyIC0gU29ja2V0IHRoYXQgcmVjZWl2ZWQgdGhlIGxlYXNlLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyBhZnRlciB0aGUgZmVuY2VkIHRyYW5zaXRpb24uXG4gICAqL1xuICBhc3luYyBfcmVsZWFzZUhhbmRvZmYoe2hhbmRvZmZJZCwgam9iSWQsIHdvcmtlcn0pIHtcbiAgICBhd2FpdCB0aGlzLnN0b3JlLm1hcmtSZXR1cm5lZFRvUXVldWUoe2hhbmRvZmZJZCwgam9iSWR9KVxuXG4gICAgY29uc3QgaGFuZG9mZnMgPSB0aGlzLndvcmtlckhhbmRvZmZzLmdldCh3b3JrZXIpXG5cbiAgICBpZiAoaGFuZG9mZnM/LmdldChqb2JJZCkgPT09IGhhbmRvZmZJZCkgaGFuZG9mZnMuZGVsZXRlKGpvYklkKVxuICB9XG5cbiAgLyoqXG4gICAqIEZvcmdldHMgYSBzdWNjZXNzZnVsbHkgcmVwb3J0ZWQgbGVhc2Ugd2l0aG91dCByZWx5aW5nIG9uIHdvcmtlciBpZHMuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gT3B0aW9ucy5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGFyZ3MuaGFuZG9mZklkIC0gSGFuZG9mZiBsZWFzZSBpZC5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGFyZ3Muam9iSWQgLSBKb2IgaWQuXG4gICAqIEByZXR1cm5zIHt2b2lkfVxuICAgKi9cbiAgX2ZvcmdldEhhbmRvZmYoe2hhbmRvZmZJZCwgam9iSWR9KSB7XG4gICAgZm9yIChjb25zdCBbd29ya2VyLCBoYW5kb2Zmc10gb2YgdGhpcy53b3JrZXJIYW5kb2Zmcykge1xuICAgICAgaWYgKGhhbmRvZmZzLmdldChqb2JJZCkgIT09IGhhbmRvZmZJZCkgY29udGludWVcblxuICAgICAgaGFuZG9mZnMuZGVsZXRlKGpvYklkKVxuICAgICAgaWYgKGhhbmRvZmZzLnNpemUgPT09IDAgJiYgIXRoaXMud29ya2Vycy5oYXMod29ya2VyKSkgdGhpcy53b3JrZXJIYW5kb2Zmcy5kZWxldGUod29ya2VyKVxuICAgICAgaWYgKGhhbmRvZmZzLnNpemUgPT09IDAgJiYgd29ya2VyLndvcmtlcklkKSB7XG4gICAgICAgIGNvbnN0IGRpc2Nvbm5lY3RlZCA9IHRoaXMuZGlzY29ubmVjdGVkV29ya2Vycy5nZXQod29ya2VyLndvcmtlcklkKVxuICAgICAgICBpZiAoZGlzY29ubmVjdGVkPy53b3JrZXIgPT09IHdvcmtlcikge1xuICAgICAgICAgIHRoaXMuY2xvY2suY2xlYXJUaW1lb3V0KGRpc2Nvbm5lY3RlZC50aW1lcilcbiAgICAgICAgICB0aGlzLmRpc2Nvbm5lY3RlZFdvcmtlcnMuZGVsZXRlKHdvcmtlci53b3JrZXJJZClcbiAgICAgICAgfVxuICAgICAgfVxuICAgICAgdGhpcy5fbWF5YmVTdG9wUmV0aXJlZCgpXG4gICAgICByZXR1cm5cbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogUmVwb3J0cyBhbiB1bmV4cGVjdGVkIGxlYXNlLXJlbGVhc2UgZmFpbHVyZSBvbiBmcmFtZXdvcmsgZXJyb3IgY2hhbm5lbHMuXG4gICAqIEBwYXJhbSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59IGVycm9yIC0gUmVsZWFzZSBmYWlsdXJlLlxuICAgKiBAcmV0dXJucyB7dm9pZH1cbiAgICovXG4gIF9yZXBvcnRIYW5kb2ZmUmVsZWFzZUVycm9yKGVycm9yKSB7XG4gICAgY29uc3Qgbm9ybWFsaXplZEVycm9yID0gZXJyb3IgaW5zdGFuY2VvZiBFcnJvciA/IGVycm9yIDogbmV3IEVycm9yKFN0cmluZyhlcnJvcikpXG4gICAgY29uc3QgcGF5bG9hZCA9IHtjb250ZXh0OiB7c3RhZ2U6IFwiYmFja2dyb3VuZC1qb2ItaGFuZG9mZi1yZWxlYXNlXCJ9LCBlcnJvcjogbm9ybWFsaXplZEVycm9yfVxuICAgIGNvbnN0IGVycm9yRXZlbnRzID0gdGhpcy5jb25maWd1cmF0aW9uLmdldEVycm9yRXZlbnRzKClcblxuICAgIHRoaXMubG9nZ2VyLmVycm9yKCgpID0+IFtcIkZhaWxlZCB0byByZWxlYXNlIGRpc2Nvbm5lY3RlZCB3b3JrZXIgaGFuZG9mZnM6XCIsIG5vcm1hbGl6ZWRFcnJvcl0pXG4gICAgZXJyb3JFdmVudHMuZW1pdChcImZyYW1ld29yay1lcnJvclwiLCBwYXlsb2FkKVxuICAgIGVycm9yRXZlbnRzLmVtaXQoXCJhbGwtZXJyb3JcIiwgey4uLnBheWxvYWQsIGVycm9yVHlwZTogXCJmcmFtZXdvcmstZXJyb3JcIn0pXG4gIH1cblxuICAvKipcbiAgICogUmVwb3J0cyBhbiB1bmV4cGVjdGVkIHdvcmtlci1oYW5kb2ZmIGFkb3B0aW9uIGZhaWx1cmUgb24gZnJhbWV3b3JrIGVycm9yXG4gICAqIGNoYW5uZWxzLiBBIGZhaWxlZCBhZG9wdGlvbiBpcyBub3QgZmF0YWwgKHRoZSB3b3JrZXIncyBqb2JzIHJlbWFpbiBhbmQgYXJlXG4gICAqIHJlY2xhaW1lZCBieSB0aGUgb3JwaGFuIHN3ZWVwKSwgYnV0IG11c3Qgc3VyZmFjZSByYXRoZXIgdGhhbiBiZSBzd2FsbG93ZWQuXG4gICAqIEBwYXJhbSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59IGVycm9yIC0gQWRvcHRpb24gZmFpbHVyZS5cbiAgICogQHJldHVybnMge3ZvaWR9XG4gICAqL1xuICBfcmVwb3J0SGFuZG9mZkFkb3B0RXJyb3IoZXJyb3IpIHtcbiAgICBjb25zdCBub3JtYWxpemVkRXJyb3IgPSBlcnJvciBpbnN0YW5jZW9mIEVycm9yID8gZXJyb3IgOiBuZXcgRXJyb3IoU3RyaW5nKGVycm9yKSlcbiAgICBjb25zdCBwYXlsb2FkID0ge2NvbnRleHQ6IHtzdGFnZTogXCJiYWNrZ3JvdW5kLWpvYi1oYW5kb2ZmLWFkb3B0XCJ9LCBlcnJvcjogbm9ybWFsaXplZEVycm9yfVxuICAgIGNvbnN0IGVycm9yRXZlbnRzID0gdGhpcy5jb25maWd1cmF0aW9uLmdldEVycm9yRXZlbnRzKClcblxuICAgIHRoaXMubG9nZ2VyLmVycm9yKCgpID0+IFtcIkZhaWxlZCB0byBhZG9wdCByZWNvbm5lY3RlZCB3b3JrZXIgaGFuZG9mZnM6XCIsIG5vcm1hbGl6ZWRFcnJvcl0pXG4gICAgZXJyb3JFdmVudHMuZW1pdChcImZyYW1ld29yay1lcnJvclwiLCBwYXlsb2FkKVxuICAgIGVycm9yRXZlbnRzLmVtaXQoXCJhbGwtZXJyb3JcIiwgey4uLnBheWxvYWQsIGVycm9yVHlwZTogXCJmcmFtZXdvcmstZXJyb3JcIn0pXG4gIH1cblxuICAvKipcbiAgICogUmVwb3J0cyBhbiB1bmV4cGVjdGVkIHN0YXJ0dXAtc25hcHNob3QgcmVjbGFpbSBmYWlsdXJlIHdoaWxlIHJldGFpbmluZyB0aGVcbiAgICogc25hcHNob3QgZm9yIHRoZSBkaXNwYXRjaGVyJ3MgZXhpc3RpbmcgdHJhbnNpZW50LWVycm9yIHJldHJ5IGxpZmVjeWNsZS5cbiAgICogQHBhcmFtIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gZXJyb3IgLSBSZWNsYWltIGZhaWx1cmUuXG4gICAqIEByZXR1cm5zIHt2b2lkfVxuICAgKi9cbiAgX3JlcG9ydFN0YXJ0dXBIYW5kb2ZmUmVjbGFpbUVycm9yKGVycm9yKSB7XG4gICAgY29uc3Qgbm9ybWFsaXplZEVycm9yID0gZXJyb3IgaW5zdGFuY2VvZiBFcnJvciA/IGVycm9yIDogbmV3IEVycm9yKFN0cmluZyhlcnJvcikpXG4gICAgY29uc3QgcGF5bG9hZCA9IHtjb250ZXh0OiB7c3RhZ2U6IFwiYmFja2dyb3VuZC1qb2Itc3RhcnR1cC1oYW5kb2ZmLXJlY2xhaW1cIn0sIGVycm9yOiBub3JtYWxpemVkRXJyb3J9XG4gICAgY29uc3QgZXJyb3JFdmVudHMgPSB0aGlzLmNvbmZpZ3VyYXRpb24uZ2V0RXJyb3JFdmVudHMoKVxuXG4gICAgdGhpcy5sb2dnZXIuZXJyb3IoKCkgPT4gW1wiRmFpbGVkIHRvIHJlY2xhaW0gZGlzY29ubmVjdGVkIHN0YXJ0dXAgaGFuZG9mZnM6XCIsIG5vcm1hbGl6ZWRFcnJvcl0pXG4gICAgZXJyb3JFdmVudHMuZW1pdChcImZyYW1ld29yay1lcnJvclwiLCBwYXlsb2FkKVxuICAgIGVycm9yRXZlbnRzLmVtaXQoXCJhbGwtZXJyb3JcIiwgey4uLnBheWxvYWQsIGVycm9yVHlwZTogXCJmcmFtZXdvcmstZXJyb3JcIn0pXG4gIH1cblxuICAvKipcbiAgICogUnVucyBoYW5kbGUgZW5xdWV1ZS5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBPcHRpb25zLlxuICAgKiBAcGFyYW0ge0pzb25Tb2NrZXR9IGFyZ3MuanNvblNvY2tldCAtIEpTT04gc29ja2V0LlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vdHlwZXMuanNcIikuQmFja2dyb3VuZEpvYkVucXVldWVNZXNzYWdlfSBhcmdzLm1lc3NhZ2UgLSBNZXNzYWdlLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyB3aGVuIGhhbmRsZWQuXG4gICAqL1xuICBhc3luYyBfaGFuZGxlRW5xdWV1ZSh7anNvblNvY2tldCwgbWVzc2FnZX0pIHtcbiAgICB0cnkge1xuICAgICAgY29uc3Qgam9iSWQgPSBhd2FpdCB0aGlzLnN0b3JlLmVucXVldWUoe1xuICAgICAgICBqb2JOYW1lOiBtZXNzYWdlLmpvYk5hbWUsXG4gICAgICAgIGFyZ3M6IG1lc3NhZ2UuYXJncyB8fCBbXSxcbiAgICAgICAgb3B0aW9uczogbWVzc2FnZS5vcHRpb25zIHx8IHt9XG4gICAgICB9KVxuXG4gICAgICBqc29uU29ja2V0LnNlbmQoe3R5cGU6IFwiZW5xdWV1ZWRcIiwgam9iSWR9KVxuICAgICAgdGhpcy5fbm90aWZ5RW5xdWV1ZWQoKVxuICAgICAgYXdhaXQgdGhpcy5fZHJhaW4oKVxuICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICB0aGlzLl9oYW5kbGVDbGllbnRNdXRhdGlvbkVycm9yKHtcbiAgICAgICAgY29udGV4dDoge2pvYk5hbWU6IG1lc3NhZ2Uuam9iTmFtZSwgc3RhZ2U6IFwiYmFja2dyb3VuZC1qb2ItZW5xdWV1ZVwifSxcbiAgICAgICAgZXJyb3IsXG4gICAgICAgIGZhbGxiYWNrTWVzc2FnZTogXCJGYWlsZWQgdG8gZW5xdWV1ZSBqb2JcIixcbiAgICAgICAganNvblNvY2tldCxcbiAgICAgICAgbG9nTWVzc2FnZTogXCJGYWlsZWQgdG8gZW5xdWV1ZSBiYWNrZ3JvdW5kIGpvYjpcIixcbiAgICAgICAgcmVzcG9uc2VUeXBlOiBcImVucXVldWUtZXJyb3JcIlxuICAgICAgfSlcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogSGFuZGxlcyBhIHN0YWJsZS1rZXkgcmVwbGFjZW1lbnQgcmVxdWVzdCBhbmQgcmUtYXJtcyBkaXNwYXRjaCBhZnRlcndhcmQuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gT3B0aW9ucy5cbiAgICogQHBhcmFtIHtKc29uU29ja2V0fSBhcmdzLmpzb25Tb2NrZXQgLSBKU09OIHNvY2tldC5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL3R5cGVzLmpzXCIpLkJhY2tncm91bmRKb2JSZXBsYWNlU2NoZWR1bGVkTWVzc2FnZX0gYXJncy5tZXNzYWdlIC0gTWVzc2FnZS5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgd2hlbiBoYW5kbGVkLlxuICAgKi9cbiAgYXN5bmMgX2hhbmRsZVJlcGxhY2VTY2hlZHVsZWQoe2pzb25Tb2NrZXQsIG1lc3NhZ2V9KSB7XG4gICAgdHJ5IHtcbiAgICAgIGNvbnN0IHJlc3VsdCA9IGF3YWl0IHRoaXMuc3RvcmUucmVwbGFjZVNjaGVkdWxlZCh7XG4gICAgICAgIHNjaGVkdWxlS2V5OiBtZXNzYWdlLnNjaGVkdWxlS2V5LFxuICAgICAgICBqb2JOYW1lOiBtZXNzYWdlLmpvYk5hbWUsXG4gICAgICAgIGFyZ3M6IG1lc3NhZ2UuYXJncyB8fCBbXSxcbiAgICAgICAgb3B0aW9uczogbWVzc2FnZS5vcHRpb25zIHx8IHt9XG4gICAgICB9KVxuXG4gICAgICB0aGlzLl9ub3RpZnlFbnF1ZXVlZCgpXG4gICAgICBhd2FpdCB0aGlzLl9kcmFpbigpXG4gICAgICBqc29uU29ja2V0LnNlbmQoe3R5cGU6IFwic2NoZWR1bGUtcmVwbGFjZWRcIiwgLi4ucmVzdWx0fSlcbiAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgdGhpcy5faGFuZGxlQ2xpZW50TXV0YXRpb25FcnJvcih7XG4gICAgICAgIGNvbnRleHQ6IHtqb2JOYW1lOiBtZXNzYWdlLmpvYk5hbWUsIHNjaGVkdWxlS2V5OiBtZXNzYWdlLnNjaGVkdWxlS2V5LCBzdGFnZTogXCJiYWNrZ3JvdW5kLWpvYi1yZXBsYWNlLXNjaGVkdWxlZFwifSxcbiAgICAgICAgZXJyb3IsXG4gICAgICAgIGZhbGxiYWNrTWVzc2FnZTogXCJGYWlsZWQgdG8gcmVwbGFjZSBzY2hlZHVsZWQgam9iXCIsXG4gICAgICAgIGpzb25Tb2NrZXQsXG4gICAgICAgIGxvZ01lc3NhZ2U6IFwiRmFpbGVkIHRvIHJlcGxhY2Ugc2NoZWR1bGVkIGJhY2tncm91bmQgam9iOlwiLFxuICAgICAgICByZXNwb25zZVR5cGU6IFwicmVwbGFjZS1zY2hlZHVsZWQtZXJyb3JcIlxuICAgICAgfSlcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogSGFuZGxlcyBhIHN0YWJsZS1rZXkgY2FuY2VsbGF0aW9uIHJlcXVlc3QgYW5kIHJlLWFybXMgZGlzcGF0Y2ggYWZ0ZXJ3YXJkLlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIE9wdGlvbnMuXG4gICAqIEBwYXJhbSB7SnNvblNvY2tldH0gYXJncy5qc29uU29ja2V0IC0gSlNPTiBzb2NrZXQuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi90eXBlcy5qc1wiKS5CYWNrZ3JvdW5kSm9iQ2FuY2VsU2NoZWR1bGVkTWVzc2FnZX0gYXJncy5tZXNzYWdlIC0gTWVzc2FnZS5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgd2hlbiBoYW5kbGVkLlxuICAgKi9cbiAgYXN5bmMgX2hhbmRsZUNhbmNlbFNjaGVkdWxlZCh7anNvblNvY2tldCwgbWVzc2FnZX0pIHtcbiAgICB0cnkge1xuICAgICAgY29uc3QgcmVzdWx0ID0gYXdhaXQgdGhpcy5zdG9yZS5jYW5jZWxTY2hlZHVsZWQobWVzc2FnZS5zY2hlZHVsZUtleSlcblxuICAgICAgdGhpcy5fbm90aWZ5RW5xdWV1ZWQoKVxuICAgICAgYXdhaXQgdGhpcy5fZHJhaW4oKVxuICAgICAganNvblNvY2tldC5zZW5kKHt0eXBlOiBcInNjaGVkdWxlLWNhbmNlbGxlZFwiLCAuLi5yZXN1bHR9KVxuICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICB0aGlzLl9oYW5kbGVDbGllbnRNdXRhdGlvbkVycm9yKHtcbiAgICAgICAgY29udGV4dDoge3NjaGVkdWxlS2V5OiBtZXNzYWdlLnNjaGVkdWxlS2V5LCBzdGFnZTogXCJiYWNrZ3JvdW5kLWpvYi1jYW5jZWwtc2NoZWR1bGVkXCJ9LFxuICAgICAgICBlcnJvcixcbiAgICAgICAgZmFsbGJhY2tNZXNzYWdlOiBcIkZhaWxlZCB0byBjYW5jZWwgc2NoZWR1bGVkIGpvYlwiLFxuICAgICAgICBqc29uU29ja2V0LFxuICAgICAgICBsb2dNZXNzYWdlOiBcIkZhaWxlZCB0byBjYW5jZWwgc2NoZWR1bGVkIGJhY2tncm91bmQgam9iOlwiLFxuICAgICAgICByZXNwb25zZVR5cGU6IFwiY2FuY2VsLXNjaGVkdWxlZC1lcnJvclwiXG4gICAgICB9KVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBSZXR1cm5zIHNhZmUgdmFsaWRhdGlvbiBmYWlsdXJlcyBhbmQgcmVwb3J0cyB1bmV4cGVjdGVkIGNsaWVudCBtdXRhdGlvbnMuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gT3B0aW9ucy5cbiAgICogQHBhcmFtIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59IGFyZ3MuY29udGV4dCAtIEZyYW1ld29yay1lcnJvciBjb250ZXh0LlxuICAgKiBAcGFyYW0ge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSBhcmdzLmVycm9yIC0gTXV0YXRpb24gZmFpbHVyZS5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGFyZ3MuZmFsbGJhY2tNZXNzYWdlIC0gQ2xpZW50LXNhZmUgZmFsbGJhY2sgbWVzc2FnZS5cbiAgICogQHBhcmFtIHtKc29uU29ja2V0fSBhcmdzLmpzb25Tb2NrZXQgLSBKU09OIHNvY2tldC5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGFyZ3MubG9nTWVzc2FnZSAtIEVycm9yIGxvZyBwcmVmaXguXG4gICAqIEBwYXJhbSB7XCJlbnF1ZXVlLWVycm9yXCIgfCBcInJlcGxhY2Utc2NoZWR1bGVkLWVycm9yXCIgfCBcImNhbmNlbC1zY2hlZHVsZWQtZXJyb3JcIn0gYXJncy5yZXNwb25zZVR5cGUgLSBSZXNwb25zZSB0eXBlLlxuICAgKiBAcmV0dXJucyB7dm9pZH1cbiAgICovXG4gIF9oYW5kbGVDbGllbnRNdXRhdGlvbkVycm9yKHtjb250ZXh0LCBlcnJvciwgZmFsbGJhY2tNZXNzYWdlLCBqc29uU29ja2V0LCBsb2dNZXNzYWdlLCByZXNwb25zZVR5cGV9KSB7XG4gICAgaWYgKGVycm9yIGluc3RhbmNlb2YgVmVsb2Npb3VzRXJyb3IgJiYgZXJyb3Iuc2FmZVRvRXhwb3NlKSB7XG4gICAgICBqc29uU29ja2V0LnNlbmQoe3R5cGU6IHJlc3BvbnNlVHlwZSwgZXJyb3I6IGVycm9yLm1lc3NhZ2V9KVxuICAgICAgcmV0dXJuXG4gICAgfVxuXG4gICAgY29uc3Qgbm9ybWFsaXplZEVycm9yID0gZXJyb3IgaW5zdGFuY2VvZiBFcnJvciA/IGVycm9yIDogbmV3IEVycm9yKFN0cmluZyhlcnJvcikpXG4gICAgY29uc3QgcGF5bG9hZCA9IHtjb250ZXh0LCBlcnJvcjogbm9ybWFsaXplZEVycm9yfVxuICAgIGNvbnN0IGVycm9yRXZlbnRzID0gdGhpcy5jb25maWd1cmF0aW9uLmdldEVycm9yRXZlbnRzKClcblxuICAgIHRoaXMubG9nZ2VyLmVycm9yKCgpID0+IFtsb2dNZXNzYWdlLCBub3JtYWxpemVkRXJyb3JdKVxuICAgIGVycm9yRXZlbnRzLmVtaXQoXCJmcmFtZXdvcmstZXJyb3JcIiwgcGF5bG9hZClcbiAgICBlcnJvckV2ZW50cy5lbWl0KFwiYWxsLWVycm9yXCIsIHsuLi5wYXlsb2FkLCBlcnJvclR5cGU6IFwiZnJhbWV3b3JrLWVycm9yXCJ9KVxuICAgIGpzb25Tb2NrZXQuc2VuZCh7dHlwZTogcmVzcG9uc2VUeXBlLCBlcnJvcjogZmFsbGJhY2tNZXNzYWdlfSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGhhbmRsZSBqb2IgY29tcGxldGUuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gT3B0aW9ucy5cbiAgICogQHBhcmFtIHtKc29uU29ja2V0fSBhcmdzLmpzb25Tb2NrZXQgLSBKU09OIHNvY2tldC5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL3R5cGVzLmpzXCIpLkJhY2tncm91bmRKb2JDb21wbGV0ZU1lc3NhZ2V9IGFyZ3MubWVzc2FnZSAtIE1lc3NhZ2UuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIHdoZW4gaGFuZGxlZC5cbiAgICovXG4gIGFzeW5jIF9oYW5kbGVKb2JDb21wbGV0ZSh7anNvblNvY2tldCwgbWVzc2FnZX0pIHtcbiAgICB0cnkge1xuICAgICAgY29uc3QgYWNjZXB0ZWQgPSBhd2FpdCB0aGlzLnN0b3JlLm1hcmtDb21wbGV0ZWQoe1xuICAgICAgICBqb2JJZDogbWVzc2FnZS5qb2JJZCxcbiAgICAgICAgaGFuZG9mZklkOiBtZXNzYWdlLmhhbmRvZmZJZCxcbiAgICAgICAgd29ya2VySWQ6IG1lc3NhZ2Uud29ya2VySWQsXG4gICAgICAgIGhhbmRlZE9mZkF0TXM6IG1lc3NhZ2UuaGFuZGVkT2ZmQXRNc1xuICAgICAgfSlcbiAgICAgIGlmIChhY2NlcHRlZCAmJiBtZXNzYWdlLmhhbmRvZmZJZCkge1xuICAgICAgICB0aGlzLl9mb3JnZXRIYW5kb2ZmKHtoYW5kb2ZmSWQ6IG1lc3NhZ2UuaGFuZG9mZklkLCBqb2JJZDogbWVzc2FnZS5qb2JJZH0pXG4gICAgICB9XG4gICAgICB0aGlzLm9uSm9iVXBkYXRlZD8uKHthY2NlcHRlZCwgam9iSWQ6IG1lc3NhZ2Uuam9iSWQsIHN0YXR1czogXCJjb21wbGV0ZWRcIn0pXG4gICAgICBqc29uU29ja2V0LnNlbmQoe3R5cGU6IFwiam9iLXVwZGF0ZWRcIiwgam9iSWQ6IG1lc3NhZ2Uuam9iSWR9KVxuICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICB0aGlzLl9yZXBvcnRKb2JVcGRhdGVGYWlsdXJlKHtlcnJvciwgam9iSWQ6IG1lc3NhZ2Uuam9iSWQsIHN0YWdlOiBcImJhY2tncm91bmQtam9iLWNvbXBsZXRlXCJ9KVxuICAgICAganNvblNvY2tldC5zZW5kKHt0eXBlOiBcImpvYi11cGRhdGUtZXJyb3JcIiwgam9iSWQ6IG1lc3NhZ2Uuam9iSWQsIGVycm9yOiBcIkZhaWxlZCB0byB1cGRhdGUgam9iXCJ9KVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBTdXJmYWNlcyBhbiB1bmV4cGVjdGVkIGR1cmFibGUgcmVwb3J0IGZhaWx1cmUgd2l0aG91dCBleHBvc2luZyBpdCB0byB0aGVcbiAgICogcmVwb3J0aW5nIHBlZXIuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gRmFpbHVyZSBjb250ZXh0LlxuICAgKiBAcGFyYW0ge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSBhcmdzLmVycm9yIC0gQWRhcHRlciBmYWlsdXJlLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gYXJncy5qb2JJZCAtIER1cmFibGUgam9iIGlkLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gYXJncy5zdGFnZSAtIE11dGF0aW9uIHN0YWdlLlxuICAgKi9cbiAgX3JlcG9ydEpvYlVwZGF0ZUZhaWx1cmUoe2Vycm9yLCBqb2JJZCwgc3RhZ2V9KSB7XG4gICAgY29uc3Qgbm9ybWFsaXplZEVycm9yID0gZXJyb3IgaW5zdGFuY2VvZiBFcnJvciA/IGVycm9yIDogbmV3IEVycm9yKFN0cmluZyhlcnJvcikpXG4gICAgY29uc3QgcGF5bG9hZCA9IHtjb250ZXh0OiB7Z2VuZXJhdGlvbklkOiB0aGlzLmdlbmVyYXRpb25JZCwgam9iSWQsIHN0YWdlfSwgZXJyb3I6IG5vcm1hbGl6ZWRFcnJvcn1cbiAgICBjb25zdCBlcnJvckV2ZW50cyA9IHRoaXMuY29uZmlndXJhdGlvbi5nZXRFcnJvckV2ZW50cygpXG5cbiAgICB0aGlzLmxvZ2dlci5lcnJvcigoKSA9PiBbXCJGYWlsZWQgdG8gdXBkYXRlIGJhY2tncm91bmQgam9iOlwiLCBub3JtYWxpemVkRXJyb3JdKVxuICAgIGVycm9yRXZlbnRzLmVtaXQoXCJmcmFtZXdvcmstZXJyb3JcIiwgcGF5bG9hZClcbiAgICBlcnJvckV2ZW50cy5lbWl0KFwiYWxsLWVycm9yXCIsIHsuLi5wYXlsb2FkLCBlcnJvclR5cGU6IFwiZnJhbWV3b3JrLWVycm9yXCJ9KVxuICB9XG5cbiAgLyoqXG4gICAqIFBlcnNpc3RzIGEgbm9ybWFsIGpvYiByZXNjaGVkdWxlIG91dGNvbWUgYW5kIHdha2VzIHNjaGVkdWxlZCBkaXNwYXRjaC5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBPcHRpb25zLlxuICAgKiBAcGFyYW0ge0pzb25Tb2NrZXR9IGFyZ3MuanNvblNvY2tldCAtIEpTT04gc29ja2V0LlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vdHlwZXMuanNcIikuQmFja2dyb3VuZEpvYlJlc2NoZWR1bGVNZXNzYWdlfSBhcmdzLm1lc3NhZ2UgLSBNZXNzYWdlLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyB3aGVuIGhhbmRsZWQuXG4gICAqL1xuICBhc3luYyBfaGFuZGxlSm9iUmVzY2hlZHVsZSh7anNvblNvY2tldCwgbWVzc2FnZX0pIHtcbiAgICB0cnkge1xuICAgICAgY29uc3QgYWNjZXB0ZWQgPSBhd2FpdCB0aGlzLnN0b3JlLm1hcmtSZXNjaGVkdWxlZCh7XG4gICAgICAgIGpvYklkOiBtZXNzYWdlLmpvYklkLFxuICAgICAgICBkZWxheU1zOiBtZXNzYWdlLmRlbGF5TXMsXG4gICAgICAgIGhhbmRvZmZJZDogbWVzc2FnZS5oYW5kb2ZmSWQsXG4gICAgICAgIHdvcmtlcklkOiBtZXNzYWdlLndvcmtlcklkLFxuICAgICAgICBoYW5kZWRPZmZBdE1zOiBtZXNzYWdlLmhhbmRlZE9mZkF0TXNcbiAgICAgIH0pXG4gICAgICBpZiAoYWNjZXB0ZWQgJiYgbWVzc2FnZS5oYW5kb2ZmSWQpIHtcbiAgICAgICAgdGhpcy5fZm9yZ2V0SGFuZG9mZih7aGFuZG9mZklkOiBtZXNzYWdlLmhhbmRvZmZJZCwgam9iSWQ6IG1lc3NhZ2Uuam9iSWR9KVxuICAgICAgfVxuICAgICAgdGhpcy5vbkpvYlVwZGF0ZWQ/Lih7YWNjZXB0ZWQsIGpvYklkOiBtZXNzYWdlLmpvYklkLCBzdGF0dXM6IFwicmVzY2hlZHVsZWRcIn0pXG4gICAgICBqc29uU29ja2V0LnNlbmQoe3R5cGU6IFwiam9iLXVwZGF0ZWRcIiwgam9iSWQ6IG1lc3NhZ2Uuam9iSWR9KVxuICAgICAgdGhpcy5fbm90aWZ5RW5xdWV1ZWQoKVxuICAgICAgYXdhaXQgdGhpcy5fZHJhaW4oKVxuICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICBjb25zdCBub3JtYWxpemVkRXJyb3IgPSBlcnJvciBpbnN0YW5jZW9mIEVycm9yID8gZXJyb3IgOiBuZXcgRXJyb3IoU3RyaW5nKGVycm9yKSlcbiAgICAgIGNvbnN0IHBheWxvYWQgPSB7Y29udGV4dDoge2pvYklkOiBtZXNzYWdlLmpvYklkLCBzdGFnZTogXCJiYWNrZ3JvdW5kLWpvYi1yZXNjaGVkdWxlXCJ9LCBlcnJvcjogbm9ybWFsaXplZEVycm9yfVxuICAgICAgY29uc3QgZXJyb3JFdmVudHMgPSB0aGlzLmNvbmZpZ3VyYXRpb24uZ2V0RXJyb3JFdmVudHMoKVxuXG4gICAgICB0aGlzLmxvZ2dlci5lcnJvcigoKSA9PiBbXCJGYWlsZWQgdG8gdXBkYXRlIGpvYiByZXNjaGVkdWxlOlwiLCBub3JtYWxpemVkRXJyb3JdKVxuICAgICAgZXJyb3JFdmVudHMuZW1pdChcImZyYW1ld29yay1lcnJvclwiLCBwYXlsb2FkKVxuICAgICAgZXJyb3JFdmVudHMuZW1pdChcImFsbC1lcnJvclwiLCB7Li4ucGF5bG9hZCwgZXJyb3JUeXBlOiBcImZyYW1ld29yay1lcnJvclwifSlcbiAgICAgIGpzb25Tb2NrZXQuc2VuZCh7dHlwZTogXCJqb2ItdXBkYXRlLWVycm9yXCIsIGpvYklkOiBtZXNzYWdlLmpvYklkLCBlcnJvcjogXCJGYWlsZWQgdG8gdXBkYXRlIGpvYlwifSlcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogUnVucyBoYW5kbGUgam9iIGZhaWxlZC5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBPcHRpb25zLlxuICAgKiBAcGFyYW0ge0pzb25Tb2NrZXR9IGFyZ3MuanNvblNvY2tldCAtIEpTT04gc29ja2V0LlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vdHlwZXMuanNcIikuQmFja2dyb3VuZEpvYkZhaWxlZE1lc3NhZ2V9IGFyZ3MubWVzc2FnZSAtIE1lc3NhZ2UuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIHdoZW4gaGFuZGxlZC5cbiAgICovXG4gIGFzeW5jIF9oYW5kbGVKb2JGYWlsZWQoe2pzb25Tb2NrZXQsIG1lc3NhZ2V9KSB7XG4gICAgdHJ5IHtcbiAgICAgIGNvbnN0IGZhaWxlZEpvYiA9IGF3YWl0IHRoaXMuc3RvcmUubWFya0ZhaWxlZCh7XG4gICAgICAgIGpvYklkOiBtZXNzYWdlLmpvYklkLFxuICAgICAgICBlcnJvcjogbWVzc2FnZS5lcnJvcixcbiAgICAgICAgaGFuZG9mZklkOiBtZXNzYWdlLmhhbmRvZmZJZCxcbiAgICAgICAgd29ya2VySWQ6IG1lc3NhZ2Uud29ya2VySWQsXG4gICAgICAgIGhhbmRlZE9mZkF0TXM6IG1lc3NhZ2UuaGFuZGVkT2ZmQXRNc1xuICAgICAgfSlcblxuICAgICAgaWYgKGZhaWxlZEpvYikge1xuICAgICAgICBpZiAobWVzc2FnZS5oYW5kb2ZmSWQpIHtcbiAgICAgICAgICB0aGlzLl9mb3JnZXRIYW5kb2ZmKHtoYW5kb2ZmSWQ6IG1lc3NhZ2UuaGFuZG9mZklkLCBqb2JJZDogbWVzc2FnZS5qb2JJZH0pXG4gICAgICAgIH1cbiAgICAgICAgdGhpcy5fZW1pdEJhY2tncm91bmRKb2JGYWlsZWQoe1xuICAgICAgICAgIGVycm9yOiBtZXNzYWdlLmVycm9yLFxuICAgICAgICAgIGhhbmRvZmZJZDogbWVzc2FnZS5oYW5kb2ZmSWQsXG4gICAgICAgICAgaGFuZGVkT2ZmQXRNczogbWVzc2FnZS5oYW5kZWRPZmZBdE1zLFxuICAgICAgICAgIGpvYjogZmFpbGVkSm9iLFxuICAgICAgICAgIHdvcmtlcklkOiBtZXNzYWdlLndvcmtlcklkXG4gICAgICAgIH0pXG4gICAgICB9XG5cbiAgICAgIHRoaXMub25Kb2JVcGRhdGVkPy4oe2FjY2VwdGVkOiBCb29sZWFuKGZhaWxlZEpvYiksIGpvYklkOiBtZXNzYWdlLmpvYklkLCBzdGF0dXM6IFwiZmFpbGVkXCJ9KVxuICAgICAganNvblNvY2tldC5zZW5kKHt0eXBlOiBcImpvYi11cGRhdGVkXCIsIGpvYklkOiBtZXNzYWdlLmpvYklkfSlcbiAgICAgIC8vIEEgZmFpbGVkIGpvYiBtYXkgaGF2ZSBiZWVuIHJlLXF1ZXVlZCAod2l0aCBiYWNrb2ZmKSBmb3IgcmV0cnkg4oCUXG4gICAgICAvLyBwb2tlIHRoZSBkaXNwYXRjaGVyIHNvIHRoZSByZXRyeSB0aW1lciBpcyBhcm1lZC5cbiAgICAgIHRoaXMuX25vdGlmeUVucXVldWVkKClcbiAgICAgIGF3YWl0IHRoaXMuX2RyYWluKClcbiAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgdGhpcy5sb2dnZXIuZXJyb3IoKCkgPT4gW1wiRmFpbGVkIHRvIHVwZGF0ZSBqb2IgZmFpbHVyZTpcIiwgZXJyb3JdKVxuICAgICAganNvblNvY2tldC5zZW5kKHt0eXBlOiBcImpvYi11cGRhdGUtZXJyb3JcIiwgam9iSWQ6IG1lc3NhZ2Uuam9iSWQsIGVycm9yOiBcIkZhaWxlZCB0byB1cGRhdGUgam9iXCJ9KVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGVtaXQgYmFja2dyb3VuZCBqb2IgZmFpbGVkLlxuICAgKiBAcGFyYW0ge3tlcnJvcjogUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4sIGhhbmRvZmZJZD86IHN0cmluZywgaGFuZGVkT2ZmQXRNcz86IG51bWJlciwgam9iOiBpbXBvcnQoXCIuL3R5cGVzLmpzXCIpLkJhY2tncm91bmRKb2JSb3csIHdvcmtlcklkPzogc3RyaW5nfX0gYXJncyAtIEZhaWx1cmUgZXZlbnQgZGF0YS5cbiAgICogQHJldHVybnMge3ZvaWR9XG4gICAqL1xuICBfZW1pdEJhY2tncm91bmRKb2JGYWlsZWQoe2Vycm9yLCBoYW5kb2ZmSWQsIGhhbmRlZE9mZkF0TXMsIGpvYiwgd29ya2VySWR9KSB7XG4gICAgY29uc3Qgbm9ybWFsaXplZEVycm9yID0gdGhpcy5fbm9ybWFsaXplRmFpbHVyZUVycm9yKGVycm9yKVxuICAgIGNvbnN0IHBheWxvYWQgPSB7XG4gICAgICBjb250ZXh0OiB7XG4gICAgICAgIGF0dGVtcHRzOiBqb2IuYXR0ZW1wdHMsXG4gICAgICAgIGhhbmRvZmZJZCxcbiAgICAgICAgaGFuZGVkT2ZmQXRNcyxcbiAgICAgICAgam9iQXJnczogam9iLmFyZ3MsXG4gICAgICAgIGpvYklkOiBqb2IuaWQsXG4gICAgICAgIGpvYk5hbWU6IGpvYi5qb2JOYW1lLFxuICAgICAgICBtYXhSZXRyaWVzOiBqb2IubWF4UmV0cmllcyxcbiAgICAgICAgc3RhZ2U6IFwiYmFja2dyb3VuZC1qb2ItZmFpbGVkXCIsXG4gICAgICAgIHN0YXR1czogam9iLnN0YXR1cyxcbiAgICAgICAgdGVybWluYWw6IGpvYi5zdGF0dXMgPT09IFwiZmFpbGVkXCIgfHwgam9iLnN0YXR1cyA9PT0gXCJvcnBoYW5lZFwiLFxuICAgICAgICB3aWxsUmV0cnk6IGpvYi5zdGF0dXMgPT09IFwicXVldWVkXCIsXG4gICAgICAgIHdvcmtlcklkXG4gICAgICB9LFxuICAgICAgZXJyb3I6IG5vcm1hbGl6ZWRFcnJvclxuICAgIH1cbiAgICBjb25zdCBlcnJvckV2ZW50cyA9IHRoaXMuY29uZmlndXJhdGlvbi5nZXRFcnJvckV2ZW50cygpXG5cbiAgICBlcnJvckV2ZW50cy5lbWl0KFwiYmFja2dyb3VuZC1qb2ItZmFpbGVkXCIsIHBheWxvYWQpXG4gICAgZXJyb3JFdmVudHMuZW1pdChcImFsbC1lcnJvclwiLCB7Li4ucGF5bG9hZCwgZXJyb3JUeXBlOiBcImJhY2tncm91bmQtam9iLWZhaWxlZFwifSlcbiAgfVxuXG4gIC8qKlxuICAgKiBFbWl0cyBgYmFja2dyb3VuZC1qb2Itb3JwaGFuZWRgIChtaXJyb3JlZCB0byBgYWxsLWVycm9yYCkgZm9yIGEgam9iIHRoZSB0aW1lLWJhc2VkIG9ycGhhbiBzd2VlcFxuICAgKiByZWNsYWltZWQgYWZ0ZXIgaXRzIHdvcmtlciBkaWVkIG1pZC1ydW4uIFVubGlrZSBgYmFja2dyb3VuZC1qb2ItZmFpbGVkYCwgd2hpY2ggZmlyZXMgb24gYVxuICAgKiB3b3JrZXIncyBmYWlsdXJlIHJlcG9ydCwgdGhpcyBmaXJlcyBmcm9tIHRoZSBtYWluIHByb2Nlc3MncyBzd2VlcCwgc28gYXBwbGljYXRpb25zIGNhbiByZWFjdCB0b1xuICAgKiBhIGRlYWQgd29ya2VyJ3Mgc3BlY2lmaWMgam9iIOKAlCByZWNvdmVyIHRoZSB3b3JrIGl0IGxlZnQgYmVoaW5kIOKAlCB3aXRob3V0IHBvbGxpbmcuIGB3aWxsUmV0cnlgXG4gICAqIHJlZmxlY3RzIHdoZXRoZXIgdGhlIHJlY2xhaW0gcmV0dXJuZWQgdGhlIGpvYiB0byB0aGUgcXVldWUgZm9yIGFub3RoZXIgYXR0ZW1wdC5cbiAgICogQHBhcmFtIHt7am9iOiBpbXBvcnQoXCIuL3R5cGVzLmpzXCIpLkJhY2tncm91bmRKb2JSb3d9fSBhcmdzIC0gVGhlIG9ycGhhbmVkIGpvYi5cbiAgICogQHJldHVybnMge3ZvaWR9XG4gICAqL1xuICBfZW1pdEJhY2tncm91bmRKb2JPcnBoYW5lZCh7am9ifSkge1xuICAgIGNvbnN0IG5vcm1hbGl6ZWRFcnJvciA9IHRoaXMuX25vcm1hbGl6ZUZhaWx1cmVFcnJvcihqb2IubGFzdEVycm9yID8/IFwiSm9iIG9ycGhhbmVkIGFmdGVyIHRpbWVvdXRcIilcbiAgICBjb25zdCBwYXlsb2FkID0ge1xuICAgICAgY29udGV4dDoge1xuICAgICAgICBhdHRlbXB0czogam9iLmF0dGVtcHRzLFxuICAgICAgICBqb2JBcmdzOiBqb2IuYXJncyxcbiAgICAgICAgam9iSWQ6IGpvYi5pZCxcbiAgICAgICAgam9iTmFtZTogam9iLmpvYk5hbWUsXG4gICAgICAgIG1heFJldHJpZXM6IGpvYi5tYXhSZXRyaWVzLFxuICAgICAgICBzdGFnZTogXCJiYWNrZ3JvdW5kLWpvYi1vcnBoYW5lZFwiLFxuICAgICAgICBzdGF0dXM6IGpvYi5zdGF0dXMsXG4gICAgICAgIHRlcm1pbmFsOiBqb2Iuc3RhdHVzID09PSBcImZhaWxlZFwiIHx8IGpvYi5zdGF0dXMgPT09IFwib3JwaGFuZWRcIixcbiAgICAgICAgd2lsbFJldHJ5OiBqb2Iuc3RhdHVzID09PSBcInF1ZXVlZFwiXG4gICAgICB9LFxuICAgICAgZXJyb3I6IG5vcm1hbGl6ZWRFcnJvclxuICAgIH1cbiAgICBjb25zdCBlcnJvckV2ZW50cyA9IHRoaXMuY29uZmlndXJhdGlvbi5nZXRFcnJvckV2ZW50cygpXG5cbiAgICBlcnJvckV2ZW50cy5lbWl0KFwiYmFja2dyb3VuZC1qb2Itb3JwaGFuZWRcIiwgcGF5bG9hZClcbiAgICBlcnJvckV2ZW50cy5lbWl0KFwiYWxsLWVycm9yXCIsIHsuLi5wYXlsb2FkLCBlcnJvclR5cGU6IFwiYmFja2dyb3VuZC1qb2Itb3JwaGFuZWRcIn0pXG4gIH1cblxuICAvKipcbiAgICogUnVucyBub3JtYWxpemUgZmFpbHVyZSBlcnJvci5cbiAgICogQHBhcmFtIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gZXJyb3IgLSBSZXBvcnRlZCBmYWlsdXJlIHZhbHVlLlxuICAgKiBAcmV0dXJucyB7RXJyb3J9IE5vcm1hbGl6ZWQgZXJyb3IuXG4gICAqL1xuICBfbm9ybWFsaXplRmFpbHVyZUVycm9yKGVycm9yKSB7XG4gICAgaWYgKGVycm9yIGluc3RhbmNlb2YgRXJyb3IpIHJldHVybiBlcnJvclxuXG4gICAgcmV0dXJuIHRoaXMuX2Vycm9yRnJvbVVua25vd25GYWlsdXJlKGVycm9yKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZXJyb3IgZnJvbSB1bmtub3duIGZhaWx1cmUuXG4gICAqIEBwYXJhbSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59IGVycm9yIC0gUmVwb3J0ZWQgZmFpbHVyZSB2YWx1ZS5cbiAgICogQHJldHVybnMge0Vycm9yfSBOb3JtYWxpemVkIGVycm9yLlxuICAgKi9cbiAgX2Vycm9yRnJvbVVua25vd25GYWlsdXJlKGVycm9yKSB7XG4gICAgY29uc3QgbWVzc2FnZSA9IHRoaXMuX21lc3NhZ2VGcm9tVW5rbm93bkZhaWx1cmUoZXJyb3IpXG4gICAgY29uc3Qgbm9ybWFsaXplZEVycm9yID0gbmV3IEVycm9yKG1lc3NhZ2UpXG5cbiAgICB0aGlzLl9jb3B5U3RyaW5nRmFpbHVyZVN0YWNrKHtlcnJvciwgbm9ybWFsaXplZEVycm9yfSlcblxuICAgIHJldHVybiBub3JtYWxpemVkRXJyb3JcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIG1lc3NhZ2UgZnJvbSB1bmtub3duIGZhaWx1cmUuXG4gICAqIEBwYXJhbSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59IGVycm9yIC0gUmVwb3J0ZWQgZmFpbHVyZSB2YWx1ZS5cbiAgICogQHJldHVybnMge3N0cmluZ30gRXJyb3IgbWVzc2FnZS5cbiAgICovXG4gIF9tZXNzYWdlRnJvbVVua25vd25GYWlsdXJlKGVycm9yKSB7XG4gICAgaWYgKHRoaXMuX2hhc1N0cmluZ0ZhaWx1cmUoZXJyb3IpKSByZXR1cm4gZXJyb3IudHJpbSgpLnNwbGl0KFwiXFxuXCIpWzBdXG5cbiAgICByZXR1cm4gU3RyaW5nKGVycm9yIHx8IFwiQmFja2dyb3VuZCBqb2IgZmFpbGVkXCIpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBoYXMgc3RyaW5nIGZhaWx1cmUuXG4gICAqIEBwYXJhbSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59IGVycm9yIC0gUmVwb3J0ZWQgZmFpbHVyZSB2YWx1ZS5cbiAgICogQHJldHVybnMge2Vycm9yIGlzIHN0cmluZ30gV2hldGhlciB0aGUgdmFsdWUgaXMgYSBub24tZW1wdHkgc3RyaW5nLlxuICAgKi9cbiAgX2hhc1N0cmluZ0ZhaWx1cmUoZXJyb3IpIHtcbiAgICByZXR1cm4gdHlwZW9mIGVycm9yID09PSBcInN0cmluZ1wiICYmIGVycm9yLnRyaW0oKS5sZW5ndGggPiAwXG4gIH1cblxuICAvKipcbiAgICogUnVucyBjb3B5IHN0cmluZyBmYWlsdXJlIHN0YWNrLlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIE9wdGlvbnMuXG4gICAqIEBwYXJhbSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59IGFyZ3MuZXJyb3IgLSBSZXBvcnRlZCBmYWlsdXJlIHZhbHVlLlxuICAgKiBAcGFyYW0ge0Vycm9yfSBhcmdzLm5vcm1hbGl6ZWRFcnJvciAtIE5vcm1hbGl6ZWQgZXJyb3IuXG4gICAqIEByZXR1cm5zIHt2b2lkfVxuICAgKi9cbiAgX2NvcHlTdHJpbmdGYWlsdXJlU3RhY2soe2Vycm9yLCBub3JtYWxpemVkRXJyb3J9KSB7XG4gICAgaWYgKHRoaXMuX2hhc1N0cmluZ0ZhaWx1cmUoZXJyb3IpKSBub3JtYWxpemVkRXJyb3Iuc3RhY2sgPSBlcnJvclxuICB9XG5cbiAgLyoqXG4gICAqIERyYWlucyBhbGwgZGlzcGF0Y2hhYmxlIGpvYnMgdG8gcmVhZHkgd29ya2VycywgdGhlbiBhcm1zIHRoZVxuICAgKiBzY2hlZHVsZWQtam9iIHRpbWVyIGZvciB0aGUgbmV4dCBmdXR1cmUgYHNjaGVkdWxlZF9hdF9tc2AuIENvYWxlc2Nlc1xuICAgKiBjb25jdXJyZW50IHRyaWdnZXJzOiBhIHdha2UtdXAgdGhhdCBsYW5kcyB3aGlsZSBhIGRyYWluIGlzIGluXG4gICAqIGZsaWdodCBqdXN0IHNldHMgYSByZS1kcmFpbiBmbGFnIGFuZCBsZXRzIHRoZSBpbi1mbGlnaHQgZHJhaW5cbiAgICogcmUtbG9vcCBhZnRlciBpdCBmaW5pc2hlcywgc28gbm8gc2lnbmFsIGlzIGRyb3BwZWQgYnV0IG5vIHR3b1xuICAgKiBkcmFpbnMgcnVuIGluIHBhcmFsbGVsLlxuICAgKlxuICAgKiBSZXNpbGllbmNlOiBpbiBiZWFjb24gbW9kZSB0aGlzIGlzIHRoZSBzb2xlIHdha2UtdXAgcGF0aCBmb3JcbiAgICogYWxyZWFkeS1xdWV1ZWQgd29yaywgc28gYSB0cmFuc2llbnQgREIgZXJyb3IgZHVyaW5nIHRoZSBkcmFpbiAoZS5nLlxuICAgKiBgbmV4dEF2YWlsYWJsZUpvYigpYCByZWplY3RpbmcpIG11c3Qgbm90IHN0cmFuZCB0aGUgcXVldWUgdW50aWwgdGhlXG4gICAqIG5leHQgZXh0ZXJuYWwgc2lnbmFsLiBPbiBhbnkgZXJyb3Igd2UgbG9nIGl0IGFuZCBhcm0gYSBvbmUtc2hvdFxuICAgKiByZXRyeSB2aWEgYF9zY2hlZHVsZUVycm9yUmV0cnlgIHVzaW5nIGBwb2xsSW50ZXJ2YWxNc2AgYXMgdGhlXG4gICAqIGNhZGVuY2U7IG9uIHN1Y2Nlc3MgdGhlIHJldHJ5IHRpbWVyIGlzIGNsZWFyZWQuIFBvbGxpbmctbW9kZSBydW5zXG4gICAqIGBfZHJhaW5gIGZyb20gaXRzIG93biBpbnRlcnZhbCwgc28gdGhlIHJldHJ5IHRpbWVyIGlzIGEgbm8tb3AgdGhlcmUuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fVxuICAgKi9cbiAgYXN5bmMgX2RyYWluKCkge1xuICAgIGlmICh0aGlzLl9zdG9wcGVkIHx8IHRoaXMubGlmZWN5Y2xlU3RhdGUgIT09IFwiYWN0aXZlXCIgfHwgIXRoaXMuX2FjdGl2ZU93bmVyc2hpcFJlYWR5KSByZXR1cm5cblxuICAgIGlmICh0aGlzLl9kcmFpblByb21pc2UpIHtcbiAgICAgIHRoaXMuX3JlZHJhaW5RdWV1ZWQgPSB0cnVlXG4gICAgICBhd2FpdCB0aGlzLl9kcmFpblByb21pc2VcbiAgICAgIHJldHVyblxuICAgIH1cblxuICAgIGNvbnN0IGRyYWluUHJvbWlzZSA9IHRoaXMuX2RyYWluVG9Db21wbGV0aW9uKClcblxuICAgIHRoaXMuX2RyYWluUHJvbWlzZSA9IGRyYWluUHJvbWlzZVxuICAgIGF3YWl0IGRyYWluUHJvbWlzZVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgb25lIHNlcmlhbGl6ZWQgZHJhaW4gbGlmZWN5Y2xlLCBpbmNsdWRpbmcgdGltZXIgcmUtYXJtaW5nLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyBhZnRlciBldmVyeSBjb2FsZXNjZWQgcmVxdWVzdCBpcyBoYW5kbGVkLlxuICAgKi9cbiAgYXN5bmMgX2RyYWluVG9Db21wbGV0aW9uKCkge1xuICAgIHRoaXMuX2RyYWluaW5nID0gdHJ1ZVxuXG4gICAgdHJ5IHtcbiAgICAgIGxldCBlcnJvcmVkXG5cbiAgICAgIGRvIHtcbiAgICAgICAgZXJyb3JlZCA9IGF3YWl0IHRoaXMuX2RyYWluVW50aWxJZGxlKClcbiAgICAgICAgYXdhaXQgdGhpcy5fZmluaXNoRHJhaW4oe2Vycm9yZWR9KVxuICAgICAgfSB3aGlsZSAoIWVycm9yZWQgJiYgdGhpcy5fcmVkcmFpblF1ZXVlZCAmJiAhdGhpcy5fc3RvcHBlZCAmJiB0aGlzLmxpZmVjeWNsZVN0YXRlID09PSBcImFjdGl2ZVwiKVxuICAgIH0gZmluYWxseSB7XG4gICAgICB0aGlzLl9kcmFpbmluZyA9IGZhbHNlXG4gICAgICB0aGlzLl9kcmFpblByb21pc2UgPSB1bmRlZmluZWRcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogUnVucyBmaW5pc2ggZHJhaW4uXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gT3B0aW9ucy5cbiAgICogQHBhcmFtIHtib29sZWFufSBhcmdzLmVycm9yZWQgLSBXaGV0aGVyIHRoZSBkcmFpbiBoaXQgYW4gZXJyb3IuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIGFmdGVyIGZvbGxvdy11cCB0aW1lcnMgYXJlIGhhbmRsZWQuXG4gICAqL1xuICBhc3luYyBfZmluaXNoRHJhaW4oe2Vycm9yZWR9KSB7XG4gICAgaWYgKHRoaXMuX3N0b3BwZWQgfHwgdGhpcy5saWZlY3ljbGVTdGF0ZSAhPT0gXCJhY3RpdmVcIikgcmV0dXJuXG4gICAgaWYgKGVycm9yZWQpIHJldHVybiB0aGlzLl9zY2hlZHVsZUVycm9yUmV0cnkoKVxuXG4gICAgYXdhaXQgdGhpcy5fYXJtU2NoZWR1bGVkVGltZXJPclJldHJ5KClcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGFybSBzY2hlZHVsZWQgdGltZXIgb3IgcmV0cnkuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIGFmdGVyIHNjaGVkdWxlZCB0aW1lciBoYW5kbGluZy5cbiAgICovXG4gIGFzeW5jIF9hcm1TY2hlZHVsZWRUaW1lck9yUmV0cnkoKSB7XG4gICAgdHJ5IHtcbiAgICAgIGF3YWl0IHRoaXMuX2FybVNjaGVkdWxlZFRpbWVyKClcbiAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgdGhpcy5sb2dnZXIuZXJyb3IoKCkgPT4gW1wiQmFja2dyb3VuZCBqb2JzIHNjaGVkdWxlZC10aW1lciBhcm1pbmcgZmFpbGVkOlwiLCBlcnJvcl0pXG4gICAgICB0aGlzLl9zY2hlZHVsZUVycm9yUmV0cnkoKVxuICAgICAgcmV0dXJuXG4gICAgfVxuXG4gICAgdGhpcy5fY2xlYXJFcnJvclJldHJ5VGltZXIoKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgY2xlYXIgZXJyb3IgcmV0cnkgdGltZXIuXG4gICAqIEByZXR1cm5zIHt2b2lkfSAqL1xuICBfY2xlYXJFcnJvclJldHJ5VGltZXIoKSB7XG4gICAgaWYgKHRoaXMucGVuZGluZ0hhbmRvZmZSZWNvdmVyaWVzLnNpemUgPiAwKSByZXR1cm5cbiAgICBpZiAodGhpcy5fc3RhcnR1cEhhbmRvZmZHcmFjZUVsYXBzZWQgJiYgdGhpcy5zdGFydHVwSGFuZG9mZlNuYXBzaG90Lmxlbmd0aCA+IDApIHJldHVyblxuXG4gICAgZm9yIChjb25zdCB3b3JrZXIgb2YgdGhpcy53b3JrZXJIYW5kb2Zmcy5rZXlzKCkpIHtcbiAgICAgIGlmICghdGhpcy53b3JrZXJzLmhhcyh3b3JrZXIpKSByZXR1cm5cbiAgICB9XG5cbiAgICBpZiAodGhpcy5fZXJyb3JSZXRyeVRpbWVyKSB7XG4gICAgICBjbGVhclRpbWVvdXQodGhpcy5fZXJyb3JSZXRyeVRpbWVyKVxuICAgICAgdGhpcy5fZXJyb3JSZXRyeVRpbWVyID0gdW5kZWZpbmVkXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZHJhaW4gdW50aWwgaWRsZS5cbiAgICogQHJldHVybnMge1Byb21pc2U8Ym9vbGVhbj59IC0gV2hldGhlciB0aGUgZHJhaW4gaGl0IGFuIGVycm9yLlxuICAgKi9cbiAgYXN5bmMgX2RyYWluVW50aWxJZGxlKCkge1xuICAgIHJldHVybiBhd2FpdCB0aGlzLl9ydW5EcmFpbkxvb3AoKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgcnVuIGRyYWluIGxvb3AuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPGJvb2xlYW4+fSAtIFdoZXRoZXIgdGhlIGRyYWluIGhpdCBhbiBlcnJvci5cbiAgICovXG4gIGFzeW5jIF9ydW5EcmFpbkxvb3AoKSB7XG4gICAgZG8ge1xuICAgICAgdGhpcy5fcmVkcmFpblF1ZXVlZCA9IGZhbHNlXG4gICAgICBjb25zdCBlcnJvcmVkID0gYXdhaXQgdGhpcy5fZHJhaW5PbmNlV2l0aEVycm9yUmVwb3J0KClcblxuICAgICAgaWYgKGVycm9yZWQpIHJldHVybiB0cnVlXG4gICAgfSB3aGlsZSAodGhpcy5fcmVkcmFpblF1ZXVlZCAmJiAhdGhpcy5fc3RvcHBlZClcblxuICAgIHJldHVybiBmYWxzZVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZHJhaW4gb25jZSB3aXRoIGVycm9yIHJlcG9ydC5cbiAgICogQHJldHVybnMge1Byb21pc2U8Ym9vbGVhbj59IC0gV2hldGhlciBvbmUgZHJhaW4gcGFzcyBmYWlsZWQuXG4gICAqL1xuICBhc3luYyBfZHJhaW5PbmNlV2l0aEVycm9yUmVwb3J0KCkge1xuICAgIHRyeSB7XG4gICAgICBhd2FpdCB0aGlzLl9kcmFpbk9uY2UoKVxuICAgICAgcmV0dXJuIGZhbHNlXG4gICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgIHRoaXMubG9nZ2VyLmVycm9yKCgpID0+IFtcIkJhY2tncm91bmQgam9icyBkcmFpbiBmYWlsZWQ6XCIsIGVycm9yXSlcbiAgICAgIHJldHVybiB0cnVlXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIEFybXMgYSBvbmUtc2hvdCBgc2V0VGltZW91dGAgdG8gcmV0cnkgYF9kcmFpbmAgYWZ0ZXIgYSB0cmFuc2llbnRcbiAgICogZmFpbHVyZS4gSWRlbXBvdGVudCDigJQgcmVwZWF0ZWQgY2FsbHMgd2hpbGUgYSByZXRyeSBpcyBhbHJlYWR5XG4gICAqIHBlbmRpbmcgYXJlIG5vLW9wcy4gUG9sbGluZyBtb2RlIGFscmVhZHkgcmV0cmllcyB2aWEgaXRzIG93blxuICAgKiBpbnRlcnZhbCwgc28gdGhpcyBpcyBhIG5vLW9wIGluIHRoYXQgbW9kZS5cbiAgICogQHJldHVybnMge3ZvaWR9XG4gICAqL1xuICBfc2NoZWR1bGVFcnJvclJldHJ5KCkge1xuICAgIGlmICh0aGlzLl9zdG9wcGVkKSByZXR1cm5cbiAgICBpZiAodGhpcy5fZXJyb3JSZXRyeVRpbWVyKSByZXR1cm5cbiAgICBpZiAodGhpcy5kaXNwYXRjaFN0cmF0ZWd5ID09PSBcInBvbGxpbmdcIiAmJiB0aGlzLmxpZmVjeWNsZVN0YXRlID09PSBcImFjdGl2ZVwiKSByZXR1cm5cblxuICAgIHRoaXMuX2Vycm9yUmV0cnlUaW1lciA9IHNldFRpbWVvdXQoKCkgPT4ge1xuICAgICAgdGhpcy5fZXJyb3JSZXRyeVRpbWVyID0gdW5kZWZpbmVkXG4gICAgICB2b2lkIHRoaXMuX3JldHJ5QWZ0ZXJFcnJvcigpXG4gICAgfSwgdGhpcy5wb2xsSW50ZXJ2YWxNcylcbiAgfVxuXG4gIC8qKlxuICAgKiBSZXRyaWVzIGZhaWxlZCBwcmUtZGlzcGF0Y2ggYW5kIGRpc2Nvbm5lY3RlZC1zb2NrZXQgcmVsZWFzZXMgYmVmb3JlXG4gICAqIGRyYWluaW5nIHF1ZXVlZCB3b3JrLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyBhZnRlciByZXRyeSB3b3JrLlxuICAgKi9cbiAgYXN5bmMgX3JldHJ5QWZ0ZXJFcnJvcigpIHtcbiAgICBpZiAodGhpcy5fc3RvcHBlZCkgcmV0dXJuXG5cbiAgICBpZiAodGhpcy5fc3RhcnR1cEhhbmRvZmZHcmFjZUVsYXBzZWQgJiYgdGhpcy5zdGFydHVwSGFuZG9mZlNuYXBzaG90Lmxlbmd0aCA+IDApIHtcbiAgICAgIGF3YWl0IHRoaXMuX3N0YXJ0U3RhcnR1cEhhbmRvZmZSZWNsYWltKClcbiAgICAgIGlmICh0aGlzLnN0YXJ0dXBIYW5kb2ZmU25hcHNob3QubGVuZ3RoID4gMCkgcmV0dXJuXG4gICAgfVxuXG4gICAgdHJ5IHtcbiAgICAgIGF3YWl0IHRoaXMuX3JldHJ5UGVuZGluZ0hhbmRvZmZSZWNvdmVyaWVzKClcbiAgICB9IGNhdGNoIHtcbiAgICAgIHRoaXMuX3NjaGVkdWxlRXJyb3JSZXRyeSgpXG4gICAgICByZXR1cm5cbiAgICB9XG5cbiAgICB0cnkge1xuICAgICAgZm9yIChjb25zdCB3b3JrZXIgb2YgdGhpcy53b3JrZXJIYW5kb2Zmcy5rZXlzKCkpIHtcbiAgICAgICAgaWYgKCF0aGlzLndvcmtlcnMuaGFzKHdvcmtlcikpIGF3YWl0IHRoaXMuX3JlbGVhc2VXb3JrZXJIYW5kb2Zmcyh3b3JrZXIpXG4gICAgICB9XG4gICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgIHRoaXMuX3JlcG9ydEhhbmRvZmZSZWxlYXNlRXJyb3IoZXJyb3IpXG4gICAgICB0aGlzLl9zY2hlZHVsZUVycm9yUmV0cnkoKVxuICAgICAgcmV0dXJuXG4gICAgfVxuXG4gICAgaWYgKHRoaXMubGlmZWN5Y2xlU3RhdGUgPT09IFwiYWN0aXZlXCIpIGF3YWl0IHRoaXMuX2RyYWluKClcbiAgICB0aGlzLl9tYXliZVN0b3BSZXRpcmVkKClcbiAgfVxuXG4gIC8qKlxuICAgKiBJbm5lciBkcmFpbiBsb29wOiBwdWxscyBlbGlnaWJsZSBxdWV1ZWQgam9icyBhbmQgaGFuZHMgdGhlbSBvZmYgdG9cbiAgICogcmVhZHkgd29ya2VycyB1bnRpbCBvbmUgb2YgdGhlbSBydW5zIG91dC5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59XG4gICAqL1xuICBhc3luYyBfZHJhaW5PbmNlKCkge1xuICAgIHdoaWxlICh0aGlzLnJlYWR5V29ya2Vycy5zaXplID4gMCAmJiAhdGhpcy5fc3RvcHBlZCAmJiB0aGlzLmxpZmVjeWNsZVN0YXRlID09PSBcImFjdGl2ZVwiICYmIHRoaXMuX2FjdGl2ZU93bmVyc2hpcFJlYWR5KSB7XG4gICAgICBjb25zdCBqb2IgPSBhd2FpdCB0aGlzLm5leHRBdmFpbGFibGVKb2JGb3JSZWFkeVdvcmtlcnMoKVxuICAgICAgaWYgKCFqb2IpIHJldHVyblxuXG4gICAgICBjb25zdCB3b3JrZXIgPSB0aGlzLnJlYWR5V29ya2VyRm9ySm9iKGpvYilcbiAgICAgIGlmICghd29ya2VyKSByZXR1cm5cblxuICAgICAgY29uc3QgYWRtaXNzaW9uID0gdGhpcy5fY29uc3VtZVdvcmtlckFkbWlzc2lvbih7am9iLCB3b3JrZXJ9KVxuICAgICAgY29uc3QgcmVxdWVzdGVkSGFuZG9mZklkID0gcmFuZG9tVVVJRCgpXG4gICAgICBsZXQgaGFuZG9mZlxuXG4gICAgICB0cnkge1xuICAgICAgICBoYW5kb2ZmID0gYXdhaXQgdGhpcy5zdG9yZS5tYXJrSGFuZGVkT2ZmKHtoYW5kb2ZmSWQ6IHJlcXVlc3RlZEhhbmRvZmZJZCwgam9iSWQ6IGpvYi5pZCwgd29ya2VySWQ6IHdvcmtlci53b3JrZXJJZH0pXG4gICAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgICB0aGlzLl9yZW1lbWJlckhhbmRvZmZSZWNvdmVyeSh7aGFuZG9mZklkOiByZXF1ZXN0ZWRIYW5kb2ZmSWQsIGpvYklkOiBqb2IuaWR9KVxuICAgICAgICB0aGlzLl9yZXN0b3JlV29ya2VyQWRtaXNzaW9uKHsuLi5hZG1pc3Npb24sIHdvcmtlcn0pXG5cbiAgICAgICAgdHJ5IHtcbiAgICAgICAgICBhd2FpdCB0aGlzLl9yZWNvdmVySGFuZG9mZih7aGFuZG9mZklkOiByZXF1ZXN0ZWRIYW5kb2ZmSWQsIGpvYklkOiBqb2IuaWR9KVxuICAgICAgICB9IGNhdGNoIChyZWNvdmVyeUVycm9yKSB7XG4gICAgICAgICAgdGhpcy5fcmVwb3J0SGFuZG9mZlJlY292ZXJ5RXJyb3Ioe2Vycm9yOiByZWNvdmVyeUVycm9yLCBoYW5kb2ZmSWQ6IHJlcXVlc3RlZEhhbmRvZmZJZCwgam9iSWQ6IGpvYi5pZH0pXG4gICAgICAgIH1cblxuICAgICAgICB0aHJvdyBlcnJvclxuICAgICAgfVxuXG4gICAgICBpZiAoIWhhbmRvZmYpIHtcbiAgICAgICAgdGhpcy5fcmVzdG9yZVdvcmtlckFkbWlzc2lvbih7Li4uYWRtaXNzaW9uLCB3b3JrZXJ9KVxuICAgICAgICBjb250aW51ZVxuICAgICAgfVxuXG4gICAgICBhd2FpdCB0aGlzLmFmdGVySGFuZG9mZkNsYWltPy4oe2hhbmRvZmYsIGpvYn0pXG5cbiAgICAgIGNvbnN0IGhhbmRvZmZzID0gdGhpcy53b3JrZXJIYW5kb2Zmcy5nZXQod29ya2VyKVxuXG4gICAgICBpZiAoIWhhbmRvZmZzIHx8ICF0aGlzLndvcmtlcnMuaGFzKHdvcmtlcikgfHwgd29ya2VyLmlzRHJhaW5pbmcgfHwgdGhpcy5saWZlY3ljbGVTdGF0ZSAhPT0gXCJhY3RpdmVcIiB8fCAhdGhpcy5fYWN0aXZlT3duZXJzaGlwUmVhZHkpIHtcbiAgICAgICAgdGhpcy5fcmVtZW1iZXJIYW5kb2ZmUmVjb3Zlcnkoe2hhbmRvZmZJZDogaGFuZG9mZi5oYW5kb2ZmSWQsIGpvYklkOiBqb2IuaWR9KVxuICAgICAgICB0cnkge1xuICAgICAgICAgIGF3YWl0IHRoaXMuX3JlY292ZXJIYW5kb2ZmKHtoYW5kb2ZmSWQ6IGhhbmRvZmYuaGFuZG9mZklkLCBqb2JJZDogam9iLmlkfSlcbiAgICAgICAgfSBjYXRjaCAocmVjb3ZlcnlFcnJvcikge1xuICAgICAgICAgIHRoaXMuX3JlcG9ydEhhbmRvZmZSZWNvdmVyeUVycm9yKHtlcnJvcjogcmVjb3ZlcnlFcnJvciwgaGFuZG9mZklkOiBoYW5kb2ZmLmhhbmRvZmZJZCwgam9iSWQ6IGpvYi5pZH0pXG4gICAgICAgICAgdGhyb3cgcmVjb3ZlcnlFcnJvclxuICAgICAgICB9XG4gICAgICAgIHRoaXMuX25vdGlmeUVucXVldWVkKClcbiAgICAgICAgdGhpcy5fcmVkcmFpblF1ZXVlZCA9IHRydWVcbiAgICAgICAgY29udGludWVcbiAgICAgIH1cblxuICAgICAgdGhpcy5fZmluYWxpemVXb3JrZXJBZG1pc3Npb24oey4uLmFkbWlzc2lvbiwgam9iLCB3b3JrZXJ9KVxuICAgICAgaGFuZG9mZnMuc2V0KGpvYi5pZCwgaGFuZG9mZi5oYW5kb2ZmSWQpXG5cbiAgICAgIHRyeSB7XG4gICAgICAgIHdvcmtlci5zZW5kKHtcbiAgICAgICAgICB0eXBlOiBcImpvYlwiLFxuICAgICAgICAgIHBheWxvYWQ6IHtcbiAgICAgICAgICAgIGlkOiBqb2IuaWQsXG4gICAgICAgICAgICBqb2JOYW1lOiBqb2Iuam9iTmFtZSxcbiAgICAgICAgICAgIGFyZ3M6IGpvYi5hcmdzLFxuICAgICAgICAgICAgaGFuZG9mZklkOiBoYW5kb2ZmLmhhbmRvZmZJZCxcbiAgICAgICAgICAgIHdvcmtlcklkOiB3b3JrZXIud29ya2VySWQsXG4gICAgICAgICAgICBoYW5kZWRPZmZBdE1zOiBoYW5kb2ZmLmhhbmRlZE9mZkF0TXMsXG4gICAgICAgICAgICBvcHRpb25zOiB7XG4gICAgICAgICAgICAgIGNvbmN1cnJlbmN5S2V5OiBqb2IuY29uY3VycmVuY3lLZXkgfHwgdW5kZWZpbmVkLFxuICAgICAgICAgICAgICBleGVjdXRpb25Nb2RlOiBqb2IuZXhlY3V0aW9uTW9kZSxcbiAgICAgICAgICAgICAgbWF4Q29uY3VycmVuY3k6IGpvYi5tYXhDb25jdXJyZW5jeSA/PyB1bmRlZmluZWQsXG4gICAgICAgICAgICAgIG1heFJldHJpZXM6IGpvYi5tYXhSZXRyaWVzID8/IHVuZGVmaW5lZCxcbiAgICAgICAgICAgICAgcXVldWU6IGpvYi5xdWV1ZSxcbiAgICAgICAgICAgICAgc2NoZWR1bGVkQXRNczogam9iLnNjaGVkdWxlZEF0TXMgPz8gdW5kZWZpbmVkLFxuICAgICAgICAgICAgICAuLi4oam9iLnRpbWVvdXRNcyA9PT0gbnVsbCA/IHt9IDoge3RpbWVvdXRNczogam9iLnRpbWVvdXRNc30pXG4gICAgICAgICAgICB9XG4gICAgICAgICAgfVxuICAgICAgICB9KVxuICAgICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgICAgdGhpcy5sb2dnZXIud2FybigoKSA9PiBbXCJGYWlsZWQgdG8gc2VuZCBqb2IgdG8gd29ya2VyLCByZS1xdWV1ZWluZzpcIiwgZXJyb3JdKVxuICAgICAgICB0cnkge1xuICAgICAgICAgIHdvcmtlci5jbG9zZSgpXG4gICAgICAgIH0gY2F0Y2ggKGNsb3NlRXJyb3IpIHtcbiAgICAgICAgICB0aGlzLmxvZ2dlci53YXJuKCgpID0+IFtcIkZhaWxlZCB0byBjbG9zZSB3b3JrZXIgYWZ0ZXIgam9iIHNlbmQgZmFpbHVyZTpcIiwgY2xvc2VFcnJvcl0pXG4gICAgICAgIH1cbiAgICAgICAgYXdhaXQgdGhpcy5faGFuZGxlV29ya2VyU29ja2V0Q2xvc2VkKHdvcmtlciwge3F1ZXVlUmVkcmFpbjogdHJ1ZX0pXG4gICAgICB9XG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIENvbnN1bWVzIG9uZSBhZHZlcnRpc2VkIHdvcmtlciBhZG1pc3Npb24gd2hpbGUgcGVyc2lzdGVuY2UgaXMgaW4gZmxpZ2h0LlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIEFkbWlzc2lvbiBkZXRhaWxzLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vdHlwZXMuanNcIikuQmFja2dyb3VuZEpvYlJvd30gYXJncy5qb2IgLSBTZWxlY3RlZCBqb2IuXG4gICAqIEBwYXJhbSB7SnNvblNvY2tldH0gYXJncy53b3JrZXIgLSBTZWxlY3RlZCB3b3JrZXIgc29ja2V0LlxuICAgKiBAcmV0dXJucyB7e3Bvb2xlZENyZWRpdENvbnN1bWVkOiBib29sZWFuLCByZWFkaW5lc3NWZXJzaW9uOiBudW1iZXJ9fSAtIFJldmVyc2libGUgYWRtaXNzaW9uIGRlYml0LlxuICAgKi9cbiAgX2NvbnN1bWVXb3JrZXJBZG1pc3Npb24oe2pvYiwgd29ya2VyfSkge1xuICAgIGxldCBwb29sZWRDcmVkaXRDb25zdW1lZCA9IGZhbHNlXG5cbiAgICB0aGlzLnJlYWR5V29ya2Vycy5kZWxldGUod29ya2VyKVxuXG4gICAgaWYgKGpvYi5leGVjdXRpb25Nb2RlID09PSBcInBvb2xlZFwiICYmIHdvcmtlci51c2VzUG9vbGVkQ2FwYWNpdHlDcmVkaXRzICYmIHdvcmtlci5hdmFpbGFibGVQb29sZWRTbG90cyA+IDApIHtcbiAgICAgIHBvb2xlZENyZWRpdENvbnN1bWVkID0gdHJ1ZVxuICAgICAgd29ya2VyLmF2YWlsYWJsZVBvb2xlZFNsb3RzIC09IDFcbiAgICAgIGlmICh3b3JrZXIuYXZhaWxhYmxlUG9vbGVkU2xvdHMgPiAwKSB0aGlzLnJlYWR5V29ya2Vycy5hZGQod29ya2VyKVxuICAgIH1cblxuICAgIHJldHVybiB7cG9vbGVkQ3JlZGl0Q29uc3VtZWQsIHJlYWRpbmVzc1ZlcnNpb246IHdvcmtlci5yZWFkaW5lc3NWZXJzaW9ufVxuICB9XG5cbiAgLyoqXG4gICAqIFJlc3RvcmVzIGFuIGFkbWlzc2lvbiB0aGF0IG5ldmVyIHJlYWNoZWQgYSB3b3JrZXIuIEEgbmV3ZXIgcmVhZGluZXNzXG4gICAqIGFkdmVydGlzZW1lbnQgaXMgYWxyZWFkeSBhdXRob3JpdGF0aXZlLCBzbyBpdHMgcG9vbGVkIGNvdW50IGlzIG5vdCBjaGFuZ2VkLlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIEFkbWlzc2lvbiBkZXRhaWxzLlxuICAgKiBAcGFyYW0ge2Jvb2xlYW59IGFyZ3MucG9vbGVkQ3JlZGl0Q29uc3VtZWQgLSBXaGV0aGVyIGEgcG9vbGVkIGNyZWRpdCB3YXMgZGViaXRlZC5cbiAgICogQHBhcmFtIHtudW1iZXJ9IGFyZ3MucmVhZGluZXNzVmVyc2lvbiAtIFJlYWRpbmVzcyBnZW5lcmF0aW9uIGF0IGRlYml0IHRpbWUuXG4gICAqIEBwYXJhbSB7SnNvblNvY2tldH0gYXJncy53b3JrZXIgLSBTZWxlY3RlZCB3b3JrZXIgc29ja2V0LlxuICAgKiBAcmV0dXJucyB7dm9pZH1cbiAgICovXG4gIF9yZXN0b3JlV29ya2VyQWRtaXNzaW9uKHtwb29sZWRDcmVkaXRDb25zdW1lZCwgcmVhZGluZXNzVmVyc2lvbiwgd29ya2VyfSkge1xuICAgIGlmICh0aGlzLl9zdG9wcGVkIHx8IHRoaXMubGlmZWN5Y2xlU3RhdGUgIT09IFwiYWN0aXZlXCIgfHwgIXRoaXMuX2FjdGl2ZU93bmVyc2hpcFJlYWR5IHx8ICF0aGlzLndvcmtlcnMuaGFzKHdvcmtlcikgfHwgd29ya2VyLmlzRHJhaW5pbmcpIHJldHVyblxuXG4gICAgaWYgKHBvb2xlZENyZWRpdENvbnN1bWVkICYmIHdvcmtlci5yZWFkaW5lc3NWZXJzaW9uID09PSByZWFkaW5lc3NWZXJzaW9uKSB7XG4gICAgICB3b3JrZXIuYXZhaWxhYmxlUG9vbGVkU2xvdHMgKz0gMVxuICAgIH1cblxuICAgIGlmICh3b3JrZXIuc3VwcG9ydHNIYW5kb2ZmSWRSZXBvcnRpbmcpIHRoaXMucmVhZHlXb3JrZXJzLmFkZCh3b3JrZXIpXG4gIH1cblxuICAvKipcbiAgICogQXBwbGllcyBhIHN1Y2Nlc3NmdWwgcG9vbGVkIGFkbWlzc2lvbiB0byBhIHJlYWRpbmVzcyBhZHZlcnRpc2VtZW50IHRoYXRcbiAgICogYXJyaXZlZCB3aGlsZSBwZXJzaXN0ZW5jZSB3YXMgaW4gZmxpZ2h0IGFuZCByZXBsYWNlZCB0aGUgZWFybGllciBkZWJpdC5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBBZG1pc3Npb24gZGV0YWlscy5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL3R5cGVzLmpzXCIpLkJhY2tncm91bmRKb2JSb3d9IGFyZ3Muam9iIC0gU2VsZWN0ZWQgam9iLlxuICAgKiBAcGFyYW0ge2Jvb2xlYW59IGFyZ3MucG9vbGVkQ3JlZGl0Q29uc3VtZWQgLSBXaGV0aGVyIGEgcG9vbGVkIGNyZWRpdCB3YXMgZGViaXRlZC5cbiAgICogQHBhcmFtIHtudW1iZXJ9IGFyZ3MucmVhZGluZXNzVmVyc2lvbiAtIFJlYWRpbmVzcyBnZW5lcmF0aW9uIGF0IGRlYml0IHRpbWUuXG4gICAqIEBwYXJhbSB7SnNvblNvY2tldH0gYXJncy53b3JrZXIgLSBTZWxlY3RlZCB3b3JrZXIgc29ja2V0LlxuICAgKiBAcmV0dXJucyB7dm9pZH1cbiAgICovXG4gIF9maW5hbGl6ZVdvcmtlckFkbWlzc2lvbih7am9iLCBwb29sZWRDcmVkaXRDb25zdW1lZCwgcmVhZGluZXNzVmVyc2lvbiwgd29ya2VyfSkge1xuICAgIGlmICghcG9vbGVkQ3JlZGl0Q29uc3VtZWQgfHwgam9iLmV4ZWN1dGlvbk1vZGUgIT09IFwicG9vbGVkXCIpIHJldHVyblxuICAgIGlmICh3b3JrZXIucmVhZGluZXNzVmVyc2lvbiA9PT0gcmVhZGluZXNzVmVyc2lvbiB8fCAhd29ya2VyLnVzZXNQb29sZWRDYXBhY2l0eUNyZWRpdHMpIHJldHVyblxuICAgIGlmICh3b3JrZXIuYXZhaWxhYmxlUG9vbGVkU2xvdHMgPD0gMCkgcmV0dXJuXG5cbiAgICB3b3JrZXIuYXZhaWxhYmxlUG9vbGVkU2xvdHMgLT0gMVxuICAgIGlmICh3b3JrZXIuYXZhaWxhYmxlUG9vbGVkU2xvdHMgPT09IDApIHRoaXMucmVhZHlXb3JrZXJzLmRlbGV0ZSh3b3JrZXIpXG4gIH1cblxuICAvKipcbiAgICogUmV0YWlucyBhbiBleGFjdCBsZWFzZSBmb3IgaWRlbXBvdGVudCBwcmUtZGlzcGF0Y2ggcmVjb3ZlcnkuXG4gICAqIEBwYXJhbSB7e2hhbmRvZmZJZDogc3RyaW5nLCBqb2JJZDogc3RyaW5nfX0gYXJncyAtIEV4YWN0IHJlY292ZXJ5IGZlbmNlLlxuICAgKiBAcmV0dXJucyB7dm9pZH1cbiAgICovXG4gIF9yZW1lbWJlckhhbmRvZmZSZWNvdmVyeSh7aGFuZG9mZklkLCBqb2JJZH0pIHtcbiAgICB0aGlzLnBlbmRpbmdIYW5kb2ZmUmVjb3Zlcmllcy5zZXQoaGFuZG9mZklkLCBqb2JJZClcbiAgfVxuXG4gIC8qKlxuICAgKiBSZXR1cm5zIG9uZSBleGFjdCBsZWFzZSBhbmQgZm9yZ2V0cyBpdCBvbmx5IGFmdGVyIHRoZSBhZGFwdGVyIGFja25vd2xlZGdlc1xuICAgKiB0aGUgZmVuY2VkIHRyYW5zaXRpb24gb3IgY29uZmlybXMgaXQgd2FzIGFscmVhZHkgYWJzZW50LlxuICAgKiBAcGFyYW0ge3toYW5kb2ZmSWQ6IHN0cmluZywgam9iSWQ6IHN0cmluZ319IGFyZ3MgLSBFeGFjdCByZWNvdmVyeSBmZW5jZS5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgYWZ0ZXIgZHVyYWJsZSByZWNvdmVyeSBzZXR0bGVzLlxuICAgKi9cbiAgYXN5bmMgX3JlY292ZXJIYW5kb2ZmKHtoYW5kb2ZmSWQsIGpvYklkfSkge1xuICAgIGF3YWl0IHRoaXMuc3RvcmUubWFya1JldHVybmVkVG9RdWV1ZSh7aGFuZG9mZklkLCBqb2JJZH0pXG5cbiAgICBpZiAodGhpcy5wZW5kaW5nSGFuZG9mZlJlY292ZXJpZXMuZ2V0KGhhbmRvZmZJZCkgPT09IGpvYklkKSB7XG4gICAgICB0aGlzLnBlbmRpbmdIYW5kb2ZmUmVjb3Zlcmllcy5kZWxldGUoaGFuZG9mZklkKVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBSZXBsYXlzIHJldGFpbmVkIGV4YWN0LUlEIHJlY292ZXJpZXMgdGhyb3VnaCB0aGUgZGlzcGF0Y2hlcidzIGV4aXN0aW5nXG4gICAqIHRyYW5zaWVudC1lcnJvciByZXRyeSBsaWZlY3ljbGUuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIGFmdGVyIGV2ZXJ5IHJldGFpbmVkIHJlY292ZXJ5IHNldHRsZXMuXG4gICAqL1xuICBhc3luYyBfcmV0cnlQZW5kaW5nSGFuZG9mZlJlY292ZXJpZXMoKSB7XG4gICAgZm9yIChjb25zdCBbaGFuZG9mZklkLCBqb2JJZF0gb2YgWy4uLnRoaXMucGVuZGluZ0hhbmRvZmZSZWNvdmVyaWVzXSkge1xuICAgICAgdHJ5IHtcbiAgICAgICAgYXdhaXQgdGhpcy5fcmVjb3ZlckhhbmRvZmYoe2hhbmRvZmZJZCwgam9iSWR9KVxuICAgICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgICAgdGhpcy5fcmVwb3J0SGFuZG9mZlJlY292ZXJ5RXJyb3Ioe2Vycm9yLCBoYW5kb2ZmSWQsIGpvYklkfSlcbiAgICAgICAgdGhyb3cgZXJyb3JcbiAgICAgIH1cbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogU3VyZmFjZXMgYSBmYWlsZWQgZXhhY3QtSUQgcmVjb3Zlcnkgd2l0aG91dCBkcm9wcGluZyBpdHMgcmV0cnkgbGVkZ2VyIGVudHJ5LlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIFJlY292ZXJ5IGZhaWx1cmUuXG4gICAqIEBwYXJhbSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59IGFyZ3MuZXJyb3IgLSBBZGFwdGVyIGZhaWx1cmUuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBhcmdzLmhhbmRvZmZJZCAtIEV4YWN0IGxlYXNlIGZlbmNlLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gYXJncy5qb2JJZCAtIEpvYiBpZC5cbiAgICogQHJldHVybnMge3ZvaWR9XG4gICAqL1xuICBfcmVwb3J0SGFuZG9mZlJlY292ZXJ5RXJyb3Ioe2Vycm9yLCBoYW5kb2ZmSWQsIGpvYklkfSkge1xuICAgIGNvbnN0IG5vcm1hbGl6ZWRFcnJvciA9IGVycm9yIGluc3RhbmNlb2YgRXJyb3IgPyBlcnJvciA6IG5ldyBFcnJvcihTdHJpbmcoZXJyb3IpKVxuICAgIGNvbnN0IHBheWxvYWQgPSB7XG4gICAgICBjb250ZXh0OiB7aGFuZG9mZklkLCBqb2JJZCwgc3RhZ2U6IFwiYmFja2dyb3VuZC1qb2ItaGFuZG9mZi1hZG1pc3Npb24tcmVjb3ZlcnlcIn0sXG4gICAgICBlcnJvcjogbm9ybWFsaXplZEVycm9yXG4gICAgfVxuICAgIGNvbnN0IGVycm9yRXZlbnRzID0gdGhpcy5jb25maWd1cmF0aW9uLmdldEVycm9yRXZlbnRzKClcblxuICAgIHRoaXMubG9nZ2VyLmVycm9yKCgpID0+IFtcIkZhaWxlZCB0byByZWNvdmVyIGFuIGFtYmlndW91cyBiYWNrZ3JvdW5kIGpvYiBoYW5kb2ZmOlwiLCBub3JtYWxpemVkRXJyb3JdKVxuICAgIGVycm9yRXZlbnRzLmVtaXQoXCJmcmFtZXdvcmstZXJyb3JcIiwgcGF5bG9hZClcbiAgICBlcnJvckV2ZW50cy5lbWl0KFwiYWxsLWVycm9yXCIsIHsuLi5wYXlsb2FkLCBlcnJvclR5cGU6IFwiZnJhbWV3b3JrLWVycm9yXCJ9KVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgbmV4dCBhdmFpbGFibGUgam9iIGZvciByZWFkeSB3b3JrZXJzLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxpbXBvcnQoXCIuL3R5cGVzLmpzXCIpLkJhY2tncm91bmRKb2JSb3cgfCBudWxsPn0gLSBOZXh0IHF1ZXVlZCBqb2IgbWF0Y2hpbmcgcmVhZHkgd29ya2VyIGNhcGFjaXR5LlxuICAgKi9cbiAgYXN5bmMgbmV4dEF2YWlsYWJsZUpvYkZvclJlYWR5V29ya2VycygpIHtcbiAgICBjb25zdCBleGVjdXRpb25Nb2RlcyA9IHRoaXMucmVhZHlXb3JrZXJFeGVjdXRpb25Nb2RlcygpXG5cbiAgICBpZiAoZXhlY3V0aW9uTW9kZXMubGVuZ3RoID09PSAwKSByZXR1cm4gbnVsbFxuICAgIGlmIChleGVjdXRpb25Nb2Rlcy5sZW5ndGggPT09IFdPUktFUl9FWEVDVVRJT05fTU9ERV9DQVBBQklMSVRJRVMubGVuZ3RoKSByZXR1cm4gYXdhaXQgdGhpcy5zdG9yZS5uZXh0QXZhaWxhYmxlSm9iKClcblxuICAgIHJldHVybiBhd2FpdCB0aGlzLnN0b3JlLm5leHRBdmFpbGFibGVKb2Ioe2V4ZWN1dGlvbk1vZGU6IGV4ZWN1dGlvbk1vZGVzfSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHJlYWR5IHdvcmtlciBleGVjdXRpb24gbW9kZXMuXG4gICAqIEByZXR1cm5zIHtpbXBvcnQoXCIuL3R5cGVzLmpzXCIpLkJhY2tncm91bmRKb2JFeGVjdXRpb25Nb2RlW119IC0gRXhlY3V0aW9uIG1vZGVzIGN1cnJlbnRseSBhY2NlcHRlZCBieSByZWFkeSB3b3JrZXJzLlxuICAgKi9cbiAgcmVhZHlXb3JrZXJFeGVjdXRpb25Nb2RlcygpIHtcbiAgICBjb25zdCBleGVjdXRpb25Nb2RlcyA9IG5ldyBTZXQoKVxuXG4gICAgZm9yIChjb25zdCB3b3JrZXIgb2YgdGhpcy5yZWFkeVdvcmtlcnMpIHtcbiAgICAgIHRoaXMuX2FkZEFjY2VwdGVkRXhlY3V0aW9uTW9kZXMoe2V4ZWN1dGlvbk1vZGVzLCB3b3JrZXJ9KVxuICAgIH1cblxuICAgIHJldHVybiAvKiogQHR5cGUge2ltcG9ydChcIi4vdHlwZXMuanNcIikuQmFja2dyb3VuZEpvYkV4ZWN1dGlvbk1vZGVbXX0gKi8gKFsuLi5leGVjdXRpb25Nb2Rlc10pXG4gIH1cblxuICAvKipcbiAgICogUnVucyBhZGQgYWNjZXB0ZWQgZXhlY3V0aW9uIG1vZGVzLlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIE9wdGlvbnMuXG4gICAqIEBwYXJhbSB7U2V0PGltcG9ydChcIi4vdHlwZXMuanNcIikuQmFja2dyb3VuZEpvYkV4ZWN1dGlvbk1vZGU+fSBhcmdzLmV4ZWN1dGlvbk1vZGVzIC0gQWNjZXB0ZWQgbW9kZXMuXG4gICAqIEBwYXJhbSB7SnNvblNvY2tldH0gYXJncy53b3JrZXIgLSBXb3JrZXIgc29ja2V0LlxuICAgKiBAcmV0dXJucyB7dm9pZH1cbiAgICovXG4gIF9hZGRBY2NlcHRlZEV4ZWN1dGlvbk1vZGVzKHtleGVjdXRpb25Nb2Rlcywgd29ya2VyfSkge1xuICAgIGlmICghd29ya2VyLnN1cHBvcnRzSGFuZG9mZklkUmVwb3J0aW5nKSByZXR1cm5cblxuICAgIGZvciAoY29uc3QgY2FwYWJpbGl0eSBvZiBXT1JLRVJfRVhFQ1VUSU9OX01PREVfQ0FQQUJJTElUSUVTKSB7XG4gICAgICBpZiAoY2FwYWJpbGl0eS5hY2NlcHRzKHdvcmtlcikpIGV4ZWN1dGlvbk1vZGVzLmFkZChjYXBhYmlsaXR5LmV4ZWN1dGlvbk1vZGUpXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgcmVhZHkgd29ya2VyIGZvciBqb2IuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi90eXBlcy5qc1wiKS5CYWNrZ3JvdW5kSm9iUm93fSBqb2IgLSBKb2IgYmVpbmcgaGFuZGVkIG9mZi5cbiAgICogQHJldHVybnMge0pzb25Tb2NrZXQgfCB1bmRlZmluZWR9IC0gUmVhZHkgd29ya2VyIGZvciB0aGUgam9iIHR5cGUuXG4gICAqL1xuICByZWFkeVdvcmtlckZvckpvYihqb2IpIHtcbiAgICBmb3IgKGNvbnN0IHdvcmtlciBvZiB0aGlzLnJlYWR5V29ya2Vycykge1xuICAgICAgaWYgKHRoaXMuX3dvcmtlckFjY2VwdHNKb2Ioe2pvYiwgd29ya2VyfSkpIHJldHVybiB3b3JrZXJcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogUnVucyB3b3JrZXIgYWNjZXB0cyBqb2IuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gT3B0aW9ucy5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL3R5cGVzLmpzXCIpLkJhY2tncm91bmRKb2JSb3d9IGFyZ3Muam9iIC0gSm9iIGJlaW5nIGhhbmRlZCBvZmYuXG4gICAqIEBwYXJhbSB7SnNvblNvY2tldH0gYXJncy53b3JrZXIgLSBXb3JrZXIgc29ja2V0LlxuICAgKiBAcmV0dXJucyB7Ym9vbGVhbn0gLSBXaGV0aGVyIHRoZSB3b3JrZXIgYWNjZXB0cyB0aGUgam9iIG1vZGUuXG4gICAqL1xuICBfd29ya2VyQWNjZXB0c0pvYih7am9iLCB3b3JrZXJ9KSB7XG4gICAgaWYgKCF3b3JrZXIuc3VwcG9ydHNIYW5kb2ZmSWRSZXBvcnRpbmcpIHJldHVybiBmYWxzZVxuXG4gICAgY29uc3QgY2FwYWJpbGl0eSA9IFdPUktFUl9FWEVDVVRJT05fTU9ERV9DQVBBQklMSVRJRVNfQllfTU9ERS5nZXQoam9iLmV4ZWN1dGlvbk1vZGUpXG5cbiAgICBpZiAoIWNhcGFiaWxpdHkpIHJldHVybiBmYWxzZVxuXG4gICAgcmV0dXJuIGNhcGFiaWxpdHkuYWNjZXB0cyh3b3JrZXIpXG4gIH1cblxuICAvKipcbiAgICogQXJtcyBhIHNpbmdsZSBgc2V0VGltZW91dGAgZm9yIHRoZSBzb29uZXN0IGZ1dHVyZS1zY2hlZHVsZWQgam9iJ3NcbiAgICogYHNjaGVkdWxlZF9hdF9tc2AuIFJlcGxhY2VzIHRoZSBzZWNvbmQgcmVzcG9uc2liaWxpdHkgb2YgdGhlIGxlZ2FjeVxuICAgKiAxLXNlY29uZCBwb2xsIChiZWNvbWluZy1lbGlnaWJsZSBzY2hlZHVsZWQgam9icykuIFRoZSB0aW1lciBpc1xuICAgKiBpZGVtcG90ZW50bHkgcmUtYXJtZWQgYXQgdGhlIGVuZCBvZiBldmVyeSBkcmFpbi5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59XG4gICAqL1xuICBhc3luYyBfYXJtU2NoZWR1bGVkVGltZXIoKSB7XG4gICAgaWYgKHRoaXMuX3NjaGVkdWxlZFRpbWVyKSB7XG4gICAgICBjbGVhclRpbWVvdXQodGhpcy5fc2NoZWR1bGVkVGltZXIpXG4gICAgICB0aGlzLl9zY2hlZHVsZWRUaW1lciA9IHVuZGVmaW5lZFxuICAgIH1cblxuICAgIGlmICh0aGlzLl9zdG9wcGVkIHx8IHRoaXMubGlmZWN5Y2xlU3RhdGUgIT09IFwiYWN0aXZlXCIgfHwgIXRoaXMuX2FjdGl2ZU93bmVyc2hpcFJlYWR5KSByZXR1cm5cbiAgICBpZiAodGhpcy5kaXNwYXRjaFN0cmF0ZWd5ID09PSBcInBvbGxpbmdcIikgcmV0dXJuXG5cbiAgICBjb25zdCBuZXh0ID0gYXdhaXQgdGhpcy5zdG9yZS5uZXh0U2NoZWR1bGVkSm9iKClcbiAgICBsZXQgZGVsYXlcblxuICAgIGlmIChuZXh0ICYmIHR5cGVvZiBuZXh0LnNjaGVkdWxlZEF0TXMgPT09IFwibnVtYmVyXCIpIHtcbiAgICAgIGRlbGF5ID0gTWF0aC5tYXgoMCwgTWF0aC5taW4obmV4dC5zY2hlZHVsZWRBdE1zIC0gdGhpcy5jbG9jay5ub3coKSwgTUFYX1RJTUVSX01TKSlcbiAgICB9XG5cbiAgICAvLyBgbmV4dFNjaGVkdWxlZEpvYmAgb25seSByZXR1cm5zIGZ1dHVyZSBqb2JzLCBzbyBhIGpvYiB0aGF0IGJlY2FtZVxuICAgIC8vIGVsaWdpYmxlIGFmdGVyIHRoZSBkcmFpbidzIGVsaWdpYmxlLWpvYiBwcm9iZSBpcyBpbnZpc2libGUgdG8gaXQuIElmIG9uZVxuICAgIC8vIGlzIGRpc3BhdGNoYWJsZSBub3csIGFybSBhIDAtZGVsYXkgcmUtZHJhaW4gc28gaXQgaXMgZGlzcGF0Y2hlZFxuICAgIC8vIGltbWVkaWF0ZWx5IGluc3RlYWQgb2YgYmVpbmcgc3RyYW5kZWQgdW50aWwgdGhlIG5leHQgZnV0dXJlIHRpbWVyIChvclxuICAgIC8vIGV4dGVybmFsIHNpZ25hbCkgZmlyZXMuXG4gICAgaWYgKGF3YWl0IHRoaXMubmV4dEF2YWlsYWJsZUpvYkZvclJlYWR5V29ya2VycygpKSBkZWxheSA9IDBcblxuICAgIGlmICh0eXBlb2YgZGVsYXkgIT09IFwibnVtYmVyXCIpIHJldHVyblxuXG4gICAgdGhpcy5fc2NoZWR1bGVkVGltZXIgPSBzZXRUaW1lb3V0KCgpID0+IHtcbiAgICAgIHRoaXMuX3NjaGVkdWxlZFRpbWVyID0gdW5kZWZpbmVkXG4gICAgICB2b2lkIHRoaXMuX2RyYWluKClcbiAgICB9LCBkZWxheSlcbiAgfVxuXG4gIGFzeW5jIF9zd2VlcE9ycGhhbnMoKSB7XG4gICAgdHJ5IHtcbiAgICAgIGxldCBvcnBoYW5lZEpvYnNcblxuICAgICAgaWYgKHRoaXMuZ2VuZXJhdGlvbklkKSB7XG4gICAgICAgIGNvbnN0IGNvbm5lY3RlZFdvcmtlcklkcyA9IG5ldyBTZXQoKVxuICAgICAgICBmb3IgKGNvbnN0IHdvcmtlciBvZiB0aGlzLndvcmtlcnMpIHtcbiAgICAgICAgICBpZiAod29ya2VyLndvcmtlcklkKSBjb25uZWN0ZWRXb3JrZXJJZHMuYWRkKHdvcmtlci53b3JrZXJJZClcbiAgICAgICAgfVxuICAgICAgICBmb3IgKGNvbnN0IHdvcmtlcklkIG9mIHRoaXMuZGlzY29ubmVjdGVkV29ya2Vycy5rZXlzKCkpIGNvbm5lY3RlZFdvcmtlcklkcy5hZGQod29ya2VySWQpXG5cbiAgICAgICAgY29uc3QgY3V0b2ZmID0gdGhpcy5jbG9jay5ub3coKSAtIEdFTkVSQVRJT05fT1JQSEFORURfQUZURVJfTVNcbiAgICAgICAgY29uc3QgaGFuZG9mZnMgPSAoYXdhaXQgdGhpcy5fZ2VuZXJhdGlvbk93bmVkSGFuZG9mZlNuYXBzaG90KCkpLmZpbHRlcigoaGFuZG9mZikgPT4ge1xuICAgICAgICAgIHJldHVybiBoYW5kb2ZmLmhhbmRlZE9mZkF0TXMgPD0gY3V0b2ZmICYmICFjb25uZWN0ZWRXb3JrZXJJZHMuaGFzKGhhbmRvZmYud29ya2VySWQpXG4gICAgICAgIH0pXG4gICAgICAgIG9ycGhhbmVkSm9icyA9IGhhbmRvZmZzLmxlbmd0aCA9PT0gMFxuICAgICAgICAgID8gW11cbiAgICAgICAgICA6IGF3YWl0IHRoaXMuc3RvcmUubWFya09ycGhhbmVkSGFuZG9mZnMoe2hhbmRvZmZzLCBlcnJvcjogXCJKb2Igb3JwaGFuZWQgYWZ0ZXIgaXRzIGdlbmVyYXRpb24gb3duZXIgZGlzYXBwZWFyZWRcIn0pXG4gICAgICB9IGVsc2Uge1xuICAgICAgICBvcnBoYW5lZEpvYnMgPSBhd2FpdCB0aGlzLnN0b3JlLm1hcmtPcnBoYW5lZEpvYnMoKVxuICAgICAgfVxuXG4gICAgICBhd2FpdCB0aGlzLl9oYW5kbGVPcnBoYW5lZEpvYnMoe2pvYnM6IG9ycGhhbmVkSm9icywgd2FybmluZzogXCJNYXJrZWQgb3JwaGFuZWQgYmFja2dyb3VuZCBqb2JzXCJ9KVxuICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICBjb25zdCBub3JtYWxpemVkRXJyb3IgPSBlcnJvciBpbnN0YW5jZW9mIEVycm9yID8gZXJyb3IgOiBuZXcgRXJyb3IoU3RyaW5nKGVycm9yKSlcbiAgICAgIGNvbnN0IHBheWxvYWQgPSB7Y29udGV4dDoge2dlbmVyYXRpb25JZDogdGhpcy5nZW5lcmF0aW9uSWQsIHN0YWdlOiBcImJhY2tncm91bmQtam9iLW9ycGhhbi1zd2VlcFwifSwgZXJyb3I6IG5vcm1hbGl6ZWRFcnJvcn1cbiAgICAgIGNvbnN0IGVycm9yRXZlbnRzID0gdGhpcy5jb25maWd1cmF0aW9uLmdldEVycm9yRXZlbnRzKClcblxuICAgICAgdGhpcy5sb2dnZXIuZXJyb3IoKCkgPT4gW1wiRmFpbGVkIHRvIG1hcmsgb3JwaGFuZWQgam9iczpcIiwgbm9ybWFsaXplZEVycm9yXSlcbiAgICAgIGVycm9yRXZlbnRzLmVtaXQoXCJmcmFtZXdvcmstZXJyb3JcIiwgcGF5bG9hZClcbiAgICAgIGVycm9yRXZlbnRzLmVtaXQoXCJhbGwtZXJyb3JcIiwgey4uLnBheWxvYWQsIGVycm9yVHlwZTogXCJmcmFtZXdvcmstZXJyb3JcIn0pXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIFB1Ymxpc2hlcyB0aGUgY29tbW9uIHBvc3Qtb3JwaGFuIGxpZmVjeWNsZTogd2FrZSBxdWV1ZWQgcmV0cmllcywgZW1pdCBvbmVcbiAgICogaXNvbGF0ZWQgZXZlbnQgcGVyIGFjY2VwdGVkIHRyYW5zaXRpb24sIGFuZCBkcmFpbiBzbyByZWxlYXNlZCBjb25jdXJyZW5jeVxuICAgKiBjYW4gaW1tZWRpYXRlbHkgYWRtaXQgb3RoZXIgd29yay5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBPcHRpb25zLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vdHlwZXMuanNcIikuQmFja2dyb3VuZEpvYlJvd1tdfSBhcmdzLmpvYnMgLSBBY2NlcHRlZCBvcnBoYW4gdHJhbnNpdGlvbnMuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBhcmdzLndhcm5pbmcgLSBMaWZlY3ljbGUgbG9nIG1lc3NhZ2UuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIGFmdGVyIHRoZSByZXN1bHRpbmcgZHJhaW4uXG4gICAqL1xuICBhc3luYyBfaGFuZGxlT3JwaGFuZWRKb2JzKHtqb2JzLCB3YXJuaW5nfSkge1xuICAgIGlmIChqb2JzLmxlbmd0aCA9PT0gMCkge1xuICAgICAgdGhpcy5fbWF5YmVTdG9wUmV0aXJlZCgpXG4gICAgICByZXR1cm5cbiAgICB9XG5cbiAgICB0aGlzLmxvZ2dlci53YXJuKCgpID0+IFt3YXJuaW5nLCBqb2JzLmxlbmd0aF0pXG4gICAgLy8gUmVjbGFpbWVkIG9ycGhhbnMgY2FuIGJlY29tZSBgcXVldWVkYCBhZ2FpbiDigJQgd2FrZSB0aGUgZGlzcGF0Y2hlciBmaXJzdFxuICAgIC8vIHNvIGFuIGFwcGxpY2F0aW9uIGV2ZW50IGhhbmRsZXIgdGhhdCB0aHJvd3MgYmVsb3cgY2Fubm90IHN0cmFuZCB0aGVtLlxuICAgIHRoaXMuX25vdGlmeUVucXVldWVkKClcbiAgICAvLyBFbWl0IGJlZm9yZSBhd2FpdGluZyB0aGUgZHJhaW4gc28gYSBibG9ja2VkIGRpc3BhdGNoZXIgY2Fubm90IGRlbGF5XG4gICAgLy8gYXBwbGljYXRpb24gcmVjb3ZlcnkuIElzb2xhdGUgaGFuZGxlcnMgc28gb25lIGNhbm5vdCBzdXBwcmVzcyB0aGUgcmVzdC5cbiAgICBmb3IgKGNvbnN0IGpvYiBvZiBqb2JzKSB7XG4gICAgICB0cnkge1xuICAgICAgICB0aGlzLl9lbWl0QmFja2dyb3VuZEpvYk9ycGhhbmVkKHtqb2J9KVxuICAgICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgICAgdGhpcy5sb2dnZXIuZXJyb3IoKCkgPT4gW1wiQSBiYWNrZ3JvdW5kLWpvYi1vcnBoYW5lZCBldmVudCBoYW5kbGVyIHRocmV3OlwiLCBlcnJvcl0pXG4gICAgICB9XG4gICAgfVxuICAgIGF3YWl0IHRoaXMuX2RyYWluKClcbiAgICB0aGlzLl9tYXliZVN0b3BSZXRpcmVkKClcbiAgfVxuXG4gIC8qKlxuICAgKiBEcm9wcyB3b3JrZXJzIHRoYXQgaGF2ZSBnb25lIHNpbGVudCBwYXN0IGB3b3JrZXJTdGFsZVRpbWVvdXRNc2AgKG5vXG4gICAqIGhlYXJ0YmVhdCwgcmVhZHksIG9yIHJlcG9ydCkuIEEgd2VkZ2VkIHdvcmtlciBrZWVwcyBpdHMgc29ja2V0IG9wZW4sIHNvIHRoZVxuICAgKiBgY2xvc2VgLWJhc2VkIGNsZWFudXAgbmV2ZXIgZmlyZXMgYW5kIGl0cyBpbi1mbGlnaHQgbGVhc2VzIOKAlCBhbmQgdGhlIHdob2xlXG4gICAqIHF1ZXVlIOKAlCBzdGF5IHN0dWNrIHVudGlsIGEgaHVtYW4gbm90aWNlcy4gUmVsZWFzaW5nIHRoZSBsb3N0IHdvcmtlcidzXG4gICAqIGxlYXNlcyBsZXRzIGl0cyBqb2JzIHJ1biBlbHNld2hlcmUgYW5kIHN0b3BzIGRpc3BhdGNoIHRvIGl0OyB0aGUgd29ya2VyJ3NcbiAgICogb3duIHByb2Nlc3MgbGlmZWN5Y2xlIGlzIHRoZSBzdXBlcnZpc29yJ3MgY29uY2Vybi5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgYWZ0ZXIgdGhlIHN3ZWVwLlxuICAgKi9cbiAgYXN5bmMgX3N3ZWVwU3RhbGVXb3JrZXJzKCkge1xuICAgIGlmICh0aGlzLl9zdG9wcGVkKSByZXR1cm5cblxuICAgIGNvbnN0IGN1dG9mZiA9IHRoaXMuY2xvY2subm93KCkgLSB0aGlzLndvcmtlclN0YWxlVGltZW91dE1zXG4gICAgLyoqIEB0eXBlIHtKc29uU29ja2V0W119ICovXG4gICAgY29uc3Qgc3RhbGUgPSBbXVxuXG4gICAgZm9yIChjb25zdCB3b3JrZXIgb2YgdGhpcy53b3JrZXJzKSB7XG4gICAgICAvLyBPbmx5IGV2aWN0IGhlYXJ0YmVhdC1jYXBhYmxlIHdvcmtlcnMuIEEgbGVnYWN5IHdvcmtlciAoZS5nLiBvbmUgZnJvbSB0aGVcbiAgICAgIC8vIHByZXZpb3VzIHJlbGVhc2UgZHVyaW5nIGEgcm9sbGluZyBkZXBsb3kpIG5ldmVyIGhlYXJ0YmVhdHMsIHNvIGV2aWN0aW5nXG4gICAgICAvLyBpdCBvbiBzaWxlbmNlIHdvdWxkIHdyb25nbHkgcmVsZWFzZSB0aGUgbGVhc2VzIG9mIGEgam9iIGl0IGlzIHN0aWxsXG4gICAgICAvLyBydW5uaW5nLiBJdHMgZGlzY29ubmVjdCBpcyBzdGlsbCBoYW5kbGVkIGJ5IHRoZSBzb2NrZXQgYGNsb3NlYCBwYXRoLlxuICAgICAgaWYgKCF3b3JrZXIuc3VwcG9ydHNIZWFydGJlYXQpIGNvbnRpbnVlXG5cbiAgICAgIGNvbnN0IGxhc3RTZWVuQXQgPSB0eXBlb2Ygd29ya2VyLmxhc3RTZWVuQXQgPT09IFwibnVtYmVyXCIgPyB3b3JrZXIubGFzdFNlZW5BdCA6IDBcblxuICAgICAgaWYgKGxhc3RTZWVuQXQgPD0gY3V0b2ZmKSBzdGFsZS5wdXNoKHdvcmtlcilcbiAgICB9XG5cbiAgICBmb3IgKGNvbnN0IHdvcmtlciBvZiBzdGFsZSkge1xuICAgICAgdGhpcy5sb2dnZXIud2FybigoKSA9PiBbXCJEcm9wcGluZyBzdGFsZSBiYWNrZ3JvdW5kIGpvYnMgd29ya2VyXCIsIHt3b3JrZXJJZDogd29ya2VyLndvcmtlcklkLCBsYXN0U2VlbkF0OiB3b3JrZXIubGFzdFNlZW5BdH1dKVxuXG4gICAgICB0cnkge1xuICAgICAgICB3b3JrZXIuY2xvc2UoKVxuICAgICAgfSBjYXRjaCB7XG4gICAgICAgIC8vIEFscmVhZHkgY2xvc2luZzsgdGhlIGxlYXNlIHJlbGVhc2UgYmVsb3cgaXMgd2hhdCBtYXR0ZXJzLlxuICAgICAgfVxuXG4gICAgICBhd2FpdCB0aGlzLl9oYW5kbGVXb3JrZXJTb2NrZXRDbG9zZWQod29ya2VyKVxuICAgIH1cbiAgfVxufVxuIl19